// Pure datasource + option builder for the /spending flow card (2026-08-24 spec §3) — no
// React, no fetching (historyChartOptions posture). Number() here is display-only math
// on the server's Decimal strings and is never handed back to the API.
//
// Palette law: slices arrive PRE-COLOURED through the page's own fold (buildMonthSlices /
// the year's window over charts/entities.ts' categoryFold), so a category wears the exact hue its
// stacked-bar segment wears — same entity, same colour everywhere (2026-09-23 spec §C2), gray
// "Other" fold included.
import type { EChartsOption } from '../../charts/echarts'
import { ENTITY, foldColor } from '../../charts/entities'
import type { CategoryFold } from '../../charts/entities'
import { DEFICIT_DECAL, fanCents } from '../../charts/grammar'
import { SANKEY_MARKS, claimNodeName, makeSankeyTooltipFormatter, sankeyCsv } from '../../charts/sankey'
import type { SankeyLink, SankeyNode } from '../../charts/sankey'
import { monthWords, spendingLeftOut, takeHomeLeftOut } from '../../charts/windowWords'
import type { SpendingMatrix, SpendingYearly, YearRollup } from '../../types/api'
import { toCents } from '../../utils/cents'
import type { ExportTable } from '../../utils/download'
import { formatMonth } from '../../utils/format'
import { buildMonthSlices } from './monthSlices'
import type { MonthSlice } from './monthSlices'

/** The year's window (2026-09-23 spec §0 flows F10, §C1): its MATCHED months, those with spending
 *  rows AND a take-home row (the savings module's rule), so the year's Saved is the Overview's
 *  YTD cash saved and the money flow's, and what the window leaves out is named. */
export interface FlowWindow {
  months: string[]
  /** Every month of the calendar year is matched: the card reads "2025", as it always did. */
  fullYear: boolean
  /** Cash saved over the window: the server's figure (the YTD card's), checked against the
   *  matrix to the cent; the matrix's own when two fetches a moment apart disagree. */
  saved: string
  /** Money that came back: minus the net-negative category totals over the window. */
  refunds: number
  spendingLeftOut: string | null
  takeHomeLeftOut: string | null
}

export interface SpendingFlowPeriod {
  /** "Jul 2026" (month mode); the window, "Jan–Aug 2026", or the whole "2026" (year mode) —
   *  the card title and empty-note noun. */
  label: string
  /** matrix.net_pay[i], or the window's take-home — null keeps the page's empty note. */
  netPay: string | null
  slices: MonthSlice[]
  /** Year mode only. */
  window?: FlowWindow
  /** The empty note when the period itself says why there is nothing to draw. */
  empty?: string
}

// The kinds a period's spending counts (services/savings.py): living spend and tax paid.
// Transfers stay yours (a brokerage deposit is not money gone), exactly as the YTD card's
// cash saved and the money flow's fan leave them out.
const CASH_OUTFLOW_KINDS = new Set(['living', 'tax'])

/** The year a looked-at month falls in, over its matched months (FlowWindow). Every figure is
 *  summed from the matrix's own cells in whole cents. The year's Saved is the rollup's
 *  cash_savings, the one figure the YTD card prints. */
