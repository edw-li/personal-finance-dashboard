import type { ChartFixture } from './_types'
import { recentSpendOption } from '../../components/overview/overviewChartOptions'

const fixture: ChartFixture = {
  name: 'overviewRecentSpend',
  kind: 'cartesian',
  ariaLabel: 'Bar chart of total spending for each of the last 12 entered months, with the 12-month average',
  dashed: ['12-mo average'],
  build: () => recentSpendOption({ months: ['2026-06-01', '2026-07-01', '2026-08-01'], totals: ['100.00', '200.00', '300.00'] }),
}
export default fixture
