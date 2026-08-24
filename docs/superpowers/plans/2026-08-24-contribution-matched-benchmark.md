# Contribution-Matched Benchmark Line Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A second benchmark line on the performance chart — **"VOO (your contributions)"**: what the account would be worth had every dollar put in bought VOO instead — computed at read time from the stored weekly series (cost-basis deltas proxy the flows), carried on `GET /portfolio/history` as `benchmark`, and drawn in palette slot 4 on both chart consumers.

**Architecture:** A pure recurrence in `services/value_history.py` (`contribution_benchmark`) maps weekly `(snapshot_date, market_value, cost_basis)` rows plus a date→VOO-close dict to the benchmark series; a one-query loader (`baseline_closes_for`) resolves the on-or-before close per snapshot date with a two-pointer walk over all VOO bars. The history endpoint derives the leg per request — no stored column, no migration, no splice risk when a re-import overrides history rows — and the shared option builder adds the fourth line, so PortfolioPage and OverviewPage both get it with zero page-level series changes.

**Tech Stack:** FastAPI + SQLAlchemy 2 async + Postgres 16 (real-DB pytest), React 19 + TypeScript + Vitest + ECharts. No new dependencies; no migration; no stored state.

**Spec:** `docs/superpowers/specs/2026-08-24-contribution-matched-benchmark-design.md` — cite it for any ambiguity. §2 is the recurrence contract; §3 lists the approximations that are documented, not fixed; §4 is the wire/chart contract; §5 the test list.

**Overnight protocol:** work happens in the MAIN checkout on branch `contribution-benchmark` (the venv and the dev Postgres on localhost:5433 live here; the orchestrator creates the branch; Task 0 verifies clean `git status`, the correct branch, and that `cd backend && .venv/Scripts/python -m pytest tests/test_health.py -q` passes). No migrations in this feature. No file deletions. Never push. Frequent small commits.

**House rules that bind every task:** GETs never reject stored data; server sentences render verbatim; Decimal strings on the wire; plain quantize on read paths; focus-before-reset on save-success paths; `+ ZERO` on wire-bound Decimals; comments explain constraints, not narration.

---

## File structure

| File | Responsibility |
|---|---|
| `backend/app/services/value_history.py` | `contribution_benchmark` (pure recurrence) + `baseline_closes_for` (one-query on-or-before loader) |
| `backend/app/schemas/portfolio.py` | `PortfolioHistoryOut` gains `benchmark: list[Decimal \| None]` |
| `backend/app/api/portfolio.py` | `/portfolio/history` computes the leg at read time |
| `backend/tests/test_value_history.py` | NEW — pure-function + loader suites (literal-driven) |
| `backend/tests/test_portfolio_api.py` | history endpoint: alignment + all-null degradation |
| `src/types/api.ts` | `PortfolioHistory` gains `benchmark: (string \| null)[]` |
| `src/components/portfolio/historyChartOptions.ts` (+ `.test.ts`) | fourth line series "VOO (your contributions)", slot 4, no wash |
| `src/pages/OverviewPage.test.tsx` | `historyOut` fixture gains the field (tsc includes tests via `tsconfig.app.json`) |
| `src/pages/PortfolioPage.tsx`, `src/pages/OverviewPage.tsx` | InfoHint + under-chart hint copy (spec §4 verbatim sentence) |
| `docs/superpowers/specs/2026-08-24-contribution-matched-benchmark-design.md` | status flip in the final task |

---

## Phase 0 — Environment

### Task 0: Verify branch and stack

**Files:** none (verification only)

- [ ] **Step 1: Verify the checkout.**

```bash
git status
git branch --show-current
```

Expected: clean working tree; branch `contribution-benchmark`. The orchestrator creates the branch — if either check fails, STOP and surface it rather than guessing (do not start work on `main`).

- [ ] **Step 2: Backend smoke test** (proves the venv and the dev Postgres on 5433 answer).

Run: `cd backend && .venv/Scripts/python -m pytest tests/test_health.py -q`
Expected: `1 passed`. If it errors on connection, start the container and retry:

```bash
powershell -Command "Start-Process 'C:\Program Files\Docker\Docker\Docker Desktop.exe'"
until docker info >/dev/null 2>&1; do sleep 5; done
cd backend && docker compose up -d db
```

- [ ] **Step 3: Frontend smoke.**

Run: `npx vitest run src/components/portfolio/historyChartOptions.test.ts`
Expected: all 10 tests pass (5 builder, 2 liveFromHoldings, 3 tooltip).

---

## Phase 1 — Backend: the pure benchmark leg

### Task 1: `contribution_benchmark` — seed, growth, flows

**Files:**
- Modify: `backend/app/services/value_history.py`
- Create: `backend/tests/test_value_history.py`

- [ ] **Step 1: Write the failing tests.** Create `backend/tests/test_value_history.py`:

```python
"""services/value_history's read-side benchmark leg (2026-08-24 contribution-matched
benchmark spec, §2 recurrence / §5 test list). contribution_benchmark is pure — every
case here is literal-driven, no DB."""

from datetime import date
from decimal import Decimal

from app.services.value_history import contribution_benchmark

D = Decimal


def _row(iso: str, market_value: str, cost_basis: str) -> tuple[date, Decimal, Decimal]:
    return (date.fromisoformat(iso), D(market_value), D(cost_basis))


def test_seed_is_the_first_market_value_quantized():
    rows = [_row("2023-10-23", "53619.00", "53619.00")]
    closes = {date(2023, 10, 23): D("400.00")}
    assert contribution_benchmark(rows, closes) == [D("53619.00")]
    # The seed itself wears MONEY_Q HALF_UP — literal-driven inputs may be unquantized.
    assert contribution_benchmark([_row("2023-10-23", "1000.005", "1000.005")], closes) == [
        D("1000.01")
    ]


def test_contribution_lands_then_grows():
    rows = [
        _row("2026-01-05", "1000.00", "1000.00"),
        _row("2026-01-12", "1490.00", "1500.00"),
        _row("2026-01-19", "1700.00", "1500.00"),
    ]
    closes = {
        date(2026, 1, 5): D("100.00"),
        date(2026, 1, 12): D("100.00"),
        date(2026, 1, 19): D("110.00"),
    }
    # Flat close + flow 500 -> the flow lands whole; then 1500 x 110/100 grows it.
    assert contribution_benchmark(rows, closes) == [D("1000.00"), D("1500.00"), D("1650.00")]


def test_negative_flow_withdraws_at_cost():
    rows = [
        _row("2026-01-05", "2000.00", "2000.00"),
        _row("2026-01-12", "1300.00", "1200.00"),
    ]
    closes = {date(2026, 1, 5): D("100.00"), date(2026, 1, 12): D("105.00")}
    # A cost-basis drop is a negative flow (spec §3.1's documented approximation):
    # 2000 x 1.05 - 800 = 1300.
    assert contribution_benchmark(rows, closes) == [D("2000.00"), D("1300.00")]


def test_no_bars_at_all_is_all_none():
    rows = [
        _row("2026-01-05", "1000.00", "1000.00"),
        _row("2026-01-12", "1100.00", "1050.00"),
    ]
    # The one all-None case (spec §4): no benchmark bars AT ALL — degraded, never a 500.
    assert contribution_benchmark(rows, {}) == [None, None]


def test_empty_rows_are_empty():
    assert contribution_benchmark([], {}) == []
    assert contribution_benchmark([], {date(2026, 1, 5): D("1")}) == []
```

- [ ] **Step 2: Run to verify failure** — `cd backend && .venv/Scripts/python -m pytest tests/test_value_history.py -q`
Expected: FAIL, `ImportError: cannot import name 'contribution_benchmark'`.

- [ ] **Step 3: Implement the core recurrence.** In `backend/app/services/value_history.py`, insert after `_closes_on_or_before` (before `append_value_snapshot`):

```python
def contribution_benchmark(
    rows: list[tuple[date, Decimal, Decimal]],
    closes: dict[date, Decimal],
) -> list[Decimal | None]:
    """The contribution-matched benchmark: what the book would be worth had every
    inferred contribution bought BASELINE_TICKER instead (2026-08-24 spec §2).

    Pure of the DB: `rows` are (snapshot_date, market_value, cost_basis) ascending;
    `closes` maps snapshot dates to the benchmark close on-or-before them
    (baseline_closes_for). Week-over-week cost-basis deltas proxy the flows — positions
    are mostly undated by design, so no dated-transaction series exists to sum.

        benchmark[0] = market_value[0]                      # parity seed, the sheet's own t0
        flow[t]      = cost_basis[t] - cost_basis[t-1]
        benchmark[t] = benchmark[t-1] * (close[t]/close[t-1]) + flow[t]

    Each row quantizes to MONEY_Q HALF_UP and the NEXT step chains on the quantized
    value — the S&P leg's own anchoring (every stored row anchors the next), which is
    what makes a same-day recompute reproduce itself to the cent. All-None only when
    there are no benchmark bars AT ALL: the read path degrades, never rejects.
    """
    if not rows:
        return []
    if not closes:
        return [None] * len(rows)
    series: list[Decimal | None] = []
    prev_value: Decimal | None = None
    prev_close: Decimal | None = None
    prev_cost = ZERO
    for snapshot_date, market_value, cost_basis in rows:
        close = closes.get(snapshot_date)
        if prev_value is None:
            value = market_value.quantize(MONEY_Q, rounding=ROUND_HALF_UP)
        else:
            flow = cost_basis - prev_cost
            value = (prev_value * (close / prev_close) + flow).quantize(
                MONEY_Q, rounding=ROUND_HALF_UP
            )
        series.append(value)
        prev_value = value
        prev_cost = cost_basis
        prev_close = close
    return series
```

(No new imports: `date`, `Decimal`, `ROUND_HALF_UP`, `MONEY_Q`, and `ZERO` are already in the module. The missing-close and drain rules land in Task 2 — this version assumes every date is priced, which is exactly what these five tests feed it.)

- [ ] **Step 4: Run** — `cd backend && .venv/Scripts/python -m pytest tests/test_value_history.py -q` → `5 passed`.

- [ ] **Step 5: Ruff** — `cd backend && .venv/Scripts/python -m ruff check app tests` → clean; `.venv/Scripts/python -m ruff format app tests` → "left unchanged" for the touched files (if it reformats, re-run Step 4).

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(benchmark): contribution_benchmark recurrence - seed, growth, flows"`

### Task 2: Edge rules — missing-close flat, drain clamp, golden series, idempotence

**Files:**
- Modify: `backend/app/services/value_history.py`
- Test: `backend/tests/test_value_history.py`

- [ ] **Step 1: Write the failing tests** (append to `backend/tests/test_value_history.py`):

