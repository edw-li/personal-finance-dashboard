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

// Alphabetical: the canonical URL order (the parity fixture's).
export const KNOBS = [
  'annual_return',
  'annual_spend',
  'contribution_growth',
  'inflation',
  'monthly_contribution',
  'swr',
  'volatility',
  'years',
] as const
export type ProjectionKnob = (typeof KNOBS)[number]

export interface ProjectionScenario {
  knobs: Partial<Record<ProjectionKnob, string>>
  /** person id → YYYY-MM */
  retirements: Record<number, string>
}

export const EMPTY_PROJECTION_SCENARIO: ProjectionScenario = { knobs: {}, retirements: {} }

// The router's own fences (api/projection.py RETURN_MIN/MAX, SWR_MESSAGE, VOLATILITY,
// INFLATION, GROWTH, YearsQuery) — a link may not carry a value the server would 422.
function accept(key: ProjectionKnob, value: string): boolean {
  if (key === 'years') return /^\d{1,2}$/.test(value) && Number(value) >= 1 && Number(value) <= 60
  if (!isWireDecimal(value)) return false
  const within = (lo: string, hi: string) => compareDecimals(value, lo) >= 0 && compareDecimals(value, hi) <= 0
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
      return compareDecimals(value, '0') > 0
    case 'monthly_contribution':
      return true // any money figure; the server bounds its magnitude
  }
}

/** The sliders' tracks — UI ranges, wider than typical but inside the fences above. */
export const SLIDER: Record<ProjectionKnob, { min: string; max: string; step: string; kind: 'percent' | 'money' | 'plain' }> = {
  annual_return: { min: '-0.5', max: '0.5', step: '0.001', kind: 'percent' },
  annual_spend: { min: '0', max: '1000000', step: '1000', kind: 'money' },
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
  return params
}

/** The echo as each knob's DERIVED value — the caption, the placeholder and the reset target. */
export function derivedOf(baseline: ProjectionOut | null): Record<ProjectionKnob, string | null> {
  return {
    annual_return: baseline?.annual_return ?? null,
    annual_spend: baseline?.annual_spend ?? null,
    contribution_growth: baseline?.contribution_growth ?? null,
    inflation: baseline?.inflation ?? null,
    monthly_contribution: baseline?.monthly_contribution ?? null,
    swr: baseline?.swr_pct ?? null,
    volatility: baseline?.volatility ?? null,
    years: baseline === null ? null : String(baseline.years),
  }
}

const SHORT: Record<ProjectionKnob, string> = {
  annual_return: 'Return',
  annual_spend: 'Spend',
  contribution_growth: 'Growth',
  inflation: 'Inflation',
  monthly_contribution: 'Contribution',
  swr: 'SWR',
  volatility: 'Volatility',
  years: 'Horizon',
}

export function labelForProjection(scenario: ProjectionScenario): string {
  const parts: string[] = []
  for (const key of KNOBS) {
    const value = scenario.knobs[key]
    if (value === undefined) continue
    const { kind } = SLIDER[key]
    parts.push(kind === 'percent' ? `${SHORT[key]} ${shiftPoint(value, 2)}%` : kind === 'money' ? `${SHORT[key]} ${formatCurrency(value)}` : `${SHORT[key]} ${value}y`)
  }
  for (const [personId, month] of Object.entries(scenario.retirements)) parts.push(`Retire #${personId} ${month}`)
  return parts.slice(0, 2).join(' · ')
}

export const COMPARE_ROWS: CompareRow[] = [
  { key: 'fi_target', label: 'FI target', kind: 'money' },
  { key: 'fi_ratio', label: 'FI ratio', kind: 'percent' },
  { key: 'fi_month', label: 'FI date', kind: 'month' },
  { key: 'coast_fi_month', label: 'Coast FI date', kind: 'month' },
  { key: 'fi_probability', label: 'FI probability', kind: 'percent' },
  { key: 'fi_month_p10', label: 'p10 date', kind: 'month' },
  { key: 'fi_month_p50', label: 'p50 date', kind: 'month' },
  { key: 'fi_month_p90', label: 'p90 date', kind: 'month' },
  { key: 'monthly_contribution', label: 'Monthly contribution', kind: 'money' },
]

const ROW_KEYS = new Set(COMPARE_ROWS.map((r) => r.key))

export function projectionValue(result: ProjectionOut, key: string): string | null {
  if (!ROW_KEYS.has(key)) return null
  return (result as unknown as Record<string, string | null | undefined>)[key] ?? null
}
