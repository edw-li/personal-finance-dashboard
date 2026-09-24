import { describe, expect, it } from 'vitest'
import type { MoneyLastsOut, ProjectionOut } from '../../types/api'
import { addMonths } from '../../utils/months'
import {
  displayProjection,
  fiDateTile,
  milestoneWindow,
  moneyLastsTile,
  projectionReceipts,
  projectionSelection,
  projectionSourceLink,
} from './projectionDisplay'
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

const LASTS: MoneyLastsOut = {
  plan_until: 2075, probability: '0.924000', verdict: 'on_track', lasts_until_p10: '2079-03-01',
  horizon_end: '2076-09-01', deterministic_depleted_month: null, reason: null,
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
    expect(csv.headers.filter((header) => /percentile balance|^Median balance/.test(header))).toHaveLength(5)
    expect(csv.rows[12].slice(0, 4)).toEqual(['2027-09-01', '1100.00', '880.00', '1100.00'])
    const selected = projectionSelection(future, 12)!
    expect(selected.values.find((value) => value.label === 'FI target')?.value).toBe('1100.00')
    expect(selected.values.map((value) => value.label)).toContain('Median balance')
    expect(selected.values.map((value) => value.label)).toContain('10th percentile balance')
    expect(selected.context?.displayDollars).toBe('future')
    const comparison = projectionCsv(future, [{ name: 'Earlier retirement', data: ['900.00', 'NaN'] }])
    expect(comparison.headers.at(-1)).toBe('Earlier retirement (USD · future dollars)')
    expect(comparison.rows[0].at(-1)).toBe('900.00')
    expect(comparison.rows[1].at(-1)).toBe('')
  })

  it('links back to the assumptions that ran — the plan-until year and vests off included', () => {
    const source = fixture()
    const url = new URL(projectionSourceLink(source), 'http://local')
    expect(url.searchParams.getAll('whatif')).toContain('inflation:0.10')
    expect(url.searchParams.get('section')).toBe('planning')
    const vests = { included: false, price: '228.8700', price_as_of: '2026-09-22', withholding_rate: '0.3223', next_12_months: '1.00', by_year: [], stops: null, excluded_reason: null }
    const knobs = new URL(projectionSourceLink(fixture({ plan_until: 2075, vests })), 'http://local').searchParams.getAll('whatif')
    expect(knobs).toContain('plan_until:2075')
    expect(knobs).toContain('vests:0')
    // Vests left out because nothing could be priced were never switched off: no vests:0.
    const unpriced = new URL(projectionSourceLink(fixture({ vests: { ...vests, excluded_reason: 'No NVDA quote yet — scheduled vests are left out' } })), 'http://local')
    expect(unpriced.searchParams.getAll('whatif')).not.toContain('vests:0')
  })
})

describe('the FI date tile (2026-09-23 spec §R6)', () => {
  it('heads with the median reach and words the range in paths', () => {
    expect(fiDateTile(fixture())).toEqual({ value: 'Jan 2028', delta: '1 in 10 paths by Sep 2027 · 9 in 10 beyond Sep 2028', tone: 'neutral' })
    expect(fiDateTile(fixture({ fi_month_p90: '2028-06-01' })).delta).toBe('1 in 10 paths by Sep 2027 · 9 in 10 by Jun 2028')
  })

  it('says "Beyond" the horizon when the median never gets there', () => {
    expect(fiDateTile(fixture({ fi_month_p50: null })).value).toBe('Beyond Sep 2028')
    expect(fiDateTile(fixture({ fi_month_p10: null, fi_month_p50: null }))).toEqual({
      value: 'Beyond Sep 2028', delta: 'Fewer than 1 in 10 paths reach it by Sep 2028', tone: 'neutral',
    })
  })

  it('falls back to the constant-return crossing, labelled so, when nothing was simulated', () => {
    const constant = fixture({ fi_probability: null, bands: null, fi_month_p10: null, fi_month_p50: null })
    expect(fiDateTile(constant)).toEqual({ value: 'Sep 2027', delta: 'at a constant return', tone: 'neutral' })
    expect(fiDateTile({ ...constant, fi_month: null }).value).toBe('Beyond Sep 2028')
  })

  it('dashes without a target', () => {
    expect(fiDateTile(fixture({ fi_target: null }))).toEqual({ value: '—', tone: 'neutral' })
  })
})

