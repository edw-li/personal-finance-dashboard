import { describe, expect, it } from 'vitest'
import { apportionCents, fanCents } from './fan'

// Review nit (2026-09-23 spec §C1): a flow split pro-rata in floats and rounded slice by slice
// leaves a node a cent or two away from the sum of its links. Whole cents, largest remainder.
describe('cent-exact splits', () => {
  it('apportions a total in proportion, exactly: floors first, leftover cents to the largest remainders', () => {
    expect(apportionCents(7, [10000, 10000, 10001])).toEqual([2, 2, 3])
    expect(apportionCents(10000, [1, 1, 1])).toEqual([3334, 3333, 3333]) // ties go to the earlier weight
    expect(apportionCents(0, [5, 5])).toEqual([0, 0])
    expect(apportionCents(9, [0, 0])).toEqual([0, 0]) // nothing to weigh by: nothing allotted
    for (const [total, weights] of [[101, [3, 3, 3]], [99999, [7, 13, 1, 29]], [1, [1, 1, 1, 1]]] as [number, number[]][]) {
      const parts = apportionCents(total, weights)
      expect(parts.reduce((acc, part) => acc + part, 0)).toBe(total)
    }
  })

  it('fans sources into targets pro-rata, exact on both margins', () => {
    // Refunds 7¢, drawdown $100.00, take-home $199.94 into $100.00 / $100.00 / $100.01.
    const grid = fanCents([7, 10000, 19994], [10000, 10000, 10001])
    expect(grid.map((row) => row.reduce((acc, cell) => acc + cell, 0))).toEqual([7, 10000, 19994])
    expect([0, 1, 2].map((j) => grid.reduce((acc, row) => acc + row[j], 0))).toEqual([10000, 10000, 10001])
    expect(grid.flat().every((cell) => Number.isInteger(cell) && cell >= 0)).toBe(true)
    // One source takes everything; no sources, nothing.
    expect(fanCents([300], [100, 200])).toEqual([[100, 200]])
    expect(fanCents([], [100])).toEqual([])
  })
})
