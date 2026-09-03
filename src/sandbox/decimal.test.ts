import { describe, expect, it } from 'vitest'
import { compareDecimals, decimalsIn, divideDecimals, subtractDecimals, trimZeros } from './decimal'

describe('decimal helpers', () => {
  it('subtracts exactly across scales and signs', () => {
    expect(subtractDecimals('0.15', '0.130000000')).toBe('0.02')
    expect(subtractDecimals('250', '100.00')).toBe('150')
    expect(subtractDecimals('0.13', '0.15')).toBe('-0.02')
    expect(subtractDecimals('0.13', '0.13')).toBe('0')
    expect(subtractDecimals('-0.5', '0.25')).toBe('-0.75')
    expect(subtractDecimals('0.1', '0.3')).toBe('-0.2') // never 0.30000000000000004
  })

  it('divides to a floored fixed number of places', () => {
    expect(divideDecimals('24500', '100000', 9)).toBe('0.245')
    // 23500 / 188930 = 0.1243846927… — floored at the 9th place, never rounded up (the
    // plan's worked example mistyped the quotient; BigInt division is the authority here).
    expect(divideDecimals('23500', '188930', 9)).toBe('0.124384692')
    expect(divideDecimals('4300', '24', 2)).toBe('179.16')
    expect(divideDecimals('1', '3', 4)).toBe('0.3333')
    expect(divideDecimals('5', '0', 2)).toBeNull()
  })

  it('compares numerically', () => {
    expect(compareDecimals('0.15', '0.150')).toBe(0)
    expect(compareDecimals('0.2', '0.15')).toBe(1)
    expect(compareDecimals('-1', '0')).toBe(-1)
  })

  it('counts decimals and trims zeros', () => {
    expect(decimalsIn('0.005')).toBe(3)
    expect(decimalsIn('5')).toBe(0)
    expect(trimZeros('0.150')).toBe('0.15')
    expect(trimZeros('250.00')).toBe('250')
    expect(trimZeros('-0.00')).toBe('0')
  })
})
