import type { ChartFixture } from './_types'
import { spendingBarsOption } from '../../components/spending/spendingChartOptions'
import type { SpendingMatrix } from '../../types/api'

export const MATRIX: SpendingMatrix = {
  months: ['2026-06-01', '2026-07-01', '2026-08-01'],
  categories: [
    { id: 1, name: 'Rent', slug: 'rent', sort_order: 0, is_active: true },
    { id: 2, name: 'Groceries', slug: 'groceries', sort_order: 1, is_active: true },
    { id: 3, name: 'Fun', slug: 'fun', sort_order: 2, is_active: true },
  ],
  series: [
    { category_id: 1, values: ['2000.00', '2000.00', '2000.00'], budgets: [null, null, null] },
    { category_id: 2, values: ['600.00', '580.00', '610.00'], budgets: ['500.00', '500.00', '500.00'] },
    { category_id: 3, values: ['150.00', '0.00', '90.00'], budgets: [null, null, null] },
  ],
  totals: ['2750.00', '2580.00', '2700.00'],
  net_pay: ['6000.00', '6000.00', '6100.00'],
  savings_rate: ['0.541666667', '0.57', '0.557377'],
  four_pct_rule: ['4100.50', '4100.50', '4200.00'],
  total_budget: ['500.00', '500.00', '500.00'],
}
export const NAMES = new Map(MATRIX.categories.map((c) => [c.id, c.name]))
export const LABELS = ['Jun 2026', 'Jul 2026', 'Aug 2026']

const fixture: ChartFixture = {
  name: 'spendingBars',
  kind: 'cartesian',
  ariaLabel: 'Stacked bar chart of monthly spending by category under the net-pay line',
  build: () =>
    spendingBarsOption({
      matrix: MATRIX, topIds: [1, 2], nameById: NAMES, monthLabels: LABELS,
      range: { preset: 'all' }, selected: {},
    }),
}
export default fixture
