import { describe, expect, it } from 'vitest'
import {
  escapeHtml,
  formatCurrency,
  formatCurrencyCompact,
  formatBytes,
  formatDate,
  formatDateTime,
  formatMonth,
  formatPct,
  formatShares,
} from './format'

describe('formatDateTime', () => {
  it('renders wall-clock stamps in twelve-hour local time', () => {
    // Offset-LESS date-times parse as LOCAL time (the ES spec), so these pins hold on
    // any runner timezone — which is exactly the rendering the formatter promises.
    expect(formatDateTime('2026-08-18T13:07:00')).toBe('Aug 18, 2026, 1:07 PM')
    expect(formatDateTime('2026-08-18T00:05:00')).toBe('Aug 18, 2026, 12:05 AM')
    expect(formatDateTime('2026-08-18T12:00:00')).toBe('Aug 18, 2026, 12:00 PM')
  })

  it('accepts offset-carrying stamps and renders them on the runner clock', () => {
    // The one formatter ALLOWED to new Date(iso): a full timestamp carries its zone, so
    // parsing is exact. The pin mirrors the same conversion rather than assuming a TZ.
    const iso = '2026-08-18T20:11:00+00:00'
    const at = new Date(iso)
    expect(formatDateTime(iso)).toContain(`, ${at.getFullYear()},`)
    expect(formatDateTime(iso)).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2} [AP]M$/)
  })

  it('dashes null and garbage', () => {
    expect(formatDateTime(null)).toBe('—')
    expect(formatDateTime(undefined)).toBe('—')
    expect(formatDateTime('not a time')).toBe('—')
  })
})

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

describe('formatBytes', () => {
  it('walks the units at base 1024 with one decimal past bytes', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(123_456_789)).toBe('117.7 MB')
    expect(formatBytes(5 * 1024 ** 3)).toBe('5.0 GB')
  })

  it('answers a dash for the unrenderable', () => {
    expect(formatBytes(-1)).toBe('—')
    expect(formatBytes(Number.NaN)).toBe('—')
  })
})
