import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PencilLine } from 'lucide-react'
import { describeError } from '../api/client'
import { fetchMatrix, fetchYearly } from '../api/spending'
import { getSnapshot, setSnapshot } from '../api/snapshotCache'
import ChartCard from '../components/ChartCard'
import BreakdownLegend from '../components/spending/BreakdownLegend'
import type { EChartEventParams, EChartsInstance } from '../components/EChart'
import InfoHint from '../components/InfoHint'
import { FeedBanner } from '../components/shell/Feed'
import PageFrame from '../components/shell/PageFrame'
import ScopeBar from '../components/shell/ScopeBar'
import { useScopeCoverage } from '../components/shell/useScopeCoverage'
import { useScope } from '../components/shell/useScope'
import StatTile from '../components/StatTile'
import useSpendingEvidence from '../components/metrics/useSpendingEvidence'
import { REVIEW_LABELS } from '../api/monthReview'
import { LocalSectionNav, LocalSectionPanel, useLocalSections } from '../components/shell/LocalSections'
import type { ChartSelection } from '../types/metrics'
import SelectionDetail from '../components/details/SelectionDetail'
import { useArrivalValue } from '../components/useArrivalParam'
import { useChartDecals } from '../components/useChartDecals'
import Segmented from '../components/shell/Segmented'
import BudgetPanel from '../components/spending/BudgetPanel'
import {
  HEATMAP_MODES,
  categorySmallMultiplesOption,
  categoryTrendCsv,
  categoryTrendOption,
  heatmapCsv,
  heatmapOption,
  heatmapRows,
  monthPieCsv,
  monthPieLegend,
  monthPieOption,
  savingsRateCsv,
  savingsRateOption,
  smallMultiplesHeight,
  spendingBarsOption,
  spendingCsv,
} from '../components/spending/spendingChartOptions'
import type { HeatmapMode } from '../components/spending/spendingChartOptions'
import {
  spendingFlowPeriod,
  spendingSankeyCsv,
  spendingSankeyOption,
} from '../components/spending/spendingSankeyOptions'
import { EMPTY_FOLD, entityCssVar, foldCategories, pickColors, rankCategories } from '../charts/entities'
import { partialFootnote, partlyEnteredMonths } from '../charts/partlyEntered'
import { resolvedWindow } from '../charts/timeZoom'
import type { RangeState, ZoomWindow } from '../charts/timeZoom'
import type { SpendingMatrix, SpendingYearly } from '../types/api'
import { formatCurrency, formatCurrencyWhole, formatMonth, formatPct, outflowsLine } from '../utils/format'
import { addMonths, todayIso } from '../utils/months'
import { hasVsBudget, monthMovers } from '../utils/spending'
import '../components/panels.css'
import './SpendingPage.css'

const MAX_TREND = 3
// The Trends pair's one plot height (2026-09-25 polish spec §3.1, NWSP-08): 260 and 220 put the two
// plots 14px apart and ended the cards 36–84px apart. Held, not a floor: the pair's footers differ (a
// two-line hint vs the chip row), and a filling Savings plot soaked that difference up, putting the
// linked month axes 62–110px apart. So neither card fills; the shorter one pins its caption to its foot
// (chartInteractions.css) and the two still end together.
const TREND_HEIGHT = 260
const MOVERS_TOP = 5
const SECTIONS = [{ id: 'overview', label: 'Overview' }, { id: 'trends', label: 'Trends' }, { id: 'budgets', label: 'Budgets' }, { id: 'history', label: 'History' }] as const

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

// Default trend pick — the single biggest all-time category (the fold's own ranking,
// charts/entities.ts). Extracted from load()'s .then so a cache-seeded mount derives the
// same default (spec §1).
function defaultTrend(m: SpendingMatrix): { categoryId: number }[] {
  if (m.categories.length === 0) return []
  const [biggest] = rankCategories(m)
  return biggest === undefined ? [] : [{ categoryId: biggest.id }]
}

/** A tile's second line against the month before (2026-09-25 polish spec §4.4): "▲ 2.8 pts vs Jun",
 *  "▼ $859 vs Jun" — the glyph carries the direction, so `change` words the difference unsigned; up is
 *  good for both, so the tone follows it — "same as Jun" under `flat`, "No Jun to compare" when that month
 *  has no comparable figure, and `missing` when this month has none of its own. */
function versusMonthBefore(
  current: string | null,
  previous: string | null,
  previousMonth: string,
  change: (difference: number) => string,
  flat: number,
  missing: string,
): { text: string; tone: 'positive' | 'negative' | 'neutral' } {
  const name = formatMonth(previousMonth).slice(0, 3)
  if (current === null) return { text: missing, tone: 'neutral' }
  if (previous === null) return { text: `No ${name} to compare`, tone: 'neutral' }
  const difference = Number(current) - Number(previous)
  if (Math.abs(difference) < flat) return { text: `same as ${name}`, tone: 'neutral' }
  return { text: `${change(Math.abs(difference))} vs ${name}`, tone: difference > 0 ? 'positive' : 'negative' }
}

/** The comparison's count — "1 eligible month" for the history's first month, never "1 … months". */
function eligibleMonths(count: number): string {
  return `${count} eligible ${count === 1 ? 'month' : 'months'}`
}

