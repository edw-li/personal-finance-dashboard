# Overview & Monthly update — polish findings

Pages/areas covered:
- **Overview (/)**: cold arrival (live, plus record-and-replay at realistic 100–200 ms timings, both themes), revisit from Net worth via the sidebar, Back from each "Open … →" destination. KPI row (all four tiles, badges, deltas, the (i) metric buttons and the docked metric panel), Net worth trend (hover tooltip, click, Expand dialog, Table twin, Export menu), Changes worth understanding (movers links, hover), Up next (rows, hover, amounts, loading state, dock-narrowed layout), Needs attention (item, hover, empty/loading sentence), Data status, Year to date, Portfolio performance (hover, legend), Recent spending (hover, bars, legend, footnote, Table twin), Money flow (every year chip 2023–2026, cached and uncached, filmed), WHOSE scope All/Edward/Grace/Joint (filmed and frame-sampled, cached and uncached), Customize popover (open, hide a tile, hide a card, keyboard reorder, Reset, Done), Refresh (filmed and opacity-sampled), card-title (i) hints.
- **Monthly update (/update)**: landing redirect and arrival (live and replayed), Balances / Spending / Review steps and moving between them (stepper and Next button, filmed), month ribbon (chips and their status names, the earlier-months arrow, Sep→Aug and Sep→Jul switches filmed and sampled, markers at 3× zoom), What's due line, Notes field, balance inputs (focus/select-all, typing, formatted echo, "=" arithmetic, invalid entry, Escape revert, liability sign cue), Δ column, subtotals, sticky live net-worth bar, Enter/↓ walk through all 26 cells, synthetic column paste, "…" (kebab) popover, Save (fenced 503 — presentation only), leaving with unsaved edits.
- Widths/themes: 1440×900 in dark and light as the baseline, plus 1280×800 and 1920×1080 for layout; every finding below was reproduced twice (second theme and/or second width, or a repeat run).

## Findings (most impactful first)

