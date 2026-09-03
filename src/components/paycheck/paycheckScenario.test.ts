import { describe, expect, it, vi } from 'vitest'
import type { PaycheckProfileOut } from '../../types/api'
import type { PaycheckScenario } from './paycheckScenario'
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

  // One entry per case, on a DISTINCT key each time: a matrix that reused one key would let
  // a fence regression through, because last-wins means the accepted duplicate beside the
  // refused value produces the same object either way.
  it('fences every knob at its own bound — just inside is kept, just outside is dropped', () => {
    const inside: [string, PaycheckScenario][] = [
      ['trad_401k_pct:1', { trad_401k_pct: '1' }], // the server's [0, 1]; the track clamps the chips
      ['withholding_pct:0', { withholding_pct: '0' }],
      ['espp_pct:0.000000001', { espp_pct: '0.000000001' }],
      ['pay_periods_per_year:1', { pay_periods_per_year: '1' }],
      ['pay_periods_per_year:366', { pay_periods_per_year: '366' }],
      ['hsa_per_check:0', { hsa_per_check: '0' }],
      ['annual_salary:0.01', { annual_salary: '0.01' }],
      ['hsa_coverage:none', { hsa_coverage: 'none' }],
    ]
    for (const [entry, expected] of inside) {
      expect(decodePaycheck([entry])).toEqual(expected)
    }
    const outside = [
      'withholding_pct:1.5', // above the server's 1
      'roth_401k_pct:-0.000000001', // below zero
      'after_tax_401k_pct:1e-3', // exponent notation: Python's Decimal would take it as 0.001
      'trad_401k_pct:0.15.1', // two points
      'espp_pct:+0.15', // a leading plus is not a canonical wire decimal
      'annual_salary:200000.', // a trailing point is not either
      'hsa_per_check:-5', // an amount below zero
      'annual_salary:0', // the divide-by-zero the server refuses
      'pay_periods_per_year:0',
      'pay_periods_per_year:367',
      'pay_periods_per_year:1000', // four digits
      'pay_periods_per_year:26.5', // a count is a whole number
      'hsa_coverage:spouse', // not a stored tier
      'trad_401k_pct:', // an empty field
    ]
    for (const entry of outside) {
      expect(decodePaycheck([entry])).toEqual({})
    }
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

  it('caps a preset at the knob’s own track, not just at the server bound', () => {
    const apply = vi.fn()
    // 24500 / 20000 = 1.225: past the server's 1 AND past the slider's 50 %. The chip has
    // to land on the track it moves, or the thumb sits off the end and the box refuses it.
    const presets = paycheckPresets(
      { salary: '20000', periods: 1, coverage: 'self', esppPct: '0.2', limitFor: () => '24500' },
      apply,
    )
    presets[0].apply()
    expect(apply).toHaveBeenLastCalledWith({ trad_401k_pct: '0.5' })
    // 24500 for a single yearly check is far past the $500 HSA track.
    presets[1].apply()
    expect(apply).toHaveBeenLastCalledWith({ hsa_per_check: '500' })
    // And the ESPP chip keeps landing on the §423 ceiling.
    presets[2].apply()
    expect(apply).toHaveBeenLastCalledWith({ espp_pct: '0.15' })
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
