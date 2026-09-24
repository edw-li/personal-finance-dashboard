import type { FlowsPartOut, SnapshotStateOut } from '../types/api'
import { currentYear, daysBetween } from './months'

// The as-of label builders (2026-09-23 spec §0.4(d)) — pure, shared by lanes T and M, so every
// surface names a balance by the day it describes ("as of Oct 1") and a change by the month it
// covers ("September: Sep 1 → Oct 1"). Dates are ISO strings, split — never `new Date(iso)`.

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** The month names every time surface speaks — ONE list (utils/timeWords.ts reads it too). */
export const LONG_MONTHS: readonly string[] = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** A snapshot's key and standing — a SnapshotStateOut, or the same fields off a summary or a
 *  timeseries point. Optional because those wire types carry them optionally (fixtures written
 *  before 2026-09-24 keep compiling): an absent `as_of` reads as unknown, an absent
 *  `provisional` as final. */
type Dated = Pick<SnapshotStateOut, 'month'> & Partial<Pick<SnapshotStateOut, 'as_of' | 'provisional'>>

/** 'Oct 1' — with ', 2025' outside the server's current year. The one day label: formatAsOf and
 *  utils/timeWords.ts's dayName both spell a day through it. */
export function dayLabel(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number)
  const label = `${SHORT[month - 1]} ${day}`
  return year === currentYear() ? label : `${label}, ${year}`
}

/** "Oct 1" (", 2025" outside the server's year) or "date unknown". */
export function formatAsOf(state: Dated): string {
  return state.as_of == null ? 'date unknown' : dayLabel(state.as_of)
}

/** "Sep 22 · provisional" / "Oct 1" / "date unknown · provisional" — the day and its standing,
 *  for a sentence that brings its own preposition ("to Sep 22 · provisional"). */
export function dayPhrase(state: Dated): string {
  return `${formatAsOf(state)}${state.provisional ? ' · provisional' : ''}`
}

/** "as of Oct 1" / "as of Sep 22 · provisional" — "date unknown · provisional" without a date
 *  (only a snapshot still ahead of its month can lack one). */
export function asOfPhrase(state: Dated): string {
  return state.as_of == null ? dayPhrase(state) : `as of ${dayPhrase(state)}`
}

const monthIndex = (iso: string) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1

/** Whether the change from `previous` to `current` is ONE month's story — both final, the monthly
 *  grain, consecutive months — which changePhrase words "September: Sep 1 → Oct 1" and a story
 *  note may follow; anything else is a "since …" span. Ask this rather than parsing the phrase. */
export function isMonthStory(
  previous: Dated | null | undefined,
  current: Dated,
  { period = 'month' }: { period?: 'month' | 'quarter' } = {},
): boolean {
  if (previous == null || period === 'quarter' || previous.provisional || current.provisional) return false
  return monthIndex(current.month) - monthIndex(previous.month) === 1
}

/** What a change covers (spec §0.4(d)): "September: Sep 1 → Oct 1" (both final, consecutive —
 *  the user's own wording); "since Sep 1 · 21 days" (the current one provisional); "since Sep 22
 *  · 40 days (Oct 1 balances stayed provisional)" (the previous one never became final); "since
 *  Aug 1 · 2 months" (both final, a gap); "since Jul 1" (quarterly). Null with nothing to
 *  compare; an unknown date drops the count. */
export function changePhrase(
  previous: Dated | null | undefined,
  current: Dated,
  { period = 'month' }: { period?: 'month' | 'quarter' } = {},
): string | null {
  if (previous == null) return null
  const since = `since ${formatAsOf(previous)}`
  if (period === 'quarter') return since
  const days =
    previous.as_of != null && current.as_of != null ? daysBetween(previous.as_of, current.as_of) : null
  const span = days === null ? '' : ` · ${days} ${days === 1 ? 'day' : 'days'}`
  if (previous.provisional) return `${since}${span} (${dayLabel(previous.month)} balances stayed provisional)`
  if (current.provisional) return `${since}${span}`
  if (isMonthStory(previous, current)) {
    return `${LONG_MONTHS[monthIndex(previous.month) % 12]}: ${formatAsOf(previous)} → ${formatAsOf(current)}`
  }
  return `${since} · ${monthIndex(current.month) - monthIndex(previous.month)} months`
}

/** Why a point is provisional, in the one sentence every chart shares (2026-09-23 spec §T1, §T7,
 *  §R8 — the Overview trend, the Net worth charts, the Projection's hollow dot): "Oct 1 balances
 *  recorded early, on Sep 22 — provisional"; a snapshot provisional only because its month is still
 *  ahead (no earlier recorded date) reads "Dec 1 balances — provisional until Dec 1". */
export function provisionalNote(month: string, recordedOn: string | null | undefined): string {
  return recordedOn != null && recordedOn < month
    ? `${dayLabel(month)} balances recorded early, on ${dayLabel(recordedOn)} — provisional`
    : `${dayLabel(month)} balances — provisional until ${dayLabel(month)}`
}

/** The tail a month's story carries while that month is listed in `time.flows_due` — pass its
 *  entry (undefined when it is not listed): " · spending not entered yet" (missing), " · spending
 *  not complete yet" (partial), else nothing. */
export function storyNote(flows: Pick<FlowsPartOut, 'spending'> | null | undefined): string {
  if (flows?.spending === 'missing') return ' · spending not entered yet'
  if (flows?.spending === 'partial') return ' · spending not complete yet'
  return ''
}
