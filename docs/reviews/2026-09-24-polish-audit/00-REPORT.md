> **Archived 2026-09-25.** The audit's consolidated report and its eight lane files, copied from the audit session's
> temporary scratchpad so the IDs cited by `docs/superpowers/specs/2026-09-25-polish-alignment-feedback-undo-design.md`
> resolve. `findings/<lane>.md` below means `./<lane>.md` in this folder. The screenshots and filmstrips (`shots/…`)
> and probe scripts (`work-…/`) were not kept; every finding states its measurements in words.

# Personal finance dashboard — UX polish audit (2026-09-24)

**What was audited:** the production build of `main` @1694013d (the same commit production serves), running
locally against a fresh read-only copy of production's database. Production itself was only read (one
`pg_dump`), never written. Every page, tab and control was walked in dark and light at 1440×900, with checks at
1280×800, 1366×768, 1920×1080 and 2560×1440. Transitions were filmed frame by frame, layout shifts and
geometry were measured, and each cause was traced to a source line. Eight parallel reviewers covered it, and
every finding was reproduced at least twice. Save/undo flows were exercised on a separate throwaway copy.
No code was changed.

**Out of scope, as asked:** mobile/responsive work, transaction-level spending changes, realized gains / XIRR.

**Where the detail lives:** each item below cites lane IDs. The full write-up for each ID (what happens, the
measurements, the evidence screenshots, file:line cause, the fix, size) is in `findings/<lane>.md`, with
screenshots and filmstrips under `shots/<lane>/`:

| Prefix | Lane file |
|---|---|
| OU | findings/overview-update.md |
| NWSP | findings/networth-spending.md |
| PE | findings/portfolio-espp.md |
| TPC | findings/taxes-paycheck-comp.md |
| PCC | findings/projection-calendar-cards.md |
| SGS | findings/settings-guide-shell.md |
| MOTION | findings/motion-consistency.md |
| WF | findings/write-flows.md (IDs written WRITE-FLOWS-nn there) |

Size: S ≈ an hour, M ≈ half a day, L = more.

---

## 1. Do these first (highest felt impact per hour)

1. **Mouse-wheel scrolling sticks over charts.** On Net worth, Spending, Portfolio, Projection and ESPP, the
   page stops scrolling whenever the pointer is over a chart that shows "ctrl+scroll to zoom". Verified: 5
   wheel notches moved the page 0 px, against about 500 px elsewhere. The code intends bare-wheel scrolling,
   but ECharts 6.1 swallows the event. Fix: a capture-phase wheel listener in `EChart.tsx` that lets
   non-ctrl wheels through. **S** · MOTION-08
2. **Pages lurch as they load.** The loading ghosts don't match the real layout:
   - Overview assembles in four jolts (drops of 69 px, then 198 px; CLS 0.085–0.12, the only page above 0.1).
   - Portfolio, Projection and Calendar ghost 5 tiles as 4 + 1, then snap to one row (113–146 px jump).
   - Taxes lacks its year row (55 px); Paycheck lacks its tile (119 px, and 660 px on a Profiles deep link).
   - /update plays its entrance twice, and its ribbon slides a month.
   - Scope rows shove 334 px sideways when the owner chips arrive.

   Fix: give the skeleton the real row variant and card grid, reserve landed heights, and reserve the chip
   slot. **M** · MOTION-01/02/03/06, OU-01/12, PE-09, TPC-04
3. **Returning to a tab replays the page's entrance.** On 8 pages the first tab re-runs its card cascade
   (320–410 ms versus 180 ms for every other tab). Net worth and Portfolio remount their tiles, so the hero
   counts up from $0 again and the tile row pops 119 px. Fix: clear `data-stagger` after arrival, keep tile
   rows mounted, and count up only on first paint. **S** · MOTION-09, NWSP-07, PE-06
4. **Side-by-side cards don't end together (one CSS fix, five pages).** Overview's Recent spending ends 63 px
   short; Spending Trends 69 px (488 px with All categories); Paycheck's flow card 95 px; ESPP 17 px. The chart
   is portalled into a slot that stretches, but the card inside doesn't. Fix: make slot, host and card a flex
   column at 100% height, with the footer pinned to the bottom. **S** · OU-04, NWSP-08, TPC-01c, PE-11
