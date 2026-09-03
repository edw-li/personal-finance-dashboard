import type { ChartFixture } from './_types'
import { netWorthStackOption } from '../../components/networth/netWorthChartOptions'
import type { NetWorthTimeseries } from '../../types/api'

export const TS: NetWorthTimeseries = {
  months: ['2026-06-01', '2026-07-01', '2026-08-01'],
  accounts: [],
  series: [],
  group_totals: {
    cash: ['100.00', '110.00', '120.00'], pre_tax: ['200.00', '210.00', '220.00'],
    post_tax: ['50.00', '50.00', '50.00'], taxable: ['300.00', '310.00', '320.00'],
    equity: ['10.00', '10.00', '10.00'], other: ['0.00', '0.00', '0.00'],
    liability: ['-50.00', '-40.00', '-30.00'],
  },
  net_worth: ['610.00', '650.00', '690.00'],
  mom_pct: [null, '0.06', '0.06'],
  notes: [null, 'sold car', null],
  owner_series: [],
}

const fixture: ChartFixture = {
  name: 'netWorthStack',
  kind: 'cartesian',
  ariaLabel: 'Stacked area chart of asset groups over time with liabilities and net worth as lines',
  build: () =>
    netWorthStackOption({
      ts: TS, mode: 'group', people: [{ id: 1, name: 'Me', is_primary: true }],
      marriageDate: '2026-07-01', range: { preset: 'all' }, selected: {},
    }),
}
export default fixture
