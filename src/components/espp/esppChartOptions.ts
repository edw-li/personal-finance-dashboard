// Pure option builders for the ESPP page's two chart cards (2026-09-07 spec §5–§6) — no React,
// no fetching, no theme decisions of its own (compChartOptions.ts's posture). Number() here is
// display-only geometry: the server's Decimal strings are parsed once and never handed back
// (format.ts's rule), and every figure a tooltip or CSV prints is the wire string, formatted.
import type { EChartsOption } from '../../charts/echarts'
import {
  BAR_MARKS,
  LINE,
  capLabel,
  cents,
  dateAxis,
  grid,
  moneyAxis,
  monthAxis,
  stagger,
} from '../../charts/grammar'
import { legendFor } from '../../charts/legend'
import { referenceLine } from '../../charts/reference'
import { INK, MUTED, NEGATIVE, PALETTE, POSITIVE, SURFACE } from '../../charts/theme'
import { timeZoom } from '../../charts/timeZoom'
import { axisTooltip } from '../../charts/tooltip'
import type { EsppLotOut, EsppLotsResponse, EsppOfferingOut, PricePoint } from '../../types/api'
import type { ExportTable } from '../../utils/download'
import {
  escapeHtml,
  formatCurrency,
  formatDate,
  formatMonth,
  formatPct,
  formatShares,
} from '../../utils/format'
import { addDays } from '../../utils/months'
import { eventLines } from '../portfolio/historyChartOptions'
import type { ChartEventPoint } from '../portfolio/historyChartOptions'

export type AnatomyView = 'dollars' | 'per-share'

// Series names — the legend, the tooltip contract, the cards and the tests share them.
export const PAID = 'Paid'
export const BARGAIN = 'Bargain element'
export const APPRECIATION = 'Appreciation'
export const LOSS = 'Below purchase FMV'
export const PRICE_DOT = 'Price'
export const SUBSCRIPTION = 'Subscription price'
export const QUOTE_RULE = 'Current quote'
export const CLOSE = 'Close'
export const AVG_PAID = 'Avg paid to date'
export const PURCHASES = 'Purchases'
export const SALES = 'Sales'

// Slots 2, 3, 1 — orange, green, blue — validated in both themes (spec §8.2). Fixed by
// COMPONENT, never by lot: lots pass eight by 2028 and identity was never the story.
export const ANATOMY_COLORS = {
  paid: PALETTE[1],
  bargain: PALETTE[2],
  appreciation: PALETTE[0],
} as const

/** A lot the anatomy builder can draw: the 2026-09-07 fields are present. */
export type AnatomyLot = EsppLotOut & {
  fmv_value: string
  bargain_element: string
  lookback_component: string
  discount_component: string
  appreciation: string | null
  avg_paid_to_date: string | null
}

/** A pre-batch snapshot lacks the anatomy: the cards read that as "not loaded yet", never as zero. */
export function hasAnatomy(lots: EsppLotOut[]): lots is AnatomyLot[] {
  return lots.every(
    (l) =>
      l.fmv_value !== undefined &&
      l.bargain_element !== undefined &&
      l.lookback_component !== undefined &&
      l.discount_component !== undefined &&
      l.appreciation !== undefined &&
      l.avg_paid_to_date !== undefined,
  )
}

/** Chain order — (purchase_date, id), the router's own. The chart owns its axis order rather than
 *  trusting the feed (tcTrajectoryOption's reasoning). ISO dates sort as strings. */
export function sortLots<L extends EsppLotOut>(lots: L[]): L[] {
  return [...lots].sort((a, b) =>
    a.purchase_date < b.purchase_date ? -1 : a.purchase_date > b.purchase_date ? 1 : a.id - b.id,
  )
}

/** "Feb 2024" per lot; two lots in one month fall back to the full date; sold lots say so. */
export function lotLabels(lots: EsppLotOut[]): string[] {
  const months = lots.map((l) => formatMonth(l.purchase_date))
  const counts = new Map<string, number>()
  for (const m of months) counts.set(m, (counts.get(m) ?? 0) + 1)
  return lots.map(
    (l, i) =>
      `${(counts.get(months[i]) ?? 0) > 1 ? formatDate(l.purchase_date) : months[i]}${l.is_sold ? ' (sold)' : ''}`,
  )
}

type Datum =
  | number
  | { value: number; itemStyle: { color: string; borderColor: string; borderWidth: number } }

