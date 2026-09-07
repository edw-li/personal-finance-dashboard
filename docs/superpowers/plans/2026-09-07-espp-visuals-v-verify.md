# ESPP visuals — Lane V (verify) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close `docs/superpowers/specs/2026-09-07-espp-visuals-design.md` §9–§10's verify step after lanes 1 (backend), 2 (strip + meter) and 3 (chart cards) have merged to LOCAL main. Both suites green with their counts recorded, `alembic check` clean (this batch adds no migration, so it must stay that way), the build's chart chunk size recorded, and a two-theme browser smoke that judges the shipped page on real pixels: a five-tile strip with no lone row and no ghost left standing, two painted chart cards filling one grid row, the `Dollars · Per share` toggle actually swapping the series, the two-row meter where the gauge stood, the totals rows, the strip's figures agreeing with the API's own totals block, no console errors, and the page's CLS recorded. **RULES: the smoke NEVER writes (every non-GET `/api/v1/**` call is fenced and answered from memory, `PATCH /prefs` included); `git push` is never run; production is never touched (no ssh, no prod URLs); nothing is deleted — no files, worktrees, branches, databases or processes; the lane's own dev servers are started on their own ports and LEFT RUNNING with their PIDs reported. Product code is edited only to fix a defect this lane finds, each fix its own commit with a failing test first (Task 6).**

**Architecture:** Read-only against the dev book. Artifacts: `tools/probes/espp-v/smoke.mjs`, one row + one recipe paragraph in `tools/probes/README.md`, and this file's Results. The driver is `tools/probes/pace-v/smoke.mjs`'s skeleton — same node-version spoof and playwright-core require, headless Edge, token + theme seeded by `addInitScript` before first paint, the same **write fence** in `makeContext`, `check()`/`note()` into `report.json`, exit 1 listing every problem.

**Tech Stack:** pytest 8 on `FINANCE_TEST_DB=finance_test_ev`; ruff; alembic against the dev database `postgresql+asyncpg://…@localhost:5433/finance` (Docker container `finance-dashboard-db-1`); vitest 3, TypeScript 5.9, eslint 9, vite build; playwright-core + the installed Edge on node 18 (spoofed to 20); the lane's own dev stack (uvicorn `127.0.0.1:8010`, prefix `/api/v1`; vite `http://localhost:5174`). **Runs on the MAIN checkout, on `main`, AFTER the three lane branches have merged** — backend commands from `backend/`, frontend from the repo root, local commits only.

**Done when:** Tasks 2–4's gates are green with their counts recorded against the pre-batch baseline `21bb2c3`; the smoke prints `ESPP SMOKE OK` in both themes with a `report.json` whose `problems` is empty; screenshots are in `scratchpad/espp-smoke/`; the Results table holds OBSERVED numbers; every checkbox is ticked or struck with a reason on the same line; the lane's servers are still up and their PIDs are in Results.

---

## File structure

| File | Responsibility |
|---|---|
| `tools/probes/espp-v/smoke.mjs` (new) | The whole walk: strip, grid, cards, toggle, meter, totals, API cross-check, CLS, console |
| `tools/probes/README.md` (modify) | One table row + one "Running the ESPP smoke" recipe |
| `docs/superpowers/plans/2026-09-07-espp-visuals-v-verify.md` (this file) | Ticks, Results, morning notes |

### Task 1: Preflight — tree, merges, database, ports

**Files:** none (read-only)

- [ ] **Step 1: The tree and the merges** — `git status --short && git log --oneline -12 && git worktree list`. Expected: status prints NOTHING; the log shows the three lane merges on top of the plan/type commits above `21bb2c3`; three `.worktrees/espp-*` entries (and the older `hsa`). Record `git worktree list` verbatim in Results and **remove nothing**.
- [ ] **Step 2: The pieces each lane promised** — a silent grep names the lane that did not land; record it and STOP rather than smoking a tree missing a lane:

```bash
grep -c "avg_paid_to_date" backend/app/schemas/espp.py && grep -c "class LotTotalsOut" backend/app/schemas/espp.py && grep -c "total_refund" backend/app/schemas/espp.py && grep -c "EsppOffering.offering_start" backend/app/services/price_service.py
grep -c "PositionStrip" src/pages/EsppPage.tsx && grep -c "LimitChainMeter" src/pages/EsppPage.tsx && grep -c "espp-totals" src/pages/EsppPage.tsx && grep -c "kpi-row-lone" src/pages/EsppPage.tsx
grep -c "LotAnatomyCard" src/pages/EsppPage.tsx && grep -c "EsppPriceCard" src/pages/EsppPage.tsx && ls src/charts/fixtures | grep -c espp && ls tools/probes/espp-3
```

