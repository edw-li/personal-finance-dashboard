// Pure option builder for the projection chart — no React, no fetching, no theme
// decisions of its own (historyChartOptions.ts posture). Number() here is display-only:
// the server's Decimal strings are parsed once and never handed back to the API.
import type { EChartsOption } from '../../charts/echarts'
import { MUTED, PALETTE } from '../../charts/theme'
import { timeZoom } from '../../charts/timeZoom'
import type { ProjectionOut } from '../../types/api'
import { formatCurrency, formatCurrencyCompact, formatMonth } from '../../utils/format'

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
