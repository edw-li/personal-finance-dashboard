// Pure option builder for the projection chart — no React, no fetching, no theme
// decisions of its own (historyChartOptions.ts posture). Number() here is display-only:
// the server's Decimal strings are parsed once and never handed back to the API.
import type { EChartsOption } from '../../charts/echarts'
import { LINE, WASH, grid, moneyAxis, monthAxis } from '../../charts/grammar'
import { legendFor } from '../../charts/legend'
import {
  afterArea,
  annotationRules,
  anchorMonthLabel,
  arrivalRule,
  percentileMarks,
  ruleAt,
} from '../../charts/markLine'
import { referenceLine } from '../../charts/reference'
import { MUTED, PALETTE } from '../../charts/theme'
import { timeZoom } from '../../charts/timeZoom'
import { axisTooltip, swatch } from '../../charts/tooltip'
import type { NetWorthTimeseries, ProjectionOut } from '../../types/api'
import type { ExportTable } from '../../utils/download'
import { formatCurrency, formatMonth } from '../../utils/format'
import { addMonths } from '../../utils/months'
import { monthSerial } from './polyTrend'
import type { PolyTrendFit } from './polyTrend'

// Series names in series order — the projected balance, the same growth with the
// contributions turned off, and the threshold.
export const PROJECTION_SERIES = ['Projected', 'Growth only', 'FI target'] as const

// The two band labels the legend admits. The outer band is drawn as TWO washes (below p25
// and above p75) that carry the SAME name (F3), so one legend entry toggles both halves.
export const BAND_SERIES = ['10–90% band', '25–75% band'] as const

/** The fan's 50th percentile drawn as a hairline — where the median path actually runs,
 *  against the deterministic Projected line above it. */
export const MEDIAN_SERIES = 'Median path'

const monthBucket = (iso: string) => `${iso.slice(0, 7)}-01`

/** A log axis cannot place zero or below — such points become GAPS (NaN keeps the arrays
 *  plain number[]; echarts treats NaN as empty), never a clamped lie. Both builders on this
 *  page ride a log axis, so the rule has one owner. */
const positive = (value: number) => (value > 0 ? value : Number.NaN)

// The runtime shape for trigger:'axis' params (historyChartOptions' subset posture).
interface AxisTooltipParam {
  seriesName?: string
  marker?: string
  axisValueLabel?: string
  dataIndex?: number
  value?: unknown
}

// The band rows' swatch: the fan's own blue at wash-like strength, echarts-marker
// shaped, so a range row reads as belonging to the fan rather than to a line.
const BAND_MARKER =
  '<span style="display:inline-block;margin-right:4px;border-radius:10px;' +
  `width:10px;height:10px;background-color:${PALETTE[0]};opacity:0.3;"></span>`

/**
 * Exported for tests. The wash series stay tooltip-silent because a stacked wash's own
 * value is a DIFF (p75−p25) — meaningless as a hover number — so the RANGES are
 * reconstructed here from the percentile arrays by dataIndex instead (2026-08-20 user
 * revision: hover must answer "what's the band here", not just name the lines). Rows
 * whose value is not a finite number (a padded null) are dropped, the padded-row rule
 * historyTooltipFormatter set. Every string is an own constant or a formatted server
 * number — no user text reaches this HTML.
 */
export function projectionTooltipFormatter(
  bands: Record<string, string[]>,
): (params: unknown) => string {
  return (params: unknown) => {
    const list = (Array.isArray(params) ? params : [params]) as AxisTooltipParam[]
    const rows = list.filter((p) => typeof p.value === 'number' && Number.isFinite(p.value))
    if (rows.length === 0) return ''
    const head = `<strong>${rows[0].axisValueLabel ?? ''}</strong>`
    const lines = rows.map(
      (p) => `${p.marker ?? ''}${p.seriesName ?? ''}: ${formatCurrency(p.value as number)}`,
    )
    const index = rows[0].dataIndex
    if (typeof index === 'number') {
      const at = (key: string) => Number(bands[key]?.[index])
      const range = (label: string, low: number, high: number) =>
        Number.isFinite(low) && Number.isFinite(high)
          ? `${BAND_MARKER}${label}: ${formatCurrency(low)} – ${formatCurrency(high)}`
          : null
      // The legend's own order: the wide band first, the tight one under it.
      for (const line of [
        range(BAND_SERIES[0], at('p10'), at('p90')),
        range(BAND_SERIES[1], at('p25'), at('p75')),
      ]) {
        if (line !== null) lines.push(line)
      }
    }
    return [head, ...lines].join('<br/>')
  }
}

/** The annotation shape — narrow on purpose, so the test can read it without echarts'
 *  `any`-ish option types (the MarriageMarkLine posture). */
