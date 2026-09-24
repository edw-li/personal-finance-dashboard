"""K3's change-log evidence (2026-09-23 spec §K3): ONE indexed query over the candidate months
only — uncertified months with spending — plus undone batches from changelog.undone_by; and the
spending-state table, one test each, through the real evidence query."""

import re
from contextlib import contextmanager
from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import event, select

from app.models import ChangeLog, MonthlySpending, NetWorthSnapshot, SpendingCategory
from app.models.month_review import MonthReview, MonthReviewAdoption
from app.services import clock, month_status
from app.services.coverage import load_coverage
from app.services.month_review import load_review_book

PT = ZoneInfo("America/Los_Angeles")
JUL, AUG, SEP, OCT = date(2026, 7, 1), date(2026, 8, 1), date(2026, 9, 1), date(2026, 10, 1)


def pt(year: int, month: int, day: int, hour: int = 12, minute: int = 0) -> datetime:
    return datetime(year, month, day, hour, minute, tzinfo=PT)


def on(monkeypatch, day: date) -> None:
    monkeypatch.setattr(clock, "product_today", lambda: day)


async def rent(db, *months: date, amount: str = "2072.23") -> SpendingCategory:
    category = SpendingCategory(name="Rent", slug="rent", sort_order=1)
    db.add(category)
    await db.flush()
    for month in months:
        db.add(MonthlySpending(month=month, category_id=category.id, amount=Decimal(amount)))
    return category


def log(
    db,
    *,
    at: datetime,
    month: date | None,
    table: str = "monthly_spending",
    op: str = "insert",
    source: str = "ui",
    after: dict | None = None,
):
    """One change-log row, stamped explicitly — the evidence K3 reads."""
    db.add(
        ChangeLog(
            batch_id=uuid4(),
            source=source,
            actor="me@example.com",
            label="test",
            table_name=table,
            pk={"id": 1},
            op=op,
            before=None,
            after={"id": 1} if after is None else after,
            month=month,
            at=at,
        )
    )


@contextmanager
def change_log_statements(engine):
    seen: list[tuple[str, object]] = []

    def record(conn, cursor, statement, parameters, context, executemany):
        if re.search(r'\bFROM\s+"?change_log"?', statement):
            seen.append((statement, parameters))

    event.listen(engine.sync_engine, "before_cursor_execute", record)
    try:
        yield seen
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", record)


def dates_in(parameters) -> set[date]:
    values = parameters.values() if isinstance(parameters, dict) else parameters
    return {value for value in values if type(value) is date}


# --- the query ---


async def test_coverage_asks_the_log_about_the_candidate_months_only(db, engine, monkeypatch):
    """July is history (before the adoption month), August was closed, October has no spending:
    September — the one uncertified month with spending — is the only candidate."""
    on(monkeypatch, date(2026, 10, 3))
    db.add(MonthReviewAdoption(id=1, adopted_on=date(2026, 8, 12)))
    await rent(db, JUL, AUG, SEP)
    db.add(MonthReview(month=AUG, closed_at=datetime(2026, 9, 10, tzinfo=UTC)))
    db.add_all([NetWorthSnapshot(month=m, recorded_on=m) for m in (JUL, AUG, SEP, OCT)])
    await db.commit()
    asked: list[list[date]] = []
    real = month_status.load_spending_evidence

    async def spy(session, candidates):
        asked.append(list(candidates))
        return await real(session, candidates)

    monkeypatch.setattr(month_status, "load_spending_evidence", spy)
    with change_log_statements(engine) as statements:
        await load_coverage(db)
    assert asked == [[SEP]]
    assert len(statements) == 1  # ONE query against the log
    ((_, parameters),) = statements
    assert dates_in(parameters) == {SEP}  # the IN list carries the candidates, nothing else


