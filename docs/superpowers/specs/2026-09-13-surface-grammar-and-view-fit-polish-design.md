# Surface grammar and view-fit polish — design

Date: 2026-09-13 · Status: **approved by the user 2026-09-13 ("rely on your recommendations for every decision point")**, implemented overnight 2026-09-13/14 in parallel worktree lanes; local merges only, no push.

Source review: `scratchpad/ux-audit-2026-09-13/reports/00-SUMMARY.md` and the five lane reports beside it (gitignored; the evidence is screenshot + `file:line`, this spec restates only what implementation needs). Every measurement quoted below was taken against a clone of the production book at 1440×900 and 1920×1080 unless stated.

## 0. Scope and non-goals

In scope — the user accepted all fifteen ranked ideas plus the "motion extras" and "whitespace extras", and asked for an easy, seamless path out of the Allocation view's "Unknown 65.6%":

1. Motion for every new surface (detail panel, chart Expand dialog, tab strip, accordions, popovers).
2. One sticky tab-strip placement.
3. Detail-panel chrome collapse (incl. the assistant inside it).
4. Light-theme fill / hairline / scrim / shadow tokens.
5. Row actions visible in horizontally scrolled tables.
6. Sandbox tabs open by default.
7. Loading states for lazily mounted content (Monthly update, Settings, Overview tiles).
8. No text outside section boundaries.
9. Balanced KPI rows (incl. Projection's sticky band).
10. No equal-height stretch voids (Settings pairs, Allocation pair).
11. One accordion policy: a Disclosure primitive plus conversion of the wrong-tool sites.
12. Tiles belong to a view's summary, not to every view.
13. Taxes: year + filing status into the scope row, tables grid, inputs form fit.
14. Copy pass (labels, enums, dev footer, prompt, "below", server fragments, review vocabulary).
15. Escape pops one panel level.
16. Motion extras: launcher offset under a dock, `aria-expanded` styling on the (i), visible resizer grip, keyboard tab activation without history growth, card cascade on Feed-driven pages.
17. Whitespace extras: Paycheck breakdown beside its flow, Overview deeper cards paired, Calendar strip footnotes out of the grid and shorter empty weeks, Add-event in the shared panel, reading-mode measure cap, viewport-aware dock width with persisted drag.
18. Allocation: a "Classify these N" path from the Unknown slice/row to an always-visible classification card filtered to unclassified holdings, inline classification, and no "Unknown" target row.

Out of scope (larger concerns left for a later decision): month-review vocabulary redesign beyond the label map, attention-policy rewrite beyond hiding the permanent current-month item, assistant two-pane dock, Portfolio Overview/Income rebalance and ledger grouping, Settings rail deletion beyond hiding the bands, Taxes "Save all", table row-action menus, launcher relocation, View Transitions morphs, backend schema changes. Nothing here touches the database.

## 1. Delivery shape

Six implementation lanes in git worktrees under `.worktrees/`, two foundation lanes first, four page lanes after they merge, then a verify lane on main:

| Lane | Branch / worktree | Owns |
| --- | --- | --- |
| F1 panel-and-chart surfaces | `polish/f1-surfaces` | `DetailPanelProvider.tsx`, `details.css`, `MetricInspector.tsx`, `SelectionDetail.tsx`, `explainSelection.ts`, `ChartCard.tsx`, `ChartSurface.tsx`, `chartInteractions.css`, `EChart.tsx` (height fill), `AssistantDrawer.tsx`, `assistant.css`, `AssistantDockMount.tsx`, `utils/metricReceipt.ts`, `types/metrics.ts` (if a label helper needs a type) |
| F2 shell grammar and tokens | `polish/f2-shell` | `PageFrame.tsx`, `LocalSections.tsx`, `localSections.css`, `shell.css`, `panels.css` (keyframes, kpi, disclosure, sticky actions, button states), new `components/Disclosure.tsx` + `disclosure.css`, new `components/useScrollEdges.ts`, `useStagger.ts`, `shell/Feed.tsx`, `PageSkeleton.tsx`, `StatTile.tsx`, `theme/tokens.ts`, `theme/tokens.test.ts`, `index.css`, `charts/recolor.ts`, `Layout.tsx` (only if the launcher offset needs it), plus the mechanical `sections=` wiring in every tabbed page and the `.local-section-toolbar` removal |
| P1 overview-update-spending | `polish/p1-overview` | `OverviewPage.*`, `components/overview/*`, `MonthlyUpdatePage.*`, `components/monthly/*`, `SpendingPage.*`, `components/spending/*`, `spendingChartOptions.ts`, `api/monthReview.ts` labels |
| P2 networth-portfolio-cards | `polish/p2-portfolio` | `NetWorthPage.*`, `PortfolioPage.*`, `components/portfolio/*`, `portfolio.css`, `allocation.css`, `CreditCardsPage.*`, `components/creditcards/*` |
| P3 income-taxes | `polish/p3-income` | `PaycheckPage.*`, `components/paycheck/*`, `CompPage.*`, `components/comp/*`, `EsppPage.*`, `components/espp/*`, `TaxesPage.*`, `components/taxes/*`, `sandbox/SandboxPanel.tsx` (defaultOpen prop only) |
| P4 projection-calendar-settings | `polish/p4-planning` | `ProjectionPage.*`, `components/projection/*`, `CalendarPage.*`, `components/calendar/*`, `SettingsPage.*`, `components/settings/*`, `settings.css` |
| V verify | on `main` | gates, the audit driver re-run, acceptance assertions, screenshots, hand-off notes |

Rules: a lane edits only the files it owns; a page lane that needs a primitive not delivered by F1/F2 adds it locally in its own stylesheet under a page-scoped selector and reports it, rather than editing shared files. Implementers run `model: opus` (house mandate); reviewers run the default model. Each lane: implement → self-check gates (`tsc -b`, `eslint .`, `vitest run` scoped then full, `vite build` at the end) → reviewer round → fixes → local merge into main by the lead. No pushes. Worktree and branch deletion, DB drops and any other prompt-prone command are deferred to the very end of the night.

House constraints every lane must respect:

- `motion.test.ts`: no literal finite duration in any stylesheet — durations are `var(--t-*)` only; `index.css` `:root` must match `motion.ts` character for character. New durations are not needed; reuse `--t-fast` 120ms (exits, hovers, popovers), `--t-xfade` 180ms (content swaps), `--t-page` 240ms (surfaces), `--t-nav` 200ms (indicator).
- `tokens.test.ts`: every palette token exists in both `index.css` blocks with the same value as `tokens.ts`; `charts/recolor.ts` lists token slots explicitly — a new token is added there too (or explicitly excluded with a comment).
- All motion lives under `@media (prefers-reduced-motion: no-preference)` or uses tokens that `reduce` zeroes; WAAPI paths gate on `prefersReducedMotion()` from `useReducedMotion.ts`.
- Per-page stylesheets never depend on another page's sheet (`OverviewPage.css` header comment). `.panel` is retired from portfolio components in favour of `.card` (see §12); `.spending-metric-context` moves to `SpendingPage.css` (and is then deleted with its line).
- Existing tests are updated, not deleted; new behaviour gets a focused test (Testing Library / jsdom; motion timing is not unit-tested — the verify lane measures it in a browser).

## 2. Motion for surfaces (F1, F2)

### 2.1 Shared keyframes (F2, `panels.css`, inside the existing no-preference block)

```css
@keyframes pop-in   { from { opacity: 0; translate: 0 -4px; } }
@keyframes panel-in { from { opacity: 0; translate: 0 6px; } }
@keyframes backdrop-in { from { opacity: 0; } }
```

Applied by F2 to: `.info-hint-bubble`, `.chart-export-popover`, `.chart-selection-summary`, `.disclosure[open] > .disclosure-body`, `.popover-surface` (the shared popover class introduced in §11) — `animation: pop-in var(--t-fast) var(--ease-out) both`. New controls join the existing hover-transition list (`panels.css` ~L666): `.metric-info-button`, `.local-section-nav [role=tab]`, `.assistant-icon-button`, `.detail-panel-resizer`, `.disclosure > summary`.

### 2.2 Detail panel (F1)

- Dock open: `.detail-layout-content { transition: margin-inline-end var(--t-page) var(--ease-out); }` (the margin stays an inline style; the transition is CSS). `.detail-panel-dock { animation: detail-panel-in var(--t-page) var(--ease-out) both; }` with `detail-panel-in { from { transform: translateX(24px); opacity: 0 } }`.
- Exit: the provider keeps the last request mounted with `leaving: true` and class `.is-leaving` (`detail-panel-out` over `--t-fast`, `to { transform: translateX(24px); opacity: 0 }`); the stack empties on `animationend` or a fallback timer of `MOTION_MS.fast + 50` (covers `reduce`, where 0ms animations may not fire the event). Focus restoration stays on the existing `activeId` layout effect, which now runs after the exit commit.
- Mode switch: one box model for all three modes so `inset`/`width`/`right`/`border-radius` transition over `--t-page`: `.detail-panel { position:absolute; inset: var(--dp-top,0) 0 var(--dp-bottom,0) auto; width: var(--dp-w) }`, expanded sets `--dp-top/--dp-bottom: 24px`, `--dp-w: min(1100px, calc(100vw - 48px))`, `right: max(24px, calc((100vw - var(--dp-w)) / 2))`. The backdrop mounts with `backdrop-in` over `--t-fast`. Dock→overlay animates the margin release (same transition); no special reservation.
- Drag: while the resizer has pointer capture the layout root carries `.is-dragging`, which sets `transition: none` on panel and content.
- Charts: `EChart`'s ResizeObserver keeps resizing per frame; F1 changes the call to `chart.resize({ animation: { duration: 0 } })` so ECharts never runs its own update animation on top of the CSS motion. Lane V measures the Spending page (three canvases + a sankey) during a dock open; if more than two frames exceed 32ms, F1's fallback is documented in its plan: the provider sets `data-panel-motion` on the layout root for the duration and `EChart` defers `resize()` until it clears.
- `--dock-width` is published on `document.documentElement` (`0px` when no dock); the assistant launcher uses it: `.assistant-launcher { right: calc(1.25rem + var(--dock-width, 0px)); transition: right var(--t-page) var(--ease-out) }`. The launcher is hidden (`display:none`) while the assistant itself is the active panel.

### 2.3 Chart Expand dialog (F1)

- `.chart-expanded-dialog[open] { animation: surface-in var(--t-page) var(--ease-out) both }`, `surface-in { from { opacity: 0; transform: translateY(8px) scale(.985) } }`; `::backdrop` gets `backdrop-in` over `--t-fast`. Exit uses `transition: opacity var(--t-fast), transform var(--t-fast), overlay var(--t-fast) allow-discrete, display var(--t-fast) allow-discrete` with `@starting-style`, inside `@supports (transition-behavior: allow-discrete)`; where unsupported the close stays instant (focus and scroll are already restored).
- Void fix: the dialog's card becomes a flex column (`.chart-expanded-dialog .chart-card { display:flex; flex-direction:column; height:100% }`, `.chart-expanded-dialog .loading-dim { flex:1; min-height:0 }`) and `EChart` accepts `height: number | 'fill'` (`'fill'` renders `height: 100%`; the ResizeObserver refits). `ChartCard` passes `'fill'` when expanded and drops the `innerHeight − 280` arithmetic.
- No View Transition morph in this batch.

### 2.4 Tab strip (F2)

- Indicator: `LocalSectionNav` renders `<span class="local-section-indicator" aria-hidden>` inside the tablist (`position:relative`); a layout effect on `state.section` sets `transform: translateX(tab.offsetLeft)` and `width: tab.offsetWidth`; `data-placed` is set after the first placement so the first paint is instant and later moves transition `transform, width` over `--t-nav`. A ResizeObserver on the tablist re-places on wrap or density change. The tab's own `border-bottom-color` becomes permanently transparent.
- Tab colour: `transition: color var(--t-fast), background-color var(--t-fast)` under no-preference.
- Panel swap: `LocalSectionPanel` runs, on activation after the first mount of the page, `el.animate([{opacity:0, translate:'0 6px'},{opacity:1, translate:'none'}], { duration: MOTION_MS.xfade, easing: EASE_OUT, fill: 'backwards' })` guarded by `prefersReducedMotion()`. The initially active section on page arrival does not animate (the page body entrance already does).
- Keyboard: arrow/Home/End activation calls `setSection(next, { replace: true })`; clicks keep pushing. `onChange` gains a second `options` argument so Credit cards' `removeParams` still works.
- No per-card cascade on tab switch; cards inside lazily mounted panels stay untagged by design.

### 2.5 Card cascade on Feed-driven pages (F2)

`useStagger.ts` exports `tagStagger(root: HTMLElement, startIndex = 0): number` (the existing loop body). `Feed` calls it once when its first payload lands, on its own root, only while `performance.now() - pageMountedAt < 3000` (a module-level timestamp `PageFrame` sets on mount via context), so a Feed landing later (revisit, tab switch, refetch) never replays a cascade. Cards tagged inside a hidden `LocalSectionPanel` are skipped (`el.closest('[hidden]')`).

### 2.6 Disclosure primitive (F2)

`components/Disclosure.tsx`: `<Disclosure summary={ReactNode} defaultOpen? open? onToggle? onOpen? className? id? name?>` renders `<details class="disclosure"><summary>{chevron}{summary}</summary><div class="disclosure-body">{children}</div></details>`. Chevron = lucide `ChevronRight` rotating 90° over `--t-fast`; summary styled as an eyebrow-weight row with the house focus ring; body gets `pop-in`; where `@supports (interpolate-size: allow-keywords)` holds, `::details-content` height transitions over `--t-fast`. `onOpen` fires once on first open (lazy loads). Adopted by F1 for `ChartTable`, `SelectionDetail` calculations and the assistant's computed-summary/reasoning/saved-finding blocks; by page lanes for every remaining genuine disclosure (§11).

## 3. Sticky sections slot (F2)

`PageFrame` gains `sections?: ReactNode`, rendered inside the existing sticky element as its first row:

```tsx
<div ref={scopeRef} className={`page-frame-scope${stuck ? ' is-stuck' : ''}`}>
  {sections !== undefined && <div className="page-frame-sections">{sections}</div>}
  {scopeRow !== undefined && <div className="page-frame-scope-row">{scopeRow}</div>}
</div>
```

The sentinel, the `is-stuck` hairline and the `--sticky-inset` measurement (offsetHeight of the same element) are untouched, so the reveal timelines, scrims and InfoHint flip keep working. `.page-frame-scope:empty` still hides an empty block. `.page-frame-sections` spans the full content width; `.local-section-nav` inside it drops its own margin and border (`margin:0; border-bottom:0`) and the strip's rule becomes `.page-frame-sections { border-bottom: 1px solid var(--border) }`. Order inside the block: strip first (which view), scope row second (for which period/owner). `LocalSectionNav` gains `trailing?: ReactNode` rendered right-aligned on the tab baseline (Net worth's Monthly/Quarterly `Segmented`); `.local-section-toolbar` is deleted.

