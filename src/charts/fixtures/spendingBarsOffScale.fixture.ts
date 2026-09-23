import type { ChartFixture } from './_types'
import { spendingBarsOption } from '../../components/spending/spendingChartOptions'
import type { SpendingMatrix } from '../../types/api'
import { categoryFold } from '../entities'
import { MATRIX, NAMES } from './spendingBars.fixture'

// The robust-axis branch (2026-09-23 spec §C3): two years of ordinary months and one
// import-artefact net pay (production's Aug 2023, $25,937.48). The capped axis and the
// edge marker's colours and label go through the grammar's checks like every other mark.
const MONTHS = Array.from({ length: 24 }, (_, i) => `${2024 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`)
const LABELS = MONTHS.map((m) => `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`)
const OFF_SCALE: SpendingMatrix = {
  ...MATRIX,
  months: MONTHS,
  series: MATRIX.series.map((s) => ({ ...s, values: MONTHS.map((_, i) => s.values[i % 3]), budgets: MONTHS.map(() => null) })),
  totals: MONTHS.map(() => '2750.00'),
  net_pay: MONTHS.map((_, i) => (i === 7 ? '25937.48' : '6000.00')),
  savings_rate: MONTHS.map(() => null),
  four_pct_rule: MONTHS.map(() => '4100.50'),
  total_budget: MONTHS.map(() => null),
  living_total: MONTHS.map(() => '2600.00'),
  tax_total: MONTHS.map(() => '150.00'),
  transfer_total: MONTHS.map(() => '0.00'),
  cash_savings: MONTHS.map(() => '3250.00'),
  payroll_savings: MONTHS.map(() => '1000.00'),
  total_savings: MONTHS.map(() => '4250.00'),
  total_savings_rate: MONTHS.map(() => '0.607142857'),
}

const fixture: ChartFixture = {
  name: 'spendingBarsOffScale',
  kind: 'cartesian',
  ariaLabel: 'Stacked bar chart of monthly spending by category under the net-pay line',
  build: () =>
    spendingBarsOption({
      matrix: OFF_SCALE, fold: categoryFold(OFF_SCALE), nameById: NAMES, monthLabels: LABELS,
      range: { preset: 'all' }, selected: {},
    }),
}
export default fixture
