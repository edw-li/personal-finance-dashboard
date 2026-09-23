import { describe, expect, it } from 'vitest'
import { tooltipRows } from '../../testing/tooltipRows'
import { isGrammarTooltip } from '../../charts/tooltip'
import { CATEGORY_HUES, ENTITY } from '../../charts/entities'
import type { CategoryFold } from '../../charts/entities'
import { ESTIMATE_DECAL, GRID_VARIANTS, compactMoney, partialItemStyle, percentLabel } from '../../charts/grammar'
import { DIVERGING, INK, MUTED, OTHER_SERIES_COLOR, PALETTE, SEQUENTIAL_BLUE, SURFACE } from '../../charts/theme'
import type { SpendingMatrix } from '../../types/api'
import {
  HEATMAP_MODES,
  SUSTAINABLE_SPEND,
  categorySmallMultiplesOption,
  categoryTrendCsv,
  categoryTrendOption,
  heatmapCsv,
  heatmapOption,
  heatmapRows,
  monthPieCsv,
  monthPieLegend,
  monthPieOption,
  CASH_RATE_SERIES,
  TOTAL_RATE_SERIES,
  savingsRateCsv,
  savingsRateOption,
  spendingBarsOption,
  spendingCsv,
} from './spendingChartOptions'

describe('spendingCsv', () => {
  it('lays out month rows × top categories + Other + Total + Net pay, verbatim strings', () => {
    const matrix = {
      months: ['2026-06-01', '2026-07-01'],
      series: [
        { category_id: 1, values: ['2000.00', '2000.00'], budgets: [null, null] },
        { category_id: 2, values: ['150.00', null], budgets: [null, null] }, // folded
      ],
      totals: ['2150.00', '2000.00'],
      net_pay: ['6000.00', null],
    }
    expect(spendingCsv(matrix, [1], new Map([[1, 'Rent']]))).toEqual({
      headers: ['Month', 'Rent', 'Other', 'All category entries', 'Net pay'],
      rows: [
        ['2026-06-01', '2000.00', '150.00', '2150.00', '6000.00'],
        // null cells go EMPTY, never '0.00' — absent is not zero; Other re-sums the fold.
        ['2026-07-01', '2000.00', '0.00', '2000.00', ''],
      ],
    })
  })

  it('keeps an absent month byte-identical — CSV output is deliberately unchanged by A6', () => {
    const matrix = {
      months: ['2026-08-01'],
      series: [
        { category_id: 1, values: [null], budgets: [null] },
        { category_id: 2, values: [null], budgets: [null] },
      ],
      totals: ['0.00'],
      net_pay: ['6000.00'],
    }
    expect(spendingCsv(matrix, [1], new Map([[1, 'Rent']])).rows).toEqual([
      ['2026-08-01', '', '0.00', '0.00', '6000.00'],
    ])
  })

  it('exports the exact server components and distinguishes transfers from cash outflow', () => {
    const matrix = matrixFixture({ totals: ['435.01', '0.00'], living_total: ['300.00', '0.00'], tax_total: ['35.01', '0.00'], transfer_total: ['100.00', '0.00'], cash_outflow: ['335.01', '0.00'], review_state: ['closed', 'in_progress'] })
    const table = spendingCsv(matrix, [1], new Map([[1, 'Rent']]))
    const record = Object.fromEntries(table.headers.map((header, i) => [header, table.rows[0][i]]))
    expect(record).toMatchObject({ 'All category entries': '435.01', 'Living spending': '300.00', 'Tax paid from take-home': '35.01', Transfers: '100.00', 'Cash outflow': '335.01', 'Review status': 'closed' })
    const savings = savingsRateCsv(matrix)
    expect(savings.rows[0].slice(-2)).toEqual(['335.01', 'closed'])
    expect(savings.rows[1].slice(-2)).toEqual(['0.00', 'in_progress'])
  })
})

// ── The grammar builders (charts C3) ─────────────────────────────────────────────────────

