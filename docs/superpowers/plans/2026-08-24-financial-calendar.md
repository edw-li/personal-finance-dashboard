# Financial Calendar (+ Announced Ex-Dividend Capture) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One forward-looking month-grid calendar for every date the app already computes or stores — RSU vests, ESPP purchase/qualifying/offering dates, announced ex-dividends, semi-monthly paydays, tax deadlines, the monthly-update reminder — plus an "Up next" strip on Overview and a client-side ICS export. The daily price refresh learns **announced** ex-dividend dates from the provider so upcoming ex-dividends exist at all (today's `ex_div_date` is always a *past* date).

**Architecture:** One additive migration (`securities.next_ex_div_date`, a new column — never an overload of `ex_div_date`); one new provider method (`fetch_next_ex_div`, the sole yfinance touchpoint's second verb); a refresh-integration leg in `price_service` (store future / clear past / last-good on failure, counts into the `LAST_REFRESH_KEY` blob); two new **pure** services (`business_days.py` owns the app's first holiday logic, `calendar_events.py` composes typed events from loaded inputs); one new router (`GET /calendar?start&end`, auth'd, 422-fenced, GET-never-rejects); a plain HTML/CSS month grid (no ECharts — chips need links), an accessible date-grouped list (also the mobile rendering), a fixed type→PALETTE-slot chip map, and a pure ICS builder with UID-stable all-day VEVENTs.

**Tech Stack:** FastAPI + SQLAlchemy 2 async + Alembic + Postgres 16 (real-DB pytest), React 19 + TypeScript + Vitest. No new dependencies (lucide-react already ships `CalendarDays` and `PiggyBank`).

**Spec:** `docs/superpowers/specs/2026-08-24-financial-calendar-design.md` — cite it for any ambiguity. The event-type table in its §5 is the composition contract; §3.3 is the refresh contract.

**Overnight protocol:** work happens in the git worktree `.worktrees/calendar` on branch `financial-calendar` (the orchestrator creates both; Task 0 only verifies). Every command in this plan runs from the worktree root (`C:/Users/edyli/personal-finance-dashboard/.worktrees/calendar`). The worktree has **no venv of its own** — every backend command uses the MAIN checkout's interpreter with the worktree as CWD and an isolated database on port 5434: from the worktree root,

```bash
cd backend && DATABASE_URL="postgresql+asyncpg://finance:finance@localhost:5434/finance" "C:/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe" -m pytest tests/<file> -q
```

(pytest's rootdir/CWD makes `import app` resolve to the WORKTREE's code; the 5434 Postgres isolates this branch's finance_test from the parallel branch on 5433.) Frontend tooling resolves node_modules upward from `.worktrees/` to the repo root — `npx vitest run` etc. work unchanged from the worktree root. Task 0 verifies: clean `git status`, correct branch, the backend invocation passes on `tests/test_health.py`, and `npx vitest run src/utils/months.test.ts` passes. **No file deletions. Never push. Frequent small commits.** `alembic` is NEVER run in this worktree (the migration's `down_revision` lives on a parallel branch — see Task 1); the orchestrator runs the full alembic round-trip after merging both branches.

**House rules that bind every task:** GETs never reject stored data; server sentences render verbatim; Decimal strings on the wire; plain quantize on read paths; focus-before-reset on save-success paths; `+ ZERO` on wire-bound Decimals; comments explain constraints, not narration.

---

## File structure

| File | Responsibility |
|---|---|
| `backend/alembic/versions/20260824_0901_d2f8a6b3c1e7_securities_next_ex_div_date.py` | Migration (additive nullable Date) |
| `backend/app/models/portfolio.py` | `Security.next_ex_div_date` |
| `backend/app/services/price_provider.py` | Protocol + `YFinanceProvider.fetch_next_ex_div` |
| `backend/app/services/price_service.py` | Refresh integration (sweep/store/clear) + `LAST_REFRESH_KEY` counts |
| `backend/app/services/business_days.py` (NEW) | `us_bank_holidays`, `previous/next_business_day`, `semi_monthly_paydays` |
| `backend/app/services/calendar_events.py` (NEW) | `CalendarEvent` + pure `compose()` |
| `backend/app/schemas/calendar.py` (NEW) | `CalendarEventOut` / `CalendarOut` |
| `backend/app/api/calendar.py` (NEW) | `GET /calendar` loader router |
| `backend/app/main.py` | Router registration |
| `src/types/api.ts`, `src/api/calendar.ts` | Wire types + client |
| `src/utils/months.ts` | `addDays`, `isoWeekday`, `monthGrid` |
| `src/utils/ics.ts` (NEW) | RFC 5545 text builder + blob download |
| `src/components/calendar/calendarView.ts` (NEW) | `EVENT_COLORS` (fixed slot map), labels, `groupByDate` |
| `src/components/overview/upNext.ts` (NEW) | Up-next strip picker (pure) |
| `src/pages/CalendarPage.tsx` (+`.css`) (NEW) | Month grid, list, legend, ICS button |
| `src/App.tsx`, `src/components/Layout.tsx` | Lazy route + nav item (`CalendarDays`) + ESPP icon swap (`PiggyBank`) |
| `src/pages/OverviewPage.tsx` (+`.css`) | "Up next" strip (separate fetch) |
| Tests | `backend/tests/test_business_days.py` (NEW), `test_calendar_events.py` (NEW), `test_calendar_api.py` (NEW), `test_price_provider.py`, `test_price_service.py`, `test_prices_api.py`; `src/utils/months.test.ts`, `src/utils/ics.test.ts` (NEW), `src/components/calendar/calendarView.test.ts` (NEW), `src/components/overview/upNext.test.ts` (NEW), `src/pages/CalendarPage.test.tsx` (NEW), `src/pages/OverviewPage.test.tsx` |

**Resolved ambiguities (spec-cited):** (1) The past-date **clear** sweeps the refresh run's loaded set — every ACTIVE security, manual-priced and failed included (spec §3.3 "and for skipped securities too"); inactive securities aren't loaded by the refresh and their stale dates are invisible to the calendar (it reads active holdings only). (2) "Latest paycheck profile" for the payday cadence = newest `effective_date` row — the cadence the next paychecks will follow. (3) `update_due` follows the spec table literally (previous month lacks a snapshot ⇒ event), with no attention-strip-style "only once a first month exists" guard — that guard is the strip's own rule. (4) Event `label`s carry identity (grant label, lot purchase date) so same-day same-type events keep distinct ICS UIDs; the spec §5 table's "detail" strings are kept verbatim as `detail`. (5) Apr 15 is ONE event (`detail` "federal filing + Q1 estimated payment"), not two colliding ones. (6) The spec §3.2 "data honesty" copy about announcement lead times lands as visible worded text in the calendar page's legend (with the payday-cadence note), the page being where the user meets the data.

---

## Phase 0 — Environment

### Task 0: Verify the worktree, database, and toolchain

**Files:** none (verification only)

- [ ] **Step 1: Worktree + branch.**

```bash
cd "C:/Users/edyli/personal-finance-dashboard/.worktrees/calendar" && git status --porcelain && git branch --show-current
```

Expected: no porcelain output (clean tree) and `financial-calendar`. If either is wrong, STOP and report — do not create branches or worktrees yourself.

- [ ] **Step 2: Backend smoke on the isolated 5434 database.**

```bash
cd backend && DATABASE_URL="postgresql+asyncpg://finance:finance@localhost:5434/finance" "C:/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe" -m pytest tests/test_health.py -q
```

Expected: PASS. A connection error means the 5434 Postgres isn't up — report and stop rather than falling back to another port (5433 belongs to the parallel branch).

- [ ] **Step 3: Frontend smoke.**

```bash
npx vitest run src/utils/months.test.ts
```

Expected: PASS (3 tests). This also proves node_modules resolve upward from the worktree.

---

## Phase 1 — Announced ex-dividend capture (spec §3)

### Task 1: `Security.next_ex_div_date` model column + migration

**Files:**
- Modify: `backend/app/models/portfolio.py`
- Create: `backend/alembic/versions/20260824_0901_d2f8a6b3c1e7_securities_next_ex_div_date.py`
- Test: `backend/tests/test_price_service.py`

- [ ] **Step 1: Write the failing test** (append to `backend/tests/test_price_service.py` — the file already imports `date`, `select`, `Security`, and defines `seed_security`):

```python
async def test_security_next_ex_div_date_roundtrip(db):
    """§3.1: a NEW nullable column — ex_div_date keeps its most-recent-PAST-event
    semantics untouched; this one carries the ANNOUNCED upcoming date."""
    sec = await seed_security(db, "NVDA")
    assert sec.next_ex_div_date is None  # fresh securities carry no announcement
    sec.next_ex_div_date = date(2026, 9, 3)
    await db.commit()
    await db.refresh(sec)
    assert sec.next_ex_div_date == date(2026, 9, 3)
    assert sec.ex_div_date is None  # the two columns are independent
```

- [ ] **Step 2: Run to verify failure.**

```bash
cd backend && DATABASE_URL="postgresql+asyncpg://finance:finance@localhost:5434/finance" "C:/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe" -m pytest tests/test_price_service.py -q
```

Expected: FAIL — `AttributeError: 'Security' object has no attribute 'next_ex_div_date'` (the rest of the file stays green).

- [ ] **Step 3: Add the column.** In `backend/app/models/portfolio.py`, inside `Security`, directly after the `ex_div_date` line:

```python
    ex_div_date: Mapped[date | None] = mapped_column(Date)
    # ex_div_date (above) is the most recent PAST event — maintained from historical
    # bars by price_service._update_dividend_metadata, always behind us. This one is the
    # ANNOUNCED upcoming date from the provider's forward calendar (2026-08-24 calendar
    # spec §3.1): a new column, not an overload, so ex_div_date's consumers (Securities
    # panel, TTM metadata) keep their semantics. The refresh clears it once it passes.
    next_ex_div_date: Mapped[date | None] = mapped_column(Date)
```

- [ ] **Step 4: Write the migration** — create `backend/alembic/versions/20260824_0901_d2f8a6b3c1e7_securities_next_ex_div_date.py`:

```python
"""securities next_ex_div_date

Announced upcoming ex-dividend date (2026-08-24 financial-calendar spec §3.1) — additive
and nullable. ex_div_date keeps its most-recent-past-event semantics unchanged; the daily
refresh stores announced dates >= today here and clears them once they pass.

Revision ID: d2f8a6b3c1e7
Revises: b7c4e1f2a9d3
Create Date: 2026-08-24 09:01:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d2f8a6b3c1e7"
down_revision: str | Sequence[str] | None = "b7c4e1f2a9d3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("securities", sa.Column("next_ex_div_date", sa.Date(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("securities", "next_ex_div_date")
```

**MIGRATION CAVEAT (deliberate, do not "fix"):** `down_revision = "b7c4e1f2a9d3"` is the category-budgets migration being built on a PARALLEL branch — **it does not exist in this worktree**. That is intentional: after both branches merge, the chain is linear. Consequence: `alembic upgrade` (and even `alembic heads`, which resolves the revision map) **cannot run inside this worktree** — do not attempt it. Tests are unaffected because `conftest.py` builds the schema via `Base.metadata.create_all`; the orchestrator runs the full alembic round-trip after merging both branches.

- [ ] **Step 5: Run the test again** — same command as Step 2. Expected: PASS (whole file green).
- [ ] **Step 6: Commit.**

```bash
git add -A && git commit -m "feat(calendar): securities.next_ex_div_date column + migration"
```

### Task 2: Provider `fetch_next_ex_div` (+ Protocol)

**Files:**
- Modify: `backend/app/services/price_provider.py`
- Test: `backend/tests/test_price_provider.py`

- [ ] **Step 1: Write the failing tests** (append to `backend/tests/test_price_provider.py` — it already imports `sys`, `date`, `SimpleNamespace`, and `YFinanceProvider`; extend its `datetime` import needs with a local import inside the test that uses one):

```python
def _fake_yf_calendar(calendar_value, seen=None):
    seen = seen if seen is not None else {}

    class FakeTicker:
        def __init__(self, symbol, session=None):
            seen["symbol"] = symbol
            seen["session"] = session
            self.calendar = calendar_value

    return SimpleNamespace(Ticker=FakeTicker)


def test_fetch_next_ex_div_reads_the_forward_calendar(monkeypatch):
    seen = {}
    monkeypatch.setitem(
        sys.modules,
        "yfinance",
        _fake_yf_calendar({"Ex-Dividend Date": date(2026, 9, 3)}, seen),
    )
    provider = YFinanceProvider.__new__(YFinanceProvider)  # skip session build
    provider._session = "SENTINEL"
    assert provider.fetch_next_ex_div("BRK.B") == date(2026, 9, 3)
    assert seen["symbol"] == "BRK-B"  # yahoo_symbol mapping, same as fetch_daily
    assert seen["session"] == "SENTINEL"


def test_fetch_next_ex_div_coerces_timestamp_datetime_and_iso(monkeypatch):
    from datetime import datetime

    provider = YFinanceProvider.__new__(YFinanceProvider)
    provider._session = None
    # pandas Timestamp duck-type: anything with a callable .date().
    stamp = SimpleNamespace(date=lambda: date(2026, 9, 3))
    for value in (stamp, datetime(2026, 9, 3, 12, 30), "2026-09-03"):
        monkeypatch.setitem(
            sys.modules, "yfinance", _fake_yf_calendar({"Ex-Dividend Date": value})
        )
        assert provider.fetch_next_ex_div("NVDA") == date(2026, 9, 3), value


def test_fetch_next_ex_div_returns_none_on_missing_or_malformed(monkeypatch):
    provider = YFinanceProvider.__new__(YFinanceProvider)
    provider._session = None
    cases = [
        None,                                       # no calendar published
        object(),                                   # not even dict-like (no .get)
        {},                                         # key absent
        {"Ex-Dividend Date": None},
        {"Ex-Dividend Date": "not a date"},
        {"Ex-Dividend Date": 20260903},             # a number is not an announcement
        {"Ex-Dividend Date": [date(2026, 9, 3)]},   # a list is not an announcement
        {"Ex-Dividend Date": date(1888, 1, 1)},     # absurd year — the century fence
        {"Ex-Dividend Date": date(9999, 12, 31)},
    ]
    for value in cases:
        monkeypatch.setitem(sys.modules, "yfinance", _fake_yf_calendar(value))
        assert provider.fetch_next_ex_div("NVDA") is None, value
```

- [ ] **Step 2: Run to verify failure.**

```bash
cd backend && DATABASE_URL="postgresql+asyncpg://finance:finance@localhost:5434/finance" "C:/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe" -m pytest tests/test_price_provider.py -q
```

Expected: FAIL — `AttributeError: 'YFinanceProvider' object has no attribute 'fetch_next_ex_div'`.

- [ ] **Step 3: Implement.** In `backend/app/services/price_provider.py`:

1. Extend the datetime import: `from datetime import date, datetime`.
2. Extend the Protocol:

```python
class PriceProvider(Protocol):
    def fetch_daily(self, ticker: str, start: date) -> list[DailyBar]: ...

    def fetch_next_ex_div(self, ticker: str) -> date | None: ...
```

3. Add, between `yahoo_symbol` and `DailyBar` (module-level helpers, provider-private):

```python
# yfinance's forward-calendar key (Ticker.calendar, quote-summary "calendarEvents").
EX_DIVIDEND_KEY = "Ex-Dividend Date"


def _bounded_year(value: date) -> date | None:
    # The century fence (money.py's family, background-fetch flavour): an 1888 or 9999
    # from a malformed payload is noise, not an announcement — SKIP, never raise.
    return value if 1990 <= value.year <= 2100 else None


def _coerce_forward_date(value) -> date | None:
    """Normalize whatever the forward calendar carries — datetime.date, datetime, pandas
    Timestamp (duck-typed via a callable .date()), ISO string — to a plain date. Anything
    else reads as "nothing announced" (None): this module's malformed-data posture."""
    if isinstance(value, datetime):  # before the date check — datetime IS a date
        return _bounded_year(value.date())
    if isinstance(value, date):
        return _bounded_year(value)
    to_date = getattr(value, "date", None)
    if callable(to_date):
        try:
            coerced = to_date()
        except Exception:
            return None
        if isinstance(coerced, datetime):
            coerced = coerced.date()
        return _bounded_year(coerced) if isinstance(coerced, date) else None
    if isinstance(value, str):
        try:
            return _bounded_year(date.fromisoformat(value))
        except ValueError:
            return None
    return None
```

4. Add the method to `YFinanceProvider`, below `fetch_daily`:

```python
    def fetch_next_ex_div(self, ticker: str) -> date | None:
        """Yahoo's ANNOUNCED upcoming ex-dividend date, or None when nothing usable is
        published (2026-08-24 calendar spec §3.2 — confirmed-only, no projections).
        Raises on transport errors exactly like fetch_daily (the caller isolates per
        ticker); malformed calendar PAYLOADS degrade to None instead. Lazy import +
        shared curl_cffi session, fetch_daily's posture."""
        import yfinance as yf

        calendar_data = yf.Ticker(yahoo_symbol(ticker), session=self._session).calendar
        getter = getattr(calendar_data, "get", None)
        if not callable(getter):
            return None  # None, a DataFrame-less shape, or any non-mapping payload
        return _coerce_forward_date(getter(EX_DIVIDEND_KEY))
```

- [ ] **Step 4: Run** — same command as Step 2. Expected: PASS (whole file).
- [ ] **Step 5: Commit.**

```bash
git add -A && git commit -m "feat(calendar): provider fetch_next_ex_div — forward-calendar announced ex-div"
```

### Task 3: Refresh integration + `LAST_REFRESH_KEY` counts

**Files:**
- Modify: `backend/app/services/price_service.py`
- Test: `backend/tests/test_price_service.py`, `backend/tests/test_prices_api.py`

- [ ] **Step 1: Extend the fakes FIRST** (both files, so the whole suite keeps the Protocol shape):

In `backend/tests/test_price_service.py`, replace the `FakeProvider` class with:

```python
class FakeProvider:
    def __init__(self, data=None, errors=None, next_ex_div=None, next_ex_div_errors=None):
        self.data = data or {}
        self.errors = errors or {}
        self.next_ex_div = next_ex_div or {}
        self.next_ex_div_errors = next_ex_div_errors or {}
        self.calls: list[tuple[str, date]] = []
        self.ex_div_calls: list[str] = []

    def fetch_daily(self, ticker, start):
        self.calls.append((ticker, start))
        if ticker in self.errors:
            raise self.errors[ticker]
        return self.data.get(ticker, [])

    def fetch_next_ex_div(self, ticker):
        self.ex_div_calls.append(ticker)
        if ticker in self.next_ex_div_errors:
            raise self.next_ex_div_errors[ticker]
        return self.next_ex_div.get(ticker)
```

In `backend/tests/test_prices_api.py`, append to its own `FakeProvider` (below `fetch_daily`):

```python
    def fetch_next_ex_div(self, ticker):
        # The announced-date leg is pinned in test_price_service; here it only needs the
        # Protocol shape so a full refresh runs whole.
        return None
```

- [ ] **Step 2: Write the failing tests** (append to `backend/tests/test_price_service.py`):

```python
async def test_refresh_stores_a_future_announced_ex_div(db):
    sec = await seed_security(db, "DIVX")
    provider = FakeProvider(
        {"DIVX": [bar(TODAY - timedelta(days=30), "100", "0.75"), bar(TODAY, "110")]},
        next_ex_div={"DIVX": TODAY + timedelta(days=20)},
    )
    result = await refresh_prices(db, provider, today=TODAY)
    assert result.updated == ["DIVX"]
    assert (result.ex_div_fetched, result.ex_div_failed) == (1, 0)
    assert provider.ex_div_calls == ["DIVX"]
    await db.refresh(sec)
    assert sec.next_ex_div_date == TODAY + timedelta(days=20)


async def test_refresh_clears_when_the_feed_stops_announcing(db):
    # §3.3: a SUCCESSFUL fetch that answers "nothing upcoming" clears a stored future
    # date — Yahoo withdrew or never re-announced it, and confirmed-only means gone.
    sec = await seed_security(db, "DIVX")
    sec.next_ex_div_date = TODAY + timedelta(days=5)
    await db.commit()
    provider = FakeProvider(
        {"DIVX": [bar(TODAY - timedelta(days=30), "100", "0.75"), bar(TODAY, "110")]},
    )
    await refresh_prices(db, provider, today=TODAY)
    await db.refresh(sec)
    assert sec.next_ex_div_date is None


async def test_refresh_treats_a_past_announcement_as_nothing(db):
    sec = await seed_security(db, "DIVX")
    provider = FakeProvider(
        {"DIVX": [bar(TODAY - timedelta(days=30), "100", "0.75"), bar(TODAY, "110")]},
        next_ex_div={"DIVX": TODAY - timedelta(days=1)},  # fetched but already past
    )
    await refresh_prices(db, provider, today=TODAY)
    await db.refresh(sec)
    assert sec.next_ex_div_date is None  # store only >= today, else NULL (spec §3.3)


async def test_refresh_sweeps_stale_dates_on_manual_and_non_payers(db):
    # The clear is INDEPENDENT of the fetch: manual-priced (skipped) and non-dividend
    # securities never fetch, but a stored date that has passed is cleared anyway — the
    # event occurred and the historical bars own it now.
    manual = await seed_security(db, "PRIV", manual=True)
    manual.next_ex_div_date = TODAY - timedelta(days=3)
    nodiv = await seed_security(db, "GROW")
    nodiv.next_ex_div_date = TODAY - timedelta(days=1)
    await db.commit()
    provider = FakeProvider({"GROW": [bar(TODAY, "50")]})  # bars carry no dividends
    result = await refresh_prices(db, provider, today=TODAY)
    assert provider.ex_div_calls == []  # neither is a dividend payer — no fetch at all
    assert (result.ex_div_fetched, result.ex_div_failed) == (0, 0)
    await db.refresh(manual)
    await db.refresh(nodiv)
    assert manual.next_ex_div_date is None and nodiv.next_ex_div_date is None


async def test_refresh_ex_div_failure_keeps_a_future_stored_date(db):
    sec = await seed_security(db, "DIVX")
    sec.next_ex_div_date = TODAY + timedelta(days=10)
    await db.commit()
    provider = FakeProvider(
        {"DIVX": [bar(TODAY - timedelta(days=30), "100", "0.75"), bar(TODAY, "110")]},
        next_ex_div_errors={"DIVX": RuntimeError("calendar endpoint down")},
    )
    result = await refresh_prices(db, provider, today=TODAY)
    assert result.updated == ["DIVX"]  # the PRICE refresh stands (never fails the run)
    assert result.failed == {}  # ex-div failures wear their own counter, not failed[]
    assert (result.ex_div_fetched, result.ex_div_failed) == (0, 1)
    await db.refresh(sec)
    assert sec.next_ex_div_date == TODAY + timedelta(days=10)  # last-good


async def test_run_refresh_records_ex_div_counts_in_the_blob(db):
    await seed_security(db, "DIVX")
    provider = FakeProvider(
        {"DIVX": [bar(MONDAY - timedelta(days=30), "100", "0.75"), bar(MONDAY, "110")]},
        next_ex_div={"DIVX": MONDAY + timedelta(days=14)},
    )
    await run_refresh(db, provider, trigger="scheduled", today=MONDAY)
    payload = await read_last_refresh(db)
    assert payload["ex_div_fetched"] == 1
    assert payload["ex_div_failed"] == 0
```

- [ ] **Step 3: Run to verify failure.**

```bash
cd backend && DATABASE_URL="postgresql+asyncpg://finance:finance@localhost:5434/finance" "C:/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe" -m pytest tests/test_price_service.py -q
```

Expected: the six new tests FAIL (`AttributeError: ... no attribute 'ex_div_fetched'` / column stays stale); pre-existing tests stay green (the extended fake defaults to `None`).

- [ ] **Step 4: Implement.** In `backend/app/services/price_service.py`:

1. Extend `RefreshResult`:

```python
@dataclass
class RefreshResult:
    updated: list[str] = field(default_factory=list)
    failed: dict[str, str] = field(default_factory=dict)
    skipped_manual: list[str] = field(default_factory=list)
    # Per-security dividend events seen in this run's bars (updated tickers only) —
    # run_refresh hands them to dividend_ingest so the Yahoo fetch happens exactly once.
    dividend_events: dict[int, list[DailyBar]] = field(default_factory=dict)
    # Announced-ex-div leg (calendar spec §3.3): fetch attempts that answered vs raised.
    # Deliberately NOT in failed[] — a calendar hiccup must not read as a price failure.
    ex_div_fetched: int = 0
    ex_div_failed: int = 0
```

2. In `refresh_prices`, insert the sweep between the `securities = list(...)` load and `latest_rows: list[dict] = []`:

```python
    for security in securities:
        # §3.3, independent of any fetch and BEFORE it: a stored announced date that has
        # passed is cleared for every loaded (active) security — manual-priced and
        # about-to-fail tickers included — because the event has occurred and the
        # historical bars own it now (ex_div_date's territory). The last-good posture in
        # the loop below therefore only ever preserves a still-FUTURE date. Inactive
        # securities are not loaded here; their stale dates are invisible to the
        # calendar (it reads active holdings) and clear on reactivation's next run.
        if security.next_ex_div_date is not None and security.next_ex_div_date < today:
            security.next_ex_div_date = None
```

3. Still in `refresh_prices`, inside the per-ticker loop, directly after the `_update_dividend_metadata(security, bars, today)` call:

```python
        if security.annual_dividend is not None and security.annual_dividend > 0:
            # Active + auto-priced are already this loop's population; dividend-paying
            # (per the TTM metadata just written) gates the extra HTTP call (§3.3).
            try:
                announced = await asyncio.to_thread(
                    provider.fetch_next_ex_div, security.ticker
                )
            except Exception:
                # Last-good: the (already swept) stored value stands; never the batch's
                # problem and never failed[] — prices and announcements fail separately.
                result.ex_div_failed += 1
            else:
                result.ex_div_fetched += 1
                # Store only a confirmed UPCOMING date; "nothing announced" and an
                # already-past announcement both leave NULL (spec §3.3).
                security.next_ex_div_date = (
                    announced if announced is not None and announced >= today else None
                )
```

4. In `record_refresh_run`, extend the payload dict after the `"history_appended"` entry:

```python
        "history_appended": history_appended,
        "ex_div_fetched": result.ex_div_fetched,
        "ex_div_failed": result.ex_div_failed,
```

(`LastRefreshOut` in `schemas/portfolio.py` is deliberately untouched: pydantic's default `extra="ignore"` means the status endpoint keeps validating old and new blobs alike; surfacing the counts on the wire is a v2 nicety.)

- [ ] **Step 5: Run the touched suites.**

```bash
cd backend && DATABASE_URL="postgresql+asyncpg://finance:finance@localhost:5434/finance" "C:/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe" -m pytest tests/test_price_service.py tests/test_prices_api.py tests/test_scheduler.py -q
```

Expected: ALL PASS (the prices-api fake now satisfies the Protocol; scheduler untouched but shares the module).

- [ ] **Step 6: Commit.**

```bash
git add -A && git commit -m "feat(calendar): refresh learns announced ex-div dates — store future, clear past, last-good"
```

---

## Phase 2 — Pure services

### Task 4: `business_days.py` — Fed holidays + business-day stepping

**Files:**
- Create: `backend/app/services/business_days.py`
- Create: `backend/tests/test_business_days.py`

- [ ] **Step 1: Write the failing golden-table tests** — create `backend/tests/test_business_days.py`:

```python
"""Golden-table tests: every expected literal below was hand-derived from the calendar
(2026-01-01 is a Thursday, 2027-01-01 a Friday, 2028-01-01 a Saturday). If one fails,
the CODE is wrong, not the table."""

from datetime import date

from app.services.business_days import (
    next_business_day,
    previous_business_day,
    us_bank_holidays,
)


def test_us_bank_holidays_2026_golden_table():
    assert us_bank_holidays(2026) == {
        date(2026, 1, 1),    # New Year's Day (Thu)
        date(2026, 1, 19),   # MLK Day (3rd Mon)
        date(2026, 2, 16),   # Washington's Birthday (3rd Mon)
        date(2026, 5, 25),   # Memorial Day (last Mon)
        date(2026, 6, 19),   # Juneteenth (Fri)
        date(2026, 7, 4),    # Independence Day — a SATURDAY: no weekday observation
        date(2026, 9, 7),    # Labor Day (1st Mon)
        date(2026, 10, 12),  # Columbus Day (2nd Mon)
        date(2026, 11, 11),  # Veterans Day (Wed)
        date(2026, 11, 26),  # Thanksgiving (4th Thu)
        date(2026, 12, 25),  # Christmas (Fri)
    }


def test_us_bank_holidays_2027_golden_table():
    assert us_bank_holidays(2027) == {
        date(2027, 1, 1),    # New Year's Day (Fri)
        date(2027, 1, 18),   # MLK Day
        date(2027, 2, 15),   # Washington's Birthday
        date(2027, 5, 31),   # Memorial Day — the last Monday IS the 31st
        date(2027, 6, 19),   # Juneteenth — a SATURDAY: no weekday observation
        date(2027, 7, 5),    # Independence Day OBSERVED — Jul 4 2027 is a SUNDAY
        date(2027, 9, 6),    # Labor Day
        date(2027, 10, 11),  # Columbus Day
        date(2027, 11, 11),  # Veterans Day (Thu)
        date(2027, 11, 25),  # Thanksgiving
        date(2027, 12, 25),  # Christmas — a SATURDAY: no weekday observation
    }


def test_holiday_sets_always_carry_eleven_entries():
    for year in (2026, 2027, 2028):
        assert len(us_bank_holidays(year)) == 11


def test_business_day_stepping_over_weekends_and_holidays():
    # A qualifying day answers itself (both directions).
    assert previous_business_day(date(2026, 8, 14)) == date(2026, 8, 14)  # a Friday
    assert next_business_day(date(2026, 8, 14)) == date(2026, 8, 14)
    # Weekend: Saturday steps back to Friday, forward to Monday.
    assert previous_business_day(date(2026, 8, 15)) == date(2026, 8, 14)
    assert next_business_day(date(2026, 8, 15)) == date(2026, 8, 17)
    # A holiday Monday steps back across the whole weekend.
    assert previous_business_day(date(2026, 5, 25)) == date(2026, 5, 22)  # Memorial Day
    # The Fed Saturday rule: Fri Jul 3 2026 is a REGULAR business day (Jul 4 is a
    # Saturday, and Reserve Banks stay open the preceding Friday).
    assert next_business_day(date(2026, 7, 3)) == date(2026, 7, 3)
    # A Sunday-observed holiday: Mon Jul 5 2027 is closed, so Sun Jul 4 lands on Tue.
    assert next_business_day(date(2027, 7, 4)) == date(2027, 7, 6)
    # Weekend + holiday chain: Sat Jan 15 2028 -> Sun 16 -> Mon 17 (MLK) -> Tue Jan 18.
    # (The real IRS roll-forward for that Q4 due date.)
    assert next_business_day(date(2028, 1, 15)) == date(2028, 1, 18)
```

- [ ] **Step 2: Run to verify failure.**

```bash
cd backend && DATABASE_URL="postgresql+asyncpg://finance:finance@localhost:5434/finance" "C:/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe" -m pytest tests/test_business_days.py -q
```

Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.business_days'`.

- [ ] **Step 3: Implement** — create `backend/app/services/business_days.py`:

```python
"""US bank-holiday calendar + business-day stepping (2026-08-24 calendar spec §4).

Pure module — no DB, no HTTP, no clock (rsu_vesting's posture). Owns the app's ONLY
holiday logic: the 11 Federal Reserve holidays with the Fed observation rule — a Sunday
holiday observes the following Monday; a Saturday holiday observes NOTHING (Reserve
Banks are open the preceding Friday, unlike the federal-workforce rule).

Known v1 approximations, accepted by the spec: employer payroll calendars differ from
Fed holidays, and DC Emancipation Day occasionally moves Tax Day. Both are ignored.
"""

import calendar
from datetime import date, timedelta

_MONDAY = 0
_THURSDAY = 3
_SATURDAY = 5
_SUNDAY = 6


def _nth_weekday(year: int, month: int, weekday: int, n: int) -> date:
    first_offset = (weekday - date(year, month, 1).weekday()) % 7
    return date(year, month, 1 + first_offset + 7 * (n - 1))


def _last_weekday(year: int, month: int, weekday: int) -> date:
    last = date(year, month, calendar.monthrange(year, month)[1])
    return last - timedelta(days=(last.weekday() - weekday) % 7)


def us_bank_holidays(year: int) -> set[date]:
    """The 11 Federal Reserve holidays as OBSERVED closure dates: a Sunday fixed-date
    holiday shifts to its Monday; a Saturday one stays put (already a non-business day,
    and the Fed observes nothing for it — keeping it in the set preserves the 11-entry
    invariant and is inert to stepping). Floating holidays land on weekdays by rule."""
    fixed = (
        date(year, 1, 1),    # New Year's Day
        date(year, 6, 19),   # Juneteenth
        date(year, 7, 4),    # Independence Day
        date(year, 11, 11),  # Veterans Day
        date(year, 12, 25),  # Christmas Day
    )
    observed = {
        day + timedelta(days=1) if day.weekday() == _SUNDAY else day for day in fixed
    }
    observed.update(
        (
            _nth_weekday(year, 1, _MONDAY, 3),     # Martin Luther King Jr. Day
            _nth_weekday(year, 2, _MONDAY, 3),     # Washington's Birthday
            _last_weekday(year, 5, _MONDAY),       # Memorial Day
            _nth_weekday(year, 9, _MONDAY, 1),     # Labor Day
            _nth_weekday(year, 10, _MONDAY, 2),    # Columbus Day
            _nth_weekday(year, 11, _THURSDAY, 4),  # Thanksgiving Day
        )
    )
    return observed


def _is_business_day(day: date) -> bool:
    return day.weekday() < _SATURDAY and day not in us_bank_holidays(day.year)


def previous_business_day(day: date) -> date:
    """`day` itself when it qualifies; else step backward over weekends + holidays.
    Recomputing the year's set per step is eleven date constructions — trivial, and it
    makes year-boundary crossings (a Jan 1 step-back) automatically correct."""
    while not _is_business_day(day):
        day -= timedelta(days=1)
    return day


def next_business_day(day: date) -> date:
    """`day` itself when it qualifies; else step forward over weekends + holidays."""
    while not _is_business_day(day):
        day += timedelta(days=1)
    return day
```

- [ ] **Step 4: Run** — same command as Step 2. Expected: PASS (4 tests).
- [ ] **Step 5: Commit.**

```bash
git add -A && git commit -m "feat(calendar): business_days — Fed holiday tables + business-day stepping"
```

### Task 5: `semi_monthly_paydays`

**Files:**
- Modify: `backend/app/services/business_days.py`
- Test: `backend/tests/test_business_days.py`

- [ ] **Step 1: Write the failing tests** (append to `backend/tests/test_business_days.py`, and extend its import line with `semi_monthly_paydays`):

```python
def test_semi_monthly_paydays_plain_weekday_month():
    # June 2026: the 15th is a Monday, the 30th a Tuesday — nothing adjusts (and July 4
    # falling on a Saturday moves nothing anywhere near it).
    assert semi_monthly_paydays(2026, 6) == (date(2026, 6, 15), date(2026, 6, 30))


def test_semi_monthly_paydays_weekend_adjustments():
    # Aug 2026: Sat 15th -> Fri 14th; Mon 31st stands.
    assert semi_monthly_paydays(2026, 8) == (date(2026, 8, 14), date(2026, 8, 31))
    # Feb 2026: Sun 15th -> Fri 13th; Sat 28th -> Fri 27th.
    assert semi_monthly_paydays(2026, 2) == (date(2026, 2, 13), date(2026, 2, 27))
    # May 2026: Fri 15th stands; Sun 31st -> Fri 29th.
    assert semi_monthly_paydays(2026, 5) == (date(2026, 5, 15), date(2026, 5, 29))
    # Jan 2027: Fri 15th stands (the spec's named check); Sun 31st -> Fri 29th.
    assert semi_monthly_paydays(2027, 1) == (date(2027, 1, 15), date(2027, 1, 29))


def test_semi_monthly_payday_on_a_bank_holiday():
    # May 2027: the 31st IS Memorial Day (a Monday) — the end-of-month payday crosses
    # the holiday AND the weekend back to Fri May 28. The 15th is a Saturday -> Fri 14th.
    assert semi_monthly_paydays(2027, 5) == (date(2027, 5, 14), date(2027, 5, 28))
```

- [ ] **Step 2: Run to verify failure** — same pytest command as Task 4 Step 2. Expected: FAIL — `ImportError: cannot import name 'semi_monthly_paydays'`.

- [ ] **Step 3: Implement** — append to `backend/app/services/business_days.py`:

```python
def semi_monthly_paydays(year: int, month: int) -> tuple[date, date]:
    """The 15th and the last day of the month, each adjusted BACKWARD (spec §4: payroll
    convention — pay lands the business day BEFORE a weekend/holiday payday, never
    after)."""
    mid = previous_business_day(date(year, month, 15))
    eom = previous_business_day(date(year, month, calendar.monthrange(year, month)[1]))
    return mid, eom
```

- [ ] **Step 4: Run** — same command. Expected: PASS (7 tests).
- [ ] **Step 5: Commit.**

```bash
git add -A && git commit -m "feat(calendar): semi_monthly_paydays — 15th/EOM adjusted backward"
```

### Task 6: `calendar_events.compose` — scaffolding + equity events

**Files:**
- Create: `backend/app/services/calendar_events.py`
- Create: `backend/tests/test_calendar_events.py`

`compose()` is born with its FULL signature here (Task 7 fills the remaining branches in the same body), so no call site ever changes shape. Task 6 implements: `rsu_vest` (with per-grant degradation), `espp_purchase`, `espp_qualify`, `offering_start`, range clipping, and the `(date, type, label)` sort.

- [ ] **Step 1: Write the failing tests** — create `backend/tests/test_calendar_events.py`:

```python
"""compose() driven entirely by literals — the ROUTER owns loading, these tests own the
rules. Date facts used below (2026-01-01 is a Thursday): Mar 18 2026 and Jun 17, Sep 16,
Dec 16 2026 are third Wednesdays; Feb 28 2026 is a Saturday so last_weekday_of(2026, 2)
is Feb 27; Aug 31 2026 is a Monday. Every test filters to the type it exercises, so the
suite survives Task 7 adding the always-on sources (tax deadlines) to shared windows."""

from datetime import date
from decimal import Decimal
from types import SimpleNamespace

from app.services.calendar_events import compose
from app.services.espp_calc import OfferingInfo, StoredPeriod


def _grant(label="2025 offer", shares=400, cliff="0.25", first_vest=date(2026, 3, 18)):
    return SimpleNamespace(
        label=label,
        shares=shares,
        cliff_pct=Decimal(cliff),
        first_vest_date=first_vest,
        vest_quantum=1,
    )


def _compose(start, end, **over):
    inputs = dict(
        today=date(2026, 8, 24),
        grants=[],
        stored_periods=[],
        offerings=[],
        unsold_lots=[],
        announced_ex_divs=[],
        payday_semi_monthly=False,
        missing_update_month=None,
    )
    inputs.update(over)
    return compose(start, end, **inputs)


def _of_type(events, type_):
    return [e for e in events if e.type == type_]


def test_rsu_vests_clip_to_the_range():
    events = _of_type(
        _compose(date(2026, 3, 1), date(2026, 6, 30), grants=[_grant()]), "rsu_vest"
    )
    # 400 sh @ 25% cliff: 100 on the stored 2026-03-18, then 25 per quarterly third
    # Wednesday — Jun 17 in range, Sep 16 clipped out.
    assert [(e.event_date, e.label, e.detail) for e in events] == [
        (date(2026, 3, 18), "RSU vest — 2025 offer", "100 sh — 2025 offer"),
        (date(2026, 6, 17), "RSU vest — 2025 offer", "25 sh — 2025 offer"),
    ]
    assert all(e.href == "/comp" for e in events)


def test_bad_grant_degrades_with_a_warning_not_a_crash(caplog):
    bad = _grant(label="hand-edited", cliff="0.30")  # 0.70 is not a whole 6.25% count
    events = _of_type(
        _compose(date(2026, 1, 1), date(2026, 12, 31), grants=[bad, _grant()]),
        "rsu_vest",
    )
    # The good grant's four 2026 vests stand; the bad one contributes nothing but a log.
    assert {e.label for e in events} == {"RSU vest — 2025 offer"}
    assert len(events) == 4  # Mar 18, Jun 17, Sep 16, Dec 16
    assert any("hand-edited" in record.message for record in caplog.records)


def test_espp_purchases_stored_and_derived():
    stored = [
        StoredPeriod(
            id=1,
            label="1H26",
            period_start=date(2025, 9, 1),
            period_end=date(2026, 2, 27),
            semi_annual_base=Decimal("60000"),
            additional_payments=Decimal("0"),
            contribution_pct=Decimal("0.14"),
        )
    ]
    events = _of_type(
        _compose(date(2026, 1, 1), date(2026, 12, 31), stored_periods=stored),
        "espp_purchase",
    )
    # Stored 1H26 verbatim; the empty Mar–Aug slot derives its last-weekday end.
    assert [(e.event_date, e.detail, e.href) for e in events] == [
        (date(2026, 2, 27), "1H26", "/espp"),
        (date(2026, 8, 31), "Mar–Aug 2026", "/espp"),
    ]
    assert events[0].label == "ESPP purchase — 1H26"


def test_espp_qualify_renders_and_clips_the_lots_it_is_given():
    # The ROUTER filters to unsold lots; compose renders whatever it receives and clips.
    events = _of_type(
        _compose(
            date(2026, 1, 1),
            date(2026, 12, 31),
            unsold_lots=[
                (date(2024, 2, 29), date(2026, 3, 1)),
                (date(2025, 8, 29), date(2027, 8, 29)),  # qualifies outside the range
            ],
        ),
        "espp_qualify",
    )
    assert [(e.event_date, e.label, e.detail) for e in events] == [
        (
            date(2026, 3, 1),
            "ESPP lot qualifies — 2024-02-29",
            "2024-02-29 lot qualifies",
        )
    ]
    assert events[0].href == "/espp"


def test_offering_start_events():
    offerings = [
        OfferingInfo(offering_start=date(2025, 9, 1), subscription_price=Decimal("175.25")),
        OfferingInfo(offering_start=date(2026, 9, 1), subscription_price=Decimal("120")),
    ]
    events = _of_type(
        _compose(date(2026, 1, 1), date(2026, 12, 31), offerings=offerings),
        "offering_start",
    )
    assert [(e.event_date, e.label, e.detail) for e in events] == [
        (date(2026, 9, 1), "ESPP offering starts", "subscription price 120")
    ]


def test_events_sort_by_date_then_type_then_label():
    # One-day window so only the two seeded same-day events exist: "espp_qualify" sorts
    # before "rsu_vest" by type name.
    events = _compose(
        date(2026, 9, 16),
        date(2026, 9, 16),
        grants=[_grant()],  # Sep 16 vest
        unsold_lots=[(date(2025, 8, 29), date(2026, 9, 16))],
    )
    assert [(e.event_date, e.type) for e in events] == [
        (date(2026, 9, 16), "espp_qualify"),
        (date(2026, 9, 16), "rsu_vest"),
    ]
```

- [ ] **Step 2: Run to verify failure.**

```bash
cd backend && DATABASE_URL="postgresql+asyncpg://finance:finance@localhost:5434/finance" "C:/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe" -m pytest tests/test_calendar_events.py -q
```

Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.calendar_events'`.

- [ ] **Step 3: Implement** — create `backend/app/services/calendar_events.py`:

```python
"""Forward-looking event composition for GET /calendar (2026-08-24 spec §5).

Pure module — no DB, no HTTP, no clock (`today` is a PARAMETER; rsu_vesting's posture).
The ROUTER loads inputs and hands them over as plain values; pytest drives this with
literals. GET-never-rejects law: a degradable source (a hand-edited grant the vest
scheduler refuses) drops ITS events with a logged warning and never takes the payload
down — api/comp.py catches the same pair and degrades the same way.

Labels carry IDENTITY (grant label, lot purchase date) on purpose: the frontend's ICS
UID is `{type}-{date}-{slugified label}`, and two grants genuinely vest the same day —
identical labels would collide their UIDs and make calendar apps merge distinct events.
The spec §5 table's detail strings are kept verbatim as `detail`.
"""

import logging
from dataclasses import dataclass
from datetime import date

from app.services import rsu_vesting
from app.services.espp_calc import OfferingInfo, StoredPeriod, plan_year_rows

logger = logging.getLogger(__name__)

# Wire vocabulary, pinned once: schemas/calendar.py's Literal and the frontend's
# CalendarEventType both spell exactly these eight.
EVENT_TYPES = (
    "rsu_vest",
    "espp_purchase",
    "espp_qualify",
    "ex_dividend",
    "payday",
    "offering_start",
    "tax_deadline",
    "update_due",
)


@dataclass(frozen=True)
class CalendarEvent:
    """One calendar entry. `event_date`, not `date` — the DailyBar.bar_date naming
    convention (an attribute named `date` shadows the type). The WIRE field is `date`
    (schemas/calendar.py maps it)."""

    event_date: date
    type: str  # one of EVENT_TYPES
    label: str
    detail: str | None
    href: str


def compose(
    start: date,
    end: date,
    *,
    today: date,
    grants: list,  # grant-shaped: label, shares, cliff_pct, first_vest_date, vest_quantum
    stored_periods: list[StoredPeriod],  # EVERY stored period, chain order (period_end, id)
    offerings: list[OfferingInfo],
    unsold_lots: list[tuple[date, date]],  # (purchase_date, qualifying_date)
    announced_ex_divs: list[tuple[str, date]],  # (ticker, next_ex_div_date), HELD only
    payday_semi_monthly: bool,
    missing_update_month: date | None,  # prev month's 1st when it lacks a snapshot
) -> list[CalendarEvent]:
    """Every event in [start, end] inclusive, sorted by (date, type, label) — the spec's
    (date, type) order with a deterministic tiebreak for same-day same-type events."""
    events: list[CalendarEvent] = []

    def in_range(day: date) -> bool:
        return start <= day <= end

    # rsu_vest — computed tranches, clipped. Zero-share tranches are real vest events
    # (comp.py keeps them too) and appear so the calendar matches the /comp table.
    for grant in grants:
        try:
            tranches = rsu_vesting.schedule(grant)
        except (ValueError, OverflowError) as exc:
            logger.warning("calendar: grant %r cannot be scheduled — %s", grant.label, exc)
            continue
        for vest_date, shares in tranches:
            if in_range(vest_date):
                events.append(
                    CalendarEvent(
                        event_date=vest_date,
                        type="rsu_vest",
                        label=f"RSU vest — {grant.label}",
                        detail=f"{shares} sh — {grant.label}",  # unpriced in v1 (spec §5)
                        href="/comp",
                    )
                )

    # espp_purchase — stored + derived period ends, one plan per year the range touches.
    # Pricing inputs are deliberately empty: the calendar needs labels and end dates
    # only, and plan_year_rows leaves rows unpriced without complaint.
    for year in range(start.year, end.year + 1):
        rows, _warnings = plan_year_rows(year, stored_periods, [], None, None)
        for row in rows:
            if in_range(row.period_end):
                events.append(
                    CalendarEvent(
                        event_date=row.period_end,
                        type="espp_purchase",
                        label=f"ESPP purchase — {row.label}",
                        detail=row.label,
                        href="/espp",
                    )
                )

    # espp_qualify — UNSOLD lots only (the router filters sold_date IS NULL; a sold lot
    # has nothing left to qualify). purchase_date is unique per lot, so it is the label's
    # identity; qualifying dates CAN collide across lots.
    for purchase_date, qualifying_date in unsold_lots:
        if in_range(qualifying_date):
            events.append(
                CalendarEvent(
                    event_date=qualifying_date,
                    type="espp_qualify",
                    label=f"ESPP lot qualifies — {purchase_date.isoformat()}",
                    detail=f"{purchase_date.isoformat()} lot qualifies",
                    href="/espp",
                )
            )

    # offering_start — stored rows only (spec §5: no projected enrollment windows).
    for offering in offerings:
        if in_range(offering.offering_start):
            events.append(
                CalendarEvent(
                    event_date=offering.offering_start,
                    type="offering_start",
                    label="ESPP offering starts",
                    detail=f"subscription price {offering.subscription_price}",
                    href="/espp",
                )
            )

    events.sort(key=lambda event: (event.event_date, event.type, event.label))
    return events
```

(`today`, `announced_ex_divs`, `payday_semi_monthly`, `missing_update_month` are consumed in Task 7 — unused function parameters are not a ruff violation under the repo's rule set, and the signature must not change between tasks.)

- [ ] **Step 4: Run** — same command as Step 2. Expected: PASS (6 tests).
- [ ] **Step 5: Commit.**

```bash
git add -A && git commit -m "feat(calendar): compose() — rsu_vest/espp_purchase/espp_qualify/offering_start"
```

### Task 7: `compose` — ex-dividend, payday, tax deadlines, update-due

**Files:**
- Modify: `backend/app/services/calendar_events.py`
- Test: `backend/tests/test_calendar_events.py`

- [ ] **Step 1: Write the failing tests** (append to `backend/tests/test_calendar_events.py`):

```python
def test_ex_dividend_events_render_the_passed_holdings():
    events = _of_type(
        _compose(
            date(2026, 9, 1),
            date(2026, 9, 30),
            announced_ex_divs=[("NVDA", date(2026, 9, 3)), ("SCHD", date(2026, 10, 7))],
        ),
        "ex_dividend",
    )
    # SCHD's date is outside the range; NVDA's renders with the ticker as detail.
    assert [(e.event_date, e.label, e.detail, e.href) for e in events] == [
        (date(2026, 9, 3), "Ex-dividend — NVDA", "NVDA", "/portfolio")
    ]


def test_paydays_only_for_semi_monthly_cadence():
    window = (date(2026, 8, 1), date(2026, 9, 30))
    assert _of_type(_compose(*window), "payday") == []  # cadence != 24: none, ever
    events = _of_type(_compose(*window, payday_semi_monthly=True), "payday")
    # Aug 15 2026 is a Saturday -> Fri Aug 14; the other three stand (golden table).
    assert [e.event_date for e in events] == [
        date(2026, 8, 14),
        date(2026, 8, 31),
        date(2026, 9, 15),
        date(2026, 9, 30),
    ]
    assert all(e.label == "Payday" and e.detail is None and e.href == "/paycheck" for e in events)


def test_paydays_clip_inside_the_boundary_months():
    events = _of_type(
        _compose(date(2026, 8, 20), date(2026, 9, 10), payday_semi_monthly=True),
        "payday",
    )
    # Aug 14 is before the start, Sep 15 after the end — only Aug 31 survives.
    assert [e.event_date for e in events] == [date(2026, 8, 31)]


def test_tax_deadlines_static_rules():
    events = _of_type(_compose(date(2026, 1, 1), date(2026, 12, 31)), "tax_deadline")
    # None of 2026's five fall on a weekend/holiday — they stand unadjusted.
    assert [(e.event_date, e.detail) for e in events] == [
        (date(2026, 1, 15), "Q4 2025 estimated payment"),
        (date(2026, 4, 15), "federal filing + Q1 estimated payment"),
        (date(2026, 6, 15), "Q2 estimated payment"),
        (date(2026, 9, 15), "Q3 estimated payment"),
        (date(2026, 10, 15), "extension filing deadline"),
    ]
    assert all(e.href == "/taxes" and e.label == f"Tax deadline — {e.detail}" for e in events)


def test_tax_deadline_rolls_forward_over_weekend_and_holiday():
    # Sat Jan 15 2028 -> Sun 16 -> MLK Mon 17 -> Tue Jan 18 (the real IRS behavior).
    events = _of_type(_compose(date(2028, 1, 1), date(2028, 1, 31)), "tax_deadline")
    assert [(e.event_date, e.detail) for e in events] == [
        (date(2028, 1, 18), "Q4 2027 estimated payment")
    ]


def test_update_due_present_when_previous_month_lacks_a_snapshot():
    events = _of_type(
        _compose(
            date(2026, 8, 1),
            date(2026, 10, 31),
            missing_update_month=date(2026, 7, 1),
        ),
        "update_due",
    )
    # max(Aug 1, today=Aug 24) = Aug 24: the reminder never sits in the past.
    assert [(e.event_date, e.label, e.detail, e.href) for e in events] == [
        (date(2026, 8, 24), "Monthly update due", "Enter July 2026", "/update")
    ]


def test_update_due_absent_when_entered_or_out_of_range():
    window = (date(2026, 8, 1), date(2026, 10, 31))
    assert _of_type(_compose(*window), "update_due") == []  # snapshot exists -> no input
    # Missing, but the requested window excludes today: no reminder either.
    later = _compose(
        date(2026, 9, 1), date(2026, 10, 31), missing_update_month=date(2026, 7, 1)
    )
    assert _of_type(later, "update_due") == []
```

- [ ] **Step 2: Run to verify failure** — same pytest command as Task 6. Expected: the seven new tests FAIL (empty lists where events are expected); Task 6's six stay green.

- [ ] **Step 3: Implement.** In `backend/app/services/calendar_events.py`:

1. Add the business-days import (new line under the existing service imports):

```python
from app.services.business_days import next_business_day, semi_monthly_paydays
```

2. Add below `EVENT_TYPES`:

```python
_MONTH_NAMES = (
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
)  # our own literal — calendar.month_name is locale-dependent
```

3. Inside `compose`, insert between the `offering_start` block and the final `events.sort(...)`:

```python
    # ex_dividend — announced dates on ACTIVELY-HELD securities. The router folds the
    # positions and passes only held tickers; §3's refresh keeps the column honest
    # (future-only, cleared once past), so no date math is needed here beyond clipping.
    for ticker, ex_date in announced_ex_divs:
        if in_range(ex_date):
            events.append(
                CalendarEvent(
                    event_date=ex_date,
                    type="ex_dividend",
                    label=f"Ex-dividend — {ticker}",
                    detail=ticker,
                    href="/portfolio",
                )
            )

    # payday — ONLY the semi-monthly cadence (spec §5: pay_periods_per_year == 24; any
    # other cadence omits paydays entirely — the page legend says so in words — because
    # guessing biweekly anchors would be wrong money on the calendar).
    if payday_semi_monthly:
        year, month = start.year, start.month
        while (year, month) <= (end.year, end.month):
            for payday in semi_monthly_paydays(year, month):
                if in_range(payday):
                    events.append(
                        CalendarEvent(
                            event_date=payday,
                            type="payday",
                            label="Payday",
                            detail=None,
                            href="/paycheck",
                        )
                    )
            year, month = (year + 1, 1) if month == 12 else (year, month + 1)

    # tax_deadline — static federal rules adjusted FORWARD (the IRS moves a weekend/
    # holiday due date to the NEXT business day — the opposite of payroll). Jan 15 of
    # year Y is year Y-1's Q4. Apr 15 is ONE event: filing and Q1 share the date, and
    # two same-label events would collide their ICS UIDs.
    for year in range(start.year, end.year + 1):
        for nominal, which in (
            (date(year, 1, 15), f"Q4 {year - 1} estimated payment"),
            (date(year, 4, 15), "federal filing + Q1 estimated payment"),
            (date(year, 6, 15), "Q2 estimated payment"),
            (date(year, 9, 15), "Q3 estimated payment"),
            (date(year, 10, 15), "extension filing deadline"),
        ):
            due = next_business_day(nominal)
            if in_range(due):
                events.append(
                    CalendarEvent(
                        event_date=due,
                        type="tax_deadline",
                        label=f"Tax deadline — {which}",
                        detail=which,
                        href="/taxes",
                    )
                )

    # update_due — one reminder while the previous month's net-worth snapshot is
    # missing, dated max(1st-of-current-month, today) (spec §5: pinned to the month's
    # start but never in the past; today >= its own 1st always, so the max IS today —
    # the expression keeps the spec's wording visible).
    if missing_update_month is not None:
        due = max(date(today.year, today.month, 1), today)
        if in_range(due):
            month_name = _MONTH_NAMES[missing_update_month.month - 1]
            events.append(
                CalendarEvent(
                    event_date=due,
                    type="update_due",
                    label="Monthly update due",
                    detail=f"Enter {month_name} {missing_update_month.year}",
                    href="/update",
                )
            )
```

- [ ] **Step 4: Run the file** — same command. Expected: PASS (13 tests). Then the whole backend suite to catch collateral:

```bash
cd backend && DATABASE_URL="postgresql+asyncpg://finance:finance@localhost:5434/finance" "C:/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe" -m pytest -q
```

Expected: ALL PASS.

- [ ] **Step 5: Commit.**

```bash
git add -A && git commit -m "feat(calendar): compose() — ex_dividend/payday/tax_deadline/update_due"
```

---

## Phase 3 — API

### Task 8: Schemas + `GET /calendar` router + registration

**Files:**
- Create: `backend/app/schemas/calendar.py`, `backend/app/api/calendar.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/test_calendar_api.py`

- [ ] **Step 1: Write the failing tests** — create `backend/tests/test_calendar_api.py`:

```python
"""Endpoint tests: loading + validation + the GET-never-rejects law. Composition RULES
are pinned in test_calendar_events.py — here each type appears once to prove its loader
(the fold's held-filter, the sold-lot filter, the cadence gate, the snapshot probe)."""

from datetime import date
from decimal import Decimal

from app.models import (
    EsppLot,
    EsppOffering,
    NetWorthSnapshot,
    PaycheckProfile,
    PositionTransaction,
    RsuGrant,
    Security,
)

CALENDAR = "/api/v1/calendar"
TODAY = date(2026, 8, 24)  # a Monday; the router's clock is product_today()


def freeze_today(monkeypatch):
    # The router imports the name, so the patch lands on app.api.calendar (the
    # test_prices_api freeze_service_today precedent).
    monkeypatch.setattr("app.api.calendar.product_today", lambda: TODAY)


async def test_calendar_requires_auth(client):
    resp = await client.get(f"{CALENDAR}?start=2026-08-01&end=2026-10-31")
    assert resp.status_code == 401


async def test_calendar_validates_the_span(auth_client):
    reversed_ = await auth_client.get(f"{CALENDAR}?start=2026-10-31&end=2026-08-01")
    assert reversed_.status_code == 422
    assert "start must be on or before end" in reversed_.json()["detail"]
    too_long = await auth_client.get(f"{CALENDAR}?start=2026-01-01&end=2027-02-06")
    assert too_long.status_code == 422
    assert "400 days" in too_long.json()["detail"]
    # 400 days exactly is allowed (<=, not <) — 2026-01-01 + 400d = 2027-02-05.
    boundary = await auth_client.get(f"{CALENDAR}?start=2026-01-01&end=2027-02-05")
    assert boundary.status_code == 200
    missing_end = await auth_client.get(f"{CALENDAR}?start=2026-01-01")
    assert missing_end.status_code == 422  # both params are required


async def test_calendar_composes_the_whole_household_datebook(auth_client, db, monkeypatch):
    freeze_today(monkeypatch)
    # RSU: 400 sh @ 25% cliff from Mar 18 2026 — the Sep 16 quarterly lands in range.
    db.add(
        RsuGrant(
            kind="new_hire", label="2025 offer", focal_year=None, shares=400,
            grant_price=Decimal("100"), first_vest_date=date(2026, 3, 18),
            cliff_pct=Decimal("0.25"), vest_quantum=1,
        )
    )
    # A hand-edited grant the scheduler refuses — must degrade, never 500 (house law).
    db.add(
        RsuGrant(
            kind="refresh", label="broken", focal_year=None, shares=100,
            grant_price=Decimal("100"), first_vest_date=date(2026, 9, 16),
            cliff_pct=Decimal("0.30"), vest_quantum=1,
        )
    )
    # ESPP: one unsold lot qualifying in range, one SOLD lot (excluded), one offering
    # starting in range.
    db.add(
        EsppLot(
            purchase_date=date(2024, 8, 30), qualifying_date=date(2026, 9, 1),
            shares=Decimal("10"), subscription_price=Decimal("48.509"),
            purchase_fmv=Decimal("120"), purchase_price=Decimal("41.23265"),
        )
    )
    db.add(
        EsppLot(
            purchase_date=date(2024, 2, 29), qualifying_date=date(2026, 8, 28),
            shares=Decimal("10"), subscription_price=Decimal("48.509"),
            purchase_fmv=Decimal("120"), purchase_price=Decimal("41.23265"),
            sold_date=date(2025, 1, 2), sold_price=Decimal("130"),
        )
    )
    db.add(EsppOffering(offering_start=date(2026, 9, 1), subscription_price=Decimal("120")))
    # Ex-dividends: NVDA is held; GHOST has no position; GONE was fully sold out.
    nvda = Security(
        ticker="NVDA", name="NVDA Inc", holding_type="stock",
        next_ex_div_date=date(2026, 9, 3),
    )
    ghost = Security(
        ticker="GHOST", name="Ghost", holding_type="stock",
        next_ex_div_date=date(2026, 9, 10),
    )
    gone = Security(
        ticker="GONE", name="Gone", holding_type="stock",
        next_ex_div_date=date(2026, 9, 11),
    )
    db.add_all([nvda, ghost, gone])
    await db.flush()
    db.add(
        PositionTransaction(
            security_id=nvda.id, account="RH Taxable", type="buy",
            shares=Decimal("10"), price=Decimal("100"), sort_index=10,
        )
    )
    db.add(
        PositionTransaction(
            security_id=gone.id, account="RH Taxable", type="buy",
            shares=Decimal("5"), price=Decimal("100"), sort_index=20,
        )
    )
    db.add(
        PositionTransaction(
            security_id=gone.id, account="RH Taxable", type="sell",
            shares=Decimal("5"), price=Decimal("110"), sort_index=30,
        )
    )
    # Semi-monthly profile (model default pay_periods_per_year=24) -> paydays; a June
    # snapshot exists but July 2026 does not -> update_due.
    db.add(PaycheckProfile(effective_date=date(2026, 1, 1), annual_salary=Decimal("120000")))
    db.add(NetWorthSnapshot(month=date(2026, 6, 1)))
    await db.commit()

    resp = await auth_client.get(f"{CALENDAR}?start=2026-08-01&end=2026-09-30")
    assert resp.status_code == 200
    events = resp.json()["events"]
    by_type: dict[str, list[dict]] = {}
    for event in events:
        by_type.setdefault(event["type"], []).append(event)

    assert [(e["date"], e["detail"]) for e in by_type["rsu_vest"]] == [
        ("2026-09-16", "25 sh — 2025 offer")
    ]  # the broken grant is silently absent — that absence IS the degradation
    assert [(e["date"], e["label"]) for e in by_type["espp_qualify"]] == [
        ("2026-09-01", "ESPP lot qualifies — 2024-08-30")
    ]  # the sold lot contributes nothing
    # Numeric(14,5) round-trips at column scale; the detail echoes it verbatim.
    assert [(e["date"], e["detail"]) for e in by_type["offering_start"]] == [
        ("2026-09-01", "subscription price 120.00000")
    ]
    assert [(e["date"], e["detail"]) for e in by_type["ex_dividend"]] == [
        ("2026-09-03", "NVDA")
    ]  # GHOST (never held) and GONE (folded to zero) are filtered out
    assert [e["date"] for e in by_type["payday"]] == [
        "2026-08-14", "2026-08-31", "2026-09-15", "2026-09-30"
    ]
    assert [(e["date"], e["detail"]) for e in by_type["tax_deadline"]] == [
        ("2026-09-15", "Q3 estimated payment")
    ]
    assert [(e["date"], e["detail"], e["href"]) for e in by_type["update_due"]] == [
        ("2026-08-24", "Enter July 2026", "/update")
    ]
    # No stored periods: the derived Mar–Aug 2026 slot's purchase is Aug 31 (Feb 27 is
    # clipped by the range — the clip works through the API too).
    assert [(e["date"], e["detail"]) for e in by_type["espp_purchase"]] == [
        ("2026-08-31", "Mar–Aug 2026")
    ]
    # The payload is sorted by (date, type, label) end to end.
    assert events == sorted(events, key=lambda e: (e["date"], e["type"], e["label"]))


async def test_calendar_omits_paydays_for_other_cadences(auth_client, db, monkeypatch):
    freeze_today(monkeypatch)
    db.add(
        PaycheckProfile(
            effective_date=date(2026, 1, 1),
            annual_salary=Decimal("120000"),
            pay_periods_per_year=26,
        )
    )
    await db.commit()
    resp = await auth_client.get(f"{CALENDAR}?start=2026-08-01&end=2026-09-30")
    assert resp.status_code == 200
    assert [e for e in resp.json()["events"] if e["type"] == "payday"] == []


async def test_calendar_update_due_absent_when_previous_month_entered(
    auth_client, db, monkeypatch
):
    freeze_today(monkeypatch)
    db.add(NetWorthSnapshot(month=date(2026, 7, 1)))
    await db.commit()
    resp = await auth_client.get(f"{CALENDAR}?start=2026-08-01&end=2026-09-30")
    assert [e for e in resp.json()["events"] if e["type"] == "update_due"] == []
```

- [ ] **Step 2: Run to verify failure.**

```bash
cd backend && DATABASE_URL="postgresql+asyncpg://finance:finance@localhost:5434/finance" "C:/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe" -m pytest tests/test_calendar_api.py -q
```

Expected: FAIL — 404s (no route registered).

- [ ] **Step 3: Schemas** — create `backend/app/schemas/calendar.py`:

```python
"""Wire shapes for GET /calendar (2026-08-24 spec §5). No money fields in v1 — labels
and details carry share counts and prices as plain text, so there is nothing to
Decimal-serialize here."""

from datetime import date
from typing import Literal

from pydantic import BaseModel

CalendarEventType = Literal[
    "rsu_vest",
    "espp_purchase",
    "espp_qualify",
    "ex_dividend",
    "payday",
    "offering_start",
    "tax_deadline",
    "update_due",
]


class CalendarEventOut(BaseModel):
    # `date: date` is safe in a pydantic body — an annotation-only statement never binds
    # the name, so the type still resolves. (The SQLAlchemy models rename to *_date
    # because mapped_column ASSIGNS; that hazard does not exist here.)
    date: date
    type: CalendarEventType
    label: str
    detail: str | None
    href: str


class CalendarOut(BaseModel):
    events: list[CalendarEventOut]
```

- [ ] **Step 4: Router** — create `backend/app/api/calendar.py`:

```python
"""GET /calendar — the forward-looking event feed (2026-08-24 spec §5). This router only
LOADS; services/calendar_events.compose owns every rule, so pytest can drive the rules
with literals and this file stays a set of SELECTs. The one heavier load (folding
positions for "actively held") runs only when an announced ex-dividend exists at all."""

from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models import (
    EsppLot,
    EsppOffering,
    EsppPeriod,
    NetWorthSnapshot,
    PaycheckProfile,
    PositionTransaction,
    RsuGrant,
    Security,
)
from app.schemas.calendar import CalendarEventOut, CalendarOut
from app.services.calendar_events import compose
from app.services.espp_calc import OfferingInfo, StoredPeriod
from app.services.portfolio_calc import SHARE_Q, fold_transactions
from app.services.scheduler import product_today

router = APIRouter(prefix="/calendar", tags=["calendar"], dependencies=[Depends(get_current_user)])

ZERO = Decimal("0")
# A year plus wrap slack; the frontend asks for ~3-month windows, the fence is only
# against a runaway query composing decades of derived events.
MAX_SPAN_DAYS = 400


async def _held_ex_dividends(db: AsyncSession) -> list[tuple[str, date]]:
    """(ticker, next_ex_div_date) for ACTIVE securities carrying an announcement that
    are actually HELD — folded shares > 0 summed across accounts (allocation()'s
    zero-share rule, SHARE_Q quantize included so dust does not count as a holding).
    The full fold is the correct shares source (splits multiply; a bare SUM(shares)
    would not), and at personal scale it is one query + arithmetic."""
    candidates = list(
        (
            await db.execute(
                select(Security)
                .where(Security.is_active.is_(True), Security.next_ex_div_date.is_not(None))
                .order_by(Security.ticker)
            )
        ).scalars()
    )
    if not candidates:
        return []
    txns = list(
        (
            await db.execute(
                select(PositionTransaction).order_by(
                    PositionTransaction.sort_index, PositionTransaction.id
                )
            )
        ).scalars()
    )
    shares_by_sec: dict[int, Decimal] = {}
    for pos in fold_transactions(txns).values():
        shares_by_sec[pos.security_id] = shares_by_sec.get(pos.security_id, ZERO) + pos.shares
    return [
        (security.ticker, security.next_ex_div_date)
        for security in candidates
        if shares_by_sec.get(security.id, ZERO).quantize(SHARE_Q, rounding=ROUND_HALF_UP) > 0
    ]


@router.get("", response_model=CalendarOut)
async def get_calendar(
    start: date, end: date, db: AsyncSession = Depends(get_db)
) -> CalendarOut:
    """{events} for [start, end] INCLUSIVE, sorted by (date, type, label). 422 on a
    reversed pair or a span past 400 days (app_settings.py's empty-path route pattern
    under the router prefix). GET-never-rejects: every degradable source degrades inside
    compose(); nothing stored can 500 this."""
    if start > end:
        raise HTTPException(status_code=422, detail="start must be on or before end")
    if (end - start).days > MAX_SPAN_DAYS:
        raise HTTPException(
            status_code=422, detail=f"start to end must span at most {MAX_SPAN_DAYS} days"
        )
    # product_today, never date.today(): the reminder date and the clear/store fence must
    # agree with the scheduler-zone day (comp.py's clock rule).
    today = product_today()

    grants = list(
        (
            await db.execute(select(RsuGrant).order_by(RsuGrant.first_vest_date, RsuGrant.id))
        ).scalars()
    )
    stored_periods = [
        StoredPeriod(
            id=row.id,
            label=row.label,
            period_start=row.period_start,
            period_end=row.period_end,
            semi_annual_base=row.semi_annual_base,
            additional_payments=row.additional_payments,
            contribution_pct=row.contribution_pct,
        )
        for row in (
            await db.execute(select(EsppPeriod).order_by(EsppPeriod.period_end, EsppPeriod.id))
        ).scalars()
    ]
    offerings = [
        OfferingInfo(offering_start=row.offering_start, subscription_price=row.subscription_price)
        for row in (
            await db.execute(select(EsppOffering).order_by(EsppOffering.offering_start))
        ).scalars()
    ]
    unsold_lots = [
        (row.purchase_date, row.qualifying_date)
        for row in (
            await db.execute(
                select(EsppLot).where(EsppLot.sold_date.is_(None)).order_by(EsppLot.purchase_date)
            )
        ).scalars()
    ]
    announced = await _held_ex_dividends(db)
    # "Latest profile" = newest effective_date (spec §5): the cadence the NEXT paychecks
    # follow. Any cadence but 24 omits paydays entirely — worded on the page legend,
    # never guessed here.
    latest_profile = (
        (
            await db.execute(
                select(PaycheckProfile).order_by(PaycheckProfile.effective_date.desc()).limit(1)
            )
        )
        .scalars()
        .first()
    )
    semi_monthly = latest_profile is not None and latest_profile.pay_periods_per_year == 24
    # The update reminder probes the PREVIOUS month's snapshot (the wizard enters a
    # month after it closes).
    prev_month_last_day = date(today.year, today.month, 1) - timedelta(days=1)
    prev_month = date(prev_month_last_day.year, prev_month_last_day.month, 1)
    snapshot = (
        (await db.execute(select(NetWorthSnapshot).where(NetWorthSnapshot.month == prev_month)))
        .scalars()
        .first()
    )

    events = compose(
        start,
        end,
        today=today,
        grants=grants,
        stored_periods=stored_periods,
        offerings=offerings,
        unsold_lots=unsold_lots,
        announced_ex_divs=announced,
        payday_semi_monthly=semi_monthly,
        missing_update_month=None if snapshot is not None else prev_month,
    )
    return CalendarOut(
        events=[
            CalendarEventOut(
                date=event.event_date,
                type=event.type,
                label=event.label,
                detail=event.detail,
                href=event.href,
            )
            for event in events
        ]
    )
```

- [ ] **Step 5: Register.** In `backend/app/main.py`: add `calendar` to the grouped `from app.api import (...)` list in alphabetical position (after `auth`, before `comp`) — this shadows stdlib `calendar` inside main.py only, which never uses it — and add, after the `comp.router` line:

```python
app.include_router(calendar.router, prefix="/api/v1")
```

- [ ] **Step 6: Run** — same command as Step 2. Expected: PASS (5 tests). Then the full backend suite:

```bash
cd backend && DATABASE_URL="postgresql+asyncpg://finance:finance@localhost:5434/finance" "C:/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe" -m pytest -q
```

Expected: ALL PASS.

- [ ] **Step 7: Commit.**

```bash
git add -A && git commit -m "feat(calendar): GET /calendar — schemas, loader router, registration"
```

---

## Phase 4 — Frontend

### Task 9: `months.ts` day-grid helpers

**Files:**
- Modify: `src/utils/months.ts`
- Test: `src/utils/months.test.ts`

- [ ] **Step 1: Write the failing tests** (append to `src/utils/months.test.ts`; extend its import line to `import { addDays, addMonths, currentMonthIso, lastNMonths, monthGrid } from './months'`):

```ts
describe('addDays', () => {
  it('crosses month, year and leap boundaries', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29') // leap year
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
    expect(addDays('2026-08-24', 45)).toBe('2026-10-08') // the Up-next window shape
  })
})

describe('monthGrid', () => {
  it('February 2026 starts on a Sunday and needs no padding', () => {
    const weeks = monthGrid('2026-02-01')
    expect(weeks).toHaveLength(4)
    expect(weeks[0][0]).toBe('2026-02-01')
    expect(weeks[3][6]).toBe('2026-02-28')
  })

  it('August 2026 pads to six Sunday-first weeks', () => {
    const weeks = monthGrid('2026-08-01')
    expect(weeks).toHaveLength(6)
    expect(weeks[0][0]).toBe('2026-07-26') // the Sunday before Sat Aug 1
    expect(weeks[0][6]).toBe('2026-08-01')
    expect(weeks[5][6]).toBe('2026-09-05') // the Saturday after Mon Aug 31
    expect(weeks.flat()).toHaveLength(42)
  })
})
```

- [ ] **Step 2: Run to verify failure.**

```bash
npx vitest run src/utils/months.test.ts
```

Expected: FAIL — `addDays` / `monthGrid` are not exported.

- [ ] **Step 3: Implement** — append to `src/utils/months.ts`:

```ts
// Day-level ISO math for the calendar grid. The y/m/d Date CONSTRUCTOR is local and
// safe — the never-parse-ISO rule guards `new Date(string)` (UTC parsing), not this.
export function addDays(iso: string, delta: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d + delta)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(
    dt.getDate(),
  ).padStart(2, '0')}`
}

// 0 = Sunday … 6 = Saturday (the calendar grid is Sunday-first).
export function isoWeekday(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).getDay()
}

// The month's grid as whole Sunday-first weeks: leading/trailing out-of-month days pad
// to full rows. A 28-day February starting on Sunday is exactly 4 rows, no padding.
export function monthGrid(monthIso: string): string[][] {
  let cursor = addDays(monthIso, -isoWeekday(monthIso))
  const lastOfMonth = addDays(addMonths(monthIso, 1), -1)
  const gridEnd = addDays(lastOfMonth, 6 - isoWeekday(lastOfMonth))
  const weeks: string[][] = []
  while (cursor <= gridEnd) {
    const week: string[] = []
    for (let i = 0; i < 7; i += 1) {
      week.push(cursor)
      cursor = addDays(cursor, 1)
    }
    weeks.push(week)
  }
  return weeks
}
```

- [ ] **Step 4: Run** — same command. Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add -A && git commit -m "feat(calendar): months.ts addDays/isoWeekday/monthGrid"
```

### Task 10: Wire types + API client + calendar view vocabulary

**Files:**
- Modify: `src/types/api.ts`
- Create: `src/api/calendar.ts`, `src/components/calendar/calendarView.ts`
- Test: `src/components/calendar/calendarView.test.ts`

- [ ] **Step 1: Write the failing test** — create `src/components/calendar/calendarView.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { CalendarEvent } from '../../types/api'
import { EVENT_COLORS, EVENT_TYPE_LABELS, EVENT_TYPE_ORDER, groupByDate } from './calendarView'

describe('EVENT_COLORS', () => {
  it('is the FIXED literal slot map — a palette reshuffle or remap must fail here', () => {
    expect(EVENT_COLORS).toEqual({
      rsu_vest: '#3987e5',
      espp_purchase: '#d95926',
      espp_qualify: '#199e70',
      ex_dividend: '#c98500',
      update_due: '#d55181',
      payday: '#008300',
      offering_start: '#9085e9',
      tax_deadline: '#e66767',
    })
  })

  it('gives every type its own hue and the legend names them all', () => {
    expect(new Set(Object.values(EVENT_COLORS)).size).toBe(8)
    expect(EVENT_TYPE_ORDER).toHaveLength(8)
    for (const type of EVENT_TYPE_ORDER) {
      expect(EVENT_COLORS[type]).toBeDefined()
      expect(EVENT_TYPE_LABELS[type].length).toBeGreaterThan(0)
    }
  })
})

describe('groupByDate', () => {
  it('buckets same-day events together, preserving server order', () => {
    const events: CalendarEvent[] = [
      { date: '2026-09-15', type: 'payday', label: 'Payday', detail: null, href: '/paycheck' },
      {
        date: '2026-09-15',
        type: 'tax_deadline',
        label: 'Tax deadline — Q3 estimated payment',
        detail: 'Q3 estimated payment',
        href: '/taxes',
      },
      {
        date: '2026-09-16',
        type: 'rsu_vest',
        label: 'RSU vest — 2025 offer',
        detail: '25 sh — 2025 offer',
        href: '/comp',
      },
    ]
    const grouped = groupByDate(events)
    expect([...grouped.keys()]).toEqual(['2026-09-15', '2026-09-16'])
    expect(grouped.get('2026-09-15')?.map((e) => e.type)).toEqual(['payday', 'tax_deadline'])
  })
})
```

- [ ] **Step 2: Run to verify failure.**

```bash
npx vitest run src/components/calendar/calendarView.test.ts
```

Expected: FAIL — cannot resolve `./calendarView` (and the `CalendarEvent` type import).

- [ ] **Step 3: Types.** In `src/types/api.ts`, add a new region between the `// --- comp: RSU grants + the vesting schedule ---` region's end and `// --- projection ---`:

```ts
// --- calendar ---

export type CalendarEventType =
  | 'rsu_vest'
  | 'espp_purchase'
  | 'espp_qualify'
  | 'ex_dividend'
  | 'payday'
  | 'offering_start'
  | 'tax_deadline'
  | 'update_due'

// One forward-looking event (2026-08-24 spec §5). No money fields in v1 — labels and
// details carry share counts and prices as text. Sorted by (date, type, label) on the
// server; the label carries identity (grant label, lot purchase date) so ICS UIDs built
// from it never collide on same-day same-type events.
export interface CalendarEvent {
  date: string // ISO YYYY-MM-DD
  type: CalendarEventType
  label: string
  detail: string | null
  href: string
}

export interface CalendarResponse {
  events: CalendarEvent[]
}
```

- [ ] **Step 4: Client** — create `src/api/calendar.ts`:

```ts
import { api } from './client'
import type { CalendarResponse } from '../types/api'

// Events for the INCLUSIVE [start, end] ISO-date range, sorted by (date, type, label).
// The server 422s a reversed pair or a span past 400 days — callers pass ~3-month
// windows (the page) or a 45-day one (the Overview strip).
export function fetchCalendar(start: string, end: string): Promise<CalendarResponse> {
  return api<CalendarResponse>(`/calendar?start=${start}&end=${end}`)
}
```

- [ ] **Step 5: View vocabulary** — create `src/components/calendar/calendarView.ts`:

```ts
// Pure calendar-page vocabulary — no React, no fetching (the attention.ts posture).
import { PALETTE } from '../../charts/theme'
import type { CalendarEvent, CalendarEventType } from '../../types/api'

// FIXED type -> PALETTE-slot map (charts/theme's slot discipline: fixed order IS the
// CVD-safety mechanism — never reorder, never cycle). Color is never the only channel:
// every chip carries its label text, and the legend names the types.
export const EVENT_COLORS: Record<CalendarEventType, string> = {
  rsu_vest: PALETTE[0],
  espp_purchase: PALETTE[1],
  espp_qualify: PALETTE[2],
  ex_dividend: PALETTE[3],
  update_due: PALETTE[4],
  payday: PALETTE[5],
  offering_start: PALETTE[6],
  tax_deadline: PALETTE[7],
}

export const EVENT_TYPE_LABELS: Record<CalendarEventType, string> = {
  rsu_vest: 'RSU vest',
  espp_purchase: 'ESPP purchase',
  espp_qualify: 'ESPP qualifying date',
  ex_dividend: 'Ex-dividend',
  payday: 'Payday',
  offering_start: 'ESPP offering start',
  tax_deadline: 'Tax deadline',
  update_due: 'Monthly update due',
}

// Legend order — one place, so the legend and any future filter row agree.
export const EVENT_TYPE_ORDER: CalendarEventType[] = [
  'rsu_vest',
  'espp_purchase',
  'espp_qualify',
  'ex_dividend',
  'payday',
  'offering_start',
  'tax_deadline',
  'update_due',
]

// Events keyed by their ISO date, server order preserved within a day (a Map keeps
// insertion order, so iterating it renders days chronologically for a sorted payload).
export function groupByDate(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const grouped = new Map<string, CalendarEvent[]>()
  for (const event of events) {
    const bucket = grouped.get(event.date)
    if (bucket) bucket.push(event)
    else grouped.set(event.date, [event])
  }
  return grouped
}
```

- [ ] **Step 6: Run** — same command. Expected: PASS (3 tests).
- [ ] **Step 7: Commit.**

```bash
git add -A && git commit -m "feat(calendar): wire types, fetchCalendar client, fixed chip color map"
```

### Task 11: ICS export util

**Files:**
- Create: `src/utils/ics.ts`
- Create: `src/utils/ics.test.ts`

- [ ] **Step 1: Write the failing tests** — create `src/utils/ics.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import type { CalendarEvent } from '../types/api'
import { buildIcs, downloadIcs, escapeIcsText, eventUid } from './ics'

function event(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    date: '2026-09-16',
    type: 'rsu_vest',
    label: 'RSU vest — 2025 offer',
    detail: '25 sh — 2025 offer',
    href: '/comp',
    ...over,
  }
}

describe('eventUid', () => {
  it('is the pinned stable shape — calendar apps dedupe on it across exports', () => {
    expect(eventUid(event())).toBe('rsu_vest-2026-09-16-rsu-vest-2025-offer@finance-dashboard')
    expect(eventUid(event())).toBe(eventUid(event()))
  })
})

describe('escapeIcsText', () => {
  it('escapes RFC 5545 TEXT characters, backslash first', () => {
    expect(escapeIcsText('a,b;c\nd\\e')).toBe('a\\,b\\;c\\nd\\\\e')
    expect(escapeIcsText('crlf\r\nline')).toBe('crlf\\nline')
  })
})

describe('buildIcs', () => {
  it('emits an all-day PUBLISH VEVENT per event with CRLF endings', () => {
    const text = buildIcs([event()])
    const lines = text.split('\r\n')
    expect(lines[0]).toBe('BEGIN:VCALENDAR')
    expect(lines).toContain('METHOD:PUBLISH')
    expect(lines).toContain('UID:rsu_vest-2026-09-16-rsu-vest-2025-offer@finance-dashboard')
    expect(lines).toContain('DTSTART;VALUE=DATE:20260916')
    // DTSTAMP is mandatory in a VEVENT (RFC 5545) and Outlook enforces it; deterministic
    // (the event's own date at midnight Z) so byte-stability survives.
    expect(lines).toContain('DTSTAMP:20260916T000000Z')
    expect(lines).toContain('SUMMARY:RSU vest — 2025 offer')
    expect(lines).toContain('DESCRIPTION:25 sh — 2025 offer — /comp')
    expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(/[^\r]\n/.test(text)).toBe(false) // every newline is CRLF
  })

  it('is byte-stable across exports of the same events', () => {
    const events = [
      event(),
      event({ date: '2026-09-30', type: 'payday', label: 'Payday', detail: null, href: '/paycheck' }),
    ]
    expect(buildIcs(events)).toBe(buildIcs(events))
  })

  it('escapes summaries and falls back to the href-only description', () => {
    const text = buildIcs([event({ label: 'Vest; big, day', detail: null })])
    expect(text).toContain('SUMMARY:Vest\\; big\\, day')
    expect(text).toContain('DESCRIPTION:/comp')
  })
})

describe('downloadIcs', () => {
  it('hands a text/calendar blob to an anchor click and revokes the URL', () => {
    const created: Blob[] = []
    const revoke = vi.fn()
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: (blob: Blob) => {
        created.push(blob)
        return 'blob:calendar'
      },
      revokeObjectURL: revoke,
    })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    downloadIcs([event()])
    expect(created).toHaveLength(1)
    expect(created[0].type).toBe('text/calendar;charset=utf-8')
    expect(click).toHaveBeenCalledTimes(1)
    expect(revoke).toHaveBeenCalledWith('blob:calendar')
    click.mockRestore()
    vi.unstubAllGlobals()
  })
})
```

- [ ] **Step 2: Run to verify failure.**

```bash
npx vitest run src/utils/ics.test.ts
```

Expected: FAIL — cannot resolve `./ics`.

- [ ] **Step 3: Implement** — create `src/utils/ics.ts`:

```ts
// Client-side ICS export (2026-08-24 spec §6): a VCALENDAR/PUBLISH text with one
// all-day VEVENT per fetched event. Pure text builder + a blob-download shim, so the
// text is a function of the events alone — that is what makes UIDs (and the whole
// export) stable across exports, letting calendar apps UPDATE instead of duplicating.
// DTSTAMP is mandatory in a VEVENT (RFC 5545 §3.6.1) and Outlook is the client that
// enforces it — but a real clock would break byte-stability, so it is DETERMINISTIC:
// the event's own date at 00:00:00Z. Deliberate omission, accepted: no 75-octet line
// folding (labels/details are short human lines).
import type { CalendarEvent } from '../types/api'

// RFC 5545 §3.3.11 TEXT escaping: backslash FIRST, then semicolon, comma, newlines.
export function escapeIcsText(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')
    .replaceAll('\r\n', '\\n')
    .replaceAll('\n', '\\n')
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// UID stability contract (pinned by test): the same event yields the same UID on every
// export. Labels carry identity (the server's rule), so same-day same-type events from
// different sources never collide.
export function eventUid(event: CalendarEvent): string {
  return `${event.type}-${event.date}-${slugify(event.label)}@finance-dashboard`
}

export function buildIcs(events: CalendarEvent[]): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//finance-dashboard//calendar//EN',
    'METHOD:PUBLISH',
  ]
  for (const event of events) {
    // DESCRIPTION = detail + href (spec §6); href is always present, so a detail-less
    // event still describes where it lives in the app.
    const description = [event.detail, event.href].filter(Boolean).join(' — ')
    lines.push(
      'BEGIN:VEVENT',
      `UID:${eventUid(event)}`,
      `DTSTAMP:${event.date.replaceAll('-', '')}T000000Z`,
      `DTSTART;VALUE=DATE:${event.date.replaceAll('-', '')}`,
      `SUMMARY:${escapeIcsText(event.label)}`,
      `DESCRIPTION:${escapeIcsText(description)}`,
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n') + '\r\n'
}

export function downloadIcs(
  events: CalendarEvent[],
  filename = 'financial-calendar.ics',
): void {
  const blob = new Blob([buildIcs(events)], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
```

- [ ] **Step 4: Run** — same command. Expected: PASS (6 tests).
- [ ] **Step 5: Commit.**

```bash
git add -A && git commit -m "feat(calendar): ICS builder — stable UIDs, RFC 5545 escaping, blob download"
```

### Task 12: CalendarPage + route + nav (and the ESPP icon swap)

**Files:**
- Create: `src/pages/CalendarPage.tsx`, `src/pages/CalendarPage.css`
- Modify: `src/App.tsx`, `src/components/Layout.tsx`
- Create: `src/pages/CalendarPage.test.tsx`

- [ ] **Step 1: Write the failing tests** — create `src/pages/CalendarPage.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import type { CalendarEvent, CalendarResponse } from '../types/api'
import { addDays, addMonths, currentMonthIso } from '../utils/months'
import CalendarPage from './CalendarPage'

vi.mock('../api/calendar', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/calendar')>()),
  fetchCalendar: vi.fn(),
}))
vi.mock('../utils/ics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/ics')>()),
  downloadIcs: vi.fn(),
}))
import { fetchCalendar } from '../api/calendar'
import { downloadIcs } from '../utils/ics'

// Wall-clock-proof fixtures (OverviewPage.test's NW_MONTHS discipline): the page boots
// on currentMonthIso(), so every fixture date derives from the run's real month.
const MONTH = currentMonthIso()
const DAY_15 = `${MONTH.slice(0, 8)}15`

function fixtureEvents(): CalendarEvent[] {
  return [
    {
      date: DAY_15,
      type: 'rsu_vest',
      label: 'RSU vest — 2025 offer',
      detail: '25 sh — 2025 offer',
      href: '/comp',
    },
    { date: DAY_15, type: 'payday', label: 'Payday', detail: null, href: '/paycheck' },
    {
      date: addDays(DAY_15, 3),
      type: 'ex_dividend',
      label: 'Ex-dividend — NVDA',
      detail: 'NVDA',
      href: '/portfolio',
    },
  ]
}

function windowFor(monthIso: string): [string, string] {
  return [addMonths(monthIso, -1), addDays(addMonths(monthIso, 2), -1)]
}

function renderPage(payload: CalendarEvent[] = fixtureEvents()) {
  vi.mocked(fetchCalendar).mockResolvedValue({ events: payload } satisfies CalendarResponse)
  return render(
    <MemoryRouter>
      <CalendarPage />
    </MemoryRouter>,
  )
}

function grid(): HTMLElement {
  const node = document.querySelector('.cal-grid')
  expect(node).not.toBeNull()
  return node as HTMLElement
}

beforeEach(() => {
  vi.clearAllMocks()
})

// Manual cleanup, OverviewPage.test's hygiene: vitest runs without injected globals, so
// RTL cannot auto-register afterEach — without this, renders accumulate across tests.
afterEach(cleanup)

describe('CalendarPage', () => {
  it('fetches the 3-month window around the shown month', async () => {
    renderPage()
    await screen.findAllByText('RSU vest — 2025 offer')
    const [start, end] = windowFor(MONTH)
    expect(fetchCalendar).toHaveBeenCalledWith(start, end)
  })

  it('places chips on their day — a multi-event day carries them all, linked', async () => {
    renderPage()
    await screen.findAllByText('RSU vest — 2025 offer')
    const chips = Array.from(grid().querySelectorAll('a.cal-chip'))
    const texts = chips.map((chip) => chip.textContent)
    expect(texts).toContain('RSU vest — 2025 offer')
    expect(texts).toContain('Payday') // same day, second chip
    expect(texts).toContain('Ex-dividend — NVDA')
    const vestChip = chips.find((chip) => chip.textContent === 'RSU vest — 2025 offer')
    expect(vestChip?.getAttribute('href')).toBe('/comp')
    // Colored per the fixed type map — but never color alone: the text IS on the chip.
    expect(vestChip?.getAttribute('style')).toContain('border-left-color')
  })

  it('renders the accessible date-grouped list for the shown month', async () => {
    renderPage()
    await screen.findAllByText('RSU vest — 2025 offer')
    const list = document.querySelector('.cal-list')
    expect(list).not.toBeNull()
    expect(list?.textContent).toContain('RSU vest — 2025 offer')
    expect(list?.textContent).toContain('25 sh — 2025 offer')
    expect(list?.textContent).toContain('Payday')
  })

  it('names all eight event types in the legend, with the cadence/honesty note', async () => {
    renderPage()
    await screen.findAllByText('RSU vest — 2025 offer')
    for (const name of [
      'RSU vest',
      'ESPP purchase',
      'ESPP qualifying date',
      'Ex-dividend',
      'Payday',
      'ESPP offering start',
      'Tax deadline',
      'Monthly update due',
    ]) {
      expect(screen.getAllByText(name).length).toBeGreaterThan(0)
    }
    screen.getByText(/semi-monthly \(24 checks\/yr\)/)
    screen.getByText(/confirmed announcements only/)
  })

  it('prev / Today / next refetch the shifted window', async () => {
    renderPage()
    await screen.findAllByText('RSU vest — 2025 offer')
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    await waitFor(() =>
      expect(vi.mocked(fetchCalendar).mock.calls.at(-1)).toEqual(
        windowFor(addMonths(MONTH, -1)),
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    await waitFor(() =>
      expect(vi.mocked(fetchCalendar).mock.calls.at(-1)).toEqual(windowFor(MONTH)),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    await waitFor(() =>
      expect(vi.mocked(fetchCalendar).mock.calls.at(-1)).toEqual(
        windowFor(addMonths(MONTH, 1)),
      ),
    )
  })

  it('shows the empty note when the window has no events', async () => {
    renderPage([])
    await screen.findByText(/No events in this window/)
  })

  it('shows the error banner with a working Retry', async () => {
    vi.mocked(fetchCalendar).mockRejectedValueOnce(new ApiError('calendar down', 500))
    vi.mocked(fetchCalendar).mockResolvedValueOnce({ events: fixtureEvents() })
    render(
      <MemoryRouter>
        <CalendarPage />
      </MemoryRouter>,
    )
    await screen.findByText(/calendar down/)
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading the calendar' }))
    await screen.findAllByText('RSU vest — 2025 offer')
  })

  it('exports the fetched window through downloadIcs', async () => {
    renderPage()
    await screen.findAllByText('RSU vest — 2025 offer')
    fireEvent.click(screen.getByRole('button', { name: 'Add to calendar (.ics)' }))
    expect(downloadIcs).toHaveBeenCalledWith(fixtureEvents())
  })
})
```

- [ ] **Step 2: Run to verify failure.**

```bash
npx vitest run src/pages/CalendarPage.test.tsx
```

Expected: FAIL — cannot resolve `./CalendarPage`.

- [ ] **Step 3: The page** — create `src/pages/CalendarPage.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { ApiError } from '../api/client'
import { fetchCalendar } from '../api/calendar'
import {
  EVENT_COLORS,
  EVENT_TYPE_LABELS,
  EVENT_TYPE_ORDER,
  groupByDate,
} from '../components/calendar/calendarView'
import type { CalendarEvent } from '../types/api'
import { formatDate, formatMonth } from '../utils/format'
import { downloadIcs } from '../utils/ics'
import { addDays, addMonths, currentMonthIso, monthGrid, todayIso } from '../utils/months'
import '../components/panels.css'
import './CalendarPage.css'

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// The fetched window: the shown month plus one either side, so ‹/› already have their
// out-of-month chips before the next fetch lands and the ICS export covers a quarter.
function windowFor(monthIso: string): { start: string; end: string } {
  return { start: addMonths(monthIso, -1), end: addDays(addMonths(monthIso, 2), -1) }
}

export default function CalendarPage() {
  const [month, setMonth] = useState<string>(currentMonthIso())
  const [events, setEvents] = useState<CalendarEvent[] | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const seqRef = useRef(0)

  const load = (monthIso: string) => {
    const seq = ++seqRef.current
    const { start, end } = windowFor(monthIso)
    fetchCalendar(start, end)
      .then((data) => {
        if (seq !== seqRef.current) return
        setEvents(data.events)
        setError(null)
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        setError(err instanceof ApiError ? err.message : 'Could not load the calendar.')
      })
      .finally(() => {
        if (seq === seqRef.current) setBusy(false)
      })
  }

  useEffect(() => {
    load(month)
    // mount-only: month changes call load directly (EsppPage's selectYear pattern)
  }, [])

  const showMonth = (next: string) => {
    setMonth(next)
    setBusy(true)
    load(next)
  }

  const reload = () => {
    setBusy(true)
    load(month)
  }

  const today = todayIso()
  const weeks = monthGrid(month)
  const byDate = groupByDate(events ?? [])
  // The list (and the mobile rendering) shows the SHOWN month only; the grid also
  // renders the padded out-of-month days' chips, dimmed with their cells.
  const monthEvents = (events ?? []).filter((e) => e.date.slice(0, 7) === month.slice(0, 7))
  const listGroups = [...groupByDate(monthEvents).entries()]

  return (
    <div className="page calendar-page">
      <header className="page-header">
        <h1>Calendar</h1>
        <div className="spacer" />
        <button
          type="button"
          className="button"
          disabled={events === null || events.length === 0}
          onClick={() => events !== null && downloadIcs(events)}
        >
          Add to calendar (.ics)
        </button>
      </header>
      {error && (
        <div className="error-banner" role="alert">
          {events === null ? error : `${error} — the page may be showing earlier data.`}{' '}
          <button className="button" aria-label="Retry loading the calendar" onClick={reload}>
            Retry
          </button>
        </div>
      )}
      {events === null ? (
        busy && <p className="empty-note">Loading…</p>
      ) : (
        <div className={`loading-dim${busy ? ' is-loading' : ''}`}>
          <section className="card">
            <div className="cal-controls">
              <button
                type="button"
                className="button"
                aria-label="Previous month"
                onClick={() => showMonth(addMonths(month, -1))}
              >
                ‹
              </button>
              <button type="button" className="button" onClick={() => showMonth(currentMonthIso())}>
                Today
              </button>
              <button
                type="button"
                className="button"
                aria-label="Next month"
                onClick={() => showMonth(addMonths(month, 1))}
              >
                ›
              </button>
              <h2 className="cal-title">{formatMonth(month)}</h2>
            </div>
            {/* Plain divs, no grid role: the date-grouped list below is the accessible
                (and mobile) rendering — spec §6. */}
            <div className="cal-grid">
              {DOW.map((dow) => (
                <div key={dow} className="cal-dow">
                  {dow}
                </div>
              ))}
              {weeks.flat().map((day) => {
                const outside = day.slice(0, 7) !== month.slice(0, 7)
                return (
                  <div
                    key={day}
                    className={`cal-day${outside ? ' cal-day-outside' : ''}${
                      day === today ? ' cal-day-today' : ''
                    }`}
                  >
                    <div className="cal-day-number">{Number(day.slice(8, 10))}</div>
                    {(byDate.get(day) ?? []).map((event) => (
                      <NavLink
                        key={`${event.type}-${event.date}-${event.label}`}
                        className="cal-chip"
                        to={event.href}
                        title={event.detail ?? event.label}
                        style={{ borderLeftColor: EVENT_COLORS[event.type] }}
                      >
                        {event.label}
                      </NavLink>
                    ))}
                  </div>
                )
              })}
            </div>
            <div className="cal-legend">
              {EVENT_TYPE_ORDER.map((type) => (
                <span key={type} className="cal-legend-item">
                  <span
                    className="cal-legend-dot"
                    style={{ backgroundColor: EVENT_COLORS[type] }}
                    aria-hidden="true"
                  />
                  {EVENT_TYPE_LABELS[type]}
                </span>
              ))}
            </div>
            {/* The worded notes the spec requires in the legend (§5 payday row, §3.2
                data honesty): omissions and confirmed-only are said, not implied. */}
            <p className="drill-hint">
              Paydays appear only for semi-monthly (24 checks/yr) paycheck profiles — other
              cadences are omitted rather than guessed. Ex-dividend dates are confirmed
              announcements only: stocks typically publish 2–6 weeks ahead, ETFs often just
              days ahead, so a quiet stretch may simply be unannounced.
            </p>
            {events.length === 0 && (
              <p className="empty-note">
                No events in this window — vests, purchases and paydays appear once grants,
                periods and a paycheck profile are entered.
              </p>
            )}
          </section>
          <section className="card">
            <h2 className="eyebrow">{formatMonth(month)} — list</h2>
            {listGroups.length === 0 ? (
              <p className="empty-note">Nothing this month.</p>
            ) : (
              <ul className="cal-list">
                {listGroups.map(([day, dayEvents]) => (
                  <li key={day}>
                    <span className="cal-list-date">{formatDate(day)}</span>
                    <ul>
                      {dayEvents.map((event) => (
                        <li key={`${event.type}-${event.label}`}>
                          <NavLink to={event.href} className="cal-list-link">
                            {event.label}
                          </NavLink>
                          {event.detail !== null && event.detail !== event.label && (
                            <span className="cal-list-detail"> — {event.detail}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: The stylesheet** — create `src/pages/CalendarPage.css`:

```css
/* Page-scoped rules only (OverviewPage.css's charter): .page/.card/.eyebrow/.button/
   .error-banner/.empty-note/.drill-hint/.loading-dim live in panels.css. */

.cal-controls {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.cal-title {
  margin: 0 0 0 0.5rem;
  font-size: 1.05rem;
  font-weight: 650;
}

/* The 7-col month grid. Chips need links and multi-event days, which is why this is
   CSS grid and not a chart surface. */
.cal-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 4px;
}

.cal-dow {
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--muted);
  padding: 0 6px 4px;
}

