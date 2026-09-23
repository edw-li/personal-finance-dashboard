import { describe, expect, it } from 'vitest'
import { monthRuns, monthWords, runWords, spendingLeftOut, takeHomeLeftOut } from './windowWords'

// 2026-09-23 spec §C1: the cards that cover a window of months (the Overview money flow, the
// Spending "Where … went" year) name the window, and what they leave out, in one vocabulary.
describe('the window’s words', () => {
  it('says months as runs inside one year, whichever month spelling the feed uses', () => {
    expect(monthRuns(['2026-03-01', '2026-01-01', '2026-02-01', '2026-06-01'])).toEqual([
      ['2026-01-01', '2026-02-01', '2026-03-01'],
      ['2026-06-01'],
    ])
    expect(runWords(['2026-09-01', '2026-12-01'])).toBe('Sep–Dec')
    expect(monthWords(['2026-01-01', '2026-02-01', '2026-03-01', '2026-06-01'])).toBe('Jan–Mar, Jun')
    expect(monthWords(['2026-06', '2026-07'])).toBe('Jun–Jul')
  })

  it('names spending left out until its take-home is entered', () => {
    expect(spendingLeftOut(['2026-09-01'], 2026, '2072.23')).toBe(
      'Sep 2026 spending ($2,072.23) is shown once its take-home is entered.',
    )
    expect(spendingLeftOut(['2026-08-01', '2026-09-01'], 2026, 4100)).toBe(
      'Aug–Sep 2026 spending ($4,100.00) is shown once their take-home is entered.',
    )
    expect(spendingLeftOut([], 2026, 0)).toBeNull()
  })

  it('names take-home left out until its spending is entered', () => {
    expect(takeHomeLeftOut(['2026-04-01'], 2026, 6100)).toBe(
      'Apr 2026 take-home ($6,100.00) is shown once its spending is entered.',
    )
    expect(takeHomeLeftOut([], 2026, 0)).toBeNull()
  })
})
