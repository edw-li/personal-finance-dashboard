// Pure option builder for the portfolio performance chart, shared by PortfolioPage and
// OverviewPage (overviewChartOptions.ts posture: no React, no fetching, no theme
// decisions of its own). Number() here is display-only — the server's Decimal strings
// are parsed once and never handed back to the API (format.ts's rule).
import type { EChartsOption } from '../../charts/echarts'
import { LINE, WASH, dateAxis, grid, moneyAxis } from '../../charts/grammar'
import { legendFor } from '../../charts/legend'
import { INK, MUTED, OTHER_SERIES_COLOR, PALETTE } from '../../charts/theme'
import { rangeStartIndex, resolvedWindow } from '../../charts/timeZoom'
import type { RangeState } from '../../charts/timeZoom'
import { axisTooltip } from '../../charts/tooltip'
import type { AxisTooltipParam } from '../../charts/tooltip'
import type {
  DividendEventOut,
  DividendOut,
  HoldingsTotals,
  PortfolioHistory,
  TransactionOut,
} from '../../types/api'
import type { ExportTable } from '../../utils/download'
import {
  escapeHtml,
  formatCurrency,
  formatCurrencyCompact,
  formatDate,
  formatMonth,
  formatShares,
} from '../../utils/format'

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

// One name so the legend, the tooltip branch and the series stay in lockstep
// (NetWorthPage's NOTES_SERIES idiom).
export const EVENTS_SERIES = 'Events'

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
}

export interface ChartEventPoint {
  /** [category label, y] — the marker rides the portfolio-value line at its bar. */
  value: [string, number]
  symbol: 'triangle' | 'circle' | 'diamond'
  symbolRotate: number
  /** Display-ready lines, one per underlying event, TRUE dates included. Escaped at
   * HTML time by the tooltip branch — tickers are server text. */
  events: { text: string }[]
}

// Day-serial for snap distances. Date.UTC over split components — never `new Date(iso)`
// (format.ts's UTC-shift rule); components are exact, no timezone in play.
function dayNumber(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return Date.UTC(y, m - 1, d) / 86_400_000
}

// Display trim for a Numeric(10,6) per-share string: "1.710000" → "1.71". Display-only
// (this file's Number() rule) — the wire string itself is never re-scaled or re-parsed
// into money math.
function trimPerShare(raw: string): string {
  if (!raw.includes('.')) return raw
  const trimmed = raw.replace(/0+$/, '').replace(/\.$/, '')
  return trimmed === '' ? '0' : trimmed
}

/**
 * The /portfolio ledgers as chart annotations (2026-08-25 spec §2c): every DATED buy,
 * sell and dividend snapped to the NEAREST weekly bar (the axis is categorical — a
 * true-date x would lie between bars), one marker per bar. Same-bar events cluster into
 * one marker whose tooltip lists each with its true date; a single-kind cluster wears
 * its kind's glyph (▲ buy, the same triangle rotated for sell, ● dividend/ex-dividend)
 * and a mixed one wears the diamond so no kind over-claims it. Provider ex-dividend
 * events (2026-08-28) carry a per-share figure only — shares held on an old ex-date are
 * unknowable from the dateless imported book, so no dollar total is ever shown — and the
 * ledger wins a collision: an event matching a dividend row's (security, ex_date), or
 * landing within 14 days of a MANUAL row for that security (manual rows carry no
 * ex_date), is dropped. Skipped honestly: dateless imported transactions (nothing to snap to), splits
 * (not one of the glyphs — spec), and events off either axis end (no bar to stand on).
 * /portfolio only by construction — OverviewPage never calls this (Decision log: it must
 * not start fetching ledgers).
 */
export function buildEventMarkers(
  history: Pick<PortfolioHistory, 'dates' | 'market_value'>,
  transactions: TransactionOut[],
  dividends: DividendOut[],
  tickers: Map<number, string>,
  dividendEvents: DividendEventOut[] = [],
): ChartEventPoint[] {
  if (history.dates.length === 0) return []
  const byIndex = snapToBars(
    history.dates,
    collectEvents(transactions, dividends, tickers, dividendEvents),
  )
  const SYMBOLS = { buy: 'triangle', sell: 'triangle', dividend: 'circle', exdiv: 'circle' } as const
  return [...byIndex.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, events]) => {
      events.sort(byDate)
      const kinds = new Set(events.map((e) => e.kind))
      const kind = kinds.size === 1 ? events[0].kind : null
      return {
        value: [formatDate(history.dates[index]), Number(history.market_value[index])],
        symbol: kind === null ? 'diamond' : SYMBOLS[kind],
        symbolRotate: kind === 'sell' ? 180 : 0,
        events: events.map(({ text }) => ({ text })),
      }
    })
}

