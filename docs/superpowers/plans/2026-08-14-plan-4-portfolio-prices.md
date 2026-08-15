# Plan 4: Portfolio + Prices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `/portfolio` module — securities/transactions/dividends APIs, a yfinance
price service with an in-process scheduler, query-time holdings/allocation/realized/XIRR
computation, and the portfolio page — reconciled against the sheet's Portfolio tab.

**Architecture:** All derived values (cost basis, market value, weight, G/L, XIRR, yield)
are computed at request time from `position_transactions` + `latest_prices` +
`price_history` + `dividend_payments` (spec §4 invariant — nothing derived is stored).
yfinance is isolated behind a one-module provider; APScheduler runs inside the FastAPI
process and refreshes prices on a cron from `app_settings`. The frontend follows the
Plan 3 page pattern (typed fetch modules, EChart wrapper, frozen theme).

**Tech Stack:** FastAPI + async SQLAlchemy (existing), yfinance 1.6.0 + curl_cffi,
APScheduler 3.11.3, React 19 + TS + ECharts 6.1.0 (existing).

**Spec:** `docs/superpowers/specs/2026-08-12-finance-dashboard-design.md` §4 (portfolio data
model + computed values), §5 (`portfolio` + `prices` API surface, `price_service`,
`scheduler`, `portfolio_service`), §6 (`/portfolio` page), §9 (portfolio math unit tests,
reconciliation), §11 (dateless-XIRR + yfinance risks). Binding forward notes from Plan 1
("Forward notes for Plans 2+"), Plan 2 ("Forward notes for Plans 3+"), and Plan 3
("Forward notes for Plans 4+") are each restated below where they land.

**Worktree:** `.worktrees/plan-4-portfolio`, branch `plan-4-portfolio` (created from main
@ 717b0d2). Backend venv at `backend/.venv` (Python 3.12.10), node_modules installed.

---

## Verified planning probes (2026-08-14, this machine + live dev DB + live workbook)

Facts below were verified during planning. Do NOT re-derive them; trust and build.

1. **yfinance 1.6.0** (latest on PyPI) keeps the classic surface: `yf.Ticker(sym, session=...)`,
   `yf.download(..., session=None, ...)`, `Ticker.history(start=, interval='1d',
   auto_adjust=False, actions=True)` → DataFrame with columns
   `[Open, High, Low, Close, Adj Close, Volume, Dividends, Stock Splits]` and a
   **tz-aware DatetimeIndex** (exchange tz, e.g. `2026-08-14 00:00:00-04:00`).
   `Ticker.fast_info` keys include `lastPrice`, `previousClose`, `currency`, `timezone`
   (snake_case accessors like `.last_price` also work). HTTP goes through **curl_cffi**.
2. **Corporate TLS interception blocks default yfinance on this box** (`curl: (60) SSL
   certificate ... unable to get local issuer certificate` — same interception family as the
   Plan 1 container-build and Plan 3 git-fetch notes). **Verified workaround:** dump the
   Windows `ROOT` + `CA` cert stores to a PEM appended to certifi's bundle, then
   `curl_cffi.requests.Session(impersonate='chrome', verify=<bundle path>)` passed as
   `yf.Ticker(sym, session=...)` — live quotes work. Hence the provider accepts an optional
   CA-bundle path via the `YFINANCE_CA_BUNDLE` env var (default None = certifi). Prod (OCI)
   has clean egress and never needs it.
3. **Ticker coverage (live-probed):** VFFSX 381.32, VIEIX 190.05, FSMDX, FXAIX, VTIAX,
   FIGR 31.43, VIA 26.19, RVI 28.56, VCX 34.40, SGOV — **all return prices plausibly matching
   the seeded values** (spec Risk "Institutional fund tickers" is RESOLVED — no manual-priced
   fallback needed for any current ticker; FIGR/VIA listed post-sheet, RVI/VCX are real fund
   tickers). **`BRK.B` fails on Yahoo; `BRK-B` works** (504.03) → provider maps `.` → `-`.
   **ZI (ZoomInfo)** has no seeded price ('#N/A' in sheet), 0 transactions — expected to fail
   refresh; Task 16 deactivates it.
4. **Dev DB state (post-Plan-2 import):** 37 securities (36 with seeded `latest_prices`,
   `source='manual'`, all `is_manual_priced=FALSE`), 26 position_transactions across 22
   tickers (ALL `type='buy'`, ALL `txn_date=NULL`, `sort_index` = sheet row × 10),
   0 dividend_payments, **0 price_history rows** (importer never seeds history). So before
   the first refresh: day Δ and sparklines are empty; after: populated.
5. **Sheet Portfolio tab layout (r1 headers, 1-based cols):** c1 Company Name, c2 Ticker,
   c3 Industry, c4 Shares, c5 Market Weight, c6 Current Price, c7 Daily Gain/Loss,
   c8 Daily Change %, c9 1yr Chart, c10 Cost Basis, c11 Market Value,
   c12 Unrealized Gain/Loss, c13 Unrealized Gain/Loss %, c14 XIRR, c15 Realized Gain/Loss,
   c16 Dividends Collected, c17 Total Gain/Loss, c18 Annual Dividend, c19 Dividend Yield,
   c20 Ex-Div Date. **r2 is the totals row** (c10 ≈ 441930, c11 ≈ 768033, c12 ≈ 329174 —
   full precision read at execution). Data rows r3+ (25 holdings).
   **The sheet's XIRR column is 0 everywhere** (dead formula) and **its Annual Dividend /
   Dividend Yield columns are broken GOOGLEFINANCE leftovers** (VOO shows 0; the r2 total
   53335.6 is inconsistent with the rows) — neither is a reconciliation target.
   Sheet Current Price c6 **exactly equals** the seeded `latest_prices` values (same export
   vintage; VOO 710.17 verified) → reconcile computed market values against the sheet
   BEFORE running the first live refresh.
6. **APScheduler 3.11.3 imports warning-free under `-W error`** on py3.12, and
   `CronTrigger.from_crontab('10 13 * * 1-5', timezone='America/Los_Angeles')` parses;
   invalid strings raise `ValueError`. `app_settings['price_refresh_cron']` is already
   seeded (`{"value": "10 13 * * 1-5"}`).
7. Conftest uses httpx `ASGITransport`, which **never runs the FastAPI lifespan** → a
   lifespan-started scheduler cannot leak into the pytest suite.
