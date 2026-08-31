// Pure option builder for the Overview annual money-flow card (2026-08-25 spec §5) — no
// React, no fetching (spendingSankeyOptions' posture). Every node value is the SERVER's
// own 2dp figure parsed once for display, and the tooltip echoes those figures verbatim
// through the shared factory — never a layout-derived link sum (the ±$0.01
// reconciliation drift the paycheck sankey documents is invisible at link-width scale).
import type { EChartsOption } from '../../charts/echarts'
import { SANKEY_MARKS, claimNodeName, makeSankeyTooltipFormatter } from '../../charts/sankey'
import type { SankeyLink, SankeyNode } from '../../charts/sankey'
import {
  MUTED,
  NEGATIVE,
  OTHER_SERIES_COLOR,
  PALETTE,
  POSITIVE,
  SEQUENTIAL_BLUE,
} from '../../charts/theme'
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

// The salary node's two spellings. One earner keeps the label the card has always drawn;
// a split names each earner (spec §4.3), and `people.name` is UNIQUE in the database, so
// two source nodes can never collide with each other.
const SALARY = 'Salary & bonus'
const SALARY_PREFIX = 'Salary — '

// The salary hue FAMILY, in split order. Slot 0 is PALETTE[0] verbatim — the single-node
// path and the primary earner draw the exact color they always have — and the rest are
// lightness steps of the theme's own validated ramp (SEQUENTIAL_BLUE, whose index 6 IS
// PALETTE[0]); no hue is invented here, which is charts/theme.ts's standing rule.
// #86b6ef measures L* 72.7 against PALETTE[0]'s 55.9: dE 28.5 normal, 25.1 protanope,
// 28.9 deuteranope, 15.1 tritanope — every one past the palette's own 8.4 adjacency floor
// — at 8.25:1 on the #171a21 surface. The third step covers a three-person household;
// beyond that the last tint repeats and the LABELS carry the distinction.
const SALARY_TINTS = [PALETTE[0], SEQUENTIAL_BLUE[9], SEQUENTIAL_BLUE[3]] as const

// The four FIXED sources, on FIXED PALETTE slots per ENTITY (the paycheck sankey's
// grammar): an omitted zero source never reshuffles its neighbours' hues. Salary is not
// here because it is one node or many; it is always emitted FIRST, on slot 0's family.
// Categories reuse slots 0..6 on the far right — a deliberate repetition: left is income
// identity, right is the /spending pages' own category slots (same entity, same hue as the
// stacked bars), and the MUTED intermediates keep the columns apart.
const SOURCES: {
  key: keyof Omit<MoneyFlowOut['sources'], 'salary_and_bonus' | 'salary_people'>
  label: string
  color: string
}[] = [
  { key: 'rsu_vests', label: 'RSU vests', color: PALETTE[1] },
  { key: 'espp', label: 'ESPP', color: PALETTE[2] },
  { key: 'investment_income', label: 'Investment income', color: PALETTE[3] },
  { key: 'other_income', label: 'Other income', color: PALETTE[4] },
]

// The claim seed: every structural node this builder can emit, seeded UNCONDITIONALLY
// (a zero-omitted source or a surplus year's absent Drawdown must not change how a
// colliding category renders from one year to the next). OTHER_SPEND is deliberately NOT
// seeded — the fold entry claims through the same set in emission order, so a real
// category named 'Other' keeps its name and the fold wears the suffix. The SPLIT labels
// are dynamic (they carry user text) and are added to the set per payload below.
const STRUCTURAL_NAMES = [
  GROSS,
  TAXES,
  PRE_TAX,
  RETAINED,
  TAKE_HOME,
  SAVED,
  DRAWDOWN,
  SALARY,
  ...SOURCES.map((source) => source.label),
]

/** The depth-0 salary node(s): one per earner on a split payload, else the single node. */
function salaryNodes(flow: MoneyFlowOut): { label: string; value: number; color: string }[] {
  const people = flow.sources.salary_people
  if (people.length < 2) {
    return [{ label: SALARY, value: Number(flow.sources.salary_and_bonus), color: PALETTE[0] }]
  }
  return people.map((person, index) => ({
    label: `${SALARY_PREFIX}${person.name}`,
    value: Number(person.amount),
    color: SALARY_TINTS[Math.min(index, SALARY_TINTS.length - 1)],
  }))
}

// The Taxes tooltip's per-jurisdiction lines (seven since the NIIT split), in the engine's
// own order (tax_keys).
const JURISDICTION_LINES: { key: keyof MoneyFlowOut['taxes']; label: string }[] = [
  { key: 'federal', label: 'Federal' },
  { key: 'state', label: 'State' },
  { key: 'medicare', label: 'Medicare' },
  { key: 'social_security', label: 'Social Security' },
  { key: 'disability', label: 'Disability' },
  { key: 'capital_gains', label: 'Capital gains' },
  { key: 'niit', label: 'NIIT' },
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
  const salary = salaryNodes(flow)
  // Negative backstop (the paycheck sankey's refusal): the server refuses these itself,
  // but a negative ribbon must never be drawable from a payload that slipped through.
  // `saved` is exempt — it is signed by design and drawn as Drawdown below. The salary
  // TOTAL is checked alongside the per-earner slices: the split can only reconcile to a
  // number that is itself drawable.
  const structural = [
    flow.gross_income,
    flow.taxes.total,
    flow.pre_tax_savings,
    flow.take_home_cash,
    flow.retained_equity,
    flow.sources.salary_and_bonus,
    ...SOURCES.map((source) => flow.sources[source.key]),
    ...flow.categories.map((category) => category.amount),
    ...(flow.other_spend === null ? [] : [flow.other_spend]),
  ].map(Number)
  if (structural.some((value) => !Number.isFinite(value) || value < 0)) return null
  if (salary.some((node) => !Number.isFinite(node.value) || node.value < 0)) return null

  // The name-claim set (see STRUCTURAL_NAMES): category names pass through claimNodeName
  // so no node name can ever duplicate or cycle — echarts crashes on both, from inside
  // setOption, where the route boundary would blank the WHOLE Overview. The split labels
  // join the set because they carry USER TEXT on the left column for the first time: a
  // spending category spelled 'Salary — Sam' must wear the suffix, not take the node.
  const taken = new Set([...STRUCTURAL_NAMES, ...salary.map((node) => node.label)])

  const nodes: SankeyNode[] = []
  const links: SankeyLink[] = []

  const sourceNodes = [
    ...salary,
    ...SOURCES.map((source) => ({
      label: source.label,
      value: Number(flow.sources[source.key]),
      color: source.color,
    })),
  ]
  for (const source of sourceNodes) {
    if (source.value < A_CENT) continue
    nodes.push({
      name: source.label,
      value: source.value,
      depth: 0,
      itemStyle: { color: source.color },
    })
    links.push({ source: source.label, target: GROSS, value: source.value })
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

  // The Taxes node alone gets an extended tooltip (spec §5: the jurisdictions, server
  // figures verbatim); everything else delegates to the shared factory so node values can
  // never drift from the page's figures. Labels here are fixed constants — no user text,
  // nothing to escape. `niit` is optional on the wire, so an older payload simply drops
  // its row rather than printing an empty (or NaN) one.
  const base = makeSankeyTooltipFormatter(nodes, links)
  const taxLines = JURISDICTION_LINES.filter((line) => flow.taxes[line.key] !== undefined)
    .map((line) => `${line.label} ${formatCurrency(flow.taxes[line.key])}`)
    .join('<br/>')
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
