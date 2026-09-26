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

- [x] Add an extraction test: render `PortfolioAccountsCard` with the existing ME/PARTNER fixtures, mock `fetchPortfolioAccounts` to return a named account, change its owner, and assert the existing partial patch. Retain the older portfolio integration cases in the Accounts test host alongside the extracted card, including independent load-failure coverage.
- [x] Assert the new page order and spans; pin the System Build fact and price-run list shape.
- [x] Run `npx vitest run src/components/settings/PortfolioAccountsCard.test.tsx src/components/settings/SystemCard.test.tsx src/components/settings/PriceRefreshCard.test.tsx src/components/settings/settingsCss.test.ts src/pages/SettingsPage.test.tsx --maxWorkers=2`. Expected red: missing card/export, missing Build, old grid declarations.
- [x] Implement the extraction preserving the exact fetch, patch and error contracts; move the portfolio FeedBanner with it. Household remains span-4, portfolio becomes span-8, categories becomes span-12.
- [x] Use these declarations, removing the superseded start alignment and duplicate danger rule:

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

- [x] Repeat the targeted command until green, then commit `feat(settings): split portfolio ownership and align card structure`.

## Task 2 — list editors and exact Undo

- [x] Extend the current category and account fixtures with the logged-client mocks. Add this executable focus test to each file using its existing render and row helpers (category version shown in full):

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

- [x] Extend the deferred-promise coverage for optimistic changes and row locking; retain rejected-change and delayed-Undo/save overlap tests. Assert delete waits for removal before the Undo toast and restores the original id with focus/flash. Verify save/add focus and viewport placement in component tests and Edge; review delayed callbacks for current `editingId` reads.
- [x] Run `npx vitest run src/components/settings/AccountsCard.test.tsx src/components/settings/CategoriesCard.test.tsx --maxWorkers=2`. Expected red: no editor focus/current marker, unlogged updates, no delete Undo.
- [x] Implement refs and a layout-effect completion slot. Editing calls `revealEditor(formRef.current, 'input')`; Escape/Cancel reset and focus the saved row's Edit control. A successful write stores its returned id before reloading; the post-commit effect reveals/flashes/focuses that row.
- [x] Keep reorder's request counter for ordering and form writes. One-click updates maintain a separate set of row ids; the row renders its optimistic copy and only that row's controls lock. The logged request's success toast supplies `undoBatch(batchId)` plus a current reload, with verbatim `errorDetail` on failure.
- [x] Delete through `useDeleteWithUndo` in the list-owning card. Complete callback implementation:

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
- [x] Move form errors into the action row and clear on the next edit. Keep row failures out of FeedBanner. Use BusyButton with `.button` for actions that keep focus through a request.
- [x] Repeat the targeted command until green and commit `feat(settings): reveal list edits and add exact row undo`.

## Task 3 — save grammar and household rename

- [x] In each form's existing test file assert initial Save `aria-disabled=true`, dirty feedback after typing, only the submitted action `aria-busy=true`, returned values become the saved baseline, and success reads `Saved` in the action row. Retain wire-payload and first-load-failure tests.
- [x] Add Household tests for focus/select, Enter submission, Escape/cancel focus restoration, keyed branches and separate add/date/rename errors. Add Limits/Assistant deferred tests for busy Save versus Clone/Remove.
- [x] Run `npx vitest run src/components/settings/HouseholdCard.test.tsx src/components/settings/LimitsCard.test.tsx src/components/settings/PlanAssumptionsCard.test.tsx src/components/settings/PriceRefreshCard.test.tsx src/components/settings/AssistantCard.test.tsx src/components/settings/CalendarFeedCard.test.tsx src/pages/SettingsPage.test.tsx --maxWorkers=2`. Expected red: native disabled attributes and permanent save text.
- [x] Implement saved baselines from load and write responses. Full save wiring pattern:

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
- [x] Rename stays in its person's keyed `<form>`, uses focus/select after mount, Escape cancels, successful rename refetches and focuses Rename using the stable person id. Household's add reload must preserve an independently dirty marriage date.
- [x] Repeat targeted tests until green and commit `feat(settings): unify save feedback and household editing`.

## Task 4 — questions and inline activity reports

