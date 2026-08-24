# Sankey Flow Diagrams (Spending + Paycheck) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw the two flows the app already fetches — net pay fanning out into the month's (or year's) spending categories on `/spending`, and gross-to-net on `/paycheck` — as house-styled ECharts sankeys built by pure, fully tested option builders.

**Architecture:** `SankeyChart` joins the tree-shaken registration surface (`src/charts/echarts.ts`), and a new `src/charts/sankey.ts` pins the shared mark spec once plus a tooltip-formatter FACTORY that closes over the builder's own node/link values — the tooltip echoes the page's displayed figures and never trusts echarts params to carry them. Two pure option builders in the house `*ChartOptions` pattern (`src/components/spending/spendingSankeyOptions.ts` with month/year slicing and the Saved/Drawdown edge cases; `src/components/paycheck/paycheckSankeyOptions.ts` with the fixed 4-column waterfall graph and the negative guard) feed new cards on SpendingPage/PaycheckPage, which stay thin wiring over tested functions. **Zero backend changes.**

**Tech Stack:** React 19 + TypeScript + Vitest; echarts ^6.1.0 (already installed — `SankeyChart`/`SankeySeriesOption` ship in `echarts/charts`). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-24-sankey-flow-diagrams-design.md` — cite it for any ambiguity.

**Overnight protocol:** work happens in the git worktree `.worktrees/sankey` on branch `sankey-flow-diagrams` — the orchestrator creates both; Task 0 only VERIFIES them. Run every command in this plan from the WORKTREE root (`.worktrees/sankey`): node module resolution reaches the repo root's `node_modules` from inside `.worktrees/`, and vitest's `.worktrees/**` exclude applies to runs rooted in the MAIN checkout, not to runs rooted in the worktree. No file deletions anywhere in this plan. Never push. Frequent small commits.

**House rules that bind every task:** GETs never reject stored data; server sentences render verbatim; Decimal strings on the wire; plain quantize on read paths; focus-before-reset on save-success paths; `+ ZERO` on wire-bound Decimals; comments explain constraints, not narration. Chart-side additions that bind here: echarts is NEVER rendered in jsdom (page tests mock `EChart` with a marker; geometry is pinned in the option-builder tests); category names are user text → `escapeHtml` in every HTML tooltip; fixed palette slots are the CVD-safety mechanism — never reorder, never cycle past 8, never invent a hue outside `src/charts/theme.ts`.

---

## File structure

| File | Responsibility |
|---|---|
| `src/charts/echarts.ts` (modify) | register `SankeyChart`; `SankeySeriesOption` into the `EChartsOption` union |
| `vite.config.ts` (modify) | chunk advisory 720 → 770, extending the history comment |
| `src/charts/sankey.ts` (create) | shared sankey marks (`SANKEY_MARKS`) + `makeSankeyTooltipFormatter` factory + node/link types |
| `src/charts/sankey.test.ts` (create) | pins the mark spec and the formatter's closed-over-values behavior |
| `src/components/spending/spendingSankeyOptions.ts` (create) | `buildYearSlices`, `spendingFlowPeriod`, `spendingSankeyOption` (directory is NEW — starts the SpendingPage builder extraction) |
| `src/components/spending/spendingSankeyOptions.test.ts` (create) | slicing + builder tests (Saved/Drawdown/omission/deficit/negative/escape) |
| `src/components/paycheck/paycheckSankeyOptions.ts` (create) | `paycheckSankeyOption` (directory is NEW) |
| `src/components/paycheck/paycheckSankeyOptions.test.ts` (create) | node/link/depth/color/zero-branch/negative-guard/rounding-honesty tests |
| `src/pages/SpendingPage.tsx` (modify) | "Where {period} went" card + Month/Year segmented toggle |
| `src/pages/SpendingPage.test.tsx` (create) | page-level flow-card coverage (default month, toggle, drill-follow, empty note) |
| `src/pages/PaycheckPage.tsx` (modify) | "Where each check goes" card beside the waterfall |
| `src/pages/PaycheckPage.test.tsx` (modify) | EChart marker mock + flow-card tests (the file's "no chart on this page" premise ends here) |
| `docs/superpowers/specs/2026-08-24-sankey-flow-diagrams-design.md` (modify, Task 8) | status line → implemented |

---

## Phase 0 — Worktree verification

### Task 0: Verify the worktree, branch, and toolchain

**Files:** none (environment only)

- [ ] **Step 1: Enter the worktree and verify the branch.**

```bash
cd .worktrees/sankey
git status
git branch --show-current
```

Expected: `git status` reports a clean tree; `git branch --show-current` prints exactly `sankey-flow-diagrams`. If either is wrong, STOP and report — the orchestrator owns worktree creation; this plan never creates or deletes worktrees.

- [ ] **Step 2: Frontend smoke test from the worktree root.**

Run: `npx vitest run src/utils/months.test.ts`
Expected: PASS. (Module resolution reaches the repo root's `node_modules` from inside `.worktrees/`; the `vite.config.ts` exclude only shields MAIN-checkout runs from worktree duplicates, not this run.)

No commit — nothing changed.

---

## Phase 1 — Chart infrastructure

### Task 1: Register `SankeyChart`; bump the chunk advisory

**Files:**
- Modify: `src/charts/echarts.ts`
- Modify: `vite.config.ts`

This is registration-surface config — there is nothing unit-testable until a builder exists (Task 2 onward); the verification is the compiler and the bundle. Both edits land in one commit because registering the chart is what grows the chunk past 720.

- [ ] **Step 1: Replace `src/charts/echarts.ts` with** (three deltas from today's file: `SankeyChart` in the value import, a commented `SankeyChart` entry in `echarts.use`, `SankeySeriesOption` in the type import + union — everything else byte-identical):

```ts
// Tree-shaken echarts surface: everything chart-related imports from HERE, never from
// 'echarts' directly (the full bundle is ~1MB; this registers only what the app draws).
import {
  BarChart,
  EffectScatterChart,
  HeatmapChart,
  LineChart,
  PieChart,
  SankeyChart,
  ScatterChart,
  TreemapChart,
} from 'echarts/charts'
import {
  DataZoomInsideComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components'
import * as echarts from 'echarts/core'
// Bar-to-pie morph for the spending month drill-in; keys off series ids across
// notMerge setOption calls. Inert when animation is off (reduced motion).
import { UniversalTransition } from 'echarts/features'
import { CanvasRenderer } from 'echarts/renderers'
import type {
  BarSeriesOption,
  EffectScatterSeriesOption,
  HeatmapSeriesOption,
  LineSeriesOption,
  PieSeriesOption,
  SankeySeriesOption,
  ScatterSeriesOption,
  TreemapSeriesOption,
} from 'echarts/charts'
import type {
  DataZoomComponentOption,
  GridComponentOption,
  LegendComponentOption,
  TooltipComponentOption,
  VisualMapComponentOption,
} from 'echarts/components'
import type { ComposeOption } from 'echarts/core'
import { FINANCE_THEME } from './theme'

echarts.use([
  BarChart,
  LineChart,
  EffectScatterChart,
  // Plain scatter for STILL annotation markers (net-worth notes). NOT effectScatter:
  // the ripple is the live-ping's reserved "this is now" signal, and a note is history.
  ScatterChart,
  HeatmapChart,
  PieChart,
  TreemapChart,
  // Flow cards on /spending and /paycheck (2026-08-24 sankey spec §2). Sankey lays out
  // in its own 'view' coordinate system — no grid/axis component to register.
  SankeyChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  VisualMapComponent,
  MarkLineComponent,
  // Inside-only zoom (src/charts/timeZoom.ts): the range chips cover the common windows,
  // ctrl+wheel / drag-pan fine-tunes. The slider flavour is deliberately NOT registered —
  // a 30px scrub bar under every chart is chrome the minimal theme does not want.
  DataZoomInsideComponent,
  UniversalTransition,
  CanvasRenderer,
])

echarts.registerTheme('finance', FINANCE_THEME)

export type EChartsOption = ComposeOption<
  | BarSeriesOption
  | LineSeriesOption
  | EffectScatterSeriesOption
  | ScatterSeriesOption
  | HeatmapSeriesOption
  | PieSeriesOption
  | TreemapSeriesOption
  | SankeySeriesOption
  | DataZoomComponentOption
  | GridComponentOption
  | TooltipComponentOption
  | LegendComponentOption
  | VisualMapComponentOption
>

export { echarts }
```

- [ ] **Step 2: Bump the chunk advisory.** In `vite.config.ts`, replace the `build:` block with (the file's own documented convention — extend the history comment, keep the headroom small):

```ts
  build: {
    // The echarts subset is one indivisible LAZY chunk, reached only from the chart
    // routes — the entry (~249 kB) never loads it. Raising the advisory limit documents
    // that it is deliberate, not forgotten; the headroom is small on purpose, so pulling
    // more echarts modules in trips it again. History: 678.97 kB at the 700 limit; the
    // dataZoom component took it to 694.77; ScatterChart (net-worth note markers) pushes
    // past 700, hence 720; SankeyChart (the /spending and /paycheck flow cards) pushes
    // past 720, hence 770.
    chunkSizeWarningLimit: 770,
  },
```

- [ ] **Step 3: Build.** Run: `npm run build`
Expected: clean (tsc + vite), NO chunk-size warning, and the printed echarts chunk size lands between 720 and 770 kB. If the printed size somehow exceeds 770, raise the limit to the printed size rounded up to the next 10 and reword the comment's final clause to the real number — the comment must state facts, not hopes.

- [ ] **Step 4: Existing chart tests still green.** Run: `npx vitest run src/charts`
Expected: PASS (motion + timeZoom compile against the widened union).

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(charts): register SankeyChart + raise chunk advisory to 770"`

### Task 2: Shared sankey marks + closed-over tooltip factory

**Files:**
- Create: `src/charts/sankey.ts`
- Test: `src/charts/sankey.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/charts/sankey.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { SANKEY_MARKS, makeSankeyTooltipFormatter } from './sankey'
import type { SankeyLink, SankeyNode } from './sankey'
import { INK } from './theme'

const NODES: SankeyNode[] = [
  { name: 'Net pay', value: 5000, itemStyle: { color: '#8b93a3' } },
  { name: '<b>Rent</b>', value: 2000, itemStyle: { color: '#3987e5' } },
]
const LINKS: SankeyLink[] = [{ source: 'Net pay', target: '<b>Rent</b>', value: 2000 }]

describe('SANKEY_MARKS', () => {
  it('pins the shared mark spec both flow charts wear (spec §2)', () => {
    expect(SANKEY_MARKS.type).toBe('sankey')
    expect(SANKEY_MARKS.orient).toBe('horizontal')
    expect(SANKEY_MARKS.nodeWidth).toBe(12)
    expect(SANKEY_MARKS.nodeGap).toBe(8)
    expect(SANKEY_MARKS.draggable).toBe(false)
    // 0 = vertical node order is DATA order — both builders emit a meaningful order.
    expect(SANKEY_MARKS.layoutIterations).toBe(0)
    expect(SANKEY_MARKS.itemStyle).toEqual({ borderWidth: 0, borderRadius: 2 })
    expect(SANKEY_MARKS.lineStyle).toEqual({ color: 'source', opacity: 0.3 })
    expect(SANKEY_MARKS.emphasis).toEqual({ focus: 'adjacency' })
    expect(SANKEY_MARKS.label).toEqual({ color: INK })
  })
})

describe('makeSankeyTooltipFormatter', () => {
  const format = makeSankeyTooltipFormatter(NODES, LINKS)

  it('formats a node from the closed-over map, name escaped', () => {
    const html = format({ dataType: 'node', name: '<b>Rent</b>' })
    expect(html).toContain('$2,000.00')
    expect(html).toContain('&lt;b&gt;Rent&lt;/b&gt;')
    expect(html).not.toContain('<b>')
  })

  it('formats an edge from the closed-over map, both endpoints escaped', () => {
    const html = format({ dataType: 'edge', data: { source: 'Net pay', target: '<b>Rent</b>' } })
    expect(html).toContain('$2,000.00')
    expect(html).toContain('Net pay')
    expect(html).toContain('&lt;b&gt;Rent&lt;/b&gt;')
    expect(html).not.toContain('<b>')
  })

  it('never invents a value: unknown identities and junk params answer empty', () => {
    expect(format({ dataType: 'node', name: 'nope' })).toBe('')
    expect(format({ dataType: 'edge', data: { source: 'a', target: 'b' } })).toBe('')
    expect(format({ dataType: 'edge' })).toBe('')
    expect(format(null)).toBe('')
    // echarts hands item-trigger formatters a lone object, but tolerate the array form.
    expect(format([{ dataType: 'node', name: 'Net pay' }])).toContain('$5,000.00')
  })
})
```

- [ ] **Step 2: Run it to verify it fails** — `npx vitest run src/charts/sankey.test.ts` → FAIL (`Cannot find module './sankey'`).

- [ ] **Step 3: Implement.** Create `src/charts/sankey.ts`:

```ts
// The sankey posture both flow charts wear (2026-08-24 spec §2), pinned once so the
// /spending and /paycheck sankeys can never drift apart. Pure module: no React, no
// fetching (the *ChartOptions law) — the option builders under src/components/ spread
// SANKEY_MARKS into their series and hand their OWN nodes/links to the tooltip factory.
import type { SankeySeriesOption } from 'echarts/charts'
import { escapeHtml, formatCurrency } from '../utils/format'
import { INK } from './theme'

// The node/link vocabulary the builders emit. `value` on a node is the PAGE's own
// displayed figure for that entity (the table line / matrix cell), never a link sum —
// echarts sizes nodes from links regardless, but the tooltip must echo the page.
export interface SankeyNode {
  name: string
  value: number
  /** Explicit column (the paycheck chart pins all sinks right); omit to follow links. */
  depth?: number
  itemStyle: { color: string }
}

