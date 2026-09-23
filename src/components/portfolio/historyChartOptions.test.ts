import { describe, expect, it } from 'vitest'
import type { EChartsOption } from '../../charts/echarts'
import type { PortfolioHistory } from '../../types/api'
import { GRID_VARIANTS, compactMoney } from '../../charts/grammar'
import { INK, MUTED, OTHER_SERIES_COLOR, PALETTE } from '../../charts/theme'
import { isGrammarTooltip } from '../../charts/tooltip'
import { tooltipRows } from '../../testing/tooltipRows'
import { addDays } from '../../utils/months'
import {
  liveFromHoldings,
  portfolioHistoryCsv,
  portfolioHistoryOption,
  STARTING_BALANCE_SERIES,
  weeklyLabelCapacity,
} from './historyChartOptions'
import { BUYS_SERIES, DIVIDENDS_SERIES, EXDIV_SERIES } from './performanceEvents'
import type { PerformanceEvents } from './performanceEvents'

// Wire shape of GET /portfolio/history — Decimal strings, parallel arrays.
function history(over: Partial<PortfolioHistory> = {}): PortfolioHistory {
  return {
    dates: ['2026-07-27', '2026-08-03', '2026-08-10'],
    market_value: ['700000.00', '710000.50', '718422.07'],
    cost_basis: ['395000.00', '399542.36', '400243.74'],
    sp500: ['96000.00', '97000.00', '98636.70'],
    benchmark: ['96000.00', '97250.00', '99001.13'],
    ...over,
  }
}

const EMPTY: PortfolioHistory = {
  dates: [],
  market_value: [],
  cost_basis: [],
  sp500: [],
  benchmark: [],
}

// Module-level: both the Events describe below and the grammar describe above it read
// these, and a const declared inside one describe is not in scope for the other.
const EVENT_POINTS = [
  {
    value: ['Aug 3, 2026', 710000.5] as [string, number],
    symbol: 'triangle' as const,
    symbolRotate: 0,
    events: [{ text: 'Buy NVDA — 10 sh · Aug 4, 2026' }],
  },
]
// The performance chart's events, one kind per series (2026-09-23 spec §C8): a buy on the
// line, and one rug tick of each dividend kind on the plot's floor.
const EVENTS: PerformanceEvents = {
  buys: EVENT_POINTS,
  sells: [],
  dividends: [
    { value: ['Aug 10, 2026', 0], events: [{ text: 'Dividend VOO — $12.00 · Aug 9, 2026' }] },
  ],
  exDividends: [
    { value: ['Jul 27, 2026', 0], events: [{ text: 'Ex-dividend VOO — $1.71/sh · Jul 28, 2026' }] },
  ],
}
const NO_EVENTS: PerformanceEvents = { buys: [], sells: [], dividends: [], exDividends: [] }

// --- option readers (allocationChartOptions.test.ts posture) ---------------------------
interface SeriesLike {
  type?: string
  name?: string
  color?: string
  data?: unknown[]
  areaStyle?: { opacity?: number }
  rippleEffect?: unknown
  markLine?: { data?: unknown[]; lineStyle?: { type?: string } }
}

function seriesOf(option: EChartsOption): SeriesLike[] {
  return (option as unknown as { series: SeriesLike[] }).series
}

function categoriesOf(option: EChartsOption): string[] {
  return (option as unknown as { xAxis: { data: string[] } }).xAxis.data
}

