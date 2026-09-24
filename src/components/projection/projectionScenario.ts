// The Projection sandbox's codec (2026-09-03 planning-sandboxes spec §11). Pure. Knob values
// are the SERVER'S wire vocabulary — the same keys and fractions as the query the page sends
// (`annual_return=0.06`, `retire=2:2035-06`), so a link IS the request. Blank means derived:
// an unset knob is absent from the URL and the empty run's echo stands in for it.
import type { ProjectionParams } from '../../api/projection'
import type { CompareRow } from '../../sandbox/CompareTable'
import { compareDecimals } from '../../sandbox/decimal'
import { formatEntry, formatRetire, isWireDecimal, lastWins, parseEntry, parseKnob, parseRetire } from '../../sandbox/scenarioUrl'
import type { ProjectionOut } from '../../types/api'
import { formatCurrency } from '../../utils/format'
import { shiftPoint } from '../../utils/percent'

// Alphabetical: the canonical URL order (the parity fixture's). `plan_until` (a year) and `vests`
// (0/1) joined on 2026-09-23 (correctness spec §R7, §R10).
export const KNOBS = [
  'annual_return',
  'annual_spend',
  'contribution_growth',
  'inflation',
  'monthly_contribution',
  'plan_until',
  'swr',
  'vests',
  'volatility',
  'years',
] as const
export type ProjectionKnob = (typeof KNOBS)[number]
/** The knobs a SliderBox drives; the year box and the vests toggle are their own controls. */
export type SliderKnob = Exclude<ProjectionKnob, 'plan_until' | 'vests'>
export const SLIDER_KNOBS = KNOBS.filter((key): key is SliderKnob => key !== 'plan_until' && key !== 'vests')

export interface ProjectionScenario {
  knobs: Partial<Record<ProjectionKnob, string>>
  /** person id → YYYY-MM */
  retirements: Record<number, string>
}

export const EMPTY_PROJECTION_SCENARIO: ProjectionScenario = { knobs: {}, retirements: {} }

/** A plan-until year the URL may carry: four digits inside 2000–2199. The client's own fence —
 *  the server validates the exact range (its start year to its 60-year reach) and 422s the rest. */
export const PLAN_UNTIL_TOKEN = /^\d{4}$/
export const PLAN_UNTIL_MIN = 2000
export const PLAN_UNTIL_MAX = 2199

// The router's own fences (api/projection.py RETURN_MIN/MAX, SWR_MESSAGE, VOLATILITY,
// INFLATION, GROWTH, YearsQuery) — a link may not carry a value the server would 422.
function accept(key: ProjectionKnob, value: string): boolean {
  if (key === 'years') return /^\d{1,2}$/.test(value) && Number(value) >= 1 && Number(value) <= 60
  if (key === 'plan_until') return PLAN_UNTIL_TOKEN.test(value) && Number(value) >= PLAN_UNTIL_MIN && Number(value) <= PLAN_UNTIL_MAX
  if (key === 'vests') return value === '0' || value === '1'
  if (!isWireDecimal(value)) return false
  const within = (lo: string, hi: string) => compareDecimals(value, lo) >= 0 && compareDecimals(value, hi) <= 0
  // services/money.py's _quantize_bounded refuses |value| >= max_abs, so a magnitude fence
  // is EXCLUSIVE at both ends — `within` would keep the very value the server 422s.
  const under = (abs: string) => compareDecimals(value, `-${abs}`) > 0 && compareDecimals(value, abs) < 0
  switch (key) {
    case 'annual_return':
      return within('-0.5', '0.5')
    case 'swr':
      return compareDecimals(value, '0') > 0 && compareDecimals(value, '1') <= 0
    case 'volatility':
      return within('0', '1')
    case 'inflation':
      return within('-0.1', '0.25')
    case 'contribution_growth':
      return within('0', '0.25')
    case 'annual_spend':
      // Positive, and under SPEND_MAX_ABS (1e9) — the same exclusive magnitude fence.
      return compareDecimals(value, '0') > 0 && under('1000000000')
    case 'monthly_contribution':
      // The server's own magnitude bound (CONTRIBUTION_MAX_ABS = 1e7), exclusive as it is
      // there; negatives are legal — a household drawing down saves a negative amount each
      // month (the engine clamps the balance at $0 and counts it as run out, spec §R1).
      return under('10000000')
  }
}

