import { describe, expect, it } from 'vitest'
import { GRID_VARIANTS, compactMoney } from '../../charts/grammar'
import { MUTED, NEGATIVE, OTHER_SERIES_COLOR, POSITIVE, SURFACE } from '../../charts/theme'
import { tooltipRows } from '../../testing/tooltipRows'
import { cardValueChartOption, cardValueCsv } from './cardValueChartOptions'

const ROWS = [
  { name: 'BILT', marginal: 918, credits: 0, fee: 0, net: 918 },
  { name: '<b>VX</b>', marginal: 602, credits: 300, fee: 395, net: 507 },
  { name: 'RH Gold', marginal: 0, credits: 0, fee: 0, net: 0, ties: 'ties Savor on Dining' },
  { name: 'Costco', marginal: 35.87, credits: 0, fee: 130, net: -94.13 },
]

type Item = {
  value: number
  itemStyle: { color: string; borderWidth?: number }
  label?: { show: boolean; position: string; color: string; formatter: string }
}

describe('cardValueChartOption', () => {
  const option = cardValueChartOption(ROWS)
  const series = (
    option.series as {
      data: Item[]
      markLine: unknown
      barMaxWidth?: number
      barMinHeight?: number
      itemStyle?: unknown
    }[]
  )[0]

  // 2026-09-23 spec §B6: the bars wear the verdict's tone — a $0 no-fee card is FREE to keep
  // (neutral), not red; red is kept for a fee the card does not earn back.
  it('colours each bar by its verdict: earns positive, free neutral, costs negative', () => {
    expect(series.data.map((d) => d.itemStyle.color)).toEqual([
      POSITIVE,
      POSITIVE,
      OTHER_SERIES_COLOR,
      NEGATIVE,
    ])
    expect(series.data.map((d) => d.value)).toEqual([918, 507, 0, -94.13])
  })

  it('still draws a $0 row: a thin neutral stub with its own label', () => {
    // A zero-length bar draws nothing and cannot be hovered; the minimum length keeps the row.
    expect(series.barMinHeight).toBe(3)
    const zero = series.data[2]
    expect(zero.itemStyle.borderWidth).toBe(0) // the SURFACE hairline would eat a 3px stub
    expect(zero.label).toEqual({
      show: true,
      position: 'right',
      color: MUTED,
      formatter: '$0 · free to keep',
    })
    // Rows with a length speak through their bar; only the stub carries words.
    expect(series.data[0].label).toBeUndefined()
    expect(series.data[3].label).toBeUndefined()
  })

  it('keeps caller order with inverse axis and draws the zero line', () => {
    expect((option.yAxis as { data: string[]; inverse: boolean }).data[0]).toBe('BILT')
    expect((option.yAxis as { inverse: boolean }).inverse).toBe(true)
    expect(series.markLine).toBeTruthy()
  })

  it('F7: net first, the escaped name, the breakdown and the verdict as the sub-line', () => {
    const format = option.tooltip as { trigger: string; formatter: (p: unknown) => string }
    expect(format.trigger).toBe('item')
    const parsed = tooltipRows(format.formatter({ dataIndex: 1 }))
    expect([parsed.lead, parsed.label, parsed.sub]).toEqual([
      '$507.00',
      '&lt;b&gt;VX&lt;/b&gt;',
      '$602.00 marginal + $300.00 credits − $395.00 fee, per year · Earns its keep',
    ])
    expect(tooltipRows(format.formatter({ dataIndex: 2 })).sub).toBe(
      '$0.00 marginal + $0.00 credits − $0.00 fee, per year · Free to keep — no extra rewards (ties Savor on Dining)',
    )
    expect(format.formatter({ dataIndex: 9 })).toBe('')
  })

  // Code review M7: a no-fee card whose pin costs rewards reads "free to keep" — its tooltip
  // has to name the pin, the one thing about it worth fixing (verdictNote, shared with the footer).
  it('the tooltip names a costly pin on a free card', () => {
    const pinned = cardValueChartOption([{ name: 'Pinned', marginal: -4.8, credits: 0, fee: 0, net: -4.8 }])
    const format = pinned.tooltip as { formatter: (p: unknown) => string }
    expect(tooltipRows(format.formatter({ dataIndex: 0 })).sub).toBe(
      '-$4.80 marginal + $0.00 credits − $0.00 fee, per year · Free to keep — no extra rewards (a pin costs $4.80/yr — unpin it)',
    )
  })

  it('grammar: horizontal grid, compact money X axis, bar marks, the zero baseline', () => {
    expect((option as { grid: unknown }).grid).toEqual(GRID_VARIANTS.horizontal)
    // F13: was full currency on every tick — the axis is a scale, the tooltip the figure.
    expect((option.xAxis as { axisLabel: { formatter: unknown } }).axisLabel.formatter).toBe(
      compactMoney,
    )
    expect(series).toMatchObject({
      barMaxWidth: 22,
      itemStyle: { borderColor: SURFACE, borderWidth: 1 },
    })
    expect(series.markLine).toEqual({
      silent: true,
      symbol: 'none',
      lineStyle: { color: MUTED, width: 1, type: 'solid' },
      label: { show: false },
      data: [{ xAxis: 0 }],
    })
  })

  it('exports the breakdown with each card’s verdict', () => {
    expect(cardValueCsv(ROWS)).toEqual({
      headers: ['Card', 'Marginal', 'Credits', 'Fee', 'Net', 'Verdict'],
      rows: [
        ['BILT', '918.00', '0.00', '0.00', '918.00', 'Earns its keep'],
        ['<b>VX</b>', '602.00', '300.00', '395.00', '507.00', 'Earns its keep'],
        ['RH Gold', '0.00', '0.00', '0.00', '0.00', 'Free to keep — no extra rewards'],
        ['Costco', '35.87', '0.00', '130.00', '-94.13', 'Costs you money'],
      ],
    })
  })
})