type EventKind = 'buy' | 'sell' | 'dividend' | 'exdiv'
interface RawEvent {
  kind: EventKind
  date: string
  text: string
  securityId: number
}
const byDate = (a: RawEvent, b: RawEvent) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)

/** Every dated buy and sell, every ledger dividend and every provider ex-dividend notice the
 *  ledger does not already carry, as display lines — buildEventMarkers' rules, shared with the
 *  performance chart's events below. */
function collectEvents(
  transactions: TransactionOut[],
  dividends: DividendOut[],
  tickers: Map<number, string>,
  dividendEvents: DividendEventOut[],
): RawEvent[] {
  const ticker = (id: number) => tickers.get(id) ?? `#${id}`
  const raw: RawEvent[] = []
  for (const t of transactions) {
    if (t.txn_date === null || (t.type !== 'buy' && t.type !== 'sell')) continue
    raw.push({
      kind: t.type,
      date: t.txn_date,
      securityId: t.security_id,
      text: `${t.type === 'buy' ? 'Buy' : 'Sell'} ${ticker(t.security_id)} — ${formatShares(
        t.shares,
      )} sh · ${formatDate(t.txn_date)}`,
    })
  }
  // NUL-joined keys, the sankey link-key precedent: neither half can contain a NUL.
  const ledgered = new Set<string>()
  // Manual rows never carry an ex_date (their create/update schemas have no such field),
  // so the exact-key dedupe cannot see them; they suppress annotations by PROXIMITY
  // instead, mirroring the ingest's own +/-14-day manual-overlap rule.
  const MANUAL_OVERLAP_DAYS = 14
  const manualPayDays = new Map<number, number[]>()
  for (const d of dividends) {
    if (d.source === 'manual') {
      const bucket = manualPayDays.get(d.security_id)
      const day = dayNumber(d.pay_date)
      if (bucket) bucket.push(day)
      else manualPayDays.set(d.security_id, [day])
    }
    if (d.ex_date !== null) ledgered.add(`${d.security_id}\u0000${d.ex_date}`)
    raw.push({
      kind: 'dividend',
      date: d.pay_date,
      securityId: d.security_id,
      text: `Dividend ${ticker(d.security_id)} — ${formatCurrency(d.amount)} · ${formatDate(
        d.pay_date,
      )}`,
    })
  }
  for (const e of dividendEvents) {
    if (ledgered.has(`${e.security_id}\u0000${e.ex_date}`)) continue
    const exDay = dayNumber(e.ex_date)
    const nearManual = (manualPayDays.get(e.security_id) ?? []).some(
      (payDay) => Math.abs(payDay - exDay) <= MANUAL_OVERLAP_DAYS,
    )
    if (nearManual) continue
    raw.push({
      kind: 'exdiv',
      date: e.ex_date,
      securityId: e.security_id,
      text: `Ex-dividend ${ticker(e.security_id)} — $${trimPerShare(e.per_share)}/sh · ${formatDate(
        e.ex_date,
      )}`,
    })
  }
  return raw
}

/** Each event snapped to the NEAREST bar (the axis is categorical — a true-date x would lie
 *  between bars); an event off either end of the axis has no bar to stand on and is dropped. */
function snapToBars(dates: string[], events: RawEvent[]): Map<number, RawEvent[]> {
  const byIndex = new Map<number, RawEvent[]>()
  if (dates.length === 0) return byIndex
  const days = dates.map(dayNumber)
  for (const event of events) {
    const day = dayNumber(event.date)
    if (day < days[0] || day > days[days.length - 1]) continue
    let index = 0
    for (let i = 1; i < days.length; i += 1) {
      // Strict <: an (unreachable-with-weekly-bars) tie keeps the earlier bar.
      if (Math.abs(days[i] - day) < Math.abs(days[index] - day)) index = i
    }
    const bucket = byIndex.get(index)
    if (bucket) bucket.push(event)
    else byIndex.set(index, [event])
  }
  return byIndex
}

