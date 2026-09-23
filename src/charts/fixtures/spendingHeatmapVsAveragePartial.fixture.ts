import type { ChartFixture } from './_types'
import { heatmapOption } from '../../components/spending/spendingChartOptions'
import { LABELS, MATRIX, NAMES } from './spendingBars.fixture'

// The month in progress in the vs-average reading (2026-09-23 spec §C5, audit F1): August's
// cells in their own neutral, hatched series that the diverging scale does not colour.
const fixture: ChartFixture = {
  name: 'spendingHeatmapVsAveragePartial',
  kind: 'heatmap',
  ariaLabel: 'Heatmap of spend per category per month against each category’s trailing average',
  exempt: ['axis'],
  build: () =>
    heatmapOption({
      matrix: MATRIX, order: [1, 2, 3], nameById: NAMES, monthLabels: LABELS, mode: 'vsAverage', todayIso: '2026-08-12',
    }),
}
export default fixture
