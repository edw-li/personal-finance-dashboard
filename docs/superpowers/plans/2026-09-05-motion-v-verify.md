# Motion & polish — Lane V (verify) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close `docs/superpowers/specs/2026-09-05-motion-polish-design.md` §10 after M2, M1, M3 and M4 have merged to LOCAL main in that order (§11). Four frontend gates green with their counts recorded, and — the point of the lane — a browser smoke that judges MOTION on real frames rather than on markup: chart entrances that last (≥ 300 ms of paint deltas, where the 2026-09-05 audit measured 1–2 frames), a route change that never blanks `#main`, layout that stops jumping when data lands (CLS ≤ 0.05 on the five known offenders), a nav indicator that actually slides, a hint that stays on screen under a stuck scope row, the scroll-linked reveal reading ≈ 0.62 at both viewport edges and 1.0 mid-page, a below-the-fold chart that waits to be seen and then draws once, a drill that morphs without disposing, a theme swap that does not replay entrances, reduced motion that is genuinely zero, and the new error grammar on a stubbed 500. **RULES: the smoke NEVER persists data (every non-GET is fenced and answered from memory, `PATCH /prefs` included), nothing is pushed, production is never touched.**

**Architecture:** Read-only. Two artifacts land in the repo — `tools/probes/motion-v/smoke.mjs` and one row plus one recipe in `tools/probes/README.md` — plus this file's Results and morning sections. The driver is the house pattern of `tools/probes/honest-v/smoke.mjs` (playwright-core out of the npx cache behind the node-version spoof, headless Edge, token + theme seeded with `addInitScript` before first paint, `PATCH /prefs` stubbed, one named `check()` per assertion into `report.json`, exit 1 listing every problem) crossed with the three instruments of the 2026-09-05 UX-pass probes, kept verbatim in shape: the per-frame rAF paint tracer (`ux-pass/charts/probe.mjs` SAMPLER), the buffered `layout-shift` PerformanceObserver (`ux-pass/layout/audit.mjs`), and the in-page ECharts prototype wrapper that logs every `setOption`/`dispose` with its animation fields (`ux-pass/charts/probe.mjs` INIT). Unlike honest-V this driver has a **write fence** instead of a sweep: `ctx.route('**/api/v1/**')` continues GET/HEAD/OPTIONS and fulfils everything else from memory, so a Playwright timeout halfway through leaves the dev book untouched by construction.

**Tech Stack:** vitest 3, TypeScript 5.9, eslint 9, vite build; playwright-core + the installed Edge on node 18 (spoofed to 20); the dev stack — uvicorn `127.0.0.1:8000` (prefix `/api/v1`, no `--reload`) and vite `http://localhost:5173`.

**Worktree / commands:** **MAIN checkout, on `main`, AFTER all four lane branches have merged.** No worktree: every file it reads is one some lane just touched. All commands from the repo root; local commits only — `git push` is never run in this lane. **Prerequisites:** M2 merged first (it owns the tokens the other lanes' `var(--t-xfade, 180ms)` fallbacks shadow), then M1, M3, M4; `git status` clean before Task 1; dev stack up with uvicorn RESTARTED after the merges (the 2026-09-04 trap: without `--reload` an old server answers with old code).

**Done when:** Task 2's four gates are green with their counts recorded against the `e52f435` baseline; `tools/probes/motion-v/smoke.mjs` prints `MOTION SMOKE OK` in both themes with a `report.json` whose `problems` is empty and whose `writesBlocked` accounts for every non-GET the walk provoked; screenshots are in the session scratchpad `motion-smoke/`; the Results table is filled with OBSERVED numbers; the morning notes are written; every checkbox is ticked or struck with a reason on the same line.

---

## File structure

| File | Responsibility |
|---|---|
| `tools/probes/motion-v/smoke.mjs` (new) | The whole motion walk: entrance, route hold, CLS, indicator, hint, reveal, below-fold, drill, theme swap, reduced motion, error grammar |
| `tools/probes/README.md` (modify) | One table row + one "Running the motion smoke" recipe |
| `docs/superpowers/plans/2026-09-05-motion-v-verify.md` (this file) | Ticks, Results, morning notes |

Nothing under `src/` is edited here. A failing check belongs to the lane that owns the file (spec §11) and is fixed as its own `fix(...)` commit on main with the failing check name in the body.

### Task 1: Preflight — the four merges are in and each lane's markup landed

**Files:** none (read-only)

- [x] **Step 1: The tree** — clean status; `d1e0d84 Merge branch 'motion-m2'`, `7b3403e` (M3), `a984224` (M4), `01ba33e` (M1) on top of `5512e0c`.

```bash
git status --short && git log --oneline -8
```

Expected: `git status --short` prints NOTHING; the log shows four lane merges on top of `5512e0c` ("docs(spec): motion & polish batch …").

- [x] **Step 2: The pieces each lane promised** (two greps had stale PATHS, not stale code: the chart component is `src/components/EChart.tsx`, not `src/charts/`, and `describeError` is used by six Settings cards + MonthlyUpdate — the multi-part pages compose `describeLoadFailures`/`errorDetail` instead, so `src/pages/` counts 2, not >10) — a silent grep names the lane that did not land its hook; the matching check below is still run, so it fails loudly instead of being dropped.

```bash
grep -n "t-page\|t-enter\|t-stagger\|t-xfade\|t-nav\|reveal-floor\|reveal-range\|reveal-rise" src/index.css
grep -n "property --enter\|property --reveal\|animation-timeline\|prefers-reduced-motion" src/index.css src/components/panels.css
ls src/theme/motion.ts && grep -n "page-frame-body" src/components/shell/PageFrame.tsx
grep -n "nav-indicator" src/components/Layout.tsx src/components/Layout.css && grep -n "resetKey" src/components/RouteBoundary.tsx
grep -n "getWidth()\|IntersectionObserver\|\.group" src/charts/EChart.tsx
grep -n "xfade" src/components/shell/Feed.tsx src/index.css && grep -n "is-below" src/components/InfoHint.tsx src/components/panels.css
grep -n "describeError" src/api/client.ts && grep -rn "describeError" src/pages/ | wc -l
grep -n "retry" src/components/shell/Feed.tsx
```

Expected: every grep prints at least one line and the `wc -l` prints more than 10. `nav-indicator` and `page-frame-body` do NOT exist on `5512e0c` — finding them is the proof M2 merged.

### Task 2: The four gates

**Files:** none (read-only)

- [x] **Step 1: Run all four, in order, from the repo root** — tsc silent exit 0; eslint exit 0 with **18** warnings (17 baseline + ONE new: `src/components/InfoHint.tsx:21` `hintLabel`, M4's helper export — same benign `react-refresh/only-export-components` class as the other 17); vitest **180 files / 2437 tests passed**, no flake this run; build exit 0.

```bash
npx tsc -b && npx eslint . && npx vitest run && npm run build
```

Expected: `tsc` silent; `eslint` exit 0 (17 pre-existing `react-refresh/only-export-components` warnings are the baseline — a NEW warning is a finding); `vitest` prints `Test Files N passed` / `Tests M passed`, M above the `e52f435` baseline of **175 files / 2364 tests** by the lanes' §10 additions (stagger indices, the CSS `@property`/keyframe pins, EChart resize guard + first-visible deferral + stable group, ChartCard skeleton parity, InfoHint flip, the `describeError` table, per-card form-vs-load errors, the wizard error resource, indicator position) — record both; `npm run build` exits 0 with the chunk table (baseline `index-*.js` 316.72 kB gzip 101.24, `index-*.css` 28.11 kB gzip 6.02 — CSS growing by more than ~3 kB deserves a look, the motion block is small).

- [x] **Step 2: The backend was not in scope — prove it rather than re-running its suite** — `git diff --stat 5512e0c..HEAD -- backend/ alembic/` printed NOTHING; the backend suite was not re-run.

```bash
git diff --stat 5512e0c..HEAD -- backend/ alembic/
```

Expected: EMPTY. If it prints anything, run `cd backend && FINANCE_TEST_DB=finance_test_mv .venv/Scripts/python.exe -m pytest -q` and expect the `e52f435` baseline `1694 passed, 1 skipped`.

### Task 3: The driver — boot, instruments, fence

**Files:** create `tools/probes/motion-v/smoke.mjs`

- [x] **Step 1: Head + the three instruments.** The instruments are the UX-pass probes' own, so every number this lane reports is directly comparable with the audit's. (One instrument fix: the shift observer records each source's PATH and its before/after rect, not just a class name — `div.xfade-veil` alone cannot say which block moved, and naming the block is the whole value of a CLS failure.)

```js
// tools/probes/motion-v/smoke.mjs — the motion & polish smoke (lane V, 2026-09-05 spec §10).
// Recipe: tools/probes/README.md. READ-ONLY BY CONSTRUCTION: every non-GET /api call is fenced and
// answered from memory (PATCH /prefs included), so no run can persist anything. Instruments lifted
// from the 2026-09-05 UX-pass probes: per-frame rAF paint tracer, buffered layout-shift observer,
// ECharts prototype setOption/dispose wrapper. Needs the dev stack, uvicorn restarted after merges.
// Env: SMOKE_OUT, TOKEN_FILE, APP_BASE, EDGE_PATH, PLAYWRIGHT_CORE, ONLY_THEME, ONLY_STEP.
Object.defineProperty(process, 'version', { value: 'v20.19.0' }); Object.defineProperty(process.versions, 'node', { value: '20.19.0' }) // node 18 box, pw wants 20
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'; const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_CORE ?? 'C:/Users/edyli/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core')
const OUT = process.env.SMOKE_OUT ?? path.join(process.cwd(), 'scratchpad', 'motion-smoke'); mkdirSync(OUT, { recursive: true })
const TOKEN = readFileSync(process.env.TOKEN_FILE ?? path.join(OUT, 'token.txt'), 'utf8').trim()
const BASE = process.env.APP_BASE ?? 'http://localhost:5173'
const EDGE = process.env.EDGE_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'; const VIEWPORT = { width: 1440, height: 900 }
const NAV = ['Overview', 'Monthly update', 'Net worth', 'Portfolio', 'Spending', 'Credit cards', 'Paycheck', 'Comp', 'ESPP', 'Taxes', 'Projection', 'Calendar', 'Settings'] // 13 links
const CLS_ROUTES = [['/paycheck', 'Paycheck'], ['/espp', 'ESPP'], ['/comp', 'Comp'], ['/net-worth', 'Net worth'], ['/', 'Overview']]
const ENTRANCE = [['/net-worth', 'Net worth'], ['/taxes', 'Taxes'], ['/portfolio', 'Portfolio']]
const THEMES = ['dark', 'light'].filter((t) => !process.env.ONLY_THEME || t === process.env.ONLY_THEME)
const STEPS = ['entrance', 'nav', 'cls', 'indicator', 'hint', 'reveal', 'belowfold', 'drill', 'themeswap', 'reduced', 'errors'].filter((s) => !process.env.ONLY_STEP || s === process.env.ONLY_STEP)
const NOISE = /favicon|DevTools|\[vite\]|@vite\/client|React DevTools|React Router Future Flag/i
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); const files = []
const report = { generatedAt: new Date().toISOString(), base: BASE, themes: THEMES, steps: STEPS, checks: [], writesBlocked: [], prefsWrites: [], problems: [] }
const problem = (m) => report.problems.push(m); const check = (theme, step, name, ok, observed) => { report.checks.push({ theme, step, name, ok, observed }); if (!ok) problem(`${theme} ${step}: ${name} — observed ${JSON.stringify(observed)}`); return ok }
const note = (theme, step, name, observed) => report.checks.push({ theme, step, name, ok: null, observed })

const INIT = `(() => {
  window.__ls = []; window.__log = []; window.__frames = []; window.__trace = []
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__ls.push({ t: Math.round(e.startTime), v: +e.value.toFixed(4), src: (e.sources || []).slice(0, 3).map((s) => s.node && s.node.tagName ? s.node.tagName.toLowerCase() + '.' + String(s.node.className || '').split(' ')[0] : '?') }) }).observe({ type: 'layout-shift', buffered: true }) } catch {}
  window.__cls = (since) => ({ cls: +window.__ls.filter((s) => s.t >= since).reduce((a, s) => a + s.v, 0).toFixed(4), src: window.__ls.filter((s) => s.t >= since && s.v > 0.005).slice(0, 6) })
  window.__sig = (cv) => { const w = cv.width, h = cv.height; if (!w || !h) return null; let d; try { d = cv.getContext('2d').getImageData(0, 0, w, h).data } catch { return null }
    let hash = 0; const uniq = new Set(); for (let y = 0; y < h; y += 9) for (let x = 0; x < w; x += 9) { const i = (y * w + x) * 4; const k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2]; hash = (hash * 31 + k) >>> 0; uniq.add(k) }
    return { hash, colors: uniq.size, painted: uniq.size >= 4 } }
  window.__paint = (ms) => { window.__frames = []; const t0 = performance.now(); const step = () => { const now = performance.now()
    window.__frames.push({ t: Math.round(now - t0), cards: [...document.querySelectorAll('section.chart-card')].slice(0, 8).map((c) => { const cv = c.querySelector('canvas'); const s = cv ? window.__sig(cv) : null; return { top: Math.round(c.getBoundingClientRect().top), hash: s ? s.hash : null, painted: !!(s && s.painted) } }) })
    if (now - t0 < ms) requestAnimationFrame(step) }; requestAnimationFrame(step) }
  window.__route = (ms) => { window.__trace = []; const t0 = performance.now(); const step = () => { const now = performance.now(); const m = document.getElementById('main'); const h1 = document.querySelector('.page-frame-header h1') || document.querySelector('main h1'); const ind = document.querySelector('.nav-indicator')
    window.__trace.push({ t: Math.round(now - t0), kids: m ? m.childElementCount : -1, chars: m ? m.innerText.trim().length : -1, h1: h1 ? h1.textContent.trim().slice(0, 24) : null, fb: !!document.querySelector('.route-fallback'), tf: ind ? getComputedStyle(ind).transform : null, path: location.pathname })
    if (now - t0 < ms) requestAnimationFrame(step) }; requestAnimationFrame(step) }
  const hook = async () => { try { const m = await import('/src/charts/echarts.ts'); if (window.__hooked) return; window.__hooked = true
    const tmp = document.createElement('div'); const probe = m.echarts.init(tmp, null, { width: 10, height: 10 }); const proto = Object.getPrototypeOf(probe); probe.dispose()
    const title = (i) => { try { const c = i.getDom().closest('section.chart-card'); const h = c && c.querySelector('h2'); return h ? h.textContent.trim().slice(0, 40) : null } catch { return null } }
    const so = proto.setOption; proto.setOption = function (...a) { const o = a[0] || {}; window.__log.push({ kind: 'setOption', t: Math.round(performance.now()), id: this.id, title: title(this), animation: o.animation, animationDuration: o.animationDuration, theme: document.documentElement.dataset.theme }); return so.apply(this, a) }
    const dp = proto.dispose; proto.dispose = function (...a) { window.__log.push({ kind: 'dispose', t: Math.round(performance.now()), id: this.id, title: title(this) }); return dp.apply(this, a) }
  } catch (e) { window.__hookError = String(e) } }; hook()
})()`
```

- [x] **Step 2: The fence and the per-theme context.** `mutate` is the only mutable piece: the errors step flips it to 422 to provoke a validation message that never reaches the server. The per-theme loop then follows honest-V verbatim — `const page = await (await makeContext(theme)).newPage()`, console/`pageerror` drains filtered by `NOISE`, and `shot(name)` writing `${theme}-${name}.png` into `OUT` and pushing to `files`.

```js
const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox', '--disable-gpu', '--force-device-scale-factor=1'] }); let mutate = { status: 200, body: '{}' }
async function makeContext(theme, reducedMotion = 'no-preference') {
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, reducedMotion })
  await ctx.addInitScript(([t, th]) => { localStorage.setItem('finance_token', t); localStorage.setItem('finance.theme', th); localStorage.setItem('finance.chartDecals', 'off') }, [TOKEN, theme])
  await ctx.addInitScript(INIT)
  const themeEntry = { value: theme, updated_at: new Date().toISOString() }
  await ctx.route('**/api/v1/**', async (route) => { const req = route.request(); const m = req.method()
    if (/\/api\/v1\/prefs/.test(req.url())) {
      if (m === 'GET') { let body = { prefs: {} }; try { body = await (await route.fetch()).json() } catch (e) { problem(`GET /prefs unreadable (${e.message})`) }
        body.prefs = { ...body.prefs, theme: themeEntry }; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }) }
      report.prefsWrites.push({ theme, method: m }); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ prefs: { theme: themeEntry } }) }) }
    if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return route.continue()
    report.writesBlocked.push({ theme, method: m, url: req.url(), answeredWith: mutate.status })
    return route.fulfill({ status: mutate.status, contentType: 'application/json', body: mutate.body }) })
  return ctx }
```

### Task 4: The walks — one `check()` per claim in spec §10

**Files:** modify `tools/probes/motion-v/smoke.mjs`

- [x] **Step 1: Entrance, route hold, CLS, indicator** — three driving deviations, each in the driver's header: the entrance's per-card sequence carries its own frame time (the draft indexed the unfiltered frame list with a filtered index), the walk scrolls to the first mounted-but-unpainted chart inside the paint window (M1's one-shot holds every chart under 20% visible — at 1440×900 that is all of Taxes and Portfolio), and each CLS route is loaded TWICE with the worst reported (Paycheck's shift is a race).

```js
// A. chart entrances last (audit: 1–2 frames). Cold load per route, so the entrance IS the first paint.
for (const [route, label] of ENTRANCE) {
  await page.goto(BASE + route, { waitUntil: 'commit' }); await page.evaluate(() => window.__paint(6000)); await sleep(6200); const f = await page.evaluate(() => window.__frames)
  const per = (i) => { const seq = f.map((x) => x.cards[i]).filter(Boolean); const first = seq.findIndex((c) => c.painted); if (first < 0) return null
    let changes = 0, lastT = null; for (let k = first + 1; k < seq.length; k++) if (seq[k].hash !== seq[k - 1].hash) { changes++; lastT = f[k].t }
    return { firstAt: f[first].t, changes, span: lastT === null ? 0 : lastT - f[first].t } }
  const best = (f[0]?.cards ?? []).map((_, i) => per(i)).filter(Boolean).sort((a, b) => b.span - a.span)[0] ?? null
  check(theme, 'entrance', `${label}: a chart draws over ≥300ms of paint deltas`, !!best && best.span >= 300 && best.changes >= 8, best)
  await shot(`entrance-${label.toLowerCase().replace(/\s+/g, '-')}`) }
// B. the 13 nav clicks: #main never empty, the old page holds until the new one paints.
await page.goto(BASE + '/', { waitUntil: 'networkidle' }); await sleep(1500)
for (const label of NAV) {
  const before = await page.evaluate(() => { const h = document.querySelector('.page-frame-header h1'); return h ? h.textContent.trim().slice(0, 24) : null })
  await page.evaluate(() => window.__route(2500)); await page.locator('nav[aria-label="Primary"] .nav-link').filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) }).click(); await sleep(2600)
  const t = await page.evaluate(() => window.__trace); const blank = t.filter((r) => r.kids <= 0 || r.chars <= 0)
  check(theme, 'nav', `${label}: #main is non-empty on every frame`, blank.length === 0, { frames: t.length, blank: blank.slice(0, 3) })
  const arrive = t.findIndex((r) => r.h1 !== null && r.h1 !== before); const held = arrive < 0 ? t : t.slice(0, arrive)
  check(theme, 'nav', `${label}: the old page stays visible until the new one paints`, held.every((r) => r.h1 !== null) && !t.some((r) => r.fb), { holdMs: arrive < 0 ? 'no title change' : t[arrive].t, nullH1: held.filter((r) => r.h1 === null).length }) }
// C. CLS on the five known offenders (audit: 0.15–0.22).
for (const [route, label] of CLS_ROUTES) {
  await page.goto(BASE + route, { waitUntil: 'commit' }); await sleep(4000); const { cls, src } = await page.evaluate(() => window.__cls(0))
  check(theme, 'cls', `${label}: layout shift ≤ 0.05`, cls <= 0.05, { cls, src }); await shot(`cls-${label.toLowerCase().replace(/\s+/g, '-')}`) }
// D. the indicator slides over --t-nav (200ms).
await page.evaluate(() => window.__route(900)); await page.locator('nav[aria-label="Primary"] .nav-link').filter({ hasText: /^\s*Spending\s*$/ }).click(); await sleep(1000)
const ind = (await page.evaluate(() => window.__trace)).filter((r) => r.tf !== null); const moves = ind.filter((r, i) => i > 0 && r.tf !== ind[i - 1].tf); const span = moves.length ? moves.at(-1).t - moves[0].t : null
check(theme, 'indicator', 'the nav indicator transform changes over ~200ms', ind.length > 0 && moves.length >= 4 && span >= 120 && span <= 400, { samples: ind.length, moves: moves.length, spanMs: span }); await shot('nav-indicator')
```

- [x] **Step 2: The hint under a stuck row, the reveal dial, the below-fold chart** — three more: the hint is PARKED 24px under the stuck row (nothing sits there at a fixed scroll of 420 on /net-worth), the reveal parking corrects its own scroll twice (the reveal's own ±4px transform is inside `getBoundingClientRect`, so one computed scroll lands ~7px off and leaves no card straddling the edge) and reads only top-level cards, and "has not painted" counts a container with no canvas at all — zrender builds the canvas on the first render, so a held paint has none.

```js
// E. an InfoHint under the STUCK scope row stays inside the viewport.
await page.goto(BASE + '/net-worth', { waitUntil: 'networkidle' }); await sleep(2000); await page.evaluate(() => scrollTo(0, 420)); await sleep(600)
const stuck = await page.evaluate(() => !!document.querySelector('.page-frame-scope.is-stuck'))
const target = await page.evaluate(() => { const row = document.querySelector('.page-frame-scope'); const b = row ? row.getBoundingClientRect().bottom : 0
  const hits = [...document.querySelectorAll('.info-hint')].filter((x) => { const r = x.getBoundingClientRect(); return r.top > b - 40 && r.top < b + 180 }); if (!hits.length) return false; hits[0].dataset.motionTarget = '1'; return true })
if (!stuck || !target) note(theme, 'hint', 'no hint sits under the stuck row on /net-worth', { stuck, target })
else { await page.locator('.info-hint[data-motion-target]').click(); await sleep(400)
  const hint = await page.evaluate(() => { const b = document.querySelector('.info-hint-bubble'); if (!b) return null; const r = b.getBoundingClientRect(); const el = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2))
    return { rect: [r.top, r.bottom, r.left, r.right].map(Math.round), vh: innerHeight, vw: innerWidth, below: b.classList.contains('is-below'), z: getComputedStyle(b).zIndex, hit: b === el || b.contains(el) } })
  check(theme, 'hint', 'the bubble is fully inside the viewport and is what the cursor would hit', !!hint && hint.rect[0] >= 0 && hint.rect[1] <= hint.vh && hint.rect[2] >= 0 && hint.rect[3] <= hint.vw && hint.hit, hint)
  await shot('infohint-stuck'); await page.keyboard.press('Escape') }
// F. the reveal dial, parked so entry/exit progress is ~0: the reading must be the FLOOR, not "somewhere dim".
const reveal = async (mode) => page.evaluate((m) => { const cards = [...document.querySelectorAll('.page-frame-body .card')]; if (!cards.length) return null
  const low = cards.find((x) => x.getBoundingClientRect().top + scrollY > innerHeight) ?? cards.at(-1); const r = low.getBoundingClientRect()
  if (m === 'park-bottom') { scrollTo(0, r.top + scrollY - innerHeight + 4); return null }   // 4px of the card visible at the bottom
  if (m === 'park-top') { scrollTo(0, r.top + scrollY + r.height - 4); return null }         // 4px of it left at the top
  const val = (x) => +getComputedStyle(x).getPropertyValue('--reveal'); const box = (x) => x.getBoundingClientRect()
  const edge = cards.find((x) => box(x).top < innerHeight && box(x).bottom > innerHeight), top = cards.find((x) => box(x).top < 0 && box(x).bottom > 0)
  const mid = cards.find((x) => box(x).top > 40 && box(x).bottom < innerHeight - 40)
  return { edge: edge ? val(edge) : null, top: top ? val(top) : null, mid: mid ? val(mid) : null, floor: getComputedStyle(document.documentElement).getPropertyValue('--reveal-floor').trim() } }, mode)
await reveal('park-bottom'); await sleep(500); const rev = await reveal('read')
check(theme, 'reveal', 'the card straddling the bottom edge sits at the floor (0.62 ±0.05)', !!rev && rev.edge !== null && Math.abs(rev.edge - 0.62) <= 0.05, rev)
check(theme, 'reveal', 'a mid-page card is fully bright (1.0)', !!rev && rev.mid !== null && rev.mid >= 0.99, rev); await shot('reveal-bottom-edge')
await reveal('park-top'); await sleep(500); const rev2 = await reveal('read')
check(theme, 'reveal', 'the card straddling the TOP edge mirrors the floor (0.62 ±0.05)', !!rev2 && rev2.top !== null && Math.abs(rev2.top - 0.62) <= 0.05, rev2); await shot('reveal-top-edge')
// G. a chart below the fold waits to be seen, then draws ONCE.
await page.goto(BASE + '/portfolio', { waitUntil: 'networkidle' }); await sleep(3000); const idx = await page.evaluate(() => [...document.querySelectorAll('section.chart-card')].findIndex((c) => c.getBoundingClientRect().top > innerHeight))
if (idx < 0) note(theme, 'belowfold', 'no chart card below the fold at 1440x900 on /portfolio', idx)
else { const read = (i) => page.evaluate((n) => { const c = document.querySelectorAll('section.chart-card')[n]; const cv = c.querySelector('canvas'); const h = c.querySelector('h2'); const title = h ? h.textContent.trim().slice(0, 40) : null
    return { title, painted: cv ? !!(window.__sig(cv) || {}).painted : null, setOptions: window.__log.filter((e) => e.kind === 'setOption' && e.title === title).length } }, i)
  const pre = await read(idx); check(theme, 'belowfold', 'a chart below the fold has not painted yet', pre.painted === false, pre)
  await page.evaluate((n) => document.querySelectorAll('section.chart-card')[n].scrollIntoView({ block: 'center' }), idx); await sleep(1600); const post = await read(idx)
  check(theme, 'belowfold', 'it draws once scrolled into view (one-shot)', post.painted === true && post.setOptions > pre.setOptions, { pre, post }); await shot('belowfold-drawn') }
```

- [x] **Step 3: Drill, theme swap, reduced motion, error grammar** — the drill hunts for a click point that actually drills (0.82/0.75 misses this book's bars; 0.60/0.70 lands) and records it, the theme swap is undone after it is measured so later shots match their file names, and the Settings validation message is read off the card's own `.error-banner` (it sits at the FOOT of the form, past the first 400 characters).

```js
// H. the Spending month drill: no dispose, no blank frame (the bar→pie universalTransition morph).
await page.goto(BASE + '/spending', { waitUntil: 'networkidle' }); await sleep(2500); const bar = await page.evaluate(() => { const el = [...document.querySelectorAll('section.chart-card')].find((c) => /spend/i.test(c.querySelector('h2')?.textContent ?? ''))
  const cv = el && el.querySelector('canvas'); if (!cv) return null; const r = cv.getBoundingClientRect(); return { x: r.x + r.width * 0.82, y: r.y + r.height * 0.75 } })
if (!bar) note(theme, 'drill', 'no spending bar chart found', null)
else { await page.evaluate(() => { window.__log.length = 0; window.__paint(2200) }); await page.mouse.click(bar.x, bar.y); await sleep(2400)
  const frames = await page.evaluate(() => window.__frames); const log = await page.evaluate(() => window.__log); const blankFrames = frames.filter((f) => f.cards[0] && f.cards[0].painted === false)
  check(theme, 'drill', 'the drill morphs with no blank frame', blankFrames.length === 0, { frames: frames.length, blank: blankFrames.slice(0, 3) })
  check(theme, 'drill', 'the drill disposes no chart instance', log.filter((e) => e.kind === 'dispose').length === 0, log.filter((e) => e.kind === 'dispose'))
  await shot('drill-pie'); const back = page.getByRole('button', { name: /All months/ }); if (await back.count()) await back.first().click() }
// I. a theme swap re-inits WITHOUT replaying the entrance (the cached-paint rule).
await page.goto(BASE + '/net-worth', { waitUntil: 'networkidle' }); await sleep(3000); await page.evaluate(() => { window.__log.length = 0 })
await page.getByRole('button', { name: /^Switch to (light|dark) theme$/ }).click(); await sleep(1800)
const post = (await page.evaluate(() => window.__log)).filter((e) => e.kind === 'setOption')
check(theme, 'themeswap', 'every setOption after a theme swap is animation-free', post.length > 0 && post.every((e) => e.animation === false || e.animationDuration === 0), post.slice(0, 6)); await shot('theme-swapped')
// J. reduced motion — its own context, so the emulation covers first paint.
if (STEPS.includes('reduced')) { const rctx = await makeContext(theme, 'reduce'); const rpage = await rctx.newPage()
  await rpage.goto(BASE + '/net-worth', { waitUntil: 'networkidle' }); await sleep(3000)
  const rm = await rpage.evaluate(() => { const cs = getComputedStyle(document.documentElement); const tok = (n) => cs.getPropertyValue(n).trim()
    const running = document.getAnimations().filter((a) => { const d = a.effect && a.effect.getTiming().duration; return typeof d === 'number' && d > 0 })
    return { tokens: ['--t-page', '--t-enter', '--t-stagger', '--t-xfade', '--t-nav'].map(tok), floor: tok('--reveal-floor'), animations: running.map((a) => a.animationName || 'anon').slice(0, 5),
      reveals: [...new Set([...document.querySelectorAll('.page-frame-body .card')].map((c) => getComputedStyle(c).getPropertyValue('--reveal').trim()))], charts: window.__log.filter((e) => e.kind === 'setOption').map((e) => e.animation) } })
  check(theme, 'reduced', 'every motion token is 0ms', rm.tokens.every((v) => v === '0ms'), rm.tokens)
  check(theme, 'reduced', 'the reveal floor is 1 and every card reads 1', rm.floor === '1' && rm.reveals.every((v) => Number(v) === 1), { floor: rm.floor, reveals: rm.reveals })
  check(theme, 'reduced', 'no timed animation is running', rm.animations.length === 0, rm.animations)
  check(theme, 'reduced', 'charts init with animation:false', rm.charts.length > 0 && rm.charts.every((a) => a === false), rm.charts.slice(0, 6))
  await rpage.screenshot({ path: path.join(OUT, `${theme}-reduced-motion.png`), fullPage: true }); await rpage.close(); await rctx.close() }
// K. the error grammar: ONE banner on a stubbed 500, no Retry on a validation error.
if (STEPS.includes('errors')) {
  await page.route('**/api/v1/espp/**', (r) => r.request().method() === 'GET' ? r.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"boom"}' }) : r.continue())
  await page.goto(BASE + '/espp', { waitUntil: 'networkidle' }); await sleep(2500); const banners = await page.evaluate(() => [...document.querySelectorAll('.error-banner')].map((b) => ({ text: b.innerText.trim().slice(0, 200), buttons: [...b.querySelectorAll('button')].map((x) => x.textContent.trim()) })))
  check(theme, 'errors', 'a 500 on ESPP yields exactly ONE banner', banners.length === 1, banners)
  check(theme, 'errors', 'the banner speaks the house grammar', banners.length === 1 && /Couldn't load .+ — the server had a problem \(HTTP 500\)/.test(banners[0].text), banners[0] ?? null)
  check(theme, 'errors', 'a load failure offers Retry', banners.length === 1 && banners[0].buttons.some((t) => /Retry/i.test(t)), banners[0] ?? null)
  await shot('espp-500-banner'); await page.unroute('**/api/v1/espp/**')
  mutate = { status: 422, body: '{"detail":[{"loc":["body","name"],"msg":"Value error, name is required"}]}' }   // fenced: the POST never leaves the browser
  await page.goto(BASE + '/settings', { waitUntil: 'networkidle' }); await sleep(2500); const card = page.locator('section').filter({ hasText: /^Accounts/ }).first()
  await card.getByLabel('Account name').fill('zzz-motion-smoke'); await card.getByRole('button', { name: /Add account/ }).click(); await sleep(1200)
  const form = await card.evaluate((el) => ({ text: el.innerText.slice(0, 400), retries: [...el.querySelectorAll('button')].filter((b) => /Retry/i.test(b.textContent)).length }))
  check(theme, 'errors', 'a Settings validation error shows NO Retry', form.retries === 0, form)
  check(theme, 'errors', 'the validation error is stated inline', /required|Couldn't save|invalid/i.test(form.text), form.text.slice(0, 160))
  await shot('settings-validation'); mutate = { status: 200, body: '{}' } }
```

- [x] **Step 4: The exit.** No sweep — the fence answered every write from memory — so the exit says so out loud, and a future edit that opens a hole shows up as a fenced write with no owner.

```js
} finally { writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ ...report, files }, null, 1)); await browser.close() }
console.log(`checks ${report.checks.filter((c) => c.ok === true).length} ok, ${report.checks.filter((c) => c.ok === false).length} failed, ${report.checks.filter((c) => c.ok === null).length} noted; ${report.writesBlocked.length} writes fenced, ${report.prefsWrites.length} prefs writes stubbed`)
if (report.problems.length) { for (const p of report.problems) console.log('  PROBLEM ' + p); process.exit(1) }
console.log('MOTION SMOKE OK')
```

### Task 5: Run it — README row, token, both themes

**Files:** modify `tools/probes/README.md`

- [x] **Step 1: Add one table row and one recipe** in the shape of the honest-V section: what it draws (the eleven motion claims of spec §10), that it needs the dev stack with uvicorn restarted, that it is READ-ONLY unlike honest-V (the fence, not a sweep), and its env list (`SMOKE_OUT`, `TOKEN_FILE`, `APP_BASE`, `EDGE_PATH`, `PLAYWRIGHT_CORE`, `ONLY_THEME`, `ONLY_STEP`).

- [x] **Step 2: Mint a token and run both themes** — 103 ok / 3 failed / 8 noted; 38 PNGs + `report.json` in the session scratchpad `motion-smoke/`; `writesBlocked` holds exactly the two Settings POSTs and `prefsWrites` the four theme PATCHes, nothing else. Exit 1 on the three CLS failures above, which are the lane's output.

```bash
OUT="C:/Users/edyli/AppData/Local/Temp/claude/C--Users-edyli-personal-finance-dashboard/bf88100a-fee8-48d7-845e-35cc94efd91a/scratchpad/motion-smoke"
mkdir -p "$OUT"
curl -s http://127.0.0.1:8000/api/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"admin@example.com","password":"changeme123"}' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).access_token))" > "$OUT/token.txt"
TOKEN_FILE="$OUT/token.txt" SMOKE_OUT="$OUT" node tools/probes/motion-v/smoke.mjs
```

Expected: the checks line, then `MOTION SMOKE OK`, exit 0; `$OUT/report.json` with `problems: []`, `prefsWrites` holding the theme-swap PATCH as stubbed, `writesBlocked` holding the Settings submit (answered 422 by the fence, never sent) and nothing else, and ~30 PNGs (15 per theme). Exit 1 prints every failed check with its observed value — copy those verbatim into Results; a verify lane's failures are its output, not its embarrassment.

- [x] **Step 3: Commit the driver** — `b1ca363`.

```bash
git add tools/probes/motion-v/smoke.mjs tools/probes/README.md
git commit -m "test(probe): the motion smoke — entrances, route hold, CLS, indicator, reveal, drill, reduced motion, error grammar"
```

### Task 6: Tick, record, and write the morning notes

**Files:** modify this plan

- [x] **Step 1: Fill the Results table** with OBSERVED values — the four gate counts, each entrance's `span`/`changes`, each route's CLS with its worst shift source, the indicator span, the three `--reveal` readings, the worst nav hold, and every failed check beside the lane that owns it.
- [x] **Step 2: Tick every checkbox** in this file; a step not run is struck through with its reason on the same line, never left blank.
- [x] **Step 3: Final gate on the tree as it now stands**

```bash
npx tsc -b && npx eslint . && npx vitest run && npm run build
git status --short && git log --oneline -6 && git log --oneline origin/main..main | wc -l
```

Expected: the Task 2 counts unchanged (this lane touched no `src/` file); a clean status; the four lane merges plus this lane's two commits; a non-zero ahead count that was never pushed.

- [x] **Step 4: Update the memory file** for this overnight run: the four merge SHAs, the gate counts, the smoke's screenshot folder and `report.json` path, every deviation, and the morning notes below.

---

## Results (filled by Task 6)

Smoke: `SMOKE_OUT=…/scratchpad/motion-smoke`, both themes, 1440×900 — **103 checks ok, 3 failed, 8
noted**, 38 PNGs + `report.json`. Fenced: the two Settings POSTs (one per theme, answered 422 from
memory, never sent); stubbed: four `PATCH /prefs` (the theme swap and its undo, per theme). Nothing
was written. The three failures are all CLS and all the same shape — a block above the fold that
appears from nothing when its payload lands — and each is named against its owner below.

| Gate / check | Baseline (`e52f435` / 2026-09-05 audit) | Observed |
|---|---|---|
| `npx tsc -b` / `npx eslint .` | silent / exit 0, 17 warnings | silent, exit 0 / exit 0 with **18** — one NEW, `InfoHint.tsx:21 hintLabel` (M4), the same `react-refresh/only-export-components` class as the other 17 |
| `npx vitest run` / `npm run build` | 175 files, 2364 tests / index 316.72 kB, css 28.11 kB | **180 files / 2437 tests** before this lane's fix, **180 / 2439** after; build exit 0, `index-*.js` 319.55 kB (gzip 102.10), `index-*.css` **32.39 kB** (gzip 7.06) — +4.3 kB of CSS for four lanes' motion, skeleton, indicator and hint blocks |
| Entrance span+changes: Net worth / Taxes / Portfolio | 1–2 frames | **468 ms / 26 deltas**, **466 / 27**, **421 / 26** (light: 462/26, 467/27, 436/27). Taxes and Portfolio have NO chart 20 % on screen at 1440×900, so their entrance is the one-shot's, measured after the driver scrolls to it |
| Nav (13 links): blank frames / worst hold | blank frame on first visit | **0 blank frames** in 26 clicks (13 × 2 themes); the old page holds **57–95 ms** before the new title paints; `.route-fallback` never appeared |
| CLS: paycheck / espp / comp / net worth / overview | 0.15–0.22 | worst of two cold loads per theme: **0.0489 / 0.0451** ✅, **0.0365 / 0.0364** ✅ (was 0.104 — fixed here, `b093518`), **0.083 / 0.0559** ❌, **0.0084 / 0.0086** ✅, **0.0001 / 0** ✅ — plus ONE light-theme Paycheck load at **0.3922** ❌ (the same route scored 0.049 on its other load: it is a race, see below) |
| Indicator slide span / InfoHint under stuck row (in-viewport + hit test) | none (per-link box-shadow) / clipped by the scope row | **224 ms** dark / **194 ms** light, 12 transform steps from `translateY(18.7)` to `translateY(185.4)` / bubble at `[118,227]×[419,699]` inside 1440×900, `is-below` **true**, `elementFromPoint` hits the bubble — the flip clears the row, not the z-index (9) |
| `--reveal` bottom edge / mid / top edge | n/a | **0.6366** / **1** / **0.6375**, floor `0.62`, identical in both themes |
| Below-fold deferral / drill disposes / theme-swap replays | n/a / n/a / replayed | "Allocation by industry" is mounted with **no canvas and 0 setOptions** until scrolled to, then **painted with exactly 1** / **0 disposes** across the bar→pie morph, **0 blank frames** in 134 sampled frames / the only `setOption` after a swap carries `animationDuration: 0` — no replay |
| Reduced motion: tokens / floor / chart animation | n/a | `--t-page/-enter/-stagger/-xfade/-nav` all **0ms**; `--reveal-floor: 1` and every card reads 1; **0** timed animations running; every chart `setOption` carries `animation: false` |
| ESPP 500 banners / Settings Retry count | 3 banners / Retry shown | **ONE** banner — "Couldn't load the lots, the offerings and the model — the server had a problem (HTTP 500)" with one Retry / **0** Retry buttons on the fenced 422, which reads "Value error, name is required" inline |

### The three failed checks, beside the lane that owns them

1. **`cls: Comp` 0.0559–0.083 (both themes) — M3, and NOT fixable by a number.** The vesting-tiles
   ghost reserves `FEED_SKELETON.compVesting` (131 px + its 16 px row margin); `VestingTiles` returns
   `null` when the book has no RSU grants (`VestingSchedulePanel.tsx:114`), which this dev book does
   not, so the ghost collapses to zero and everything below it jumps up 147 px. On a book WITH grants
   the ghost stands where the tiles land and this shift does not exist. A smaller ghost cannot fix it
   (the real box is 0 here); the choice is a product one — tiles that render a zero-state, or no ghost
   for a block whose height is unknowable before its payload. The dark run's extra 0.0077 is the
   trajectory chart card resizing (244 → 193 → 342) as its own option lands.
2. **`cls: Paycheck` 0.3922 on ONE of two light loads — M2's shell, the batch's largest shift.** The
   `.page-frame-scope` row is empty (0 px) until `ScopeBar`'s household fetch answers, then becomes
   50 px and moves `.page-frame-body` from y=74 to y=140 — 66 px with the whole viewport below it.
   Whether that beats the first body paint is a race: the same route scored 0.049 on its other load
   and 0.0489/0.0451 in dark. Paycheck is the worst case because the owner chips are its ONLY scope
   control (on Net worth the row is already tall, hence 0.0084). Candidate fixes, all with a
   trade-off the batch's owner should pick: a ghost chip group in `ScopeBar` while the household is
   in flight (perfect for a 2-person book, a small collapse on a 1-person one); a `min-height` on
   `.page-frame-scope` for pages that declare an owner control (same trade); or seeding
   `shell:household` from localStorage so a reload starts warm (against `snapshotCache`'s stated
   "a reload starts clean on purpose").
3. **`cls: ESPP` was 0.104 — FIXED in this lane (`b093518`).** The modeler's $25k strip appeared out
   of nothing at the top of the body and moved every card below it down 118 px. `PageSkeleton` now
   exports `SkeletonTileRow` (sharing one `GhostTile` with the page-level skeleton) and `EsppPage`
   reserves the strip while `modeler === null && modelerBusy`. Measured 0.104 → **0.0365**.

### Noted, not failed

- **8 notes**, all console: the dev book answers `404 GET /api/v1/paycheck/breakdown?person_id=2`
  (the partner has no paycheck profile — the same known non-defect `tools/probes/README.md` records
  for the C7 smoke), and the errors step's own stubbed 500s and fenced 422. No script error, no
  `pageerror`, in either theme.
- The reveal's `mid` reading is `null` at the top-edge parking by construction (three tall cards
  leave no wholly-visible card between the edges); it is read at the bottom-edge parking, where it
  is 1.

## Production notes for the morning

*(Nothing in this batch changes a number — it changes when and how the numbers appear. Written so the morning can tell an intended change from a regression.)*

- **Everything arrives 240 ms later and softer, on purpose.** Route content fades and rises over `--t-page` (240 ms, was 180 ms); cards enter staggered 40 ms apart, capped at six groups; a page that used to snap now settles over roughly a third of a second. The title row and scope row still appear immediately — if THOSE ever animate, that is a defect.
- **Charts animate for the first time.** A first visit to Net worth, Taxes, Portfolio or Spending draws its series in rather than appearing complete. Revisits, scope changes and theme swaps stay instant by design (the cached-paint rule) — an entrance that replays on every scope click is a bug.
- **Below-the-fold charts draw as you scroll to them**, once. A screenshot of a long page taken without scrolling now shows blank canvases below the fold: that is the one-shot IntersectionObserver, not a broken chart.
- **The soft shadow is the product of two dials.** A card at either viewport edge sits at 62 % brightness and rises to full as it scrolls in. Header, scope row, toasts, palette, drawers, modals and the wizard's sticky footer are exempt; print and reduced motion turn it off entirely; a browser without `view()` timelines shows everything at full brightness.
- **Error copy changed shape.** Every failed load reads `Couldn't load {noun} — {detail}`, with 5xx spelled "the server had a problem (HTTP {status})" and network failures "you're offline or the server is unreachable". ESPP, Paycheck and Comp show ONE banner for a multi-part failure instead of two or three. Settings validation messages no longer offer Retry — a Retry button now means "the load failed", nothing else.
- **With OS Reduce Motion on, expect none of it**: zero durations, no stagger, no reveal, no chart entrance (Windows Settings › Accessibility › Visual effects toggles either face).
- **Two shifts this lane could not close, and one it did.** ESPP's $25k strip now reserves its box
  (`b093518`), so that page settles instead of jumping 118 px. Comp still jumps 147 px on a cold load
  BECAUSE this dev book has no RSU grants — on the real book, which has them, that shift should not
  appear; check it once on production and tell the next lane. Paycheck's scope row (the Me/Partner
  chips) is empty until the household answers and then pushes the page down 66 px: it happens on
  perhaps one cold load in three, and it is the largest layout shift left in the app (CLS 0.39 when
  it loses the race). Both are decisions, not bugs to hand to an implementer blind — the options are
  in this file's Results.
- **Watch for, on the real book:** a first paint that feels slower than 09-04 (the hold is meant to keep the OLD page on screen, never a blank), a chart that never draws after being scrolled to, and any card that still jumps as data lands — the last is a skeleton whose reserved height is wrong for production's shape, a per-call-site fix in `Feed`/`ChartCard`, not a token.
