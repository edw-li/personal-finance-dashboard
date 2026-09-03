// The Paycheck sandbox's codec and presets (2026-09-03 planning-sandboxes spec §9). Pure —
// no React, no fetching. Values are the SERVER'S wire vocabulary throughout (fractions for
// the five pcts, money strings, the coverage tier as stored); the percent shift lives in
// SliderBox's box and in the Apply seed, which speaks the profile form's percent grammar.
import { compareDecimals, divideDecimals } from '../../sandbox/decimal'
import type { Preset } from '../../sandbox/PresetRow'
import { formatEntry, isWireDecimal, lastWins, parseEntry, parseKnob } from '../../sandbox/scenarioUrl'
import type { HsaCoverage, PaycheckPreviewOverrides, PaycheckProfileOut } from '../../types/api'
import { formatCurrency } from '../../utils/format'
import { addMonths } from '../../utils/months'
import { shiftPoint } from '../../utils/percent'

export const PCT_KNOBS = [
  'trad_401k_pct',
  'roth_401k_pct',
  'after_tax_401k_pct',
  'espp_pct',
  'withholding_pct',
] as const
// Alphabetical: the canonical URL order, so an arriving link in this order is never rewritten.
export const KNOBS = [
  'after_tax_401k_pct',
  'annual_salary',
  'espp_pct',
  'hsa_coverage',
  'hsa_per_check',
  'pay_periods_per_year',
  'roth_401k_pct',
  'trad_401k_pct',
  'withholding_pct',
] as const
export type PaycheckKnob = (typeof KNOBS)[number]
export type PaycheckScenario = Partial<Record<PaycheckKnob, string>>

export const HSA_TIERS: readonly HsaCoverage[] = ['none', 'self', 'family']
// The paycheck router's own bounds (app/api/paycheck.py MIN_PAY_PERIODS / MAX_PAY_PERIODS):
// refuse a typo in the box rather than spend a request on the 422 that says the same thing.
const MIN_PAY_PERIODS = 1
const MAX_PAY_PERIODS = 366
// app/limit_keys.py — the keys the pace rows carry.
export const LIMIT_401K_ELECTIVE = 'limit_401k_elective'
export const LIMIT_ESPP_423 = 'limit_espp_423'
export const HSA_LIMIT_KEY: Record<Exclude<HsaCoverage, 'none'>, string> = {
  self: 'limit_hsa_self',
  family: 'limit_hsa_family',
}
// The §423 ceiling on the ESPP slider (spec §9): 15 % of salary.
export const ESPP_MAX_PCT = '0.15'

function accept(key: PaycheckKnob, value: string): boolean {
  if (key === 'hsa_coverage') return (HSA_TIERS as readonly string[]).includes(value)
  if (key === 'pay_periods_per_year') {
    return /^\d{1,3}$/.test(value) && Number(value) >= MIN_PAY_PERIODS && Number(value) <= MAX_PAY_PERIODS
  }
  if (!isWireDecimal(value)) return false
  if (key === 'annual_salary') return compareDecimals(value, '0') > 0
  if (key === 'hsa_per_check') return compareDecimals(value, '0') >= 0
  return compareDecimals(value, '0') >= 0 && compareDecimals(value, '1') <= 0 // the five pcts
}

export function decodePaycheck(entries: string[]): PaycheckScenario {
  const knobs = lastWins(
    entries
      .map(parseEntry)
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .map((entry) => parseKnob(entry, KNOBS, accept))
      .filter((knob): knob is NonNullable<typeof knob> => knob !== null),
    (knob) => knob.key,
  )
  const scenario: PaycheckScenario = {}
  for (const knob of knobs) scenario[knob.key] = knob.value
  return scenario
}

export function encodePaycheck(scenario: PaycheckScenario): string[] {
  return KNOBS.filter((key) => scenario[key] !== undefined).map((key) =>
    formatEntry(key, scenario[key] as string),
  )
}

export function isEmptyPaycheck(scenario: PaycheckScenario): boolean {
  return KNOBS.every((key) => scenario[key] === undefined)
}

/** decode → request body is a straight copy (spec §6); periods is the body's one integer. */
export function toOverrides(scenario: PaycheckScenario): PaycheckPreviewOverrides {
  const overrides: PaycheckPreviewOverrides = {}
  for (const key of KNOBS) {
    const value = scenario[key]
    if (value === undefined) continue
    if (key === 'pay_periods_per_year') overrides.pay_periods_per_year = Number(value)
    else if (key === 'hsa_coverage') overrides.hsa_coverage = value as HsaCoverage
    else overrides[key] = value
  }
  return overrides
}

const SHORT: Record<PaycheckKnob, string> = {
  trad_401k_pct: '401(k)',
  roth_401k_pct: 'Roth',
  after_tax_401k_pct: 'After-tax',
  espp_pct: 'ESPP',
  withholding_pct: 'Withholding',
  hsa_per_check: 'HSA',
  annual_salary: 'Salary',
  pay_periods_per_year: 'periods',
  hsa_coverage: 'HSA',
}

