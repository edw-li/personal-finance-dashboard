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

- [ ] Add behavioral checks for the pressed button's busy state, preserved focus,
  close failure retaining selection, and transient success beside Close.
- [ ] Separate history loading from closing; use shared save state for Close and
  clear its errors when the selection changes. Keep selected revisions unchanged.
- [ ] Run `npx vitest run src/components/monthly/HistoricalReview.test.tsx --maxWorkers=2`.
- [ ] Commit the completed change.

### 2. Tax input saves and validation

- [ ] Check invalid numeric and fractional count cells focus the first invalid
  input and report the problem in the sticky save bar without a request.
- [ ] Check failed saves preserve edits, the next edit clears the error, and a
  successful save shows transient status without losing focus.
- [ ] Run the existing diff/column/paste/preview/draft tests with the new feedback.
- [ ] Adopt `useSaveState` around the existing request and echo path. Keep the
  save control at the right edge in clean, dirty and error states.
- [ ] Run `npx vitest run src/components/taxes/InputsForm.test.tsx --maxWorkers=2`.
- [ ] Commit the completed change.

### 3. Shared confirmation in tax menus and page guards

- [ ] Replace TaxYearMenu's armed confirmation with `useConfirm`; Cancel and Esc
  keep the parent menu open and return focus to Delete. Accept names the exact year.
- [ ] Thread the actual initiating element through filing-status changes, year
  changes, new-year creation, Retry, what-if Apply and status Undo. Callbacks that
  close a menu wait for an accepted operation instead of dismissing its anchor.
- [ ] Replace synchronous discard guards with awaited confirmation and retain
  the existing stale-response and single-flight protections.
- [ ] Cover clean switching, declined discard, accepted discard, drafts cleared
  only after acceptance, and menu focus behavior with ConfirmProvider in tests.
- [ ] Run the affected menu and TaxesPage tests; commit.

### 4. Bracket table saves

- [ ] Give each rendered table its own dirty/save status derived from the loaded
  table for that key; changing one table must not enable another table's Save.
- [ ] Replace empty-table/removal and tab-discard native confirmation with the
  anchored shared confirmation. Preserve default/fallback semantics.
- [ ] Show busy on Clone, Save or Remove as appropriate; other actions stay inert.
- [ ] Check request failure, no-op saves, successful echoes, fallback reset,
  draft retention, tab cancellation and per-person payroll tables.
- [ ] Run BracketsEditor tests and commit.

### 5. Tax Apply operations and named-field navigation

- [ ] Use `putTaxInputsLogged` for vest and what-if Apply. Success offers
  `undoBatch` only when a batch id exists; Undo refreshes the appropriate year
  without overwriting a different year or silently discarding newer input edits.
- [ ] Show Apply errors beside its control. A dirty-input warning uses the shared
  confirm; what-if confirmation lists the changes being written.
- [ ] Pass the named cell to LocalSections when opening Inputs and focus/flash
  it after that view mounts, including per-person ids where applicable.
- [ ] Test exact batch ids, null batches, refused Undo, changed scope, declined
  confirmation and field targeting; run affected tax tests and commit.

### 6. Monthly update actions

- [ ] Record which save action started the existing operation; only that button
  is busy across Balances, Spending and Review. Preserve all existing guards.
- [ ] Replace the part-delete typed arm with an anchored in-app confirmation
  inside the kebab. Keep its existing batch Undo and revision behavior.
- [ ] Remove the page's duplicate `.danger-button`; scope its footer layout so
  it cannot override the tax save bar.
- [ ] Test declined/accepted deletion, parent-menu focus, Save progress versus
  Save and close busy indicators, errors and focus after save.
- [ ] Run MonthlyUpdatePage tests and the native-confirm fence; commit.

### 7. Browser proof, review and final gates

- [ ] Run this worktree's Vite on 5278, private dependency cache, proxying only to
  the existing local writable backend 8088 (`finance_polish_w8`). Use the recovered
  audit harness with `APP_BASE=http://127.0.0.1:5278` and writes enabled only there.
- [ ] In both themes check sticky Inputs errors and focus, Save alignment, named
  field links, Apply/Undo, nested-menu Cancel/Esc and Review button width/focus.
  Assert no native dialog and no unexpected console/page/API errors. Restore test
  changes on the local copy, close browsers, stop the lane's Vite.
- [ ] `npx tsc -p tsconfig.app.json --noEmit` and the node project: clean. Never
  `tsc -b`, because the worktree shares node_modules via a junction.
- [ ] `npx eslint .`: no errors or additional warnings over the baseline 26.
- [ ] Coordinate the whole `npx vitest run --maxWorkers=4` with the other lanes.
- [ ] Independent review, resolve findings, append As built and commit.

## As built

Pending implementation.
