// Pure option builder for the projection chart — no React, no fetching, no theme
// decisions of its own (historyChartOptions.ts posture). Number() here is display-only:
// the server's Decimal strings are parsed once and never handed back to the API.
import type { EChartsOption } from '../../charts/echarts'
import { MUTED, PALETTE } from '../../charts/theme'
import { timeZoom } from '../../charts/timeZoom'
import type { NetWorthTimeseries, ProjectionOut } from '../../types/api'
import { formatCurrency, formatCurrencyCompact, formatMonth } from '../../utils/format'
import { addMonths } from '../../utils/months'
import { monthSerial } from './polyTrend'
import type { PolyTrendFit } from './polyTrend'

// Series names in series order — the projected balance, the same growth with the
// contributions turned off, and the threshold.
export const PROJECTION_SERIES = ['Projected', 'Growth only', 'FI target'] as const

// The two band labels the legend admits. The outer band is drawn as TWO washes (below
// p25 and above p75) that share this one name-stem; only the lower one is named exactly
// `BAND_SERIES[0]`, the upper wears the `-upper` suffix and stays out of the legend.
export const BAND_SERIES = ['10–90% band', '25–75% band'] as const

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
export function projectionOption(
  data: Pick<ProjectionOut, 'months' | 'projected' | 'coast' | 'fi_target' | 'bands'>,
): EChartsOption | null {
  if (data.months.length < 2) return null
  const target = data.fi_target === null ? null : Number(data.fi_target)
  const bands = data.bands ?? null
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
          // All the projection's own blue: uncertainty about one entity wears that
          // entity's hue (theme law — never a new hue). Tooltip-silent: a stacked wash's
          // own value is a diff, so the chart-level projectionTooltipFormatter
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
              data: p10,
            },
            wash(BAND_SERIES[0], diff(p25, p10), 0.1),
            wash(BAND_SERIES[1], diff(p75, p25), 0.18),
            wash(`${BAND_SERIES[0]}-upper`, diff(p90, p75), 0.1),
          ]
        })()
  return {
    // ctrl+wheel / drag-pan over a 30-year axis; the horizon knob changes the window.
    dataZoom: timeZoom(data.months, 'all'),
    grid: { left: 76, right: 24, top: 40, bottom: 28 },
    // Listed explicitly so the invisible base and the duplicate upper wash stay OUT: an
    // automatic legend would offer "mc-base" and two "10–90%" entries. Accepted echarts
    // stack quirk — toggling the outer entry hides only the LOWER outer wash, since the
    // upper one is a separate (legend-hidden) series in the same stack.
    legend: {
      top: 0,
      data: [
        PROJECTION_SERIES[0],
        PROJECTION_SERIES[1],
        ...(target === null ? [] : [PROJECTION_SERIES[2]]),
        ...(bands === null ? [] : [...BAND_SERIES]),
      ],
    },
    // With bands, a full formatter reconstructs the percentile RANGES the silent washes
    // cannot say for themselves; without them, the plain per-value form stays —
    // byte-identical to the pre-Monte-Carlo chart (back-compat pin).
    tooltip:
      bands === null
        ? {
            trigger: 'axis',
            valueFormatter: (value) =>
              value === null || value === undefined ? '—' : formatCurrency(value as number),
          }
        : { trigger: 'axis', formatter: projectionTooltipFormatter(bands) },
    xAxis: { type: 'category', data: data.months.map(formatMonth), boundaryGap: false },
    yAxis: {
      // Zero-anchored: the projected line carries a wash, and a washed area over a
      // visible axis needs the honest baseline (historyChartOptions' rule).
      type: 'value',
      axisLabel: { formatter: (value: number) => formatCurrencyCompact(value) },
    },
    series: [
      // Bands first: series order is paint order, and the lines belong on top.
      ...bandSeries,
      {
        name: PROJECTION_SERIES[0],
        type: 'line',
        symbol: 'none',
        lineStyle: { width: 2 },
        color: PALETTE[0],
        areaStyle: { opacity: 0.12 },
        data: data.projected.map(Number),
      },
      {
        name: PROJECTION_SERIES[1],
        type: 'line',
        symbol: 'none',
        lineStyle: { width: 2 },
        color: PALETTE[1],
        data: data.coast.map(Number),
      },
      ...(target === null
        ? []
        : [
            {
              name: PROJECTION_SERIES[2],
              type: 'line' as const,
              symbol: 'none' as const,
              lineStyle: { width: 2, type: 'dashed' as const },
              color: MUTED,
              z: 9,
              data: data.months.map(() => target),
            },
          ]),
    ],
  }
}

// Series names in series order — the measured months and the fitted extrapolation.
export const NET_WORTH_PROJECTION_SERIES = ['Net worth', 'Quadratic trend'] as const

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
): EChartsOption | null {
  if (history.months.length < 2) return null
  const last = history.months[history.months.length - 1]
  const end = addMonths(startMonth, years * 12)
  // A future-dated snapshot at or past the horizon end just empties the continuation.
  const count = Math.max(0, monthSerial(end) - monthSerial(last))
  const future = Array.from({ length: count }, (_, i) => addMonths(last, i + 1))
  const months = [...history.months, ...future]
  // The log axis below cannot place zero or below — such points become gaps (NaN keeps
  // the arrays plain number[]; echarts treats NaN as an empty value), never lies.
  const positive = (value: number) => (value > 0 ? value : Number.NaN)
  return {
    dataZoom: timeZoom(months, 'all'),
    grid: { left: 76, right: 24, top: 40, bottom: 28 },
    legend: {
      top: 0,
      // The dot series wears a circle swatch so the two entries stay tellable apart.
      data: [
        { name: NET_WORTH_PROJECTION_SERIES[0], icon: 'circle' },
        { name: NET_WORTH_PROJECTION_SERIES[1] },
      ],
    },
    tooltip: {
      trigger: 'axis',
      valueFormatter: (value) =>
        value === null || value === undefined || Number.isNaN(value as number)
          ? '—'
          : formatCurrency(value as number),
    },
    xAxis: { type: 'category', data: months.map(formatMonth), boundaryGap: false },
    yAxis: {
      // Log scale (user-requested departure from the zero-anchored house rule — a log
      // axis HAS no zero): equal steps are equal multiples, so decades of growth can't
      // squash the early history into the floor.
      type: 'log',
      axisLabel: { formatter: (value: number) => formatCurrencyCompact(value) },
    },
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
              name: NET_WORTH_PROJECTION_SERIES[1],
              type: 'line' as const,
              symbol: 'none' as const,
              lineStyle: { width: 2 },
              color: PALETTE[1],
              z: 2,
              data: months.map((m) => positive(fit.valueAt(m))),
            },
          ]),
    ],
  }
}
