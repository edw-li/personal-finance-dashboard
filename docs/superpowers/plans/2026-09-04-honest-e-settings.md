# Honest numbers E — Settings: category kinds + account roll-up cues — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `docs/superpowers/specs/2026-09-04-honest-numbers-design.md` lane E (§8) — the two Settings cards where the user *sets* what the rest of the program computes. Settings › Categories gains a three-way `Segmented` per row (Living · Tax · Transfer), a one-line explanation of each kind, and the sentence that a kind change recomputes ALL history (§1, §6); the picker PATCHes `kind` alone through the existing `updateCategory` client. Settings › Accounts stops printing a bare parent name and starts saying who is typed and who is summed (§5): a component row reads "component of {parent}", a parent row reads "derived: {n} components", and a component whose parent is retired or missing gets the amber cue "unlinked component — counts nowhere". The create/edit form refuses `is_component` without a parent, and a parent link without `is_component`, client-side — in the SAME sentence lane B's server returns.

**Architecture:** No new components, no new routes, no new API clients. `src/types/api.ts` gains `CategoryKind` and a REQUIRED `CategoryOut.kind` (the column is NOT NULL with a `'living'` server default, so every row on the wire carries it); the optional `CategoryCreate.kind` / `CategoryUpdate.kind` ride the existing `createCategory` / `updateCategory` functions unchanged. `CategoriesCard` grows a Kind column rendering the house `Segmented` (`variant="toggle"`, `size="sm"`) and one handler shaped exactly like its `toggleActive`: one field on the wire, then `load()`. `AccountsCard` grows a pure `rollUpNote(account)` renderer over two maps derived at render time from the roster it already holds (`byId`, `componentCounts`), plus two guards at the top of `submit()`. All new colour is `var(--warn)` / `var(--muted)` in `settings.css` — tokens, never literals — and the sentence always carries the meaning, colour never alone. No `setState` in an effect body: nothing new is stored in state at all.

**Tech Stack:** React 19, TypeScript (strict, `noUnusedLocals`), vitest + Testing Library (no globals, no setup file — every test file keeps its own `afterEach(cleanup)`), ESLint flat config (`react-refresh/only-export-components` warn, `allowConstantExport: true`).

**Worktree / commands:** Branch `honest-e` from `main` AFTER lane A merges (`git worktree add .worktrees/honest-e -b honest-e main`); junction the deps once from the worktree root: `cmd //c "mklink /J node_modules ..\..\node_modules"`. All commands from the worktree root: `npx vitest run src/components/settings src/pages/SettingsPage.test.tsx`, `npx tsc -b`, `npx eslint <files>`. Local commits only — one per task, LF endings, **never push**.

**Baseline, measured on `main` @4998f68 (2026-09-04):** `npx vitest run src/components/settings src/pages/SettingsPage.test.tsx` → 14 files / 145 tests passed. `npx vitest run src/components/spending src/utils/spending.test.ts src/pages/SpendingPage.test.tsx src/pages/MonthlyUpdatePage.test.tsx src/charts` → 22 files / 316 tests passed. `npx tsc -b` clean. `npx vitest run` → 2272 tests, of which **one fails before this lane touches anything**: `src/components/taxes/WhatIfPanel.test.tsx > pins the live scenario and shows it as a compare column; Reset empties the URL`. It is a pre-existing full-suite ORDER flake, not a regression — `npx vitest run src/components/taxes/WhatIfPanel.test.tsx` alone is 27/27 green, and the file is untouched by this lane. Do not chase it here; report it to the verify lane. This lane ends at **156** in the first command (Task 1 adds fields to fixtures, not cases; Tasks 2–4 add 5 + 3 + 3), 316 in the second, and **2283** collected in the whole suite.

---

## File structure

| File | Responsibility |
|---|---|
| `src/types/api.ts` (modify) | `CategoryKind`; `kind` on `CategoryOut` (required) / `CategoryCreate` / `CategoryUpdate` |
| `src/charts/fixtures/spendingBars.fixture.ts`, `src/components/spending/BudgetPanel.test.tsx`, `src/components/spending/spendingChartOptions.test.ts`, `src/components/spending/spendingSankeyOptions.test.ts`, `src/pages/SpendingPage.test.tsx`, `src/pages/MonthlyUpdatePage.test.tsx`, `src/utils/spending.test.ts` (modify) | the seven files whose `CategoryOut` fixtures stop compiling when `kind` becomes required — one key each |
| `src/components/settings/CategoriesCard.tsx` (+ test, modify) | the Kind column, `setKind`, the two explanation lines |
| `src/components/settings/AccountsCard.tsx` (+ test, modify) | `rollUpNote`, the Roll-up column, the two pair guards |
| `src/components/settings/settings.css` (modify) | the kind cell's nowrap rule, `.accounts-link-note` and its amber `.is-unlinked` variant |

`src/pages/SettingsPage.tsx` is NOT touched: both cards are already mounted there (lines 576–577), and neither their props nor their anchor ids change.

---

### Task 1: `kind` on the category wire

**Files:**
- Modify: `src/types/api.ts`
- Modify: `src/components/settings/CategoriesCard.test.tsx`
- Modify: `src/charts/fixtures/spendingBars.fixture.ts`, `src/components/spending/BudgetPanel.test.tsx`, `src/components/spending/spendingChartOptions.test.ts`, `src/components/spending/spendingSankeyOptions.test.ts`, `src/pages/SpendingPage.test.tsx`, `src/pages/MonthlyUpdatePage.test.tsx`, `src/utils/spending.test.ts`

- [ ] **Step 1: Write the failing test**

The type-checker is the test here, and the card's own fixtures state the expectation. In `src/components/settings/CategoriesCard.test.tsx` replace the two fixtures (lines 22–29) with three:

