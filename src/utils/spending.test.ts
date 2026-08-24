import { describe, expect, it } from 'vitest'
import { budgetProgress, buildMonthSlices, hasVsBudget, monthMovers, typicalSpend } from './spending'

const categories = [
  { id: 1, name: 'Rent', slug: 'rent', sort_order: 1, is_active: true },
  { id: 2, name: 'Food', slug: 'food', sort_order: 2, is_active: true },
  { id: 3, name: 'Gas', slug: 'gas', sort_order: 3, is_active: true },
  { id: 4, name: 'Misc', slug: 'misc', sort_order: 4, is_active: true },
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
    const m = { categories: [], series: [{ category_id: 9, values: ['12.00'], budgets: [null] }] }
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
      { categoryId: 1, value: 400, deltaPrior: 300, deltaAvg: 300, deltaBudget: null },
      { categoryId: 2, value: 20, deltaPrior: -60, deltaAvg: -45, deltaBudget: null },
    ])
    // Unclipped, the new spend ranks third and the flat category never appears.
    expect(monthMovers(m, 2).map((mv) => mv.categoryId)).toEqual([1, 2, 4])
  })

  it('surfaces a flat-vs-prior category that is far off its average', () => {
    // Same as last month, but the trailing mean is 100: the avg delta alone ranks it.
    const m = matrix({ 1: ['100.00', '100.00', '250.00', '250.00'] })
    expect(monthMovers(m, 3)).toEqual([
      { categoryId: 1, value: 250, deltaPrior: 0, deltaAvg: 100, deltaBudget: null },
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
      { categoryId: 1, value: 400, deltaPrior: null, deltaAvg: 300, deltaBudget: null },
      { categoryId: 2, value: 30, deltaPrior: null, deltaAvg: 10, deltaBudget: null },
    ])
  })

  it('answers [] for the first month, an un-entered month, or out of range', () => {
    const m = matrix({ 1: ['100.00', null] })
    expect(monthMovers(m, 0)).toEqual([]) // nothing before it to move against
    expect(monthMovers(m, 1)).toEqual([]) // the month itself was never entered
    expect(monthMovers(m, -1)).toEqual([])
  })
})

describe('typicalSpend', () => {
  const matrix = {
    months: ['2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01'],
    categories: [],
    series: [
      {
        category_id: 7,
        values: ['10.00', '30.00', null, '20.00'],
        budgets: [null, null, null, null],
      },
      { category_id: 8, values: [null, null, null, null], budgets: [null, null, null, null] },
    ],
    totals: [],
    net_pay: [],
    savings_rate: [],
    four_pct_rule: [],
    total_budget: [null, null, null, null],
  }
  it('takes the median of the up-to-3 latest non-null values strictly before the month', () => {
    // Before 2026-08: candidates are 20.00 (Jul), 30.00 (May), 10.00 (Apr) → median 20.
    expect(typicalSpend(matrix, '2026-08-01', 7)).toBe(20)
    // Before 2026-06: candidates 30, 10 → even count, mean of the middle pair = 20.
    expect(typicalSpend(matrix, '2026-06-01', 7)).toBe(20)
    // Before 2026-05: only 10 → 10.
    expect(typicalSpend(matrix, '2026-05-01', 7)).toBe(10)
  })
  it('returns null with no history', () => {
    expect(typicalSpend(matrix, '2026-08-01', 8)).toBeNull()
    expect(typicalSpend(matrix, '2026-04-01', 7)).toBeNull() // nothing strictly before
    expect(typicalSpend(matrix, '2026-08-01', 99)).toBeNull() // unknown category
  })
})

describe('budget movers', () => {
  it('adds a vs-budget delta when the month has a resolved budget', () => {
    const m = matrix(
      { 1: ['100.00', '400.00'], 2: ['50.00', '20.00'] },
      { 1: ['300.00', '300.00'] },
    )
    const movers = monthMovers(m, 1)
    expect(movers.find((mv) => mv.categoryId === 1)?.deltaBudget).toBe(100) // 400 - 300
    expect(movers.find((mv) => mv.categoryId === 2)?.deltaBudget).toBeNull()
    expect(hasVsBudget(movers)).toBe(true)
  })

  it('hides the column when no mover has a budget that month', () => {
    const m = matrix({ 1: ['100.00', '400.00'] })
    expect(hasVsBudget(monthMovers(m, 1))).toBe(false)
    expect(hasVsBudget([])).toBe(false)
  })
})

describe('budgetProgress', () => {
  it('fills proportionally and clamps at 100%', () => {
    expect(budgetProgress('200.00', '400.00')).toEqual({
      spent: 200,
      budget: 400,
      fillPct: 50,
      over: false,
    })
    expect(budgetProgress('600.00', '400.00')).toEqual({
      spent: 600,
      budget: 400,
      fillPct: 100,
      over: true,
    })
  })

  it('treats a missing month value as zero spend and floors refund months at empty', () => {
    expect(budgetProgress(null, '400.00')).toEqual({
      spent: 0,
      budget: 400,
      fillPct: 0,
      over: false,
    })
    expect(budgetProgress('-25.00', '400.00')).toEqual({
      spent: -25,
      budget: 400,
      fillPct: 0,
      over: false,
    })
  })

  it('returns null for an unbudgeted category', () => {
    expect(budgetProgress('200.00', null)).toBeNull()
  })

  it('handles a zero budget: any spend is over, none is empty', () => {
    expect(budgetProgress('10.00', '0.00')).toEqual({
      spent: 10,
      budget: 0,
      fillPct: 100,
      over: true,
    })
    expect(budgetProgress('0.00', '0.00')).toEqual({
      spent: 0,
      budget: 0,
      fillPct: 0,
      over: false,
    })
  })
})
