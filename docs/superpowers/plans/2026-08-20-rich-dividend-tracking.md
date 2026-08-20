# Rich Dividend Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every price refresh automatically ingests real dividend events (per-share × shares held on the ex-date, per account) into `dividend_payments` as refresh-owned `source='auto'` rows; the importer's never-writes-dividends behavior becomes a pinned contract; the Dividends tab gains income analytics.

**Architecture:** The provider already returns per-day dividend events on every bar (`DailyBar.dividend`) — `refresh_prices` starts collecting them per security, and a new `dividend_ingest` service (called from `run_refresh`, savepoint-isolated like the value snapshot) folds shares-as-of each event date from the existing transaction fold and upserts one row per `(security, account, ex_date)` under a partial unique index. Manual rows are never touched; in-window auto rows self-heal.

**Tech Stack:** FastAPI + async SQLAlchemy + Alembic (one additive migration, chained on `705ec03f614f`), pydantic v2 (Decimals wire as JSON strings), React 19 + TS + vitest, echarts via the existing pure-builder pattern.

**Spec:** `docs/superpowers/specs/2026-08-20-rich-dividend-tracking-design.md`

**Binding rules (from the repo's global conventions — read before any task):**
1. Implementation subagents run on **Opus** (standing user mandate).
2. Decimal discipline: server figures render verbatim on the frontend; `Number()` display-only.
3. New migration chains on head `705ec03f614f`; `alembic check` clean (run with `cwd=backend`); never edit shipped revisions.
4. pytest `-W error` clean; frontend gates: `npm run test`, `npm run lint` (1 sanctioned AuthContext warning), `npm run build`.
5. Backend tests need the Postgres container: `docker start finance-dashboard-db-1` (test DB `finance_test` is conftest-rebuilt via `Base.metadata.create_all` — which is why the partial index MUST live on the model, not only in the migration).
6. Comments explain constraints, not narration; match the house's comment register.

---

### Task 1: Model columns, migration, wire schemas

**Files:**
- Modify: `backend/app/models/portfolio.py` (DividendPayment + DIVIDEND_SOURCES)
- Create: `backend/alembic/versions/20260820_1200_b3d47a1c9e62_dividend_source_and_auto_event_columns.py`
- Modify: `backend/app/schemas/portfolio.py` (DividendOut, RefreshOut, LastRefreshOut)
- Test: `backend/tests/test_models_portfolio.py` (extend)

- [x] **Step 1: Extend the model.** In `backend/app/models/portfolio.py`, add `Index` and `text` to the sqlalchemy import, add a sources tuple next to `TRANSACTION_SOURCES`, and extend `DividendPayment`:

```python
DIVIDEND_SOURCES = ("manual", "auto")
```

```python
class DividendPayment(Base):
    __tablename__ = "dividend_payments"
    __table_args__ = (
        # The auto-ingest idempotency key: one row per (security, account, event date)
        # for refresh-written rows. Partial — manual rows stay unconstrained, and the
        # index must live HERE (not only in the migration) because the test database is
        # built by Base.metadata.create_all.
        Index(
            "ux_dividend_auto_event",
            "security_id",
            "account",
            "ex_date",
            unique=True,
            postgresql_where=text("source = 'auto'"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    security_id: Mapped[int] = mapped_column(ForeignKey("securities.id", ondelete="CASCADE"))
    account: Mapped[str | None] = mapped_column(String(80))
    pay_date: Mapped[date] = mapped_column(Date)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    # Ownership contract (the transactions `source` precedent, user decision 2026-08-20):
    # the refresh owns source='auto' rows inside its 370-day window; the importer never
    # writes dividends at all (pinned in tests); manual rows are the user's alone.
    source: Mapped[str] = mapped_column(String(10), default="manual", server_default="manual")
    # The event date (auto rows always carry it; pay_date on auto rows equals it — Yahoo's
    # chart feed has no payment date, an honest documented approximation).
    ex_date: Mapped[date | None] = mapped_column(Date)
    per_share: Mapped[Decimal | None] = mapped_column(Numeric(10, 6))
    shares_held: Mapped[Decimal | None] = mapped_column(Numeric(16, 6))
    notes: Mapped[str | None] = mapped_column(Text)
```

- [x] **Step 2: Write the migration** at `backend/alembic/versions/20260820_1200_b3d47a1c9e62_dividend_source_and_auto_event_columns.py`:

```python
"""dividend source and auto-event columns

Revision ID: b3d47a1c9e62
Revises: 705ec03f614f
Create Date: 2026-08-20 12:00:00
"""

import sqlalchemy as sa
from alembic import op

revision = "b3d47a1c9e62"
down_revision = "705ec03f614f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "dividend_payments",
        sa.Column("source", sa.String(length=10), server_default="manual", nullable=False),
    )
    op.add_column("dividend_payments", sa.Column("ex_date", sa.Date(), nullable=True))
    op.add_column("dividend_payments", sa.Column("per_share", sa.Numeric(10, 6), nullable=True))
    op.add_column(
        "dividend_payments", sa.Column("shares_held", sa.Numeric(16, 6), nullable=True)
    )
    op.create_index(
        "ux_dividend_auto_event",
        "dividend_payments",
        ["security_id", "account", "ex_date"],
        unique=True,
        postgresql_where=sa.text("source = 'auto'"),
    )


def downgrade() -> None:
    op.drop_index("ux_dividend_auto_event", table_name="dividend_payments")
    op.drop_column("dividend_payments", "shares_held")
    op.drop_column("dividend_payments", "per_share")
    op.drop_column("dividend_payments", "ex_date")
    op.drop_column("dividend_payments", "source")
```

- [x] **Step 3: Extend the wire schemas** in `backend/app/schemas/portfolio.py`. `DividendCreate`/`DividendUpdate` are deliberately NOT extended — auto columns are the refresh's alone:

```python
class DividendOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    security_id: int
    account: str | None
    pay_date: date
    amount: Decimal
    source: str
    ex_date: date | None
    per_share: Decimal | None
    shares_held: Decimal | None
    notes: str | None
```

```python
class RefreshOut(BaseModel):
    updated: list[str]
    failed: dict[str, str]
    skipped_manual: list[str]
    duration_ms: int
    dividends_ingested: int
```

`LastRefreshOut` gains three optional fields (pre-feature stored payloads lack the keys and must still validate — the status endpoint's degrade posture):

```python
    dividends_ingested: int | None = None
    dividends_removed: int | None = None
    dividends_skipped_overlap: int | None = None
```

- [x] **Step 4: Extend the model test.** In `backend/tests/test_models_portfolio.py`, add (match the file's existing fixture idioms — it inserts via `db`):

```python
async def test_dividend_source_defaults_manual_and_auto_key_is_unique(db):
    from sqlalchemy.exc import IntegrityError

    sec = Security(ticker="DIVX", name="Div X", holding_type="stock")
    db.add(sec)
    await db.commit()
    row = DividendPayment(security_id=sec.id, pay_date=date(2026, 3, 20), amount=Decimal("10.00"))
    db.add(row)
    await db.commit()
    assert row.source == "manual" and row.ex_date is None

    auto_kwargs = dict(
        security_id=sec.id,
        account="RH Taxable",
        pay_date=date(2026, 3, 20),
        amount=Decimal("12.00"),
        source="auto",
        ex_date=date(2026, 3, 20),
        per_share=Decimal("0.820000"),
        shares_held=Decimal("14.634146"),
    )
    db.add(DividendPayment(**auto_kwargs))
    await db.commit()
    # Same (security, account, ex_date) auto key must be refused by the partial index…
    db.add(DividendPayment(**auto_kwargs))
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()
    # …while a second MANUAL row on the same coordinates is fine (index is partial).
    db.add(
        DividendPayment(
            security_id=sec.id,
            account="RH Taxable",
            pay_date=date(2026, 3, 20),
            amount=Decimal("12.00"),
        )
    )
    await db.commit()
```

- [x] **Step 5: Run the tests and gates**

Run: `cd backend && .venv/Scripts/python.exe -m pytest tests/test_models_portfolio.py -q`
Expected: PASS (new test included). Then `.venv/Scripts/python.exe -m ruff check .` → clean, and `alembic check` (cwd=backend, dev DB up and migrated with `alembic upgrade head`) → "No new upgrade operations detected".

- [x] **Step 6: Commit** — `git add -A && git commit -m "feat: dividend source/ex_date/per_share/shares_held columns + auto-event partial unique index"`

---

### Task 2: Collect dividend events during the refresh

**Files:**
- Modify: `backend/app/services/price_service.py` (RefreshResult + the loop)
- Test: `backend/tests/test_price_service.py` (extend)

- [x] **Step 1: Extend `RefreshResult`** (top of `price_service.py`; `DailyBar` is already imported):

```python
@dataclass
class RefreshResult:
    updated: list[str] = field(default_factory=list)
    failed: dict[str, str] = field(default_factory=dict)
    skipped_manual: list[str] = field(default_factory=list)
    # Per-security dividend events seen in this run's bars (updated tickers only) —
    # run_refresh hands them to dividend_ingest so the Yahoo fetch happens exactly once.
    dividend_events: dict[int, list[DailyBar]] = field(default_factory=dict)
```

- [x] **Step 2: Collect events in the loop.** In `refresh_prices`, immediately after the existing `_update_dividend_metadata(security, bars, today)` line:

```python
        events = [b for b in bars if b.dividend > 0]
        if events:
            result.dividend_events[security.id] = events
```

(`bars` is already date-deduped and close-bounded at this point; the per-share dividend bound is the ingest service's job.)

- [x] **Step 3: Extend the service test.** `backend/tests/test_price_service.py` already has a fake provider returning `DailyBar`s — add a test in its idiom:

```python
async def test_refresh_collects_dividend_events_for_updated_tickers_only(db, ...):
    # Arrange (reuse the file's fake-provider fixture pattern): one active auto-priced
    # security whose bars carry two dividend events and one zero-dividend bar, plus one
    # ticker the provider fails.
    ...
    result = await refresh_prices(db, provider, today=TODAY)
    events = result.dividend_events[good_security.id]
    assert [(b.bar_date, b.dividend) for b in events] == [
        (date(2026, 3, 20), Decimal("0.8200")),
        (date(2026, 6, 19), Decimal("0.8200")),
    ]
    assert failed_security.id not in result.dividend_events
```

Fill the `...` from the file's existing fixtures (`FakeProvider`-style classes and seeded securities are already there — mirror the nearest existing test's arrange block verbatim).

- [x] **Step 4: Run** `cd backend && .venv/Scripts/python.exe -m pytest tests/test_price_service.py -q` → PASS.

- [x] **Step 5: Commit** — `git commit -am "feat: refresh collects per-security dividend events from the bars it already fetched"`

---

### Task 3: The ingest service

**Files:**
- Create: `backend/app/services/dividend_ingest.py`
- Test: `backend/tests/test_dividend_ingest.py` (new)

- [ ] **Step 1: Write the service** (complete file):

```python
"""Automatic dividend ingestion — the refresh's dividend leg.

THE OWNERSHIP CONTRACT (user decision 2026-08-20): the dashboard is the system of record
for dividends. The importer never writes dividend_payments (pinned in
tests/test_importer_apply.py); this module owns rows with source='auto' whose ex_date
falls inside the refresh window, and ONLY for securities that returned bars this run —
it upserts them to match the live book and deletes the ones the book or feed no longer
supports. Manual rows (source='manual') are never touched here.

Amounts: per-share event × shares held ON the ex-date, one row per (security, account).
Shares-on-a-date reuses fold_transactions over the subset of transactions effective by
then — a dateless (sheet-era) row predates the import by construction and counts as
held-from-the-beginning; dated rows apply from their date, splits included (a dated
split after the ex-date must not retroactively scale that dividend). Per-account rows
quantize independently, so a multi-account position's cents can disagree with the
whole-position product by a cent — each row is its own record.
"""

import logging
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import delete, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import DividendPayment, PositionTransaction
from app.services.portfolio_calc import SHARE_Q, fold_transactions
from app.services.price_provider import DailyBar
from app.services.price_service import DIVIDEND_MAX_ABS, HISTORY_WINDOW_DAYS

logger = logging.getLogger(__name__)

MONEY_Q = Decimal("0.01")
# A manual row this close to an event's ex-date is almost certainly the user's own
# record of the same dividend (quarterly spacing is ~91 days, so ±14 cannot straddle two
# events): the whole event is skipped for that security rather than double-counted.
# Deleting the manual row lets auto take over on the next run.
MANUAL_OVERLAP_DAYS = 14


@dataclass
class DividendIngestResult:
    ingested: int = 0  # new auto rows
    updated: int = 0  # existing auto rows rewritten (idempotent re-runs land here)
    removed: int = 0  # in-window auto rows the book/feed no longer supports
    skipped_manual_overlap: int = 0  # whole events skipped because a manual row overlaps


def shares_on(txns: list[PositionTransaction], as_of: date) -> dict[tuple[int, str], Decimal]:
    """Folded shares per (security_id, account) counting only transactions effective by
    `as_of` — dateless rows always, dated rows when txn_date <= as_of. Fold warnings are
    ignored here: only the share counts matter."""
    effective = [t for t in txns if t.txn_date is None or t.txn_date <= as_of]
    return {
        key: pos.shares.quantize(SHARE_Q, rounding=ROUND_HALF_UP)
        for key, pos in fold_transactions(effective).items()
    }


async def ingest_dividends(
    db: AsyncSession, events_by_security: dict[int, list[DailyBar]], *, today: date
) -> DividendIngestResult:
    """Upsert auto dividend rows for this run's events; self-heal in-window auto rows of
    exactly the securities that reported bars. Caller commits, and the caller isolates
    failures behind a savepoint (run_refresh) — this function assumes nothing about
    either."""
    result = DividendIngestResult()
    if not events_by_security:
        return result
    window_start = today - timedelta(days=HISTORY_WINDOW_DAYS)

    txns = list(
        (
            await db.execute(
                select(PositionTransaction).order_by(
                    PositionTransaction.sort_index, PositionTransaction.id
                )
            )
        ).scalars()
    )
    existing = {
        (row.security_id, row.account, row.ex_date): row
        for row in (
            await db.execute(
                select(DividendPayment).where(
                    DividendPayment.source == "auto",
                    DividendPayment.ex_date >= window_start,
                    DividendPayment.security_id.in_(events_by_security.keys()),
                )
            )
        ).scalars()
    }
    manual_dates: dict[int, list[date]] = {}
    for sec_id, pay_date in (
        await db.execute(
            select(DividendPayment.security_id, DividendPayment.pay_date).where(
                DividendPayment.source == "manual",
                DividendPayment.security_id.in_(events_by_security.keys()),
            )
        )
    ).all():
        manual_dates.setdefault(sec_id, []).append(pay_date)

    # One fold per DISTINCT event date across all securities (a handful of dates × tens
    # of transactions — cheap by construction).
    event_dates = sorted(
        {
            b.bar_date
            for bars in events_by_security.values()
            for b in bars
            if b.bar_date >= window_start
        }
    )
    holdings_by_date = {d: shares_on(txns, d) for d in event_dates}

    desired: dict[tuple[int, str, date], dict] = {}
    overlap = timedelta(days=MANUAL_OVERLAP_DAYS)
    for sec_id, bars in events_by_security.items():
        # De-dup by date (last wins) and bound the per-share amount — the provider
        # contract promises neither (refresh_prices' own posture for closes).
        events = {
            b.bar_date: b
            for b in bars
            if b.bar_date >= window_start and 0 < b.dividend < DIVIDEND_MAX_ABS
        }
        for event_date, bar in events.items():
            if any(
                abs(pay_date - event_date) <= overlap
                for pay_date in manual_dates.get(sec_id, [])
            ):
                result.skipped_manual_overlap += 1
                continue
            for (pos_sec_id, account), shares in holdings_by_date[event_date].items():
                if pos_sec_id != sec_id or shares <= 0:
                    continue
                amount = (shares * bar.dividend).quantize(MONEY_Q, rounding=ROUND_HALF_UP)
                if amount == 0:
                    continue  # fractional dust rounds to no money
                desired[(sec_id, account, event_date)] = {
                    "security_id": sec_id,
                    "account": account,
                    # Honest approximation: Yahoo's chart feed carries no payment date.
                    "pay_date": event_date,
                    "amount": amount,
                    "source": "auto",
                    "ex_date": event_date,
                    "per_share": bar.dividend,
                    "shares_held": shares,
                    "notes": None,
                }

    # Self-heal: in-window auto rows of THIS run's securities that the run no longer
    # produces — the event left the feed, the holding became 0 after a transaction fix,
    # or a manual row now overlaps (manual wins; the auto duplicate removes itself).
    stale_ids = [row.id for key, row in existing.items() if key not in desired]
    if stale_ids:
        await db.execute(delete(DividendPayment).where(DividendPayment.id.in_(stale_ids)))
        result.removed = len(stale_ids)

    if desired:
        stmt = pg_insert(DividendPayment).values(list(desired.values()))
        await db.execute(
            stmt.on_conflict_do_update(
                index_elements=["security_id", "account", "ex_date"],
                index_where=text("source = 'auto'"),
                set_={
                    "pay_date": stmt.excluded.pay_date,
                    "amount": stmt.excluded.amount,
                    "per_share": stmt.excluded.per_share,
                    "shares_held": stmt.excluded.shares_held,
                },
            )
        )
        result.ingested = sum(1 for key in desired if key not in existing)
        result.updated = len(desired) - result.ingested
    if result.ingested or result.removed or result.skipped_manual_overlap:
        logger.info(
            "dividend ingest: %d new, %d rewritten, %d removed, %d skipped (manual overlap)",
            result.ingested,
            result.updated,
            result.removed,
            result.skipped_manual_overlap,
        )
    return result
```

- [ ] **Step 2: Write the unit tests** at `backend/tests/test_dividend_ingest.py`. Seed directly via the `db` fixture (no HTTP). Cover, each as its own test with hand-computed expectations:

```python
from datetime import date
from decimal import Decimal

from sqlalchemy import select

from app.models import DividendPayment, PositionTransaction, Security
from app.services.dividend_ingest import DividendIngestResult, ingest_dividends, shares_on
from app.services.price_provider import DailyBar

TODAY = date(2026, 8, 20)


def bar(day: date, dividend: str, close: str = "100.0000") -> DailyBar:
    return DailyBar(bar_date=day, close=Decimal(close), dividend=Decimal(dividend))


async def seed_security(db, ticker="DIVX") -> Security:
    sec = Security(ticker=ticker, name=f"{ticker} Corp", holding_type="stock")
    db.add(sec)
    await db.commit()
    return sec


def txn(sec_id, account, shares, *, txn_date=None, type_="buy", price="10.0000", sort_index=0):
    return PositionTransaction(
        security_id=sec_id, account=account, type=type_, txn_date=txn_date,
        shares=Decimal(shares), price=Decimal(price), sort_index=sort_index,
    )
```

Tests (write all of these; arrange with the helpers above):

1. `test_ingests_per_account_rows_with_exact_amounts` — dateless buy of 10 shares in "RH Taxable" + dated buy (2026-06-01) of 5 shares in "Fidelity" for the same security; one event `bar(2026-06-19, "0.8200")` → two rows: RH 10 × 0.82 = `8.20`, Fidelity 5 × 0.82 = `4.10`; each row has `source='auto'`, `ex_date == pay_date == event date`, `per_share == 0.8200`, `shares_held` exact.
2. `test_dated_transactions_after_event_do_not_count` — dated buy on 2026-07-01, event on 2026-06-19 → shares from the dateless base only.
3. `test_dated_split_after_event_does_not_scale_it` — dateless buy 10 sh; dated split ×2 on 2026-07-01; event 2026-06-19 → amount uses 10 shares; a second event on 2026-07-10 → 20 shares.
4. `test_idempotent_rerun_rewrites_not_duplicates` — run twice with identical events; second run: `ingested == 0`, `updated == N`, row count unchanged.
5. `test_manual_overlap_skips_whole_event` — manual row `pay_date=2026-06-25`, event 2026-06-19 (6 days) → no auto rows for that event, `skipped_manual_overlap == 1`; a second event 2026-03-20 (far away) still ingests.
6. `test_self_heal_removes_rows_the_book_no_longer_supports` — ingest once; delete the buy transaction; re-run with the same events → the auto rows are gone, `removed` counted; manual rows survive untouched.
7. `test_untouched_when_security_absent_from_events` — pre-existing in-window auto row for security B; run with events only for security A → B's row survives (failed/skipped tickers are not self-healed).
8. `test_zero_share_and_dust_amounts_skipped` — sold-out position (dateless buy + dateless sell, net 0) → no row; 0.001 shares × $0.01 → rounds to $0.00 → no row.
9. `test_window_boundary` — event older than `today - 370d` is ignored entirely (not ingested, not healed against).
10. `test_shares_on_dateless_counts_always` — direct unit test of `shares_on` mixing dateless/dated rows.

- [ ] **Step 3: Run** `cd backend && .venv/Scripts/python.exe -m pytest tests/test_dividend_ingest.py -q` → PASS (all 10).

- [ ] **Step 4: Commit** — `git commit -am "feat: dividend_ingest service — refresh-owned auto rows, per-account, idempotent, self-healing"`

---

### Task 4: Wire into run_refresh, record counts, expose them

**Files:**
- Modify: `backend/app/services/price_service.py` (`run_refresh`, `record_refresh_run`)
- Modify: `backend/app/services/scheduler.py:98` (3-tuple unpack)
- Modify: `backend/app/api/prices.py:43-49` (3-tuple + `dividends_ingested`)
- Test: `backend/tests/test_prices_api.py`, `backend/tests/test_price_service.py` (extend)

- [ ] **Step 1: `run_refresh` grows the ingest leg** (replace the current body; note the savepoint — a plain `db.rollback()` on ingest failure would also destroy the uncommitted value snapshot):

```python
async def run_refresh(
    db: AsyncSession, provider: PriceProvider, *, trigger: str, today: date | None = None
) -> tuple[RefreshResult, bool, "DividendIngestResult"]:
    """The whole refresh ritual, shared by the manual endpoint and the scheduled job so
    the two can never drift: refresh prices (commits itself), extend the live value
    series, ingest dividend events, record the outcome, commit the bookkeeping. Snapshot
    and ingest failures each degrade alone — the price refresh always stands."""
    from app.services.dividend_ingest import DividendIngestResult, ingest_dividends
    from app.services.value_history import append_value_snapshot

    today = today or date.today()
    result = await refresh_prices(db, provider, today=today)
    appended = False
    try:
        appended = await append_value_snapshot(db, today=today)
    except Exception:
        logger.exception("value snapshot failed — the price refresh stands")
        await db.rollback()
    dividends = DividendIngestResult()
    try:
        # Savepoint, not rollback-on-failure: a rollback here would also destroy the
        # uncommitted value snapshot above; the savepoint isolates the ingest alone.
        async with db.begin_nested():
            dividends = await ingest_dividends(db, result.dividend_events, today=today)
    except Exception:
        logger.exception("dividend ingest failed — the price refresh stands")
        dividends = DividendIngestResult()
    await record_refresh_run(
        db,
        result,
        trigger=trigger,
        history_appended=appended,
        at=datetime.now(UTC),
        dividends=dividends,
    )
    await db.commit()
    return result, appended, dividends
```

- [ ] **Step 2: `record_refresh_run` records the counts** — add the parameter and three payload keys:

```python
async def record_refresh_run(
    db: AsyncSession,
    result: RefreshResult,
    *,
    trigger: str,
    history_appended: bool,
    at: datetime,
    dividends: "DividendIngestResult | None" = None,
) -> None:
```

and inside `payload`:

```python
        "dividends_ingested": dividends.ingested if dividends is not None else 0,
        "dividends_removed": dividends.removed if dividends is not None else 0,
        "dividends_skipped_overlap": (
            dividends.skipped_manual_overlap if dividends is not None else 0
        ),
```

(Type the forward ref via `from __future__` or a `TYPE_CHECKING` import — match the module's existing style; a lazy runtime import inside `run_refresh` already exists.)

- [ ] **Step 3: Update both call sites.**
`backend/app/services/scheduler.py` `_refresh_job`: `result, appended, dividends = await run_refresh(db, provider, trigger=trigger_label)` and extend the log line with `%d dividends` / `dividends.ingested`.
`backend/app/api/prices.py` `refresh`: `result, _appended, dividends = await run_refresh(db, get_provider(), trigger="manual")` and add `dividends_ingested=dividends.ingested` to the `RefreshOut(...)` construction.

- [ ] **Step 4: Extend the tests.**
- `test_price_service.py`: the existing `run_refresh` tests unpack a 2-tuple — update to 3; add `test_run_refresh_records_dividend_counts` asserting the stored `last_refresh` payload carries the three keys with the fake provider's event math, and `test_ingest_failure_degrades_and_preserves_snapshot` (monkeypatch `ingest_dividends` to raise; assert refresh + snapshot committed, payload has zeros).
- `test_prices_api.py`: `POST /prices/refresh` response carries `dividends_ingested`; `GET /prices/refresh-status` echoes the three counts, and a stored PRE-FEATURE payload (write one without the keys) still validates with `None`s.

- [ ] **Step 5: Run** `cd backend && .venv/Scripts/python.exe -m pytest tests/test_price_service.py tests/test_prices_api.py tests/test_scheduler.py -q` → PASS.

- [ ] **Step 6: Commit** — `git commit -am "feat: run_refresh ingests dividends, records and exposes the counts"`

---

### Task 5: Pin the importer ownership contract

**Files:**
- Test: `backend/tests/test_importer_apply.py` (extend — test only, no production code)

- [ ] **Step 1: Write the pin test** (uses the file's existing `sheets()` helper and apply functions; imports `DividendPayment` and the remaining parse/apply pairs the file already imports):

```python
async def test_importer_never_writes_dividends(db):
    """THE OWNERSHIP CONTRACT (user decision 2026-08-20): the dashboard is the system of
    record for dividends — a re-import must not create, update, or delete ANY
    dividend_payments row, manual or auto. If a future importer change touches
    dividends, this is the test that must be argued with."""
    wb = sheets()
    report = SheetReport()
    by_name = await apply_reference_data(db, parse_reference_data(wb["ReferenceData"]), report)
    await apply_positions(db, parse_positions(wb["Positions"]), by_name, report)
    await apply_net_worth(db, parse_net_worth(wb["Net Worth"]), report)
    await apply_spending(db, parse_spending(wb["Spending"]), report)
    await apply_portfolio_history(db, parse_portfolio(wb["Portfolio"]), report)
    await db.commit()

    sec = (await db.execute(select(Security))).scalars().first()
    manual = DividendPayment(
        security_id=sec.id, pay_date=date(2026, 5, 1), amount=Decimal("12.34")
    )
    auto = DividendPayment(
        security_id=sec.id,
        account="RH Taxable",
        pay_date=date(2026, 6, 19),
        amount=Decimal("8.20"),
        source="auto",
        ex_date=date(2026, 6, 19),
        per_share=Decimal("0.820000"),
        shares_held=Decimal("10.000000"),
    )
    db.add_all([manual, auto])
    await db.commit()
    before = {
        row.id: (row.source, row.account, row.pay_date, row.amount, row.ex_date)
        for row in (await db.execute(select(DividendPayment))).scalars()
    }

    wb2 = sheets()
    report2 = SheetReport()
    by_name2 = await apply_reference_data(db, parse_reference_data(wb2["ReferenceData"]), report2)
    await apply_positions(db, parse_positions(wb2["Positions"]), by_name2, report2)
    await apply_net_worth(db, parse_net_worth(wb2["Net Worth"]), report2)
    await apply_spending(db, parse_spending(wb2["Spending"]), report2)
    await apply_portfolio_history(db, parse_portfolio(wb2["Portfolio"]), report2)
    await db.commit()

    after = {
        row.id: (row.source, row.account, row.pay_date, row.amount, row.ex_date)
        for row in (await db.execute(select(DividendPayment))).scalars()
    }
    assert after == before
    assert "dividend_payments" not in report2.entities
```

(If `report.entities` uses a different container shape, assert equivalently that no entity named `dividend_payments` was reported — check `SheetReport`'s definition in `app/importer/report.py` and match it.)

- [ ] **Step 2: Run** `cd backend && .venv/Scripts/python.exe -m pytest tests/test_importer_apply.py -q` → PASS.

- [ ] **Step 3: Commit** — `git commit -am "test: pin the importer's never-writes-dividends ownership contract"`

---

### Task 6: Frontend — types, Dividends tab analytics, source badges

**Files:**
- Modify: `src/types/api.ts` (DividendOut, LastRefresh, RefreshResult)
- Create: `src/components/portfolio/dividendChartOptions.ts`
- Create: `src/components/portfolio/dividendChartOptions.test.ts`
- Modify: `src/components/portfolio/DividendsPanel.tsx`
- Modify: `src/components/portfolio/DividendsPanel.test.tsx`
- Modify: `src/pages/PortfolioPage.tsx` (pass `annualIncome`; refresh note)

- [ ] **Step 1: Types.** In `src/types/api.ts`: `DividendOut` gains `source: string`, `ex_date: string | null`, `per_share: string | null`, `shares_held: string | null`. `LastRefresh` gains `dividends_ingested?: number | null`, `dividends_removed?: number | null`, `dividends_skipped_overlap?: number | null` (optional — stale-deploy armor). `RefreshResult` gains `dividends_ingested: number`.

- [ ] **Step 2: The income builder** at `src/components/portfolio/dividendChartOptions.ts` (pure, no React — `historyChartOptions.ts` posture):

```ts
// Pure option builder for the dividend income chart — no React, no fetching, no theme
// decisions of its own (historyChartOptions.ts posture). Number() is display-only.
import type { EChartsOption } from '../../charts/echarts'
import { PALETTE, SURFACE } from '../../charts/theme'
import type { DividendOut } from '../../types/api'
import { formatCurrency, formatCurrencyCompact, formatMonth } from '../../utils/format'
import { addMonths } from '../../utils/months'

export const INCOME_WINDOW_MONTHS = 24

/** Sums of `amount` by pay-date month over the trailing window, zero-filled so quiet
 * months read as quiet rather than absent. Returns null with no rows in the window —
 * the caller renders an empty note (house floor). `todayIso` injectable for tests. */
export function monthlyIncomeOption(
  dividends: DividendOut[],
  todayIso: string,
): EChartsOption | null {
  const end = `${todayIso.slice(0, 7)}-01`
  const start = addMonths(end, -(INCOME_WINDOW_MONTHS - 1))
  const sums = new Map<string, number>()
  for (const d of dividends) {
    const month = `${d.pay_date.slice(0, 7)}-01`
    if (month < start || month > end) continue
    sums.set(month, (sums.get(month) ?? 0) + Number(d.amount))
  }
  if (sums.size === 0) return null
  const months: string[] = []
  for (let m = start; m <= end; m = addMonths(m, 1)) months.push(m)
  return {
    grid: { left: 70, right: 16, top: 16, bottom: 28 },
    xAxis: { type: 'category', data: months.map(formatMonth) },
    yAxis: {
      type: 'value',
      axisLabel: { formatter: (v: number) => formatCurrencyCompact(v) },
    },
    tooltip: { trigger: 'axis', valueFormatter: (v) => formatCurrency(v as number) },
    series: [
      {
        type: 'bar',
        name: 'Dividends',
        barMaxWidth: 22,
        color: PALETTE[0],
        itemStyle: { borderColor: SURFACE, borderWidth: 1 },
        data: months.map((m) => Math.round((sums.get(m) ?? 0) * 100) / 100),
      },
    ],
  }
}

export interface IncomeStats {
  trailing12: number | null // sum of the last 12 months incl. the current one
  ytd: number | null // sum of the current calendar year
}

/** null = the log has no rows at all (dashes); 0 = rows exist but none in the window
 * (ytdStats' dividends convention). */
export function incomeStats(dividends: DividendOut[], todayIso: string): IncomeStats {
  if (dividends.length === 0) return { trailing12: null, ytd: null }
  const currentMonth = `${todayIso.slice(0, 7)}-01`
  const from12 = addMonths(currentMonth, -11)
  const yearPrefix = `${todayIso.slice(0, 4)}-`
  let trailing12 = 0
  let ytd = 0
  for (const d of dividends) {
    const month = `${d.pay_date.slice(0, 7)}-01`
    if (month >= from12 && month <= currentMonth) trailing12 += Number(d.amount)
    if (d.pay_date.startsWith(yearPrefix)) ytd += Number(d.amount)
  }
  return { trailing12, ytd }
}
```

- [ ] **Step 3: Builder tests** at `src/components/portfolio/dividendChartOptions.test.ts`: month bucketing sums two same-month rows; zero-fill (a month between two payments carries 0); window excludes a 25-month-old row; null with no rows; `incomeStats` trailing-12 boundary (a row exactly 12 months back counts, 13 back doesn't), YTD sum, null-vs-0 distinction. Use fixed `todayIso` strings — never `new Date()`.

- [ ] **Step 4: DividendsPanel upgrade.** Props gain `annualIncome: string | null` (the page passes `totals?.annual_income ?? null` — a server figure, rendered verbatim). Above the form, add the analytics block; in the table, add Source (badge, `auto`/`manual` — TransactionsPanel's badge idiom) and Per share (`per_share` with `shares_held` in a `.sub` span) columns; rewrite the hint. Skeleton of the changed JSX (state/handlers unchanged):

```tsx
      <p className="hint">
        Refreshes log dividends automatically for auto-priced tickers — rows marked{' '}
        <span className="badge">auto</span> are rewritten by refreshes, and deleting one
        brings it back next run. Manual entry remains for manual-priced holdings and
        history older than the refresh window. Auto amounts are recorded on the ex-date.
      </p>
      {(chart || stats.trailing12 !== null) && (
        <>
          <div className="kpi-row">
            <StatTile
              label="Trailing 12-mo income"
              value={stats.trailing12 === null ? '—' : formatCurrency(stats.trailing12)}
            />
            <StatTile
              label="YTD income"
              value={stats.ytd === null ? '—' : formatCurrency(stats.ytd)}
            />
            <StatTile
              label="Projected annual income"
              value={annualIncome === null ? '—' : formatCurrency(annualIncome)}
            />
          </div>
          {chart && <EChart option={chart} height={220} />}
        </>
      )}
```

with `const chart = useMemo(() => monthlyIncomeOption(dividends, todayIso()), [dividends])` and `const stats = incomeStats(dividends, todayIso())` (import `todayIso` from `../../utils/months`; memoize ONLY the chart option — the EChart notMerge rule). Table cells:

```tsx
                <td><span className="badge">{d.source === 'auto' ? 'auto' : 'manual'}</span></td>
                <td className="num">
                  {d.per_share === null ? '—' : formatCurrency(d.per_share)}
                  {d.shares_held !== null && (
                    <span className="sub"> × {formatShares(d.shares_held)}</span>
                  )}
                </td>
```

- [ ] **Step 5: PortfolioPage.** Pass `annualIncome={totals?.annual_income ?? null}` to `<DividendsPanel …>`. In `describeRefresh`, append the dividend clause to `text` when present: `(result.dividends_ingested > 0 ? `, ${result.dividends_ingested} dividends logged` : '')` — before the duration clause.

- [ ] **Step 6: Extend `DividendsPanel.test.tsx`** (mirror its existing render fixtures; every fixture `DividendOut` must gain the four new fields — `source: 'manual'`, nulls — or tsc fails, which is the point): badges render per row; tiles + chart section renders with rows and is absent on an empty log; hint names the resurrect rule. Extend the fixtures in `PortfolioPage`-adjacent tests only if tsc forces it (grep `DividendOut` fixtures repo-wide: `OverviewPage.test.tsx` carries them too).

- [ ] **Step 7: Run gates** — `npm run test`, `npm run lint`, `npm run build` → all green (lint's 1 sanctioned AuthContext warning only).

- [ ] **Step 8: Commit** — `git commit -am "feat: dividend income analytics, source badges, refresh note"`

---

### Task 7: Whole-feature gate + docs touch

- [ ] **Step 1: Full backend suite** — `cd backend && .venv/Scripts/python.exe -m pytest -q` → all green, no new warnings (`-W error` is configured). `ruff check .` clean. `alembic check` clean (cwd=backend against the migrated dev DB).
- [ ] **Step 2: Full frontend gates** — `npm run test && npm run lint && npm run build`.
- [ ] **Step 3: README touch** — README Part 7.6 gains a one-line addendum blockquote: the deploy carries migration `b3d47a1c9e62` (additive; auto-applies at boot) and the first refresh after it backfills ~a year of dividend rows automatically.
- [ ] **Step 4: Commit** — `git commit -am "docs: dividend tracking deploy note"`.

---

## Self-review notes (spec → plan)

- Spec §2 contract → Tasks 3 (refresh ownership + self-heal scope), 5 (importer pin), 6 (panel hint documents resurrect).
- Spec §3 schema → Task 1 exactly (columns, partial index, model-side Index for create_all).
- Spec §4 service semantics → Task 3 (fold-as-of, per-account, overlap skip, dedupe/bounds, window, dust).
- Spec §5 wiring → Tasks 2 + 4 (events on RefreshResult; savepoint isolation; payload keys; both call sites).
- Spec §6 API → Task 1 Step 3 + Task 4 Step 3 (DividendCreate untouched — checked).
- Spec §7 frontend → Task 6 (types, builder + stats, panel, page note; Overview untouched by design).
- Spec §8 tests → Tasks 1/2/3/4/5/6 test steps; §9 non-goals introduce no tasks (correct).
- Type consistency: `DividendIngestResult` fields used identically in Tasks 3/4; `dividend_events: dict[int, list[DailyBar]]` consistent in Tasks 2/3/4; `monthlyIncomeOption(dividends, todayIso)` signature consistent in Task 6 Steps 2/4.
