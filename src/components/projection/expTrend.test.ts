import { describe, expect, it } from 'vitest'
import { fitExpTrend, monthSerial } from './expTrend'

// A perfect geometric series: value = 1000 · 1.01^i at consecutive months. The fit must
// recover the generator (up to float dust) — that is the module's whole contract.
const MONTHS = [
  '2025-01-01',
  '2025-02-01',
  '2025-03-01',
  '2025-04-01',
  '2025-05-01',
  '2025-06-01',
]
const VALUES = MONTHS.map((_, i) => (1000 * 1.01 ** i).toFixed(2))

describe('monthSerial', () => {
  it('counts calendar months, year boundaries included', () => {
    expect(monthSerial('2026-01-01') - monthSerial('2025-12-01')).toBe(1)
    expect(monthSerial('2026-08-01') - monthSerial('2025-08-01')).toBe(12)
  })
})

describe('fitExpTrend', () => {
  it('recovers the monthly growth of a perfect geometric series', () => {
    const fit = fitExpTrend(MONTHS, VALUES)
    expect(fit).not.toBeNull()
    expect(fit!.monthlyGrowth).toBeCloseTo(1.01, 4)
    expect(fit!.annualRate).toBeCloseTo(1.01 ** 12 - 1, 4)
  })

  it('is gap-proof: a missing month cannot compress time', () => {
    // The same generator with March deleted — serial-x fitting still reads 1%/mo;
    // an index-x fit would report a faster rate.
    const gapMonths = ['2025-01-01', '2025-02-01', '2025-04-01', '2025-05-01']
    const gapValues = [0, 1, 3, 4].map((i) => (1000 * 1.01 ** i).toFixed(2))
    const fit = fitExpTrend(gapMonths, gapValues)
    expect(fit).not.toBeNull()
    expect(fit!.monthlyGrowth).toBeCloseTo(1.01, 4)
  })

  it('valueAt reproduces the series and extends past it', () => {
    const fit = fitExpTrend(MONTHS, VALUES)!
    expect(fit.valueAt('2025-01-01')).toBeCloseTo(1000, 1)
    expect(fit.valueAt('2025-06-01')).toBeCloseTo(1000 * 1.01 ** 5, 1)
    // Six months past the last point: the extension is the same law, further out.
    expect(fit.valueAt('2025-12-01')).toBeCloseTo(1000 * 1.01 ** 11, 1)
  })

  it('refuses under two points', () => {
    expect(fitExpTrend(['2025-01-01'], ['1000.00'])).toBeNull()
    expect(fitExpTrend([], [])).toBeNull()
  })

  it('refuses nonpositive values — ln is undefined there (the sheet refuses too)', () => {
    expect(fitExpTrend(MONTHS.slice(0, 2), ['0.00', '1000.00'])).toBeNull()
    expect(fitExpTrend(MONTHS.slice(0, 2), ['-5.00', '1000.00'])).toBeNull()
  })

  it('refuses mismatched or degenerate input', () => {
    expect(fitExpTrend(MONTHS.slice(0, 3), ['1000.00', '1010.00'])).toBeNull()
    expect(fitExpTrend(['2025-01-01', '2025-01-01'], ['1000.00', '1010.00'])).toBeNull()
  })
})
