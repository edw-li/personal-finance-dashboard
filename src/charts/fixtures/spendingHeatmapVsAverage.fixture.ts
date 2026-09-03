import type { ChartFixture } from './_types'
import { heatmapOption } from '../../components/spending/spendingChartOptions'
import { MATRIX, NAMES } from './spendingBars.fixture'

const months = Array.from({ length: 8 }, (_, i) => `2026-0${i + 1}-01`)
const fixture: ChartFixture = {
  name: 'spendingHeatmapVsAverage',
  kind: 'heatmap',
  ariaLabel: 'Heatmap of spend per category per month against each category\u2019s trailing average',
  exempt: ['axis'],
  build: () =>
    heatmapOption({
      matrix: {
        ...MATRIX,
        months,
        series: [
          { category_id: 1, values: ['100.00', '100.00', '100.00', '100.00', '100.00', '100.00', '150.00', '90.00'], budgets: months.map(() => null) },
          { category_id: 2, values: months.map(() => '50.00'), budgets: months.map(() => null) },
        ],
      },
      order: [1, 2], nameById: NAMES, monthLabels: months, mode: 'vsAverage',
    }),
}
export default fixture