.cal-day {
  min-height: 92px;
  border: 1px solid var(--surface-2);
  border-radius: 8px;
  padding: 4px 6px;
  min-width: 0;
}

.cal-day-outside {
  opacity: 0.45;
}

.cal-day-today {
  border-color: var(--accent);
}

.cal-day-number {
  font-size: 0.7rem;
  color: var(--muted);
}

/* Chips: color is the LEFT BORDER (the attention-item accent grammar) and the label
   text always rides along — type identity never rides color alone. */
.cal-chip {
  display: block;
  margin-top: 3px;
  padding: 1px 5px;
  border-left: 3px solid var(--border);
  border-radius: 4px;
  background: var(--surface-2);
  color: var(--text);
  font-size: 0.68rem;
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cal-chip:hover {
  filter: brightness(1.15);
}

.cal-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 1rem;
  margin: 0.75rem 0 0.35rem;
  font-size: 0.75rem;
  color: var(--muted);
}

.cal-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.cal-legend-dot {
  width: 9px;
  height: 9px;
  border-radius: 2px;
  display: inline-block;
}

/* The date-grouped list — also the mobile rendering (the grid hides when cramped). */
.cal-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.cal-list > li {
  padding: 0.4rem 0;
  border-bottom: 1px solid var(--surface-2);
}

