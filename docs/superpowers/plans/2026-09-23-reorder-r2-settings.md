# Lane R2 — Settings: drag to reorder spending categories and accounts (2026-09-23) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (one
> implementer for this lane in its own worktree, TDD per task, then a spec-compliance review and a
> code-quality review, then merge into `feat/reorder-base` — never main, never pushed). Steps use
> `- [ ]` checkboxes.

**Spec:** `docs/superpowers/specs/2026-09-23-drag-to-reorder-design.md` — this lane implements **§4
(Settings › Spending categories and Settings › Accounts)** and the R2 rows of **§8.1, §9, §10 and
§11**. Read §0, §2 (what the shared component does), §4, §8 and §9 before Task 1. The spec is
authoritative where this plan is silent; where the spec is silent, the choice this plan makes is
recorded under "Decisions".

**Goal:** both Settings management tables become reorderable lists. A row is dragged by its grip, or
lifted with Space and moved with the arrow keys. A drop saves the whole order in one PUT, shows at
once, flashes when saved, and names itself in a toast with the change log's Undo behind it. The
Sort order boxes and the Sort column are gone, and the Accounts table is grouped the way the Monthly
update walks it.

**Architecture:**
- Each card calls lane R0's `useReorder` once and renders its rows with `itemProps`, a
  `DragHandle` in a new first column, and the two screen-reader helpers once, outside the table.
- `onCommit` sets a `pendingOrder` rows array synchronously (the adjust-during-render idiom of
  `creditcards/CategoriesPanel.tsx:81-97`), then calls lane R1's `reorderCategories` /
  `reorderAccounts` with the full new id order.
- On success the rows are replaced from the response. On failure the pending order is dropped and
  the rows fall back to the last server order. A 409 also reloads. Undo is `undoBatch(batchId)`
  from the change log.
- Accounts: the table is built group by group in `GROUP_ORDER` with `nestComponents` run per group.
  A top-level account's range is its group and it carries its nested components; a component's
  range is `parent:<id>`.

**Tech stack:** React 19 + TypeScript 5.9 strict, Vite, vitest 3 + @testing-library/react (jsdom;
**no** jest-dom matchers — assert with `getAttribute`/`textContent`/`.disabled`), the lane-R0
component in `src/components/reorder/`, the lane-R1 client functions in `src/api/`.

---

## Controller amendments (2026-09-23, after lane R0's review — these override the tasks below)

**A1. Task 7 keeps only the Settings-specific rules.** Lane R0's `src/components/reorder/reorder.css`
(merged before this lane starts) now owns:
- the table border model, as `table.reorder-table { border-collapse: separate; border-spacing: 0; }`
  (0,1,1), which beats `.data-table` on specificity;
- `.reorder-table .reorder-grip-cell` (width 2rem, `padding-right: 0`);
- the lifted and drop-line row states scoped under `.reorder-table`, including sticky
  `td.row-actions` / `td.col-identity` variants that keep each pinned cell's own hairline.

In Task 7, therefore:
- **Do not add** `.settings-scroll .reorder-table { … }` or the three
  `.settings-scroll .reorder-table tr[…] > td.row-actions` rules (or their comment paragraphs).
- **Replace their two tests** (the "separate border model" and the "sticky Actions cell" tests) with
  two pins that read `path.resolve(__dirname, '../reorder/reorder.css')`:
  - `table.reorder-table` has `border-collapse: separate;` and `border-spacing: 0;`;
  - `.reorder-table tr[data-reorder='lifted'] > td.row-actions` has `background: var(--surface-2);`
    with `-1px 0 0 var(--border)`, and both `.reorder-table tr[data-reorder-drop='before'|'after'] >
    td.row-actions` blocks exist.

  The test count stays at 6. Step 2's expected failures drop to the two Settings rules, and the two
  reorder.css pins pass at once as a dependency guard.
- **Keep** the group-heading rule and the component-indent rules. In the grip-cell override for
  component rows, keep R0's narrow right edge: `padding: var(--density-cell-pad); padding-right: 0;`,
  and pin both declarations.
- The Notes for the controller items 1–3 are resolved by A1.
- R0 notes that `settingsCss.test.ts`'s `declarationsFor` misses a second block that immediately
  follows a first one for the same selector. Every Settings rule here is a single block, so this is
  harmless — just don't split one.

---

## Mechanics (read once)

- **Worktree:** `C:/Users/edyli/personal-finance-dashboard/.worktrees/reorder-r2`, branch
  `feat/reorder-settings`. It is cut from `feat/reorder-base` **after lanes R1 and R0 are merged into
  it** (spec §11 merge order: R1 → R0 → R2), so `src/components/reorder/**` and the two `src/api`
  functions exist. Work ONLY inside it. The controller creates it (see "Controller prerequisites").
- **Another Claude job** is working in `.worktrees/{perf-first-four,backend-quick-fixes,
  frontend-quick-fixes,charts-spending-overview,charts-tax-portfolio}` and merging into main. Never
  touch main, the main checkout, those worktrees or any other `.worktrees/reorder-*`.
- **Tests:**
  - Per task: `npx vitest run src/components/settings/<file>` from the worktree root.
  - Never pipe a gate through `tail`/`head`: read the exit code.
  - vitest globals are off (`vite.config.ts`), so RTL cannot register its own cleanup. Both card
    test files already call `cleanup()` in `afterEach`; keep it.
  - jsdom has no layout. A keyboard lift measures every row at y=0, so an arrow key asks the page
    to scroll the row clear of the top edge zone, and jsdom does not implement `window.scrollBy`.
    Both card test files stub it in `beforeEach` (Tasks 3 and 5).
- **Types and lint:**
  - Before every commit: `npx tsc -b` and `npx eslint <the files the task touched>`.
  - `eslint-plugin-react-hooks` 7.1.1 runs the React-Compiler rules:
    - no `ref.current` read during render;
    - no `setState` in an effect body;
    - no reassignment of outer variables during render.
  - All code below was type-checked with this repo's compiler options and linted with this repo's
    ESLint config against lane R0's published code and lane R1's published signatures. The
    forward reference from a save function to the `reorder` value declared after it (the
    `markSaved` call in a promise callback) passes those rules — R3 probed the same shape.
  - If a rule still fires, fix the code. Never add an `eslint-disable`.
- **End of lane:** full `npx vitest run`, `npx tsc -b`, `npx eslint .`, `npm run build` (Task 8).
- **Commits:** small and conventional (`feat(settings): …`, `fix(guide): …`, `docs(plan): …`).
  Never push. Never delete files, branches or databases.
- **Scope fence:**
  - Only these files change:
    - `src/components/settings/AccountsCard.tsx`, `src/components/settings/CategoriesCard.tsx`;
    - their two test files;
    - `src/components/settings/settings.css` (additive);
    - `src/components/settings/settingsCss.test.ts` (additive);
    - this plan's Results section.
  - **One fence extension, required:** `src/guide/content/pages-planning.tsx`, the two step strings
    at lines 277 and 314 (Task 2).
    - The Guide's label fence (`src/guide/guideContent.test.ts`) fails the full suite once "Sort
      order" is gone from the UI source.
    - The spec assigns no Guide copy; lane R4 flagged exactly this ("R2 needs a Guide edit the
      spec does not assign"). R4's own Guide step was approved on the same terms.
  - No `src/api`, `src/types`, `src/components/reorder`, `panels.css` or `SettingsPage.tsx` edits:
    the cards import R1's functions and R0's component and add no code of their own there (spec
    §4.3, §11).
- **Browser check (Task 9):**
  - The lane runs its own pair of servers against its PRIVATE database `finance_reorder_r2`:
    uvicorn on 8092, vite on 5192.
  - It never writes to `finance_realdata` (shared, read-only) or `finance`, and never uses
    8000/5173.
  - `$PY` = `C:/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe`.

### Controller prerequisites (before the implementer starts)

1. Merge R1, then R0, into `feat/reorder-base` (spec §11).
2. Create the worktree and link `node_modules`:
   ```bash
   git -C /c/Users/edyli/personal-finance-dashboard worktree add .worktrees/reorder-r2 -b feat/reorder-settings feat/reorder-base
   ln -s /c/Users/edyli/personal-finance-dashboard/node_modules /c/Users/edyli/personal-finance-dashboard/.worktrees/reorder-r2/node_modules
   ```
3. The private database.
   - `finance_reorder_r2` **already exists**: made 2026-09-23 from `finance_realdata`. A read-only
     census at planning time found 29 accounts, 19 categories, user `admin@example.com`, alembic
     `f12026091203`.
   - Only if it is missing, create it with `pg_dump | psql` (never `CREATE DATABASE … TEMPLATE`,
     which fails while other sessions hold `finance_realdata`):
     ```bash
     docker exec finance-dashboard-db-1 createdb -U finance finance_reorder_r2
     docker exec finance-dashboard-db-1 sh -c 'pg_dump -U finance finance_realdata | psql -q -v ON_ERROR_STOP=1 -U finance -d finance_reorder_r2'
     ```
4. Migrate it to R1's head from the lane's backend dir. Expected output of the second command:
   `f12026092301 (head)`.
   ```bash
   cd /c/Users/edyli/personal-finance-dashboard/.worktrees/reorder-r2/backend
   DATABASE_URL=postgresql+asyncpg://finance:finance@localhost:5433/finance_reorder_r2 /c/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe -m alembic upgrade head
   DATABASE_URL=postgresql+asyncpg://finance:finance@localhost:5433/finance_reorder_r2 /c/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe -m alembic current
   ```

---

## Contracts consumed

### From lane R0 — `docs/superpowers/plans/2026-09-23-reorder-r0-component.md`, "Contracts this lane publishes" (verbatim)

```ts
// src/components/reorder/reorderMath.ts
export type ReorderKey = string | number
export interface ReorderItem<K extends ReorderKey> { id: K; range?: string; carries?: readonly K[] }
export const REORDER_INSTRUCTIONS: string   // spec §8.2 instructions sentence

// src/components/reorder/useReorder.ts
export function useReorder<K extends ReorderKey>(options: {
  items: readonly ReorderItem<K>[]          // DISPLAY order; carried rows right after their carrier
  labelOf: (id: K) => string                // "Housing" — the row's name, for the live region
  rangeLabelOf?: (range: string) => string | undefined   // "Cash" → "…Position 1 of 3 in Cash."
  disabled?: boolean                        // true while ANY request of the list is in flight
  onCommit: (next: K[], moved: K) => void   // once per drop; `next` = the new flat display order
}): {
  itemProps: (id: K) => { ref: RefCallback<HTMLElement>; 'data-reorder-id': string }
  handleProps: (id: K) => ReorderHandleProps   // spread onto <DragHandle>
  markSaved: (id: K) => void                   // after the save succeeds: 700 ms saved flash
  instructionsId: string                       // pass to <ReorderInstructions id=…>
  announcement: string                         // pass to <ReorderLiveRegion text=…>
  liftedId: K | null
  active: boolean                              // a unit is lifted — disable the row's buttons
}

// src/components/reorder/DragHandle.tsx (default export)
<DragHandle name="Housing" {...reorder.handleProps(id)} />   // <button class="reorder-grip"
                                                            //  aria-label="Reorder Housing">
// src/components/reorder/ReorderStatus.tsx
<ReorderInstructions id={reorder.instructionsId} />   // visually hidden, spec §8.2 sentence
<ReorderLiveRegion text={reorder.announcement} />     // visually hidden, aria-live="assertive"

// src/components/reorder/reorder.css  (imported by DragHandle.tsx — consumers need no import)
.reorder-table       // put on the <table>: border-collapse: separate; border-spacing: 0
.reorder-grip-cell   // put on the grip's <td> and its header <th aria-hidden="true">
```

R0's consumer rules, as this lane applies them:
1. Every item is rendered exactly once, `{...reorder.itemProps(id)}` on its `<tr>`, in `items` order.
2. No `style.transform`/`style.transition` on those rows, and no `.is-dragging`.
3. `onCommit` sets the optimistic order synchronously (it runs inside `flushSync`), then starts the
   save. Success calls `reorder.markSaved(moved)`; failure restores the last server order.
4. `disabled: busy`. While busy, the grips are `aria-disabled="true"`: still focusable, but inert.
5. The row's own buttons are disabled while `reorder.active`.
6. The two helpers render outside the `<table>`.

Behaviour of the hook the tests below lean on (R0 Task 5 code):
- A keyboard drop commits at once. A pointer drop eases into its gap for `--t-fast` first, then
  commits (spec §2.3 as amended).
- `handleProps(id).disabled` is `true` when the item's range holds one item (the only account in its
  group, a lone component, a one-row list).
- `markSaved(id)` flashes every row of the unit.
- Escape is caught on `window` in the capture phase.
- Announcements: `Picked up {name}. Position {i} of {n}{ in {range}}.` /
  `{name}, position {i} of {n}.` / `Dropped {name} at position {i} of {n}.` /
  `Cancelled. {name} is back at position {i} of {n}.`

### From lane R1 — `docs/superpowers/plans/2026-09-23-reorder-r1-backend.md`, "Contracts this lane publishes" (verbatim, the parts this lane uses)

```ts
// src/api/netWorth.ts
export async function reorderAccounts(ids: number[]): Promise<{ data: AccountOut[]; batchId: string | null }>
// src/api/spending.ts
export async function reorderCategories(ids: number[]): Promise<{ data: CategoryOut[]; batchId: string | null }>
```

- Both send `PUT` with body `{ ids }` — the list's COMPLETE new order, every row active or retired.
- `batchId` is `headers.get('x-change-batch')`; it is `null` when nothing was logged.
- Failures surface as `ApiError` with the server's sentence as `message` and the status as
  `status`. A 409 means "reload the list".
- A repeated id → 422 `ids lists {id} more than once`.
- A set mismatch → 409:
  - `The accounts changed since this list was loaded — nothing was moved.`
  - `The spending categories changed since this list was loaded — nothing was moved.`
- An unchanged order → 200 with the list as stored, and no batch.
- Activity labels: `Moved account {name}` (one account, or a parent with exactly the components it
  carries — same parent AND same group), `Reordered {n} accounts`, `Moved category {name}`,
  `Reordered {n} categories`.
- Undo is the existing `POST /activity/batches/{id}/undo`. It refuses with 409
  `Later changes touched these rows — undo those first` once a later logged write touched a moved
  row.
- Create without `sort_order` appends: `coalesce(max, −1) + 1`.
- `PATCH /net-worth/accounts/{id}` that changes `group` with no `sort_order` appends, in the same
  batch.
- R1's Decision 2 matches this lane's nesting: the components a parent carries are the rows the
  Settings table nests under it — the same parent and the same group.

### Existing app contracts

- `undoBatch(batchId)` — `src/api/lifecycle.ts:59`.
- `ApiError`, `errorDetail`, `describeError` — `src/api/client.ts:45-74`.
- `useToast()` — `src/components/ToastProvider.tsx:56`:
  - `success | info | error (message, { action: { label, onAction } })`;
  - the error toasts sit in the `role="alert"` region, every message in `span.toast-message`;
  - without a provider the calls are no-ops.
- `nestComponents` — `src/utils/accounts.ts:9`. It nests one level, by `parent_account_id` alone. A
  row whose parent is absent keeps its place; a row whose parent is itself nested is left out.
- `GROUP_ORDER`, `GROUP_LABELS` — `src/charts/theme.ts:25-37`.
- `nestComponents` per section is the Monthly update's walk (`MonthlyUpdatePage.tsx:1124-1152`).

---

## Decisions this plan takes where the spec is silent

