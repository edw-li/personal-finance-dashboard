import type { ChartFixture } from './_types'
import { grid, monthAxis } from '../grammar'
import { sequentialVisualMap } from '../scales'
import { INK, SURFACE } from '../theme'
import { itemTooltip } from '../tooltip'
import { formatCurrencyCompact } from '../../utils/format'

const fixture: ChartFixture = {
  name: 'grammar-heatmap',
  kind: 'heatmap',
  ariaLabel: 'Synthetic: a two-row heatmap on the sequential scale',
  exempt: ['axis'],
  build: () => ({
    grid: grid('heatmap'),
    tooltip: itemTooltip<{ value?: [number, number, number] }>({ body: (p) => ({ value: p.value?.[2] ?? 0, label: 'cell' }) }),
    xAxis: monthAxis(['Jun 2026', 'Jul 2026'], { gap: true, rotate: 45 }),
    yAxis: { type: 'category', data: ['Rent', 'Food'], inverse: true, axisLabel: { width: 118, overflow: 'truncate' as const } },
    visualMap: sequentialVisualMap({ min: 0, max: 2000, formatter: formatCurrencyCompact }),
    series: [{ type: 'heatmap', data: [[0, 0, 2000], [1, 1, 600]], itemStyle: { borderColor: SURFACE, borderWidth: 1 }, emphasis: { itemStyle: { borderColor: INK, borderWidth: 1 } } }],
  }),
}
export default fixture
