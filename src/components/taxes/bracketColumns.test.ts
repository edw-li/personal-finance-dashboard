import { describe, expect, it } from 'vitest'
import { balancedSplit, groupWeight } from './bracketColumns'

// Estimated pixels, calibrated on the production copy in Edge (2026-09-25): the real groups measured
// Federal 519, State 642, Medicare 211, Social Security 348, Disability 415, Capital gains 273.
describe('groupWeight', () => {
  it('charges the heading, the column heads and the buttons, then each bracket row', () => {
    expect(groupWeight(7)).toBe(88 + 7 * 62)
  })

  it('charges an empty table like a one-row one', () => {
    expect(groupWeight(0)).toBe(88 + 62)
  })

  it("adds the per-worker strip: its margin, the helper, then an earner's own table or the offer to add one", () => {
    // Social Security on a joint return: the helper and two offers.
    expect(groupWeight(2, { helper: true, people: [0, 0] })).toBe(88 + 2 * 62 + 9 + (31 + 32 + 32) + 2 * 11)
    // Disability: one earner's own two-row table, one offer.
    expect(groupWeight(1, { helper: false, people: [2, 0] })).toBe(88 + 62 + 9 + (89 + 2 * 62 + 32) + 11)
  })
})

// 2026-09-25 polish spec §3.5 (TPC-12d): two independent columns, the order kept whole.
describe('balancedSplit', () => {
  it('splits where the two columns come closest in height, the stack gap counted', () => {
    // The production tables: after State the columns measure 1,184 vs 1,287; after Medicare 1,412 vs 1,059.
    expect(balancedSplit([522, 646, 212, 338, 415, 274], 16)).toBe(2)
  })

  it('counts a gap per boundary, so a column of many short tables is charged its gaps', () => {
    expect(balancedSplit([40, 10, 10, 10, 10, 10])).toBe(2)
    expect(balancedSplit([40, 10, 10, 10, 10, 10], 20)).toBe(3)
  })

  it('keeps the longer column first on a tie', () => {
    expect(balancedSplit([1, 2, 1])).toBe(2)
  })

  it('leaves fewer than two groups in one column', () => {
    expect(balancedSplit([])).toBe(0)
    expect(balancedSplit([5])).toBe(1)
  })
})
