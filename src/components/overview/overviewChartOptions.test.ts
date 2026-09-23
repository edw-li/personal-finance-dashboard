import { describe, expect, it } from 'vitest'
import type { EChartsOption } from '../../charts/echarts'
import { CATEGORY_HUES, ENTITY } from '../../charts/entities'
import { GRID_VARIANTS, partialItemStyle } from '../../charts/grammar'
import { INK, MUTED, OTHER_SERIES_COLOR, PALETTE, SURFACE } from '../../charts/theme'
import { tooltipRows } from '../../testing/tooltipRows'
import type { CoverageOut, TaxSummaryOut } from '../../types/api'
import {
  netWorthTrendCsv,
  netWorthTrendOption,
  notEnteredMonths,
  pickTaxSummary,
  recentSpendCsv,
  recentSpendOption,
  spendStats,
} from './overviewChartOptions'

// ISO first-of-months, ascending — the shape both /net-worth/timeseries and
// /spending/matrix send.
function monthsFrom(start: string, count: number): string[] {
  const [year, month] = start.split('-').map(Number)
  return Array.from({ length: count }, (_, i) => {
    const m = month + i
    const y = year + Math.floor((m - 1) / 12)
    return `${y}-${String(((m - 1) % 12) + 1).padStart(2, '0')}-01`
  })
}

// Server money is a decimal STRING (pydantic v2): 100.00, 200.00, … one per month.
function totalsFrom(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `${(i + 1) * 100}.00`)
}

// /coverage as the page receives it — every list empty unless a case names one.
function coverageOut(over: Partial<CoverageOut> = {}): CoverageOut {
  return {
    balances: [],
    spending: [],
    net_pay: [],
    spending_empty: [],
    spending_missing: [],
    net_pay_missing: [],
    latest: { balances: null, spending: null, net_pay: null },
    ...over,
  }
}

// The engine's per-year summary; pickTaxSummary reads `year` to choose and the page reads
// the rest, so the fixture carries a distinguishable total per year (taxChartOptions.test's
// emptySummary, trimmed).
function summary(year: number): TaxSummaryOut {
  const income = { agi: '0.00', taxable_income: '0.00', tax: '0.00', effective_rate: null }
  const wage = { w2_income: '0.00', taxable_wages: '0.00', tax: '0.00', effective_rate: null }
  return {
    year,
    federal: income,
    state: income,
    medicare: wage,
    social_security: wage,
    disability: wage,
    capital_gains: {
      taxable_income: '0.00', gains_amount: '0.00', tax: '0.00', effective_rate: null,
    },
    totals: {
      gross_income: `${year}.00`, total_income: '0.00', total_tax: '0.00',
      take_home: '0.00', effective_rate: null,
    },
    warnings: [],
  }
}

// --- option readers -------------------------------------------------------------------
// EChartsOption is a wide union; narrowed once here so the assertions stay about the data.
interface SeriesLike {
  type?: string
  name?: string
  color?: string
  symbol?: string
  barMaxWidth?: number
  itemStyle?: { borderColor?: string; borderWidth?: number }
  areaStyle?: { opacity?: number }
  emphasis?: { focus?: string; itemStyle?: { borderColor?: string } }
  lineStyle?: { width?: number; type?: string }
  z?: number
  data?: unknown[]
}

function seriesOf(option: EChartsOption | null): SeriesLike[] {
  expect(option).not.toBeNull()
  return (option as unknown as { series: SeriesLike[] }).series
}

function categoriesOf(option: EChartsOption | null): string[] {
  return (option as unknown as { xAxis: { data: string[] } }).xAxis.data
}

/** The raw axis data — a plain label string, or the `{ value, textStyle }` datum a
 *  not-entered month carries. */
function axisDataOf(option: EChartsOption | null): unknown[] {
  return (option as unknown as { xAxis: { data: unknown[] } }).xAxis.data
}