- [x] Wrap the five asking components' test hosts with ConfirmProvider. Replace native-confirm spy expectations with queries inside `role=alertdialog`, Cancel/accept/typed-date behavior and anchor-focus assertions.
- [x] Add Activity regression: after View report, only that row contains the report, its button reads Hide report with `aria-expanded=true`; clicking again hides it.
- [x] Run `npx vitest run src/components/settings/RestoreCard.test.tsx src/components/settings/HealthCard.test.tsx src/components/settings/CalendarFeedCard.test.tsx src/components/settings/AssistantCard.test.tsx src/components/settings/ActivityCard.test.tsx src/pages/SettingsPage.test.tsx src/components/feedback/noNativeConfirm.test.ts --maxWorkers=2`. Expected red: no app question, report outside its row.
- [x] Restore asks after clean dry run with `typedArm: { expected: snapshotDate, prompt: "Type the snapshot's date (YYYY-MM-DD) to confirm" }`; remove the duplicate external arm input. Import asks with the existing consequences and restore-point explanation. All use inline option literals and a helper named `ask`.
- [x] Feed revoke says `Calendars using it stop updating — this can't be undone`; Assistant Remove names the saved key and environment fallback; Data health asks once in a popover before its existing batch Undo. Preserve focus when a removed action disappears.
- [x] Keep Activity's own Undo arm, place the report under its row, expose `aria-expanded`/`aria-controls`, and expand the InfoHint to all newly logged kinds.
- [x] Remove the two L5 fence entries. Repeat targeted tests until green and commit `feat(settings): anchor questions and activity reports`.

## Task 5 — real browser acceptance and final gates

- [x] Read and reuse the existing lane-specific Vite wrapper/private dependency cache on 5275, confirming its proxy is 8085. Use only the designated audit harness, writable lane stack and test-created rows.
- [x] Capture natural card heights before/after at 1440 and 1920 in both themes. Apply full-width layout for any non-Household pair outside 15%, verify every paired bottom within 1 px and each blank action band at most 96 px.
- [x] In Edge check the last category/account row's editor is fully visible below the sticky block, insertion reveal/flash, save/cancel focus, deletion before the toast, exact id restoration by API, Kind Undo, forced 500 toast without table displacement and no native dialog events. Put back all created test data; close browsers and stop the owned Vite process.
- [x] Coordinate heavy gates with the parent. Run `npx tsc -p tsconfig.app.json --noEmit`, `npx tsc -p tsconfig.node.json --noEmit`, `npx eslint .`, and once permitted `npx vitest run --maxWorkers=4`. Expected: both type checks clean, 0 errors and at most 26 warnings, full tests green. Never run `tsc -b`.
- [x] Append measured results, commits, deviations and any outside-scope touches below, then commit `docs(settings): record polish verification`.

## Outside-scope touches

None beyond the explicitly authorized L5 confirm-fence entries.

## As built

Implemented on `feat/polish-settings` from `204ef73d`. The product head is `ef557961`; the branch has not been merged or pushed.

### Result and contract use

- Portfolio ownership is an independent `PortfolioAccountsCard`, with its original partial PATCH, warm feed, state and error ownership. Household/Portfolio uses 4+8 columns; Categories and Accounts each use 12. Owner controls retain focus while saving and use the requested content widths.
- Settings rows stretch. The Household date form fills its card and pins its action. Appearance pickers fit their content. System shares a 9rem label track and displays the build hash. Recent price refreshes are separate list items, with local "Today" times and failed counts in the negative tone.
- List editors select the name and reveal it below the sticky strip, including another Edit click on the same row. Escape/Cancel return to Edit. Successful saves/additions reveal and flash the row; focus also scrolls the page when a new single-add row's capped table is below the viewport.
- Account/category deletion uses the list-owned `useDeleteWithUndo`, the server batch id, current refs and `restoredRow`. Kind and Retire/Restore are optimistic, with only the affected row's controls locked, logged batch Undo, and toast failures. Reorder grips keep their existing request guard.
- Named forms use saved baselines, `SaveButton`, `useSaveState` and transient `SaveStatus`. Limits Clone and Assistant Remove retain independent busy state. Keyboard submits put focus on the surviving Save control before disabled fields lose focus. Household rename is a keyed form with Enter/Escape, selected name and separate errors; member reloads preserve a dirty marriage date.
- Restore's typed date is inside `useConfirm`. Import, Assistant Remove, Calendar Revoke and health repair use the same anchored questions. Restore/import retain their current-source guards while a question is open. Calendar's swapped creation/URL forms explicitly hand focus to the new field.
- Activity reports open under their own row with Hide report and `aria-expanded`. Activity retains its original two-click Undo arm. Its completed Undo focuses the original row when the action disappears. InfoHint names the newly logged writers.

### Measured layout

Headless Edge, writable lane stack 5275 → 8085, copied local data, 1440 and 1920 widths, both themes. The optional pair decisions below used natural card heights, with grid stretching temporarily disabled. Light and dark returned the same heights.

| Optional pair | 1440 natural heights (px) | 1920 natural heights (px) | Decision |
| --- | --- | --- | --- |
| Limits / Plan assumptions | 411.14 / 451.34 | 331.36 / 415.34 | Full width; 20.2% difference at 1920 |
| Appearance / Password | 205.36 / 226.78 | 205.36 / 165.00 | Full width; 19.7% at 1920 |
| Price refresh / Assistant | 414.52 / 268.58 | 414.52 / 250.58 | Full width; 35.2–39.5% |
| Backups / Restore | 387.59 / 284.38 | 387.59 / 284.38 | Full width; 26.6% |
| Health / System | 131.41 / 329.30 | 131.41 / 329.30 | Full width; 60.1% |

