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
- [ ] Commit this plan before product edits.

Command: `git add docs/superpowers/plans/2026-09-25-polish-L7-money-b.md` then `git commit -m "docs(plan): record L7 feedback and exact undo work"`. Expected: one new plan file; no product changes.

## Task 2 — Cards and reward categories

- [ ] Add regressions to the page suite; observe red before implementation.
- [ ] Replace lossy re-POST Undo with `useDeleteWithUndo` in each panel.
- [ ] Add form refs, edit baselines, `useSaveState`, `SaveButton`, `SaveStatus`, `useEscapeCancel` and stable row ids.
- [ ] Make archive/hide optimistic per row and use logged clients plus batch Undo.
- [ ] Return the page load's Promise and widen child reload callback return types to `void | Promise<void>`.
- [ ] Update old tests that deliberately expected re-created ids or native disabled controls.
- [ ] Run targeted page suite and commit.

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

- [ ] Add failing tests for selected-field focus, Escape back to cell, changed-count, discard confirmation and failed save in the bar.
- [ ] Move Save/Cancel into `.mx-editor-bar`, sticky at bottom 0 inside the matrix card.
- [ ] Keep drafts as currently edited values; compare numeric amounts canonically to stored values so untouched `3.00` is not dirty against `3`.
- [ ] Make editor a form: Enter validates the picked cell and returns focus to it. Save validates every changed cell, focuses its invalid field and submits only changed puts.
- [ ] Cancel with changes asks `Discard N changed cells?`; cancellation leaves drafts intact.
- [ ] On successful save clear drafts, leave edit mode, retain the saved status beside Edit and flash affected stable matrix cells.
- [ ] Run matrix and page suites and commit.

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

- [ ] Add failing credit/limit exact-Undo and local-error tests in the page suite.
- [ ] Give each form independent validation and save state; clear only its own errors on input.
- [ ] Repeat-entry saves retain focus in their first input, reveal/flash the created row and show Saved.
- [ ] Credit and limit deletes use list-owned `useDeleteWithUndo`; fallback focus goes to the respective form input when the last row disappears.
- [ ] Existing credit count/cadence errors become toasts.
- [ ] Run page suite and commit.

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

- [ ] Add failing tests for active-day default, edit title focus, form submission and batch Undo.
- [ ] `AddEventForm` becomes a real form with SaveButton/SaveStatus; error clears on field edit.
- [ ] Add opens on `cursorDay`; edit opens on title. Esc/Cancel returns to a live calendar landmark.
- [ ] Save awaits reload, bumps focusTick and flashes the chip once the corresponding fetched event is in the DOM. Handle a saved date in another month and list view too.
- [ ] Delete uses exact batch Undo; a restored event retains id and flashes/focuses its current chip or list row.
- [ ] Overrides are optimistic by event key and lock only that event; logged Undo restores the complete overlay. Hide/Mark done/Reopen/Your figure all name the action in their toast.
- [ ] Your figure opens with amount focus and closes with focus on its control.
- [ ] Run calendar suites and commit.

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

- [ ] Add failing local-validation, focus, Saved, history Undo and re-seed popover tests.
- [ ] Focus/select the amount when its editor opens; Escape closes it and returns to its row toggle.
- [ ] Errors under amount: `Enter a number, e.g. 80`, `Budgets can't be negative`; invalid amount gets `aria-invalid`, styling scoped to `.budget-editor`.
- [ ] Use SaveStatus beside Save, compare the visible editor to its persisted baseline and flash its meter after success. Keep the editor open so returned history remains visible.
- [ ] History deletion uses exact batch Undo. Keep the deleted history entry locally for display after successful Undo; never PUT it back. Refuse stale closures by reading current histories and reload callback through `useLatest`.
- [ ] Re-seed asks with `useConfirm` and preserves its current batch toast. Initial seed remains instant.
- [ ] Run budget suite and commit.

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

- [ ] Add failing pin-capacity, Enter and neighbouring-chip-focus tests.
- [ ] Pin label/button become a form. Use BusyButton with aria-disabled at 3/3 and adjacent `Unpin one to pin another`. Guard submit, preserve the typed label when pinning is unavailable.
- [ ] Unpin focuses next chip, else previous, else the label field after commit.
- [ ] Add Assistant confirm regression. Irreversible removal asks with body `This can't be undone`; cancel writes nothing. Success focuses the neighbouring finding's disclosure or the saved-findings region.
- [ ] Run targeted suites and commit.

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

- [ ] `npx tsc -p tsconfig.app.json --noEmit` and `npx tsc -p tsconfig.node.json --noEmit`: clean.
- [ ] `npx eslint .`: zero errors, no more than baseline 26 warnings.
- [ ] Full `npx vitest run --maxWorkers=4` after coordinator grants the memory slot.
- [ ] Browser harness on APP_BASE 5277, writes only through 8087. No native dialogs. Dark/light and reduced motion.
- [ ] Verify last-row editor focus, sticky matrix editor, exact card/cascaded-row API images after Undo, exact custom event id, budget local errors, pin cap and focus after every action.
- [ ] Remove only lane-created copied-data records; close browsers and stop own Vite.
- [ ] Append As built, commits, test totals, browser measurements, deviations and outside-scope touches; commit.

## Outside-scope touches

None planned. Any needed selector-only addition to CalendarGrid will be listed here before completion.

## As built

Execution in progress. Results will be recorded after the gates and browser checks.