export interface SankeyLink {
  source: string
  target: string
  value: number
}

export const SANKEY_MARKS: SankeySeriesOption = {
  type: 'sankey',
  orient: 'horizontal',
  nodeWidth: 12,
  nodeGap: 8,
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
  return (params: unknown): string => {
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
  }
}
```

- [ ] **Step 4: Run** — `npx vitest run src/charts/sankey.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(charts): shared sankey marks + closed-over tooltip factory"`

---

## Phase 2 — Spending flow

### Task 3: Year slices + flow-period selection (pure datasource layer)

**Files:**
- Create: `src/components/spending/spendingSankeyOptions.ts`
- Test: `src/components/spending/spendingSankeyOptions.test.ts`

The palette-reuse mandate (spec §3) is satisfied structurally: the page's own `topIds` array (all-time top-7 order = palette slot = bar seriesIndex) is passed IN, `buildMonthSlices` (already shared with the drill-in pie) does the month fold, and `buildYearSlices` mirrors its rules over the rollup shape — one assignment, three consumers.

- [ ] **Step 1: Write the failing tests.** Create `src/components/spending/spendingSankeyOptions.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { SpendingMatrix, SpendingYearly } from '../../types/api'
import { buildYearSlices, spendingFlowPeriod } from './spendingSankeyOptions'

// Wire shape of GET /spending/matrix — Decimal strings, parallel arrays. The category
// name carries markup on purpose: user text must survive to the escapeHtml boundary.
function matrix(over: Partial<SpendingMatrix> = {}): SpendingMatrix {
  return {
    months: ['2026-06', '2026-07'],
    categories: [
      { id: 1, name: 'Rent', slug: 'rent', sort_order: 0, is_active: true },
      { id: 2, name: 'Groceries <b>& more</b>', slug: 'groceries', sort_order: 1, is_active: true },
      { id: 3, name: 'Fun', slug: 'fun', sort_order: 2, is_active: true },
    ],
    series: [
      { category_id: 1, values: ['2000.00', '2000.00'] },
      { category_id: 2, values: ['600.00', '580.00'] },
      { category_id: 3, values: ['150.00', '0.00'] },
    ],
    totals: ['2750.00', '2580.00'],
    net_pay: ['6000.00', '6000.00'],
    savings_rate: ['0.541666667', '0.57'],
    four_pct_rule: [null, null],
    ...over,
  }
}

// One rollup year; category 4 is a refund-only cell (net negative across the year).
const YEARLY: SpendingYearly = {
  years: [
    {
      year: 2026,
      by_category: [
        { category_id: 1, total: '4000.00' },
        { category_id: 2, total: '1180.00' },
        { category_id: 3, total: '150.00' },
        { category_id: 4, total: '-25.00' },
      ],
      total: '5305.00',
      net_pay_total: '12000.00',
      savings_rate: '0.557916667',
    },
  ],
}

// The stacked chart's fold under test: slots follow topIds order, the rest is Other.
const TOP = [1, 2]

describe('buildYearSlices', () => {
  it('folds the rollup exactly like the stacked chart: topIds slots, positive-only, gray Other', () => {
    const slices = buildYearSlices(matrix().categories, YEARLY.years[0], TOP)
    expect(slices).toEqual([
      { name: 'Rent', value: 4000, slot: 0 },
      { name: 'Groceries <b>& more</b>', value: 1180, slot: 1 },
      // Fun (150) folds into Other; the -25 refund cell is EXCLUDED (positive-only,
      // buildMonthSlices' documented rule mirrored).
      { name: 'Other', value: 150, slot: null },
    ])
  })
})

describe('spendingFlowPeriod', () => {
  it('month mode slices the matrix column and carries its net pay', () => {
    const period = spendingFlowPeriod(matrix(), YEARLY, TOP, 1, 'month')
    expect(period).toEqual({
      label: 'Jul 2026',
      netPay: '6000.00',
      // Fun is 0.00 in July AND its Other fold sums to 0, so no Other slice either:
      // zero-spend categories are omitted, never drawn at zero width (spec §3).
      slices: [
        { name: 'Rent', value: 2000, slot: 0 },
        { name: 'Groceries <b>& more</b>', value: 580, slot: 1 },
      ],
    })
  })

  it('passes a null net pay through for the page to render the enter-net-pay note', () => {
    const period = spendingFlowPeriod(matrix({ net_pay: [null, null] }), YEARLY, TOP, 1, 'month')
    expect(period?.label).toBe('Jul 2026')
    expect(period?.netPay).toBeNull()
  })

  it('year mode follows the looked-at month into its rollup', () => {
    const period = spendingFlowPeriod(matrix(), YEARLY, TOP, 0, 'year')
    expect(period?.label).toBe('2026')
    expect(period?.netPay).toBe('12000.00')
    expect(period?.slices.map((s) => s.name)).toEqual(['Rent', 'Groceries <b>& more</b>', 'Other'])
  })

  it('is null with no matrix, an out-of-range month, or a year the rollup lacks', () => {
    expect(spendingFlowPeriod(null, YEARLY, TOP, 0, 'month')).toBeNull()
    expect(spendingFlowPeriod(matrix(), YEARLY, TOP, -1, 'month')).toBeNull()
    expect(spendingFlowPeriod(matrix(), YEARLY, TOP, 2, 'month')).toBeNull()
    const straddling = matrix({ months: ['2025-12', '2026-07'] })
    expect(spendingFlowPeriod(straddling, YEARLY, TOP, 0, 'year')).toBeNull()
    expect(spendingFlowPeriod(matrix(), null, TOP, 0, 'year')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/components/spending/spendingSankeyOptions.test.ts` → FAIL (`Cannot find module './spendingSankeyOptions'`).

