# Charts C4 — Portfolio onto the grammar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the Portfolio charts onto the C1 grammar (`docs/superpowers/plans/2026-09-04-charts-c1-primitives.md`) and land the spec's Portfolio fixes: F4 (the holding price chart gains an `Avg cost` reference line, an above/below-cost wash, dated buy/sell/dividend markers, a "+x% over this window · history since …" footer and `1Y · 3Y · All` chips with unreachable ones disabled), F5 (the industry treemap becomes a heat-treemap: industry → ticker hierarchy, area = market value, fill = unrealized % or day change on the diverging ramp, slivers folded, click → the holding drill-in), the dividends bars and the allocation donut on the grammar, and F7/F9/F11/F12 for every mount (grammar tooltips, persisted legend on the performance chart, `ariaLabel`s on performance/price/dividends, export + Table on all five — CSV added for the price history, the heat-treemap and the donut).

**Architecture:** Builders stay pure in `src/components/portfolio/*ChartOptions.ts` and gain fixtures under `src/charts/fixtures/`. `portfolioHistoryOption` is shared with Overview (C2 mounts it unchanged through `ChartCard`; this lane owns the file). The price chart's markers reuse `buildEventMarkers` over the daily bars (the axis is the bar dates). The heat-treemap uses the treemap's own `levels[].colorMappingBy: 'value'` over the `DIVERGING` tuple (a documented treemap API), with the scale explained in the card footer; a real-echarts probe precedes the merge for both new forms (§17). Panels (`HoldingDetailPanel`, `AllocationPanel`, `DividendsPanel`) and the page's Performance section mount through `ChartCard`; `AllocationPanel` receives the holdings and an `onSelectTicker` callback because the heat-treemap needs per-holding figures the `AllocationResponse` slices do not carry.

**Tech Stack:** React 19, TypeScript 5.9, vitest 3 + @testing-library/react (jsdom; `EChart` mocked as today), ECharts 6.1 via `src/charts/echarts.ts`; puppeteer-core + Edge for the probe (the `scratchpad/paycheck-sankey-probe/` pattern).

**Worktree / commands:** Branch `charts-c4` from `main` AFTER C1 merges; `cmd //c "mklink /J node_modules ..\\..\\node_modules"` once; `npx vitest run <file>`, `npx tsc -b`, `npx eslint <files>` from the worktree root. Local commits only. Read `src/charts/grammar.ts`, `tooltip.ts`, `legend.ts`, `reference.ts`, `markLine.ts`, `scales.ts`, `src/components/ChartCard.tsx`, `src/charts/fixtures/_types.ts`, `src/testing/tooltipRows.ts` first.

**Done when:** no `<EChart` outside `ChartCard` in `PortfolioPage.tsx`, `HoldingDetailPanel.tsx`, `AllocationPanel.tsx`, `DividendsPanel.tsx`; conformance green with this lane's fixtures; the probe screenshots exist in `scratchpad/charts-c4-probe/`; `npx tsc -b`, `npx eslint`, full `npx vitest run` pass.

---

## File structure

| File | Responsibility |
|---|---|
| `src/components/portfolio/historyChartOptions.ts` (modify) | `portfolioHistoryOption(history, live, events, { selected })` on the grammar: `LINE`/`WASH`, `legendFor`, `axisTooltip` with the Events annotation branch; `historyTooltipFormatter` left in place unused |
| `src/components/portfolio/historyChartOptions.test.ts` (modify) | Grid/legend/tooltip pins follow §8/§9/F7 |
| `src/components/portfolio/priceChartOptions.ts` (modify) | `priceHistoryOption(points, { avgCost, events })`, `priceWindowSummary`, `reachableSpans`, `priceHistoryCsv`, `PRICE_SPANS` |
| `src/components/portfolio/priceChartOptions.test.ts` (modify) | F4 pins |
| `src/components/portfolio/allocationChartOptions.ts` (modify) | + `heatTreemapOption(holdings, metric)`, `heatTreemapCsv`, `donutCsv`; `donutOption` tooltip on `itemTooltip`; `treemapOption` left in place unused |
| `src/components/portfolio/allocationChartOptions.test.ts` (modify) | F5 pins, donut tooltip via `tooltipRows` |
| `src/components/portfolio/dividendChartOptions.ts` (modify) | `monthlyIncomeOption` on the grammar |
| `src/components/portfolio/dividendChartOptions.test.ts` (modify) | Pins |
| `src/charts/fixtures/portfolioHistory.fixture.ts`, `priceHistory.fixture.ts`, `heatTreemap.fixture.ts`, `allocationDonut.fixture.ts`, `dividendIncome.fixture.ts` (new) | Conformance fixtures |
| `src/components/portfolio/HoldingDetailPanel.tsx` (modify) | Price `ChartCard` (controls `1Y · 3Y · All`, footer summary, `busy`, `error`, `csv`) |
| `src/components/portfolio/HoldingDetailPanel.test.tsx` (modify) | `Max` → `All`; disabled chips; footer |
| `src/components/portfolio/AllocationPanel.tsx` (modify) | Heat-treemap card (controls `Unrealized · Day change`) + donut card (controls `Type · Account`); new props `holdings`, `onSelectTicker` |
| `src/components/portfolio/DividendsPanel.tsx` (modify) | Dividends `ChartCard` |
| `src/pages/PortfolioPage.tsx` (modify) | Performance `ChartCard` (`zoomable`, `csv`, legend/zoom mirrors); passes `holdings.holdings` + `setDetailTicker` to `AllocationPanel` |
| `src/pages/PortfolioPage.test.tsx` (modify) | Card structure |
| `scratchpad/charts-c4-probe/probe.html`, `shoot.mjs` (new, outside `src/`) | Real-echarts probe: heat-treemap hierarchy labels + the piecewise/`origin` wash |

---

### Task 1: `portfolioHistoryOption` on the grammar

**Files:**
- Modify: `src/components/portfolio/historyChartOptions.ts`, `src/components/portfolio/historyChartOptions.test.ts`
- Create: `src/charts/fixtures/portfolioHistory.fixture.ts`

