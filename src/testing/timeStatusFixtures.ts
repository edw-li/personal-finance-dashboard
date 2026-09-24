import type { FlowsPartOut, SnapshotStateOut, TimeStatusOut } from '../types/api'

// GET /coverage `time` (2026-09-23 spec §0.4(c)) as the real-data copy answers it — captured from
// finance_realdata_b2 with PRODUCT_TODAY at the §V4 scenario days (lane M, 2026-09-24), so the
// monthly update's tests read the server's own shapes: Sep 1 final, Oct 1 recorded early on
// Sep 22, and September's rent saved on Sep 7 (partial from Oct 1, no take-home).

export const SEP_1: SnapshotStateOut = {
  month: '2026-09-01',
  as_of: '2026-09-01',
  recorded_on: '2026-09-01',
  provisional: false,
}

export const OCT_1_EARLY: SnapshotStateOut = {
  month: '2026-10-01',
  as_of: '2026-09-22',
  recorded_on: '2026-09-22',
  provisional: true,
}

export function septemberFlows(overrides: Partial<FlowsPartOut> = {}): FlowsPartOut {
  return {
    month: '2026-09-01',
    spending: 'partial',
    spending_entered: false,
    spending_saved_on: '2026-09-07',
    take_home_entered: false,
    due_on: '2026-10-01',
    overdue_from: '2026-10-16',
    overdue: false,
    ...overrides,
  }
}

export const TIME_SEP_23: TimeStatusOut = {
  today: '2026-09-23',
  current_month: '2026-09-01',
  reminder_day: 1,
  current_snapshot: OCT_1_EARLY,
  previous_snapshot: SEP_1,
  balances: {
    month: '2026-09-01',
    status: 'final',
    due_on: '2026-09-01',
    overdue_from: '2026-09-07',
    overdue: false,
    snapshot: SEP_1,
  },
  flows_due: [],
  provisional_past: [],
  last_complete_month: '2026-08-01',
}

export const TIME_OCT_3: TimeStatusOut = {
  today: '2026-10-03',
  current_month: '2026-10-01',
  reminder_day: 1,
  current_snapshot: OCT_1_EARLY,
  previous_snapshot: SEP_1,
  balances: {
    month: '2026-10-01',
    status: 'provisional',
    due_on: '2026-10-01',
    overdue_from: '2026-10-07',
    overdue: false,
    snapshot: OCT_1_EARLY,
  },
  flows_due: [septemberFlows()],
  provisional_past: [],
  last_complete_month: '2026-08-01',
}

export const TIME_OCT_16: TimeStatusOut = {
  ...TIME_OCT_3,
  today: '2026-10-16',
  balances: { ...TIME_OCT_3.balances, overdue: true },
  flows_due: [septemberFlows({ overdue: true })],
}

const missingFlows = (month: string, dueOn: string, overdueFrom: string, overdue: boolean): FlowsPartOut => ({
  month,
  spending: 'missing',
  spending_entered: false,
  spending_saved_on: null,
  take_home_entered: false,
  due_on: dueOn,
  overdue_from: overdueFrom,
  overdue,
})

/** The year boundary: Jan 1 missing, Dec/Nov/Oct missing, Sep partial, Oct 1 still provisional. */
export const TIME_JAN_5: TimeStatusOut = {
  today: '2027-01-05',
  current_month: '2027-01-01',
  reminder_day: 1,
  current_snapshot: OCT_1_EARLY,
  previous_snapshot: SEP_1,
  balances: {
    month: '2027-01-01',
    status: 'missing',
    due_on: '2027-01-01',
    overdue_from: '2027-01-07',
    overdue: false,
    snapshot: null,
  },
  flows_due: [
    missingFlows('2026-12-01', '2027-01-01', '2027-01-16', false),
    missingFlows('2026-11-01', '2026-12-01', '2026-12-16', true),
    missingFlows('2026-10-01', '2026-11-01', '2026-11-16', true),
    septemberFlows({ overdue: true }),
  ],
  provisional_past: [OCT_1_EARLY],
  last_complete_month: '2026-08-01',
}
