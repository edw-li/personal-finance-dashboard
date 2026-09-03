# Chart grammar — design

**Date:** 2026-09-03
**Status:** drafted from the pre-approved audit recommendations; ready for plan-writing
**Source:** `docs/superpowers/specs/2026-09-02-fresh-eyes-dashboard-audit.md` §12 (chart system), §13 T5,
post-fix ranking item 9, plus the chart items in §1, §3, §5, §6, §7 (incl. the addendum) and §8.
Second of five polish/feature specs; builds on `2026-09-03-shell-grammar-design.md` (§5 PageFrame,
§8 Segmented, §11 theme bridge) and the primitives lane `shell-1a` already built (`src/theme/tokens.ts`,
`charts/theme.ts` `buildTheme`, `charts/recolor.ts`, `EChart.tsx` re-init on theme version). Those are
composed with, not redesigned.

## 1. Context and goals

The app draws 30 ECharts mounts from 22 exported builders in 14 `*ChartOptions.ts` modules plus seven
inline options in `NetWorthPage.tsx` (stack, drill) and `SpendingPage.tsx` (bars, month pie, heatmap,
savings rate, trends). The builders share a posture (pure, no React, dark constants from
`charts/theme.ts`) but not a grammar. Catalogued: the grid literal `{70,24,40,28}` in eight places
with six near-variants; the compact money axis formatter ~20 times; the bar border/emphasis pair six
times; `AxisTooltipParam` five times; `roundTo`/`cents` four times; `legend: { top: 0 }` ten times,
never `scroll`; two tooltip dialects (`valueFormatter` ×15, hand-built HTML ×12 in three
micro-grammars) with no ordering and the line axisPointer on every bar chart; three chart-header CSS
copies; fifteen bespoke `empty-note` sentences; `animateEntrance={!fromCache}` forgotten on 8 of 22
animated mounts; `ariaLabel` on 14 of 30; export on 6; three motion clocks (CSS 120/180 ms, count-up
350 ms, ECharts 1000/500 ms) with `REDUCED_MOTION` frozen at module load. Reference lines already share
one vocabulary (dashed MUTED), annotations share `charts/markLine.ts`, sankeys share `charts/sankey.ts`;
the grammar extends those three successes to everything else.

Goals, from the audit: one tooltip contract; one header/lifecycle grammar per chart card; a house
motion block with live reduced motion; linked and aligned same-axis siblings; legends that scroll and
persist; export and a table twin everywhere; `ariaLabel` required by the compiler; entity colors stable
across pages; then the specific visual fixes (§15).

## 2. Decisions

| Decision | Choice |
|---|---|
| Central approach | Helpers inside builders + one `ChartCard` wrapper for chrome and lifecycle (§4). No option compiler; no post-processing beyond `EChart`'s existing recolor / reduced motion / entrance |
| Where it lives | `src/charts/*` (non-React chunk) for anything data-shaped; `src/components/ChartCard.tsx` for the mount |
| Byte-identical rule | A migrated builder emits the same dark option unless a §15 fix names the change; existing builder tests are the pins |
| Range controls | The shell `ScopeBar` owns `range`; `ChartCard.controls` carries only chart-local toggles, rendered with the shell `Segmented` (`toggle`, `sm`) |
| Window vocabulary | Scope `All · 1Y · YTD` (shell); chart-local fetch windows `1Y · 3Y · All`, unreachable chips disabled, "history since …" caption; Projection's `1/5/10/40Y` are horizons and stay |
| Tooltip swatches | CSS custom properties (`var(--chart-1)`), never a hex in formatter markup — the one thing `recolor.ts` cannot reach follows the theme for free |
| Legend solo | Out: no native event, and a synthesized dblclick fights the first click's toggle. Focus and scroll are in |
| Diverging ramp | Added to `tokens.ts` (9 steps, orange ↔ neutral ↔ blue); used by the heatmap's "vs average" mode and the heat-treemap |
| Vesting cumulative line | Out — it squashes the per-vest bars into the floor on the shared axis; a "Vested · Unvested (est.)" strip carries the figures |
| Dual axes | The tax trend's secondary percent axis goes (dataviz: one axis); the effective rate becomes a direct label on each year's cap |
| Motion clock | Entrance 450 ms `cubicOut`, update 300 ms `cubicInOut`, 12 ms stagger on stacks; StatTile count-up 450 ms; CSS hover stays 120 ms (a different job) |
| Textures | Opt-in only (`Appearance › Chart patterns`) via `aria.decal` |

