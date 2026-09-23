// The performance chart's events (2026-09-23 spec §C8): the ledgers and the provider's
// ex-dividend notices as display lines, snapped to the weekly bars — buys and sells for the value
// line, dividends and ex-dividend dates for the rug — and the chart series that draw them. Split
// out of historyChartOptions.ts (code review 10); pure, no React. Also the price chart's and the
// ESPP chart's event annotations (buildEventMarkers, eventLines).
import { INK, MUTED } from '../../charts/theme'
import type { AxisTooltipParam } from '../../charts/tooltip'
import type { DividendEventOut, DividendOut, PortfolioHistory, TransactionOut } from '../../types/api'
import { escapeHtml, formatCurrency, formatDate, formatShares } from '../../utils/format'

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

/** The rug's two marks, one per kind, and the legend icon each wears (code review 6): the
 *  household's own dividends a 2px × 10px TICK in INK, the provider's ex-dividend notices a 6px
 *  DOT in MUTED — shape as well as tone, so the two kinds never rest on colour alone. The legend
 *  shows the same marks (the house legend icon is a rounded square for every other entry). */
export const RUG_MARKS = {
  [DIVIDENDS_SERIES]: { symbol: 'rect' as const, symbolSize: [2, 10] as [number, number], icon: 'path://M4 0h2v10h-2z' },
  [EXDIV_SERIES]: { symbol: 'circle' as const, symbolSize: 6, icon: 'circle' },
}

/** The performance chart's event layers (2026-09-23 spec §C8). Buys and sells: plain scatter in
 *  MUTED riding the value line — an annotation layer, not a data hue, and the ripple stays the
 *  live ping's (the net-worth notes-diamond rule). The rug at y 0 straddles the x-axis line, so it
 *  crosses the plot only where the lines themselves are lowest; neutral tones by kind (INK for the
 *  household's own ledger, MUTED for provider notices), because no money-entity colour can then
 *  collide with them inside this chart, and the ledger draws on top where a week has both. An
 *  empty kind draws no series and lists no legend entry. */
export function eventSeries(events: PerformanceEvents) {
  const marker = (name: string, data: ChartEventPoint[]) => ({
    type: 'scatter' as const,
    name,
    color: MUTED,
    symbolSize: 9,
    itemStyle: { borderColor: INK, borderWidth: 1 },
    z: 11,
    data,
  })
  const rug = (name: keyof typeof RUG_MARKS, data: RugPoint[], color: string, z: number) => ({
    type: 'scatter' as const,
    name,
    color,
    symbol: RUG_MARKS[name].symbol,
    symbolSize: RUG_MARKS[name].symbolSize,
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