describe('portfolioHistoryOption', () => {
  it('returns null under two imported points, live or not', () => {
    expect(portfolioHistoryOption(EMPTY, null)).toBeNull()
    expect(
      portfolioHistoryOption(
        history({
          dates: ['2026-08-10'],
          market_value: ['1.00'],
          cost_basis: ['1.00'],
          sp500: ['1.00'],
          benchmark: ['1.00'],
        }),
        { date: '2026-08-14', value: 2 },
      ),
    ).toBeNull()
  })

  it('draws the four lines under their honest names, in fixed palette slots, with a wash under value only', () => {
    const option = portfolioHistoryOption(history(), null)
    expect(option).not.toBeNull()
    const series = seriesOf(option!)
    // 2026-09-23 spec §C8: the fair comparison sits beside value and cost under a name that
    // says what it is; the starting-balance line comes last, named for what it leaves out.
    expect(series.map((s) => s.name)).toEqual([
      'Portfolio value',
      'Cost basis',
      'Same deposits in VOO',
      'S&P 500 — starting balance only',
    ])
    // Colours stay with the ENTITY, not the position.
    expect(series.map((s) => s.color)).toEqual([PALETTE[0], PALETTE[1], PALETTE[3], PALETTE[2]])
    expect(series[0].areaStyle?.opacity).toBeGreaterThan(0)
    // No wash anywhere else — the wash rides the value line only (spec §4).
    expect(series.slice(1).every((s) => s.areaStyle === undefined)).toBe(true)
    // Number() at the boundary, once
    expect(series[0].data).toEqual([700000, 710000.5, 718422.07])
    expect(series[2].data).toEqual([96000, 97250, 99001.13])
    expect(series[3].data).toEqual([96000, 97000, 98636.7])
    expect(categoriesOf(option!)).toEqual(['Jul 27, 2026', 'Aug 3, 2026', 'Aug 10, 2026'])
  })

  it('lists the starting-balance line legend-off by default, and omits it on request (2026-09-23 §C8)', () => {
    const legend = (option: unknown) =>
      (option as { legend: { selected?: Record<string, boolean> } }).legend
    expect(legend(portfolioHistoryOption(history(), null)).selected).toEqual({
      [STARTING_BALANCE_SERIES]: false,
    })
    // The page's own pick wins — a reader who switched it on keeps it on.
    expect(
      legend(
        portfolioHistoryOption(history(), null, null, {
          selected: { [STARTING_BALANCE_SERIES]: true },
        }),
      ).selected,
    ).toEqual({ [STARTING_BALANCE_SERIES]: true })
    // Off must LOOK off in both themes: echarts' default inactive #ccc reads brighter than an
    // active label on the dark card, and the line now starts hidden on every visit.
    expect(
      (portfolioHistoryOption(history(), null) as unknown as { legend: { inactiveColor?: string } })
        .legend.inactiveColor,
    ).toBe(OTHER_SERIES_COLOR)
    // The Overview card does not draw it at all (shell F5).
    const overview = portfolioHistoryOption(history(), null, null, { startingBalance: 'omit' })!
    expect(seriesOf(overview).map((s) => s.name)).toEqual([
      'Portfolio value',
      'Cost basis',
      'Same deposits in VOO',
    ])
    expect(legend(overview).selected).toBeUndefined()
  })

  it('appends a pinging live category with a dashed connector when the quote is newer', () => {
    const option = portfolioHistoryOption(history(), { date: '2026-08-14', value: 723456.78 })
    expect(categoriesOf(option!)).toEqual([
      'Jul 27, 2026',
      'Aug 3, 2026',
      'Aug 10, 2026',
      'Aug 14, 2026',
    ])
    const series = seriesOf(option!)
    expect(series).toHaveLength(5)
    // Lines end at the last IMPORTED point — the live category is never extrapolated.
    expect(series[0].data).toEqual([700000, 710000.5, 718422.07, null])
    expect(series[1].data).toEqual([395000, 399542.36, 400243.74, null])
    expect(series[2].data).toEqual([96000, 97250, 99001.13, null])
    expect(series[3].data).toEqual([96000, 97000, 98636.7, null])
    const live = series[4]
    expect(live.type).toBe('effectScatter')
    expect(live.name).toBe('Live')
    expect(live.color).toBe(PALETTE[0]) // same entity as the value line; the ripple says "live"
    expect(live.rippleEffect).toBeTruthy()
    expect(live.data).toEqual([['Aug 14, 2026', 723456.78]])
    expect(live.markLine?.lineStyle?.type).toBe('dashed')
    expect(live.markLine?.data).toEqual([
      [{ coord: ['Aug 10, 2026', 718422.07] }, { coord: ['Aug 14, 2026', 723456.78] }],
    ])
  })

  it('parks a same-day quote on the last category without a connector', () => {
    const option = portfolioHistoryOption(history(), { date: '2026-08-10', value: 720000 })
    expect(categoriesOf(option!)).toEqual(['Jul 27, 2026', 'Aug 3, 2026', 'Aug 10, 2026'])
    const series = seriesOf(option!)
    expect(series).toHaveLength(5)
    expect(series[0].data).toEqual([700000, 710000.5, 718422.07]) // no null padding
    expect(series[2].data).toEqual([96000, 97250, 99001.13])
    expect(series[4].data).toEqual([['Aug 10, 2026', 720000]])
    expect(series[4].markLine).toBeUndefined()
  })

  it('self-retires the live point when the quote predates the series or is unusable', () => {
    expect(
      seriesOf(portfolioHistoryOption(history(), { date: '2026-08-01', value: 1 })!),
    ).toHaveLength(4)
    expect(
      seriesOf(portfolioHistoryOption(history(), { date: '2026-08-14', value: Number.NaN })!),
    ).toHaveLength(4)
    expect(seriesOf(portfolioHistoryOption(history(), null)!)).toHaveLength(4)
  })

  it('omits the benchmark series when the payload lacks the field or carries only nulls', () => {
    // Stale-tab payload: cached from the pre-benchmark API the field is absent at
    // runtime even though the type now requires it — hence the cast.
    const legacy = {
      dates: ['2026-07-27', '2026-08-03', '2026-08-10'],
      market_value: ['700000.00', '710000.50', '718422.07'],
      cost_basis: ['395000.00', '399542.36', '400243.74'],
      sp500: ['96000.00', '97000.00', '98636.70'],
    } as PortfolioHistory
    expect(seriesOf(portfolioHistoryOption(legacy, null)!).map((s) => s.name)).toEqual([
      'Portfolio value',
      'Cost basis',
      'S&P 500 — starting balance only',
    ])
    // The server's no-VOO-bars degradation: all-null. An all-null line would draw
    // nothing yet still ghost-occupy the legend, so the series is omitted outright.
    expect(
      seriesOf(portfolioHistoryOption(history({ benchmark: [null, null, null] }), null)!).map(
        (s) => s.name,
      ),
    ).toEqual(['Portfolio value', 'Cost basis', 'S&P 500 — starting balance only'])
  })
})

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

  it('wears the money grid, compact ticks, month-start labels and a plain legend with the page picks', () => {
    const option = read(
      portfolioHistoryOption(history(), null, null, { selected: { 'Cost basis': false } }),
    )
    expect(option.grid).toEqual(GRID_VARIANTS.default)
    expect(option.xAxis.boundaryGap).toBe(false)
    expect(option.yAxis.axisLabel.formatter).toBe(compactMoney)
    expect(option.legend.type).toBe('plain')
    // The page's picks ride on top of the starting-balance line's legend-off default.
    expect(option.legend.selected).toEqual({
      [STARTING_BALANCE_SERIES]: false,
      'Cost basis': false,
    })
    expect(option.series[0].emphasis).toEqual({ focus: 'series' })
  })

  it('F7: value rows in series order, null rows dropped, events expand into escaped lines with a count', () => {
    const option = read(portfolioHistoryOption(history(), null, EVENTS))
    expect(isGrammarTooltip(option.tooltip.formatter)).toBe(true)
    expect(option.tooltip.axisPointer).toBeUndefined()
    const parsed = tooltipRows(
      option.tooltip.formatter([
        {
          seriesName: 'Portfolio value', seriesType: 'line', axisValueLabel: 'Aug 3, 2026',
          value: 710000.5, color: PALETTE[0],
        },
        { seriesName: 'Cost basis', seriesType: 'line', value: null, color: PALETTE[1] },
        {
          seriesName: BUYS_SERIES, seriesType: 'scatter', value: ['Aug 3, 2026', 710000.5],
          color: MUTED,
          data: {
            events: [
              { text: 'Buy <X> — 10 sh · Aug 4, 2026' },
              { text: 'Dividend VOO — $12.00 · Aug 5, 2026' },
            ],
          },
        },
      ]),
    )
    expect(parsed.head).toBe('Aug 3, 2026')
    expect(parsed.rows.map((r) => [r.label, r.value])).toEqual([
      ['Portfolio value', '$710,000.50'],
    ])
    expect(parsed.notes).toEqual([
      '<strong>2 events</strong>',
      'Buy &lt;X&gt; — 10 sh · Aug 4, 2026',
      'Dividend VOO — $12.00 · Aug 5, 2026',
    ])
  })
})

