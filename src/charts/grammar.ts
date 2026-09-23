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

/** One clipped point: its position on the category axis, its label, its true value. */
export interface OffScalePoint {
  index: number
  x: string
  value: number
}

/** One edge marker. `lift` raises its label clear of another series' label; `label: false`
 *  keeps the triangle without the text. */
export interface OffScaleMark {
  x: string
  value: number
  lift?: number
  label?: boolean
}

/** The share of the visible window one off-scale label needs: about 60 px of a half-width
 *  card's 420 px plot. Clipped months closer together than that share one label. It is a
 *  fraction, not pixels, because a builder cannot know the card (§C4), and a fraction
 *  follows the zoom. */
export const OFF_SCALE_LABEL_SHARE = 1 / 7

/** Month gap below which clipped points share one label, for `visible` months on screen. */
export const offScaleGap = (visible: number) => Math.max(1, Math.ceil(visible * OFF_SCALE_LABEL_SHARE))

/** Which edge markers carry their true-value label, over EVERY series clipped at one edge
 *  (spec §C3; `series[k]` holds series k's clipped points in axis order). Labels are selective,
 *  so they never print over each other. Points of any series fewer than `minGap` months apart
 *  chain into one cluster, and each series labels only its most extreme point in a cluster.
 *  The rest keep their triangle, and the tooltip keeps every true value. A series whose cluster
 *  an earlier series already labels is lifted clear of it, unless both would print the same
 *  text at the same month: that reads as one label. */
export function offScaleMarks(
  series: readonly (readonly OffScalePoint[])[],
  {
    direction,
    minGap,
    lift,
    text,
  }: { direction: 'up' | 'down'; minGap: number; lift: number; text: (value: number) => string },
): OffScaleMark[][] {
  const everyPoint = series
    .flatMap((points, k) => points.map((point) => ({ point, k })))
    .sort((a, b) => a.point.index - b.point.index)
  const clusterOf = new Map<OffScalePoint, number>()
  let cluster = -1
  let previous = Number.NEGATIVE_INFINITY
  for (const { point } of everyPoint) {
    if (point.index - previous >= minGap) cluster += 1
    clusterOf.set(point, cluster)
    previous = point.index
  }
  const further = (a: OffScalePoint, b: OffScalePoint) =>
    (direction === 'down' ? b.value < a.value : b.value > a.value) ? b : a
  const labelled = series.map((points) => {
    const best = new Map<number, OffScalePoint>()
    for (const point of points) {
      const c = clusterOf.get(point) as number
      const held = best.get(c)
      best.set(c, held === undefined ? point : further(held, point))
    }
    return best
  })
  return series.map((points, k) =>
    points.map((point) => {
      const c = clusterOf.get(point) as number
      if (labelled[k].get(c) !== point) return { x: point.x, value: point.value, label: false }
      const clear = labelled
        .slice(0, k)
        .map((best) => best.get(c))
        .filter((other): other is OffScalePoint => other !== undefined)
        .filter((other) => !(other.index === point.index && text(other.value) === text(point.value))).length
      return clear === 0 ? { x: point.x, value: point.value } : { x: point.x, value: point.value, lift: lift * clear }
    }),
  )
}

/** Clipped values drawn AT the edge (spec §C3): a small triangle pointing off the plot, labelled
 *  with the true value ("$25.9K ↑", "-1073% ↓") — the tooltip keeps the true value too, because
 *  the series data is never altered. `lift` stacks the label of a second clipped series at the
 *  same place so two labels never print over each other; `label: false` (offScaleMarks, one
 *  label per cluster) keeps the triangle alone. Undefined when nothing is clipped. */
export function offScaleMarkPoint(
  marks: readonly OffScaleMark[],
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
      label:
        mark.label === false
          ? { show: false as const }
          : {
              formatter: `${format(mark.value)} ${arrow}`,
              ...(mark.lift ? { offset: [0, direction === 'up' ? mark.lift : -mark.lift] as [number, number] } : {}),
            },
    })),
  }
}

// ── Month labels that never collide (2026-09-23 spec §C4) ──────────────────────────────────
// A builder cannot know pixels, so a MONTH axis carries a branded formatter and EChart fits it
// to the measured card (fitMonthAxes) before every paint, on resize and on every zoom. The
// thresholds are the chart font's own measurements (12px Segoe UI): the widest neighbouring
// pair of each form — "Aug 2026" 50.7px beside "Sep 2026*" 53.9px; "Nov '25" 40.8px beside
// "Dec" 20.2px; "2025" 25.9px beside "Nov" 21.8px — half their sum, plus the 2px a side of
// textMargin month axes carry. (echarts 6 pads every axis label 3px a side before hideOverlap
// tests it — with that default, twelve short months drop a label on the Overview at 1280.)
const MONTH_TEXT_MARGIN = [0, 2]
const MONTH_LABEL = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})$/