5. **KPI tile rows aren't one aligned strip.**
   - Badges (Provisional, Not yet reviewed, Borderline) wrap under their labels, dropping those values 17–19 px.
   - Deltas break mid-phrase ("21 / days", "Sep / 1").
   - Some tiles have sub-lines and others don't, leaving 35–58 px empty.
   - The row height changes 145 → 111 → 128 px as you pick months, bouncing the charts below.
   - 5-tile rows wrap 4 + 1 or 2 + 2 + 1.

   Fix: a corner slot for badges; a label/value/delta subgrid; real sub-lines for bare tiles; shorter deltas;
   5-tile fallbacks of 5 compact or 3 + 2. **M** · OU-03, NWSP-04, PCC-12, PE-02, TPC-18
6. **The floating assistant button covers content.** On 12 of 18 page states it sits 11–32 px inside the
   content column. It hides Export buttons, zoom hints, the wizard's Δ column, Data status values,
   "Model sale →" and the "2026" chip. It has no hover label. Fix: a bottom/right safe area, fade while
   scrolling (or move it to the sidebar), and add `title`. **S** · MOTION-13, OU-05, NWSP-12, PCC-36, PE-26,
   SGS-23
7. **Opening a side panel breaks the page beneath it.** Layouts key off the window width, not the remaining
   width:
   - Settings inputs spill out of their cards, tables scroll sideways, and pickers clip to "Ligh" / "Compa".
   - The holding details panel content is 791 px wide in a 384 px panel, so its Dividends ledger is
     off-screen.
   - Tiles reflow 2 + 2 + 1, and the clicked Holdings row jumps 247 px.
   - Calendar chips shrink to "R. ~+$48.1k".
   - Un-pinning a Spending month leaves an empty panel open.

   Fix: `@container page` queries (the container is already declared), anchor the clicked row, and close the
   panel when its selection clears. **M** · SGS-03, PE-01, PE-02, NWSP-02, NWSP-25, OU-20, PCC-15
8. **The theme toggle flickers.** Surfaces swap instantly, but 60–120 controls fade from the old colours for
   ~120–250 ms: dark pills on the light page, and invisible selected-tab labels. Fix: suppress transitions for
   the swap frame, or a 200 ms View Transition dissolve. **S** · SGS-01, MOTION-12
9. **Charts glitch when their data changes shape.**
   - Quarterly → Monthly shreds the stacked areas into streaks for ~300 ms.
   - Projection's default view relabels its axis and re-wipes its right third on every assumption change,
     with markers floating off the line.
   - Money flow's year chips collapse the card to a skeleton: the title loses its year, the chips vanish from
     under the pointer, and the diagram replays.
   - A legend click leaves the whole chart washed out until the pointer crosses it.
   - A phantom "Reset zoom" appears and the Portfolio headline number changes.

   Fix: cross-fade when the x-domain changes, use a stable milestone window, keep the old chart under the dim,
   and downplay after a legend toggle. **S–M** · NWSP-03, PCC-03, OU-02, NWSP-05, PE-07
10. **Monthly update entry.**
    - Save (at the bottom of a ~2,700 px form) jumps the page to the top.
    - A typo counts as $0: "abc" shows a false −$10.9K net-worth drop, and the only warning is a 1 px border.
      Save disables 1,850 px away with no reason given.
    - Enter moves the caret into cells hidden under the sticky totals bar.
    - Switching months shows the new labels over the old numbers.

    Fix: an inline receipt and a Save button in the sticky bar (Taxes already has this pattern), invalid cells
    excluded from totals with a message, `scroll-padding-bottom`, and labels that follow the loaded data.
    **M** · WF-01/02/16, OU-09/10/11/13
11. **Feedback lands where you aren't looking.**
    - Edit loads rows into forms scrolled out of view: Settings −54 to −280 px, cards −186 px.
    - Row errors appear at the card top, off-screen: Settings, Budgets, Tax Inputs 1,181 px away.
    - New rows land at the bottom of a capped box (a new transaction ~3,000 px below).
    - The rewards-matrix editor opens below the fold.
    - The chart Table opens below the fold (21 px visible).

    Fix: edit in place, or scroll to and focus the form; show errors inline; scroll to and flash new rows.
    **M** · SGS-04/05/18, WF-04/05/06/11, PCC-19, TPC-06/14/16, NWSP-15, MOTION-11