## 3. Scope

**In:** the `charts/` units in §5; the diverging token tuple with its recolor/CSS/contrast plumbing;
`EChart` changes (required `ariaLabel`, `group`, live reduced motion, decals); `ChartCard` +
`ChartTable` + export menu (Table, Copy, captioned PNG); `useReducedMotion` shared with `StatTile`;
migration of all 22 builders and the seven inline options (into `netWorthChartOptions.ts` /
`spendingChartOptions.ts`); every mount onto `ChartCard`; the §15 fixes; the conformance test;
deletion of the three header CSS copies and the duplicated helpers.

**Out:** mobile and anything below 1180 px; transaction-level spending; realized gains / XIRR
columns and charts; legend double-click solo; the Overview "hollow placeholder months" and per-card
"as of" chips (honesty theme); new data views not listed in §15 (category rank bump, indexed compare,
card economics bars, utilization over time); any backend change.

## 4. Approaches considered

**A. Declarative `ChartSpec → option` compiler.** One schema compiled to `EChartsOption`; conformance
by construction. Rejected: the 29 option sources include sankeys, a treemap, a waterfall, a Monte Carlo
fan, a heatmap and a bracket ladder — each grows the schema a knob, migration is big-bang, byte-identical
dark output cannot be held, and it will not land in one night.

**B. Shared helpers composed inside builders.** `MONEY_GRID`, `moneyAxis()`, `axisTooltip()`,
`referenceLine()`… replace literals one builder at a time; domain logic stays put; values equal today's
literals so migrations are byte-identical. Weakness: conformance is convention until a test enforces
it, and it says nothing about headers, states, aria or export.

**C. Wrapper that post-processes options.** `ChartCard` injects grid, formatters, order and motion at
`setOption` time. Rejected as the main mechanism: inferring "which axis is money" and "which series are
references" from a heterogeneous option is heuristics, invisible to builder tests, and forks what the
builder says from what is drawn — `recolor.ts` shows how many special cases one such pass accumulates.

**Chosen: B for options, a thin C for the mount.** Helpers carry everything data-shaped, enforced by a
conformance test over fixtures (§17); `ChartCard` carries chrome and lifecycle and never rewrites
series. `EChart` keeps its three existing option-level touches (recolor, reduced motion, entrance gate)
plus the aria decal merge.

## 5. Architecture and module map

```
src/charts/
  grammar.ts      MONEY_GRID + variants · moneyAxis · pctAxis · monthAxis/dateAxis · BAR_MARKS · LINE ·
                  WASH · roundTo · cents · stagger          (values = today's literals)
  tooltip.ts      axisTooltip({unit, groups, totalLabel, shareOf, references, annotations, pointer})
                  itemTooltip({unit, body}) · swatch() · isGrammarTooltip (test brand)
  legend.ts       legendFor(count, selected) · FOCUS
  markLine.ts     (existing) + anchorLabel · todayRule · arrivalRule · afterArea · percentileMarks · zeroLine
  reference.ts    referenceLine(name, data, {step}) — absorbs budgetChartOptions.budgetStepSeries
  scales.ts       sequentialVisualMap · divergingVisualMap · rowNormalize · vsAverage
  entities.ts     GROUP_COLORS re-export · personSlot(people, id) · slotColor · foldColor
  waterfall.ts    waterfallSteps/waterfallSeries — lifted from taxChartOptions (reused by the NW bridge)
  motion.ts       (existing) + MOTION block consumed by buildTheme
  fixtures/       one <builder>.fixture.ts per builder: { name, kind, build: () => option | null }
  conformance.test.ts
src/components/
  ChartCard.tsx   header · hint · controls · export row · states · EChart · zoom hint · footer
  ChartTable.tsx  the accessibility twin: an ExportTable as <table class="data-table"> in <details>
  useReducedMotion.ts  matchMedia + change listener; EChart and StatTile both read it
```

Modified: `EChart.tsx` (required `ariaLabel`, `group` → `echarts.connect`, live reduced motion, decal
merge), `ChartExportMenu.tsx` (Table, Copy, captioned PNG), `charts/echarts.ts` (`MarkArea`,
`MarkPoint`, `Aria`, `VisualMapPiecewise` components; export `connect`), `charts/theme.ts` (motion keys,
tooltip `className`), `theme/tokens.ts` + `index.css` + `recolor.ts` (diverging tuple), `StatTile.tsx`,
`AppearanceCard.tsx`, `panels.css` (`.chart-card*`, `.chart-tip*`), every builder module, every mount,
and the three page CSS files whose header copies go.

