# Polish L8 — Taxes and Monthly update

Continues the approved 2026-09-25 polish design, sections 5 and 6.4, from local main
`204ef73d`. The earlier session stopped during source inspection; this lane had no
implementation changes. Worktree: `.worktrees/polish-taxes-monthly`; branch:
`feat/polish-taxes-monthly`. Delivery stays on local main after review, without a push
or deployment.

## Behavior and boundaries

Use the shared feedback controls already merged in L4. Preserve the tax inputs'
column ownership, saved baselines, previews and local drafts; preserve bracket
fallbacks and scope guards; preserve month revisions, confirmations, receipts and
existing batch Undo. This lane changes the feedback around those operations, not
the financial calculations. Leave L1's table columns and L2's tile rows intact.

Confirmation is asynchronous and anchored to the control that requested it. Capture
the anchor before awaiting, leave enclosing menus mounted while the question is
open, and check that the requested year/status still applies before executing an
accepted action. Use inline options with `useConfirm` and remove converted entries
only from the L8 block of `noNativeConfirm.test.ts`.

Every asynchronous button uses `BusyButton` with `.button`. Form saves use the
existing dirty comparison with `useSaveState`, `SaveButton` and `SaveStatus`, with
the specified "Saved just now" wording on Inputs. Request errors stay beside the
action; editing clears a stale error. Preserve focus when busy and after completion.

## Files

- `src/components/monthly/HistoricalReview.tsx` and its tests: close feedback.
- `src/pages/MonthlyUpdatePage.tsx`, `.css` and tests: button-specific busy states,
  the part-delete confirmation, and the duplicate danger style.
- `src/components/taxes/InputsForm.tsx` and tests: sticky validation/save feedback.
- `src/components/taxes/BracketsEditor.tsx` and tests: per-table dirty/save feedback,
  table removal and tab-discard confirmation, clone busy state.
- `src/components/taxes/TaxYearMenu.tsx`, `FilingStatusMenu.tsx` and their tests:
  preserve menus and initiating anchors through asynchronous confirmation.
- `src/pages/TaxesPage.tsx` and tests: discard guards, what-if Apply with batch Undo,
  refreshed scope and focus after actions.
- `src/components/taxes/WithholdingPanel.tsx`, `WhatIfPanel.tsx` and tests:
  named-field navigation, vest Apply with batch Undo, and action anchors.
- `src/components/taxes/taxes.css`: action positioning and field reveal spacing.
- `src/components/feedback/noNativeConfirm.test.ts`: remove this lane's six calls.
- This plan: record implementation decisions, checks and review results.

## Tasks

### 1. Historical review feedback

- [x] Add behavioral checks for the pressed button's busy state, preserved focus,
  close failure retaining selection, and transient success beside Close.
- [x] Separate history loading from closing; use shared save state for Close and
  clear its errors when the selection changes. Keep selected revisions unchanged.
- [x] Run `npx vitest run src/components/monthly/HistoricalReview.test.tsx --maxWorkers=2`.
- [x] Commit the completed change.

### 2. Tax input saves and validation

- [x] Check invalid numeric and fractional count cells focus the first invalid
  input and report the problem in the sticky save bar without a request.
- [x] Check failed saves preserve edits, the next edit clears the error, and a
  successful save shows transient status without losing focus.
- [x] Run the existing diff/column/paste/preview/draft tests with the new feedback.
- [x] Adopt `useSaveState` around the existing request and echo path. Keep the
  save control at the right edge in clean, dirty and error states.
- [x] Run `npx vitest run src/components/taxes/InputsForm.test.tsx --maxWorkers=2`.
- [x] Commit the completed change.

### 3. Shared confirmation in tax menus and page guards

- [x] Replace TaxYearMenu's armed confirmation with `useConfirm`; Cancel and Esc
  keep the parent menu open and return focus to Delete. Accept names the exact year.
- [x] Thread the actual initiating element through filing-status changes, year
  changes, new-year creation, Retry, what-if Apply and status Undo. Callbacks that
  close a menu wait for an accepted operation instead of dismissing its anchor.
- [x] Replace synchronous discard guards with awaited confirmation and retain
  the existing stale-response and single-flight protections.
