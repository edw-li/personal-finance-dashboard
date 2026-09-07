import { describe, expect, it } from 'vitest'
import type { EChartsOption } from '../../charts/echarts'
import { BAR_MARKS, GRID_VARIANTS } from '../../charts/grammar'
import { INK, MUTED, NEGATIVE, PALETTE, SURFACE } from '../../charts/theme'
import { isGrammarTooltip } from '../../charts/tooltip'
import { tooltipRows } from '../../testing/tooltipRows'
import { anatomyLots, esppLot, esppLotsResponse } from '../../testing/esppFixtures'
import {
  APPRECIATION, BARGAIN, LOSS, PAID, PRICE_DOT, QUOTE_RULE, SUBSCRIPTION,
  hasAnatomy, lotAnatomyCsv, lotAnatomyOption, lotLabels, sortLots,
} from './esppChartOptions'

// EChartsOption is a wide union; narrow once (the option-builder tests' shared posture).
function read(option: EChartsOption | null) {
  expect(option).not.toBeNull()
  return option as unknown as {
    grid: unknown
    legend: { type: string; data?: string[]; selected?: Record<string, boolean> }
    xAxis: { data: string[]; boundaryGap?: boolean }
    yAxis: { type: string; scale?: boolean }
    tooltip: { formatter: (p: unknown) => string }
    series: {
      id?: string
      name: string
      type: string
      stack?: string
      color?: string
      silent?: boolean
      barMaxWidth?: number
      barGap?: string
      symbol?: string
      symbolSize?: number
      z?: number
      animationDelay?: unknown
      itemStyle?: { borderColor?: string; borderWidth?: number; color?: string }
      lineStyle?: { type?: string; width?: number }
      label?: { show: boolean; formatter: (p: { dataIndex: number }) => string }
      data: unknown[]
    }[]
  }
}
const hollow = (value: number, color: string) => ({
  value,
  itemStyle: { color: 'transparent', borderColor: color, borderWidth: 1.5 },
})
const byName = (option: ReturnType<typeof read>, name: string) => {
  const found = option.series.find((s) => s.name === name)
  expect(found, name).toBeDefined()
  return found!
}

describe('lotLabels / sortLots / hasAnatomy', () => {
  it('labels lots by purchase month, falls back to the full date on a collision, and marks sold lots', () => {
    expect(lotLabels(anatomyLots)).toEqual(['Feb 2024', 'Aug 2024 (sold)', 'Feb 2025 (sold)', 'Aug 2025'])
    const twins = [esppLot({ id: 9, purchase_date: '2024-02-05' }), esppLot()]
    expect(lotLabels(twins)).toEqual(['Feb 5, 2024', 'Feb 29, 2024'])
  })
  it('sorts by purchase date then id — the chain order', () => {
    const shuffled = [anatomyLots[3], anatomyLots[0], anatomyLots[2], anatomyLots[1]]
    expect(sortLots(shuffled).map((l) => l.id)).toEqual([1, 2, 3, 4])
  })
  it('recognises a pre-batch payload by its missing anatomy fields', () => {
    expect(hasAnatomy(anatomyLots)).toBe(true)
    const stale = { ...esppLot() } as Record<string, unknown>
    delete stale.fmv_value
    expect(hasAnatomy([stale as unknown as typeof anatomyLots[number]])).toBe(false)
  })
})