function xAxisOf(option: EChartsOption | null): { show?: boolean; boundaryGap?: boolean } {
  return (option as unknown as { xAxis: { show?: boolean; boundaryGap?: boolean } }).xAxis
}

function yAxisOf(option: EChartsOption | null): {
  show?: boolean
  scale?: boolean
  axisLabel?: { formatter?: (v: number) => string }
} {
  return (option as unknown as { yAxis: { show?: boolean; scale?: boolean; axisLabel?: { formatter?: (v: number) => string } } }).yAxis
}

function tooltipOf(option: EChartsOption | null): {
  trigger?: string
  axisPointer?: { type?: string }
  formatter: (p: unknown) => string
} {
  return (
    option as unknown as {
      tooltip: { trigger?: string; axisPointer?: { type?: string }; formatter: (p: unknown) => string }
    }
  ).tooltip
}

function gridOf(option: EChartsOption | null): unknown {
  return (option as unknown as { grid: unknown }).grid
}

describe('netWorthTrendOption', () => {
  it('draws one blue line as a FULL chart — axes visible, default pointer rule kept', () => {
    const option = netWorthTrendOption({
      months: monthsFrom('2025-11-01', 3),
      net_worth: ['1000.00', '-250.50', '2000.75'],
    })
    const [line] = seriesOf(option)
    expect(line.type).toBe('line')
    expect(line.color).toBe(PALETTE[0])
    expect(line.symbol).toBe('none')
    expect(line.data).toEqual([1000, -250.5, 2000.75])
    expect(categoriesOf(option)).toEqual(['Nov 2025', 'Dec 2025', 'Jan 2026'])
    // 2026-08-25 user report: at 220px in a full-width card beside two fully-dressed
    // siblings, hidden axes read as BREAKAGE, not a sparkline license (audit I-9). The
    // axes are now visible — pinned as the absence of the old show:false opt-outs.
    expect(xAxisOf(option).show).toBeUndefined()
    expect(yAxisOf(option).show).toBeUndefined()
    // Compact ticks, exact tooltip: the axis is a scale, the tooltip is a figure
    // (recentSpendOption's exact grammar).
    expect(yAxisOf(option).axisLabel?.formatter?.(1500)).toBe('$1.5K')
    // F7: one grammar tooltip, read through its row contract rather than a valueFormatter.
    expect(
      tooltipRows(
        tooltipOf(option).formatter([
          { seriesName: 'Net worth', seriesType: 'line', axisValueLabel: 'Dec 2025', value: -250.5, color: PALETTE[0] },
        ]),
      ).rows,
    ).toEqual([{ kind: 'row', label: 'Net worth', value: '-$250.50' }])
    // §8: a single-series card takes the noLegend grid; §9 gives the line series focus.
    expect(gridOf(option)).toEqual(GRID_VARIANTS.noLegend)
    expect(line.emphasis).toEqual({ focus: 'series' })
    // A washed area over a VISIBLE axis needs the honest zero baseline
    // (historyChartOptions' rule) — so no scale:true, and the wash drops to the house's
    // visible-axis opacity.
    expect(yAxisOf(option).scale).toBeUndefined()
    expect(line.areaStyle?.opacity).toBe(0.12)
    // No half-category padding: the line has to touch both card edges or the fill leaves
    // gutters that read as missing months.
    expect(xAxisOf(option).boundaryGap).toBe(false)
    // With axes on screen the pointer rule has something to point at: echarts' default
    // dotted rule stays (no opt-out) — the dataviz law that a line chart ships its
    // crosshair by default, and the second half of the user report.
    expect(tooltipOf(option).trigger).toBe('axis')
    expect(tooltipOf(option).axisPointer).toBeUndefined()
  })

  it('returns null under two months — one point is not a trend', () => {
    expect(netWorthTrendOption({ months: [], net_worth: [] })).toBeNull()
    expect(netWorthTrendOption({ months: ['2026-01-01'], net_worth: ['1000.00'] })).toBeNull()
  })
})

