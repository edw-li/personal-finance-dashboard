// The /spending month × category heatmap and its export (F1): three readings of the same cells,
// and the month in progress drawn as such (2026-09-23 spec §C5). Split out of
// spendingChartOptions.ts, which re-exports every symbol, under the same *ChartOptions law: no
// React, no fetching, only the grammar in src/charts.
import type { EChartsOption } from '../../charts/echarts'
import { compactMoney, grid, monthAxis } from '../../charts/grammar'
import { ESTIMATE_DECAL, markedLabels, PARTIAL_FILL_ALPHA, partialMonths, partialNote } from '../../charts/partial'
import { divergingVisualMap, rowNormalize, sequentialVisualMap, vsAverage } from '../../charts/scales'
import { INK, MUTED, SURFACE } from '../../charts/theme'
import { itemTooltip } from '../../charts/tooltip'
import type { SpendingMatrix } from '../../types/api'
import type { ExportTable } from '../../utils/download'
import { formatPct } from '../../utils/format'

export type HeatmapMode = 'absolute' | 'row' | 'vsAverage'
export const HEATMAP_MODES: { value: HeatmapMode; label: string }[] = [
  { value: 'absolute', label: 'Absolute' },
  { value: 'row', label: 'Row' },
  { value: 'vsAverage', label: 'vs average' },
]

const isDormant = (values: (string | null)[]) => values.every((v) => v === null || Number(v) === 0)

/** The rows to draw, in the page's order: dormant categories (never a cent in any month) sit
 *  behind the card's "Show N dormant" toggle so the matrix is as tall as the spending is. */
export function heatmapRows(
  matrix: Pick<SpendingMatrix, 'series'>,
  order: number[],
  showDormant: boolean,
): { visible: number[]; dormant: number[] } {
  const byId = new Map(matrix.series.map((s) => [s.category_id, s.values]))
  const dormant = order.filter((id) => isDormant(byId.get(id) ?? []))
  const dormantSet = new Set(dormant)
  return { visible: showDormant ? order : order.filter((id) => !dormantSet.has(id)), dormant }
}

/** rows[r][c] for the given row order — Number() once, nulls kept (absent ≠ zero). */
function heatmapMatrix(
  matrix: Pick<SpendingMatrix, 'months' | 'series'>,
  order: number[],
): (number | null)[][] {
  const byId = new Map(matrix.series.map((s) => [s.category_id, s.values]))
  return order.map((id) =>
    matrix.months.map((_, c) => {
      const v = byId.get(id)?.[c]
      return v === null || v === undefined ? null : Number(v)
    }),
  )
}

/** One cell of the month in progress (its own series, heatmapOption). */
interface InProgressCell {
  value: [number, number, number]
  itemStyle: {
    color?: string
    decal?: typeof ESTIMATE_DECAL
    borderColor?: string
    borderWidth?: number
    borderType?: 'dashed'
  }
}

export interface HeatmapInput {
  matrix: SpendingMatrix
  /** The VISIBLE rows (heatmapRows().visible) — row index r maps back to order[r]. */
  order: number[]
  nameById: Map<number, string>
  monthLabels: string[]
  mode: HeatmapMode
  /** The product's today: the month in progress's column is drawn partial (2026-09-23 spec
   *  §C5). Absent, no column is. */
  todayIso?: string | null
  /** Appearance › Chart patterns: that column hatched, not faded. */
  patterns?: boolean
}

/**
 * Month × category, one of three readings of the same cells (F1). Absolute: one shared dollar
 * scale. Row (default): each category against its own busiest month. vs average: each cell
 * against its trailing 12-month mean, orange above / blue below, blank until six prior months
 * exist. Hover keeps the RAW dollars in the lead; the mode's reading is the sub-line.
 */
