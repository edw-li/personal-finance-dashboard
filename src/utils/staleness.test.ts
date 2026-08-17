import { describe, expect, it } from 'vitest'
import { STALE_AFTER_DAYS, isStaleQuote } from './staleness'

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