async def test_no_candidates_no_query(db, engine, monkeypatch):
    on(monkeypatch, date(2026, 10, 3))
    await rent(db, AUG)
    db.add(MonthReviewAdoption(id=1, adopted_on=date(2026, 9, 12)))  # August is history
    db.add(NetWorthSnapshot(month=AUG, recorded_on=AUG))
    await db.commit()
    with change_log_statements(engine) as statements:
        await load_coverage(db)
    assert statements == []


# --- the spending-state table (spec §K3), one test each ---


@pytest.fixture
async def september(db):
    """The copy's September: Sep 1 balances, adopted on Sep 12 (so September is not history),
    rent on file, no take-home."""
    db.add(MonthReviewAdoption(id=1, adopted_on=date(2026, 9, 12)))
    db.add(NetWorthSnapshot(month=SEP, recorded_on=SEP))
    category = await rent(db, SEP)
    await db.commit()
    return category


async def state(db, month: date = SEP) -> str:
    return (await load_coverage(db)).status.spending_state(month)


async def test_rent_saved_sep_5_reads_partial_on_oct_1(db, september, monkeypatch):
    log(db, at=pt(2026, 9, 5), month=SEP)
    await db.commit()
    on(monkeypatch, date(2026, 10, 1))
    assert await state(db) == "partial"


async def put_september(auth_client, **body) -> dict:
    """One month-review PUT for September through the real route, with a fresh request_id — as
    the wizard sends on every save (it is what makes the metadata row change, and so log)."""
    current = (await auth_client.get(f"/api/v1/month-review/months/{SEP}")).json()
    response = await auth_client.put(
        f"/api/v1/month-review/months/{SEP}",
        json={"expected_revision": current["input_revision"], "request_id": str(uuid4()), **body},
    )
    assert response.status_code == 200, response.text
    return response.json()


TICKED = {"balances": False, "spending": True, "take_home": False}


async def test_take_home_saved_oct_1_with_the_box_ticked_stays_partial_until_confirmed(
    auth_client, db, september, monkeypatch
):
    """Spec decision 16, K3 table row 2 and M1: a take-home save never completes spending — not
    even when its body carries reviewed.spending=true, a tick the wizard still holds. That save
    logs month_reviews beside monthly_cashflow in one batch; only the Confirm, a PUT with no legs
    (a batch that writes nothing else for the month), completes it."""
    log(db, at=pt(2026, 9, 5), month=SEP)
    await db.commit()
    on(monkeypatch, date(2026, 10, 1))
    await put_september(
        auth_client,
        spending={
            "amounts": [{"category_id": september.id, "amount": "2072.23"}],  # unchanged
            "net_pay": "6000.00",
        },
        reviewed=TICKED,
    )
    status = (await load_coverage(db)).status
    assert (status.spending_state(SEP), status.take_home_entered(SEP)) == ("partial", True)
    await put_september(auth_client, reviewed=TICKED)  # the Confirm: no legs
    assert await state(db) == "entered"


async def test_a_spending_save_on_oct_3_enters_it(db, september, monkeypatch):
    log(db, at=pt(2026, 9, 5), month=SEP)
    log(db, at=pt(2026, 10, 3, 9), month=SEP, op="update")
    await db.commit()
    on(monkeypatch, date(2026, 10, 3))
    assert await state(db) == "entered"


async def test_that_oct_3_save_then_undone_is_partial_again(
    auth_client, db, september, monkeypatch
):
    """Through the real routes: the pinned day stamps the save (clock.change_stamp), and the
    Activity undo marks its batch undone (changelog.undone_by)."""
    log(db, at=pt(2026, 9, 5), month=SEP)
    await db.commit()
    on(monkeypatch, date(2026, 10, 3))
    current = (await auth_client.get(f"/api/v1/month-review/months/{SEP}")).json()
    saved = await auth_client.put(
        f"/api/v1/month-review/months/{SEP}",
        json={
            "expected_revision": current["input_revision"],
            "spending": {"amounts": [{"category_id": september.id, "amount": "2150.00"}]},
        },
    )
    assert saved.status_code == 200, saved.text
    assert await state(db) == "entered"
    undone = await auth_client.post(f"/api/v1/activity/batches/{saved.json()['batch_id']}/undo")
    assert undone.status_code == 200, undone.text
    assert await state(db) == "partial"


