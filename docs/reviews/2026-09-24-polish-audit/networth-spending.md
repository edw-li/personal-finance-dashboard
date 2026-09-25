# Net worth + Spending — polish findings

Pages/areas covered (full pass at 1440×900 dark; both pages and every finding's surface re-checked in light; spot checks at 1920×1080 and 1280×800). Scripts: work-networth-spending/*.mjs; shots: shots/networth-spending/.
- **Net worth**: first load (film), Overview ⇄ Accounts swap (films, two round trips, from a scrolled position), Monthly ⇄ Quarterly (films), Whose All/Edward/Grace/Joint (films and request timing), range All/1Y/YTD (films), month ribbon (all 12 chip titles, Jun/Sep/Oct picks, ‹ › paging twice, "Back to latest balances", Edit ↗ target, keyboard focus), the four KPI tiles (measured in three states), "By group over time" (By group / By owner / Share %, legend toggle, hover tooltip mid-chart and at the provisional last point, ctrl+wheel zoom, drag pan, Reset zoom, plain wheel, Married marker, end label), "What moved" (Groups ⇄ Accounts, tooltip, height change), Expand dialog (open motion, focus, Esc, scroll restore), Table twin, Export menu, Accounts tab (drill-down chips up to the 8 cap, row hover/click, capped table box scrolled to its end, component rows, totals row), the KPI ⓘ metric inspector.
- **Spending**: Overview, Trends, Budgets, History (films of every tab swap), ribbon picks (Jun, Sep in progress, Oct), bar click pin + detail dock, "All months", "Clear selection", "Back to last complete month", dock ×, legend toggle, hover tooltips, the $25.9K off-scale marker, "What changed" table, "Where … went" sankey (Month ⇄ Year film), Budgets (meters, Edit budget editor, suggestion chips, fenced Save, "No budget yet" disclosure), Trends (Compare picks 1→3 and a refused 4th, All categories small multiples, Savings rate off-scale marker), History (Absolute/Row/vs average, Show/Hide dormant, cell hover + click pin, Yearly rollups), the bars' Table twin, the KPI ⓘ inspector.

## Findings (most impactful first)

### NWSP-01 · Picking a month makes the Net worth scope row wrap: the ribbon jumps out from under the pointer and the page lurches twice
- Where: Net worth › scope row › month ribbon (`/net-worth?owner=all&range=all` → click "Jun") · 1440 and 1280 (fits at 1920)
- What happens: the "Back to latest balances" chip (144 px) mounts inside the ribbon's group, the row no longer fits, and the whole ribbon wraps onto a second line. Measured: sticky block 112 → 154 px, ribbon moves from (726,131) to (242,174), so "Jun" leaps from x≈1042 to x≈557 — the next click lands on empty space. The body drops 42 px, then the KPI row shrinks 145 → 111 px and pulls it back up 34 px. "Back to latest" reverses all of it. At 1280 the row is already on three lines (154 px ≈ 19% of an 800 px screen, permanently sticky).
- Evidence: shots/networth-spending/n05-dark-click-jun/01-144ms.jpg → 02-205ms.jpg, shots/networth-spending/n05-dark-earlier.png, shots/networth-spending/l01-nw-jun.png (light), shots/networth-spending/x01-dark-1920-nw-jun.png (1920: no wrap)
- Cause: ScopeBar.tsx:318-335 mounts the back chip inside `.scope-bar-group` only while a month is picked; `.scope-bar { flex-wrap: wrap }` (shell.css:474-484) then wraps the whole group.
- Polish: keep the slot permanently reserved (render the chip always, `visibility:hidden` + fade in), or make "back" a compact ↺ icon button beside "Edit ↗" so the group's width never changes. Give the ribbon `flex-shrink` room before anything wraps.
- Impact: the page's main navigation stops moving under the cursor; month-by-month browsing becomes click, click, click instead of click, hunt, click.
- Size: S · Confidence: high

### NWSP-02 · Un-pinning a Spending month leaves an empty, stale detail dock open (and there are four different "un-pin" controls)
- Where: Spending › Overview › top chart pin (ribbon "Jun" or a bar click) → "All months" (card header) or "Back to last complete month" (scope row) · both themes
- What happens: after either control, the pin is gone and the page reads Aug 2026 again, but the 400 px right dock stays open titled "Jun 2026 · Monthly entries vs take-home — top 6 ca…" with an empty body, and the page stays squeezed to 815 px wide (was 1215). "Clear selection" in the pin strip, by contrast, closes the dock and restores 1215 px. Four controls (All months, Clear selection, Back to last complete month, dock ×) undo the same pin, in four places, with two outcomes; "All months" is also a full-size button (36 px) among 26 px utility buttons.
- Evidence: shots/networth-spending/s03-dark-after-backchip.png, shots/networth-spending/s02-dark-bar-hover.png (after "All months"), shots/networth-spending/l01-sp-empty-dock.png (light), shots/networth-spending/s03-dark-bar-pinned.png (the four controls)
- Cause: ChartCard.tsx:171-174 opens the panel whenever `selected` is set, but only `clearSelection` (ChartCard.tsx:158-161) or unmount (:187) close it; SpendingPage.tsx:609-613 ("All months") and the scope-row chip only clear the URL month, so the controlled `selection` goes null while the panel stays open.
- Polish: in ChartCard, when a controlled `selection` turns null, `closePanel(panelId)`. Then trim the verbs: keep "Clear selection" in the pin strip and the scope-row chip; drop the header "All months" button (or make it the same small utility size).
- Impact: removes a visibly broken state from the page's central interaction and gives un-pinning one predictable result.
- Size: S · Confidence: high

### NWSP-03 · Switching Quarterly → Monthly "shreds" the stacked chart for ~300 ms
- Where: Net worth › Monthly/Quarterly toggle (`/net-worth?owner=all&range=all`) · both themes
- What happens: going back from Quarterly (13 points) to Monthly (37 points), ECharts morphs the stacked areas point-by-index: for ~300 ms the chart is a pile of horizontal white/black streaks and zig-zag bands before settling. Monthly → Quarterly snaps without the glitch. Range chips show a milder version: the x-axis snaps to the new window while the areas are still at the old geometry (e.g. areas covering only Jun–Oct under an Oct 2025–Oct 2026 axis at 144 ms).
- Evidence: shots/networth-spending/n01-dark-to-monthly/03-165ms.jpg, shots/networth-spending/n01-dark-to-monthly/06-238ms.jpg, shots/networth-spending/l01-q2m/03-219ms.jpg (light), shots/networth-spending/n03-dark-range-1Y/02-144ms.jpg
- Cause: EChart.tsx:398-442 repaints with `notMerge: true` and zeroes only the ENTRANCE duration (`animationDuration: 0` at :404/:439); the update animation still runs, and a line/area series whose data length changes interpolates by index.
- Polish: when the x-domain changes (length or first/last date differ — grain, owner or range rebuilds), paint with `animationDurationUpdate: 0` and cross-fade the canvas instead (opacity 0.35 → 1 over --t-fast), keeping the morph only for same-shape updates (legend, zoom).
- Impact: the grain toggle stops looking like a rendering fault; the chart feels solid.
- Size: S · Confidence: high

### NWSP-04 · KPI rows: uneven tile content leaves dead space, misaligns the figures, and changes the row height as you browse
- Where: Net worth › Overview KPI row; Spending › Overview KPI row · 1440 (also 1280; mostly fine at 1920)
- What happens: tiles are stretched to one height but carry different content. Spending: "Living spending" has a badge + value + two detail lines; "Previous 12 months" one line; "Savings rate — cash" and "Net pay" nothing — measured empty space under content 1 / 35 / 58 / 58 px, and the badge row pushes the Living-spending figure 17 px below its neighbours (value top +57 vs +40). Net worth: the hero's "Provisional" badge takes its own line (figure +57 vs +40) and its delta wraps with an orphan "days" ("…since Sep 1 · 21 / days"), leaving 43 px empty under the three group tiles. The row height then follows the data: 145 px (Sep 22 provisional) → 111 px (Jun) → 128 px (Sep 1, delta wraps again), and 145 → 111 on Monthly → Quarterly — every change shoves the charts below up or down.
- Evidence: shots/networth-spending/t01-sp-dark-1440.png, shots/networth-spending/t01-nw-dark-1440.png, shots/networth-spending/t01-sp-light-1440.png, shots/networth-spending/n05-dark-sep-selected.png; measurements in work-networth-spending/x05-tiles.mjs output
- Cause: StatTile.tsx:120-141 (badge sits in the label block and wraps under it when the tile is narrow; no shared row structure across tiles); SpendingPage.tsx:560-571 (two tiles with no delta); headline.ts:44-47 (long hero delta "… since Sep 1 · 21 days").
- Polish: (1) pin the badge to the tile's top-right corner (absolute) so it never adds a line; (2) make each tile a 3-row subgrid of the `.kpi-row` (label / value / delta) so figures sit on one baseline; (3) give the bare tiles a real second line from data already on the page — Net pay "▲ $859 vs Jul", Savings rate "12-mo avg 28%"; (4) shorten the hero delta ("+$126,583 (+15.7%) · 21 days") or reserve two delta lines so the row height is stable across months.
- Impact: the first thing on both pages reads as one aligned strip, and clicking through months stops bouncing the page.
- Size: M · Confidence: high

### NWSP-05 · Toggling a legend item leaves the whole chart washed out
- Where: Net worth › By group over time legend ("Equity"); Spending › top chart legend ("Housing") · both themes
- What happens: click a legend entry, move the pointer away (to the header, not across the plot): every remaining series stays at "blur" opacity — the stacked areas turn near-black, the Spending bars almost vanish, the net-pay/net-worth lines go grey. It stays that way (even across an Overview ⇄ Accounts round trip) until the pointer happens to cross the plot.
- Evidence: shots/networth-spending/x04-dark-nw-after-legend-off-away.png, shots/networth-spending/x04-light-sp-after-legend-off-away.png, shots/networth-spending/x03-dark-nw-legend-after-tabs.png, shots/networth-spending/x04-dark-nw-after-legend-off-chart-then-away.png (clears only after crossing the plot)
- Cause: series use `emphasis: { focus: 'series' }` (charts/legend.ts:9, charts/grammar.ts:180, :193); hovering a legend item highlights its series and blurs the rest, the click then hides that series, and the legend's mouse-out downplay never lifts the blur.
- Polish: in EChart.tsx's `legendselectchanged` handler (:193-200) also `chart.dispatchAction({ type: 'downplay' })` for all series (or pass `legend.selectedMode` + a one-frame downplay after the toggle).
- Impact: removes a "did I break it?" moment from the most basic chart interaction on both pages.
- Size: S · Confidence: high

### NWSP-06 · The "Table" view shows raw export data: ISO dates, unformatted numbers, enum codes, misaligned headers, no sticky header
- Where: every chart's Table button — Net worth stacked + drill-down, Spending top chart (and the rest) · both themes
- What happens: cells print the CSV verbatim — "2023-09-01", "24598.26", "-5267.73", "unreviewed_history", "Whole month". Headers are all left-aligned while numbers are right-aligned (the Month column is right-aligned too, because ISO dates start with a digit). In Spending's 17-column twin the dates wrap to two lines ("2023– / 10–01") and each row is 78 px tall (the Details column stacks an "Inspect" button and a link — repeated 38 times), so the 320 px box shows ~3 rows; its header scrolls away, leaving unlabeled columns of numbers.
- Evidence: shots/networth-spending/n07-dark-table-twin.png, shots/networth-spending/l01-drill-table-twin.png (light), shots/networth-spending/x02-dark-bars-twin-scrolled.png
- Cause: ChartTable.tsx:16 (`numeric` = `/^-?\d/`, matches dates) and :36 (`String(cell)` from the export table); the box is `.chart-table-scroll` (panels.css:1060-1064), not TableScroll, so its `thead` is not sticky.
- Polish: give ChartTable per-column formatters (money → formatCurrency, month → formatMonth, enum → label), right-align numeric headers with their columns, wrap it in TableScroll for the pinned header, and make Details one small icon button (or the row itself clickable).
- Impact: the accessible/table reading becomes something a person can actually scan — same numbers, same formats as the rest of the page.
- Size: M · Confidence: high

### NWSP-07 · Returning to the Net worth Overview tab replays the $0 → $933K count-up and double-fades the chart
- Where: Net worth › Overview ⇄ Accounts tabs · both themes
- What happens: every return to Overview re-mounts the KPI row with no fade (it pops in at full opacity) and re-runs the hero count-up from $0.00 (sampled: $266,427 → $933,250 over ~400 ms, on both round trips), while the chart card below is blank for ~130 ms because it runs its own `card-enter` (240 ms, 40 ms delay) on top of the panel's 180 ms fade.
- Evidence: shots/networth-spending/n01-dark-to-overview/01-127ms.jpg ("$0.00", chart blank), shots/networth-spending/n01-dark-to-overview/03-265ms.jpg ("$607,009.81"); animation list in work-networth-spending/n02-tabs-anim.mjs output
- Cause: NetWorthPage.tsx:718 renders the KPI row outside the panel only while `views.section === 'overview'` (unmount/remount), and `countUp` is gated only on `!fromCache` (:735-739); un-hiding the panel restarts the CSS `card-enter` on stagger-tagged cards (panels.css:1103-1118) in addition to LocalSections.tsx:239-250's WAAPI fade.
- Polish: keep the KPI row mounted (move it inside the Overview panel, or hide instead of unmount) and gate the count-up on the page's first paint (a ref); drop `card-enter` from cards inside a re-shown panel so the swap is the one 180 ms panel fade the code intends.
- Impact: tab switches feel instant and calm instead of re-performing the page's entrance every time.
- Size: S · Confidence: high

### NWSP-08 · Trends: side-by-side cards don't line up, and "All categories" leaves ~490 px of dead space
- Where: Spending › Trends (`/spending?section=trends`) · all widths
- What happens: Savings rate card ends at 630, Category trends at 698 (69 px ragged bottom); their plots start 14 px apart (canvas tops 288 vs 302) and have different heights (260 vs 220), so the two month axes don't align. Switching Category trends to "All categories" grows it to 910 px beside a 422 px Savings card (488 px of empty column). At 1920 the gap is 37 px, at 1280 85 px.
- Evidence: shots/networth-spending/t01-sp-trends-dark-1440-full.png, shots/networth-spending/s07-dark-all-categories-full.png, shots/networth-spending/l01-trends-3picks.png (light)
- Cause: ChartSurface.tsx:45 and :49 portal the card into a class-less host div inside `.chart-card-slot`; the slot is stretched by the grid but the card is not (chartInteractions.css:1 only sets `min-width`). SpendingPage.tsx:751 vs :793 (260 vs 220 px) and only one card has a header control row.
- Polish: `.chart-card-slot { display:flex; flex-direction:column } .chart-card-slot > div { flex:1; display:flex; flex-direction:column } .chart-card-slot .chart-card { flex:1 }` with the footer pushed down (`margin-top:auto`); give both charts the same height and reserve the controls row in both headers; in "All categories" mode span the card to 12 columns.
- Impact: the two Trends charts read as a matched pair with one shared time axis instead of a lopsided pair.
- Size: S · Confidence: high

### NWSP-09 · Category trends: the legend wraps into the plot, and three of its entries draw nothing
- Where: Spending › Trends › Category trends, Compare with 3 picks · both themes
- What happens: with Housing + Food & Dining + Shopping picked the legend lists six entries, wraps to a second row, and "Shopping budget" prints on top of the "$5.0K" axis label. The three "… budget" entries draw no visible line (budgets exist only from Sep 2026, a single point), so the legend promises lines that aren't there.
- Evidence: shots/networth-spending/s07-dark-trend-3picks.png, shots/networth-spending/l01-trends-3picks.png
- Cause: charts/legend.ts:11-18 uses a plain (wrapping) legend up to 8 entries at `top: 0` over a fixed grid top; spendingChartOptions.ts:497-501 adds a budget step when any month has a budget — the top chart already requires ≥ 2 budgeted months in view (spendingChartOptions.ts:166-171).
- Polish: apply the same "≥ 2 budgeted months in view" rule to the trend budget steps, and switch to `type: 'scroll'` whenever the legend can't fit one line (or grow `grid.top` by the legend's rows).
- Impact: a clean single legend row and no phantom series in the comparison users build themselves.
- Size: S · Confidence: high