- [ ] **Step 3: Implement.** Create `src/components/spending/spendingSankeyOptions.ts`:

```ts
// Pure datasource + option builder for the /spending flow card (2026-08-24 spec §3) — no
// React, no fetching (historyChartOptions posture). Number() here is display-only math
// on the server's Decimal strings and is never handed back to the API.
//
// Palette law: slices arrive PRE-SLOTTED through the page's own topIds order
// (buildMonthSlices / buildYearSlices), so a category wears the exact hue its stacked-bar
// segment wears — same entity, same color everywhere, gray "Other" fold included.
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
```

- [ ] **Step 4: Run** — `npx vitest run src/components/spending/spendingSankeyOptions.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(spending): year slices + flow-period selection for the sankey"`

### Task 4: `spendingSankeyOption` — Saved, Drawdown, and the degenerate states

**Files:**
- Modify: `src/components/spending/spendingSankeyOptions.ts`
- Test: `src/components/spending/spendingSankeyOptions.test.ts`

- [ ] **Step 1: Write the failing tests.** In `spendingSankeyOptions.test.ts`, replace the import block with:

```ts
import { describe, expect, it } from 'vitest'
import type { EChartsOption } from '../../charts/echarts'
import { MUTED, NEGATIVE, OTHER_SERIES_COLOR, PALETTE, POSITIVE } from '../../charts/theme'
import type { SpendingMatrix, SpendingYearly } from '../../types/api'
import {
  buildYearSlices,
  spendingFlowPeriod,
  spendingSankeyOption,
} from './spendingSankeyOptions'
```

