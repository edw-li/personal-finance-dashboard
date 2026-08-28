import { beforeEach, describe, expect, it } from 'vitest'
import { clearSnapshots, getSnapshot, setSnapshot } from './snapshotCache'

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
})
