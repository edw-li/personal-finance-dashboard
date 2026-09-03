# Charts C7 — Verify the grammar end to end — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After C2–C6 have merged onto `main`, close the chart-grammar spec (`docs/superpowers/specs/2026-09-03-chart-grammar-design.md` §18 step 3, §17): make `EChart`'s `ariaLabel` required at the compiler, add the structural audits the spec's success criteria name (no `<EChart` outside `ChartCard`, no page-level chart-header markup around a chart, no `empty-note` chart fallback outside the card), prove conformance over every fixture the lanes added, run the full suites, walk every chart page in both themes at 1600 px with the tooltip / heatmap-mode / heat-treemap / log-fan screenshots, and re-run the real-echarts probes for the four new forms. **OVERNIGHT RULE: nothing is deleted tonight.** Everything the spec retires (§18 "delete the header CSS copies, duplicated `AxisTooltipParam`/`roundTo`, `budgetChartOptions.ts`, standalone `ChartZoomHint` usage") is left in place unused and enumerated in the final task's "retire at the end of the night" list for the morning.

**Architecture:** Three grep-based vitest audits over `src/` (mounts, headers, empty notes) sit beside `conformance.test.ts` so the grammar is enforced by the suite, not by review. The smoke driver follows `scratchpad/p4-smoke/ui_smoke_p4.mjs` (puppeteer-core + the installed Edge, real echarts, real dev data, exit 1 on any console error). The probes follow `scratchpad/paycheck-sankey-probe/probe.html` (the app's own `node_modules/echarts/dist/echarts.js` in a static page, screenshotted).

**Tech Stack:** vitest 3, TypeScript 5.9, puppeteer-core + Edge (`C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`), the dev stack (`backend` uvicorn on 127.0.0.1:8000, `vite` on 5173).

**Worktree / commands:** Work on `main` directly in the main checkout AFTER the five lane branches are merged (this plan's edits are small and touch files every lane touched — a worktree would only add a merge). `npx vitest run`, `npx tsc -b`, `npx eslint .`, `npm run build`. Local commits only.

**Done when:** `npx tsc -b` passes with `ariaLabel: string` required; the three audits and the conformance suite are green; `npm run build` stays under the chunk limit; both-theme screenshots for every chart page plus the four hover/mode shots exist in `scratchpad/charts-smoke/`; probe screenshots exist for decals, `markArea`/`markPoint`, the heat-treemap and the price wash; the retire list is written.

---

## File structure

| File | Responsibility |
|---|---|
| `src/components/EChart.tsx` (modify) | `ariaLabel: string` required; `role="img"` unconditional |
| `src/components/EChart.test.tsx` (modify) | Bare mounts in tests pass a label; the "no role without a label" case is removed |
| `src/charts/mounts.audit.test.ts` (new) | Every `<EChart` in `src/**/*.tsx` (tests excepted) is inside `ChartCard.tsx`; no `panel-title-row` / `*-chart-header` wraps a `<ChartCard`; no `empty-note` sits in a ternary with a `<ChartCard` |
| `src/charts/conformance.test.ts` (modify) | Asserts the fixture roster (names) so a lane cannot silently drop one |
| `vite.config.ts` (verify) | Chunk limit holds after all lanes |
| `scratchpad/charts-smoke/ui_smoke_charts.mjs` (new, outside `src/`) | Two-theme walk + hover/mode screenshots |
| `scratchpad/charts-probe/probe.html`, `shoot.mjs` (new) | Four-form probe (re-run of C4/C5's probes against merged `main`) |
| `docs/superpowers/plans/2026-09-04-charts-c7-verify.md` (this file) | The "retire at the end of the night" list, appended as the last task |

---

### Task 1: `ariaLabel` becomes required on `EChart`

**Files:**
- Modify: `src/components/EChart.tsx`, `src/components/EChart.test.tsx`

Spec §14: "`EChart`'s `ariaLabel` becomes required; `ChartCard` forwards its own required prop." C1 added the prop optionally; every lane mounted through `ChartCard` (which requires it), so flipping the type now is the compiler proving F11 for every mount.

- [ ] **Step 1: Flip the type and the role**

In `src/components/EChart.tsx`:

```ts
  // A one-sentence description of what the chart SHOWS (deliberate house wording — ECharts'
  // generated aria is switched off in the decal merge below). REQUIRED since the chart
  // grammar (2026-09-04, spec §14): ChartCard forwards its own required prop, so a nameless
  // mount is a compile error, not a review note.
  ariaLabel: string
```

and the container:

```tsx
      <div
        ref={containerRef}
        role="img"
        aria-label={ariaLabel}
        style={{ height, width: '100%' }}
      />
```

Delete the `role={ariaLabel === undefined ? undefined : 'img'}` comment about the unnamed image.

- [ ] **Step 2: Fix the test file**

In `src/components/EChart.test.tsx`: delete the case `'renders NO role and no label when the prop is absent'`; every other `render(<EChart option={…} … />)` that lacks a label gains `ariaLabel="test chart"` (a find-and-replace of `<EChart option=` with `<EChart ariaLabel="test chart" option=` on the lines that do not already carry one).

- [ ] **Step 3: Type-check the whole tree**

Run: `npx tsc -b`
Expected: PASS. If it fails, the error names a mount outside `ChartCard` that a lane missed — fix it by mounting through `ChartCard` (never by adding a bare label) and note the file for the audit in Task 2.

Run: `npx vitest run src/components/EChart.test.tsx src/components/ChartCard.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/EChart.tsx src/components/EChart.test.tsx
git commit -m "feat(charts): EChart ariaLabel is required — every mount names what it shows (spec §14, F11)"
```

---

### Task 2: The mount audits — the spec's §6 success criteria as tests

**Files:**
- Create: `src/charts/mounts.audit.test.ts`

Spec §6: "no `<EChart` outside `ChartCard` (tests excepted); no page-level chart-header CSS or `.panel-title-row` around a chart; no `empty-note` chart fallback outside the card." Grep-based, so a future page cannot regress silently.

- [ ] **Step 1: Write the audit (it should already pass — if it fails, the failure names the file to fix)**

```ts
// src/charts/mounts.audit.test.ts
// The chart grammar's structural promises (spec §6), enforced over the source tree rather
// than by review. Reads files, renders nothing.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = path.resolve(__dirname, '..')

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) return tsxFiles(full)
    return full.endsWith('.tsx') && !full.endsWith('.test.tsx') ? [full] : []
  })
}

const files = tsxFiles(SRC).map((file) => ({ file: path.relative(SRC, file), text: readFileSync(file, 'utf8') }))
const chartHosts = files.filter(({ text }) => text.includes('<ChartCard'))

describe('chart mounts', () => {
  it('every <EChart sits inside ChartCard.tsx', () => {
    const offenders = files
      .filter(({ file }) => !file.endsWith('ChartCard.tsx') && !file.endsWith('EChart.tsx'))
      .filter(({ text }) => text.includes('<EChart'))
      .map(({ file }) => file)
    expect(offenders).toEqual([])
  })

  it('no page-level chart header markup survives', () => {
    const headerClasses = /networth-chart-header|spending-chart-header|tax-chart-header|projection-chart-header/
    expect(files.filter(({ text }) => headerClasses.test(text)).map(({ file }) => file)).toEqual([])
    // .panel-title-row was the portfolio panels' chart header; the page's Holdings section
    // (not a chart) may keep it.
    const portfolioPanels = files.filter(({ file }) => file.startsWith(path.join('components', 'portfolio')))
    expect(portfolioPanels.filter(({ text }) => text.includes('panel-title-row')).map(({ file }) => file)).toEqual([])
  })

  it('no empty-note fallback is the other branch of a ChartCard', () => {
    const chartOrNote = /\?\s*\(\s*<ChartCard[\s\S]{0,2000}?\)\s*:\s*\(?\s*<(?:p|div) className="empty-note"/
    const noteOrChart = /\?\s*\(?\s*<(?:p|div) className="empty-note"[\s\S]{0,400}?:\s*\(\s*<ChartCard/
    const offenders = chartHosts.filter(({ text }) => chartOrNote.test(text) || noteOrChart.test(text)).map(({ file }) => file)
    expect(offenders).toEqual([])
  })

  it('every ChartCard host names what its charts show (a literal or an expression, never omitted)', () => {
    for (const { file, text } of chartHosts) {
      const mounts = text.match(/<ChartCard[\s\S]*?\/>|<ChartCard[\s\S]*?>/g) ?? []
      for (const mount of mounts) expect(mount.includes('ariaLabel='), `${file}: ${mount.slice(0, 80)}`).toBe(true)
    }
  })
})
```

Run: `npx vitest run src/charts/mounts.audit.test.ts`
Expected: PASS. Any offender listed is a lane's miss: mount it through `ChartCard` (or, for a header class, swap to `chart-card-header`), re-run, and note the fix in the commit body.

- [ ] **Step 2: Commit**

```bash
git add src/charts/mounts.audit.test.ts
git commit -m "test(charts): mount audits — EChart only inside ChartCard, no page chart headers, no empty-note chart fallbacks (spec §6)"
```

---

### Task 3: Conformance over every fixture, then the full suites

**Files:**
- Modify: `src/charts/conformance.test.ts`

- [ ] **Step 1: Pin the fixture roster**

Append to `src/charts/conformance.test.ts` (the file already globs `./fixtures/*.fixture.ts`):

```ts
// Every builder the spec lists (§1: 22 exported builders + the seven lifted inline options)
// has a fixture. Named, so a lane cannot silently drop one — a missing name here is a builder
// the grammar no longer proves anything about.
const ROSTER = [
  // C1
  'grammar-line', 'grammar-stack', 'grammar-heatmap',
  // C2
  'netWorthStack', 'netWorthStackShare', 'netWorthDrill', 'netWorthBridge',
  'overviewNetWorthTrend', 'overviewRecentSpend', 'moneyFlow',
  // C3
  'spendingBars', 'spendingMonthPie', 'spendingHeatmapRow', 'spendingHeatmapVsAverage',
  'spendingSavings', 'spendingTrends', 'spendingSankey',
  // C4
  'portfolioHistory', 'priceHistory', 'heatTreemap', 'allocationDonut', 'dividendIncome',
  // C5
  'projectionFan', 'projectionLog', 'netWorthProjection', 'vestingCalendar', 'tcTrajectory',
  // C6
  'taxWaterfall', 'taxTrend', 'taxYearPie', 'marginalLadder', 'cardValue', 'creditLine', 'paycheckSankey',
]

it('every builder in the spec has a fixture, and every fixture builds a non-null option', () => {
  const names = fixtures.map((f) => f.name)
  for (const expected of ROSTER) expect(names, `missing fixture ${expected}`).toContain(expected)
  for (const fixture of fixtures) expect(fixture.build(), `${fixture.name} built null`).not.toBeNull()
})
```

(`fixtures` is the array the existing glob walk builds. If C2's bridge or C3's small multiples were dropped overnight, remove those names and say so in the commit body — `spendingSmallMultiples` is deliberately not in the roster because it was droppable.)

Run: `npx vitest run src/charts/conformance.test.ts`
Expected: PASS — the output lists one `it` per fixture per rule plus the roster.

- [ ] **Step 2: The full suites and the build**

Run, in order, from the repo root:

```bash
npx tsc -b
npx eslint .
npx vitest run
npm run build
```

Expected: all four pass; `vitest` prints the file and test counts (record them in the commit body — the pre-grammar baseline was 1451+ vitest cases); `build` prints the chart chunk size under the advisory limit. A `vitest` failure here is a cross-lane interaction (two lanes editing one page test's mock, most likely `SpendingPage.test.tsx` or `PortfolioPage.test.tsx`): fix it in place, keeping BOTH lanes' assertions.

- [ ] **Step 3: Commit**

```bash
git add src/charts/conformance.test.ts
git commit -m "test(charts): pin the fixture roster — every spec builder proves the grammar; full suites green after C1–C6"
```

---

### Task 4: Two-theme visual smoke with tooltip and mode screenshots

**Files:**
- Create: `scratchpad/charts-smoke/ui_smoke_charts.mjs` (outside `src/` — the audit's headless walk, not a unit test)

Spec §17 "Visual smoke": every chart page in both themes at 1600 px, hover screenshots of one tooltip per grammar (axis, item, sankey), the heatmap's three modes, the heat-treemap and the log-axis fan; console errors fail the run. Pattern: `scratchpad/p4-smoke/ui_smoke_p4.mjs` (puppeteer-core + the installed Edge, real echarts, real dev data).

- [ ] **Step 1: Start the dev stack**

From the repo root, in two terminals: `cd backend && .venv/Scripts/uvicorn app.main:app --port 8000` and `npm run dev` (Vite on 5173). Write the API token to a file and export `TOKEN_FILE=<path>` the way the p4 driver expects (see its header; the login flow is unchanged).

- [ ] **Step 2: Write the driver**

```js
// scratchpad/charts-smoke/ui_smoke_charts.mjs — chart-grammar smoke (C7 Task 4).
// Real echarts + real data, both themes at 1600px. Exit 1 on ANY console error / pageerror.
import puppeteer from 'puppeteer-core'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const TOKEN = readFileSync(process.env.TOKEN_FILE, 'ascii').trim()
const APP = 'http://127.0.0.1:5173'
const PAGES = ['/', '/net-worth', '/spending', '/portfolio', '/projection', '/comp', '/taxes', '/credit-cards', '/paycheck']
const problems = []

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1600, height: 1000 })
page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`) })
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))

