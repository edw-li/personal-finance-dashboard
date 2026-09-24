import type { ChartFixture } from './_types'
import { spendingBarsOption } from '../../components/spending/spendingChartOptions'
import { FOLD, LABELS, MATRIX, NAMES } from './spendingBars.fixture'

// A partly entered month (2026-09-23 spec §T12): on Sep 3 August has ended, but its spending was
// saved during it — every August segment keeps the partial look and its net pay the lone marker,
// through the grammar's colour and dash checks like the month in progress.
const fixture: ChartFixture = {
  name: 'spendingBarsPartlyEntered',
  kind: 'cartesian',
  ariaLabel: 'Stacked bar chart of monthly spending by category under the net-pay line',
  build: () =>
    spendingBarsOption({
      matrix: MATRIX, fold: FOLD, nameById: NAMES, monthLabels: LABELS,
      range: { preset: 'all' }, selected: {}, todayIso: '2026-09-03',
      flowsDue: [
        {
          month: '2026-08-01', spending: 'partial', spending_entered: false, spending_saved_on: '2026-08-07',
          take_home_entered: true, due_on: '2026-09-01', overdue_from: '2026-09-16', overdue: false,
        },
      ],
    }),
}
export default fixture
