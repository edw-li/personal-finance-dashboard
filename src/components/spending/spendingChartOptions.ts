// EVERY /spending chart option, and the export table that twins each one — no React, no
// fetching, no theme decisions of its own (the *ChartOptions law). Each builder is a pure
// function of the page's already-derived inputs (matrix, topIds, nameById, monthLabels,
// range, legend picks, the heatmap's row order and mode) and composes only the grammar in
// src/charts (grid/axes, LINE/BAR_MARKS, legendFor, referenceLine, the visualMap scales,
// axisTooltip/itemTooltip), so charts/conformance.ts can check it structurally:
//   spendingBarsOption   + spendingCsv       — the stacked months under the net-pay line
//   monthPieOption       + monthPieCsv       — the drill-in month, morphing from the bars
//   heatmapRows / heatmapOption + heatmapCsv — month x category in three readings (F1)
//   savingsRateOption    + savingsRateCsv    — (net pay - spend) / net pay per month
//   categoryTrendOption  + categoryTrendCsv  — up to three picks with their budget steps
//   categorySmallMultiplesOption             — every category as its own tiny line
// The flow sankey keeps its own file (spendingSankeyOptions.ts). SpendingPage now holds
// state and ChartCard mounts only. Number() is display-only (format.ts's rule).
import type { EChartsOption } from '../../charts/echarts'
import { slotColor } from '../../charts/entities'
import { BAR_MARKS, LINE, compactMoney, grid, moneyAxis, monthAxis, pctAxis, stagger } from '../../charts/grammar'
import { legendFor } from '../../charts/legend'
import { zeroLine } from '../../charts/markLine'
import { budgetReference, referenceLine } from '../../charts/reference'
import { divergingVisualMap, rowNormalize, sequentialVisualMap, vsAverage } from '../../charts/scales'
import { INK, MUTED, OTHER_SERIES_COLOR, PALETTE, SURFACE } from '../../charts/theme'
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
 * RETIRED — C7 removes it. The stacked bars' pre-grammar axis tooltip; spendingBarsOption
 * now builds the same rows through axisTooltip (charts/tooltip.ts), which owns the order,
 * the escaping and the branding. Kept only so its pins keep passing until C7's sweep.
 *
 * (2026-08-25 spec §2b, the vestingChartOptions Total-row pattern): each CATEGORY row
 * carries its (xx%) share of the month's category total, a bold Total row closes the
 * categories, and the reference lines — net pay, the sustainable-spend line, budget steps
 * — list AFTER it, excluded from the sum: they are comparisons, not spend.
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
        // Defensive on the SHAPE, not just on null: a heatmap item param carries the
        // [col, row, value] triple, and destructuring anything else would throw inside a
        // formatter — where echarts has no boundary and the whole card would blank.
        const [c, r, v] = (Array.isArray(p.value) ? p.value : []) as [number, number, number]
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

export interface SavingsRateInput { matrix: SpendingMatrix; monthLabels: string[]; range: RangeState }

/** (net pay − spend) ÷ net pay per month, above the zero line you saved. Clamped to the
 *  savings-rate extents (A7): ceiling +100%, floor expanding to the data. */
export function savingsRateOption({ matrix, monthLabels, range }: SavingsRateInput): EChartsOption | null {
  if (matrix.months.length === 0) return null
  return {
    dataZoom: rangeZoom(matrix.months, range),
    grid: grid('noLegend'),
    // True value in the tooltip even when the line is clamped out of frame.
    tooltip: axisTooltip({ unit: 'percent' }),
    xAxis: monthAxis(monthLabels),
    yAxis: pctAxis(),
    series: [
      {
        ...LINE,
        name: 'Savings rate (actual)',
        color: PALETTE[0],
        connectNulls: false,
        markLine: zeroLine(),
        data: matrix.savings_rate.map((v) => (v === null ? null : Number(v))),
      },
    ],
  }
}

export function savingsRateCsv(
  matrix: Pick<SpendingMatrix, 'months' | 'net_pay' | 'totals' | 'savings_rate'>,
): ExportTable {
  return {
    headers: ['Month', 'Net pay', 'Spend', 'Savings rate'],
    rows: matrix.months.map((m, i) => [m, matrix.net_pay[i] ?? '', matrix.totals[i], matrix.savings_rate[i] ?? '']),
  }
}

export interface TrendPick { categoryId: number; slot: number }
export interface CategoryTrendInput {
  matrix: SpendingMatrix
  trend: TrendPick[]
  nameById: Map<number, string>
  monthLabels: string[]
  range: RangeState
  selected: Record<string, boolean>
}

