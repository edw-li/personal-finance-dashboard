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
 *  wider money labels · fanEndLabel: the fan with room for the pinned scenarios' end
 *  labels (planning-sandboxes §11). */
export const GRID_VARIANTS = {
  default: MONEY_GRID,
  noLegend: { left: 70, right: 24, top: 16, bottom: 28 },
  endLabel: { left: 70, right: 84, top: 40, bottom: 28 },
  horizontal: { left: 130, right: 40, top: 8, bottom: 28 },
  heatmap: { left: 130, right: 24, top: 8, bottom: 96 },
  fan: { left: 76, right: 24, top: 40, bottom: 28 },
  fanEndLabel: { left: 76, right: 84, top: 40, bottom: 28 },
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

/** echarts' own round-nice step (numberUtil.nice with round = true): 1, 2, 3, 5 or 10 × 10^k.
 *  An extent built from it lands on the grid echarts draws, so no odd extra label appears. */
export function niceStep(value: number): number {
  if (!(value > 0)) return 1
  const exp10 = 10 ** Math.floor(Math.log10(value))
  const f = value / exp10
  const nf = f < 1.5 ? 1 : f < 2.5 ? 2 : f < 4 ? 3 : f < 7 ? 5 : 10
  // Rounded to the step's own precision: 3 × 0.1 must be 0.3, not 0.30000000000000004.
  return Number((nf * exp10).toPrecision(12))
}

export interface RobustMax {
  max: number
  interval: number
}

/** The robust money-axis ceiling (2026-09-23 spec §C3): nice(p95 × 1.15) — applied ONLY when
 *  the data's max exceeds 1.5 × p95, so normal data is never clipped. p95 is nearest-rank over
 *  the positive values (a handful of points cannot call one of them an outlier). The max sits
 *  on its own interval, which the axis is given too: a max between echarts' ticks would print
 *  as one more crowded label (the savings chart's old "81%" over "0%"). */
export function robustMax(values: readonly (number | null | undefined)[]): RobustMax | null {
  const sorted = values
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const p95 = sorted[Math.max(0, Math.ceil(0.95 * sorted.length) - 1)]
  if (!(sorted[sorted.length - 1] > 1.5 * p95)) return null
  const target = p95 * 1.15
  const interval = niceStep(target / 5)
  return { max: Number((Math.ceil(target / interval - 1e-9) * interval).toPrecision(12)), interval }
}

/** Money value axis. `zero: false` (scale: true) is legal only on an UNWASHED line — a fill
 *  floating on a non-zero floor misrepresents (the price chart is the one case); `log` only
 *  on unwashed forms for the same reason (a log axis has no zero to anchor a wash on).
 *  `robust` (robustMax) caps the axis above an outlier; the builder marks what it clips. */
export function moneyAxis({
  zero = true,
  log = false,
  robust = null,
}: { zero?: boolean; log?: boolean; robust?: RobustMax | null } = {}) {
  return {
    type: log ? ('log' as const) : ('value' as const),
    ...(zero || log ? {} : { scale: true }),
    ...(robust === null ? {} : { max: robust.max, interval: robust.interval }),
    axisLabel: { formatter: compactMoney, hideOverlap: true },
  }
}

// Rate steps for a percent axis whose floor is fixed: each divides 1, so ticks counted from
// −100% always land on 0% and on the top.
const RATE_STEPS = [0.1, 0.2, 0.25, 0.5, 1]

/** Percent value axis. With `values` (the savings rate, 2026-09-23 spec §C3): the floor is FIXED
 *  at `floor` — a month below it is clipped and marked, never allowed to stretch the axis (Sep
 *  2023's −1,073% used to set it to −1100%) — and the max is a nice step above the data (never
 *  the data max itself, whose forced label collided with 0%), capped at `ceiling`, the step the
 *  first that keeps the frame at six intervals or fewer. Without values: the function extents
 *  the share charts use (the floor expands in whole −100% steps, 2026-08-31 A7). */
export function pctAxis(options: {
  floor?: number
  ceiling?: number
  values: readonly (number | null | undefined)[]
}): {
  type: 'value'
  min: number
  max: number
  interval: number
  axisLabel: { formatter: typeof percentLabel; hideOverlap: boolean }
}
export function pctAxis(options?: { floor?: number; ceiling?: number }): {
  type: 'value'
  min: (extent: { min: number }) => number
  max: (extent: { max: number }) => number
  axisLabel: { formatter: typeof percentLabel; hideOverlap: boolean }
}
export function pctAxis({
  floor = -1,
  ceiling = 1,
  values,
}: { floor?: number; ceiling?: number; values?: readonly (number | null | undefined)[] } = {}) {
  const axisLabel = { formatter: percentLabel, hideOverlap: true }
  if (values === undefined) {
    return {
      type: 'value' as const,
      min: (extent: { min: number }) => Math.min(floor, Math.floor(extent.min)),
      max: (extent: { max: number }) => Math.min(Math.max(extent.max, 0.1), ceiling),
      axisLabel,
    }
  }
  const finite = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  const top = Math.min(Math.max(0, ...finite), ceiling)
  const topFor = (step: number) => Math.min(ceiling, Math.max(step, Math.ceil(top / step - 1e-9) * step))
  const interval = RATE_STEPS.find((step) => (topFor(step) - floor) / step <= 6 + 1e-9) ?? 1
  return { type: 'value' as const, min: floor, max: Number(topFor(interval).toPrecision(12)), interval, axisLabel }
}

/** Clipped values drawn AT the edge (spec §C3): a small triangle pointing off the plot, labelled
 *  with the true value ("$25.9K ↑", "-1073% ↓") — the tooltip keeps the true value too, because
 *  the series data is never altered. `lift` stacks the label of a second clipped series at the
 *  same month so two labels never print over each other. Undefined when nothing is clipped. */
export function offScaleMarkPoint(
  marks: readonly { x: string; value: number; lift?: number }[],
  {
    edge,
    direction,
    color,
    unit,
  }: { edge: number; direction: 'up' | 'down'; color: string; unit: 'money' | 'percent' },
) {
  if (marks.length === 0) return undefined
  const format = unit === 'money' ? compactMoney : percentLabel
  const arrow = direction === 'up' ? '↑' : '↓'
  return {
    silent: true as const,
    symbol: 'triangle' as const,
    symbolSize: 8,
    symbolRotate: direction === 'up' ? 0 : 180,
    itemStyle: { color },
    label: {
      show: true as const,
      color: MUTED,
      fontSize: 11,
      // Inside the plot: above the edge sits the legend, below the floor the month axis.
      position: direction === 'up' ? ('bottom' as const) : ('top' as const),
    },
    data: marks.map((mark) => ({
      // echarts' MarkPointDataItemOption requires a name; the month it marks is the honest one.
      name: mark.x,
      coord: [mark.x, edge] as [string, number],
      value: mark.value,
      label: {
        formatter: `${format(mark.value)} ${arrow}`,
        ...(mark.lift ? { offset: [0, direction === 'up' ? mark.lift : -mark.lift] as [number, number] } : {}),
      },
    })),
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
