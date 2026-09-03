import type { ChartFixture } from './_types'
import { spendingSankeyOption } from '../../components/spending/spendingSankeyOptions'

const fixture: ChartFixture = {
  name: 'spendingSankey',
  kind: 'sankey',
  ariaLabel: 'Sankey flow of where the month went, from net pay into categories and savings',
  exempt: ['grid', 'axis', 'legend'],
  build: () => spendingSankeyOption({ label: 'Jul 2026', netPay: '6000.00', slices: [{ name: 'Rent', value: 2000, slot: 0 }, { name: 'Groceries', value: 580, slot: 1 }] }),
}
export default fixture
