import { describe, expect, it } from 'vitest'
import type { EChartsOption } from '../../charts/echarts'
import { BAR_MARKS, GRID_VARIANTS } from '../../charts/grammar'
import { INK, MUTED, NEGATIVE, PALETTE, SURFACE } from '../../charts/theme'
import { isGrammarTooltip } from '../../charts/tooltip'
import { tooltipRows } from '../../testing/tooltipRows'
import { anatomyLots, esppLot, esppLotsResponse } from '../../testing/esppFixtures'
import {
  APPRECIATION, BARGAIN, LOSS, PAID, hasAnatomy, lotAnatomyCsv, lotAnatomyOption, lotLabels, sortLots,
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