and append at the end of the file:

```ts
// --- option readers (historyChartOptions.test.ts posture) -------------------------------
interface NodeLike {
  name?: string
  value?: number
  itemStyle?: { color?: string }
}
interface LinkLike {
  source?: string
  target?: string
  value?: number
}
interface SankeyLike {
  type?: string
  nodeWidth?: number
  layoutIterations?: number
  data?: NodeLike[]
  links?: LinkLike[]
}
function sankeyOf(option: EChartsOption): SankeyLike {
  return (option as unknown as { series: SankeyLike[] }).series[0]
}
function tooltipOf(option: EChartsOption): (params: unknown) => string {
  return (option as unknown as { tooltip: { formatter: (params: unknown) => string } })
    .tooltip.formatter
}

const july = () => spendingFlowPeriod(matrix(), YEARLY, TOP, 1, 'month')!

describe('spendingSankeyOption — surplus periods', () => {
  it('fans net pay into slotted category nodes and a green Saved tail', () => {
    const option = spendingSankeyOption(july())
    expect(option).not.toBeNull()
    const series = sankeyOf(option!)
    // The shared mark spec rides every option (charts/sankey.ts owns the numbers).
    expect(series.type).toBe('sankey')
    expect(series.nodeWidth).toBe(12)
    expect(series.layoutIterations).toBe(0)
    expect(series.data?.map((n) => n.name)).toEqual([
      'Net pay',
      'Rent',
      'Groceries <b>& more</b>',
      'Saved',
    ])
    expect(series.data?.map((n) => n.itemStyle?.color)).toEqual([
      MUTED, // income restated, not a destination
      PALETTE[0], // the stacked chart's slot for Rent — same entity, same hue
      PALETTE[1],
      POSITIVE, // Saved: the one deliberate status-color exception (spec §3)
    ])
    expect(series.links).toEqual([
      { source: 'Net pay', target: 'Rent', value: 2000 },
      { source: 'Net pay', target: 'Groceries <b>& more</b>', value: 580 },
      { source: 'Net pay', target: 'Saved', value: 3420 },
    ])
  })

  it('folds non-top categories into the gray Other node (year mode)', () => {
    const option = spendingSankeyOption(spendingFlowPeriod(matrix(), YEARLY, TOP, 1, 'year')!)
    const series = sankeyOf(option!)
    const other = series.data?.find((n) => n.name === 'Other')
    expect(other?.itemStyle?.color).toBe(OTHER_SERIES_COLOR)
    expect(series.links).toContainEqual({ source: 'Net pay', target: 'Other', value: 150 })
    // Saved = net pay − the DRAWN sum (4000+1180+150 = 5330), NOT net_pay − the
    // refund-netted rollup total (5305): links cannot be negative, so the fold restates
    // spending GROSS and balance (inflow = outflow) wins over restating the server total
    // — the same documented divergence the drill-in pie carries (buildMonthSlices).
    expect(series.links).toContainEqual({ source: 'Net pay', target: 'Saved', value: 6670 })
  })

  it('omits an exactly-zero Saved node (zero-width links are tooltip noise)', () => {
    const period = spendingFlowPeriod(
      matrix({ net_pay: ['6000.00', '2580.00'] }),
      YEARLY,
      TOP,
      1,
      'month',
    )!
    const series = sankeyOf(spendingSankeyOption(period)!)
    expect(series.data?.map((n) => n.name)).toEqual([
      'Net pay',
      'Rent',
      'Groceries <b>& more</b>',
    ])
    expect(series.links).toHaveLength(2)
  })
})

describe('spendingSankeyOption — deficit and degenerate periods', () => {
  it('adds a red Drawdown source and splits every category pro-rata', () => {
    const period = spendingFlowPeriod(
      matrix({ net_pay: ['6000.00', '1000.00'] }),
      YEARLY,
      TOP,
      1,
      'month',
    )!
    const series = sankeyOf(spendingSankeyOption(period)!)
    // Saved is omitted in a deficit period (spec §3).
    expect(series.data?.map((n) => n.name)).toEqual([
      'Net pay',
      'Drawdown',
      'Rent',
      'Groceries <b>& more</b>',
    ])
    expect(series.data?.[1]?.itemStyle?.color).toBe(NEGATIVE)
    expect(series.data?.[1]?.value).toBe(1580)
    // Pro-rata: net pay funds 1000/2580 of each category, the drawdown the rest — money
    // is fungible, so no category is singled out as "the drawdown one". Inflows equal
    // outflows again: 1000 + 1580 = 2580.
    expect(series.links).toEqual([
      { source: 'Net pay', target: 'Rent', value: 775.19 },
      { source: 'Drawdown', target: 'Rent', value: 1224.81 },
      { source: 'Net pay', target: 'Groceries <b>& more</b>', value: 224.81 },
      { source: 'Drawdown', target: 'Groceries <b>& more</b>', value: 355.19 },
    ])
  })

  it('funds a zero-net-pay deficit period entirely from Drawdown', () => {
    const period = spendingFlowPeriod(
      matrix({ net_pay: ['6000.00', '0.00'] }),
      YEARLY,
      TOP,
      1,
      'month',
    )!
    const series = sankeyOf(spendingSankeyOption(period)!)
    // No zero-value Net pay node and no zero links from it.
    expect(series.data?.map((n) => n.name)).toEqual([
      'Drawdown',
      'Rent',
      'Groceries <b>& more</b>',
    ])
    expect(series.links).toEqual([
      { source: 'Drawdown', target: 'Rent', value: 2000 },
      { source: 'Drawdown', target: 'Groceries <b>& more</b>', value: 580 },
    ])
  })

  it('is null when net pay is missing, negative, or there is nothing to draw', () => {
    expect(spendingSankeyOption({ label: 'Jul 2026', netPay: null, slices: [] })).toBeNull()
    expect(spendingSankeyOption({ label: 'Jul 2026', netPay: '-1.00', slices: [] })).toBeNull()
    expect(spendingSankeyOption({ label: 'Jul 2026', netPay: '0.00', slices: [] })).toBeNull()
  })

  it("tooltips echo the builder's own figures with names escaped", () => {
    const format = tooltipOf(spendingSankeyOption(july())!)
    const node = format({ dataType: 'node', name: 'Groceries <b>& more</b>' })
    expect(node).toContain('$580.00')
    expect(node).toContain('&lt;b&gt;&amp; more&lt;/b&gt;')
    expect(node).not.toContain('<b>')
    const edge = format({ dataType: 'edge', data: { source: 'Net pay', target: 'Saved' } })
    expect(edge).toContain('$3,420.00')
  })
})
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/components/spending/spendingSankeyOptions.test.ts` → FAIL (`spendingSankeyOption` is not exported; the Task 3 tests must still PASS).

