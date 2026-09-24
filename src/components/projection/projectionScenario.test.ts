import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ProjectionOut } from '../../types/api'
import {
  COMPARE_ROWS,
  KNOBS,
  SLIDER,
  SLIDER_KNOBS,
  decodeProjection,
  derivedOf,
  encodeProjection,
  headlineFiMonth,
  isEmptyProjection,
  labelForProjection,
  projectionValue,
  toParams,
} from './projectionScenario'

const fixture = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../../backend/tests/fixtures/sandbox_entries.json'), 'utf8'),
) as { cases: { page: string; entries: string[] }[] }

const echo: ProjectionOut = {
  starting_balance: '100000.00', base_month: '2026-09-01', start_month: '2026-09-01', annual_return: '0.05',
  monthly_contribution: '4000.00', annual_spend: '60000.00', swr_pct: '0.04', years: 30, fi_target: '1500000.00',
  fi_ratio: '0.066667', fi_month: '2041-03-01', coast_fi_month: null, months: ['2026-09-01', '2026-10-01'],
  projected: ['100000.00', '104400.00'], coast: ['100000.00', '100400.00'], warnings: [], volatility: '0.15',
  inflation: '0.03', contribution_growth: '0.03', bands: null, fi_probability: '0.62', fi_month_p10: '2038-01-01',
  fi_month_p50: '2041-06-01', fi_month_p90: null, retirements: [],
}