Expected: every count ≥ 1 EXCEPT `kpi-row-lone` in `EsppPage.tsx`, which must be 0; three espp fixtures; `probe.html shoot.mjs`.

- [ ] **Step 3: Docker and WHICH database alembic will touch.**

```bash
docker ps --filter name=finance-dashboard-db-1 --format '{{.Names}} {{.Status}}' && cd backend && .venv/Scripts/python.exe -c "from app.config import settings; from sqlalchemy.engine import make_url; u = make_url(settings.database_url); print(u.host, u.port, u.database)"
```

Expected: `finance-dashboard-db-1 Up … (healthy)`, then VERBATIM `localhost 5433 finance`. Anything else from the second command is a STOP for Task 4's alembic step.

- [ ] **Step 4: Ports.** `netstat -ano | grep -E ":(8010|5174) " || echo free` → `free`. If either is taken, pick 8011/5175 and use them consistently below (record the choice).

### Task 2: Backend gates

**Files:** none

- [ ] **Step 1:** from `backend/`: `FINANCE_TEST_DB=finance_test_ev .venv/Scripts/python.exe -m pytest -q` → green. Record the count (baseline before this batch: run `git stash list` is irrelevant — the baseline count is in the Lane 1 report; record both).
- [ ] **Step 2:** `.venv/Scripts/python.exe -m ruff format --check app tests && .venv/Scripts/python.exe -m ruff check app tests` → clean.

### Task 3: Frontend gates

**Files:** none

