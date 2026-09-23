import { describe, expect, it } from 'vitest'
import type { EChartsOption } from '../../charts/echarts'
import { CATEGORY_HUES, ENTITY } from '../../charts/entities'
import type { CategoryFold } from '../../charts/entities'
import { DEFICIT_DECAL } from '../../charts/grammar'
import { distinguishable } from '../../testing/perceptual'
import { MUTED, NEGATIVE, OTHER_SERIES_COLOR, POSITIVE } from '../../charts/theme'
import type { SpendingMatrix, SpendingYearly } from '../../types/api'
import {
  spendingFlowPeriod,
  spendingSankeyCsv,
  spendingSankeyOption,
} from './spendingSankeyOptions'

// Wire shape of GET /spending/matrix — Decimal strings, parallel arrays. The category
// name carries markup on purpose: user text must survive to the escapeHtml boundary.
function matrix(over: Partial<SpendingMatrix> = {}): SpendingMatrix {
  return {
    months: ['2026-06', '2026-07'],
    categories: [
      { id: 1, name: 'Rent', slug: 'rent', sort_order: 0, is_active: true, kind: 'living' },
      {
        id: 2,
        name: 'Groceries <b>& more</b>',
        slug: 'groceries',
        sort_order: 1,
        is_active: true,
        kind: 'living',
      },
      { id: 3, name: 'Fun', slug: 'fun', sort_order: 2, is_active: true, kind: 'living' },
    ],
    series: [
      { category_id: 1, values: ['2000.00', '2000.00'], budgets: [null, null] },
      { category_id: 2, values: ['600.00', '580.00'], budgets: [null, null] },
      { category_id: 3, values: ['150.00', '0.00'], budgets: [null, null] },
    ],
    totals: ['2750.00', '2580.00'],
    net_pay: ['6000.00', '6000.00'],
    savings_rate: ['0.541666667', '0.57'],
    four_pct_rule: [null, null],
    total_budget: [null, null],
    ...over,
  }
}

// One rollup year; category 4 is a refund-only cell (net negative across the year).
const YEARLY: SpendingYearly = {
  years: [
    {
      year: 2026,
      by_category: [
        { category_id: 1, total: '4000.00' },
        { category_id: 2, total: '1180.00' },
        { category_id: 3, total: '150.00' },
        { category_id: 4, total: '-25.00' },
      ],
      total: '5305.00',
      net_pay_total: '12000.00',
      savings_rate: '0.557916667',
    },
  ],
}

// The stacked chart's fold under test (charts/entities.ts): Rent and Groceries on the first two
// category hues, everything else Other.
const TOP: CategoryFold = { ids: [1, 2], colors: new Map([[1, CATEGORY_HUES[0]], [2, CATEGORY_HUES[1]]]) }

// 2026-09-23 review (spec §0 flows F10, §C1): the Year view paired the rollup's Jan–Aug net pay
// with its Jan–Sep spending, so on prod it said Saved $148.74 while the Overview said $2,220.97.
// A year is drawn over its MATCHED months (spending rows AND take-home, the savings module's
// rule): Jan–Feb here. March has spending and no take-home; April take-home and no spending.
// Returns is a net refund; Brokerage is a transfer, which is not spending.
function windowMatrix(netPay: (string | null)[] = ['6000.00', '6000.00', null, '6100.00']): SpendingMatrix {
  const four = [null, null, null, null]
  return matrix({
    months: ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01'],
    categories: [
      ...matrix().categories,
      { id: 4, name: 'Returns', slug: 'returns', sort_order: 3, is_active: true, kind: 'living' },
      { id: 5, name: 'Brokerage', slug: 'brokerage', sort_order: 4, is_active: true, kind: 'transfer' },
    ],
    series: [
      { category_id: 1, values: ['2000.00', '2000.00', '2000.00', null], budgets: four },
      { category_id: 2, values: ['600.00', '580.00', '300.00', null], budgets: four },
      { category_id: 3, values: ['150.00', '0.00', null, null], budgets: four },
      { category_id: 4, values: ['-25.00', null, null, null], budgets: four },
      { category_id: 5, values: ['1000.00', '1000.00', null, null], budgets: four },
    ],
    totals: ['3725.00', '3580.00', '2300.00', '0.00'],
    net_pay: netPay,
  })
}
// The server's YTD figure over the same months: 12,000 + 25 of refunds − 5,330 = 6,695.
function windowYearly(cashSavings: string | null = '6695.00'): SpendingYearly {
  return {
    years: [{ year: 2026, by_category: [], total: '0.00', net_pay_total: '18100.00', savings_rate: null, cash_savings: cashSavings, months_matched: 2 }],
  }
}
/** Whole cents out of / into a node, and its own value — a flow that leaks reads as a bug. */
function ledger(series: SankeyLike) {
  const c = (v: number | undefined) => Math.round((v ?? 0) * 100)
  return {
    node: (name: string) => c(series.data?.find((n) => n.name === name)?.value),
    out: (name: string) => (series.links ?? []).filter((l) => l.source === name).reduce((a, l) => a + c(l.value), 0),
    into: (name: string) => (series.links ?? []).filter((l) => l.target === name).reduce((a, l) => a + c(l.value), 0),
  }
}

