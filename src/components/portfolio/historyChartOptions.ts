// Pure option builder for the portfolio performance chart, shared by PortfolioPage and
// OverviewPage (overviewChartOptions.ts posture: no React, no fetching, no theme
// decisions of its own). Its events live in performanceEvents.ts and its one-line answer in
// benchmarkLede.ts (code review 10). Number() here is display-only — the server's Decimal strings
// are parsed once and never handed back to the API (format.ts's rule).
import type { EChartsOption } from '../../charts/echarts'
import { LINE, WASH, dateAxis, grid, moneyAxis } from '../../charts/grammar'
import { legendFor } from '../../charts/legend'
import { OTHER_SERIES_COLOR, PALETTE } from '../../charts/theme'
import { resolvedWindow } from '../../charts/timeZoom'
import type { RangeState, ZoomWindow } from '../../charts/timeZoom'
import { axisTooltip } from '../../charts/tooltip'
import type { HoldingsTotals, PortfolioHistory } from '../../types/api'
import type { ExportTable } from '../../utils/download'
import { formatDate, formatMonth } from '../../utils/format'
import {
  BUYS_SERIES,
  DIVIDENDS_SERIES,
  EXDIV_SERIES,
  RUG_MARKS,
  SELLS_SERIES,
  eventLines,
  eventSeries,
} from './performanceEvents'
import type { PerformanceEvents } from './performanceEvents'

export interface LivePoint {
  date: string // quote bar date, ISO YYYY-MM-DD
  value: number // Number(totals.market_value) — display-only
}

// Both pages derive the live point from the SAME holdings payload they already fetch —
// one definition so the two charts can never disagree about what "live" means. Dated by
// the NEWEST quote (latest_quote_at), never by as_of: as_of is the OLDEST (the staleness
// clock), and once weekly Monday rows keep the series fresh, a single stale manual-priced
// quote in it dragged the live date behind the series' end and silently retired the ping.
export function liveFromHoldings(holdings: {
  latest_quote_at: string | null
  totals: Pick<HoldingsTotals, 'market_value'>
}): LivePoint | null {
  return holdings.latest_quote_at
    ? { date: holdings.latest_quote_at.slice(0, 10), value: Number(holdings.totals.market_value) }
    : null
}

export const VALUE_SERIES = 'Portfolio value'
export const COST_SERIES = 'Cost basis'
/** Every inferred contribution, bought into VOO as it lands — the fair comparison, named for
 *  what it is (2026-09-23 spec §C8, wealth PF-1; it was "VOO (your contributions)"). */
export const VOO_LEG_SERIES = 'Same deposits in VOO'
/** The first week's balance alone, compounded — named for what it leaves out. Never the fair
 *  comparison (a flat line under a $1M axis read as "we beat the S&P nine-fold"), so legend-off
 *  by default on Portfolio and not drawn at all on the Overview card (2026-09-23 spec §C8,
 *  shell F5; it was "S&P 500 baseline"). */
export const STARTING_BALANCE_SERIES = 'S&P 500 — starting balance only'

export interface HistoryOptionSettings {
  /** The page's mirrored legend picks (F9); they win over the defaults below. */
  selected?: Record<string, boolean>
  /** 'legend-off' — Portfolio: the starting-balance line is listed but hidden until picked.
   *  'omit' — the Overview card: not drawn, not listed, not in the table. */
  startingBalance?: 'legend-off' | 'omit'
  /** The window the chart shows — Portfolio's range chip, or one dragged out with ctrl+wheel —
   *  which the weekly axis picks its label stride from (review round 1). The page still spreads
   *  the matching dataZoom on itself. Absent (the Overview card): the whole series. */
  range?: RangeState
}

/** Month strides the weekly axis steps through, finest first — each lands on Januaries. */
const MONTH_STRIDES = [1, 3, 6, 12, 24, 60, 120] as const
/** The most month labels a stride may put in the window; hideOverlap still guards a narrow card. */
const MOST_LABELS = 12
/** Under this many month starts in the window, its weekly checkpoints carry the axis instead. */
const FEWEST_LABELS = 3

/**
 * The weekly axis (2026-09-23 spec §C4, §C8; charts F6, shell F5; review round 1): labels where a
 * month begins — "Oct 2023", never an arbitrary Monday like "Oct 23, 2023 · Jan 22, 2024" — while
 * the category itself stays the exact date, so the tooltip header keeps the checkpoint's day. The
 * stride is chosen from the WINDOW the chart shows (the range chip's, or one dragged out with
 * ctrl+wheel; the whole series on the Overview): every month, else quarter starts, half-years,
 * Januaries… — the finest that puts at most twelve in the window. A whole-series stride left 1Y
 * with four labels on this book, a single "Jan" on a longer one, and a zoom between two quarter
 * starts with none. A window holding fewer than three month starts (year to date in February)
 * labels its weekly checkpoints instead ("Jan 12"; a month start keeps "Jan 2026"). The set rides
 * in `customValues` (category indices; echarts draws the ones inside the window) — data, so a chip
 * that changes it reaches the chart: EChart's zoom fast path merges a changed set after its zoom
 * action. The formatter depends on nothing but the category. hideOverlap is the last guard on a
 * narrow card: a label that would still touch its neighbour is dropped, never smeared.
 */
