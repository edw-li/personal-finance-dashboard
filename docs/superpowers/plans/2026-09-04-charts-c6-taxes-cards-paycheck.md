# Charts C6 — Taxes + Credit cards + Paycheck onto the grammar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the Taxes (waterfall, composition trend, year pie, marginal ladder), Credit cards (card-value bars, credit-line history ×2) and Paycheck (sankey) charts onto the C1 grammar (`docs/superpowers/plans/2026-09-04-charts-c1-primitives.md`) and land F15 (the tax trend drops its secondary percent axis; the effective rate becomes a direct label on each year's cap and stays a tooltip line), F13 (`barMaxWidth` 46 → 24 on the tax stacks and waterfall; the card-value axis goes compact), the credit-line legend persisted, the paycheck sankey on a `ChartCard` with CSV, the review leftover `TAX_COLORS[2]` → `SEQUENTIAL_BLUE[7]` (that step shared its hex with `PALETTE[0]` and went the wrong way under the light recolor), and F7/F9/F11/F12 for all eight mounts (grammar tooltips, `ariaLabel`s on the waterfall/trend/pie/ladder, export + Table everywhere — CSV added for the credit line, card values, the waterfall, the ladder, the pie and the sankey).

**Architecture:** `taxChartOptions.waterfallOption` rewires onto `charts/waterfall.ts` (the helper C1 lifted from it — the tax test's remainder pins are the proof of a faithful lift). Builders stay pure and gain fixtures. Panels mount through `ChartCard`: `SummaryPanel` (waterfall), `CompositionPanel` (trend/pie with the `All years` action and a persisted legend), `MarginalPanel` (ladder), `CreditCardsPage` (two cards with a persisted legend on the line chart), `CardDetail` (the per-card step line), `PaycheckPage`'s `FlowPanel` (sankey). `WhatIfPanel`'s header — not a chart — swaps its `tax-chart-header` class for the shared `chart-card-header` so `taxes.css`'s copy becomes unused (C7 retires the rule).

**Tech Stack:** React 19, TypeScript 5.9, vitest 3 + @testing-library/react (jsdom; `EChart` mocked as today), ECharts 6.1 via `src/charts/echarts.ts`.

**Worktree / commands:** Branch `charts-c6` from `main` AFTER C1 merges; `cmd //c "mklink /J node_modules ..\\..\\node_modules"` once; `npx vitest run <file>`, `npx tsc -b`, `npx eslint <files>`. Local commits only. Read `src/charts/grammar.ts`, `tooltip.ts`, `legend.ts`, `markLine.ts` (`zeroLine`), `waterfall.ts`, `sankey.ts` (`sankeyCsv`), `src/components/ChartCard.tsx`, `src/charts/fixtures/_types.ts`, `src/testing/tooltipRows.ts` first.

**Done when:** no `<EChart` outside `ChartCard` in `SummaryPanel.tsx`, `CompositionPanel.tsx`, `MarginalPanel.tsx`, `CreditCardsPage.tsx`, `CardDetail.tsx`, `PaycheckPage.tsx`; conformance green with this lane's fixtures; `npx tsc -b`, `npx eslint`, full `npx vitest run` pass.

---

## File structure

| File | Responsibility |
|---|---|
| `src/components/taxes/taxChartOptions.ts` (modify) | `TAX_COLORS[2]` → `SEQUENTIAL_BLUE[7]`; `waterfallOption` via `charts/waterfall.ts` + `waterfallCsv`; `trendOption(years, { selected })` F15 + `capLabel` rate; `yearPieOption` on `itemTooltip` + `yearPieCsv`; `marginalLadderOption` on the grammar + `ladderCsv`; private `roundTo` replaced by the grammar's |
| `src/components/taxes/taxChartOptions.test.ts` (modify) | Pins follow F13/F15/F7 (secondary-axis and rate-line pins removed; cap label pinned) |
| `src/charts/fixtures/taxWaterfall.fixture.ts`, `taxTrend.fixture.ts`, `taxYearPie.fixture.ts`, `marginalLadder.fixture.ts` (new) | Conformance fixtures |
| `src/components/taxes/SummaryPanel.tsx`, `CompositionPanel.tsx`, `MarginalPanel.tsx` (modify) | `ChartCard` mounts; `CompositionPanel` keeps `legendSelected` state |
| `src/components/taxes/WhatIfPanel.tsx` (modify) | `tax-chart-header` → `chart-card-header` (no chart; class swap only) |
| `src/pages/TaxesPage.test.tsx`, `src/components/taxes/MarginalPanel.test.tsx` (modify) | `Effective rate` legend pin → cap label pin; card structure |
| `src/components/creditcards/cardValueChartOptions.ts` (modify) | Compact axis, `grid('horizontal')`, `itemTooltip`, `zeroLine('x')`, `BAR_MARKS`; `cardValueCsv` |
| `src/components/creditcards/creditLineChartOptions.ts` (modify) | `creditLineChartOption(cards, months, { includeTotal, selected })` on `LINE`/`legendFor`/`axisTooltip`; `creditLineCsv` |
| `src/components/creditcards/*ChartOptions.test.ts` (modify) | Pins |
| `src/charts/fixtures/cardValue.fixture.ts`, `creditLine.fixture.ts` (new) | Conformance fixtures |
| `src/pages/CreditCardsPage.tsx`, `src/components/creditcards/CardDetail.tsx` (modify) | `ChartCard` mounts; `lineLegend` state on the page |
| `src/pages/CreditCardsPage.test.tsx` (modify) | Card structure |
| `src/components/paycheck/paycheckSankeyOptions.ts` (modify) | + `paycheckSankeyCsv(data)` via `sankeyCsv` |
| `src/charts/fixtures/paycheckSankey.fixture.ts` (new) | Conformance fixture |
| `src/pages/PaycheckPage.tsx`, `src/pages/PaycheckPage.test.tsx` (modify) | `FlowPanel` on `ChartCard` |

---

### Task 1: Tax waterfall onto `charts/waterfall.ts`; `TAX_COLORS[2]` → `SEQUENTIAL_BLUE[7]`

**Files:**
- Modify: `src/components/taxes/taxChartOptions.ts`, `src/components/taxes/taxChartOptions.test.ts`
- Create: `src/charts/fixtures/taxWaterfall.fixture.ts`

C1 lifted the invisible-placeholder waterfall into `charts/waterfall.ts` (`waterfallSteps`, `waterfallSeries`, `waterfallTooltip`, `waterfallCsv`). This task rewires `waterfallOption` onto it — the remainder pins in the existing test are the proof of a faithful lift — and applies F13 (`barMaxWidth` 46 → 24), F7 (`itemTooltip`), §8 (`grid()` — was `{72,24,36,28}`; `monthAxis(labels, { gap: true })` gives the same `axisLabel: { interval: 0 }` for ≤ 12 steps). Review leftover: `TAX_COLORS[2]` was `SEQUENTIAL_BLUE[6]`, the one step that shares its hex with `PALETTE[0]`; as a LONE color inside `data[].itemStyle` the light recolor elected the categorical blue and the middle tax step jumped out of the ramp. `SEQUENTIAL_BLUE[7]` keeps the walk strictly ascending.

- [ ] **Step 1: Update the tests**

In `src/components/taxes/taxChartOptions.test.ts`:

1. `TAX_COLORS` describe — add:
   ```ts
   it('never uses the step that doubles as PALETTE[0] (the light recolor would pull it out of the ramp)', () => {
     expect(TAX_COLORS).not.toContain(PALETTE[0])
     expect(TAX_COLORS[2]).toBe(SEQUENTIAL_BLUE[7])
   })
   ```
   (import `PALETTE` from `'../../charts/theme'`.)
2. `waterfallOption` describe — add:
   ```ts
   it('rides the shared waterfall helper: 24px bars, money grid, item tooltip value-first with the remainder', () => {
     const option = waterfallOption(summaryFixture(2024))!
     const [placeholder, visible] = seriesOf(option) as (SeriesLike & { barMaxWidth?: number; silent?: boolean })[]
     expect(placeholder.silent).toBe(true)
     expect(visible.barMaxWidth).toBe(24) // F13, was 46
     expect((option as { grid: unknown }).grid).toEqual(GRID_VARIANTS.default)
     const format = (option as { tooltip: { formatter: (p: unknown) => string } }).tooltip.formatter
     expect(isGrammarTooltip(format)).toBe(true)
     const federal = tooltipRows(format({ dataIndex: 1 }))
     expect(federal.lead).toBe('$40,782.88')
     expect(federal.label).toBe('Federal')
     expect(federal.sub).toBe('Left: $197,190.29')
     const gross = tooltipRows(format({ dataIndex: 0 }))
     expect(gross.lead).toBe('$237,973.17')
     expect(gross.sub).toBeUndefined()
     expect(format({ dataIndex: 99 })).toBe('')
   })
   it('exports the walk as a table', () => {
     expect(waterfallCsv(summaryFixture(2024)).headers).toEqual(['Step', 'Amount', 'Remaining'])
     expect(waterfallCsv(summaryFixture(2024)).rows[1]).toEqual(['Federal', '40782.88', '197190.29'])
     expect(waterfallCsv(summaryFixture(2024)).rows[0]).toEqual(['Gross', '237973.17', ''])
     expect(waterfallCsv(emptySummary(2026)).rows).toEqual([])
   })
   ```
   Imports: `GRID_VARIANTS` from `'../../charts/grammar'`, `isGrammarTooltip` from `'../../charts/tooltip'`, `tooltipRows` from `'../../testing/tooltipRows'`, `waterfallCsv` from the module.

Run: `npx vitest run src/components/taxes/taxChartOptions.test.ts`
Expected: FAIL — `TAX_COLORS[2]` is `SEQUENTIAL_BLUE[6]`; `barMaxWidth` 46; formatter not branded; `waterfallCsv` missing.

- [ ] **Step 2: Rewire the builder**

In `src/components/taxes/taxChartOptions.ts`:

```ts
import { grid, moneyAxis, monthAxis, roundTo } from '../../charts/grammar'
import { waterfallCsv as stepsCsv, waterfallSeries, waterfallSteps, waterfallTooltip } from '../../charts/waterfall'
```

Delete the private `roundTo` (the grammar's is identical). Change the color table:

```ts
// Slots start at index 4 (below it the ramp drops under 3:1 on the surface) and SKIP index 6:
// that step is also PALETTE[0], and charts/recolor.ts elects the categorical blue for a lone
// hex — so under the light theme the middle tax would have jumped out of the ramp.
export const TAX_COLORS = [
  SEQUENTIAL_BLUE[4], SEQUENTIAL_BLUE[5], SEQUENTIAL_BLUE[7], SEQUENTIAL_BLUE[8],
  SEQUENTIAL_BLUE[9], SEQUENTIAL_BLUE[10], SEQUENTIAL_BLUE[11],
] as const
```

Replace `waterfallOption` and its private `WaterfallStep` interface with:

```ts
/** The year's walk as steps — shared by the option and its CSV so the two cannot disagree. */
function taxWaterfallSteps(summary: TaxSummaryOut) {
  const gross = Number(summary.totals.gross_income)
  const takeHome = Number(summary.totals.take_home)
  const taxes = taxAmounts(summary)
  if (gross === 0 && takeHome === 0 && taxes.every((tax) => tax === 0)) return null
  return waterfallSteps(
    { label: 'Gross', amount: gross, color: OTHER_SERIES_COLOR },
    taxes
      .map((tax, i) => ({ label: TAX_LABELS[i], amount: tax, delta: -tax, color: TAX_COLORS[i] }))
      // NIIT is the one ADDITIVE line (2026-08-31): a year it does not touch keeps its eight
      // familiar bars instead of gaining a $0 step. The six sheet jurisdictions always draw.
      .filter((step) => step.label !== 'NIIT' || step.amount !== 0),
    // The closing bar is the SERVER's take-home, not the chain's last remainder: the engine
    // owns that number, and the chain landing on it is the invariant.
    { label: 'Take-home', amount: takeHome, color: POSITIVE },
  )
}

/**
 * Classic invisible-placeholder waterfall (charts/waterfall.ts): Gross and Take-home stand on
 * the floor, each tax floats on the remainder LEFT after it. Null for a year with nothing in
 * it — the card renders its empty sentence.
 */
export function waterfallOption(summary: TaxSummaryOut): EChartsOption | null {
  const steps = taxWaterfallSteps(summary)
  if (steps === null) return null
  return {
    grid: grid(),
    tooltip: waterfallTooltip(steps),
    // Eight or nine steps: every one labelled or the walk cannot be read (≤ 12 → interval 0).
    xAxis: monthAxis(steps.map((s) => s.label), { gap: true }),
    yAxis: moneyAxis(),
    series: waterfallSeries(steps),
  }
}

/** The walk as a table (F12): step, the signed figure it reports, what is left after it. */
export function waterfallCsv(summary: TaxSummaryOut): ExportTable {
  const steps = taxWaterfallSteps(summary)
  return steps === null ? { headers: ['Step', 'Amount', 'Remaining'], rows: [] } : stepsCsv(steps)
}
```

- [ ] **Step 3: Add the fixture**

```ts
// src/charts/fixtures/taxWaterfall.fixture.ts
import type { ChartFixture } from './_types'
import { waterfallOption } from '../../components/taxes/taxChartOptions'
import type { TaxSummaryOut } from '../../types/api'

export function taxSummary2024(): TaxSummaryOut {
  const income = (agi: string, ti: string, tax: string) => ({ agi, taxable_income: ti, tax, effective_rate: null })
  const wage = (wages: string, tax: string) => ({ w2_income: '235724.46', taxable_wages: wages, tax, effective_rate: null })
  return {
    year: 2024,
    federal: income('211776.20', '197176.20', '40782.88'),
    state: income('215301.15', '209761.15', '15901.12'),
    medicare: wage('231274.46', '3634.95'),
    social_security: wage('168600.00', '10453.20'),
    disability: wage('235424.46', '1950.00'),
    capital_gains: { taxable_income: '197176.20', gains_amount: '179.13', tax: '26.87', effective_rate: null },
    niit: { taxable_income: '1989.28', gains_amount: '1989.28', tax: '75.59', effective_rate: null },
    totals: { gross_income: '237973.17', total_income: '211776.20', total_tax: '72824.61', take_home: '165148.56', effective_rate: '0.306020' },
    warnings: [],
  }
}

const fixture: ChartFixture = {
  name: 'taxWaterfall',
  kind: 'cartesian',
  ariaLabel: 'Waterfall chart walking gross income down through each tax to take-home pay',
  build: () => waterfallOption(taxSummary2024()),
}
export default fixture
```

Run: `npx vitest run src/components/taxes/taxChartOptions.test.ts src/charts/conformance.test.ts src/charts/waterfall.test.ts`
Expected: PASS — including the untouched remainder pins (`0, 197190.29, 181289.17, …`).

- [ ] **Step 4: Commit**

```bash
git add src/components/taxes/taxChartOptions.ts src/components/taxes/taxChartOptions.test.ts src/charts/fixtures/taxWaterfall.fixture.ts
git commit -m "feat(taxes): waterfall on charts/waterfall.ts (24px bars, item tooltip, CSV); TAX_COLORS skips the PALETTE[0] step (F13, F7, §8; review leftover)"
```

---

### Task 2: Tax composition trend (F15) and the year pie

**Files:**
- Modify: `src/components/taxes/taxChartOptions.ts`, `src/components/taxes/taxChartOptions.test.ts`
- Create: `src/charts/fixtures/taxTrend.fixture.ts`, `src/charts/fixtures/taxYearPie.fixture.ts`

F15: the secondary percent axis and the `Effective rate` line go; the rate becomes a `capLabel` on the top stack series (one number per year cap) and a footer line in the tooltip. F13 (`barMaxWidth` 24), F7 (`axisTooltip` with `Total tax`, `shadow` pointer; `itemTooltip` on the pie with "xx.x% of tax"), §9 (`BAR_MARKS` focus, `legendFor(selected)`), §11 (`stagger`), §8 (`grid()` — right 56 → 24 now that the second axis is gone; `monthAxis` labels every year at ≤ 12), F12 (`yearPieCsv`).

- [ ] **Step 1: Update the tests**

In `taxChartOptions.test.ts`, `describe('trendOption', …)`:

1. Rename `'stacks the seven taxes per year and lines the effective rate on a % axis'` → `'stacks the seven taxes per year; the effective rate is a cap label, not an axis'` and replace its tail (from `const rate = series[7]`) with:
   ```ts
   expect(series).toHaveLength(7) // no rate line (F15)
   expect(series.every((s) => s.type === 'bar')).toBe(true)
   const yAxis = (option as unknown as { yAxis: { type: string; axisLabel: { formatter: unknown } } }).yAxis
   expect(Array.isArray(yAxis)).toBe(false) // one axis (F15)
   expect(yAxis.axisLabel.formatter).toBe(compactMoney)
   // The rate rides the TOP series' cap as a direct label — the 6dp fraction ×100, 1dp.
   const cap = (series[6] as { label?: { formatter: (p: { dataIndex: number }) => string } }).label!
   expect(cap.formatter({ dataIndex: 0 })).toBe('27.2%')
   expect(cap.formatter({ dataIndex: 1 })).toBe('30.6%')
   expect(series.slice(0, 6).every((s) => (s as { label?: unknown }).label === undefined)).toBe(true)
   expect((series[0] as { barMaxWidth?: number }).barMaxWidth).toBe(24) // F13
   expect((option as { grid: unknown }).grid).toEqual(GRID_VARIANTS.default)
   ```
2. Replace `'divides the rate back out in BOTH places that render it'` with:
   ```ts
   it('F7/F15: jurisdictions by value, Total tax, then the rate as a footer line', () => {
     const option = trendOption([summaryFixture(2024)])!
     const format = (option as unknown as { tooltip: { formatter: (p: unknown) => string; axisPointer: unknown } }).tooltip
     expect(format.axisPointer).toEqual({ type: 'shadow' })
     const parsed = tooltipRows(format.formatter([
       { seriesName: 'State', seriesType: 'bar', axisValueLabel: '2024', dataIndex: 0, value: 15901.12, color: TAX_COLORS[1] },
       { seriesName: 'Federal', seriesType: 'bar', value: 40782.88, color: TAX_COLORS[0] },
       { seriesName: 'SDI', seriesType: 'bar', value: null, color: TAX_COLORS[4] },
     ]))
     expect(parsed.rows.map((r) => [r.kind, r.label, r.value])).toEqual([
       ['row', 'Federal', '$40,782.88'],
       ['row', 'State', '$15,901.12'],
       ['total', 'Total tax', '$56,684.00'],
     ])
     expect(parsed.foot).toEqual(['Effective rate 30.6%'])
   })
   ```
3. `'breaks the rate line where a year has no rate, and still stacks its zeros'` → keep the stack assertions, replace the `series[7]` line with `expect((series[6] as { label: { formatter: (p: { dataIndex: number }) => string } }).label.formatter({ dataIndex: 1 })).toBe('')` (no rate → no cap label text) and add a footer check: the formatter with `dataIndex: 1` yields `foot: []`.
4. `'gives the seven stacks the stable ids…'` → drop the `series[7].id` line; add `expect(series.every((s) => typeof (s as { animationDelay?: unknown }).animationDelay === 'function')).toBe(true)`.
5. `'totals the jurisdiction rows — dashes excluded…'` → delete (covered by 2).
6. Add `expect(trendOption([summaryFixture(2024)], { selected: { State: false } })!.legend).toMatchObject({ selected: { State: false } })` as a new case `'feeds the panel's legend picks back in'`.
7. `describe('yearPieOption')` — replace `'says "of tax" in the tooltip…'` with:
   ```ts
   it('F7: value first, the jurisdiction, "of tax" — a bare percent reads as a rate on income', () => {
     const format = (yearPieOption(summaryFixture(2024)) as unknown as { tooltip: { trigger: string; formatter: (p: unknown) => string } }).tooltip
     expect(format.trigger).toBe('item')
     const parsed = tooltipRows(format.formatter({ name: 'Federal', value: 40782.88, percent: 56.0 }))
     expect([parsed.lead, parsed.label, parsed.sub]).toEqual(['$40,782.88', 'Federal', '56.0% of tax'])
   })
   it('exports the drawn slices', () => {
     expect(yearPieCsv(summaryFixture(2026))).toEqual({
       headers: ['Jurisdiction', 'Tax'],
       rows: [['Federal', '57160.35'], ['State', '22206.80'], ['Medicare', '5299.21'], ['Soc. Sec.', '10918.20'], ['SDI', '3000.00']],
     })
   })
   ```
   Remove the now-unused `rateAxisLabelOf` / `yAxesOf` helpers. Imports: `GRID_VARIANTS, compactMoney` from grammar, `tooltipRows`, `yearPieCsv`.

Run: `npx vitest run src/components/taxes/taxChartOptions.test.ts`
Expected: FAIL — eight series, two axes, no cap label.

- [ ] **Step 2: Rewrite `trendOption` and `yearPieOption`**

```ts
import { BAR_MARKS, capLabel, grid, moneyAxis, monthAxis, roundTo, stagger } from '../../charts/grammar'
import { legendFor } from '../../charts/legend'
import { axisTooltip, itemTooltip } from '../../charts/tooltip'

/**
 * Multi-year composition: one stacked bar per year of the tax figures with the year's
 * effective rate as a direct label on the stack's cap (F15 — one axis; a ratio does not share
 * a money axis and does not deserve a second one). Null with no years.
 */
export function trendOption(years: TaxSummaryOut[], { selected }: { selected?: Record<string, boolean> } = {}): EChartsOption | null {
  if (years.length === 0) return null
  const ordered = [...years].sort((a, b) => a.year - b.year)
  const amounts = ordered.map(taxAmounts)
  // Percent units at 4dp (0.306020 × 100 is 30.602000000000004 unrounded).
  const rates = ordered.map((y) => (y.totals.effective_rate === null ? null : roundTo(Number(y.totals.effective_rate) * 100, 4)))
  const rateText = (index: number) => (rates[index] === null || rates[index] === undefined ? '' : formatPct(rates[index] / 100, { signed: false }))
  const niitIndex = TAX_LABELS.indexOf('NIIT')
  const stacked = amounts.some((a) => a[niitIndex] !== 0) ? [...TAX_LABELS] : TAX_LABELS.slice(0, niitIndex)
  const top = stacked.length - 1
  return {
    grid: grid(),
    legend: legendFor(stacked.length, selected),
    tooltip: axisTooltip({
      unit: 'money',
      groups: stacked,
      totalLabel: 'Total tax',
      pointer: 'shadow',
      // The rate is a ratio, not another addend: it stays out of the sum and under it.
      footer: (index) => (rateText(index) === '' ? [] : [`Effective rate ${rateText(index)}`]),
    }),
    xAxis: monthAxis(ordered.map((y) => String(y.year)), { gap: true }),
    yAxis: moneyAxis(),
    series: stacked.map((label, i) => ({
      id: TAX_SERIES_IDS[i],
      name: label,
      type: 'bar' as const,
      stack: 'tax',
      ...BAR_MARKS,
      barMaxWidth: 24,
      ...stagger(i),
      color: TAX_COLORS[i],
      universalTransition: true,
      // The cap label rides the TOP series so it sits on the year's total; an empty string for
      // a year with no gross income (no rate to state).
      ...(i === top ? { label: capLabel((p) => rateText(p.dataIndex)) } : {}),
      data: amounts.map((a) => a[i]),
    })),
  }
}

export function yearPieOption(summary: TaxSummaryOut): EChartsOption | null {
  const slices = taxAmounts(summary)
    .map((value, i) => ({ name: TAX_LABELS[i], value, color: TAX_COLORS[i] }))
    .filter((s) => s.value > 0)
  if (slices.length === 0) return null
  return {
    // "of tax": the percent shares the YEAR'S TOTAL TAX — bare, a Federal "56.1%" reads as a
    // rate on income, which the cap label above the trend says is ~30%.
    tooltip: itemTooltip<{ name?: string; value?: unknown; percent?: number }>({
      body: (p) => ({ value: Number(p.value), label: p.name ?? '', sub: `${(p.percent ?? 0).toFixed(1)}% of tax` }),
    }),
    series: [
      {
        id: 'tax-year-pie',
        type: 'pie' as const,
        radius: ['42%', '70%'],
        itemStyle: { borderColor: SURFACE, borderWidth: 2 },
        label: { color: INK, formatter: '{b}  {d}%' },
        emphasis: { itemStyle: { borderColor: INK } },
        universalTransition: { enabled: true, seriesKey: [...TAX_SERIES_IDS] },
        data: slices.map((s) => ({ name: s.name, value: s.value, itemStyle: { color: s.color } })),
      },
    ],
  }
}

/** The drilled year as a table (F12): the positive slices the pie draws. */
export function yearPieCsv(summary: TaxSummaryOut): ExportTable {
  return {
    headers: ['Jurisdiction', 'Tax'],
    rows: taxAmounts(summary)
      .map((value, i) => ({ name: TAX_LABELS[i], value }))
      .filter((s) => s.value > 0)
      .map((s) => [s.name, s.value.toFixed(2)]),
  }
}
```

Delete `RATE_SERIES_NAME`; `MUTED` may now be unused in this module — remove the import if `tsc` says so.

- [ ] **Step 3: Add the fixtures**

```ts
// src/charts/fixtures/taxTrend.fixture.ts
import type { ChartFixture } from './_types'
import { trendOption } from '../../components/taxes/taxChartOptions'
import { taxSummary2024 } from './taxWaterfall.fixture'

const fixture: ChartFixture = {
  name: 'taxTrend',
  kind: 'cartesian',
  ariaLabel: 'Stacked bar chart of tax by jurisdiction per year, with the effective rate on each cap',
  build: () => trendOption([taxSummary2024(), { ...taxSummary2024(), year: 2025 }]),
}
export default fixture
```

```ts
// src/charts/fixtures/taxYearPie.fixture.ts
import type { ChartFixture } from './_types'
import { yearPieOption } from '../../components/taxes/taxChartOptions'
import { taxSummary2024 } from './taxWaterfall.fixture'

const fixture: ChartFixture = {
  name: 'taxYearPie',
  kind: 'pie',
  ariaLabel: 'Donut chart of one year’s tax by jurisdiction',
  exempt: ['grid', 'axis'],
  build: () => yearPieOption(taxSummary2024()),
}
export default fixture
```

Run: `npx vitest run src/components/taxes/taxChartOptions.test.ts src/charts/conformance.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/taxes/taxChartOptions.ts src/components/taxes/taxChartOptions.test.ts src/charts/fixtures/taxTrend.fixture.ts src/charts/fixtures/taxYearPie.fixture.ts
git commit -m "feat(taxes): composition trend on one axis with the rate as a cap label; year pie on the item tooltip; CSV (F15, F13, F7, F12, §9, §11)"
```

---

### Task 3: The marginal ladder on the grammar

**Files:**
- Modify: `src/components/taxes/taxChartOptions.ts`, `src/components/taxes/taxChartOptions.test.ts`
- Create: `src/charts/fixtures/marginalLadder.fixture.ts`

Named changes: §8 (`grid('noLegend')` — was `{70,24,12,28}`; the money axis is the X axis here, `moneyAxis()`), F13/§17 (`barMaxWidth` 26 → 24 through `BAR_MARKS`), F7 (`itemTooltip` on the bracket cells AND on the income marker), F12 (`ladderCsv`).

- [ ] **Step 1: Extend the tests**

In `describe('marginalLadderOption')` add:

```ts
  it('grammar: no-legend grid, compact money X axis, 24px bars with the surface hairline', () => {
    const option = marginalLadderOption([fedRow, stateRow])! as unknown as {
      grid: unknown
      xAxis: { type: string; axisLabel: { formatter: unknown } }
      series: { barMaxWidth?: number; itemStyle?: unknown }[]
    }
    expect(option.grid).toEqual(GRID_VARIANTS.noLegend)
    expect(option.xAxis.type).toBe('value')
    expect(option.xAxis.axisLabel.formatter).toBe(compactMoney)
    expect(option.series[0].barMaxWidth).toBe(24)
    expect(option.series[0].itemStyle).toEqual({ borderColor: SURFACE, borderWidth: 1 })
  })
  it('F7: a cell reads rate first, then the jurisdiction, then the range; the marker reads the income', () => {
    const option = marginalLadderOption([fedRow, stateRow])! as unknown as {
      tooltip: { formatter: (p: unknown) => string }
      series: { tooltip?: { formatter: (p: unknown) => string } }[]
    }
    const cell = tooltipRows(option.tooltip.formatter({ dataIndex: 0, seriesIndex: 2 }))
    expect([cell.lead, cell.label, cell.sub]).toEqual(['22.0%', 'Federal bracket', '$47,150.00 – $100,525.00'])
    const top = tooltipRows(option.tooltip.formatter({ dataIndex: 1, seriesIndex: 1 }))
    expect(top.sub).toBe('$10,000.00 and up')
    expect(option.tooltip.formatter({ dataIndex: 1, seriesIndex: 3 })).toBe('') // the state lane has two brackets
    const marker = tooltipRows(option.series[4].tooltip!.formatter({ dataIndex: 1 }))
    expect([marker.lead, marker.label]).toEqual(['$60,000.00', 'State taxable income'])
  })
  it('exports every bracket per lane', () => {
    const csv = ladderCsv([fedRow, stateRow])
    expect(csv.headers).toEqual(['Jurisdiction', 'Bracket', 'Rate', 'From', 'To'])
    expect(csv.rows[2]).toEqual(['Federal', 3, '0.22', '47150.00', '100525.00'])
    expect(csv.rows[5]).toEqual(['State', 2, '0.093', '10000.00', ''])
  })
```

Imports: `SURFACE` from theme, `ladderCsv` from the module.

Run: `npx vitest run src/components/taxes/taxChartOptions.test.ts`
Expected: FAIL — old grid, 26px bars, string tooltip, no CSV.

- [ ] **Step 2: Rewrite the builder**

```ts
export function marginalLadderOption(rows: LadderRow[]): EChartsOption | null {
  const drawable = rows.filter((row) => row.segments.length > 0 && ladderCap(row) > 0)
  if (drawable.length === 0) return null
  interface Cell { span: number; color: string; rate: number; floor: number; ceiling: number | null }
  const cells: Cell[][] = drawable.map((row) => {
    const cap = ladderCap(row)
    return row.segments.map((segment, i) => ({
      span: roundTo((segment.ceiling ?? cap) - segment.floor, 2),
      color: segment.current ? LADDER_CURRENT : i % 2 === 0 ? LADDER_BASE_A : LADDER_BASE_B,
      rate: segment.rate, floor: segment.floor, ceiling: segment.ceiling,
    }))
  })
  const maxSegments = Math.max(...cells.map((lane) => lane.length))
  const range = (cell: Cell) =>
    cell.ceiling === null ? `${formatCurrency(cell.floor)} and up` : `${formatCurrency(cell.floor)} – ${formatCurrency(cell.ceiling)}`
  return {
    grid: grid('noLegend'),
    // Item trigger: an axis tooltip would announce every segment of the lane at once. Rate
    // first — it is the answer the ladder exists to give.
    tooltip: itemTooltip<{ dataIndex?: number; seriesIndex?: number }>({
      body: (p) => {
        const cell = cells[p.dataIndex ?? -1]?.[p.seriesIndex ?? -1]
        const lane = drawable[p.dataIndex ?? -1]
        if (cell === undefined || lane === undefined) return null
        return { value: formatPct(cell.rate, { signed: false }), label: `${lane.label} bracket`, sub: range(cell) }
      },
    }),
    xAxis: moneyAxis(),
    // inverse, so the first lane (Federal) reads on TOP the way the sentence orders them.
    yAxis: { type: 'category', data: drawable.map((row) => row.label), inverse: true },
    series: [
      ...Array.from({ length: maxSegments }, (_, i) => ({
        name: `Bracket ${i + 1}`,
        type: 'bar' as const,
        stack: 'ladder',
        ...BAR_MARKS,
        barMaxWidth: 24,
        data: cells.map((lane) => (lane[i] === undefined ? null : { value: lane[i].span, itemStyle: { color: lane[i].color } })),
      })),
      {
        name: 'Taxable income',
        type: 'scatter' as const,
        symbol: 'diamond',
        symbolSize: 11,
        itemStyle: { color: INK },
        z: 10,
        data: drawable.map((row) => [row.taxableIncome, row.label]),
        tooltip: itemTooltip<{ dataIndex?: number }>({
          body: (p) => {
            const lane = drawable[p.dataIndex ?? -1]
            return lane === undefined ? null : { value: lane.taxableIncome, label: `${lane.label} taxable income` }
          },
        }),
      },
    ],
  }
}

/** The ladder as a table (F12): every bracket of every lane, rate as the stored fraction. */
export function ladderCsv(rows: LadderRow[]): ExportTable {
  return {
    headers: ['Jurisdiction', 'Bracket', 'Rate', 'From', 'To'],
    rows: rows.flatMap((row) =>
      row.segments.map((segment, i) => [row.label, i + 1, String(segment.rate), segment.floor.toFixed(2), segment.ceiling === null ? '' : segment.ceiling.toFixed(2)]),
    ),
  }
}
```

(`BAR_MARKS` brings `emphasis.focus: 'series'` to the bracket stacks — harmless here and consistent; the marker keeps its own `itemStyle`.)

- [ ] **Step 3: Add the fixture**

```ts
// src/charts/fixtures/marginalLadder.fixture.ts
import type { ChartFixture } from './_types'
import { marginalLadderOption } from '../../components/taxes/taxChartOptions'

const fixture: ChartFixture = {
  name: 'marginalLadder',
  kind: 'cartesian',
  ariaLabel: 'Bracket ladder per jurisdiction with this year’s taxable income marked',
  build: () =>
    marginalLadderOption([
      { label: 'Federal', taxableIncome: 50000, segments: [
        { rate: 0.1, floor: 0, ceiling: 11600, current: false }, { rate: 0.12, floor: 11600, ceiling: 47150, current: false },
        { rate: 0.22, floor: 47150, ceiling: 100525, current: true }, { rate: 0.24, floor: 100525, ceiling: null, current: false },
      ] },
      { label: 'State', taxableIncome: 60000, segments: [
        { rate: 0.01, floor: 0, ceiling: 10000, current: false }, { rate: 0.093, floor: 10000, ceiling: null, current: true },
      ] },
    ]),
}
export default fixture
```

Run: `npx vitest run src/components/taxes/taxChartOptions.test.ts src/components/taxes/MarginalPanel.test.tsx src/charts/conformance.test.ts`
Expected: PASS (if `MarginalPanel.test.tsx` sampled the old tooltip string, re-point it at `tooltipRows(...).lead`).

- [ ] **Step 4: Commit**

```bash
git add src/components/taxes/taxChartOptions.ts src/components/taxes/taxChartOptions.test.ts src/charts/fixtures/marginalLadder.fixture.ts
git commit -m "feat(taxes): marginal ladder on the grammar — no-legend grid, 24px bars, rate-first item tooltips, CSV (§8, F7, F12, F13)"
```

---

### Task 4: Card-value bars and the credit-line history

**Files:**
- Modify: `src/components/creditcards/cardValueChartOptions.ts`, `cardValueChartOptions.test.ts`, `creditLineChartOptions.ts`, `creditLineChartOptions.test.ts`
- Create: `src/charts/fixtures/cardValue.fixture.ts`, `src/charts/fixtures/creditLine.fixture.ts`

Card value: F13 (the full-currency X axis goes compact), §8 (`grid('horizontal')` is the same `{130,40,8,28}`), F7 (`itemTooltip`), §9 (`BAR_MARKS` — the sign colours stay per item), `zeroLine('x')` (byte-identical), F12 (`cardValueCsv`). Credit line: §9 (`LINE`, `legendFor(selected)` — the legend persisted, F9), F7 (`axisTooltip`), F12 (`creditLineCsv`); `slotColor(i)` replaces the inline `PALETTE[i] / OTHER_SERIES_COLOR` (same values).

- [ ] **Step 1: Update the tests**

`cardValueChartOptions.test.ts` — replace `'tooltip spells the breakdown and escapes the name'` and add:

```ts
import { GRID_VARIANTS, compactMoney } from '../../charts/grammar'
import { MUTED, SURFACE } from '../../charts/theme'
import { tooltipRows } from '../../testing/tooltipRows'
import { cardValueCsv } from './cardValueChartOptions'

  it('F7: net first, the escaped name, the breakdown as the sub-line', () => {
    const format = (option.tooltip as { trigger: string; formatter: (p: unknown) => string })
    expect(format.trigger).toBe('item')
    const parsed = tooltipRows(format.formatter({ dataIndex: 1 }))
    expect([parsed.lead, parsed.label, parsed.sub]).toEqual(['$507.00', '&lt;b&gt;VX&lt;/b&gt;', '$602.00 marginal + $300.00 credits − $395.00 fee, per year'])
    expect(format.formatter({ dataIndex: 9 })).toBe('')
  })
  it('grammar: horizontal grid, compact money X axis, bar marks, the zero baseline', () => {
    expect((option as { grid: unknown }).grid).toEqual(GRID_VARIANTS.horizontal)
    expect((option.xAxis as { axisLabel: { formatter: unknown } }).axisLabel.formatter).toBe(compactMoney) // F13: was full currency
    expect(series).toMatchObject({ barMaxWidth: 22, itemStyle: { borderColor: SURFACE, borderWidth: 1 } })
    expect(series.markLine).toEqual({ silent: true, symbol: 'none', lineStyle: { color: MUTED, width: 1, type: 'solid' }, label: { show: false }, data: [{ xAxis: 0 }] })
  })
  it('exports the breakdown', () => {
    expect(cardValueCsv(ROWS)).toEqual({
      headers: ['Card', 'Marginal', 'Credits', 'Fee', 'Net'],
      rows: [['BILT', '918.00', '0.00', '0.00', '918.00'], ['<b>VX</b>', '602.00', '300.00', '395.00', '507.00'], ['RH Gold', '0.00', '0.00', '0.00', '0.00']],
    })
  })
```

(`series`'s type in the file gains `barMaxWidth?: number; itemStyle?: unknown`.)

`creditLineChartOptions.test.ts` — add:

```ts
import { GRID_VARIANTS } from '../../charts/grammar'
import { INK, PALETTE } from '../../charts/theme'
import { tooltipRows } from '../../testing/tooltipRows'
import { creditLineCsv } from './creditLineChartOptions'

  it('grammar: money grid, LINE posture on every step series, INK total, legend picks fed back', () => {
    const option = creditLineChartOption([VX, BILT], months, { includeTotal: true, selected: { BILT: false } }) as unknown as {
      grid: unknown; legend: { type: string; selected: unknown }
      series: { color: string; symbol: string; step: string; emphasis: unknown; z?: number }[]
      tooltip: { formatter: (p: unknown) => string }
    }
    expect(option.grid).toEqual(GRID_VARIANTS.default)
    expect(option.legend).toMatchObject({ type: 'plain', selected: { BILT: false } })
    expect(option.series.map((s) => s.color)).toEqual([PALETTE[0], PALETTE[1], INK])
    expect(option.series[0]).toMatchObject({ symbol: 'none', step: 'end', emphasis: { focus: 'series' } })
    expect(option.series[2].z).toBe(10)
    const rows = tooltipRows(option.tooltip.formatter([
      { seriesName: 'Venture X', seriesType: 'line', axisValueLabel: 'Feb 2024', value: 20000, color: PALETTE[0] },
      { seriesName: 'BILT', seriesType: 'line', value: 12500, color: PALETTE[1] },
      { seriesName: 'Total line', seriesType: 'line', value: 32500, color: INK },
    ]))
    expect(rows.rows.map((r) => [r.label, r.value])).toEqual([['Venture X', '$20,000.00'], ['BILT', '$12,500.00'], ['Total line', '$32,500.00']])
  })
  it('exports month × card + total, blanks before a card exists', () => {
    expect(creditLineCsv([VX, BILT], months)).toEqual({
      headers: ['Month', 'Venture X', 'BILT', 'Total'],
      rows: [['2024-01-01', '20000.00', '', '20000.00'], ['2024-02-01', '20000.00', '12500.00', '32500.00'], ['2024-09-01', '25000.00', '12500.00', '37500.00']],
    })
  })
```

Run: `npx vitest run src/components/creditcards`
Expected: FAIL.

- [ ] **Step 2: Rewrite the two builders**

`cardValueChartOptions.ts`:

```ts
import { BAR_MARKS, grid, moneyAxis } from '../../charts/grammar'
import { zeroLine } from '../../charts/markLine'
import { NEGATIVE, POSITIVE } from '../../charts/theme'
import { itemTooltip } from '../../charts/tooltip'
import type { ExportTable } from '../../utils/download'
import { formatCurrency } from '../../utils/format'

export function cardValueChartOption(rows: CardValueDatum[]): EChartsOption {
  return {
    grid: grid('horizontal'),
    tooltip: itemTooltip<{ dataIndex?: number }>({
      body: (p) => {
        const row = rows[p.dataIndex ?? -1]
        if (row === undefined) return null
        return {
          value: row.net,
          label: row.name,
          sub: `${formatCurrency(row.marginal)} marginal + ${formatCurrency(row.credits)} credits − ${formatCurrency(row.fee)} fee, per year`,
        }
      },
    }),
    // Compact ticks (F13): the axis is a scale, the tooltip carries the exact figure.
    xAxis: moneyAxis(),
    yAxis: {
      type: 'category',
      data: rows.map((r) => r.name),
      inverse: true, // first row (best) on top
      axisLabel: { width: 118, overflow: 'truncate' as const },
    },
    series: [
      {
        type: 'bar' as const,
        ...BAR_MARKS,
        // Sign colours per item: keeping is POSITIVE, anything that does not clear its fee reads
        // NEGATIVE (droppable) — the reserved status use spec §12 allows.
        data: rows.map((r) => ({ value: r.net, itemStyle: { color: r.net > 0 ? POSITIVE : NEGATIVE } })),
        markLine: zeroLine('x'),
      },
    ],
  }
}

export function cardValueCsv(rows: CardValueDatum[]): ExportTable {
  return {
    headers: ['Card', 'Marginal', 'Credits', 'Fee', 'Net'],
    rows: rows.map((r) => [r.name, r.marginal.toFixed(2), r.credits.toFixed(2), r.fee.toFixed(2), r.net.toFixed(2)]),
  }
}
```

`creditLineChartOptions.ts`:

```ts
import { slotColor } from '../../charts/entities'
import { LINE, grid, moneyAxis, monthAxis } from '../../charts/grammar'
import { legendFor } from '../../charts/legend'
import { INK } from '../../charts/theme'
import { axisTooltip } from '../../charts/tooltip'
import type { ExportTable } from '../../utils/download'

function totalLine(perCard: (number | null)[][], months: string[]): (number | null)[] {
  return months.map((_, i) => {
    let sum = 0
    let any = false
    for (const values of perCard) { const v = values[i]; if (v === null) continue; any = true; sum += v }
    return any ? sum : null
  })
}

export function creditLineChartOption(
  cards: LimitHistoryCard[],
  months: string[],
  { includeTotal, selected }: { includeTotal: boolean; selected?: Record<string, boolean> },
): EChartsOption {
  const perCard = cards.map((card) => resolvedLimits(card, months))
  const series = [
    ...cards.map((card, i) => ({
      ...LINE,
      name: card.name,
      step: 'end' as const, // limits change discretely — steps, not slopes
      color: slotColor(i),
      connectNulls: false,
      data: perCard[i],
    })),
    ...(includeTotal
      ? [{ ...LINE, name: 'Total line', step: 'end' as const, color: INK, z: 10, connectNulls: false, data: totalLine(perCard, months) }]
      : []),
  ]
  return {
    grid: grid(),
    legend: legendFor(series.length, selected),
    tooltip: axisTooltip({ unit: 'money' }),
    xAxis: monthAxis(months.map(formatMonth), { gap: true }),
    yAxis: moneyAxis(),
    series,
  }
}

export function creditLineCsv(cards: LimitHistoryCard[], months: string[]): ExportTable {
  const perCard = cards.map((card) => resolvedLimits(card, months))
  const total = totalLine(perCard, months)
  const cell = (v: number | null) => (v === null ? '' : v.toFixed(2))
  return {
    headers: ['Month', ...cards.map((c) => c.name), 'Total'],
    rows: months.map((m, i) => [m, ...perCard.map((values) => cell(values[i])), cell(total[i])]),
  }
}
```

- [ ] **Step 3: Add the fixtures**

```ts
// src/charts/fixtures/cardValue.fixture.ts
import type { ChartFixture } from './_types'
import { cardValueChartOption } from '../../components/creditcards/cardValueChartOptions'

const fixture: ChartFixture = {
  name: 'cardValue',
  kind: 'cartesian',
  ariaLabel: 'Horizontal bars of each card’s estimated net annual value',
  build: () => cardValueChartOption([
    { name: 'BILT', marginal: 918, credits: 0, fee: 0, net: 918 },
    { name: 'Venture X', marginal: 602, credits: 300, fee: 395, net: 507 },
    { name: 'RH Gold', marginal: 0, credits: 0, fee: 0, net: 0 },
  ]),
}
export default fixture
```

```ts
// src/charts/fixtures/creditLine.fixture.ts
import type { ChartFixture } from './_types'
import { creditLineChartOption } from '../../components/creditcards/creditLineChartOptions'

const fixture: ChartFixture = {
  name: 'creditLine',
  kind: 'cartesian',
  ariaLabel: 'Step chart of credit limits over time per card, with the total',
  build: () =>
    creditLineChartOption(
      [
        { name: 'Venture X', events: [{ effective_date: '2023-05-12', limit_amount: '20000.00' }, { effective_date: '2024-08-01', limit_amount: '25000.00' }] },
        { name: 'BILT', events: [{ effective_date: '2024-02-20', limit_amount: '12500.00' }] },
      ],
      ['2024-01-01', '2024-02-01', '2024-09-01'],
      { includeTotal: true },
    ),
}
export default fixture
```

Run: `npx vitest run src/components/creditcards src/charts/conformance.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/creditcards/cardValueChartOptions.ts src/components/creditcards/cardValueChartOptions.test.ts src/components/creditcards/creditLineChartOptions.ts src/components/creditcards/creditLineChartOptions.test.ts src/charts/fixtures/cardValue.fixture.ts src/charts/fixtures/creditLine.fixture.ts
git commit -m "feat(credit-cards): card-value bars (compact axis, item tooltip, CSV) and credit-line steps (LINE, persisted legend, CSV) on the grammar (F13, F7, F9, F12)"
```

---

### Task 5: The paycheck sankey — CSV and fixture

**Files:**
- Modify: `src/components/paycheck/paycheckSankeyOptions.ts`, `src/components/paycheck/paycheckSankeyOptions.test.ts`
- Create: `src/charts/fixtures/paycheckSankey.fixture.ts`

`charts/sankey.ts` already conforms (§7) and C1 branded its factory; the builder's option is untouched. This task adds the table twin's data (F12) and the fixture.

- [ ] **Step 1: Write the failing test**

Append to `paycheckSankeyOptions.test.ts`:

```ts
import { paycheckSankeyCsv } from './paycheckSankeyOptions'

it('exports nodes then links, the TABLE figures (never link sums)', () => {
  const csv = paycheckSankeyCsv(breakdown())
  expect(csv.headers).toEqual(['Kind', 'Source', 'Target', 'Value'])
  expect(csv.rows).toContainEqual(['node', 'Post-tax', '', '4486.26'])
  expect(csv.rows).toContainEqual(['link', 'Post-tax', 'Net pay', '3384.16'])
  expect(paycheckSankeyCsv(breakdown({ net_pay: '-1.00' })).rows).toEqual([])
})
```

Run: `npx vitest run src/components/paycheck/paycheckSankeyOptions.test.ts`
Expected: FAIL — not exported.

- [ ] **Step 2: Add the CSV**

```ts
import { sankeyCsv } from '../../charts/sankey'
import type { ExportTable } from '../../utils/download'

/** The flow as a table (F12): the same nodes and links the chart draws — null option → no rows. */
export function paycheckSankeyCsv(data: PaycheckBreakdownOut): ExportTable {
  const option = paycheckSankeyOption(data) as { series?: { data: SankeyNode[]; links: SankeyLink[] }[] } | null
  const series = option?.series?.[0]
  return series === undefined ? { headers: ['Kind', 'Source', 'Target', 'Value'], rows: [] } : sankeyCsv(series.data, series.links)
}
```

- [ ] **Step 3: Add the fixture**

```ts
// src/charts/fixtures/paycheckSankey.fixture.ts
import type { ChartFixture } from './_types'
import { paycheckSankeyOption } from '../../components/paycheck/paycheckSankeyOptions'

const fixture: ChartFixture = {
  name: 'paycheckSankey',
  kind: 'sankey',
  ariaLabel: 'Sankey flow of one paycheck from gross to net',
  exempt: ['grid', 'axis', 'legend'],
  build: () =>
    paycheckSankeyOption({
      profile: { id: 1, person_id: 1, effective_date: '2026-01-01', annual_salary: '188930.00', pay_periods_per_year: 24, trad_401k_pct: '0.13', roth_401k_pct: '0', after_tax_401k_pct: '0.03', espp_pct: '0.11', withholding_pct: '0.334', dental_vision_per_check: '12.50', hsa_per_check: '100.00', hsa_coverage: 'self', notes: null },
      gross: '7872.08', trad_401k: '1023.37', dental_vision: '12.50', hsa: '100.00', taxable: '6736.21', withholding: '2249.96',
      post_tax: '4486.26', roth_401k: '0.00', after_tax_401k: '236.16', espp: '865.93', net_pay: '3384.16', monthly_net: '6768.33',
      warnings: [], pace: [],
    }),
}
export default fixture
```

Run: `npx vitest run src/components/paycheck src/charts/conformance.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/paycheck/paycheckSankeyOptions.ts src/components/paycheck/paycheckSankeyOptions.test.ts src/charts/fixtures/paycheckSankey.fixture.ts
git commit -m "feat(paycheck): sankey CSV via the shared factory and a conformance fixture (F12)"
```

---

### Task 6: Every mount onto `ChartCard` — taxes panels, credit cards, paycheck

**Files:**
- Modify: `src/components/taxes/SummaryPanel.tsx`, `CompositionPanel.tsx`, `MarginalPanel.tsx`, `WhatIfPanel.tsx`
- Modify: `src/pages/CreditCardsPage.tsx`, `src/components/creditcards/CardDetail.tsx`
- Modify: `src/pages/PaycheckPage.tsx`
- Modify: `src/pages/TaxesPage.test.tsx`, `src/components/taxes/MarginalPanel.test.tsx`, `src/pages/CreditCardsPage.test.tsx`, `src/pages/PaycheckPage.test.tsx`

Eight mounts. F9 (the trend and the credit-line legends persist), F11 (`ariaLabel`s), F12 (export + Table on all eight). `WhatIfPanel` is not a chart; its header only swaps class so `taxes.css`'s `.tax-chart-header` copy goes unused.

- [ ] **Step 1: Extend the tests**

- `TaxesPage.test.tsx`: `expect(screen.getByText('Effective rate'))` at line ~839 — if it targeted the trend legend name rather than the summary tile, retarget it to the cap label the mock cannot render and instead assert the card: `expect(screen.getByLabelText(/Stacked bar chart of tax by jurisdiction per year/)).toBeTruthy()`. Add: `expect(screen.getByLabelText(/Waterfall chart walking gross income/)).toBeTruthy()`, `expect(screen.getByRole('group', { name: /Export tax-trend/ })).toBeTruthy()`, and in the drill case `expect(screen.getByLabelText(/Donut chart of 2024’s tax by jurisdiction/)).toBeTruthy()` plus the `All years` button still working.
- `MarginalPanel.test.tsx`: `expect(screen.getByLabelText(/Bracket ladder per jurisdiction/)).toBeTruthy()`; the "no tables" case still finds the empty sentence (now the card's `empty`).
- `CreditCardsPage.test.tsx`: `expect(screen.getByLabelText(/Horizontal bars of each card/)).toBeTruthy()`, `expect(screen.getByLabelText(/Step chart of credit limits/)).toBeTruthy()`, `expect(screen.getAllByRole('group', { name: /Export/ })).toHaveLength(2)`; the no-weights sentence is now the value card's `empty` text (same words — the assertion holds).
- `PaycheckPage.test.tsx`: `expect(screen.getByLabelText('Sankey flow of one paycheck from gross to net')).toBeTruthy()`, `expect(screen.getByRole('group', { name: 'Export paycheck-flow' })).toBeTruthy()`. The `data-animate` assertions (lines ~915/935/943/1250) hold only if the frame's `fromCache` mirrors the old `still` flag — see step 3.

Run: `npx vitest run src/pages/TaxesPage.test.tsx src/components/taxes src/pages/CreditCardsPage.test.tsx src/pages/PaycheckPage.test.tsx`
Expected: FAIL.

- [ ] **Step 2: Taxes panels**

`SummaryPanel.tsx` — the waterfall `tax-chart-block` becomes:

```tsx
        <ChartCard
          title={`Where ${summary.year}'s gross income went`}
          hint="Gross income walked down to take-home — each floating bar is one jurisdiction's bite."
          ariaLabel="Waterfall chart walking gross income down through each tax to take-home pay"
          option={waterfall}
          empty="Nothing to chart yet — this year computes to zero until its inputs are filled in below."
          exportName={`tax-waterfall-${summary.year}`}
          csv={() => waterfallCsv(summary)}
          height={320}
        />
```

`CompositionPanel.tsx` — add `const [legendSelected, setLegendSelected] = useState<Record<string, boolean>>({})`, `trendOption(chartable, { selected: legendSelected })` in the memo, and replace the card's JSX with:

```tsx
    <ChartCard
      title={detailSummary ? `Tax breakdown — ${detailSummary.year}` : 'Tax composition by year'}
      hint="Tax composition per year stacked by jurisdiction, with the year's effective rate on each cap. Click a year for its breakdown."
      ariaLabel={detailSummary ? `Donut chart of ${detailSummary.year}’s tax by jurisdiction` : 'Stacked bar chart of tax by jurisdiction per year, with the effective rate on each cap'}
      option={detailSummary ? detailPie : trend}
      empty={
        detailSummary
          ? `No tax computed for ${detailSummary.year}.`
          : flaggedYears.length > 0
            ? 'No comparable years yet — every year with stored inputs is missing bracket tables for its filing status.'
            : 'No years with stored inputs to compare yet.'
      }
      exportName={detailSummary ? `tax-breakdown-${detailSummary.year}` : 'tax-trend'}
      csv={detailSummary ? () => yearPieCsv(detailSummary) : chartable === null ? undefined : () => taxTrendCsv(chartable)}
      height={320}
      busy={years === null && error === null}
      error={error}
      onClick={handleTrendClick}
      onLegendChange={(selected) => setLegendSelected((current) => ({ ...current, ...selected }))}
      actions={detailSummary ? <button className="button" onClick={() => setDetailYear(null)}>All years</button> : undefined}
      footer={
        detailSummary ? (
          <p className="drill-hint">
            Total tax {formatCurrency(detailSummary.totals.total_tax)} · Gross {formatCurrency(detailSummary.totals.gross_income)} · Effective rate{' '}
            {detailSummary.totals.effective_rate === null ? '—' : formatPct(detailSummary.totals.effective_rate, { signed: false })} — click the chart to go back.
          </p>
        ) : (
          <>
            <p className="drill-hint">Click a year&apos;s bar to expand its tax breakdown.</p>
            {flaggedYears.length > 0 && <p className="drill-hint">Not charted: {flaggedYears.join(', ')} — no bracket tables for that year&apos;s filing status.</p>}
          </>
        )
      }
    />
```

`MarginalPanel.tsx` — the model returns `rows` too (`return { option: marginalLadderOption(rows), parts, medicareStep, rows }`), and the card becomes:

```tsx
    <ChartCard
      title={`Marginal rates — ${summary.year}`}
      hint="Where this year's taxable income (◆) sits in the bracket ladders, and what the next $1,000 of ordinary income costs. Computed in the browser from the stored tables — nothing here is saved."
      ariaLabel="Bracket ladder per jurisdiction with this year’s taxable income marked"
      option={model.option}
      empty="No federal or state bracket tables for this year yet — the ladder has nothing to walk. Enter them in the bracket tables below."
      exportName={`marginal-ladder-${summary.year}`}
      csv={() => ladderCsv(model.rows)}
      height={170}
      footer={
        model.parts.length === 0 ? undefined : (
          <>
            <p className="marginal-sentence">{/* the unchanged sentence */}</p>
            <p className="drill-hint">Bracket boundaries and rates are this year&apos;s stored tables for its filing status. Capital gains stack separately and are not on this ladder.</p>
          </>
        )
      }
    />
```

`WhatIfPanel.tsx`: `className="tax-chart-header"` → `className="chart-card-header"`.

- [ ] **Step 3: Credit cards and paycheck**

`CreditCardsPage.tsx` — add `const [lineLegend, setLineLegend] = useState<Record<string, boolean>>({})`, pass `{ includeTotal: lineCards.length > 1, selected: lineLegend }` to `creditLineChartOption`, and replace the two value-card branches and the line card with:

```tsx
              <ChartCard
                title="Is each card worth keeping? (est.)"
                hint="Marginal value (optimal lineup with the card minus without it) plus counted credits minus the annual fee. A $0 bar means the rest of the lineup already catches that spend. Needs at least one weighted category to say anything."
                ariaLabel="Horizontal bars of each card's estimated net annual value"
                option={hasWeights ? valueOption : null}
                empty={
                  hasWeights
                    ? 'No cards to value yet.'
                    : 'No spend weights yet, so the optimizer values every card at $0 and nothing on this page is a verdict. In Categories & weights below, edit each reward category and either pick its spending category — its trailing 12-month spend becomes the weight, split evenly when several rows share one — or type an annual spend override. Rows with neither stay out of the $ math.'
                }
                exportName="card-value"
                csv={() => cardValueCsv(valueRows)}
                height={Math.max(140, valueRows.length * 34 + 70)}
                footer={
                  hasWeights && droppable.length > 0 ? (
                    <p className="drill-hint">
                      Droppable on these numbers: {droppable.join(', ')} — zero or negative net value after fees.
                      {unweightedCount > 0 && ` Excludes ${unweightedCount} unweighted ${unweightedCount === 1 ? 'category' : 'categories'}.`}
                    </p>
                  ) : undefined
                }
              />
              <ChartCard
                title="Credit line history"
                hint="Each card's limit as a step line — level between changes, stepping at each dated event — plus the total line across active cards."
                ariaLabel="Step chart of credit limits over time per card, with the total"
                option={lineOption}
                empty="No limit history yet — open a card's details and add its opening credit line."
                exportName="credit-lines"
                csv={() => creditLineCsv(lineCards, lineMonths)}
                height={300}
                onLegendChange={(selected) => setLineLegend((current) => ({ ...current, ...selected }))}
              />
```

`CardDetail.tsx` — the `Credit line` half-card becomes a `ChartCard` whose footer carries the limit table and the add form:

```tsx
        <ChartCard
          span={6}
          title="Credit line"
          hint="Dated limit changes; the newest is the current line. Steps, not slopes — the line holds level between events."
          ariaLabel={`Step chart of ${card.name}'s credit limit over time`}
          option={sparkOption}
          empty="No limit history yet — add the opening line below."
          exportName={`${card.slug}-credit-line`}
          csv={() => creditLineCsv([{ name: card.name, events: card.limit_events }], limitMonths([{ name: card.name, events: card.limit_events }], currentMonthIso()))}
          height={180}
          footer={<>{/* the unchanged limit table and add-limit form */}</>}
        />
```

`PaycheckPage.tsx` — `FlowPanel` drops its `still` prop and becomes:

```tsx
function FlowPanel({ data }: { data: PaycheckBreakdownOut }) {
  const option = useMemo(() => paycheckSankeyOption(data), [data])
  return (
    <ChartCard
      title="Where each check goes"
      hint="The table's own figures drawn as a flow — gross splits into pre-tax deductions and taxable, taxable into withholding and post-tax, post-tax into contributions and net pay. Amounts match the table exactly."
      ariaLabel="Sankey flow of one paycheck from gross to net"
      option={option}
      empty="This profile's deductions exceed pay — see the table."
      exportName="paycheck-flow"
      csv={() => paycheckSankeyCsv(data)}
      height={320}
      footer={<p className="drill-hint">Gray nodes restate money in transit; colored nodes are where it lands; green is what you keep. Hover a node to trace its flows.</p>}
    />
  )
}
```

The `still` flag the panel used to receive must reach `ChartCard` through the frame: make sure `PaycheckPage`'s `<PageFrame resource={{ …, fromCache: still }}>` carries it (if the page already sets `fromCache`, nothing to do; if it only passed `still` to the panel, add the field — it is the same fact).

Run: `npx vitest run src/pages/TaxesPage.test.tsx src/components/taxes src/pages/CreditCardsPage.test.tsx src/components/creditcards src/pages/PaycheckPage.test.tsx && npx tsc -b && npx eslint src/components/taxes src/components/creditcards src/pages/CreditCardsPage.tsx src/pages/PaycheckPage.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/taxes src/components/creditcards src/pages/CreditCardsPage.tsx src/pages/CreditCardsPage.test.tsx src/pages/PaycheckPage.tsx src/pages/PaycheckPage.test.tsx src/pages/TaxesPage.test.tsx
git commit -m "feat(taxes,credit-cards,paycheck): all eight mounts on ChartCard — persisted legends, house labels, export + Table; WhatIf header on the shared class (F9, F11, F12)"
```

---

### Task 7: Verify

- [ ] Run `npx tsc -b && npx eslint . && npx vitest run` from the worktree root. Expected: green. Run `npx vitest run src/charts/conformance.test.ts` and confirm the seven fixtures this lane added (`taxWaterfall`, `taxTrend`, `taxYearPie`, `marginalLadder`, `cardValue`, `creditLine`, `paycheckSankey`) each print a passing case.
- [ ] `grep -rn "<EChart" src/components/taxes src/components/creditcards src/pages/CreditCardsPage.tsx src/pages/PaycheckPage.tsx` → no output.
- [ ] Commit anything the runs touched; the lane is ready to merge.

---

## Self-review

**Spec coverage:** F15 (single axis, cap-label rate, tooltip rate line) → Task 2. F13 (tax/comp `barMaxWidth` 24 via the waterfall helper and the trend; card-value compact axis) → Tasks 1, 2, 4. Credit-line legend persisted (F9) → Tasks 4, 6. Sankey card with CSV → Tasks 5, 6. `TAX_COLORS[2]` leftover → Task 1. F7 on every builder here → Tasks 1–4. F11/F12 on the eight mounts → Task 6. The three header copies: `taxes.css`'s becomes unused after the `WhatIfPanel` class swap (Task 6) — deletion is C7's morning list. **Placeholders:** none. **Type consistency:** `trendOption(years, { selected })`, `creditLineChartOption(cards, months, { includeTotal, selected })`, `waterfallCsv(summary)`, `yearPieCsv`, `ladderCsv(rows)`, `cardValueCsv(rows)`, `creditLineCsv(cards, months)`, `paycheckSankeyCsv(data)` match their definitions; every grammar import (`grid`, `moneyAxis`, `monthAxis`, `BAR_MARKS`, `capLabel`, `stagger`, `roundTo`, `legendFor`, `axisTooltip`, `itemTooltip`, `zeroLine`, `slotColor`, `waterfallSteps`/`waterfallSeries`/`waterfallTooltip`, `sankeyCsv`) is a C1 export by that name.