```python
def test_missing_close_carries_flat_and_still_lands_the_flow():
    rows = [
        _row("2026-01-05", "1000.00", "1000.00"),
        _row("2026-01-12", "1150.00", "1200.00"),
        _row("2026-01-19", "1400.00", "1200.00"),
    ]
    closes = {date(2026, 1, 5): D("100.00"), date(2026, 1, 19): D("120.00")}
    # Step INTO the gap: factor 1, the +200 flow lands. Step OUT of it: the previous end
    # is the missing one, so factor 1 again — no invented move on either side of a
    # barless step (spec §2, _extended_baseline's own rule).
    assert contribution_benchmark(rows, closes) == [D("1000.00"), D("1200.00"), D("1200.00")]


def test_leading_rows_before_the_first_bar_carry_the_seed_flat():
    rows = [
        _row("2026-01-05", "1000.00", "1000.00"),
        _row("2026-01-12", "1105.00", "1100.00"),
        _row("2026-01-19", "1210.00", "1200.00"),
        _row("2026-01-26", "1400.00", "1200.00"),
    ]
    # The first two dates precede every VOO bar (absent from the map): the seed rides
    # flat and the flows land — flats, not holes (spec §4).
    closes = {date(2026, 1, 19): D("200.00"), date(2026, 1, 26): D("210.00")}
    assert contribution_benchmark(rows, closes) == [
        D("1000.00"),
        D("1100.00"),
        D("1200.00"),
        D("1260.00"),  # growth finally engages: 1200 x 210/200
    ]


def test_drain_clamp_zeroes_growth_not_the_flow():
    rows = [
        _row("2026-01-05", "1000.00", "2000.00"),
        _row("2026-01-12", "0.00", "500.00"),
        _row("2026-01-19", "300.00", "800.00"),
    ]
    closes = {
        date(2026, 1, 5): D("100.00"),
        date(2026, 1, 12): D("100.00"),
        date(2026, 1, 19): D("200.00"),
    }
    # t1 drains past zero at cost (flow -1500): overdrawn on paper is legal output. t2's
    # doubling close must NOT double a negative balance — the growth TERM clamps to 0
    # (spec §2's guard: never negative VIA MULTIPLICATION) and the +300 flow lands alone.
    assert contribution_benchmark(rows, closes) == [D("1000.00"), D("-500.00"), D("300.00")]


def test_golden_six_row_series_to_the_cent():
    """End to end: seed, growth, a flow, a barless gap (both step ends), a negative
    flow, an exact-ratio step, and a genuinely rounding step — pinned to the cent."""
    rows = [
        _row("2025-09-01", "1000.00", "800.00"),
        _row("2025-09-08", "1300.00", "1050.00"),
        _row("2025-09-15", "1290.00", "1050.00"),
        _row("2025-09-22", "1120.00", "900.00"),
        _row("2025-09-29", "1105.00", "900.00"),
        _row("2025-10-06", "1225.00", "1000.00"),
    ]
    closes = {
        date(2025, 9, 1): D("100.00"),
        date(2025, 9, 8): D("103.00"),
        # 2025-09-15 has no bar: the gap step AND the step out of it run at factor 1.
        date(2025, 9, 22): D("103.00"),
        date(2025, 9, 29): D("100.94"),  # 103.00 x 0.98 exactly
        date(2025, 10, 6): D("101.95"),
    }
    assert contribution_benchmark(rows, closes) == [
        D("1000.00"),  # seed = mv[0]
        D("1280.00"),  # 1000 x 1.03 + 250
        D("1280.00"),  # gap: factor 1, zero flow
        D("1130.00"),  # out of the gap: factor 1, flow -150
        D("1107.40"),  # 1130 x 0.98
        D("1218.48"),  # 1107.40 x 101.95/100.94 + 100 = 1218.4805... -> HALF_UP
    ]


def test_live_extension_recompute_is_idempotent_and_prefix_stable():
    rows = [
        _row("2026-08-10", "1000.00", "1000.00"),
        _row("2026-08-17", "1120.00", "1100.00"),
    ]
    closes = {date(2026, 8, 10): D("500.00"), date(2026, 8, 17): D("510.00")}
    first = contribution_benchmark(rows, closes)
    assert first == [D("1000.00"), D("1120.00")]
    # Same-day recompute: the Monday appender upserts the same row on a re-run and the
    # read-time series re-derives to the same numbers — _extended_baseline's idempotence,
    # inherited by construction because the recurrence reads stored rows only (spec §2's
    # live-extension bullet: the step IS the implied-shares method, benchmark[t-1]/
    # close[t-1] shares x close[t], anchored on the computed series' last value).
    assert contribution_benchmark(rows, closes) == first
    # Extending by the next live Monday never rewrites history.
    extended = contribution_benchmark(
        rows + [_row("2026-08-24", "1150.00", "1100.00")],
        {**closes, date(2026, 8, 24): D("520.00")},
    )
    assert extended[:2] == first
    assert extended == [D("1000.00"), D("1120.00"), D("1141.96")]  # 1120 x 520/510, 0 flow
```

- [ ] **Step 2: Run to verify failure** — `cd backend && .venv/Scripts/python -m pytest tests/test_value_history.py -q`
Expected: 4 FAIL — the two gap tests and the golden series die on `TypeError` (None in the division), the drain clamp on a wrong value (`-700.00`). `test_live_extension_recompute_is_idempotent_and_prefix_stable` already passes (it pins prefix stability, not a new branch) — that is expected.

- [ ] **Step 3: Finish the function.** In `backend/app/services/value_history.py`, replace the `else:` arm inside `contribution_benchmark`'s loop (Task 1's unconditional `prev_value * (close / prev_close) + flow`) so the whole loop reads:

