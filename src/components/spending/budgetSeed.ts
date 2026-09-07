import type { BudgetSeedOut, BudgetSuggestion, CategoryKind, SpendingMatrix } from '../../types/api'

// Pure companions of the Budget card's seed (2026-09-07 spec §3). Number() here is display-side
// math on server strings — the chart builders' license.

/** Mirrors the server's MIN_SEED_MONTHS: fewer complete months and nothing is seeded. */
export const MIN_SEED_MONTHS = 3

/**
 * What a seed from the focused month would do: `writes` = categories with a seed whose
 * resolved budget that month is not already the seed (the server skips those as unchanged);
 * `rewrites` = the writes that replace a budget already in force. Both are known client-side,
 * so the re-seed confirm can say them before anything is sent.
 */
export function seedCounts(
  matrix: Pick<SpendingMatrix, 'series'>,
  monthIndex: number,
  suggestions: BudgetSuggestion[],
): { writes: number; rewrites: number } {
  const budgetById = new Map(matrix.series.map((s) => [s.category_id, s.budgets[monthIndex] ?? null]))
  let writes = 0
  let rewrites = 0
  for (const s of suggestions) {
    if (s.seed === null) continue
    const resolved = budgetById.get(s.category_id) ?? null
    if (resolved !== null && Number(resolved) === Number(s.seed)) continue
    writes += 1
    if (resolved !== null) rewrites += 1
  }
  return { writes, rewrites }
}

type SkipReason = BudgetSeedOut['skipped'][number]['reason']

// Fixed order, so two seeds read alike: the spending shapes first, the bookkeeping last.
const SKIP_WORDS: [SkipReason, string][] = [
  ['dormant', 'never spent'],
  ['sparse', 'too little history'],
  ['kind', 'not living spend'],
  ['unchanged', 'already at its average'],
]

/** "skipped 6 — 3 never spent, 3 not living spend"; null when nothing was skipped. */
export function skipSummary(skipped: BudgetSeedOut['skipped']): string | null {
  if (skipped.length === 0) return null
  const counts = new Map<SkipReason, number>()
  for (const s of skipped) counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1)
  const parts = SKIP_WORDS.filter(([reason]) => counts.has(reason)).map(
    ([reason, words]) => `${counts.get(reason)} ${words}`,
  )
  return `skipped ${skipped.length} — ${parts.join(', ')}`
}

/**
 * One line on the category's spending shape (spec §3.4 table); null when an ordinary
 * variable category needs no warning. The kind reads first: a tax payment or a transfer is
 * not spending to budget whatever its shape.
 */
export function profileCue(suggestion: BudgetSuggestion, kind: CategoryKind): string | null {
  if (kind !== 'living') {
    return 'Not living spend — the seed leaves tax payments and transfers unbudgeted.'
  }
  switch (suggestion.profile) {
    case 'fixed':
      return 'Steady — within 10% every month; the latest month is the honest target.'
    case 'episodic':
      return '$0 most months, then spikes — the mean keeps the year honest, but a monthly meter reads empty, then over. An annual envelope is the real fix.'
    case 'variable':
      return suggestion.cv !== null && Number(suggestion.cv) >= 1
        ? 'Varies a lot — the median is the typical month; the mean keeps the yearly total honest.'
        : null
    case 'sparse':
      return `Only ${suggestion.months} complete ${suggestion.months === 1 ? 'month' : 'months'} in the window — not enough to suggest.`
    case 'dormant':
      return 'Nothing spent in the window.'
  }
}
