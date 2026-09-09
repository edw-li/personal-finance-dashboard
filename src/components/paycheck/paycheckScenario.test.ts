import { describe, expect, it, vi } from 'vitest'
import type { PaycheckProfileOut } from '../../types/api'
import type { PaycheckScenario, PresetContext } from './paycheckScenario'
import {
  applySeedFor,
  decodePaycheck,
  LIMIT_ESPP_423,
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
  match_rate_1: '1.000000000',
  match_band_1: '6000.00',
  match_rate_2: '0.500000000',
  match_band_2: '11000.00',
  hsa_employer_annual: '2000.00',
  hsa_employer_per_dependent: '500.00',
  hsa_dependents: 0,
  fed_withholding_pct: null,
  state_withholding_pct: null,
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

  it('carries the match knobs with their own fences — rates to 2, bands only non-negative', () => {
    expect(decodePaycheck(['match_rate_1:1.5', 'match_band_1:6000', 'match_rate_2:2.5', 'match_band_2:-1'])).toEqual({
      match_rate_1: '1.5',
      match_band_1: '6000',
    })
    expect(toOverrides({ match_rate_1: '1', match_band_1: '6000' })).toEqual({ match_rate_1: '1', match_band_1: '6000' })
    // A rate prints as a percent like every other rate here; a band is money. KNOBS is
    // alphabetical, so the band is the first of the two changed knobs.
    expect(labelForPaycheck({ match_rate_1: '1', match_band_1: '6000' })).toBe('Match band 1 $6,000.00 · Match 1 100%')
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
  // --- the preset chips (2026-09-09 audit item 5) ---
  // The two cap chips APPLY the server's own target — the rate/amount that lands exactly on
  // the cap given the checks this year has already paid. `limit / salary` and
  // `limit / periods` asked the checks that are LEFT to carry a whole year, which is what
  // made the pace strip beside the chip read "over" the moment you clicked it.

  const LIMITS: Record<string, string | null> = {
    limit_401k_elective: '24500.00',
    limit_hsa_self: '4300.00',
    limit_hsa_family: null,
    limit_espp_423: '25000.00',
  }

  function ctx(over: Partial<PresetContext> = {}): PresetContext {
    return {
      salary: '100000.00',
      coverage: 'self',
      esppPct: '0.110000000',
      rothPct: '0',
      limitFor: (key: string) => LIMITS[key] ?? null,
      softLimitFor: () => null,
      toCapRate: '0.129033021',
      toCapPerCheck: '179.16',
      remainingChecks: 8,
      ...over,
    }
  }

  it('applies the server’s cap targets, and disables the chips with no datum behind them', () => {
    const apply = vi.fn()
    const presets = paycheckPresets(ctx(), apply)
    expect(presets.map((p) => [p.id, p.disabled ?? false])).toEqual([
      ['max401k', false],
      ['maxhsa', false],
      ['maxespp', false],
      ['stopespp', false],
    ])
    // Verbatim: the rate is the server's, floored there so the projection lands ON the cap.
    presets[0].apply()
    expect(apply).toHaveBeenLastCalledWith({ trad_401k_pct: '0.129033021' })
    presets[1].apply()
    expect(apply).toHaveBeenLastCalledWith({ hsa_per_check: '179.16' })
    // The ESPP chips are unchanged: that row is measured over a purchase window, not a
    // calendar year of paydays, so the §423 share of salary is still the right question.
    presets[2].apply()
    expect(apply).toHaveBeenLastCalledWith({ espp_pct: '0.15' })
    presets[3].apply()
    expect(apply).toHaveBeenLastCalledWith({ espp_pct: '0' })

    const family = paycheckPresets(ctx({ coverage: 'family', esppPct: '0', toCapPerCheck: null }), apply)
    expect(family[1].disabled).toBe(true)
    expect(family[1].title).toBe("Enter this year's HSA limit in Settings › Limits")
    expect(family[3].disabled).toBe(true)
    expect(family[3].title).toBe('ESPP is already 0%')

    const none = paycheckPresets(
      ctx({ coverage: 'none', esppPct: '0.1', limitFor: () => null, toCapRate: null, toCapPerCheck: null }),
      apply,
    )
    expect(none[0].title).toBe("Enter this year's 401(k) limit in Settings › Limits")
    expect(none[1].title).toBe('Choose Self or Family HSA coverage first')
    expect(none[2].title).toBe(
      "Enter this year's ESPP §423 limit in Settings › Limits (the ESPP pace row appears once ESPP is above 0%)",
    )
  })

  it('subtracts the scenario’s Roth from the 401(k) target, because 402(g) counts both', () => {
    const apply = vi.fn()
    // The server's 12.9033021 % is the TOTAL elective rate; 5 % of it is already Roth.
    paycheckPresets(ctx({ rothPct: '0.050000000' }), apply)[0].apply()
    expect(apply).toHaveBeenLastCalledWith({ trad_401k_pct: '0.079033021' })
  })

  it('refuses when the Roth percentage alone already fills the cap', () => {
    const preset = paycheckPresets(ctx({ rothPct: '0.200000000' }), vi.fn())[0]
    expect(preset.disabled).toBe(true)
    expect(preset.title).toBe('Your Roth percentage alone reaches the cap')
  })

  it('says “already at the cap” rather than aiming at nothing', () => {
    const apply = vi.fn()
    const presets = paycheckPresets(ctx({ toCapRate: '0', toCapPerCheck: '0' }), apply)
    expect(presets[0].title).toBe('Already at the cap')
    expect(presets[1].title).toBe('Already at the cap')
    presets[0].apply()
    presets[1].apply()
    expect(apply).not.toHaveBeenCalled()
  })

  it('tells a year with no paydays left from a payload nobody walked', () => {
    const spent = paycheckPresets(ctx({ toCapRate: null, toCapPerCheck: null, remainingChecks: 0 }), vi.fn())
    expect(spent[0].title).toBe('No paychecks left this year')
    expect(spent[1].title).toBe('No paychecks left this year')
    // A warm pre-batch snapshot carries neither figure and no walk at all — the fresh
    // payload is still in flight, so the chip must not claim the year is over.
    const cold = paycheckPresets(ctx({ toCapRate: null, toCapPerCheck: null, remainingChecks: null }), vi.fn())
    expect(cold[0].title).toBe("This year's paydays are still loading")
    expect(cold[1].title).toBe("This year's paydays are still loading")
  })

  it('refuses a target past the end of the track it moves, and names the figure', () => {
    const apply = vi.fn()
    // A mid-year start against a full cap: 62 % of the remaining gross is past the 50 %
    // slider, and $612.50 a check is past the $500 one. The chip has to land ON its track.
    const presets = paycheckPresets(ctx({ toCapRate: '0.620000000', toCapPerCheck: '612.50' }), apply)
    expect(presets[0].disabled).toBe(true)
    expect(presets[0].title).toBe('Needs 62.0% — above the slider')
    expect(presets[1].disabled).toBe(true)
    expect(presets[1].title).toBe('Needs $612.50 a check — above the slider')
    presets[0].apply()
    presets[1].apply()
    expect(apply).not.toHaveBeenCalled()
    // The ESPP chip still clamps rather than refusing: its ceiling IS the §423 15 %.
    paycheckPresets(ctx({ salary: '20000', esppPct: '0.2', limitFor: () => '24500' }), apply)[2].apply()
    expect(apply).toHaveBeenLastCalledWith({ espp_pct: '0.15' })
  })

  it('sizes Max ESPP from the PRACTICAL cap when the row carries one', () => {
    const apply = vi.fn()
    // 21,250 is the most contribution dollars the §423 cap buys at the plan discount. Sizing
    // from the statutory 25,000 would build a scenario the very strip beside it grades
    // "over" — a chip that walks straight into the warning it exists to avoid.
    const presets = paycheckPresets(
      ctx({
        salary: '250000.00',
        coverage: 'none',
        esppPct: '0.11',
        limitFor: (key: string) => (key === LIMIT_ESPP_423 ? '25000.00' : null),
        softLimitFor: (key: string) => (key === LIMIT_ESPP_423 ? '21250.00' : null),
      }),
      apply,
    )
    presets[2].apply()
    // 21250 / 250000 = 0.085, well inside the 15 % track — the §423 figure would have been 0.1.
    expect(apply).toHaveBeenLastCalledWith({ espp_pct: '0.085' })
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
      match_rate_1: '100',
      match_band_1: '6000.00',
      match_rate_2: '50',
      match_band_2: '11000.00',
      // No knob moves the employer HSA policy — the seed carries the profile's own, so an
      // Apply that never touched it saves it back unchanged.
      hsa_employer_annual: '2000.00',
      hsa_employer_per_dependent: '500.00',
      hsa_dependents: '0',
      // Same rule for the withholding split: no knob moves it, and an unentered rate seeds
      // a BLANK box rather than a "0" the user never typed.
      fed_withholding_pct: '',
      state_withholding_pct: '',
      notes: '',
    })
  })
})