```python
    for snapshot_date, market_value, cost_basis in rows:
        close = closes.get(snapshot_date)
        if prev_value is None:
            value = market_value.quantize(MONEY_Q, rounding=ROUND_HALF_UP)
        else:
            flow = cost_basis - prev_cost
            if prev_value <= 0:
                # Drain clamp (spec §2): growth on an emptied — or overdrawn-at-cost —
                # hypothetical account is 0; only the flow moves it. Without this, a
                # negative balance would compound through every later close move.
                growth = ZERO
            elif close is None or prev_close is None or prev_close == 0:
                # A close missing at EITHER end of the step: factor 1 — carry flat, land
                # the flow. Covers rows before the first bar (production's only gap; the
                # loader carries forward past it) and any literal-driven mid-series gap.
                growth = prev_value
            else:
                growth = prev_value * (close / prev_close)
            # + ZERO strips a rounding-born negative zero before it can reach the wire.
            value = (growth + flow).quantize(MONEY_Q, rounding=ROUND_HALF_UP) + ZERO
        series.append(value)
        prev_value = value
        prev_cost = cost_basis
        prev_close = close
```

- [ ] **Step 4: Run** — `cd backend && .venv/Scripts/python -m pytest tests/test_value_history.py -q` → `10 passed`.

- [ ] **Step 5: Ruff** — `cd backend && .venv/Scripts/python -m ruff check app tests` → clean; `.venv/Scripts/python -m ruff format app tests` → touched files unchanged.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(benchmark): edge rules - missing-close flat, drain clamp, golden series"`

### Task 3: `baseline_closes_for` — one query, two-pointer resolution

**Files:**
- Modify: `backend/app/services/value_history.py`
- Test: `backend/tests/test_value_history.py`

- [ ] **Step 1: Write the failing tests.** In `backend/tests/test_value_history.py`, add below the existing imports:

```python
from app.models import PriceHistory, Security
```

and change the services import line to:

```python
from app.services.value_history import baseline_closes_for, contribution_benchmark
```

then append the tests (async — `asyncio_mode = "auto"`; `db` is the shared conftest fixture):

```python
async def test_baseline_closes_for_resolves_on_or_before_per_date(db):
    voo = Security(ticker="VOO", name="Vanguard S&P 500 ETF", holding_type="etf")
    decoy = Security(ticker="NVDA", name="NVIDIA", holding_type="stock")
    db.add_all([voo, decoy])
    await db.flush()
    db.add_all(
        [
            PriceHistory(security_id=voo.id, price_date=date(2026, 8, 5), close=D("500.0000")),
            PriceHistory(security_id=voo.id, price_date=date(2026, 8, 14), close=D("510.0000")),
            # Another ticker's bar on an in-range date — the join must not read it.
            PriceHistory(security_id=decoy.id, price_date=date(2026, 8, 10), close=D("999.0000")),
        ]
    )
    await db.commit()
    closes = await baseline_closes_for(
        db,
        [date(2026, 8, 3), date(2026, 8, 10), date(2026, 8, 17)],
    )
    # 8/3 precedes every bar: ABSENT (the factor-1 rule's input, never a zero). 8/10 and
    # 8/17 each carry the newest bar on-or-before them.
    assert closes == {date(2026, 8, 10): D("500.0000"), date(2026, 8, 17): D("510.0000")}


async def test_baseline_closes_for_same_day_bar_and_empty_inputs(db):
    voo = Security(ticker="VOO", name="Vanguard S&P 500 ETF", holding_type="etf")
    db.add(voo)
    await db.flush()
    db.add(PriceHistory(security_id=voo.id, price_date=date(2026, 8, 10), close=D("500.0000")))
    await db.commit()
    # On-or-BEFORE: a bar dated the snapshot day itself resolves (Monday-close parity).
    assert await baseline_closes_for(db, [date(2026, 8, 10)]) == {
        date(2026, 8, 10): D("500.0000")
    }
    assert await baseline_closes_for(db, []) == {}


async def test_baseline_closes_for_no_voo_rows_is_empty(db):
    assert await baseline_closes_for(db, [date(2026, 8, 10)]) == {}
```

- [ ] **Step 2: Run to verify failure** — `cd backend && .venv/Scripts/python -m pytest tests/test_value_history.py -q`
Expected: FAIL, `ImportError: cannot import name 'baseline_closes_for'`.

- [ ] **Step 3: Implement.** In `backend/app/services/value_history.py`, insert directly above `contribution_benchmark`:

```python
async def baseline_closes_for(db: AsyncSession, dates: list[date]) -> dict[date, Decimal]:
    """The benchmark close on-or-before each snapshot date, in ONE query (spec §2).

    Fetches every BASELINE_TICKER bar up to the last date once, ascending, then walks
    both sorted sequences with a two-pointer: ~190 weekly snapshots x ~1500 daily bars
    is trivial in Python, and one flat fetch beats N `_baseline_close_on_or_before`
    round-trips or a window-ranked join keyed on dates. Requires ascending `dates` (the
    history endpoint's own snapshot order). Dates before the first bar are simply absent
    from the result — contribution_benchmark's factor-1 input, never a zero."""
    if not dates:
        return {}
    bars = (
        await db.execute(
            select(PriceHistory.price_date, PriceHistory.close)
            .join(Security, Security.id == PriceHistory.security_id)
            .where(Security.ticker == BASELINE_TICKER, PriceHistory.price_date <= dates[-1])
            .order_by(PriceHistory.price_date)
        )
    ).all()
    closes: dict[date, Decimal] = {}
    newest = -1  # index of the newest bar dated on-or-before the walking date
    for day in dates:
        while newest + 1 < len(bars) and bars[newest + 1][0] <= day:
            newest += 1
        if newest >= 0:
            closes[day] = bars[newest][1]
    return closes
```

