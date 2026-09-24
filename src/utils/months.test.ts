import { afterEach, describe, expect, it, vi } from 'vitest'
import { isPartialMonth } from '../charts/partial'
import {
  addDays,
  addMonths,
  currentMonthIso,
  currentYear,
  daysBetween,
  lastNMonths,
  monthGrid,
  todayIso,
} from './months'
import { resetServerTodayForTests, setServerToday } from './productToday'

describe('addMonths', () => {
  it('moves across year boundaries', () => {
    expect(addMonths('2026-01-01', -1)).toBe('2025-12-01')
    expect(addMonths('2025-12-01', 1)).toBe('2026-01-01')
    expect(addMonths('2026-08-01', -12)).toBe('2025-08-01')
  })
})

describe('lastNMonths', () => {
  it('returns ascending window ending at the anchor', () => {
    expect(lastNMonths('2026-03-01', 3)).toEqual(['2026-01-01', '2026-02-01', '2026-03-01'])
  })
})

describe('currentMonthIso', () => {
  it('is a first-of-month ISO date', () => {
    expect(currentMonthIso()).toMatch(/^\d{4}-\d{2}-01$/)
  })
})

describe('addDays', () => {
  it('crosses month, year and leap boundaries', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29') // leap year
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
    expect(addDays('2026-08-24', 45)).toBe('2026-10-08') // the Up-next window shape
  })
})

describe('monthGrid', () => {
  it('February 2026 starts on a Sunday and needs no padding', () => {
    const weeks = monthGrid('2026-02-01')
    expect(weeks).toHaveLength(4)
    expect(weeks[0][0]).toBe('2026-02-01')
    expect(weeks[3][6]).toBe('2026-02-28')
  })

  it('August 2026 pads to six Sunday-first weeks', () => {
    const weeks = monthGrid('2026-08-01')
    expect(weeks).toHaveLength(6)
    expect(weeks[0][0]).toBe('2026-07-26') // the Sunday before Sat Aug 1
    expect(weeks[0][6]).toBe('2026-08-01')
    expect(weeks[5][6]).toBe('2026-09-05') // the Saturday after Mon Aug 31
    expect(weeks.flat()).toHaveLength(42)
  })
})

describe('one today (2026-09-23 spec §K1)', () => {
  afterEach(() => {
    resetServerTodayForTests()
    vi.useRealTimers()
  })

  it('answers the SERVER day once known: 23:30 on Sep 30 local, Oct 1 on the server', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 30, 23, 30))
    setServerToday('2026-10-01')
    expect(todayIso()).toBe('2026-10-01')
    expect(currentMonthIso()).toBe('2026-10-01')
    expect(isPartialMonth('2026-09-01', todayIso())).toBe(false)
    expect(currentYear()).toBe(2026)
  })

  it('falls back to the local day before any response has named one (the login page)', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 30, 23, 30))
    expect(todayIso()).toBe('2026-09-30')
    expect(currentMonthIso()).toBe('2026-09-01')
    expect(currentYear()).toBe(2026)
  })

  it("reads the new year from the server on New Year's Eve", () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 11, 31, 23, 30))
    expect(currentYear()).toBe(2026)
    setServerToday('2027-01-01')
    expect(currentYear()).toBe(2027)
    expect(currentMonthIso()).toBe('2027-01-01')
  })
})

describe('daysBetween', () => {
  it('counts whole days on UTC day numbers — DST and year ends included', () => {
    expect(daysBetween('2026-09-01', '2026-09-22')).toBe(21)
    expect(daysBetween('2026-09-22', '2026-11-01')).toBe(40)
    expect(daysBetween('2026-03-01', '2026-04-01')).toBe(31) // spring forward inside
    expect(daysBetween('2026-11-01', '2026-11-02')).toBe(1) // the day DST ends
    expect(daysBetween('2025-12-31', '2026-01-01')).toBe(1)
    expect(daysBetween('2026-10-01', '2026-09-22')).toBe(-9)
  })
})
