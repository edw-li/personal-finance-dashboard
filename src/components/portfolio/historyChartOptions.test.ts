import { describe, expect, it } from 'vitest'
import type { EChartsOption } from '../../charts/echarts'
import type {
  DividendEventOut,
  DividendOut,
  PortfolioHistory,
  TransactionOut,
} from '../../types/api'
import { GRID_VARIANTS, compactMoney } from '../../charts/grammar'
import { MUTED, PALETTE } from '../../charts/theme'
import { isGrammarTooltip } from '../../charts/tooltip'
import { tooltipRows } from '../../testing/tooltipRows'
import {
  buildEventMarkers,
  EVENTS_SERIES,
  liveFromHoldings,
  portfolioHistoryCsv,
  portfolioHistoryOption,
} from './historyChartOptions'

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

  it('draws four lines in fixed palette slots with a wash under value only', () => {
    const option = portfolioHistoryOption(history(), null)
    expect(option).not.toBeNull()
    const series = seriesOf(option!)
    expect(series.map((s) => s.name)).toEqual([
      'Portfolio value',
      'Cost basis',
      'S&P 500 baseline',
      'VOO (your contributions)',
    ])
    expect(series.map((s) => s.color)).toEqual([PALETTE[0], PALETTE[1], PALETTE[2], PALETTE[3]])
    expect(series[0].areaStyle?.opacity).toBeGreaterThan(0)
    expect(series[1].areaStyle).toBeUndefined()
    expect(series[2].areaStyle).toBeUndefined()
    // No wash on the benchmark either — the wash rides the value line only (spec §4).
    expect(series[3].areaStyle).toBeUndefined()
    // Number() at the boundary, once
    expect(series[0].data).toEqual([700000, 710000.5, 718422.07])
    expect(series[3].data).toEqual([96000, 97250, 99001.13])
    expect(categoriesOf(option!)).toEqual(['Jul 27, 2026', 'Aug 3, 2026', 'Aug 10, 2026'])
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
    expect(series[2].data).toEqual([96000, 97000, 98636.7, null])
    expect(series[3].data).toEqual([96000, 97250, 99001.13, null])
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
    expect(series[3].data).toEqual([96000, 97250, 99001.13])
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
      'S&P 500 baseline',
    ])
    // The server's no-VOO-bars degradation: all-null. An all-null line would draw
    // nothing yet still ghost-occupy the legend, so the series is omitted outright.
    expect(
      seriesOf(portfolioHistoryOption(history({ benchmark: [null, null, null] }), null)!).map(
        (s) => s.name,
      ),
    ).toEqual(['Portfolio value', 'Cost basis', 'S&P 500 baseline'])
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

  it('wears the money grid, compact ticks, every-date labels and a plain legend with the page picks', () => {
    const option = read(
      portfolioHistoryOption(history(), null, null, { selected: { 'Cost basis': false } }),
    )
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
    const parsed = tooltipRows(
      option.tooltip.formatter([
        {
          seriesName: 'Portfolio value', seriesType: 'line', axisValueLabel: 'Aug 3, 2026',
          value: 710000.5, color: PALETTE[0],
        },
        { seriesName: 'Cost basis', seriesType: 'line', value: null, color: PALETTE[1] },
        {
          seriesName: EVENTS_SERIES, seriesType: 'scatter', value: ['Aug 3, 2026', 710000.5],
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

describe('portfolioHistoryOption with events', () => {
  it('appends a MUTED plain-scatter Events series, legend-toggleable and on by default', () => {
    const option = portfolioHistoryOption(history(), null, EVENT_POINTS)
    const series = seriesOf(option!)
    expect(series.map((s) => s.name)).toEqual([
      'Portfolio value', 'Cost basis', 'S&P 500 baseline', 'VOO (your contributions)',
      EVENTS_SERIES,
    ])
    const events = series[4] as SeriesLike & { z?: number }
    expect(events.type).toBe('scatter') // ripple stays reserved for the live ping
    expect(events.color).toBe(MUTED)
    expect(events.z).toBe(11)
    expect(events.data).toBe(EVENT_POINTS)
    // No legend.selected entry: on by default, toggleable like any series.
    expect((option as unknown as { legend: { selected?: unknown } }).legend.selected)
      .toBeUndefined()
  })

  it('draws no Events series for an empty or omitted list (Overview keeps the two-arg call)', () => {
    expect(seriesOf(portfolioHistoryOption(history(), null, [])!)).toHaveLength(4)
    expect(seriesOf(portfolioHistoryOption(history(), null)!)).toHaveLength(4)
  })
})

describe('portfolioHistoryCsv', () => {
  it('lays out date rows × the four series, verbatim strings', () => {
    expect(portfolioHistoryCsv(history())).toEqual({
      headers: ['Date', 'Portfolio value', 'Cost basis', 'S&P 500 baseline', 'VOO (your contributions)'],
      rows: [
        ['2026-07-27', '700000.00', '395000.00', '96000.00', '96000.00'],
        ['2026-08-03', '710000.50', '399542.36', '97000.00', '97250.00'],
        ['2026-08-10', '718422.07', '400243.74', '98636.70', '99001.13'],
      ],
    })
  })

  it('empties the VOO cells on a degraded or stale-payload benchmark', () => {
    const rows = portfolioHistoryCsv(history({ benchmark: [null, null, null] })).rows
    expect(rows.map((r) => r[4])).toEqual(['', '', ''])
  })
})
