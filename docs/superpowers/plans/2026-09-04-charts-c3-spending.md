# Charts C3 — Spending onto the grammar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the Spending page's six charts onto the grammar from C1 (`docs/superpowers/plans/2026-09-04-charts-c1-primitives.md`): lift the five inline options (bars, month pie, heatmap, savings rate, category trends) out of `SpendingPage.tsx` into `spendingChartOptions.ts`, mount all six (the flow sankey included) through `ChartCard`, and land the spec's Spending fixes — F1 (heatmap modes `Absolute · Row · vs average`, default Row, labelled scale legend, dormant rows behind "Show N dormant"), F8 (bars + savings + trends aligned on one grid and linked through `group="spending"`; savings-rate left inset 60 → 70), F13 (`4% rule` → `Sustainable spend`), plus F7/F9/F11/F12 (grammar tooltips with the value-first Total row, persisted legends, house `ariaLabel`s, export + Table everywhere including the full heatmap matrix, savings rate, trends, drill-down pie and the sankey). The small-multiples `Compare · All` mode of the trends card is the last, droppable task.

**Architecture:** Builders are pure functions in `src/components/spending/spendingChartOptions.ts` taking the page's already-derived inputs (`matrix`, `topIds`, `nameById`, `monthLabels`, `range`, `legendSelected`, the heatmap `order`/`mode`). Every builder gets a `src/charts/fixtures/<name>.fixture.ts` for `conformance.test.ts`. The heatmap's three modes are three data transforms over one option shape (`rowNormalize`, `vsAverage`, `sequentialVisualMap`, `divergingVisualMap` from `charts/scales.ts`); the page passes the visible row order so the hover → bar-segment mapping stays positional and correct when dormant rows are hidden. `budgetStepSeries` is replaced by `referenceLine(name, data, { step: 'end', id })`; `budgetChartOptions.ts` stays in place unused (C7 retires). Dark options are byte-identical except where a spec section is cited (§8 grids/`monthAxis`, §9 focus + legend, §13 whole-percent axis, F1, F7, F8, F13).

**Tech Stack:** React 19, TypeScript 5.9, vitest 3 + @testing-library/react (jsdom; `EChart` mocked as today), ECharts 6.1 via `src/charts/echarts.ts`.

**Worktree / commands:** Branch `charts-c3` from `main` AFTER C1 merges (`git worktree add .worktrees/charts-c3 -b charts-c3 main`); `cmd //c "mklink /J node_modules ..\\..\\node_modules"` once. `npx vitest run <file>`, `npx tsc -b`, `npx eslint <files>` from the worktree root. Local commits only. Read `src/charts/grammar.ts`, `tooltip.ts`, `legend.ts`, `reference.ts`, `scales.ts`, `markLine.ts` (`zeroLine`), `sankey.ts` (`sankeyCsv`), `src/components/ChartCard.tsx`, `src/charts/fixtures/_types.ts`, `src/testing/tooltipRows.ts` first.

**Done when:** no `<EChart` outside `ChartCard` in `SpendingPage.tsx`; conformance green with this lane's fixtures; `npx tsc -b`, `npx eslint`, full `npx vitest run` pass.

---

## File structure

| File | Responsibility |
|---|---|
| `src/components/spending/spendingChartOptions.ts` (modify) | + `SUSTAINABLE_SPEND`, `spendingBarsOption`, `monthPieOption`, `monthPieCsv`, `heatmapRows`, `heatmapCells`, `heatmapOption`, `heatmapCsv`, `savingsRateOption`, `savingsRateCsv`, `categoryTrendOption`, `categoryTrendCsv`, (droppable) `categorySmallMultiplesOption`; `spendingBarsTooltipFormatter` left in place unused |
| `src/components/spending/spendingChartOptions.test.ts` (modify) | Pins for every new builder; tooltip order via `tooltipRows` |
| `src/charts/fixtures/spendingBars.fixture.ts`, `spendingMonthPie.fixture.ts`, `spendingHeatmapRow.fixture.ts`, `spendingHeatmapVsAverage.fixture.ts`, `spendingSavings.fixture.ts`, `spendingTrends.fixture.ts`, `spendingSankey.fixture.ts` (+ `spendingSmallMultiples.fixture.ts` if Task 6 lands) (new) | Conformance fixtures |
| `src/components/spending/spendingSankeyOptions.ts` (modify) | + `spendingSankeyCsv(period)` via `sankeyCsv` |
| `src/pages/SpendingPage.tsx` (modify) | Six `ChartCard`s; heatmap controls + dormant toggle; `group="spending"` on bars/savings/trends; no inline options |
| `src/pages/SpendingPage.test.tsx` (modify) | Mock samples the grammar tooltip formatter instead of `valueFormatter`; legend names follow F13 |
| `src/pages/SpendingPage.css` | Untouched; `.spending-chart-header` becomes unused (C7) |

---

### Task 1: `spendingBarsOption` — the stacked bars lifted out of the page

**Files:**
- Modify: `src/components/spending/spendingChartOptions.ts`, `src/components/spending/spendingChartOptions.test.ts`
- Create: `src/charts/fixtures/spendingBars.fixture.ts`

Source: `SpendingPage.tsx:220-319` (`barsOption`). Named changes: F13 (`4% rule` → `Sustainable spend`), F7 (`axisTooltip` with shares, Total, references after it, `shadow` pointer, `absentText`), §9 (`BAR_MARKS` focus, `legendFor`), §11 (`stagger`), §8 (`grid()`, `monthAxis` labels every month at ≤ 12). Budget lines come from `budgetReference` (byte-equal to `budgetStepSeries`).

- [ ] **Step 1: Write the failing test**

Append to `src/components/spending/spendingChartOptions.test.ts`:

```ts
import { tooltipRows } from '../../testing/tooltipRows'
import { GRID_VARIANTS, compactMoney } from '../../charts/grammar'
import { INK, MUTED, OTHER_SERIES_COLOR, PALETTE, SURFACE } from '../../charts/theme'
import type { SpendingMatrix } from '../../types/api'
import { SUSTAINABLE_SPEND, spendingBarsOption } from './spendingChartOptions'

export function matrixFixture(over: Partial<SpendingMatrix> = {}): SpendingMatrix {
  return {
    months: ['2026-06-01', '2026-07-01'],
    categories: [
      { id: 1, name: 'Rent', slug: 'rent', sort_order: 0, is_active: true },
      { id: 2, name: 'Groceries <b>& more</b>', slug: 'groceries', sort_order: 1, is_active: true },
      { id: 3, name: 'Fun', slug: 'fun', sort_order: 2, is_active: true },
    ],
    series: [
      { category_id: 1, values: ['2000.00', '2000.00'], budgets: [null, null] },
      { category_id: 2, values: ['600.00', null], budgets: ['500.00', '500.00'] },
      { category_id: 3, values: ['150.00', null], budgets: [null, null] },
    ],
    totals: ['2750.00', '2000.00'],
    net_pay: ['6000.00', '6000.00'],
    savings_rate: ['0.541666667', null],
    four_pct_rule: ['4100.50', '4100.50'],
    total_budget: ['500.00', '500.00'],
    ...over,
  }
}

const NAMES = new Map([[1, 'Rent'], [2, 'Groceries <b>& more</b>'], [3, 'Fun']])
const LABELS = ['Jun 2026', 'Jul 2026']
const barsInput = (matrix = matrixFixture(), selected = {}) => ({
  matrix, topIds: [1, 2], nameById: NAMES, monthLabels: LABELS, range: { preset: 'all' as const }, selected,
})

interface SeriesLike {
  id?: string
  name?: string
  type?: string
  stack?: string
  color?: string
  z?: number
  step?: string
  barMaxWidth?: number
  itemStyle?: unknown
  emphasis?: unknown
  lineStyle?: { type?: string }
  animationDelay?: () => number
  data?: unknown[]
}
const read = (option: unknown) =>
  option as {
    grid: unknown
    legend: { type: string; selected: Record<string, boolean> }
    xAxis: { data: string[]; boundaryGap?: boolean; axisLabel?: unknown }
    yAxis: { axisLabel: { formatter: unknown } }
    tooltip: { formatter: (p: unknown) => string; axisPointer?: { type: string } }
    series: SeriesLike[]
  }

describe('spendingBarsOption', () => {
  it('lifts the page option: slotted category stacks + Other, the INK net-pay line, the dashed sustainable-spend reference, the budget step LAST', () => {
    const option = read(spendingBarsOption(barsInput()))
    expect(option.series.map((s) => s.id)).toEqual(['cat-1', 'cat-2', 'other', 'net-pay', 'sustainable-spend', 'budget-Total budget'])
    expect(option.series.map((s) => s.name)).toEqual(['Rent', 'Groceries <b>& more</b>', 'Other', 'Net pay', SUSTAINABLE_SPEND, 'Total budget'])
    expect(SUSTAINABLE_SPEND).toBe('Sustainable spend')
    expect(option.series[0]).toMatchObject({ type: 'bar', stack: 'spend', barMaxWidth: 22, color: PALETTE[0], universalTransition: true })
    expect(option.series[0].itemStyle).toEqual({ borderColor: SURFACE, borderWidth: 1 })
    expect(option.series[0].emphasis).toEqual({ focus: 'series', itemStyle: { borderColor: INK } })
    expect(option.series[2].color).toBe(OTHER_SERIES_COLOR)
    // §11 stagger: a FUNCTION delay per stack member, 12ms apart.
    expect(option.series[0].animationDelay?.()).toBe(0)
    expect(option.series[2].animationDelay?.()).toBe(24)
    expect(option.series[3]).toMatchObject({ type: 'line', color: INK, z: 10, connectNulls: false })
    expect(option.series[4]).toMatchObject({ type: 'line', color: MUTED, z: 9, lineStyle: { width: 2, type: 'dashed' } })
    expect(option.series[5]).toMatchObject({ step: 'end', color: MUTED, lineStyle: { width: 2, type: 'dashed' } })
    expect(option.series[5].data).toEqual([500, 500])
  })

  it('A6 stays: nulls pass through the stacks and Other is null when nothing folded that month', () => {
    const [rent, groceries, other] = read(spendingBarsOption(barsInput())).series
    expect(rent.data).toEqual([2000, 2000])
    expect(groceries.data).toEqual([600, null])
    expect(other.data).toEqual([150, null])
  })

  it('omits the budget step when no month has a total budget', () => {
    const option = read(spendingBarsOption(barsInput(matrixFixture({ total_budget: [null, null] }))))
    expect(option.series.map((s) => s.id)).not.toContain('budget-Total budget')
  })

  it('grid, axes, legend: money grid, every month labelled, compact money ticks, Total budget deselected under the page picks', () => {
    const option = read(spendingBarsOption(barsInput(matrixFixture(), { 'Net pay': false })))
    expect(option.grid).toEqual(GRID_VARIANTS.default)
    expect(option.xAxis).toEqual({ type: 'category', data: LABELS, axisLabel: { interval: 0 } })
    expect(option.yAxis.axisLabel.formatter).toBe(compactMoney)
    expect(option.legend.type).toBe('plain')
    expect(option.legend.selected).toEqual({ 'Total budget': false, 'Net pay': false })
  })

  it('F7: shares per category, a Total, then the net-pay row, then the muted references; absent months say so', () => {
    const option = read(spendingBarsOption(barsInput()))
    expect(option.tooltip.axisPointer).toEqual({ type: 'shadow' })
    const parsed = tooltipRows(option.tooltip.formatter([
      { seriesName: 'Groceries <b>& more</b>', seriesType: 'bar', axisValueLabel: 'Jun 2026', dataIndex: 0, value: 600, color: PALETTE[1] },
      { seriesName: 'Rent', seriesType: 'bar', value: 2000, color: PALETTE[0] },
      { seriesName: 'Other', seriesType: 'bar', value: 150, color: OTHER_SERIES_COLOR },
      { seriesName: 'Net pay', seriesType: 'line', value: 6000, color: INK },
      { seriesName: SUSTAINABLE_SPEND, seriesType: 'line', value: 4100.5, color: MUTED },
      { seriesName: 'Total budget', seriesType: 'line', value: 500, color: MUTED },
    ]))
    expect(parsed.rows.map((r) => [r.kind, r.label, r.value])).toEqual([
      ['row', 'Rent', '$2,000.00 (72.7%)'],
      ['row', 'Groceries &lt;b&gt;&amp; more&lt;/b&gt;', '$600.00 (21.8%)'],
      ['row', 'Other', '$150.00 (5.5%)'],
      ['total', 'Total', '$2,750.00'],
      ['row', 'Net pay', '$6,000.00'],
      ['ref', SUSTAINABLE_SPEND, '$4,100.50'],
      ['ref', 'Total budget', '$500.00'],
    ])
    const absent = tooltipRows(option.tooltip.formatter([
      { seriesName: 'Rent', seriesType: 'bar', axisValueLabel: 'Aug 2026', value: null },
      { seriesName: 'Net pay', seriesType: 'line', value: 6000, color: INK },
    ]))
    expect(absent.notes).toEqual(['no spending entered'])
    expect(absent.rows.map((r) => r.label)).toEqual(['Net pay'])
  })

  it('returns null with no months', () => {
    expect(spendingBarsOption(barsInput(matrixFixture({ months: [], totals: [], net_pay: [], four_pct_rule: [], total_budget: [], savings_rate: [] })))).toBeNull()
  })
})
```

