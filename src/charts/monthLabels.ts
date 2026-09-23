// Month category axes (2026-09-23 spec §C4): the label forms, the branded formatter and the fit
// to a measured width. Moved out of grammar.ts, which re-exports every symbol. No dependencies.

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
/** "Oct" — each January replaced by the year itself, "2026"; the first visible label still
 *  "Oct '25", and the overlap guard gives it its neighbour's room. */
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
 *  one on screen, and it always carries the month AND the year (spec §C4: a bare "2025" under
 *  October reads as January). Tooltips keep the full month: they read the category, not this
 *  text. A label that is not "Mmm YYYY" passes through untouched. */
export function monthTick(label: string, index: number, mode: MonthLabelMode, marked = false): string {
  const match = MONTH_LABEL.exec(label)
  if (match === null) return label
  const mark = marked ? PARTIAL_MARK : ''
  if (mode === 'full') return `${label}${mark}`
  const [, month, year] = match
  const monthYear = `${month} '${year.slice(2)}`
  if (index === 0 || mode === 'sparse') return `${monthYear}${mark}`
  if (month === 'Jan') return `${mode === 'compact' ? year : monthYear}${mark}`
  return `${month}${mark}`
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
 *  overlap guard; `marked` months (in progress, spec §C5) carry PARTIAL_MARK, and an axis with
 *  one always shows its LAST label: the month in progress is the latest, and when echarts thins
 *  the labels (All ranges, the heatmap) its mark must not be the one thinned away. Any other
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
          ...(marked !== undefined && marked.size > 0 ? { showMaxLabel: true } : {}),
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
