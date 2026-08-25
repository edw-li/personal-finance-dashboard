import { describe, expect, it } from 'vitest'
import type { EChartsOption } from '../../charts/echarts'
import { MUTED, NEGATIVE, OTHER_SERIES_COLOR, PALETTE, POSITIVE } from '../../charts/theme'
import type { MoneyFlowOut } from '../../types/api'
import { moneyFlowOption } from './moneyFlowOptions'

// A conservation-consistent wire payload (sources sum to gross; the mid column sums back
// to gross; saved = take-home − total_spend), strings exactly as the server quantizes.
// These are FIXTURE figures shaped like the server's, not engine assertions — the engine
// truth is pinned backend-side.
function flowOut(over: Partial<MoneyFlowOut> = {}): MoneyFlowOut {
  return {
    year: 2026,
    available_years: [2024, 2025, 2026],
    renderable: true,
    reason: null,
    warnings: [],
    sources: {
      salary_and_bonus: '220000.00',
      rsu_vests: '80000.00',
      espp: '4000.00',
      investment_income: '2500.00',
      other_income: '1000.00',
    },
    gross_income: '307500.00',
    taxes: {
      total: '67016.05',
      federal: '26520.00',
      state: '14225.00',
      medicare: '4345.65',
      social_security: '18581.40',
      disability: '3344.00',
      capital_gains: '0.00',
    },
    pre_tax_savings: '27300.00',
    take_home_cash: '120000.00',
    retained_equity: '93183.95',
    categories: [
      { name: 'Rent', amount: '24000.00' },
      { name: 'Food', amount: '6000.00' },
      { name: 'Travel', amount: '4200.00' },
      { name: 'Utilities', amount: '3000.00' },
      { name: 'Insurance', amount: '2400.00' },
      { name: 'Fun', amount: '1800.00' },
      { name: 'Fitness', amount: '1200.00' },
    ],
    other_spend: '1400.00',
    total_spend: '44000.00',
    saved: '76000.00',
    ...over,
  }
}

// Option readers (spendingSankeyOptions.test.ts posture).
interface NodeLike {
  name?: string
  value?: number
  depth?: number
  itemStyle?: { color?: string }
}
interface LinkLike {
  source?: string
  target?: string
  value?: number
}
interface SankeyLike {
  type?: string
  nodeWidth?: number
  layoutIterations?: number
  data?: NodeLike[]
  links?: LinkLike[]
}
function sankeyOf(option: EChartsOption): SankeyLike {
  return (option as unknown as { series: SankeyLike[] }).series[0]
}
function tooltipOf(option: EChartsOption): (params: unknown) => string {
  return (option as unknown as { tooltip: { formatter: (params: unknown) => string } })
    .tooltip.formatter
}