```ts
const GROCERIES: CategoryOut = {
  id: 5,
  name: 'Groceries',
  slug: 'groceries',
  sort_order: 1,
  is_active: true,
  kind: 'living',
}
const PETS: CategoryOut = {
  id: 6,
  name: 'Pets',
  slug: 'pets',
  sort_order: 2,
  is_active: false,
  kind: 'living',
}
// The real category that started this program: $5,044.00 in April 2026, counted as living
// spend until the kind existed (spec §0).
const TAXES: CategoryOut = {
  id: 7,
  name: 'Taxes',
  slug: 'taxes',
  sort_order: 3,
  is_active: true,
  kind: 'tax',
}
```

and widen the default list in `beforeEach`:

```ts
  vi.mocked(fetchCategories).mockResolvedValue([GROCERIES, PETS, TAXES])
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsc -b`
Expected: FAIL —
```
src/components/settings/CategoriesCard.test.tsx(28,3): error TS2353: Object literal may only specify known properties, and 'kind' does not exist in type 'CategoryOut'.
```
three such errors, one per fixture.

- [ ] **Step 3: Implement the type**

In `src/types/api.ts` replace the three category interfaces (lines 129–146) with:

```ts
/**
 * What a category's money IS (2026-09-04 honest-numbers spec §1). `living`: money that left
 * the household — food, housing, a loan payment you must fund each month. `tax`: an
 * income-tax payment made from take-home (the April bill, estimated payments); payroll
 * withholding is NOT here, it never reaches net pay. `transfer`: money that stayed yours —
 * a brokerage or savings deposit, extra principal — part of net worth, not spend.
 *
 * REQUIRED on the way out: the column is NOT NULL with a `'living'` server default, so every
 * row on the wire carries it. An optional field here would let a consumer quietly read a
 * missing kind as living and hide a wire bug behind a plausible number.
 */
export type CategoryKind = 'living' | 'tax' | 'transfer'

export interface CategoryOut {
  id: number
  name: string
  slug: string
  sort_order: number
  is_active: boolean
  kind: CategoryKind
}

export interface CategoryCreate {
  name: string
  sort_order?: number
  /** Omitted = `living`, the column's server default. */
  kind?: CategoryKind
}

export interface CategoryUpdate {
  name?: string
  sort_order?: number
  is_active?: boolean
  /** Applies to ALL history: every figure that reads it moves retroactively (spec §1, §6). */
  kind?: CategoryKind
}
```

- [ ] **Step 4: Run to see the rest of the red**

Run: `npx tsc -b`
Expected: FAIL — the card's fixtures now compile, and exactly seven other files still pin the old shape:
```
src/charts/fixtures/spendingBars.fixture.ts(8,5): error TS2741: Property 'kind' is missing in type '{ id: number; name: string; slug: string; sort_order: number; is_active: true; }' but required in type 'CategoryOut'.
src/charts/fixtures/spendingBars.fixture.ts(9,5): error TS2741: ...
src/charts/fixtures/spendingBars.fixture.ts(10,5): error TS2741: ...
src/components/spending/BudgetPanel.test.tsx(16,5): error TS2741: ...
src/components/spending/BudgetPanel.test.tsx(17,5): error TS2741: ...
src/components/spending/BudgetPanel.test.tsx(18,5): error TS2741: ...
src/components/spending/spendingChartOptions.test.ts(67,7): error TS2741: ...
src/components/spending/spendingChartOptions.test.ts(68,7): error TS2741: ...
src/components/spending/spendingChartOptions.test.ts(69,7): error TS2741: ...
src/components/spending/spendingSankeyOptions.test.ts(18,7): error TS2741: ...
src/components/spending/spendingSankeyOptions.test.ts(19,7): error TS2741: ...
src/components/spending/spendingSankeyOptions.test.ts(20,7): error TS2741: ...
src/pages/MonthlyUpdatePage.test.tsx(106,61): error TS2741: ...
src/pages/SpendingPage.test.tsx(98,7): error TS2741: ...
src/pages/SpendingPage.test.tsx(99,7): error TS2741: ...
src/pages/SpendingPage.test.tsx(100,7): error TS2741: ...
src/pages/SpendingPage.test.tsx(296,11): error TS2322: Type 'CategoryOut | { ... }' is not assignable to type 'CategoryOut'.
src/pages/SpendingPage.test.tsx(297,11): error TS2741: ...
src/utils/spending.test.ts(28,29): error TS2345: ... (and the same at 37, 44, 49, 50, 51)
```

- [ ] **Step 5: Repair the seven fixtures**

Every one is a `CategoryOut` literal that predates the column. None of these fixture categories is a tax or a transfer (Rent / Food / Gas / Misc / Groceries / Fun / Dormant / Old), so `'living'` is the truthful value; lane D changes the ones its badge work needs.

`src/charts/fixtures/spendingBars.fixture.ts`, lines 8–10:

```ts
    { id: 1, name: 'Rent', slug: 'rent', sort_order: 0, is_active: true, kind: 'living' },
    { id: 2, name: 'Groceries', slug: 'groceries', sort_order: 1, is_active: true, kind: 'living' },
    { id: 3, name: 'Fun', slug: 'fun', sort_order: 2, is_active: true, kind: 'living' },
```

`src/components/spending/BudgetPanel.test.tsx`, lines 16–18:

```ts
    { id: 1, name: 'Food', slug: 'food', sort_order: 1, is_active: true, kind: 'living' },
    { id: 2, name: 'Rent', slug: 'rent', sort_order: 2, is_active: true, kind: 'living' },
    { id: 3, name: 'Old', slug: 'old', sort_order: 3, is_active: false, kind: 'living' },
```

`src/components/spending/spendingChartOptions.test.ts`, lines 67–69:

```ts
      { id: 1, name: 'Rent', slug: 'rent', sort_order: 0, is_active: true, kind: 'living' },
      {
        id: 2,
        name: 'Groceries <b>& more</b>',
        slug: 'groceries',
        sort_order: 1,
        is_active: true,
        kind: 'living',
      },
      { id: 3, name: 'Fun', slug: 'fun', sort_order: 2, is_active: true, kind: 'living' },
```

`src/components/spending/spendingSankeyOptions.test.ts`, lines 18–20:

```ts
      { id: 1, name: 'Rent', slug: 'rent', sort_order: 0, is_active: true, kind: 'living' },
      {
        id: 2,
        name: 'Groceries <b>& more</b>',
        slug: 'groceries',
        sort_order: 1,
        is_active: true,
        kind: 'living',
      },
      { id: 3, name: 'Fun', slug: 'fun', sort_order: 2, is_active: true, kind: 'living' },
```

`src/pages/MonthlyUpdatePage.test.tsx`, line 66:

```ts
const category = {
  id: 7,
  name: 'Food',
  slug: 'food',
  sort_order: 1,
  is_active: true,
  kind: 'living' as const,
}
```

`src/pages/SpendingPage.test.tsx`, lines 98–100:

```ts
      { id: 1, name: 'Rent', slug: 'rent', sort_order: 0, is_active: true, kind: 'living' },
      {
        id: 2,
        name: 'Groceries',
        slug: 'groceries',
        sort_order: 1,
        is_active: true,
        kind: 'living',
      },
      { id: 3, name: 'Fun', slug: 'fun', sort_order: 2, is_active: true, kind: 'living' },
```

`src/pages/SpendingPage.test.tsx`, line 297 — the Dormant row inside the F1 heatmap test. This one edit also clears the TS2322 reported on line 296: that error is only the array's element union complaining about this literal.

```ts
          {
            id: 4,
            name: 'Dormant',
            slug: 'dormant',
            sort_order: 3,
            is_active: true,
            kind: 'living',
          },
```

`src/utils/spending.test.ts`, lines 4–9 — one shared const behind all six errors:

```ts
const categories = [
  { id: 1, name: 'Rent', slug: 'rent', sort_order: 1, is_active: true, kind: 'living' as const },
  { id: 2, name: 'Food', slug: 'food', sort_order: 2, is_active: true, kind: 'living' as const },
  { id: 3, name: 'Gas', slug: 'gas', sort_order: 3, is_active: true, kind: 'living' as const },
  { id: 4, name: 'Misc', slug: 'misc', sort_order: 4, is_active: true, kind: 'living' as const },
]
```

`as const` in exactly the two un-annotated fixtures (`MonthlyUpdatePage.test.tsx`'s `category` and this array): without a contextual type TypeScript widens the literal to `string`, which is not assignable to `CategoryKind`. The annotated fixtures above need no assertion — their contextual type is already `CategoryOut`.

- [ ] **Step 6: Run to verify it passes**

Run: `npx tsc -b && npx vitest run src/components/settings src/pages/SettingsPage.test.tsx && npx vitest run src/components/spending src/utils/spending.test.ts src/pages/SpendingPage.test.tsx src/pages/MonthlyUpdatePage.test.tsx src/charts`
Expected: `tsc` clean; then `14 passed (14)` files / `145 passed (145)` tests; then `22 passed (22)` files / `316 passed (316)` tests. The card's list grew a third row and nothing in that file counts rows — `getByText('Retired')` still finds exactly PETS.

- [ ] **Step 7: Mutation check**

Delete the `kind: CategoryKind` line from `CategoryOut` in `src/types/api.ts`, then run `npx tsc -b`.
Expected: FAIL with `TS2353: Object literal may only specify known properties, and 'kind' does not exist in type 'CategoryOut'` in all eight fixture files — the fixtures really do pin the field, so a later lane cannot quietly drop it and stay green. Restore the line, re-run `npx tsc -b` → clean.

- [ ] **Step 8: Lint and commit**

```bash
npx eslint src/types/api.ts src/components/settings src/components/spending src/utils/spending.test.ts src/pages/SpendingPage.test.tsx src/pages/MonthlyUpdatePage.test.tsx src/charts/fixtures/spendingBars.fixture.ts
git add src/types/api.ts src/components/settings/CategoriesCard.test.tsx src/charts/fixtures/spendingBars.fixture.ts src/components/spending/BudgetPanel.test.tsx src/components/spending/spendingChartOptions.test.ts src/components/spending/spendingSankeyOptions.test.ts src/pages/SpendingPage.test.tsx src/pages/MonthlyUpdatePage.test.tsx src/utils/spending.test.ts
git commit -m "feat(types): categories carry a kind (living/tax/transfer) on the wire"
```
Expected: eslint prints nothing.

---

### Task 2: the kind picker in Settings › Categories

**Files:**
- Modify: `src/components/settings/CategoriesCard.test.tsx`
- Modify: `src/components/settings/CategoriesCard.tsx`
- Modify: `src/components/settings/settings.css`

- [ ] **Step 1: Write the failing test**

Append to `src/components/settings/CategoriesCard.test.tsx`:

```ts
it('shows each category kind on a three-way picker', async () => {
  render(<CategoriesCard />)
  await screen.findByRole('table')

  const groceries = within(screen.getByRole('group', { name: 'Kind for Groceries' }))
  expect(groceries.getByRole('button', { name: 'Living' }).getAttribute('aria-pressed')).toBe(
    'true',
  )
  expect(groceries.getByRole('button', { name: 'Tax' }).getAttribute('aria-pressed')).toBe('false')
  expect(groceries.getByRole('button', { name: 'Transfer' }).getAttribute('aria-pressed')).toBe(
    'false',
  )
  // The picker READS the row, it does not hold its own copy: Taxes must land on Tax.
  const taxes = within(screen.getByRole('group', { name: 'Kind for Taxes' }))
  expect(taxes.getByRole('button', { name: 'Tax' }).getAttribute('aria-pressed')).toBe('true')
  expect(taxes.getByRole('button', { name: 'Living' }).getAttribute('aria-pressed')).toBe('false')
})

it('PATCHes the kind alone and re-reads the list', async () => {
  render(<CategoriesCard />)
  await screen.findByRole('table')

  fireEvent.click(
    within(screen.getByRole('group', { name: 'Kind for Groceries' })).getByRole('button', {
      name: 'Transfer',
    }),
  )

  await waitFor(() => expect(vi.mocked(updateCategory)).toHaveBeenCalledTimes(1))
  // ONLY kind on the wire — toggleActive's rule: sending the name and position back would
  // let a stale render overwrite a concurrent edit.
  expect(vi.mocked(updateCategory).mock.calls[0]).toEqual([5, { kind: 'transfer' }])
  await waitFor(() => expect(vi.mocked(fetchCategories)).toHaveBeenCalledTimes(2))
})

it('does not PATCH when the kind a row already has is clicked again', async () => {
  render(<CategoriesCard />)
  await screen.findByRole('table')

  fireEvent.click(
    within(screen.getByRole('group', { name: 'Kind for Taxes' })).getByRole('button', {
      name: 'Tax',
    }),
  )

  // Segmented reports every click, including one on the active button. A PATCH that changes
  // nothing would still write a change-log batch offering to "undo" a no-op.
  await waitFor(() => expect(vi.mocked(fetchCategories)).toHaveBeenCalledTimes(1))
  expect(vi.mocked(updateCategory)).not.toHaveBeenCalled()
})

it('spells out what each kind means and that a change moves ALL history', async () => {
  render(<CategoriesCard />)
  await screen.findByRole('table')

  expect(screen.getByText(/Living: money that left the household/)).toBeTruthy()
  expect(screen.getByText(/Tax: an income-tax payment made from take-home/)).toBeTruthy()
  expect(screen.getByText(/Transfer: money that stayed yours/)).toBeTruthy()
  expect(screen.getByText(/Changing a kind recomputes ALL history/)).toBeTruthy()
})

it('banners a refused kind change and leaves the row on its old kind', async () => {
  vi.mocked(updateCategory).mockRejectedValue(
    new ApiError('kind must be one of: living, tax, transfer', 422),
  )
  render(<CategoriesCard />)
  await screen.findByRole('table')

  fireEvent.click(
    within(screen.getByRole('group', { name: 'Kind for Groceries' })).getByRole('button', {
      name: 'Tax',
    }),
  )

  expect(await screen.findByText('kind must be one of: living, tax, transfer')).toBeTruthy()
  // No optimistic local copy: a refused change must leave Groceries reading Living.
  expect(
    within(screen.getByRole('group', { name: 'Kind for Groceries' }))
      .getByRole('button', { name: 'Living' })
      .getAttribute('aria-pressed'),
  ).toBe('true')
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/settings/CategoriesCard.test.tsx`
Expected: FAIL — 5 failed, 6 passed. The first four fail with `Unable to find an accessible element with the role "group" and name "Kind for Groceries"`; the copy test fails with `Unable to find an element with the text: /Living: money that left the household/`.

- [ ] **Step 3: Implement the card**

In `src/components/settings/CategoriesCard.tsx`:

1. Replace the type import and add the control's import (the file's import block, lines 3–15):

