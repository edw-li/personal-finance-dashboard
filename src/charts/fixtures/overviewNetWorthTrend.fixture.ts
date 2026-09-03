import type { ChartFixture } from './_types'
import { netWorthTrendOption } from '../../components/overview/overviewChartOptions'

const fixture: ChartFixture = {
  name: 'overviewNetWorthTrend',
  kind: 'cartesian',
  ariaLabel: 'Line chart of net worth at every monthly snapshot',
  build: () => netWorthTrendOption({ months: ['2026-06-01', '2026-07-01', '2026-08-01'], net_worth: ['1000.00', '-250.50', '2000.75'] }),
}
export default fixture