(No new imports: `AsyncSession`, `select`, `PriceHistory`, `Security`, and `BASELINE_TICKER` are already in the module.)

- [ ] **Step 4: Run** — `cd backend && .venv/Scripts/python -m pytest tests/test_value_history.py -q` → `13 passed`.

- [ ] **Step 5: Ruff** — `cd backend && .venv/Scripts/python -m ruff check app tests` → clean; `.venv/Scripts/python -m ruff format app tests` → touched files unchanged.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(benchmark): baseline_closes_for one-query on-or-before loader"`

---

## Phase 2 — API

### Task 4: `/portfolio/history` carries `benchmark`

**Files:**
- Modify: `backend/app/schemas/portfolio.py`, `backend/app/api/portfolio.py`
- Test: `backend/tests/test_portfolio_api.py`

- [ ] **Step 1: Write the failing tests.** In `backend/tests/test_portfolio_api.py`:

1. Replace the body of `test_history_empty_is_empty_arrays_not_404` (line ~1303) with:

```python
async def test_history_empty_is_empty_arrays_not_404(auth_client):
    resp = await auth_client.get(HISTORY)
    assert resp.status_code == 200, resp.text
    assert resp.json() == {
        "dates": [],
        "market_value": [],
        "cost_basis": [],
        "sp500": [],
        "benchmark": [],
    }
```

2. Append to the end of `test_history_returns_parallel_arrays_ordered_by_date` (after the `sp500` assertion):

```python
    # No VOO bars at all in this seed: the benchmark leg is ALL-null — the one degraded
    # shape (spec §4). Nulls, never a 500: the GET still answers.
    assert body["benchmark"] == [None, None]
```

3. Append a new test at the end of the file:

```python
async def test_history_carries_the_contribution_benchmark(auth_client, db):
    voo = Security(ticker="VOO", name="Vanguard S&P 500 ETF", holding_type="etf")
    db.add(voo)
    await db.flush()
    db.add_all(
        [
            PriceHistory(
                security_id=voo.id, price_date=date(2023, 10, 23), close=Decimal("400.0000")
            ),
            PriceHistory(
                security_id=voo.id, price_date=date(2023, 10, 30), close=Decimal("440.0000")
            ),
        ]
    )
    db.add_all(
        [
            PortfolioValueHistory(
                snapshot_date=date(2023, 10, 23),
                market_value=Decimal("1000.00"),
                cost_basis=Decimal("1000.00"),
                sp500_value=Decimal("1000.00"),
            ),
            PortfolioValueHistory(
                snapshot_date=date(2023, 10, 30),
                market_value=Decimal("1150.00"),
                cost_basis=Decimal("1200.00"),
                sp500_value=Decimal("1100.00"),
            ),
        ]
    )
    await db.commit()

    body = (await auth_client.get(HISTORY)).json()
    # Parity seed = mv[0]; then 1000 x 440/400 + (1200 - 1000) = 1300. Decimal strings
    # on the wire, aligned index-for-index with dates.
    assert body["benchmark"] == ["1000.00", "1300.00"]
    assert len(body["benchmark"]) == len(body["dates"])
```

(`Security`, `PriceHistory`, `PortfolioValueHistory`, `date`, and `Decimal` are already imported at the top of this file.)

- [ ] **Step 2: Run to verify failure** — `cd backend && .venv/Scripts/python -m pytest tests/test_portfolio_api.py -q`
Expected: 3 FAIL — the empty test on dict inequality, the other two on `KeyError: 'benchmark'`.

- [ ] **Step 3: Schema.** In `backend/app/schemas/portfolio.py`, replace the whole `PortfolioHistoryOut` class:

```python
class PortfolioHistoryOut(BaseModel):
    """Parallel arrays (net-worth TimeseriesOut posture): index i across all five lists
    is one weekly imported point. sp500 is the sheet's baseline — the STARTING balance
    benchmarked into VOO shares, not contribution-matched. benchmark is the
    contribution-matched leg, derived at read time (value_history.contribution_benchmark):
    every inferred contribution buys VOO instead. Rows are Decimal wherever computable —
    rows before the first VOO bar carry the seed flat; ALL-None only when VOO has no bars
    at all (nulls, never a 500)."""

    dates: list[date]
    market_value: list[Decimal]
    cost_basis: list[Decimal]
    sp500: list[Decimal]
    benchmark: list[Decimal | None]
```

- [ ] **Step 4: Endpoint.** In `backend/app/api/portfolio.py`, add after the `from app.services.portfolio_calc import (...)` block:

```python
from app.services.value_history import baseline_closes_for, contribution_benchmark
```

and replace the whole `value_history` endpoint function:

```python
@router.get("/history", response_model=PortfolioHistoryOut)
async def value_history(db: AsyncSession = Depends(get_db)) -> PortfolioHistoryOut:
    """The imported weekly series behind the performance chart — empty arrays (not 404)
    until a workbook carrying the Portfolio sheet's value-history columns is imported.
    The benchmark leg is derived HERE, at read time: a stored column would go stale the
    moment a re-import overrides history rows (apply_portfolio_history's contract), and
    ~190 multiply-adds are free per request (2026-08-24 spec §2)."""
    rows = (
        (
            await db.execute(
                select(PortfolioValueHistory).order_by(PortfolioValueHistory.snapshot_date)
            )
        )
        .scalars()
        .all()
    )
    snapshot_dates = [row.snapshot_date for row in rows]
    closes = await baseline_closes_for(db, snapshot_dates)
    return PortfolioHistoryOut(
        dates=snapshot_dates,
        market_value=[row.market_value for row in rows],
        cost_basis=[row.cost_basis for row in rows],
        sp500=[row.sp500_value for row in rows],
        benchmark=contribution_benchmark(
            [(row.snapshot_date, row.market_value, row.cost_basis) for row in rows], closes
        ),
    )
```

