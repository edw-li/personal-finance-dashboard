import { describe, expect, it } from 'vitest'
import { STALE_AFTER_DAYS, backupAge, isStaleQuote } from './staleness'

// `today` is injected so these read as calendar facts rather than as whatever day the
// suite happens to run on. Every instant is written in UTC (`Z`) because the function
// takes today's date through toISOString() — a local-time literal would make the expected
// answers depend on the machine's zone.
const monday = new Date('2026-08-17T09:30:00Z')

describe('isStaleQuote', () => {
  it('never calls a missing quote stale', () => {
    // No quote is a manual-priced or never-fetched security, not an old one — the row
    // shows no price at all, so an "as of" cue there would be about nothing.
    expect(isStaleQuote(null, monday)).toBe(false)
    expect(isStaleQuote('', monday)).toBe(false)
  })

  it('leaves a two-day-old bar alone', () => {
    expect(isStaleQuote('2026-08-15', monday)).toBe(false)
    // Same bar, full ISO datetime (the wire form): the time half is sliced off.
    expect(isStaleQuote('2026-08-15T00:00:00Z', monday)).toBe(false)
  })

  it('stales on the FIFTH day, not the fourth', () => {
    // Strictly greater than the window: four days is a long weekend plus a holiday, which
    // is a normal gap for a market that does not trade every day.
    expect(isStaleQuote('2026-08-13', monday)).toBe(false)
    expect(isStaleQuote('2026-08-12', monday)).toBe(true)
    expect(STALE_AFTER_DAYS).toBe(4)
  })

  it('keeps Friday’s bar fresh all the way through Tuesday evening', () => {
    // The Plan 4 note: quoted_at is the BAR DATE at UTC midnight, so comparing INSTANTS
    // adds today's time-of-day to the gap. Friday's bar on Tuesday evening is 4 days and
    // change as an instant — stale — but exactly 4 days as a date, which is what the
    // market actually did.
    expect(isStaleQuote('2026-08-14', monday)).toBe(false)
    expect(isStaleQuote('2026-08-14', new Date('2026-08-18T23:30:00Z'))).toBe(false)
    // And the day after that it is genuinely old.
    expect(isStaleQuote('2026-08-14', new Date('2026-08-19T00:05:00Z'))).toBe(true)
  })
})

describe('backupAge', () => {
  // The Overview strip evaluates at the injected today's MIDNIGHT UTC (attention.ts)
  // and the Settings card at the real clock — both call THIS function, so the amber
  // tone and the "hasn't run recently" nag flip at the same hour by construction.
  const now = new Date('2026-08-18T00:00:00Z')

  it('reads fresh through the 48th hour exactly', () => {
    expect(backupAge('2026-08-17T00:00:00Z', now)).toBe('fresh')
    // Exactly 48h: "older than 48h" is strict, so the boundary itself is still fresh.
    expect(backupAge('2026-08-16T00:00:00Z', now)).toBe('fresh')
  })

  it('turns stale past 48 hours and holds through the seventh day', () => {
    expect(backupAge('2026-08-15T23:59:00Z', now)).toBe('stale')
    expect(backupAge('2026-08-11T00:00:00Z', now)).toBe('stale') // exactly 7 days
  })

  it('reads overdue past seven days — the red-wording register', () => {
    expect(backupAge('2026-08-10T23:59:59Z', now)).toBe('overdue')
  })

  it('treats an unparseable stamp as overdue — the nag errs toward nagging', () => {
    expect(backupAge('not a timestamp', now)).toBe('overdue')
  })
})
