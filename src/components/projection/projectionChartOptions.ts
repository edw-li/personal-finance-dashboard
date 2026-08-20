// Pure option builder for the projection chart — no React, no fetching, no theme
// decisions of its own (historyChartOptions.ts posture). Number() here is display-only:
// the server's Decimal strings are parsed once and never handed back to the API.
import type { EChartsOption } from '../../charts/echarts'
import { MUTED, PALETTE } from '../../charts/theme'
import { timeZoom } from '../../charts/timeZoom'
import type { NetWorthTimeseries, ProjectionOut } from '../../types/api'
import { formatCurrency, formatCurrencyCompact, formatMonth } from '../../utils/format'
import { addMonths } from '../../utils/months'
import { monthSerial } from './expTrend'
import type { ExpTrendFit } from './expTrend'

// Series names in series order — the projected balance, the same growth with the
// contributions turned off, and the threshold.
export const PROJECTION_SERIES = ['Projected', 'Growth only', 'FI target'] as const

/**
 * Two trajectories and a threshold: projected (blue, the one wash — the money the plan
 * accumulates), growth-only "coast" (orange — what the balance does by itself, so the gap
 * between the lines is what the saving buys), and the FI target as a dashed MUTED
 * constant (dashed is reserved for thresholds — the 4%-rule line's own posture). Absent
 * target = two lines, no threshold. Returns null under two points.
 */
export function projectionOption(
  data: Pick<ProjectionOut, 'months' | 'projected' | 'coast' | 'fi_target'>,
): EChartsOption | null {
  if (data.months.length < 2) return null
  const target = data.fi_target === null ? null : Number(data.fi_target)
  return {
    // ctrl+wheel / drag-pan over a 30-year axis; the horizon knob changes the window.
    dataZoom: timeZoom(data.months, 'all'),
    grid: { left: 76, right: 24, top: 40, bottom: 28 },
    legend: { top: 0 },
    tooltip: {
      trigger: 'axis',
      valueFormatter: (value) =>
        value === null || value === undefined ? '—' : formatCurrency(value as number),
    },
    xAxis: { type: 'category', data: data.months.map(formatMonth), boundaryGap: false },
    yAxis: {
      // Zero-anchored: the projected line carries a wash, and a washed area over a
      // visible axis needs the honest baseline (historyChartOptions' rule).
      type: 'value',
      axisLabel: { formatter: (value: number) => formatCurrencyCompact(value) },
    },
    series: [
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
export const NET_WORTH_PROJECTION_SERIES = ['Net worth', 'Exponential trend'] as const

/**
 * The sheet's "Net Worth over Time (Projected)": actual snapshots as blue dots, the
 * exponential best-fit as a solid orange curve drawn over history AND the future (so
 * fit-vs-dots stays visible, like Excel's trendline), extended to the SAME final month
 * as the investable chart — one horizon per page. No wash: an area under a 30-year
 * exponential swallows the chart. A refused fit (null) drops the curve, never the dots —
 * the page's hint says why. Returns null under two points.
 */
export function netWorthProjectionOption(
  history: Pick<NetWorthTimeseries, 'months' | 'net_worth'>,
  fit: ExpTrendFit | null,
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
        value === null || value === undefined ? '—' : formatCurrency(value as number),
    },
    xAxis: { type: 'category', data: months.map(formatMonth), boundaryGap: false },
    yAxis: {
      // Zero-anchored (the house rule): the dots stand on an honest baseline.
      type: 'value',
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
        data: history.net_worth.map(Number),
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
              data: months.map((m) => fit.valueAt(m)),
            },
          ]),
    ],
  }
}
