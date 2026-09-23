// The performance cards' one-line answer (2026-09-23 spec §C8; wealth PF-1): the portfolio against
// the same money in VOO over the window the chart shows. Split out of historyChartOptions.ts (code
// review 10); pure, integer-cent arithmetic, no React.
import { rangeCutoff, rangeStartIndex, resolvedWindow } from '../../charts/timeZoom'
import type { RangeState } from '../../charts/timeZoom'
import type { PortfolioHistory } from '../../types/api'
import { formatCurrencyCompact, formatDate } from '../../utils/format'

export interface BenchmarkLede {
  direction: 'ahead' | 'behind' | 'level'
  /** Dollars, ≥ 0 — the size of the gap; `direction` carries its sign. */
  amount: number
}

/** A wire decimal as integer cents, or null when there is no figure — absent is not zero. The
 *  parse is display-grade (this file's Number() rule); every sum and product after it is BigInt,
 *  because lead × ratio in cents can pass 2^53 on a large book. */
function centsOf(raw: string | null | undefined): bigint | null {
  if (raw === null || raw === undefined) return null
  const value = Number(raw)
  return Number.isFinite(value) ? BigInt(Math.round(value * 100)) : null
}

/** n ÷ d to the nearest integer, halves away from zero (d > 0) — exact, unlike Math.round, which
 *  sends −2.5 to −2. */
function divideRounded(n: bigint, d: bigint): bigint {
  const magnitude = (2n * (n < 0n ? -n : n) + d) / (2n * d)
  return n < 0n ? -magnitude : magnitude
}

/**
 * What the portfolio made beyond what VOO would have made on the same money, over a window of the
 * weekly checkpoints (2026-09-23 spec §C8; wealth PF-1; review round 1):
 *
 *     (V_e − B_e) − r · (V_s − B_s),   r = S0_e / S0_s
 *
 * V is the portfolio, B the same deposits in VOO, S0 the starting balance alone in VOO. The lead
 * the portfolio already held when the window opens would have grown at VOO's rate too, so it is
 * grown by r before the closing lead is compared — the change in the lead alone credited VOO's own
 * growth on that head start to the portfolio (1Y on real data: $67.6K, like for like $37.2K). S0
 * takes no deposits, so its ratio IS VOO's growth over the window. Over the whole history the two
 * legs start level (B is seeded with the first week's balance), the opening lead is zero, and the
 * figure is simply the gap to the same deposits in VOO — no r needed. No XIRR, no realized figures:
 * only the history points already in the payload, in integer cents, the grown lead rounded to the
 * cent. Null — no sentence at all — when either end of the VOO leg is absent (a degraded or
 * pre-benchmark payload), when a lead that needs growing has no ratio to grow by (S0 absent or
 * zero at either end), or when the window has no length.
 */
export function benchmarkLede(
  history: PortfolioHistory,
  start = 0,
  end = history.dates.length - 1,
): BenchmarkLede | null {
  const s = Math.max(0, start)
  const e = Math.min(end, history.dates.length - 1)
  if (e <= s) return null
  const leg = history.benchmark ?? []
  const valueStart = centsOf(history.market_value[s])
  const valueEnd = centsOf(history.market_value[e])
  const legStart = centsOf(leg[s])
  const legEnd = centsOf(leg[e])
  if (valueStart === null || valueEnd === null || legStart === null || legEnd === null) return null
  const opening = valueStart - legStart
  let grown = 0n
  if (opening !== 0n) {
    const vooStart = centsOf(history.sp500?.[s])
    const vooEnd = centsOf(history.sp500?.[e])
    if (vooStart === null || vooEnd === null || vooStart <= 0n || vooEnd <= 0n) return null
    grown = divideRounded(opening * vooEnd, vooStart)
  }
  const gap = valueEnd - legEnd - grown
  return {
    direction: gap > 0n ? 'ahead' : gap < 0n ? 'behind' : 'level',
    amount: Number(gap < 0n ? -gap : gap) / 100,
  }
}

/** The lede as words and a figure — "Over 1Y: ahead of the same money in VOO by" · "$37.2K" — so a
 *  page can set the figure in the strip's bold ink. Unprefixed, it is the whole history against
 *  the leg the legend names ("the same deposits in VOO"); any window is the same MONEY — what the
 *  portfolio held when it opened, plus every deposit since. */
export function benchmarkLedeText(
  lede: BenchmarkLede,
  prefix: string | null = null,
): { text: string; amount: string | null } {
  const against = prefix === null ? 'the same deposits in VOO' : 'the same money in VOO'
  const phrase =
    lede.direction === 'ahead'
      ? `ahead of ${against} by`
      : lede.direction === 'behind'
        ? `behind ${against} by`
        : `level with ${against}`
  return {
    text: prefix === null ? phrase[0].toUpperCase() + phrase.slice(1) : `${prefix}: ${phrase}`,
    amount: lede.direction === 'level' ? null : formatCurrencyCompact(lede.amount),
  }
}

/**
 * The Portfolio card's lede, following the chart's own window (2026-09-23 spec §C8): the range
 * chip's words ("Over 1Y", "Year to date"; nothing on All), "Since <first date>" when the history
 * is shorter than the chip's range, or the dates of a window the reader dragged out with
 * ctrl+wheel. The chart echoes every window back through datazoom — a chip's own included, one
 * category past the dates when the live ping is appended — so "dragged" means a window that
 * differs from the chip's, not merely one that exists.
 */
export function performanceLede(
  history: PortfolioHistory,
  range: RangeState,
): { text: string; amount: string | null } | null {
  const last = history.dates.length - 1
  const window = resolvedWindow(history.dates, range)
  const end = Math.min(window.endValue, last)
  const lede = benchmarkLede(history, window.startValue, end)
  if (lede === null) return null
  const dragged = window.startValue !== rangeStartIndex(history.dates, range.preset) || end < last
  const cutoff = rangeCutoff(history.dates, range.preset)
  const shorter = cutoff !== null && window.startValue === 0 && history.dates[0] > cutoff
  const prefix = dragged
    ? `${formatDate(history.dates[window.startValue])} – ${formatDate(history.dates[end])}`
    : shorter
      ? `Since ${formatDate(history.dates[0])}`
      : range.preset === '1y'
        ? 'Over 1Y'
        : range.preset === 'ytd'
          ? 'Year to date'
          : null
  return benchmarkLedeText(lede, prefix)
}
