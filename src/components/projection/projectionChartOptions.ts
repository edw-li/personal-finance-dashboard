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
import type { ZoomWindow } from '../../charts/timeZoom'
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
// and above p75) that carry the SAME name (F3), so one legend entry toggles both halves. Named
// for what they hold (2026-09-23 spec §R6) — the old "10–90% band" read like the reach dates'
// p10/p90, which mean the opposite edge.
export const BAND_SERIES = ['Middle 80% of paths', 'Middle 50% of paths'] as const

/** The fan's 50th percentile drawn as a hairline — where the median path actually runs,
 *  against the deterministic Projected line above it. */
export const MEDIAN_SERIES = 'Median path'

/** The payload's band keys — data, never words: a reader sees BAND_LABELS (2026-09-23 spec §R6,
 *  where "p10" meant the pessimistic balance and the optimistic reach date on one chart). */
export const BAND_KEYS = ['p10', 'p25', 'p50', 'p75', 'p90'] as const
export type BandKey = (typeof BAND_KEYS)[number]
export const BAND_LABELS: Record<BandKey, string> = {
  p10: '10th percentile balance',
  p25: '25th percentile balance',
  p50: 'Median balance',
  p75: '75th percentile balance',
  p90: '90th percentile balance',
}

const monthBucket = (iso: string) => `${iso.slice(0, 7)}-01`

/** The Historical trend's rule: a log axis cannot place zero or below, so such points become
 *  GAPS (NaN keeps the arrays plain number[]; echarts treats NaN as empty). The planning chart
 *  draws a depleted path at its floor instead (logFloor). */
const positive = (value: number) => (value > 0 ? value : Number.NaN)

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
        | 'retirements'
        | 'fi_month'
        | 'coast_fi_month'
        | 'fi_month_p10'
        | 'fi_month_p50'
        | 'fi_month_p90'
        | 'drawdown'
        | 'plan_until'
        | 'money_lasts'
      >
    > {
  target_values?: string[] | null
}

/** Under `log` a balance at or below zero has nowhere to stand. A path that ran out is drawn AT
 *  the axis floor — two decades under the starting balance — instead of dropping out of the
 *  chart, and the axis starts there (2026-09-23 spec §R7). */
export function logFloor(start: number): number {
  return start > 0 ? 10 ** (Math.floor(Math.log10(start)) - 2) : 1
}

// The reach marks in the reader's words (spec §R6): never "p10/p50/p90".
const REACH_MARKS = [
  ['1 in 10 paths', 'fi_month_p10'],
  ['Half of paths', 'fi_month_p50'],
  ['9 in 10 paths', 'fi_month_p90'],
] as const

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
  window?: ZoomWindow
}

