import type { ChartFixture } from './_types'
import { savingsRateOption } from '../../components/spending/spendingChartOptions'
import { LABELS, MATRIX } from './spendingBars.fixture'

const fixture: ChartFixture = {
  name: 'spendingSavings',
  kind: 'cartesian',
  ariaLabel: 'Line chart of the monthly savings rate around a zero baseline',
  build: () => savingsRateOption({ matrix: MATRIX, monthLabels: LABELS, range: { preset: 'all' } }),
}
export default fixture
