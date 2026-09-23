// EVERY /spending chart option, and the export table that twins each one — no React, no
// fetching, no theme decisions of its own (the *ChartOptions law). Each builder is a pure
// function of the page's already-derived inputs (matrix, fold, nameById, monthLabels,
// range, legend picks, the heatmap's row order and mode) and composes only the grammar in
// src/charts (grid/axes, LINE/BAR_MARKS, legendFor, referenceLine, the visualMap scales,
// axisTooltip/itemTooltip), so charts/conformance.ts can check it structurally:
//   spendingBarsOption   + spendingCsv       — the stacked months under the net-pay line
//   monthPieOption       + monthPieCsv       — the drill-in month, morphing from the bars
//   heatmapRows / heatmapOption + heatmapCsv — month x category in three readings (F1)
//   savingsRateOption    + savingsRateCsv    — the total savings rate over the cash one
//   categoryTrendOption  + categoryTrendCsv  — up to three picks with their budget steps
//   categorySmallMultiplesOption             — every category as its own tiny line
// The flow sankey keeps its own file (spendingSankeyOptions.ts). SpendingPage now holds
// state and ChartCard mounts only. Number() is display-only (format.ts's rule).
// Colour law (2026-09-23 spec §C2): every category wears its colour from charts/entities.ts'
// fold — the page's all-time ranking decided once — on the bars, the pie and its legend, the
// trends and the small multiples alike; outside the fold a category is the Other gray.
import type { EChartsOption } from '../../charts/echarts'
import { ENTITY, foldColor, pickStyles } from '../../charts/entities'
import type { CategoryFold } from '../../charts/entities'
import {
  BAR_MARKS,
  ESTIMATE_DECAL,
  LINE,
  compactMoney,
  grid,
  isPartialMonth,
  moneyAxis,
  monthAxis,
  offScaleGap,
  offScaleMarkPoint,
  offScaleMarks,
  partialItemStyle,
  partialNote,
  pctAxis,
  percentLabel,
  robustMax,
  stagger,
} from '../../charts/grammar'
import type { OffScalePoint } from '../../charts/grammar'
import { legendFor } from '../../charts/legend'
import { zeroLine } from '../../charts/markLine'
import { budgetReference, referenceLine } from '../../charts/reference'
import { divergingVisualMap, rowNormalize, sequentialVisualMap, vsAverage } from '../../charts/scales'
import { INK, MUTED, PALETTE, SURFACE } from '../../charts/theme'
import { rangeZoom, resolvedWindow } from '../../charts/timeZoom'
import type { RangeState } from '../../charts/timeZoom'
import { axisTooltip, itemTooltip } from '../../charts/tooltip'
import type { SpendingMatrix } from '../../types/api'
import type { ExportTable } from '../../utils/download'
import { formatPct } from '../../utils/format'
import { buildMonthSlices } from '../../utils/spending'

/**
 * The stacked chart as a table (2026-08-25 spec §2a): month rows × the SAME top-N fold
 * the bars draw, plus Other, the server's Total and Net pay — the export echoes the
 * displayed chart, verbatim server strings. Null cells go empty, never '0.00': absent
 * is not zero.
 */
export function spendingCsv(
  matrix: Pick<SpendingMatrix, 'months' | 'series' | 'totals' | 'net_pay' | 'cash_outflow' | 'living_total' | 'tax_total' | 'transfer_total' | 'review_state'>,
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
      'All category entries',
      'Net pay',
      ...(matrix.cash_outflow ? ['Living spending', 'Tax paid from take-home', 'Transfers', 'Cash outflow', 'Review status'] : []),
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
      ...(matrix.cash_outflow ? [matrix.living_total?.[i] ?? '', matrix.tax_total?.[i] ?? '', matrix.transfer_total?.[i] ?? '', matrix.cash_outflow[i], matrix.review_state?.[i] ?? ''] : []),
    ]),
  }
}

/** F13: the "4% rule" line renamed — it is what the investable assets could fund each month
 *  at the safe withdrawal rate (Settings), and "4%" was a number the setting can change. */
export const SUSTAINABLE_SPEND = 'Sustainable spend'

/** A server string → a display number; absent stays absent (format.ts's rule). */
const toNumber = (value: string | null | undefined): number | null =>
  value === null || value === undefined ? null : Number(value)