- [x] Cover clean switching, declined discard, accepted discard, drafts cleared
  only after acceptance, and menu focus behavior with ConfirmProvider in tests.
- [x] Run the affected menu and TaxesPage tests; commit.

### 4. Bracket table saves

- [x] Give each rendered table its own dirty/save status derived from the loaded
  table for that key; changing one table must not enable another table's Save.
- [x] Replace empty-table/removal and tab-discard native confirmation with the
  anchored shared confirmation. Preserve default/fallback semantics.
- [x] Show busy on Clone, Save or Remove as appropriate; other actions stay inert.
- [x] Check request failure, no-op saves, successful echoes, fallback reset,
  draft retention, tab cancellation and per-person payroll tables.
- [x] Run BracketsEditor tests and commit.

### 5. Tax Apply operations and named-field navigation

- [x] Use `putTaxInputsLogged` for vest and what-if Apply. Success offers
  `undoBatch` only when a batch id exists; Undo refreshes the appropriate year
  without overwriting a different year or silently discarding newer input edits.
- [x] Show Apply errors beside its control. A dirty-input warning uses the shared
  confirm; what-if confirmation lists the changes being written.
- [x] Pass the named cell to LocalSections when opening Inputs and focus/flash
  it after that view mounts, including per-person ids where applicable.
- [x] Test exact batch ids, null batches, refused Undo, changed scope, declined
  confirmation and field targeting; run affected tax tests and commit.

### 6. Monthly update actions

- [x] Record which save action started the existing operation; only that button
  is busy across Balances, Spending and Review. Preserve all existing guards.
- [x] Replace the part-delete typed arm with an anchored in-app confirmation
  inside the kebab. Keep its existing batch Undo and revision behavior.
- [x] Remove the page's duplicate `.danger-button`; scope its footer layout so
  it cannot override the tax save bar.
- [x] Test declined/accepted deletion, parent-menu focus, Save progress versus
  Save and close busy indicators, errors and focus after save.
- [x] Run MonthlyUpdatePage tests and the native-confirm fence; commit.

### 7. Browser proof, review and final gates

- [x] Run this worktree's Vite on 5278, private dependency cache, proxying only to
  the existing local writable backend 8088 (`finance_polish_w8`). Use the recovered
  audit harness with `APP_BASE=http://127.0.0.1:5278` and writes enabled only there.
- [x] In both themes check sticky Inputs errors and focus, Save alignment, named
  field links, Apply/Undo, nested-menu Cancel/Esc and Review button width/focus.
  Assert no native dialog and no unexpected console/page/API errors. Restore test
  changes on the local copy, close browsers, stop the lane's Vite.
- [x] `npx tsc -p tsconfig.app.json --noEmit` and the node project: clean. Never
  `tsc -b`, because the worktree shares node_modules via a junction.
- [x] `npx eslint .`: no errors or additional warnings over the baseline 26.
- [x] Coordinate the whole `npx vitest run --maxWorkers=4` with the other lanes.
- [x] Independent review, resolve findings, append As built and commit.

## As built

Implemented through `548c4b09`, following the plan committed in `477b258f`.
Task commits are `ae09b79d` (Historical review), `af50c5db` (Inputs),
`14847005` (asynchronous toast actions), `00e6f83e` (tax menus and tables),
`fc16cc86` (Monthly actions), `82e18eb7` (Apply, navigation and focus), and
`548c4b09` (final shared and filing-status Undo focus corrections).

### Result

- Historical review distinguishes loading from Close, holds the pressed button's
  focus and width, and reports save state beside it.
- Inputs uses its existing dirty comparison and request/echo path with shared
  save state. Validation focuses the first invalid cell, with the message in the
  sticky bar. The shortcut precedes Save so clean, dirty and failed states keep
  the same right edge. The invalid row clears the bar rather than hiding below it.
- Bracket tables each own their save state. Shared anchored confirmation replaces
  native dialogs for removing tables, saving an empty table and abandoning a tab.
  Discarding a new table returns focus to its surviving Add table control.
- Year and filing-status menus preserve their initiating controls through Cancel
  and Escape. Asynchronous discard guards recheck scope before writing.