const shot = (name) => page.screenshot({ path: join(here, `${name}.png`), fullPage: true })
const settle = () => new Promise((r) => setTimeout(r, 900)) // entrance 450ms + a refetch beat
const hoverFirstCanvas = async (selector) => {
  const box = await (await page.$(selector))?.boundingBox()
  if (!box) { problems.push(`no canvas for ${selector}`); return }
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.5)
  await new Promise((r) => setTimeout(r, 300))
}

for (const theme of ['dark', 'light']) {
  await page.goto(`${APP}/login`, { waitUntil: 'networkidle0' })
  await page.evaluate((token, t) => {
    localStorage.setItem('finance.token', token) // whatever key the p4 driver seeds — copy it verbatim
    localStorage.setItem('finance.theme', t)
    localStorage.setItem('finance.chartDecals', 'off')
  }, TOKEN, theme)
  for (const path of PAGES) {
    await page.goto(APP + path, { waitUntil: 'networkidle0' })
    await settle()
    const cards = await page.$$eval('.chart-card', (els) => els.length)
    const bare = await page.$$eval('canvas', (els) => els.filter((c) => !c.closest('.chart-card')).length)
    if (bare > 0) problems.push(`${theme} ${path}: ${bare} canvas outside a chart-card`)
    await shot(`${theme}${path === '/' ? '-overview' : path.replaceAll('/', '-')}`)
    console.log(`${theme} ${path}: ${cards} chart cards`)
  }
  // One tooltip per grammar. Axis: the spending bars. Item: the tax waterfall. Sankey: paycheck.
  await page.goto(`${APP}/spending`, { waitUntil: 'networkidle0' }); await settle()
  await hoverFirstCanvas('.chart-card canvas'); await shot(`${theme}-tooltip-axis`)
  for (const mode of ['Absolute', 'Row', 'vs average']) {
    await page.click(`button[aria-label="Heatmap scale"] >> nothing`).catch(() => {})
    const [btn] = await page.$x(`//div[@aria-label="Heatmap scale"]//button[normalize-space()="${mode}"]`)
    if (!btn) { problems.push(`${theme}: no heatmap mode button ${mode}`); continue }
    await btn.click(); await settle(); await shot(`${theme}-heatmap-${mode.replace(' ', '-')}`)
  }
  await page.goto(`${APP}/taxes`, { waitUntil: 'networkidle0' }); await settle()
  await hoverFirstCanvas('.chart-card canvas'); await shot(`${theme}-tooltip-item`)
  await page.goto(`${APP}/paycheck`, { waitUntil: 'networkidle0' }); await settle()
  await hoverFirstCanvas('.chart-card canvas'); await shot(`${theme}-tooltip-sankey`)
  await page.goto(`${APP}/portfolio`, { waitUntil: 'networkidle0' }); await settle()
  const [treemap] = await page.$x('//section[contains(@class,"chart-card")][.//h2[contains(.,"Allocation by industry")]]//canvas')
  if (treemap) { await treemap.scrollIntoView(); await settle(); await shot(`${theme}-heat-treemap`) } else problems.push(`${theme}: heat-treemap card missing`)
  await page.goto(`${APP}/projection`, { waitUntil: 'networkidle0' }); await settle()
  const [log] = await page.$x('//div[@aria-label="Axis scale"]//button[normalize-space()="Log"]')
  if (log) { await log.click(); await settle(); await shot(`${theme}-projection-log`) } else problems.push(`${theme}: Log toggle missing`)
}

