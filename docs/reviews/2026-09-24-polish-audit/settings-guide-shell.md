# Settings · Guide · Shell — polish findings

Pages/areas covered (1440×900 dark + light as the baseline; spot checks at 1920×1080, 1280×800 and 1366×768; compact density on Settings and Guide):
- **Settings** (/settings): all five tabs and the switches between them (filmed). Household: Household card (Rename editor, Add member, Marriage date); Spending categories (form, capped table, row hover, grip cursor, Kind picker, Edit, Retire); Accounts (form, grouped capped table, Edit on a low row); Portfolio accounts (owner selects). Planning: Contribution limits (year chips 2025/2026/2027, Clone), Plan assumptions. Account: Appearance (Theme, Density, Chart patterns, Landing page), Password. Integrations: Price refresh, Assistant, Calendar feed. Data: Import, Backups & snapshots, Restore (looked only), Data health, System, Activity (View report, scroll box). Deep links (#limits, #calendar, #activity), ghost skeletons, info-hint bubbles. Saves were fenced; only error *presentation* was judged.
- **Guide** (/guide): Start here, Routines, Pages, Reference; tab switches; master–detail rail (click, ↑↓ keys, detail cross-fade, scrolling rail); chip selector (Pages 13 chips, Reference 8) incl. sticky behaviour; glossary; "Where to configure X" table; deep link /guide#assistant-open. (The "More tasks" fold no longer exists — every task is in the rail.)
- **Shell**: sidebar (hover, active, the sliding accent indicator filmed, section labels, footer), search pill, command palette (click + Ctrl K, typing, results, ↑↓, no-match, Esc, open motion), assistant launcher + docked/overlay panel (open/close filmed — nothing sent), theme toggle (filmed both directions), compact density, login (fresh context without token), 404, document titles, keyboard (skip link, Tab order, focus rings), toasts (placement, stacking, with the dock open).

## Findings (most impactful first)

### SGS-01 · The theme toggle flickers: dozens of controls animate from the old theme's colours
- Where: Shell › sidebar footer "Light theme / Dark theme" (same via Settings › Account › Appearance) · every page · both directions
- What happens: The page background, cards and text switch instantly, but 63–123 controls (every `.button`, segmented option, chip, local tab, nav link, footer button) run a 120 ms colour/background transition *from the old theme*. Dark→light, ~100–160 ms after the click: the active sidebar item and every pressed segment (Whose "All", "Monthly", "Dark", "Comfortable", "Off") are near-black pills on a white page, Expand/Table/Export are dark blobs, and the selected tab label ("Overview", "Account") is invisible — white on white. Light→dark: ~60 white Edit/Retire/Delete pills and a white active-nav pill flash on the dark page, and the selected "Household" tab label disappears. It settles after ~250–350 ms.
- Evidence: shots/settings-guide-shell/film-theme-toggle_net-worth/02-151ms.jpg · shots/settings-guide-shell/film-theme-toggle_settings_section_account/02-190ms.jpg · shots/settings-guide-shell/film-theme-toggle-light-to-dark/02-127ms.jpg
- Cause: `ThemeProvider.tsx:84` flips `data-theme` on `<html>` with nothing suppressing transitions; the colour transitions are `panels.css:830-846` (.button, .chip, .segmented button, .local-section-nav [role=tab] …), `Layout.css:266-274` (.nav-link), `shell.css:294-302` (.segmented button, .sidebar-footer-icon), `GuidePage.css:348-362`.
- Polish: Make the swap one event. Either add a `theme-swap` class to `<html>` that sets `transition: none !important` on everything for the frame the attribute flips (add class → flip → remove after two rAFs), or wrap the flip in `document.startViewTransition()` for a single ~200 ms whole-page cross-fade (instant under reduced motion).
- Impact: Switching theme looks deliberate instead of glitchy — no vanishing tab labels, no stray dark/white pills.
- Size: S · Confidence: high

### SGS-02 · Command palette: the arrow keys move the highlight out of sight
- Where: Shell › command palette (Ctrl K or the sidebar "Search or jump…"), empty query or any query with more than ~9 results
- What happens: The result list is a 320 px scroll box (47 entries / 1,785 px with an empty query). ↓ moves the selection but the list never scrolls: from the 7th press the highlighted row is below the box (scrollTop stays 0); after 16 presses the highlight ("Household") is 616 px down and the visible list shows no highlight at all — Enter now runs something the user cannot see. Same in light theme.
- Evidence: shots/settings-guide-shell/palette-arrowed-dark.png (plus the per-press measurements in work-settings-guide-shell/pal1.mjs, verify2.mjs)
- Cause: `CommandPalette.tsx:216-222` — ArrowDown/ArrowUp only call `setActive`; nothing scrolls the active option into view.
- Polish: After the active index changes, `document.getElementById('palette-option-'+id)?.scrollIntoView({ block: 'nearest' })` (layout effect on `activeIndex`); wrapping from last to first scrolls back to the top.
- Impact: Keyboard users can see what Enter will do — the palette behaves like every other launcher.
- Size: S · Confidence: high

### SGS-03 · Opening the assistant beside Settings breaks the page — the cards don't know the page got narrower
- Where: Shell › assistant (sparkle) → default "Beside the page" dock at 1440×900 → Settings › Household / Account / Integrations (Guide uses the same grid rules)
- What happens: The dock takes 400 px and the page narrows to 815 px, but every grid still lays out for a 1440 px viewport: the Household card's inputs spill out of the card by 21 px (Add-member box and marriage date run into the gutter); the Spending categories table overflows by 105 px → a horizontal scrollbar, names wrap to two lines, the Kind picker is cut off under the sticky actions column; Appearance's pickers clip to "System | Dark | Ligh" and "Comfortable | Compa"; Price refresh's facts collapse into one-word columns where "NEXT SCHEDULED RUN" overprints the timestamp and "Not scheduled" runs past the card edge. (At 1920 the 499 px dock leaves enough room; at 1280 the panel overlays instead.)
- Evidence: shots/settings-guide-shell/dock-_settings_section_household-dark-1440.png · shots/settings-guide-shell/dock-_settings_section_integrations-dark-1440.png · shots/settings-guide-shell/toast-with-dock.png
- Cause: `DetailPanelProvider.tsx:325` narrows the content with `marginInlineEnd`, but the collapse rules are *viewport* media queries — `panels.css:64-68` (`@media (max-width:1000px)` for span-4/6/8), `settings.css:602-610` and `108-122` (`@media (min-width:721px)` two-column fields/facts) — and the forms use fixed 240 px minimum tracks (`SettingsPage.css:26`, `settings.css:147`); `.segmented` clips (`overflow:hidden`). `.page` is already a named container (`panels.css:21`) and the KPI rows already use `@container page` (`panels.css:112-123`).
- Polish: Move these breakpoints to `@container page (max-width: …)` so, with the dock open, the span-4/8 and span-6 pairs stack into one column and facts/fields go single-column; let segmented groups wrap instead of clipping.
- Impact: Asking the assistant about the page you're on no longer mangles that page.
- Size: M · Confidence: high

### SGS-04 · "Edit" on a category or account opens an editor the user can't see
- Where: Settings › Household › Spending categories and Accounts (/settings?section=household), any row once the table/page is scrolled
- What happens: Edit copies the row into the add-form at the TOP of the card and relabels its button "Save category"/"Save account". With the capped table scrolled to its lower rows (the normal case for 19 categories / 30 accounts in 420 px boxes), that form is above the viewport — the name input measured at −54 px (dark and light). Focus stays on the Edit button; the only visible change is a faint tint on the row. The user sees nothing happen, and a second Edit elsewhere silently replaces the first.
- Evidence: shots/settings-guide-shell/cat-after-edit-dark.png · shots/settings-guide-shell/v2-cat-edit-light.png · shots/settings-guide-shell/accounts-after-edit-dark.png
- Cause: `CategoriesCard.tsx:298-302` and `AccountsCard.tsx:181-192` only set state; the form lives at `CategoriesCard.tsx:262-288` / `AccountsCard.tsx:487-570`; no scroll or focus hand-off.
- Polish: Edit in place — turn the row's name cell into an input with Save/Cancel (the Household card already does this for Rename; Esc cancels). At minimum: scroll the form into view, focus + select the name, and give the editing row an accent left edge.
- Impact: Editing becomes obvious at a glance; no "did it do anything?" moment.
- Size: M · Confidence: high

### SGS-05 · A failed row action reports its error at the top of the card, off-screen, and shoves the table down
- Where: Settings › Household › Spending categories (Kind picker, Retire) and Accounts (Retire) — exercised with fenced writes (the audit fence returned 503; only the presentation is judged)
- What happens: Clicking "Tax" on the Travel row, or "Retire": the row silently snaps back and the message appears in the add-form banner at the card's top — at y = −2 px, under the sticky tab strip, invisible. The banner's insertion pushes the table down 73 px, so the row just clicked jumps away from the pointer. Delete failures, by contrast, use a toast.
- Evidence: shots/settings-guide-shell/row-kind-fenced-dark.png · shots/settings-guide-shell/v4-retire-fenced-light.png
- Cause: `CategoriesCard.tsx:144-151` (toggleActive) and `157-165` (setKind), `AccountsCard.tsx:239-246` send row errors to `setFormError` → the FeedBanner inside the add-form (`CategoriesCard.tsx:287`, `AccountsCard.tsx:569`); `remove()` uses `toast.error` (`CategoriesCard.tsx:167-177`).
- Polish: Report row outcomes at the row — an inline line under it, or a toast like Delete — and keep the add-form banner for the add-form. A successful Kind change (it recomputes all history) also deserves a confirmation toast with Undo, like the reorder toasts.
- Impact: Failures are noticed; the row you clicked stays put.
- Size: S · Confidence: high

### SGS-06 · The sidebar doesn't fit common laptop screens: footer hidden, nested scrollbar, clipped search label
- Where: Shell › sidebar at 1280×800 and 1366×768 (comfortable density); the search pill at every width
- What happens: Nav + footer need 886 px. At 1280×800 the sidebar grows its own 16 px scrollbar and "Light theme" / "Log out" sit below the fold (bottoms at 834/870 px); at 1366×768 the entire footer (email, environment, theme, log out) is hidden. Compact density still overflows by 18 px at 800 px. The scrollbar eats into the 210 px column, so "Search or jump…" is cut to "Search or j…"; even at 1440/1920 it reads "Search or ju…" (86 of 95 px).
- Evidence: shots/settings-guide-shell/sidebar-1366x768.png · shots/settings-guide-shell/w1280_settings_section_household-dark.png · shots/settings-guide-shell/settings-household-dark-1440.png
- Cause: `Layout.css:16-27` (sidebar `height:100vh; overflow-y:auto`), `Layout.css:110-117` (0.5 rem padding on 14 links), `shell.css:220-229` (four stacked footer rows); label ellipsis `Layout.css:53-61`, text `Layout.tsx:188`.
- Polish: A short-viewport rhythm (`@media (max-height: 900px)`: nav-link padding 0.5→0.35 rem, tighter section headings) and put the theme toggle + log out as one icon row beside the email; shorten the pill to "Search…" (keep the Ctrl K key) so it never truncates.
- Impact: The whole shell — including theme and sign-out — is visible on an ordinary laptop, with no scrollbar-inside-a-sidebar.
- Size: S · Confidence: high

### SGS-07 · Category/account tables: every row shouts Edit · Retire · Delete · ACTIVE
- Where: Settings › Household › Spending categories (19 rows) and Accounts (30 rows)
- What happens: All 49 rows carry three bordered buttons (147 buttons), categories also a 3-segment Kind picker, and every row an identical "ACTIVE" pill — all 49 are active, so the Status column says nothing. The action column is the heaviest thing on the page and, at 1280, squeezes names onto two lines ("Auto & / Transport"). Keyboard: a category row is 7 Tab stops (grip + 3 kind + 3 actions) → 133 presses to cross the card, 271 across the two tables.
- Evidence: shots/settings-guide-shell/settings-household-dark-1440.png · shots/settings-guide-shell/settings-household-light-1440.png · shots/settings-guide-shell/w1280_settings_section_household-dark.png
- Cause: `CategoriesCard.tsx:414-433` and `AccountsCard.tsx:441-472` render the three buttons and the status badge on every row; each toggle-Segmented button is its own tab stop.
- Polish: Show a "Retired" badge only when retired (drop the ACTIVE pills and the column); keep Edit, move Retire/Delete into a "⋯" menu — or reveal row actions on row hover / `:focus-within` (opacity 0→1 over `--t-fast`, still in the DOM); make each Kind picker a single tab stop with arrow keys (radio-group pattern).
- Impact: The tables read as data again, names stop wrapping, and keyboard users cross a card in a handful of stops.
- Size: M · Confidence: high

### SGS-08 · Settings is the one page whose word fields are monospace
- Where: Settings, all tabs — name boxes, marriage date, Group/Owner/Parent selects, portfolio owner selects, Landing page, Default model, stored-snapshot select, file pickers ("Choose File · No file chosen"), placeholders ("phone, laptop…", "nvapi-…")
- What happens: Every `.field-input` renders in Cascadia Mono, so "Edward", "Joint", "Overview", "Nemotron 3.5 Lightning" and "09/09/2026" look like code or amounts — heavier and wider than the same names in the table cells beside them. Every other page deliberately switches word fields back to the UI font (Credit cards, Comp, ESPP, Paycheck, Calendar). The login page's inputs fall back to the browser default (Arial ~13 px) — a third face.
- Evidence: shots/settings-guide-shell/el-household-dark.png · shots/settings-guide-shell/el-appearance-light.png · shots/settings-guide-shell/el-restore-dark.png
- Cause: `panels.css:359-369` (`.field-input` is monospace by default); `SettingsPage.css:14-18` overrides alignment only ("The monospace stays — a cron expression and a ticker both want it"); precedents `roster.css:26-35`, `CompPage.css:56-67`, `CreditCardsPage.css:1-8`, `PaycheckPage.css:148-197`, `CalendarPage.css:306-311`; `LoginPage.css:33-39` sets no font on inputs.
- Polish: In Settings, give `select.field-input` and word inputs `font-family: inherit`, keeping monospace only for the cron and ticker boxes (a small `.is-code` class); `font: inherit` on `.login-card input`.
- Impact: One consistent type system — names read as names, figures as figures.
- Size: S · Confidence: high

### SGS-09 · Household tab: a 260 px dead column under Household, and 627 px owner selects
- Where: /settings?section=household at 1280 / 1440 / 1920
- What happens: The span-4 Household card ends 261 px (1440; 279 at 1280, 207 at 1920) above its span-8 Spending categories neighbour — an empty column in the first screen of Settings (the grid is `align-items:start`, so it is bare page background). Further down, the Portfolio accounts table is two full-width columns, so each owner select is 627 px wide for a one-word value.
- Evidence: shots/settings-guide-shell/settings-household-dark-1440-full.png · shots/settings-guide-shell/el-household-dark.png
- Cause: `SettingsPage.tsx:328-333` (Household span-4 beside Categories span-8, then Accounts span-12 which also holds Portfolio accounts, `AccountsCard.tsx:632-700`); `SettingsPage.css:69-74`; `settings.css:284-286` sets only a min-width while `.field-input` is `width:100%` (`panels.css:360`).
- Polish: Pair Household with Portfolio accounts as its own span-8 card (same "who owns what" job, nearly the same height) and give Spending categories the full width (names stop wrapping, Kind picker gets room). Size owner selects to content (`width:auto; min-width:9rem; max-width:14rem`).
- Impact: No hole on the first screen; ownership controls look proportionate.
- Size: M · Confidence: high (problem), medium (exact regrouping)

### SGS-10 · Price refresh: recent runs are one run-on sentence in a 120 px column
- Where: Settings › Integrations › Price refresh (/settings?section=integrations)
- What happens: "Recent refreshes" joins five runs with " · " inside the right half of a two-column fact grid in a half-width card: a 10-line ragged paragraph with timestamps broken mid-value ("Sep 24, 2026, 1:10 / PM 86 updated · Sep / 23, …"); "Last price refresh" also breaks over three lines. It is the tallest thing on the tab and leaves a 173 px hole beside the Assistant card. The System card already solved this with one-line list items.
- Evidence: shots/settings-guide-shell/el-pricerefresh-light.png · shots/settings-guide-shell/settings-integrations-dark-1440.png
- Cause: `PriceRefreshCard.tsx:26-38` (`refreshRunsLine` joins with ' · '), `182-202` (four facts in `.system-facts`), `settings.css:108-122` (two-column facts even inside a span-6 card).
- Polish: Render the runs as a `.system-fact-list` (one run per line, e.g. "Today 1:10 PM · 86 updated", failures in red) on a wide row; keep facts single-column inside a half-width card.
- Impact: Scannable refresh history, a shorter card, an even row with the Assistant card.
- Size: S · Confidence: high

### SGS-11 · System card: values zig-zag across three columns; "Last backup" wraps beside empty space
- Where: Settings › Data › System (/settings?section=data)
- What happens: Wide facts put their values at x = 1069, half-width facts at x = 969, the right-hand fact at x = 1243 — no common value edge. "Last backup" (half width, followed by a wide fact) wraps "Sep 23, 2026, 8:00 / PM · 235.5 KB · / encrypted · verified" into a 129 px column while the right half of its row is empty.
- Evidence: shots/settings-guide-shell/el-system-dark.png · shots/settings-guide-shell/data-system-viewport-dark.png
- Cause: `settings.css:108-122` (the label track is 40 % of each item, so wide and half items get different value offsets) + `SystemCard.tsx:89-94` (Last backup is a half-width fact placed before a wide one).
- Polish: One label track for the whole list (e.g. `grid-template-columns: 9rem 1fr` on the `dl`, facts as subgrid rows) or make "Last backup" wide.
- Impact: A calm status panel whose values line up.
- Size: S · Confidence: high

### SGS-12 · Info-hint bubbles fade with their card near the viewport edge
- Where: Any ⓘ on a card near the top/bottom edge — e.g. Settings › Household › Accounts ⓘ on first load (card top at y 847)
- What happens: The bubble inherits the card's scroll-reveal dimming: measured card opacity 0.53 when opened near the bottom edge (a washed-out tooltip), 0.96 once the same card is mid-screen. The card just peeking in is exactly the one a reader hovers to ask "what is this?".
- Evidence: shots/settings-guide-shell/infohint-accounts-scroll0-dark.png · shots/settings-guide-shell/infohint-accounts-light.png
- Cause: `panels.css:1097-1100` (card `opacity = --reveal × --enter`) and `InfoHint.tsx:123-131` renders the bubble inside the card.
- Polish: Portal the bubble to `<body>` (positioned from the button), or hold the reveal at 1 while the card has an open bubble (`.card:has(.info-hint-bubble)`).
- Impact: Explanations are always full-contrast.
- Size: S · Confidence: high

### SGS-13 · Toasts land on the docked assistant, errors cover header buttons, and a pending toast never resolves
- Where: Shell › toast regions (info/success bottom-right, errors top-right)
- What happens: (a) With the assistant docked the toast column keeps its fixed right inset: at 1440 it straddles the dock edge (toast 989–1349 px vs dock from 1025 px), at 1920 it sits entirely on the assistant panel (1469–1829 vs 1406–1905) — over its composer area. (b) Error toasts pin to top:1rem / right:96px — where page headers put their actions: on Portfolio the error covered the "Refresh prices" button it was reporting on (fenced request; message wording not judged); Net worth's "Enter month" sits in the same spot. (c) The palette's "Refresh prices" posts "Refreshing prices…" and then the outcome as a second toast in the other corner, leaving "Refreshing prices…" up for 6 s after the run ended.
- Evidence: shots/settings-guide-shell/toast-with-dock.png · shots/settings-guide-shell/toast-with-dock-1920-light.png · shots/settings-guide-shell/toast-refresh-prices.png
- Cause: `toast.css:11-23` right inset ignores `--dock-width` (the launcher reads it, `assistant.css:12`); `toast.css:28-31` puts the alert region at top:1rem; `CommandPalette.tsx:136-147` pushes info, then a separate success/error (the toast API has no update-in-place).
- Polish: `right: calc(1.25rem + 44px + 0.75rem + var(--dock-width, 0px))`; start the error column below the page-title row; add `toast.update(id, …)` so "Refreshing prices…" becomes "Prices refreshed — 86 updated" in place.
- Impact: Feedback never hides what you're working with, and one action yields one evolving message.
- Size: S (a, b) / M (c) · Confidence: high

### SGS-14 · Appearance pickers are stretched with empty tails, and the chosen option is faint in light theme
- Where: Settings › Account › Appearance (Theme, Density, Chart patterns); the same pressed style on the Kind pickers
- What happens: Each segmented group stretches to the whole column while its options pack left, leaving an empty bordered slot after "Light", "Compact", "On" — it reads like a missing option. In light theme the pressed option is #e6ebf2 on white (≈1.2:1), so "Light"/"Comfortable"/"Off" barely differ from their neighbours — you can't see which theme you picked.
- Evidence: shots/settings-guide-shell/el-appearance-light.png · shots/settings-guide-shell/settings-account-dark-1440.png
- Cause: `settings.css:292-297` (`.settings-field` is a flex column with default `align-items: stretch`, stretching the inline-flex `.segmented` from `shell.css:10-15`); pressed state `shell.css:39-42` uses `--fill` (`index.css:90`).
- Polish: `.settings-field > .segmented { align-self: flex-start }` (or `flex:1` options that fill evenly); a stronger pressed state in light (accent-tinted fill + accent text, or an inset accent border).
- Impact: Controls look finished and the current choice is obvious in both themes.
- Size: S · Confidence: high

### SGS-15 · Guide: clicking a chip swaps the card with a hard cut and jumps the page 88 px under the pointer
- Where: Guide › Pages and Reference chip selector (from the top of the page)
- What happens: A chip click replaces the card with no transition and scrolls the page 96 px so the card lands under the sticky strip — the chip row moves from y 131 to y 43, sliding out from under the cursor. Tabs fade (180 ms) and rail picks cross-fade, so this is the one hard cut in the Guide. Once stuck, the 76 px chip block has no edge or shadow and slices through the card text below it.
- Evidence: shots/settings-guide-shell/film-guide-chip-glossary-dark/02-81ms.jpg → 04-145ms.jpg · shots/settings-guide-shell/guide-pages-taxes-scrolled-dark.png
- Cause: `CardSelector.tsx:25-26` writes the hash; `LocalSections.tsx:86-99` (`focusTarget` → `scrollIntoView({block:'start'})`) runs on every pick; `GuidePage.tsx:31` remounts `GuideCard` by key with no entrance; sticky selector `GuidePage.css:274-281` (no edge when stuck).
- Polish: Only scroll when the new card's top would be hidden; cross-fade the card like `TaskDetail` (opacity + 6 px over `--t-xfade`); a hairline/soft shadow under the selector while stuck.
- Impact: Browsing the Guide feels steady — what you clicked stays where you clicked it.
- Size: S · Confidence: high

### SGS-16 · Save buttons are lit and armed when nothing has changed
- Where: Settings — Save marriage date, Add category, Add account, Save limits, Save assumptions, Save schedule, Save assistant settings, Save reminder day, Change password
- What happens: Every card's primary button is full accent at rest, so a pristine tab shows three competing blue CTAs (Integrations: Save schedule / Save assistant settings / Save reminder day; Household: Add category / Save marriage date / Add account). Nothing says which card has unsaved edits. The page already does it right once: "New feed link" stays disabled until a label is typed.
- Evidence: shots/settings-guide-shell/settings-integrations-dark-1440.png · shots/settings-guide-shell/settings-household-dark-1440.png
- Cause: disabled only while busy — `HouseholdCard.tsx:236`, `LimitsCard.tsx:193`, `PlanAssumptionsCard.tsx:261`, `PriceRefreshCard.tsx:156`, `AssistantCard.tsx:204`, `CalendarFeedCard.tsx:244`, `CategoriesCard.tsx:278`, `AccountsCard.tsx:560`; precedent `CalendarFeedCard.tsx:196`.
- Polish: Track a dirty state per card: quiet when pristine, accent + a small "Unsaved changes" when edited, a brief "Saved ✓" after success.
- Impact: One clear call to action at a time, and at-a-glance knowledge of what still needs saving.
- Size: M · Confidence: high

### SGS-17 · Renaming a household member: cramped editor, focus lands on Cancel
- Where: Settings › Household › Household › Rename
- What happens: Input + "Save name" + "Cancel" share one line of a 372 px card, so "Save name" wraps onto two lines and the row grows. The input is not focused; keyboard focus ends up on "Cancel" (the Rename button's element is reused as Cancel), so Enter/Space straight after Rename cancels. Same in both themes.
- Evidence: shots/settings-guide-shell/el-household-rename-dark.png · shots/settings-guide-shell/v3-rename-light.png
- Cause: `HouseholdCard.tsx:134-178` — both branches are fragments with a `<button>` at the same child position (React reuses the node and its focus); no autofocus/select on the input; an unwrapped flex row.
- Polish: Stack the editor (full-width input, buttons below) or use compact ✓/✕ buttons; autofocus + select the name; Enter saves, Esc cancels; key the branches so focus isn't inherited.
- Impact: Renaming becomes a two-keystroke, no-surprise edit.
- Size: S · Confidence: high

### SGS-18 · Activity: "View report" opens the report below the list, out of sight
- Where: Settings › Data › Activity (RUN rows)
- What happens: The report renders after the 420 px capped list — at 1440×900 its heading lands at the very bottom edge (y 843–872) or below the fold. The button doesn't change ("View report" stays, no expanded state), the row isn't marked, and opening another report silently replaces it.
- Evidence: shots/settings-guide-shell/data-activity-report-dark.png · shots/settings-guide-shell/v5-view-report-light.png
- Cause: `ActivityCard.tsx:177-187` renders the report outside the scroll box; `viewReport` (`112-117`) only sets data.
- Polish: Expand the report inline under its row (Disclosure-style, "Hide report", `aria-expanded`) — or scroll it into view and highlight its row.
- Impact: Users see what they asked for immediately.
- Size: S · Confidence: high

### SGS-19 · Command palette readability: every row repeats its group; no match highlight, no key hints; heavy overlay in light
- Where: Shell › command palette
- What happens: Rows repeat the group header on the right ("PAGES", "SETTINGS", "GUIDE"), and Settings/Guide rows repeat it again in their sub-label ("Household Settings | SETTINGS" under a SETTINGS header; "Set the marriage date Guide · Settings — Household & Planning | GUIDE"). Typed characters aren't emphasised; there's no ↑↓ / ↵ / Esc hint; "No matches." is a dead end. The overlay and shadow are hard-coded black at 50 %, so in light theme the page turns muddy grey (the app's `--scrim` is a lighter blue-grey), and the selected row in light (#f7f9fc on white) relies on the 3 px accent bar alone.
- Evidence: shots/settings-guide-shell/palette-marriage-dark.png · shots/settings-guide-shell/palette-net-dark.png · shots/settings-guide-shell/palette-empty-light.png
- Cause: `CommandPalette.tsx:311-315` (label + sub + `.palette-kind`), `279-280` (empty state); `CommandPalette.css:12` and `:20` (`rgba(0,0,0,.5)`).
- Polish: Drop the per-row kind (headers already say it); keep sub-labels only to disambiguate ("Settings › Household"); bold matched characters; a one-line footer "↑↓ move · ↵ open · Esc close"; on no match offer "Search the Guide" / "Ask the assistant about '…'"; use `var(--scrim)` and `rgb(var(--shadow))`.
- Impact: Faster scanning, a calmer overlay in light, no dead ends.
- Size: S–M · Confidence: high

### SGS-20 · Guide master–detail leaves a tall void, and the setup checklist has no "next" or progress
- Where: Guide › Start here › Set up once (and every master–detail card)
- What happens: The rail is 630–665 px tall while the selected task's detail is ~115 px (two steps + Go) — a ~500 px empty right column (551 px at 1920, 471 at 1280). On the numbered 18-step "Set up once" checklist there is no Next/Previous and no sign of what's already done, so the reader bounces between rail and detail.
- Evidence: shots/settings-guide-shell/guide-start-dark-1440-full.png · shots/settings-guide-shell/guide-rail-after-arrows-dark.png
- Cause: `GuidePage.css:149-167` (two-column grid, sticky detail) and `179-188` (rail `max-height: min(70vh, 640px)`); `TaskDetail.tsx` renders the task only.
- Polish: "Step 3 of 18 · Next: Add the accounts →" (and ← Previous) at the foot of the detail; a small ✓ on rail rows the data already proves done (people exist, accounts exist, kinds set, a month saved); optionally a shorter rail when the detail is short.
- Impact: The checklist becomes a guided walk with visible progress, and the card stops looking half-empty.
- Size: M · Confidence: medium

### SGS-21 · Guide "Where to configure X": a 528 px table in a 1,151 px card; 11 of 16 links wrap
- Where: Guide › Reference › Where to configure X (/guide?section=reference#ref-settings-map)
- What happens: The table is capped at 72ch (528 px), so the "Go to" links wrap — "Household → / Household", "Planning → / Contribution limits" (11 of 16 rows) — while 623 px of the card stays empty (1,103 px at 1920).
- Evidence: shots/settings-guide-shell/guide-settingsmap-dark.png
- Cause: `GuidePage.css:68-70` (`.guide-map { max-width: 72ch }` — a prose measure applied to a table).
- Polish: Let the table take ~100ch (or the card width) and give the Go-to column `white-space: nowrap`.
- Impact: One clean line per job — the map reads like a directory.
- Size: S · Confidence: high

### SGS-22 · Guide chip rows wrap with a lone orphan
- Where: Guide › Pages at 1440 and 1280 (Reference likewise)
- What happens: 13 chips in sidebar order; at 1440 the last chip ("Settings — Account, Integrations & Data") wraps alone onto a second line, and Reference's 8 sentence-long chips also wrap to two rows — making the sticky block 76 px tall.
- Evidence: shots/settings-guide-shell/guide-pages-dark-1440.png · shots/settings-guide-shell/guide-reference-dark-1440.png
- Cause: `guide/content.tsx:14` (one flat list), long card titles, wrapping chip row `GuidePage.css:274-287`.
- Polish: Group the Pages chips under small sidebar-section labels (Tracking · Income · Planning · Settings) and shorten the two Settings chips ("Household & Planning", "Account & Data"); give Reference short chip labels (Typing, Keys, Undo, Sandboxes, Links, Assistant, Glossary, Settings map).
- Impact: A tidy selector that mirrors the sidebar the user already knows.
- Size: S · Confidence: medium

### SGS-23 · Assistant close: the panel empties before it leaves and the launcher sweeps across the page; the launcher has no label
- Where: Shell › assistant dock close (Esc or ×) at 1440; the sparkle launcher
- What happens: On close the panel body blanks at once (only "Assistant" remains) while the panel slides out, and the launcher reappears at the old dock edge (x ≈ 983, focus ring on, over the Categories text) then glides 400 px right across the content over 240 ms. Hovering the launcher shows nothing (no title), so a new user must click to learn what the sparkle is. At the page end the launcher also sits over the last card's bottom-right corner (the Activity list's scroll arrow).
- Evidence: shots/settings-guide-shell/film-assistant-esc-dark/01-64ms.jpg · shots/settings-guide-shell/film-assistant-esc-dark/04-192ms.jpg · shots/settings-guide-shell/data-bottom-viewport-dark.png
- Cause: `DetailPanelProvider.tsx:402-416` — the exit ghost renders the request's content, which for the assistant is only a mount point (`AssistantDockMount`), while `AssistantDrawer.tsx:683` unmounts the portaled drawer as soon as `open` is false; `assistant.css:411-413` transitions `right` as `--dock-width` drops; `AssistantDrawer.tsx:923-926` has only an aria-label.
- Polish: Keep the drawer content mounted until the exit finishes; fade the launcher in at its final corner after the dock has closed instead of sliding it over content; add `title="Assistant"`; give `.page` enough bottom padding (~88 px) that the last card clears the launcher.
- Impact: Closing the assistant feels clean, and the launcher explains itself.
- Size: S · Confidence: high

### SGS-24 · Login screen polish
- Where: /login (no session), both themes
- What happens: Inputs render in the browser default font (Arial ~13 px; the app is Segoe UI 16 px). When an error appears, the vertically centred card grows and shifts up 16 px. The "Show" toggle is shorter than the input beside it (≈28 vs 35 px). (The error text itself was the audit fence — not judged.)
- Evidence: shots/settings-guide-shell/login-error-dark-1440.png · shots/settings-guide-shell/film-login-arrive-from-settings-dark/02-232ms.jpg
- Cause: `LoginPage.css:33-39` (no font on inputs), `LoginPage.css:1-6` (centred flex page), `LoginPage.css:99-107` (toggle sizing).
- Polish: `font: inherit` on inputs; anchor the card at a fixed top (`align-items:flex-start; padding-top:22vh`) or reserve the error line; set the Show toggle inside the input's right edge at full height.
- Impact: The first screen matches the app, and a mistyped password doesn't make the form jump.
- Size: S · Confidence: high

### SGS-25 · The 404 page is a dead end
- Where: /does-not-exist (both themes)
- What happens: A left-aligned "Not found" title with one centred sentence floating ~500 px to its right and a single link back to Overview.
- Evidence: shots/settings-guide-shell/404-dark-1440.png · shots/settings-guide-shell/404-light-1440.png
- Cause: `NotFoundPage.tsx:13-17` (centred `.empty-note`).
- Polish: Left-align the message under the title; add a "Search or jump (Ctrl K)" button that opens the palette and a short list of main pages (or the closest match to the mistyped path).
- Impact: A bad link becomes a two-second detour.
- Size: S · Confidence: medium

### SGS-26 · Settings and Guide forget where you were; every tab entry has the same title
- Where: Settings tabs, Guide chapters, browser history
- What happens: Settings › Data → Overview → sidebar "Settings" lands on Household again; Guide › Reference → Overview → "Guide" lands on Start here. Each tab click pushes a history entry, but all are titled "Settings · Personal finance", so Back's history list shows five identical entries.
- Evidence: runs work-settings-guide-shell/remember1.mjs and titles1.mjs (console output); shots/settings-guide-shell/settings-data-dark-1440.png for context
- Cause: `LocalSections.tsx:49-56` (tab click pushes `?section=`), sidebar links go to bare `/settings`, `/guide` (`Layout.tsx:207-217`); `usePageTitle.ts` titles by pathname only.
- Polish: Remember the last section per page for the session and let the sidebar link carry it; title views "Data — Settings · Personal finance".
- Impact: Returning to a half-done settings task is one click; history is legible.
- Size: S · Confidence: medium

### SGS-27 · Small nits (batch)
- Where / what / cause / polish, one line each:
  - Accounts form: the "Component of the parent" checkbox sits ~10 px above the select and button beside it (`settings.css:159-194`) → `align-self: end` with the controls' height.
  - Category name box is 31 px tall beside a 36 px "Add category" button (`panels.css:312-323` vs `359-369`) → match heights.
  - Whole-dollar caps shown with cents: "$24,500.00", "$4,400.00"; match line "first $6,000.00, then 50% of the next $11,000.00" (`PlanAssumptionsCard.tsx:57` uses `formatCurrency`) → whole dollars where the value is a cap.
  - "Plan until (year)" is an empty box with no placeholder; what blank means is in the paragraph below (`PlanAssumptionsCard.tsx`) → placeholder "Horizon end (default)".
  - Guide › Routines › The monthly update: the body's first sentence repeats the purpose ("Two parts on their own schedule…", `guide/content/routines.tsx:11` and `:18`), and the link reads "Open The monthly update →" (`GuideCard.tsx:32-36` builds "Open {title} →") → trim the repeat; "Open Monthly update →".
  - Guide › Start here: the first card is full width but its text stops at 72ch, leaving ~45 % (1440) / ~60 % (1920) of the card empty → put the "three rhythms" in three small fact tiles on the right.
  - Glossary (Reference › Words this dashboard uses): 25+ term rows with no separators or grouping → hairlines between entries and a few group sub-heads (Spending · Balances · Taxes · ESPP).
- Evidence: shots/settings-guide-shell/accounts-after-edit-dark.png · shots/settings-guide-shell/w1920_guide_section_start-dark.png · shots/settings-guide-shell/guide-glossary-dark.png
- Impact: Each is small; together they remove the "unfinished" texture from Settings and the Guide.
- Size: S each · Confidence: high

## Strengths to keep (≤6 bullets — things that already feel great, so a fix doesn't break them)
- Keyboard basics are right: "Skip to content" is the first Tab stop, every control shows an accent focus ring (inset inside scroll boxes), Esc from the palette returns focus to the trigger and from the assistant to the launcher.
- Motion grammar is coherent: the sidebar accent bar glides between destinations (200 ms, first placement instant), the tab-strip indicator does the same, tab panels fade 180 ms, Guide task details cross-fade; zero measurable CLS on Settings/Guide loads.
- Settings deep links (#limits, #calendar, #activity) switch to the right tab, land under the sticky strip and ring the card for 1.2 s — keep this when reworking the Settings layout.
- Settings ghost skeletons are sized to the loaded cards (Categories 695/695, Limits 415/411), so tab switches don't jump.
- Guide deep links (/guide#assistant-open) resolve chapter, chip, rail row and focus; the rail supports ↑↓/Home/End.
- Activity's Undo arms first ("Undo?") before firing — a good safety pattern to copy elsewhere.

## Not reproduced / environment artifacts (what you ruled out)
- Settings › Data looked slow (ghosts 2.3–3.0 s), but a different endpoint was slow on each run (restore-points once, health once) while the other five answered in 100–300 ms — shared-backend contention, not reported.
- "Next scheduled run: Not scheduled", "Scheduler: Not running", "Backups are not configured here", "No stored snapshots yet", "Prices never refreshed", the DEV badge — local environment.
- The assistant's "Add a provider key" note and the disabled "Test key" — no key in the audit environment.
- "audit fence: writes are disabled" messages (login, toasts, banners) — only their placement was judged (SGS-05, SGS-13).
- The Guide's "More tasks" fold no longer exists (all tasks live in the scrolling rail); `SettingsRail.tsx` (the old chip rail) is not used by the page.
- The Guide rail's "no scrollbar in headless" note in GuidePage.css: with this harness's classic scrollbars the rail shows its scrollbar when in view — no finding.
- Palette open: page text shows through the 120 ms fade-in — ordinary cross-fade, not reported.
