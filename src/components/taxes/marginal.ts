// Pure marginal-rate math for the taxes page — no React, no fetching, no echarts. This is
// the ONE corner of the app licensed to do money arithmetic client-side, because its whole
// job is a planning figure the server deliberately does not compute (design 2026-08-31 §D3:
// "pure client-side — walk the already-fetched bracket tables"). Number() here is
// display-bound: nothing derived in this file is ever sent back to the API.
//
// Bracket semantics mirror backend/app/services/tax_service.py `walk` exactly: thresholds
// are inclusive FLOORS (the API validates ascending order with thresholds[0] == 0), a
// threshold belongs to the bracket BELOW it, and non-positive income is not taxed. Every
// function below assumes ascending order — toBrackets is the only door in and sorts.
import type { TaxBracketOut } from '../../types/api'

export interface Bracket {
  rate: number
  floor: number
}

export interface LadderSegment {
  rate: number
  floor: number
  /** The next bracket's floor; null on the unbounded top bracket. */
  ceiling: number | null
  /** Whether taxable income lands HERE (floor < ti <= ceiling — the walk's boundary rule). */
  current: boolean
}

/** The sentence's step: "your next $1,000". */
export const MARGINAL_STEP = 1000

// Display-only cents rounding (taxChartOptions' roundTo): the walk is float arithmetic,
// and a marginal figure must land back on cents before formatCurrency sees it.
function roundTo(value: number, places: number): number {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

/** Wire rows → sorted numeric brackets. bracket_index is ignored — order comes from the
 *  thresholds, defensively (the server's own posture). */
export function toBrackets(rows: TaxBracketOut[]): Bracket[] {
  return rows
    .map((row) => ({ rate: Number(row.rate), floor: Number(row.threshold) }))
    .sort((a, b) => a.floor - b.floor)
}

/** Progressive walk — tax_service.walk in floats. Full precision; callers round. */
export function taxAt(brackets: Bracket[], income: number): number {
  if (income <= 0) return 0
  let total = 0
  for (const [index, bracket] of brackets.entries()) {
    if (income <= bracket.floor) break
    const ceiling = index + 1 < brackets.length ? brackets[index + 1].floor : income
    total += (Math.min(income, ceiling) - bracket.floor) * bracket.rate
  }
  return total
}

/** What the NEXT `step` dollars of ordinary income cost in this table, at cents. */
export function marginalCost(
  brackets: Bracket[],
  taxableIncome: number,
  step = MARGINAL_STEP,
): number {
  return roundTo(taxAt(brackets, taxableIncome + step) - taxAt(brackets, taxableIncome), 2)
}

/** One jurisdiction's ladder rows, the containing bracket marked. Empty table → []. */
export function ladderSegments(brackets: Bracket[], taxableIncome: number): LadderSegment[] {
  return brackets.map((bracket, index) => {
    const ceiling = index + 1 < brackets.length ? brackets[index + 1].floor : null
    return {
      rate: bracket.rate,
      floor: bracket.floor,
      ceiling,
      // ti <= 0 sits nowhere (nothing is taxed), and income exactly ON a floor still sits
      // in the bracket beneath — both are the walk's own rules, restated as geometry.
      current:
        taxableIncome > bracket.floor && (ceiling === null || taxableIncome <= ceiling),
    }
  })
}

/**
 * The additional-Medicare tier's bite on the next `step` dollars of WAGES: (top rate minus
 * the rate below it) × step, at cents — the 0.9% surcharge priced from the STORED table's
 * own numbers, never a literal. Null when the table has fewer than two tiers or combined
 * wages do not sit strictly ABOVE the top floor (a wage exactly ON the floor belongs to
 * the tier below — the walk's boundary rule again).
 */
export function additionalMedicareStep(
  brackets: Bracket[],
  taxableWages: number,
  step = MARGINAL_STEP,
): number | null {
  if (brackets.length < 2) return null
  const top = brackets[brackets.length - 1]
  if (taxableWages <= top.floor) return null
  return roundTo((top.rate - brackets[brackets.length - 2].rate) * step, 2)
}