12. **One grammar for saving, deleting and undo.**
    - Delete comes in six dialects: native `confirm()` (ESPP, Paycheck, Securities, Comp), a typed arm plus
      Undo, click-to-arm, an inline confirm, instant plus an Undo toast, and instant with no Undo
      (categories, accounts).
    - Success is signalled five ways.
    - Save buttons are lit when nothing has changed (7 on Tax tables), and "Saved." never fades.
    - A Kind change that "recomputes ALL history" has no confirm and no Undo.
    - Focus drops to `<body>` after most saves; "Saving…" shows on the wrong button; busy labels resize
      buttons (~69 px).

    Fix: reversible actions → instant + Undo toast + the row collapses; irreversible → an in-app popover;
    dirty-aware Save; a transient "Saved ✓"; `aria-disabled` while busy. **L (S per piece)** · WF-03/07/09/10/12/13,
    SGS-16/17, TPC-12/19
13. **The sidebar doesn't fit ordinary laptops.** It needs 886 px. At 1280×800, 1366×768 and 1536×864 it
    grows its own scrollbar and hides the theme toggle and Log out. "Search or ju…" is truncated at every width.
    Fix: a short-viewport rhythm, a one-row account footer, and the label "Search…". **S** · SGS-06, MOTION-21
14. **Back doesn't return you to where you were.**
    - Overview → "Open spending →" → Back landed at the top in 3 of 6 runs: the saved position gets
      overwritten during navigation.
    - Taxes lands 120–720 px short and Portfolio at the top, because the page is still growing.
    - "Back to matrix" resets scroll and focus.
    - Settings and Guide forget their last tab.

    Fix: save scroll synchronously, re-apply it while the page grows (stop at the first user input), and
    remember the last section. **S–M** · OU-08, MOTION-04, PCC-13, SGS-26

## 2. Layout & whitespace

- Stretched cards with dead space:
  - Overview "Changes worth understanding" shows a 109 px blank band; opening the trend's Table moves 277 px
    of blank space to Data status. Fix: pin footers, or let the column end. **S** · OU-04
  - Settings › Household leaves a 261 px hole beside Spending categories, and the owner selects are 627 px wide
    for one word. Fix: pair Household with Portfolio accounts and size the selects to their content. **M** ·
    SGS-09
- Paycheck opens with a lone ¼-width tile, a "card inside a card" whose sub-figure outshouts the headline, and
  Edward's $7,136.72 printed twice. Fix: one tile row, no nested tile. **M** · TPC-01
- Calendar has a 65 px blank band under the weekday names (a one-line CSS fix, `grid-template-rows: auto`) and
  a 22 px ragged cash-flow tile strip. **S** · PCC-04, PCC-17
- Allocation: switching the breakdown resizes the card by up to 294 px, and the donut floats at the top of its
  column. Fix: centre or stick the donut, and cap the list. **S** · PE-20
- Guide:
  - Master–detail leaves a ~500 px void, and the 18-step checklist has no Next or progress. **M** · SGS-20
  - The settings-map table is capped at 72ch, so 11 of 16 links wrap. **S** · SGS-21
  - The chip row orphans a chip. **S** · SGS-22
- Wide monitors (1920–2560):
  - Captions run 200–350 characters per line, and a Taxes label sits ~2,000 px from its figure.
  - Charts flatten to 7:1 strips; fixed 300/400 px chart heights leave the Portfolio overview ending a third
    of the way down.
  - The month ribbon uses 552 of 1,631 px.

  Fix: cap prose at ~80ch, tables `width: auto`, chart heights that scale. **M** · MOTION-22, PE-19, PCC-34,
  NWSP-30
- Header row height differs per page, so the title and tabs hop 4–30 px between pages. Fix:
  `min-height: 36px`, and move Portfolio's status line into the header. **S** · MOTION-05
- Net worth: picking a month wraps the scope row, so the ribbon jumps from under the cursor and the page lurches
  42 px. Spending's ribbon jumps 150 px between tabs; at 1280 the sticky block reaches 154 px. **S** · NWSP-01,
  NWSP-13, NWSP-30
- Taxes: jurisdiction columns slide 143 px between years, and "Change…" moves 104 px. Fix: a fixed table layout.
  **S** · TPC-08