describe('the weekly axis (2026-09-23 spec §C4, §C8, review round 1)', () => {
  type Axis = {
    data: string[]
    boundaryGap?: boolean
    axisLabel: { customValues: number[]; formatter: (value: string) => string; hideOverlap: boolean }
  }
  const axisOf = (option: EChartsOption | null) => option!.xAxis as unknown as Axis
  // What echarts draws: the custom values inside the window it shows, through the formatter.
  const shown = (axis: Axis, from = 0, to = axis.data.length - 1) =>
    axis.axisLabel.customValues
      .filter((i) => i >= from && i <= to)
      .map((i) => axis.axisLabel.formatter(axis.data[i]))
  // `weeks` Mondays from `first`, every leg level.
  const mondays = (first: string, weeks: number) => {
    const dates = Array.from({ length: weeks }, (_, i) => addDays(first, 7 * i))
    const flat = dates.map(() => '1.00')
    return history({ dates, market_value: flat, cost_basis: flat, sp500: flat, benchmark: flat })
  }

  it('labels where a month begins, as "Mmm YYYY"; the category keeps the exact day', () => {
    // Fifteen weeks from Jul 6, 2026 — four month starts on the whole series.
    const axis = axisOf(portfolioHistoryOption(mondays('2026-07-06', 15), null))
    // The tooltip header reads the category, so the checkpoint's day stays there.
    expect(axis.data.slice(0, 2)).toEqual(['Jul 6, 2026', 'Jul 13, 2026'])
    expect(axis.boundaryGap).toBe(false)
    // Never an arbitrary Monday ("Oct 23, 2023 · Jan 22, 2024 …" at a 3-year zoom — charts F6).
    expect(shown(axis)).toEqual(['Jul 2026', 'Aug 2026', 'Sep 2026', 'Oct 2026'])
    // The last guard on a narrow card: labels that would still touch are dropped, not smeared.
    expect(axis.axisLabel.hideOverlap).toBe(true)
  })

  it('picks its stride from the window it shows — never a lone "Jan" in a year', () => {
    // finance_realdata's shape: 153 Mondays from Oct 23, 2023 to Sep 21, 2026.
    const real = mondays('2023-10-23', 153)
    const all = axisOf(portfolioHistoryOption(real, null, null, { range: { preset: 'all' } }))
    expect(shown(all)).toEqual([
      'Oct 2023', 'Jan 2024', 'Apr 2024', 'Jul 2024', 'Oct 2024', 'Jan 2025', 'Apr 2025',
      'Jul 2025', 'Oct 2025', 'Jan 2026', 'Apr 2026', 'Jul 2026',
    ])
    // 1Y opens on Sep 22, 2025: every month start in it.
    const year = axisOf(portfolioHistoryOption(real, null, null, { range: { preset: '1y' } }))
    const yearStart = real.dates.indexOf('2025-09-22')
    expect(shown(year, yearStart)).toEqual([
      'Oct 2025', 'Nov 2025', 'Dec 2025', 'Jan 2026', 'Feb 2026', 'Mar 2026', 'Apr 2026',
      'May 2026', 'Jun 2026', 'Jul 2026', 'Aug 2026', 'Sep 2026',
    ])
    const ytd = axisOf(portfolioHistoryOption(real, null, null, { range: { preset: 'ytd' } }))
    expect(shown(ytd, real.dates.indexOf('2026-01-05'))).toHaveLength(9)
    // The Overview card passes no range: the whole series.
    expect(shown(axisOf(portfolioHistoryOption(real, null)))).toEqual(shown(all))
    // A decade: Januaries.
    const decade = axisOf(portfolioHistoryOption(mondays('2016-01-04', 530), null))
    expect(shown(decade)).toEqual([
      'Jan 2016', 'Jan 2017', 'Jan 2018', 'Jan 2019', 'Jan 2020', 'Jan 2021', 'Jan 2022',
      'Jan 2023', 'Jan 2024', 'Jan 2025', 'Jan 2026',
    ])
  })

  // Code review 5: how many labels a window takes depends on the plot's WIDTH. At an 800px chart a
  // year of months put four-week months 59px apart — closer than a label — and hideOverlap dropped
  // every other one: gaps of one month, then two.
  it('takes as many labels as the chart is wide enough for, evenly', () => {
    expect(weeklyLabelCapacity(800)).toBe(9) // a 706px plot, a label every 72px
    expect(weeklyLabelCapacity(1230)).toBe(15)
    expect(weeklyLabelCapacity(200)).toBe(3) // never under three
    const real = mondays('2023-10-23', 153)
    const yearStart = real.dates.indexOf('2025-09-22')
    const narrow = axisOf(
      portfolioHistoryOption(real, null, null, { range: { preset: '1y' }, labels: weeklyLabelCapacity(800) }),
    )
    // Every other month, Jan-aligned — even gaps, and all of them fit.
    expect(shown(narrow, yearStart)).toEqual([
      'Nov 2025', 'Jan 2026', 'Mar 2026', 'May 2026', 'Jul 2026', 'Sep 2026',
    ])
    const wide = axisOf(
      portfolioHistoryOption(real, null, null, { range: { preset: '1y' }, labels: weeklyLabelCapacity(1230) }),
    )
    expect(shown(wide, yearStart)).toHaveLength(12)
    // The whole series on a half-width card: half-years.
    const half = axisOf(portfolioHistoryOption(real, null, null, { labels: weeklyLabelCapacity(630) }))
    expect(shown(half)).toEqual(['Jan 2024', 'Jul 2024', 'Jan 2025', 'Jul 2025', 'Jan 2026', 'Jul 2026'])
  })

  it('labels every checkpoint in a window holding fewer than three month starts', () => {
    // Year to date on Feb 16: two month starts, so the weeks carry the axis — at least three.
    const early = mondays('2025-10-06', 20)
    const ytd = axisOf(portfolioHistoryOption(early, null, null, { range: { preset: 'ytd' } }))
    const start = early.dates.indexOf('2026-01-05')
    expect(shown(ytd, start)).toEqual([
      'Jan 2026', 'Jan 12', 'Jan 19', 'Jan 26', 'Feb 2026', 'Feb 9', 'Feb 16',
    ])
    // A ctrl+wheel window between two quarter starts still reads.
    const real = mondays('2023-10-23', 153)
    const from = real.dates.indexOf('2025-02-03')
    const to = real.dates.indexOf('2025-03-17')
    const zoomed = axisOf(
      portfolioHistoryOption(real, null, null, {
        range: { preset: 'all', window: { startValue: from, endValue: to } },
      }),
    )
    expect(shown(zoomed, from, to).length).toBeGreaterThanOrEqual(3)
  })

  it('labels the live category when the quote opens a new month', () => {
    const axis = axisOf(portfolioHistoryOption(mondays('2026-06-01', 13), { date: '2026-09-01', value: 720000 }))
    expect(axis.data.at(-1)).toBe('Sep 1, 2026')
    expect(shown(axis)).toEqual(['Jun 2026', 'Jul 2026', 'Aug 2026', 'Sep 2026'])
  })
})