describe('recentSpendOption', () => {
  // Review (spec §C2): the bars wore PALETTE[1], which is Food & Dining's and RSU's colour on
  // this same page. Total spending is an aggregate, not an entity: it wears the structural
  // neutral no category and no income entity uses.
  it('bars the months in the neutral total-spending grey, no entity’s colour, hairlined against the card', () => {
    const option = recentSpendOption({ months: monthsFrom('2026-01-01', 3), totals: totalsFrom(3) })
    const [bars] = seriesOf(option)
    expect(bars.type).toBe('bar')
    expect(bars.color).toBe(MUTED)
    const entityHues = [
      ...CATEGORY_HUES,
      ENTITY.salary, ENTITY.rsu, ENTITY.espp, ENTITY.investmentIncome, ENTITY.otherIncome,
      ENTITY.tax, ENTITY.preTaxSavings, ENTITY.saved, ENTITY.deficit, ENTITY.other, ENTITY.card, ENTITY.ritual,
    ]
    expect(entityHues).not.toContain(bars.color)
    // Single-series chart — there are no stacked neighbours here to separate. The
    // surface-colored 1px border is an inset that keeps this chart reading as one family
    // with SpendingPage's stacked bars (there the same border divides segments).
    expect(bars.itemStyle?.borderColor).toBe(SURFACE)
    expect(bars.itemStyle?.borderWidth).toBe(1)
    // A dozen months across a full-width card would otherwise stretch into blocks.
    expect(bars.barMaxWidth).toBe(22)
    expect(bars.data).toEqual([100, 200, 300])
    expect(categoriesOf(option)).toEqual(['Jan 2026', 'Feb 2026', 'Mar 2026'])
    expect(bars.emphasis).toEqual({ focus: 'series', itemStyle: { borderColor: INK } })
  })

  // Coordinator decision (2026-09-23 review): the bars are the neutral grey, so the average is
  // drawn in INK, dashed. Its key differs from the bars' and its dashes read across every bar,
  // so the surface casing is gone (it only cut the bars in two).
  it('draws the average in ink, dashed, so its key and its line stand apart from the grey bars', () => {
    const option = recentSpendOption({ months: monthsFrom('2026-01-01', 3), totals: totalsFrom(3) })
    const [bars, average, ...rest] = seriesOf(option)
    expect(bars.color).toBe(MUTED)
    expect(average).toMatchObject({ name: '12-mo average', color: INK, lineStyle: { width: 2, type: 'dashed' } })
    expect(average.color).not.toBe(bars.color)
    expect(rest).toEqual([])
  })

  it('F14: a dashed reference at the SPEND TILE’s own 12-mo average, listed after the bars', () => {
    const feed = { months: monthsFrom('2026-01-01', 3), totals: totalsFrom(3) }
    const option = recentSpendOption(feed)
    const [bars, average] = seriesOf(option)
    expect(bars.name).toBe('Spend')
    expect(average).toMatchObject({ name: '12-mo average', type: 'line', color: INK, z: 9, lineStyle: { width: 2, type: 'dashed' } })
    // One label, ONE number: the line is spendStats.avg12 — the mean of the months
    // STRICTLY BEFORE the latest (100, 200 → 150), which is exactly what the tile
    // prints as “over/under $150.00 12-mo avg”. The mean of the SHOWN window
    // (100, 200, 300 → 200) would let the judged bar drag its own baseline.
    expect(average.data).toEqual([150, 150, 150])
    expect((average.data as number[])[0]).toBe(spendStats(feed).avg12)
    expect((option as unknown as { legend: { type: string } }).legend.type).toBe('plain')
    expect(gridOf(option)).toEqual(GRID_VARIANTS.default)
    // A 14-month feed: months[1..12] = 200…1300, mean 750 — the tile's figure again,
    // not the drawn window's 850.
    const long = { months: monthsFrom('2025-01-01', 14), totals: totalsFrom(14) }
    expect((seriesOf(recentSpendOption(long))[1].data as number[])[0]).toBe(750)
    expect((seriesOf(recentSpendOption(long))[1].data as number[])[0]).toBe(spendStats(long).avg12)
  })

  it('drops the reference when there is no month before the latest to average', () => {
    // A one-month book: avg12 is null, the tile shows no delta, and a line at the single
    // bar's own value would be a comparison with itself.
    const feed = { months: monthsFrom('2026-01-01', 1), totals: totalsFrom(1) }
    expect(spendStats(feed).avg12).toBeNull()
    expect(seriesOf(recentSpendOption(feed)).map((s) => s.name)).toEqual(['Spend'])
  })

  it('keeps only the last twelve months of a longer feed', () => {
    const option = recentSpendOption({
      months: monthsFrom('2025-01-01', 14),
      totals: totalsFrom(14),
    })
    expect(categoriesOf(option)).toHaveLength(12)
    // The 14-month feed loses its first two: Jan/Feb 2025 drop off the left.
    expect(categoriesOf(option)[0]).toBe('Mar 2025')
    expect(categoriesOf(option)[11]).toBe('Feb 2026')
    expect(seriesOf(option)[0].data).toEqual([300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1300, 1400])
  })

  it('honors a narrower window and never slices past the start', () => {
    const feed = { months: monthsFrom('2025-01-01', 14), totals: totalsFrom(14) }
    expect(categoriesOf(recentSpendOption(feed, 3))).toEqual(['Dec 2025', 'Jan 2026', 'Feb 2026'])
    // Fewer months than the window: the whole feed, in order and with no padding — a
    // young book is short, not incomplete.
    const short = { months: monthsFrom('2026-01-01', 2), totals: totalsFrom(2) }
    expect(categoriesOf(recentSpendOption(short, 12))).toEqual(['Jan 2026', 'Feb 2026'])
    expect(seriesOf(recentSpendOption(short, 12))[0].data).toEqual([100, 200])
  })

  // Audit item 14: the matrix months are a UNION of spending rows and net-pay rows, so a
  // month nobody entered arrives as an explicit "0.00". A solid bar at the baseline reads
  // as a real zero-spend month.
  it('draws a not-entered month hollow and says so in its tooltip row', () => {
    const feed = { months: monthsFrom('2026-01-01', 3), totals: ['100.00', '0.00', '300.00'] }
    const option = recentSpendOption(feed, 12, new Set(['2026-02-01']))
    const [bars] = seriesOf(option)
    // Border only, no fill — the ESPP anatomy's "not what it looks like" idiom. The
    // entered months stay plain numbers, so the series still carries the palette fill.
    expect(bars.data).toEqual([
      100,
      { value: 0, itemStyle: { color: 'transparent', borderColor: MUTED, borderWidth: 1.5 } },
      300,
    ])
    // The row keeps its figure and gains the word that makes the figure honest.
    const suffixed = tooltipRows(
      tooltipOf(option).formatter([
        { seriesName: 'Spend', seriesType: 'bar', axisValueLabel: 'Feb 2026', dataIndex: 1, value: 0, color: MUTED },
      ]),
    )
    expect(suffixed.rows).toEqual([{ kind: 'row', label: 'Spend (not entered)', value: '$0.00' }])
    // ...and an entered month is untouched.
    const plain = tooltipRows(
      tooltipOf(option).formatter([
        { seriesName: 'Spend', seriesType: 'bar', axisValueLabel: 'Jan 2026', dataIndex: 0, value: 100, color: MUTED },
      ]),
    )
    expect(plain.rows).toEqual([{ kind: 'row', label: 'Spend', value: '$100.00' }])
  })

  it('recedes a not-entered month’s axis label instead of inventing a bar height', () => {
    // Its total IS 0.00, so the hollow bar is a baseline tick — the cue has to ride the
    // label. A per-datum object, never an axisLabel.color callback: recolor.ts passes
    // functions through by identity, so a callback would stay dark under the light theme.
    const feed = { months: monthsFrom('2026-01-01', 3), totals: ['100.00', '0.00', '300.00'] }
    expect(axisDataOf(recentSpendOption(feed, 12, new Set(['2026-02-01'])))).toEqual([
      'Jan 2026',
      { value: 'Feb 2026', textStyle: { color: OTHER_SERIES_COLOR } },
      'Mar 2026',
    ])
    // Nothing named: every label is a plain string on the theme's own axis colour.
    expect(axisDataOf(recentSpendOption(feed))).toEqual(['Jan 2026', 'Feb 2026', 'Mar 2026'])
  })

  it('keeps the dashed reference on the average the tile prints, not-entered months out', () => {
    const feed = { months: monthsFrom('2026-01-01', 3), totals: ['100.00', '0.00', '300.00'] }
    const notEntered = new Set(['2026-02-01'])
    // Priors 100 and (excluded) 0 → 100, the same figure the tile compares against.
    expect((seriesOf(recentSpendOption(feed, 12, notEntered))[1].data as number[])[0]).toBe(100)
    expect((seriesOf(recentSpendOption(feed, 12, notEntered))[1].data as number[])[0]).toBe(
      spendStats(feed, notEntered).avg12,
    )
  })

  it('formats the axis compactly and the tooltip in full, and empties to null', () => {
    const option = recentSpendOption({ months: monthsFrom('2026-01-01', 2), totals: totalsFrom(2) })
    // Compact ticks, exact tooltip: the axis is a scale, the tooltip is a figure.
    expect(yAxisOf(option).axisLabel?.formatter?.(1500)).toBe('$1.5K')
    expect(tooltipOf(option).axisPointer).toEqual({ type: 'shadow' }) // F7: bars take the shadow rule
    const rows = tooltipRows(tooltipOf(option).formatter([
      { seriesName: 'Spend', seriesType: 'bar', axisValueLabel: 'Jan 2026', value: 100, color: MUTED },
      { seriesName: '12-mo average', seriesType: 'line', value: 150, color: MUTED },
    ]))
    expect(rows.rows.map((r) => [r.kind, r.label, r.value])).toEqual([['row', 'Spend', '$100.00'], ['ref', '12-mo average', '$150.00']])
    expect(recentSpendOption({ months: [], totals: [] })).toBeNull()
  })
})