export interface RetirementMarkLine {
  silent: true
  symbol: 'none'
  lineStyle: { color: string; width: number; type: 'dashed' }
  label: { show: true; position: 'insideEndTop'; color: string; fontSize: number }
  data: { xAxis: string; label: { formatter: string } }[]
}

/**
 * One dashed vertical rule per echoed retirement, each labelled with that person's name
 * — the wedding annotation's grammar, shared through charts/markLine.ts rather than
 * copied. The step at each rule is REAL (the contribution stream drops there), so it has
 * to read as intentional rather than as a kink in the data.
 *
 * The server has already fenced every month onto this axis, so the fall-forward anchor is
 * only a guard for a stale payload whose horizon shrank: a rule that cannot be placed is
 * DROPPED, never clamped onto a month the retirement is not in.
 */
/** Retirement rules as entries — `retirementMarkLine` (kept, pinned) wraps them. */
export function retirementEntries(
  months: string[],
  retirements: { month: string; name: string }[],
) {
  return retirements.map((r) => ruleAt(months, r.month, r.name, formatMonth, monthBucket))
}

export function retirementMarkLine(
  months: string[],
  retirements: { month: string; name: string }[],
): RetirementMarkLine | undefined {
  return annotationRules(retirementEntries(months, retirements)) as RetirementMarkLine | undefined
}

/**
 * Two trajectories and a threshold: projected (blue, the one wash — the money the plan
 * accumulates), growth-only "coast" (orange — what the balance does by itself, so the gap
 * between the lines is what the saving buys), and the FI target as a dashed MUTED
 * constant (dashed is reserved for thresholds — the 4%-rule line's own posture). Absent
 * target = two lines, no threshold. Returns null under two points.
 *
 * With Monte Carlo `bands` on the payload the same chart grows a fan: four stacked
 * series drawn FIRST (so the three real lines stay on top of their own uncertainty).
 */
export interface ProjectionOptionInput
  extends Pick<ProjectionOut, 'months' | 'projected' | 'coast' | 'fi_target' | 'bands'>,
    Partial<
      Pick<
        ProjectionOut,
        'retirements' | 'fi_month' | 'coast_fi_month' | 'fi_month_p10' | 'fi_month_p50' | 'fi_month_p90'
      >
    > {}

/** A pinned scenario's deterministic line, drawn as a reference series (chart grammar §10):
 *  dashed MUTED, end-labelled with the pin's name. The fan stays the live scenario's. */
export interface ProjectionReference {
  name: string
  data: string[]
}

export interface ProjectionExtras {
  log?: boolean
  selected?: Record<string, boolean>
  references?: ProjectionReference[]
}

