// Pure option builder for the Overview annual money-flow card (2026-08-25 spec §5) — no
// React, no fetching (spendingSankeyOptions' posture). Every node value is the SERVER's
// own 2dp figure parsed once for display, and the tooltip echoes those figures verbatim
// through the shared factory — never a layout-derived link sum (the ±$0.01
// reconciliation drift the paycheck sankey documents is invisible at link-width scale).
import type { EChartsOption } from '../../charts/echarts'
import { SANKEY_MARKS, claimNodeName, makeSankeyTooltipFormatter } from '../../charts/sankey'
import type { SankeyLink, SankeyNode } from '../../charts/sankey'
import { MUTED, NEGATIVE, OTHER_SERIES_COLOR, PALETTE, POSITIVE } from '../../charts/theme'
import type { MoneyFlowOut } from '../../types/api'
import { formatCurrency } from '../../utils/format'

// Fixed node names. Sankey nodes key on NAME, so a user category spelling one of these
// exactly would either duplicate a node (echarts 6 drops it, then CRASHES wiring its
// links — the 2026-08-25 Overview incident, a real category named 'Taxes') or, for
// upstream names, close a cycle (the "Sankey is a DAG" throw). Every category name is
// therefore claimed through claimNodeName against these constants — a colliding category
// draws under a visible ' (spending)' suffix instead of taking the route down.
const GROSS = 'Gross income'
const TAXES = 'Taxes'
const PRE_TAX = 'Pre-tax savings'
const RETAINED = 'Retained equity & other'
const TAKE_HOME = 'Take-home cash'
const SAVED = 'Saved'
const DRAWDOWN = 'Drawdown'
const OTHER_SPEND = 'Other'

// The five sources in the spec's own order, on FIXED PALETTE slots per ENTITY (the
// paycheck sankey's grammar): an omitted zero source never reshuffles its neighbours'
// hues. Categories reuse slots 0..6 on the far right — a deliberate repetition: left is
// income identity, right is the /spending pages' own category slots (same entity, same
// hue as the stacked bars), and the MUTED intermediates keep the columns apart.
const SOURCES: {
  key: keyof MoneyFlowOut['sources']
  label: string
  color: string
}[] = [
  { key: 'salary_and_bonus', label: 'Salary & bonus', color: PALETTE[0] },
  { key: 'rsu_vests', label: 'RSU vests', color: PALETTE[1] },
  { key: 'espp', label: 'ESPP', color: PALETTE[2] },
  { key: 'investment_income', label: 'Investment income', color: PALETTE[3] },
  { key: 'other_income', label: 'Other income', color: PALETTE[4] },
]

// The claim seed: every structural node this builder can emit, seeded UNCONDITIONALLY
// (a zero-omitted source or a surplus year's absent Drawdown must not change how a
// colliding category renders from one year to the next). OTHER_SPEND is deliberately NOT
// seeded — the fold entry claims through the same set in emission order, so a real
// category named 'Other' keeps its name and the fold wears the suffix.
const STRUCTURAL_NAMES = [
  GROSS,
  TAXES,
  PRE_TAX,
  RETAINED,
  TAKE_HOME,
  SAVED,
  DRAWDOWN,
  ...SOURCES.map((source) => source.label),
]

// The Taxes tooltip's six jurisdiction lines, in the engine's own order (tax_keys).
const JURISDICTION_LINES: { key: keyof MoneyFlowOut['taxes']; label: string }[] = [
  { key: 'federal', label: 'Federal' },
  { key: 'state', label: 'State' },
  { key: 'medicare', label: 'Medicare' },
  { key: 'social_security', label: 'Social Security' },
  { key: 'disability', label: 'Disability' },
  { key: 'capital_gains', label: 'Capital gains' },
]

// Cent arithmetic on display floats (the spending sankey's constants): float dust must
// neither invent a node nor leak into a link, and sub-cent slivers are dropped — a
// zero-width link is tooltip noise (the vesting-tooltip lesson).
const A_CENT = 0.005
const cents = (value: number) => Math.round(value * 100) / 100

/**
 * "Where the year's money went", 4 pinned columns (spec §5): sources → Gross income →
 * {Taxes, Pre-tax savings, Retained equity & other, Take-home cash} → categories +
 * Saved/Drawdown. layoutIterations 0 makes data order the vertical order, so nodes are
 * emitted column by column, biggest-first where the server sorted them. Null = the card
 * renders the payload's reason (or its generic note) instead of a chart.
 */