Named changes: §8 (`grid()` — was `{70,16,32,28}`; `dateAxis` labels every point at ≤ 12), §9 (`LINE` focus, `legendFor` with the page's persisted picks), F7 (`axisTooltip` with the Events annotation branch replaces `historyTooltipFormatter`, which stays exported and tested but unused). Series names, colors, data, the wash, the live ping and its dashed connector are byte-identical.

- [ ] **Step 1: Update and extend the tests**

In `src/components/portfolio/historyChartOptions.test.ts` add imports and cases:

```ts
import { tooltipRows } from '../../testing/tooltipRows'
import { GRID_VARIANTS, compactMoney } from '../../charts/grammar'
import { isGrammarTooltip } from '../../charts/tooltip'

describe('portfolioHistoryOption — grammar', () => {
  const read = (option: unknown) =>
    option as {
      grid: unknown
      legend: { type: string; selected?: Record<string, boolean> }
      xAxis: { boundaryGap?: boolean; axisLabel?: { interval?: number } }
      yAxis: { axisLabel: { formatter: unknown } }
      tooltip: { formatter: (p: unknown) => string; axisPointer?: unknown }
      series: { emphasis?: unknown }[]
    }

  it('wears the money grid, compact ticks, every-date labels and a plain legend with the page picks', () => {
    const option = read(portfolioHistoryOption(history(), null, null, { selected: { 'Cost basis': false } }))
    expect(option.grid).toEqual(GRID_VARIANTS.default)
    expect(option.xAxis.boundaryGap).toBe(false)
    expect(option.xAxis.axisLabel).toEqual({ interval: 0 }) // three points
    expect(option.yAxis.axisLabel.formatter).toBe(compactMoney)
    expect(option.legend.type).toBe('plain')
    expect(option.legend.selected).toEqual({ 'Cost basis': false })
    expect(option.series[0].emphasis).toEqual({ focus: 'series' })
    expect(read(portfolioHistoryOption(history(), null)).legend.selected).toBeUndefined()
  })

  it('F7: value rows in series order, null rows dropped, Events expand into escaped lines with a count', () => {
    const option = read(portfolioHistoryOption(history(), null, EVENT_POINTS))
    expect(isGrammarTooltip(option.tooltip.formatter)).toBe(true)
    expect(option.tooltip.axisPointer).toBeUndefined()
    const parsed = tooltipRows(option.tooltip.formatter([
      { seriesName: 'Portfolio value', seriesType: 'line', axisValueLabel: 'Aug 3, 2026', value: 710000.5, color: PALETTE[0] },
      { seriesName: 'Cost basis', seriesType: 'line', value: null, color: PALETTE[1] },
      {
        seriesName: EVENTS_SERIES, seriesType: 'scatter', value: ['Aug 3, 2026', 710000.5], color: MUTED,
        data: { events: [{ text: 'Buy <X> — 10 sh · Aug 4, 2026' }, { text: 'Dividend VOO — $12.00 · Aug 5, 2026' }] },
      },
    ]))
    expect(parsed.head).toBe('Aug 3, 2026')
    expect(parsed.rows.map((r) => [r.label, r.value])).toEqual([['Portfolio value', '$710,000.50']])
    expect(parsed.notes).toEqual(['<strong>2 events</strong>', 'Buy &lt;X&gt; — 10 sh · Aug 4, 2026', 'Dividend VOO — $12.00 · Aug 5, 2026'])
  })
})
```

Move the `EVENT_POINTS` const above this describe (it is declared lower in the file today) or import order will fail. Delete nothing else — `historyTooltipFormatter`'s own describe blocks keep passing.

Run: `npx vitest run src/components/portfolio/historyChartOptions.test.ts`
Expected: FAIL — `selected` is not accepted; grid is the old literal; the formatter is not branded.

- [ ] **Step 2: Rewrite the option body**

In `src/components/portfolio/historyChartOptions.ts` add imports:

```ts
import { LINE, WASH, dateAxis, grid, moneyAxis } from '../../charts/grammar'
import { legendFor } from '../../charts/legend'
import { axisTooltip } from '../../charts/tooltip'
import type { AxisTooltipParam } from '../../charts/tooltip'
```

Add, above `portfolioHistoryOption`:

```ts
/** The Events row's tooltip lines: a count first when clustered, then each event's text —
 *  tickers are server text, so escaped (the annotation callback escapes its own output). */
export function eventLines(param: AxisTooltipParam): string[] {
  const events = (param.data as { events?: { text: string }[] } | undefined)?.events ?? []
  return [
    ...(events.length > 1 ? [`<strong>${events.length} events</strong>`] : []),
    ...events.map((event) => escapeHtml(event.text)),
  ]
}
```

Replace the signature and the returned object:

```ts
export function portfolioHistoryOption(
  history: PortfolioHistory,
  live: LivePoint | null,
  events: ChartEventPoint[] | null = null,
  { selected }: { selected?: Record<string, boolean> } = {},
): EChartsOption | null {
  // … unchanged: lastDate/lastValue/livePt/extendAxis/categories/lineData …

  // Fixed validated palette slots (charts/theme.ts law): value=slot 1 blue, cost basis=slot 2
  // orange, S&P=slot 3 aqua, contribution benchmark=slot 4 yellow. The wash rides the value
  // line ONLY. LINE carries the 2px/no-symbol/focus posture (§9).
  const lineSeries = (name: string, values: (string | null)[], color: string, wash: boolean) => ({
    ...LINE,
    name,
    color,
    ...(wash ? WASH : {}),
    data: lineData(values),
  })

  const benchmark = history.benchmark ?? []
  const showBenchmark = benchmark.some((v) => v !== null)
  const series = [
    lineSeries('Portfolio value', history.market_value, PALETTE[0], true),
    lineSeries('Cost basis', history.cost_basis, PALETTE[1], false),
    lineSeries('S&P 500 baseline', history.sp500, PALETTE[2], false),
    ...(showBenchmark ? [lineSeries('VOO (your contributions)', benchmark, PALETTE[3], false)] : []),
    ...(events !== null && events.length > 0 ? [/* the Events scatter — unchanged */] : []),
    ...(livePt ? [/* the Live effectScatter with its markLine — unchanged */] : []),
  ]

  return {
    grid: grid(),
    legend: legendFor(series.length, selected),
    xAxis: dateAxis(categories),
    // No scale:true — a washed area over a visible axis needs the honest zero baseline.
    yAxis: moneyAxis(),
    tooltip: axisTooltip({ unit: 'money', annotationSeries: [EVENTS_SERIES], annotations: eventLines }),
    series,
  }
}
```

(Keep the Events and Live series objects exactly as they are today — only the wrapper around them changed.)

- [ ] **Step 3: Add the fixture**

```ts
// src/charts/fixtures/portfolioHistory.fixture.ts
import type { ChartFixture } from './_types'
import { portfolioHistoryOption } from '../../components/portfolio/historyChartOptions'

const fixture: ChartFixture = {
  name: 'portfolioHistory',
  kind: 'cartesian',
  ariaLabel: 'Line chart of portfolio value against cost basis and benchmark lines, weekly',
  build: () =>
    portfolioHistoryOption(
      {
        dates: ['2026-07-27', '2026-08-03', '2026-08-10'],
        market_value: ['700000.00', '710000.50', '718422.07'],
        cost_basis: ['395000.00', '399542.36', '400243.74'],
        sp500: ['96000.00', '97000.00', '98636.70'],
        benchmark: ['96000.00', '97250.00', '99001.13'],
      },
      { date: '2026-08-14', value: 723456.78 },
      [{ value: ['Aug 3, 2026', 710000.5], symbol: 'triangle', symbolRotate: 0, events: [{ text: 'Buy NVDA — 10 sh · Aug 4, 2026' }] }],
    ),
}
export default fixture
```

Run: `npx vitest run src/components/portfolio/historyChartOptions.test.ts src/charts/conformance.test.ts src/pages/OverviewPage.test.tsx src/pages/PortfolioPage.test.tsx`
Expected: PASS (the pages still spread over `legend`; they change in Task 5 / C2).

- [ ] **Step 4: Commit**

```bash
git add src/components/portfolio/historyChartOptions.ts src/components/portfolio/historyChartOptions.test.ts src/charts/fixtures/portfolioHistory.fixture.ts
git commit -m "feat(portfolio): performance builder on the grammar — money grid, LINE/WASH, legendFor(selected), axisTooltip with Events lines (§8, §9, F7)"
```

---

### Task 2: The holding price chart with F4

**Files:**
- Modify: `src/components/portfolio/priceChartOptions.ts`, `src/components/portfolio/priceChartOptions.test.ts`
- Create: `src/charts/fixtures/priceHistory.fixture.ts`

F4: `referenceLine('Avg cost')`, an above/below-cost wash (a piecewise `visualMap` on the Close series with `areaStyle.origin` at the cost, POSITIVE above / NEGATIVE below at 0.12 — a probe in Task 6 confirms the line itself stays blue), dated buy/sell/dividend markers (`buildEventMarkers` over the daily bars — the panel passes them in), the footer sentence, chips `1Y · 3Y · All` (`Max` → `All`) with unreachable ones disabled. §8: a legend appears (Close · Avg cost · Events) so the grid is `default` (was `{70,16,16,28}`); `dateAxis`; `moneyAxis({ zero: false })` stays — the wash's origin is the cost rule, not the floor, so a scaled axis does not misrepresent it (the §8 rule's rationale).

- [ ] **Step 1: Rewrite the test**

