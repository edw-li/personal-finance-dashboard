import { describe, expect, it } from 'vitest'
import type { EChartsOption } from '../../charts/echarts'
import { BAR_MARKS, GRID_VARIANTS } from '../../charts/grammar'
import { INK, MUTED, NEGATIVE, PALETTE, POSITIVE, SURFACE } from '../../charts/theme'
import { isGrammarTooltip } from '../../charts/tooltip'
import { tooltipRows } from '../../testing/tooltipRows'
import { anatomyLots, bars, esppLot, esppLotsResponse, septOffering } from '../../testing/esppFixtures'
import {
  APPRECIATION, AVG_PAID, BARGAIN, CLOSE, LOSS, PAID, PRICE_DOT, PURCHASES, QUOTE_RULE, SALES, SUBSCRIPTION,
  esppPriceCsv, esppPriceOption, hasAnatomy, lotAnatomyCsv, lotAnatomyOption, lotLabels, lotsOutsideHistory,
  sliceWindow, sortLots,
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

  it('measures appreciation from whatever the column already stands on, so an over-typed purchase price still tops out at the value', () => {
    // A purchase price ABOVE the FMV makes bargain_element negative (spec §5.3's edge). The
    // clamped bargain draws nothing, so measuring appreciation from the FMV would push the top
    // past the value by exactly the overpayment; from max(FMV, paid) it lands on the value.
    const overpaid = esppLotsResponse({
      lots: [
        esppLot({
          purchase_price: '85.00000', cost_basis: '22100.00', fmv_value: '20569.12',
          bargain_element: '-1530.88', lookback_component: '7956.78', discount_component: '-9487.66',
          market_value: '44540.60', appreciation: '23971.48',
        }),
      ],
    })
    const option = read(lotAnatomyOption(overpaid, { view: 'dollars' }))
    expect(byName(option, PAID).data).toEqual([22100])
    expect(byName(option, BARGAIN).data).toEqual([0])
    expect(byName(option, APPRECIATION).data).toEqual([22440.6]) // 44540.60 - 22100.00 = the value
    const perShare = read(lotAnatomyOption(overpaid, { view: 'per-share' }))
    expect(perShare.series.find((s) => s.name === 'ladder-base')!.data).toEqual([85])
    expect(byName(perShare, BARGAIN).data).toEqual([0])
    expect(byName(perShare, APPRECIATION).data).toEqual([86.31]) // 171.31 - 85 = the quote
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

  it('scrolls its legend where the other two charts do not', () => {
    // Seven names, four of them long, outrun a span-6 card (~600-760px): a PLAIN legend wraps to
    // a second line and lands on the plot, because grid.top is a fixed 40. Scrolling below the
    // grammar's eight-entry threshold is the one place this view departs from legendFor.
    expect(read(lotAnatomyOption(esppLotsResponse(), { view: 'per-share' })).legend.type).toBe('scroll')
    expect(read(lotAnatomyOption(esppLotsResponse(), { view: 'dollars' })).legend.type).toBe('plain')
    expect(read(esppPriceOption({ points: bars, offerings: [septOffering], lots: [esppLot()] })).legend.type).toBe('plain')
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

  it('leaves the quote-dependent columns blank on an unpriced lot rather than printing a zero', () => {
    const table = lotAnatomyCsv(
      esppLotsResponse({
        current_price: null,
        quoted_at: null,
        lots: [esppLot({ market_value: null, gain_amount: null, gain_pct: null, appreciation: null })],
      }),
    )
    expect(table.rows[0]).toEqual([
      '2024-02-29', 'held', '260.0000', '41.23265', '79.11200', '48.50900', '',
      '10720.49', '1891.85', '7956.78', '9848.63', '', '',
    ])
  })
})

describe('esppPriceOption', () => {
  const lots = [
    esppLot(), // bought 2024-02-29
    esppLot({ id: 2, purchase_date: '2024-08-30', shares: '255.0000', sold_date: '2024-09-03', sold_price: '120.00000', is_sold: true, days_until_qualified: null }),
  ]

  it('returns null under two bars', () => {
    expect(esppPriceOption({ points: [], offerings: [septOffering], lots })).toBeNull()
    expect(esppPriceOption({ points: [bars[0]], offerings: [septOffering], lots })).toBeNull()
  })

  it('draws the closes, the two stepped rules with end labels, the wash against the average, and the markers', () => {
    const option = read(esppPriceOption({ points: bars, offerings: [septOffering], lots }))
    expect(option.grid).toEqual(GRID_VARIANTS.endLabel)
    expect(option.xAxis.data).toEqual(['Feb 27, 2024', 'Feb 29, 2024', 'Mar 1, 2024', 'Aug 30, 2024', 'Sep 3, 2024'])
    expect(option.yAxis.scale).toBe(true) // a price line has no additive reading
    expect(option.legend.data).toEqual([CLOSE, SUBSCRIPTION, AVG_PAID, PURCHASES, SALES])
    expect(byName(option, CLOSE)).toMatchObject({ type: 'line', color: PALETTE[0], lineStyle: { width: 2 } })
    expect(byName(option, CLOSE).data).toEqual([75, 79.112, 80, 119.37, 121])
    const sub = byName(option, SUBSCRIPTION) as unknown as { step: string; endLabel: { show: boolean; formatter: string } }
    expect(byName(option, SUBSCRIPTION)).toMatchObject({ color: MUTED, z: 9, lineStyle: { type: 'dashed', width: 2 } })
    expect(sub.step).toBe('end')
    // The SHORT name, not '{a}': grid('endLabel') reserves 84px and the series name overruns it
    // (the 2026-09-07 probe clipped "Subscription p"). It ends ABOVE the average paid here, so its
    // label is pushed up off its own line and the average's down.
    expect(sub.endLabel).toEqual({
      show: true, formatter: 'Subscription', color: MUTED, fontSize: 11, verticalAlign: 'bottom',
    })
    expect(byName(option, SUBSCRIPTION).data).toEqual([48.509, 48.509, 48.509, 48.509, 48.509])
    // Null before the first purchase; the running average from the lot itself afterwards.
    expect(byName(option, AVG_PAID).data).toEqual([null, 41.23265, 41.23265, 41.23265, 41.23265])
    const above = option.series.find((s) => s.name === 'Above avg paid')!
    expect(above).toMatchObject({ stack: 'above-paid', color: POSITIVE, silent: true })
    expect(above.data).toEqual([null, 37.88, 38.77, 78.14, 79.77])
    expect(option.series.find((s) => s.name === 'Below avg paid')!.data).toEqual([null, 0, 0, 0, 0])
  })

  it('snaps purchases to the last bar on or before the date, hollow once sold, and sales to theirs', () => {
    const option = read(esppPriceOption({ points: bars, offerings: [septOffering], lots }))
    const purchases = byName(option, PURCHASES)
    expect(purchases).toMatchObject({ type: 'scatter', color: PALETTE[1], symbolSize: 10, z: 11 })
    expect(purchases.itemStyle).toEqual({ borderColor: INK, borderWidth: 1 })
    expect(purchases.data).toEqual([
      { value: ['Feb 29, 2024', 79.112], symbol: 'diamond', symbolRotate: 0, events: [{ text: 'Feb 29, 2024 · 260 sh · paid $41.23 · FMV $79.11' }] },
      {
        value: ['Aug 30, 2024', 119.37], symbol: 'diamond', symbolRotate: 0,
        events: [{ text: 'Aug 30, 2024 · 255 sh · paid $41.23 · FMV $79.11 · sold Sep 3, 2024' }],
        itemStyle: { color: SURFACE, borderColor: PALETTE[1], borderWidth: 1.5 },
      },
    ])
    const sales = byName(option, SALES)
    expect(sales).toMatchObject({ type: 'scatter', color: MUTED, symbolSize: 9 })
    expect(sales.data).toEqual([
      { value: ['Sep 3, 2024', 121], symbol: 'triangle', symbolRotate: 180, events: [{ text: 'Sold Sep 3, 2024 · 255 sh at $120.00' }] },
    ])
  })

  it('skips a purchase the history does not reach and drops the series and legend entries it cannot fill', () => {
    const early = esppLot({ id: 7, purchase_date: '2023-12-01' })
    const option = read(esppPriceOption({ points: bars.slice(0, 3), offerings: [], lots: [early] }))
    expect(option.series.some((s) => s.name === PURCHASES)).toBe(false)
    expect(option.series.some((s) => s.name === SUBSCRIPTION)).toBe(false) // no offering
    // The early lot's average still rules the whole window — it was bought before every bar.
    expect(byName(option, AVG_PAID).data).toEqual([41.23265, 41.23265, 41.23265])
    expect(option.legend.data).toEqual([CLOSE, AVG_PAID])
  })

  it('steps the subscription rule at a second offering and leaves it null before the first', () => {
    const option = read(
      esppPriceOption({
        points: bars,
        offerings: [
          { id: 1, offering_start: '2024-02-28', subscription_price: '48.50900', notes: null },
          { id: 2, offering_start: '2024-08-30', subscription_price: '95.00000', notes: null },
        ],
        lots,
      }),
    )
    expect(byName(option, SUBSCRIPTION).data).toEqual([null, 48.509, 48.509, 95, 95])
  })

  it('steps the average paid at each purchase, and parts the two end labels by where they END', () => {
    // A second, dearer lot lifts the running average ABOVE the subscription rule — the ordering
    // the naive "subscription is always the lower line" assumption would get backwards.
    const chain = [
      esppLot(),
      esppLot({ id: 2, purchase_date: '2024-08-30', shares: '100.0000', purchase_price: '127.50000', avg_paid_to_date: '65.19581' }),
    ]
    const option = read(esppPriceOption({ points: bars, offerings: [septOffering], lots: chain }))
    expect(byName(option, AVG_PAID).data).toEqual([null, 41.23265, 41.23265, 65.19581, 65.19581])
    const endLabel = (name: string) =>
      (byName(option, name) as unknown as { endLabel: { verticalAlign: string } }).endLabel.verticalAlign
    expect(endLabel(AVG_PAID)).toBe('bottom') // the higher rule's label sits above its line
    expect(endLabel(SUBSCRIPTION)).toBe('top')
  })

  it('washes red where a close sits under the average paid', () => {
    const option = read(esppPriceOption({ points: bars, offerings: [], lots: [esppLot({ avg_paid_to_date: '80.00000' })] }))
    expect(option.series.find((s) => s.name === 'Below avg paid')!.data).toEqual([null, 0.89, 0, 0, 0])
    expect(option.series.find((s) => s.name === 'wash-below-base')!.data).toEqual([null, 79.112, 80, 80, 80])
    expect(option.series.find((s) => s.name === 'Above avg paid')!.data).toEqual([null, 0, 0, 39.37, 41])
  })

  it('skips a purchase or a sale dated AFTER the last bar rather than snapping it back', () => {
    // Snapping forward-dated events onto the newest bar would draw a later lot at an old close.
    const later = esppLot({ id: 8, purchase_date: '2025-06-30', sold_date: '2025-07-31', sold_price: '200.00000', is_sold: true })
    const option = read(esppPriceOption({ points: bars, offerings: [septOffering], lots: [esppLot(), later] }))
    expect((byName(option, PURCHASES).data as unknown[]).length).toBe(1)
    expect(option.series.some((s) => s.name === SALES)).toBe(false)
    expect(option.legend.data).toEqual([CLOSE, SUBSCRIPTION, AVG_PAID, PURCHASES])
  })

  it('tooltips Close first, the two rules as references, and the markers as lines', () => {
    const option = read(esppPriceOption({ points: bars, offerings: [septOffering], lots }))
    expect(isGrammarTooltip(option.tooltip.formatter)).toBe(true)
    const purchase = (byName(option, PURCHASES).data as unknown[])[0]
    const parsed = tooltipRows(
      option.tooltip.formatter([
        { seriesName: CLOSE, seriesType: 'line', axisValueLabel: 'Feb 29, 2024', value: 79.112, color: PALETTE[0] },
        { seriesName: SUBSCRIPTION, seriesType: 'line', value: 48.509, color: MUTED },
        { seriesName: AVG_PAID, seriesType: 'line', value: 41.23265, color: MUTED },
        { seriesName: PURCHASES, seriesType: 'scatter', value: ['Feb 29, 2024', 79.112], color: PALETTE[1], data: purchase },
      ]),
    )
    expect(parsed.rows.map((r) => [r.kind, r.label, r.value])).toEqual([
      ['row', CLOSE, '$79.11'],
      ['ref', SUBSCRIPTION, '$48.51'],
      ['ref', AVG_PAID, '$41.23'],
    ])
    expect(parsed.notes).toEqual(['Feb 29, 2024 · 260 sh · paid $41.23 · FMV $79.11'])
  })
})

describe('sliceWindow / lotsOutsideHistory / esppPriceCsv', () => {
  it('slices the fetched series to the chip window, anchored on today', () => {
    expect(sliceWindow(bars, 365, '2024-09-04').map((p) => p.d)).toEqual(['2024-02-27', '2024-02-29', '2024-03-01', '2024-08-30', '2024-09-03'])
    expect(sliceWindow(bars, 30, '2024-09-04').map((p) => p.d)).toEqual(['2024-08-30', '2024-09-03'])
    expect(sliceWindow([], 30, '2024-09-04')).toEqual([])
  })
  it('counts the lots the stored history cannot reach, on BOTH sides', () => {
    expect(
      lotsOutsideHistory(bars, [
        esppLot({ purchase_date: '2023-12-01' }),
        esppLot(),
        esppLot({ id: 5, purchase_date: '2025-02-28' }),
        esppLot({ id: 6, purchase_date: '2025-08-29' }),
      ]),
    ).toEqual({ before: 1, after: 2 })
    expect(lotsOutsideHistory([], [esppLot()])).toEqual({ before: 0, after: 0 })
  })
  it('prints one row per bar with the rules and the day’s purchase or sale shares', () => {
    const lots = [esppLot(), esppLot({ id: 2, purchase_date: '2024-08-30', shares: '255.0000', sold_date: '2024-09-03', sold_price: '120.00000', is_sold: true })]
    const table = esppPriceCsv(bars, [septOffering], lots)
    expect(table.headers).toEqual(['Date', 'Close', 'Subscription price', 'Avg paid to date', 'Purchase (shares)', 'Sale (shares)'])
    expect(table.rows[0]).toEqual(['2024-02-27', '75.0000', '48.50900', '', '', ''])
    expect(table.rows[1]).toEqual(['2024-02-29', '79.1120', '48.50900', '41.23265', '260.0000', ''])
    expect(table.rows[4]).toEqual(['2024-09-03', '121.0000', '48.50900', '41.23265', '', '255.0000'])
  })
  it('leaves a forward-dated purchase or sale out of the table too', () => {
    const later = esppLot({ id: 8, purchase_date: '2025-06-30', sold_date: '2025-07-31', sold_price: '200.00000', is_sold: true })
    const table = esppPriceCsv(bars, [septOffering], [esppLot(), later])
    expect(table.rows.map((r) => r[4])).toEqual(['', '260.0000', '', '', ''])
    expect(table.rows.map((r) => r[5])).toEqual(['', '', '', '', ''])
  })
})
