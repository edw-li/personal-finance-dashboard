# Portfolio & ESPP — polish findings

Pages/areas covered (1440×900 dark + light baseline; spot checks at 1280×800 and 1920×1080):
- **/portfolio** — cold load and skeleton (every tab); the five views (Overview, Holdings, Allocation, Income, Manage) and the swaps between them, from the top and from a scrolled position; WHOSE (All/Edward/Grace/Joint) and range (All/1Y/YTD) in sequence and in combination; the five KPI tiles and their ⓘ explainers.
  - Performance chart: hover at many points (tallest tooltips), the rug, the live point, legend toggles (S&P 500 on/off), ctrl+scroll zoom, drag-to-pan, Reset zoom, clicking the chart, Expand, Table, Export menu.
  - Holdings: row hover, sorting (Day/Ticker/Market value), clicking a row (the side panel, which the app calls the "dock"), its price chart and 1Y/3Y chips, switching rows, closing, keyboard Enter/Escape, the capped table box and its sticky header, the treemap (hover, Unrealized/Day change).
  - Allocation: all five breakdowns (Asset class / Industry / Geography / Account / Holding type), donut hover and click (dock), "Classify these 37 holdings", the classification chips and search (hits and no hits), Set targets (opened, not saved), the employer-equity card and its links.
  - Income: chart hover (a zero month and a real month), the range chips, fold/open a month, Expand all / Collapse all, scrolling inside the box, the form, Edit on a row.
  - Manage: Transactions/Securities/Realized sub-tabs, row hover and drag handle, Edit (form filled), Duplicate, Cancel, the capped ledger box.
  - Refresh prices: clicked. The save was blocked by the audit fence; only the way the error is shown was judged.
- **/espp** — cold load (each view).
  - Summary: the five tiles; Lot anatomy (Dollars/Per share, bar hover, bar click → dock → "Open lot records", Table); NVDA vs your purchases (1Y/3Y/All, hover).
  - Lots: sideways table scroll, Edit (form filled and row tinted), Cancel, Model sale link hover, the purchase-date prefill, the offerings "use close" chip.
  - Purchase model: year chips 2024–2027, meter hover and keyboard focus, typing into the settings above the table (the "knobs"; not saved), editing a period cell (the "unsaved" notes), the periods table.

## Findings (most impactful first)

### PE-01 · The holding details dock is laid out for a full page, so its content spills sideways and the Dividends ledger is hidden
- Where: Portfolio › Holdings › click any row (e.g. `/portfolio?section=holdings&ticker=VOO`) · every theme and width where the dock sits beside the page (1440, 1920)
- What happens: the dock is 384px wide inside, but its content is **791px** wide (VOO dark, VTI light). The Transactions and Dividends ledgers sit side by side at 458px + 296px:
  - Transactions is cut off after the Price column.
  - Dividends is **entirely off-screen to the right**.
  - A sideways scrollbar appears at the bottom of the dock.
  - Account names wrap ("Schwab / ESPP").

  A reader scrolling down never sees the holding's dividends.
- Evidence: `shots/portfolio-espp/dock-dark-1440/bottom.png`, `shots/portfolio-espp/verify2-light/dock-bottom.png`, `shots/portfolio-espp/holdings-dark-1440/drill-dock-scrolled.png`
- Cause: `src/components/portfolio/portfolio.css:64-65`. `.holding-detail-grid { grid-template-columns: 3fr 2fr }` only stacks under a *viewport* media query (`max-width: 1000px`). `HoldingDetailPanel` was written as an inline, full-width body and now renders in the 400px dock (`PortfolioPage.tsx:599`).
- Polish: stack the two ledgers when the space is narrow. Make the panel a container and use a container query (or simply `grid-template-columns: 1fr` inside `.detail-panel-body`). Let the facts grid and the chart take the full dock width.
- Impact: the drill-in shows everything it promises with a plain vertical scroll — no hidden ledger, no sideways scrollbar.
- Size: S · Confidence: high

### PE-02 · Opening the dock breaks the five-tile row into 2–3 rows, and on Holdings the clicked row jumps 247px down the page
- Where: Portfolio › Holdings row click; Portfolio › Allocation donut slice; Portfolio tile ⓘ; ESPP › Lot anatomy bar · 1440 (and the same breakage at 1280 with no dock)
- What happens: when the 400px dock opens, the content column shrinks from ~1150px to ~750px.
  - The five KPI tiles re-flow into 2+2+1 on Portfolio (the Dividend entries tile stretches alone across the width) and 3+2 on ESPP. The tile block grows from 103px to ~330px tall.
  - On Holdings the row you just clicked moves from y=555 to **y=802** (FXAIX, 1440×900), right down to the fold. At 1920 it moves only 7px.
  - The same 4+1 "lonely tile" appears at 1280 without any dock: Portfolio's Dividend entries tile and ESPP's $25k tile each sit alone on a second row.
- Evidence: `shots/portfolio-espp/drilljump-dark/1440-after.png`, `shots/portfolio-espp/holdings-dark-1440/drill-nvda/03-488ms.jpg`, `shots/portfolio-espp/espp-dark-1440/anatomy-clicked.png`, `shots/portfolio-espp/w-dark-1280/portfolio-section-holdings.png`
- Cause:
  - `PortfolioPage.tsx:599` opens the holding panel with no `anchor`. The dock API supports one (`DetailPanelProvider.tsx:25-35`) and chart drills already pass it (`ChartCard.tsx` `anchorIfInView`).
  - `.kpi-row-dense` / `.kpi-row-5` fall back to `auto-fit, minmax(200px)` below 1000px of container (`panels.css:108-123`), so 5 tiles wrap unevenly.
