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
  AriaComponent,
  DataZoomInsideComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components'
import * as echarts from 'echarts/core'
// Bar-to-pie morph for the spending month drill-in; keys off series ids across
// notMerge setOption calls. Inert when animation is off (reduced motion).
// (LabelLayout is deliberately NOT registered: the labelLayout option does not apply
// to sankey labels at all — full-bundle probe, 2026-08-25 — and nothing else here
// uses it. Sankey label collisions are prevented geometrically via SANKEY_MARKS'
// nodeGap instead.)
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
  AriaComponentOption,
  DataZoomComponentOption,
  GridComponentOption,
  LegendComponentOption,
  TooltipComponentOption,
  VisualMapComponentOption,
} from 'echarts/components'
import type { ComposeOption } from 'echarts/core'
// ResolvedTheme is declared with the palettes rather than in ThemeProvider so this file —
// the root of the lazy chart chunk — never names a module under components/ at all.
import { DARK, LIGHT, type ResolvedTheme } from '../theme/tokens'
import { FINANCE_THEME, buildTheme } from './theme'

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
  // Chart grammar (2026-09-04): the post-FI wash is a markArea, the p10/p50/p90 arrivals are
  // markPoints, and the opt-in textures ride the aria component's decal (Appearance › Chart
  // patterns). Registered here or they draw NOTHING in the tree-shaken build — the real-echarts
  // probes in C4/C5/C7 are what prove the registration, since jsdom never paints.
  MarkAreaComponent,
  MarkPointComponent,
  AriaComponent,
  // Inside-only zoom (src/charts/timeZoom.ts): the range chips cover the common windows,
  // ctrl+wheel / drag-pan fine-tunes. The slider flavour is deliberately NOT registered —
  // a 30px scrub bar under every chart is chrome the minimal theme does not want.
  DataZoomInsideComponent,
  UniversalTransition,
  CanvasRenderer,
])

echarts.registerTheme('finance', FINANCE_THEME)

/** 'finance' for the initial paint, 'finance-<n>' after the n-th palette change. */
export function themeName(version: number): string {
  return version === 0 ? 'finance' : `finance-${version}`
}

/** Registers the theme for a resolved palette under its versioned name and returns the
 *  name. Idempotent per name; ECharts overwrites a re-registration. */
export function registerThemeVersion(resolved: ResolvedTheme, version: number): string {
  const name = themeName(version)
  echarts.registerTheme(name, buildTheme(resolved === 'light' ? LIGHT : DARK))
  return name
}

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
  | AriaComponentOption
>

export { echarts }
