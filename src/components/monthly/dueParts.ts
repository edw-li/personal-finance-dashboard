import type { FlowsPartOut, TimeStatusOut } from '../../types/api'
import { addMonths } from '../../utils/months'
import { balancesPartName, dayOf, flowsPartName, monthNameOf } from './monthlyCopy'

// "What's due" (2026-09-23 spec §M2) — the monthly update's parts the server says are due, in the
// order the wizard offers them: the current month's balances first, then every ended month whose
// spending or take-home is due (newest first), then earlier balances still provisional. The strip
// renders them, /update lands on the first, and a save names the next one.

/** The wizard's three steps, in order — the step chips and every step URL read this one list. */
export const WIZARD_STEPS = ['balances', 'spending', 'review'] as const
export type WizardStep = (typeof WIZARD_STEPS)[number]
export type DueStep = 'balances' | 'spending'

export interface DuePart {
  key: string
  kind: 'balances' | 'flows' | 'provisional'
  month: string
  step: DueStep
  /** "Oct 1 balances" / "September spending & take-home". */
  name: string
  /** What is outstanding: "not recorded yet", "entered during September — add the rest or confirm". */
  detail: string
  overdue: boolean
}

function flowsDetail(part: FlowsPartOut): string {
  // K3's copy for a partial month (spec §K3 table, M2 row); the other states name what is missing.
  if (part.spending === 'partial') return `entered during ${monthNameOf(part.month)} — add the rest or confirm`
  if (part.spending === 'missing') return part.take_home_entered ? 'spending not entered' : 'not entered'
  return 'take-home not entered'
}

export function dueParts(time: TimeStatusOut | null | undefined): DuePart[] {
  if (!time) return []
  const parts: DuePart[] = []
  const balances = time.balances
  if (balances.status !== 'final') {
    const recorded = balances.snapshot?.recorded_on ?? null
    parts.push({
      key: `balances:${balances.month}`,
      kind: 'balances',
      month: balances.month,
      step: 'balances',
      name: balancesPartName(balances.month),
      detail:
        balances.status === 'missing'
          ? 'not recorded yet'
          : `recorded early, on ${recorded === null ? 'an unknown date' : dayOf(recorded)} — update or confirm`,
      overdue: balances.overdue,
    })
  }
  for (const flows of time.flows_due) {
    parts.push({
      key: `flows:${flows.month}`,
      kind: 'flows',
      month: flows.month,
      step: 'spending',
      name: flowsPartName(flows.month),
      detail: flowsDetail(flows),
      overdue: flows.overdue,
    })
  }
  for (const snapshot of time.provisional_past) {
    parts.push({
      key: `provisional:${snapshot.month}`,
      kind: 'provisional',
      month: snapshot.month,
      step: 'balances',
      name: balancesPartName(snapshot.month),
      detail: `still provisional (recorded ${
        snapshot.recorded_on === null ? 'date unknown' : dayOf(snapshot.recorded_on)
      }) — confirm or update`,
      // Its 1st is before the current month's, so those balances were due long ago.
      overdue: true,
    })
  }
  return parts
}

/** The strip's words when nothing is due (spec §M2). */
export function nothingDueSentence(time: TimeStatusOut): string {
  const next = addMonths(time.current_month, 1)
  const early = time.current_snapshot
  if (early !== null && early.month === next && early.provisional) {
    const recorded = early.recorded_on ?? early.as_of
    return `Nothing due — ${dayOf(next)} balances recorded early (${
      recorded === null ? 'date unknown' : dayOf(recorded)
    }); update or confirm them on ${dayOf(next)}`
  }
  return `Nothing due — next: ${dayOf(next)} balances on ${dayOf(next)}`
}

/** Where /update without a month lands (spec §M2): the first due part, balances first — else the
 *  current month's Balances step. A step named in the URL picks the due part of its kind, so the
 *  Guide's step links open what is due (lane M plan, decision 8). */
export function landingFor(
  time: TimeStatusOut | null | undefined,
  fallbackMonth: string,
  requested: WizardStep | null,
): { month: string; step: WizardStep } {
  const current = time?.current_month ?? fallbackMonth
  const parts = dueParts(time)
  if (requested === null) {
    const first = parts[0]
    return first ? { month: first.month, step: first.step } : { month: current, step: 'balances' }
  }
  const kinds: DuePart['kind'][] = requested === 'balances' ? ['balances', 'provisional'] : ['flows']
  return { month: parts.find((part) => kinds.includes(part.kind))?.month ?? current, step: requested }
}

/** The part a save points at next (spec §M2): the first still due that is not the one just saved. */
export function nextDueAfter(
  time: TimeStatusOut | null | undefined,
  saved: { month: string; steps: DueStep[] },
): DuePart | null {
  return dueParts(time).find((part) => !(part.month === saved.month && saved.steps.includes(part.step))) ?? null
}
