import { describe, expect, it } from 'vitest'
import { addDays, addMonths, currentMonthIso, lastNMonths, monthGrid } from './months'

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
