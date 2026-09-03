import { describe, expect, it } from 'vitest'
import { budgetReference, referenceLine } from './reference'
import { MUTED } from './theme'

describe('referenceLine', () => {
  it('is the 4%-rule series exactly: dashed MUTED 2px, no symbols, z 9, gaps kept', () => {
    expect(referenceLine('Sustainable spend', [1, null, 3], { id: 'sustainable-spend' })).toEqual({
      id: 'sustainable-spend',
      name: 'Sustainable spend',
      type: 'line',
      symbol: 'none',
      lineStyle: { width: 2, type: 'dashed' },
      color: MUTED,
      z: 9,
      connectNulls: false,
      data: [1, null, 3],
    })
    expect('id' in referenceLine('x', [])).toBe(false)
    expect('step' in referenceLine('x', [])).toBe(false)
  })
  // Was "absorbs budgetStepSeries byte for byte" until that module was retired; the shape it
  // pinned is spelled out here so budgetReference keeps a direct case of its own.
  it('budgetReference is the step-end budget series: id, numbers, nulls kept', () => {
    expect(budgetReference('Food budget', ['400.00', null, '350.00'])).toEqual({
      id: 'budget-Food budget',
      name: 'Food budget',
      type: 'line',
      symbol: 'none',
      step: 'end',
      lineStyle: { width: 2, type: 'dashed' },
      color: MUTED,
      z: 9,
      connectNulls: false,
      data: [400, null, 350],
    })
  })
})
