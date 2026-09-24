import type { NetWorthSummary, NetWorthTimeseries, SnapshotStateOut } from '../../types/api'
import { addMonths } from '../../utils/months'

// Snapshot dates on the page side (2026-09-23 spec §K2, §T1, §T2, §T7): the wire's as-of lists
// turned into the `Dated` states utils/asOf.ts builds its words from, and K2's "current
// snapshot" rule mirrored for a timeseries a page already holds. The rule is the server's
// (services/snapshot_state.py: the latest snapshot whose month is at most the month after
// today's) and never a second one; a payload without the new lists — a replayed cache, an older
// fixture — reads as final, as of its 1st, which is exactly what it said before them.

export type Dated = Pick<SnapshotStateOut, 'month' | 'as_of' | 'provisional'>

/** The current snapshot's index: the latest month at most one month after today's; -1 when
 *  none qualifies. `months` is ascending, as the wire sends it. */
export function currentSnapshotIndex(months: readonly string[], todayIso: string): number {
  const bound = addMonths(`${todayIso.slice(0, 7)}-01`, 1)
  let index = -1
  months.forEach((month, i) => {
    if (month <= bound) index = i
  })
  return index
}

type Lists = Pick<NetWorthTimeseries, 'months'> & Partial<Pick<NetWorthTimeseries, 'as_of' | 'provisional'>>

/** Snapshot `index`'s date and standing from the timeseries lists. */
export function snapshotAt(ts: Lists, index: number): Dated {
  const month = ts.months[index]
  const listed = ts.as_of?.[index]
  return { month, as_of: listed === undefined ? month : listed, provisional: ts.provisional?.[index] ?? false }
}

/** The summary's viewed snapshot as a state; null on an empty book (no month). */
export function summaryState(
  summary: Pick<NetWorthSummary, 'month'> & Partial<Pick<NetWorthSummary, 'as_of' | 'provisional'>>,
): Dated | null {
  if (summary.month === null) return null
  return {
    month: summary.month,
    as_of: summary.as_of === undefined ? summary.month : summary.as_of,
    provisional: summary.provisional ?? false,
  }
}

/** The dates a range chip cuts on (T7): each snapshot's as-of, its month where that is unknown.
 *  Identical to the month keys for final snapshots; an early Jan 1 snapshot typed on Dec 28 stays
 *  in the old year's YTD. */
export function rangeDates(ts: Pick<NetWorthTimeseries, 'months'> & Partial<Pick<NetWorthTimeseries, 'as_of'>>): string[] {
  return ts.months.map((month, i) => ts.as_of?.[i] ?? month)
}
