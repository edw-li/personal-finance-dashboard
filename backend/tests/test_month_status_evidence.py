"""K3's change-log evidence (2026-09-23 spec §K3): ONE indexed query over the candidate months
only — uncertified months with spending — plus undone batches from changelog.undone_by; and the
spending-state table, one test each, through the real evidence query."""

import re
from contextlib import contextmanager
from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import uuid4
from zoneinfo import ZoneInfo

from sqlalchemy import event

from app.models import ChangeLog, MonthlySpending, NetWorthSnapshot, SpendingCategory
from app.models.month_review import MonthReview, MonthReviewAdoption
from app.services import clock, month_status
from app.services.coverage import load_coverage

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
