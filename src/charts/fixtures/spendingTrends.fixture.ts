import type { ChartFixture } from './_types'
import { categoryTrendOption } from '../../components/spending/spendingChartOptions'
import { FOLD, LABELS, MATRIX, NAMES } from './spendingBars.fixture'

const fixture: ChartFixture = {
  name: 'spendingTrends',
  kind: 'cartesian',
  ariaLabel: 'Line chart of the selected categories\u2019 monthly spend with their budgets',
  dashed: ['Groceries budget'],
  build: () =>
    categoryTrendOption({
      matrix: MATRIX, trend: [{ categoryId: 1 }, { categoryId: 2 }], fold: FOLD, nameById: NAMES,
      monthLabels: LABELS, range: { preset: 'all' }, selected: {},
    }),
}
export default fixture
