import type { PhaseOut, ProjectionOut } from '../../types/api'
import type { ChartSelection } from '../../types/metrics'
import type { ZoomWindow } from '../../charts/timeZoom'
import { formatMonth, formatPct } from '../../utils/format'
import { metricReceipt } from '../../utils/metricReceipt'
import { BAND_KEYS, BAND_LABELS } from './projectionChartOptions'
import { encodeProjection, headlineFiMonth, type ProjectionScenario } from './projectionScenario'

export type ProjectionDollars = 'today' | 'future'
export interface DisplayProjection extends ProjectionOut {
  display_dollars: ProjectionDollars
  target_values: string[] | null
}

/** Calendar month serial of an ISO date (year·12 + month−1) — the display's own copy: the fitted
 *  trend's module (polyTrend) is imported by the trend panel and its chart builder only (R8's fence). */
const serial = (iso: string) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1

export function projectionSourceLink(data: ProjectionOut): string {
  const scenario: ProjectionScenario = { knobs: {
    annual_return: data.annual_return, monthly_contribution: data.monthly_contribution,
    swr: data.swr_pct, years: String(data.years),
  }, retirements: {} }
  for (const key of ['annual_spend', 'inflation', 'volatility', 'contribution_growth'] as const) {
    if (data[key] !== null) scenario.knobs[key] = data[key]
  }
  // The year the run measured against, and vests only when the knob turned them off — vests left
  // out because nothing could be priced were never switched off (2026-09-23 spec §R3, §R4).
  if (data.plan_until != null) scenario.knobs.plan_until = String(data.plan_until)
  if (data.vests != null && !data.vests.included && data.vests.excluded_reason === null) scenario.knobs.vests = '0'
  for (const person of data.retirements ?? []) scenario.retirements[person.person_id] = person.month.slice(0, 7)
  const query = new URLSearchParams({ section: 'planning' })
  for (const entry of encodeProjection(scenario)) query.append('whatif', entry)
  return `/projection?${query.toString()}#projection-assumptions`
}

/** A display-only transform. The source payload and all reach results remain untouched. */
export function displayProjection(data: ProjectionOut, dollars: ProjectionDollars): DisplayProjection {
  const mode = data.inflation == null ? 'today' : dollars
  const values = (rows: string[]) => rows.map((value, i) => {
    if (mode === 'today') return value
    const years = (serial(data.months[i]) - serial(data.start_month)) / 12
    const factor = (1 + Number(data.inflation)) ** years
    return (Number(value) * factor).toFixed(2)
  })
  return { ...data, display_dollars: mode,
    projected: values(data.projected), coast: values(data.coast),
    bands: data.bands === null ? null : Object.fromEntries(Object.entries(data.bands).map(([key, rows]) => [key, values(rows)])),
    target_values: data.fi_target === null ? null : values(data.months.map(() => data.fi_target!)),
  }
}

/** Frame the next useful milestone, with bounded, readable fallbacks. When withdrawals are
 *  modelled the question on the chart is whether the money lasts through the plan-until year,
 *  so the window reaches that December (2026-09-23 spec §R7: the drawdown must be visible). */
export function milestoneWindow(data: Pick<ProjectionOut, 'months' | 'start_month' | 'fi_month' | 'fi_target' | 'drawdown' | 'plan_until'>): ZoomWindow {
  const last = Math.max(0, data.months.length - 1)
  if (last === 0) return { startValue: 0, endValue: 0 }
  const planEnd = data.drawdown != null && data.plan_until != null
    ? serial(`${data.plan_until}-12-01`) - serial(data.start_month) : null
  if (data.fi_target === null || data.fi_month === null) return { startValue: 0, endValue: last }
  const reach = Math.max(0, serial(data.fi_month) - serial(data.start_month))
  // Five years minimum, then two years of context beyond the next reach date.
  const end = Math.max(60, reach + 24, planEnd ?? 0)
  return { startValue: 0, endValue: Math.min(last, end) }
}

