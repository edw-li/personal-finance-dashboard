// Pure option builder for the Overview annual money-flow card (2026-08-25 spec §5) — no
// React, no fetching (spendingSankeyOptions' posture). Every node value is the SERVER's
// own 2dp figure parsed once for display, and the tooltip echoes those figures verbatim
// through the shared factory — never a layout-derived link sum (the ±$0.01
// reconciliation drift the paycheck sankey documents is invisible at link-width scale).
//
// ONE WINDOW ON THE RIGHT (2026-09-23 spec §C1): income, taxes and the middle column are the
// full year; the spending fan and Saved cover only the MATCHED months (take-home and spending
// both entered), so Saved is the Overview YTD card's cash saved. Take-home of months with no
// spending ends on a named terminal; take-home of months nobody entered is the named estimate.
//
// COLOURS (spec §C2) come from charts/entities.ts: income entities on their registry hues,
// the tax hue, the kept greens, the structural grey for everything that is money in transit
// or a residual, and every spending category on the SPENDING PAGE'S fold — the same colour
// it wears on the bars — whatever this year's own ranking says.
import type { EChartsOption } from '../../charts/echarts'
import { ENTITY, SALARY_TINTS, foldCategories, foldColor } from '../../charts/entities'
import type { CategoryFold } from '../../charts/entities'
import { DEFICIT_DECAL, fanCents } from '../../charts/grammar'
import { monthOrdinal as ordinal, monthRuns, monthWords, runWords } from '../../charts/windowWords'
import { SANKEY_MARKS, claimNodeName, makeSankeyTooltipFormatter, sankeyCsv } from '../../charts/sankey'
import type { SankeyLink, SankeyNode } from '../../charts/sankey'
import { brandTooltip } from '../../charts/tooltip'
import type { MoneyFlowCategoryTotal, MoneyFlowOut } from '../../types/api'
import { toCents } from '../../utils/cents'
import type { ExportTable } from '../../utils/download'
import { escapeHtml, formatCurrency, formatMonth } from '../../utils/format'

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
const REFUNDS = 'Refunds & credits'
const SAVED = 'Saved'
const DRAWDOWN = 'Drawdown'
const OTHER_SPEND = 'Other'

// The salary node's two spellings. One earner keeps the label the card has always drawn;
// a split names each earner (spec §4.3), and `people.name` is UNIQUE in the database, so
// two source nodes can never collide with each other.
const SALARY = 'Salary & bonus'
const SALARY_PREFIX = 'Salary — '

// The four FIXED sources on their registry ENTITY colours: an omitted zero source never
// reshuffles its neighbours' hues. Salary is not here because it is one node or many; it is
// always emitted FIRST, on the salary hue family (SALARY_TINTS).
const SOURCES: {
  key: keyof Omit<MoneyFlowOut['sources'], 'salary_and_bonus' | 'salary_people'>
  label: string
  color: string
}[] = [
  { key: 'rsu_vests', label: 'RSU vests', color: ENTITY.rsu },
  { key: 'espp', label: 'ESPP', color: ENTITY.espp },
  { key: 'investment_income', label: 'Investment income', color: ENTITY.investmentIncome },
  // The BALANCING remainder of income (gross minus the named four): the Other gray.
  { key: 'other_income', label: 'Other income', color: ENTITY.otherIncome },
]

// The claim seed: every structural node this builder can emit, seeded UNCONDITIONALLY
// (a zero-omitted source or a surplus year's absent Drawdown must not change how a
// colliding category renders from one year to the next). OTHER_SPEND is deliberately NOT
// seeded — the fold entry claims through the same set in emission order, so a real
// category named 'Other' keeps its name and the fold wears the suffix. The SPLIT labels and
// the month-named estimate/terminal labels are dynamic and join the set per payload below.
const STRUCTURAL_NAMES = [
  GROSS,
  TAXES,
  PRE_TAX,
  RETAINED,
  TAKE_HOME,
  REFUNDS,
  SAVED,
  DRAWDOWN,
  SALARY,
  ...SOURCES.map((source) => source.label),
]

