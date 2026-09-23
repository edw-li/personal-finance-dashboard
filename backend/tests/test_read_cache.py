"""Read-path memoisation (2026-09-23 spec §P4): equal to the uncached answer, invalidated by
every write to every table it reads, never handed to a write path, never session-bound."""

from dataclasses import fields
from datetime import UTC, date, datetime
from decimal import Decimal
from types import MappingProxyType

import pytest
from sqlalchemy import inspect
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.models import (
    Account,
    AccountBalance,
    MonthlyCashflow,
    MonthlySpending,
    NetWorthSnapshot,
    PaycheckProfile,
    Person,
    SpendingCategory,
)
from app.models.month_review import MonthReview, MonthReviewAdoption
from app.services import clock
from app.services.month_review import (
    REVIEW_SNAPSHOT_FIELDS,
    ReviewSnapshot,
    load_review_book,
    load_review_book_snapshot,
)

D = Decimal
TODAY = date(2026, 9, 12)
MONTHS = [date(2026, m, 1) for m in (5, 6, 7, 8)]


@pytest.fixture(autouse=True)
def fixed_clock(monkeypatch):
    monkeypatch.setattr(clock, "product_today", lambda: TODAY)


async def seed(db) -> None:
    """Every table the book reads, with rows spare enough to update and delete safely."""
    person = Person(name="Me", is_primary=True)
    db.add(person)
    await db.flush()
    investments = Account(name="Investments", slug="investments", group="taxable")
    spare_account = Account(name="Spare", slug="spare", group="cash")
    living = SpendingCategory(name="Living", slug="living", kind="living")
    taxes = SpendingCategory(name="Taxes", slug="taxes", kind="tax")
    spare_category = SpendingCategory(name="Spare", slug="spare-cat", kind="living")
    db.add_all([investments, spare_account, living, taxes, spare_category])
    db.add(
        PaycheckProfile(
            person_id=person.id,
            effective_date=date(2026, 1, 1),
            annual_salary=D("120000"),
            trad_401k_pct=D("0.1"),
        )
    )
    await db.flush()
    for month in MONTHS:
        snapshot = NetWorthSnapshot(month=month, recorded_on=month)
        db.add(snapshot)
        await db.flush()
        db.add(
            AccountBalance(snapshot_id=snapshot.id, account_id=investments.id, balance=D("5000"))
        )
        db.add(MonthlySpending(month=month, category_id=living.id, amount=D("100.00")))
        db.add(MonthlySpending(month=month, category_id=taxes.id, amount=D("7.50")))
        db.add(MonthlyCashflow(month=month, net_pay=D("1000.00")))
    # A snapshot with no balances: deletable, and a month the book covers without data.
    db.add(NetWorthSnapshot(month=date(2026, 9, 1), recorded_on=date(2026, 9, 2)))
    db.add(MonthReviewAdoption(id=1, adopted_on=date(2026, 7, 15)))
    db.add(MonthReview(month=MONTHS[0], legacy_revision="a" * 64))
    db.add(
        MonthReview(
            month=MONTHS[1],
            reviewed_revision="b" * 64,
            confirmation_revision="b" * 64,
            balances_reviewed=True,
            spending_reviewed=True,
            take_home_reviewed=True,
            zero_spending_confirmed=True,
            closed_at=datetime(2026, 7, 2, tzinfo=UTC),
            closed_by="me@example.com",
            last_response={"kept": "out of snapshots"},
        )
    )
    await db.commit()


def review_fields(review) -> dict:
    return {name: getattr(review, name) for name in REVIEW_SNAPSHOT_FIELDS}


def assert_same_book(cached, uncached) -> None:
    assert cached.today == uncached.today
    assert cached.adopted_on == uncached.adopted_on
    assert dict(cached.months) == dict(uncached.months)
    assert dict(cached.inputs) == dict(uncached.inputs)
    assert {m: review_fields(r) for m, r in cached.reviews.items()} == {
        m: review_fields(r) for m, r in uncached.reviews.items()
    }
    assert cached.default_month == uncached.default_month


async def test_snapshot_book_equals_the_orm_book_and_holds_no_session_objects(db, engine):
    await seed(db)
    uncached = await load_review_book(db, extra_months=[date(2026, 12, 1)])
    async with async_sessionmaker(engine, expire_on_commit=False)() as other:
        snapshot = await load_review_book_snapshot(other, extra_months=[date(2026, 12, 1)])
    # `other` is closed now: everything in the book must still read, and none of it is ORM.
    assert_same_book(snapshot, uncached)
    assert all(isinstance(r, ReviewSnapshot) for r in snapshot.reviews.values())
    assert all(inspect(r, raiseerr=False) is None for r in snapshot.reviews.values())
    assert snapshot.reviews[MONTHS[1]].closed_at == datetime(2026, 7, 2, tzinfo=UTC)
    assert {f.name for f in fields(ReviewSnapshot)} == set(REVIEW_SNAPSHOT_FIELDS)
    # A shared value must refuse writes rather than let one caller corrupt the next.
    for mapping in (snapshot.months, snapshot.inputs, snapshot.reviews):
        assert isinstance(mapping, MappingProxyType)
        with pytest.raises(TypeError):
            mapping[date(2000, 1, 1)] = None  # type: ignore[index]
    with pytest.raises(AttributeError):
        snapshot.reviews[MONTHS[1]].closed_by = "someone else"  # type: ignore[misc]


async def test_the_orm_book_still_hands_write_paths_their_rows(db):
    await seed(db)
    book = await load_review_book(db)
    row = book.reviews[MONTHS[1]]
    assert isinstance(row, MonthReview)
    assert row in db  # session-bound: the write paths update it in place
