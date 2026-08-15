import { describe, expect, it } from 'vitest'
import { addMonths, currentMonthIso, lastNMonths } from './months'

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
