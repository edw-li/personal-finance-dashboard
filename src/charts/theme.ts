// THE chart color source of truth for BUILDERS: the dark constants below are the DARK
// tokens (src/theme/tokens.ts) and stay hard-coded in options on purpose — under a light
// theme EChart recolors the finished option through charts/recolor.ts, so no builder ever
// branches on theme. dataviz-validated 2026-08-14 on surface #171a21 (lightness band,
// chroma, adjacent CVD dE 8.4, normal-vision 19.3, contrast >= 3:1). Fixed slot order IS
// the CVD-safety mechanism — never reorder, never cycle past 8, never invent a hue outside
// tokens.ts.
import { DARK, type ThemeTokens } from '../theme/tokens'
import type { AccountGroup } from '../types/api'

export const PALETTE = DARK.palette

// Groups wear fixed entity colors (stack adjacency = validated palette adjacency).
export const GROUP_COLORS: Record<AccountGroup, string> = {
  cash: PALETTE[0],
  pre_tax: PALETTE[1],
  post_tax: PALETTE[2],
  taxable: PALETTE[3],
  equity: PALETTE[4],
  other: PALETTE[5],
  liability: PALETTE[7],
}

export const GROUP_LABELS: Record<AccountGroup, string> = {
  cash: 'Cash',
  pre_tax: 'Pre-tax',
  post_tax: 'Post-tax',
  taxable: 'Taxable',
  equity: 'Equity',
  other: 'Other',
  liability: 'Liabilities',
}

export const GROUP_ORDER: AccountGroup[] = [
  'cash', 'pre_tax', 'post_tax', 'taxable', 'equity', 'other', 'liability',
]

// Sequential blue, dark -> light on the dark surface (near-zero recedes to the card).
export const SEQUENTIAL_BLUE = DARK.sequential

// Neutral gray for the folded "Other" stack — 3.6:1 on the surface (was #4a5060 at 2.16:1).
export const OTHER_SERIES_COLOR = DARK.otherSeries

export const INK = DARK.text
export const MUTED = DARK.muted
export const GRID_LINE = DARK.gridLine // one step off the card surface, solid hairline
export const AXIS_LINE = DARK.axisLine
export const SURFACE = DARK.surface
export const SURFACE_2 = DARK.surface2
export const POSITIVE = DARK.positive
export const NEGATIVE = DARK.negative

const FONT_FAMILY = "system-ui, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

/** The ECharts theme object for a token set — registered per resolved theme by
 *  charts/echarts.ts (`registerThemeVersion`). */
export function buildTheme(t: ThemeTokens) {
  return {
    color: [...t.palette],
    backgroundColor: 'transparent',
    textStyle: { color: t.muted, fontFamily: FONT_FAMILY },
    categoryAxis: {
      axisLine: { lineStyle: { color: t.axisLine } },
      axisTick: { show: false },
      axisLabel: { color: t.muted },
      splitLine: { show: false },
    },
    valueAxis: {
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: t.muted },
      splitLine: { lineStyle: { color: t.gridLine, width: 1, type: 'solid' as const } },
    },
    legend: {
      textStyle: { color: t.text, fontSize: 12 },
      icon: 'roundRect',
      itemWidth: 12,
      itemHeight: 8,
    },
    tooltip: {
      backgroundColor: t.surface2,
      borderColor: t.axisLine,
      borderWidth: 1,
      textStyle: { color: t.text, fontSize: 12 },
      extraCssText: 'box-shadow: 0 4px 16px rgba(0,0,0,0.4); border-radius: 8px;',
    },
    // echarts 6's default visualMap label token (#54555a) is ~2.3:1 on our surface and
    // does not follow textStyle — pin it here so heatmaps don't compensate per-page.
    visualMap: { textStyle: { color: t.muted } },
  }
}

// Registered by src/charts/echarts.ts as 'finance' at import — the bare fallback for any
// init that happens before/without registerThemeVersion. NOT a standing guarantee that
// 'finance' holds DARK: 'finance' IS the version-0 name, so a boot under a persisted light
// theme re-registers that same name with buildTheme(LIGHT) (EChart registers the palette
// it is about to init with, every time).
export const FINANCE_THEME = buildTheme(DARK)
