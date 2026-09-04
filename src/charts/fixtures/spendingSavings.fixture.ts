import type { ChartFixture } from './_types'
import { savingsRateOption } from '../../components/spending/spendingChartOptions'
import { LABELS, MATRIX } from './spendingBars.fixture'

const fixture: ChartFixture = {
  name: 'spendingSavings',
  kind: 'cartesian',
  // Verbatim the label its mount announces (SpendingPage's savings ChartCard) — a fixture
  // that described the chart differently would pin a sentence no screen reader ever hears.
  ariaLabel: 'Line chart of the monthly total and cash savings rates around a zero baseline',
  build: () => savingsRateOption({ matrix: MATRIX, monthLabels: LABELS, range: { preset: 'all' } }),
}
export default fixture