describe('liveFromHoldings', () => {
  it('slices the bar date off the NEWEST quote and parses the market value once', () => {
    expect(
      liveFromHoldings({
        latest_quote_at: '2026-08-14T00:00:00Z',
        totals: { market_value: '723456.78' },
      }),
    ).toEqual({ date: '2026-08-14', value: 723456.78 })
  })

  it('is null before the first price refresh', () => {
    expect(liveFromHoldings({ latest_quote_at: null, totals: { market_value: '0.00' } })).toBeNull()
  })
})

describe('portfolioHistoryOption with events (2026-09-23 spec §C8)', () => {
  type EventSeries = SeriesLike & { symbol?: string; symbolSize?: unknown; z?: number }

  it('names one legend entry per kind; the rug is thin rects on the floor, the ledger on top', () => {
    const option = portfolioHistoryOption(history(), null, EVENTS)
    const series = seriesOf(option!) as EventSeries[]
    expect(series.map((s) => s.name)).toEqual([
      'Portfolio value', 'Cost basis', 'Same deposits in VOO', 'S&P 500 — starting balance only',
      BUYS_SERIES, DIVIDENDS_SERIES, EXDIV_SERIES,
    ])
    const byName = new Map(series.map((s) => [s.name, s]))
    // Buys ride the line as before — an annotation, not a data hue; the ripple stays the
    // live ping's.
    expect(byName.get(BUYS_SERIES)).toMatchObject({ type: 'scatter', color: MUTED, z: 11 })
    expect(byName.get(BUYS_SERIES)!.data).toBe(EVENTS.buys)
    // The rug: 2px × 10px ticks at y 0, in neutral tones by kind — no money-entity colour
    // can collide with them inside this chart. The ledger's ticks draw over the notices'.
    expect(byName.get(DIVIDENDS_SERIES)).toMatchObject({
      type: 'scatter', color: INK, symbol: 'rect', symbolSize: [2, 10], z: 13,
    })
    expect(byName.get(DIVIDENDS_SERIES)!.data).toBe(EVENTS.dividends)
    // Code review 6: the provider's notices differ from the ledger's ticks by SHAPE as well as tone
    // — a dot on the floor — so the two kinds never rest on colour alone.
    expect(byName.get(EXDIV_SERIES)).toMatchObject({
      type: 'scatter', color: MUTED, symbol: 'circle', symbolSize: 6, z: 12,
    })
    expect(byName.get(EXDIV_SERIES)!.data).toBe(EVENTS.exDividends)
    // Every kind is on by default and toggles from its own legend entry.
    const legend = (option as unknown as {
      legend: { selected?: unknown; data?: (string | { name: string; icon?: string })[] }
    }).legend
    expect(legend.selected).toEqual({ [STARTING_BALANCE_SERIES]: false })
    // …and each rug entry's legend icon is its mark: a tick, a dot. The rest keep the house icon.
    expect(legend.data).toEqual([
      'Portfolio value', 'Cost basis', 'Same deposits in VOO', 'S&P 500 — starting balance only',
      BUYS_SERIES,
      { name: DIVIDENDS_SERIES, icon: 'path://M4 0h2v10h-2z' },
      { name: EXDIV_SERIES, icon: 'circle' },
    ])
  })

  it('lists a rug tick\'s events in the tooltip, never a y value', () => {
    const format = (
      portfolioHistoryOption(history(), null, EVENTS) as unknown as {
        tooltip: { formatter: (p: unknown) => string }
      }
    ).tooltip.formatter
    const parsed = tooltipRows(
      format([
        {
          seriesName: 'Portfolio value', seriesType: 'line', axisValueLabel: 'Aug 10, 2026',
          value: 718422.07, color: PALETTE[0],
        },
        {
          seriesName: DIVIDENDS_SERIES, seriesType: 'scatter', value: ['Aug 10, 2026', 0],
          color: INK, data: EVENTS.dividends[0],
        },
      ]),
    )
    expect(parsed.rows.map((r) => r.label)).toEqual(['Portfolio value'])
    expect(parsed.notes).toEqual(['Dividend VOO — $12.00 · Aug 9, 2026'])
  })

  it('draws no event series for an empty set or none at all (Overview keeps the short call)', () => {
    expect(seriesOf(portfolioHistoryOption(history(), null, NO_EVENTS)!)).toHaveLength(4)
    expect(seriesOf(portfolioHistoryOption(history(), null)!)).toHaveLength(4)
  })
})

