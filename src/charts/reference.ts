// Reference SERIES (chart spec §10): a comparison with its own data — the sustainable-spend
// line, budgets, the FI target, averages. Dashed MUTED 2px, no symbols, above the data
// (z 9), gaps kept. Dashed is reserved for thresholds and events; data is solid.
// Absorbs spending/budgetChartOptions.budgetStepSeries (`budgetReference`).
// Depends on: charts/theme.ts (MUTED).
import { MUTED } from './theme'

export function referenceLine(
  name: string,
  data: (number | null)[],
  { step, id }: { step?: 'end'; id?: string } = {},
) {
  return {
    ...(id === undefined ? {} : { id }),
    name,
    type: 'line' as const,
    symbol: 'none' as const,
    // Budgets change discretely — steps, not slopes: each point already carries its month's
    // RESOLVED value, so the line holds level and jumps at the month a new row lands.
    ...(step === undefined ? {} : { step }),
    lineStyle: { width: 2, type: 'dashed' as const },
    color: MUTED,
    z: 9,
    connectNulls: false,
    data,
  }
}

/** A budget series over the matrix's resolved per-month strings; null = unbudgeted. */
export function budgetReference(name: string, budgets: (string | null)[]) {
  return referenceLine(
    name,
    budgets.map((v) => (v === null ? null : Number(v))),
    { step: 'end', id: `budget-${name}` },
  )
}
