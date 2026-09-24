import { canonicalAmount, isAmount } from '../../utils/amount'

// Glossary. A month has two PARTS: its BALANCES (the snapshot on its 1st) and its FLOWS — the
// month's spending (every category amount, tax and transfers included) and its household
// take-home. The code and the draft keys say "flows"; the screen says "spending & take-home"; the
// month-review PUT's `spending` leg carries both (amounts and net_pay). The review ticks split the
// flows again: `reviewed.spending` certifies the category amounts only — never the take-home,
// which `reviewed.take_home` certifies.
//
// The two parts of a month (2026-09-23 spec §M1) and the rule that says one has changed: a part is
// DIRTY when it differs from what was loaded or last saved, and only a dirty part is sent. Amounts
// compare as the numbers a save would write — '1500', '1500.00', '$1,500' and '=1000+500' are one
// figure — so reformatting a cell never offers a save (or files a draft) for work nobody did; text
// that is not an amount compares as itself, so it stays dirty and its box stays red.

export interface BalancesPart {
  balances: Record<number, string>
  notes: string
  /** The parents this month keeps HAND-TYPED, ascending (2026-09-04 review). */
  typedParents: number[]
}

export interface FlowsPart {
  amounts: Record<number, string>
  netPay: string
  /** The $0 consent: part of what a save sends, never part of a draft (2026-09-04 spec §4). */
  recordZero: boolean
}

/** A cell's COMMITTED value as a number — what a save would write, read the way every live total
 *  on the page reads it: a cell still holding "$1,600" or "=200+50" (no blur yet) is entered, and a
 *  blank, or text that is not an amount, reads as 0. */
export const committed = (raw: string | undefined) => Number(canonicalAmount(raw ?? '')) || 0

export function sortedIds(ids: Iterable<number>): number[] {
  return [...ids].sort((a, b) => a - b)
}

function amountKey(raw: string | undefined): string {
  const text = (raw ?? '').trim()
  return isAmount(text) ? `n:${Number(canonicalAmount(text))}` : `t:${text}`
}

// Integer keys enumerate ascending, so the same values always serialize the same way.
const recordKey = (record: Record<number, string>) =>
  Object.entries(record).map(([id, value]) => [id, amountKey(value)])

export function balancesKey(part: {
  balances: Record<number, string>
  notes: string
  typedParents: Iterable<number>
}): string {
  return JSON.stringify([recordKey(part.balances), part.notes, sortedIds(part.typedParents)])
}

export function flowsKey(part: { amounts: Record<number, string>; netPay: string }): string {
  // A blank take-home means "none", never zero — it keeps a key of its own.
  return JSON.stringify([recordKey(part.amounts), part.netPay.trim() === '' ? '' : amountKey(part.netPay)])
}
