import { describe, expect, it } from 'vitest'
import { canonicalAmount, evaluateAmount, isAmount, parseAmount, quantize } from './amount'

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
    // Comma POSITIONS are not validated (spec §3.1 tolerance).
    expect(parseAmount('1,2,3')).toEqual({ canonical: '123' })
    // Interior spaces are grouping too ("1 234,56" locales paste them).
    expect(parseAmount('1 234.56')).toEqual({ canonical: '1234.56' })
  })
  it('strips NBSP and narrow-NBSP grouping (Excel/Sheets paste separators)', () => {
    // Written as escapes, never as the literal characters: an invisible U+00A0 in a test
    // string is unreviewable, and one stray normal space would make this pass vacuously
    // against the plain-space stripping that was already here.
    expect(parseAmount('1\u00A0234.56')).toEqual({ canonical: '1234.56' })
    expect(parseAmount('$1\u00A0234.56')).toEqual({ canonical: '1234.56' })
    expect(parseAmount('1\u202F234.56')).toEqual({ canonical: '1234.56' })
    // Surrounding NBSP is already String.trim()'s job — pinned so that stays true.
    expect(parseAmount('\u00A01500\u00A0')).toEqual({ canonical: '1500' })
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
  it('refuses tab/newline — a multi-cell paste must never merge into one number', () => {
    // Phase 2's range paste discriminates multi-cell clipboards on \t/\n; parseAmount
    // treating them as grouping would silently merge '1500<TAB>200' into 150200-class
    // wrong numbers. Tab and newline are deliberately NOT in the grouping set.
    expect(parseAmount('1500\t200')).toBeNull()
    expect(parseAmount('1500\n200')).toBeNull()
  })
  it('tolerant output is itself plain — canonicalizing twice changes nothing', () => {
    // Task 3's blur-commit rewrites state only when canonical !== value; an unstable
    // canonical form would churn state (and dirty drafts) on every blur.
    for (const raw of ['$1,234.56', '(1,234.56)', '-$500', '1\u00A0234.56', '(0.00)']) {
      const canonical = parseAmount(raw)!.canonical
      expect(parseAmount(canonical)).toEqual({ canonical })
    }
  })
  it('accounting parens on zero yield -0 — accepted: Decimal("-0") is wire-legal', () => {
    expect(parseAmount('(0)')).toEqual({ canonical: '-0' })
  })
})

describe('canonicalAmount', () => {
  it('canonicalizes what it can and hands back trimmed text otherwise', () => {
    expect(canonicalAmount('$1,600')).toBe('1600')
    expect(canonicalAmount(' 5 ')).toBe('5')
    expect(canonicalAmount('abc')).toBe('abc')
    expect(canonicalAmount('')).toBe('')
  })
  it('evaluates =-expressions at the wire boundary too', () => {
    expect(canonicalAmount('=1200+34.56')).toBe('1234.56')
    expect(canonicalAmount('=1+')).toBe('=1+')
  })
})

describe('quantize (lifted from BracketsEditor — behavior pinned)', () => {
  it('rounds HALF_UP exactly like the server', () => {
    expect(quantize('100.005', 2)).toBe('100.01')
    expect(quantize('0.001', 2)).toBe('0.00')
    expect(quantize('9.999', 2)).toBe('10.00')
    expect(quantize('-100.005', 2)).toBe('-100.01') // ties away from zero
    expect(quantize('37', 2)).toBe('37.00')
  })
  it('hands non-plain text back untouched', () => {
    expect(quantize('abc', 2)).toBe('abc')
  })
})

describe('evaluateAmount', () => {
  it('evaluates =-prefixed arithmetic to a 2dp HALF_UP string', () => {
    expect(evaluateAmount('=1200+34.56')).toBe('1234.56')
    expect(evaluateAmount('=2*(3+4)')).toBe('14.00')
    expect(evaluateAmount('=10/4')).toBe('2.50')
    expect(evaluateAmount('=-5+10')).toBe('5.00')
    expect(evaluateAmount('=1/3')).toBe('0.33')
    expect(evaluateAmount('= 1 + 2 ')).toBe('3.00')
  })
  it('returns null for non-expressions and malformed ones', () => {
    for (const bad of ['1+2', '=1+', '=(1+2', '=5/0', '=1,000+5', '=abc', '=', '=1e5']) {
      expect(evaluateAmount(bad)).toBeNull()
    }
  })
  it('fences absurd magnitudes', () => {
    expect(evaluateAmount('=999999999999999*9')).toBeNull()
  })
})

describe('isAmount', () => {
  it('accepts plain, tolerant, and expression forms', () => {
    for (const ok of ['5', '$1,234.56', '(500)', '=1+2']) expect(isAmount(ok)).toBe(true)
  })
  it('rejects blanks, garbage, exponents, broken expressions', () => {
    for (const bad of ['', 'abc', '1e5', '=x', '=1+']) expect(isAmount(bad)).toBe(false)
  })
})
