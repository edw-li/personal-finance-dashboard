import type { ChartFixture } from './_types'
import { netWorthBridgeOption } from '../../components/networth/netWorthChartOptions'
import { TS } from './netWorthStack.fixture'

const fixture: ChartFixture = {
  name: 'netWorthBridge',
  kind: 'cartesian',
  ariaLabel: 'Waterfall chart of how each account group moved net worth from the prior month to this one',
  build: () => netWorthBridgeOption(TS, 2),
}
export default fixture
