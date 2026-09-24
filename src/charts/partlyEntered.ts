// A month whose spending is only PARTLY ENTERED (2026-09-23 spec §T12, review I2): saved while it
// was still running — September's rent on Sep 7 — it is K3's *partial* once it has ended, until
// it is saved again after it ends or confirmed complete. On Oct 1–15 it would otherwise draw as a
// normal, very low month ($2,072 against a typical ≈ $5.5K), the false signal the time model
// exists to avoid. So it keeps the in-progress look (charts/partial.ts: the partial item style,
// the axis mark, a tooltip head that says why) until then. A *missing* month stays hollow
// (overviewChartOptions.notEnteredMonths); an entered one is solid. Averages and reference lines
// already leave it out — it is not eligible.
import type { FlowsPartOut } from '../types/api'
import { dueByName } from '../utils/timeWords'
import { hasPartialMonth, isPartialMonth, PARTIAL_FOOTNOTE, partialNote } from './partial'

/** flows_due's partial months by their 1st. */
export type PartlyEntered = ReadonlyMap<string, FlowsPartOut>

/** Nothing partly entered — one shared empty map, so the default costs no allocation. */
export const NO_FLOWS: PartlyEntered = new Map()

/** 'YYYY-MM-01' for either month spelling the charts see ('YYYY-MM' in older fixtures). */
const firstOf = (month: string) => `${month.slice(0, 7)}-01`

/** The partial months of `time.flows_due`, keyed by their 1st. */
export function partlyEnteredMonths(flowsDue: readonly FlowsPartOut[] | null | undefined): PartlyEntered {
  return new Map((flowsDue ?? []).filter((flows) => flows.spending === 'partial').map((flows) => [flows.month, flows]))
}

/** One flag per month: drawn partial — in progress (its last day is after today) or partly
 *  entered. All false without a today and without flows. */
export function drawnPartial(
  months: readonly string[],
  todayIso: string | null | undefined,
  partly: PartlyEntered,
): boolean[] {
  return months.map(
    (month) => (typeof todayIso === 'string' && isPartialMonth(month, todayIso)) || partly.has(firstOf(month)),
  )
}

/** The tooltip head's note: the in-progress words for a running month, "spending partly entered
 *  (due by Oct 15)" for a partly entered one, null for a whole month. */
export function periodNote(month: string, todayIso: string | null | undefined, partly: PartlyEntered): string | null {
  const running = typeof todayIso === 'string' ? partialNote(month, todayIso) : null
  if (running !== null) return running
  const flows = partly.get(firstOf(month))
  return flows === undefined ? null : `spending partly entered (due by ${dueByName(flows)})`
}

/** A month-per-row table's Period column — the one for every chart's CSV: null when no month is
 *  drawn partial, so an ordinary table keeps its columns. */
export function periodColumnFor(
  months: readonly string[],
  todayIso: string | null | undefined,
  partly: PartlyEntered,
): string[] | null {
  if (!drawnPartial(months, todayIso, partly).some(Boolean)) return null
  return months.map((month) => {
    const note = periodNote(month, todayIso, partly)
    return note === null ? 'Whole month' : note.charAt(0).toUpperCase() + note.slice(1)
  })
}

/** A month-per-column table's header: "(in progress)" or "(partly entered)". */
export function periodHeaderFor(month: string, todayIso: string | null | undefined, partly: PartlyEntered): string {
  if (typeof todayIso === 'string' && isPartialMonth(month, todayIso)) return `${month} (in progress)`
  return partly.has(firstOf(month)) ? `${month} (partly entered)` : month
}

/** The footnote under a card whose axis marks a month: which kind of partial it is, in words. */
export function partialFootnote(
  months: readonly string[],
  todayIso: string | null | undefined,
  partly: PartlyEntered,
): string | null {
  const running = hasPartialMonth(months, todayIso)
  const entered = months.some((month) => partly.has(firstOf(month)))
  if (running && entered) return `${PARTIAL_FOOTNOTE} · spending partly entered`
  if (running) return PARTIAL_FOOTNOTE
  return entered ? '* Spending partly entered' : null
}
