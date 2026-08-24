import { describe, expect, it } from 'vitest'
import type { SpendingMatrix, SpendingYearly } from '../../types/api'
import { buildYearSlices, spendingFlowPeriod } from './spendingSankeyOptions'

// Wire shape of GET /spending/matrix — Decimal strings, parallel arrays. The category
// name carries markup on purpose: user text must survive to the escapeHtml boundary.
function matrix(over: Partial<SpendingMatrix> = {}): SpendingMatrix {
  return {
    months: ['2026-06', '2026-07'],
    categories: [
      { id: 1, name: 'Rent', slug: 'rent', sort_order: 0, is_active: true },
      { id: 2, name: 'Groceries <b>& more</b>', slug: 'groceries', sort_order: 1, is_active: true },
      { id: 3, name: 'Fun', slug: 'fun', sort_order: 2, is_active: true },
    ],
    series: [
      { category_id: 1, values: ['2000.00', '2000.00'] },
      { category_id: 2, values: ['600.00', '580.00'] },
      { category_id: 3, values: ['150.00', '0.00'] },
    ],
    totals: ['2750.00', '2580.00'],
    net_pay: ['6000.00', '6000.00'],
    savings_rate: ['0.541666667', '0.57'],
    four_pct_rule: [null, null],
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

// The stacked chart's fold under test: slots follow topIds order, the rest is Other.
const TOP = [1, 2]

describe('buildYearSlices', () => {
  it('folds the rollup exactly like the stacked chart: topIds slots, positive-only, gray Other', () => {
    const slices = buildYearSlices(matrix().categories, YEARLY.years[0], TOP)
    expect(slices).toEqual([
      { name: 'Rent', value: 4000, slot: 0 },
      { name: 'Groceries <b>& more</b>', value: 1180, slot: 1 },
      // Fun (150) folds into Other; the -25 refund cell is EXCLUDED (positive-only,
      // buildMonthSlices' documented rule mirrored).
      { name: 'Other', value: 150, slot: null },
    ])
  })
})

describe('spendingFlowPeriod', () => {
  it('month mode slices the matrix column and carries its net pay', () => {
    const period = spendingFlowPeriod(matrix(), YEARLY, TOP, 1, 'month')
    expect(period).toEqual({
      label: 'Jul 2026',
      netPay: '6000.00',
      // Fun is 0.00 in July AND its Other fold sums to 0, so no Other slice either:
      // zero-spend categories are omitted, never drawn at zero width (spec §3).
      slices: [
        { name: 'Rent', value: 2000, slot: 0 },
        { name: 'Groceries <b>& more</b>', value: 580, slot: 1 },
      ],
    })
  })

  it('passes a null net pay through for the page to render the enter-net-pay note', () => {
    const period = spendingFlowPeriod(matrix({ net_pay: [null, null] }), YEARLY, TOP, 1, 'month')
    expect(period?.label).toBe('Jul 2026')
    expect(period?.netPay).toBeNull()
  })

  it('year mode follows the looked-at month into its rollup', () => {
    const period = spendingFlowPeriod(matrix(), YEARLY, TOP, 0, 'year')
    expect(period?.label).toBe('2026')
    expect(period?.netPay).toBe('12000.00')
    expect(period?.slices.map((s) => s.name)).toEqual(['Rent', 'Groceries <b>& more</b>', 'Other'])
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