describe('spendingFlowPeriod', () => {
  it('month mode slices the matrix column and carries its net pay', () => {
    const period = spendingFlowPeriod(matrix(), YEARLY, TOP, 1, 'month')
    expect(period).toEqual({
      label: 'Jul 2026',
      netPay: '6000.00',
      // Fun is 0.00 in July AND its Other fold sums to 0, so no Other slice either:
      // zero-spend categories are omitted, never drawn at zero width (spec §3).
      slices: [
        { name: 'Rent', value: 2000, color: CATEGORY_HUES[0] },
        { name: 'Groceries <b>& more</b>', value: 580, color: CATEGORY_HUES[1] },
      ],
    })
  })

  it('passes a null net pay through for the page to render the enter-net-pay note', () => {
    const period = spendingFlowPeriod(matrix({ net_pay: [null, null] }), YEARLY, TOP, 1, 'month')
    expect(period?.label).toBe('Jul 2026')
    expect(period?.netPay).toBeNull()
  })

  it('year mode covers the matched months only: their net pay, their categories, the server’s Saved', () => {
    expect(spendingFlowPeriod(windowMatrix(), windowYearly(), TOP, 3, 'year')).toEqual({
      label: 'Jan–Feb 2026',
      netPay: '12000.00',
      slices: [
        { name: 'Rent', value: 4000, color: CATEGORY_HUES[0] },
        { name: 'Groceries <b>& more</b>', value: 1180, color: CATEGORY_HUES[1] },
        { name: 'Other', value: 150, color: OTHER_SERIES_COLOR },
      ],
      window: {
        months: ['2026-01-01', '2026-02-01'],
        fullYear: false,
        saved: '6695.00',
        refunds: 25,
        spendingLeftOut: 'Mar 2026 spending ($2,300.00) is shown once its take-home is entered.',
        takeHomeLeftOut: 'Apr 2026 take-home ($6,100.00) is shown once its spending is entered.',
      },
    })
  })

  it('keeps the flow whole when the rollup and the matrix disagree (two fetches a moment apart)', () => {
    // Same definition, same data: a figure that does not reconcile to the cent means the book
    // changed between the two requests. The matrix's own figure keeps the flow conserved.
    expect(spendingFlowPeriod(windowMatrix(), windowYearly('6820.00'), TOP, 0, 'year')?.window?.saved).toBe('6695.00')
    // An older rollup without the field: the matrix's figure, too.
    expect(spendingFlowPeriod(windowMatrix(), windowYearly(null), TOP, 0, 'year')?.window?.saved).toBe('6695.00')
  })

  it('a year with no matched month has nothing to draw, and says why', () => {
    const period = spendingFlowPeriod(matrix({ net_pay: [null, null] }), YEARLY, TOP, 0, 'year')
    expect(period).toMatchObject({ label: '2026', netPay: null, empty: 'No month of 2026 has both take-home and spending entered yet.' })
  })

  it('is null with no matrix, an out-of-range month, or a year the rollup lacks', () => {
    expect(spendingFlowPeriod(null, YEARLY, TOP, 0, 'month')).toBeNull()
    expect(spendingFlowPeriod(matrix(), YEARLY, TOP, -1, 'month')).toBeNull()
    expect(spendingFlowPeriod(matrix(), YEARLY, TOP, 2, 'month')).toBeNull()
    const straddling = matrix({ months: ['2025-12', '2026-07'] })
    expect(spendingFlowPeriod(straddling, YEARLY, TOP, 0, 'year')).toBeNull()
    expect(spendingFlowPeriod(matrix(), null, TOP, 0, 'year')).toBeNull()
  })
})

