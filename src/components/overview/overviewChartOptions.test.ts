import { describe, expect, it } from 'vitest'
import type { EChartsOption } from '../../charts/echarts'
import { PALETTE, SURFACE } from '../../charts/theme'
import type { TaxSummaryOut } from '../../types/api'
import {
  netWorthTrendOption,
  pickTaxSummary,
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
  color?: string
  symbol?: string
  barMaxWidth?: number
  itemStyle?: { borderColor?: string; borderWidth?: number }
  areaStyle?: { opacity?: number }
  data?: unknown[]
}

function seriesOf(option: EChartsOption | null): SeriesLike[] {
  expect(option).not.toBeNull()
  return (option as unknown as { series: SeriesLike[] }).series
}

function categoriesOf(option: EChartsOption | null): string[] {
  return (option as unknown as { xAxis: { data: string[] } }).xAxis.data
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

function valueFormatterOf(option: EChartsOption | null): (v: number) => string {
  return (option as unknown as { tooltip: { valueFormatter: (v: number) => string } }).tooltip
    .valueFormatter
}

function tooltipOf(option: EChartsOption | null): {
  trigger?: string
  axisPointer?: { type?: string }
} {
  return (option as unknown as { tooltip: { trigger?: string; axisPointer?: { type?: string } } })
    .tooltip
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
    expect(valueFormatterOf(option)(1234.5)).toBe('$1,234.50')
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
  it('bars the months in palette slot 2, hairlined against the card', () => {
    const option = recentSpendOption({ months: monthsFrom('2026-01-01', 3), totals: totalsFrom(3) })
    const [bars] = seriesOf(option)
    expect(bars.type).toBe('bar')
    expect(bars.color).toBe(PALETTE[1])
    // Single-series chart — there are no stacked neighbours here to separate. The
    // surface-colored 1px border is an inset that keeps this chart reading as one family
    // with SpendingPage's stacked bars (there the same border divides segments).
    expect(bars.itemStyle?.borderColor).toBe(SURFACE)
    expect(bars.itemStyle?.borderWidth).toBe(1)
    // A dozen months across a full-width card would otherwise stretch into blocks.
    expect(bars.barMaxWidth).toBe(22)
    expect(bars.data).toEqual([100, 200, 300])
    expect(categoriesOf(option)).toEqual(['Jan 2026', 'Feb 2026', 'Mar 2026'])
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

  it('formats the axis compactly and the tooltip in full, and empties to null', () => {
    const option = recentSpendOption({ months: monthsFrom('2026-01-01', 2), totals: totalsFrom(2) })
    // Compact ticks, exact tooltip: the axis is a scale, the tooltip is a figure.
    expect(yAxisOf(option).axisLabel?.formatter?.(1500)).toBe('$1.5K')
    expect(valueFormatterOf(option)(1234.5)).toBe('$1,234.50')
    // Labeled axes, so echarts' default pointer rule points at something and stays —
    // the same posture the net-worth trend now wears.
    expect(tooltipOf(option).axisPointer).toBeUndefined()
    expect(recentSpendOption({ months: [], totals: [] })).toBeNull()
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
