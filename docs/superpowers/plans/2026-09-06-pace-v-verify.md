# ESPP pace, employer match, Settings sections, movers — Lane V (verify) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close `docs/superpowers/specs/2026-09-06-pace-match-settings-movers-design.md` §7's lane V after A (backend), B (paycheck/projection frontend), C (Settings) and D (Net Worth movers) have merged to LOCAL main in that order. Both sides' gates green with their counts recorded, the dev database upgraded to one head and `alembic check`-clean, the spec's two worked examples (§1.4's `20861.05 / 21250.00 / 0.9817`, §2.3's `41667.90 / 0.5787`) pinned by unit tests rather than by memory, and a two-theme browser smoke that judges the shipped surfaces on real pixels: Settings' five sections + sticky chip rail + the four old anchors + **no empty half rows**, the pace strip's ESPP soft tick / window label / note line and the 415(c) label judged against the data actually present, and Net Worth's "What moved" bars, lede and Groups · Accounts toggle. **RULES: the smoke NEVER writes (every non-GET is fenced and answered from memory, `PATCH /prefs` included); `git push` is never run; production is never touched (no ssh, no prod API); nothing is deleted — no files, worktrees, branches or databases, that is the coordinator's end-of-night step; the dev servers are LEFT RUNNING and their PIDs reported. Product code is edited only to fix a defect this lane finds, each fix its own commit with a failing test first (Task 7).**

**Architecture:** Read-only against the dev book except the alembic upgrade of the dev database. Artifacts: `tools/probes/pace-v/smoke.mjs`, one row + one recipe in `tools/probes/README.md`, the two goldens of Task 5 **only if a lane did not ship them**, and this file's Results. The driver is `tools/probes/motion-v/smoke.mjs` with its own instruments and walks — same node-version spoof, headless Edge, token + theme seeded by `addInitScript` before first paint, same **write fence** in `makeContext` (GET/HEAD/OPTIONS continue, every other `/api/v1/**` call is fulfilled from memory), one named `check()` per assertion into `report.json`, exit 1 listing every problem.

**Tech Stack:** pytest 8 on `FINANCE_TEST_DB=finance_test_pv`; ruff; alembic against `postgresql+asyncpg://finance:***@localhost:5433/finance` (Docker container `finance-dashboard-db-1`); vitest 3, TypeScript 5.9, eslint 9, vite build; playwright-core + the installed Edge on node 18 (spoofed to 20); the dev stack (uvicorn `127.0.0.1:8000`, prefix `/api/v1`; vite `http://localhost:5173`). **Runs on the MAIN checkout, on `main`, AFTER all four lane branches have merged** — no worktree, since every file it reads is one a lane just touched; backend commands from `backend/`, frontend from the repo root, local commits only.

**Done when:** Tasks 2–4's gates are green with their counts recorded against the pre-batch baseline `83417d7`; both goldens are asserted in the backend suite and pass; the smoke prints `PACE SMOKE OK` in both themes with a `report.json` whose `problems` is empty; screenshots are in the session scratchpad `pace-smoke/`; the Results table holds OBSERVED numbers; every checkbox is ticked or struck with a reason on the same line; the dev servers are still up and their PIDs are in Results.

---

## File structure

| File | Responsibility |
|---|---|
| `tools/probes/pace-v/smoke.mjs` (new) | The whole walk: Settings shape / rail / anchors / half-rows, the pace strip, the movers card |
| `tools/probes/README.md` (modify) | One table row + one "Running the pace smoke" recipe |
| `backend/tests/test_espp_pace.py`, `backend/tests/test_limit_check.py` (modify, ONLY if Task 5 Step 1 finds the goldens missing) | The spec's two worked examples as assertions |
| `docs/superpowers/plans/2026-09-06-pace-v-verify.md` (this file) | Ticks, Results, morning notes |

### Task 1: Preflight — stack, database, tree, and the four lanes' pieces

**Files:** none (read-only)

- [x] **Step 1: Docker, the db container, and WHICH database alembic will touch.** No step in this plan ssh-es anywhere or points alembic at production.

```bash
docker ps --filter name=finance-dashboard-db-1 --format '{{.Names}} {{.Status}}' && cd backend && .venv/Scripts/python.exe -c "from app.config import settings; from sqlalchemy.engine import make_url; u = make_url(settings.database_url); print(u.host, u.port, u.database)"
```

Expected: `finance-dashboard-db-1 Up … (healthy)`, then VERBATIM `localhost 5433 finance`. Anything else from the second command is a STOP: report it and skip Task 4 entirely. If the container is missing, start it (`powershell -Command "Start-Process 'C:\Program Files\Docker\Docker\Docker Desktop.exe'"`, then `docker compose up -d db`) — never recreate the volume.

- [x] **Step 2: The tree and the worktrees** — `git status --short && git log --oneline -10 && git log --oneline origin/main..main | wc -l && git worktree list`. Expected: status prints NOTHING; the log shows the four lane merges (A, then B/C/D) on top of `83417d7` ("docs(spec): ESPP purchase-year pace, employer match, Settings sections, What-moved movers"); a non-zero ahead count that stays unpushed. Record `git worktree list` verbatim in Results and **remove nothing**.

- [x] **Step 3: The pieces each lane promised** — a silent grep names the lane that did not land its piece: record it and STOP rather than smoking a tree that is missing a lane.

```bash
ls backend/app/services/espp_pace.py src/components/settings/SettingsRail.tsx src/components/settings/PlanAssumptionsCard.tsx src/components/settings/PriceRefreshCard.tsx && grep -n "soft_limit\|soft_ratio\|window_label\|halves\|projected_full_year\|employer_match" backend/app/schemas/paycheck.py
grep -n "match_rate_1\|match_band_2" backend/app/models/comp.py backend/app/services/limit_check.py && grep -n "espp_discount_pct" backend/app/api/app_settings.py backend/app/schemas/app_settings.py && grep -n "employer" backend/app/schemas/projection.py
grep -n "pace-soft-tick\|pace-note" src/components/paycheck/PacePanel.tsx src/components/paycheck/pace.css
grep -n "sec-household\|sec-planning\|sec-data" src/pages/SettingsPage.tsx && grep -n "plan-assumptions\|price-refresh" src/components/paletteRegistry.ts
grep -n "netWorthMoversOption\|netWorthMoversCsv" src/components/networth/netWorthChartOptions.ts src/pages/NetWorthPage.tsx && grep -n "lede" src/components/ChartCard.tsx
```

Expected: every command prints at least one line. `pace-soft-tick`, `SettingsRail.tsx`, `sec-planning` and `netWorthMoversOption` do NOT exist on `83417d7` — finding them is the proof B, C and D merged.

### Task 2: Backend gates

**Files:** none (read-only)

- [x] **Step 1: The suite on its own scratch database** — `cd backend && FINANCE_TEST_DB=finance_test_pv .venv/Scripts/python.exe -m pytest -q`. The name matches conftest's `[a-z0-9_]+_test(_[a-z0-9_]+)?` guard, so the destructive teardown can only ever target `finance_test_pv`. Expected: `N passed` (1 skipped), no failures, no errors, `N` at least the pre-batch **1694** plus lane A's new cases (§1.8 and §2.4 promise roughly 30–50). Record the exact count. A failure here is a cross-lane interaction — most likely `tests/test_limit_check.py` (A owns `employer_match` and the label switch) or `tests/test_paycheck_comp_api.py` (A the columns, B the form) — and goes to Task 7.
- [x] **Step 2: Lint and format** — `cd backend && .venv/Scripts/python.exe -m ruff check app tests && .venv/Scripts/python.exe -m ruff format --check app tests`. Expected: `All checks passed!` then `N files already formatted`.