F2 rewires every tabbed page to `sections={<LocalSectionNav … />}`: Net worth (with `trailing`), Portfolio, Spending (moves from `subheader`), Credit cards, Paycheck, Comp, ESPP, Taxes, Projection, Settings (moves from `scopeRow`; the strip is no longer 423px wide). Settings' `h2.settings-section` bands become `visually-hidden` (ids kept for legacy anchors) in P4.

## 4. Panel chrome (F1)

Header becomes the only chrome row: `[Back ‹] [title · subtitle] … [mode Segmented] [actions] [×]`.

- Back and Close are icon buttons (`ChevronLeft`, `X`, 14px, `.assistant-icon-button` scale) with `aria-label`s ("Back to {previous title}", "Close details").
- Mode control: `Segmented variant="toggle" size="sm"` with icon-only options (`PanelRight` dock, `Layers` overlay, `Maximize2` expanded / `Minimize2` restore), each with `title` + `aria-label`; the Dock option carries the existing disabled reason as `title`. The mode toolbar row is removed. `active.actions` renders after the mode control.
- Persistence: `localStorage` keys `finance.detailPanel.mode` and `finance.detailPanel.width` (read on mount, written on change; a browser preference, not financial data, so no server pref).
- Default width `clamp(400px, 26vw, 560px)` when nothing is stored; dragged width wins.
- Subtitle renders inline after the title when it fits one line (`.detail-panel-heading { display:flex; gap:.5rem; flex-wrap:wrap; align-items:baseline }`); the "About this number" subtitle is dropped (the header's title is the metric; the receipt's first line is the value).
- Focus order: DOM order heading → body → header controls → resizer (moved to the end of the aside, positioned with CSS as today). Tab stops before content: zero.
- Escape: `stackRef.current.length > 1 ? back() : close()`; the unit test that pinned whole-stack close is updated to expect two Escapes.
- Resizer grip: `.detail-panel-resizer::after` 3×32px pill in `var(--border)`, accent on hover/focus.
- `.metric-info-button[aria-expanded="true"]` and `.info-hint[aria-expanded="true"]`: accent colour + `color-mix(in srgb, var(--accent) 14%, transparent)` background.
- Reading mode: `.detail-panel-expanded .detail-panel-body > :not(.assistant-dock-mount) { max-width: 72ch; margin-inline: auto }`; `.metric-receipt-list > div { display:grid; grid-template-columns: minmax(0,1fr) auto; column-gap: 1.5rem }`.
- Selection panel: `ChartCard.inspect()`/Details pass `title = selection.label`, `subtitle = chart title` (ellipsised via CSS); `SelectionDetail` drops its first `<p>` and renders Scope as a receipt row.
- Pin strip: `role="status"` on the text span only; "Details" → "Show details".
- Assistant: `openPanel({ id:'assistant', title:'Assistant', actions: <model select> + <New chat>, modal: false })`; `.assistant-header` is removed; `.assistant-tabs` → `Segmented variant="tabs" size="sm"` in the context row; "Review latest completed month" becomes the first `.assistant-sample-chip` (keeps `intent: 'month_review'`); `.assistant-model-select { max-width: 220px }` in every mode; the `assistant-drawer-in` keyframe no longer applies to `.assistant-drawer-coordinated`. `DetailPanelRequest.modal?: boolean` (default true): a non-modal request in overlay/expanded mode renders no backdrop, no `aria-modal`, no `inert`, and does not trap Tab; Escape still closes it. Context row copy: "Context: Overview · Household" with a (i) `InfoHint`-style button that toggles the preview list (replaces "Seeing: … what the assistant can see").