describe('the money-lasts tile (2026-09-23 spec §R3, §R7)', () => {
  it('reads the probability through the plan-until year, with the verdict as tone and badge', () => {
    expect(moneyLastsTile(fixture({ money_lasts: LASTS }))).toEqual({
      value: '92.4% of paths through 2075', delta: 'In 9 of 10 paths the money lasts until at least 2079',
      tone: 'positive', badge: 'On track',
    })
    expect(moneyLastsTile(fixture({ money_lasts: { ...LASTS, probability: '0.800000', verdict: 'borderline' } }))).toMatchObject({ tone: 'warn', badge: 'Borderline' })
    expect(moneyLastsTile(fixture({ money_lasts: { ...LASTS, probability: '0.400000', verdict: 'at_risk' } }))).toMatchObject({ tone: 'negative', badge: 'At risk' })
  })

  it('says the money lasts past the end of the projection when fewer than 1 in 10 paths run out', () => {
    expect(moneyLastsTile(fixture({ money_lasts: { ...LASTS, lasts_until_p10: null } })).delta).toBe(
      'In 9 of 10 paths the money lasts beyond Sep 2076, the end of the projection',
    )
  })

  it('speaks the constant-return line alone with volatility 0 — neutral, no percentage', () => {
    const constant = { ...LASTS, probability: null, verdict: null, lasts_until_p10: null }
    expect(moneyLastsTile(fixture({ money_lasts: { ...constant, deterministic_depleted_month: '2061-03-01' } }))).toEqual({ value: 'Runs out Mar 2061 at a constant return', tone: 'neutral' })
    // Running out AFTER the plan-until year still lasts through it.
    expect(moneyLastsTile(fixture({ money_lasts: { ...constant, deterministic_depleted_month: '2076-02-01' } })).value).toBe('Lasts through 2075 at a constant return')
    expect(moneyLastsTile(fixture({ money_lasts: constant })).value).toBe('Lasts through 2075 at a constant return')
  })

  it('dashes with the reason when no withdrawal is modelled, and for an older payload', () => {
    const reason = 'Set retirement months to see whether the money lasts.'
    expect(moneyLastsTile(fixture({ money_lasts: { ...LASTS, probability: null, verdict: null, lasts_until_p10: null, reason } }))).toEqual({ value: '—', delta: reason, tone: 'neutral' })
    expect(moneyLastsTile(fixture())).toEqual({ value: '—', tone: 'neutral' })
  })
})

describe('receipts', () => {
  it('the FI date receipt names the median, the range, the odds within the horizon and the constant-return date', () => {
    const receipt = projectionReceipts(fixture()).fiDate
    expect(receipt.label).toBe('FI date')
    expect(receipt.value).toBe('2028-01-01')
    expect(receipt.definition).toContain('half of the 500 simulated paths')
    expect(receipt.components.map((c) => [c.label, c.value])).toEqual([
      ['1 in 10 paths by', '2027-09-01'],
      ['Half of paths by', '2028-01-01'],
      ['9 in 10 paths by', null],
      ['Reach FI within 2 years', '0.6'],
      ['At a constant return', '2027-09-01'],
    ])
    expect(projectionReceipts(fixture({ fi_probability: null, bands: null, fi_month_p50: null })).fiDate.value).toBe('2027-09-01')
  })

  it('the money-lasts receipt lists the plan-until year, the withdrawal, the phases and the caveats', () => {
    const receipt = projectionReceipts(fixture({
      money_lasts: LASTS,
      drawdown: { start_month: '2035-07-01', annual_withdrawal: '65709.77' },
      phases: [
        { from_month: '2026-09-01', kind: 'working', working_person_ids: [1, 2], monthly_contribution: '6711.63', monthly_withdrawal: null, take_home_monthly: null },
        { from_month: '2035-07-01', kind: 'retired', working_person_ids: [], monthly_contribution: '0.00', monthly_withdrawal: '5475.81', take_home_monthly: null },
      ],
    })).moneyLasts
    expect(receipt.label).toBe('Money lasts through 2075')
    expect(receipt.value).toBe('0.924000')
    expect(receipt.unit).toBe('ratio')
    expect(receipt.definition).toContain('never runs out through December 2075')
    expect(receipt.definition).toContain('independent lognormal')
    expect(receipt.definition).toContain('untaxed')
    expect(receipt.definition).toContain('Social Security')
    expect(receipt.components.map((c) => c.label)).toEqual([
      'Plan until',
      'Annual withdrawal from Jul 2035',
      'Working from Sep 2026 — saving per month',
      'Retired from Jul 2035 — withdrawing per month',
      'In 9 of 10 paths lasts until at least',
      'At a constant return, runs out',
    ])
  })

  it('the balance receipt dates itself by the base snapshot', () => {
    expect(projectionReceipts(fixture()).balance.as_of).toBe('2026-08-01')
    expect(projectionReceipts(fixture({ base_as_of: '2026-09-22' })).balance.as_of).toBe('2026-09-22')
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
  it('reaches through the plan-until year when withdrawals are modelled — the question on the chart', () => {
    const drawn = { ...long, fi_month: '2035-09-01', plan_until: 2050, drawdown: { start_month: '2045-07-01', annual_withdrawal: '1.00' } }
    expect(milestoneWindow(drawn).endValue).toBe(291) // December 2050
    expect(milestoneWindow({ ...drawn, plan_until: 2080 }).endValue).toBe(360) // bounded by the axis
  })
})