function yearWindowPeriod(matrix: SpendingMatrix, rollup: YearRollup, fold: CategoryFold): SpendingFlowPeriod {
  const year = rollup.year
  const inYear = matrix.months.flatMap((month, i) => (Number(month.slice(0, 4)) === year ? [i] : []))
  const hasSpending = (i: number) => matrix.series.some((series) => series.values[i] !== null)
  const hasPay = (i: number) => matrix.net_pay[i] !== null
  const matched = inYear.filter((i) => hasSpending(i) && hasPay(i))
  if (matched.length === 0) {
    return { label: String(year), netPay: null, slices: [], empty: `No month of ${year} has both take-home and spending entered yet.` }
  }
  const spendOnly = inYear.filter((i) => hasSpending(i) && !hasPay(i))
  const payOnly = inYear.filter((i) => !hasSpending(i) && hasPay(i))
  const kindById = new Map(matrix.categories.map((category) => [category.id, category.kind]))
  const counted = matrix.series.filter((series) => CASH_OUTFLOW_KINDS.has(kindById.get(series.category_id) ?? 'living'))
  const sum = (indices: readonly number[], values: readonly (string | null)[]) =>
    indices.reduce((acc, i) => acc + toCents(values[i]), 0)

  // The window's categories: positive totals in the fold's order and colours, the rest of the
  // positive ones folded into Other; a net-negative total is money that came back (refunds).
  const nameById = new Map(matrix.categories.map((category) => [category.id, category.name]))
  const totals = new Map(counted.map((series) => [series.category_id, sum(matched, series.values)]))
  const slices: MonthSlice[] = []
  for (const id of fold.ids) {
    const total = totals.get(id) ?? 0
    if (total > 0) slices.push({ name: nameById.get(id) ?? String(id), value: total / 100, color: foldColor(fold, id) })
  }
  const inFold = new Set(fold.ids)
  let positive = 0
  let other = 0
  let refunds = 0
  for (const [id, total] of totals) {
    if (total > 0) {
      positive += total
      if (!inFold.has(id)) other += total
    } else {
      refunds -= total
    }
  }
  if (other > 0) slices.push({ name: 'Other', value: other / 100, color: ENTITY.other })

  const netPay = sum(matched, matrix.net_pay)
  const ownSaved = netPay + refunds - positive
  const server = rollup.cash_savings
  const months = matched.map((i) => matrix.months[i])
  return {
    label: matched.length === 12 ? String(year) : `${monthWords(months)} ${year}`,
    netPay: (netPay / 100).toFixed(2),
    slices,
    window: {
      months,
      fullYear: matched.length === 12,
      saved: server != null && toCents(server) === ownSaved ? server : (ownSaved / 100).toFixed(2),
      refunds: refunds / 100,
      spendingLeftOut: spendingLeftOut(
        spendOnly.map((i) => matrix.months[i]),
        year,
        counted.reduce((acc, series) => acc + sum(spendOnly, series.values), 0) / 100,
      ),
      takeHomeLeftOut: takeHomeLeftOut(payOnly.map((i) => matrix.months[i]), year, sum(payOnly, matrix.net_pay) / 100),
    },
  }
}

/**
 * The flow card's datasource for one render: the month column, or that month's year over its
 * matched months. `monthIndex` is the month being LOOKED AT (the movers' rule: the drilled
 * month while the pie is open, the latest month otherwise) — year mode follows it, so
 * drilling an old December and toggling Year answers about THAT year. Month mode is the
 * month's own column, as it always was.
 */
export function spendingFlowPeriod(
  matrix: SpendingMatrix | null,
  yearly: SpendingYearly | null,
  fold: CategoryFold,
  monthIndex: number,
  mode: 'month' | 'year',
): SpendingFlowPeriod | null {
  if (matrix === null || monthIndex < 0 || monthIndex >= matrix.months.length) return null
  const month = matrix.months[monthIndex]
  if (mode === 'month') {
    return {
      label: formatMonth(month),
      netPay: matrix.net_pay[monthIndex],
      slices: buildMonthSlices(matrix, fold, monthIndex),
    }
  }
  const rollup = yearly?.years.find((y) => y.year === Number(month.slice(0, 4)))
  return rollup === undefined ? null : yearWindowPeriod(matrix, rollup, fold)
}

// Fixed node names. Sankey nodes key on NAME, and a user category spelling one of these
// is NOT a benign merge: 'Net pay' is a self-loop (the DAG throw) and 'Saved'/'Drawdown'/
// 'Refunds & credits' duplicate a node, which echarts 6 drops and then crashes wiring (the 2026-08-25
// Overview money-flow incident, same engine path). Slice names are claimed through
// claimNodeName below, so collisions draw under a visible ' (spending)' suffix instead.
const NET_PAY = 'Net pay'
const SAVED = 'Saved'
const DRAWDOWN = 'Drawdown'
const REFUNDS = 'Refunds & credits'

// Cent arithmetic on display floats: Saved/Drawdown are DERIVED figures, and float dust
// (6000 − 2580.0000000000005) must neither invent a node nor leak into a tooltip.
const A_CENT = 0.005
const cents = (value: number) => Math.round(value * 100) / 100

/**
 * "Where {period} went": Net pay fans out into the period's categories, and what is left
 * lands on a green Saved node. A deficit period adds a hatched red Drawdown source instead —
 * links cannot be negative — with every category link split pro-rata between the sources:
 * money is fungible, and a greedy fill that named WHICH categories the drawdown funded
 * would fabricate causality. Null = nothing drawable; the page picks the empty-note
 * sentence (the period's own, netPay missing, or a genuinely empty period).
 *
 * A MONTH is its own column: Saved is net pay less the DRAWN slices (the positive fold,
 * refunds excluded — the drill-in pie's documented gross reading). A YEAR is its window
 * (FlowWindow): Saved is the YTD card's cash saved, and money that came back is drawn as a
 * Refunds & credits inflow so the flow still balances with refunds netted, as the Overview
 * money flow does. Either way every node equals the sum of its links, in whole cents.
 */
