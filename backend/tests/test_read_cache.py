"""Read-path memoisation (2026-09-23 spec §P4): equal to the uncached answer, invalidated by
every write to every table it reads, never handed to a write path, never session-bound."""

import re
from contextlib import contextmanager
from dataclasses import fields, replace
from datetime import UTC, date, datetime
from decimal import Decimal
from types import MappingProxyType

import pytest
from sqlalchemy import delete, event, inspect, select, update
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
from app.services import clock, read_cache
from app.services.month_review import (
    REVIEW_SNAPSHOT_FIELDS,
    ReviewSnapshot,
    adopt_existing_history,
    load_review_book,
    load_review_book_snapshot,
)
from app.services.savings import load_month_savings

D = Decimal
TODAY = date(2026, 9, 12)
MONTHS = [date(2026, m, 1) for m in (5, 6, 7, 8)]
REVIEW_BOOKS = read_cache.REVIEW_BOOKS


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


# --- the cached review book ---


async def test_cached_book_equals_the_uncached_book_and_is_reused(db):
    await seed(db)
    first = await read_cache.cached_review_book(db)
    assert_same_book(first, await load_review_book(db))
    assert await read_cache.cached_review_book(db) is first
    assert all(isinstance(r, ReviewSnapshot) for r in first.reviews.values())


async def test_an_empty_book_is_cached_too(db):
    empty = await read_cache.cached_review_book(db)
    assert dict(empty.months) == {}
    assert await read_cache.cached_review_book(db) is empty


async def seeded_ids(db) -> dict[str, int]:
    async def one(statement) -> int:
        return (await db.execute(statement)).scalar_one()

    return {
        "person": await one(select(Person.id)),
        "spare_account": await one(select(Account.id).where(Account.slug == "spare")),
        "living": await one(select(SpendingCategory.id).where(SpendingCategory.slug == "living")),
        "spare_category": await one(
            select(SpendingCategory.id).where(SpendingCategory.slug == "spare-cat")
        ),
        "empty_snapshot": await one(
            select(NetWorthSnapshot.id).where(NetWorthSnapshot.month == date(2026, 9, 1))
        ),
        "snapshot": await one(
            select(NetWorthSnapshot.id).where(NetWorthSnapshot.month == MONTHS[-1])
        ),
    }


async def _add(db, row) -> None:
    db.add(row)
    await db.commit()


async def _run(db, statement) -> None:
    # Core writes: they bypass every ORM event, like a Core undo/restore or psql would.
    await db.execute(statement)
    await db.commit()