/** Sold lots draw HOLLOW (spec §5.2): an outline in the segment's own colour over a transparent
 *  fill — the shares are gone. Hatch and fade already mean "estimate" on the Comp page, gray is
 *  the folded tail; fill was the one free channel. */
function hollowIfSold(values: number[], lots: EsppLotOut[], color: string): Datum[] {
  return values.map((value, i) =>
    lots[i].is_sold
      ? { value, itemStyle: { color: 'transparent', borderColor: color, borderWidth: 1.5 } }
      : value,
  )
}

/** The loss overlay: a second stack laid over the SAME column (`barGap: '-100%'`, which must
 *  ride the LAST bar series — echarts reads the shared bar layout from it). A transparent,
 *  silent base lifts the NEGATIVE segment to where the loss starts, so the solid stack still
 *  stops at the FMV level and the red reads down to the market value (spec §5.3). */
function lossStack(base: number[], loss: number[], barMaxWidth: number, index: number) {
  return [
    {
      id: 'loss-base',
      name: 'loss-base',
      type: 'bar' as const,
      stack: 'loss',
      silent: true,
      tooltip: { show: false },
      color: 'transparent',
      barMaxWidth,
      data: base,
    },
    {
      id: 'loss',
      name: LOSS,
      type: 'bar' as const,
      stack: 'loss',
      ...BAR_MARKS,
      barMaxWidth,
      ...stagger(index),
      color: NEGATIVE,
      barGap: '-100%',
      data: loss,
    },
  ]
}

/** The lot's own lines under the tooltip's rows — every figure the wire's, formatted; the
 *  bargain split names the discount and the lookback apart (the ten-to-one fact). */
function lotFooter(lots: AnatomyLot[], currentPrice: string | null) {
  return (dataIndex: number): string[] => {
    const lot = lots[dataIndex]
    if (lot === undefined) return []
    const price = lot.is_sold ? lot.sold_price : currentPrice
    const gain =
      lot.gain_amount === null ? '' : ` · gain ${formatCurrency(lot.gain_amount)} (${formatPct(lot.gain_pct)})`
    const status = lot.is_sold
      ? `Sold ${formatDate(lot.sold_date)}${lot.sold_price === null ? '' : ` at ${formatCurrency(lot.sold_price)}`}`
      : lot.qualified
        ? 'Qualified'
        : lot.days_until_qualified === null
          ? 'Qualifying'
          : `Qualifies in ${lot.days_until_qualified} ${lot.days_until_qualified === 1 ? 'day' : 'days'}`
    return [
      `Value ${formatCurrency(lot.market_value)}${gain}`,
      `${formatShares(lot.shares)} sh · paid ${formatCurrency(lot.purchase_price)} · FMV ${formatCurrency(
        lot.purchase_fmv,
      )} · subscription ${formatCurrency(lot.subscription_price)}${price === null ? '' : ` · price ${formatCurrency(price)}`}`,
      `Bargain element: ${formatCurrency(lot.discount_component)} discount + ${formatCurrency(
        lot.lookback_component,
      )} lookback`,
      status,
    ].map(escapeHtml)
  }
}

/**
 * Each lot's value split three ways (spec §5): what was paid, the bargain element on purchase day
 * and the market's move since — or, per share, the same split as a floating range from the paid
 * price up to today's quote. Both views share ids for the two common stacks so the toggle re-runs
 * as an update, not an entrance. Returns null with nothing to draw or on a pre-batch payload.
 */
export function lotAnatomyOption(
  data: EsppLotsResponse,
  { view, selected }: { view: AnatomyView; selected?: Record<string, boolean> },
): EChartsOption | null {
  if (data.lots.length === 0 || !hasAnatomy(data.lots)) return null
  const lots = sortLots(data.lots)
  const labels = lotLabels(lots)
  const footer = lotFooter(lots, data.current_price)
  // The text backup for the hollow outline: a cap label on the top-most segment.
  const soldCap = { label: capLabel((p) => (lots[p.dataIndex]?.is_sold ? 'Sold' : '')) }
  return view === 'dollars'
    ? dollarsOption(lots, labels, footer, soldCap, selected)
    : perShareOption(lots, labels, footer, soldCap, data.current_price, selected)
}

