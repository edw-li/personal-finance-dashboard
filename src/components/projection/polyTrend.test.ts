import { describe, expect, it } from 'vitest'
import { fitPolyTrend, monthSerial } from './polyTrend'

// A perfect quadratic: value = 1000 + 50x + 2x² at consecutive months (x = months since
// the first point). The fit must recover the generator (up to float dust) — that is the
// module's whole contract.
const MONTHS = [
  '2025-01-01',
  '2025-02-01',
  '2025-03-01',
  '2025-04-01',
  '2025-05-01',
  '2025-06-01',
]
const quad = (x: number) => 1000 + 50 * x + 2 * x ** 2
const VALUES = MONTHS.map((_, i) => quad(i).toFixed(2))

describe('monthSerial', () => {
  it('counts calendar months, year boundaries included', () => {
    expect(monthSerial('2026-01-01') - monthSerial('2025-12-01')).toBe(1)
    expect(monthSerial('2026-08-01') - monthSerial('2025-08-01')).toBe(12)
  })
})

describe('fitPolyTrend', () => {
  it('recovers a perfect quadratic series', () => {
    const fit = fitPolyTrend(MONTHS, VALUES)
    expect(fit).not.toBeNull()
    expect(fit!.valueAt('2025-01-01')).toBeCloseTo(quad(0), 4)
    expect(fit!.valueAt('2025-04-01')).toBeCloseTo(quad(3), 4)
    expect(fit!.valueAt('2025-06-01')).toBeCloseTo(quad(5), 4)
  })

  it('is gap-proof: a missing month cannot compress time', () => {
    // The same generator with March deleted — serial-x fitting still reads April as
    // x=3; an index-x fit would slide it to x=2 and bend the parabola.
    const gapMonths = ['2025-01-01', '2025-02-01', '2025-04-01', '2025-05-01', '2025-06-01']
    const gapValues = [0, 1, 3, 4, 5].map((x) => quad(x).toFixed(2))
    const fit = fitPolyTrend(gapMonths, gapValues)
    expect(fit).not.toBeNull()
    expect(fit!.valueAt('2025-03-01')).toBeCloseTo(quad(2), 4)
  })

  it('extends past the series by the same law', () => {
    const fit = fitPolyTrend(MONTHS, VALUES)!
    // Six months past the last point: x=11 → 1000 + 550 + 242.
    expect(fit.valueAt('2025-12-01')).toBeCloseTo(quad(11), 4)
  })

  it('accepts zero and negative values — no logarithm involved', () => {
    // Net worth through zero: y = x² − 4 (crosses at x=2).
    const values = [0, 1, 2, 3, 4].map((x) => (x ** 2 - 4).toFixed(2))
    const fit = fitPolyTrend(MONTHS.slice(0, 5), values)
    expect(fit).not.toBeNull()
    expect(fit!.valueAt('2025-01-01')).toBeCloseTo(-4, 4)
    expect(fit!.valueAt('2025-03-01')).toBeCloseTo(0, 4)
  })

  it('refuses under three points — a unique parabola needs three', () => {
    expect(fitPolyTrend(MONTHS.slice(0, 2), VALUES.slice(0, 2))).toBeNull()
    expect(fitPolyTrend(['2025-01-01'], ['1000.00'])).toBeNull()
    expect(fitPolyTrend([], [])).toBeNull()
  })

  it('refuses non-finite values', () => {
    expect(fitPolyTrend(MONTHS.slice(0, 3), ['1000.00', 'abc', '1200.00'])).toBeNull()
  })

  it('refuses mismatched or degenerate input', () => {
    expect(fitPolyTrend(MONTHS.slice(0, 3), ['1000.00', '1010.00'])).toBeNull()
    // Three rows but only two distinct months — the normal equations are singular.
    expect(
      fitPolyTrend(
        ['2025-01-01', '2025-01-01', '2025-02-01'],
        ['1000.00', '1010.00', '1020.00'],
      ),
    ).toBeNull()
  })
})