Run: `npx vitest run src/components/spending/spendingChartOptions.test.ts`
Expected: FAIL — `spendingBarsOption` not exported.

- [ ] **Step 2: Write the builder**

Add to `src/components/spending/spendingChartOptions.ts` (imports at top; existing exports stay):

```ts
import type { EChartsOption } from '../../charts/echarts'
import { BAR_MARKS, LINE, grid, moneyAxis, monthAxis, stagger } from '../../charts/grammar'
import { legendFor } from '../../charts/legend'
import { budgetReference, referenceLine } from '../../charts/reference'
import { INK, OTHER_SERIES_COLOR, PALETTE } from '../../charts/theme'
import { rangeZoom } from '../../charts/timeZoom'
import type { RangeState } from '../../charts/timeZoom'
import { axisTooltip } from '../../charts/tooltip'

/** F13: the "4% rule" line renamed — it is what the investable assets could fund each month
 *  at the safe withdrawal rate (Settings), and "4%" was a number the setting can change. */
export const SUSTAINABLE_SPEND = 'Sustainable spend'

export interface SpendingBarsInput {
  matrix: SpendingMatrix
  /** All-time-total order — index IS the palette slot AND the bar seriesIndex. */
  topIds: number[]
  nameById: Map<number, string>
  monthLabels: string[]
  range: RangeState
  selected: Record<string, boolean>
}

/**
 * Top-N category stacks + Other under the INK net-pay line, the dashed sustainable-spend
 * reference and (when any month has one) the total-budget step. Lifted from SpendingPage's
 * `barsOption`; the series ORDER is load-bearing — the heatmap hover highlights bar segments
 * by positional seriesIndex, so nothing may be inserted ahead of the budget step.
 */
export function spendingBarsOption({
  matrix, topIds, nameById, monthLabels, range, selected,
}: SpendingBarsInput): EChartsOption | null {
  if (matrix.months.length === 0) return null
  const topSet = new Set(topIds)
  const valuesById = new Map(matrix.series.map((s) => [s.category_id, s.values]))
  // A6: absent ≠ zero. Nulls flow THROUGH to the series so an unentered month gaps the bar;
  // Other sums the folded rows' non-null values and is itself null when none exist.
  const otherPerMonth = matrix.months.map((_, i) =>
    matrix.series.reduce<number | null>((acc, s) => {
      if (topSet.has(s.category_id)) return acc
      const v = s.values[i]
      return v === null ? acc : (acc ?? 0) + Number(v)
    }, null),
  )
  const name = (id: number) => nameById.get(id) ?? String(id)
  const categoryNames = [...topIds.map(name), 'Other']
  const hasBudget = matrix.total_budget.some((v) => v !== null)
  const series = [
    // Stable ids: the drill-in pie morphs from/to these (universalTransition keys on id).
    ...topIds.map((id, slot) => ({
      id: `cat-${id}`,
      name: name(id),
      type: 'bar' as const,
      stack: 'spend',
      ...BAR_MARKS,
      ...stagger(slot),
      color: PALETTE[slot],
      universalTransition: true,
      data: (valuesById.get(id) ?? []).map((v) => (v === null ? null : Number(v))),
    })),
    {
      id: 'other',
      name: 'Other',
      type: 'bar' as const,
      stack: 'spend',
      ...BAR_MARKS,
      ...stagger(topIds.length),
      color: OTHER_SERIES_COLOR,
      universalTransition: true,
      data: otherPerMonth,
    },
    {
      ...LINE,
      id: 'net-pay',
      name: 'Net pay',
      color: INK,
      z: 10,
      connectNulls: false,
      data: matrix.net_pay.map((v) => (v === null ? null : Number(v))),
    },
    referenceLine(
      SUSTAINABLE_SPEND,
      matrix.four_pct_rule.map((v) => (v === null ? null : Number(v))),
      { id: 'sustainable-spend' },
    ),
    // LAST on purpose (the positional highlight — see above).
    ...(hasBudget ? [budgetReference('Total budget', matrix.total_budget)] : []),
  ]
  return {
    dataZoom: rangeZoom(matrix.months, range),
    grid: grid(),
    // 'Total budget' ships DESELECTED: it wears the same dashed grammar as the sustainable
    // line, so both on at once would be ambiguous; the legend chip is the summon. Mirrored
    // picks spread OVER the default so a deliberate summon survives rebuilds.
    legend: legendFor(series.length, { 'Total budget': false, ...selected }),
    tooltip: axisTooltip({
      unit: 'money',
      groups: categoryNames,
      shareOf: true,
      references: [SUSTAINABLE_SPEND, 'Total budget'],
      absentText: 'no spending entered',
      pointer: 'shadow',
    }),
    xAxis: monthAxis(monthLabels, { gap: true }),
    yAxis: moneyAxis(),
    series,
  }
}
```

- [ ] **Step 3: Add the fixture**

```ts
// src/charts/fixtures/spendingBars.fixture.ts
import type { ChartFixture } from './_types'
import { spendingBarsOption } from '../../components/spending/spendingChartOptions'
import type { SpendingMatrix } from '../../types/api'

export const MATRIX: SpendingMatrix = {
  months: ['2026-06-01', '2026-07-01', '2026-08-01'],
  categories: [
    { id: 1, name: 'Rent', slug: 'rent', sort_order: 0, is_active: true },
    { id: 2, name: 'Groceries', slug: 'groceries', sort_order: 1, is_active: true },
    { id: 3, name: 'Fun', slug: 'fun', sort_order: 2, is_active: true },
  ],
  series: [
    { category_id: 1, values: ['2000.00', '2000.00', '2000.00'], budgets: [null, null, null] },
    { category_id: 2, values: ['600.00', '580.00', '610.00'], budgets: ['500.00', '500.00', '500.00'] },
    { category_id: 3, values: ['150.00', '0.00', '90.00'], budgets: [null, null, null] },
  ],
  totals: ['2750.00', '2580.00', '2700.00'],
  net_pay: ['6000.00', '6000.00', '6100.00'],
  savings_rate: ['0.541666667', '0.57', '0.557377'],
  four_pct_rule: ['4100.50', '4100.50', '4200.00'],
  total_budget: ['500.00', '500.00', '500.00'],
}
export const NAMES = new Map(MATRIX.categories.map((c) => [c.id, c.name]))
export const LABELS = ['Jun 2026', 'Jul 2026', 'Aug 2026']

const fixture: ChartFixture = {
  name: 'spendingBars',
  kind: 'cartesian',
  ariaLabel: 'Stacked bar chart of monthly spending by category under the net-pay line',
  build: () =>
    spendingBarsOption({
      matrix: MATRIX, topIds: [1, 2], nameById: NAMES, monthLabels: LABELS,
      range: { preset: 'all' }, selected: {},
    }),
}
export default fixture
```

