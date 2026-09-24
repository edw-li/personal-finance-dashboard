import type { CoverageOut, NetWorthSummary, NetWorthTimeseries, SnapshotStateOut } from '../../types/api'

// Snapshot dates on the page side (2026-09-23 spec §K2, §T1, §T2, §T7): the wire's as-of lists
// turned into the `Dated` states utils/asOf.ts builds its words from, and the column of the
// CURRENT snapshot — which is the server's answer (services/snapshot_state.py, §0.4(b): the
// summary's month with none asked, or coverage.time.current_snapshot), never a second copy of
// the rule here. A payload without the new lists — a replayed cache, an older fixture — reads as
// final, as of its 1st, which is exactly what it said before them.

export type Dated = Pick<SnapshotStateOut, 'month' | 'as_of' | 'provisional'>

/** The server's current snapshot month (§0.4(b)): coverage `time.current_snapshot`; null when
 *  the server says none is current (an empty book, or only balances filed further ahead);
 *  undefined when the payload has no `time` at all (an older backend) — no answer. */
export function currentSnapshotMonth(coverage: Pick<CoverageOut, 'time'> | null | undefined): string | null | undefined {
  if (coverage?.time === undefined) return undefined
  return coverage.time?.current_snapshot?.month ?? null
}

/** The column of the server's current snapshot on a month axis: the last column at or before
 *  `current` — that month's own on the monthly axis, the quarter end it closes into on the
 *  quarterly one. -1 when the server says none is current (`null`) or no column reaches back that
 *  far; with no answer at all (`undefined`, an older payload) the latest column, as before the
 *  time model. `months` is ascending, as the wire sends it. */
export function currentColumn(months: readonly string[], current: string | null | undefined): number {
  if (current === undefined) return months.length - 1
  if (current === null) return -1
  let index = -1
  months.forEach((month, i) => {
    if (month <= current) index = i
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