```tsx
import type { CategoryKind, CategoryOut } from '../../types/api'
import InfoHint from '../InfoHint'
import { useToast } from '../ToastProvider'
import { FeedBanner } from '../shell/Feed'
import Segmented from '../shell/Segmented'
import '../panels.css'
import './settings.css'
```

2. Below `EMPTY_CATEGORY`, add the options:

```tsx
// Living · Tax · Transfer (2026-09-04 honest-numbers spec §1) on the house's ONE pick-one
// control, so a category's kind reads like every other three-way choice in the app.
const KINDS: { value: CategoryKind; label: string }[] = [
  { value: 'living', label: 'Living' },
  { value: 'tax', label: 'Tax' },
  { value: 'transfer', label: 'Transfer' },
]
```

3. Directly after `toggleActive`, add the handler:

```tsx
  // ONLY kind on the wire — toggleActive's rule: the name and position are untouched columns
  // here. Clicking the kind a row already has is a no-op: Segmented reports every click,
  // including one on the active button, and a PATCH that changed nothing would still write a
  // change-log batch offering to "undo" it (L2 hooks cover PATCH /categories, spec §6).
  const setKind = (category: CategoryOut, next: CategoryKind) => {
    if (next === category.kind) return
    setBusy(true)
    setError(null)
    updateCategory(category.id, { kind: next })
      .then(() => load())
      .catch((err: unknown) => setError(message(err, 'Update failed')))
      .finally(() => setBusy(false))
  }
```

4. Add the column to `<thead>` — the kind belongs beside the name, not after the bookkeeping:

```tsx
                  <tr>
                    <th>Category</th>
                    <th>Kind</th>
                    <th className="num">Sort</th>
                    <th>Status</th>
                    <th />
                  </tr>
```

5. In `<tbody>`, insert the picker cell between the name and the sort cell:

```tsx
                      <td>{category.name}</td>
                      <td>
                        <Segmented
                          variant="toggle"
                          size="sm"
                          ariaLabel={`Kind for ${category.name}`}
                          // disabled while a request is in flight, like the row's other
                          // controls: a second PATCH would race the reload that follows the
                          // first and the picker would flicker back.
                          options={KINDS.map((k) => ({ ...k, disabled: busy }))}
                          value={category.kind}
                          onChange={(next) => setKind(category, next)}
                        />
                      </td>
                      <td className="num">{category.sort_order}</td>
```

6. Wrap the table in a fragment and add the copy under it — the explanation belongs on the page, not inside a hover hint, because it is the whole basis of every savings figure:

```tsx
          {categories.length === 0 ? (
            <p className="empty-note">No categories yet — add the first one above.</p>
          ) : (
            <>
              <div className="settings-scroll">
                <table className="data-table category-table">
                  {/* …the existing thead and tbody, unchanged apart from the Kind column… */}
                </table>
              </div>
              <p className="settings-note">
                Living: money that left the household — food, housing, a loan payment you
                must fund each month. Tax: an income-tax payment made from take-home, like
                the April bill; payroll withholding is not here, it never reaches net pay.
                Transfer: money that stayed yours — a brokerage or savings deposit, extra
                principal — part of net worth, not spend.
              </p>
              <p className="settings-note">
                Changing a kind recomputes ALL history: every month, chart and projection
                that reads it moves, not just this one. The change is recorded in Activity.
              </p>
            </>
          )}
```

A new category is created `living` (the column default) and re-kinded on its row a second later, so the add/edit form deliberately gains no fourth field — one place to set a kind, not two.

- [ ] **Step 4: Implement the style**

