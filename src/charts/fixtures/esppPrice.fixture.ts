// The employer's closes with the two stepped rules, the wash against the average paid, and the
// purchase and sale markers (one of them hollow).
import type { ChartFixture } from './_types'
import { AVG_PAID, SUBSCRIPTION, esppPriceOption } from '../../components/espp/esppChartOptions'
import { anatomyLots, bars, septOffering } from '../../testing/esppFixtures'

const fixture: ChartFixture = {
  name: 'esppPrice',
  kind: 'cartesian',
  ariaLabel:
    "Line chart of NVDA's daily closes against the subscription price and your average paid per share, with purchase markers",
  dashed: [SUBSCRIPTION, AVG_PAID],
  build: () => esppPriceOption({ points: bars, offerings: [septOffering], lots: anatomyLots }),
}
export default fixture