function dollarsOption(
  lots: AnatomyLot[],
  labels: string[],
  footer: (dataIndex: number) => string[],
  soldCap: { label: ReturnType<typeof capLabel> },
  selected?: Record<string, boolean>,
): EChartsOption {
  const paid = lots.map((l) => Number(l.cost_basis))
  const bargain = lots.map((l) => Math.max(Number(l.bargain_element), 0))
  const appreciation = lots.map((l) => (l.appreciation === null ? 0 : Math.max(Number(l.appreciation), 0)))
  const underwater = lots.map((l) => l.appreciation !== null && Number(l.appreciation) < 0)
  const lossBase = lots.map((l, i) => (underwater[i] ? Number(l.market_value) : 0))
  const loss = lots.map((l, i) => (underwater[i] ? cents(Number(l.fmv_value) - Number(l.market_value)) : 0))
  const hasLoss = underwater.some(Boolean)
  const bar = (id: string, name: string, color: string, values: number[], index: number, extra = {}) => ({
    id,
    name,
    type: 'bar' as const,
    stack: 'lot',
    ...BAR_MARKS,
    ...stagger(index),
    color,
    data: hollowIfSold(values, lots, color),
    ...extra,
  })
  const names = [PAID, BARGAIN, APPRECIATION, ...(hasLoss ? [LOSS] : [])]
  return {
    grid: grid(),
    legend: { ...legendFor(names.length, selected), data: names },
    // No Total row: with a loss overlay the components no longer sum to the value, so the value
    // rides the foot as the server's own figure instead.
    tooltip: axisTooltip({ unit: 'money', pointer: 'shadow', groups: names, totalLabel: false, footer }),
    xAxis: monthAxis(labels, { gap: true }),
    yAxis: moneyAxis(),
    series: [
      bar('paid', PAID, ANATOMY_COLORS.paid, paid, 0),
      bar('bargain', BARGAIN, ANATOMY_COLORS.bargain, bargain, 1),
      bar('appreciation', APPRECIATION, ANATOMY_COLORS.appreciation, appreciation, 2, soldCap),
      ...(hasLoss ? lossStack(lossBase, loss, BAR_MARKS.barMaxWidth, 3) : []),
    ],
  }
}

/** The dumbbell form for "before → after per item": every lot on one price axis, its bar a range
 *  from the paid price up to today's quote (or its sale price), the colour change at the FMV on
 *  purchase day. Every unsold column's Price dot sits on the quote rule — the view's point: the
 *  spread is your entry prices, the line is where they all are today (spec §5.4). */
function perShareOption(
  lots: AnatomyLot[],
  labels: string[],
  footer: (dataIndex: number) => string[],
  soldCap: { label: ReturnType<typeof capLabel> },
  currentPrice: string | null,
  selected?: Record<string, boolean>,
): EChartsOption {
  const WIDTH = 10 // a dumbbell's bar is thin; BAR_MARKS' surface hairline stays
  const paid = lots.map((l) => Number(l.purchase_price))
  const fmv = lots.map((l) => Number(l.purchase_fmv))
  const price = lots.map((l) =>
    l.is_sold
      ? l.sold_price === null
        ? null
        : Number(l.sold_price)
      : currentPrice === null
        ? null
        : Number(currentPrice),
  )
  const bargain = lots.map((_, i) => cents(Math.max(fmv[i] - paid[i], 0)))
  const appreciation = lots.map((_, i) => (price[i] === null ? 0 : cents(Math.max((price[i] as number) - fmv[i], 0))))
  const underwater = lots.map((_, i) => price[i] !== null && (price[i] as number) < fmv[i])
  const lossBase = lots.map((_, i) => (underwater[i] ? (price[i] as number) : 0))
  const loss = lots.map((_, i) => (underwater[i] ? cents(fmv[i] - (price[i] as number)) : 0))
  const hasLoss = underwater.some(Boolean)
  const bar = (id: string, name: string, color: string, values: number[], index: number, extra = {}) => ({
    id,
    name,
    type: 'bar' as const,
    stack: 'ladder',
    ...BAR_MARKS,
    barMaxWidth: WIDTH,
    ...stagger(index),
    color,
    data: hollowIfSold(values, lots, color),
    ...extra,
  })
  // The end dots wear the house marker (9px, INK ring); a sold lot's dots go hollow like its bar.
  const dot = (id: string, name: string, color: string, values: (number | null)[]) => ({
    id,
    name,
    type: 'scatter' as const,
    color,
    symbolSize: 9,
    z: 11,
    itemStyle: { borderColor: INK, borderWidth: 1 },
    data: values.map((v, i) =>
      v === null ? null : lots[i].is_sold ? { value: v, itemStyle: { color: SURFACE, borderColor: color, borderWidth: 1.5 } } : v,
    ),
  })
  const priced = currentPrice !== null
  const names = [PAID, BARGAIN, APPRECIATION, ...(hasLoss ? [LOSS] : []), PRICE_DOT, SUBSCRIPTION, ...(priced ? [QUOTE_RULE] : [])]
  return {
    grid: grid(),
    legend: { ...legendFor(names.length, selected), data: names },
    tooltip: axisTooltip({
      unit: 'money',
      pointer: 'shadow',
      groups: [BARGAIN, APPRECIATION, ...(hasLoss ? [LOSS] : [])],
      totalLabel: false,
      references: [PAID, PRICE_DOT, SUBSCRIPTION, ...(priced ? [QUOTE_RULE] : [])],
      footer,
    }),
    xAxis: monthAxis(labels, { gap: true }),
    yAxis: moneyAxis(),
    series: [
      {
        id: 'ladder-base',
        name: 'ladder-base',
        type: 'bar' as const,
        stack: 'ladder',
        silent: true,
        tooltip: { show: false },
        color: 'transparent',
        barMaxWidth: WIDTH,
        data: paid,
      },
      bar('bargain', BARGAIN, ANATOMY_COLORS.bargain, bargain, 1),
      bar('appreciation', APPRECIATION, ANATOMY_COLORS.appreciation, appreciation, 2, soldCap),
      ...(hasLoss ? lossStack(lossBase, loss, WIDTH, 3) : []),
      dot('paid', PAID, ANATOMY_COLORS.paid, paid),
      dot('price', PRICE_DOT, ANATOMY_COLORS.appreciation, price),
      {
        // The annotation-marker grammar, FILLED: hollow stays reserved for sold.
        id: 'subscription',
        name: SUBSCRIPTION,
        type: 'scatter' as const,
        color: MUTED,
        symbol: 'diamond' as const,
        symbolSize: 9,
        z: 12,
        itemStyle: { borderColor: INK, borderWidth: 1 },
        data: lots.map((l) => Number(l.subscription_price)),
      },
      ...(priced ? [referenceLine(QUOTE_RULE, lots.map(() => Number(currentPrice)))] : []),
    ],
  }
}

