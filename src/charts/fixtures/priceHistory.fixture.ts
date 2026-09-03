// The holding drill-in's daily closes (charts C4 / F4): the Avg cost rule, the above/below
// wash and the dated event markers.
import type { ChartFixture } from './_types'
import { priceHistoryOption } from '../../components/portfolio/priceChartOptions'

const fixture: ChartFixture = {
  name: 'priceHistory',
  kind: 'cartesian',
  ariaLabel: 'Line chart of daily closing prices against the average cost',
  dashed: ['Avg cost'],
  build: () =>
    priceHistoryOption({
      points: [
        { d: '2026-08-10', c: '171.25' },
        { d: '2026-08-11', c: '173.00' },
        { d: '2026-08-12', c: '169.80' },
      ],
      avgCost: '172.00',
      events: [
        {
          value: ['Aug 11, 2026', 173],
          symbol: 'triangle',
          symbolRotate: 0,
          events: [{ text: 'Buy NVDA — 10 sh · Aug 11, 2026' }],
        },
      ],
    }),
}
export default fixture
