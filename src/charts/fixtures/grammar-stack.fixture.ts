import type { ChartFixture } from './_types'
import { BAR_MARKS, LINE, grid, moneyAxis, monthAxis, stagger } from '../grammar'
import { legendFor } from '../legend'
import { referenceLine } from '../reference'
import { INK, PALETTE } from '../theme'
import { axisTooltip } from '../tooltip'

const fixture: ChartFixture = {
  name: 'grammar-stack',
  kind: 'cartesian',
  ariaLabel: 'Synthetic: two stacked bars under a line with a reference',
  build: () => ({
    grid: grid(),
    legend: legendFor(4),
    tooltip: axisTooltip({ unit: 'money', groups: ['Rent', 'Food'], shareOf: true, references: ['Budget'], pointer: 'shadow' }),
    xAxis: monthAxis(['Jun 2026', 'Jul 2026'], { gap: true }),
    yAxis: moneyAxis(),
    series: [
      { type: 'bar', name: 'Rent', stack: 'spend', ...BAR_MARKS, ...stagger(0), color: PALETTE[0], data: [2000, 2000] },
      { type: 'bar', name: 'Food', stack: 'spend', ...BAR_MARKS, ...stagger(1), color: PALETTE[1], data: [600, null] },
      { ...LINE, name: 'Net pay', color: INK, z: 10, connectNulls: false, data: [6000, 6000] },
      referenceLine('Budget', [500, 500], { step: 'end' }),
    ],
  }),
}
export default fixture
