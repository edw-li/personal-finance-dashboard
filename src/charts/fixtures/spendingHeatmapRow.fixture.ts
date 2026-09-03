import type { ChartFixture } from './_types'
import { heatmapOption } from '../../components/spending/spendingChartOptions'
import { LABELS, MATRIX, NAMES } from './spendingBars.fixture'

const fixture: ChartFixture = {
  name: 'spendingHeatmapRow',
  kind: 'heatmap',
  ariaLabel: 'Heatmap of spend per category per month, each category on its own scale',
  exempt: ['axis'],
  build: () => heatmapOption({ matrix: MATRIX, order: [1, 2, 3], nameById: NAMES, monthLabels: LABELS, mode: 'row' }),
}
export default fixture
