import { beforeEach, describe, expect, it } from 'vitest'
import { setServerToday } from '../../utils/productToday'
import { currentColumn, rangeDates, snapshotAt, summaryState } from './snapshotStates'

beforeEach(() => setServerToday('2026-09-23'))

// The current snapshot is the SERVER's answer (2026-09-23 spec §0.4(b), §K2 — the summary's
// month with none asked, or coverage.time.current_snapshot); the page only finds its column
// (spec review M5: no second copy of the rule here).
describe('currentColumn — the column of the server’s current snapshot', () => {
  it('is that month’s column, whatever balances are filed further ahead', () => {
    expect(currentColumn(['2026-08-01', '2026-09-01', '2026-10-01', '2026-12-01'], '2026-10-01')).toBe(2)
  })

  it('on a quarterly axis, the quarter end the current snapshot closes into', () => {
    expect(currentColumn(['2026-03-01', '2026-06-01', '2026-09-01'], '2026-10-01')).toBe(2)
    expect(currentColumn(['2026-03-01', '2026-06-01', '2026-09-01'], '2026-08-01')).toBe(1)
  })

  it('has no column when the server says nothing is current', () => {
    expect(currentColumn(['2026-12-01'], null)).toBe(-1)
    expect(currentColumn(['2026-09-01'], '2026-08-01')).toBe(-1)
  })

  it('reads the latest column when there is no answer at all — an older payload, as before', () => {
    expect(currentColumn(['2026-09-01', '2026-12-01'], undefined)).toBe(1)
    expect(currentColumn([], undefined)).toBe(-1)
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
