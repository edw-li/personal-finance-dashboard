import type { ChartFixture } from './_types'
import { netWorthTrendOption } from '../../components/overview/overviewChartOptions'

// A provisional last point (2026-09-23 spec §T1): Oct 1 balances typed early on Sep 22 wear the
// partial look — a faded fill inside a dashed outline — through the grammar's colour checks.
const fixture: ChartFixture = {
  name: 'overviewNetWorthTrendProvisional',
  kind: 'cartesian',
  ariaLabel: 'Line chart of net worth at every monthly snapshot',
  build: () =>
    netWorthTrendOption({
      months: ['2026-08-01', '2026-09-01', '2026-10-01'],
      net_worth: ['700000.00', '806667.88', '933250.90'],
      as_of: ['2026-08-01', '2026-09-01', '2026-09-22'],
      recorded_on: ['2026-08-01', '2026-09-01', '2026-09-22'],
      provisional: [false, false, true],
    }),
}
export default fixture
