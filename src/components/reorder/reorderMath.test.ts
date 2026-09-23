import { describe, expect, it } from 'vitest'
import {
  AUTO_SCROLL_MAX,
  REORDER_INSTRUCTIONS,
  announce,
  autoScrollSpeed,
  clampOffset,
  contractProblems,
  keyboardTarget,
  moveUnit,
  peersOf,
  rangeSizes,
  reorderIndices,
  shiftsFor,
  signatureOf,
  slotFor,
  unitOf,
} from './reorderMath'
import type { Extent, ReorderItem } from './reorderMath'

const flat: ReorderItem<string>[] = [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }]

// Accounts-shaped (spec §2.2): groups are ranges; parent 10 carries its components 11 and 12, which
// are peers only of each other.
const grouped: ReorderItem<number>[] = [
  { id: 1, range: 'cash' },
  { id: 2, range: 'cash' },
  { id: 10, range: 'pre_tax', carries: [11, 12] },
  { id: 11, range: 'parent:10' },
  { id: 12, range: 'parent:10' },
  { id: 20, range: 'pre_tax' },
  { id: 30, range: 'liability' },
]

function stacked(heights: number[], start = 0): Extent[] {
  let top = start
  return heights.map((height) => {
    const extent = { top, height }
    top += height
    return extent
  })
}

describe('unitOf / peersOf / rangeSizes', () => {
  it('a plain item is its own unit and every item is a peer', () => {
    expect(unitOf(flat, 'B')).toEqual(['B'])
    expect(peersOf(flat, 'B')).toEqual(['A', 'B', 'C', 'D'])
  })

  it('a parent carries its components; components are peers only of their siblings', () => {
    expect(unitOf(grouped, 10)).toEqual([10, 11, 12])
    expect(peersOf(grouped, 10)).toEqual([10, 20])
    expect(peersOf(grouped, 12)).toEqual([11, 12])
    expect(peersOf(grouped, 1)).toEqual([1, 2])
  })

  it('counts the items of each range', () => {
    const sizes = rangeSizes(grouped)
    expect(sizes.get('liability')).toBe(1)
    expect(sizes.get('parent:10')).toBe(2)
    expect(rangeSizes(flat).get('')).toBe(4)
  })

  it('an unknown id has no unit and no peers', () => {
    expect(unitOf(flat, 'Z')).toEqual([])
    expect(peersOf(flat, 'Z')).toEqual([])
  })
})

describe('contractProblems', () => {
  it('finds nothing wrong with a well-formed list — carried rows right after their carrier', () => {
    expect(contractProblems(flat)).toEqual([])
    expect(contractProblems(grouped)).toEqual([])
  })

  it('names a range split apart by another', () => {
    const split: ReorderItem<string>[] = [
      { id: 'A', range: 'x' },
      { id: 'B', range: 'y' },
      { id: 'C', range: 'x' },
    ]
    expect(contractProblems(split)).toEqual([
      'range "x" is not one block: C does not follow A\'s rows. A range\'s rows must stand together.',
    ])
    expect(contractProblems([{ id: 'A' }, { id: 'B', range: 'y' }, { id: 'C' }])).toEqual([
      'the default range is not one block: C does not follow A\'s rows. A range\'s rows must stand together.',
    ])
  })

  it('names carried rows that do not follow their carrier, in order', () => {
    const astray: ReorderItem<number>[] = [
      { id: 10, range: 'g', carries: [11, 12] },
      { id: 12, range: 'parent:10' },
      { id: 11, range: 'parent:10' },
    ]
    expect(contractProblems(astray)).toEqual([
      '10 carries 11, 12, but the rows right after it are 12, 11. Carried rows must follow their carrier, in order.',
    ])
  })
})

