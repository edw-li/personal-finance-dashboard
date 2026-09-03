import { describe, expect, it } from 'vitest'
import { GRID_VARIANTS } from '../../charts/grammar'
import { INK, PALETTE } from '../../charts/theme'
import { tooltipRows } from '../../testing/tooltipRows'
import {
  creditLineChartOption,
  creditLineCsv,
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

  it('grammar: money grid, LINE posture on every step series, INK total, legend picks fed back', () => {
    const option = creditLineChartOption([VX, BILT], months, {
      includeTotal: true,
      selected: { BILT: false },
    }) as unknown as {
      grid: unknown
      legend: { type: string; selected: unknown }
      series: { color: string; symbol: string; step: string; emphasis: unknown; z?: number }[]
      tooltip: { formatter: (p: unknown) => string }
    }
    expect(option.grid).toEqual(GRID_VARIANTS.default)
    expect(option.legend).toMatchObject({ type: 'plain', selected: { BILT: false } })
    expect(option.series.map((s) => s.color)).toEqual([PALETTE[0], PALETTE[1], INK])
    expect(option.series[0]).toMatchObject({
      symbol: 'none',
      step: 'end',
      emphasis: { focus: 'series' },
    })
    expect(option.series[2].z).toBe(10)
    const rows = tooltipRows(
      option.tooltip.formatter([
        {
          seriesName: 'Venture X',
          seriesType: 'line',
          axisValueLabel: 'Feb 2024',
          value: 20000,
          color: PALETTE[0],
        },
        { seriesName: 'BILT', seriesType: 'line', value: 12500, color: PALETTE[1] },
        { seriesName: 'Total line', seriesType: 'line', value: 32500, color: INK },
      ]),
    )
    expect(rows.rows.map((r) => [r.label, r.value])).toEqual([
      ['Venture X', '$20,000.00'],
      ['BILT', '$12,500.00'],
      ['Total line', '$32,500.00'],
    ])
  })

  it('exports month × card + total, blanks before a card exists', () => {
    expect(creditLineCsv([VX, BILT], months)).toEqual({
      headers: ['Month', 'Venture X', 'BILT', 'Total'],
      rows: [
        ['2024-01-01', '20000.00', '', '20000.00'],
        ['2024-02-01', '20000.00', '12500.00', '32500.00'],
        ['2024-09-01', '25000.00', '12500.00', '37500.00'],
      ],
    })
  })
})
