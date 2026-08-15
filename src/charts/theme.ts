// THE chart color source of truth. dataviz-validated 2026-08-14 on surface #171a21
// (all six checks pass: lightness band, chroma, adjacent CVD dE 8.4, normal-vision 19.3,
// contrast >= 3:1). Fixed slot order IS the CVD-safety mechanism — never reorder, never
// cycle past 8, never invent a hue outside this file.
import type { AccountGroup } from '../types/api'

export const PALETTE = [
  '#3987e5', // 1 blue
  '#d95926', // 2 orange
  '#199e70', // 3 aqua
  '#c98500', // 4 yellow
  '#d55181', // 5 magenta
  '#008300', // 6 green
  '#9085e9', // 7 violet
  '#e66767', // 8 red
] as const

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
export const SEQUENTIAL_BLUE = [
  '#0d366b', '#104281', '#184f95', '#1c5cab', '#256abf', '#2a78d6',
  '#3987e5', '#5598e7', '#6da7ec', '#86b6ef', '#9ec5f4', '#cde2fb',
] as const

export const OTHER_SERIES_COLOR = '#4a5060' // neutral gray for the folded "Other" stack

export const INK = '#e6e9ef'
export const MUTED = '#8b93a3'
export const GRID_LINE = '#1e222c' // one step off the card surface, solid hairline
export const AXIS_LINE = '#262b36'
export const SURFACE = '#171a21'
export const SURFACE_2 = '#1e222c'
export const POSITIVE = '#3fb968'
export const NEGATIVE = '#e05252'

const FONT_FAMILY = "system-ui, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

// Registered once by src/charts/echarts.ts.
export const FINANCE_THEME = {
  color: [...PALETTE],
  backgroundColor: 'transparent',
  textStyle: { color: MUTED, fontFamily: FONT_FAMILY },
  categoryAxis: {
    axisLine: { lineStyle: { color: AXIS_LINE } },
    axisTick: { show: false },
    axisLabel: { color: MUTED },
    splitLine: { show: false },
  },
  valueAxis: {
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: MUTED },
    splitLine: { lineStyle: { color: GRID_LINE, width: 1, type: 'solid' } },
  },
  legend: {
    textStyle: { color: INK, fontSize: 12 },
    icon: 'roundRect',
    itemWidth: 12,
    itemHeight: 8,
  },
  tooltip: {
    backgroundColor: SURFACE_2,
    borderColor: AXIS_LINE,
    borderWidth: 1,
    textStyle: { color: INK, fontSize: 12 },
    extraCssText: 'box-shadow: 0 4px 16px rgba(0,0,0,0.4); border-radius: 8px;',
  },
}