- [ ] **Step 1:** from the repo root: `npx vitest run` → green; record the count and the file count.
- [ ] **Step 2:** `npx tsc -b && npx eslint .` → clean (the one sanctioned warning, if any, is recorded, never fixed here).
- [ ] **Step 3:** `npm run build` → clean; record the EChart chunk's size from vite's output (the advisory ceiling is noted in `vite.config.ts`; if the chunk crosses it, record the number — the fix is a follow-up, not this lane's).

### Task 4: Database — no migration, still checked

**Files:** none

- [ ] **Step 1:** from `backend/`: `.venv/Scripts/python.exe -m alembic current` → the pre-batch head (this batch adds no revision). `.venv/Scripts/python.exe -m alembic check` → `No new upgrade operations detected.` Anything else is a defect to record (Task 6).

### Task 5: The two-theme browser smoke

**Files:** Create `tools/probes/espp-v/smoke.mjs` · Modify `tools/probes/README.md`

- [ ] **Step 1: Start the lane's servers** (never kill the shared ones on 8000/5173):

```bash
cd backend && SCHEDULER_ENABLED=0 nohup .venv/Scripts/python.exe -m uvicorn app.main:app --port 8010 > ../scratchpad/espp-smoke-uvicorn.log 2>&1 &
cd .. && nohup npm run dev -- --port 5174 > scratchpad/espp-smoke-vite.log 2>&1 &
sleep 8 && curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8010/api/v1/health || curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8010/docs
```

Record both PIDs (`netstat -ano | grep -E ":(8010|5174) "`). Mint a token with the dev seed credentials (dev database only):

```bash
OUT=scratchpad/espp-smoke && mkdir -p "$OUT"
curl -s http://127.0.0.1:8010/api/v1/auth/login -H 'content-type: application/json' -d '{"email":"admin@example.com","password":"changeme123"}' | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).access_token))" > "$OUT/token.txt"
```

- [ ] **Step 2: Write `tools/probes/espp-v/smoke.mjs`:**

```js
// tools/probes/espp-v/smoke.mjs - the ESPP visuals smoke (lane V, 2026-09-07 spec §9). Recipe:
// tools/probes/README.md. READ-ONLY BY CONSTRUCTION: every non-GET /api/v1 call is fenced and
// answered from memory (PATCH /prefs included). Needs the lane's own dev stack (uvicorn 8010,
// vite 5174) started from the MERGED main — uvicorn runs without --reload.
// Env: SMOKE_OUT, TOKEN_FILE, APP_BASE, API_BASE, EDGE_PATH, PLAYWRIGHT_CORE, ONLY_THEME.
Object.defineProperty(process, 'version', { value: 'v20.19.0' })
Object.defineProperty(process.versions, 'node', { value: '20.19.0' })
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_CORE ?? 'C:/Users/edyli/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core')
const OUT = process.env.SMOKE_OUT ?? path.join(process.cwd(), 'scratchpad', 'espp-smoke')
mkdirSync(OUT, { recursive: true })
const TOKEN = readFileSync(process.env.TOKEN_FILE ?? path.join(OUT, 'token.txt'), 'utf8').trim()
const BASE = process.env.APP_BASE ?? 'http://localhost:5174'
const API = process.env.API_BASE ?? 'http://127.0.0.1:8010'
const EDGE = process.env.EDGE_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const VIEWPORT = { width: 1600, height: 1000 }
const THEMES = ['dark', 'light'].filter((t) => !process.env.ONLY_THEME || t === process.env.ONLY_THEME)
const NOISE = /favicon|DevTools|\[vite\]|@vite\/client|React DevTools|React Router Future Flag/i
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const files = []
const report = { generatedAt: new Date().toISOString(), base: BASE, themes: THEMES, checks: [], writesBlocked: [], prefsWrites: [], badResponses: [], problems: [] }
const problem = (m) => report.problems.push(m)
const check = (theme, name, ok, observed) => { report.checks.push({ theme, name, ok, observed }); if (!ok) problem(`${theme}: ${name} — observed ${JSON.stringify(observed)}`); return ok }
const note = (theme, name, observed) => report.checks.push({ theme, name, ok: null, observed })
const money = (s) => `$${Number(s).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const INIT = `(() => {
  window.__sig = (cv) => { const w = cv.width, h = cv.height; if (!w || !h) return null; let d; try { d = cv.getContext('2d').getImageData(0, 0, w, h).data } catch { return null }
    const uniq = new Set(); for (let y = 0; y < h; y += 9) for (let x = 0; x < w; x += 9) { const i = (y * w + x) * 4; uniq.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]) }
    return { colors: uniq.size, painted: uniq.size >= 4 } }
  // Cumulative layout shift, the motion smoke's instrument: every unexpected shift since load.
  window.__cls = 0
  try { new PerformanceObserver((list) => { for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value }).observe({ type: 'layout-shift', buffered: true }) } catch {}
  ;(async () => { try { const m = await import('/src/charts/echarts.ts'); window.__echarts = m.echarts } catch (e) { window.__hookError = String(e) } })()
})()`

const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox', '--disable-gpu', '--force-device-scale-factor=1'] })

async function makeContext(theme) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 })
  await ctx.addInitScript(([t, th]) => { localStorage.setItem('finance_token', t); localStorage.setItem('finance.theme', th); localStorage.setItem('finance.chartDecals', 'off') }, [TOKEN, theme])
  await ctx.addInitScript(INIT)
  const themeEntry = { value: theme, updated_at: new Date().toISOString() }
  await ctx.route('**/api/v1/**', async (route) => { const req = route.request(); const m = req.method()
    if (/\/api\/v1\/prefs/.test(req.url())) {
      if (m === 'GET') { let body = { prefs: {} }; try { body = await (await route.fetch()).json() } catch (e) { problem(`GET /prefs unreadable (${e.message})`) }
        body.prefs = { ...body.prefs, theme: themeEntry }; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }) }
      report.prefsWrites.push({ theme, method: m }); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ prefs: { theme: themeEntry } }) }) }
    if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return route.continue()
    report.writesBlocked.push({ theme, method: m, url: req.url() })
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }) })
  return ctx
}

/** The ESPP lots envelope, straight from the API (a GET through page.request — outside the route fence, still a read). */
async function lotsFromApi(page) {
  const res = await page.request.get(`${API}/api/v1/espp/lots`, { headers: { authorization: `Bearer ${TOKEN}` } })
  return res.ok() ? res.json() : null
}

