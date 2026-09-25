# Write flows — polish findings

Pages/areas covered (all on the writable twin, http://127.0.0.1:4178; everything I wrote was put back — verified via the API afterwards):
- **Monthly update** (/update): Balances step (typing, formatting on blur, Δ column, sticky live net-worth bar, invalid text, Esc, Enter-walk, Enter-Enter save, Ctrl+S save, mouse save, receipt, toast, Undo); "Next" with unsaved balances (draft toast); leaving the page and coming back (restored-draft banner, Discard); Spending step (edit, Ctrl+S save, Undo); the step kebab's typed-arm "Delete August spending & take-home" + Undo; Review step (three confirmations, Save and close, Undo); dark and light, 1440×900 and 1280×800.
- **Settings**: Household (rename + revert, empty rename, empty add member, marriage date save), Spending categories (empty add, add via Enter, Edit, Esc, rename, kind Living/Tax/Transfer, delete), Accounts (empty add, component-without-parent, add, Edit on a far row, Esc/Cancel, delete, guarded delete of an account with history), keyboard and pointer reorder + toast Undo, Planning (Save limits / Save assumptions), Account (empty password), Data › Activity. Dark + light, 1440 and 1920.
- **Spending › Budgets**: editor open, negative value, letters, save, revert, Esc, Re-seed confirm line (Cancel and Confirm) + Undo. Dark + light.
- **Calendar**: Add event (panel open, empty title, bad amount, Enter, save), Edit + Esc, Delete + Undo, Mark done / Reopen, Hide + Undo, a forced-failure delete (to see the error toast). Dark + light.
- **Credit cards**: Rewards matrix Edit multipliers (select cell, bad value, save, revert, Esc, Cancel with drafts, navigate away with drafts), Manage (empty add, bad fee, add, delete + toast). Dark 1440 + 1920.
- **Portfolio › Manage**: Transactions (empty add, letters in Shares, add, where the row lands, delete + toast), Securities delete (native confirm, dismissed).
- **Taxes › Inputs**: live preview while typing, Esc, Ctrl+Enter save, revert, invalid text, in-app navigation with a dirty form.
- **Projection**: Pin this scenario (label, Enter, 3/3 limit), Copy link (×3), Unpin.
- **Delete confirms elsewhere** (dismissed, nothing written): ESPP lot, Paycheck profile, Security.
- **Toast layer**: placement, stacking, duplicates, hover pause, dismissal, error region.

## Findings (most impactful first)

### WRITE-FLOWS-01 · Saving a month throws you to the top of the page (and a Ctrl+S save shoves the row you are typing in)
- Where: Monthly update › Balances / Spending / Review footers (`/update?month=2026-09-01&step=balances`, `…2026-08-01&step=spending`, `…&step=review`) · both themes
- What happens: the Save buttons sit at the very bottom of a ~2,700px form. Clicking **Save Sep 1 balances** at scrollY 1,853 inserts a 160px "Sep 1 balances saved" receipt card *above* the step (scroll anchoring first nudges the page 1,853→2,013) and then moves focus to the receipt's heading, which scrolls the page **2,013→0** in one frame. The user loses their place in the table they just saved; the same jump happens with the keyboard (Enter on the last cell, Enter again), where the heading also gets a card-wide focus rectangle. When the save is made *from a cell* (Ctrl+S on the Spending step), focus deliberately stays in the cell — but the receipt still lands above the table, so the row being typed in slides **160px down** under the caret. Nothing animates.
- Evidence: shots/write-flows/bal-dark-save-film/08-2209ms.jpg (the save clicked at the page bottom, page now at the top; before = bal-dark-05-footer-before-save.png); spend-dark-02-after-save.png (Ctrl+S: Entertainment row 590→750px, cf. spend-dark-ctrlS-film/00--117ms.jpg); u6-light-enter-save-film/11-562ms.jpg (keyboard save, light, focus rectangle on the receipt heading).
- Cause: src/pages/MonthlyUpdatePage.tsx:1711-1743 renders the receipt above the step body; :1131 arms `focusReceipt` and the effect at :823-829 calls `receiptHeading.current?.focus()` (default focus scrolls it into view).
- Polish: announce the save where the click happened — a compact inline receipt beside the footer buttons (or in the sticky bar, see WRITE-FLOWS-16) with the "30 rows (1 added, 1 changed…)" line and the Next-due link, and keep the full receipt card for the top only if the user is already there. If focus must move, use `focus({ preventScroll: true })` on a target near the button. Never insert content above the caret's row while the user is editing.
- Impact: the most frequent write in the app stops yanking the page; users can check the figures they just saved without scrolling back 2,000px.
- Size: M · Confidence: high

### WRITE-FLOWS-02 · A typo in a money box fails silently — thin red border, no message, Save greys out 1,850px away, and the live totals treat the typo as $0
- Where: Monthly update › Balances (and Spending) cells · both themes, 1440×900
- What happens: typing `abc` into Employer Match 401(k) gives the box `aria-invalid` and a 1px red border that is hidden under the blue focus ring while the box is focused. No sentence says what is wrong. The row's Δ turns red **−$58,413.46**, its derived parent Fidelity Traditional 401(k) drops to $94,796.49 (**−$54,944.68**), and the sticky bar flips from ▲ $49,594.01 to **▼ −$10,894.36** — the typo reads as a real $58k loss. The only other consequence is that **Save Sep 1 balances** (1,850px further down) silently disables, with no title/description saying why; after blurring, the red border is the only clue anywhere on a 30-row table.
- Evidence: shots/write-flows/bal-dark-03-invalid.png (focused), bal-dark-04-invalid-blurred.png (blurred); u2.out (live totals and Save state).
- Cause: MonthlyUpdatePage.css:44-46 (`.field-input.invalid` = border colour only); MonthlyUpdatePage.tsx:1915-1921 (class only, no message), :885-887 + :2059 (Save disabled with no reason); components/monthly/parts.ts:33 (`committed()` turns non-amounts into 0, so Δ and totals use $0).
- Polish: (1) a small inline message under the invalid cell ("Not a number — try 60488.37 or =60000+488.37"); (2) show "—" instead of a Δ and leave the row out of the live totals (with a "1 entry needs fixing" note in the sticky bar) rather than counting it as $0; (3) next to the disabled Save, "Fix 1 entry to save" as a link that scrolls to and focuses the cell; (4) keep a red ring visible even while focused.
- Impact: a mistyped balance is caught at the cell, never mistaken for a market drop, and the user is never left wondering why Save is dead.
- Size: M · Confidence: high

### WRITE-FLOWS-03 · "Delete" speaks six different dialects — from a blocking browser dialog to no safety net at all
- Where: app-wide row deletes and destructive actions
- What happens: the same verb gets six unrelated grammars:
  1. **Native browser `confirm()`** (grey OS dialog, no Undo): ESPP lot ("Delete the lot purchased Feb 29, 2024?"), Paycheck profile ("Delete the profile effective Aug 17, 2026?"), Security ("Delete AAPL?"), Comp event, several Taxes actions.
  2. **Typed arm** ("Type 2026-08 to confirm") **and** a 6-second Undo **and** an Activity undo: Monthly update part delete — the heaviest guard in the app, on an action that is fully undoable.
  3. **Click-to-arm** ("Undo" turns into a red "Undo?"): Settings › Activity.
  4. **Inline Confirm/Cancel line**: Budgets › Re-seed.
  5. **Instant + Undo toast**: portfolio transactions, credit cards, reward categories, calendar events, reorders.
  6. **Instant, no confirm, no Undo, no toast**: Settings spending categories and net-worth accounts (Delete sits beside Edit/Retire in the same neutral style), budget history rows.
- Evidence: work-write-flows/d2.out (the three native dialogs' texts, dismissed); shots/write-flows/u7-light-02-armed.png (typed arm); b3-reseed-confirm.png (inline confirm); cc3-dark-04-after-delete.png (instant + Undo); s2.out / s5.out (Settings deletes: no toast, no Undo).
- Cause: EsppPage.tsx:282, PaycheckPage.tsx:690, SecuritiesPanel.tsx:120, CompPage.tsx:297 (`window.confirm`); MonthlyUpdatePage.tsx:1563-1612 (typed arm); ActivityCard.tsx:97-101 (arm); BudgetPanel.tsx:498-520; CardsPanel.tsx:278-339 / TransactionsPanel.tsx:458-505 (instant + Undo); CategoriesCard.tsx:167-178, AccountsCard.tsx:248-260 (instant, nothing).
- Polish: one rule. Anything the change log can reverse → instant + toast with Undo (and the row collapses out, see WRITE-FLOWS-13). Only irreversible or bulk actions (restore, import, close 37 historical months) get an in-app confirm popover (the existing `.popover-surface` + danger button), never `window.confirm`. Drop the typed arm where Undo exists. Give every row-level Delete the danger tint on hover.
- Impact: users learn one mental model for "can I take this back?"; no more OS dialogs jolting a dark UI, and no silent deletes.
- Size: L · Confidence: high

### WRITE-FLOWS-04 · New and edited rows arrive out of sight and unannounced
- Where: Settings › Household › Spending categories and Accounts (`/settings?section=household`); Portfolio › Manage › Transactions (`/portfolio?section=manage`) · both themes
- What happens: after **Add category** the name box clears — and that is all. No toast, no highlight; the new row is appended at the bottom of the capped list (row top 1,088px, list viewport 241–661px), so the visible UI is identical to before (light and dark). Accounts: no toast or highlight either (the new row lands at the end of its group — in view this time only because Cash is the first group), and focus falls to `<body>`. Portfolio: the new transaction is row 80 of 81 in a scroll box, 3,000px below the fold (row top 4,056 vs box 491–1,031); only the (good) "Security, account and date kept — enter the next lot." line hints anything happened. Deletes in Settings likewise just remove the row, with focus lost.
- Evidence: shots/write-flows/v2-light-cat-added.png (after adding — nothing visible changed); cat-dark-add-film/00--98ms.jpg vs 09-1766ms.jpg (dark, same); row positions in s2.out / s5.out / p5.out.
- Cause: CategoriesCard.tsx:122-141 and AccountsCard.tsx:216-247 (`submit` → reload, no toast/scroll/flash); TransactionsPanel.tsx:415-455. The reorder hook already has a saved-row flash (`useReorder.markSaved`, --t-flash 700ms) that these paths don't use.
- Polish: after an add or edit, scroll the containing list so the row is visible (`scrollIntoView({ block: 'nearest', behavior: 'smooth' })` inside the capped box), run the existing 700ms saved flash on it, and send a short toast ("Added Audit — at the end of the list; drag to reorder"). After a delete, move focus to the next row's same button.
- Impact: every add/edit gets a visible "it worked, here it is" moment instead of a blank form and a guess.
- Size: M · Confidence: high

### WRITE-FLOWS-05 · "Edit" fills a form the user can't see, and Esc doesn't get you out
- Where: Settings › Accounts / Spending categories — Edit on any row below the fold of the capped list · 1440×900 (half-hidden at 1920×1080)
- What happens: clicking **Edit BAC CC** (last account) loads its values into the add form at the top of the card — which is off-screen (form top at **−66px**; categories: **−280px**). The page doesn't scroll, focus stays on the Edit button, and the only change in view is a faint tint on the row. At 1920×1080 the form's labels sit under the sticky tab strip. Esc in the form (or on the button) does nothing; only a Cancel button far away ends the edit. Esc also doesn't close the budget editor or the rewards-matrix edit mode, although it does close the calendar panel and popovers — inconsistent.
- Evidence: shots/write-flows/s8-dark-02-after-edit-click.png (after Edit BAC CC — only a faint row tint; the filled form is above the viewport); v1-1920-accounts-edit.png (1920: form half under the tab strip); s8.out.
- Cause: AccountsCard.tsx:181-192 (`startEdit` sets state only); CategoriesCard.tsx:298-302; no Escape handler on either form.
- Polish: edit inline in the row (name box + Save/Cancel in place), or at minimum scroll the form into view, focus the name box and pulse it; Esc = Cancel in every inline editor (settings forms, budget editor, matrix, household rename).
- Impact: editing a row stops feeling broken; keyboard users get a consistent way out.
- Size: S–M · Confidence: high

### WRITE-FLOWS-06 · Rewards-matrix editing: the editor for the cell you clicked is off-screen, Save is at the other end, and drafts vanish without warning
- Where: Credit cards › Rewards › Edit multipliers (`/credit-cards`) · 1440×900 (1920: editor visible only at the bottom edge)
- What happens: in edit mode the cells become buttons; clicking **Travel: Flights × Venture X** (y=436) selects it, but its Multiplier / Condition / Cap inspector renders *below* the capped matrix at **y=887** — under the fold at 1440×900. Scrolling down to it pushes the selected cell out of view, and **Save multipliers** lives at the top of the card. Tab from a selected cell walks to the next of ~150 cell buttons, not to the inspector. A bad value shows in the cell as "abcx" with no styling while the error banner appears at the card top. **Cancel**, Esc (ignored) and navigating to another page all drop every draft silently — no guard, no draft. After Save: no toast, no highlight on the changed cells, focus falls to `<body>`.
- Evidence: shots/write-flows/cc-dark-03-cell-selected.png (selected cell, no editor in view), cc2-dark-01-inspector.png (editor in view, cell and Save gone), cc-dark-04-invalid.png; cc2.out (Cancel/nav with drafts: no dialog) and v1.out (1920: inspector top at 997px).
- Cause: components/creditcards/RewardsMatrix.tsx:196-209 (Save/Cancel in the header), :261-276 (cell buttons), :334-389 (inspector after the TableScroll), :243-247 (`stopEditing` discards drafts).
- Polish: open the inspector as a small popover anchored to the clicked cell (Enter saves the cell, Esc closes), or let cells be typed into directly; keep Save/Cancel in a sticky bar with "3 cells changed"; ask before discarding drafts; flash the changed cells after save.
- Impact: tuning a card's multipliers becomes a click-type-Enter loop instead of a scroll-hunt, and minutes of edits can't be lost to a stray click.
- Size: M · Confidence: high

### WRITE-FLOWS-07 · Busy labels land on the wrong button and resize the button row
- Where: Monthly update › Review footer; Balances/Spending footers; Taxes/Settings save buttons · both themes
- What happens: clicking **Save and close August** leaves that button's label unchanged and turns the *other* button, **Save progress**, into "Saving…" (both disabled) — the feedback points at the action you didn't take. Every "Saving…" swap also changes width: Save progress 114→80px (the row shifts 34px); **Save Sep 1 balances** ~152→~82px, pushing **Next: September spending** ~69px right mid-save, then back. No spinner anywhere.
- Evidence: shots/write-flows/v1-light-close-busy.png (light, "Saving…" on Save progress); u5.out / v1.out (button x/w during the save); bal-dark-05-footer-before-save.png vs bal-dark-save-film/06-187ms.jpg (Next shifted).
- Cause: MonthlyUpdatePage.tsx:2380 (`saving ? 'Saving…' : 'Save progress'`) vs :2391 (close button has no busy label); the same pattern at :2062, :2264, InputsForm.tsx:871, LimitsCard.tsx:194, PlanAssumptionsCard.tsx:262. (BracketsEditor.tsx:557 already guards against exactly this wrong-button case.)
- Polish: track *which* action is saving and put the busy state on that button only; keep the button's width (min-width from its idle label, or a spinner overlaid on the unchanged label).
- Impact: the button you pressed is the one that answers, and nothing next to it jumps.
- Size: S · Confidence: high

### WRITE-FLOWS-08 · The toast layer covers the sticky bars and every page's header actions; stale and duplicate toasts pile up
- Where: global toasts (src/components/toast.css) · both themes, 1280/1440
- What happens: (a) success toasts (bottom 16px) sit on top of the Monthly update's sticky live-totals bar and hide its delta ("▲ $49,594.01 since Aug 1", "Savings rate — cash") on every save/undo — at 1280×800 the toast (928–1189 × 736–784) overlaps the bar (263–1212 × 759–800). (b) Error toasts stack from the top-right at 16px — exactly where every page keeps its main action: on Calendar the error covered **Add to calendar (.ics)** (toast 1258–1349 × 16–56 over the button at 1236–1393 × 28–64); a real message ("Could not delete the event.") would cover both header buttons, and on other pages "+ Add card", "Enter month", "New tax year…". (c) The "Sep 1 balances not saved — kept as a draft." info toast stays up beside the later "Saved Sep 1 balances [Undo]" — two contradictory messages together for ~2.6s. (d) Clicking Copy link three times stacks three identical "Link copied" toasts. (e) The 6-second Undo window is invisible (the delete popover even promises "Undo is offered for six seconds").
- Evidence: shots/write-flows/v1-1280-toast-over-footer.png (1280: toast over the live bar and the focused cell; 1440 dark: bal-dark-save-film/13-2632ms.jpg), c3-light-01-error-toast.png (error over the header button), u6-light-enter-save-film/11-562ms.jpg (contradictory pair, light); ts1.out (three identical toasts).
- Cause: toast.css:11-23 (region at bottom 16px, no awareness of `.entry-footer`), :28-31 (alert region top 1rem, right inset shared with page headers); ToastProvider.tsx:120-130 (`push` has no key/replace/dedupe); MonthlyUpdatePage.tsx:2048 vs :1147.
- Polish: lift the toast stack above any sticky footer on screen (e.g. a `--toast-bottom` the wizard/taxes bars set); put error toasts in the same bottom stack (red edge + assertive region already distinguish them) or below the page header; give toasts an optional key so a newer message replaces an older one of the same kind (a save retires its "kept as a draft", a second "Link copied" just re-arms); draw a 2px draining bar on toasts that carry Undo.
- Impact: feedback stops hiding the very numbers and buttons the user is looking at, and messages never contradict each other.
- Size: S–M · Confidence: high

### WRITE-FLOWS-09 · Success feedback is a patchwork, and saved states never settle
- Where: app-wide saves
- What happens: the same "it saved" moment is told five ways: toast + Undo (monthly saves, reorders, allocation targets, classification, deletes); an inline "Saved." / "Marriage date saved." that **never fades** (Settings cards — still there minutes later); a footer that flips to "No changes yet" (Taxes — reads as if nothing happened); a history line that appears in the editor (Budgets); and nothing at all (category/account add/edit, household rename, card add, matrix save, calendar add/edit, Mark done). Several Settings saves are also enabled when nothing changed and write anyway: **Save marriage date**, **Save limits** and **Save assumptions** each sent a PUT with an unchanged form and printed "Saved."
- Evidence: shots/write-flows/s7-dark-01-saved-notes.png (two "Saved." after saving unchanged forms), tax2-dark-02-saved.png ("No changes yet" right after a save), budget-dark-04-after-save.png; s4.out / s7.out (PUTs with clean forms).
- Cause: HouseholdCard.tsx:236-244, LimitsCard.tsx:193-204, PlanAssumptionsCard.tsx:262-268 (always-enabled buttons, sticky notes); InputsForm.tsx:861-865; BudgetPanel.tsx:296-331; CalendarPage.tsx:434-470; CreditCardsPage.tsx:278-286 (matrix save, no feedback).
- Polish: one grammar: disable Save until something changed; on success show a transient inline check ("Saved ✓" that fades after ~2s, next to the button) for form saves, and a toast with Undo for row/list changes that the change log can reverse. Tax footer: "Saved just now" for a few seconds before "No changes".
- Impact: users stop re-clicking Save to be sure, and "Saved." never lies about a save that happened ten minutes ago.
- Size: M · Confidence: high

### WRITE-FLOWS-10 · Focus falls to the page body after most saves, deletes and Undos
- Where: app-wide (keyboard use)
- What happens: after pressing Save limits, Save assumptions, a budget's Save, Mark done, Edit multipliers, Delete (category/account/card/transaction), Save name, Unpin, or any toast's **Undo**, `document.activeElement` is `<body>` — the next Tab restarts at the sidebar. Cause is uniform: the pressed button is disabled while busy (browsers blur a disabled focused control) or unmounted. The Monthly update, Calendar delete (focus → Add event) and budget re-seed Cancel show the fix is known.
- Evidence: event logs in s2.out, s4.out, s5.out, s7.out, b2.out, c2.out, cc2.out, pr2.out, s6.out (after toast Undo: `active body`).
- Cause: e.g. LimitsCard.tsx:193 / BudgetPanel.tsx:386 / EventDetails.tsx:116-122 (`disabled={busy}` on the pressed button); ToastProvider.tsx:204-218 (Undo unmounts with its toast); HouseholdCard.tsx:143-160.
- Polish: while busy use `aria-disabled` + ignore clicks instead of `disabled` on the pressed button; after an unmount, hand focus to a stable neighbour (the row's next control, the list heading, or — for toast Undo — the element that was focused before the action).
- Impact: keyboard users keep their place through every write.
- Size: M · Confidence: high

### WRITE-FLOWS-11 · Budget editor: the error lands 330–540px away, says the wrong thing, and outlives the fix; the field itself never turns red
- Where: Spending › Budgets › Edit budget (`/spending?section=budgets`) · both themes
- What happens: typing letters ("seventy") in Pets' Monthly budget and pressing Save shows "Budget must be a **non-negative** amount (or blank to end the budget)" in a banner at the top of the card (banner top 258px; the editor is at ~800px) — pushing all 13 meters down ~50px. The box itself keeps its normal border (`aria-invalid` only). Fixing the value doesn't clear the banner; only the next Save does. A good save gives no confirmation except a new "Sep 2026 — $80.00 Delete" line; focus drops to `<body>`; Esc doesn't close the editor. The same "no red border" applies to every AmountInput outside the wizard/taxes (calendar amount, card fee, matrix multiplier, transaction shares).
- Evidence: shots/write-flows/v2-light-budget-error.png, budget-dark-02-negative-error.png, budget-dark-04-after-save.png; b2.out / v2.out.
- Cause: BudgetPanel.tsx:296-331 (`setError` → the card-level `FeedBanner` at :469); AmountInput.tsx:140-154 sets `aria-invalid` but there is no `[aria-invalid="true"]` style anywhere in the CSS (only `.field-input.invalid` in MonthlyUpdatePage.css:44 and taxes.css:164).
- Polish: render the message inside the editor under the field, word it by case ("Enter a number, e.g. 80" vs "Budgets can't be negative"), clear it on input, style `[aria-invalid="true"]` globally, and confirm the save with a brief check next to Save (plus flash the meter row that changed).
- Impact: budget edits are fixed where the eye is, with an accurate message.
- Size: S–M · Confidence: high

### WRITE-FLOWS-12 · Changing a category's kind "recomputes ALL history" on one click — no confirm, no Undo, and the whole table flashes disabled
- Where: Settings › Spending categories › Living / Tax / Transfer toggles
- What happens: the card's own note says changing a kind recomputes every month, chart and projection. Yet one click on the segmented control PATCHes immediately — no confirmation, no toast, no Undo (only via Settings › Data › Activity). The selection moves only when the reload returns, and during the request all ≈120 controls in the table (every toggle, Edit, Retire, Delete, plus Add category) switch to disabled and back (70ms in a quiet run) — a visible dim-flash of the whole card.
- Evidence: shots/write-flows/cat-dark-add-film/09-1766ms.jpg (the whole table dimmed during a write); s2.out (kind change: no toast; ≈120 `btn-disabled` flips at 5,623ms and back at 5,693ms).
- Cause: CategoriesCard.tsx:157-165 (`setKind` → track → reload); :378 + :409-431 (`locked = busy` disables every row's controls).
- Polish: move the selection optimistically, lock only the row being changed, and follow with a toast "Food & Dining is now Transfer — all months recomputed [Undo]". Consider a one-line inline confirm the first time a kind changes.
- Impact: a misclick on a history-rewriting control becomes a one-click fix, and the table stops blinking.
- Size: S · Confidence: high

### WRITE-FLOWS-13 · Delete toasts arrive before the row leaves; rows then vanish with no motion
- Where: Credit cards › Manage, Portfolio › Manage › Transactions (and Calendar)
- What happens: the "Deleted Audit Timing Card [Undo]" toast appeared **49ms** after the click, but the row stayed on screen (under the toast) until the page's full reload returned — **2,409ms** later here; transactions: toast at 148ms, row gone at 2,537ms. (Reloads were slow in this environment, but the order — "Deleted" while the row is still there — holds at any latency.) When the row finally goes it just disappears; the table below snaps up.
- Evidence: shots/write-flows/cc3-dark-04-after-delete.png (toast says Deleted, row still listed), cc4.out, p5.out.
- Cause: CardsPanel.tsx:286-289 (`reload()` then `toast.success` immediately); TransactionsPanel.tsx:476-478 (`onChangedRef.current()` = the page's 12-feed reload, then the toast).
- Polish: remove the row optimistically on success (fade + height collapse over --t-fast), then reconcile with the reload; on Undo, re-insert with the saved-row flash.
- Impact: the list and the toast agree instantly, and deletions feel deliberate instead of glitchy.
- Size: S–M · Confidence: high

### WRITE-FLOWS-14 · Developer-speak in validation and guard messages
- Where: Settings Accounts/password, Credit cards, Portfolio transactions
- What happens: messages shown verbatim to the user: "is_component needs parent_account_id — name the account it folds into"; "annual_fee must be non-negative" (shown for *letters* in the fee, not a negative); "Input should be a valid decimal" (letters in Shares — doesn't name the field); "String should have at least 8 characters" (empty password); "account has 38 balance rows — deactivate it instead" (lower-case start, and the UI's button is called **Retire**, not deactivate — same for categories). All of these persist after the user fixes the field until the next submit.
- Evidence: s5.out, cc3.out, p4.out, s7.out; shots/write-flows/acct-dark-04-guarded-delete.png, txn-dark-02-bad-shares.png.
- Cause: AccountsCard.tsx:57-60; CardsPanel.tsx:171 (+ CardDetail.tsx:144, CategoriesPanel.tsx:155); TransactionsPanel.tsx:453 and SettingsPage password path pass pydantic's 422 text through (api/client.ts:61-68 forwards 4xx text verbatim); backend/app/api/net_worth.py:324, spending.py:218.
- Polish: map field names to labels ("Pick the parent account this component folds into", "Annual fee must be a number ≥ 0", "Shares must be a number", "Password needs at least 8 characters"); for accounts/categories with history, disable Delete up front with a tooltip "Has 38 monthly balances — use Retire instead"; clear field errors on input.
- Impact: errors read like the app's own voice and point at the fix.
- Size: S · Confidence: high

### WRITE-FLOWS-15 · Household rename: focus lands on Cancel, Enter and Esc do nothing, the row re-wraps, and the error appears under the wrong form
- Where: Settings › Household › Rename (`/settings?section=household`) · 1440
- What happens: clicking **Rename Grace** swaps in a box + "Save name" + "Cancel" — but the box isn't focused; focus lands on **Cancel** (React reuses the old button node), so a keyboard user who presses Enter/Space cancels. Enter in the box doesn't save, Esc doesn't cancel. "Save name" wraps onto two lines in the 4-column card and the row grows ~18px, nudging the whole card. An empty name shows "Enter a name." below **Add member** (a different form) and the message stays after Cancel. Saving gives no confirmation, and focus drops to `<body>`.
- Evidence: shots/write-flows/hh-dark-01-rename-open.png ("Save name" wrapped), hh-dark-03-empty-rename.png (error under Add member); s4.out (focus on Cancel, Enter/Esc inert).
- Cause: HouseholdCard.tsx:134-178 (no `autoFocus`, not a `<form>`, no key handling), :154-157 (Cancel doesn't clear `formError`), :208-210 (one shared banner between the two forms).
- Polish: make the rename a small `<form>` (Enter saves, Esc cancels), autofocus+select the name, keep the buttons compact ("Save"/"Cancel" icons or a smaller size) so the row height holds, show the error under the rename box and clear it on Cancel.
- Impact: renaming a person becomes a two-second, keyboard-friendly edit.
- Size: S · Confidence: high

### WRITE-FLOWS-16 · The wizard's sticky bar shows totals but not the Save — Taxes already solved this
- Where: Monthly update › Balances and Spending steps vs Taxes › Inputs
- What happens: on the Balances step the Save button sits ~1,850px under the first field; the sticky bar riding the viewport bottom shows only "Net worth (live)" and its delta. Taxes › Inputs has the right pattern already: a sticky bar with "1 change to save · **Save inputs** · Ctrl+Enter". The wizard also never tells the user how many cells are dirty.
- Evidence: shots/write-flows/update-initial.png (sticky totals, no Save), bal-dark-05-footer-before-save.png (Save at the page bottom), tax2-dark-01-changed.png (Taxes' sticky save bar).
- Cause: MonthlyUpdatePage.tsx:2025-2037 (`.entry-footer` = totals only) and :2038-2065 (buttons below the table); compare InputsForm.tsx:859-881.
- Polish: fold "N changes · Save Sep 1 balances · Ctrl+S" into the wizard's sticky bar (right side), keep the totals on the left, and show the post-save receipt line there too (pairs with WRITE-FLOWS-01).
- Impact: save is always one glance and one click away while scanning a 30-row table, and the two biggest forms in the app behave alike.
- Size: M · Confidence: high

### WRITE-FLOWS-17 · Undo feels heavy in the wizard and silent on the Calendar
- Where: Monthly update toast Undo; Calendar delete/hide Undo
- What happens: Monthly update: Undo immediately toasts "Undone — Sep 2026 is back to how it was." while the card is still showing the saved values, dimmed and inert, until an 8-feed reload lands (2.2s in this environment); then the receipt card disappears and the whole form jumps up 160px, and the reverted cells don't flash — the user can't see *what* went back. Calendar: Undo of a delete or a hide shows no confirmation at all (every other Undo says "Undone — …" or "Order restored") and focus falls to `<body>`; "Mark done" gives no feedback beyond its label turning into "Reopen".
- Evidence: shots/write-flows/bal-dark-undo-film/08-390ms.jpg (toast says undone, old value still shown) → 13-2507ms.jpg (reverted, form jumped up); c2.out (calendar Undo: no toast).
- Cause: MonthlyUpdatePage.tsx:973-981 (success toast before `after()`), :554-558 (`reloadMonth` re-seeds everything), :1745-1750 (whole card `aria-busy`/`inert`); CalendarPage.tsx:486-495, :513-521 (Undo handlers without a success toast).
- Polish: in the wizard, patch the undone part's values locally (the batch knows what it wrote), flash the reverted cells, collapse the receipt with a height transition, and toast after the values are back. On the Calendar, toast "Restored …" / "Shown again" and return focus to the event chip.
- Impact: Undo becomes a trustworthy, visible reversal everywhere.
- Size: M · Confidence: high

### WRITE-FLOWS-18 · Taxes inputs: which cell changed? And "No changes yet" right after a save
- Where: Taxes › Inputs (`/taxes?section=inputs`)
- What happens: the live preview is excellent (Other W2 Income updates to $149,300.00 while typing, via a 27ms preview). But the edited cell looks exactly like every other cell, so "1 change to save" doesn't say *which* of ~60 boxes changed. After Ctrl+Enter the bar flips to "No changes yet" — reads as if nothing happened. Focusing a money box shows the stored 4-decimal text (**"300.0000"**, "0.0000") instead of "300.00". There is no "Discard changes" for the whole form (only per-cell Esc, which only reverts edits made since that cell was focused).
- Evidence: shots/write-flows/tax2-dark-01-changed.png (changed cell unmarked; Grace's focused box shows 0.0000), tax2-dark-02-saved.png ("300.0000", "No changes yet"); t2.out.
- Cause: components/taxes/InputsForm.tsx:790-797 (cell classes: invalid/pasted-flash/wide only), :861-865 (footer copy); AmountInput.tsx:139 shows the raw state text on focus and the save echo seeds 4-dp strings.
- Polish: tint changed cells (e.g. accent left border) and let the count be a "jump to next change" link; after save show "Saved ✓ just now" for a few seconds; trim money boxes' focused text to 2 dp; add "Discard changes" beside Save.
- Impact: tax edits are reviewable before saving and clearly confirmed after.
- Size: S–M · Confidence: high

### WRITE-FLOWS-19 · The "Month closed" receipt buries the news
- Where: Monthly update › Review › Save and close (`/update?month=2026-08-01&step=review`)
- What happens: closing a month — the ritual's finish line — produces a card whose heading is a small muted eyebrow ("MONTH CLOSED") and whose body lines, in larger text, say "Balances: unchanged — not sent." and "Spending: unchanged — not sent." It reads like nothing happened. The status pill then says "Reviewed · Last closed **9/24/2026**" — a numeric locale date, unlike the app's "Sep 24, 2026" everywhere else. Toast, receipt and pill use three different phrasings ("Closed Aug 2026", "Month closed", "Reviewed · Last closed …").
- Evidence: shots/write-flows/review-dark-02-after-close.png.
- Cause: MonthlyUpdatePage.tsx:197-205 (`receiptTitle`), :1716-1726 (receipt lines), :2278 (`toLocaleDateString()`).
- Polish: lead with an outcome sentence ("August 2026 is closed — its figures are now final.") with a check icon; demote the per-part "not sent" lines to muted small text (or omit them for a close with no edits); format the date with the app's date formatter.
- Impact: closing a month feels like completion, and dates read consistently.
- Size: S · Confidence: high

### WRITE-FLOWS-20 · Calendar add/edit: the panel reflows the page in two jolts, and the new event pops in late
- Where: Calendar › Add event / Edit (`/calendar`) · both themes, 1440
- What happens: opening the form, the panel's fields fade in *over* the full-width page (overlapping the header buttons and the NET/VESTING tiles, frame at 227ms), then the page snaps narrower (5 KPI tiles re-wrap into 3 + 2; the grid shrinks; "Add to calen|dar" is clipped under the panel mid-way). Saving reverses it: the panel fades, the grid snaps back to full width, the tiles re-wrap to one row, the target day gets a ring — and the event chip appears only when the month refetch returns, with no entrance. No toast confirms the add or the edit. Enter in the Title box doesn't save; the amount error ("Amount must be a plain number.") stays after the fix.
- Evidence: shots/write-flows/cal-dark-addform-open-film/02-227ms.jpg (form over the full-width page; 04-315ms.jpg mid-reflow); cal-dark-save-film/05-209ms.jpg (panel gone, grid still narrow, day empty) → cal-dark-03-after-save.png.
- Cause: CalendarPage.tsx:359-385 (form lives in the shell's detail panel, which pushes the content column), :434-470 (`saveForm` closes the form, then `landOn` refetches); AddEventForm.tsx is not a `<form>`.
- Polish: animate the content column's width with the panel (or overlay the panel so the grid doesn't reflow), insert the saved event optimistically into its day with the saved flash, and add a short "Added Audit test event · Sep 28" toast. Make the add form a `<form>` so Enter saves.
- Impact: adding an event feels like one smooth motion ending on the new chip, instead of three separate jumps.
- Size: M · Confidence: medium (the panel motion is shared shell behaviour; the motion lane may also report it)

### WRITE-FLOWS-21 · Projection pins: the limit is enforced by a toast, and the name you typed is wiped
- Where: Projection › Compare your scenarios › pin row (`/projection`)
- What happens: at "3/3 pinned" the **Pin this scenario** button still looks live; clicking it shows an info toast "Unpin one first" *and* clears the label the user just typed ("Nine" → empty). Enter in the label box doesn't pin. Unpinning (×) drops focus to `<body>`.
- Evidence: shots/write-flows/proj2-dark-02-limit.png; pr2.out.
- Cause: sandbox/SandboxPanel.tsx:143-155 (`setLabel('')` runs even when `pin()` refuses); sandbox/useSandbox.ts:346-349.
- Polish: disable Pin at the limit with the reason beside it ("Unpin one to pin another"), keep the typed label, make the label + button a form (Enter pins), move focus to the neighbouring chip after an unpin.
- Impact: small, but it removes a surprise from a planning flow users repeat.
- Size: S · Confidence: high

### WRITE-FLOWS-22 · The Activity card — where every later Undo lives — shows plumbing
- Where: Settings › Data › Activity (`/settings?section=data`)
- What happens: rows carry raw source badges "UI", "UNDO", "RUN"; each Undo produces three rows ("UI Deleted Aug 2026 spending — undone", "UNDO Undid: Deleted Aug 2026 spending [Undo]", "RUN Undo [View report]"), and the button on an UNDO row is also labelled "Undo" (it is really a redo). Scanning "what did I change today?" means reading through the machinery.
- Evidence: shots/write-flows/s7-dark-03-activity.png.
- Cause: components/settings/ActivityCard.tsx:142 (`{entry.source}` printed raw), :159 (run rows).
- Polish: human source labels ("You", "Undo", "Import"), fold an undo's run row and its "Undid" row into the original entry ("Deleted Aug 2026 spending · undone 5:08 PM [Redo]"), and call the reverse of an undo "Redo".
- Impact: the safety net is readable when it's needed most.
- Size: S–M · Confidence: high

### WRITE-FLOWS-23 · A restored draft doesn't show what it restored
- Where: Monthly update, after leaving mid-edit and coming back
- What happens: the banner "Restored unsaved Sep 1 balances — they are not saved yet. [Discard restored balances]" is good, but it doesn't say which of the 30 cells hold unsaved values (my edit was Petty Cash, 1,000px down), and the restored cells aren't marked. Discard gives no confirmation and drops focus.
- Evidence: shots/write-flows/u8-restored-banner.png; u8.out.
- Cause: MonthlyUpdatePage.tsx:1695-1710 (generic banner; the diff vs `balancesBase` is known but not surfaced).
- Polish: name the count and first cell ("1 balance restored: Petty Cash") as a link that scrolls to it, and flash the restored cells with the existing pasted-flash.
- Impact: users can confirm or drop a draft knowingly.
- Size: S · Confidence: high

## Strengths to keep (≤6)
- **Reorder** (Settings lists, cards, transactions): grip lift by Space/arrows with live-region announcements ("Picked up Bills & Utilities. Position 2 of 19."), smooth peer shifting, lifted-row styling, a saved-row flash, and a "Moved X [Undo]" → "Order restored" toast pair.
- **AmountInput** entry feel: select-all on focus, raw text while typing, formatted on blur, Esc reverts the cell, "=" arithmetic, Enter walks down the column, Enter-Enter / Ctrl+S / Ctrl+Enter save — and the Δ column + live totals react on every keystroke (a real typo tripwire).
- **Unsaved-work drafts**: moving to the next step says "kept as a draft", leaving the page and coming back restores the work with a Discard option; Taxes adds a `beforeunload` guard.
- **Toast mechanics**: hover/focus pause the clock, errors use an assertive region, Undo is one-shot (double-click safe), exit animation is short (120ms).
- **Taxes sticky save bar + live preview** (derived figures update in ~30ms while typing) — the model the wizard should copy.
- **Carry-forward after adding a transaction** ("Add another" + "Security, account and date kept") and **card add returning the caret to Card name** — the sheet-like rhythm is right.

## Not reproduced / environment artifacts
- Slow writes/reloads: single requests of ~2.1s appeared whenever ≥6 GETs fired together (balances PUT 2.07s once → 252ms on re-measure; category add 1.7s once → 107ms; calendar refetch 2.5s in-browser vs 0.1s via curl; card/transaction reloads ~2.4s). Consistent with the local preview proxy / per-host connection limit, so no performance finding is made; WRITE-FLOWS-13 is about the ordering (toast before row removal), which holds at any latency.
- "Couldn't load the portfolio — The user aborted a request." appeared once on /portfolio?section=manage; 0 of 3 later loads (both stacks) reproduced it. (If it ever recurs, that raw browser sentence is poor copy.)
- Playwright logged DELETE (204) requests as "failed"; every delete succeeded (verified through the API).
- "Prices never refreshed" on Portfolio: local scheduler is off.
- Comp event delete: my probe didn't open its confirm dialog (its button label differs); the Comp entry in WRITE-FLOWS-03 rests on the code (CompPage.tsx:297 `window.confirm`), the ESPP/Paycheck/Security dialogs were observed.
- Data hygiene: every test write was reversed (categories 39–41, account 56, cards 9–10, transactions 107–108, calendar events 2–3 deleted; month saves/close/part delete, category reorders and the budget re-seed undone; Grace, the Travel·Flights multiplier, W2 Other, Food & Dining and Pets budgets restored). Only new Activity rows and two neutral calendar override rows (done=false/hidden=false) remain.