export function projectionOption(
  data: ProjectionOptionInput,
  { log = false, selected, references: pinned = [] }: ProjectionExtras = {},
): EChartsOption | null {
  if (data.months.length < 2) return null
  const target = data.fi_target === null ? null : Number(data.fi_target)
  const bands = data.bands ?? null
  const labels = data.months.map(formatMonth)
  const lastLabel = labels[labels.length - 1]
  const onScale = (values: number[]) => (log ? values.map(positive) : values)

  // Rules and washes ride the ONE series every payload has. FI/Coast FI arrive through the
  // same fall-forward anchor as the retirements; an unplaceable month (stale horizon) is
  // dropped, never clamped.
  const fiLabel = anchorMonthLabel(data.months, data.fi_month ?? null)
  const rules = annotationRules([
    ...retirementEntries(data.months, data.retirements ?? []),
    arrivalRule(data.months, data.fi_month ?? null, 'FI'),
    arrivalRule(data.months, data.coast_fi_month ?? null, 'Coast FI'),
  ])
  const area = fiLabel === undefined ? undefined : afterArea(fiLabel, lastLabel, 'After FI')
  // The percentile arrivals sit ON the target line, so no target means nothing to mark.
  const marks =
    target === null
      ? []
      : (
          [
            ['p10', data.fi_month_p10],
            ['p50', data.fi_month_p50],
            ['p90', data.fi_month_p90],
          ] as const
        ).flatMap(([name, iso]) => {
          const label = anchorMonthLabel(data.months, iso ?? null)
          return label === undefined ? [] : [{ name, label, value: target }]
        })

  const bandSeries =
    bands === null
      ? []
      : (() => {
          const p10 = bands.p10.map(Number)
          const p25 = bands.p25.map(Number)
          const p75 = bands.p75.map(Number)
          const p90 = bands.p90.map(Number)
          // Stacked washes: an invisible ABSOLUTE base at p10, then DIFFS on top of it —
          // p25−p10 (outer), p75−p25 (inner), p90−p75 (outer). echarts sums the stack, so
          // the three washes land on p25 / p75 / p90 and each one fills the gap below
          // itself. Two opacities read as "50% of paths" vs "80%".
          const diff = (hi: number[], lo: number[]) => hi.map((v, i) => v - lo[i])
          // A stacked wash is drawn from its floor up, and under `log` a floor at or below
          // zero has nowhere to stand — so a month whose p10 is non-positive drops out of
          // the fan ENTIRELY (all four members), rather than leaving three washes hanging
          // off an absent base.
          const unplaceable = p10.map((v) => log && v <= 0)
          const gap = (values: number[]) => values.map((v, i) => (unplaceable[i] ? Number.NaN : v))
          // All the projection's own blue: uncertainty about one entity wears that entity's
          // hue (theme law — never a new hue). Tooltip-silent — the footer below
          // reconstructs the real ranges from the percentile arrays instead.
          const wash = (name: string, values: number[], opacity: number) => ({
            name,
            type: 'line' as const,
            stack: 'mc-band',
            symbol: 'none' as const,
            lineStyle: { width: 0 },
            color: PALETTE[0],
            emphasis: { disabled: true },
            tooltip: { show: false },
            silent: true,
            areaStyle: { opacity },
            data: gap(values),
          })
          return [
            {
              name: 'mc-base',
              type: 'line' as const,
              stack: 'mc-band',
              symbol: 'none' as const,
              lineStyle: { width: 0 },
              color: 'transparent',
              emphasis: { disabled: true },
              tooltip: { show: false },
              silent: true,
              data: gap(p10),
            },
            wash(BAND_SERIES[0], diff(p25, p10), 0.1),
            wash(BAND_SERIES[1], diff(p75, p25), 0.18),
            // The SAME name as the lower outer wash (F3): one legend entry toggles both halves.
            wash(BAND_SERIES[0], diff(p90, p75), 0.1),
            {
              ...LINE,
              name: MEDIAN_SERIES,
              lineStyle: { width: 1 },
              color: PALETTE[0],
              data: onScale(bands.p50.map(Number)),
            },
          ]
        })()

  // The footer lines the silent washes cannot say for themselves (2026-08-20 user revision:
  // hover must answer "what's the band here", not just name the lines).
  const bandLines = (index: number): string[] => {
    if (bands === null) return []
    const at = (key: string) => Number(bands[key]?.[index])
    const range = (label: string, low: number, high: number) =>
      Number.isFinite(low) && Number.isFinite(high)
        ? [`${swatch(PALETTE[0], { wash: true })}${label}: ${formatCurrency(low)} – ${formatCurrency(high)}`]
        : []
    return [...range(BAND_SERIES[0], at('p10'), at('p90')), ...range(BAND_SERIES[1], at('p25'), at('p75'))]
  }

  // Pinned scenarios (planning-sandboxes spec §11): each one's deterministic line as a
  // reference series, end-labelled with the pin's own name so three dashed lines stay
  // tellable apart without a legend hunt. Same log guard as the data — a pin is on the
  // same axis, so a non-positive month is its gap too.
  const references = pinned.map((ref) => ({
    ...referenceLine(ref.name, onScale(ref.data.map(Number))),
    endLabel: { show: true, formatter: ref.name, color: MUTED, fontSize: 11 },
  }))

  const series = [
    // Bands first: series order is paint order, and the lines belong on top.
    ...bandSeries,
    {
      ...LINE,
      name: PROJECTION_SERIES[0],
      color: PALETTE[0],
      // A wash needs a zero to stand on; a log axis has none (§8).
      ...(log ? {} : WASH),
      ...(rules ? { markLine: rules } : {}),
      ...(area ? { markArea: area } : {}),
      data: onScale(data.projected.map(Number)),
    },
    { ...LINE, name: PROJECTION_SERIES[1], color: PALETTE[1], data: onScale(data.coast.map(Number)) },
    ...(target === null
      ? []
      : [
          {
            ...referenceLine(
              PROJECTION_SERIES[2],
              data.months.map(() => target),
            ),
            ...(marks.length > 0 ? { markPoint: percentileMarks(marks) } : {}),
          },
        ]),
    // Last: a pin is a comparison drawn over the answer, never under it.
    ...references,
  ]
  const legendData = [
    PROJECTION_SERIES[0],
    PROJECTION_SERIES[1],
    ...(target === null ? [] : [PROJECTION_SERIES[2]]),
    ...(bands === null ? [] : [MEDIAN_SERIES, ...BAND_SERIES]),
    ...references.map((ref) => ref.name),
  ]
  return {
    // ctrl+wheel / drag-pan over a 30-year axis; the horizon knob changes the window.
    dataZoom: timeZoom(data.months, 'all'),
    // The fan's own left inset (wider money labels); with pins on it, the endLabel
    // variant's right one (chart grammar §8) — room for their names past the last month.
    grid: references.length === 0 ? grid('fan') : { ...grid('fan'), right: grid('endLabel').right },
    // Listed explicitly so the invisible base stays OUT; the two outer washes share one name
    // and therefore one entry.
    legend: { ...legendFor(legendData.length, selected), data: legendData },
    tooltip: axisTooltip({ unit: 'money', references: [PROJECTION_SERIES[2]], footer: bandLines }),
    xAxis: monthAxis(labels),
    yAxis: moneyAxis({ log }),
    series,
  }
}