/** How far a second off-scale label at the same month is lifted off the first (≈ one 11px
 *  label line and a hair), so two clipped series never print over each other. */
const OFF_SCALE_LIFT = 13

/** The months in progress (2026-09-23 spec §C5, the grammar's objective rule), one flag per
 *  matrix month; all false without a today. */
const partialMonths = (months: readonly string[], todayIso: string | null | undefined): boolean[] =>
  months.map((month) => typeof todayIso === 'string' && isPartialMonth(month, todayIso))

/** The labels a month axis marks as in progress. */
const markedLabels = (labels: readonly string[], partial: readonly boolean[]): Set<string> =>
  new Set(labels.filter((_, i) => partial[i]))

export interface SpendingBarsInput {
  matrix: SpendingMatrix
  /** The page's fold: `ids` order IS the bar seriesIndex; `colors` carries each hue. */
  fold: CategoryFold
  nameById: Map<number, string>
  monthLabels: string[]
  range: RangeState
  selected: Record<string, boolean>
  /** The product's today (utils/months todayIso): the month in progress is drawn partial
   *  (2026-09-23 spec §C5). Absent, no month is. */
  todayIso?: string | null
  /** Appearance › Chart patterns (useChartDecals): the month in progress hatched, not faded. */
  patterns?: boolean
}

/**
 * Top-N category stacks + Other under the INK net-pay line, the dashed sustainable-spend
 * reference and (when any month has one) the total-budget step. Lifted from SpendingPage's
 * `barsOption`; the series ORDER is load-bearing — the heatmap hover highlights bar segments
 * by positional seriesIndex, so the stacks come first and nothing may be inserted among them.
 * The month in progress (spec §C5) adds only the net-pay marker, right after its line.
 */