describe('portfolioHistoryCsv', () => {
  // Review round 1: a reader's spreadsheet reads these columns by position, so each series keeps
  // the column it has always had — the starting balance fourth, the VOO leg fifth — under its
  // honest name (2026-09-23 spec §C8 renamed them; it did not move them).
  it('lays out date rows × the four series in their long-standing columns, verbatim strings', () => {
    expect(portfolioHistoryCsv(history())).toEqual({
      headers: [
        'Date', 'Portfolio value', 'Cost basis', 'S&P 500 — starting balance only',
        'Same deposits in VOO',
      ],
      rows: [
        ['2026-07-27', '700000.00', '395000.00', '96000.00', '96000.00'],
        ['2026-08-03', '710000.50', '399542.36', '97000.00', '97250.00'],
        ['2026-08-10', '718422.07', '400243.74', '98636.70', '99001.13'],
      ],
    })
  })

  it('drops the starting-balance column where the chart does not draw it (the Overview card)', () => {
    const table = portfolioHistoryCsv(history(), { startingBalance: 'omit' })
    expect(table.headers).toEqual(['Date', 'Portfolio value', 'Cost basis', 'Same deposits in VOO'])
    expect(table.rows[2]).toEqual(['2026-08-10', '718422.07', '400243.74', '99001.13'])
  })

  it('empties the VOO cells on a degraded or stale-payload benchmark', () => {
    const rows = portfolioHistoryCsv(history({ benchmark: [null, null, null] })).rows
    expect(rows.map((r) => r[4])).toEqual(['', '', ''])
  })
})