try {
  for (const theme of THEMES) {
    const ctx = await makeContext(theme)
    const page = await ctx.newPage()
    const errors = []
    page.on('response', (r) => { if (r.status() >= 400) report.badResponses.push({ theme, status: r.status(), method: r.request().method(), url: r.url() }) })
    page.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text())) errors.push(m.text()) })
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
    const drain = (step) => { if (!errors.length) return; problem(`${theme} ${step}: console — ${errors.slice(0, 4).join(' | ')}`); errors.length = 0 }
    const shot = async (name, full = false) => { const file = path.join(OUT, `${theme}-${name}.png`); await page.screenshot({ path: file, fullPage: full }); files.push(path.basename(file)) }

    await page.goto(BASE + '/espp', { waitUntil: 'networkidle' }); await sleep(3500)
    // Every chart on this page is above the fold at 1600x1000 except the modeler; scroll once so
    // the reveal timeline paints it, then come back.
    await page.evaluate(() => scrollTo(0, document.body.scrollHeight)); await sleep(1500); await page.evaluate(() => scrollTo(0, 0)); await sleep(1200)

    // A. The strip: five tiles in the FIRST kpi-row, no lone row, no ghost left standing.
    const strip = await page.evaluate(() => { const row = document.querySelector('.page-frame-body .kpi-row'); return { lone: !!document.querySelector('.kpi-row-lone'), tiles: row ? row.querySelectorAll('.stat-tile').length : 0, ghosts: row ? row.querySelectorAll('.skeleton-tile').length : 0,
      labels: row ? [...row.querySelectorAll('.stat-label')].map((l) => l.textContent.replace(/About.*$/, '').trim()) : [], values: row ? [...row.querySelectorAll('.stat-value')].map((v) => v.textContent.trim()) : [] } })
    check(theme, 'the headline row holds five real tiles and no lone row', !strip.lone && strip.tiles === 5 && strip.ghosts === 0, strip)
    check(theme, 'the five tiles are the spec\'s, in order', strip.labels.slice(0, 4).join('|') === 'Market value|Cost basis|Unrealized gain|Shares held' && /^\$25k limit used — \d{4}$/.test(strip.labels[4] ?? ''), strip.labels)
    // …and the strip's figures are the API's own totals block, not a client sum.
    const api = await lotsFromApi(page)
    if (!api) problem(`${theme}: GET /espp/lots failed`)
    else {
      const held = api.totals?.held
      check(theme, 'the API envelope carries the totals block', !!held && !!api.totals?.sold, Object.keys(api.totals ?? {}))
      if (held) {
        const unsold = api.lots.filter((l) => !l.is_sold)
        const sumCost = unsold.reduce((s, l) => s + Number(l.cost_basis), 0).toFixed(2)
        check(theme, 'totals.held.cost_basis equals the sum of the unsold lots\' cost_basis', Number(held.cost_basis).toFixed(2) === sumCost, { held: held.cost_basis, sumCost, unsold: unsold.length })
        check(theme, 'the Cost basis tile prints totals.held.cost_basis', strip.values[1] === money(held.cost_basis), { tile: strip.values[1], api: held.cost_basis })
        check(theme, 'the Market value tile prints totals.held.market_value (or the em dash when unpriced)', held.market_value === null ? strip.values[0] === '—' : strip.values[0] === money(held.market_value), { tile: strip.values[0], api: held.market_value })
        note(theme, 'position per the API', { lots: api.lots.length, held: held.lots, sold: api.totals.sold.lots, quote: api.current_price, quoted_at: api.quoted_at })
      }
    }
    await shot('espp-top'); await shot('espp-full', true)

    // B. The grid: two chart cards, both painted, filling the row to the right edge.
    const grid = await page.evaluate(() => { const g = document.querySelector('.page-frame-body .card-grid'); if (!g) return null; const r = g.getBoundingClientRect()
      const cards = [...g.querySelectorAll(':scope > .chart-card')].map((c) => { const cv = c.querySelector('canvas'); const b = c.getBoundingClientRect(); return { title: c.querySelector('h2')?.textContent.replace(/About.*$/, '').trim(), span: [...c.classList].find((k) => k.startsWith('span-')), painted: cv ? !!(window.__sig(cv) ?? {}).painted : false, right: +((b.right - r.left) / r.width).toFixed(3), skeleton: !!c.querySelector('.chart-card-skeleton'), empty: c.querySelector('.empty-note')?.textContent ?? null } })
      return { cards, coverage: +((Math.max(...cards.map((c) => c.right * r.width)) ) / r.width).toFixed(3) } })
    check(theme, 'two chart cards sit in the grid at span-6 each', !!grid && grid.cards.length === 2 && grid.cards.every((c) => c.span === 'span-6'), grid)
    check(theme, 'the grid row is filled to its right edge', !!grid && grid.coverage >= 0.9, grid?.coverage)
    check(theme, 'the Lot anatomy card painted a canvas (no skeleton, no empty note)', !!grid && grid.cards[0]?.title === 'Lot anatomy' && grid.cards[0].painted && !grid.cards[0].skeleton, grid?.cards[0])
    // The price card may honestly be empty on a book without stored bars; painted OR the honest sentence.
    check(theme, 'the price card painted or explained itself', !!grid && (grid.cards[1]?.painted || /No stored price history|No ESPP ticker/.test(grid.cards[1]?.empty ?? '')), grid?.cards[1])
    if (grid?.cards[0]?.title === 'Lot anatomy') {
      const card = page.locator('section.chart-card').filter({ has: page.locator('h2', { hasText: 'Lot anatomy' }) }).first()
      await card.screenshot({ path: path.join(OUT, `${theme}-anatomy-dollars.png`) }); files.push(`${theme}-anatomy-dollars.png`)
      // C. The toggle swaps the series on the LIVE instance.
      const seriesOf = () => page.evaluate(() => { const c = [...document.querySelectorAll('section.chart-card')].find((x) => /Lot anatomy/.test(x.querySelector('h2')?.textContent ?? '')); const host = c?.querySelector('[_echarts_instance_]')
        const inst = host && window.__echarts ? window.__echarts.getInstanceByDom(host) : null; return inst ? inst.getOption().series.map((s) => s.name) : null })
      const before = await seriesOf()
      await card.locator('.segmented button', { hasText: /^Per share$/ }).click(); await sleep(900)
      const after = await seriesOf()
      check(theme, 'Dollars view: Paid, Bargain element, Appreciation stacked', Array.isArray(before) && before.slice(0, 3).join('|') === 'Paid|Bargain element|Appreciation', before)
      check(theme, 'Per share view: the ladder base, the dots and the subscription diamonds', Array.isArray(after) && after.includes('ladder-base') && after.includes('Price') && after.includes('Subscription price'), after)
      await card.screenshot({ path: path.join(OUT, `${theme}-anatomy-per-share.png`) }); files.push(`${theme}-anatomy-per-share.png`)
      await card.locator('.segmented button', { hasText: /^Dollars$/ }).click(); await sleep(600)
    }
    if (grid?.cards[1]?.painted) { const price = page.locator('section.chart-card').nth(1); await price.screenshot({ path: path.join(OUT, `${theme}-price.png`) }); files.push(`${theme}-price.png`) }

    // D. The lots table closes with totals rows; the modeler card has the meter, not the gauge.
    const tail = await page.evaluate(() => { const modeler = [...document.querySelectorAll('section.card')].find((c) => /Purchase modeler/.test(c.querySelector('h2')?.textContent ?? ''))
      return { totalsRows: document.querySelectorAll('tfoot tr.espp-totals').length, gauge: !!document.querySelector('.gauge'), meters: modeler ? modeler.querySelectorAll('[role="meter"]').length : -1, tiles: modeler ? modeler.querySelectorAll('.kpi-row .stat-tile').length : -1,
        chainWidth: modeler ? Math.round(modeler.querySelector('.chain-meter')?.getBoundingClientRect().width ?? 0) : -1, cardWidth: modeler ? Math.round(modeler.getBoundingClientRect().width) : -1 } })
    check(theme, 'the lots table has at least the held totals row', tail.totalsRows >= 1, tail.totalsRows)
    check(theme, 'the modeler card draws two meter rows and four tiles, and the gauge is gone', !tail.gauge && tail.meters === 2 && tail.tiles === 4, tail)
    check(theme, 'the meter spans the modeler card (no 720px cap)', tail.chainWidth > 0 && tail.cardWidth - tail.chainWidth < 80, { chainWidth: tail.chainWidth, cardWidth: tail.cardWidth })
    const modelerCard = page.locator('section.card').filter({ has: page.locator('h2', { hasText: /Purchase modeler/ }) }).first()
    if (await modelerCard.count()) { await modelerCard.scrollIntoViewIfNeeded(); await sleep(800); await modelerCard.screenshot({ path: path.join(OUT, `${theme}-modeler.png`) }); files.push(`${theme}-modeler.png`) }

    // E. Layout stability and the console.
    const cls = await page.evaluate(() => +window.__cls.toFixed(3))
    check(theme, 'cumulative layout shift stays under 0.1 (the motion batch\'s bar)', cls < 0.1, cls)
    drain('espp')
    await page.close(); await ctx.close()
  }
} finally {
  writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ ...report, files }, null, 1))
  await browser.close()
}
console.log(`checks ${report.checks.filter((c) => c.ok === true).length} ok, ${report.checks.filter((c) => c.ok === false).length} failed, ${report.checks.filter((c) => c.ok === null).length} noted; ${report.writesBlocked.length} writes fenced, ${report.prefsWrites.length} prefs writes stubbed`)
if (report.problems.length) { for (const p of report.problems) console.log('  PROBLEM ' + p); process.exit(1) }
console.log('ESPP SMOKE OK')
```

- [ ] **Step 3: Run it:** `TOKEN_FILE=scratchpad/espp-smoke/token.txt SMOKE_OUT=scratchpad/espp-smoke APP_BASE=http://localhost:5174 API_BASE=http://127.0.0.1:8010 node tools/probes/espp-v/smoke.mjs` → `ESPP SMOKE OK`. On a failure, read `report.json`'s `problems`, then decide: a real defect goes to Task 6; a wrong assumption in the driver (a selector, a benign 4xx on the dev book) is fixed in the driver and re-run — and recorded as a driver fix in Results, never silently.
- [ ] **Step 4: Look at the pictures.** Open `dark-anatomy-dollars.png`, `dark-anatomy-per-share.png`, `dark-price.png`, `dark-modeler.png` and their light twins with the Read tool. Record one line each in Results: are sold lots hollow, does the loss overlay sit over its column, do the two step rules carry their end labels, does the meter's second row read against the first on one scale, does anything clip or collide. These are the spec §9 eyeballs; a clear defect is a Task 6 item.
- [ ] **Step 5: README** — add the table row and a short recipe paragraph after the pace smoke's:

```markdown
| `espp-v/smoke.mjs` | The ESPP page after the 2026-09-07 visuals in both themes: the five-tile strip (no lone row, no ghost standing), its figures against `GET /espp/lots`'s own totals block, the two chart cards painted at span-6 filling one grid row, the `Dollars · Per share` toggle swapping the live instance's series, the two-row chain meter where the gauge stood, the totals rows, CLS < 0.1 and a clean console. READ-ONLY BY CONSTRUCTION — a write fence, not a sweep | needs the dev stack — see below |
```

```markdown
## Running the ESPP smoke (dev only)

Same stack pattern as the calendar recipe (a lane pair on 8010/5174 beside the shared servers), same dev seed token. `TOKEN_FILE=scratchpad/espp-smoke/token.txt SMOKE_OUT=scratchpad/espp-smoke APP_BASE=http://localhost:5174 API_BASE=http://127.0.0.1:8010 node tools/probes/espp-v/smoke.mjs` prints `ESPP SMOKE OK`, or exits 1 listing every problem. Env: `SMOKE_OUT`, `TOKEN_FILE`, `APP_BASE`, `API_BASE`, `EDGE_PATH`, `PLAYWRIGHT_CORE`, `ONLY_THEME`.
```

- [ ] **Step 6: Commit** `git add tools/probes/espp-v tools/probes/README.md && git commit -m "probe(espp): two-theme smoke of the ESPP visuals — strip, cards, toggle, meter, totals, CLS"`

### Task 6: Defects (only if found)

For each defect a gate or the smoke surfaces: write the failing test in the owning suite, fix the product code minimally in the voice of the file, run the suite, commit as `fix(espp): …` with the smoke's observation in the body. Re-run the smoke after the last fix. Record each in Results. Never widen scope here.

### Task 7: Results and the morning notes

Fill in this file (and commit it as `docs(plan): ESPP visuals lane V results`):

| Gate | Observed |
|---|---|
| `git worktree list` | |
| pytest (main, post-merge) | |
| ruff | |
| vitest (count / files) | |
| tsc / eslint | |
| build — EChart chunk kB | |
| alembic current / check | |
| smoke dark / light | |
| CLS dark / light | |
| API cross-check (held cost basis vs sum) | |
| lane servers (PIDs 8010 / 5174) | |
| eyeballs (five lines) | |
| defects fixed | |

Morning notes to carry into the report: the three lane worktrees and branches left in place (`.worktrees/espp-1..3`, `espp-visuals-1..3`) plus the older `.worktrees/hsa`; the two lane servers left running; the test databases `finance_test_e1` and `finance_test_ev` created by the conftest; the prod effect of the backfill floor (the next price refresh fetches NVDA back to Aug 2023); nothing pushed.
