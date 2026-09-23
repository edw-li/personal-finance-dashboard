import { describe, expect, it } from 'vitest'
import { toCents } from './cents'

// The 2026-09-23 code review (7): one whole-cent reader for the server's 2dp decimal strings,
// where three chart modules each kept a copy.
describe('toCents', () => {
  it('reads a 2dp decimal string as whole cents, exactly', () => {
    expect(toCents('12.34')).toBe(1234)
    expect(toCents('-0.01')).toBe(-1)
    expect(toCents('0')).toBe(0)
    // The float traps: 0.29 × 100 and 1.005-shaped products land a hair off the integer.
    expect(toCents('0.29')).toBe(29)
    expect(toCents('4.35')).toBe(435)
    expect(toCents('1234567.89')).toBe(123456789)
  })

  it('reads an absent cell as zero — an absent month adds nothing to a sum', () => {
    expect(toCents(null)).toBe(0)
    expect(toCents(undefined)).toBe(0)
  })
})