function weeklyAxis(categories: string[], isoDates: string[], window: ZoomWindow) {
  // The first checkpoint of each calendar month: where a month label may stand.
  const monthStarts = isoDates.flatMap((iso, i) =>
    i === 0 || iso.slice(0, 7) !== isoDates[i - 1].slice(0, 7) ? [i] : [],
  )
  const inWindow = (i: number) => i >= window.startValue && i <= window.endValue
  // Months since year 0, so a 24- or 60-month stride lands on the same Januaries every time.
  const monthNumber = (i: number) => Number(isoDates[i].slice(0, 4)) * 12 + Number(isoDates[i].slice(5, 7)) - 1
  const onStride = (stride: number) => monthStarts.filter((i) => monthNumber(i) % stride === 0)
  const labelled =
    monthStarts.filter(inWindow).length < FEWEST_LABELS
      ? isoDates.flatMap((_, i) => (inWindow(i) ? [i] : []))
      : onStride(
          MONTH_STRIDES.find((stride) => onStride(stride).filter(inWindow).length <= MOST_LABELS) ??
            MONTH_STRIDES[MONTH_STRIDES.length - 1],
        )
  const starts = new Set(monthStarts)
  const text = new Map(
    categories.map((category, i) => [
      category,
      starts.has(i) ? formatMonth(`${isoDates[i].slice(0, 7)}-01`) : formatDate(isoDates[i]).replace(/, \d{4}$/, ''),
    ]),
  )
  return {
    ...dateAxis(categories),
    axisLabel: {
      customValues: labelled,
      formatter: (value: string) => text.get(value) ?? value,
      hideOverlap: true,
    },
  }
}

