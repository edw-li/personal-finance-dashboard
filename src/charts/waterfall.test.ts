import { describe, expect, it } from 'vitest'
import { tooltipRows } from '../testing/tooltipRows'
import { OTHER_SERIES_COLOR, POSITIVE, SEQUENTIAL_BLUE, SURFACE } from './theme'
import { isGrammarTooltip } from './tooltip'
import { waterfallCsv, waterfallSeries, waterfallSteps, waterfallTooltip } from './waterfall'

// The 2024 tax year (taxChartOptions.test's canonical table): gross, seven taxes, take-home.
const TAXES: [string, number][] = [
  ['Federal', 40782.88], ['State', 15901.12], ['Medicare', 3634.95], ['Soc. Sec.', 10453.2],
  ['SDI', 1950], ['Cap. gains', 26.87], ['NIIT', 75.59],
]
const steps = () =>
  waterfallSteps(
    { label: 'Gross', amount: 237973.17, color: OTHER_SERIES_COLOR },
    TAXES.map(([label, tax], i) => ({ label, amount: tax, delta: -tax, color: SEQUENTIAL_BLUE[4 + i] })),
    { label: 'Take-home', amount: 165148.56, color: POSITIVE },
  )

describe('waterfallSteps', () => {
  it('floats each step on the remainder LEFT after it, rounding the chain to cents', () => {
    const s = steps()
    expect(s.map((x) => x.base)).toEqual([0, 197190.29, 181289.17, 177654.22, 167201.02, 165251.02, 165224.15, 165148.56, 0])
    expect(s.map((x) => x.height)).toEqual([237973.17, 40782.88, 15901.12, 3634.95, 10453.2, 1950, 26.87, 75.59, 165148.56])
    expect(s[1].remaining).toBe(197190.29)
    expect(s[0].remaining).toBeNull()
    expect(s[8].remaining).toBeNull()
    // The chain lands on the closing amount to the cent — the caller's invariant to assert.
    expect(s[7].remaining).toBe(165148.56)
  })
  it('draws a positive delta (a credit, a gain) as a step UP from the lower remainder', () => {
    const s = waterfallSteps(
      { label: 'Start', amount: 100, color: OTHER_SERIES_COLOR },
      [{ label: 'Refund', amount: 25, delta: 25, color: POSITIVE }],
      { label: 'End', amount: 125, color: POSITIVE },
    )
    expect(s[1]).toMatchObject({ base: 100, height: 25, remaining: 125 })
  })
})

describe('waterfallSeries', () => {
  it('is the placeholder + Amount pair: stack all, silent transparent floor, 24px capped bars with direct labels', () => {
    const [placeholder, amount] = waterfallSeries(steps())
    expect(placeholder).toMatchObject({
      name: 'placeholder', type: 'bar', stack: 'waterfall', stackStrategy: 'all', silent: true,
      itemStyle: { color: 'transparent' }, tooltip: { show: false },
    })
    expect(placeholder.data).toEqual(steps().map((s) => s.base))
    expect(amount).toMatchObject({
      name: 'Amount', type: 'bar', stack: 'waterfall', stackStrategy: 'all', barMaxWidth: 24,
      itemStyle: { borderColor: SURFACE, borderWidth: 1 },
    })
    expect(amount.data[1]).toEqual({ value: 40782.88, itemStyle: { color: SEQUENTIAL_BLUE[4] } })
    expect(amount.label.formatter({ dataIndex: 1 })).toBe('$40.8K')
  })
})

describe('waterfallTooltip / waterfallCsv', () => {
  it('reads the step by index: the reported amount first, the label, what is left', () => {
    const { formatter, trigger } = waterfallTooltip(steps())
    expect(trigger).toBe('item')
    expect(isGrammarTooltip(formatter)).toBe(true)
    const federal = tooltipRows(formatter({ dataIndex: 1 }))
    expect([federal.lead, federal.label, federal.sub]).toEqual(['$40,782.88', 'Federal', 'Left: $197,190.29'])
    expect(tooltipRows(formatter({ dataIndex: 0 })).sub).toBeUndefined()
    expect(formatter({ dataIndex: 42 })).toBe('')
  })
  it('exports step, amount, remaining', () => {
    expect(waterfallCsv(steps()).headers).toEqual(['Step', 'Amount', 'Remaining'])
    expect(waterfallCsv(steps()).rows[1]).toEqual(['Federal', '40782.88', '197190.29'])
    expect(waterfallCsv(steps()).rows[8]).toEqual(['Take-home', '165148.56', ''])
  })
})
