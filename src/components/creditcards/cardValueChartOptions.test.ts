import { describe, expect, it } from 'vitest'
import { GRID_VARIANTS, compactMoney } from '../../charts/grammar'
import { MUTED, NEGATIVE, POSITIVE, SURFACE } from '../../charts/theme'
import { tooltipRows } from '../../testing/tooltipRows'
import { cardValueChartOption, cardValueCsv } from './cardValueChartOptions'

const ROWS = [
  { name: 'BILT', marginal: 918, credits: 0, fee: 0, net: 918 },
  { name: '<b>VX</b>', marginal: 602, credits: 300, fee: 395, net: 507 },
  { name: 'RH Gold', marginal: 0, credits: 0, fee: 0, net: 0 },
]

describe('cardValueChartOption', () => {
  const option = cardValueChartOption(ROWS)
  const series = (
    option.series as {
      data: { value: number; itemStyle: { color: string } }[]
      markLine: unknown
      barMaxWidth?: number
      itemStyle?: unknown
    }[]
  )[0]

  it('colors by sign — zero net reads NEGATIVE (droppable)', () => {
    expect(series.data.map((d) => d.itemStyle.color)).toEqual([POSITIVE, POSITIVE, NEGATIVE])
    expect(series.data.map((d) => d.value)).toEqual([918, 507, 0])
  })

  it('keeps caller order with inverse axis and draws the zero line', () => {
    expect((option.yAxis as { data: string[]; inverse: boolean }).data[0]).toBe('BILT')
    expect((option.yAxis as { inverse: boolean }).inverse).toBe(true)
    expect(series.markLine).toBeTruthy()
  })

  it('F7: net first, the escaped name, the breakdown as the sub-line', () => {
    const format = option.tooltip as { trigger: string; formatter: (p: unknown) => string }
    expect(format.trigger).toBe('item')
    const parsed = tooltipRows(format.formatter({ dataIndex: 1 }))
    expect([parsed.lead, parsed.label, parsed.sub]).toEqual([
      '$507.00',
      '&lt;b&gt;VX&lt;/b&gt;',
      '$602.00 marginal + $300.00 credits − $395.00 fee, per year',
    ])
    expect(format.formatter({ dataIndex: 9 })).toBe('')
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

  it('exports the breakdown', () => {
    expect(cardValueCsv(ROWS)).toEqual({
      headers: ['Card', 'Marginal', 'Credits', 'Fee', 'Net'],
      rows: [
        ['BILT', '918.00', '0.00', '0.00', '918.00'],
        ['<b>VX</b>', '602.00', '300.00', '395.00', '507.00'],
        ['RH Gold', '0.00', '0.00', '0.00', '0.00'],
      ],
    })
  })
})
