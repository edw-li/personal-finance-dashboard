import { describe, expect, it } from 'vitest'
import {
  creditLineChartOption,
  limitMonths,
  monthOf,
  resolvedLimits,
} from './creditLineChartOptions'

const VX = {
  name: 'Venture X',
  events: [
    { effective_date: '2023-05-12', limit_amount: '20000.00' },
    { effective_date: '2024-08-01', limit_amount: '25000.00' },
  ],
}
const BILT = { name: 'BILT', events: [{ effective_date: '2024-02-20', limit_amount: '12500.00' }] }

describe('limitMonths', () => {
  it('spans earliest event month through the end month', () => {
    const months = limitMonths([VX, BILT], '2023-08-01')
    expect(months[0]).toBe('2023-05-01')
    expect(months[months.length - 1]).toBe('2023-08-01')
    expect(months).toHaveLength(4)
  })
  it('is empty with no events', () => {
    expect(limitMonths([{ name: 'X', events: [] }], '2026-08-01')).toEqual([])
  })
})

describe('resolvedLimits', () => {
  it('nulls before the first event, mid-month events land in their month, then carries', () => {
    const months = ['2023-04-01', '2023-05-01', '2024-07-01', '2024-08-01', '2024-09-01']
    expect(monthOf('2023-05-12')).toBe('2023-05-01')
    expect(resolvedLimits(VX, months)).toEqual([null, 20000, 20000, 25000, 25000])
  })
  it('sorts unordered events before resolving', () => {
    const reversed = { name: 'R', events: [...VX.events].reverse() }
    expect(resolvedLimits(reversed, ['2024-09-01'])).toEqual([25000])
  })
})

describe('creditLineChartOption', () => {
  const months = ['2024-01-01', '2024-02-01', '2024-09-01']
  it('draws one step series per card, total sums only existing cards', () => {
    const option = creditLineChartOption([VX, BILT], months, { includeTotal: true })
    const series = option.series as { name: string; step?: string; data: (number | null)[] }[]
    expect(series.map((s) => s.name)).toEqual(['Venture X', 'BILT', 'Total line'])
    expect(series.every((s) => s.step === 'end')).toBe(true)
    // Jan: VX only (20000); Feb: 20000+12500; Sep: 25000+12500.
    expect(series[2].data).toEqual([20000, 32500, 37500])
  })
  it('omits the total when not asked', () => {
    const option = creditLineChartOption([VX], months, { includeTotal: false })
    expect((option.series as unknown[]).length).toBe(1)
  })
})