8. pip installs work on this box (yfinance 1.6.0 + APScheduler 3.11.3 + tzdata installed
   into the MAIN repo's venv during planning — the worktree venv installs them in Task 1).

## Locked decisions (argued during planning — do not reopen)

- **Sells convention** (Plan 1 note "Plan 4 must choose explicitly"): store POSITIVE
  `shares` with `type='sell'`. Folding subtracts. Split rows keep the Plan 1 dummy
  convention: `shares=0, price=0`, only `split_factor` is read.
- **Average-cost folding** (matches the sheet's running-basis method): per (security,
  account) in `(sort_index, id)` order — buy: `cost += shares*price + fees`; sell:
  `avg = cost/held`, `realized += shares*(price − avg) − fees`, `cost −= shares*avg`;
  split: `shares *= factor` (cost unchanged). Oversells/sell-with-nothing-held fold
  permissively (shares may go negative, avg treated as 0 when held ≤ 0) and attach a
  warning string to the holding — a data-entry mistake must never 500 the page.
- **UI-vs-importer transaction ownership** (supersedes the Plan 2 contract, per its own
  "revisit when UI entry lands" note): new column `position_transactions.source`
  ('import' | 'ui', default 'ui'). The importer marks its rows `source='import'`, keys and
  sync-deletes ONLY within them; UI rows are invisible to re-imports regardless of
  sort_index. UI-created rows get `sort_index = max(all)+10` so they fold chronologically
  LAST (the old sort_index-0 rule made UI rows fold FIRST — wrong for sells). A future
  sheet row can collide with a UI row's sort_index; folding tie-breaks on id — accepted.
- **XIRR dateless rule** (spec Risk #1 decision): XIRR is computed per security only when
  EVERY transaction of that security has a `txn_date` (dividends always have pay_date);
  otherwise null (UI shows —). No approximation. All 26 imported rows are dateless today,
  so XIRR starts null everywhere — matching the sheet, whose XIRR column is dead (probe 5).
  Backfill path: PATCH a transaction's txn_date via the ledger UI.
- **Refresh window = full 370-day re-upsert, no gap tracking:** every refresh fetches
  `today−370d..now` daily bars per ticker (one HTTP call each — Yahoo charges the same for
  a day or a year) and bulk-upserts `price_history` idempotently. First run backfills ~1yr
  (spec §4); later runs self-heal any gap. `latest_prices` = the last bar,
  `quoted_at` = that bar's date at 00:00 UTC (staleness reflects DATA age, not fetch age),
  `source='yfinance'`.
- **Dividend metadata auto-refresh:** the same fetched bars carry dividend events; refresh
  sets `securities.annual_dividend` = trailing-365d sum (quantized 4dp) and `ex_div_date` =
  last event date (both possibly 0/None) for non-manual securities. This REPLACES the
  broken GOOGLEFINANCE leftovers (probe 5) and makes yield/YOC real. Manual-priced
  securities are never touched by refresh (prices or metadata). A manual PATCH of
  `annual_dividend` on an auto-priced security is overwritten by the next refresh —
  accepted, documented (sheet behaved the same way).
- **Blocking yfinance calls run via `asyncio.to_thread`** (yfinance is sync; never block
  the event loop). Sequential per-ticker fetches (~37 tickers, tens of seconds) are fine
  for a scheduled job and for the manual refresh button (frontend passes a 120s
  AbortSignal — the client's caller-supplied signal REPLACES the 15s default, Plan 3 note).
- **Manual price PUT is guarded**: 409 unless `is_manual_priced` (spec §5 "guarded for
  non-manual securities"). It upserts `latest_prices` (source='manual') AND a
  `price_history` row for `as_of`, so private assets accrue sparkline points.
- **Day Δ** = latest price vs the last `price_history` close STRICTLY BEFORE the latest
  bar's date (per security). Null when no prior bar. Pre-first-refresh: null everywhere.
- **Allocation chart forms vs the frozen palette** (Plan 3 note: treemap/donut are
  ALL-PAIRS forms — ≤3 hues or fold/facet): the industry treemap encodes MAGNITUDE with
  the shared `SEQUENTIAL_BLUE` ramp (no hue identity → all-pairs rule sidestepped); the
  donut (holding-type | account toggle) shows top-3 slices in palette slots 1–3 + a gray
  `OTHER_SERIES_COLOR` fold. Never add hex outside `src/charts/theme.ts`.
- **Ticker is the securities natural key** — PATCH never rewrites it (same posture as
  account slugs). Securities DELETE is guarded 409 when transactions or dividends
  reference it (deactivate instead); latest/history prices alone don't block (CASCADE).
- **Percentages cross the wire as decimal fractions** (0.25 = 25%), money/shares as
  strings (pydantic Decimal → JSON string, established in Plan 3).
- **`/prices` endpoints live in their own router** (`app/api/prices.py`, prefix `/prices`)
  matching spec §5's API surface split.

## Sheet reference for Task 16 reconciliation

Read the LIVE workbook (`C:\Users\edyli\Downloads\Personal Finance Dashboard.xlsx` — never
commit it or its raw values) with openpyxl `read_only=True, data_only=True`, sheet
`Portfolio`, layout per probe 5. Reconciliation targets and tolerances:

| Target | Sheet source | Tolerance |
|---|---|---|
| holdings set | rows r3+ with Shares (c4) non-zero/non-None → set of tickers | exact set match vs computed holdings |
| shares per ticker | c4 | ≤ 1e-4 (importer quantized shares to 6dp; sheet keeps ~12dp floats) |
| cost basis per ticker | c10 | ≤ $0.10/row (Plan 2 note: 6dp-share × 4dp-price quantization drift), ≤ $3 total |
| market value per ticker | c11 | ≤ $0.25/row (price exactness verified in probe 5; drift = shares rounding × price) |
| unrealized G/L per ticker | c12 | ≤ $0.35/row (cost + MV drift combined) |
| weight per ticker | c5 | ≤ 0.001 (0.1pp) |
| realized G/L | c15 | exactly 0 everywhere |
| dividends collected | c16 | exactly 0 everywhere |
| totals row r2 | c10/c11/c12 | sum of row tolerances |
| XIRR (c14), Annual Dividend (c18), Dividend Yield (c19) | — | NOT reconciled (dead/broken columns, probe 5) |

---

## Global rules (bind every task)

**Execution process (user-mandated):** superpowers:subagent-driven-development in the
worktree. Every implementation/fix subagent runs **Opus 5** (`model: "opus"`), and per the
user's Plan 4 instruction reviewers are Opus 5 too. Implementers read ONLY their `### Task
N:` section + this Global rules section + the probes/decisions above. Each task:
implement → spec-review → quality-review (with beyond-spec probes) → fix → re-review (same
reviewer via SendMessage). Fix subagents stage ONLY their files (never `git add -A`). The
controller owns plan amendments — `docs: amend ...` commits keep plan and code
AST-equivalent. Format-wins rule: AST-identical ruff/eslint rewraps of plan code are
sanctioned without amendment.

**Gates (every task ends green):** backend tasks — `cd backend && .venv/Scripts/python.exe
-m pytest -q -W error && .venv/Scripts/python.exe -m ruff check . &&
.venv/Scripts/python.exe -m ruff format --check .` (plus `alembic check` on schema tasks;
run alembic with `DATABASE_URL` unset so it targets the dev DB default). Frontend tasks —
`npm test && npm run lint && npm run build` (lint has ONE sanctioned pre-existing warning).
Run commands FROM THE WORKTREE (`.worktrees/plan-4-portfolio`). The dev DB
(`finance-dashboard-db-1`, loopback 5433) must be up; tests create/wipe `finance_test`.

**Decimal discipline** (Plan 1 notes; PG rounds half-away-from-zero, Python quantize
defaults to banker's — always `ROUND_HALF_UP`): shares quantize 6dp bound <10^10
(Numeric(16,6)); prices 4dp <10^10 (14,4); split_factor + annual_dividend 4dp <10^6
((10,4)); fees 2dp <10^8 ((10,2)); dividend amounts 2dp <10^10 ((12,2)); percentages
returned by computations 6dp (`quantize_pct`). All API-boundary validation goes through
`app/services/money.py` helpers (Plan 3 note: money.py IS the shared 422 vocabulary —
extend it, never re-implement). Bounds are checked BEFORE insert (overflow otherwise
surfaces as bare DBAPIError sqlstate 22003).

**Ordering law:** cost-basis folding processes transactions in `(sort_index, id)` order
(Plan 1 note). Never order by txn_date (mostly NULL).

**yfinance isolation:** `app/services/price_provider.py` is the ONLY module that imports
`yfinance`/`curl_cffi`, and both imports live INSIDE functions (pandas import cost + the
`-W error` pytest gate must never meet real yfinance — tests inject fakes via
`monkeypatch.setitem(sys.modules, 'yfinance', fake)` or pass fake providers).

**Frontend house law (Plan 3 notes):** react-hooks 7 — no setState in an effect's
synchronous body (promise-callback `load()` + `beginLoad()` in event handlers, pattern at
the top of `src/pages/NetWorthPage.tsx`); `preserve-manual-memoization` may force inlining
loads in many-setter components. Charts: import ONLY from `src/charts/echarts.ts`
(register new chart types there), colors ONLY from `src/charts/theme.ts`, jsdom cannot
mount `<EChart>` (RTL tests must not render components that import it — keep chart-bearing
components in separate files from testable ones). Money strings: `Number()` for display
math only, never fed back to the API. Escape user text in tooltip HTML via
`escapeHtml` (`src/utils/format.ts`).

**Privacy:** no real workbook values in committed code/fixtures/tests. Task 16 shell
commands may reference the workbook path; the plan doc records aggregate stats only.

**Commit style:** conventional commits, one logical change each, staged file-by-file.

---

## File structure

```
backend/requirements.txt                     # +yfinance, APScheduler, tzdata (modify)
backend/app/config.py                        # +yfinance_ca_bundle, scheduler_enabled (modify)
backend/app/models/portfolio.py              # +PositionTransaction.source, TRANSACTION_SOURCES (modify)
backend/alembic/versions/<new>.py            # add source column + backfill
backend/app/services/money.py                # +share/price/split quantums + helpers (modify)
backend/app/importer/apply.py                # positions sync becomes source-aware (modify)
backend/app/services/xirr.py                 # Newton + bisection XIRR (pure)
backend/app/services/portfolio_calc.py       # folding, holdings, allocation, realized (pure + loaders)
backend/app/services/price_provider.py       # THE yfinance touchpoint (symbol map, session, fetch_daily)
backend/app/services/price_service.py        # refresh_prices, set_manual_price
backend/app/services/scheduler.py            # APScheduler wiring, cron parsing
backend/app/main.py                          # lifespan + router registration (modify)
backend/app/schemas/portfolio.py             # all portfolio/prices pydantic models
backend/app/api/portfolio.py                 # securities/transactions/dividends/holdings/allocation/realized
backend/app/api/prices.py                    # refresh, history, sparklines, manual PUT
backend/tests/test_services_xirr.py
backend/tests/test_portfolio_calc.py
backend/tests/test_price_provider.py
backend/tests/test_price_service.py
backend/tests/test_scheduler.py
backend/tests/test_portfolio_api.py
backend/tests/test_prices_api.py
backend/tests/test_importer_apply.py         # positions-sync tests updated (modify)
backend/tests/test_models_portfolio.py       # +source column test (modify)
backend/tests/test_services_money.py         # +new helper tests (modify)
src/types/api.ts                             # +portfolio/prices types (modify)
src/api/portfolio.ts                         # fetch wrappers
src/api/prices.ts                            # fetch wrappers
src/utils/format.ts                          # +decimals option, formatShares, formatDate (modify)
src/utils/format.test.ts                     # (modify)
src/charts/echarts.ts                        # +TreemapChart, PieChart (modify)
src/components/portfolio/Sparkline.tsx       # pure SVG (jsdom-testable, NO echarts)
src/components/portfolio/Sparkline.test.tsx
src/components/portfolio/HoldingsTable.tsx   # sortable table (NO echarts)
src/components/portfolio/HoldingsTable.test.tsx
src/components/portfolio/AllocationPanel.tsx # treemap + donut (echarts — no RTL)
src/components/portfolio/TransactionsPanel.tsx
src/components/portfolio/TransactionsPanel.test.tsx
src/components/portfolio/DividendsPanel.tsx
src/components/portfolio/SecuritiesPanel.tsx
src/pages/PortfolioPage.tsx                  # assembly (echarts via AllocationPanel — no RTL)
src/pages/PortfolioPage.css
src/App.tsx                                  # route swap (modify)
```

Files that change together live together: each API router owns its schemas' usage; each
frontend panel is self-contained (own state + api calls, page passes refetch callbacks).

---
## Task 1: Dependencies, config, `source` column migration, money vocabulary

**Files:**
- Modify: `backend/requirements.txt`
- Modify: `backend/app/config.py`
- Modify: `backend/app/models/portfolio.py`
- Modify: `backend/app/models/__init__.py` (re-export)
- Create: `backend/alembic/versions/<generated>_add_position_transaction_source.py`
- Modify: `backend/app/services/money.py`
- Test: `backend/tests/test_models_portfolio.py`, `backend/tests/test_services_money.py`

- [ ] **Step 1: Add dependencies and install**

Append to `backend/requirements.txt` (exact pins, planning-probed):

```
yfinance==1.6.0
APScheduler==3.11.3
tzdata==2025.2
```

(If `pip install tzdata==2025.2` reports the pin missing, use the latest available and
amend the plan.) Run from the worktree:

```bash
cd backend && .venv/Scripts/python.exe -m pip install -r requirements.txt
```

Expected: installs yfinance 1.6.0 (with pandas/curl_cffi), APScheduler 3.11.3, tzdata.

- [ ] **Step 2: Add config fields**

In `backend/app/config.py`, add two fields to `Settings` after `admin_password`:

```python
    # Path to a PEM bundle for yfinance's curl_cffi session. Needed ONLY behind
    # TLS-intercepting proxies (this dev box — see plan probe 2); prod leaves it unset.
    yfinance_ca_bundle: str | None = None
    scheduler_enabled: bool = True
```

- [ ] **Step 3: Write the failing model test**

In `backend/tests/test_models_portfolio.py`, add (match the file's existing test style —
read it first):

```python
async def test_position_transaction_source_defaults_to_ui(db):
    security = Security(ticker="TSRC", name="Source Test", holding_type="stock")
    db.add(security)
    await db.flush()
    txn = PositionTransaction(
        security_id=security.id, account="Test", type="buy",
        shares=Decimal("1"), price=Decimal("10"),
    )
    db.add(txn)
    await db.commit()
    assert txn.source == "ui"
    assert TRANSACTION_SOURCES == ("import", "ui")
```

Import `TRANSACTION_SOURCES` via the existing `from app.models import (...)` block —
Step 5 adds the package re-export (models/__init__.py re-exports every sibling tuple).

- [ ] **Step 4: Run it to make sure it fails**

`cd backend && .venv/Scripts/python.exe -m pytest tests/test_models_portfolio.py -q -W error`
Expected: FAIL (`ImportError: cannot import name 'TRANSACTION_SOURCES'`).

- [ ] **Step 5: Add the column to the model**

In `backend/app/models/portfolio.py`, next to the other tuples:

```python
TRANSACTION_SOURCES = ("import", "ui")
```

and inside `PositionTransaction`, after `sort_index`:

```python
    # Ownership contract (supersedes Plan 2's sort_index-0 rule): the importer keys and
    # sync-deletes ONLY source='import' rows; UI rows are invisible to re-imports.
    source: Mapped[str] = mapped_column(String(10), default="ui", server_default="ui")
```

Also add `TRANSACTION_SOURCES` to `backend/app/models/__init__.py`: the
`from app.models.portfolio import (...)` block (alphabetical) and `__all__` (immediately
before `"TRANSACTION_TYPES"`) — the package re-exports every sibling tuple.

- [ ] **Step 6: Run the test again** — expected: PASS (create_all picks up the column).

- [ ] **Step 7: Write the migration**

```bash
cd backend && .venv/Scripts/python.exe -m alembic revision -m "add position transaction source"
```

Fill the generated file's functions exactly (keep the generated revision identifiers):

```python
def upgrade() -> None:
    op.add_column(
        "position_transactions",
        sa.Column("source", sa.String(length=10), server_default="ui", nullable=False),
    )
    # One-time backfill for pre-Plan-4 data: at migration time, rows with a
    # sheet-assigned sort_index are exactly the importer's. NOT a durable rule —
    # UI rows created later also get sort_index > 0, so this heuristic (and this
    # migration's downgrade) must not be re-run once UI rows exist.
    op.execute("UPDATE position_transactions SET source = 'import' WHERE sort_index > 0")


def downgrade() -> None:
    op.drop_column("position_transactions", "source")
```

- [ ] **Step 8: Apply to the dev DB and check drift**

```bash
cd backend && .venv/Scripts/python.exe -m alembic upgrade head && .venv/Scripts/python.exe -m alembic check
```

Expected: upgrade runs; check reports no new upgrade operations. Then verify the backfill:

```bash
docker exec finance-dashboard-db-1 psql -U finance -d finance -c "SELECT source, count(*) FROM position_transactions GROUP BY source;"
```

Expected: `import | 26` (and no `ui` rows yet).

- [ ] **Step 9: Write failing money-helper tests**

Append to `backend/tests/test_services_money.py` (mirror its existing parametrized style):

```python
def test_quantize_shares_rounds_half_up_to_6dp():
    assert quantize_shares(Decimal("1.0000005"), "shares") == Decimal("1.000001")

def test_quantize_shares_rejects_out_of_bounds():
    with pytest.raises(HTTPException) as exc:
        quantize_shares(Decimal("1e10"), "shares")
    assert exc.value.status_code == 422
    assert "shares" in exc.value.detail

def test_quantize_price_rounds_half_up_to_4dp():
    assert quantize_price(Decimal("710.17005"), "price") == Decimal("710.1701")
    # rounding may cross the bound — still 422
    with pytest.raises(HTTPException):
        quantize_price(Decimal("9999999999.99999"), "price")

def test_quantize_price_honors_custom_bound():
    with pytest.raises(HTTPException):
        quantize_price(Decimal("1000000"), "split_factor", max_abs=MONEY_MAX_ABS_10_4)
    assert quantize_price(Decimal("3"), "split_factor", max_abs=MONEY_MAX_ABS_10_4) == Decimal("3.0000")

def test_quantize_shares_rejects_non_finite():
    with pytest.raises(HTTPException):
        quantize_shares(Decimal("NaN"), "shares")
```

- [ ] **Step 10: Run them to make sure they fail** — expected: ImportError.

- [ ] **Step 11: Extend money.py**

In `backend/app/services/money.py`, add after the existing constants:

```python
SHARE_QUANTUM = Decimal("0.000001")
PRICE_QUANTUM = Decimal("0.0001")
MONEY_MAX_ABS_10_2 = Decimal(10) ** 8  # Numeric(10,2): transaction fees
MONEY_MAX_ABS_16_6 = Decimal(10) ** 10  # Numeric(16,6): transaction shares
MONEY_MAX_ABS_14_4 = Decimal(10) ** 10  # Numeric(14,4): prices
MONEY_MAX_ABS_10_4 = Decimal(10) ** 6  # Numeric(10,4): split factors, annual dividends
```

and generalize the guard (refactor `quantize_money` to delegate; identical messages):

```python
def _quantize_bounded(value: Decimal, field: str, quantum: Decimal, max_abs: Decimal) -> Decimal:
    # Pre-check BEFORE quantize: pydantic accepts huge finite Decimals ("1e26") whose
    # quantize() raises InvalidOperation, and NaN comparisons raise too — either would
    # surface as a 500 instead of this module's promised 422.
    if not value.is_finite() or value.copy_abs() >= max_abs:
        raise HTTPException(
            status_code=422,
            detail=f"{field}: |value| must be below 10^{max_abs.adjusted()}",
        )
    quantized = value.quantize(quantum, rounding=ROUND_HALF_UP)
    if quantized.copy_abs() >= max_abs:  # rounding can cross the bound
        raise HTTPException(
            status_code=422,
            detail=f"{field}: |value| must be below 10^{max_abs.adjusted()}",
        )
    return quantized


def quantize_money(value: Decimal, field: str, max_abs: Decimal = MONEY_MAX_ABS) -> Decimal:
    return _quantize_bounded(value, field, MONEY_QUANTUM, max_abs)


def quantize_shares(value: Decimal, field: str) -> Decimal:
    return _quantize_bounded(value, field, SHARE_QUANTUM, MONEY_MAX_ABS_16_6)


def quantize_price(value: Decimal, field: str, max_abs: Decimal = MONEY_MAX_ABS_14_4) -> Decimal:
    return _quantize_bounded(value, field, PRICE_QUANTUM, max_abs)
```

(Keep the docstring/comment content of the old `quantize_money` — move the comment into
`_quantize_bounded` as shown. `quantize_pct` is untouched.)

- [ ] **Step 12: Full gate** — `pytest -q -W error`, `ruff check .`, `ruff format --check .`
from `backend/`. Expected: all pass (169 + new).

- [ ] **Step 13: Commit**

```bash
git add backend/requirements.txt backend/app/config.py backend/app/models/portfolio.py backend/app/models/__init__.py backend/alembic/versions/*add_position_transaction_source* backend/app/services/money.py backend/tests/test_models_portfolio.py backend/tests/test_services_money.py
git commit -m "feat: position transaction source column + share/price money vocabulary + price deps"
```

---

## Task 2: Importer positions sync becomes source-aware

**Files:**
- Modify: `backend/app/importer/apply.py` (`apply_positions` only)
- Test: `backend/tests/test_importer_apply.py`

Read `apply_positions` in full plus the existing positions tests in
`test_importer_apply.py` before changing anything. The current contract loads existing
rows `WHERE sort_index > 0`, keys them by `sort_index`, upserts incoming sheet rows, and
deletes importer-owned strays. The new contract is identical except ownership is
`source == 'import'` (Plan 4 locked decision — UI rows must survive ANY sort_index).

- [ ] **Step 1: Update/add the failing tests**

In `test_importer_apply.py`, find the positions-sync tests (the ones pinning "UI rows with
sort_index 0 survive"). Rewrite the pinned rule and add the collision case. The tests must
express (adapt to the file's existing fixture helpers — do not invent new ones when an
equivalent exists):

```python
async def test_apply_positions_preserves_ui_rows_any_sort_index(db):
    """UI-created rows (source='ui') survive re-import even at import-like sort_index."""
    # seed one security + one UI txn with a HIGH sort_index (as the Plan 4 API assigns)
    ...create security via existing helper...
    db.add(PositionTransaction(
        security_id=sec_id, account="UI Acct", type="buy",
        shares=Decimal("1"), price=Decimal("5"), sort_index=990, source="ui",
    ))
    await db.commit()
    ...run apply_positions with a parsed fixture containing zero rows...
    # a sync that deletes strays must NOT delete the UI row
    remaining = (await db.execute(select(PositionTransaction))).scalars().all()
    assert [t.source for t in remaining] == ["ui"]

async def test_apply_positions_marks_created_rows_import(db):
    ...apply a one-row parsed fixture...
    row = (await db.execute(select(PositionTransaction))).scalar_one()
    assert row.source == "import"
    assert row.sort_index > 0

async def test_apply_positions_sort_index_collision_leaves_ui_row_alone(db):
    """An incoming sheet row whose sort_index equals a UI row's must create a NEW
    import row, not adopt/mutate the UI row."""
    ...seed UI txn with sort_index 20, then apply a fixture whose row maps to sort_index 20...
    rows = (await db.execute(select(PositionTransaction).order_by(PositionTransaction.id))).scalars().all()
    assert sorted(r.source for r in rows) == ["import", "ui"]
```

Also UPDATE any existing test that asserts the old rule (grep the file for `sort_index`)
so the suite states the new contract exactly once, coherently.

- [ ] **Step 2: Run to verify the new tests fail**

`pytest tests/test_importer_apply.py -q -W error` — expected: the new tests FAIL (UI row
deleted / source column left 'ui' on created rows).

- [ ] **Step 3: Change `apply_positions`**

Three edits:
1. The preload query: `select(PositionTransaction).where(PositionTransaction.source == "import")`
   (replaces `.where(PositionTransaction.sort_index > 0)`).
2. Row creation: `db.add(PositionTransaction(sort_index=txn.sort_index, source="import", **fields))`.
3. Update the sync comment to describe the source-based contract (mention the accepted
   sort_index collision tie-broken by id in folding).

- [ ] **Step 4: Run the full importer suite** — `pytest tests/test_importer_apply.py
tests/test_importer_service.py tests/test_import_api.py -q -W error`. Expected: PASS.

- [ ] **Step 5: Full gate + commit**

```bash
git add backend/app/importer/apply.py backend/tests/test_importer_apply.py
git commit -m "feat: importer positions sync keys on source, freeing sort_index for UI rows"
```

---

## Task 3: XIRR service (pure, TDD)

**Files:**
- Create: `backend/app/services/xirr.py`
- Test: `backend/tests/test_services_xirr.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_services_xirr.py`:

```python
"""XIRR golden tests. The 5-flow case is Microsoft's documented XIRR example
(expected 0.373362535); the 2-flow cases have closed-form solutions."""

from datetime import date
from decimal import Decimal

from app.services.xirr import _dxnpv, xirr, xnpv


def test_microsoft_doc_example():
    flows = [
        (date(2008, 1, 1), Decimal("-10000")),
        (date(2008, 3, 1), Decimal("2750")),
        (date(2008, 10, 30), Decimal("4250")),
        (date(2009, 2, 15), Decimal("3250")),
        (date(2009, 4, 1), Decimal("2750")),
    ]
    result = xirr(flows)
    assert result is not None
    assert abs(result - Decimal("0.373363")) <= Decimal("0.000002")
    assert str(result) == "0.373363"
    assert result.as_tuple().exponent == -6


def test_two_flow_closed_form():
    # 2020 is a leap year: 366 days at exponent days/365
    flows = [(date(2020, 1, 1), Decimal("-1000")), (date(2021, 1, 1), Decimal("1100"))]
    expected = Decimal(str(1.1 ** (365 / 366) - 1))
    result = xirr(flows)
    assert result is not None
    assert abs(result - expected) <= Decimal("0.000002")


def test_deep_negative_return_uses_bisection_domain():
    flows = [(date(2020, 1, 1), Decimal("-1000")), (date(2021, 1, 1), Decimal("50"))]
    expected = Decimal(str(0.05 ** (365 / 366) - 1))  # ≈ -0.9497
    result = xirr(flows)
    assert result is not None
    assert abs(result - expected) <= Decimal("0.0002")


def test_underdetermined_cases_return_none():
    assert xirr([]) is None
    assert xirr([(date(2020, 1, 1), Decimal("-1000"))]) is None
    assert xirr([(date(2020, 1, 1), Decimal("-1")), (date(2021, 1, 1), Decimal("-2"))]) is None
    assert xirr([(date(2020, 1, 1), Decimal("1")), (date(2021, 1, 1), Decimal("2"))]) is None
    assert xirr([(date(2020, 1, 1), Decimal("-1")), (date(2020, 1, 1), Decimal("2"))]) is None


def test_input_order_does_not_trip_the_zero_span_guard():
    # First and last INPUT flows share a date; only sorting reveals the real span.
    # Without the internal sort this would return None (or a wrong t0 scaling).
    flows = [
        (date(2020, 1, 1), Decimal("-500")),
        (date(2021, 1, 1), Decimal("1100")),
        (date(2020, 1, 1), Decimal("-500")),
    ]
    result = xirr(flows)
    assert result is not None
    expected = Decimal(str(1.1 ** (365 / 366) - 1))
    assert abs(result - expected) <= Decimal("0.000002")


def test_xnpv_at_zero_rate_is_plain_sum():
    flows = [(date(2020, 1, 1), -1000.0), (date(2021, 6, 1), 400.0)]
    assert abs(xnpv(0.0, flows) - (-600.0)) < 1e-9


def test_root_outside_domain_returns_none():
    # +1,000,000% return in a year: the root lies above RATE_HI, and lo/hi NPVs share
    # a sign, so the bisection guard bails rather than fabricating a clamped rate.
    assert xirr([(date(2020, 1, 1), Decimal("-1")), (date(2021, 1, 1), Decimal("10000"))]) is None


def test_absurd_span_returns_none_not_a_crash():
    # A one-digit year typo (1926 for 2026) must degrade to None, never raise
    # ZeroDivisionError/OverflowError through the holdings page.
    flows = [(date(1926, 8, 15), Decimal("-1000")), (date(2026, 8, 15), Decimal("5000"))]
    assert xirr(flows) is None


def test_same_day_flows_netting_to_zero_return_none():
    # Without the zero-span guard this would "converge" at the Newton seed (0.1).
    flows = [(date(2020, 1, 1), Decimal("-1000")), (date(2020, 1, 1), Decimal("1000"))]
    assert xirr(flows) is None


def test_xnpv_at_nonzero_rate_discounts_from_first_flow():
    flows = [(date(2020, 1, 1), -1000.0), (date(2021, 1, 1), 1000.0)]
    expected = -1000.0 + 1000.0 / 1.1 ** (366 / 365)
    assert abs(xnpv(0.1, flows) - expected) < 1e-9


def test_analytic_derivative_matches_central_difference():
    flows = [
        (date(2020, 1, 1), -1000.0),
        (date(2020, 9, 15), 250.0),
        (date(2021, 6, 1), 400.0),
        (date(2022, 3, 10), 700.0),
    ]
    h = 1e-6
    for rate in (-0.5, 0.0, 0.1, 2.0):
        numeric = (xnpv(rate + h, flows) - xnpv(rate - h, flows)) / (2 * h)
        assert abs(_dxnpv(rate, flows) - numeric) <= 1e-4 * max(1.0, abs(numeric))
```

- [ ] **Step 2: Run to verify failure** — expected: `ModuleNotFoundError: app.services.xirr`.

- [ ] **Step 3: Implement `backend/app/services/xirr.py`**

```python
"""Irregular-cashflow IRR: Newton with bisection fallback (spec §5 portfolio_service).

Pure module — no DB, no HTTP. Floats internally (XIRR is display-only, never stored
money); Decimal at the boundary. Sign convention: money in (buys) negative, money
out/terminal value positive.
"""

from datetime import date
from decimal import Decimal

from app.services.money import quantize_pct

MAX_NEWTON_ITERATIONS = 100
MAX_BISECT_ITERATIONS = 200
# Search domain: -99.99%..+1000% annualized covers any sane personal-portfolio flow.
RATE_LO = -0.9999
RATE_HI = 10.0
# Beyond ~80 years the (1 + RATE_LO)**t discount factor underflows to exactly 0.0
# (ZeroDivisionError) and huge future spans overflow (1 + RATE_HI)**t — a mistyped
# txn_date year must never 500 /holdings. 70 years bounds every real portfolio.
MAX_SPAN_DAYS = 25550


def xnpv(rate: float, flows: list[tuple[date, float]]) -> float:
    """NPV at `rate`. Reference date is flows[0][0] — pass date-sorted, non-empty
    flows (rescaling by the reference date never moves the root)."""
    t0 = flows[0][0]
    return sum(amount / (1.0 + rate) ** ((d - t0).days / 365.0) for d, amount in flows)


def _dxnpv(rate: float, flows: list[tuple[date, float]]) -> float:
    t0 = flows[0][0]
    total = 0.0
    for d, amount in flows:
        t = (d - t0).days / 365.0
        total += -t * amount / (1.0 + rate) ** (t + 1.0)
    return total


def _finish(rate: float) -> Decimal:
    return quantize_pct(Decimal(str(rate)))


def xirr(flows: list[tuple[date, Decimal]]) -> Decimal | None:
    """Annualized IRR of dated flows.

    None when underdetermined, when the span exceeds MAX_SPAN_DAYS, or when NPV does
    not change sign across the search domain (no root there, or an even number of
    them — with sells the sequence can have multiple sign changes and multiple IRRs;
    Newton from 0.1 returns the root nearest a plausible rate, like Excel's
    guess-based XIRR).
    """
    if len(flows) < 2:
        return None
    ordered = sorted(((d, float(a)) for d, a in flows), key=lambda f: f[0])
    if not any(a > 0 for _, a in ordered) or not any(a < 0 for _, a in ordered):
        return None
    if ordered[0][0] == ordered[-1][0]:
        return None
    if (ordered[-1][0] - ordered[0][0]).days > MAX_SPAN_DAYS:
        return None
    tol = sum(abs(a) for _, a in ordered) * 1e-9

    rate = 0.1
    for _ in range(MAX_NEWTON_ITERATIONS):
        f = xnpv(rate, ordered)
        if abs(f) < tol:
            return _finish(rate)
        df = _dxnpv(rate, ordered)
        if df == 0.0:
            break
        nxt = rate - f / df
        if nxt != nxt or nxt <= RATE_LO or nxt > RATE_HI:  # NaN or out of domain
            break
        if abs(nxt - rate) < 1e-12:
            return _finish(nxt)
        rate = nxt

    lo, hi = RATE_LO, RATE_HI
    f_lo, f_hi = xnpv(lo, ordered), xnpv(hi, ordered)
    if f_lo == 0.0:
        return _finish(lo)
    if f_hi == 0.0:
        return _finish(hi)
    if (f_lo > 0) == (f_hi > 0):
        return None
    for _ in range(MAX_BISECT_ITERATIONS):
        mid = (lo + hi) / 2.0
        f_mid = xnpv(mid, ordered)
        if abs(f_mid) < tol or hi - lo < 1e-10:
            return _finish(mid)
        if (f_mid > 0) == (f_lo > 0):
            lo, f_lo = mid, f_mid
        else:
            hi = mid
    return _finish((lo + hi) / 2.0)
```

- [ ] **Step 4: Run the tests** — expected: PASS.
- [ ] **Step 5: Full gate + commit**

```bash
git add backend/app/services/xirr.py backend/tests/test_services_xirr.py
git commit -m "feat: XIRR (Newton + bisection) with golden tests"
```

---

## Task 4: Portfolio calculation service (folding, holdings, allocation — pure, TDD)

**Files:**
- Create: `backend/app/services/portfolio_calc.py`
- Test: `backend/tests/test_portfolio_calc.py`

Tests use TRANSIENT model instances (`Security(id=1, ...)` etc., never added to a
session) — realistic objects, zero DB. Set ids explicitly.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_portfolio_calc.py`:

```python
from datetime import date, datetime, timezone
from decimal import Decimal

from app.models import DividendPayment, LatestPrice, PositionTransaction, PriceHistory, Security
from app.services.portfolio_calc import allocation, build_holdings, fold_transactions

D = Decimal


def txn(id, sec=1, account="Acct", type="buy", shares="1", price="10",
        fees=None, split_factor=None, sort_index=0, txn_date=None):
    return PositionTransaction(
        id=id, security_id=sec, account=account, type=type,
        shares=D(shares), price=D(price),
        fees=None if fees is None else D(fees),
        split_factor=None if split_factor is None else D(split_factor),
        sort_index=sort_index, txn_date=txn_date, source="ui",
    )


def sec(id, ticker, industry="Tech", holding_type="stock", annual_dividend=None):
    return Security(
        id=id, ticker=ticker, name=f"{ticker} Inc", industry=industry,
        holding_type=holding_type, is_manual_priced=False, is_active=True,
        annual_dividend=None if annual_dividend is None else D(annual_dividend),
    )


def lp(sec_id, price, day=14):
    return LatestPrice(
        security_id=sec_id, price=D(price),
        quoted_at=datetime(2026, 8, day, tzinfo=timezone.utc), source="yfinance",
    )


class TestFolding:
    def test_buys_accumulate_shares_and_cost_with_fees(self):
        positions = fold_transactions([
            txn(1, shares="10", price="100", fees="1", sort_index=10),
            txn(2, shares="5", price="130", sort_index=20),
        ])
        pos = positions[(1, "Acct")]
        assert pos.shares == D("15")
        assert pos.cost_basis == D("1651")  # 10*100+1 + 5*130
        assert pos.realized_gl == 0

    def test_sell_realizes_at_average_cost(self):
        positions = fold_transactions([
            txn(1, shares="10", price="100", sort_index=10),
            txn(2, type="sell", shares="4", price="150", fees="2", sort_index=20),
        ])
        pos = positions[(1, "Acct")]
        assert pos.shares == D("6")
        assert pos.realized_gl == D("198")  # 4*(150-100) - 2
        assert pos.cost_basis == D("600")
        assert pos.warnings == []

    def test_split_multiplies_shares_only(self):
        positions = fold_transactions([
            txn(1, shares="10", price="100", sort_index=10),
            txn(2, type="split", shares="0", price="0", split_factor="3", sort_index=20),
        ])
        pos = positions[(1, "Acct")]
        assert pos.shares == D("30")
        assert pos.cost_basis == D("1000")

    def test_fold_order_is_sort_index_then_id_not_input_order(self):
        # sell arrives FIRST in the list but folds SECOND by sort_index
        positions = fold_transactions([
            txn(2, type="sell", shares="5", price="20", sort_index=20),
            txn(1, shares="10", price="10", sort_index=10),
        ])
        pos = positions[(1, "Acct")]
        assert pos.realized_gl == D("50")
        assert pos.warnings == []

    def test_oversell_and_orphan_sell_warn_but_never_raise(self):
        positions = fold_transactions([
            txn(1, type="sell", shares="5", price="10", sort_index=10),
        ])
        pos = positions[(1, "Acct")]
        assert pos.shares == D("-5")
        assert pos.cost_basis == 0
        assert any("no held shares" in w for w in pos.warnings)

    def test_invalid_split_factor_warns_and_skips(self):
        positions = fold_transactions([
            txn(1, shares="10", price="10", sort_index=10),
            txn(2, type="split", shares="0", price="0", split_factor=None, sort_index=20),
        ])
        pos = positions[(1, "Acct")]
        assert pos.shares == D("10")
        assert any("split" in w for w in pos.warnings)

    def test_accounts_fold_separately_and_dateless_flag(self):
        positions = fold_transactions([
            txn(1, account="A", shares="1", price="10", sort_index=10,
                txn_date=date(2026, 1, 2)),
            txn(2, account="B", shares="2", price="10", sort_index=20),
        ])
        assert positions[(1, "A")].has_dateless_txn is False
        assert positions[(1, "B")].has_dateless_txn is True
        assert positions[(1, "A")].dated_flows == [(date(2026, 1, 2), D("-10"))]


class TestHoldings:
    def _one_holding(self, **overrides):
        securities = {1: sec(1, "VOO", holding_type="etf", annual_dividend=overrides.pop("annual_dividend", "6.5"))}
        positions = fold_transactions([
            txn(1, shares="10", price="400", sort_index=10, txn_date=overrides.pop("txn_date", None)),
        ])
        latest = {1: lp(1, "500")}
        history = {1: [
            PriceHistory(security_id=1, price_date=date(2026, 8, 13), close=D("490")),
            PriceHistory(security_id=1, price_date=date(2026, 8, 14), close=D("500")),
        ]}
        dividends = overrides.pop("dividends", [])
        return build_holdings(positions, securities, latest, history, dividends,
                              today=date(2026, 8, 14))

    def test_market_value_unrealized_and_day_change(self):
        (h,) = self._one_holding()
        assert h.market_value == D("5000.00")
        assert h.cost_basis == D("4000.00")
        assert h.unrealized_gl == D("1000.00")
        assert h.unrealized_gl_pct == D("0.250000")
        assert h.day_change_pct == D("0.020408")  # (500-490)/490
        assert h.day_change_amount == D("100.00")
        assert h.avg_cost == D("400.0000")

    def test_yield_yoc_and_annual_income(self):
        (h,) = self._one_holding()
        assert h.annual_income == D("65.00")
        assert h.yield_pct == D("0.013000")
        assert h.yoc_pct == D("0.016250")

    def test_xirr_null_when_dateless_and_set_when_dated(self):
        (h,) = self._one_holding()
        assert h.xirr_pct is None  # dateless buy
        (h2,) = self._one_holding(txn_date=date(2025, 8, 14))
        assert h2.xirr_pct is not None
        assert h2.xirr_pct == D("0.250000")  # 4000 -> 5000 in exactly 365 days

    def test_dividends_collected_feeds_xirr_flows(self):
        div = DividendPayment(id=1, security_id=1, account="Acct",
                              pay_date=date(2026, 2, 1), amount=D("30"))
        (h,) = self._one_holding(txn_date=date(2025, 8, 14), dividends=[div])
        assert h.dividends_collected == D("30.00")
        assert h.xirr_pct is not None and h.xirr_pct > D("0.250000")

    def test_priceless_security_yields_null_money_fields(self):
        securities = {1: sec(1, "ZI")}
        positions = fold_transactions([txn(1, shares="2", price="10", sort_index=10)])
        (h,) = build_holdings(positions, securities, {}, {}, [], today=date(2026, 8, 14))
        assert h.market_value is None and h.unrealized_gl is None
        assert h.day_change_pct is None and h.xirr_pct is None
        assert h.cost_basis == D("20.00")

    def test_zero_share_positions_are_excluded(self):
        securities = {1: sec(1, "VOO")}
        positions = fold_transactions([
            txn(1, shares="10", price="400", sort_index=10),
            txn(2, type="sell", shares="10", price="450", sort_index=20),
        ])
        holdings = build_holdings(positions, securities, {1: lp(1, "500")}, {}, [],
                                  today=date(2026, 8, 14))
        assert holdings == []

    def test_holdings_sorted_by_market_value_desc(self):
        securities = {1: sec(1, "AAA"), 2: sec(2, "BBB")}
        positions = fold_transactions([
            txn(1, sec=1, shares="1", price="10", sort_index=10),
            txn(2, sec=2, shares="100", price="10", sort_index=20),
        ])
        holdings = build_holdings(positions, securities,
                                  {1: lp(1, "10"), 2: lp(2, "10")}, {}, [],
                                  today=date(2026, 8, 14))
        assert [h.security.ticker for h in holdings] == ["BBB", "AAA"]


class TestAllocation:
    def _fixture(self):
        securities = {
            1: sec(1, "VOO", industry="ETF", holding_type="etf"),
            2: sec(2, "NVDA", industry="Semis", holding_type="stock"),
            3: sec(3, "MYST", industry=None, holding_type="stock"),
        }
        positions = fold_transactions([
            txn(1, sec=1, account="Robinhood", shares="1", price="1", sort_index=10),
            txn(2, sec=2, account="Schwab", shares="2", price="1", sort_index=20),
            txn(3, sec=2, account="Robinhood", shares="1", price="1", sort_index=30),
            txn(4, sec=3, account="Schwab", shares="1", price="1", sort_index=40),
        ])
        latest = {1: lp(1, "100"), 2: lp(2, "200"), 3: lp(3, "50")}
        return positions, securities, latest

    def test_allocation_by_type_and_industry(self):
        positions, securities, latest = self._fixture()
        by_type = allocation(positions, securities, latest, "type")
        assert by_type == [("stock", D("650.00"), 2), ("etf", D("100.00"), 1)]
        by_industry = allocation(positions, securities, latest, "industry")
        assert by_industry[0] == ("Semis", D("600.00"), 1)
        assert ("Uncategorized", D("50.00"), 1) in by_industry

    def test_allocation_by_account_uses_position_grain(self):
        positions, securities, latest = self._fixture()
        by_account = allocation(positions, securities, latest, "account")
        assert by_account == [("Schwab", D("450.00"), 2), ("Robinhood", D("300.00"), 2)]
```

- [ ] **Step 2: Run to verify failure** — expected: ModuleNotFoundError.

- [ ] **Step 3: Implement `backend/app/services/portfolio_calc.py`**

```python
"""Query-time portfolio math (spec §4: derived values are NEVER stored).

Personal scale (~37 securities, tens of transactions): full loads + in-memory folds are
the entire strategy, mirroring net_worth_calc. Folding law: (sort_index, id) order —
txn_date is mostly NULL (Plan 1 forward note) and must never drive order.
"""

from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    DividendPayment,
    LatestPrice,
    PositionTransaction,
    PriceHistory,
    Security,
)
from app.services.money import quantize_pct
from app.services.xirr import xirr

ZERO = Decimal("0")
MONEY_Q = Decimal("0.01")
SHARE_Q = Decimal("0.000001")
PRICE_Q = Decimal("0.0001")

PositionKey = tuple[int, str]  # (security_id, account)


@dataclass
class Position:
    security_id: int
    account: str
    shares: Decimal = ZERO
    cost_basis: Decimal = ZERO
    realized_gl: Decimal = ZERO
    has_dateless_txn: bool = False
    dated_flows: list[tuple[date, Decimal]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def fold_transactions(txns: list[PositionTransaction]) -> dict[PositionKey, Position]:
    """Average-cost folding (the sheet's method). Permissive: bad data folds with a
    warning attached, never raises — a data-entry mistake must not 500 the page."""
    positions: dict[PositionKey, Position] = {}
    for txn in sorted(txns, key=lambda t: (t.sort_index, t.id)):
        key = (txn.security_id, txn.account)
        pos = positions.setdefault(key, Position(security_id=txn.security_id, account=txn.account))
        if txn.type == "split":
            if txn.split_factor is None or txn.split_factor <= 0:
                pos.warnings.append(f"txn {txn.id}: split without a positive factor — skipped")
                continue
            pos.shares *= txn.split_factor
            continue
        fees = txn.fees or ZERO
        if txn.txn_date is None:
            pos.has_dateless_txn = True
        if txn.type == "buy":
            pos.shares += txn.shares
            pos.cost_basis += txn.shares * txn.price + fees
            if txn.txn_date is not None:
                pos.dated_flows.append((txn.txn_date, -(txn.shares * txn.price + fees)))
        elif txn.type == "sell":
            if pos.shares > 0:
                avg = pos.cost_basis / pos.shares
            else:
                avg = ZERO
                pos.warnings.append(f"txn {txn.id}: sell with no held shares")
            if txn.shares > pos.shares and pos.shares > 0:
                pos.warnings.append(f"txn {txn.id}: sell exceeds held shares")
            pos.realized_gl += txn.shares * (txn.price - avg) - fees
            pos.cost_basis -= txn.shares * avg
            pos.shares -= txn.shares
            if pos.shares <= 0:
                pos.cost_basis = ZERO  # liquidated (or overdrawn) position has no basis
            if txn.txn_date is not None:
                pos.dated_flows.append((txn.txn_date, txn.shares * txn.price - fees))
        else:
            # No DB CHECK on type (app-layer posture) — tolerate unknown values.
            pos.warnings.append(f"txn {txn.id}: unknown type {txn.type!r} — skipped")
    return positions


@dataclass
class Holding:
    security: Security
    shares: Decimal
    avg_cost: Decimal | None
    cost_basis: Decimal
    realized_gl: Decimal
    dividends_collected: Decimal
    accounts: list[str]
    warnings: list[str]
    price: Decimal | None
    quoted_at: datetime | None
    price_source: str | None
    market_value: Decimal | None
    day_change_pct: Decimal | None
    day_change_amount: Decimal | None
    unrealized_gl: Decimal | None
    unrealized_gl_pct: Decimal | None
    annual_income: Decimal | None
    yield_pct: Decimal | None
    yoc_pct: Decimal | None
    xirr_pct: Decimal | None


def build_holdings(
    positions: dict[PositionKey, Position],
    securities_by_id: dict[int, Security],
    latest_by_sec: dict[int, LatestPrice],
    history_by_sec: dict[int, list[PriceHistory]],
    dividends: list[DividendPayment],
    today: date,
) -> list[Holding]:
    """One row per security with non-zero folded shares, market-value-desc order."""
    div_total: dict[int, Decimal] = {}
    div_flows: dict[int, list[tuple[date, Decimal]]] = {}
    for payment in dividends:
        div_total[payment.security_id] = div_total.get(payment.security_id, ZERO) + payment.amount
        div_flows.setdefault(payment.security_id, []).append((payment.pay_date, payment.amount))

    by_security: dict[int, list[Position]] = {}
    for pos in positions.values():
        by_security.setdefault(pos.security_id, []).append(pos)

    holdings: list[Holding] = []
    for sec_id, folded in by_security.items():
        security = securities_by_id.get(sec_id)
        if security is None:
            continue  # orphaned txn row; unreachable through the API (FK), defensive
        shares = sum((p.shares for p in folded), ZERO).quantize(SHARE_Q)
        if shares == 0:
            continue
        cost_basis = sum((p.cost_basis for p in folded), ZERO).quantize(MONEY_Q)
        realized = sum((p.realized_gl for p in folded), ZERO).quantize(MONEY_Q)
        warnings = [w for p in folded for w in p.warnings]
        has_dateless = any(p.has_dateless_txn for p in folded)
        dated_flows = [flow for p in folded for flow in p.dated_flows]
        accounts = sorted({p.account for p in folded})
        collected = div_total.get(sec_id, ZERO).quantize(MONEY_Q)

        latest = latest_by_sec.get(sec_id)
        price = latest.price if latest is not None else None
        bars = history_by_sec.get(sec_id, [])
        prev_close = bars[-2].close if len(bars) >= 2 else None

        market_value = (shares * price).quantize(MONEY_Q) if price is not None else None
        day_pct = day_amt = None
        if price is not None and prev_close is not None and prev_close != 0:
            day_pct = quantize_pct((price - prev_close) / prev_close)
            day_amt = (shares * (price - prev_close)).quantize(MONEY_Q)
        unrealized = unrealized_pct = None
        if market_value is not None:
            unrealized = market_value - cost_basis
            if cost_basis > 0:
                unrealized_pct = quantize_pct(unrealized / cost_basis)
        avg_cost = (cost_basis / shares).quantize(PRICE_Q) if shares > 0 else None
        annual = security.annual_dividend
        annual_income = (annual * shares).quantize(MONEY_Q) if annual is not None else None
        yield_pct = (
            quantize_pct(annual / price)
            if annual is not None and price is not None and price != 0
            else None
        )
        yoc_pct = (
            quantize_pct(annual / avg_cost)
            if annual is not None and avg_cost is not None and avg_cost > 0
            else None
        )
        xirr_pct = None
        if not has_dateless and dated_flows and market_value is not None and shares > 0:
            flows = dated_flows + div_flows.get(sec_id, []) + [(today, market_value)]
            xirr_pct = xirr(flows)

        holdings.append(
            Holding(
                security=security, shares=shares, avg_cost=avg_cost, cost_basis=cost_basis,
                realized_gl=realized, dividends_collected=collected, accounts=accounts,
                warnings=warnings, price=price,
                quoted_at=latest.quoted_at if latest is not None else None,
                price_source=latest.source if latest is not None else None,
                market_value=market_value, day_change_pct=day_pct, day_change_amount=day_amt,
                unrealized_gl=unrealized, unrealized_gl_pct=unrealized_pct,
                annual_income=annual_income, yield_pct=yield_pct, yoc_pct=yoc_pct,
                xirr_pct=xirr_pct,
            )
        )
    holdings.sort(key=lambda h: (h.market_value is None, -(h.market_value or ZERO), h.security.ticker))
    return holdings


def allocation(
    positions: dict[PositionKey, Position],
    securities_by_id: dict[int, Security],
    latest_by_sec: dict[int, LatestPrice],
    by: str,
) -> list[tuple[str, Decimal, int]]:
    """[(bucket key, market value, distinct holdings in bucket)], MV desc then key.
    `by`: 'industry' | 'type' (per-security grain) or 'account' (per-position grain).
    Zero-share and priceless positions are skipped (the endpoint reports the counts)."""
    buckets: dict[str, Decimal] = {}
    members: dict[str, set] = {}
    if by == "account":
        for pos in positions.values():
            latest = latest_by_sec.get(pos.security_id)
            if latest is None or pos.shares.quantize(SHARE_Q) == 0:
                continue
            value = (pos.shares * latest.price).quantize(MONEY_Q)
            buckets[pos.account] = buckets.get(pos.account, ZERO) + value
            members.setdefault(pos.account, set()).add(pos.security_id)
    else:
        shares_by_sec: dict[int, Decimal] = {}
        for pos in positions.values():
            shares_by_sec[pos.security_id] = shares_by_sec.get(pos.security_id, ZERO) + pos.shares
        for sec_id, shares in shares_by_sec.items():
            security = securities_by_id.get(sec_id)
            latest = latest_by_sec.get(sec_id)
            if security is None or latest is None or shares.quantize(SHARE_Q) == 0:
                continue
            key = security.holding_type if by == "type" else (security.industry or "Uncategorized")
            value = (shares * latest.price).quantize(MONEY_Q)
            buckets[key] = buckets.get(key, ZERO) + value
            members.setdefault(key, set()).add(sec_id)
    return sorted(
        ((key, value, len(members[key])) for key, value in buckets.items()),
        key=lambda item: (-item[1], item[0]),
    )


async def load_portfolio(
    db: AsyncSession,
) -> tuple[
    dict[int, Security],
    list[PositionTransaction],
    dict[int, LatestPrice],
    dict[int, list[PriceHistory]],
    list[DividendPayment],
]:
    securities = {
        s.id: s for s in (await db.execute(select(Security))).scalars()
    }
    txns = list(
        (
            await db.execute(
                select(PositionTransaction).order_by(
                    PositionTransaction.sort_index, PositionTransaction.id
                )
            )
        ).scalars()
    )
    latest = {p.security_id: p for p in (await db.execute(select(LatestPrice))).scalars()}
    history: dict[int, list[PriceHistory]] = {}
    rows = (
        await db.execute(
            select(PriceHistory).order_by(PriceHistory.security_id, PriceHistory.price_date)
        )
    ).scalars()
    for row in rows:
        history.setdefault(row.security_id, []).append(row)
    dividends = list((await db.execute(select(DividendPayment))).scalars())
    return securities, txns, latest, history, dividends
```

- [ ] **Step 4: Run the tests** — expected: PASS. If a Decimal quantization expectation
mismatches, fix the TEST only if the implementation follows the discipline table
(HALF_UP at the documented quantum) — otherwise fix the code.

- [ ] **Step 5: Full gate + commit**

```bash
git add backend/app/services/portfolio_calc.py backend/tests/test_portfolio_calc.py
git commit -m "feat: portfolio folding/holdings/allocation service"
```

---
## Task 5: Price provider (the ONLY yfinance touchpoint)

**Files:**
- Create: `backend/app/services/price_provider.py`
- Test: `backend/tests/test_price_provider.py`

Both third-party imports live INSIDE functions so the pytest suite (`-W error`) and app
boot never pay the pandas import unless a fetch actually runs (Global rules).

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_price_provider.py`:

```python
"""Provider tests NEVER touch the network: a fake `yfinance` module is injected into
sys.modules before fetch_daily's lazy import runs."""

import sys
from datetime import date, datetime, timezone
from decimal import Decimal
from types import SimpleNamespace

import pytest

from app.services.price_provider import DailyBar, YFinanceProvider, yahoo_symbol


def test_yahoo_symbol_maps_dots_to_dashes():
    assert yahoo_symbol("BRK.B") == "BRK-B"
    assert yahoo_symbol("NVDA") == "NVDA"


class FakeFrame:
    """Duck-typed pandas frame: .empty and .iterrows() are all fetch_daily uses."""

    def __init__(self, rows):
        self._rows = rows

    @property
    def empty(self):
        return not self._rows

    def iterrows(self):
        return iter(self._rows)


class FakeRow(dict):
    def get(self, key, default=None):
        return super().get(key, default)


def _fake_yf(frame, seen):
    class FakeTicker:
        def __init__(self, symbol, session=None):
            seen["symbol"] = symbol
            seen["session"] = session

        def history(self, **kwargs):
            seen["history_kwargs"] = kwargs
            return frame

    return SimpleNamespace(Ticker=FakeTicker)


def _ts(day):
    return SimpleNamespace(date=lambda d=day: d)


def test_fetch_daily_maps_bars_and_kwargs(monkeypatch):
    seen = {}
    frame = FakeFrame([
        (_ts(date(2026, 8, 13)), FakeRow({"Close": 490.1234567, "Dividends": 0.0})),
        (_ts(date(2026, 8, 14)), FakeRow({"Close": 500.5, "Dividends": 1.75})),
    ])
    monkeypatch.setitem(sys.modules, "yfinance", _fake_yf(frame, seen))
    provider = YFinanceProvider.__new__(YFinanceProvider)  # skip session build
    provider._session = "SENTINEL"
    bars = provider.fetch_daily("BRK.B", date(2026, 8, 1))
    assert seen["symbol"] == "BRK-B"
    assert seen["session"] == "SENTINEL"
    assert seen["history_kwargs"] == {
        "start": "2026-08-01", "interval": "1d", "auto_adjust": False, "actions": True,
    }
    assert bars == [
        DailyBar(bar_date=date(2026, 8, 13), close=Decimal("490.1235"), dividend=Decimal("0.0000")),
        DailyBar(bar_date=date(2026, 8, 14), close=Decimal("500.5000"), dividend=Decimal("1.7500")),
    ]


def test_fetch_daily_skips_nan_and_none_closes(monkeypatch):
    frame = FakeFrame([
        (_ts(date(2026, 8, 12)), FakeRow({"Close": float("nan"), "Dividends": 0.0})),
        (_ts(date(2026, 8, 13)), FakeRow({"Close": None, "Dividends": 0.0})),
        (_ts(date(2026, 8, 14)), FakeRow({"Close": 10.0})),  # Dividends column absent
    ])
    monkeypatch.setitem(sys.modules, "yfinance", _fake_yf(frame, {}))
    provider = YFinanceProvider.__new__(YFinanceProvider)
    provider._session = None
    bars = provider.fetch_daily("NVDA", date(2026, 8, 1))
    assert bars == [DailyBar(bar_date=date(2026, 8, 14), close=Decimal("10.0000"), dividend=Decimal("0"))]


def test_fetch_daily_empty_frame_returns_empty(monkeypatch):
    monkeypatch.setitem(sys.modules, "yfinance", _fake_yf(FakeFrame([]), {}))
    provider = YFinanceProvider.__new__(YFinanceProvider)
    provider._session = None
    assert provider.fetch_daily("ZI", date(2026, 8, 1)) == []
```

- [ ] **Step 2: Run to verify failure** — expected: ModuleNotFoundError.

- [ ] **Step 3: Implement `backend/app/services/price_provider.py`**

```python
"""THE yfinance touchpoint (spec §5: provider isolated so an alternative can swap in).

Nothing else in the app may import yfinance or curl_cffi, and both are imported lazily
inside functions: tests inject fakes via sys.modules, and app/pytest startup never pays
the pandas import. Verified against yfinance 1.6.0 (plan probes 1-3)."""

import math
from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Protocol

PRICE_QUANTUM = Decimal("0.0001")


def yahoo_symbol(ticker: str) -> str:
    """Yahoo spells class shares with a dash: BRK.B -> BRK-B (probe 3)."""
    return ticker.replace(".", "-")


@dataclass(frozen=True)
class DailyBar:
    bar_date: date
    close: Decimal
    dividend: Decimal


class PriceProvider(Protocol):
    def fetch_daily(self, ticker: str, start: date) -> list[DailyBar]: ...


def build_session(ca_bundle: str | None):
    """curl_cffi session impersonating a browser. `ca_bundle` works around
    TLS-intercepting proxies (dev box); None uses curl_cffi's default trust."""
    from curl_cffi import requests as curl_requests

    # A whitespace-only env value would pass `or True` truthiness and hand curl a
    # bogus CA path — normalize to None first (Task 1 review).
    normalized = ca_bundle.strip() if ca_bundle else None
    return curl_requests.Session(impersonate="chrome", verify=normalized or True)


class YFinanceProvider:
    def __init__(self, ca_bundle: str | None = None):
        self._session = build_session(ca_bundle)

    def fetch_daily(self, ticker: str, start: date) -> list[DailyBar]:
        """Daily bars from `start` through today (Close + dividend events). Raises on
        transport errors (caller isolates per ticker); returns [] when Yahoo has no data."""
        import yfinance as yf

        frame = yf.Ticker(yahoo_symbol(ticker), session=self._session).history(
            start=start.isoformat(), interval="1d", auto_adjust=False, actions=True
        )
        if frame is None or frame.empty:
            return []
        bars: list[DailyBar] = []
        for idx, row in frame.iterrows():
            close = row.get("Close")
            if close is None or (isinstance(close, float) and math.isnan(close)):
                continue
            dividend = row.get("Dividends", 0.0) or 0.0
            bars.append(
                DailyBar(
                    bar_date=idx.date(),
                    close=Decimal(str(float(close))).quantize(PRICE_QUANTUM, rounding=ROUND_HALF_UP),
                    dividend=Decimal(str(float(dividend))).quantize(PRICE_QUANTUM, rounding=ROUND_HALF_UP),
                )
            )
        return bars
```

- [ ] **Step 4: Run the tests** — expected: PASS (and confirm the suite stayed fast — no
real pandas import: `pytest tests/test_price_provider.py -q -W error` well under 5s).

- [ ] **Step 5: Full gate + commit**

```bash
git add backend/app/services/price_provider.py backend/tests/test_price_provider.py
git commit -m "feat: yfinance price provider with symbol mapping and CA-bundle session"
```

---

## Task 6: Price service — refresh + manual price (TDD, fake provider)

**Files:**
- Create: `backend/app/services/price_service.py`
- Test: `backend/tests/test_price_service.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_price_service.py` (uses the `db` fixture; seed helpers local
to the file):

```python
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import select

from app.models import LatestPrice, PriceHistory, Security
from app.services.price_provider import DailyBar
from app.services.price_service import (
    HISTORY_WINDOW_DAYS,
    refresh_prices,
    set_manual_price,
)

D = Decimal
TODAY = date(2026, 8, 14)


class FakeProvider:
    def __init__(self, data=None, errors=None):
        self.data = data or {}
        self.errors = errors or {}
        self.calls: list[tuple[str, date]] = []

    def fetch_daily(self, ticker, start):
        self.calls.append((ticker, start))
        if ticker in self.errors:
            raise self.errors[ticker]
        return self.data.get(ticker, [])


def bar(day, close, dividend="0"):
    return DailyBar(bar_date=day, close=D(close), dividend=D(dividend))


async def seed_security(db, ticker, *, manual=False, active=True, annual_dividend=None):
    sec = Security(
        ticker=ticker, name=f"{ticker} Inc", holding_type="stock",
        is_manual_priced=manual, is_active=active,
        annual_dividend=annual_dividend,
    )
    db.add(sec)
    await db.commit()
    return sec


async def test_refresh_upserts_history_latest_and_dividend_metadata(db):
    sec = await seed_security(db, "NVDA", annual_dividend=D("99"))
    provider = FakeProvider({
        "NVDA": [
            bar(TODAY - timedelta(days=200), "100", "0.75"),
            bar(TODAY - timedelta(days=1), "220"),
            bar(TODAY, "225.5", "0.25"),
        ],
    })
    result = await refresh_prices(db, provider, today=TODAY)
    assert result.updated == ["NVDA"]
    assert result.failed == {} and result.skipped_manual == []
    assert provider.calls == [("NVDA", TODAY - timedelta(days=HISTORY_WINDOW_DAYS))]
    history = (await db.execute(select(PriceHistory).order_by(PriceHistory.price_date))).scalars().all()
    assert [(h.price_date, h.close) for h in history] == [
        (TODAY - timedelta(days=200), D("100.0000")),
        (TODAY - timedelta(days=1), D("220.0000")),
        (TODAY, D("225.5000")),
    ]
    latest = await db.get(LatestPrice, sec.id)
    assert latest.price == D("225.5000") and latest.source == "yfinance"
    assert latest.quoted_at == datetime(2026, 8, 14, tzinfo=timezone.utc)
    await db.refresh(sec)
    assert sec.annual_dividend == D("1.0000")  # TTM sum replaces the stale 99
    assert sec.ex_div_date == TODAY


async def test_refresh_is_idempotent_and_updates_existing_rows(db):
    sec = await seed_security(db, "VOO")
    provider = FakeProvider({"VOO": [bar(TODAY, "500")]})
    await refresh_prices(db, provider, today=TODAY)
    provider.data["VOO"] = [bar(TODAY, "501")]
    result = await refresh_prices(db, provider, today=TODAY)
    assert result.updated == ["VOO"]
    history = (await db.execute(select(PriceHistory))).scalars().all()
    assert len(history) == 1 and history[0].close == D("501.0000")
    assert (await db.get(LatestPrice, sec.id)).price == D("501.0000")


async def test_refresh_failure_keeps_last_good_price(db):
    sec = await seed_security(db, "ZI")
    db.add(LatestPrice(security_id=sec.id, price=D("10"),
                       quoted_at=datetime(2026, 1, 1, tzinfo=timezone.utc), source="manual"))
    await db.commit()
    provider = FakeProvider(errors={"ZI": RuntimeError("boom")})
    result = await refresh_prices(db, provider, today=TODAY)
    assert "ZI" in result.failed and "boom" in result.failed["ZI"]
    latest = await db.get(LatestPrice, sec.id)
    assert latest.price == D("10.0000") and latest.source == "manual"


async def test_refresh_empty_bars_counts_as_failure(db):
    await seed_security(db, "ZI")
    result = await refresh_prices(db, FakeProvider({"ZI": []}), today=TODAY)
    assert result.failed == {"ZI": "no data returned"}


async def test_refresh_skips_manual_and_inactive(db):
    await seed_security(db, "PRIV", manual=True)
    await seed_security(db, "DEAD", active=False)
    provider = FakeProvider()
    result = await refresh_prices(db, provider, today=TODAY)
    assert result.skipped_manual == ["PRIV"]
    assert provider.calls == []  # inactive isn't even attempted


async def test_refresh_one_failure_does_not_block_others(db):
    await seed_security(db, "AAA")
    await seed_security(db, "BBB")
    provider = FakeProvider(
        data={"BBB": [bar(TODAY, "7")]}, errors={"AAA": RuntimeError("nope")}
    )
    result = await refresh_prices(db, provider, today=TODAY)
    assert result.updated == ["BBB"] and "AAA" in result.failed


async def test_refresh_skips_out_of_bounds_bars(db):
    await seed_security(db, "WILD")
    provider = FakeProvider({"WILD": [
        bar(TODAY - timedelta(days=1), "10000000000"),  # 10^10: over Numeric(14,4)
        bar(TODAY, "-5"),                                # negative close: junk
    ]})
    result = await refresh_prices(db, provider, today=TODAY)
    assert result.failed == {"WILD": "no data returned"}
    assert (await db.execute(select(PriceHistory))).scalars().all() == []


async def test_set_manual_price_upserts_latest_and_history(db):
    sec = await seed_security(db, "PRIV", manual=True)
    await set_manual_price(db, sec, D("31.89"), as_of=date(2026, 8, 10))
    await db.commit()
    latest = await db.get(LatestPrice, sec.id)
    assert latest.price == D("31.8900") and latest.source == "manual"
    assert latest.quoted_at == datetime(2026, 8, 10, tzinfo=timezone.utc)
    await set_manual_price(db, sec, D("32.00"), as_of=date(2026, 8, 10))
    await db.commit()
    history = (await db.execute(select(PriceHistory))).scalars().all()
    assert len(history) == 1 and history[0].close == D("32.0000")
```

- [ ] **Step 2: Run to verify failure** — expected: ModuleNotFoundError.

- [ ] **Step 3: Implement `backend/app/services/price_service.py`**

```python
"""Price refresh + manual price writes. The ONLY writers of latest_prices/price_history
after import seeding (Plan 2 note: the importer is insert-only and never updates prices).

Refresh strategy (locked decision): every run re-fetches a full 370-day daily window per
ticker (one HTTP call either way) and idempotently upserts — first run backfills ~1yr of
history (spec §4), later runs self-heal any gap, and the same bars carry the dividend
events that maintain securities.annual_dividend/ex_div_date (TTM view). Failures are
per-ticker: last good price stays (spec §5)."""

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import LatestPrice, PriceHistory, Security
from app.services.price_provider import DailyBar, PriceProvider

logger = logging.getLogger(__name__)

HISTORY_WINDOW_DAYS = 370
TTM_DAYS = 365
PRICE_MAX_ABS = Decimal(10) ** 10  # Numeric(14,4)
DIVIDEND_MAX_ABS = Decimal(10) ** 6  # Numeric(10,4)
ERROR_SNIPPET_LEN = 200


@dataclass
class RefreshResult:
    updated: list[str] = field(default_factory=list)
    failed: dict[str, str] = field(default_factory=dict)
    skipped_manual: list[str] = field(default_factory=list)


def _bar_datetime(day: date) -> datetime:
    # quoted_at reflects DATA age (the bar's date), not fetch time — the UI's staleness
    # display is honest even when Yahoo serves Friday's close on a Sunday.
    return datetime.combine(day, time(0), tzinfo=UTC)


async def refresh_prices(
    db: AsyncSession, provider: PriceProvider, *, today: date | None = None
) -> RefreshResult:
    today = today or date.today()
    start = today - timedelta(days=HISTORY_WINDOW_DAYS)
    result = RefreshResult()
    securities = list(
        (
            await db.execute(
                select(Security).where(Security.is_active.is_(True)).order_by(Security.ticker)
            )
        ).scalars()
    )
    latest_rows: list[dict] = []
    for security in securities:
        if security.is_manual_priced:
            result.skipped_manual.append(security.ticker)
            continue
        try:
            bars = await asyncio.to_thread(provider.fetch_daily, security.ticker, start)
        except Exception as exc:  # provider transport errors must never kill the batch
            result.failed[security.ticker] = f"{type(exc).__name__}: {exc}"[:ERROR_SNIPPET_LEN]
            continue
        bars = [b for b in bars if 0 < b.close < PRICE_MAX_ABS]
        if not bars:
            result.failed[security.ticker] = "no data returned"
            continue
        history_stmt = pg_insert(PriceHistory).values(
            [
                {"security_id": security.id, "price_date": b.bar_date, "close": b.close}
                for b in bars
            ]
        )
        await db.execute(
            history_stmt.on_conflict_do_update(
                index_elements=["security_id", "price_date"],
                set_={"close": history_stmt.excluded.close},
            )
        )
        last = bars[-1]
        latest_rows.append(
            {
                "security_id": security.id,
                "price": last.close,
                "quoted_at": _bar_datetime(last.bar_date),
                "source": "yfinance",
            }
        )
        _update_dividend_metadata(security, bars, today)
        result.updated.append(security.ticker)
    if latest_rows:
        # Plan 1 forward note: one bulk ON CONFLICT DO UPDATE for the whole ticker batch.
        latest_stmt = pg_insert(LatestPrice).values(latest_rows)
        await db.execute(
            latest_stmt.on_conflict_do_update(
                index_elements=["security_id"],
                set_={
                    "price": latest_stmt.excluded.price,
                    "quoted_at": latest_stmt.excluded.quoted_at,
                    "source": latest_stmt.excluded.source,
                },
            )
        )
    await db.commit()
    if result.failed:
        logger.warning("price refresh failures: %s", sorted(result.failed))
    return result


def _update_dividend_metadata(security: Security, bars: list[DailyBar], today: date) -> None:
    """TTM dividend sum + last event date. Replaces the sheet's broken GOOGLEFINANCE
    leftovers (plan probe 5); a manual edit on an auto-priced security is overwritten
    next refresh by design."""
    window_start = today - timedelta(days=TTM_DAYS)
    events = [b for b in bars if b.dividend > 0 and b.bar_date > window_start]
    ttm = sum((b.dividend for b in events), Decimal("0"))
    if ttm >= DIVIDEND_MAX_ABS:
        return  # absurd feed value; keep the previous metadata
    security.annual_dividend = ttm.quantize(Decimal("0.0001"))
    security.ex_div_date = max((b.bar_date for b in events), default=None)


async def set_manual_price(
    db: AsyncSession, security: Security, price: Decimal, as_of: date
) -> None:
    """Manual quote for is_manual_priced securities. Writes BOTH latest_prices and a
    price_history row so private assets accrue sparkline points. Caller commits."""
    latest_stmt = pg_insert(LatestPrice).values(
        security_id=security.id, price=price, quoted_at=_bar_datetime(as_of), source="manual"
    )
    await db.execute(
        latest_stmt.on_conflict_do_update(
            index_elements=["security_id"],
            set_={
                "price": latest_stmt.excluded.price,
                "quoted_at": latest_stmt.excluded.quoted_at,
                "source": latest_stmt.excluded.source,
            },
        )
    )
    history_stmt = pg_insert(PriceHistory).values(
        security_id=security.id, price_date=as_of, close=price
    )
    await db.execute(
        history_stmt.on_conflict_do_update(
            index_elements=["security_id", "price_date"],
            set_={"close": history_stmt.excluded.close},
        )
    )
```

- [ ] **Step 4: Run the tests** — expected: PASS. Note: the shared-session contract in
conftest means `refresh_prices` committing inside is fine (it owns its session in prod
via the scheduler, and the router passes the request session).

- [ ] **Step 5: Full gate + commit**

```bash
git add backend/app/services/price_service.py backend/tests/test_price_service.py
git commit -m "feat: price refresh service (history backfill, TTM dividends, manual prices)"
```

---

## Task 7: Scheduler + app lifespan

**Files:**
- Create: `backend/app/services/scheduler.py`
- Modify: `backend/app/main.py`
- Modify: `backend/.env.example` (document the two new env vars)
- Test: `backend/tests/test_scheduler.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_scheduler.py`:

```python
from apscheduler.triggers.cron import CronTrigger

from app.models import AppSetting
from app.services.scheduler import (
    DEFAULT_PRICE_REFRESH_CRON,
    build_trigger,
    read_cron_setting,
)


def test_build_trigger_parses_valid_cron():
    trigger = build_trigger("10 13 * * 1-5")
    assert isinstance(trigger, CronTrigger)


def test_build_trigger_falls_back_on_garbage():
    trigger = build_trigger("not a cron at all")
    assert isinstance(trigger, CronTrigger)  # falls back to the default, never raises


async def test_read_cron_setting_envelope_and_fallbacks(db):
    assert await read_cron_setting(db) == DEFAULT_PRICE_REFRESH_CRON  # missing row
    db.add(AppSetting(key="price_refresh_cron", value={"value": "0 6 * * *"}))
    await db.commit()
    assert await read_cron_setting(db) == "0 6 * * *"
    setting = await db.get(AppSetting, "price_refresh_cron")
    setting.value = {"value": 123}  # envelope holds a non-string — fall back
    await db.commit()
    assert await read_cron_setting(db) == DEFAULT_PRICE_REFRESH_CRON
```

- [ ] **Step 2: Run to verify failure** — expected: ModuleNotFoundError.

- [ ] **Step 3: Implement `backend/app/services/scheduler.py`**

```python
"""APScheduler wiring (spec §5): price refresh on a cron read from app_settings,
America/Los_Angeles (the spec's '13:10 PT weekdays'). The job owns its DB session.

Started from the FastAPI lifespan when settings.scheduler_enabled — pytest's
ASGITransport never runs the lifespan (plan probe 7), so tests never start it."""

import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import AppSetting

logger = logging.getLogger(__name__)

DEFAULT_PRICE_REFRESH_CRON = "10 13 * * 1-5"
SCHEDULER_TIMEZONE = "America/Los_Angeles"


async def read_cron_setting(db: AsyncSession) -> str:
    """app_settings['price_refresh_cron'] envelope {"value": "..."} — envelope is
    convention-only (Plan 1 note), so any unexpected shape falls back to the default."""
    setting = await db.get(AppSetting, "price_refresh_cron")
    if setting is None or not isinstance(setting.value, dict):
        return DEFAULT_PRICE_REFRESH_CRON
    raw = setting.value.get("value")
    return raw if isinstance(raw, str) and raw.strip() else DEFAULT_PRICE_REFRESH_CRON


def build_trigger(cron: str) -> CronTrigger:
    try:
        return CronTrigger.from_crontab(cron, timezone=SCHEDULER_TIMEZONE)
    except ValueError:
        logger.warning("invalid price_refresh_cron %r — using default", cron)
        return CronTrigger.from_crontab(DEFAULT_PRICE_REFRESH_CRON, timezone=SCHEDULER_TIMEZONE)


async def _refresh_job() -> None:
    # Imports deferred: the job is the only scheduler code path that needs them, and
    # keeping them here keeps app import time (and pytest collection) lean.
    from app.database import SessionLocal
    from app.services.price_provider import YFinanceProvider
    from app.services.price_service import refresh_prices

    provider = YFinanceProvider(settings.yfinance_ca_bundle)
    async with SessionLocal() as db:
        result = await refresh_prices(db, provider)
    logger.info(
        "scheduled price refresh: %d updated, %d failed, %d manual-skipped",
        len(result.updated), len(result.failed), len(result.skipped_manual),
    )


async def start_scheduler() -> AsyncIOScheduler:
    from app.database import SessionLocal

    async with SessionLocal() as db:
        cron = await read_cron_setting(db)
    scheduler = AsyncIOScheduler(timezone=SCHEDULER_TIMEZONE)
    scheduler.add_job(
        _refresh_job,
        trigger=build_trigger(cron),
        id="price_refresh",
        coalesce=True,
        max_instances=1,
        misfire_grace_time=3600,
    )
    scheduler.start()
    logger.info("price refresh scheduled: %r (%s)", cron, SCHEDULER_TIMEZONE)
    return scheduler
```

- [ ] **Step 4: Wire the lifespan in `backend/app/main.py`**

Replace the app construction with:

```python
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.api import auth, import_, net_worth, spending
from app.config import settings
from app.rate_limit import limiter


@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler = None
    if settings.scheduler_enabled:
        from app.services.scheduler import start_scheduler

        scheduler = await start_scheduler()
    yield
    if scheduler is not None:
        scheduler.shutdown(wait=False)


app = FastAPI(
    title="Personal Finance Dashboard",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    lifespan=lifespan,
)
```

NOTE: the router import line above is exactly the CURRENT set — Task 8 adds `portfolio`
and Task 11 adds `prices` to it (plus their `include_router` lines). Do not pre-import
modules that don't exist yet.

- [ ] **Step 4b: Document the new env vars in `backend/.env.example`** — append after
`# CORS_ORIGINS=...`, matching the file's commented-defaults style:

```
# SCHEDULER_ENABLED=true
# Dev-box only: PEM bundle for yfinance behind a TLS-intercepting proxy (see README/plan).
# YFINANCE_CA_BUNDLE=
```

- [ ] **Step 5: Run the scheduler tests + full suite** — expected: PASS (the suite proves
app import still works with the lifespan in place).

- [ ] **Step 6: Boot smoke test** — verify the scheduler actually starts under uvicorn:

```bash
cd backend && SCHEDULER_ENABLED=true .venv/Scripts/python.exe -c "
import asyncio
from app.main import app

async def main():
    async with app.router.lifespan_context(app):
        print('lifespan entered OK')

asyncio.run(main())
"
```

Expected: `price refresh scheduled: '10 13 * * 1-5' (America/Los_Angeles)` log +
`lifespan entered OK` (dev DB must be up — the cron is read from it).

- [ ] **Step 7: Full gate + commit**

```bash
git add backend/app/services/scheduler.py backend/app/main.py backend/.env.example backend/tests/test_scheduler.py
git commit -m "feat: APScheduler price-refresh cron wired into app lifespan"
```

---

## Task 8: Portfolio schemas + securities router

**Files:**
- Create: `backend/app/schemas/portfolio.py`
- Create: `backend/app/api/portfolio.py`
- Modify: `backend/app/main.py` (register router)
- Test: `backend/tests/test_portfolio_api.py`

- [ ] **Step 1: Create ALL portfolio/prices schemas up front**

`backend/app/schemas/portfolio.py` — later tasks import from here; keep names EXACT:

```python
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

HoldingTypeLiteral = Literal["etf", "mutual_fund", "stock", "private"]
TransactionTypeLiteral = Literal["buy", "sell", "split"]


class SecurityCreate(BaseModel):
    ticker: str = Field(min_length=1, max_length=20)
    name: str = Field(min_length=1, max_length=200)
    industry: str | None = Field(default=None, max_length=80)
    holding_type: HoldingTypeLiteral
    is_manual_priced: bool = False
    annual_dividend: Decimal | None = None
    ex_div_date: date | None = None


class SecurityUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    industry: str | None = Field(default=None, max_length=80)
    holding_type: HoldingTypeLiteral | None = None
    is_manual_priced: bool | None = None
    is_active: bool | None = None
    annual_dividend: Decimal | None = None
    ex_div_date: date | None = None


class SecurityOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    ticker: str
    name: str
    industry: str | None
    holding_type: str
    is_manual_priced: bool
    is_active: bool
    annual_dividend: Decimal | None
    ex_div_date: date | None


class TransactionCreate(BaseModel):
    security_id: int
    account: str = Field(min_length=1, max_length=80)
    type: TransactionTypeLiteral
    txn_date: date | None = None
    shares: Decimal | None = None
    price: Decimal | None = None
    fees: Decimal | None = None
    split_factor: Decimal | None = None
    notes: str | None = None


class TransactionUpdate(BaseModel):
    account: str | None = Field(default=None, min_length=1, max_length=80)
    type: TransactionTypeLiteral | None = None
    txn_date: date | None = None
    shares: Decimal | None = None
    price: Decimal | None = None
    fees: Decimal | None = None
    split_factor: Decimal | None = None
    notes: str | None = None


class TransactionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    security_id: int
    account: str
    type: str
    txn_date: date | None
    shares: Decimal
    price: Decimal
    fees: Decimal | None
    split_factor: Decimal | None
    sort_index: int
    source: str
    notes: str | None


class DividendCreate(BaseModel):
    security_id: int
    account: str | None = Field(default=None, max_length=80)
    pay_date: date
    amount: Decimal
    notes: str | None = None


class DividendUpdate(BaseModel):
    account: str | None = Field(default=None, max_length=80)
    pay_date: date | None = None
    amount: Decimal | None = None
    notes: str | None = None


class DividendOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    security_id: int
    account: str | None
    pay_date: date
    amount: Decimal
    notes: str | None


class HoldingOut(BaseModel):
    security_id: int
    ticker: str
    name: str
    industry: str | None
    holding_type: str
    is_manual_priced: bool
    shares: Decimal
    avg_cost: Decimal | None
    cost_basis: Decimal
    price: Decimal | None
    quoted_at: datetime | None
    price_source: str | None
    day_change_pct: Decimal | None
    day_change_amount: Decimal | None
    market_value: Decimal | None
    weight_pct: Decimal | None
    unrealized_gl: Decimal | None
    unrealized_gl_pct: Decimal | None
    realized_gl: Decimal
    dividends_collected: Decimal
    annual_dividend: Decimal | None
    annual_income: Decimal | None
    yield_pct: Decimal | None
    yoc_pct: Decimal | None
    xirr_pct: Decimal | None
    accounts: list[str]
    warnings: list[str]


class HoldingsTotals(BaseModel):
    market_value: Decimal
    cost_basis: Decimal
    unrealized_gl: Decimal
    unrealized_gl_pct: Decimal | None
    day_change_amount: Decimal | None
    day_change_pct: Decimal | None
    realized_gl: Decimal
    dividends_collected: Decimal
    annual_income: Decimal
    unpriced_count: int


class HoldingsOut(BaseModel):
    as_of: datetime | None  # OLDEST quoted_at among priced holdings (conservative staleness)
    totals: HoldingsTotals
    holdings: list[HoldingOut]


class AllocationSlice(BaseModel):
    key: str
    market_value: Decimal
    weight_pct: Decimal
    holdings: int


class AllocationOut(BaseModel):
    by: Literal["industry", "type", "account"]
    total_market_value: Decimal
    slices: list[AllocationSlice]


class RealizedRow(BaseModel):
    security_id: int
    ticker: str
    name: str
    realized_gl: Decimal


class RealizedOut(BaseModel):
    total: Decimal
    rows: list[RealizedRow]


class RefreshOut(BaseModel):
    updated: list[str]
    failed: dict[str, str]
    skipped_manual: list[str]
    duration_ms: int


class PricePoint(BaseModel):
    d: date
    c: Decimal


class PriceHistoryOut(BaseModel):
    ticker: str
    points: list[PricePoint]


class ManualPriceIn(BaseModel):
    price: Decimal
    as_of: date | None = None


class LatestPriceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    security_id: int
    price: Decimal
    quoted_at: datetime
    source: str
```

- [ ] **Step 2: Write the failing securities-router tests**

Create `backend/tests/test_portfolio_api.py` starting with the securities section
(transactions/dividends/holdings tests are appended by Tasks 9–10 — structure the file
with clear `# --- securities ---` section comments). Follow `test_net_worth_api.py`'s
style (client fixture, auth token helper — read that file first). Cover:

```python
# --- securities ---
async def test_list_securities_ordered_by_ticker(client, db): ...
    # seed two out of order, expect ticker asc

async def test_create_security_normalizes_and_persists(client, db): ...
    # POST {"ticker": " nvda ", "name": "NVIDIA", "holding_type": "stock"} -> 201,
    # body.ticker == "NVDA"; annual_dividend absent -> None

async def test_create_security_conflicts_on_duplicate_ticker(client, db): ...
    # second POST with same ticker (any case) -> 409

async def test_create_security_rejects_bad_ticker_and_type(client, db): ...
    # ticker "BAD TICKER!" -> 422 (regex); holding_type "banana" -> 422 (Literal)

async def test_create_security_bounds_annual_dividend(client, db): ...
    # annual_dividend "1000000" -> 422 via quantize_price(..., MONEY_MAX_ABS_10_4)

async def test_patch_security_updates_fields_never_ticker(client, db): ...
    # PATCH name/industry/is_manual_priced/annual_dividend -> 200 reflected;
    # payload {"ticker": "X"} is IGNORED (extra field), ticker unchanged

async def test_patch_security_null_clears_nullable_only(client, db): ...
    # {"industry": None, "annual_dividend": None} clears them;
    # {"name": None} leaves name untouched (non-nullable no-op, accounts PATCH posture)

async def test_delete_security_guarded_when_referenced(client, db): ...
    # security with one transaction -> DELETE 409 mentioning counts;
    # security with only a latest_price -> DELETE 204 (price rows don't block)

async def test_securities_require_auth(client): ...
    # GET without token -> 401
```

Write each fully (bodies, asserts, seeds) in the implementer's own hand matching house
style — the CONTRACT above is binding, the phrasing is not.

- [ ] **Step 3: Run to verify failure** — expected: 404s/ImportError.

- [ ] **Step 4: Implement the securities section of `backend/app/api/portfolio.py`**

```python
import re
from datetime import date
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models import DividendPayment, PositionTransaction, Security
from app.schemas.portfolio import (
    SecurityCreate,
    SecurityOut,
    SecurityUpdate,
)
from app.services.money import MONEY_MAX_ABS_10_4, quantize_price

router = APIRouter(
    prefix="/portfolio", tags=["portfolio"], dependencies=[Depends(get_current_user)]
)

TICKER_RE = re.compile(r"^[A-Z0-9.\-]{1,20}$")


def _normalize_ticker(raw: str) -> str:
    ticker = raw.strip().upper()
    if not TICKER_RE.fullmatch(ticker):
        raise HTTPException(
            status_code=422,
            detail="ticker must be 1-20 characters of A-Z, 0-9, dot or dash",
        )
    return ticker


@router.get("/securities", response_model=list[SecurityOut])
async def list_securities(db: AsyncSession = Depends(get_db)) -> list[Security]:
    return list((await db.execute(select(Security).order_by(Security.ticker))).scalars())


@router.post("/securities", response_model=SecurityOut, status_code=201)
async def create_security(body: SecurityCreate, db: AsyncSession = Depends(get_db)) -> Security:
    ticker = _normalize_ticker(body.ticker)
    existing = (
        (await db.execute(select(Security).where(Security.ticker == ticker))).scalars().first()
    )
    if existing is not None:
        raise HTTPException(status_code=409, detail=f"security {ticker!r} already exists")
    annual = body.annual_dividend
    if annual is not None:
        annual = quantize_price(annual, "annual_dividend", max_abs=MONEY_MAX_ABS_10_4)
        if annual < 0:
            raise HTTPException(status_code=422, detail="annual_dividend must be >= 0")
    security = Security(
        ticker=ticker,
        name=body.name,
        industry=body.industry,
        holding_type=body.holding_type,
        is_manual_priced=body.is_manual_priced,
        annual_dividend=annual,
        ex_div_date=body.ex_div_date,
    )
    db.add(security)
    await db.commit()
    return security


async def _get_security(db: AsyncSession, security_id: int) -> Security:
    security = await db.get(Security, security_id)
    if security is None:
        raise HTTPException(status_code=404, detail="security not found")
    return security


# ticker is the importer's natural key — PATCH never rewrites it (account-slug posture).
NON_NULLABLE_SECURITY_FIELDS = {"name", "holding_type", "is_manual_priced", "is_active"}


@router.patch("/securities/{security_id}", response_model=SecurityOut)
async def update_security(
    security_id: int, body: SecurityUpdate, db: AsyncSession = Depends(get_db)
) -> Security:
    security = await _get_security(db, security_id)
    updates = body.model_dump(exclude_unset=True)
    for field_name, value in updates.items():
        if value is None and field_name in NON_NULLABLE_SECURITY_FIELDS:
            continue  # explicit null on a NOT NULL column = no-op request
        if field_name == "annual_dividend" and value is not None:
            value = quantize_price(value, "annual_dividend", max_abs=MONEY_MAX_ABS_10_4)
            if value < 0:
                raise HTTPException(status_code=422, detail="annual_dividend must be >= 0")
        setattr(security, field_name, value)
    await db.commit()
    return security


@router.delete("/securities/{security_id}", status_code=204)
async def delete_security(security_id: int, db: AsyncSession = Depends(get_db)) -> Response:
    security = await _get_security(db, security_id)
    txn_count = (
        await db.execute(
            select(func.count())
            .select_from(PositionTransaction)
            .where(PositionTransaction.security_id == security_id)
        )
    ).scalar_one()
    dividend_count = (
        await db.execute(
            select(func.count())
            .select_from(DividendPayment)
            .where(DividendPayment.security_id == security_id)
        )
    ).scalar_one()
    if txn_count or dividend_count:
        raise HTTPException(
            status_code=409,
            detail=(
                f"security has {txn_count} transactions and {dividend_count} dividends"
                " — deactivate it instead"
            ),
        )
    await db.delete(security)  # latest/history price rows CASCADE — derived data
    await db.commit()
    return Response(status_code=204)
```

Register in `main.py`: add `portfolio` to the `app.api` import and
`app.include_router(portfolio.router, prefix="/api/v1")` after spending.

- [ ] **Step 5: Run the tests** — expected: PASS.
- [ ] **Step 6: Full gate + commit**

```bash
git add backend/app/schemas/portfolio.py backend/app/api/portfolio.py backend/app/main.py backend/tests/test_portfolio_api.py
git commit -m "feat: portfolio schemas + securities CRUD"
```

---
## Task 9: Transactions + dividends CRUD

**Files:**
- Modify: `backend/app/api/portfolio.py`
- Modify: `backend/app/services/money.py` (+require_reasonable_date)
- Test: `backend/tests/test_portfolio_api.py` (append sections), `backend/tests/test_services_money.py` (+1)

First, extend the shared 422 vocabulary in `backend/app/services/money.py` (Task 3 review:
`txn_date`/`pay_date` have no range validation anywhere, and downstream consumers — XIRR
spans, day-Δ, refresh windows — should never see a mistyped year):

```python
DATE_MIN = date(1900, 1, 1)
DATE_MAX = date(2100, 12, 31)


def require_reasonable_date(value: date, field: str) -> date:
    """Century-bounded sanity guard: a mistyped year (1026, 3026) must 422 at the API
    boundary, not surface as absurd spans in XIRR/day-Δ/refresh windows downstream."""
    if not DATE_MIN <= value <= DATE_MAX:
        raise HTTPException(
            status_code=422,
            detail=f"{field}: date must be between {DATE_MIN} and {DATE_MAX}",
        )
    return value
```

with a unit test in `test_services_money.py` (1900-01-01 and 2100-12-31 pass; 1899-12-31
and 2101-01-01 raise 422 naming the field). Then apply it in this task's endpoints:
`create_transaction`/`update_transaction` validate a non-null `txn_date`;
`create_dividend`/`update_dividend` validate `pay_date`.

- [ ] **Step 1: Write the failing tests** (append `# --- transactions ---` and
`# --- dividends ---` sections; same house style). Cover exactly:

```python
# --- transactions ---
async def test_create_buy_assigns_source_ui_and_max_plus_10_sort_index(client, db): ...
    # seed an import-owned txn with sort_index 260 (source='import'), then POST a buy ->
    # 201, body.source == "ui", body.sort_index == 270; a SECOND POST -> 280.
    # On an EMPTY table the first UI txn gets sort_index 10.

async def test_create_buy_quantizes_shares_price_fees(client, db): ...
    # shares "1.0000005" -> "1.000001"; price "10.00005" -> "10.0001"; fees "1.005" -> "1.01"

async def test_create_buy_sell_validation(client, db): ...
    # missing shares -> 422 "shares"; shares "0" -> 422; price missing -> 422;
    # negative fees -> 422; split_factor present on a buy -> 422

async def test_create_split_forces_dummy_shares_price(client, db): ...
    # POST {type: "split", split_factor: "3"} -> 201 with shares "0.000000", price "0.0000";
    # POST split WITHOUT split_factor -> 422; split with shares "5" -> 422

async def test_create_transaction_unknown_security_422(client, db): ...

async def test_patch_transaction_validates_merged_row(client, db): ...
    # PATCH price on a buy -> 200 requantized; PATCH {type: "split"} on a buy WITHOUT
    # split_factor -> 422 (merged row invalid); PATCH split_factor alone on a split -> 200

async def test_patch_transaction_never_touches_source_or_sort_index(client, db): ...
    # PATCH an import-owned row's price -> 200, source stays "import", sort_index unchanged
    # (extra keys in the payload are ignored by pydantic)

async def test_delete_transaction_hard_deletes(client, db): ...
    # DELETE -> 204, row gone (both sources deletable; import rows resurrect on re-import — documented)

async def test_list_transactions_filters_and_orders(client, db): ...
    # ?security_id= filters; order is (sort_index, id)

# --- dividends ---
async def test_dividend_crud_roundtrip(client, db): ...
    # POST -> 201 (amount "12.345" -> "12.35" HALF_UP); GET list ordered pay_date desc, id desc;
    # PATCH amount -> 200; DELETE -> 204

async def test_dividend_validation(client, db): ...
    # amount "0" -> 422; amount "-5" -> 422; unknown security_id -> 422;
    # account longer than 80 chars -> 422 (schema max_length)

async def test_transaction_and_dividend_dates_must_be_reasonable(client, db): ...
    # txn_date "1026-08-15" -> 422 naming txn_date; dividend pay_date "3026-01-01" ->
    # 422 naming pay_date (require_reasonable_date; PATCH paths covered too)
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement.** Append to `backend/app/api/portfolio.py` (extend imports:
`TransactionCreate/TransactionUpdate/TransactionOut/DividendCreate/DividendUpdate/
DividendOut` from schemas, `MONEY_MAX_ABS_10_2`, `MONEY_MAX_ABS_12_2`, `quantize_money`,
`quantize_shares` from money):

```python
def _validated_txn_fields(
    type_: str,
    shares: Decimal | None,
    price: Decimal | None,
    fees: Decimal | None,
    split_factor: Decimal | None,
) -> dict:
    """Type-shape law: buy/sell carry shares>0 + price>=0 (+ optional fees>=0, no
    split_factor); split carries split_factor>0 ONLY — shares/price stored as the
    Plan 1 dummy 0s so folding reads only the factor."""
    if type_ == "split":
        if split_factor is None:
            raise HTTPException(status_code=422, detail="split requires split_factor")
        factor = quantize_price(split_factor, "split_factor", max_abs=MONEY_MAX_ABS_10_4)
        if factor <= 0:
            raise HTTPException(status_code=422, detail="split_factor must be positive")
        if shares not in (None, Decimal("0")) or price not in (None, Decimal("0")):
            raise HTTPException(
                status_code=422, detail="split rows carry no shares/price (dummy 0s)"
            )
        if fees is not None:
            raise HTTPException(status_code=422, detail="split rows carry no fees")
        return {
            "shares": Decimal("0"),
            "price": Decimal("0"),
            "fees": None,
            "split_factor": factor,
        }
    if split_factor is not None:
        raise HTTPException(status_code=422, detail=f"{type_} rows carry no split_factor")
    if shares is None or price is None:
        raise HTTPException(status_code=422, detail=f"{type_} requires shares and price")
    quantized_shares = quantize_shares(shares, "shares")
    if quantized_shares <= 0:
        raise HTTPException(status_code=422, detail="shares must be positive")
    quantized_price = quantize_price(price, "price")
    if quantized_price < 0:
        raise HTTPException(status_code=422, detail="price must be >= 0")
    quantized_fees = None
    if fees is not None:
        quantized_fees = quantize_money(fees, "fees", max_abs=MONEY_MAX_ABS_10_2)
        if quantized_fees < 0:
            raise HTTPException(status_code=422, detail="fees must be >= 0")
    return {
        "shares": quantized_shares,
        "price": quantized_price,
        "fees": quantized_fees,
        "split_factor": None,
    }


@router.get("/transactions", response_model=list[TransactionOut])
async def list_transactions(
    security_id: int | None = None, db: AsyncSession = Depends(get_db)
) -> list[PositionTransaction]:
    query = select(PositionTransaction).order_by(
        PositionTransaction.sort_index, PositionTransaction.id
    )
    if security_id is not None:
        query = query.where(PositionTransaction.security_id == security_id)
    return list((await db.execute(query)).scalars())


@router.post("/transactions", response_model=TransactionOut, status_code=201)
async def create_transaction(
    body: TransactionCreate, db: AsyncSession = Depends(get_db)
) -> PositionTransaction:
    if await db.get(Security, body.security_id) is None:
        raise HTTPException(status_code=422, detail=f"unknown security_id: {body.security_id}")
    fields = _validated_txn_fields(body.type, body.shares, body.price, body.fees, body.split_factor)
    if body.txn_date is not None:
        require_reasonable_date(body.txn_date, "txn_date")
    max_index = (
        await db.execute(select(func.coalesce(func.max(PositionTransaction.sort_index), 0)))
    ).scalar_one()
    # UI rows fold chronologically LAST (locked decision). A later sheet import may mint
    # the same sort_index for a new row — folding tie-breaks on id; accepted.
    txn = PositionTransaction(
        security_id=body.security_id,
        account=body.account.strip(),
        type=body.type,
        txn_date=body.txn_date,
        sort_index=max_index + 10,
        source="ui",
        notes=body.notes,
        **fields,
    )
    db.add(txn)
    await db.commit()
    return txn


async def _get_transaction(db: AsyncSession, txn_id: int) -> PositionTransaction:
    txn = await db.get(PositionTransaction, txn_id)
    if txn is None:
        raise HTTPException(status_code=404, detail="transaction not found")
    return txn


@router.patch("/transactions/{txn_id}", response_model=TransactionOut)
async def update_transaction(
    txn_id: int, body: TransactionUpdate, db: AsyncSession = Depends(get_db)
) -> PositionTransaction:
    txn = await _get_transaction(db, txn_id)
    provided = body.model_dump(exclude_unset=True)
    # Validate the MERGED row so a type flip can't leave an inconsistent shape.
    merged_type = provided.get("type", txn.type)
    merged = _validated_txn_fields(
        merged_type,
        provided.get("shares", txn.shares),
        provided.get("price", txn.price),
        provided.get("fees", txn.fees),
        provided.get("split_factor", txn.split_factor),
    )
    if "account" in provided:
        if provided["account"] is None:
            raise HTTPException(status_code=422, detail="account cannot be null")
        txn.account = provided["account"].strip()
    if "txn_date" in provided:
        if provided["txn_date"] is not None:
            require_reasonable_date(provided["txn_date"], "txn_date")
        txn.txn_date = provided["txn_date"]
    if "notes" in provided:
        txn.notes = provided["notes"]
    txn.type = merged_type
    txn.shares = merged["shares"]
    txn.price = merged["price"]
    txn.fees = merged["fees"]
    txn.split_factor = merged["split_factor"]
    # source/sort_index are ownership metadata — never PATCHable. Edits to
    # source='import' rows are legal but the next re-import reverts them (sheet wins).
    await db.commit()
    return txn


@router.delete("/transactions/{txn_id}", status_code=204)
async def delete_transaction(txn_id: int, db: AsyncSession = Depends(get_db)) -> Response:
    txn = await _get_transaction(db, txn_id)
    await db.delete(txn)  # import-owned rows resurrect on the next re-import — documented
    await db.commit()
    return Response(status_code=204)


@router.get("/dividends", response_model=list[DividendOut])
async def list_dividends(
    security_id: int | None = None, db: AsyncSession = Depends(get_db)
) -> list[DividendPayment]:
    query = select(DividendPayment).order_by(
        DividendPayment.pay_date.desc(), DividendPayment.id.desc()
    )
    if security_id is not None:
        query = query.where(DividendPayment.security_id == security_id)
    return list((await db.execute(query)).scalars())


def _validated_dividend_amount(amount: Decimal) -> Decimal:
    quantized = quantize_money(amount, "amount", max_abs=MONEY_MAX_ABS_12_2)
    if quantized <= 0:
        raise HTTPException(status_code=422, detail="amount must be positive")
    return quantized


@router.post("/dividends", response_model=DividendOut, status_code=201)
async def create_dividend(
    body: DividendCreate, db: AsyncSession = Depends(get_db)
) -> DividendPayment:
    if await db.get(Security, body.security_id) is None:
        raise HTTPException(status_code=422, detail=f"unknown security_id: {body.security_id}")
    require_reasonable_date(body.pay_date, "pay_date")
    dividend = DividendPayment(
        security_id=body.security_id,
        account=body.account.strip() if body.account else None,
        pay_date=body.pay_date,
        amount=_validated_dividend_amount(body.amount),
        notes=body.notes,
    )
    db.add(dividend)
    await db.commit()
    return dividend


@router.patch("/dividends/{dividend_id}", response_model=DividendOut)
async def update_dividend(
    dividend_id: int, body: DividendUpdate, db: AsyncSession = Depends(get_db)
) -> DividendPayment:
    dividend = await db.get(DividendPayment, dividend_id)
    if dividend is None:
        raise HTTPException(status_code=404, detail="dividend not found")
    provided = body.model_dump(exclude_unset=True)
    if "amount" in provided:
        if provided["amount"] is None:
            raise HTTPException(status_code=422, detail="amount cannot be null")
        dividend.amount = _validated_dividend_amount(provided["amount"])
    if "pay_date" in provided:
        if provided["pay_date"] is None:
            raise HTTPException(status_code=422, detail="pay_date cannot be null")
        dividend.pay_date = require_reasonable_date(provided["pay_date"], "pay_date")
    if "account" in provided:
        dividend.account = provided["account"].strip() if provided["account"] else None
    if "notes" in provided:
        dividend.notes = provided["notes"]
    await db.commit()
    return dividend


@router.delete("/dividends/{dividend_id}", status_code=204)
async def delete_dividend(dividend_id: int, db: AsyncSession = Depends(get_db)) -> Response:
    dividend = await db.get(DividendPayment, dividend_id)
    if dividend is None:
        raise HTTPException(status_code=404, detail="dividend not found")
    await db.delete(dividend)
    await db.commit()
    return Response(status_code=204)
```

(Extend the money import line: `from app.services.money import MONEY_MAX_ABS_10_2,
MONEY_MAX_ABS_10_4, MONEY_MAX_ABS_12_2, quantize_money, quantize_price, quantize_shares,
require_reasonable_date`.)

- [ ] **Step 4: Run the tests** — expected: PASS.
- [ ] **Step 5: Full gate + commit**

```bash
git add backend/app/api/portfolio.py backend/app/services/money.py backend/tests/test_portfolio_api.py backend/tests/test_services_money.py
git commit -m "feat: transactions + dividends CRUD with type-shape and date-range validation"
```

---

## Task 10: Holdings, allocation, realized endpoints

**Files:**
- Modify: `backend/app/api/portfolio.py`
- Test: `backend/tests/test_portfolio_api.py` (append `# --- computed views ---`)

- [ ] **Step 1: Write the failing tests.** Seed via the API + direct db adds (prices
via db — no prices API yet). Cover:

```python
# --- computed views ---
async def test_holdings_end_to_end_math(client, db): ...
    # Two securities, one with latest price + two history bars + a dividend + dated buy:
    # assert one holding's full JSON: shares/cost_basis/market_value/weight_pct/
    # unrealized_gl/day_change_pct/dividends_collected/yield_pct/xirr_pct non-null,
    # money fields are STRINGS ("5000.00"), weight sums to 1 across holdings
    # (within 0.000002), as_of == the OLDEST quoted_at, totals consistent
    # (totals.market_value == sum of rows, unrealized == mv - cost).

async def test_holdings_empty_portfolio(client, db): ...
    # no transactions -> 200 {"as_of": None, totals zeros/unpriced_count 0, holdings: []}

async def test_holdings_unpriced_holding_flagged(client, db): ...
    # txn on a security with NO latest_price -> market_value/weight null,
    # totals.unpriced_count == 1, totals exclude it from market_value

async def test_allocation_by_each_dimension_weights_sum_to_one(client, db): ...
    # by=industry|type|account -> 200, slices desc, weight_pct sums ~1;
    # by=banana -> 422 (Literal query param)

async def test_realized_rows_only_for_nonzero(client, db): ...
    # buy+sell one security via API -> realized row present, total == row sum;
    # buy-only security absent from rows
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement.** Append to `backend/app/api/portfolio.py`:

```python
@router.get("/holdings", response_model=HoldingsOut)
async def holdings(db: AsyncSession = Depends(get_db)) -> HoldingsOut:
    securities, txns, latest, history, dividends = await load_portfolio(db)
    positions = fold_transactions(txns)
    rows = build_holdings(positions, securities, latest, history, dividends, today=date.today())

    total_mv = sum((h.market_value for h in rows if h.market_value is not None), Decimal("0"))
    total_cost = sum((h.cost_basis for h in rows), Decimal("0"))
    total_day = [h.day_change_amount for h in rows if h.day_change_amount is not None]
    day_amount = sum(total_day, Decimal("0")) if total_day else None
    day_pct = None
    if day_amount is not None and total_mv - day_amount != 0:
        day_pct = quantize_pct(day_amount / (total_mv - day_amount))
    priced_cost = sum((h.cost_basis for h in rows if h.market_value is not None), Decimal("0"))
    unrealized_total = total_mv - priced_cost
    out_rows = [
        HoldingOut(
            security_id=h.security.id,
            ticker=h.security.ticker,
            name=h.security.name,
            industry=h.security.industry,
            holding_type=h.security.holding_type,
            is_manual_priced=h.security.is_manual_priced,
            shares=h.shares,
            avg_cost=h.avg_cost,
            cost_basis=h.cost_basis,
            price=h.price,
            quoted_at=h.quoted_at,
            price_source=h.price_source,
            day_change_pct=h.day_change_pct,
            day_change_amount=h.day_change_amount,
            market_value=h.market_value,
            weight_pct=(
                quantize_pct(h.market_value / total_mv)
                if h.market_value is not None and total_mv > 0
                else None
            ),
            unrealized_gl=h.unrealized_gl,
            unrealized_gl_pct=h.unrealized_gl_pct,
            realized_gl=h.realized_gl,
            dividends_collected=h.dividends_collected,
            annual_dividend=h.security.annual_dividend,
            annual_income=h.annual_income,
            yield_pct=h.yield_pct,
            yoc_pct=h.yoc_pct,
            xirr_pct=h.xirr_pct,
            accounts=h.accounts,
            warnings=h.warnings,
        )
        for h in rows
    ]
    all_realized = sum((p.realized_gl for p in positions.values()), Decimal("0"))
    all_dividends = sum((d.amount for d in dividends), Decimal("0"))
    totals = HoldingsTotals(
        market_value=total_mv.quantize(Decimal("0.01")),
        cost_basis=total_cost.quantize(Decimal("0.01")),
        unrealized_gl=unrealized_total.quantize(Decimal("0.01")),
        unrealized_gl_pct=quantize_pct(unrealized_total / priced_cost) if priced_cost > 0 else None,
        day_change_amount=day_amount,
        day_change_pct=day_pct,
        realized_gl=all_realized.quantize(Decimal("0.01")),
        dividends_collected=all_dividends.quantize(Decimal("0.01")),
        annual_income=sum(
            (h.annual_income for h in rows if h.annual_income is not None), Decimal("0")
        ).quantize(Decimal("0.01")),
        unpriced_count=sum(1 for h in rows if h.market_value is None),
    )
    as_of = min((h.quoted_at for h in rows if h.quoted_at is not None), default=None)
    return HoldingsOut(as_of=as_of, totals=totals, holdings=out_rows)


@router.get("/allocation", response_model=AllocationOut)
async def allocation_view(
    by: Literal["industry", "type", "account"] = "industry",
    db: AsyncSession = Depends(get_db),
) -> AllocationOut:
    securities, txns, latest, _history, _dividends = await load_portfolio(db)
    positions = fold_transactions(txns)
    buckets = allocation(positions, securities, latest, by)
    total = sum((value for _key, value, _count in buckets), Decimal("0"))
    return AllocationOut(
        by=by,
        total_market_value=total.quantize(Decimal("0.01")),
        slices=[
            AllocationSlice(
                key=key,
                market_value=value,
                weight_pct=quantize_pct(value / total) if total > 0 else Decimal("0"),
                holdings=count,
            )
            for key, value, count in buckets
        ],
    )


@router.get("/realized", response_model=RealizedOut)
async def realized(db: AsyncSession = Depends(get_db)) -> RealizedOut:
    securities, txns, _latest, _history, _dividends = await load_portfolio(db)
    positions = fold_transactions(txns)
    per_security: dict[int, Decimal] = {}
    for pos in positions.values():
        per_security[pos.security_id] = per_security.get(pos.security_id, Decimal("0")) + pos.realized_gl
    rows = [
        RealizedRow(
            security_id=sec_id,
            ticker=securities[sec_id].ticker,
            name=securities[sec_id].name,
            realized_gl=value.quantize(Decimal("0.01")),
        )
        for sec_id, value in sorted(per_security.items(), key=lambda kv: kv[1])
        if value != 0 and sec_id in securities
    ]
    total = sum((v for v in per_security.values()), Decimal("0"))
    return RealizedOut(total=total.quantize(Decimal("0.01")), rows=rows)
```

Extend imports: `from app.schemas.portfolio import (..., AllocationOut, AllocationSlice,
HoldingOut, HoldingsOut, HoldingsTotals, RealizedOut, RealizedRow)`, `from
app.services.money import ... quantize_pct` (note quantize_pct lives in money.py), `from
app.services.portfolio_calc import allocation, build_holdings, fold_transactions,
load_portfolio`. Rename collision: the service function `allocation` vs endpoint — the
endpoint is `allocation_view` as shown.

- [ ] **Step 4: Run the tests** — expected: PASS.
- [ ] **Step 5: Full gate + commit**

```bash
git add backend/app/api/portfolio.py backend/tests/test_portfolio_api.py
git commit -m "feat: holdings/allocation/realized computed endpoints"
```

---

## Task 11: Prices router

**Files:**
- Create: `backend/app/api/prices.py`
- Modify: `backend/app/main.py` (register)
- Test: `backend/tests/test_prices_api.py`

- [ ] **Step 1: Write the failing tests.** Create `backend/tests/test_prices_api.py`.
The refresh endpoint's provider is swapped by overriding the module hook (see Step 3's
`get_provider`) with `monkeypatch.setattr("app.api.prices.get_provider", lambda: fake)`.
Reuse `FakeProvider` semantics from test_price_service (duplicate the tiny class locally
— tests must stay standalone-readable). Cover:

```python
async def test_refresh_endpoint_runs_and_reports(client, db, monkeypatch): ...
    # seed 1 auto security; fake provider returns 2 bars -> POST /prices/refresh ->
    # 200 {"updated": ["X"], "failed": {}, "skipped_manual": [], "duration_ms": int >= 0}
    # and latest_prices/price_history rows exist

async def test_refresh_requires_auth(client): ...  # 401 without token

async def test_history_endpoint_window_and_404(client, db): ...
    # seed security + 3 history rows (one older than the window);
    # GET /prices/history/NVDA?days=30 -> 200 points date-asc within window, c as string
    # GET /prices/history/nvda -> same (case-insensitive); unknown ticker -> 404
    # days=0 -> 422; days=4000 -> 422 (Query ge/le)

async def test_sparklines_held_only_weekly_downsampled(client, db): ...
    # security A: txn (held) + 30 daily bars; security B: no txns + bars ->
    # GET /prices/sparklines -> A in body keyed by ticker, B absent;
    # A's points: <= 1 per ISO week PLUS the final bar always present (assert the last
    # point's d == the latest bar date)

async def test_manual_price_put_guard_and_write(client, db): ...
    # PUT /prices/NVDA (is_manual_priced=False) -> 409;
    # flip to manual -> PUT {"price": "31.89"} -> 200 LatestPriceOut source "manual";
    # a price_history row exists for today; PUT with as_of tomorrow -> 422;
    # price "0" -> 422; unknown ticker -> 404
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement `backend/app/api/prices.py`**

```python
import time as time_module
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.config import settings
from app.database import get_db
from app.models import PriceHistory, Security
from app.schemas.portfolio import (
    LatestPriceOut,
    ManualPriceIn,
    PriceHistoryOut,
    PricePoint,
    RefreshOut,
)
from app.services.money import quantize_price
from app.services.portfolio_calc import fold_transactions
from app.services.price_service import refresh_prices, set_manual_price

router = APIRouter(prefix="/prices", tags=["prices"], dependencies=[Depends(get_current_user)])


def get_provider():
    """Module hook so tests monkeypatch the provider without touching yfinance."""
    from app.services.price_provider import YFinanceProvider

    return YFinanceProvider(settings.yfinance_ca_bundle)


@router.post("/refresh", response_model=RefreshOut)
async def refresh(db: AsyncSession = Depends(get_db)) -> RefreshOut:
    started = time_module.monotonic()
    result = await refresh_prices(db, get_provider())
    return RefreshOut(
        updated=result.updated,
        failed=result.failed,
        skipped_manual=result.skipped_manual,
        duration_ms=int((time_module.monotonic() - started) * 1000),
    )


async def _security_by_ticker(db: AsyncSession, ticker: str) -> Security:
    normalized = ticker.strip().upper()
    security = (
        (await db.execute(select(Security).where(Security.ticker == normalized))).scalars().first()
    )
    if security is None:
        raise HTTPException(status_code=404, detail=f"unknown ticker {normalized!r}")
    return security


@router.get("/history/{ticker}", response_model=PriceHistoryOut)
async def history(
    ticker: str,
    days: int = Query(default=365, ge=1, le=3650),
    db: AsyncSession = Depends(get_db),
) -> PriceHistoryOut:
    security = await _security_by_ticker(db, ticker)
    since = date.today() - __import__("datetime").timedelta(days=days)
    rows = (
        await db.execute(
            select(PriceHistory)
            .where(PriceHistory.security_id == security.id, PriceHistory.price_date >= since)
            .order_by(PriceHistory.price_date)
        )
    ).scalars()
    return PriceHistoryOut(
        ticker=security.ticker, points=[PricePoint(d=r.price_date, c=r.close) for r in rows]
    )


@router.get("/sparklines", response_model=dict[str, list[PricePoint]])
async def sparklines(
    days: int = Query(default=365, ge=1, le=3650),
    db: AsyncSession = Depends(get_db),
) -> dict[str, list[PricePoint]]:
    """History for HELD securities only, downsampled to the last bar of each ISO week
    (plus the latest bar) — one request feeds every holdings-table sparkline."""
    from app.models import PositionTransaction

    txns = list(
        (
            await db.execute(
                select(PositionTransaction).order_by(
                    PositionTransaction.sort_index, PositionTransaction.id
                )
            )
        ).scalars()
    )
    held_ids = {
        pos.security_id
        for pos in fold_transactions(txns).values()
        if pos.shares.quantize(Decimal("0.000001")) != 0
    }
    if not held_ids:
        return {}
    securities = {
        s.id: s
        for s in (await db.execute(select(Security).where(Security.id.in_(held_ids)))).scalars()
    }
    since = date.today() - __import__("datetime").timedelta(days=days)
    rows = (
        await db.execute(
            select(PriceHistory)
            .where(PriceHistory.security_id.in_(held_ids), PriceHistory.price_date >= since)
            .order_by(PriceHistory.security_id, PriceHistory.price_date)
        )
    ).scalars()
    out: dict[str, list[PricePoint]] = {}
    # Last bar per ISO week — the latest bar is always kept because it is by
    # definition the last bar of its own (possibly partial) week.
    week_last: dict[tuple[int, int, int], PriceHistory] = {}
    for row in rows:
        iso = row.price_date.isocalendar()
        week_last[(row.security_id, iso.year, iso.week)] = row
    for row in sorted(week_last.values(), key=lambda r: (r.security_id, r.price_date)):
        ticker = securities[row.security_id].ticker
        out.setdefault(ticker, []).append(PricePoint(d=row.price_date, c=row.close))
    return out


@router.put("/{ticker}", response_model=LatestPriceOut)
async def put_manual_price(
    ticker: str, body: ManualPriceIn, db: AsyncSession = Depends(get_db)
) -> LatestPriceOut:
    security = await _security_by_ticker(db, ticker)
    if not security.is_manual_priced:
        raise HTTPException(
            status_code=409,
            detail="security is not manual-priced — prices come from the refresh",
        )
    price = quantize_price(body.price, "price")
    if price <= 0:
        raise HTTPException(status_code=422, detail="price must be positive")
    as_of = body.as_of or date.today()
    if as_of > date.today():
        raise HTTPException(status_code=422, detail="as_of cannot be in the future")
    await set_manual_price(db, security, price, as_of)
    await db.commit()
    from app.models import LatestPrice

    latest = await db.get(LatestPrice, security.id)
    return LatestPriceOut.model_validate(latest)
```

STYLE NOTE for the implementer: replace both `__import__("datetime").timedelta` hacks
with a proper `from datetime import date, timedelta` import — they appear above only to
keep the snippet import-block unambiguous. Move `from app.models import
PositionTransaction, LatestPrice` up into the module import block too; the sparklines
docstring and `week_last` logic stay as written.

Register in `main.py`: add `prices` to the api import tuple +
`app.include_router(prices.router, prefix="/api/v1")`.

- [ ] **Step 4: Run the tests** — expected: PASS.
- [ ] **Step 5: Full gate + commit**

```bash
git add backend/app/api/prices.py backend/app/main.py backend/tests/test_prices_api.py
git commit -m "feat: prices router (refresh, history, sparklines, manual override)"
```

---
## Task 12: Frontend types, API modules, format utilities

**Files:**
- Modify: `src/types/api.ts`, `src/utils/format.ts`, `src/utils/format.test.ts`
- Create: `src/api/portfolio.ts`, `src/api/prices.ts`

- [ ] **Step 1: Write the failing format tests** (append to `src/utils/format.test.ts`,
matching its existing style):

```ts
describe('formatPct decimals option', () => {
  it('renders 2dp unsigned', () => {
    expect(formatPct('0.013', { signed: false, decimals: 2 })).toBe('1.30%')
  })
  it('keeps the 1dp signed default', () => {
    expect(formatPct('0.25')).toBe('+25.0%')
  })
})

describe('formatShares', () => {
  it('trims trailing zeros up to 6dp', () => {
    expect(formatShares('169.704000')).toBe('169.704')
    expect(formatShares('1108.000000')).toBe('1,108')
    expect(formatShares(null)).toBe('—')
  })
})

describe('formatDate', () => {
  it('formats ISO dates without UTC shift', () => {
    expect(formatDate('2026-08-14')).toBe('Aug 14, 2026')
    expect(formatDate(null)).toBe('—')
  })
})
```

- [ ] **Step 2: Run `npm test` to verify failure.**

- [ ] **Step 3: Extend `src/utils/format.ts`**

Change `formatPct`'s signature (backward-compatible) and add the two helpers:

```ts
export function formatPct(
  value: string | number | null | undefined,
  { signed = true, decimals = 1 }: { signed?: boolean; decimals?: number } = {},
): string {
  if (value === null || value === undefined || value === '') return '—'
  const pct = Number(value) * 100
  const body = `${Math.abs(pct).toFixed(decimals)}%`
  if (!signed) return pct < 0 ? `-${body}` : body
  return pct < 0 ? `-${body}` : `+${body}`
}

export function formatShares(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  return Number(value).toLocaleString('en-US', { maximumFractionDigits: 6 })
}

export function formatDate(iso: string | null | undefined): string {
  // Same rule as formatMonth: never `new Date(iso)` (UTC parsing shifts a day back).
  if (!iso) return '—'
  const [year, month, day] = iso.split('-')
  return `${MONTH_NAMES[Number(month) - 1]} ${Number(day)}, ${year}`
}
```

- [ ] **Step 4: Add types to `src/types/api.ts`** (append; money/percent values are
decimal STRINGS per the file's header comment):

```ts
export type HoldingType = 'etf' | 'mutual_fund' | 'stock' | 'private'
export type TransactionType = 'buy' | 'sell' | 'split'
export type TransactionSource = 'import' | 'ui'
export type AllocationDimension = 'industry' | 'type' | 'account'

export interface SecurityOut {
  id: number
  ticker: string
  name: string
  industry: string | null
  holding_type: HoldingType
  is_manual_priced: boolean
  is_active: boolean
  annual_dividend: string | null
  ex_div_date: string | null
}

export interface SecurityCreate {
  ticker: string
  name: string
  industry?: string | null
  holding_type: HoldingType
  is_manual_priced?: boolean
  annual_dividend?: string | null
  ex_div_date?: string | null
}

export type SecurityUpdate = Partial<Omit<SecurityCreate, 'ticker'>> & {
  is_active?: boolean
}

export interface TransactionOut {
  id: number
  security_id: number
  account: string
  type: TransactionType
  txn_date: string | null
  shares: string
  price: string
  fees: string | null
  split_factor: string | null
  sort_index: number
  source: TransactionSource
  notes: string | null
}

export interface TransactionCreate {
  security_id: number
  account: string
  type: TransactionType
  txn_date?: string | null
  shares?: string | null
  price?: string | null
  fees?: string | null
  split_factor?: string | null
  notes?: string | null
}

export type TransactionUpdate = Partial<Omit<TransactionCreate, 'security_id'>>

export interface DividendOut {
  id: number
  security_id: number
  account: string | null
  pay_date: string
  amount: string
  notes: string | null
}

export interface DividendCreate {
  security_id: number
  account?: string | null
  pay_date: string
  amount: string
  notes?: string | null
}

export interface HoldingOut {
  security_id: number
  ticker: string
  name: string
  industry: string | null
  holding_type: HoldingType
  is_manual_priced: boolean
  shares: string
  avg_cost: string | null
  cost_basis: string
  price: string | null
  quoted_at: string | null
  price_source: 'yfinance' | 'manual' | null
  day_change_pct: string | null
  day_change_amount: string | null
  market_value: string | null
  weight_pct: string | null
  unrealized_gl: string | null
  unrealized_gl_pct: string | null
  realized_gl: string
  dividends_collected: string
  annual_dividend: string | null
  annual_income: string | null
  yield_pct: string | null
  yoc_pct: string | null
  xirr_pct: string | null
  accounts: string[]
  warnings: string[]
}

export interface HoldingsTotals {
  market_value: string
  cost_basis: string
  unrealized_gl: string
  unrealized_gl_pct: string | null
  day_change_amount: string | null
  day_change_pct: string | null
  realized_gl: string
  dividends_collected: string
  annual_income: string
  unpriced_count: number
}

export interface HoldingsResponse {
  as_of: string | null
  totals: HoldingsTotals
  holdings: HoldingOut[]
}

export interface AllocationSlice {
  key: string
  market_value: string
  weight_pct: string
  holdings: number
}

export interface AllocationResponse {
  by: AllocationDimension
  total_market_value: string
  slices: AllocationSlice[]
}

export interface RealizedRow {
  security_id: number
  ticker: string
  name: string
  realized_gl: string
}

export interface RealizedResponse {
  total: string
  rows: RealizedRow[]
}

export interface RefreshResult {
  updated: string[]
  failed: Record<string, string>
  skipped_manual: string[]
  duration_ms: number
}

export interface PricePoint {
  d: string
  c: string
}

export type SparklinesResponse = Record<string, PricePoint[]>

export interface LatestPriceOut {
  security_id: number
  price: string
  quoted_at: string
  source: 'yfinance' | 'manual'
}
```

- [ ] **Step 5: Create `src/api/portfolio.ts`**

```ts
import { api } from './client'
import type {
  AllocationDimension,
  AllocationResponse,
  DividendCreate,
  DividendOut,
  HoldingsResponse,
  RealizedResponse,
  SecurityCreate,
  SecurityOut,
  SecurityUpdate,
  TransactionCreate,
  TransactionOut,
  TransactionUpdate,
} from '../types/api'

export function fetchSecurities(): Promise<SecurityOut[]> {
  return api<SecurityOut[]>('/portfolio/securities')
}

export function createSecurity(body: SecurityCreate): Promise<SecurityOut> {
  return api<SecurityOut>('/portfolio/securities', { method: 'POST', body: JSON.stringify(body) })
}

export function updateSecurity(id: number, body: SecurityUpdate): Promise<SecurityOut> {
  return api<SecurityOut>(`/portfolio/securities/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function deleteSecurity(id: number): Promise<void> {
  return api<void>(`/portfolio/securities/${id}`, { method: 'DELETE' })
}

export function fetchTransactions(): Promise<TransactionOut[]> {
  return api<TransactionOut[]>('/portfolio/transactions')
}

export function createTransaction(body: TransactionCreate): Promise<TransactionOut> {
  return api<TransactionOut>('/portfolio/transactions', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function updateTransaction(id: number, body: TransactionUpdate): Promise<TransactionOut> {
  return api<TransactionOut>(`/portfolio/transactions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function deleteTransaction(id: number): Promise<void> {
  return api<void>(`/portfolio/transactions/${id}`, { method: 'DELETE' })
}

export function fetchDividends(): Promise<DividendOut[]> {
  return api<DividendOut[]>('/portfolio/dividends')
}

export function createDividend(body: DividendCreate): Promise<DividendOut> {
  return api<DividendOut>('/portfolio/dividends', { method: 'POST', body: JSON.stringify(body) })
}

export function deleteDividend(id: number): Promise<void> {
  return api<void>(`/portfolio/dividends/${id}`, { method: 'DELETE' })
}

export function fetchHoldings(): Promise<HoldingsResponse> {
  return api<HoldingsResponse>('/portfolio/holdings')
}

export function fetchAllocation(by: AllocationDimension): Promise<AllocationResponse> {
  return api<AllocationResponse>(`/portfolio/allocation?by=${by}`)
}

export function fetchRealized(): Promise<RealizedResponse> {
  return api<RealizedResponse>('/portfolio/realized')
}
```

- [ ] **Step 6: Create `src/api/prices.ts`**

```ts
import { api } from './client'
import type { LatestPriceOut, RefreshResult, SparklinesResponse } from '../types/api'

// A live refresh walks ~37 tickers sequentially (tens of seconds) — the caller-supplied
// signal REPLACES the client's 15s default (Plan 3 forward note).
const REFRESH_TIMEOUT_MS = 120_000

export function refreshPrices(): Promise<RefreshResult> {
  return api<RefreshResult>('/prices/refresh', {
    method: 'POST',
    signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
  })
}

export function fetchSparklines(days = 365): Promise<SparklinesResponse> {
  return api<SparklinesResponse>(`/prices/sparklines?days=${days}`)
}

export function putManualPrice(
  ticker: string,
  body: { price: string; as_of?: string },
): Promise<LatestPriceOut> {
  return api<LatestPriceOut>(`/prices/${encodeURIComponent(ticker)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}
```

(`AbortSignal.timeout` throws `TimeoutError`, which client.ts maps to ApiError(0) — same
UX as the default timeout.)

- [ ] **Step 7: `npm test && npm run lint && npm run build`** — expected: green
(1 sanctioned lint warning).

- [ ] **Step 8: Commit**

```bash
git add src/types/api.ts src/utils/format.ts src/utils/format.test.ts src/api/portfolio.ts src/api/prices.ts
git commit -m "feat: portfolio/prices frontend types, api modules, format helpers"
```

---

## Task 13: Sparkline + HoldingsTable (jsdom-testable — NO echarts imports here)

**Files:**
- Create: `src/components/portfolio/Sparkline.tsx`, `src/components/portfolio/Sparkline.test.tsx`
- Create: `src/components/portfolio/HoldingsTable.tsx`, `src/components/portfolio/HoldingsTable.test.tsx`

- [ ] **Step 1: Write the failing Sparkline tests**

```tsx
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { NEGATIVE, POSITIVE } from '../../charts/theme'
import Sparkline from './Sparkline'

afterEach(cleanup)

const pt = (d: string, c: string) => ({ d, c })

describe('Sparkline', () => {
  it('renders an em-dash placeholder with fewer than 2 points', () => {
    const { container } = render(<Sparkline points={[pt('2026-01-01', '10')]} />)
    expect(container.textContent).toBe('—')
    expect(container.querySelector('svg')).toBeNull()
  })

  it('draws a rising line in the positive color', () => {
    const { container } = render(
      <Sparkline points={[pt('2026-01-01', '10'), pt('2026-06-01', '15')]} />,
    )
    const line = container.querySelector('polyline')
    expect(line).not.toBeNull()
    expect(line!.getAttribute('stroke')).toBe(POSITIVE)
  })

  it('draws a falling line in the negative color and survives a flat series', () => {
    const { container } = render(
      <Sparkline points={[pt('2026-01-01', '15'), pt('2026-06-01', '10')]} />,
    )
    expect(container.querySelector('polyline')!.getAttribute('stroke')).toBe(NEGATIVE)
    const flat = render(
      <Sparkline points={[pt('2026-01-01', '10'), pt('2026-06-01', '10')]} />,
    )
    expect(flat.container.querySelector('polyline')).not.toBeNull() // no NaN coords
  })
})
```

- [ ] **Step 2: Run to verify failure**, then implement `Sparkline.tsx`:

```tsx
import { NEGATIVE, POSITIVE } from '../../charts/theme'
import type { PricePoint } from '../../types/api'

// Pure-SVG sparkline: 25 chart instances per table render is why this is NOT echarts
// (cost + the jsdom canvas limit). Trend-only — no axes, no tooltip (dataviz: sparklines
// are sanctioned axis-free).
export default function Sparkline({
  points,
  width = 110,
  height = 30,
}: {
  points: PricePoint[]
  width?: number
  height?: number
}) {
  if (points.length < 2) return <span className="sparkline-empty">—</span>
  const values = points.map((p) => Number(p.c))
  const min = Math.min(...values)
  const span = Math.max(...values) - min || 1
  const step = width / (values.length - 1)
  const coords = values
    .map((v, i) => `${(i * step).toFixed(1)},${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)}`)
    .join(' ')
  const rising = values[values.length - 1] >= values[0]
  return (
    <svg
      className="sparkline"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      focusable="false"
    >
      <polyline points={coords} fill="none" stroke={rising ? POSITIVE : NEGATIVE} strokeWidth="1.5" />
    </svg>
  )
}
```

Run the tests — expected: PASS.

- [ ] **Step 3: Write the failing HoldingsTable tests**

```tsx
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import type { HoldingOut } from '../../types/api'
import HoldingsTable from './HoldingsTable'

afterEach(cleanup)

function holding(overrides: Partial<HoldingOut>): HoldingOut {
  return {
    security_id: 1, ticker: 'AAA', name: 'AAA Inc', industry: 'Tech',
    holding_type: 'stock', is_manual_priced: false, shares: '10', avg_cost: '100.0000',
    cost_basis: '1000.00', price: '110.0000', quoted_at: '2026-08-14T00:00:00Z',
    price_source: 'yfinance', day_change_pct: '0.010000', day_change_amount: '11.00',
    market_value: '1100.00', weight_pct: '0.500000', unrealized_gl: '100.00',
    unrealized_gl_pct: '0.100000', realized_gl: '0.00', dividends_collected: '0.00',
    annual_dividend: null, annual_income: null, yield_pct: null, yoc_pct: null,
    xirr_pct: null, accounts: ['Acct'], warnings: [],
    ...overrides,
  }
}

const rows = [
  holding({ security_id: 1, ticker: 'AAA', market_value: '1100.00', weight_pct: '0.4' }),
  holding({ security_id: 2, ticker: 'BBB', market_value: '2200.00', weight_pct: '0.6' }),
]

function tickerColumn(): string[] {
  return screen.getAllByRole('row').slice(1).map((r) => r.querySelector('td')!.textContent!)
}

describe('HoldingsTable', () => {
  it('defaults to market-value descending', () => {
    render(<HoldingsTable holdings={rows} sparklines={{}} />)
    expect(tickerColumn()[0]).toContain('BBB')
  })

  it('clicking a header toggles sort direction', async () => {
    const user = userEvent.setup()
    render(<HoldingsTable holdings={rows} sparklines={{}} />)
    await user.click(screen.getByRole('button', { name: /market value/i }))
    expect(tickerColumn()[0]).toContain('AAA') // now ascending
  })

  it('renders em-dashes for null money fields and a warning marker', () => {
    render(
      <HoldingsTable
        holdings={[holding({ price: null, market_value: null, weight_pct: null, day_change_pct: null, warnings: ['sell with no held shares'] })]}
        sparklines={{}}
      />,
    )
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
    expect(screen.getByTitle(/sell with no held shares/)).toBeInTheDocument()
  })
})
```

(If `@testing-library/user-event` is not already a devDependency, use
`fireEvent.click` from @testing-library/react instead — check package.json FIRST and
keep the lockfile churn zero.)

- [ ] **Step 4: Run to verify failure**, then implement `HoldingsTable.tsx`:

```tsx
import { useMemo, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { HoldingOut, PricePoint } from '../../types/api'
import { formatCurrency, formatDate, formatPct, formatShares } from '../../utils/format'
import Sparkline from './Sparkline'

type SortKey =
  | 'ticker' | 'shares' | 'price' | 'day_change_pct' | 'market_value' | 'weight_pct'
  | 'unrealized_gl' | 'yield_pct' | 'yoc_pct' | 'xirr_pct' | 'dividends_collected'

const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: 'ticker', label: 'Ticker', numeric: false },
  { key: 'shares', label: 'Shares', numeric: true },
  { key: 'price', label: 'Price', numeric: true },
  { key: 'day_change_pct', label: 'Day', numeric: true },
  { key: 'market_value', label: 'Market value', numeric: true },
  { key: 'weight_pct', label: 'Weight', numeric: true },
  { key: 'unrealized_gl', label: 'Unrealized', numeric: true },
  { key: 'yield_pct', label: 'Yield', numeric: true },
  { key: 'yoc_pct', label: 'YOC', numeric: true },
  { key: 'xirr_pct', label: 'XIRR', numeric: true },
  { key: 'dividends_collected', label: 'Dividends', numeric: true },
]

const STALE_AFTER_DAYS = 4

function sortValue(h: HoldingOut, key: SortKey): number | string {
  if (key === 'ticker') return h.ticker
  const raw = h[key]
  // nulls sort as -Infinity: bottom in the default descending order (ascending puts
  // them first — accepted; a null is "least" either way)
  return raw === null ? Number.NEGATIVE_INFINITY : Number(raw)
}

function isStale(quotedAt: string | null): boolean {
  if (!quotedAt) return false
  return Date.now() - new Date(quotedAt).getTime() > STALE_AFTER_DAYS * 86_400_000
}

function tone(value: string | null): string {
  if (value === null) return ''
  const n = Number(value)
  return n > 0 ? 'pos' : n < 0 ? 'neg' : ''
}

export default function HoldingsTable({
  holdings,
  sparklines,
}: {
  holdings: HoldingOut[]
  sparklines: Record<string, PricePoint[]>
}) {
  const [sortKey, setSortKey] = useState<SortKey>('market_value')
  const [descending, setDescending] = useState(true)

  const sorted = useMemo(() => {
    const rows = [...holdings]
    rows.sort((a, b) => {
      const va = sortValue(a, sortKey)
      const vb = sortValue(b, sortKey)
      const cmp = typeof va === 'string' ? va.localeCompare(vb as string) : va - (vb as number)
      return descending ? -cmp : cmp
    })
    return rows
  }, [holdings, sortKey, descending])

  const onSort = (key: SortKey) => {
    if (key === sortKey) {
      setDescending((d) => !d)
    } else {
      setSortKey(key)
      setDescending(true)
    }
  }

  if (holdings.length === 0) {
    return <p className="empty-note">No holdings yet — add transactions below.</p>
  }
  return (
    <div className="holdings-scroll">
      <table className="port-table">
        <thead>
          <tr>
            {COLUMNS.map(({ key, label, numeric }) => (
              <th
                key={key}
                className={numeric ? 'num' : undefined}
                aria-sort={
                  key === sortKey ? (descending ? 'descending' : 'ascending') : undefined
                }
              >
                <button type="button" className="th-sort" onClick={() => onSort(key)}>
                  {label}
                  {key === sortKey && <span aria-hidden="true">{descending ? ' ↓' : ' ↑'}</span>}
                </button>
              </th>
            ))}
            <th className="chart-col">1Y</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((h) => (
            <tr key={h.security_id}>
              <td>
                <div className="ticker-cell">
                  <span className="ticker">
                    {h.ticker}
                    {h.is_manual_priced && <span className="badge">manual</span>}
                    {h.warnings.length > 0 && (
                      <span title={h.warnings.join('; ')} className="warn-icon">
                        <AlertTriangle size={13} aria-label="data warning" />
                      </span>
                    )}
                  </span>
                  <span className="sub">{h.name}</span>
                </div>
              </td>
              <td className="num">{formatShares(h.shares)}</td>
              <td className="num">
                {formatCurrency(h.price)}
                {h.quoted_at && isStale(h.quoted_at) && (
                  <span className="sub stale"> as of {formatDate(h.quoted_at.slice(0, 10))}</span>
                )}
              </td>
              <td className={`num ${tone(h.day_change_pct)}`}>{formatPct(h.day_change_pct)}</td>
              <td className="num">{formatCurrency(h.market_value)}</td>
              <td className="num">{formatPct(h.weight_pct, { signed: false })}</td>
              <td className={`num ${tone(h.unrealized_gl)}`}>
                {formatCurrency(h.unrealized_gl)}
                {h.unrealized_gl_pct !== null && (
                  <span className="sub"> {formatPct(h.unrealized_gl_pct)}</span>
                )}
              </td>
              <td className="num">{formatPct(h.yield_pct, { signed: false, decimals: 2 })}</td>
              <td className="num">{formatPct(h.yoc_pct, { signed: false, decimals: 2 })}</td>
              <td className="num">{formatPct(h.xirr_pct)}</td>
              <td className="num">{formatCurrency(h.dividends_collected)}</td>
              <td className="chart-col">
                <Sparkline points={sparklines[h.ticker] ?? []} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

Run the tests — expected: PASS.

- [ ] **Step 5: Gates + commit**

```bash
git add src/components/portfolio/Sparkline.tsx src/components/portfolio/Sparkline.test.tsx src/components/portfolio/HoldingsTable.tsx src/components/portfolio/HoldingsTable.test.tsx
git commit -m "feat: holdings table with SVG sparklines (sortable, jsdom-tested)"
```

---

## Task 14: Allocation charts + Transactions/Dividends/Securities panels

**Files:**
- Modify: `src/charts/echarts.ts`
- Create: `src/components/portfolio/AllocationPanel.tsx`
- Create: `src/components/portfolio/TransactionsPanel.tsx` + `TransactionsPanel.test.tsx`
- Create: `src/components/portfolio/DividendsPanel.tsx`
- Create: `src/components/portfolio/SecuritiesPanel.tsx`

- [ ] **Step 1: Register the new chart types** in `src/charts/echarts.ts`: add
`PieChart, TreemapChart` to the `echarts/charts` import and the `use([...])` list, and
`PieSeriesOption, TreemapSeriesOption` to the type import + `EChartsOption` union.
This is the ONLY file that may touch echarts registration (Plan 3 note).

- [ ] **Step 2: Implement `AllocationPanel.tsx`**

```tsx
import { useState } from 'react'
import EChart from '../EChart'
import type { EChartsOption } from '../../charts/echarts'
import { OTHER_SERIES_COLOR, PALETTE, SEQUENTIAL_BLUE } from '../../charts/theme'
import type { AllocationResponse } from '../../types/api'
import { escapeHtml, formatCurrencyCompact, formatPct } from '../../utils/format'

const TYPE_LABELS: Record<string, string> = {
  etf: 'ETF', mutual_fund: 'Mutual fund', stock: 'Stock', private: 'Private',
}

// Treemap encodes MAGNITUDE on the shared sequential ramp — an all-pairs form must not
// hand out identity hues at this cardinality (frozen dataviz rule, Plan 3 note).
function treemapOption(data: AllocationResponse): EChartsOption {
  const max = Math.max(...data.slices.map((s) => Number(s.market_value)), 1)
  return {
    tooltip: {
      formatter: (params) => {
        const p = params as { name: string; value: number }
        return `${escapeHtml(p.name)}: ${formatCurrencyCompact(p.value)}`
      },
    },
    series: [
      {
        type: 'treemap',
        roam: false,
        nodeClick: false,
        breadcrumb: { show: false },
        label: { show: true, formatter: '{b}', fontSize: 11 },
        itemStyle: { borderColor: '#171a21', borderWidth: 2, gapWidth: 2 },
        data: data.slices.map((s) => ({
          name: s.key,
          value: Number(s.market_value),
          itemStyle: {
            color:
              SEQUENTIAL_BLUE[3 + Math.round((Number(s.market_value) / max) * 8)],
          },
        })),
      },
    ],
  }
}

// Donut: top-3 slices wear palette slots 1-3, the rest fold into a gray Other
// (all-pairs ≤3 hued selections — frozen rule).
function donutOption(data: AllocationResponse, labels: boolean): EChartsOption {
  const named = data.slices.map((s) => ({
    name: labels ? (TYPE_LABELS[s.key] ?? s.key) : s.key,
    value: Number(s.market_value),
  }))
  const top = named.slice(0, 3)
  const rest = named.slice(3)
  const seriesData = [
    ...top.map((s, i) => ({ ...s, itemStyle: { color: PALETTE[i] } })),
    ...(rest.length > 0
      ? [
          {
            name: 'Other',
            value: rest.reduce((sum, s) => sum + s.value, 0),
            itemStyle: { color: OTHER_SERIES_COLOR },
          },
        ]
      : []),
  ]
  const total = named.reduce((sum, s) => sum + s.value, 0)
  return {
    tooltip: {
      formatter: (params) => {
        const p = params as { name: string; value: number }
        return `${escapeHtml(p.name)}: ${formatCurrencyCompact(p.value)} (${formatPct(
          total > 0 ? p.value / total : 0,
          { signed: false },
        )})`
      },
    },
    legend: { bottom: 0 },
    series: [
      {
        type: 'pie',
        radius: ['55%', '78%'],
        center: ['50%', '44%'],
        avoidLabelOverlap: true,
        label: { show: false },
        data: seriesData,
      },
    ],
  }
}

export default function AllocationPanel({
  industry,
  byType,
  byAccount,
}: {
  industry: AllocationResponse | null
  byType: AllocationResponse | null
  byAccount: AllocationResponse | null
}) {
  const [donutDim, setDonutDim] = useState<'type' | 'account'>('type')
  const donutData = donutDim === 'type' ? byType : byAccount
  return (
    <div className="allocation-grid">
      <section className="panel">
        <h2 className="panel-title">Allocation by industry</h2>
        {industry && industry.slices.length > 0 ? (
          <EChart option={treemapOption(industry)} height={300} />
        ) : (
          <p className="empty-note">No priced holdings yet.</p>
        )}
      </section>
      <section className="panel">
        <div className="panel-title-row">
          <h2 className="panel-title">Allocation</h2>
          <div className="toggle-row" role="group" aria-label="Donut dimension">
            <button
              type="button"
              aria-pressed={donutDim === 'type'}
              onClick={() => setDonutDim('type')}
            >
              Type
            </button>
            <button
              type="button"
              aria-pressed={donutDim === 'account'}
              onClick={() => setDonutDim('account')}
            >
              Account
            </button>
          </div>
        </div>
        {donutData && donutData.slices.length > 0 ? (
          <EChart option={donutOption(donutData, donutDim === 'type')} height={300} />
        ) : (
          <p className="empty-note">No priced holdings yet.</p>
        )}
      </section>
    </div>
  )
}
```

Check `src/components/EChart.tsx`'s actual prop names FIRST (e.g. `height` — if the
wrapper takes a style/className instead, adapt the two call sites, not the wrapper).

- [ ] **Step 3: Write the failing TransactionsPanel tests** (mock the api module — the
component must import from `'../../api/portfolio'` exactly):

```tsx
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SecurityOut, TransactionOut } from '../../types/api'
import TransactionsPanel from './TransactionsPanel'

vi.mock('../../api/portfolio', () => ({
  createTransaction: vi.fn().mockResolvedValue({}),
  updateTransaction: vi.fn().mockResolvedValue({}),
  deleteTransaction: vi.fn().mockResolvedValue(undefined),
}))
import { createTransaction } from '../../api/portfolio'

afterEach(cleanup)

const securities: SecurityOut[] = [{
  id: 1, ticker: 'NVDA', name: 'NVIDIA', industry: 'Semis', holding_type: 'stock',
  is_manual_priced: false, is_active: true, annual_dividend: null, ex_div_date: null,
}]

const importTxn: TransactionOut = {
  id: 7, security_id: 1, account: 'Schwab', type: 'buy', txn_date: null,
  shares: '10.000000', price: '100.0000', fees: null, split_factor: null,
  sort_index: 20, source: 'import', notes: null,
}

describe('TransactionsPanel', () => {
  it('marks import-owned rows and shows the re-import caveat', () => {
    render(
      <TransactionsPanel securities={securities} transactions={[importTxn]} onChanged={() => {}} />,
    )
    expect(screen.getByText('sheet')).toBeInTheDocument()
    expect(screen.getByText(/re-import/i)).toBeInTheDocument()
  })

  it('split type swaps shares/price inputs for a factor input', async () => {
    const user = userEvent.setup()
    render(<TransactionsPanel securities={securities} transactions={[]} onChanged={() => {}} />)
    expect(screen.getByLabelText(/shares/i)).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText(/type/i), 'split')
    expect(screen.queryByLabelText(/shares/i)).toBeNull()
    expect(screen.getByLabelText(/factor/i)).toBeInTheDocument()
  })

  it('submits a buy with the typed values and calls onChanged', async () => {
    const user = userEvent.setup()
    const onChanged = vi.fn()
    render(<TransactionsPanel securities={securities} transactions={[]} onChanged={onChanged} />)
    await user.type(screen.getByLabelText(/account/i), 'Robinhood')
    await user.type(screen.getByLabelText(/shares/i), '2')
    await user.type(screen.getByLabelText(/price/i), '150')
    await user.click(screen.getByRole('button', { name: /add transaction/i }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(vi.mocked(createTransaction).mock.calls[0][0]).toMatchObject({
      security_id: 1, account: 'Robinhood', type: 'buy', shares: '2', price: '150',
    })
  })
})
```

- [ ] **Step 4: Run to verify failure, then implement `TransactionsPanel.tsx`**

```tsx
import { useState } from 'react'
import { ApiError } from '../../api/client'
import {
  createTransaction,
  deleteTransaction,
  updateTransaction,
} from '../../api/portfolio'
import type { SecurityOut, TransactionOut, TransactionType } from '../../types/api'
import { formatCurrency, formatDate, formatShares } from '../../utils/format'

interface FormState {
  security_id: string
  account: string
  type: TransactionType
  txn_date: string
  shares: string
  price: string
  fees: string
  split_factor: string
  notes: string
}

const EMPTY: FormState = {
  security_id: '', account: '', type: 'buy', txn_date: '',
  shares: '', price: '', fees: '', split_factor: '', notes: '',
}

function toPayload(form: FormState) {
  const base = {
    account: form.account.trim(),
    type: form.type,
    txn_date: form.txn_date || null,
    notes: form.notes.trim() || null,
  }
  if (form.type === 'split') {
    return { ...base, split_factor: form.split_factor }
  }
  return {
    ...base,
    shares: form.shares,
    price: form.price,
    fees: form.fees.trim() ? form.fees : null,
  }
}

export default function TransactionsPanel({
  securities,
  transactions,
  onChanged,
}: {
  securities: SecurityOut[]
  transactions: TransactionOut[]
  onChanged: () => void
}) {
  const [form, setForm] = useState<FormState>(EMPTY)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const tickers = new Map(securities.map((s) => [s.id, s.ticker]))

  // 'type' is excluded: it is a union field with its own dedicated handler below.
  const set = (field: Exclude<keyof FormState, 'type'>) => (value: string) =>
    setForm((f) => ({ ...f, [field]: value }))

  const startEdit = (txn: TransactionOut) => {
    setEditingId(txn.id)
    setForm({
      security_id: String(txn.security_id),
      account: txn.account,
      type: txn.type,
      txn_date: txn.txn_date ?? '',
      shares: txn.type === 'split' ? '' : txn.shares,
      price: txn.type === 'split' ? '' : txn.price,
      fees: txn.fees ?? '',
      split_factor: txn.split_factor ?? '',
      notes: txn.notes ?? '',
    })
  }

  const submit = () => {
    if (!form.security_id || !form.account.trim()) {
      setError('Security and account are required')
      return
    }
    setBusy(true)
    setError(null)
    const payload = toPayload(form)
    const request =
      editingId !== null
        ? updateTransaction(editingId, payload)
        : createTransaction({ ...payload, security_id: Number(form.security_id) })
    request
      .then(() => {
        setForm(EMPTY)
        setEditingId(null)
        onChanged()
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Save failed')
      })
      .finally(() => setBusy(false))
  }

  const remove = (txn: TransactionOut) => {
    if (!window.confirm(`Delete this ${txn.type} of ${tickers.get(txn.security_id) ?? '?'}?`)) return
    deleteTransaction(txn.id)
      .then(onChanged)
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Delete failed')
      })
  }

  return (
    <section className="panel">
      <h2 className="panel-title">Transactions</h2>
      <p className="hint">
        Rows marked <span className="badge">sheet</span> are owned by the spreadsheet
        importer: a re-import reverts edits to them and resurrects deletions. Rows added
        here are never touched by imports.
      </p>
      {error && <div className="error-banner" role="alert">{error}</div>}
      <form
        className="entry-form"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <label>
          Security
          <select
            value={form.security_id}
            onChange={(e) => set('security_id')(e.target.value)}
            disabled={editingId !== null}
          >
            <option value="">Select…</option>
            {securities.map((s) => (
              <option key={s.id} value={s.id}>
                {s.ticker}
              </option>
            ))}
          </select>
        </label>
        <label>
          Account
          <input value={form.account} onChange={(e) => set('account')(e.target.value)} />
        </label>
        <label>
          Type
          {/* dedicated handler: `type` is a union, the generic string setter can't write it */}
          <select
            value={form.type}
            onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as TransactionType }))}
          >
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
            <option value="split">Split</option>
          </select>
        </label>
        <label>
          Date
          <input
            type="date"
            value={form.txn_date}
            onChange={(e) => set('txn_date')(e.target.value)}
          />
        </label>
        {form.type === 'split' ? (
          <label>
            Factor
            <input
              value={form.split_factor}
              onChange={(e) => set('split_factor')(e.target.value)}
              inputMode="decimal"
            />
          </label>
        ) : (
          <>
            <label>
              Shares
              <input
                value={form.shares}
                onChange={(e) => set('shares')(e.target.value)}
                inputMode="decimal"
              />
            </label>
            <label>
              Price
              <input
                value={form.price}
                onChange={(e) => set('price')(e.target.value)}
                inputMode="decimal"
              />
            </label>
            <label>
              Fees
              <input
                value={form.fees}
                onChange={(e) => set('fees')(e.target.value)}
                inputMode="decimal"
              />
            </label>
          </>
        )}
        <label className="notes-field">
          Notes
          <input value={form.notes} onChange={(e) => set('notes')(e.target.value)} />
        </label>
        <div className="form-actions">
          <button type="submit" disabled={busy}>
            {editingId !== null ? 'Save changes' : 'Add transaction'}
          </button>
          {editingId !== null && (
            <button
              type="button"
              onClick={() => {
                setEditingId(null)
                setForm(EMPTY)
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </form>
      {transactions.length === 0 ? (
        <p className="empty-note">No transactions yet.</p>
      ) : (
        <table className="port-table">
          <thead>
            <tr>
              <th>Ticker</th><th>Account</th><th>Type</th><th>Date</th>
              <th className="num">Shares</th><th className="num">Price</th>
              <th className="num">Fees</th><th>Source</th><th>Notes</th><th />
            </tr>
          </thead>
          <tbody>
            {transactions.map((t) => (
              <tr key={t.id}>
                <td>{tickers.get(t.security_id) ?? '?'}</td>
                <td>{t.account}</td>
                <td>{t.type === 'split' ? `split ×${t.split_factor ?? '?'}` : t.type}</td>
                <td>{t.txn_date ? formatDate(t.txn_date) : '—'}</td>
                <td className="num">{t.type === 'split' ? '—' : formatShares(t.shares)}</td>
                <td className="num">{t.type === 'split' ? '—' : formatCurrency(t.price)}</td>
                <td className="num">{formatCurrency(t.fees)}</td>
                <td>
                  <span className="badge">{t.source === 'import' ? 'sheet' : 'manual'}</span>
                </td>
                <td className="notes-cell">{t.notes ?? ''}</td>
                <td className="row-actions">
                  <button type="button" onClick={() => startEdit(t)}>Edit</button>
                  <button type="button" onClick={() => remove(t)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
```

Run the tests — expected: PASS.

- [ ] **Step 5: Implement `DividendsPanel.tsx`** (same shape, smaller — no edit):

```tsx
import { useState } from 'react'
import { ApiError } from '../../api/client'
import { createDividend, deleteDividend } from '../../api/portfolio'
import type { DividendOut, SecurityOut } from '../../types/api'
import { formatCurrency, formatDate } from '../../utils/format'

export default function DividendsPanel({
  securities,
  dividends,
  onChanged,
}: {
  securities: SecurityOut[]
  dividends: DividendOut[]
  onChanged: () => void
}) {
  const [form, setForm] = useState({ security_id: '', account: '', pay_date: '', amount: '', notes: '' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const tickers = new Map(securities.map((s) => [s.id, s.ticker]))

  const submit = () => {
    if (!form.security_id || !form.pay_date || !form.amount) {
      setError('Security, pay date and amount are required')
      return
    }
    setBusy(true)
    setError(null)
    createDividend({
      security_id: Number(form.security_id),
      account: form.account.trim() || null,
      pay_date: form.pay_date,
      amount: form.amount,
      notes: form.notes.trim() || null,
    })
      .then(() => {
        setForm({ security_id: '', account: '', pay_date: '', amount: '', notes: '' })
        onChanged()
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Save failed')
      })
      .finally(() => setBusy(false))
  }

  return (
    <section className="panel">
      <h2 className="panel-title">Dividends</h2>
      <p className="hint">
        The sheet never recorded dividend payments — this log is the only entry path
        (dividend totals, yield-on-cost XIRR flows all read from it).
      </p>
      {error && <div className="error-banner" role="alert">{error}</div>}
      <form
        className="entry-form"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <label>
          Security
          <select value={form.security_id} onChange={(e) => setForm((f) => ({ ...f, security_id: e.target.value }))}>
            <option value="">Select…</option>
            {securities.map((s) => (
              <option key={s.id} value={s.id}>{s.ticker}</option>
            ))}
          </select>
        </label>
        <label>
          Account
          <input value={form.account} onChange={(e) => setForm((f) => ({ ...f, account: e.target.value }))} />
        </label>
        <label>
          Pay date
          <input type="date" value={form.pay_date} onChange={(e) => setForm((f) => ({ ...f, pay_date: e.target.value }))} />
        </label>
        <label>
          Amount
          <input value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} inputMode="decimal" />
        </label>
        <label className="notes-field">
          Notes
          <input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
        </label>
        <div className="form-actions">
          <button type="submit" disabled={busy}>Add dividend</button>
        </div>
      </form>
      {dividends.length === 0 ? (
        <p className="empty-note">No dividends recorded.</p>
      ) : (
        <table className="port-table">
          <thead>
            <tr>
              <th>Ticker</th><th>Account</th><th>Pay date</th>
              <th className="num">Amount</th><th>Notes</th><th />
            </tr>
          </thead>
          <tbody>
            {dividends.map((d) => (
              <tr key={d.id}>
                <td>{tickers.get(d.security_id) ?? '?'}</td>
                <td>{d.account ?? '—'}</td>
                <td>{formatDate(d.pay_date)}</td>
                <td className="num">{formatCurrency(d.amount)}</td>
                <td className="notes-cell">{d.notes ?? ''}</td>
                <td className="row-actions">
                  <button
                    type="button"
                    onClick={() => {
                      if (!window.confirm('Delete this dividend?')) return
                      deleteDividend(d.id)
                        .then(onChanged)
                        .catch((err: unknown) => {
                          setError(err instanceof ApiError ? err.message : 'Delete failed')
                        })
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
```

- [ ] **Step 6: Implement `SecuritiesPanel.tsx`** — table of ALL securities with: edit
form (name, industry, holding_type, annual_dividend, is_manual_priced, is_active),
create form (ticker + name + holding_type + industry + manual toggle), Delete button
(confirm; a 409 surfaces in the error banner verbatim), and — for `is_manual_priced`
rows — an inline "Set price" mini-form calling `putManualPrice(ticker, { price })` then
`onChanged()`. Follow the two panels above for state/error/handler idioms EXACTLY
(promise callbacks, ApiError narrowing, busy flag, `.hint` explaining that deactivating
a security stops its price refresh). Columns: Ticker, Name, Industry, Type,
Annual div, Ex-div, Manual ✓, Active ✓, actions. Keep it a single self-contained
component; no new patterns.

- [ ] **Step 7: Gates + commit**

```bash
npm test && npm run lint && npm run build
git add src/charts/echarts.ts src/components/portfolio/AllocationPanel.tsx src/components/portfolio/TransactionsPanel.tsx src/components/portfolio/TransactionsPanel.test.tsx src/components/portfolio/DividendsPanel.tsx src/components/portfolio/SecuritiesPanel.tsx
git commit -m "feat: allocation charts + transactions/dividends/securities panels"
```

---

## Task 15: Portfolio page assembly, route, CSS

**Files:**
- Create: `src/pages/PortfolioPage.tsx`, `src/pages/PortfolioPage.css`
- Modify: `src/App.tsx`

- [ ] **Step 1: Implement `PortfolioPage.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { ApiError } from '../api/client'
import {
  fetchAllocation,
  fetchDividends,
  fetchHoldings,
  fetchSecurities,
  fetchTransactions,
} from '../api/portfolio'
import { fetchSparklines, refreshPrices } from '../api/prices'
import AllocationPanel from '../components/portfolio/AllocationPanel'
import DividendsPanel from '../components/portfolio/DividendsPanel'
import HoldingsTable from '../components/portfolio/HoldingsTable'
import SecuritiesPanel from '../components/portfolio/SecuritiesPanel'
import TransactionsPanel from '../components/portfolio/TransactionsPanel'
import StatTile from '../components/StatTile'
import type {
  AllocationResponse,
  DividendOut,
  HoldingsResponse,
  SecurityOut,
  SparklinesResponse,
  TransactionOut,
} from '../types/api'
import { formatCurrency, formatDate, formatPct } from '../utils/format'
import '../components/panels.css'
import './PortfolioPage.css'

type Tab = 'transactions' | 'dividends' | 'securities'

function toneFor(value: string | null | undefined): 'positive' | 'negative' | 'neutral' {
  if (value === null || value === undefined) return 'neutral'
  const n = Number(value)
  return n > 0 ? 'positive' : n < 0 ? 'negative' : 'neutral'
}

export default function PortfolioPage() {
  const [holdings, setHoldings] = useState<HoldingsResponse | null>(null)
  const [securities, setSecurities] = useState<SecurityOut[]>([])
  const [transactions, setTransactions] = useState<TransactionOut[]>([])
  const [dividends, setDividends] = useState<DividendOut[]>([])
  const [industry, setIndustry] = useState<AllocationResponse | null>(null)
  const [byType, setByType] = useState<AllocationResponse | null>(null)
  const [byAccount, setByAccount] = useState<AllocationResponse | null>(null)
  const [sparklines, setSparklines] = useState<SparklinesResponse>({})
  const [tab, setTab] = useState<Tab>('transactions')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshNote, setRefreshNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Promise callbacks, no setState in the effect's synchronous body — house react-hooks
  // law (see NetWorthPage). One load() refetches EVERYTHING: eight cheap local queries,
  // and every mutation path (panels' onChanged, refresh) converges through it.
  const load = () => {
    Promise.all([
      fetchHoldings(),
      fetchSecurities(),
      fetchTransactions(),
      fetchDividends(),
      fetchAllocation('industry'),
      fetchAllocation('type'),
      fetchAllocation('account'),
      fetchSparklines(),
    ])
      .then(([h, secs, txns, divs, ind, typ, acct, spark]) => {
        setHoldings(h)
        setSecurities(secs)
        setTransactions(txns)
        setDividends(divs)
        setIndustry(ind)
        setByType(typ)
        setByAccount(acct)
        setSparklines(spark)
        setError(null)
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Failed to load portfolio data')
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only fetch; load is stable by construction
  }, [])

  const onRefresh = () => {
    setRefreshing(true)
    setRefreshNote(null)
    setError(null)
    refreshPrices()
      .then((result) => {
        const failed = Object.keys(result.failed)
        setRefreshNote(
          `${result.updated.length} updated` +
            (failed.length > 0 ? `, ${failed.length} failed (${failed.join(', ')})` : '') +
            (result.skipped_manual.length > 0
              ? `, ${result.skipped_manual.length} manual skipped`
              : ''),
        )
        load()
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Price refresh failed')
      })
      .finally(() => setRefreshing(false))
  }

  const totals = holdings?.totals
  const asOf = holdings?.as_of ?? null

  return (
    <div className="page portfolio-page">
      <header className="page-header">
        <h1>Portfolio</h1>
        <div className="header-actions">
          {asOf && <span className="as-of">prices as of {formatDate(asOf.slice(0, 10))}</span>}
          <button type="button" className="refresh-btn" onClick={onRefresh} disabled={refreshing}>
            <RefreshCw size={14} className={refreshing ? 'spin' : undefined} />
            {refreshing ? 'Refreshing…' : 'Refresh prices'}
          </button>
        </div>
      </header>
      {refreshNote && <div className="hint" role="status">{refreshNote}</div>}
      {error && <div className="error-banner" role="alert">{error}</div>}
      {loading ? (
        <p className="empty-note">Loading…</p>
      ) : (
        <>
          {totals && (
            <div className="tiles-row">
              <StatTile
                label="Portfolio value"
                value={formatCurrency(totals.market_value)}
                delta={
                  totals.day_change_amount !== null
                    ? `${formatCurrency(totals.day_change_amount)} today (${formatPct(totals.day_change_pct)})`
                    : undefined
                }
                tone={toneFor(totals.day_change_amount)}
                hero
              />
              <StatTile
                label="Unrealized gain"
                value={formatCurrency(totals.unrealized_gl)}
                delta={totals.unrealized_gl_pct !== null ? formatPct(totals.unrealized_gl_pct) : undefined}
                tone={toneFor(totals.unrealized_gl)}
              />
              <StatTile label="Cost basis" value={formatCurrency(totals.cost_basis)} />
              <StatTile
                label="Dividends collected"
                value={formatCurrency(totals.dividends_collected)}
                delta={`${formatCurrency(totals.annual_income)}/yr expected`}
                tone="neutral"
              />
            </div>
          )}
          <section className="panel">
            <h2 className="panel-title">Holdings</h2>
            {totals && totals.unpriced_count > 0 && (
              <p className="hint">
                {totals.unpriced_count} holding(s) have no price yet — run a refresh or set
                a manual price in Securities.
              </p>
            )}
            <HoldingsTable holdings={holdings?.holdings ?? []} sparklines={sparklines} />
          </section>
          <AllocationPanel industry={industry} byType={byType} byAccount={byAccount} />
          <div className="tab-row" role="tablist" aria-label="Portfolio records">
            {(['transactions', 'dividends', 'securities'] as const).map((t) => (
              <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)}>
                {t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
          {tab === 'transactions' && (
            <TransactionsPanel securities={securities} transactions={transactions} onChanged={load} />
          )}
          {tab === 'dividends' && (
            <DividendsPanel securities={securities} dividends={dividends} onChanged={load} />
          )}
          {tab === 'securities' && <SecuritiesPanel securities={securities} onChanged={load} />}
        </>
      )}
    </div>
  )
}
```

(If the eslint-disable line trips a different rule set than expected, prefer the
NetWorthPage `useCallback` + `[load]` idiom — whatever the linter accepts WITHOUT
`preserve-manual-memoization` violations; the load body itself must not change.)

- [ ] **Step 2: Create `src/pages/PortfolioPage.css`** — read `NetWorthPage.css` and
`panels.css` FIRST and reuse their tokens/classes; define only what's new:

```css
.portfolio-page .page-header { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; }
.portfolio-page .header-actions { display: flex; align-items: center; gap: 12px; }
.portfolio-page .as-of { color: var(--muted, #8b93a3); font-size: 12px; }
.tiles-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px; margin-bottom: 16px; }
.holdings-scroll { overflow-x: auto; }
.port-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.port-table th, .port-table td { padding: 6px 10px; text-align: left; white-space: nowrap; border-bottom: 1px solid #1e222c; }
.port-table th.num, .port-table td.num { text-align: right; font-variant-numeric: tabular-nums; }
.port-table .th-sort { background: none; border: none; color: inherit; font: inherit; cursor: pointer; padding: 0; }
.ticker-cell { display: flex; flex-direction: column; }
.ticker-cell .ticker { font-weight: 600; display: flex; align-items: center; gap: 6px; }
.port-table .sub, .ticker-cell .sub { color: #8b93a3; font-size: 11px; }
.badge { background: #1e222c; border: 1px solid #262b36; border-radius: 4px; padding: 0 6px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: #8b93a3; }
.warn-icon { color: #c98500; display: inline-flex; }
.stale { color: #c98500; }
.pos { color: #3fb968; }
.neg { color: #e05252; }
.allocation-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 16px 0; }
@media (max-width: 900px) { .allocation-grid { grid-template-columns: 1fr; } }
.panel-title-row { display: flex; justify-content: space-between; align-items: center; }
.toggle-row button, .tab-row button { background: #1e222c; color: #8b93a3; border: 1px solid #262b36; padding: 4px 12px; cursor: pointer; }
.toggle-row button[aria-pressed='true'], .tab-row button[aria-pressed='true'] { color: #e6e9ef; border-color: #3987e5; }
.tab-row { display: flex; gap: 8px; margin: 16px 0 8px; }
.entry-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-bottom: 14px; align-items: end; }
.entry-form label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #8b93a3; }
.entry-form input, .entry-form select { background: #1e222c; border: 1px solid #262b36; color: #e6e9ef; padding: 6px 8px; border-radius: 6px; }
.entry-form .notes-field { grid-column: span 2; }
.form-actions { display: flex; gap: 8px; }
.row-actions button { margin-right: 6px; }
.hint { color: #8b93a3; font-size: 12px; margin: 4px 0 10px; }
.empty-note { color: #8b93a3; }
.error-banner { background: rgba(224, 82, 82, 0.12); border: 1px solid #e05252; color: #e6e9ef; padding: 8px 12px; border-radius: 8px; margin-bottom: 12px; }
.refresh-btn { display: inline-flex; align-items: center; gap: 6px; }
@media (prefers-reduced-motion: no-preference) {
  .spin { animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
}
```

Deduplicate against `panels.css`: any class it ALREADY defines (`.panel`,
`.panel-title`, `.error-banner`, `.hint`, …) must NOT be redefined here — delete the
duplicate from this file and rely on the shared one. Colors above are theme.ts values;
if `panels.css` exposes CSS variables for them, use the variables instead.

- [ ] **Step 3: Swap the route in `src/App.tsx`** — import PortfolioPage, replace
`<Route path="/portfolio" element={<PlaceholderPage title="Portfolio" />} />` with
`<Route path="/portfolio" element={<PortfolioPage />} />`. (Nav already links to
/portfolio — no Layout change.)

- [ ] **Step 4: Gates + record the bundle cost**

```bash
npm test && npm run lint && npm run build
```

Expected: green. RECORD the `dist/assets/index-*.js` size from the build output in the
task-16 notes (Plan 3 measured ~864 kB raw / ~287 kB gzip; treemap+pie adds — Plan 6's
code-splitting note absorbs it).

- [ ] **Step 5: Commit**

```bash
git add src/pages/PortfolioPage.tsx src/pages/PortfolioPage.css src/App.tsx
git commit -m "feat: portfolio page (tiles, holdings, allocation, ledgers)"
```

---
## Task 16: E2E + reconciliation vs the sheet + live refresh (controller-driven)

The controller (not a fresh implementer) drives this task — it needs the live workbook,
the dev DB, dev servers, and judgment calls. Record every result inline in this section
via `docs: record ...` commits.

**ORDER MATTERS: reconcile against the SEEDED prices FIRST (steps 2–3), then run the
live refresh (step 4) — the refresh overwrites the seeded, sheet-vintage prices.**

- [ ] **Step 1: Dev servers up.** Docker Desktop + `docker compose up -d db` (from repo
root of the WORKTREE), `alembic upgrade head` confirmed at Task 1, then backend:
`cd backend && .venv/Scripts/python.exe -m uvicorn app.main:app --port 8000` (background;
note: killing it later requires killing BOTH the python PID and the uvicorn.exe wrapper —
machine note). Login via `POST /api/v1/auth/login` (admin@example.com / changeme123) →
capture the token for curl.

- [ ] **Step 2: API sanity E2E against real data (pre-refresh).**
  - `GET /portfolio/holdings` → 22 holdings (22 tickers hold transactions — plan probe 4);
    every `price` non-null EXCEPT any security without a seeded price; `day_change_pct`
    null everywhere (no history yet); `xirr_pct` null everywhere (all txns dateless).
  - `GET /portfolio/allocation?by=industry|type|account` → weights sum to 1 ±0.000002.
  - `GET /portfolio/realized` → total "0.00", rows [].
  - `GET /prices/sparklines` → `{}` (no history yet).
  - Transactions round-trip: POST a buy (tiny, e.g. 1 share of SGOV at 100) → verify
    `source:"ui"`, `sort_index` = prior max+10 → holdings shares bumped → DELETE it →
    holdings restored. Record the observed sort_index.
- [ ] **Step 3: Reconciliation vs the sheet Portfolio tab (SEEDED prices).** Write a
throwaway script in the SCRATCHPAD (never committed) that: reads the live workbook's
Portfolio rows (layout per probe 5, values full-precision), calls `GET
/portfolio/holdings`, and compares per the tolerance table in "Sheet reference for Task
16". ALL gates must pass; investigate any miss before proceeding (fold logic, quantize
points, sheet quirk — in that order). Record aggregates only (max |diff| per column,
counts) in this section. Note any sheet rows with zero/None shares (watchlist rows —
expected absent from our holdings).
- [ ] **Step 4: Live refresh.** Build the CA bundle (Windows cert stores → PEM, plan
probe 2 — script it in the scratchpad), then restart uvicorn with
`YFINANCE_CA_BUNDLE=<bundle path>` and `POST /prices/refresh`.
  - Expected: `updated` ≈ 36–37 tickers, `failed` contains ZI ("no data returned" or a
    transport error — ZoomInfo delisted) and nothing else; duration under ~120s.
  - Verify: `latest_prices` all `source='yfinance'` with today-ish `quoted_at`;
    `price_history` ≈ 250 rows/ticker (`SELECT security_id, count(*) FROM price_history
    GROUP BY 1` spot-check); holdings now show non-null `day_change_pct`; sparklines
    return ~53 weekly points/ticker; BRK.B priced (the dot→dash mapping's live proof);
    VFFSX/VIEIX priced (spec-risk closure); `annual_dividend` updated on dividend payers
    (VOO/SCHD non-zero, growth names 0) and `ex_div_date` populated.
  - Run refresh a SECOND time → idempotent (same counts, no duplicate history rows).
  - Sanity: every new price within ±25% of its seeded value (flag anything wilder — wrong-
    ticker hazard); record the worst mover.
- [ ] **Step 5: Data hygiene.** `PATCH /portfolio/securities/{ZI id}` `{"is_active":
false}` (stops refetching a delisted ticker; recorded as a user-visible decision).
Confirm a follow-up refresh no longer lists ZI in `failed`.
- [ ] **Step 6: Scheduler smoke.** With uvicorn running (scheduler enabled by default),
confirm the boot log line `price refresh scheduled: '10 13 * * 1-5'
(America/Los_Angeles)`. No need to wait for a firing — the job body is the same
`refresh_prices` the endpoint just exercised live.
- [ ] **Step 7: Frontend smoke.** `npm run dev` + the dev proxy (targets 127.0.0.1:8000
— Plan 3 fix). Load `/portfolio` logged in: tiles populated, holdings table sorted by
weight, sparklines drawn, treemap + donut render, tabs switch, add/delete a transaction
and a dividend through the UI, set ZI... (skip — ZI inactive; instead flip a security to
manual-priced in Securities, set a manual price, flip it back and refresh). The full
interactive visual pass stays a USER item (consistent with Plan 3) — record whatever
cannot be verified without a browser.
- [ ] **Step 8: Record + commit** — fill this section's results (aggregate numbers only,
no raw sheet values beyond what the tolerance table already names), plus the bundle size
from Task 15:

```bash
git add docs/superpowers/plans/2026-08-14-plan-4-portfolio-prices.md
git commit -m "docs: record Plan 4 reconciliation + live refresh results (Task 16)"
```

### Task 16 results (filled during execution)

- Pre-refresh holdings/allocation/realized sanity: _pending_
- Reconciliation vs sheet (per-column max |diff|, row counts): _pending_
- Live refresh (updated/failed counts, duration, worst mover vs seeded): _pending_
- Second-refresh idempotency: _pending_
- ZI deactivation: _pending_
- Scheduler boot log: _pending_
- Frontend smoke + remaining user-visual items: _pending_
- Task 15 bundle size: _pending_

---

## Task 17: Forward notes + final review

- [ ] **Step 1: Whole-branch self-review.** `git log --oneline main..HEAD` + `git diff
main --stat`; re-read the spec §4/§5/§6 portfolio lines and this plan's Locked decisions;
confirm every task's gate ran green in its final form. Dispatch the final code-review
subagent per the execution process.

- [ ] **Step 2: Append "Forward notes for Plans 5+" to this doc** — seed list (amend
with execution findings):

```
## Forward notes for Plans 5+ (from Plan 4 execution)

- position_transactions.source is the ownership contract: importer syncs ONLY
  source='import'; UI rows get max+10 sort_index and fold LAST. A sheet re-import can
  mint a colliding sort_index (fold tie-breaks on id) — cosmetic, accepted. At such a
  collision the UI row folds FIRST (lower id), degrading the folds-last guarantee for
  exactly that pair (Task 2 review probe; oversell path warns, never 500s).
- Importer preload keys import rows by sort_index in a dict: two import rows sharing a
  sort_index would silently orphan one (never updated/deleted) and duplicate a holding.
  Unreachable via supported paths (importer writes unique rnum*10; UI writes source='ui';
  dev DB verified duplicate-free) — reachable only by re-running the Task 1 migration's
  down/up after a collision exists, which its comment forbids (Task 2 review Minor 1).
- Import report samples key on position_transactions[sort_index] — ambiguous once a
  UI/import collision exists; add source or id to the sample string if it ever confuses
  (Task 2 review Minor 3).
- Test-hardening batch for a later importer touch (Task 2 review Minor 2 + mutation
  gaps): give the stray-deletion test's UI row an explicit non-zero sort_index (e.g.
  1000); optionally seed an import row at sort_index=0 (assert deleted — kills the
  over-filter mutant) and a source='legacy' row (assert survives — kills the != 'ui'
  mutant).
- XIRR is null until txn_dates are backfilled via the ledger UI (sheet's XIRR column was
  dead — probe 5). If the user backfills, per-security XIRR lights up automatically.
- XIRR shows "—" for legitimately-out-of-domain holdings: a position bought yesterday and
  up 1% annualizes to +3,678%, outside RATE_HI=10.0 (~3% of plausible fresh positions in
  the Task 3 review sweep: 62/150 Nones at 1-day spans). Honest behavior, not a bug —
  don't re-litigate; a tooltip is the fix if the user asks.
- test_services_xirr imports the private _dxnpv to pin the analytic derivative against a
  central difference — renaming/refactoring _dxnpv breaks that test by design.
- require_reasonable_date (money.py, Task 9) bounds txn_date/pay_date to 1900..2100 at
  the API; the importer path is unguarded by it (sheet has no dates today) and xirr's
  MAX_SPAN_DAYS is the backstop.
- Price refresh rewrites annual_dividend/ex_div_date from Yahoo TTM events for
  non-manual securities — manual edits to those two fields don't survive a refresh.
- The scheduler reads price_refresh_cron ONCE at boot — changing the setting requires a
  backend restart (Plan 6 settings UI should say so, or Plan 6 adds re-scheduling).
- quoted_at = the BAR date (UTC midnight), not fetch time — freshness reads honest but
  "today 00:00Z" can look ~a day old to naive comparisons; UI compares dates only.
- refresh_prices commits its own session; the POST endpoint passes the request session —
  don't call it mid-transaction elsewhere.
- ZI (ZoomInfo) deactivated during Task 16 (delisted). Reactivating resumes refresh.
- Plan 6 Overview: reuse GET /portfolio/holdings totals (value + day Δ) and
  /net-worth/summary — do NOT re-derive; investable_base stays the 4%-line source.
- Plan 6 prod import order gotcha still stands (is_component five-slug UPDATE) — now ALSO
  run the first prod price refresh + re-verify ZI/inactive flags after importing.
- Bundle: treemap+pie grew the main chunk to <record from Task 15> — Plan 6
  code-splitting note stands.
```

- [ ] **Step 3: Definition-of-done audit + commit**

```bash
git add docs/superpowers/plans/2026-08-14-plan-4-portfolio-prices.md
git commit -m "docs: Plan 4 forward notes for Plans 5+"
git log --oneline main..HEAD
```

---

## Definition of done (Plan 4)

- `pytest -q -W error` green in the worktree (all prior suites + xirr + portfolio_calc +
  provider + price service + scheduler + both new API suites); `ruff check` +
  `ruff format --check` + `alembic check` clean.
- `npm test` green (prior 22 + sparkline + holdings table + transactions panel + format
  additions); `npm run lint` (1 sanctioned warning) + `npm run build` clean.
- Migration applied to the dev DB; 26 imported rows backfilled `source='import'`;
  importer re-import leaves UI rows untouched (test-pinned).
- Reconciliation vs the sheet Portfolio tab: ALL tolerance-table gates pass with seeded
  prices (Task 16 step 3) BEFORE the first live refresh.
- Live refresh succeeds for every ticker except ZI (recorded), twice (idempotent);
  BRK.B/VFFSX/VIEIX priced; day Δ + sparklines + TTM dividends populated; scheduler boots.
- `/portfolio` renders against real data (placeholder replaced); transactions/dividends/
  securities editable through the UI; manual-price path works; frozen-palette rules
  honored (sequential treemap, ≤3-hue + Other donut, theme.ts untouched beyond nothing).
- Every derived number computed at request time; the ONLY schema change is
  `position_transactions.source`; importer contract updated + test-pinned; no real
  workbook values committed.
- Plan doc carries Task 16 results + Forward notes for Plans 5+.
