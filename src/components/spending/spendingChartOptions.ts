// Pure tooltip + CSV helpers for the spending stacked-bars chart — no React, no
// fetching, no theme decisions of their own (budgetChartOptions.ts's posture). The
// option itself stays in SpendingPage (it reads page state); only the parts worth
// unit-testing live here. Number() is display-only (format.ts's rule).
import type { EChartsOption } from '../../charts/echarts'
import { BAR_MARKS, LINE, compactMoney, grid, moneyAxis, monthAxis, stagger } from '../../charts/grammar'
import { legendFor } from '../../charts/legend'
import { budgetReference, referenceLine } from '../../charts/reference'
import { divergingVisualMap, rowNormalize, sequentialVisualMap, vsAverage } from '../../charts/scales'
import { INK, OTHER_SERIES_COLOR, PALETTE, SURFACE } from '../../charts/theme'
import { rangeZoom } from '../../charts/timeZoom'
import type { RangeState } from '../../charts/timeZoom'
import { axisTooltip, itemTooltip } from '../../charts/tooltip'
import type { SpendingMatrix } from '../../types/api'
import type { ExportTable } from '../../utils/download'
import { escapeHtml, formatCurrency, formatPct } from '../../utils/format'
import { buildMonthSlices } from '../../utils/spending'

// Axis-tooltip params subset the formatter reads (historyChartOptions' posture).
interface AxisTooltipParam {
  seriesName?: string
  marker?: string
  axisValueLabel?: string
  value?: unknown
}

/**
 * The stacked bars' axis tooltip (2026-08-25 spec §2b, the vestingChartOptions Total-row
 * pattern): each CATEGORY row carries its (xx%) share of the month's category total, a
 * bold Total row closes the categories, and the reference lines — net pay, the 4% rule,
 * budget steps — list AFTER it, excluded from the sum: they are comparisons, not spend.
 * Shares are computed over the rows actually under the pointer, so legend-hidden
 * categories leave percentages that still add to 100. Padded nulls (net pay's gaps) are
 * dropped, historyTooltipFormatter's rule. Category names are USER TEXT — escapeHtml on
 * every series name (the page's own rule); budget-step names carry them too, so
 * reference rows are escaped alike.
 */
export function spendingBarsTooltipFormatter(
  categoryNames: string[],
): (params: unknown) => string {
  const categories = new Set(categoryNames)
  return (params: unknown) => {
    const list = (Array.isArray(params) ? params : [params]) as AxisTooltipParam[]
    if (list.length === 0) return ''
    const finite = list.flatMap((p) =>
      typeof p.value === 'number' && Number.isFinite(p.value) ? [{ p, value: p.value }] : [],
    )
    const catRows = finite.filter(({ p }) => categories.has(p.seriesName ?? ''))
    const refRows = finite.filter(({ p }) => !categories.has(p.seriesName ?? ''))
    const total = catRows.reduce((sum, { value }) => sum + value, 0)
    const line = ({ p, value }: { p: AxisTooltipParam; value: number }, share: boolean) => {
      // A zero-or-below total cannot scale a share (a refund month) — rows go bare.
      const pct = share && total > 0 ? ` (${((value / total) * 100).toFixed(1)}%)` : ''
      return `${p.marker ?? ''}${escapeHtml(p.seriesName ?? '')}: ${formatCurrency(value)}${pct}`
    }
    return [
      `<strong>${list.find((p) => p.axisValueLabel)?.axisValueLabel ?? ''}</strong>`,
      // A6: with the series passing nulls through, an absent month has NO finite category
      // rows — say so instead of fabricating $0.00 rows, and close real rows (only) with
      // the Total. (A month with every category legend-hidden reads the same line; that
      // is a deliberate user act, and the reference rows still print below.)
      ...(catRows.length > 0
        ? [
            ...catRows.map((row) => line(row, true)),
            `<strong>Total: ${formatCurrency(total)}</strong>`,
          ]
        : ['no spending entered']),
      ...refRows.map((row) => line(row, false)),
    ].join('<br/>')
  }
}

/**
 * The stacked chart as a table (2026-08-25 spec §2a): month rows × the SAME top-N fold
 * the bars draw, plus Other, the server's Total and Net pay — the export echoes the
 * displayed chart, verbatim server strings. Null cells go empty, never '0.00': absent
 * is not zero.
 */
