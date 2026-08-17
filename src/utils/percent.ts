// Percent <-> fraction conversion for the forms whose boxes show percents while the
// column stores a fraction. Pure string math: nothing here ever produces a float, and
// nothing here ever reaches the API as one (src/utils/format.ts's rule, from the other
// direction — format.ts parses server strings for DISPLAY, this file builds the strings
// the server is about to store).

// The ONE shape both exports are about: an optional sign, then digits with an optional
// point — either half of which may be empty ("5." and ".5" are both plain), but not both.
// Shared so `isPlainDecimal` cannot drift from what `shiftPoint` will actually convert.
const PLAIN = /^([+-]?)(\d*)(?:\.(\d*))?$/

/**
 * Whether `text` is a plain decimal — i.e. whether `shiftPoint` will convert it rather than
 * hand it back.
 *
 * This is the callers' gate, and it has to be THEIRS to run: the server is not a backstop
 * for the text this refuses. Python's Decimal accepts exponent notation, so a box holding
 * "1e-3" travels untouched, parses as a perfectly legal 0.001, and is stored — a percent
 * box that said one-thousandth of a percent silently becomes a tenth of one, with no 422
 * anywhere on the round trip. Only "1e400" and friends would ever reach a 422, and by then
 * the in-range values have already been written.
 */
export function isPlainDecimal(text: string): boolean {
  const match = PLAIN.exec(text.trim())
  // At least one digit somewhere: "." and "" match the pattern but convert to nothing.
  return match !== null && `${match[2]}${match[3] ?? ''}` !== ''
}

/**
 * Move a decimal string's point by `places`, keeping every digit exact.
 *
 * The forms show percents while the columns store fractions, and float division would
 * make that round trip lossy: 9.3 / 100 is 0.09300000000000001 in binary, and that string
 * would be saved as the year's real state tax rate. Shifting the point across the digits
 * pins "37" -> "0.37", "9.3" -> "0.093", "1.45" -> "0.0145" (and back).
 *
 * Anything that is not a plain decimal is handed back untouched, because no conversion
 * should guess at it — which is why every caller gates on `isPlainDecimal` first (see its
 * note: for exponent notation the server's 422 is NOT behind them).
 */
export function shiftPoint(raw: string, places: number): string {
  const text = raw.trim()
  const match = PLAIN.exec(text)
  if (!match) return text
  const [, sign, whole, frac = ''] = match
  const digits = `${whole}${frac}`
  if (digits === '') return text
  let point = whole.length + places
  let shifted = digits
  if (point <= 0) {
    shifted = `${'0'.repeat(1 - point)}${digits}` // one leading zero survives: "0.37"
    point = 1
  } else if (point > shifted.length) {
    shifted = shifted.padEnd(point, '0')
  }
  const head = shifted.slice(0, point).replace(/^0+(?=\d)/, '')
  const tail = shifted.slice(point).replace(/0+$/, '')
  return `${sign}${tail === '' ? head : `${head}.${tail}`}`
}