## 5. Receipt copy and labels (F1)

- `utils/metricReceipt.ts` gains `COMPLETENESS_LABELS` (complete → "Complete", unreviewed_history → "Includes months not yet reviewed", incomplete → "Incomplete — some months missing", unavailable → "Unavailable", mixed → "Mixed sources", partial → "Partial — some holdings unpriced", estimate → "Estimate"; fallback sentence-cases and replaces underscores) and `formatComponentLabel()` (sentence case, no underscores). Row label "Basis" → "Data status". Exclusion reasons pass through the same fallback.
- Overview's net-worth receipt uses `GROUP_LABELS` from `charts/theme.ts` (P1 call site); `MetricInspector` applies `formatComponentLabel` defensively.
- The "Definition: id · version" footer is removed from the visible receipt; the definition sentence carries `title="Metric {id}, definition {version}"`.
- "Explain this number": when the selection is a metric (`id` starts with `metric:`), the prompt reads `Explain the {label} figure ({value}, {period or as-of}, {scope}). Use the captured evidence and distinguish recorded facts from interpretation.`; chart selections keep the current template.

## 6. Light theme tokens (F2)

`ThemeTokens` gains `fill`, `scrim`, `shadow`:

| Token | Dark | Light | Used by |
| --- | --- | --- | --- |
| `--fill` | `#262b36` | `#e6ebf2` | `.segmented button.active`, `[role=tab]:hover`, `.skeleton`, `.chart-selection-summary`, `.button` base background, `.disclosure > summary:hover` |
| `--scrim` | `rgba(0, 0, 0, 0.55)` | `rgba(20, 30, 50, 0.35)` | `.detail-panel-backdrop`, `.chart-expanded-dialog::backdrop`, DayDrawer backdrop |
| `--shadow` | `0 0 0 / 0.45` | `20 30 50 / 0.14` (as `rgb(var(--shadow))` components) | launcher, popovers, drawers, panel |