export function spendingCsv(
  matrix: Pick<SpendingMatrix, 'months' | 'series' | 'totals' | 'net_pay'>,
  topIds: number[],
  nameById: Map<number, string>,
): ExportTable {
  const topSet = new Set(topIds)
  const valuesById = new Map(matrix.series.map((s) => [s.category_id, s.values]))
  return {
    headers: [
      'Month',
      ...topIds.map((id) => nameById.get(id) ?? String(id)),
      'Other',
      'Total',
      'Net pay',
    ],
    rows: matrix.months.map((month, i) => [
      month,
      ...topIds.map((id) => valuesById.get(id)?.[i] ?? ''),
      matrix.series
        .reduce(
          (acc, s) => (topSet.has(s.category_id) ? acc : acc + Number(s.values[i] ?? 0)),
          0,
        )
        .toFixed(2),
      matrix.totals[i],
      matrix.net_pay[i] ?? '',
    ]),
  }
}

/** F13: the "4% rule" line renamed — it is what the investable assets could fund each month
 *  at the safe withdrawal rate (Settings), and "4%" was a number the setting can change. */
export const SUSTAINABLE_SPEND = 'Sustainable spend'

export interface SpendingBarsInput {
  matrix: SpendingMatrix
  /** All-time-total order — index IS the palette slot AND the bar seriesIndex. */
  topIds: number[]
  nameById: Map<number, string>
  monthLabels: string[]
  range: RangeState
  selected: Record<string, boolean>
}

/**
 * Top-N category stacks + Other under the INK net-pay line, the dashed sustainable-spend
 * reference and (when any month has one) the total-budget step. Lifted from SpendingPage's
 * `barsOption`; the series ORDER is load-bearing — the heatmap hover highlights bar segments
 * by positional seriesIndex, so nothing may be inserted ahead of the budget step.
 */
export function spendingBarsOption({
  matrix, topIds, nameById, monthLabels, range, selected,
}: SpendingBarsInput): EChartsOption | null {
  if (matrix.months.length === 0) return null
  const topSet = new Set(topIds)
  const valuesById = new Map(matrix.series.map((s) => [s.category_id, s.values]))
  // A6: absent ≠ zero. Nulls flow THROUGH to the series so an unentered month gaps the bar;
  // Other sums the folded rows' non-null values and is itself null when none exist.
  const otherPerMonth = matrix.months.map((_, i) =>
    matrix.series.reduce<number | null>((acc, s) => {
      if (topSet.has(s.category_id)) return acc
      const v = s.values[i]
      return v === null ? acc : (acc ?? 0) + Number(v)
    }, null),
  )
  const name = (id: number) => nameById.get(id) ?? String(id)
  const categoryNames = [...topIds.map(name), 'Other']
  const hasBudget = matrix.total_budget.some((v) => v !== null)
  const series = [
    // Stable ids: the drill-in pie morphs from/to these (universalTransition keys on id).
    ...topIds.map((id, slot) => ({
      id: `cat-${id}`,
      name: name(id),
      type: 'bar' as const,
      stack: 'spend',
      ...BAR_MARKS,
      ...stagger(slot),
      color: PALETTE[slot],
      universalTransition: true,
      data: (valuesById.get(id) ?? []).map((v) => (v === null ? null : Number(v))),
    })),
    {
      id: 'other',
      name: 'Other',
      type: 'bar' as const,
      stack: 'spend',
      ...BAR_MARKS,
      ...stagger(topIds.length),
      color: OTHER_SERIES_COLOR,
      universalTransition: true,
      data: otherPerMonth,
    },
    {
      ...LINE,
      id: 'net-pay',
      name: 'Net pay',
      color: INK,
      z: 10,
      connectNulls: false,
      data: matrix.net_pay.map((v) => (v === null ? null : Number(v))),
    },
    referenceLine(
      SUSTAINABLE_SPEND,
      matrix.four_pct_rule.map((v) => (v === null ? null : Number(v))),
      { id: 'sustainable-spend' },
    ),
    // LAST on purpose (the positional highlight — see above).
    ...(hasBudget ? [budgetReference('Total budget', matrix.total_budget)] : []),
  ]
  return {
    dataZoom: rangeZoom(matrix.months, range),
    grid: grid(),
    // 'Total budget' ships DESELECTED: it wears the same dashed grammar as the sustainable
    // line, so both on at once would be ambiguous; the legend chip is the summon. Mirrored
    // picks spread OVER the default so a deliberate summon survives rebuilds.
    legend: legendFor(series.length, { 'Total budget': false, ...selected }),
    tooltip: axisTooltip({
      unit: 'money',
      groups: categoryNames,
      shareOf: true,
      references: [SUSTAINABLE_SPEND, 'Total budget'],
      absentText: 'no spending entered',
      pointer: 'shadow',
    }),
    xAxis: monthAxis(monthLabels, { gap: true }),
    yAxis: moneyAxis(),
    series,
  }
}

