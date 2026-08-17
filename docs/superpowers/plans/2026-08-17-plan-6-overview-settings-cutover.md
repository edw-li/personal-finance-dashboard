# Plan 6: Overview Dashboard + Settings Page + Code-Splitting + Cutover Runbook — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.
> Implementer subagents read their exact `### Task N:` section plus `## Global rules` and
> `## Sanctioned deviations & deferrals`. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-08-17 (overnight run)
**Goal:** Ship the last two pages (`/` Overview, `/settings` with app-settings form, password
change, and the xlsx import UI), split the 1,034.68 kB bundle at the route level, add the two
owed backend verticals (`DELETE /taxes/years/{year}`, app-settings GET/PUT with a cron guard),
and write the production import & cutover runbook. This completes the 6-plan roadmap.
**Architecture:** Overview composes the EXISTING module GETs client-side (one `Promise.all`,
one payload object — the Plan 4/5 forward notes' "do NOT re-derive" directive); settings is a
new thin router over the existing `app_settings` key/JSONB table reusing the readers'
fallback semantics; import/password UIs wire to endpoints that already exist (Plan 2 /
Plan 1); code-splitting is `React.lazy` per protected route + `Suspense` around the Layout
`Outlet`.
**Tech stack:** unchanged — FastAPI + async SQLAlchemy + pydantic v2 (Decimals wire as JSON
strings), React 19 + TS + ECharts via the in-repo `<EChart>` wrapper. **No new dependencies.**
**Spec:** `docs/superpowers/specs/2026-08-12-finance-dashboard-design.md` §5 (auth
change-password, import endpoint, dashboard), §6 (Overview + Settings pages), §8/§10
(deploy/cutover phases), §9 (reconciliation). Binding forward notes: Plan 2 "Forward notes for
Plans 3+ (finalized)", Plan 3 "Forward notes for Plans 4+" (+ its Task 16 Step 3 seed list),
Plan 4 "Forward notes for Plans 5+", Plan 5 "Forward notes for Plan 6" — each restated below
where it lands.

**Scope guard — NO SCHEMA CHANGES.** Every table this plan touches exists since Plan 1.
No new Alembic revision may be created; `alembic check` must stay clean with the single head
`e5b93d0a416f` throughout. (`app_settings` already exists — the settings router is pure API.)

**Baselines in this worktree at branch point (verified 2026-08-17):** backend **518 pytest
`-W error`** + ruff + format + `alembic check` clean; frontend **209 vitest** + lint (1
sanctioned warning) + build (single 1,034.68 kB raw / 338.41 kB gzip chunk + the expected
500 kB warning). Every task leaves ALL gates green.

---

## Sanctioned deviations & deferrals (declared up front)

1. **No `dashboard` aggregate router** (spec §5 lists `GET /dashboard/overview`, "one call
   renders the home page"). The Overview page instead composes the existing GETs client-side:
   `/net-worth/summary`, `/net-worth/timeseries`, `/portfolio/holdings` (totals),
   `/portfolio/allocation?by=type`, `/spending/matrix`, `/taxes/summary`. Rationale: the
   Plan 4/5 forward notes are explicit — "reuse GET /taxes/summary …, /portfolio/holdings
   totals, /net-worth/summary — do NOT re-derive"; a sixth router re-assembling five routers'
   response logic is exactly the drift class those notes warn about. Six parallel GETs against
   a localhost/nginx single-user API render fine (~45 ms holdings is the slowest; plan-4 notes
   a `with_history` flag as the 2-line fix if Overview latency ever matters). Same deviation
   class as Plan 5's ratified `GET /paycheck/breakdown` path departure — declared here, revisit
   only on user request.
2. **Client-side presentation stats on Overview** (12-month average spend, latest-month pick,
   tax-year pick): computed from server-provided monthly totals in exported pure helpers with
   tests. This is SpendingPage's existing `categoryTotals`/`topIds` class (presentation math
   over server values), NOT the forbidden `totals.unrealized_gl` class (re-deriving a value the
   server already provides). Every financial primitive on the page renders a server field
   verbatim.
3. **Deferred candidates — declared, not built** (each needs a user decision or a
   next-touch trigger that Plan 6 doesn't hit): ESPP modeler `?year=` selector; /comp
   refresh-grant timeline visualization; `on_conflict_do_*` batch TOCTOU fix
   (accounts/securities/taxes); money.py public 5dp/9dp quantizer promotion + espp/paycheck/
   comp router-validator dedup (money.py is untouched by this plan); JWT rotation /
   forced-logout on password change (single-user app, 24 h expiry — the settings UI states
   this honestly); rate-limiting `change-password` (already requires a valid JWT); upload
   progress reporting on the import card; save-vs-delete resurrect: an editor save committing
   after `DELETE /taxes/years/{year}` recreates the year (`_ensure_year`; not a tombstone) —
   accepted TOCTOU class, commented at the delete door (Task 4 review);
   `spendStats.avg12` counts cashflow-only "0.00" months at full weight (server can't
   distinguish absent from zero; display-side I1 guard only) — ratified Task 8 review,
   server-side absent/zero distinction is the real fix if it ever matters; NetWorthPage has
   NO test file, so its tiles' switch to the shared `toneOf` (zero-MoM now neutral/grey
   instead of positive/green — Task 8 review I1) is unpinned by any test, as is the rest of
   that page's rendering; code-splitting introduced the rejected-route-chunk failure mode —
   RouteBoundary (the app's only error boundary) catches it with a Reload affordance;
   fallback styling lives in Layout.css because panels.css left the entry (Task 9 review).
   README Part 4 should note post-deploy stale tabs (Task 11).
4. **Prod actions are the USER's** (standing instruction): nothing in this plan pushes,
   deploys, or writes to any non-test database. The cutover work product is the runbook
   (Task 11) + the verified import UI.

---

## Global rules (bind every task)

1. **All subagents run on Opus 5** (standing user mandate, reaffirmed tonight for ALL
   subagents including reviewers).
2. **No schema changes, no new migrations, no seed/tax_keys edits.** `alembic check` stays
   clean; head stays `e5b93d0a416f`. If a task seems to need a column — STOP and report.
3. **Decimal discipline:** backend validation reuses `app/services/money.py` vocabulary —
   do NOT mint new validation phrasing where an existing helper/message exists (settings
   ticker validation imports portfolio's existing validator; private-import precedent:
   espp imports `money._quantize_bounded`). pydantic v2 serializes Decimal as JSON strings —
   frontend money/pct types are strings; `Number()` is display-only.
4. **API idioms mirror the existing routers:** `APIRouter(prefix, tags,
   dependencies=[Depends(get_current_user)])`, `Depends(get_db)`, 404 detail strings, 422 via
   the shared vocabulary, `response_model` schemas in `app/schemas/<module>.py`, 204 deletes
   return bare `Response(status_code=204)`. Get-then-set on single rows is the accepted
   single-user TOCTOU class (note it in a comment, don't fix it).
5. **Tests:** pytest `-W error` clean; API suites follow `backend/tests/test_taxes_api.py` /
   `test_import_api.py` fixtures (`auth_client`, `db`, shared-session contract: after an
   expected IntegrityError, `await db.rollback()`; seed ORM objects at COLUMN SCALE).
   Frontend: vitest ^3, RTL with explicit `cleanup()` in a local `afterEach`, api modules
   mocked per test via `vi.mock('../api/<module>', …)` partial mocks, `vi.mock('../components/EChart', …)`
   (NEVER render echarts in jsdom), option builders exported as pure functions and tested
   directly against real `charts/theme` tokens.
6. **React laws (react-hooks 7):** no setState in an effect's synchronous body — loads are
   plain (non-`useCallback`) functions using promise callbacks, called from
   `useEffect(() => { load() }, [])` and from event handlers; `preserve-manual-memoization`
   forbids `useCallback` loads in many-setter components (Overview/Settings: plain function,
   inline chain). Stale-response races guarded by the `seqRef` recipe (TaxesPage). Every
   echarts option object is `useMemo`'d (EChart keys `[option]` with `notMerge`). a11y:
   `aria-pressed` on toggles, `role="alert"` on error banners, labels on inputs.
7. **Charts:** frozen palette + dark theme — `src/charts/*` MUST NOT CHANGE (diff vs main
   stays empty; DoD-audited). New builders import `PALETTE`/`SEQUENTIAL_BLUE`/
   `OTHER_SERIES_COLOR`/`SURFACE`/`MUTED`/`INK` tokens only. All needed echarts components
   (Bar/Line/Pie + Grid/Tooltip/Legend) are ALREADY registered in `src/charts/echarts.ts` —
   add nothing to `use([...])`. Donut stays an all-pairs form: ≤3 identity hues + gray
   "Other" fold. `escapeHtml` in every HTML tooltip formatter.
8. **Money rendering:** reuse `src/utils/format.ts` (`formatCurrency`, `formatCurrencyCompact`,
   `formatPct` — takes a FRACTION, `formatMonth`, `formatDate`). Render backend-computed
   values; never re-derive a value the server provides (`totals.unrealized_gl` lesson).
   Percent inputs gate with `isPlainDecimal` BEFORE `Number()` and convert with `shiftPoint`
   (`src/utils/percent.ts`) — exponent text is otherwise stored 100× off.
9. **Commits:** conventional prefixes, one per task plus fix commits; `git add` ONLY the
   files you created/modified (NEVER `git add -A` — the worktree contains `.venv` and
   `node_modules`); `git commit -q -m`. NEVER push. Never run `git checkout`/`switch`/`merge`.
10. **Gates per task (cwd = the WORKTREE root
    `C:\Users\edyli\personal-finance-dashboard\.worktrees\plan-6-overview-settings`; cwd
    persists between Bash calls — `cd` there once at the start of your session):**
    - `backend/.venv/Scripts/python.exe -m pytest backend/tests -q -W error`
    - `backend/.venv/Scripts/python.exe -m ruff check backend`
    - `backend/.venv/Scripts/python.exe -m ruff format --check backend`
    - `cd backend && .venv/Scripts/python.exe -m alembic check` then `cd ..` — the
      `-c backend/alembic.ini` form FAILS (`ModuleNotFoundError: app` — `prepend_sys_path`
      is cwd-relative), verified at branch point. Expect "No new upgrade operations detected."
    - `npm test`, `npm run lint` (exactly ONE sanctioned warning:
      `AuthContext.tsx 54:17 react-refresh/only-export-components`), `npm run build`
    - Frontend-only tasks may skip the backend gates and vice versa; the FINAL task runs all.
    Format-wins rule: AST-identical ruff rewraps of plan-shown code are sanctioned.
11. **Permissions discipline (unattended overnight run):** use EXACTLY the command forms
    above and in the steps — they are allowlisted. Do not invent new command shapes
    (`npm run preview`, `node -e`, `pip` outside `backend/.venv/Scripts/python.exe -m pip`,
    absolute-path venv invocations, `git push`, edits to `.claude/settings.json`) — an
    unlisted command blocks the whole overnight run on a permission prompt.
12. **Privacy:** the real workbook path/filename never appears in committed code, fixtures,
    docs, or commit messages (write `<path-to-workbook>.xlsx` in the runbook). No financial
    values in log statements. Synthetic workbooks come from
    `backend/tests/workbook_builder.py::build_workbook()`.
13. **Dev DB is REAL DATA** (loopback 5433, `finance`): implementer/reviewer tasks NEVER
    touch it — not even reads; the test DB `finance_test` is conftest-rebuilt per run. Only
    Task 10 (controller-supervised) touches the dev DB, READ-ONLY (GETs + one dry-run import
    whose session is rolled back server-side).
14. **The scheduler contract:** `price_refresh_cron` is read ONCE at boot (plan-4 note) —
    the settings PUT only stores; the UI carries the restart note. Day NAMES, never numbers
    (APScheduler 0=Mon trap, recorded prod incident) — the PUT rejects numeric day-of-week.

---

## File structure

```
backend/app/api/taxes.py                       # modify: + DELETE /years/{year} (Task 1)
backend/tests/test_taxes_api.py                # modify: + delete-year tests (Task 1)
backend/app/schemas/app_settings.py            # create (Task 2)
backend/app/api/app_settings.py                # create: GET/PUT /settings (Task 2)
backend/app/main.py                            # modify: mount settings router (Task 2)
backend/tests/test_app_settings_api.py         # create (Task 2)
src/api/client.ts                              # modify: FormData Content-Type fix (Task 3)
src/api/client.test.ts                         # modify: + FormData tests (Task 3)
src/types/api.ts                               # modify: + ImportReport/AppSettings types (Task 3)
src/api/settings.ts                            # create (Task 3)
src/api/importer.ts                            # create (Task 3)
src/api/importer.test.ts                       # create (Task 3)
src/api/taxes.ts                               # modify: + deleteTaxYear (Task 3)
src/pages/TaxesPage.tsx                        # modify: delete-year affordance (Task 4)
src/pages/TaxesPage.test.tsx                   # modify: + delete tests (Task 4)
src/pages/SettingsPage.tsx / SettingsPage.css  # create (Task 5, import card in Task 6)
src/pages/SettingsPage.test.tsx                # create (Task 5, extend Task 6)
src/components/settings/ImportReportView.tsx   # create (Task 6)
src/App.tsx                                    # modify: /settings route (Task 5), / route
                                               #   (Task 8), lazy routes (Task 9)
src/components/portfolio/allocationChartOptions.ts       # create: lifted builders (Task 7)
src/components/portfolio/allocationChartOptions.test.ts  # create (Task 7)
src/components/portfolio/AllocationPanel.tsx   # modify: import lifted builders (Task 7)
src/utils/staleness.ts                         # create: lifted isStale (Task 7)
src/utils/staleness.test.ts                    # create (Task 7)
src/components/portfolio/HoldingsTable.tsx     # modify: import lifted isStale (Task 7)
src/components/overview/overviewChartOptions.ts       # create: builders + helpers (Task 7)
src/components/overview/overviewChartOptions.test.ts  # create (Task 7)
src/pages/OverviewPage.tsx / OverviewPage.css  # create (Task 8)
src/pages/OverviewPage.test.tsx                # create (Task 8)
src/components/Layout.tsx                      # modify: Suspense around Outlet (Task 9)
vite.config.ts                                 # modify: chunk warning limit if needed (Task 9)
README.md                                      # modify: Part 7 cutover runbook (Task 11)
docs/superpowers/plans/2026-08-17-plan-6-*.md  # this doc: execution status (Task 12)
```

---

### Task 1: `DELETE /api/v1/taxes/years/{year}` — the owed phantom-year endpoint [TDD]

**Context:** every taxes write auto-creates the year row (`_ensure_year`) and nothing deletes
one — a typo'd year lingers forever (Plan 5 forward note; empty-PUT-creates is test-pinned and
MUST survive). Both child FKs (`tax_inputs.year`, `tax_brackets.year`) carry
`ondelete="CASCADE"` at the DB level; `TaxYear` has NO ORM relationships, so use a CORE delete
(the `put_brackets` precedent in the same file). `tax_input_definitions` is year-independent
and must be untouched.

**Files:** Modify `backend/app/api/taxes.py`, `backend/tests/test_taxes_api.py`.

- [ ] **Step 1: Write the failing tests.** Append to `test_taxes_api.py`, reusing the file's
  existing seed/PUT helpers and import style (adapt helper names to what the file defines —
  the assertions below are the contract):

```python
async def test_delete_year_404_when_missing(auth_client):
    r = await auth_client.delete("/api/v1/taxes/years/2031")
    assert r.status_code == 404
    assert r.json()["detail"] == "tax year 2031 not found"


async def test_delete_year_rejects_out_of_range_year(auth_client):
    assert (await auth_client.delete("/api/v1/taxes/years/1899")).status_code == 422


async def test_delete_year_removes_the_whole_year_vertical(auth_client, db):
    # Seed a year that has BOTH inputs and brackets (use the file's existing helpers that
    # put inputs/brackets for a year), then delete it.
    ...  # seed year 2030 with >=1 input and >=1 bracket via the API
    r = await auth_client.delete("/api/v1/taxes/years/2030")
    assert r.status_code == 204
    years = [y["year"] for y in (await auth_client.get("/api/v1/taxes/years")).json()]
    assert 2030 not in years
    assert (await auth_client.get("/api/v1/taxes/years/2030/inputs")).status_code == 404
    n_inputs = (
        await db.execute(select(func.count()).select_from(TaxInput).where(TaxInput.year == 2030))
    ).scalar_one()
    n_brackets = (
        await db.execute(
            select(func.count()).select_from(TaxBracket).where(TaxBracket.year == 2030)
        )
    ).scalar_one()
    assert (n_inputs, n_brackets) == (0, 0)
    # Definitions are year-independent seed data — a year delete must not touch them.
    n_defs = (
        await db.execute(select(func.count()).select_from(TaxInputDefinition))
    ).scalar_one()
    assert n_defs > 0


async def test_empty_put_recreates_a_deleted_year(auth_client):
    # The empty-PUT-creates law survives deletion (pin the pair explicitly).
    ...  # empty PUT inputs for 2029 (existing helper) -> year exists
    assert (await auth_client.delete("/api/v1/taxes/years/2029")).status_code == 204
    ...  # empty PUT inputs for 2029 again
    years = [y["year"] for y in (await auth_client.get("/api/v1/taxes/years")).json()]
    assert 2029 in years
```

- [ ] **Step 2: Run the new tests, verify they FAIL** (405, no DELETE route):
  `backend/.venv/Scripts/python.exe -m pytest backend/tests/test_taxes_api.py -q -W error`

- [ ] **Step 3: Implement.** In `backend/app/api/taxes.py` (add `Response` to the fastapi
  import if absent; `delete` is already imported for `put_brackets`):

```python
@router.delete("/years/{year}", status_code=204)
async def delete_year(year: YearPath, db: AsyncSession = Depends(get_db)) -> Response:
    """Remove a tax year and everything under it (phantom years from typos — Plan 5 note).

    Core DELETE, not ORM cascade: both child FKs carry ondelete=CASCADE in Postgres and
    TaxYear declares no relationships, so one statement removes the year vertical
    (put_brackets' core-statement precedent). tax_input_definitions is year-independent
    seed data and is untouched. Every write path can recreate the year afterwards —
    empty-PUT-creates stays law.
    """
    await _require_year(db, year)
    await db.execute(delete(TaxYear).where(TaxYear.year == year))
    await db.commit()
    return Response(status_code=204)
```
  (Match `_require_year`'s actual signature/return in the file; place the route with the
  other `/years/{year}` routes.)

- [ ] **Step 4: Run the suite + backend gates** (global rule 10). Expected: 518 + 4 new pass.

- [ ] **Step 5: Commit** `feat: DELETE /taxes/years/{year} — phantom-year cleanup (CASCADE, core delete)`

---

### Task 2: App-settings API — `GET/PUT /api/v1/settings` with the cron guard [TDD]

**Context:** the `app_settings` table (key `String(60)` PK, `value` JSONB) exists since
Plan 1 with three seeded keys, but NO endpoints exist. Readers already define the fallback
semantics — `net_worth_calc.get_swr_pct` (default 0.04, clamps to finite [0,1]),
`scheduler.read_cron_setting` (default `"10 13 * * mon-fri"`), espp's ticker hop (blank/absent
→ None). GET returns EFFECTIVE values (reader semantics); PUT is full-form and stores the
readers' envelope `{"value": ...}`. The cron guard is the plan-4 forward note made real:
reject unparseable crons, sub-hourly cadence, and numeric day-of-week (the recorded
0=Mon prod incident).

**Files:** Create `backend/app/schemas/app_settings.py`, `backend/app/api/app_settings.py`
(module named `app_settings`, NOT `settings` — `main.py` already imports `app.config.settings`),
`backend/tests/test_app_settings_api.py`. Modify `backend/app/main.py`.

- [ ] **Step 1: Write the failing tests** (`backend/tests/test_app_settings_api.py`; mirror
  `test_taxes_api.py`'s imports/fixtures):

```python
SETTINGS = "/api/v1/settings"

VALID_BODY = {
    "swr_pct": "0.045",
    "espp_ticker": "nvda",
    "price_refresh_cron": "10 13 * * mon-fri",
}


async def test_settings_require_auth(client):
    assert (await client.get(SETTINGS)).status_code == 401


async def test_get_returns_effective_defaults_on_an_empty_table(auth_client):
    body = (await auth_client.get(SETTINGS)).json()
    assert body == {
        "swr_pct": "0.04",
        "espp_ticker": None,
        "price_refresh_cron": "10 13 * * mon-fri",
    }


async def test_get_falls_back_on_a_malformed_stored_value(auth_client, db):
    db.add(AppSetting(key="swr_pct", value={"value": "garbage"}))
    await db.commit()
    body = (await auth_client.get(SETTINGS)).json()
    assert body["swr_pct"] == "0.04"  # reader semantics: malformed == absent


async def test_put_round_trips_and_stores_the_envelope(auth_client, db):
    r = await auth_client.put(SETTINGS, json=VALID_BODY)
    assert r.status_code == 200
    assert r.json() == {
        "swr_pct": "0.045000",
        "espp_ticker": "NVDA",
        "price_refresh_cron": "10 13 * * mon-fri",
    }
    assert (await auth_client.get(SETTINGS)).json() == r.json()
    stored = await db.get(AppSetting, "swr_pct")
    assert stored.value == {"value": "0.045000"}  # plain-notation STRING (lossless re-read)
    assert (await db.get(AppSetting, "espp_ticker")).value == {"value": "NVDA"}


async def test_put_clears_the_ticker_with_null(auth_client):
    body = dict(VALID_BODY, espp_ticker=None)
    r = await auth_client.put(SETTINGS, json=body)
    assert r.status_code == 200
    assert r.json()["espp_ticker"] is None


@pytest.mark.parametrize("bad", ["1.5", "-0.1"])
async def test_put_rejects_out_of_range_swr(auth_client, bad):
    r = await auth_client.put(SETTINGS, json=dict(VALID_BODY, swr_pct=bad))
    assert r.status_code == 422
    assert r.json()["detail"] == "swr_pct: must be a fraction between 0 and 1"


async def test_put_rejects_a_malformed_ticker(auth_client):
    r = await auth_client.put(SETTINGS, json=dict(VALID_BODY, espp_ticker="bad ticker!"))
    assert r.status_code == 422  # portfolio's exact phrasing — assert the status only


async def test_put_rejects_an_unparseable_cron(auth_client):
    r = await auth_client.put(SETTINGS, json=dict(VALID_BODY, price_refresh_cron="not a cron"))
    assert r.status_code == 422
    assert r.json()["detail"].startswith("price_refresh_cron: not a valid 5-field cron")


@pytest.mark.parametrize("fast", ["* * * * *", "10,40 13 * * mon-fri", "*/30 * * * *"])
async def test_put_rejects_sub_hourly_crons(auth_client, fast):
    r = await auth_client.put(SETTINGS, json=dict(VALID_BODY, price_refresh_cron=fast))
    assert r.status_code == 422
    assert r.json()["detail"] == "price_refresh_cron: must not fire more often than hourly"


async def test_put_allows_an_exactly_hourly_cron(auth_client):
    r = await auth_client.put(SETTINGS, json=dict(VALID_BODY, price_refresh_cron="0 * * * *"))
    assert r.status_code == 200


async def test_put_rejects_numeric_day_of_week(auth_client):
    # APScheduler numbers days 0=Mon (not UNIX 0=Sun): numeric "1-5" silently means
    # Tue-Sat — the recorded prod mis-seed. Day NAMES only.
    r = await auth_client.put(SETTINGS, json=dict(VALID_BODY, price_refresh_cron="10 13 * * 1-5"))
    assert r.status_code == 422
    assert "day NAMES" in r.json()["detail"]
```

- [ ] **Step 2: Run, verify FAIL** (404s — no router):
  `backend/.venv/Scripts/python.exe -m pytest backend/tests/test_app_settings_api.py -q -W error`

- [ ] **Step 3: Implement the schema** (`backend/app/schemas/app_settings.py`):

```python
"""App-settings wire shapes. GET/PUT both speak EFFECTIVE values: what a reader would
actually use (fallbacks applied), never the raw envelope."""

from decimal import Decimal

from pydantic import BaseModel


class AppSettingsOut(BaseModel):
    swr_pct: Decimal
    espp_ticker: str | None
    price_refresh_cron: str


class AppSettingsUpdate(BaseModel):
    """Full-form PUT (the paycheck/espp whole-form law): all three settings every time."""

    swr_pct: Decimal
    espp_ticker: str | None = None
    price_refresh_cron: str
```

- [ ] **Step 4: Implement the router** (`backend/app/api/app_settings.py`). Import portfolio's
  existing ticker validator instead of minting one (check its actual name in
  `backend/app/api/portfolio.py` around `TICKER_RE`, line ~54 — the function that does
  `raw.strip().upper()` + `TICKER_RE.fullmatch` + raises 422; private-import precedent:
  espp imports `money._quantize_bounded`):

```python
"""App-settings vertical (spec §6 /settings). GET returns EFFECTIVE values via the same
readers the app uses; PUT is full-form and stores the readers' envelope {"value": ...}.

The cron guard is server-side (plan-4 forward note: '* * * * *' would hammer Yahoo):
parse with the scheduler's own CronTrigger, reject sub-hourly cadence and numeric
day-of-week (APScheduler numbers days 0=Mon — the recorded prod mis-seed). The scheduler
reads the cron ONCE at boot; this router only stores — the UI carries the restart note."""

from datetime import datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from apscheduler.triggers.cron import CronTrigger
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.api.portfolio import _validated_ticker  # adapt to the actual helper name
from app.models import AppSetting
from app.schemas.app_settings import AppSettingsOut, AppSettingsUpdate
from app.services.money import quantize_pct
from app.services.net_worth_calc import get_swr_pct
from app.services.scheduler import SCHEDULER_TIMEZONE, read_cron_setting

router = APIRouter(
    prefix="/settings", tags=["settings"], dependencies=[Depends(get_current_user)]
)

# Hourly is the floor: the scheduler exists for one post-close refresh (+ the spec's
# optional midday tick) — anything faster is a Yahoo-rate mistake, not a use case.
MIN_FIRE_GAP = timedelta(minutes=60)
# Fixed probe anchor (a Monday) keeps the guard deterministic; 8 successive fires is
# enough to catch multi-fire-per-hour shapes like "10,40 13 * * *".
_PROBE_ANCHOR = datetime(2026, 1, 5, tzinfo=ZoneInfo(SCHEDULER_TIMEZONE))
_PROBE_FIRES = 8


async def _read_espp_ticker(db: AsyncSession) -> str | None:
    # Mirrors the espp router's first hop (blank/absent/malformed -> unconfigured);
    # promote a shared reader if a third consumer ever appears.
    setting = await db.get(AppSetting, "espp_ticker")
    if setting is None or not isinstance(setting.value, dict):
        return None
    raw = setting.value.get("value")
    return raw if isinstance(raw, str) and raw.strip() else None


def _validated_swr(value: Decimal) -> Decimal:
    # get_swr_pct's fallback bounds as HARD validation: what the reader silently
    # discards, the writer refuses.
    if not value.is_finite() or value < 0 or value > 1:
        raise HTTPException(status_code=422, detail="swr_pct: must be a fraction between 0 and 1")
    return quantize_pct(value)


def _validated_cron(value: str) -> str:
    cron = value.strip()
    try:
        trigger = CronTrigger.from_crontab(cron, timezone=SCHEDULER_TIMEZONE)
    except ValueError:
        raise HTTPException(
            status_code=422,
            detail=(
                "price_refresh_cron: not a valid 5-field cron expression "
                "(e.g. '10 13 * * mon-fri')"
            ),
        ) from None
    day_of_week = cron.split()[4]
    if any(ch.isdigit() for ch in day_of_week):
        raise HTTPException(
            status_code=422,
            detail=(
                "price_refresh_cron: use day NAMES in the day-of-week field (e.g. mon-fri) "
                "— the scheduler numbers days 0=Mon, so numeric days are misread"
            ),
        )
    fires: list[datetime] = []
    prev: datetime | None = None
    now = _PROBE_ANCHOR
    for _ in range(_PROBE_FIRES):
        nxt = trigger.get_next_fire_time(prev, now)
        if nxt is None:
            break
        fires.append(nxt)
        prev, now = nxt, nxt
    for earlier, later in zip(fires, fires[1:]):
        if later - earlier < MIN_FIRE_GAP:
            raise HTTPException(
                status_code=422,
                detail="price_refresh_cron: must not fire more often than hourly",
            )
    return cron


@router.get("", response_model=AppSettingsOut)
async def get_settings(db: AsyncSession = Depends(get_db)) -> AppSettingsOut:
    return AppSettingsOut(
        swr_pct=await get_swr_pct(db),
        espp_ticker=await _read_espp_ticker(db),
        price_refresh_cron=await read_cron_setting(db),
    )


@router.put("", response_model=AppSettingsOut)
async def put_settings(
    body: AppSettingsUpdate, db: AsyncSession = Depends(get_db)
) -> AppSettingsOut:
    swr = _validated_swr(body.swr_pct)
    ticker = "" if body.espp_ticker is None or not body.espp_ticker.strip() else (
        _validated_ticker(body.espp_ticker)
    )
    cron = _validated_cron(body.price_refresh_cron)
    # Envelope {"value": ...} is the readers' convention (Plan 1 note). swr is stored as a
    # plain-notation STRING — get_swr_pct Decimal(str(raw))s it back losslessly, where a
    # float would round-trip through binary. Get-then-set on three rows is the accepted
    # single-user TOCTOU class (accounts/securities/taxes precedent).
    for key, value in (
        ("swr_pct", {"value": format(swr, "f")}),
        ("espp_ticker", {"value": ticker}),
        ("price_refresh_cron", {"value": cron}),
    ):
        setting = await db.get(AppSetting, key)
        if setting is None:
            db.add(AppSetting(key=key, value=value))
        else:
            setting.value = value
    await db.commit()
    return AppSettingsOut(swr_pct=swr, espp_ticker=ticker or None, price_refresh_cron=cron)
```
  (If portfolio's ticker helper 422s with a message naming its own field, that message is
  the shared vocabulary — keep it verbatim; the test asserts status only. If the helper is
  endpoint-coupled (e.g. takes a response object), extract NOTHING — inline the two lines
  `strip().upper()` + `TICKER_RE.fullmatch` with portfolio's exact detail string and note the
  duplication with a comment.)

- [ ] **Step 5: Mount the router.** In `backend/app/main.py`: add `app_settings` to the
  `from app.api import …` line (alphabetical position) and
  `app.include_router(app_settings.router, prefix="/api/v1")` after the `comp` include.

- [ ] **Step 6: Run the new suite, then all backend gates** (global rule 10). Watch for
  `-W error` fallout from APScheduler/zoneinfo inside the request path — if a
  DeprecationWarning surfaces, STOP and report (do not blanket-filter).

- [ ] **Step 7: Commit** `feat: app-settings API — effective GET, full-form PUT, cron guards`

---

### Task 3: Frontend plumbing — multipart client fix, wire types, settings/importer clients, deleteTaxYear [TDD]

**Context:** `src/api/client.ts` hard-codes `'Content-Type': 'application/json'` — a FormData
body must NOT get a manual content type (the browser sets `multipart/form-data` + boundary).
The import/settings endpoints exist server-side; this task gives the frontend typed access.

**Files:** Modify `src/api/client.ts`, `src/api/client.test.ts`, `src/types/api.ts`,
`src/api/taxes.ts`. Create `src/api/settings.ts`, `src/api/importer.ts`, `src/api/importer.test.ts`.

- [ ] **Step 1: Failing client tests.** In `src/api/client.test.ts` (match the file's existing
  `vi.stubGlobal('fetch', …)` idiom and helpers):

```ts
it('omits the JSON content type for FormData bodies', async () => {
  // fetch must receive NO Content-Type so the browser writes multipart + boundary itself
  const body = new FormData()
  await api('/import/xlsx?dry_run=true', { method: 'POST', body })
  const headers = fetchMock.mock.calls[0][1]!.headers as Record<string, string>
  expect('Content-Type' in headers).toBe(false)
  expect(headers.Authorization).toBeDefined() // auth still rides along (token stubbed in setup)
})

it('still sends JSON content type for plain bodies', async () => {
  await api('/settings', { method: 'PUT', body: JSON.stringify({}) })
  const headers = fetchMock.mock.calls[0][1]!.headers as Record<string, string>
  expect(headers['Content-Type']).toBe('application/json')
})
```

- [ ] **Step 2: Run `npm test -- src/api/client.test.ts`, verify the FormData test fails.**

- [ ] **Step 3: Fix `client.ts`** — replace the headers initializer only:

```ts
const headers: Record<string, string> = {
  // FormData bodies must NOT get a manual Content-Type: the browser writes
  // multipart/form-data with its boundary; a hand-set value breaks the upload.
  ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
  ...(options.headers as Record<string, string> | undefined),
}
```

- [ ] **Step 4: Wire types.** Append to `src/types/api.ts`:

```ts
// --- import (mirrors backend/app/importer/report.py) ---

export interface ImportEntityCounts {
  creates: number
  updates: number
  skips: number
  deletes: number
}

export interface ImportSheetReport {
  entities: Record<string, ImportEntityCounts>
  warnings: string[]
  errors: string[]
  samples: string[]
  samples_truncated: number
}

// sheets always carries all nine keys (report.SHEET_KEYS), even when a sheet is clean.
export interface ImportReport {
  dry_run: boolean
  applied: boolean
  sheets: Record<string, ImportSheetReport>
}

// --- app settings ---

export interface AppSettingsOut {
  swr_pct: string
  espp_ticker: string | null
  price_refresh_cron: string
}

export type AppSettingsUpdate = AppSettingsOut
```

- [ ] **Step 5: Clients.** Create `src/api/settings.ts`:

```ts
import type { AppSettingsOut, AppSettingsUpdate } from '../types/api'
import { api } from './client'

export function fetchAppSettings(): Promise<AppSettingsOut> {
  return api('/settings')
}

export function putAppSettings(body: AppSettingsUpdate): Promise<AppSettingsOut> {
  return api('/settings', { method: 'PUT', body: JSON.stringify(body) })
}
```

  Create `src/api/importer.ts`:

```ts
import type { ImportReport } from '../types/api'
import { api } from './client'

// Parsing + applying a whole workbook outruns the 15s default; 120s is the
// refreshPrices precedent. The File goes up on BOTH calls — dry-run and apply are
// stateless twins (the server keeps nothing between them; report.dry_run says which ran).
export function importXlsx(file: File, dryRun: boolean): Promise<ImportReport> {
  const body = new FormData()
  body.append('file', file)
  return api(`/import/xlsx?dry_run=${dryRun}`, {
    method: 'POST',
    body,
    signal: AbortSignal.timeout(120_000),
  })
}
```

  Append to `src/api/taxes.ts`:

```ts
export function deleteTaxYear(year: number): Promise<void> {
  return api(`/taxes/years/${year}`, { method: 'DELETE' })
}
```

- [ ] **Step 6: importer client test.** Create `src/api/importer.test.ts` — mock `./client`,
  assert `importXlsx(file, true)` calls `api` with path `/import/xlsx?dry_run=true`, a
  FormData body whose `get('file')` is the File, and a signal; and `dryRun=false` flips the
  query. (Type the mock like client.test.ts types its stubs — no `any`.)

- [ ] **Step 7: Run `npm test`, `npm run lint`, `npm run build`.** Expected: 209 + ~4 new pass,
  1 sanctioned warning, clean build.

- [ ] **Step 8: Commit** `feat: frontend plumbing — multipart-safe client, import/settings types+clients, deleteTaxYear`

---

### Task 4: TaxesPage delete-year affordance [TDD]

**Context:** the backend DELETE (Task 1) needs a UI door. TaxesPage already owns year chips,
a create-year form (third reload door), dirty-gates, and the seq-guard recipe — the delete
button is a fourth door whose `window.confirm` SUBSUMES the discard confirm (deleting is
strictly stronger than discarding; do not stack two confirms).

**Files:** Modify `src/pages/TaxesPage.tsx`, `src/pages/TaxesPage.test.tsx`.

- [ ] **Step 1: Failing tests** (extend the existing test file's mock setup — it already
  partial-mocks `../api/taxes`; add `deleteTaxYear: vi.fn()` to the mock):
  1. renders a "Delete year…" button, disabled when no year is selected;
  2. confirm-declined ⇒ `deleteTaxYear` NOT called;
  3. confirm-accepted ⇒ `deleteTaxYear(selectedYear)` called; on resolve the years list is
     refetched and the deleted year's chip disappears; the detail panel is gone (select
     prompt / empty state shows);
  4. rejection ⇒ error banner shows the ApiError message verbatim, chips remain.

- [ ] **Step 2: Run the file's tests, verify the new ones FAIL.**

- [ ] **Step 3: Implement.** In TaxesPage, next to the create-year form's submit button, add:

```tsx
<button
  type="button"
  className="button"
  disabled={selectedYear === null || busy || creating}
  onClick={deleteYear}
>
  Delete year…
</button>
```

  Handler (plain function, promise callbacks, seq-guarded like the create path; reuse the
  page's existing years-reload mechanics — the same path the create-year success takes, but
  clearing the selection instead of selecting):

```ts
const deleteYear = () => {
  if (selectedYear === null) return
  // One confirm, not two: deleting subsumes the dirty-discard question.
  const ok = window.confirm(
    `Delete tax year ${selectedYear} and all of its inputs and brackets? This cannot be undone.`,
  )
  if (!ok) return
  ...begin busy (the page's existing detail-busy flag) ...
  deleteTaxYear(selectedYear)
    .then(() => { /* seq-guard; clear selection + detail + dirty flags; reload years */ })
    .catch((err) => { /* seq-guard; error banner via the page's message idiom */ })
    .finally(() => { /* seq-guarded busy lift */ })
}
```
  Adapt state/handler names to the page's actual identifiers; keep the trend panel refresh
  consistent with what the create path does (a deleted year must also vanish from trends —
  the page already has a `trendRefresh` mechanism; bump it on success).

- [ ] **Step 4: Run `npm test`, lint, build.** All green (1 sanctioned warning).

- [ ] **Step 5: Commit** `feat: taxes delete-year affordance — confirm-gated fourth reload door`

---

### Task 5: SettingsPage — app-settings card + password card (route goes live) [TDD]

**Context:** `/settings` renders `PlaceholderPage` today. This task ships the page with two of
its three cards; Task 6 adds the import card. House law throughout: plain (non-`useCallback`)
load function + inline promise chain (memoization wall), seq-guard, `loading-dim`, error
banner + Retry, `.card-grid` with `.span-6` cards, percent boxes gated by `isPlainDecimal`.

**Files:** Create `src/pages/SettingsPage.tsx`, `src/pages/SettingsPage.css`,
`src/pages/SettingsPage.test.tsx`. Modify `src/App.tsx` (one line).

- [ ] **Step 1: Failing tests** (`SettingsPage.test.tsx`; partial-mock `../api/settings` and
  `../api/auth`; explicit `cleanup()`; no EChart on this page so no wrapper mock needed):
  1. mount fetches settings and renders: SWR box shows `"4.5"` for stored `"0.045000"`
     (shiftPoint +2, trailing zeros trimmed via `Number()` display), ticker `"NVDA"`, cron
     verbatim, plus the static restart note text;
  2. save PUTs the full body with SWR shifted back (`shiftPoint('4.5', -2)` = `"0.045"`),
     ticker uppercased client-side is NOT required (server normalizes — send as typed), cron
     as typed; success note appears: `Saved — cron changes apply after a backend restart.`;
  3. SWR box rejects exponent text (`"1e-3"`) with the inline message and NO PUT (the
     `isPlainDecimal` gate), and rejects `150` (out of 0–100) with NO PUT;
  4. PUT rejection renders the ApiError detail verbatim in the card's error slot;
  5. load failure renders the page error banner with Retry; Retry refetches;
  6. password form: mismatch of new/confirm shows inline error, NO request; success calls
     `changePassword(current, new)`, clears all three boxes, shows `Password changed.`;
     server 400 (wrong current) renders the detail verbatim;
  7. password + settings forms have their submit buttons disabled while their own request
     is in flight (independent busy flags).

- [ ] **Step 2: Run, verify FAIL** (module doesn't exist).

- [ ] **Step 3: Implement the page.** Structure (exact skeleton — fill in the obvious):

```tsx
import { useEffect, useRef, useState } from 'react'
import { changePassword } from '../api/auth'
import { ApiError } from '../api/client'
import { fetchAppSettings, putAppSettings } from '../api/settings'
import type { AppSettingsOut } from '../types/api'
import { isPlainDecimal, shiftPoint } from '../utils/percent'
import '../components/panels.css'
import './SettingsPage.css'

export default function SettingsPage() {
  // Load state (the house recipe: plain function, inline chain, seqRef)
  const [settings, setSettings] = useState<AppSettingsOut | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadedOnce, setLoadedOnce] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // App-settings form state (strings as displayed)
  const [swrPctBox, setSwrPctBox] = useState('')      // PERCENT text, e.g. "4.5"
  const [tickerBox, setTickerBox] = useState('')
  const [cronBox, setCronBox] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedNote, setSavedNote] = useState(false)
  // Password form state
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwError, setPwError] = useState<string | null>(null)
  const [pwBusy, setPwBusy] = useState(false)
  const [pwChanged, setPwChanged] = useState(false)
  const seqRef = useRef(0)

  // ~14 setters: the load chain stays a PLAIN function called from the mount effect and
  // Retry — a useCallback here trips preserve-manual-memoization (Plan 3 wall).
  const load = () => {
    const seq = ++seqRef.current
    fetchAppSettings()
      .then((s) => {
        if (seq !== seqRef.current) return
        setSettings(s)
        // Display percent: "0.045000" -> "4.5" (Number() strips trailing zeros; the box
        // round-trips through shiftPoint on save, so display-only Number is safe here).
        setSwrPctBox(String(Number(shiftPoint(s.swr_pct, 2))))
        setTickerBox(s.espp_ticker ?? '')
        setCronBox(s.price_refresh_cron)
        setError(null)
        setLoadedOnce(true)
      })
      .catch((err) => {
        if (seq !== seqRef.current) return
        setError(err instanceof ApiError ? err.message : 'Could not load settings.')
      })
      .finally(() => {
        if (seq === seqRef.current) setLoading(false)
      })
  }

  useEffect(() => {
    load()
    // mount-only: load is a plain function over stable setters (house idiom)
  }, [])
  …
}
```
  (Delete the joke reminder line — import nothing unused.) Retry button: `onClick={() => { setLoading(true); load() }}`.

  **App settings card** (`.card.span-6`): three labelled fields —
  - `Withdrawal rate (% / year)`: `.field-input`; save-time gate:
    `if (!isPlainDecimal(swrPctBox))` → `setFormError('Enter a plain decimal (no exponents).')`;
    `const n = Number(swrPctBox); if (!Number.isFinite(n) || n < 0 || n > 100)` →
    `setFormError('Must be between 0 and 100.')`; body value = `shiftPoint(swrPctBox, -2)`.
  - `ESPP ticker`: text input, empty ⇒ send `null` (clears; hint: "Blank = ESPP page shows
    'no ticker configured'.").
  - `Price refresh cron`: mono text input + static hint block (exact copy):
    `5-field cron, America/Los_Angeles, day NAMES (e.g. 10 13 * * mon-fri). Applies after a
    backend restart. Must not fire more often than hourly.`
  - Save button (`.button-primary`, disabled while `saving`): full-form
    `putAppSettings({ swr_pct, espp_ticker, price_refresh_cron })`; on success re-sync the
    boxes from the response (server-normalized values: quantized swr, uppercased ticker),
    `setSavedNote(true)`; on failure `setFormError(detail verbatim)`. Clear `savedNote` on
    any input change.

  **Password card** (`.card.span-6`): three `type="password"` inputs (autocomplete
  `current-password` / `new-password` / `new-password`); submit handler: mismatch →
  `setPwError('New passwords do not match.')`; else `changePassword(currentPw, newPw)` →
  clear boxes + `setPwChanged(true)`; catch → detail verbatim (the server's
  `Current password is incorrect` / min-length 422 speak for themselves). Static note:
  `Existing sessions stay signed in until their token expires (~24 h).`

  **CSS** (`SettingsPage.css`): page-local only — left-align override for text/password
  fields (`.settings-page .field-input { text-align: left; }` — the shared class is
  right-aligned monospace for numbers), a `.settings-form` single-column field stack
  (`display: grid; gap: .75rem; max-width: 420px`), `.settings-note { color: var(--muted);
  font-size: .85rem; }`. Wide elements use `grid-column: 1 / -1`, never `span 2` (Plan 5
  residual note).

- [ ] **Step 4: Swap the route.** In `src/App.tsx`: import SettingsPage, change
  `/settings` to `element={<SettingsPage />}`. (PlaceholderPage stays — the 404 route uses it.)

- [ ] **Step 5: `npm test`, lint, build** — all green.

- [ ] **Step 6: Commit** `feat: settings page — app-settings form with cron guard copy + password change`

---

### Task 6: SettingsPage import card — upload → dry-run diff → confirm-gated apply [TDD]

**Context:** `POST /api/v1/import/xlsx` exists since Plan 2 (multipart `file`, `dry_run`
query defaulting true, 413 >15 MB, 400 non-xlsx; report rolls back on dry-run). The card is
stateless-server: the SAME File object is uploaded for dry-run and again for apply.
CRITICAL COPY (Plan 2/5 forward notes): sheet-wins within imported years — taxes
inputs/brackets edited in the UI for sheet-covered years are clobbered by apply.

**Files:** Modify `src/pages/SettingsPage.tsx`, `src/pages/SettingsPage.test.tsx`. Create
`src/components/settings/ImportReportView.tsx`.

- [ ] **Step 1: Failing tests** (extend SettingsPage.test.tsx; mock `../api/importer`):
  1. choosing a file enables "Dry run"; "Apply import" stays disabled until a dry-run report
     with zero errors exists;
  2. Dry run calls `importXlsx(file, true)`; the report renders per-sheet entity counts
     (`+2 ~1 =3 −0` style), warnings, and the header `Dry run — nothing was written.`;
  3. a report with sheet errors renders them and keeps Apply DISABLED;
  4. re-picking a file clears any reports (they described the old file);
  5. Apply: confirm-declined ⇒ no call; confirm-accepted ⇒ `importXlsx(file, false)`, renders
     `Applied.` header and the note about pages refetching on next visit;
  6. a 413/400 ApiError renders its detail verbatim in the card's error slot.

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement `ImportReportView`** (`src/components/settings/ImportReportView.tsx`)
  — pure presentational, no fetching:

```tsx
import type { ImportReport, ImportSheetReport } from '../../types/api'
import '../panels.css'

// Backend report.SHEET_KEYS order — keep in sync (all nine keys are always present).
const SHEET_ORDER = [
  'reference_data', 'positions', 'portfolio', 'net_worth', 'spending',
  'taxes', 'espp', 'paycheck', 'focal_history',
] as const

const SHEET_LABELS: Record<string, string> = {
  reference_data: 'Reference data', positions: 'Positions', portfolio: 'Portfolio',
  net_worth: 'Net worth', spending: 'Spending', taxes: 'Taxes', espp: 'ESPP',
  paycheck: 'Paycheck', focal_history: 'Focal history',
}

function sheetHasContent(s: ImportSheetReport): boolean {
  return (
    Object.keys(s.entities).length > 0 ||
    s.warnings.length > 0 || s.errors.length > 0 || s.samples.length > 0
  )
}

export default function ImportReportView({ report }: { report: ImportReport }) {
  return (
    <div className="import-report">
      <p className="settings-note" role="status">
        {report.applied ? 'Applied.' : 'Dry run — nothing was written.'}
      </p>
      {SHEET_ORDER.filter((k) => report.sheets[k] && sheetHasContent(report.sheets[k])).map(
        (key) => {
          const sheet = report.sheets[key]
          return (
            <section key={key} className="import-sheet">
              <h3 className="eyebrow">{SHEET_LABELS[key] ?? key}</h3>
              {Object.keys(sheet.entities).length > 0 && (
                <table className="data-table">
                  <tbody>
                    {Object.entries(sheet.entities).map(([entity, c]) => (
                      <tr key={entity}>
                        <td>{entity}</td>
                        <td className="num">+{c.creates}</td>
                        <td className="num">~{c.updates}</td>
                        <td className="num">={c.skips}</td>
                        <td className="num">−{c.deletes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {sheet.errors.map((e, i) => (
                <p key={`e${i}`} className="import-error">ERROR: {e}</p>
              ))}
              {sheet.warnings.map((w, i) => (
                <p key={`w${i}`} className="settings-note">WARN: {w}</p>
              ))}
              {sheet.samples.length > 0 && (
                <details>
                  <summary>{sheet.samples.length} sample changes
                    {sheet.samples_truncated > 0 ? ` (+${sheet.samples_truncated} more)` : ''}
                  </summary>
                  <ul>{sheet.samples.map((s, i) => <li key={i}>{s}</li>)}</ul>
                </details>
              )}
            </section>
          )
        },
      )}
    </div>
  )
}
```

- [ ] **Step 4: The card** (third card in SettingsPage, `.card.span-12`): state
  `file: File | null`, `report: ImportReport | null`, `importBusy: 'dry' | 'apply' | null`,
  `importError: string | null`. File input `accept=".xlsx"`; onChange sets the file and
  CLEARS report+error (a report describes exactly one file). Buttons:

```tsx
const reportHasErrors =
  report !== null && Object.values(report.sheets).some((s) => s.errors.length > 0)
// Apply is armed only by a clean DRY-RUN of the currently chosen file (a fresh pick
// clears `report`; an applied report re-arms nothing — dry-run again to re-apply).
const canApply =
  file !== null && report !== null && report.dry_run && !reportHasErrors && importBusy === null
```
  Dry-run: `importXlsx(file, true)` → `setReport`. Apply: confirm gate with the EXACT copy —

```ts
const ok = window.confirm(
  'Apply this workbook to the live database? Sheet values overwrite imported rows — ' +
    'taxes inputs and brackets you edited in the UI for sheet-covered years WILL be ' +
    'reset to the sheet. This cannot be undone.',
)
```
  → `importXlsx(file, false)` → `setReport(applied)` + note under it:
  `Other pages load the new data on their next visit.` Errors: `err instanceof ApiError ?
  err.message : 'Import failed — is the server reachable?'` into `importError` (renders in
  an `.error-banner` in the card). Both requests share the one `importBusy` flag (buttons
  disabled while either runs). Add `.import-error { color: var(--negative); }` +
  `.import-sheet { margin-top: .75rem; }` to SettingsPage.css.

- [ ] **Step 5: `npm test`, lint, build** — all green.

- [ ] **Step 6: Commit** `feat: settings import card — dry-run diff preview, clobber-warned apply`

---

### Task 7: Pure chart builders + shared helpers (allocation lift, overview options, staleness) [TDD]

**Context:** Overview needs a donut, spend bars, and a net-worth sparkline. The donut builder
exists but is module-PRIVATE in `AllocationPanel.tsx` — lift it (with `treemapOption`,
`positiveSlices`, `TYPE_LABELS`) into `src/components/portfolio/allocationChartOptions.ts`
verbatim (the `taxChartOptions.ts` precedent; buys pure tests). Same move for HoldingsTable's
private `isStale` → `src/utils/staleness.ts` (single-copy law, percent.ts precedent). New
overview builders live in `src/components/overview/overviewChartOptions.ts` with the
tile-stat helpers. NO page yet — this task is entirely pure functions + tests.

**Files:** Create `src/components/portfolio/allocationChartOptions.ts` (+`.test.ts`),
`src/utils/staleness.ts` (+`.test.ts`), `src/components/overview/overviewChartOptions.ts`
(+`.test.ts`). Modify `src/components/portfolio/AllocationPanel.tsx`,
`src/components/portfolio/HoldingsTable.tsx` (imports only — behavior pinned by their
existing tests).

- [ ] **Step 1: The lifts (mechanical, verbatim).**
  - Move `TYPE_LABELS`, `positiveSlices`, `treemapOption`, `donutOption` from
    `AllocationPanel.tsx` into `allocationChartOptions.ts` UNCHANGED (exported); the panel
    imports them; its rendering and useMemo guards stay byte-identical. The moved file
    imports the same theme tokens/format utils the panel did.
  - Move HoldingsTable's `STALE_AFTER_DAYS` + `isStale` body into `staleness.ts` as:

```ts
// Single copy (percent.ts precedent). quoted_at is the BAR date (UTC midnight) — compare
// DATES, not instants, or a Friday bar reads stale on Monday evening (Plan 4 note).
export const STALE_AFTER_DAYS = 4

export function isStaleQuote(quotedAt: string | null, today: Date = new Date()): boolean {
  …HoldingsTable's exact comparison, with `today` injectable for tests…
}
```
    HoldingsTable imports `isStaleQuote` (keep its call sites' behavior identical — its 6
    existing tests are the pin; if its private version took no `today` param, the default
    argument preserves the call shape).

- [ ] **Step 2: Run `npm test` — the moved code must pass the EXISTING suites unchanged**
  (AllocationPanel has no direct tests; HoldingsTable's 6 must stay green; build+lint clean).
  Commit `refactor: lift allocation builders + quote staleness into shared modules`

- [ ] **Step 3: Failing tests for the new pure modules.**
  `allocationChartOptions.test.ts` (~6, import real theme tokens like taxChartOptions.test):
  top-3 slices wear `PALETTE[0..2]`; 4th+ fold into one `Other` slice colored
  `OTHER_SERIES_COLOR` with summed value; negative-MV slices filtered; `TYPE_LABELS` applied
  when `labels=true`; donut tooltip formatter escapes HTML (`<b>` in a key comes back
  `&lt;b&gt;`); treemap label color flips at ramp index 6 (`SURFACE` above, `INK` below).
  `staleness.test.ts` (~4): null → false; bar date 2 days back → false; 5 days back → true;
  the Friday-bar-on-Monday case (bar Fri, today Mon) → false.
  `overviewChartOptions.test.ts` (~14): each builder's series/colors/categories +
  `null` empties; helper semantics below pinned exactly.

- [ ] **Step 4: Implement `overviewChartOptions.ts`:**

```ts
import type { EChartsOption } from '../../charts/echarts'
import { PALETTE, SURFACE } from '../../charts/theme'
import type { NetWorthTimeseries, SpendingMatrix, TaxSummaryOut } from '../../types/api'
import { formatCurrency, formatCurrencyCompact, formatMonth } from '../../utils/format'

// Axis-free trend (Sparkline.tsx's sanctioned form, but echarts — the page already ships
// the runtime for the donut/bars): tooltip stays, axes hide.
export function netWorthSparkOption(
  ts: Pick<NetWorthTimeseries, 'months' | 'net_worth'>,
): EChartsOption | null {
  if (ts.months.length < 2) return null
  return {
    grid: { left: 8, right: 8, top: 10, bottom: 8 },
    xAxis: { type: 'category', data: ts.months.map(formatMonth), show: false, boundaryGap: false },
    yAxis: { type: 'value', show: false, scale: true },
    tooltip: { trigger: 'axis', valueFormatter: (v) => formatCurrency(v as number) },
    series: [
      {
        type: 'line',
        name: 'Net worth',
        symbol: 'none',
        lineStyle: { width: 1.5 },
        areaStyle: { opacity: 0.22 },
        color: PALETTE[0],
        data: ts.net_worth.map(Number),
      },
    ],
  }
}

export function recentSpendOption(
  matrix: Pick<SpendingMatrix, 'months' | 'totals'>,
  months = 12,
): EChartsOption | null {
  if (matrix.months.length === 0) return null
  const start = Math.max(0, matrix.months.length - months)
  return {
    grid: { left: 70, right: 16, top: 24, bottom: 28 },
    xAxis: { type: 'category', data: matrix.months.slice(start).map(formatMonth) },
    yAxis: { type: 'value', axisLabel: { formatter: (v: number) => formatCurrencyCompact(v) } },
    tooltip: { trigger: 'axis', valueFormatter: (v) => formatCurrency(v as number) },
    series: [
      {
        type: 'bar',
        name: 'Spend',
        barMaxWidth: 22,
        color: PALETTE[1],
        itemStyle: { borderColor: SURFACE, borderWidth: 1 },
        data: matrix.totals.slice(start).map(Number),
      },
    ],
  }
}

export interface SpendStats {
  month: string | null // ISO first-of-month of the tile month (latest month with data)
  total: string | null // that month's server-computed total, verbatim
  avg12: number | null // mean of up to 12 totals STRICTLY BEFORE the tile month
  aboveAvg: boolean | null
}

// Presentation stats over server totals (SpendingPage's categoryTotals class) — the tile
// month is the LATEST month present (hand-entered app: the current calendar month is
// absent until the wizard runs; the tile label carries the month so it reads honestly).
export function spendStats(matrix: Pick<SpendingMatrix, 'months' | 'totals'>): SpendStats {
  if (matrix.months.length === 0) return { month: null, total: null, avg12: null, aboveAvg: null }
  const idx = matrix.months.length - 1
  const prior = matrix.totals.slice(Math.max(0, idx - 12), idx).map(Number)
  const avg12 = prior.length > 0 ? prior.reduce((a, b) => a + b, 0) / prior.length : null
  const total = matrix.totals[idx]
  return {
    month: matrix.months[idx],
    total,
    avg12,
    aboveAvg: avg12 === null ? null : Number(total) > avg12,
  }
}

// Current calendar year if it has a summary, else the latest PAST year (label carries
// the year either way); server orders years ascending (taxes.py).
export function pickTaxSummary(
  years: TaxSummaryOut[],
  currentYear: number,
): TaxSummaryOut | null {
  if (years.length === 0) return null
  const current = years.find((y) => y.year === currentYear)
  if (current) return current
  const past = years.filter((y) => y.year < currentYear)
  return past.length > 0 ? past[past.length - 1] : years[years.length - 1]
}
```
  Helper test pins (exact): `spendStats` with 14 months uses months[13] as tile month and
  means months[1..12]; with 1 month → `avg12 null`; `aboveAvg` flips at the mean.
  `pickTaxSummary([2023,2024], 2026)` → 2024; `([2023,2027], 2026)` → 2023;
  `([2027], 2026)` → 2027; `([], …)` → null. Builders: slice window = last 12 months;
  spark null under 2 months.

- [ ] **Step 5: `npm test`, lint, build. Commit**
  `feat: overview chart builders + spend/tax tile helpers (pure, tested)`

---

### Task 8: OverviewPage — tiles, charts, freshness (the `/` route goes live) [TDD]

**Context:** the last data page. ONE `Promise.all` over six existing clients, ONE payload
object (all-or-nothing render, keep-previous on reload failure with the stale cue —
EsppPage class), plain load function (memoization wall), seq-guarded. Every number on the
page is a server value rendered verbatim or a Task-7 helper output.

**Files:** Create `src/pages/OverviewPage.tsx`, `src/pages/OverviewPage.css`,
`src/pages/OverviewPage.test.tsx`. Modify `src/App.tsx` (one line).

- [ ] **Step 1: Failing tests** (mock the SIX api modules partially + the EChart wrapper with
  the house async factory; fixtures with realistic decimal strings):
  1. renders four tiles from fixtures: hero `Net worth — Aug 2026` with `$1,234,567.00` and
     MoM delta `+$10,000.00 (+0.8%) MoM` tone positive; portfolio tile with day delta and
     tone negative when `day_change_amount` is negative; spending tile labeled with the tile
     month and `vs $X 12-mo avg` delta, tone NEGATIVE when above average (spending up = bad);
     effective-tax tile `Effective tax — 2026 (est.)` showing `formatPct` of
     `totals.effective_rate`, and the `(latest)` suffix when the picked year < current;
  2. charts receive data: the EChart mock's `data-categories` carries formatted months for
     spark + bars; donut present (mock renders three echarts total);
  3. freshness row: `Prices as of <formatDate>` (+ `.stale` class when `as_of` is 5+ days
     old — inject via the holdings fixture), `Net worth through Aug 2026`,
     `Spending through Jul 2026`;
  4. empty DB (all-null summary, empty arrays) → tiles render `—`, each chart slot shows its
     `.empty-note`, no crash;
  5. first-load failure → error banner + Retry (refetches all six); reload failure with data
     on screen → banner gains ` — the page may be showing earlier data.` and tiles persist;
  6. missing tax years (`years: []`) → tax tile value `—` and no year suffix crash.

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement.** Skeleton:

```tsx
import { useEffect, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { ApiError } from '../api/client'
import { fetchSummary, fetchTimeseries } from '../api/netWorth'
import { fetchAllocation, fetchHoldings } from '../api/portfolio'
import { fetchMatrix } from '../api/spending'
import { fetchAllTaxSummaries } from '../api/taxes'
import EChart from '../components/EChart'
import StatTile from '../components/StatTile'
import {
  donutOption, positiveSlices,
} from '../components/portfolio/allocationChartOptions'
import {
  netWorthSparkOption, pickTaxSummary, recentSpendOption, spendStats,
} from '../components/overview/overviewChartOptions'
import type {
  AllocationResponse, HoldingsResponse, NetWorthSummary, NetWorthTimeseries,
  SpendingMatrix, TaxSummariesOut,
} from '../types/api'
import { formatCurrency, formatDate, formatMonth, formatPct } from '../utils/format'
import { isStaleQuote } from '../utils/staleness'
import '../components/panels.css'
import './OverviewPage.css'

interface OverviewData {
  summary: NetWorthSummary
  ts: NetWorthTimeseries
  holdings: HoldingsResponse
  allocation: AllocationResponse
  matrix: SpendingMatrix
  taxes: TaxSummariesOut
}

export default function OverviewPage() {
  const [data, setData] = useState<OverviewData | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const seqRef = useRef(0)

  // Plain function + inline chain (preserve-manual-memoization wall — Plan 3/5 notes).
  // Promise.all is deliberate: the page renders one coherent snapshot; a partial refresh
  // would let tiles disagree with charts. Keep-previous on failure (EsppPage class).
  const load = () => {
    const seq = ++seqRef.current
    Promise.all([
      fetchSummary(), fetchTimeseries('monthly'), fetchHoldings(),
      fetchAllocation('type'), fetchMatrix(), fetchAllTaxSummaries(),
    ])
      .then(([summary, ts, holdings, allocation, matrix, taxes]) => {
        if (seq !== seqRef.current) return
        setData({ summary, ts, holdings, allocation, matrix, taxes })
        setError(null)
      })
      .catch((err) => {
        if (seq !== seqRef.current) return
        setError(err instanceof ApiError ? err.message : 'Could not load the overview.')
      })
      .finally(() => {
        if (seq === seqRef.current) setBusy(false)
      })
  }

  useEffect(() => {
    load()
  }, [])
  …
}
```
  Derivations (`useMemo` ONLY around echarts options; plain consts elsewhere):
  `const spark = useMemo(() => (data ? netWorthSparkOption(data.ts) : null), [data])`;
  same for `donut` (guard `positiveSlices(data.allocation).length > 0`, `labels=true`) and
  `bars`. Tiles (inside `<div className="kpi-row">`, values via `formatCurrency` etc., `—`
  when null — `formatCurrency` already does that):

```tsx
<StatTile
  hero
  label={data?.summary.month ? `Net worth — ${formatMonth(data.summary.month)}` : 'Net worth'}
  value={formatCurrency(data?.summary.net_worth)}
  delta={
    data?.summary.mom_delta != null
      ? `${formatCurrency(data.summary.mom_delta)} (${formatPct(data.summary.mom_pct)}) MoM`
      : undefined
  }
  tone={toneOf(data?.summary.mom_delta)}
/>
```
  with `const toneOf = (v: string | null | undefined) => v == null ? 'neutral' : Number(v) < 0 ? 'negative' : 'positive'`
  (module-level pure). Portfolio tile: `totals.market_value`, delta from
  `totals.day_change_amount`/`day_change_pct` + suffix `today` (omit delta when null —
  pre-first-refresh state). Spending tile: `spendStats(data.matrix)` → label
  `Spending — ${formatMonth(stats.month)}`, value `formatCurrency(stats.total)`, delta
  `vs ${formatCurrency(stats.avg12)} 12-mo avg`, tone `aboveAvg ? 'negative' : 'positive'`
  (null-safe). Tax tile: `pickTaxSummary(data.taxes.years, new Date().getFullYear())` →
  label `Effective tax — ${year}${year < currentYear ? ' (latest)' : ' (est.)'}`, value
  `formatPct(picked.totals.effective_rate, { signed: false })` or `—`.

  Charts grid (`.card-grid`): spark card `.span-8` (`<h2 className="panel-title">Net worth
  trend</h2>` + `<NavLink className="drill-hint" to="/net-worth">Open net worth →</NavLink>`,
  `<EChart option={spark} height={220} />` or `.empty-note` `No snapshots yet.`); donut card
  `.span-4` (`Allocation by type`, link `/portfolio`, height 260, empty
  `No priced holdings yet.`); bars card `.span-12` (`Recent spending`, link `/spending`,
  height 240, empty `No spending months yet.`).

  Freshness row (bottom, `.overview-freshness`, muted `·`-separated spans):
  `Prices as of {formatDate(as_of)}` wrapped in
  `<span className={isStaleQuote(as_of) ? 'freshness stale' : 'freshness'}>` (or
  `prices never refreshed` when null) · `Net worth through {formatMonth(summary.month)}`
  (or `no snapshots`) · `Spending through {formatMonth(stats.month)}` (or `no months`).
  CSS: `.overview-freshness { color: var(--muted); font-size: .85rem; display: flex;
  gap: .5rem; flex-wrap: wrap; } .overview-freshness .stale { color: #c98500; }` (the
  HoldingsTable amber precedent — `PALETTE[3]`, already used for staleness).

  Error banner + Retry at top (house markup); body wrapped in
  `<div className={`loading-dim${busy ? ' is-loading' : ''}`}>`; stale cue appended to the
  banner when `data !== null`. First-load-failed: banner only (PortfolioPage posture — no
  page of empty zeros that reads as "you're broke"): render tiles/charts only when
  `data !== null || loadedOnce === false`… simpler and exact: render the body only when
  `data !== null`; show `.empty-note` "Loading…" pre-first-payload (busy true), banner alone
  after a failed first load.

- [ ] **Step 4: Swap the route** in `src/App.tsx`:
  `<Route path="/" element={<OverviewPage />} />` (import it).

- [ ] **Step 5: `npm test`, lint, build. Commit**
  `feat: overview page — six-fetch snapshot, tiles, spark/donut/bars, freshness row`

---

### Task 9: Route-level code-splitting [TDD-adjacent — the build output is the test]

**Context:** one 1,034.68 kB chunk because App.tsx statically imports all ten pages. Only 5
pages pull the echarts runtime (NetWorth, Spending, Comp, Portfolio, Taxes) + now Overview.
`React.lazy` every protected page; Login + PlaceholderPage stay eager (first paint / 404).
`BrowserRouter` + `<Routes>` (NOT a data router) ⇒ `Suspense` goes around the Layout
`<Outlet />` so the sidebar persists while a page chunk loads.

**Files:** Modify `src/App.tsx`, `src/components/Layout.tsx`, possibly `vite.config.ts`.

- [ ] **Step 1: Rewrite `src/App.tsx`:**

```tsx
import { lazy } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import { AuthProvider } from './contexts/AuthContext'
import LoginPage from './pages/LoginPage'
import PlaceholderPage from './pages/PlaceholderPage'

// Route-level splitting (Plans 3-5 deferred it here): echarts + each page leave the entry
// chunk; Login and the 404 placeholder stay eager (first paint must not wait on a chunk).
const OverviewPage = lazy(() => import('./pages/OverviewPage'))
const MonthlyUpdatePage = lazy(() => import('./pages/MonthlyUpdatePage'))
const NetWorthPage = lazy(() => import('./pages/NetWorthPage'))
const SpendingPage = lazy(() => import('./pages/SpendingPage'))
const PortfolioPage = lazy(() => import('./pages/PortfolioPage'))
const TaxesPage = lazy(() => import('./pages/TaxesPage'))
const EsppPage = lazy(() => import('./pages/EsppPage'))
const PaycheckPage = lazy(() => import('./pages/PaycheckPage'))
const CompPage = lazy(() => import('./pages/CompPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
```
  (routes unchanged otherwise — same tree, same paths.)

- [ ] **Step 2: Suspense in Layout.** In `src/components/Layout.tsx`:

```tsx
import { Suspense } from 'react'
…
<main className="content">
  {/* Route chunks resolve here — the sidebar must not unmount while one loads. */}
  <Suspense fallback={<p className="empty-note">Loading…</p>}>
    <Outlet />
  </Suspense>
</main>
```

- [ ] **Step 3: Build and READ the output.** `npm run build` — record every
  `dist/assets/*.js` size (raw + gzip). Expected shape: entry ≈ 250–330 kB raw
  (react-dom + router + shell), a shared echarts chunk ≈ 450–560 kB raw loaded only on
  chart routes, small per-page chunks. THE 500 kB WARNING: if (and only if) the echarts
  chunk still trips it, add to `vite.config.ts`:

```ts
build: {
  // The echarts subset is one indivisible lazy chunk (~5xx kB raw / ~16x kB gzip) —
  // raising the advisory limit documents that it is deliberate, not forgotten.
  chunkSizeWarningLimit: 620,
},
```

- [ ] **Step 4: `npm test` + lint** — page tests import pages directly (lazy wrappers don't
  affect them); expect zero fallout. If any test renders `<App />` (none exist today), it
  would need Suspense-aware `findBy*` — note if added.

- [ ] **Step 5: Commit** `perf: route-level code-splitting — lazy pages, Suspense in layout`
  with the full before/after chunk listing in the commit body.

---

### Task 10: Controller-run verification against the REAL dev stack (read-only)

**Controller executes this personally — no subagent.** Rules: dev DB reads only; the ONE
write-shaped call is the import DRY-RUN (server rolls back; `applied: false` is the proof).
Nothing here lands in committed artifacts except the summary table in this doc (no workbook
path).

- [ ] **Step 1:** `docker exec finance-dashboard-db-1 psql -U finance -d finance -tAc "SELECT 1"`;
  start the backend from the worktree:
  `cd backend && .venv/Scripts/python.exe -m uvicorn app.main:app --port 8000` (background),
  health-check `curl -s http://127.0.0.1:8000/api/v1/health`.
- [ ] **Step 2:** login via curl (credentials from `backend/.env`, never echoed into this
  doc), then GET and sanity-eyeball: `/net-worth/summary` (month + net_worth present),
  `/net-worth/timeseries` (37+ months), `/portfolio/holdings` (`as_of`, totals present),
  `/portfolio/allocation?by=type`, `/spending/matrix` (months through 2026), `/taxes/summary`
  (years 2023–2026), and the NEW `/settings` (effective trio: 0.04 / NVDA / the day-name cron).
- [ ] **Step 3:** real-workbook dry-run through the NEW upload path:
  `curl -s -X POST http://127.0.0.1:8000/api/v1/import/xlsx?dry_run=true -H "Authorization: Bearer <token>" -F "file=@<path-to-workbook>"`
  → expect `applied: false`, zero sheet errors, and a mostly-`=skips`/`~updates` diff
  (UI-edited rows may show as updates — that IS the clobber warning made visible). If the
  workbook isn't at its recorded location, SKIP and note it — do not go looking.
- [ ] **Step 4:** shut the backend down (`taskkill` the listening PID + uvicorn wrapper —
  Plan 2 machine note), record results in the execution-status section of this doc.
  NO commit unless the doc changed.

**Task 10 RESULTS (controller-run 2026-08-17, worktree backend @ ad389b8 against the real
dev DB, read-only):**
- Backend up on :8000 (worktree venv uvicorn, dev-default config — no .env in either
  checkout; the dev DB user is the dev-default admin). Health OK; clean shutdown after,
  zero orphan processes.
- `GET /settings` (NEW): effective trio exactly as designed — swr `0.04`, ticker `NVDA`,
  cron `10 13 * * mon-fri`. No writes issued (PUT covered by the 18-test suite only).
- Overview source endpoints, all 200 on real data: net-worth summary (latest month
  2026-09-01, net worth ~$799.4k, MoM +5.5%); timeseries 37 months; holdings totals
  complete with `as_of` 2026-08-14 (Fri bar, 3 days back → correctly NOT stale under the
  4-day date-only rule); allocation `by=type` = exactly 3 slices (etf/mutual_fund/stock —
  the Overview donut gets 3 identity hues, no Other fold on today's data); spending
  matrix months end 2025-12 (no 2026 wizard entries yet → the Overview spending tile
  reads "Spending — Dec 2025", honestly labeled); tax summaries years 2023–2026 → tax
  tile picks 2026 "(est.)". Tile parity with module pages holds by construction (same
  GETs).
- **Real-workbook dry-run through the NEW upload path** (`POST /import/xlsx?dry_run=true`,
  multipart, workbook at its Plan-2-recorded location): **HTTP 200 in 0.66 s,
  `dry_run:true, applied:false`, ZERO sheet errors, and every one of the 17 entity
  classes is 100 % skips — 1,982 rows identical, 0 creates / 0 updates / 0 deletes.**
  Full idempotency of DB-vs-sheet proven end-to-end through the endpoint the settings
  page now drives; the ZI deactivation and all Plan 4/5 UI edits live outside importer
  diff-fields, exactly as the forward notes predicted.
- Not exercised against the dev DB (by rule 13): settings PUT, taxes DELETE, import
  apply — all covered by the test suites against `finance_test`.

---

### Task 11: Cutover runbook — README Part 7 (+ Part 4 addendum)

**Context:** README Parts 0–6 already cover provisioning → deploy → updates → backups →
domain. The gap (backend research, 2026-08-17): nothing documents the production DATA path —
workbook import, the five-slug `is_component` UPDATE, the first price refresh, ZI hygiene,
the NW identity check, parallel-run, sheet retirement. All commands below were verified
against Plans 2–5's execution records; the five-slug UPDATE is copied verbatim from the
Plan 3 migration.

**Files:** Modify `README.md`.

- [ ] **Step 1: Part 4 addendum** (after the existing update flow): a short "Scheduler &
  settings" note — `price_refresh_cron` is read ONCE at backend boot; after changing it in
  /settings, restart: `docker compose -f docker-compose.prod.yml restart backend`. Plus the
  migration-history warning: never re-chain a deployed Alembic revision (the C1 outage
  class); `alembic stamp` surgery is the recovery of last resort.

- [ ] **Step 2: Write "Part 7 — Production data: import, verification & cutover".** Sections
  (exact commands; placeholders in `<angle brackets>`; NEVER a real local path):

  **7.1 When you need this.** Fresh prod DB (disaster recovery / re-provision) or a
  deliberate re-import. The live prod DB (imported 2026-08-13, Plans 1–5 deployed) does NOT
  need 7.2–7.5 — skip to 7.6 for routine deploys, 7.7 for cutover.

  **7.2 Import the workbook.** Two equivalent paths, same code: the /settings import card
  (dry-run → review the diff → Apply; 15 MB app cap, 20 MB nginx cap), or the CLI on the box:
  ```bash
  docker compose -f docker-compose.prod.yml exec backend python -m app.importer /path/on/box.xlsx --dry-run
  docker compose -f docker-compose.prod.yml exec backend python -m app.importer /path/on/box.xlsx
  ```
  (CLI applies BY DEFAULT; `--dry-run` is opt-in — inverted vs the HTTP default. Exit codes
  0/1/2 = ok / report errors, nothing applied / unreadable file.)
  **ORDER LAW: import FIRST, then edit in the UI.** Taxes re-import is sheet-wins within
  imported years: UI edits to sheet-covered years are clobbered by any later apply.

  **7.3 Re-flag the five component accounts (fresh DB only).** The Plan 3 migration backfill
  no-ops on an empty DB and the importer always creates accounts with `is_component = FALSE`
  — net worth silently DOUBLE-COUNTS the five 401(k) source buckets until:
  ```bash
  sudo -u postgres psql -d finance -c "UPDATE accounts SET is_component = TRUE WHERE slug IN ('employer-match-401-k','reverse-rollover-401-k','traditional-401-k','roth-basic-401-k','after-tax-401-k')"
  sudo -u postgres psql -d finance -tAc "SELECT slug FROM accounts WHERE is_component ORDER BY sort_order"
  ```
  (expect exactly those five slugs; adjust the psql invocation to the host's postgres user.)
  Note: dashboard NW intentionally = sheet NW − After-Tax 401(k) (the sheet double-counts
  it; verified at all 37 snapshots). One `PATCH /net-worth/accounts/{id}`
  `{"is_component": false}` on `after-tax-401-k` reproduces the sheet exactly if ever
  preferred.

  **7.4 First price refresh + ZI hygiene.** Trigger from /portfolio ("Refresh prices") or
  `POST /api/v1/prices/refresh`. Expect ~36 updated; ZI (ZoomInfo, delisted) fails with "no
  data returned" until deactivated: PATCH `is_active: false` via the securities panel.
  Until the first refresh, `annual_income`/yield/YOC show the sheet's broken GOOGLEFINANCE
  leftovers — expected, not a bug.

  **7.5 Verify before trusting.** NW identity: /net-worth totals vs the sheet's NET WORTH
  row (expect equal after 7.3, minus the After-Tax component by design). Taxes: /taxes 2024
  matches the sheet to the cent; 2023/2025/2026 differ by the FOUR KNOWN drifts (D1
  −31.20 / D2 +405.50 & +117.85 / D3 +4,918.92/93 at cents — the sheet's columns are
  internally inconsistent; the app is the self-consistent model. DO NOT "fix" these).
  Holdings: cost bases match within ~$0.10/row (6dp-share × 4dp-price folding).

  **7.6 Routine deploy (this push).** Plans 5+6 contain ZERO migrations (head stays
  `e5b93d0a416f`) — order-safe: `git pull && docker compose -f docker-compose.prod.yml up -d --build`,
  then verify `/api/v1/health`, log in, spot-check `/`, `/taxes`, `/settings`. The backend
  restart re-reads the cron (a restart spanning 13:10 PT skips that day's refresh — the
  manual button recovers).

  **7.7 Parallel-run & retiring the sheet.** ≥1 full monthly cycle (spec §10 phase 11):
  do the month-end ritual in BOTH systems (/update wizard + the sheet); compare NW summary,
  spending totals, holdings MV, and (if a tax year changed) the /taxes summary — with the
  7.5 caveats. One clean cycle ⇒ stop updating the sheet; keep it as a frozen archive
  (the importer remains able to re-consume it). Pre-retirement security checklist: revoke
  the read-only GitHub PAT embedded in any clone remote and re-point origin
  (`git remote set-url origin https://github.com/<owner>/personal-finance-dashboard.git`);
  optionally rotate prod `.env` secrets; confirm the nightly backup cron ran within 24 h and
  do one restore drill (Part 5.5).

- [ ] **Step 3: Verify formatting** (markdown renders, commands copy-paste clean),
  `npm run lint` untouched-by-this-task sanity not needed — README only.
  Commit `docs: Part 7 production import & cutover runbook + scheduler/migration addenda`

---

### Task 12: Final gates + execution status + post-roadmap notes + DoD audit

- [ ] **Step 1:** full gates in the worktree (global rule 10, ALL of them) + record the final
  bundle chunk listing. `git log --oneline main..HEAD` sanity: linear, conventional.
- [ ] **Step 2:** controller dispatches the FINAL whole-branch code review (Opus 5) over
  `main..HEAD`; fold findings (fix or document) before closing.
- [ ] **Step 3:** append to this doc: execution-status table (task → commits → review
  rounds), Task 10 results, "Post-roadmap notes (v2 candidates + residuals)" — carry forward
  every deferral from "Sanctioned deviations & deferrals" plus anything execution adds —
  and the Definition-of-done audit. Final commit
  `docs: Plan 6 final gates + post-roadmap notes + DoD audit`.

---

## Definition of done (Plan 6)

- `pytest -q -W error` green in the worktree (518 baseline + Tasks 1–2 suites); `ruff check`
  + `ruff format --check` clean; `alembic check` clean, single head `e5b93d0a416f`, ZERO new
  migration files.
- `npm test` green (209 baseline + new suites), `npm run lint` (exactly 1 sanctioned
  warning), `npm run build` clean with the recorded post-split chunk shape (entry no longer
  carries echarts; no unexplained >500 kB chunk).
- `/` and `/settings` placeholders GONE (PlaceholderPage remains only on the 404 route);
  Overview renders the same numbers the module endpoints serve (verified on real data,
  Task 10); settings PUT round-trips; cron guard rejects sub-hourly + numeric-DOW; password
  change and import dry-run/apply work end-to-end (tests + Task 10 real dry-run).
- `DELETE /taxes/years/{year}` shipped with UI affordance; empty-PUT-creates pin intact.
- README Part 7 exists with the verbatim five-slug UPDATE; no real workbook path or
  financial values in any committed artifact; `src/charts/` diff vs main is EMPTY.
- Every deferral declared in this doc; execution table + Task 10 results + DoD audit
  recorded. NOT merged, NOT pushed — branch left for the user's morning review with exact
  merge/deploy steps in the final report.
