import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PencilLine } from 'lucide-react'
import { ApiError } from '../api/client'
import { fetchMatrix, fetchYearly } from '../api/spending'
import { getSnapshot, setSnapshot } from '../api/snapshotCache'
import EChart from '../components/EChart'
import type { EChartEventParams, EChartsInstance } from '../components/EChart'
import InfoHint from '../components/InfoHint'
import PageFrame from '../components/shell/PageFrame'
import ScopeBar from '../components/shell/ScopeBar'
import { useScope } from '../components/shell/useScope'
import StatTile from '../components/StatTile'
import { useArrivalValue } from '../components/useArrivalParam'
import ChartZoomHint from '../components/ChartZoomHint'
import BudgetPanel from '../components/spending/BudgetPanel'
import { budgetStepSeries } from '../components/spending/budgetChartOptions'
import {
  spendingBarsTooltipFormatter,
  spendingCsv,
} from '../components/spending/spendingChartOptions'
import {
  spendingFlowPeriod,
  spendingSankeyOption,
} from '../components/spending/spendingSankeyOptions'
import type { EChartsOption } from '../charts/echarts'
import { rangeZoom, resolvedWindow } from '../charts/timeZoom'
import type { RangeState, ZoomWindow } from '../charts/timeZoom'
import {
  INK,
  MUTED,
  OTHER_SERIES_COLOR,
  PALETTE,
  SEQUENTIAL_BLUE,
  SURFACE,
} from '../charts/theme'
import type { SpendingMatrix, SpendingYearly } from '../types/api'
import {
  escapeHtml,
  formatCurrency,
  formatCurrencyCompact,
  formatMonth,
  formatPct,
} from '../utils/format'
import { buildMonthSlices, hasVsBudget, monthMovers } from '../utils/spending'
import '../components/panels.css'
import './SpendingPage.css'

const TOP_N = 7
const MAX_TREND = 3
const MOVERS_TOP = 5

// Spending UP is BAD: the glyph carries which way the number moved, the colour whether
// that is good — StatTile's decoupled delta grammar, table-cell sized. Null (no month to
// compare against) and a flat cent both read as a dash.
function moverCell(delta: number | null) {
  if (delta === null || Math.abs(delta) < 0.005) return '—'
  const up = delta > 0
  return (
    <span className={up ? 'delta-negative' : 'delta-positive'}>
      <span aria-hidden="true">{up ? '▲ ' : '▼ '}</span>
      {formatCurrency(Math.abs(delta))}
    </span>
  )
}

const SNAPSHOT_KEY = 'spending'

interface SpendingSnapshot {
  matrix: SpendingMatrix
  yearly: SpendingYearly
}

// Default trend pick — the single biggest all-time category, slot 1. Extracted from
// load()'s .then so a cache-seeded mount derives the same default (spec §1).
function defaultTrend(m: SpendingMatrix): { categoryId: number; slot: number }[] {
  if (m.categories.length === 0) return []
  const totals = m.series.map((s) => ({
    id: s.category_id,
    total: s.values.reduce((acc, v) => acc + (v === null ? 0 : Number(v)), 0),
  }))
  totals.sort((a, b) => b.total - a.total)
  return [{ categoryId: totals[0].id, slot: 0 }]
}