Hairlines (`.data-table td`, `.cal-day`, `.cal-gutter`, `.cal-list > li`, `.cal-list-expansion`, `.cal-drawer-row`, `.metric-receipt-list > div`) switch from `var(--surface-2)` to `var(--border)`. `.button-primary:disabled` demotes to the quiet button (`background: var(--surface-2); border-color: var(--border); color: var(--muted); opacity: 1`). `charts/recolor.ts` adds the three slots to its explicit list (they never appear in chart options, so they map trivially) or documents their exclusion; `tokens.test.ts` keeps passing because both `index.css` blocks declare them. The scroll-reveal floor is unchanged in this batch.

## 7. Row actions in wide tables (F2 recipe, P2/P3/P4 adoption)

`panels.css`:

```css
.data-table th:last-child, .data-table td.row-actions, .port-table th:last-child, .port-table td.row-actions {
  position: sticky; right: 0; background: var(--surface); box-shadow: -1px 0 0 var(--border); }
.data-table th.col-identity, .data-table td.col-identity { position: sticky; left: 0; background: var(--surface); box-shadow: 1px 0 0 var(--border); z-index: 1; }
[data-scroll-more~="right"] { mask-image: linear-gradient(to right, #000 calc(100% - 28px), transparent); }
[data-scroll-more~="left"]  { mask-image: linear-gradient(to left,  #000 calc(100% - 28px), transparent); }
```

