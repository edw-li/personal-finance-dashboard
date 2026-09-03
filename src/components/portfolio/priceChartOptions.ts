// Pure option builder for the holding drill-in's price chart — no React, no fetching. Number()
// here is display-only: the server's Decimal strings are parsed once and never handed back.
import type { EChartsOption } from '../../charts/echarts'
import { LINE, cents, dateAxis, grid, moneyAxis } from '../../charts/grammar'
import { legendFor } from '../../charts/legend'
import { referenceLine } from '../../charts/reference'
import { INK, MUTED, NEGATIVE, PALETTE, POSITIVE } from '../../charts/theme'
import { timeZoom } from '../../charts/timeZoom'
import { axisTooltip } from '../../charts/tooltip'
import type { PricePoint } from '../../types/api'
import type { ExportTable } from '../../utils/download'
import { formatDate } from '../../utils/format'
import { EVENTS_SERIES, eventLines } from './historyChartOptions'
import type { ChartEventPoint } from './historyChartOptions'

/** Fetch windows (they move the REQUEST — ?days=), not zooms. All replaces the Max chip (F13). */
export const PRICE_SPANS = [
  { days: 365, label: '1Y' },
  { days: 1095, label: '3Y' },
  { days: 3650, label: 'All' },
] as const
export type SpanDays = (typeof PRICE_SPANS)[number]['days']

export interface PriceChartInput {
  points: PricePoint[]
  /** The holding's average cost; null before any dated buy. */
  avgCost: string | null
  /** Dated buys/sells/dividends snapped to the daily bars (buildEventMarkers over `points`). */
  events?: ChartEventPoint[]
}

/**
 * Daily closes for ONE security, with the cost rule and the above/below-cost wash (F4).
 * Returns null under two points — a manual-priced security accrues one bar per hand entry.
 */
export function priceHistoryOption({
  points,
  avgCost,
  events = [],
}: PriceChartInput): EChartsOption | null {
  if (points.length < 2) return null
  const cost = avgCost === null ? null : Number(avgCost)
  const closes = points.map((p) => Number(p.c))
  // The above/below-cost wash is TWO STACKED PAIRS, not a piecewise visualMap over one
  // areaStyle.origin: the 2026-09-04 real-echarts probe (scratchpad/charts-c4-probe) showed
  // that a visualMap whose pieces are open-ended (gte / lt) leaves visualMeta.stops empty,
  // and echarts 6's getVisualGradient then throws on the first stop — invisible to jsdom,
  // fatal on a real canvas (the 2026-08-25 sankey lesson). The projection fan's own
  // technique instead: an invisible absolute base per side, the signed gap stacked on it.
  const wash = (name: string, stack: string, color: string, data: number[]) => ({
    name,
    type: 'line' as const,
    stack,
    symbol: 'none' as const,
    lineStyle: { width: 0 },
    color,
    emphasis: { disabled: true },
    tooltip: { show: false },
    silent: true,
    ...(color === 'transparent' ? {} : { areaStyle: { opacity: 0.12 } }),
    data,
  })
  const washes =
    cost === null
      ? []
      : [
          // Above: a transparent floor AT the cost, then the excess over it in POSITIVE.
          wash('wash-above-base', 'above-cost', 'transparent', closes.map(() => cost)),
          wash('Above cost', 'above-cost', POSITIVE, closes.map((c) => cents(Math.max(c - cost, 0)))),
          // Below: a transparent floor at the close (when under cost), then the shortfall in NEGATIVE.
          wash('wash-below-base', 'below-cost', 'transparent', closes.map((c) => Math.min(c, cost))),
          wash('Below cost', 'below-cost', NEGATIVE, closes.map((c) => cents(Math.max(cost - c, 0)))),
        ]
  const names = [
    'Close',
    ...(cost === null ? [] : ['Avg cost']),
    ...(events.length > 0 ? [EVENTS_SERIES] : []),
  ]
  const series = [
    ...washes,
    { ...LINE, name: 'Close', color: PALETTE[0], data: closes },
    ...(cost === null ? [] : [referenceLine('Avg cost', points.map(() => cost))]),
    ...(events.length > 0
      ? [
          {
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
  ]
  return {
    // 'all': the chips change the FETCH window, so the zoom opens on everything it was handed.
    dataZoom: timeZoom(
      points.map((p) => p.d),
      'all',
    ),
    grid: grid(),
    // Listed explicitly so the four wash members stay OUT of the legend (the projection
    // fan's rule): a toggleable "wash-above-base" is not a thing a reader can act on.
    legend: { ...legendFor(names.length), data: names },
    tooltip: axisTooltip({
      unit: 'money',
      references: ['Avg cost'],
      annotationSeries: [EVENTS_SERIES],
      annotations: eventLines,
    }),
    xAxis: dateAxis(points.map((p) => formatDate(p.d))),
    // scale, unlike the money charts' zero anchor: a price line has no additive reading, and
    // pinning a ~$580 close to a $0 floor flattens the year to a ribbon.
    yAxis: moneyAxis({ zero: false }),
    series,
  }
}

const DAY = 86_400_000
const dayNumber = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return Date.UTC(y, m - 1, d) / DAY
}
// A week of slack: bars are trading days, so a full year of history is short of 365 rows.
const SLACK_DAYS = 7

/**
 * Whether the response REVEALS the whole extent of this security's history: it came back
 * short of the window it asked for, so there is nothing older to fetch. A full-length
 * response says nothing — decades may sit behind it. The disabled chips and the footer's
 * wording both turn on this one test, so it lives in one place.
 */
export function extentKnown(
  points: PricePoint[],
  requestedDays: number,
  todayIso: string,
): boolean {
  if (points.length === 0) return false
  return dayNumber(todayIso) - dayNumber(points[0].d) < requestedDays - SLACK_DAYS
}

/**
 * The footer's figures: change across the fetched window, its first bar, and whether that
 * bar is the START OF THE HISTORY or merely where this window opens — the panel says
 * "history since" only in the first case, because claiming it on a full-length response
 * would invent an inception date for a security that has more behind it.
 */
export function priceWindowSummary(
  points: PricePoint[],
  requestedDays: number,
  todayIso: string,
): { changePct: number; since: string; extentKnown: boolean } | null {
  if (points.length === 0) return null
  const first = Number(points[0].c)
  const last = Number(points[points.length - 1].c)
  return {
    changePct: first === 0 ? 0 : (last - first) / first,
    since: formatDate(points[0].d),
    extentKnown: extentKnown(points, requestedDays, todayIso),
  }
}

/**
 * Which spans are worth offering. A response SHORTER than the window it asked for reveals the
 * whole extent of the history; every span longer than the first one that already covers it
 * would fetch the same rows again, so those chips are disabled. A full-length response says
 * nothing about longer spans, so every chip stays live.
 */
export function reachableSpans(
  points: PricePoint[],
  requestedDays: number,
  todayIso: string,
): Record<SpanDays, boolean> {
  const all: Record<SpanDays, boolean> = { 365: true, 1095: true, 3650: true }
  if (!extentKnown(points, requestedDays, todayIso)) return all
  const covered = dayNumber(todayIso) - dayNumber(points[0].d)
  let covering = false
  for (const span of PRICE_SPANS) {
    if (covering) all[span.days] = false
    else if (span.days > covered + SLACK_DAYS) covering = true // this span shows everything
  }
  return all
}

/** The fetched window as a table (F12): date, close — verbatim strings. */
export function priceHistoryCsv(points: PricePoint[]): ExportTable {
  return { headers: ['Date', 'Close'], rows: points.map((p) => [p.d, p.c]) }
}
