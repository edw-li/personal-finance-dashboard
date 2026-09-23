import { describe, expect, it } from 'vitest'
import { CATEGORY_HUES } from '../../charts/entities'
import type { CategoryFold } from '../../charts/entities'
import { OTHER_SERIES_COLOR } from '../../charts/theme'
import { buildMonthSlices } from './monthSlices'

// Moved with buildMonthSlices from utils/spending.test.ts (the 2026-09-23 code review, 10).

/** A fold over these ids, on the registry's category hues in order (charts/entities.ts). */
const foldOf = (ids: number[]): CategoryFold => ({ ids, colors: new Map(ids.map((id, i) => [id, CATEGORY_HUES[i]])) })

const categories = [
  { id: 1, name: 'Rent', slug: 'rent', sort_order: 1, is_active: true, kind: 'living' as const },
  { id: 2, name: 'Food', slug: 'food', sort_order: 2, is_active: true, kind: 'living' as const },
  { id: 3, name: 'Gas', slug: 'gas', sort_order: 3, is_active: true, kind: 'living' as const },
  { id: 4, name: 'Misc', slug: 'misc', sort_order: 4, is_active: true, kind: 'living' as const },
]

function matrix(
  values: Record<number, (string | null)[]>,
  budgets: Record<number, (string | null)[]> = {},
) {
  return {
    categories,
    series: Object.entries(values).map(([id, v]) => ({
      category_id: Number(id),
      values: v,
      budgets: budgets[Number(id)] ?? v.map(() => null),
    })),
  }
}

describe('buildMonthSlices', () => {
  it('keeps the fold order, each slice in its fold colour, and folds the rest into Other', () => {
    const m = matrix({ 1: ['2000.00'], 2: ['300.00'], 3: ['50.00'], 4: ['25.00'] })
    expect(buildMonthSlices(m, foldOf([1, 2]), 0)).toEqual([
      { name: 'Rent', value: 2000, color: CATEGORY_HUES[0] },
      { name: 'Food', value: 300, color: CATEGORY_HUES[1] },
      { name: 'Other', value: 75, color: OTHER_SERIES_COLOR },
    ])
  })

  it('skips null, zero, and negative amounts (a pie cannot draw them)', () => {
    const m = matrix({ 1: [null], 2: ['0.00'], 3: ['-40.00'], 4: ['10.00'] })
    expect(buildMonthSlices(m, foldOf([1, 2, 3]), 0)).toEqual([
      { name: 'Other', value: 10, color: OTHER_SERIES_COLOR },
    ])
  })

  it('omits Other when the folded categories net to nothing positive', () => {
    const m = matrix({ 1: ['100.00'], 2: ['-5.00'], 3: [null], 4: ['0.00'] })
    expect(buildMonthSlices(m, foldOf([1]), 0)).toEqual([{ name: 'Rent', value: 100, color: CATEGORY_HUES[0] }])
  })

  it('returns [] for an out-of-range month or a fully empty month', () => {
    const m = matrix({ 1: ['100.00'] })
    expect(buildMonthSlices(m, foldOf([1]), -1)).toEqual([])
    expect(buildMonthSlices(m, foldOf([1]), 5)).toEqual([])
    expect(buildMonthSlices(matrix({ 1: [null], 2: [null] }), foldOf([1, 2]), 0)).toEqual([])
  })

  it('falls back to the id when a series category is missing from the list', () => {
    const m = { categories: [], series: [{ category_id: 9, values: ['12.00'], budgets: [null] }] }
    expect(buildMonthSlices(m, foldOf([9]), 0)).toEqual([{ name: '9', value: 12, color: CATEGORY_HUES[0] }])
  })
})