export function heatmapOption({
  matrix, order, nameById, monthLabels, mode, todayIso = null, patterns = false,
}: HeatmapInput): EChartsOption | null {
  if (matrix.months.length === 0 || order.length === 0) return null
  const raw = heatmapMatrix(matrix, order)
  // 2026-09-23 spec §C5: the month in progress's column wears the partial look (the cell's
  // colour is the scale's, so the dashed outline is the neutral one). In the vs-average reading
  // it is not compared: a month to date against a whole month's average would read as a false
  // "below average" — the same reason the averages leave it out.
  const partial = partialMonths(matrix.months, todayIso)
  const legacyAverage = mode === 'vsAverage' ? vsAverage(raw) : []
  const comparison = mode === 'vsAverage' ? order.map((categoryId, row) => {
    const source = matrix.series.find(series => series.category_id === categoryId)
    if (source?.comparison_average === undefined) return legacyAverage[row]
    return raw[row].map((value, column) => {
      const base = source.comparison_average?.[column]
      if (value === null || base == null || Number(base) <= 0 || (source.comparison_count?.[column] ?? 0) < 6) return null
      return (value - Number(base)) / Number(base)
    })
  }) : []
  const values = mode === 'absolute' ? raw : mode === 'row' ? rowNormalize(raw) : comparison
  // The scale's own series holds the finished months; the month in progress rides a second one.
  const triples: [number, number, number][] = []
  values.forEach((row, r) =>
    row.forEach((v, c) => {
      if (v !== null && !partial[c]) triples.push([c, r, v])
    }),
  )
  // The column under way, in every reading. Absolute and row: a cell's fill is its scale's
  // colour and echarts has no fill-only opacity (an element's opacity fades the dashed outline
  // too — the 2026-09-23 review), so the cells sit under a hidden copy of the scale whose
  // colorAlpha fades the fill (charts/partial.ts PARTIAL_FILL_ALPHA); under Chart patterns the
  // copy keeps full strength and the cells are hatched. vs average: not compared, but there
  // (audit F1: a blank column read as "nothing entered") — neutral, hatched, saying why on hover.
  const outline = { borderColor: MUTED, borderWidth: 1, borderType: 'dashed' as const }
  const inProgress = raw.flatMap((row, r) =>
    row.flatMap<InProgressCell>((dollars, c) => {
      if (!partial[c] || dollars === null) return []
      if (mode === 'vsAverage') {
        return [{ value: [c, r, dollars] as [number, number, number], itemStyle: { color: MUTED, decal: ESTIMATE_DECAL } }]
      }
      const v = values[r][c]
      if (v === null) return []
      return [{ value: [c, r, v] as [number, number, number], itemStyle: patterns ? { ...outline, decal: ESTIMATE_DECAL } : outline }]
    }),
  )
  const rawMax = raw.reduce((m, row) => row.reduce<number>((mm, v) => (v === null ? mm : Math.max(mm, v)), m), 0)
  const maxAbs = triples.reduce((m, [, , v]) => Math.max(m, Math.abs(v)), 0)
  const visualMap =
    mode === 'absolute'
      ? sequentialVisualMap({ min: 0, max: Math.max(rawMax, 1), formatter: compactMoney })
      : mode === 'row'
        ? sequentialVisualMap({ min: 0, max: 1, formatter: (v) => `${Math.round(v * 100)}%`, labels: ['row max', '0'] })
        : divergingVisualMap({
            // Clamped between ±10% and ±100%: a quiet history must not paint noise as extremes.
            span: Math.min(1, Math.max(0.1, maxAbs)),
            formatter: (v) => formatPct(v, { decimals: 0 }),
            labels: ['above average', 'below average'],
            highArm: 'orange',
          })
  const name = (r: number) => nameById.get(order[r]) ?? String(order[r])
  return {
    grid: grid('heatmap'),
    tooltip: itemTooltip<{ value?: unknown }>({
      body: (p) => {
        // Defensive on the SHAPE, not just on null: a heatmap item param carries the
        // [col, row, value] triple, and destructuring anything else would throw inside a
        // formatter — where echarts has no boundary and the whole card would blank.
        const [c, r, v] = (Array.isArray(p.value) ? p.value : []) as [number, number, number]
        const dollars = raw[r]?.[c]
        if (dollars === null || dollars === undefined) return null
        const cell = `${name(r)} · ${monthLabels[c] ?? ''}`
        // The in-progress column in the vs-average reading: the dollars, and why there is no
        // comparison (audit F1).
        if (mode === 'vsAverage' && partial[c]) return { value: dollars, label: cell, sub: 'month to date — not compared' }
        // The in-progress words ride the month, as on the bars' tooltip head (spec §C5).
        const note = typeof todayIso === 'string' && partial[c] ? partialNote(matrix.months[c], todayIso) : null
        const label = `${cell}${note === null ? '' : ` — ${note}`}`
        if (mode === 'absolute') return { value: dollars, label }
        if (mode === 'row') return { value: dollars, label, sub: `${Math.round(v * 100)}% of this category’s busiest month` }
        return { value: dollars, label, sub: `${formatPct(v, { decimals: 0 })} vs its trailing 12-month average` }
      },
    }),
    xAxis: monthAxis(monthLabels, { gap: true, rotate: 45, marked: markedLabels(monthLabels, partial) }),
    yAxis: { type: 'category', data: order.map((_, r) => name(r)), inverse: true, axisLabel: { width: 118, overflow: 'truncate' as const } },
    // The visible scale colours the finished months only. echarts draws a heatmap series only
    // under a visualMap of its own (a real canvas throws "Heatmap must use with visualMap"
    // without one), so the in-progress series gets a hidden one: the scale's copy (same range,
    // same ramp, the fill faded unless hatched) or, vs average, a map that paints every cell
    // the one neutral — continuous, because a piecewise map with open-ended pieces throws too
    // (esppChartOptions).
    visualMap:
      inProgress.length > 0
        ? [
            { ...visualMap, seriesIndex: 0 },
            mode === 'vsAverage'
              ? {
                  type: 'continuous' as const,
                  show: false,
                  seriesIndex: 1,
                  dimension: 2,
                  min: 0,
                  max: 1,
                  inRange: { color: [MUTED, MUTED] },
                  outOfRange: { color: [MUTED] },
                }
              : {
                  ...visualMap,
                  show: false,
                  seriesIndex: 1,
                  inRange: {
                    ...visualMap.inRange,
                    ...(patterns ? {} : { colorAlpha: [PARTIAL_FILL_ALPHA, PARTIAL_FILL_ALPHA] }),
                  },
                },
          ]
        : visualMap,
    series: [
      { type: 'heatmap' as const, data: triples, itemStyle: { borderColor: SURFACE, borderWidth: 1 }, emphasis: { itemStyle: { borderColor: INK, borderWidth: 1 } } },
      ...(inProgress.length > 0
        ? [{ id: 'in-progress', type: 'heatmap' as const, data: inProgress, itemStyle: { borderColor: SURFACE, borderWidth: 1 }, emphasis: { itemStyle: { borderColor: INK, borderWidth: 1 } } }]
        : []),
    ],
  }
}

/** The whole matrix (F12, addendum S7): every category in order × every month, verbatim. */
export function heatmapCsv(
  matrix: Pick<SpendingMatrix, 'months' | 'series'>,
  order: number[],
  nameById: Map<number, string>,
): ExportTable {
  const byId = new Map(matrix.series.map((s) => [s.category_id, s.values]))
  return {
    headers: ['Category', ...matrix.months],
    rows: order.map((id) => [nameById.get(id) ?? String(id), ...matrix.months.map((_, c) => byId.get(id)?.[c] ?? '')]),
  }
}