.cal-list ul {
  list-style: none;
  margin: 0.15rem 0 0;
  padding: 0;
}

.cal-list-date {
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--muted);
}

.cal-list-link {
  color: var(--text);
  text-decoration: none;
}

.cal-list-link:hover {
  text-decoration: underline;
}

.cal-list-detail {
  color: var(--muted);
  font-size: 0.8rem;
}

@media (max-width: 720px) {
  /* Spec §6: the list IS the mobile rendering when the grid gets cramped. */
  .cal-grid {
    display: none;
  }
}
```

- [ ] **Step 5: Route.** In `src/App.tsx`: add with the other lazy pages

```tsx
const CalendarPage = lazy(() => import('./pages/CalendarPage'))
```

and, after the `/comp` route line:

```tsx
              <Route path="/calendar" element={<CalendarPage />} />
```

- [ ] **Step 6: Nav + icon swap.** In `src/components/Layout.tsx`: extend the lucide import to include `CalendarDays` and `PiggyBank` (alphabetical position — `Banknote` STAYS: Paycheck keeps it), then in `NAV_ITEMS` change the ESPP line and insert Calendar after Comp:

```tsx
  { to: '/espp', label: 'ESPP', icon: PiggyBank },
  { to: '/paycheck', label: 'Paycheck', icon: Banknote },
  { to: '/comp', label: 'Comp', icon: Briefcase },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/projection', label: 'Projection', icon: Telescope },
