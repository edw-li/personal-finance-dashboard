import type { ChartFixture } from './_types'
import { netWorthStackOption } from '../../components/networth/netWorthChartOptions'
import { TS } from './netWorthStack.fixture'

const fixture: ChartFixture = {
  name: 'netWorthStackShare',
  kind: 'cartesian',
  ariaLabel: 'Stacked area chart of each asset group as a share of assets per month',
  build: () =>
    netWorthStackOption({
      ts: TS, mode: 'share', people: [], marriageDate: null, range: { preset: 'all' }, selected: {},
    }),
}
export default fixture
