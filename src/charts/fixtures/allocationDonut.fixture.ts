// The portfolio allocation donut (charts C4): top three slices in palette slots 1-3, the
// tail folded into one neutral Other. Its bottom legend is a declared exemption.
import type { ChartFixture } from './_types'
import { donutOption } from '../../components/portfolio/allocationChartOptions'

const fixture: ChartFixture = {
  name: 'allocationDonut',
  kind: 'pie',
  ariaLabel: 'Donut chart of portfolio share by holding type',
  exempt: ['grid', 'axis', 'legend'],
  build: () =>
    donutOption(
      {
        by: 'type',
        total_market_value: '10400.00',
        slices: [
          { key: 'etf', market_value: '5000.00', weight_pct: '0.48', holdings: 2 },
          { key: 'stock', market_value: '3000.00', weight_pct: '0.29', holdings: 3 },
          { key: 'private', market_value: '2000.00', weight_pct: '0.19', holdings: 1 },
          { key: 'mutual_fund', market_value: '400.00', weight_pct: '0.04', holdings: 1 },
        ],
      },
      true,
    ),
}
export default fixture