/** The Living spending tile's line (2026-09-25 polish review): the month's other outflows in the
 *  Review's own words (utils/format outflowsLine); nothing on a payload without the two series. */
function otherOutflows(tax: string | undefined, transfers: string | undefined): string | undefined {
  return tax === undefined && transfers === undefined ? undefined : outflowsLine(tax, transfers)
}

export default function SpendingPage() {
  const navigate = useNavigate()
  const views = useLocalSections(SECTIONS, 'overview', { resolveLegacy: ({ searchParams, hash }) => searchParams.has('trend') ? 'trends' : hash.includes('budget') ? 'budgets' : undefined })
  const cached = getSnapshot<SpendingSnapshot>(SNAPSHOT_KEY)
  const [matrix, setMatrix] = useState<SpendingMatrix | null>(cached?.matrix ?? null)
  const [yearly, setYearly] = useState<SpendingYearly | null>(cached?.yearly ?? null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // The SECOND feed's own failure (2026-09-09 audit item 10): the matrix owns the frame, so
  // a yearly rollup that 500s banners itself over charts that are perfectly fine.
  const [yearlyError, setYearlyError] = useState<string | null>(null)
  // What the page is actually SHOWING — the revalidation skip in load() is judged against
  // this, never the cache, so a feed that failed cannot be stranded by an identical payload
  // (NetWorthPage's `shown` precedent).
  const shown = useRef<SpendingSnapshot | null>(cached ?? null)
  const [trend, setTrend] = useState<{ categoryId: number }[]>(() =>
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
      if (category) setTrend([{ categoryId: category.id }])
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
  // F1: the heatmap's reading of its own cells, and whether the categories that never spent
  // a cent take up rows. Card-local — neither belongs in the shared URL scope.
  const [heatmapMode, setHeatmapMode] = useState<HeatmapMode>('row')
  const [showDormant, setShowDormant] = useState(false)
  // The trends card's two readings: up to three picks compared on one axis, or EVERY
  // category as its own tiny line (small multiples — one option, one mount).
  const [trendView, setTrendView] = useState<'compare' | 'all'>('compare')
  // Instance handle for the bars chart so heatmap hover can dispatch highlights into it.
  const barsChartRef = useRef<EChartsInstance | null>(null)

  // Promise callbacks, no setState in the effect's synchronous body
  // (react-hooks/set-state-in-effect) — same shape as NetWorthPage.
  const load = useCallback(() => {
    // allSettled, never all: the two feeds answer INDEPENDENTLY (2026-09-09 audit item 10).
    // One rejection used to reject the pair, so a 500 on the yearly rollup blanked every
    // chart the matrix had already paid for — and printed the server's own detail instead.
    Promise.allSettled([fetchMatrix(), fetchYearly()])
      .then(([matrixResult, yearlyResult]) => {
        // Both nouns are the page's own words: `errorDetail` keeps a 5xx body out of the UI.
        setError(
          matrixResult.status === 'rejected'
            ? describeError(matrixResult.reason, 'spending')
            : null,
        )
        setYearlyError(
          yearlyResult.status === 'rejected'
            ? describeError(yearlyResult.reason, 'the yearly rollup')
            : null,
        )
        if (yearlyResult.status === 'rejected') {
          // The rollup card goes quiet rather than standing there with empty columns, and
          // `shown` goes with it: it records what is RENDERED, and half a snapshot is not —
          // left standing, the identical-payload skip below would strand the card hidden the
          // next time the pair answers with exactly what the failed load never got to show.
          setYearly(null)
          shown.current = null
        }
        if (matrixResult.status === 'rejected') return
        const m = matrixResult.value
        const seedTrend = () =>
          setTrend((current) =>
            current.length > 0 || m.categories.length === 0 ? current : defaultTrend(m),
          )
        if (yearlyResult.status === 'rejected') {
          // Charts only — and nothing is cached, because half a pair is not a snapshot
          // anything may be painted from later.
          setFromCache(false)
          setMatrix(m)
          seedTrend()
          return
        }
        const snapshot: SpendingSnapshot = { matrix: m, yearly: yearlyResult.value }
        setSnapshot(SNAPSHOT_KEY, snapshot)
        // Identical payload: nothing re-renders, the charts stay still (spec §1) — judged
        // against the RENDERED snapshot, never the cache (see `shown`).
        if (shown.current !== null && JSON.stringify(shown.current) === JSON.stringify(snapshot))
          return
        shown.current = snapshot
        setFromCache(false)
        setMatrix(m)
        setYearly(yearlyResult.value)
        seedTrend()
      })
      .finally(() => setLoading(false))
  }, [])

  // The BANNER's retry, and deliberately not `load`: the matrix on screen answered, and
  // re-fetching it would repaint charts that never failed (its payload is a fresh object, and
  // `shown` is null while the pair is broken, so the identical-payload skip cannot catch it).
  // On success the pair is whole again, so the cache and `shown` are written from the matrix
  // already in hand.
  const retryYearly = useCallback(() => {
    setLoading(true)
    setYearlyError(null)
    fetchYearly()
      .then((y) => {
        setYearly(y)
        if (matrix === null) return // nothing on screen to pair it with
        const snapshot: SpendingSnapshot = { matrix, yearly: y }
        setSnapshot(SNAPSHOT_KEY, snapshot)
        shown.current = snapshot
      })
      .catch((err: unknown) => setYearlyError(describeError(err, 'the yearly rollup')))
      .finally(() => setLoading(false))
  }, [matrix])

  // Mount fetch is covered by useState's initial `true`; Retry flips these itself.
  const beginLoad = () => {
    setLoading(true)
    setError(null)
    setYearlyError(null)
  }

  useEffect(() => {
    load()
  }, [load])

  const monthLabels = useMemo(() => matrix?.months.map(formatMonth) ?? [], [matrix])
  // The month in progress is drawn as such on the bars and the heatmap (2026-09-23 spec §C5):
  // judged against the product's today, hatched or faded by Appearance › Chart patterns.
  const today = todayIso()
  const patterns = useChartDecals()
  // A month whose spending is only partly entered keeps the partial look after it has ended
  // (2026-09-23 spec §T12) — `time.flows_due` from the coverage the scope row fetches and hands up,
  // never a second request (useScopeCoverage: an identical answer rebuilds no chart option).
  const { onCoverage, flowsDue } = useScopeCoverage()
  // The month the Budget card opens on with nothing picked (its own rule, a pin after a write
  // included): the scope row's default month on the Budgets view (2026-09-23 spec §T8).
  // undefined until the card has said (the scope row stands in its newest covered month).
  const [budgetsMonth, setBudgetsMonth] = useState<string | null | undefined>(undefined)
  // Their '*' on that month, said in words under each card (the 2026-09-23 code review, 13) —
  // in progress, partly entered, or both.
  const footnote = matrix === null ? null : partialFootnote(matrix.months, today, partlyEnteredMonths(flowsDue))

  // The all-time ranking decides the fold — every category colour on this page — AND the
  // heatmap row order (biggest at top). ONE ranking, shared with the Overview money flow
  // (charts/entities.ts, 2026-09-23 spec §C2), so a category is the same colour everywhere.
  const ranked = useMemo(() => (matrix ? rankCategories(matrix) : []), [matrix])
  const fold = useMemo(() => (matrix ? foldCategories(ranked) : EMPTY_FOLD), [matrix, ranked])

  const nameById = useMemo(
    () => new Map((matrix?.categories ?? []).map((c) => [c.id, c.name])),
    [matrix],
  )

  // Shared by the bars, the drill-in pie, and the heatmap->bars highlight mapping: index in
  // this array IS the bar seriesIndex (the fold's own order — its colours ride in `fold`).
  const topIds = fold.ids

  // Heatmap row order (biggest all-time at top); row index -> category id, needed by
  // the heatmap option and by the hover mapping onto bar segments.
  const heatmapOrder = useMemo(() => ranked.map((t) => t.id), [ranked])

  // Resolved target for EChart's animated zoom path — memoized so the wrapper's
  // fingerprint compare runs only when the window can actually have moved.
  const zoomWindow = useMemo(
    () => (matrix === null ? undefined : resolvedWindow(matrix.months, range)),
    [matrix, range],
  )

  const barsOption = useMemo(
    () =>
      matrix === null
        ? null
        : spendingBarsOption({
            matrix, fold, nameById, monthLabels, range, selected: legendSelected, todayIso: today, patterns, flowsDue,
          }),
    [matrix, fold, nameById, monthLabels, range, legendSelected, today, patterns, flowsDue],
  )

  const detailIndex = useMemo(
    () => (matrix && detailMonth ? matrix.months.indexOf(detailMonth) : -1),
    [matrix, detailMonth],
  )
  const activeDetail = detailIndex >= 0

  // The page's FOCUSED month: the drilled month when the pie is open, the latest month
  // otherwise. The movers, the flow card and the Budget card all read it, so drilling a
  // month on the top chart moves the whole page's "what happened here" together.
  // The page's month with nothing picked (its last complete month) — the Budget card's last-resort
  // opening month too, which must never be a pick (2026-09-23 spec §T8; spec re-check R1).
  const restingIndex = matrix ? (matrix.default_month !== undefined ? matrix.months.indexOf(matrix.default_month ?? '') : matrix.months.length - 1) : -1
  const focusIndex = matrix ? (activeDetail ? detailIndex : restingIndex) : -1
  const focusMonth = matrix?.months[focusIndex]
  const evidence = useSpendingEvidence(focusMonth, matrix)
  const movers = useMemo(
    () => (matrix ? monthMovers(matrix, focusIndex, MOVERS_TOP) : []),
    [matrix, focusIndex],
  )
  // The vs-budget column exists only when SOME mover has a budget that month — an
  // all-dashes column would be noise on an unbudgeted page.
  const showVsBudget = hasVsBudget(movers)

  const flowPeriod = useMemo(
    () => spendingFlowPeriod(matrix, yearly, fold, focusIndex, flowMode),
    [matrix, yearly, fold, focusIndex, flowMode],
  )
  const flowOption = useMemo(
    () => (flowPeriod === null ? null : spendingSankeyOption(flowPeriod)),
    [flowPeriod],
  )

  const periodSelection = useCallback((index: number): ChartSelection | null => {
    if (!matrix || index < 0 || index >= matrix.months.length) return null
    const selectedMonth = matrix.months[index]
    return { kind: 'period', id: `spending:${selectedMonth}`, period: selectedMonth, label: formatMonth(selectedMonth), scope: 'Household',
      values: [{ label: 'Living spending', value: matrix.living_total?.[index] ?? null, unit: 'USD' },
        { label: 'Tax paid from take-home', value: matrix.tax_total?.[index] ?? null, unit: 'USD' },
        { label: 'Transfers', value: matrix.transfer_total?.[index] ?? null, unit: 'USD' },
        { label: 'All category entries', value: matrix.totals[index], unit: 'USD' },
        { label: 'Take-home pay', value: matrix.net_pay[index], unit: 'USD' }],
      source: { href: `/update?month=${selectedMonth}&step=spending`, label: 'Open monthly entries' },
      context: { month: selectedMonth, definition: 'All-category chart; living, tax and transfers are identified separately.' },
    }
  }, [matrix])
  const selectedPeriod = useMemo(() => activeDetail ? periodSelection(detailIndex) : null, [activeDetail, detailIndex, periodSelection])

  // The heatmap's rows: the page's all-time order minus dormant categories unless asked
  // for. `visible` is what both the option and the hover -> bar mapping index by.
  const heatRows = useMemo(
    () =>
      matrix === null
        ? { visible: [] as number[], dormant: [] as number[] }
        : heatmapRows(matrix, heatmapOrder, showDormant),
    [matrix, heatmapOrder, showDormant],
  )

  // Heatmap cell -> the EXACT bar segment it corresponds to: the category's own series
  // when it made the top fold, the "Other" stack segment when folded. seriesIndex is
  // positional in barsOption.series — kept in lockstep by both deriving from topIds.
  const handleHeatmapHover = (params: EChartEventParams) => {
    if (!matrix || params.seriesType !== 'heatmap') return
    if (!Array.isArray(params.value)) return
    const [col, row] = params.value as [number, number, number]
    const categoryId = heatRows.visible[row]
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

  const heatmapOpt = useMemo(
    () =>
      matrix === null
        ? null
        : heatmapOption({
            matrix, order: heatRows.visible, nameById, monthLabels, mode: heatmapMode, todayIso: today, patterns, flowsDue,
          }),
    [matrix, heatRows, nameById, monthLabels, heatmapMode, today, patterns, flowsDue],
  )

  const savingsOption = useMemo(
    () => (matrix === null ? null : savingsRateOption({ matrix, monthLabels, range })),
    [matrix, monthLabels, range],
  )

  const trendOpt = useMemo(
    () =>
      matrix === null
        ? null
        : categoryTrendOption({ matrix, trend, fold, nameById, monthLabels, range, selected: legendSelected }),
    [matrix, trend, fold, nameById, monthLabels, range, legendSelected],
  )

  // Every category's shape at once — the same all-time order the heatmap rows use.
  const smallMultiples = useMemo(
    () =>
      matrix === null
        ? null
        : categorySmallMultiplesOption({ matrix, order: heatmapOrder, fold, nameById, monthLabels }),
    [matrix, heatmapOrder, fold, nameById, monthLabels],
  )

  const toggleTrend = (categoryId: number) => {
    setTrend((current) => {
      const existing = current.find((t) => t.categoryId === categoryId)
      if (existing) return current.filter((t) => t.categoryId !== categoryId)
      if (current.length >= MAX_TREND) return current
      return [...current, { categoryId }]
    })
  }
  // The picked lines' colours — the chips' borders read the SAME map the chart does.
  const trendColors = useMemo(() => pickColors(trend.map((t) => t.categoryId), fold), [trend, fold])

  // KPI row: the VIEWED month (the drilled one while the pie is open, the latest month
  // otherwise — focusIndex, the movers' and the flow card's own rule) + the trailing-12
  // average ending there. Drilling a month must move the whole page's answer together: a
  // header still reading the latest month beside cards reading June was the 2026-09-04
  // smoke's one lie.
  const kpis = useMemo(() => {
    if (!matrix || matrix.months.length === 0 || focusIndex < 0) return null
    // A6: a month no category reported (cashflow-only) is ABSENT, not a $0 month — it
    // must not dilute the average. totals[] itself carries "0.00" for such months (the
    // server sums over an empty set), so enteredness is judged on the SERIES — the same
    // rule filledMonths uses for the ribbon below.
    // The calendar month before, for the two tiles' second lines (spec §4.4) — absent from the matrix,
    // or unentered there, it has no figure to compare with. Its savings rate counts only where the
    // server calls it comparable (eligible_savings: a closed month with take-home — never a month still
    // in review, nor a pay-only month's 100%); an older payload without the list compares as before.
    const previousMonth = addMonths(matrix.months[focusIndex], -1)
    const previousIndex = matrix.months.indexOf(previousMonth)
    const previousComparable = previousIndex >= 0 && (matrix.eligible_savings?.[previousIndex] ?? true)
    return {
      month: matrix.months[focusIndex],
      total: matrix.living_total?.[focusIndex] ?? null,
      average: matrix.comparison_average?.[focusIndex] ?? null,
      savings: matrix.savings_rate[focusIndex],
      netPay: matrix.net_pay[focusIndex],
      previousMonth,
      previousSavings: previousComparable ? matrix.savings_rate[previousIndex] : null,
      previousNetPay: previousIndex < 0 ? null : matrix.net_pay[previousIndex],
    }
  }, [matrix, focusIndex])
  // The two tiles' second lines against the month before (spec §4.4): points for the rate, whole
  // dollars for the pay. The rate has no figure of its own on a month with no take-home — or on an
  // ENTERED $0, which is a figure, so it is not called missing.
  const savingsLine = kpis && versusMonthBefore(kpis.savings, kpis.previousSavings, kpis.previousMonth, (d) => `${(d * 100).toFixed(1)} pts`, 0.0005,
    kpis.netPay === null ? 'no take-home entered' : '$0 take-home')
  const netPayLine = kpis && versusMonthBefore(kpis.netPay, kpis.previousNetPay, kpis.previousMonth, formatCurrencyWhole, 0.005, 'no take-home entered')
  // The compared month's review state — the tile's badge when it is not closed (T3).
  const reviewState = matrix?.review_state?.[focusIndex]

  // What each ribbon chip PRINTS. Which months are entered is the ScopeBar's own business
  // (it reads /coverage for the two-tone chips); this page contributes only the figure —
  // that month's total spend — so the ribbon answers "how much" without a second fetch.
  const ribbonFigures = useMemo(
    () =>
      matrix === null
        ? undefined
        : Object.fromEntries(matrix.months.map((m, i) => [m, `${formatCurrency(matrix.living_total?.[i])} living`])),
    [matrix],
  )

  // The non-living categories, named once for the two full-history surfaces (spec §1): the
  // heatmap draws every row while the rollup's living total leaves these out, and a
  // difference like that has to be said out loud rather than discovered.
  const nonLiving = useMemo(
    () => (matrix?.categories ?? []).filter((category) => category.kind !== 'living'),
    [matrix],
  )

  return (
    <div className="page">
      <PageFrame
        title="Spending"
        sections={<LocalSectionNav state={views} label="Spending views" />}
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
            // The window applies to the time charts on Overview and Trends only (L5): Budgets
            // reads the ribbon's month and History declares "Full recorded history".
            range={views.section === 'overview' || views.section === 'trends'}
            onCoverage={onCoverage}
            month={{
              mode: 'view',
              figures: ribbonFigures,
              editHref: (month) => `/update?month=${month}&step=spending`,
              // The month on screen with nothing picked (2026-09-23 spec §T8): the last complete
              // month, or on Budgets the card's own month — what Edit opens and Back returns to.
              defaultMonth: views.section === 'budgets' ? budgetsMonth : matrix === null ? undefined : (matrix.default_month ?? null),
              // Named only when there is one: a book with no complete month yet goes "Back to
              // latest" — the page as it opens (code review minor 2).
              backLabel:
                views.section !== 'budgets' && matrix?.default_month != null ? 'Back to last complete month' : undefined,
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
          tiles: { count: 4, steady: true },
          cards: [
            { span: 12, height: 360 },
            { span: 6, height: 300 },
            { span: 6, height: 300 },
          ],
        }}
      >
        {/* The secondary feed's own alert (2026-09-09 audit item 10) — at the top of the
            page, where the card it speaks for is missing from the bottom of it. */}
        <FeedBanner error={yearlyError} retry={retryYearly} retryLabel="Retry the yearly rollup" />
        <LocalSectionPanel state={views} section="overview">
        <FeedBanner error={evidence.error} />
        {kpis && (
          // Steady (2026-09-25 polish spec §4.3): the badge line and one delta line are reserved, so the
          // row keeps one height across every month the ribbon offers (200 ↔ 217px before).
          <div className="kpi-row kpi-row-steady">
            <StatTile
              label={`Living spending — ${formatMonth(kpis.month)}`}
              value={formatCurrency(kpis.total)}
              // T3 (2026-09-13 audit): the month's other outflows are this tile's own second line — tax
              // and transfers, only the ones it had, whole dollars, one line at 1440 (2026-09-25 spec §4.3;
              // the cash total, = living + tax, ran it to two). The review state is its badge (closed =
              // nothing to flag). Neutral tone — a split, not a judgment.
              delta={otherOutflows(matrix?.tax_total?.[focusIndex], matrix?.transfer_total?.[focusIndex])}
              tone="neutral"
              badge={reviewState !== undefined && reviewState !== 'closed' ? REVIEW_LABELS[reviewState] : undefined}
              hint="Living categories only. Tax paid from take-home and transfers are shown separately."
              evidence={evidence.metric('living_spending')}
            />
            <StatTile
              label="Previous 12 months"
              value={formatCurrency(kpis.average)}
              hint="Mean living spending in eligible months within the previous 12 calendar months, excluding this month. Missing months do not pull older entries into the comparison."
              delta={eligibleMonths(matrix?.comparison_count?.[focusIndex] ?? evidence.data?.comparison.window?.included.length ?? 0)}
              evidence={evidence.data?.comparison}
            />
            <StatTile
              label="Savings rate — cash"
              value={kpis.savings === null ? '—' : formatPct(kpis.savings, { signed: false })}
              delta={savingsLine?.text}
              tone={savingsLine?.tone}
              hint="(net pay − living spend − tax paid) ÷ net pay for the viewed month. Payroll deductions are not in this one — the Savings rate chart on Trends draws both readings."
              evidence={evidence.metric('cash_savings_rate')}
            />
            <StatTile
              label="Net pay"
              value={formatCurrency(kpis.netPay)}
              delta={netPayLine?.text}
              tone={netPayLine?.tone}
              hint="Take-home pay entered for the viewed month."
              evidence={evidence.metric('net_pay')}
            />
          </div>
        )}

        <div className="card-grid">
          <ChartCard
            title={`Monthly entries vs take-home — top ${topIds.length} categories + other`}
            hint="All categories are stacked here, including living, tax and transfers. Select a month for its separate totals and source entries. Sustainable spend is based on your investable assets and withdrawal-rate setting."
            ariaLabel="Stacked bar chart of all monthly category entries under the net-pay line"
            option={barsOption}
            empty="No spending recorded yet — enter a month to begin."
            exportName="spending"
            csv={matrix === null ? undefined : () => spendingCsv(matrix, topIds, nameById, { todayIso: today, flowsDue })}
            height={340}
            zoomable
            group="spending"
            selectionAdapter={params => typeof params.dataIndex === 'number' ? periodSelection(params.dataIndex) : null}
            rowSelection={(_, index) => periodSelection(index)}
            selection={selectedPeriod}
            onSelectionChange={selected => { if (selected?.kind === 'period') setDetailMonth(selected.period); else if (selected === null) setDetailMonth(null) }}
            renderSelection={selected => {
              const index = selected.kind === 'period' && matrix ? matrix.months.indexOf(selected.period) : -1
              return <><SelectionDetail selection={selected} chartTitle="Monthly category entries" />{matrix && index >= 0 && <ChartCard
                title={`${selected.label} breakdown`} hint="Positive categories make up this donut. Refunds are included in the totals above."
                ariaLabel={`Donut chart of ${selected.label} categories`} option={monthPieOption(matrix, fold, index, { compact: true })}
                empty="No positive category amounts to draw." exportName={`spending-breakdown-${matrix.months[index]}`}
                csv={() => monthPieCsv(matrix, fold, index)} height={240}
                // W7: names beside the chart instead of leader labels that truncate in the dock.
                aside={<BreakdownLegend rows={monthPieLegend(matrix, fold, index)} label={`${selected.label} breakdown legend`} />} />}</>
            }}
            instanceRef={barsChartRef}
            onLegendChange={onLegendChange}
            onDataZoom={onZoomWindow}
            zoomWindow={zoomWindow}
            actions={
              /* The drill-in's way back. It stays here beside the pie it undoes, where the
                 eye already is — the scope row's "Back to latest" chip clears the same
                 selection from the other end. */
              activeDetail ? (
                <button className="button" onClick={() => setDetailMonth(null)}>
                  All months
                </button>
              ) : undefined
            }
            footer={
              <>
                {footnote !== null && <p className="drill-hint">{footnote}</p>}
                {activeDetail && matrix ? (
                  <p className="drill-hint">
                    Total {formatCurrency(matrix.totals[detailIndex])} · Net pay{' '}
                    {formatCurrency(matrix.net_pay[detailIndex])} · Cash savings{' '}
                    {matrix.savings_rate[detailIndex] === null
                      ? '—'
                      : formatPct(matrix.savings_rate[detailIndex], { signed: false })}{' '}
                    · Selected month. Choose another bar to compare.
                  </p>
                ) : (
                  <p className="drill-hint">Select a month to pin its totals and breakdown beside the chart.</p>
                )}
              </>
            }
          />

          {movers.length > 0 && (
            <div className="card span-12">
              <h2 className="eyebrow">
                What changed — {monthLabels[focusIndex]}
                <InfoHint text="The month's biggest category moves, versus the prior calendar month where both entries exist and each category's eligible average in the previous 12 calendar months." />
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
            <ChartCard
              title={`Where ${flowPeriod.label} went`}
              hint="Net pay fanned out across the period's categories, wearing the stacked chart's colors; green Saved is what was left. A deficit period adds a hatched red Drawdown source covering the overspend. Year covers only the months with both take-home and spending entered, so its Saved matches the Overview's cash saved: transfers stay out, and a category whose refunds outweighed its spending flows in as Refunds & credits."
              ariaLabel={`Sankey flow of where ${flowPeriod.label} went, from net pay into categories and savings`}
              // A year short of twelve matched months says which months it is (2026-09-23 spec
              // §C1): its Saved is the Overview's cash saved over those same months.
              lede={flowPeriod.window && !flowPeriod.window.fullYear ? 'Months with take-home and spending entered' : undefined}
              option={flowOption}
              empty={
                flowPeriod.empty ??
                (flowPeriod.netPay === null
                  ? `Enter net pay for ${flowPeriod.label} to see the flow.`
                  : `No flow to draw for ${flowPeriod.label}.`)
              }
              exportName={`spending-flow-${flowPeriod.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
              csv={() => spendingSankeyCsv(flowPeriod)}
              height={320}
              controls={
                <Segmented
                  variant="toggle"
                  size="sm"
                  ariaLabel="Flow window"
                  options={[
                    { value: 'month', label: 'Month' },
                    { value: 'year', label: 'Year' },
                  ]}
                  value={flowMode}
                  onChange={setFlowMode}
                />
              }
              footer={
                <>
                  {/* What the year's window leaves out, named like the Overview money flow's. */}
                  {flowPeriod.window?.spendingLeftOut && <p className="drill-hint">{flowPeriod.window.spendingLeftOut}</p>}
                  {flowPeriod.window?.takeHomeLeftOut && <p className="drill-hint">{flowPeriod.window.takeHomeLeftOut}</p>}
                  <p className="drill-hint">
                    Hover a node to trace its flows; drill a month on the top chart and this
                    card follows it.
                  </p>
                </>
              }
            />
          )}

        </div>
        </LocalSectionPanel>
        <LocalSectionPanel state={views} section="budgets" className="card-grid">
          {/* onBudgetsChanged = the page's refetch: a saved budget re-draws the meters, the
              chart reference lines and the movers column together, from one matrix. The card
              reads the URL's month when there is one and otherwise opens where the budgets are
              (2026-09-23 spec §B5); the page's focus month is only its last resort. */}
          {matrix && (
            <BudgetPanel
              matrix={matrix}
              monthIndex={activeDetail ? detailIndex : null}
              defaultIndex={restingIndex}
              onViewMonth={setDetailMonth}
              onBudgetsChanged={load}
              // A partly entered or missing month reads as such, never as a complete month under
              // budget (2026-09-23 spec §T12).
              flowsDue={flowsDue}
              onDefaultMonth={setBudgetsMonth}
            />
          )}
        </LocalSectionPanel>
        <LocalSectionPanel state={views} section="trends" className="card-grid">

          {/* Long-run half, summary before detail (2026-08-31 audit): the range-windowed
              pair reads right after the budgets that feed the trends chart's step lines;
              the never-windowed full-history pair (heatmap, yearly) closes the page. */}
          <ChartCard
            span={trendView === 'all' ? 12 : 6}
            title="Savings rate"
            hint="Two readings of the same month. Total counts the payroll deductions — 401(k), ESPP, HSA — that never reach your take-home; Cash is what was left of the paycheck: (net pay − living spend − tax paid) ÷ net pay. Above the zero line you saved, below it you overspent."
            ariaLabel="Line chart of the monthly total and cash savings rates around a zero baseline"
            option={savingsOption}
            empty="No months entered yet."
            exportName="savings-rate"
            csv={matrix === null ? undefined : () => savingsRateCsv(matrix)}
            height={TREND_HEIGHT}
            // Its partner's header carries the Compare / All categories toggle; the empty row keeps
            // the two plots starting on one line, and holding the height (above) ends them on one.
            reserveControls={trendView === 'compare'}
            fill={false}
            zoomable
            group="spending"
            onDataZoom={onZoomWindow}
            zoomWindow={zoomWindow}
            selectionAdapter={params => typeof params.dataIndex === 'number' ? periodSelection(params.dataIndex) : null}
            rowSelection={(_, index) => periodSelection(index)}
            footer={
              <p className="drill-hint">
                Transfers to your own accounts are not counted as money gone; tax payments
                are, on both lines. The old sheet's column tracked a planned rate, so values
                differ by design.
              </p>
            }
          />

          <ChartCard
            // All categories spans the row (NWSP-08/10): the small multiples need the width, and the
            // Savings rate card above takes the full row with it rather than sit beside a hole.
            span={trendView === 'all' ? 12 : 6}
            title="Category trends"
            hint="Single-category history — pick up to 3 to compare; a picked category's budget rides along as a dashed step. All categories draws every one as its own tiny line, each on its own scale: the reading is shape, not size."
            ariaLabel={
              trendView === 'all'
                ? 'Small multiples: every spending category’s monthly history as its own tiny line'
                : 'Line chart of the selected categories’ monthly spend with their budgets'
            }
            option={trendView === 'all' ? smallMultiples : trendOpt}
            empty={
              trendView === 'all' ? 'No months entered yet.' : `Pick up to ${MAX_TREND} categories.`
            }
            exportName="category-trends"
            csv={
              matrix === null
                ? undefined
                : trendView === 'all'
                  ? () =>
                      categoryTrendCsv(
                        matrix,
                        heatmapOrder.map((categoryId) => ({ categoryId })),
                        nameById,
                      )
                  : () => categoryTrendCsv(matrix, trend, nameById)
            }
            height={trendView === 'all' ? smallMultiplesHeight(heatmapOrder.length) : TREND_HEIGHT}
            // The pair's month axes share a line only while both plots hold their height (above).
            fill={false}
            // Small multiples carry no dataZoom and no shared axis: the window controls and
            // the sibling group belong to the single-axis reading only.
            zoomable={trendView === 'compare'}
            group={trendView === 'compare' ? 'spending' : undefined}
            onLegendChange={onLegendChange}
            onDataZoom={trendView === 'compare' ? onZoomWindow : undefined}
            zoomWindow={trendView === 'compare' ? zoomWindow : undefined}
            controls={
              <Segmented
                variant="toggle"
                size="sm"
                ariaLabel="Trend view"
                options={[
                  { value: 'compare', label: 'Compare' },
                  // "All categories", not "All": the scope row's range chips already own
                  // the word All on this page.
                  { value: 'all', label: 'All categories' },
                ]}
                value={trendView}
                onChange={setTrendView}
              />
            }
            footer={
              trendView === 'all' ? undefined : (
              <div className="chip-row">
                {matrix?.categories.map((category) => {
                  const color = trendColors.get(category.id)
                  const active = color !== undefined
                  // The line's hue goes on the BORDER, never the text (text stays --text via
                  // .chip.active) — series color marks identity beside text, not in it.
                  // The DOM swatch reads the CSS variable, not the hex: index.css repoints
                  // --chart-N per theme, so the chip border tracks a light/dark switch that a
                  // baked dark hex would ignore (charts/entities.ts entityCssVar).
                  return (
                    <button
                      key={category.id}
                      type="button"
                      className={active ? 'chip active' : 'chip'}
                      style={active ? { borderColor: entityCssVar(color) } : undefined}
                      aria-pressed={!!active}
                      onClick={() => toggleTrend(category.id)}
                    >
                      {category.name}
                    </button>
                  )
                })}
              </div>
              )
            }
          />

        </LocalSectionPanel>
        <LocalSectionPanel state={views} section="history" className="card-grid">
          <ChartCard
            title="Month × category heatmap"
            independentRangeLabel="Full recorded history"
            hint="Row: each category on its own 0 → max scale. vs average: orange = above its trailing 12-month average, blue = below (blank until six prior months exist). Absolute: one shared dollar scale. Rows are ordered by all-time total; categories that never spent are hidden until asked for."
            ariaLabel="Heatmap of spend per category per month"
            option={heatmapOpt}
            empty="No months entered yet."
            exportName="spending-heatmap"
            csv={matrix === null ? undefined : () => heatmapCsv(matrix, heatmapOrder, nameById, { todayIso: today, flowsDue })}
            height={Math.max(332, heatRows.visible.length * 24 + 142)}
            selectionAdapter={params => {
              if (!matrix || !Array.isArray(params.value)) return null
              const [column, row] = params.value as number[]
              const categoryId = heatRows.visible[row]
              if (categoryId === undefined || !matrix.months[column]) return null
              return { kind: 'heatmap', id: `spending-cell:${matrix.months[column]}:${categoryId}`, period: matrix.months[column], categoryId,
                label: `${nameById.get(categoryId)} · ${formatMonth(matrix.months[column])}`, scope: 'Household',
                values: [{ label: 'Entered amount', value: matrix.series.find(series => series.category_id === categoryId)?.values[column] ?? null, unit: 'USD' }],
                source: { href: `/update?month=${matrix.months[column]}&step=spending`, label: 'Open monthly entries' } }
            }}
            onHover={handleHeatmapHover}
            onHoverEnd={handleHeatmapHoverEnd}
            controls={
              <Segmented
                variant="toggle"
                size="sm"
                ariaLabel="Heatmap scale"
                options={HEATMAP_MODES}
                value={heatmapMode}
                onChange={setHeatmapMode}
              />
            }
            actions={
              heatRows.dormant.length > 0 ? (
                <button
                  type="button"
                  className="button"
                  aria-pressed={showDormant}
                  onClick={() => setShowDormant((open) => !open)}
                >
                  {showDormant ? 'Hide' : 'Show'} {heatRows.dormant.length} dormant
                </button>
              ) : undefined
            }
            footer={
              nonLiving.length === 0 && footnote === null ? undefined : (
                <>
                  {footnote !== null && <p className="drill-hint">{footnote}</p>}
                  {nonLiving.length > 0 && (
                    <p className="drill-hint">
                      Not living spend:{' '}
                      {nonLiving.map((category) => `${category.name} (${category.kind})`).join(' · ')} —
                      these rows are drawn here, but the savings figures and the year's living
                      total leave them out.
                    </p>
                  )}
                </>
              )
            }
          />

          {/* Absent, never empty-columned: with no rollup on hand the card would be a
              header over a table of dashes (2026-09-09 audit item 10). */}
          {yearly !== null && (
          <div className="card span-12">
            <h2 className="eyebrow">
              Yearly rollups
              <InfoHint text="Category totals per calendar year, with Total and Net pay, over every month that has anything entered. Living spend, Tax paid, Transfers and both savings rates cover only the months with BOTH spending and net pay — the Months matched row counts them, which is why those four need not add up to Total." />
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
                      <td>
                        {category.name}
                        {/* The kind is the REASON this row is missing from living spend, so
                            it belongs on the same line as the numbers (spec §1). */}
                        {category.kind !== 'living' && (
                          <>
                            {' '}
                            <span className="badge">{category.kind}</span>
                          </>
                        )}
                      </td>
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
                    <td>Living spend</td>
                    {yearly?.years.map((y) => (
                      <td key={y.year} className="num">
                        {formatCurrency(y.living_total)}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td>Tax paid</td>
                    {yearly?.years.map((y) => (
                      <td key={y.year} className="num">
                        {formatCurrency(y.tax_total)}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td>Transfers</td>
                    {yearly?.years.map((y) => (
                      <td key={y.year} className="num">
                        {formatCurrency(y.transfer_total)}
                      </td>
                    ))}
                  </tr>
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
                    <td>Savings rate — total</td>
                    {yearly?.years.map((y) => (
                      <td key={y.year} className="num">
                        {formatPct(y.total_savings_rate, { signed: false })}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td>Savings rate — cash</td>
                    {yearly?.years.map((y) => (
                      <td key={y.year} className="num">
                        {formatPct(y.savings_rate, { signed: false })}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td>Months matched</td>
                    {yearly?.years.map((y) => (
                      <td key={y.year} className="num">
                        {y.months_matched ?? '—'}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
          )}
        </LocalSectionPanel>
      </PageFrame>
    </div>
  )
}
