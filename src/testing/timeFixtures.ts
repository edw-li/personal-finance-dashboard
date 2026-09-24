import type { BalancesPartOut, FlowsPartOut, SnapshotStateOut, TimeStatusOut } from '../types/api'
import { addDays, addMonths } from '../utils/months'

// The ONE way tests build `GET /coverage`'s `time` (2026-09-23 spec §0.4(c)): every field has
// the server's default for a quiet book, so a fixture states only what it is about. Dates are
// the server's own rules — flows due on the next 1st and overdue from the 16th, balances overdue
// from the 7th (reminder day 1).

/** A snapshot's state: final, as of its 1st, recorded on it — unless `over` says otherwise. */
export function snapshotStateOut(month: string, over: Partial<SnapshotStateOut> = {}): SnapshotStateOut {
  return { month, as_of: month, recorded_on: month, provisional: false, ...over }
}

/** An early snapshot: recorded on `recordedOn`, before its month — provisional, as of that day. */
export function earlySnapshot(month: string, recordedOn: string): SnapshotStateOut {
  return { month, as_of: recordedOn, recorded_on: recordedOn, provisional: true }
}

/** An ended month's flows (spending missing, no take-home, due, not overdue by default). */
export function flowsPart(month: string, over: Partial<FlowsPartOut> = {}): FlowsPartOut {
  const dueOn = addMonths(month, 1)
  const spending = over.spending ?? 'missing'
  return {
    month,
    spending,
    spending_entered: spending === 'entered',
    spending_saved_on: null,
    take_home_entered: false,
    due_on: dueOn,
    overdue_from: addDays(dueOn, 15),
    overdue: false,
    ...over,
  }
}

/** The balances part for `month` from its snapshot (or its absence). */
export function balancesPart(month: string, snapshot: SnapshotStateOut | null, overdue = false): BalancesPartOut {
  return {
    month,
    status: snapshot === null ? 'missing' : snapshot.provisional ? 'provisional' : 'final',
    due_on: month,
    overdue_from: addDays(month, 6),
    overdue,
    snapshot,
  }
}

/** The time status on `today`: the current month's balances final, nothing due. */
export function timeStatus(today: string, over: Partial<TimeStatusOut> = {}): TimeStatusOut {
  const current = `${today.slice(0, 7)}-01`
  const snapshot = snapshotStateOut(current)
  return {
    today,
    current_month: current,
    reminder_day: 1,
    current_snapshot: snapshot,
    previous_snapshot: snapshotStateOut(addMonths(current, -1)),
    balances: balancesPart(current, snapshot),
    flows_due: [],
    provisional_past: [],
    last_complete_month: null,
    ...over,
  }
}

// The real-data copy on the spec's §V4 days: Sep 1 balances on the 1st, Oct 1's typed early
// on Sep 22, September's rent saved during September, no take-home.
export const OCT1_EARLY = earlySnapshot('2026-10-01', '2026-09-22')
export const SEP1 = snapshotStateOut('2026-09-01')

/** Sep 23: Oct 1 recorded early is the current snapshot; September is still running. */
export function copyOnSep23(): TimeStatusOut {
  return timeStatus('2026-09-23', {
    current_snapshot: OCT1_EARLY,
    previous_snapshot: SEP1,
    balances: balancesPart('2026-09-01', SEP1),
  })
}

/** Oct 3 (or `today` in October): Oct 1 still provisional, September partial and due. */
export function copyInOctober(today = '2026-10-03', over: Partial<FlowsPartOut> = {}): TimeStatusOut {
  const overdueFlows = today >= '2026-10-16'
  return timeStatus(today, {
    current_snapshot: OCT1_EARLY,
    previous_snapshot: SEP1,
    balances: balancesPart('2026-10-01', OCT1_EARLY, today >= '2026-10-07'),
    flows_due: [
      flowsPart('2026-09-01', {
        spending: 'partial',
        spending_saved_on: '2026-09-07',
        overdue: overdueFlows,
        ...over,
      }),
    ],
  })
}