Run: `npx vitest run src/components/spending/spendingChartOptions.test.ts src/charts/conformance.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/spending/spendingChartOptions.ts src/components/spending/spendingChartOptions.test.ts src/charts/fixtures/spendingBars.fixture.ts
git commit -m "feat(spending): spendingBarsOption lifted onto the grammar — Sustainable spend, grammar tooltip with shares, stagger, focus (F13, F7, §8, §9, §11)"
```

---

### Task 2: `monthPieOption` + `monthPieCsv`

**Files:**
- Modify: `src/components/spending/spendingChartOptions.ts`, `src/components/spending/spendingChartOptions.test.ts`
- Create: `src/charts/fixtures/spendingMonthPie.fixture.ts`

Source: `SpendingPage.tsx:327-365` (`monthDetailOption`). Named changes: F7 (`itemTooltip`: value first, the escaped name, "xx.x% of the month"), F12 (CSV). The pie's `universalTransition.seriesKey` still targets the bars' `cat-${id}` / `other` ids, so the drill morph keeps working.

- [ ] **Step 1: Write the failing test**

```ts
import { monthPieCsv, monthPieOption } from './spendingChartOptions'
import { isGrammarTooltip } from '../../charts/tooltip'

describe('monthPieOption', () => {
  it('slices the month on the bars’ own slots, morphing from their ids, with a value-first item tooltip', () => {
    const option = monthPieOption(matrixFixture(), [1, 2], 0) as unknown as {
      tooltip: { trigger: string; formatter: (p: unknown) => string }
      series: { id: string; type: string; universalTransition: unknown; data: { name: string; value: number; itemStyle: { color: string } }[] }[]
    }
    expect(option.series[0]).toMatchObject({ id: 'month-pie', type: 'pie', universalTransition: { enabled: true, seriesKey: ['cat-1', 'cat-2', 'other'] } })
    expect(option.series[0].data).toEqual([
      { name: 'Rent', value: 2000, itemStyle: { color: PALETTE[0] } },
      { name: 'Groceries <b>& more</b>', value: 600, itemStyle: { color: PALETTE[1] } },
      { name: 'Other', value: 150, itemStyle: { color: OTHER_SERIES_COLOR } },
    ])
    expect(option.tooltip.trigger).toBe('item')
    expect(isGrammarTooltip(option.tooltip.formatter)).toBe(true)
    const parsed = tooltipRows(option.tooltip.formatter({ name: 'Groceries <b>& more</b>', value: 600, percent: 21.8 }))
    expect(parsed.lead).toBe('$600.00')
    expect(parsed.label).toBe('Groceries &lt;b&gt;&amp; more&lt;/b&gt;')
    expect(parsed.sub).toBe('21.8% of the month')
  })
  it('is null for a month with nothing drawable or out of range', () => {
    expect(monthPieOption(matrixFixture(), [1, 2], -1)).toBeNull()
    expect(monthPieOption(matrixFixture({ series: [{ category_id: 1, values: ['0.00', '0.00'], budgets: [null, null] }] }), [1], 0)).toBeNull()
  })
  it('exports the slices as a table', () => {
    expect(monthPieCsv(matrixFixture(), [1, 2], 0)).toEqual({
      headers: ['Category', 'Amount'],
      rows: [['Rent', '2000.00'], ['Groceries <b>& more</b>', '600.00'], ['Other', '150.00']],
    })
  })
})
```

Run: `npx vitest run src/components/spending/spendingChartOptions.test.ts`
Expected: FAIL — exports missing.

- [ ] **Step 2: Write the builder and CSV**

```ts
import { INK, SURFACE } from '../../charts/theme'
import { itemTooltip } from '../../charts/tooltip'
import { buildMonthSlices } from '../../utils/spending'

/** One month's breakdown as the bars' drill-in: the SAME top-N fold and slots as the stack,
 *  morphing from the bar segments by id. Null when the month has nothing positive to draw. */
export function monthPieOption(
  matrix: Pick<SpendingMatrix, 'categories' | 'series'>,
  topIds: number[],
  monthIndex: number,
): EChartsOption | null {
  if (monthIndex < 0) return null
  const slices = buildMonthSlices(matrix, topIds, monthIndex)
  if (slices.length === 0) return null
  return {
    tooltip: itemTooltip<{ name?: string; value?: unknown; percent?: number }>({
      body: (p) => ({
        value: Number(p.value),
        label: p.name ?? '',
        sub: `${(p.percent ?? 0).toFixed(1)}% of the month`,
      }),
    }),
    series: [
      {
        id: 'month-pie',
        type: 'pie' as const,
        radius: ['42%', '70%'],
        itemStyle: { borderColor: SURFACE, borderWidth: 2 },
        label: { color: INK, formatter: '{b}  {d}%' },
        emphasis: { itemStyle: { borderColor: INK } },
        // Morph the month's bar segments into slices and back out on exit; a plain swap
        // under reduced motion (EChart forces animation off).
        universalTransition: { enabled: true, seriesKey: [...topIds.map((id) => `cat-${id}`), 'other'] },
        data: slices.map((s) => ({
          name: s.name,
          value: s.value,
          itemStyle: { color: s.slot === null ? OTHER_SERIES_COLOR : PALETTE[s.slot] },
        })),
      },
    ],
  }
}

/** The drilled month as a table (F12): the drawn slices, Other included. */
export function monthPieCsv(
  matrix: Pick<SpendingMatrix, 'categories' | 'series'>,
  topIds: number[],
  monthIndex: number,
): ExportTable {
  return {
    headers: ['Category', 'Amount'],
    rows: buildMonthSlices(matrix, topIds, monthIndex).map((s) => [s.name, s.value.toFixed(2)]),
  }
}
```

- [ ] **Step 3: Add the fixture**

```ts
// src/charts/fixtures/spendingMonthPie.fixture.ts
import type { ChartFixture } from './_types'
import { monthPieOption } from '../../components/spending/spendingChartOptions'
import { MATRIX } from './spendingBars.fixture'

const fixture: ChartFixture = {
  name: 'spendingMonthPie',
  kind: 'pie',
  ariaLabel: 'Donut chart of one month’s spending by category',
  exempt: ['grid', 'axis'],
  build: () => monthPieOption(MATRIX, [1, 2], 0),
}
export default fixture
```

Run: `npx vitest run src/components/spending/spendingChartOptions.test.ts src/charts/conformance.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/spending/spendingChartOptions.ts src/components/spending/spendingChartOptions.test.ts src/charts/fixtures/spendingMonthPie.fixture.ts
git commit -m "feat(spending): monthPieOption lifted onto the grammar with an item tooltip and CSV (F7, F12)"
```

---

### Task 3: The heatmap with modes and dormant rows (F1)

**Files:**
- Modify: `src/components/spending/spendingChartOptions.ts`, `src/components/spending/spendingChartOptions.test.ts`
- Create: `src/charts/fixtures/spendingHeatmapRow.fixture.ts`, `src/charts/fixtures/spendingHeatmapVsAverage.fixture.ts`

Source: `SpendingPage.tsx:424-485` (`heatmapOption`). F1: modes `Absolute · Row · vs average` (default Row), a labelled scale legend per mode, all-zero rows hidden behind "Show N dormant". The page keeps owning the row ORDER (all-time totals) and passes the VISIBLE order, so the hover → bar-segment mapping stays positional and correct when dormant rows are hidden. F7 (`itemTooltip`), F12 (the FULL matrix as CSV, addendum S7). `grid('heatmap')` is the same `{130,24,8,96}`.

- [ ] **Step 1: Write the failing tests**