Each unit answers what it does, how it is used and what it depends on in its module docstring, and is
testable without mounting a page.

## 6. ChartCard

```ts
interface ChartCardProps {
  title: string               // eyebrow, sentence case
  hint: string                // InfoHint copy — required
  ariaLabel: string           // one sentence: what the chart SHOWS — required
  option: EChartsOption | null
  empty: string               // the sentence shown when option is null — required, no default prose
  exportName: string          // {name}.png / .csv; the PNG caption's slug
  csv?: () => ExportTable     // enables CSV and Table
  caption?: string            // "as of Aug 14, 2026" — PNG subtitle
  height?: number             // default 320
  controls?: ReactNode        // chart-local Segmented(s) — never scope controls
  actions?: ReactNode         // rare: the drill-in's "All months" button
  footer?: ReactNode          // drill-hint paragraph(s)
  zoomable?: boolean          // renders ChartZoomHint; the option carries dataZoom
  group?: string              // echarts.connect group
  busy?: boolean              // card-local revalidation (HoldingDetail's window fetch)
  error?: string | null       // card-local advisory — never the page banner
  span?: 6 | 12               // default 12
  // pass-through to EChart: onClick onHover onHoverEnd instanceRef onLegendChange onDataZoom zoomWindow
}
```

Rendering: `<section class="card chart-card span-N">` → header row (`<h2 class="eyebrow">{title}
<InfoHint/></h2>` left; `controls` then `actions` right) → export row → body → `ChartZoomHint` when
`zoomable` → `footer`. Body by state: null + `busy` → a `.skeleton` block of `height`; null + `error` →
`.empty-note` with the error; null → `.empty-note` with `empty`; option present → `EChart`, wrapped in
`loading-dim is-loading` while `busy` (the previous render holds — no skeleton flash on refetch).
`animateEntrance` is `!usePageFrame().fromCache` from the shell context; the prop disappears from every
page. The shell `Segmented` renders every control: Stack by, Monthly/Quarterly, Month/Year,
Absolute/Row/vs average, Linear/Log, Compare/All, 1Y/3Y/All, Unrealized/Day change.

Success criteria: no `<EChart` outside `ChartCard` (tests excepted); no page-level chart-header CSS or
`.panel-title-row` around a chart; no `empty-note` chart fallback outside the card.

## 7. Tooltip grammar

`axisTooltip()` returns a complete `tooltip` component: `trigger: 'axis'`, `axisPointer.type` from
`pointer: 'line' | 'shadow'` (bars pass `shadow`), `className: 'chart-tip'`, and one formatter. Row
order is the contract: **bold axis header → group rows sorted valueDesc → bold Total → other data
series in series order → reference rows (muted) → annotation lines**. Rows render as a swatch · label ·
value grid; the value is the strong element, tabular, right-aligned. Swatches are a 10×2 stroke for
line series and an 8×8 square for bars/areas, painted with `var(--chart-N)` / `var(--other-series)`
resolved from the series color through `swatch(color)` (a token-hex → CSS-variable map); a color not in
the map falls back to the hex.

Options: `unit: 'money' | 'percent' | 'shares'` picks the formatter; `groups` names the stack members
(sorted, totalled; `shareOf` adds "(xx%)" of the group total); `totalLabel` defaults to "Total";
`references` lists after the total, excluded from it; `annotations(param)` returns escaped lines for
marker series (Notes, Events); `absentText` prints once when no group row is finite. Null/NaN rows are
dropped, never dashed. Every series name passes through `escapeHtml` unconditionally — the "own
constants only" exemption ends. `itemTooltip({ unit, body })` covers pies, treemaps, heatmaps,
waterfalls and ladders: `body(param)` returns `{ value, label, sub? }`, laid out value-first. The
projection's baked-hex `BAND_MARKER` becomes `swatch(PALETTE[0], { wash: true })`. `charts/sankey.ts`'s
factory already conforms and is left alone.

## 8. Axes, grids, alignment and linking

