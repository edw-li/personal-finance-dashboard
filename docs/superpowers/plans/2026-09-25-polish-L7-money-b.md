# Polish L7 — Cards, Calendar, Budgets, Projection and Assistant

**Goal:** apply the approved 2026-09-25 polish design, §5 and §6.4, to this lane. All reversible deletes use the server's exact batch Undo. Forms answer beside their controls and move focus deliberately.

**Branch:** `feat/polish-money-b`, based on `204ef73d`. **Worktree:** `.worktrees/polish-money-b`.

**Stack:** React 19, TypeScript, Vitest/Testing Library, writable FastAPI copy on 8087, private Vite on 5277. No pushes, merges, deployments, production writes, or `tsc -b`.

**Execution:** the recovered assignment names Claude superpowers skills that are not available in this Codex session. Their plan-first and red/green process is preserved here using the available file, shell and browser tools. No child agents. Tests during development use at most two workers; the coordinator schedules the full suite and build.

## File structure

- `src/components/creditcards/CardsPanel.tsx`, `CategoriesPanel.tsx`: roster forms, optimistic row toggles, exact deletes, focus.
- `src/components/creditcards/RewardsMatrix.tsx`, `matrix.css`: sticky editor and discard confirmation.
- `src/components/creditcards/CardDetail.tsx`, `carddetail.css`: independent credit/limit save state and exact deletes.
- `src/pages/CreditCardsPage.tsx`: awaitable reload contract; matrix saved rates stay in page state.
- `src/pages/CreditCardsPage.test.tsx`, `src/components/creditcards/RewardsMatrix.test.tsx`: behavioral regressions using their existing typed fixtures.
- `src/components/creditcards/roster.css`, `categories.css`: action feedback and edit marker only, where needed.
- `src/pages/CalendarPage.tsx`, `CalendarPage.css`: awaitable refresh, active-day default, saved chip landing, logged overrides.
- `src/components/calendar/AddEventForm.tsx`, `EventDetails.tsx`, `DayDrawer.tsx`: keyboard submission, title/amount focus, stable row hooks.
- `src/pages/CalendarPage.test.tsx`, `src/components/calendar/EventDetails.test.tsx`: calendar behavior.
- `src/components/spending/BudgetPanel.tsx`, `budgets.css`, `BudgetPanel.test.tsx`: local validation, saved status, exact history Undo, re-seed confirmation.
- `src/sandbox/SandboxPanel.tsx`, `useSandbox.ts`, their tests and `sandbox.css`: pin capacity, preserved draft label, Enter and focus after Unpin.
- `src/components/assistant/AssistantEvidence.tsx` and its tests: confirm irreversible removal and preserve focus.
- This plan. Local browser scripts and logs live in untracked `work-L7/`.

Shared APIs are already implemented; no API-client or feedback primitive changes are planned. `[aria-invalid]` styling can be local to budgets. Wave-1 layout and tile structures stay intact.

## Contracts and implementation details

All confirm calls use `const ask = useConfirm()` and inline object-literal options. `BusyButton` always has `.button`. Delete hooks live in the list owner and always receive `restoredRow`. Async reload callbacks are read through `useLatest`; the page reload returns its promise so a delete hook can await the actual data change. No `startTransition` reloads.

For a list save, clear the form after blurring its AmountInput, await the latest reload, then reveal/flash the saved row and focus its Edit. The row's stable id supplies its DOM selector; display names do not. Cancel/Escape returns to the edited row. Row mutations report errors through toast; validation stays by the action row.

For row toggles, keep an optimistic override map keyed by row id and a separate set of pending row ids. Reorder grips remain parked while a row mutation runs, but unrelated row actions do not. Full card PATCH bodies retain every nullable column and sort order; reward-category PATCH sends only `is_active`. A successful logged toggle offers `undoBatch(batchId)`, reloads through the latest callback, flashes the restored row, returns focus and says what was restored. Failure removes the optimistic override and toasts the server's sentence.

## Task 1 — Record plan

- [x] Read the overview, approved decisions D2–D5, §5, §6.4, and wave-1 as-built contracts.
- [x] Inspect actual lane components and their existing tests.
- [x] Commit this plan before product edits.