describe('moneyFlowOption — the four pinned columns', () => {
  it('emits sources, gross, the mid four and the spend fan in data order with pinned depths', () => {
    const option = moneyFlowOption(flowOut())
    expect(option).not.toBeNull()
    const series = sankeyOf(option!)
    // The shared mark spec rides every option (charts/sankey.ts owns the numbers).
    expect(series.type).toBe('sankey')
    expect(series.nodeWidth).toBe(12)
    expect(series.layoutIterations).toBe(0)
    expect(series.data?.map((n) => n.name)).toEqual([
      'Salary & bonus',
      'RSU vests',
      'ESPP',
      'Investment income',
      'Other income',
      'Gross income',
      'Taxes',
      'Pre-tax savings',
      'Retained equity & other',
      'Take-home cash',
      'Rent',
      'Food',
      'Travel',
      'Utilities',
      'Insurance',
      'Fun',
      'Fitness',
      'Other',
      'Saved',
    ])
    expect(series.data?.map((n) => n.depth)).toEqual([
      0, 0, 0, 0, 0, 1, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3,
    ])
    expect(series.data?.map((n) => n.itemStyle?.color)).toEqual([
      PALETTE[0],
      PALETTE[1],
      PALETTE[2],
      PALETTE[3],
      PALETTE[4], // fixed source slots
      MUTED, // Gross restates money in transit (paycheck's intermediate vocabulary)
      PALETTE[7],
      PALETTE[5],
      PALETTE[6], // Taxes / Pre-tax / Retained fixed slots
      MUTED, // Take-home: the second intermediate
      PALETTE[0],
      PALETTE[1],
      PALETTE[2],
      PALETTE[3],
      PALETTE[4],
      PALETTE[5],
      PALETTE[6],
      OTHER_SERIES_COLOR, // the folded remainder wears the gray Other color
      POSITIVE, // Saved: the kept-money-is-green cross-chart convention
    ])
  })

  it('carries every link at its server figure and conserves the take-home fan', () => {
    const series = sankeyOf(moneyFlowOption(flowOut())!)
    expect(series.links).toEqual([
      { source: 'Salary & bonus', target: 'Gross income', value: 220000 },
      { source: 'RSU vests', target: 'Gross income', value: 80000 },
      { source: 'ESPP', target: 'Gross income', value: 4000 },
      { source: 'Investment income', target: 'Gross income', value: 2500 },
      { source: 'Other income', target: 'Gross income', value: 1000 },
      { source: 'Gross income', target: 'Taxes', value: 67016.05 },
      { source: 'Gross income', target: 'Pre-tax savings', value: 27300 },
      { source: 'Gross income', target: 'Retained equity & other', value: 93183.95 },
      { source: 'Gross income', target: 'Take-home cash', value: 120000 },
      { source: 'Take-home cash', target: 'Rent', value: 24000 },
      { source: 'Take-home cash', target: 'Food', value: 6000 },
      { source: 'Take-home cash', target: 'Travel', value: 4200 },
      { source: 'Take-home cash', target: 'Utilities', value: 3000 },
      { source: 'Take-home cash', target: 'Insurance', value: 2400 },
      { source: 'Take-home cash', target: 'Fun', value: 1800 },
      { source: 'Take-home cash', target: 'Fitness', value: 1200 },
      { source: 'Take-home cash', target: 'Other', value: 1400 },
      { source: 'Take-home cash', target: 'Saved', value: 76000 },
    ])
  })

  it('omits a zero source without reshuffling its neighbours', () => {
    // espp zeroed, the freed 4000 moved into other_income — conservation intact.
    const series = sankeyOf(
      moneyFlowOption(
        flowOut({
          sources: {
            salary_and_bonus: '220000.00',
            rsu_vests: '80000.00',
            espp: '0.00',
            investment_income: '2500.00',
            other_income: '5000.00',
          },
        }),
      )!,
    )
    const names = series.data?.map((n) => n.name)
    expect(names).not.toContain('ESPP')
    const byName = new Map(series.data?.map((n) => [n.name, n.itemStyle?.color]))
    expect(byName.get('RSU vests')).toBe(PALETTE[1]) // fixed per ENTITY, not per index
    expect(byName.get('Investment income')).toBe(PALETTE[3])
  })

  it('draws a deficit as a red Drawdown source splitting each category pro-rata', () => {
    const option = moneyFlowOption(
      flowOut({
        take_home_cash: '22000.00',
        retained_equity: '191183.95',
        saved: '-22000.00',
      }),
    )
    const series = sankeyOf(option!)
    const drawdown = series.data?.find((n) => n.name === 'Drawdown')
    expect(drawdown).toEqual({
      name: 'Drawdown',
      value: 22000,
      depth: 2,
      itemStyle: { color: NEGATIVE },
    })
    expect(series.data?.map((n) => n.name)).not.toContain('Saved')
    // 22000 take-home over 44000 spend: exactly half of every category from each source.
    expect(series.links).toContainEqual({
      source: 'Take-home cash',
      target: 'Rent',
      value: 12000,
    })
    expect(series.links).toContainEqual({ source: 'Drawdown', target: 'Rent', value: 12000 })
    expect(series.links).toContainEqual({
      source: 'Take-home cash',
      target: 'Other',
      value: 700,
    })
    expect(series.links).toContainEqual({ source: 'Drawdown', target: 'Other', value: 700 })
  })

  it('refuses a non-renderable payload and backstops a negative figure', () => {
    expect(moneyFlowOption(flowOut({ renderable: false, reason: 'nope' }))).toBeNull()
    // The server refuses negatives itself; a payload that slipped through must not draw.
    expect(moneyFlowOption(flowOut({ retained_equity: '-0.01' }))).toBeNull()
  })

  it('refuses a category named after an upstream node rather than emitting a cycle', () => {
    // 'Gross income' as a category would add Take-home cash → Gross income on top of the
    // Gross income → Take-home cash the builder always emits. echarts throws on a non-DAG
    // from inside setOption, which would blank the whole route; the card's own
    // "nothing to draw" note is the honest, isolated outcome.
    expect(
      moneyFlowOption(
        flowOut({
          categories: [{ name: 'Gross income', amount: '24000.00' }],
          other_spend: null,
          total_spend: '24000.00',
          saved: '96000.00',
        }),
      ),
    ).toBeNull()
    // A source label loops the same way, through Gross income.
    expect(
      moneyFlowOption(
        flowOut({
          categories: [{ name: 'RSU vests', amount: '24000.00' }],
          other_spend: null,
          total_spend: '24000.00',
          saved: '96000.00',
        }),
      ),
    ).toBeNull()
    // Same-column names are NOT reserved: 'Taxes' merges (the /spending posture) and the
    // chart still draws.
    expect(
      moneyFlowOption(
        flowOut({
          categories: [{ name: 'Taxes', amount: '24000.00' }],
          other_spend: null,
          total_spend: '24000.00',
          saved: '96000.00',
        }),
      ),
    ).not.toBeNull()
  })

  it('lists the six jurisdictions on the Taxes node and delegates everything else', () => {
    const format = tooltipOf(moneyFlowOption(flowOut())!)
    const taxes = format({ dataType: 'node', name: 'Taxes' })
    expect(taxes).toContain('<strong>$67,016.05</strong>')
    expect(taxes).toContain('Federal $26,520.00')
    expect(taxes).toContain('State $14,225.00')
    expect(taxes).toContain('Medicare $4,345.65')
    expect(taxes).toContain('Social Security $18,581.40')
    expect(taxes).toContain('Disability $3,344.00')
    expect(taxes).toContain('Capital gains $0.00')
    // Every other node/edge reads the shared factory's server-figure echo.
    expect(format({ dataType: 'node', name: 'Rent' })).toContain('$24,000.00')
    expect(
      format({ dataType: 'edge', data: { source: 'Take-home cash', target: 'Saved' } }),
    ).toContain('$76,000.00')
  })
})
