# Settings polish — implementation plan

> **For agentic workers:** execute this plan task by task with a red test, implementation, green test and local commit. The recovered Claude assignment referenced superpowers skills unavailable in this Codex session; the repository contracts and this explicit sequence carry their workflow forward.

**Goal:** finish lane L5 of the approved polish design: aligned Settings cards, feedback at the action, transient save feedback, exact batch Undo and in-app questions.

**Architecture:** reuse L4's feedback primitives and logged clients without changing their contracts. Keep fetch ownership in each card, split portfolio ownership into its own card, and keep delayed Undo callbacks connected to current component state through `useLatest`. All writes in browser verification use lane L5's database on port 8085.

**Tech stack:** React 19, TypeScript, Vitest/Testing Library, Vite, Playwright with headless Edge. Windows PowerShell; `node_modules` is a junction.

## File Structure

- `src/components/settings/PortfolioAccountsCard.tsx` and `.test.tsx`: extracted portfolio ownership feed, independent errors and row saves.
- `AccountsCard`, `CategoriesCard`, their tests: reveal/focus for editing and insertion; exact delete Undo; optimistic logged retire/kind actions.
- `HouseholdCard`, `LimitsCard`, `PlanAssumptionsCard`, `PriceRefreshCard`, `AssistantCard`, `CalendarFeedCard`, their tests: dirty/save/error state beside each form's action.
- `RestoreCard`, `HealthCard`, their tests: anchored questions, including Restore's typed date.
- `ActivityCard`, `SystemCard`, their tests: inline reports, expanded logging explanation, Build fact.
- `src/pages/SettingsPage.tsx`, `.css`, `.test.tsx`: portfolio placement, password save state, import question, measured card pairing.
- `src/components/settings/settings.css`, `settingsCss.test.ts`: shared label track, list facts, card columns, pinned actions, content-sized pickers.
- `src/components/feedback/noNativeConfirm.test.ts`: remove only the two L5 allowlist entries when converted.
- This plan: implementation record and gates. Browser scripts and evidence live outside the repository in the designated `scratchpad/work-L5` directory.

## Task 1 — extract ownership and align card structure

- [ ] Add an extraction test: render `PortfolioAccountsCard` with the existing ME/PARTNER fixtures, mock `fetchPortfolioAccounts` to return a named account, change its owner, and assert the existing partial patch. Move portfolio-specific tests out of AccountsCard while retaining the independent load-failure coverage.
- [ ] Assert the new page order and spans; pin the System Build fact and price-run list shape.
- [ ] Run `npx vitest run src/components/settings/PortfolioAccountsCard.test.tsx src/components/settings/SystemCard.test.tsx src/components/settings/PriceRefreshCard.test.tsx src/components/settings/settingsCss.test.ts src/pages/SettingsPage.test.tsx --maxWorkers=2`. Expected red: missing card/export, missing Build, old grid declarations.
- [ ] Implement the extraction preserving the exact fetch, patch and error contracts; move the portfolio FeedBanner with it. Household remains span-4, portfolio becomes span-8, categories becomes span-12.
- [ ] Use these declarations, removing the superseded start alignment and duplicate danger rule:

```css
.settings-page .card-grid { align-items: stretch; }
.settings-page .card { display: flex; flex-direction: column; }
.settings-card-actions, .settings-actions { margin-top: auto; }
.settings-field > .segmented { align-self: flex-start; }
.portfolio-accounts-table select.field-input { width: auto; min-width: 9rem; max-width: 14rem; }
.system-facts { display: grid; grid-template-columns: 9rem 1fr; gap: 0.45rem 0.75rem; }
.system-fact { display: contents; }
.activity-report { flex-basis: 100%; }
```

The facts grid applies one shared track to every label/value pair. Price refresh uses its own single-column facts override. The height probe will decide which other pairs remain; pairs outside 15% become full width.

- [ ] Repeat the targeted command until green, then commit `feat(settings): split portfolio ownership and align card structure`.

## Task 2 — list editors and exact Undo