### NWSP-10 · "All categories" small multiples overprint each other and chart five dead categories
- Where: Spending › Trends › Category trends › All categories · 1440 (half-width card)
- What happens: each mini chart's y-axis labels ("$3.0K $2.0K $1.0K $0") are drawn over the right end of the neighbouring panel's line; panel titles sit on the max label ("Housing" over "$6.0K"); Education, Financial, Investments, Kids and Loans draw flat $0 lines on meaningless "$1 / $0.50" axes; month labels float mid-grid under Investments/Kids because only the last three panels get them.
- Evidence: shots/networth-spending/s07-dark-all-categories-full.png
- Cause: spendingChartOptions.ts:577-585 places 3 grids at `left: col/3·100 + 2%`, `width: 29.3%` (a ~4% gutter can't hold a y-axis label); :590-594 titles at `top − 22`; :603 labels "the last three"; `order` includes dormant categories.
- Polish: drop dormant categories here as the heatmap does (with the same "Show N dormant" control), show only a max-value label inside each panel (no left axis), and span the card to 12 columns so panels get room.
- Impact: the "shape, not size" view becomes readable at a glance instead of a tangle of labels.
- Size: M · Confidence: high

### NWSP-11 · The charts never show which month you picked
- Where: Spending › top chart with a pinned month; Net worth › By group over time / drill-down with a ribbon month · both themes
- What happens: pin Jun 2026 on Spending — the Jun bar looks exactly like its 37 neighbours; the only cues are a strip under the chart and the dock. Pick Jun on Net worth — tiles, "What moved" and the table switch to Jun 1, but the big chart shows no marker for Jun.
- Evidence: shots/networth-spending/s03-dark-bar-pinned.png, shots/networth-spending/n05-dark-earlier.png
- Cause: spendingBarsOption / netWorthStackOption (spendingChartOptions.ts, netWorthChartOptions.ts) take no selected-month input.
- Polish: Spending — outline the pinned bar (INK border) and dim the rest to ~0.45; Net worth — a subtle vertical band or dashed markLine at the viewed month on both time charts (same style as the Married marker, lighter).
- Impact: the chart, the tiles and the ribbon visibly agree on "which month am I looking at".
- Size: M · Confidence: high

### NWSP-12 · The floating assistant button sits on top of right-edge content
- Where: bottom-right of the viewport on both pages · 1440 (also 1280)
- What happens: the 44 px launcher (x 1361–1405, y 821–865) covers the end of the Net worth zoom hint at first paint ("…drag to pa"), the "Edit budget" buttons of whichever budget row is at the bottom (Personal Care / Housing in the shots), the Accounts table box's vertical scrollbar, and the right corner of the "Pinned: …" strip.
- Evidence: shots/networth-spending/t01-nw-dark-1440.png, shots/networth-spending/n07-dark-zoomhint-assistant.png, shots/networth-spending/s05-dark-editor.png, shots/networth-spending/n08-dark-table-inview.png
- Cause: assistant.css:8-28 fixes it at `right/bottom: 1.25rem` while `.page` padding is 2rem (panels.css:8), so it intrudes ~24 px into the content column where cards put right-aligned controls.
- Polish: give the content a bottom-right safe area (page padding-bottom ≥ 64 px so nothing rests under it at scroll end), move the zoom hint to the left of the chart footer, and let the launcher shrink to a small tab while the page is scrolling.
- Impact: nothing clickable or readable is ever hidden behind the button.
- Size: S · Confidence: high

### NWSP-13 · Spending's month ribbon jumps 150 px sideways between tabs
- Where: Spending › Overview/Trends ⇄ Budgets/History · both themes
- What happens: the range chips (All/1Y/YTD) disappear on Budgets and History, so the ribbon slides from x=392 to x=242 and "Edit ↗" from 914 to 763 — the page's one persistent control moves every time you change view.
- Evidence: shots/networth-spending/s01-dark-to-Budgets/02-123ms.jpg, shots/networth-spending/t01-sp-dark-1440.png vs shots/networth-spending/t01-sp-budgets-dark-1440-full.png
- Cause: SpendingPage.tsx:499 `range={views.section === 'overview' || views.section === 'trends'}` unmounts the Segmented.
- Polish: keep the range control in place but disabled with a hint ("Budgets reads one month"), or right-align the ribbon so its position doesn't depend on what sits left of it.
- Impact: muscle memory for the ribbon holds across the four views.
- Size: S · Confidence: high

### NWSP-14 · Budgets: invisible meter tracks, ragged meter ends, and the same sub-line and button 13 times
- Where: Spending › Budgets (`/spending?section=budgets`) · both themes
- What happens: an empty meter's track is #1e222c on #171a21 (dark) and #f7f9fc on #fff (light) — twelve of the thirteen rows look like blank space. Track ends differ per row (Housing ends at x=1112, the others 1119) because each row sizes its own amount column. Every row says "since Sep 2026" and carries its own "Edit budget" button — 13 identical lines and 13 identical buttons.
- Evidence: shots/networth-spending/t01-sp-budgets-dark-1440-full.png, shots/networth-spending/t01-sp-budgets-light-1440-full.png
- Cause: budgets.css:54-59 (track `background: var(--surface-2)`); budgets.css:10-15 (each `.budget-row` is its own grid with `minmax(150px, auto)` for the amount); BudgetPanel.tsx:532 and :435-441.
- Polish: track in `--fill`/`--border` so an empty meter reads as a meter; one shared column template (fixed ~18ch amount column or subgrid) so every track ends on one line; print "since …" only where it differs from the card's month (or once in the summary line); show "Edit" on row hover/focus or as a small pencil icon.
- Impact: the budgets card reads as a clean progress list instead of 13 floating names with buttons.
- Size: S · Confidence: high

### NWSP-15 · Budget editor: opens with a jump, keeps focus on the toggle, and reports a failed save 360 px away
- Where: Spending › Budgets › "Edit budget" (Food & Dining) → Save (write was fenced by the audit stack; only the presentation is judged)
- What happens: the editor block appears instantly (rows below jump 166 px, no motion); focus stays on the "Edit budget" toggle instead of the amount field; the save error appears as a banner at the TOP of the card (y≈277) while the Save button is at y≈641, and the banner pushes every row — including the open editor — down 52 px under the pointer. "Monthly budget" and "Effective from" labels sit a few px off each other, and the month field shows "September 2026" in the monospace digits font.
- Evidence: shots/networth-spending/s05-dark-editor.png, shots/networth-spending/s05-dark-save-fenced.png
- Cause: BudgetPanel.tsx:470 renders the card-level `FeedBanner` for editor errors; the editor block (budgets.css:100) has no entrance; the toggle doesn't move focus.
- Polish: open with the house pop-in/height ease, focus the amount input on open, show save errors inline under the Save button (and keep the card banner for load errors only).
- Impact: editing a budget feels like a small, local, keyboard-friendly action.
- Size: S · Confidence: high

### NWSP-16 · Off-scale markers read as axis labels ("▲ $25.9K", "−1073% ↓")
- Where: Spending › top chart (first month's net pay); Trends › Savings rate (early months) · both themes
- What happens: the true value of a clipped point is printed in muted 11 px text directly under the top axis label ("$10.0K" / "▲ $25.9K") or just above the bottom one ("−1073% ↓" / "−100%"), and the series line runs straight through its arrow — it reads like a second axis tick, not "this point is off the chart".
- Evidence: shots/networth-spending/s04-dark-offscale-closeup.png, shots/networth-spending/s07-dark-savings-offscale.png, shots/networth-spending/t01-sp-light-1440.png
- Cause: charts/offScale.ts:105-124 — label `position: 'bottom'/'top'` of the edge triangle in `MUTED`; here the clipped point is category 0, hugging the y-axis.
- Polish: anchor the label to the right of the marker (`position: 'right'`) in the series' own colour on a small surface-coloured pill ("Net pay $25.9K ↑"), nudged clear of the axis gutter.
- Impact: the outlier is understood instantly instead of being mistaken for the scale.
- Size: S · Confidence: high

### NWSP-17 · Near-zero bases produce "+636584.7%" and a chart that is 95% flat line (Joint / Grace scope)
- Where: Net worth › Whose = Joint (or Grace) · both themes
- What happens: the hero reads "▲ $258,580.72 (+636584.7%) since Sep 1 · 21 days" (the base was −$40.62; no digit grouping either), the lede and totals row repeat it, and with range All the chart spends three years drawing a flat $0 line before one vertical jump at the right edge.
- Evidence: shots/networth-spending/n03-dark-whose-Joint-settled.png
- Cause: headline.ts:44-47 prints the server's `mom_pct` through formatPct (utils/format.ts:28-37: `toFixed`, no grouping, no cap).
- Polish: when |previous| is tiny relative to the change (or the sign flips) show the amount only ("new this month") and cap display at ">999%"; group digits. For a scope whose history starts late, start the x-axis at its first non-zero month (with a "Joint accounts start Sep 2026" note).
- Impact: scope views say something sensible instead of a nonsense number and an empty chart.
- Size: S · Confidence: high

### NWSP-18 · Accounts table: picked rows are practically invisible and carry no colour key
- Where: Net worth › Accounts › table (rows toggled into the drill-down) · worst in light
- What happens: a picked row gets `--surface-2` — #1e222c on #171a21 in dark, #f7f9fc on #fff in light — the same tint as hover, so after the pointer leaves you can't tell which rows are in the chart, and nothing ties a row to its line colour (the chips have a swatch; the rows don't). The totals row's "+15.7%" is plain text ink while every other change cell is green/red.
- Evidence: shots/networth-spending/n08-dark-table-selected-rows.png, shots/networth-spending/l01-accounts-selected.png
- Cause: NetWorthPage.tsx:946 (inline `background: var(--surface-2)`); :986 (totals pct unstyled).
- Polish: put the slot swatch dot before the account name (as the chips do) and give picked rows a 2px accent left edge or `--fill` background; tone the totals change like the rows.
- Impact: the table and the chart above visibly belong together.
- Size: S · Confidence: high

### NWSP-19 · "What moved › Accounts" truncates names with half the card empty
- Where: Net worth › Overview › What moved › Accounts · 1440 and wider
- What happens: labels are cut at 118 px — "Robinhood Joint Bro…", "Capital One 360 Che…", "Fidelity Traditional 4…" — while the plot is ~1100 px wide and most bars use a fraction of it. The card also grows 394 → 506 px on the toggle with no transition.
- Evidence: shots/networth-spending/n07-dark-moved-accounts.png
- Cause: netWorthChartOptions.ts:520 `axisLabel: { width: 118, overflow: 'truncate' }`.
- Polish: size the label column from the longest name (cap ~220 px) or when the card is wide; ease the height change.
- Impact: you can read which account moved without hovering each bar.
- Size: S · Confidence: high

### NWSP-20 · Table footnotes and headers: flush notes, monospace headers, taller badge rows
- Where: Spending › What changed; Net worth › Accounts table; Spending › Yearly rollups · both themes
- What happens: (a) the "What changed" footnote sits 0 px under the table's last row (29 px of padding below it) — the Net worth table's note gets an inline 8 px; (b) numeric headers ("BALANCE", "CHANGE SINCE SEP 1", "AUG 2026", "VS JUL 2026", years) render in the monospace digits font beside proportional "ACCOUNT"/"CATEGORY"; (c) rows holding a badge (COMPONENT, TRANSFER, TAX) are 36 px vs 33 px, so the row rhythm stutters.
- Evidence: shots/networth-spending/s04-dark-sankey-month.png, shots/networth-spending/n08-dark-table-inview.png, shots/networth-spending/s06-dark-yearly.png
- Cause: (a) SpendingPage.tsx:664 + `.drill-hint { margin: 0 0 .5rem }` (panels.css:422-426) vs NetWorthPage.tsx:992 inline `marginTop`; (b) panels.css:244-248 `.data-table .num` also matches `th.num`; (c) `.badge` padding (panels.css:295-305) inside a 13.6px cell.
- Polish: one shared rule `.data-table + .drill-hint { margin-top: .6rem }`; `.data-table th.num { font-family: inherit }`; badge `line-height: 1; padding-block: 0; vertical-align: middle`.
- Impact: tables look typeset rather than assembled.
- Size: S · Confidence: high

### NWSP-21 · Yearly rollups: totals blend into the categories, the year header scrolls away, $0.00 everywhere
- Where: Spending › History › Yearly rollups · both themes
- What happens: the eight summary rows (Living spend, Tax paid, Transfers, Total, Net pay, two savings rates, Months matched) follow "Travel" with no divider and the same weight (only Total is bold), so they read as more categories; the 27-row table has no pinned header, so mid-table you lose which column is which year; 26 of 76 category cells are "$0.00" — the five dormant categories the heatmap hides are listed here in full.
- Evidence: shots/networth-spending/s06-dark-yearly.png, shots/networth-spending/t01-sp-history-dark-1440-full.png
- Cause: SpendingPage.tsx:911-1021 (plain `.yearly-scroll`, overflow-x only; tfoot unstyled — computed weight 400, no top border).
- Polish: a divider + faint background on the tfoot block (or a "Totals" sub-heading), wrap in TableScroll for the pinned year row, reuse the heatmap's dormant toggle here and show $0.00 as a muted "—".
- Impact: the year-over-year comparison is scannable in one pass.
- Size: S · Confidence: high

### NWSP-22 · Spending ribbon: some picks change nothing, and an in-progress month's tiles are bare dashes
- Where: Spending › ribbon "Oct" and "Sep" · both themes
- What happens: "Oct" (October hasn't begun) is selectable: the chip highlights, "Back to last complete month" appears and Edit retargets to Oct — but the tiles, "What changed" and the sankey still read Aug 2026. Picking "Sep" (in progress) shows "Savings rate — cash —" and "Net pay —" with no word of why.
- Evidence: shots/networth-spending/s08-dark-oct-picked.png, shots/networth-spending/s08-dark-sep-picked.png
- Cause: SpendingPage.tsx:315-319 — a picked month not in `matrix.months` gives `detailIndex = -1` and the page silently falls back to its resting month.
- Polish: on Spending render months with no spending row as non-selectable (muted, title "October hasn't begun"), or show an explicit "Nothing entered for Oct 2026 yet" state; give the dash tiles a sub-line ("take-home not entered yet").
- Impact: every ribbon click visibly does what it says.
- Size: S · Confidence: high

### NWSP-23 · "Where … went" sankey: no amounts on the nodes, all-grey flows, and a jumpy Month ⇄ Year swap
- Where: Spending › Overview › Where Aug 2026 went · both themes
- What happens: node labels are names only ("Housing", "Saved") — every amount needs a hover; the flows are one flat grey, so only the thin node bars carry the category colours; Month ⇄ Year snaps instantly (final state by 94 ms) and the card grows 462 → 506 px because Year adds a lede and a footnote.
- Evidence: shots/networth-spending/s04-dark-sankey-month.png, shots/networth-spending/s04-dark-sankey-year.png, shots/networth-spending/s04-dark-sankey-to-year/04-94ms.jpg
- Cause: charts/sankey.ts:93-94 (links wear the SOURCE colour at 0.3 — the source is the grey Net pay node, so every link is grey) and :97-99 (label = entity name only, a deliberate choice worth revisiting); SpendingPage.tsx:678 lede and :705-706 footnotes exist only in Year mode.
- Polish: label nodes "Housing · $2,164 · 44%", colour links by `'target'` (same 0.3 opacity), reserve the lede row in both modes and cross-fade the swap.
- Impact: the flow answers "where did it go" at a glance — the one question the card exists for.
- Size: M · Confidence: high

### NWSP-24 · Same ⓘ, two behaviours; the metric inspector speaks in ISO dates
- Where: KPI tiles on both pages (ⓘ) vs every card title (ⓘ); the inspector dock
- What happens: on card titles ⓘ shows a hover bubble; on KPI tiles the identical glyph does nothing on hover and, on click, opens a 400 px dock that narrows the page (the tile's own one-line `hint` is never shown). Inside the dock: "Period 2026-08-01 to 2026-08-01", "As of 2026-09-24", "Included months 2026-08".
- Evidence: shots/networth-spending/x02-dark-kpi-inspector.png
- Cause: StatTile.tsx:127-128 renders InfoHint only when there is no `evidence` (every tile here has it); MetricInspector.tsx:36-38 and :53 print raw ISO strings.
- Polish: give MetricInfoButton the InfoHint hover bubble (the tile's `hint`) with "More detail" opening the dock; format periods with formatMonth/formatAsOf and collapse a one-month period to "Aug 2026".
- Impact: one learnable meaning for ⓘ, and the inspector reads in the page's own language.
- Size: S · Confidence: high

### NWSP-25 · Pinning a Spending month rescrolls the page so the new tiles sit under the sticky row
- Where: Spending › Overview › ribbon or bar pin · 1440
- What happens: the dock narrows the page to 815 px, the KPI row reflows to 2×2 (+63–80 px), and the page scrolls ~100 px to hold the chart in place — so the tiles that just changed to the picked month have their top edge under the sticky scope row (the label "LIVING SPENDING — JUN 2026" grazes the header).
- Evidence: shots/networth-spending/s02-dark-ribbon-jun.png, shots/networth-spending/s08-dark-sep-picked.png
- Cause: ChartCard.tsx:145-151 (`anchorIfInView` holds the chart card whenever an input happened after it settled — a ribbon pick included) + panels.css:116-117 (2-column KPI row under 980 px of page width).
- Polish: don't hold the chart for picks made in the sticky scope row (the eye is at the top), or keep four tiles in one row down to ~780 px so the reflow doesn't happen.
- Impact: the numbers you asked for land fully in view.
- Size: S · Confidence: medium

### NWSP-26 · Small consistency nits on Net worth: title vs stack mode, three names for one snapshot, an anonymous "Edit ↗"
- Where: Net worth › By group over time; ribbon; tooltip
- What happens: (a) the card stays titled "By group over time" while showing By owner or Share %; (b) the Sep 22 provisional snapshot is "as of Sep 22 · Provisional" (hero), "Oct" (ribbon chip, 1Y x-axis "Oct 2026"), and "Oct 2026 — Oct 1 balances recorded early, on Sep 22 — provisional" (tooltip), while today's ring sits on "Sep"; (c) "Edit ↗" doesn't say which month it opens (it opens Oct 2026 here; Aug on Spending).
- Evidence: shots/networth-spending/n06-dark-stack-Byowner-settled.png, shots/networth-spending/n09-dark-tooltip-last.png, shots/networth-spending/t01-nw-dark-1440.png (1Y axis ends "Oct 2026" under a hero reading "as of Sep 22")
- Cause: NetWorthPage.tsx:775 fixed title; MonthRibbon.tsx:173-181 link text; month-key labelling in the chart builders.
- Polish: title "Net worth over time" (or follow the toggle); lead every label for a provisional point with the hero's words ("Sep 22 · provisional (Oct 1 snapshot)"); label the link "Edit Oct ↗".
- Impact: fewer "wait, which month is this?" moments.
- Size: S · Confidence: medium

### NWSP-27 · Category chips silently refuse a 4th pick (Net worth's chips go quiet at their cap)
- Where: Spending › Trends › Category trends chips
- What happens: with three picked, clicking "Travel" does nothing — no disabled look, no message. Net worth's account chips dim the rest at their 8-account cap, the pattern this page should share.
- Evidence: work-networth-spending/s07-trends.mjs output (4th click ignored, 0 disabled chips); compare shots/networth-spending/n08-dark-eight-accounts.png
- Cause: SpendingPage.tsx:430-437 (`toggleTrend` returns early at MAX_TREND) and :819-839 (no `disabled`).
- Polish: disable unpicked chips at 3 exactly as NetWorthPage.tsx:909 does, with the "Pick up to 3" hint beside them.
- Impact: the limit explains itself instead of feeling like a dead click.
- Size: S · Confidence: high

### NWSP-28 · Accounts tab: the table starts below the fold behind a 30-chip picker
- Where: Net worth › Accounts · 1440×900
- What happens: the tab's main content (the accounts table) begins at y≈822 of 900; above it sit the drill chart and four rows of 30 chips (~130 px) that duplicate what clicking table rows already does.
- Evidence: shots/networth-spending/t01-nw-accounts-dark-1440-full.png
- Cause: NetWorthPage.tsx:876-915 always renders the full chip list.
- Polish: show only the picked accounts as chips plus an "Add account…" searchable popover; the table rises ~100 px into the first screen.
- Impact: the Accounts tab opens on its accounts.
- Size: M · Confidence: medium

### NWSP-29 · Header controls use two button sizes
- Where: Spending › History heatmap header ("Show 5 dormant"); Spending › pinned top chart ("All months")
- What happens: these are full-size `.button`s (36 px tall, 0.85rem) sitting beside 26 px segmented controls and 26 px Expand/Table/Export — the heaviest thing in the header is a secondary toggle.
- Evidence: shots/networth-spending/t01-sp-history-dark-1440-full.png, shots/networth-spending/s03-dark-bar-pinned.png; measured in work-networth-spending/s06-history.mjs output
- Cause: SpendingPage.tsx:880-889 and :609-613 use `className="button"` in ChartCard `actions`, unlike `.chart-card-utility .button` (chartInteractions.css:13).
- Polish: give card-header actions the utility size (`padding: .25rem .55rem; font-size: .75rem`), or render "Show dormant" as a toggle inside the Segmented row.
- Impact: consistent header rhythm across cards.
- Size: S · Confidence: high

### NWSP-30 · Width spot-checks: wasted ribbon space at 1920, three sticky rows at 1280, ribbon re-labels on load
- Where: both pages' scope row
- What happens: at 1920 the ribbon still shows 12 months in 552 of 1631 px (≈600 px empty to its right); at 1280 Net worth's sticky block is tabs + Whose/range + ribbon on three rows (154 px of an 800 px screen); on a cold load the ribbon first renders Oct 2025–Sep 2026 with hollow chips, then re-anchors to Nov 2025–Oct 2026 when coverage lands, so every chip's label changes under the reader. The per-month figures ("$715,562.61") exist only in native `title` tooltips.
- Evidence: shots/networth-spending/x01-dark-1920-nw-jun.png, shots/networth-spending/x01-dark-1280-nw.png, shots/networth-spending/n09-dark-firstload/03-630ms.jpg vs 05-834ms.jpg
- Cause: MonthRibbon.tsx:32 fixed `RIBBON_PAGE = 12`; ScopeBar.tsx:261-263 anchor depends on coverage; MonthRibbon.tsx:151 `title`.
- Polish: size the window to the available width (12–24 months); at ≤1300 px put the ribbon on the tab strip's row; remember the last anchor per tab (as household size already is) so the first paint is right; show the month's figure in a styled hover card.
- Impact: the ribbon uses the room it has and stops shifting on arrival.
- Size: M · Confidence: medium

## Strengths to keep (≤6)
- Chart tooltips are excellent: aligned figures with swatches, an Assets / Liabilities / Net worth summary, % shares on Spending, "47% of the change" on What moved.
- First-paint motion is lovely and restrained: the net-worth wipe with the end label riding the reveal, the count-up, and cached revisits painting still (the drill-down line does not redraw on a second visit).
- Expand dialog: smooth rise, focus goes to "Close expanded chart", Esc returns focus to Expand and restores scroll.
- Zoom: ctrl+wheel and drag-pan work, "Reset zoom" appears in the existing utility row without shifting anything, and a plain wheel still scrolls the page.
- The Accounts table's capped box with pinned header and pinned Net worth total, and the drill chips' colour swatches + 8-cap dimming.
- Honest partial-month grammar: hatched in-progress bar/heatmap column with "* Month in progress", two-tone hatched ribbon dots, visible keyboard focus ring on chips.

## Not reproduced / environment artifacts
- A Grace-scope switch once sat dimmed for >2 s (n03); re-measured at 47–57 ms per request (n04) — shared-backend latency, dropped.
- The very first page of one fresh browser context stayed on range=1Y while later pages used the account's "All" (t01 dark); a second cold load landed on All directly (n09). Only affects a brand-new browser and not reproducible — dropped.
- A quarterly end label looking detached from the series end was a mid-morph frame; at rest it is aligned (n10) — dropped (the morph itself is NWSP-03).
- Budget Save returned 503 "audit fence" — fenced write; only where the error is shown was judged (NWSP-15).
- The Accounts table has no sorting or row expansion (rows toggle the drill-down); nothing to judge there.
- Sankey node-hover adjacency could not be captured headlessly (pointer positions missed the thin nodes); not judged.
- Native `title` tooltips on ribbon chips are not captured in headless screenshots; judged from the attributes only.
- The "DEV 1694013d" sidebar badge and scheduler-dependent wording were ignored per the brief.