```

(The swap ends the Banknote duplicate the spec calls out — ESPP finally has its own icon.)

- [ ] **Step 7: Run.**

```bash
npx vitest run src/pages/CalendarPage.test.tsx
```

Expected: PASS (8 tests). Then `npm run lint` → clean for the new/touched files.

- [ ] **Step 8: Commit.**

```bash
git add -A && git commit -m "feat(calendar): /calendar page — month grid, list, legend, ICS button, nav + icon swap"
```

### Task 13: Overview "Up next" strip (separate fetch)

**Files:**
- Create: `src/components/overview/upNext.ts`, `src/components/overview/upNext.test.ts`
- Modify: `src/pages/OverviewPage.tsx`, `src/pages/OverviewPage.css`
- Test: `src/pages/OverviewPage.test.tsx`

- [ ] **Step 1: Write the failing pure-helper tests** — create `src/components/overview/upNext.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { CalendarEvent } from '../../types/api'
import { UP_NEXT_LIMIT, UP_NEXT_WINDOW_DAYS, upNextItems } from './upNext'

function ev(date: string): CalendarEvent {
  return { date, type: 'payday', label: `Event ${date}`, detail: null, href: '/paycheck' }
}

describe('upNextItems', () => {
  it('keeps server order and trims to the limit', () => {
    const events = [
      '2026-08-25',
      '2026-08-31',
      '2026-09-01',
      '2026-09-03',
      '2026-09-15',
      '2026-09-16',
    ].map(ev)
    const picked = upNextItems(events, '2026-08-24')
    expect(picked).toHaveLength(UP_NEXT_LIMIT)
    expect(picked.map((e) => e.date)).toEqual([
      '2026-08-25',
      '2026-08-31',
      '2026-09-01',
      '2026-09-03',
      '2026-09-15',
    ])
  })

  it('drops events already past the injected today, keeps today itself', () => {
    const picked = upNextItems([ev('2026-08-20'), ev('2026-08-24'), ev('2026-08-30')], '2026-08-24')
    expect(picked.map((e) => e.date)).toEqual(['2026-08-24', '2026-08-30'])
  })

  it('pins the strip window the page fetches', () => {
    expect(UP_NEXT_WINDOW_DAYS).toBe(45)
    expect(UP_NEXT_LIMIT).toBe(5)
  })
})
```

- [ ] **Step 2: Run to verify failure.**

```bash
npx vitest run src/components/overview/upNext.test.ts
```

Expected: FAIL — cannot resolve `./upNext`.

- [ ] **Step 3: Implement the helper** — create `src/components/overview/upNext.ts`:

```ts
// Pure Up-next math for the overview strip (attention.ts's charter: no React, no
// fetching, todayIso injectable). The server already sorts by (date, type, label);
// this only guards a cached payload straddling midnight and trims to the strip size.
import type { CalendarEvent } from '../../types/api'

