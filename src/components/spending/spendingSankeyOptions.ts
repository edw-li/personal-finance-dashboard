// Pure datasource + option builder for the /spending flow card (2026-08-24 spec §3) — no
// React, no fetching (historyChartOptions posture). Number() here is display-only math
// on the server's Decimal strings and is never handed back to the API.
//
// Palette law: slices arrive PRE-SLOTTED through the page's own topIds order
// (buildMonthSlices / buildYearSlices), so a category wears the exact hue its stacked-bar
// segment wears — same entity, same color everywhere, gray "Other" fold included.
import type { EChartsOption } from '../../charts/echarts'
import { SANKEY_MARKS, claimNodeName, makeSankeyTooltipFormatter } from '../../charts/sankey'
import type { SankeyLink, SankeyNode } from '../../charts/sankey'
import { MUTED, NEGATIVE, OTHER_SERIES_COLOR, PALETTE, POSITIVE } from '../../charts/theme'
import type { CategoryOut, SpendingMatrix, SpendingYearly, YearRollup } from '../../types/api'
import { formatMonth } from '../../utils/format'
import { buildMonthSlices } from '../../utils/spending'
import type { MonthSlice } from '../../utils/spending'

export interface SpendingFlowPeriod {
  /** "Jul 2026" (month mode) or "2026" (year mode) — the card title and empty-note noun. */
  label: string
  /** matrix.net_pay[i] / rollup.net_pay_total — null keeps the spec's enter-net-pay note. */
  netPay: string | null
  slices: MonthSlice[]
}

/**
 * The yearly fold, mirroring buildMonthSlices' rules over the rollup shape: same topIds
 * order = same palette slot per category, positive-only values (a link cannot be
 * negative, exactly the pie's constraint), remainder folded into gray "Other".
 */
export function buildYearSlices(
  categories: CategoryOut[],
  rollup: YearRollup,
  topIds: number[],
): MonthSlice[] {
  const nameById = new Map(categories.map((c) => [c.id, c.name]))
  const totalById = new Map(rollup.by_category.map((c) => [c.category_id, c.total]))
  const slices: MonthSlice[] = []
  topIds.forEach((id, slot) => {
    const value = Number(totalById.get(id) ?? 0)
    if (Number.isFinite(value) && value > 0) {
      slices.push({ name: nameById.get(id) ?? String(id), value, slot })
    }
  })
  const topSet = new Set(topIds)
  const other = rollup.by_category.reduce((acc, cell) => {
    if (topSet.has(cell.category_id)) return acc
    const value = Number(cell.total)
    return Number.isFinite(value) && value > 0 ? acc + value : acc
  }, 0)
  if (other > 0) slices.push({ name: 'Other', value: other, slot: null })
  return slices
}

/**
 * The flow card's datasource for one render: the month column, or that month's year from
 * the rollup. `monthIndex` is the month being LOOKED AT (the movers' rule: the drilled
 * month while the pie is open, the latest month otherwise) — year mode follows it, so
 * drilling an old December and toggling Year answers about THAT year.
 */
export function spendingFlowPeriod(
  matrix: SpendingMatrix | null,
  yearly: SpendingYearly | null,
  topIds: number[],
  monthIndex: number,
  mode: 'month' | 'year',
): SpendingFlowPeriod | null {
  if (matrix === null || monthIndex < 0 || monthIndex >= matrix.months.length) return null
  const month = matrix.months[monthIndex]
  if (mode === 'month') {
    return {
      label: formatMonth(month),
      netPay: matrix.net_pay[monthIndex],
      slices: buildMonthSlices(matrix, topIds, monthIndex),
    }
  }
  const year = Number(month.slice(0, 4))
  const rollup = yearly?.years.find((y) => y.year === year)
  if (rollup === undefined) return null
  return {
    label: String(rollup.year),
    netPay: rollup.net_pay_total,
    slices: buildYearSlices(matrix.categories, rollup, topIds),
  }
}

// Fixed node names. Sankey nodes key on NAME, and a user category spelling one of these
// is NOT a benign merge: 'Net pay' is a self-loop (the DAG throw) and 'Saved'/'Drawdown'
// duplicate a node, which echarts 6 drops and then crashes wiring (the 2026-08-25
// Overview money-flow incident, same engine path). Slice names are claimed through
// claimNodeName below, so collisions draw under a visible ' (spending)' suffix instead.
const NET_PAY = 'Net pay'
const SAVED = 'Saved'
const DRAWDOWN = 'Drawdown'

