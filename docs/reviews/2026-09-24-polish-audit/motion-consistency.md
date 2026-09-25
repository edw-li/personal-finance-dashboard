# Motion-consistency — polish findings

Pages/areas covered (production bundle @1694013d on real data, 1440×900 both themes unless noted):
- **Route changes:** 19 filmed sidebar hops (13 first visits + 6 revisits); 14 cold loads × 2 themes (natural CLS); 14 cold loads with the API held 1.5 s (skeleton vs landed geometry); Back/Forward restoration on 8 pages; light-theme cold load (flash check).
- **Every local tab on every tabbed page**, filmed and sampled: Net worth (Overview, Accounts) · Portfolio (Overview, Holdings, Allocation, Income, Manage) · Spending (Overview, Trends, Budgets, History) · Credit cards (Rewards, Credit lines, Manage) · Paycheck (Summary, Try changes, Profiles) · Comp (Summary, Vesting, Manage) · ESPP (Summary, Lots, Purchase model) · Taxes (Summary, What-if, Inputs, Tax tables) · Projection (Planning workspace, Historical trend) · Guide (Start here, Routines, Pages, Reference) · Settings (Household, Planning, Account, Integrations, Data).
- **Scope and in-card controls:**
  - owner (WHOSE) chips on Overview, Net worth, Portfolio and Paycheck;
  - All/1Y/YTD on Net worth, Portfolio and Spending;
  - Monthly/Quarterly, and By group/By owner/Share %;
  - month ribbon on Spending and Net worth;
  - Taxes year chips.
- **Overlays:** command palette, assistant drawer, chart Export menu, info bubble, metric inspector, Expand dialog, chart Table twin, Overview Customize, Disclosure, holding detail dock, wizard month actions.
- **Theme and preferences:** theme toggle in both directions; `prefers-reduced-motion: reduce`.
- **Scrolling:** wheel scrolling on 12 pages; reveal/scrim measurement on 11 long pages; the floating assistant button's overlap on 18 page/tab states.
- **Sizes:** 1280×800, 1366×768, 1536×864, 1920×1080 and 2560×1440.
- **DOM and source:**
  - a DOM sweep of number typography and formats, dates, card chrome, titles, buttons, links, badges and hover transitions over all 41 page/tab views;
  - a source sweep of all 45 CSS files plus `src/theme/*`.

Evidence paths are relative to SCRATCH. Scripts are in `work-motion-consistency/`.

**Impact order across groups:**
- **Highest:** 08, 09, 02, 01, 04
- **Next:** 21, 13, 11, 10, 03
- **Then:** 15, 14, 12, 05, 16, 17, 18, 22, 06, 07, 19
- **Last:** 20

---

## A. Navigation & arrival

### MOTION-01 · Skeletons don't match the page they stand in for, so the content jumps 55–146 px when it lands
- **Where:** first visits and cold loads of `/portfolio`, `/projection`, `/calendar`, `/taxes`, `/paycheck`, `/spending`. The ghost shows whenever data takes more than 300 ms. Both themes.
- **What happens** (ghost layout vs landed layout, API held 1.5 s):
  - **Portfolio, Projection, Calendar:** the ghost draws 5 tiles wrapped **4 + 1** (a lone 5th tile on a second row, a 246 px block). The real row is **5 across** (100–133 px). So the first card jumps **up** by 143 px (Portfolio), 113 px (Projection) and 146 px (Calendar).
  - **Projection's card also changes shape:** one full-width ghost becomes an 8/4 chart + assumptions split.
  - **Taxes:** the ghost has no year / filing-status row. The body drops **55 px** when that row arrives.
  - **Paycheck:** the ghost has no "Household take-home" tile. The ghost itself slides down **119 px** before it cross-fades. That gives CLS 0.054 on every cold load, dark and light.
  - **Spending:** the ghost draws two half-width cards where the page has full-width ones.
  - **Why CLS misses most of this:** a replaced ghost is not a "shift", so the CLS numbers stay near 0 while the eye sees the lurch.
- **Evidence:**
  - `shots/motion-consistency/skeleton-dark-1440/portfolio-ghost.png` vs `…/portfolio-landed.png`
  - `…/projection-ghost.png` vs `…/projection-landed.png`
  - `shots/motion-consistency/composites/skel-A.png` (Calendar, Spending, Taxes, Paycheck pairs)
- **Cause:**
  - `src/components/PageSkeleton.tsx:29-35` renders a bare `.kpi-row` (auto-fit `minmax(220px)` → 4 per row). It cannot ask for `.kpi-row-5` / `.kpi-row-dense`, which the real rows use (`panels.css:108-114`).
  - Page specs:
    - `ProjectionPage.tsx:112` and `CalendarPage.tsx:642` ask for 5 tiles plus one full-width card.
    - `PortfolioPage.tsx:700` likewise.
    - `TaxesPage.tsx:926` has no year-row ghost.
    - Paycheck ghosts only its breakdown feed (`PaycheckPage.tsx:1498`).