`MONEY_GRID = { left: 70, right: 24, top: 40, bottom: 28 }` with named variants: `noLegend` (top 16),
`endLabel` (right 84), `horizontal` (left 130, right 40, top 8), `heatmap` (left 130, bottom 96),
`fan` (left 76). Builders take a variant, never a literal. `moneyAxis({ zero = true, log = false })`
→ compact labels; `zero: false` sets `scale: true` and is legal only on unwashed lines (the price
chart), `log` only on unwashed forms. `pctAxis({ floor, ceiling })` reproduces the savings-rate extent
functions. `monthAxis(labels, { gap })` / `dateAxis(labels)` return the category axis, `boundaryGap:
false` for lines; ≤ 12 categories set `interval: 0`.

Alignment: siblings on one x-axis share one grid variant and one `group` — Net worth (stack + drill,
both `endLabel`), Spending (bars + savings + trends), the small multiples. `EChart` sets `chart.group`
and calls `connect(group)` in its init effect (so a theme re-init re-connects), `disconnect` on
dispose; connected charts share axisPointer and zoom, which the mirrored `onDataZoom` state already
reconciles.

## 9. Legends

`legendFor(count, selected)` → `{ top: 0, type: count > 8 ? 'scroll' : 'plain', selected,
pageIconColor: MUTED, pageTextStyle: { color: MUTED } }`. Scroll legends never wrap, so the
`grid.top: 40` collision is structurally gone. Every multi-series card mirrors `onLegendChange` into
page state and feeds it back (Projection ×2, tax trend, TC, vesting, credit line gain it). Multi-series
line/bar series set `emphasis: { focus: 'series' }` via `LINE`/`BAR_MARKS`; single-series charts carry
no legend. The projection's two outer washes share the exact name `10–90% band`, so one entry toggles
both (audit friction 7).

## 10. References and annotations

Three vocabularies, one helper each: **reference series** (a comparison with its own data — the 4%
rule renamed `Sustainable spend`, budgets, FI target, averages) = `referenceLine()` dashed MUTED 2 px,
`symbol: 'none'`, `z: 9`, optional `step: 'end'`; **annotation rules** (events on the time axis —
Married, retirements, Today, FI, Coast FI) = `markLine.ts`'s dashed MUTED 1 px with `insideEndTop`
label, anchored through `anchorLabel(isoCategories, iso, format)` (generalizing `anchorMonthLabel`,
kept as a wrapper); **baselines** = `zeroLine()` solid MUTED 1 px. New: `todayRule`, `arrivalRule`,
`afterArea(fromLabel, label)` = `markArea` in `SURFACE_2` at 0.35 opacity with a muted label, and
`percentileMarks(points)` = `markPoint` circles (size 8, MUTED fill, INK border) labelled `p10/p50/p90`.
Data is solid; thresholds and events are dashed; nothing else is.

## 11. Motion