/** One month's breakdown as the bars' drill-in: the SAME top-N fold and slots as the stack,
 *  morphing from the bar segments by id. Null when the month has nothing positive to draw. */
export function monthPieOption(
  matrix: Pick<SpendingMatrix, 'categories' | 'series'>,
  topIds: number[],
  monthIndex: number,
): EChartsOption | null {
  if (monthIndex < 0) return null
  const slices = buildMonthSlices(matrix, topIds, monthIndex)
  if (slices.length === 0) return null
  return {
    tooltip: itemTooltip<{ name?: string; value?: unknown; percent?: number }>({
      body: (p) => ({
        value: Number(p.value),
        label: p.name ?? '',
        sub: `${(p.percent ?? 0).toFixed(1)}% of the month`,
      }),
    }),
    series: [
      {
        id: 'month-pie',
        type: 'pie' as const,
        radius: ['42%', '70%'],
        itemStyle: { borderColor: SURFACE, borderWidth: 2 },
        label: { color: INK, formatter: '{b}  {d}%' },
        emphasis: { itemStyle: { borderColor: INK } },
        // Morph the month's bar segments into slices and back out on exit; a plain swap
        // under reduced motion (EChart forces animation off).
        universalTransition: { enabled: true, seriesKey: [...topIds.map((id) => `cat-${id}`), 'other'] },
        data: slices.map((s) => ({
          name: s.name,
          value: s.value,
          itemStyle: { color: s.slot === null ? OTHER_SERIES_COLOR : PALETTE[s.slot] },
        })),
      },
    ],
  }
}

/** The drilled month as a table (F12): the drawn slices, Other included. */
export function monthPieCsv(
  matrix: Pick<SpendingMatrix, 'categories' | 'series'>,
  topIds: number[],
  monthIndex: number,
): ExportTable {
  return {
    headers: ['Category', 'Amount'],
    rows: buildMonthSlices(matrix, topIds, monthIndex).map((s) => [s.name, s.value.toFixed(2)]),
  }
}

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

export interface HeatmapInput {
  matrix: SpendingMatrix
  /** The VISIBLE rows (heatmapRows().visible) — row index r maps back to order[r]. */
  order: number[]
  nameById: Map<number, string>
  monthLabels: string[]
  mode: HeatmapMode
}

/**
 * Month × category, one of three readings of the same cells (F1). Absolute: one shared dollar
 * scale. Row (default): each category against its own busiest month. vs average: each cell
 * against its trailing 12-month mean, orange above / blue below, blank until six prior months
 * exist. Hover keeps the RAW dollars in the lead; the mode's reading is the sub-line.
 */
export function heatmapOption({
  matrix, order, nameById, monthLabels, mode,
}: HeatmapInput): EChartsOption | null {
  if (matrix.months.length === 0 || order.length === 0) return null
  const raw = heatmapMatrix(matrix, order)
  const values = mode === 'absolute' ? raw : mode === 'row' ? rowNormalize(raw) : vsAverage(raw)
  const cells: [number, number, number][] = []
  values.forEach((row, r) =>
    row.forEach((v, c) => {
      if (v !== null) cells.push([c, r, v])
    }),
  )
  const rawMax = raw.reduce((m, row) => row.reduce<number>((mm, v) => (v === null ? mm : Math.max(mm, v)), m), 0)
  const maxAbs = cells.reduce((m, [, , v]) => Math.max(m, Math.abs(v)), 0)
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
        const [c, r, v] = (p.value ?? []) as [number, number, number]
        const dollars = raw[r]?.[c]
        if (dollars === null || dollars === undefined) return null
        const label = `${name(r)} · ${monthLabels[c] ?? ''}`
        if (mode === 'absolute') return { value: dollars, label }
        if (mode === 'row') return { value: dollars, label, sub: `${Math.round(v * 100)}% of this category’s busiest month` }
        return { value: dollars, label, sub: `${formatPct(v, { decimals: 0 })} vs its trailing 12-month average` }
      },
    }),
    xAxis: monthAxis(monthLabels, { gap: true, rotate: 45 }),
    yAxis: { type: 'category', data: order.map((_, r) => name(r)), inverse: true, axisLabel: { width: 118, overflow: 'truncate' as const } },
    visualMap,
    series: [{ type: 'heatmap' as const, data: cells, itemStyle: { borderColor: SURFACE, borderWidth: 1 }, emphasis: { itemStyle: { borderColor: INK, borderWidth: 1 } } }],
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