/** The depth-0 salary node(s): one per earner on a split payload, else the single node. */
function salaryNodes(flow: MoneyFlowOut): { label: string; value: number; color: string }[] {
  const people = flow.sources.salary_people
  if (people.length < 2) {
    return [{ label: SALARY, value: Number(flow.sources.salary_and_bonus), color: ENTITY.salary }]
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

// --- the window's words (charts/windowWords.ts, shared with the Spending "Where … went" year;
// re-exported for the card's lede/footer and for tests) ------------------------------------

export { monthRuns, monthWords, runWords }
const firstOfMonth = (iso: string) => `${iso.slice(0, 7)}-01`

/** The estimate node's name (spec §C1): "Est. take-home, Sep–Dec" · "Est. take-home, Jan–Jul
 *  (before tracking)" — a run that ends before the book's first take-home month predates the
 *  book, so it is not "not entered" (nobody could have entered it). */
export function estimateNodeName(pending: readonly string[], trackingStart: string | null): string {
  const parts = monthRuns(pending).map(
    (run) =>
      `${runWords(run)}${trackingStart !== null && run[run.length - 1] < trackingStart ? ' (before tracking)' : ''}`,
  )
  return `Est. take-home, ${parts.join(', ')}`
}

type Nature = 'before' | 'current' | 'future' | 'missing'

/** Why each pending month has no take-home, grouped by run and nature. `todayIso` null = no
 *  clock: nothing is called unearned. */
export function estimateSentence(
  pending: readonly string[],
  trackingStart: string | null,
  todayIso: string | null,
): string {
  const current = todayIso === null ? null : firstOfMonth(todayIso)
  const natureOf = (month: string): Nature =>
    trackingStart !== null && month < trackingStart
      ? 'before'
      : current !== null && month === current
        ? 'current'
        : current !== null && month > current
          ? 'future'
          : 'missing'
  const groups: { nature: Nature; months: string[] }[] = []
  for (const run of monthRuns(pending)) {
    for (const month of run) {
      const nature = natureOf(month)
      const last = groups[groups.length - 1]
      const lastMonth = last?.months[last.months.length - 1]
      if (last !== undefined && last.nature === nature && lastMonth !== undefined && ordinal(month) === ordinal(lastMonth) + 1) {
        last.months.push(month)
      } else {
        groups.push({ nature, months: [month] })
      }
    }
  }
  return groups
    .map(({ nature, months }) => {
      const words = runWords(months)
      const plural = months.length > 1
      if (nature === 'before') {
        return `${words} predate tracking (it began ${trackingStart === null ? '' : formatMonth(trackingStart)})`
      }
      if (nature === 'current') return `${words} is still in progress`
      if (nature === 'future') return `${words} ${plural ? 'are' : 'is'} not earned yet`
      return `${words} ${plural ? 'have' : 'has'} no take-home entered`
    })
    .join('; ')
}

/** The pay-without-spending terminal: "Take-home, spending not entered (Feb–Mar)". */
export function unmatchedNodeName(months: readonly string[]): string {
  return `Take-home, spending not entered (${monthWords(months)})`
}

// --- the right-hand side -----------------------------------------------------------------

interface Slice {
  name: string
  value: number
  color: string
}

/** The fan's category slices: the fold's categories in fold order (positive totals only — a
 *  link cannot be negative; net refunds come back through the Refunds node), then the Other
 *  bucket of everything outside the fold. A payload from before the window carries no
 *  per-category totals: its own top-7 fold stands in, with `other_spend` added to Other. */
function fanSlices(flow: MoneyFlowOut, fold: CategoryFold | null, taken: Set<string>): Slice[] {
  const totals: MoneyFlowCategoryTotal[] =
    flow.category_totals ??
    flow.categories.map((category, index) => ({
      category_id: -(index + 1),
      name: category.name,
      kind: 'living',
      amount: category.amount,
    }))
  const byId = new Map(totals.map((total, index) => [total.category_id ?? -(index + 1), total]))
  // Without the Spending page's fold (it loads beside this card), fold by the payload's own
  // ranking through the SAME function — biggest cents first, ties by name.
  const effective =
    fold ??
    foldCategories(
      [...byId.entries()]
        .map(([id, total]) => ({ id, kind: total.kind, totalCents: toCents(total.amount), name: total.name }))
        .sort((a, b) => b.totalCents - a.totalCents || a.name.localeCompare(b.name)),
    )
  const slices: Slice[] = []
  const inFold = new Set<number>()
  for (const id of effective.ids) {
    const total = byId.get(id)
    if (total === undefined) continue
    inFold.add(id)
    const value = Number(total.amount)
    if (!(value >= A_CENT)) continue
    slices.push({ name: claimNodeName(total.name, taken), value, color: foldColor(effective, id) })
  }
  let other = flow.category_totals === undefined && flow.other_spend !== null ? Number(flow.other_spend) : 0
  for (const [id, total] of byId) {
    if (inFold.has(id)) continue
    const value = Number(total.amount)
    if (value > 0) other += value
  }
  other = cents(other)
  if (other >= A_CENT) slices.push({ name: claimNodeName(OTHER_SPEND, taken), value: other, color: ENTITY.other })
  return slices
}

export interface MoneyFlowOptions {
  /** The Spending page's category fold (charts/entities.ts categoryFold over the matrix);
   *  null = fold by the payload's own ranking. */
  fold?: CategoryFold | null
  /** The page's today, for the estimate's tooltip (in progress vs not yet earned). */
  todayIso?: string | null
}

/**
 * "Where the year's money went", 4 pinned columns (spec §5): sources → Gross income →
 * {Taxes, Pre-tax savings, Retained equity & other, Take-home cash, the estimate} → the
 * matched months' categories + Saved/Drawdown (+ the pay-without-spending terminal).
 * layoutIterations 0 makes data order the vertical order, so nodes are emitted column by
 * column. Null = the card renders the payload's reason (or its generic note) instead.
 */
export function moneyFlowOption(
  flow: MoneyFlowOut,
  { fold = null, todayIso = null }: MoneyFlowOptions = {},
): EChartsOption | null {
  if (!flow.renderable) return null
  const salary = salaryNodes(flow)
  const takeHome = Number(flow.take_home_cash)
  const saved = Number(flow.saved)
  // The fan's funding (spec §C1): the matched months' take-home. A payload from before the
  // window matched every entered month.
  const matched = Number(flow.take_home_matched ?? flow.take_home_cash)
  const refunds = Number(flow.refunds ?? '0')
  const unmatched = Number(flow.take_home_unmatched ?? '0')
  // Negative backstop (the paycheck sankey's refusal): the server refuses these itself,
  // but a negative ribbon must never be drawable from a payload that slipped through.
  // `saved` is exempt — it is signed by design and drawn as Drawdown below; so are the
  // category totals, whose negatives are the refunds. The salary TOTAL is checked alongside
  // the per-earner slices: the split can only reconcile to a number that is itself drawable.
  const structural = [
    flow.gross_income,
    flow.taxes.total,
    flow.pre_tax_savings,
    flow.take_home_cash,
    flow.retained_equity,
    flow.sources.salary_and_bonus,
    ...SOURCES.map((source) => flow.sources[source.key]),
    ...(flow.take_home_pending === undefined ? [] : [flow.take_home_pending]),
    ...(flow.take_home_matched === undefined ? [] : [flow.take_home_matched]),
    ...(flow.take_home_unmatched === undefined ? [] : [flow.take_home_unmatched]),
    ...(flow.refunds === undefined ? [] : [flow.refunds]),
    ...(flow.category_totals === undefined ? flow.categories.map((category) => category.amount) : []),
    ...(flow.other_spend === null ? [] : [flow.other_spend]),
  ].map(Number)
  if (structural.some((value) => !Number.isFinite(value) || value < 0)) return null
  if (salary.some((node) => !Number.isFinite(node.value) || node.value < 0)) return null
  // The fan's take-home share: what went to spending once Saved is set aside (all of it in a
  // deficit). Below zero the payload is torn — Saved claims money the window never had.
  const fromTakeHome = matched - Math.max(saved, 0)
  if (!Number.isFinite(saved) || fromTakeHome < -A_CENT) return null

  // The name-claim set (see STRUCTURAL_NAMES): category names pass through claimNodeName
  // so no node name can ever duplicate or cycle — echarts crashes on both, from inside
  // setOption, where the route boundary would blank the WHOLE Overview. The split labels
  // join the set because they carry USER TEXT on the left column: a spending category
  // spelled 'Salary — Sam' must wear the suffix, not take the node.
  const taken = new Set([...STRUCTURAL_NAMES, ...salary.map((node) => node.label)])

  const nodes: SankeyNode[] = []
  const links: SankeyLink[] = []

  const sourceNodes = [
    ...salary,
    ...SOURCES.map((source) => ({ label: source.label, value: Number(flow.sources[source.key]), color: source.color })),
  ]
  for (const source of sourceNodes) {
    if (source.value < A_CENT) continue
    nodes.push({ name: source.label, value: source.value, depth: 0, itemStyle: { color: source.color } })
    links.push({ source: source.label, target: GROSS, value: source.value })
  }
  const gross = Number(flow.gross_income)
  if (links.length === 0 || gross < A_CENT) return null
  nodes.push({ name: GROSS, value: gross, depth: 1, itemStyle: { color: ENTITY.structural } })

  // The middle column: tax on the one tax hue, pre-tax savings on the kept green, the
  // residual and take-home on the structural grey (neither is an entity of its own).
  const mid: [string, number, string][] = [
    [TAXES, Number(flow.taxes.total), ENTITY.tax],
    [PRE_TAX, Number(flow.pre_tax_savings), ENTITY.preTaxSavings],
    [RETAINED, Number(flow.retained_equity), ENTITY.structural],
    [TAKE_HOME, takeHome, ENTITY.structural],
  ]
  for (const [name, value, color] of mid) {
    if (value < A_CENT) continue
    nodes.push({ name, value, depth: 2, itemStyle: { color } })
    links.push({ source: GROSS, target: name, value })
  }

  // The take-home nobody has entered (honest-numbers spec §3, named by its months since
  // spec §C1): drawn beside take-home, muted like its neighbour (it IS take-home, just not
  // on record), dashed because it was computed rather than entered, and saying so on hover.
  const pending = Number(flow.take_home_pending ?? '0')
  const pendingMonths = flow.take_home_pending_months
  const entered = flow.take_home_months_entered ?? 12
  const missingCount = pendingMonths?.length ?? Math.max(0, 12 - entered)
  const pendingName =
    pendingMonths !== undefined && pendingMonths.length > 0
      ? estimateNodeName(pendingMonths, flow.tracking_start ?? null)
      : `Est. take-home (${missingCount} ${missingCount === 1 ? 'month' : 'months'})`
  const drawsPending = missingCount > 0 && pending >= A_CENT
  if (drawsPending) {
    // Claimed like any other name, but only when DRAWN: this label carries months, so it
    // changes from year to year — seeding it unconditionally would make a colliding
    // category's rendering depend on how much of the year is entered.
    taken.add(pendingName)
    nodes.push({
      name: pendingName,
      value: cents(pending),
      depth: 2,
      itemStyle: { color: ENTITY.structural, borderColor: ENTITY.structural, borderWidth: 1, borderType: 'dashed' },
    })
    links.push({ source: GROSS, target: pendingName, value: cents(pending) })
  }

  // Pay without spending (spec §C1): its take-home ends on a named terminal, never inside
  // Saved. Its name carries months, so it joins the claim set only when drawn, and it joins
  // BEFORE the categories are claimed: a category spelled exactly like it must wear the suffix,
  // not take the name and leave two nodes called the same (the crash class above).
  const unmatchedMonths = flow.take_home_unmatched_months ?? []
  const unmatchedName = unmatchedNodeName(unmatchedMonths)
  const drawsUnmatched = unmatched >= A_CENT && unmatchedMonths.length > 0
  if (drawsUnmatched) taken.add(unmatchedName)

  // The fan's sources beside take-home: money that came back (a net-refund category), and
  // the Drawdown a deficit window needs. Each category is split pro-rata across all three —
  // money is fungible, and naming WHICH categories a refund or a drawdown funded would
  // fabricate causality.
  const deficit = saved <= -A_CENT
  const drawsRefunds = refunds >= A_CENT
  if (drawsRefunds) nodes.push({ name: REFUNDS, value: cents(refunds), depth: 2, itemStyle: { color: ENTITY.structural } })
  // Hatched as well as red: the deficit red reads as the tax hue beside it (grammar DEFICIT_DECAL).
  if (deficit) nodes.push({ name: DRAWDOWN, value: cents(-saved), depth: 2, itemStyle: { color: ENTITY.deficit, decal: DEFICIT_DECAL } })

  const slices = fanSlices(flow, fold, taken)
  // In whole cents and exact on both sides (grammar fanCents): every source's links sum to its
  // node and every category's to its own. Take-home goes LAST, so the biggest source absorbs
  // the rounding and the small ones are apportioned by largest remainder.
  const [viaRefunds, viaDrawdown, viaTakeHome] = fanCents(
    [
      drawsRefunds ? Math.round(refunds * 100) : 0,
      deficit ? Math.round(-saved * 100) : 0,
      Math.round(Math.max(fromTakeHome, 0) * 100),
    ],
    slices.map((slice) => Math.round(slice.value * 100)),
  )
  slices.forEach((slice, j) => {
    nodes.push({ name: slice.name, value: slice.value, depth: 3, itemStyle: { color: slice.color } })
    // Sub-cent slivers never exist in whole cents; a zero share draws no link.
    if (viaTakeHome[j] > 0) links.push({ source: TAKE_HOME, target: slice.name, value: viaTakeHome[j] / 100 })
    if (viaRefunds[j] > 0) links.push({ source: REFUNDS, target: slice.name, value: viaRefunds[j] / 100 })
    if (viaDrawdown[j] > 0) links.push({ source: DRAWDOWN, target: slice.name, value: viaDrawdown[j] / 100 })
  })
  if (!deficit && saved >= A_CENT) {
    nodes.push({ name: SAVED, value: saved, depth: 3, itemStyle: { color: ENTITY.saved } })
    links.push({ source: TAKE_HOME, target: SAVED, value: saved })
  }
  if (drawsUnmatched) {
    nodes.push({ name: unmatchedName, value: cents(unmatched), depth: 3, itemStyle: { color: ENTITY.structural } })
    links.push({ source: TAKE_HOME, target: unmatchedName, value: cents(unmatched) })
  }

  // The Taxes node alone gets an extended tooltip (spec §5: the jurisdictions, server
  // figures verbatim); the estimate, the refunds and the terminal say what they are; every
  // other node delegates to the shared factory so values can never drift from the page's
  // figures. Labels are constants, digits and escaped month words — no raw user text.
  const base = makeSankeyTooltipFormatter(nodes, links)
  const taxLines = JURISDICTION_LINES.filter((line) => flow.taxes[line.key] !== undefined)
    .map((line) => `${line.label} ${formatCurrency(flow.taxes[line.key])}`)
    .join('<br/>')
  const reasons = pendingMonths === undefined ? '' : estimateSentence(pendingMonths, flow.tracking_start ?? null, todayIso)
  // Branded like the factory it wraps: this composition IS the grammar's sankey tooltip
  // with a few nodes' extended bodies, and conformance keys on the brand (chart spec §17).
  const formatter = brandTooltip((params: unknown): string => {
    const p = (Array.isArray(params) ? params[0] : params) as { dataType?: string; name?: string } | null
    const node = p !== null && p.dataType !== 'edge' ? p.name : undefined
    if (node === TAXES) {
      return `<strong>${formatCurrency(flow.taxes.total)}</strong><br/>${TAXES}<br/>${taxLines}`
    }
    if (drawsPending && node === pendingName) {
      return (
        `<strong>${formatCurrency(cents(pending))}</strong><br/>${escapeHtml(pendingName)}<br/>` +
        `Estimated: the average take-home of the ${entered} entered ` +
        `${entered === 1 ? 'month' : 'months'} × ${missingCount}.` +
        (reasons === '' ? '' : ` ${escapeHtml(reasons)}.`) +
        ' Entering them replaces the estimate.'
      )
    }
    if (drawsUnmatched && node === unmatchedName) {
      return (
        `<strong>${formatCurrency(cents(unmatched))}</strong><br/>${escapeHtml(unmatchedName)}<br/>` +
        'Take-home entered for months with no spending entered — it joins the spending fan once ' +
        'their spending is entered.'
      )
    }
    if (drawsRefunds && node === REFUNDS) {
      return (
        `<strong>${formatCurrency(cents(refunds))}</strong><br/>${REFUNDS}<br/>` +
        'Categories whose refunds outweighed their spending over these months — money that came ' +
        'back, so it helps fund the rest.'
      )
    }
    return base(params)
  })

  return {
    tooltip: { trigger: 'item', formatter },
    series: [{ ...SANKEY_MARKS, data: nodes, links }],
  }
}

/** The flow as a table (F12) — the same nodes and links the chart draws; a refused payload
 *  (or one the builder's own backstop refused) yields headers and no rows. */
export function moneyFlowCsv(flow: MoneyFlowOut, options: MoneyFlowOptions = {}): ExportTable {
  const option = moneyFlowOption(flow, options) as { series?: { data: SankeyNode[]; links: SankeyLink[] }[] } | null
  const series = option?.series?.[0]
  return series === undefined ? { headers: ['Kind', 'Source', 'Target', 'Value'], rows: [] } : sankeyCsv(series.data, series.links)
}