describe('the overview CSVs (F12)', () => {
  it('exports the trend and the shown spend months', () => {
    expect(netWorthTrendCsv({ months: ['2026-01-01', '2026-02-01'], net_worth: ['1.00', '2.00'] })).toEqual({ headers: ['Month', 'Net worth'], rows: [['2026-01-01', '1.00'], ['2026-02-01', '2.00']] })
    expect(recentSpendCsv({ months: monthsFrom('2025-01-01', 14), totals: totalsFrom(14) }).rows).toHaveLength(12)
    expect(recentSpendCsv({ months: monthsFrom('2026-01-01', 2), totals: totalsFrom(2) })).toEqual({ headers: ['Month', 'Spend'], rows: [['2026-01-01', '100.00'], ['2026-02-01', '200.00']] })
  })

  // Code review 13 (2026-09-23 spec §C5): the bars mark the month in progress; the table twin
  // names it, and keeps its shape when no shown month is in progress.
  it('names the month in progress in a Period column', () => {
    const matrix = { months: ['2026-07-01', '2026-08-01'], totals: ['100.00', '50.00'] }
    expect(recentSpendCsv(matrix, 12, { todayIso: '2026-08-12' })).toEqual({
      headers: ['Month', 'Spend', 'Period'],
      rows: [['2026-07-01', '100.00', 'Whole month'], ['2026-08-01', '50.00', 'Month to date (in progress)']],
    })
    expect(recentSpendCsv(matrix, 12, { todayIso: '2026-08-31' }).headers).toEqual(['Month', 'Spend'])
    // Judged over the SHOWN months: an older partial month outside the window adds nothing.
    expect(recentSpendCsv(matrix, 1, { todayIso: '2026-07-12' }).headers).toEqual(['Month', 'Spend', 'Period'])
    expect(recentSpendCsv({ months: ['2026-07-01', '2026-08-01'], totals: ['100.00', '50.00'] }, 1, { todayIso: '2026-06-12' }).rows).toEqual([
      ['2026-08-01', '50.00', 'Future month (in progress)'],
    ])
  })
})