await browser.close()
if (problems.length > 0) { console.error(problems.join('\n')); process.exit(1) }
console.log('CHARTS SMOKE OK — screenshots in scratchpad/charts-smoke/')
```

(Remove the stray `page.click(... >> nothing)` line — it is a placeholder for the click you replace with the `$x` lookup below it. Copy the token-seeding line from the p4 driver verbatim; the storage key is the app's, not this file's.)

- [ ] **Step 3: Run it and eyeball**

Run: `node scratchpad/charts-smoke/ui_smoke_charts.mjs`
Expected: `CHARTS SMOKE OK` and 2 × (9 page + 8 detail) screenshots. Open at least: both `-tooltip-axis` shots (rows are swatch · label · right-aligned value, the swatch colours follow the theme), `light-heatmap-vs-average` (orange above / blue below, the legend labelled), `dark-heat-treemap` (industry upper labels, ticker cells with two-line labels), `dark-projection-log` (log ticks, no wash under the projected line, the fan still drawn), and one `-taxes` shot (rate labels on the caps, no right axis). Any console error is a defect to fix before the night ends — not a note.

- [ ] **Step 4: Commit the driver**

```bash
git add scratchpad/charts-smoke/ui_smoke_charts.mjs
git commit -m "chore(charts): two-theme smoke driver with tooltip, heatmap-mode, heat-treemap and log-fan screenshots (spec §17)"
```

---

### Task 5: Real-echarts probes for the four new forms

**Files:**
- Create: `scratchpad/charts-probe/probe.html`, `scratchpad/charts-probe/shoot.mjs`

Spec §17: "Real-echarts probes precede merge for the four new forms (heat-treemap hierarchy, decals, `markArea`, piecewise wash) — the 2026-08-25 lesson." C4 and C5 each ran theirs before merging; this re-runs all four against the merged `main`'s option shapes in one static page using the app's own echarts bundle, the `scratchpad/paycheck-sankey-probe/probe.html` pattern.

- [ ] **Step 1: Write the probe page**

```html
<!doctype html>
<!-- Chart-grammar probe (C7 Task 5): the four new forms drawn by REAL echarts from
     node_modules, with the exact option shapes the builders emit. Not part of the app. -->
