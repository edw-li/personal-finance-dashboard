import { beforeEach, describe, expect, it } from 'vitest'
import { OCT1_EARLY, SEP1, flowsPart } from '../../testing/timeFixtures'
import type { NetWorthSummary } from '../../types/api'
import { setServerToday } from '../../utils/productToday'
import { netWorthHeadline, receiptAsOf, recordedSentence } from './headline'

beforeEach(() => setServerToday('2026-09-23'))

// The copy on Sep 23 (2026-09-23 spec §K2's figures): Oct 1 balances typed early on Sep 22.
const PROVISIONAL: NetWorthSummary = {
  month: '2026-10-01',
  net_worth: '933250.90',
  mom_delta: '126583.02',
  mom_pct: '0.156920',
  groups: [],
  owner_totals: [],
  as_of: '2026-09-22',
  recorded_on: '2026-09-22',
  provisional: true,
  previous: SEP1,
  days_since_previous: 21,
}

// The same balances confirmed on Oct 1.
const FINAL: NetWorthSummary = {
  ...PROVISIONAL,
  as_of: '2026-10-01',
  recorded_on: '2026-10-01',
  provisional: false,
  days_since_previous: 30,
}

describe('netWorthHeadline — the tile names its balances by date (2026-09-23 spec §T1)', () => {
  it('a provisional snapshot: the day it was typed, a badge, and "since Sep 1 · 21 days"', () => {
    expect(netWorthHeadline(PROVISIONAL)).toEqual({
      label: 'Net worth — as of Sep 22',
      badge: 'Provisional',
      delta: '$126,583.02 (+15.7%) since Sep 1 · 21 days',
    })
  })

  it('a final snapshot, consecutive: the month the change covers, in the user’s own words', () => {
    expect(netWorthHeadline(FINAL)).toEqual({
      label: 'Net worth — as of Oct 1',
      badge: undefined,
      delta: '$126,583.02 (+15.7%) · September: Sep 1 → Oct 1',
    })
  })

  it('adds the month’s story while its spending is listed as due', () => {
    expect(netWorthHeadline(FINAL, [flowsPart('2026-09-01', { spending: 'partial' })]).delta).toBe(
      '$126,583.02 (+15.7%) · September: Sep 1 → Oct 1 · spending not complete yet',
    )
    expect(netWorthHeadline(FINAL, [flowsPart('2026-09-01')]).delta).toMatch(/ · spending not entered yet$/)
    expect(netWorthHeadline(FINAL, [flowsPart('2026-08-01')]).delta).toBe(
      '$126,583.02 (+15.7%) · September: Sep 1 → Oct 1',
    )
  })

  it('names a gap in months, and a change from balances that stayed provisional', () => {
    const gap = { ...FINAL, previous: { ...SEP1, month: '2026-08-01', as_of: '2026-08-01' } }
    expect(netWorthHeadline(gap).delta).toBe('$126,583.02 (+15.7%) since Aug 1 · 2 months')
    setServerToday('2026-11-05')
    const stayed = {
      ...FINAL,
      month: '2026-11-01',
      as_of: '2026-11-01',
      recorded_on: '2026-11-01',
      previous: OCT1_EARLY,
    }
    expect(netWorthHeadline(stayed).delta).toBe(
      '$126,583.02 (+15.7%) since Sep 22 · 40 days (Oct 1 balances stayed provisional)',
    )
  })

  it('reads "since Jul 1" at the quarterly grain', () => {
    const quarter = { ...FINAL, month: '2026-09-01', as_of: '2026-09-01', period: 'quarter' as const, previous: { ...SEP1, month: '2026-06-01', as_of: '2026-06-01' } }
    expect(netWorthHeadline(quarter).delta).toBe('$126,583.02 (+15.7%) since Jun 1')
  })

  it('drops the delta whole when either half is missing, and says nothing more on an empty book', () => {
    expect(netWorthHeadline({ ...FINAL, mom_pct: null }).delta).toBeUndefined()
    expect(netWorthHeadline({ ...FINAL, month: null, net_worth: null, mom_delta: null, mom_pct: null })).toEqual({
      label: 'Net worth',
      badge: undefined,
      delta: undefined,
    })
  })

  it('reads a summary without the date fields as final, as of its 1st (a replayed cache)', () => {
    const older: NetWorthSummary = { month: '2026-08-01', net_worth: '1.00', mom_delta: '1.00', mom_pct: '0.5', groups: [], owner_totals: [] }
    expect(netWorthHeadline(older)).toEqual({ label: 'Net worth — as of Aug 1', badge: undefined, delta: '$1.00 (+50.0%)' })
  })

  it('says a snapshot’s date is unknown rather than inventing one', () => {
    const ahead = { ...PROVISIONAL, month: '2026-10-01', as_of: null, recorded_on: null }
    expect(netWorthHeadline(ahead).label).toBe('Net worth — Oct 1 balances, date unknown')
  })
})

describe('the receipt: its date, and the recorded sentence', () => {
  it('stands on the as-of date, not the month key', () => {
    expect(receiptAsOf(PROVISIONAL)).toBe('2026-09-22')
    expect(receiptAsOf(FINAL)).toBe('2026-10-01')
    expect(receiptAsOf({ ...FINAL, as_of: undefined })).toBe('2026-10-01')
    expect(receiptAsOf({ ...FINAL, month: null })).toBeNull()
  })

  it('explains a provisional snapshot, names a late recording, and says nothing otherwise', () => {
    expect(recordedSentence(PROVISIONAL)).toBe(
      ' Recorded Sep 22. Balances recorded before their date stay provisional until saved again on or after it.',
    )
    expect(recordedSentence({ ...FINAL, month: '2023-09-01', as_of: '2023-09-01', recorded_on: '2023-09-24' })).toBe(
      ' Recorded Sep 24, 2023.',
    )
    expect(recordedSentence(FINAL)).toBe('')
    expect(recordedSentence({ ...FINAL, recorded_on: null })).toBe('')
  })
})