Replace `src/components/portfolio/priceChartOptions.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { EChartsOption } from '../../charts/echarts'
import { GRID_VARIANTS, compactMoney } from '../../charts/grammar'
import { INK, MUTED, NEGATIVE, PALETTE, POSITIVE } from '../../charts/theme'
import { isGrammarTooltip } from '../../charts/tooltip'
import { tooltipRows } from '../../testing/tooltipRows'
import type { PricePoint } from '../../types/api'
import { EVENTS_SERIES } from './historyChartOptions'
import { PRICE_SPANS, priceHistoryCsv, priceHistoryOption, priceWindowSummary, reachableSpans } from './priceChartOptions'

const POINTS: PricePoint[] = [
  { d: '2026-08-10', c: '171.2500' },
  { d: '2026-08-11', c: '173.0000' },
  { d: '2026-08-12', c: '169.8000' },
]
const EVENT = { value: ['Aug 11, 2026', 173] as [string, number], symbol: 'triangle' as const, symbolRotate: 0, events: [{ text: 'Buy NVDA — 10 sh · Aug 11, 2026' }] }

function read(option: EChartsOption | null) {
  expect(option).not.toBeNull()
  return option as unknown as {
    dataZoom: { type: string; startValue: number }[]
    grid: unknown
    legend: { type: string }
    xAxis: { data: string[]; boundaryGap?: boolean }
    yAxis: { scale?: boolean; axisLabel: { formatter: unknown } }
    visualMap?: { type: string; show: boolean; seriesIndex: number; dimension: number; pieces: { gte?: number; lt?: number; color: string }[] }
    tooltip: { formatter: (p: unknown) => string }
    series: { name: string; type: string; color?: string; z?: number; lineStyle?: { color?: string; type?: string }; areaStyle?: { opacity: number; origin: number }; data: unknown[] }[]
  }
}

describe('priceHistoryOption', () => {
  it('returns null under two points — one manual bar is not a line', () => {
    expect(priceHistoryOption({ points: [], avgCost: null })).toBeNull()
    expect(priceHistoryOption({ points: [POINTS[0]], avgCost: '100' })).toBeNull()
  })

  it('draws the closes as a blue line under date categories, scaled axis, whole-window zoom', () => {
    const option = read(priceHistoryOption({ points: POINTS, avgCost: null }))
    expect(option.xAxis.data).toEqual(['Aug 10, 2026', 'Aug 11, 2026', 'Aug 12, 2026'])
    expect(option.xAxis.boundaryGap).toBe(false)
    expect(option.series.map((s) => s.name)).toEqual(['Close'])
    expect(option.series[0]).toMatchObject({ type: 'line', color: PALETTE[0], lineStyle: { width: 2, color: PALETTE[0] } })
    expect(option.series[0].data).toEqual([171.25, 173, 169.8])
    expect(option.series[0].areaStyle).toBeUndefined() // no cost → no wash
    expect(option.visualMap).toBeUndefined()
    expect(option.yAxis.scale).toBe(true)
    expect(option.yAxis.axisLabel.formatter).toBe(compactMoney)
    expect(option.dataZoom[0]).toMatchObject({ type: 'inside', startValue: 0 })
    expect(option.grid).toEqual(GRID_VARIANTS.default)
    expect(option.legend.type).toBe('plain')
  })

  it('F4: an Avg cost reference, a wash anchored at the cost coloured above/below it, and event markers', () => {
    const option = read(priceHistoryOption({ points: POINTS, avgCost: '172.0000', events: [EVENT] }))
    expect(option.series.map((s) => s.name)).toEqual(['Close', 'Avg cost', EVENTS_SERIES])
    expect(option.series[0].areaStyle).toEqual({ opacity: 0.12, origin: 172 })
    expect(option.series[1]).toMatchObject({ color: MUTED, z: 9, lineStyle: { type: 'dashed' } })
    expect(option.series[1].data).toEqual([172, 172, 172])
    expect(option.series[2]).toMatchObject({ type: 'scatter', color: MUTED, z: 11 })
    expect(option.series[2].data).toEqual([EVENT])
    expect(option.visualMap).toEqual({
      type: 'piecewise', show: false, seriesIndex: 0, dimension: 1,
      pieces: [{ gte: 172, color: POSITIVE }, { lt: 172, color: NEGATIVE }],
    })
  })

  it('F7: Close first, Avg cost as a muted reference, events as lines; null closes dropped', () => {
    const option = read(priceHistoryOption({ points: POINTS, avgCost: '172.0000', events: [EVENT] }))
    expect(isGrammarTooltip(option.tooltip.formatter)).toBe(true)
    const parsed = tooltipRows(option.tooltip.formatter([
      { seriesName: 'Close', seriesType: 'line', axisValueLabel: 'Aug 11, 2026', value: 173, color: PALETTE[0] },
      { seriesName: 'Avg cost', seriesType: 'line', value: 172, color: MUTED },
      { seriesName: EVENTS_SERIES, seriesType: 'scatter', value: ['Aug 11, 2026', 173], color: MUTED, data: EVENT },
    ]))
    expect(parsed.rows.map((r) => [r.kind, r.label, r.value])).toEqual([['row', 'Close', '$173.00'], ['ref', 'Avg cost', '$172.00']])
    expect(parsed.notes).toEqual(['Buy NVDA — 10 sh · Aug 11, 2026'])
    expect(option.tooltip.formatter([{ seriesName: 'Close', seriesType: 'line', value: null }])).toBe('')
  })
})

describe('priceWindowSummary / reachableSpans / priceHistoryCsv', () => {
  it('summarises the window: signed change first-to-last and the first date', () => {
    expect(priceWindowSummary(POINTS)).toEqual({ changePct: (169.8 - 171.25) / 171.25, since: 'Aug 10, 2026' })
    expect(priceWindowSummary([])).toBeNull()
  })
  it('spans: All replaces Max; a full response leaves every span reachable', () => {
    expect(PRICE_SPANS.map((s) => s.label)).toEqual(['1Y', '3Y', 'All'])
    // Asked for 365 days and got them all: the extent is unknown → nothing is disabled.
    const full = [{ d: '2025-09-03', c: '1' }, { d: '2026-09-03', c: '2' }]
    expect(reachableSpans(full, 365, '2026-09-03')).toEqual({ 365: true, 1095: true, 3650: true })
  })
  it('a truncated response reveals the extent: the first span that covers everything stays, longer ones are unreachable', () => {
    // 200 days of history when 365 were asked: 1Y already shows everything.
    const short = [{ d: '2026-02-15', c: '1' }, { d: '2026-09-03', c: '2' }]
    expect(reachableSpans(short, 365, '2026-09-03')).toEqual({ 365: true, 1095: false, 3650: false })
    // 400 days when 1095 were asked: 1Y is a real window, 3Y covers everything, All is moot.
    const mid = [{ d: '2025-07-30', c: '1' }, { d: '2026-09-03', c: '2' }]
    expect(reachableSpans(mid, 1095, '2026-09-03')).toEqual({ 365: true, 1095: true, 3650: false })
    expect(reachableSpans([], 365, '2026-09-03')).toEqual({ 365: true, 1095: true, 3650: true })
  })
  it('exports date and close', () => {
    expect(priceHistoryCsv(POINTS)).toEqual({ headers: ['Date', 'Close'], rows: [['2026-08-10', '171.2500'], ['2026-08-11', '173.0000'], ['2026-08-12', '169.8000']] })
  })
})
```

Run: `npx vitest run src/components/portfolio/priceChartOptions.test.ts`
Expected: FAIL — the signature is `(points)`; new exports missing.

- [ ] **Step 2: Rewrite the module**

```ts
// src/components/portfolio/priceChartOptions.ts
// Pure option builder for the holding drill-in's price chart — no React, no fetching. Number()
// here is display-only: the server's Decimal strings are parsed once and never handed back.
import type { EChartsOption } from '../../charts/echarts'
import { LINE, dateAxis, grid, moneyAxis } from '../../charts/grammar'
import { legendFor } from '../../charts/legend'
import { referenceLine } from '../../charts/reference'
import { INK, MUTED, NEGATIVE, PALETTE, POSITIVE } from '../../charts/theme'
import { timeZoom } from '../../charts/timeZoom'
import { axisTooltip } from '../../charts/tooltip'
import type { PricePoint } from '../../types/api'
import type { ExportTable } from '../../utils/download'
import { formatDate } from '../../utils/format'
import { EVENTS_SERIES, eventLines } from './historyChartOptions'
import type { ChartEventPoint } from './historyChartOptions'

/** Fetch windows (they move the REQUEST — ?days=), not zooms. 'All' replaces 'Max' (F13). */
export const PRICE_SPANS = [
  { days: 365, label: '1Y' },
  { days: 1095, label: '3Y' },
  { days: 3650, label: 'All' },
] as const
export type SpanDays = (typeof PRICE_SPANS)[number]['days']

export interface PriceChartInput {
  points: PricePoint[]
  /** The holding's average cost; null before any dated buy. */
  avgCost: string | null
  /** Dated buys/sells/dividends snapped to the daily bars (buildEventMarkers over `points`). */
  events?: ChartEventPoint[]
}

/**
 * Daily closes for ONE security, with the cost rule and the above/below-cost wash (F4).
 * Returns null under two points — a manual-priced security accrues one bar per hand entry.
 */
export function priceHistoryOption({ points, avgCost, events = [] }: PriceChartInput): EChartsOption | null {
  if (points.length < 2) return null
  const cost = avgCost === null ? null : Number(avgCost)
  const series = [
    {
      ...LINE,
      name: 'Close',
      color: PALETTE[0],
      // The line's colour is set EXPLICITLY so the piecewise visualMap below reaches the wash
      // and not the stroke (the probe in Task 6 is what holds this claim).
      lineStyle: { width: 2, color: PALETTE[0] },
      // The wash's ORIGIN is the cost — the fill lives between the line and the rule, which is
      // why the scaled (zero: false) axis does not misrepresent it (§8's rationale).
      ...(cost === null ? {} : { areaStyle: { opacity: 0.12, origin: cost } }),
      data: points.map((p) => Number(p.c)),
    },
    ...(cost === null ? [] : [referenceLine('Avg cost', points.map(() => cost))]),
    ...(events.length > 0
      ? [
          {
            type: 'scatter' as const,
            name: EVENTS_SERIES,
            color: MUTED,
            symbolSize: 9,
            itemStyle: { borderColor: INK, borderWidth: 1 },
            z: 11,
            data: events,
          },
        ]
      : []),
  ]
  return {
    // 'all': the chips change the FETCH window, so the zoom opens on everything it was handed.
    dataZoom: timeZoom(points.map((p) => p.d), 'all'),
    grid: grid(),
    legend: legendFor(series.length),
    tooltip: axisTooltip({ unit: 'money', references: ['Avg cost'], annotationSeries: [EVENTS_SERIES], annotations: eventLines }),
    xAxis: dateAxis(points.map((p) => formatDate(p.d))),
    // scale, unlike the money charts' zero anchor: a price line has no additive reading, and
    // pinning a ~$580 close to a $0 floor flattens the year to a ribbon.
    yAxis: moneyAxis({ zero: false }),
    ...(cost === null
      ? {}
      : {
          // Above cost reads POSITIVE, below NEGATIVE — the one status use a series wash is
          // allowed (spec §12). Hidden: the rule and the footer already say what it means.
          visualMap: {
            type: 'piecewise' as const,
            show: false,
            seriesIndex: 0,
            dimension: 1,
            pieces: [{ gte: cost, color: POSITIVE }, { lt: cost, color: NEGATIVE }],
          },
        }),
    series,
  }
}

/** The footer's figures: change over the fetched window and where the history begins. */
export function priceWindowSummary(points: PricePoint[]): { changePct: number; since: string } | null {
  if (points.length === 0) return null
  const first = Number(points[0].c)
  const last = Number(points[points.length - 1].c)
  return { changePct: first === 0 ? 0 : (last - first) / first, since: formatDate(points[0].d) }
}

const DAY = 86_400_000
const dayNumber = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return Date.UTC(y, m - 1, d) / DAY
}
// A week of slack: bars are trading days, so a full year of history is short of 365 rows.
const SLACK_DAYS = 7

/**
 * Which spans are worth offering. A response SHORTER than the window it asked for reveals the
 * whole extent of the history; every span longer than the first one that already covers it
 * would fetch the same rows again, so those chips are disabled. A full-length response says
 * nothing about longer spans, so every chip stays live.
 */
export function reachableSpans(points: PricePoint[], requestedDays: number, todayIso: string): Record<SpanDays, boolean> {
  const all: Record<SpanDays, boolean> = { 365: true, 1095: true, 3650: true }
  if (points.length === 0) return all
  const covered = dayNumber(todayIso) - dayNumber(points[0].d)
  if (covered >= requestedDays - SLACK_DAYS) return all
  let covering = false
  for (const span of PRICE_SPANS) {
    if (covering) all[span.days] = false
    else if (span.days > covered + SLACK_DAYS) covering = true // this span shows everything
  }
  return all
}

/** The fetched window as a table (F12): date, close — verbatim strings. */
export function priceHistoryCsv(points: PricePoint[]): ExportTable {
  return { headers: ['Date', 'Close'], rows: points.map((p) => [p.d, p.c]) }
}
```

