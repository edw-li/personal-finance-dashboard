// Pure option builders for the ESPP page's two chart cards (2026-09-07 spec §5–§6) — no React,
// no fetching, no theme decisions of its own (compChartOptions.ts's posture). Number() here is
// display-only geometry: the server's Decimal strings are parsed once and never handed back
// (format.ts's rule), and every figure a tooltip or CSV prints is the wire string, formatted.
import type { EChartsOption } from '../../charts/echarts'
import { BAR_MARKS, capLabel, cents, grid, moneyAxis, monthAxis, stagger } from '../../charts/grammar'
import { legendFor } from '../../charts/legend'
import { NEGATIVE, PALETTE } from '../../charts/theme'
import { axisTooltip } from '../../charts/tooltip'
import type { EsppLotOut, EsppLotsResponse } from '../../types/api'
import type { ExportTable } from '../../utils/download'
import {
  escapeHtml,
  formatCurrency,
  formatDate,
  formatMonth,
  formatPct,
  formatShares,
} from '../../utils/format'

export type AnatomyView = 'dollars' | 'per-share'

// Series names — the legend, the tooltip contract, the cards and the tests share them.
export const PAID = 'Paid'
export const BARGAIN = 'Bargain element'
export const APPRECIATION = 'Appreciation'
export const LOSS = 'Below purchase FMV'

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
  // The per-share view lands in the next step; until then only Dollars has geometry to draw.
  return view === 'dollars' ? dollarsOption(lots, labels, footer, soldCap, selected) : null
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