// Series names in series order — the measured months and the fitted extrapolation.
export const NET_WORTH_PROJECTION_SERIES = ['Net worth', 'Quadratic trend'] as const

/** The extended month axis both the option and the CSV walk: history, then every month to
 *  the horizon end — a future-dated snapshot at or past the end just empties the continuation. */
function projectionMonths(
  history: Pick<NetWorthTimeseries, 'months'>,
  startMonth: string,
  years: number,
): string[] {
  const last = history.months[history.months.length - 1]
  const end = addMonths(startMonth, years * 12)
  const count = Math.max(0, monthSerial(end) - monthSerial(last))
  return [...history.months, ...Array.from({ length: count }, (_, i) => addMonths(last, i + 1))]
}

/**
 * The sheet's "Net Worth over Time (Projected)": actual snapshots as blue dots, the
 * second-degree polynomial best-fit as a solid orange curve drawn over history AND the
 * future (so fit-vs-dots stays visible, like Excel's trendline), extended to the SAME
 * final month as the investable chart — one horizon per page. No wash (the curve is a
 * fit, not an accumulation). A refused fit (null) drops the curve, never the dots — the
 * page's hint says why. Returns null under two points.
 */
export function netWorthProjectionOption(
  history: Pick<NetWorthTimeseries, 'months' | 'net_worth'>,
  fit: PolyTrendFit | null,
  startMonth: string,
  years: number,
  { selected }: { selected?: Record<string, boolean> } = {},
): EChartsOption | null {
  if (history.months.length < 2) return null
  const months = projectionMonths(history, startMonth, years)
  // The dot series wears a circle swatch so the two entries stay tellable apart.
  const legendData = [
    { name: NET_WORTH_PROJECTION_SERIES[0], icon: 'circle' },
    { name: NET_WORTH_PROJECTION_SERIES[1] },
  ]
  return {
    dataZoom: timeZoom(months, 'all'),
    grid: grid('fan'),
    legend: { ...legendFor(legendData.length, selected), data: legendData },
    tooltip: axisTooltip({ unit: 'money' }),
    xAxis: monthAxis(months.map(formatMonth)),
    // Log scale (user-requested departure from the zero-anchored rule — a log axis HAS no
    // zero): equal steps are equal multiples, so decades of growth can't squash the early
    // history into the floor. Legal here because nothing is washed.
    yAxis: moneyAxis({ log: true }),
    series: [
      {
        name: NET_WORTH_PROJECTION_SERIES[0],
        type: 'scatter',
        symbolSize: 6,
        color: PALETTE[0],
        // Above the curve, so the dots stay visible where it passes through them.
        z: 3,
        data: history.net_worth.map((value) => positive(Number(value))),
      },
      ...(fit === null
        ? []
        : [
            {
              ...LINE,
              name: NET_WORTH_PROJECTION_SERIES[1],
              color: PALETTE[1],
              z: 2,
              data: months.map((m) => positive(fit.valueAt(m))),
            },
          ]),
    ],
  }
}

/** The trend chart as a table (F12): every axis month, the snapshot where one exists, the fit. */
export function netWorthProjectionCsv(
  history: Pick<NetWorthTimeseries, 'months' | 'net_worth'>,
  fit: PolyTrendFit | null,
  startMonth: string,
  years: number,
): ExportTable {
  const months = history.months.length === 0 ? [] : projectionMonths(history, startMonth, years)
  return {
    headers: ['Month', 'Net worth', 'Quadratic trend'],
    rows: months.map((m, i) => [
      m,
      history.net_worth[i] ?? '',
      fit === null ? '' : fit.valueAt(m).toFixed(2),
    ]),
  }
}

/** The projection as a table (2026-08-25 spec §2a): month rows × projected/coast, plus
 * p10/p50/p90 when the Monte Carlo fan is on — verbatim server strings. */
export function projectionCsv(
  data: Pick<ProjectionOut, 'months' | 'projected' | 'coast' | 'bands'>,
): ExportTable {
  const bands = data.bands ?? null
  return {
    headers: ['Month', 'Projected', 'Growth only', ...(bands ? ['p10', 'p50', 'p90'] : [])],
    rows: data.months.map((month, i) => [
      month,
      data.projected[i],
      data.coast[i],
      ...(bands ? [bands.p10?.[i] ?? '', bands.p50?.[i] ?? '', bands.p90?.[i] ?? ''] : []),
    ]),
  }
}
