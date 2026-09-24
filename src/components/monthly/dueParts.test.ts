import { beforeEach, describe, expect, it } from 'vitest'
import { setServerToday } from '../../utils/productToday'
import {
  OCT_1_EARLY,
  TIME_JAN_5,
  TIME_OCT_16,
  TIME_OCT_3,
  TIME_SEP_23,
  septemberFlows,
} from '../../testing/timeStatusFixtures'
import { dueParts, landingFor, nextDueAfter, nothingDueSentence } from './dueParts'

describe('dueParts (2026-09-23 spec §M2)', () => {
  beforeEach(() => setServerToday('2026-10-03'))

  it('Oct 3: the early Oct 1 balances, then partial September', () => {
    expect(dueParts(TIME_OCT_3).map((p) => [p.name, p.detail, p.month, p.step, p.overdue])).toEqual([
      ['Oct 1 balances', 'recorded early, on Sep 22 — update or confirm', '2026-10-01', 'balances', false],
      [
        'September spending & take-home',
        'entered during September — add the rest or confirm',
        '2026-09-01',
        'spending',
        false,
      ],
    ])
  })

  it('Oct 16: both overdue', () => {
    expect(dueParts(TIME_OCT_16).map((p) => p.overdue)).toEqual([true, true])
  })

  it('names what a flows part lacks', () => {
    const at = (spending: 'missing' | 'entered', take_home_entered: boolean) =>
      dueParts({
        ...TIME_OCT_3,
        balances: { ...TIME_OCT_3.balances, status: 'final' },
        flows_due: [septemberFlows({ spending, take_home_entered })],
      })[0].detail
    expect(at('missing', false)).toBe('not entered')
    expect(at('missing', true)).toBe('spending not entered')
    expect(at('entered', false)).toBe('take-home not entered')
  })

  it('a missing current balances part is "not recorded yet"', () => {
    expect(dueParts({ ...TIME_OCT_3, balances: { ...TIME_OCT_3.balances, status: 'missing', snapshot: null } })[0].detail).toBe(
      'not recorded yet',
    )
  })

  it('Jan 5: Jan 1 missing, four months of flows newest first, then the earlier provisional Oct 1', () => {
    setServerToday('2027-01-05')
    expect(dueParts(TIME_JAN_5).map((p) => `${p.name} · ${p.detail}${p.overdue ? ' (overdue)' : ''}`)).toEqual([
      'Jan 1 balances · not recorded yet',
      'December 2026 spending & take-home · not entered',
      'November 2026 spending & take-home · not entered (overdue)',
      'October 2026 spending & take-home · not entered (overdue)',
      'September 2026 spending & take-home · entered during September 2026 — add the rest or confirm (overdue)',
      'Oct 1, 2026 balances · still provisional (recorded Sep 22, 2026) — confirm or update (overdue)',
    ])
  })

  it('nothing due on Sep 23, and nothing without a time status', () => {
    expect(dueParts(TIME_SEP_23)).toEqual([])
    expect(dueParts(null)).toEqual([])
    expect(dueParts(undefined)).toEqual([])
  })
})

describe('nothingDueSentence', () => {
  beforeEach(() => setServerToday('2026-09-23'))

  it('names an early next-month snapshot', () => {
    expect(nothingDueSentence(TIME_SEP_23)).toBe(
      'Nothing due — Oct 1 balances recorded early (Sep 22); update or confirm them on Oct 1',
    )
  })

  it('else names the next balances', () => {
    expect(nothingDueSentence({ ...TIME_SEP_23, current_snapshot: TIME_SEP_23.previous_snapshot })).toBe(
      'Nothing due — next: Oct 1 balances on Oct 1',
    )
  })
})

describe('landingFor', () => {
  it('lands on the first due part, balances first', () => {
    expect(landingFor(TIME_OCT_3, '2026-10-01', null)).toEqual({ month: '2026-10-01', step: 'balances' })
    const confirmed = { ...TIME_OCT_3, balances: { ...TIME_OCT_3.balances, status: 'final' as const } }
    expect(landingFor(confirmed, '2026-10-01', null)).toEqual({ month: '2026-09-01', step: 'spending' })
    expect(landingFor(TIME_JAN_5, '2027-01-01', null)).toEqual({ month: '2027-01-01', step: 'balances' })
  })

  it("with nothing due, the current month's Balances step", () => {
    expect(landingFor(TIME_SEP_23, '2026-09-01', null)).toEqual({ month: '2026-09-01', step: 'balances' })
    expect(landingFor(null, '2026-09-01', null)).toEqual({ month: '2026-09-01', step: 'balances' })
  })

  it('a requested step opens the due part of its kind', () => {
    expect(landingFor(TIME_OCT_3, '2026-10-01', 'spending')).toEqual({ month: '2026-09-01', step: 'spending' })
    expect(landingFor(TIME_OCT_3, '2026-10-01', 'review')).toEqual({ month: '2026-09-01', step: 'review' })
    expect(landingFor(TIME_OCT_3, '2026-10-01', 'balances')).toEqual({ month: '2026-10-01', step: 'balances' })
    const onlyPast = { ...TIME_JAN_5, balances: { ...TIME_JAN_5.balances, status: 'final' as const } }
    expect(landingFor(onlyPast, '2027-01-01', 'balances')).toEqual({ month: OCT_1_EARLY.month, step: 'balances' })
    expect(landingFor(TIME_SEP_23, '2026-09-01', 'spending')).toEqual({ month: '2026-09-01', step: 'spending' })
  })
})

describe('nextDueAfter', () => {
  beforeEach(() => setServerToday('2026-10-03'))

  it('names the first due part other than the one just saved', () => {
    expect(nextDueAfter(TIME_OCT_3, { month: '2026-10-01', steps: ['balances'] })?.name).toBe(
      'September spending & take-home',
    )
    expect(nextDueAfter(TIME_OCT_3, { month: '2026-09-01', steps: ['spending'] })?.name).toBe('Oct 1 balances')
    expect(nextDueAfter({ ...TIME_OCT_3, flows_due: [] }, { month: '2026-10-01', steps: ['balances'] })).toBeNull()
    expect(nextDueAfter(null, { month: '2026-10-01', steps: ['balances'] })).toBeNull()
  })
})
