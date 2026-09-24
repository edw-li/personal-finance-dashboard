import type { SpendingMatrix } from '../../types/api'

// The Budgets view's month rules (2026-09-23 spec §B5). Pure. The matrix's RESOLVED budget
// column is the only budget truth the page holds — there is no budget-history GET (the
// editor's PUT response is the only history) — so everything here reads that column. Month
// strings are compared by their YYYY-MM prefix: the wire says YYYY-MM-01, old fixtures YYYY-MM.
//
// Known limit of reading the resolved column: a budget row dated AFTER the last entered month
// resolves in no matrix month yet, so the card cannot see it until that month is entered —
// exactly as the meters could not before.
//
// "Is this month still in progress" is charts/partial.isPartialMonth — the one partial rule
// (2026-09-23 time-contract spec §K1); this file kept a second copy until then.

type BudgetBook = Pick<SpendingMatrix, 'months' | 'series'>

const monthKey = (month: string) => month.slice(0, 7)

const inForce = (budget: string | null | undefined) => (budget ?? null) !== null

/** Month indexes, ascending, where at least one category has a budget in force. */
export function budgetedIndexes(book: BudgetBook): number[] {
  return book.months.flatMap((_, index) =>
    book.series.some((series) => inForce(series.budgets[index])) ? [index] : [],
  )
}

/** How many categories have a budget in force at month `index`. */
export function budgetCountAt(book: BudgetBook, index: number): number {
  return book.series.filter((series) => inForce(series.budgets[index])).length
}

/**
 * The month the Budgets view opens on when the URL names none: today's month when a budget
 * is in force there; else the latest EARLIER month with one (today not entered yet, or its
 * budgets ended); else — a matrix whose only budgeted months lie ahead — the earliest of
 * those. null when no month has a budget: the caller's own default applies.
 *
 * The spec's words are "else the latest month that has a resolved budget"; "earlier" is the
 * one refinement, so a matrix holding a pre-entered FUTURE month never opens the card there
 * while the reader's current or past months have budgets.
 */
export function budgetsOpeningIndex(book: BudgetBook, currentMonth: string): number | null {
  const budgeted = budgetedIndexes(book)
  if (budgeted.length === 0) return null
  const now = monthKey(currentMonth)
  const upToNow = budgeted.filter((index) => monthKey(book.months[index]) <= now)
  return upToNow.length > 0 ? upToNow[upToNow.length - 1] : budgeted[0]
}

/**
 * The month (as an index) the budget in force at `index` took effect: the first month of the
 * unbroken run of the same amount that ends there. Exact wherever the entered months are
 * contiguous; across a gap in entered months it names the first month the matrix shows, and a
 * budget older than the matrix reads as starting on its first month.
 */
export function budgetSinceIndex(budgets: (string | null)[], index: number): number | null {
  const amount = budgets[index] ?? null
  if (amount === null) return null
  let start = index
  while (start > 0) {
    const before = budgets[start - 1] ?? null
    // Amounts, not spellings: "10" and "10.00" are one budget. Display-side comparison only.
    if (before === null || Number(before) !== Number(amount)) break
    start -= 1
  }
  return start
}

/** Where the budgets are when the viewed month has none (the aware empty state). */
export interface BudgetsElsewhere {
  /** The month to offer: where they start or resume, or the last month they were in force. */
  targetIndex: number
  relation: 'start' | 'resume' | 'ended'
  /** Budgets in force at the target. */
  count: number
  /** Every category ever budgeted is budgeted at the target — only then may the copy say
   *  "your 13 budgets": with a budget that starts later, 13 is not all of them. */
  everyBudget: boolean
}

export function budgetsElsewhere(book: BudgetBook, viewedIndex: number): BudgetsElsewhere | null {
  const budgeted = budgetedIndexes(book)
  if (budgeted.length === 0 || budgeted.includes(viewedIndex)) return null
  const later = budgeted.find((index) => index > viewedIndex)
  const earlier = budgeted.filter((index) => index < viewedIndex).at(-1)
  // budgeted is non-empty and excludes viewedIndex, so one of the two exists.
  const targetIndex = later ?? (earlier as number)
  const relation = later === undefined ? 'ended' : earlier === undefined ? 'start' : 'resume'
  const count = budgetCountAt(book, targetIndex)
  const everBudgeted = book.series.filter((series) => series.budgets.some(inForce)).length
  return { targetIndex, relation, count, everyBudget: count === everBudgeted }
}
