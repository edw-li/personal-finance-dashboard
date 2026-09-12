import { describe, expect, it } from 'vitest'
import type { ProjectionOut } from '../../types/api'
import { addMonths } from '../../utils/months'
import { displayProjection, milestoneWindow, projectionReceipts, projectionSelection, projectionSourceLink } from './projectionDisplay'
import { projectionCsv, projectionOption } from './projectionChartOptions'

function fixture(overrides: Partial<ProjectionOut> = {}): ProjectionOut {
  const months = Array.from({ length: 25 }, (_, index) => addMonths('2026-09-01', index))
  return {
    starting_balance: '800.00', base_month: '2026-08-01', start_month: '2026-09-01',
    annual_return: '0.05', monthly_contribution: '20.00', annual_spend: '40.00', swr_pct: '0.04',
    years: 2, fi_target: '1000.00', fi_ratio: '0.8', fi_month: '2027-09-01', coast_fi_month: null,
    months, projected: months.map(() => '1000.00'), coast: months.map(() => '800.00'), warnings: [],
    volatility: '0.15', inflation: '0.10', contribution_growth: '0.03',
    bands: Object.fromEntries(['p10', 'p25', 'p50', 'p75', 'p90'].map((p, i) => [p, months.map(() => `${800 + 100 * i}.00`)])),
    fi_probability: '0.6', fi_month_p10: '2027-09-01', fi_month_p50: '2028-01-01', fi_month_p90: null,
    retirements: [], ...overrides,
  }
}

describe('projection display dollars', () => {
  it('converts each monetary series, band and target with one dated factor, preserving the model', () => {
    const source = fixture()
    const before = JSON.stringify(source)
    const future = displayProjection(source, 'future')
    expect(future.projected[0]).toBe('1000.00')
    expect(future.projected[12]).toBe('1100.00')
    expect(future.coast[12]).toBe('880.00')
    expect(future.target_values?.[12]).toBe('1100.00')
    expect(future.bands?.p10[12]).toBe('880.00')
    expect(future.bands?.p90[12]).toBe('1320.00')
    expect(future.fi_month).toBe(source.fi_month)
    expect(future.fi_probability).toBe(source.fi_probability)
    expect(future.fi_target).toBe(source.fi_target) // headline target keeps its base-date unit
    expect(future.inflation).toBe('0.10')
    expect(JSON.stringify(source)).toBe(before)
  })

  it('keeps zero-inflation paths identical and declines a future-dollar label without an inflation assumption', () => {
    const zero = fixture({ inflation: '0' })
    expect(displayProjection(zero, 'future').projected).toEqual(displayProjection(zero, 'today').projected)
    expect(displayProjection(fixture({ inflation: null }), 'future').display_dollars).toBe('today')
  })

  it('uses the converted target for chart markers, exports, and selected-date receipts', () => {
    const future = displayProjection(fixture(), 'future')
    const chart = projectionOption(future) as unknown as { series: { name: string; data: number[]; markPoint?: { data: { coord: [string, number] }[] } }[] }
    const target = chart.series.find((row) => row.name === 'FI target')!
    expect(target.data[12]).toBe(1100)
    expect(target.markPoint?.data[0].coord).toEqual(['Sep 2027', 1100])
    const csv = projectionCsv(future)
    expect(csv.headers).toContain('FI target (USD · future dollars)')
    expect(csv.headers.filter((header) => header.startsWith('p'))).toHaveLength(5)
    expect(csv.rows[12].slice(0, 4)).toEqual(['2027-09-01', '1100.00', '880.00', '1100.00'])
    const selected = projectionSelection(future, 12)!
    expect(selected.values.find((value) => value.label === 'FI target')?.value).toBe('1100.00')
    expect(selected.context?.displayDollars).toBe('future')
    const comparison = projectionCsv(future, [{ name: 'Earlier retirement', data: ['900.00', 'NaN'] }])
    expect(comparison.headers.at(-1)).toBe('Earlier retirement (USD · future dollars)')
    expect(comparison.rows[0].at(-1)).toBe('900.00')
    expect(comparison.rows[1].at(-1)).toBe('')
  })

  it('captures source assumptions and gives the reach probability its actual interpretation', () => {
    const source = fixture()
    const url = new URL(projectionSourceLink(source), 'http://local')
    expect(url.searchParams.getAll('whatif')).toContain('inflation:0.10')
    expect(url.searchParams.get('section')).toBe('planning')
    expect(projectionReceipts(source).probability.label).toBe('Reach FI target within 2 years')
    expect(projectionReceipts(source).probability.definition).toContain('include all paths')
  })
})

describe('milestone viewport', () => {
  const long = fixture({ years: 30, months: Array.from({ length: 361 }, (_, i) => addMonths('2026-09-01', i)) })
  it('frames the first milestone with context without showing decades beyond it', () => {
    expect(milestoneWindow({ ...long, fi_month: '2035-09-01' })).toEqual({ startValue: 0, endValue: 132 })
  })
  it('bounds already-reached, never-reached, short, and unavailable cases', () => {
    expect(milestoneWindow({ ...long, fi_month: long.start_month }).endValue).toBe(60)
    expect(milestoneWindow({ ...long, fi_month: null }).endValue).toBe(360)
    expect(milestoneWindow({ ...long, fi_target: null }).endValue).toBe(360)
    expect(milestoneWindow(fixture()).endValue).toBe(24)
    expect(milestoneWindow({ ...long, months: [] })).toEqual({ startValue: 0, endValue: 0 })
  })
})