(`eventLines` is exported by Task 1's `historyChartOptions.ts`.)

- [ ] **Step 3: Add the fixture**

```ts
// src/charts/fixtures/priceHistory.fixture.ts
import type { ChartFixture } from './_types'
import { priceHistoryOption } from '../../components/portfolio/priceChartOptions'

const fixture: ChartFixture = {
  name: 'priceHistory',
  kind: 'cartesian',
  ariaLabel: 'Line chart of daily closing prices against the average cost',
  dashed: ['Avg cost'],
  build: () =>
    priceHistoryOption({
      points: [{ d: '2026-08-10', c: '171.25' }, { d: '2026-08-11', c: '173.00' }, { d: '2026-08-12', c: '169.80' }],
      avgCost: '172.00',
      events: [{ value: ['Aug 11, 2026', 173], symbol: 'triangle', symbolRotate: 0, events: [{ text: 'Buy NVDA — 10 sh · Aug 11, 2026' }] }],
    }),
}
export default fixture
```

Run: `npx vitest run src/components/portfolio/priceChartOptions.test.ts src/charts/conformance.test.ts`
Expected: PASS. (`HoldingDetailPanel.test.tsx` fails until Task 5 changes the call site — expected.)

- [ ] **Step 4: Commit**

```bash
git add src/components/portfolio/priceChartOptions.ts src/components/portfolio/priceChartOptions.test.ts src/charts/fixtures/priceHistory.fixture.ts
git commit -m "feat(portfolio): price chart with Avg cost rule, above/below-cost wash, event markers, window summary, reachable spans, CSV (F4, F7, F12, F13)"
```

---

### Task 3: The heat-treemap (F5) and the donut on the grammar

**Files:**
- Modify: `src/components/portfolio/allocationChartOptions.ts`, `src/components/portfolio/allocationChartOptions.test.ts`
- Create: `src/charts/fixtures/heatTreemap.fixture.ts`, `src/charts/fixtures/allocationDonut.fixture.ts`

F5: industry (or the type label when `industry` is null) → ticker; area = market value; fill = `Unrealized %` or `Day change` clamped to ±50% on the diverging ramp via the treemap's own `levels[].colorMappingBy: 'value'` (`visualDimension: 1` over `value: [marketValue, pct]`); labels `ticker · compact MV · %`; slivers under 0.5% of the book fold into one `Other` cell per industry; a leaf click hands the ticker to the panel (`?ticker=` drill-in). The old `treemapOption` stays exported and unused. The donut takes `itemTooltip` (F7) and gains a CSV (F12); its bottom legend is a declared exemption.

- [ ] **Step 1: Write the failing tests**

Append to `allocationChartOptions.test.ts`:

```ts
import { tooltipRows } from '../../testing/tooltipRows'
import { DIVERGING, MUTED } from '../../charts/theme'
import type { HoldingOut } from '../../types/api'
import { HEAT_CLAMP, HEAT_METRICS, donutCsv, heatTreemapCsv, heatTreemapOption } from './allocationChartOptions'

function holding(over: Partial<HoldingOut> & Pick<HoldingOut, 'ticker' | 'market_value'>): HoldingOut {
  return {
    security_id: 1, name: over.ticker, industry: 'Semis', holding_type: 'stock', is_manual_priced: false,
    shares: '1', avg_cost: '1', cost_basis: '1', price: '1', quoted_at: null, price_source: 'yfinance',
    day_change_pct: '0.01', day_change_amount: '1', weight_pct: null, unrealized_gl: '1',
    unrealized_gl_pct: '0.10', realized_gl: '0', dividends_collected: '0', annual_dividend: null,
    annual_income: null, yield_pct: null, yoc_pct: null, xirr_pct: null, accounts: [], warnings: [],
    ...over,
  }
}
const BOOK = [
  holding({ ticker: 'NVDA', market_value: '600000.00', unrealized_gl_pct: '0.80', day_change_pct: '-0.02' }),
  holding({ ticker: 'AMD', market_value: '200000.00', unrealized_gl_pct: '-0.10' }),
  holding({ ticker: 'VOO', market_value: '195000.00', industry: null, holding_type: 'etf', unrealized_gl_pct: '0.25' }),
  holding({ ticker: 'TINY', market_value: '3000.00', unrealized_gl_pct: '0.05' }), // 0.3% → folded
  holding({ ticker: 'TINIER', market_value: '2000.00', unrealized_gl_pct: '-0.05' }),
  holding({ ticker: 'UNPRICED', market_value: null }),
]
interface Leaf { name: string; value: [number, number]; ticker: string | null; pct: number; label: { color: string }; children?: Leaf[] }
const readHeat = (option: unknown) =>
  option as {
    tooltip: { trigger: string; formatter: (p: unknown) => string }
    series: { type: string; visualDimension: number; visualMin: number; visualMax: number; levels: { colorMappingBy?: string; color?: string[] }[]; label: { formatter: (p: { data: Leaf }) => string }; data: Leaf[] }[]
  }

describe('heatTreemapOption', () => {
  it('groups tickers under their industry (type label when none), area = market value, fill = the clamped metric', () => {
    const option = readHeat(heatTreemapOption(BOOK, 'unrealized'))
    const series = option.series[0]
    expect(series).toMatchObject({ type: 'treemap', visualDimension: 1, visualMin: -HEAT_CLAMP, visualMax: HEAT_CLAMP })
    expect(series.levels[2]).toMatchObject({ colorMappingBy: 'value', color: [...DIVERGING] })
    expect(series.data.map((g) => g.name)).toEqual(['Semis', 'ETF']) // biggest industry first
    const semis = series.data[0]
    expect(semis.children!.map((l) => l.name)).toEqual(['NVDA', 'AMD', 'Other'])
    expect(semis.children![0].value).toEqual([600000, HEAT_CLAMP]) // +80% clamps to +50%
    expect(semis.children![0].pct).toBe(0.8) // the tooltip keeps the true figure
    expect(semis.children![1].value).toEqual([200000, -0.1])
    // Two slivers (0.3% + 0.2% of a $1M book) fold into one Other cell with a value-weighted %.
    expect(semis.children![2]).toMatchObject({ name: 'Other', ticker: null, value: [5000, 0.01] })
    expect(series.data[1].children![0]).toMatchObject({ name: 'VOO', value: [195000, 0.25] })
    // Saturated arms take the surface ink, the neutral middle takes text ink.
    expect(semis.children![0].label.color).toBe(SURFACE)
    expect(semis.children![1].label.color).toBe(INK)
    expect(series.label.formatter({ data: semis.children![0] })).toBe('NVDA\n$600.0K · +80.0%')
  })
  it('Day change reads day_change_pct; unpriced holdings are excluded; empty book → null', () => {
    const series = readHeat(heatTreemapOption(BOOK, 'day')).series[0]
    expect(series.data[0].children![0].value).toEqual([600000, -0.02])
    expect(heatTreemapOption([holding({ ticker: 'X', market_value: null })], 'day')).toBeNull()
    expect(HEAT_METRICS.map((m) => m.label)).toEqual(['Unrealized', 'Day change'])
  })
  it('F7: value first, ticker, the metric and share; industry nodes summarise; the root is silent', () => {
    const option = readHeat(heatTreemapOption(BOOK, 'unrealized'))
    const leaf = option.series[0].data[0].children![0]
    const parsed = tooltipRows(option.tooltip.formatter({ name: 'NVDA', value: leaf.value, data: leaf }))
    expect([parsed.lead, parsed.label, parsed.sub]).toEqual(['$600,000.00', 'NVDA', '+80.0% unrealized · 60.0% of holdings · Semis'])
    const group = tooltipRows(option.tooltip.formatter({ name: 'Semis', value: [805000, 0], data: option.series[0].data[0] }))
    expect([group.lead, group.label, group.sub]).toEqual(['$805,000.00', 'Semis', '80.5% of holdings'])
    expect(option.tooltip.formatter({ name: '', value: [1000000, 0] })).toBe('')
  })
  it('exports every priced holding with both metrics', () => {
    const csv = heatTreemapCsv(BOOK)
    expect(csv.headers).toEqual(['Industry', 'Ticker', 'Market value', 'Unrealized %', 'Day change %'])
    expect(csv.rows[0]).toEqual(['Semis', 'NVDA', '600000.00', '0.80', '-0.02'])
    expect(csv.rows).toHaveLength(5)
  })
})

describe('donutOption — grammar', () => {
  it('F7: value first, the escaped name, the share of holdings; CSV lists the drawn arcs', () => {
    const data = allocation([['<b>ETF</b>', '3000.00'], ['stock', '1000.00']])
    const format = (donutOption(data, false) as unknown as { tooltip: { trigger: string; formatter: (p: unknown) => string } }).tooltip
    expect(format.trigger).toBe('item')
    const parsed = tooltipRows(format.formatter({ name: '<b>ETF</b>', value: 3000 }))
    expect([parsed.lead, parsed.label, parsed.sub]).toEqual(['$3,000.00', '&lt;b&gt;ETF&lt;/b&gt;', '75.0% of holdings'])
    expect(donutCsv(allocation([['etf', '5000.00'], ['stock', '3000.00'], ['private', '2000.00'], ['mutual_fund', '400.00']]), true)).toEqual({
      headers: ['Slice', 'Market value'],
      rows: [['ETF', '5000.00'], ['Stock', '3000.00'], ['Private', '2000.00'], ['Other', '400.00']],
    })
  })
})
```

Update the existing `'escapes the slice name and shares it against the drawn total'` donut assertion to read the new layout: `expect(tooltipRows(tooltipFormatterOf(option)({ name: '<b>ETF</b>', value: 3000 })).label).toBe('&lt;b&gt;ETF&lt;/b&gt;')` (the treemap half of that test stays — `treemapOption` is untouched).

Run: `npx vitest run src/components/portfolio/allocationChartOptions.test.ts`
Expected: FAIL — exports missing; the donut tooltip is the old string.

- [ ] **Step 2: Write the builders**

```ts
import { DIVERGING, MUTED } from '../../charts/theme'
import { itemTooltip } from '../../charts/tooltip'
import type { HoldingOut } from '../../types/api'
import type { ExportTable } from '../../utils/download'

export type HeatMetric = 'unrealized' | 'day'
export const HEAT_METRICS: { value: HeatMetric; label: string }[] = [
  { value: 'unrealized', label: 'Unrealized' },
  { value: 'day', label: 'Day change' },
]
/** Fills saturate at ±50%: a 300% winner and a 60% one read the same, the tooltip tells them apart. */
export const HEAT_CLAMP = 0.5
/** Under half a percent of the book a cell has no room for a label — it folds into Other. */
export const SLIVER_SHARE = 0.005

interface HeatLeaf {
  name: string
  /** [market value, clamped metric] — visualDimension 1 drives the fill. */
  value: [number, number]
  /** null on a folded Other cell (nothing to drill into). */
  ticker: string | null
  /** The TRUE metric, unclamped, for the tooltip. */
  pct: number
  industry: string
  label: { color: string }
}
interface HeatGroup { name: string; value: [number, number]; children: HeatLeaf[] }

const clamp = (v: number) => Math.max(-HEAT_CLAMP, Math.min(HEAT_CLAMP, v))
const metricOf = (h: HoldingOut, metric: HeatMetric) =>
  Number((metric === 'unrealized' ? h.unrealized_gl_pct : h.day_change_pct) ?? 0)
const industryOf = (h: HoldingOut) => h.industry ?? TYPE_LABELS[h.holding_type] ?? h.holding_type
// Saturated arms are light on dark (and dark on light), so they take the SURFACE ink; the
// neutral middle takes INK. recolor.ts swaps both tokens under the light theme.
const inkFor = (pct: number) => (Math.abs(pct) >= 0.3 ? SURFACE : INK)

function heatGroups(holdings: HoldingOut[], metric: HeatMetric): { groups: HeatGroup[]; total: number } {
  const priced = holdings.filter((h) => h.market_value !== null && Number(h.market_value) > 0)
  const total = priced.reduce((sum, h) => sum + Number(h.market_value), 0)
  const byIndustry = new Map<string, HoldingOut[]>()
  for (const h of priced) {
    const key = industryOf(h)
    byIndustry.set(key, [...(byIndustry.get(key) ?? []), h])
  }
  const groups: HeatGroup[] = [...byIndustry.entries()].map(([industry, rows]) => {
    const sorted = [...rows].sort((a, b) => Number(b.market_value) - Number(a.market_value))
    const big = sorted.filter((h) => Number(h.market_value) / total >= SLIVER_SHARE)
    const slivers = sorted.filter((h) => Number(h.market_value) / total < SLIVER_SHARE)
    const leaf = (name: string, ticker: string | null, mv: number, pct: number): HeatLeaf => ({
      name, ticker, pct, industry, value: [mv, clamp(pct)], label: { color: inkFor(clamp(pct)) },
    })
    const children = big.map((h) => leaf(h.ticker, h.ticker, Number(h.market_value), metricOf(h, metric)))
    if (slivers.length > 0) {
      const mv = slivers.reduce((s, h) => s + Number(h.market_value), 0)
      const pct = slivers.reduce((s, h) => s + metricOf(h, metric) * Number(h.market_value), 0) / mv
      children.push(leaf('Other', null, mv, pct))
    }
    const groupMv = children.reduce((s, c) => s + c.value[0], 0)
    return { name: industry, value: [groupMv, 0], children }
  })
  groups.sort((a, b) => b.value[0] - a.value[0])
  return { groups, total }
}

/** F5: the heat-treemap. Null with no priced holding. */
export function heatTreemapOption(holdings: HoldingOut[], metric: HeatMetric): EChartsOption | null {
  const { groups, total } = heatGroups(holdings, metric)
  if (groups.length === 0) return null
  const share = (mv: number) => formatPct(total > 0 ? mv / total : 0, { signed: false })
  const word = metric === 'unrealized' ? 'unrealized' : 'today'
  return {
    tooltip: itemTooltip<{ name?: string; value?: unknown; data?: HeatLeaf | HeatGroup }>({
      body: (p) => {
        // The implicit root answers hovers on the gaps between cells with an empty name.
        if (!p.name || p.data === undefined) return null
        const mv = (p.value as [number, number])[0]
        if ('children' in p.data) return { value: mv, label: p.data.name, sub: `${share(mv)} of holdings` }
        return { value: mv, label: p.data.name, sub: `${formatPct(p.data.pct)} ${word} · ${share(mv)} of holdings · ${p.data.industry}` }
      },
    }),
    series: [
      {
        type: 'treemap',
        roam: false,
        // Leaf clicks are the panel's drill-in (onClick → ticker); no zoom-to-node.
        nodeClick: false,
        breadcrumb: { show: false },
        visualDimension: 1,
        visualMin: -HEAT_CLAMP,
        visualMax: HEAT_CLAMP,
        // Canvas TEXT, not tooltip HTML: no escaping needed. Truncated to the cell.
        label: {
          show: true,
          fontSize: 11,
          overflow: 'truncate' as const,
          formatter: (p: { data?: HeatLeaf }) =>
            p.data === undefined ? '' : `${p.data.name}\n${formatCurrencyCompact(p.data.value[0])} · ${formatPct(p.data.pct)}`,
        },
        levels: [
          {},
          // Industry tier: a muted upper label names the group; thick surface borders separate groups.
          { upperLabel: { show: true, height: 18, color: MUTED, fontSize: 11 }, itemStyle: { borderColor: SURFACE, borderWidth: 2, gapWidth: 2 } },
          // Ticker tier: the diverging fill by the metric (min → orange, max → blue).
          { colorMappingBy: 'value' as const, color: [...DIVERGING], itemStyle: { borderColor: SURFACE, borderWidth: 1, gapWidth: 1 } },
        ],
        data: groups,
      },
    ],
  }
}

/** Every priced holding with both metrics (F12), grouped the way the map draws them. */
export function heatTreemapCsv(holdings: HoldingOut[]): ExportTable {
  const priced = holdings.filter((h) => h.market_value !== null && Number(h.market_value) > 0)
  return {
    headers: ['Industry', 'Ticker', 'Market value', 'Unrealized %', 'Day change %'],
    rows: priced.map((h) => [industryOf(h), h.ticker, h.market_value ?? '', h.unrealized_gl_pct ?? '', h.day_change_pct ?? '']),
  }
}
```

Change `donutOption`'s tooltip to:

```ts
    tooltip: itemTooltip<{ name?: string; value?: unknown }>({
      body: (p) => ({
        value: Number(p.value),
        label: p.name ?? '',
        sub: `${formatPct(total > 0 ? Number(p.value) / total : 0, { signed: false })} of holdings`,
      }),
    }),
```

and add:

```ts
/** The drawn arcs (F12): top three named, the fold as Other. */
export function donutCsv(data: AllocationResponse, labels: boolean): ExportTable {
  const named = positiveSlices(data).map((s) => ({ name: labels ? (TYPE_LABELS[s.key] ?? s.key) : s.key, value: Number(s.market_value) }))
  const top = named.slice(0, 3)
  const rest = named.slice(3)
  return {
    headers: ['Slice', 'Market value'],
    rows: [...top.map((s) => [s.name, s.value.toFixed(2)]), ...(rest.length > 0 ? [['Other', rest.reduce((sum, s) => sum + s.value, 0).toFixed(2)]] : [])],
  }
}
```

- [ ] **Step 3: Add the fixtures**

```ts
// src/charts/fixtures/heatTreemap.fixture.ts
import type { ChartFixture } from './_types'
import { heatTreemapOption } from '../../components/portfolio/allocationChartOptions'
import type { HoldingOut } from '../../types/api'

const base = { security_id: 1, name: '', is_manual_priced: false, shares: '1', avg_cost: '1', cost_basis: '1', price: '1', quoted_at: null, price_source: 'yfinance' as const, day_change_amount: '1', weight_pct: null, unrealized_gl: '1', realized_gl: '0', dividends_collected: '0', annual_dividend: null, annual_income: null, yield_pct: null, yoc_pct: null, xirr_pct: null, accounts: [], warnings: [] }
export const HOLDINGS: HoldingOut[] = [
  { ...base, ticker: 'NVDA', industry: 'Semis', holding_type: 'stock', market_value: '600000.00', unrealized_gl_pct: '0.80', day_change_pct: '-0.02' },
  { ...base, ticker: 'AMD', industry: 'Semis', holding_type: 'stock', market_value: '200000.00', unrealized_gl_pct: '-0.10', day_change_pct: '0.01' },
  { ...base, ticker: 'VOO', industry: null, holding_type: 'etf', market_value: '195000.00', unrealized_gl_pct: '0.25', day_change_pct: '0.00' },
  { ...base, ticker: 'TINY', industry: 'Semis', holding_type: 'stock', market_value: '3000.00', unrealized_gl_pct: '0.05', day_change_pct: '0.01' },
]

const fixture: ChartFixture = {
  name: 'heatTreemap',
  kind: 'treemap',
  ariaLabel: 'Treemap of holdings by industry and ticker, sized by market value and shaded by unrealized gain',
  exempt: ['grid', 'axis', 'legend'],
  build: () => heatTreemapOption(HOLDINGS, 'unrealized'),
}
export default fixture
```

```ts
// src/charts/fixtures/allocationDonut.fixture.ts
import type { ChartFixture } from './_types'
import { donutOption } from '../../components/portfolio/allocationChartOptions'

const fixture: ChartFixture = {
  name: 'allocationDonut',
  kind: 'pie',
  ariaLabel: 'Donut chart of portfolio share by holding type',
  exempt: ['grid', 'axis', 'legend'],
  build: () =>
    donutOption(
      { by: 'type', total_market_value: '10400.00', slices: [
        { key: 'etf', market_value: '5000.00', weight_pct: '0.48', holdings: 2 }, { key: 'stock', market_value: '3000.00', weight_pct: '0.29', holdings: 3 },
        { key: 'private', market_value: '2000.00', weight_pct: '0.19', holdings: 1 }, { key: 'mutual_fund', market_value: '400.00', weight_pct: '0.04', holdings: 1 },
      ] },
      true,
    ),
}
export default fixture
```

Run: `npx vitest run src/components/portfolio/allocationChartOptions.test.ts src/charts/conformance.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/portfolio/allocationChartOptions.ts src/components/portfolio/allocationChartOptions.test.ts src/charts/fixtures/heatTreemap.fixture.ts src/charts/fixtures/allocationDonut.fixture.ts
git commit -m "feat(portfolio): heat-treemap by industry and ticker on the diverging ramp with slivers folded and CSV; donut on the item tooltip with CSV (F5, F7, F12)"
```

---

### Task 4: Dividend income bars on the grammar

**Files:**
- Modify: `src/components/portfolio/dividendChartOptions.ts`, `src/components/portfolio/dividendChartOptions.test.ts`
- Create: `src/charts/fixtures/dividendIncome.fixture.ts`

Named changes: §8 (`grid('noLegend')` — was `{70,16,16,28}`), §9 (`BAR_MARKS` focus), F7 (`axisTooltip`, `shadow` pointer). Data, colour and the 22 px cap are byte-identical; `monthlyIncomeSums` / `monthlyIncomeCsv` / `incomeStats` are untouched.

- [ ] **Step 1: Extend the test**

```ts
import { GRID_VARIANTS, compactMoney } from '../../charts/grammar'
import { SURFACE } from '../../charts/theme'
import { isGrammarTooltip } from '../../charts/tooltip'
import { tooltipRows } from '../../testing/tooltipRows'

describe('monthlyIncomeOption — grammar', () => {
  it('no-legend grid, compact ticks, the bar marks, a shadow-pointer money tooltip', () => {
    const option = monthlyIncomeOption([dividend('2026-06-05', '8.20')], TODAY) as unknown as {
      grid: unknown
      yAxis: { axisLabel: { formatter: unknown } }
      tooltip: { axisPointer: unknown; formatter: (p: unknown) => string }
      series: { barMaxWidth: number; itemStyle: unknown; emphasis: unknown }[]
    }
    expect(option.grid).toEqual(GRID_VARIANTS.noLegend)
    expect(option.yAxis.axisLabel.formatter).toBe(compactMoney)
    expect(option.series[0]).toMatchObject({ barMaxWidth: 22, itemStyle: { borderColor: SURFACE, borderWidth: 1 }, emphasis: { focus: 'series' } })
    expect(option.tooltip.axisPointer).toEqual({ type: 'shadow' })
    expect(isGrammarTooltip(option.tooltip.formatter)).toBe(true)
    const rows = tooltipRows(option.tooltip.formatter([{ seriesName: 'Dividends', seriesType: 'bar', axisValueLabel: 'Jun 2026', value: 8.2, color: PALETTE[0] }]))
    expect(rows.rows).toEqual([{ kind: 'row', label: 'Dividends', value: '$8.20' }])
  })
})
```

Run: `npx vitest run src/components/portfolio/dividendChartOptions.test.ts`
Expected: FAIL — old grid; `valueFormatter` tooltip.

- [ ] **Step 2: Rewrite the option body**

```ts
import { BAR_MARKS, grid, moneyAxis, monthAxis } from '../../charts/grammar'
import { axisTooltip } from '../../charts/tooltip'

export function monthlyIncomeOption(dividends: DividendOut[], todayIso: string): EChartsOption | null {
  const rows = monthlyIncomeSums(dividends, todayIso)
  if (rows === null) return null
  return {
    grid: grid('noLegend'),
    xAxis: monthAxis(rows.map((r) => formatMonth(r.month)), { gap: true }),
    yAxis: moneyAxis(),
    tooltip: axisTooltip({ unit: 'money', pointer: 'shadow' }),
    series: [
      {
        type: 'bar',
        name: 'Dividends',
        ...BAR_MARKS,
        color: PALETTE[0],
        data: rows.map((r) => r.amount),
      },
    ],
  }
}
```

(`SURFACE`, `formatCurrency`, `formatCurrencyCompact` imports become unused in this module — remove them.)

- [ ] **Step 3: Add the fixture**

```ts
// src/charts/fixtures/dividendIncome.fixture.ts
import type { ChartFixture } from './_types'
import { monthlyIncomeOption } from '../../components/portfolio/dividendChartOptions'

const fixture: ChartFixture = {
  name: 'dividendIncome',
  kind: 'cartesian',
  ariaLabel: 'Bar chart of dividend income per month over the trailing two years',
  build: () =>
    monthlyIncomeOption(
      [{ id: 1, security_id: 1, account: 'RH Taxable', pay_date: '2026-06-05', amount: '8.20', source: 'auto', ex_date: '2026-06-05', per_share: '0.82', shares_held: '10', notes: null }],
      '2026-08-20',
    ),
}
export default fixture
```

Run: `npx vitest run src/components/portfolio/dividendChartOptions.test.ts src/charts/conformance.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/portfolio/dividendChartOptions.ts src/components/portfolio/dividendChartOptions.test.ts src/charts/fixtures/dividendIncome.fixture.ts
git commit -m "feat(portfolio): dividend income bars on the grammar (§8, §9, F7)"
```

---

### Task 5: Portfolio panels and the page onto `ChartCard`

**Files:**
- Modify: `src/components/portfolio/HoldingDetailPanel.tsx`, `HoldingDetailPanel.test.tsx`, `AllocationPanel.tsx`, `DividendsPanel.tsx`, `DividendsPanel.test.tsx`
- Modify: `src/pages/PortfolioPage.tsx`, `src/pages/PortfolioPage.test.tsx`

Five mounts move onto `ChartCard`: the price chart (F4 chips/footer/busy/error/CSV), the heat-treemap and donut (F5, with their controls), dividends, and the page's Performance section (`zoomable`, CSV, persisted legend). `AllocationPanel` takes `holdings` + `onSelectTicker` instead of the `industry` slices. `.panel-title-row` leaves the two panels (the page's Holdings header keeps it — it is not a chart header).