- Polish: pass the clicked row as `anchor`, so it is held under the pointer while the page re-flows. Give 5-tile rows an even fallback: 5 compact equal columns (drop the hero size), or a 3+2 split with both rows filled. Never 4+1 or 2+2+1.
- Impact: clicking a holding feels like it "opens beside" the row, not like the page jumping away. The headline row stays a tidy strip at every width.
- Size: M · Confidence: high

### PE-03 · The ESPP tables hide their most useful columns at ≤1440, and the pinned action buttons cut Gain % in half
- Where: ESPP › Lots table; ESPP › Purchase model periods table (`/espp?section=lots`, `?section=purchase`) · 1440 and 1280, both themes (both fit at 1920)
- What happens:
  - **Lots** needs 1350px but gets 1109px at 1440 (**241px hidden**; 401px at 1280). The pinned Edit/Delete/Model sale column (238px wide) starts at x=1134:
    - It slices the Gain % column in half ("+444.7" with the % cut off; the header reads "GAIN").
    - It hides **Disposition**, which holds the "Qualifying in 344 days" countdown, and Notes.
    - There is no fade, because the fade is deliberately switched off when a pinned column exists. The totals row, which has no action cell, prints "+314.8% · 6 held" right where the buttons sit on other rows.
  - **Purchase model** needs 1557px and gets 1109px (**448px hidden**; 608px at 1280). All six result columns (Price, Shares, Cost, Refund, Carry out, 25k value) are behind the sideways scroll, so after editing Base or % you cannot see what it buys without scrolling sideways.
  - Editing a period cell also inserts a second "Unsaved period edits…" sentence above the card, which jumps 24px.
- Evidence: `shots/portfolio-espp/lots-dark-1440/table.png`, `shots/portfolio-espp/lots-dark-1440/table-scrolled-right.png`, `shots/portfolio-espp/verify2-light/espp-lots.png`, `shots/portfolio-espp/purchase-dark-1440/dirty.png`
- Cause: 13–14 nowrap columns in monospace (`EsppPage.css:23-30` `.espp-scroll`, `.data-table .num` monospace in `panels.css:244-248`). The row actions are 3 full buttons (`EsppPage.tsx:514-544`). The duplicate note is `PositionStrip.tsx:133-137` together with `EsppPage.tsx:1137-1143`.
- Polish:
  - Lots: collapse the row actions into one "⋯" menu (or icon buttons) so they take ~40px. Move Disposition next to Purchased (it is the column people scan). Merge Gain and Gain % into one cell ("$47,670 · +444.7%").
  - Purchase model: show the results first (Shares, Refund, 25k value), and move Subscription/Available into the cell sub-line.
  - Show the unsaved note once, next to the Save button.
- Impact: the whole lot story (cost, gain, when it qualifies) and the model's answer fit on one screen at the most common width.
- Size: M · Confidence: high

