// The sheet's "Net Worth over Time (Projected)" model: Excel's `exp` trendline is least
// squares on (x, ln y), i.e. y = e^(a + b·x). Pure float math over the timeseries'
// Decimal strings — display-only (format.ts's Number() rule), never handed back to the
// API. The attention.ts/ytd.ts posture: page-adjacent pure logic, no React, no fetching.

/**
 * Calendar month serial (year·12 + month−1) from an ISO month string — the fit's x.
 * NOT an array index: a skipped snapshot month must not compress time and skew the rate
 * (Excel fits on true dates; serials are the monthly-data equivalent). Same index
 * formula utils/months.ts::addMonths steps by.
 */
export function monthSerial(iso: string): number {
  const [year, month] = iso.split('-').map(Number)
  return year * 12 + (month - 1)
}

export interface ExpTrendFit {
  /** e^b — the fitted month-over-month growth factor. */
  monthlyGrowth: number
  /** monthlyGrowth^12 − 1, fraction form — feeds formatPct directly. */
  annualRate: number
  /** Fitted value at any ISO month: e^(a + b·serial). */
  valueAt(monthIso: string): number
}

/**
 * Null is a refusal, not an error: under two points there is no trend; a nonpositive or
 * non-finite value has no logarithm (Excel refuses exp trendlines on such data too); and
 * zero x-variance (duplicate months — impossible from the server, guarded for totality)
 * has no slope. The page draws the dots without the curve and says why.
 */
export function fitExpTrend(months: string[], values: string[]): ExpTrendFit | null {
  if (months.length < 2 || months.length !== values.length) return null
  const ys = values.map(Number)
  if (ys.some((y) => !Number.isFinite(y) || y <= 0)) return null
  const xs = months.map(monthSerial)
  const zs = ys.map(Math.log)
  const n = xs.length
  const xMean = xs.reduce((sum, x) => sum + x, 0) / n
  const zMean = zs.reduce((sum, z) => sum + z, 0) / n
  let sxx = 0
  let sxz = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - xMean
    sxx += dx * dx
    sxz += dx * (zs[i] - zMean)
  }
  if (sxx === 0) return null
  const b = sxz / sxx
  const a = zMean - b * xMean
  const monthlyGrowth = Math.exp(b)
  return {
    monthlyGrowth,
    annualRate: monthlyGrowth ** 12 - 1,
    valueAt: (monthIso) => Math.exp(a + b * monthSerial(monthIso)),
  }
}
