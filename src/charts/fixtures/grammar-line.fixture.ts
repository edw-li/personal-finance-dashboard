import type { ChartFixture } from './_types'
import { LINE, WASH, grid, moneyAxis, monthAxis } from '../grammar'
import { PALETTE } from '../theme'
import { axisTooltip } from '../tooltip'

const fixture: ChartFixture = {
  name: 'grammar-line',
  kind: 'cartesian',
  ariaLabel: 'Synthetic: one washed line',
  build: () => ({
    grid: grid('noLegend'),
    xAxis: monthAxis(['Jun 2026', 'Jul 2026', 'Aug 2026']),
    yAxis: moneyAxis(),
    tooltip: axisTooltip({ unit: 'money' }),
    series: [{ ...LINE, name: 'Net worth', ...WASH, color: PALETTE[0], data: [1, 2, 3] }],
  }),
}
export default fixture
