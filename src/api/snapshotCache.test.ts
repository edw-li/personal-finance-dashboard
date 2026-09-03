import { beforeEach, describe, expect, it } from 'vitest'
import { clearSnapshots, clearSnapshotsWhere, getSnapshot, setSnapshot } from './snapshotCache'

beforeEach(() => clearSnapshots())

describe('snapshotCache', () => {
  it('stores and returns a value by key', () => {
    setSnapshot('overview', { a: 1 })
    expect(getSnapshot<{ a: number }>('overview')).toEqual({ a: 1 })
  })

  it('returns undefined for a missing key', () => {
    expect(getSnapshot('nope')).toBeUndefined()
  })

  it('overwrites on repeat set', () => {
    setSnapshot('k', 1)
    setSnapshot('k', 2)
    expect(getSnapshot('k')).toBe(2)
  })

  it('clears everything at once', () => {
    setSnapshot('a', 1)
    setSnapshot('b', 2)
    clearSnapshots()
    expect(getSnapshot('a')).toBeUndefined()
    expect(getSnapshot('b')).toBeUndefined()
  })

  // Family invalidation (2026-09-03 shell spec §13): a spending edit has no business
  // costing the portfolio page its instant paint.
  it('drops only the keys the predicate accepts', () => {
    setSnapshot('spending', 1)
    setSnapshot('spending:2026-09', 2)
    setSnapshot('portfolio:all', 3)
    clearSnapshotsWhere((key) => key === 'spending' || key.startsWith('spending:'))
    expect(getSnapshot('spending')).toBeUndefined()
    expect(getSnapshot('spending:2026-09')).toBeUndefined()
    expect(getSnapshot('portfolio:all')).toBe(3)
  })

  // Deleting while iterating the live map is how a half-cleared cache happens; the
  // snapshot of the keys is the point of the test, not an implementation detail.
  it('survives a predicate that accepts every key', () => {
    setSnapshot('a', 1)
    setSnapshot('b', 2)
    setSnapshot('c', 3)
    clearSnapshotsWhere(() => true)
    expect(getSnapshot('a')).toBeUndefined()
    expect(getSnapshot('b')).toBeUndefined()
    expect(getSnapshot('c')).toBeUndefined()
  })
})