// One series per KIND of event on the performance chart (2026-09-23 spec §C8): the legend
// names each, and each toggles on its own.
export const BUYS_SERIES = 'Buys'
export const SELLS_SERIES = 'Sells'
export const DIVIDENDS_SERIES = 'Dividends'
export const EXDIV_SERIES = 'Ex-dividend dates'

/** One rug tick: a weekly bar with events of its kind, at y 0 — the plot's floor. */
export interface RugPoint {
  value: [string, number]
  /** Display-ready lines, TRUE dates included; escaped at HTML time (eventLines). */
  events: { text: string }[]
}

export interface PerformanceEvents {
  buys: ChartEventPoint[]
  sells: ChartEventPoint[]
  dividends: RugPoint[]
  exDividends: RugPoint[]
}

/** Whether a security was held on a date, from the ledger alone: undated (imported) rows are
 *  the opening book, held before any dated row; dated buys, sells and splits apply on their own
 *  dates. Display-only share arithmetic — nothing here reaches a money figure. */
function heldOn(transactions: TransactionOut[]): (securityId: number, iso: string) => boolean {
  const bySecurity = new Map<number, TransactionOut[]>()
  for (const t of transactions) {
    const rows = bySecurity.get(t.security_id)
    if (rows) rows.push(t)
    else bySecurity.set(t.security_id, [t])
  }
  // The opening book first (undated imports, in their sort order), then dated rows by date.
  for (const rows of bySecurity.values()) {
    rows.sort(
      (a, b) => (a.txn_date ?? '').localeCompare(b.txn_date ?? '') || a.sort_index - b.sort_index,
    )
  }
  return (securityId, iso) => {
    let shares = 0
    for (const t of bySecurity.get(securityId) ?? []) {
      if (t.txn_date !== null && t.txn_date > iso) break
      if (t.type === 'buy') shares += Number(t.shares)
      else if (t.type === 'sell') shares -= Number(t.shares)
      else if (t.split_factor !== null) shares *= Number(t.split_factor)
    }
    return shares > 1e-9
  }
}

/**
 * The performance chart's annotations (2026-09-23 spec §C8; wealth PF-5, charts F11). Dated buys
 * and sells ride the value line as before; ledger dividends and provider ex-dividend notices move
 * OFF it, to a rug on the plot's floor — one tick per weekly bar per kind, listing its events in
 * the tooltip. They used to sit on ≈132 of 155 weekly points and turn the value line into a bead
 * chain. The provider lists every security the book has ever named — targets and watch-list
 * tickers included (IVV, IJH… never owned) — so a notice survives only for a security held on its
 * ex-date (heldOn) or held today (`heldNow`, the page's holdings). Ledger rows are the household's
 * own dividends and always stay; the ledger still wins a collision (collectEvents).
 */
export function buildPerformanceEvents(
  history: Pick<PortfolioHistory, 'dates' | 'market_value'>,
  transactions: TransactionOut[],
  dividends: DividendOut[],
  tickers: Map<number, string>,
  dividendEvents: DividendEventOut[],
  heldNow: ReadonlySet<number>,
): PerformanceEvents {
  const held = heldOn(transactions)
  const raw = collectEvents(transactions, dividends, tickers, dividendEvents).filter(
    (e) => e.kind !== 'exdiv' || heldNow.has(e.securityId) || held(e.securityId, e.date),
  )
  const bars = (kind: EventKind) =>
    [...snapToBars(history.dates, raw.filter((e) => e.kind === kind)).entries()].sort(
      ([a], [b]) => a - b,
    )
  const lines = (events: RawEvent[]) => [...events].sort(byDate).map(({ text }) => ({ text }))
  const onLine = (kind: 'buy' | 'sell'): ChartEventPoint[] =>
    bars(kind).map(([index, events]) => ({
      value: [formatDate(history.dates[index]), Number(history.market_value[index])],
      symbol: 'triangle',
      symbolRotate: kind === 'sell' ? 180 : 0,
      events: lines(events),
    }))
  const rug = (kind: 'dividend' | 'exdiv'): RugPoint[] =>
    bars(kind).map(([index, events]) => ({
      value: [formatDate(history.dates[index]), 0],
      events: lines(events),
    }))
  return {
    buys: onLine('buy'),
    sells: onLine('sell'),
    dividends: rug('dividend'),
    exDividends: rug('exdiv'),
  }
}

