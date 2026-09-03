import { describe, expect, it } from 'vitest'
import { foldColor, lowestFreeSlot, orderedPeople, personSlot, slotColor } from './entities'
import { GROUP_COLORS, OTHER_SERIES_COLOR, PALETTE } from './theme'

const PEOPLE = [
  { id: 7, name: 'Sam', is_primary: false },
  { id: 3, name: 'Me', is_primary: true },
  { id: 9, name: 'Kim', is_primary: false },
]

describe('personSlot', () => {
  it('primary is slot 0, others follow by id, Joint (null) is last', () => {
    expect(orderedPeople(PEOPLE).map((p) => p.name)).toEqual(['Me', 'Sam', 'Kim'])
    expect(personSlot(PEOPLE, 3)).toBe(0)
    expect(personSlot(PEOPLE, 7)).toBe(1)
    expect(personSlot(PEOPLE, 9)).toBe(2)
    expect(personSlot(PEOPLE, null)).toBe(3)
    expect(personSlot(PEOPLE, 42)).toBe(0) // unknown id: the primary's slot, never -1
  })
})

describe('slots', () => {
  it('slotColor is the palette slot and folds past eight; foldColor is the Other gray', () => {
    expect(slotColor(0)).toBe(PALETTE[0])
    expect(slotColor(7)).toBe(PALETTE[7])
    expect(slotColor(8)).toBe(OTHER_SERIES_COLOR)
    expect(foldColor).toBe(OTHER_SERIES_COLOR)
    expect(GROUP_COLORS.cash).toBe(PALETTE[0]) // re-exported unchanged
  })
  it('lowestFreeSlot hands out the first unused slot and null when all eight are taken', () => {
    expect(lowestFreeSlot([])).toBe(0)
    expect(lowestFreeSlot([0, 1, 3])).toBe(2)
    expect(lowestFreeSlot([0, 1, 2, 3, 4, 5, 6, 7])).toBeNull()
    expect(lowestFreeSlot([0, 1], 3)).toBe(2)
  })
})