/** The sliders' tracks — UI ranges, wider than typical but inside the fences above. */
export const SLIDER: Record<SliderKnob, { min: string; max: string; step: string; kind: 'percent' | 'money' | 'plain' }> = {
  annual_return: { min: '-0.5', max: '0.5', step: '0.001', kind: 'percent' },
  // The track's floor is INSIDE the fence above (spend must be > 0): a slider dragged to
  // its own minimum must produce a value the URL will keep, or the knob would silently
  // snap back to derived on the arrival rewrite.
  annual_spend: { min: '1000', max: '1000000', step: '1000', kind: 'money' },
  contribution_growth: { min: '0', max: '0.25', step: '0.001', kind: 'percent' },
  inflation: { min: '-0.1', max: '0.25', step: '0.001', kind: 'percent' },
  monthly_contribution: { min: '0', max: '50000', step: '100', kind: 'money' },
  swr: { min: '0.001', max: '0.1', step: '0.0005', kind: 'percent' },
  volatility: { min: '0', max: '1', step: '0.005', kind: 'percent' },
  years: { min: '1', max: '60', step: '1', kind: 'plain' },
}

export function decodeProjection(entries: string[]): ProjectionScenario {
  const parsed = entries.map(parseEntry).filter((e): e is NonNullable<typeof e> => e !== null)
  const knobs = lastWins(
    parsed.map((e) => parseKnob(e, KNOBS, accept)).filter((k): k is NonNullable<typeof k> => k !== null),
    (k) => k.key,
  )
  const retirements = lastWins(
    parsed.filter((e) => e.key === 'retire').map((e) => parseRetire(e.fields)).filter((r): r is NonNullable<typeof r> => r !== null),
    (r) => String(r.person_id),
  )
  const scenario: ProjectionScenario = { knobs: {}, retirements: {} }
  for (const k of knobs) scenario.knobs[k.key] = k.value
  for (const r of retirements) scenario.retirements[r.person_id] = r.month
  return scenario
}

export function encodeProjection(scenario: ProjectionScenario): string[] {
  return [
    ...KNOBS.filter((key) => scenario.knobs[key] !== undefined).map((key) => formatEntry(key, scenario.knobs[key] as string)),
    ...Object.keys(scenario.retirements)
      .map(Number)
      .sort((a, b) => a - b)
      .map((personId) => formatRetire({ person_id: personId, month: scenario.retirements[personId] })),
  ]
}

export function isEmptyProjection(scenario: ProjectionScenario): boolean {
  return KNOBS.every((key) => scenario.knobs[key] === undefined) && Object.keys(scenario.retirements).length === 0
}

/** A straight copy into fetchProjection's params; unset knobs are absent (blank omits). */
export function toParams(scenario: ProjectionScenario): ProjectionParams {
  const k = scenario.knobs
  const params: ProjectionParams = {
    retirements: Object.keys(scenario.retirements)
      .map(Number)
      .sort((a, b) => a - b)
      .map((personId) => ({ personId, month: scenario.retirements[personId] })),
  }
  if (k.annual_return !== undefined) params.annualReturn = k.annual_return
  if (k.monthly_contribution !== undefined) params.monthlyContribution = k.monthly_contribution
  if (k.annual_spend !== undefined) params.annualSpend = k.annual_spend
  if (k.swr !== undefined) params.swr = k.swr
  if (k.years !== undefined) params.years = k.years
  if (k.volatility !== undefined) params.volatility = k.volatility
  if (k.inflation !== undefined) params.inflation = k.inflation
  if (k.contribution_growth !== undefined) params.contributionGrowth = k.contribution_growth
  if (k.plan_until !== undefined) params.planUntil = k.plan_until
  if (k.vests !== undefined) params.vests = k.vests
  return params
}

/** The echo as each knob's DERIVED value — the caption, the placeholder and the reset target. */
export function derivedOf(baseline: ProjectionOut | null): Record<ProjectionKnob, string | null> {
  const planUntil = baseline?.plan_until ?? null
  const vests = baseline?.vests ?? null
  return {
    annual_return: baseline?.annual_return ?? null,
    annual_spend: baseline?.annual_spend ?? null,
    contribution_growth: baseline?.contribution_growth ?? null,
    inflation: baseline?.inflation ?? null,
    monthly_contribution: baseline?.monthly_contribution ?? null,
    plan_until: planUntil === null ? null : String(planUntil),
    swr: baseline?.swr_pct ?? null,
    vests: vests === null ? null : vests.included ? '1' : '0',
    volatility: baseline?.volatility ?? null,
    // The KNOB (2026-09-24 re-review): a baseline lengthened by the Settings plan-until year
    // ran 50 years on a 30-year knob, and 50 back in the box would re-deal every path.
    years: baseline === null ? null : String(baseline.base_years ?? baseline.years),
  }
}

