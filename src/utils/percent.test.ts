import { describe, expect, it } from 'vitest'
import { shiftPoint } from './percent'

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
    // The callers' validation and the server's 422 are the backstop.
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
