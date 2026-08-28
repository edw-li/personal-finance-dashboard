import { describe, expect, it } from 'vitest'
import { MUTED } from './theme'
import { MARK_LINE_LABEL, MARK_LINE_STYLE, anchorMonthLabel } from './markLine'

const MONTHS = ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01']

describe('anchorMonthLabel', () => {
  it('speaks the axis vocabulary — a formatMonth LABEL, never an ISO string', () => {
    // The x-axis carries formatMonth labels, so a markLine's value has to be one too.
    expect(anchorMonthLabel(MONTHS, '2026-08-14')).toBe('Aug 2026')
    expect(anchorMonthLabel(MONTHS, '2026-08-01')).toBe('Aug 2026')
  })

  it('falls FORWARD when the exact month is not on the axis', () => {
    expect(anchorMonthLabel(['2026-06-01', '2026-09-01'], '2026-08-14')).toBe('Sep 2026')
  })

  it('draws nothing it cannot honestly place', () => {
    expect(anchorMonthLabel(MONTHS, null)).toBeUndefined()
    expect(anchorMonthLabel(MONTHS, undefined)).toBeUndefined()
    expect(anchorMonthLabel(MONTHS, '')).toBeUndefined()
    expect(anchorMonthLabel([], '2026-08-14')).toBeUndefined()
    // Later than every month on the axis: clamping onto the last one would date the rule
    // to a month the event is not in.
    expect(anchorMonthLabel(MONTHS, '2027-01-01')).toBeUndefined()
  })
})

describe('the annotation vocabulary', () => {
  it('is dashed, hairline and muted — solid is reserved for data', () => {
    expect(MARK_LINE_STYLE).toEqual({ color: MUTED, width: 1, type: 'dashed' })
    expect(MARK_LINE_LABEL).toEqual({
      show: true,
      position: 'insideEndTop',
      color: MUTED,
      fontSize: 11,
    })
  })
})
