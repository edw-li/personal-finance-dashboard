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
    ...over,
  }
}

const EMPTY: PortfolioHistory = { dates: [], market_value: [], cost_basis: [], sp500: [] }

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
        }),
        { date: '2026-08-14', value: 2 },
      ),
    ).toBeNull()
  })

  it('draws three lines in fixed palette slots with a wash under value only', () => {
    const option = portfolioHistoryOption(history(), null)
    expect(option).not.toBeNull()
    const series = seriesOf(option!)
    expect(series.map((s) => s.name)).toEqual(['Portfolio value', 'Cost basis', 'S&P 500 baseline'])
    expect(series.map((s) => s.color)).toEqual([PALETTE[0], PALETTE[1], PALETTE[2]])
    expect(series[0].areaStyle?.opacity).toBeGreaterThan(0)
    expect(series[1].areaStyle).toBeUndefined()
    expect(series[2].areaStyle).toBeUndefined()
    // Number() at the boundary, once
    expect(series[0].data).toEqual([700000, 710000.5, 718422.07])
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
    expect(series).toHaveLength(4)
    // Lines end at the last IMPORTED point — the live category is never extrapolated.
    expect(series[0].data).toEqual([700000, 710000.5, 718422.07, null])
    expect(series[1].data).toEqual([395000, 399542.36, 400243.74, null])
    const live = series[3]
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
    expect(series).toHaveLength(4)
    expect(series[0].data).toEqual([700000, 710000.5, 718422.07]) // no null padding
    expect(series[3].data).toEqual([['Aug 10, 2026', 720000]])
    expect(series[3].markLine).toBeUndefined()
  })

  it('self-retires the live point when the quote predates the series or is unusable', () => {
    expect(seriesOf(portfolioHistoryOption(history(), { date: '2026-08-01', value: 1 })!)).toHaveLength(3)
    expect(
      seriesOf(portfolioHistoryOption(history(), { date: '2026-08-14', value: Number.NaN })!),
    ).toHaveLength(3)
    expect(seriesOf(portfolioHistoryOption(history(), null)!)).toHaveLength(3)
  })
})

describe('liveFromHoldings', () => {
  it('slices the bar date off a datetime and parses the market value once', () => {
    expect(
      liveFromHoldings({ as_of: '2026-08-14T00:00:00Z', totals: { market_value: '723456.78' } }),
    ).toEqual({ date: '2026-08-14', value: 723456.78 })
  })

  it('is null before the first price refresh', () => {
    expect(liveFromHoldings({ as_of: null, totals: { market_value: '0.00' } })).toBeNull()
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
})
