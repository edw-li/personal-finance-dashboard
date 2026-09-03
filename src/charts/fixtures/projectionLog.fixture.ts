import type { ChartFixture } from './_types'
import { PROJECTION_SERIES, projectionOption } from '../../components/projection/projectionChartOptions'
import { FAN } from './projectionFan.fixture'

const fixture: ChartFixture = {
  name: 'projectionLog',
  kind: 'cartesian',
  ariaLabel: 'Projected investable balance on a log scale',
  dashed: [PROJECTION_SERIES[2]],
  build: () => projectionOption(FAN, { log: true }),
}
export default fixture