- ESPP Lots needs 1,350 px at 1440, so the pinned actions cut Gain % in half and hide "Qualifying in N days";
  Purchase model hides all six result columns. **M** · PE-03
- The ESPP lot form is ragged: one field's note makes a 128 px row. Tax tables clip a threshold to
  "$1,485,906.(". **S** · PE-08, TPC-12
- Net worth › Accounts: the table starts below the fold behind a 30-chip picker. **M** · NWSP-28

## 3. Motion & transitions (things that snap, jump or replay)

- Revisits dim valid cached numbers to 70% on every background refetch. Fix: a 300 ms grace period, and no dim
  on silent revalidation. **S** · MOTION-07
- Overview WHOSE switch:
  - The page tears down to ghosts, and a $0 hero counts up beside a +$258K (+636,584.7%) delta.
  - Data status shows "Prices: never refreshed", and the trend chart re-enters.
  - Other pages swap in place; Portfolio shows the previous owner's numbers under the new chip.

  Fix: keep the old figures under the dim and tween old → new. **M** · MOTION-10, OU-06, PE-18
- Taxes: picking 2026 while reading a lower card throws you ~1,000 px, and the inserted card arrives in two
  steps. Fix: `holdPosition()` plus a sized skeleton. **M** · TPC-02
- Taxes Inputs: "Save inputs" leaps 481 px sideways on the first keystroke, because `.entry-footer` leaks from
  MonthlyUpdatePage.css. **S** · TPC-05
- What-if opens in three stages, with a 61 px drop. **S** · TPC-09
- Projection sliders are blind while dragging: the value and chart update only on release or after a 300 ms
  pause. Tracks span the API's fences, so return runs −50…+50% and a 96 px drag goes from 5% to 37%. Fix: a live
  value, throttled previews and comfortable ranges. **M** · PCC-01/02
- "Hide assumptions" pushes the chart down 129 px and hides that a scenario is live. **M** · PCC-11
- Hard cuts that should glide, each **S**:
  - calendar month paging (PCC-25)
  - wizard step swaps, with no "done" tick on steps (OU-23)
  - vesting rows, with no chevron (TPC-21)
  - budget editor open (NWSP-15)
  - Guide chip swap with an 88 px jump (SGS-15)
  - calendar popover (no pop-in) and a drawer that vanishes (PCC-26)
  - deleted rows vanish, with the toast arriving before the row leaves (WF-13)
  - Customize reflow (OU-16)
  - Sankey Month ⇄ Year (NWSP-23)
  - "What moved" height change (NWSP-19)
  - "Share %" snaps while its siblings morph (MOTION-20)
- Assistant close: the panel empties before it leaves, and the launcher sweeps 400 px across the content.
  **S** · SGS-23
- Calendar Add event reflows the page in two jolts, and the new chip pops in late. **M** · WF-20

## 4. Charts

- The "Table" view is a raw export: ISO dates, "24598.26", enum codes, misaligned headers, no sticky header,
  oldest first. Fix: display formatters (the CSV stays raw). **M** · NWSP-06, OU-19, PE-16, PCC-32
- Labels cut at 118 px while half the plot is empty ("Robinhood Joint Bro…", "Wells Fargo Active C…"). Calendar
  labels are cut server-side at 24 characters, which drops "anniversary". Holdings names are capped at 150 px
  even at 1920. **S** · NWSP-19, PCC-06, PCC-09, PE-25
- A 24 px bar cap on 3–8 categories: Comp's bars fill 7% of their slots, and the tax waterfall's steps are 2–4 px
  slivers. Fix: scale the cap with the count, add a minimum height and connectors. **S** · TPC-03, TPC-07
- The dividend "barcode" along Performance's $0 line (~130 of 155 weeks marked), and 22-line tooltips that slide
  under the sticky bar. Fix: monthly marks in their own lane, `confine`, summaries. **M** · PE-04/05
- Legends that don't distinguish series:
  - Projection shows four identical blue squares; ESPP two identical greys.
  - Legends wrap into the plot or onto the axis, and Credit lines pages at 9 entries with Total on page 2.

  **S** · PCC-08, PE-21, NWSP-09, PCC-23, PCC-30
