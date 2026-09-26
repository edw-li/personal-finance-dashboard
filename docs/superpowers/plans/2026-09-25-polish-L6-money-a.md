# L6: Portfolio, ESPP, Compensation and Paycheck feedback

**Goal:** finish the approved polish design's D2, D3 and D5 on the money-entry surfaces. A delete restores its original database rows through the logged batch; an edit brings its form into view; a save, cancel or undo leaves focus on a useful control. Errors sit at the action that can fix them.

**Branch:** `feat/polish-money-a`, worktree `.worktrees/polish-money-a`, based on `204ef73d`.

**Architecture:** consume the wave-1 feedback primitives without changing their contracts. Lists own `useDeleteWithUndo`; delayed callbacks read current reload/edit state through `useLatest`. Page reload functions return the fetch promise. Saved-row effects wait for the refreshed list before revealing, flashing and returning focus. Keep the transaction reorder implementation, allocation layout, chart/tile markup, and amount canonicalization intact.

**Environment:** Windows; shared `node_modules` junction. Only the copied writable backend at `127.0.0.1:8086`; private Vite cache and port `5276`. No push, merge or deploy. The unavailable Claude superpowers commands are replaced with this committed plan, test-first component work, and coordinator review.

## File structure

| File | Work |
|---|---|
| `src/components/portfolio/TransactionsPanel.tsx` and its test | Exact delete Undo; edit/cancel/save focus; add reveal; nearby errors; busy save |
| `src/components/portfolio/DividendsPanel.tsx` and its test | Same treatment, preserving month reveal and including auto dividends |
| `src/components/portfolio/SecuritiesPanel.tsx` and its test | Exact delete Undo; editor and price focus; separate nearby errors; busy save |
| `src/components/portfolio/AllocationTargetEditor.tsx` and portfolio allocation tests | Busy draft versus activation; error clearing and focus when editor closes |
| `src/components/portfolio/portfolio.css` | Token-based editing tint and action feedback styling |
| `src/pages/PortfolioPage.tsx` | Return the existing reload promise so Undo waits for the refreshed list |
| `src/pages/EsppPage.tsx`, `.css`, and `.test.tsx` | Lot, offering and period exact Undo; edit/add/save focus; model action ownership |
| `src/pages/CompPage.tsx`, `.css`, and `.test.tsx` | Event exact Undo; event/grant edit/add/save focus; returned reload promises |
| `src/components/comp/RsuGrantsPanel.tsx` | Replace grant re-POST Undo with exact batch Undo |
| `src/pages/PaycheckPage.tsx`, `.css`, and `.test.tsx` | Profile exact Undo; tall-form reveal; validation focus; action width; deep-link skeleton |
| `src/components/feedback/noNativeConfirm.test.ts` | Remove only the L6 allowlist entries as each conversion lands |
| `work-L6/` (untracked scratch artifacts) | Browser wrapper, probes, measurements and cleanup record |

## Task 1: Portfolio transaction grammar

- [ ] Add failing edit/cancel and batch-Undo regression tests beside TransactionsPanel's existing fixtures.

```tsx
it('reveals an edited transaction and returns Escape to its Edit button', async () => {
  render(<TransactionsPanel securities={securities} transactions={[importTxn]} onChanged={() => {}} />)
  const edit = screen.getByRole('button', { name: 'Edit' })
  fireEvent.click(edit)
  await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Account')))
  expect(edit.closest('tr')?.getAttribute('aria-current')).toBe('true')
  fireEvent.keyDown(screen.getByLabelText('Account'), { key: 'Escape' })
  expect(document.activeElement).toBe(edit)
  expect(edit.closest('tr')?.classList.contains('is-editing')).toBe(false)
})
```

The Undo test uses a stateful host: DELETE removes `importTxn`, the callback reload resolves after `setRows`, and `undoBatch` restores the same fixture. Assert the delete toast comes after the DOM removal, `undoBatch` receives the header id, no create API is called, the restored row is flashed, and focus is inside it. Replace the old test asserting a re-POST; keep all reorder tests.

- [ ] Run `npx vitest run src/components/portfolio/TransactionsPanel.test.tsx --maxWorkers=2 -t "reveals an edited transaction"`; expected red: focus is not Account.
- [ ] Add a form ref, row identity attribute, and current refs. Implement edit reveal with `queueMicrotask(() => revealEditor(formRef.current))`. The disabled security select is skipped automatically. Add `useEscapeCancel(formRef, cancelEdit, editingId !== null && !busy)`.

```tsx
const cancelEdit = () => {
  if (busy) return
  const row = document.querySelector<HTMLElement>(`[data-transaction-id="${editingId}"]`)
  row?.querySelector<HTMLButtonElement>('[data-edit]')?.focus()
  setEditingId(null)
  setForm(EMPTY)
  setKept(false)
  setError(null)
}
```