- [ ] **Step 1: Update the tests**

`HoldingDetailPanel.test.tsx`:
- Span chips: the third is `All` (`Max` is gone): `expect(screen.getByRole('button', { name: 'All' })).toBeTruthy()`.
- New case — unreachable chips and the footer:
  ```ts
  it('disables spans longer than the history and prints the window summary', async () => {
    // 365 asked, two points a day apart returned: the extent is known → 3Y and All are moot.
    vi.mocked(fetchPriceHistory).mockResolvedValue({ ticker: 'AAA', points: [{ d: '2026-08-10', c: '100.00' }, { d: '2026-08-12', c: '110.00' }] })
    renderPanel()
    await screen.findByText(/over this window · history since Aug 10, 2026/)
    expect(screen.getByText(/\+10\.0% over this window/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '1Y' }).hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('button', { name: '3Y' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'All' }).hasAttribute('disabled')).toBe(true)
  })
  ```
  (`todayIso()` is real here; the two points are recent relative to any run date, so `covered` stays far below 358.) The existing "Loading price history…" text assertion becomes a skeleton check: `expect(document.querySelector('.chart-card-skeleton')).toBeTruthy()`; the stale-cue assertion (`the chart may be showing the previous window`) now finds a `role="status"` paragraph inside the card.
- The `EChart` mock in this file gains nothing; `ChartCard` renders through it.