1. **Edits never name a position either.** Categories' Save sends `{ name }`. Accounts' Save sends
   the five keys `name, group, is_component, person_id, parent_account_id`, without `sort_order`.
   - A stored `sort_order` sent back could undo a drag made since the form was filled.
   - Leaving it out is what lets a group change append server-side (spec §3.3, R1's append table).
2. **The optimistic order is a rows array.** `pendingOrder` is retired by the adjust-during-render
   idiom whenever the server list's identity changes. ANY failure clears it and reloads: a 409
   because the list changed elsewhere, a 5xx because it may have arrived after the write
   committed. (Amended at the code-quality review, I1: "a failure clears it; a 409 clears it and
   reloads" left the table on a guess after a 5xx.)
3. **A write holds the grips until its reload lands.** (Rewritten at the code-quality review, I1.)
   - `load` returns its promise, and every write returns the reload it starts: submit, Retire /
     Restore, the kind picker, Delete, Undo, and a failed save. So `busy` covers the reload too,
     and no drop can diff against rows a write has already moved past.
   - The planned version bumped the load sequence at each save so that a reload still on the wire
     was dropped. That bump did discard the reload, but it could not stop the drop that follows.
     After an Undo, a quick drop PUT the pre-Undo order and silently re-applied the undone move.
   - A list that failed to reload also parks the grips (`disabled: busy || loadError !== null`).
   - `busy` is a request COUNT (review I2): `track()` wraps every write, the toast's Undo
     included. An Undo from an older toast can overlap a save, and a flag handed the grips back
     when the first of the two settled.
   - The save takes a turn in load's sequence, so an older answer never lands last: the save's
     rows are drawn only if nothing was asked for after it. An overtaken save reads the list once
     more instead, because the later reload may have read before this save committed.
   - Pinned per card: the grips stay parked until a write's reload lands; an Undo window test; a
     failed-reload test; an older toast's Undo overlapping a later save.
4. **Undo parks the grips until its reload lands.** "Order restored" is said as soon as the undo
   succeeds; the reload follows, and the grips come back once it has landed.
5. **A save that logged nothing** (`batchId === null`) toasts "Moved {name}" with no Undo — the
   house contract (BudgetPanel's seed).
6. **An Undo that got no answer** (network, 5xx) says `Couldn't undo the move — {reason}.`
   - The spec gives only the refused-undo case.
   - A 4xx refusal shows the server's sentence verbatim, as §4.1 requires.
   - The fallback follows the house's "noun + reason" copy rule.
7. **The save-failure `{reason}`** (§8.1) is `errorDetail(err)`, with any closing stop folded away
   so the sentence never reads "..". This is `describeLoadFailures`' rule.
8. **"Row buttons are disabled mid-drag"** (§2.3.3) covers every control on a row of the two tables:
   - Edit, Retire/Restore and Delete;
   - the categories' kind picker.

   The Portfolio accounts owner selects belong to a different table and stay live.
9. **Only a nested row is indented.**
   - `component-row` (the indent) goes on a row drawn under a parent in its own group.
   - A top-level component — its parent in another group, or none — has nothing above it to be
     indented under. Its `Component` badge still names it.
10. **Rows `nestComponents` cannot place stay listed.** These are a component of a component, or a
    parent loop.
    - They render top-level at the end of their group.
    - Each gets a range of its own (`unplaced:<id>`), so its grip is disabled.
    - They ride in every PUT.
    - Without this they would vanish from the one place their link can be fixed, and every PUT
      would 409 for want of their ids.
    - The real book has none: all 5 components' parents are top-level.
11. **The group heading is `<th scope="rowgroup" colSpan={6}>`, the first row of its group's own
    `<tbody>`.** (Amended at the code-quality review, M1.)
    - §4.2's `scope="colgroup"` without a `<colgroup>` is invalid HTML, and screen readers expose
      it as a column header over every column. The coordinator corrects the spec on base.
    - The hook moves rows only within a group, so a drag never crosses a `<tbody>`.
    - It is drawn in the Monthly update's `.entry-group-row` register.
    - It is taken out of panels.css's sticky `th:last-child` rule (0,3,2), which a row-actions
      table applies to every last header cell of every row. The override is keyed on the row's
      class, `tbody > tr.accounts-group-row > th` (0,3,3), not on the scope attribute.
12. **The instructions and the live region** render once per card, right after the table's
    scroller, and only when the table renders.
13. **The order note sits directly under the table.** For categories it is above the kind
    definitions; for accounts, above the Portfolio accounts heading.
14. **Settings-scoped CSS for two collisions with panels.css.** Lane R3 found the same two on
    `.port-table`.
    - `.data-table` ties `.reorder-table` on `border-collapse`.
    - `.data-table td.row-actions` (0,2,1) outranks reorder.css's lifted and drop-line rules
      (0,1,2).
15. **The Guide's two stale steps are rewritten** (the fence extension above).
16. **The two ghost heights are re-measured** at 1440 (the width the 2026-09-13 figures were taken
    at) on the lane's copy of the real book.
    - They are updated only if off by more than 2 px (Task 10).
    - The page skeleton in `SettingsPage.tsx` derives from them and is outside this fence: its new
      numbers go to the controller.
17. **Private database** `finance_reorder_r2` (the controller's per-lane copy) rather than spec
    §10's shared `finance_reorder_scratch`. This walk writes. It puts both orders back before it
    exits.
18. **`rangeLabelOf` answers `undefined` for an `unplaced:` range**, so the announcement has no
    range clause. It answers the group label for a group and `{parent}'s components` for a
    `parent:` range (§8.2).

---

## File map

| File | Change |
|---|---|
| `src/components/settings/CategoriesCard.tsx` | Form keeps only the name. The table gains a grip column, `.reorder-table` and the hook. Adds the optimistic order, one PUT, the saved flash, the toast + Undo, failure/409, row buttons locked mid-lift, the order note and the InfoHint sentence. |
| `src/components/settings/CategoriesCard.test.tsx` | 2 tests changed, 14 added (13 → 27) |
| `src/components/settings/AccountsCard.tsx` | Form loses Sort order. The roster is grouped: headings, per-group nesting, grip column, name cell, hook with ranges and carries. Save/Undo/failure/409, row buttons locked mid-lift, the order note and the InfoHint sentence. |
| `src/components/settings/AccountsCard.test.tsx` | 4 tests changed, 20 added (22 → 42) |
| `src/components/settings/settings.css` | additive: the border-model pin, the group heading, the component indent on the name cell, the Actions cell of a lifted or drop-marked row |
| `src/components/settings/settingsCss.test.ts` | additive: 4 pins (2 → 6) |
| `src/guide/content/pages-planning.tsx` | fence extension: the step strings at lines 277 and 314 |
| `scratchpad/reorder-r2/smoke.mjs` (gitignored, never committed) | the browser check |
| this plan | Results |

### Existing assertions this lane changes

Every assertion that named the Sort order box, the Sort column, the Group column or a `sort_order`
in a request body:

| File:line (today) | Test | Was | Becomes | Task |
|---|---|---|---|---|
| `CategoriesCard.test.tsx:70-81` | `creates a category` | types `9` into **Sort order** (:75); body `{ name: 'Wedding', sort_order: 9 }` (:79) | no Sort order box; body `toStrictEqual({ name: 'Wedding' })`; test renamed | 1 |
| `CategoriesCard.test.tsx:92-94` | `renames through the inline editor` | `toHaveBeenCalledWith(5, { name: 'Food', sort_order: 1 })` | `mock.calls[0]` `toStrictEqual([5, { name: 'Food' }])` | 1 |
| `AccountsCard.test.tsx:168, :174-181` | `creates an account with owner, parent and the component flag` | types `12` into **Sort order**; body carries `sort_order: 12` | no Sort order box; body `toStrictEqual` without it | 2 |
| `AccountsCard.test.tsx:197-202` | `retags an account to joint with an EXPLICIT null` | body keys unchecked beyond `person_id` | also `not.toContain('sort_order')` | 2 |
| `AccountsCard.test.tsx:158` | `renders the roster with owner names, joint spelled out` | `getByText('Pre-tax')` — the **Group** column cell | the same text is the group heading row: `closest('tr').className === 'accounts-group-row'` | 5 |
| `AccountsCard.test.tsx:356-370` | `flags a component whose parent is missing or retired` | — | gains the nesting assertions (retired parent's component nested; parentless one top-level) | 5 |
| `AccountsCard.test.tsx:497` | `renders once, after BOTH feeds settle` | ghost `'1045'` | unchanged unless Task 10 re-measures | 10 |

Neither test file ever asserted the Sort column's cells. Outside the fence:
- `src/pages/SettingsPage.test.tsx:883` has a stale COMMENT ("Both management tables carry a 'Sort
  order' box"). It is only a comment, so it is left alone and reported to the controller.
- `src/guide/content/pages-planning.tsx:277, :314` are rewritten in Task 2.

---

### Task 0: preflight (no commit)

- [ ] **Step 1: The base carries R0 and R1**

Run (Git Bash, from the worktree root):

```bash
git branch --show-current
git log --oneline -12
ls src/components/reorder
grep -n "export async function reorderAccounts" src/api/netWorth.ts
grep -n "export async function reorderCategories" src/api/spending.ts
```

Expected:
- the branch prints `feat/reorder-settings`;
- the log shows the R1 and R0 merges above the spec and plan commits;
- the folder lists `DragHandle.tsx`, `ReorderStatus.tsx`, `reorder.css`, `reorderDom.ts`,
  `reorderMath.ts`, `reorderTypes.ts`, `useReorder.ts` (and their tests);
- each `grep` prints one line.

If anything is missing, or either function's return type is not
`Promise<{ data: …[]; batchId: string | null }>`, STOP and report to the controller. This plan
builds on those contracts verbatim.

- [ ] **Step 2: Baseline**

Run: `npx vitest run src/components/settings src/pages/SettingsPage.test.tsx src/guide src/components/reorder`
Expected: PASS. `CategoriesCard.test.tsx` has 13 tests, `AccountsCard.test.tsx` 22,
`settingsCss.test.ts` 2. Record the totals in Results.

---

### Task 1: Categories — the form keeps only the name (spec §4.1, §3.3)

**Files:**
- Modify: `src/components/settings/CategoriesCard.tsx:20-25` (form state), `:93` (body), `:168-176`
  (the Sort order box), `:200` (Edit fills the form)
- Test: `src/components/settings/CategoriesCard.test.tsx:70-95`

- [ ] **Step 1: Write the failing tests**

In `CategoriesCard.test.tsx`, replace the whole `creates a category` test (lines 70-81):

```tsx
it('creates a category', async () => {
  render(<CategoriesCard />)
  await screen.findByRole('table')

  fireEvent.change(screen.getByLabelText('Category name'), { target: { value: '  Wedding  ' } })
  fireEvent.change(screen.getByLabelText('Sort order'), { target: { value: '9' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add category' }))

  await waitFor(() => expect(vi.mocked(createCategory)).toHaveBeenCalledTimes(1))
  expect(vi.mocked(createCategory).mock.calls[0][0]).toEqual({ name: 'Wedding', sort_order: 9 })
  await waitFor(() => expect(vi.mocked(fetchCategories)).toHaveBeenCalledTimes(2))
})
```

with these two tests:

```tsx
it('creates a category from its name alone — it lands at the end of the list (reorder spec §3.3)', async () => {
  render(<CategoriesCard />)
  await screen.findByRole('table')

  fireEvent.change(screen.getByLabelText('Category name'), { target: { value: '  Wedding  ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add category' }))

  await waitFor(() => expect(vi.mocked(createCategory)).toHaveBeenCalledTimes(1))
  // No sort_order key at all: the server appends a create that names no position.
  expect(vi.mocked(createCategory).mock.calls[0][0]).toStrictEqual({ name: 'Wedding' })
  await waitFor(() => expect(vi.mocked(fetchCategories)).toHaveBeenCalledTimes(2))
})

it('offers no Sort order box: the order is the table’s (reorder spec §4.1)', async () => {
  render(<CategoriesCard />)
  await screen.findByRole('table')

  expect(screen.queryByLabelText('Sort order')).toBeNull()
})
```

Then, in `renames through the inline editor`, replace its last assertion (lines 92-94):

```tsx
  await waitFor(() =>
    expect(vi.mocked(updateCategory)).toHaveBeenCalledWith(5, { name: 'Food', sort_order: 1 }),
  )
```

with:

```tsx
  await waitFor(() => expect(vi.mocked(updateCategory)).toHaveBeenCalledTimes(1))
  // The name alone: sending the stored position back would undo a drag made since this render.
  expect(vi.mocked(updateCategory).mock.calls[0]).toStrictEqual([5, { name: 'Food' }])
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/components/settings/CategoriesCard.test.tsx`
Expected: FAIL — 3 failed, 11 passed:
- `creates a category from its name alone…`: `toStrictEqual` receives
  `{ name: 'Wedding', sort_order: 0 }`;
- `offers no Sort order box…`: `queryByLabelText('Sort order')` finds the input;
- `renames through the inline editor`: receives `[5, { name: 'Food', sort_order: 1 }]`.

- [ ] **Step 3: Implement**

In `src/components/settings/CategoriesCard.tsx`:

(a) lines 20-25 — replace

```tsx
interface CategoryFormState {
  name: string
  sort_order: string
}

const EMPTY_CATEGORY: CategoryFormState = { name: '', sort_order: '0' }
```

with

```tsx
interface CategoryFormState {
  name: string
}

const EMPTY_CATEGORY: CategoryFormState = { name: '' }
```

(b) line 93 — replace

```tsx
    const body = { name, sort_order: Number(form.sort_order) || 0 }
```

with

```tsx
    // The name alone: the position is the table's now — a new category lands at the end and
    // is dragged into place (2026-09-23 reorder spec §3.3, §4.1).
    const body = { name }
```

(c) lines 168-177 — replace

```tsx
            <label>
              Sort order
              <input
                className="field-input"
                inputMode="numeric"
                value={form.sort_order}
                onChange={(e) => setText('sort_order')(e.target.value)}
              />
            </label>
            <div className="settings-card-actions">
```

with

```tsx
            <div className="settings-card-actions">
```

(d) line 200 — replace

```tsx
                  setForm({ name: category.name, sort_order: String(category.sort_order) })
```

with

```tsx
                  setForm({ name: category.name })
```

The form keeps its two-column `.category-form` grid (settings.css:160-165). With the box gone,
**Add category** sits beside the name box on one row. No CSS change is needed.

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run src/components/settings/CategoriesCard.test.tsx`
Expected: PASS — 14 tests.

- [ ] **Step 5: Type-check, lint, commit**

```bash
npx tsc -b && npx eslint src/components/settings/CategoriesCard.tsx src/components/settings/CategoriesCard.test.tsx
git add src/components/settings/CategoriesCard.tsx src/components/settings/CategoriesCard.test.tsx
git commit -m "feat(settings): the categories form keeps only the name — a new category lands at the end"
```

---

### Task 2: Accounts — the form loses Sort order; the Guide stops naming it (spec §4.2, §3.3)

**Files:**
- Modify: `src/components/settings/AccountsCard.tsx:20-36` (form state), `:136-154` (setText,
  startEdit), `:175-185` (body), `:339-347` (the Sort order box)
- Modify (fence extension): `src/guide/content/pages-planning.tsx:277`, `:314`
- Test: `src/components/settings/AccountsCard.test.tsx:161-203`

- [ ] **Step 1: Write the failing tests**

In `AccountsCard.test.tsx`, replace the whole `creates an account with owner, parent and the
component flag` test (lines 161-183):

```tsx
it('creates an account with owner, parent and the component flag', async () => {
  render(<AccountsCard people={[ME, PARTNER]} />)
  await screen.findByRole('table', { name: 'Net-worth accounts' })

  fireEvent.change(screen.getByLabelText('Account name'), { target: { value: 'Partner 401(k)' } })
  fireEvent.change(screen.getByLabelText('Group'), { target: { value: 'pre_tax' } })
  fireEvent.change(screen.getByLabelText('Owner'), { target: { value: '2' } })
  fireEvent.change(screen.getByLabelText('Sort order'), { target: { value: '12' } })
  fireEvent.change(screen.getByLabelText('Parent account'), { target: { value: '11' } })
  fireEvent.click(screen.getByLabelText('Component of the parent'))
  fireEvent.click(screen.getByRole('button', { name: 'Add account' }))

  await waitFor(() => expect(vi.mocked(createAccount)).toHaveBeenCalledTimes(1))
  expect(vi.mocked(createAccount).mock.calls[0][0]).toEqual({
    name: 'Partner 401(k)',
    group: 'pre_tax',
    sort_order: 12,
    is_component: true,
    person_id: 2,
    parent_account_id: 11,
  })
  await waitFor(() => expect(vi.mocked(fetchAccounts)).toHaveBeenCalledTimes(2))
})
```

with these three tests:

```tsx
it('creates an account with owner, parent and the component flag', async () => {
  render(<AccountsCard people={[ME, PARTNER]} />)
  await screen.findByRole('table', { name: 'Net-worth accounts' })

  fireEvent.change(screen.getByLabelText('Account name'), { target: { value: 'Partner 401(k)' } })
  fireEvent.change(screen.getByLabelText('Group'), { target: { value: 'pre_tax' } })
  fireEvent.change(screen.getByLabelText('Owner'), { target: { value: '2' } })
  fireEvent.change(screen.getByLabelText('Parent account'), { target: { value: '11' } })
  fireEvent.click(screen.getByLabelText('Component of the parent'))
  fireEvent.click(screen.getByRole('button', { name: 'Add account' }))

  await waitFor(() => expect(vi.mocked(createAccount)).toHaveBeenCalledTimes(1))
  // No sort_order key at all: a create that names no position lands at the end of its group
  // (2026-09-23 reorder spec §3.3).
  expect(vi.mocked(createAccount).mock.calls[0][0]).toStrictEqual({
    name: 'Partner 401(k)',
    group: 'pre_tax',
    is_component: true,
    person_id: 2,
    parent_account_id: 11,
  })
  await waitFor(() => expect(vi.mocked(fetchAccounts)).toHaveBeenCalledTimes(2))
})

it('offers no Sort order box: the order is the table’s (reorder spec §4.2)', async () => {
  render(<AccountsCard people={[ME]} />)
  await screen.findByRole('table', { name: 'Net-worth accounts' })

  expect(screen.queryByLabelText('Sort order')).toBeNull()
})

it('moves an account to another group through Edit without naming a position — the server appends it there (reorder spec §3.3)', async () => {
  render(<AccountsCard people={[ME]} />)
  await screen.findByRole('table', { name: 'Net-worth accounts' })

  fireEvent.click(screen.getByRole('button', { name: 'Edit Fidelity HSA' }))
  fireEvent.change(screen.getByLabelText('Group'), { target: { value: 'post_tax' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save account' }))

  await waitFor(() => expect(vi.mocked(updateAccount)).toHaveBeenCalledTimes(1))
  expect(vi.mocked(updateAccount).mock.calls[0]).toStrictEqual([
    11,
    {
      name: 'Fidelity HSA',
      group: 'post_tax',
      is_component: false,
      person_id: 1,
      parent_account_id: null,
    },
  ])
})
```

Then, at the end of `retags an account to joint with an EXPLICIT null`, replace (lines 199-203)

```tsx
  // The key must SURVIVE: an omitted person_id means "leave the owner alone" server-side,
  // so clearing the select has to send null on purpose.
  expect(Object.keys(body)).toContain('person_id')
  expect(body.person_id).toBeNull()
})
```

with

```tsx
  // The key must SURVIVE: an omitted person_id means "leave the owner alone" server-side,
  // so clearing the select has to send null on purpose.
  expect(Object.keys(body)).toContain('person_id')
  expect(body.person_id).toBeNull()
  // …and the position must NOT ride along: the stored value may predate a drag.
  expect(Object.keys(body)).not.toContain('sort_order')
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/components/settings/AccountsCard.test.tsx`
Expected: FAIL — 4 failed, 20 passed:
- `creates an account…`: the body carries `sort_order: 0`;
- `offers no Sort order box…`: finds the input;
- `moves an account to another group…`: the body carries `sort_order: 2`;
- `retags an account…`: the keys contain `sort_order`.

- [ ] **Step 3: Implement**

In `src/components/settings/AccountsCard.tsx`:

(a) lines 20-36 — replace

```tsx
interface AccountFormState {
  name: string
  group: AccountGroup
  person_id: string
  sort_order: string
  parent_account_id: string
  is_component: boolean
}

const EMPTY_ACCOUNT: AccountFormState = {
  name: '',
  group: 'cash',
  person_id: '',
  sort_order: '0',
  parent_account_id: '',
  is_component: false,
}
```

with

```tsx
interface AccountFormState {
  name: string
  group: AccountGroup
  person_id: string
  parent_account_id: string
  is_component: boolean
}

const EMPTY_ACCOUNT: AccountFormState = {
  name: '',
  group: 'cash',
  person_id: '',
  parent_account_id: '',
  is_component: false,
}
```

(b) lines 136-150 — replace

```tsx
  const setText =
    (field: 'name' | 'person_id' | 'sort_order' | 'parent_account_id') => (value: string) => {
      setForm((f) => ({ ...f, [field]: value }))
      setFormError(null)
    }

  const startEdit = (account: AccountOut) => {
    setEditingId(account.id)
    setFormError(null)
    setForm({
      name: account.name,
      group: account.group,
      person_id: account.person_id === null ? '' : String(account.person_id),
      sort_order: String(account.sort_order),
      parent_account_id:
```

with

```tsx
  const setText =
    (field: 'name' | 'person_id' | 'parent_account_id') => (value: string) => {
      setForm((f) => ({ ...f, [field]: value }))
      setFormError(null)
    }

  const startEdit = (account: AccountOut) => {
    setEditingId(account.id)
    setFormError(null)
    setForm({
      name: account.name,
      group: account.group,
      person_id: account.person_id === null ? '' : String(account.person_id),
      parent_account_id:
```

(c) lines 175-182 — replace

```tsx
    // ALL SIX keys, every time: a blank owner or parent must CLEAR the column, and PATCH
    // treats an omitted key as "leave it alone" — only an explicit null retags an account
    // to joint or unlinks a component.
    const body = {
      name,
      group: form.group,
      sort_order: Number(form.sort_order) || 0,
      is_component: form.is_component,
```

with

```tsx
    // ALL FIVE keys, every time: a blank owner or parent must CLEAR the column, and PATCH
    // treats an omitted key as "leave it alone" — only an explicit null retags an account
    // to joint or unlinks a component. Never sort_order (2026-09-23 reorder spec §3.3, §4.2):
    // the order is the table's, a new account lands at the end of its group, and an edit that
    // moves an account to another group lands it at the end of that one — the server's call.
    const body = {
      name,
      group: form.group,
      is_component: form.is_component,
```

(d) lines 339-349 — replace

```tsx
            <label>
              Sort order
              <input
                className="field-input"
                inputMode="numeric"
                value={form.sort_order}
                onChange={(e) => setText('sort_order')(e.target.value)}
              />
            </label>
            <label>
              Parent account
```

with

```tsx
            <label>
              Parent account
```

The `.accounts-form` grid (settings.css:153-158, three columns) now holds Account name · Group ·
Owner, then Parent account · the component checkbox · the actions. That is one row fewer, with no
CSS change.

- [ ] **Step 4: Run the card's tests to see them pass**

Run: `npx vitest run src/components/settings/AccountsCard.test.tsx`
Expected: PASS — 24 tests.

- [ ] **Step 5: Run the Guide's fences — they fail now**

"Sort order" no longer exists anywhere in the UI source, and the Guide still bolds it twice.

Run: `npx vitest run src/guide/guideContent.test.ts`
Expected: FAIL — `every **Label** in a step or a watch line is text that exists somewhere in the UI`:
`expected [ 'accounts-add: Sort order', 'categories-add: Sort order' ] to deeply equal []`.

- [ ] **Step 6: Rewrite the two steps (fence extension)**

In `src/guide/content/pages-planning.tsx`, line 277 (task `accounts-add`) — replace

```ts
          'Pick the **Owner**, set the **Sort order**, and press **Add account**.',
```

with

```ts
          'Pick the **Owner** and press **Add account** — it lands at the end of its group; drag its grip to move it.',
```

and line 314 (task `categories-add`) — replace

```ts
          'Type the **Category name** and a **Sort order**, then press **Add category**.',
```

with

```ts
          'Type the **Category name** and press **Add category** — it lands at the end of the list; drag its grip to move it.',
```

Both are under the Guide's 160-character step limit (106 and 114). Every bolded label is literal
text in the UI source: `Owner`, `Add account`, `Category name`, `Add category`.

- [ ] **Step 7: Run the Guide's fences and pages to see them pass**

Run: `npx vitest run src/guide src/pages/GuidePage.test.tsx src/components/paletteRegistry.guide.test.ts src/components/settings/AccountsCard.test.tsx src/components/settings/CategoriesCard.test.tsx`
Expected: PASS.

- [ ] **Step 8: Type-check, lint, commit**

```bash
npx tsc -b && npx eslint src/components/settings/AccountsCard.tsx src/components/settings/AccountsCard.test.tsx src/guide/content/pages-planning.tsx
git add src/components/settings/AccountsCard.tsx src/components/settings/AccountsCard.test.tsx src/guide/content/pages-planning.tsx
git commit -m "feat(settings): the accounts form drops Sort order — creates and edits never name a position; the Guide stops naming the box"
```

---

### Task 3: Categories — the reorderable table (spec §4.1, §8.1, §8.3, §9)

**Files:**
- Modify: `src/components/settings/CategoriesCard.tsx` — whole file (nearly every part changes;
  the full file is given)
- Test: `src/components/settings/CategoriesCard.test.tsx` — the header (lines 1-20), the setup
  (lines 44-59), 11 tests appended

What the tests pin:
- the columns (grip · Category · Kind · Status · actions) on a `.reorder-table`;
- a disabled grip on a one-row list, and no grips on an empty one;
- a keyboard drop draws the new order at once and sends ONE PUT with every id (a retired row moves
  like any other);
- the grips are parked while the save is in flight, and the rows are replaced from the response;
- the saved flash and the "Moved {name}" toast with Undo, and no Undo when nothing was logged;
- Undo → `undoBatch` → reload → "Order restored", and a refused Undo shows the server's sentence;
- a failure snaps back with the §8.1 sentence; a 409 shows the server's sentence and reloads;
- a reload already in flight cannot put the old order back;
- the grips are parked during another request of the card.

- [ ] **Step 1: The test file's header — imports and mocks**

In `CategoriesCard.test.tsx`, replace lines 1-20:

```tsx
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import type { CategoryOut } from '../../types/api'
import ToastProvider from '../ToastProvider'
import CategoriesCard from './CategoriesCard'

vi.mock('../../api/spending', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/spending')>()),
  fetchCategories: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  deleteCategory: vi.fn(),
}))
import {
  createCategory,
  deleteCategory,
  fetchCategories,
  updateCategory,
} from '../../api/spending'
```

with:

```tsx
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import type { ActivityBatch, CategoryOut } from '../../types/api'
import { REORDER_INSTRUCTIONS } from '../reorder/reorderMath'
import ToastProvider from '../ToastProvider'
import CategoriesCard from './CategoriesCard'

vi.mock('../../api/spending', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/spending')>()),
  fetchCategories: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  deleteCategory: vi.fn(),
  reorderCategories: vi.fn(),
}))
import {
  createCategory,
  deleteCategory,
  fetchCategories,
  reorderCategories,
  updateCategory,
} from '../../api/spending'
vi.mock('../../api/lifecycle', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/lifecycle')>()),
  undoBatch: vi.fn(),
}))
import { undoBatch } from '../../api/lifecycle'
```

- [ ] **Step 2: Fixtures, setup and helpers**

Replace (the end of the `TAXES` fixture through `afterEach`):

```tsx
  sort_order: 3,
  is_active: true,
  kind: 'tax',
}

beforeEach(() => {
  vi.mocked(fetchCategories).mockResolvedValue([GROCERIES, PETS, TAXES])
  vi.mocked(createCategory).mockResolvedValue(GROCERIES)
  vi.mocked(updateCategory).mockResolvedValue(GROCERIES)
  vi.mocked(deleteCategory).mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
```

with:

```tsx
  sort_order: 3,
  is_active: true,
  kind: 'tax',
}
// Added in another tab while this one still showed three rows (the 409 case, spec §9).
const WEDDING: CategoryOut = {
  id: 8,
  name: 'Wedding',
  slug: 'wedding',
  sort_order: 4,
  is_active: true,
  kind: 'living',
}
// The change log's answer to an Undo (POST /activity/batches/{id}/undo).
const UNDONE: ActivityBatch = {
  type: 'batch',
  batch_id: 'undo-1',
  at: '2026-09-23T12:00:00Z',
  source: 'undo',
  actor: 'admin@example.com',
  label: 'Undid: Moved category Pets',
  month: null,
  rows: 3,
  undoable: true,
  undone_by: null,
}
// R1's stale-list sentence for this route (2026-09-23 reorder spec §8.3).
const STALE = 'The spending categories changed since this list was loaded — nothing was moved.'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.mocked(fetchCategories).mockResolvedValue([GROCERIES, PETS, TAXES])
  vi.mocked(createCategory).mockResolvedValue(GROCERIES)
  vi.mocked(updateCategory).mockResolvedValue(GROCERIES)
  vi.mocked(deleteCategory).mockResolvedValue(undefined)
  vi.mocked(reorderCategories).mockResolvedValue({ data: [PETS, GROCERIES, TAXES], batchId: 'batch-7' })
  vi.mocked(undoBatch).mockResolvedValue(UNDONE)
  // jsdom has no layout: a keyboard lift measures every row at y=0 and asks the page to scroll it
  // clear of the top edge zone, and jsdom does not implement window.scrollBy.
  window.scrollBy = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const grip = (name: string) => screen.getByRole('button', { name: `Reorder ${name}` })
/** The keyboard reorder (spec §2.4): each key pressed on the row's grip, in order. */
function press(name: string, ...keys: string[]) {
  for (const key of keys) fireEvent.keyDown(grip(name), { key })
}
/** The table's rows by id, top to bottom — the order on screen. */
const rowIds = () =>
  [...document.querySelectorAll('.category-table tbody tr')].map((row) =>
    row.getAttribute('data-reorder-id'),
  )
const row = (id: number) =>
  document.querySelector(`.category-table tbody tr[data-reorder-id="${id}"]`)
/** The card's reorder live region (the toast layer's alert region is a <div>). */
const live = () => document.querySelector('span[aria-live="assertive"]')?.textContent ?? ''
```

- [ ] **Step 3: Append the tests**

Append at the end of `CategoriesCard.test.tsx`:

```tsx
// --- drag to reorder (2026-09-23 reorder spec §4.1) ---

it('draws a grip column where the Sort column was, on a table whose cells carry their own hairlines', async () => {
  render(<CategoriesCard />)
  const table = await screen.findByRole('table')

  expect(table.classList.contains('reorder-table')).toBe(true)
  const headers = [...table.querySelectorAll('thead th')]
  expect(headers.map((th) => th.textContent)).toEqual(['', 'Category', 'Kind', 'Status', ''])
  expect(headers[0].className).toBe('reorder-grip-cell')
  expect(headers[0].getAttribute('aria-hidden')).toBe('true')
  // One grip per row, in the first cell, named for its row.
  for (const name of ['Groceries', 'Pets', 'Taxes']) {
    expect(grip(name).closest('td')?.className).toBe('reorder-grip-cell')
  }
  // The instructions every grip points at, and the live region, sit OUTSIDE the table.
  const instructions = document.getElementById(grip('Groceries').getAttribute('aria-describedby') ?? '')
  expect(instructions?.textContent).toBe(REORDER_INSTRUCTIONS)
  expect(table.contains(instructions)).toBe(false)
  const region = document.querySelector('span[aria-live="assertive"]')
  expect(region).not.toBeNull()
  expect(table.contains(region)).toBe(false)
})

it('a list with nothing to move has a disabled grip; an empty list has none (spec §9)', async () => {
  vi.mocked(fetchCategories).mockResolvedValue([GROCERIES])
  const { unmount } = render(<CategoriesCard />)
  await screen.findByRole('table')
  expect((grip('Groceries') as HTMLButtonElement).disabled).toBe(true)
  unmount()

  vi.mocked(fetchCategories).mockResolvedValue([])
  render(<CategoriesCard />)
  expect(await screen.findByText('No categories yet — add the first one above.')).toBeTruthy()
  expect(screen.queryAllByRole('button', { name: /^Reorder / })).toEqual([])
})

it('a keyboard drop draws the new order at once and saves the WHOLE order in one PUT — a retired row moves like any other', async () => {
  const save = deferred<{ data: CategoryOut[]; batchId: string | null }>()
  vi.mocked(reorderCategories).mockReturnValue(save.promise)
  render(<CategoriesCard />)
  await screen.findByRole('table')
  expect(rowIds()).toEqual(['5', '6', '7'])

  // Pets is retired: it keeps its place in the list and moves like any other row.
  press('Pets', ' ')
  expect(live()).toBe('Picked up Pets. Position 2 of 3.')
  press('Pets', 'ArrowUp', ' ')

  // Optimistic: the rows stand in the dropped order before the server answers…
  expect(rowIds()).toEqual(['6', '5', '7'])
  expect(vi.mocked(reorderCategories)).toHaveBeenCalledTimes(1)
  expect(vi.mocked(reorderCategories)).toHaveBeenCalledWith([6, 5, 7])
  // …and every grip is parked while the save is in flight: no second drop can race it.
  expect(grip('Groceries').getAttribute('aria-disabled')).toBe('true')
  expect(grip('Pets').getAttribute('aria-disabled')).toBe('true')

  // The response is the truth: whatever order it carries is the order drawn (it differs from
  // the drop here only to prove the rows were replaced, not kept).
  await act(async () => {
    save.resolve({ data: [PETS, TAXES, GROCERIES], batchId: 'batch-7' })
  })
  expect(rowIds()).toEqual(['6', '7', '5'])
  expect(grip('Groceries').getAttribute('aria-disabled')).toBeNull()
  expect(vi.mocked(fetchCategories)).toHaveBeenCalledTimes(1)
})

it('saved: the moved row flashes and a toast names it, with Undo (spec §8.1)', async () => {
  render(
    <ToastProvider>
      <CategoriesCard />
    </ToastProvider>,
  )
  await screen.findByRole('table')
  press('Pets', ' ', 'ArrowUp', ' ')

  const toast = await screen.findByText('Moved Pets')
  expect(toast.className).toBe('toast-message')
  expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy()
  expect(row(6)?.hasAttribute('data-reorder-saved')).toBe(true)
})

it('a save that logged nothing offers no Undo', async () => {
  vi.mocked(reorderCategories).mockResolvedValue({ data: [PETS, GROCERIES, TAXES], batchId: null })
  render(
    <ToastProvider>
      <CategoriesCard />
    </ToastProvider>,
  )
  await screen.findByRole('table')
  press('Pets', ' ', 'ArrowUp', ' ')

  expect(await screen.findByText('Moved Pets')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
})

it('Undo reverts through the change log, reloads and says so (spec §4.1)', async () => {
  render(
    <ToastProvider>
      <CategoriesCard />
    </ToastProvider>,
  )
  await screen.findByRole('table')
  press('Pets', ' ', 'ArrowUp', ' ')
  await screen.findByText('Moved Pets')
  expect(rowIds()).toEqual(['6', '5', '7'])

  fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

  await waitFor(() => expect(vi.mocked(undoBatch)).toHaveBeenCalledWith('batch-7'))
  expect(await screen.findByText('Order restored')).toBeTruthy()
  await waitFor(() => expect(rowIds()).toEqual(['5', '6', '7']))
  expect(vi.mocked(fetchCategories)).toHaveBeenCalledTimes(2)
})

it("a refused Undo shows the server's own sentence (spec §9)", async () => {
  vi.mocked(undoBatch).mockRejectedValue(
    new ApiError('Later changes touched these rows — undo those first', 409),
  )
  render(
    <ToastProvider>
      <CategoriesCard />
    </ToastProvider>,
  )
  await screen.findByRole('table')
  press('Pets', ' ', 'ArrowUp', ' ')
  await screen.findByText('Moved Pets')

  fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

  const refusal = await screen.findByText('Later changes touched these rows — undo those first')
  expect(refusal.className).toBe('toast-message')
  expect(vi.mocked(fetchCategories)).toHaveBeenCalledTimes(1)
})

it('a failed save snaps back to the last server order and says why (spec §8.1)', async () => {
  vi.mocked(reorderCategories).mockRejectedValue(new ApiError('database unavailable', 503))
  render(
    <ToastProvider>
      <CategoriesCard />
    </ToastProvider>,
  )
  await screen.findByRole('table')
  press('Pets', ' ', 'ArrowUp', ' ')

  const toast = await screen.findByText(
    "Couldn't save the new order — the server had a problem (HTTP 503). The list is back to how it was.",
  )
  expect(toast.className).toBe('toast-message')
  expect(rowIds()).toEqual(['5', '6', '7'])
  // A failure is not a stale list: nothing to reload.
  expect(vi.mocked(fetchCategories)).toHaveBeenCalledTimes(1)
})

it("a stale list (409) shows the server's sentence and reloads the current rows (spec §8.3)", async () => {
  vi.mocked(reorderCategories).mockRejectedValue(new ApiError(STALE, 409))
  vi.mocked(fetchCategories)
    .mockResolvedValueOnce([GROCERIES, PETS, TAXES])
    .mockResolvedValueOnce([GROCERIES, PETS, TAXES, WEDDING])
  render(
    <ToastProvider>
      <CategoriesCard />
    </ToastProvider>,
  )
  await screen.findByRole('table')
  press('Pets', ' ', 'ArrowUp', ' ')

  const toast = await screen.findByText(STALE)
  expect(toast.className).toBe('toast-message')
  await waitFor(() => expect(rowIds()).toEqual(['5', '6', '7', '8']))
  expect(vi.mocked(fetchCategories)).toHaveBeenCalledTimes(2)
})

it('a reload still in flight when the order is saved cannot put the old order back', async () => {
  const reload = deferred<CategoryOut[]>()
  vi.mocked(fetchCategories)
    .mockResolvedValueOnce([GROCERIES, PETS, TAXES])
    .mockReturnValueOnce(reload.promise)
  render(<CategoriesCard />)
  await screen.findByRole('table')

  // Retire answers at once; the reload it starts is still on the wire when a row is moved.
  fireEvent.click(screen.getByRole('button', { name: 'Retire Groceries' }))
  await waitFor(() => expect(vi.mocked(fetchCategories)).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(grip('Pets').getAttribute('aria-disabled')).toBeNull())
  press('Pets', ' ', 'ArrowUp', ' ')
  await waitFor(() => expect(vi.mocked(reorderCategories)).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(grip('Pets').getAttribute('aria-disabled')).toBeNull())
  expect(rowIds()).toEqual(['6', '5', '7'])

  // The late answer describes the list before the drop: it is dropped, not drawn.
  await act(async () => {
    reload.resolve([GROCERIES, PETS, TAXES])
  })
  expect(rowIds()).toEqual(['6', '5', '7'])
})

it('parks every grip while another request of the card is in flight (spec §4.1 Busy)', async () => {
  const patch = deferred<CategoryOut>()
  vi.mocked(updateCategory).mockReturnValue(patch.promise)
  render(<CategoriesCard />)
  await screen.findByRole('table')
  expect(grip('Taxes').getAttribute('aria-disabled')).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'Retire Groceries' }))

  expect(grip('Groceries').getAttribute('aria-disabled')).toBe('true')
  expect(grip('Taxes').getAttribute('aria-disabled')).toBe('true')
  // Parked, not disabled: the grip keeps its focus and lifts nothing.
  expect((grip('Taxes') as HTMLButtonElement).disabled).toBe(false)
  press('Taxes', ' ')
  expect(live()).toBe('')

  await act(async () => {
    patch.resolve({ ...GROCERIES, is_active: false })
  })
  await waitFor(() => expect(grip('Taxes').getAttribute('aria-disabled')).toBeNull())
})
```

- [ ] **Step 4: Run them to see them fail**

Run: `npx vitest run src/components/settings/CategoriesCard.test.tsx`
Expected: FAIL — 11 failed, 14 passed:
- `draws a grip column…` fails on `expected false to be true` (no `reorder-table` class);
- `a list with nothing to move…` and the others fail on `Unable to find an accessible element with
  the role "button" and name "Reorder …"`.

- [ ] **Step 5: Replace `src/components/settings/CategoriesCard.tsx` with**

```tsx
import { useEffect, useRef, useState } from 'react'
import { ApiError, describeError, errorDetail } from '../../api/client'
import { undoBatch } from '../../api/lifecycle'
import {
  createCategory,
  deleteCategory,
  fetchCategories,
  reorderCategories,
  updateCategory,
} from '../../api/spending'
import type { CategoryKind, CategoryOut } from '../../types/api'
import InfoHint from '../InfoHint'
import DragHandle from '../reorder/DragHandle'
import { ReorderInstructions, ReorderLiveRegion } from '../reorder/ReorderStatus'
import { useReorder } from '../reorder/useReorder'
import type { UseReorder } from '../reorder/useReorder'
import { useToast } from '../ToastProvider'
import { FeedBanner } from '../shell/Feed'
import Segmented from '../shell/Segmented'
import { useScrollEdges } from '../useScrollEdges'
import '../panels.css'
import './settings.css'
import SettingsGhost from './SettingsGhost'
import { WARM, warmSource } from './settingsPrefetch'

interface CategoryFormState {
  name: string
}

const EMPTY_CATEGORY: CategoryFormState = { name: '' }

// Living · Tax · Transfer (2026-09-04 honest-numbers spec §1) on the house's ONE pick-one
// control, so a category's kind reads like every other three-way choice in the app.
const KINDS: { value: CategoryKind; label: string }[] = [
  { value: 'living', label: 'Living' },
  { value: 'tax', label: 'Tax' },
  { value: 'transfer', label: 'Transfer' },
]

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

// errorDetail's reason with any closing stop folded away: the two sentences below end on their
// own (describeLoadFailures' rule in client.ts).
function reason(err: unknown): string {
  return errorDetail(err).replace(/[.\s]+$/, '')
}

/** A drop the server did not take (2026-09-23 reorder spec §8.1), said once the rows have
 *  already snapped back. A 409 never reaches this: its own sentence is shown verbatim. */
function orderSaveFailed(err: unknown): string {
  return `Couldn't save the new order — ${reason(err)}. The list is back to how it was.`
}

/** A refused Undo is the server's own sentence ("Later changes touched these rows — undo those
 *  first", spec §9); a request that got no answer at all says what failed and why. */
function undoFailed(err: unknown): string {
  return err instanceof ApiError && err.status >= 400 && err.status < 500
    ? err.message
    : `Couldn't undo the move — ${reason(err)}.`
}

/**
 * The Settings Spending-categories card (2026-08-26 spec §6). The CRUD endpoints have
 * existed since Plan 3 with no caller at all (audit §3.1), so the category axis was fixed
 * by the workbook exactly like the account roster was.
 *
 * The order is the table's (2026-09-23 reorder spec §4.1): a row is dragged by its grip — or
 * lifted with Space and moved with the arrows — and the drop saves the WHOLE order in one PUT,
 * with the change log's Undo behind it.
 */
export default function CategoriesCard() {
  const [categories, setCategories] = useState<CategoryOut[]>([])
  const [loaded, setLoaded] = useState(false)
  // Two slots, because they have two different answers (2026-09-05 motion spec §9): a load
  // failure is fixed by asking again; a refused save or a typo is not.
  const [loadError, setLoadError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<CategoryFormState>(EMPTY_CATEGORY)
  // A drop renders its order AT ONCE; the order is retired the moment the server's rows land —
  // CategoriesPanel's adjust-during-render recipe, not an effect (spec §4.1).
  const [pendingOrder, setPendingOrder] = useState<CategoryOut[] | null>(null)
  const [lastCategories, setLastCategories] = useState(categories)
  const seqRef = useRef(0)
  const toast = useToast()

  if (lastCategories !== categories) {
    setLastCategories(categories)
    setPendingOrder(null)
  }
  // What the table draws: the dropped order while its save is in flight, else the server's.
  const shown = pendingOrder ?? categories
  const nameOf = new Map(shown.map((category) => [category.id, category.name]))

  const load = (initial = false) => {
    const seq = ++seqRef.current
    warmSource(initial)(WARM.categories, fetchCategories)
      .then((rows) => {
        if (seq !== seqRef.current) return
        setCategories(rows)
        setLoadError(null)
        setLoaded(true)
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        setLoadError(describeError(err, 'the categories'))
      })
  }

  useEffect(() => {
    load(true)
    // mount-only: a plain function over stable setters (house idiom)
  }, [])

  const setText = (field: keyof CategoryFormState) => (value: string) => {
    setForm((f) => ({ ...f, [field]: value }))
    setFormError(null)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setForm(EMPTY_CATEGORY)
  }

  const submit = () => {
    const name = form.name.trim()
    if (!name) {
      setFormError('Category name is required.')
      return
    }
    // The name alone: the position is the table's now — a new category lands at the end and
    // is dragged into place (2026-09-23 reorder spec §3.3, §4.1).
    const body = { name }
    setBusy(true)
    setFormError(null)
    const request = editingId !== null ? updateCategory(editingId, body) : createCategory(body)
    request
      .then(() => {
        cancelEdit()
        load()
      })
      .catch((err: unknown) => setFormError(message(err, 'Save failed')))
      .finally(() => setBusy(false))
  }

  // ONLY is_active on the wire: the name and position are untouched columns here.
  const toggleActive = (category: CategoryOut) => {
    setBusy(true)
    setFormError(null)
    updateCategory(category.id, { is_active: !category.is_active })
      .then(() => load())
      .catch((err: unknown) => setFormError(message(err, 'Update failed')))
      .finally(() => setBusy(false))
  }

  // ONLY kind on the wire — toggleActive's rule: the name and position are untouched columns
  // here. Clicking the kind a row already has is a no-op: Segmented reports every click,
  // including one on the active button, and a PATCH that changed nothing would still write a
  // change-log batch offering to "undo" it (L2 hooks cover PATCH /categories, spec §6).
  const setKind = (category: CategoryOut, next: CategoryKind) => {
    if (next === category.kind) return
    setBusy(true)
    setFormError(null)
    updateCategory(category.id, { kind: next })
      .then(() => load())
      .catch((err: unknown) => setFormError(message(err, 'Update failed')))
      .finally(() => setBusy(false))
  }

  const remove = (category: CategoryOut) => {
    setBusy(true)
    // The server's guard sentence names the monthly-row count; it is about a table row,
    // so it rides the toast layer rather than the form banner (AccountsCard's rule).
    deleteCategory(category.id)
      .then(() => {
        if (category.id === editingId) cancelEdit()
        load()
      })
      .catch((err: unknown) => toast.error(message(err, 'Delete failed')))
      .finally(() => setBusy(false))
  }

  // The reorder route logs its batch (spec §3.2), so Undo is the change log's: the server
  // writes every renumbered row back, then the list is read again.
  const undoOrder = (batchId: string) => {
    setBusy(true)
    undoBatch(batchId)
      .then(() => {
        load()
        toast.info('Order restored')
      })
      .catch((err: unknown) => toast.error(undoFailed(err)))
      .finally(() => setBusy(false))
  }

  // One PUT with every category — active and retired — in the dropped order (spec §4.1). Its
  // outcome is about a row far down the table, so it rides the toast layer, never the form
  // banner (the delete guard's rule above).
  const saveOrder = (ids: number[], moved: number) => {
    const name = nameOf.get(moved) ?? 'the category'
    // A reload already on the wire describes the order BEFORE this drop; its answer must not
    // land on top of the one this save brings back (load's seq guard drops it).
    seqRef.current += 1
    setBusy(true)
    reorderCategories(ids)
      .then(({ data, batchId }) => {
        setCategories(data)
        reorder.markSaved(moved)
        toast.success(
          `Moved ${name}`,
          // No batch = nothing was logged, so there is nothing to undo (the wizard's contract).
          batchId === null
            ? undefined
            : { action: { label: 'Undo', onAction: () => undoOrder(batchId) } },
        )
      })
      .catch((err: unknown) => {
        setPendingOrder(null) // back to the last order the server confirmed
        if (err instanceof ApiError && err.status === 409) {
          // The list changed under this one (another tab): the server's sentence, then the
          // current rows (spec §8.3).
          toast.error(err.message)
          load()
          return
        }
        toast.error(orderSaveFailed(err))
      })
      .finally(() => setBusy(false))
  }

  const reorder = useReorder({
    items: shown.map((category) => ({ id: category.id })),
    labelOf: (id) => nameOf.get(id) ?? String(id),
    // Every request of the card parks the grips: a drop cannot race a save (spec §9).
    disabled: busy,
    onCommit: (next, moved) => {
      const byId = new Map(shown.map((category) => [category.id, category]))
      setPendingOrder(
        next.flatMap((id) => {
          const category = byId.get(id)
          return category === undefined ? [] : [category]
        }),
      )
      saveOrder(next, moved)
    },
  })

  return (
    <section className="card span-8" id="categories">
      <h2 className="eyebrow">
        Spending categories
        <InfoHint text="The spending matrix's rows. Retire keeps a category out of the wizard without losing its history; delete only works while a category has no monthly rows. The slug never changes — it is the workbook importer's key." />
      </h2>
      <FeedBanner error={loadError} retry={() => load()} retryLabel="Retry loading the categories" />
      {!loaded && loadError === null && <SettingsGhost height={900} />}
      {loaded && (
        <>
          <form
            className="category-form"
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            <label>
              Category name
              <input
                className="field-input"
                value={form.name}
                onChange={(e) => setText('name')(e.target.value)}
              />
            </label>
            <div className="settings-card-actions">
              <button type="submit" className="button button-primary" disabled={busy}>
                {editingId !== null ? 'Save category' : 'Add category'}
              </button>
              {editingId !== null && (
                <button type="button" className="button" onClick={cancelEdit}>
                  Cancel
                </button>
              )}
            </div>
            <FeedBanner error={formError} />
          </form>
          {categories.length === 0 ? (
            <p className="empty-note">No categories yet — add the first one above.</p>
          ) : (
            <>
              <CategoriesTable
                categories={shown}
                busy={busy}
                editingId={editingId}
                reorder={reorder}
                onEdit={(category) => {
                  setEditingId(category.id)
                  setFormError(null)
                  setForm({ name: category.name })
                }}
                onToggleActive={toggleActive}
                onKind={setKind}
                onRemove={remove}
              />
              {/* Once per card and OUTSIDE the table (a <span> is not a table child): the grips'
                  aria-describedby target and the lift/move/drop announcements (spec §2.4). */}
              <ReorderInstructions id={reorder.instructionsId} />
              <ReorderLiveRegion text={reorder.announcement} />
              {/* ONE line per kind (spec §1): the three definitions are read while deciding
                  a single row's picker, so they have to be scannable side by side, not
                  buried in a paragraph the reader has to parse to find their case. */}
              <ul className="settings-note">
                <li>
                  Living: money that left the household — food, housing, a loan payment you
                  must fund each month.
                </li>
                <li>
                  Tax: an income-tax payment made from take-home — the April bill, estimated
                  payments; payroll withholding is not here, it never reaches net pay.
                </li>
                <li>
                  Transfer: money that stayed yours — a brokerage or savings deposit, extra
                  principal — part of net worth, not spend.
                </li>
              </ul>
              <p className="settings-note">
                Changing a kind recomputes ALL history: every month, chart and projection
                that reads it moves, not just this one. The change is recorded in Activity.
              </p>
            </>
          )}
        </>
      )}
    </section>
  )
}

/** The scrolling table, its own component so `useScrollEdges` sees a scroller that EXISTS on its
 *  first commit: the card mounts before its rows land, and a hook bound to a ref that is still null
 *  then would never observe the element. The scroller flags `data-scroll-more` (panels.css masks
 *  the clipped edge) and the last column is sticky, so Delete is never hidden behind a scrollbar
 *  that only appears on hover (2026-09-13 spec §7, audit S-3).
 *
 *  The first column is the grip (2026-09-23 reorder spec §4.1): every category, retired ones
 *  included, is a row of ONE list that moves among the others. `.reorder-table` gives each cell
 *  its own hairline so a moving row takes its border with it (reorder.css). */
function CategoriesTable({
  categories,
  busy,
  editingId,
  reorder,
  onEdit,
  onToggleActive,
  onKind,
  onRemove,
}: {
  categories: CategoryOut[]
  busy: boolean
  editingId: number | null
  reorder: UseReorder<number>
  onEdit: (category: CategoryOut) => void
  onToggleActive: (category: CategoryOut) => void
  onKind: (category: CategoryOut, next: CategoryKind) => void
  onRemove: (category: CategoryOut) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  useScrollEdges(scrollRef)
  return (
    <div className="settings-scroll" ref={scrollRef}>
      <table className="data-table category-table reorder-table">
        <thead>
          <tr>
            <th className="reorder-grip-cell" aria-hidden="true" />
            <th>Category</th>
            <th>Kind</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {categories.map((category) => (
            <tr
              key={category.id}
              className={category.id === editingId ? 'is-editing' : undefined}
              {...reorder.itemProps(category.id)}
            >
              <td className="reorder-grip-cell">
                <DragHandle name={category.name} {...reorder.handleProps(category.id)} />
              </td>
              <td>{category.name}</td>
              <td>
                <Segmented
                  variant="toggle"
                  size="sm"
                  ariaLabel={`Kind for ${category.name}`}
                  // disabled while a request is in flight, like the row's other controls: a second
                  // PATCH would race the reload that follows the first and the picker would flicker back.
                  options={KINDS.map((k) => ({ ...k, disabled: busy }))}
                  value={category.kind}
                  onChange={(next) => onKind(category, next)}
                />
              </td>
              <td>
                <span className="badge">{category.is_active ? 'Active' : 'Retired'}</span>
              </td>
              <td className="row-actions">
                <button type="button" className="button" aria-label={`Edit ${category.name}`} disabled={busy} onClick={() => onEdit(category)}>
                  Edit
                </button>
                <button
                  type="button"
                  className="button"
                  aria-label={category.is_active ? `Retire ${category.name}` : `Restore ${category.name}`}
                  disabled={busy}
                  onClick={() => onToggleActive(category)}
                >
                  {category.is_active ? 'Retire' : 'Restore'}
                </button>
                <button type="button" className="button" aria-label={`Delete ${category.name}`} disabled={busy} onClick={() => onRemove(category)}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 6: Run them to see them pass**

Run: `npx vitest run src/components/settings/CategoriesCard.test.tsx`
Expected: PASS — 25 tests.

If one fails, check two things:
- `onCommit` must call `setPendingOrder` before anything async; it runs inside the hook's
  `flushSync`.
- `saveOrder` must bump `seqRef` before the PUT.

- [ ] **Step 7: The neighbours still pass**

Run: `npx vitest run src/pages/SettingsPage.test.tsx src/guide`
Expected: PASS. The page test mounts this card through its spread mocks.

- [ ] **Step 8: Type-check, lint, commit**

```bash
npx tsc -b && npx eslint src/components/settings/CategoriesCard.tsx src/components/settings/CategoriesCard.test.tsx
git add src/components/settings/CategoriesCard.tsx src/components/settings/CategoriesCard.test.tsx
git commit -m "feat(settings): drag to reorder spending categories — one PUT, the order shows at once, Undo, an honest failure"
```

---

### Task 4: Categories — row buttons wait during a lift; the order note and the drag hint (spec §2.3, §4.1, §8.1)

**Files:**
- Modify: `src/components/settings/CategoriesCard.tsx`:
  - the `<InfoHint text=…>` in the heading;
  - a note after `<ReorderLiveRegion …/>`;
  - the whole `CategoriesTable` function.
- Test: `src/components/settings/CategoriesCard.test.tsx` — 2 tests appended

- [ ] **Step 1: Append the failing tests**

Append at the end of `CategoriesCard.test.tsx`:

```tsx
it('holds every row button while a row is lifted, and gives them back when the lift is cancelled', async () => {
  render(<CategoriesCard />)
  await screen.findByRole('table')
  const edit = () => screen.getByRole('button', { name: 'Edit Taxes' }) as HTMLButtonElement
  const kindTax = () =>
    within(screen.getByRole('group', { name: 'Kind for Pets' })).getByRole('button', {
      name: 'Tax',
    }) as HTMLButtonElement

  press('Groceries', ' ')
  expect(edit().disabled).toBe(true)
  expect((screen.getByRole('button', { name: 'Delete Pets' }) as HTMLButtonElement).disabled).toBe(true)
  expect(kindTax().disabled).toBe(true)

  press('Groceries', 'Escape')
  expect(live()).toBe('Cancelled. Groceries is back at position 1 of 3.')
  expect(edit().disabled).toBe(false)
  expect(kindTax().disabled).toBe(false)
})

it('says what the order is for and how to change it (spec §8.1)', async () => {
  render(<CategoriesCard />)
  const table = await screen.findByRole('table')

  const note = screen.getByText(
    'The Monthly update lists categories in this order — a spreadsheet column pasted there fills them in this order too.',
  )
  // Under the table.
  expect(table.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /^About The spending matrix's/ }))
  expect(screen.getByRole('tooltip').textContent).toContain(
    'Drag a row by its grip to change the order the app lists categories in.',
  )
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/components/settings/CategoriesCard.test.tsx`
Expected: FAIL — 2 failed, 25 passed:
- `holds every row button…`: `expected false to be true` on `edit().disabled`;
- `says what the order is for…`: `Unable to find an element with the text: The Monthly update
  lists categories…`.

- [ ] **Step 3: Implement**

(a) The heading's InfoHint — replace

```tsx
        <InfoHint text="The spending matrix's rows. Retire keeps a category out of the wizard without losing its history; delete only works while a category has no monthly rows. The slug never changes — it is the workbook importer's key." />
```

with (spec §8.1, appended sentence)

```tsx
        <InfoHint text="The spending matrix's rows. Retire keeps a category out of the wizard without losing its history; delete only works while a category has no monthly rows. The slug never changes — it is the workbook importer's key. Drag a row by its grip to change the order the app lists categories in." />
```

(b) The order note, directly under the table — replace

```tsx
              <ReorderInstructions id={reorder.instructionsId} />
              <ReorderLiveRegion text={reorder.announcement} />
              {/* ONE line per kind (spec §1): the three definitions are read while deciding
```

with

```tsx
              <ReorderInstructions id={reorder.instructionsId} />
              <ReorderLiveRegion text={reorder.announcement} />
              {/* What the order is FOR (2026-09-23 reorder spec §8.1): the wizard walks it, and a
                  positional paste fills it — so moving a row here moves where a pasted value lands. */}
              <p className="settings-note">
                The Monthly update lists categories in this order — a spreadsheet column pasted
                there fills them in this order too.
              </p>
              {/* ONE line per kind (spec §1): the three definitions are read while deciding
```

(c) Replace the whole `CategoriesTable` function — from its doc comment
(`/** The scrolling table, its own component…`) to the end of the file — with:

```tsx
/** The scrolling table, its own component so `useScrollEdges` sees a scroller that EXISTS on its
 *  first commit: the card mounts before its rows land, and a hook bound to a ref that is still null
 *  then would never observe the element. The scroller flags `data-scroll-more` (panels.css masks
 *  the clipped edge) and the last column is sticky, so Delete is never hidden behind a scrollbar
 *  that only appears on hover (2026-09-13 spec §7, audit S-3).
 *
 *  The first column is the grip (2026-09-23 reorder spec §4.1): every category, retired ones
 *  included, is a row of ONE list that moves among the others. `.reorder-table` gives each cell
 *  its own hairline so a moving row takes its border with it (reorder.css). */
function CategoriesTable({
  categories,
  busy,
  editingId,
  reorder,
  onEdit,
  onToggleActive,
  onKind,
  onRemove,
}: {
  categories: CategoryOut[]
  busy: boolean
  editingId: number | null
  reorder: UseReorder<number>
  onEdit: (category: CategoryOut) => void
  onToggleActive: (category: CategoryOut) => void
  onKind: (category: CategoryOut, next: CategoryKind) => void
  onRemove: (category: CategoryOut) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  useScrollEdges(scrollRef)
  // A lifted row holds the list: the row buttons wait for the drop, as they wait for a request
  // (spec §2.3) — an Edit or a Delete must not land on a row that is in the air.
  const locked = busy || reorder.active
  return (
    <div className="settings-scroll" ref={scrollRef}>
      <table className="data-table category-table reorder-table">
        <thead>
          <tr>
            <th className="reorder-grip-cell" aria-hidden="true" />
            <th>Category</th>
            <th>Kind</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {categories.map((category) => (
            <tr
              key={category.id}
              className={category.id === editingId ? 'is-editing' : undefined}
              {...reorder.itemProps(category.id)}
            >
              <td className="reorder-grip-cell">
                <DragHandle name={category.name} {...reorder.handleProps(category.id)} />
              </td>
              <td>{category.name}</td>
              <td>
                <Segmented
                  variant="toggle"
                  size="sm"
                  ariaLabel={`Kind for ${category.name}`}
                  // disabled while a request is in flight, like the row's other controls: a second
                  // PATCH would race the reload that follows the first and the picker would flicker back.
                  options={KINDS.map((k) => ({ ...k, disabled: locked }))}
                  value={category.kind}
                  onChange={(next) => onKind(category, next)}
                />
              </td>
              <td>
                <span className="badge">{category.is_active ? 'Active' : 'Retired'}</span>
              </td>
              <td className="row-actions">
                <button type="button" className="button" aria-label={`Edit ${category.name}`} disabled={locked} onClick={() => onEdit(category)}>
                  Edit
                </button>
                <button
                  type="button"
                  className="button"
                  aria-label={category.is_active ? `Retire ${category.name}` : `Restore ${category.name}`}
                  disabled={locked}
                  onClick={() => onToggleActive(category)}
                >
                  {category.is_active ? 'Retire' : 'Restore'}
                </button>
                <button type="button" className="button" aria-label={`Delete ${category.name}`} disabled={locked} onClick={() => onRemove(category)}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

(The only change from Task 3 is `locked = busy || reorder.active` on the kind picker and the three
buttons.)

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run src/components/settings/CategoriesCard.test.tsx`
Expected: PASS — 27 tests.

- [ ] **Step 5: Type-check, lint, commit**

```bash
npx tsc -b && npx eslint src/components/settings/CategoriesCard.tsx src/components/settings/CategoriesCard.test.tsx
git add src/components/settings/CategoriesCard.tsx src/components/settings/CategoriesCard.test.tsx
git commit -m "feat(settings): categories — row buttons wait during a lift; the order note and the drag hint"
```

---

### Task 5: Accounts — the grouped, reorderable roster (spec §4.2, §8.1-§8.3, §9)

**Files:**
- Modify: `src/components/settings/AccountsCard.tsx` — whole file (the full file is given)
- Test: `src/components/settings/AccountsCard.test.tsx` — the header (lines 3-21), the setup (lines
  118-147), two existing tests (:149-159, :356-370), 16 tests appended

What the tests pin:
- one heading row per non-empty group, in `GROUP_ORDER` rather than API order
  (`<th scope="colgroup" colSpan=6>`);
- the Group and Sort columns are gone; the grip column is first; `.reorder-table`;
- the Portfolio accounts table is untouched;
- components are nested under their parent (the sheet lists them before it) and carry
  `component-row` with the name in the `accounts-name-cell` second cell;
- a component whose parent is in another group is top-level in its own group;
- a component of a retired parent stays nested;
- a group of one, and a lone component, have a disabled grip;
- a parent's move carries its components in ONE PUT of every account, shown at once;
- a component moves only among its siblings (clamped), with the range named in the announcement;
- a retired parent moves with its component, and Home works;
- a row `nestComponents` cannot place stays listed with a disabled grip and rides in the PUT;
- the saved flash on the whole unit, the toast and Undo, a refused Undo, failure, 409;
- a reload already on the wire is ignored;
- the grips are parked during another request.

- [ ] **Step 1: The test file's header — imports and mocks**

In `AccountsCard.test.tsx`, replace lines 3-21:

```tsx
import { ApiError } from '../../api/client'
import type { AccountOut, PersonOut, PortfolioAccountOut } from '../../types/api'
import ToastProvider from '../ToastProvider'
import AccountsCard from './AccountsCard'

vi.mock('../../api/netWorth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/netWorth')>()),
  fetchAccounts: vi.fn(),
  createAccount: vi.fn(),
  updateAccount: vi.fn(),
  deleteAccount: vi.fn(),
}))
import { createAccount, deleteAccount, fetchAccounts, updateAccount } from '../../api/netWorth'
vi.mock('../../api/portfolio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/portfolio')>()),
  fetchPortfolioAccounts: vi.fn(),
  patchPortfolioAccount: vi.fn(),
}))
import { fetchPortfolioAccounts, patchPortfolioAccount } from '../../api/portfolio'
```

with:

```tsx
import { ApiError } from '../../api/client'
import type { AccountOut, ActivityBatch, PersonOut, PortfolioAccountOut } from '../../types/api'
import { REORDER_INSTRUCTIONS } from '../reorder/reorderMath'
import ToastProvider from '../ToastProvider'
import AccountsCard from './AccountsCard'

vi.mock('../../api/netWorth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/netWorth')>()),
  fetchAccounts: vi.fn(),
  createAccount: vi.fn(),
  updateAccount: vi.fn(),
  deleteAccount: vi.fn(),
  reorderAccounts: vi.fn(),
}))
import {
  createAccount,
  deleteAccount,
  fetchAccounts,
  reorderAccounts,
  updateAccount,
} from '../../api/netWorth'
vi.mock('../../api/portfolio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/portfolio')>()),
  fetchPortfolioAccounts: vi.fn(),
  patchPortfolioAccount: vi.fn(),
}))
import { fetchPortfolioAccounts, patchPortfolioAccount } from '../../api/portfolio'
vi.mock('../../api/lifecycle', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/lifecycle')>()),
  undoBatch: vi.fn(),
}))
import { undoBatch } from '../../api/lifecycle'
```

- [ ] **Step 2: Fixtures, setup and helpers**

Replace (from `JOINT_ROTH` through the `roster` helper):

```tsx
const JOINT_ROTH: PortfolioAccountOut = { id: 31, label: 'Joint Roth', person_id: null }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.mocked(fetchAccounts).mockResolvedValue([CHECKING, HSA])
  vi.mocked(createAccount).mockResolvedValue(CHECKING)
  vi.mocked(updateAccount).mockResolvedValue(HSA)
  vi.mocked(deleteAccount).mockResolvedValue(undefined)
  vi.mocked(fetchPortfolioAccounts).mockResolvedValue([BROKERAGE, JOINT_ROTH])
  vi.mocked(patchPortfolioAccount).mockResolvedValue({ ...BROKERAGE, person_id: 2 })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// Every roster assertion is scoped to the NET-WORTH table: account names are also options
// in the parent select, owner names are also options in both owner selects, and the card
// now carries a second table (Portfolio accounts).
const roster = () => within(screen.getByRole('table', { name: 'Net-worth accounts' }))
```

with:

```tsx
const JOINT_ROTH: PortfolioAccountOut = { id: 31, label: 'Joint Roth', person_id: null }
// A component whose parent is itself a component: nestComponents nests one level and leaves
// this row out, so the roster has to keep it on its own (reorder spec §4.2).
const SLICE_OF_SLICE: AccountOut = {
  id: 26,
  name: 'Pre-tax slice of a slice',
  slug: 'pre-tax-slice-of-a-slice',
  group: 'pre_tax',
  sort_order: 9,
  is_active: true,
  is_component: true,
  parent_account_id: 21,
  person_id: 1,
}
// A component filed in ANOTHER group than its parent (Taxable vs the Pre-tax 401(k)): it is
// top-level in its own group (reorder spec §9).
const SWEEP: AccountOut = {
  id: 40,
  name: 'Brokerage sweep',
  slug: 'brokerage-sweep',
  group: 'taxable',
  sort_order: 10,
  is_active: true,
  is_component: true,
  parent_account_id: 20,
  person_id: 1,
}
const SCHWAB: AccountOut = {
  id: 41,
  name: 'Schwab Brokerage',
  slug: 'schwab-brokerage',
  group: 'taxable',
  sort_order: 11,
  is_active: true,
  is_component: false,
  parent_account_id: null,
  person_id: 1,
}
// The roster most reorder tests stand on: Cash holds one account; Pre-tax holds the HSA and
// the 401(k), which carries its two components.
const ROSTER = [CHECKING, HSA, TRAD, TRAD_PRETAX, TRAD_MATCH]
// The change log's answer to an Undo (POST /activity/batches/{id}/undo).
const UNDONE: ActivityBatch = {
  type: 'batch',
  batch_id: 'undo-2',
  at: '2026-09-23T12:00:00Z',
  source: 'undo',
  actor: 'admin@example.com',
  label: 'Undid: Moved account Fidelity Traditional 401(k)',
  month: null,
  rows: 5,
  undoable: true,
  undone_by: null,
}
// R1's stale-list sentence for this route (2026-09-23 reorder spec §8.3).
const STALE = 'The accounts changed since this list was loaded — nothing was moved.'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.mocked(fetchAccounts).mockResolvedValue([CHECKING, HSA])
  vi.mocked(createAccount).mockResolvedValue(CHECKING)
  vi.mocked(updateAccount).mockResolvedValue(HSA)
  vi.mocked(deleteAccount).mockResolvedValue(undefined)
  vi.mocked(fetchPortfolioAccounts).mockResolvedValue([BROKERAGE, JOINT_ROTH])
  vi.mocked(patchPortfolioAccount).mockResolvedValue({ ...BROKERAGE, person_id: 2 })
  vi.mocked(reorderAccounts).mockResolvedValue({
    data: [CHECKING, TRAD, TRAD_PRETAX, TRAD_MATCH, HSA],
    batchId: 'batch-9',
  })
  vi.mocked(undoBatch).mockResolvedValue(UNDONE)
  // jsdom has no layout: a keyboard lift measures every row at y=0 and asks the page to scroll it
  // clear of the top edge zone, and jsdom does not implement window.scrollBy.
  window.scrollBy = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// Every roster assertion is scoped to the NET-WORTH table: account names are also options
// in the parent select, owner names are also options in both owner selects, and the card
// now carries a second table (Portfolio accounts).
const roster = () => within(screen.getByRole('table', { name: 'Net-worth accounts' }))

const grip = (name: string) => screen.getByRole('button', { name: `Reorder ${name}` })
/** The keyboard reorder (spec §2.4): each key pressed on the row's grip, in order. */
function press(name: string, ...keys: string[]) {
  for (const key of keys) fireEvent.keyDown(grip(name), { key })
}
/** The roster's account rows by id, top to bottom — the group headings left out. */
const rowIds = () =>
  [...document.querySelectorAll('.accounts-table tbody tr[data-reorder-id]')].map((row) =>
    row.getAttribute('data-reorder-id'),
  )
const row = (id: number) =>
  document.querySelector(`.accounts-table tbody tr[data-reorder-id="${id}"]`)
const headings = () =>
  [...document.querySelectorAll('.accounts-table tr.accounts-group-row > th')].map(
    (th) => th.textContent,
  )
/** The card's reorder live region (the toast layer's alert region is a <div>). */
const live = () => document.querySelector('span[aria-live="assertive"]')?.textContent ?? ''
```

- [ ] **Step 3: Two existing tests learn the grouped table**

In `renders the roster with owner names, joint spelled out`, replace

```tsx
  expect(table.getByText('Joint')).toBeTruthy()
  expect(table.getByText('Me')).toBeTruthy()
  expect(table.getByText('Pre-tax')).toBeTruthy()
})
```

with

```tsx
  expect(table.getByText('Joint')).toBeTruthy()
  expect(table.getByText('Me')).toBeTruthy()
  // The group is said ONCE, by the heading row over its accounts — no per-row Group column
  // (reorder spec §4.2).
  expect(table.getByText('Pre-tax').closest('tr')?.className).toBe('accounts-group-row')
})
```

In `flags a component whose parent is missing or retired`, replace

```tsx
  expect(cues[0].className).toBe('accounts-link-note is-unlinked')
  // A retired parent still says how many rows roll into it, singular.
  expect(roster().getByText('derived: 1 component')).toBeTruthy()
})
```

with

```tsx
  expect(cues[0].className).toBe('accounts-link-note is-unlinked')
  // A retired parent still says how many rows roll into it, singular.
  expect(roster().getByText('derived: 1 component')).toBeTruthy()
  // …and it is still listed, so its component stays nested under it; the parentless one is
  // top-level (reorder spec §9).
  expect(rowIds()).toEqual(['23', '24', '25'])
  expect(row(25)?.classList.contains('component-row')).toBe(true)
  expect(row(23)?.classList.contains('component-row')).toBe(false)
})
```

- [ ] **Step 4: Append the tests**

Append at the end of `AccountsCard.test.tsx`:

```tsx
// --- the grouped, reorderable roster (2026-09-23 reorder spec §4.2) ---

it('groups the roster under one heading per non-empty group, in GROUP_ORDER — not API order', async () => {
  vi.mocked(fetchAccounts).mockResolvedValue([HSA, CHECKING])
  render(<AccountsCard people={[ME]} />)
  await screen.findByRole('table', { name: 'Net-worth accounts' })

  // Post-tax, Taxable, Equity, Other and Liabilities hold nothing here: no heading for them.
  expect(headings()).toEqual(['Cash', 'Pre-tax'])
  const heading = document.querySelector('.accounts-table tr.accounts-group-row > th') as HTMLTableCellElement
  expect(heading.getAttribute('scope')).toBe('colgroup')
  expect(heading.colSpan).toBe(6)
  expect(rowIds()).toEqual(['10', '11'])
})

it('draws a grip column; the Group and Sort columns are gone; the portfolio labels are untouched', async () => {
  render(<AccountsCard people={[ME]} />)
  const table = await screen.findByRole('table', { name: 'Net-worth accounts' })

  expect(table.classList.contains('reorder-table')).toBe(true)
  const headers = [...table.querySelectorAll('thead th')]
  expect(headers.map((th) => th.textContent)).toEqual(['', 'Account', 'Owner', 'Roll-up', 'Status', ''])
  expect(headers[0].className).toBe('reorder-grip-cell')
  expect(headers[0].getAttribute('aria-hidden')).toBe('true')
  expect(grip('Fidelity HSA').closest('td')?.className).toBe('reorder-grip-cell')
  // The instructions every grip points at, and the live region, sit OUTSIDE the table.
  const instructions = document.getElementById(grip('Fidelity HSA').getAttribute('aria-describedby') ?? '')
  expect(instructions?.textContent).toBe(REORDER_INSTRUCTIONS)
  expect(table.contains(instructions)).toBe(false)
  const region = document.querySelector('span[aria-live="assertive"]')
  expect(region).not.toBeNull()
  expect(table.contains(region)).toBe(false)
  // The Portfolio accounts table is not a reorderable list.
  const labels = screen.getByRole('table', { name: 'Portfolio accounts' })
  expect(within(labels).queryAllByRole('button', { name: /^Reorder / })).toEqual([])
  expect(labels.classList.contains('reorder-table')).toBe(false)
})

it('nests each component under its parent, indented in the Account cell', async () => {
  // The sheet's order lists the components BEFORE their parent; the roster draws them under it.
  vi.mocked(fetchAccounts).mockResolvedValue([CHECKING, TRAD_PRETAX, TRAD_MATCH, TRAD, HSA])
  render(<AccountsCard people={[ME]} />)
  await screen.findByRole('table', { name: 'Net-worth accounts' })

  expect(rowIds()).toEqual(['10', '20', '21', '22', '11'])
  for (const id of [21, 22]) {
    expect(row(id)?.classList.contains('component-row')).toBe(true)
    // The grip stays first; the name cell is the one the indent moves to (settings.css).
    expect(row(id)?.querySelector('td')?.className).toBe('reorder-grip-cell')
    expect(row(id)?.querySelector('td:nth-child(2)')?.className).toBe('accounts-name-cell')
  }
  expect(row(20)?.classList.contains('component-row')).toBe(false)
  expect(row(11)?.classList.contains('component-row')).toBe(false)
})

it('keeps a component whose parent sits in another group top-level in its own group (spec §9)', async () => {
  vi.mocked(fetchAccounts).mockResolvedValue([TRAD, TRAD_PRETAX, SWEEP, SCHWAB])
  render(<AccountsCard people={[ME]} />)
  await screen.findByRole('table', { name: 'Net-worth accounts' })

  expect(headings()).toEqual(['Pre-tax', 'Taxable'])
  expect(rowIds()).toEqual(['20', '21', '40', '41'])
  expect(row(40)?.classList.contains('component-row')).toBe(false)
  // It moves among its own group's accounts.
  press('Brokerage sweep', ' ')
  expect(live()).toBe('Picked up Brokerage sweep. Position 1 of 2 in Taxable.')
  press('Brokerage sweep', 'Escape')
})

it('a group of one — or a lone component — has a disabled grip (spec §9)', async () => {
  vi.mocked(fetchAccounts).mockResolvedValue([CHECKING, HSA, TRAD, TRAD_PRETAX])
  render(<AccountsCard people={[ME]} />)
  await screen.findByRole('table', { name: 'Net-worth accounts' })

  expect((grip('Joint Checking') as HTMLButtonElement).disabled).toBe(true)
  expect((grip('Traditional pre-tax') as HTMLButtonElement).disabled).toBe(true)
  expect((grip('Fidelity HSA') as HTMLButtonElement).disabled).toBe(false)
  expect((grip('Fidelity Traditional 401(k)') as HTMLButtonElement).disabled).toBe(false)
})

it('a parent carries its components: the rows move at once and ONE PUT names every account in the new order', async () => {
  const save = deferred<{ data: AccountOut[]; batchId: string | null }>()
  vi.mocked(fetchAccounts).mockResolvedValue(ROSTER)
  vi.mocked(reorderAccounts).mockReturnValue(save.promise)
  render(<AccountsCard people={[ME]} />)
  await screen.findByRole('table', { name: 'Net-worth accounts' })
  expect(rowIds()).toEqual(['10', '11', '20', '21', '22'])

  press('Fidelity Traditional 401(k)', ' ')
  expect(live()).toBe('Picked up Fidelity Traditional 401(k). Position 2 of 2 in Pre-tax.')
  press('Fidelity Traditional 401(k)', 'ArrowUp', ' ')

  // Optimistic: the parent and both components stand above the HSA before the server answers.
  expect(rowIds()).toEqual(['10', '20', '21', '22', '11'])
  expect(vi.mocked(reorderAccounts)).toHaveBeenCalledTimes(1)
  expect(vi.mocked(reorderAccounts)).toHaveBeenCalledWith([10, 20, 21, 22, 11])
  expect(grip('Fidelity HSA').getAttribute('aria-disabled')).toBe('true')

  // The response is the truth — here it also carries a rename made in another tab.
  await act(async () => {
    save.resolve({
      data: [CHECKING, TRAD, TRAD_PRETAX, TRAD_MATCH, { ...HSA, name: 'Fidelity HSA (spouse)' }],
      batchId: 'batch-9',
    })
  })
  expect(rowIds()).toEqual(['10', '20', '21', '22', '11'])
  expect(roster().getByText('Fidelity HSA (spouse)')).toBeTruthy()
  expect(grip('Fidelity HSA (spouse)').getAttribute('aria-disabled')).toBeNull()
})

it('a component moves only among its siblings', async () => {
  vi.mocked(fetchAccounts).mockResolvedValue(ROSTER)
  render(<AccountsCard people={[ME]} />)
  await screen.findByRole('table', { name: 'Net-worth accounts' })

  press('Traditional employer match', ' ')
  expect(live()).toBe(
    "Picked up Traditional employer match. Position 2 of 2 in Fidelity Traditional 401(k)'s components.",
  )
  // Already the last component: down goes nowhere, past its parent's unit or otherwise.
  press('Traditional employer match', 'ArrowDown')
  expect(live()).toBe('Traditional employer match, position 2 of 2.')
  press('Traditional employer match', 'ArrowUp', 'ArrowUp', ' ')

  expect(vi.mocked(reorderAccounts)).toHaveBeenCalledWith([10, 11, 20, 22, 21])
  await waitFor(() => expect(grip('Fidelity HSA').getAttribute('aria-disabled')).toBeNull())
})

it('a retired parent moves with its component, and Home jumps to the top of its group (spec §9)', async () => {
  vi.mocked(fetchAccounts).mockResolvedValue([...ROSTER, CLOSED_PARENT, CLOSED_SLICE])
  render(<AccountsCard people={[ME]} />)
  await screen.findByRole('table', { name: 'Net-worth accounts' })
  expect(rowIds()).toEqual(['10', '11', '20', '21', '22', '24', '25'])

  press('Closed 401(k)', ' ', 'Home', ' ')

  expect(vi.mocked(reorderAccounts)).toHaveBeenCalledWith([10, 24, 25, 11, 20, 21, 22])
  await waitFor(() => expect(grip('Fidelity HSA').getAttribute('aria-disabled')).toBeNull())
})

it('keeps an account the nesting cannot place listed, with nowhere to go — and still sends it', async () => {
  vi.mocked(fetchAccounts).mockResolvedValue([TRAD, TRAD_PRETAX, SLICE_OF_SLICE, HSA])
  render(<AccountsCard people={[ME]} />)
  await screen.findByRole('table', { name: 'Net-worth accounts' })

  // Last in its group, with the link it carries spelled out in the Roll-up column.
  expect(rowIds()).toEqual(['20', '21', '11', '26'])
  expect(roster().getByText('component of Traditional pre-tax')).toBeTruthy()
  expect((grip('Pre-tax slice of a slice') as HTMLButtonElement).disabled).toBe(true)

  press('Fidelity HSA', ' ', 'ArrowUp', ' ')

  expect(vi.mocked(reorderAccounts)).toHaveBeenCalledWith([11, 20, 21, 26])
  await waitFor(() => expect(grip('Fidelity HSA').getAttribute('aria-disabled')).toBeNull())
})

it('saved: the whole unit flashes and a toast names the account, with Undo (spec §8.1)', async () => {
  vi.mocked(fetchAccounts).mockResolvedValue(ROSTER)
  render(
    <ToastProvider>
      <AccountsCard people={[ME]} />
    </ToastProvider>,
  )
  await screen.findByRole('table', { name: 'Net-worth accounts' })
  press('Fidelity Traditional 401(k)', ' ', 'ArrowUp', ' ')

  const toast = await screen.findByText('Moved Fidelity Traditional 401(k)')
  expect(toast.className).toBe('toast-message')
  expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy()
  for (const id of [20, 21, 22]) expect(row(id)?.hasAttribute('data-reorder-saved')).toBe(true)
  expect(row(11)?.hasAttribute('data-reorder-saved')).toBe(false)
})

it('Undo reverts through the change log, reloads and says so (spec §4.2)', async () => {
  vi.mocked(fetchAccounts).mockResolvedValue(ROSTER)
  render(
    <ToastProvider>
      <AccountsCard people={[ME]} />
    </ToastProvider>,
  )
  await screen.findByRole('table', { name: 'Net-worth accounts' })
  press('Fidelity Traditional 401(k)', ' ', 'ArrowUp', ' ')
  await screen.findByText('Moved Fidelity Traditional 401(k)')

  fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

  await waitFor(() => expect(vi.mocked(undoBatch)).toHaveBeenCalledWith('batch-9'))
  expect(await screen.findByText('Order restored')).toBeTruthy()
  await waitFor(() => expect(rowIds()).toEqual(['10', '11', '20', '21', '22']))
  expect(vi.mocked(fetchAccounts)).toHaveBeenCalledTimes(2)
})

it("a refused Undo shows the server's own sentence (spec §9)", async () => {
  vi.mocked(fetchAccounts).mockResolvedValue(ROSTER)
  vi.mocked(undoBatch).mockRejectedValue(
    new ApiError('Later changes touched these rows — undo those first', 409),
  )
  render(
    <ToastProvider>
      <AccountsCard people={[ME]} />
    </ToastProvider>,
  )
  await screen.findByRole('table', { name: 'Net-worth accounts' })
  press('Fidelity Traditional 401(k)', ' ', 'ArrowUp', ' ')
  await screen.findByText('Moved Fidelity Traditional 401(k)')

  fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

  const refusal = await screen.findByText('Later changes touched these rows — undo those first')
  expect(refusal.className).toBe('toast-message')
  expect(vi.mocked(fetchAccounts)).toHaveBeenCalledTimes(1)
})

it('a failed save snaps back to the last server order and says why (spec §8.1)', async () => {
  vi.mocked(fetchAccounts).mockResolvedValue(ROSTER)
  vi.mocked(reorderAccounts).mockRejectedValue(new ApiError('database unavailable', 503))
  render(
    <ToastProvider>
      <AccountsCard people={[ME]} />
    </ToastProvider>,
  )
  await screen.findByRole('table', { name: 'Net-worth accounts' })
  press('Fidelity Traditional 401(k)', ' ', 'ArrowUp', ' ')

  const toast = await screen.findByText(
    "Couldn't save the new order — the server had a problem (HTTP 503). The list is back to how it was.",
  )
  expect(toast.className).toBe('toast-message')
  expect(rowIds()).toEqual(['10', '11', '20', '21', '22'])
  // A failure is not a stale list: nothing to reload.
  expect(vi.mocked(fetchAccounts)).toHaveBeenCalledTimes(1)
})

it("a stale roster (409) shows the server's sentence and reloads the current rows (spec §8.3)", async () => {
  vi.mocked(fetchAccounts)
    .mockResolvedValueOnce(ROSTER)
    .mockResolvedValueOnce([...ROSTER, SCHWAB])
  vi.mocked(reorderAccounts).mockRejectedValue(new ApiError(STALE, 409))
  render(
    <ToastProvider>
      <AccountsCard people={[ME]} />
    </ToastProvider>,
  )
  await screen.findByRole('table', { name: 'Net-worth accounts' })
  press('Fidelity Traditional 401(k)', ' ', 'ArrowUp', ' ')

  const toast = await screen.findByText(STALE)
  expect(toast.className).toBe('toast-message')
  await waitFor(() => expect(rowIds()).toEqual(['10', '11', '20', '21', '22', '41']))
  expect(vi.mocked(fetchAccounts)).toHaveBeenCalledTimes(2)
})

it('a reload still in flight when the order is saved cannot put the old order back', async () => {
  const reload = deferred<AccountOut[]>()
  vi.mocked(fetchAccounts).mockResolvedValueOnce(ROSTER).mockReturnValueOnce(reload.promise)
  render(<AccountsCard people={[ME]} />)
  await screen.findByRole('table', { name: 'Net-worth accounts' })

  // Saving an edit answers at once; the reload it starts is still on the wire when a row moves.
  fireEvent.click(screen.getByRole('button', { name: 'Edit Fidelity HSA' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save account' }))
  await waitFor(() => expect(vi.mocked(fetchAccounts)).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(grip('Fidelity HSA').getAttribute('aria-disabled')).toBeNull())
  press('Fidelity Traditional 401(k)', ' ', 'ArrowUp', ' ')
  await waitFor(() => expect(vi.mocked(reorderAccounts)).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(grip('Fidelity HSA').getAttribute('aria-disabled')).toBeNull())
  expect(rowIds()).toEqual(['10', '20', '21', '22', '11'])

  // The late answer describes the roster before the drop: it is dropped, not drawn.
  await act(async () => {
    reload.resolve(ROSTER)
  })
  expect(rowIds()).toEqual(['10', '20', '21', '22', '11'])
})

it('parks every grip while another request of the roster is in flight (spec §4.1 Busy)', async () => {
  const patch = deferred<AccountOut>()
  vi.mocked(fetchAccounts).mockResolvedValue(ROSTER)
  vi.mocked(updateAccount).mockReturnValue(patch.promise)
  render(<AccountsCard people={[ME]} />)
  await screen.findByRole('table', { name: 'Net-worth accounts' })
  expect(grip('Fidelity HSA').getAttribute('aria-disabled')).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'Retire Fidelity HSA' }))

  expect(grip('Fidelity HSA').getAttribute('aria-disabled')).toBe('true')
  expect(grip('Traditional pre-tax').getAttribute('aria-disabled')).toBe('true')
  // Parked, not disabled: the grip keeps its focus and lifts nothing.
  expect((grip('Fidelity HSA') as HTMLButtonElement).disabled).toBe(false)
  press('Fidelity Traditional 401(k)', ' ')
  expect(live()).toBe('')

  await act(async () => {
    patch.resolve({ ...HSA, is_active: false })
  })
  await waitFor(() => expect(grip('Fidelity HSA').getAttribute('aria-disabled')).toBeNull())
})
```

- [ ] **Step 5: Run them to see them fail**

Run: `npx vitest run src/components/settings/AccountsCard.test.tsx`
Expected: FAIL — 18 failed, 22 passed:
- the 16 new tests;
- the two tests edited in Step 3 (`closest('tr').className` is `''`; `rowIds()` is `[]`).

The failures read `Unable to find an accessible element with the role "button" and name "Reorder
…"`, `expected [] to deeply equal [ 'Cash', 'Pre-tax' ]` and `expected false to be true`.

- [ ] **Step 6: Replace `src/components/settings/AccountsCard.tsx` with**

```tsx
import { Fragment, useEffect, useRef, useState } from 'react'
import { ApiError, describeError, errorDetail } from '../../api/client'
import { undoBatch } from '../../api/lifecycle'
import {
  createAccount,
  deleteAccount,
  fetchAccounts,
  reorderAccounts,
  updateAccount,
} from '../../api/netWorth'
import { fetchPortfolioAccounts, patchPortfolioAccount } from '../../api/portfolio'
import { GROUP_LABELS, GROUP_ORDER } from '../../charts/theme'
import type {
  AccountGroup,
  AccountOut,
  PersonOut,
  PortfolioAccountOut,
} from '../../types/api'
import { nestComponents } from '../../utils/accounts'
import InfoHint from '../InfoHint'
import DragHandle from '../reorder/DragHandle'
import { ReorderInstructions, ReorderLiveRegion } from '../reorder/ReorderStatus'
import type { ReorderItem } from '../reorder/reorderMath'
import { useReorder } from '../reorder/useReorder'
import { useToast } from '../ToastProvider'
import { FeedBanner } from '../shell/Feed'
import '../panels.css'
import './settings.css'
import SettingsGhost from './SettingsGhost'
import { WARM, warmSource } from './settingsPrefetch'

interface AccountFormState {
  name: string
  group: AccountGroup
  person_id: string
  parent_account_id: string
  is_component: boolean
}

const EMPTY_ACCOUNT: AccountFormState = {
  name: '',
  group: 'cash',
  person_id: '',
  parent_account_id: '',
  is_component: false,
}

// The two sentences lane B's 422 returns for a half-set pair (2026-09-04 honest-numbers spec
// §5), spelled here so the client refusal and the server refusal are ONE sentence rather than
// two paraphrases. `is_component` is the rollup key and `parent_account_id` the link: a row
// carrying one without the other counts in no total, so each message names the missing half.
const COMPONENT_NEEDS_PARENT =
  'is_component needs parent_account_id — name the account it folds into'
const PARENT_NEEDS_COMPONENT =
  'parent_account_id needs is_component — a linked account must be a component'

// grip · Account · Owner · Roll-up · Status · actions — a group heading spans all six.
const ROSTER_COLUMNS = 6

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

// errorDetail's reason with any closing stop folded away: the two sentences below end on their
// own (describeLoadFailures' rule in client.ts).
function reason(err: unknown): string {
  return errorDetail(err).replace(/[.\s]+$/, '')
}

/** A drop the server did not take (2026-09-23 reorder spec §8.1), said once the rows have
 *  already snapped back. A 409 never reaches this: its own sentence is shown verbatim. */
function orderSaveFailed(err: unknown): string {
  return `Couldn't save the new order — ${reason(err)}. The list is back to how it was.`
}

/** A refused Undo is the server's own sentence ("Later changes touched these rows — undo those
 *  first", spec §9); a request that got no answer at all says what failed and why. */
function undoFailed(err: unknown): string {
  return err instanceof ApiError && err.status >= 400 && err.status < 500
    ? err.message
    : `Couldn't undo the move — ${reason(err)}.`
}

/** One drag unit of the roster (2026-09-23 reorder spec §4.2): a top-level account and the
 *  components nested under it, which travel with it and move only among themselves. */
interface RosterUnit {
  account: AccountOut
  components: AccountOut[]
  /** nestComponents could not place it — its parent is itself nested (a chain) or the link
   *  loops back (a cycle). Kept at the END of its group with a grip that has nowhere to go:
   *  the roster is where that link gets fixed, and the order PUT must name every account. */
  unplaced: boolean
}

interface RosterGroup {
  group: AccountGroup
  units: RosterUnit[]
}

/**
 * The roster the way the Monthly update walks it (spec §4.2): one block per non-empty group in
 * GROUP_ORDER, API order inside it, components nested under their parent by nestComponents run
 * PER GROUP — so a component whose parent sits in another group stays top-level in its own
 * (nestComponents' contract for an absent parent), and one whose parent is retired stays
 * nested, because a retired parent is still listed here.
 */
function rosterGroups(accounts: AccountOut[]): RosterGroup[] {
  return GROUP_ORDER.flatMap((group) => {
    const members = accounts.filter((account) => account.group === group)
    if (members.length === 0) return []
    const present = new Set(members.map((account) => account.id))
    const units: RosterUnit[] = []
    for (const account of nestComponents(members)) {
      // nestComponents emits each parent followed by its nested components, so a nested row
      // always belongs to the unit opened just before it.
      const nested = account.parent_account_id !== null && present.has(account.parent_account_id)
      const carrier = units.at(-1)
      if (nested && carrier !== undefined) carrier.components.push(account)
      else units.push({ account, components: [], unplaced: false })
    }
    const placed = new Set(
      units.flatMap((unit) => [unit.account.id, ...unit.components.map((c) => c.id)]),
    )
    for (const account of members) {
      if (!placed.has(account.id)) units.push({ account, components: [], unplaced: true })
    }
    return [{ group, units }]
  })
}

/**
 * The Settings Accounts card (2026-08-26 spec §6): the roster manager the app has never
 * had. The backend CRUD has existed since Plan 3 with no caller, which is exactly why
 * "net worth accounts are fixed by the workbook" was true (audit §3.1) — and why partner
 * accounts were unreachable without curl.
 *
 * `people` arrives as a prop from the page rather than from a second /household fetch, so
 * a partner added in the Household card is selectable here without a reload.
 *
 * The roster is grouped and its order is the table's (2026-09-23 reorder spec §4.2): a row is
 * dragged by its grip within its group, a parent brings its components, and the drop saves the
 * WHOLE order in one PUT with the change log's Undo behind it.
 */
export default function AccountsCard({ people }: { people: PersonOut[] }) {
  const [accounts, setAccounts] = useState<AccountOut[]>([])
  const [loaded, setLoaded] = useState(false)
  const [settled, setSettled] = useState(false) // both mount fetches answered, either way
  // Two slots, because they have two different answers (2026-09-05 motion spec §9): a load
  // failure is fixed by asking again; a refused save or a typo is not.
  const [loadError, setLoadError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<AccountFormState>(EMPTY_ACCOUNT)
  // A drop renders its order AT ONCE; the order is retired the moment the server's rows land —
  // CategoriesPanel's adjust-during-render recipe, not an effect (spec §4.2).
  const [pendingOrder, setPendingOrder] = useState<AccountOut[] | null>(null)
  const [lastAccounts, setLastAccounts] = useState(accounts)
  const seqRef = useRef(0)
  // The portfolio labels get their OWN fetch, error slot, busy flag and seq guard —
  // deliberately not folded into the roster's above. Two tables from two routers, and one
  // being down must not empty the other (SystemCard's per-card posture).
  const [portfolioAccounts, setPortfolioAccounts] = useState<PortfolioAccountOut[]>([])
  const [portfolioLoaded, setPortfolioLoaded] = useState(false)
  const [portfolioError, setPortfolioError] = useState<string | null>(null)
  // The roster's loadError/formError split, for the second feed: a retag the server
  // REFUSED is not fixed by asking for the labels again (2026-09-05 motion spec §9).
  const [portfolioFormError, setPortfolioFormError] = useState<string | null>(null)
  const [portfolioBusy, setPortfolioBusy] = useState(false)
  const portfolioSeqRef = useRef(0)
  const toast = useToast()

  if (lastAccounts !== accounts) {
    setLastAccounts(accounts)
    setPendingOrder(null)
  }

  const load = (initial = false) => {
    const seq = ++seqRef.current
    return warmSource(initial)(WARM.accounts, fetchAccounts)
      .then((rows) => {
        if (seq !== seqRef.current) return
        setAccounts(rows)
        setLoadError(null)
        setLoaded(true)
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        setLoadError(describeError(err, 'the accounts'))
      })
  }

  const loadPortfolio = (initial = false) => {
    const seq = ++portfolioSeqRef.current
    return warmSource(initial)(WARM.portfolioAccounts, fetchPortfolioAccounts)
      .then((rows) => {
        if (seq !== portfolioSeqRef.current) return
        setPortfolioAccounts(rows)
        setPortfolioError(null)
        setPortfolioLoaded(true)
      })
      .catch((err: unknown) => {
        if (seq !== portfolioSeqRef.current) return
        setPortfolioError(describeError(err, 'the portfolio accounts'))
      })
  }

  // ON CHANGE, one field on the wire — the card's toggleActive idiom. person_id is the only
  // column this control owns (labels are immutable server-side this batch), and the value
  // travels EXPLICITLY: an omitted key means "leave the owner alone", so clearing the
  // select has to send null on purpose.
  const retagPortfolioAccount = (account: PortfolioAccountOut, value: string) => {
    setPortfolioBusy(true)
    setPortfolioFormError(null)
    patchPortfolioAccount(account.id, { person_id: value === '' ? null : Number(value) })
      .then(() => loadPortfolio())
      .catch((err: unknown) => setPortfolioFormError(message(err, 'Could not retag the account.')))
      .finally(() => setPortfolioBusy(false))
  }

  useEffect(() => {
    // ONE render when both feeds have SETTLED (2026-09-13 spec §9): the card used to grow twice —
    // the roster landing 76ms before the portfolio labels pushed the second table 1118px down the
    // page (audit S-5). Settled, not fulfilled: a feed that failed still lets the other render.
    void Promise.allSettled([load(true), loadPortfolio(true)]).then(() => setSettled(true))
    // mount-only: two plain functions over stable setters (house idiom)
  }, [])

  const setText =
    (field: 'name' | 'person_id' | 'parent_account_id') => (value: string) => {
      setForm((f) => ({ ...f, [field]: value }))
      setFormError(null)
    }

  const startEdit = (account: AccountOut) => {
    setEditingId(account.id)
    setFormError(null)
    setForm({
      name: account.name,
      group: account.group,
      person_id: account.person_id === null ? '' : String(account.person_id),
      parent_account_id:
        account.parent_account_id === null ? '' : String(account.parent_account_id),
      is_component: account.is_component,
    })
  }

  const cancelEdit = () => {
    setEditingId(null)
    setForm(EMPTY_ACCOUNT)
  }

  const submit = () => {
    const name = form.name.trim()
    if (!name) {
      setFormError('Account name is required.')
      return
    }
    if (form.is_component && form.parent_account_id === '') {
      setFormError(COMPONENT_NEEDS_PARENT)
      return
    }
    if (!form.is_component && form.parent_account_id !== '') {
      setFormError(PARENT_NEEDS_COMPONENT)
      return
    }
    // ALL FIVE keys, every time: a blank owner or parent must CLEAR the column, and PATCH
    // treats an omitted key as "leave it alone" — only an explicit null retags an account
    // to joint or unlinks a component. Never sort_order (2026-09-23 reorder spec §3.3, §4.2):
    // the order is the table's, a new account lands at the end of its group, and an edit that
    // moves an account to another group lands it at the end of that one — the server's call.
    const body = {
      name,
      group: form.group,
      is_component: form.is_component,
      person_id: form.person_id === '' ? null : Number(form.person_id),
      parent_account_id: form.parent_account_id === '' ? null : Number(form.parent_account_id),
    }
    setBusy(true)
    setFormError(null)
    const request = editingId !== null ? updateAccount(editingId, body) : createAccount(body)
    request
      .then(() => {
        cancelEdit()
        load()
      })
      .catch((err: unknown) => setFormError(message(err, 'Save failed')))
      .finally(() => setBusy(false))
  }

  // ONLY is_active on the wire: every other column is untouched here, and sending the
  // whole row back would let a stale render overwrite a concurrent edit (CardsPanel's rule).
  const toggleActive = (account: AccountOut) => {
    setBusy(true)
    setFormError(null)
    updateAccount(account.id, { is_active: !account.is_active })
      .then(() => load())
      .catch((err: unknown) => setFormError(message(err, 'Update failed')))
      .finally(() => setBusy(false))
  }

  const remove = (account: AccountOut) => {
    setBusy(true)
    // The guard sentence belongs to the SERVER ("account has N balance rows — deactivate it
    // instead") and it is about a row far down the table, so it rides the toast layer
    // rather than the form-level banner above the form.
    deleteAccount(account.id)
      .then(() => {
        if (account.id === editingId) cancelEdit()
        load()
      })
      .catch((err: unknown) => toast.error(message(err, 'Delete failed')))
      .finally(() => setBusy(false))
  }

  const ownerName = new Map(people.map((p) => [p.id, p.name]))
  const byId = new Map(accounts.map((a) => [a.id, a]))
  // How many rows roll UP into each account, by the SERVER's rule rather than a looser one:
  // `derived_parent_balances` (backend/app/services/derived_accounts.py) sums a child only
  // when it is flagged `is_component` AND linked, so a legacy row carrying the link alone is
  // derived by nobody. Counting that row here would tell the reader a parent is summed while
  // the balances PUT still expects it typed by hand and the wizard still renders it as an
  // input — the roster must not promise a roll-up nothing performs (spec §5).
  const componentCounts = new Map<number, number>()
  for (const a of accounts) {
    if (a.parent_account_id === null || !a.is_component) continue
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
  // An account may not parent itself (the server 422s it); leaving it out of the select
  // means the UI never offers the mistake.
  const parentOptions = accounts.filter((a) => a.id !== editingId)
  // Named in the hint below: the get-or-create on a new transaction label owns it to the
  // primary person, and this table is the only place that can be undone.
  const primaryName = people.find((p) => p.is_primary)?.name ?? 'the primary person'

  // What the table draws: the dropped order while its save is in flight, else the server's.
  const shown = pendingOrder ?? accounts
  const groups = rosterGroups(shown)
  // The hook's items, in DISPLAY order (reorder spec §2.2): a top-level account ranges over its
  // group and carries its components; a component ranges over its siblings only.
  const items: ReorderItem<number>[] = groups.flatMap(({ group, units }) =>
    units.flatMap(({ account, components, unplaced }) => [
      {
        id: account.id,
        range: unplaced ? `unplaced:${account.id}` : group,
        carries: components.map((component) => component.id),
      },
      ...components.map((component) => ({ id: component.id, range: `parent:${account.id}` })),
    ]),
  )

  // The reorder route logs its batch (spec §3.2), so Undo is the change log's: the server
  // writes every renumbered row back, then the roster is read again.
  const undoOrder = (batchId: string) => {
    setBusy(true)
    undoBatch(batchId)
      .then(() => {
        load()
        toast.info('Order restored')
      })
      .catch((err: unknown) => toast.error(undoFailed(err)))
      .finally(() => setBusy(false))
  }

  // One PUT with EVERY account — active and retired, every group — in the new display order
  // (spec §4.2). Its outcome is about a row far down the table, so it rides the toast layer,
  // never the form banner (remove's rule above).
  const saveOrder = (ids: number[], moved: number) => {
    const name = byId.get(moved)?.name ?? 'the account'
    // A reload already on the wire describes the order BEFORE this drop; its answer must not
    // land on top of the one this save brings back (load's seq guard drops it).
    seqRef.current += 1
    setBusy(true)
    reorderAccounts(ids)
      .then(({ data, batchId }) => {
        setAccounts(data)
        reorder.markSaved(moved)
        toast.success(
          `Moved ${name}`,
          // No batch = nothing was logged, so there is nothing to undo (the wizard's contract).
          batchId === null
            ? undefined
            : { action: { label: 'Undo', onAction: () => undoOrder(batchId) } },
        )
      })
      .catch((err: unknown) => {
        setPendingOrder(null) // back to the last order the server confirmed
        if (err instanceof ApiError && err.status === 409) {
          // The roster changed under this one (another tab): the server's sentence, then the
          // current rows (spec §8.3).
          toast.error(err.message)
          load()
          return
        }
        toast.error(orderSaveFailed(err))
      })
      .finally(() => setBusy(false))
  }

  const reorder = useReorder({
    items,
    labelOf: (id) => byId.get(id)?.name ?? String(id),
    // "…Position 2 of 3 in Pre-tax." / "…in Fidelity Traditional 401(k)'s components." (§8.2)
    rangeLabelOf: (range) => {
      if (range.startsWith('parent:')) {
        const parent = byId.get(Number(range.slice('parent:'.length)))
        return parent === undefined ? undefined : `${parent.name}'s components`
      }
      const group = GROUP_ORDER.find((candidate) => candidate === range)
      return group === undefined ? undefined : GROUP_LABELS[group]
    },
    // Every request of the roster parks the grips: a drop cannot race a save (spec §9).
    disabled: busy,
    onCommit: (next, moved) => {
      // `next` is the whole roster flattened group by group, each parent followed by its
      // components — exactly the order the PUT sends.
      const rowsById = new Map(shown.map((account) => [account.id, account]))
      setPendingOrder(
        next.flatMap((id) => {
          const account = rowsById.get(id)
          return account === undefined ? [] : [account]
        }),
      )
      saveOrder(next, moved)
    },
  })

  /** One roster row. `nested` rows are components drawn under their parent: panels.css's
   *  `.component-row` register, with the indent moved to the Account cell (settings.css). */
  const rosterRow = (account: AccountOut, nested: boolean) => {
    const classes = [nested ? 'component-row' : null, account.id === editingId ? 'is-editing' : null]
      .filter((name) => name !== null)
      .join(' ')
    return (
      <tr
        key={account.id}
        className={classes === '' ? undefined : classes}
        {...reorder.itemProps(account.id)}
      >
        <td className="reorder-grip-cell">
          <DragHandle name={account.name} {...reorder.handleProps(account.id)} />
        </td>
        <td className="accounts-name-cell">
          {account.name}
          {account.is_component && <span className="badge">Component</span>}
        </td>
        {/* NULL is JOINT, never "unknown": the migration backfilled every pre-existing
            account to the primary person. */}
        <td>
          {account.person_id === null ? 'Joint' : (ownerName.get(account.person_id) ?? '—')}
        </td>
        <td>{rollUpNote(account)}</td>
        <td>
          <span className="badge">{account.is_active ? 'Active' : 'Retired'}</span>
        </td>
        <td className="row-actions">
          <button
            type="button"
            className="button"
            aria-label={`Edit ${account.name}`}
            disabled={busy}
            onClick={() => startEdit(account)}
          >
            Edit
          </button>
          <button
            type="button"
            className="button"
            aria-label={account.is_active ? `Retire ${account.name}` : `Restore ${account.name}`}
            disabled={busy}
            onClick={() => toggleActive(account)}
          >
            {account.is_active ? 'Retire' : 'Restore'}
          </button>
          <button
            type="button"
            className="button"
            aria-label={`Delete ${account.name}`}
            disabled={busy}
            onClick={() => remove(account)}
          >
            Delete
          </button>
        </td>
      </tr>
    )
  }

  return (
    <section className="card span-12" id="accounts">
      <h2 className="eyebrow">
        Accounts
        <InfoHint text="The net-worth roster. Owner blank = joint. Retire keeps an account out of the wizard and the charts without losing its history; delete only works while an account has no balances. The slug never changes — it is the workbook importer's key." />
      </h2>
      <FeedBanner error={loadError} retry={() => load()} retryLabel="Retry loading the accounts" />
      {!settled && <SettingsGhost height={1045} />}
      {settled && loaded && (
        <>
          <form
            className="accounts-form"
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            <label>
              Account name
              <input
                className="field-input"
                value={form.name}
                onChange={(e) => setText('name')(e.target.value)}
              />
            </label>
            <label>
              Group
              <select
                className="field-input"
                value={form.group}
                onChange={(e) =>
                  setForm((f) => ({ ...f, group: e.target.value as AccountGroup }))
                }
              >
                {GROUP_ORDER.map((group) => (
                  <option key={group} value={group}>
                    {GROUP_LABELS[group]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Owner
              <select
                className="field-input"
                value={form.person_id}
                onChange={(e) => setText('person_id')(e.target.value)}
              >
                <option value="">Joint</option>
                {people.map((person) => (
                  <option key={person.id} value={String(person.id)}>
                    {person.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Parent account
              <select
                className="field-input"
                value={form.parent_account_id}
                onChange={(e) => setText('parent_account_id')(e.target.value)}
              >
                <option value="">— none —</option>
                {parentOptions.map((account) => (
                  <option key={account.id} value={String(account.id)}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="accounts-check">
              <input
                type="checkbox"
                checked={form.is_component}
                onChange={(e) => {
                  setForm((f) => ({ ...f, is_component: e.target.checked }))
                  setFormError(null)
                }}
              />
              Component of the parent
            </label>
            <div className="settings-card-actions">
              <button type="submit" className="button button-primary" disabled={busy}>
                {editingId !== null ? 'Save account' : 'Add account'}
              </button>
              {editingId !== null && (
                <button type="button" className="button" onClick={cancelEdit}>
                  Cancel
                </button>
              )}
            </div>
            <FeedBanner error={formError} />
          </form>
          {accounts.length === 0 ? (
            <p className="empty-note">No accounts yet — add the first one above.</p>
          ) : (
            <>
              <div className="settings-scroll">
                {/* Named because the card now carries TWO tables (screen readers and the
                    role queries both need to tell them apart). Grouped (reorder spec §4.2):
                    the heading row carries what the Group column used to say, and
                    `.reorder-table` gives each cell its own hairline so a moving row takes
                    its border with it (reorder.css). */}
                <table
                  className="data-table accounts-table reorder-table"
                  aria-label="Net-worth accounts"
                >
                  <thead>
                    <tr>
                      <th className="reorder-grip-cell" aria-hidden="true" />
                      <th>Account</th>
                      <th>Owner</th>
                      <th>Roll-up</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map(({ group, units }) => (
                      <Fragment key={group}>
                        <tr className="accounts-group-row">
                          <th scope="colgroup" colSpan={ROSTER_COLUMNS}>
                            {GROUP_LABELS[group]}
                          </th>
                        </tr>
                        {units.flatMap(({ account, components }) => [
                          rosterRow(account, false),
                          ...components.map((component) => rosterRow(component, true)),
                        ])}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Once per card and OUTSIDE the table (a <span> is not a table child): the
                  grips' aria-describedby target and the lift/move/drop announcements. */}
              <ReorderInstructions id={reorder.instructionsId} />
              <ReorderLiveRegion text={reorder.announcement} />
            </>
          )}
        </>
      )}

      {settled && (
        <>
        {/* Portfolio accounts (2026-08-28 spec §5): the labels behind the positions ledger,
            and the ONE place their ownership is edited. Gated on `settled`, never on the roster's
            `loaded` — a net-worth GET that failed says nothing about the portfolio router, and
            both tables arrive in the same render (2026-09-13 spec §9). */}
        <h3 className="eyebrow portfolio-accounts-heading">
          Portfolio accounts
          <InfoHint text="The account labels your transactions and dividends are filed under. Owner blank = joint; a person's Portfolio view is their own labels plus the joint ones. Labels are fixed here — they are the positions' identity." />
        </h3>
        <FeedBanner
          error={portfolioError}
          retry={() => loadPortfolio()}
          retryLabel="Retry loading the portfolio accounts"
        />
        {portfolioLoaded &&
          (portfolioAccounts.length === 0 ? (
            <p className="empty-note">
              No portfolio accounts yet — one appears the first time a transaction or dividend
              names an account.
            </p>
          ) : (
            <>
              <div className="settings-scroll">
                <table
                  className="data-table portfolio-accounts-table"
                  aria-label="Portfolio accounts"
                >
                  <thead>
                    <tr>
                      <th>Label</th>
                      <th>Owner</th>
                    </tr>
                  </thead>
                  <tbody>
                    {portfolioAccounts.map((account) => (
                      <tr key={account.id}>
                        {/* Read-only text, not an input: renaming a label would orphan every
                            position filed under it, and the server refuses it. */}
                        <td>{account.label}</td>
                        <td>
                          <select
                            className="field-input"
                            aria-label={`Owner for ${account.label}`}
                            value={account.person_id === null ? '' : String(account.person_id)}
                            disabled={portfolioBusy}
                            onChange={(e) => retagPortfolioAccount(account, e.target.value)}
                          >
                            <option value="">Joint</option>
                            {people.map((person) => (
                              <option key={person.id} value={String(person.id)}>
                                {person.name}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Inline under the table the select lives in, and with NO Retry: the failure is a
                  write the server refused, which asking for the labels again cannot fix. */}
              <FeedBanner error={portfolioFormError} />
              <p className="settings-note">
                A new account label typed on a transaction or dividend is created owned by{' '}
                {primaryName} — re-tag it here. The labels themselves are fixed: they identify
                the positions.
              </p>
            </>
          ))}
        </>
      )}
    </section>
  )
}
```

- [ ] **Step 7: Run them to see them pass**

Run: `npx vitest run src/components/settings/AccountsCard.test.tsx`
Expected: PASS — 40 tests.

If a nesting test fails, check two things:
- `rosterGroups` runs `nestComponents` on each group's members, not on the whole roster.
- `items` puts each unit's components right after it, with `range: 'parent:<id>'`.

- [ ] **Step 8: The neighbours still pass**

Run: `npx vitest run src/pages/SettingsPage.test.tsx src/guide src/components/settings`
Expected: PASS.

- [ ] **Step 9: Type-check, lint, commit**

```bash
npx tsc -b && npx eslint src/components/settings/AccountsCard.tsx src/components/settings/AccountsCard.test.tsx
git add src/components/settings/AccountsCard.tsx src/components/settings/AccountsCard.test.tsx
git commit -m "feat(settings): the accounts roster, grouped and reorderable — parents carry their components, one PUT, Undo"
```

---

### Task 6: Accounts — row buttons wait during a lift; the order note and the drag hint (spec §2.3, §4.2, §8.1)

**Files:**
- Modify: `src/components/settings/AccountsCard.tsx`:
  - the roster's `<InfoHint text=…>`;
  - a note after `<ReorderLiveRegion …/>`;
  - the `rosterRow` block.
- Test: `src/components/settings/AccountsCard.test.tsx` — 2 tests appended

- [ ] **Step 1: Append the failing tests**

Append at the end of `AccountsCard.test.tsx`:

```tsx
it('holds every roster button while a row is lifted — the portfolio labels stay live', async () => {
  vi.mocked(fetchAccounts).mockResolvedValue(ROSTER)
  render(<AccountsCard people={[ME]} />)
  await screen.findByRole('table', { name: 'Net-worth accounts' })
  const edit = () => screen.getByRole('button', { name: 'Edit Traditional pre-tax' }) as HTMLButtonElement

  press('Fidelity HSA', ' ')
  expect(edit().disabled).toBe(true)
  expect((screen.getByRole('button', { name: 'Delete Fidelity HSA' }) as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByRole('button', { name: 'Retire Joint Checking' }) as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByLabelText('Owner for Fidelity Brokerage') as HTMLSelectElement).disabled).toBe(false)

  press('Fidelity HSA', 'Escape')
  expect(live()).toBe('Cancelled. Fidelity HSA is back at position 1 of 2.')
  expect(edit().disabled).toBe(false)
})

it('says what the order is for and how to change it (spec §8.1)', async () => {
  render(<AccountsCard people={[ME]} />)
  const table = await screen.findByRole('table', { name: 'Net-worth accounts' })

  const note = screen.getByText(
    'The Monthly update lists accounts in this order within each person and group — a spreadsheet column pasted there fills them in this order too.',
  )
  // Under the roster, above the Portfolio accounts heading.
  expect(table.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  const labelsHeading = document.querySelector('.portfolio-accounts-heading') as HTMLElement
  expect(note.compareDocumentPosition(labelsHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /^About The net-worth roster/ }))
  expect(screen.getByRole('tooltip').textContent).toContain(
    'Drag a row by its grip to reorder accounts within their group; a parent brings its components with it.',
  )
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/components/settings/AccountsCard.test.tsx`
Expected: FAIL — 2 failed, 40 passed:
- `holds every roster button…`: `expected false to be true`;
- `says what the order is for…`: `Unable to find an element with the text: The Monthly update
  lists accounts…`.

- [ ] **Step 3: Implement**

(a) The roster's InfoHint — replace

```tsx
        <InfoHint text="The net-worth roster. Owner blank = joint. Retire keeps an account out of the wizard and the charts without losing its history; delete only works while an account has no balances. The slug never changes — it is the workbook importer's key." />
```

with (spec §8.1, appended sentence)

```tsx
        <InfoHint text="The net-worth roster. Owner blank = joint. Retire keeps an account out of the wizard and the charts without losing its history; delete only works while an account has no balances. The slug never changes — it is the workbook importer's key. Drag a row by its grip to reorder accounts within their group; a parent brings its components with it." />
```

(b) The order note, under the roster — replace

```tsx
              <ReorderInstructions id={reorder.instructionsId} />
              <ReorderLiveRegion text={reorder.announcement} />
            </>
          )}
```

with

```tsx
              <ReorderInstructions id={reorder.instructionsId} />
              <ReorderLiveRegion text={reorder.announcement} />
              {/* What the order is FOR (2026-09-23 reorder spec §8.1): the wizard walks it inside
                  each person's section, and a positional paste fills it — so moving a row here
                  moves where a pasted value lands. */}
              <p className="settings-note">
                The Monthly update lists accounts in this order within each person and group — a
                spreadsheet column pasted there fills them in this order too.
              </p>
            </>
          )}
```

(c) Replace the `rosterRow` block. Its Task 5 text starts at `  /** One roster row.` and ends at the
closing `  }` right before `  return (`. The new block:

```tsx
  // A lifted row holds the roster: the row buttons wait for the drop, as they wait for a request
  // (spec §2.3) — an Edit or a Delete must not land on a row that is in the air.
  const locked = busy || reorder.active

  /** One roster row. `nested` rows are components drawn under their parent: panels.css's
   *  `.component-row` register, with the indent moved to the Account cell (settings.css). */
  const rosterRow = (account: AccountOut, nested: boolean) => {
    const classes = [nested ? 'component-row' : null, account.id === editingId ? 'is-editing' : null]
      .filter((name) => name !== null)
      .join(' ')
    return (
      <tr
        key={account.id}
        className={classes === '' ? undefined : classes}
        {...reorder.itemProps(account.id)}
      >
        <td className="reorder-grip-cell">
          <DragHandle name={account.name} {...reorder.handleProps(account.id)} />
        </td>
        <td className="accounts-name-cell">
          {account.name}
          {account.is_component && <span className="badge">Component</span>}
        </td>
        {/* NULL is JOINT, never "unknown": the migration backfilled every pre-existing
            account to the primary person. */}
        <td>
          {account.person_id === null ? 'Joint' : (ownerName.get(account.person_id) ?? '—')}
        </td>
        <td>{rollUpNote(account)}</td>
        <td>
          <span className="badge">{account.is_active ? 'Active' : 'Retired'}</span>
        </td>
        <td className="row-actions">
          <button
            type="button"
            className="button"
            aria-label={`Edit ${account.name}`}
            disabled={locked}
            onClick={() => startEdit(account)}
          >
            Edit
          </button>
          <button
            type="button"
            className="button"
            aria-label={account.is_active ? `Retire ${account.name}` : `Restore ${account.name}`}
            disabled={locked}
            onClick={() => toggleActive(account)}
          >
            {account.is_active ? 'Retire' : 'Restore'}
          </button>
          <button
            type="button"
            className="button"
            aria-label={`Delete ${account.name}`}
            disabled={locked}
            onClick={() => remove(account)}
          >
            Delete
          </button>
        </td>
      </tr>
    )
  }
```

(The only change from Task 5 is the `locked` line and `disabled={locked}` on the three buttons.)

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run src/components/settings/AccountsCard.test.tsx`
Expected: PASS — 42 tests.

- [ ] **Step 5: Type-check, lint, commit**

```bash
npx tsc -b && npx eslint src/components/settings/AccountsCard.tsx src/components/settings/AccountsCard.test.tsx
git add src/components/settings/AccountsCard.tsx src/components/settings/AccountsCard.test.tsx
git commit -m "feat(settings): accounts — row buttons wait during a lift; the order note and the drag hint"
```

---

### Task 7: The two tables' styles (spec §2.5, §4.2)

**Files:**
- Modify: `src/components/settings/settings.css` — append a section at the end (additive; no
  existing rule changes)
- Test: `src/components/settings/settingsCss.test.ts` — 4 tests inserted before the closing `})`

jsdom computes no cascade, so each rule that must outrank panels.css is pinned selector and all.
Specificities:
- `.settings-scroll .reorder-table` (0,2,0) beats `.data-table` (0,1,0), which otherwise ties
  `.reorder-table`.
- The heading and indent rules (0,4,2) beat panels.css's `th:last-child` sticky rule and
  `tr.component-row td:first-child` (0,3,2 each).
- The Actions-cell rules (0,4,2) beat `.data-table td.row-actions` (0,2,1).

- [ ] **Step 1: Insert the failing tests**

In `settingsCss.test.ts`, replace the file's last three lines

```ts
    expect(declarationsFor(settings, '.feed-fresh label')).toContain('max-width: none;')
  })
})
```

with

```ts
    expect(declarationsFor(settings, '.feed-fresh label')).toContain('max-width: none;')
  })

  // Drag to reorder (2026-09-23 reorder spec §4). jsdom computes no cascade, so the rules that
  // must OUTRANK panels.css are pinned here, selector and all.
  it('pins the separate border model on the reorderable tables — .data-table ties .reorder-table', () => {
    const table = declarationsFor(settings, '.settings-scroll .reorder-table')
    expect(table).toContain('border-collapse: separate;')
    expect(table).toContain('border-spacing: 0;')
  })

  it('draws an Accounts group heading as a heading, not as a sticky row-actions cell', () => {
    const heading = declarationsFor(
      settings,
      ".data-table.accounts-table tr.accounts-group-row > th[scope='colgroup']",
    )
    expect(heading).toContain('position: static;')
    expect(heading).toContain('box-shadow: none;')
    expect(heading).toContain('padding-top: 0.9rem;')
  })

  it('moves the component indent off the grip cell and onto the Account cell', () => {
    expect(
      declarationsFor(settings, '.data-table.accounts-table tr.component-row > td.reorder-grip-cell'),
    ).toContain('padding: var(--density-cell-pad);')
    const name = declarationsFor(
      settings,
      '.data-table.accounts-table tr.component-row > td.accounts-name-cell',
    )
    expect(name).toContain('padding-left: 1.6rem;')
    expect(name).toContain('color: var(--muted);')
  })

  it("lifts the sticky Actions cell with its row and runs the drop line through it, keeping the cell's own hairline", () => {
    const lifted = declarationsFor(
      settings,
      ".settings-scroll .reorder-table tr[data-reorder='lifted'] > td.row-actions",
    )
    expect(lifted).toContain('background: var(--surface-2);')
    expect(lifted).toContain('-1px 0 0 var(--border),')
    expect(lifted).toContain('inset 0 1px 0 var(--border),')
    expect(lifted).toContain('inset 0 -1px 0 var(--border);')
    const before = declarationsFor(
      settings,
      ".settings-scroll .reorder-table tr[data-reorder-drop='before'] > td.row-actions",
    )
    expect(before).toContain('-1px 0 0 var(--border),')
    expect(before).toContain('inset 0 2px 0 var(--accent);')
    const after = declarationsFor(
      settings,
      ".settings-scroll .reorder-table tr[data-reorder-drop='after'] > td.row-actions",
    )
    expect(after).toContain('-1px 0 0 var(--border),')
    expect(after).toContain('inset 0 -2px 0 var(--accent);')
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/components/settings/settingsCss.test.ts`
Expected: FAIL — 4 failed, 2 passed, each with `no .settings-scroll .reorder-table block`,
`no .data-table.accounts-table tr.accounts-group-row > th[scope='colgroup'] block`, …

- [ ] **Step 3: Append to `src/components/settings/settings.css`**

```css
/* --- drag to reorder: the Accounts and Spending categories tables (2026-09-23 reorder spec §4) --- */

/* panels.css's `.data-table { border-collapse: collapse }` ties reorder.css's `.reorder-table` on
   specificity (0,1,0 each), which would leave the winner to the production CSS chunk order. The
   separate model is what lets a moving row take its hairline with it (spec §0.11, §2.5), so it is
   pinned here under a scope that outranks both (0,2,0). */
.settings-scroll .reorder-table {
  border-collapse: separate;
  border-spacing: 0;
}

/* The Accounts table is grouped (spec §4.2): one heading row per non-empty group carries what the
   Group column used to say, in the Monthly update's register (.entry-group-row: the column
   headers' type with a 0.9rem lead-in). panels.css pins a row-actions table's `th:last-child`
   sticky with a hairline (0,3,2) — and this full-width heading is its row's last child — so two
   classes and the attribute here (0,4,2) put it back in the flow without leaning on sheet order. */
.data-table.accounts-table tr.accounts-group-row > th[scope='colgroup'] {
  position: static;
  box-shadow: none;
  padding-top: 0.9rem;
}

/* The grip column comes first now, so panels.css's component indent (`tr.component-row
   td:first-child`, 0,3,2) would land on the grip. The grip cell gets the plain cell padding back,
   and the indent — with its muted name — moves to the Account cell (spec §4.2). */
.data-table.accounts-table tr.component-row > td.reorder-grip-cell {
  padding: var(--density-cell-pad);
}

.data-table.accounts-table tr.component-row > td.accounts-name-cell {
  padding-left: 1.6rem;
  color: var(--muted);
}

/* A lifted row — and the reduced-motion drop line — must reach the sticky Actions cell too:
   panels.css's `.data-table td.row-actions` (0,2,1) paints that cell's own background and hairline
   and outranks reorder.css's row states (0,1,2), which would leave the Actions cell unlifted and
   stop the drop line short of it. The cell's own -1px hairline leads every list here, so it stays
   as it is (spec §2.5). */
.settings-scroll .reorder-table tr[data-reorder='lifted'] > td.row-actions {
  background: var(--surface-2);
  box-shadow:
    -1px 0 0 var(--border),
    inset 0 1px 0 var(--border),
    inset 0 -1px 0 var(--border);
}

.settings-scroll .reorder-table tr[data-reorder-drop='before'] > td.row-actions {
  box-shadow:
    -1px 0 0 var(--border),
    inset 0 2px 0 var(--accent);
}

.settings-scroll .reorder-table tr[data-reorder-drop='after'] > td.row-actions {
  box-shadow:
    -1px 0 0 var(--border),
    inset 0 -2px 0 var(--accent);
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run src/components/settings/settingsCss.test.ts src/theme/motion.test.ts src/components/surfaceGrammar.test.ts`
Expected: PASS. The first file now has 6 tests. `motion.test.ts` sweeps every stylesheet for
literal durations; this section has none.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/settings.css src/components/settings/settingsCss.test.ts
git commit -m "feat(settings): reorder table styles — the border model pinned, the group heading, the component indent on the name, the lifted Actions cell"
```

---

### Task 8: The lane's gates

**Files:** none (verification only). Record every result in "Results".

- [ ] **Step 1: The lane's files**

Run: `npx vitest run src/components/settings src/pages/SettingsPage.test.tsx src/guide src/components/reorder`
Expected: PASS — `CategoriesCard.test.tsx` 27, `AccountsCard.test.tsx` 42, `settingsCss.test.ts` 6.

- [ ] **Step 2: The full frontend suite**

Run: `npx vitest run`
Expected: exit 0. Record the file and test counts.

If a file this lane never touched fails, run the same file in `.worktrees/reorder-base` (its
`node_modules` symlink exists) to show the failure is pre-existing, and record both runs.

- [ ] **Step 3: Types, lint, build**

Run: `npx tsc -b && npx eslint . && npm run build`
Expected: all three exit 0. `eslint .` reports no warning in the files this lane touched.

- [ ] **Step 4: Scope check**

Run: `git diff --stat feat/reorder-base...HEAD`
Expected: exactly
- `src/components/settings/AccountsCard.tsx`;
- `src/components/settings/AccountsCard.test.tsx`;
- `src/components/settings/CategoriesCard.tsx`;
- `src/components/settings/CategoriesCard.test.tsx`;
- `src/components/settings/settings.css`;
- `src/components/settings/settingsCss.test.ts`;
- `src/guide/content/pages-planning.tsx`.

Nothing under `src/api`, `src/types` or `src/components/reorder` changes (spec §4.3: "they add no
`src/api` code of their own").

---

### Task 9: The browser check — real Edge, real pointer, the private database (spec §10)

**Files:** `scratchpad/reorder-r2/smoke.mjs` (gitignored, never committed). The PNGs and
`report.json` land beside it.

The walk writes only through the lane's own servers: vite on 5192 proxying to uvicorn on 8092, which
serves `finance_reorder_r2`. The script refuses any other pair. It PUTs both orders back to how it
found them before it exits.

- [ ] **Step 1: The database is migrated**

Run:

```bash
docker exec finance-dashboard-db-1 psql -U finance -d finance_reorder_r2 -tAc "SELECT (SELECT count(*) FROM accounts), (SELECT count(*) FROM spending_categories), (SELECT version_num FROM alembic_version)"
```

Expected: `29|19|f12026092301`.

If the version is still `f12026091203`, run the controller's migration commands ("Controller
prerequisites" step 4) — they touch only `finance_reorder_r2`. If the database is missing, stop and
ask the controller.

- [ ] **Step 2: Start the lane's backend (leave it running in the background)**

```bash
cd /c/Users/edyli/personal-finance-dashboard/.worktrees/reorder-r2/backend && DATABASE_URL=postgresql+asyncpg://finance:finance@localhost:5433/finance_reorder_r2 SCHEDULER_ENABLED=0 SNAPSHOT_ENABLED=0 /c/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8092
```

Check: `curl -s http://127.0.0.1:8092/api/v1/health` prints `{"status":"ok"}`.

- [ ] **Step 3: Start the lane's vite (leave it running in the background)**

```bash
cd /c/Users/edyli/personal-finance-dashboard/.worktrees/reorder-r2 && VITE_API_PROXY=http://127.0.0.1:8092 npx vite --port 5192 --strictPort
```

Check: `curl -s -o /dev/null -w '%{http_code}' http://localhost:5192/` prints `200`.

- [ ] **Step 4: The dev credentials work on the copy**

```bash
curl -s http://127.0.0.1:8092/api/v1/auth/login -H 'content-type: application/json' -d '{"email":"admin@example.com","password":"changeme123"}'
```

Expected: a JSON body with `access_token`.

On a 401, reset the password on the PRIVATE copy only, then retry:

```bash
cd /c/Users/edyli/personal-finance-dashboard/.worktrees/reorder-r2/backend
HASH=$(/c/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe -c "from app.security import hash_password; print(hash_password('changeme123'))")
docker exec finance-dashboard-db-1 psql -U finance -d finance_reorder_r2 -c "UPDATE users SET password_hash = '$HASH' WHERE email = 'admin@example.com'"
```

- [ ] **Step 5: Write `scratchpad/reorder-r2/smoke.mjs`**

The launch boilerplate is `tools/probes/sandbox-v/smoke.mjs`'s:
- the node-version spoof;
- playwright-core from the npx cache (`PLAYWRIGHT_CORE` overrides; 1.62.1 lives at the default
  path on this box);
- Edge at `EDGE_PATH`;
- the theme injected into `GET /prefs`.

```js
// scratchpad/reorder-r2/smoke.mjs — lane R2's browser check (2026-09-23 drag-to-reorder spec §4,
// §10; plan docs/superpowers/plans/2026-09-23-reorder-r2-settings.md Task 10). Gitignored, never
// committed. It WRITES — reorder PUTs and change-log undos — so it refuses to run against anything
// but the lane's own pair of servers: vite on 5192 proxying to uvicorn on 8092, which serves the
// PRIVATE database finance_reorder_r2. Both orders are PUT back to how they were found at the end.
//
// In both themes at 1280 and 1600 it proves, in real Edge with real pointer events:
//   1. both Settings tables use the separate border model (.reorder-table outranks .data-table);
//   2. Categories: a mouse drag across three rows — the lifted row follows the pointer, three
//      peers make room, the row lands where the gap was, a toast names it and its Undo puts the
//      order back; the same drag again survives a reload;
//   3. Categories: the keyboard path (focus the grip, Space, ArrowDown ×2, Space) moves the row
//      two places, keeps focus on its grip, and the toast's Undo puts the order back;
//   4. Accounts: the LAST account of the longest group, dragged to the top inside the 420px
//      scroller — auto-scroll engages, the account lands first in its group, Undo restores;
//   5. Accounts: a parent dragged below its next sibling brings its components, which land
//      still nested under it; Undo restores;
//   6. a clean console.
// Then, at 1440 (the width the 2026-09-13 ghost heights were measured at), the loaded heights of
// both cards against their SettingsGhost constants (900 / 1045).
//
// Env: APP_BASE (http://localhost:5192), API_BASE (http://127.0.0.1:8092), SMOKE_OUT (this
// folder), EDGE_PATH, PLAYWRIGHT_CORE, ONLY_THEME, ONLY_WIDTH. Prints `R2 SETTINGS SMOKE OK` or
// exits 1 listing every problem; report.json and the PNGs land in SMOKE_OUT.
//
// The first two lines spoof the node version: this box runs node 18 and playwright-core refuses
// anything under 20. playwright-core is resolved out of the npx cache because it is not a repo
// dependency (tools/probes/sandbox-v/smoke.mjs's header; PLAYWRIGHT_CORE overrides the path).
Object.defineProperty(process, 'version', { value: 'v20.19.0' })
Object.defineProperty(process.versions, 'node', { value: '20.19.0' })
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const { chromium } = require(
  process.env.PLAYWRIGHT_CORE ??
    'C:/Users/edyli/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core',
)

const here = path.dirname(fileURLToPath(import.meta.url))
const out = process.env.SMOKE_OUT ?? here
mkdirSync(out, { recursive: true })
const APP = process.env.APP_BASE ?? 'http://localhost:5192'
const API = process.env.API_BASE ?? 'http://127.0.0.1:8092'
const EDGE =
  process.env.EDGE_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
if (!/:5192$/.test(new URL(APP).host) || !/:8092$/.test(new URL(API).host)) {
  console.error(
    `refusing to run against ${APP} / ${API}: lane R2 writes only through vite 5192 → uvicorn 8092 (finance_reorder_r2)`,
  )
  process.exit(2)
}

const HEIGHT = 900
const SETTLE = 1200
const THEMES = ['dark', 'light'].filter((t) => !process.env.ONLY_THEME || t === process.env.ONLY_THEME)
const WIDTHS = [1280, 1600].filter((w) => !process.env.ONLY_WIDTH || String(w) === process.env.ONLY_WIDTH)
const GHOSTS = { categories: 900, accounts: 1045 }
const NOISE =
  /favicon|DevTools|\[vite\]|@vite\/client|Download the React DevTools|React Router Future Flag/i
// The only writes this walk may make. Anything else is aborted and reported.
const WRITE_ALLOW = [
  /^\/api\/v1\/spending\/categories\/order$/,
  /^\/api\/v1\/net-worth\/accounts\/order$/,
  /^\/api\/v1\/activity\/batches\/[0-9a-f-]+\/undo$/,
  /^\/api\/v1\/auth\/renew$/,
]
const CATEGORIES = '#categories table.category-table'
const ROSTER = '#accounts table[aria-label="Net-worth accounts"]'

const report = {
  generatedAt: new Date().toISOString(),
  app: APP,
  api: API,
  themes: THEMES,
  widths: WIDTHS,
  checks: [],
  writes: [],
  blockedWrites: [],
  heights: [],
  problems: [],
}
const problem = (msg) => report.problems.push(msg)
const check = (tag, step, name, ok, observed) => {
  report.checks.push({ tag, step, name, ok, observed })
  if (!ok) problem(`${tag} ${step}: ${name} — observed ${JSON.stringify(observed)}`)
  return ok
}
const note = (tag, step, name, observed) => report.checks.push({ tag, step, name, ok: null, observed })
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const shot = (tag, name) => path.join(out, `${tag}-${name}.png`)

// ── the API, straight from node (the token, the starting orders, the final put-back) ──────────
const login = await fetch(`${API}/api/v1/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'admin@example.com', password: 'changeme123' }),
})
if (!login.ok) {
  console.error(`login failed: HTTP ${login.status} — see the plan's Task 10 prerequisites`)
  process.exit(2)
}
const TOKEN = (await login.json()).access_token
const api = async (method, route, body) => {
  const res = await fetch(`${API}/api/v1${route}`, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${method} ${route} → HTTP ${res.status}: ${await res.text()}`)
  return res.json()
}
const startCategories = (await api('GET', '/spending/categories')).map((c) => c.id)
const startAccounts = (await api('GET', '/net-worth/accounts')).map((a) => a.id)
report.start = { categories: startCategories, accounts: startAccounts }

// ── page helpers ──────────────────────────────────────────────────────────────────────────────
const catOrder = (page) =>
  page.$$eval(`${CATEGORIES} tbody tr[data-reorder-id]`, (rows) => rows.map((r) => r.dataset.reorderId))
const catName = (page, id) =>
  page.$eval(`${CATEGORIES} tbody tr[data-reorder-id="${id}"] td:nth-child(2)`, (td) => td.textContent.trim())
/** The roster as the reader sees it: groups of units, each a top-level row and its nested rows. */
const rosterGroups = (page) =>
  page.$$eval(`${ROSTER} tbody tr`, (rows) => {
    const groups = []
    for (const row of rows) {
      if (row.classList.contains('accounts-group-row')) {
        groups.push({ label: row.textContent.trim(), units: [] })
        continue
      }
      const group = groups[groups.length - 1]
      const id = row.dataset.reorderId
      const name = row.querySelector('.accounts-name-cell')?.firstChild?.textContent?.trim() ?? id
      if (row.classList.contains('component-row') && group.units.length > 0) {
        group.units[group.units.length - 1].components.push(id)
      } else {
        group.units.push({ id, name, components: [] })
      }
    }
    return groups
  })
const unitIds = (group) => group.units.map((u) => u.id)
const box = async (page, selector) => {
  const b = await page.locator(selector).boundingBox()
  if (b === null) throw new Error(`no box for ${selector}`)
  return { top: b.y, bottom: b.y + b.height, mid: b.y + b.height / 2, x: b.x + b.width / 2 }
}
/** A unit's extent: its first row's top to its last row's bottom. */
const unitBox = async (page, table, unit) => {
  const first = await box(page, `${table} tbody tr[data-reorder-id="${unit.id}"]`)
  const lastId = unit.components.length > 0 ? unit.components[unit.components.length - 1] : unit.id
  const last = await box(page, `${table} tbody tr[data-reorder-id="${lastId}"]`)
  return { top: first.top, bottom: last.bottom, mid: (first.top + last.bottom) / 2 }
}
const waitToast = (page, text) =>
  page
    .locator('.toast-message', { hasText: new RegExp(`^${escapeRe(text)}$`) })
    .last()
    .waitFor({ state: 'visible', timeout: 10000 })
const undoToast = (page, text) =>
  page
    .locator('.toast', { hasText: new RegExp(`^${escapeRe(text)}`) })
    .last()
    .getByRole('button', { name: 'Undo' })
    .click()
/** The card's save is back: no grip is parked any more. */
const waitIdle = (page, card) =>
  page.waitForFunction(
    (sel) => document.querySelector(`${sel} .reorder-grip[aria-disabled="true"]`) === null,
    card,
    { timeout: 10000 },
  )
async function waitFor(read, want, timeout = 8000) {
  const start = Date.now()
  let seen = await read()
  while (!same(seen, want) && Date.now() - start < timeout) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    seen = await read()
  }
  return seen
}
/** A real drag: press on the grip, pass the 4px lift threshold, travel in steps, then `during`
 *  (while the button is still held), then release. */
async function mouseDrag(page, gripSelector, targetY, during) {
  const g = await box(page, gripSelector)
  await page.mouse.move(g.x, g.mid)
  await page.mouse.down()
  await page.mouse.move(g.x, g.mid + (targetY > g.mid ? 8 : -8), { steps: 2 })
  await page.mouse.move(g.x, targetY, { steps: 14 })
  const seen = during ? await during() : null
  await page.mouse.up()
  return seen
}
async function openSettings(page) {
  try {
    await page.goto(`${APP}/settings`, { waitUntil: 'networkidle', timeout: 45000 })
  } catch {
    await page.goto(`${APP}/settings`, { waitUntil: 'load', timeout: 45000 })
  }
  await page.locator(CATEGORIES).waitFor({ timeout: 20000 })
  await page.locator(ROSTER).waitFor({ timeout: 20000 })
  await page.waitForTimeout(SETTLE)
}

const browser = await chromium.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--force-device-scale-factor=1'],
})

async function newPage(tag, theme, width) {
  const ctx = await browser.newContext({ viewport: { width, height: HEIGHT }, deviceScaleFactor: 1 })
  await ctx.addInitScript(
    ([token, th]) => {
      localStorage.setItem('finance_token', token)
      localStorage.setItem('finance.theme', th)
    },
    [TOKEN, theme],
  )
  // ONE handler, registered first: the account owns the theme since 2026-09-03, so GET /prefs is
  // answered with this pass's theme and PATCH /prefs is stubbed (a smoke never rewrites the
  // account's settings); every other write outside WRITE_ALLOW is aborted and reported.
  const stamp = new Date().toISOString()
  await ctx.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const method = request.method()
    const { pathname } = new URL(request.url())
    if (/^\/api\/v1\/prefs\b/.test(pathname)) {
      if (method === 'GET') {
        let body = { prefs: {} }
        try {
          body = await (await route.fetch()).json()
        } catch (e) {
          problem(`${tag}: GET /prefs could not be read (${e.message})`)
        }
        body.prefs = { ...body.prefs, theme: { value: theme, updated_at: stamp } }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ prefs: { theme: { value: theme, updated_at: stamp } } }),
      })
    }
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return route.continue()
    if (WRITE_ALLOW.some((re) => re.test(pathname))) {
      report.writes.push({ tag, method, pathname })
      return route.continue()
    }
    report.blockedWrites.push({ tag, method, pathname })
    problem(`${tag}: BLOCKED a write this walk must never make — ${method} ${pathname}`)
    return route.abort()
  })
  const page = await ctx.newPage()
  const errors = []
  page.on('console', (m) => {
    if (m.type() === 'error' && !NOISE.test(m.text())) errors.push(`console: ${m.text().slice(0, 300)}`)
  })
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e.message).slice(0, 300)}`))
  page.on('requestfailed', (r) => {
    const f = r.failure()
    if (f && !/ERR_ABORTED/.test(f.errorText)) errors.push(`requestfailed: ${f.errorText} <${r.url()}>`)
  })
  return { ctx, page, errors }
}

for (const theme of THEMES) {
  for (const width of WIDTHS) {
    const tag = `${theme}-${width}`
    const { ctx, page, errors } = await newPage(tag, theme, width)
    let step = 'open'
    try {
      await openSettings(page)
      check(tag, step, 'the page really is painting this theme', (await page.evaluate(() => document.documentElement.dataset.theme)) === theme, theme)
      const collapse = await page.$$eval(`${CATEGORIES}, #accounts table.accounts-table`, (tables) =>
        tables.map((t) => getComputedStyle(t).borderCollapse),
      )
      check(tag, step, 'both tables use the separate border model (.reorder-table outranks .data-table)', same(collapse, ['separate', 'separate']), collapse)
      report.heights.push({
        tag,
        categories: Math.round((await page.locator('#categories').boundingBox()).height),
        accounts: Math.round((await page.locator('#accounts').boundingBox()).height),
      })
      await page.locator('#categories').screenshot({ path: shot(tag, '01-categories-rest') })
      await page.locator('#accounts').screenshot({ path: shot(tag, '01-accounts-rest') })

      // ── 2. Categories: a mouse drag across three rows, its Undo, the drag again, a reload ─
      step = 'categories-drag'
      const before = await catOrder(page)
      const movedId = before[0]
      const movedName = await catName(page, movedId)
      const expected = [...before.slice(1, 4), movedId, ...before.slice(4)]
      /** The first row, dragged by the mouse until it has passed three peers. */
      const dragFirstDownThree = async (shotName) => {
        await page.locator('#categories .settings-scroll').evaluate((el) => {
          el.scrollTop = 0
          el.scrollIntoView({ block: 'center' })
        })
        const rows = []
        for (const id of before.slice(0, 5)) rows.push(await box(page, `${CATEGORIES} tbody tr[data-reorder-id="${id}"]`))
        const grip0 = `${CATEGORIES} tbody tr[data-reorder-id="${movedId}"] .reorder-grip`
        const g0 = await box(page, grip0)
        // The lifted centre must pass the third peer's midpoint and stop short of the fourth's.
        return mouseDrag(page, grip0, g0.mid + (rows[3].mid - rows[0].mid) + 4, async () => {
          const seen = await page.evaluate((id) => {
            const all = [...document.querySelectorAll('#categories tbody tr[data-reorder-id]')]
            const lifted = all.find((r) => r.dataset.reorderId === id)
            return {
              lifted: lifted?.getAttribute('data-reorder') ?? null,
              transform: lifted?.style.transform ?? '',
              shifted: all.filter((r) => r.getAttribute('data-reorder') === 'shifting' && r.style.transform !== '').length,
              cursorClass: document.documentElement.classList.contains('reorder-active'),
            }
          }, movedId)
          if (shotName) await page.screenshot({ path: shot(tag, shotName) })
          return seen
        })
      }
      const mid = await dragFirstDownThree('02-categories-mid-drag')
      check(tag, step, 'the lifted row follows the pointer and exactly three peers make room', mid.lifted === 'lifted' && /translateY\(/.test(mid.transform) && mid.shifted === 3 && mid.cursorClass, mid)
      await waitToast(page, `Moved ${movedName}`)
      await waitIdle(page, '#categories')
      check(tag, step, `${movedName} lands three rows down`, same(await catOrder(page), expected), { before, expected })
      await page.locator('#categories').screenshot({ path: shot(tag, '02-categories-dropped') })
      // The toast's Undo puts the pointer drop back through the change log.
      await undoToast(page, `Moved ${movedName}`)
      await waitToast(page, 'Order restored')
      check(tag, step, 'the toast’s Undo puts the order back', same(await waitFor(() => catOrder(page), before), before), before)
      // The same drag again, and this time the order must survive a reload.
      await dragFirstDownThree(null)
      await waitToast(page, `Moved ${movedName}`)
      await waitIdle(page, '#categories')
      check(tag, step, `${movedName} lands three rows down again`, same(await catOrder(page), expected), expected)
      await page.reload({ waitUntil: 'networkidle' })
      await page.locator(CATEGORIES).waitFor({ timeout: 20000 })
      check(tag, step, 'the new order survives a reload', same(await catOrder(page), expected), await catOrder(page))
      await page.locator('#categories').screenshot({ path: shot(tag, '03-categories-after-reload') })

      // ── 3. Categories: the keyboard path, then the toast's Undo ──────────────────────────
      step = 'categories-keyboard'
      await page.locator('#categories .settings-scroll').evaluate((el) => {
        el.scrollTop = 0
        el.scrollIntoView({ block: 'center' })
      })
      const k0 = await catOrder(page)
      const kId = k0[1]
      const kName = await catName(page, kId)
      await page.locator(`${CATEGORIES} tbody tr[data-reorder-id="${kId}"] .reorder-grip`).focus()
      await page.keyboard.press('Space')
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('ArrowDown')
      const lifted = await page.$eval(`${CATEGORIES} tbody tr[data-reorder-id="${kId}"]`, (r) => ({
        state: r.getAttribute('data-reorder'),
        mode: r.getAttribute('data-reorder-mode'),
      }))
      check(tag, step, 'Space lifts the row from the keyboard', lifted.state === 'lifted' && lifted.mode === 'keyboard', lifted)
      await page.screenshot({ path: shot(tag, '04-categories-keyboard-lifted') })
      await page.keyboard.press('Space')
      await waitToast(page, `Moved ${kName}`)
      await waitIdle(page, '#categories')
      const kExpected = [k0[0], k0[2], k0[3], kId, ...k0.slice(4)]
      check(tag, step, `${kName} moves two places down`, same(await catOrder(page), kExpected), { k0, kExpected })
      check(tag, step, 'focus stays on the moved row’s grip', await page.evaluate((id) => document.activeElement?.closest('tr')?.dataset.reorderId === id, kId), kId)
      await undoToast(page, `Moved ${kName}`)
      await waitToast(page, 'Order restored')
      check(tag, step, 'Undo puts the order back', same(await waitFor(() => catOrder(page), k0), k0), k0)
      await page.locator('#categories').screenshot({ path: shot(tag, '05-categories-undone') })

      // ── 4. Accounts: the last account of the longest group, to its top, with auto-scroll ─
      step = 'accounts-autoscroll'
      const scroller = page.locator('#accounts .settings-scroll').first()
      const groups = await rosterGroups(page)
      const longest = groups.reduce((a, b) => (b.units.length > a.units.length ? b : a))
      const last = longest.units[longest.units.length - 1]
      const groupBefore = unitIds(longest)
      await scroller.evaluate((el) => el.scrollIntoView({ block: 'center' }))
      // Bring the group's last row to 60px above the scroller's bottom edge (clear of the bottom
      // auto-scroll zone), so the drag starts with the group's top as far up as the list allows.
      await page.evaluate((id) => {
        const el = document.querySelector('#accounts .settings-scroll')
        const row = el.querySelector(`tr[data-reorder-id="${id}"]`)
        el.scrollTop += row.getBoundingClientRect().bottom - (el.getBoundingClientRect().bottom - 60)
      }, last.id)
      const s0 = await scroller.evaluate((el) => el.scrollTop)
      const sBox = await scroller.boundingBox()
      const held = await mouseDrag(page, `${ROSTER} tbody tr[data-reorder-id="${last.id}"] .reorder-grip`, sBox.y + 12, async () => {
        await page.waitForTimeout(1200)
        const s1 = await scroller.evaluate((el) => el.scrollTop)
        await page.screenshot({ path: shot(tag, '06-accounts-autoscroll-held') })
        return { s1 }
      })
      check(tag, step, 'holding the pointer in the top edge zone scrolls the 420px list up', s0 > 0 && held.s1 < s0 - 20, { s0, s1: held.s1 })
      await waitToast(page, `Moved ${last.name}`)
      await waitIdle(page, '#accounts')
      const landed = (await rosterGroups(page)).find((g) => g.label === longest.label)
      check(tag, step, `${last.name} lands first in ${longest.label}`, landed?.units[0]?.id === last.id, landed === undefined ? null : unitIds(landed))
      await page.locator('#accounts').screenshot({ path: shot(tag, '06-accounts-autoscroll-dropped') })
      await undoToast(page, `Moved ${last.name}`)
      await waitToast(page, 'Order restored')
      const restored = await waitFor(async () => unitIds((await rosterGroups(page)).find((g) => g.label === longest.label)), groupBefore)
      check(tag, step, 'Undo puts the group back', same(restored, groupBefore), { restored, groupBefore })

      // ── 5. Accounts: a parent brings its components ──────────────────────────────────────
      step = 'accounts-carry'
      const now = await rosterGroups(page)
      let carrier = null
      for (const g of now) {
        const i = g.units.findIndex((u) => u.components.length > 0)
        if (i >= 0 && i + 1 < g.units.length) {
          carrier = { group: g, parent: g.units[i], sibling: g.units[i + 1] }
          break
        }
      }
      if (carrier === null) {
        note(tag, step, 'no parent with components has a sibling below it in this book — step skipped', null)
      } else {
        const { group, parent, sibling } = carrier
        const order0 = unitIds(group)
        await scroller.evaluate((el) => {
          el.scrollIntoView({ block: 'center' })
          el.scrollTop = 0
        })
        await page.evaluate((id) => {
          const el = document.querySelector('#accounts .settings-scroll')
          const row = el.querySelector(`tr[data-reorder-id="${id}"]`)
          el.scrollTop += row.getBoundingClientRect().top - (el.getBoundingClientRect().top + 80)
        }, parent.id)
        const pBox = await unitBox(page, ROSTER, parent)
        const sibBox = await unitBox(page, ROSTER, sibling)
        const gripP = `${ROSTER} tbody tr[data-reorder-id="${parent.id}"] .reorder-grip`
        const gP = await box(page, gripP)
        const carried = await mouseDrag(page, gripP, gP.mid + (sibBox.mid - pBox.mid) + 4, async () => {
          const seen = await page.evaluate((ids) => ids.map((id) => document.querySelector(`#accounts tr[data-reorder-id="${id}"]`)?.style.transform ?? null), [parent.id, ...parent.components])
          await page.screenshot({ path: shot(tag, '07-accounts-carry-mid-drag') })
          return seen
        })
        check(tag, step, 'the components travel with their parent (one transform for the unit)', carried[0] !== '' && carried.every((t) => t === carried[0]), carried)
        await waitToast(page, `Moved ${parent.name}`)
        await waitIdle(page, '#accounts')
        const after = (await rosterGroups(page)).find((g) => g.label === group.label)
        const expectOrder = order0.filter((id) => id !== parent.id)
        expectOrder.splice(expectOrder.indexOf(sibling.id) + 1, 0, parent.id)
        const movedUnit = after?.units.find((u) => u.id === parent.id)
        check(tag, step, `${parent.name} lands below ${sibling.name}`, same(after === undefined ? null : unitIds(after), expectOrder), { order0, expectOrder })
        check(tag, step, 'its components still follow it, nested', same(movedUnit?.components ?? null, parent.components), movedUnit)
        await page.locator('#accounts').screenshot({ path: shot(tag, '07-accounts-carry-dropped') })
        await undoToast(page, `Moved ${parent.name}`)
        await waitToast(page, 'Order restored')
        const back = await waitFor(async () => unitIds((await rosterGroups(page)).find((g) => g.label === group.label)), order0)
        check(tag, step, 'Undo puts the group back', same(back, order0), { back, order0 })
      }
    } catch (e) {
      problem(`${tag} ${step}: ${e.message}`)
      await page.screenshot({ path: shot(tag, `zz-failed-${step}`) }).catch(() => {})
    } finally {
      for (const e of errors) problem(`${tag}: ${e}`)
      await ctx.close()
    }
  }
}

// ── the ghost heights, at the width they were measured at (2026-09-13 V: 1440) ───────────────
{
  const tag = 'dark-1440'
  const { ctx, page, errors } = await newPage(tag, 'dark', 1440)
  try {
    await openSettings(page)
    const measured = {
      categories: Math.round((await page.locator('#categories').boundingBox()).height),
      accounts: Math.round((await page.locator('#accounts').boundingBox()).height),
    }
    report.heights.push({ tag, ...measured, ghosts: GHOSTS })
    note(tag, 'heights', 'loaded card heights vs the SettingsGhost constants', { measured, ghosts: GHOSTS })
  } catch (e) {
    problem(`${tag} heights: ${e.message}`)
  } finally {
    for (const e of errors) problem(`${tag}: ${e}`)
    await ctx.close()
  }
}

await browser.close()

// ── put both orders back the way they were found ──────────────────────────────────────────────
try {
  await api('PUT', '/spending/categories/order', { ids: startCategories })
  await api('PUT', '/net-worth/accounts/order', { ids: startAccounts })
  const endCategories = (await api('GET', '/spending/categories')).map((c) => c.id)
  const endAccounts = (await api('GET', '/net-worth/accounts')).map((a) => a.id)
  check('cleanup', 'restore', 'both orders are back where the walk found them', same(endCategories, startCategories) && same(endAccounts, startAccounts), { endCategories, endAccounts })
} catch (e) {
  problem(`cleanup: ${e.message}`)
}

writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
console.log(`checks: ${report.checks.filter((c) => c.ok === true).length} ok, ${report.checks.filter((c) => c.ok === false).length} failed`)
console.log(`heights: ${JSON.stringify(report.heights)}`)
if (report.problems.length > 0) {
  for (const p of report.problems) console.log(`PROBLEM ${p}`)
  process.exit(1)
}
console.log('R2 SETTINGS SMOKE OK')
```

- [ ] **Step 6: Run it**

Run (from the worktree root): `node scratchpad/reorder-r2/smoke.mjs`
Expected, exit 0:
- `checks: 73 ok, 0 failed` — 18 checks per pass × 4 passes, plus the cleanup check;
- a `heights:` line;
- `R2 SETTINGS SMOKE OK`.

`ONLY_THEME=dark ONLY_WIDTH=1280` narrows a re-run to one pass.

What each step proves (spec §10's list for these two surfaces):

| Step | Proves |
|---|---|
| open | the theme painted; both tables compute `border-collapse: separate` (Task 7's pin holds in the real bundle) |
| categories-drag | the lifted row follows the pointer, three peers shift, the row lands three places down, the toast names it, the toast's Undo puts the order back; the same drag again survives a reload |
| categories-keyboard | focus the grip, Space, ArrowDown ×2, Space: `data-reorder-mode="keyboard"` while lifted, two places down, focus back on the moved grip, the toast's Undo restores the order |
| accounts-autoscroll | the last account of the longest group (Liabilities in this book) dragged to the top edge of the 420px scroller: `scrollTop` falls while the pointer is held there, the account lands first in its group, Undo restores |
| accounts-carry | a parent with components (Fidelity Traditional 401(k) here) dragged below its next sibling: its components share its transform mid-drag and land still nested under it, Undo restores |
| console | no console error, page error or failed request on any pass |

- [ ] **Step 7: Look at the screenshots**

Open the PNGs in `scratchpad/reorder-r2/` (`{theme}-{width}-NN-*.png`) and check, in both themes:
- `01-*-rest`:
  - the resting tables look as they did before this lane — hairlines, header, sticky Actions column;
  - the grip column is narrow and muted;
  - the Accounts table shows one uppercase heading per group, and component names indented and
    muted in the Account cell, not in the grip cell.
- `02-categories-mid-drag`:
  - the lifted row is raised on `--surface-2` with its hairlines, the Actions cell included;
  - its neighbours have moved up to make room.
- `06-accounts-autoscroll-held`: the list has scrolled, and the lifted row sits at the top of its
  group.
- `07-accounts-carry-mid-drag`: the parent and its components move as one block.
- the `*-dropped` / `*-after-reload` / `*-undone` shots show the final orders the checks asserted.

Record anything off in Results.

- [ ] **Step 8: If a check fails**

- Use superpowers:systematic-debugging.
- A defect in this lane's files gets a failing test first (Tasks 3–7's test files), then the fix
  and a re-run.
- A defect in `src/components/reorder/**` or `src/api/**` is not patched here. Record it and report
  it to the controller (lanes R0/R1 own those files).

- [ ] **Step 9: Stop the two servers**

Only the lane's own, by port (PowerShell):

```powershell
Get-NetTCPConnection -LocalPort 8092,5192 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force }
```

Never touch 8000/5173 or another lane's ports.

---

### Task 10: The ghost heights, then the results

**Files:**
- Modify only if Step 1 says so: `src/components/settings/CategoriesCard.tsx` (`<SettingsGhost
  height={900} />`), `src/components/settings/AccountsCard.tsx` (`<SettingsGhost height={1045} />`),
  and their tests
- Modify: this plan's "Results"

Each card shows a `SettingsGhost` as tall as its LOADED body while it fetches, so the tab lands on a
stable layout (2026-09-13 spec §9). The 2026-09-13 V lane measured the loaded heights at 1440 to
within 1 px (900 and 1045).

This lane changes both cards:
- a form row is gone;
- a note line is added.

The Categories card also sets the top of the Accounts card below it.

- [ ] **Step 1: Read the measurement**

```bash
node -e "const r=require('./scratchpad/reorder-r2/report.json');const h=r.heights.find((x)=>x.tag==='dark-1440');console.log('categories',h.categories,'(ghost 900)  accounts',h.accounts,'(ghost 1045)')"
```

Call the two printed figures **C** (categories) and **A** (accounts).
- If `|C − 900| ≤ 2` and `|A − 1045| ≤ 2`, skip to Step 5.
- Otherwise do Steps 2–4 for each card that is off.

- [ ] **Step 2: The failing pins**

Accounts (only if A is off) — in `renders once, after BOTH feeds settle`, replace

```tsx
  expect((document.querySelector('.settings-ghost') as HTMLElement).dataset.ghostHeight).toBe('1045')
```

with the same line reading `.toBe('A')`, where A is the printed figure. For example, `.toBe('1012')`
if A printed 1012.

Categories (only if C is off) — append to `CategoriesCard.test.tsx`, with C's printed figure in
place of 900:

```tsx
it('reserves its loaded height while the list is on the wire (2026-09-13 spec §9)', () => {
  vi.mocked(fetchCategories).mockReturnValue(new Promise<CategoryOut[]>(() => {}))
  render(<CategoriesCard />)
  expect((document.querySelector('.settings-ghost') as HTMLElement).dataset.ghostHeight).toBe('900')
})
```

Run: `npx vitest run src/components/settings/CategoriesCard.test.tsx src/components/settings/AccountsCard.test.tsx`
Expected: FAIL on the pins just written (`expected '900' to be '<C>'` / `expected '1045' to be
'<A>'`).

- [ ] **Step 3: The constants**

- `CategoriesCard.tsx`: `{!loaded && loadError === null && <SettingsGhost height={900} />}` → the
  same line with `height={C}`.
- `AccountsCard.tsx`: `{!settled && <SettingsGhost height={1045} />}` → the same line with
  `height={A}`.

Run the same command. Expected: PASS.

- [ ] **Step 4: Commit**

```bash
npx tsc -b && npx eslint src/components/settings
git add src/components/settings/CategoriesCard.tsx src/components/settings/CategoriesCard.test.tsx src/components/settings/AccountsCard.tsx src/components/settings/AccountsCard.test.tsx
git commit -m "fix(settings): the two cards' ghosts reserve their new loaded heights (measured at 1440 on the real book)"
```

**Controller-approved fence extension (2026-09-23):** `SettingsPage.tsx`'s page skeleton draws these
two cards at `ghost − 58` (today `{ span: 8, height: 842 }` and `{ span: 12, height: 987 }`). When a
ghost changes, change the matching skeleton entry to `C − 58` / `A − 58` in the same commit. Touch
nothing else in `SettingsPage.tsx`, because the in-flight quick-fixes lane B1 edits it too. If a
`SettingsPage.test.tsx` pin names the old number, update it as well.

- [ ] **Step 5: Fill in Results and commit**

```bash
git add docs/superpowers/plans/2026-09-23-reorder-r2-settings.md
git commit -m "docs(plan): lane R2 — results, gates and the browser check"
```

---

## Results (filled in by the implementer)

- Task 0 preflight:
  - The branch was cut at `da1a3e44` on `feat/reorder-base`: R1 merged (`dd62aa6c`), R0 merged
    (`0d805010`) with its unmount follow-up (`11a4cda0`), R4 (`cca4d9cf`), and main through lane B2
    (`d7a16e6a`). All seven R0 modules and their tests are present. Each `grep` printed one line,
    and both signatures are exactly `Promise<{ data: …[]; batchId: string | null }>`.
  - `finance_reorder_r2` read `29|19|f12026092301`: already at R1's head, so the controller's
    migration step was skipped.
  - Baseline (settings + SettingsPage + guide + reorder): 31 files / 335 tests pass —
    CategoriesCard 13, AccountsCard 22, settingsCss 2.
- R0's final API matched this plan's code verbatim (`useReorder`, `UseReorder`, `handleProps`,
  `itemProps`, `markSaved`, the two helpers). No code deviated from it.
  - `items` (and so every `carries`) is re-derived from the rows being rendered on every render.
  - R0's dev-only contract check printed nothing in any test run or in the real browser.
- Red before green, every task, with exactly the failures the plan predicts:
  - T1: 3 failed / 11 passed;
  - T2: 4 / 20, then the Guide fence `['accounts-add: Sort order', 'categories-add: Sort order']`;
  - T3: 11 / 14;
  - T4: 2 / 25;
  - T5: 18 / 22;
  - T6: 2 / 40;
  - T7 (per A1): 2 / 4 — the group heading and the component indent. The two reorder.css pins passed
    at once, as the dependency guard;
  - T10: 2 / 68 on the two ghost pins.
  - (T3's and T5's last test failed "no table" only as a cascade: the failing reload test leaves its
    `mockReturnValueOnce` queued, and `vi.clearAllMocks` does not drain it.)
- Lane tests (Task 8 Step 1): 31 files / 373 tests pass — CategoriesCard 27/27, AccountsCard
  42/42, settingsCss 6/6, SettingsPage 47/47, guide 6 files / 37. After Task 10, CategoriesCard is
  28 (the ghost pin).
  - Task 2's set (`src/guide` + GuidePage + paletteRegistry.guide + both cards): 10 files / 93.
  - The Guide's two new steps are 106 and 114 characters.
- Full vitest: ONE run at the end, on the final code (`--maxWorkers=2`, the controller's memory
  rule). 246 files / 3431 tests: 245 files, 3430 tests pass.
  - The one failure is the known load flake `PaycheckPage … names the employer match under the
    waterfall` (`expected <p class="drill-hint"></p> to be null`).
  - `PaycheckPage.test.tsx` re-run alone: 84/84, exit 0. This lane never touches it.
- tsc / eslint / build, on the final HEAD:
  - `tsc -b` exit 0. Its buildinfo lives in the shared `node_modules` junction, so both projects
    were also checked with no cache (`tsc -p tsconfig.app.json --noEmit --incremental false`, and
    the same for `tsconfig.node.json`): both exit 0.
  - `eslint .` exit 0: 0 errors, the 26 pre-existing warnings, none in a file this lane touched.
  - `npm run build` exit 0, with no chunk warning.
- Scope check: the seven fenced files, plus `src/pages/SettingsPage.tsx` (the two skeleton
  numbers, 842 → 637 and 987 → 1056, under the controller-approved Task 10 extension). Nothing under
  `src/api`, `src/types` or `src/components/reorder` changed.
- Browser check (`scratchpad/reorder-r2/report.json`; real headless Edge, vite 5192 → uvicorn 8092
  → `finance_reorder_r2`):
  - Result: `checks: 101 ok, 0 failed`, plus 4 problems. All four are the same one:
    `accounts-carry: locator.waitFor: Timeout 10000ms exceeded`, once per pass.
    - The plan's downward carry drag (Fidelity Traditional 401(k) below Fidelity Traditional IRA)
      never moves. The drop is "where it was", so no toast arrives.
    - Cause: R0's slot math, not this lane — see "For the controller / R0 / V" item 1.
  - 0 blocked writes; 44 allowed writes (12 category PUTs, 12 account PUTs, 20 undos).
  - The final PUTs put both orders back exactly (the cleanup check passed, and psql reads the
    census order).
  - Per pass (dark/light × 1280/1600), all green:
    - open: theme painted; both tables `border-collapse: separate`;
    - categories-drag: 5/5 — follows, 3 peers shift, lands, Undo, survives a reload;
    - categories-keyboard: 4/4 — lifted in keyboard mode, 2 places down, focus kept, Undo;
    - accounts-autoscroll: 3/3;
    - console: clean in every pass.
  - Lane additions (the smoke is gitignored, so they are recorded here), all green in every pass:
    - 5b carry-up, 4/4: Fidelity Traditional IRA dragged above the 401(k). The 4-row unit is
      displaced as one block (one transform), its components stay nested, and Undo restores.
    - 5c carry-keyboard, 5/5: the 401(k) moved down one place by keyboard. The 4 rows lift and move
      together, land below the IRA still nested, focus stays on its grip, and Undo restores.
  - Also changed in the smoke: every step has its own try/catch, and each pass has a console check.
  - Auto-scroll (Costco CC, the last of Liabilities, 7 units): scrollTop 1120 → 454 / 454 / 463 / 382,
    i.e. 666 / 666 / 657 / 738 px while held. Costco CC then lands first in Liabilities, and Undo
    restores.
  - Screenshot notes (both themes, 1280 and 1600):
    - Resting tables: the grip column is narrow and muted, and the Sort and Group columns are gone.
      The Accounts headings (CASH, PRE-TAX…) are uppercase, muted, with the 0.9rem lead-in.
      Component names are indented and muted in the Account cell, not the grip cell. The sticky
      Actions column keeps its hairline. Each order note sits right under its table.
    - Categories mid-drag: the lifted row is on `--surface-2` across every cell, Actions included,
      with an accent grip, and its peers are moved up. One peer is caught mid-transition.
    - Dropped frames: the saved flash covers the whole unit, Actions cells included. The toasts
      read "Moved {name} · Undo" and "Order restored".
    - `07-accounts-carry-mid-drag`: the 4-row unit sits clamped at the bottom of Pre-tax, and the
      two peers it covers have NOT moved up — the defect below, made visible.
    - The pale band over two Portfolio rows in the full-card shots is a fixed page overlay, caught
      while the 1114px element was stitched into the 900px viewport.
- Heights (Task 10): dark-1440 categories **695** (ghost 900), accounts **1114** (ghost 1045).
  - Both were off by more than 2 px, so the constants changed: 900 → 695 and 1045 → 1114, the
    skeleton 842 → 637 and 987 → 1056, and the Accounts pin and a new Categories pin (`4fb1e9ec`).
  - The ghosts were already stale on the real book before this lane. With the pre-lane layout
    simulated in the live DOM (the Sort order field put back, the order note removed), the same
    page measures 723 / 1142 at 1440.
  - So this lane's own change is −28 px on each card. The rest is data: all three tables fill
    their 420px scrollers here, and there are 8 portfolio labels.
  - The other widths: 1280 is 731 / 1132, and 1600 is 677 / 1114.
- For the controller / R0 / V:
  1. **R0 defect — a tall unit cannot be dragged down past short peers near the end of its range.**
     - `clampOffset` stops the unit's bottom at the last peer's bottom, and `slotFor` compares the
       unit's CENTRE with each peer's original midpoint. A unit of height H therefore passes the
       next peer below (height h, with R px of peers after it) only if H ≤ 2R + h.
     - In the real book, the Pre-tax 401(k) (4 rows, 171.9px) has the IRA and the HSA (one row
       each) below it. Its clamped centre reaches 171.9px; the IRA's midpoint is at 193.4px.
     - So no pointer drag can move it down at all. The keyboard path works (5c), as does moving the
       peer up past it (5b).
     - R0's tests cover only a short unit moving up past a tall one (`slotFor(stacked([120, 40]),
       1, …)`).
     - A fix is R0's call. Options: compare the unit's leading edge (its bottom when moving down,
       its top when moving up) with peer midpoints, or clamp the centre instead of the extent.
       Pin it with `slotFor` on `stacked([160, 40, 40])` from slot 0.
     - Not patched here (spec §11; plan Task 9 step 8).
  2. Auto-scroll does not stop at the unit's range. Holding at the top edge scrolled the 420px
     roster about 660px, well past Liabilities, so the clamped lifted row left the view. The drop
     was still right. A minor UX note for R0/V.
  3. In a multi-row lifted unit (a parent with components), each row draws its own inset top and
     bottom hairline, so the internal separators read doubled (`09-*-keyboard-lifted`). Cosmetic
     (reorder.css).
  4. `src/pages/SettingsPage.test.tsx:883` still has a comment saying both tables carry a "Sort
     order" box. It is only a comment, outside the fence, and was left alone.
  5. The cleanup restored the ORDER exactly. The stored `sort_order` values are now normalized
     0…n−1, instead of the importer's 3…55 with its two ties, as after any reorder.
  6. Plan-text deviations:
     - All vitest runs used `--maxWorkers=2`, and the full run came once, at the end, after Task
       10, rather than in Task 8.
     - Task 7 follows A1: the two tests pin reorder.css and the grip override keeps
       `padding-right: 0`. Its commit message was reworded to say so.
     - The smoke additions above.

---

## Notes for the controller (cross-lane findings made while planning)

1. **The pinned Actions cell outranks reorder.css's row states** on every table that has one.
   - panels.css:247-255 `.data-table td.row-actions` is (0,2,1).
   - `tr[data-reorder='lifted'] > td` and the drop-line rules are (0,1,2).
   - This lane restates them under `.settings-scroll .reorder-table` (Task 7); R3 does the same
     for `.port-table`.
   - One R0-level fix — prefix reorder.css's row-state selectors with `.reorder-table` — would make
     both restatements redundant; they would stay harmless.
2. **`border-collapse` ties.** `.data-table { border-collapse: collapse }` and `.reorder-table` are
   both (0,1,0), so the production chunk order would pick the winner.
   - This lane pins `.settings-scroll .reorder-table`, and Task 9 checks the computed value in the
     real bundle.
   - An R0-level `table.reorder-table` (0,1,1) would settle it for every lane.
3. **`.reorder-grip-cell { padding-right: 0 }`** (0,1,0) loses to `.data-table td { padding: … }`
   (0,1,1), so on a data-table the grip column keeps the full cell padding.
   - It is cosmetic, and this lane does not restate it.
   - The component-row override in Task 7 re-applies the plain `var(--density-cell-pad)` on
     purpose, so component rows match the other rows.
4. **The Guide.** This lane rewrites `src/guide/content/pages-planning.tsx:277` and `:314` (Task 2),
   which the label fence requires once "Sort order" leaves the UI.
   - Other stale Guide copy, outside this lane:
     - `pages-tracking.tsx:34` (Overview ↑/↓ — R4's approved step);
     - `pages-tracking.tsx:729` (Categories & weights arrow keys — R5).
   - `src/pages/SettingsPage.test.tsx:883` keeps a comment saying both tables carry a "Sort order"
     box. It is only a comment and was left alone.
5. **The page skeleton.** `SettingsPage.tsx`'s skeleton cards for Categories and Accounts are the
   ghost heights − 58. If Task 10 changes a ghost, those two numbers should follow.
6. **`nestComponents` leaves out some rows everywhere it is used** — a component of a component, and
   parent loops.
   - The Monthly update's per-owner walk therefore never shows such an account.
   - This is pre-existing: the real book has none, and the server leaves deeper links "deliberately
     unguarded".
   - Settings now keeps such rows listed (Decision 10), so the link can at least be seen and fixed.
7. **Database.** `finance_reorder_r2` exists (made 2026-09-23 from `finance_realdata`, alembic
   `f12026091203`) and must be migrated after R1's merge. Spec §10 names the shared
   `finance_reorder_scratch`; this lane uses its private copy because it writes, and it restores
   both orders at the end of the walk.

---

## Self-review — every R2 requirement mapped to a task

| Spec | Requirement | Task |
|---|---|---|
| §4.1 | The form keeps only **Category name**; the Sort order box is removed; create sends no `sort_order` (so it appends) | 1 |
| §4.1 | New first column holds the grip (header cell empty, `aria-hidden`); the **Sort** column is removed; the table is `.reorder-table` | 3 |
| §4.1 | Retired rows stay where they are and are draggable | 3 (Pets is retired and moves) |
| §4.1 | Drop → optimistic order (adjust-during-render `pendingOrder`, no effect) → `PUT /spending/categories/order` | 3 |
| §4.1 | Success: rows replaced from the response, `markSaved`, `toast.success("Moved {name}", Undo)` | 3 |
| §4.1 | Undo: `undoBatch(id)` → reload → `toast.info("Order restored")`; a refused undo shows `toast.error(server sentence)` | 3 |
| §4.1 | Failure: revert to the last server order and `toast.error` (§8.3 grammar) on the toast layer, not the form banner; on 409 the card also reloads | 3 |
| §4.1 | Busy: grips disabled while any request of the card is in flight | 3 (during the PUT and during a Retire) |
| §4.1 | Copy: a note line under the table; the InfoHint mentions dragging | 4 |
| §4.2 | The form loses the Sort order box; create sends no `sort_order` | 2 |
| §4.2 | One heading row per non-empty group, in `GROUP_ORDER`, labelled with `GROUP_LABELS`: `<tr class="accounts-group-row"><th scope="colgroup" colspan=…>` | 5 (markup), 7 (style) |
| §4.2 | Inside a group, API order, components nested by `nestComponents` applied per group (a component whose parent is in another group stays top-level in its own) | 5 |
| §4.2 | The Group column is removed; columns grip · Account · Owner · Roll-up · Status · actions | 5 |
| §4.2 | Component rows keep their `component-row` indent, moved to the Account cell; the global `td:first-child` indent is overridden in `.accounts-table` | 5 (classes), 7 (CSS + pins) |
| §4.2 | Drag rules: a top-level account moves within its group carrying its components; a component moves among its siblings | 5 |
| §4.2 | Changing an account's group stays in Edit (the server appends it to the new group) | 2 (the PATCH names no position) |
| §4.2 | Saving: the display order flattened group by group, each parent followed by its components, sent whole (every account, retired included) to `PUT /net-worth/accounts/order` | 5 |
| §4.2 | Toast, Undo and failure behave exactly as in §4.1 | 5 |
| §4.2 | Copy: a note line; the InfoHint mentions dragging and carried components | 6 |
| §4.2 | The Portfolio accounts sub-table is unchanged | 5 (test: no grips, no `.reorder-table` there) |
| §4.3 | Both cards: the Sort order box and column are gone | 1, 2, 3, 5 |
| §4.3 | Both cards: create sends no `sort_order` | 1, 2 |
| §4.3 | Both cards: the keyboard reorder produces one PUT with the full id list | 3, 5 |
| §4.3 | Both cards: optimistic order, then server order | 3, 5 |
| §4.3 | Both cards: the Undo toast calls `undoBatch` and reloads | 3, 5 |
| §4.3 | Both cards: failure reverts; 409 reloads | 3, 5 |
| §4.3 | Both cards: grips are disabled while busy | 3, 5 |
| §4.3 | Accounts: group headings, empty groups omitted | 5 |
| §4.3 | Accounts: components nested and indented in the Account cell | 5, 7 |
| §4.3 | Accounts: a parent's move carries its components in the PUT | 5 |
| §4.3 | Accounts: a component moves only among siblings | 5 |
| §4.3 | Accounts: a single-account group has a disabled grip | 5 |
| §4.3 | The cards call R1's `reorderAccounts`/`reorderCategories` and add no `src/api` code | 3, 5, 8 (scope check) |
| §2.3.3 | Row buttons are disabled mid-drag (R0 consumer rule 5) | 4, 6 |
| §2.4 | Grip named "Reorder {name}", described by the instructions; live region; the helpers outside the table | 3, 5 |
| §8.1 | Categories note; Accounts note | 4; 6 |
| §8.1 | Categories InfoHint (append); Accounts InfoHint (append) | 4; 6 |
| §8.1 | Toast "Moved {name} · [Undo]"; "Order restored"; "Couldn't save the new order — {reason}. The list is back to how it was." | 3, 5 |
| §8.2 | `{range}`: the group label for accounts, "{parent}'s components" for components, absent for categories | 5 (announcement tests), 3 |
| §8.3 | The accounts/categories 409 detail shown verbatim in `toast.error`, then the list reloads | 3, 5 |
| §9 | A one-row list or a group with one account has a disabled grip; an empty list shows no grips | 3, 5 |
| §9 | Retired rows keep their positions and are draggable; the PUT always sends every row | 3, 5 |
| §9 | Two tabs: 409 → toast → reload; nothing half-applied | 3, 5 (409), 9 (real server) |
| §9 | No second drop before the first save returns (grips parked); the next drag diffs against the optimistic rows | 3, 5 |
| §9 | Undo after a later reorder: the server refuses with the overlap sentence, shown in `toast.error` | 3, 5 |
| §9 | Cancelled drags make no request (data landing mid-drag, Escape, blur, resize — R0's hook) | 4, 6 (Escape returns the buttons); R0 tests the rest |
| §9 | Accounts: a component whose parent is retired stays nested; a parent in another group leaves it top-level; a group change via Edit appends | 5, 5, 2 |
| §9 | Edge at 1280/1600, both themes | 9 |
| §10 | Per lane: TDD, the full vitest suite, `tsc -b`, eslint, `vite build` | 1–8 |
| §10 | Browser check on the lane's own backend (8092, `SCHEDULER_ENABLED=0`) and vite (5192, `VITE_API_PROXY`), both themes at 1280 and 1600 | 9 |
| §10 (V list, the Settings share) | a real mouse drag (follows, peers shift, lands, survives a reload, toast + Undo); the keyboard path; auto-scroll inside the 420px scroller; a clean console | 9 |
| §11 | Branch `feat/reorder-settings` from `feat/reorder-base` after R0 + R1 merged; owns the two cards, their tests and `settings.css` (additive) | Mechanics, 0, 8 |
