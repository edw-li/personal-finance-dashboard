import { beforeEach, describe, expect, it } from 'vitest'
import type { SnapshotStateOut } from '../types/api'
import { asOfPhrase, changePhrase, formatAsOf, storyNote } from './asOf'
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
