// Shared category-axis annotation grammar: the ANCHOR rule (an ISO date onto a
// formatMonth axis, falling forward) and the dashed-MUTED vocabulary every vertical rule
// in this app wears. One owner, because two copies of "which month does this land on"
// could only drift — the wedding rule on the net-worth trend and the retirement rules on
// the projection are the same annotation with different words.
import { MUTED } from './theme'
import { formatMonth } from '../utils/format'

/** Dashed, hairline, muted: the annotation/threshold vocabulary. Solid is for data. */
export const MARK_LINE_STYLE = { color: MUTED, width: 1, type: 'dashed' as const }

/** The label block a vertical rule wears. Callers supply the words — one `formatter` at
 *  this level for a single-rule annotation, or one per `data` entry when each rule has
 *  its own name (echarts merges the entry's label over this one). */
export const MARK_LINE_LABEL = {
  show: true as const,
  position: 'insideEndTop' as const,
  color: MUTED,
  fontSize: 11,
}

/**
 * The x-axis category label an ISO date lands on, or undefined when it cannot be placed.
 *
 * The date is normalised to its month; if that exact month is not on the axis (a gap, or
 * quarterly granularity) the anchor falls FORWARD to the first month after it. A date
 * later than every month returns undefined — there is nothing to mark yet, and clamping
 * onto the last month would date a rule to a month the event is not in.
 */
export function anchorMonthLabel(
  months: string[],
  iso: string | null | undefined,
): string | undefined {
  if (!iso || months.length === 0) return undefined
  // ISO first-of-month strings compare lexicographically (utils/months.ts's contract).
  const bucket = `${iso.slice(0, 7)}-01`
  const index = months.findIndex((month) => month >= bucket)
  return index === -1 ? undefined : formatMonth(months[index])
}
