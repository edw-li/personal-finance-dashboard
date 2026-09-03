// Pure option builder for the comp page's TC trajectory — no React, no fetching, no theme
// decisions of its own. Reduced motion and the dark theme are the EChart wrapper's job
// (it forces `animation: false` after the spread), so everything here is data.
//
// Number() at this boundary is deliberate and display-only: comp_calc is pure-Decimal and
// the server already quantized every figure to cents, so the chart parses the strings ONCE
// here and never hands a float back to the API (src/utils/format.ts's rule, and the same
// posture as src/components/taxes/taxChartOptions.ts).
import type { EChartsOption } from '../../charts/echarts'
import { BAR_MARKS, grid, moneyAxis, monthAxis, roundTo, stagger } from '../../charts/grammar'
import { FOCUS, legendFor } from '../../charts/legend'
import { INK, PALETTE } from '../../charts/theme'
import { axisTooltip } from '../../charts/tooltip'
import type { CompEventOut } from '../../types/api'
import type { ExportTable } from '../../utils/download'

// Base and unvested equity are two KINDS of money, not two positions in an order, so they
// wear identity hues rather than a sequential ramp (the ramp in taxChartOptions encodes
// the fixed jurisdiction order; there is no order to encode here). Two slots, well inside
// the <=3-hue law, and the line takes INK — the same three roles as SpendingPage's stacked
// months under its net-pay line.
export const TC_COLORS = [PALETTE[0], PALETTE[1]] as const

// Series names, in series order: the two stack segments then the line over them.
//
// The second one is deliberately NOT "Unvested equity": that is a COLUMN of the table on
// the same page, and it holds `unvested_equity` alone, while this segment is
// `tc_after - base` — the same equity PLUS the year's refresh grant (2026: $412,924.46 in
// the legend against $333,882.96 in the column). Two different figures may not answer to
// one name on one screen, so the segment says which one it is.
export const TC_LABELS = ['Base', 'Equity value (incl. refresh)', 'Total comp'] as const

// The one sentence the chart is titled with, wherever it is mounted: TC here is a proxy
// (the sheet has no TC column), and saying which proxy is the whole honesty of the chart.
export const TC_CHART_LABEL = 'Base + unvested equity value'

/** The chart's rows — one computation for the option and the CSV. */
function trajectoryRows(events: CompEventOut[]) {
  // The router already orders by focal_year, but the chart owns its own x-axis order
  // rather than trusting it (trendOption's reasoning).
  const ordered = [...events].sort((a, b) => a.focal_year - b.focal_year)
  return ordered.map((e) => {
    const base = Number(e.new_base ?? e.current_base)
    const total = Number(e.tc_after)
    // Display-only rounding: the subtraction is float arithmetic (601854.46 - 188930 =
    // 412924.45999999996) and a stack segment is chart GEOMETRY, not a reported figure.
    return { year: e.focal_year, base, total, equity: roundTo(total - base, 2) }
  })
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
 * and it closes on the line by construction. It is therefore BOTH equity figures together,
 * which is what TC_LABELS[1] has to say out loud — the table's "Unvested equity" column is
 * only the first of them. A year with no equity columns at all charts base-only, with a
 * zero segment — `tc_after` is never null, so nothing can go missing.
 *
 * Returns null for an empty feed — the caller renders an empty note, the house pattern for
 * a builder with nothing to draw (taxChartOptions' `trendOption`).
 */
export function tcTrajectoryOption(
  events: CompEventOut[],
  { selected }: { selected?: Record<string, boolean> } = {},
): EChartsOption | null {
  if (events.length === 0) return null
  const rows = trajectoryRows(events)
  const stack = (name: string, index: number, data: number[]) => ({
    name,
    type: 'bar' as const,
    stack: 'tc',
    ...BAR_MARKS,
    barMaxWidth: 24,
    ...stagger(index),
    color: TC_COLORS[index],
    data,
  })
  return {
    grid: grid(),
    legend: legendFor(3, selected),
    // The two segments sum to the line, so a Total row would print the line twice.
    tooltip: axisTooltip({
      unit: 'money',
      groups: [TC_LABELS[0], TC_LABELS[1]],
      totalLabel: false,
      pointer: 'shadow',
    }),
    xAxis: monthAxis(
      rows.map((r) => String(r.year)),
      { gap: true },
    ),
    yAxis: moneyAxis(),
    series: [
      stack(
        TC_LABELS[0],
        0,
        rows.map((r) => r.base),
      ),
      stack(
        TC_LABELS[1],
        1,
        rows.map((r) => r.equity),
      ),
      {
        name: TC_LABELS[2],
        type: 'line',
        color: INK,
        symbolSize: 6,
        lineStyle: { width: 2 },
        z: 10,
        ...FOCUS,
        // tc_after is never null (current_base is NOT NULL and every missing side
        // contributes 0), so this only guards a feed that lost a row on the way here.
        connectNulls: false,
        data: rows.map((r) => r.total),
      },
    ],
  }
}

/** The trajectory as a table (F12): one row per focal year, the stack and its total. */
export function tcTrajectoryCsv(events: CompEventOut[]): ExportTable {
  return {
    headers: ['Focal year', ...TC_LABELS],
    rows: trajectoryRows(events).map((r) => [
      r.year,
      r.base.toFixed(2),
      r.equity.toFixed(2),
      r.total.toFixed(2),
    ]),
  }
}