- [ ] Replace the entire lossy delete handler with `useDeleteWithUndo({ name, row, request, onDeleted, onRestored, restoredRow, focusAfter })`. The request is `deleteTransaction(txn.id)`. `onDeleted` resets only the currently edited matching id and returns `onChangedRef.current()`. `onRestored` returns that same current callback. `restoredRow` selects the original transaction id. `focusAfter` selects the next/previous surviving row's Delete, falling back to the form's submit button.
- [ ] Add pending save id/focus state. The save preserves the existing focus-before-reset invariant for AmountInput. Once the refreshed list arrives, reveal and flash the saved id; an edit focuses `[data-edit]`, while create leaves focus in its amount field. Preserve `kept` copy.
- [ ] Put errors in `.form-actions`, clear on subsequent field input/change, and use BusyButton with `.button`, `busy` only for the save, and `inert` for unrelated work. Editing row gets `.is-editing` and `aria-current`.
- [ ] Return `load()` from PortfolioPage's `reload` and widen callbacks to `void | Promise<void>`.
- [ ] Run the whole transaction file and commit `fix(portfolio): restore exact transactions and keep edit feedback in view`.

## Task 2: Dividends and securities

- [ ] Add tests for dividend edit focus/Escape, auto-row exact Undo, restored month visibility, security edit focus, Set price focus, and delete failure as a toast.

```tsx
it('focuses the manual price when its editor opens', async () => {
  render(<SecuritiesPanel securities={[manualPriced]} onChanged={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Set price' }))
  await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Price')))
})
```

- [ ] Run the two component files before changes; new focus and batch Undo assertions fail.
- [ ] Dividends: keep `pendingReveal` and its existing month-line offset. Add `flashElement(row)` inside its final reveal; store whether the save edited a row and focus its Edit button then. `startEdit` reveals the form; Cancel and Escape focus the matching row. Add `is-editing` and `aria-current` without disturbing month glide classes.
- [ ] Dividends delete: all sources call `deleteDividend(id)` through the shared hook. Before restored reload, open the captured pay-date month; callback reads the latest page reload. Never create a replacement dividend. Pass a stable `data-dividend-id` restored row and form fallback for the last deletion.
- [ ] Securities: same exact Undo protocol with `data-security-id`. Separate `priceError` from form `error`; render price error inside its mini-form. Open price editor, then focus its input after commit. Cancel/save returns to Set price, with save flashing the row. Main form edit/save/cancel follows task 1.
- [ ] Add this token-only rule to portfolio.css (the existing theme tokens handle both themes):

```css
.port-table tr.is-editing > td,
.port-table tr.is-editing > th {
  background: var(--accent-soft);
}

.entry-form .form-actions {
  flex-wrap: wrap;
}

.entry-form .form-actions .error-banner {
  flex-basis: 100%;
  margin: 0;
}
```

Use the actual house editing token if `--accent-soft` is not defined; confirm against existing ESPP/Comp rules before adding the rule.
- [ ] Remove only SecuritiesPanel's L6 fence entry. Run both files plus native-confirm fence. Commit `fix(portfolio): unify dividend and security edit and undo feedback`.

## Task 3: Allocation save action ownership

- [ ] Add a deferred-save test that clicks Save draft and checks only that button has `aria-busy`, while Activate has `aria-disabled` and unchanged text. Run it red.
- [ ] Replace boolean busy state with `'draft' | 'active' | null`; derive `busy` from non-null action. Each BusyButton has `.button`, its own busy condition, and `inert` when its sibling owns the request. Clear errors in every target/category edit. Keep error beside the actions.

```tsx
<BusyButton className="button" busy={saving === 'draft'} inert={busy && saving !== 'draft'}
  disabled={!valid} onClick={() => void save('draft')}>Save draft</BusyButton>
<BusyButton className="button" busy={saving === 'active'} inert={busy && saving !== 'active'}
  disabled={!valid || totalUnits !== 1_000_000} onClick={() => void save('active')}>Activate targets</BusyButton>
```

- [ ] Focus the editor trigger before the form closes on save. Check existing ClassificationEditor batch Undo tests without changing its logged protocol.
- [ ] Run the existing allocation/classification tests. Commit `fix(portfolio): show progress on the allocation action that was pressed`.

## Task 4: ESPP lots, offerings and purchase model

- [ ] Extend EsppPage tests to assert last-row edit focus/Escape, lot/offering batch Undo, and reset batch Undo. Wrap toast tests in ToastProvider. Remove tests that require native confirmation and replace them with immediate deletion assertions.
- [ ] Test model ownership by deferring a period DELETE and checking Reset is busy, Save & recalculate is inert and has no spinner. Defer a period update and assert the inverse. Test the server's reset refusal is a toast.
- [ ] Run new tests red, then apply the list-owned hook and task-1 form protocol to LotsPanel and OfferingsPanel. Keep date-prefill and precision belts unchanged. Mark row identity using its persistent id, retaining existing highlight classes.
- [ ] Return promises from `loadLots`, `loadOfferings`, `loadModeler`, `reloadLots`, `runModeler` and `onOfferingsChanged`. `onOfferingsChanged` waits for both offerings and model reloads.
- [ ] ModelerCard owns period deletes. Keep a `'save' | number | null` action state; reset stores the period id. Clear only that row's local edits after the deletion succeeds. Current reload callback returns the model fetch. Identify a restored row by persistent period id; after reset, focus the corresponding derived slot's first editable cell or the main button.
- [ ] The shared hook's immutable toast grammar prefixes `Deleted`; to meet the required sentence `Reset the {label} purchase period`, use its returned success result to replace that receipt only if an existing toast update capability supports preserving the shared Undo action. Otherwise retain exact shared Undo and document the wording constraint for coordinator resolution; do not change the primitive contract.
- [ ] Add error clearing to knobs/cells and put model errors next to Save & recalculate. Use BusyButton for all save/reset controls, preserving labels and width. Remove all three ESPP fence entries by removing its L6 key.
- [ ] Run `npx vitest run src/pages/EsppPage.test.tsx src/pages/EsppPage.charts.test.tsx src/components/feedback/noNativeConfirm.test.ts --maxWorkers=2`; commit `fix(espp): bring editors into view and restore exact deleted rows`.

