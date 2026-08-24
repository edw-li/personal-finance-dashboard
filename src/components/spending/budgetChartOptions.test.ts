import { describe, expect, it } from 'vitest'
import { MUTED } from '../../charts/theme'
import { budgetStepSeries } from './budgetChartOptions'

describe('budgetStepSeries', () => {
  it('wears the 4%-line grammar as a step: dashed MUTED, no symbols, gaps not bridged', () => {
    const s = budgetStepSeries('Food budget', ['400.00', null, '350.00'])
    expect(s.id).toBe('budget-Food budget')
    expect(s.name).toBe('Food budget')
    expect(s.type).toBe('line')
    expect(s.step).toBe('end') // holds its level across the month, jumps AT the change
    expect(s.lineStyle).toEqual({ width: 2, type: 'dashed' })
    expect(s.color).toBe(MUTED)
    expect(s.symbol).toBe('none')
    expect(s.connectNulls).toBe(false)
    expect(s.z).toBe(9)
    expect(s.data).toEqual([400, null, 350])
  })
})