describe('lotAnatomyOption — Dollars', () => {
  it('returns null with no lots or without the anatomy fields', () => {
    expect(lotAnatomyOption(esppLotsResponse({ lots: [] }), { view: 'dollars' })).toBeNull()
    const stale = { ...esppLot() } as Record<string, unknown>
    delete stale.appreciation
    expect(
      lotAnatomyOption(esppLotsResponse({ lots: [stale as unknown as typeof anatomyLots[number]] }), { view: 'dollars' }),
    ).toBeNull()
  })

  it('stacks paid, bargain and appreciation per lot in chain order on the money grid', () => {
    const option = read(lotAnatomyOption(esppLotsResponse(), { view: 'dollars' }))
    expect(option.grid).toEqual(GRID_VARIANTS.default)
    expect(option.xAxis.data).toEqual(['Feb 2024', 'Aug 2024 (sold)', 'Feb 2025 (sold)', 'Aug 2025'])
    expect(option.xAxis.boundaryGap).toBeUndefined() // bars: the category gap stays
    expect(option.yAxis.type).toBe('value')
    expect(option.yAxis.scale).toBeUndefined() // zero-anchored: additive money
    const paid = byName(option, PAID)
    expect(paid).toMatchObject({ id: 'paid', type: 'bar', stack: 'lot', color: PALETTE[1], barMaxWidth: BAR_MARKS.barMaxWidth })
    expect(paid.itemStyle?.borderColor).toBe(SURFACE)
    expect(typeof paid.animationDelay).toBe('function')
    expect(paid.data).toEqual([10720.49, hollow(10514.33, PALETTE[1]), hollow(11297.75, PALETTE[1]), 9937.07])
    const bargain = byName(option, BARGAIN)
    expect(bargain).toMatchObject({ id: 'bargain', color: PALETTE[2], stack: 'lot' })
    expect(bargain.data).toEqual([9848.63, hollow(9659.23, PALETTE[2]), hollow(22897.45, PALETTE[2]), 32040.31])
    const appreciation = byName(option, APPRECIATION)
    expect(appreciation).toMatchObject({ id: 'appreciation', color: PALETTE[0], stack: 'lot' })
    // Negative appreciation draws NOTHING in this stack — the loss overlay carries it.
    expect(appreciation.data).toEqual([23971.48, hollow(10426.44, PALETTE[0]), hollow(0, PALETTE[0]), 0])
  })

  it('labels sold columns "Sold" on the cap and nothing on held ones', () => {
    const option = read(lotAnatomyOption(esppLotsResponse(), { view: 'dollars' }))
    const label = byName(option, APPRECIATION).label!
    expect(label.show).toBe(true)
    expect(label.formatter({ dataIndex: 0 })).toBe('')
    expect(label.formatter({ dataIndex: 1 })).toBe('Sold')
  })

  it('overlays a below-FMV loss on its own stack, over the same column, from market value up to FMV value', () => {
    const option = read(lotAnatomyOption(esppLotsResponse(), { view: 'dollars' }))
    const base = option.series.find((s) => s.name === 'loss-base')!
    expect(base).toMatchObject({ type: 'bar', stack: 'loss', silent: true, color: 'transparent' })
    expect(base.data).toEqual([0, 0, 30140, 41285.71])
    const loss = byName(option, LOSS)
    expect(loss).toMatchObject({ id: 'loss', stack: 'loss', color: NEGATIVE, barGap: '-100%', barMaxWidth: BAR_MARKS.barMaxWidth })
    expect(loss.itemStyle?.borderColor).toBe(SURFACE)
    expect(loss.data).toEqual([0, 0, 4055.2, 691.67]) // 34195.20 - 30140.00, 41977.38 - 41285.71
    expect(option.series[option.series.length - 1].name).toBe(LOSS) // barGap rides the LAST bar series
    expect(option.legend.data).toEqual([PAID, BARGAIN, APPRECIATION, LOSS])
  })

  it('omits the loss stack and its legend entry when no lot is under its FMV', () => {
    const option = read(lotAnatomyOption(esppLotsResponse({ lots: [anatomyLots[0], anatomyLots[1]] }), { view: 'dollars' }))
    expect(option.series.map((s) => s.name)).toEqual([PAID, BARGAIN, APPRECIATION])
    expect(option.legend.data).toEqual([PAID, BARGAIN, APPRECIATION])
    expect(option.series.some((s) => s.barGap !== undefined)).toBe(false)
  })

  it('draws paid and bargain only when the position is unpriced', () => {
    const unpriced = esppLotsResponse({
      current_price: null,
      quoted_at: null,
      lots: [esppLot({ market_value: null, gain_amount: null, gain_pct: null, appreciation: null })],
    })
    const option = read(lotAnatomyOption(unpriced, { view: 'dollars' }))
    expect(byName(option, APPRECIATION).data).toEqual([0])
    expect(byName(option, BARGAIN).data).toEqual([9848.63])
    expect(option.legend.data).toEqual([PAID, BARGAIN, APPRECIATION])
  })

  it('mirrors legend picks and keeps the tooltip on the grammar: components sorted, no total, the lot in the foot', () => {
    const option = read(lotAnatomyOption(esppLotsResponse(), { view: 'dollars', selected: { [LOSS]: false } }))
    expect(option.legend.selected).toEqual({ [LOSS]: false })
    expect(isGrammarTooltip(option.tooltip.formatter)).toBe(true)
    const parsed = tooltipRows(
      option.tooltip.formatter([
        { seriesName: PAID, seriesType: 'bar', axisValueLabel: 'Feb 2024', dataIndex: 0, value: 10720.49, color: PALETTE[1] },
        { seriesName: BARGAIN, seriesType: 'bar', axisValueLabel: 'Feb 2024', dataIndex: 0, value: 9848.63, color: PALETTE[2] },
        { seriesName: APPRECIATION, seriesType: 'bar', axisValueLabel: 'Feb 2024', dataIndex: 0, value: 23971.48, color: PALETTE[0] },
      ]),
    )
    expect(parsed.head).toBe('Feb 2024')
    expect(parsed.rows.map((r) => [r.kind, r.label, r.value])).toEqual([
      ['row', APPRECIATION, '$23,971.48'],
      ['row', PAID, '$10,720.49'],
      ['row', BARGAIN, '$9,848.63'],
    ])
    expect(parsed.foot).toEqual([
      'Value $44,540.60 · gain $33,820.11 (+315.5%)',
      '260 sh · paid $41.23 · FMV $79.11 · subscription $48.51 · price $171.31',
      'Bargain element: $1,891.85 discount + $7,956.78 lookback',
      'Qualified',
    ])
  })

  it('says sold and qualifying in the foot as the row does', () => {
    const option = read(lotAnatomyOption(esppLotsResponse(), { view: 'dollars' }))
    const foot = (index: number) =>
      tooltipRows(option.tooltip.formatter([{ seriesName: PAID, seriesType: 'bar', dataIndex: index, value: 1, color: PALETTE[1] }])).foot
    expect(foot(1)[1]).toBe('255 sh · paid $41.23 · FMV $79.11 · subscription $48.51 · price $120.00')
    expect(foot(1)[3]).toBe('Sold Oct 15, 2025 at $120.00')
    expect(foot(3)[3]).toBe('Qualifies in 13 days')
  })
})

