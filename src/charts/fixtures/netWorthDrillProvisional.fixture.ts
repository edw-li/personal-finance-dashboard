import type { ChartFixture } from './_types'
import { netWorthDrillOption } from '../../components/networth/netWorthChartOptions'
import { TS } from './netWorthStack.fixture'

// A provisional snapshot on the drill chart (2026-09-23 spec §T7; spec review M1): Aug 1 balances
// typed early on Jul 24 — each drill line carries a partial-look marker on that month, through
// the grammar's colour checks.
const fixture: ChartFixture = {
  name: 'netWorthDrillProvisional',
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
        as_of: ['2026-06-01', '2026-07-01', '2026-07-24'],
        recorded_on: ['2026-06-01', '2026-07-01', '2026-07-24'],
        provisional: [false, false, true],
      },
      drill: [{ accountId: 10, slot: 0 }],
      range: { preset: 'all' },
      selected: {},
    }),
}
export default fixture