- [ ] **Step 5: Run** — `cd backend && .venv/Scripts/python -m pytest tests/test_portfolio_api.py -q` → PASS. Then the full suite: `cd backend && .venv/Scripts/python -m pytest -q` → ALL PASS (nothing else builds `PortfolioHistoryOut`).

- [ ] **Step 6: Ruff** — `cd backend && .venv/Scripts/python -m ruff check app tests` → clean; `.venv/Scripts/python -m ruff format app tests` → touched files unchanged.

- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat(benchmark): /portfolio/history carries the contribution-matched leg"`

---

## Phase 3 — Frontend

### Task 5: Fourth line series in the shared builder

**Files:**
- Modify: `src/types/api.ts`, `src/components/portfolio/historyChartOptions.ts`
- Test: `src/components/portfolio/historyChartOptions.test.ts`, `src/pages/OverviewPage.test.tsx` (fixture only)

- [ ] **Step 1: Wire type.** In `src/types/api.ts`, replace the `PortfolioHistory` interface and its comment (line ~295):

```ts
// GET /portfolio/history — parallel arrays (NetWorthTimeseries posture); index i across
// all five lists is one weekly imported point. sp500 is the sheet's baseline: the
// STARTING balance benchmarked into VOO shares. benchmark is the contribution-matched
// leg, derived server-side at read time — every inferred contribution buys VOO instead.
// Entries are Decimal strings wherever computable; all-null only when VOO has no bars.
export interface PortfolioHistory {
  dates: string[]
  market_value: string[]
  cost_basis: string[]
  sp500: string[]
  benchmark: (string | null)[]
}
```

- [ ] **Step 2: Update the test fixtures and write the failing tests.** In `src/components/portfolio/historyChartOptions.test.ts`:

1. In the `history()` builder, add after the `sp500` line:

```ts
    benchmark: ['96000.00', '97250.00', '99001.13'],
```

2. Replace the `EMPTY` const:

```ts
const EMPTY: PortfolioHistory = {
  dates: [],
  market_value: [],
  cost_basis: [],
  sp500: [],
  benchmark: [],
}
```

3. In `it('returns null under two imported points, live or not', ...)`, add `benchmark: ['1.00'],` to the one-point override object (after its `sp500: ['1.00'],` line).

4. Replace `it('draws three lines in fixed palette slots with a wash under value only', ...)` entirely:

```ts
  it('draws four lines in fixed palette slots with a wash under value only', () => {
    const option = portfolioHistoryOption(history(), null)
    expect(option).not.toBeNull()
    const series = seriesOf(option!)
    expect(series.map((s) => s.name)).toEqual([
      'Portfolio value',
      'Cost basis',
      'S&P 500 baseline',
      'VOO (your contributions)',
    ])
    expect(series.map((s) => s.color)).toEqual([PALETTE[0], PALETTE[1], PALETTE[2], PALETTE[3]])
    expect(series[0].areaStyle?.opacity).toBeGreaterThan(0)
    expect(series[1].areaStyle).toBeUndefined()
    expect(series[2].areaStyle).toBeUndefined()
    // No wash on the benchmark either — the wash rides the value line only (spec §4).
    expect(series[3].areaStyle).toBeUndefined()
    // Number() at the boundary, once
    expect(series[0].data).toEqual([700000, 710000.5, 718422.07])
    expect(series[3].data).toEqual([96000, 97250, 99001.13])
    expect(categoriesOf(option!)).toEqual(['Jul 27, 2026', 'Aug 3, 2026', 'Aug 10, 2026'])
  })
```

5. Replace `it('appends a pinging live category with a dashed connector when the quote is newer', ...)` entirely:

```ts
  it('appends a pinging live category with a dashed connector when the quote is newer', () => {
    const option = portfolioHistoryOption(history(), { date: '2026-08-14', value: 723456.78 })
    expect(categoriesOf(option!)).toEqual([
      'Jul 27, 2026',
      'Aug 3, 2026',
      'Aug 10, 2026',
      'Aug 14, 2026',
    ])
    const series = seriesOf(option!)
    expect(series).toHaveLength(5)
    // Lines end at the last IMPORTED point — the live category is never extrapolated.
    expect(series[0].data).toEqual([700000, 710000.5, 718422.07, null])
    expect(series[1].data).toEqual([395000, 399542.36, 400243.74, null])
    expect(series[2].data).toEqual([96000, 97000, 98636.7, null])
    expect(series[3].data).toEqual([96000, 97250, 99001.13, null])
    const live = series[4]
    expect(live.type).toBe('effectScatter')
    expect(live.name).toBe('Live')
    expect(live.color).toBe(PALETTE[0]) // same entity as the value line; the ripple says "live"
    expect(live.rippleEffect).toBeTruthy()
    expect(live.data).toEqual([['Aug 14, 2026', 723456.78]])
    expect(live.markLine?.lineStyle?.type).toBe('dashed')
    expect(live.markLine?.data).toEqual([
      [{ coord: ['Aug 10, 2026', 718422.07] }, { coord: ['Aug 14, 2026', 723456.78] }],
    ])
  })
```

6. Replace `it('parks a same-day quote on the last category without a connector', ...)` entirely:

