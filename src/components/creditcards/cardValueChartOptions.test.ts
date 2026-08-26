import { describe, expect, it } from 'vitest'
import { NEGATIVE, POSITIVE } from '../../charts/theme'
import { cardValueChartOption } from './cardValueChartOptions'

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

  it('tooltip spells the breakdown and escapes the name', () => {
    const formatter = (option.tooltip as { formatter: (p: unknown) => string }).formatter
    const html = formatter({ dataIndex: 1 })
    expect(html).toContain('&lt;b&gt;VX&lt;/b&gt;')
    expect(html).toContain('$602.00') // marginal — Intl USD, cents and all
    expect(html).toContain('$507.00') // net
  })
})
