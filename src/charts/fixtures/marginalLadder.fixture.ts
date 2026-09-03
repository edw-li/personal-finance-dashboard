import type { ChartFixture } from './_types'
import { marginalLadderOption } from '../../components/taxes/taxChartOptions'

const fixture: ChartFixture = {
  name: 'marginalLadder',
  kind: 'cartesian',
  ariaLabel: 'Bracket ladder per jurisdiction with this year’s taxable income marked',
  build: () =>
    marginalLadderOption([
      {
        label: 'Federal',
        taxableIncome: 50000,
        segments: [
          { rate: 0.1, floor: 0, ceiling: 11600, current: false },
          { rate: 0.12, floor: 11600, ceiling: 47150, current: false },
          { rate: 0.22, floor: 47150, ceiling: 100525, current: true },
          { rate: 0.24, floor: 100525, ceiling: null, current: false },
        ],
      },
      {
        label: 'State',
        taxableIncome: 60000,
        segments: [
          { rate: 0.01, floor: 0, ceiling: 10000, current: false },
          { rate: 0.093, floor: 10000, ceiling: null, current: true },
        ],
      },
    ]),
}
export default fixture
