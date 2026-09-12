import type { ProjectionOut } from '../../types/api'
import type { ChartSelection } from '../../types/metrics'
import type { ZoomWindow } from '../../charts/timeZoom'
import { formatMonth } from '../../utils/format'
import { metricReceipt } from '../../utils/metricReceipt'
import { monthSerial } from './polyTrend'
import { encodeProjection, type ProjectionScenario } from './projectionScenario'

export type ProjectionDollars = 'today' | 'future'
export interface DisplayProjection extends ProjectionOut {
  display_dollars: ProjectionDollars
  target_values: string[] | null
}

export function projectionSourceLink(data: ProjectionOut): string {
  const scenario: ProjectionScenario = { knobs: {
    annual_return: data.annual_return, monthly_contribution: data.monthly_contribution,
    swr: data.swr_pct, years: String(data.years),
  }, retirements: {} }
  for (const key of ['annual_spend', 'inflation', 'volatility', 'contribution_growth'] as const) {
    if (data[key] !== null) scenario.knobs[key] = data[key]
  }
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
    const years = (monthSerial(data.months[i]) - monthSerial(data.start_month)) / 12
    const factor = (1 + Number(data.inflation)) ** years
    return (Number(value) * factor).toFixed(2)
  })
  return { ...data, display_dollars: mode,
    projected: values(data.projected), coast: values(data.coast),
    bands: data.bands === null ? null : Object.fromEntries(Object.entries(data.bands).map(([key, rows]) => [key, values(rows)])),
    target_values: data.fi_target === null ? null : values(data.months.map(() => data.fi_target!)),
  }
}

/** Frame the next useful milestone, with bounded, readable fallbacks. */
export function milestoneWindow(data: Pick<ProjectionOut, 'months' | 'start_month' | 'fi_month' | 'fi_target'>): ZoomWindow {
  const last = Math.max(0, data.months.length - 1)
  if (last === 0) return { startValue: 0, endValue: 0 }
  if (data.fi_target === null || data.fi_month === null) return { startValue: 0, endValue: last }
  const reach = Math.max(0, monthSerial(data.fi_month) - monthSerial(data.start_month))
  // Five years minimum, then two years of context beyond the next reach date.
  return { startValue: 0, endValue: Math.min(last, Math.max(60, reach + 24)) }
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
      ...(data.bands ? ['p10', 'p25', 'p50', 'p75', 'p90'].map((key) => ({
        label: `${key.slice(1)}th percentile balance`, value: data.bands?.[key]?.[index] ?? null, unit: 'USD',
      })) : []),
      { label: 'Dollar basis', value: data.display_dollars === 'future' ? `Future dollars in ${formatMonth(date)}` : `Today's dollars (${formatMonth(data.start_month)})` },
    ],
    scenario: { annual_return: data.annual_return, annual_spend: data.annual_spend,
      monthly_contribution: data.monthly_contribution, swr: data.swr_pct, volatility: data.volatility,
      inflation: data.inflation, contribution_growth: data.contribution_growth, years: data.years,
      retirements: (data.retirements ?? []).map((r) => ({ person_id: r.person_id, month: r.month, name: r.name })) },
    context: { displayDollars: data.display_dollars, baseMonth: data.base_month, startMonth: data.start_month },
    source: { href: projectionSourceLink(data), label: 'Inspect planning assumptions' },
  }
}

export function projectionReceipts(data: ProjectionOut) {
  const base = { as_of: data.base_month, completeness: 'estimated', warnings: data.warnings }
  return {
    target: metricReceipt({ ...base, id: 'projection.fi_target', label: 'FI target', value: data.fi_target,
      definition: `Annual living spending divided by the withdrawal rate, in ${formatMonth(data.start_month)} dollars.`,
      components: [{ label: 'Annual living spending', value: data.annual_spend }, { label: 'Withdrawal rate', value: data.swr_pct, unit: 'ratio' }],
      source_link: projectionSourceLink(data), source_label: 'Inspect assumptions',
    }),
    balance: metricReceipt({ ...base, id: 'projection.starting_balance', label: 'Starting investable balance', value: data.starting_balance,
      definition: 'Pre-tax, post-tax, taxable and equity account groups from the latest balance snapshot. Cash and liabilities are excluded.',
      source_link: `/net-worth?month=${data.base_month.slice(0, 7)}`, source_label: 'Open balance snapshot',
    }),
    ratio: metricReceipt({ ...base, id: 'projection.fi_ratio', label: 'FI ratio', value: data.fi_ratio, unit: 'ratio',
      definition: 'Starting investable balance divided by the FI target. Both use the same starting dollar basis.',
      components: [{ label: 'Investable balance', value: data.starting_balance, unit: 'USD' }, { label: 'FI target', value: data.fi_target, unit: 'USD' }],
      source_link: projectionSourceLink(data), source_label: 'Inspect assumptions',
    }),
    reachDate: metricReceipt({ ...base, id: 'projection.fi_date', label: 'Projected FI date', value: data.fi_month, unit: 'month',
      definition: `First month the deterministic projected balance reaches the FI target within ${data.years} years. An unavailable date means either there is no target or the model does not reach it in this horizon.`,
      components: [{ label: 'Nominal annual return', value: data.annual_return, unit: 'ratio' }, { label: 'Inflation', value: data.inflation, unit: 'ratio' }],
      source_link: projectionSourceLink(data), source_label: 'Inspect assumptions',
    }),
    probability: metricReceipt({ ...base, id: 'projection.reach_probability', label: `Reach FI target within ${data.years} years`, value: data.fi_probability, unit: 'ratio',
      definition: 'Share of 500 simulated paths that first reach the FI target within this horizon. This measures target attainment, not the ability to fund retirement spending indefinitely. Reach-date percentiles include all paths, with never-reaching paths ordered last; an unavailable date means that percentile does not reach the target within the horizon.',
      components: [{ label: 'Horizon (years)', value: data.years, unit: 'count' },
        { label: '10th percentile reach date', value: data.fi_month_p10 },
        { label: 'Median reach date', value: data.fi_month_p50 },
        { label: '90th percentile reach date', value: data.fi_month_p90 }],
      source_link: projectionSourceLink(data), source_label: 'Inspect simulation assumptions',
    }),
  }
}
