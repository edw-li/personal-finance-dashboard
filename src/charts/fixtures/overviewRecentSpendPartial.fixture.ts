import type { ChartFixture } from './_types'
import { recentSpendOption } from '../../components/overview/overviewChartOptions'

// The month in progress (2026-09-23 spec §C5): the last bar faded behind a dashed outline, its
// label marked, its tooltip head naming it. The partial look's colours go through the
// grammar's checks like every other mark.
const fixture: ChartFixture = {
  name: 'overviewRecentSpendPartial',
  kind: 'cartesian',
  ariaLabel: 'Bar chart of total spending for each of the last 12 entered months, with the 12-month average',
  dashed: ['12-mo average'],
  build: () =>
    recentSpendOption(
      { months: ['2026-07-01', '2026-08-01', '2026-09-01'], totals: ['4000.00', '4200.00', '2072.23'] },
      12,
      undefined,
      { todayIso: '2026-09-23' },
    ),
}
export default fixture