/** "Oct 2025" on every month. */
export const MONTH_LABEL_FULL_PX = 57
/** "Oct" — the first visible label and each January as "Oct '25" / "Jan '26". */
export const MONTH_LABEL_SHORT_PX = 35
/** "Oct" — the first visible label and each January replaced by the year itself, "2026". */
export const MONTH_LABEL_COMPACT_PX = 28
/** The partial-period marker a month label carries (spec §C5); the tooltip says the words. */
export const PARTIAL_MARK = '*'

/** full · short · compact as above; sparse: every label "Oct '25", and echarts thins them. */
export type MonthLabelMode = 'full' | 'short' | 'compact' | 'sparse'

/** The form a month label takes when each month gets `spacing` pixels. */
export function monthLabelMode(spacing: number): MonthLabelMode {
  if (spacing >= MONTH_LABEL_FULL_PX) return 'full'
  if (spacing >= MONTH_LABEL_SHORT_PX) return 'short'
  if (spacing >= MONTH_LABEL_COMPACT_PX) return 'compact'
  return 'sparse'
}

/** The text one month category prints. `index` is its position inside the VISIBLE window —
 *  echarts hands category formatters `tick - windowStart` — so "the first label" is the first
 *  one on screen. Tooltips keep the full month: they read the category, not this text. A label
 *  that is not "Mmm YYYY" passes through untouched. */
export function monthTick(label: string, index: number, mode: MonthLabelMode, marked = false): string {
  const match = MONTH_LABEL.exec(label)
  if (match === null) return label
  const mark = marked ? PARTIAL_MARK : ''
  if (mode === 'full') return `${label}${mark}`
  const [, month, year] = match
  const anchor = index === 0 || month === 'Jan'
  if (mode === 'compact') return `${anchor ? year : month}${mark}`
  const withYear = mode === 'sparse' || anchor
  return `${withYear ? `${month} '${year.slice(2)}` : month}${mark}`
}

interface MonthAxisMeta {
  marked: ReadonlySet<string>
  rotated: boolean
}
// The brand: a WeakMap from formatter to its axis facts — invisible to EChart's JSON
// fingerprint and to recolor (functions pass through both by identity).
const MONTH_AXES = new WeakMap<object, MonthAxisMeta>()
const NO_MARKS: ReadonlySet<string> = new Set<string>()

function monthFormatter(mode: MonthLabelMode, meta: MonthAxisMeta) {
  const formatter = (value: string, index: number) => monthTick(value, index, mode, meta.marked.has(value))
  MONTH_AXES.set(formatter, meta)
  return formatter
}

/** Category axis of month (or date) labels. Lines touch the card edges (`boundaryGap:
 *  false`, the default); bars pass `gap: true` and keep echarts' default gap — the key is
 *  omitted so a bar option's axis stays as it was. Twelve categories or fewer label every one
 *  (a year of months must not skip alternate labels) until EChart fits the axis to its width.
 *  Month labels ("Mmm YYYY") get the grammar's formatter — full until fitted — and the
 *  overlap guard; `marked` months (in progress, spec §C5) carry PARTIAL_MARK. Any other
 *  labels (years, steps, dates) keep exactly the axis they always had. */
export function monthAxis(
  labels: string[],
  { gap = false, rotate, marked }: { gap?: boolean; rotate?: number; marked?: ReadonlySet<string> } = {},
) {
  const months = labels.length > 0 && labels.every((label) => MONTH_LABEL.test(label))
  const axisLabel = {
    ...(months
      ? {
          formatter: monthFormatter('full', { marked: marked ?? NO_MARKS, rotated: rotate !== undefined }),
          hideOverlap: true,
          textMargin: [...MONTH_TEXT_MARGIN],
        }
      : {}),
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

/** A grid length in pixels: a number, or a percent of the container. */
function gridPx(value: unknown, width: number): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const n = parseFloat(value)
    if (!Number.isFinite(n)) return 0
    return value.trim().endsWith('%') ? (width * n) / 100 : n
  }
  return 0
}

/** Fit every month axis in `option` to a container `width` pixels wide (spec §C4): each
 *  month gets plot width ÷ visible months (÷ one fewer on a line, whose ends sit on the
 *  plot's edges), and its label form follows monthLabelMode — every label shown while they
 *  fit, echarts' own thinning (plus the overlap guard) once they cannot. `zoom` is the live
 *  window EChart reads back; the option's own dataZoom otherwise. Rotated axes (the heatmap)
 *  and non-month axes are left alone; so is everything when the width is unknown (0). The
 *  input is never mutated. `key` names the fitted forms, so a caller refits only on change. */
