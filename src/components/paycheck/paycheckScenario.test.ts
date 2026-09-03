import { describe, expect, it, vi } from 'vitest'
import type { PaycheckProfileOut } from '../../types/api'
import {
  applySeedFor,
  decodePaycheck,
  encodePaycheck,
  isEmptyPaycheck,
  labelForPaycheck,
  paycheckPresets,
  toOverrides,
} from './paycheckScenario'

const profile: PaycheckProfileOut = {
  id: 7,
  person_id: 1,
  effective_date: '2026-01-01',
  annual_salary: '100000.00',
  pay_periods_per_year: 24,
  trad_401k_pct: '0.130000000',
  roth_401k_pct: '0.000000000',
  after_tax_401k_pct: '0.030000000',
  espp_pct: '0.110000000',
  withholding_pct: '0.334009167',
  dental_vision_per_check: '12.50',
  hsa_per_check: '100.00',
  hsa_coverage: 'self',
  notes: null,
}

describe('paycheck scenario codec', () => {
  it('round-trips every knob in alphabetical (canonical) order', () => {
    const entries = ['trad_401k_pct:0.15', 'hsa_coverage:family', 'hsa_per_check:250', 'pay_periods_per_year:26', 'annual_salary:200000']
    const scenario = decodePaycheck(entries)
    expect(scenario).toEqual({
      trad_401k_pct: '0.15',
      hsa_coverage: 'family',
      hsa_per_check: '250',
      pay_periods_per_year: '26',
      annual_salary: '200000',
    })
    expect(encodePaycheck(scenario)).toEqual([
      'annual_salary:200000',
      'hsa_coverage:family',
      'hsa_per_check:250',
      'pay_periods_per_year:26',
      'trad_401k_pct:0.15',
    ])
    expect(decodePaycheck(encodePaycheck(scenario))).toEqual(scenario)
  })

  it('drops garbage and out-of-range values, keeps the last of a duplicate key', () => {
    expect(
      decodePaycheck(['NVDA', 'bonus_pct:0.1', 'trad_401k_pct:13', 'espp_pct:-0.1', 'hsa_coverage:spouse', 'pay_periods_per_year:0', 'annual_salary:0', 'trad_401k_pct:0.1', 'trad_401k_pct:0.2']),
    ).toEqual({ trad_401k_pct: '0.2' })
    expect(isEmptyPaycheck({})).toBe(true)
    expect(isEmptyPaycheck({ espp_pct: '0' })).toBe(false)
  })

  it('copies knobs straight into the preview body, periods as a number', () => {
    expect(toOverrides({ trad_401k_pct: '0.15', pay_periods_per_year: '26', hsa_coverage: 'family' })).toEqual({
      trad_401k_pct: '0.15',
      pay_periods_per_year: 26,
      hsa_coverage: 'family',
    })
    expect(toOverrides({})).toEqual({})
  })

  it('labels a pin by its first two changed knobs', () => {
    expect(labelForPaycheck({ trad_401k_pct: '0.15', hsa_per_check: '250', espp_pct: '0' })).toBe('ESPP 0% · HSA $250.00')
    expect(labelForPaycheck({ annual_salary: '200000' })).toBe('Salary $200,000.00')
    expect(labelForPaycheck({ hsa_coverage: 'family', pay_periods_per_year: '26' })).toBe('HSA family · 26 periods')
  })

  it('sizes presets from the limits by exact division, and disables the ones without a datum', () => {
    const apply = vi.fn()
    const limits: Record<string, string | null> = {
      limit_401k_elective: '24500.00',
      limit_hsa_self: '4300.00',
      limit_hsa_family: null,
      limit_espp_423: '25000.00',
    }
    const presets = paycheckPresets(
      { salary: '100000.00', periods: 24, coverage: 'self', esppPct: '0.110000000', limitFor: (key) => limits[key] ?? null },
      apply,
    )
    expect(presets.map((p) => [p.id, p.disabled ?? false])).toEqual([
      ['max401k', false],
      ['maxhsa', false],
      ['maxespp', false],
      ['stopespp', false],
    ])
    presets[0].apply()
    expect(apply).toHaveBeenLastCalledWith({ trad_401k_pct: '0.245' })
    presets[1].apply()
    expect(apply).toHaveBeenLastCalledWith({ hsa_per_check: '179.16' }) // 4300 / 24, floored to cents
    presets[2].apply()
    expect(apply).toHaveBeenLastCalledWith({ espp_pct: '0.15' }) // the lesser of 15 % and 25000 / 100000
    presets[3].apply()
    expect(apply).toHaveBeenLastCalledWith({ espp_pct: '0' })

    const family = paycheckPresets(
      { salary: '100000.00', periods: 24, coverage: 'family', esppPct: '0', limitFor: (key) => limits[key] ?? null },
      apply,
    )
    expect(family[1].disabled).toBe(true)
    expect(family[1].title).toBe("Enter this year's HSA limit in Settings › Limits")
    expect(family[3].disabled).toBe(true)
    expect(family[3].title).toBe('ESPP is already 0%')

    const none = paycheckPresets(
      { salary: '100000.00', periods: 24, coverage: 'none', esppPct: '0.1', limitFor: () => null },
      apply,
    )
    expect(none[0].title).toBe("Enter this year's 401(k) limit in Settings › Limits")
    expect(none[1].title).toBe('Choose Self or Family HSA coverage first')
    expect(none[2].title).toBe(
      "Enter this year's ESPP §423 limit in Settings › Limits (the ESPP pace row appears once ESPP is above 0%)",
    )
  })

  it('caps Max 401(k) at the server bound when the limit exceeds the salary', () => {
    const apply = vi.fn()
    paycheckPresets({ salary: '20000', periods: 24, coverage: 'self', esppPct: '0', limitFor: () => '24500' }, apply)[0].apply()
    expect(apply).toHaveBeenLastCalledWith({ trad_401k_pct: '1' })
  })

  it('builds the Apply seed: the profile with the scenario applied, percents shifted, dated next month', () => {
    const seed = applySeedFor(profile, { trad_401k_pct: '0.15', hsa_per_check: '250', hsa_coverage: 'family' }, '2026-09-01')
    expect(seed).toEqual({
      effective_date: '2026-10-01',
      annual_salary: '100000.00',
      pay_periods_per_year: '24',
      trad_401k_pct: '15',
      roth_401k_pct: '0',
      after_tax_401k_pct: '3',
      espp_pct: '11',
      withholding_pct: '33.4009167',
      dental_vision_per_check: '12.50',
      hsa_per_check: '250',
      hsa_coverage: 'family',
      notes: '',
    })
  })
})