LATEST = MONTHS[-1]
MUTATIONS = {
    ("accounts", "insert"): lambda db, ids: _add(db, Account(name="New", slug="new", group="cash")),
    ("accounts", "update"): lambda db, ids: _run(
        db, update(Account).where(Account.id == ids["spare_account"]).values(sort_order=9)
    ),
    ("accounts", "delete"): lambda db, ids: _run(
        db, delete(Account).where(Account.id == ids["spare_account"])
    ),
    ("net_worth_snapshots", "insert"): lambda db, ids: _add(
        db, NetWorthSnapshot(month=date(2026, 10, 1))
    ),
    ("net_worth_snapshots", "update"): lambda db, ids: _run(
        db,
        update(NetWorthSnapshot)
        .where(NetWorthSnapshot.id == ids["empty_snapshot"])
        .values(notes="n"),
    ),
    ("net_worth_snapshots", "delete"): lambda db, ids: _run(
        db, delete(NetWorthSnapshot).where(NetWorthSnapshot.id == ids["empty_snapshot"])
    ),
    ("account_balances", "insert"): lambda db, ids: _add(
        db,
        AccountBalance(
            snapshot_id=ids["snapshot"], account_id=ids["spare_account"], balance=D("1")
        ),
    ),
    ("account_balances", "update"): lambda db, ids: _run(
        db,
        update(AccountBalance)
        .where(AccountBalance.snapshot_id == ids["snapshot"])
        .values(balance=D("5001")),
    ),
    ("account_balances", "delete"): lambda db, ids: _run(
        db, delete(AccountBalance).where(AccountBalance.snapshot_id == ids["snapshot"])
    ),
    ("spending_categories", "insert"): lambda db, ids: _add(
        db, SpendingCategory(name="New", slug="new", kind="living")
    ),
    ("spending_categories", "update"): lambda db, ids: _run(
        db,
        update(SpendingCategory)
        .where(SpendingCategory.id == ids["living"])
        .values(kind="transfer"),
    ),
    ("spending_categories", "delete"): lambda db, ids: _run(
        db, delete(SpendingCategory).where(SpendingCategory.id == ids["spare_category"])
    ),
    ("monthly_spending", "insert"): lambda db, ids: _add(
        db, MonthlySpending(month=MONTHS[0], category_id=ids["spare_category"], amount=D("3"))
    ),
    ("monthly_spending", "update"): lambda db, ids: _run(
        db,
        update(MonthlySpending)
        .where(MonthlySpending.month == LATEST, MonthlySpending.category_id == ids["living"])
        .values(amount=D("101.00")),
    ),
    ("monthly_spending", "delete"): lambda db, ids: _run(
        db,
        delete(MonthlySpending).where(
            MonthlySpending.month == LATEST, MonthlySpending.category_id == ids["living"]
        ),
    ),
    ("monthly_cashflow", "insert"): lambda db, ids: _add(
        db, MonthlyCashflow(month=date(2026, 10, 1), net_pay=D("5.00"))
    ),
    ("monthly_cashflow", "update"): lambda db, ids: _run(
        db, update(MonthlyCashflow).where(MonthlyCashflow.month == LATEST).values(net_pay=D("9"))
    ),
    ("monthly_cashflow", "delete"): lambda db, ids: _run(
        db, delete(MonthlyCashflow).where(MonthlyCashflow.month == LATEST)
    ),
    ("paycheck_profiles", "insert"): lambda db, ids: _add(
        db,
        PaycheckProfile(
            person_id=ids["person"], effective_date=date(2026, 7, 1), annual_salary=D("130000")
        ),
    ),
    ("paycheck_profiles", "update"): lambda db, ids: _run(
        db, update(PaycheckProfile).values(espp_pct=D("0.05"))
    ),
    ("paycheck_profiles", "delete"): lambda db, ids: _run(db, delete(PaycheckProfile)),
    ("month_reviews", "insert"): lambda db, ids: _add(
        db, MonthReview(month=MONTHS[2], legacy_revision="c" * 64)
    ),
    ("month_reviews", "update"): lambda db, ids: _run(
        db, update(MonthReview).where(MonthReview.month == MONTHS[1]).values(closed_by="other")
    ),
    ("month_reviews", "delete"): lambda db, ids: _run(
        db, delete(MonthReview).where(MonthReview.month == MONTHS[0])
    ),
    # The singleton row must be gone before an insert can be observed (see PREPARE).
    ("month_review_adoption", "insert"): lambda db, ids: _add(
        db, MonthReviewAdoption(id=1, adopted_on=date(2026, 6, 30))
    ),
    ("month_review_adoption", "update"): lambda db, ids: _run(
        db, update(MonthReviewAdoption).values(adopted_on=date(2026, 8, 20))
    ),
    ("month_review_adoption", "delete"): lambda db, ids: _run(db, delete(MonthReviewAdoption)),
}
PREPARE = {
    ("month_review_adoption", "insert"): lambda db, ids: _run(db, delete(MonthReviewAdoption)),
}


def test_the_mutation_matrix_covers_every_book_table():
    assert {table for table, _ in MUTATIONS} == set(read_cache.REVIEW_BOOK_TABLES)
    assert {operation for _, operation in MUTATIONS} == {"insert", "update", "delete"}
    assert len(MUTATIONS) == 3 * len(read_cache.REVIEW_BOOK_TABLES)


@pytest.mark.parametrize(("table", "operation"), sorted(MUTATIONS))
async def test_every_write_to_every_book_table_invalidates(db, table, operation):
    await seed(db)
    ids = await seeded_ids(db)
    if (table, operation) in PREPARE:
        await PREPARE[(table, operation)](db, ids)
    warm = await read_cache.cached_review_book(db)
    assert await read_cache.cached_review_book(db) is warm
    await MUTATIONS[(table, operation)](db, ids)
    fresh = await read_cache.cached_review_book(db)
    assert fresh is not warm
    assert_same_book(fresh, await load_review_book(db))


