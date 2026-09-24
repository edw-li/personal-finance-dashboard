import type { ChartFixture } from './_types'
import { heatmapOption } from '../../components/spending/spendingChartOptions'
import { LABELS, MATRIX, NAMES } from './spendingBars.fixture'

// A partly entered month (2026-09-23 spec §T12): August's column after August ended, faded behind
// the neutral dashed outline, its rotated label marked — the month in progress's look.
const fixture: ChartFixture = {
  name: 'spendingHeatmapPartlyEntered',
  kind: 'heatmap',
  ariaLabel: 'Heatmap of spend per category per month, each category on its own scale',
  exempt: ['axis'],
  build: () =>
    heatmapOption({
      matrix: MATRIX, order: [1, 2, 3], nameById: NAMES, monthLabels: LABELS, mode: 'row', todayIso: '2026-09-03',
      flowsDue: [
        {
          month: '2026-08-01', spending: 'partial', spending_entered: false, spending_saved_on: '2026-08-07',
          take_home_entered: true, due_on: '2026-09-01', overdue_from: '2026-09-16', overdue: false,
        },
      ],
    }),
}
export default fixture
