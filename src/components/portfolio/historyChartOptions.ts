// Pure option builder for the portfolio performance chart, shared by PortfolioPage and
// OverviewPage (overviewChartOptions.ts posture: no React, no fetching, no theme
// decisions of its own). Number() here is display-only — the server's Decimal strings
// are parsed once and never handed back to the API (format.ts's rule).
import type { EChartsOption } from '../../charts/echarts'
import { INK, MUTED, PALETTE } from '../../charts/theme'
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
 * ledger wins a collision: an event matching a dividend row's (security, ex_date) is
 * dropped. Skipped honestly: dateless imported transactions (nothing to snap to), splits
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
  const days = history.dates.map(dayNumber)
  const ticker = (id: number) => tickers.get(id) ?? `#${id}`
  interface RawEvent {
    kind: 'buy' | 'sell' | 'dividend' | 'exdiv'
    date: string
    text: string
  }
  const raw: RawEvent[] = []
  for (const t of transactions) {
    if (t.txn_date === null || (t.type !== 'buy' && t.type !== 'sell')) continue
    raw.push({
      kind: t.type,
      date: t.txn_date,
      text: `${t.type === 'buy' ? 'Buy' : 'Sell'} ${ticker(t.security_id)} — ${formatShares(
        t.shares,
      )} sh · ${formatDate(t.txn_date)}`,
    })
  }
  // NUL-joined keys, the sankey link-key precedent: neither half can contain a NUL.
  const ledgered = new Set<string>()
  for (const d of dividends) {
    if (d.ex_date !== null) ledgered.add(`${d.security_id}\u0000${d.ex_date}`)
    raw.push({
      kind: 'dividend',
      date: d.pay_date,
      text: `Dividend ${ticker(d.security_id)} — ${formatCurrency(d.amount)} · ${formatDate(
        d.pay_date,
      )}`,
    })
  }
  for (const e of dividendEvents) {
    if (ledgered.has(`${e.security_id}\u0000${e.ex_date}`)) continue
    raw.push({
      kind: 'exdiv',
      date: e.ex_date,
      text: `Ex-dividend ${ticker(e.security_id)} — $${trimPerShare(e.per_share)}/sh · ${formatDate(
        e.ex_date,
      )}`,
    })
  }
  const byIndex = new Map<number, RawEvent[]>()
  for (const event of raw) {
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
  const SYMBOLS = { buy: 'triangle', sell: 'triangle', dividend: 'circle', exdiv: 'circle' } as const
  return [...byIndex.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, events]) => {
      events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
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

// Axis-tooltip params subset the formatter reads (the runtime shape for trigger:'axis'
// is an array of these; echarts types the callback param as a much wider union).
interface AxisTooltipParam {
  seriesName?: string
  marker?: string
  axisValueLabel?: string
  value?: unknown
  data?: unknown
}

function rowValue(value: unknown): number | null {
  // Line rows carry plain numbers (null on the padded live category); the live
  // effectScatter carries a [category, value] pair.
  const raw = Array.isArray(value) ? value[1] : value
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
}

// Exported for tests. Skipping null rows is the point: on the live category the three
// lines are padding-null and would each print a dash row under the default formatter.
// The Events row expands into its clustered event lines (count first when > 1) rather
// than printing its y — that y is chart geometry, not a figure. Series names and date
// labels are app-generated; EVENT TEXT carries tickers (server text), so it is escaped.
export function historyTooltipFormatter(params: unknown): string {
  const list = (Array.isArray(params) ? params : [params]) as AxisTooltipParam[]
  const rows: { param: AxisTooltipParam; value: number }[] = []
  const eventLines: string[] = []
  for (const param of list) {
    if (param.seriesName === EVENTS_SERIES) {
      const events =
        (param.data as { events?: { text: string }[] } | undefined)?.events ?? []
      if (events.length > 1) eventLines.push(`<strong>${events.length} events</strong>`)
      for (const event of events) {
        eventLines.push(`${param.marker ?? ''} ${escapeHtml(event.text)}`)
      }
      continue
    }
    const value = rowValue(param.value)
    if (value !== null) rows.push({ param, value })
  }
  if (rows.length === 0 && eventLines.length === 0) return ''
  const header = list.find((p) => p.axisValueLabel)?.axisValueLabel ?? ''
  return [
    `<strong>${header}</strong>`,
    ...rows.map(
      ({ param, value }) =>
        `${param.marker ?? ''} ${param.seriesName ?? ''}&nbsp;&nbsp;${formatCurrency(value)}`,
    ),
    ...eventLines,
  ].join('<br/>')
}

export function portfolioHistoryOption(
  history: PortfolioHistory,
  live: LivePoint | null,
  events: ChartEventPoint[] | null = null,
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

  // Fixed validated palette slots (charts/theme.ts law): value=slot 1 blue, cost
  // basis=slot 2 orange, S&P=slot 3 aqua, contribution benchmark=slot 4 yellow. The wash
  // rides the value line ONLY — the Excel original's three overlapping opaque areas
  // occlude each other (spec: rejected).
  const lineSeries = (name: string, values: (string | null)[], color: string, wash: boolean) => ({
    type: 'line' as const,
    name,
    symbol: 'none' as const,
    lineStyle: { width: 2 },
    color,
    ...(wash ? { areaStyle: { opacity: 0.12 } } : {}),
    data: lineData(values),
  })

  // Stale-tab armor: a payload cached from the pre-benchmark API omits the field.
  // Treat omitted like the server's all-null degradation — no fourth series at all,
  // because an all-null line draws nothing yet still ghost-occupies the legend.
  const benchmark = history.benchmark ?? []
  const showBenchmark = benchmark.some((v) => v !== null)

  return {
    grid: { left: 70, right: 16, top: 32, bottom: 28 },
    legend: { top: 0 },
    xAxis: { type: 'category', data: categories, boundaryGap: false },
    yAxis: {
      // No scale:true — a washed area over a visible axis needs the honest zero baseline.
      type: 'value',
      axisLabel: { formatter: (v: number) => formatCurrencyCompact(v) },
    },
    tooltip: { trigger: 'axis', formatter: historyTooltipFormatter },
    series: [
      lineSeries('Portfolio value', history.market_value, PALETTE[0], true),
      lineSeries('Cost basis', history.cost_basis, PALETTE[1], false),
      lineSeries('S&P 500 baseline', history.sp500, PALETTE[2], false),
      // Legend-only disambiguation (spec §4): the two benchmark names must explain
      // themselves side by side — "baseline" = starting balance only, this = every flow.
      ...(showBenchmark
        ? [lineSeries('VOO (your contributions)', benchmark, PALETTE[3], false)]
        : []),
      ...(events !== null && events.length > 0
        ? [
            {
              // Plain scatter in MUTED riding the value line — an annotation layer, not
              // a data hue, and the ripple stays reserved for the live ping (the
              // net-worth notes-diamond rule). Legend-toggleable, ON by default: no
              // legend.selected entry ships for it.
              type: 'scatter' as const,
              name: EVENTS_SERIES,
              color: MUTED,
              symbolSize: 9,
              itemStyle: { borderColor: INK, borderWidth: 1 },
              z: 11,
              data: events,
            },
          ]
        : []),
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
    ],
  }
}

/** The performance chart as a table (2026-08-25 spec §2a): date rows × the four series,
 * verbatim server strings; degraded/stale benchmark cells go empty. The live ping stays
 * out — it is a quote, not a history row. */
export function portfolioHistoryCsv(history: PortfolioHistory): ExportTable {
  const benchmark = history.benchmark ?? []
  return {
    headers: [
      'Date',
      'Portfolio value',
      'Cost basis',
      'S&P 500 baseline',
      'VOO (your contributions)',
    ],
    rows: history.dates.map((date, i) => [
      date,
      history.market_value[i],
      history.cost_basis[i],
      history.sp500[i],
      benchmark[i] ?? '',
    ]),
  }
}