<html><head><meta charset="utf-8" />
<style>
  body { background: #171a21; color: #e6e9ef; font: 14px system-ui; margin: 24px; }
  .title { margin: 0 0 6px 2px; font-size: 13px; letter-spacing: .08em; color: #8b93a3; }
  .chart { width: 1100px; height: 320px; margin-bottom: 28px; }
</style></head><body>
<p class="title">A — DECALS: a stacked bar with per-item itemStyle.decal (SURFACE hatching) + aria.decal on</p><div id="a" class="chart"></div>
<p class="title">B — MARKAREA + MARKPOINT: After-FI wash and p10/p50 marks on a dashed target</p><div id="b" class="chart"></div>
<p class="title">C — HEAT-TREEMAP: industry → ticker, levels[2].colorMappingBy value over the diverging tuple</p><div id="c" class="chart"></div>
<p class="title">D — PIECEWISE WASH: Close line with areaStyle.origin at cost, visualMap pieces POSITIVE/NEGATIVE</p><div id="d" class="chart"></div>
<script src="../../node_modules/echarts/dist/echarts.js"></script>
<script>
const SURFACE = '#171a21', INK = '#e6e9ef', MUTED = '#8b93a3', POS = '#3fb968', NEG = '#e05252', BLUE = '#3987e5', ORANGE = '#d95926'
const DIVERGING = ['#f28b57','#e57236','#b85a2a','#6b4436','#272c37','#2b4a7a','#2f6bb8','#4a8ee6','#7fb2f0']
const draw = (id, option) => echarts.init(document.getElementById(id), null, { renderer: 'canvas' }).setOption(option)

draw('a', {
  aria: { enabled: true, label: { enabled: false }, decal: { show: true } },
  grid: { left: 70, right: 24, top: 40, bottom: 28 }, legend: { top: 0 },
  xAxis: { type: 'category', data: ['Nov 20, 2024', 'Feb 19, 2025', 'Nov 18, 2026'] }, yAxis: { type: 'value' },
  series: [
    { name: 'FY24', type: 'bar', stack: 'v', barMaxWidth: 22, color: BLUE, itemStyle: { borderColor: SURFACE, borderWidth: 1 },
      markLine: { silent: true, symbol: 'none', lineStyle: { color: MUTED, width: 1, type: 'dashed' }, label: { show: true, position: 'insideEndTop', color: MUTED, fontSize: 11 }, data: [{ xAxis: 'Nov 18, 2026', label: { formatter: 'Today' } }] },
      data: [11207.5, 3239.13, { value: 4581.27, itemStyle: { decal: { symbol: 'rect', symbolSize: 1, dashArrayX: [1, 0], dashArrayY: [2, 4], rotation: -Math.PI / 4, color: SURFACE } } }] },
    { name: 'FY26', type: 'bar', stack: 'v', barMaxWidth: 22, color: ORANGE, itemStyle: { borderColor: SURFACE, borderWidth: 1 },
      data: [0, 0, { value: 6963.53, itemStyle: { decal: { symbol: 'rect', symbolSize: 1, dashArrayX: [1, 0], dashArrayY: [2, 4], rotation: -Math.PI / 4, color: SURFACE } } }] },
  ],
})

const months = Array.from({ length: 24 }, (_, i) => `M${i + 1}`)
draw('b', {
  grid: { left: 76, right: 24, top: 40, bottom: 28 }, legend: { top: 0 },
  xAxis: { type: 'category', boundaryGap: false, data: months }, yAxis: { type: 'value' },
  series: [
    { name: 'Projected', type: 'line', symbol: 'none', color: BLUE, areaStyle: { opacity: .12 }, data: months.map((_, i) => 100 + i * 8),
      markLine: { silent: true, symbol: 'none', lineStyle: { color: MUTED, width: 1, type: 'dashed' }, label: { show: true, position: 'insideEndTop', color: MUTED, fontSize: 11 }, data: [{ xAxis: 'M13', label: { formatter: 'FI' } }, { xAxis: 'M9', label: { formatter: 'Coast FI' } }] },
      markArea: { silent: true, itemStyle: { color: '#1e222c', opacity: .35 }, label: { show: true, position: 'insideTop', color: MUTED, fontSize: 11, formatter: 'After FI' }, data: [[{ xAxis: 'M13' }, { xAxis: 'M24' }]] } },
    { name: 'FI target', type: 'line', symbol: 'none', lineStyle: { width: 2, type: 'dashed' }, color: MUTED, z: 9, data: months.map(() => 200),
      markPoint: { silent: true, symbol: 'circle', symbolSize: 8, itemStyle: { color: MUTED, borderColor: INK, borderWidth: 1 }, label: { show: true, position: 'top', color: MUTED, fontSize: 11, formatter: (p) => p.name }, data: [{ name: 'p10', coord: ['M10', 200] }, { name: 'p50', coord: ['M13', 200] }] } },
  ],
})

draw('c', {
  series: [{ type: 'treemap', roam: false, nodeClick: false, breadcrumb: { show: false }, visualDimension: 1, visualMin: -0.5, visualMax: 0.5,
    label: { show: true, fontSize: 11, overflow: 'truncate', formatter: (p) => `${p.name}\n${p.value[1] > 0 ? '+' : ''}${Math.round(p.value[1] * 100)}%` },
    levels: [ {}, { upperLabel: { show: true, height: 18, color: MUTED, fontSize: 11 }, itemStyle: { borderColor: SURFACE, borderWidth: 2, gapWidth: 2 } },
      { colorMappingBy: 'value', color: DIVERGING, itemStyle: { borderColor: SURFACE, borderWidth: 1, gapWidth: 1 } } ],
    data: [
      { name: 'Semis', value: [805000, 0], children: [ { name: 'NVDA', value: [600000, 0.5], label: { color: SURFACE } }, { name: 'AMD', value: [200000, -0.1], label: { color: INK } }, { name: 'Other', value: [5000, 0.01], label: { color: INK } } ] },
      { name: 'ETF', value: [195000, 0], children: [ { name: 'VOO', value: [195000, 0.25], label: { color: INK } } ] },
    ] }],
})

const closes = [171, 173, 169.8, 175, 178, 176, 168, 165, 170]
draw('d', {
  grid: { left: 70, right: 24, top: 40, bottom: 28 }, legend: { top: 0 },
  xAxis: { type: 'category', boundaryGap: false, data: closes.map((_, i) => `D${i}`) }, yAxis: { type: 'value', scale: true },
  visualMap: { type: 'piecewise', show: false, seriesIndex: 0, dimension: 1, pieces: [{ gte: 172, color: POS }, { lt: 172, color: NEG }] },
  series: [
    { name: 'Close', type: 'line', symbol: 'none', color: BLUE, lineStyle: { width: 2, color: BLUE }, areaStyle: { opacity: .12, origin: 172 }, data: closes },
    { name: 'Avg cost', type: 'line', symbol: 'none', lineStyle: { width: 2, type: 'dashed' }, color: MUTED, z: 9, data: closes.map(() => 172) },
  ],
})
</script></body></html>
```

```js
// scratchpad/charts-probe/shoot.mjs
import puppeteer from 'puppeteer-core'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const here = dirname(fileURLToPath(import.meta.url))
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', args: ['--no-sandbox', '--disable-gpu'] })
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
await page.setViewport({ width: 1160, height: 1500 })
await page.goto('file:///' + join(here, 'probe.html').replaceAll('\\', '/'), { waitUntil: 'networkidle0' })
await new Promise((r) => setTimeout(r, 1200))
await page.screenshot({ path: join(here, 'probe.png'), fullPage: true })
await browser.close()
if (errors.length) { console.error(errors.join('\n')); process.exit(1) }
console.log('PROBE OK — scratchpad/charts-probe/probe.png')
```

- [ ] **Step 2: Run and judge against the acceptance criteria**

Run: `node scratchpad/charts-probe/shoot.mjs`, then open `probe.png`.

Accept when: **A** the two Nov-2026 segments show diagonal hatching in the card colour over blue/orange and the `Today` rule stands at that column; **B** the shaded region begins at `M13` with "After FI" inside its top edge, both rules carry their labels, the two circles sit ON the dashed target line labelled `p10` / `p50`; **C** two industry blocks with muted upper labels, ticker cells filled from orange (AMD) through neutral (Other) to blue (NVDA), two-line labels legible; **D** the wash is green above the cost rule and red below it, the wash meets the dashed rule (origin at cost, not the floor), and the Close line stays BLUE for its whole length.

If **D**'s line recolours: C4's Task 6 fallback (the stacked-wash technique, two silent series) was supposed to have landed — confirm `priceChartOptions.ts` carries it, and re-run. If **C** paints every cell one colour: `visualDimension` is being ignored at the leaf level — move `visualDimension`, `visualMin`, `visualMax` INTO `levels[2]` (they are per-level options in echarts 6) in `allocationChartOptions.ts`, update the fixture/test pins, and re-run. Any other mismatch is a defect for the morning list, not a silent pass.

- [ ] **Step 3: Commit**

```bash
git add scratchpad/charts-probe/probe.html scratchpad/charts-probe/shoot.mjs
git commit -m "chore(charts): real-echarts probe of decals, markArea/markPoint, the heat-treemap and the piecewise wash (spec §17)"
```

---

### Task 6: The "retire at the end of the night" list

**Files:**
- Modify: this plan (append the list below, filled in with the grep results)

OVERNIGHT RULE: nothing is deleted tonight. Everything the spec retires (§18 step 3) is enumerated here for the morning, each with the grep that proves it unused. Run every grep; where one still finds a use, that use is either a test pinning the retired code (delete together in the morning) or a miss to fix now.

- [ ] **Step 1: Run the greps and record the results next to each item**

| Retire in the morning | Proof it is unused (expect no output outside the item's own file/test) |
|---|---|
| `src/components/spending/budgetChartOptions.ts` + `.test.ts` (absorbed by `charts/reference.ts budgetReference`) | `grep -rn "budgetStepSeries" src --include=*.ts --include=*.tsx` |
| `netWorthStackedTooltipFormatter` in `netWorthChartOptions.ts` (+ its describe) | `grep -rn "netWorthStackedTooltipFormatter" src` |
| `spendingBarsTooltipFormatter` in `spendingChartOptions.ts` (+ its describe) | `grep -rn "spendingBarsTooltipFormatter" src` |
| `historyTooltipFormatter` in `historyChartOptions.ts` (+ its describes) | `grep -rn "historyTooltipFormatter" src` |
| `projectionTooltipFormatter`, `BAND_MARKER` in `projectionChartOptions.ts` (+ tests) | `grep -rn "projectionTooltipFormatter\|BAND_MARKER" src` |
| `vestingTooltipFormatter` in `vestingChartOptions.ts` (+ tests) | `grep -rn "vestingTooltipFormatter" src` |
| `treemapOption` in `allocationChartOptions.ts` (+ tests; the heat-treemap replaced it) | `grep -rn "treemapOption" src` |
| The private `AxisTooltipParam` interfaces still declared in `netWorthChartOptions.ts`, `spendingChartOptions.ts`, `historyChartOptions.ts` (the shared one is `charts/tooltip.ts`) | `grep -rn "interface AxisTooltipParam" src` |
| `EChart`'s `exportConfig` prop and `ChartExportMenu`'s title-less legacy branch (every mount is on `ChartCard`) | `grep -rn "exportConfig=" src --include=*.tsx` (tests excepted) |
| `RangeChips.tsx` (the ScopeBar owns range since shell-1b) | `grep -rn "RangeChips" src` |
| CSS: `.networth-chart-header`, `.networth-chart-controls` (`NetWorthPage.css`); `.spending-chart-header` (`SpendingPage.css`); `.tax-chart-header` (`taxes.css`); `.projection-chart-header`, `.projection-chart-card` (`ProjectionPage.css`); `.panel-title-row`, `.allocation-grid`, `.toggle-row` (`portfolio.css`); `.money-flow-years` (`moneyFlow.css`) | `grep -rn "networth-chart-header\|networth-chart-controls\|spending-chart-header\|tax-chart-header\|projection-chart-header\|projection-chart-card\|panel-title-row\|allocation-grid\|toggle-row\|money-flow-years" src --include=*.tsx` — `panel-title-row` may legitimately remain in `PortfolioPage.tsx`'s Holdings header (not a chart); keep that rule if so |
| `ChartZoomHint` standalone imports outside `ChartCard.tsx` | `grep -rn "ChartZoomHint" src --include=*.tsx` → only `ChartCard.tsx` and its own test |
| `src/charts/fixtures/grammar-*.fixture.ts` — keep (they are the harness's negative-space proof); listed so nobody "cleans" them | — |

Record each grep's output (or "clean") beside the row in this file, then commit the plan.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-09-04-charts-c7-verify.md
git commit -m "docs(charts): retire-at-the-end-of-the-night list with unused-proof greps"
```

---

### Task 7: Final gate

- [ ] `npx tsc -b && npx eslint . && npx vitest run && npm run build` — all green (record counts in the commit body: vitest files/tests, the chart chunk size).
- [ ] `node scratchpad/charts-smoke/ui_smoke_charts.mjs` → `CHARTS SMOKE OK`; `node scratchpad/charts-probe/shoot.mjs` → `PROBE OK`.
- [ ] `git log --oneline main -40` reads: C1 merge, five lane merges, then this plan's commits. Nothing pushed.
- [ ] Update the memory file for the overnight run with: the merge SHAs, the vitest counts, the four probe verdicts, the smoke screenshot folder, the retire list's location, and any deviations taken (the C4 wash fallback, dropped droppables).

---

## Self-review

**Spec coverage:** §14 `ariaLabel` required → Task 1. §6 success criteria (no `<EChart` outside `ChartCard`, no page chart headers, no `empty-note` chart fallbacks) → Task 2. §17 conformance over every builder → Task 3 (the roster names all 22 exported builders' fixtures plus the seven lifted inline options: stack ×2 modes, drill, bridge, bars, pie, heatmap ×2, savings, trends). §17 visual smoke (both themes, 1600 px, tooltip per grammar, heatmap modes, heat-treemap, log fan, console errors fail) → Task 4. §17 real-echarts probes for the four new forms → Task 5. §18 step 3 "delete …" → Task 6 as a list, per the overnight rule. Full suites → Tasks 3 and 7. **Placeholders:** the smoke driver's token-seeding line explicitly says to copy the p4 driver's key; every other step is complete. **Type consistency:** the fixture names in Task 3's roster are exactly the `name` fields the lane plans declare (C1: `grammar-line/stack/heatmap`; C2: `netWorthStack`, `netWorthStackShare`, `netWorthDrill`, `netWorthBridge`, `overviewNetWorthTrend`, `overviewRecentSpend`, `moneyFlow`; C3: `spendingBars`, `spendingMonthPie`, `spendingHeatmapRow`, `spendingHeatmapVsAverage`, `spendingSavings`, `spendingTrends`, `spendingSankey`; C4: `portfolioHistory`, `priceHistory`, `heatTreemap`, `allocationDonut`, `dividendIncome`; C5: `projectionFan`, `projectionLog`, `netWorthProjection`, `vestingCalendar`, `tcTrajectory`; C6: `taxWaterfall`, `taxTrend`, `taxYearPie`, `marginalLadder`, `cardValue`, `creditLine`, `paycheckSankey`).


---

## Retire at the end of the night — the deletion pass (C7 Task 6)

**Nothing below was deleted.** Every row was proved unused by the grep beside it, run on
`charts-c7` after `git merge main` (main @64cf2f6: sandboxes J/P, calendar A/C/D, lifecycle
L1/L2/F1/F2). Counts are `file: hits`. A row that names a test means the test dies WITH the
code it pins — deleting the source alone turns a green suite red.

### Modules

| Retire | Proof (grep over `src`) | Verdict |
|---|---|---|
| `components/spending/budgetChartOptions.ts` + `budgetChartOptions.test.ts` (absorbed by `charts/reference.ts budgetReference`) | `budgetStepSeries` → `budgetChartOptions.ts:10` (decl), `budgetChartOptions.test.ts` ×3, `charts/reference.test.ts` ×3, `charts/reference.ts:4` (comment) | UNUSED by app code. Delete the module, its test, AND `reference.test.ts`'s "budgetReference absorbs budgetStepSeries byte for byte" case (line 22) — it is the only other importer. Drop the naming comment at `reference.ts:4`. |
| `components/RangeChips.tsx` (the ScopeBar owns range since shell-1b) | `RangeChips` → `RangeChips.tsx:18` (decl), `pages/TaxesPage.tsx:619` (PROSE, inside a comment about `.segmented`), `charts/timeZoom.test.ts:79` (PROSE) | UNUSED — no importer, and it has no test file of its own. The two hits are comments; reword them when the file goes. |

### Dead exports (each one's tests go with it)

| Retire | Proof | Verdict |
|---|---|---|
| `netWorthStackedTooltipFormatter` (`networth/netWorthChartOptions.ts`) | decl + `netWorthChartOptions.test.ts` ×3 | Declared, never called outside its test. |
| `spendingBarsTooltipFormatter` (`spending/spendingChartOptions.ts`) | decl + `spendingChartOptions.test.ts` ×3 | Same. |
| `projectionTooltipFormatter` + `BAND_MARKER` (`projection/projectionChartOptions.ts:69, :56`) | 3 hits, ALL inside that file (`:85` is `BAND_MARKER`'s only use, inside the formatter) | Same, and no test pins them — they delete alone. |
| `vestingTooltipFormatter` (`comp/vestingChartOptions.ts`) | 1 hit in all of `src` — the declaration | Pure orphan. |
| `treemapOption` (`portfolio/allocationChartOptions.ts:23`, replaced by `heatTreemapOption`) | decl + `:126` (comment "stays exported until C7 retires it") + `allocationChartOptions.test.ts` ×7 | Delete with its seven cases and the comment. |
| `historyTooltipFormatter` (`portfolio/historyChartOptions.ts:199`) | decl + `:356` comment + `historyChartOptions.test.ts` ×11; prose mentions in `spendingChartOptions.ts:50`, `projectionChartOptions.ts:66` | Unused by app code — the chart's tooltip is `axisTooltip(...)` at `:357`. NOTE the contradiction: `:356` reads "historyTooltipFormatter stays exported and tested (C7)". Decide in the morning: delete both formatter and claim, or keep both. Not a silent choice. |
| `WATERFALL_CATEGORIES` (`taxes/taxChartOptions.ts`) | decl + `taxChartOptions.test.ts` ×3 | Declared, never used outside its test. |
| `foldColor`, `lowestFreeSlot` (`charts/entities.ts`) | decls + `entities.test.ts` ×3 / ×6 | C1 helpers no lane reached for. Delete or keep deliberately — they are entity-colour API, not chart chrome. |
| `GRID_LINE`, `AXIS_LINE` (`charts/theme.ts`) | 1 hit each — the declaration | Palette constants nothing reads (the theme builds its own). Lowest-value row here; keep if the palette is meant to be complete. |
| `EChart`'s `exportConfig` prop + `ChartExportMenu`'s title-less legacy branch | `exportConfig=` → `EChart.test.tsx` ×5 only; `EChart.tsx:34,60,252`; the branch is documented at `ChartExportMenu.tsx:18` (`title?: string`) | Every mount goes through `ChartCard`, which always passes `title`. Retiring the prop makes `ExportConfig.title` required and deletes the legacy branch + those five test cases. |
| The private `interface AxisTooltipParam` copies: `networth/netWorthChartOptions.ts:27`, `spending/spendingChartOptions.ts:32`, `projection/projectionChartOptions.ts:46` (the shared one is `charts/tooltip.ts:15`) | `interface AxisTooltipParam` → those three + `charts/tooltip.ts` | Each is used ONLY by that file's retiring formatter (netWorth `:47`, spending `:59,:67`, projection `:73`) — they die with it. `historyChartOptions.ts` already imports the shared type. |
| The private `roundTo` copy at `components/taxes/marginal.ts:32` | `function roundTo|const roundTo` → `charts/grammar.ts:134` (shared) and `marginal.ts:32` | The last duplicate of the spec's §18 pair. Swap to the shared import. |

### CSS (markup is already gone — these are dead rules)

`grep -rn "…" src --include=*.tsx` finds NO markup for any class below; the one exception is
`panel-title-row`, kept deliberately.

| File | Rules | Note |
|---|---|---|
| `pages/NetWorthPage.css:3, :12` | `.networth-chart-header`, `.networth-chart-controls` | dead |
| `pages/SpendingPage.css:3` | `.spending-chart-header` | dead |
| `components/taxes/taxes.css:13` | `.tax-chart-header` | dead; the file's comments at `:11, :224, :296` reference it |
| `pages/ProjectionPage.css:5, :11` | `.projection-chart-card`, `.projection-chart-header` | dead |
| `pages/ProjectionPage.css:20, :27, :35, :62` | `.projection-form`, `.projection-form label`, `.projection-actions`, `.projection-form .projection-derived` | dead since sandbox J moved the controls into `SliderBox`/`ScenarioPanel`. **KEEP `.sandbox-controls .projection-derived` (`:73`)** — `ScenarioPanel.tsx:175` renders it. The `:71` comment already says the `.projection-form` copy is retired. |
| `components/portfolio/portfolio.css:17, :18` | `.allocation-grid` (+ its media query) | dead |
| `components/portfolio/portfolio.css:62, :63, :93` | `.toggle-row button` rules | dead — `PortfolioPage.css:40` carries its own copy for the page's tab row, and says so |
| `components/overview/moneyFlow.css:4` | `.money-flow-years` | dead |
| `components/portfolio/portfolio.css:14` | `.panel-title-row` | **KEEP** — `PortfolioPage.tsx:666` is the Holdings header, a table, not a chart. `mounts.audit.test.ts` allows exactly this one file; delete the allowance if the row ever goes. |
| `components/panels.css:603` | the comment naming these retirements | delete with them |

### Deliberately NOT retired

`charts/fixtures/grammar-*.fixture.ts` (the harness's negative-space proof), `charts/conformance.ts`
(`checkConformance` is called by its own suite BY DESIGN), and `ChartZoomHint` — `grep -rn
"ChartZoomHint" src --include=*.tsx` finds only `ChartCard.tsx:8,43,134` and its own test, i.e.
the standalone usage the spec wanted gone is ALREADY gone.
