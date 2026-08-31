import { describe, expect, it } from 'vitest'
import type { EChartsOption } from '../../charts/echarts'
import {
  MUTED,
  NEGATIVE,
  OTHER_SERIES_COLOR,
  PALETTE,
  POSITIVE,
  SEQUENTIAL_BLUE,
} from '../../charts/theme'
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
      salary_people: [],
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
      niit: '123.45',
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
            salary_people: [],
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

  it('renames colliding categories — a duplicate node name is a CRASH, not a merge', () => {
    // echarts sankey keys nodes on NAME. A user category spelling one of the chart's own
    // nodes is not a benign merge: echarts 6 drops the duplicate node ("Graph nodes have
    // duplicate name or id") and then crashes wiring its links (TypeError: Cannot set
    // properties of undefined (setting 'dataIndex')) inside setOption, where the route
    // boundary blanks the WHOLE Overview — the 2026-08-25 prod incident, triggered by the
    // user's real 'Taxes' spending category. Upstream names ('Gross income', a source
    // label) would additionally close a cycle. Both die at the source: colliding
    // categories wear a visible ' (spending)' suffix and everything still draws.
    const option = moneyFlowOption(
      flowOut({
        categories: [
          { name: 'Taxes', amount: '24000.00' },
          { name: 'Gross income', amount: '6000.00' },
          { name: 'RSU vests', amount: '4200.00' },
        ],
        other_spend: null,
        total_spend: '34200.00',
        saved: '85800.00',
      }),
    )
    expect(option).not.toBeNull()
    const series = sankeyOf(option!)
    const names = (series.data ?? []).map((n) => n.name)
    expect(new Set(names).size).toBe(names.length) // the invariant that keeps echarts alive
    expect(names.filter((name) => name === 'Taxes')).toHaveLength(1) // the structural node
    expect(names).toContain('Taxes (spending)')
    expect(names).toContain('Gross income (spending)')
    expect(names).toContain('RSU vests (spending)')
    expect(series.links).toContainEqual({
      source: 'Take-home cash',
      target: 'Taxes (spending)',
      value: 24000,
    })
    // The jurisdiction tooltip stays pinned to the STRUCTURAL Taxes node alone.
    const format = tooltipOf(option!)
    expect(format({ dataType: 'node', name: 'Taxes' })).toContain('Federal')
    expect(format({ dataType: 'node', name: 'Taxes (spending)' })).not.toContain('Federal')
  })

  it('keeps a real category named Other distinct from the fold node', () => {
    const option = moneyFlowOption(
      flowOut({
        categories: [{ name: 'Other', amount: '24000.00' }],
        other_spend: '1000.00',
        total_spend: '25000.00',
        saved: '95000.00',
      }),
    )
    expect(option).not.toBeNull()
    const names = (sankeyOf(option!).data ?? []).map((n) => n.name)
    expect(new Set(names).size).toBe(names.length)
    // Emission order claims first: the REAL category keeps its name, the fold renames.
    expect(names).toContain('Other')
    expect(names).toContain('Other (spending)')
  })

  it('lists the seven jurisdictions on the Taxes node and delegates everything else', () => {
    const format = tooltipOf(moneyFlowOption(flowOut())!)
    const taxes = format({ dataType: 'node', name: 'Taxes' })
    expect(taxes).toContain('<strong>$67,016.05</strong>')
    expect(taxes).toContain('Federal $26,520.00')
    expect(taxes).toContain('State $14,225.00')
    expect(taxes).toContain('Medicare $4,345.65')
    expect(taxes).toContain('Social Security $18,581.40')
    expect(taxes).toContain('Disability $3,344.00')
    expect(taxes).toContain('Capital gains $0.00')
    // The NIIT split (2026-08-31): without its own line the enumeration under-sums the
    // total it sits beneath on every year the surcharge applies.
    expect(taxes).toContain('NIIT $123.45')
    // Every other node/edge reads the shared factory's server-figure echo.
    expect(format({ dataType: 'node', name: 'Rent' })).toContain('$24,000.00')
    expect(
      format({ dataType: 'edge', data: { source: 'Take-home cash', target: 'Saved' } }),
    ).toContain('$76,000.00')
  })

  it('stays silent about NIIT on a payload that predates the field', () => {
    // Stored/older payloads carry six keys. An absent value must not draw "NIIT $NaN" or
    // an empty row — the line is simply not there.
    const format = tooltipOf(
      moneyFlowOption(
        flowOut({
          taxes: {
            total: '66892.60',
            federal: '26520.00',
            state: '14225.00',
            medicare: '4345.65',
            social_security: '18581.40',
            disability: '3344.00',
            capital_gains: '0.00',
          },
        }),
      )!,
    )
    const taxes = format({ dataType: 'node', name: 'Taxes' })
    expect(taxes).toContain('Capital gains $0.00')
    expect(taxes).not.toContain('NIIT')
  })
  it('splits the salary node per earner, sharing the salary hue family', () => {
    const series = sankeyOf(
      moneyFlowOption(
        flowOut({
          sources: {
            salary_and_bonus: '220000.00',
            rsu_vests: '80000.00',
            espp: '4000.00',
            investment_income: '2500.00',
            other_income: '1000.00',
            salary_people: [
              { name: 'Me', amount: '132000.00' },
              { name: 'Sam', amount: '88000.00' },
            ],
          },
        }),
      )!,
    )
    const names = series.data?.map((n) => n.name)
    expect(names?.slice(0, 6)).toEqual([
      'Salary — Me',
      'Salary — Sam',
      'RSU vests',
      'ESPP',
      'Investment income',
      'Other income',
    ])
    expect(names).not.toContain('Salary & bonus')
    const byName = new Map(series.data?.map((n) => [n.name, n.itemStyle?.color]))
    // The primary keeps the card's own salary color; the partner takes a lightness step
    // of the theme's validated blue ramp (index 6 of which IS PALETTE[0]).
    expect(byName.get('Salary — Me')).toBe(PALETTE[0])
    expect(byName.get('Salary — Sam')).toBe(SEQUENTIAL_BLUE[9])
    // The neighbours keep their fixed ENTITY slots — a split never reshuffles hues.
    expect(byName.get('RSU vests')).toBe(PALETTE[1])
    expect(byName.get('Other income')).toBe(PALETTE[4])
    // Both nodes feed Gross at their own figure; the column still sums to 307500.
    expect(series.links?.slice(0, 2)).toEqual([
      { source: 'Salary — Me', target: 'Gross income', value: 132000 },
      { source: 'Salary — Sam', target: 'Gross income', value: 88000 },
    ])
  })

  it('claims the split node names so a same-named category cannot duplicate one', () => {
    // The 2026-08-25 Overview crash, one door further in: echarts keys nodes on NAME, and
    // a spending category spelled exactly like a salary node would drop it and then throw
    // inside setOption.
    const series = sankeyOf(
      moneyFlowOption(
        flowOut({
          sources: {
            salary_and_bonus: '220000.00',
            rsu_vests: '80000.00',
            espp: '4000.00',
            investment_income: '2500.00',
            other_income: '1000.00',
            salary_people: [
              { name: 'Me', amount: '132000.00' },
              { name: 'Sam', amount: '88000.00' },
            ],
          },
          categories: [
            { name: 'Salary — Sam', amount: '24000.00' },
            { name: 'Food', amount: '6000.00' },
          ],
          other_spend: null,
          total_spend: '30000.00',
          saved: '90000.00',
        }),
      )!,
    )
    const names = series.data?.map((n) => n.name) ?? []
    expect(names).toContain('Salary — Sam')
    expect(names).toContain('Salary — Sam (spending)')
    expect(new Set(names).size).toBe(names.length)
  })

  it('draws ONE salary node when the split is empty', () => {
    // The byte-identity pin — the default fixture already asserts the full node list, and
    // this restates the contract at the seam that could break it.
    const series = sankeyOf(moneyFlowOption(flowOut())!)
    expect(series.data?.[0]).toMatchObject({
      name: 'Salary & bonus',
      value: 220000,
      depth: 0,
      itemStyle: { color: PALETTE[0] },
    })
  })
})