describe('spendStats', () => {
  it('takes the LATEST month as the tile and means the twelve before it', () => {
    // A hand-entered app: the current calendar month is absent until the wizard runs, so
    // the tile month is whatever the feed ends on and the label has to carry it.
    const stats = spendStats({ months: monthsFrom('2025-01-01', 14), totals: totalsFrom(14) })
    expect(stats.month).toBe('2026-02-01')
    // The server's own string, verbatim — never re-derived, never re-rounded.
    expect(stats.total).toBe('1400.00')
    // months[1..12] = 200…1300: the twelve STRICTLY BEFORE the tile month.
    expect(stats.avg12).toBe(750)
    expect(stats.aboveAvg).toBe(true)
  })

  it('excludes the tile month and anything past twelve back from the mean', () => {
    const months = monthsFrom('2025-01-01', 14)
    // months[0] is thirteen back — outside the window — and months[13] IS the tile month.
    // Neither may move the average; without the two slice bounds one of them would.
    const totals = totalsFrom(14)
    totals[0] = '999999.00'
    totals[13] = '888888.00'
    const stats = spendStats({ months, totals })
    expect(stats.avg12).toBe(750)
    expect(stats.total).toBe('888888.00')
  })

  it('has no average to compare against in the first month', () => {
    const stats = spendStats({ months: ['2026-02-01'], totals: ['1400.00'] })
    expect(stats).toEqual({ month: '2026-02-01', total: '1400.00', avg12: null, aboveAvg: null })
  })

  it('calls a month above average only when it is strictly over the mean', () => {
    const months = monthsFrom('2026-01-01', 3)
    // Prior months 100 and 300: the mean is exactly 200.
    expect(spendStats({ months, totals: ['100.00', '300.00', '200.00'] })).toEqual({
      month: '2026-03-01', total: '200.00', avg12: 200, aboveAvg: false,
    })
    expect(spendStats({ months, totals: ['100.00', '300.00', '200.01'] }).aboveAvg).toBe(true)
  })

  it('says nothing at all about a feed with no months', () => {
    expect(spendStats({ months: [], totals: [] })).toEqual({
      month: null, total: null, avg12: null, aboveAvg: null,
    })
  })

  // Audit item 14. Before /coverage existed this window counted a not-entered month at
  // full weight (RATIFIED, Task 8 review) because the server could not tell an absence
  // from a real zero. It can now, so the average no longer congratulates the household
  // for a month it never typed.
  it('leaves a not-entered month out of the average entirely', () => {
    const months = monthsFrom('2026-01-01', 4)
    const totals = ['300.00', '0.00', '500.00', '400.00']
    // Untouched, the three priors average 266.67 and April reads as OVER; with February
    // named as not-entered the priors are 300 and 500 — an average of 400, and April is
    // exactly on it.
    expect(spendStats({ months, totals }).avg12).toBeCloseTo(266.667, 3)
    const stats = spendStats({ months, totals }, new Set(['2026-02-01']))
    expect(stats.avg12).toBe(400)
    expect(stats.aboveAvg).toBe(false)
    // The tile month and its own total are untouched — the set only narrows the window.
    expect(stats.month).toBe('2026-04-01')
    expect(stats.total).toBe('400.00')
  })

  it('has no average when every month before the tile is not entered', () => {
    const months = monthsFrom('2026-01-01', 2)
    const stats = spendStats({ months, totals: ['0.00', '400.00'] }, new Set(['2026-01-01']))
    // Not zero: an average of nothing is nothing, and the tile drops its delta.
    expect(stats.avg12).toBeNull()
    expect(stats.aboveAvg).toBeNull()
  })
})