```ts
  it('parks a same-day quote on the last category without a connector', () => {
    const option = portfolioHistoryOption(history(), { date: '2026-08-10', value: 720000 })
    expect(categoriesOf(option!)).toEqual(['Jul 27, 2026', 'Aug 3, 2026', 'Aug 10, 2026'])
    const series = seriesOf(option!)
    expect(series).toHaveLength(5)
    expect(series[0].data).toEqual([700000, 710000.5, 718422.07]) // no null padding
    expect(series[3].data).toEqual([96000, 97250, 99001.13])
    expect(series[4].data).toEqual([['Aug 10, 2026', 720000]])
    expect(series[4].markLine).toBeUndefined()
  })
```

7. Replace `it('self-retires the live point when the quote predates the series or is unusable', ...)` entirely (four series now — the three legacy lines plus the benchmark):

```ts
  it('self-retires the live point when the quote predates the series or is unusable', () => {
    expect(
      seriesOf(portfolioHistoryOption(history(), { date: '2026-08-01', value: 1 })!),
    ).toHaveLength(4)
    expect(
      seriesOf(portfolioHistoryOption(history(), { date: '2026-08-14', value: Number.NaN })!),
    ).toHaveLength(4)
    expect(seriesOf(portfolioHistoryOption(history(), null)!)).toHaveLength(4)
  })
```

8. Add a new test inside the `describe('portfolioHistoryOption', ...)` block:

```ts
  it('omits the benchmark series when the payload lacks the field or carries only nulls', () => {
    // Stale-tab payload: cached from the pre-benchmark API the field is absent at
    // runtime even though the type now requires it — hence the cast.
    const legacy = {
      dates: ['2026-07-27', '2026-08-03', '2026-08-10'],
      market_value: ['700000.00', '710000.50', '718422.07'],
      cost_basis: ['395000.00', '399542.36', '400243.74'],
      sp500: ['96000.00', '97000.00', '98636.70'],
    } as PortfolioHistory
    expect(seriesOf(portfolioHistoryOption(legacy, null)!).map((s) => s.name)).toEqual([
      'Portfolio value',
      'Cost basis',
      'S&P 500 baseline',
    ])
    // The server's no-VOO-bars degradation: all-null. An all-null line would draw
    // nothing yet still ghost-occupy the legend, so the series is omitted outright.
    expect(
      seriesOf(portfolioHistoryOption(history({ benchmark: [null, null, null] }), null)!).map(
        (s) => s.name,
      ),
    ).toEqual(['Portfolio value', 'Cost basis', 'S&P 500 baseline'])
  })
```