`DividendsPanel.test.tsx`: the mock keeps `data-categories`; add `expect(screen.getByLabelText(/Bar chart of dividend income per month/)).toBeTruthy()` and `expect(screen.getByRole('group', { name: 'Export dividends' })).toBeTruthy()` in the chart case.

`PortfolioPage.test.tsx`: add
```ts
it('mounts performance, the heat-treemap, the donut and dividends through ChartCard', async () => {
  renderPage()
  await screen.findByText('Performance')
  expect(screen.getByLabelText(/Line chart of portfolio value against cost basis/)).toBeTruthy()
  expect(screen.getByLabelText(/Treemap of holdings by industry and ticker/)).toBeTruthy()
  expect(screen.getByLabelText(/Donut chart of portfolio share by holding type/)).toBeTruthy()
  expect(screen.getByRole('group', { name: 'Export portfolio-performance' })).toBeTruthy()
  expect(screen.getByRole('group', { name: 'Heat metric' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Day change' }))
  expect(screen.getByLabelText(/shaded by day change/)).toBeTruthy()
})
```
Assertions that counted `getAllByTestId('echart')[0]` for the performance chart still hold (it is the first card on the page).

Run: `npx vitest run src/components/portfolio src/pages/PortfolioPage.test.tsx`
Expected: FAIL.