- **Polish:**
  - Let `PageSkeleton` take the row variant (`tiles: { count: 5, row: 'kpi-row-5' }`) and the real card grid (8/4 for Projection, full-width for Spending).
  - Ghost the Taxes year row and Paycheck's lone tile.
  - Add a test beside `skeletonMetrics.test.ts` asserting "ghost first-card top = landed first-card top".
- **Impact:** on any slow load the skeleton becomes a truthful preview, and the page settles without the 1–2 row lurch.
- **Size:** S–M · **Confidence:** high (re-verified in light theme)

### MOTION-02 · The Overview (the landing page) assembles in four jolts with three different loading languages — CLS 0.12
- **Where:** `/` on a cold load or first visit. Dark and light.
- **What happens** (filmed): four visible stages between ~500 and ~1000 ms.
  1. Header plus a small scope ghost.
  2. The hero shows "$0.00" and starts counting while its three neighbours are still ghost tiles. The Net worth trend card is an empty shell whose Expand / Table / Export buttons are already live.
  3. The right column pops in with **sentences** as placeholders: "Loading upcoming events...", "Additional checks are waiting for their data feeds." The Data status card is still a ghost.
  4. The remaining tiles, Data status and the chart arrive.
- **Layout shifts:** `.overview-primary` (the whole main grid) drops **69 px** at ~560 ms, and the Data status card moves **198 px** at ~800 ms. CLS is **0.124** (dark) / 0.085 (light), the only page above 0.1. Every other page is ≤ 0.01, except Paycheck at 0.054.
- **Evidence:** `shots/motion-consistency/composites/overview-cold.png` (frames in `shots/motion-consistency/overview-cold/`); `work-motion-consistency/coldcls.mjs` output.
- **Cause:**
  - Three independent resources (`OverviewPage.tsx:193-195`; 17 requests) each unlock their own cards.
  - Per-tile ghosts at `OverviewPage.tsx:487/516/538`.
  - Sentence placeholders at `OverviewPage.tsx:850`, `:915` and `components/overview/OverviewChanges.tsx:41`.
- **Polish:**
  - Reserve every card at its landed height from the first frame, with ghost blocks rather than sentences.
  - Land the tile row together, starting the count-up only when all four are ready.
  - Hide card actions until the card has data.
  - Cascade the right column in with the left, as one beat.
- **Impact:** the first screen of every session arrives calmly in one or two beats instead of four; CLS drops under 0.1.
- **Size:** M · **Confidence:** high

### MOTION-03 · Monthly update plays its entrance twice, retitles itself, then slides its month ribbon
- **Where:** sidebar → Monthly update (`/update` → `/update?month=2026-09&step=balances`). Both themes.
- **What happens:**
  1. Title "Monthly update" over a blank body (its ghost only appears after 300 ms).
  2. Then (385 ms dark run, 108 ms light run — whenever `/coverage` answers) the title changes to "Monthly update — Sep 2026". The steps and ribbon appear, and the body **fades in from 0 a second time**.
  3. The ribbon then re-windows by a month (Oct '25–Sep with hollow dots → Nov '25–Oct filled). Every chip slides ~39 px left, and the selected "Sep" ring moves from x 706 to 669.
  4. The balance card lands 165 px lower than the landing's ghost (y 72 → 237).
- **Evidence:** `shots/motion-consistency/hops-dark-1440/first-update/05-211ms.jpg`, `07-412ms.jpg`, `11-651ms.jpg`.
- **Cause:**
  - `MonthlyUpdatePage.tsx:329` swaps `<UpdateLanding/>` (its own `PageFrame`, lines 363-371) for `<MonthlyUpdateWizard/>` (a new `PageFrame`), so `page-body-in` replays.
  - `ScopeBar.tsx:260-263` anchors the ribbon on `coverage.current_snapshot`, which arrives later.
- **Polish:**
  - Use one frame for both phases: the landing renders inside the wizard's frame with its final title (or a title that never changes).
  - Put the ghost where the card will land.
  - Have the ribbon reserve its "next month" slot from the first paint.
- **Impact:** the monthly routine's front door appears once, in place.
- **Size:** S–M · **Confidence:** high

### MOTION-04 · Back/Forward lands short when part of the page is still loading
- **Where:** Back onto `/taxes`, `/portfolio` and `/paycheck` after scrolling down and navigating away.
- **What happens:**
  - Taxes scrolled to 1500 → Back lands at **1380** (twice). Scrolled to 2100 → lands at **1380** (720 px short).
  - Portfolio 396 → **0** (top).
  - Paycheck 300 → 244.
  - Net worth, Credit cards, Spending, Guide, Projection and Settings restore exactly.
  - Why: at the moment of restore the page is shorter than it will be (Taxes is 2280 px with one card still a skeleton, and grows to 3155 px ~60 ms later). The browser clamps, and nothing re-applies the depth.