describe('notEnteredMonths', () => {
  const matrix = {
    months: monthsFrom('2026-01-01', 4),
    totals: ['300.00', '0.00', '0.00', '0.00'],
    net_pay: [null, null, '6000.00', null] as (string | null)[],
  }

  it('folds the server’s own not-entered lists together with the net-pay-only months', () => {
    // February: rows saved, every one $0.00, no take-home — production's phantom month.
    // March: take-home on file, spending never typed, so the union of spending and net-pay
    // months puts it in the matrix at "0.00". /coverage cannot name March yet (the wire
    // publishes `spending_empty` and `spending_missing`, not the service's
    // `net_pay_without_spending`), so the matrix's own net-pay row is what names it.
    const found = notEnteredMonths(matrix, coverageOut({ spending_empty: ['2026-02-01'] }))
    expect([...found].sort()).toEqual(['2026-02-01', '2026-03-01'])
  })

  it('carries a missing month through even though the matrix never lists it', () => {
    // `spending_missing` months have no rows at all, so they are not in the matrix — naming
    // them costs nothing and keeps the set the server's definition rather than a subset.
    const found = notEnteredMonths(matrix, coverageOut({ spending_missing: ['2025-12-01'] }))
    expect(found.has('2025-12-01')).toBe(true)
  })

  it('leaves a real zero-spend month alone when no feed calls it absent', () => {
    // April is $0.00 with no take-home row and no coverage list naming it: nothing here
    // says it is an absence, so it stays a figure.
    expect(notEnteredMonths(matrix, coverageOut()).has('2026-04-01')).toBe(false)
    // A month with take-home AND spending is entered, whatever else is true of it.
    const spent = { ...matrix, totals: ['300.00', '0.00', '2000.00', '0.00'] }
    expect(notEnteredMonths(spent, coverageOut()).has('2026-03-01')).toBe(false)
  })

  it('survives a matrix whose net-pay column is short or absent', () => {
    // The Overview's own fixture ships `net_pay: []`; an index past the end is not a row.
    expect(notEnteredMonths({ ...matrix, net_pay: [] }, coverageOut()).size).toBe(0)
  })
})