export function projectionOption(
  data: ProjectionOptionInput,
  { log = false, selected, references: pinned = [], window }: ProjectionExtras = {},
): EChartsOption | null {
  if (data.months.length < 2) return null
  const target = data.fi_target === null ? null : Number(data.fi_target)
  const targetValues = data.target_values ?? (target === null ? null : data.months.map(() => String(target)))
  const bands = data.bands ?? null
  const labels = data.months.map(formatMonth)
  const lastLabel = labels[labels.length - 1]
  // Log: everything under the floor is drawn AT it (a depleted path, a pin that ran out), and
  // the axis starts there only when something sits on it. NaN (a pin's missing month) stays a gap.
  const floor = log ? logFloor(Number(data.projected[0])) : 0
  let floored = false
  const onScale = (values: number[]) =>
    log
      ? values.map((value) => {
          if (Number.isNaN(value) || value >= floor) return value
          floored = true
          return floor
        })
      : values

  // Rules and washes ride the ONE series every payload has, through the same fall-forward
  // anchor as the retirements; an unplaceable month (stale horizon) is dropped, never clamped.
  // The deterministic FI crossing stays as the constant-return annotation (spec §R6); the
  // withdrawals, the plan-until year and the month 9 in 10 paths last until are ruled while a
  // drawdown is modelled (spec §R7).
  const drawdownFrom = data.drawdown?.start_month ?? null
  const planUntil = drawdownFrom === null ? null : (data.money_lasts?.plan_until ?? data.plan_until ?? null)
  const lastsUntil = drawdownFrom === null ? null : (data.money_lasts?.lasts_until_p10 ?? null)
  const rules = annotationRules([
    ...retirementEntries(data.months, data.retirements ?? []),
    arrivalRule(data.months, drawdownFrom, 'Withdrawals start'),
    arrivalRule(data.months, data.fi_month ?? null, 'FI at a constant return'),
    arrivalRule(data.months, data.coast_fi_month ?? null, 'Coast FI'),
    arrivalRule(data.months, planUntil === null ? null : `${planUntil}-12-01`, `Plan until ${planUntil}`),
    arrivalRule(data.months, lastsUntil, '9 in 10 paths last to here'),
  ])
  // The retired months wear the wash (replacing "After FI", which showed contributions still
  // compounding after FI): from the last retirement on, the plan withdraws.
  const retiredLabel = anchorMonthLabel(data.months, drawdownFrom)
  const area = retiredLabel === undefined ? undefined : afterArea(retiredLabel, lastLabel, 'Retired')
  // The reach arrivals sit ON the target line, so no target means nothing to mark.
  const marks =
    target === null
      ? []
      : REACH_MARKS.flatMap(([name, key]) => {
          const label = anchorMonthLabel(data.months, data[key] ?? null)
          return label === undefined
            ? []
            : [{ name, label, value: Number(targetValues?.[labels.indexOf(label)] ?? target), detail: `${name} reach FI by ${label}` }]
        })

  const bandSeries =
    bands === null
      ? []
      : (() => {
          // Every edge goes through the log floor FIRST, so each wash keeps a floor to stand on
          // (a depleted path's $0 is drawn at the floor) and the diffs never go negative.
          const low10 = onScale(bands.p10.map(Number))
          const low25 = onScale(bands.p25.map(Number))
          const high75 = onScale(bands.p75.map(Number))
          const high90 = onScale(bands.p90.map(Number))
          // Stacked washes: an invisible ABSOLUTE base at the 10th percentile, then DIFFS on top
          // of it — 25th−10th (outer), 75th−25th (inner), 90th−75th (outer). echarts sums the
          // stack, so the three washes land on the 25th / 75th / 90th and each one fills the gap
          // below itself. Two opacities read as the middle 50 % of paths vs the middle 80 %.
          const diff = (hi: number[], lo: number[]) => hi.map((v, i) => v - lo[i])
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
            data: values,
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
              data: low10,
            },
            wash(BAND_SERIES[0], diff(low25, low10), 0.1),
            wash(BAND_SERIES[1], diff(high75, low25), 0.18),
            // The SAME name as the lower outer wash (F3): one legend entry toggles both halves.
            wash(BAND_SERIES[0], diff(high90, high75), 0.1),
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
    const at = (values: string[] | undefined) => Number(values?.[index])
    const range = (label: string, low: number, high: number) =>
      Number.isFinite(low) && Number.isFinite(high)
        ? [`${swatch(PALETTE[0], { wash: true })}${label}: ${formatCurrency(low)} – ${formatCurrency(high)}`]
        : []
    // The real balances, never the floored drawing: a path that ran out reads $0.00 here.
    return [
      ...range(BAND_SERIES[0], at(bands.p10), at(bands.p90)),
      ...range(BAND_SERIES[1], at(bands.p25), at(bands.p75)),
    ]
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
              onScale(targetValues!.map(Number)),
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
    dataZoom: window ? [{ ...timeZoom(data.months, 'all')[0], ...window }] : timeZoom(data.months, 'all'),
    // A NAMED variant either way (conformance checks grids by variant, never by literal):
    // the fan, or the fan with room for the pin names past the last month.
    grid: grid(references.length === 0 ? 'fan' : 'fanEndLabel'),
    // Listed explicitly so the invisible base stays OUT; the two outer washes share one name
    // and therefore one entry.
    legend: { ...legendFor(legendData.length, selected), data: legendData },
    // Pins are reference series, so they read as references in the hover too (spec §11):
    // muted rows under the live scenario's, never mixed in with it.
    tooltip: axisTooltip({
      unit: 'money',
      references: [PROJECTION_SERIES[2], ...references.map((ref) => ref.name)],
      footer: bandLines,
    }),
    xAxis: monthAxis(labels),
    yAxis: { ...moneyAxis({ log }), ...(log && floored ? { min: floor } : {}) },
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

/** The projection as a table (2026-08-25 spec §2a): month rows × projected/coast, plus the
 * fan's percentile balances when the Monte Carlo is on — verbatim server strings, headed in
 * the reader's words (BAND_LABELS), never "p10". */
export function projectionCsv(
  data: Pick<ProjectionOut, 'months' | 'projected' | 'coast' | 'bands'> & {
    target_values?: string[] | null
    display_dollars?: 'today' | 'future'
    start_month?: string
  },
  references: ProjectionReference[] = [],
): ExportTable {
  const bands = data.bands ?? null
  const percentiles: readonly BandKey[] = data.display_dollars ? BAND_KEYS : [BAND_KEYS[0], BAND_KEYS[2], BAND_KEYS[4]]
  const hasTarget = data.target_values !== undefined
  const unit = data.display_dollars === 'future' ? 'USD · future dollars'
    : `USD · ${data.start_month?.slice(0, 7) ?? 'today'} dollars`
  const name = (label: string) => data.display_dollars ? `${label} (${unit})` : label
  return {
    headers: ['Month', name('Projected'), name('Growth only'), ...(hasTarget ? [name('FI target')] : []), ...(bands ? percentiles.map((key) => name(BAND_LABELS[key])) : []), ...references.map((ref) => name(ref.name))],
    rows: data.months.map((month, i) => [
      month,
      data.projected[i],
      data.coast[i],
      ...(hasTarget ? [data.target_values?.[i] ?? ''] : []),
      ...(bands ? percentiles.map((key) => bands[key]?.[i] ?? '') : []),
      ...references.map((ref) => ref.data[i] && Number.isFinite(Number(ref.data[i])) ? ref.data[i] : ''),
    ]),
  }
}