- Vest and what-if Apply use the logged inputs client. What-if confirmation lists
  the actual changed values. Undo uses the returned batch id and refreshes the
  restored year; newer input drafts require confirmation, and another active year
  is not overwritten. A declined discard keeps Undo available. Apply errors stay
  beside their control. Named Inputs links focus and flash the person-qualified
  field after the section mounts.
- Monthly save buttons own separate busy states. Part deletion uses the shared
  question inside the existing menu; its revision and batch-Undo behavior stays.
  Undo and deleting the last stored part return focus to the stable active step.
  The footer CSS is scoped to the actual Monthly page so it cannot move Tax Save.

### Shared touch and review

`ToastProvider.tsx`, `useDeleteWithUndo.ts` and their tests are the shared touches
outside the original lane list. Awaited confirmation requires an Undo action to remain
mounted and keep its timer paused until the action settles. The provider now
accepts a returned promise, blocks duplicate activation, preserves an action when
it resolves `false`, and consumes it on success or failure. Existing synchronous
actions keep their behavior. Tests cover deferred completion, rejected actions,
declined confirmation, timer resumption and manual dismissal without resurrection.
The shared provider plus delete-hook focused gate passed **33 tests**.

Final integration review found that the delete hook still discarded its Undo
promise and had no focus fallback when the restored row was absent from the
current list. It now returns the promise, falls back to a surviving control, and
respects a newer focus choice. Three regressions failed before the fix; the shared
provider/hook gate then passed **36 tests**. A second review also caught filing-status
Undo stealing focus selected while its request was pending. Its deferred-refusal
regression failed before adding the same guarded focus return as Apply Undo.

Independent L7 review found three focus defects: a refused Apply Undo could lose
its toast anchor, a late vest Apply could steal focus from another control, and
discarding a new bracket table could remove its focused button. All three are
fixed with regressions. Browser checks also exposed the Tax shortcut moving Save
and the Monthly root class missing from the populated page; both were corrected
and the affected browser flows rerun successfully.

### Verification

- Final focused tax/Monthly regression run: **5 files / 459 tests passed**.
- TypeScript app and node projects: both `--noEmit` checks clean.
- ESLint: **0 errors / 26 existing warnings**.
- Whole frontend gate at `82e18eb7`: **322 files / 4,783 tests passed** in 247.28 s.
- Final review fixes: **3 files / 144 tests passed**, plus clean app TypeScript and
  changed-file ESLint. The final merged-main whole-suite run covers these last fixes.
- `git diff --check`: clean.

Headless Edge used the private worktree Vite on 5278 and the existing copied
writable database behind 8088, with scheduler and snapshots disabled. Both dark
and light passed the following at 1440 by 900 with classic scrollbars:

- Invalid last-cell focus fully above the sticky error bar; editing clears the
  error. Save's right edge stayed **1356.609 px**, and busy width stayed
  **101.438 px**. Saved just now appeared without losing focus.
- Actual Tax save was reversed through its batch and the entire inputs API result
  matched its before image. Vest Apply and what-if Apply were each reversed through
  UI Undo with exact API equality. The vest check included a dirty-input guard.
- Delete-year and filing-status discard Cancel/Escape retained the enclosing menu
  and its trigger. Open Inputs focused and flashed `w2_stock_rsus_sold:1`.
- Monthly Save and close held **168.891 px** with Save progress inert and not busy.
  Its UI Undo restored the prior review state and close timestamp. Monthly part
  delete Cancel/Escape retained the menu; accepted deletion followed by UI Undo
  restored the exact balances API image.
- Focus remained on useful controls after the checked saves/deletes/Undo. There
  were **zero native dialogs, page errors, console errors or unexpected API errors**.

Private scripts, logs, screenshots and before/after API evidence are under
`%TEMP%/codex-polish-L8/work-L8` (`flows4.log`, `flows-results.json`,
`remaining3.log`, `remaining-results.json`). All test writes were undone, browsers
closed and the owned Vite stopped. Lane V repeats integrated acceptance on a fresh
production copy; these lane checks do not substitute for that final gate.