async def test_a_changed_today_misses_and_both_days_stay_cached(db):
    await seed(db)
    first = await read_cache.cached_review_book(db, today=TODAY)
    later = await read_cache.cached_review_book(db, today=date(2026, 10, 3))
    assert later is not first and later.today == date(2026, 10, 3)
    assert_same_book(later, await load_review_book(db, today=date(2026, 10, 3)))
    assert await read_cache.cached_review_book(db, today=TODAY) is first
    assert await read_cache.cached_review_book(db) is first  # no `today` = the product day


async def test_extra_months_that_change_the_book_miss_and_those_inside_it_reuse_it(db):
    await seed(db)
    base = await read_cache.cached_review_book(db)
    inside = await read_cache.cached_review_book(db, extra_months=[MONTHS[1], MONTHS[1]])
    assert inside is base  # MONTHS[1] is already in the book: provably the same book
    assert_same_book(inside, await load_review_book(db, extra_months=[MONTHS[1]]))
    beyond = date(2027, 2, 1)
    extended = await read_cache.cached_review_book(db, extra_months=[beyond])
    assert extended is not base
    assert beyond in extended.months and beyond not in base.months
    assert_same_book(extended, await load_review_book(db, extra_months=[beyond]))
    assert await read_cache.cached_review_book(db, extra_months=[beyond]) is extended
    before = date(2025, 11, 1)  # earlier than every row: widens the book at the other end
    widened = await read_cache.cached_review_book(db, extra_months=[before, MONTHS[0]])
    assert widened is not base and before in widened.months
    assert_same_book(widened, await load_review_book(db, extra_months=[MONTHS[0], before]))


async def test_extras_asked_before_the_base_book_exists_are_cached_under_their_own_key(db):
    await seed(db)
    inside = await read_cache.cached_review_book(db, extra_months=[MONTHS[2]])
    assert await read_cache.cached_review_book(db, extra_months=[MONTHS[2]]) is inside
    base = await read_cache.cached_review_book(db)
    assert_same_book(base, inside)
    assert await read_cache.cached_review_book(db, extra_months=[MONTHS[2]]) in (base, inside)


async def test_a_write_committed_mid_build_is_never_filed_under_the_old_key(
    db, engine, monkeypatch
):
    """The Undo trap: a book built AFTER an insert must not be cached under the fingerprint
    taken BEFORE it, or deleting the row again (an Undo) would bring the stale book back."""
    await seed(db)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    real = read_cache.load_review_book_snapshot

    async def build_after_a_concurrent_insert(session, **kwargs):
        async with sessions() as writer:
            writer.add(MonthlyCashflow(month=date(2026, 11, 1), net_pay=D("77.00")))
            await writer.commit()
        return await real(session, **kwargs)

    monkeypatch.setattr(read_cache, "load_review_book_snapshot", build_after_a_concurrent_insert)
    torn = await read_cache.cached_review_book(db)
    assert date(2026, 11, 1) in torn.months  # this caller still gets what it built ...
    assert len(REVIEW_BOOKS) == 0  # ... but nothing was filed
    monkeypatch.setattr(read_cache, "load_review_book_snapshot", real)
    await _run(db, delete(MonthlyCashflow).where(MonthlyCashflow.month == date(2026, 11, 1)))
    after_undo = await read_cache.cached_review_book(db)
    assert date(2026, 11, 1) not in after_undo.months
    assert_same_book(after_undo, await load_review_book(db))
    assert len(REVIEW_BOOKS) == 1


async def test_a_session_with_pending_changes_bypasses_the_cache(db, monkeypatch):
    await seed(db)
    calls = []
    real = read_cache.load_review_book

    async def spy(session, **kwargs):
        calls.append(kwargs)
        return await real(session, **kwargs)

    monkeypatch.setattr(read_cache, "load_review_book", spy)
    db.add(MonthlyCashflow(month=date(2026, 12, 1), net_pay=D("1.00")))  # pending, unflushed
    await read_cache.cached_review_book(db, extra_months=[date(2026, 12, 1)])
    assert calls == [{"extra_months": [date(2026, 12, 1)], "today": None}]
    assert len(REVIEW_BOOKS) == 0
    await db.rollback()
    await read_cache.cached_review_book(db)  # a clean session is served normally again
    assert len(calls) == 1 and len(REVIEW_BOOKS) == 1


@contextmanager
def tables_read(engine):
    seen: set[str] = set()

    def record(conn, cursor, statement, parameters, context, executemany):
        seen.update(re.findall(r'\b(?:FROM|JOIN)\s+"?([a-z_]+)"?', statement))

    event.listen(engine.sync_engine, "before_cursor_execute", record)
    try:
        yield seen
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", record)