describe('pickTaxSummary', () => {
  it('prefers the current calendar year when it has a summary', () => {
    const years = [summary(2024), summary(2026), summary(2027)]
    // Identity, not a copy: the tile renders this object's own totals.
    expect(pickTaxSummary(years, 2026)).toBe(years[1])
  })

  it('falls back to the latest PAST year', () => {
    const years = [summary(2023), summary(2024)]
    expect(pickTaxSummary(years, 2026)?.year).toBe(2024)
  })

  it('ignores a future year while a past one exists', () => {
    // A year row exists the moment anything is entered for it, so a forward-planning 2027
    // can sit in the feed with no 2026 beside it — "latest" must not mean "last".
    expect(pickTaxSummary([summary(2023), summary(2027)], 2026)?.year).toBe(2023)
  })

  it('shows a future-only feed rather than nothing', () => {
    // The tile's label carries the year either way, so a 2027-only book reads honestly.
    expect(pickTaxSummary([summary(2027)], 2026)?.year).toBe(2027)
    // Two future years and no past one: the fallback is years[years.length - 1], the LATEST
    // future year — not the nearest one. Planning forward, the newest projection is the live
    // one, and the label's "(planned)" suffix says which year is on screen.
    expect(pickTaxSummary([summary(2027), summary(2028)], 2026)?.year).toBe(2028)
  })

  it('returns null when no year has been touched yet', () => {
    expect(pickTaxSummary([], 2026)).toBeNull()
  })
})