`useScrollEdges(ref)` toggles `data-scroll-more` on a scroller from its `scrollLeft`/`scrollWidth` (initial, on scroll, on resize). Page lanes add `.row-actions` / `.col-identity` classes and the hook to: Paycheck Profiles history (`.paycheck-scroll`), Comp Focal history (`.comp-scroll`, plus a `Segmented` "Entered | Computed | All" column set defaulting to Entered so the table fits 1440 without scrolling), ESPP Lots and Purchase modeler (`.espp-scroll`), Settings Categories (`.settings-scroll`; also Categories → `span-8`, Household → `span-4`), Portfolio Transactions/Securities (`.holdings-scroll`, if they overflow under a dock). Sticky header cells that already exist keep their rule; the collapsed-border hairline is redrawn as the box-shadow above (precedent `CompPage.css:137-144`).

## 8. Sandboxes open on their tabs (P3)

`SandboxPanel` gains `defaultOpen?: boolean`; when true the open/close toggle is not rendered ("Reset to actual" stays). `TryItPanel` (Paycheck) and `WhatIfPanel` (Taxes) receive `defaultOpen` from their pages when the panel is the section's sole content; the URL-entries latch keeps working for deep links. Eyebrows align with tab labels ("Try changes — effective …", "What-if — 2026", "Purchase model — 2026").

## 9. Loading states (P1, P4, F2)