/** "401(k) 15% · HSA $250.00" — the first two changed knobs, in canonical order (spec §8.5). */
export function labelForPaycheck(scenario: PaycheckScenario): string {
  const parts: string[] = []
  for (const key of KNOBS) {
    const value = scenario[key]
    if (value === undefined) continue
    if ((PCT_KNOBS as readonly string[]).includes(key)) parts.push(`${SHORT[key]} ${shiftPoint(value, 2)}%`)
    else if (key === 'pay_periods_per_year') parts.push(`${value} periods`)
    else if (key === 'hsa_coverage') parts.push(`HSA ${value}`)
    else parts.push(`${SHORT[key]} ${formatCurrency(value)}`)
    if (parts.length === 2) break
  }
  return parts.join(' · ')
}

export interface PresetContext {
  /** The SCENARIO's salary and periods — presets are sized against what is being modelled. */
  salary: string
  periods: number
  coverage: HsaCoverage
  esppPct: string
  /** A limit from the pace rows already in the payload; null when nothing is entered. */
  limitFor: (key: string) => string | null
}

const LIMITS_HINT = 'in Settings › Limits'

/** Max 401(k) · Max HSA · Max ESPP · Stop ESPP (spec §9). Exact division, floored, so an
 *  annualized figure never exceeds the cap it was sized from; the server still validates. */
export function paycheckPresets(
  ctx: PresetContext,
  apply: (patch: PaycheckScenario) => void,
): Preset[] {
  const elective = ctx.limitFor(LIMIT_401K_ELECTIVE)
  const hsaLimit = ctx.coverage === 'none' ? null : ctx.limitFor(HSA_LIMIT_KEY[ctx.coverage])
  const espp = ctx.limitFor(LIMIT_ESPP_423)
  const fraction = (limit: string) => {
    const raw = divideDecimals(limit, ctx.salary, 9) ?? '0'
    return compareDecimals(raw, '1') > 0 ? '1' : raw // the server's [0, 1] bound
  }
  return [
    {
      id: 'max401k',
      label: 'Max 401(k)',
      disabled: elective === null,
      title: elective === null ? `Enter this year's 401(k) limit ${LIMITS_HINT}` : undefined,
      apply: () => {
        if (elective !== null) apply({ trad_401k_pct: fraction(elective) })
      },
    },
    {
      id: 'maxhsa',
      label: 'Max HSA',
      disabled: hsaLimit === null,
      title:
        ctx.coverage === 'none'
          ? 'Choose Self or Family HSA coverage first'
          : hsaLimit === null
            ? `Enter this year's HSA limit ${LIMITS_HINT}`
            : undefined,
      apply: () => {
        if (hsaLimit !== null) {
          apply({ hsa_per_check: divideDecimals(hsaLimit, String(ctx.periods), 2) ?? '0' })
        }
      },
    },
    {
      id: 'maxespp',
      label: 'Max ESPP',
      disabled: espp === null,
      title:
        espp === null
          ? `Enter this year's ESPP §423 limit ${LIMITS_HINT} (the ESPP pace row appears once ESPP is above 0%)`
          : undefined,
      apply: () => {
        if (espp === null) return
        const byLimit = fraction(espp)
        apply({ espp_pct: compareDecimals(byLimit, ESPP_MAX_PCT) < 0 ? byLimit : ESPP_MAX_PCT })
      },
    },
    {
      id: 'stopespp',
      label: 'Stop ESPP',
      disabled: compareDecimals(ctx.esppPct, '0') === 0,
      title: compareDecimals(ctx.esppPct, '0') === 0 ? 'ESPP is already 0%' : undefined,
      apply: () => apply({ espp_pct: '0' }),
    },
  ]
}

/** The profile form's seed for Apply (spec §9): the base profile with the scenario applied,
 *  in the FORM's grammar — percents as percents ("15", never "0.15"), the first of the month
 *  after `todayMonthIso` as the effective date, an empty note. Field names are the form's. */
export interface ApplySeed {
  effective_date: string
  annual_salary: string
  pay_periods_per_year: string
  trad_401k_pct: string
  roth_401k_pct: string
  after_tax_401k_pct: string
  espp_pct: string
  withholding_pct: string
  dental_vision_per_check: string
  hsa_per_check: string
  hsa_coverage: HsaCoverage
  notes: string
}

export function applySeedFor(
  profile: PaycheckProfileOut,
  scenario: PaycheckScenario,
  todayMonthIso: string,
): ApplySeed {
  const pct = (key: (typeof PCT_KNOBS)[number]) => shiftPoint(scenario[key] ?? profile[key], 2)
  return {
    effective_date: addMonths(todayMonthIso, 1),
    annual_salary: scenario.annual_salary ?? profile.annual_salary,
    pay_periods_per_year: scenario.pay_periods_per_year ?? String(profile.pay_periods_per_year),
    trad_401k_pct: pct('trad_401k_pct'),
    roth_401k_pct: pct('roth_401k_pct'),
    after_tax_401k_pct: pct('after_tax_401k_pct'),
    espp_pct: pct('espp_pct'),
    withholding_pct: pct('withholding_pct'),
    dental_vision_per_check: profile.dental_vision_per_check,
    hsa_per_check: scenario.hsa_per_check ?? profile.hsa_per_check,
    hsa_coverage: (scenario.hsa_coverage as HsaCoverage | undefined) ?? profile.hsa_coverage,
    notes: '',
  }
}
