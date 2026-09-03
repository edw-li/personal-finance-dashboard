import type { ChartFixture } from './_types'
import { netWorthDrillOption } from '../../components/networth/netWorthChartOptions'
import { TS } from './netWorthStack.fixture'

const fixture: ChartFixture = {
  name: 'netWorthDrill',
  kind: 'cartesian',
  ariaLabel: 'Line chart of the selected accounts’ balances over time',
  build: () =>
    netWorthDrillOption({
      ts: {
        ...TS,
        accounts: [
          { id: 10, name: 'Checking', slug: 'checking', group: 'cash', is_active: true, is_component: false } as never,
        ],
        series: [{ account_id: 10, values: ['100.00', '110.00', '120.00'] }],
      },
      drill: [{ accountId: 10, slot: 0 }],
      range: { preset: 'all' },
      selected: {},
    }),
}
export default fixture