Append to `src/components/settings/settings.css`:

```css
/* --- category kinds + account roll-up cues (2026-09-04 honest-numbers spec §1, §5) --- */

/* The kind picker lives in a table cell. Without this the three-button group breaks across
   lines on a narrow card and the column's width jumps as the pressed label changes. */
.category-table td .segmented {
  white-space: nowrap;
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/components/settings src/pages/SettingsPage.test.tsx`
Expected: `14 passed (14)` files / `150 passed (150)` tests — CategoriesCard is now 11.

- [ ] **Step 6: Mutation check**

In `setKind`, widen the body from `{ kind: next }` to `{ kind: next, sort_order: category.sort_order }` and run `npx vitest run src/components/settings/CategoriesCard.test.tsx`.
Expected: FAIL — `PATCHes the kind alone and re-reads the list` reports `[5, { kind: 'transfer', sort_order: 1 }]` against the expected `[5, { kind: 'transfer' }]`. Restore `{ kind: next }` and re-run → 11 passed.

- [ ] **Step 7: Type-check, lint, commit**

```bash
npx tsc -b && npx eslint src/components/settings
git add src/components/settings/CategoriesCard.tsx src/components/settings/CategoriesCard.test.tsx src/components/settings/settings.css
git commit -m "feat(settings): a Living/Tax/Transfer picker per category, with what each kind means"
```
Expected: `tsc` clean, eslint prints nothing.

---

### Task 3: Accounts card — who is typed, who is summed

**Files:**
- Modify: `src/components/settings/AccountsCard.test.tsx`
- Modify: `src/components/settings/AccountsCard.tsx`
- Modify: `src/components/settings/settings.css`

- [ ] **Step 1: Write the failing test**

In `src/components/settings/AccountsCard.test.tsx`, add the fixtures after `HSA`:

```ts
// The 401(k) shape production actually has (spec §0): a parent whose balance is nothing but
// the sum of its components, typed by hand every month for 37 months.
const TRAD: AccountOut = {
  id: 20,
  name: 'Fidelity Traditional 401(k)',
  slug: 'fidelity-traditional-401k',
  group: 'pre_tax',
  sort_order: 3,
  is_active: true,
  is_component: false,
  parent_account_id: null,
  person_id: 1,
}
const TRAD_PRETAX: AccountOut = {
  id: 21,
  name: 'Traditional pre-tax',
  slug: 'traditional-pre-tax',
  group: 'pre_tax',
  sort_order: 4,
  is_active: true,
  is_component: true,
  parent_account_id: 20,
  person_id: 1,
}
const TRAD_MATCH: AccountOut = {
  id: 22,
  name: 'Traditional employer match',
  slug: 'traditional-employer-match',
  group: 'pre_tax',
  sort_order: 5,
  is_active: true,
  is_component: true,
  parent_account_id: 20,
  person_id: 1,
}
// Two ways to belong to nothing: no parent at all, and a parent that has been retired.
const ORPHAN: AccountOut = {
  id: 23,
  name: 'Old rollover slice',
  slug: 'old-rollover-slice',
  group: 'pre_tax',
  sort_order: 6,
  is_active: true,
  is_component: true,
  parent_account_id: null,
  person_id: 1,
}
const CLOSED_PARENT: AccountOut = {
  id: 24,
  name: 'Closed 401(k)',
  slug: 'closed-401k',
  group: 'pre_tax',
  sort_order: 7,
  is_active: false,
  is_component: false,
  parent_account_id: null,
  person_id: 1,
}
const CLOSED_SLICE: AccountOut = {
  id: 25,
  name: 'Closed 401(k) pre-tax',
  slug: 'closed-401k-pre-tax',
  group: 'pre_tax',
  sort_order: 8,
  is_active: true,
  is_component: true,
  parent_account_id: 24,
  person_id: 1,
}
```

and append the three cases:

```ts
it('says which rows are typed and which are summed', async () => {
  vi.mocked(fetchAccounts).mockResolvedValue([CHECKING, TRAD, TRAD_PRETAX, TRAD_MATCH])
  render(<AccountsCard people={[ME]} />)
  await screen.findByRole('table', { name: 'Net-worth accounts' })

  expect(roster().getByRole('columnheader', { name: 'Roll-up' })).toBeTruthy()
  // A parent with components has no balance of its own — it IS its components (spec §5).
  expect(roster().getByText('derived: 2 components')).toBeTruthy()
  expect(roster().getAllByText('component of Fidelity Traditional 401(k)')).toHaveLength(2)
  // A plain account is neither summed nor summed into: only Joint Checking reads '—'.
  expect(roster().getAllByText('—')).toHaveLength(1)
})

it('flags a component whose parent is missing or retired', async () => {
  vi.mocked(fetchAccounts).mockResolvedValue([ORPHAN, CLOSED_PARENT, CLOSED_SLICE])
  render(<AccountsCard people={[ME]} />)
  await screen.findByRole('table', { name: 'Net-worth accounts' })

  // Net worth sums the NON-component rows, so a component only reaches a total through a
  // present, active parent. Both of these reach none at all.
  const cues = roster().getAllByText('unlinked component — counts nowhere')
  expect(cues).toHaveLength(2)
  // Amber rides a class (--warn in the sheet); the SENTENCE is the channel that always
  // works — colour is never alone.
  expect(cues[0].className).toBe('accounts-link-note is-unlinked')
  // A retired parent still says how many rows roll into it, singular.
  expect(roster().getByText('derived: 1 component')).toBeTruthy()
})

it('still names a parent the component flag forgot', async () => {
  // A link without the flag: the half-set pair Task 4 and lane B refuse from now on. The
  // roster must not hide a link it can see, and must not claim a roll-up either.
  vi.mocked(fetchAccounts).mockResolvedValue([TRAD, { ...TRAD_PRETAX, is_component: false }])
  render(<AccountsCard people={[ME]} />)
  await screen.findByRole('table', { name: 'Net-worth accounts' })

  expect(roster().getByText('parent: Fidelity Traditional 401(k)')).toBeTruthy()
  // The parent still counts it: the balances PUT sums over the LINK (spec §5).
  expect(roster().getByText('derived: 1 component')).toBeTruthy()
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/settings/AccountsCard.test.tsx`
Expected: FAIL — 3 failed, 12 passed. `says which rows are typed and which are summed` fails on `Unable to find an accessible element with the role "columnheader" and name "Roll-up"`; the other two fail on the missing `unlinked component — counts nowhere` / `parent: Fidelity Traditional 401(k)` text.