describe('projection scenario codec', () => {
  it('round-trips knobs (alphabetical) then retirements (by person) and accepts every parity case unchanged', () => {
    const cases = fixture.cases.filter((c) => c.page === 'projection')
    expect(cases.length).toBeGreaterThanOrEqual(2)
    expect(decodeProjection(cases[0].entries)).toEqual({ knobs: { annual_return: '0.06', monthly_contribution: '5400' }, retirements: { 2: '2035-06' } })
    // 2026-09-23 spec §R10: the plan-until year and the vests flag ride the same grammar.
    expect(decodeProjection(cases[1].entries)).toEqual({
      knobs: { annual_spend: '72000', plan_until: '2075', vests: '0' },
      retirements: { 1: '2035-07', 2: '2037-01' },
    })
    for (const c of cases) expect(encodeProjection(decodeProjection(c.entries))).toEqual(c.entries)
    expect(encodeProjection(decodeProjection(['retire:3:2040-01', 'vests:0', 'years:40', 'retire:1:2035-06', 'plan_until:2070', 'swr:0.035']))).toEqual([
      'plan_until:2070',
      'swr:0.035',
      'vests:0',
      'years:40',
      'retire:1:2035-06',
      'retire:3:2040-01',
    ])
  })

  it('lists the knobs in the canonical (alphabetical) URL order', () => {
    expect([...KNOBS]).toEqual([...KNOBS].sort())
    expect(KNOBS).toContain('plan_until')
    expect(KNOBS).toContain('vests')
  })

  it('applies the router’s fences, drops garbage, keeps the last of a duplicate', () => {
    expect(
      decodeProjection([
        'annual_return:0.6', 'annual_return:0.06', 'swr:0', 'swr:2', 'volatility:1.5', 'inflation:0.3', 'contribution_growth:-0.1',
        'years:0', 'years:61', 'years:7.5', 'annual_spend:0', 'monthly_contribution:20000000', 'monthly_contribution:-100', 'retire:x:2035-06', 'retire:2:2035-13', 'bonus:1', 'NVDA',
      ]),
    ).toEqual({ knobs: { annual_return: '0.06', monthly_contribution: '-100' }, retirements: {} })
    expect(isEmptyProjection({ knobs: {}, retirements: {} })).toBe(true)
    expect(isEmptyProjection({ knobs: {}, retirements: { 2: '2035-06' } })).toBe(false)
    expect(isEmptyProjection({ knobs: { vests: '0' }, retirements: {} })).toBe(false)
  })

  it('fences plan_until to a four-digit year inside 2000–2199 and vests to 0/1', () => {
    for (const bad of ['plan_until:1999', 'plan_until:2200', 'plan_until:20x5', 'plan_until:207', 'plan_until:02075', 'plan_until:2075.0', 'vests:2', 'vests:yes', 'vests:', 'vests:true']) {
      expect(decodeProjection([bad]).knobs, bad).toEqual({})
    }
    expect(decodeProjection(['plan_until:2000', 'vests:1']).knobs).toEqual({ plan_until: '2000', vests: '1' })
    expect(decodeProjection(['plan_until:2199']).knobs.plan_until).toBe('2199')
  })

  // services/money.py's _quantize_bounded refuses |value| >= max_abs, so the endpoint's
  // CONTRIBUTION_MAX_ABS (1e7) is an EXCLUSIVE fence at both ends. A codec that kept the
  // bound itself would hand the server a value it 422s and call it a link.
  it('keeps the contribution fence exclusive at both ends, the way the server has it', () => {
    expect(decodeProjection(['monthly_contribution:10000000']).knobs.monthly_contribution).toBeUndefined()
    expect(decodeProjection(['monthly_contribution:-10000000']).knobs.monthly_contribution).toBeUndefined()
    expect(decodeProjection(['monthly_contribution:9999999.99']).knobs.monthly_contribution).toBe('9999999.99')
    expect(decodeProjection(['monthly_contribution:-9999999.99']).knobs.monthly_contribution).toBe('-9999999.99')
    // The spend knob's own SPEND_MAX_ABS (1e9), which the codec had no upper fence for at all.
    expect(decodeProjection(['annual_spend:1000000000']).knobs.annual_spend).toBeUndefined()
    expect(decodeProjection(['annual_spend:999999999']).knobs.annual_spend).toBe('999999999')
  })

  it('copies the scenario into fetchProjection’s params, omitting unset knobs', () => {
    expect(toParams(decodeProjection(['annual_return:0.06', 'years:40', 'volatility:0', 'plan_until:2075', 'vests:0', 'retire:2:2035-06']))).toEqual({
      annualReturn: '0.06',
      years: '40',
      volatility: '0',
      planUntil: '2075',
      vests: '0',
      retirements: [{ personId: 2, month: '2035-06' }],
    })
    expect(toParams({ knobs: {}, retirements: {} })).toEqual({ retirements: [] })
  })

  it('reads the echo as each knob’s derived value', () => {
    expect(derivedOf(echo)).toEqual({
      annual_return: '0.05', annual_spend: '60000.00', contribution_growth: '0.03', inflation: '0.03',
      monthly_contribution: '4000.00', plan_until: null, swr: '0.04', vests: null, volatility: '0.15', years: '30',
    })
    const vests = { included: true, price: '228.8700', price_as_of: '2026-09-22', withholding_rate: '0.3223', next_12_months: '116000.00', by_year: [], stops: null, excluded_reason: null }
    expect(derivedOf({ ...echo, plan_until: 2055, vests })).toMatchObject({ plan_until: '2055', vests: '1' })
    expect(derivedOf({ ...echo, vests: { ...vests, included: false } }).vests).toBe('0')
    expect(derivedOf({ ...echo, volatility: null, annual_spend: null }).volatility).toBeNull()
    expect(derivedOf(null).years).toBeNull()
    // The Horizon box's value is the KNOB (2026-09-24 re-review): a Settings plan-until year that
    // lengthened the baseline to 50 years must not become a years:50 that re-deals every path.
    expect(derivedOf({ ...echo, years: 50, base_years: 30 }).years).toBe('30')
  })

  it('labels a pin by its first two knobs, naming a retiring person when the roster is known', () => {
    expect(labelForProjection(decodeProjection(['annual_return:0.06', 'monthly_contribution:5400', 'years:40']))).toBe('Return 6% · Contribution $5,400.00')
    expect(labelForProjection(decodeProjection(['plan_until:2075', 'vests:0']))).toBe('Plan until 2075 · Vests off')
    expect(labelForProjection(decodeProjection(['retire:2:2035-06']), [{ id: 2, name: 'Grace' }])).toBe('Retire Grace 2035-06')
    // No roster (it failed, or has not arrived): the id is all there is to say.
    expect(labelForProjection(decodeProjection(['retire:2:2035-06']))).toBe('Retire #2 2035-06')
  })

  it('keeps every slider track inside the fence its own knob accepts', () => {
    expect([...SLIDER_KNOBS].sort()).toEqual(KNOBS.filter((key) => key !== 'plan_until' && key !== 'vests'))
    for (const key of SLIDER_KNOBS) {
      const { min, max } = SLIDER[key]
      for (const edge of [min, max]) {
        expect(decodeProjection([`${key}:${edge}`]).knobs[key], `${key} ${edge}`).toBe(edge)
      }
    }
  })

  it('heads with the median reach, or the constant-return crossing when nothing was simulated', () => {
    expect(headlineFiMonth(echo)).toBe('2041-06-01')
    expect(headlineFiMonth({ ...echo, fi_probability: null, fi_month_p50: null })).toBe('2041-03-01')
    expect(headlineFiMonth({ ...echo, fi_month_p50: null })).toBeNull() // the median never gets there
  })

  it('maps the compare rows onto the payload in the reader’s words', () => {
    expect(COMPARE_ROWS.map((r) => [r.key, r.label])).toEqual([
      ['years', 'Horizon (years)'],
      ['fi_target', 'FI target'],
      ['fi_ratio', 'FI ratio'],
      ['fi_date', 'FI date (most likely)'],
      ['fi_month_p10', 'FI · 1 in 10 paths by'],
      ['fi_month_p90', 'FI · 9 in 10 paths by'],
      ['fi_probability', 'Reach FI within horizon'],
      ['money_lasts', 'Money lasts through plan-until year'],
      ['lasts_until', 'Lasts at least until (9 in 10 paths)'],
      ['coast_fi_month', 'Coast FI date'],
      ['vests', 'Scheduled vests'],
      ['monthly_contribution', 'Monthly contribution'],
    ])
    expect(projectionValue(echo, 'fi_target')).toBe('1500000.00')
    expect(projectionValue(echo, 'coast_fi_month')).toBeNull()
    expect(projectionValue(echo, 'years')).toBe('30')
    expect(projectionValue(echo, 'fi_date')).toBe('2041-06-01')
    // Absent from an older payload: an em dash, never a crash.
    expect(projectionValue(echo, 'money_lasts')).toBeNull()
    expect(projectionValue(echo, 'lasts_until')).toBeNull()
    expect(projectionValue(echo, 'vests')).toBeNull()
    const lasts = { plan_until: 2075, probability: '0.924000', verdict: 'on_track' as const, lasts_until_p10: '2079-03-01', horizon_end: '2076-09-01', deterministic_depleted_month: null, reason: null }
    const vests = { included: false, price: '228.8700', price_as_of: '2026-09-22', withholding_rate: '0.3223', next_12_months: '116000.00', by_year: [], stops: null, excluded_reason: null }
    const full = { ...echo, money_lasts: lasts, vests }
    expect(projectionValue(full, 'money_lasts')).toBe('0.924000')
    expect(projectionValue(full, 'lasts_until')).toBe('2079-03-01')
    expect(projectionValue(full, 'vests')).toBe('Off')
    expect(projectionValue({ ...full, vests: { ...vests, included: true } }, 'vests')).toBe('Included')
    expect(projectionValue(full, 'no_such_row')).toBeNull()
  })

  // The footer's rule is that scenarios with the same Horizon (years) setting share their simulated
  // paths, so the row must show that setting (batch 2 integration, 2026-09-24). years:50, and
  // years:30 lengthened by a plan-until year of 2075, both RAN 50 years but on different paths.
  it('shows the Horizon knob in its row, and says how far a lengthened run went', () => {
    expect(projectionValue({ ...echo, years: 50, base_years: 50, plan_until: 2075 }, 'years')).toBe('50')
    expect(projectionValue({ ...echo, years: 50, base_years: 30, plan_until: 2075 }, 'years')).toBe('30 (runs through 2075)')
    // A plan-until year inside the knob's own axis lengthens nothing.
    expect(projectionValue({ ...echo, years: 30, base_years: 30, plan_until: 2055 }, 'years')).toBe('30')
    // An older payload has no knob echo, so the horizon it ran is all there is.
    expect(projectionValue(echo, 'years')).toBe('30')
    // Lengthened with no plan-until year to name (no server sends that): the years it ran.
    expect(projectionValue({ ...echo, years: 50, base_years: 30 }, 'years')).toBe('30 (runs 50)')
  })
})