export function fitMonthAxes(
  option: object,
  width: number,
  zoom?: { startValue: number; endValue: number } | null,
): { option: typeof option; key: string } {
  if (!(width > 0)) return { option, key: '' }
  const o = option as Record<string, unknown>
  const single = !Array.isArray(o.xAxis)
  const axes = (single ? (o.xAxis === undefined ? [] : [o.xAxis]) : o.xAxis) as Record<string, unknown>[]
  const grids = (Array.isArray(o.grid) ? o.grid : [o.grid ?? {}]) as Record<string, unknown>[]
  const zooms = (Array.isArray(o.dataZoom) ? o.dataZoom : o.dataZoom === undefined ? [] : [o.dataZoom]) as {
    startValue?: unknown
    endValue?: unknown
  }[]
  const keys: string[] = []
  let fitted = false
  const next = axes.map((axis, index) => {
    const label = (axis.axisLabel ?? {}) as Record<string, unknown>
    const meta = typeof label.formatter === 'function' ? MONTH_AXES.get(label.formatter) : undefined
    const count = Array.isArray(axis.data) ? axis.data.length : 0
    if (meta === undefined || meta.rotated || count === 0) {
      keys.push('-')
      return axis
    }
    const grid = grids[typeof axis.gridIndex === 'number' ? axis.gridIndex : 0] ?? {}
    const plot = grid.width !== undefined ? gridPx(grid.width, width) : width - gridPx(grid.left, width) - gridPx(grid.right, width)
    // The zoom a single-axis chart carries applies to its first axis (rangeZoom's contract).
    const preset = zooms[0]
    const start = index === 0 ? (zoom?.startValue ?? (typeof preset?.startValue === 'number' ? preset.startValue : 0)) : 0
    const end = index === 0 ? (zoom?.endValue ?? (typeof preset?.endValue === 'number' ? preset.endValue : count - 1)) : count - 1
    const visible = Math.max(1, Math.min(end, count - 1) - Math.max(start, 0) + 1)
    const spacing = plot / (axis.boundaryGap === false ? Math.max(visible - 1, 1) : visible)
    const mode = monthLabelMode(spacing)
    keys.push(mode)
    fitted = true
    return { ...axis, axisLabel: { ...label, formatter: monthFormatter(mode, meta), interval: mode === 'sparse' ? 'auto' : 0 } }
  })
  if (!fitted) return { option, key: '' }
  return { option: { ...o, xAxis: single ? next[0] : next }, key: keys.join('|') }
}

// ── Partial periods (2026-09-23 spec §C5) ──────────────────────────────────────────────────
// The spec's objective rule (§0): a month whose last day is after today is in progress. The
// treatment reuses the chart-patterns switch (useChartDecals): hatched when patterns are on —
// echarts textures every series then, so the partial item gets the estimate hatch instead of
// its series' — faded otherwise; a dashed outline both ways. Averages already leave it out.

/** The estimate hatch (the vesting chart's own values): 45° surface-coloured lines over the
 *  fill — a token hex, so the light recolor and the conformance colour rule both hold. */
export const ESTIMATE_DECAL = {
  symbol: 'rect' as const,
  symbolSize: 1,
  dashArrayX: [1, 0],
  dashArrayY: [2, 4],
  rotation: -Math.PI / 4,
  color: SURFACE,
}

/** The partial look on one bar, cell or point in `color` (its outline's). */
export function partialItemStyle(color: string, patterns: boolean) {
  const outline = { borderColor: color, borderWidth: 1, borderType: 'dashed' as const }
  return patterns ? { ...outline, decal: ESTIMATE_DECAL } : { ...outline, opacity: 0.45 }
}

/** The last day of an ISO month ('2026-09-01' → '2026-09-30'), by string math — never a
 *  Date parse (format.ts's UTC-shift rule); the y/m/d constructor is local and safe. */
function lastDayOf(month: string): string {
  const year = Number(month.slice(0, 4))
  const monthNumber = Number(month.slice(5, 7))
  const days = new Date(year, monthNumber, 0).getDate()
  return `${month.slice(0, 7)}-${String(days).padStart(2, '0')}`
}

/** In progress: the month's last day is after `todayIso` (spec §0, §C5). */
export function isPartialMonth(month: string, todayIso: string): boolean {
  return lastDayOf(month) > todayIso.slice(0, 10)
}

/** What a partial month's tooltip head adds: "month to date (in progress)" for the month under
 *  way, "future month (in progress)" for a draft ahead of it; null for a finished month. */
export function partialNote(month: string, todayIso: string): string | null {
  if (!isPartialMonth(month, todayIso)) return null
  return month.slice(0, 7) === todayIso.slice(0, 7) ? 'month to date (in progress)' : 'future month (in progress)'
}

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
