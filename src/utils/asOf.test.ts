import { beforeEach, describe, expect, it } from 'vitest'
import type { SnapshotStateOut } from '../types/api'
import { asOfPhrase, changePhrase, formatAsOf, provisionalNote, storyNote } from './asOf'
import { setServerToday } from './productToday'

const final = (month: string): SnapshotStateOut => ({ month, as_of: month, recorded_on: month, provisional: false })
const early = (month: string, recorded: string): SnapshotStateOut => ({
  month,
  as_of: recorded,
  recorded_on: recorded,
  provisional: true,
})
const unknown = (month: string): SnapshotStateOut => ({ month, as_of: null, recorded_on: null, provisional: true })

// The server's year decides when a label needs its year; src/testing/setup.ts forgets the day.
beforeEach(() => setServerToday('2026-09-23'))

describe('formatAsOf / asOfPhrase (2026-09-23 spec §0.4(d))', () => {
  it('names the day, with the year only outside the server year', () => {
    expect(formatAsOf(final('2026-10-01'))).toBe('Oct 1')
    expect(formatAsOf(final('2025-12-01'))).toBe('Dec 1, 2025')
    expect(formatAsOf(unknown('2026-12-01'))).toBe('date unknown')
  })

  it('says provisional when it is', () => {
    expect(asOfPhrase(final('2026-10-01'))).toBe('as of Oct 1')
    expect(asOfPhrase(early('2026-10-01', '2026-09-22'))).toBe('as of Sep 22 · provisional')
    expect(asOfPhrase(unknown('2026-12-01'))).toBe('date unknown · provisional')
  })
})

describe('changePhrase', () => {
  it("final and consecutive: the month's story in the user's own words", () => {
    expect(changePhrase(final('2026-09-01'), final('2026-10-01'))).toBe('September: Sep 1 → Oct 1')
    expect(changePhrase(final('2025-12-01'), final('2026-01-01'))).toBe('December: Dec 1, 2025 → Jan 1')
  })

  it('a provisional current counts the days since the balances before it', () => {
    expect(changePhrase(final('2026-09-01'), early('2026-10-01', '2026-09-22'))).toBe('since Sep 1 · 21 days')
    expect(changePhrase(final('2026-09-01'), early('2026-10-01', '2026-09-02'))).toBe('since Sep 1 · 1 day')
  })

  it('a previous snapshot that stayed provisional is named', () => {
    expect(changePhrase(early('2026-10-01', '2026-09-22'), final('2026-11-01'))).toBe(
      'since Sep 22 · 40 days (Oct 1 balances stayed provisional)',
    )
  })

  it('a gap counts months; the quarterly grain says only since when', () => {
    expect(changePhrase(final('2026-08-01'), final('2026-10-01'))).toBe('since Aug 1 · 2 months')
    expect(changePhrase(final('2026-07-01'), final('2026-10-01'), { period: 'quarter' })).toBe('since Jul 1')
  })

  it('nothing to compare with, nothing to say; an unknown date drops the count', () => {
    expect(changePhrase(null, final('2026-10-01'))).toBeNull()
    expect(changePhrase(final('2026-09-01'), unknown('2026-10-01'))).toBe('since Sep 1')
  })
})

describe('storyNote', () => {
  it('only while the month is listed in flows_due, and only about its spending', () => {
    expect(storyNote({ spending: 'missing' })).toBe(' · spending not entered yet')
    expect(storyNote({ spending: 'partial' })).toBe(' · spending not complete yet')
    expect(storyNote({ spending: 'entered' })).toBe('')
    expect(storyNote(undefined)).toBe('')
    expect(storyNote(null)).toBe('')
  })
})

// Why a point is provisional, in one sentence every chart shares (2026-09-23 spec §T1, §T7, §R8):
// the Overview trend, the Net worth charts and the Projection's hollow dot.
describe('provisionalNote', () => {
  it('names the balances and the day they were typed', () => {
    expect(provisionalNote('2026-10-01', '2026-09-22')).toBe('Oct 1 balances recorded early, on Sep 22 — provisional')
  })

  it('says why when there is no early date (a month still ahead)', () => {
    expect(provisionalNote('2026-12-01', null)).toBe('Dec 1 balances — provisional until Dec 1')
    expect(provisionalNote('2026-12-01', undefined)).toBe('Dec 1 balances — provisional until Dec 1')
  })

  it('carries the year outside the server’s year', () => {
    expect(provisionalNote('2027-01-01', '2026-12-28')).toBe('Jan 1, 2027 balances recorded early, on Dec 28 — provisional')
  })
})

describe('an absent date (review minor 12)', () => {
  // NetWorthSummary's new fields are OPTIONAL on the wire type, so an older fixture hands the
  // builders `as_of: undefined` — read as unknown, never as a crash.
  it('reads as date unknown, and drops the day count', () => {
    expect(formatAsOf({ month: '2026-10-01', provisional: false })).toBe('date unknown')
    expect(asOfPhrase({ month: '2026-10-01' })).toBe('date unknown')
    expect(changePhrase(final('2026-09-01'), { month: '2026-10-01', provisional: true })).toBe('since Sep 1')
    expect(changePhrase({ month: '2026-09-01' }, final('2026-10-01'))).toBe('September: date unknown → Oct 1')
    expect(changePhrase(undefined, final('2026-10-01'))).toBeNull() // an optional summary.previous
  })
})
