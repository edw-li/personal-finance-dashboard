// The Paycheck sandbox's codec and presets (2026-09-03 planning-sandboxes spec §9). Pure —
// no React, no fetching. Values are the SERVER'S wire vocabulary throughout (fractions for
// the five pcts, money strings, the coverage tier as stored); the percent shift lives in
// SliderBox's box and in the Apply seed, which speaks the profile form's percent grammar.
import { compareDecimals, divideDecimals, subtractDecimals } from '../../sandbox/decimal'
import type { Preset } from '../../sandbox/PresetRow'
import { formatEntry, isWireDecimal, lastWins, parseEntry, parseKnob } from '../../sandbox/scenarioUrl'
import type { HsaCoverage, PaycheckPreviewOverrides, PaycheckProfileOut } from '../../types/api'
import { formatCurrency, formatPct } from '../../utils/format'
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
  'match_band_1',
  'match_band_2',
  'match_rate_1',
  'match_rate_2',
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
// Exported so the panel's periods box cannot drift from the fence its value has to clear.
export const MIN_PAY_PERIODS = 1
export const MAX_PAY_PERIODS = 366
// app/limit_keys.py — the keys the pace rows carry.
export const LIMIT_401K_ELECTIVE = 'limit_401k_elective'
export const LIMIT_ESPP_423 = 'limit_espp_423'
export const HSA_LIMIT_KEY: Record<Exclude<HsaCoverage, 'none'>, string> = {
  self: 'limit_hsa_self',
  family: 'limit_hsa_family',
}
// The §423 ceiling on the ESPP slider (spec §9): 15 % of salary.
export const ESPP_MAX_PCT = '0.15'

/** Each knob's own ceiling (spec §9): trad/Roth/after-tax 0–50 %, ESPP the §423 15 %, HSA
 *  $0–500, withholding 0–60 %. ONE number per track, read by the slider that draws it and
 *  by the presets that aim at it — a preset may not park a knob off its own track, and the
 *  server's [0, 1] bound is a wider fence behind these, not a substitute for them. */
export const KNOB_MAX = {
  trad_401k_pct: '0.5',
  roth_401k_pct: '0.5',
  after_tax_401k_pct: '0.5',
  espp_pct: ESPP_MAX_PCT,
  withholding_pct: '0.6',
  hsa_per_check: '500',
  // A full doubling is the slider's end — the same [0, 2] the column is fenced at.
  match_rate_1: '2',
  match_rate_2: '2',
} as const

/** Whether the URL (or a box) may carry `value` for `key`. THE fence: the codec drops
 *  anything this refuses, so every control that writes a knob asks this first — otherwise a
 *  spelling the box accepted ("200000.", "+15") would be written and silently dropped on the
 *  next render, snapping the knob back to actual with nothing said. */
export function acceptKnob(key: PaycheckKnob, value: string): boolean {
  if (key === 'hsa_coverage') return (HSA_TIERS as readonly string[]).includes(value)
  if (key === 'pay_periods_per_year') {
    return /^\d{1,3}$/.test(value) && Number(value) >= MIN_PAY_PERIODS && Number(value) <= MAX_PAY_PERIODS
  }
  if (!isWireDecimal(value)) return false
  // The match's own fences: a rate may double the deferral (the server's [0, 2]); a band is
  // dollars, so nothing caps it here — the column's 422 is the backstop.
  if (key === 'match_rate_1' || key === 'match_rate_2') {
    return compareDecimals(value, '0') >= 0 && compareDecimals(value, '2') <= 0
  }
  if (key === 'match_band_1' || key === 'match_band_2') return compareDecimals(value, '0') >= 0
  if (key === 'annual_salary') return compareDecimals(value, '0') > 0
  if (key === 'hsa_per_check') return compareDecimals(value, '0') >= 0
  return compareDecimals(value, '0') >= 0 && compareDecimals(value, '1') <= 0 // the five pcts
}

export function decodePaycheck(entries: string[]): PaycheckScenario {
  const knobs = lastWins(
    entries
      .map(parseEntry)
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .map((entry) => parseKnob(entry, KNOBS, acceptKnob))
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
  match_rate_1: 'Match 1',
  match_band_1: 'Match band 1',
  match_rate_2: 'Match 2',
  match_band_2: 'Match band 2',
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
    else if (key === 'match_rate_1' || key === 'match_rate_2') parts.push(`${SHORT[key]} ${shiftPoint(value, 2)}%`)
    else parts.push(`${SHORT[key]} ${formatCurrency(value)}`)
    if (parts.length === 2) break
  }
  return parts.join(' · ')
}