describe('lotAnatomyOption — Per share', () => {
  const hollowDot = (value: number, color: string) => ({
    value,
    itemStyle: { color: SURFACE, borderColor: color, borderWidth: 1.5 },
  })

  it('floats each lot from the paid price: a silent base, then bargain and appreciation per share, 10px wide', () => {
    const option = read(lotAnatomyOption(esppLotsResponse(), { view: 'per-share' }))
    expect(option.yAxis.scale).toBeUndefined() // zero-anchored: the discount as a true share of the price
    const base = option.series.find((s) => s.name === 'ladder-base')!
    expect(base).toMatchObject({ type: 'bar', stack: 'ladder', silent: true, color: 'transparent', barMaxWidth: 10 })
    expect(base.data).toEqual([41.23265, 41.23265, 41.23265, 41.23265])
    const bargain = byName(option, BARGAIN)
    expect(bargain).toMatchObject({ id: 'bargain', stack: 'ladder', barMaxWidth: 10, color: PALETTE[2] })
    // cents(): 79.112 − 41.23265 and 174.18 − 41.23265 are float dust, and dust must not reach a chart.
    expect(bargain.data).toEqual([37.88, hollow(37.88, PALETTE[2]), hollow(83.57, PALETTE[2]), 132.95])
    const appreciation = byName(option, APPRECIATION)
    expect(appreciation.data).toEqual([92.2, hollow(40.89, PALETTE[0]), hollow(0, PALETTE[0]), 0])
    expect(appreciation.label!.formatter({ dataIndex: 2 })).toBe('Sold')
  })

  it('overlays a per-share loss from the price up to the purchase FMV', () => {
    const option = read(lotAnatomyOption(esppLotsResponse(), { view: 'per-share' }))
    expect(option.series.find((s) => s.name === 'loss-base')!.data).toEqual([0, 0, 110, 171.31])
    const loss = byName(option, LOSS)
    expect(loss).toMatchObject({ stack: 'loss', color: NEGATIVE, barGap: '-100%', barMaxWidth: 10 })
    expect(loss.data).toEqual([0, 0, 14.8, 2.87]) // 124.80 − 110, 174.18 − 171.31
  })

  it('rides the ends with Paid and Price dots, hollow on sold lots, the subscription diamond and the quote rule', () => {
    const option = read(lotAnatomyOption(esppLotsResponse(), { view: 'per-share' }))
    const paid = byName(option, PAID)
    expect(paid).toMatchObject({ id: 'paid', type: 'scatter', color: PALETTE[1], symbolSize: 9, z: 11 })
    expect(paid.itemStyle).toEqual({ borderColor: INK, borderWidth: 1 })
    expect(paid.data).toEqual([41.23265, hollowDot(41.23265, PALETTE[1]), hollowDot(41.23265, PALETTE[1]), 41.23265])
    const price = byName(option, PRICE_DOT)
    expect(price).toMatchObject({ type: 'scatter', color: PALETTE[0] })
    expect(price.data).toEqual([171.31, hollowDot(120, PALETTE[0]), hollowDot(110, PALETTE[0]), 171.31])
    const subscription = byName(option, SUBSCRIPTION)
    expect(subscription).toMatchObject({ type: 'scatter', color: MUTED, symbol: 'diamond', symbolSize: 9 })
    expect(subscription.itemStyle).toEqual({ borderColor: INK, borderWidth: 1 }) // filled — hollow means sold
    expect(subscription.data).toEqual([48.509, 48.509, 48.509, 48.509])
    const rule = byName(option, QUOTE_RULE)
    expect(rule).toMatchObject({ type: 'line', color: MUTED, z: 9, lineStyle: { type: 'dashed', width: 2 } })
    expect(rule.data).toEqual([171.31, 171.31, 171.31, 171.31])
    expect(option.legend.data).toEqual([PAID, BARGAIN, APPRECIATION, LOSS, PRICE_DOT, SUBSCRIPTION, QUOTE_RULE])
  })

  it('drops the Price dots and the quote rule when unpriced', () => {
    const unpriced = esppLotsResponse({
      current_price: null,
      quoted_at: null,
      lots: [esppLot({ market_value: null, gain_amount: null, gain_pct: null, appreciation: null })],
    })
    const option = read(lotAnatomyOption(unpriced, { view: 'per-share' }))
    expect(byName(option, PRICE_DOT).data).toEqual([null])
    expect(option.series.some((s) => s.name === QUOTE_RULE)).toBe(false)
    expect(option.legend.data).toEqual([PAID, BARGAIN, APPRECIATION, PRICE_DOT, SUBSCRIPTION])
  })

  it('tooltips the per-share components as rows and the paid, price, subscription and quote figures as references', () => {
    const option = read(lotAnatomyOption(esppLotsResponse(), { view: 'per-share' }))
    const parsed = tooltipRows(
      option.tooltip.formatter([
        { seriesName: BARGAIN, seriesType: 'bar', axisValueLabel: 'Feb 2024', dataIndex: 0, value: 37.88, color: PALETTE[2] },
        { seriesName: APPRECIATION, seriesType: 'bar', axisValueLabel: 'Feb 2024', dataIndex: 0, value: 92.2, color: PALETTE[0] },
        { seriesName: PAID, seriesType: 'scatter', dataIndex: 0, value: 41.23265, color: PALETTE[1] },
        { seriesName: PRICE_DOT, seriesType: 'scatter', dataIndex: 0, value: 171.31, color: PALETTE[0] },
        { seriesName: SUBSCRIPTION, seriesType: 'scatter', dataIndex: 0, value: 48.509, color: MUTED },
        { seriesName: QUOTE_RULE, seriesType: 'line', dataIndex: 0, value: 171.31, color: MUTED },
      ]),
    )
    expect(parsed.rows.map((r) => [r.kind, r.label, r.value])).toEqual([
      ['row', APPRECIATION, '$92.20'],
      ['row', BARGAIN, '$37.88'],
      ['ref', PAID, '$41.23'],
      ['ref', PRICE_DOT, '$171.31'],
      ['ref', SUBSCRIPTION, '$48.51'],
      ['ref', QUOTE_RULE, '$171.31'],
    ])
    expect(parsed.foot[0]).toBe('Value $44,540.60 · gain $33,820.11 (+315.5%)')
  })
})

describe('lotAnatomyCsv', () => {
  it('prints one row per lot in chain order, verbatim wire strings, the price column by status', () => {
    const table = lotAnatomyCsv(esppLotsResponse())
    expect(table.headers).toEqual([
      'Purchased', 'Status', 'Shares', 'Paid / sh', 'FMV at purchase / sh', 'Subscription / sh', 'Price / sh',
      'Cost', 'Discount component', 'Lookback component', 'Bargain element', 'Appreciation', 'Value',
    ])
    expect(table.rows[0]).toEqual([
      '2024-02-29', 'held', '260.0000', '41.23265', '79.11200', '48.50900', '171.3100',
      '10720.49', '1891.85', '7956.78', '9848.63', '23971.48', '44540.60',
    ])
    expect(table.rows[1][1]).toBe('sold')
    expect(table.rows[1][6]).toBe('120.00000')
  })
})
