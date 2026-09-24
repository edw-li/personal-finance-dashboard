import type { MonthBalances } from '../../types/api'
import { formatAsOf } from '../../utils/asOf'
import { addMonths, currentMonthIso, currentYear } from '../../utils/months'

// The monthly update's words (2026-09-23 spec §M1–§M5). A balance is named by the day it describes
// ("Oct 1 balances"), spending by the month it covers ("September spending & take-home"); both
// carry their year only outside the server's current year — the rule utils/asOf.ts applies to
// every as-of label, reused here through formatAsOf so the two can never disagree.

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** 'Oct 1' — ', 2025' outside the server's year. */
export function dayOf(iso: string): string {
  const day = iso.slice(0, 10)
  return formatAsOf({ month: day, as_of: day, provisional: false })
}

/** 'September' — ' 2025' outside the server's year. */
export function monthNameOf(iso: string): string {
  const name = MONTH_NAMES[Number(iso.slice(5, 7)) - 1]
  const year = Number(iso.slice(0, 4))
  return year === currentYear() ? name : `${name} ${year}`
}

/** Month M's balances part is the balances on M's 1st. */
export const balancesPartName = (month: string) => `${dayOf(month)} balances`

/** Month M's flows part is M's whole month of spending and take-home. */
export const flowsPartName = (month: string) => `${monthNameOf(month)} spending & take-home`

/** Where a month sits against the server's current month (spec §M3): balances open early for next
 *  month only, and spending once its month has begun. */
export type MonthPhase = 'past' | 'current' | 'next' | 'beyond'

export function monthPhase(month: string, current: string = currentMonthIso()): MonthPhase {
  if (month < current) return 'past'
  if (month === current) return 'current'
  return month === addMonths(current, 1) ? 'next' : 'beyond'
}

/** A month's snapshot as GET /net-worth/months/{m} describes it (spec §K2). */
export interface BalancesMeta {
  exists: boolean
  recorded_on: string | null
  as_of: string | null
  provisional: boolean
}

/** K2's two fields are optional on the wire type (a fixture written before them still compiles):
 *  absent reads as final, with no as-of of its own. */
export function metaOf(
  month: Pick<MonthBalances, 'exists' | 'recorded_on'> & Partial<Pick<MonthBalances, 'as_of' | 'provisional'>>,
): BalancesMeta {
  return {
    exists: month.exists,
    recorded_on: month.recorded_on,
    as_of: month.as_of ?? null,
    provisional: month.provisional ?? false,
  }
}

/** Recorded before its own 1st — the snapshot a save on or after the 1st finalizes (K4). */
export function recordedEarly(month: string, meta: BalancesMeta): boolean {
  return meta.exists && meta.recorded_on !== null && meta.recorded_on < month
}

/** The read-only line under the Balances heading (spec §M4) — the Recorded-on box's successor. */
export function balancesLine(month: string, meta: BalancesMeta): string {
  const first = dayOf(month)
  if (!meta.exists) return `Balances as of ${first} · not recorded yet`
  const recorded = meta.recorded_on
  if (meta.provisional && recorded !== null && recorded < month) {
    return `Balances as of ${dayOf(meta.as_of ?? recorded)} · provisional for ${first} — recorded early, on ${dayOf(recorded)}`
  }
  const when = recorded === null ? 'recorded date unknown' : `recorded ${dayOf(recorded)}`
  // Provisional with no early date: only an API client or an import stores a month still ahead of
  // today dated on or after its 1st (or undated), and K2 gives such a snapshot no as-of.
  if (meta.provisional) return `Balances for ${first} · provisional — ${when}`
  return `Balances as of ${first} · ${when}`
}

/** A provisional snapshot whose 1st has arrived (spec §M4). */
export const confirmBanner = (month: string, recordedOn: string) =>
  `These ${dayOf(month)} balances were recorded early, on ${dayOf(recordedOn)}. Update any account that changed and save — saving on or after ${dayOf(month)} makes them final.`

/** Next month's balances, before their 1st (spec §M3). */
export const earlyBanner = (month: string) =>
  `These are ${dayOf(month)} balances recorded before ${dayOf(month)} — they stay provisional until you save them again on or after ${dayOf(month)}.`

/** A month beyond next month (spec §M3): both saves stay disabled. */
export const beyondBanner = (month: string) =>
  `${dayOf(month)} balances can be recorded from ${dayOf(addMonths(month, -1))} (early) or on ${dayOf(month)}.`

/** Spending of a month that has not begun (spec §M3). */
export const notBegunSentence = (month: string) =>
  `${monthNameOf(month)} spending can be entered once ${monthNameOf(month)} begins.`

/** The current month's spending (spec §M3). */
export const inProgressSentence = (month: string) =>
  `${monthNameOf(month)} is in progress — its spending and take-home are due once it ends. What you save now is kept as a partial month.`

/** An ended month whose spending was saved while it ran — K3's *partial* (spec §M1). */
export const partialBanner = (month: string) =>
  `${monthNameOf(month)}'s spending was saved during ${monthNameOf(month)}. Add anything that has posted since and save, or confirm it's complete.`

/** Closing a month that has no snapshot (spec §M1). */
export const noBalancesBlocker = (month: string) =>
  `Record ${dayOf(month)} balances before closing ${monthNameOf(month)}.`

/** K4's close blocker — word for word the server's (services/month_review.early_balances_blocker). */
export const earlyBalancesBlocker = (month: string, recordedOn: string) =>
  `${dayOf(month)} balances were recorded early, on ${dayOf(recordedOn)} — save them again on or after ${dayOf(month)} before closing ${monthNameOf(month)}.`

/** Review's pre-save line: which parts this save writes (a Review save sends only the dirty ones). */
export function reviewSaveNote(
  month: string,
  dirty: { balances: boolean; spending: boolean; balancesExist: boolean },
): string {
  const balances = balancesPartName(month)
  const spending = `${monthNameOf(month)} spending`
  if (dirty.balances && dirty.spending) return `This save writes ${balances} and ${spending}.`
  if (dirty.balances) return `This save writes ${balances} — ${spending} is unchanged and is not sent.`
  if (dirty.spending) {
    return dirty.balancesExist
      ? `This save writes ${spending} — ${balances} are unchanged and are not sent.`
      : `This save writes ${spending} — ${balances} are not recorded yet; record them on the Balances step.`
  }
  return 'Nothing has changed — saving records your confirmations only.'
}
