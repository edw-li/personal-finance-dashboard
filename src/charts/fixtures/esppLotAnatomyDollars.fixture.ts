// The lot anatomy's Dollars view over the shared sheet lots: a held lot, two sold (hollow) lots
// and one under its FMV, so the loss overlay stack is on the canvas.
import type { ChartFixture } from './_types'
import { lotAnatomyOption } from '../../components/espp/esppChartOptions'
import { esppLotsResponse } from '../../testing/esppFixtures'

const fixture: ChartFixture = {
  name: 'esppLotAnatomyDollars',
  kind: 'cartesian',
  ariaLabel:
    "Stacked bar chart of each ESPP lot's value split into amount paid, bargain element at purchase and appreciation since, with a per-share view",
  build: () => lotAnatomyOption(esppLotsResponse(), { view: 'dollars' }),
}
export default fixture