export default function SpendingPage() {
  const navigate = useNavigate()
  const cached = getSnapshot<SpendingSnapshot>(SNAPSHOT_KEY)
  const [matrix, setMatrix] = useState<SpendingMatrix | null>(cached?.matrix ?? null)
  const [yearly, setYearly] = useState<SpendingYearly | null>(cached?.yearly ?? null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [trend, setTrend] = useState<{ categoryId: number; slot: number }[]>(() =>
    cached ? defaultTrend(cached.matrix) : [],
  )
  // ?trend=<slug> — the palette's category entries pick that category's trend (spec §9).
  // Matched on the SLUG the API also hands the palette, never on a name: a rename must not
  // break a deep link. A retired category simply finds nothing and the trend is left alone.
  const arriveOnTrend = useCallback(
    (slug: string) => {
      // Nothing to resolve the slug against yet — hold the param and answer again when
      // the matrix lands (useArrivalValue's "not yet" contract).
      if (!matrix) return false
      const category = matrix.categories.find((c) => c.slug === slug)
      if (category) setTrend([{ categoryId: category.id, slot: 0 }])
      return true
    },
    [matrix],
  )
  useArrivalValue('trend', arriveOnTrend)
  // false once a revalidation actually CHANGES the data — charts may animate again.
  const [fromCache, setFromCache] = useState(cached !== undefined)
  // Month drill-in and time window both live in the shared scope now (2026-09-03 shell
  // spec §6): the URL is the source of truth and the sticky ScopeBar writes it, so a drill
  // stays shareable and Overview can still link straight into one. `scope.month` is the
  // app's YYYY-MM-01 month currency (the URL carries the short YYYY-MM, and a legacy
  // YYYY-MM-DD deep link is accepted and rewritten). Month STRING, never an index: a
  // refetch that reshapes the month list cannot mis-target, and a month that vanished (or
  // a garbled param) falls back to the all-months view through the indexOf guard below.
  const { scope, setScope } = useScope({ range: true, month: true })
  const detailMonth = scope.month
  // replace, not push: setScope's drill-param convention — Back should leave the page,
  // not unwind every pie the user peeked at.
  const setDetailMonth = (month: string | null) => setScope({ month })
  // The page's time window, applied to the three time charts together (bars, savings
  // rate, category trends — one month axis, one answer), PLUS any manual ctrl+wheel
  // window mirrored back from a chart's datazoom event (2026-08-25 spec §2e) — so
  // rebuilds and same-axis siblings keep the wander. A chip pick arrives through the URL
  // as a fresh {preset} with no window: the snap-back contract, unchanged. The heatmap
  // stays whole. Adopted with the adjust-during-render idiom, never a setState in an
  // effect body (CategoriesPanel's precedent).
  const [range, setRange] = useState<RangeState>({ preset: scope.range })
  if (scope.range !== range.preset) setRange({ preset: scope.range })
  // Legend picks, mirrored from legendselectchanged and fed back via legend.selected —
  // a refetch/notMerge rebuild no longer resets toggles (the budget-line reset bug).
  const [legendSelected, setLegendSelected] = useState<Record<string, boolean>>({})
  // MERGED, never replaced: echarts hands over the FIRING chart's whole name→shown map,
  // and these charts carry different series, so replacing would let a toggle on the
  // trends chart resurrect a series hidden on the bars. A stale key is inert in
  // legend.selected (echarts ignores names no series claims), so merging is the safe way.
  const onLegendChange = (selected: Record<string, boolean>) =>
    setLegendSelected((current) => ({ ...current, ...selected }))
  const onZoomWindow = (nextWindow: ZoomWindow) =>
    setRange((current) => ({ preset: current.preset, window: nextWindow }))
  // The flow card's window. Month follows the month being LOOKED AT (drill-aware, the
  // movers' rule below); Year re-slices the SAME looked-at month's year from the rollup
  // — both datasources are already on the page, so the toggle never refetches.
  const [flowMode, setFlowMode] = useState<'month' | 'year'>('month')
  // Instance handle for the bars chart so heatmap hover can dispatch highlights into it.
  const barsChartRef = useRef<EChartsInstance | null>(null)

  // Promise callbacks, no setState in the effect's synchronous body
  // (react-hooks/set-state-in-effect) — same shape as NetWorthPage.
  const load = useCallback(() => {
    Promise.all([fetchMatrix(), fetchYearly()])
      .then(([m, y]) => {
        const snapshot: SpendingSnapshot = { matrix: m, yearly: y }
        const previous = getSnapshot<SpendingSnapshot>(SNAPSHOT_KEY)
        setSnapshot(SNAPSHOT_KEY, snapshot)
        setError(null)
        // Identical payload: nothing re-renders, the charts stay still (spec §1).
        if (previous !== undefined && JSON.stringify(previous) === JSON.stringify(snapshot))
          return
        setFromCache(false)
        setMatrix(m)
        setYearly(y)
        setTrend((current) =>
          current.length > 0 || m.categories.length === 0 ? current : defaultTrend(m),
        )
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Failed to load spending data')
      })
      .finally(() => setLoading(false))
  }, [])

  // Mount fetch is covered by useState's initial `true`; Retry flips these itself.
  const beginLoad = () => {
    setLoading(true)
    setError(null)
  }

  useEffect(() => {
    load()
  }, [load])

  const monthLabels = useMemo(() => matrix?.months.map(formatMonth) ?? [], [matrix])

  // All-time totals decide the top-7 fold AND the heatmap row order (biggest at top).
  const categoryTotals = useMemo(() => {
    if (!matrix) return []
    return matrix.series
      .map((s) => ({
        id: s.category_id,
        total: s.values.reduce((acc, v) => acc + (v === null ? 0 : Number(v)), 0),
      }))
      .sort((a, b) => b.total - a.total)
  }, [matrix])

  const nameById = useMemo(
    () => new Map((matrix?.categories ?? []).map((c) => [c.id, c.name])),
    [matrix],
  )

  // Shared by the bars fold, the drill-in pie, and the heatmap->bars highlight
  // mapping: index in this array IS the palette slot AND the bar seriesIndex.
  const topIds = useMemo(() => categoryTotals.slice(0, TOP_N).map((t) => t.id), [categoryTotals])

  // Heatmap row order (biggest all-time at top); row index -> category id, needed by
  // the heatmap option and by the hover mapping onto bar segments.
  const heatmapOrder = useMemo(() => categoryTotals.map((t) => t.id), [categoryTotals])

  // Resolved target for EChart's animated zoom path — memoized so the wrapper's
  // fingerprint compare runs only when the window can actually have moved.
  const zoomWindow = useMemo(
    () => (matrix === null ? undefined : resolvedWindow(matrix.months, range)),
    [matrix, range],
  )

  const barsOption = useMemo<EChartsOption | null>(() => {
    if (!matrix || matrix.months.length === 0) return null
    const topSet = new Set(topIds)
    const valuesById = new Map(matrix.series.map((s) => [s.category_id, s.values]))
    // A6 (2026-08-31 tier-1): absent ≠ zero. Nulls flow THROUGH to the series — echarts
    // gaps the bar — so a month with no spending entered draws nothing instead of a $0
    // stack whose tooltip lists every category at $0.00. Other sums the folded rows'
    // non-null values and is itself null when none exist that month.
    const otherPerMonth = matrix.months.map((_, i) =>
      matrix.series.reduce<number | null>((acc, s) => {
        if (topSet.has(s.category_id)) return acc
        const v = s.values[i]
        if (v === null) return acc
        return (acc ?? 0) + Number(v)
      }, null),
    )
    return {
      dataZoom: rangeZoom(matrix.months, range),
      grid: { left: 70, right: 24, top: 40, bottom: 28 },
      // 'Total budget' ships DESELECTED: it wears the same dashed-MUTED grammar as the
      // 4% line (one reference-line language), so both on at once would be ambiguous;
      // the legend chip is the summon. Mirrored picks spread OVER the default, so a
      // deliberate summon now survives option rebuilds (2026-08-25 spec §2e).
      legend: { top: 0, selected: { 'Total budget': false, ...legendSelected } },
      tooltip: {
        trigger: 'axis',
        // Category rows carry (share of month) and a bold Total; the net-pay/4%/budget
        // reference lines list after it, excluded from the sum (2026-08-25 spec §2b).
        // Padded nulls now drop instead of printing '—' rows — the house formatter rule.
        formatter: spendingBarsTooltipFormatter([
          ...topIds.map((id) => nameById.get(id) ?? String(id)),
          'Other',
        ]),
      },
      xAxis: { type: 'category', data: monthLabels },
      yAxis: {
        type: 'value',
        axisLabel: { formatter: (value: number) => formatCurrencyCompact(value) },
      },
      series: [
        // Stable ids: the drill-in pie morphs from/to these series (universalTransition
        // keys on id across notMerge setOption calls). Emphasis border mirrors the
        // heatmap's hover language — heatmap-cell hover highlights the matching segment.
        ...topIds.map((id, slot) => ({
          id: `cat-${id}`,
          name: nameById.get(id) ?? String(id),
          type: 'bar' as const,
          stack: 'spend',
          barMaxWidth: 22,
          color: PALETTE[slot],
          itemStyle: { borderColor: SURFACE, borderWidth: 1 },
          emphasis: { itemStyle: { borderColor: INK } },
          universalTransition: true,
          // A6: null passes through — a gap, never a fabricated $0 segment.
          data: (valuesById.get(id) ?? []).map((v) => (v === null ? null : Number(v))),
        })),
        {
          id: 'other',
          name: 'Other',
          type: 'bar' as const,
          stack: 'spend',
          barMaxWidth: 22,
          color: OTHER_SERIES_COLOR,
          itemStyle: { borderColor: SURFACE, borderWidth: 1 },
          emphasis: { itemStyle: { borderColor: INK } },
          universalTransition: true,
          data: otherPerMonth,
        },
        {
          id: 'net-pay',
          name: 'Net pay',
          type: 'line' as const,
          symbol: 'none' as const,
          lineStyle: { width: 2 },
          color: INK,
          z: 10,
          connectNulls: false,
          data: matrix.net_pay.map((v) => (v === null ? null : Number(v))),
        },
        {
          id: 'four-pct',
          name: '4% rule',
          type: 'line' as const,
          symbol: 'none' as const,
          // Dashed is reserved for thresholds — this IS the threshold line.
          lineStyle: { width: 2, type: 'dashed' as const },
          color: MUTED,
          z: 9,
          connectNulls: false,
          data: matrix.four_pct_rule.map((v) => (v === null ? null : Number(v))),
        },
        // LAST in the array on purpose: the heatmap-hover highlight indexes the bar stack
        // POSITIONALLY (seriesIndex), so nothing may be inserted ahead of it.
        ...(matrix.total_budget.some((v) => v !== null)
          ? [budgetStepSeries('Total budget', matrix.total_budget)]
          : []),
      ],
    }
  }, [matrix, topIds, monthLabels, nameById, range, legendSelected])

  const detailIndex = useMemo(
    () => (matrix && detailMonth ? matrix.months.indexOf(detailMonth) : -1),
    [matrix, detailMonth],
  )
  const activeDetail = detailIndex >= 0
  const detailLabel = activeDetail && matrix ? formatMonth(matrix.months[detailIndex]) : null

  const monthDetailOption = useMemo<EChartsOption | null>(() => {
    if (!matrix || detailIndex < 0) return null
    const slices = buildMonthSlices(matrix, topIds, detailIndex)
    if (slices.length === 0) return null
    return {
      tooltip: {
        // HTML formatter: category names are user text — escapeHtml is mandatory.
        formatter: (params) => {
          const p = Array.isArray(params) ? params[0] : params
          return (
            `<strong>${formatCurrency(p.value as number)}</strong> · ` +
            `${(p.percent ?? 0).toFixed(1)}%<br/>${escapeHtml(p.name ?? '')}`
          )
        },
      },
      series: [
        {
          id: 'month-pie',
          type: 'pie' as const,
          radius: ['42%', '70%'],
          itemStyle: { borderColor: SURFACE, borderWidth: 2 },
          label: { color: INK, formatter: '{b}  {d}%' },
          emphasis: { itemStyle: { borderColor: INK } },
          // Morph the month's bar segments into slices and back out on exit; falls back
          // to a plain swap under reduced motion (EChart forces animation off).
          universalTransition: {
            enabled: true,
            seriesKey: [...topIds.map((id) => `cat-${id}`), 'other'],
          },
          data: slices.map((s) => ({
            name: s.name,
            value: s.value,
            itemStyle: { color: s.slot === null ? OTHER_SERIES_COLOR : PALETTE[s.slot] },
          })),
        },
      ],
    }
  }, [matrix, detailIndex, topIds])

  // The page's FOCUSED month: the drilled month when the pie is open, the latest month
  // otherwise. The movers, the flow card and the Budget card all read it, so drilling a
  // month on the top chart moves the whole page's "what happened here" together.
  const focusIndex = matrix ? (activeDetail ? detailIndex : matrix.months.length - 1) : -1
  const movers = useMemo(
    () => (matrix ? monthMovers(matrix, focusIndex, MOVERS_TOP) : []),
    [matrix, focusIndex],
  )
  // The vs-budget column exists only when SOME mover has a budget that month — an
  // all-dashes column would be noise on an unbudgeted page.
  const showVsBudget = hasVsBudget(movers)

  const flowPeriod = useMemo(
    () => spendingFlowPeriod(matrix, yearly, topIds, focusIndex, flowMode),
    [matrix, yearly, topIds, focusIndex, flowMode],
  )
  const flowOption = useMemo(
    () => (flowPeriod === null ? null : spendingSankeyOption(flowPeriod)),
    [flowPeriod],
  )

  const handleSpendChartClick = (params: EChartEventParams) => {
    if (activeDetail) {
      setDetailMonth(null) // any chart click in detail mode returns to all months
      return
    }
    const index = params.dataIndex
    if (matrix && typeof index === 'number' && index >= 0 && index < matrix.months.length) {
      setDetailMonth(matrix.months[index])
    }
  }

  // Heatmap cell -> the EXACT bar segment it corresponds to: the category's own series
  // when it made the top fold, the "Other" stack segment when folded. seriesIndex is
  // positional in barsOption.series — kept in lockstep by both deriving from topIds.
  const handleHeatmapHover = (params: EChartEventParams) => {
    if (!matrix || activeDetail || params.seriesType !== 'heatmap') return
    if (!Array.isArray(params.value)) return
    const [col, row] = params.value as [number, number, number]
    const categoryId = heatmapOrder[row]
    if (categoryId === undefined) return
    const top = topIds.indexOf(categoryId)
    barsChartRef.current?.dispatchAction({
      type: 'highlight',
      seriesIndex: top >= 0 ? top : topIds.length,
      dataIndex: col,
    })
  }

  const handleHeatmapHoverEnd = () => {
    // Downplay every stack series — cheaper than tracking which one lit up, and a
    // harmless no-op when nothing is highlighted (or the pie is showing).
    barsChartRef.current?.dispatchAction({
      type: 'downplay',
      seriesIndex: Array.from({ length: topIds.length + 1 }, (_, i) => i),
    })
  }

  const heatmapOption = useMemo<EChartsOption | null>(() => {
    if (!matrix || matrix.months.length === 0) return null
    const order = heatmapOrder // biggest at top
    const rowIndex = new Map(order.map((id, i) => [id, i]))
    const cells: [number, number, number][] = []
    let max = 0
    for (const s of matrix.series) {
      const row = rowIndex.get(s.category_id)
      if (row === undefined) continue
      s.values.forEach((v, col) => {
        if (v === null) return
        const n = Number(v)
        max = Math.max(max, n)
        cells.push([col, row, n])
      })
    }
    return {
      // bottom must clear BOTH the 45°-rotated month labels (~48px) and the visualMap
      // bar parked at bottom: 0 (~30px) — 64 made them overlap.
      grid: { left: 130, right: 24, top: 8, bottom: 96 },
      tooltip: {
        // HTML formatter: category names are user text — escapeHtml is mandatory.
        formatter: (params) => {
          // `TopLevelFormatterParams` is `CallbackDataParams | CallbackDataParams[]`;
          // item-trigger only ever passes the single form, but narrowing the union
          // (rather than asserting past it) keeps the assertion down to the one
          // property whose declared type already admits an array of values.
          const p = Array.isArray(params) ? params[0] : params
          const [col, row, value] = p.value as [number, number, number]
          const name = nameById.get(order[row]) ?? ''
          return `<strong>${formatCurrency(value)}</strong><br/>${escapeHtml(name)} · ${escapeHtml(monthLabels[col] ?? '')}`
        },
      },
      xAxis: { type: 'category', data: monthLabels, axisLabel: { rotate: 45 } },
      yAxis: {
        type: 'category',
        data: order.map((id) => nameById.get(id) ?? String(id)),
        inverse: true,
        axisLabel: { width: 118, overflow: 'truncate' as const },
      },
      visualMap: {
        min: 0,
        max: Math.max(max, 1),
        calculable: false,
        orient: 'horizontal',
        left: 'center',
        bottom: 0,
        inRange: { color: [...SEQUENTIAL_BLUE] },
        textStyle: { color: MUTED },
        formatter: (value) => formatCurrencyCompact(value as number),
      },
      series: [
        {
          type: 'heatmap' as const,
          data: cells,
          itemStyle: { borderColor: SURFACE, borderWidth: 1 },
          emphasis: { itemStyle: { borderColor: INK, borderWidth: 1 } },
        },
      ],
    }
  }, [matrix, heatmapOrder, monthLabels, nameById])

  const savingsOption = useMemo<EChartsOption | null>(() => {
    if (!matrix || matrix.months.length === 0) return null
    return {
      dataZoom: rangeZoom(matrix.months, range), // the page's one window (see `range`)
      grid: { left: 60, right: 24, top: 16, bottom: 28 },
      tooltip: {
        trigger: 'axis',
        // True value in the tooltip even when the line is clamped out of frame.
        valueFormatter: (value) =>
          value === null || value === undefined
            ? '—'
            : formatPct(value as number, { signed: false }),
      },
      xAxis: { type: 'category', data: monthLabels, boundaryGap: false },
      yAxis: {
        type: 'value',
        // A7 (2026-08-31 tier-1): the ceiling stays +100% (rates above 1 are impossible),
        // but the FLOOR expands to the data — a −180% month must render inside the frame,
        // not silently leave it. floor() lands the min on a whole −100% gridline step; the
        // Math.min(-1, …) keeps at least the −100% floor when the data never goes there.
        min: (extent: { min: number }) => Math.min(-1, Math.floor(extent.min)),
        max: (extent: { max: number }) => Math.min(Math.max(extent.max, 0.1), 1),
        axisLabel: { formatter: (value: number) => formatPct(value, { signed: false }) },
      },
      series: [
        {
          name: 'Savings rate (actual)',
          type: 'line' as const,
          symbol: 'none' as const,
          lineStyle: { width: 2 },
          color: PALETTE[0],
          connectNulls: false,
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: MUTED, width: 1, type: 'solid' as const },
            label: { show: false },
            data: [{ yAxis: 0 }],
          },
          data: matrix.savings_rate.map((v) => (v === null ? null : Number(v))),
        },
      ],
    }
  }, [matrix, monthLabels, range])

  const trendOption = useMemo<EChartsOption | null>(() => {
    if (!matrix || matrix.months.length === 0 || trend.length === 0) return null
    const valuesById = new Map(matrix.series.map((s) => [s.category_id, s.values]))
    return {
      dataZoom: rangeZoom(matrix.months, range), // the page's one window (see `range`)
      grid: { left: 70, right: 24, top: 40, bottom: 28 },
      legend: { top: 0, selected: legendSelected },
      tooltip: {
        trigger: 'axis',
        valueFormatter: (value) =>
          value === null || value === undefined ? '—' : formatCurrency(value as number),
      },
      xAxis: { type: 'category', data: monthLabels, boundaryGap: false },
      yAxis: {
        type: 'value',
        axisLabel: { formatter: (value: number) => formatCurrencyCompact(value) },
      },
      series: [
        ...trend.map(({ categoryId, slot }) => ({
          name: nameById.get(categoryId) ?? String(categoryId),
          type: 'line' as const,
          symbol: 'none' as const,
          lineStyle: { width: 2 },
          color: PALETTE[slot],
          connectNulls: false,
          data: (valuesById.get(categoryId) ?? []).map((v) => (v === null ? null : Number(v))),
        })),
        // A picked category's budget as a dashed MUTED step (spec §4.3) — named
        // "{category} budget" so the axis tooltip disambiguates when several show.
        ...trend.flatMap(({ categoryId }) => {
          const s = matrix.series.find((x) => x.category_id === categoryId)
          if (!s || !s.budgets.some((v) => v !== null)) return []
          const name = nameById.get(categoryId) ?? String(categoryId)
          return [budgetStepSeries(`${name} budget`, s.budgets)]
        }),
      ],
    }
  }, [matrix, trend, monthLabels, nameById, range, legendSelected])

  const toggleTrend = (categoryId: number) => {
    setTrend((current) => {
      const existing = current.find((t) => t.categoryId === categoryId)
      if (existing) return current.filter((t) => t.categoryId !== categoryId)
      if (current.length >= MAX_TREND) return current
      const used = new Set(current.map((t) => t.slot))
      const slot = [0, 1, 2].find((s) => !used.has(s)) ?? 0
      return [...current, { categoryId, slot }]
    })
  }

  // KPI row: latest data month + trailing-12 average + latest savings rate.
  const kpis = useMemo(() => {
    if (!matrix || matrix.months.length === 0) return null
    const last = matrix.months.length - 1
    // A6: a month no category reported (cashflow-only) is ABSENT, not a $0 month — it
    // must not dilute the average. totals[] itself carries "0.00" for such months (the
    // server sums over an empty set), so enteredness is judged on the SERIES — the same
    // rule filledMonths uses for the ribbon below.
    const entered = matrix.months.map((_, i) => matrix.series.some((s) => s.values[i] !== null))
    const window = matrix.totals
      .map((total, i) => ({ total: Number(total), entered: entered[i] }))
      .slice(-12)
      .filter((cell) => cell.entered)
    const average =
      window.length === 0
        ? null
        : window.reduce((acc, cell) => acc + cell.total, 0) / window.length
    return {
      month: matrix.months[last],
      total: matrix.totals[last],
      average,
      savings: matrix.savings_rate[last],
      netPay: matrix.net_pay[last],
    }
  }, [matrix])

  // What each ribbon chip PRINTS. Which months are entered is the ScopeBar's own business
  // (it reads /coverage for the two-tone chips); this page contributes only the figure —
  // that month's total spend — so the ribbon answers "how much" without a second fetch.
  const ribbonFigures = useMemo(
    () =>
      matrix === null
        ? undefined
        : Object.fromEntries(matrix.months.map((m, i) => [m, formatCurrency(matrix.totals[i])])),
    [matrix],
  )

  return (
    <div className="page">
      <PageFrame
        title="Spending"
        actions={
          <button
            className="button button-primary"
            onClick={() => navigate('/update?step=spending')}
          >
            <PencilLine size={15} /> Enter month
          </button>
        }
        scopeRow={
          <ScopeBar
            range
            month={{
              mode: 'view',
              figures: ribbonFigures,
              editHref: (month) => `/update?month=${month}&step=spending`,
            }}
          />
        }
        resource={{
          status: matrix === null ? (error !== null ? 'error' : 'loading') : 'ready',
          error,
          busy: loading,
          fromCache,
          retry: () => {
            beginLoad()
            load()
          },
        }}
        skeleton={{
          tiles: 4,
          cards: [
            { span: 12, height: 360 },
            { span: 6, height: 300 },
            { span: 6, height: 300 },
          ],
        }}
      >
        {kpis && (
          <div className="kpi-row">
            <StatTile
              label={`Spend — ${formatMonth(kpis.month)}`}
              value={formatCurrency(kpis.total)}
              hint="The latest entered month's total across all categories."
            />
            <StatTile
              label="12-month average"
              value={formatCurrency(kpis.average)}
              hint="Mean monthly spend over the last 12 entered months, including the latest."
            />
            <StatTile
              label="Savings rate (actual)"
              value={kpis.savings === null ? '—' : formatPct(kpis.savings, { signed: false })}
              hint="(net pay − spend) ÷ net pay for the latest month."
            />
            <StatTile
              label="Net pay"
              value={formatCurrency(kpis.netPay)}
              hint="Take-home pay entered for the latest month."
            />
          </div>
        )}

        <div className="card-grid">
          <div className="card span-12">
            <div className="spending-chart-header">
              <h2 className="eyebrow">
                {detailLabel
                  ? `Spending breakdown — ${detailLabel}`
                  : `Monthly spend vs net pay — top ${TOP_N} categories + other`}
                <InfoHint text="Top categories stacked per month under your net-pay line; the dashed line is what your investable assets could sustainably fund each month. Click a bar for that month's breakdown." />
              </h2>
              {/* The drill-in's way back. It stays here beside the pie it undoes, where the
                  eye already is — the scope row's "Back to latest" chip clears the same
                  selection from the other end. */}
              {activeDetail ? (
                <button className="button" onClick={() => setDetailMonth(null)}>
                  All months
                </button>
              ) : null}
            </div>
            {activeDetail && matrix ? (
              <>
                <p className="drill-hint">
                  Total {formatCurrency(matrix.totals[detailIndex])} · Net pay{' '}
                  {formatCurrency(matrix.net_pay[detailIndex])} · Savings{' '}
                  {matrix.savings_rate[detailIndex] === null
                    ? '—'
                    : formatPct(matrix.savings_rate[detailIndex], { signed: false })}{' '}
                  — click the chart to go back.
                </p>
                {monthDetailOption ? (
                  <EChart
                    option={monthDetailOption}
                    height={340}
                    onClick={handleSpendChartClick}
                    instanceRef={barsChartRef}
                    animateEntrance={!fromCache}
                  />
                ) : (
                  <div className="empty-note">No spending recorded for {detailLabel}.</div>
                )}
              </>
            ) : barsOption && matrix ? (
              <>
                <p className="drill-hint">Click a month's bar to expand its breakdown.</p>
                <EChart
                  option={barsOption}
                  height={340}
                  onClick={handleSpendChartClick}
                  instanceRef={barsChartRef}
                  onLegendChange={onLegendChange}
                  onDataZoom={onZoomWindow}
                  zoomWindow={zoomWindow}
                  exportConfig={{ name: 'spending', csv: () => spendingCsv(matrix, topIds, nameById) }}
                  animateEntrance={!fromCache}
                />
                <ChartZoomHint />
              </>
            ) : (
              !loading &&
              !error && (
                <div className="empty-note">No spending recorded yet — enter a month to begin.</div>
              )
            )}
          </div>

          {movers.length > 0 && (
            <div className="card span-12">
              <h2 className="eyebrow">
                What changed — {monthLabels[focusIndex]}
                <InfoHint text="The month's biggest category moves, vs the prior month and vs each category's 12-month average." />
              </h2>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th className="num">{monthLabels[focusIndex]}</th>
                    <th className="num">
                      vs {focusIndex > 0 ? monthLabels[focusIndex - 1] : 'prior month'}
                    </th>
                    <th className="num">vs 12-mo avg</th>
                    {showVsBudget && <th className="num">vs budget</th>}
                  </tr>
                </thead>
                <tbody>
                  {movers.map((m) => (
                    <tr key={m.categoryId}>
                      <td>{nameById.get(m.categoryId) ?? String(m.categoryId)}</td>
                      <td className="num">{formatCurrency(m.value)}</td>
                      <td className="num">{moverCell(m.deltaPrior)}</td>
                      <td className="num">{moverCell(m.deltaAvg)}</td>
                      {showVsBudget && <td className="num">{moverCell(m.deltaBudget)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="drill-hint">
                The {MOVERS_TOP} biggest category moves for the month above — drill into a
                month on the top chart to see its movers instead.
              </p>
            </div>
          )}

          {flowPeriod && (
            <div className="card span-12">
              <div className="spending-chart-header">
                <h2 className="eyebrow">
                  Where {flowPeriod.label} went
                  <InfoHint text="Net pay fanned out across the period's categories, wearing the stacked chart's colors; green Saved is what was left. A deficit period adds a red Drawdown source covering the overspend." />
                </h2>
                <div className="segmented" role="group" aria-label="Flow window">
                  {(['month', 'year'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={flowMode === mode ? 'active' : ''}
                      aria-pressed={flowMode === mode}
                      onClick={() => setFlowMode(mode)}
                    >
                      {mode === 'month' ? 'Month' : 'Year'}
                    </button>
                  ))}
                </div>
              </div>
              {flowOption ? (
                <>
                  <EChart
                    option={flowOption}
                    height={320}
                    ariaLabel={`Sankey flow of where ${flowPeriod.label} went, from net pay into categories and savings`}
                    animateEntrance={!fromCache}
                  />
                  <p className="drill-hint">
                    Hover a node to trace its flows; drill a month on the top chart and this
                    card follows it.
                  </p>
                </>
              ) : (
                <div className="empty-note">
                  {flowPeriod.netPay === null
                    ? `Enter net pay for ${flowPeriod.label} to see the flow.`
                    : `No flow to draw for ${flowPeriod.label}.`}
                </div>
              )}
            </div>
          )}

          {/* onBudgetsChanged = the page's refetch: a saved budget re-draws the meters, the
              chart reference lines and the movers column together, from one matrix. */}
          {matrix && matrix.months.length > 0 && (
            <BudgetPanel matrix={matrix} monthIndex={focusIndex} onBudgetsChanged={load} />
          )}

          {/* Long-run half, summary before detail (2026-08-31 audit): the range-windowed
              pair reads right after the budgets that feed the trends chart's step lines;
              the never-windowed full-history pair (heatmap, yearly) closes the page. */}
          <div className="card span-6">
            <h2 className="eyebrow">
              Savings rate (actual)
              <InfoHint text="(net pay − spend) ÷ net pay each month; above the zero line you saved, below it you overspent." />
            </h2>
            {savingsOption && (
              <>
                <EChart
                  option={savingsOption}
                  height={260}
                  onDataZoom={onZoomWindow}
                  zoomWindow={zoomWindow}
                  animateEntrance={!fromCache}
                />
                <ChartZoomHint />
              </>
            )}
            <p className="drill-hint">
              (net pay − spend) ÷ net pay, per month. The old sheet's column tracked a
              planned rate, so values differ by design.
            </p>
          </div>

          <div className="card span-6">
            <h2 className="eyebrow">
              Category trends
              <InfoHint text="Single-category history — pick up to 3 to compare." />
            </h2>
            <div className="chip-row">
              {matrix?.categories.map((category) => {
                const active = trend.find((t) => t.categoryId === category.id)
                // Slot hue goes on the BORDER, never the text (text stays --text via
                // .chip.active) — series color marks identity beside text, not in it.
                // The DOM swatch reads the CSS slot, not PALETTE: index.css repoints
                // --chart-N per theme, so the chip border tracks a light/dark switch that a
                // baked dark hex would ignore. Slots are 0-based, the tokens are 1-based.
                return (
                  <button
                    key={category.id}
                    type="button"
                    className={active ? 'chip active' : 'chip'}
                    style={active ? { borderColor: `var(--chart-${active.slot + 1})` } : undefined}
                    aria-pressed={!!active}
                    onClick={() => toggleTrend(category.id)}
                  >
                    {category.name}
                  </button>
                )
              })}
            </div>
            {trendOption ? (
              <>
                <EChart
                  option={trendOption}
                  height={220}
                  onLegendChange={onLegendChange}
                  onDataZoom={onZoomWindow}
                  zoomWindow={zoomWindow}
                  animateEntrance={!fromCache}
                />
                <ChartZoomHint />
              </>
            ) : (
              <div className="empty-note">Pick up to {MAX_TREND} categories.</div>
            )}
          </div>

          <div className="card span-12">
            <h2 className="eyebrow">
              Month × category heatmap
              <InfoHint text="Spend per category per month on one shared scale — darker is more. Rows are ordered by all-time total." />
            </h2>
            {heatmapOption && (
              <EChart
                option={heatmapOption}
                height={Math.max(332, (matrix?.categories.length ?? 0) * 24 + 142)}
                ariaLabel="Heatmap of spend per category per month — darker is more"
                onHover={handleHeatmapHover}
                onHoverEnd={handleHeatmapHoverEnd}
                animateEntrance={!fromCache}
              />
            )}
          </div>

          <div className="card span-12">
            <h2 className="eyebrow">
              Yearly rollups
              <InfoHint text="Category totals per calendar year, with net pay and that year's savings rate." />
            </h2>
            <div className="yearly-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Category</th>
                    {yearly?.years.map((y) => (
                      <th key={y.year} className="num">
                        {y.year}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrix?.categories.map((category) => (
                    <tr key={category.id}>
                      <td>{category.name}</td>
                      {yearly?.years.map((y) => {
                        const cell = y.by_category.find((c) => c.category_id === category.id)
                        return (
                          <td key={y.year} className="num">
                            {formatCurrency(cell?.total ?? null)}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td style={{ fontWeight: 600 }}>Total</td>
                    {yearly?.years.map((y) => (
                      <td key={y.year} className="num" style={{ fontWeight: 600 }}>
                        {formatCurrency(y.total)}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td>Net pay</td>
                    {yearly?.years.map((y) => (
                      <td key={y.year} className="num">
                        {formatCurrency(y.net_pay_total)}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td>Savings rate</td>
                    {yearly?.years.map((y) => (
                      <td key={y.year} className="num">
                        {y.savings_rate === null ? '—' : formatPct(y.savings_rate, { signed: false })}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      </PageFrame>
    </div>
  )
}
