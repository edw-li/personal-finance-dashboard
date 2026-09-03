import type { ChartFixture } from './_types'
import { categorySmallMultiplesOption } from '../../components/spending/spendingChartOptions'
import { LABELS, MATRIX, NAMES } from './spendingBars.fixture'

const fixture: ChartFixture = {
  name: 'spendingSmallMultiples',
  kind: 'cartesian',
  ariaLabel: 'Small multiples: every spending category\u2019s monthly history as its own tiny line',
  exempt: ['grid'],
  build: () => categorySmallMultiplesOption({ matrix: MATRIX, order: [1, 2, 3], nameById: NAMES, monthLabels: LABELS }),
}
export default fixture