`MOTION = { animationDuration: 450, animationEasing: 'cubicOut', animationDurationUpdate: 300,
animationEasingUpdate: 'cubicInOut' }` spreads into `buildTheme()` so every chart inherits it;
`stagger(seriesIndex)` adds `animationDelay: idx * 12` to stacked bar series (a function — invisible to
`EChart`'s JSON fingerprint, which is correct: it never changes). `useReducedMotion()` replaces
`EChart`'s module-scope constant and `StatTile`'s inline `matchMedia` read; it subscribes to the media
query's `change` event, and `EChart` lists it as a dependency of the `setOption` effect so a live OS
change re-applies `animation: false`. `StatTile`'s count-up becomes 450 ms. `motion.ts`'s stale comment
("ScatterChart is not registered") is corrected.

## 12. Color

- **Categorical** — `PALETTE` fixed slots, assigned by entity, never rank, never past 8: account
  groups `GROUP_COLORS`; people `personSlot(people, id)` (primary 0, others by id, Joint last — lifted
  from `NetWorthPage`; the money-flow salary tints stay); spending categories by all-time-total rank
  (`topIds`, already shared by bars, pie, sankey, heatmap); cards by roster order; grants by feed order;
  drill/trend picks by lowest free slot. Tails fold into `OTHER_SERIES_COLOR`. Aggregates (Net worth,
  Total comp, Total line, Net pay) wear INK — the existing convention, written down.
- **Sequential** — `SEQUENTIAL_BLUE` through `sequentialVisualMap({ min, max, formatter, labels })`;
  ordinal uses (tax jurisdictions, ladder tiers) start at index 4 for 3:1 on the surface.
- **Diverging** — `DIVERGING` joins `ThemeTokens` as a 9-tuple, orange arm ← neutral → blue arm, the
  midpoint receding into the card. Starting values, dark: `#f28b57 #e57236 #b85a2a #6b4436 · #272c37 ·
  #2b4a7a #2f6bb8 #4a8ee6 #7fb2f0`; light: `#a63f12 #c8501f #e07a4e #f2b899 · #e5eaf1 · #a9c6f0
  #6f9ddf #3f76cb #2559a8`. `cssDeclarations` emits `--diverge-1…9`, `index.css` carries both blocks,
  `recolor.ts` maps the tuple by position under its ramp rule, and `tokens.test.ts` asserts monotone
  lightness per arm, ≥ 3:1 at each arm's two outer steps on both surfaces, and that no step equals
  another token hex (the recolor election is untouched). `divergingVisualMap({ span, center: 0,
  formatter })` is the only consumer API.
- **Status** — POSITIVE/NEGATIVE/warn stay reserved for meaning (card-value sign, Saved/Drawdown, the
  price chart's above/below-cost wash) and never identify a series. Text wears text tokens; a slot hue
  may color a chip border, never its text.

## 13. Number formatting

Money axes compact (`$1.2K`, `$1.45M`), tooltips and end labels full currency, percent axes
`formatPct(v, {signed:false, decimals:0})`; tooltip values `font-variant-numeric: tabular-nums` via
`.chart-tip-value`; one `roundTo`/`cents` in `grammar.ts` with the display-only-geometry doc comment
the four copies carried. The card-value chart's full-currency axis becomes compact.

## 14. Accessibility and export

`EChart`'s `ariaLabel` becomes required; `ChartCard` forwards its own required prop. The ⤓ menu grows
**Table** (toggles `ChartTable` under the chart — the builder's `ExportTable`, so no value is
tooltip-only) and **Copy** (`navigator.clipboard.write` with a PNG `ClipboardItem`; on failure the PNG
downloads and the toast says "Clipboard unavailable — downloaded instead"). PNG export composites a
caption strip — `title`, `caption`, "Exported {date}" in INK/MUTED on the resolved theme's `SURFACE` —
via an offscreen canvas. `Appearance › Chart patterns (Off/On)` stores `finance.chartDecals`; when on,
`EChart` merges `aria: { enabled: true, decal: { show: true } }` so stacks and pies gain 45°/135°
textures.

## 15. The specific visual fixes

| # | Fix | Grammar used | Visible change |
|---|---|---|---|
| F1 | Spending heatmap modes `Absolute · Row · vs average` (default **Row**), labelled scale legend, all-zero rows behind "Show N dormant" | `rowNormalize`, `vsAverage` (trailing-12 mean before each month), `sequentialVisualMap`, `divergingVisualMap` | Hint: "Row: each category on its own 0 → max scale. vs average: orange = above its trailing 12-month average, blue = below." |
| F2 | Net-worth stack: floor `min: (e) => Math.min(0, e.min)`; liabilities drawn only when ≥ 1% of assets at the latest month (always a tooltip row); `Share %` (100% composition) beside By group/By owner; "What moved — {month}" bridge card (waterfall by group, droppable) | `moneyAxis`, `waterfall.ts`, `axisTooltip({groups, totalLabel:'Assets'})` | Legend loses "Liabilities" when immaterial; hint says so |
| F3 | Projection: memoize both builders, persist legends, FI + Coast FI rules, post-FI area, p10/p50/p90 marks on the target line, `Median path` 1 px line, `Linear · Log` toggle, band washes share one name | `arrivalRule`, `afterArea`, `percentileMarks`, `legendFor`, `moneyAxis({log})` | New series "Median path"; labels "FI", "Coast FI", "After FI" |
| F4 | Holding price chart: `referenceLine('Avg cost')`, above/below-cost wash (piecewise `visualMap`, POSITIVE/NEGATIVE at 0.12), dated buy/sell/dividend markers (`buildEventMarkers` over daily bars), footer "+12.4% over this window · history since Aug 2025", chips `1Y · 3Y · All` with unreachable ones disabled | `reference.ts`, `markLine.ts`, `Segmented` | Chip "Max" → "All" |
| F5 | Heat-treemap: industry (or type label) → ticker, area = market value, fill = `Unrealized %` (clamped ±50%) or `Day change`; labels ticker · compact MV · %; slivers < 0.5% fold into an "Other" cell per industry; click → `?ticker=` drill-in | `divergingVisualMap`, `itemTooltip` | Replaces the single-variable treemap |
| F6 | Vesting: `todayRule`; future bars hatched (`itemStyle.decal`, 45°, tone-on-tone) with "est." in the tooltip; strip "Vested $X · Unvested $Y (est.)"; entrance gated by the frame; aria + CSV | `todayRule`, `BAR_MARKS` | Footnote "Hatched = at today's quote" |
| F7 | Every tooltip through `axisTooltip` / `itemTooltip`; `shadow` pointer on bars | §7 | Value-first ordered rows everywhere |
| F8 | Net-worth pair and Spending trio aligned (one grid variant) and linked (`group`) | §8 | Drill right inset 84; savings-rate left 60 → 70 |
| F9 | Scroll legends past 8 entries; persisted picks on the charts that reset today | §9 | — |
| F10 | House motion block; live reduced motion; StatTile on the same clock | §11 | — |
| F11 | Every nameless mount named: Net-worth stack and drill-down; Spending bars, month pie, savings rate, trends; Portfolio performance; holding price; dividends; tax waterfall, trend, pie, ladder; vesting; TC trajectory. Table twin; decals opt-in | §14 | — |
| F12 | Export on all 30 mounts; CSV added for TC, vesting, credit line, card value, price history, the full heatmap matrix (addendum S7), savings rate, trends, drill-down, waterfall, sankeys (nodes + links), Overview trend and bars | `ChartCard.csv` | — |
| F13 | Paper cuts: compact axis on card values; `4% rule` → `Sustainable spend` (hint: "what your investable assets could fund each month at your safe withdrawal rate — Settings"); `barMaxWidth` 46 → 24 on the tax and comp stacks; `motion.ts` comment; `Max` → `All` | — | Two renamed strings, thinner bars |
| F14 | Overview recent-spend bars gain a 12-month average `referenceLine` | `reference.ts` | Legend entry "12-mo average" |
| F15 | Tax composition trend drops its percent axis; effective rate as a direct label on each year's cap | `BAR_MARKS.capLabel` | Legend loses "Effective rate"; tooltip keeps the rate row |

## 16. Backend changes

None. Every input is already on the wire: `fi_month`, `coast_fi_month`, `bands.p50`, `fi_month_p10/
p50/p90`; `avg_cost`, `industry`, `holding_type`, `unrealized_gl_pct`, `day_change_pct`, `weight_pct`;
`is_past`; the spending matrix and budgets.

## 17. Testing

**Unit (vitest), one file per unit:** grammar; tooltip (row order, escaping, absent text,
CSS-variable swatches, pointer); legend; markLine (anchors, area, marks); reference; scales; entities;
waterfall (tests lifted from taxes); motion (theme keys, stagger, live media change); tokens (diverging
monotonicity, contrast, distinctness, CSS drift); recolor (diverging ramp); `ChartCard` (five states,
required props, `fromCache` from context, controls, export row, Table toggle, group pass-through);
`ChartTable`; `EChart` (connect/disconnect per init, decal merge, live reduced motion; the existing 23
cases stay green); `ChartExportMenu` (Table, Copy fallback, caption composite).

**Conformance (`charts/conformance.test.ts`):** walks `charts/fixtures/*` and, per non-null option,
asserts: every color string is a token hex, `'transparent'` or `'source'`; every value-axis formatter is
the grammar's function (identity); `grid` is a named variant (cartesian kinds); the tooltip formatter is
branded by `tooltip.ts` or `sankey.ts`; bars carry `barMaxWidth ≤ 24` (the tax/comp `46` shrinks — a
§15 change, added to F13) and the `SURFACE` border; legends past 8 entries scroll; dashed `lineStyle`
only on reference/annotation series; stacked bars carry a stagger. `sankey`, `treemap` and `pie`
fixtures declare their grid/axis exemptions.

**Builder tests:** unchanged where §15 names no change; updated in the same commit where it does.

**Visual smoke:** the audit's headless walk in both themes at 1600 px over every chart page, plus hover
screenshots of one tooltip per grammar, the heatmap's three modes, the heat-treemap and the log-axis
fan. Console errors fail the run. Real-echarts probes precede merge for the four new forms
(heat-treemap hierarchy, decals, `markArea`, piecewise wash) — the 2026-08-25 lesson.

## 18. Rollout

1. **Primitives** (one lane, merges first): everything in §5 no page depends on — the `charts/` units,
   tokens/recolor/CSS, echarts registrations, `EChart`, `ChartCard`, `ChartTable`, export menu,
   `useReducedMotion`, StatTile, the Appearance control, the fixture harness with three fixtures.
2. **Migrate in parallel lanes**, each owning its pages' builders, inline options, fixtures, CSV
   builders and §15 fixes: Net worth + Overview (F2, F8, F14); Spending (F1, F8; small multiples as
   the `Compare · All` mode of the trends card, droppable last task); Portfolio (F4, F5, dividends,
   donut); Projection + Comp/ESPP (F3, F6); Taxes + Credit cards + Paycheck (F15, card-value axis,
   credit-line legend, sankey card). A lane is done when no `<EChart` sits outside `ChartCard` on its
   pages and dark options are byte-identical except where §15 says otherwise.
3. **Retire and verify:** delete the header CSS copies, duplicated `AxisTooltipParam`/`roundTo`,
   `budgetChartOptions.ts` (absorbed), standalone `ChartZoomHint` usage; conformance green over all
   fixtures; full suites; two-theme smoke.

## 19. Out of scope

Legend solo; hollow placeholder months and per-card "as of" chips; category rank bump, indexed
compare, card economics bars, utilization over time, dividend YoY ghosts, tile sparklines; keyboard
navigation of data points beyond the Table twin; mobile; any change to stored data or endpoints.

## 20. Risks and mitigations

- **`connect` across theme re-inits and `notMerge` rebuilds:** group set and `connect` called in the
  init effect (per re-init), `disconnect` on dispose; an `EChart` test covers it.
- **Conformance false positives on exotic forms:** fixtures declare exemptions; assertions are
  additive so a lane can land before the last rule tightens.
- **Byte-identical claims drifting:** builder tests are the pins; a pin changes only with a §15
  reference in the commit message.
- **New forms behaving differently in real canvas than jsdom** (decals, piecewise wash, treemap
  hierarchy labels): real-echarts probe before merge.
- **`ClipboardItem` unsupported (Firefox default):** download fallback with the toast; tested.
- **Diverging values are starting points:** the tokens test is the acceptance; implementers move
  lightness, hold hue, until it passes.
- **vs-average over sparse history:** blank cells until six prior months exist; the legend says so.
- **Small-multiples cost (19 instances):** tests mock `EChart` as pages already do; opt-in, droppable.

## Summary for the coordinator

1. Approach: shared helpers inside builders + one `ChartCard` wrapper for chrome/lifecycle; no compiler, no option post-processing; a fixture-driven conformance test enforces it.
2. `EChart`: `ariaLabel` required, `group` → `echarts.connect`, live reduced motion, opt-in decals; its recolor/entrance/reduced-motion touches stay.
3. One tooltip contract (value-first rows: valueDesc groups → Total → references → annotations; CSS-variable swatches; shadow pointer on bars); one legend rule (scroll past 8, persisted picks, series focus).
4. House motion 450/300 ms + 12 ms stagger in `buildTheme`; StatTile on the same clock; `useReducedMotion` shared.
5. Color: entity slots in `entities.ts`; a 9-step diverging ramp in tokens with recolor/CSS/contrast plumbing; status colors stay reserved.
6. Fifteen fixes F1–F15 (heatmap modes, zero-floored NW stack + Share %, projection arrival/log/median, price chart cost+markers+wash, heat-treemap, vesting today/hatched, tax trend single axis, export+Table+aria everywhere); no backend change.
7. **7 plans**: C1 primitives (first, alone); C2 Net worth + Overview, C3 Spending, C4 Portfolio, C5 Projection + Comp/ESPP, C6 Taxes + Credit cards + Paycheck (**five in parallel** after C1 merges); C7 retire + verify (last).
8. Each lane migrates its builders and inline options byte-identically except §15 changes, adds fixtures and CSV builders, and mounts every chart through `ChartCard`.
9. Testing: unit files per primitive, conformance over fixtures, builder tests as pins, two-theme smoke with tooltip/mode screenshots, real-echarts probes for the four new forms.
10. Deferred: legend solo, hollow placeholder months, new views beyond §15, mobile.
