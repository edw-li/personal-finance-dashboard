import { describe, expect, it } from 'vitest'
import { buildMonthSlices, monthMovers } from './spending'

const categories = [
  { id: 1, name: 'Rent', slug: 'rent', sort_order: 1, is_active: true },
  { id: 2, name: 'Food', slug: 'food', sort_order: 2, is_active: true },
  { id: 3, name: 'Gas', slug: 'gas', sort_order: 3, is_active: true },
  { id: 4, name: 'Misc', slug: 'misc', sort_order: 4, is_active: true },
]

function matrix(values: Record<number, (string | null)[]>) {
  return {
    categories,
    series: Object.entries(values).map(([id, v]) => ({ category_id: Number(id), values: v })),
  }
}

describe('buildMonthSlices', () => {
  it('keeps topIds order (palette slots) and folds the rest into Other', () => {
    const m = matrix({ 1: ['2000.00'], 2: ['300.00'], 3: ['50.00'], 4: ['25.00'] })
    expect(buildMonthSlices(m, [1, 2], 0)).toEqual([
      { name: 'Rent', value: 2000, slot: 0 },
      { name: 'Food', value: 300, slot: 1 },
      { name: 'Other', value: 75, slot: null },
    ])
  })

  it('skips null, zero, and negative amounts (a pie cannot draw them)', () => {
    const m = matrix({ 1: [null], 2: ['0.00'], 3: ['-40.00'], 4: ['10.00'] })
    expect(buildMonthSlices(m, [1, 2, 3], 0)).toEqual([
      { name: 'Other', value: 10, slot: null },
    ])
  })

  it('omits Other when the folded categories net to nothing positive', () => {
    const m = matrix({ 1: ['100.00'], 2: ['-5.00'], 3: [null], 4: ['0.00'] })
    expect(buildMonthSlices(m, [1], 0)).toEqual([{ name: 'Rent', value: 100, slot: 0 }])
  })

  it('returns [] for an out-of-range month or a fully empty month', () => {
    const m = matrix({ 1: ['100.00'] })
    expect(buildMonthSlices(m, [1], -1)).toEqual([])
    expect(buildMonthSlices(m, [1], 5)).toEqual([])
    expect(buildMonthSlices(matrix({ 1: [null], 2: [null] }), [1, 2], 0)).toEqual([])
  })

  it('falls back to the id when a series category is missing from the list', () => {
    const m = { categories: [], series: [{ category_id: 9, values: ['12.00'] }] }
    expect(buildMonthSlices(m, [9], 0)).toEqual([{ name: '9', value: 12, slot: 0 }])
  })
})

describe('monthMovers', () => {
  it('ranks by the larger delta and keeps the top N', () => {
    const m = matrix({
      1: ['100.00', '100.00', '400.00'], // +300 vs prior, +300 vs avg
      2: ['50.00', '80.00', '20.00'], // -60 vs prior, -45 vs avg
      3: ['10.00', '10.00', '10.00'], // flat both ways — not a mover
      4: [null, null, '30.00'], // new spend: +30 vs prior's implicit 0, no history for avg
    })
    expect(monthMovers(m, 2, 2)).toEqual([
      { categoryId: 1, value: 400, deltaPrior: 300, deltaAvg: 300 },
      { categoryId: 2, value: 20, deltaPrior: -60, deltaAvg: -45 },
    ])
    // Unclipped, the new spend ranks third and the flat category never appears.
    expect(monthMovers(m, 2).map((mv) => mv.categoryId)).toEqual([1, 2, 4])
  })

  it('surfaces a flat-vs-prior category that is far off its average', () => {
    // Same as last month, but the trailing mean is 100: the avg delta alone ranks it.
    const m = matrix({ 1: ['100.00', '100.00', '250.00', '250.00'] })
    expect(monthMovers(m, 3)).toEqual([
      { categoryId: 1, value: 250, deltaPrior: 0, deltaAvg: 100 },
    ])
  })

  it('nulls the prior delta when the previous month was never entered', () => {
    // Month 1 is a hole (every category null) — a delta against it would be fiction.
    const m = matrix({
      1: ['100.00', null, '400.00'],
      2: ['20.00', null, '30.00'],
    })
    // Averages skip the hole: cat 1's window is [100] -> avg 100, cat 2's [20] -> avg 20.
    expect(monthMovers(m, 2)).toEqual([
      { categoryId: 1, value: 400, deltaPrior: null, deltaAvg: 300 },
      { categoryId: 2, value: 30, deltaPrior: null, deltaAvg: 10 },
    ])
  })

  it('answers [] for the first month, an un-entered month, or out of range', () => {
    const m = matrix({ 1: ['100.00', null] })
    expect(monthMovers(m, 0)).toEqual([]) // nothing before it to move against
    expect(monthMovers(m, 1)).toEqual([]) // the month itself was never entered
    expect(monthMovers(m, -1)).toEqual([])
  })
})
