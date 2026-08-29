// Pure option builder for the /paycheck flow card (2026-08-24 spec §4) — no React, no
// fetching. It draws the SAME display-rounded strings the waterfall table shows
// (paycheck_calc's rule: net is authoritative, lines are display-rounded) — never
// re-derived from full precision, so the two surfaces can never disagree. The ±$0.01
// reconciliation drift between a node's table figure and its links' sum is invisible at
// link-width scale; the tooltip reads the table figure (charts/sankey.ts factory).
import type { EChartsOption } from '../../charts/echarts'
import { SANKEY_MARKS, makeSankeyTooltipFormatter } from '../../charts/sankey'
import type { SankeyLink, SankeyNode } from '../../charts/sankey'
import { MUTED, PALETTE, POSITIVE } from '../../charts/theme'
import type { PaycheckBreakdownOut } from '../../types/api'

type FlowKey = Exclude<keyof PaycheckBreakdownOut, 'profile' | 'warnings' | 'monthly_net'>

// The eleven lines in the table's own order and vocabulary (PaycheckPage's WATERFALL).
// depth pins the column: intermediates restate money in transit at 0/1/2; every terminal
// sits at its NATURAL column — the one right after the stage it leaves — so every link
// connects adjacent columns (spec §4, revised 2026-08-28). The original "all terminals
// right-aligned at depth 3" pin let links span columns, and with SANKEY_MARKS'
// layoutIterations:0 each lone intermediate (Taxable, Post-tax) sits flush at y=0, so
// the spanning Gross→401(k)/Dental/HSA ribbons drew straight across those bars —
// probe-verified overlap, user-revoked. Adjacent-only links are the money-flow sankey's
// grammar and can never cross a node. Colors: intermediates MUTED (restatements, not
// destinations — Gross included); terminals on FIXED PALETTE slots in waterfall order,
// fixed per ENTITY so an omitted zero branch never reshuffles its neighbours' hues;
// Net pay POSITIVE green (§3's kept-money-is-green cross-chart convention).
const FLOW_NODES: { key: FlowKey; label: string; depth: 0 | 1 | 2 | 3; color: string }[] = [
  { key: 'gross', label: 'Gross', depth: 0, color: MUTED },
  { key: 'taxable', label: 'Taxable', depth: 1, color: MUTED },
  { key: 'post_tax', label: 'Post-tax', depth: 2, color: MUTED },
  { key: 'trad_401k', label: 'Traditional 401(k)', depth: 1, color: PALETTE[0] },
  { key: 'dental_vision', label: 'Dental & vision', depth: 1, color: PALETTE[1] },
  { key: 'hsa', label: 'HSA', depth: 1, color: PALETTE[2] },
  { key: 'withholding', label: 'Withholding', depth: 2, color: PALETTE[3] },
  { key: 'roth_401k', label: 'Roth 401(k)', depth: 3, color: PALETTE[4] },
  { key: 'after_tax_401k', label: 'After-tax 401(k)', depth: 3, color: PALETTE[5] },
  { key: 'espp', label: 'ESPP', depth: 3, color: PALETTE[6] },
  { key: 'net_pay', label: 'Net pay', depth: 3, color: POSITIVE },
]

const LABELS = new Map<FlowKey, string>(FLOW_NODES.map((node) => [node.key, node.label]))

// Each link carries its TARGET's table figure: gross splits into the pre-tax lines and
// taxable; taxable into withholding and post-tax; post-tax into the post-tax lines and
// net pay (spec §4's table).
const FLOW_LINKS: { source: FlowKey; target: FlowKey }[] = [
  { source: 'gross', target: 'trad_401k' },
  { source: 'gross', target: 'dental_vision' },
  { source: 'gross', target: 'hsa' },
  { source: 'gross', target: 'taxable' },
  { source: 'taxable', target: 'withholding' },
  { source: 'taxable', target: 'post_tax' },
  { source: 'post_tax', target: 'roth_401k' },
  { source: 'post_tax', target: 'after_tax_401k' },
  { source: 'post_tax', target: 'espp' },
  { source: 'post_tax', target: 'net_pay' },
]

export function paycheckSankeyOption(data: PaycheckBreakdownOut): EChartsOption | null {
  const values = new Map<FlowKey, number>()
  for (const node of FLOW_NODES) {
    const value = Number(data[node.key])
    // Negative guard (spec §4): net_pay — and in pathological profiles taxable /
    // post_tax — is genuinely negative-capable, and a sankey cannot draw a negative
    // flow. Null here = the page's empty-note; the table remains the always-correct
    // surface.
    if (!Number.isFinite(value) || value < 0) return null
    values.set(node.key, value)
  }
  // Zero branches are OMITTED, not drawn at zero width (the vesting-tooltip lesson): a
  // link exists only when its target line is positive, a node only when a link touches
  // it — so a zeroed intermediate takes its whole downstream out with it.
  const links: SankeyLink[] = []
  const linked = new Set<FlowKey>()
  for (const { source, target } of FLOW_LINKS) {
    const value = values.get(target) ?? 0
    if (value > 0) {
      links.push({
        source: LABELS.get(source) ?? source,
        target: LABELS.get(target) ?? target,
        value,
      })
      linked.add(source)
      linked.add(target)
    }
  }
  // Only an all-zero check lands here — same empty-note as the guard.
  if (links.length === 0) return null
  const nodes: SankeyNode[] = FLOW_NODES.filter((node) => linked.has(node.key)).map((node) => ({
    name: node.label,
    // The table's own display-rounded figure rides the node; the tooltip factory closes
    // over it, so a node can never show the link sum that drifts a cent off the table.
    value: values.get(node.key) ?? 0,
    depth: node.depth,
    itemStyle: { color: node.color },
  }))
  return {
    tooltip: { trigger: 'item', formatter: makeSankeyTooltipFormatter(nodes, links) },
    series: [{ ...SANKEY_MARKS, data: nodes, links }],
  }
}
