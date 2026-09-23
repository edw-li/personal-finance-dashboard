import { describe, expect, it } from 'vitest'
import type { EChartsOption } from '../../charts/echarts'
import { CATEGORY_HUES, ENTITY, SALARY_TINTS } from '../../charts/entities'
import type { CategoryFold } from '../../charts/entities'
import { DEFICIT_DECAL } from '../../charts/grammar'
import { NORMAL_VISION_FLOOR, deltaEBothThemes, distinguishable } from '../../testing/perceptual'
import { MUTED, NEGATIVE, OTHER_SERIES_COLOR, PALETTE, POSITIVE, SEQUENTIAL_BLUE } from '../../charts/theme'
import type { MoneyFlowCategoryTotal, MoneyFlowOut } from '../../types/api'
import {
  estimateNodeName,
  estimateSentence,
  monthRuns,
  moneyFlowCsv,
  moneyFlowOption,
  runWords,
} from './moneyFlowOptions'

// Nine categories over a fully matched year. FIXTURE figures shaped like the server's (the
// engine truth is pinned backend-side): sources sum to gross, the mid column sums back to
// gross, and take_home_matched + refunds − total_spend == saved.
const TOTALS: MoneyFlowCategoryTotal[] = [
  { category_id: 1, name: 'Rent', kind: 'living', amount: '24000.00' },
  { category_id: 2, name: 'Food', kind: 'living', amount: '6000.00' },
  { category_id: 3, name: 'Travel', kind: 'living', amount: '4200.00' },
  { category_id: 4, name: 'Utilities', kind: 'living', amount: '3000.00' },
  { category_id: 5, name: 'Insurance', kind: 'living', amount: '2400.00' },
  { category_id: 6, name: 'Fun', kind: 'living', amount: '1800.00' },
  { category_id: 7, name: 'Fitness', kind: 'living', amount: '1200.00' },
  { category_id: 8, name: 'Gifts', kind: 'living', amount: '900.00' },
  { category_id: 9, name: 'Misc', kind: 'living', amount: '500.00' },
]
const YEAR = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}-01`)

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
    take_home_pending: '0.00',
    take_home_months_entered: 12,
    retained_equity: '93183.95',
    categories: [],
    other_spend: null,
    total_spend: '44000.00',
    saved: '76000.00',
    take_home_matched: '120000.00',
    refunds: '0.00',
    matched_months: YEAR,
    take_home_pending_months: [],
    take_home_unmatched: '0.00',
    take_home_unmatched_months: [],
    spending_unmatched_months: [],
    spending_unmatched_total: '0.00',
    category_totals: TOTALS,
    tracking_start: '2023-08-01',
    ...over,
  }
}

/** The Spending page's fold (charts/entities.ts): the all-time top five on the chain. */
const FOLD: CategoryFold = {
  ids: [1, 2, 3, 4, 5],
  colors: new Map([1, 2, 3, 4, 5].map((id, i) => [id, CATEGORY_HUES[i]])),
}

// Option readers (spendingSankeyOptions.test.ts posture).
interface NodeLike {
  name?: string
  value?: number
  depth?: number
  itemStyle?: { color?: string; borderColor?: string; borderWidth?: number; borderType?: string }
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
const draw = (flow: MoneyFlowOut, fold: CategoryFold | null = FOLD, todayIso = '2026-09-23') =>
  sankeyOf(moneyFlowOption(flow, { fold, todayIso })!)
/** A node as a reader sees it (testing/perceptual): its colour and any texture. */
const markOf = (node: NodeLike) => ({ color: node.itemStyle?.color ?? '', decal: (node.itemStyle as { decal?: unknown } | undefined)?.decal })
const colorOf = (series: SankeyLike, name: string) =>
  series.data?.find((n) => n.name === name)?.itemStyle?.color
const sumLinks = (series: SankeyLike, pick: (link: LinkLike) => boolean) =>
  Math.round((series.links ?? []).filter(pick).reduce((acc, l) => acc + (l.value ?? 0), 0) * 100) / 100

describe('moneyFlowOption — the four pinned columns', () => {
  it('emits sources, gross, the middle column and the spend fan in data order with pinned depths', () => {
    const option = moneyFlowOption(flowOut(), { fold: FOLD })
    expect(option).not.toBeNull()
    const series = sankeyOf(option!)
    // The shared mark spec rides every option (charts/sankey.ts owns the numbers).
    expect(series.type).toBe('sankey')
    expect(series.nodeWidth).toBe(12)
    expect(series.layoutIterations).toBe(0)
    expect(series.data?.map((n) => [n.name, n.depth])).toEqual([
      ['Salary & bonus', 0],
      ['RSU vests', 0],
      ['ESPP', 0],
      ['Investment income', 0],
      ['Other income', 0],
      ['Gross income', 1],
      ['Taxes', 2],
      ['Pre-tax savings', 2],
      ['Retained equity & other', 2],
      ['Take-home cash', 2],
      // The Spending page's fold, in ITS order and colours — not this year's own ranking.
      ['Rent', 3],
      ['Food', 3],
      ['Travel', 3],
      ['Utilities', 3],
      ['Insurance', 3],
      ['Other', 3],
      ['Saved', 3],
    ])
  })

  it('wears the entity registry: income hues, the tax hue, kept greens, structural grey (spec §C2)', () => {
    const series = draw(flowOut())
    expect(series.data?.map((n) => n.itemStyle?.color)).toEqual([
      ENTITY.salary,
      ENTITY.rsu,
      ENTITY.espp,
      ENTITY.investmentIncome,
      ENTITY.otherIncome, // the balancing remainder of income: the Other grey
      ENTITY.structural, // Gross restates money in transit
      ENTITY.tax,
      ENTITY.preTaxSavings,
      ENTITY.structural, // Retained equity is the RESIDUAL, not an entity — grey (was PALETTE[6])
      ENTITY.structural, // Take-home: money still in transit toward the fan
      ...CATEGORY_HUES,
      OTHER_SERIES_COLOR,
      POSITIVE, // Saved: kept money is green
    ])
    // The two collisions the audit found inside this one chart are gone: no category shares
    // the pre-tax green or the residual's hue.
    expect(colorOf(series, 'Pre-tax savings')).toBe(PALETTE[5])
    expect(CATEGORY_HUES).not.toContain(PALETTE[5])
  })

  it('never lets two entities share a colour within a column or across linked columns', () => {
    const series = draw(
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
        category_totals: [...TOTALS, { category_id: 10, name: 'Taxes', kind: 'tax', amount: '500.00' }],
        total_spend: '44500.00',
        saved: '75500.00',
      }),
      { ids: [10, 1, 2, 3, 4, 5], colors: new Map([[10, ENTITY.tax], ...[1, 2, 3, 4, 5].map((id, i) => [id, CATEGORY_HUES[i]] as [number, string])]) },
    )
    const column = (depth: number) =>
      (series.data ?? []).filter((n) => n.depth === depth).map((n) => n.itemStyle?.color ?? '')
    // The greys are sanctioned repeats: the structural grey (gross, take-home, residual,
    // estimates) and the Other grey (folds and the balancing income remainder).
    const hues = (colors: string[]) => colors.filter((c) => c !== MUTED && c !== OTHER_SERIES_COLOR)
    for (const depth of [0, 1, 2, 3]) {
      const own = hues(column(depth))
      expect(new Set(own).size, `column ${depth}`).toBe(own.length)
    }
    // Linked neighbours: the only shared hue between the middle column and the fan is the
    // ONE tax hue (spec §C2.3 — the liability node and the tax-kind category are one entity
    // family); everything else is disjoint.
    const middle = new Set(hues(column(2)))
    const shared = hues(column(3)).filter((c) => middle.has(c))
    expect(shared).toEqual([ENTITY.tax])
    expect(colorOf(series, 'Taxes (spending)')).toBe(ENTITY.tax)
    // The documented exemption (charts/entities.ts): the income column and the fan are never
    // adjacent and never linked, and eleven identities do not fit eight validated hues.
    expect(column(0)).toContain(CATEGORY_HUES[0])
    // Perceptually (2026-09-23 review): hex identity passes two different hexes that read as
    // one. Neighbours in a column clear the normal-vision floor in BOTH themes; the sanctioned
    // repeats stay exempt (the greys, the per-earner salary tints).
    const greys = new Set([MUTED, OTHER_SERIES_COLOR])
    const tints = SALARY_TINTS as readonly string[]
    for (const depth of [0, 1, 2, 3]) {
      const nodes = (series.data ?? []).filter((n) => n.depth === depth)
      for (let i = 0; i + 1 < nodes.length; i += 1) {
        const [a, b] = [nodes[i], nodes[i + 1]]
        const [ca, cb] = [a.itemStyle?.color ?? '', b.itemStyle?.color ?? '']
        if ((greys.has(ca) && greys.has(cb)) || (tints.includes(ca) && tints.includes(cb))) continue
        expect(distinguishable(markOf(a), markOf(b)), `${a.name} / ${b.name}`).toBe(true)
      }
    }
  })

  // 2026-09-23 review: the deficit red is 2.5 (light) / 4.4 (dark) from the tax hue and under
  // the floor from PALETTE[1] and [4] too, and a deficit year draws them all at once. The
  // texture is what keeps Drawdown from reading as Taxes.
  it('keeps Drawdown apart from every other node: textured where its colour alone is under the floor', () => {
    const series = draw(
      flowOut({
        take_home_cash: '22000.00',
        take_home_matched: '22000.00',
        retained_equity: '191183.95',
        category_totals: [...TOTALS, { category_id: 10, name: 'Taxes', kind: 'tax', amount: '500.00' }],
        total_spend: '44500.00',
        saved: '-22500.00',
      }),
      { ids: [10, 1, 2, 3, 4, 5], colors: new Map([[10, ENTITY.tax], ...[1, 2, 3, 4, 5].map((id, i) => [id, CATEGORY_HUES[i]] as [number, string])]) },
    )
    const tax = deltaEBothThemes(ENTITY.tax, ENTITY.deficit)
    expect(Math.min(tax.dark, tax.light)).toBeLessThan(NORMAL_VISION_FLOOR) // colour alone fails
    const drawdown = series.data!.find((n) => n.name === 'Drawdown')!
    for (const node of series.data ?? []) {
      if (node === drawdown) continue
      expect(distinguishable(markOf(drawdown), markOf(node)), node.name).toBe(true)
    }
  })

  it('keeps each category on its fold colour whatever this year ranks it (stability)', () => {
    // Food is the all-time leader in this fold; Rent leads THIS year. Food still wears the
    // first hue and leads the fan — the year's own ranking never recolours anything.
    const fold: CategoryFold = { ids: [2, 1], colors: new Map([[2, CATEGORY_HUES[0]], [1, CATEGORY_HUES[1]]]) }
    const series = draw(flowOut(), fold)
    const fan = (series.data ?? []).filter((n) => n.depth === 3).map((n) => [n.name, n.itemStyle?.color])
    expect(fan.slice(0, 3)).toEqual([
      ['Food', CATEGORY_HUES[0]],
      ['Rent', CATEGORY_HUES[1]],
      ['Other', OTHER_SERIES_COLOR],
    ])
    // Everything outside the fold lands in Other, at its server figures.
    expect(series.data?.find((n) => n.name === 'Other')?.value).toBe(14000)
  })

  it('carries every link at its server figure and conserves the take-home fan', () => {
    const series = draw(flowOut())
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
      { source: 'Take-home cash', target: 'Other', value: 4400 },
      { source: 'Take-home cash', target: 'Saved', value: 76000 },
    ])
  })

  it('omits a zero source without reshuffling its neighbours', () => {
    // espp zeroed, the freed 4000 moved into other_income — conservation intact.
    const series = draw(
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
    )
    expect(series.data?.map((n) => n.name)).not.toContain('ESPP')
    expect(colorOf(series, 'RSU vests')).toBe(ENTITY.rsu) // fixed per ENTITY, not per index
    expect(colorOf(series, 'Investment income')).toBe(ENTITY.investmentIncome)
  })

  it('draws a deficit as a red Drawdown source splitting each category pro-rata', () => {
    const series = draw(
      flowOut({ take_home_cash: '22000.00', take_home_matched: '22000.00', retained_equity: '191183.95', saved: '-22000.00' }),
    )
    const drawdown = series.data?.find((n) => n.name === 'Drawdown')
    expect(drawdown).toEqual({ name: 'Drawdown', value: 22000, depth: 2, itemStyle: { color: NEGATIVE, decal: DEFICIT_DECAL } })
    expect(series.data?.map((n) => n.name)).not.toContain('Saved')
    // 22000 take-home over 44000 spend: exactly half of every category from each source.
    expect(series.links).toContainEqual({ source: 'Take-home cash', target: 'Rent', value: 12000 })
    expect(series.links).toContainEqual({ source: 'Drawdown', target: 'Rent', value: 12000 })
    expect(series.links).toContainEqual({ source: 'Take-home cash', target: 'Other', value: 2200 })
    expect(series.links).toContainEqual({ source: 'Drawdown', target: 'Other', value: 2200 })
  })

  it('refuses a non-renderable payload and backstops a negative figure', () => {
    expect(moneyFlowOption(flowOut({ renderable: false, reason: 'nope' }))).toBeNull()
    // The server refuses negatives itself; a payload that slipped through must not draw.
    expect(moneyFlowOption(flowOut({ retained_equity: '-0.01' }))).toBeNull()
    expect(moneyFlowOption(flowOut({ take_home_unmatched: '-1.00' }))).toBeNull()
    expect(moneyFlowOption(flowOut({ refunds: '-1.00' }))).toBeNull()
    // Matched take-home that cannot fund what it says was saved is a torn payload.
    expect(moneyFlowOption(flowOut({ take_home_matched: '1000.00', saved: '76000.00' }))).toBeNull()
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
    const totals: MoneyFlowCategoryTotal[] = [
      { category_id: 1, name: 'Taxes', kind: 'tax', amount: '24000.00' },
      { category_id: 2, name: 'Gross income', kind: 'living', amount: '6000.00' },
      { category_id: 3, name: 'RSU vests', kind: 'living', amount: '4200.00' },
    ]
    const option = moneyFlowOption(
      flowOut({ category_totals: totals, total_spend: '34200.00', saved: '85800.00' }),
      { fold: null },
    )
    expect(option).not.toBeNull()
    const series = sankeyOf(option!)
    const names = (series.data ?? []).map((n) => n.name)
    expect(new Set(names).size).toBe(names.length) // the invariant that keeps echarts alive
    expect(names.filter((name) => name === 'Taxes')).toHaveLength(1) // the structural node
    expect(names).toContain('Taxes (spending)')
    expect(names).toContain('Gross income (spending)')
    expect(names).toContain('RSU vests (spending)')
    expect(series.links).toContainEqual({ source: 'Take-home cash', target: 'Taxes (spending)', value: 24000 })
    // The jurisdiction tooltip stays pinned to the STRUCTURAL Taxes node alone.
    const format = tooltipOf(option!)
    expect(format({ dataType: 'node', name: 'Taxes' })).toContain('Federal')
    expect(format({ dataType: 'node', name: 'Taxes (spending)' })).not.toContain('Federal')
  })

  it('keeps a real category named Other distinct from the fold node', () => {
    const totals: MoneyFlowCategoryTotal[] = [
      { category_id: 1, name: 'Other', kind: 'living', amount: '24000.00' },
      { category_id: 2, name: 'Tiny', kind: 'living', amount: '1000.00' },
    ]
    const fold: CategoryFold = { ids: [1], colors: new Map([[1, CATEGORY_HUES[0]]]) }
    const option = moneyFlowOption(flowOut({ category_totals: totals, total_spend: '25000.00', saved: '95000.00' }), { fold })
    const names = (sankeyOf(option!).data ?? []).map((n) => n.name)
    expect(new Set(names).size).toBe(names.length)
    // Emission order claims first: the REAL category keeps its name, the fold renames.
    expect(names).toContain('Other')
    expect(names).toContain('Other (spending)')
  })

  it('lists the seven jurisdictions on the Taxes node and delegates everything else', () => {
    const format = tooltipOf(moneyFlowOption(flowOut(), { fold: FOLD })!)
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
    expect(format({ dataType: 'edge', data: { source: 'Take-home cash', target: 'Saved' } })).toContain('$76,000.00')
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
        { fold: FOLD },
      )!,
    )
    const taxes = format({ dataType: 'node', name: 'Taxes' })
    expect(taxes).toContain('Capital gains $0.00')
    expect(taxes).not.toContain('NIIT')
  })

  it('splits the salary node per earner, sharing the salary hue family', () => {
    const series = draw(
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
    )
    const names = series.data?.map((n) => n.name)
    expect(names?.slice(0, 6)).toEqual(['Salary — Me', 'Salary — Sam', 'RSU vests', 'ESPP', 'Investment income', 'Other income'])
    expect(names).not.toContain('Salary & bonus')
    // The primary keeps the salary hue; the partner takes a lightness step of the theme's
    // validated blue ramp (index 6 of which IS PALETTE[0]).
    expect(colorOf(series, 'Salary — Me')).toBe(SALARY_TINTS[0])
    expect(colorOf(series, 'Salary — Sam')).toBe(SEQUENTIAL_BLUE[9])
    // The neighbours keep their fixed ENTITY colours — a split never reshuffles hues.
    expect(colorOf(series, 'RSU vests')).toBe(ENTITY.rsu)
    expect(colorOf(series, 'Other income')).toBe(ENTITY.otherIncome)
    expect(series.links?.slice(0, 2)).toEqual([
      { source: 'Salary — Me', target: 'Gross income', value: 132000 },
      { source: 'Salary — Sam', target: 'Gross income', value: 88000 },
    ])
  })

  it('claims the split node names so a same-named category cannot duplicate one', () => {
    // The 2026-08-25 Overview crash, one door further in: echarts keys nodes on NAME, and
    // a spending category spelled exactly like a salary node would drop it and then throw
    // inside setOption.
    const series = draw(
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
        category_totals: [
          { category_id: 1, name: 'Salary — Sam', kind: 'living', amount: '24000.00' },
          { category_id: 2, name: 'Food', kind: 'living', amount: '6000.00' },
        ],
        total_spend: '30000.00',
        saved: '90000.00',
      }),
    )
    const names = series.data?.map((n) => n.name) ?? []
    expect(names).toContain('Salary — Sam')
    expect(names).toContain('Salary — Sam (spending)')
    expect(new Set(names).size).toBe(names.length)
  })

  it('draws ONE salary node when the split is empty', () => {
    const series = draw(flowOut())
    expect(series.data?.[0]).toMatchObject({ name: 'Salary & bonus', value: 220000, depth: 0, itemStyle: { color: PALETTE[0] } })
  })
})

// 2026-09-23 spec §C1: the fan and Saved cover the MATCHED months only.
describe('moneyFlowOption — one window on the right', () => {
  // Production's 2026 shape: take-home and spending entered Jan–Aug, September's rent-only
  // spending waiting for its take-home, the Sep–Dec take-home estimated.
  const partial = () =>
    flowOut({
      take_home_cash: '52000.00',
      take_home_matched: '52000.00',
      take_home_pending: '26000.00',
      take_home_months_entered: 8,
      retained_equity: '135183.95',
      matched_months: YEAR.slice(0, 8),
      take_home_pending_months: YEAR.slice(8),
      spending_unmatched_months: ['2026-09-01'],
      spending_unmatched_total: '2072.23',
      category_totals: [
        { category_id: 1, name: 'Rent', kind: 'living', amount: '16000.00' },
        { category_id: 10, name: 'Taxes', kind: 'tax', amount: '800.00' },
      ],
      total_spend: '16800.00',
      saved: '35200.00',
    })

  it('saves exactly the payload figure — the YTD card’s — and conserves take-home to the cent', () => {
    const series = draw(partial())
    expect(series.data?.find((n) => n.name === 'Saved')?.value).toBe(35200)
    const out = sumLinks(series, (l) => l.source === 'Take-home cash')
    expect(out).toBe(52000)
  })

  it('names the estimate by its months: not yet earned, and before tracking', () => {
    const series = draw(partial())
    const estimate = series.data?.find((n) => n.name?.startsWith('Est. take-home'))
    expect(estimate?.name).toBe('Est. take-home, Sep–Dec')
    expect(estimate?.value).toBe(26000)
    expect(estimate?.itemStyle).toEqual({ color: MUTED, borderColor: MUTED, borderWidth: 1, borderType: 'dashed' })
    // Straight off gross, and nothing flows OUT of it: an estimate is never "spent".
    expect(series.links?.filter((l) => l.target === estimate?.name)).toEqual([
      { source: 'Gross income', target: 'Est. take-home, Sep–Dec', value: 26000 },
    ])
    expect(series.links?.filter((l) => l.source === estimate?.name)).toEqual([])
    const first = draw(
      flowOut({
        year: 2023,
        take_home_cash: '30886.02',
        take_home_matched: '30886.02',
        take_home_pending: '43240.43',
        take_home_months_entered: 5,
        retained_equity: '139057.50',
        take_home_pending_months: ['2023-01-01', '2023-02-01', '2023-03-01', '2023-04-01', '2023-05-01', '2023-06-01', '2023-07-01'],
        matched_months: ['2023-08-01', '2023-09-01', '2023-10-01', '2023-11-01', '2023-12-01'],
        saved: '-13113.98',
      }),
    )
    expect(first.data?.some((n) => n.name === 'Est. take-home, Jan–Jul (before tracking)')).toBe(true)
  })

  it('explains the estimate in its tooltip: how it was computed and why the months are missing', () => {
    const option = moneyFlowOption(partial(), { fold: FOLD, todayIso: '2026-09-23' })!
    const text = tooltipOf(option)({ dataType: 'node', name: 'Est. take-home, Sep–Dec' })
    expect(text).toContain('$26,000.00')
    expect(text).toContain('the average take-home of the 8 entered months × 4')
    expect(text).toContain('Sep is still in progress')
    expect(text).toContain('Oct–Dec are not earned yet')
  })

  it('sends pay-without-spending to a named terminal instead of Saved', () => {
    const series = draw(
      flowOut({
        take_home_cash: '15100.00',
        take_home_matched: '5000.00',
        take_home_unmatched: '10100.00',
        take_home_unmatched_months: ['2026-02-01', '2026-03-01'],
        matched_months: ['2026-01-01'],
        category_totals: [{ category_id: 1, name: 'Rent', kind: 'living', amount: '2000.00' }],
        total_spend: '2000.00',
        saved: '3000.00',
      }),
    )
    const terminal = series.data?.find((n) => n.name === 'Take-home, spending not entered (Feb–Mar)')
    expect(terminal).toEqual({
      name: 'Take-home, spending not entered (Feb–Mar)',
      value: 10100,
      depth: 3,
      itemStyle: { color: MUTED },
    })
    expect(series.data?.find((n) => n.name === 'Saved')?.value).toBe(3000)
    expect(sumLinks(series, (l) => l.source === 'Take-home cash')).toBe(15100)
  })

  // Review nit (duplicate-name crash class): the terminal's name is claimed BEFORE the
  // categories, so a category spelled exactly like it wears the suffix instead of taking the
  // name and leaving two nodes called the same (echarts drops one, then crashes wiring links).
  it('claims the terminal name before the categories, so a same-named category wears the suffix', () => {
    const terminal = 'Take-home, spending not entered (Feb–Mar)'
    const series = draw(
      flowOut({
        take_home_cash: '15100.00',
        take_home_matched: '5000.00',
        take_home_unmatched: '10100.00',
        take_home_unmatched_months: ['2026-02-01', '2026-03-01'],
        matched_months: ['2026-01-01'],
        category_totals: [{ category_id: 1, name: terminal, kind: 'living', amount: '2000.00' }],
        total_spend: '2000.00',
        saved: '3000.00',
      }),
    )
    const names = (series.data ?? []).map((n) => n.name)
    expect(new Set(names).size).toBe(names.length)
    expect(series.data?.find((n) => n.name === terminal)).toMatchObject({ value: 10100, itemStyle: { color: MUTED } })
    expect(series.data?.find((n) => n.name === `${terminal} (spending)`)?.value).toBe(2000)
  })

  it('draws refunds as an explicit inflow so the fan conserves with Saved netted', () => {
    const series = draw(
      flowOut({
        take_home_cash: '52000.00',
        take_home_matched: '52000.00',
        refunds: '300.00',
        category_totals: [
          { category_id: 1, name: 'Rent', kind: 'living', amount: '16000.00' },
          { category_id: 9, name: 'Returns', kind: 'living', amount: '-300.00' },
        ],
        total_spend: '16000.00',
        saved: '36300.00',
      }),
    )
    expect(colorOf(series, 'Refunds & credits')).toBe(MUTED)
    expect(series.links).toContainEqual({ source: 'Refunds & credits', target: 'Rent', value: 300 })
    expect(series.links).toContainEqual({ source: 'Take-home cash', target: 'Rent', value: 15700 })
    // A net-refund category draws no node — its money is the inflow.
    expect(series.data?.some((n) => n.name === 'Returns')).toBe(false)
    expect(sumLinks(series, (l) => l.source === 'Take-home cash')).toBe(52000)
  })

  it('splits a deficit with refunds across all three sources, each category to the cent', () => {
    const series = draw(
      flowOut({
        take_home_cash: '10000.00',
        take_home_matched: '10000.00',
        retained_equity: '203183.95',
        refunds: '300.00',
        category_totals: [
          { category_id: 1, name: 'Rent', kind: 'living', amount: '16000.00' },
          { category_id: 9, name: 'Returns', kind: 'living', amount: '-300.00' },
        ],
        total_spend: '16000.00',
        saved: '-5700.00',
      }),
    )
    expect(series.links?.filter((l) => l.target === 'Rent')).toEqual([
      { source: 'Take-home cash', target: 'Rent', value: 10000 },
      { source: 'Refunds & credits', target: 'Rent', value: 300 },
      { source: 'Drawdown', target: 'Rent', value: 5700 },
    ])
  })

  // Review nit: slices rounded one by one can leave a source node a cent away from the sum of
  // its links. Non-divisible figures: 7 cents of refunds and $100.00 of drawdown across three
  // near-equal categories must still leave every node equal to its links, on both sides.
  it('splits the sources in whole cents so every node equals the sum of its links, both sides', () => {
    const series = draw(
      flowOut({
        take_home_cash: '199.94',
        take_home_matched: '199.94',
        retained_equity: '93183.95',
        refunds: '0.07',
        category_totals: [
          { category_id: 1, name: 'Rent', kind: 'living', amount: '100.00' },
          { category_id: 2, name: 'Food', kind: 'living', amount: '100.00' },
          { category_id: 3, name: 'Travel', kind: 'living', amount: '100.01' },
          { category_id: 9, name: 'Returns', kind: 'living', amount: '-0.07' },
        ],
        total_spend: '300.01',
        saved: '-100.00',
      }),
    )
    const cents = (value: number | undefined) => Math.round((value ?? 0) * 100)
    const node = (name: string) => cents(series.data?.find((n) => n.name === name)?.value)
    const out = (name: string) => (series.links ?? []).filter((l) => l.source === name).reduce((acc, l) => acc + cents(l.value), 0)
    const into = (name: string) => (series.links ?? []).filter((l) => l.target === name).reduce((acc, l) => acc + cents(l.value), 0)
    expect(out('Refunds & credits')).toBe(node('Refunds & credits'))
    expect(out('Drawdown')).toBe(node('Drawdown'))
    for (const category of ['Rent', 'Food', 'Travel']) expect(into(category), category).toBe(node(category))
    // Take-home also feeds nothing else in a deficit window, so its fan is exactly its value.
    expect(out('Take-home cash')).toBe(node('Take-home cash'))
    // Every link is a whole number of cents.
    for (const link of series.links ?? []) expect(Number.isInteger(Math.round((link.value ?? 0) * 1e6) / 1e4)).toBe(true)
  })

  it('folds by the payload’s own ranking when no Spending fold is at hand', () => {
    // A tax-kind category still takes the tax hue and leads; the others take the chain.
    const series = draw(partial(), null)
    expect((series.data ?? []).filter((n) => n.depth === 3).map((n) => [n.name, n.itemStyle?.color])).toEqual([
      ['Taxes (spending)', ENTITY.tax],
      ['Rent', CATEGORY_HUES[0]],
      ['Saved', POSITIVE],
    ])
  })

  it('still draws a payload from before the window (no category totals)', () => {
    const legacy = flowOut({
      category_totals: undefined,
      take_home_matched: undefined,
      refunds: undefined,
      categories: [
        { name: 'Rent', amount: '24000.00' },
        { name: 'Food', amount: '6000.00' },
      ],
      other_spend: '14000.00',
    })
    const series = draw(legacy, null)
    expect((series.data ?? []).filter((n) => n.depth === 3).map((n) => [n.name, n.value])).toEqual([
      ['Rent', 24000],
      ['Food', 6000],
      ['Other', 14000],
      ['Saved', 76000],
    ])
    expect(sumLinks(series, (l) => l.source === 'Take-home cash')).toBe(120000)
    // Code review 4: the page hands the Spending fold whenever the matrix has loaded, and its
    // ids cannot name a payload that carries no category ids — so a pre-window payload folds by
    // its own ranking even then, instead of pouring every category into Other.
    const withFold = draw(legacy, FOLD)
    expect((withFold.data ?? []).filter((n) => n.depth === 3).map((n) => [n.name, n.value, n.itemStyle?.color])).toEqual([
      ['Rent', 24000, CATEGORY_HUES[0]],
      ['Food', 6000, CATEGORY_HUES[1]],
      ['Other', 14000, ENTITY.other],
      ['Saved', 76000, POSITIVE],
    ])
  })
})

describe('the window’s words', () => {
  it('groups months into runs and says them inside one year', () => {
    expect(monthRuns(['2026-03-01', '2026-01-01', '2026-02-01', '2026-06-01'])).toEqual([
      ['2026-01-01', '2026-02-01', '2026-03-01'],
      ['2026-06-01'],
    ])
    expect(monthRuns([])).toEqual([])
    expect(runWords(['2026-09-01', '2026-10-01', '2026-11-01', '2026-12-01'])).toBe('Sep–Dec')
    expect(runWords(['2026-09-01'])).toBe('Sep')
  })

  it('names the estimate node by its runs, flagging the ones before tracking', () => {
    expect(estimateNodeName(YEAR.slice(8), '2023-08-01')).toBe('Est. take-home, Sep–Dec')
    expect(estimateNodeName(['2023-01-01', '2023-02-01', '2023-03-01'], '2023-08-01')).toBe(
      'Est. take-home, Jan–Mar (before tracking)',
    )
    expect(estimateNodeName(['2025-01-01', '2025-02-01', '2025-11-01', '2025-12-01'], '2025-03-01')).toBe(
      'Est. take-home, Jan–Feb (before tracking), Nov–Dec',
    )
    expect(estimateNodeName(['2026-06-01'], null)).toBe('Est. take-home, Jun')
  })

  it('says why each run is missing: before tracking, in progress, not earned, or not entered', () => {
    expect(estimateSentence(YEAR.slice(8), '2023-08-01', '2026-09-23')).toBe(
      'Sep is still in progress; Oct–Dec are not earned yet',
    )
    expect(estimateSentence(['2023-01-01', '2023-02-01'], '2023-08-01', '2026-09-23')).toBe(
      'Jan–Feb predate tracking (it began Aug 2023)',
    )
    // Code review 5: one month agrees in the singular.
    expect(estimateSentence(['2023-07-01'], '2023-08-01', '2026-09-23')).toBe('Jul predates tracking (it began Aug 2023)')
    expect(estimateSentence(['2026-03-01', '2026-06-01', '2026-07-01'], '2023-08-01', '2026-09-23')).toBe(
      'Mar has no take-home entered; Jun–Jul have no take-home entered',
    )
    // Without a clock nothing is called unearned — past or future, it is simply not entered.
    expect(estimateSentence(['2026-11-01'], '2023-08-01', null)).toBe('Nov has no take-home entered')
  })
})

describe('moneyFlowCsv (F12)', () => {
  it('exports nodes then links at the server figures', () => {
    const csv = moneyFlowCsv(flowOut(), { fold: FOLD })
    expect(csv.headers).toEqual(['Kind', 'Source', 'Target', 'Value'])
    expect(csv.rows).toContainEqual(['node', 'Gross income', '', '307500.00'])
    expect(csv.rows).toContainEqual(['link', 'Take-home cash', 'Saved', '76000.00'])
    expect(moneyFlowCsv(flowOut({ renderable: false, reason: 'nope' })).rows).toEqual([])
  })
})

// The 2026-09-23 code review (3, 6): a category total always names its category (the service's
// id-less shorthand is gone), and only the kinds cash saved subtracts are listed (transfers stay
// yours). The wire type says both — pinned for tsc by the expect-error lines — so the builder
// needs no fallback id and no reader has to guess a kind.
describe('the category totals type', () => {
  it('names the category and lists living and tax only', () => {
    const rent: MoneyFlowCategoryTotal = { category_id: 1, name: 'Rent', kind: 'living', amount: '1.00' }
    // @ts-expect-error: no id-less total on the wire
    const idless: MoneyFlowCategoryTotal = { category_id: null, name: 'Rent', kind: 'living', amount: '1.00' }
    // @ts-expect-error: transfers are never listed
    const transfer: MoneyFlowCategoryTotal = { category_id: 2, name: 'Brokerage', kind: 'transfer', amount: '1.00' }
    expect([rent, idless, transfer].map((total) => total.category_id)).toEqual([1, null, 2])
  })
})
