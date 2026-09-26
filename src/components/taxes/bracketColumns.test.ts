import { describe, expect, it } from 'vitest'
import { balancedSplit, groupWeight } from './bracketColumns'

describe('groupWeight', () => {
  it('counts the heading, the column heads and the buttons, then a row per bracket', () => {
    expect(groupWeight(7)).toBe(10)
  })

  it('counts an empty table as its one-line note', () => {
    expect(groupWeight(0)).toBe(4)
  })

  it("adds the per-worker strip: the helper, then an earner's own table or the one-line offer", () => {
    expect(groupWeight(2, { helper: true, people: [0, 2] })).toBe(5 + 1 + 1 + 5)
    expect(groupWeight(2, { helper: false, people: [0] })).toBe(5 + 1)
  })
})

// 2026-09-25 polish spec §3.5 (TPC-12d): two independent columns, the order kept whole.
describe('balancedSplit', () => {
  it('splits where the two columns come closest in height', () => {
    // Production-shaped: Federal 7, State 10, Medicare 2, Social Security 2 + strip, Disability 2 + two
    // earners' tables, Capital gains 3.
    expect(balancedSplit([10, 13, 5, 8, 15, 6])).toBe(3)
  })

  it('keeps the longer column first on a tie', () => {
    expect(balancedSplit([1, 2, 1])).toBe(2)
  })

  it('leaves fewer than two groups in one column', () => {
    expect(balancedSplit([])).toBe(0)
    expect(balancedSplit([5])).toBe(1)
  })
})