// Cent arithmetic on display floats: Saved/Drawdown are DERIVED figures, and float dust
// (6000 − 2580.0000000000005) must neither invent a node nor leak into a tooltip.
const A_CENT = 0.005
const cents = (value: number) => Math.round(value * 100) / 100

/**
 * "Where {period} went": Net pay fans out into the period's categories, and what is left
 * lands on a green Saved node. A deficit period adds a red Drawdown source instead —
 * links cannot be negative — with every category link split pro-rata between the two
 * sources: money is fungible, and a greedy fill that named WHICH categories the drawdown
 * funded would fabricate causality. Null = nothing drawable; the page picks the
 * empty-note sentence (netPay missing vs a genuinely empty period).
 *
 * `spent` is the DRAWN links' sum (the positive fold), so inflow always equals outflow —
 * a sankey that leaks reads as a bug. Refund cells are excluded by the fold, which
 * restates spending GROSS: matrix.totals nets refunds in, so Saved here can sit a
 * refund's width below net_pay − totals. The drill-in pie documents the same divergence
 * (buildMonthSlices' comment).
 */
export function spendingSankeyOption(period: SpendingFlowPeriod): EChartsOption | null {
  const netPay = period.netPay === null ? null : Number(period.netPay)
  // No net pay — or an unusable one (a negative period cannot source a flow) — is the
  // page's empty-note, never a blank canvas (spec §2).
  if (netPay === null || !Number.isFinite(netPay) || netPay < 0) return null
  // Claim every slice name against the structural nodes (see the constants above): the
  // fold's own 'Other' entry claims through the same set in emission order, so a real
  // category named 'Other' keeps its name and the fold wears the suffix.
  const taken = new Set([NET_PAY, SAVED, DRAWDOWN])
  const slices = period.slices.map((slice) => ({
    ...slice,
    name: claimNodeName(slice.name, taken),
  }))
  const spent = cents(slices.reduce((acc, slice) => acc + slice.value, 0))
  const saved = cents(netPay - spent)
  const shortfall = cents(spent - netPay)
  const deficit = shortfall >= A_CENT

  // Node order is render order (SANKEY_MARKS.layoutIterations 0): sources first, then
  // categories biggest-first (the slices' own order), Saved at the bottom.
  const nodes: SankeyNode[] = []
  // MUTED-family neutral: the node restates income, it is not a destination (spec §3).
  if (netPay >= A_CENT) {
    nodes.push({ name: NET_PAY, value: netPay, itemStyle: { color: MUTED } })
  }
  if (deficit) {
    nodes.push({ name: DRAWDOWN, value: shortfall, itemStyle: { color: NEGATIVE } })
  }
  for (const slice of slices) {
    nodes.push({
      name: slice.name,
      value: slice.value,
      // The stacked chart's exact assignment, reused: slot i = PALETTE[i]; the folded
      // remainder wears the gray Other color.
      itemStyle: { color: slice.slot === null ? OTHER_SERIES_COLOR : PALETTE[slice.slot] },
    })
  }

  const links: SankeyLink[] = []
  if (deficit) {
    // Saved is omitted (spec §3). Sub-cent slivers are dropped on BOTH legs — a
    // zero-width link is tooltip noise (the vesting-tooltip lesson).
    for (const slice of slices) {
      const fromNet = spent > 0 ? cents((slice.value * netPay) / spent) : 0
      const fromDrawdown = cents(slice.value - fromNet)
      if (fromNet >= A_CENT) {
        links.push({ source: NET_PAY, target: slice.name, value: fromNet })
      }
      if (fromDrawdown >= A_CENT) {
        links.push({ source: DRAWDOWN, target: slice.name, value: fromDrawdown })
      }
    }
  } else {
    for (const slice of slices) {
      links.push({ source: NET_PAY, target: slice.name, value: slice.value })
    }
    // Saved wears POSITIVE green — the one deliberate exception to the reserved-status-
    // color rule, one node per chart: "the kept money is green" is the cross-chart
    // convention (§3/§4). An exactly-zero Saved is OMITTED, not drawn at zero width.
    if (saved >= A_CENT) {
      nodes.push({ name: SAVED, value: saved, itemStyle: { color: POSITIVE } })
      links.push({ source: NET_PAY, target: SAVED, value: saved })
    }
  }
  if (links.length === 0) return null

  return {
    tooltip: { trigger: 'item', formatter: makeSankeyTooltipFormatter(nodes, links) },
    series: [{ ...SANKEY_MARKS, data: nodes, links }],
  }
}
