import type { ChartFixture } from './_types'
import { cardValueChartOption } from '../../components/creditcards/cardValueChartOptions'

const fixture: ChartFixture = {
  name: 'cardValue',
  kind: 'cartesian',
  ariaLabel: 'Horizontal bars of each card’s estimated net annual value',
  build: () =>
    cardValueChartOption([
      { name: 'BILT', marginal: 918, credits: 0, fee: 0, net: 918 },
      { name: 'Venture X', marginal: 602, credits: 300, fee: 395, net: 507 },
      { name: 'RH Gold', marginal: 0, credits: 0, fee: 0, net: 0 },
    ]),
}
export default fixture