- [ ] **Step 3: Implement.** In `spendingSankeyOptions.ts`, replace the import block with:

```ts
import type { EChartsOption } from '../../charts/echarts'
import { SANKEY_MARKS, makeSankeyTooltipFormatter } from '../../charts/sankey'
import type { SankeyLink, SankeyNode } from '../../charts/sankey'
import { MUTED, NEGATIVE, OTHER_SERIES_COLOR, PALETTE, POSITIVE } from '../../charts/theme'
import type { CategoryOut, SpendingMatrix, SpendingYearly, YearRollup } from '../../types/api'
import { formatMonth } from '../../utils/format'
import { buildMonthSlices } from '../../utils/spending'
import type { MonthSlice } from '../../utils/spending'
```

and append at the end of the file:

```ts
// Fixed node names. A user category with one of these exact names would merge with the
// app node (sankey nodes key on name) — the same accepted collision as the pie's 'Other'.
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
  const spent = cents(period.slices.reduce((acc, slice) => acc + slice.value, 0))
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
  for (const slice of period.slices) {
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
    for (const slice of period.slices) {
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
    for (const slice of period.slices) {
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
```

- [ ] **Step 4: Run** — `npx vitest run src/components/spending/spendingSankeyOptions.test.ts` → PASS (all Task 3 + Task 4 tests).

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(spending): spending sankey option builder (Saved/Drawdown/pro-rata)"`

### Task 5: SpendingPage flow card + Month/Year toggle

**Files:**
- Modify: `src/pages/SpendingPage.tsx`
- Test: `src/pages/SpendingPage.test.tsx` (new — the page had no test file; this one covers ONLY the flow card, per the house "marker mock, geometry lives in builder tests" law)

- [ ] **Step 1: Write the failing tests.** Create `src/pages/SpendingPage.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpendingMatrix, SpendingYearly } from '../types/api'
import SpendingPage from './SpendingPage'

vi.mock('../api/spending', () => ({ fetchMatrix: vi.fn(), fetchYearly: vi.fn() }))
// echarts needs a real canvas and is NEVER rendered in jsdom (house law) — what each
// chart draws is pinned in its option-builder tests; this marker says which charts are
// up and, via data-links, what the FLOW card drew. Clicking a marker stands in for a
// click on the chart's first month (dataIndex 0) — enough to walk the drill-in door.
vi.mock('../components/EChart', async () => {
  const { createElement } = await import('react')
  return {
    default: ({
      option,
      onClick,
    }: {
      option: {
        series?: { links?: { source?: string; target?: string; value?: number }[] }[]
      }
      onClick?: (params: { dataIndex?: number }) => void
    }) =>
      createElement('div', {
        'data-testid': 'echart',
        'data-links': (option.series?.[0]?.links ?? [])
          .map((l) => `${l.source}>${l.target}=${l.value}`)
          .join('|'),
        onClick: () => onClick?.({ dataIndex: 0 }),
      }),
  }
})
import { fetchMatrix, fetchYearly } from '../api/spending'

// --- fixtures ---------------------------------------------------------------------------
// Wire shapes of GET /spending/matrix and /spending/yearly — Decimal strings.

function matrixFixture(over: Partial<SpendingMatrix> = {}): SpendingMatrix {
  return {
    months: ['2026-06', '2026-07'],
    categories: [
      { id: 1, name: 'Rent', slug: 'rent', sort_order: 0, is_active: true },
      { id: 2, name: 'Groceries', slug: 'groceries', sort_order: 1, is_active: true },
      { id: 3, name: 'Fun', slug: 'fun', sort_order: 2, is_active: true },
    ],
    series: [
      { category_id: 1, values: ['2000.00', '2000.00'] },
      { category_id: 2, values: ['600.00', '580.00'] },
      { category_id: 3, values: ['150.00', '0.00'] },
    ],
    totals: ['2750.00', '2580.00'],
    net_pay: ['6000.00', '6000.00'],
    savings_rate: ['0.541666667', '0.57'],
    four_pct_rule: [null, null],
    ...over,
  }
}

const YEARLY: SpendingYearly = {
  years: [
    {
      year: 2026,
      by_category: [
        { category_id: 1, total: '4000.00' },
        { category_id: 2, total: '1180.00' },
        { category_id: 3, total: '150.00' },
      ],
      total: '5330.00',
      net_pay_total: '12000.00',
      savings_rate: '0.555833333',
    },
  ],
}

// The flow marker is the one whose option carries sankey links.
const flowMarker = () =>
  screen.getAllByTestId('echart').find((el) => (el.getAttribute('data-links') ?? '') !== '')

function renderPage() {
  return render(
    <MemoryRouter>
      <SpendingPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.mocked(fetchMatrix).mockResolvedValue(matrixFixture())
  vi.mocked(fetchYearly).mockResolvedValue(YEARLY)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SpendingPage — the flow card', () => {
  it('draws the latest month by default: categories in stacked-chart order plus Saved', async () => {
    renderPage()
    expect(await screen.findByText('Where Jul 2026 went')).toBeTruthy()
    // All three categories are top-7 here; Fun is 0.00 in July, so it is omitted.
    expect(flowMarker()?.getAttribute('data-links')).toBe(
      'Net pay>Rent=2000|Net pay>Groceries=580|Net pay>Saved=3420',
    )
  })

  it('re-slices to the yearly rollup client-side on the Year toggle', async () => {
    renderPage()
    await screen.findByText('Where Jul 2026 went')

    fireEvent.click(screen.getByRole('button', { name: 'Year' }))

    expect(await screen.findByText('Where 2026 went')).toBeTruthy()
    expect(flowMarker()?.getAttribute('data-links')).toBe(
      'Net pay>Rent=4000|Net pay>Groceries=1180|Net pay>Fun=150|Net pay>Saved=6670',
    )
    // Both datasources were already on the page — the toggle never refetches.
    expect(vi.mocked(fetchMatrix)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetchYearly)).toHaveBeenCalledTimes(1)
  })

  it('follows the drilled month (the pie month is the flow month)', async () => {
    renderPage()
    await screen.findByText('Where Jul 2026 went')

    // The FIRST marker is the top bars chart; a click drills into month index 0.
    fireEvent.click(screen.getAllByTestId('echart')[0])

    expect(await screen.findByText('Where Jun 2026 went')).toBeTruthy()
    expect(flowMarker()?.getAttribute('data-links')).toBe(
      'Net pay>Rent=2000|Net pay>Groceries=600|Net pay>Fun=150|Net pay>Saved=3250',
    )
  })

  it('asks for net pay instead of drawing a blank canvas', async () => {
    vi.mocked(fetchMatrix).mockResolvedValue(matrixFixture({ net_pay: [null, null] }))
    renderPage()

    expect(
      await screen.findByText('Enter net pay for Jul 2026 to see the flow.'),
    ).toBeTruthy()
    expect(flowMarker()).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/pages/SpendingPage.test.tsx` → FAIL (no `Where Jul 2026 went` on the page yet).

