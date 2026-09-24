import { beforeEach, describe, expect, it } from 'vitest'
import { setServerToday } from '../../utils/productToday'
import {
  currentSnapshotIndex,
  provisionalNote,
  rangeDates,
  snapshotAt,
  summaryState,
} from './snapshotStates'

beforeEach(() => setServerToday('2026-09-23'))

describe('currentSnapshotIndex — K2’s current snapshot over a timeseries', () => {
  it('is the latest snapshot at most one month ahead of today', () => {
    expect(currentSnapshotIndex(['2026-08-01', '2026-09-01', '2026-10-01'], '2026-09-23')).toBe(2)
  })

  it('never makes balances filed further ahead current', () => {
    expect(currentSnapshotIndex(['2026-09-01', '2026-10-01', '2026-12-01'], '2026-09-23')).toBe(1)
    expect(currentSnapshotIndex(['2026-12-01'], '2026-09-23')).toBe(-1)
    expect(currentSnapshotIndex([], '2026-09-23')).toBe(-1)
  })

  it('crosses the year the way the server does', () => {
    expect(currentSnapshotIndex(['2026-12-01', '2027-01-01'], '2026-12-28')).toBe(1)
  })
})

describe('snapshotAt / summaryState — the wire lists as dated states', () => {
  const ts = {
    months: ['2026-09-01', '2026-10-01'],
    as_of: ['2026-09-01', '2026-09-22'],
    provisional: [false, true],
  }

  it('reads each snapshot’s date and standing', () => {
    expect(snapshotAt(ts, 1)).toEqual({ month: '2026-10-01', as_of: '2026-09-22', provisional: true })
    expect(snapshotAt(ts, 0)).toEqual({ month: '2026-09-01', as_of: '2026-09-01', provisional: false })
  })

  it('reads a payload without the lists as final, as of its 1st (a replayed cache)', () => {
    expect(snapshotAt({ months: ['2026-10-01'] }, 0)).toEqual({
      month: '2026-10-01',
      as_of: '2026-10-01',
      provisional: false,
    })
  })

  it('keeps an unknown date unknown', () => {
    expect(snapshotAt({ months: ['2026-12-01'], as_of: [null], provisional: [true] }, 0).as_of).toBeNull()
  })

  it('turns the summary into a state, null on an empty book', () => {
    expect(summaryState({ month: '2026-10-01', as_of: '2026-09-22', provisional: true })).toEqual({
      month: '2026-10-01',
      as_of: '2026-09-22',
      provisional: true,
    })
    expect(summaryState({ month: '2026-08-01' })).toEqual({ month: '2026-08-01', as_of: '2026-08-01', provisional: false })
    expect(summaryState({ month: null })).toBeNull()
  })
})

describe('rangeDates — what the range chips cut on (T7)', () => {
  it('is the as-of dates, the month where one is unknown', () => {
    expect(
      rangeDates({ months: ['2026-12-01', '2027-01-01', '2027-03-01'], as_of: ['2026-12-01', '2026-12-28', null] }),
    ).toEqual(['2026-12-01', '2026-12-28', '2027-03-01'])
    expect(rangeDates({ months: ['2026-09-01'] })).toEqual(['2026-09-01'])
  })
})

describe('provisionalNote — the tooltip on a provisional point (T1, T7)', () => {
  it('names the balances and the day they were typed', () => {
    expect(provisionalNote('2026-10-01', '2026-09-22')).toBe('Oct 1 balances recorded early, on Sep 22 — provisional')
  })

  it('says why when there is no early date (a month still ahead)', () => {
    expect(provisionalNote('2026-12-01', null)).toBe('Dec 1 balances — provisional until Dec 1')
  })
})