/** The lots as a table (F12): one row per lot in chain order, verbatim wire strings. */
export function lotAnatomyCsv(data: EsppLotsResponse): ExportTable {
  const lots = hasAnatomy(data.lots) ? sortLots(data.lots) : []
  return {
    headers: [
      'Purchased', 'Status', 'Shares', 'Paid / sh', 'FMV at purchase / sh', 'Subscription / sh', 'Price / sh',
      'Cost', 'Discount component', 'Lookback component', 'Bargain element', 'Appreciation', 'Value',
    ],
    rows: lots.map((l) => [
      l.purchase_date,
      l.is_sold ? 'sold' : 'held',
      l.shares,
      l.purchase_price,
      l.purchase_fmv,
      l.subscription_price,
      (l.is_sold ? l.sold_price : data.current_price) ?? '',
      l.cost_basis,
      l.discount_component,
      l.lookback_component,
      l.bargain_element,
      l.appreciation ?? '',
      l.market_value ?? '',
    ]),
  }
}

// ── The employer price with your purchases (spec §6) ─────────────────────────────────────────

export interface EsppPriceInput {
  /** The window's daily bars, oldest first. */
  points: PricePoint[]
  /** Ascending by offering_start — the resolution order. */
  offerings: EsppOfferingOut[]
  lots: EsppLotOut[]
}

/** A purchase marker rides the close line at its bar; a sold lot's marker goes hollow. */
export interface PurchaseMarker extends ChartEventPoint {
  itemStyle?: { color: string; borderColor: string; borderWidth: number }
}

/** Index of the last bar on or before `iso`, or -1 when the history starts later. ISO strings
 *  compare as dates (format.ts's never-`new Date(iso)` rule). */
function barOnOrBefore(dates: string[], iso: string): number {
  let index = -1
  for (let i = 0; i < dates.length && dates[i] <= iso; i++) index = i
  return index
}

/** The covering offering's price per bar — greatest offering_start <= date (espp_calc's rule),
 *  null before the first offering. */
function subscriptionSteps(dates: string[], offerings: EsppOfferingOut[]): (number | null)[] {
  return dates.map((d) => {
    let covering: EsppOfferingOut | null = null
    for (const o of offerings) if (o.offering_start <= d) covering = o
    return covering === null ? null : Number(covering.subscription_price)
  })
}

