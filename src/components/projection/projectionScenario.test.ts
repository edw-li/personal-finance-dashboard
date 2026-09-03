import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ProjectionOut } from '../../types/api'
import {
  COMPARE_ROWS,
  KNOBS,
  SLIDER,
  decodeProjection,
  derivedOf,
  encodeProjection,
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
  it('round-trips knobs (alphabetical) then retirements (by person) and accepts the parity fixture unchanged', () => {
    const projection = fixture.cases.find((c) => c.page === 'projection')!
    const scenario = decodeProjection(projection.entries)
    expect(scenario).toEqual({ knobs: { annual_return: '0.06', monthly_contribution: '5400' }, retirements: { 2: '2035-06' } })
    expect(encodeProjection(scenario)).toEqual(projection.entries)
    expect(encodeProjection(decodeProjection(['retire:3:2040-01', 'years:40', 'retire:1:2035-06', 'swr:0.035']))).toEqual([
      'swr:0.035',
      'years:40',
      'retire:1:2035-06',
      'retire:3:2040-01',
    ])
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
  })

  it('copies the scenario into fetchProjection’s params, omitting unset knobs', () => {
    expect(toParams(decodeProjection(['annual_return:0.06', 'years:40', 'volatility:0', 'retire:2:2035-06']))).toEqual({
      annualReturn: '0.06',
      years: '40',
      volatility: '0',
      retirements: [{ personId: 2, month: '2035-06' }],
    })
    expect(toParams({ knobs: {}, retirements: {} })).toEqual({ retirements: [] })
  })

  it('reads the echo as each knob’s derived value', () => {
    expect(derivedOf(echo)).toEqual({
      annual_return: '0.05', annual_spend: '60000.00', contribution_growth: '0.03', inflation: '0.03',
      monthly_contribution: '4000.00', swr: '0.04', volatility: '0.15', years: '30',
    })
    expect(derivedOf({ ...echo, volatility: null, annual_spend: null }).volatility).toBeNull()
    expect(derivedOf(null).years).toBeNull()
  })

  it('labels a pin by its first two knobs, naming a retiring person when the roster is known', () => {
    expect(labelForProjection(decodeProjection(['annual_return:0.06', 'monthly_contribution:5400', 'years:40']))).toBe('Return 6% · Contribution $5,400.00')
    expect(labelForProjection(decodeProjection(['retire:2:2035-06']), [{ id: 2, name: 'Grace' }])).toBe('Retire Grace 2035-06')
    // No roster (it failed, or has not arrived): the id is all there is to say.
    expect(labelForProjection(decodeProjection(['retire:2:2035-06']))).toBe('Retire #2 2035-06')
  })

  it('keeps every slider track inside the fence its own knob accepts', () => {
    for (const key of KNOBS) {
      const { min, max } = SLIDER[key]
      for (const edge of [min, max]) {
        expect(decodeProjection([`${key}:${edge}`]).knobs[key], `${key} ${edge}`).toBe(edge)
      }
    }
  })

  it('maps the compare rows onto the payload', () => {
    expect(COMPARE_ROWS.map((r) => r.key)).toEqual([
      'fi_target', 'fi_ratio', 'fi_month', 'coast_fi_month', 'fi_probability', 'fi_month_p10', 'fi_month_p50', 'fi_month_p90', 'monthly_contribution',
    ])
    expect(projectionValue(echo, 'fi_target')).toBe('1500000.00')
    expect(projectionValue(echo, 'coast_fi_month')).toBeNull()
    expect(projectionValue(echo, 'years')).toBeNull()
  })
})