export function projectionSelection(data: DisplayProjection, index: number): ChartSelection | null {
  const date = data.months[index]
  if (!date) return null
  return {
    kind: 'projection', id: `projection:${date}:${data.display_dollars}`, label: formatMonth(date), date, scope: 'Household',
    values: [
      { label: 'Projected balance', value: data.projected[index] ?? null, unit: 'USD' },
      { label: 'Growth only', value: data.coast[index] ?? null, unit: 'USD' },
      { label: 'FI target', value: data.target_values?.[index] ?? null, unit: 'USD' },
      ...(data.bands ? BAND_KEYS.map((key) => ({
        label: BAND_LABELS[key], value: data.bands?.[key]?.[index] ?? null, unit: 'USD',
      })) : []),
      { label: 'Dollar basis', value: data.display_dollars === 'future' ? `Future dollars in ${formatMonth(date)}` : `Today's dollars (${formatMonth(data.start_month)})` },
    ],
    scenario: { annual_return: data.annual_return, annual_spend: data.annual_spend,
      monthly_contribution: data.monthly_contribution, swr: data.swr_pct, volatility: data.volatility,
      inflation: data.inflation, contribution_growth: data.contribution_growth, years: data.years,
      plan_until: data.plan_until ?? null, vests: data.vests == null ? null : data.vests.included,
      retirements: (data.retirements ?? []).map((r) => ({ person_id: r.person_id, month: r.month, name: r.name })) },
    context: { displayDollars: data.display_dollars, baseMonth: data.base_month, startMonth: data.start_month },
    source: { href: projectionSourceLink(data), label: 'Inspect planning assumptions' },
  }
}

/** A tile's words: its value (with a unit set small beneath it when the reading is longer than
 *  a figure), its delta, the delta's tone and an optional badge. */
export interface TileText {
  value: string
  unit?: string
  delta?: string
  tone: 'positive' | 'negative' | 'neutral' | 'warn'
  badge?: string
}

const VERDICT = {
  on_track: { tone: 'positive', badge: 'On track' },
  borderline: { tone: 'warn', badge: 'Borderline' },
  at_risk: { tone: 'negative', badge: 'At risk' },
} as const

const horizonEnd = (data: ProjectionOut) => formatMonth(data.months.at(-1) ?? data.start_month)

/** THE FI date (2026-09-23 spec §R6): the simulation's median reach with its range in paths —
 *  never "p10/p50/p90" — or, when nothing was simulated, the constant-return crossing, said so. */
export function fiDateTile(data: ProjectionOut): TileText {
  if (data.fi_target === null) return { value: '—', tone: 'neutral' }
  const end = horizonEnd(data)
  if (data.fi_probability == null) {
    return { value: data.fi_month === null ? `Beyond ${end}` : formatMonth(data.fi_month), delta: 'at a constant return', tone: 'neutral' }
  }
  const value = data.fi_month_p50 === null ? `Beyond ${end}` : formatMonth(data.fi_month_p50)
  if (data.fi_month_p10 === null) return { value, delta: `Fewer than 1 in 10 paths reach it by ${end}`, tone: 'neutral' }
  const late = data.fi_month_p90 === null ? `beyond ${end}` : `by ${formatMonth(data.fi_month_p90)}`
  return { value, delta: `1 in 10 paths by ${formatMonth(data.fi_month_p10)} · 9 in 10 ${late}`, tone: 'neutral' }
}

/** "Money lasts" (spec §R3, §R7): the share of paths through the plan-until year, toned by the
 *  verdict with the verdict's word as the badge; the constant-return sentence with volatility 0;
 *  a dash and the server's reason when no withdrawal is modelled. */
export function moneyLastsTile(data: ProjectionOut): TileText {
  const lasts = data.money_lasts ?? null
  if (lasts === null) return { value: '—', tone: 'neutral' }
  if (lasts.reason) return { value: '—', delta: lasts.reason, tone: 'neutral' }
  if (lasts.probability !== null && lasts.verdict !== null) {
    return {
      value: formatPct(lasts.probability, { signed: false }),
      unit: `of paths through ${lasts.plan_until}`,
      delta: lasts.lasts_until_p10 === null
        ? `In 9 of 10 paths the money lasts beyond ${formatMonth(lasts.horizon_end)}, the end of the projection`
        : `In 9 of 10 paths the money lasts until at least ${lasts.lasts_until_p10.slice(0, 4)}`,
      ...VERDICT[lasts.verdict],
    }
  }
  const out = lasts.deterministic_depleted_month
  return out !== null && out <= `${lasts.plan_until}-12-01`
    ? { value: 'Runs out', unit: `${formatMonth(out)} at a constant return`, tone: 'neutral' }
    : { value: 'Lasts', unit: `through ${lasts.plan_until} at a constant return`, tone: 'neutral' }
}

const PHASE_WORDS: Record<PhaseOut['kind'], string> = {
  working: 'Working',
  partly_retired: 'Partly retired',
  retired: 'Retired',
}