- [ ] **Step 3: Implement the card**

In `src/components/settings/AccountsCard.tsx`, replace the `accountName` map (the line `const accountName = new Map(accounts.map((a) => [a.id, a.name]))`) with the two derived maps and the renderer — all computed at render time from `accounts`, so nothing new enters state and no effect writes any:

```tsx
  const byId = new Map(accounts.map((a) => [a.id, a]))
  // How many rows roll UP into each account. Counted over `parent_account_id`, which is the
  // spec's own definition of a component (§5: "an account with at least one component
  // (`accounts.parent_account_id = it`)") and the exact set the balances PUT sums — NOT over
  // `is_component`, which is the rollup key rather than the link.
  const componentCounts = new Map<number, number>()
  for (const a of accounts) {
    if (a.parent_account_id === null) continue
    componentCounts.set(a.parent_account_id, (componentCounts.get(a.parent_account_id) ?? 0) + 1)
  }

  /**
   * What the roster says about a row's place in the roll-up (2026-09-04 honest-numbers spec
   * §5). A parent with components has no balance of its own — the wizard derives it — so the
   * table has to say which rows are typed and which are summed, rather than printing a bare
   * parent name that reads the same either way.
   */
  const rollUpNote = (account: AccountOut) => {
    const parent =
      account.parent_account_id === null ? undefined : byId.get(account.parent_account_id)
    if (account.is_component) {
      // Net worth sums the NON-component rows, so a component reaches a total only through a
      // parent that is present and active; with the parent gone or retired its balance lands
      // in no figure at all — hence "counts nowhere", literally. Advisory amber (--warn, the
      // .draft-note register) and the sentence together: colour is never the only channel.
      if (parent === undefined || !parent.is_active) {
        return (
          <span className="accounts-link-note is-unlinked">
            unlinked component — counts nowhere
          </span>
        )
      }
      return <span className="accounts-link-note">component of {parent.name}</span>
    }
    const n = componentCounts.get(account.id) ?? 0
    if (n > 0) {
      return (
        <span className="accounts-link-note">
          derived: {n} component{n === 1 ? '' : 's'}
        </span>
      )
    }
    // A link without the flag is the half-set pair Task 4 refuses. Keep naming the parent —
    // the roster must not hide a link it can see — but claim nothing about the roll-up: the
    // two halves disagree about where this balance belongs, and that is the whole point.
    if (parent !== undefined) {
      return <span className="accounts-link-note">parent: {parent.name}</span>
    }
    return '—'
  }
```

Rename the column header (the `<thead>` of the net-worth table) from `<th>Parent</th>` to:

```tsx
                    <th>Roll-up</th>
```

and replace the body cell that used `accountName`:

```tsx
                      <td>{rollUpNote(account)}</td>
```

- [ ] **Step 4: Implement the style**

Append to `src/components/settings/settings.css`, under the block added in Task 2:

```css
/* "component of X" / "derived: n components" / "parent: X" are sentences ABOUT the row, not
   values in it — muted, at the size the card's other subtexts use. */
.accounts-link-note {
  color: var(--muted);
  font-size: 0.78rem;
}

/* A component whose parent is retired or gone reaches no total at all: net worth sums the
   non-component rows, and this one has nothing to be summed into. The app's one advisory
   register (--warn, PALETTE[3] amber, the .draft-note family) — and the sentence says it
   too, because colour is never the only channel. */
.accounts-link-note.is-unlinked {
  color: var(--warn);
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/components/settings src/pages/SettingsPage.test.tsx`
Expected: `14 passed (14)` files / `153 passed (153)` tests — AccountsCard is now 15.

- [ ] **Step 6: Mutation check**