export function spendingBarsOption({
  matrix, fold, nameById, monthLabels, range, selected, todayIso = null, patterns = false,
}: SpendingBarsInput): EChartsOption | null {
  if (matrix.months.length === 0) return null
  const topIds = fold.ids
  const topSet = new Set(topIds)
  const valuesById = new Map(matrix.series.map((s) => [s.category_id, s.values]))
  // 2026-09-23 spec §C5: every segment of the month in progress wears the partial look in its
  // own colour (a gap stays a gap — A6), so the stack reads as a figure still growing.
  const partial = partialMonths(matrix.months, todayIso)
  const drawn = (values: (number | null)[], color: string) =>
    values.map((v, i) => (v === null || !partial[i] ? v : { value: v, itemStyle: partialItemStyle(color, patterns) }))
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
  // F5 (2026-09-13 audit): a single budgeted month in 38 drove a permanent legend entry. The step
  // and its chip exist only when the DISPLAYED window shows at least two budgeted months — one
  // point draws no step, and a book with no budgets in view has nothing to summon.
  const { startValue, endValue } = resolvedWindow(matrix.months, range)
  const budgetedInView = matrix.total_budget.slice(startValue, endValue + 1).filter((v) => v !== null).length
  const hasBudget = budgetedInView >= 2
  // Robust axis (2026-09-23 spec §C3), judged over the DISPLAYED window: one import-artefact
  // month (Aug 2023's $25,937.48 of net pay) must not set the scale for three years of $2–10K
  // bars. The drawn stack top is what a bar reaches; the lines and references ride along.
  const netPay = matrix.net_pay.map(toNumber)
  const stackTop = matrix.months.map(
    (_, i) =>
      topIds.reduce((acc, id) => acc + Math.max(toNumber(valuesById.get(id)?.[i]) ?? 0, 0), 0) +
      Math.max(otherPerMonth[i] ?? 0, 0),
  )
  const inView = <T,>(values: readonly T[]) => values.slice(startValue, endValue + 1)
  const robust = robustMax([
    ...inView(stackTop),
    ...inView(netPay),
    ...inView(matrix.four_pct_rule.map(toNumber)),
    ...(hasBudget ? inView(matrix.total_budget.map(toNumber)) : []),
  ])
  // Clipped values keep their TRUE figure in the series (the tooltip and the table read it)
  // and gain an edge marker. Labels are selective across the stack and the net-pay line
  // (offScaleMarks): one per run of neighbouring clipped months, and a net-pay label lifted
  // where the stack already labels the same run.
  const clippedBars: OffScalePoint[] = []
  const clippedPay: OffScalePoint[] = []
  if (robust !== null) {
    for (let i = startValue; i <= endValue && i < matrix.months.length; i += 1) {
      if (stackTop[i] > robust.max) clippedBars.push({ index: i, x: monthLabels[i], value: stackTop[i] })
      const pay = netPay[i]
      if (pay !== null && pay > robust.max) clippedPay.push({ index: i, x: monthLabels[i], value: pay })
    }
  }
  const [barEdge, payEdge] = offScaleMarks([clippedBars, clippedPay], {
    direction: 'up',
    minGap: offScaleGap(endValue - startValue + 1),
    lift: OFF_SCALE_LIFT,
    text: compactMoney,
  })
  const barMarks =
    robust === null ? undefined : offScaleMarkPoint(barEdge, { edge: robust.max, direction: 'up', color: MUTED, unit: 'money' })
  const payMarks =
    robust === null ? undefined : offScaleMarkPoint(payEdge, { edge: robust.max, direction: 'up', color: INK, unit: 'money' })
  // The month-to-date net pay leaves the line (spec §C5): joined to a whole month's pay it would
  // draw a fall that is only the calendar. It stays on the chart as a lone marker under the SAME
  // name, so the legend toggles both and the tooltip lists one Net pay row (the line's gap drops
  // out). Always the faded form: a hatch says nothing on an 8px dot.
  const partialPay = netPay.map((v, i) => (partial[i] ? v : null))
  const payMarker = partialPay.some((v) => v !== null)
    ? [{
        ...LINE,
        id: 'net-pay-partial',
        name: 'Net pay',
        color: INK,
        z: 10,
        data: partialPay.map((v) =>
          v === null ? null : { value: v, symbol: 'circle', symbolSize: 8, itemStyle: partialItemStyle(INK, false) },
        ),
      }]
    : []
  const series = [
    // Stable ids: the drill-in pie morphs from/to these (universalTransition keys on id).
    ...topIds.map((id, slot) => ({
      id: `cat-${id}`,
      name: name(id),
      type: 'bar' as const,
      stack: 'spend',
      ...BAR_MARKS,
      ...stagger(slot),
      color: foldColor(fold, id),
      universalTransition: true,
      data: drawn((valuesById.get(id) ?? []).map((v) => (v === null ? null : Number(v))), foldColor(fold, id)),
    })),
    {
      id: 'other',
      name: 'Other',
      type: 'bar' as const,
      stack: 'spend',
      ...BAR_MARKS,
      ...stagger(topIds.length),
      color: ENTITY.other,
      universalTransition: true,
      data: drawn(otherPerMonth, ENTITY.other),
      // The stack's top segment carries the clipped-bar markers (spec §C3).
      ...(barMarks === undefined ? {} : { markPoint: barMarks }),
    },
    {
      ...LINE,
      id: 'net-pay',
      name: 'Net pay',
      color: INK,
      z: 10,
      connectNulls: false,
      data: netPay.map((v, i) => (partial[i] ? null : v)),
      ...(payMarks === undefined ? {} : { markPoint: payMarks }),
    },
    // Right after its line: the categories and Other keep their positional seriesIndex (the
    // heatmap hover), and the budget step stays last.
    ...payMarker,
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
      headNote: (i) => (typeof todayIso === 'string' && partial[i] ? partialNote(matrix.months[i], todayIso) : null),
    }),
    xAxis: monthAxis(monthLabels, { gap: true, marked: markedLabels(monthLabels, partial) }),
    yAxis: moneyAxis({ robust }),
    series,
  }
}

/** One month's breakdown as the bars' drill-in: the SAME fold and colours as the stack,
 *  morphing from the bar segments by id. Null when the month has nothing positive to draw. */
export interface MonthPieOptions {
  /** The dock variant (W7): no leader labels — they truncated to "Hous…" at 440px. The names
   *  ride a legend list beside the chart instead (monthPieLegend + ChartCard `aside`). */
  compact?: boolean
}

export function monthPieOption(
  matrix: Pick<SpendingMatrix, 'categories' | 'series'>,
  fold: CategoryFold,
  monthIndex: number,
  { compact = false }: MonthPieOptions = {},
): EChartsOption | null {
  if (monthIndex < 0) return null
  const slices = buildMonthSlices(matrix, fold, monthIndex)
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
        label: compact ? { show: false } : { color: INK, formatter: '{b}  {d}%' },
        emphasis: { itemStyle: { borderColor: INK } },
        // Morph the month's bar segments into slices and back out on exit; a plain swap
        // under reduced motion (EChart forces animation off).
        universalTransition: { enabled: true, seriesKey: [...fold.ids.map((id) => `cat-${id}`), 'other'] },
        data: slices.map((s) => ({ name: s.name, value: s.value, itemStyle: { color: s.color } })),
      },
    ],
  }
}

