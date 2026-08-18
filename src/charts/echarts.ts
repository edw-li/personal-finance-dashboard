// Tree-shaken echarts surface: everything chart-related imports from HERE, never from
// 'echarts' directly (the full bundle is ~1MB; this registers only what the app draws).
import {
  BarChart,
  EffectScatterChart,
  HeatmapChart,
  LineChart,
  PieChart,
  TreemapChart,
} from 'echarts/charts'
import {
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components'
import * as echarts from 'echarts/core'
// Bar-to-pie morph for the spending month drill-in; keys off series ids across
// notMerge setOption calls. Inert when animation is off (reduced motion).
import { UniversalTransition } from 'echarts/features'
import { CanvasRenderer } from 'echarts/renderers'
import type {
  BarSeriesOption,
  EffectScatterSeriesOption,
  HeatmapSeriesOption,
  LineSeriesOption,
  PieSeriesOption,
  TreemapSeriesOption,
} from 'echarts/charts'
import type {
  GridComponentOption,
  LegendComponentOption,
  TooltipComponentOption,
  VisualMapComponentOption,
} from 'echarts/components'
import type { ComposeOption } from 'echarts/core'
import { FINANCE_THEME } from './theme'

echarts.use([
  BarChart,
  LineChart,
  EffectScatterChart,
  HeatmapChart,
  PieChart,
  TreemapChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  VisualMapComponent,
  MarkLineComponent,
  UniversalTransition,
  CanvasRenderer,
])

echarts.registerTheme('finance', FINANCE_THEME)

export type EChartsOption = ComposeOption<
  | BarSeriesOption
  | LineSeriesOption
  | EffectScatterSeriesOption
  | HeatmapSeriesOption
  | PieSeriesOption
  | TreemapSeriesOption
  | GridComponentOption
  | TooltipComponentOption
  | LegendComponentOption
  | VisualMapComponentOption
>

export { echarts }
