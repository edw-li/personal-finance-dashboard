import { describe, expect, it } from 'vitest'
import { canonicalAmount, parseAmount } from './amount'

describe('parseAmount', () => {
  it('returns already-plain input VERBATIM (idempotence guarantee)', () => {
    // Never rewrite a server seed: '0.00' must not become '0', '+5' stays '+5'.
    for (const plain of ['1234.56', '0.00', '-5', '+5', '5.', '.5', '1500']) {
      expect(parseAmount(plain)).toEqual({ canonical: plain })
    }
  })
  it('trims surrounding whitespace to the plain form', () => {
    expect(parseAmount(' 1500 ')).toEqual({ canonical: '1500' })
  })
  it('strips $ and comma grouping', () => {
    expect(parseAmount('$1,234.56')).toEqual({ canonical: '1234.56' })
    expect(parseAmount('-$500')).toEqual({ canonical: '-500' })
    expect(parseAmount('$ 1,234')).toEqual({ canonical: '1234' })
    // Comma POSITIONS are not validated (spec §4.1 tolerance).
    expect(parseAmount('1,2,3')).toEqual({ canonical: '123' })
    // Interior spaces are grouping too ("1 234,56" locales paste them).
    expect(parseAmount('1 234.56')).toEqual({ canonical: '1234.56' })
  })
  it('reads accounting parentheses as negative', () => {
    expect(parseAmount('(1,234.56)')).toEqual({ canonical: '-1234.56' })
    expect(parseAmount('($500)')).toEqual({ canonical: '-500' })
    // A sign INSIDE parens is a double negative — refuse rather than guess.
    expect(parseAmount('(-5)')).toBeNull()
  })
  it('rejects exponent notation — closes the silent 1e5 hole', () => {
    expect(parseAmount('1e5')).toBeNull()
    expect(parseAmount('1E-3')).toBeNull()
  })
  it('rejects garbage, blanks, and digitless shells', () => {
    for (const bad of ['', '   ', 'abc', '.', '$', '()', '1.2.3', '5%', '--5', '$-500']) {
      expect(parseAmount(bad)).toBeNull()
    }
  })
})

describe('canonicalAmount', () => {
  it('canonicalizes what it can and hands back trimmed text otherwise', () => {
    expect(canonicalAmount('$1,600')).toBe('1600')
    expect(canonicalAmount(' 5 ')).toBe('5')
    expect(canonicalAmount('abc')).toBe('abc')
    expect(canonicalAmount('')).toBe('')
  })
})