9. Add a new test inside the `describe('historyTooltipFormatter', ...)` block (pins spec §4's "null rows are already skipped" for the new series name):

```ts
  it('skips the benchmark null row on the padded live category', () => {
    const html = historyTooltipFormatter([
      {
        seriesName: 'VOO (your contributions)',
        marker: '<i/>',
        axisValueLabel: 'Aug 14, 2026',
        value: null,
      },
      {
        seriesName: 'Live',
        marker: '<i/>',
        axisValueLabel: 'Aug 14, 2026',
        value: ['Aug 14, 2026', 723456.78],
      },
    ])
    expect(html).toContain('Live')
    expect(html).not.toContain('VOO (your contributions)')
  })
```

- [ ] **Step 3: Run to verify failure** — `npx vitest run src/components/portfolio/historyChartOptions.test.ts`
Expected: 4 FAIL (draws-four, ping, same-day park, self-retires — all still see three line series). The omission test and the tooltip test already pass (they pin absence and the formatter's existing null-skip) — that is expected.

- [ ] **Step 4: Implement the builder.** In `src/components/portfolio/historyChartOptions.ts`, four exact edits:

1. Replace the `lineData` const (and the comment above it):

```ts
  // Lines end at the last IMPORTED point: the live category (when present) gets null,
  // never an extrapolated value. Null entries pass through untouched — the benchmark's
  // degraded rows must become chart nulls, not NaN.
  const lineData = (values: (string | null)[]): (number | null)[] => {
    const parsed = values.map((v) => (v === null ? null : Number(v)))
    return extendAxis ? [...parsed, null] : parsed
  }
```

2. Replace the comment block above `lineSeries`:

```ts
  // Fixed validated palette slots (charts/theme.ts law): value=slot 1 blue, cost
  // basis=slot 2 orange, S&P=slot 3 aqua, contribution benchmark=slot 4 yellow. The wash
  // rides the value line ONLY — the Excel original's three overlapping opaque areas
  // occlude each other (spec: rejected).
```

3. Replace the `lineSeries` signature line:

```ts
  const lineSeries = (name: string, values: (string | null)[], color: string, wash: boolean) => ({
```

(the arrow-function body is unchanged).

4. Insert immediately above the `return {` statement:

```ts
  // Stale-tab armor: a payload cached from the pre-benchmark API omits the field.
  // Treat omitted like the server's all-null degradation — no fourth series at all,
  // because an all-null line draws nothing yet still ghost-occupies the legend.
  const benchmark = history.benchmark ?? []
  const showBenchmark = benchmark.some((v) => v !== null)
```

then insert into the `series:` array, between the `lineSeries('S&P 500 baseline', ...)` entry and the `...(livePt` spread:

```ts
      // Legend-only disambiguation (spec §4): the two benchmark names must explain
      // themselves side by side — "baseline" = starting balance only, this = every flow.
      ...(showBenchmark
        ? [lineSeries('VOO (your contributions)', benchmark, PALETTE[3], false)]
        : []),
```

- [ ] **Step 5: Run** — `npx vitest run src/components/portfolio/historyChartOptions.test.ts` → all 12 pass.

- [ ] **Step 6: Fix the remaining fixture.** In `src/pages/OverviewPage.test.tsx` (tsc type-checks test files — `tsconfig.app.json` includes all of `src`):

1. In `historyOut()` (line ~159), add after the `sp500` line:

```ts
    benchmark: ['96000.00', '97250.00', '99001.13'],
```

2. Replace the empty-history line (~702):

```ts
      history: historyOut({ dates: [], market_value: [], cost_basis: [], sp500: [] }),
```

with:

```ts
      history: historyOut({ dates: [], market_value: [], cost_basis: [], sp500: [], benchmark: [] }),
```

- [ ] **Step 7: Verify the whole frontend still stands** — `npx vitest run src/pages/OverviewPage.test.tsx` → PASS (no Overview test asserts series contents); `npm run lint` → clean; `npm run build` → clean.

- [ ] **Step 8: Commit** — `git add -A && git commit -m "feat(benchmark): VOO (your contributions) line in the performance chart"`

### Task 6: Estimation-caveat copy (InfoHints + under-chart hint)

**Files:**
- Modify: `src/pages/PortfolioPage.tsx`, `src/pages/OverviewPage.tsx`

The verbatim sentence from spec §4 — it must appear EXACTLY, punctuation included: `Estimated: contributions inferred from weekly cost-basis changes; dividends excluded on the VOO leg.`

- [ ] **Step 1: PortfolioPage Performance InfoHint.** The Performance title (line ~343) already wears an InfoHint whose closing clause ("not a contribution-matched alternative") the new line falsifies — extend it rather than stacking a second ⓘ on one title. Replace:

```tsx
                <InfoHint text="Value vs cost basis, checkpointed weekly after Monday's close. The pinging dot is the live value at the latest prices. The S&P 500 baseline invests only the starting balance, so it compares price performance, not a contribution-matched alternative." />
```

with:

```tsx
                <InfoHint text="Value vs cost basis, checkpointed weekly after Monday's close. The pinging dot is the live value at the latest prices. The S&P 500 baseline invests only the starting balance; VOO (your contributions) invests every inferred contribution instead. Estimated: contributions inferred from weekly cost-basis changes; dividends excluded on the VOO leg." />
```

- [ ] **Step 2: PortfolioPage under-chart hint.** Replace the hint paragraph and its JSX comment (lines ~350–355):

```tsx
                {/* The sheet's baseline invests only the STARTING balance in VOO; saying so here
                    keeps the gap under the blue line from reading as outperformance. */}
                <p className="hint">
                  S&amp;P 500 baseline tracks the starting balance invested in VOO — later
                  contributions are not added to it.
                </p>
```

with:

```tsx
                {/* Two benchmark legs, one distinction: the baseline invests only the
                    STARTING balance; the contribution-matched line adds every inferred
                    flow. Said here so neither gap reads as outperformance. */}
                <p className="hint">
                  S&amp;P 500 baseline tracks the starting balance invested in VOO — later
                  contributions are not added to it. VOO (your contributions) adds each
                  inferred contribution as it lands.
                </p>
```

- [ ] **Step 3: OverviewPage InfoHint.** Its "Portfolio performance" hint (line ~356) also explains only three lines; the fourth now renders there too. Replace:

```tsx
                <InfoHint text="Portfolio value vs cost basis, checkpointed weekly after Monday's close; the pinging dot is live. The S&P 500 line invests only the starting balance — contributions are not added to it." />
```

with:

```tsx
                <InfoHint text="Portfolio value vs cost basis, checkpointed weekly after Monday's close; the pinging dot is live. The S&P 500 line invests only the starting balance; VOO (your contributions) invests every inferred contribution instead." />
```

- [ ] **Step 4: Verify.**

```bash
grep -n "Estimated: contributions inferred from weekly cost-basis changes; dividends excluded on the VOO leg." src/pages/PortfolioPage.tsx
```

Expected: exactly one hit (the verbatim-sentence posture). Then `npx vitest run src/pages/OverviewPage.test.tsx` → PASS (no test asserts these texts); `npm run lint` → clean; `npm run build` → clean.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(benchmark): estimation-caveat copy on both performance charts"`

---

## Phase 4 — Verification

### Task 7: Full verification + spec status

- [ ] **Step 1: Full backend suite** — `cd backend && .venv/Scripts/python -m pytest -q` → ALL PASS. Record the count (this plan added 14 tests: 13 in `test_value_history.py`, 1 in `test_portfolio_api.py`).
- [ ] **Step 2: Ruff, both barrels** — `cd backend && .venv/Scripts/python -m ruff check app tests` → no findings; `cd backend && .venv/Scripts/python -m ruff format app tests` → "files left unchanged" (if anything reformats, re-run Step 1 and fold the fix into a `style:` commit).
- [ ] **Step 3: Full frontend** — `npx vitest run` → ALL PASS (record the count; this plan added 2 net-new vitest cases), `npm run lint` → clean, `npm run build` → clean (the chunk-size advisory may shift a few bytes — the builder changed; that is expected).
- [ ] **Step 4: Update the spec status line** in `docs/superpowers/specs/2026-08-24-contribution-matched-benchmark-design.md` from `**Status:** approved, not yet implemented` to `**Status:** implemented 2026-08-24 (branch contribution-benchmark)`. Commit: `git add -A && git commit -m "docs: spec status - contribution-matched benchmark implemented"`
- [ ] **Step 5: Everything committed** — `git status` → clean; `git log --oneline main..HEAD` → the seven feature/docs commits from Tasks 1–7.

**STOP here.** The orchestrator reviews and merges; do not merge, do not push, do not delete the branch.