- Small readability fixes, each **S**:
  - Log axes draw near-white gridlines in dark (a missing `logAxis` theme block). PCC-24
  - The "Half" label is always struck through by the lines. PCC-07
  - Off-scale markers read like axis labels. NWSP-16
  - Odd tick strides ("Sep '26 · May '27"). PCC-33
  - Trailing zeros ("$800.0K"). PE-21
  - The Day-change treemap is all grey. PE-17
  - The "you are here" diamond is nearly invisible. TPC-20
  - Charts never mark the picked month. NWSP-11
  - The Income chart spends half its bars on untracked months. PE-13
  - Recent spending's bars in caption grey look disabled in dark. OU-21
  - The Composition donut's labels are cut to "…" in the panel. TPC-13
  - The "All categories" small multiples overprint each other. NWSP-10
- Delight: cross-highlight the Paycheck breakdown list and its sankey. **M** · TPC-24

## 5. Feedback, focus & copy

- Toasts cover the wizard's sticky totals, the page-header buttons and the docked assistant. Contradictory and
  duplicate toasts stack, and the Undo window has no visible countdown. Fix: offsets that are aware of footers
  and the dock, keyed replacement, and a draining bar. **S–M** · WF-08, SGS-13
- Loading states briefly say something false, each **S**:
  - "No outstanding data checks." shows before the to-do appears (OU-07).
  - "Prices never refreshed" shows during load (PE-10, OU-06).
  - "Utilization needs a snapshot…" flashes (PCC-28).
  - Oct can be picked, but nothing changes (NWSP-22).
  - A selected category chip silently refuses a 4th pick (NWSP-27).
- Developer-speak messages: "is_component needs parent_account_id…", "Input should be a valid decimal",
  "annual_fee must be non-negative" shown for letters, and "The user aborted a request." on timeouts. A failed
  Refresh prices becomes a page-level line whose Retry reloads the page instead of retrying the refresh.
  **S** · WF-14, PE-22
- Refresh on the Overview gives almost no feedback (a 230 ms dim on two charts). **S** · OU-17
- Monthly update details, each **S**:
  - the liability sign cue breaks the row (41 → 93 px) (OU-15)
  - row rhythm alternates 41/56 px, and untouched $0 cells show a green "under typical" (OU-22)
  - the Review tables shout in ALL CAPS, and the copy says "three" confirmations above four checkboxes (OU-14)
  - the "Month closed" receipt buries the news (WF-19)
  - a restored draft doesn't say what it restored (WF-23)
  - Undo in the wizard re-renders heavily, and Calendar Undo is silent (WF-17)
- Settings row noise: 147 row buttons and 49 identical ACTIVE pills, with 133 Tab stops to cross the categories
  card. **M** · SGS-07
- Budgets: meter tracks are invisible (1.05:1), and "since Sep 2026" plus "Edit budget" repeat 13 times. **S** ·
  NWSP-14
- Command palette:
  - ↑↓ never scrolls the list, so Enter runs a row you can't see. **S** · SGS-02
  - Every row repeats its group; there's no match highlight and no key hints; the overlay is muddy in light.
    **S–M** · SGS-19
- Projection:
  - Comparing scenarios shows no Δ. PCC-20
  - A "Baseline 5%" click creates a fake scenario. PCC-21
  - Input deltas are coloured good/bad by sign. PCC-22
  - The retirement month inputs show "--------- ----". PCC-10
  - Pin at the limit wipes the typed name. WF-21

  All **S**.
- Calendar, each **S**:
  - today and the selected day look alike (PCC-16)
  - the "Your figure" popover grows off-screen (PCC-14)
  - Add event defaults to the 1st (PCC-15)
  - List view drops the colour key and the amount column (PCC-27)
  - vest chips wear a "+" that the week gutter ignores (PCC-35)
- Portfolio, each **S**:
  - the range chips sit on all 5 tabs but only work on one (PE-12)
  - "Open Comp vesting schedule" does a full page reload (PE-23)
  - the Manage sub-tabs stretch into an empty bar, and the edited row isn't tinted (PE-24)
  - "Dividend entries" reads like a count, and the same total has three names (PE-14)
  - Credit cards Manage's WHOSE chips do nothing (PCC-29)
- Taxes: Apply writes with no preview or Undo (TPC-18); long input labels are ellipsised beside 330 px of empty
  card (TPC-15); "+0.1 pp" beside 27.3% → 27.5% (TPC-23). **S**
