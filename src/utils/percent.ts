// Percent <-> fraction conversion for the forms whose boxes show percents while the
// column stores a fraction. Pure string math: nothing here ever produces a float, and
// nothing here ever reaches the API as one (src/utils/format.ts's rule, from the other
// direction — format.ts parses server strings for DISPLAY, this file builds the strings
// the server is about to store).

/**
 * Move a decimal string's point by `places`, keeping every digit exact.
 *
 * The forms show percents while the columns store fractions, and float division would
 * make that round trip lossy: 9.3 / 100 is 0.09300000000000001 in binary, and that string
 * would be saved as the year's real state tax rate. Shifting the point across the digits
 * pins "37" -> "0.37", "9.3" -> "0.093", "1.45" -> "0.0145" (and back).
 *
 * Anything that is not a plain decimal is handed back untouched — the callers' own
 * validation, and the server's 422 behind it, refuse such text before a save, so no
 * conversion has to guess at it.
 */
export function shiftPoint(raw: string, places: number): string {
  const text = raw.trim()
  const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(text)
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