/** The latest lot bought on or before each bar, and its running average — null before the first
 *  purchase, or on a pre-batch payload that carries no average. */
function avgPaidSteps(dates: string[], chain: EsppLotOut[]): (number | null)[] {
  return dates.map((d) => {
    let latest: EsppLotOut | null = null
    for (const l of chain) if (l.purchase_date <= d) latest = l
    const avg = latest?.avg_paid_to_date
    return avg === undefined || avg === null ? null : Number(avg)
  })
}

/**
 * Daily closes for the employer ticker against two stepped rules — the subscription price of the
 * offering in force and your average paid per share to date — with the above/below wash against
 * the average and one marker per purchase (and per sale). The holding drill-in's chart, with the
 * rules that make an ESPP legible: whenever the close sits above the subscription rule, the
 * lookback is binding. Returns null under two bars.
 */
export function esppPriceOption({ points, offerings, lots }: EsppPriceInput): EChartsOption | null {
  if (points.length < 2) return null
  const dates = points.map((p) => p.d)
  const labels = dates.map(formatDate)
  const closes = points.map((p) => Number(p.c))
  const chain = sortLots(lots)
  const subscription = subscriptionSteps(dates, offerings)
  const avgPaid = avgPaidSteps(dates, chain)
  const hasSub = subscription.some((v) => v !== null)
  const hasAvg = avgPaid.some((v) => v !== null)
  // The wash is TWO STACKED PAIRS against the STEPPED average (priceChartOptions' technique — a
  // piecewise visualMap with open-ended pieces throws on a real canvas, the 2026-09-04 probe).
  // Nothing draws before the first purchase: a null in every member leaves the gap honest.
  const wash = (name: string, stack: string, color: string, data: (number | null)[]) => ({
    name,
    type: 'line' as const,
    stack,
    symbol: 'none' as const,
    lineStyle: { width: 0 },
    color,
    emphasis: { disabled: true },
    tooltip: { show: false },
    silent: true,
    connectNulls: false,
    ...(color === 'transparent' ? {} : { areaStyle: { opacity: 0.12 } }),
    data,
  })
  const at = (i: number) => avgPaid[i] as number
  const washes = hasAvg
    ? [
        wash('wash-above-base', 'above-paid', 'transparent', avgPaid),
        wash('Above avg paid', 'above-paid', POSITIVE, closes.map((c, i) => (avgPaid[i] === null ? null : cents(Math.max(c - at(i), 0))))),
        wash('wash-below-base', 'below-paid', 'transparent', closes.map((c, i) => (avgPaid[i] === null ? null : Math.min(c, at(i))))),
        wash('Below avg paid', 'below-paid', NEGATIVE, closes.map((c, i) => (avgPaid[i] === null ? null : cents(Math.max(at(i) - c, 0))))),
      ]
    : []
  const purchases: PurchaseMarker[] = []
  const sales: ChartEventPoint[] = []
  for (const l of chain) {
    const bought = barOnOrBefore(dates, l.purchase_date)
    if (bought >= 0) {
      purchases.push({
        value: [labels[bought], closes[bought]],
        symbol: 'diamond',
        symbolRotate: 0,
        events: [
          {
            text: `${formatDate(l.purchase_date)} · ${formatShares(l.shares)} sh · paid ${formatCurrency(
              l.purchase_price,
            )} · FMV ${formatCurrency(l.purchase_fmv)}${l.is_sold ? ` · sold ${formatDate(l.sold_date)}` : ''}`,
          },
        ],
        // Hollow = sold, the page's one meaning for it (spec §5.2).
        ...(l.is_sold ? { itemStyle: { color: SURFACE, borderColor: PALETTE[1], borderWidth: 1.5 } } : {}),
      })
    }
    if (l.is_sold && l.sold_date !== null) {
      const sold = barOnOrBefore(dates, l.sold_date)
      if (sold >= 0) {
        sales.push({
          value: [labels[sold], closes[sold]],
          // The events grammar's sell glyph (historyChartOptions): the triangle, rotated.
          symbol: 'triangle',
          symbolRotate: 180,
          events: [
            {
              text: `Sold ${formatDate(l.sold_date)} · ${formatShares(l.shares)} sh${
                l.sold_price === null ? '' : ` at ${formatCurrency(l.sold_price)}`
              }`,
            },
          ],
        })
      }
    }
  }
  // Two dashed MUTED references look alike, so each names itself at its end (grid 'endLabel').
  // The end text is the SHORT name, not '{a}': grid('endLabel') reserves 84px on the right, and
  // 'Subscription price' / 'Avg paid to date' run past that at 11px — the 2026-09-07 probe's first
  // shoot clipped both to "Subscription p" and "Avg paid to da".
  const step = (name: string, endText: string, data: (number | null)[]) => ({
    ...referenceLine(name, data, { step: 'end' }),
    endLabel: { show: true, formatter: endText, color: MUTED, fontSize: 11 },
  })
  const names = [
    CLOSE,
    ...(hasSub ? [SUBSCRIPTION] : []),
    ...(hasAvg ? [AVG_PAID] : []),
    ...(purchases.length > 0 ? [PURCHASES] : []),
    ...(sales.length > 0 ? [SALES] : []),
  ]
  const marker = (name: string, color: string, symbolSize: number, data: ChartEventPoint[]) => ({
    type: 'scatter' as const,
    name,
    color,
    symbolSize,
    itemStyle: { borderColor: INK, borderWidth: 1 },
    z: 11,
    data,
  })
  return {
    // 'all': the chips change the WINDOW handed in, so the zoom opens on everything it was given.
    dataZoom: timeZoom(dates, 'all'),
    grid: grid('endLabel'),
    // Listed explicitly so the four wash members stay OUT of the legend (the price chart's rule).
    legend: { ...legendFor(names.length), data: names },
    tooltip: axisTooltip({
      unit: 'money',
      references: [SUBSCRIPTION, AVG_PAID],
      annotationSeries: [PURCHASES, SALES],
      annotations: eventLines,
    }),
    xAxis: dateAxis(labels),
    // scale, unlike the money charts' zero anchor: a price line has no additive reading.
    yAxis: moneyAxis({ zero: false }),
    series: [
      ...washes,
      { ...LINE, name: CLOSE, color: PALETTE[0], data: closes },
      ...(hasSub ? [step(SUBSCRIPTION, 'Subscription', subscription)] : []),
      ...(hasAvg ? [step(AVG_PAID, 'Avg paid', avgPaid)] : []),
      ...(purchases.length > 0 ? [marker(PURCHASES, PALETTE[1], 10, purchases)] : []),
      ...(sales.length > 0 ? [marker(SALES, MUTED, 9, sales)] : []),
    ],
  }
}