// The axis-tooltip param subset eventLines reads is the grammar's own
// (charts/tooltip.ts AxisTooltipParam, imported above) — one shape, one definition.

/** The Events row's tooltip lines: a count first when clustered, then each event's text —
 *  tickers are server text, so escaped (the annotation callback escapes its own output). */
export function eventLines(param: AxisTooltipParam): string[] {
  const events = (param.data as { events?: { text: string }[] } | undefined)?.events ?? []
  return [
    ...(events.length > 1 ? [`<strong>${events.length} events</strong>`] : []),
    ...events.map((event) => escapeHtml(event.text)),
  ]
}

/**
 * The weekly axis (2026-09-23 spec §C4, §C8; charts F6, shell F5): a label only where a month
 * begins — "Oct 2023", never an arbitrary Monday like "Oct 23, 2023 · Jan 22, 2024" — while the
 * category itself stays the exact date, so the tooltip header keeps the checkpoint's day. Every
 * month for a year of history or less, every quarter start (Jan/Apr/Jul/Oct) up to five years,
 * Januaries beyond. The stride rides the WHOLE series, never the zoom window: a range chip takes
 * EChart's animated zoom path, which keeps the last option's functions, so a window-sized rule
 * would go stale on it. hideOverlap is the last guard on a narrow card (the Overview's half
 * width): a label that would still touch its neighbour is dropped, never smeared.
 */
function weeklyAxis(categories: string[], isoDates: string[]) {
  const months = new Set(isoDates.map((iso) => iso.slice(0, 7))).size
  const stride = months <= 12 ? 1 : months <= 60 ? 3 : 12
  const labels = new Map<string, string>()
  let previous = ''
  isoDates.forEach((iso, i) => {
    const month = iso.slice(0, 7)
    if (month === previous) return
    previous = month
    if ((Number(iso.slice(5, 7)) - 1) % stride === 0) {
      labels.set(categories[i], formatMonth(`${month}-01`))
    }
  })
  return {
    ...dateAxis(categories),
    axisLabel: {
      interval: (_index: number, value: string) => labels.has(value),
      formatter: (value: string) => labels.get(value) ?? '',
      hideOverlap: true,
    },
  }
}

/** The performance chart's event layers (2026-09-23 spec §C8). Buys and sells: plain scatter in
 *  MUTED riding the value line — an annotation layer, not a data hue, and the ripple stays the
 *  live ping's (the net-worth notes-diamond rule). The rug: 2px × 10px ticks at y 0 that straddle
 *  the x-axis line, so they cross the plot only where the lines themselves are lowest; neutral
 *  tones by kind (INK for the household's own ledger, MUTED for provider notices), because no
 *  money-entity colour can then collide with them inside this chart, and the ledger draws on
 *  top where a week has both. An empty kind draws no series and lists no legend entry. */
function eventSeries(events: PerformanceEvents) {
  const marker = (name: string, data: ChartEventPoint[]) => ({
    type: 'scatter' as const,
    name,
    color: MUTED,
    symbolSize: 9,
    itemStyle: { borderColor: INK, borderWidth: 1 },
    z: 11,
    data,
  })
  const rug = (name: string, data: RugPoint[], color: string, z: number) => ({
    type: 'scatter' as const,
    name,
    color,
    symbol: 'rect' as const,
    symbolSize: [2, 10] as [number, number],
    z,
    data,
  })
  return [
    ...(events.buys.length > 0 ? [marker(BUYS_SERIES, events.buys)] : []),
    ...(events.sells.length > 0 ? [marker(SELLS_SERIES, events.sells)] : []),
    ...(events.dividends.length > 0 ? [rug(DIVIDENDS_SERIES, events.dividends, INK, 13)] : []),
    ...(events.exDividends.length > 0 ? [rug(EXDIV_SERIES, events.exDividends, MUTED, 12)] : []),
  ]
}

export function portfolioHistoryOption(
  history: PortfolioHistory,
  live: LivePoint | null,
  events: PerformanceEvents | null = null,
  { selected, startingBalance = 'legend-off' }: HistoryOptionSettings = {},
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
    },
    xAxis: weeklyAxis(categories, extendAxis && livePt ? [...history.dates, livePt.date] : history.dates),
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