### OU-01 · The Overview settles in two jumps on every cold load (short ghost tiles, one-line "Up next" placeholder)
- Where: Overview › KPI row, and the right column (Up next → Needs attention → Data status) (`/`) · both themes · all widths
- What happens: Even when every response arrives within 100–200 ms (replayed real responses, no local stall), the page shifts twice. First, the four KPI ghosts are **76 px** tall but the real tiles are **145 px**, so when the first tile lands everything below drops **69 px**. About 150 ms later, Up next swaps its one-line "Loading upcoming events..." (115 px) for its five-row list (314 px), and **Needs attention and Data status jump down 198 px**. Measured **CLS 0.085** (0.061 + 0.024), identical in dark (staggered timings) and light (even timings). The Changes card also grows 91→167→267 px, and the lower cards travel 238 px in total. Structurally, the hero tile waits for `/net-worth/timeseries`, which only the trend chart needs. On this box that made the hero a lone skeleton for 2.2 s (a local stall; see artifacts), and in production whichever of the two calls is slower gates the headline number.
- Evidence: shots/overview-update/replay-stagger-dark/03-724ms.jpg (ghost row, right column empty), shots/overview-update/replay-stagger-dark/05-886ms.jpg (Up next still a one-liner), shots/overview-update/replay-stagger-dark/07-1029ms.jpg (right column after the 198 px jump)
- Cause: OverviewPage.tsx:487/516/538/550 ghost every tile with `<GhostTile delta={false} />`, the short delta-less twin, although all four real tiles have a delta line and two have a badge row. Its `min-height: var(--m-stat-tile-bare)` (panels.css:724–726) never resolves either: the variable is only defined on `.page-skeleton, .loading-fallback` (panels.css:708–715), and the Overview's live `.kpi-row` is not inside those, so the ghost collapses to its content (76 px). Up next's loading state is a single sentence (OverviewPage.tsx:850). The hero is gated on `Promise.all([fetchSummary, fetchTimeseries])` (OverviewPage.tsx:185–188).
- Polish: Reserve the final geometry. Ghost the tiles with their delta line and a row height that matches the loaded row (or give the Overview's `.kpi-row` a min-height equal to the real tile). Give Up next a five-row skeleton list at its real height. Paint the hero from `/net-worth/summary` alone, letting the timeseries gate only the trend chart.
- Impact: The home page stops rearranging itself under the reader's eye. What appears first stays where it appeared, and the headline number is never the last thing to show.
- Size: M · Confidence: high

### OU-02 · Money flow year chips: an unseen year collapses the card and pulls the chips out from under the pointer
- Where: Overview › Money flow › year chips (`/`) · both themes · 1440×900 (same at 1280/1920)
- What happens: Clicking a year that hasn't been seen yet blanks the card at once. The title loses its year ("Money flow"), the chip row vanishes (0 chips in the DOM) under the cursor, and the "Spending and saved: …" lede, Expand/Table/Export and the footnotes disappear. The diagram becomes a grey skeleton and the card drops to **481 px**. That covers 2024, 2023, and **2026 itself**, because the first load is cached under "auto". This is the last card on the page, so the reader is usually scrolled to the bottom: the browser clamps the scroll and everything above lurches **37–48 px down and back** when the data lands. Then the sankey replays its full left-to-right entrance wipe. Cached years switch instantly, but the card height still changes with the year (2024/2025: **518 px**, 2023: **544 px**, 2026: **566 px**) because the number of footnote lines differs.
- Evidence: shots/overview-update/deeper-dark-1440/flow-to-2024-467/00--83ms.jpg (before), shots/overview-update/deeper-dark-1440/flow-to-2024-467/02-191ms.jpg (collapsed: no year, no chips, skeleton), shots/overview-update/deeper-dark-1440/flow-to-2024-467/03-316ms.jpg (entrance wipe replaying)
- Cause: OverviewPage.tsx:261–266 `showFlowYear` calls `setFlow(peeked ?? null)`, so a cache miss hands the card `null`. The title (MoneyFlowCard.tsx:65), lede (:78), chips (:79–90, rendered only when `flow !== null`) and footer (:103–110) all hang on `flow`. `flowKey(null)` is "auto" (OverviewPage.tsx:146–148, :234), so the 2026 chip misses the cache. ChartCard draws a skeleton whenever `option === null` (ChartCard.tsx:212–217); its dim-and-hold path (:222–224) is never reached.
- Polish: Keep the previous year's diagram, title, chips and footer in place under the existing `busy` dim, and swap only when the new payload arrives. Mark the clicked chip as selected immediately. Also store the auto year's payload under its real year. Reserve the footnote rows so every year has the same card height. Morph year to year as a data update instead of a fresh entrance.
- Impact: Comparing years becomes a calm, in-place flip. The control you just clicked stays put and the page stops jumping, which is what year chips are for.
- Size: M · Confidence: high

### OU-03 · KPI tiles don't share a baseline: badges wrap under two labels and deltas break mid-phrase
- Where: Overview › KPI row (`/`) · both themes · 1440×900 and 1280×800 (fine at 1920 or with three tiles)
- What happens: At 1440 the "Provisional" and "Not yet reviewed" badges wrap onto their own line, indented 8 px from the label they belong to. That pushes those two values **57 px** below the tile top, versus **38–40 px** in Portfolio and Estimated tax, so the four headline numbers sit on two baselines 17–19 px apart. The deltas wrap awkwardly: "▲ $126,583.02 (+15.7%) since Sep 1 · 21 / **days**" at 1440, "since **Sep / 1** · 21 days" at 1280 (the date is split), and "under $5,417.48 previous 12-mo / average · Aug 2026". Portfolio and Estimated tax are left with about **43 px** of empty tile under a one-line delta. With a tile hidden (three wider tiles) or at 1920, the badges sit inline and every value lines up, which confirms the wrap is the cause.
- Evidence: shots/overview-update/ytd-dark-1440/kpi.png, shots/overview-update/ytd-dark-1280/kpi.png, shots/overview-update/int1-dark-1440/tax-hidden-page.png (three tiles: aligned)
- Cause: `.stat-badge` is an inline pill placed after the nowrap label unit (StatTile.tsx:125–131). When it doesn't fit, it wraps and keeps its `margin-left: .5rem` (panels.css:151–165). The delta line wraps freely at 0.8rem (panels.css:209–212). The month rides at the end of the Living spending delta (OverviewPage.tsx:450–460).
- Polish: Give the badge a fixed slot that never shifts the value, such as the tile's top-right corner or a reserved line in every tile. Keep the value row at the same offset in all four tiles, and bottom-align the delta. Keep deltas to one line with shorter wording (e.g. "▲ $126.6K · +15.7% since Sep 1", "▼ $484 under 12-mo avg"), and keep "Sep 1" non-breaking.
- Impact: The four most important numbers on the dashboard read as one aligned row that the eye can scan straight across.
- Size: S–M · Confidence: high

### OU-04 · Side-by-side columns end raggedly: a stretched "Changes" card, a stretched Data status, and a short Recent spending card
- Where: Overview › primary two-column band (Net worth trend + Changes | Up next + Needs attention + Data status) and the Portfolio performance | Recent spending pair (`/`) · both themes · all widths
- What happens: (1) Lead 2 confirmed. "Changes worth understanding" is stretched to the right column's height and shows **109 px** of blank card under its last line at 1440 (≈143 px at 1280, ≈75 px at 1920), on top of normal padding. (2) Opening the Net worth trend's **Table** grows that card 347→723 px, so the stretch moves to **Data status: 457 px tall with 277 px empty** below its four rows. (3) In the deeper grid, **Recent spending ends 63 px above Portfolio performance** (367 vs 430 px). With its Table open it is 313 px taller, so the ragged edge flips side.
- Evidence: shots/overview-update/arrive-dark-1440/final-full.png (empty band under Changes; ragged pair), shots/overview-update/table-stretch-light/trend-table-status.png (stretched Data status), shots/overview-update/deeper-light-1440/perf-spend.png
- Cause: OverviewPage.css:184–187 stretch both columns (`align-items: stretch`) and give each column's last row `1fr`, so the slack always lands inside one card as empty space. In the deeper grid, ChartSurface wraps each card in a `.chart-card-slot` grid item plus a portal host (ChartSurface.tsx:45–49). The slot stretches but the card inside does not (chartInteractions.css:1 sets only `min-width`).
- Polish: Let the stretched card fill its height purposefully: pin its footnote/link to the bottom (flex column, `margin-top: auto`), or give Changes a fourth mover or a small spark bar per mover so it earns the space. Size Data status to its content and let the column end early, or move the slack into Needs attention's scroll area. Make `.chart-card-slot > div > .card` fill the slot height (flex column), so paired chart cards always end together with the footer link pinned at the bottom.
- Impact: The page's two main columns and paired cards end on shared lines, with no dead grey rectangles, so the layout looks deliberate at every width and in every open/closed state.
- Size: S–M · Confidence: high

### OU-05 · The floating assistant button covers right-aligned figures (Data status, the wizard's Δ column)
- Where: Overview › Data status; Monthly update › Balances Δ column and live-total row (`/`, `/update?month=2026-09-01&step=balances`) · both themes · all widths
- What happens: Lead 3 confirmed. The 44 px button sits 35 px from the right and bottom edges, which puts it **11 px inside the right column's content edge at every width** (1280/1440/1920). On the Overview's first view at 1440×900 it sits exactly over the Data status values, hiding the "1" of "provisional, for Oct 1" and the tail of "Sep in progress". With three tiles, "Aug 2026" reads "Aug 202". In the wizard, the Δ column scrolls under it (the Δ cell of 5 of 26 focused rows during an Enter walk), and it also sits against the end of the sticky live-total bar. The wizard footer already reserves 3.5rem for it (MonthlyUpdatePage.css:160), but nothing else does.
- Evidence: shots/overview-update/int1-dark-1440/tax-hidden-page.png ("Sep in progres", "Aug 202"), shots/overview-update/arrive-dark-1440/t3500.png, shots/overview-update/verify-light-1280/enter-under-bar.png (Δ "$215.05" under the button)
- Cause: assistant.css:8–27 (`position: fixed; right/bottom: 1.25rem`, 44×44) with no matching gutter in the page layout.
- Polish: Reserve a right safe-gutter for the button in the content column (≈56 px of padding-right on the page body, or `scroll-padding`/margin on right-aligned numeric columns). Alternatively dock the button into the sidebar footer, or fade it to a small tab while the page is scrolling.
- Impact: Every figure is readable wherever the reader scrolls. The most-used entry form never has a number hidden behind a button.
- Size: S · Confidence: high

### OU-06 · Switching WHOSE to a person not yet viewed flashes wrong states: $0.00 hero, "Prices never refreshed", a shrinking row
- Where: Overview › WHOSE scope (All/Edward/Grace/Joint) (`/?owner=2`, `/?owner=joint`) · both themes · 1440×900 and 1280×800
- What happens: On the first visit to a person's scope, the Net worth and Portfolio tiles turn into ghosts, which shrinks the KPI row 145→137 px and nudges the page up 8 px and back. Data status says **"Prices: never refreshed"** until holdings answer (0.1–1.4 s in these runs). The Net worth trend empties and redraws from nothing. Then the hero **counts up from $0.00** while its delta already reads "▲ $258,580.72 (**+636584.7%**)", a $0 net worth beside a +$258K change for several frames. The percentage is absurd because Grace's Sep 1 base was about $40. Switching back to an already-seen scope is clean: no ghosts and no count-up, just a 120 ms dim.
- Evidence: shots/overview-update/scope-dark/to-Grace-940/01-148ms.jpg ("$0.00", Portfolio ghost, "never refreshed"), shots/overview-update/verify-light-1280/grace.png; frame-sampled timelines in work-overview-update/scope.mjs and verify-light.mjs output
- Cause: useOverviewResource.ts (the `current` fallback for a new key returns `data: null, busy: true`), so OverviewPage.tsx:487/516 render ghosts. The count-up is gated only on `!fromCache` (OverviewPage.tsx:500–504) and starts from 0 (StatTile.tsx:79–83). DataStatusCard.tsx:33–34 prints "never refreshed" whenever `asOf` is null, which covers "loading" and "failed" as well as "never". The percentage is printed uncapped (components/networth/headline.ts:45–46).
- Polish: While the new owner loads, keep the previous owner's tiles and chart under the dim instead of ghosting. When the number lands, tween from the old value to the new one, not from $0. Show "Prices: loading…"/"unavailable" rather than "never refreshed" when the feed is pending or failed. Print "n/m" or omit the percentage when the base is tiny (e.g. over ±999%).
- Impact: Scope changes feel like a filter sliding over the same page, not a reload that briefly claims the household is worth $0 or that prices were never fetched.
- Size: M · Confidence: high

### OU-07 · "Needs attention" says "No outstanding data checks." and then shows a to-do (a false all-clear on every visit)
- Where: Overview › Needs attention (`/`) · both themes · every cold load and every revisit
- What happens: Before the tax-drift check answers, the card states **"No outstanding data checks."** About 150–220 ms later it switches to "5 of 2026's tax inputs differ from your records →". It happens on arrival (replay) and on **every revisit** (measured 103→321 ms in light), because the check restarts on each mount while the rest of the card paints instantly from cache. A reassurance that turns out to be false is the one message a to-do card must never flash.
- Evidence: shots/overview-update/replay-stagger-dark/05-886ms.jpg ("No outstanding data checks."), shots/overview-update/replay-stagger-dark/07-1029ms.jpg (item appears); revisit timeline in verify-light.mjs output
- Cause: `useTaxDrift` returns `null` both while its request is in flight and when nothing is flagged (components/overview/taxDrift.ts:46). The card's empty sentence only waits for the four data groups (OverviewPage.tsx:915).
- Polish: Treat a pending drift check as "still checking". Keep the "Additional checks are waiting…" wording, or a one-line skeleton, until it answers, and cache its answer with the planning group so revisits paint the final list at once.
- Impact: The attention card is trustworthy at a glance, never saying "all clear" a moment before it isn't.
- Size: S · Confidence: high

### OU-08 · Back from an "Open … →" link often lands at the top of the Overview instead of where you were
- Where: Overview › Recent spending › "Open spending →", then browser Back (`/` → `/spending?range=all` → Back) · both themes · 1440×900
- What happens: In 6 runs, Back restored the reader's position (~959 px, at Recent spending) only 3 times. The other 3 landed at **y = 0** (twice) or **y = 283**, far from the card they left. Instrumentation shows that the Overview's saved position (`sessionStorage scroll:<key>`) had already been **overwritten with the new page's scroll (0 or 283)** during the forward navigation. The same path worked for Portfolio/Calendar/Net worth in single tries, so it's a race and intermittent, but frequent.
- Evidence: logged runs (no screenshot needed): work-overview-update/back-scroll2.mjs and back-scroll3.mjs output: "left y=959 … back → settled y=283 / y=0"; "saved(for this key)=0".
- Cause: Layout.tsx:57–62 records `scrollY` in a rAF under `locationKeyRef.current`. That ref is only updated in a passive effect (Layout.tsx:34–37), so a scroll caused by the new route (its shorter content, its `replaceState` scope normalization, and its `scrollTo(0, 0)` at :89–94) can be written under the previous entry's key before the ref moves on. Back then restores the clobbered value (:84–90).
- Polish: Save the leaving page's scroll synchronously at navigation time (in a link-click or `beforeNavigate` hook, or a `useLayoutEffect` that runs before the new route paints), and ignore scroll events until the new key is current.
- Impact: "Open spending → look → Back" returns the reader to the exact card they came from, which is the core drill-and-return loop of the home page.
- Size: S–M · Confidence: high

### OU-09 · In the balance form, Enter moves the caret into a cell hidden under the sticky live-total bar
- Where: Monthly update › Balances › Enter/↓ walk through the cells (`/update?month=2026-09-01&step=balances`) · both themes · 1440×900, 1280×800
- What happens: The browser scrolls just enough to put the next cell at the viewport's bottom edge, which is exactly where the sticky "Net worth (live)" bar sits. Walking all 26 cells, the focused input was partly or **fully hidden** (up to 31 of its 31 px) on **3 of 26 steps at 1440×900 and 5 of 26 at 1280×800**. You type into a box you can't see, and its Δ cell is often under the assistant button at the same time.
- Evidence: shots/overview-update/verify-light-1280/enter-under-bar.png (focused Traditional 401(k) row entirely behind the bar), shots/overview-update/upd-dark-1440/balances-top.png
- Cause: The live bar is `position: sticky; bottom: 0` inside the card (MonthlyUpdatePage.css:140–152). The Enter protocol calls plain `.focus()` on the next cell (AmountInput.tsx:135) with no scroll margin.
- Polish: Add `scroll-padding-bottom` on the document equal to the bar's height plus a gap (≈64 px), or `scroll-margin-bottom` on `[data-entry-cell]`, so focus always lands one row above the bar. Optionally scroll smoothly to keep the caret at about 60% of the viewport, like a spreadsheet.
- Impact: The monthly routine, typing 26 balances top to bottom, never loses sight of the cell being typed into.
- Size: S · Confidence: high

### OU-10 · Wizard feedback lands off-screen: a failed save and a paste confirmation both appear ~1,700 px from where the user acted
- Where: Monthly update › Balances › "Save Sep 1 balances" (bottom) and column paste (top) (`/update?month=2026-09-01&step=balances`) · both themes · 1440×900, 1280×800
- What happens: (a) The save was answered by this audit's fence (503; the fence message itself is not judged). The only feedback was a banner at the **top** of the wizard, **1,767–1,900 px above** the Save button the user just pressed. No toast appeared, nothing near the button changed, and focus stayed put, so from the user's position nothing happened. The same path carries any real save failure. (b) Pasting a column into the first cell fills the cells with a nice accent flash, but the confirmation "Pasted 3 of 28 values" is written **under the table (y ≈ 2,583 px on a 900 px viewport)**. (c) The paste feature itself (positional or "label⇥value" paste) is invisible: no hint on the step mentions it.
- Evidence: shots/overview-update/upd3-dark-1440/save-fenced-final.png (bottom of page after the failed save: no feedback visible), shots/overview-update/paste-dark/paste/01-105ms.jpg (flash visible, note off-screen)
- Cause: The save `catch` sets `error` (MonthlyUpdatePage.tsx:1196), which renders only in the top `<FeedBanner>` (MonthlyUpdatePage.tsx:1678). `pasteNote` renders after the table (MonthlyUpdatePage.tsx:2017–2021 and :2219). No UI copy mentions paste.
- Polish: Put save errors where the action is: an inline message on the footer line above the buttons plus an error toast, with the top banner kept for load errors. Show the paste summary as a toast or in the sticky live bar. Add a one-line hint under the table header ("Tip: paste a column from your sheet; values fill down from the selected cell").
- Impact: Users know immediately whether their month was saved or pasted correctly, without scrolling to discover that something went wrong.
- Size: S–M · Confidence: high

### OU-11 · Switching months in the wizard shows the new month's labels over the old month's numbers
- Where: Monthly update › month ribbon › click Aug/Jul while on Sep (`/update?month=…&step=balances`) · both themes · 1440×900, 1280×800
- What happens: The title, the column headers ("Jul 1 · Aug 1 · Δ since Jul 1") and the date line switch the instant you click. Until the new month loads, the table keeps showing September's figures under those labels, and the live bar reads "$806,667.88 ▲ $49,205.61 since Jul 1". The date line mixes both months: "Balances as of Jul 1 · **recorded Sep 1**". This lasted ~100–200 ms in replays and **over 1.4 s** in one live run (Sep→Jul at 1280). The only cue is a faint dim.
- Evidence: shots/overview-update/upd3-dark-1440/month-to-aug/03-93ms.jpg (Aug headers over Sep values), shots/overview-update/upd3-dark-1440/month-to-aug/08-186ms.jpg, shots/overview-update/upd3-dark-1440/aug-balances.png (the real Aug values)
- Cause: The step body's labels read the URL month (`month`) at render (e.g. MonthlyUpdatePage.tsx:1781–1784, :1831–1834, and the live-bar "since" text around :2030–2034), while the values are still the previous seed until the load chain lands.
- Polish: Render labels from the loaded month (the seed's month) until the new seed arrives, or crossfade the table body with a short skeleton. Either way, labels and numbers change together.
- Impact: The one screen where the user enters money never shows a mismatched figure, not even for a moment.
- Size: S–M · Confidence: high

### OU-12 · /update assembles itself in three visible steps (header grows, ribbon slides a month, What's due pushes the card)
- Where: Monthly update arrival from the sidebar (`/update` → `/update?month=2026-09-01&step=balances`) · both themes · 1440×900
- What happens: The landing frame shows only "Monthly update". The wizard then mounts with a new title ("— Sep 2026") and inserts the stepper and ribbon (about 130 px), which pushes the body down. When the wizard's own `/coverage` answers, **the ribbon re-anchors**: Oct 2025–Sep 2026 becomes Nov 2025–Oct 2026, every chip slides one slot left, and the selected Sep chip moves **38 px**. At the same moment the "What's due" line is inserted and pushes the card another **26 px**. CLS doesn't catch these because each is an insertion or re-render, but all three are visible.
- Evidence: shots/overview-update/upd-arrive-dark-1440/t1400.png (ribbon Oct…Sep, no What's due), shots/overview-update/upd-dark-1440/balances-top.png (ribbon Nov…Oct, What's due inserted), shots/overview-update/upd-replay-dark/07-856ms.jpg
- Cause: UpdateLanding renders a PageFrame with no stepper or scope row (MonthlyUpdatePage.tsx:363–372). The ribbon anchor falls back to the current month until coverage is known (MonthlyUpdatePage.tsx:1389–1393), even though the shell already holds a cached coverage (ScopeBar `COVERAGE_SNAPSHOT`). WhatsDue renders nothing until coverage arrives (MonthlyUpdatePage.tsx:1677).
- Polish: Have the landing render the same frame (stepper plus ghost ribbon), seed the anchor from the cached coverage snapshot, and reserve the What's due line's height from the first paint.
- Impact: Opening the monthly routine feels instant and settled: the month ribbon doesn't slide under the cursor just as the user reaches for a chip.
- Size: S–M · Confidence: high

### OU-13 · A mistyped balance silently counts as $0, swinging the totals by the whole account
- Where: Monthly update › Balances › any cell (e.g. Wells Fargo Checking) (`/update?month=2026-09-01&step=balances`) · both themes · 1440×900
- What happens: Typing "12,3x" gives the box a red border and nothing else. Meanwhile its Δ shows **−$14,826.18** (as if the balance were $0), the Cash subtotal drops **$27K**, and the sticky live net worth falls **$30K** to $779,684.73. The Save button quietly disables with no reason given. The live totals, the sheet's safety net, report a confident wrong number instead of "can't read this".
- Evidence: shots/overview-update/upd2-dark-1440/invalid-blurred.png (red box, −$14,826.18 Δ, $38,111.60 subtotal)
- Cause: `committed()` maps any unparseable string to 0 (components/monthly/parts.ts:33). The Δ, the subtotals and the live bar all use it (MonthlyUpdatePage.tsx:1868 for the Δ, :930 for the live total).
- Polish: While a cell is invalid, show "—" in its Δ and mark the affected subtotal and live total as incomplete (e.g. "— (1 entry unreadable)"). Add a one-line message under the box ("Not a number: use digits, or =a+b"), and name the reason beside the disabled Save.
- Impact: A typo can't masquerade as a $30K drop, and the user sees what to fix and why they can't save.
- Size: S · Confidence: high

### OU-14 · Review step: "Changes since last save" tables shout in ALL CAPS and left-align the money; the copy counts three confirmations when there are four
- Where: Monthly update › Review › Changes since last save; footer note (`/update?month=2026-09-01&step=review`) · both themes · 1440×900
- What happens: Account and category names render as small grey uppercase header text ("ROBINHOOD JOINT BROKERAGE", "FOOD & DINING"), unlike every other table in the wizard (Title Case, full ink). The amounts are left-aligned in the proportional font, so digits don't line up column-wise. The footer says "To close, complete all **three** confirmations" above **four** checkboxes (the fourth appears for the month in progress).
- Evidence: shots/overview-update/upd4-light-1440/review-bottom.png, shots/overview-update/upd-dark-1440/review-full.png
- Cause: ReviewChanges.tsx:23 renders names as `<th scope="row">`, which inherits `.data-table th` (uppercase, 0.72rem, muted; panels.css:227–233). The cells use `className="numeric"` (ReviewChanges.tsx:23–25), a class that exists nowhere in the CSS (the house class is `.num`). The copy is at MonthlyUpdatePage.tsx:2363 and the fourth checkbox at :2340.
- Polish: Style row headers like body cells (normal case, text colour, left), switch the cells to `.num` (right-aligned, tabular), and make the note count the checkboxes actually shown ("complete the confirmations above").
- Impact: The last screen before closing a month reads as calm and trustworthy as the two before it, with no shouting and no misaligned money.
- Size: S · Confidence: high

### OU-15 · The liability sign cue breaks its row: a three-line monospace note beside a two-line "Flip sign" button
- Where: Monthly update › Balances › a liability typed positive (e.g. Apple CC = 40.62) (`/update?month=2026-09-01&step=balances`) · dark 1440 (same markup in light)
- What happens: The advisory "liabilities are entered negative" appears inside the 160 px input column, in the monospace number face at 0.7rem, wrapped into three lines ("liabilities / are entered / negative"), beside a "Flip / sign" button that also wraps. The row jumps from **41 px to 93 px** and pushes everything below it down. The Δ also turns green (+$40.62), a "good" tone for a card balance that is now wrong-signed.
- Evidence: shots/overview-update/upd2-dark-1440/liability-cue.png
- Cause: `.entry-liability-cue` sits inside `td.num.entry-cell-col` (MonthlyUpdatePage.tsx:1939–1952), so it inherits the numeric cell's font and 160 px width (MonthlyUpdatePage.css:75, :236–244).
- Polish: Show the cue as a full-width note row under the account (body font, one line, button inline), or as a small amber icon with a tooltip plus a "±" button inside the input. Keep the Δ neutral while the sign is suspect.
- Impact: A helpful guard reads as a helpful guard, not as a layout glitch in the middle of data entry.
- Size: S · Confidence: high

### OU-16 · Customize leaves a half-width chart alone beside a ~567 px hole when you hide or reorder cards
- Where: Overview › Customize › Deeper views (hide "Portfolio performance", or move "Recent spending" to the end) (`/`) · both themes · 1440×900
- What happens: The two half-width charts pair up only when they are adjacent. Hide one, and the other sits alone at 568 px with an empty ~567 px half row beside it. Reorder so Money flow sits between them, and **both** are stranded, each alone on its own row. Toggling in the popover also re-lays out the page instantly with no motion, so cards pop in and out behind the popover.
- Evidence: shots/overview-update/int1-dark-1440/perf-hidden-page.png, shots/overview-update/reorder-light/after.png
- Cause: `span={6}` is hard-coded for Portfolio performance and Recent spending (OverviewPage.tsx:676, :706) and the grid just flows `layout.cards` (OverviewPage.tsx:928).
- Polish: Compute spans from the chosen order: a half-width card whose neighbour isn't also half-width becomes full width, and two adjacent halves pair. Animate the reflow with a short FLIP (the same easing as the drag).
- Impact: Any arrangement a user picks looks designed, which makes Customize something people keep using.
- Size: S–M · Confidence: high

### OU-17 · Refresh gives almost no feedback
- Where: Overview › Refresh (`/`) · both themes · 1440×900
- What happens: Clicking Refresh re-requests every feed. The only visible response is that the chart canvases dim to 0.70 opacity for about 230 ms. The tiles, Up next, Needs attention and Data status don't change at all, and the button shows no busy state. If nothing changed, it's impossible to tell whether anything happened. The code comment promises that "the body dims to show the work", but the page frame is never told it's busy.
- Evidence: shots/overview-update/int1-dark-1440/refresh/03-151ms.jpg; opacity samples in work-overview-update/interact2.mjs output (hero/Up next/Data status stay 1.0; charts 1→0.70→1)
- Cause: `resource={{ status: 'ready', fromCache }}` omits `busy` (OverviewPage.tsx:772), so PageFrame's `.loading-dim` never engages. The button itself has no pending state (OverviewPage.tsx:767–769).
- Polish: While the reload is in flight, spin the button's icon or label it "Refreshing…", dim the whole body (pass `busy`), and end with a quiet "Updated just now" beside the button (or on Data status's price line).
- Impact: The one explicit "get me fresh numbers" action confirms itself, so users stop clicking it twice or wondering whether it worked.
- Size: S · Confidence: high

### OU-18 · Year to date card: the Net worth figure collides with its neighbour, and "Dividends" wraps and drops or orphans
- Where: Overview › Year to date (`/`) · both themes · 1440×900, 1280×800
- What happens: At 1440, "▲ $327,976.91 (+54.2%)" overflows its 209 px column by 7 px and sits **9 px** from the next column's "$45,497.45", so it reads as one run: "(+54.2%) $45,497.45". "Dividends ex-date for automatic records" is the only label that wraps (two lines), which drops its value 16 px below the other four. At 1280 the grid wraps 4 + 1, leaving Dividends alone on a second row with 75% of the row empty.
- Evidence: shots/overview-update/ytd-dark-1440/ytd.png, shots/overview-update/ytd-dark-1280/ytd.png
- Cause: `.ytd-facts { grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)) }` (OverviewPage.css:72–77) with a nowrap value (OverviewPage.css:101–103), and the long label at OverviewPage.tsx:659–661.
- Polish: Put the net-worth percentage on the sub-line (as with Saved), shorten the label to "Dividends" with the ex-date note in the sub-line, and use a fixed five-column grid at ≥1200 px (or a 3 + 2 layout below it) so no fact is orphaned.
- Impact: The year's five key figures read as five clean, aligned facts.
- Size: S · Confidence: high

### OU-19 · Chart "Table" twins show raw export values: ISO dates, unformatted money, oldest first
- Where: Overview › Net worth trend / Recent spending / Portfolio performance / Money flow › Table (`/`) · both themes · 1440×900
- What happens: The data table under a chart prints the CSV cells verbatim: "2023-09-01" (right-aligned like a number under a left-aligned "Month" header) and "83694.05" with no $ or separators. Everywhere else on the page the same figures read "Sep 2023" and "$83,694.05". The 38 net-worth rows are oldest-first in a scroll box, so the months the user cares about are at the bottom.
- Evidence: shots/overview-update/int2-dark-1440/trend-table-scrolled.png, shots/overview-update/table-stretch-light/trend-table-status.png
- Cause: ChartTable.tsx:36 prints `String(cell)` from the export table. The "numeric" test (/^-?\d/, ChartTable.tsx:16) also matches ISO dates.
- Polish: Format display cells with the page formatters (month names, currency) and keep the raw values for the CSV download only. Left-align date columns, and open the table scrolled to the newest rows (or list newest first).
- Impact: The table becomes a readable companion to the chart, not a raw data dump.
- Size: S–M · Confidence: high

### OU-20 · Two identical (i) icons do different things; the KPI one reflows the whole page and splits Up next amounts
- Where: Overview › KPI tile (i) vs card-title (i) (`/`) · both themes · 1440×900
- What happens: The (i) next to a card title shows a bubble on hover (150 ms). The same-looking (i) on a KPI tile does nothing on hover. On click it docks a side panel that narrows the page to **815 px**: the KPI row reflows to 2×2, Up next rows wrap to two or three lines, and the "−$50" amount splits across two lines ("−" / "$50"; the element is 34 px tall in both themes).
- Evidence: shots/overview-update/int1-dark-1440/metric-hover.png (no bubble), shots/overview-update/int1-dark-1440/metric-open-final.png, shots/overview-update/dock-light/upnext.png (split amount)
- Cause: StatTile.tsx:127–128 swaps InfoHint for MetricInfoButton whenever `evidence` exists. MetricInfoButton (details/MetricInspector.tsx:90–93) has no hover preview and opens the dock. `.up-next-amount` lacks `white-space: nowrap` (OverviewPage.css:164–168).
- Polish: Give the metric button its own affordance (e.g. a "receipt" glyph or a visible "Details" text button on hover) and show the one-line definition on hover like other hints, with click opening the panel. Add `white-space: nowrap` to Up next amounts.
- Impact: Users can predict what an icon will do before clicking it, and opening a detail panel doesn't scramble the page behind it.
- Size: S · Confidence: high

### OU-21 · Recent spending's all-grey bars: deliberate, but in dark they read "greyed out" (lead 4 verdict)
- Where: Overview › Recent spending (`/`) · dark vs light · 1440×900
- What happens: Verdict: it doesn't read as a loading state (axes, labels, the dashed average and the "Sep*" marker are all present). In **light** the dark-slate bars (#5f6b7a) with a black dashed average read as intentional. In **dark**, the bars use the exact muted-text grey (#8b93a3), the colour of axis labels and captions. Next to the vivid Portfolio performance chart the card looks disabled, and the in-progress "Sep*" bar (same grey, hatched) barely stands apart. The legend shows the dashed average as a solid white square. "Open spending →" then leads to a chart where the same months are fully coloured.
- Evidence: shots/overview-update/deeper-dark-1440/perf-spend.png, shots/overview-update/deeper-light-1440/perf-spend.png, shots/tour-dark-1440/spending.png (destination chart)
- Cause: `TOTAL_SPEND = MUTED` (components/overview/overviewChartOptions.ts:93; tokens `muted` theme/tokens.ts:73/113). The global legend icon is `roundRect` for every series (charts/theme.ts:86).
- Polish: Keep the aggregate neutral but give it its own chart token with more presence than caption text (e.g. a cool slate a step brighter in dark, or the accent at ~45%). Optionally tint only the months above the 12-month average in the warning hue so the chart says something at a glance. Draw the average's legend key as a dash.
- Impact: The spending card looks as alive and trustworthy as its neighbour, and above-average months pop without reading numbers.
- Size: S · Confidence: medium (colour judgment; measurements high)

### OU-22 · Spending step rhythm: rows alternate 41/56 px, a cramped header, and at 1920 names sit ~1,100 px from their numbers
- Where: Monthly update › Spending (also Balances for the width part) (`/update?month=2026-09-01&step=spending`) · both themes · 1280/1440/1920
- What happens: Categories with a budget get an "of $501.00" sub-line, so rows alternate **41 px (6 rows) and 56 px (13 rows)** in a ragged rhythm. "Typical (3-mo median)" wraps onto two lines in its 130 px column while the Category column spans 529–1169 px of mostly empty space. At 1920 an account or category name sits about **1,100 px** from its input, with no row hover or focus highlight to connect them. In the month in progress, every untouched $0.00 cell shows a **green** "under typical" delta (−$402.27, −$1,009.93…), praising categories that simply haven't been entered.
- Evidence: shots/overview-update/upd-dark-1440/spending-full.png, shots/overview-update/upd4-light-1920/balances-top.png
- Cause: The budget sub-line is conditional (MonthlyUpdatePage.tsx:2175–2180). Fixed 130/160 px data columns (MonthlyUpdatePage.css:75–76). No `tr:hover` / `tr:focus-within` rule anywhere in the table CSS. The Δ tone is applied regardless of whether the cell was touched (MonthlyUpdatePage.tsx:2186–2197).
- Polish: Reserve the budget line in every row (or move the budget into its own muted column), let the "Typical" column size to its header (or label it "Typical" with the definition in the (i)), cap the entry tables at ≈1,000 px and centre them in wide viewports, and add a subtle `tr:focus-within`/hover band. Keep Δ muted for cells nobody has touched.
- Impact: The entry table scans like a clean spreadsheet: even rows, the active row lit, and no false green on an unfinished month.
- Size: S–M · Confidence: high (layout) / medium (Δ tone)

### OU-23 · Wizard wayfinding: steps swap with a hard jump, the stepper never shows what's done, and the ribbon's markers are unexplained
- Where: Monthly update › stepper, Next buttons, month ribbon (`/update?…`) · both themes · 1440×900
- What happens: Balances → Spending → Review swap instantly and jump to the top, with no transition, so it doesn't feel like moving forward through a flow. The three step pills show only "current/not current". A step whose part is already saved (Sep 1 balances, "recorded Sep 1") looks identical to one that isn't. The ribbon's status marks are tiny split dots (balances half / spending half, hatched = partial or provisional) whose meaning lives only in native `title` tooltips (≈1 s delay, unstyled). There is no key on the page.
- Evidence: shots/overview-update/upd3-dark-1440/next-button/01-63ms.jpg → shots/overview-update/upd3-dark-1440/next-button/03-93ms.jpg (instant swap), shots/overview-update/ribbon/ribbon-dark-3x.png (markers at 3×)
- Cause: The stepper renders index + label + `active` only (MonthlyUpdatePage.tsx:1619–1631). Chip status goes into `title`/`aria-label` (components/shell/MonthRibbon.tsx:151–152).
- Polish: Add a done tick (or filled index) to saved steps, and slide or crossfade the step body (≈200 ms, matching the page entrance). Replace the ribbon's native tooltips with the app's styled hint, plus a small "● balances ● spending ◌ partial" key on hover.
- Impact: The monthly routine feels like a guided three-step flow with visible progress.
- Size: S–M · Confidence: medium

### OU-24 · Small typographic and link inconsistencies across both pages
- Where: Overview and Monthly update (`/`, `/update?…`) · both themes
- What happens: (1) **Two minus signs**: the Portfolio delta "-$2,911.11 (-0.3%)" and the whole wizard Δ column use the short hyphen, while Changes ("−$188,615.33"), Up next ("−$50", "≈ −$8.0k") and the Review tables use the true minus "−". They look different side by side in tabular columns. (2) The wizard Δ column shows positives without "+" ("$12,156.97"), while the Overview's Changes card uses "+$248,004.27". (3) "Loading upcoming events..." uses three dots where every other loader says "Loading…". (4) The Money flow footer's second line starts lowercase ("net pay entered 8/12 months · …") under a capitalised first line. (5) The mover names in "Changes worth understanding" are links with no underline, no link colour and no hover change, so they look like plain text.
- Evidence: shots/overview-update/ytd-dark-1440/kpi.png ("-$2,911.11"), shots/overview-update/int2-dark-1440/movers-hover.png (hovered link: no change), shots/overview-update/w-dark-1920/p2.png (lowercase footnote)
- Cause: `formatCurrency`/`formatPct` emit "-" (utils/format.ts:9–12, :28–37), while OverviewChanges.tsx:43 and ReviewChanges.tsx:25 hand-write "−". "Loading upcoming events..." is at OverviewPage.tsx:850. The footer joins the server's `flow.warnings` as-is (MoneyFlowCard.tsx:107). `.overview-movers a { color: var(--text) }` (OverviewPage.css:195) overrides the global link colour, and there is no hover rule (index.css:150–153).
- Polish: Make the formatters emit U+2212 (one glyph app-wide) and sign positive deltas with "+" in the Δ column. Use "…" everywhere. Sentence-case the footnote lines. Give the movers a hover underline or accent (as Up next rows have).
- Impact: Numbers and links look like one system: signs align in columns and anything clickable announces itself.
- Size: S · Confidence: high

## Strengths to keep
- **Revisits and cached switches are instant and still**: returning to the Overview paints from cache with no layout shift, no count-up and no chart re-entrance; cached money-flow years and already-seen scopes flip with just a 120 ms dim. Any fix for OU-02/OU-06 should reuse this path.
- **The balance form's keyboard contract is excellent**: select-all on focus, formatted echo at rest, "=a+b" arithmetic, Enter/↓ and Shift+Enter/↑ walking the column, Escape to revert, Ctrl+S / Ctrl+Enter to save only the current part.
- **Paste-a-column** fills down from the focused cell, skips derived rows, and flashes each filled cell with the accent. It just needs to be discoverable (OU-10).
- **Chart tooltips and the Expand dialog**: month-headed tooltips with swatches and a crosshair; Expand restores focus and scroll on close; Export offers PNG, Copy image and CSV.
- **Customize** is keyboard-accessible (Space to lift, arrows to move, Space to drop), keeps focus inside, and has "Reset to defaults" as a one-click undo.
- **Honest labelling everywhere**: dated headlines ("as of Sep 22", Provisional), rich status names on every ribbon chip, "Month in progress" footnotes, and a What's due line that says exactly what's next.

## Not reproduced / environment artifacts (what I ruled out)
- **Lead 1's "~2.1 s /portfolio/holdings"** is a local artifact. On this Windows box a *new* asyncpg connection to `localhost` takes **~2,085 ms** (vs 33 ms to 127.0.0.1), so any request needing a sixth pooled connection stalls ~2.1–2.4 s. It hit timeseries, coverage or holdings at random. It reproduces both direct to uvicorn and through the preview proxy (bursts of 18: ~10 stall), while serial calls take 25–140 ms. With the stall removed via replay, the lone hero skeleton lasts ~100 ms, but the layout jumps in OU-01 remain.
- "Couldn't load investments — The user aborted a request." appeared in 2 of ~14 live loads under the shared backend (with "Prices: never refreshed" in Data status). It was not seen in any replay, so I treat it as load/environment. The raw browser wording ("user aborted") is worth a look if it can happen in production.
- A lighter band behind the Review step's footer appeared only in full-page screenshots (sticky misdraw); viewport shots show none.
- Save 503s are the audit fence. Only their presentation was judged (OU-10).
- Clicks on the Net worth trend plot did not pin a selection (they must hit the line itself). This is not a polish finding; the hover tooltip works well.
- Portfolio performance greys the comparison lines while hovering. That is the app-wide `emphasis.focus: 'series'` grammar (charts/grammar.ts:193, charts/legend.ts:9), a deliberate choice. It is noted but not reported, though on this particular chart the comparison is the point.
- Native `title` tooltips don't render in headless screenshots; ribbon chip texts were verified from their attributes instead.
- The "DEV 1694013d" badge and the scheduler being off (Data status dates are real data) are environment, not findings.