- Monthly update: `resource={{ status: loading && !hasFirstData ? 'loading' : 'ready', busy: loading, error: loadError, retry: retryLoad }}` with `skeleton={{ tiles: 0, cards: step === 'review' ? [{ span: 12, height: 480 }, { span: 12, height: 58 }] : [{ span: 12, height: 640 }] }}`. Month switch no longer unmounts the step card: the card stays mounted, `aria-busy`, under the frame's `.loading-dim.is-loading`, and swaps when the new month's data lands (the draft machinery already keys on `baseline.month`). First paint waits only for `fetchAccounts` + `fetchMonthBalances(month)` (entry step) or the review inputs (review step); matrix, household, review state, timeseries and the prior month fill in as they land, each already tolerant of absence. `coveredMonths` derives from `/coverage` (already fetched by the scope row) instead of the full timeseries.
- Settings: every lazily loaded card renders a `GhostCard` of its loaded height (limits ≈415, plan assumptions ≈415, assistant ≈420, price refresh ≈420, calendar feed ≈357, backups ≈313, health ≈313, system ≈313, activity ≈487, household ≈420, categories ≈900, accounts ≈1045) instead of `<p class="empty-note">Loading…</p>`; `AccountsCard` renders once after both fetches settle (`Promise.all`). Section data prefetches on tab hover/focus (`onPointerEnter`/`onFocus` on the tab triggers the section's loaders once).
- Overview: a tile whose resource group is `busy` with no data renders `GhostTile` (no-delta variant) instead of "—"; the YTD card reserves its slot with a ghost while `dividends` is pending.
- Skeleton parity (F2 `PageSkeleton`): `GhostTile` gets `delta?: boolean`; Portfolio ghosts `tiles: 5`, Credit cards `tiles: 4` without delta (P2).
- Environment note for the README's dev section (P1 writes it): on Windows, set the local `DATABASE_URL` host to `127.0.0.1` — `localhost` resolves to `::1` first and costs ~2s per overflow pool connection.

## 10. Text outside section boundaries (page lanes)

| Page | Today | Becomes |
| --- | --- | --- |
| Overview | review footnote `<p class="drill-hint">` after the primary grid; freshness row at the page bottom | a third agenda card **Data status** (eyebrow "Data status") listing the four clocks as `dl` rows (Prices as of / Balances through / Spending through / Net pay through, amber `.stale` kept) and the comparison line ("Living spending compares Aug 2026 with 12 eligible months"); the Living spending tile gets a `badge` ("Not yet reviewed") via the new `StatTile badge` prop |
| Spending | `.spending-metric-context` line | Living spending tile `delta`: "Cash outflow $4,932.87 · tax $0.00 · transfers $0.00" (neutral); review state as the tile `badge`; the "Review month" link is dropped (ribbon "Edit ↗" and header "Enter month" remain) |
| Net worth | `dl.networth-owner-strip` | `lede` of the "By group over time" ChartCard: "Edward **$806,708.50** · Joint **−$40.62**" in tabular figures; not rendered on Accounts |
| Paycheck | "Edward + Grace — the profile in force for each person." | household tile `delta`: "Edward $7,136.72 · Grace $1,260.00" |
| Projection | method note, warnings block, trend intro | method sentence appended to the chart card `footer`; `data.warnings` rendered as the chart card `lede` (muted); trend intro as the trend card `lede` |
| Settings | `h2.settings-section` ×5 | `visually-hidden` (ids kept) |
| Calendar | strip footnotes between tiles and grid | quote-date into the Vesting tile `delta`; the as-of line under the strip as a `.card` footer row, out of the tile grid |
| Portfolio | two subheader lines | one line: "Prices as of Sep 10, 2026 · last refresh Sep 11, 1:10 PM (scheduled) · 36 updated" |

`StatTile` (F2) gains `badge?: ReactNode` rendered after the label as a small pill (`.stat-badge`, `--fill` background, `.7rem`) and wraps label text + (i) in a `white-space: nowrap` span so the icon never wraps alone.

## 11. Accordion policy (F2 primitive; conversions per lane)

| Site | Lane | Decision |
| --- | --- | --- |
| `OverviewCustomize` | P1 | popover: `button.button[aria-haspopup="dialog"][aria-expanded]` + `div.popover-surface[role="dialog"][aria-label="Customize overview"]`, outside `pointerdown` and Escape close with focus return (pattern of `ChartExportMenu`), `z-index: 20`, `pop-in`; a Done button; label "Recent spending" |
| Taxes "Manage tax years" | P3 | removed from the card; PageFrame `actions` gets "New tax year…" opening a `popover-surface` with the year input, Create and "Delete {year}…" (arm-and-confirm inside the popover) |
| Wizard "Month actions" | P1 | a kebab `⋯` icon button in the Review card's eyebrow row opening a `popover-surface` with "Delete this month…" that reveals the existing arm-and-confirm inside the popover; the footer never moves |
| Wizard `HistoricalReview` | P1 | `.card` with eyebrow "Review historical months", one-line summary ("37 months entered before month review existed") and a **Load history** button that fetches and renders the list; rows grouped by year with a per-year "Select all eligible"; disabled rows show the missing feed; footer button "Close selected months" with the count only when > 0 |
| Budgets `budget-unbudgeted` + 19 `budget-editor` | P1 | unbudgeted rows become a plain table section headed "No budget yet (19)" (a `Disclosure` only when budgets exist; open when the book has none); each row has a **Set budget** `.button` that opens the existing editor inline for that one category (`editors` state; opening another closes the first); unbudgeted rows use a two-column grid |
| Allocation `allocation-heat` | P2 | moves to the Holdings view as a normal `ChartCard` (always open) after the holdings table |
| Allocation `allocation-classifications` | P2 | becomes the **Security classifications** card (§13) |
| Paycheck `sandbox-disclosure` "Employer match" | P3 | `Disclosure`, summary "Employer match (advanced)" |
| Taxes Will I owe methodology | P3 | `Disclosure` "How this is estimated (N notes)" holding both safe-harbor sentences, the reference-return note, the assumptions paragraph and the server warnings (sentence-cased) |
| `ChartTable`, `SelectionDetail` calculation, assistant evidence/reasoning/saved findings, Allocation "Missing quotes", import/restore reports | F1/P2/P4 | `Disclosure` styling, no behaviour change |

`panels.css` (F2) adds `.popover-surface { position:absolute; z-index:20; background: var(--surface); border:1px solid var(--border); border-radius:10px; box-shadow: 0 12px 36px rgb(var(--shadow)); padding: .9rem 1rem }` and a `usePopoverDismiss(open, onClose, triggerRef)` hook in `components/usePopoverDismiss.ts` (outside `pointerdown`, Escape, focus return) that `OverviewCustomize`, the tax-year popover and the month-actions menu share.

## 12. Layout grammar (F2 rules; page adoption)

- `.page { container: page / inline-size }` (a NAMED container; note that layout containment also makes `.page` one stacking context, so nothing inside it can paint above the dock layer, palette or toasts — right-edge popovers open leftward). **Corrected at the F2 review:** the original `.kpi-row > :last-child { grid-column-end: -1 }` does not stretch a lone last tile — with an `auto` start it pins the tile to the LAST column — so it was removed; there is no CSS-only fill for an auto-fit row, and a lone last tile above the two-column band keeps its natural width. `.kpi-row-5 { grid-template-columns: repeat(5, minmax(0, 1fr)) }` inside `@container page (min-width: 1000px)`, else auto-fit with `minmax(200px, 1fr)`. `@container page (max-width: 980px) { .kpi-row:not(.kpi-row-5) { grid-template-columns: repeat(2, minmax(0, 1fr)) } .kpi-row:not(.kpi-row-5) > :last-child:nth-child(odd) { grid-column: 1 / -1 } }`. `.kpi-row-dense` = `minmax(200px, 1fr)` (replaces Portfolio's `.tiles-row`). `.projection-outcomes` is `position: static` below the 1000px container width.
- Two-column grids stop stretching: `.settings-page .card-grid { align-items: start }`; the allocation pair becomes one card (§13).
- `ChartCard` (F1) gains `aside?: ReactNode`: when present the body renders `<div class="chart-card-body chart-card-with-aside">` with `grid-template-columns: minmax(0, 1fr) minmax(300px, .9fr)` and the aside in the second column (below the chart under 900px container width). Used by Allocation (§13) and by Spending's dock donut (legend list as aside; leader labels off inside the dock).
- Overview `.overview-deeper` becomes a `card-grid`; `performance` and `spending` cards `span-6`, `ytd` and `money_flow` `span-12`. `.overview-primary` keeps its two columns; the Data-status card fills the agenda column.
- Paycheck Summary: Breakdown (`span-6`) and Flow (`span-6`) in a `.card-grid`; Contribution pace full width beneath.
- Taxes: tables view `div.bracket-grid { grid-template-columns: repeat(auto-fill, minmax(min(480px, 100%), 1fr)); gap: 1rem 2rem; align-items: start }` with each jurisdiction block (form + per-person strip) in a `.bracket-group`; inputs form label track `minmax(0, 40ch)` left-justified with a row hover wash; `.tax-form-actions` becomes a sticky bottom bar (the wizard's `.entry-footer` recipe, class `entry-footer` so the reveal exemption applies) reading "N changes to save · Save inputs · Ctrl+Enter".
- Calendar: strip footnotes leave the tile grid (fixes the 1920 empty tracks); `.cal-day { min-height: 76px }` with `grid-auto-rows: minmax(76px, auto)`; Add event opens in the shared detail panel (dock; the form is the panel content, the grid stays put; Cancel/Save close it; `?add=1&date=` still opens it); gutter renders in and out on two lines without the slash; zero amounts print "$0" without sign or tilde; the duplicate month title in the scope row is dropped (the month input stays).
- Projection: `.projection-outcomes` one row (above); the assumptions column loses its inner scroller — `.projection-assumptions { max-height: none }` and the chart column becomes sticky (`.projection-chart-area { position: sticky; top: calc(var(--sticky-inset, 0px) + 8px) }`) so knobs are always reachable while the chart stays in view; the two long hint paragraphs at the bottom of `ScenarioPanel` move into the compare card as its hint; compare table `max-width: 900px`, caption left-aligned; `.sandbox-pins .field-input { text-align:left; font-family: inherit }`; the "Use my budgets" sentence wraps as a unit under its button.
- Tiles per view: Portfolio shows its five tiles on Overview, Holdings and Allocation; on Income the page tiles are hidden and the Dividends panel's three tiles are the row; on Manage none. Net worth tiles + owner lede on Overview only. Credit cards tiles on Rewards and Credit lines only. Comp strip hidden on Manage. ESPP strip on all three (`.kpi-row-5`). Implementation: tiles render inside a `views.section`-keyed condition above the panels with the row's height reserved via `min-height` only when switching between views that both show tiles (no reservation needed when a view shows none — the strip sits above in the sticky block).
- Portfolio vocabulary: `.panel` → `.card`, `.panel-title` → `.eyebrow`, `.tiles-row` → `.kpi-row kpi-row-dense`, Manage `.tab-row` → `Segmented variant="tabs" size="sm"` with `panelIds`; `portfolio.css:12-14` and `PortfolioPage.css:15, 44-45` deleted. `.panel` in `HistoricalReview` → `.card` (P1).

## 13. Allocation: from "Unknown 65.6%" to classified (P2)

- The allocation overview becomes **one card**: the donut `ChartCard` with `aside` = coverage line ("22 of 22 holdings priced · 34.4% of priced value classified"), the ranked category table (swatch · name · value · weight) and the Missing-quotes `Disclosure`. `.allocation-overview-grid` and `.allocation-ranked` go away.
- The Unknown row (table) and the Unknown slice's selection detail get a primary action **Classify these N holdings** (N = unknown members). It scrolls the Security classifications card into view (`scrollIntoView({ block: 'start' })`, respecting the sticky inset), sets its filter to Unclassified, and focuses the first row's asset-class select.
- **Security classifications** card (replaces the accordion), placed directly after the allocation card: eyebrow + coverage sentence ("12 of 37 securities have no asset class · 37 not yet reviewed"); filter chips `Segmented variant="chips"` Unclassified / Not reviewed / All (default Unclassified when any exist, else All); the search box on the same row; a compact table with **inline** Asset class and Geography selects that save on change (`saveClassification`, existing PATCH), the Undo toast on success, an inline error on failure, and the industry text input only where `industry_available`; a note column with an edit-in-place field. When the filter yields no rows: "All securities have an asset class." with a chip to show all. The old per-row Review form is removed.
- `TargetForm` no longer seeds `__unknown__` and no longer offers "Unknown" in Add category; when `data.coverage.unknown_market_value > 0` the form shows "Unknown is {pct} of the priced book — classify first" with the same Classify action. Activate stays enabled (drift stays honest; the design's "all slices retain a transparent role" holds because Unknown remains a slice).
- Category label "Unknown" → "Unclassified" in the ranked table, legend and selection title (`allocationLabel`).
- The Unknown selection detail's per-holding "Open {ticker}" buttons remain; the classify action sits first.

## 14. Copy pass (all lanes, in their files)

- Receipts: `GROUP_LABELS`, `COMPLETENESS_LABELS`, no dev footer, metric prompt (§5).
- "below" → view names or `goTo` buttons: `TaxesPage.tsx:784, 859`, `SummaryPanel.tsx:126, 282, 290, 308`, `MarginalPanel.tsx:87`, `WithholdingPanel.tsx:258, 471, 496, 557`, `EsppPage.tsx:759-760`, `PaycheckPage.tsx:1451`; taxes panels receive a `goTo(section)` prop (precedent `PaycheckPage.tsx:1483`).
- Server warning fragments (`WithholdingPanel` `warnings`): a one-line `sentence()` formatter (capitalise, ensure terminal period) at the render site.
- Duplicate helper paragraphs: `BracketsEditor.tsx:744-748` shown once; Paycheck Profiles intro trimmed to two sentences; ESPP lots hints attached to the form fields.
- Review vocabulary (`REVIEW_LABELS`): unreviewed_history → "Not yet reviewed", needs_review → "Changed since review", closed → "Reviewed", in_progress → "In progress", ready_to_review → "Ready to review", not_started → "Not started"; tests updated.
- Needs attention (Overview): review rows only for past months, phrased as actions ("Finish Aug 2026's update →", "Aug 2026 changed since review — reopen →", "Jul 2026 is ready to close →"); the current month appears only after `UPDATE_NUDGE_DAY`.
- Calendar zeros "$0"; Portfolio "All holdings" → "Clear selection"; "Accounts — latest month" names the month; Customize label alignment; "Missing-price value cannot be estimated…" gated on `unpriced_count > 0`; classification source "Import · not reviewed".
- Panel mode tooltips: "Beside the page", "Over the page", "Reading mode" / "Exit reading mode".

## 15. Acceptance (lane V, `scratchpad/ux-audit-2026-09-13/audit.mjs` + a new `accept.mjs` on the same fence)

All measured against the prod clone (5174) at 1440×900 dark, plus 1920 dark and 1440 light spot checks, `reducedMotion: 'no-preference'` for motion and `'reduce'` for the static walk:

1. Motion: dock open produces ≥3 distinct `pw`/margin frames within 300ms and a final state equal to today's; `.detail-panel`, `dialog.chart-expanded-dialog[open]`, `.popover-surface`, `.local-section-indicator` report non-zero `animation`/`transition` durations; under `reduce` all read 0s. Frame budget: no more than two frames > 32ms during a dock open on Spending.
2. Tab strip: on every tabbed page `nav.local-section-nav` lies inside `.page-frame-scope`, spans the content width, and remains in view after a 700px scroll.
3. Orphan text: the audit's ORPHAN list is empty on Overview, Spending, Net worth, Paycheck, Projection, Settings, Calendar (Portfolio's single subheader line is allowlisted).
4. Layout: `.overview-primary` column gap ≤ 24px; Settings Household slack ≤ 24px; allocation card has no stretched twin; no `.kpi-row` renders N+1 with a lone last tile narrower than the row (the last-child rule) at 1440 with the dock open; Projection band one row at 1440.
5. Tables: on Paycheck Profiles, Comp Manage (default column set), ESPP Lots/Purchase and Settings Categories the first row's last action button is within the viewport at 1440.
6. Loading: `/update` shows `.skeleton` before its first card; Settings tabs show ghosts within 100ms of a click; the Accounts card's height changes at most once after mount.
7. Light: computed contrast of `.segmented button.active` vs its card ≥ 1.15:1; `.data-table td` border colour equals `--border`.
8. Allocation: with the prod clone, the ranked Unknown row exposes a "Classify these 12 holdings" button; clicking it brings the classification card into view with 12 rows and focus on a select; `TargetForm` renders no `__unknown__` row and its Add list has no Unknown option.
9. Gates: `tsc -b`, `eslint .` (warning count ≤ baseline 24 + documented additions), `vitest run` full, `vite build`; backend untouched (no pytest run needed unless a lane touches `backend/`).
10. Screenshots for the morning in `scratchpad/ux-audit-2026-09-13/after/` with a before/after index.

## 16. Risks and mitigations

- Merge conflicts between F1 and F2 (`panels.css` keyframes vs `chartInteractions.css`; page files touched by F2's `sections=` wiring and later by page lanes): F2 merges first, page lanes branch from the merged main; F1 keeps its keyframes in its own sheets under distinct names.
- `container-type: inline-size` on `.page`: layout containment makes `.page` the containing block for `position: fixed` descendants — none exist inside `.page` (launcher and toasts are outside; dialogs/panels are portaled to body). Projection already uses it on its root. Lane V checks the wizard's sticky `.entry-footer` and the scope row still stick.
- Exit animation with portal unmount: the provider's `leaving` state must never strand a reader under reduced motion — the fallback timer guarantees unmount.
- Persisted panel width smaller than the current maxWidth: `panelGeometry` clamps on read.
- WAAPI panel fade on `hidden` toggle: the element is display:none until active; run the animation in a layout effect after `hidden` clears (same rAF as the scroll restore).
- Feed cascade re-arm: gated to the first 3s after page mount, so revisits never replay.
- Budgets inline editor: only one open editor at a time; unsaved amounts in a closing editor are kept in `editors` state (already keyed by category) so switching rows does not lose typing.
- Calendar Add-event in the panel: the form's validation, `?add=1&date=` prefill and focus land in the panel; keyboard Escape closes the panel (one level); tests for the page's add flow move to the panel host.
- `.panel` → `.card` rename in Portfolio: purely presentational (same tokens); `PortfolioPage.test.tsx` selectors that query `.panel` are updated.