async def test_a_no_change_confirm_on_oct_2_enters_it(auth_client, db, september, monkeypatch):
    """M1's "Confirm September spending is complete": a PUT with no legs whose `reviewed`
    ticks spending. It logs a month_reviews write — clause (d)'s evidence."""
    log(db, at=pt(2026, 9, 5), month=SEP)
    await db.commit()
    on(monkeypatch, date(2026, 10, 2))
    current = (await auth_client.get(f"/api/v1/month-review/months/{SEP}")).json()
    confirmed = await auth_client.put(
        f"/api/v1/month-review/months/{SEP}",
        json={
            "expected_revision": current["input_revision"],
            "reviewed": {"balances": False, "spending": True, "take_home": False},
        },
    )
    assert confirmed.status_code == 200, confirmed.text
    time = (await auth_client.get("/api/v1/coverage")).json()["time"]
    # Still due for its take-home, but its spending now reads entered.
    assert [(p["month"], p["spending"]) for p in time["flows_due"]] == [("2026-09-01", "entered")]


async def test_a_spending_tick_saved_sep_30_is_still_partial(
    auth_client, db, september, monkeypatch
):
    """The same no-leg PUT as the Confirm, but on Sep 30 — while September is still running."""
    log(db, at=pt(2026, 9, 5), month=SEP)
    await db.commit()
    on(monkeypatch, date(2026, 9, 30))
    await put_september(auth_client, reviewed=TICKED)
    on(monkeypatch, date(2026, 10, 5))
    assert await state(db) == "partial"


async def test_a_save_at_17_30_pt_on_sep_30_is_still_september(db, september, monkeypatch):
    log(db, at=pt(2026, 9, 5), month=SEP)
    # 00:30 UTC on Oct 1 is 17:30 PT on Sep 30: the product day, not the UTC day, decides.
    log(db, at=datetime(2026, 10, 1, 0, 30, tzinfo=UTC), month=SEP, op="update")
    await db.commit()
    on(monkeypatch, date(2026, 10, 5))
    assert await state(db) == "partial"


async def test_a_closed_month_edited_since_is_entered(db, september, monkeypatch):
    db.add(MonthReview(month=SEP, closed_at=datetime(2026, 10, 2, tzinfo=UTC)))
    log(db, at=pt(2026, 9, 5), month=SEP)
    log(db, at=pt(2026, 10, 1), month=SEP, op="update")
    await db.commit()
    on(monkeypatch, date(2026, 10, 5))
    assert await state(db) == "entered"


async def test_a_month_before_the_adoption_month_is_entered(db, september, monkeypatch):
    category = (await db.execute(select(SpendingCategory))).scalars().one()
    db.add(MonthlySpending(month=AUG, category_id=category.id, amount=Decimal("2000.00")))
    log(db, at=pt(2026, 8, 5), month=AUG)  # saved during August — but August is history
    await db.commit()
    on(monkeypatch, date(2026, 10, 5))
    assert await state(db, AUG) == "entered"


async def test_a_month_with_no_change_log_rows_is_entered(db, september, monkeypatch):
    on(monkeypatch, date(2026, 10, 5))
    assert await state(db) == "entered"


async def test_an_import_summary_line_dated_oct_2_enters_it(db, september, monkeypatch):
    log(db, at=pt(2026, 9, 5), month=SEP)
    log(
        db,
        at=pt(2026, 10, 2),
        month=None,
        table="*",
        op="batch",
        source="import",
        after={"sheets": {}},
    )
    await db.commit()
    on(monkeypatch, date(2026, 10, 5))
    assert await state(db) == "entered"