export function portfolioHistoryOption(
  history: PortfolioHistory,
  live: LivePoint | null,
  events: PerformanceEvents | null = null,
  { selected, startingBalance = 'legend-off', range }: HistoryOptionSettings = {},
): EChartsOption | null {
  if (history.dates.length < 2) return null
  const lastDate = history.dates[history.dates.length - 1]
  const lastValue = Number(history.market_value[history.market_value.length - 1])
  // The ping renders only when there IS a usable quote no older than the imported
  // series — a live marker BEHIND the line's end would read as a glitch, not as "now".
  const livePt = live !== null && Number.isFinite(live.value) && live.date >= lastDate ? live : null
  // Same-day quote: the ping sits ON the last imported category — no new category and
  // no connector, because there is nothing to bridge.
  const extendAxis = livePt !== null && livePt.date > lastDate

  const categories = history.dates.map(formatDate)
  const lastLabel = categories[categories.length - 1]
  const liveLabel = livePt ? formatDate(livePt.date) : ''
  if (extendAxis) categories.push(liveLabel)

  // Lines end at the last IMPORTED point: the live category (when present) gets null,
  // never an extrapolated value. Null entries pass through untouched — the benchmark's
  // degraded rows must become chart nulls, not NaN.
  const lineData = (values: (string | null)[]): (number | null)[] => {
    const parsed = values.map((v) => (v === null ? null : Number(v)))
    return extendAxis ? [...parsed, null] : parsed
  }

  // Fixed validated palette slots (charts/theme.ts law), by ENTITY not position: value=slot 1
  // blue, cost basis=slot 2 orange, the VOO leg=slot 4 yellow, the starting balance=slot 3
  // aqua. The wash rides the value line ONLY — the Excel original's three overlapping opaque
  // areas occlude each other (spec: rejected).
  // LINE carries the 2px/no-symbol/focus posture (§9); WASH is the house visible-axis fill.
  const lineSeries = (name: string, values: (string | null)[], color: string, wash: boolean) => ({
    ...LINE,
    name,
    color,
    ...(wash ? WASH : {}),
    data: lineData(values),
  })

  // Stale-tab armor: a payload cached from the pre-benchmark API omits the field.
  // Treat omitted like the server's all-null degradation — no fourth series at all,
  // because an all-null line draws nothing yet still ghost-occupies the legend.
  const benchmark = history.benchmark ?? []
  const showBenchmark = benchmark.some((v) => v !== null)

  const series = [
    lineSeries(VALUE_SERIES, history.market_value, PALETTE[0], true),
    lineSeries(COST_SERIES, history.cost_basis, PALETTE[1], false),
    // The fair comparison straight after value and cost; the two names explain themselves
    // side by side — every deposit here, the starting balance alone below (§C8).
    ...(showBenchmark ? [lineSeries(VOO_LEG_SERIES, benchmark, PALETTE[3], false)] : []),
    ...(startingBalance === 'omit'
      ? []
      : [lineSeries(STARTING_BALANCE_SERIES, history.sp500, PALETTE[2], false)]),
    // One series per kind of event (2026-09-23 spec §C8): each has its own legend entry and
    // toggles on its own; all are ON by default — no legend.selected entry ships for them.
    ...(events === null ? [] : eventSeries(events)),
    ...(livePt
      ? [
          {
            // The live point wears the SAME blue — same entity, fresher reading; a new
            // hue would read as a fourth data series. The ripple is what says "live".
            type: 'effectScatter' as const,
            name: 'Live',
            color: PALETTE[0],
            symbolSize: 9,
            rippleEffect: { brushType: 'stroke' as const, scale: 3 },
            data: [[extendAxis ? liveLabel : lastLabel, livePt.value]] as [string, number][],
            ...(extendAxis
              ? {
                  // Dashed connector from the line's end to the ping (dashed =
                  // provisional). A markLine, not a fifth series: it toggles with
                  // 'Live' in the legend and stays out of the axis tooltip.
                  markLine: {
                    silent: true,
                    symbol: 'none' as const,
                    lineStyle: { type: 'dashed' as const, width: 2, color: PALETTE[0] },
                    label: { show: false },
                    // A 2D markLine datum is a 2-TUPLE (from, to), not an array —
                    // without the assertion the literal widens and tsc rejects it.
                    data: [
                      [
                        { coord: [lastLabel, lastValue] },
                        { coord: [liveLabel, livePt.value] },
                      ] as [{ coord: [string, number] }, { coord: [string, number] }],
                    ],
                  },
                }
              : {}),
          },
        ]
      : []),
  ]

  return {
    grid: grid(),
    // Listed but hidden until picked; the page's own picks (F9) ride on top, so a reader who
    // switched it on keeps it on across refetches and theme swaps. An entry that is off must
    // LOOK off: echarts' default inactive #ccc is brighter than an active label on the dark
    // card, and this line now starts hidden on every visit — the fold grey reads as "off" in
    // both themes (a token, so the light recolor carries it).
    legend: {
      ...legendFor(
        series.length,
        startingBalance === 'omit' ? selected : { [STARTING_BALANCE_SERIES]: false, ...selected },
      ),
      inactiveColor: OTHER_SERIES_COLOR,
      // Listed explicitly (legendFor's rule for builders that do) so each rug entry wears its
      // own mark — the tick, the dot — where the house icon would make them twins (code review 6).
      data: series.map(({ name }) =>
        name === DIVIDENDS_SERIES || name === EXDIV_SERIES ? { name, icon: RUG_MARKS[name].icon } : name,
      ),
    },
    xAxis: weeklyAxis(
      categories,
      extendAxis && livePt ? [...history.dates, livePt.date] : history.dates,
      // Resolved exactly as the page's zoom is — out to the live category when one is appended.
      range === undefined
        ? { startValue: 0, endValue: categories.length - 1 }
        : resolvedWindow(history.dates, range, categories.length),
    ),
    // No scale:true — a washed area over a visible axis needs the honest zero baseline.
    yAxis: moneyAxis(),
    // F7: every event kind expands into its clustered lines instead of printing a y that is
    // chart geometry, not a figure — axisTooltip does it through the annotations hook.
    tooltip: axisTooltip({
      unit: 'money',
      annotationSeries: [BUYS_SERIES, SELLS_SERIES, DIVIDENDS_SERIES, EXDIV_SERIES],
      annotations: eventLines,
    }),
    series,
  }
}

/** The performance chart as a table (2026-08-25 spec §2a): date rows × the series, verbatim
 * server strings; degraded/stale benchmark cells go empty. The live ping stays out — it is a
 * quote, not a history row. Each series keeps the column it has always had — a reader's
 * spreadsheet reads them by position — under its honest name (2026-09-23 spec §C8 renamed them,
 * review round 1 kept them in place). Where the chart omits the starting balance (the Overview
 * card), so does its table. */
export function portfolioHistoryCsv(
  history: PortfolioHistory,
  { startingBalance = 'legend-off' }: Pick<HistoryOptionSettings, 'startingBalance'> = {},
): ExportTable {
  const benchmark = history.benchmark ?? []
  const withStart = startingBalance !== 'omit'
  return {
    headers: [
      'Date',
      VALUE_SERIES,
      COST_SERIES,
      ...(withStart ? [STARTING_BALANCE_SERIES] : []),
      VOO_LEG_SERIES,
    ],
    rows: history.dates.map((date, i) => [
      date,
      history.market_value[i],
      history.cost_basis[i],
      ...(withStart ? [history.sp500[i]] : []),
      benchmark[i] ?? '',
    ]),
  }
}
