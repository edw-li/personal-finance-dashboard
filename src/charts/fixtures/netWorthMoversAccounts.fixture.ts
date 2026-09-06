import type { ChartFixture } from './_types'
import { netWorthMoversOption } from '../../components/networth/netWorthChartOptions'
import { TS } from './netWorthStack.fixture'
import type { AccountOut } from '../../types/api'

// Twelve non-component cash accounts, moving +12 … +1: the Accounts branch AND the folded
// "Other accounts" tail (OTHER_SERIES_COLOR, past the cap of ten) both reach the grammar
// checks, which the Groups fixture's group_totals-only payload never can.
const account = (id: number): AccountOut => ({
  id, name: `Account ${id}`, slug: `account-${id}`, group: 'cash', sort_order: id,
  is_active: true, is_component: false, parent_account_id: null, person_id: null,
})

const fixture: ChartFixture = {
  name: 'netWorthMoversAccounts',
  kind: 'cartesian',
  ariaLabel: 'Horizontal bar chart of how each account moved net worth from the prior month to this one',
  build: () =>
    netWorthMoversOption(
      {
        ...TS,
        accounts: Array.from({ length: 12 }, (_, i) => account(i + 1)),
        series: Array.from({ length: 12 }, (_, i) => ({ account_id: i + 1, values: ['0.00', '0.00', `${12 - i}.00`] })),
        net_worth: ['0.00', '0.00', '78.00'],
      },
      2,
      'account',
    ),
}
export default fixture