### PE-04 · The Performance chart's dividend "rug" reads as a barcode along the $0 line (lead 1 confirmed)
- Where: Portfolio › Overview › Performance (`/portfolio`) · both themes, 1440 and 1920
- What happens: nearly every weekly bar carries a mark (the builder's own note says ≈132 of 155). There are grey dots from Oct 2023 to Aug 2025, then white or black ticks every week to Sep 2026. They sit directly on the x-axis line, between the "$0" label and the month labels, and read as noise or a rendering glitch rather than information. Two shapes and two tones sit in one 10px strip. In light theme the black ticks on the pale wash are even louder.
- Evidence: `shots/portfolio-espp/perf-dark-1440/axis-rug.png`, `shots/portfolio-espp/tour-light-1440/pf-overview.png`, `shots/portfolio-espp/w-dark-1920/portfolio.png`
- Cause: `src/components/portfolio/performanceEvents.ts:239-273` (one rug point per weekly bar per kind) and `:293-330` (2×10px INK ticks and 6px MUTED dots at y=0, always on). It is added to the chart in `historyChartOptions.ts:198`.
- Polish (pick one or combine):
  1. Aggregate to **one mark per month** (a small tick whose height or opacity scales with that month's dividend $, with the count in the tooltip).
  2. Draw the rug in its own thin lane *under* the month labels (a second 8px grid) at ~40% opacity, lifting to 100% on hover.
  3. Start both rug series switched off in the legend, like the S&P line.
- Impact: the baseline stops looking busy, the value and cost lines carry the chart, and dividends become a readable monthly rhythm instead of static.
- Size: M · Confidence: high

### PE-05 · Event tooltips grow to 20+ lines and slide under the sticky bar, hiding the date and portfolio value
- Where: Portfolio › Overview › Performance, hovering the last weeks (dividend-heavy); ESPP › Lot anatomy after the dock opens · both themes, 1440 and 1920
- What happens: the Aug 31, 2026 tooltip has 22 lines and is **413px tall**. It starts at y=119/131 while the sticky tab and scope block ends at y=194. The header (the date) and the first rows (Portfolio value, Cost basis) are hidden under the sticky bar, and those are exactly the lines the reader wanted. On ESPP, a lot tooltip left open while the dock re-flowed the page was cut off at the viewport's left edge ("…ppreciation", "…aid").
- Evidence: `shots/portfolio-espp/perf-dark-1440/hover-end.png`, `shots/portfolio-espp/tip-light-1440/tallest.png`, `shots/portfolio-espp/espp-dark-1440/anatomy-clicked.png`
- Cause: `charts/tooltip.ts:210-215`. The axis tooltip sets no `confine` (the tooltip can overflow its chart) and no size limit. `performanceEvents.ts:281-287` lists every event line.
- Polish: `confine: true` on the grammar's tooltips. For event lists, summarise: "12 dividends · $41.52" plus the 3 largest, then "+9 more". Keep the date and value rows first and always visible.
- Impact: every hover answers "what was it worth that week" without the key line disappearing under the header.
- Size: S · Confidence: high

### PE-06 · Coming back to Overview, Holdings or Allocation replays the $0 → $895,824 count-up, and the tile row pops in and out
- Where: Portfolio view tabs · Income/Manage → Overview/Holdings/Allocation · both themes
- What happens:
  - **Count-up replay:** each return re-mounts the tile row, so the hero value counts up again from nothing: "$148,066.94 → $508,072.34 → … → $895,820.70" over ~450ms (light), "$69,771.83" at 243ms and "$733,392.03" at 427ms (dark). It is a first-arrival flourish that now plays on every tab switch.
  - **Row pop:** the row itself appears and disappears with no transition, so the first card's top edge jumps between y=329 and y=210 (**119px**) on each such switch, while the panel below only fades 6px.
- Evidence: `shots/portfolio-espp/tabs-dark-1440/to-Overview/01-243ms.jpg`, `shots/portfolio-espp/tabs-dark-1440/to-Overview/02-427ms.jpg`, `shots/portfolio-espp/tabs-dark-1440/to-Income/01-179ms.jpg`
- Cause: `PortfolioPage.tsx:710` renders the row only for `TILE_VIEWS`, so it unmounts on Income/Manage. `:722-726` passes `countUp` whenever `!fromCache`, and `StatTile.tsx:79-106` captures it at mount.
- Polish: keep the row mounted and hide it (the same `hidden` idiom `LocalSectionPanel` uses), or gate `countUp` on "first reveal this page view". Fold the row's height in and out together with the panel's fade (height to auto over the page's standard "enter" motion duration, `--t-enter`) so the content glides instead of jumping 119px.
- Impact: tab switching feels calm and instant, and the count-up keeps its "just arrived" meaning.
- Size: S · Confidence: high

### PE-07 · After using a range chip, switching Whose shows a phantom "Reset zoom" and rewrites the headline sentence above the chart with a different number
- Where: Portfolio › Overview › Performance (`/portfolio` → 1Y or YTD chip → Edward, Grace or Joint) · reproduced with 3 different sequences
- What happens: nobody zoomed, yet a **Reset zoom** button appears and the lede changes. Examples:
  - YTD: "Year to date: ahead … by $37.3K" becomes "**Dec 29, 2025 – Sep 21, 2026**: ahead … by **$36.4K**".
  - 1Y: "$37.2K" becomes "Sep 15, 2025 – Sep 21, 2026 … **$41.6K**".

  It **persists after switching back to All**. It does not happen when the range comes from the URL on a fresh load.
- Evidence: console log of `work-portfolio-espp/ownerzoom2.mjs`; `shots/portfolio-espp/perf2-dark-1440/whose-edward-final.png`, `shots/portfolio-espp/perf2-dark-1440/whose-joint-final.png`
- Cause: `PortfolioPage.tsx:226-227` stores every zoom echo, including the chip's own programmatic one, which ends on the appended live category, as `range.window`. A person view drops the live category (`:556-561`), so the axis shrinks under that stored window. ECharts clamps it and echoes it back. `benchmarkLede.ts:122` then calls it "dragged", and `ChartCard` treats it as a manual zoom.
- Polish: reset `range.window` on an owner switch, and ignore echoes that equal the preset's resolved window.
- Impact: the chart and its headline stay honest. "Reset zoom" appears only after a real zoom, and the headline number doesn't silently change.
- Size: S · Confidence: high

### PE-08 · The ESPP lot form is ragged: one field with a note makes the whole row 128px tall and pushes everything else down
- Where: ESPP › Lots › the add/edit lot form (`/espp?section=lots`) · both themes, 1440 and 1920 (also 1280)
- What happens: "Purchase price" and its 5-line note sit alone at the top right (y=340–468). The other five fields sink to the bottom of that row (labels at y≈418), leaving a **~76px empty band** top-left. The second row (the Sold date/price pair with its own note, then Notes, then Add lot) sits on three different baselines. At 1920 there are three label baselines (351 / 400 / 443) and "Add lot" drops to its own row.
- Evidence: `shots/portfolio-espp/lots-dark-1440/table.png`, `shots/portfolio-espp/verify2-light/espp-lots.png`, `shots/portfolio-espp/w-dark-1920/espp-section-lots.png`
- Cause: `EsppPage.css:35-41` (`.espp-form` is an auto-fit grid with `align-items: end`). The field notes live inside grid items (`EsppPage.tsx:389-423`, `.espp-field`, `.espp-sold-pair`), so they set the row height.
- Polish: take the notes out of the grid. Put one quiet hint line under the whole form (or ⓘ hints on the two labels), and align the fields to the top. A fixed 4-column layout reads as a clean ledger row: dates · shares · prices · sold pair · notes + Add lot.
- Impact: the form reads as one tidy row of inputs instead of a jumble, so entering a semi-annual lot is faster and feels finished.
- Size: S · Confidence: high

### PE-09 · The loading placeholders don't match the page, so content jumps 143–148px when data lands
- Where: Portfolio cold load (every tab); ESPP cold load (Lots, Purchase model) · 1440, dark and light
- What happens:
  - **Portfolio:** the placeholder shows 5 tiles wrapped **4+1** (each 276×115) and two cards (400px and 360px). The real page has 5 tiles in **one row** (217×103) and, on Overview, one card. When data lands, the chart card jumps from y=480 to 337 (−143px). The page height drops from 1296 to 900, so the scrollbar vanishes.
  - **Income and Manage:** these tabs show the same 5 placeholder tiles, but the real tabs have no tiles at all.
  - **ESPP:** the placeholder strip also wraps 4+1. Its panel jumps y=397→249: layout-shift score (CLS) **0.073** on Lots (3/3 runs), 0.03–0.06 on Purchase.
- Evidence: `shots/portfolio-espp/cold-portfolio-dark/02-1093ms.jpg` (placeholder) vs `shots/portfolio-espp/tour-dark-1440/pf-overview.png` (final); console of `work-portfolio-espp/skeleton.mjs` and `coldload.mjs`
- Cause:
  - `PageSkeleton.tsx:30` and `:92` render `.kpi-row` without the page's modifier (`kpi-row-dense` in `PortfolioPage.tsx:711`, `kpi-row-5` in `PositionStrip.tsx:63`).
  - The ghost tile height is fixed at 115px (`panels.css:710`), but the real 5-across tiles are 103px (Portfolio) and 98px (ESPP).
  - The Portfolio placeholder spec is one fixed layout for all tabs (`PortfolioPage.tsx:700-706`).
- Polish: let `PageSkeleton` take the row class (`dense`/`five`) and size ghost tiles to it. Make the Portfolio placeholder follow the arriving tab (no tiles on Income/Manage; one 300px chart on Overview).
- Impact: a cold load settles in place — no two-row strip snapping into one, no card leaping up.
- Size: S · Confidence: high

### PE-10 · "Prices never refreshed" shows under the Portfolio title the whole time the page loads
- Where: Portfolio subheader, every cold load and every load failure (`/portfolio`, any tab) · both themes
- What happens: for the entire loading phase (3.6 s+ in the audit stack) the subheader says **"Prices never refreshed"**. It then flips to "Prices as of Sep 23, 2026 · last refresh Sep 24, 2026, 1:10 PM (scheduled) · 86 updated". If the load fails, the false claim stays up next to the error. It is a confident, wrong statement at the very first glance.
- Evidence: console of `work-portfolio-espp/coldload.mjs` (samples 400–3600ms); `shots/portfolio-espp/cold-portfolio-dark/02-1093ms.jpg`, `shots/portfolio-espp/tour-light-1440/pf-allocation.png`
- Cause: `PortfolioPage.tsx:453-456`. `noPricesWords` falls to "Prices never refreshed" when both `holdings` and `refreshStatus` are still null. It is rendered by `:619-633` in every frame state.
- Polish: render nothing (or a same-height placeholder bar) until the first payload lands; say "Prices never refreshed" only when the refresh status actually says so.
- Impact: no false claim about the user's data during the first seconds.
- Size: S · Confidence: high

### PE-11 · The two ESPP chart cards do NOT line up — 17px ragged bottoms at every width (lead 4 refuted)
- Where: ESPP › Summary (`/espp`) · 1280, 1440 and 1920, both themes
- What happens: Lot anatomy is 480px tall and "NVDA vs your purchases" is 463px, so the right card ends **17px higher** at all three widths. The grid slots are both 496px, so neither card fills its slot. The mismatch gets much worse with interaction:
  - **Table** on Lot anatomy grows that card by several hundred px while its neighbour stays 463px.
  - **The dock** re-flows the pair.
- Evidence: console of `work-portfolio-espp/espp.mjs` (ONLY_MEASURE runs); `shots/portfolio-espp/tour-dark-1440/espp-summary.png`, `shots/portfolio-espp/tour-light-1440/espp-summary.png`, `shots/portfolio-espp/verify2-light/anatomy-table.png`
- Cause: the charts are portalled into `.chart-card-slot` (`ChartSurface.tsx`), which stretches, while the `section.chart-card` inside keeps its natural height (`chartInteractions.css:1` has no height rule). The footers differ: 2 lines (`LotAnatomyCard.tsx:94-124`) against 1 line plus the zoom-hint row (`EsppPriceCard.tsx:88-112`).
- Polish: make the portal host and the card fill the slot (`height: 100%`, a flex column with the footer pushed to the bottom), so side-by-side chart cards always share one bottom edge.
- Impact: the Summary reads as one composed pair instead of two cards that almost match.
- Size: S · Confidence: high

### PE-12 · The range chips (All · 1Y · YTD) sit on all five Portfolio tabs but only change the Overview chart
- Where: Portfolio › Holdings / Allocation / Income / Manage · both themes
- What happens: on Income, which has the page's other time-axis chart, choosing 1Y changes nothing. Monthly dividend income still shows the full 24 months, and the tiles are unchanged. The chip lights up and the URL updates, which tells the reader something happened when nothing did. The same is true on Holdings, Allocation and Manage.
- Evidence: `shots/portfolio-espp/income-dark-1440/after-1y.png` vs `shots/portfolio-espp/income-dark-1440/top.png`
- Cause: `PortfolioPage.tsx:680-684` shows `<ScopeBar owner range …>` for every section. Only `performanceOption` (`:546-570`) reads `range`.
- Polish: show the range chips only on Overview (or on Overview and Income), or make them drive the Income chart's window as well.
- Impact: every control on screen does something, so a reader never wonders whether a click registered.
- Size: S · Confidence: high

### PE-13 · The Monthly dividend income chart spends almost half its bars on months before any dividend was recorded
- Where: Portfolio › Income › Monthly dividend income · both themes, 1440 and 1920
- What happens: the chart always spans 24 months (Oct '24 – Sep '26). The ledger only starts in Aug 2025 ("14 months · 382 entries"), so **10–11 leading months are empty**. Hovering one says "Dividends $0.00", as if nothing was earned, when nothing was tracked. The real bars are squeezed into the right half.
- Evidence: `shots/portfolio-espp/income-dark-1440/chart-hover-zero.png`, `shots/portfolio-espp/tour-dark-1440/pf-income-full.png`
- Cause: `src/components/portfolio/dividendChartOptions.ts:12` (`INCOME_WINDOW_MONTHS = 24`) with zero-filling from the window start (`:18-35`).
- Polish: start the axis at the first month that has an entry (keep a 12-month minimum), or shade the pre-tracking months with a "Not tracked before Aug 2025" label and leave them out of the tooltip.
- Impact: bars get about twice as wide, and "$0" is only ever said about a month that really was quiet.
- Size: S · Confidence: high

### PE-14 · "Dividend entries" reads like a count for a dollar figure, and one concept has three names (lead 2 confirmed)
- Where: Portfolio KPI tile (all tile views); the holding dock's facts; Holdings table column; Income tiles
- What happens: the tile says **DIVIDEND ENTRIES $9,122.55** ("entries" suggests "how many"). The same figure is called "Dividends" in the Holdings column and "Dividend entries" again in the holding dock ($701.21). The tile's sub-line says "$8,744.62/yr expected", while the Income tab calls the same number **"Projected annual income"**. The ⓘ explains the intent: automatic rows are ex-date estimates, not confirmed receipts.
- Evidence: `shots/portfolio-espp/tour-dark-1440/pf-overview.png`, `shots/portfolio-espp/misc-dark/receipt-dividend-entries.png`
- Cause: `PortfolioPage.tsx:764-773`; `HoldingDetailPanel.tsx:212`; `HoldingsTable.tsx:25`; the Income tiles in `DividendsPanel.tsx`.
- Polish: rename the tile to **"Dividends recorded"** (it keeps the no-receipt honesty) and use it everywhere this total appears. Say "Projected annual income" in both places.
- Impact: the tile reads instantly as money. The same number carries one name wherever it appears.
- Size: S · Confidence: high

### PE-15 · Text boxes and dropdowns are styled like number fields: monospace, right-aligned, and truncated
- Where: Portfolio › Allocation › Security classifications; Manage/Income forms (Account, Notes); Securities form (Ticker, Name, Industry); Targets "Add category"; ESPP Purchase model knob placeholders · both themes
- What happens:
  - "Unclassified" and "Not set" dropdowns, "Add a note" and "Find a security" placeholders all render right-aligned in monospace.
  - The Account box cuts "RH Joint Taxable" to "RH Joint Taxab".
  - The knobs read "  from offerings" / "  latest quote" in code type.

  Next to proportional labels it looks like a spreadsheet dump, and names are harder to scan.
- Evidence: `shots/portfolio-espp/alloc-dark-1440/classify-after.png`, `shots/portfolio-espp/editscroll/manage-after-edit.png`, `shots/portfolio-espp/verify2-light/classifications.png` (computed font "ui-monospace / right" in both themes)
- Cause: `panels.css:359-369`. `.field-input` is monospace and right-aligned by design, "for the figures". Free-text controls reuse it:
  - `ClassificationEditor.tsx:103,225,230,236,241`
  - `TransactionsPanel.tsx:566,606,653`
  - `DividendsPanel.tsx:536,563`
  - `SecuritiesPanel.tsx:188,196,200`
  - `AllocationTargetEditor.tsx:119,123`
  - `EsppPage.tsx:1109,1118`

  Only the ESPP Notes box opts out (`EsppPage.css` `.span-2 .field-input`), with the comment "Free text, not a number".
- Polish: add a `.field-input-text` variant (the normal proportional font, left-aligned) for every text, select and search control, and keep monospace/right for amounts only.
- Impact: the forms read naturally, text is no longer clipped, and numbers stand out as numbers.
- Size: S · Confidence: high

### PE-16 · The "Table" views under the charts print raw, unformatted values
- Where: Performance › Table; Lot anatomy › Table (and every ChartCard table in the lane) · both themes
- What happens:
  - Dates print as "2023-10-23" and money as "53619.00" (no $ and no thousands separators), next to a chart that says "$800.0K".
  - The anatomy table shows "260.0000", "41.23265", "79.11200", and its dates wrap mid-date ("2024-02-" / "29").
  - Headers are left-aligned over right-aligned numbers, so "PORTFOLIO VALUE" doesn't sit over its column.
  - The Performance table lists 155 rows oldest-first even when the chart shows YTD.
- Evidence: `shots/portfolio-espp/perf2-dark-1440/table.png`, `shots/portfolio-espp/verify2-light/anatomy-table.png`
- Cause: `ChartTable.tsx:17` (anything starting with a digit, ISO dates included, becomes a right-aligned monospace "num" cell) and `:32-34` (the CSV strings are printed verbatim). `.data-table th { text-align: left }` (`panels.css:227-237`) is applied even over `num` columns. `historyChartOptions.ts:283-305` feeds the raw server strings.
- Polish: keep the CSV raw but display formatted cells (dates, currency, trimmed decimals). Right-align headers over numeric columns. Newest first, limited to the chart's visible range.
- Impact: the table becomes a readable twin of the chart instead of a debug dump.
- Size: M · Confidence: high

### PE-17 · The heat treemap's "Day change" view is a uniform grey slab
- Where: Portfolio › Holdings › Holding performance treemap › Day change · both themes
- What happens: daily moves are −1% to +4.5%, but the colour scale saturates at ±50% (made for unrealized gains). Every tile renders near-neutral grey, so the view carries no colour information. The footer still says "capped at ±50%".
- Evidence: `shots/portfolio-espp/holdings-dark-1440/treemap-daychange.png`, `shots/portfolio-espp/verify2-light/treemap-daychange.png`
- Cause: `allocationChartOptions.ts:80-81,102,216-217` (one `HEAT_CLAMP = 0.5` for both metrics); fixed footer in `HeatTreemapCard.tsx:71`.
- Polish: a per-metric clamp (about ±3% for Day change, ±50% for Unrealized), with a footer that names the active cap.
- Impact: "which of my holdings moved today" becomes visible at a glance.
- Size: S · Confidence: high

### PE-18 · Switching Whose keeps the previous person's numbers on screen for 1–2 s, then swaps them instantly
- Where: Portfolio › any tile view, WHOSE chip (All → Grace, All → Edward) · 1440 dark
- What happens: the new chip lights up at once, but the tiles, table and charts keep showing the household's figures at 70% opacity. Under "Grace" the tiles still read $895,824.22. After ~2.3 s (audit stack; production is faster) the figures snap to $311,031.61 with no transition. The Overview chart also re-lays out the moment the chip is pressed: the live dot and its legend entry disappear, and a 2-line footnote appears (the card grows 42px), before any data arrives.
- Evidence: `shots/portfolio-espp/misc-dark/holdings-owner-grace/07-262ms.jpg` (stale under Grace), `…/09-2388ms.jpg` (swap); `shots/portfolio-espp/perf2-dark-1440/whose-edward/05-190ms.jpg`
- Cause: `PortfolioPage.tsx:313-324` (no cached snapshot means the old data stays under the reload dim); `.loading-dim.is-loading` is opacity 0.7 (`panels.css:445`, `index.css:65`).
- Polish: while a scope switch is pending, show a light shimmer or "Loading Grace…" on the tile figures instead of the old owner's numbers. On arrival, count from the old value to the new one (the tiles already have a count-up engine).
- Impact: the numbers never contradict the chip, and the switch reads as one deliberate change.
- Size: M · Confidence: medium (the delay is inflated by the shared backend; the stale-under-new-chip state isn't)

### PE-19 · The Performance chart is fixed at 300px, so Overview — a one-chart tab — ends a third of the way down a large screen (lead 3)
- Where: Portfolio › Overview · 1440 (page ends at 820 of 900) and 1920 (815 of 1080)
- What happens: at 1920 the chart is ~1590×300 (an aspect of about 5.3:1). It is squat and wide, with 265px of empty page beneath it. The week-to-week wiggles are flattened. At the same time, Holdings, Allocation and Income run 1435–2080px, so Overview feels like a stub by comparison.
- Evidence: `shots/portfolio-espp/w-dark-1920/portfolio.png`, `shots/portfolio-espp/tour-dark-1440/pf-overview.png`
- Cause: `PortfolioPage.tsx:787` (`height={300}`).
- Polish: size the chart to the viewport on this tab (e.g. `clamp(300px, 100vh − 560px, 560px)`), so the tab fills the first screen at every size.
- Impact: the headline chart gets the room it deserves, and the tab stops ending in an empty field.
- Size: S · Confidence: high

### PE-20 · Switching the Allocation breakdown resizes the card by up to 294px and leaves the donut floating at the top
- Where: Portfolio › Allocation › Asset class / Industry / Geography / Account / Holding type · 1440 (and 1920)
- What happens: the card is 431px on Asset class, **725px on Industry**, 431px on Geography and 461px on Account. On Industry the 330px donut sits at the top of its column beside a 624px list, leaving ~294px of empty space under it. Everything below the card moves on each click. On Asset class the list is 43px shorter than the donut column. In the long list, the floating assistant button sits on the Weight column.
- Evidence: `shots/portfolio-espp/alloc-dark-1440/dim-Industry.png`; console of `work-portfolio-espp/alloc.mjs`
- Cause: `chartInteractions.css:52` (`.chart-card-with-aside { align-items: start }`); the side list is unbounded (`AllocationPanel.tsx:165-211`).
- Polish: centre the donut vertically in its column (or pin it with `position: sticky` while the list scrolls). Cap the list at the donut's height with its own scroll box and pinned header, like the other capped tables.
- Impact: switching views keeps the page still and the chart beside its legend.
- Size: S · Confidence: high

### PE-21 · Chart labelling is inconsistent across the lane
- Where: ESPP › NVDA vs your purchases; Holdings dock › Price history; ESPP › Lot anatomy (narrow); every money axis
- What happens:
  - **Arbitrary-day axis labels:** the daily price charts label random days ("Aug 18, 2023 · May 23, 2024 · Mar 3, 2025 · Dec 4, 2025"). The Performance chart deliberately labels month starts ("Oct 2023 · Jan 2024").
  - **Missing years:** when the Lot anatomy card narrows (dock open), its labels become "Feb '24 · Aug · Feb · Aug · Feb · Aug", with the years gone.
  - **Trailing zeros:** money axes print "$1.00M · $800.0K · $600.0K" and "$70.0K".
  - **Identical legend colours:** the ESPP legend shows two identical grey swatches for "Subscription price" and "Avg paid to date".
- Evidence: `shots/portfolio-espp/tour-dark-1440/espp-summary.png`, `shots/portfolio-espp/espp-dark-1440/anatomy-clicked.png`, `shots/portfolio-espp/dock-dark-1440/top.png`
- Cause:
  - `priceChartOptions.ts:113` and `esppChartOptions.ts:567` use `dateAxis`, which uses ECharts' own label thinning (`monthLabels.ts:114`).
  - `monthTick` (`monthLabels.ts:44-52`) adds the year only to the first label and to January, and Feb/Aug-only axes have no January.
  - `formatCurrencyCompact` uses fixed decimals (`utils/format.ts:19-20`).
  - `esppChartOptions.ts:518-524` gives both reference lines the same MUTED colour.
- Polish:
  - Reuse the Performance chart's month-start stride for the daily charts.
  - Add the year to the first label of each new year.
  - Drop trailing zeros on axis ticks ("$800K", "$1M").
  - Give the two reference lines distinct dash patterns in both the lines and the legend icons.
- Impact: every chart in the lane is read the same way, with no guessing which "Aug" is which year.
- Size: M · Confidence: high

### PE-22 · A failed "Refresh prices" shows up as a page-level "Showing earlier data" line whose Retry doesn't retry the refresh (the save itself was blocked by the audit fence)
- Where: Portfolio › Refresh prices (clicked on `/portfolio?section=manage`)
- What happens: the button shrinks 10px to "Refreshing…" (width 127→117px). The failure then appears not near the button but as the frame's stale line under the scope bar, "Showing earlier data — <message> [Retry]", which pushes the content down 40px. The data is not "earlier": only the refresh failed. **Retry reloads the page's data instead of re-running the refresh.** The message is the server's raw text, not the house wording ("the server had a problem…"). A successful refresh, by contrast, reports in the subheader next to the button.
- Evidence: `shots/portfolio-espp/manage-dark-1440/refresh-fenced.png`, `shots/portfolio-espp/manage-dark-1440/refresh-fenced/01-77ms.jpg`
- Cause: `PortfolioPage.tsx:426-437` routes `onError` into the page `error`, rendered as `PageFrame`'s stale line (`PageFrame.tsx:182-191`) with `retry = reload`; `usePriceRefresh.ts` uses `err.message` rather than `errorDetail`.
- Polish: show the failure in the refresh note slot under the title (the same place success appears), with "Try again" re-running the refresh. Give the button a fixed min-width so its label swap doesn't resize it.
- Impact: the outcome of the action appears where the action was taken, and "Try again" does what it says.
- Size: S · Confidence: high (presentation judged; the refresh itself was blocked by the audit fence)

### PE-23 · "Open Comp vesting schedule" reloads the whole app, and it is styled differently from its sibling button
- Where: Portfolio › Allocation › Employer equity · NVDA card
- What happens: clicking the link does a full document navigation (navigation type "navigate"; an in-page marker is lost). There is a blank flash, every page's cache is lost, and the app shell reloads. It also looks different from its sibling: a large blue text link beside a regular "Open Portfolio position" button.
- Evidence: console of `work-portfolio-espp/alloc.mjs` ("spa marker survived? false"); `shots/portfolio-espp/alloc-dark-1440/employer.png`
- Cause: `AllocationPanel.tsx:224`, a plain `<a href="/comp?section=vesting">` instead of a router `<Link>`.
- Polish: use `<Link className="button">` (or both as the house "Open X →" link style).
- Impact: an instant in-app hop that matches the card's other action.
- Size: S · Confidence: high

### PE-24 · Manage: the sub-tabs stretch into an empty full-width bar, and Edit mode gives weak feedback
- Where: Portfolio › Manage (Transactions / Securities) and Income (the dividend ledger's Edit); Holdings header sort · both themes, 1280–1920
- What happens:
  - The Transactions/Securities/Realized tabs sit inside a **1151px** bordered bar that reads like an empty input field.
  - In Edit mode the edited row is not highlighted (ESPP Lots tints it). The only cue is a focus ring on the Edit button.
  - "Save changes" wraps onto two lines in its 140px grid cell, so the button stands 46px tall beside 30px inputs.
  - Clicking a sortable Holdings header inserts "↓", shifting neighbouring headers a few px.
- Evidence: `shots/portfolio-espp/manage-dark-1440/editing.png`, `shots/portfolio-espp/editscroll/manage-after-edit.png`, `shots/portfolio-espp/w-dark-1280/portfolio-section-manage.png`
- Cause:
  - `PortfolioPage.css:38` (`.portfolio-manage { display: grid }` stretches the tab strip to full width).
  - `TransactionsPanel.tsx:378-384` and `DividendsPanel.tsx:323-330` (`startEdit` sets no row class).
  - `.entry-form` grid cells (`portfolio.css:69`).
  - `HoldingsTable.tsx:105`.
- Polish: `justify-self: start` on the sub-tab strip; tint the edited row (reuse ESPP's `is-editing`); `white-space: nowrap` on form buttons; reserve the sort-arrow width on every sortable header (a faint ↕ on hover).
- Impact: the ledger tools look finished, and it is always obvious which row you're editing.
- Size: S · Confidence: high

### PE-25 · Holdings table: fund names are cut at 150px even with space to spare, and near-flat lines are drawn as zigzags
- Where: Portfolio › Holdings table · 1920 (names), all widths (sparkline)
- What happens:
  - At 1920 names are still cut ("Vanguard Total Stock Market…", "Schwab US Dividend Equity E…") with ~180px of blank column beside them.
  - SGOV's 1-year line (−0.1%) is drawn as a full-height grey zigzag that reads as volatility.
- Evidence: `shots/portfolio-espp/w-dark-1920/portfolio-section-holdings.png`, `shots/portfolio-espp/holdings-dark-1440/treemap-hover.png`
- Cause: `portfolio.css:33` (`.ticker-cell .sub { max-width: 150px }`); `Sparkline.tsx:56-61` scales each line to its own min–max.
- Polish: let the name use the free space (e.g. `max-width: clamp(150px, 16vw, 300px)`). Give sparklines a minimum vertical range of ±2% of the start price, so a flat year draws flat.
- Impact: full names at a glance on wide screens, and the 1Y column no longer implies volatility that isn't there.
- Size: S · Confidence: high

### PE-26 · The floating assistant button covers the last row's action in ESPP Lots
- Where: ESPP › Lots, the bottom row's "Model sale →" (1440, both themes); Allocation Industry list (Weight column)
- What happens: the 44px launcher (bottom-right) overlaps the right end of the "Model sale →" button on the last visible row, and a "0.0%" cell in the Allocation list.
- Evidence: `shots/portfolio-espp/verify2-light/espp-lots.png`, `shots/portfolio-espp/alloc-dark-1440/dim-Industry.png`
- Cause: a fixed-position launcher (shell) without matching end padding in capped tables/cards. Not located in lane code.
- Polish: add ~56px of bottom padding (or `scroll-padding`) to page bodies and capped boxes, or shrink the launcher to a small tab while a table scrolls under it.
- Impact: no control is ever half-hidden under the launcher.
- Size: S · Confidence: medium

## Strengths to keep (so a fix doesn't break them)
- **Dividend ledger:** the month header pins inside the capped box while you scroll; Expand/Collapse all is instant (97–240ms measured); months glide open and shut.
- **The view tabs:** a sliding accent indicator, a gentle 6px panel fade, a remembered scroll position per tab, and arrow-key navigation.
- **Keyboard drill-in on Holdings:** Enter opens the dock with focus inside it; Escape closes it and returns focus to the row's toggle.
- **"Classify these 37 holdings":** scrolls to the classifications card, pins the Unclassified chip and puts a visible focus ring on the first select. The search's no-hits state offers "Show all securities".
- **Chart state is respected:** legend picks and range survive refetches. Range chips glide the Performance chart, and the sentence above the chart follows the window ("Over 1Y: ahead … $37.2K").
- **ESPP chart ↔ table link:** hovering a lot bar highlights its row, and clicking pins it with "Open lot records". The $25k meter has hover and focus tips, and editing a lot tints its row.

## Not reproduced / environment artifacts (ruled out)
- **"Couldn't load the portfolio — The user aborted a request."** (seen 4× on cold loads): the client's 15 s request timeout firing while other auditors loaded the shared backend. The endpoints answer in 20–150 ms when idle. The "user aborted" wording most likely comes from the harness's request interception; not reported. Retry recovered each time.
- **Slow first paint** (3.5–7 s): shared-backend load, not app performance; not claimed.
- **Edward's view equals the household's, and Grace's equals Joint's:** a data fact (every account is Edward's or joint), not a UI issue.
- **Returning to Allocation restored y=1148 instead of the 1180 it left** (seen once); not re-verified, so dropped.
- **A fresh session sometimes opened on the 1Y range:** the range is remembered across pages by design (`useScope`).
- **Out of polish scope, flagged for a correctness lane:**
  - The "Same deposits in VOO" leg equals cost basis exactly for the first **95 of 155** weeks (Oct 2023 – Aug 11, 2025), because VOO price bars in this copy of production start **2025-08-11**. `value_history.py:236-240` carries the leg flat before the first bar.
  - As a result, the All-range headline "Ahead of the same deposits in VOO by $263.7K" is overstated, and the orange and amber lines coincide for two years.
  - Presentation fix if wanted: leave the benchmark blank where there is no data, and say "since Aug 2025" in the headline.
- **Not reviewed (out of scope per brief):** the Realized tab and XIRR.
- **Artifacts, not findings:** audit-fence errors (only their presentation is judged, in PE-22) and the sidebar's DEV badge.