/** THE headline FI date (2026-09-23 spec §R6): the simulation's median first-reach month; with
 *  no simulation (volatility 0, or an older backend) the constant-return crossing stands in. */
export function headlineFiMonth(data: ProjectionOut): string | null {
  return data.fi_probability == null ? data.fi_month : data.fi_month_p50
}

const SHORT: Record<SliderKnob, string> = {
  annual_return: 'Return',
  annual_spend: 'Spend',
  contribution_growth: 'Growth',
  inflation: 'Inflation',
  monthly_contribution: 'Contribution',
  swr: 'SWR',
  volatility: 'Volatility',
  years: 'Horizon',
}

/** A pin's default name — its first two knobs. `people` names a retirement by the person
 *  it belongs to ("Retire Grace 2035-06"); without a roster the id has to stand in. */
export function labelForProjection(
  scenario: ProjectionScenario,
  people: { id: number; name: string }[] = [],
): string {
  const parts: string[] = []
  for (const key of KNOBS) {
    const value = scenario.knobs[key]
    if (value === undefined) continue
    if (key === 'plan_until') {
      parts.push(`Plan until ${value}`)
      continue
    }
    if (key === 'vests') {
      parts.push(value === '0' ? 'Vests off' : 'Vests on')
      continue
    }
    const { kind } = SLIDER[key]
    parts.push(kind === 'percent' ? `${SHORT[key]} ${shiftPoint(value, 2)}%` : kind === 'money' ? `${SHORT[key]} ${formatCurrency(value)}` : `${SHORT[key]} ${value}y`)
  }
  for (const [personId, month] of Object.entries(scenario.retirements)) {
    const who = people.find((p) => String(p.id) === personId)
    parts.push(`Retire ${who === undefined ? `#${personId}` : who.name} ${month}`)
  }
  return parts.slice(0, 2).join(' · ')
}

// The reader's words for the reach dates (spec §R6): "1 in 10 paths by", never "p10".
export const COMPARE_ROWS: CompareRow[] = [
  { key: 'years', label: 'Horizon (years)', kind: 'plain' },
  { key: 'fi_target', label: 'FI target', kind: 'money' },
  { key: 'fi_ratio', label: 'FI ratio', kind: 'percent' },
  { key: 'fi_date', label: 'FI date (most likely)', kind: 'month' },
  { key: 'fi_month_p10', label: 'FI · 1 in 10 paths by', kind: 'month' },
  { key: 'fi_month_p90', label: 'FI · 9 in 10 paths by', kind: 'month' },
  { key: 'fi_probability', label: 'Reach FI within horizon', kind: 'percent' },
  { key: 'money_lasts', label: 'Money lasts through plan-until year', kind: 'percent' },
  { key: 'lasts_until', label: 'Lasts at least until (9 in 10 paths)', kind: 'month' },
  { key: 'coast_fi_month', label: 'Coast FI date', kind: 'month' },
  { key: 'vests', label: 'Scheduled vests', kind: 'plain' },
  { key: 'monthly_contribution', label: 'Monthly contribution', kind: 'money' },
]

const ROW_KEYS = new Set(COMPARE_ROWS.map((r) => r.key))

export function projectionValue(result: ProjectionOut, key: string): string | null {
  if (!ROW_KEYS.has(key)) return null
  switch (key) {
    case 'years': {
      // The KNOB, as the footer and the Horizon box mean it (batch 2 integration, 2026-09-24):
      // scenarios on one knob share their simulated paths, and a plan-until year that lengthened
      // the run only appended months. The years it RAN would read years:50 and years:30 +
      // plan until 2075 alike, so a lengthened run says so beside its knob instead.
      const knob = result.base_years ?? result.years
      if (knob === result.years) return String(knob)
      return result.plan_until != null ? `${knob} (runs through ${result.plan_until})` : `${knob} (runs ${result.years})`
    }
    case 'fi_date':
      return headlineFiMonth(result)
    case 'money_lasts':
      return result.money_lasts?.probability ?? null
    case 'lasts_until':
      return result.money_lasts?.lasts_until_p10 ?? null
    case 'vests': {
      const vests = result.vests ?? null
      return vests === null ? null : vests.included ? 'Included' : 'Off'
    }
    default:
      return (result as unknown as Record<string, string | null | undefined>)[key] ?? null
  }
}