// 2026-09-23 spec §C5: the month in progress (its last day still ahead of today) is drawn as
// partial: hatched under Appearance › Chart patterns, faded otherwise, a dashed outline both
// ways. Its label carries the mark and its tooltip head says so. The average leaves it out,
// exactly as before.
describe('recentSpendOption: the month in progress (2026-09-23 spec §C5)', () => {
  const feed = { months: monthsFrom('2026-07-01', 3), totals: ['4000.00', '4200.00', '2072.23'] }
  const today = '2026-09-23'
  const labelOf = (option: EChartsOption | null) =>
    (option as unknown as { xAxis: { axisLabel: { formatter: (value: string, index: number) => string } } }).xAxis
      .axisLabel.formatter
  const headOf = (option: EChartsOption | null, label: string, dataIndex: number, value: number) =>
    tooltipRows(
      tooltipOf(option).formatter([
        { seriesName: 'Spend', seriesType: 'bar', axisValueLabel: label, dataIndex, value, color: MUTED },
      ]),
    ).head

  it('fades the month under way behind a dashed outline, and hatches it under Chart patterns', () => {
    expect(seriesOf(recentSpendOption(feed, 12, undefined, { todayIso: today }))[0].data).toEqual([
      4000,
      4200,
      { value: 2072.23, itemStyle: { borderColor: MUTED, borderWidth: 1, borderType: 'dashed', color: `${MUTED}73` } },
    ])
    expect(seriesOf(recentSpendOption(feed, 12, undefined, { todayIso: today, patterns: true }))[0].data?.[2]).toEqual({
      value: 2072.23,
      itemStyle: partialItemStyle(MUTED, true),
    })
  })

  it('draws a finished month plainly: on its last day, and whenever no today is given', () => {
    expect(seriesOf(recentSpendOption(feed, 12, undefined, { todayIso: '2026-09-30' }))[0].data).toEqual([4000, 4200, 2072.23])
    expect(seriesOf(recentSpendOption(feed))[0].data).toEqual([4000, 4200, 2072.23])
    expect(labelOf(recentSpendOption(feed))('Sep 2026', 2)).toBe('Sep 2026')
  })

  it('marks its axis label and says so in the tooltip head', () => {
    const option = recentSpendOption(feed, 12, undefined, { todayIso: today })
    expect(labelOf(option)('Sep 2026', 2)).toBe('Sep 2026*')
    expect(labelOf(option)('Aug 2026', 1)).toBe('Aug 2026')
    expect(headOf(option, 'Sep 2026', 2, 2072.23)).toBe('Sep 2026 — month to date (in progress)')
    expect(headOf(option, 'Aug 2026', 1, 4200)).toBe('Aug 2026')
    // A draft entered ahead of time is in progress too, and says which kind.
    const draft = { months: monthsFrom('2026-08-01', 3), totals: ['4200.00', '2072.23', '310.00'] }
    expect(headOf(recentSpendOption(draft, 12, undefined, { todayIso: today }), 'Oct 2026', 2, 310)).toBe(
      'Oct 2026 — future month (in progress)',
    )
  })

  it('keeps the average line exactly where it was', () => {
    const noted = seriesOf(recentSpendOption(feed, 12, undefined, { todayIso: today }))
    expect(noted[1].data).toEqual(seriesOf(recentSpendOption(feed))[1].data)
  })

  it('keeps a month nobody entered hollow while it is under way, its label marked all the same', () => {
    const empty = { months: feed.months, totals: ['4000.00', '4200.00', '0.00'] }
    const option = recentSpendOption(empty, 12, new Set(['2026-09-01']), { todayIso: today })
    expect(seriesOf(option)[0].data?.[2]).toEqual({
      value: 0,
      itemStyle: { color: 'transparent', borderColor: MUTED, borderWidth: 1.5 },
    })
    expect(axisDataOf(option)[2]).toEqual({ value: 'Sep 2026', textStyle: { color: OTHER_SERIES_COLOR } })
    expect(labelOf(option)('Sep 2026', 2)).toBe('Sep 2026*')
  })
})
