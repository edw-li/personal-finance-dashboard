import type { ChartFixture } from './_types'
import { netWorthStackOption } from '../../components/networth/netWorthChartOptions'
import { TS } from './netWorthStack.fixture'

// A provisional snapshot (2026-09-23 spec §T7): Aug 1 balances typed early on Jul 24 — the
// net-worth line's last point wears the partial look, through the grammar's colour checks.
const fixture: ChartFixture = {
  name: 'netWorthStackProvisional',
  kind: 'cartesian',
  ariaLabel: 'Stacked area chart of asset groups over time with liabilities and net worth as lines',
  build: () =>
    netWorthStackOption({
      ts: {
        ...TS,
        as_of: ['2026-06-01', '2026-07-01', '2026-07-24'],
        recorded_on: ['2026-06-01', '2026-07-01', '2026-07-24'],
        provisional: [false, false, true],
      },
      mode: 'group', people: [{ id: 1, name: 'Me', is_primary: true }],
      marriageDate: null, range: { preset: 'all' }, selected: {},
    }),
}
export default fixture