async def test_the_fingerprints_cover_exactly_the_tables_the_loaders_read(db, engine):
    """Derived from the loaders' own SQL, so a new read can never slip past its fingerprint."""
    await seed(db)
    with tables_read(engine) as book_tables:
        await load_review_book(db)
    with tables_read(engine) as snapshot_tables:
        await load_review_book_snapshot(db)
    with tables_read(engine) as savings_tables:
        await load_month_savings(db)
    assert book_tables == snapshot_tables == set(read_cache.REVIEW_BOOK_TABLES)
    assert savings_tables == set(read_cache.MONTH_SAVINGS_TABLES)


# --- the cached month savings ---

SAVINGS_MUTATIONS = sorted(key for key in MUTATIONS if key[0] in read_cache.MONTH_SAVINGS_TABLES)


async def test_cached_savings_equal_the_uncached_rows_and_are_reused(db):
    await seed(db)
    first = await read_cache.cached_month_savings(db)
    assert first == await load_month_savings(db)
    assert len(read_cache.MONTH_SAVINGS) == 1
    second = await read_cache.cached_month_savings(db)
    assert second == first and second is not first  # each caller gets its own list
    second.append(None)  # so a caller mutating its answer cannot reach the cache
    assert await read_cache.cached_month_savings(db) == first
    assert len(read_cache.MONTH_SAVINGS) == 1


def test_the_savings_mutations_cover_every_savings_table():
    assert {table for table, _ in SAVINGS_MUTATIONS} == set(read_cache.MONTH_SAVINGS_TABLES)


@pytest.mark.parametrize(("table", "operation"), SAVINGS_MUTATIONS)
async def test_every_write_to_every_savings_table_invalidates(db, table, operation):
    await seed(db)
    ids = await seeded_ids(db)
    await read_cache.cached_month_savings(db)
    assert len(read_cache.MONTH_SAVINGS) == 1
    await MUTATIONS[(table, operation)](db, ids)
    assert await read_cache.cached_month_savings(db) == await load_month_savings(db)
    assert len(read_cache.MONTH_SAVINGS) == 2  # a new fingerprint, a new entry


async def test_a_write_outside_the_savings_tables_keeps_the_savings_entry(db):
    await seed(db)
    await read_cache.cached_month_savings(db)
    await _run(db, update(AccountBalance).values(balance=D("1")))
    await read_cache.cached_month_savings(db)
    assert len(read_cache.MONTH_SAVINGS) == 1  # balances are not a savings input


async def test_savings_built_across_a_concurrent_write_are_not_filed(db, engine, monkeypatch):
    await seed(db)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    real = read_cache.load_month_savings

    async def build_after_a_concurrent_insert(session):
        async with sessions() as writer:
            writer.add(MonthlyCashflow(month=date(2026, 11, 1), net_pay=D("77.00")))
            await writer.commit()
        return await real(session)

    monkeypatch.setattr(read_cache, "load_month_savings", build_after_a_concurrent_insert)
    await read_cache.cached_month_savings(db)
    assert len(read_cache.MONTH_SAVINGS) == 0


async def test_savings_with_pending_changes_bypass_the_cache(db):
    await seed(db)
    db.add(MonthlyCashflow(month=date(2026, 12, 1), net_pay=D("1.00")))  # pending, unflushed
    rows = await read_cache.cached_month_savings(db)
    assert date(2026, 12, 1) in {row.month for row in rows}  # the uncached read autoflushed
    assert len(read_cache.MONTH_SAVINGS) == 0
    await db.rollback()


# --- read paths read through the cache; write paths never do ---

API = "/api/v1"
BASE = f"{API}/month-review"
CONFIRMED = {"balances": True, "spending": True, "take_home": True}
READS = [
    f"{API}/coverage",
    f"{API}/metrics/spending",
    f"{API}/metrics/spending?month={LATEST}",
    f"{API}/spending/matrix",
    f"{API}/projection",
    BASE,
    f"{BASE}/months/{LATEST}",
]