- [ ] **Step 2: `HoldingDetailPanel`**

Replace the imports of `ChartZoomHint`, `EChart`, `priceHistoryOption` with:

```ts
import ChartCard from '../ChartCard'
import Segmented from '../shell/Segmented'
import { todayIso } from '../../utils/months'
import { buildEventMarkers } from './historyChartOptions'
import { PRICE_SPANS, priceHistoryCsv, priceHistoryOption, priceWindowSummary, reachableSpans } from './priceChartOptions'
import type { SpanDays } from './priceChartOptions'
```

Delete the local `SPANS`/`SpanDays`. After `paid`:

```ts
  // Dated buys/sells/dividends for THIS security, snapped to the daily bars — the performance
  // chart's marker grammar over a finer axis (F4).
  const events = useMemo(
    () =>
      points === null
        ? []
        : buildEventMarkers(
            { dates: points.map((p) => p.d), market_value: points.map((p) => p.c) },
            rows,
            paid,
            new Map([[holding.security_id, holding.ticker]]),
          ),
    [points, rows, paid, holding.security_id, holding.ticker],
  )
  const chart = useMemo(
    () => (points === null ? null : priceHistoryOption({ points, avgCost: holding.avg_cost, events })),
    [points, holding.avg_cost, events],
  )
  const summary = points === null ? null : priceWindowSummary(points)
  // Chips the history cannot reach are disabled (F4): a response shorter than it asked for
  // reveals the whole extent, and every longer span would fetch the same rows again.
  const reachable = useMemo(
    () => (points === null ? { 365: true, 1095: true, 3650: true } : reachableSpans(points, span.days, todayIso())),
    [points, span.days],
  )
```

Replace everything from `<div className="panel-title-row">` through the price-chart ternary with:

```tsx
      <ChartCard
        title="Price history"
        hint="Daily closes for this security over the chosen window against your average cost — the wash reads green above it and red below; markers are dated buys, sells and dividends. Manual-priced securities accrue one point per hand entry."
        ariaLabel={`Line chart of ${ticker}'s daily closing prices against the average cost`}
        option={chart}
        empty={`Not enough price history to chart yet${holding.is_manual_priced ? ' — manual pricing adds one point per entry.' : '.'}`}
        exportName={`${ticker.toLowerCase()}-price-history`}
        csv={points === null ? undefined : () => priceHistoryCsv(points)}
        height={260}
        zoomable
        busy={busy}
        // The stale cue only when there IS something stale: a span-change failure leaves the
        // previous window's chart up, a first load leaves nothing.
        error={error === null ? null : points === null ? error : `${error} — the chart may be showing the previous window.`}
        controls={
          <Segmented
            variant="toggle"
            size="sm"
            ariaLabel="History window"
            options={PRICE_SPANS.map((s) => ({ value: String(s.days), label: s.label, disabled: !reachable[s.days] }))}
            value={String(span.days)}
            onChange={(value) => pickSpan(Number(value) as SpanDays)}
          />
        }
        actions={
          error !== null ? (
            <button type="button" className="button" aria-label="Retry loading price history" onClick={retry}>Retry</button>
          ) : undefined
        }
        footer={
          summary === null ? undefined : (
            <p className="drill-hint">
              {formatPct(summary.changePct)} over this window · history since {summary.since}
            </p>
          )
        }
      />
```

- [ ] **Step 3: `AllocationPanel`**

```tsx
import { useMemo, useState } from 'react'
import ChartCard from '../ChartCard'
import Segmented from '../shell/Segmented'
import type { AllocationResponse, HoldingOut } from '../../types/api'
import { HEAT_METRICS, donutCsv, donutOption, heatTreemapCsv, heatTreemapOption, positiveSlices } from './allocationChartOptions'
import type { HeatMetric } from './allocationChartOptions'
import './portfolio.css'

export default function AllocationPanel({
  holdings, byType, byAccount, onSelectTicker,
}: {
  holdings: HoldingOut[]
  byType: AllocationResponse | null
  byAccount: AllocationResponse | null
  /** A ticker cell click → the page's drill-in (the ?ticker= arrival's twin). */
  onSelectTicker: (ticker: string) => void
}) {
  const [metric, setMetric] = useState<HeatMetric>('unrealized')
  const [donutDim, setDonutDim] = useState<'type' | 'account'>('type')
  const donutData = donutDim === 'type' ? byType : byAccount
  const treemap = useMemo(() => heatTreemapOption(holdings, metric), [holdings, metric])
  const donut = useMemo(
    () => (donutData && positiveSlices(donutData).length > 0 ? donutOption(donutData, donutDim === 'type') : null),
    [donutData, donutDim],
  )
  return (
    <div className="card-grid">
      <ChartCard
        span={6}
        title="Allocation by industry"
        hint="Industry → ticker: cell area is market value, fill is the chosen metric on the orange ↔ blue scale, clamped at ±50%. Holdings under 0.5% of the book fold into Other. Click a ticker to open it."
        ariaLabel={`Treemap of holdings by industry and ticker, sized by market value and shaded by ${metric === 'unrealized' ? 'unrealized gain' : 'day change'}`}
        option={treemap}
        empty="No priced holdings yet."
        exportName="allocation-industry"
        csv={() => heatTreemapCsv(holdings)}
        height={300}
        controls={<Segmented variant="toggle" size="sm" ariaLabel="Heat metric" options={HEAT_METRICS} value={metric} onChange={setMetric} />}
        onClick={(params) => {
          const ticker = (params as unknown as { data?: { ticker?: string | null } }).data?.ticker
          if (ticker) onSelectTicker(ticker)
        }}
        footer={<p className="drill-hint">Orange = loss, blue = gain; the deeper the tone, the larger the move (to ±50%).</p>}
      />
      <ChartCard
        span={6}
        title="Allocation"
        hint="Portfolio share by holding type or account — top three slices named, the rest folded into Other."
        ariaLabel={`Donut chart of portfolio share by ${donutDim === 'type' ? 'holding type' : 'account'}`}
        option={donut}
        empty="No priced holdings yet."
        exportName={`allocation-${donutDim}`}
        csv={donutData === null ? undefined : () => donutCsv(donutData, donutDim === 'type')}
        height={300}
        controls={
          <Segmented variant="toggle" size="sm" ariaLabel="Donut dimension"
            options={[{ value: 'type', label: 'Type' }, { value: 'account', label: 'Account' }]} value={donutDim} onChange={setDonutDim} />
        }
      />
    </div>
  )
}
```

- [ ] **Step 4: `DividendsPanel` and the page**

In `DividendsPanel.tsx` replace the `{chart && <EChart …/>}` block with:

```tsx
          <ChartCard
            title="Monthly dividend income"
            hint="Dividends received per month over the trailing two years, quiet months at zero."
            ariaLabel="Bar chart of dividend income per month over the trailing two years"
            option={chart}
            empty="No dividends in the trailing two years."
            exportName="dividends"
            csv={() => monthlyIncomeCsv(dividends, todayIso())}
            height={220}
          />
