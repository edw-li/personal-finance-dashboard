import { describe, expect, it } from 'vitest'
import type { EChartsOption } from '../../charts/echarts'
import type {
  DividendEventOut,
  DividendOut,
  PortfolioHistory,
  TransactionOut,
} from '../../types/api'
import { GRID_VARIANTS, compactMoney } from '../../charts/grammar'
import { INK, MUTED, OTHER_SERIES_COLOR, PALETTE } from '../../charts/theme'
import { isGrammarTooltip } from '../../charts/tooltip'
import { tooltipRows } from '../../testing/tooltipRows'
import { addDays } from '../../utils/months'
import {
  BUYS_SERIES,
  buildEventMarkers,
  buildPerformanceEvents,
  DIVIDENDS_SERIES,
  EXDIV_SERIES,
  liveFromHoldings,
  portfolioHistoryCsv,
  portfolioHistoryOption,
  STARTING_BALANCE_SERIES,
  benchmarkLede,
  benchmarkLedeText,
  performanceLede,
} from './historyChartOptions'
import type { PerformanceEvents } from './historyChartOptions'

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

describe('the weekly axis (2026-09-23 spec §C4, §C8)', () => {
  type Axis = {
    data: string[]
    boundaryGap?: boolean
    axisLabel: {
      interval: (index: number, value: string) => boolean
      formatter: (value: string) => string
      hideOverlap: boolean
    }
  }
  const shown = (axis: Axis) =>
    axis.data.filter((value, i) => axis.axisLabel.interval(i, value)).map((value) => axis.axisLabel.formatter(value))

  it('labels only where a month begins, as "Mmm YYYY"; the category keeps the exact day', () => {
    const axis = portfolioHistoryOption(history(), null)!.xAxis as unknown as Axis
    // The tooltip header reads the category, so the checkpoint's day stays there.
    expect(axis.data).toEqual(['Jul 27, 2026', 'Aug 3, 2026', 'Aug 10, 2026'])
    expect(axis.boundaryGap).toBe(false)
    // Never an arbitrary Monday ("Oct 23, 2023 · Jan 22, 2024 …" at a 3-year zoom — charts F6).
    expect(shown(axis)).toEqual(['Jul 2026', 'Aug 2026'])
    expect(axis.axisLabel.formatter('Aug 10, 2026')).toBe('')
    // The last guard on a narrow card: labels that would still touch are dropped, not smeared.
    expect(axis.axisLabel.hideOverlap).toBe(true)
  })

  it('steps to quarter starts past a year of history', () => {
    // 70 Mondays from Jan 6, 2025: seventeen months.
    const dates = Array.from({ length: 70 }, (_, i) => addDays('2025-01-06', 7 * i))
    const long = history({
      dates,
      market_value: dates.map(() => '1.00'),
      cost_basis: dates.map(() => '1.00'),
      sp500: dates.map(() => '1.00'),
      benchmark: dates.map(() => '1.00'),
    })
    expect(shown(portfolioHistoryOption(long, null)!.xAxis as unknown as Axis)).toEqual([
      'Jan 2025', 'Apr 2025', 'Jul 2025', 'Oct 2025', 'Jan 2026', 'Apr 2026',
    ])
  })

  it('labels the live category when the quote opens a new month', () => {
    const axis = portfolioHistoryOption(history(), { date: '2026-09-01', value: 720000 })!
      .xAxis as unknown as Axis
    expect(axis.data.at(-1)).toBe('Sep 1, 2026')
    expect(shown(axis)).toEqual(['Jul 2026', 'Aug 2026', 'Sep 2026'])
  })
})