/** Up to three categories' histories on their pick slots, each with its budget as a dashed
 *  step named "{category} budget" so the axis tooltip disambiguates when several show. */
export function categoryTrendOption({
  matrix, trend, nameById, monthLabels, range, selected,
}: CategoryTrendInput): EChartsOption | null {
  if (matrix.months.length === 0 || trend.length === 0) return null
  const valuesById = new Map(matrix.series.map((s) => [s.category_id, s.values]))
  const budgetsById = new Map(matrix.series.map((s) => [s.category_id, s.budgets]))
  const name = (id: number) => nameById.get(id) ?? String(id)
  const budgets = trend.flatMap(({ categoryId }) => {
    const b = budgetsById.get(categoryId)
    return b === undefined || !b.some((v) => v !== null) ? [] : [budgetReference(`${name(categoryId)} budget`, b)]
  })
  const series = [
    ...trend.map(({ categoryId, slot }) => ({
      ...LINE,
      name: name(categoryId),
      color: slotColor(slot),
      connectNulls: false,
      data: (valuesById.get(categoryId) ?? []).map((v) => (v === null ? null : Number(v))),
    })),
    ...budgets,
  ]
  return {
    dataZoom: rangeZoom(matrix.months, range),
    grid: grid(),
    legend: legendFor(series.length, selected),
    tooltip: axisTooltip({ unit: 'money', references: budgets.map((b) => b.name) }),
    xAxis: monthAxis(monthLabels),
    yAxis: moneyAxis(),
    series,
  }
}

export function categoryTrendCsv(
  matrix: Pick<SpendingMatrix, 'months' | 'series'>,
  trend: TrendPick[],
  nameById: Map<number, string>,
): ExportTable {
  const valuesById = new Map(matrix.series.map((s) => [s.category_id, s.values]))
  return {
    headers: ['Month', ...trend.map((t) => nameById.get(t.categoryId) ?? String(t.categoryId))],
    rows: matrix.months.map((m, i) => [m, ...trend.map((t) => valuesById.get(t.categoryId)?.[i] ?? '')]),
  }
}

const SM_COLUMNS = 3
export const SM_CELL_HEIGHT = 110

export interface SmallMultiplesInput {
  matrix: SpendingMatrix
  order: number[]
  nameById: Map<number, string>
  monthLabels: string[]
}

/** The card's height for a given row count — one formula, so the page and the builder
 *  cannot disagree about how tall the grid it emits actually is. */
export const smallMultiplesHeight = (count: number) =>
  Math.ceil(count / SM_COLUMNS) * SM_CELL_HEIGHT + 24

/** Every category as a tiny line, three per row, ONE option (§20: one mount, not nineteen).
 *  Cells share the month axis but scale their own money axis — the reading is shape, not size. */
export function categorySmallMultiplesOption({
  matrix, order, nameById, monthLabels,
}: SmallMultiplesInput): EChartsOption | null {
  if (matrix.months.length === 0 || order.length === 0) return null
  const valuesById = new Map(matrix.series.map((s) => [s.category_id, s.values]))
  const name = (id: number) => nameById.get(id) ?? String(id)
  const cell = (i: number) => {
    const col = i % SM_COLUMNS
    const row = Math.floor(i / SM_COLUMNS)
    return {
      left: `${(col / SM_COLUMNS) * 100 + 2}%`,
      width: `${100 / SM_COLUMNS - 4}%`,
      top: row * SM_CELL_HEIGHT + 24,
      height: SM_CELL_HEIGHT - 44,
    }
  }
  return {
    grid: order.map((_, i) => cell(i)),
    title: order.map((id, i) => ({
      text: name(id),
      left: cell(i).left,
      top: cell(i).top - 22,
      textStyle: { color: MUTED, fontSize: 11, fontWeight: 600 as const },
    })),
    // Only the bottom row prints month labels: three columns of dates would out-shout the
    // shapes the grid exists to compare.
    xAxis: order.map((_, i) => ({
      ...monthAxis(monthLabels),
      gridIndex: i,
      axisLabel: { show: i >= order.length - SM_COLUMNS, interval: 'auto' as const },
    })),
    yAxis: order.map((_, i) => ({ ...moneyAxis(), gridIndex: i, splitNumber: 2 })),
    tooltip: axisTooltip({ unit: 'money' }),
    series: order.map((id, i) => ({
      ...LINE,
      name: name(id),
      xAxisIndex: i,
      yAxisIndex: i,
      // One entity per cell: the hue carries no identity here, so every cell wears slot 0.
      color: PALETTE[0],
      connectNulls: false,
      data: (valuesById.get(id) ?? []).map((v) => (v === null ? null : Number(v))),
    })),
  }
}
