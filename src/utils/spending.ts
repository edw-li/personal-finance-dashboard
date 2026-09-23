import type { SpendingMatrix } from '../types/api'
import { addMonths } from './months'

export interface CategoryMover {
  categoryId: number
  /** The target month's figure — the wizard writes explicit 0.00s, so 0 is a real zero. */
  value: number
  /** vs the previous month; null when that month was never entered (or does not exist). */
  deltaPrior: number | null
  /** vs the mean of the category's non-null values across up to 12 months before. */
  deltaAvg: number | null
  /** vs the month's resolved budget; null when the category has none that month. */
  deltaBudget: number | null
}

/**
 * The "what changed" math for one month: per-category deltas against the prior month and
 * the trailing average, ranked by the larger of the two so a flat-but-way-over-average
 * category still surfaces. Presentation floats over server strings (spendStats' class).
 *
 * "Entered" is judged across the whole month (any category non-null): the wizard writes
 * every active category together, so a month with no values at all is an un-entered one,
 * and deltas against it would congratulate the user for data that does not exist.
 */
export function monthMovers(
  matrix: Pick<SpendingMatrix, 'series'> & Partial<Pick<SpendingMatrix, 'months'>>,
  monthIndex: number,
  top = 5,
): CategoryMover[] {
  if (monthIndex < 0) return []
  const entered = (i: number) => matrix.series.some((s) => s.values[i] != null)
  if (!entered(monthIndex)) return []
  const priorIndex = matrix.months ? matrix.months.indexOf(addMonths(matrix.months[monthIndex], -1)) : monthIndex - 1
  const hasPrior = priorIndex >= 0 && entered(priorIndex)
  const movers: CategoryMover[] = matrix.series.flatMap((s) => {
    if (s.values[monthIndex] == null) return []
    const value = Number(s.values[monthIndex])
    const prior = hasPrior && s.values[priorIndex] != null ? Number(s.values[priorIndex]) : null
    const window = s.values
      .slice(Math.max(0, monthIndex - 12), monthIndex)
      .filter((v): v is string => v !== null)
    const avg = s.comparison_average !== undefined
      ? s.comparison_average[monthIndex] == null ? null : Number(s.comparison_average[monthIndex])
      : window.length > 0 ? window.reduce((acc, v) => acc + Number(v), 0) / window.length : null
    const budget = s.budgets[monthIndex] ?? null
    return [{
      categoryId: s.category_id,
      value,
      deltaPrior: prior === null ? null : value - prior,
      deltaAvg: avg === null ? null : value - avg,
      deltaBudget: budget === null ? null : value - Number(budget),
    }]
  })
  const magnitude = (m: CategoryMover) =>
    Math.max(Math.abs(m.deltaPrior ?? 0), Math.abs(m.deltaAvg ?? 0))
  return movers
    .filter((m) => magnitude(m) >= 0.005) // a cent of movement on either measure
    .sort((a, b) => magnitude(b) - magnitude(a))
    .slice(0, top)
}

/**
 * The spending step's "Typical" reference: the median of the up-to-3 latest non-null
 * matrix values STRICTLY before `month`. Spending is a flow, so seeds stay 0.00 — this
 * column is the context prefill would fake (spec §4.2). Number() here is display-side
 * math on server strings, same license as the chart builders.
 */
export function typicalSpend(
  matrix: SpendingMatrix,
  month: string,
  categoryId: number,
): number | null {
  const series = matrix.series.find((s) => s.category_id === categoryId)
  if (series === undefined) return null
  const values: number[] = []
  for (let i = matrix.months.length - 1; i >= 0 && values.length < 3; i -= 1) {
    if (matrix.months[i] >= month) continue // ISO strings — string compare IS date compare
    const value = series.values[i]
    if (value !== null) values.push(Number(value))
  }
  if (values.length === 0) return null
  values.sort((a, b) => a - b)
  const mid = Math.floor(values.length / 2)
  return values.length % 2 === 1 ? values[mid] : (values[mid - 1] + values[mid]) / 2
}

/** The movers table's "vs budget" column appears only when it has something to say. */
export function hasVsBudget(movers: CategoryMover[]): boolean {
  return movers.some((m) => m.deltaBudget !== null)
}

export interface BudgetProgress {
  spent: number
  budget: number
  /** min(spent/budget, 1) as a 0–100 width; floored at 0 so a refund month reads empty. */
  fillPct: number
  over: boolean
}

/**
 * One meter's math (spec §4.2): fill = min(spent/budget, 1), the beyond-100% overflow is
 * a separate boolean the panel renders as a negative-toned tick. null budget = no meter.
 * A zero budget cannot scale a bar, so it degenerates honestly: any positive spend shows
 * a full bar and reads over; no spend reads empty. Number() is display-side math on
 * server strings (format.ts's license) — nothing here goes back to the API.
 */
export function budgetProgress(spent: string | null, budget: string | null): BudgetProgress | null {
  if (budget === null) return null
  const budgetN = Number(budget)
  const spentN = spent === null ? 0 : Number(spent)
  if (!Number.isFinite(budgetN) || budgetN <= 0) {
    return { spent: spentN, budget: budgetN, fillPct: spentN > 0 ? 100 : 0, over: spentN > budgetN }
  }
  return {
    spent: spentN,
    budget: budgetN,
    fillPct: Math.max(0, Math.min(1, spentN / budgetN)) * 100,
    over: spentN > budgetN,
  }
}
