import { describe, expect, it } from 'vitest'
import { tooltipRows } from '../../testing/tooltipRows'
import { isGrammarTooltip } from '../../charts/tooltip'
import { GRID_VARIANTS, compactMoney, percentLabel } from '../../charts/grammar'
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
  monthPieOption,
  savingsRateCsv,
  savingsRateOption,
  spendingBarsOption,
  spendingBarsTooltipFormatter,
  spendingCsv,
} from './spendingChartOptions'

const format = spendingBarsTooltipFormatter(['Rent', '<b>Fun</b>', 'Other'])

describe('spendingBarsTooltipFormatter', () => {
  it('gives each category its share of the month and closes them with a Total row', () => {
    const html = format([
      { seriesName: 'Rent', marker: '[1]', axisValueLabel: 'Jun 2026', value: 1500 },
      { seriesName: '<b>Fun</b>', marker: '[2]', value: 300 },
      { seriesName: 'Other', marker: '[3]', value: 200 },
      { seriesName: 'Net pay', marker: '[n]', value: 6000 },
      { seriesName: '4% rule', marker: '[f]', value: 4100.5 },
    ])
    expect(html).toBe(
      '<strong>Jun 2026</strong><br/>' +
        '[1]Rent: $1,500.00 (75.0%)<br/>' +
        '[2]&lt;b&gt;Fun&lt;/b&gt;: $300.00 (15.0%)<br/>' +
        '[3]Other: $200.00 (10.0%)<br/>' +
        '<strong>Total: $2,000.00</strong><br/>' +
        '[n]Net pay: $6,000.00<br/>' +
        '[f]4% rule: $4,100.50',
    )
  })

  it('drops the shares when the month nets to zero or below (a refund month)', () => {
    const html = format([
      { seriesName: 'Rent', marker: '', axisValueLabel: 'Jun 2026', value: 100 },
      { seriesName: 'Other', marker: '', value: -100 },
    ])
    expect(html).toContain('Rent: $100.00<br/>')
    expect(html).toContain('<strong>Total: $0.00</strong>')
    expect(html).not.toContain('%')
  })

  it('says "no spending entered" on a cashflow-only month, reference lines after it', () => {
    // A6: a month whose category rows are all null is ABSENT — the tooltip must say so
    // instead of listing every category at $0.00; net pay still lists (it is real).
    const html = format([
      { seriesName: 'Rent', marker: '', axisValueLabel: 'Jun 2026', value: null },
      { seriesName: 'Net pay', marker: '[n]', value: 6000 },
    ])
    expect(html).toBe(
      '<strong>Jun 2026</strong><br/>no spending entered<br/>[n]Net pay: $6,000.00',
    )
    expect(html).not.toContain('Total:')
  })

  it('names a fully-absent month instead of going silent', () => {
    expect(format([{ seriesName: 'Rent', axisValueLabel: 'Aug 2026', value: null }])).toBe(
      '<strong>Aug 2026</strong><br/>no spending entered',
    )
    // No params at all: still nothing to say.
    expect(format([])).toBe('')
  })
})

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
      headers: ['Month', 'Rent', 'Other', 'Total', 'Net pay'],
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
})

// ── The grammar builders (charts C3) ─────────────────────────────────────────────────────

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
