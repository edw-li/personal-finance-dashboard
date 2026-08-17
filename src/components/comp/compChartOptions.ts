// Pure option builder for the comp page's TC trajectory — no React, no fetching, no theme
// decisions of its own. Reduced motion and the dark theme are the EChart wrapper's job
// (it forces `animation: false` after the spread), so everything here is data.
//
// Number() at this boundary is deliberate and display-only: comp_calc is pure-Decimal and
// the server already quantized every figure to cents, so the chart parses the strings ONCE
// here and never hands a float back to the API (src/utils/format.ts's rule, and the same
// posture as src/components/taxes/taxChartOptions.ts).
import type { EChartsOption } from '../../charts/echarts'
import { INK, PALETTE, SURFACE } from '../../charts/theme'
import type { CompEventOut } from '../../types/api'
import { formatCurrency, formatCurrencyCompact } from '../../utils/format'

// Base and unvested equity are two KINDS of money, not two positions in an order, so they
// wear identity hues rather than a sequential ramp (the ramp in taxChartOptions encodes
// the fixed jurisdiction order; there is no order to encode here). Two slots, well inside
// the <=3-hue law, and the line takes INK — the same three roles as SpendingPage's stacked
// months under its net-pay line.
export const TC_COLORS = [PALETTE[0], PALETTE[1]] as const

// Series names, in series order: the two stack segments then the line over them.
export const TC_LABELS = ['Base', 'Unvested equity', 'Total comp'] as const

// The one sentence the chart is titled with, wherever it is mounted: TC here is a proxy
// (the sheet has no TC column), and saying which proxy is the whole honesty of the chart.
export const TC_CHART_LABEL = 'Base + unvested equity value'

// Display-only rounding, for the ONE derived quantity on this chart. The subtraction is
// float arithmetic (601854.46 - 188930 = 412924.45999999996) and a stack segment is chart
// GEOMETRY rather than a reported figure, so it lands back on cents here — no dust reaches
// an axis label or a tooltip (taxChartOptions' `roundTo`).
function roundTo(value: number, places: number): number {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

/**
 * One stacked bar per focal year — base at the floor, the unvested equity value above it —
 * with the server's `tc_after` drawn as a line across the tops.
 *
 * The floor is `new_base ?? current_base`, which is the SAME selection `tc_after` was
 * built from (see CompEventOut's note): taking `current_base` instead would report a
 * year's raise as extra equity, because the difference has to land somewhere.
 *
 * Equity is `tc_after - base` rather than `unvested_equity + equity_delta` re-added here:
 * the server owns the total (global rule 9), so the stack is the total minus its own floor
 * and it closes on the line by construction. A year with no equity columns at all charts
 * base-only, with a zero segment — `tc_after` is never null, so nothing can go missing.
 *
 * Returns null for an empty feed — the caller renders an empty note, the house pattern for
 * a builder with nothing to draw (taxChartOptions' `trendOption`).
 */
export function tcTrajectoryOption(events: CompEventOut[]): EChartsOption | null {
  if (events.length === 0) return null
  // The router already orders by focal_year, but the chart owns its own x-axis order
  // rather than trusting it (trendOption's reasoning).
  const ordered = [...events].sort((a, b) => a.focal_year - b.focal_year)
  const bases = ordered.map((e) => Number(e.new_base ?? e.current_base))
  const totals = ordered.map((e) => Number(e.tc_after))
  const equity = totals.map((total, i) => roundTo(total - bases[i], 2))

  return {
    grid: { left: 70, right: 24, top: 40, bottom: 28 },
    legend: { top: 0 },
    tooltip: {
      trigger: 'axis',
      // One unit for all three series, so the single valueFormatter covers them
      // (SpendingPage's bars tooltip). No user text reaches this tooltip at all — the
      // categories are years and the series names are this file's own constants.
      valueFormatter: (value) =>
        value === null || value === undefined ? '—' : formatCurrency(value as number),
    },
    xAxis: { type: 'category', data: ordered.map((e) => String(e.focal_year)) },
    yAxis: {
      type: 'value',
      axisLabel: { formatter: (value: number) => formatCurrencyCompact(value) },
    },
    series: [
      {
        name: TC_LABELS[0],
        type: 'bar',
        stack: 'tc',
        barMaxWidth: 46,
        color: TC_COLORS[0],
        itemStyle: { borderColor: SURFACE, borderWidth: 1 },
        emphasis: { itemStyle: { borderColor: INK } },
        data: bases,
      },
      {
        name: TC_LABELS[1],
        type: 'bar',
        stack: 'tc',
        barMaxWidth: 46,
        color: TC_COLORS[1],
        itemStyle: { borderColor: SURFACE, borderWidth: 1 },
        emphasis: { itemStyle: { borderColor: INK } },
        data: equity,
      },
      {
        name: TC_LABELS[2],
        type: 'line',
        color: INK,
        symbolSize: 6,
        lineStyle: { width: 2 },
        z: 10,
        // tc_after is never null (current_base is NOT NULL and every missing side
        // contributes 0), so this only guards a feed that lost a row on the way here.
        connectNulls: false,
        data: totals,
      },
    ],
  }
}