async def test_no_non_zero_amount_and_no_confirmed_zero_is_missing(db, monkeypatch):
    db.add(MonthReviewAdoption(id=1, adopted_on=date(2026, 9, 12)))
    db.add(NetWorthSnapshot(month=SEP, recorded_on=SEP))
    await rent(db, SEP, amount="0.00")
    await db.commit()
    on(monkeypatch, date(2026, 10, 5))
    assert await state(db) == "missing"


async def test_an_undone_confirm_leaves_it_partial(auth_client, db, september, monkeypatch):
    """M1's Confirm is change-logged like any PUT: its Undo marks the batch undone, and clause
    (d) stops counting it — September reads partial again."""
    log(db, at=pt(2026, 9, 5), month=SEP)
    await db.commit()
    on(monkeypatch, date(2026, 10, 2))
    current = (await auth_client.get(f"/api/v1/month-review/months/{SEP}")).json()
    confirmed = await auth_client.put(
        f"/api/v1/month-review/months/{SEP}",
        json={
            "expected_revision": current["input_revision"],
            "reviewed": {"balances": False, "spending": True, "take_home": False},
        },
    )
    assert confirmed.status_code == 200, confirmed.text
    assert await state(db) == "entered"
    undone = await auth_client.post(f"/api/v1/activity/batches/{confirmed.json()['batch_id']}/undo")
    assert undone.status_code == 200, undone.text
    assert await state(db) == "partial"


async def test_a_redone_save_counts_again(auth_client, db, september, monkeypatch):
    """Undo of an Undo (review minor 2): the Oct 3 save's effect stands again, so its batch counts
    again — follow undone_by until it is stable; an even number of undos means in force."""
    log(db, at=pt(2026, 9, 5), month=SEP)
    await db.commit()
    on(monkeypatch, date(2026, 10, 3))
    saved = await put_september(
        auth_client, spending={"amounts": [{"category_id": september.id, "amount": "2150.00"}]}
    )
    assert await state(db) == "entered"
    undo = await auth_client.post(f"/api/v1/activity/batches/{saved['batch_id']}/undo")
    assert undo.status_code == 200, undo.text
    assert await state(db) == "partial"
    redo = await auth_client.post(f"/api/v1/activity/batches/{undo.json()['batch_id']}/undo")
    assert redo.status_code == 200, redo.text
    assert (await db.execute(select(MonthlySpending.amount))).scalar_one() == Decimal("2150.00")
    assert await state(db) == "entered"
    again = await auth_client.post(f"/api/v1/activity/batches/{redo.json()['batch_id']}/undo")
    assert again.status_code == 200, again.text
    assert await state(db) == "partial"  # three undos: undone again


async def test_all_zero_rows_count_as_spending_only_with_a_matching_confirmation(db, monkeypatch):
    """Review minor 4: K3's "spending" is a non-zero amount OR a confirmed zero — through
    load_coverage, not a hand-built set. The same all-$0 rows read missing without the review's
    confirmation and entered with one (no log rows: clause (b))."""
    db.add(MonthReviewAdoption(id=1, adopted_on=date(2026, 9, 12)))
    db.add(NetWorthSnapshot(month=SEP, recorded_on=SEP))
    await rent(db, SEP, amount="0.00")
    await db.commit()
    on(monkeypatch, date(2026, 10, 5))
    assert await state(db) == "missing"
    book = await load_review_book(db, extra_months=[SEP])
    db.add(
        MonthReview(
            month=SEP,
            zero_spending_confirmed=True,
            confirmation_revision=book.months[SEP].input_revision,
        )
    )
    await db.commit()
    assert await state(db) == "entered"
    # A stale confirmation no longer counts: a second $0 row moves the month's digest.
    food = SpendingCategory(name="Food", slug="food", sort_order=2)
    db.add(food)
    await db.flush()
    db.add(MonthlySpending(month=SEP, category_id=food.id, amount=Decimal("0.00")))
    await db.commit()
    assert await state(db) == "missing"