```ts
import { HEATMAP_MODES, heatmapCsv, heatmapOption, heatmapRows } from './spendingChartOptions'
import { DIVERGING, SEQUENTIAL_BLUE } from '../../charts/theme'
import { GRID_VARIANTS } from '../../charts/grammar'

// Eight months so the vs-average mode has six priors to lean on; Fun is dormant.
function longMatrix(): SpendingMatrix {
  const months = Array.from({ length: 8 }, (_, i) => `2026-0${i + 1}-01`)
  return matrixFixture({
    months,
    series: [
      { category_id: 1, values: ['100.00', '100.00', '100.00', '100.00', '100.00', '100.00', '150.00', null], budgets: months.map(() => null) },
      { category_id: 2, values: months.map(() => '50.00'), budgets: months.map(() => null) },
      { category_id: 3, values: months.map((_, i) => (i === 3 ? null : '0.00')), budgets: months.map(() => null) },
    ],
    totals: months.map(() => '150.00'), net_pay: months.map(() => '6000.00'), savings_rate: months.map(() => null),
    four_pct_rule: months.map(() => null), total_budget: months.map(() => null),
  })
}
const LONG_LABELS = Array.from({ length: 8 }, (_, i) => `M${i + 1}`)
const readHeat = (option: unknown) =>
  option as {
    grid: unknown
    xAxis: { data: string[]; axisLabel: { rotate: number } }
    yAxis: { data: string[]; inverse: boolean }
    visualMap: { min: number; max: number; type?: string; inRange: { color: string[] }; text?: string[]; formatter: (v: number) => string }
    tooltip: { formatter: (p: unknown) => string }
    series: { type: string; data: [number, number, number][] }[]
  }

describe('heatmapRows', () => {
  it('splits the order into visible and dormant rows (every value null or zero)', () => {
    expect(heatmapRows(longMatrix(), [1, 2, 3], false)).toEqual({ visible: [1, 2], dormant: [3] })
    expect(heatmapRows(longMatrix(), [1, 2, 3], true)).toEqual({ visible: [1, 2, 3], dormant: [3] })
  })
})

describe('heatmapOption', () => {
  it('Absolute: raw dollars on the shared blue scale — the pre-F1 chart', () => {
    const option = readHeat(heatmapOption({ matrix: longMatrix(), order: [1, 2], nameById: NAMES, monthLabels: LONG_LABELS, mode: 'absolute' }))
    expect(option.grid).toEqual(GRID_VARIANTS.heatmap)
    expect(option.xAxis.axisLabel.rotate).toBe(45)
    expect(option.yAxis).toMatchObject({ data: ['Rent', 'Groceries <b>& more</b>'], inverse: true })
    expect(option.visualMap).toMatchObject({ min: 0, max: 150, inRange: { color: [...SEQUENTIAL_BLUE] } })
    expect(option.visualMap.formatter(1500)).toBe('$1.5K')
    expect(option.series[0].data).toContainEqual([6, 0, 150])
    expect(option.series[0].data.some(([c, r]) => c === 7 && r === 0)).toBe(false) // null cell → no cell
  })
  it('Row: each row on its own 0 → max scale, legend labelled row max / 0', () => {
    const option = readHeat(heatmapOption({ matrix: longMatrix(), order: [1, 2], nameById: NAMES, monthLabels: LONG_LABELS, mode: 'row' }))
    expect(option.visualMap).toMatchObject({ min: 0, max: 1, text: ['row max', '0'] })
    expect(option.visualMap.formatter(0.5)).toBe('50%')
    expect(option.series[0].data).toContainEqual([6, 0, 1])
    expect(option.series[0].data).toContainEqual([0, 0, 100 / 150])
    expect(option.series[0].data).toContainEqual([0, 1, 1]) // a flat row is all max
  })
  it('vs average: ratio to the trailing mean on the diverging scale, orange above, blank until six priors', () => {
    const option = readHeat(heatmapOption({ matrix: longMatrix(), order: [1, 2], nameById: NAMES, monthLabels: LONG_LABELS, mode: 'vsAverage' }))
    expect(option.visualMap).toMatchObject({ type: 'continuous', min: -0.5, max: 0.5, text: ['above average', 'below average'] })
    expect(option.visualMap.inRange.color).toEqual([...DIVERGING].reverse())
    expect(option.visualMap.formatter(0.25)).toBe('+25%')
    expect(option.series[0].data).toEqual([[6, 0, 0.5], [6, 1, 0], [7, 1, 0]]) // months 0–5 blank, month 7 of Rent null
  })
  it('F7: value first, category · month, and the mode’s reading as the sub-line', () => {
    const input = { matrix: longMatrix(), order: [1, 2], nameById: NAMES, monthLabels: LONG_LABELS }
    const abs = tooltipRows(readHeat(heatmapOption({ ...input, mode: 'absolute' })).tooltip.formatter({ value: [6, 0, 150] }))
    expect([abs.lead, abs.label, abs.sub]).toEqual(['$150.00', 'Rent · M7', undefined])
    const row = tooltipRows(readHeat(heatmapOption({ ...input, mode: 'row' })).tooltip.formatter({ value: [0, 1, 1] }))
    expect([row.lead, row.label, row.sub]).toEqual(['$50.00', 'Groceries &lt;b&gt;&amp; more&lt;/b&gt; · M1', '100% of this category’s busiest month'])
    const vs = tooltipRows(readHeat(heatmapOption({ ...input, mode: 'vsAverage' })).tooltip.formatter({ value: [6, 0, 0.5] }))
    expect([vs.lead, vs.sub]).toEqual(['$150.00', '+50% vs its trailing 12-month average'])
  })
  it('is null with no months or no visible rows; HEATMAP_MODES lists the three controls', () => {
    expect(heatmapOption({ matrix: matrixFixture({ months: [] }), order: [1], nameById: NAMES, monthLabels: [], mode: 'row' })).toBeNull()
    expect(heatmapOption({ matrix: longMatrix(), order: [], nameById: NAMES, monthLabels: LONG_LABELS, mode: 'row' })).toBeNull()
    expect(HEATMAP_MODES.map((m) => m.label)).toEqual(['Absolute', 'Row', 'vs average'])
  })
})

describe('heatmapCsv', () => {
  it('exports the FULL matrix in row order — dormant rows included, blanks for absent months', () => {
    const csv = heatmapCsv(longMatrix(), [1, 2, 3], NAMES)
    expect(csv.headers).toEqual(['Category', ...longMatrix().months])
    expect(csv.rows[0]).toEqual(['Rent', '100.00', '100.00', '100.00', '100.00', '100.00', '100.00', '150.00', ''])
    expect(csv.rows[2][0]).toBe('Fun')
  })
})
```

Run: `npx vitest run src/components/spending/spendingChartOptions.test.ts`
Expected: FAIL — exports missing.

- [ ] **Step 2: Write the builders**

```ts
import { compactMoney, grid, monthAxis } from '../../charts/grammar'
import { divergingVisualMap, rowNormalize, sequentialVisualMap, vsAverage } from '../../charts/scales'
import { INK, SURFACE } from '../../charts/theme'
import { formatPct } from '../../utils/format'

export type HeatmapMode = 'absolute' | 'row' | 'vsAverage'
export const HEATMAP_MODES: { value: HeatmapMode; label: string }[] = [
  { value: 'absolute', label: 'Absolute' },
  { value: 'row', label: 'Row' },
  { value: 'vsAverage', label: 'vs average' },
]

const isDormant = (values: (string | null)[]) => values.every((v) => v === null || Number(v) === 0)

/** The rows to draw, in the page's order: dormant categories (never a cent in any month) sit
 *  behind the card's "Show N dormant" toggle so the matrix is as tall as the spending is. */
export function heatmapRows(matrix: Pick<SpendingMatrix, 'series'>, order: number[], showDormant: boolean): { visible: number[]; dormant: number[] } {
  const byId = new Map(matrix.series.map((s) => [s.category_id, s.values]))
  const dormant = order.filter((id) => isDormant(byId.get(id) ?? []))
  const dormantSet = new Set(dormant)
  return { visible: showDormant ? order : order.filter((id) => !dormantSet.has(id)), dormant }
}

/** rows[r][c] for the given row order — Number() once, nulls kept (absent ≠ zero). */
function heatmapMatrix(matrix: Pick<SpendingMatrix, 'months' | 'series'>, order: number[]): (number | null)[][] {
  const byId = new Map(matrix.series.map((s) => [s.category_id, s.values]))
  return order.map((id) => matrix.months.map((_, c) => { const v = byId.get(id)?.[c]; return v === null || v === undefined ? null : Number(v) }))
}

export interface HeatmapInput {
  matrix: SpendingMatrix
  /** The VISIBLE rows (heatmapRows().visible) — row index r maps back to order[r]. */
  order: number[]
  nameById: Map<number, string>
  monthLabels: string[]
  mode: HeatmapMode
}

/**
 * Month × category, one of three readings of the same cells (F1). Absolute: one shared dollar
 * scale. Row (default): each category against its own busiest month. vs average: each cell
 * against its trailing 12-month mean, orange above / blue below, blank until six prior months
 * exist. Hover keeps the RAW dollars in the lead; the mode's reading is the sub-line.
 */
export function heatmapOption({ matrix, order, nameById, monthLabels, mode }: HeatmapInput): EChartsOption | null {
  if (matrix.months.length === 0 || order.length === 0) return null
  const raw = heatmapMatrix(matrix, order)
  const values = mode === 'absolute' ? raw : mode === 'row' ? rowNormalize(raw) : vsAverage(raw)
  const cells: [number, number, number][] = []
  values.forEach((row, r) => row.forEach((v, c) => { if (v !== null) cells.push([c, r, v]) }))
  const rawMax = raw.reduce((m, row) => row.reduce<number>((mm, v) => (v === null ? mm : Math.max(mm, v)), m), 0)
  const maxAbs = cells.reduce((m, [, , v]) => Math.max(m, Math.abs(v)), 0)
  const visualMap =
    mode === 'absolute'
      ? sequentialVisualMap({ min: 0, max: Math.max(rawMax, 1), formatter: compactMoney })
      : mode === 'row'
        ? sequentialVisualMap({ min: 0, max: 1, formatter: (v) => `${Math.round(v * 100)}%`, labels: ['row max', '0'] })
        : divergingVisualMap({
            // Clamped between ±10% and ±100%: a quiet history must not paint noise as extremes.
            span: Math.min(1, Math.max(0.1, maxAbs)),
            formatter: (v) => formatPct(v, { decimals: 0 }),
            labels: ['above average', 'below average'],
            highArm: 'orange',
          })
  const name = (r: number) => nameById.get(order[r]) ?? String(order[r])
  return {
    grid: grid('heatmap'),
    tooltip: itemTooltip<{ value?: unknown }>({
      body: (p) => {
        const [c, r, v] = (p.value ?? []) as [number, number, number]
        const dollars = raw[r]?.[c]
        if (dollars === null || dollars === undefined) return null
        const label = `${name(r)} · ${monthLabels[c] ?? ''}`
        if (mode === 'absolute') return { value: dollars, label }
        if (mode === 'row') return { value: dollars, label, sub: `${Math.round(v * 100)}% of this category’s busiest month` }
        return { value: dollars, label, sub: `${formatPct(v, { decimals: 0 })} vs its trailing 12-month average` }
      },
    }),
    xAxis: monthAxis(monthLabels, { gap: true, rotate: 45 }),
    yAxis: { type: 'category', data: order.map((_, r) => name(r)), inverse: true, axisLabel: { width: 118, overflow: 'truncate' as const } },
    visualMap,
    series: [{ type: 'heatmap' as const, data: cells, itemStyle: { borderColor: SURFACE, borderWidth: 1 }, emphasis: { itemStyle: { borderColor: INK, borderWidth: 1 } } }],
  }
}

/** The whole matrix (F12, addendum S7): every category in order × every month, verbatim. */
export function heatmapCsv(matrix: Pick<SpendingMatrix, 'months' | 'series'>, order: number[], nameById: Map<number, string>): ExportTable {
  const byId = new Map(matrix.series.map((s) => [s.category_id, s.values]))
  return {
    headers: ['Category', ...matrix.months],
    rows: order.map((id) => [nameById.get(id) ?? String(id), ...matrix.months.map((_, c) => byId.get(id)?.[c] ?? '')]),
  }
}
```