function phaseComponent(phase: PhaseOut) {
  const from = `${PHASE_WORDS[phase.kind]} from ${formatMonth(phase.from_month)}`
  return phase.kind === 'retired'
    ? { label: `${from} — withdrawing per month`, value: phase.monthly_withdrawal, unit: 'USD' }
    : { label: `${from} — saving per month`, value: phase.monthly_contribution, unit: 'USD' }
}

export function projectionReceipts(data: ProjectionOut) {
  const base = { as_of: data.base_month, completeness: 'estimated', warnings: data.warnings }
  const lasts = data.money_lasts ?? null
  const planUntil = lasts?.plan_until ?? data.plan_until ?? null
  return {
    target: metricReceipt({ ...base, id: 'projection.fi_target', label: 'FI target', value: data.fi_target,
      definition: `Annual living spending divided by the withdrawal rate, in ${formatMonth(data.start_month)} dollars.`,
      components: [{ label: 'Annual living spending', value: data.annual_spend }, { label: 'Withdrawal rate', value: data.swr_pct, unit: 'ratio' }],
      source_link: projectionSourceLink(data), source_label: 'Inspect assumptions',
    }),
    balance: metricReceipt({ ...base, as_of: data.base_as_of ?? data.base_month, id: 'projection.starting_balance', label: 'Starting investable balance', value: data.starting_balance,
      definition: 'Pre-tax, post-tax, taxable and equity account groups from the current balance snapshot. Cash and liabilities are excluded.',
      source_link: `/net-worth?month=${data.base_month.slice(0, 7)}`, source_label: 'Open balance snapshot',
    }),
    ratio: metricReceipt({ ...base, id: 'projection.fi_ratio', label: 'FI ratio', value: data.fi_ratio, unit: 'ratio',
      definition: 'Starting investable balance divided by the FI target. Both use the same starting dollar basis.',
      components: [{ label: 'Investable balance', value: data.starting_balance, unit: 'USD' }, { label: 'FI target', value: data.fi_target, unit: 'USD' }],
      source_link: projectionSourceLink(data), source_label: 'Inspect assumptions',
    }),
    fiDate: metricReceipt({ ...base, id: 'projection.fi_date', label: 'FI date', value: headlineFiMonth(data), unit: 'month',
      definition: data.fi_probability == null
        ? `The first month the projected balance reaches the FI target at a constant return, within ${data.years} years. With volatility at 0 no paths are simulated.`
        : `The month by which half of the 500 simulated paths first reach the FI target, with the range in paths: 1 in 10 get there by the first date, 9 in 10 by the last. Paths that never reach it within ${data.years} years count as later than every date; an unavailable date means that share of paths does not reach it within the horizon. Reaching the target is not the same as the money lasting — the Money lasts tile answers that.`,
      components: [
        { label: '1 in 10 paths by', value: data.fi_month_p10 },
        { label: 'Half of paths by', value: data.fi_month_p50 },
        { label: '9 in 10 paths by', value: data.fi_month_p90 },
        { label: `Reach FI within ${data.years} years`, value: data.fi_probability, unit: 'ratio' },
        { label: 'At a constant return', value: data.fi_month },
      ],
      source_link: projectionSourceLink(data), source_label: 'Inspect simulation assumptions',
    }),
    moneyLasts: metricReceipt({ ...base, id: 'projection.money_lasts', label: planUntil === null ? 'Money lasts' : `Money lasts through ${planUntil}`,
      value: lasts?.probability ?? null, unit: 'ratio',
      definition: lasts?.reason
        ? lasts.reason
        : `The share of 500 simulated paths whose balance never runs out through December ${planUntil}. Every retirement month splits the plan into phases: while one of you works, that person's payroll saving and employer match continue and their pay is assumed to cover your spending; from the last retirement on, your annual spend is withdrawn each year in today's dollars. A path that reaches $0 in any phase counts as running out. Returns are independent lognormal draws at your return and volatility; withdrawals are untaxed; Social Security and pensions are not modelled.`,
      components: [
        { label: 'Plan until', value: planUntil === null ? null : String(planUntil) },
        ...(data.drawdown ? [{ label: `Annual withdrawal from ${formatMonth(data.drawdown.start_month)}`, value: data.drawdown.annual_withdrawal, unit: 'USD' }] : []),
        ...(data.phases ?? []).map(phaseComponent),
        { label: 'In 9 of 10 paths lasts until at least', value: lasts?.lasts_until_p10 ?? null },
        { label: 'At a constant return, runs out', value: lasts === null || lasts.reason ? null : lasts.deterministic_depleted_month ?? 'Not within the projection' },
      ],
      source_link: projectionSourceLink(data), source_label: 'Inspect simulation assumptions',
    }),
  }
}
