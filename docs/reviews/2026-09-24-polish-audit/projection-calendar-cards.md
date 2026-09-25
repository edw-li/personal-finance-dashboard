# Projection · Calendar · Credit cards — polish findings

Pages/areas covered (1440×900 both themes; spot checks 1920×1080 and 1280×800):
- **Projection** (/projection): Planning workspace and Historical trend tabs (tab fade, 1Y/5Y/10Y/40Y chips, hover); the five outcome tiles (and their ⓘ receipt panel); the chart — Today's/Future dollars, Next milestone/Full horizon, Linear/Log, legend, hover tooltip, click-to-pin a month, Expand dialog, Table twin, the 1 in 10 / Half / 9 in 10 markers and the vertical rules; Planning assumptions — dragging sliders (mouse, with and without mid-drag pauses), typing into boxes + Enter, every "Baseline …" link, Use my budgets, Reset to baseline, Hide/Show assumptions, Include scheduled vests, Plan until, both Retires month inputs (filled via keyboard → retirement rules, drawdown, Money lasts verdict), ⓘ bubbles in the column; sticky behaviour of the chart and the tile band while scrolling; Compare your scenarios — naming, Pin this scenario ×2 (localStorage only), Unpin chips, Copy link (toast).
- **Calendar** (/calendar): Grid and List; ‹ Today ›, month box, cached month paging (film); day cells (click → active), day-number → day drawer (open/expand row/close); chips (hover, click → popover in rows 1–5, left/right columns, "Your figure" form opened, not saved); week gutters; cash-flow tiles; legend and notes; Add event (dock form opened, not saved); Add to calendar (.ics) (download in 400 ms). "+N more" was not reachable (see the last section).
- **Credit cards** (/credit-cards): Rewards / Credit lines / Manage tabs (films); WHOSE chips (All/Grace, incl. on Manage); KPI tiles; Rewards matrix — Multiplier/Effective %, tie pills, ⁺ markers (hover), capped box with pinned header + totals, card column header → card detail → ✕ Back to matrix (films, focus + scroll checks); Edit multipliers (opened, cell inspector, Cancel); "Is each card worth keeping?" (scrolled in, bar hover); Credit line history (legend pager); Manage — roster Edit (not saved), drag-handle hover (no drop), Categories & weights.

## Findings (most impactful first)

