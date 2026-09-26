import { describe, expect, it } from 'vitest'
import { deeperSpans } from './customizeReflow'

// 2026-09-25 polish spec §3.2 (OU-16): the two half-width charts pair only when they are adjacent;
// the spans are computed from the order the reader chose instead of hard-coded.
describe('deeperSpans', () => {
  const spans = (shown: Parameters<typeof deeperSpans>[0]) => Object.fromEntries(deeperSpans(shown))

  it('pairs the two charts where they sit side by side — the default order', () => {
    expect(spans(['ytd', 'performance', 'spending', 'money_flow'])).toEqual({ ytd: 12, performance: 6, spending: 6, money_flow: 12 })
  })

  it('pairs them in either order', () => {
    expect(spans(['spending', 'performance', 'ytd'])).toEqual({ spending: 6, performance: 6, ytd: 12 })
  })

  it('runs a chart with no half-width neighbour across the row', () => {
    expect(spans(['ytd', 'spending', 'money_flow'])).toEqual({ ytd: 12, spending: 12, money_flow: 12 })
    expect(spans(['performance', 'money_flow', 'spending'])).toEqual({ performance: 12, money_flow: 12, spending: 12 })
  })

  it('spans nothing when nothing is shown', () => {
    expect(deeperSpans([]).size).toBe(0)
  })
})
