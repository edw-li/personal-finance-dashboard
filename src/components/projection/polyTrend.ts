// The sheet's "Net Worth over Time (Projected)" model: a second-degree polynomial
// trendline — least squares of y = c0 + c1·x + c2·x² (the user's pick over Excel's exp
// fit, which outgrows the axis and flattens the visible history). Pure float math over
// the timeseries' Decimal strings — display-only (format.ts's Number() rule), never
// handed back to the API. The attention.ts/ytd.ts posture: page-adjacent pure logic,
// no React, no fetching.

/**
 * Calendar month serial (year·12 + month−1) from an ISO month string — the fit's x.
 * NOT an array index: a skipped snapshot month must not compress time and skew the
 * curve (Excel fits on true dates; serials are the monthly-data equivalent). Same index
 * formula utils/months.ts::addMonths steps by.
 */
export function monthSerial(iso: string): number {
  const [year, month] = iso.split('-').map(Number)
  return year * 12 + (month - 1)
}

export interface PolyTrendFit {
  /** Fitted value at any ISO month: c0 + c1·x + c2·x². */
  valueAt(monthIso: string): number
}

/**
 * Null is a refusal, not an error: under three points there is no unique parabola; a
 * non-finite value has no place in the sums; and a singular system (fewer than three
 * DISTINCT months — impossible from the server, guarded for totality) has no solution.
 * The page draws the dots without the curve and says why. Unlike the exponential fit
 * this one has no positivity rule — a parabola is happy through zero.
 *
 * x is offset from the FIRST month's serial so the normal-equation sums stay small,
 * exact integers in float64 (raw serials ~24000 would push Σx⁴ past 2^53 and shred the
 * conditioning).
 */
export function fitPolyTrend(months: string[], values: string[]): PolyTrendFit | null {
  if (months.length < 3 || months.length !== values.length) return null
  const ys = values.map(Number)
  if (ys.some((y) => !Number.isFinite(y))) return null
  const base = monthSerial(months[0])
  const xs = months.map((m) => monthSerial(m) - base)
  // Normal equations for a quadratic:  [S0 S1 S2; S1 S2 S3; S2 S3 S4]·c = [T0 T1 T2].
  let s1 = 0
  let s2 = 0
  let s3 = 0
  let s4 = 0
  let t0 = 0
  let t1 = 0
  let t2 = 0
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i]
    const xx = x * x
    s1 += x
    s2 += xx
    s3 += xx * x
    s4 += xx * xx
    t0 += ys[i]
    t1 += x * ys[i]
    t2 += xx * ys[i]
  }
  const s0 = xs.length
  // Cramer's rule on the 3×3. The S sums are exact integers (x ≤ a few hundred even
  // decades from now), so a degenerate x-set makes det EXACTLY zero — the guard is sound.
  const det =
    s0 * (s2 * s4 - s3 * s3) - s1 * (s1 * s4 - s2 * s3) + s2 * (s1 * s3 - s2 * s2)
  if (det === 0) return null
  const c0 =
    (t0 * (s2 * s4 - s3 * s3) - s1 * (t1 * s4 - s3 * t2) + s2 * (t1 * s3 - s2 * t2)) / det
  const c1 =
    (s0 * (t1 * s4 - s3 * t2) - t0 * (s1 * s4 - s2 * s3) + s2 * (s1 * t2 - s2 * t1)) / det
  const c2 =
    (s0 * (s2 * t2 - t1 * s3) - s1 * (s1 * t2 - t1 * s2) + t0 * (s1 * s3 - s2 * s2)) / det
  return {
    valueAt: (monthIso) => {
      const x = monthSerial(monthIso) - base
      return c0 + c1 * x + c2 * x * x
    },
  }
}
