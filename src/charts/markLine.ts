// The annotation grammar (chart spec §10): the ANCHOR rule (an ISO date onto a labelled
// category axis, falling forward), the dashed-MUTED vertical RULE every event wears
// (Married, retirements, Today, FI, Coast FI), the post-event AREA wash, the percentile
// MARKS, and the solid MUTED BASELINE. One owner, because two copies of "which month does
// this land on" could only drift. Data is solid; thresholds and events are dashed; nothing
// else is. Depends on: charts/theme.ts, utils/format.ts.
import { INK, MUTED, SURFACE_2 } from './theme'
import { formatMonth } from '../utils/format'

/** Dashed, hairline, muted: the annotation/threshold vocabulary. Solid is for data. */
export const MARK_LINE_STYLE = { color: MUTED, width: 1, type: 'dashed' as const }

/** The label block a vertical rule wears (one formatter per `data` entry). */
export const MARK_LINE_LABEL = {
  show: true as const,
  position: 'insideEndTop' as const,
  color: MUTED,
  fontSize: 11,
}

const monthBucket = (iso: string) => `${iso.slice(0, 7)}-01`

/**
 * The category label an ISO value lands on, or undefined when it cannot be placed. `isos`
 * are the axis's own ISO categories (ascending; ISO strings compare lexicographically —
 * utils/months.ts's contract); `normalize` buckets the target first (months bucket to the
 * first of the month; daily axes take the date as is). If the exact category is absent
 * (a gap, quarterly granularity) the anchor falls FORWARD to the first category after it. A
 * value later than every category returns undefined — there is nothing to mark yet, and
 * clamping onto the last category would date an event to a period it is not in.
 */
export function anchorLabel(
  isos: string[],
  iso: string | null | undefined,
  format: (iso: string) => string,
  normalize: (iso: string) => string = (s) => s,
): string | undefined {
  if (!iso || isos.length === 0) return undefined
  const target = normalize(iso)
  const index = isos.findIndex((candidate) => candidate >= target)
  return index === -1 ? undefined : format(isos[index])
}

/** Months only — kept as the name the net-worth and projection builders already use. */
export function anchorMonthLabel(months: string[], iso: string | null | undefined): string | undefined {
  return anchorLabel(months, iso, formatMonth, monthBucket)
}

export interface RuleEntry {
  xAxis: string
  label: { formatter: string }
}

/** One rule's data entry, or undefined when it cannot be placed (the caller filters). */
export function ruleAt(
  isos: string[],
  iso: string | null | undefined,
  label: string,
  format: (iso: string) => string,
  normalize?: (iso: string) => string,
): RuleEntry | undefined {
  const xAxis = anchorLabel(isos, iso, format, normalize)
  return xAxis === undefined ? undefined : { xAxis, label: { formatter: label } }
}

/** "Today" on a daily/date axis (the vesting calendar): the first category on or after today. */
export const todayRule = (isos: string[], todayIso: string, format: (iso: string) => string) =>
  ruleAt(isos, todayIso, 'Today', format)

/** An arrival on the month axis (FI, Coast FI — the projection). */
export const arrivalRule = (months: string[], iso: string | null | undefined, label: string) =>
  ruleAt(months, iso, label, formatMonth, monthBucket)

/** The one `markLine` a series carries for ALL its rules (echarts allows one per series).
 *  Entries that land on the SAME category MERGE into one rule labelled with both names
 *  (' · '): echarts draws one label per data entry at one position, so retiring in the
 *  month FI arrives would otherwise print two labels on top of each other. */
export function annotationRules(entries: (RuleEntry | undefined)[]) {
  const placed = entries.filter((entry): entry is RuleEntry => entry !== undefined)
  if (placed.length === 0) return undefined
  const byCategory = new Map<string, string[]>()
  for (const entry of placed) {
    const labels = byCategory.get(entry.xAxis)
    if (labels === undefined) byCategory.set(entry.xAxis, [entry.label.formatter])
    else labels.push(entry.label.formatter)
  }
  // Map keeps insertion order, so the rules stay in the order the caller handed them in.
  const data: RuleEntry[] = [...byCategory].map(([xAxis, labels]) => ({
    xAxis,
    label: { formatter: labels.join(' · ') },
  }))
  return {
    silent: true as const,
    symbol: 'none' as const,
    lineStyle: { ...MARK_LINE_STYLE },
    label: { ...MARK_LINE_LABEL },
    data,
  }
}

/** The wash after an event (the projection's "After FI"): SURFACE_2 at 0.35, muted label. */
export function afterArea(fromLabel: string, toLabel: string, label: string) {
  return {
    silent: true as const,
    itemStyle: { color: SURFACE_2, opacity: 0.35 },
    label: { show: true as const, position: 'insideTop' as const, color: MUTED, fontSize: 11, formatter: label },
    data: [[{ xAxis: fromLabel }, { xAxis: toLabel }]],
  }
}

/** p10/p50/p90 arrival marks on a reference line: MUTED circles, INK border, named labels.
 *  Points sharing a coordinate merge into ONE circle named for both (' · '): two
 *  percentiles arriving in the same month would otherwise stack two circles and two labels
 *  on the same pixel. */
export function percentileMarks(points: { name: string; label: string; value: number }[]) {
  const byCoord = new Map<string, { coord: [string, number]; names: string[] }>()
  for (const point of points) {
    const key = `${point.label}|${point.value}`
    const seen = byCoord.get(key)
    if (seen === undefined) byCoord.set(key, { coord: [point.label, point.value], names: [point.name] })
    else seen.names.push(point.name)
  }
  return {
    silent: true as const,
    symbol: 'circle' as const,
    symbolSize: 8,
    itemStyle: { color: MUTED, borderColor: INK, borderWidth: 1 },
    label: {
      show: true as const,
      position: 'top' as const,
      color: MUTED,
      fontSize: 11,
      formatter: (p: { name?: string }) => p.name ?? '',
    },
    data: [...byCoord.values()].map((entry) => ({
      name: entry.names.join(' · '),
      coord: entry.coord,
    })),
  }
}

/** The baseline: a solid MUTED hairline at zero on the named axis. */
export function zeroLine(axis: 'x' | 'y' = 'y') {
  return {
    silent: true as const,
    symbol: 'none' as const,
    lineStyle: { color: MUTED, width: 1, type: 'solid' as const },
    label: { show: false as const },
    data: [axis === 'y' ? { yAxis: 0 } : { xAxis: 0 }],
  }
}
