import type { ChartFixture } from './_types'
import { monthPieOption } from '../../components/spending/spendingChartOptions'
import { FOLD, MATRIX } from './spendingBars.fixture'

const fixture: ChartFixture = {
  name: 'spendingMonthPie',
  kind: 'pie',
  ariaLabel: 'Donut chart of one month’s spending by category',
  exempt: ['grid', 'axis'],
  build: () => monthPieOption(MATRIX, FOLD, 0),
}
export default fixture