/** The chip window over the ONE fetched series, anchored on today (the chips slice, they do not
 *  refetch — the page already holds 3650 days for the offerings chip). */
export function sliceWindow(points: PricePoint[], days: number, todayIso: string): PricePoint[] {
  const since = addDays(todayIso, -days)
  return points.filter((p) => p.d >= since)
}

/** How many lots were bought before the stored history begins — the footer's honesty line. */
export function lotsBeforeHistory(points: PricePoint[], lots: EsppLotOut[]): number {
  if (points.length === 0) return 0
  const first = points[0].d
  return lots.filter((l) => l.purchase_date < first).length
}

/** The window as a table (F12): one row per bar, the two rules, and the day's purchase or sale. */
export function esppPriceCsv(points: PricePoint[], offerings: EsppOfferingOut[], lots: EsppLotOut[]): ExportTable {
  const dates = points.map((p) => p.d)
  const chain = sortLots(lots)
  const bought = new Map<number, string>()
  const sold = new Map<number, string>()
  for (const l of chain) {
    const b = barOnOrBefore(dates, l.purchase_date)
    if (b >= 0) bought.set(b, l.shares)
    if (l.is_sold && l.sold_date !== null) {
      const s = barOnOrBefore(dates, l.sold_date)
      if (s >= 0) sold.set(s, l.shares)
    }
  }
  // Verbatim wire strings where one exists, so the table never re-scales a Numeric(14,5): the
  // rules print the covering row's own text rather than the builder's parsed step.
  const subText = (d: string) => {
    let covering: EsppOfferingOut | null = null
    for (const o of offerings) if (o.offering_start <= d) covering = o
    return covering === null ? '' : covering.subscription_price
  }
  const avgText = (d: string) => {
    let latest: EsppLotOut | null = null
    for (const l of chain) if (l.purchase_date <= d) latest = l
    return latest?.avg_paid_to_date ?? ''
  }
  return {
    headers: ['Date', 'Close', 'Subscription price', 'Avg paid to date', 'Purchase (shares)', 'Sale (shares)'],
    rows: points.map((p, i) => [p.d, p.c, subText(p.d), avgText(p.d), bought.get(i) ?? '', sold.get(i) ?? '']),
  }
}