export interface PresetContext {
  /** The SCENARIO's salary — the ESPP chip, the one still sized here, is a share of it. */
  salary: string
  coverage: HsaCoverage
  esppPct: string
  /** The SCENARIO's Roth percentage (the profile's, where the scenario leaves it alone). The
   *  server's 401(k) target is the TOTAL elective rate, because 402(g) counts traditional and
   *  Roth together; the chip moves only the traditional half, so it subtracts this. That
   *  subtraction — two rates, with no limit and no salary anywhere near it — is the ONE piece
   *  of arithmetic this module still does to a cap (2026-09-09 audit item 5). */
  rothPct: string
  /** A limit from the pace rows already in the payload; null when nothing is entered. */
  limitFor: (key: string) => string | null
  /** The PRACTICAL cap off the same row (spec §1.7) — today only the ESPP row carries one.
   *  Required rather than optional so no panel can quietly size a chip from the statutory
   *  cap and walk into the "over" the practical one exists to prevent. */
  softLimitFor: (key: string) => string | null
  /** The server's own answers to "what election lands me exactly on the cap", off the 401(k)
   *  and HSA pace rows: a total elective RATE and an employee per-check AMOUNT, each measured
   *  against the checks the payday walk has already counted this year and floored so the
   *  projection lands at or under the cap. `limit / salary` and `limit / periods` asked the
   *  checks that are LEFT to carry a whole year, which is why the strip beside the chip read
   *  "over"; these are required for the same reason `softLimitFor` is. 0 = no room left. */
  toCapRate: string | null
  toCapPerCheck: string | null
  /** How many checks those targets are spread over — null on a payload the server did not
   *  walk, which is how a disabled chip tells "the year is spent" from "still loading". */
  remainingChecks: number | null
}

const LIMITS_HINT = 'in Settings › Limits'
const AT_THE_CAP = 'Already at the cap'
const ROTH_ALONE = 'Your Roth percentage alone reaches the cap'
const YEAR_SPENT = 'No paychecks left this year'
const NOT_WALKED = "This year's paydays are still loading"

/** Why a chip that cannot aim at `target` is disabled, or undefined when it can.
 *
 * ONE ladder for both cap chips: no answer (and which kind of no answer), no room left, or a
 * figure past the end of the track the chip moves. A chip that parked a thumb off its own
 * slider would be refused by the box anyway — better to say so before the click. */
function refusal(
  target: string | null,
  max: string,
  remainingChecks: number | null,
  above: (target: string) => string,
): string | undefined {
  if (target === null) return remainingChecks === 0 ? YEAR_SPENT : NOT_WALKED
  if (compareDecimals(target, '0') <= 0) return AT_THE_CAP
  if (compareDecimals(target, max) > 0) return above(target)
  return undefined
}

/** Max 401(k) · Max HSA · Max ESPP · Stop ESPP (spec §9).
 *
 *  The two cap chips APPLY the server's figure (2026-09-09 audit item 5): it knows what the
 *  year has already counted, which is the thing a client dividing a limit by a salary can
 *  never know. Max ESPP is still sized here — its row is measured over a PURCHASE window
 *  against a practical cap, not a calendar year of paydays, so the division is the right
 *  question there. Exact, floored, so a figure never exceeds the cap it came from; the
 *  server still validates. */
