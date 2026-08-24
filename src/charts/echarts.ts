// Tree-shaken echarts surface: everything chart-related imports from HERE, never from
// 'echarts' directly (the full bundle is ~1MB; this registers only what the app draws).
import {
  BarChart,
  EffectScatterChart,
  HeatmapChart,
  LineChart,
  PieChart,
  SankeyChart,
  ScatterChart,
  TreemapChart,
} from 'echarts/charts'
import {
  DataZoomInsideComponent,
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
  SankeySeriesOption,
  ScatterSeriesOption,
  TreemapSeriesOption,
} from 'echarts/charts'
import type {
  DataZoomComponentOption,
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
  // Plain scatter for STILL annotation markers (net-worth notes). NOT effectScatter:
  // the ripple is the live-ping's reserved "this is now" signal, and a note is history.
  ScatterChart,
  HeatmapChart,
  PieChart,
  TreemapChart,
  // Flow cards on /spending and /paycheck (2026-08-24 sankey spec §2). Sankey lays out
  // in its own 'view' coordinate system — no grid/axis component to register.
  SankeyChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  VisualMapComponent,
  MarkLineComponent,
  // Inside-only zoom (src/charts/timeZoom.ts): the range chips cover the common windows,
  // ctrl+wheel / drag-pan fine-tunes. The slider flavour is deliberately NOT registered —
  // a 30px scrub bar under every chart is chrome the minimal theme does not want.
  DataZoomInsideComponent,
  UniversalTransition,
  CanvasRenderer,
])

echarts.registerTheme('finance', FINANCE_THEME)

export type EChartsOption = ComposeOption<
  | BarSeriesOption
  | LineSeriesOption
  | EffectScatterSeriesOption
  | ScatterSeriesOption
  | HeatmapSeriesOption
  | PieSeriesOption
  | TreemapSeriesOption
  | SankeySeriesOption
  | DataZoomComponentOption
  | GridComponentOption
  | TooltipComponentOption
  | LegendComponentOption
  | VisualMapComponentOption
>

export { echarts }