- [ ] Extend the current category and account fixtures with the logged-client mocks. Add this executable focus test to each file using its existing render and row helpers (category version shown in full):

```tsx
it('reveals the category editor and returns Escape to its row', async () => {
  render(<CategoriesCard />)
  await screen.findByRole('table')
  const edit = screen.getByRole('button', { name: 'Edit Groceries' })
  fireEvent.click(edit)
  const input = screen.getByLabelText('Category name') as HTMLInputElement
  expect(document.activeElement).toBe(input)
  expect(input.selectionStart).toBe(0)
  expect(input.selectionEnd).toBe(input.value.length)
  expect(row(5)?.getAttribute('aria-current')).toBe('true')
  fireEvent.keyDown(input, { key: 'Escape' })
  expect(document.activeElement).toBe(edit)
  expect(row(5)?.hasAttribute('aria-current')).toBe(false)
})
```

- [ ] Add deferred-promise tests proving optimistic Kind/Retire locks only the acted-on row, rejection restores its former data and emits a toast, delete waits for removal before the Undo toast, and Undo restores the original id and focuses/flashes the restored row. Add save/add tests asserting the row's Edit control receives focus and `data-flash` appears. Add a delayed-Undo test after another edit starts to guard against stale `editingId` closures.
- [ ] Run `npx vitest run src/components/settings/AccountsCard.test.tsx src/components/settings/CategoriesCard.test.tsx --maxWorkers=2`. Expected red: no editor focus/current marker, unlogged updates, no delete Undo.
- [ ] Implement refs and a layout-effect completion slot. Editing calls `revealEditor(formRef.current, 'input')`; Escape/Cancel reset and focus the saved row's Edit control. A successful write stores its returned id before reloading; the post-commit effect reveals/flashes/focuses that row.
- [ ] Keep reorder's request counter for ordering and form writes. One-click updates maintain a separate set of row ids; the row renders its optimistic copy and only that row's controls lock. The logged request's success toast supplies `undoBatch(batchId)` plus a current reload, with verbatim `errorDetail` on failure.
- [ ] Delete through `useDeleteWithUndo` in the list-owning card. Complete callback implementation:

```tsx
void deleteWithUndo({
  name: `category ${category.name}`,
  row: findRow(category.id),
  request: () => deleteCategory(category.id),
  onDeleted: async () => {
    if (latest.current.editingId === category.id) latest.current.cancelEdit()
    await latest.current.load()
  },
  focusAfter: () => formRef.current?.querySelector<HTMLInputElement>('input') ?? null,
  onRestored: () => latest.current.load(),
  restoredRow: () => findRow(category.id),
})
```

Use a neighboring row's same control before the form fallback. Account deletion uses the equivalent account id/client and preserves parent/component relationships server-side.
- [ ] Move form errors into the action row and clear on the next edit. Keep row failures out of FeedBanner. Use BusyButton with `.button` for actions that keep focus through a request.
- [ ] Repeat the targeted command until green and commit `feat(settings): reveal list edits and add exact row undo`.

## Task 3 — save grammar and household rename

- [ ] In each form's existing test file assert initial Save `aria-disabled=true`, dirty feedback after typing, only the submitted action `aria-busy=true`, returned values become the saved baseline, and success reads `Saved` in the action row. Retain wire-payload and first-load-failure tests.
- [ ] Add Household tests for focus/select, Enter submission, Escape/cancel focus restoration, keyed branches and separate add/date/rename errors. Add Limits/Assistant deferred tests for busy Save versus Clone/Remove.
- [ ] Run `npx vitest run src/components/settings/HouseholdCard.test.tsx src/components/settings/LimitsCard.test.tsx src/components/settings/PlanAssumptionsCard.test.tsx src/components/settings/PriceRefreshCard.test.tsx src/components/settings/AssistantCard.test.tsx src/components/settings/CalendarFeedCard.test.tsx src/pages/SettingsPage.test.tsx --maxWorkers=2`. Expected red: native disabled attributes and permanent save text.
- [ ] Implement saved baselines from load and write responses. Full save wiring pattern:

```tsx
const saveState = useSaveState({ dirty: cronBox !== savedCron })
const saving = saveState.status === 'saving'
const save = () => void saveState.run(async () => {
  const saved = await putAppSettings({ price_refresh_cron: cronBox })
  setCronBox(saved.price_refresh_cron)
  setSavedCron(saved.price_refresh_cron)
  await loadStatus()
})
```

```tsx
<div className="settings-card-actions">
  <SaveButton type="submit" className="button button-primary" state={saveState}>Save schedule</SaveButton>
  <SaveStatus state={saveState} />
</div>
```

Client validation remains local but sits beside Save and clears on edit; server failure flows through `run`. Separate action state handles Clone, Remove, and Add. Other buttons use `inert` while a peer saves and keep their own label. Password's baseline is three blank boxes and clears only on success.
- [ ] Rename stays in its person's keyed `<form>`, uses focus/select after mount, Escape cancels, successful rename refetches and focuses Rename using the stable person id. Household's add reload must preserve an independently dirty marriage date.
- [ ] Repeat targeted tests until green and commit `feat(settings): unify save feedback and household editing`.

## Task 4 — questions and inline activity reports

- [ ] Wrap the five asking components' test hosts with ConfirmProvider. Replace native-confirm spy expectations with queries inside `role=alertdialog`, Cancel/accept/typed-date behavior and anchor-focus assertions.
- [ ] Add Activity regression: after View report, only that row contains the report, its button reads Hide report with `aria-expanded=true`; clicking again hides it.
- [ ] Run `npx vitest run src/components/settings/RestoreCard.test.tsx src/components/settings/HealthCard.test.tsx src/components/settings/CalendarFeedCard.test.tsx src/components/settings/AssistantCard.test.tsx src/components/settings/ActivityCard.test.tsx src/pages/SettingsPage.test.tsx src/components/feedback/noNativeConfirm.test.ts --maxWorkers=2`. Expected red: no app question, report outside its row.
- [ ] Restore asks after clean dry run with `typedArm: { expected: snapshotDate, prompt: "Type the snapshot's date (YYYY-MM-DD) to confirm" }`; remove the duplicate external arm input. Import asks with the existing consequences and restore-point explanation. All use inline option literals and a helper named `ask`.
- [ ] Feed revoke says `Calendars using it stop updating — this can't be undone`; Assistant Remove names the saved key and environment fallback; Data health asks once in a popover before its existing batch Undo. Preserve focus when a removed action disappears.
- [ ] Keep Activity's own Undo arm, place the report under its row, expose `aria-expanded`/`aria-controls`, and expand the InfoHint to all newly logged kinds.
- [ ] Remove the two L5 fence entries. Repeat targeted tests until green and commit `feat(settings): anchor questions and activity reports`.

## Task 5 — real browser acceptance and final gates

- [ ] Read and reuse the existing lane-specific Vite wrapper/private dependency cache on 5275, confirming its proxy is 8085. Use only the designated audit harness, writable lane stack and test-created rows.
- [ ] Capture natural card heights before/after at 1440 and 1920 in both themes. Apply full-width layout for any non-Household pair outside 15%, verify every paired bottom within 1 px and each blank action band at most 96 px.
- [ ] In Edge check the last category/account row's editor is fully visible below the sticky block, insertion reveal/flash, save/cancel focus, deletion before the toast, exact id restoration by API, Kind Undo, forced 500 toast without table displacement and no native dialog events. Put back all created test data; close browsers and stop the owned Vite process.
- [ ] Coordinate heavy gates with the parent. Run `npx tsc -p tsconfig.app.json --noEmit`, `npx tsc -p tsconfig.node.json --noEmit`, `npx eslint .`, and once permitted `npx vitest run --maxWorkers=4`. Expected: both type checks clean, 0 errors and at most 26 warnings, full tests green. Never run `tsc -b`.
- [ ] Append measured results, commits, deviations and any outside-scope touches below, then commit `docs(settings): record polish verification`.

## Outside-scope touches

None planned beyond the explicitly authorized L5 confirm-fence entries.