### Task 3: Frontend gates + build

**Files:** none (read-only)

- [x] **Step 1: Run all four, in order, from the repo root** — `npx tsc -b && npx eslint . && npx vitest run && npm run build`. Expected: `tsc` silent, exit 0; `eslint` exit 0 with **17–18** `react-refresh/only-export-components` warnings and **0 errors** (a new warning class, or any error, is a finding); `vitest` prints `Test Files N passed` / `Tests M passed` with M at least the pre-batch **2447** plus lanes B/C/D's additions — record both; `npm run build` exits 0 with the chunk table — record `index-*.js` and `index-*.css` (baseline css 32.39 kB gzip 7.06; a jump over ~4 kB deserves a look).

- [x] ~~**Step 2: Re-run any failure IN ISOLATION before calling it real** — these five flake only under full-suite load; a green isolated run is recorded in Results as a flake, not as a defect.~~ **NOT RUN — nothing failed:** `npx vitest run` was 184 files / 2510 tests passed on the first full run, so there was no failure to re-run in isolation.

```bash
npx vitest run src/components/settings/BackupsCard.test.tsx src/pages/EsppPage.test.tsx src/components/settings/CategoriesCard.test.tsx src/components/planning/WhatIfPanel.test.tsx src/components/spending/TransactionsPanel.test.tsx
```

Expected: exit 0 (known flakes: BackupsCard "Snapshot now prepends", EsppPage, WhatIfPanel, TransactionsPanel, CategoriesCard). A test that fails in isolation too is a real defect → Task 7.

### Task 4: The dev database — one head, upgrade, `alembic check`

**Files:** none (read-only). Guarded by Task 1 Step 1: run NOTHING here unless it printed `localhost 5433 finance`.

- [x] **Step 1: Exactly one head, chained on the pre-batch head** — `cd backend && .venv/Scripts/python.exe -m alembic heads && grep -rn "down_revision" alembic/versions/*match_tiers*.py`. Expected: exactly ONE line ending `(head)` — lane A's `..._paycheck_profile_match_tiers` — whose `down_revision = "e5a7c1d3f6b8"` (the 2026-09-04 `spending_category_kind` head). Two heads means two lanes wrote a migration; the spec says exactly one does (§6).
- [x] **Step 2: Upgrade the dev database, check it, and read the columns back**

```bash
cd backend && .venv/Scripts/python.exe -m alembic upgrade head && .venv/Scripts/python.exe -m alembic check && cd ..
docker exec -i finance-dashboard-db-1 psql -U finance -d finance -c "SELECT column_name, numeric_precision, numeric_scale, is_nullable, column_default FROM information_schema.columns WHERE table_name='paycheck_profiles' AND column_name LIKE 'match\_%' ORDER BY column_name;"
```

