import type { ChartFixture } from './_types'
import { netWorthProjectionOption } from '../../components/projection/projectionChartOptions'

const fixture: ChartFixture = {
  name: 'netWorthProjection',
  kind: 'cartesian',
  ariaLabel: 'Net worth history with a fitted trend extended forward, on a log scale',
  build: () =>
    netWorthProjectionOption(
      { months: ['2026-06-01', '2026-07-01', '2026-08-01'], net_worth: ['100000.00', '101000.00', '102010.00'] },
      { valueAt: (iso) => (iso === '2026-06-01' ? 100000 : 123456) },
      '2026-08-01',
      1,
    ),
}
export default fixture
