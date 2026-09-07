// The same builder's Per share view: the ladder stack, the end dots, the subscription diamonds
// and the quote rule every unsold column's Price dot must sit on.
import type { ChartFixture } from './_types'
import { QUOTE_RULE, lotAnatomyOption } from '../../components/espp/esppChartOptions'
import { esppLotsResponse } from '../../testing/esppFixtures'

const fixture: ChartFixture = {
  name: 'esppLotAnatomyPerShare',
  kind: 'cartesian',
  ariaLabel:
    "Stacked bar chart of each ESPP lot's value split into amount paid, bargain element at purchase and appreciation since, with a per-share view",
  dashed: [QUOTE_RULE],
  build: () => lotAnatomyOption(esppLotsResponse(), { view: 'per-share' }),
}
export default fixture