- **Evidence:** `work-motion-consistency/back2.mjs` output (`y/docH/skeletons` trace per page).
- **Cause:** `src/components/Layout.tsx:84-90` — a single `window.scrollTo(saved)` in the pathname effect.
- **Polish:** keep re-applying the saved depth while the document grows (a ResizeObserver on `main` for up to ~1 s), and stop at the first user scroll or keypress. `shell/holdPosition.ts` already implements "hold until input" for deep links.
- **Impact:** Back reliably returns the reader to the row they were reading — on the long pages where that matters most.
- **Size:** S · **Confidence:** high

### MOTION-05 · The page title and tab strip hop 4–30 px from page to page
- **Where:** every hop between pages with and without a header button. 1440 and 1280.
- **What happens:**
  - The header row is 36 px tall on pages with a header button (Overview, Net worth, Spending, Credit cards, Taxes, Calendar), 28 px without one (Update, Paycheck, Comp, ESPP, Projection, Guide, Settings) and 31 px on Portfolio.
  - So the h1 sits at y 32 / 28 / 30, and the tab strip at y 80 / 72 / **102** (Portfolio adds its "Prices as of…" subheader).
  - Net worth → Paycheck moves the title up 4 px and the tab underline up 8 px. Portfolio's strip sits 22–30 px lower than any other page's.
- **Evidence:** `work-motion-consistency/chrome.mjs` output. Visible across `shots/motion-consistency/hops-dark-1440/*/`.
- **Cause:**
  - `shell/shell.css:103-109`: `.page-frame-header` has no min-height.
  - Header buttons are a 36 px `.button`, or Portfolio's own 31 px `.refresh-btn` (`PortfolioPage.css:41`).
- **Polish:**
  - `min-height: 36px` on the header row.
  - Portfolio's refresh button becomes a `.button`.
  - Portfolio's status line moves into the header's right side or under the tabs.
- **Impact:** title and tabs become fixed landmarks; only content changes on navigation.
- **Size:** S · **Confidence:** high

### MOTION-06 · Cold load: the scope row slides sideways when the owner chips arrive
- **Where:** first page of a session on `/net-worth` and `/portfolio` (and the ribbon part on `/net-worth`, `/spending`, `/update`).
- **What happens:**
  - The range control paints at x 242. 30–75 ms later the WHOSE chips arrive and shove it, and the ribbon, **+334 px** right.
  - The ribbon then re-windows by a month when `/coverage` lands (see MOTION-03).
  - The Overview does reserve a ghost, but it is 168 px wide against the real ~320 px group.
- **Evidence:** `shots/motion-consistency/composites/coldload-light.png` (frames 01 → 02); `shots/motion-consistency/skeleton-dark-1440/portfolio-ghost.png` (range control at the left edge); `work-motion-consistency/scopeshift.mjs` output.
- **Cause:** `shell/ScopeBar.tsx:239-254` renders the owner ghost only when nothing else is in the row.
- **Polish:** always render the owner-slot ghost at the chips' real width while the household is unknown, before the range and ribbon.
- **Impact:** controls stop moving under the pointer on the first page of every session.
- **Size:** S · **Confidence:** high

### MOTION-07 · Revisits dim valid, cached numbers with no grace period
- **Where:** every cached revisit (sidebar back to a page already seen). Also owner switches.
- **What happens:**
  - Each revisit refetches, and the body (or the card) drops to 70% opacity until the refetch returns, even when nothing changes. Measured: Net worth 136 ms, Spending 190 ms, Paycheck 92 ms, Credit cards 85 ms, Taxes 56 ms; the Overview's trend and spending cards 200–400 ms.
  - Here, Portfolio's Performance card and the Overview's Portfolio performance card sat dimmed **2.1–2.7 s**. One of 12–13 parallel requests stalls ~2.1 s in this machine's browser path (curl answers all 12 in < 61 ms), so treat that duration as local. The pattern is real.
  - On a fast link it's a flicker during the page's own entrance; on a slow link the page looks disabled.
- **Evidence:** `shots/motion-consistency/hops-dark-1440/revisit-portfolio/04-575ms.jpg`; `work-motion-consistency/dimtime.mjs` and `dimwho.mjs` output.
- **Cause:**
  - `PortfolioPage.tsx:255-259` and `412-424` ("a cache hit paints full and revalidates under the reload dim").
  - `NetWorthPage.tsx:668` (`busy: loading`).
  - `shell/Feed.tsx:90` → `.loading-dim.is-loading` (`panels.css:445-447`).
- **Polish:**
  - Give the busy dim the skeleton's 300 ms threshold (a `transition-delay` on `.is-loading`).
  - Skip the dim for a silent revalidation of cached data; keep it for a user-initiated scope change.
- **Impact:** revisits feel instant, and the dim keeps one meaning: "these numbers are about to change."
- **Size:** S · **Confidence:** medium (pattern verified on 7 pages; the long durations are environment-inflated)

---

## B. In-page motion

### MOTION-08 · Wheel scrolling stops dead whenever the pointer passes over a zoomable chart
- **Where:** Net worth "By group over time", Spending's monthly chart, Portfolio "Performance", Projection's balance chart, ESPP's NVDA price chart — every chart carrying the "ctrl+scroll to zoom · drag to pan" hint.
- **What happens:**
  - With the pointer over one of these charts, 8 wheel notches moved the page **0 px**.
  - The wheel event arrives with `defaultPrevented = true`. Charts without inside-zoom (Overview trend, Paycheck sankey) scroll normally.
  - These charts are 256–520 px tall and full width, so an ordinary scroll through the page sticks each time one slides under the pointer.
