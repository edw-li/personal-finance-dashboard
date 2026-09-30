import { canonicalAmount, isAmount, quantize } from '../../utils/amount'

export type TakeHomeAmounts = Record<number, string>

export function takeHomeStatus(amounts: TakeHomeAmounts, personIds: readonly number[]) {
  const entered = Object.values(amounts).filter(value => value.trim() !== '')
  const missing = personIds.filter(id => !(amounts[id] ?? '').trim())
  // Sum rounded cents, matching the API, without introducing floating-point pennies.
  let cents = 0n
  for (const value of entered) {
    if (!isAmount(value) || Number(canonicalAmount(value)) < 0) return { total: '', valid: false, missing }
    cents += BigInt(quantize(canonicalAmount(value), 2).replace('.', ''))
  }
  const total = entered.length === 0 ? '' : `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`
  return { total, valid: cents <= 999999999999n && (entered.length === 0 || missing.length === 0), missing }
}

export function canonicalTakeHome(amounts: TakeHomeAmounts): TakeHomeAmounts {
  return Object.fromEntries(Object.entries(amounts).map(([id, value]) => [
    id, value.trim() === '' ? '' : quantize(canonicalAmount(value), 2),
  ]))
}