export interface BenchmarkLede {
  direction: 'ahead' | 'behind' | 'level'
  /** Dollars, ≥ 0 — the size of the gap; `direction` carries its sign. */
  amount: number
}

const toCents = (raw: string): number => Math.round(Number(raw) * 100)

/**
 * "Ahead of the same deposits in VOO by $263.7K" (2026-09-23 spec §C8; wealth PF-1): over a
 * window of the weekly checkpoints, the portfolio's change minus the VOO leg's change. Both legs
 * received the same inferred deposits, so what is left is the market's work alone — no XIRR, no
 * realized figures, only the history points already in the payload. Integer cents: each string
 * is parsed once and never floated through a subtraction chain. Null — no sentence at all — when
 * either end of the VOO leg is absent (a degraded or pre-benchmark payload: absent is not zero)
 * or the window has no length.
 */
export function benchmarkLede(
  history: PortfolioHistory,
  start = 0,
  end = history.dates.length - 1,
): BenchmarkLede | null {
  const s = Math.max(0, start)
  const e = Math.min(end, history.dates.length - 1)
  if (e <= s) return null
  const leg = history.benchmark ?? []
  const from = leg[s]
  const to = leg[e]
  if (from === null || from === undefined || to === null || to === undefined) return null
  const gap =
    toCents(history.market_value[e]) - toCents(history.market_value[s]) - (toCents(to) - toCents(from))
  return {
    direction: gap > 0 ? 'ahead' : gap < 0 ? 'behind' : 'level',
    amount: Math.abs(gap) / 100,
  }
}

/** The lede as words and a figure — "Over 1Y: ahead of the same deposits in VOO by" · "$67.6K" —
 *  so a page can set the figure in the strip's bold ink. */
export function benchmarkLedeText(
  lede: BenchmarkLede,
  prefix: string | null = null,
): { text: string; amount: string | null } {
  const phrase =
    lede.direction === 'ahead'
      ? 'ahead of the same deposits in VOO by'
      : lede.direction === 'behind'
        ? 'behind the same deposits in VOO by'
        : 'level with the same deposits in VOO'
  return {
    text: prefix === null ? phrase[0].toUpperCase() + phrase.slice(1) : `${prefix}: ${phrase}`,
    amount: lede.direction === 'level' ? null : formatCurrencyCompact(lede.amount),
  }
}

/**
 * The Portfolio card's lede, following the chart's own window (2026-09-23 spec §C8): the range
 * chip's words ("Over 1Y", "Year to date"; nothing on All), or the dates of a window the reader
 * dragged out with ctrl+wheel. The chart echoes every window back through datazoom — a chip's
 * own included, one category past the dates when the live ping is appended — so "dragged" means
 * a window that differs from the chip's, not merely one that exists.
 */
export function performanceLede(
  history: PortfolioHistory,
  range: RangeState,
): { text: string; amount: string | null } | null {
  const last = history.dates.length - 1
  const window = resolvedWindow(history.dates, range)
  const end = Math.min(window.endValue, last)
  const lede = benchmarkLede(history, window.startValue, end)
  if (lede === null) return null
  const dragged = window.startValue !== rangeStartIndex(history.dates, range.preset) || end < last
  const prefix = dragged
    ? `${formatDate(history.dates[window.startValue])} – ${formatDate(history.dates[end])}`
    : range.preset === '1y'
      ? 'Over 1Y'
      : range.preset === 'ytd'
        ? 'Year to date'
        : null
  return benchmarkLedeText(lede, prefix)
}

/** The performance chart as a table (2026-08-25 spec §2a): date rows × the series in the
 * legend's order, verbatim server strings; degraded/stale benchmark cells go empty. The live
 * ping stays out — it is a quote, not a history row. Where the chart omits the starting
 * balance (the Overview card), so does its table (2026-09-23 spec §C8). */
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
      VOO_LEG_SERIES,
      ...(withStart ? [STARTING_BALANCE_SERIES] : []),
    ],
    rows: history.dates.map((date, i) => [
      date,
      history.market_value[i],
      history.cost_basis[i],
      benchmark[i] ?? '',
      ...(withStart ? [history.sp500[i]] : []),
    ]),
  }
}
