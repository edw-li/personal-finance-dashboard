// Exact arithmetic on wire decimals, for the two or three places the sandbox grammar has to
// compute an INPUT itself (a knob's distance from actual, a preset's limit ÷ salary). Pure
// string/BigInt code: nothing here goes through a float, so a result can be written back
// into a URL or a request body without a 0.30000000000000004 ever appearing (the
// utils/percent.ts rule, extended from point-shifting to subtraction and division).
// Displayed FIGURES are still never computed here — those are the server's (global rule 9).

const PLAIN = /^(-?)(\d*)(?:\.(\d*))?$/

function scaled(text: string, places: number): bigint {
  const match = PLAIN.exec(text.trim())
  if (match === null) throw new Error(`not a decimal: ${text}`)
  const [, sign, whole = '', frac = ''] = match
  const digits = `${whole}${frac.padEnd(places, '0').slice(0, places)}`
  const value = BigInt(digits === '' ? '0' : digits)
  return sign === '-' ? -value : value
}

function unscaled(value: bigint, places: number): string {
  const negative = value < 0n
  const digits = (negative ? -value : value).toString().padStart(places + 1, '0')
  const whole = digits.slice(0, digits.length - places)
  const frac = digits.slice(digits.length - places)
  const text = places === 0 ? whole : `${whole}.${frac}`
  return trimZeros(`${negative ? '-' : ''}${text}`)
}

export function decimalsIn(text: string): number {
  const point = text.indexOf('.')
  return point === -1 ? 0 : text.length - point - 1
}

/** "0.150" → "0.15", "250.00" → "250", "-0.00" → "0". */
export function trimZeros(text: string): string {
  let out = text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text
  if (out === '-0' || out === '' || out === '-') out = '0'
  return out
}

export function subtractDecimals(a: string, b: string): string {
  const places = Math.max(decimalsIn(a), decimalsIn(b))
  return unscaled(scaled(a, places) - scaled(b, places), places)
}

/** a ÷ b floored to `places` decimals; null when b is zero. */
export function divideDecimals(a: string, b: string, places: number): string | null {
  const scale = Math.max(decimalsIn(a), decimalsIn(b))
  const divisor = scaled(b, scale)
  if (divisor === 0n) return null
  const numerator = scaled(a, scale) * 10n ** BigInt(places)
  // BigInt division truncates toward zero; floor toward −∞ for negatives so a cap is never
  // exceeded in either direction.
  let quotient = numerator / divisor
  if ((numerator < 0n) !== (divisor < 0n) && quotient * divisor !== numerator) quotient -= 1n
  return unscaled(quotient, places)
}

export function compareDecimals(a: string, b: string): -1 | 0 | 1 {
  const places = Math.max(decimalsIn(a), decimalsIn(b))
  const x = scaled(a, places)
  const y = scaled(b, places)
  return x < y ? -1 : x > y ? 1 : 0
}