export function moneyFlowOption(flow: MoneyFlowOut): EChartsOption | null {
  if (!flow.renderable) return null
  // Negative backstop (the paycheck sankey's refusal): the server refuses these itself,
  // but a negative ribbon must never be drawable from a payload that slipped through.
  // `saved` is exempt — it is signed by design and drawn as Drawdown below.
  const structural = [
    flow.gross_income,
    flow.taxes.total,
    flow.pre_tax_savings,
    flow.take_home_cash,
    flow.retained_equity,
    ...SOURCES.map((source) => flow.sources[source.key]),
    ...flow.categories.map((category) => category.amount),
    ...(flow.other_spend === null ? [] : [flow.other_spend]),
  ].map(Number)
  if (structural.some((value) => !Number.isFinite(value) || value < 0)) return null

  // The name-claim set (see STRUCTURAL_NAMES): category names pass through claimNodeName
  // so no node name can ever duplicate or cycle — echarts crashes on both, from inside
  // setOption, where the route boundary would blank the WHOLE Overview.
  const taken = new Set(STRUCTURAL_NAMES)

  const nodes: SankeyNode[] = []
  const links: SankeyLink[] = []

  for (const source of SOURCES) {
    const value = Number(flow.sources[source.key])
    if (value < A_CENT) continue
    nodes.push({ name: source.label, value, depth: 0, itemStyle: { color: source.color } })
    links.push({ source: source.label, target: GROSS, value })
  }
  const gross = Number(flow.gross_income)
  if (links.length === 0 || gross < A_CENT) return null
  nodes.push({ name: GROSS, value: gross, depth: 1, itemStyle: { color: MUTED } })

  // The middle column: three terminals on fixed slots, Take-home MUTED because it is
  // the second intermediate (money still in transit toward the spend fan).
  const mid: [string, number, string][] = [
    [TAXES, Number(flow.taxes.total), PALETTE[7]],
    [PRE_TAX, Number(flow.pre_tax_savings), PALETTE[5]],
    [RETAINED, Number(flow.retained_equity), PALETTE[6]],
    [TAKE_HOME, Number(flow.take_home_cash), MUTED],
  ]
  for (const [name, value, color] of mid) {
    if (value < A_CENT) continue
    nodes.push({ name, value, depth: 2, itemStyle: { color } })
    links.push({ source: GROSS, target: name, value })
  }

  // Take-home fans into the year's categories with the spending sankey's exact
  // Saved/Drawdown semantics: surplus → green Saved; deficit → a red Drawdown source
  // beside Take-home, every category split pro-rata between the two — money is
  // fungible, and naming WHICH categories the drawdown funded would fabricate
  // causality.
  const takeHome = Number(flow.take_home_cash)
  const spent = Number(flow.total_spend)
  const saved = Number(flow.saved)
  const deficit = saved <= -A_CENT
  if (deficit) {
    nodes.push({
      name: DRAWDOWN,
      value: cents(-saved),
      depth: 2,
      itemStyle: { color: NEGATIVE },
    })
  }
  const slices = [
    ...flow.categories.map((category, slot) => ({
      // Slot i = PALETTE[i], the /spending fold's exact assignment (biggest-first). The
      // server pins the fold at 7 (TOP_N_CATEGORIES, tested backend-side), so slots 0..6
      // always land inside the 8-slot palette; the folded remainder wears gray Other.
      name: claimNodeName(category.name, taken),
      value: Number(category.amount),
      color: PALETTE[slot],
    })),
    ...(flow.other_spend === null
      ? []
      : [
          {
            name: claimNodeName(OTHER_SPEND, taken),
            value: Number(flow.other_spend),
            color: OTHER_SERIES_COLOR,
          },
        ]),
  ]
  for (const slice of slices) {
    if (slice.value < A_CENT) continue
    nodes.push({
      name: slice.name,
      value: slice.value,
      depth: 3,
      itemStyle: { color: slice.color },
    })
    if (deficit) {
      const fromTakeHome = spent > 0 ? cents((slice.value * takeHome) / spent) : 0
      const fromDrawdown = cents(slice.value - fromTakeHome)
      if (fromTakeHome >= A_CENT) {
        links.push({ source: TAKE_HOME, target: slice.name, value: fromTakeHome })
      }
      if (fromDrawdown >= A_CENT) {
        links.push({ source: DRAWDOWN, target: slice.name, value: fromDrawdown })
      }
    } else {
      links.push({ source: TAKE_HOME, target: slice.name, value: slice.value })
    }
  }
  if (!deficit && saved >= A_CENT) {
    nodes.push({ name: SAVED, value: saved, depth: 3, itemStyle: { color: POSITIVE } })
    links.push({ source: TAKE_HOME, target: SAVED, value: saved })
  }

  // The Taxes node alone gets an extended tooltip (spec §5: the six jurisdictions,
  // server figures verbatim); everything else delegates to the shared factory so node
  // values can never drift from the page's figures. Labels here are fixed constants —
  // no user text, nothing to escape.
  const base = makeSankeyTooltipFormatter(nodes, links)
  const taxLines = JURISDICTION_LINES.map(
    (line) => `${line.label} ${formatCurrency(flow.taxes[line.key])}`,
  ).join('<br/>')
  const formatter = (params: unknown): string => {
    const p = (Array.isArray(params) ? params[0] : params) as {
      dataType?: string
      name?: string
    } | null
    if (p && p.dataType !== 'edge' && p.name === TAXES) {
      return `<strong>${formatCurrency(flow.taxes.total)}</strong><br/>${TAXES}<br/>${taxLines}`
    }
    return base(params)
  }

  return {
    tooltip: { trigger: 'item', formatter },
    series: [{ ...SANKEY_MARKS, data: nodes, links }],
  }
}