describe('the benchmark lede (2026-09-23 spec §C8, review round 1)', () => {
  // Three checkpoints where every leg is easy to follow. The starting-balance leg S0 takes no
  // deposits, so its ratio is VOO's own growth: ×1.1 to June, ×1.2 from June to January. The VOO
  // leg B starts level with the portfolio and takes the same $10 deposit in the second stretch:
  // 120 × 1.2 + 10 = 154. The portfolio V does exactly as well from June on: 150 × 1.2 + 10 = 190.
  const legs = (over: Partial<PortfolioHistory> = {}) =>
    history({
      dates: ['2025-01-06', '2025-06-02', '2026-01-05'],
      market_value: ['100.00', '150.00', '190.00'],
      cost_basis: ['100.00', '100.00', '110.00'],
      sp500: ['100.00', '110.00', '132.00'],
      benchmark: ['100.00', '120.00', '154.00'],
      ...over,
    })

  it('over a range, compares the same money: the opening lead grows at VOO’s rate before the gap is taken', () => {
    // Already $30 ahead in June and matching VOO since: $0 of outperformance over the range. The
    // change in the lead ((190 − 150) − (154 − 120) = $6) would have credited VOO's own growth on
    // the $30 lead to the portfolio.
    expect(benchmarkLede(legs(), 1, 2)).toEqual({ direction: 'level', amount: 0 })
    // $10 short of that: behind by $10.
    expect(benchmarkLede(legs({ market_value: ['100.00', '150.00', '180.00'] }), 1, 2)).toEqual({
      direction: 'behind',
      amount: 10,
    })
    // …and $5 better: ahead by $5.
    expect(benchmarkLede(legs({ market_value: ['100.00', '150.00', '195.00'] }), 1, 2)).toEqual({
      direction: 'ahead',
      amount: 5,
    })
  })

  it('over the whole history, is the gap to the same deposits in VOO — both legs start level', () => {
    // finance_realdata, Oct 23, 2023 → Sep 21, 2026: 53,619.00 → 848,870.10, against the same
    // deposits in VOO 53,619.00 → 585,187.87 — the household is $263,682.23 ahead.
    const real = history({
      dates: ['2023-10-23', '2026-09-21'],
      market_value: ['53619.00', '848870.10'],
      cost_basis: ['53619.00', '512413.42'],
      sp500: ['53619.00', '98583.76'],
      benchmark: ['53619.00', '585187.87'],
    })
    expect(benchmarkLede(real)).toEqual({ direction: 'ahead', amount: 263682.23 })
    expect(benchmarkLedeText(benchmarkLede(real)!)).toEqual({
      text: 'Ahead of the same deposits in VOO by',
      amount: '$263.7K',
    })
    // A zero opening lead has nothing to rebase: the sentence stands without VOO's ratio.
    expect(benchmarkLede(legs({ sp500: ['0.00', '0.00', '0.00'] }))).toEqual({
      direction: 'ahead',
      amount: 36,
    })
  })

  it('says nothing when VOO’s growth cannot be formed for a lead that needs it — absent is not zero', () => {
    expect(benchmarkLede(legs({ sp500: ['100.00', '110.00'] }), 1, 2)).toBeNull()
    expect(benchmarkLede(legs({ sp500: ['100.00', '0.00', '132.00'] }), 1, 2)).toBeNull()
    expect(benchmarkLede(legs({ sp500: ['100.00', '110.00', 'x'] }), 1, 2)).toBeNull()
    expect(benchmarkLede(history({ benchmark: [null, '1.00', '2.00'] }))).toBeNull()
    expect(benchmarkLede(history({ benchmark: ['1.00', '2.00', null] }))).toBeNull()
    expect(
      benchmarkLede({ ...history(), benchmark: undefined } as unknown as PortfolioHistory),
    ).toBeNull()
    expect(benchmarkLede(history(), 2, 2)).toBeNull()
    expect(benchmarkLede(EMPTY)).toBeNull()
  })

  it('is exact to the cent: integer cents, the rebased lead rounded half away from zero', () => {
    // 1,000.30 − 1,000.10 in floats is 0.1999999999999318.
    expect(
      benchmarkLede(legs({ market_value: ['100.00', '100.00', '1000.30'], benchmark: ['100.00', '100.00', '1000.10'] }), 1, 2),
    ).toEqual({ direction: 'ahead', amount: 0.2 })
    // A one-cent deficit grown ×2.5 is −2.5¢, which rounds to −3¢ (Math.round would say −2¢).
    expect(
      benchmarkLede(
        legs({
          market_value: ['100.00', '99.99', '250.00'],
          benchmark: ['100.00', '100.00', '250.00'],
          sp500: ['100.00', '2.00', '5.00'],
        }),
        1,
        2,
      ),
    ).toEqual({ direction: 'ahead', amount: 0.03 })
  })

  it('words the whole history against the same deposits and a range against the same money', () => {
    expect(benchmarkLedeText({ direction: 'ahead', amount: 263682.23 })).toEqual({
      text: 'Ahead of the same deposits in VOO by',
      amount: '$263.7K',
    })
    expect(benchmarkLedeText({ direction: 'ahead', amount: 37160.45 }, 'Over 1Y')).toEqual({
      text: 'Over 1Y: ahead of the same money in VOO by',
      amount: '$37.2K',
    })
    expect(benchmarkLedeText({ direction: 'behind', amount: 30 }, 'Year to date')).toEqual({
      text: 'Year to date: behind the same money in VOO by',
      amount: '$30',
    })
    expect(benchmarkLedeText({ direction: 'level', amount: 0 })).toEqual({
      text: 'Level with the same deposits in VOO',
      amount: null,
    })
    expect(benchmarkLedeText({ direction: 'level', amount: 0 }, 'Over 1Y')).toEqual({
      text: 'Over 1Y: level with the same money in VOO',
      amount: null,
    })
  })

  // Three weeks from Jul 27, 2026 whose legs start level, as the server's always do.
  const weeks = () =>
    history({
      market_value: ['96000.00', '97500.00', '99500.00'],
      benchmark: ['96000.00', '97250.00', '99001.13'],
    })

  it("names the chip's window, or the one the reader dragged out", () => {
    // Twenty months of history: both chips' windows open on the January checkpoint, inside it.
    const long = legs({
      dates: ['2025-01-06', '2026-01-05', '2026-09-07'],
      market_value: ['100.00', '150.00', '195.00'],
    })
    expect(performanceLede(long, { preset: 'all' })?.text).toMatch(/^Ahead of the same deposits/)
    expect(performanceLede(long, { preset: '1y' })?.text).toMatch(/^Over 1Y: ahead of the same money/)
    expect(performanceLede(long, { preset: 'ytd' })?.text).toMatch(/^Year to date: ahead of the same money/)
    const h = weeks()
    // The chart echoes a chip's own window back through datazoom (and the live ping's category
    // sits one past the dates): still the chip's words.
    expect(
      performanceLede(h, { preset: 'all', window: { startValue: 0, endValue: 3 } })?.text,
    ).toMatch(/^Ahead of/)
    expect(
      performanceLede(h, { preset: 'all', window: { startValue: 1, endValue: 2 } })?.text,
    ).toMatch(/^Aug 3, 2026 – Aug 10, 2026: ahead of the same money/)
    expect(
      performanceLede(h, { preset: 'all', window: { startValue: 0, endValue: 1 } })?.text,
    ).toMatch(/^Jul 27, 2026 – Aug 3, 2026: ahead of/)
    expect(performanceLede(history({ benchmark: [null, null, null] }), { preset: 'all' })).toBeNull()
  })

  it('says since when the history is shorter than the chip’s range', () => {
    // Three weeks: neither a year nor the year to date.
    const h = weeks()
    expect(performanceLede(h, { preset: '1y' })?.text).toMatch(/^Since Jul 27, 2026: ahead of the same money/)
    expect(performanceLede(h, { preset: 'ytd' })?.text).toMatch(/^Since Jul 27, 2026: ahead of/)
    // A history that starts exactly on the chip's cutoff covers the whole range.
    const exact = history({ dates: ['2025-08-10', '2026-02-02', '2026-08-10'] })
    expect(performanceLede(exact, { preset: '1y' })?.text).toMatch(/^Over 1Y:/)
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

// --- event markers (2026-08-25 spec §2c) --------------------------------------------

const TICKERS = new Map([
  [1, 'NVDA'],
  [2, 'VOO'],
])

function txn(over: Partial<TransactionOut> & Pick<TransactionOut, 'id' | 'type'>): TransactionOut {
  return {
    security_id: 1, account: 'Fidelity', txn_date: null, shares: '10', price: '100.00',
    fees: null, split_factor: null, sort_index: 0, source: 'ui', notes: null, ...over,
  }
}

function div(over: Partial<DividendOut> & Pick<DividendOut, 'id' | 'pay_date'>): DividendOut {
  return {
    security_id: 2, account: null, amount: '12.00', source: 'manual', ex_date: null,
    per_share: null, shares_held: null, notes: null, ...over,
  }
}

function exdiv(over: Partial<DividendEventOut> = {}): DividendEventOut {
  return { security_id: 2, ex_date: '2026-08-09', per_share: '1.710000', ...over }
}

describe('buildEventMarkers', () => {
  it('snaps each dated event to the NEAREST weekly bar, riding the value line', () => {
    const points = buildEventMarkers(
      history(), // dates 07-27 / 08-03 / 08-10
      [txn({ id: 1, type: 'buy', txn_date: '2026-08-04' })], // 1 day to 08-03, 6 to 08-10
      [],
      TICKERS,
    )
    expect(points).toEqual([
      {
        value: ['Aug 3, 2026', 710000.5],
        symbol: 'triangle',
        symbolRotate: 0,
        events: [{ text: 'Buy NVDA — 10 sh · Aug 4, 2026' }],
      },
    ])
  })

  it('rotates a sell 180° and circles a dividend, each with its TRUE date in the text', () => {
    const points = buildEventMarkers(
      history(),
      [txn({ id: 1, type: 'sell', txn_date: '2026-07-28', shares: '3' })], // -> bar 0
      [div({ id: 9, pay_date: '2026-08-09' })], // 1 day to 08-10 vs 6 to 08-03 -> bar 2
      TICKERS,
    )
    expect(points).toHaveLength(2)
    expect(points[0]).toEqual({
      value: ['Jul 27, 2026', 700000],
      symbol: 'triangle',
      symbolRotate: 180,
      events: [{ text: 'Sell NVDA — 3 sh · Jul 28, 2026' }],
    })
    expect(points[1]).toEqual({
      value: ['Aug 10, 2026', 718422.07],
      symbol: 'circle',
      symbolRotate: 0,
      events: [{ text: 'Dividend VOO — $12.00 · Aug 9, 2026' }],
    })
  })

  it('clusters same-bar events into ONE marker; a mixed cluster wears the diamond', () => {
    const points = buildEventMarkers(
      history(),
      [txn({ id: 1, type: 'buy', txn_date: '2026-08-04' })],
      [div({ id: 9, pay_date: '2026-08-05' })], // 2 days to 08-03, 5 to 08-10 -> same bar
      TICKERS,
    )
    expect(points).toHaveLength(1)
    expect(points[0].symbol).toBe('diamond') // no single kind may over-claim the cluster
    expect(points[0].events).toEqual([
      { text: 'Buy NVDA — 10 sh · Aug 4, 2026' },
      { text: 'Dividend VOO — $12.00 · Aug 5, 2026' },
    ])
  })

  it('circles a provider ex-dividend event with a trimmed per-share text, never a total', () => {
    const points = buildEventMarkers(
      history(),
      [],
      [],
      TICKERS,
      // 1.710000 -> $1.71/sh, 0.104500 -> $0.1045/sh: display-trimmed, never re-scaled.
      [exdiv(), exdiv({ security_id: 1, ex_date: '2026-07-28', per_share: '0.104500' })],
    )
    expect(points).toEqual([
      {
        value: ['Jul 27, 2026', 700000],
        symbol: 'circle',
        symbolRotate: 0,
        events: [{ text: 'Ex-dividend NVDA — $0.1045/sh · Jul 28, 2026' }],
      },
      {
        value: ['Aug 10, 2026', 718422.07], // 08-09 is 1 day to 08-10 vs 6 to 08-03
        symbol: 'circle',
        symbolRotate: 0,
        events: [{ text: 'Ex-dividend VOO — $1.71/sh · Aug 9, 2026' }],
      },
    ])
  })

  it('suppresses an annotation within 14 days of a MANUAL row for the same security', () => {
    // Manual rows never carry an ex_date (the create/update schemas have no such field),
    // so the exact-key dedupe can't see them — the ±14-day window mirrors the ingest's
    // own manual-overlap rule instead. Different security or >14 days: annotation stays.
    const points = buildEventMarkers(
      history(),
      [],
      [div({ id: 9, pay_date: '2026-08-05' })], // manual (source default), security 2
      TICKERS,
      [
        exdiv({ ex_date: '2026-08-09' }), // security 2, 4 days from the manual row: OUT
        exdiv({ security_id: 1, ex_date: '2026-08-09', per_share: '0.010000' }), // kept
      ],
    )
    const texts = points.flatMap((p) => p.events.map((e) => e.text))
    expect(texts).toEqual([
      'Dividend VOO — $12.00 · Aug 5, 2026',
      'Ex-dividend NVDA — $0.01/sh · Aug 9, 2026',
    ])
    const farAway = buildEventMarkers(
      history(),
      [],
      [div({ id: 9, pay_date: '2026-07-25' })], // 15 days before the ex-date: kept
      TICKERS,
      [exdiv({ ex_date: '2026-08-09' })],
    )
    expect(farAway.flatMap((p) => p.events.map((e) => e.text))).toContain(
      'Ex-dividend VOO — $1.71/sh · Aug 9, 2026',
    )
  })

  it('drops an ex-dividend event the ledger already carries for that security and ex-date', () => {
    const points = buildEventMarkers(
      history(),
      [],
      [div({ id: 9, pay_date: '2026-08-09', ex_date: '2026-08-09', source: 'auto' })],
      TICKERS,
      [exdiv({ ex_date: '2026-08-09' })], // same security 2, same ex_date -> ledger wins
    )
    expect(points).toHaveLength(1)
    expect(points[0].events).toEqual([{ text: 'Dividend VOO — $12.00 · Aug 9, 2026' }])
  })

  it('skips dateless transactions, splits, and events off the axis ends', () => {
    expect(
      buildEventMarkers(
        history(),
        [
          txn({ id: 1, type: 'buy' }), // txn_date null: imported, nothing to snap to
          txn({ id: 2, type: 'split', txn_date: '2026-08-04', split_factor: '10' }),
          txn({ id: 3, type: 'buy', txn_date: '2026-07-01' }), // before the first bar
        ],
        [div({ id: 9, pay_date: '2026-08-20' })], // after the last bar
        TICKERS,
      ),
    ).toEqual([])
    expect(buildEventMarkers({ ...history(), dates: [], market_value: [] }, [], [], TICKERS))
      .toEqual([])
  })
})

// --- performance events: the line and the rug (2026-09-23 spec §C8) ------------------

describe('buildPerformanceEvents (2026-09-23 spec §C8)', () => {
  const HELD = new Set([2]) // VOO is held today; NVDA (1) is not

  it('keeps dated buys and sells on the value line, one list per kind', () => {
    const events = buildPerformanceEvents(
      history(),
      [
        txn({ id: 1, type: 'buy', txn_date: '2026-08-04' }),
        txn({ id: 2, type: 'sell', txn_date: '2026-07-28', shares: '3' }),
      ],
      [],
      TICKERS,
      [],
      HELD,
    )
    expect(events.buys).toEqual([
      {
        value: ['Aug 3, 2026', 710000.5],
        symbol: 'triangle',
        symbolRotate: 0,
        events: [{ text: 'Buy NVDA — 10 sh · Aug 4, 2026' }],
      },
    ])
    expect(events.sells).toEqual([
      {
        value: ['Jul 27, 2026', 700000],
        symbol: 'triangle',
        symbolRotate: 180,
        events: [{ text: 'Sell NVDA — 3 sh · Jul 28, 2026' }],
      },
    ])
    expect(events.dividends).toEqual([])
    expect(events.exDividends).toEqual([])
  })

  it('moves ledger dividends and ex-dividend notices to the floor, one tick per bar per kind', () => {
    const events = buildPerformanceEvents(
      history(),
      [],
      [div({ id: 9, pay_date: '2026-08-09', ex_date: '2026-08-09', source: 'auto' })],
      TICKERS,
      [exdiv({ ex_date: '2026-07-28' }), exdiv({ ex_date: '2026-07-29', per_share: '0.500000' })],
      HELD,
    )
    expect(events.dividends).toEqual([
      { value: ['Aug 10, 2026', 0], events: [{ text: 'Dividend VOO — $12.00 · Aug 9, 2026' }] },
    ])
    // Two notices in one week are ONE tick that lists both, by date.
    expect(events.exDividends).toEqual([
      {
        value: ['Jul 27, 2026', 0],
        events: [
          { text: 'Ex-dividend VOO — $1.71/sh · Jul 28, 2026' },
          { text: 'Ex-dividend VOO — $0.5/sh · Jul 29, 2026' },
        ],
      },
    ])
    expect(events.buys).toEqual([])
  })

  it('keeps an ex-dividend notice only for a security held on its ex-date or held today', () => {
    // The provider lists every security the book ever named — watch-list tickers included.
    const notices = [
      exdiv({ security_id: 1, ex_date: '2026-07-28' }),
      exdiv({ security_id: 1, ex_date: '2026-08-09' }),
    ]
    const texts = (events: ReturnType<typeof buildPerformanceEvents>) =>
      events.exDividends.flatMap((point) => point.events.map((e) => e.text))
    // NVDA never held: both notices go.
    expect(texts(buildPerformanceEvents(history(), [], [], TICKERS, notices, HELD))).toEqual([])
    // Held today: both stay, whatever the ledger says.
    expect(texts(buildPerformanceEvents(history(), [], [], TICKERS, notices, new Set([1])))).toHaveLength(2)
    // Bought Aug 1 (and sold since, so not held today): only the notice AFTER the buy.
    expect(
      texts(buildPerformanceEvents(history(), [txn({ id: 1, type: 'buy', txn_date: '2026-08-01' })], [], TICKERS, notices, HELD)),
    ).toEqual(['Ex-dividend NVDA — $1.71/sh · Aug 9, 2026'])
    // An imported (undated) opening lot sold out on Aug 5: held before, not after.
    expect(
      texts(
        buildPerformanceEvents(
          history(),
          [txn({ id: 1, type: 'buy' }), txn({ id: 2, type: 'sell', txn_date: '2026-08-05' })],
          [],
          TICKERS,
          notices,
          HELD,
        ),
      ),
    ).toEqual(['Ex-dividend NVDA — $1.71/sh · Jul 28, 2026'])
    // A 2-for-1 split doubles what is held; a sell of the old count leaves half still held.
    expect(
      texts(
        buildPerformanceEvents(
          history(),
          [
            txn({ id: 1, type: 'buy' }),
            txn({ id: 2, type: 'split', txn_date: '2026-07-20', split_factor: '2' }),
            txn({ id: 3, type: 'sell', txn_date: '2026-08-05' }),
          ],
          [],
          TICKERS,
          notices,
          HELD,
        ),
      ),
    ).toHaveLength(2)
  })

  it('leaves the ledger winning a collision, exactly as the markers always did', () => {
    // Same security and ex-date as a ledger row: the notice is the ledger's, drawn once.
    const events = buildPerformanceEvents(
      history(),
      [],
      [div({ id: 9, pay_date: '2026-08-09', ex_date: '2026-08-09', source: 'auto' })],
      TICKERS,
      [exdiv({ ex_date: '2026-08-09' })],
      HELD,
    )
    expect(events.exDividends).toEqual([])
    expect(events.dividends).toHaveLength(1)
  })

  it('returns no events on an empty history', () => {
    expect(
      buildPerformanceEvents({ ...history(), dates: [], market_value: [] }, [], [div({ id: 9, pay_date: '2026-08-09' })], TICKERS, [], HELD),
    ).toEqual(NO_EVENTS)
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
    expect(byName.get(EXDIV_SERIES)).toMatchObject({
      type: 'scatter', color: MUTED, symbol: 'rect', symbolSize: [2, 10], z: 12,
    })
    expect(byName.get(EXDIV_SERIES)!.data).toBe(EVENTS.exDividends)
    // Every kind is on by default and toggles from its own legend entry.
    expect((option as unknown as { legend: { selected?: unknown } }).legend.selected).toEqual({
      [STARTING_BALANCE_SERIES]: false,
    })
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