- [ ] **Step 3: Wire the card into `src/pages/SpendingPage.tsx`.** Four insertions, no other changes:

  1. **Import** — beside the other `../components` imports (after the `StatTile` import line):

```ts
import {
  spendingFlowPeriod,
  spendingSankeyOption,
} from '../components/spending/spendingSankeyOptions'
```

  2. **State** — directly under the `range` state declaration:

```ts
  // The flow card's window. Month follows the month being LOOKED AT (drill-aware, the
  // movers' rule below); Year re-slices the SAME looked-at month's year from the rollup
  // — both datasources are already on the page, so the toggle never refetches.
  const [flowMode, setFlowMode] = useState<'month' | 'year'>('month')
```

  3. **Memos** — directly under the `movers` memo (this is where `moversIndex` is in scope; the flow deliberately reuses the movers' "month being looked at" answer):

```ts
  const flowPeriod = useMemo(
    () => spendingFlowPeriod(matrix, yearly, topIds, moversIndex, flowMode),
    [matrix, yearly, topIds, moversIndex, flowMode],
  )
  const flowOption = useMemo(
    () => (flowPeriod === null ? null : spendingSankeyOption(flowPeriod)),
    [flowPeriod],
  )
```

  4. **Card JSX** — between the movers card's closing `)}` and the heatmap card's opening `<div className="card span-12">`:

```tsx
        {flowPeriod && (
          <div className="card span-12">
            <div className="spending-chart-header">
              <h2 className="eyebrow">
                Where {flowPeriod.label} went
                <InfoHint text="Net pay fanned out across the period's categories, wearing the stacked chart's colors; green Saved is what was left. A deficit period adds a red Drawdown source covering the overspend." />
              </h2>
              <div className="segmented" role="group" aria-label="Flow window">
                {(['month', 'year'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={flowMode === mode ? 'active' : ''}
                    aria-pressed={flowMode === mode}
                    onClick={() => setFlowMode(mode)}
                  >
                    {mode === 'month' ? 'Month' : 'Year'}
                  </button>
                ))}
              </div>
            </div>
            {flowOption ? (
              <>
                <EChart option={flowOption} height={320} />
                <p className="drill-hint">
                  Hover a node to trace its flows; drill a month on the top chart and this
                  card follows it.
                </p>
              </>
            ) : (
              <div className="empty-note">
                {flowPeriod.netPay === null
                  ? `Enter net pay for ${flowPeriod.label} to see the flow.`
                  : `No flow to draw for ${flowPeriod.label}.`}
              </div>
            )}
          </div>
        )}
```

- [ ] **Step 4: Run** — `npx vitest run src/pages/SpendingPage.test.tsx src/components/spending` → PASS.

- [ ] **Step 5: Lint** — `npm run lint` → clean (this also settles import ordering; fix any ordering complaint by moving the new import where eslint wants it, nothing else).

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(spending): Where-it-went flow card with Month/Year toggle"`

---

## Phase 3 — Paycheck flow

### Task 6: `paycheckSankeyOption` — the waterfall as a graph

**Files:**
- Create: `src/components/paycheck/paycheckSankeyOptions.ts`
- Test: `src/components/paycheck/paycheckSankeyOptions.test.ts`

- [ ] **Step 1: Write the failing tests.** Create `src/components/paycheck/paycheckSankeyOptions.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { EChartsOption } from '../../charts/echarts'
import { MUTED, PALETTE, POSITIVE } from '../../charts/theme'
import type { PaycheckBreakdownOut, PaycheckProfileOut } from '../../types/api'
import { paycheckSankeyOption } from './paycheckSankeyOptions'

// The Workbook reference profile (PaycheckPage.test.tsx's golden fixture). Its display-
// rounded lines deliberately do NOT reconcile (post_tax 4486.26 vs 236.16 + 865.93 +
// 3384.16 = 4486.25) — exactly the drift the tooltip rule below exists for.
const profile: PaycheckProfileOut = {
  id: 1,
  effective_date: '2026-01-01',
  annual_salary: '188930.00',
  pay_periods_per_year: 24,
  trad_401k_pct: '0.130000000',
  roth_401k_pct: '0.000000000',
  after_tax_401k_pct: '0.030000000',
  espp_pct: '0.110000000',
  withholding_pct: '0.334009167',
  dental_vision_per_check: '12.50',
  hsa_per_check: '100.00',
  notes: null,
}

function breakdown(over: Partial<PaycheckBreakdownOut> = {}): PaycheckBreakdownOut {
  return {
    profile,
    gross: '7872.08',
    trad_401k: '1023.37',
    dental_vision: '12.50',
    hsa: '100.00',
    taxable: '6736.21',
    withholding: '2249.96',
    post_tax: '4486.26',
    roth_401k: '0.00',
    after_tax_401k: '236.16',
    espp: '865.93',
    net_pay: '3384.16',
    monthly_net: '6768.33',
    warnings: [],
    ...over,
  }
}

// --- option readers (historyChartOptions.test.ts posture) -------------------------------
interface NodeLike {
  name?: string
  value?: number
  depth?: number
  itemStyle?: { color?: string }
}
interface LinkLike {
  source?: string
  target?: string
  value?: number
}
interface SankeyLike {
  type?: string
  data?: NodeLike[]
  links?: LinkLike[]
}
function sankeyOf(option: EChartsOption): SankeyLike {
  return (option as unknown as { series: SankeyLike[] }).series[0]
}
function tooltipOf(option: EChartsOption): (params: unknown) => string {
  return (option as unknown as { tooltip: { formatter: (params: unknown) => string } })
    .tooltip.formatter
}

describe('paycheckSankeyOption', () => {
  it('draws the waterfall as a 4-column flow, zero branches omitted', () => {
    const option = paycheckSankeyOption(breakdown())
    expect(option).not.toBeNull()
    const series = sankeyOf(option!)
    expect(series.type).toBe('sankey')
    // roth_401k is 0.00: the branch is OMITTED, not drawn at zero width (spec §4).
    expect(series.data?.map((n) => n.name)).toEqual([
      'Gross',
      'Taxable',
      'Post-tax',
      'Traditional 401(k)',
      'Dental & vision',
      'HSA',
      'Withholding',
      'After-tax 401(k)',
      'ESPP',
      'Net pay',
    ])
    // Explicit columns: intermediates 0/1/2, EVERY terminal right-aligned at depth 3.
    expect(series.data?.map((n) => n.depth)).toEqual([0, 1, 2, 3, 3, 3, 3, 3, 3, 3])
    expect(series.links).toEqual([
      { source: 'Gross', target: 'Traditional 401(k)', value: 1023.37 },
      { source: 'Gross', target: 'Dental & vision', value: 12.5 },
      { source: 'Gross', target: 'HSA', value: 100 },
      { source: 'Gross', target: 'Taxable', value: 6736.21 },
      { source: 'Taxable', target: 'Withholding', value: 2249.96 },
      { source: 'Taxable', target: 'Post-tax', value: 4486.26 },
      { source: 'Post-tax', target: 'After-tax 401(k)', value: 236.16 },
      { source: 'Post-tax', target: 'ESPP', value: 865.93 },
      { source: 'Post-tax', target: 'Net pay', value: 3384.16 },
    ])
  })

  it('keeps intermediates gray, terminals on their FIXED waterfall slots, net pay green', () => {
    const colorOf = (option: EChartsOption, name: string) =>
      sankeyOf(option).data?.find((n) => n.name === name)?.itemStyle?.color
    const option = paycheckSankeyOption(breakdown())!
    expect(colorOf(option, 'Gross')).toBe(MUTED)
    expect(colorOf(option, 'Taxable')).toBe(MUTED)
    expect(colorOf(option, 'Post-tax')).toBe(MUTED)
    expect(colorOf(option, 'Traditional 401(k)')).toBe(PALETTE[0])
    expect(colorOf(option, 'Dental & vision')).toBe(PALETTE[1])
    expect(colorOf(option, 'HSA')).toBe(PALETTE[2])
    expect(colorOf(option, 'Withholding')).toBe(PALETTE[3])
    // Roth (slot 4) is omitted this check — After-tax keeps ITS slot 5: slots are fixed
    // per ENTITY, so an omitted zero branch never reshuffles its neighbours' hues.
    expect(colorOf(option, 'After-tax 401(k)')).toBe(PALETTE[5])
    expect(colorOf(option, 'ESPP')).toBe(PALETTE[6])
    expect(colorOf(option, 'Net pay')).toBe(POSITIVE)
    const withRoth = paycheckSankeyOption(breakdown({ roth_401k: '150.00' }))!
    expect(colorOf(withRoth, 'Roth 401(k)')).toBe(PALETTE[4])
  })

  it('tooltips echo the TABLE figures, never link sums (rounding honesty, spec §4)', () => {
    const format = tooltipOf(paycheckSankeyOption(breakdown())!)
    // Post-tax's outgoing links sum to 4486.25 — a cent off its own table line. The
    // tooltip must say what the table says.
    expect(format({ dataType: 'node', name: 'Post-tax' })).toContain('$4,486.26')
    expect(
      format({ dataType: 'edge', data: { source: 'Post-tax', target: 'Net pay' } }),
    ).toContain('$3,384.16')
  })

  it('skips the chart when any figure is negative — the table stays the correct surface', () => {
    expect(paycheckSankeyOption(breakdown({ net_pay: '-120.00' }))).toBeNull()
    expect(
      paycheckSankeyOption(
        breakdown({ taxable: '-1.00', post_tax: '-2251.00', net_pay: '-5000.00' }),
      ),
    ).toBeNull()
  })

  it('is null on an all-zero check (nothing to draw)', () => {
    const zeros: Partial<PaycheckBreakdownOut> = {
      gross: '0.00',
      trad_401k: '0.00',
      dental_vision: '0.00',
      hsa: '0.00',
      taxable: '0.00',
      withholding: '0.00',
      post_tax: '0.00',
      roth_401k: '0.00',
      after_tax_401k: '0.00',
      espp: '0.00',
      net_pay: '0.00',
    }
    expect(paycheckSankeyOption(breakdown(zeros))).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/components/paycheck/paycheckSankeyOptions.test.ts` → FAIL (`Cannot find module './paycheckSankeyOptions'`).

- [ ] **Step 3: Implement.** Create `src/components/paycheck/paycheckSankeyOptions.ts`:

```ts
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
// sits right-aligned at depth 3 so the eye reads "everything ends here" (links may span
// columns — deliberate, spec §4). Colors: intermediates MUTED (restatements, not
// destinations — Gross included); terminals on FIXED PALETTE slots in waterfall order,
// fixed per ENTITY so an omitted zero branch never reshuffles its neighbours' hues;
// Net pay POSITIVE green (§3's kept-money-is-green cross-chart convention).
const FLOW_NODES: { key: FlowKey; label: string; depth: 0 | 1 | 2 | 3; color: string }[] = [
  { key: 'gross', label: 'Gross', depth: 0, color: MUTED },
  { key: 'taxable', label: 'Taxable', depth: 1, color: MUTED },
  { key: 'post_tax', label: 'Post-tax', depth: 2, color: MUTED },
  { key: 'trad_401k', label: 'Traditional 401(k)', depth: 3, color: PALETTE[0] },
  { key: 'dental_vision', label: 'Dental & vision', depth: 3, color: PALETTE[1] },
  { key: 'hsa', label: 'HSA', depth: 3, color: PALETTE[2] },
  { key: 'withholding', label: 'Withholding', depth: 3, color: PALETTE[3] },
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
```

- [ ] **Step 4: Run** — `npx vitest run src/components/paycheck/paycheckSankeyOptions.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(paycheck): paycheck sankey option builder (rounding-honest tooltips)"`

### Task 7: PaycheckPage flow card

**Files:**
- Modify: `src/pages/PaycheckPage.tsx`
- Test: `src/pages/PaycheckPage.test.tsx`

- [ ] **Step 1: Write the failing tests.** In `src/pages/PaycheckPage.test.tsx`:

  1. Replace the comment above the `vi.mock('../api/paycheck', ...)` block — it currently reads `// Every request is stubbed; there is no chart on this page (the waterfall is a definition` / `// list), so no EChart mock is needed.` — with the single line:

```tsx
// Every request is stubbed.
```

  2. Directly after the `vi.mock('../api/paycheck', ...)` block (before its `import { createProfile, ... }` line), insert:

```tsx
// echarts needs a real canvas and is NEVER rendered in jsdom (house law) — the flow
// card's geometry is pinned in paycheckSankeyOptions.test.ts; this marker only says
// whether the chart is up and which nodes it carries. The async factory keeps the JSX
// runtime out of vi.mock's hoisted scope.
vi.mock('../components/EChart', async () => {
  const { createElement } = await import('react')
  return {
    default: ({ option }: { option: { series?: { data?: { name?: string }[] }[] } }) =>
      createElement('div', {
        'data-testid': 'echart',
        'data-nodes': (option.series?.[0]?.data ?? []).map((n) => n.name ?? '').join(','),
      }),
  }
})
```

  3. Append a new describe block at the end of the file:

```tsx
describe('PaycheckPage — the flow card', () => {
  it('draws the flow beside the waterfall from the same payload, zero branches omitted', async () => {
    render(<PaycheckPage />)
    await screen.findByText('$3,384.16')

    expect(screen.getByText('Where each check goes')).toBeTruthy()
    const marker = screen.getByTestId('echart')
    // The golden fixture's roth_401k is 0.00 — its node is omitted outright.
    expect(marker.getAttribute('data-nodes')).toBe(
      'Gross,Taxable,Post-tax,Traditional 401(k),Dental & vision,HSA,Withholding,After-tax 401(k),ESPP,Net pay',
    )
  })

  it('shows the guard sentence instead of a chart when a figure is negative', async () => {
    vi.mocked(fetchBreakdown).mockResolvedValue(
      breakdownOf(profile2026, { net_pay: '-120.00' }),
    )
    render(<PaycheckPage />)
    await screen.findByText('-$120.00')

    // The table (which handles negatives fine) stays; the sankey steps aside (spec §4).
    expect(screen.getByText(/deductions exceed pay — see the table/)).toBeTruthy()
    expect(screen.queryByTestId('echart')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/pages/PaycheckPage.test.tsx` → the two NEW tests FAIL (`Where each check goes` not found); every EXISTING test still PASSES (the mock is inert until the page imports EChart).

- [ ] **Step 3: Implement in `src/pages/PaycheckPage.tsx`.** Three edits:

  1. **Imports** — change the react import to `import { useEffect, useMemo, useRef, useState } from 'react'`; add, beside the other component imports (after the `AmountInput` line):

```ts
import EChart from '../components/EChart'
import { paycheckSankeyOption } from '../components/paycheck/paycheckSankeyOptions'
```

  2. **New panel** — insert between `BreakdownPanel`'s closing brace and the `// ── Profiles ──` divider:

```tsx
// ── Flow ────────────────────────────────────────────────────────────────────────────────

/**
 * The waterfall drawn as a flow, from the SAME payload the table renders: gray nodes
 * restate money in transit (gross, taxable, post-tax), colored nodes are destinations,
 * green is the kept money. A null option is the builder's negative guard (or an all-zero
 * check) — the table is the always-correct surface, so this card steps aside with a
 * sentence instead of drawing a lie.
 */
function FlowPanel({ data }: { data: PaycheckBreakdownOut }) {
  const option = useMemo(() => paycheckSankeyOption(data), [data])
  return (
    <section className="card">
      <h2 className="eyebrow">
        Where each check goes
        <InfoHint text="The table&apos;s own figures drawn as a flow — gross splits into pre-tax deductions and taxable, taxable into withholding and post-tax, post-tax into contributions and net pay. Amounts match the table exactly." />
      </h2>
      {option !== null ? (
        <>
          <EChart option={option} height={320} />
          <p className="drill-hint">
            Gray nodes restate money in transit; colored nodes are where it lands; green
            is what you keep. Hover a node to trace its flows.
          </p>
        </>
      ) : (
        <p className="empty-note">This profile&apos;s deductions exceed pay — see the table.</p>
      )}
    </section>
  )
}
```

  3. **Render it** — in the page's return, replace the breakdown block

```tsx
        <div className={`loading-dim${breakdownBusy ? ' is-loading' : ''}`}>
          <BreakdownPanel data={breakdown} />
        </div>
```

with

```tsx
        <div className={`loading-dim${breakdownBusy ? ' is-loading' : ''}`}>
          <BreakdownPanel data={breakdown} />
          {/* Same payload, same busy dim: the flow can never show a different check than
              the table above it. */}
          <FlowPanel data={breakdown} />
        </div>
```

- [ ] **Step 4: Run the whole file** — `npx vitest run src/pages/PaycheckPage.test.tsx` → ALL PASS (the pre-existing tests prove the waterfall/table behavior is untouched).

- [ ] **Step 5: Lint** — `npm run lint` → clean.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(paycheck): flow card beside the waterfall"`

---

## Phase 4 — Verification

### Task 8: Full verification + spec status

The plan STOPS at the end of this task — the orchestrator merges. Never push.

- [ ] **Step 1: Full frontend suite** — `npx vitest run` → ALL PASS (record the count; every pre-existing test must still pass — this plan deleted nothing).
- [ ] **Step 2: Lint** — `npm run lint` → clean.
- [ ] **Step 3: Type-check + build** — `npm run build` → clean; the echarts chunk prints under the 770 advisory (no warning), and the ENTRY chunk size is unchanged from Task 1's build (the sankey code rides the lazy chunk only).
- [ ] **Step 4: Spec status.** In `docs/superpowers/specs/2026-08-24-sankey-flow-diagrams-design.md`, on the status line, change the words `approved, not yet implemented` to `implemented 2026-08-24 (branch sankey-flow-diagrams)`.
- [ ] **Step 5: Everything committed** — `git add -A && git commit -m "docs: sankey spec status — implemented"`, then `git status --porcelain` → empty, and `git log --oneline main..HEAD` lists this plan's commits on `sankey-flow-diagrams`.
- [ ] **Step 6: Leave a summary** for the morning: test counts, the chunk size printed by the build, and the one follow-up this plan cannot do overnight — the spec §5 MANUAL render pass (dataviz step 7: label collisions at ~10 categories, the 320px card heights, sub-1000px card behavior) needs a human in a browser; note also the two documented judgment calls (deficit links split pro-rata between Net pay and Drawdown; Saved = net pay − drawn links, so refund cells restate spending gross — both commented at the code sites).