- Settings/Guide details, each **S**:
  - the Rename editor is cramped and focuses Cancel (SGS-17)
  - "View report" opens out of sight (SGS-18)
  - Price refresh history is a run-on sentence (SGS-10)
  - the System card's values zig-zag (SGS-11)
  - info bubbles inherit the scroll-fade (SGS-12)
  - the Appearance pickers stretch, and the chosen option is faint in light (SGS-14)
  - login inputs are in Arial, and the card jumps on error (SGS-24)
  - the 404 is a dead end (SGS-25)
  - SGS-27 nits

## 6. Visual language & consistency

- Monospace where words belong:
  - text fields, selects, dates and placeholders are set in the money font and right-aligned ("RH Joint Taxab…");
  - matrix card names are bold mono, 3–7 lines;
  - numeric headers are mono beside proportional ones.

  Fix: a `.field-input-text` variant, `th.num { font-family: inherit }`, and `font: inherit` on login inputs.
  **S** · SGS-08, PE-15, TPC-10, TPC-17, NWSP-20, PCC-05, PCC-10
- Number dialects:
  - a hyphen and a true minus on one screen;
  - "$3.6k" vs "$263.7K";
  - "~", "≈" and "(est.)" as estimate markers;
  - cents on estimates (FI target $1,641,700.25, credit line $133,850.00);
  - "+636584.7%" and "29.4978927%";
  - Portfolio tables proportional while every other table is mono.

  Fix: one formatter family — U+2212, uppercase K/M, "≈", whole dollars for estimates. **S–M** · MOTION-16/17,
  PCC-18, OU-24, NWSP-17, TPC-11, SGS-27
- Buttons, links and icons:
  - six button heights, and a leaked Portfolio row-action style that is ~1.05:1 in light;
  - links with four hover behaviours (most have none);
  - the same ⓘ shows a hover bubble on cards but opens a docked panel from tiles;
  - hard-coded black scrims/shadows (muddy in light);
  - create buttons styled differently per page;
  - a mixed header-action size.

  **S–M** · MOTION-14/15/18/19, NWSP-24, OU-20, PCC-37, NWSP-29
- Words and dates:
  - ISO dates in the metric inspector;
  - "Last closed 9/24/2026";
  - "By group over time" stays the title in By owner mode;
  - "Edit ↗" doesn't name its month;
  - lowercase footnotes;
  - "Loading...".

  **S** · NWSP-24/26, WF-19, OU-24, MOTION-20

## 7. Strengths to keep (don't regress these)

- A disciplined motion token set (120/180/200/240 ms, one ease-out), with complete reduced-motion support.
- Cached revisits paint still; the sidebar and tab indicators slide on one curve; skeleton → content is a real
  cross-fade; there is no dark flash on load.
- Excellent chart tooltips, and an Expand dialog that restores focus and scroll.
- The balance entry keyboard contract (select-all, "=" arithmetic, Enter walks, Esc reverts, Ctrl+S) and
  paste-a-column with a flash.
- Drag-to-reorder with live announcements, the saved-row flash and Undo; Activity's arm-then-Undo.
- Capped tables with pinned headers and totals; the dividend months glide.
- Deep links (`?section`, `#hash`, `?whatif`) land on the exact view; the Taxes sticky save bar and live preview.

## 8. Ruled out / environment

- The ~2 s stalls seen on some requests are local only. On this Windows box, a new database connection to
  `localhost` takes ~2.1 s, versus 33 ms to 127.0.0.1. No performance finding is claimed. The layout jumps
  those stalls exposed are real, and they reproduce with replayed 100–200 ms responses.
- The DEV badge, the "scheduler not running" wording, and the audit fence's 503 messages are environment
  artifacts. Only where the fence's errors appear was judged.
- The Projection chart does NOT scroll away from its sliders: it is sticky. The "dead column" was an artifact of
  a full-page screenshot.

## 9. Correctness aside (not polish, but you'll want to know)

- **Portfolio "Same deposits in VOO" benchmark:** VOO's price history in the production data starts
  2025-08-11 (verified in the database), so for the first 95 of 155 weeks the benchmark line equals cost basis.
  That makes the All-range headline "Ahead of the same deposits in VOO by $263.7K" overstated. Fix: backfill
  VOO history, or leave the benchmark blank before its data and say "since Aug 2025". (PE, ruled-out section)
