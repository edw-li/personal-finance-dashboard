// The drill-in pie's slices for one month (the Spending page's "<Month> breakdown" card). Moved
// out of utils/spending.ts by the 2026-09-23 code review (10): a slice carries its chart colour
// from the category registry, and utils/ never reaches up into the chart grammar
// (utils/layering.test.ts) — so the pie's math lives beside the charts that draw it.
import { ENTITY, foldColor } from '../../charts/entities'
import type { CategoryFold } from '../../charts/entities'
import type { SpendingMatrix } from '../../types/api'

export interface MonthSlice {
  name: string
  value: number
  /** The slice's registry colour (charts/entities.ts): its fold hue, or the Other gray. */
  color: string
}

// Pure month-breakdown math for the spending drill-in pie. Mirrors the stacked bars'
// fold (same fold order, same colour per category — 2026-09-23 spec §C2) with one
// documented divergence: a pie can only draw positive slices, so zero/negative amounts
// (refunds) are EXCLUDED here while the bars net them into their stack segment. The total
// shown beside the pie stays the server's matrix.totals value, which includes them.
export function buildMonthSlices(
  matrix: Pick<SpendingMatrix, 'categories' | 'series'>,
  fold: CategoryFold,
  monthIndex: number,
): MonthSlice[] {
  if (monthIndex < 0) return []
  const nameById = new Map(matrix.categories.map((c) => [c.id, c.name]))
  const valueById = new Map(matrix.series.map((s) => [s.category_id, s.values[monthIndex]]))
  const slices: MonthSlice[] = []
  for (const id of fold.ids) {
    const value = Number(valueById.get(id) ?? 0)
    if (Number.isFinite(value) && value > 0) {
      slices.push({ name: nameById.get(id) ?? String(id), value, color: foldColor(fold, id) })
    }
  }
  const topSet = new Set(fold.ids)
  const other = matrix.series.reduce((acc, s) => {
    if (topSet.has(s.category_id)) return acc
    const value = Number(s.values[monthIndex] ?? 0)
    return Number.isFinite(value) && value > 0 ? acc + value : acc
  }, 0)
  if (other > 0) slices.push({ name: 'Other', value: other, color: ENTITY.other })
  return slices
}