Expected: `Running upgrade e5a7c1d3f6b8 -> <match-tiers revision>` (or nothing to do if a lane already upgraded this box), then **`No new upgrade operations detected.`**, then four rows — `match_band_1`/`match_band_2` `12,2`, `match_rate_1`/`match_rate_2` `10,9`, every one `is_nullable = NO` with `column_default` `0` (§2.1). Record the table. A non-empty `check` output means a model column has no migration behind it (usually a `server_default` on the model and absent from the revision — `hsa_coverage`'s precedent): lane A's defect → Task 7.

### Task 5: The spec's worked examples are pinned by tests

**Files:** `backend/tests/test_espp_pace.py`, `backend/tests/test_limit_check.py` (modified only if Step 1 comes up empty)

- [x] **Step 1: Are the goldens already there?**

```bash
grep -rn "20861.0\|21250.00\|0.9817" backend/tests/test_espp_pace.py; grep -rn "41667.90\|0.5787\|11500" backend/tests/test_limit_check.py
cd backend && FINANCE_TEST_DB=finance_test_pv .venv/Scripts/python.exe -m pytest tests/test_espp_pace.py tests/test_limit_check.py -q
```

Expected: each grep prints at least one line and pytest prints `N passed`. If BOTH greps hit, tick this task and skip Steps 2–4.

- [x] ~~**Step 2: Write the missing ESPP golden** (only if the first grep was silent), appended to `backend/tests/test_espp_pace.py`, with `dataclass`, `date`, `Decimal`, `from app.services.espp_calc import plan_year_rows` and `from app.services.espp_pace import espp_pace_item` in its imports (the file lane A wrote already has most of them). Lane A's plan declares `espp_pace_item(*, rows, profiles, scenario_from_today, limit, discount, today) -> PaceItem | None` — if the shipped `backend/app/services/espp_pace.py` differs, adapt the call after reading it; **the asserted numbers do not change, they are the contract.**~~ **NOT RUN — lane A already shipped it:** `test_the_golden_window_and_verdict` in `backend/tests/test_espp_pace.py` pins every figure of the corrected §1.4 (see Results).

```python
@dataclass
class TimelineProfile:  # the columns espp_pace reads; it never touches an ORM object
    effective_date: date
    espp_pct: Decimal
    annual_salary: Decimal = Decimal("188930.00")
    pay_periods_per_year: int = 24


def test_purchase_year_window_matches_the_2026_09_06_worked_example():
    """Spec §1.4 on production's own profiles: 11 % to 2026-08-17, then 12 %, on 188,930."""
    rows, _warnings = plan_year_rows(2026, [], [], None, None)
    profiles = [
        TimelineProfile(date(2026, 1, 1), Decimal("0.110000000")),
        TimelineProfile(date(2026, 8, 17), Decimal("0.120000000")),
    ]
    kw = dict(rows=rows, profiles=profiles, scenario_from_today=None, limit=Decimal("25000.00"))
    item = espp_pace_item(**kw, discount=Decimal("0.15"), today=date(2026, 9, 6))
    assert item.soft_limit == Decimal("21250.00")
    # 20,861.02: the twelve real paydays of each half enumerated at full precision, rounded once
    # (spec §1.4 as corrected 2026-09-06). Exact — a different window IS a defect.
    assert [h.amount for h in item.halves] == [Decimal("10391.15"), Decimal("10469.87")]
    assert item.annualized == Decimal("20861.02")
    assert item.current_rate == Decimal("0.120000000")
    assert (item.soft_ratio, item.tone) == (Decimal("0.9817"), "warn")
    assert (item.projected_full_year, item.projected_excess) == (
        Decimal("22671.60"),
        Decimal("1421.60"),
    )
```

- [x] ~~**Step 3: Write the missing 415(c) golden** (only if the second grep was silent), appended to `backend/tests/test_limit_check.py`. `FakeProfile` and `by_key` already live at the top of that file, and lane A was to give `FakeProfile` the four match fields (§2.4) — if it has not, add them there with `Decimal("0")` defaults as part of this step, and add `employer_match` to the file's existing `from app.services.limit_check import paycheck_pace` line.~~ **NOT RUN — lane A already shipped it:** `test_employer_match_golden`, `test_employer_match_caps_the_elective_at_the_402g_limit` and `test_total_additions_includes_the_match_and_renames_the_row` in `backend/tests/test_limit_check.py` pin §2.3 (see Results).

```python
def test_415c_worked_example_from_the_2026_09_06_spec():
    """Spec §2.3: E capped at 24,500, after-tax 5,667.90, match 11,500 -> 41,667.90 of 72,000."""
    profile = FakeProfile(
        annual_salary=Decimal("188930.00"),
        trad_401k_pct=Decimal("0.130000000"),
        after_tax_401k_pct=Decimal("0.030000000"),
        match_rate_1=Decimal("1.000000000"),
        match_band_1=Decimal("6000.00"),
        match_rate_2=Decimal("0.500000000"),
        match_band_2=Decimal("11000.00"),
    )
    limits = {LIMIT_401K_ELECTIVE: Decimal("24500.00"), LIMIT_415C_TOTAL: Decimal("72000.00")}
    row = by_key(paycheck_pace(profile, limits, "none"))[LIMIT_415C_TOTAL]
    assert employer_match(profile, Decimal("24560.90"), Decimal("24500.00")) == Decimal("11500.00")
    assert row.annualized == Decimal("41667.90")
    assert row.ratio == Decimal("0.5787")
    assert row.tone == "ok"
    assert row.label == "415(c) total additions (incl. employer match)"
```

- [x] ~~**Step 4: Run them, then commit** — `cd backend && FINANCE_TEST_DB=finance_test_pv .venv/Scripts/python.exe -m pytest tests/test_espp_pace.py tests/test_limit_check.py -q`, then `git add backend/tests/test_espp_pace.py backend/tests/test_limit_check.py && git commit -m "test(verify): pin the 2026-09-06 spec's two worked examples"`. Expected: `N passed`. **A golden that FAILS is this lane's headline finding, not a number to soften** — take it to Task 7. The spec's §1.4 was corrected on 2026-09-06 to the enumerated figures (H1 10,391.15, H2 10,469.87, window 20,861.02, soft cap 21,250.00, `soft_ratio` 0.9817, tone `warn`, projected 22,671.60, excess 1,421.60, `current_rate` 0.120000000); any figure moving IS a defect.~~ **RUN, NOT COMMITTED — nothing to commit:** `pytest tests/test_espp_pace.py tests/test_limit_check.py -q` → `34 passed in 0.37s`; the four named goldens on their own → `4 passed`. No test file was edited, so there was no commit to make.

### Task 6: The smoke driver

**Files:** create `tools/probes/pace-v/smoke.mjs`; modify `tools/probes/README.md`

- [x] **Step 1: Bring the dev stack up, RESTARTED after the merges** — uvicorn runs without `--reload`, so a server started before lane A merged answers with the old code and every new wire field reads as missing (the 2026-09-04 trap). Kill the old one, start both detached, record the PIDs.

```bash
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { \$_.CommandLine -match 'uvicorn app.main:app --port 8000' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force }"
powershell -NoProfile -Command "(Start-Process -FilePath 'C:\Users\edyli\personal-finance-dashboard\backend\.venv\Scripts\python.exe' -ArgumentList '-m','uvicorn','app.main:app','--port','8000' -WorkingDirectory 'C:\Users\edyli\personal-finance-dashboard\backend' -WindowStyle Hidden -PassThru).Id"
powershell -NoProfile -Command "(Start-Process -FilePath 'npm.cmd' -ArgumentList 'run','dev' -WorkingDirectory 'C:\Users\edyli\personal-finance-dashboard' -WindowStyle Hidden -PassThru).Id"
curl --retry 30 --retry-connrefused --retry-delay 1 -s http://127.0.0.1:8000/api/v1/health && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173/
```

Expected: two PIDs (record BOTH — they are what "left running" means), a health JSON, `200`. If vite already serves 5173 from THIS checkout, keep it and take its PID from `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'vite' }`.

- [x] **Step 2: Start from the motion driver, then swap its head, instruments and walks** — `mkdir -p tools/probes/pace-v && cp tools/probes/motion-v/smoke.mjs tools/probes/pace-v/smoke.mjs`, then edit the copy: (1) replace the header comment and the config lines from `const OUT` down to `const STEPS` with the block below, keeping `NOISE`, `sleep`, `files`, `report`, `problem`, `check` and `note` exactly as they are; (2) replace `INIT` with the block below; (3) in `makeContext`, drop the `reducedMotion` parameter and pass none to `newContext`, and answer a fenced write with the literal `return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })` (the `mutate` variable goes with it); (4) delete every walk between `const shot = …` and the closing `} finally {`, putting Step 3's walks there; (5) keep the `finally` (report write + `browser.close()`), the console summary line, the `problems` exit-1 loop, and change the final banner to `PACE SMOKE OK`.

```js
// tools/probes/pace-v/smoke.mjs — the pace / settings / movers smoke (lane V, 2026-09-06 spec).
// Recipe: tools/probes/README.md. READ-ONLY BY CONSTRUCTION: every non-GET /api/v1 call is fenced and
// answered from memory (PATCH /prefs included), so no run can persist anything and there is nothing to
// sweep. Needs the dev stack with uvicorn RESTARTED after the merges (it runs without --reload).
// Env: SMOKE_OUT, TOKEN_FILE, APP_BASE, API_BASE, EDGE_PATH, PLAYWRIGHT_CORE, ONLY_THEME, ONLY_STEP.
const OUT = process.env.SMOKE_OUT ?? path.join(process.cwd(), 'scratchpad', 'pace-smoke'); mkdirSync(OUT, { recursive: true })
const TOKEN = readFileSync(process.env.TOKEN_FILE ?? path.join(OUT, 'token.txt'), 'utf8').trim()
const BASE = process.env.APP_BASE ?? 'http://localhost:5173'; const API = process.env.API_BASE ?? 'http://127.0.0.1:8000'
const EDGE = process.env.EDGE_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'; const VIEWPORT = { width: 1440, height: 900 }
const SECTIONS = [['sec-household', 'Household'], ['sec-planning', 'Planning'], ['sec-account', 'Account'], ['sec-integrations', 'Integrations'], ['sec-data', 'Data']]
const RINGS = ['limits', 'calendar', 'restore', 'backups']; const ANCHORS = ['plan-assumptions', 'price-refresh']
const THEMES = ['dark', 'light'].filter((t) => !process.env.ONLY_THEME || t === process.env.ONLY_THEME)
const STEPS = ['settings', 'rows', 'rail', 'anchors', 'pace', 'movers'].filter((s) => !process.env.ONLY_STEP || s === process.env.ONLY_STEP)
// KEEP motion-v's own NOISE, sleep, files, report, problem, check and note lines verbatim below this
// point: their shapes are identical, and report.json's schema is the house one.

const INIT = `(() => {
  window.__sig = (cv) => { const w = cv.width, h = cv.height; if (!w || !h) return null; let d; try { d = cv.getContext('2d').getImageData(0, 0, w, h).data } catch { return null }
    const uniq = new Set(); for (let y = 0; y < h; y += 9) for (let x = 0; x < w; x += 9) { const i = (y * w + x) * 4; uniq.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]) }
    return { colors: uniq.size, painted: uniq.size >= 4 } }
  window.__rings = {}   // the arrival ring lives 1.2s and is applied imperatively: WATCH it, never poll
  window.__watch = (id) => { window.__rings[id] = false
    const seen = () => { const el = document.getElementById(id); if (el && el.classList.contains('is-highlighted')) window.__rings[id] = true }
    new MutationObserver(seen).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] }); seen() }
  ;(async () => { try { const m = await import('/src/charts/echarts.ts'); window.__echarts = m.echarts } catch (e) { window.__hookError = String(e) } })()
})()`
```

