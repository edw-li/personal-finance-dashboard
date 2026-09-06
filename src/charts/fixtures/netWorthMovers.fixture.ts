import type { ChartFixture } from './_types'
import { netWorthMoversOption } from '../../components/networth/netWorthChartOptions'
import { TS } from './netWorthStack.fixture'

const fixture: ChartFixture = {
  name: 'netWorthMovers',
  kind: 'cartesian',
  ariaLabel: 'Horizontal bar chart of how each account group moved net worth from the prior month to this one',
  // Groups mode: TS carries group_totals but no per-account series, so it is the branch this data can draw.
  build: () => netWorthMoversOption(TS, 2, 'group'),
}
export default fixture