- **Evidence:** `work-motion-consistency/wheel2.mjs` and `wheel3.mjs` output (3 separate probes, 5 charts, 4 pages).
- **Cause:**
  - `src/charts/timeZoom.ts:43-61` intends "Bare wheel keeps scrolling the page; ctrl+wheel zooms" (`zoomOnMouseWheel: 'ctrl'`).
  - But ECharts 6.1 merges every inside dataZoom into one RoamController with `zoomOnMouseWheel: true` (`node_modules/echarts/lib/component/dataZoom/roams.js:175-181`: "the final behavior is determined by its event listener").
  - `_checkTriggerMoveZoom` then calls `eventTool.stop(e.event)` on every wheel inside the grid (`helper/RoamController.js:316-322`), before the zoom handler checks for ctrl.
- **Polish:**
  - In `EChart.tsx`, add a capture-phase `wheel` listener on the chart host that calls `stopPropagation()` for wheel events without ctrl/meta. zrender never sees them, and the browser scrolls the page. ctrl+wheel keeps zooming.
  - Pin it with a test: a bare wheel over a zoomable chart is not `defaultPrevented`.
- **Impact:** the page scrolls smoothly wherever the pointer is — the most frequent interaction on the longest pages stops "catching".
- **Size:** S · **Confidence:** high