Command: `git add docs/superpowers/plans/2026-09-25-polish-L7-money-b.md` then `git commit -m "docs(plan): record L7 feedback and exact undo work"`. Expected: one new plan file; no product changes.

## Task 2 — Cards and reward categories

- [x] Add regressions to the page suite; observe red before implementation.
- [x] Replace lossy re-POST Undo with `useDeleteWithUndo` in each panel.
- [x] Add form refs, edit baselines, `useSaveState`, `SaveButton`, `SaveStatus`, `useEscapeCancel` and stable row ids.
- [x] Make archive/hide optimistic per row and use logged clients plus batch Undo.
- [x] Return the page load's Promise and widen child reload callback return types to `void | Promise<void>`.
- [x] Update old tests that deliberately expected re-created ids or native disabled controls.
- [x] Run targeted page suite and commit.

Complete focus regression, using the page suite's existing fixtures and `renderPage` helper:

```tsx
it('reveals the last card editor and returns focus on Escape', async () => {
  renderPage('/credit-cards?section=manage')
  const edit = await screen.findByRole('button', { name: 'Edit RH Gold' })
  fireEvent.click(edit)
  const name = screen.getByLabelText('Card name')
  expect(document.activeElement).toBe(name)
  expect(edit.closest('tr')?.getAttribute('aria-current')).toBe('true')
  fireEvent.keyDown(name, { key: 'Escape' })
  expect(document.activeElement).toBe(edit)
  expect(screen.queryByRole('button', { name: 'Save card' })).toBeNull()
})
```

The exact-delete test must return `{ batchId: 'card-delete' }`, make the subsequent fetch omit the card, press Undo, and assert `undoBatch('card-delete')`, the original card id and restored control focus. No `createCreditCard`, `createCardCredit`, or `createLimitEvent` call may occur. The equivalent category test asserts restored cells via browser API comparison.

Complete implementation shape for the delete handler (card, same shape for categories):

```tsx
const remove = (card: CreditCardOut) => {
  void track(() => deleteWithUndo({
    name: card.name,
    row: rowFor(card.id),
    request: () => deleteCreditCard(card.id),
    onDeleted: async () => {
      if (editingRef.current === card.id) resetForm()
      await reload()
    },
    focusAfter: () => panelRef.current?.querySelector<HTMLElement>('[data-row-edit]') ?? formRef.current?.querySelector<HTMLElement>('input') ?? null,
    onRestored: reload,
    restoredRow: () => rowFor(card.id),
  }))
}
```

Command: `npx vitest run src/pages/CreditCardsPage.test.tsx --maxWorkers=2`. Expected: all page tests pass, including existing reorder concurrency guards.

## Task 3 — Matrix editor

- [x] Add failing tests for selected-field focus, Escape back to cell, changed-count, discard confirmation and failed save in the bar.
- [x] Move Save/Cancel into `.mx-editor-bar`, sticky at bottom 0 inside the matrix card.
- [x] Keep drafts as currently edited values; compare numeric amounts canonically to stored values so untouched `3.00` is not dirty against `3`.
- [x] Make editor a form: Enter validates the picked cell and returns focus to it. Save validates every changed cell, focuses its invalid field and submits only changed puts.
- [x] Cancel with changes asks `Discard N changed cells?`; cancellation leaves drafts intact.
- [x] On successful save clear drafts, leave edit mode, retain the saved status beside Edit and flash affected stable matrix cells.
- [x] Run matrix and page suites and commit.

Complete discard/focus test using `CARD`, `CATEGORY`, `RATE` from the existing matrix test file:

```tsx
it('keeps changed cells until discard is confirmed', () => {
  const weights = new Map<number, number | null>([[1, 4000]])
  render(<ConfirmProvider><RewardsMatrix cards={[CARD]} categories={[CATEGORY]} rates={[RATE]}
    result={optimize(toMathCards([CARD]), toMathCategories([CATEGORY], weights), toMathRates([RATE]))}
    weights={weights} ownerNames={new Map()} busy={false} onCardClick={vi.fn()} onSaveRates={vi.fn()} /></ConfirmProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Edit multipliers' }))
  const cell = screen.getByRole('button', { name: 'Edit Groceries on SavorOne' })
  fireEvent.click(cell)
  const input = screen.getByLabelText('Multiplier')
  expect(document.activeElement).toBe(input)
  fireEvent.change(input, { target: { value: '4' } })
  expect(screen.getByText('1 cell changed')).toBeTruthy()
  fireEvent.keyDown(input, { key: 'Escape' })
  expect(document.activeElement).toBe(cell)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.getByRole('alertdialog', { name: 'Discard 1 changed cell?' })).toBeTruthy()
})
```

Complete confirmation handler:

```tsx
const cancel = async (anchor: HTMLButtonElement) => {
  if (changedKeys.length > 0 && !(await ask({
    anchor,
    title: `Discard ${changedKeys.length} changed ${changedKeys.length === 1 ? 'cell' : 'cells'}?`,
    body: 'Your multiplier edits have not been saved.',
    confirmLabel: 'Discard changes',
  }))) return
  stopEditing()
  requestAnimationFrame(() => editButtonRef.current?.focus())
}
```

Command: `npx vitest run src/components/creditcards/RewardsMatrix.test.tsx src/pages/CreditCardsPage.test.tsx --maxWorkers=2`.

## Task 4 — Card details

- [x] Add failing credit/limit exact-Undo and local-error tests in the page suite.
- [x] Give each form independent validation and save state; clear only its own errors on input.
- [x] Repeat-entry saves retain focus in their first input, reveal/flash the created row and show Saved.
- [x] Credit and limit deletes use list-owned `useDeleteWithUndo`; fallback focus goes to the respective form input when the last row disappears.
- [x] Existing credit count/cadence errors become toasts.
- [x] Run page suite and commit.

Complete limit delete handler:

```tsx
const removeLimit = (eventId: number) => {
  const event = card.limit_events.find((row) => row.id === eventId)
  if (!event) return
  void deleteWithUndo({
    name: `the ${event.effective_date} limit event`,
    row: document.getElementById(`limit-row-${eventId}`),
    request: () => deleteLimitEvent(card.id, eventId),
    onDeleted: reload,
    focusAfter: () => limitFormRef.current?.querySelector<HTMLElement>('input') ?? null,
    onRestored: reload,
    restoredRow: () => document.getElementById(`limit-row-${eventId}`),
  })
}
```

Command: `npx vitest run src/pages/CreditCardsPage.test.tsx --maxWorkers=2`.

## Task 5 — Calendar

- [x] Add failing tests for active-day default, edit title focus, form submission and batch Undo.
- [x] `AddEventForm` becomes a real form with SaveButton/SaveStatus; error clears on field edit.
- [x] Add opens on `cursorDay`; edit opens on title. Esc/Cancel returns to a live calendar landmark.
- [x] Save awaits reload, bumps focusTick and flashes the chip once the corresponding fetched event is in the DOM. Handle a saved date in another month and list view too.
- [x] Delete uses exact batch Undo; a restored event retains id and flashes/focuses its current chip or list row.
- [x] Overrides are optimistic by event key and lock only that event; logged Undo restores the complete overlay. Hide/Mark done/Reopen/Your figure all name the action in their toast.
- [x] Your figure opens with amount focus and closes with focus on its control.
- [x] Run calendar suites and commit.

The event form's complete submission wrapper is:

```tsx
<form className={`cal-form${hosted === 'panel' ? ' cal-form-panel' : ''}`}
  onSubmit={(event) => { event.preventDefault(); onSave() }}>
  {children}
</form>
```

`children` here denotes the existing Date/Title/Note/Person/Amount/Direction/Repeats/Until field markup, moved unchanged inside this wrapper; action markup becomes SaveButton plus SaveStatus and a cancel button. The persisted baseline is recorded on Add/Edit open, then compared to `fields`.

Complete landing flash lookup uses existing stable attributes where possible, adding ids to the lane-owned drawer/list rows only:

```tsx
const eventElement = (key: string) =>
  document.querySelector<HTMLElement>(`[data-event-key="${CSS.escape(key)}"]`)
```