- [ ] **Step 3: Add the fixtures**

```ts
// src/charts/fixtures/spendingHeatmapRow.fixture.ts
import type { ChartFixture } from './_types'
import { heatmapOption } from '../../components/spending/spendingChartOptions'
import { LABELS, MATRIX, NAMES } from './spendingBars.fixture'

const fixture: ChartFixture = {
  name: 'spendingHeatmapRow',
  kind: 'heatmap',
  ariaLabel: 'Heatmap of spend per category per month, each category on its own scale',
  exempt: ['axis'],
  build: () => heatmapOption({ matrix: MATRIX, order: [1, 2, 3], nameById: NAMES, monthLabels: LABELS, mode: 'row' }),
}
export default fixture
```

```ts
// src/charts/fixtures/spendingHeatmapVsAverage.fixture.ts
import type { ChartFixture } from './_types'
import { heatmapOption } from '../../components/spending/spendingChartOptions'
import { MATRIX, NAMES } from './spendingBars.fixture'

const months = Array.from({ length: 8 }, (_, i) => `2026-0${i + 1}-01`)
const fixture: ChartFixture = {
  name: 'spendingHeatmapVsAverage',
  kind: 'heatmap',
  ariaLabel: 'Heatmap of spend per category per month against each category’s trailing average',
  exempt: ['axis'],
  build: () =>
    heatmapOption({
      matrix: {
        ...MATRIX,
        months,
        series: [
          { category_id: 1, values: ['100.00', '100.00', '100.00', '100.00', '100.00', '100.00', '150.00', '90.00'], budgets: months.map(() => null) },
          { category_id: 2, values: months.map(() => '50.00'), budgets: months.map(() => null) },
        ],
      },
      order: [1, 2], nameById: NAMES, monthLabels: months, mode: 'vsAverage',
    }),
}
export default fixture
```

Run: `npx vitest run src/components/spending/spendingChartOptions.test.ts src/charts/conformance.test.ts src/charts/scales.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/spending/spendingChartOptions.ts src/components/spending/spendingChartOptions.test.ts src/charts/fixtures/spendingHeatmapRow.fixture.ts src/charts/fixtures/spendingHeatmapVsAverage.fixture.ts
git commit -m "feat(spending): heatmap modes Absolute/Row/vs average with labelled scales, dormant rows, item tooltip, full-matrix CSV (F1, F7, F12)"
```

---

### Task 4: Savings rate and category trends

**Files:**
- Modify: `src/components/spending/spendingChartOptions.ts`, `src/components/spending/spendingChartOptions.test.ts`
- Create: `src/charts/fixtures/spendingSavings.fixture.ts`, `src/charts/fixtures/spendingTrends.fixture.ts`

Sources: `SpendingPage.tsx:486-529` (`savingsOption`) and `:531-568` (`trendOption`). Named changes: F8 (savings grid `noLegend` — left 60 → 70 so the trio aligns), §13 (whole-percent axis ticks), F7 (`axisTooltip` percent / money with budget references), §9 (`LINE`, `legendFor(selected)`), F12 (both CSVs). `zeroLine()` is the savings chart's own markLine.

- [ ] **Step 1: Write the failing tests**

```ts
import { GRID_VARIANTS, percentLabel } from '../../charts/grammar'
import { categoryTrendCsv, categoryTrendOption, savingsRateCsv, savingsRateOption } from './spendingChartOptions'

describe('savingsRateOption', () => {
  it('one blue line on the percent axis with the zero baseline, aligned on the no-legend money grid', () => {
    const option = read(savingsRateOption({ matrix: matrixFixture(), monthLabels: LABELS, range: { preset: 'all' } })) as unknown as {
      grid: unknown; yAxis: { min: (e: { min: number }) => number; max: (e: { max: number }) => number; axisLabel: { formatter: unknown } }
      series: { name: string; color: string; markLine: unknown; data: unknown[]; emphasis: unknown }[]; tooltip: { formatter: (p: unknown) => string }
    }
    expect(option.grid).toEqual(GRID_VARIANTS.noLegend) // F8: 60 → 70
    expect(option.yAxis.axisLabel.formatter).toBe(percentLabel)
    expect(option.yAxis.min({ min: -1.8 })).toBe(-2)
    expect(option.yAxis.max({ max: 0.6 })).toBe(0.6)
    expect(option.series[0]).toMatchObject({ name: 'Savings rate (actual)', color: PALETTE[0], emphasis: { focus: 'series' } })
    expect(option.series[0].markLine).toEqual({ silent: true, symbol: 'none', lineStyle: { color: MUTED, width: 1, type: 'solid' }, label: { show: false }, data: [{ yAxis: 0 }] })
    expect(option.series[0].data).toEqual([0.541666667, null])
    const rows = tooltipRows(option.tooltip.formatter([{ seriesName: 'Savings rate (actual)', seriesType: 'line', axisValueLabel: 'Jun 2026', value: 0.35, color: PALETTE[0] }]))
    expect(rows.rows).toEqual([{ kind: 'row', label: 'Savings rate (actual)', value: '35.0%' }])
  })
  it('exports month, net pay, spend, rate — verbatim, blanks for nulls', () => {
    expect(savingsRateCsv(matrixFixture())).toEqual({
      headers: ['Month', 'Net pay', 'Spend', 'Savings rate'],
      rows: [['2026-06-01', '6000.00', '2750.00', '0.541666667'], ['2026-07-01', '6000.00', '2000.00', '']],
    })
  })
})

describe('categoryTrendOption', () => {
  const TREND = [{ categoryId: 2, slot: 1 }, { categoryId: 1, slot: 0 }]
  it('one line per pick on its slot, budget steps as muted references after the data rows', () => {
    const option = read(categoryTrendOption({ matrix: matrixFixture(), trend: TREND, nameById: NAMES, monthLabels: LABELS, range: { preset: 'all' }, selected: { Rent: false } }))
    expect(option.series.map((s) => s.name)).toEqual(['Groceries <b>& more</b>', 'Rent', 'Groceries <b>& more</b> budget'])
    expect(option.series.map((s) => s.color)).toEqual([PALETTE[1], PALETTE[0], MUTED])
    expect(option.series[2]).toMatchObject({ id: 'budget-Groceries <b>& more</b> budget', step: 'end', lineStyle: { type: 'dashed' } })
    expect(option.series[0].data).toEqual([600, null])
    expect(option.grid).toEqual(GRID_VARIANTS.default)
    expect(option.legend.selected).toEqual({ Rent: false })
    const rows = tooltipRows(option.tooltip.formatter([
      { seriesName: 'Groceries <b>& more</b> budget', seriesType: 'line', axisValueLabel: 'Jun 2026', value: 500, color: MUTED },
      { seriesName: 'Groceries <b>& more</b>', seriesType: 'line', value: 600, color: PALETTE[1] },
    ]))
    expect(rows.rows.map((r) => [r.kind, r.label])).toEqual([['row', 'Groceries &lt;b&gt;&amp; more&lt;/b&gt;'], ['ref', 'Groceries &lt;b&gt;&amp; more&lt;/b&gt; budget']])
  })
  it('is null with no picks; exports the picked categories', () => {
    expect(categoryTrendOption({ matrix: matrixFixture(), trend: [], nameById: NAMES, monthLabels: LABELS, range: { preset: 'all' }, selected: {} })).toBeNull()
    expect(categoryTrendCsv(matrixFixture(), TREND, NAMES)).toEqual({
      headers: ['Month', 'Groceries <b>& more</b>', 'Rent'],
      rows: [['2026-06-01', '600.00', '2000.00'], ['2026-07-01', '', '2000.00']],
    })
  })
})
```

Run: `npx vitest run src/components/spending/spendingChartOptions.test.ts`
Expected: FAIL — exports missing.

- [ ] **Step 2: Write the builders**