describe('moveUnit', () => {
  it('moves down, up, to either end, and not at all', () => {
    expect(moveUnit(flat, 'A', 2)).toEqual(['B', 'C', 'A', 'D'])
    expect(moveUnit(flat, 'D', 1)).toEqual(['A', 'D', 'B', 'C'])
    expect(moveUnit(flat, 'B', 0)).toEqual(['B', 'A', 'C', 'D'])
    expect(moveUnit(flat, 'B', 3)).toEqual(['A', 'C', 'D', 'B'])
    expect(moveUnit(flat, 'C', 2)).toEqual(['A', 'B', 'C', 'D'])
  })

  it('ignores a slot outside the range', () => {
    expect(moveUnit(flat, 'A', 9)).toEqual(['A', 'B', 'C', 'D'])
    expect(moveUnit(flat, 'A', -1)).toEqual(['A', 'B', 'C', 'D'])
  })

  it('a parent moves with its components and stays inside its group', () => {
    expect(moveUnit(grouped, 10, 1)).toEqual([1, 2, 20, 10, 11, 12, 30])
    expect(moveUnit(grouped, 20, 0)).toEqual([1, 2, 20, 10, 11, 12, 30])
  })

  it('a component moves among its siblings only', () => {
    expect(moveUnit(grouped, 12, 0)).toEqual([1, 2, 10, 12, 11, 20, 30])
  })
})

describe('slotFor', () => {
  const four = stacked([40, 40, 40, 40])

  it('counts the other peers that stay above: a peer below is passed when the bottom edge reaches its midpoint, a peer above when the top edge rises past it', () => {
    expect(slotFor(four, 0, 0, 40)).toBe(0) // at rest
    expect(slotFor(four, 0, 45, 85)).toBe(1)
    expect(slotFor(four, 0, 85, 125)).toBe(2)
    expect(slotFor(four, 0, 139, 179)).toBe(3)
    expect(slotFor(four, 3, 75, 115)).toBe(2)
    expect(slotFor(four, 3, -5, 35)).toBe(0)
  })

  it('lands a unit clamped to either end at that end, and settles each edge tie', () => {
    expect(slotFor(four, 0, 120, 160)).toBe(3) // clamped to the bottom: lands last
    expect(slotFor(four, 3, 0, 40)).toBe(0) // clamped to the top: lands first
    expect(slotFor(four, 1, 60, 100)).toBe(2) // B's bottom edge exactly on C's midpoint: has passed C
    expect(slotFor(four, 1, 59, 99)).toBe(1) // a pixel short of it: has not
    expect(slotFor(four, 2, 60, 100)).toBe(2) // C's top edge exactly on B's midpoint: has not passed B
    expect(slotFor(four, 2, 59, 99)).toBe(1) // a pixel above it: has
  })

  it('lets a tall unit pass a short peer, and a short one a tall peer, by their leading edges', () => {
    // Settings › Accounts: a 401(k) carrying three components (172px) above a plain IRA (43px), the
    // last of Pre-tax. Clamped, its bottom stops on the IRA's bottom: its CENTRE could never pass
    // the IRA's midpoint (193.5), its bottom edge does.
    const tallFirst = stacked([172, 43])
    expect(slotFor(tallFirst, 0, 43, 215)).toBe(1) // clamped at +43
    expect(slotFor(tallFirst, 0, 21, 193)).toBe(0) // its bottom just short of the midpoint
    // A plain account (40px) lifted from below a parent carrying two components (120px).
    const tall = stacked([120, 40])
    expect(slotFor(tall, 1, 65, 105)).toBe(1) // its top still below the parent's midpoint (60)
    expect(slotFor(tall, 1, 55, 95)).toBe(0) // risen past it
  })
})

describe('reorderIndices / shiftsFor', () => {
  it('reorders peer indices', () => {
    expect(reorderIndices(4, 0, 2)).toEqual([1, 2, 0, 3])
    expect(reorderIndices(4, 3, 1)).toEqual([0, 3, 1, 2])
  })

  it('displaced peers move by the lifted height; the lifted entry is its landing offset', () => {
    expect(shiftsFor(stacked([40, 40, 40, 40]), 0, 2)).toEqual([80, -40, -40, 0])
    expect(shiftsFor(stacked([40, 40, 40, 40]), 3, 1)).toEqual([0, 40, 40, -80])
    expect(shiftsFor(stacked([40, 40, 40, 40]), 1, 1)).toEqual([0, 0, 0, 0])
  })

  it('handles units of different heights (a parent carrying components)', () => {
    expect(shiftsFor(stacked([120, 40]), 1, 0)).toEqual([40, -120])
  })

  it('keeps the gaps of a spaced list', () => {
    const spaced: Extent[] = [
      { top: 0, height: 30 },
      { top: 36, height: 30 },
      { top: 72, height: 30 },
    ]
    expect(shiftsFor(spaced, 0, 2)).toEqual([72, -36, -36])
  })
})