### MOTION-09 · Returning to a page's first tab replays the arrival cascade — and Net worth re-counts its hero from $0
- **Where:** back to the arrival tab on Net worth, Portfolio, Credit cards, Paycheck, Taxes, Comp, Projection and Settings. Both themes.
- **What happens:**
  - The panel fades in (180 ms, 6 px), **and** its cards replay the page-arrival cascade on top (card-enter 240 ms, 8 px, staggered 0/40/80 ms).
  - The two fades multiply (Paycheck at 93 ms: panel 0.77 × card 0.20 = 0.15). So the arrival tab settles at **~320–410 ms**, while every other tab (and ESPP's first tab) settles at 180 ms. The same gesture feels different per tab.
  - **Net worth is worse:** its KPI tiles sit outside the tab panel. They unmount on "Accounts" and remount on return — they pop without a fade, and the **hero counts up from $0 again** ($233,066 → $459,793 → … → $933,079, light run) though the reader just saw it.
- **Evidence:** `shots/motion-consistency/composites/tabs-nw-back.png`; `work-motion-consistency/tabreplay.mjs` output (per-frame opacities and running `card-enter` animations, 8 pages).
- **Cause:**
  - `useStagger.ts:43-48` tags `data-stagger` once and never clears it.
  - `panels.css:1102-1124` keeps the entrance armed on every tagged card.
  - A CSS animation restarts whenever a `hidden` panel is shown again (`LocalSections.tsx:251-252`).
  - `NetWorthPage.tsx:718` renders the tile row outside the panel (`views.section === 'overview' && …`).
  - `StatTile.tsx:79-106` counts up once per mount (`countUp` gate at `NetWorthPage.tsx:735-739`).
- **Polish:**
  - Remove the `data-stagger` tags when the arrival cascade finishes (on `animationend`, or after 5×40+240 ms).
  - Move Net worth's tile row inside the Overview panel (or keep it mounted and hidden).
- **Impact:** every tab switch is the same quick 180 ms fade, and figures already read stay still.
- **Size:** S · **Confidence:** high

### MOTION-10 · On the Overview, switching owner tears the page back to ghosts and re-counts from $0; every other page swaps in place
- **Where:** `/` WHOSE All → Edward, and All → Grace (both themes). Compare `/net-worth`, `/paycheck`, `/taxes` and `/portfolio`.
- **What happens:**
  - On the Overview, the hero turns into a ghost tile, and the Net worth trend and "Changes worth understanding" cards empty (8 skeletons at ~60 ms).
  - Then the chart replays its 450 ms entrance, and the hero counts up from $0 ($61,275 → … → $258,540.10 for Grace).
  - The same chip elsewhere keeps the old figures under a brief dim and swaps them in place with no count-up.
  - Switching back to All then holds a card dimmed while it refetches.
- **Evidence:** `shots/motion-consistency/composites/scope-overview-edward.png` (frames 193 ms → 562 ms); `work-motion-consistency/verify-light.mjs` output (item 12).
- **Cause:** `OverviewPage.tsx:193-194` keys resources by owner (`overview:wealth:${owner}`). A key with no data renders `GhostTile` (`:487`, `:516`), and fresh data re-arms the count-up (the gate right after `:487`) and the chart's entrance.
- **Polish:**
  - Keep the previous owner's payload on screen, dimmed, until the new one lands — the Net worth pattern.
  - On a scope change, swap the figure, or tween old → new over 300 ms (the chart update tempo). Never count from zero.
- **Impact:** the owner toggle behaves like a filter, identically on every page.
- **Size:** M · **Confidence:** high

### MOTION-11 · "Table" opens the chart's data table below the fold, so the click looks like it did nothing
- **Where:** chart card "Table" buttons on 7 pages (12 charts measured).
- **What happens:**
  - Top Net worth chart: the table starts at y 879 of a 900 px window — **21 px visible** ("▾ DATA TABLE" peeking).
  - Taxes waterfall: y 1235, **fully off-screen**.
  - Spending and Projection: ~70–86 px.
  - 6 of 12 show less than a third of the 364 px table.
  - Nothing scrolls. Only the button's pressed state changes.
- **Evidence:** `shots/motion-consistency/tabletwin-networth-after-click.png`, `shots/motion-consistency/composites/table-twin.png`; `work-motion-consistency/tabletwin.mjs` output.
- **Cause:** `ChartCard.tsx:96/275` toggles `tableOpen`; `:296` renders `<ChartTable>` after the chart, with no scroll or focus.
- **Polish:** after opening, glide it into view (`scrollIntoView({ block: 'nearest', behavior: 'smooth' })`), or flip chart ↔ table in place within the same box (height held).
- **Impact:** the button gives visible feedback, and the data lands where the eye already is.
- **Size:** S · **Confidence:** high

### MOTION-12 · Theme toggle: for ~120 ms every control goes label-less
- **Where:** sidebar "Light theme" / "Dark theme", on any page (filmed on Net worth and Overview).
- **What happens:**
  - Surfaces swap instantly, but every control with a hover transition cross-fades its old colours over 120 ms.
  - Mid-way (~130 ms) background and label pass through the same grey. The active nav row, "Monthly", "All", "By group", Expand / Table / Export and Customize / Refresh become **blank grey pills**, and "Enter month" is washed out.
- **Evidence:** `shots/motion-consistency/composites/theme-crop.png` (Net worth), `…/theme-ov-crop.png` (Overview), frames in `shots/motion-consistency/theme-net-worth-to-light/`.
- **Cause:**
  - `shell/ThemeProvider.tsx:84` flips `data-theme` instantly.
  - The 120 ms colour transitions meant for hover (`panels.css:830-846`, `Layout.css:266-274`, `shell/shell.css:294-302` and `462-470`) also fire on the swap. Surfaces have none.
- **Polish:**
  - Suppress transitions for the swap frame (a one-frame `html[data-theme-swapping] * { transition: none !important }`).
  - Better, a small delight: `document.startViewTransition()` for a single 200 ms whole-page dissolve, charts included.
- **Impact:** the theme change reads as one deliberate dissolve, not a flicker of empty controls.
- **Size:** S · **Confidence:** high

---

## C. Visual language

### MOTION-13 · The floating assistant button sits on top of right-edge content on most pages
- **Where:** 12 of 18 page/tab states swept while scrolling (1440×900).
- **What happens:** the 44 px launcher (x 1361–1405) overlaps the content column (cards end at x 1393) by 32 px. As the page scrolls it covers:
  - chart **Export** buttons and the zoom hint (Overview, Net worth, Credit cards, Taxes);
  - right-aligned amounts (the Update wizard's Δ column, Spending History, Spending month deltas);
  - Paycheck pace verdicts ("100.25% over");
  - ESPP row actions ("Model sale →");
  - Projection inputs and the "Planning default" badge;
  - Settings owner chips;
  - the Money-flow year chip "2026".
- **Evidence:** `shots/motion-consistency/composites/fab-crops.png` (Update Δ column, Overview Export / "2026"); `shots/motion-consistency/light-launcher.png`; `work-motion-consistency/fab.mjs` output.
- **Cause:** `assistant/assistant.css:8-28` (fixed, `right: 1.25rem`, `bottom: 1.25rem`) vs `.page` padding of 2rem (`panels.css:7-8`). Nothing reserves its footprint.
- **Polish** — one of:
  - bottom padding on `.page` (≥ 64 px) plus a right safe zone for sticky footers;
  - fade or shrink the disc while the page is scrolling and restore it on idle;
  - offer "Ask assistant" from the sidebar footer and keep the disc off the content column.
- **Impact:** nothing the user must read or click hides under a floating control.
- **Size:** S–M · **Confidence:** high

### MOTION-14 · Two identical (i) icons, two different behaviours
- **Where:**
  - KPI tile labels (Overview, Net worth, Portfolio, Spending, Paycheck…: 40 metric buttons);
  - card titles (121 hints app-wide).
- **What happens:**
  - The card-title (i) (13 px, `cursor: help`) shows an explanation bubble on hover.
  - The tile (i) (15 px, `cursor: pointer`) shows **nothing** on hover. On click it opens a docked "About this number" panel that narrows the page.
  - Same glyph, same muted colour, side by side.
- **Evidence:** `shots/motion-consistency/composites/ihint-pair.png` (left: hover on tile (i), nothing; right: hover on card (i), bubble).
- **Cause:** `StatTile.tsx:127-128` (evidence → `MetricInfoButton`, else `InfoHint`).
- **Polish:**
  - Make the metric button show the same hover bubble (its definition, plus "Details →") and keep click for the dock.
  - Or give it a distinct glyph (list/receipt) with a "Show the numbers behind this" tooltip.
- **Impact:** one icon, one expectation — hovering an (i) always explains.
- **Size:** S · **Confidence:** high

### MOTION-15 · Quiet buttons come in two fills and six heights; Portfolio's row-action style leaks app-wide
- **Where:** row actions (Edit / Delete / Archive / Retire / Duplicate) on Portfolio, Credit cards, Paycheck and Settings, versus `.button` elsewhere. Worst in light theme.
- **What happens:**
  - Row actions wear `--surface-2`: light #f7f9fc on a white card, **~1.05:1**, so they read as ghost outlines. The `.button` beside them ("Rename", "Add member" on the same Settings screen) wears `--fill` #e6ebf2.
  - Heights: 36 (`.button`), 31 (Portfolio actions + "Refresh prices"), 29 (Taxes), 28 (Credit cards / Paycheck / Settings row actions), 26 (chart Expand / Table / Export), 23 ("Edit budget").
  - "Edit" alone is 31 / 28 / 29 px on three pages.
  - Portfolio's 330 buttons skip the 120 ms hover ease every `.button` has.
- **Evidence:** `shots/motion-consistency/composites/rowbtn-light.png`; `work-motion-consistency/rowbtn.mjs` and `analyze.mjs buttons` output.
- **Cause:**
  - `portfolio/portfolio.css:85-86`: `.form-actions button, .row-actions button` (surface-2, 0.85rem) is global once route CSS is warmed, and at (0,1,1) it outranks `.button`.
  - `settings/settings.css:244-257` already notes the leak but only resets padding and size.
  - Local size variants: `creditcards/roster.css:52`, `categories.css:45`, `carddetail.css:53`, `PaycheckPage.css:165`; `PortfolioPage.css:41` (`.refresh-btn`).
- **Polish:**
  - One `.button-sm` and one `.row-actions .button` rule in `panels.css`.
  - Scope or delete Portfolio's bare-button rule.
  - Portfolio's header action becomes a `.button`.
- **Impact:** a quiet button looks and moves the same everywhere; light-theme row actions become visible buttons.
- **Size:** S–M · **Confidence:** high

### MOTION-16 · Portfolio's tables set figures in the UI font; every other table is monospace
- **Where:** `/portfolio` Holdings, Income (dividends), Manage (transactions), Allocation and classification tables.
- **What happens:**
  - Every table figure elsewhere is `ui-monospace` at 13.6 px. Portfolio's ~390 table figures (in the sweep) are proportional at 13 px.
  - Its KPI tiles are mono, so the same dollar figure changes typeface between tile and table.
- **Evidence:** `shots/motion-consistency/composites/rowbtn-light.png` (Portfolio Manage: "1,030 · $41.23" proportional); `work-motion-consistency/analyze.mjs numbers` output.
- **Cause:** `portfolio/portfolio.css:25` `.port-table td.num { text-align: right; font-variant-numeric: tabular-nums }` has no font-family. `.data-table .num` (`panels.css:244-248`) carries the mono stack.
- **Polish:** give `.port-table .num` the mono stack and 0.85rem (or build port-table on data-table).
- **Impact:** one number face across the app.
- **Size:** S · **Confidence:** high

### MOTION-17 · The same number is spelled several ways: minus glyph, K vs k, three estimate markers, cents on estimates
- **Where:** app-wide (all 41 views swept).
- **What happens:**
  - **Minus:** `formatCurrency` prints a hyphen-minus ("-$2,911.11", "-$4,795.97"), while at least six modules hand-roll a true minus ("−$188,615.33", "−$844"). The Overview shows both on one screen (Portfolio tile vs Changes card).
  - **Compact:** "$263.7K" / "$1.23M" vs Calendar's and Overview Up next's "$3.6k" / "$1.2M".
  - **Estimates** carry three markers:
    - "~" (Calendar);
    - "≈" (Overview, Money flow, Projection, Taxes, Spending, Net worth);
    - "(est.)" (Credit cards; the Overview's "Estimated tax — 2026 (est.)" says it twice).
  - Estimates keep cents: FI target **$1,641,700.25**, projected tax $86,738.47, projected withholding $109,098.70, "$8,744.62/yr expected".
- **Evidence:** `work-motion-consistency/analyze.mjs numbers` output (format families, negative glyphs per page); `shots/motion-consistency/skeleton-dark-1440/projection-landed.png` (FI target).
- **Cause:**
  - `utils/format.ts:9-12` (Intl, hyphen) and `:14-20` (K / 2-dp M).
  - `components/calendar/cashflow.ts:28-35,137` (k, one-decimal M, "−").
  - Other hand-rolled minus signs: `CashflowStrip.tsx:64`, `creditcards/verdictCopy.ts:112,124`, `monthly/ReviewChanges.tsx:25`, `overview/OverviewChanges.tsx:43`, `overview/upNext.ts:105`.
  - The doubled label: `OverviewPage.tsx` (the `(est.)` suffix near `:483`).
- **Polish:**
  - One sign rule inside `formatCurrency` (U+2212, which matches "+" width in mono).
  - One compact formatter with uppercase K/M.
  - One estimate marker ("≈").
  - Whole dollars, or K/M, for projections and estimates; cents kept for recorded amounts.
- **Impact:** numbers read as one system, and precision signals honesty (cents only where the cents are real).
- **Size:** S–M · **Confidence:** high

### MOTION-18 · Links: "Open X →" in three colours, and four different hover behaviours (most have none)
- **Where:** Overview cards, Guide, attention strip, month ribbon "Edit ↗", inline prose links.
- **What happens:**
  - "Open X →" appears as muted-grey 12 px on Overview cards ("Open net worth →"), accent 13.6 px on the Guide ("Open Overview →", "Go →") and text colour on the attention strip. Capitalisation is mixed.
  - Hover behaviour varies:
    - underline: Up next, the rewards-matrix card names, allocation categories;
    - muted → text: Overview drill links;
    - a background wash: attention items;
    - **nothing**: Guide arrow links, "Edit ↗", every inline link.
  - No link has a transition (0 s), unlike every button, tab and chip (120 ms).
- **Evidence:** `work-motion-consistency/analyze.mjs links / hovers` output.
- **Cause:**
  - `index.css:150-153` (`a`: accent, no decoration, no `:hover`).
  - Scattered local hovers: `OverviewPage.css:19-21, 51-53, 132-134`; `creditcards/matrix.css:32-34`; `portfolio/allocation.css:18`.
- **Polish:**
  - A global `a:hover { text-decoration: underline; text-underline-offset: 2px }` with a 120 ms colour ease.
  - One "Open X →" style (accent, sentence case) whose arrow nudges 2 px right on hover.
- **Impact:** links announce themselves under the pointer everywhere; navigation links look like one family.
- **Size:** S · **Confidence:** high

### MOTION-19 · Hard-coded black shadows and scrims bypass the theme tokens (muddy in light theme)
- **Where:** command palette, assistant launcher and drawer, toasts, calendar popover, pace/chain tips, detail panel, rewards-matrix best cell. Light theme.
- **What happens:**
  - The palette dims the page with **50% black**, while every other modal uses the light scrim rgba(20,30,50,.35). The page under the palette turns muddy grey.
  - The launcher wears a 40% black shadow (a grey smudge on the pale page), although `--shadow` exists to replace black shadows in light.
- **Evidence:** `shots/motion-consistency/light-palette-open.png`, `shots/motion-consistency/light-launcher.png`; `work-motion-consistency/lightshadow.mjs` output (computed values).
- **Cause:**
  - `CommandPalette.css:12, 20`; `assistant/assistant.css:27, 45`; `toast.css:44`; `CalendarPage.css:142`; `paycheck/pace.css:203`; `espp/espp.css:151`; `details/details.css:17`.
  - `creditcards/matrix.css:38` hard-codes the dark-theme green `rgba(63,185,104,.14)` in both themes.
- **Polish:** use `var(--scrim)` and `rgb(var(--shadow))` everywhere; a tokens test banning `rgba(0, 0, 0` in CSS keeps it that way.
- **Impact:** overlays feel of a piece in light theme.
- **Size:** S · **Confidence:** high

### MOTION-20 · Small consistency nits (one line each)
- **Two date grammars on month axes.**
  - Portfolio's weekly axis always prints "Oct 2023 · Jan 2024" (`portfolio/historyChartOptions.ts:125-127`, `formatMonth`).
  - The monthly axes at the same width print "Sep '23 · Dec '23" (`charts/monthLabels.ts:43-52`).
  - On the Overview the two sit side by side: Portfolio performance "Jan 2026" next to Recent spending "Jan '26" (`shots/motion-consistency/hops-dark-1440/first-update/03-122ms.jpg`).
- **"Share %" snaps** (redrawn in < 72 ms, legend swapped), while By owner / By group / Quarterly / month changes morph over ~250 ms (`work-motion-consistency/morph.mjs`; `shots/motion-consistency/composites/morph-share.png`).
- **Spinners** turn at three speeds: 700 ms (`assistant.css:433`), 0.9 s (`ProtectedRoute.css:29`), 1 s (`PortfolioPage.css:50`).
- **Ellipsis:** "Loading upcoming events..." uses ASCII dots (`OverviewPage.tsx:850`); everything else uses "…".
- **Expand/collapse tempo:** disclosures glide 120 ms (`disclosure.css:67-69`); dividend months glide 240 ms.
- **Money inputs** are right-aligned everywhere except Settings › Planning, which is left-aligned ("$24,500.00").
- **Placeholders:** Projection's number boxes show raw placeholders ("6711.63") beside "Baseline $6,711.63".
- **Card padding** is 17.6/20/20 everywhere except Projection's assumptions card (16 px).
- **Impact:** removes small "is this the same app?" moments.
- **Size:** S · **Confidence:** high

---

## D. Wide / narrow desktop

### MOTION-21 · On everyday laptop screens the sidebar grows its own scrollbar and hides theme / log-out
- **Where:** 1280×800, 1366×768, 1536×864 (every page).
- **What happens:**
  - The sidebar needs **886 px** of height. It overflows by 86 / 118 / 22 px, shows a second classic 16 px scrollbar beside the page's, and pushes "Light theme" and "Log out" below its fold. Without the local DEV/hash row (17 px) it still overflows at all three sizes.
  - At 1280 the Net worth ribbon wraps (the scope row grows from 69 to 111 px). The pinned block is then 153 px plus the scrim — ~23% of an 800 px window while scrolling.
- **Evidence:** `shots/motion-consistency/chrome-dark-1280/net-worth.png`; `work-motion-consistency/sidebar.mjs` output.
- **Cause:** `Layout.css:16-27` (`height: 100vh; overflow-y: auto`), 0.5rem link padding (`Layout.css:110-117`), a 4-row footer (`shell/shell.css:220-229`).
- **Polish:**
  - Under ~900 px of height, tighten the nav rhythm and fold the footer into one row (an account menu with theme and log out).
  - At ≤ 1280 px, let the ribbon shorten rather than wrap.
- **Impact:** no double scrollbar and no hidden account controls on common laptops; more page visible while scrolling.
- **Size:** S–M · **Confidence:** high

### MOTION-22 · At 1920–2560 px, captions run 200–350 characters per line, tables stretch and charts flatten
- **Where:** `/taxes`, `/portfolio`, `/projection`, `/paycheck`, `/credit-cards`, `/settings` and `/net-worth` at 1920×1080 and 2560×1440.
- **What happens:**
  - The full-bleed column is 1631 px (1920) and 2271 px (2560).
  - Captions and footnotes run ~200–260 characters per line at 1920, and up to ~350 at 2560.
  - Numeric tables stretch to 1589 / 2229 px: on the Taxes jurisdiction table a label sits ~2000 px from its figures.
  - Charts become 7:1 strips (2229 × 300–380 px); the waterfall's 8 bars float in a void.
- **Evidence:** `shots/motion-consistency/composites/wide-2560.png`; `shots/motion-consistency/wide-dark-2560/*.png`; `work-motion-consistency/wide.mjs` output.
- **Cause:** `panels.css:3-8` (full-bleed by the user's request, 2026-08-18); fixed chart heights.
- **Polish:** keep the full-bleed grid, but cap reading measures inside it:
  - `max-width: ~80ch` on ledes, captions and card prose;
  - numeric tables at `width: auto` with a max, so figures sit near their labels;
  - chart height scaling with width (e.g. `clamp(300px, 22% of width, 520px)`).
- **Impact:** big monitors show more data, not stretched sentences and flattened charts.
- **Size:** M · **Confidence:** high

---

## Strengths to keep (so a fix doesn't break them)
- **One rigorously tokenised motion clock** (120 / 180 / 200 / 240 ms, one ease-out; charts 450 ms in / 300 ms update; tooltip 120 ms). Only three literal durations exist across 45 CSS files, all of them spinners.
- **Reduced motion is complete:** nothing runs on hops or tabs, count-ups land final, reveal and scrims are off, charts are still.
- **Route changes are calm:**
  - header and scope row appear at once, and only the body fades/rises (240 ms);
  - every hop resets to top, and warmed chunks mean no "Loading…" hold;
  - the sidebar bar and tab underline slide on the same 200 ms curve.
- **The scroll-linked reveal and edge scrims are well judged:** across 11 long pages, no card in the middle half of the screen ever dropped below 0.9 opacity, and the top scrim respects the sticky row.
- **Charts behave:**
  - entrances wait until 20% visible, and cached revisits paint still;
  - range chips and view toggles morph (bar the one "Share %" nit);
  - skeleton → content is a real cross-fade;
  - no dark flash on light cold loads.
- **Docked panels** (assistant, inspector, holding detail) slide 240 ms both ways, and the launcher moves with the dock.
- **Card chrome is uniform:** all 89 card titles share one eyebrow style, and there is one card padding (one outlier).

## Not reproduced / environment artifacts (ruled out)
- **~2.1 s stall on one of 12–13 parallel API requests** (Portfolio / Overview revisits): it reproduces even from a static same-origin page with no interception, but curl through the same proxy answers all 12 in < 61 ms. That points to the local vite-preview / Windows serving path. It is not claimed as a performance finding; MOTION-07 is about the dim, not the time.
- **Capped table boxes** do not trap the wheel: they chain to the page at their end (Settings, Credit cards). The Income "trap" was the page already at its maximum scroll.
- **Net worth "Edward" = All total:** data, not a stale render (Edward's scope includes Joint; Grace holds $0).
- **Green "▼ under average" / "▼ refund expected":** StatTile's documented rule (glyph = direction, colour = judgement), so not flagged.
- **Environment only:** the DEV pill in the sidebar footer; "Prices never refreshed" before data lands on a cold load; prefs are fenced (theme/density changes don't persist).