```ts
import { pctAxis } from '../../charts/grammar'
import { slotColor } from '../../charts/entities'
import { zeroLine } from '../../charts/markLine'

export interface SavingsRateInput { matrix: SpendingMatrix; monthLabels: string[]; range: RangeState }

/** (net pay − spend) ÷ net pay per month, above the zero line you saved. Clamped to the
 *  savings-rate extents (A7): ceiling +100%, floor expanding to the data. */
export function savingsRateOption({ matrix, monthLabels, range }: SavingsRateInput): EChartsOption | null {
  if (matrix.months.length === 0) return null
  return {
    dataZoom: rangeZoom(matrix.months, range),
    grid: grid('noLegend'),
    // True value in the tooltip even when the line is clamped out of frame.
    tooltip: axisTooltip({ unit: 'percent' }),
    xAxis: monthAxis(monthLabels),
    yAxis: pctAxis(),
    series: [
      {
        ...LINE,
        name: 'Savings rate (actual)',
        color: PALETTE[0],
        connectNulls: false,
        markLine: zeroLine(),
        data: matrix.savings_rate.map((v) => (v === null ? null : Number(v))),
      },
    ],
  }
}

export function savingsRateCsv(matrix: Pick<SpendingMatrix, 'months' | 'net_pay' | 'totals' | 'savings_rate'>): ExportTable {
  return {
    headers: ['Month', 'Net pay', 'Spend', 'Savings rate'],
    rows: matrix.months.map((m, i) => [m, matrix.net_pay[i] ?? '', matrix.totals[i], matrix.savings_rate[i] ?? '']),
  }
}

export interface TrendPick { categoryId: number; slot: number }
export interface CategoryTrendInput {
  matrix: SpendingMatrix
  trend: TrendPick[]
  nameById: Map<number, string>
  monthLabels: string[]
  range: RangeState
  selected: Record<string, boolean>
}

/** Up to three categories' histories on their pick slots, each with its budget as a dashed
 *  step named "{category} budget" so the axis tooltip disambiguates when several show. */
export function categoryTrendOption({ matrix, trend, nameById, monthLabels, range, selected }: CategoryTrendInput): EChartsOption | null {
  if (matrix.months.length === 0 || trend.length === 0) return null
  const valuesById = new Map(matrix.series.map((s) => [s.category_id, s.values]))
  const budgetsById = new Map(matrix.series.map((s) => [s.category_id, s.budgets]))
  const name = (id: number) => nameById.get(id) ?? String(id)
  const budgets = trend.flatMap(({ categoryId }) => {
    const b = budgetsById.get(categoryId)
    return b === undefined || !b.some((v) => v !== null) ? [] : [budgetReference(`${name(categoryId)} budget`, b)]
  })
  const series = [
    ...trend.map(({ categoryId, slot }) => ({
      ...LINE,
      name: name(categoryId),
      color: slotColor(slot),
      connectNulls: false,
      data: (valuesById.get(categoryId) ?? []).map((v) => (v === null ? null : Number(v))),
    })),
    ...budgets,
  ]
  return {
    dataZoom: rangeZoom(matrix.months, range),
    grid: grid(),
    legend: legendFor(series.length, selected),
    tooltip: axisTooltip({ unit: 'money', references: budgets.map((b) => b.name) }),
    xAxis: monthAxis(monthLabels),
    yAxis: moneyAxis(),
    series,
  }
}

export function categoryTrendCsv(matrix: Pick<SpendingMatrix, 'months' | 'series'>, trend: TrendPick[], nameById: Map<number, string>): ExportTable {
  const valuesById = new Map(matrix.series.map((s) => [s.category_id, s.values]))
  return {
    headers: ['Month', ...trend.map((t) => nameById.get(t.categoryId) ?? String(t.categoryId))],
    rows: matrix.months.map((m, i) => [m, ...trend.map((t) => valuesById.get(t.categoryId)?.[i] ?? '')]),
  }
}
```

- [ ] **Step 3: Add the fixtures**

```ts
// src/charts/fixtures/spendingSavings.fixture.ts
import type { ChartFixture } from './_types'
import { savingsRateOption } from '../../components/spending/spendingChartOptions'
import { LABELS, MATRIX } from './spendingBars.fixture'

const fixture: ChartFixture = {
  name: 'spendingSavings',
  kind: 'cartesian',
  ariaLabel: 'Line chart of the monthly savings rate around a zero baseline',
  build: () => savingsRateOption({ matrix: MATRIX, monthLabels: LABELS, range: { preset: 'all' } }),
}
export default fixture
```

```ts
// src/charts/fixtures/spendingTrends.fixture.ts
import type { ChartFixture } from './_types'
import { categoryTrendOption } from '../../components/spending/spendingChartOptions'
import { LABELS, MATRIX, NAMES } from './spendingBars.fixture'

const fixture: ChartFixture = {
  name: 'spendingTrends',
  kind: 'cartesian',
  ariaLabel: 'Line chart of the selected categories’ monthly spend with their budgets',
  dashed: ['Groceries budget'],
  build: () =>
    categoryTrendOption({
      matrix: MATRIX, trend: [{ categoryId: 1, slot: 0 }, { categoryId: 2, slot: 1 }], nameById: NAMES,
      monthLabels: LABELS, range: { preset: 'all' }, selected: {},
    }),
}
export default fixture
```

Run: `npx vitest run src/components/spending/spendingChartOptions.test.ts src/charts/conformance.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/spending/spendingChartOptions.ts src/components/spending/spendingChartOptions.test.ts src/charts/fixtures/spendingSavings.fixture.ts src/charts/fixtures/spendingTrends.fixture.ts
git commit -m "feat(spending): savings rate and category trends lifted onto the grammar — aligned grid, whole-percent axis, budget references, CSVs (F8, F7, F12, §9, §13)"
```

---

### Task 5: SpendingPage onto `ChartCard`

**Files:**
- Modify: `src/pages/SpendingPage.tsx`, `src/pages/SpendingPage.test.tsx`
- Modify: `src/components/spending/spendingSankeyOptions.ts` (+ `spendingSankeyCsv`), create `src/charts/fixtures/spendingSankey.fixture.ts`

Six `ChartCard`s; the five inline memos, `EChart`, `ChartZoomHint`, the `spending-chart-header` markup and `animateEntrance` leave the page. F1 adds the heatmap controls (`Absolute · Row · vs average`, default Row) and the "Show N dormant" action; F8 links bars, savings and trends through `group="spending"`; F12 adds CSV + Table to every card, the sankey through `sankeyCsv`.

- [ ] **Step 1: Sankey CSV + fixture**

In `spendingSankeyOptions.ts` export the nodes/links the builder already computes by adding a sibling:

```ts
import { sankeyCsv } from '../../charts/sankey'

/** The flow as a table (F12). Built from the same nodes and links the chart draws. */
export function spendingSankeyCsv(period: SpendingFlowPeriod): ExportTable {
  const option = spendingSankeyOption(period) as { series?: { data: SankeyNode[]; links: SankeyLink[] }[] } | null
  const series = option?.series?.[0]
  return series === undefined ? { headers: ['Kind', 'Source', 'Target', 'Value'], rows: [] } : sankeyCsv(series.data, series.links)
}
```

```ts
// src/charts/fixtures/spendingSankey.fixture.ts
import type { ChartFixture } from './_types'
import { spendingSankeyOption } from '../../components/spending/spendingSankeyOptions'

const fixture: ChartFixture = {
  name: 'spendingSankey',
  kind: 'sankey',
  ariaLabel: 'Sankey flow of where the month went, from net pay into categories and savings',
  exempt: ['grid', 'axis', 'legend'],
  build: () => spendingSankeyOption({ label: 'Jul 2026', netPay: '6000.00', slices: [{ name: 'Rent', value: 2000, slot: 0 }, { name: 'Groceries', value: 580, slot: 1 }] }),
}
export default fixture
```

Add to `spendingSankeyOptions.test.ts`: `expect(spendingSankeyCsv(july()).rows).toContainEqual(['link', 'Net pay', 'Saved', '3420.00'])`.

- [ ] **Step 2: Update the page test**

In `src/pages/SpendingPage.test.tsx`:

1. The mock's `'data-pct-sample'` sampled `tooltip.valueFormatter(0.35)`; the grammar tooltip is a formatter over params. Replace with:
   ```ts
   'data-pct-sample': option.tooltip?.formatter?.([{ seriesName: 'Savings rate (actual)', seriesType: 'line', value: 0.35 }]) ?? '',
   ```
   (type the mock's `tooltip` as `{ formatter?: (p: unknown) => string }`) and the assertion at line ~263 becomes `expect(samples.some((s) => s?.includes('35.0%'))).toBe(true)`.
2. Every `'4% rule'` in the file → `'Sustainable spend'` (the legend mirror cases).
3. Add:
   ```ts
   it('mounts all six charts through ChartCard with labels and export rows', async () => {
     renderPage()
     await screen.findByText(/Monthly spend vs net pay/)
     expect(screen.getAllByRole('group', { name: /Export/ })).toHaveLength(5) // bars, savings, trends, heatmap, flow (the pie shows only when drilled)
     expect(screen.getByLabelText(/Stacked bar chart of monthly spending/)).toBeTruthy()
     expect(screen.getByLabelText(/Heatmap of spend per category per month/)).toBeTruthy()
     expect(screen.getAllByText('ctrl+scroll to zoom · drag to pan')).toHaveLength(3)
   })
   it('F1: the heatmap opens on Row, switches modes, and hides dormant rows behind a toggle', async () => {
     renderPage()
     await screen.findByText(/Month × category heatmap/)
     expect(screen.getByRole('button', { name: 'Row' }).getAttribute('aria-pressed')).toBe('true')
     fireEvent.click(screen.getByRole('button', { name: 'vs average' }))
     expect(screen.getByRole('button', { name: 'vs average' }).getAttribute('aria-pressed')).toBe('true')
     // The fixture's third category never spends: it is dormant until asked for.
     const toggle = screen.getByRole('button', { name: /Show 1 dormant/ })
     fireEvent.click(toggle)
     expect(screen.getByRole('button', { name: /Hide 1 dormant/ })).toBeTruthy()
   })
   ```
   (Adjust the dormant count to the file's matrix fixture: a category whose values are all `'0.00'`/null; add one if none exists.)

Run: `npx vitest run src/pages/SpendingPage.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Rewrite the page's chart half**

Imports — remove `EChart` (keep the `EChartEventParams`/`EChartsInstance` types), `ChartZoomHint`, `budgetStepSeries`, `spendingBarsTooltipFormatter`, `EChartsOption`, `rangeZoom`, the six theme constants, `escapeHtml`, `formatCurrencyCompact`, `buildMonthSlices`; add:

```ts
import ChartCard from '../components/ChartCard'
import Segmented from '../components/shell/Segmented'
import {
  HEATMAP_MODES, SUSTAINABLE_SPEND, categoryTrendCsv, categoryTrendOption, heatmapCsv, heatmapOption, heatmapRows,
  monthPieCsv, monthPieOption, savingsRateCsv, savingsRateOption, spendingBarsOption, spendingCsv,
} from '../components/spending/spendingChartOptions'
import type { HeatmapMode } from '../components/spending/spendingChartOptions'
import { spendingFlowPeriod, spendingSankeyCsv, spendingSankeyOption } from '../components/spending/spendingSankeyOptions'
```

State (F1): `const [heatmapMode, setHeatmapMode] = useState<HeatmapMode>('row')`, `const [showDormant, setShowDormant] = useState(false)`. Memos replacing the five inline ones:

```ts
  const barsOption = useMemo(
    () => (matrix === null ? null : spendingBarsOption({ matrix, topIds, nameById, monthLabels, range, selected: legendSelected })),
    [matrix, topIds, nameById, monthLabels, range, legendSelected],
  )
  const monthDetailOption = useMemo(() => (matrix === null ? null : monthPieOption(matrix, topIds, detailIndex)), [matrix, topIds, detailIndex])
  // The heatmap's rows: the page's all-time order minus dormant categories unless asked for.
  // `visible` is what both the option and the hover→bar mapping index by.
  const heatRows = useMemo(
    () => (matrix === null ? { visible: [] as number[], dormant: [] as number[] } : heatmapRows(matrix, heatmapOrder, showDormant)),
    [matrix, heatmapOrder, showDormant],
  )
  const heatmapOpt = useMemo(
    () => (matrix === null ? null : heatmapOption({ matrix, order: heatRows.visible, nameById, monthLabels, mode: heatmapMode })),
    [matrix, heatRows, nameById, monthLabels, heatmapMode],
  )
  const savingsOption = useMemo(() => (matrix === null ? null : savingsRateOption({ matrix, monthLabels, range })), [matrix, monthLabels, range])
  const trendOpt = useMemo(
    () => (matrix === null ? null : categoryTrendOption({ matrix, trend, nameById, monthLabels, range, selected: legendSelected })),
    [matrix, trend, nameById, monthLabels, range, legendSelected],
  )
```

`handleHeatmapHover` reads `heatRows.visible[row]` instead of `heatmapOrder[row]`. The JSX for the six cards:

```tsx
          <ChartCard
            title={detailLabel ? `Spending breakdown — ${detailLabel}` : `Monthly spend vs net pay — top ${TOP_N} categories + other`}
            hint="Top categories stacked per month under your net-pay line; the dashed Sustainable spend line is what your investable assets could fund each month at your safe withdrawal rate (Settings). Click a bar for that month's breakdown."
            ariaLabel={detailLabel ? `Donut chart of ${detailLabel}'s spending by category` : 'Stacked bar chart of monthly spending by category under the net-pay line'}
            option={activeDetail ? monthDetailOption : barsOption}
            empty={activeDetail ? `No spending recorded for ${detailLabel}.` : 'No spending recorded yet — enter a month to begin.'}
            exportName={activeDetail ? `spending-${detailMonth}` : 'spending'}
            csv={matrix === null ? undefined : activeDetail ? () => monthPieCsv(matrix, topIds, detailIndex) : () => spendingCsv(matrix, topIds, nameById)}
            height={340}
            zoomable={!activeDetail}
            group={activeDetail ? undefined : 'spending'}
            onClick={handleSpendChartClick}
            instanceRef={barsChartRef}
            onLegendChange={onLegendChange}
            onDataZoom={onZoomWindow}
            zoomWindow={activeDetail ? undefined : zoomWindow}
            actions={activeDetail ? <button className="button" onClick={() => setDetailMonth(null)}>All months</button> : undefined}
            footer={
              activeDetail && matrix ? (
                <p className="drill-hint">
                  Total {formatCurrency(matrix.totals[detailIndex])} · Net pay {formatCurrency(matrix.net_pay[detailIndex])} · Savings{' '}
                  {matrix.savings_rate[detailIndex] === null ? '—' : formatPct(matrix.savings_rate[detailIndex], { signed: false })} — click the chart to go back.
                </p>
              ) : (
                <p className="drill-hint">Click a month's bar to expand its breakdown.</p>
              )
            }
          />
```

The flow card (inside `{flowPeriod && (…)}`):

```tsx
            <ChartCard
              title={`Where ${flowPeriod.label} went`}
              hint="Net pay fanned out across the period's categories, wearing the stacked chart's colors; green Saved is what was left. A deficit period adds a red Drawdown source covering the overspend."
              ariaLabel={`Sankey flow of where ${flowPeriod.label} went, from net pay into categories and savings`}
              option={flowOption}
              empty={flowPeriod.netPay === null ? `Enter net pay for ${flowPeriod.label} to see the flow.` : `No flow to draw for ${flowPeriod.label}.`}
              exportName={`spending-flow-${flowPeriod.label.replace(/\s+/g, '-').toLowerCase()}`}
              csv={() => spendingSankeyCsv(flowPeriod)}
              height={320}
              controls={<Segmented variant="toggle" size="sm" ariaLabel="Flow window" options={[{ value: 'month', label: 'Month' }, { value: 'year', label: 'Year' }]} value={flowMode} onChange={setFlowMode} />}
              footer={<p className="drill-hint">Hover a node to trace its flows; drill a month on the top chart and this card follows it.</p>}
            />
```

Savings and trends (`span={6}` each):

```tsx
          <ChartCard
            span={6}
            title="Savings rate (actual)"
            hint="(net pay − spend) ÷ net pay each month; above the zero line you saved, below it you overspent."
            ariaLabel="Line chart of the monthly savings rate around a zero baseline"
            option={savingsOption}
            empty="No months entered yet."
            exportName="savings-rate"
            csv={matrix === null ? undefined : () => savingsRateCsv(matrix)}
            height={260}
            zoomable
            group="spending"
            onDataZoom={onZoomWindow}
            zoomWindow={zoomWindow}
            footer={<p className="drill-hint">(net pay − spend) ÷ net pay, per month. The old sheet's column tracked a planned rate, so values differ by design.</p>}
          />
          <ChartCard
            span={6}
            title="Category trends"
            hint="Single-category history — pick up to 3 to compare; a picked category's budget rides along as a dashed step."
            ariaLabel="Line chart of the selected categories’ monthly spend with their budgets"
            option={trendOpt}
            empty={`Pick up to ${MAX_TREND} categories.`}
            exportName="category-trends"
            csv={matrix === null ? undefined : () => categoryTrendCsv(matrix, trend, nameById)}
            height={220}
            zoomable
            group="spending"
            onLegendChange={onLegendChange}
            onDataZoom={onZoomWindow}
            zoomWindow={zoomWindow}
            footer={<div className="chip-row">{/* the existing category chip buttons, unchanged */}</div>}
          />
```

The heatmap:

```tsx
          <ChartCard
            title="Month × category heatmap"
            hint="Row: each category on its own 0 → max scale. vs average: orange = above its trailing 12-month average, blue = below (blank until six prior months exist). Absolute: one shared dollar scale. Rows are ordered by all-time total; categories that never spent are hidden until asked for."
            ariaLabel="Heatmap of spend per category per month"
            option={heatmapOpt}
            empty="No months entered yet."
            exportName="spending-heatmap"
            csv={matrix === null ? undefined : () => heatmapCsv(matrix, heatmapOrder, nameById)}
            height={Math.max(332, heatRows.visible.length * 24 + 142)}
            onHover={handleHeatmapHover}
            onHoverEnd={handleHeatmapHoverEnd}
            controls={<Segmented variant="toggle" size="sm" ariaLabel="Heatmap scale" options={HEATMAP_MODES} value={heatmapMode} onChange={setHeatmapMode} />}
            actions={
              heatRows.dormant.length > 0 ? (
                <button type="button" className="button" aria-pressed={showDormant} onClick={() => setShowDormant((s) => !s)}>
                  {showDormant ? 'Hide' : 'Show'} {heatRows.dormant.length} dormant
                </button>
              ) : undefined
            }
          />
```

`SUSTAINABLE_SPEND` is imported for the legend default in `barsOption`? No — the builder owns it; drop the import if unused. Remove the `!loading && !error &&` empty-note ternaries.

Run: `npx vitest run src/pages/SpendingPage.test.tsx src/components/spending && npx tsc -b && npx eslint src/pages/SpendingPage.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/pages/SpendingPage.tsx src/pages/SpendingPage.test.tsx src/components/spending/spendingSankeyOptions.ts src/components/spending/spendingSankeyOptions.test.ts src/charts/fixtures/spendingSankey.fixture.ts
git commit -m "feat(spending): six charts on ChartCard — heatmap modes and dormant toggle, one linked group, export + Table everywhere incl. the sankey (F1, F8, F9, F11, F12, F13)"
```

---

### Task 6 (droppable, last): small multiples as the trends card's `Compare · All` mode

**Files:**
- Modify: `src/components/spending/spendingChartOptions.ts`, `spendingChartOptions.test.ts`, `src/pages/SpendingPage.tsx`, `SpendingPage.test.tsx`
- Create: `src/charts/fixtures/spendingSmallMultiples.fixture.ts`

One option, one mount: every category as a tiny line in a grid of small multiples (three columns, one `grid`/`xAxis`/`yAxis` triple per cell in a single `EChartsOption`), so the card stays a `ChartCard` and the 19-instance cost the spec worried about (§20) never arises. The grid array is a declared exemption. Skip this task entirely if the night runs short — nothing depends on it, and the roster in C7 does not list it.

- [ ] **Step 1: Write the failing test**

```ts
import { categorySmallMultiplesOption } from './spendingChartOptions'

describe('categorySmallMultiplesOption', () => {
  it('one cell per category in three columns: shared month axis, own money axis, one grammar line each', () => {
    const option = categorySmallMultiplesOption({ matrix: matrixFixture(), order: [1, 2, 3], nameById: NAMES, monthLabels: LABELS }) as unknown as {
      grid: unknown[]; xAxis: { gridIndex: number }[]; yAxis: { gridIndex: number; axisLabel: { formatter: unknown } }[]
      title: { text: string }[]; series: { xAxisIndex: number; yAxisIndex: number; name: string; color: string; data: unknown[] }[]
      tooltip: { formatter: (p: unknown) => string }
    }
    expect(option.grid).toHaveLength(3)
    expect(option.xAxis.map((a) => a.gridIndex)).toEqual([0, 1, 2])
    expect(option.yAxis.every((a) => a.axisLabel.formatter === compactMoney)).toBe(true)
    expect(option.title.map((t) => t.text)).toEqual(['Rent', 'Groceries <b>& more</b>', 'Fun'])
    expect(option.series.map((s) => [s.name, s.xAxisIndex, s.yAxisIndex])).toEqual([['Rent', 0, 0], ['Groceries <b>& more</b>', 1, 1], ['Fun', 2, 2]])
    expect(option.series.every((s) => s.color === PALETTE[0])).toBe(true) // one entity per cell: no identity hue needed
    expect(option.series[1].data).toEqual([600, null])
  })
  it('is null with nothing to draw', () => {
    expect(categorySmallMultiplesOption({ matrix: matrixFixture({ months: [] }), order: [1], nameById: NAMES, monthLabels: [] })).toBeNull()
  })
})
```

- [ ] **Step 2: Write the builder**

```ts
const SM_COLUMNS = 3
const SM_CELL_HEIGHT = 110

/** Every category as a tiny line, three per row, ONE option (F/§20: one mount, not nineteen).
 *  Cells share the month axis but scale their own money axis — the reading is shape, not size. */
export function categorySmallMultiplesOption({ matrix, order, nameById, monthLabels }: { matrix: SpendingMatrix; order: number[]; nameById: Map<number, string>; monthLabels: string[] }): EChartsOption | null {
  if (matrix.months.length === 0 || order.length === 0) return null
  const valuesById = new Map(matrix.series.map((s) => [s.category_id, s.values]))
  const rows = Math.ceil(order.length / SM_COLUMNS)
  const cell = (i: number) => {
    const col = i % SM_COLUMNS
    const row = Math.floor(i / SM_COLUMNS)
    return { left: `${(col / SM_COLUMNS) * 100 + 2}%`, width: `${100 / SM_COLUMNS - 4}%`, top: row * SM_CELL_HEIGHT + 24, height: SM_CELL_HEIGHT - 44 }
  }
  return {
    grid: order.map((_, i) => cell(i)),
    title: order.map((id, i) => ({ text: nameById.get(id) ?? String(id), left: cell(i).left, top: cell(i).top - 22, textStyle: { color: MUTED, fontSize: 11, fontWeight: 600 } })),
    xAxis: order.map((_, i) => ({ ...monthAxis(monthLabels), gridIndex: i, axisLabel: { show: i >= order.length - SM_COLUMNS, interval: 'auto' as const } })),
    yAxis: order.map((_, i) => ({ ...moneyAxis(), gridIndex: i, splitNumber: 2 })),
    tooltip: axisTooltip({ unit: 'money' }),
    series: order.map((id, i) => ({
      ...LINE,
      name: nameById.get(id) ?? String(id),
      xAxisIndex: i,
      yAxisIndex: i,
      color: PALETTE[0],
      connectNulls: false,
      data: (valuesById.get(id) ?? []).map((v) => (v === null ? null : Number(v))),
    })),
    // The card sizes itself from this: rows × the cell height.
    ...({ __rows: rows } as Record<string, never>),
  }
}
```

(Drop the `__rows` spread — compute `rows` in the page from `order.length` with the same formula. It is shown here only to say where the card's height comes from.) Height in the page: `Math.ceil(order.length / 3) * 110 + 24`.

- [ ] **Step 3: Fixture and the card control**

```ts
// src/charts/fixtures/spendingSmallMultiples.fixture.ts
import type { ChartFixture } from './_types'
import { categorySmallMultiplesOption } from '../../components/spending/spendingChartOptions'
import { LABELS, MATRIX, NAMES } from './spendingBars.fixture'

const fixture: ChartFixture = {
  name: 'spendingSmallMultiples',
  kind: 'cartesian',
  ariaLabel: 'Small multiples: every spending category’s monthly history as its own tiny line',
  exempt: ['grid'],
  build: () => categorySmallMultiplesOption({ matrix: MATRIX, order: [1, 2, 3], nameById: NAMES, monthLabels: LABELS }),
}
export default fixture
```

In `SpendingPage.tsx`: `const [trendView, setTrendView] = useState<'compare' | 'all'>('compare')`; a memo `smallMultiples = useMemo(() => matrix === null ? null : categorySmallMultiplesOption({ matrix, order: heatmapOrder, nameById, monthLabels }), …)`; the trends `ChartCard` gets `controls={<Segmented variant="toggle" size="sm" ariaLabel="Trend view" options={[{ value: 'compare', label: 'Compare' }, { value: 'all', label: 'All' }]} value={trendView} onChange={setTrendView} />}`, `option={trendView === 'all' ? smallMultiples : trendOpt}`, `height={trendView === 'all' ? Math.ceil(heatmapOrder.length / 3) * 110 + 24 : 220}`, `ariaLabel` switching to the fixture's sentence in `all` mode, `zoomable={trendView === 'compare'}`, the chip picker footer only in `compare`. Page test: clicking `All` renders the small-multiples label.

Run: `npx vitest run src/components/spending src/pages/SpendingPage.test.tsx src/charts/conformance.test.ts && npx tsc -b`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/spending/spendingChartOptions.ts src/components/spending/spendingChartOptions.test.ts src/pages/SpendingPage.tsx src/pages/SpendingPage.test.tsx src/charts/fixtures/spendingSmallMultiples.fixture.ts
git commit -m "feat(spending): Compare · All on the trends card — small multiples as one option (spec §18 lane 2, droppable)"
```

---

### Task 7: Verify

- [ ] Run `npx tsc -b && npx eslint . && npx vitest run` from the worktree root. Expected: green. `npx vitest run src/charts/conformance.test.ts` lists passing cases for `spendingBars`, `spendingMonthPie`, `spendingHeatmapRow`, `spendingHeatmapVsAverage`, `spendingSavings`, `spendingTrends`, `spendingSankey` (and `spendingSmallMultiples` if Task 6 landed).
- [ ] `grep -rn "<EChart" src/pages/SpendingPage.tsx` → no output; `grep -n "4% rule" src/pages/SpendingPage.tsx src/components/spending/*.ts` → no output.
- [ ] Commit anything the runs touched; the lane is ready to merge.

---

## Self-review

**Spec coverage:** F1 (three modes, default Row, labelled scale legend, dormant rows) → Tasks 3, 5. F8 (bars/savings/trends aligned — savings 60 → 70 — and linked through `group="spending"`) → Tasks 1, 4, 5. F13 (`4% rule` → `Sustainable spend` with the hint) → Tasks 1, 5. F7 on every builder → Tasks 1–4. F9 (bars + trends legends already mirrored; builders take `selected`) → Tasks 1, 4. F11 (bars, month pie, savings rate, trends, heatmap, sankey named) → Task 5. F12 (CSV added for the full heatmap matrix, savings rate, trends, drill-down pie, sankey) → Tasks 2–5. `budgetStepSeries` absorbed by `budgetReference` → Tasks 1, 4. Small multiples → Task 6 (droppable). Retired-but-kept: `spendingBarsTooltipFormatter`, `budgetChartOptions.ts`, `.spending-chart-header` — C7. **Placeholders:** the two "unchanged" markers (the category chip buttons, the mock's other attributes) refer to code already in the file; all new code is written out. **Type consistency:** `spendingBarsOption({ matrix, topIds, nameById, monthLabels, range, selected })`, `monthPieOption(matrix, topIds, monthIndex)`, `heatmapRows(matrix, order, showDormant)`, `heatmapOption({ matrix, order, nameById, monthLabels, mode })`, `heatmapCsv(matrix, order, nameById)`, `savingsRateOption({ matrix, monthLabels, range })`, `categoryTrendOption({ matrix, trend, nameById, monthLabels, range, selected })`, `categorySmallMultiplesOption({ matrix, order, nameById, monthLabels })`, `spendingSankeyCsv(period)`, `HEATMAP_MODES`/`HeatmapMode`, `SUSTAINABLE_SPEND` are used with these names in the page task; C1 names (`grid`, `moneyAxis`, `pctAxis`, `monthAxis`, `LINE`, `BAR_MARKS`, `stagger`, `compactMoney`, `legendFor`, `referenceLine`/`budgetReference`, `zeroLine`, `axisTooltip`/`itemTooltip`, `sequentialVisualMap`/`divergingVisualMap`/`rowNormalize`/`vsAverage`, `slotColor`, `sankeyCsv`, `ChartCard`, `tooltipRows`) match C1's definitions.