export function spendingSankeyOption(period: SpendingFlowPeriod): EChartsOption | null {
  const netPay = period.netPay === null ? null : Number(period.netPay)
  // No net pay — or an unusable one (a negative period cannot source a flow) — is the
  // page's empty-note, never a blank canvas (spec §2).
  if (netPay === null || !Number.isFinite(netPay) || netPay < 0) return null
  // Claim every slice name against the structural nodes (see the constants above), seeded
  // whether or not this period draws them, so a colliding category renders the same in both
  // modes: the fold's own 'Other' entry claims through the same set in emission order, so a
  // real category named 'Other' keeps its name and the fold wears the suffix.
  const taken = new Set([NET_PAY, SAVED, DRAWDOWN, REFUNDS])
  const slices = period.slices.map((slice) => ({
    ...slice,
    name: claimNodeName(slice.name, taken),
  }))
  const spent = cents(slices.reduce((acc, slice) => acc + slice.value, 0))
  const refunds = period.window?.refunds ?? 0
  const saved = period.window === undefined ? cents(netPay - spent) : Number(period.window.saved)
  const deficit = saved <= -A_CENT
  const drawsRefunds = refunds >= A_CENT

  // Node order is render order (SANKEY_MARKS.layoutIterations 0): sources first, then
  // categories biggest-first (the slices' own order), Saved at the bottom.
  const nodes: SankeyNode[] = []
  // MUTED-family neutral: the node restates income, it is not a destination (spec §3).
  if (netPay >= A_CENT) {
    nodes.push({ name: NET_PAY, value: netPay, itemStyle: { color: ENTITY.structural } })
  }
  // Money that came back (a year's net-refund category) is not income either: the same neutral.
  if (drawsRefunds) nodes.push({ name: REFUNDS, value: refunds, itemStyle: { color: ENTITY.structural } })
  if (deficit) {
    // Hatched as well as red: the deficit red reads as the tax hue a category may wear
    // (grammar DEFICIT_DECAL, 2026-09-23 review).
    nodes.push({ name: DRAWDOWN, value: cents(-saved), itemStyle: { color: ENTITY.deficit, decal: DEFICIT_DECAL } })
  }
  for (const slice of slices) {
    nodes.push({
      name: slice.name,
      value: slice.value,
      // The stacked chart's exact colour, carried on the slice (the fold's hue, or the
      // gray Other for the folded remainder).
      itemStyle: { color: slice.color },
    })
  }

  // Each category split pro-rata across the sources in whole cents, exact on both sides
  // (grammar fanCents): net pay goes LAST, so the biggest source absorbs the rounding. Saved
  // is omitted in a deficit (spec §3); a zero share draws no link (the vesting-tooltip lesson).
  const [viaRefunds, viaDrawdown, viaNetPay] = fanCents(
    [
      drawsRefunds ? Math.round(refunds * 100) : 0,
      deficit ? Math.round(-saved * 100) : 0,
      Math.round((netPay - Math.max(saved, 0)) * 100),
    ],
    slices.map((slice) => Math.round(slice.value * 100)),
  )
  const links: SankeyLink[] = []
  slices.forEach((slice, j) => {
    if (viaNetPay[j] > 0) links.push({ source: NET_PAY, target: slice.name, value: viaNetPay[j] / 100 })
    if (viaRefunds[j] > 0) links.push({ source: REFUNDS, target: slice.name, value: viaRefunds[j] / 100 })
    if (viaDrawdown[j] > 0) links.push({ source: DRAWDOWN, target: slice.name, value: viaDrawdown[j] / 100 })
  })
  // Saved wears POSITIVE green — the one deliberate exception to the reserved-status-color
  // rule, one node per chart: "the kept money is green" is the cross-chart convention
  // (§3/§4). An exactly-zero Saved is OMITTED, not drawn at zero width.
  if (!deficit && saved >= A_CENT) {
    nodes.push({ name: SAVED, value: saved, itemStyle: { color: ENTITY.saved } })
    links.push({ source: NET_PAY, target: SAVED, value: saved })
  }
  if (links.length === 0) return null

  return {
    tooltip: { trigger: 'item', formatter: makeSankeyTooltipFormatter(nodes, links) },
    series: [{ ...SANKEY_MARKS, data: nodes, links }],
  }
}

/** The flow as a table (F12). Built from the same nodes and links the chart draws. */
export function spendingSankeyCsv(period: SpendingFlowPeriod): ExportTable {
  const option = spendingSankeyOption(period) as { series?: { data: SankeyNode[]; links: SankeyLink[] }[] } | null
  const series = option?.series?.[0]
  return series === undefined ? { headers: ['Kind', 'Source', 'Target', 'Value'], rows: [] } : sankeyCsv(series.data, series.links)
}
