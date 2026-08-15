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