/** The drilled month as a table (F12): the drawn slices, Other included. */
export function monthPieCsv(
  matrix: Pick<SpendingMatrix, 'categories' | 'series'>,
  fold: CategoryFold,
  monthIndex: number,
): ExportTable {
  return {
    headers: ['Category', 'Amount'],
    rows: buildMonthSlices(matrix, fold, monthIndex).map((s) => [s.name, s.value.toFixed(2)]),
  }
}

/** The legend list beside the dock donut: the drawn slices, each one's share of the month and
 *  the colour it wears (the fold's, or the Other gray). The same fold as the pie, so the list and
 *  the slices agree by construction. Display-only floats (format.ts's rule). */
export function monthPieLegend(
  matrix: Pick<SpendingMatrix, 'categories' | 'series'>,
  fold: CategoryFold,
  monthIndex: number,
): { name: string; value: number; share: number; color: string }[] {
  const slices = buildMonthSlices(matrix, fold, monthIndex)
  const total = slices.reduce((acc, slice) => acc + slice.value, 0)
  return slices.map((slice) => ({ name: slice.name, value: slice.value, share: total === 0 ? 0 : slice.value / total, color: slice.color }))
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
  // it stays blank: a month to date against a whole month's average would read as a false
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
  const triples: [number, number, number][] = []
  values.forEach((row, r) =>
    row.forEach((v, c) => {
      if (v !== null && !(partial[c] && mode === 'vsAverage')) triples.push([c, r, v])
    }),
  )
  const cells = triples.map((cell) =>
    partial[cell[0]] ? { value: cell, itemStyle: partialItemStyle(MUTED, patterns) } : cell,
  )
  // vs average: the month in progress is not compared, but it IS there (audit F1: a blank
  // column read as "nothing entered"). Its cells ride a second series that the diverging scale
  // does not colour: neutral, hatched, and saying why on hover.
  const inProgress =
    mode === 'vsAverage'
      ? raw.flatMap((row, r) =>
          row.flatMap((dollars, c) =>
            partial[c] && dollars !== null
              ? [{ value: [c, r, dollars] as [number, number, number], itemStyle: { color: MUTED, decal: ESTIMATE_DECAL } }]
              : [],
          ),
        )
      : []
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
    // The scale colours the compared cells only. echarts draws a heatmap series only under a
    // visualMap of its own (a real canvas throws "Heatmap must use with visualMap" without one),
    // so the in-progress series gets a hidden map that paints every cell the one neutral:
    // continuous, because a piecewise map with open-ended pieces throws too (esppChartOptions).
    visualMap:
      inProgress.length > 0
        ? [
            { ...visualMap, seriesIndex: 0 },
            {
              type: 'continuous' as const,
              show: false,
              seriesIndex: 1,
              dimension: 2,
              min: 0,
              max: 1,
              inRange: { color: [MUTED, MUTED] },
              outOfRange: { color: [MUTED] },
            },
          ]
        : visualMap,
    series: [
      { type: 'heatmap' as const, data: cells, itemStyle: { borderColor: SURFACE, borderWidth: 1 }, emphasis: { itemStyle: { borderColor: INK, borderWidth: 1 } } },
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

/** The two savings words (2026-09-04 honest-numbers spec §2). Payroll deductions are money
 *  the household saved without ever seeing it as cash, so the headline line counts them;
 *  the muted line answers the other question — what was left of the paycheck. */
export const TOTAL_RATE_SERIES = 'Total (incl. payroll)'
export const CASH_RATE_SERIES = 'Cash'

export interface SavingsRateInput { matrix: SpendingMatrix; monthLabels: string[]; range: RangeState }

/** Rates over months with net pay; nulls break the line (connectNulls false). Robust extents
 *  (2026-09-23 spec §C3), judged over the displayed window: the floor is FIXED at −100% — a
 *  month below it (Sep 2023's −1,073%, net pay $318.76 against $3,739.62 of spending) is
 *  drawn off the bottom edge with a marker carrying its true value, never allowed to squash
 *  three years into a band — and the top is a nice step above the data. TWO lines when the
 *  server sends the total rate, one when it does not — the fallback is exactly the chart this
 *  card drew before the savings service, so an older backend degrades to the truth it can
 *  still tell rather than to a blank. */
export function savingsRateOption({ matrix, monthLabels, range }: SavingsRateInput): EChartsOption | null {
  if (matrix.months.length === 0) return null
  const total = matrix.total_savings_rate
  const numbers = (values: (string | null)[]) => values.map(toNumber)
  const totalRates = total === undefined ? null : numbers(total)
  const cashRates = numbers(matrix.savings_rate)
  const { startValue, endValue } = resolvedWindow(matrix.months, range)
  const inView = (values: (number | null)[]) => values.slice(startValue, endValue + 1)
  const yAxis = pctAxis({ floor: -1, ceiling: 1, values: [...inView(totalRates ?? []), ...inView(cashRates)] })
  // Each line's clipped months, at the floor (↓) or the ceiling (↑), labelled selectively over
  // BOTH lines (offScaleMarks): one label per run of neighbouring clipped months — its extreme
  // (production's Sep–Dec 2023 are four in a row) — and the cash label lifted where the total
  // line already labels the same run. The same text at the same month reads as one label.
  const lines = totalRates === null ? [cashRates] : [totalRates, cashRates]
  const clippedWhere = (rates: (number | null)[], beyond: (value: number) => boolean) => {
    const points: OffScalePoint[] = []
    for (let i = startValue; i <= endValue && i < rates.length; i += 1) {
      const value = rates[i]
      if (value !== null && beyond(value)) points.push({ index: i, x: monthLabels[i], value })
    }
    return points
  }
  const edges = { minGap: offScaleGap(endValue - startValue + 1), lift: OFF_SCALE_LIFT, text: percentLabel }
  const lows = offScaleMarks(lines.map((rates) => clippedWhere(rates, (v) => v < yAxis.min)), { direction: 'down', ...edges })
  const highs = offScaleMarks(lines.map((rates) => clippedWhere(rates, (v) => v > yAxis.max)), { direction: 'up', ...edges })
  const marksFor = (line: number, color: string) => {
    const down = offScaleMarkPoint(lows[line], { edge: yAxis.min, direction: 'down', color, unit: 'percent' })
    const up = offScaleMarkPoint(highs[line], { edge: yAxis.max, direction: 'up', color, unit: 'percent' })
    if (down === undefined || up === undefined) return down ?? up
    // Both edges on one line (a rate above 100% needs refunds that outweigh spending): the
    // ceiling's items restate their own rotation and label side.
    return {
      ...down,
      data: [...down.data, ...up.data.map((item) => ({ ...item, symbolRotate: 0, label: { ...item.label, position: 'bottom' as const } }))],
    }
  }
  const totalMarks = totalRates === null ? undefined : marksFor(0, PALETTE[0])
  const cashMarks = marksFor(lines.length - 1, PALETTE[1])
  const series = [
    ...(totalRates === null
      ? []
      : [
          {
            ...LINE,
            name: TOTAL_RATE_SERIES,
            color: PALETTE[0],
            connectNulls: false,
            markLine: zeroLine(),
            ...(totalMarks === undefined ? {} : { markPoint: totalMarks }),
            data: totalRates,
          },
        ]),
    {
      ...LINE,
      name: CASH_RATE_SERIES,
      // The Spending page's headline figure: a data colour, not the muted annotation grey the
      // references wear (spec §C3). The first two palette slots validate as a pair everywhere.
      color: PALETTE[1],
      connectNulls: false,
      // The baseline belongs to whichever series leads — drawn twice it doubles its own ink.
      ...(totalRates === null ? { markLine: zeroLine() } : {}),
      ...(cashMarks === undefined ? {} : { markPoint: cashMarks }),
      data: cashRates,
    },
  ]
  return {
    dataZoom: rangeZoom(matrix.months, range),
    grid: grid(totalRates === null ? 'noLegend' : 'default'),
    ...(totalRates === null ? {} : { legend: legendFor(series.length) }),
    // True value in the tooltip even when a line is clamped out of frame.
    tooltip: axisTooltip({ unit: 'percent' }),
    xAxis: monthAxis(monthLabels),
    yAxis,
    series,
  }
}

/** Rates and their source amounts, retaining the raw category sum separately from
 *  cash outflow. Verbatim server strings; blanks for absent, never '0.00'. */
export function savingsRateCsv(
  matrix: Pick<SpendingMatrix, 'months' | 'net_pay' | 'totals' | 'savings_rate'> &
    Partial<Pick<SpendingMatrix, 'living_total' | 'total_savings_rate' | 'cash_outflow' | 'review_state'>>,
): ExportTable {
  return {
    headers: ['Month', 'Net pay', 'Living spending', 'All category entries', 'Cash rate', 'Total rate', ...(matrix.cash_outflow ? ['Cash outflow', 'Review status'] : [])],
    rows: matrix.months.map((m, i) => [
      m,
      matrix.net_pay[i] ?? '',
      matrix.living_total?.[i] ?? '',
      matrix.totals[i],
      matrix.savings_rate[i] ?? '',
      matrix.total_savings_rate?.[i] ?? '',
      ...(matrix.cash_outflow ? [matrix.cash_outflow[i], matrix.review_state?.[i] ?? ''] : []),
    ]),
  }
}

export interface TrendPick { categoryId: number }
export interface CategoryTrendInput {
  matrix: SpendingMatrix
  trend: TrendPick[]
  /** The page's fold: a pick wears its category's colour, never its pick order's. */
  fold: CategoryFold
  nameById: Map<number, string>
  monthLabels: string[]
  range: RangeState
  selected: Record<string, boolean>
}

/** Up to three categories' histories in their own colours (pickStyles: the fold's hue, or the
 *  Other gray for any pick outside it, a second or third outsider told apart by its markers),
 *  each with its budget as a dashed step named "{category} budget" so the axis tooltip
 *  disambiguates. */
export function categoryTrendOption({
  matrix, trend, fold, nameById, monthLabels, range, selected,
}: CategoryTrendInput): EChartsOption | null {
  if (matrix.months.length === 0 || trend.length === 0) return null
  const styles = pickStyles(trend.map((pick) => pick.categoryId), fold)
  const valuesById = new Map(matrix.series.map((s) => [s.category_id, s.values]))
  const budgetsById = new Map(matrix.series.map((s) => [s.category_id, s.budgets]))
  const name = (id: number) => nameById.get(id) ?? String(id)
  const budgets = trend.flatMap(({ categoryId }) => {
    const b = budgetsById.get(categoryId)
    return b === undefined || !b.some((v) => v !== null) ? [] : [budgetReference(`${name(categoryId)} budget`, b)]
  })
  const series = [
    ...trend.map(({ categoryId }) => {
      const style = styles.get(categoryId)
      return {
        ...LINE,
        name: name(categoryId),
        color: style?.color ?? ENTITY.other,
        // An outsider's marker rides every point, echarts thinning them where they crowd; the
        // legend draws it too, so the key tells the two grey lines apart as well.
        ...(style?.marker ? { symbol: style.marker, symbolSize: 7, showSymbol: true, showAllSymbol: 'auto' as const } : {}),
        connectNulls: false,
        data: (valuesById.get(categoryId) ?? []).map((v) => (v === null ? null : Number(v))),
      }
    }),
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
  /** Each cell wears its category's fold colour — the Other gray outside the fold. */
  fold: CategoryFold
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
  matrix, order, fold, nameById, monthLabels,
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
    // shapes the grid exists to compare. The month grammar's formatter stays on every cell's
    // axis (2026-09-23 spec §C4), so EChart fits the printed row to its cell's width.
    xAxis: order.map((_, i) => {
      const axis = monthAxis(monthLabels)
      return {
        ...axis,
        gridIndex: i,
        axisLabel: { ...axis.axisLabel, show: i >= order.length - SM_COLUMNS, interval: 'auto' as const },
      }
    }),
    yAxis: order.map((_, i) => ({ ...moneyAxis(), gridIndex: i, splitNumber: 2 })),
    tooltip: axisTooltip({ unit: 'money' }),
    series: order.map((id, i) => ({
      ...LINE,
      name: name(id),
      xAxisIndex: i,
      yAxisIndex: i,
      // The category's own colour (spec §C2: one colour per entity in every chart — a cell
      // in another category's hue would say it WAS that category).
      color: foldColor(fold, id),
      connectNulls: false,
      data: (valuesById.get(id) ?? []).map((v) => (v === null ? null : Number(v))),
    })),
  }
}
