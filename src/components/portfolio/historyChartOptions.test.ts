import { describe, expect, it } from 'vitest'
import type { EChartsOption } from '../../charts/echarts'
import { PALETTE } from '../../charts/theme'
import type { PortfolioHistory } from '../../types/api'
import {
  historyTooltipFormatter,
  liveFromHoldings,
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

describe('historyTooltipFormatter', () => {
  it('skips null rows (the padded live category) and formats currency', () => {
    const html = historyTooltipFormatter([
      { seriesName: 'Portfolio value', marker: '<i/>', axisValueLabel: 'Aug 14, 2026', value: null },
      { seriesName: 'Live', marker: '<i/>', axisValueLabel: 'Aug 14, 2026', value: ['Aug 14, 2026', 723456.78] },
    ])
    expect(html).toContain('Aug 14, 2026')
    expect(html).toContain('Live')
    expect(html).toContain('$723,456.78')
    expect(html).not.toContain('Portfolio value')
  })

  it('returns an empty string when every row is null', () => {
    expect(historyTooltipFormatter([{ value: null }])).toBe('')
  })

  it('prints every finite row on a shared category, and accepts a non-array param', () => {
    // Same-day park: the value line and the Live ping both sit on the last category, so
    // BOTH rows are finite and both must print (the null-skipping must not over-filter).
    const parked = historyTooltipFormatter([
      {
        seriesName: 'Portfolio value',
        marker: '<i/>',
        axisValueLabel: 'Aug 10, 2026',
        value: 718422.07,
      },
      {
        seriesName: 'Live',
        marker: '<i/>',
        axisValueLabel: 'Aug 10, 2026',
        value: ['Aug 10, 2026', 720000],
      },
    ])
    expect(parked).toContain('Portfolio value')
    expect(parked).toContain('$718,422.07')
    expect(parked).toContain('Live')
    expect(parked).toContain('$720,000.00')
    // echarts hands a lone object (not an array) to an axis formatter with one row.
    expect(
      historyTooltipFormatter({
        seriesName: 'Portfolio value',
        marker: '<i/>',
        axisValueLabel: 'Aug 10, 2026',
        value: 718422.07,
      }),
    ).toContain('$718,422.07')
  })

  it('skips the benchmark null row on the padded live category', () => {
    const html = historyTooltipFormatter([
      {
        seriesName: 'VOO (your contributions)',
        marker: '<i/>',
        axisValueLabel: 'Aug 14, 2026',
        value: null,
      },
      {
        seriesName: 'Live',
        marker: '<i/>',
        axisValueLabel: 'Aug 14, 2026',
        value: ['Aug 14, 2026', 723456.78],
      },
    ])
    expect(html).toContain('Live')
    expect(html).not.toContain('VOO (your contributions)')
  })

  it('bolds the date header like every other formatter', () => {
    const html = historyTooltipFormatter([
      { seriesName: 'Portfolio value', marker: '<i/>', axisValueLabel: 'Aug 10, 2026', value: 1 },
    ])
    expect(html).toContain('<strong>Aug 10, 2026</strong>')
  })
})
