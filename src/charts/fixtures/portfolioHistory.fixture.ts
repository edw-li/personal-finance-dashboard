// The Portfolio/Overview performance chart (charts C4): four lines in fixed palette slots,
// the wash on value only, the Events annotation scatter and the live ping.
import type { ChartFixture } from './_types'
import { portfolioHistoryOption } from '../../components/portfolio/historyChartOptions'

const fixture: ChartFixture = {
  name: 'portfolioHistory',
  kind: 'cartesian',
  ariaLabel:
    'Line chart of portfolio value against cost basis and benchmark lines, weekly',
  build: () =>
    portfolioHistoryOption(
      {
        dates: ['2026-07-27', '2026-08-03', '2026-08-10'],
        market_value: ['700000.00', '710000.50', '718422.07'],
        cost_basis: ['395000.00', '399542.36', '400243.74'],
        sp500: ['96000.00', '97000.00', '98636.70'],
        benchmark: ['96000.00', '97250.00', '99001.13'],
      },
      { date: '2026-08-14', value: 723456.78 },
      [
        {
          value: ['Aug 3, 2026', 710000.5],
          symbol: 'triangle',
          symbolRotate: 0,
          events: [{ text: 'Buy NVDA — 10 sh · Aug 4, 2026' }],
        },
      ],
    ),
}
export default fixture
