import { beforeEach, describe, expect, it } from 'vitest'
import { setServerToday } from './productToday'
import { dayName, dueByIso, dueByName, monthName } from './timeWords'

// The year rule is the SERVER's year (asOf.ts's): pin the product day, never the browser's.
beforeEach(() => setServerToday('2026-10-03'))

describe('timeWords — the day and month names every time surface speaks', () => {
  it('names a day without its year inside the server year, with it outside', () => {
    expect(dayName('2026-10-01')).toBe('Oct 1')
    expect(dayName('2026-09-22')).toBe('Sep 22')
    expect(dayName('2025-12-28')).toBe('Dec 28, 2025')
    expect(dayName('2027-01-01')).toBe('Jan 1, 2027')
  })

  it('names a month in full, with its year outside the server year', () => {
    expect(monthName('2026-09-01')).toBe('September')
    expect(monthName('2025-12-01')).toBe('December 2025')
  })

  it('follows the server day across a year boundary', () => {
    setServerToday('2027-01-05')
    expect(dayName('2027-01-01')).toBe('Jan 1')
    expect(monthName('2026-12-01')).toBe('December 2026')
  })

  it('says "due by" the day before the part turns overdue (spec §K3)', () => {
    expect(dueByIso({ overdue_from: '2026-10-16' })).toBe('2026-10-15')
    expect(dueByName({ overdue_from: '2026-10-16' })).toBe('Oct 15')
    expect(dueByName({ overdue_from: '2026-03-01' })).toBe('Feb 28')
  })
})
