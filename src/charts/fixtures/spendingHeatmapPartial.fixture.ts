import type { ChartFixture } from './_types'
import { heatmapOption } from '../../components/spending/spendingChartOptions'
import { LABELS, MATRIX, NAMES } from './spendingBars.fixture'

// The month in progress (2026-09-23 spec §C5): August's column faded behind the neutral dashed
// outline, its rotated label marked.
const fixture: ChartFixture = {
  name: 'spendingHeatmapPartial',
  kind: 'heatmap',
  ariaLabel: 'Heatmap of spend per category per month, each category on its own scale',
  exempt: ['axis'],
  build: () =>
    heatmapOption({
      matrix: MATRIX, order: [1, 2, 3], nameById: NAMES, monthLabels: LABELS, mode: 'row', todayIso: '2026-08-12',
    }),
}
export default fixture