export function paycheckPresets(
  ctx: PresetContext,
  apply: (patch: PaycheckScenario) => void,
): Preset[] {
  const elective = ctx.limitFor(LIMIT_401K_ELECTIVE)
  const hsaLimit = ctx.coverage === 'none' ? null : ctx.limitFor(HSA_LIMIT_KEY[ctx.coverage])
  // The traditional half of the server's total — what this chip actually moves. Never below
  // zero: a Roth that already fills the cap asks for no traditional at all, and says so.
  const floorAtZero = (value: string) => (compareDecimals(value, '0') < 0 ? '0' : value)
  const tradTarget =
    ctx.toCapRate === null ? null : floorAtZero(subtractDecimals(ctx.toCapRate, ctx.rothPct))
  const tradRefusal =
    elective === null
      ? `Enter this year's 401(k) limit ${LIMITS_HINT}`
      : // The cap has room, and the Roth percentage is eating all of it: a different
        // sentence from "already at the cap", because the fix is a different knob.
        ctx.toCapRate !== null &&
          compareDecimals(ctx.toCapRate, '0') > 0 &&
          tradTarget !== null &&
          compareDecimals(tradTarget, '0') === 0
        ? ROTH_ALONE
        : refusal(
            tradTarget,
            KNOB_MAX.trad_401k_pct,
            ctx.remainingChecks,
            (target) => `Needs ${formatPct(target, { signed: false })} — above the slider`,
          )
  const hsaRefusal =
    ctx.coverage === 'none'
      ? 'Choose Self or Family HSA coverage first'
      : hsaLimit === null
        ? `Enter this year's HSA limit ${LIMITS_HINT}`
        : refusal(
            ctx.toCapPerCheck,
            KNOB_MAX.hsa_per_check,
            ctx.remainingChecks,
            (target) => `Needs ${formatCurrency(target)} a check — above the slider`,
          )
  const espp = ctx.limitFor(LIMIT_ESPP_423)
  const softEspp = ctx.softLimitFor(LIMIT_ESPP_423)
  // Two ceilings, both real: the knob's own track and the server's [0, 1]. A limit larger
  // than the salary (a part-year hire, a partner's smaller base) would otherwise ask for a
  // percentage the slider cannot show and the box would refuse — the chip must land ON the
  // track it moves.
  const clamp = (value: string, max: string) => (compareDecimals(value, max) > 0 ? max : value)
  const fraction = (limit: string) => clamp(divideDecimals(limit, ctx.salary, 9) ?? '0', '1')
  return [
    {
      id: 'max401k',
      label: 'Max 401(k)',
      disabled: tradRefusal !== undefined,
      title: tradRefusal,
      apply: () => {
        if (tradRefusal === undefined && tradTarget !== null) apply({ trad_401k_pct: tradTarget })
      },
    },
    {
      id: 'maxhsa',
      label: 'Max HSA',
      disabled: hsaRefusal !== undefined,
      title: hsaRefusal,
      apply: () => {
        if (hsaRefusal === undefined && ctx.toCapPerCheck !== null) {
          apply({ hsa_per_check: ctx.toCapPerCheck })
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
        // The PRACTICAL cap where the row has one: the §423 limit buys fewer contribution
        // dollars than itself at a plan discount, so sizing from 25,000 would build the very
        // scenario the pace strip beside this chip grades "over". The statutory figure is the
        // fallback, for a row (or a warm pre-batch snapshot) that carries no practical cap.
        const cap = softEspp ?? espp
        // The lesser of the §423 ceiling and the cap ÷ salary — the same clamp as the
        // other two chips, since the ESPP track's max IS the ceiling.
        apply({ espp_pct: clamp(fraction(cap), KNOB_MAX.espp_pct) })
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
  match_rate_1: string
  match_band_1: string
  match_rate_2: string
  match_band_2: string
  // No knob moves the employer HSA policy (the sandbox models a CHECK, and the deposit is a
  // once-a-year lump), so these three ride the seed straight off the profile — an Apply that
  // never touched them saves them back unchanged rather than blanking a stored policy.
  hsa_employer_annual: string
  hsa_employer_per_dependent: string
  hsa_dependents: string
  // Same rule for the withholding split (2026-09-09 audit item 3): no knob moves it, so it
  // rides the profile through. A stored NULL seeds a BLANK box — the form's spelling of
  // "no figure from a paystub" — never a "0".
  fed_withholding_pct: string
  state_withholding_pct: string
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
    match_rate_1: shiftPoint(scenario.match_rate_1 ?? profile.match_rate_1, 2),
    match_band_1: scenario.match_band_1 ?? profile.match_band_1,
    match_rate_2: shiftPoint(scenario.match_rate_2 ?? profile.match_rate_2, 2),
    match_band_2: scenario.match_band_2 ?? profile.match_band_2,
    hsa_employer_annual: profile.hsa_employer_annual,
    hsa_employer_per_dependent: profile.hsa_employer_per_dependent,
    hsa_dependents: String(profile.hsa_dependents),
    fed_withholding_pct:
      profile.fed_withholding_pct === null ? '' : shiftPoint(profile.fed_withholding_pct, 2),
    state_withholding_pct:
      profile.state_withholding_pct === null ? '' : shiftPoint(profile.state_withholding_pct, 2),
    notes: '',
  }
}
