import { MUTED } from '../../charts/theme'

/**
 * A budget reference line: the 4%-rule line's exact styling grammar (dashed, MUTED,
 * symbol none, connectNulls false, z 9 — SpendingPage's four-pct series) PLUS
 * step: 'end', because budget changes are steps, not slopes (spec §4.3): each point
 * already carries its month's RESOLVED value, so the line holds level across the month
 * it applies to and jumps at the month a new effective row lands.
 */
export function budgetStepSeries(name: string, budgets: (string | null)[]) {
  return {
    id: `budget-${name}`,
    name,
    type: 'line' as const,
    symbol: 'none' as const,
    step: 'end' as const,
    lineStyle: { width: 2, type: 'dashed' as const },
    color: MUTED,
    z: 9,
    connectNulls: false,
    data: budgets.map((v) => (v === null ? null : Number(v))),
  }
}