export function matrixFixture(over: Partial<SpendingMatrix> = {}): SpendingMatrix {
  return {
    months: ['2026-06-01', '2026-07-01'],
    categories: [
      { id: 1, name: 'Rent', slug: 'rent', sort_order: 0, is_active: true, kind: 'living' },
      {
        id: 2,
        name: 'Groceries <b>& more</b>',
        slug: 'groceries',
        sort_order: 1,
        is_active: true,
        kind: 'living',
      },
      { id: 3, name: 'Fun', slug: 'fun', sort_order: 2, is_active: true, kind: 'living' },
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
    living_total: ['2600.00', '2000.00'],
    tax_total: ['150.00', '0.00'],
    transfer_total: ['0.00', '0.00'],
    cash_savings: ['3250.00', null],
    payroll_savings: ['1000.00', null],
    total_savings: ['4250.00', null],
    total_savings_rate: ['0.607142857', null],
    ...over,
  }
}

const NAMES = new Map([[1, 'Rent'], [2, 'Groceries <b>& more</b>'], [3, 'Fun']])
const LABELS = ['Jun 2026', 'Jul 2026']
/** The page's fold (charts/entities.ts): Rent and Groceries on the first two category hues. */
const FOLD: CategoryFold = { ids: [1, 2], colors: new Map([[1, CATEGORY_HUES[0]], [2, CATEGORY_HUES[1]]]) }
const barsInput = (matrix = matrixFixture(), selected = {}) => ({
  matrix, fold: FOLD, nameById: NAMES, monthLabels: LABELS, range: { preset: 'all' as const }, selected,
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
    expect(option.series[0]).toMatchObject({ type: 'bar', stack: 'spend', barMaxWidth: 22, color: CATEGORY_HUES[0], universalTransition: true })
    expect(option.series[1].color).toBe(CATEGORY_HUES[1])
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

  it('colours each category by the fold, never by its stack position (2026-09-23 spec §C2)', () => {
    // The tax category leads the fold on the tax hue; Rent keeps its own hue one place up.
    const fold: CategoryFold = { ids: [3, 1], colors: new Map([[3, ENTITY.tax], [1, CATEGORY_HUES[0]]]) }
    const option = read(spendingBarsOption({ ...barsInput(), fold }))
    expect(option.series.slice(0, 3).map((s) => [s.id, s.color])).toEqual([
      ['cat-3', ENTITY.tax],
      ['cat-1', CATEGORY_HUES[0]],
      ['other', OTHER_SERIES_COLOR],
    ])
  })

  it('omits the budget step when no month has a total budget', () => {
    const option = read(spendingBarsOption(barsInput(matrixFixture({ total_budget: [null, null] }))))
    expect(option.series.map((s) => s.id)).not.toContain('budget-Total budget')
  })

  // F5 (2026-09-13 audit): one budgeted month in 38 drove a permanent legend chip.
  // Judged over the PRESET's window, never a manual drag's (the 2026-09-23 code-quality review):
  // a series that appears mid-drag is a notMerge rebuild, and a rebuild stops the pan dead.
  it('omits the budget step unless the preset window shows at least two budgeted months', () => {
    expect(read(spendingBarsOption(barsInput(matrixFixture({ total_budget: ['500.00', null] })))).series.map((s) => s.id)).not.toContain('budget-Total budget')
    // Fourteen months, budgeted only in the first two: All shows the step, 1Y (the last twelve) does not.
    const months = Array.from({ length: 14 }, (_, i) => `${2025 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`)
    const fourteen = matrixFixture({
      months,
      series: [1, 2, 3].map((id) => ({ category_id: id, values: months.map(() => '100.00'), budgets: months.map(() => null) })),
      totals: months.map(() => '300.00'), net_pay: months.map(() => '6000.00'),
      savings_rate: months.map(() => null), four_pct_rule: months.map(() => null),
      total_budget: months.map((_, i) => (i < 2 ? '500.00' : null)),
    })
    const labels = months.map((m) => `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`)
    const ids = (range: { preset: 'all' | '1y'; window?: { startValue: number; endValue: number } }) =>
      read(spendingBarsOption({ ...barsInput(fourteen), monthLabels: labels, range })).series.map((s) => s.id)
    expect(ids({ preset: 'all' })).toContain('budget-Total budget')
    expect(ids({ preset: '1y' })).not.toContain('budget-Total budget')
    // A drag inside either preset changes nothing.
    expect(ids({ preset: 'all', window: { startValue: 10, endValue: 13 } })).toContain('budget-Total budget')
    expect(ids({ preset: '1y', window: { startValue: 0, endValue: 3 } })).not.toContain('budget-Total budget')
  })

  it('grid, axes, legend: money grid, every month labelled, compact money ticks, Total budget deselected under the page picks', () => {
    const option = read(spendingBarsOption(barsInput(matrixFixture(), { 'Net pay': false })))
    expect(option.grid).toEqual(GRID_VARIANTS.default)
    // Every month labelled (≤ 12), through the month grammar EChart fits to the card (§C4).
    expect(option.xAxis).toMatchObject({ type: 'category', data: LABELS, axisLabel: { interval: 0, hideOverlap: true } })
    expect(option.xAxis.boundaryGap).toBeUndefined()
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

  // 2026-09-23 spec §C3: Aug 2023's $25,937.48 net pay set the axis to $30K and squashed three
  // years of $2–10K months into its bottom fifth.
  it('caps the money axis above one outlier month and marks it at the edge with its true value', () => {
    const months = Array.from({ length: 24 }, (_, i) => `${2024 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`)
    const labels = months.map((m) => `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`)
    const matrix = matrixFixture({
      months,
      series: [
        { category_id: 1, values: months.map(() => '2000.00'), budgets: months.map(() => null) },
        { category_id: 2, values: months.map(() => '600.00'), budgets: months.map(() => null) },
        { category_id: 3, values: months.map(() => '150.00'), budgets: months.map(() => null) },
      ],
      totals: months.map(() => '2750.00'),
      net_pay: months.map((_, i) => (i === 3 ? '25937.48' : '6000.00')),
      savings_rate: months.map(() => null),
      four_pct_rule: months.map(() => '2000.00'),
      total_budget: months.map(() => null),
    })
    const option = read(spendingBarsOption({ ...barsInput(matrix), monthLabels: labels })) as unknown as {
      yAxis: { max?: number; interval?: number; axisLabel: { formatter: unknown } }
      series: { id?: string; data?: unknown[]; markPoint?: { data: unknown[] } }[]
    }
    expect(option.yAxis).toMatchObject({ max: 7000, interval: 1000 })
    expect(option.yAxis.axisLabel.formatter).toBe(compactMoney)
    const netPay = option.series.find((s) => s.id === 'net-pay')!
    // The series keeps the TRUE figure (the tooltip and the table read it) …
    expect(netPay.data?.[3]).toBe(25937.48)
    // … and the edge marker says it.
    expect(netPay.markPoint?.data).toEqual([
      { name: 'Apr 2024', coord: ['Apr 2024', 7000], value: 25937.48, label: { formatter: '$25.9K ↑' } },
    ])
    // The scale is the series', not the window's: a zoom that leaves the outlier out keeps the
    // same axis, and echarts hides the markers of months outside the window itself.
    const recent = read(spendingBarsOption({ ...barsInput(matrix), monthLabels: labels, range: { preset: 'all', window: { startValue: 12, endValue: 23 } } })) as unknown as { yAxis: { max?: number } }
    expect(recent.yAxis.max).toBe(7000)
  })

  // 2026-09-23 code-quality review: the robust axis followed the MANUALLY zoomed window, so the
  // option changed exactly when an outlier entered or left the dragged window. EChart then drops
  // to a notMerge rebuild mid-drag, echarts disposes its drag controller, and the pan stops dead.
  it('a manual drag never changes the option apart from its dataZoom, so the pan keeps going', () => {
    const months = Array.from({ length: 24 }, (_, i) => `${2024 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`)
    const labels = months.map((m) => `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`)
    const matrix = matrixFixture({
      months,
      series: [1, 2, 3].map((id) => ({ category_id: id, values: months.map(() => '900.00'), budgets: months.map(() => null) })),
      totals: months.map(() => '2700.00'),
      net_pay: months.map((_, i) => (i === 3 ? '25937.48' : '6000.00')),
      savings_rate: months.map((_, i) => (i === 3 ? '-10.73' : '0.5')),
      total_savings_rate: months.map((_, i) => (i === 3 ? '-9.5' : '0.6')),
      four_pct_rule: months.map(() => '2000.00'),
      total_budget: months.map((_, i) => (i < 13 ? '500.00' : null)),
    })
    const withoutZoom = (option: unknown) => JSON.stringify({ ...(option as object), dataZoom: undefined })
    const inside = { preset: 'all' as const, window: { startValue: 0, endValue: 5 } } // holds the outlier
    const outside = { preset: 'all' as const, window: { startValue: 14, endValue: 23 } } // does not
    const bars = (range: typeof inside) => spendingBarsOption({ ...barsInput(matrix), monthLabels: labels, range })
    expect(withoutZoom(bars(inside))).toBe(withoutZoom(bars(outside)))
    expect(withoutZoom(bars(inside))).toBe(withoutZoom(bars({ preset: 'all', window: undefined as never })))
    const savings = (range: typeof inside) => savingsRateOption({ matrix, monthLabels: labels, range })
    expect(withoutZoom(savings(inside))).toBe(withoutZoom(savings(outside)))
  })
})

describe('monthPieOption', () => {
  it('slices the month in the bars’ own colours, morphing from their ids, with a value-first item tooltip', () => {
    const option = monthPieOption(matrixFixture(), FOLD, 0) as unknown as {
      tooltip: { trigger: string; formatter: (p: unknown) => string }
      series: { id: string; type: string; universalTransition: unknown; data: { name: string; value: number; itemStyle: { color: string } }[] }[]
    }
    expect(option.series[0]).toMatchObject({ id: 'month-pie', type: 'pie', universalTransition: { enabled: true, seriesKey: ['cat-1', 'cat-2', 'other'] } })
    expect(option.series[0].data).toEqual([
      { name: 'Rent', value: 2000, itemStyle: { color: CATEGORY_HUES[0] } },
      { name: 'Groceries <b>& more</b>', value: 600, itemStyle: { color: CATEGORY_HUES[1] } },
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
    expect(monthPieOption(matrixFixture(), FOLD, -1)).toBeNull()
    expect(monthPieOption(matrixFixture({ series: [{ category_id: 1, values: ['0.00', '0.00'], budgets: [null, null] }] }), FOLD, 0)).toBeNull()
  })
  it('drops the leader labels in the compact (dock) variant and keeps them by default (W7)', () => {
    type Pie = { series: { label?: { show?: boolean; formatter?: string } }[] }
    expect((monthPieOption(matrixFixture(), FOLD, 0) as unknown as Pie).series[0].label).toMatchObject({ formatter: '{b}  {d}%' })
    expect((monthPieOption(matrixFixture(), FOLD, 0, { compact: true }) as unknown as Pie).series[0].label).toEqual({ show: false })
  })
  it('exports the slices as a table', () => {
    expect(monthPieCsv(matrixFixture(), FOLD, 0)).toEqual({
      headers: ['Category', 'Amount'],
      rows: [['Rent', '2000.00'], ['Groceries <b>& more</b>', '600.00'], ['Other', '150.00']],
    })
  })
})

describe('monthPieLegend', () => {
  it('lists the drawn slices with their share of the month and their fold colour', () => {
    expect(monthPieLegend(matrixFixture(), FOLD, 0)).toEqual([
      { name: 'Rent', value: 2000, share: 2000 / 2750, color: CATEGORY_HUES[0] },
      { name: 'Groceries <b>& more</b>', value: 600, share: 600 / 2750, color: CATEGORY_HUES[1] },
      { name: 'Other', value: 150, share: 150 / 2750, color: OTHER_SERIES_COLOR },
    ])
    expect(monthPieLegend(matrixFixture(), FOLD, -1)).toEqual([])
  })
})

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

describe('savingsRateOption', () => {
  const savings = (over: Partial<SpendingMatrix> = {}) =>
    read(
      savingsRateOption({ matrix: matrixFixture(over), monthLabels: LABELS, range: { preset: 'all' } }),
    ) as unknown as {
      grid: unknown
      legend: { type: string } | undefined
      yAxis: { min: number; max: number; interval: number; axisLabel: { formatter: unknown } }
      series: { name: string; color: string; markLine: unknown; markPoint?: { data: unknown[] }; data: unknown[]; emphasis: unknown }[]
      tooltip: { formatter: (p: unknown) => string }
    }

  it('draws the total rate over the cash line in a data colour, the legend spelling both out', () => {
    const option = savings()
    expect(option.grid).toEqual(GRID_VARIANTS.default) // the legend row needs the top gutter
    expect(option.legend?.type).toBe('plain')
    expect(option.series.map((s) => s.name)).toEqual([TOTAL_RATE_SERIES, CASH_RATE_SERIES])
    // The WORDS are the point: "rate" alone never said which of the two it meant.
    expect(TOTAL_RATE_SERIES).toBe('Total (incl. payroll)')
    expect(CASH_RATE_SERIES).toBe('Cash')
    expect(option.series[0]).toMatchObject({ color: PALETTE[0], emphasis: { focus: 'series' } })
    // The cash rate is the Spending page's headline figure: a data colour, never the muted
    // annotation grey the references wear (2026-09-23 spec §C3).
    expect(option.series[1].color).toBe(PALETTE[1])
    expect(option.series[0].data).toEqual([0.607142857, null])
    expect(option.series[1].data).toEqual([0.541666667, null])
    // The zero baseline is drawn ONCE, by the leading series.
    expect(option.series[0].markLine).toEqual({
      silent: true, symbol: 'none', lineStyle: { color: MUTED, width: 1, type: 'solid' },
      label: { show: false }, data: [{ yAxis: 0 }],
    })
    expect(option.series[1].markLine).toBeUndefined()
    expect(option.yAxis.axisLabel.formatter).toBe(percentLabel)
    // The floor is FIXED at −100% and the max a nice step above the data — never the data max
    // itself, whose forced label used to print over 0%.
    expect(option.yAxis).toMatchObject({ min: -1, max: 1, interval: 0.5 })
    const rows = tooltipRows(
      option.tooltip.formatter([
        { seriesName: TOTAL_RATE_SERIES, seriesType: 'line', axisValueLabel: 'Jun 2026', value: 0.35, color: PALETTE[0] },
      ]),
    )
    expect(rows.rows).toEqual([{ kind: 'row', label: TOTAL_RATE_SERIES, value: '35.0%' }])
  })

  it('clamps a month below −100% to the floor and marks it with its true value', () => {
    // Sep 2023's −1,073% (net pay $318.76 against $3,739.62 of spending) — the audit's case.
    const option = savings({ savings_rate: ['-10.73', '0.54'], total_savings_rate: ['-10.73', '0.6'] })
    expect(option.yAxis).toMatchObject({ min: -1, max: 1, interval: 0.5 })
    // The data stays TRUE, so the tooltip prints −1,073%.
    expect(option.series[0].data).toEqual([-10.73, 0.6])
    expect(option.series[0].markPoint?.data).toEqual([
      { name: 'Jun 2026', coord: ['Jun 2026', -1], value: -10.73, label: { formatter: '-1073% ↓' } },
    ])
    // Same month, same value on the cash line: the same label prints once over the other.
    expect(option.series[1].markPoint?.data).toEqual([
      { name: 'Jun 2026', coord: ['Jun 2026', -1], value: -10.73, label: { formatter: '-1073% ↓' } },
    ])
  })

  it('lifts the second label when two clipped lines disagree at the same month', () => {
    const option = savings({ savings_rate: ['-12', '0.54'], total_savings_rate: ['-10.73', '0.6'] })
    expect(option.series[1].markPoint?.data).toEqual([
      { name: 'Jun 2026', coord: ['Jun 2026', -1], value: -12, label: { formatter: '-1200% ↓', offset: [0, -13] } },
    ])
  })

  // The browser found it: production's Sep–Dec 2023 sit under −100% side by side, and in the
  // "All" view their four labels printed over each other. One label per run — the extreme.
  it('labels one mark per run of neighbouring clipped months, the most extreme, and keeps every triangle', () => {
    const months = Array.from({ length: 36 }, (_, i) => `${2023 + Math.floor((i + 7) / 12)}-${String(((i + 7) % 12) + 1).padStart(2, '0')}-01`)
    const labels = months.map((m) => `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`)
    const clipped: Record<number, string> = { 1: '-10.73', 2: '-1.98', 3: '-1.76', 4: '-1.55' }
    const matrix = matrixFixture({ months, savings_rate: months.map((_, i) => clipped[i] ?? '0.2'), total_savings_rate: undefined })
    const option = read(savingsRateOption({ matrix, monthLabels: labels, range: { preset: 'all' } })) as unknown as {
      series: { markPoint?: { data: unknown[] } }[]
    }
    expect(labels.slice(0, 2)).toEqual(['Aug 2023', 'Sep 2023'])
    expect(option.series[0].markPoint?.data).toEqual([
      { name: 'Sep 2023', coord: ['Sep 2023', -1], value: -10.73, label: { formatter: '-1073% ↓' } },
      { name: 'Oct 2023', coord: ['Oct 2023', -1], value: -1.98, label: { show: false } },
      { name: 'Nov 2023', coord: ['Nov 2023', -1], value: -1.76, label: { show: false } },
      { name: 'Dec 2023', coord: ['Dec 2023', -1], value: -1.55, label: { show: false } },
    ])
    // A manual zoom keeps the markers the whole series decided: the option must not change
    // mid-drag (the pan would stop), and the tooltip still carries every true value.
    const zoomed = read(savingsRateOption({ matrix, monthLabels: labels, range: { preset: 'all', window: { startValue: 0, endValue: 4 } } })) as unknown as {
      series: { markPoint?: { data: { label: unknown }[] } }[]
    }
    expect(zoomed.series[0].markPoint?.data.map((item) => item.label)).toEqual([
      { formatter: '-1073% ↓' }, { show: false }, { show: false }, { show: false },
    ])
  })

  it('falls back to the lone cash line on a backend older than the savings service', () => {
    const option = savings({ total_savings_rate: undefined })
    expect(option.series.map((s) => s.name)).toEqual([CASH_RATE_SERIES])
    expect(option.grid).toEqual(GRID_VARIANTS.noLegend)
    expect(option.legend).toBeUndefined()
    // The baseline follows the leading series, whichever one that is.
    expect(option.series[0].markLine).not.toBeUndefined()
  })

  it('exports month, net pay, living and total spend, and both rates — blanks for nulls', () => {
    expect(savingsRateCsv(matrixFixture())).toEqual({
      headers: ['Month', 'Net pay', 'Living spending', 'All category entries', 'Cash rate', 'Total rate'],
      rows: [
        ['2026-06-01', '6000.00', '2600.00', '2750.00', '0.541666667', '0.607142857'],
        ['2026-07-01', '6000.00', '2000.00', '2000.00', '', ''],
      ],
    })
  })
})

describe('categoryTrendOption', () => {
  const TREND = [{ categoryId: 2 }, { categoryId: 1 }]
  it('one line per pick in its fold colour, budget steps as muted references after the data rows', () => {
    const option = read(categoryTrendOption({ matrix: matrixFixture(), trend: TREND, fold: FOLD, nameById: NAMES, monthLabels: LABELS, range: { preset: 'all' }, selected: { Rent: false } }))
    expect(option.series.map((s) => s.name)).toEqual(['Groceries <b>& more</b>', 'Rent', 'Groceries <b>& more</b> budget'])
    // Same entity, same hue as on the bars (spec §C2) — whatever order the picks were made in.
    expect(option.series.map((s) => s.color)).toEqual([CATEGORY_HUES[1], CATEGORY_HUES[0], MUTED])
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
  it('a pick outside the fold wears the Other grey', () => {
    const option = read(categoryTrendOption({ matrix: matrixFixture(), trend: [{ categoryId: 3 }, { categoryId: 1 }], fold: FOLD, nameById: NAMES, monthLabels: LABELS, range: { preset: 'all' }, selected: {} }))
    expect(option.series.map((s) => [s.name, s.color])).toEqual([['Fun', OTHER_SERIES_COLOR], ['Rent', CATEGORY_HUES[0]]])
  })
  // Review (spec §C2.1): two picks outside the fold are both the Other grey (no fold hue is ever
  // borrowed) and are told apart by a marker on the second line, a non-hue channel that is not
  // the dashed stroke the budget references wear.
  it('two picks outside the fold share the grey and are told apart by markers, never a borrowed hue', () => {
    const fold: CategoryFold = { ids: [1], colors: new Map([[1, CATEGORY_HUES[0]]]) }
    const option = read(categoryTrendOption({ matrix: matrixFixture(), trend: [{ categoryId: 2 }, { categoryId: 3 }], fold, nameById: NAMES, monthLabels: LABELS, range: { preset: 'all' }, selected: {} })) as unknown as {
      series: { name: string; color: string; symbol?: string; symbolSize?: number; showSymbol?: boolean; lineStyle?: { type?: string } }[]
      legend: { data?: (string | { name: string; icon?: string })[] }
    }
    const [groceries, fun] = option.series
    expect([groceries.color, fun.color]).toEqual([OTHER_SERIES_COLOR, OTHER_SERIES_COLOR])
    expect(groceries.symbol).toBe('none')
    expect(fun).toMatchObject({ symbol: 'triangle', symbolSize: 7, showSymbol: true })
    // Solid strokes: dashed is the budget reference's grammar.
    expect([groceries.lineStyle?.type, fun.lineStyle?.type]).toEqual([undefined, undefined])
    // The key must tell them apart as well: the theme draws every legend key as a roundRect
    // (charts/theme.ts), which cannot show a marker, so the marked pick's key names its own icon.
    // Budget references keep the theme's key.
    expect(option.legend.data).toEqual(['Groceries <b>& more</b>', { name: 'Fun', icon: 'triangle' }, 'Groceries <b>& more</b> budget'])
  })
  it('is null with no picks; exports the picked categories', () => {
    expect(categoryTrendOption({ matrix: matrixFixture(), trend: [], fold: FOLD, nameById: NAMES, monthLabels: LABELS, range: { preset: 'all' }, selected: {} })).toBeNull()
    expect(categoryTrendCsv(matrixFixture(), TREND, NAMES)).toEqual({
      headers: ['Month', 'Groceries <b>& more</b>', 'Rent'],
      rows: [['2026-06-01', '600.00', '2000.00'], ['2026-07-01', '', '2000.00']],
    })
  })
})

describe('categorySmallMultiplesOption', () => {
  it('one cell per category in three columns: shared month axis, own money axis, one grammar line each', () => {
    const option = categorySmallMultiplesOption({ matrix: matrixFixture(), order: [1, 2, 3], fold: FOLD, nameById: NAMES, monthLabels: LABELS }) as unknown as {
      grid: unknown[]; xAxis: { gridIndex: number }[]; yAxis: { gridIndex: number; axisLabel: { formatter: unknown } }[]
      title: { text: string }[]; series: { xAxisIndex: number; yAxisIndex: number; name: string; color: string; data: unknown[] }[]
      tooltip: { formatter: (p: unknown) => string }
    }
    expect(option.grid).toHaveLength(3)
    expect(option.xAxis.map((a) => a.gridIndex)).toEqual([0, 1, 2])
    // Only the bottom row prints months — through the month grammar, so EChart fits them (§C4).
    const smAxes = option.xAxis as unknown as { axisLabel: { show: boolean; interval: string; formatter?: (v: string, i: number) => string } }[]
    expect(smAxes.map((axis) => axis.axisLabel.show)).toEqual([true, true, true])
    expect(smAxes[0].axisLabel.formatter?.('Jun 2026', 0)).toBe('Jun 2026')
    expect(smAxes[0].axisLabel.interval).toBe('auto')
    expect(option.yAxis.every((a) => a.axisLabel.formatter === compactMoney)).toBe(true)
    expect(option.title.map((t) => t.text)).toEqual(['Rent', 'Groceries <b>& more</b>', 'Fun'])
    expect(option.series.map((s) => [s.name, s.xAxisIndex, s.yAxisIndex])).toEqual([['Rent', 0, 0], ['Groceries <b>& more</b>', 1, 1], ['Fun', 2, 2]])
    // Each cell wears its category's own colour (spec §C2: one colour per entity, in every
    // chart); Fun is outside the fold, so it wears the Other grey.
    expect(option.series.map((s) => s.color)).toEqual([CATEGORY_HUES[0], CATEGORY_HUES[1], OTHER_SERIES_COLOR])
    expect(option.series[1].data).toEqual([600, null])
  })
  it('is null with nothing to draw', () => {
    expect(categorySmallMultiplesOption({ matrix: matrixFixture({ months: [] }), order: [1], fold: FOLD, nameById: NAMES, monthLabels: [] })).toBeNull()
  })
})

// 2026-09-23 spec §C5: on Monthly entries every segment of the month in progress wears the
// partial look in its own colour, its label is marked, its tooltip head says so, and its net pay
// leaves the line for a lone marker (a month-to-date paycheck joined to a whole one reads as a
// fall in pay).
describe('spendingBarsOption: the month in progress (2026-09-23 spec §C5)', () => {
  const inProgress = () =>
    matrixFixture({
      months: ['2026-08-01', '2026-09-01'],
      series: [
        { category_id: 1, values: ['2000.00', '2000.00'], budgets: [null, null] },
        { category_id: 2, values: ['600.00', '250.00'], budgets: [null, null] },
        { category_id: 3, values: ['150.00', '40.00'], budgets: [null, null] },
      ],
      totals: ['2750.00', '2290.00'],
      net_pay: ['6000.00', '3000.00'],
    })
  const input = (over: Record<string, unknown> = {}) => ({
    ...barsInput(inProgress()),
    monthLabels: ['Aug 2026', 'Sep 2026'],
    todayIso: '2026-09-23',
    ...over,
  })

  it('draws every segment of the month under way partial, each in its own colour', () => {
    const [rent, groceries, other] = read(spendingBarsOption(input())).series
    expect(rent.data).toEqual([2000, { value: 2000, itemStyle: partialItemStyle(CATEGORY_HUES[0], false) }])
    expect(groceries.data).toEqual([600, { value: 250, itemStyle: partialItemStyle(CATEGORY_HUES[1], false) }])
    expect(other.data).toEqual([150, { value: 40, itemStyle: partialItemStyle(OTHER_SERIES_COLOR, false) }])
    const [hatched] = read(spendingBarsOption(input({ patterns: true }))).series
    expect(hatched.data?.[1]).toEqual({ value: 2000, itemStyle: partialItemStyle(CATEGORY_HUES[0], true) })
  })

  it('keeps an absent segment a gap while its month is under way (A6)', () => {
    const [, groceries, other] = read(spendingBarsOption(input({ matrix: matrixFixture({ months: ['2026-08-01', '2026-09-01'] }) }))).series
    expect(groceries.data).toEqual([600, null])
    expect(other.data).toEqual([150, null])
  })

  it('detaches the month-to-date net pay from the line into a lone marker under the same name', () => {
    const option = read(spendingBarsOption(input()))
    expect(option.series.map((s) => s.id)).toEqual([
      'cat-1', 'cat-2', 'other', 'net-pay', 'net-pay-partial', 'sustainable-spend', 'budget-Total budget',
    ])
    const [line, marker] = option.series.slice(3, 5)
    expect(line.data).toEqual([6000, null])
    expect(marker).toMatchObject({ type: 'line', name: 'Net pay', color: INK, z: 10 })
    expect(marker.data).toEqual([null, { value: 3000, symbol: 'circle', symbolSize: 8, itemStyle: partialItemStyle(INK, false) }])
  })

  it('adds no marker when the month under way has no net pay yet', () => {
    const option = read(spendingBarsOption(input({ matrix: { ...inProgress(), net_pay: ['6000.00', null] } })))
    expect(option.series.map((s) => s.id)).not.toContain('net-pay-partial')
    expect(option.series[3].data).toEqual([6000, null])
  })

  it('marks the label and names the month in the tooltip head, one Net pay row', () => {
    const option = read(spendingBarsOption(input()))
    const formatter = (option.xAxis.axisLabel as { formatter: (value: string, index: number) => string }).formatter
    expect(formatter('Sep 2026', 1)).toBe('Sep 2026*')
    expect(formatter('Aug 2026', 0)).toBe('Aug 2026')
    const parsed = tooltipRows(option.tooltip.formatter([
      { seriesName: 'Rent', seriesType: 'bar', axisValueLabel: 'Sep 2026', dataIndex: 1, value: 2000, color: CATEGORY_HUES[0] },
      { seriesName: 'Net pay', seriesType: 'line', dataIndex: 1, value: null, color: INK },
      { seriesName: 'Net pay', seriesType: 'line', dataIndex: 1, value: 3000, color: INK },
    ]))
    expect(parsed.head).toBe('Sep 2026 — month to date (in progress)')
    expect(parsed.rows.filter((r) => r.label === 'Net pay').map((r) => r.value)).toEqual(['$3,000.00'])
  })

  it('draws nothing partial without a today, or once the month is done', () => {
    for (const todayIso of [undefined, '2026-09-30']) {
      const option = read(spendingBarsOption(input({ todayIso })))
      expect(option.series[0].data).toEqual([2000, 2000])
      expect(option.series[3].data).toEqual([6000, 3000])
      expect(option.series.map((s) => s.id)).not.toContain('net-pay-partial')
    }
  })
})

// 2026-09-23 spec §C5: the heatmap's column for the month in progress wears the partial look;
// in the vs-average reading it stays blank (a month to date against a whole month's average
// would read as a false "below average").
describe('heatmapOption: the month in progress (2026-09-23 spec §C5)', () => {
  const MONTH_LABELS = ['Jan 2026', 'Feb 2026', 'Mar 2026', 'Apr 2026', 'May 2026', 'Jun 2026', 'Jul 2026', 'Aug 2026']
  const input = { matrix: longMatrix(), order: [1, 2], nameById: NAMES, monthLabels: MONTH_LABELS, todayIso: '2026-08-12' }

  // A cell's fill is its scale's colour, so the in-progress column rides its own series under a
  // hidden copy of the scale: faded by the scale's colorAlpha (only the FILL fades, the dashed
  // outline stays at full strength) or, under Chart patterns, hatched.
  it('draws the column under way partial in the absolute and row readings', () => {
    type Heat = {
      visualMap: Record<string, unknown>[]
      series: { id?: string; data: unknown[] }[]
    }
    const absolute = heatmapOption({ ...input, mode: 'absolute' }) as unknown as Heat
    // Finished months stay plain triples in the scale's own series; the column is not there.
    expect(absolute.series[0].data).toContainEqual([6, 0, 150])
    expect(absolute.series[0].data.some((cell) => Array.isArray(cell) && cell[0] === 7)).toBe(false)
    expect(absolute.series[1]).toMatchObject({ id: 'in-progress' })
    expect(absolute.series[1].data).toEqual([
      { value: [7, 1, 50], itemStyle: { borderColor: MUTED, borderWidth: 1, borderType: 'dashed' } },
    ])
    expect(absolute.visualMap[0].seriesIndex).toBe(0)
    expect(absolute.visualMap[1]).toMatchObject({
      show: false,
      seriesIndex: 1,
      min: absolute.visualMap[0].min,
      max: absolute.visualMap[0].max,
      inRange: { color: [...SEQUENTIAL_BLUE], colorAlpha: [0.45, 0.45] },
    })
    const row = heatmapOption({ ...input, mode: 'row', patterns: true }) as unknown as Heat
    expect(row.series[1].data).toEqual([
      { value: [7, 1, 1], itemStyle: { borderColor: MUTED, borderWidth: 1, borderType: 'dashed', decal: ESTIMATE_DECAL } },
    ])
    // Hatched, not faded: the scale copy keeps its colours at full strength.
    expect((row.visualMap[1].inRange as Record<string, unknown>).colorAlpha).toBeUndefined()
  })

  // Review (audit F1): a blank column read as "no data"; the month in progress has data, it is
  // just not comparable yet. Its cells are drawn neutral and hatched, in a series the diverging
  // scale does not colour, and say why on hover.
  it('draws the column neutral and hatched in the vs-average reading: there, not compared', () => {
    const option = heatmapOption({ ...input, mode: 'vsAverage' }) as unknown as {
      visualMap: { seriesIndex?: number }[]
      series: { id?: string; type: string; data: unknown[]; itemStyle?: unknown; emphasis?: unknown }[]
      tooltip: { formatter: (p: unknown) => string }
    }
    // The comparison itself still leaves the month out.
    expect(option.series[0].data).toEqual([[6, 0, 0.5], [6, 1, 0]])
    // The diverging scale colours the compared cells only; echarts draws a heatmap series only
    // under a visualMap of its own (a real canvas throws without one), so the in-progress series
    // gets a hidden one that maps every cell to the neutral.
    expect(option.visualMap[0].seriesIndex).toBe(0)
    expect(option.visualMap[1]).toEqual({
      type: 'continuous', show: false, seriesIndex: 1, dimension: 2, min: 0, max: 1,
      inRange: { color: [MUTED, MUTED] }, outOfRange: { color: [MUTED] },
    })
    expect(option.series[1]).toMatchObject({ id: 'in-progress', type: 'heatmap' })
    expect(option.series[1].data).toEqual([
      { value: [7, 1, 50], itemStyle: { color: MUTED, decal: ESTIMATE_DECAL } },
    ])
    const hover = tooltipRows(option.tooltip.formatter({ value: [7, 1, 50] }))
    expect([hover.lead, hover.label, hover.sub]).toEqual(['$50.00', 'Groceries &lt;b&gt;&amp; more&lt;/b&gt; · Aug 2026', 'month to date — not compared'])
    // With no month in progress, every reading keeps one series and an unrestricted scale.
    for (const mode of ['absolute', 'row', 'vsAverage'] as const) {
      const done = heatmapOption({ ...input, mode, todayIso: '2026-08-31' }) as unknown as { visualMap: { seriesIndex?: number }; series: unknown[] }
      expect(done.series).toHaveLength(1)
      expect(done.visualMap.seriesIndex).toBeUndefined()
    }
  })

  it('marks the label and names the month in the tooltip', () => {
    const option = readHeat(heatmapOption({ ...input, mode: 'row' }))
    const formatter = (option.xAxis.axisLabel as unknown as { formatter: (value: string, index: number) => string }).formatter
    expect(formatter('Aug 2026', 7)).toBe('Aug 2026*')
    expect(formatter('Jul 2026', 6)).toBe('Jul 2026')
    const noted = tooltipRows(option.tooltip.formatter({ value: [7, 1, 1] }))
    expect([noted.lead, noted.label, noted.sub]).toEqual([
      '$50.00',
      'Groceries &lt;b&gt;&amp; more&lt;/b&gt; · Aug 2026 — month to date (in progress)',
      '100% of this category’s busiest month',
    ])
    expect(tooltipRows(option.tooltip.formatter({ value: [6, 0, 1] })).label).toBe('Rent · Jul 2026')
  })
})