- [x] **Step 3: The six walks, pasted where the motion walks were** (spec §3.1–§3.4, §1.7, §2.3, §4.2)

```js
    // A. Settings' shape. One scroll to the foot first: every card owns its own fetch and grows.
    if (STEPS.includes('settings') || STEPS.includes('rows')) {
      await page.goto(BASE + '/settings', { waitUntil: 'networkidle' }); await sleep(2500)
      await page.evaluate(() => scrollTo(0, document.body.scrollHeight)); await sleep(1500); await page.evaluate(() => scrollTo(0, 0)); await sleep(800)
      const shape = await page.evaluate((ids) => ({ heads: [...document.querySelectorAll('h2.settings-section')].map((h) => ({ id: h.id, text: h.textContent.trim() })),
        chips: [...document.querySelectorAll('.page-frame-scope .segmented button')].map((b) => b.textContent.trim()), retired: !!document.getElementById('app-settings'),
        anchors: ids.map((i) => { const el = document.getElementById(i); return { id: i, present: !!el, card: !!el && el.classList.contains('card') } }) }), ANCHORS)
      check(theme, 'settings', 'the five section headings are present, in spec 3.1 order', shape.heads.map((h) => h.id).join(',') === 'sec-household,sec-planning,sec-account,sec-integrations,sec-data', shape.heads)
      check(theme, 'settings', 'the sticky rail carries the five chips', shape.chips.join(',') === 'Household,Planning,Account,Integrations,Data', shape.chips)
      check(theme, 'settings', 'plan-assumptions and price-refresh are cards, app-settings is retired', shape.anchors.every((a) => a.present && a.card) && !shape.retired, shape)
      await shot('settings-top'); await shot('settings-full', true); drain('settings') }
    // B. no empty half rows: group the grid's children by row top, measure how far right the widest one
    //    reaches. A lone span-6 leaves half the grid bare (~0.48); a filled row reads ~1.0.
    if (STEPS.includes('rows')) {
      const rows = await page.evaluate(() => { const grid = document.querySelector('.settings-page .card-grid') ?? document.querySelector('.card-grid'); if (!grid) return null
        const g = grid.getBoundingClientRect(); const map = new Map()
        for (const k of [...grid.children].filter((c) => c.getClientRects().length)) { const r = k.getBoundingClientRect(); const key = Math.round(r.top)
          const cur = map.get(key) ?? { right: 0, names: [] }; cur.right = Math.max(cur.right, r.right); cur.names.push(k.id || (k.tagName.toLowerCase() + '.' + String(k.className).split(' ')[0])); map.set(key, cur) }
        return [...map.entries()].map(([top, v]) => ({ top, coverage: +((v.right - g.left) / g.width).toFixed(3), names: v.names })) })
      const thin = (rows ?? []).filter((r) => r.coverage < 0.9)
      check(theme, 'rows', 'every card-grid row is filled to the grid right edge', !!rows && thin.length === 0, { rows: rows ? rows.length : null, thin }) }
    // C. the rail: a chip scrolls its heading under the sticky row and marks itself active; scrolling by
    //    hand hands the chip back, which is the IntersectionObserver's job rather than the click's.
    if (STEPS.includes('rail')) {
      for (const [id, label] of SECTIONS) {
        await page.locator('.page-frame-scope .segmented button').filter({ hasText: new RegExp(`^${label}$`) }).click(); await sleep(900)
        const r = await page.evaluate((i) => { const h = document.getElementById(i); const scope = document.querySelector('.page-frame-scope')
          return { top: h ? Math.round(h.getBoundingClientRect().top) : null, inset: scope ? Math.round(scope.getBoundingClientRect().bottom) : 0,
            atEnd: Math.abs(document.documentElement.scrollHeight - scrollY - innerHeight) < 4,   // the last section cannot scroll further
            active: [...document.querySelectorAll('.page-frame-scope .segmented button')].filter((b) => b.classList.contains('active') || b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent.trim()) } }, id)
        const landed = r.top !== null && r.top >= -8 && (r.top <= r.inset + 160 || r.atEnd)
        check(theme, 'rail', `${label}: the chip scrolls its heading under the rail and marks itself active`, landed && r.active.length === 1 && r.active[0] === label, r) }
      await page.evaluate(() => { const h = document.getElementById('sec-household'); scrollTo(0, h.getBoundingClientRect().top + scrollY - 40) }); await sleep(1200)
      const follow = await page.evaluate(() => [...document.querySelectorAll('.page-frame-scope .segmented button')].filter((b) => b.classList.contains('active') || b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent.trim()))
      check(theme, 'rail', 'scrolling back to the top hands the active chip to Household', follow.join(',') === 'Household', follow); await shot('settings-rail'); drain('rail') }
    // D. the four old card hashes still ring; the two new ones exist; a #sec- hash scrolls WITHOUT one.
    if (STEPS.includes('anchors')) {
      for (const id of [...RINGS, ...ANCHORS, 'sec-planning']) {
        await page.goto(`${BASE}/settings#${id}`, { waitUntil: 'commit' }); await page.evaluate((i) => window.__watch(i), id); await sleep(7000)
        const r = await page.evaluate((i) => { const el = document.getElementById(i); return { rang: !!window.__rings[i], top: el ? Math.round(el.getBoundingClientRect().top) : null } }, id)
        const wantsRing = id !== 'sec-planning'
        check(theme, 'anchors', `#${id} lands near the top and ${wantsRing ? 'rings' : 'does NOT ring'}`, r.top !== null && r.top >= -8 && r.top < 420 && r.rang === wantsRing, r) }
      await shot('settings-anchor'); drain('anchors') }
    // E. the pace strip. The 415(c) label is judged against the DATA: the profiles endpoint (a GET, so the
    //    fence lets it by) says whether an in-force profile actually carries a match policy.
    if (STEPS.includes('pace')) {
      await page.goto(BASE + '/paycheck', { waitUntil: 'networkidle' }); await sleep(3500)
      const strip = await page.evaluate(() => ({ notes: [...document.querySelectorAll('.pace-note')].map((n) => n.innerText.replace(/\s+/g, ' ').trim()),
        rows: [...document.querySelectorAll('.pace-row')].map((r) => { const tick = r.querySelector('.pace-soft-tick'); const meter = r.querySelector('.pace-meter')
          return { name: (r.querySelector('.pace-name')?.innerText ?? '').replace(/\s+/g, ' ').trim(), tick: !!tick, left: tick ? tick.style.left || getComputedStyle(tick).left : null,
            meterW: meter ? Math.round(meter.getBoundingClientRect().width) : null, valuetext: meter ? meter.getAttribute('aria-valuetext') : null,
            figures: (r.querySelector('.pace-figures')?.innerText ?? '').replace(/\s+/g, ' ').trim() } }) }))
      const espp = strip.rows.find((r) => /ESPP/i.test(r.name)); const total = strip.rows.find((r) => /415\(c\)/.test(r.name))
      if (!espp) note(theme, 'pace', 'the dev book shows no ESPP row (nobody enrolled across the window)', strip.rows.map((r) => r.name))
      else { const pct = !espp.left ? null : espp.left.trim().endsWith('%') ? parseFloat(espp.left) : espp.meterW ? +((parseFloat(espp.left) / espp.meterW) * 100).toFixed(1) : null
        check(theme, 'pace', 'the ESPP row carries a soft tick inside its own track', espp.tick && pct !== null && pct > 50 && pct < 100, { left: espp.left, meterW: espp.meterW, pct })
        check(theme, 'pace', 'the ESPP row names its purchase-year window and its practical cap', /purchase/i.test(espp.name) && /practical/i.test(`${espp.figures} ${espp.valuetext ?? ''}`), espp)
        check(theme, 'pace', 'a note line states each half and the full-purchase-year projection', strip.notes.some((n) => /(estimated|entered)/i.test(n) && /(full purchase year|not contributing now)/i.test(n)), strip.notes) }
      const profiles = await (await page.request.get(`${API}/api/v1/paycheck/profiles`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json()
      const inForce = (Array.isArray(profiles) ? profiles : []).filter((p) => p.in_force)
      const matched = inForce.map((p) => Number(p.match_rate_1) * Number(p.match_band_1) + Number(p.match_rate_2) * Number(p.match_band_2) > 0)
      if (!total) problem(`${theme} pace: no 415(c) row on /paycheck`)
      else if (new Set(matched).size !== 1) note(theme, 'pace', 'the in-force profiles disagree about the match, so the label cannot be judged from the API alone', { label: total.name, inForce })
      else check(theme, 'pace', `the 415(c) label says "${matched[0] ? 'incl.' : 'excludes'} employer match", as this book demands`, matched[0] ? /incl\. employer match/.test(total.name) : /excludes employer match/.test(total.name),
        { label: total.name, inForce: inForce.map((p) => ({ person_id: p.person_id, r1: p.match_rate_1, b1: p.match_band_1, r2: p.match_rate_2, b2: p.match_band_2 })) })
      await shot('paycheck-pace'); drain('pace') }
    // F. "What moved": bars from a value axis, per-bar group colour, the lede, the toggle.
    if (STEPS.includes('movers')) {
      await page.goto(BASE + '/net-worth', { waitUntil: 'networkidle' }); await sleep(3500)
      const found = await page.evaluate(() => { const c = [...document.querySelectorAll('section.chart-card')].find((x) => /What moved/i.test(x.querySelector('h2')?.textContent ?? ''))
        if (!c) return false; c.dataset.paceTarget = '1'; c.scrollIntoView({ block: 'center' }); return true })   // the one-shot draws it once seen
      if (!found) problem(`${theme} movers: no "What moved" chart card on /net-worth`)
      else { await sleep(2000)
        const read = () => page.evaluate(() => { const c = document.querySelector('section.chart-card[data-pace-target]'); const host = c.querySelector('[_echarts_instance_]')
          const inst = host && window.__echarts ? window.__echarts.getInstanceByDom(host) : null; const o = inst ? inst.getOption() : null; const cv = c.querySelector('canvas')
          return { text: c.innerText.replace(/\s+/g, ' ').trim().slice(0, 260), lede: (c.querySelector('.chart-lede')?.innerText ?? '').replace(/\s+/g, ' ').trim(), buttons: [...c.querySelectorAll('.segmented button')].map((b) => b.textContent.trim()), painted: cv ? !!(window.__sig(cv) ?? {}).painted : false,
            x: o ? o.xAxis.map((a) => a.type) : null, y: o ? o.yAxis.map((a) => ({ type: a.type, inverse: !!a.inverse })) : null,
            series: o ? o.series.map((s) => ({ type: s.type, n: (s.data ?? []).length, coloured: (s.data ?? []).filter((d) => d && d.itemStyle && d.itemStyle.color).length, barMaxWidth: s.barMaxWidth })) : null } })
        const g = await read()
        check(theme, 'movers', 'horizontal bars: value x-axis, inverted category y-axis, one bar series', g.painted && g.series?.[0]?.type === 'bar' && g.x?.[0] === 'value' && g.y?.[0]?.type === 'category' && g.y?.[0]?.inverse === true, { painted: g.painted, x: g.x, y: g.y, series: g.series })
        check(theme, 'movers', 'every bar carries its own group colour', (g.series?.[0]?.coloured ?? -1) === (g.series?.[0]?.n ?? -2), g.series)
        check(theme, 'movers', 'the .chart-lede reads from -> to with both totals, the delta and the percent', /→/.test(g.lede) && (g.lede.match(/\$/g) ?? []).length >= 3 && /%/.test(g.lede), g.lede || g.text.slice(0, 180))
        check(theme, 'movers', 'the Groups and Accounts toggle is on the card', g.buttons.includes('Groups') && g.buttons.includes('Accounts'), g.buttons); await shot('networth-movers-groups')
        await page.locator('section.chart-card[data-pace-target] .segmented button').filter({ hasText: /^Accounts$/ }).click(); await sleep(1600); const a = await read()
        check(theme, 'movers', 'Accounts mode redraws with at most eleven rows (ten plus Other accounts)', a.painted && (a.series?.[0]?.n ?? 0) >= 1 && a.series[0].n <= 11, a.series)
        await shot('networth-movers-accounts'); drain('movers') } }
```

- [x] **Step 4: The README row and recipe.** Add one table row to `tools/probes/README.md` — `pace-v/smoke.mjs` | "Settings' five sections, the sticky chip rail, the four old anchors still ringing, `#sec-` hashes that do not, and every card-grid row filled to the right edge; the pace strip's ESPP soft tick, window label and note line plus the 415(c) label judged against the profiles the API reports; Net Worth's What moved bars, lede and Groups · Accounts toggle. READ-ONLY BY CONSTRUCTION — a write fence, not a sweep" | needs the dev stack — and a `## Running the pace smoke (dev only)` section carrying Step 5's commands, the uvicorn-restart caution, and the env list (`SMOKE_OUT`, `TOKEN_FILE`, `APP_BASE`, `API_BASE`, `EDGE_PATH`, `PLAYWRIGHT_CORE`, `ONLY_THEME`, `ONLY_STEP` = settings|rows|rail|anchors|pace|movers).
- [x] **Step 5: Mint a token and run both themes** — `$SCRATCH` is the executing session's own scratchpad directory (`C:/Users/edyli/AppData/Local/Temp/claude/C--Users-edyli-personal-finance-dashboard/<session-id>/scratchpad`), never the repo.

```bash
OUT="$SCRATCH/pace-smoke" && mkdir -p "$OUT"
curl -s http://127.0.0.1:8000/api/v1/auth/login -H 'content-type: application/json' -d '{"email":"admin@example.com","password":"changeme123"}' | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).access_token))" > "$OUT/token.txt"
TOKEN_FILE="$OUT/token.txt" SMOKE_OUT="$OUT" node tools/probes/pace-v/smoke.mjs
```

Expected: the checks line, then `PACE SMOKE OK`, exit 0; `$OUT/report.json` with `problems: []`, `writesBlocked` **empty** (this walk provokes no write — anything in it is a finding worth naming), `prefsWrites` holding only the per-theme `PATCH /prefs` if the app sends one, and ~16 PNGs (8 per theme). Exit 1 prints every failed check with its observed value — copy those verbatim into Results; a verify lane's failures are its output, not its embarrassment.

- [x] **Step 6: Commit the driver** — `git add tools/probes/pace-v/smoke.mjs tools/probes/README.md && git commit -m "test(probe): the pace smoke — Settings sections and rail, the ESPP tick and note, the movers bars"`.

### Task 7: Defect triage — a failing check becomes a failing test, then a fix

**Files:** whichever file the defect lives in (spec §6's file map names the owner)

- [x] **Step 1: Classify before touching anything.** A failed gate, golden or smoke check is (a) a **flake** — re-run in isolation (Task 3 Step 2) and record it; (b) a **dev-data non-defect** — the book lacks the shape the check needs (no ESPP enrolment, no match policy); downgrade it to a `note()` in the driver with the reason on the same line and re-run; or (c) a **real defect** — proceed.
- [x] ~~**Step 2: Write the failing test FIRST**, in the suite that owns the behaviour (`backend/tests/…` for a wire field or a number, `src/**/*.test.tsx` for markup or copy), run it, and paste its failure output into the commit body. A smoke check is never the only proof of a fix.~~ **NOT RUN — no real defect found:** the only two failing checks of the whole run were case (b), dev-data non-defects (Results below), and were downgraded to `note()`s in the driver.
- [x] ~~**Step 3: Make the minimal fix** in the owning lane's file, re-run that test, then re-run the gate it broke. One `fix(<area>): <what>` commit per defect, with the failing check's name in the body.~~ **NOT RUN — no product code was touched by this lane.**
- [x] ~~**Step 4: Cap at THREE fixes** — a fourth means a lane merged half-done work: stop fixing, record every remaining failure in Results beside its owner, and leave it for the morning. Never soften a golden, a threshold or an assertion to make a check pass — the numbers are the contract.~~ **N/A — zero fixes were needed;** the cap was never approached.

### Task 8: Record, tick, final gate, leave the stack up

**Files:** modify this plan

- [x] **Step 1: Fill the Results table with OBSERVED values** — gate counts, the alembic head and column table, both goldens as the suite computed them (including H1/H2), each smoke step's ok/failed/noted counts, the screenshot folder and `report.json` path, and every failed check beside the lane that owns it.
- [x] **Step 2: Tick every checkbox in this file**; a step not run is struck through with its reason on the same line, never left blank.
- [x] **Step 3: Final gate on the tree as it now stands**

```bash
cd backend && FINANCE_TEST_DB=finance_test_pv .venv/Scripts/python.exe -m pytest -q && cd .. && npx tsc -b && npx eslint . && npx vitest run && npm run build
git status --short && git log --oneline -8 && git log --oneline origin/main..main | wc -l
```

Expected: the Task 2/3 counts plus whatever Task 5 or 7 added; a clean status; the four lane merges plus this lane's commits; a non-zero ahead count that was never pushed.

- [x] **Step 4: Leave the dev servers running and prove it** — this lane stops nothing and deletes nothing. Run `curl -s -o /dev/null -w "backend %{http_code}\n" http://127.0.0.1:8000/api/v1/health && curl -s -o /dev/null -w "vite %{http_code}\n" http://localhost:5173/`, then `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { \$_.CommandLine -match 'uvicorn app.main:app --port 8000|vite' } | Select-Object ProcessId, Name"`. Expected: `backend 200`, `vite 200`, and the two PIDs — record them in Results.
- [x] **Step 5: Report to the coordinator** (do NOT write to the coordinator's memory directory yourself): the four merge SHAs, the gate counts, the goldens as computed, the smoke's folder and `report.json` path, every deviation and failed check with its owner, the dev-server PIDs, and the morning notes. The coordinator records them in the batch memory.

## Results (filled by Task 8)

Run on the MAIN checkout, on `main` at `e0a8ad2` (the four lane merges, in the order they actually
landed: **D `0b6f442`, B `cddabeb`, A `6d9a9ce`, C `e0a8ad2`** — the plan's prose says A first; the
order is irrelevant to every check here). 44 commits ahead of `origin/main` at the start, never
pushed. Session scratchpad:
`C:/Users/edyli/AppData/Local/Temp/claude/C--Users-edyli-personal-finance-dashboard/3e55cfbf-4a5a-44ce-8c58-b754ea4e2707/scratchpad/pace-smoke`.

| Gate / check | Baseline (`83417d7`) | Observed |
|---|---|---|
| `pytest -q` (`FINANCE_TEST_DB=finance_test_pv`) / ruff | 1694 passed, 1 skipped / clean | **1735 passed, 1 skipped** in 918.85s (+41; lane A's own full run reported 1734, so one case arrived with its post-run `fix(espp)` commit `8c576d5`). `ruff check` → `All checks passed!`; `ruff format --check` → `243 files already formatted` |
| `npx tsc -b` / `npx eslint .` / `npx vitest run` / `npm run build` | silent / 0 errors, 17–18 warnings / 2447 tests / css 32.39 kB | `tsc` **silent, exit 0**. `eslint` **0 errors, 18 warnings**, every one `react-refresh/only-export-components` — no new warning class. `vitest` **184 test files passed / 2510 tests passed** (pre-batch 2447; lane C's run 2481), 107.72s, zero failures. `npm run build` exit 0: `index-*.js` **320.05 kB** (gzip 102.27), `index-*.css` **34.20 kB** (gzip **7.21**) — +1.81 kB / +0.15 kB gzip on the baseline, well under the ~4 kB tripwire. (The js content hash moves between otherwise identical builds because the bundle embeds the short SHA the sidebar's DEV badge prints; the byte count does not.) |
| `alembic heads` / `upgrade` / `check` / match columns | one head `e5a7c1d3f6b8`, no match columns | **exactly one head `f6b8d2e4a7c1 (head)`** = `20260906_0900_f6b8d2e4a7c1_paycheck_profile_match_tiers.py`, `down_revision = "e5a7c1d3f6b8"`. `upgrade head` printed **no migration step** (lane A had already run it on this box); `alembic current` → `f6b8d2e4a7c1 (head)`; `alembic check` → **`No new upgrade operations detected.`** Columns on `paycheck_profiles` in the table below |
| §1.4 golden: H1 / H2 / window / soft cap / soft_ratio / tone · §2.3 golden: match / 415(c) / ratio / label | 10,391.15 / 10,469.87 / 20,861.02 (spec §1.4 illustrates .90 / .05) / 21,250.00 / 0.9817 / warn · 11,500.00 / 41,667.90 / 0.5787 / incl. | **Both already shipped by lane A and both PASS, every figure on the nose.** §1.4 (`test_the_golden_window_and_verdict`): halves **10391.15 / 10469.87**, `annualized` **20861.02**, `limit/ratio` 25000.00 / **0.8344**, `soft_limit` **21250.00**, `soft_ratio` **0.9817**, tone **warn**, `projected_full_year` **22671.60**, `projected_excess` **1421.60**, `current_rate` **0.120000000**, `backfilled_from` **2026-01-01**, `window_label` "Sep 2025 – Aug 2026 purchases". §2.3 (`test_employer_match_golden` + `test_employer_match_caps_the_elective_at_the_402g_limit` + `test_total_additions_includes_the_match_and_renames_the_row`): match **11500.00** (also 11500.00 at a 50,000 deferral and 2,500.00 inside band 1), `annualized` **41667.90**, `ratio` **0.5787**, tone `ok`, label **"415(c) total additions (incl. employer match)"**; the no-policy twin still reads "(excludes employer match)" with a null match. `pytest tests/test_espp_pace.py tests/test_limit_check.py -q` → **34 passed in 0.37s**; the four named goldens alone → **4 passed** |
| Smoke per step (settings, rows, rail, anchors, pace, movers): ok / failed / noted · `writesBlocked` / `prefsWrites` / PNGs / `report.json` path | n/a · expected 0 / ≤2 per theme / ~16 | **`PACE SMOKE OK`, exit 0, in BOTH themes. 70 ok / 0 failed / 10 noted; `problems: []`.** Per theme (identical dark and light): settings **3/0/0**, rows **3/0/2**, rail **6/0/0**, anchors **14/0/0**, pace **4/0/2**, movers **5/0/1**. `writesBlocked` **[]** (this walk provokes no write, as designed), `prefsWrites` **[]** (the app sent no `PATCH /prefs`), **22 PNGs** (11 per theme). `report.json` and every PNG live in `…/3e55cfbf-4a5a-44ce-8c58-b754ea4e2707/scratchpad/pace-smoke/` |
| Dev servers left running (uvicorn PID, vite PID) / worktrees seen | n/a | **uvicorn PID `33424`** (`backend/.venv/Scripts/python.exe -m uvicorn app.main:app --port 8000`, child worker `6992`) → `backend 200`; **vite PID `29928`** (`node.exe`, under the `npm run dev` wrapper `28508` → `cmd.exe 23820`) → `vite 200`. Both were started BY this lane (nothing was running when it began) and are **left up**. `git worktree list` verbatim, **nothing removed**: `C:/Users/edyli/personal-finance-dashboard e0a8ad2 [main]` · `…/.worktrees/pace-a 8c576d5 [pace-a]` · `…/.worktrees/pace-b fdee8df [pace-b]` · `…/.worktrees/pace-c 35ed290 [pace-c]` · `…/.worktrees/pace-d 8bc12fe [pace-d]` |

**Task 8 Step 3, the final gate re-run on the tree as it now stands** (the two lane-V commits on
top of the four merges): `pytest -q` → **1735 passed, 1 skipped** in 1015.25s, exit 0 — identical
to the Task 2 run; `tsc -b` silent; `eslint .` 0 errors / 18 warnings; `vitest run` **184 files /
2510 tests passed**; `npm run build` exit 0, `index-*.js` 320.05 kB. `git status --short` clean,
**46 commits ahead of `origin/main` and never pushed**. `curl` afterwards: `backend 200`,
`vite 200` — both servers still up on PIDs `33424` and `29928`.

### `paycheck_profiles` match columns, read back from the dev database

| column_name | numeric_precision | numeric_scale | is_nullable | column_default |
|---|---|---|---|---|
| `match_band_1` | 12 | 2 | NO | `'0'::numeric` |
| `match_band_2` | 12 | 2 | NO | `'0'::numeric` |
| `match_rate_1` | 10 | 9 | NO | `'0'::numeric` |
| `match_rate_2` | 10 | 9 | NO | `'0'::numeric` |

Exactly §2.1: bands `12,2`, rates `10,9`, all four NOT NULL defaulting to 0.

### Failed checks (beside the lane that owns them) and noted non-defects

**Failures: none.** No gate, golden or smoke check failed on the final tree, so Task 7 Steps 2–4
never fired and **no product file was edited by this lane**. Two checks failed on the FIRST pace
run and were classified under Task 7 Step 1 as case (b), dev-data non-defects; the evidence and the
downgrade are below.

- **(b) `dark|light pace: the ESPP row carries a soft tick inside its own track`** and
  **`… names its purchase-year window and its practical cap`** — observed `tick: false`,
  `meterW: null`, `figures: "$21,731.15"`. **Not a lane's defect.** `GET /limits?year=2026` on the
  dev book returns `value: null` for **every** key, `limit_espp_423` included, and the spec says so
  twice: §1.4 "missing → the CTA row, no meter, as today" and §1.8 "missing limit → CTA item". A row
  with no track can carry neither a tick nor a "practical" figure. The driver now splits on the
  catalogue: with a limit it runs the two original checks; without one it records the note
  *"no limit_espp_423 is entered for 2026, so the ESPP row is the CTA row by design (spec §1.4)"*
  and asserts, in both branches, that a limitless row **offers the call to action** (observed
  `cta: "enter this year's limit"` — a check, not a shrug). The window label and the note line are
  still asserted on this book and both pass: the row reads "ESPP §423 annual / Sep 2025 – Aug 2026
  purchases" over "February 2026 Purchase entered · August 2026 Purchase entered. At your current
  11%, a full purchase year is $20,782.30."
- **(note) `pace: the book answered 4xx/5xx for a feed this page asks for`** — `404 GET
  /api/v1/paycheck/breakdown?person_id=2`. The same known dev-book non-defect the C7 and motion
  smokes list: the partner has no paycheck profile. The page handles it, and it is the ONLY 4xx of
  the whole run; nothing else reached the console in either theme.
- **(note, review eyeball 1) the movers' bar labels do NOT clip.** Measured on real pixels in both
  themes, Groups mode: canvas 1109 px, grid 130 → 1069, largest bar +$19,005.13 ending at x=991,
  its "+$19.0K" label 47 px wide → **66 px of room** before the canvas edge; the negative extreme
  (−$41.72) leaves 222 px. Screenshots `{dark,light}-networth-movers-{groups,accounts}.png` and the
  card-tight `{dark,light}-movers-card.png` confirm it by eye in Accounts mode too (the "+$19.0K" on
  "Schwab ESPP" renders whole). **Per the brief, nothing was changed** —
  `netWorthChartOptions.ts` keeps `xAxis: moneyAxis()`. See the morning notes for the latent case.
- **(note, review eyeball 2) Settings geometry, both densities and both breakpoints.** The chip →
  band landing is now a hard check rather than an eyeball and passes at **both** densities: at
  `comfortable` all five chips land their band under the rail (`rail` step, 6/6 per theme), and at
  `data-density="compact"` the Data band lands at or below the rail's bottom edge (`rows` step).
  Every one of the four old card hashes (`#limits`, `#calendar`, `#restore`, `#backups`) still
  **rings** and lands **below** the rail — 14 anchor checks per theme, all green — while
  `#sec-planning` scrolls and pointedly does **not** ring (a band is not a card).
  `.system-facts` is a two-column grid at **721 px** (`183px 183px`), **1400 px** (`240.75px` ×2)
  and **1440 px** (`250.75px` ×2) — the `min-width: 721px` rule fires exactly at its boundary.
  Activity is capped and scrolls **inside its own box**: `.settings-scroll` `max-height: 420px`,
  `overflow-y: auto`, box 420 px against 557 px of content (the cap is on the scroll box, not on
  `.activity-list` — the probe was corrected to measure the right element).
- **No empty half rows**, both themes: every `.card-grid` row reaches the grid's right edge
  (0 rows under 0.9 coverage). The pairs that make it work are visible in the screenshots —
  Contribution limits + Plan assumptions, Appearance + Password, Price refresh + Assistant,
  Backups + Restore, Data health + System — with Accounts, Calendar feed, Import and Activity
  spanning 12.

### Deviations from the plan, recorded rather than hidden

1. **Merge order was D, B, A, C** (the plan's prose assumes A first). No check depends on it.
2. **Task 5 wrote nothing.** Both greps hit, so Steps 2–4 were skipped as the plan instructs — lane
   A had already pinned both worked examples. The plan's draft golden differs in SHAPE from what
   shipped (lane A's uses a module-level `item()` helper and its own `FakeProfile`); **the numbers
   are identical**, which is the part that is the contract.
3. **Three driver deviations** from the plan's draft, each documented at the top of
   `tools/probes/pace-v/smoke.mjs`: (a) `__rings` is filled by a MutationObserver armed at
   **document start** over the whole tree and keyed by element id, not by a per-id watcher installed
   after the navigation — the ring lives 1.2 s and a `goto` + `evaluate` round trip can outlast it,
   so the draft's watcher would read a ring already taken off as "never rang" (`window.__watch(id)`
   survives as the reset); (b) the 415(c) label is judged against `GET /paycheck/profiles` issued
   through `page.request`, which Playwright does **not** put through `context.route` — a GET either
   way, so the fence's claim is untouched; (c) the reviews' two eyeballs are instrumented rather
   than left to a human — three extra `note()`s (movers label room; `.system-facts` and the
   Activity box at 1440 px; `.system-facts` at 721 and 1400 px) and four extra `check()`s (the
   compact-density chip landing, every card hash landing BELOW the rail, the Activity feed capped
   and scrolling inside its own box, and a limitless ESPP row offering its call to action).
4. **Two small driver additions the plan did not ask for**: the `rail` step navigates to `/settings`
   itself when `ONLY_STEP=rail` skips walk A, and the `pace` step scrolls the Contribution-pace card
   into view before shooting it (it is below the fold and the reveal timeline holds it dim, so the
   draft's screenshot photographed a ghost). Neither changes an assertion.

## Production notes for the morning

**What changed, so an intended change is not mistaken for a regression.**

- **The ESPP pace row now measures a PURCHASE YEAR, not a calendar year.** It grades the two
  purchase halves that settle inside the current calendar year — on this book "Sep 2025 – Aug 2026
  purchases", printed under the row's label — so **autumn contributions count toward next year's
  row, not this one**. A figure that dropped since yesterday has almost certainly moved into the
  next window rather than gone missing.
- **The row is graded against a PRACTICAL cap, not the §423 cap.** `soft_limit = limit × (1 −
  discount)` — the most contribution dollars the §423 limit can actually buy at the plan discount.
  The tone and the percentage beside it read off `soft_ratio`, so **the row can say "near the cap"
  while the hard ratio is a comfortable 0.83** (the golden is exactly that: 0.8344 hard, 0.9817
  soft, tone `warn`). The `.pace-soft-tick` on the track is where that cap sits.
- **The 415(c) row grew the employer match** and renames itself: "415(c) total additions (incl.
  employer match)" once an in-force profile carries a match policy, "(excludes employer match)"
  when it does not. **The Projection grew an employer leg** (`employer_monthly` per person, summed
  into `employer`, deliberately kept apart from `payroll`). **The Spending savings rate did NOT
  change** — employer money is not the household's own saving.
- **Settings is five sections behind a sticky chip rail** (Household · Planning · Account ·
  Integrations · Data). `app-settings` is retired; its content is now the **Plan assumptions** card
  (withdrawal rate, ESPP ticker, ESPP discount, plus a read-only per-person employer-match summary
  that links to the Paycheck page), beside a new **Price refresh** card. Every old deep link still
  works: `#limits`, `#calendar`, `#restore`, `#backups` all ring and land below the rail; the
  palette now offers `plan-assumptions` and `price-refresh` where it used to offer `app-settings`.
- **Net Worth's "What moved" is contribution bars** under a `from → to` header carrying both totals,
  the delta and the percent, plus a **Groups · Accounts** toggle (Accounts folds past ten into
  "Other accounts"). Bars are horizontal, sorted by absolute size, coloured by group.

**Figures to eyeball on the real book (this dev book could not answer them).**

1. **Enter the 2026 contribution limits in Settings → Planning → Contribution limits.** The dev
   database has **every** limit null, so all four pace rows show "enter this year's limit" and the
   ESPP row's soft tick, practical figure and warn/over tone were never exercised on pixels. With
   `limit_espp_423 = 25,000` and the discount at 15 %, expect the practical cap **$21,250.00** and a
   tick at 85 % of the track. **This is the one surface the smoke could not judge.**
2. **The §1.4 golden is production's own shape** — 11 % to 2026-08-17 then 12 % on 188,930 gives H1
   10,391.15 / H2 10,469.87, window 20,861.02, `soft_ratio` 0.9817 (**warn**), a full purchase year
   of 22,671.60 and **1,421.60 over the practical cap**. If the real book's ESPP row says anything
   materially different once the limit is entered, that is worth a look. Note the golden's
   `backfilled_from = 2026-01-01`: H1 opens 2025-09-01, four months before the earliest profile, so
   its first eight paydays borrow that profile and the note line says so out loud.
3. **Set the employer 401(k) match on the paycheck profile** (Paycheck page; Settings shows it
   read-only). Until it is set, the 415(c) row keeps its "(excludes employer match)" caveat and the
   Projection's employer leg is zero — which is exactly what the dev book shows, so the "incl."
   label and a non-zero leg have only ever been proven by unit tests, never on pixels.
4. **The movers card's outside-end labels have room today but the margin is thin.** Measured: 66 px
   spare at 1440 px wide. The failure mode is arithmetic, not hypothetical — the `horizontal` grid
   reserves **40 px** on the right, and a "+$19.0K"-class label is ~47 px, so a month whose largest
   gain lands **exactly on the axis's nice max** would clip by about 12 px. The reviewer's fix is
   ready if it ever shows: `xAxis: { ...moneyAxis(), boundaryGap: [0, '12%'] }` in
   `src/components/networth/netWorthChartOptions.ts`. **Not applied — it does not clip today, and
   this lane changes product code only for a defect it can see.**

**Carry-overs.**

- The 44-commit lead over `origin/main` is **unpushed by design**; the four lane worktrees
  (`pace-a`…`pace-d`) and their branches are **untouched** — deletion is the coordinator's
  end-of-night pass, not this lane's.
- Backend moved 1694 → 1735 and vitest 2447 → 2510; if a morning run disagrees, the delta is the
  batch's, not a flake — nothing flaked in either suite on this tree, so Task 3 Step 2's isolation
  re-run was never needed.
- `finance_test_pv` is the scratch database this lane's pytest runs created and dropped under
  conftest's guard; nothing else was written anywhere. The dev database `finance` was upgraded
  (already at head when this lane arrived) and otherwise only read. Production was never contacted.
