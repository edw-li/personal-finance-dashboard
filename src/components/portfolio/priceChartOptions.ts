// Pure option builder for the holding drill-in's price chart — no React, no fetching. Number()
// here is display-only: the server's Decimal strings are parsed once and never handed back.
import type { EChartsOption } from '../../charts/echarts'
import { LINE, dateAxis, grid, moneyAxis } from '../../charts/grammar'
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

/** Fetch windows (they move the REQUEST — ?days=), not zooms. 'All' replaces 'Max' (F13). */
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
  const series = [
    {
      ...LINE,
      name: 'Close',
      color: PALETTE[0],
      // The line's colour is set EXPLICITLY so the piecewise visualMap below reaches the wash
      // and not the stroke (the probe in Task 6 is what holds this claim).
      lineStyle: { width: 2, color: PALETTE[0] },
      // The wash's ORIGIN is the cost — the fill lives between the line and the rule, which is
      // why the scaled (zero: false) axis does not misrepresent it (§8's rationale).
      ...(cost === null ? {} : { areaStyle: { opacity: 0.12, origin: cost } }),
      data: points.map((p) => Number(p.c)),
    },
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
    legend: legendFor(series.length),
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
    ...(cost === null
      ? {}
      : {
          // Above cost reads POSITIVE, below NEGATIVE — the one status use a series wash is
          // allowed (spec §12). Hidden: the rule and the footer already say what it means.
          visualMap: {
            type: 'piecewise' as const,
            show: false,
            seriesIndex: 0,
            dimension: 1,
            pieces: [
              { gte: cost, color: POSITIVE },
              { lt: cost, color: NEGATIVE },
            ],
          },
        }),
    series,
  }
}

/** The footer's figures: change over the fetched window and where the history begins. */
export function priceWindowSummary(
  points: PricePoint[],
): { changePct: number; since: string } | null {
  if (points.length === 0) return null
  const first = Number(points[0].c)
  const last = Number(points[points.length - 1].c)
  return { changePct: first === 0 ? 0 : (last - first) / first, since: formatDate(points[0].d) }
}

const DAY = 86_400_000
const dayNumber = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return Date.UTC(y, m - 1, d) / DAY
}
// A week of slack: bars are trading days, so a full year of history is short of 365 rows.
const SLACK_DAYS = 7

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
  if (points.length === 0) return all
  const covered = dayNumber(todayIso) - dayNumber(points[0].d)
  if (covered >= requestedDays - SLACK_DAYS) return all
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
