import type { ChartFixture } from './_types'
import { PROJECTION_SERIES, projectionOption } from '../../components/projection/projectionChartOptions'
import { FAN } from './projectionFan.fixture'

// The fan with pinned scenarios on it (planning-sandboxes spec §11): the ONE shape whose
// grid is `fanEndLabel` and whose series list ends in reference lines, so conformance holds
// the pin form to the grammar too — the plain fan fixture can never reach this branch.
const PINS = ['Return 6%', 'Retire 2035'] as const

const fixture: ChartFixture = {
  name: 'projectionPinned',
  kind: 'cartesian',
  ariaLabel: 'Projected investable balance over the horizon with two pinned scenarios',
  dashed: [PROJECTION_SERIES[2], ...PINS],
  build: () =>
    projectionOption(FAN, {
      references: [
        { name: PINS[0], data: FAN.projected.map((v) => String(Number(v) * 1.1)) },
        { name: PINS[1], data: FAN.coast },
      ],
    }),
}
export default fixture