```

In `PortfolioPage.tsx`: `performanceOption` calls `portfolioHistoryOption(history, live, events, { selected: legendSelected })` and spreads only `dataZoom` over the result; the Performance `<section className="panel">` becomes:

```tsx
            <ChartCard
              title="Performance"
              hint="Value vs cost basis, checkpointed weekly after Monday's close. The pinging dot is the live value at the latest prices. The S&P 500 baseline invests only the starting balance; VOO (your contributions) invests every inferred contribution instead. Event markers annotate dated buys and sells, logged dividends, and older ex-dividend dates."
              ariaLabel="Line chart of portfolio value against cost basis and benchmark lines, weekly"
              option={performanceOption}
              empty="No performance history yet — import your workbook in Settings to load it."
              exportName="portfolio-performance"
              csv={history === null ? undefined : () => portfolioHistoryCsv(history)}
              height={300}
              zoomable
              onLegendChange={onLegendChange}
              onDataZoom={onZoomWindow}
              zoomWindow={zoomWindow}
              footer={
                <>
                  {owner !== null && <p className="hint">{/* the unchanged person's-view sentence */}</p>}
                  <p className="hint">S&amp;P 500 baseline tracks the starting balance invested in VOO — later contributions are not added to it. VOO (your contributions) adds each inferred contribution as it lands.</p>
                </>
              }
            />
```

and `<AllocationPanel holdings={holdings.holdings} byType={byType} byAccount={byAccount} onSelectTicker={setDetailTicker} />`. Remove the `ChartZoomHint`/`EChart` imports.

Run: `npx vitest run src/components/portfolio src/pages/PortfolioPage.test.tsx src/pages/OverviewPage.test.tsx && npx tsc -b && npx eslint src/components/portfolio src/pages/PortfolioPage.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/portfolio/HoldingDetailPanel.tsx src/components/portfolio/HoldingDetailPanel.test.tsx src/components/portfolio/AllocationPanel.tsx src/components/portfolio/DividendsPanel.tsx src/components/portfolio/DividendsPanel.test.tsx src/pages/PortfolioPage.tsx src/pages/PortfolioPage.test.tsx
git commit -m "feat(portfolio): performance, price, heat-treemap, donut and dividends on ChartCard — reachable spans, window summary, metric/dimension controls, export + Table (F4, F5, F9, F11, F12)"
```

---

### Task 6: Real-echarts probe before merge — the heat-treemap and the price wash

**Files:**
- Create: `scratchpad/charts-c4-probe/probe.html`, `scratchpad/charts-c4-probe/shoot.mjs` (outside `src/`)
- Possibly modify: `src/components/portfolio/priceChartOptions.ts` (+ test, fixture) — the wash fallback

Spec §17/§20: jsdom never paints, and the two new forms here (treemap hierarchy colouring, a piecewise visual on a washed line) are exactly the kind that behave differently on a real canvas. Copy `scratchpad/paycheck-sankey-probe/probe.html`'s shell (it loads `../../node_modules/echarts/dist/echarts.js`) and draw panels **C** (heat-treemap) and **D** (price wash) exactly as C7's probe page spells them out (`docs/superpowers/plans/2026-09-04-charts-c7-verify.md`, Task 5 — the option literals there are the ones this lane's builders emit; copy them verbatim). `shoot.mjs` is C7's too. Run `node scratchpad/charts-c4-probe/shoot.mjs` and open the PNG.

- [ ] **Step 1: Judge panel C**

Accept when two industry blocks carry muted upper labels and the ticker cells run from orange (AMD, −10%) through neutral (Other, +1%) to blue (NVDA, clamped +50%), each with its two-line label. If every cell is one colour, echarts 6 wants the visual range on the LEVEL, not the series: move `visualDimension: 1, visualMin: -HEAT_CLAMP, visualMax: HEAT_CLAMP` into `levels[2]` in `heatTreemapOption`, update the Task 3 test (`series.levels[2]` carries them) and re-run.

- [ ] **Step 2: Judge panel D**

Accept when the wash is green above the dashed cost rule, red below it, meets the rule (origin at cost) and the Close line stays blue end to end. If the LINE recolours by segment (the piecewise visual reaching the stroke despite the explicit `lineStyle.color`), replace the visualMap approach in `priceHistoryOption` with two silent stacked washes — the projection fan's own technique — and drop `visualMap` and `areaStyle.origin`:

```ts
    const closes = points.map((p) => Number(p.c))
    const wash = (name: string, stack: string, color: string, data: number[]) => ({
      name, type: 'line' as const, stack, symbol: 'none' as const, lineStyle: { width: 0 }, color,
      emphasis: { disabled: true }, tooltip: { show: false }, silent: true,
      ...(color === 'transparent' ? {} : { areaStyle: { opacity: 0.12 } }),
      data,
    })
    const washes =
      cost === null
        ? []
        : [
            // Above: a transparent floor AT the cost, then the excess over it in POSITIVE.
            wash('wash-above-base', 'above-cost', 'transparent', closes.map(() => cost)),
            wash('Above cost', 'above-cost', POSITIVE, closes.map((c) => Math.max(c - cost, 0))),
            // Below: a transparent floor at the close (when under cost), then the shortfall in NEGATIVE.
            wash('wash-below-base', 'below-cost', 'transparent', closes.map((c) => Math.min(c, cost))),
            wash('Below cost', 'below-cost', NEGATIVE, closes.map((c) => Math.max(cost - c, 0))),
          ]
    const series = [...washes, { ...LINE, name: 'Close', color: PALETTE[0], data: closes }, /* Avg cost, Events unchanged */]
    // …and the legend lists only the three real entries so the washes stay out of it:
    legend: { ...legendFor(3), data: ['Close', ...(cost === null ? [] : ['Avg cost']), ...(events.length > 0 ? [EVENTS_SERIES] : [])] },
```

Update the Task 2 test's F4 case to assert the four wash series (names, stacks, colours, the `Above cost` data `[0, 1, 0]` for closes `[171.25, 173, 169.8]` against cost 172, `Below cost` `[0.75, 0, 2.2]`) instead of `visualMap`/`origin`; the fixture needs no change. Note the swap in the commit body.

- [ ] **Step 3: Commit the probe (and the fallback, if taken)**

```bash
git add scratchpad/charts-c4-probe
git commit -m "chore(portfolio): real-echarts probe of the heat-treemap hierarchy and the price wash (spec §17)"
```

---

### Task 7: Verify

- [ ] Run `npx tsc -b && npx eslint . && npx vitest run` from the worktree root. Expected: green. `npx vitest run src/charts/conformance.test.ts` lists passing cases for `portfolioHistory`, `priceHistory`, `heatTreemap`, `allocationDonut`, `dividendIncome`.
- [ ] `grep -rn "<EChart" src/pages/PortfolioPage.tsx src/components/portfolio` → no output; `grep -rn "'Max'" src/components/portfolio` → no output.
- [ ] Commit anything the runs touched; the lane is ready to merge.

---

## Self-review

**Spec coverage:** F4 (Avg cost reference, above/below wash, dated markers over daily bars, the window footer, `1Y · 3Y · All` with unreachable chips disabled, `Max` → `All`) → Tasks 2, 5, 6. F5 (industry → ticker heat-treemap, area = MV, fill = unrealized/day change clamped ±50%, slivers folded, click → drill-in, labels) → Tasks 3, 5. Dividends and donut on the grammar → Tasks 3, 4. F7 on every builder → Tasks 1–4. F9 (performance legend persisted through the builder) → Tasks 1, 5. F11 (performance, price, dividends named; the treemap/donut labels follow their controls) → Task 5. F12 (export + Table on all five; CSV added for price history, heat-treemap, donut) → Tasks 2–5. §17 probe → Task 6. `treemapOption` and `historyTooltipFormatter` stay in place unused — C7. **Placeholders:** the marked "unchanged" regions (Events/Live series objects, the person's-view sentence, the panel's tables) are code already in the files. **Type consistency:** `portfolioHistoryOption(history, live, events, { selected })`, `eventLines`, `priceHistoryOption({ points, avgCost, events })`, `priceWindowSummary`, `reachableSpans(points, requestedDays, todayIso)`, `priceHistoryCsv`, `PRICE_SPANS`/`SpanDays`, `heatTreemapOption(holdings, metric)`, `heatTreemapCsv(holdings)`, `HEAT_METRICS`/`HeatMetric`/`HEAT_CLAMP`, `donutCsv(data, labels)`, `AllocationPanel { holdings, byType, byAccount, onSelectTicker }` are consistent across tasks; C1 names (`grid`, `moneyAxis`, `dateAxis`, `monthAxis`, `LINE`, `WASH`, `BAR_MARKS`, `compactMoney`, `legendFor`, `referenceLine`, `axisTooltip`/`itemTooltip`, `DIVERGING`, `ChartCard`, `tooltipRows`, `isGrammarTooltip`) match C1.