export const UP_NEXT_LIMIT = 5
export const UP_NEXT_WINDOW_DAYS = 45

export function upNextItems(events: CalendarEvent[], todayIso: string): CalendarEvent[] {
  return events.filter((event) => event.date >= todayIso).slice(0, UP_NEXT_LIMIT)
}
```

Run the Step 2 command again → PASS (3 tests).

- [ ] **Step 4: Wire the strip into OverviewPage.** In `src/pages/OverviewPage.tsx`:

1. Add imports: `import { fetchCalendar } from '../api/calendar'`; extend the months import to `import { addDays, todayIso } from '../utils/months'`; add `import { UP_NEXT_WINDOW_DAYS, upNextItems } from '../components/overview/upNext'`; add `CalendarEvent` to the type-import list from `'../types/api'`.

2. Add state + loader inside `OverviewPage()`, after the existing `seqRef` line:

```tsx
  // The forward-looking strip is a SEPARATE fetch with its own tiny error state: the
  // snapshot Promise.all above stays untouched (its all-or-nothing contract is the
  // page's point), and a calendar hiccup must not take the overview down — or the
  // reverse. It renders inside the snapshot branch because it SITS with the freshness
  // footer; a failed first snapshot shows the banner alone, house posture.
  const [upNext, setUpNext] = useState<CalendarEvent[] | null>(null)
  const [upNextFailed, setUpNextFailed] = useState(false)
  const upNextSeq = useRef(0)

  const loadUpNext = () => {
    const seq = ++upNextSeq.current
    const today = todayIso()
    fetchCalendar(today, addDays(today, UP_NEXT_WINDOW_DAYS))
      .then((data) => {
        if (seq !== upNextSeq.current) return
        setUpNext(data.events)
        setUpNextFailed(false)
      })
      .catch(() => {
        if (seq !== upNextSeq.current) return
        setUpNextFailed(true)
      })
  }