describe('clampOffset', () => {
  const four = stacked([40, 40, 40, 40], 100)

  it('keeps the unit between the first top and the last bottom', () => {
    expect(clampOffset(four, 1, -500)).toBe(-40)
    expect(clampOffset(four, 1, 500)).toBe(80)
    expect(clampOffset(four, 1, 25)).toBe(25)
  })
})

describe('keyboardTarget', () => {
  it('maps the four keys and clamps at the ends', () => {
    expect(keyboardTarget('ArrowUp', 0, 4)).toBe(0)
    expect(keyboardTarget('ArrowUp', 2, 4)).toBe(1)
    expect(keyboardTarget('ArrowDown', 3, 4)).toBe(3)
    expect(keyboardTarget('ArrowDown', 1, 4)).toBe(2)
    expect(keyboardTarget('Home', 3, 4)).toBe(0)
    expect(keyboardTarget('End', 0, 4)).toBe(3)
    expect(keyboardTarget('a', 1, 4)).toBeNull()
  })
})

describe('autoScrollSpeed', () => {
  it('is zero away from the edges, full at or past them, quadratic between', () => {
    expect(autoScrollSpeed(300, 0, 600)).toBe(0)
    expect(autoScrollSpeed(40, 0, 600)).toBe(0)
    expect(autoScrollSpeed(0, 0, 600)).toBe(-AUTO_SCROLL_MAX)
    expect(autoScrollSpeed(-30, 0, 600)).toBe(-AUTO_SCROLL_MAX)
    expect(autoScrollSpeed(600, 0, 600)).toBe(AUTO_SCROLL_MAX)
    expect(autoScrollSpeed(20, 0, 600)).toBeCloseTo(-AUTO_SCROLL_MAX / 4)
    expect(autoScrollSpeed(580, 0, 600)).toBeCloseTo(AUTO_SCROLL_MAX / 4)
  })
})

describe('announce / signatureOf / instructions', () => {
  it('speaks the spec §8.2 sentences, positions counted within the range', () => {
    expect(announce.lift({ name: 'Housing', position: 11, count: 19 })).toBe(
      'Picked up Housing. Position 11 of 19.',
    )
    expect(announce.lift({ name: 'Petty Cash', position: 1, count: 2, range: 'Other' })).toBe(
      'Picked up Petty Cash. Position 1 of 2 in Other.',
    )
    expect(announce.move({ name: 'Housing', position: 3, count: 19 })).toBe(
      'Housing, position 3 of 19.',
    )
    expect(announce.drop({ name: 'Housing', position: 3, count: 19 })).toBe(
      'Dropped Housing at position 3 of 19.',
    )
    expect(announce.dropUnmoved({ name: 'Housing', position: 3, count: 19 })).toBe(
      'Dropped Housing where it was.',
    )
    expect(announce.cancel({ name: 'Housing', position: 11, count: 19 })).toBe(
      'Cancelled. Housing is back at position 11 of 19.',
    )
    expect(announce.cancelChanged()).toBe('Cancelled — the list changed.')
    expect(REORDER_INSTRUCTIONS).toBe(
      'Press Space or Enter to pick up. Use the arrow keys to move, Home or End to jump, Space or Enter to drop, Escape to cancel.',
    )
  })

  it('changes when order, membership, range or carried rows change — and only then', () => {
    const base = signatureOf(grouped)
    expect(signatureOf([...grouped])).toBe(base)
    expect(signatureOf(grouped.slice(1))).not.toBe(base)
    expect(signatureOf([grouped[1], grouped[0], ...grouped.slice(2)])).not.toBe(base)
    expect(signatureOf(grouped.map((item) => (item.id === 1 ? { ...item, range: 'x' } : item)))).not.toBe(base)
    expect(signatureOf(grouped.map((item) => (item.id === 10 ? { ...item, carries: [11] } : item)))).not.toBe(base)
  })
})
