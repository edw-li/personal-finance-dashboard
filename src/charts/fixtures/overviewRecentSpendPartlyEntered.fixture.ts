import type { ChartFixture } from './_types'
import { recentSpendOption } from '../../components/overview/overviewChartOptions'

// A partly entered month (2026-09-23 spec §T12): September's rent saved during September, drawn
// on Oct 3 with the in-progress look after it has ended — through the grammar's checks like the
// month in progress.
const fixture: ChartFixture = {
  name: 'overviewRecentSpendPartlyEntered',
  kind: 'cartesian',
  ariaLabel: 'Bar chart of total spending for each of the last 12 entered months, with the 12-month average',
  dashed: ['12-mo average'],
  build: () =>
    recentSpendOption(
      { months: ['2026-07-01', '2026-08-01', '2026-09-01'], totals: ['4000.00', '4200.00', '2072.23'] },
      12,
      undefined,
      {
        todayIso: '2026-10-03',
        flowsDue: [
          {
            month: '2026-09-01', spending: 'partial', spending_entered: false, spending_saved_on: '2026-09-07',
            take_home_entered: false, due_on: '2026-10-01', overdue_from: '2026-10-16', overdue: false,
          },
        ],
      },
    ),
}
export default fixture