async def test_every_read_path_builds_the_book_and_the_savings_once(auth_client, db, monkeypatch):
    """Seven GETs (the Overview's four, projection and month review's two) over unchanged
    data: one book assembled, one savings composition — by ANY loader, cached or not."""
    from app.services import month_review, savings

    await seed(db)
    built = {"book": 0, "savings": 0}
    assemble, compose = month_review.assemble_review_book, savings.compose_months

    def counting_assemble(**kwargs):
        built["book"] += 1
        return assemble(**kwargs)

    def counting_compose(*args):
        built["savings"] += 1
        return compose(*args)

    monkeypatch.setattr(month_review, "assemble_review_book", counting_assemble)
    monkeypatch.setattr(savings, "compose_months", counting_compose)
    for path in READS:
        response = await auth_client.get(path)
        assert response.status_code == 200, (path, response.text)
    assert built == {"book": 1, "savings": 1}


def poison_every_cached_book() -> None:
    """Same keys, a revision nobody has and a month nobody may close."""
    for key in REVIEW_BOOKS.keys():
        book = REVIEW_BOOKS.get(key)
        poisoned = {
            month: state.model_copy(
                update={"input_revision": "0" * 64, "can_close": False, "blockers": ["poison"]}
            )
            for month, state in book.months.items()
        }
        REVIEW_BOOKS.put(key, replace(book, months=MappingProxyType(poisoned)))


async def test_reads_serve_the_cache_and_a_month_save_never_does(auth_client, db):
    await seed(db)
    assert (await auth_client.get(BASE)).status_code == 200  # files the no-extras book
    truth = (await auth_client.get(f"{BASE}/months/{LATEST}")).json()
    assert len(REVIEW_BOOKS) == 1  # the month lies inside that book, which answers it too
    poison_every_cached_book()
    # The reads now answer from the poisoned entry: proof that they read through the cache.
    assert (await auth_client.get(f"{BASE}/months/{LATEST}")).json()["input_revision"] == "0" * 64
    listed = (await auth_client.get(BASE)).json()["months"]
    assert {item["input_revision"] for item in listed} == {"0" * 64}
    coverage = (await auth_client.get(f"{API}/coverage")).json()
    assert {item["input_revision"] for item in coverage["review_months"]} == {"0" * 64}
    evidence = (await auth_client.get(f"{API}/metrics/spending?month={LATEST}")).json()
    assert evidence["review"]["input_revision"] == "0" * 64
    # The write path builds its own book: the TRUE revision is accepted, the month closes.
    saved = await auth_client.put(
        f"{BASE}/months/{LATEST}",
        json={"expected_revision": truth["input_revision"], "close": True, "reviewed": CONFIRMED},
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["review"]["state"] == "closed"
    # The save moved the fingerprint: reads rebuild, see it, and the poison is unreachable.
    after = (await auth_client.get(f"{BASE}/months/{LATEST}")).json()
    assert after["state"] == "closed" and after["input_revision"] != "0" * 64


async def _readopt(db) -> None:
    await db.execute(delete(MonthReview))
    await db.execute(delete(MonthReviewAdoption))
    await db.commit()
    await adopt_existing_history(db, TODAY)
    await db.commit()


async def test_a_batch_close_never_reads_a_poisoned_book(auth_client, db):
    await seed(db)
    await _readopt(db)  # May-Aug become legacy history with their real revisions
    state = (await auth_client.get(f"{BASE}/months/{MONTHS[0]}")).json()
    assert state["legacy_eligible"] and state["can_close"]
    assert len(REVIEW_BOOKS) == 1  # the GET filed the book the poison now replaces
    poison_every_cached_book()
    response = await auth_client.post(
        f"{BASE}/batch-close",
        json={
            "months": [{"month": str(MONTHS[0]), "expected_revision": state["input_revision"]}],
            "reviewed": CONFIRMED,
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["months"][0]["state"] == "closed"


async def test_adoption_never_reads_a_poisoned_book(db):
    await seed(db)
    await db.execute(delete(MonthReview))
    await db.execute(delete(MonthReviewAdoption))
    await db.commit()
    truth = await load_review_book(db, today=TODAY)
    await read_cache.cached_review_book(db, today=TODAY)
    assert len(REVIEW_BOOKS) == 1
    poison_every_cached_book()
    await adopt_existing_history(db, TODAY)
    await db.commit()
    stored = {
        row.month: row.legacy_revision for row in (await db.execute(select(MonthReview))).scalars()
    }
    assert set(stored) == set(MONTHS)
    assert all(stored[month] == truth.months[month].input_revision for month in stored)