In `rollUpNote`, drop the retired half of the guard — change `if (parent === undefined || !parent.is_active) {` to `if (parent === undefined) {` — and run `npx vitest run src/components/settings/AccountsCard.test.tsx`.
Expected: FAIL — `flags a component whose parent is missing or retired` reports `expected length 2 but got 1` for `unlinked component — counts nowhere` (the retired parent's slice now claims to be "component of Closed 401(k)"). Restore the full guard and re-run → 15 passed.

- [ ] **Step 7: Type-check, lint, commit**

```bash
npx tsc -b && npx eslint src/components/settings
git add src/components/settings/AccountsCard.tsx src/components/settings/AccountsCard.test.tsx src/components/settings/settings.css
git commit -m "feat(settings): the accounts roster says which rows are derived and which count nowhere"
```
Expected: `tsc` clean (the old `accountName` map is gone, so `noUnusedLocals` stays quiet), eslint prints nothing.

---

### Task 4: Accounts card — the component pair guard

**Files:**
- Modify: `src/components/settings/AccountsCard.test.tsx`
- Modify: `src/components/settings/AccountsCard.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/components/settings/AccountsCard.test.tsx`:

```ts
it('refuses a component with no parent, in the server\'s own sentence', async () => {
  render(<AccountsCard people={[ME]} />)
  await screen.findByRole('table', { name: 'Net-worth accounts' })

  fireEvent.change(screen.getByLabelText('Account name'), {
    target: { value: 'Traditional slice' },
  })
  fireEvent.click(screen.getByLabelText('Component of the parent'))
  fireEvent.click(screen.getByRole('button', { name: 'Add account' }))

  expect(
    await screen.findByText(
      'is_component needs parent_account_id — name the account it folds into',
    ),
  ).toBeTruthy()
  // Refused BEFORE the round trip, and lane B's 422 says the same words — the reader never
  // meets two spellings of one rule.
  expect(vi.mocked(createAccount)).not.toHaveBeenCalled()
})

it('refuses a parent link with no component flag, in the server\'s own sentence', async () => {
  render(<AccountsCard people={[ME]} />)
  await screen.findByRole('table', { name: 'Net-worth accounts' })

  fireEvent.change(screen.getByLabelText('Account name'), {
    target: { value: 'Traditional slice' },
  })
  fireEvent.change(screen.getByLabelText('Parent account'), { target: { value: '11' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add account' }))

  expect(
    await screen.findByText(
      'parent_account_id needs is_component — a linked account must be a component',
    ),
  ).toBeTruthy()
  expect(vi.mocked(createAccount)).not.toHaveBeenCalled()
})

it('clears the refusal as soon as the pair is fixed', async () => {
  render(<AccountsCard people={[ME]} />)
  await screen.findByRole('table', { name: 'Net-worth accounts' })

  fireEvent.change(screen.getByLabelText('Account name'), {
    target: { value: 'Traditional slice' },
  })
  fireEvent.click(screen.getByLabelText('Component of the parent'))
  fireEvent.click(screen.getByRole('button', { name: 'Add account' }))
  expect(
    await screen.findByText(
      'is_component needs parent_account_id — name the account it folds into',
    ),
  ).toBeTruthy()

  // Unticking removes the half the banner is about, so the banner goes with it: setText's
  // rule for the text fields, extended to the card's one checkbox.
  fireEvent.click(screen.getByLabelText('Component of the parent'))
  expect(
    screen.queryByText(
      'is_component needs parent_account_id — name the account it folds into',
    ),
  ).toBeNull()
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/settings/AccountsCard.test.tsx`
Expected: FAIL — 3 failed, 15 passed. Each fails on `Unable to find an element with the text: is_component needs parent_account_id …` / `parent_account_id needs is_component …`; the first two also show `createAccount` was called once, because the half-set pair currently sails through to the network.

- [ ] **Step 3: Implement**

In `src/components/settings/AccountsCard.tsx`, add the two sentences beside `EMPTY_ACCOUNT`:

```tsx
// The two sentences lane B's 422 returns for a half-set pair (2026-09-04 honest-numbers spec
// §5), spelled here so the client refusal and the server refusal are ONE sentence rather than
// two paraphrases. `is_component` is the rollup key and `parent_account_id` the link: a row
// carrying one without the other counts in no total, so each message names the missing half.
const COMPONENT_NEEDS_PARENT =
  'is_component needs parent_account_id — name the account it folds into'
const PARENT_NEEDS_COMPONENT =
  'parent_account_id needs is_component — a linked account must be a component'
```

Add the guards at the top of `submit()`, directly after the existing name check and before the body is built:

```tsx
    if (form.is_component && form.parent_account_id === '') {
      setError(COMPONENT_NEEDS_PARENT)
      return
    }
    if (!form.is_component && form.parent_account_id !== '') {
      setError(PARENT_NEEDS_COMPONENT)
      return
    }
```

and clear the banner from the checkbox the way `setText` already clears it from the text fields — the refusal is about a pair the form may no longer have:

```tsx
            <label className="accounts-check">
              <input
                type="checkbox"
                checked={form.is_component}
                onChange={(e) => {
                  setForm((f) => ({ ...f, is_component: e.target.checked }))
                  setError(null)
                }}
              />
              Component of the parent
            </label>
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/settings src/pages/SettingsPage.test.tsx && npx tsc -b && npx eslint src/components/settings src/types/api.ts`
Expected: `14 passed (14)` files / `156 passed (156)` tests — AccountsCard is now 18; `tsc` clean; eslint prints nothing. (The card's existing `creates an account with owner, parent and the component flag` sets both halves and still reaches `createAccount`; `retags an account to joint with an EXPLICIT null` edits a row with neither half and is untouched.)

- [ ] **Step 5: Mutation check**

Delete the second guard (the `if (!form.is_component && form.parent_account_id !== '')` block) and run `npx vitest run src/components/settings/AccountsCard.test.tsx`.
Expected: FAIL — `refuses a parent link with no component flag, in the server's own sentence` cannot find the sentence and reports `createAccount` called once. Restore the block and re-run → 18 passed.

- [ ] **Step 6: Whole-lane verification**

Run: `npx tsc -b && npx eslint . && npx vitest run`
Expected: `tsc` clean; eslint clean; 2283 tests across 174 files (2272 on `main` + 5 + 3 + 3), with the SAME single pre-existing failure the baseline had (`WhatIfPanel > pins the live scenario …`) and nothing else red. Confirm it is the same one by running `npx vitest run src/components/taxes/WhatIfPanel.test.tsx` → 27 passed.

- [ ] **Step 7: Commit**

```bash
git add src/components/settings/AccountsCard.tsx src/components/settings/AccountsCard.test.tsx
git commit -m "feat(settings): refuse a component without a parent, and a parent without the component flag"
```

---

## Merge notes for the coordinator

- **Neither card is touched by another lane.** `CategoriesCard.tsx` and `AccountsCard.tsx` appear only in lane E's row of spec §8. `src/pages/SettingsPage.tsx` is not modified here at all — the two cards are already mounted (lines 576–577) and keep their props and ids, so a conflict there means someone else moved them.
- **`src/types/api.ts` is the one shared file.** Lane D's plan (`2026-09-04-honest-d-consumers.md`, File-structure row for `src/types/api.ts`, and its note "Lane E owns `CategoryCreate.kind` / `CategoryUpdate.kind`… If E landed first and the union already exists, reuse it rather than declaring a second one") declares `CategoryKind` + `CategoryOut.kind` too, because the rollup badge reads them; lane C edits the file for the wizard's save shapes. Resolution: **one** `CategoryKind` union and **one** `kind` on `CategoryOut`, REQUIRED, with this lane's doc comment; `CategoryCreate.kind` / `CategoryUpdate.kind` come only from here. Whichever lane lands second drops its duplicate declaration.
- **The seven fixture files in Task 1 belong to lanes C and D.** `MonthlyUpdatePage.test.tsx` is C's; D's plan modifies `src/components/spending/spendingChartOptions.test.ts` (two-line pins, legend words, CSV) and `src/charts/fixtures/spendingBars.fixture.ts` (`MATRIX` gains the savings arrays) — both also on this lane's repair list, so expect a conflict in exactly those two. The hunks are in different parts of the fixtures (this lane adds `kind` to the `categories` rows; D adds sibling arrays and pins), so both sides survive. Merging E first is cheapest: C and D then rebase onto fixtures that already carry `kind` and only change the values they need. If D lands first and already added the key, drop this lane's hunk for that file — every value here is `'living'` and carries no information D would lose.
- **`settings.css` is appended to by several lanes** (F1/F2 of the lifecycle batch already did). Take both sides of any conflict; this lane's block is the last one, headed `/* --- category kinds + account roll-up cues (2026-09-04 honest-numbers spec §1, §5) --- */`.
- **Contract with lane B (already reconciled).** The two sentences in `AccountsCard.tsx` are lane B's own, copied from `2026-09-04-honest-b-backend-save-guards.md` (`_check_component_link`, the `detail=` strings on `create_account` / `update_account`, and its `test_account_component_halves_must_travel_together`). They must stay byte-identical to the 422 details B returns from `POST /accounts` and `PATCH /accounts/{id}`:
  - `is_component needs parent_account_id — name the account it folds into`
  - `parent_account_id needs is_component — a linked account must be a component`
  Em dash (U+2014), no trailing period, no quotation marks. If lane B's wording moved after this plan was written, change THIS side to match what the server actually returns and update the four Task 4 assertions — the server's sentence wins, always.
- **Browser smoke (verify lane V):** Settings › Spending categories — set Taxes to Tax, watch the row re-read from the server, then confirm Spending's April 2026 splits into living + tax; click Tax again on the same row and confirm no second Activity entry. Settings › Accounts — the two Fidelity 401(k) parents read "derived: 3 components" / "derived: 2 components" and their five slices read "component of …"; retire one parent and its slices turn amber. Try to add an account with the component box ticked and no parent: the banner appears without a network call (check the Network tab). Both themes.

## Self-review

**Spec coverage.** §1 UI ("Settings › Categories: a three-way `Segmented` per row (Living · Tax · Transfer) with a one-line explanation of each") → Task 2, Steps 3 and 5; the explanation copy is lifted from §1's own Meaning paragraph, including the "payroll withholding is NOT here — it never reaches net pay" clause that is the easiest thing for a reader to get wrong. §1 "Kinds apply to ALL history — changing a kind recomputes every figure that reads it; the Settings copy says so" and §6 "the Settings picker's helper text says so and the change is logged" → the second `<p>`, asserted by `spells out what each kind means and that a change moves ALL history`. §1 API "`CategoryOut.kind`, `CategoryCreate.kind` (default `living`), `CategoryUpdate.kind`" → Task 1, all three, with `kind` required only on `Out`. §5 Settings ("a component's row says 'component of {parent}'; a parent's row says 'derived: {n} components'; a component whose parent is inactive or missing gets an amber cue") → Task 3. §5 "the PATCH that sets one without the other is refused with a 422 naming the other field" → Task 4, both directions, both messages naming the other field. §7 Frontend testing list, "Settings kind picker" → Task 2's five cases. Out of lane E's scope and deliberately absent: the Spending rollup/heatmap badge (lane D), the wizard's derived rows (lane C), the server guards themselves (lane B).

**Two judgement calls a reviewer should check.** (1) `componentCounts` is keyed on `parent_account_id` alone, not on `is_component && parent_account_id`, because §5 defines a component as `accounts.parent_account_id = it` and that is the set the balances PUT sums; the consequence is that a half-set row still increments its parent's count, which is why the fourth branch exists. (2) That fourth branch (`parent: {name}` for a row with a link and no flag) is one line past the letter of §5, added because the column it replaces printed the parent's name for exactly those rows — dropping to `—` would have hidden a link the roster can see. It is deliberately NOT amber: the amber register stays reserved for §5's one case, and this row's balance does reach a total.

**Cross-lane reconciliation done while writing this plan.** The two refusal sentences were NOT invented here: they are lane B's, read out of `2026-09-04-honest-b-backend-save-guards.md` so the client and the server ship one wording rather than two paraphrases. Lane D's plan was read too — it also declares `CategoryKind` / `CategoryOut.kind` and edits two of the seven fixtures this lane repairs; the merge notes above say which side wins in each case.

**Placeholders:** none. Every path, line number, fixture, command and expected count in this plan was read or run against `main` @4998f68 on 2026-09-04; the Task 1 error list is the literal `npx tsc -b` output from making `kind` required. The one elision is the `{/* …the existing thead and tbody… */}` marker in Task 2 Step 6, which points at code the same step already rewrites in full above it.

**Type consistency:** `CategoryKind = 'living' | 'tax' | 'transfer'`; `CategoryOut.kind: CategoryKind` (required), `CategoryCreate.kind?`, `CategoryUpdate.kind?`; `updateCategory(id, { kind })` is the existing `(categoryId: number, body: CategoryUpdate)` client, unchanged. `Segmented` is used inside its non-`multiple` arm — `variant="toggle"`, `size="sm"`, `ariaLabel`, `options: readonly SegmentedOption<CategoryKind>[]`, `value: CategoryKind`, `onChange: (next: CategoryKind) => void` — which renders `role="group"` with `aria-pressed` per button, exactly what the tests query. `rollUpNote` returns `ReactElement | string`, which is a valid `<td>` child. `AccountOut` is unchanged: `is_component` stays the rollup key and `parent_account_id` the link, as §5 requires ("No schema change").

**House rules:** `Segmented` for the pick-one; `var(--warn)` / `var(--muted)` / `var(--surface)` tokens, no literal colours; every comment says WHY (why one field on the wire, why the no-op click is skipped, why the count is keyed on the link, why the amber sentence is redundant with its colour); no `setState` in an effect body — the two new maps and the renderer are derived at render time and nothing is stored; each task has a mutation check that names the exact edit, the exact failing test and the restore; LF endings; one commit per task; nothing pushed.