### PCC-01 · Dragging a planning slider is blind until you let go
- Where: Projection › Planning workspace › Planning assumptions › any slider (/projection) · both themes, all widths
- What happens: While the thumb moves, the number box, the source badge and the chart all stay on the OLD value. Dragging Annual return to 37.3% still showed "5" and "PLANNING DEFAULT"; dragging Annual spend to $148,000 left the box on its placeholder "65668.01" (the slider's own aria-valuetext already said $148,000.00). No request is sent during a continuous drag — the box/chip only catch up after a ≥300 ms pause or on release, and the chart ~200 ms (one request) after that. Then the five outcome tiles swap their text silently (FI date "Jun 2031 → Apr 2028", no cue), ~700 px away from the hand.
- Evidence: shots/projection-calendar-cards/t3-drag-return-dark/04-711ms.jpg (thumb at 37%, box "5"), shots/projection-calendar-cards/t3-drag-return-dark/08-1108ms.jpg (after release), shots/projection-calendar-cards/v1-drag-moving-light.png
- Cause: src/sandbox/SliderBox.tsx:128-135 and :175 — badge, delta chip and box read the committed URL `value`; the transient `drag` feeds only the range (:73). src/sandbox/useSandbox.ts:221-222 restarts the debounce timer on every input event (debounceMs 300, src/pages/ProjectionPage.tsx:38), so a moving drag never fires.
- Polish: While the pointer is down, show `drag` in the box and the delta chip (display-only); run previews on a throttle (leading edge + every ~250 ms; responses take 180–225 ms) instead of a trailing debounce so the chart follows the thumb; briefly tint the tiles whose value changed.
- Impact: The page's main gesture becomes "steer and watch" instead of "guess, release, wait, look up".
- Size: M · Confidence: high

### PCC-02 · Slider tracks span the API's whole fence, so realistic values live in a few pixels
- Where: Projection › Planning assumptions sliders (/projection)
- What happens: Tracks are 316 px at 1440. Annual return runs −50…+50% (0.32 pp per pixel; the plausible 0–12% band is 38 px) — a 96 px drag jumped 5% → 37.3%. Annual spend runs $1k…$1M (~$3,200 per px; the user's $65.7k thumb sits 20 px from the left end) — a 30 px drag added $82,332. Monthly contribution $0…$50k (thumb at 13%), contribution growth 0–25% (12%), volatility 0–100%, inflation −10…+25%. Most thumbs crowd the left edge.
- Evidence: shots/projection-calendar-cards/t1-projection-dark-1440.png, shots/projection-calendar-cards/t3-drag-return-dark/08-1108ms.jpg (+32.3 pp), shots/projection-calendar-cards/v1-drag-moving-light.png
- Cause: src/components/projection/projectionScenario.ts:80-92 — SLIDER min/max are the server's validation fences.
- Polish: Give each track a comfortable range around its baseline (e.g. return 0–12%, spend 0.5×–2× baseline, contribution 0–3× baseline, volatility 0–30%, inflation 0–8%) and keep the full fence for typed values (or a log track for money).
- Impact: Dragging becomes precise enough for "what if I spend $5k more" without typing.
- Size: S · Confidence: high

### PCC-03 · In the default "Next milestone" view every change relabels the x-axis and re-wipes the chart's right side
- Where: Projection › Projected investable balance (/projection, Next milestone) · both themes
- What happens: The window ends 24 months after the constant-return FI month, so nearly every knob moves it. On each result the month ticks jump (5%→6%: "…May '33 Jan '34" → "…Jul '32 Feb '33"; 5%→9%: the axis end Jan '34 → Jul '32), the series are cut back to ~2/3 of the width leaving the right third empty, then regrow over ~250 ms. The 1 in 10 / Half markers and the vertical rules jump instantly while the lines are still moving, so for ~300 ms they float off the target line (same on the Future-dollars and Full-horizon toggles). The identical change in Full horizon (fixed window) morphs smoothly.
- Evidence: shots/projection-calendar-cards/m-t18.png (5%→9%, frames 198–617 ms), shots/projection-calendar-cards/m-t12-milestone.png, shots/projection-calendar-cards/m-t12-full.png (control)
- Cause: src/components/projection/projectionDisplay.ts:73-83 (end = reach + 24 months); src/pages/ProjectionPage.tsx:60-61, 76-77 bake the window into the option and pass no `zoomWindow` to ChartCard, so src/components/EChart.tsx:425-441 rebuilds with notMerge instead of taking its animated dataZoom fast path (EChart.tsx:345-379).
- Polish: Snap the milestone window's end to whole years and move it only when the milestone leaves it; pass the window as `zoomWindow` so a real change morphs; let the markers ride the series' update (or fade them during the 300 ms).
- Impact: Tweaking an assumption reads as "the line moved", not "the chart redrew itself".
- Size: M · Confidence: high

### PCC-04 · Calendar: ~65 px of blank space between the weekday names and the first week
- Where: Calendar › Grid (/calendar) · all widths, both themes
- What happens: The SUN…SAT / WEEK header row is 76 px tall for 15 px of text; the first week starts 65 px below the labels. It reads as a missing row and pushes the grid and legend ~60 px down.
- Evidence: shots/projection-calendar-cards/t1-calendar-dark-1440.png, shots/projection-calendar-cards/t1-calendar-light-1440.png, shots/projection-calendar-cards/c1-cal-dark-1920.png
- Cause: src/pages/CalendarPage.css:331-334 — `grid-auto-rows: minmax(76px, auto)` also sizes the header (rows are `display: contents`, so the weekday cells are row 1 of the same grid; computed rows "76px 76px …").
- Polish: `grid-template-rows: auto;` on `.cal-grid` (template rows govern row 1, auto-rows the weeks).
- Impact: The month sits directly under its weekday names; ~60 px more grid above the fold.
- Size: S · Confidence: high

### PCC-05 · Rewards matrix card headers: bold monospace, wrapping to 3–7 uneven lines
- Where: Credit cards › Rewards › Rewards matrix column headers (/credit-cards)
- What happens: Card names are set in bold monospace (the figures font), right-aligned, in columns 55–130 px wide at 1440 → 4–5 lines with different breaks ("Apple / Card / $0.00 · / cash / Joint"); at 1280 up to 7 lines ("Wells / Fargo / Active / Cash / $0.00 · / cash / Edward"); at 1920 the columns range 81–209 px. Lines start with the middot ("· cash"), fees carry cents ("$0.00 · cash").
- Evidence: shots/projection-calendar-cards/t1-credit-cards-dark-1440.png, shots/projection-calendar-cards/v3-cards-1280-dark.png, shots/projection-calendar-cards/t1-credit-cards-light-1440.png
- Cause: src/components/creditcards/RewardsMatrix.tsx:220-242 — the header cells carry `className="num"` (numeric monospace) and the button inherits it (matrix.css:22-31 `font: inherit; font-weight: 600; text-align: right`); :230 formatCurrency(annual_fee).
- Polish: Proportional font for the names (mono only for figures), equal column widths (`table-layout: fixed`), the name clamped to 2 lines over one muted meta line ("$395 · miles · Edward"), whole-dollar fees.
- Impact: The header reads as a tidy row of card names instead of a ragged block.
- Size: S · Confidence: high

### PCC-06 · "Is each card worth keeping?" truncates names beside empty room and leaves bars unlabeled
- Where: Credit cards › Rewards › Is each card worth keeping? (/credit-cards) · 1440 and 1920, both themes
- What happens: Names are cut at 118 px — "Wells Fargo Active C…", "Wells Fargo Autogra…", "Bank of America Cus…", "Citi Costco Anywher…" — even at 1920 where the plot is ~1,450 px wide and its −$60…$0 half holds one bar. Only the $0 stubs are labelled; the green/red bars give their value only on hover ("$116.87").
- Evidence: shots/projection-calendar-cards/k3-worth-hover-dark.png, shots/projection-calendar-cards/v3-worth-1920-dark.png
- Cause: src/components/creditcards/cardValueChartOptions.ts:79 (`axisLabel: { width: 118, overflow: 'truncate' }`); :88-97 (labels only on zero rows).
- Polish: Size the label column to the longest name (~190 px here) or wrap to two lines; end-label every bar with its net ("+$116.87/yr", "−$54.07/yr").
- Impact: The verdict chart can be read at a glance, no hovering bar by bar.
- Size: S · Confidence: high

### PCC-07 · The "Half" reach label is always struck through by the lines
- Where: Projection › chart markers (/projection) · both themes, all views
- What happens: "Half" is printed under its dot, and that dot by definition sits where the median path crosses the FI target — so the blue Projected/Median lines run straight through the word every time. "9 in 10" gets the same treatment in Full horizon, Log and retirement views.
- Evidence: shots/projection-calendar-cards/t5-markers-dark@2x.png, shots/projection-calendar-cards/t1-projection-light-1440.png, shots/projection-calendar-cards/t13-proj-retire-1440.png
- Cause: src/components/projection/projectionChartOptions.ts:135-139 ('Half' placed 'bottom'); src/charts/markLine.ts:131-137 (mark labels have no halo/background).
- Polish: Give reach-mark labels a halo (textBorderColor = surface, textBorderWidth 3) or a small pill background; keep all three above the target line with a short leader where they crowd.
- Impact: The chart's three most important annotations become legible without hovering.
- Size: S · Confidence: high

### PCC-08 · Projection legend: four identical blue squares
- Where: Projection › chart legend (/projection) · both themes
- What happens: Projected, Median path, Middle 80% of paths and Middle 50% of paths all show the same blue rounded square, so the two lines and the two bands can't be told apart (clicking to toggle is guesswork). The tooltip already draws line swatches vs wash swatches for the same series.
- Evidence: shots/projection-calendar-cards/t5-legend-dark@2x.png, shots/projection-calendar-cards/t6-hover-mid-dark.png (tooltip grammar)
- Cause: src/charts/theme.ts:84-89 (global `legend.icon: 'roundRect'`) + plain names in src/components/projection/projectionChartOptions.ts:320-326.
- Polish: Per-entry legend icons: a line for Projected, a hairline for Median path, wash squares at the bands' own 0.18/0.10 opacities, a dashed line for FI target (the net-worth trend already passes `{ name, icon }`, :394-397).
- Impact: The fan chart explains itself; legend toggles become predictable.
- Size: S · Confidence: high

### PCC-09 · Calendar chips lose what the event is (server cuts labels at 24 characters)
- Where: Calendar › Grid chips (/calendar) · all widths
- What happens: Card events arrive pre-shortened — "Wells Fargo Autograph Visa anniversary" becomes "Wells Fargo Autograph …", so the word that says what happens is the part removed. At 1440 CSS clips it again ("Wells Fargo Autograp…", a double ellipsis); at 1920 the 211 px cell still shows the server's cut. "RSU vest · 4 grants" shows as "RSU vest · 4…" at 1440 and "R." with the add-event dock open. Cells are 76 px tall with one chip, so vertical room is there.
- Evidence: shots/projection-calendar-cards/t1-calendar-dark-1440.png, shots/projection-calendar-cards/c1-cal-dark-1920.png, shots/projection-calendar-cards/c3-add-form-dark.png
- Cause: backend/app/services/calendar/model.py:56, 67-75 (SHORT_LABEL_MAX = 24, `shorten`); backend/app/services/calendar/generators/cards.py:59 (`f"{card.name} anniv."` — type last); src/pages/CalendarPage.css:82-106 (single-line chip).
- Polish: Send the full label and let CSS ellipsize to the real width; lead with the type ("Anniv. · Wells Fargo Autograph Visa"); allow a two-line chip (label over amount) when a cell holds ≤2 chips.
- Impact: Every chip says what it is without a hover or a click.
- Size: M · Confidence: high

### PCC-10 · Retirement months: raw "--------- ----" boxes, money styling, 1,400 px from the tile that asks for them
- Where: Projection › Planning assumptions › Retires — Edward / Grace; Money lasts tile (/projection)
- What happens: The empty month inputs show the browser's "--------- ----" placeholder, right-aligned in the monospace money style; filled, they read like an amount ("July 2035" in bold mono), with no clear button. The Money lasts tile says "Set retirement months to see whether the money lasts", but the inputs are the last controls of a 1,459 px column, ~1,400 px below the tile, with no link to them.
- Evidence: shots/projection-calendar-cards/t8-month-empty-dark.png, shots/projection-calendar-cards/t8-month-filled-dark.png, shots/projection-calendar-cards/t1-projection-dark-1440-full.png
- Cause: src/components/projection/ScenarioPanel.tsx:361-382 (`type="month"` wearing `.field-input`); the tile prints the server's reason via src/components/projection/projectionDisplay.ts:144-147 with no action.
- Polish: Empty state in words ("Works throughout · set a month") or a "Set retirement month" button that reveals the picker; left-aligned proportional month text with a × to clear; make the tile's sentence a link that scrolls to and focuses "Retires — Edward".
- Impact: The one input that unlocks the Money lasts verdict is findable and looks like a date.
- Size: S · Confidence: high

### PCC-11 · "Hide assumptions" pushes the chart down and hides that a scenario is live
- Where: Projection › Planning assumptions › Hide assumptions (/projection) · both themes
- What happens: The panel becomes a full-width 110 px card holding one button, placed ABOVE the chart, so the chart drops 129 px (top 280 → 409) and its x-axis falls below a 900 px fold. The swap is instant, with one frame of a half-width canvas. The collapsed card doesn't say overrides are active (a $148,000 spend override → FI target $3.7M, nothing said), and Reset disappears with it.
- Evidence: shots/projection-calendar-cards/t7-hidden-dark.png, shots/projection-calendar-cards/m-t7-hide.png, shots/projection-calendar-cards/v1-hidden-light.png
- Cause: src/pages/ProjectionPage.css:116-118 (`order: -1` + one-column grid); src/sandbox/SandboxPanel.tsx:93-95 (closed state renders only the header; ScenarioPanel passes no `closedHint`).
- Polish: Collapse into a slim bar or into the chart header ("Assumptions · 2 changed · Show · Reset"), list active overrides as chips, and animate the column change.
- Impact: Hiding the knobs gives the chart more room, not less, without losing track of the scenario.
- Size: M · Confidence: high

### PCC-12 · Setting a retirement month grows the pinned tile band and drops one value off the row
- Where: Projection › outcome tiles (/projection?whatif=retire:1:2035-07&whatif=retire:2:2037-01) · 1440 (fits at 1920)
- What happens: Money lasts gains a "Borderline" pill that wraps ABOVE its value plus a 2-line orange sentence: the sticky band grows 133 → 170 px (the chart drops 37 px; pinned chrome becomes 213 px of a 900 px viewport) and "86.0%" sits 18 px lower than the other four values. FI ratio, meanwhile, has no sub-line and its tile is half empty.
- Evidence: shots/projection-calendar-cards/t13-proj-retire-1440.png, shots/projection-calendar-cards/t8-retire-top-dark.png
- Cause: src/components/StatTile.tsx:121-131 (the badge rides the label row and wraps in a 217 px tile); src/pages/ProjectionPage.tsx:122-123, 134-136.
- Polish: Put the verdict pill beside the value or in the sub-line, clamp sub-lines to 2 lines, and give FI ratio a sub-line (e.g. "$802K to the target").
- Impact: The band keeps one height and one baseline whatever the scenario.
- Size: S · Confidence: high

### PCC-13 · "Back to matrix" throws away the reader's place and focus
- Where: Credit cards › Rewards › card column header → card detail → ✕ Back to matrix (/credit-cards?card=…) · both themes
- What happens: Opened from mid-page (scrollY 250 dark / 300 light), Back returns to scrollY 0 and focus lands on <body> — the intended hand-off to the column header never happens. The button uses a close glyph (✕) for a back action.
- Evidence: shots/projection-calendar-cards/m-k2-drill.png, shots/projection-calendar-cards/k1-detail-dark.png
- Cause: src/pages/CreditCardsPage.tsx:272-276 (`setTimeout(…focus(), 0)` runs before the matrix re-renders after the URL write; no scroll restore); src/components/creditcards/CardDetail.tsx:307-309 (✕ label).
- Polish: Remember scrollY (and the matrix box's scrollTop) on drill-in; restore both and focus the header in a layout effect once the matrix is mounted; "← Back to matrix".
- Impact: Comparing cards one after another no longer means re-finding the matrix each time.
- Size: S · Confidence: high

### PCC-14 · Event popover grows off-screen for "Your figure"; its buttons wrap
- Where: Calendar › chip → details popover (/calendar) · 1440, both themes
- What happens: Direction is chosen by row only; opening "Your figure" in a row-3 popover stretches it to 940 px (Payday) / 992 px (RSU vest) on a 900 px viewport — Save figure / Cancel are off-screen. In the 260 px bubble the Monthly update actions wrap ("Open / Monthly / update →", "Mark / done", "Your / figure"; heights 51/42/26/42 px). The field says "Amount you paid" even on a payday or an RSU vest.
- Evidence: shots/projection-calendar-cards/c4-your-figure-dark.png, shots/projection-calendar-cards/v2-your-figure-light.png, shots/projection-calendar-cards/v2-mu-popover-light.png
- Cause: src/components/calendar/CalendarGrid.tsx:237-247 (up/right by row/column index); src/pages/CalendarPage.css:132-144 (fixed 260 px) and :182-192 (actions free to wrap); src/components/calendar/EventDetails.tsx:171-205 (inline form), :180 (label).
- Polish: Measure available space and flip/shift (or scroll the bubble into view as it grows); ~300 px width with `white-space: nowrap` actions ("Open …" on its own line); direction-aware wording ("Amount received").
- Impact: Overrides can be entered without chasing a floating bubble down the page.
- Size: S · Confidence: high

### PCC-15 · "Add event" squeezes the month into unreadable chips and starts on the 1st
- Where: Calendar › Add event (docked form) (/calendar) · 1440
- What happens: The dock narrows the page to ~750 px: tiles reflow 3 + 2 with an empty slot, cells shrink to ~85 px and chips turn into "R. ~+$48.1k", "E… ~$10.4k", "Pa… +$3.6k", "Monthly u…". The Date box defaults to Sep 1, not today/the selected day (24 was the outlined active day).
- Evidence: shots/projection-calendar-cards/c3-add-form-dark.png
- Cause: src/pages/CalendarPage.tsx:336-343 (`date: day ?? monthRef.current`, the month's 1st); the 84 px week gutter keeps its width at narrow sizes (src/pages/CalendarPage.css:331-334).
- Polish: Default the date to the active day; while the dock is open drop the week gutter and let chips fall back to colour bar + amount (or two lines) — or open the form as a popover on the selected day.
- Impact: The calendar stays readable while you add to it, and the form starts where you are.
- Size: M · Confidence: high

### PCC-16 · Today and the selected day look alike
- Where: Calendar › Grid (/calendar) · both themes
- What happens: Today is a 1 px accent border; the active (selected) day a 2 px accent outline. After clicking another day there are two blue boxes (10 and 24) and nothing says which one is today.
- Evidence: shots/projection-calendar-cards/c4-active-vs-today-dark.png, shots/projection-calendar-cards/c3-drawer-expanded-dark.png
- Cause: src/pages/CalendarPage.css:60-62 (`.cal-day-today` border) and :376-380 (`.cal-day-active` outline).
- Polish: Mark today with a filled accent badge behind its date number; keep the outline for the keyboard/selection cursor.
- Impact: The eye finds "now" instantly in any month.
- Size: S · Confidence: high

### PCC-17 · Calendar cash-flow tiles have a ragged bottom edge
- Where: Calendar › cash-flow strip (/calendar) · all widths, both themes
- What happens: Scheduled in / Scheduled out are 78 px tall inside 100 px grid cells while the other three are 100 px — a 22 px step (82 vs 105 at 1920, 74 vs 96 at 1280).
- Evidence: shots/projection-calendar-cards/t1-calendar-dark-1440.png, shots/projection-calendar-cards/c1-cal-dark-1920.png
- Cause: src/components/calendar/CashflowStrip.tsx:92-194 wraps each StatTile in `<div role="group">`; the grid stretches the wrapper (measured 100 px), not the tile inside (78 px).
- Polish: `.cal-strip > [role=group] > .stat-tile { height: 100% }` (or `display: contents` on the wrappers); optionally a sub-line for the two ("2 paydays", "no fees due").
- Impact: An even strip, like every other page's KPI row.
- Size: S · Confidence: high

### PCC-18 · Numbers: cents on estimates, two "approximately" glyphs, three compact styles
- Where: all three pages
- What happens: Estimates and targets print cents: FI target $1,641,700.25 / $2,000,000.00, tooltip "$1,405,944.27", bands "$1,031,060.45 – $1,864,601.12", pin label "Spend $80,000.00", "Use my budgets · $65,736.00/yr"; Calendar "~$48,060.12" and "~$2,796.22" next to "≈ $5,478" (whole dollars, a different glyph), "Scheduled out $0.00"; Credit cards "Total credit line $133,850.00", "Optimal rewards (est.) $1,109.08/yr", "$0.00 · cash", limits "$33,000.00". Compact forms disagree: "≈ $131.0K" (Projection), "$24.5K/yr" (Credit cards), "~+$48.1k" (Calendar); axes mix "$500.0K" and "$1.00M". Assumption boxes show raw placeholders "6711.63" / "65668.01" beside "Baseline $6,711.63".
- Evidence: shots/projection-calendar-cards/t1-projection-dark-1440.png, shots/projection-calendar-cards/t1-calendar-dark-1440.png, shots/projection-calendar-cards/t1-credit-cards-dark-1440.png
- Cause: formatCurrency on estimates (src/pages/ProjectionPage.tsx:118-127, src/pages/CreditCardsPage.tsx:411-435, src/components/calendar/CashflowStrip.tsx:63-64 vs formatWholeDollars at :129); src/components/calendar/cashflow.ts:28-33 (lowercase k) vs formatCurrencyCompact (uppercase K, trailing ".0"); src/sandbox/SliderBox.tsx:176 (raw placeholder).
- Polish: Whole dollars (or $1.64M) for projections, targets, estimates and limits; one estimate glyph (≈); one compact formatter ("$131K", "$24.5K", "$48.1K"); placeholders formatted like the baseline link.
- Impact: Figures read at the precision they deserve and look the same on every page.
- Size: M · Confidence: high

### PCC-19 · Roster's one form: always open for Add, silently reused off-screen for Edit
- Where: Credit cards › Manage › Card roster (same pattern in Categories & weights) (/credit-cards?section=manage) · both themes
- What happens: The empty 9-field add form permanently sits above the table, pushing the roster ~240 px down. Clicking Edit on a lower row loads that card into the same form — which is off-screen (form top at −186 px dark / −216 px light); only a faint row tint and the focused Edit button change. No scroll, no focus into the form.
- Evidence: shots/projection-calendar-cards/k6-edit-dark.png, shots/projection-calendar-cards/v2-edit-light.png, shots/projection-calendar-cards/k2-tab-Manage-full-dark.png
- Cause: src/components/creditcards/CardsPanel.tsx:139-154 (`startEdit` sets state only).
- Polish: Collapse the add form behind "+ Add card" (the header button already routes here); on Edit, scroll the form into view and focus Card name — or edit inline in the row.
- Impact: Editing is visibly one click, and Manage opens on the list itself.
- Size: M · Confidence: high

### PCC-20 · The comparison table doesn't show what changed
- Where: Projection › Compare your scenarios (/projection?whatif=…)
- What happens: Baseline and Scenario are printed side by side for 12 rows with no Δ and no emphasis — with two knobs moved, "Horizon 30 → 30" looks exactly like "FI date Jun 2031 → Sep 2036" and "Reach FI 100.0% → 93.6%".
- Evidence: shots/projection-calendar-cards/t7-compare-changed-dark.png, shots/projection-calendar-cards/t15-pinned-compare2-dark.png
- Cause: src/pages/ProjectionPage.tsx:173-175 renders CompareTable without its `delta` prop (the component already supports a Δ column: src/sandbox/CompareTable.tsx:74, 98-110).
- Polish: Tint scenario cells that differ from baseline and add a compact Δ ("+5 yr 3 mo", "−6.4 pp", "+$358K").
- Impact: "What did my change do?" jumps out of the table.
- Size: S · Confidence: high

### PCC-21 · "Baseline 5%" on an untouched knob creates a fake scenario
- Where: Projection › each assumption's "Baseline …" link (/projection)
- What happens: Clicked while the knob already sits at baseline, it swaps the "PLANNING DEFAULT" badge for a "0.0 pp" chip, writes ?whatif=annual_return:0.05 to the URL and enables Reset and Pin — the page now claims a scenario identical to the baseline.
- Evidence: shots/projection-calendar-cards/t7-baseline-click-dark.png
- Cause: src/sandbox/SliderBox.tsx:183-195 (`onChange(actual, true)` stores the baseline value instead of clearing the override).
- Polish: Make the link clear the override (`onChange('', true)`) and hide/disable it while the knob is at baseline.
- Impact: Reset, Pin and the URL only light up when something really changed.
- Size: S · Confidence: high

### PCC-22 · Assumption deltas are coloured good/bad by sign
- Where: Projection › assumption delta chips (/projection)
- What happens: +$14,331.99 Annual spend and +2.0 pp Inflation show in the positive green, although both make the plan worse.
- Evidence: shots/projection-calendar-cards/t7-spend80k-dark.png
- Cause: src/sandbox/SliderBox.tsx:131-134 (DeltaChip without `invert`, tone from the sign).
- Polish: Neutral (muted) chips for inputs — the outcome tiles carry the judgement — or invert for spend, inflation and volatility.
- Impact: Colour stops contradicting the outcome it produces.
- Size: S · Confidence: high

### PCC-23 · Pinned scenarios: the legend's second row sits on the axis and end labels clip
- Where: Projection › chart with two pinned scenarios (/projection)
- What happens: With 8 entries the plain legend wraps; its second row ("Spend $80,000.00") is drawn over the "$4.00M" axis label, and the pin's end label is cut at the card edge ("Spend $80,000.(").
- Evidence: shots/projection-calendar-cards/t15-pinned-chart-dark.png
- Cause: src/charts/legend.ts:11-18 (plain legend up to 8 entries at top: 0) with the fixed 'fanEndLabel' grid (src/components/projection/projectionChartOptions.ts:287-290, 332).
- Polish: Reserve a second legend row when pins exist (grid top +20 px) or scroll the legend; ellipsize end labels to the gutter; shorter default pin names ("Spend $80K").
- Impact: Comparing pinned plans stays clean.
- Size: S · Confidence: high

### PCC-24 · Log axes draw glaring gridlines in the dark theme
- Where: Projection › Historical trend (always log) and Planning chart › Log (/projection) · dark only
- What happens: The $10K/$100K/$1M/$10M split lines render near-white and the labels dimmer — unlike every linear chart's subtle grid. The light theme looks right.
- Evidence: shots/projection-calendar-cards/m-t9-grid.png, shots/projection-calendar-cards/t6-log-dark/09-409ms.jpg, shots/projection-calendar-cards/v1-trend-light.png (control)
- Cause: src/charts/theme.ts:72-83 — buildTheme styles `categoryAxis` and `valueAxis` only; ECharts themes style `logAxis` separately, so log axes fall back to the library defaults.
- Polish: Add `logAxis` (and `timeAxis`) blocks identical to `valueAxis`.
- Impact: The trend tab stops looking like a different app in dark mode.
- Size: S · Confidence: high

### PCC-25 · Month paging is a hard cut
- Where: Calendar › ‹ › / Today / month box (/calendar)
- What happens: The neighbouring month is already cached, so the swap is instant — but tiles, grid and gutters change in one frame with no directional cue.
- Evidence: shots/projection-calendar-cards/m-c2-next2b.png
- Cause: src/pages/CalendarPage.tsx:225-245 (showMonth/stepMonth only rewrite the scope).
- Polish: A 150–200 ms cross-fade with a ±12 px slide in the paging direction for ‹ ›; none for Today/jump or under reduced motion.
- Impact: Paging feels like turning a page, and the direction is legible.
- Size: S · Confidence: medium

### PCC-26 · Calendar popover and day drawer skip the house motion
- Where: Calendar › chip popover; day drawer (/calendar)
- What happens: The event popover appears at 0 ms while the app's other bubbles (ⓘ, export menu) rise 4 px and fade in; the day drawer slides in but vanishes instantly on close, and the assistant launcher floats over the drawer's footer.
- Evidence: shots/projection-calendar-cards/c3-chip-popover-dark.png, shots/projection-calendar-cards/k5-drawer-fab.png
- Cause: src/components/panels.css:864-870 (the pop-in rule's list lacks `.cal-popover`); src/components/assistant/assistant.css:407-409 (entry keyframes only; DayDrawer unmounts).
- Polish: Add `.cal-popover` to the pop-in rule (rising downward for `-up`); give the drawer an exit like detail-panel-out; hide the launcher while it is open.
- Impact: Calendar surfaces feel like the rest of the app.
- Size: S · Confidence: high

### PCC-27 · List view drops the colour key and a scannable amount column
- Where: Calendar › List (/calendar?view=list)
- What happens: Rows are plain text: no source colour bars (the legend under the list maps to nothing), amounts trail the labels ("Payday — Edward & Grace +$4.1k — Edward $3,568.36, Grace $568.75", compact and cents in one line), dates lack the weekday ("SEP 15, 2026"), ~500 px of empty right side.
- Evidence: shots/projection-calendar-cards/c3-list-dark.png
- Cause: src/pages/CalendarPage.tsx:678-720.
- Polish: Reuse the day drawer's row grammar (colour bar · label · right-aligned tabular amount), add the weekday and mark today.
- Impact: The list becomes a real agenda you can scan down.
- Size: S · Confidence: high

### PCC-28 · Card detail: utilization flashes "needs a snapshot…", buttons wrap, columns end unevenly
- Where: Credit cards › card detail (/credit-cards?card=…)
- What happens: For the first ~100–300 ms of every open, Utilization reads "Utilization needs a snapshot balance and a current limit." then swaps to "$0.00 of $40,000.00 = 0.0% …" (text and height jump). In Recurring credits a longer label squeezes "Resets Jan 1" / "Counts ✓" onto two lines, so rows differ in height; the two cards end 43 px apart (838 vs 795).
- Evidence: shots/projection-calendar-cards/m-k2-drill.png (frames 189 → 251 ms), shots/projection-calendar-cards/k1-detail-dark.png
- Cause: src/components/creditcards/CardDetail.tsx:84, 97-124, 545-546 (loading shares the "unavailable" copy); src/components/creditcards/carddetail.css:22-34 (credit actions shrink and wrap).
- Polish: A neutral "Checking the latest balance…" line (or reuse the page's already-loaded accounts) while loading; `flex-shrink: 0; white-space: nowrap` on the credit actions.
- Impact: The detail opens settled, with no false "missing data" message.
- Size: S · Confidence: high

### PCC-29 · WHOSE chips stay live on Manage but do nothing
- Where: Credit cards › Manage (/credit-cards?section=manage&owner=2)
- What happens: Choosing Grace highlights the chip but the roster still lists all 8 cards (only the ⓘ explains why), and the add form's Owner still defaults to Edward.
- Evidence: shots/projection-calendar-cards/k3-manage-grace-dark.png
- Cause: src/pages/CreditCardsPage.tsx:366-375 (ScopeBar rendered for every section); CardsPanel's fresh form follows the primary person.
- Polish: Dim/disable the chips on Manage with an inline "Manage lists every card", and default a new card's owner to the chosen person.
- Impact: No control on screen that silently does nothing.
- Size: S · Confidence: high

### PCC-30 · Credit line legend pages at 9 entries and hides the Total
- Where: Credit cards › Credit lines › Credit line history (/credit-cards?section=lines)
- What happens: 8 cards + Total → a scroll legend with a "1/2" pager; "Bank of Americ" is cut mid-word and Total — the headline line — is on page 2.
- Evidence: shots/projection-calendar-cards/k2-tab-Creditlines-dark.png
- Cause: src/charts/legend.ts:14 (`scroll` above 8 entries).
- Polish: A two-row plain legend (grid top +20 px), Total first, or shorter names.
- Impact: Every line on the chart is named without paging.
- Size: S · Confidence: high

### PCC-31 · Rewards matrix details: stray "·", native-title ⁺ notes, "3.00x" in edit mode, inspector far below
- Where: Credit cards › Rewards matrix (/credit-cards)
- What happens: Category sub-lines start with a stray "· " ("· $24.5K/yr") because the sub drops to its own line; the ⁺ condition mark is a tiny superscript explained only by a native title tooltip ("portal", ~1 s delay, no keyboard); in Edit multipliers every cell shows stored precision ("3.00x" vs "3x" in the read view) and the cell inspector opens below the capped box (top at 826 px of a 900 px viewport), far from the clicked cell.
- Evidence: shots/projection-calendar-cards/t1-credit-cards-dark-1440.png, shots/projection-calendar-cards/k3-edit-inspector-dark.png
- Cause: src/components/creditcards/RewardsMatrix.tsx:254-257 (+ matrix.css:15-20 block sub), :305-309 (`title`), :273 (`${draft.multiplier}x`), :334-388 (inspector after the box).
- Polish: Drop the leading "·"; use the app's InfoHint bubble for conditions; format drafts like read mode; anchor the inspector beside the selected cell (or above the box).
- Impact: The matrix reads clean and editing happens where you clicked.
- Size: S · Confidence: high

### PCC-32 · Secondary surfaces print machine values
- Where: Projection › chart › Table; FI date tile › ⓘ receipt panel (/projection)
- What happens: The table twin shows raw export cells — "839559.73", dates "2026-09-01" wrapping onto two lines, 4-line headers "PROJECTED (USD · 2026-09 DOLLARS)", horizontal overflow. The FI date receipt headline says "2031-06-01" (the tile says "Jun 2031"), and its components and "As of" are ISO dates too.
- Evidence: shots/projection-calendar-cards/t14-table-open-700-dark.png, shots/projection-calendar-cards/t17-receipt-dark.png
- Cause: src/components/ChartTable.tsx:31-36 (renders the ExportTable verbatim); src/utils/metricReceipt.ts:23-34 (no 'month' unit case → String(value)); src/components/details/MetricInspector.tsx:36-38 (raw as_of/period).
- Polish: Display-format the twin (currency, "Sep 2026", short headers + a unit caption) while CSV stays raw; add a month/date case to formatEvidenceValue.
- Impact: The "show me the numbers" surfaces read as well as the chart.
- Size: S · Confidence: high

### PCC-33 · Long month axes tick at odd strides
- Where: Projection chart (Full horizon / long milestone windows), Historical trend, Credit line history
- What happens: Sparse axes label every Nth month from the first one: "Sep '26, May '27, Jan '28, Sep '28…", "Sep '23, Jun '24, Mar '25, Dec '25…", "Jan '20, Jun '20, Nov '20…" — ticks never line up with years.
- Evidence: shots/projection-calendar-cards/t1-projection-dark-1440.png, shots/projection-calendar-cards/t9-trend-dark.png, shots/projection-calendar-cards/k2-tab-Creditlines-dark.png
- Cause: src/charts/monthLabels.ts:48 and :193 (sparse mode prints "Mmm 'YY" on every month and sets `interval: 'auto'`, so ECharts thins by index from the first month).
- Polish: In sparse mode label Januaries (or quarter starts) with an interval function → "2027 · 2028 · …".
- Impact: Multi-year charts read on calendar years.
- Size: S · Confidence: medium

### PCC-34 · The planning chart stays 400 px tall on big screens
- Where: Projection at 1920×1080 (/projection)
- What happens: The pinned chart is 400 px on every screen; at 1920×1080 the chart card ends ~200 px above the viewport bottom while the assumptions column runs on.
- Evidence: shots/projection-calendar-cards/t13-proj-1920.png
- Cause: src/pages/ProjectionPage.tsx:144 (`height={400}`).
- Polish: Size it to the viewport, e.g. clamp(400px, 100vh − 470px, 620px).
- Impact: The one chart the page is about uses the room it has.
- Size: S · Confidence: medium

### PCC-35 · Vest chips wear a "+" the week gutter ignores
- Where: Calendar › RSU vest chip vs week gutter (/calendar)
- What happens: "RSU vest · 4 grants ~+$48.1k" sits in a week whose gutter reads "+$4.1k" (paydays only); the chip's "+" reads as cash in, and the rule (vests counted separately) lives only in a tile's ⓘ.
- Evidence: shots/projection-calendar-cards/t1-calendar-dark-1440.png
- Cause: src/components/calendar/calendarView.ts:107-111 (vests signed like cash) vs src/components/calendar/CalendarGrid.tsx:58-70 (gutter excludes vests).
- Polish: Drop the "+" on vest chips ("~$48.1k vest"), or add a muted "vests ~$48.1k" line to that week's gutter.
- Impact: Chip, gutter and tiles tell the same story.
- Size: S · Confidence: medium

### PCC-36 · The floating assistant button sits on right-edge content
- Where: Projection assumptions column; Calendar day drawer; Credit cards matrix box and roster
- What happens: The 44 px launcher (fixed at 1361,821) covers the assumptions column's right-edge badges as they scroll by (e.g. "PLANNING DEFAULT"), floats over the day drawer's footer, and over the matrix box's scrollbar.
- Evidence: shots/projection-calendar-cards/k5-drawer-fab.png, shots/projection-calendar-cards/t1-credit-cards-light-1440.png
- Cause: the global launcher position (src/components/assistant/assistant.css) — not page-specific.
- Polish: Hide it while a drawer/dock is open and give right-edge scroll areas bottom padding (or tuck the launcher into the sidebar).
- Impact: Nothing important sits under a floating button.
- Size: S · Confidence: medium

### PCC-37 · The two pages' create buttons look different
- Where: Credit cards header "+ Add card" (primary blue, with "+") vs Calendar header "Add event" (secondary, no "+")
- What happens: The main create action of each page has a different weight and wording pattern.
- Evidence: shots/projection-calendar-cards/t1-credit-cards-dark-1440.png, shots/projection-calendar-cards/t1-calendar-dark-1440.png
- Cause: src/pages/CreditCardsPage.tsx:359-364 (`button-primary`) vs src/pages/CalendarPage.tsx:571-573 (`button`).
- Polish: One style for a page's primary create action.
- Impact: Small consistency win across pages.
- Size: S · Confidence: medium

## Strengths to keep (≤6 bullets — things that already feel great, so a fix doesn't break them)
- Projection's chart column and outcome band are sticky: while you scroll to Inflation/Volatility/Retires, the chart stays fully in view (top 184 px at 1440) until the column ends, and it falls back sensibly below 1000 px.
- The projection tooltip is excellent: line vs wash swatches, both band ranges, the month; pins draw as dashed reference lines with end labels, and Copy link confirms with a toast.
- The calendar prefetches ±1 month, so ‹ › are instant; chips truncate the label but never the amount; the drawer takes focus and Escape returns it.
- The rewards matrix's capped box (pinned header + pinned "Est. $/yr won" row) and the green best-cell + amber "tie" grammar read very well.
- "Worth keeping" colours by verdict with labelled "$0 · free to keep" stubs and a plain-words verdict footer.
- Tab panels (Projection, Credit cards) fade in once and keep their charts mounted — no entrance replays on revisits.

## Not reproduced / environment artifacts (what you ruled out)
- Lead 1, second half ("the chart scrolls out of view while adjusting lower sliders"): refuted — `.projection-chart-area` is sticky and stays fully visible down to the Retires inputs (shots/projection-calendar-cards/t2-proj-scroll900-dark-1440.png). The ~800 px "dead column" only exists in a static full-page render.
- "The chart re-animates from zero on every change": not the full entrance (it plays once per mount); what happens is the right-side retract/regrow of PCC-03 plus a 300 ms morph in which markers detach.
- Credit cards cold load took 2.6–3.5 s in three runs, each time because ONE of its six parallel GETs took 2.1–2.7 s — a different endpoint each run (rates twice, spending matrix once): shared-backend contention, not claimed. (Design note: Promise.all means one slow request holds the whole page.)
- One direct load of /projection?section=trend (light) showed "The scenario could not be computed"; four re-runs were clean — a backend blip. Worth knowing: the Historical trend tab cannot render if the planning projection fails, and the wording then talks about a "scenario".
- "+N more" never appears with the real data (max 3 events on a day in 2023–2028 because paydays and vests fold); the day drawer was exercised via the day number instead.
- Not saved (fenced / by design): Add event, Your figure, Hide/Mark done, Edit multipliers, roster Edit/reorder drop. Native month/date pickers can't be captured headless. The sidebar's DEV badge is the local env flag.