If the grid lacks such an attribute, derive the generated chip id from its existing source, and document a minimal selector-only Grid touch rather than using a text match. A late-arriving chip is flashed in an effect keyed on the fetched payload plus the pending saved key.

Command: `npx vitest run src/pages/CalendarPage.test.tsx src/components/calendar/EventDetails.test.tsx src/components/calendar/DayDrawer.test.tsx --maxWorkers=2`.

## Task 6 — Budgets

- [x] Add failing local-validation, focus, Saved, history Undo and re-seed popover tests.
- [x] Focus/select the amount when its editor opens; Escape closes it and returns to its row toggle.
- [x] Errors under amount: `Enter a number, e.g. 80`, `Budgets can't be negative`; invalid amount gets `aria-invalid`, styling scoped to `.budget-editor`.
- [x] Use SaveStatus beside Save, compare the visible editor to its persisted baseline and flash its meter after success. Keep the editor open so returned history remains visible.
- [x] History deletion uses exact batch Undo. Keep the deleted history entry locally for display after successful Undo; never PUT it back. Refuse stale closures by reading current histories and reload callback through `useLatest`.
- [x] Re-seed asks with `useConfirm` and preserves its current batch toast. Initial seed remains instant.
- [x] Run budget suite and commit.

Complete validation branches:

```tsx
const trimmed = editor.amount.trim()
if (trimmed !== '' && !isAmount(trimmed)) {
  setEditorError('Enter a number, e.g. 80')
  return
}
if (trimmed !== '' && Number(canonicalAmount(trimmed)) < 0) {
  setEditorError("Budgets can't be negative")
  return
}
```

Command: `npx vitest run src/components/spending/BudgetPanel.test.tsx --maxWorkers=2`.

## Task 7 — Projection and Assistant

- [x] Add failing pin-capacity, Enter and neighbouring-chip-focus tests.
- [x] Pin label/button become a form. Use BusyButton with aria-disabled at 3/3 and adjacent `Unpin one to pin another`. Guard submit, preserve the typed label when pinning is unavailable.
- [x] Unpin focuses next chip, else previous, else the label field after commit.
- [x] Add Assistant confirm regression. Irreversible removal asks with body `This can't be undone`; cancel writes nothing. Success focuses the neighbouring finding's disclosure or the saved-findings region.
- [x] Run targeted suites and commit.

Complete pin-submit body:

```tsx
const submit = () => {
  if (sandbox.empty || sandbox.pins.length >= PIN_LIMIT) return
  sandbox.pin(label)
  setLabel('')
}
```

Complete Assistant question:

```tsx
const accepted = await ask({
  anchor,
  title: `Remove ${finding.title}?`,
  body: "This can't be undone.",
  confirmLabel: 'Remove saved finding',
})
if (!accepted) return
```

Command: `npx vitest run src/sandbox/SandboxPanel.test.tsx src/sandbox/useSandbox.test.tsx src/components/assistant/AssistantEvidence.test.tsx --maxWorkers=2`.

## Final verification

- [x] `npx tsc -p tsconfig.app.json --noEmit` and `npx tsc -p tsconfig.node.json --noEmit`: clean.
- [x] `npx eslint .`: zero errors, no more than baseline 26 warnings.
- [x] Full `npx vitest run --maxWorkers=4` after coordinator grants the memory slot: completed with one unrelated Net Worth timeout; isolated rerun passed. Root assigns the conclusive full gate to merged main.
- [x] Browser harness on APP_BASE 5277, writes only through 8087. No native dialogs. Dark/light and reduced motion.
- [x] Verify last-row editor focus, sticky matrix editor, exact card/cascaded-row API images after Undo, exact custom event id, budget local errors, pin cap and focus after every action.
- [x] Remove only lane-created copied-data records; close browsers and stop own Vite.
- [x] Append As built, commits, test totals, browser measurements, deviations and outside-scope touches; commit.

## Outside-scope touches

Both minimal additions were approved by the coordinator before implementation:

- `src/components/calendar/CalendarGrid.tsx`: `data-event-key` and `data-custom-event-id` on event chips. These let the page reveal, flash and focus the same event after refresh and exact Undo; no grid layout or behavior changes.
- `src/components/AmountInput.tsx` and its existing tests: optional boolean `aria-invalid`, combined with the parser's own invalid result (`invalid || ariaInvalid`). A negative budget is a valid number but an invalid budget. A caller's `false` cannot suppress malformed numeric input. The regression covers both cases.

No global feedback CSS, feedback primitive, API client, backend or confirmation-fence changes. Vite's private generated cache stays inside untracked `work-L7/node_modules/vite-cache` so the existing node_modules lint ignore applies without changing configuration.

## As built

Implementation completed on 2026-09-26. This lane keeps the wave-1 layouts and uses L4's feedback contracts throughout.

### Behavior shipped

- **Cards and reward categories:** Edit reveals/selects the first field; Escape/Cancel returns to that row. Save/create shows local save state and reveals/flashes/focuses the row. Named validation focuses its field. Delete uses the exact batch hook, including dependent card credits, limit history, reward cells and category pins. Archive/Hide are optimistic per row, leave unrelated rows usable, park reorder grips while a toggle is pending, and offer batch Undo. Failed row writes toast locally.
- **Rewards matrix:** the editor bar is sticky at the card's bottom; Save and Cancel live there with the selected pair, multiplier, condition, cap and changed count. Enter validates/applies a cell and returns to it. Escape returns to the cell without undoing its draft. Cancel confirms discard when cells changed. Save validates locally, saves changed cells, displays Saved and flashes those cells.
- **Card detail:** credit and limit forms own their validation/save state. Repeat-entry saves focus their first field and flash the added row. Credit/limit deletion uses exact Undo; count/cadence failures report via toast.
- **Calendar:** Add defaults to the active day and submits through a real form. Edit focuses Title. Saves land on the saved date and retain the saved id until its chip actually renders, then flash it. Exact Undo keeps custom-event identity, says Restored and focuses the restored chip; a crowded day uses its drawer. The restore path waits for a rendered grid before deciding a chip needs that drawer. Generated Hide/Mark done/Reopen/Your figure use logged optimistic overrides and batch Undo; Your figure focuses Amount and returns to its button after successful save.
- **Budgets:** editors focus Amount, clear errors on input, show case-specific validation under Amount, and expose invalid state without weakening AmountInput parsing. SaveStatus sits beside Save; success flashes the meter. History deletes use server Undo, retaining only the returned history entry locally for display. Re-seed asks through useConfirm and keeps its batch Undo. Initial seed stays instant. Seed/Undo, including a refused Undo, leave focus on the budget card.
- **Projection:** Pin's form supports Enter, explains 3/3 capacity beside its aria-disabled button, and keeps the typed name. PinRow observes the committed pin list so Unpin from either the chip or the comparison table focuses the next chip, previous chip, or name field when empty.
- **Assistant:** removing a saved finding asks an irreversible in-app confirmation; Cancel writes nothing. Removal focuses a neighboring disclosure or the Saved findings region when empty; failures toast. A set of pending ids keeps simultaneous removals independently busy, and one request settling cannot unlock another. Save finding uses a focus-preserving BusyButton.

### Verification and browser evidence

Development tests ran with `--maxWorkers=2`, including deliberate red then green regressions for edit focus/Escape, exact batch deletes, sticky-matrix interaction, calendar active-day/late-chip landing, local budget validation/history Undo, pin capacity and both Unpin entry points, AmountInput additive invalid state, and Assistant confirmation. Existing tests that asserted a lossy re-POST or native disabled save were updated to the approved contracts.

Browser harness: local `APP_BASE=http://127.0.0.1:5277`, proxy to copied-data backend 8087, `open(browser, { writes: true })`. Dark 1440×900 and light/reduced-motion 1280×800. The matrix bar remained fully visible at **x263/y575.4, 1109×152.6** in dark and **x263/y500.5, 949×152.6** in light. Last card/category edits focused fields in view. Saved matrix cells flashed and Enter returned focus to their cell. All inspected save/delete/Undo outcomes retained focus outside body. No native dialog event, console error, page error or bad response occurred.