## Task 5: Compensation events and RSU grants

- [ ] Add event/grant edit focus, Escape, edited-row marking and deferred reload Undo tests to CompPage.test.tsx. The old grant re-POST assertion becomes `expect(undoBatch).toHaveBeenCalledWith('grant-batch')` plus `expect(createRsuGrant).not.toHaveBeenCalled()`.
- [ ] Implement both list forms with the same focus, flash, nearby error and busy grammar. Grant edit selects `#grant-label` (the intended first typed field); event edit selects `#comp-focal-year`. Seeding a grant also reveals the form.
- [ ] Event delete uses `deleteEvent(id)` and grant delete uses `deleteRsuGrant(id)` through list-owned hooks. Reload callbacks read current refs; grant Undo brings back the same id. Wait for event/schedule fetch promises before toast/focus.
- [ ] Remove CompPage's L6 fence entry. Run `npx vitest run src/pages/CompPage.test.tsx src/components/feedback/noNativeConfirm.test.ts --maxWorkers=2`; commit `fix(comp): preserve exact events and grants through undo`.

## Task 6: Paycheck profile form and deep links

- [ ] Add tests: edit focuses Effective date; Escape returns to the edited row; delete/Undo keeps original profile id and avoids createProfile; validation focuses the named field; direct `?section=profiles` while breakdown is pending has no Summary skeleton.
- [ ] Implement list-owned profile delete and current reload callbacks. `onDeleted` passes the deleted id so the page drops only a matching breakdown selection; Undo reloads without restoring an unrelated selection. Use the current profile list when reseeding after deletion.
- [ ] `revealEditor` targets `#paycheck-effective-date`. Because the form is taller than a laptop viewport, verify the focused field is fully visible; reveal its field wrapper if revealing the entire form cannot satisfy that condition.
- [ ] Validation uses an explicit field name for every local error. The action-row FeedBanner stays next to Save/Cancel. Clear errors on the next edit; server errors whose sentence names a field focus the matching input.
- [ ] Save profile is BusyButton with `.button`; actions span the form grid and labels are nowrap. Cancel and row Edit are inert during a save. Preserve carry-forward seeding and amount focus-before-reset ordering.
- [ ] Render the breakdown Feed only when the selected section needs it; profiles deep links have only the profiles loading state. Keep Summary's tiles and flow pair untouched.
- [ ] Remove PaycheckPage's L6 fence entry. Run `npx vitest run src/pages/PaycheckPage.test.tsx src/components/feedback/noNativeConfirm.test.ts --maxWorkers=2`; commit `fix(paycheck): keep profile feedback beside its form and restore exact rows`.

## Task 7: Verification and record

- [ ] Run `npx tsc -p tsconfig.app.json --noEmit` and `npx tsc -p tsconfig.node.json --noEmit`; expected exit 0. Never `tsc -b`.
- [ ] Run `npx eslint .`; expected 0 errors and at most 26 baseline warnings.
- [ ] Coordinate with root, then run `npx vitest run --maxWorkers=4`; expected all green. No simultaneous full-suite/build lanes on the 16 GB box.
- [ ] Read the existing `audit-lib.mjs` header. Start Vite on 5276 using a wrapper config with private `cacheDir`, `VITE_API_PROXY=http://127.0.0.1:8086`, hidden background process and logs in `work-L6/`.
- [ ] Browser probes with `APP_BASE=http://127.0.0.1:5276` and `open(browser, { writes: true })`: each surface's last row Edit has its field wholly visible; add reveals/flashes; save focus never body; delete row disappears before its toast; Undo restores the original API id and transaction order; pressed action alone has busy state and its width stays held; no native dialog; both themes and reduced motion.
- [ ] Use only records created in the copied local database, remove them after checks, and close every browser and Vite process. Record any production-copy preexisting rows temporarily changed and restore them through batch Undo.
- [ ] Append As built with commit ids, test/gate counts, browser evidence, deviations, outside-scope touches and anything unfinished. Commit `docs(plan): record L6 feedback and undo verification`.

## Outside-scope touches

PortfolioPage's reload promise is the one additional file named beyond the recovered assignment's narrow implementation bullets. It is explicitly L6-owned by the approved design, and the coordinator approved the minimal plumbing to make Undo focus wait for actual data. No API client or shared feedback contract changes are planned.
