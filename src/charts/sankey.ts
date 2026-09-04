// The sankey posture both flow charts wear (2026-08-24 spec §2), pinned once so the
// /spending and /paycheck sankeys can never drift apart. Pure module: no React, no
// fetching (the *ChartOptions law) — the option builders under src/components/ spread
// SANKEY_MARKS into their series and hand their OWN nodes/links to the tooltip factory.
import type { SankeySeriesOption } from 'echarts/charts'
import type { ExportTable } from '../utils/download'
import { escapeHtml, formatCurrency } from '../utils/format'
import { MOTION } from './motion'
import { INK } from './theme'
import { brandTooltip } from './tooltip'

// The node/link vocabulary the builders emit. `value` on a node is the PAGE's own
// displayed figure for that entity (the table line / matrix cell), never a link sum —
// echarts sizes nodes from links regardless, but the tooltip must echo the page.
export interface SankeyNode {
  name: string
  value: number
  /** Explicit column; omit to follow links. Pin every terminal to the column right
   * after the stage it leaves (adjacent-only links, the money-flow grammar) — NEVER
   * right-align sinks across columns: with layoutIterations 0 below, a column whose only
   * node is a lone intermediate sits flush at y=0, and a column-spanning ribbon draws
   * straight across it (the paycheck chart's 2026-08-28 "mangled" report; probe in
   * scratchpad/paycheck-sankey-probe/). */
  depth?: number
  /** Node fill, plus the optional dashed hairline that marks a node the chart is
   *  ESTIMATING rather than reporting (the money-flow's unentered take-home). Every colour
   *  here is still a theme token — conformance walks these keys. SANKEY_MARKS sets
   *  `borderWidth: 0` for the series, so only a node that asks gets a border. */
  itemStyle: {
    color: string
    borderColor?: string
    borderWidth?: number
    borderType?: 'dashed'
  }
}

export interface SankeyLink {
  source: string
  target: string
  value: number
}

/**
 * Claim a node name in a sankey's name-keyed node space, renaming on collision.
 *
 * echarts keys sankey nodes on NAME, and a duplicate is NOT a merge: echarts 6 drops the
 * second node ("Graph nodes have duplicate name or id") and then throws wiring its links
 * (TypeError: Cannot set properties of undefined (setting 'dataIndex')) from inside
 * setOption — where the route boundary catches it by blanking the whole page (the
 * 2026-08-25 Overview incident: a real spending category named 'Taxes'). A user name
 * matching an UPSTREAM node would instead close a cycle ("Sankey is a DAG..."), the same
 * crash by another door. So builders seed `taken` with their structural node names and
 * pass every user-text name through here: collisions wear a visible ' (spending)' suffix
 * — both flow charts' user column is spending — and every claim registers, so the
 * invariant is total: no two nodes ever share a name.
 */
export function claimNodeName(name: string, taken: Set<string>): string {
  let candidate = name
  if (taken.has(candidate)) candidate = `${name} (spending)`
  let n = 2
  while (taken.has(candidate)) candidate = `${name} (spending ${n++})`
  taken.add(candidate)
  return candidate
}

export const SANKEY_MARKS: SankeySeriesOption = {
  type: 'sankey',
  // Restated on the series because a sankey's own defaultOption out-ranks the theme's top-level
  // clock; buildTheme's per-type block covers a sankey built without these marks, which are
  // what both flow builders actually spread.
  ...MOTION,
  orient: 'horizontal',
  nodeWidth: 12,
  // 14, raised from the spec's original 8 (2026-08-25): adjacent label CENTERS sit at
  // least one nodeGap apart (worst case: two near-zero nodes, e.g. per-check Dental &
  // vision beside HSA), so a gap wider than the 12px label is the only thing that stops
  // labels printing over each other. echarts' labelLayout/moveOverlap does NOT apply to
  // sankey labels (verified by a full-bundle probe, not just the tree-shaken build) —
  // geometry is the fix, not a feature flag.
  nodeGap: 14,
  draggable: false,
  // 0 iterations = vertical node order IS data order (echarts' documented escape hatch
  // from its crossing-minimizer). Both builders emit a meaningful order — biggest-first
  // on /spending, the waterfall's own order on /paycheck — and a solver reshuffle would
  // trade that meaning for a crossing or two.
  layoutIterations: 0,
  // No node borders (minimal-theme posture); 2px radius per spec §2.
  itemStyle: { borderWidth: 0, borderRadius: 2 },
  // Links wear the SOURCE node's color, flat at 0.3 opacity — no gradients (spec §2).
  lineStyle: { color: 'source', opacity: 0.3 },
  // Hovering a node lights its flows.
  emphasis: { focus: 'adjacency' },
  // Entity name only, in INK: text wears text tokens, never values-in-series-color.
  // Amounts live in the tooltip.
  label: { color: INK },
}

// The IDENTITY subset of echarts' item-tooltip params this module reads. Values are
// deliberately NOT read from params: a sankey node's params value can be the
// layout-derived link sum, which on /paycheck reconciliation-drifts a cent off the
// table's display-rounded lines (spec §4: the two surfaces must never disagree). The
// factory closes over the builder's own nodes/links instead, so the tooltip always
// echoes the figures the page displays, regardless of what echarts passes in.
interface SankeyTooltipParam {
  dataType?: string
  name?: string
  data?: { source?: unknown; target?: unknown }
}

export function makeSankeyTooltipFormatter(
  nodes: SankeyNode[],
  links: SankeyLink[],
): (params: unknown) => string {
  const nodeValue = new Map(nodes.map((node) => [node.name, node.value]))
  // NUL-joined key: no printable separator a node name could contain can forge it.
  const linkValue = new Map(
    links.map((link) => [`${link.source}\u0000${link.target}`, link.value]),
  )
  // Branded (charts/tooltip.ts): this factory already conforms to §7 — value first, name
  // second, escaped — so conformance accepts it alongside axisTooltip/itemTooltip.
  return brandTooltip((params: unknown): string => {
    const p = (Array.isArray(params) ? params[0] : params) as SankeyTooltipParam | null
    if (!p) return ''
    if (p.dataType === 'edge') {
      const source = typeof p.data?.source === 'string' ? p.data.source : ''
      const target = typeof p.data?.target === 'string' ? p.data.target : ''
      const value = linkValue.get(`${source}\u0000${target}`)
      if (value === undefined) return ''
      // Category names are user text — escapeHtml is mandatory in HTML tooltips.
      return `<strong>${formatCurrency(value)}</strong><br/>${escapeHtml(source)} → ${escapeHtml(target)}`
    }
    const value = nodeValue.get(p.name ?? '')
    if (value === undefined) return ''
    return `<strong>${formatCurrency(value)}</strong><br/>${escapeHtml(p.name ?? '')}`
  })
}

/** The flow as a table (F12 "sankeys (nodes + links)"): every node with the PAGE's own
 *  figure, then every link — the same figures the tooltip echoes. */
export function sankeyCsv(nodes: SankeyNode[], links: SankeyLink[]): ExportTable {
  return {
    headers: ['Kind', 'Source', 'Target', 'Value'],
    rows: [
      ...nodes.map((node) => ['node', node.name, '', node.value.toFixed(2)]),
      ...links.map((link) => ['link', link.source, link.target, link.value.toFixed(2)]),
    ],
  }
}
