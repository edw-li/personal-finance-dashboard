import type { SpendingMatrix } from '../types/api'

export interface MonthSlice {
  name: string
  value: number
  /** Palette slot of a top category; null = the folded "Other" slice. */
  slot: number | null
}

// Pure month-breakdown math for the spending drill-in pie. Mirrors the stacked bars'
// fold (same topIds order = same palette slot per category) with one documented
// divergence: a pie can only draw positive slices, so zero/negative amounts (refunds)
// are EXCLUDED here while the bars net them into their stack segment. The total shown
// beside the pie stays the server's matrix.totals value, which includes them.
export function buildMonthSlices(
  matrix: Pick<SpendingMatrix, 'categories' | 'series'>,
  topIds: number[],
  monthIndex: number,
): MonthSlice[] {
  if (monthIndex < 0) return []
  const nameById = new Map(matrix.categories.map((c) => [c.id, c.name]))
  const valueById = new Map(matrix.series.map((s) => [s.category_id, s.values[monthIndex]]))
  const slices: MonthSlice[] = []
  topIds.forEach((id, slot) => {
    const value = Number(valueById.get(id) ?? 0)
    if (Number.isFinite(value) && value > 0) {
      slices.push({ name: nameById.get(id) ?? String(id), value, slot })
    }
  })
  const topSet = new Set(topIds)
  const other = matrix.series.reduce((acc, s) => {
    if (topSet.has(s.category_id)) return acc
    const value = Number(s.values[monthIndex] ?? 0)
    return Number.isFinite(value) && value > 0 ? acc + value : acc
  }, 0)
  if (other > 0) slices.push({ name: 'Other', value: other, slot: null })
  return slices
}

export interface CategoryMover {
  categoryId: number
  /** The target month's figure — the wizard writes explicit 0.00s, so 0 is a real zero. */
  value: number
  /** vs the previous month; null when that month was never entered (or does not exist). */
  deltaPrior: number | null
  /** vs the mean of the category's non-null values across up to 12 months before. */
  deltaAvg: number | null
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
  matrix: Pick<SpendingMatrix, 'series'>,
  monthIndex: number,
  top = 5,
): CategoryMover[] {
  if (monthIndex < 0) return []
  const entered = (i: number) => matrix.series.some((s) => s.values[i] !== null)
  if (!entered(monthIndex)) return []
  const priorIndex = monthIndex - 1
  const hasPrior = priorIndex >= 0 && entered(priorIndex)
  const movers: CategoryMover[] = matrix.series.map((s) => {
    const value = Number(s.values[monthIndex] ?? 0)
    const prior = hasPrior ? Number(s.values[priorIndex] ?? 0) : null
    const window = s.values
      .slice(Math.max(0, monthIndex - 12), monthIndex)
      .filter((v): v is string => v !== null)
    const avg =
      window.length > 0 ? window.reduce((acc, v) => acc + Number(v), 0) / window.length : null
    return {
      categoryId: s.category_id,
      value,
      deltaPrior: prior === null ? null : value - prior,
      deltaAvg: avg === null ? null : value - avg,
    }
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
