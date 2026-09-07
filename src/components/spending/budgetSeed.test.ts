import { describe, expect, it } from 'vitest'
import type { BudgetSuggestion, SpendingMatrix } from '../../types/api'
import { MIN_SEED_MONTHS, profileCue, seedCounts, skipSummary } from './budgetSeed'

const suggestion = (
  over: Partial<BudgetSuggestion> & Pick<BudgetSuggestion, 'category_id'>,
): BudgetSuggestion => ({
  profile: 'variable',
  months: 12,
  mean: '100.00',
  median: '90.00',
  latest: '110.00',
  latest_month: '2026-08-01',
  cv: '0.2000',
  seed: '100.00',
  skip_reason: null,
  ...over,
})

const series: SpendingMatrix['series'] = [
  { category_id: 1, values: ['1.00'], budgets: [null] }, // unbudgeted → a write
  { category_id: 2, values: ['1.00'], budgets: ['80.00'] }, // budgeted, differs → a rewrite
  { category_id: 3, values: ['1.00'], budgets: ['100.00'] }, // already AT the seed → the server skips it
  { category_id: 4, values: ['1.00'], budgets: [null] }, // no seed → nothing
]

describe('seedCounts', () => {
  it('counts writes and the rewrites among them; unchanged and unseedable rows stay out', () => {
    const suggestions = [
      suggestion({ category_id: 1 }),
      suggestion({ category_id: 2 }),
      suggestion({ category_id: 3 }),
      suggestion({ category_id: 4, seed: null, profile: 'dormant', skip_reason: 'dormant' }),
    ]
    expect(seedCounts({ series }, 0, suggestions)).toEqual({ writes: 2, rewrites: 1 })
    expect(MIN_SEED_MONTHS).toBe(3)
  })
})

describe('skipSummary', () => {
  it('is null for nothing skipped, otherwise counts each reason in a fixed order', () => {
    expect(skipSummary([])).toBeNull()
    expect(
      skipSummary([
        { category_id: 5, reason: 'kind' },
        { category_id: 6, reason: 'dormant' },
        { category_id: 7, reason: 'dormant' },
        { category_id: 8, reason: 'unchanged' },
        { category_id: 9, reason: 'sparse' },
      ]),
    ).toBe('skipped 5 — 2 never spent, 1 too little history, 1 not living spend, 1 already at its average')
  })
})

describe('profileCue', () => {
  it('names the shape: steady, episodic, high-swing variable; quiet for an ordinary one', () => {
    expect(profileCue(suggestion({ category_id: 1, profile: 'fixed' }), 'living')).toMatch(/^Steady/)
    expect(profileCue(suggestion({ category_id: 1, profile: 'episodic' }), 'living')).toMatch(/annual envelope/)
    expect(profileCue(suggestion({ category_id: 1, cv: '1.3308' }), 'living')).toMatch(/^Varies a lot/)
    expect(profileCue(suggestion({ category_id: 1, cv: '0.4796' }), 'living')).toBeNull()
    expect(profileCue(suggestion({ category_id: 1, profile: 'sparse', months: 2 }), 'living')).toBe(
      'Only 2 complete months in the window — not enough to suggest.',
    )
    expect(profileCue(suggestion({ category_id: 1, profile: 'sparse', months: 1 }), 'living')).toBe(
      'Only 1 complete month in the window — not enough to suggest.',
    )
    expect(profileCue(suggestion({ category_id: 1, profile: 'dormant' }), 'living')).toBe(
      'Nothing spent in the window.',
    )
    // The kind reads first: a dormant transfer is still "not living spend".
    expect(profileCue(suggestion({ category_id: 1, profile: 'dormant' }), 'transfer')).toMatch(/^Not living spend/)
  })
})