The original Household/Categories row was 434.34/695.39px at 1440 and 434.34/641.39px at 1920. The new required Household/Portfolio row is 518.84/518.84px and 500.84/500.84px respectively: **0px bottom difference**. Accounts shrank from 1114px to 632.77px after extraction. All 20 final tab/width/theme probes passed: the largest blank action band is **92.5px at 1440**, **74.5px at 1920**; other action bands are at most 12px.

### Browser verification

- Last category and account Edit selected/focused the name fully below the 43px sticky inset; Escape returned to the exact Edit button.
- Newly added category and account rows were flashed, focused and inside the 900px viewport: category y=458.80–501.77; account y=770.27–813.23. Save returned focus to the changed row.
- Real category delete removed its row before the Undo toast. Undo restored the identical category id/data, its 123.45 budget and a linked reward-category mapping. Kind Undo returned Transfer to Living.
- Real account delete/Undo restored identical account/component ids and fields, the component parent and the linked credit card. Retire Undo restored active state.
- An intercepted HTTP 500 row update produced the shared `errorDetail` toast and moved the table **0px**, with no card error banner.
- Household rename, keyboard schedule Save, Calendar creation/Done/revocation and reminder-day Save retained focus. Assistant removal used a stubbed key; restore/import used stubbed clean dry runs; health used a question fixture. These exercised their in-app questions and Cancel focus without applying a whole-database restore/import or changing a real assistant credential.
- Restore accepted only its typed local date. Activity's stubbed Undo kept focus on the original row, and its report opened/closed inside the correct row.
- No native dialog events or page exceptions. The forms/confirmation and Activity passes had no console errors. The row failure pass recorded only its intentional HTTP 500.
- Test-created business rows were deleted, the temporary household name and settings restored, and cleanup returned no errors. Browsers are closed and the owned Vite process on 5275 stopped. The parent owns backend 8085.

Evidence is outside the repository in the designated audit scratchpad's `work-L5/`: `before.json`, `after-natural.json`, `after.json`, `flows-results.json`, `forms-results.json`, `activity-results.json`, and their `.mjs` scripts. Screenshots are under `shots/L5/`.

### Verification and commits

Targeted development gates used `--maxWorkers=2`. The final focused runs passed 92 list/Activity tests, 86 confirmation/page tests, 124 list/save/focus tests, and 33 facts/CSS tests (overlapping groups, not an additive total). The Activity removal-focus regression was observed red before implementation.

The full `npx vitest run --maxWorkers=4` gate passed **322 files / 4,784 tests** at `9b0cf25e`. Independent review then found three focus edges: an older Activity batch can disappear when Undo reloads the first page; a refused health Undo must keep focus after its toast action leaves; client validation should focus the field it names. `ef557961` fixes all three, including the Parent account and Component controls. Four failing assertions were observed before the fixes, followed by **98 passing affected tests**. The parent will run its integration gate after merging lanes; this branch's full-suite result deliberately names the tested head.

Both `tsc -p tsconfig.app.json --noEmit` and `tsc -p tsconfig.node.json --noEmit` passed again after the review fixes; no emitting build was run. Full ESLint returned **0 errors / 26 unchanged warnings**; the eight files changed for review passed ESLint with **0 errors / 0 warnings**.

Product commits:

- `45e9afff` — write the lane plan before product code.
- `9cf2b394` — extract ownership and align card structure.
- `f144831f` — reveal editors and exact row Undo.
- `df900884` — save feedback and Household editing.
- `c68ad9b6` — anchored questions and inline Activity reports.
- `9b0cf25e` — measured full-width decisions, insertion viewport and surviving action focus.
- `ef557961` — Activity/health Undo fallbacks and named-field validation focus from independent review.

### Deviations

- The old Claude-specific skill commands were unavailable; the recovered assignment, repository contracts, committed plan, targeted red/green checks and Edge harness supplied the workflow.
- Existing Accounts tests still render both account cards where they already cover portfolio behavior; a direct extraction test was added. This preserves those integration assertions without moving unrelated coverage.
- All optional pairs became full width based on the measured 15% rule. The required Household/Portfolio pair stayed 4+8.
- Browser checks exposed additional local focus work: keyboard submits, single-add page scrolling, Calendar's replaced forms and Activity's disappearing Undo action. Shared primitives and API contracts were unchanged.
- The local backend stopped during a measurement run; the parent restored it and corrected its database host to loopback. The affected measurement was rerun completely.

Independent review of `ef557961` confirmed all three reported focus findings addressed, with no new blocking finding. No known product work remains in L5; cross-lane integration and its combined gate belong to the parent.
