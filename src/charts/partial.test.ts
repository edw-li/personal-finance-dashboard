import { describe, expect, it } from 'vitest'
import {
  DEFICIT_DECAL,
  ESTIMATE_DECAL,
  hasPartialMonth,
  isPartialMonth,
  PARTIAL_FOOTNOTE,
  partialItemStyle,
  partialNote,
  withAlpha,
} from './partial'
import { SURFACE } from './theme'

// 2026-09-23 spec §C5 (and §0's objective rule): a month whose last day is after today is in
// progress — drawn as such, marked on its label, and named in its tooltip.
describe('partial periods', () => {
  it('a month is in progress while its last day is still ahead of today', () => {
    expect(isPartialMonth('2026-09-01', '2026-09-23')).toBe(true)
    expect(isPartialMonth('2026-09-01', '2026-09-01')).toBe(true)
    // On its last day the month is done by the rule's letter — nothing is left to enter.
    expect(isPartialMonth('2026-09-01', '2026-09-30')).toBe(false)
    expect(isPartialMonth('2026-08-01', '2026-09-23')).toBe(false)
    // A future month (a draft entered early) is not done either.
    expect(isPartialMonth('2026-10-01', '2026-09-23')).toBe(true)
    // Year and leap boundaries: February 2028 ends on the 29th, December on the 31st.
    expect(isPartialMonth('2028-02-01', '2028-02-28')).toBe(true)
    expect(isPartialMonth('2028-02-01', '2028-02-29')).toBe(false)
    expect(isPartialMonth('2026-12-01', '2026-12-31')).toBe(false)
    expect(isPartialMonth('2026-12-01', '2026-12-30')).toBe(true)
    // The old YYYY-MM spelling: budgetMonth's copy of this rule accepted it, and BudgetPanel's
    // matrix months can still carry it (2026-09-23 spec §K1 made this the one rule).
    expect(isPartialMonth('2028-02', '2028-02-28')).toBe(true)
    expect(isPartialMonth('2028-02', '2028-02-29')).toBe(false)
  })

  it('names the reading for its tooltip', () => {
    expect(partialNote('2026-09-01', '2026-09-23')).toBe('month to date (in progress)')
    expect(partialNote('2026-10-01', '2026-09-23')).toBe('future month (in progress)')
    expect(partialNote('2026-08-01', '2026-09-23')).toBeNull()
    expect(partialNote('2026-09-01', '2026-09-30')).toBeNull()
  })

  // Review (2026-09-23 code-quality): the element's opacity faded the dashed outline with the
  // fill. Only the FILL fades now: the token at an alpha, the outline at full strength.
  it('hatches when chart patterns are on, fades the fill otherwise, and outlines dashed both ways', () => {
    expect(partialItemStyle('#3987e5', false)).toEqual({ borderColor: '#3987e5', borderWidth: 1, borderType: 'dashed', color: '#3987e573' })
    expect(partialItemStyle('#3987e5', false)).not.toHaveProperty('opacity')
    expect(partialItemStyle('#3987e5', true)).toEqual({ borderColor: '#3987e5', borderWidth: 1, borderType: 'dashed', decal: ESTIMATE_DECAL })
    // The hatch is the estimate texture: surface-coloured 45° lines, a token hex.
    expect(ESTIMATE_DECAL).toMatchObject({ dashArrayX: [1, 0], dashArrayY: [2, 4], color: SURFACE })
  })
})

// 2026-09-23 review: the deficit red reads as the tax hue (ΔE 2.5 light / 4.4 dark), so a flow
// chart that draws both textures the deficit instead of trusting colour.
describe('the deficit texture', () => {
  it('is the other diagonal from the estimate hatch, in the surface colour', () => {
    expect(DEFICIT_DECAL).toMatchObject({ dashArrayX: [1, 0], dashArrayY: [2, 4], color: SURFACE })
    expect(DEFICIT_DECAL.rotation).toBeCloseTo(Math.PI / 4)
    expect(DEFICIT_DECAL.rotation).not.toBe(ESTIMATE_DECAL.rotation)
  })
})

describe('a token at an alpha', () => {
  it('spells the token and a two-digit alpha, the form recolor and conformance read', () => {
    expect(withAlpha('#3987e5', 0.45)).toBe('#3987e573')
    expect(withAlpha('#3987e5', 1)).toBe('#3987e5ff')
    expect(withAlpha('#3987e5', 0)).toBe('#3987e500')
  })
})

// The 2026-09-23 code review (13): the '*' a month axis puts on a month in progress is said in
// words under the chart, and the chart's table twin (its ExportTable) names the month too.
describe('the month in progress in words', () => {
  it('footnotes the axis mark', () => {
    expect(PARTIAL_FOOTNOTE).toBe('* Month in progress')
  })

  it('knows whether any shown month is in progress', () => {
    expect(hasPartialMonth(['2026-07-01', '2026-08-01'], '2026-08-12')).toBe(true)
    expect(hasPartialMonth(['2026-07-01', '2026-08-01'], '2026-08-31')).toBe(false)
    expect(hasPartialMonth(['2026-08-01'], null)).toBe(false)
  })

  // The Period column and the column header moved to charts/partlyEntered.ts, which covers the
  // month in progress too (partlyEntered.test.ts; review minor 8).
})
