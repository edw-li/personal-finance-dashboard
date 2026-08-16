import { describe, expect, it } from 'vitest'
import {
  escapeHtml,
  formatCurrency,
  formatCurrencyCompact,
  formatDate,
  formatMonth,
  formatPct,
  formatShares,
} from './format'

describe('formatCurrency', () => {
  it('formats server decimal strings', () => {
    expect(formatCurrency('1234.50')).toBe('$1,234.50')
    expect(formatCurrency('-50.00')).toBe('-$50.00')
    expect(formatCurrency(null)).toBe('—')
  })
  it('compacts large values', () => {
    expect(formatCurrencyCompact('1234567.89')).toBe('$1.23M')
    expect(formatCurrencyCompact('4500.00')).toBe('$4.5K')
    expect(formatCurrencyCompact('950.00')).toBe('$950')
  })
})

describe('formatPct', () => {
  it('renders signed percentages from decimal-fraction strings', () => {
    expect(formatPct('0.068959')).toBe('+6.9%')
    expect(formatPct('-0.012000')).toBe('-1.2%')
    expect(formatPct('0.000000')).toBe('+0.0%')
    expect(formatPct(null)).toBe('—')
  })
  it('supports unsigned mode', () => {
    expect(formatPct('0.750000', { signed: false })).toBe('75.0%')
  })
})

describe('formatMonth', () => {
  it('renders ISO first-of-month as short label', () => {
    expect(formatMonth('2026-08-01')).toBe('Aug 2026')
  })
})

describe('escapeHtml', () => {
  it('escapes the five HTML specials', () => {
    expect(escapeHtml(`<b>&"'`)).toBe('&lt;b&gt;&amp;&quot;&#39;')
  })
})

describe('formatPct decimals option', () => {
  it('renders 2dp unsigned', () => {
    expect(formatPct('0.013', { signed: false, decimals: 2 })).toBe('1.30%')
  })
  it('keeps the 1dp signed default', () => {
    expect(formatPct('0.25')).toBe('+25.0%')
  })
})

describe('formatShares', () => {
  it('trims trailing zeros up to 6dp', () => {
    expect(formatShares('123.456000')).toBe('123.456')
    expect(formatShares('2500.000000')).toBe('2,500')
    expect(formatShares(null)).toBe('—')
  })
})

describe('formatDate', () => {
  it('formats ISO dates without UTC shift', () => {
    expect(formatDate('2026-08-14')).toBe('Aug 14, 2026')
    expect(formatDate(null)).toBe('—')
  })

  it('tolerates full ISO datetimes and unpadded days', () => {
    expect(formatDate('2026-08-14T00:00:00Z')).toBe('Aug 14, 2026')
    expect(formatDate('2026-03-01')).toBe('Mar 1, 2026')
  })
})
