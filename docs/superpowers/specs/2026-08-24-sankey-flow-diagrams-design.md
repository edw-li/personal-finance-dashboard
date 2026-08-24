# Sankey Flow Diagrams (Spending + Paycheck) — Design Spec

**Date:** 2026-08-24 · **Status:** implemented 2026-08-24 (branch sankey-flow-diagrams)
**Touches:** `src/charts/echarts.ts` (register SankeyChart), `vite.config.ts` (chunk advisory limit), `/spending` page (new card + option builder), `/paycheck` page (new card + option builder). **Zero backend changes.**

## 1. Context & goals

The app shows composition (stacked bars, pies) but never *flow*. Two flows are already fully described by data the pages fetch today:

- **Monthly spending flow** — `GET /spending/matrix` carries per-category monthly values plus `net_pay` per month (`api/spending.py` MatrixOut); the missing picture is *net pay → categories → what's left*.
- **Paycheck flow** — `GET /paycheck/breakdown` is literally a flow graph (`paycheck_calc.breakdown`): gross splits into pre-tax deductions and taxable; taxable into withholding and post-tax; post-tax into post-tax deductions and net pay. The current table renders subtractions, restatements, and the net with identical visual weight (2026-08-24 audit finding); a sankey makes subtract-vs-restate unmistakable.

### User-confirmed decisions (2026-08-24 Q&A)

- Build sankeys for **spending** and **paycheck**; month **and year** toggle on the spending one (yearly rollup endpoint already exists).
- Other locations rejected for v1: a taxes-year sankey duplicates the existing waterfall's story; net worth has no flow data (snapshots). The "grand unified" yearly sankey (income → taxes → categories → savings destinations) is a v2 candidate once these two exist.

## 2. Chart infrastructure

- `src/charts/echarts.ts`: import + register `SankeyChart` from `echarts/charts`; add `SankeySeriesOption` to the `EChartsOption` union. Sankey needs no new component (tooltip/legend already registered; sankey uses no grid/axis).
- `vite.config.ts`: the lazy echarts chunk will trip the 720 kB advisory limit — bump it following the file's own documented convention, extending the history comment (ScatterChart took it to 720; SankeyChart is the next deliberate addition).
- Both sankeys are pure option builders in the house pattern (`*ChartOptions.ts` + `*.test.ts`, no React, no fetching): `src/components/spending/spendingSankeyOptions.ts` and `src/components/paycheck/paycheckSankeyOptions.ts`. (`src/components/spending/` is new; SpendingPage currently keeps its builders inline — the new builder starts the extraction rather than growing the 747-line page.)

### Shared mark/interaction specs (both sankeys)

- `nodeWidth: 12`, `nodeGap: 8`, `draggable: false`, horizontal orient, node `borderRadius: 2`, no node borders.
- Links wear the **source node's color at ~0.3 opacity**, flat (no gradient — minimal-theme posture).
- Node labels in INK (entity name only — text wears text tokens, never values-in-series-color); amounts live in the tooltip, formatted by `formatCurrency`. Category names are user text → `escapeHtml` in any HTML tooltip (house law).
- `emphasis: { focus: 'adjacency' }` — hovering a node highlights its flows.
- Animation obeys the existing reduced-motion quiesce (`motion.ts` runs post-spread on every option; nothing sankey-specific needed).
- Empty/degenerate states render the house `.empty-note` sentence, never a blank canvas.

## 3. Spending sankey — "Where {month} went"

New card on `/spending`, sharing the page's existing focused-month state (the bar-click pie drill month); defaults to the latest month with data. A small **Month / Year** segmented toggle (house segmented-button style) switches the datasource between the matrix month column and the yearly rollup.

**Nodes & links (two levels):**

- Source: **Net pay** (MUTED-family neutral node) → one link per category with spend > 0 that month (categories wear the **same palette-slot assignments as the stacked chart** — same entity, same hue everywhere, including the top-7 + gray "Other" fold) → plus a **Saved** terminal node (`net_pay − total`) in POSITIVE green.
- Saved-is-green is a deliberate semantic exception to the reserved-status-color rule, one node per chart, mirroring the tone system (`tone.ts` posture). The paycheck sankey's Net pay node follows the same rule (§4), so "the kept money is green" is a cross-chart convention.

**Edge cases (all reachable in real data):**

- **Deficit month** (total > net_pay): sankey links cannot be negative — add a **Drawdown** source node in NEGATIVE red carrying the shortfall, so inflows still equal outflows. Saved is omitted.
- **Saved exactly 0**: omit the node (zero-width links are tooltip noise — the vesting-tooltip lesson).
- **No net_pay for the month**: render the empty-note "Enter net pay for {month} to see the flow" (consistent with the savings-rate chart's behavior). Year mode uses `net_pay_total` and the same rule.
- **Zero-spend categories**: omitted (no zero links).

## 4. Paycheck sankey — beside the waterfall table

New card on `/paycheck`, driven by the same selected profile/breakdown the table renders (`BreakdownOut`, already `half_up2`-rounded by the router).

**Nodes & links (explicit `depth` per node):**

| depth | nodes |
|---|---|
| 0 | Gross |
| 1 | Taxable |
| 2 | Post-tax |
| 3 | Trad 401k, Dental/Vision, HSA, Withholding, Roth 401k, After-tax 401k, ESPP, **Net pay** |

All terminal sinks sit right-aligned at depth 3 (links may span columns — deliberate; the eye reads "everything ends here"). Links: Gross → {Trad 401k, Dental/Vision, HSA, Taxable}; Taxable → {Withholding, Post-tax}; Post-tax → {Roth 401k, After-tax 401k, ESPP, Net pay}.

- **Colors:** terminal deduction/tax nodes take fixed PALETTE slots in waterfall order; intermediates (Taxable, Post-tax) are MUTED gray — they are restatements, not destinations; Net pay is POSITIVE green (§3's convention).
- **Zero-valued branches are omitted** (e.g. `after_tax_401k = 0`), not drawn at zero width.
- **Rounding honesty:** the displayed lines deliberately do not reconcile to the cent (`paycheck_calc.py` module docstring — net is authoritative, lines are display-rounded). The sankey uses the same rounded values the table shows; a ±$0.01 imbalance is invisible at link-width scale and the tooltip matches the table exactly. Do **not** re-derive from full precision — the two surfaces must never disagree.
- **Negative guard:** `net_pay` (and in pathological profiles, `taxable`/`post_tax`) is genuinely negative-capable. If any node value < 0, skip the sankey and render the empty-note "This profile's deductions exceed pay — see the table" (the table remains the always-correct surface).

## 5. Testing

- Vitest on both option builders (house `*ChartOptions.test.ts` pattern): node/link construction, palette-slot reuse against the stacked chart's assignment, Saved/Drawdown/omission edge cases, deficit month, zero branches, negative guard, escapeHtml on category names, month-vs-year datasource.
- No backend tests (no backend changes).
- Manual render pass per the dataviz procedure step 7 (label collisions at ~10 categories, 220–320 px card heights, &lt;1000 px card collapse).

## 6. Out of scope (v2 candidates)

- Grand-unified yearly sankey (income → taxes → categories → savings destinations) — needs the taxes summary joined in; revisit after both v1 sankeys ship.
- Taxes-year sankey (waterfall already tells it), net-worth flows (no flow data), click-through from sankey links to records (no transaction layer).
