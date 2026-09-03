// The cartesian grammar every builder composes from (chart spec §8, §13). Every value is
// today's literal, so a migrated builder's dark option is byte-identical unless the spec
// names the change (§9 adds `emphasis.focus`; F13 shrinks the tax/comp bars to 24 through
// the waterfall helper and BAR_MARKS's cap). conformance.ts checks grids by VARIANT and
// axis formatters by IDENTITY, so builders reference these — never re-spell them.
// How it is used: `grid('endLabel')`, `yAxis: moneyAxis()`, `xAxis: monthAxis(labels)`,
// `{ ...LINE, name, color, data }`, `{ type: 'bar', ...BAR_MARKS, ...stagger(i), stack }`.
// Depends on: charts/theme.ts (dark constants), utils/format.ts (the two label formatters).
import { INK, MUTED, SURFACE } from './theme'
import { formatCurrencyCompact, formatPct } from '../utils/format'

export const MONEY_GRID = { left: 70, right: 24, top: 40, bottom: 28 } as const

/** The named grids — the ONLY grids a cartesian builder may emit. default: legend row on
 *  top · noLegend: single series · endLabel: room for the net-worth end label · horizontal:
 *  category y-axis with 118px labels (card values, the bracket ladder) · heatmap: category
 *  y-axis + rotated month labels + the visualMap bar under them · fan: the projection's
 *  wider money labels. */
export const GRID_VARIANTS = {
  default: MONEY_GRID,
  noLegend: { left: 70, right: 24, top: 16, bottom: 28 },
  endLabel: { left: 70, right: 84, top: 40, bottom: 28 },
  horizontal: { left: 130, right: 40, top: 8, bottom: 28 },
  heatmap: { left: 130, right: 24, top: 8, bottom: 96 },
  fan: { left: 76, right: 24, top: 40, bottom: 28 },
} as const

export type GridVariant = keyof typeof GRID_VARIANTS
export interface Grid {
  left: number
  right: number
  top: number
  bottom: number
}

/** A fresh copy of a variant (builders sometimes spread onto it; the constants stay frozen). */
export function grid(variant: GridVariant = 'default'): Grid {
  return { ...GRID_VARIANTS[variant] }
}

/** Conformance's grid rule: exactly one of the named shapes, no extra keys. */
export function isGridVariant(candidate: unknown): candidate is Grid {
  if (candidate === null || typeof candidate !== 'object') return false
  const c = candidate as Record<string, unknown>
  if (Object.keys(c).length !== 4) return false
  return Object.values(GRID_VARIANTS).some(
    (g) => g.left === c.left && g.right === c.right && g.top === c.top && g.bottom === c.bottom,
  )
}

/** Compact money ticks ($1.2K, $1.45M) — THE money axis formatter (§13), passed by reference. */
export const compactMoney = (value: number): string => formatCurrencyCompact(value)
/** Whole-percent ticks (§13) — THE percent axis formatter. */
export const percentLabel = (value: number): string =>
  formatPct(value, { signed: false, decimals: 0 })

/** Money value axis. `zero: false` (scale: true) is legal only on an UNWASHED line — a fill
 *  floating on a non-zero floor misrepresents (the price chart is the one case); `log` only
 *  on unwashed forms for the same reason (a log axis has no zero to anchor a wash on). */
export function moneyAxis({ zero = true, log = false }: { zero?: boolean; log?: boolean } = {}) {
  return {
    type: log ? ('log' as const) : ('value' as const),
    ...(zero || log ? {} : { scale: true }),
    axisLabel: { formatter: compactMoney },
  }
}

/** Percent value axis with the savings-rate extents: the ceiling stays where rates stop
 *  being possible, the floor expands to the data in whole −100% steps (2026-08-31 A7). */
export function pctAxis({ floor = -1, ceiling = 1 }: { floor?: number; ceiling?: number } = {}) {
  return {
    type: 'value' as const,
    min: (extent: { min: number }) => Math.min(floor, Math.floor(extent.min)),
    max: (extent: { max: number }) => Math.min(Math.max(extent.max, 0.1), ceiling),
    axisLabel: { formatter: percentLabel },
  }
}

/** Category axis of month (or date) labels. Lines touch the card edges (`boundaryGap:
 *  false`, the default); bars pass `gap: true` and keep echarts' default gap — the key is
 *  omitted so today's bar options stay byte-identical. Twelve categories or fewer label
 *  every one (a year of months must not skip alternate labels). */
export function monthAxis(
  labels: string[],
  { gap = false, rotate }: { gap?: boolean; rotate?: number } = {},
) {
  const axisLabel = {
    ...(labels.length <= 12 ? { interval: 0 } : {}),
    ...(rotate === undefined ? {} : { rotate }),
  }
  return {
    type: 'category' as const,
    data: labels,
    ...(gap ? {} : { boundaryGap: false }),
    ...(Object.keys(axisLabel).length > 0 ? { axisLabel } : {}),
  }
}

/** Daily-date categories read exactly like months: no gap, every label under 13 points. */
export const dateAxis = (labels: string[]) => monthAxis(labels)

/** Every bar: the surface hairline that separates stack segments (and insets a lone bar so
 *  it reads as the same family), the 22px cap, INK on hover, and series focus (§9). */
export const BAR_MARKS = {
  barMaxWidth: 22,
  itemStyle: { borderColor: SURFACE, borderWidth: 1 },
  emphasis: { focus: 'series' as const, itemStyle: { borderColor: INK } },
}

/** A direct label on a bar's cap (the waterfall's amounts, the tax trend's rate — F15). */
export function capLabel(formatter: (params: { dataIndex: number }) => string) {
  return { show: true as const, position: 'top' as const, color: MUTED, fontSize: 11, formatter }
}

/** Every data line: 2px, no symbols, series focus (§9). Spread first, then name/color/data. */
export const LINE = {
  type: 'line' as const,
  symbol: 'none' as const,
  lineStyle: { width: 2 },
  emphasis: { focus: 'series' as const },
}

/** The house visible-axis wash under a primary line (net-worth trend, portfolio value). */
export const WASH = { areaStyle: { opacity: 0.12 } }
/** A stacked-area member: hairline stroke, half-opaque fill (the net-worth stack). */
export const STACK_WASH = { lineStyle: { width: 1 }, areaStyle: { opacity: 0.5 } }

/** Display-only rounding for DERIVED chart geometry — a stack segment, a running remainder,
 *  a rate × 100. Float arithmetic on the server's cent-quantized strings leaves dust
 *  (601854.46 − 188930 = 412924.45999999996), and dust must never reach an axis label or a
 *  tooltip. Never applied to a reported figure: those are rendered as they arrived. */
export function roundTo(value: number, places: number): number {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}
export const cents = (value: number): number => roundTo(value, 2)

/** Per-series entrance delay for stacked bars (§11): 12ms × series index. A FUNCTION so it
 *  is invisible to EChart's JSON fingerprint — the zoom fast path must not see a changed
 *  option when only the delay closure is fresh. */
export function stagger(seriesIndex: number) {
  return { animationDelay: () => seriesIndex * 12 }
}
