import { describe, expect, it } from 'vitest'
import { toneOf } from './tone'

// Server money is a decimal STRING (pydantic v2), so every case below is written the way
// the wire actually sends it; the number overload exists only for values a page has
// already parsed for display (spendStats.avg12).
describe('toneOf', () => {
  it('calls a gain positive and a loss negative', () => {
    expect(toneOf('10000.00')).toBe('positive')
    expect(toneOf('0.01')).toBe('positive')
    expect(toneOf('-2500.00')).toBe('negative')
    expect(toneOf('-0.01')).toBe('negative')
    // Same rule for an already-parsed number.
    expect(toneOf(1)).toBe('positive')
    expect(toneOf(-1)).toBe('negative')
  })

  it('calls a flat day NEUTRAL, not positive', () => {
    // The ratified rule (Plan 6 Task 8 review): a flat month is neither good nor bad, and
    // a green "▲ $0.00" would be wrong in every direction at once. NetWorthPage's old
    // `>= 0 ? positive` fork is what this replaces.
    expect(toneOf('0.00')).toBe('neutral')
    expect(toneOf(0)).toBe('neutral')
  })

  it('treats a negative zero as flat', () => {
    // Number('-0.00') is -0, and -0 is neither > 0 nor < 0 — so the comparison chain lands
    // on neutral without a special case. Pinned because a `1 / n < 0` style sign test
    // (or a string `startsWith('-')`) would paint a red ▼ on a zero.
    expect(toneOf('-0')).toBe('neutral')
    expect(toneOf('-0.00')).toBe('neutral')
    expect(toneOf(-0)).toBe('neutral')
  })

  it('says nothing about a value the server did not send', () => {
    // null is "no comparison exists" (no prior month, no price refresh yet) — the caller
    // drops the delta entirely, so the tone only has to avoid claiming a direction.
    expect(toneOf(null)).toBe('neutral')
    expect(toneOf(undefined)).toBe('neutral')
  })
})
