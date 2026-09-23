// The month in progress and the chart textures that say "not what it looks like" (2026-09-23
// spec §C5, and the deficit texture of the 2026-09-23 review). Moved out of grammar.ts, which
// re-exports every symbol. Depends on: charts/theme.ts.
import { SURFACE } from './theme'

// ── Partial periods (2026-09-23 spec §C5) ──────────────────────────────────────────────────
// The spec's objective rule (§0): a month whose last day is after today is in progress. The
// treatment reuses the chart-patterns switch (useChartDecals): hatched when patterns are on —
// echarts textures every series then, so the partial item gets the estimate hatch instead of
// its series' — faded otherwise; a dashed outline both ways. Averages already leave it out.

/** The estimate hatch (the vesting chart's own values): 45° surface-coloured lines over the
 *  fill — a token hex, so the light recolor and the conformance colour rule both hold. */
export const ESTIMATE_DECAL = {
  symbol: 'rect' as const,
  symbolSize: 1,
  dashArrayX: [1, 0],
  dashArrayY: [2, 4],
  rotation: -Math.PI / 4,
  color: SURFACE,
}

/** The deficit's texture (2026-09-23 review): a flow chart's Drawdown is money drawn from savings,
 *  and its red sits under the normal-vision floor from the tax hue (OKLab ΔE 2.5 light / 4.4
 *  dark) and from PALETTE[1] and [4]. Colour alone cannot keep it apart from the Taxes node it
 *  often funds, so it is hatched: the estimate hatch's other diagonal, so the two textures never
 *  read as one. */
export const DEFICIT_DECAL = { ...ESTIMATE_DECAL, rotation: Math.PI / 4 }

/** The partial look on one bar, cell or point in `color` (its outline's). */
export function partialItemStyle(color: string, patterns: boolean) {
  const outline = { borderColor: color, borderWidth: 1, borderType: 'dashed' as const }
  return patterns ? { ...outline, decal: ESTIMATE_DECAL } : { ...outline, opacity: 0.45 }
}

/** The last day of an ISO month ('2026-09-01' → '2026-09-30'), by string math — never a
 *  Date parse (format.ts's UTC-shift rule); the y/m/d constructor is local and safe. */
function lastDayOf(month: string): string {
  const year = Number(month.slice(0, 4))
  const monthNumber = Number(month.slice(5, 7))
  const days = new Date(year, monthNumber, 0).getDate()
  return `${month.slice(0, 7)}-${String(days).padStart(2, '0')}`
}

/** In progress: the month's last day is after `todayIso` (spec §0, §C5). */
export function isPartialMonth(month: string, todayIso: string): boolean {
  return lastDayOf(month) > todayIso.slice(0, 10)
}

/** What a partial month's tooltip head adds: "month to date (in progress)" for the month under
 *  way, "future month (in progress)" for a draft ahead of it; null for a finished month. */
export function partialNote(month: string, todayIso: string): string | null {
  if (!isPartialMonth(month, todayIso)) return null
  return month.slice(0, 7) === todayIso.slice(0, 7) ? 'month to date (in progress)' : 'future month (in progress)'
}

/** The months in progress (2026-09-23 spec §C5, the grammar's objective rule), one flag per
 *  month; all false without a today. */
export const partialMonths = (months: readonly string[], todayIso: string | null | undefined): boolean[] =>
  months.map((month) => typeof todayIso === 'string' && isPartialMonth(month, todayIso))

/** The labels a month axis marks as in progress. */
export const markedLabels = (labels: readonly string[], partial: readonly boolean[]): Set<string> =>
  new Set(labels.filter((_, i) => partial[i]))