// --- option readers (historyChartOptions.test.ts posture) -------------------------------
interface NodeLike {
  name?: string
  value?: number
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

const july = () => spendingFlowPeriod(matrix(), YEARLY, TOP, 1, 'month')!

describe('spendingSankeyOption — surplus periods', () => {
  it('fans net pay into category nodes in their fold colours and a green Saved tail', () => {
    const option = spendingSankeyOption(july())
    expect(option).not.toBeNull()
    const series = sankeyOf(option!)
    // The shared mark spec rides every option (charts/sankey.ts owns the numbers).
    expect(series.type).toBe('sankey')
    expect(series.nodeWidth).toBe(12)
    expect(series.layoutIterations).toBe(0)
    expect(series.data?.map((n) => n.name)).toEqual([
      'Net pay',
      'Rent',
      'Groceries <b>& more</b>',
      'Saved',
    ])
    expect(series.data?.map((n) => n.itemStyle?.color)).toEqual([
      MUTED, // income restated, not a destination
      CATEGORY_HUES[0], // the stacked chart's colour for Rent — same entity, same hue
      CATEGORY_HUES[1],
      POSITIVE, // Saved: the one deliberate status-color exception (spec §3)
    ])
    expect(series.links).toEqual([
      { source: 'Net pay', target: 'Rent', value: 2000 },
      { source: 'Net pay', target: 'Groceries <b>& more</b>', value: 580 },
      { source: 'Net pay', target: 'Saved', value: 3420 },
    ])
  })

  it('folds non-top categories into the gray Other node (year mode)', () => {
    const option = spendingSankeyOption(spendingFlowPeriod(matrix(), YEARLY, TOP, 1, 'year')!)
    const series = sankeyOf(option!)
    const other = series.data?.find((n) => n.name === 'Other')
    expect(other?.itemStyle?.color).toBe(OTHER_SERIES_COLOR)
    expect(series.links).toContainEqual({ source: 'Net pay', target: 'Other', value: 150 })
    // Jun–Jul, both matched: 12,000 of net pay less 5,330 spent (this rollup predates the
    // cash-saved field, so the matrix's own figure stands in).
    expect(series.links).toContainEqual({ source: 'Net pay', target: 'Saved', value: 6670 })
  })

  it('year-mode flow: Saved is the server’s figure, refunds flow in, transfers stay out, every node equals its links', () => {
    const series = sankeyOf(spendingSankeyOption(spendingFlowPeriod(windowMatrix(), windowYearly(), TOP, 0, 'year')!)!)
    expect(series.data?.map((n) => [n.name, n.value])).toEqual([
      ['Net pay', 12000],
      ['Refunds & credits', 25],
      ['Rent', 4000],
      ['Groceries <b>& more</b>', 1180],
      ['Other', 150],
      ['Saved', 6695],
    ])
    expect(series.data?.find((n) => n.name === 'Refunds & credits')?.itemStyle?.color).toBe(MUTED)
    expect(series.links).toContainEqual({ source: 'Net pay', target: 'Saved', value: 6695 })
    const books = ledger(series)
    for (const name of ['Net pay', 'Refunds & credits']) expect(books.out(name), name).toBe(books.node(name))
    for (const name of ['Rent', 'Groceries <b>& more</b>', 'Other', 'Saved']) expect(books.into(name), name).toBe(books.node(name))
    // No transfer anywhere: Brokerage stayed yours.
    expect(series.data?.some((n) => n.name === 'Brokerage')).toBe(false)
  })

  it('a deficit year draws the hatched Drawdown, and still balances to the cent', () => {
    // 4,000 of matched net pay + 25 of refunds against 5,330 spent: 1,305 drawn down.
    const period = spendingFlowPeriod(windowMatrix(['2000.00', '2000.00', null, '6100.00']), windowYearly('-1305.00'), TOP, 0, 'year')!
    const series = sankeyOf(spendingSankeyOption(period)!)
    expect(series.data?.map((n) => n.name)).toEqual(['Net pay', 'Refunds & credits', 'Drawdown', 'Rent', 'Groceries <b>& more</b>', 'Other'])
    const books = ledger(series)
    for (const name of ['Net pay', 'Refunds & credits', 'Drawdown']) expect(books.out(name), name).toBe(books.node(name))
    for (const name of ['Rent', 'Groceries <b>& more</b>', 'Other']) expect(books.into(name), name).toBe(books.node(name))
  })

  it('a complete year draws exactly what it always did: the whole year, net pay less spending', () => {
    const months = Array.from({ length: 12 }, (_, i) => `2025-${String(i + 1).padStart(2, '0')}-01`)
    const twelve = (value: string) => months.map(() => value)
    const full = matrix({
      months,
      series: [
        { category_id: 1, values: twelve('2000.00'), budgets: months.map(() => null) },
        { category_id: 2, values: twelve('500.00'), budgets: months.map(() => null) },
        { category_id: 3, values: twelve('100.00'), budgets: months.map(() => null) },
      ],
      totals: twelve('2600.00'),
      net_pay: twelve('6000.00'),
    })
    const yearly: SpendingYearly = {
      years: [{
        year: 2025,
        by_category: [{ category_id: 1, total: '24000.00' }, { category_id: 2, total: '6000.00' }, { category_id: 3, total: '1200.00' }],
        total: '31200.00', net_pay_total: '72000.00', savings_rate: null, cash_savings: '40800.00', months_matched: 12,
      }],
    }
    const period = spendingFlowPeriod(full, yearly, TOP, 11, 'year')!
    expect(period.label).toBe('2025')
    expect(period.window?.fullYear).toBe(true)
    // The pre-window Year view over this year: 72,000 fanned into 24,000 / 6,000 / 1,200 and Saved.
    const series = sankeyOf(spendingSankeyOption(period)!)
    expect(series.data?.map((n) => [n.name, n.value])).toEqual([
      ['Net pay', 72000], ['Rent', 24000], ['Groceries <b>& more</b>', 6000], ['Other', 1200], ['Saved', 40800],
    ])
    expect(series.links).toEqual([
      { source: 'Net pay', target: 'Rent', value: 24000 },
      { source: 'Net pay', target: 'Groceries <b>& more</b>', value: 6000 },
      { source: 'Net pay', target: 'Other', value: 1200 },
      { source: 'Net pay', target: 'Saved', value: 40800 },
    ])
  })

  it('omits an exactly-zero Saved node (zero-width links are tooltip noise)', () => {
    const period = spendingFlowPeriod(
      matrix({ net_pay: ['6000.00', '2580.00'] }),
      YEARLY,
      TOP,
      1,
      'month',
    )!
    const series = sankeyOf(spendingSankeyOption(period)!)
    expect(series.data?.map((n) => n.name)).toEqual([
      'Net pay',
      'Rent',
      'Groceries <b>& more</b>',
    ])
    expect(series.links).toHaveLength(2)
  })
})

describe('spendingSankeyOption — deficit and degenerate periods', () => {
  it('adds a red Drawdown source and splits every category pro-rata', () => {
    const period = spendingFlowPeriod(
      matrix({ net_pay: ['6000.00', '1000.00'] }),
      YEARLY,
      TOP,
      1,
      'month',
    )!
    const series = sankeyOf(spendingSankeyOption(period)!)
    // Saved is omitted in a deficit period (spec §3).
    expect(series.data?.map((n) => n.name)).toEqual([
      'Net pay',
      'Drawdown',
      'Rent',
      'Groceries <b>& more</b>',
    ])
    expect(series.data?.[1]?.itemStyle).toEqual({ color: NEGATIVE, decal: DEFICIT_DECAL })
    expect(series.data?.[1]?.value).toBe(1580)
    // Pro-rata: net pay funds 1000/2580 of each category, the drawdown the rest — money
    // is fungible, so no category is singled out as "the drawdown one". Inflows equal
    // outflows again: 1000 + 1580 = 2580.
    expect(series.links).toEqual([
      { source: 'Net pay', target: 'Rent', value: 775.19 },
      { source: 'Drawdown', target: 'Rent', value: 1224.81 },
      { source: 'Net pay', target: 'Groceries <b>& more</b>', value: 224.81 },
      { source: 'Drawdown', target: 'Groceries <b>& more</b>', value: 355.19 },
    ])
  })

  // 2026-09-23 review, "Where Apr 2026 went" on prod: Drawdown −$3,193.55 linked into Taxes
  // $5,044 on the tax hue, which the deficit red is 2.5 / 4.4 away from. The texture is what
  // keeps them apart, and from the warm category hues too.
  it('keeps Drawdown apart from every other node: textured where its colour alone is under the floor', () => {
    const withTax = matrix({
      categories: [
        ...matrix().categories,
        { id: 4, name: 'Taxes', slug: 'taxes', sort_order: 3, is_active: true, kind: 'tax' },
      ],
      series: [...matrix().series, { category_id: 4, values: ['0.00', '5044.00'], budgets: [null, null] }],
    })
    const fold: CategoryFold = { ids: [4, 1, 2], colors: new Map([[4, ENTITY.tax], [1, CATEGORY_HUES[0]], [2, CATEGORY_HUES[1]]]) }
    const series = sankeyOf(spendingSankeyOption(spendingFlowPeriod(withTax, YEARLY, fold, 1, 'month')!)!)
    const markOf = (node: { itemStyle?: { color?: string } }) => ({
      color: node.itemStyle?.color ?? '',
      decal: (node.itemStyle as { decal?: unknown } | undefined)?.decal,
    })
    const drawdown = series.data!.find((n) => n.name === 'Drawdown')!
    expect(series.data!.some((n) => n.itemStyle?.color === ENTITY.tax)).toBe(true)
    for (const node of series.data ?? []) {
      if (node === drawdown) continue
      expect(distinguishable(markOf(drawdown), markOf(node)), node.name).toBe(true)
    }
  })

  it('funds a zero-net-pay deficit period entirely from Drawdown', () => {
    const period = spendingFlowPeriod(
      matrix({ net_pay: ['6000.00', '0.00'] }),
      YEARLY,
      TOP,
      1,
      'month',
    )!
    const series = sankeyOf(spendingSankeyOption(period)!)
    // No zero-value Net pay node and no zero links from it.
    expect(series.data?.map((n) => n.name)).toEqual([
      'Drawdown',
      'Rent',
      'Groceries <b>& more</b>',
    ])
    expect(series.links).toEqual([
      { source: 'Drawdown', target: 'Rent', value: 2000 },
      { source: 'Drawdown', target: 'Groceries <b>& more</b>', value: 580 },
    ])
  })

  it('is null when net pay is missing, negative, or there is nothing to draw', () => {
    expect(spendingSankeyOption({ label: 'Jul 2026', netPay: null, slices: [] })).toBeNull()
    expect(spendingSankeyOption({ label: 'Jul 2026', netPay: '-1.00', slices: [] })).toBeNull()
    expect(spendingSankeyOption({ label: 'Jul 2026', netPay: '0.00', slices: [] })).toBeNull()
  })

  it("tooltips echo the builder's own figures with names escaped", () => {
    const format = tooltipOf(spendingSankeyOption(july())!)
    const node = format({ dataType: 'node', name: 'Groceries <b>& more</b>' })
    expect(node).toContain('$580.00')
    expect(node).toContain('&lt;b&gt;&amp; more&lt;/b&gt;')
    expect(node).not.toContain('<b>')
    const edge = format({ dataType: 'edge', data: { source: 'Net pay', target: 'Saved' } })
    expect(edge).toContain('$3,420.00')
  })

  it('renames slices that collide with the chart’s own nodes — duplicates crash echarts', () => {
    // Same failure mode as the 2026-08-25 Overview money-flow incident: echarts 6 drops a
    // duplicate-named node and then throws TypeError wiring its links, inside setOption,
    // where the route boundary blanks the page. 'Net pay' as a category is additionally a
    // self-loop. Colliding slice names wear the visible ' (spending)' suffix instead.
    const option = spendingSankeyOption({
      label: 'Jul 2026',
      netPay: '6000.00',
      slices: [
        { name: 'Net pay', value: 2000, color: CATEGORY_HUES[0] },
        { name: 'Saved', value: 1500, color: CATEGORY_HUES[1] },
        { name: 'Drawdown', value: 500, color: CATEGORY_HUES[2] },
      ],
    })
    expect(option).not.toBeNull()
    const series = sankeyOf(option!)
    const names = (series.data ?? []).map((n) => n.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names).toContain('Net pay (spending)')
    expect(names).toContain('Saved (spending)')
    expect(names).toContain('Drawdown (spending)')
    expect(names).toContain('Saved') // the structural surplus tail still draws
    expect(series.links).toContainEqual({
      source: 'Net pay',
      target: 'Net pay (spending)',
      value: 2000,
    })
  })
})

describe('spendingSankeyCsv', () => {
  it('exports the drawn nodes and links (F12) — the figures the tooltip echoes', () => {
    expect(spendingSankeyCsv(july()).rows).toContainEqual(['link', 'Net pay', 'Saved', '3420.00'])
  })
})
