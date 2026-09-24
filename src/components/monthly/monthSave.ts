import type { MonthSave, ReviewedFeeds } from '../../api/monthReview'
import type { BalanceEntry, SpendingMonthUpsert } from '../../types/api'

// The body of the month-review PUT the wizard sends (2026-09-23 spec §M1), built in one pure place
// so the rule "each part saves only itself" is a unit-tested function, not a branch of a handler.

/** What a save is about: a part's own save, the Confirm of a partly entered month's spending, or the
 *  Review's "Save progress" / "Save and close". */
export type SaveKind = 'balances' | 'spending' | 'confirm-spending' | 'review' | 'close'

export interface MonthSaveInput {
  kind: SaveKind
  /** The month's review revision as last loaded or saved — the PUT's compare-and-save. */
  revision: string
  /** The three ticks as they stand on the Review step. */
  reviewed: ReviewedFeeds
  /** Each part against what the server holds (parts.ts). */
  dirty: { balances: boolean; flows: boolean }
  /** The month has not begun (next month or later, spec §M3): its spending is never written — its
   *  boxes are disabled, and a restored draft or a stray paste must not reach the server either. */
  notBegun: boolean
  /** The balances leg as it would go out: the notes as typed, the rows already canonical. */
  balances: { notes: string; rows: BalanceEntry[] }
  /** The spending leg as it would go out: the listed rows already canonical, the take-home canonical
   *  ('' when blank), whether the month had one to clear, and the $0 consent. */
  spending: {
    amounts: SpendingMonthUpsert['amounts']
    netPay: string
    hadNetPay: boolean
    recordZero: boolean
  }
}

export interface BuiltMonthSave {
  body: MonthSave
  sendBalances: boolean
  sendSpending: boolean
}

/** The parts a Review save ("Save progress", "Save and close") sends: the DIRTY ones — an untouched
 *  part is never re-sent, and pre-filled balances nobody touched are never recorded by it — and
 *  never the spending of a month that has not begun (spec review G1). The one statement of the rule:
 *  the builder, the Review's pre-save note and the receipt's "still unsaved" lines all read it. */
export function reviewSends(input: Pick<MonthSaveInput, 'dirty' | 'notBegun'>): { balances: boolean; spending: boolean } {
  return { balances: input.dirty.balances, spending: input.dirty.flows && !input.notBegun }
}

export function buildMonthSave(input: MonthSaveInput): BuiltMonthSave {
  const whole = input.kind === 'review' || input.kind === 'close'
  // A part's own save sends that part; the Review sends what reviewSends says.
  const sends = reviewSends(input)
  const sendBalances = input.kind === 'balances' || (whole && sends.balances)
  const sendSpending = input.kind === 'spending' || (whole && sends.spending)
  const body: MonthSave = {
    expected_revision: input.revision,
    // A PUT stores the three ticks it carries (the one exception: a save that changes nothing on a
    // closed month keeps the ticks it was closed with), so each save sends them as they stand. The
    // Confirm adds the spending tick to a PUT with no part: K3's clause (d) counts only a no-leg PUT
    // with that tick as "confirmed complete" — a Review save with nothing changed and the box ticked
    // is the same PUT, and a save carrying a part beside the tick is not.
    reviewed: input.kind === 'confirm-spending' ? { ...input.reviewed, spending: true } : input.reviewed,
    close: input.kind === 'close',
  }
  if (sendBalances) {
    // Never recorded_on (spec §M4): the server stamps it, and a provisional snapshot saved on or
    // after its 1st turns final (§K4) — a sent date would stop that.
    body.balances = {
      notes: input.balances.notes.trim() === '' ? null : input.balances.notes,
      balances: input.balances.rows,
    }
  }
  if (sendSpending) {
    const spending: SpendingMonthUpsert = { amounts: input.spending.amounts }
    // Tri-state take-home: a figure is upserted; a blanked box on a month that HAD one is an explicit
    // null (the server deletes the row); a month that never had one says nothing about it.
    if (input.spending.netPay !== '') spending.net_pay = input.spending.netPay
    else if (input.spending.hadNetPay) spending.net_pay = null
    if (input.spending.recordZero) spending.confirm_zero = true
    body.spending = spending
  }
  return { body, sendBalances, sendSpending }
}
