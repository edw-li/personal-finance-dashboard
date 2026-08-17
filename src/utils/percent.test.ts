import { describe, expect, it } from 'vitest'
import { isPlainDecimal, shiftPoint } from './percent'

// The pins that travelled with the two copies this helper replaces (BracketsEditor's
// bracket rates and EsppPage's contribution_pct): both suites still assert the same
// conversions through their own forms, and these are the edges neither form reaches.

describe('shiftPoint — percent to fraction', () => {
  it('pins the conversions the bracket editor and the period form depend on', () => {
    expect(shiftPoint('37', -2)).toBe('0.37')
    expect(shiftPoint('9.3', -2)).toBe('0.093')
    expect(shiftPoint('1.45', -2)).toBe('0.0145')
    expect(shiftPoint('11', -2)).toBe('0.11')
    expect(shiftPoint('100', -2)).toBe('1')
    expect(shiftPoint('0', -2)).toBe('0')
  })

  it('keeps one leading zero when the point walks off the front', () => {
    // ".5" is half a percent, not five: the digits move, they do not gain a neighbour.
    expect(shiftPoint('.5', -2)).toBe('0.005')
    expect(shiftPoint('0.5', -2)).toBe('0.005')
    expect(shiftPoint('.09', -2)).toBe('0.0009')
  })

  it('carries the sign across', () => {
    expect(shiftPoint('-5', -2)).toBe('-0.05')
    expect(shiftPoint('+5', -2)).toBe('+0.05')
    expect(shiftPoint('-0.140000000', 2)).toBe('-14')
  })
})

describe('shiftPoint — fraction back to percent', () => {
  it('renders a stored 9dp fraction as the percent the box shows', () => {
    expect(shiftPoint('0.140000000', 2)).toBe('14')
    expect(shiftPoint('0.130000000', 2)).toBe('13')
    expect(shiftPoint('0.000000000', 2)).toBe('0')
    expect(shiftPoint('0.334009167', 2)).toBe('33.4009167')
    expect(shiftPoint('1.000000000', 2)).toBe('100')
  })

  it('round-trips every rate the forms hand it', () => {
    for (const percent of ['37', '9.3', '1.45', '0.5', '13', '33.4009167', '0', '100']) {
      expect(shiftPoint(shiftPoint(percent, -2), 2)).toBe(percent)
    }
  })
})

describe('shiftPoint — why it is not division', () => {
  it('beats the float in every place the forms actually visit', () => {
    // Each pair: what string math stores, and what `Number(x) / 100` would have stored.
    expect(shiftPoint('9.3', -2)).toBe('0.093')
    expect(String(9.3 / 100)).toBe('0.09300000000000001')

    expect(shiftPoint('1.45', -2)).toBe('0.0145')
    expect(String(1.45 / 100)).toBe('0.014499999999999999')

    // ...and back out, where a display value would grow digits it never had.
    expect(shiftPoint('0.140000000', 2)).toBe('14')
    expect(String(0.14 * 100)).toBe('14.000000000000002')

    expect(shiftPoint('0.334009167', 2)).toBe('33.4009167')
    expect(String(0.334009167 * 100)).toBe('33.400916699999996')
  })

  it('shifts by any distance without a power of ten', () => {
    expect(shiftPoint('1', -9)).toBe('0.000000001')
    expect(shiftPoint('0.000000001', 9)).toBe('1')
    expect(shiftPoint('12345.6789', 0)).toBe('12345.6789')
  })
})

describe('shiftPoint — text no conversion should guess at', () => {
  it('hands back anything that is not a plain decimal, untouched', () => {
    // The callers' own `isPlainDecimal` gate is the backstop — NOT the server's 422, which
    // never fires on the exponent forms (see the isPlainDecimal block below).
    expect(shiftPoint('', -2)).toBe('')
    expect(shiftPoint('.', -2)).toBe('.')
    expect(shiftPoint('abc', -2)).toBe('abc')
    expect(shiftPoint('1e3', -2)).toBe('1e3')
    expect(shiftPoint('1,000', -2)).toBe('1,000')
    expect(shiftPoint('12%', -2)).toBe('12%')
  })

  it('trims the box’s own whitespace first', () => {
    expect(shiftPoint('  13  ', -2)).toBe('0.13')
  })
})

describe('isPlainDecimal — the gate every percent box runs first', () => {
  it('refuses exponent notation, which the server would have accepted', () => {
    // The whole reason this is exported. "1e-3" is not converted by shiftPoint, so it
    // travels verbatim, and Decimal("1e-3") is a legal 0.001 — a box that said a thousandth
    // of a percent would be stored as a tenth of one, with no 422 to catch it.
    expect(isPlainDecimal('1e-3')).toBe(false)
    expect(isPlainDecimal('1E2')).toBe(false)
  })

  it('accepts every shape the forms really type', () => {
    expect(isPlainDecimal('.5')).toBe(true) // half a percent
    expect(isPlainDecimal('-0.5')).toBe(true)
    expect(isPlainDecimal('5.')).toBe(true) // mid-keystroke, and still a number
    expect(isPlainDecimal('33.4009167')).toBe(true)
    expect(isPlainDecimal('  13  ')).toBe(true) // trimmed like shiftPoint's own input
  })

  it('refuses text with no digits in it at all', () => {
    expect(isPlainDecimal('')).toBe(false)
    expect(isPlainDecimal('abc')).toBe(false)
    expect(isPlainDecimal('.')).toBe(false)
    expect(isPlainDecimal('1,000')).toBe(false)
    expect(isPlainDecimal('12%')).toBe(false)
  })

  it('answers exactly for the text shiftPoint converts', () => {
    // One shape, two exports: anything shiftPoint hands back untouched is refused here,
    // and anything it converts is accepted.
    for (const text of ['', '.', 'abc', '1e3', '1,000', '12%']) {
      expect(isPlainDecimal(text)).toBe(false)
      expect(shiftPoint(text, -2)).toBe(text)
    }
    // ("0" is left out only because shifting it lands back on itself.)
    for (const text of ['13', '.5', '5.', '-0.5', '100']) {
      expect(isPlainDecimal(text)).toBe(true)
      expect(shiftPoint(text, -2)).not.toBe(text)
    }
  })
})