```

3. Call it from the mount effect and from `reload()` (one added line in each):

```tsx
  useEffect(() => {
    load()
    loadUpNext()
    // mount-only: load is a plain function over stable setters (house idiom)
  }, [])
```

```tsx
  const reload = () => {
    setBusy(true)
    load()
    loadUpNext()
  }
```

4. Render the strip directly ABOVE the `<div className="overview-freshness">` block (inside the `data !== null` branch):

```tsx
          <div className="up-next">
            <h2 className="eyebrow">
              Up next
              <InfoHint text="The next few dated events — vests, ESPP dates, ex-dividends, paydays, deadlines — from the calendar." />
            </h2>
            {upNextFailed ? (
              <p className="drill-hint">Couldn&apos;t load upcoming events.</p>
            ) : upNext === null ? null : upNextItems(upNext, todayIso()).length === 0 ? (
              <p className="drill-hint">
                Nothing scheduled in the next {UP_NEXT_WINDOW_DAYS} days.
              </p>
            ) : (
              <ul className="up-next-list">
                {upNextItems(upNext, todayIso()).map((event) => (
                  <li key={`${event.type}-${event.date}-${event.label}`}>
                    <NavLink to={event.href} className="up-next-link">
                      <span className="up-next-date">{formatDate(event.date)}</span>{' '}
                      {event.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            )}
            <NavLink className="drill-hint" to="/calendar">
              Open calendar →
            </NavLink>
          </div>
```

5. Append to `src/pages/OverviewPage.css`:

```css
/* Up-next strip: the forward-looking sibling of the freshness footer below it. */
.up-next {
  margin-top: 1.25rem;
}

.up-next-list {
  list-style: none;
  margin: 0 0 0.35rem;
  padding: 0;
}

.up-next-list li {
  padding: 2px 0;
}

.up-next-link {
  color: var(--text);
  text-decoration: none;
  font-size: 0.85rem;
}

.up-next-link:hover {
  text-decoration: underline;
}

.up-next-date {
  color: var(--muted);
  font-variant-numeric: tabular-nums;
  margin-right: 0.25rem;
}
```

- [ ] **Step 5: Update the Overview tests.** In `src/pages/OverviewPage.test.tsx`:

1. Add the mock beside the others:

```tsx
vi.mock('../api/calendar', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/calendar')>()),
  fetchCalendar: vi.fn(),
}))
```

and `import { fetchCalendar } from '../api/calendar'` next to the other post-mock imports, plus `CalendarEvent` in the type-import list.

2. Add a fixture builder near `lotsOut` (it reuses the file's `daysAgo` — negative days = future):

```tsx
function upNextEvents(count = 6): CalendarEvent[] {
  return Array.from({ length: count }, (_, i) => ({
    date: daysAgo(-(i + 1)),
    type: 'payday' as const,
    label: `Upcoming event ${i + 1}`,
    detail: null,
    href: '/paycheck',
  }))
}
```

3. Arm it inside `serve()` (last line before `return payload`) and in `failAll()`:

```tsx
  vi.mocked(fetchCalendar).mockResolvedValue({ events: upNextEvents() })
```

```tsx
  vi.mocked(fetchCalendar).mockImplementation(boom)
```

4. Append two tests (the file's existing `serve()`/`renderPage()` idioms):

```tsx
it('renders the next five calendar events as links, and only five', async () => {
  serve()
  renderPage()
  await screen.findByText('Upcoming event 1')
  screen.getByText('Upcoming event 5')
  expect(screen.queryByText('Upcoming event 6')).toBeNull()
  const link = screen.getByText(/Upcoming event 1/).closest('a')
  expect(link?.getAttribute('href')).toBe('/paycheck')
  // A SEPARATE fetch — exactly one calendar call, never a twelfth Promise.all member.
  expect(vi.mocked(fetchCalendar)).toHaveBeenCalledTimes(1)
})

it('a calendar failure dents only the strip, never the snapshot', async () => {
  serve()
  vi.mocked(fetchCalendar).mockRejectedValue(new ApiError('calendar down', 500))
  renderPage()
  await screen.findByText(/Couldn't load upcoming events/)
  screen.getByText(/Net worth —/) // the snapshot half rendered normally
  expect(screen.queryByRole('alert')).toBeNull() // and no page-level banner fired
})
```

- [ ] **Step 6: Run.**

```bash
npx vitest run src/components/overview/upNext.test.ts src/pages/OverviewPage.test.tsx
```

Expected: ALL PASS (existing Overview tests untouched — `serve()` arms the new mock for all of them).

- [ ] **Step 7: Commit.**

```bash
git add -A && git commit -m "feat(calendar): Overview Up-next strip — separate fetch beside the freshness footer"
```

---

## Phase 5 — Verification

### Task 14: Full green suites, lint, build, spec status

- [ ] **Step 1: Full backend suite.**

```bash
cd backend && DATABASE_URL="postgresql+asyncpg://finance:finance@localhost:5434/finance" "C:/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe" -m pytest -q
```

Expected: ALL PASS (record the count — prior suite + this plan's ~31 new backend tests).

- [ ] **Step 2: Ruff** (same interpreter; format may rewrite — if it does, re-run the touched test files and commit the reformat):

```bash
cd backend && "C:/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe" -m ruff check app tests
cd backend && "C:/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe" -m ruff format app tests
```

Expected: `check` reports no violations; `format` reports files unchanged (or reformats — then re-run Step 1 and include the changes in the Step 6 commit).

- [ ] **Step 3: Full frontend suite.**

```bash
npx vitest run
```

Expected: ALL PASS (record the count — prior suite + this plan's ~22 new frontend tests).

- [ ] **Step 4: Lint + build.**

```bash
npm run lint
npm run build
```

Expected: both clean. `build` prints chunk sizes — a NEW small CalendarPage chunk appears; the entry and echarts chunks must not regress (no chart code changed).

- [ ] **Step 5: Reminder — do NOT run alembic here.** The migration's `down_revision` (`b7c4e1f2a9d3`) lives on the parallel category-budgets branch; the orchestrator runs `upgrade head` / `check` / round-trip after merging both branches.

- [ ] **Step 6: Spec status line.** In `docs/superpowers/specs/2026-08-24-financial-calendar-design.md`, change the status line from `**Date:** 2026-08-24 · **Status:** approved, not yet implemented` to `**Date:** 2026-08-24 · **Status:** implemented 2026-08-24 (branch financial-calendar)`. Commit everything outstanding:

```bash
git add -A && git commit -m "docs(calendar): spec status — implemented; verification green"
```

- [ ] **Step 7: STOP.** Confirm `git status` is clean and every task above is committed on `financial-calendar`. Do NOT merge, do NOT push, do NOT delete anything — the orchestrator merges both branches and runs the alembic round-trip post-merge. Leave a final summary naming: the migration id (`d2f8a6b3c1e7`, chained onto the parallel branch's `b7c4e1f2a9d3`), backend/frontend test counts, the new CalendarPage chunk size, and the deploy note (the announced-ex-div column fills over the first few daily refreshes; ETFs often announce only days ahead — spec §3.2's data-honesty copy is on the calendar page legend).
