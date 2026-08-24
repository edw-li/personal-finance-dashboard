// Pure datasource + option builder for the /spending flow card (2026-08-24 spec §3) — no
// React, no fetching (historyChartOptions posture). Number() here is display-only math
// on the server's Decimal strings and is never handed back to the API.
//
// Palette law: slices arrive PRE-SLOTTED through the page's own topIds order
// (buildMonthSlices / buildYearSlices), so a category wears the exact hue its stacked-bar
// segment wears — same entity, same color everywhere, gray "Other" fold included.
import type { CategoryOut, SpendingMatrix, SpendingYearly, YearRollup } from '../../types/api'
import { formatMonth } from '../../utils/format'
import { buildMonthSlices } from '../../utils/spending'
import type { MonthSlice } from '../../utils/spending'

export interface SpendingFlowPeriod {
  /** "Jul 2026" (month mode) or "2026" (year mode) — the card title and empty-note noun. */
  label: string
  /** matrix.net_pay[i] / rollup.net_pay_total — null keeps the spec's enter-net-pay note. */
  netPay: string | null
  slices: MonthSlice[]
}

/**
 * The yearly fold, mirroring buildMonthSlices' rules over the rollup shape: same topIds
 * order = same palette slot per category, positive-only values (a link cannot be
 * negative, exactly the pie's constraint), remainder folded into gray "Other".
 */
export function buildYearSlices(
  categories: CategoryOut[],
  rollup: YearRollup,
  topIds: number[],
): MonthSlice[] {
  const nameById = new Map(categories.map((c) => [c.id, c.name]))
  const totalById = new Map(rollup.by_category.map((c) => [c.category_id, c.total]))
  const slices: MonthSlice[] = []
  topIds.forEach((id, slot) => {
    const value = Number(totalById.get(id) ?? 0)
    if (Number.isFinite(value) && value > 0) {
      slices.push({ name: nameById.get(id) ?? String(id), value, slot })
    }
  })
  const topSet = new Set(topIds)
  const other = rollup.by_category.reduce((acc, cell) => {
    if (topSet.has(cell.category_id)) return acc
    const value = Number(cell.total)
    return Number.isFinite(value) && value > 0 ? acc + value : acc
  }, 0)
  if (other > 0) slices.push({ name: 'Other', value: other, slot: null })
  return slices
}

/**
 * The flow card's datasource for one render: the month column, or that month's year from
 * the rollup. `monthIndex` is the month being LOOKED AT (the movers' rule: the drilled
 * month while the pie is open, the latest month otherwise) — year mode follows it, so
 * drilling an old December and toggling Year answers about THAT year.
 */
export function spendingFlowPeriod(
  matrix: SpendingMatrix | null,
  yearly: SpendingYearly | null,
  topIds: number[],
  monthIndex: number,
  mode: 'month' | 'year',
): SpendingFlowPeriod | null {
  if (matrix === null || monthIndex < 0 || monthIndex >= matrix.months.length) return null
  const month = matrix.months[monthIndex]
  if (mode === 'month') {
    return {
      label: formatMonth(month),
      netPay: matrix.net_pay[monthIndex],
      slices: buildMonthSlices(matrix, topIds, monthIndex),
    }
  }
  const year = Number(month.slice(0, 4))
  const rollup = yearly?.years.find((y) => y.year === year)
  if (rollup === undefined) return null
  return {
    label: String(rollup.year),
    netPay: rollup.net_pay_total,
    slices: buildYearSlices(matrix.categories, rollup, topIds),
  }
}
