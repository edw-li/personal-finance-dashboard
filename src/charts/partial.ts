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

/** How much of its fill a partial bar or point keeps (spec §C5's "reduced-opacity fill"). */
export const PARTIAL_FILL_ALPHA = 0.45

/** A token colour at an alpha, spelled '#rrggbbaa'. recolor.ts maps the token part to the light
 *  theme and keeps the alpha, conformance.ts accepts it as the token it is, and the tooltip
 *  swatch reads the token. echarts has no fill-only opacity, so this is how a fill fades
 *  without its outline. */
export const withAlpha = (hex: string, alpha: number) =>
  `${hex}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`

/** The partial look on one bar or point in `color`: hatched under Chart patterns, otherwise its
 *  FILL faded (the element's opacity would fade the dashed outline too, the 2026-09-23 review);
 *  a dashed outline at full strength both ways. A heatmap cell's fill is its scale's colour, so
 *  its in-progress column fades through the scale instead (spendingHeatmapOptions.ts). */
export function partialItemStyle(color: string, patterns: boolean) {
  const outline = { borderColor: color, borderWidth: 1, borderType: 'dashed' as const }
  return patterns ? { ...outline, decal: ESTIMATE_DECAL } : { ...outline, color: withAlpha(color, PARTIAL_FILL_ALPHA) }
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

// ── The month in progress in words (the 2026-09-23 code review, 13) ────────────────────────
// The axis mark ('*') is a glyph on a canvas: the card says it in words under the chart, and
// the chart's table twin (its ExportTable, the CSV too) names the month, so no reader has to
// hover to learn which month is still growing.

/** The footnote under a card whose month axis marks a month in progress. */
export const PARTIAL_FOOTNOTE = '* Month in progress'

/** Whether any of `months` is in progress (the footnote's condition). */
export const hasPartialMonth = (months: readonly string[], todayIso: string | null | undefined): boolean =>
  partialMonths(months, todayIso).some(Boolean)

/** A month-per-row table's flag: one 'Period' cell per month — "Whole month", "Month to date
 *  (in progress)" or "Future month (in progress)" (the tooltip head's words) — or null when no
 *  month is in progress, so an ordinary table keeps its shape. */
export function periodColumn(months: readonly string[], todayIso: string | null | undefined): string[] | null {
  if (typeof todayIso !== 'string' || !hasPartialMonth(months, todayIso)) return null
  return months.map((month) => {
    const note = partialNote(month, todayIso)
    return note === null ? 'Whole month' : note.charAt(0).toUpperCase() + note.slice(1)
  })
}

/** A month-per-column table's flag: the header of a month in progress says so. */
export const periodHeader = (month: string, todayIso: string | null | undefined): string =>
  typeof todayIso === 'string' && isPartialMonth(month, todayIso) ? `${month} (in progress)` : month
