import type { ChartFixture } from './_types'
import { PROJECTION_SERIES, projectionOption } from '../../components/projection/projectionChartOptions'
import { DRAWDOWN } from './projectionDrawdown.fixture'

// The drawdown on the log axis (2026-09-23 correctness spec §R7): paths that ran out are drawn
// at the axis floor, and the axis starts there — the branch no positive-only fixture reaches.
const fixture: ChartFixture = {
  name: 'projectionDrawdownLog',
  kind: 'cartesian',
  ariaLabel: 'Projected investable balance with withdrawals, on a log scale',
  dashed: [PROJECTION_SERIES[2]],
  build: () => projectionOption(DRAWDOWN, { log: true }),
}
export default fixture
