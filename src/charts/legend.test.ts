import { describe, expect, it } from 'vitest'
import { FOCUS, legendFor } from './legend'
import { MUTED } from './theme'

describe('legendFor', () => {
  it('is plain up to eight entries and scrolls past them, muted pager either way', () => {
    expect(legendFor(8)).toEqual({ top: 0, type: 'plain', pageIconColor: MUTED, pageTextStyle: { color: MUTED } })
    expect(legendFor(9).type).toBe('scroll')
  })
  it("carries the page's persisted picks when given, and no key when not", () => {
    expect(legendFor(3, { 'Total budget': false }).selected).toEqual({ 'Total budget': false })
    expect('selected' in legendFor(3)).toBe(false)
  })
  it('FOCUS is the series-focus emphasis every multi-series line/bar spreads', () => {
    expect(FOCUS).toEqual({ emphasis: { focus: 'series' } })
  })
})
