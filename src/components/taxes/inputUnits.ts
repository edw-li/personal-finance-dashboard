import type { AmountKind } from '../AmountInput'
import type { TaxInputUnit } from '../../types/api'
import { canonicalAmount, isAmount } from '../../utils/amount'
import { formatCurrency } from '../../utils/format'
import { isPlainDecimal, shiftPoint } from '../../utils/percent'

// --- units (2026-09-09 spec §2) -------------------------------------------------------
// Three boxes, one wire. The server stamps every item with its unit and stores the same
// Numeric(14,4) either way; what differs is the box the value is TYPED in and the point
// shift between the two. Money is verbatim in both directions — its column is the one this
// form was built for, and trimming it would rewrite every stored "200000.0000". A count is
// shown without its trailing zeros. A percent is stored as the FRACTION the engine
// multiplies by and shown ×100, so "97.53%" saves 0.9753 — string math (shiftPoint), never
// a float divide, because 9.3 / 100 is 0.09300000000000001 and that would be the number
// saved (utils/percent.ts's whole reason for existing).
//
// Moved here out of InputsForm (2026-09-23 spec §B7 review) so the What-if override row reads
// and writes an input in the SAME units the Inputs form does — one rule, two boxes.
export const UNIT_KINDS: Record<TaxInputUnit, AmountKind> = {
  money: 'money',
  count: 'count',
  percent: 'percent',
}

/**
 * The wire's value as this unit's box shows it. Non-decimal text passes through for the
 * validators to word, exactly as a money box's would.
 */
export function toBox(unit: TaxInputUnit, stored: string | null): string {
  if (stored === null) return '' // blank, never "0": blank is what unsets an input
  if (unit === 'money' || !isPlainDecimal(stored)) return stored
  return shiftPoint(stored, unit === 'percent' ? 2 : 0)
}

/**
 * One box's text as the wire takes it. "=" arithmetic is money-only (AmountInput's rule:
 * the evaluator quantizes to 2dp, which would round a share of dividends to a hundredth).
 */
export function toWire(unit: TaxInputUnit, text: string): string {
  const canonical = canonicalAmount(text, { expressions: unit === 'money' })
  if (unit !== 'percent' || !isPlainDecimal(canonical)) return canonical
  return shiftPoint(canonical, -2)
}

/** A whole number of things, with no sign and no point: what a COUNT box can hold. */
const WHOLE = /^\d+$/

/**
 * Whether one box's text is a SHAPE this unit can hold. `isAmount` alone is the money
 * rule, and it accepts "20.5" for a count of paychecks — which the server then 422s, so the
 * user reads a raw server sentence about a mistake the form could see. RANGE stays the
 * server's (0..53 checks, a 0..1 fraction): that is a fact about the tax year, not about
 * the shape of the text.
 */
export function isWholeCount(unit: TaxInputUnit, text: string): boolean {
  return unit !== 'count' || WHOLE.test(canonicalAmount(text, { expressions: false }))
}

/** Both rules, for the places that only care whether the cell is enterable at all. */
export function isEntry(unit: TaxInputUnit, text: string): boolean {
  return isAmount(text, { expressions: unit === 'money' }) && isWholeCount(unit, text)
}

/**
 * One wire figure as this unit reads it OUTSIDE a box: what a suggestion chip says, and what
 * a computed row shows. Suggestions and computed totals are both wire values like everything
 * else, so both are shown in the box's units.
 */
export function figureText(unit: TaxInputUnit, wire: string): string {
  if (unit === 'money') return formatCurrency(wire)
  const shown = toBox(unit, wire)
  return unit === 'percent' ? `${shown}%` : shown
}