Real copied-data API comparisons verified:

- Card delete→Undo restored the identical card id and full card payload, credit ids/values, limit ids/history, reward cells and category pin.
- Reward-category delete→Undo restored its row and reward cells; card Archive and category Hide Undo restored active state.
- Credit and limit delete→Undo restored identical API arrays.
- Calendar Enter create used the active day; save flashed its late chip; delete→Undo kept its custom id and returned focus to that chip.
- Generated calendar done/reopen, Hide and Your figure→Undo each restored the entire original event payload. Figure amount received focus and Enter submitted.
- Budget malformed/negative errors stayed inside the editor, a future-dated save showed Saved, and history Undo restored/focused its Delete control.
- Three Projection pins could be entered by keyboard; a fourth attempt retained its name and displayed the reason. Both Unpin controls focused a neighboring chip.
- Assistant Cancel and confirmed removal worked through the real drawer using an intercepted saved-finding fixture, avoiding an irreversible write to an existing copied receipt. The final removal focused its empty region.

Every temporary card/category/credit/limit/rate/custom-event and future budget was removed. Generated overrides were undone. All browsers closed; lane Vite stopped. Local scripts, reports, screenshots and gate logs remain untracked under `work-L7/`.

The initial main browser script stopped on locator-only issues (duplicate Unpin names and a finding summary whose text includes its timestamp). Those interactions passed after correcting the selectors in the supplement; there was no application exception. The supplement also added generated override checks. Root corrected a preexisting local backend database-host latency setting between passes.

### Deviations and limits

The unavailable Claude-specific superpowers skills were adapted to the available Codex tools, preserving plan-first and red/green development. No subagents were spawned. No pushes, merges, deployments, production writes, backend changes or `tsc -b`. A few focus refinements were a separate follow-up commit after browser verification. Assistant browser removal used an intercepted fixture; component tests cover its actual delete-client call. Copied-data cleanup leaves normal change-log records, as expected.

### Commit sequence

- `45cd311c` — concrete lane plan before product edits.
- `ca238558` — Cards, matrix, exact Undo and detail feedback.
- `d685ec70` — Calendar identity-preserving Undo and save landing.
- `cddae6a0` — Budget local feedback/history Undo and additive AmountInput validation.
- `281e5b0c` — Assistant irreversible removal confirmation.
- `be9ba785` — Projection pin capacity/form/focus.
- `95972873` — validation field focus, rendered calendar restore focus and budget Undo failure focus.
- `40a65fe9` — coordinator review fix: independently busy concurrent saved-finding removals, with a red/green overlap regression.

### Final gates

- `npx tsc -p tsconfig.app.json --noEmit`: exit 0 at final product `40a65fe9`.
- `npx tsc -p tsconfig.node.json --noEmit`: exit 0 at final product `40a65fe9`.
- Full `npx vitest run --maxWorkers=4` at `95972873`: **321 files passed, 1 file failed; 4,787 tests passed, 1 failed (4,788 total)** in 323.39 seconds. The only failure was the untouched `NetWorthPage.test.tsx:197` arrival test (`?drill=joint-savings`) timing out while waiting for its pressed chip. Every lane suite passed.
- Isolated `NetWorthPage.test.tsx` rerun with two workers: **54/54 passed**, twice (one run alongside the deliberately red concurrent-removal regression, then alongside its green version).
- Final `AssistantEvidence.test.tsx` plus `NetWorthPage.test.tsx`, `--maxWorkers=2`: **2 files / 56 tests passed**, including concurrent removal busy state and final focus.
- `git diff --check`: clean.
- The coordinator requested no second lane-wide run: merged main will receive the conclusive full-suite gate after all lanes integrate. No product change was made to the unrelated Net Worth test.

Root's independent L7 review found no other blocking issue in the matrix, Cards/detail/category Undo, Budget validation/history Undo, Calendar override/delete, Sandbox, or the two shared touches. The concurrent SavedFindings issue was fixed as noted above. Final `npx eslint .`: exit 0, **0 errors / 26 existing warnings**, matching the baseline. Product, browser, targeted regression, type and lint work is complete; the integrated full gate remains with the coordinator.
