# Lane R5 — Credit Cards: drag to reorder the card list and Categories & weights, colours that stay with their card (2026-09-23) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (one
> implementer for this lane in its own worktree, TDD per task, then a spec-compliance review and a
> code-quality review, then merge into `feat/reorder-base` — never main, never pushed). Steps use
> `- [ ]` checkboxes.

**Spec:** `docs/superpowers/specs/2026-09-23-drag-to-reorder-design.md` — this lane implements **§7
(Credit Cards: the card list, stable chart colours, the Categories & weights migration)**, the R5
rows of **§8.1** (the "Moved {name}", "Order restored" and save-failed toasts), the cards and
reward-categories sentences of **§8.3**, the R5 items of **§9**, and its share of **§10–§11**. Read
§0 (items 7 and 9–11), §2.2–§2.5, §7, §8 and §9 before Task 1. The spec is authoritative where this
plan is silent; every choice the spec left open is recorded under "Decisions".

**Goal:** both Credit Cards lists become reorderable with lane R0's shared grip. A card or a reward
category is dragged by its grip, or lifted with Space and moved with the arrow keys. A drop saves the
list's whole new order in ONE PUT, shows at once, flashes the moved row, and says "Moved {name}" in a
toast whose Undo re-sends the order that stood before. A failed save puts the rows back and says why;
a stale list reloads. The Categories & weights panel loses its native HTML5 drag, its per-row PATCH
chain and their CSS. The credit-line chart colours each card by its rank by id, so a reorder changes
the legend's order but never repaints a card.

**Architecture:**
- `CardsPanel.tsx` and `CategoriesPanel.tsx` each call lane R0's `useReorder` once (one range; the
  items are every row the page hands them, in API order) and lane R1's `reorderCreditCards` /
  `reorderRewardCategories`.
- Two order layers sit over each panel's props (lane R3's design): `pendingOrder` — the dropped
  order while its PUT is in flight — and `savedOrder` — the server's answer until the page's next
  fetch replaces the props, retired during render.
- Three functions per panel: `saveOrder` (the hook's `onCommit`), `restoreOrder` (the toast's Undo)
  and `dropPendingOrder` (a failed save's revert, focus kept).
- `creditLineChartOptions.ts` gains `colourSlots` (rank by id among the cards drawn); the page's
  `lineCards` map passes each card's id.
- `categories.css` loses the retired drag's rules; one Guide task's steps move to lift-and-drop.

**Tech stack:** React 19 + TypeScript 5.9 strict, vitest 3 + @testing-library/react (jsdom; **no**
jest-dom matchers — assert with plain `getAttribute`/`textContent`/`toBe`), eslint 9 with
`eslint-plugin-react-hooks` 7.x (React-Compiler rules), playwright-core + Edge for the browser check.

**Pre-validated (2026-09-23).** Tasks 1–9 were applied, task by task, to a scratch copy of
`feat/reorder-base` @0d805010 (main with B2, plus lane R0) overlaid with lane R1's nine `src/` files
from `feat/reorder-backend` @6c8cfe4f (the base had not changed any of them since their merge-base,
so the overlay is the merged state).
- Every "watch it fail" message quoted below is the one that run printed, and every pass count is
  that run's.
- After Task 9: `tsc -b` exit 0. `eslint` on every touched file exit 0, with one warning that is
  already on the base (Task 10 Step 2).
- The full vitest run failed nothing in a file this lane touches. Its failures were artifacts of the
  partial copy — three suites read `backend/tests/fixtures/`, and `Layout.test.tsx` needs a git
  build hash — plus the known OverviewPage load flake, which passed alone.
- The mid-save test of Task 6 was mutation-checked: it fails against a single order layer.
- Task 11's script was syntax-checked (`node --check`) only. It has not been run: no app ran while
  planning.

If a step's output differs from what is quoted, stop and find out why before changing anything.

---

## Controller amendments (2026-09-23 — these override the tasks below)

**A1. A card keeps its colour across person scopes.** (Spec §7 amended the same day.) Rank a card's
colour slot by id among **all cards the page knows** — the full roster the page loaded, active and
inactive — not only among the cards drawn in the current scope. Then the joint Apple Card, for
example, wears the same hue in Grace's view as in the household view, in line with the concurrent
batch's "one colour per money entity" direction.
- In Tasks 1–2, `creditLineChartOption` takes an optional rank source: `rankIds?: readonly number[]`.
  It holds the ids to rank against, and when absent the ids of the cards passed are used.
- The page passes every card's id.
- The 8-slot cap and `OTHER_SERIES_COLOR` rule apply to that global rank.
- Pin with a test: the same card has the same colour in a one-card (person-scoped) draw and in the
  household draw.

**A2. The Guide gains the card-roster task.** In Task 9, also add the `cards-reorder` task exactly
as drafted in "Notes for the controller" item 3, placed beside the other Credit Cards › Manage
tasks. Keep the fences green: steps ≤ 160 characters, and every `**Label**` must exist in the UI.
The Guide probes' counts move by one, and lane V updates those probes.

**A3. `src/focusCss.test.ts:80`** (fence extension, approved): replace the literal
`.drag-handle:focus-visible` with `.reorder-grip:focus-visible`. It is the grip that now lives
inside `.categories-scroll` and `.settings-scroll`. Commit it with Task 3.

**A4. The shared save/Undo shape** (Notes item 9) stays per panel in this lane. A consolidation into
one hook is a later, separate decision, taken after R3 and R5 have both landed.

---

## Mechanics (read once)

- **Worktree:** `C:/Users/edyli/personal-finance-dashboard/.worktrees/reorder-r5`, branch
  `feat/reorder-cards`. It is cut from `feat/reorder-base` **after lanes R0 and R1 are merged into
  it**; the base already carries main with the quick-fixes batch's lane B2 (d7a16e6a), which owned
  these Credit Cards files until it merged. Work ONLY inside it.
  - The controller creates it (see "Controller prerequisites") and makes `node_modules` a Windows
    junction to the main checkout's — never `ln -s`, never `npm install`.
  - This plan file is committed to `feat/reorder-base` by the controller before the lane is cut;
    the lane edits only its Results section.
- **Another Claude job** (the quick-fixes batch) is still merging its lanes into main. Never touch
  main, the main checkout, its worktrees or any other `.worktrees/reorder-*`.
- **Tests:**
  - Per task, from the worktree root: the `npx vitest run …` command the task names.
  - vitest globals are off (`vite.config.ts`), so RTL cannot register its own cleanup;
    `CreditCardsPage.test.tsx` already calls `afterEach(cleanup)` — keep it.
  - jsdom has no layout: a keyboard lift measures every row at y=0, so lane R0's hook asks the page
    to scroll the landing slot clear of the top edge, and jsdom implements no `window.scrollBy`.
    Task 3 stubs it in the file's shared `beforeEach`.
  - Never pipe a gate through `tail`/`head`; read the exit code.
- **Types and lint** before every commit: `npx tsc -b` and `npx eslint <the files the task touched>`.
  - `eslint-plugin-react-hooks` 7.x runs the React-Compiler rules (`react-hooks/refs`,
    `react-hooks/immutability`, `react-hooks/set-state-in-effect`, …). The code below passes them:
    no `ref.current` read during render, no `setState` in an effect body, no reassignment of outer
    variables during render.
  - A save closure declared before `useReorder(...)` that calls `reorder.markSaved(...)` inside a
    promise callback passes (lane R3 probed it; this plan's code was linted in that shape).
  - If a rule still fires, fix the code — never add an `eslint-disable`.
- **Gates at the end (Task 10):** the full `npx vitest run`, `npx tsc -b`, `npx eslint .`,
  `npm run build`. Two tests flake under load on this box — re-run each alone before reporting it:
  `PaycheckPage … names the employer match under the waterfall` and
  `OverviewPage … mounts the three snapshot charts`.
- **Browser check (Task 11):** the lane's own servers against the PRIVATE database
  `finance_reorder_r5` — never `finance_realdata` (shared, read-only) and never `finance`.
  - `$PY` = `C:/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe` (notation:
    the tool shell keeps no variables between calls, so spell the path out).
  - Backend: cwd `<worktree>/backend`, env
    `DATABASE_URL=postgresql+asyncpg://finance:finance@localhost:5433/finance_reorder_r5 SCHEDULER_ENABLED=0`,
    `$PY -m uvicorn app.main:app --host 127.0.0.1 --port 8095`.
  - Vite: cwd `<worktree>`, `VITE_API_PROXY=http://127.0.0.1:8095 npx vite --port 5195 --strictPort`.
  - Login `admin@example.com` / `changeme123`.
- **Commits:** small and conventional (`feat(credit-cards): …`, `fix(guide): …`, `docs(plan): …`).
  Never push; never delete files, branches or databases.
- **Scope fence** — this lane edits exactly:
  - `src/components/creditcards/CardsPanel.tsx`;
  - `src/components/creditcards/CategoriesPanel.tsx`;
  - `src/components/creditcards/categories.css` (the retired drag's rules removed; nothing added);
  - `src/components/creditcards/creditLineChartOptions.ts` and `creditLineChartOptions.test.ts`;
  - `src/pages/CreditCardsPage.tsx` — the `lineCards` call site only (one comment, one line);
  - `src/pages/CreditCardsPage.test.tsx` — the reorder tests with the imports, mock-factory
    entries and helpers they need, the EChart stub's colour attribute, the shared `beforeEach`'s
    `scrollBy` stub, and three existing tests (the rewritten categories test, the owner cell index,
    the add-flow body) — all listed under "Existing assertions this lane changes";
  - **the approved fence extension:** `src/guide/content/pages-tracking.tsx`, the
    `cards-hide-category` task's `steps` only (APPROVED by the controller, 2026-09-23);
  - this plan's Results section.

  The browser script lives in the gitignored `scratchpad/reorder-r5/` and is never committed.
  Nothing in `src/components/reorder/**` (R0), `src/api/**` or `src/types/api.ts` (R1),
  `src/components/panels.css`, `roster.css`, `CardDetail.tsx`, `src/charts/fixtures/**` or
  `src/focusCss.test.ts`.

### Controller prerequisites (before the implementer starts)

1. Lane R1 merged into `feat/reorder-base`. At planning time R0 was merged (0d805010, including
   04b417b1 "a held Space or Enter is swallowed") and R1 was not.
2. The worktree and its `node_modules` junction:
   ```bash
   git -C /c/Users/edyli/personal-finance-dashboard worktree add .worktrees/reorder-r5 -b feat/reorder-cards feat/reorder-base
   ```
   ```powershell
   New-Item -ItemType Junction -Path C:\Users\edyli\personal-finance-dashboard\.worktrees\reorder-r5\node_modules -Target C:\Users\edyli\personal-finance-dashboard\node_modules
   ```
3. The private database.
   - `finance_reorder_r5` **already exists**. A read-only census at planning time found 7 cards
     (all active, all `sort_order` 0; six with limit events — Costco Anywhere Visa has none),
     19 reward categories (`sort_order` 0…18), user `admin@example.com`, alembic `f12026091203`.
   - Only if it is missing, create it with `pg_dump | psql` (never `CREATE DATABASE … TEMPLATE`,
     which fails while other sessions hold `finance_realdata`):
     ```bash
     docker exec finance-dashboard-db-1 createdb -U finance finance_reorder_r5
     docker exec finance-dashboard-db-1 sh -c 'pg_dump -U finance finance_realdata | psql -q -v ON_ERROR_STOP=1 -U finance -d finance_reorder_r5'
     ```
4. Migrate it to R1's head from the lane's backend dir. The second command must print
   `f12026092301 (head)`.
   ```bash
   cd /c/Users/edyli/personal-finance-dashboard/.worktrees/reorder-r5/backend
   DATABASE_URL=postgresql+asyncpg://finance:finance@localhost:5433/finance_reorder_r5 /c/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe -m alembic upgrade head
   DATABASE_URL=postgresql+asyncpg://finance:finance@localhost:5433/finance_reorder_r5 /c/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe -m alembic current
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

Consumer rules (R0), each honoured here:
1. Render every item once, `{...reorder.itemProps(id)}` on its `<tr>`, in `items` order.
2. Never set `style.transform`/`style.transition` on those rows; never use `.is-dragging`.
3. `onCommit` sets the optimistic order **synchronously** (it runs inside `flushSync`), then saves;
   `markSaved(moved)` on success; restore the last server order on failure.
4. `disabled: busy`; while disabled the grips are `aria-disabled="true"`, focusable but inert.
5. Disable the row's own action buttons while `reorder.active`.
6. `ReorderInstructions` / `ReorderLiveRegion` render outside the `<table>`.

Behaviour of R0's final code this lane leans on (`src/components/reorder/useReorder.ts` as merged):
- A keyboard drop commits at once and puts focus back on the moved grip; a pointer drop eases into
  its gap for `MOTION_MS.fast` (120 ms), then commits. `active` stays true through that settle.
- A drop where it started commits nothing.
- A lift is cancelled with no commit when `items` change under it, when `disabled` flips (the live
  region then says "Cancelled — the list changed."), on Escape (caught on `window` in the capture
  phase), window blur or resize.
- `handleProps(id).disabled` is `true` when the list holds one item (a lone card).
- `reorder.css` already scopes the lifted and drop-line states to `.reorder-table`, including the
  sticky `td.row-actions` both Credit Cards tables pin (panels.css), and outranks `.data-table` on
  `border-collapse` (`table.reorder-table`, 0,1,1). No per-table CSS is needed.

### From lane R1 — `docs/superpowers/plans/2026-09-23-reorder-r1-backend.md`, "Contracts this lane publishes" (verbatim, the parts this lane uses)

| Method + path | Query | Rows `ids` must match | Renumber | 200 body | Header | Logged | 409 `detail` |
|---|---|---|---|---|---|---|---|
| `PUT /api/v1/credit-cards/order` | — | every card, active and inactive | `sort_order = 0…n−1` | `list[CreditCardOut]`, built exactly as `GET /credit-cards` builds it | none | no | `The cards changed since this list was loaded — nothing was moved.` |
| `PUT /api/v1/credit-cards/categories/order` | — | every reward category | `sort_order = 0…n−1` | `list[RewardCategoryOut]`, new order | none | no | `The reward categories changed since this list was loaded — nothing was moved.` |

Checks in order: an id repeated in `ids` → **422** `ids lists {id} more than once`; `set(ids)`
differs from the rows the list holds → **409** with the sentence above, nothing written; `ids` equal
to the current order → 200, the list as stored, nothing written.

| Request | `sort_order` omitted or `null` | explicit number |
|---|---|---|
| `POST /credit-cards/categories` (`RewardCategoryCreate`) | `coalesce(max(reward_categories.sort_order), −1) + 1` | honoured |
| `POST /credit-cards` (`CreditCardIn`) | `coalesce(max(credit_cards.sort_order), −1) + 1` | honoured |
| `PATCH /credit-cards/{id}` (`CreditCardIn`, full replace) | the stored value is KEPT | honoured |

```ts
// src/api/creditCards.ts
export function reorderCreditCards(ids: number[]): Promise<CreditCardOut[]>
export function reorderRewardCategories(ids: number[]): Promise<RewardCategoryOut[]>
```

- Both send `PUT` with body `JSON.stringify({ ids })`. Cache invalidation is inherited from the
  existing `/credit-cards` `MUTATION_FAMILIES` prefix.
- `CreditCardIn.sort_order` becomes `sort_order?: number | null` (omit it: a create appends, an edit
  keeps the stored value). `RewardCategoryCreate.sort_order?: number` was optional already.
- Failures surface as `ApiError` (`src/api/client.ts`) with the server's sentence as `message` and
  the HTTP status as `status`; a network failure is status 0. `errorDetail(err)` turns one into the
  house's reason phrase. A 409 means "reload the list" (spec §8.3).

### Existing app contracts

- `useToast()` — `src/components/ToastProvider.tsx:56`: `success | info | error(message, { action:
  { label, onAction } })`. Each message renders in `span.toast-message`; errors sit in the
  `role="alert"` region. Without a provider every call is a no-op, which is why the existing page
  tests that render without one keep working.
- `ApiError`, `errorDetail` — `src/api/client.ts:45-68`.
- `onChanged` is `CreditCardsPage`'s `load` (`CreditCardsPage.tsx:129-164`). It refetches all six
  feeds; when the payload JSON-equals the cached snapshot it sets nothing, so `cards` and
  `categories` keep their identity.
- `CardsPanel` receives the page's full `cards` list, active and archived. `CategoriesPanel`
  receives every reward category, hidden ones included. Both GETs order by `(sort_order, id)`.
- `RewardsMatrix` draws its columns in the order of the `cards` prop, which is the page's
  `activeCards`, derived from `cards` in API order (`RewardsMatrix.tsx:218`). So the columns follow
  a reorder by construction — nothing to change there.
- `LocalSectionPanel` renders a view only once it has been visited, then keeps it mounted and
  hidden. A drill-in (`?card=`) unmounts the Manage panels. A toast's Undo still works then: it
  calls the page's `load` and the provider's toast.
- `slotColor(slot)` — `src/charts/entities.ts:28`: `PALETTE[slot]` for 0–7, `OTHER_SERIES_COLOR`
  after.

---

## Decisions this plan takes where the spec is silent

1. **Two order layers per panel, as lane R3 does.**
   - `pendingOrder` holds the dropped order from the drop until the PUT answers, and is cleared
     either way when it does.
   - `savedOrder` holds the server's answer until the page's next fetch replaces the props
     (retired during render — the adjust-during-render idiom `CategoriesPanel` already used).

   Why:
   - A reload that lands mid-save — another panel's Save or Hide calls the same page `load` — must
     not flash the row back.
   - A second drop before the reload must diff against the rows on screen.
   - Both PUTs answer with complete rows carrying the renumbered `sort_order`, so the rows on screen
     are the server's the moment it answers.

   Pinned by Task 6's mid-save test, which fails against a single layer (checked while planning).
2. **Undo shows the server's answer at once**, then calls `onChanged()` and says "Order restored".
   - Lane R3's Undo waits for the page's reload because of its owner scope. These lists have no
     scope.
   - Undo parks the grips (`busy`) for its own request, as in R2 (Decision 4) and R3 (Decision 3).
3. **Failure copy.**
   - The §8.1 `{reason}` is `errorDetail(err)` with its closing stop folded away (`clause`, R3
     Decision 8).
   - A failed Undo: a 409 shows the server's sentence and reloads; anything else says
     "Couldn't restore the order — {reason}." (R3 Decision 4).
   - A failed save offers no Undo.
4. **Focus through a failed save.** The revert runs in `flushSync` and hands focus back
   (`dropPendingOrder`, R3 Decision 9). Reverting an upward move moves the focused grip's own row,
   which blurs it in Chrome.
5. **Reorder failures ride the toast layer.** A reorder neither sets nor clears the panel's
   `FeedBanner`, which describes the form (spec §4.1's rule). The old `persistOrder` put its error
   in the banner.
6. **Names.** The grip, the live region and the toast use the row's `name`: "Reorder Capital One
   Venture X", "Moved Capital One Venture X".
7. **An edit keeps sending the stored `sort_order`** (spec §7), read from the RENDERED rows
   (`ordered`), not from the `cards` prop.
   - Between the PUT's answer and the page's reload, the prop still holds the loaded numbers. A
     full-replace PATCH carrying one would re-tie the card with the row the drag moved into its old
     number, and undo half the drag.
   - Archive's verbatim rebuild and the delete-Undo already take the rendered row.
   - Pinned by Task 8's "an edit after a reorder" test.
8. **A new card omits the key** — `sort_order` absent, not `null`. R1 made
   `CreditCardIn.sort_order` optional (R1 Decision 14), and the server appends.
9. **Categories: the client-side `max + 1` goes.** `createRewardCategory(body)` lets the server
   append (spec §3.3); a number computed from the props could lag a reorder whose reload has not
   landed.
   - The seed keeps its explicit 0…13. It runs only on an empty table, so the result is the same.
   - The delete-Undo keeps re-creating at the stored `sort_order`, an explicit number R1 honours.
     After a renumber, the vacated slot is the deleted row's own.
10. **Colours.** `colourSlots(cards)` ranks the ids among the cards drawn (spec §7), and
    `slotColor(rank)` keeps the 8-slot cap and `OTHER_SERIES_COLOR`.
    - `LimitHistoryCard.id` is OPTIONAL. `CardDetail`'s one-card sparkline and the charts
      conformance fixture are outside the fence; they keep compiling and keep their array-position
      colour (slot 0 for one card).
    - The page passes ids, and a page test (Task 2) pins that. An optional id could otherwise fall
      back to array position without anyone noticing.
11. **Legend and tooltip order.**
    - The builder keeps the list order for the series.
    - The legend sets no `data`, so echarts lists the series in order.
    - `axisTooltip` without `groups` keeps echarts' series order.
    - So both follow the list. Task 1 pins the legend (`not.toHaveProperty('data')`); the existing
      tooltip test pins the rows' order.
12. **No CSS is added.**
    - R0's `reorder.css` already covers `table.reorder-table`, `.reorder-table .reorder-grip-cell`
      and the lifted and drop-line states of the sticky `td.row-actions`.
    - `categories.css` loses the three rules the spec names (`.drag-handle` with its focus ring,
      `tr.drag-over`, `tr.is-dragging`) and also `.categories-table .drag-cell`. That class is dead
      with the old markup, and R0's grip-cell rule carries the same width and padding. Nothing else
      in the file changes.
    - `roster.css` is untouched.
13. **Where the two screen-reader helpers render:** once per list, just before the table (roster)
    or the capped scroller (categories), and only when the table renders.
14. **The tests live in `CreditCardsPage.test.tsx`,** where the existing roster and categories tests
    live; the fence adds no panel test files. Two tiny in-memory servers, `serveCards` and
    `serveCategories`, answer the GET and the reorder PUT, so the page's real `load` runs between a
    save and its reload.
15. **The Guide.** The `cards-hide-category` ordering step is rewritten to lift-and-drop, and one step
    naming the toast's Undo is added. There is no new card-roster task: that would be new content
    outside the approved edit (the Notes offer its text).
16. **The "no native drag left" acceptance** is a source scan of `src/components/creditcards/*.ts(x)`
    for `draggable`, `onDrag…`, `onDrop` and `dataTransfer`, plus a scan of `categories.css` for the
    retired selectors (Task 3).
17. **Order of work: Categories & weights before the card roster.** Once the roster grows grips named
    "Reorder …", the old categories test's `getAllByRole(/^Reorder /)` would pick up the card grips
    first (found while pre-validating). Rewriting that test first avoids an interim edit.
18. **Private database** `finance_reorder_r5` (exists) rather than spec §10's shared
    `finance_reorder_scratch`. The browser check writes only reorder PUTs and puts both orders back.

---

## File map

| File | Change | Tasks |
|---|---|---|
| `src/components/creditcards/creditLineChartOptions.ts` | `LimitHistoryCard.id?`; `colourSlots`; the series colour is `slotColor(slots[i])` | 1 |
| `src/components/creditcards/creditLineChartOptions.test.ts` | fixtures gain ids; one `describe` (4 tests) | 1 |
| `src/pages/CreditCardsPage.tsx` | the `lineCards` map passes `id` (one comment, one line) | 2 |
| `src/components/creditcards/CategoriesPanel.tsx` | shared grip + hook replace the native drag; `pendingOrder`/`savedOrder`; `saveOrder`/`restoreOrder`/`dropPendingOrder`; row buttons shut during a lift; create names no position | 3, 4, 5 |
| `src/components/creditcards/categories.css` | the retired drag's five rule blocks removed (`.drag-cell`, `.drag-handle`, its `:focus-visible`, `tr.is-dragging`, `tr.drag-over td`) | 3 |
| `src/components/creditcards/CardsPanel.tsx` | grip column + hook; the same two layers and three functions; row buttons shut during a lift; create names no position; `stored` read from the rendered rows | 6, 7, 8 |
| `src/pages/CreditCardsPage.test.tsx` | imports, mock factory, EChart stub colours, helpers, `scrollBy` stub; the categories test rewritten; three assertions changed; 8 new `describe` blocks | 2–8 |
| `src/guide/content/pages-tracking.tsx` | the `cards-hide-category` steps (approved fence extension) | 9 |
| `scratchpad/reorder-r5/drag.mjs` (gitignored, never committed) | the browser check | 11 |
| this plan | Results | 12 |

### Existing assertions this lane changes

| File:line (base) | Test | Was | Becomes | Task |
|---|---|---|---|---|
| `creditLineChartOptions.test.ts:13-20` | the `VX` / `BILT` fixtures | no ids | `id: 1` / `id: 2` (their colours are unchanged: PALETTE[0], PALETTE[1]) | 1 |
| `CreditCardsPage.test.tsx:38-60` | the EChart stub | series names only | also `data-series-colors` | 2 |
| `CreditCardsPage.test.tsx:197-205` | the file's `beforeEach` | — | also stubs `window.scrollBy` | 3 |
| `CreditCardsPage.test.tsx:622-656` | `reordering a category is optimistic and PATCHes only the rows that moved` | arrow keys on the old handle; two PATCHes per move | rewritten: Space/↓/Space → ONE `reorderRewardCategories` with the full order; a second move before the refetch diffs against the optimistic order | 3 |
| `CreditCardsPage.test.tsx:772-775` | `shows the owner per row and defaults a NEW card to the primary person` | `querySelectorAll('td')[1]` | `[2]` — the grip column comes first | 6 |
| `CreditCardsPage.test.tsx:491-506` | `roster add flow POSTs the full card body with defaults filled` | body `toMatchObject({ …, sort_order: 0 })` | no `sort_order` in the match, and `not.toHaveProperty('sort_order')` | 8 |

`CreditCardsPage.test.tsx:470-489` (`roster edit preserves is_active and sort_order on the
full-replace PATCH`) stays as it is and keeps passing: an edit still sends the stored value (7).

Line numbers are the base's (`feat/reorder-base` @0d805010); they shift as earlier tasks land — find
the quoted anchor text, not the number.

---

### Task 0: preflight (no commit)

**Files:** none.

- [ ] **Step 1: The base carries R0, R1 and main's B2**

Run (Git Bash, from the worktree root):

```bash
git branch --show-current
git log --oneline -15
ls src/components/reorder
grep -n "export function reorderCreditCards\|export function reorderRewardCategories" src/api/creditCards.ts
grep -n "sort_order?: number | null" src/types/api.ts
grep -n "active: snap.liftedId !== null" src/components/reorder/useReorder.ts
grep -n "draggable" src/components/creditcards/CategoriesPanel.tsx
```

Expected:
- the branch prints `feat/reorder-cards`;
- the log shows the R1 and R0 merges and the main merge (d7a16e6a, B2) on `feat/reorder-base`;
- the folder lists `DragHandle.tsx`, `ReorderStatus.tsx`, `reorder.css`, `reorderDom.ts`,
  `reorderMath.ts`, `reorderTypes.ts`, `useReorder.ts` and their tests;
- the first grep prints two lines, the second one (`CreditCardIn`), the third one;
- the last grep prints the base's `draggable={!busy}` line (the native drag this lane removes).

If anything is missing, stop and report — this lane cannot start.

- [ ] **Step 2: Baseline**

Run: `npx vitest run src/pages/CreditCardsPage.test.tsx src/components/creditcards src/guide src/focusCss.test.ts src/charts/conformance.test.ts`
Expected: PASS — `CreditCardsPage.test.tsx` 47 tests, `creditLineChartOptions.test.ts` 8,
`guideContent.test.ts` 13. Record the totals in Results.

---

### Task 1: a card's credit-line colour is its rank by id (spec §7)

**Files:**
- Modify: `src/components/creditcards/creditLineChartOptions.ts:21-24` (the interface), `:85-99`
  (the builder's head)
- Test: `src/components/creditcards/creditLineChartOptions.test.ts` (head; append one `describe`)

- [ ] **Step 1: Write the failing tests**

In `src/components/creditcards/creditLineChartOptions.test.ts`, replace:

```ts
import { INK, PALETTE } from '../../charts/theme'
import { tooltipRows } from '../../testing/tooltipRows'
import {
  creditLineChartOption,
  creditLineCsv,
  limitMonths,
  monthOf,
  resolvedLimits,
} from './creditLineChartOptions'

const VX = {
  name: 'Venture X',
  events: [
    { effective_date: '2023-05-12', limit_amount: '20000.00' },
    { effective_date: '2024-08-01', limit_amount: '25000.00' },
  ],
}
const BILT = { name: 'BILT', events: [{ effective_date: '2024-02-20', limit_amount: '12500.00' }] }
```

with:

```ts
import { INK, OTHER_SERIES_COLOR, PALETTE } from '../../charts/theme'
import { tooltipRows } from '../../testing/tooltipRows'
import {
  creditLineChartOption,
  creditLineCsv,
  limitMonths,
  monthOf,
  resolvedLimits,
} from './creditLineChartOptions'
import type { LimitHistoryCard } from './creditLineChartOptions'

const VX = {
  id: 1,
  name: 'Venture X',
  events: [
    { effective_date: '2023-05-12', limit_amount: '20000.00' },
    { effective_date: '2024-08-01', limit_amount: '25000.00' },
  ],
}
const BILT = {
  id: 2,
  name: 'BILT',
  events: [{ effective_date: '2024-02-20', limit_amount: '12500.00' }],
}
```

Append at the END of the file:

```ts

// Drag to reorder (2026-09-23 spec §7): the card list's order is the user's, so it sets the
// series order — and with it the legend's and the tooltip's — but never a card's colour. The
// colour is the card's rank BY ID among the cards drawn.
describe('creditLineChartOption — a card keeps its colour wherever it stands', () => {
  const months = ['2024-01-01', '2024-02-01', '2024-09-01']
  const drawn = (cards: LimitHistoryCard[], includeTotal = true) => {
    const option = creditLineChartOption(cards, months, { includeTotal })
    return {
      legend: option.legend,
      series: (option.series as { name: string; color: string }[]).map((s) => [s.name, s.color]),
    }
  }

  it('keeps every colour through a reorder; the series (so the legend and tooltip) follow the list', () => {
    expect(drawn([VX, BILT]).series).toEqual([
      ['Venture X', PALETTE[0]],
      ['BILT', PALETTE[1]],
      ['Total line', INK],
    ])
    // BILT dragged above Venture X: the order moves, no card is repainted.
    const moved = drawn([BILT, VX])
    expect(moved.series).toEqual([
      ['BILT', PALETTE[1]],
      ['Venture X', PALETTE[0]],
      ['Total line', INK],
    ])
    // No legend `data`: echarts lists the legend in series order, so it follows the list too.
    expect(moved.legend).not.toHaveProperty('data')
  })

  it('ranks the ids, not their values — gaps and large ids still take the first slots', () => {
    expect(drawn([{ ...VX, id: 40 }, { ...BILT, id: 7 }]).series).toEqual([
      ['Venture X', PALETTE[1]],
      ['BILT', PALETTE[0]],
      ['Total line', INK],
    ])
  })

  it('folds the ninth id and later into the Other gray, wherever those cards stand', () => {
    // Listed highest id first: id 9 leads the list and still takes the ninth rank.
    const cards = Array.from({ length: 9 }, (_, i) => ({
      id: 9 - i,
      name: `Card ${9 - i}`,
      events: [{ effective_date: '2024-01-01', limit_amount: '1000.00' }],
    }))
    const { series } = drawn(cards, false)
    expect(series.map(([name]) => name)).toEqual(cards.map((card) => card.name))
    expect(series[0][1]).toBe(OTHER_SERIES_COLOR)
    expect(series.slice(1).map(([, color]) => color)).toEqual([...PALETTE].reverse())
  })

  it('keeps the array position when a card is drawn without an id (one card on its own)', () => {
    expect(drawn([{ name: 'Solo', events: VX.events }], false).series).toEqual([
      ['Solo', PALETTE[0]],
    ])
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/components/creditcards/creditLineChartOptions.test.ts`
Expected: 3 FAIL, 9 PASS (12):
- `keeps every colour through a reorder…` → `expected [ [ 'BILT', '#3987e5' ], …(2) ] to deeply
  equal [ [ 'BILT', '#d95926' ], …(2) ]`;
- `ranks the ids, not their values…` → `expected [ [ 'Venture X', '#3987e5' ], …(2) ] to deeply
  equal [ [ 'Venture X', '#d95926' ], …(2) ]`;
- `folds the ninth id…` → `expected '#3987e5' to be '#6b7382'`.

The fourth new test (no id) passes already: it pins today's behaviour for `CardDetail` and the
conformance fixture. (vitest does not type-check; `tsc` sees the new `id` only after Step 3.)

- [ ] **Step 3: Implement**

In `src/components/creditcards/creditLineChartOptions.ts`, replace:

```ts
export interface LimitHistoryCard {
  name: string
  events: { effective_date: string; limit_amount: string }[]
}
```

with:

```ts
export interface LimitHistoryCard {
  /** The card's id — its colour key, so a card keeps its hue wherever the user drags it
   *  (2026-09-23 drag-to-reorder spec §7). Optional for a caller that draws one card's own
   *  history (CardDetail) or a fixture: without ids, a card's slot is its array position. */
  id?: number
  name: string
  events: { effective_date: string; limit_amount: string }[]
}
```

and replace:

```ts
/** Per-card step lines + optional INK Total. PALETTE slots are fixed by array
 *  position; a 9th+ card wears OTHER_SERIES_COLOR (never cycle past 8 — theme law). */
export function creditLineChartOption(
  cards: LimitHistoryCard[],
  months: string[],
  { includeTotal, selected }: { includeTotal: boolean; selected?: Record<string, boolean> },
): EChartsOption {
  const perCard = cards.map((card) => resolvedLimits(card, months))
  const series = [
    ...cards.map((card, i) => ({
      ...LINE,
      name: card.name,
      step: 'end' as const, // limits change discretely — steps, not slopes
      color: slotColor(i),
```

with:

```ts
/** Each card's PALETTE slot: its rank BY ID among the cards drawn (2026-09-23 drag-to-reorder
 *  spec §7). The list order is the user's — it sets the series, legend and tooltip order — and a
 *  reorder must never repaint a card. When any card comes without an id (one card's own history,
 *  a fixture), every card keeps its array position. */
export function colourSlots(cards: readonly LimitHistoryCard[]): number[] {
  const ids: number[] = []
  for (const card of cards) {
    if (card.id === undefined) return cards.map((_, index) => index)
    ids.push(card.id)
  }
  const ranked = [...ids].sort((a, b) => a - b)
  return ids.map((id) => ranked.indexOf(id))
}

/** Per-card step lines + optional INK Total, in the list's order. A card's colour is its
 *  colourSlots rank, so it survives a reorder; a 9th+ rank wears OTHER_SERIES_COLOR (never cycle
 *  past 8 — theme law). */
export function creditLineChartOption(
  cards: LimitHistoryCard[],
  months: string[],
  { includeTotal, selected }: { includeTotal: boolean; selected?: Record<string, boolean> },
): EChartsOption {
  const perCard = cards.map((card) => resolvedLimits(card, months))
  const slots = colourSlots(cards)
  const series = [
    ...cards.map((card, i) => ({
      ...LINE,
      name: card.name,
      step: 'end' as const, // limits change discretely — steps, not slopes
      color: slotColor(slots[i]),
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/components/creditcards/creditLineChartOptions.test.ts src/charts/conformance.test.ts`
Expected: PASS — 12 tests in `creditLineChartOptions.test.ts`; the conformance suite unchanged (its
`creditLine` fixture has no ids and keeps its colours).

- [ ] **Step 5: Type-check, lint, commit**

```bash
npx tsc -b && npx eslint src/components/creditcards/creditLineChartOptions.ts src/components/creditcards/creditLineChartOptions.test.ts
git add src/components/creditcards/creditLineChartOptions.ts src/components/creditcards/creditLineChartOptions.test.ts
git commit -m "feat(credit-cards): a card's credit-line colour is its rank by id, so a reorder never repaints it"
```

---

### Task 2: the page hands the chart its card ids (spec §7)

**Files:**
- Modify: `src/pages/CreditCardsPage.tsx:312-318` (the `lineCards` memo — one comment, one line)
- Test: `src/pages/CreditCardsPage.test.tsx` (one import; the EChart stub; append one `describe`)

- [ ] **Step 1: Write the failing test**

In `src/pages/CreditCardsPage.test.tsx`, replace:

```ts
import CreditCardsPage from './CreditCardsPage'
import { expectInDocumentOrder } from '../testing/domOrder'
```

with:

```ts
import CreditCardsPage from './CreditCardsPage'
import { INK, PALETTE } from '../charts/theme'
import { expectInDocumentOrder } from '../testing/domOrder'
```

Replace the EChart stub:

```ts
// ECharts never renders in jsdom (house law): the stub exposes the slices these tests
// pin — series names for the two chart cards — via data-* attributes.
vi.mock('../components/EChart', async () => {
  const { createElement } = await import('react')
  return {
    default: ({
      option,
      ariaLabel,
      animateEntrance = true,
    }: {
      option: { series?: { name?: string }[] }
      ariaLabel?: string
      animateEntrance?: boolean
    }) =>
      createElement('div', {
        'data-testid': 'echart',
        'aria-label': ariaLabel,
        'data-series-names': (option.series ?? []).map((s) => s.name ?? '').join('|'),
        // A cached paint must render still (2026-08-27 spec §1).
        'data-animate': String(animateEntrance),
      }),
  }
})
```

with:

```ts
// ECharts never renders in jsdom (house law): the stub exposes the slices these tests
// pin — series names and colours for the two chart cards — via data-* attributes.
vi.mock('../components/EChart', async () => {
  const { createElement } = await import('react')
  return {
    default: ({
      option,
      ariaLabel,
      animateEntrance = true,
    }: {
      option: { series?: { name?: string; color?: string }[] }
      ariaLabel?: string
      animateEntrance?: boolean
    }) =>
      createElement('div', {
        'data-testid': 'echart',
        'aria-label': ariaLabel,
        'data-series-names': (option.series ?? []).map((s) => s.name ?? '').join('|'),
        // The credit-line chart keys each colour to its card (2026-09-23 drag-to-reorder §7).
        'data-series-colors': (option.series ?? []).map((s) => s.color ?? '').join('|'),
        // A cached paint must render still (2026-08-27 spec §1).
        'data-animate': String(animateEntrance),
      }),
  }
})
```

Append at the END of the file:

```tsx

// ── Drag to reorder (2026-09-23 drag-to-reorder spec §7) ──────────────────────────────────────

describe('CreditCardsPage — the credit-line colours follow the card, not its place', () => {
  it('keys each line to its card id: a card moved up the list keeps its colour', async () => {
    // SavorOne stands first — as it would after a drag — and still wears slot 1 (id 2), while
    // Venture X keeps slot 0 (id 1). The series order is the list's.
    vi.mocked(fetchCreditCards).mockResolvedValue([SAVOR, vx(), RH])
    renderPage('/credit-cards?section=lines')
    await screen.findByText('Credit line history')
    const line = screen
      .getAllByTestId('echart')
      .find((el) => (el.getAttribute('data-series-names') ?? '').includes('Total line'))
    expect(line?.getAttribute('data-series-names')).toBe('SavorOne|Venture X|Total line')
    expect(line?.getAttribute('data-series-colors')).toBe(`${PALETTE[1]}|${PALETTE[0]}|${INK}`)
  })
})
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run src/pages/CreditCardsPage.test.tsx`
Expected: 1 FAIL, 47 PASS (48) — `expected '#3987e5|#d95926|#e6e9ef' to be
'#d95926|#3987e5|#e6e9ef'`: without ids the builder still colours by array position.

- [ ] **Step 3: Implement**

In `src/pages/CreditCardsPage.tsx`, replace:

```ts
      activeCards
        .filter((card) => card.limit_events.length > 0)
        .map((card) => ({ name: card.name, events: card.limit_events })),
```

with:

```ts
      activeCards
        .filter((card) => card.limit_events.length > 0)
        // The id keys each line's colour, so a reorder never repaints a card (2026-09-23
        // drag-to-reorder spec §7); the list order still sets the series and legend order.
        .map((card) => ({ id: card.id, name: card.name, events: card.limit_events })),
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/pages/CreditCardsPage.test.tsx src/components/creditcards/creditLineChartOptions.test.ts`
Expected: PASS — 48 page tests, 12 option tests.

- [ ] **Step 5: Type-check, lint, commit**

```bash
npx tsc -b && npx eslint src/pages/CreditCardsPage.tsx src/pages/CreditCardsPage.test.tsx
git add src/pages/CreditCardsPage.tsx src/pages/CreditCardsPage.test.tsx
git commit -m "feat(credit-cards): the credit-line chart keys each colour to its card id"
```

---

### Task 3: Categories & weights — the shared grip replaces the native drag; one PUT per drop (spec §7, §9)

**Files:**
- Modify: `src/components/creditcards/CategoriesPanel.tsx` — the imports (`:1-11`), the drag state
  (`:81-97`), `persistOrder` + `moveRow` (`:209-243`), and the table block (`:379-514`)
- Modify: `src/components/creditcards/categories.css:38-61`
- Test: `src/pages/CreditCardsPage.test.tsx` — the head, the mock factory, the helpers, the shared
  `beforeEach`, the rewritten test (`:622-656`); append two `describe` blocks

- [ ] **Step 1: Write the failing tests**

In `src/pages/CreditCardsPage.test.tsx`:

**1a — the head.** Replace the first line:

```ts
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
```

with:

```ts
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
```

**1b — the mock factory.** Replace:

```ts
  createRewardCategory: vi.fn(),
  updateRewardCategory: vi.fn(),
  deleteRewardCategory: vi.fn(),
}))
```

with:

```ts
  createRewardCategory: vi.fn(),
  updateRewardCategory: vi.fn(),
  deleteRewardCategory: vi.fn(),
  // The two reorder PUTs (lane R1). Every reorder test answers them or leaves them pending.
  reorderCreditCards: vi.fn(),
  reorderRewardCategories: vi.fn(),
}))
```

**1c — the imports from the mocked module.** Replace:

```ts
  putRewardRates,
  updateCardCredit,
```

with:

```ts
  putRewardRates,
  reorderRewardCategories,
  updateCardCredit,
```

**1d — the helpers.** Insert directly after the closing `}` of `matrixRow` (and before the file's
shared `beforeEach(() => {`):

```tsx

// ── Drag-to-reorder helpers (2026-09-23 drag-to-reorder spec §7) ─────────────────────────────

/** The page inside a ToastProvider, on Manage — the reorder toasts and their Undo live there. */
function renderManage() {
  return render(
    <MemoryRouter initialEntries={['/credit-cards?section=manage']}>
      <ToastProvider>
        <CreditCardsPage />
      </ToastProvider>
    </MemoryRouter>,
  )
}

/** A row's grip, by the name it is announced with ("Reorder Venture X"). */
const grip = (name: string) => screen.getByRole('button', { name: `Reorder ${name}` })

/** The keyboard path (spec §2.4): focus the grip, Space lifts, `key` moves one place, Space
 *  drops. */
function keyboardMove(name: string, key: 'ArrowUp' | 'ArrowDown'): void {
  grip(name).focus()
  fireEvent.keyDown(grip(name), { key: ' ' })
  fireEvent.keyDown(grip(name), { key })
  fireEvent.keyDown(grip(name), { key: ' ' })
}

/** A table's row ids, top to bottom, as rendered. */
const rowIds = (table: '.roster-table' | '.categories-table') =>
  [...document.querySelectorAll(`${table} tbody tr`)].map((row) => row.getAttribute('data-reorder-id'))

/** A tiny server for the reward categories: the GET answers the stored order; the reorder PUT
 *  stores the order it is sent — renumbered 0…n−1, as lane R1's route does — and answers with it. */
function serveCategories(initial: RewardCategoryOut[] = CATEGORIES): void {
  let stored = initial
  vi.mocked(fetchRewardCategories).mockImplementation(async () => stored)
  vi.mocked(reorderRewardCategories).mockImplementation(async (ids) => {
    const byId = new Map(stored.map((category) => [category.id, category]))
    stored = ids.flatMap((id, index) => {
      const category = byId.get(id)
      return category === undefined ? [] : [{ ...category, sort_order: index }]
    })
    return stored
  })
}
```

**1e — the shared `beforeEach`.** Replace:

```ts
  localStorage.clear()
  seedHappyPath()
})
```

with:

```ts
  localStorage.clear()
  seedHappyPath()
  // jsdom has no layout: a keyboard lift measures every row at y=0, so lane R0's hook asks the
  // page to scroll the landing slot clear of the top edge — and jsdom implements no scrollBy.
  window.scrollBy = vi.fn()
})
```

**1f — the rewrite (spec §7: "Space → ↓ → Space → one PUT with the full order; a second move
before the refetch diffs against the optimistic order").** Replace the whole test that starts
`  it('reordering a category is optimistic and PATCHes only the rows that moved', async () => {`
— down to its closing `  })`, just above `  it('empty state: no categories → the seed button renders'`
— with:

```tsx
  it('reordering a category is one PUT of the whole new order, and a second move before the refetch diffs against the optimistic order', async () => {
    serveCategories()
    renderPage('/credit-cards?section=manage')
    await screen.findByText('Categories & weights')
    // The page's reload never lands in this test: every move below has only the rows on screen
    // to go by, never the props the page loaded with.
    vi.mocked(fetchRewardCategories).mockReturnValue(new Promise<never>(() => {}))
    // Lift-and-drop from the keyboard (2026-09-23 drag-to-reorder spec §2.4): Space lifts
    // Groceries, ↓ moves it one place, Space drops it.
    keyboardMove('Groceries', 'ArrowDown')
    // ONE PUT, carrying every reward category in the new order (spec §7).
    expect(reorderRewardCategories).toHaveBeenCalledTimes(1)
    expect(reorderRewardCategories).toHaveBeenLastCalledWith([11, 10, 12])
    // Optimistic: the list re-renders in the new order before any refetch lands.
    expect(rowIds('.categories-table')).toEqual(['11', '10', '12'])
    // The grips wake when the PUT answers.
    await waitFor(() => expect(grip('Groceries').getAttribute('aria-disabled')).toBeNull())
    // Regression (the live-check find this test was first written for): a SECOND move before
    // the refetch lands must diff against the optimistic order, not the loaded one — moving
    // Groceries back up is a real move, never a silent no-op.
    keyboardMove('Groceries', 'ArrowUp')
    expect(reorderRewardCategories).toHaveBeenCalledTimes(2)
    expect(reorderRewardCategories).toHaveBeenLastCalledWith([10, 11, 12])
    // The per-row PATCH chain is gone: a reorder never PATCHes a row.
    expect(updateRewardCategory).not.toHaveBeenCalled()
  })
```

**1g — two new blocks.** Append at the END of the file:

```tsx

describe('CreditCardsPage — reorder Categories & weights (2026-09-23 drag-to-reorder spec §7)', () => {
  beforeEach(() => {
    vi.mocked(reorderRewardCategories).mockReset()
  })

  it('puts a grip first on every row — hidden ones too — on a reorderable table', async () => {
    serveCategories([CATEGORIES[0], CATEGORIES[1], { ...CATEGORIES[2], is_active: false }])
    renderManage()
    await screen.findByText('Categories & weights')
    const table = document.querySelector('.categories-table') as HTMLTableElement
    expect(table.className).toBe('data-table categories-table reorder-table')
    const head = table.querySelector('thead tr')?.firstElementChild
    expect(head?.className).toBe('reorder-grip-cell')
    expect(head?.getAttribute('aria-hidden')).toBe('true')
    for (const row of table.querySelectorAll('tbody tr')) {
      expect(row.firstElementChild?.className).toBe('reorder-grip-cell')
    }
    expect(
      [...table.querySelectorAll('tbody .reorder-grip')].map((button) =>
        button.getAttribute('aria-label'),
      ),
    ).toEqual(['Reorder Groceries', 'Reorder Dining', 'Reorder Rent'])
    // A hidden row keeps its place and moves like any other (spec §9).
    expect((grip('Rent') as HTMLButtonElement).disabled).toBe(false)
    // The native drag is gone: no row can be picked up by the browser itself.
    expect(table.querySelectorAll('[draggable]')).toHaveLength(0)
    // One description for the list's grips, outside the capped scroller's table.
    const instructions = document.getElementById(
      grip('Groceries').getAttribute('aria-describedby') ?? '',
    )
    expect(instructions?.textContent).toBe(
      'Press Space or Enter to pick up. Use the arrow keys to move, Home or End to jump, Space or Enter to drop, Escape to cancel.',
    )
    expect(table.contains(instructions)).toBe(false)
  })

  it('keeps the grips focusable but inert while any request of the panel is in flight', async () => {
    serveCategories()
    // A hide that never settles: the panel stays busy for the rest of the test.
    vi.mocked(updateRewardCategory).mockReturnValueOnce(new Promise<never>(() => {}))
    renderManage()
    await screen.findByText('Categories & weights')
    fireEvent.click(screen.getByRole('button', { name: 'Hide Rent' }))
    const handle = grip('Dining') as HTMLButtonElement
    expect(handle.getAttribute('aria-disabled')).toBe('true')
    expect(handle.disabled).toBe(false)
    handle.focus()
    fireEvent.keyDown(handle, { key: ' ' })
    expect(handle.getAttribute('aria-pressed')).toBeNull()
    expect(reorderRewardCategories).not.toHaveBeenCalled()
  })

  it('flashes the moved row, says "Moved Dining", and the page reloads the list', async () => {
    serveCategories()
    renderManage()
    await screen.findByText('Categories & weights')
    keyboardMove('Dining', 'ArrowUp')
    expect(await screen.findByText('Moved Dining')).toBeTruthy()
    expect(reorderRewardCategories).toHaveBeenCalledWith([11, 10, 12])
    expect(
      document
        .querySelector('.categories-table tr[data-reorder-id="11"]')
        ?.hasAttribute('data-reorder-saved'),
    ).toBe(true)
    // The mount's fetch, then the reload the save asked for.
    expect(fetchRewardCategories).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(grip('Rent').getAttribute('aria-disabled')).toBeNull())
    expect(rowIds('.categories-table')).toEqual(['11', '10', '12'])
    // Focus stays on the moved grip through the save (lane R0 restores it after the drop).
    expect(document.activeElement).toBe(grip('Dining'))
  })
})

describe('Credit cards — the native drag is gone (2026-09-23 drag-to-reorder spec §7 acceptance)', () => {
  const folder = path.resolve(__dirname, '../components/creditcards')

  it('no source under src/components/creditcards sets draggable or handles an HTML5 drag event', () => {
    const offenders = readdirSync(folder)
      .filter((name) => /\.tsx?$/.test(name))
      .filter((name) =>
        /\bdraggable\b|\bonDrag\w*|\bonDrop\b|dataTransfer/.test(
          readFileSync(path.join(folder, name), 'utf8'),
        ),
      )
    expect(offenders).toEqual([])
  })

  it('categories.css keeps no rule of the retired drag', () => {
    const css = readFileSync(path.join(folder, 'categories.css'), 'utf8')
    expect(css).not.toMatch(/\.drag-handle|\.drag-over|\.drag-cell|\.is-dragging/)
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/pages/CreditCardsPage.test.tsx`
Expected: 6 FAIL, 47 PASS (53):
- the rewritten test → `Unable to find an accessible element with the role "button" and name
  "Reorder Groceries"`;
- `puts a grip first on every row…` → `expected 'data-table categories-table' to be 'data-table
  categories-table reorder-table'`;
- `keeps the grips focusable but inert…` and `flashes the moved row…` → `Unable to find an
  accessible element with the role "button" and name "Reorder Dining"`;
- `no source … sets draggable…` → `expected [ 'CategoriesPanel.tsx' ] to deeply equal []`;
- `categories.css keeps no rule…` → `expected '.categories-form {\n  display: grid;\…' not to match
  /\.drag-handle|\.drag-over|\.drag-cell…/`.

- [ ] **Step 3: Implement**

In `src/components/creditcards/CategoriesPanel.tsx`:

**3a — imports.** Replace:

```ts
import { useRef, useState } from 'react'
import { GripVertical } from 'lucide-react'
import { ApiError } from '../../api/client'
import {
  createRewardCategory,
  deleteRewardCategory,
  updateRewardCategory,
} from '../../api/creditCards'
import AmountInput from '../AmountInput'
import InfoHint from '../InfoHint'
import { useToast } from '../ToastProvider'
```

with:

```ts
import { useState } from 'react'
import { ApiError } from '../../api/client'
import {
  createRewardCategory,
  deleteRewardCategory,
  reorderRewardCategories,
  updateRewardCategory,
} from '../../api/creditCards'
import AmountInput from '../AmountInput'
import InfoHint from '../InfoHint'
import DragHandle from '../reorder/DragHandle'
import { ReorderInstructions, ReorderLiveRegion } from '../reorder/ReorderStatus'
import { useReorder } from '../reorder/useReorder'
import { useToast } from '../ToastProvider'
```

**3b — the order state.** Replace:

```ts
  const [busy, setBusy] = useState(false)
  // Drag-reorder state. pendingOrder renders IMMEDIATELY on drop (optimistic) and is
  // retired the moment fresh props arrive from the refetch — the adjust-during-render
  // pattern below, not an effect (react-hooks/set-state-in-effect stays clean).
  const [pendingOrder, setPendingOrder] = useState<RewardCategoryOut[] | null>(null)
  const [lastCategories, setLastCategories] = useState(categories)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  // Only the grip arms a row drag — a click-drag on Edit or a text selection must not
  // pick the row up (the standard drag-handle recipe).
  const dragArmed = useRef(false)
  const toast = useToast()

  if (lastCategories !== categories) {
    setLastCategories(categories)
    setPendingOrder(null)
  }
  const ordered = pendingOrder ?? categories
```

with:

```ts
  const [busy, setBusy] = useState(false)
  // Drag to reorder (2026-09-23 drag-to-reorder spec §7). Two layers sit over the page's
  // `categories`, and only a reorder sets either:
  //   pendingOrder — the dropped order, from the moment the grip lets go until the PUT
  //                  answers (optimistic), cleared either way when it does;
  //   savedOrder   — the server's answer, until the page's next fetch replaces `categories`
  //                  (retired during render — the adjust-during-render pattern below, not an
  //                  effect, so react-hooks/set-state-in-effect stays clean).
  // A reload that lands mid-save never flashes a row back to where it came from, and a
  // second move before the reload diffs against the rows on screen, never the stale props
  // (the live-check find the page test pins).
  const [pendingOrder, setPendingOrder] = useState<RewardCategoryOut[] | null>(null)
  const [savedOrder, setSavedOrder] = useState<RewardCategoryOut[] | null>(null)
  const [lastCategories, setLastCategories] = useState(categories)
  const toast = useToast()

  if (lastCategories !== categories) {
    setLastCategories(categories)
    setSavedOrder(null)
  }
  const ordered = pendingOrder ?? savedOrder ?? categories
  const categoryById = new Map(ordered.map((category) => [category.id, category]))
```

**3c — one PUT per drop.** Replace:

```ts
  /** Persist a new order: sort_order = list index, PATCHing only rows whose stored
   *  value differs (an adjacent swap writes exactly two rows). Sequential chain — the
   *  seed's idiom. The refetch re-orders the matrix too (GET orders by sort_order). */
  const persistOrder = (next: RewardCategoryOut[]) => {
    // The optimistic rows must CARRY the sort_orders being persisted: a second move
    // before the refetch lands diffs against these fields, and stale values would make
    // it a silent no-op (found by the live browser check, pinned in the page test).
    setPendingOrder(next.map((category, index) => ({ ...category, sort_order: index })))
    setBusy(true)
    setError(null)
    next
      .reduce(
        (chain, category, index) =>
          category.sort_order === index
            ? chain
            : chain.then(() =>
                updateRewardCategory(category.id, { sort_order: index }).then(() => undefined),
              ),
        Promise.resolve<undefined>(undefined),
      )
      .then(() => onChanged())
      .catch((err: unknown) => {
        setPendingOrder(null) // snap back to the server's truth
        setError(message(err, 'Reorder failed'))
      })
      .finally(() => setBusy(false))
  }

  const moveRow = (from: number, to: number) => {
    if (busy || to < 0 || to >= ordered.length || from === to) return
    const next = [...ordered]
    const [row] = next.splice(from, 1)
    next.splice(to, 0, row)
    persistOrder(next)
  }
```

with:

```ts
  // One drop, one PUT (spec §7): every reward category, hidden ones included, in its new
  // order. The server renumbers them in ONE transaction, so a failure can no longer leave a
  // half-saved order (the per-row PATCH chain this replaces could). The matrix rows follow
  // once the page reloads. `reorder` is read only when the PUT answers, long after the render
  // that declares it below has returned.
  const saveOrder = (next: number[], moved: number) => {
    const category = categoryById.get(moved)
    if (category === undefined) return // the hook commits only ids it was handed
    // Synchronously: the hook calls onCommit inside flushSync, so the new DOM order and the
    // cleared drag transforms land in one frame (lane R0 consumer rule 3).
    setPendingOrder(
      next.flatMap((id) => {
        const row = categoryById.get(id)
        return row === undefined ? [] : [row]
      }),
    )
    setBusy(true)
    reorderRewardCategories(next)
      .then((saved) => {
        setPendingOrder(null)
        setSavedOrder(saved)
        onChanged()
        reorder.markSaved(moved)
        toast.success(`Moved ${category.name}`)
      })
      .catch(() => setPendingOrder(null))
      .finally(() => setBusy(false))
  }

  const reorder = useReorder({
    items: ordered.map((category) => ({ id: category.id })),
    labelOf: (id) => categoryById.get(id)?.name ?? 'this category',
    // Any request of the panel in flight — a save, a hide, a delete, the seed, a reorder —
    // leaves the grips focusable but inert (lane R0 consumer rule 4), so a drop never races
    // a save.
    disabled: busy,
    onCommit: saveOrder,
  })
```

**3d — the table.** Replace the whole block — from `      {categories.length > 0 && (` down to
the `      )}` that closes it, just above `    </section>` — with:

```tsx
      {categories.length > 0 && (
        <>
          {/* Once per list and outside the table — a <span> is not a valid child of one (lane
              R0 consumer rule 6). Every grip points its aria-describedby at the instructions. */}
          <ReorderInstructions id={reorder.instructionsId} />
          <ReorderLiveRegion text={reorder.announcement} />
          {/* Capped + scrollable past ~10 rows (sticky header): the row list grows with every
              niche MCC category, and the rest of the page must stay reachable (wherever this
              panel sits — the 2026-08-31 reorder moved it below the matrix). A drag near its
              edge scrolls the box; a keyboard move keeps the landing row in view (lane R0). */}
          <div className="categories-scroll">
            <table className="data-table categories-table reorder-table">
              <thead>
                <tr>
                  <th className="reorder-grip-cell" aria-hidden="true" />
                  <th>Category</th>
                  <th className="num">Weight ($/yr est.)</th>
                  <th>Mapped spending category</th>
                  <th>Pinned card</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {ordered.map((category) => (
                  <tr
                    key={category.id}
                    {...reorder.itemProps(category.id)}
                    className={category.id === editingId ? 'is-editing' : undefined}
                  >
                    {/* Every row, hidden ones included, keeps its place and moves (spec §9). */}
                    <td className="reorder-grip-cell">
                      <DragHandle name={category.name} {...reorder.handleProps(category.id)} />
                    </td>
                    <td>{category.name}</td>
                    <td className="num">{weightCell(category)}</td>
                    <td>
                      {category.spending_category_id === null
                        ? '—'
                        : (spendingName.get(category.spending_category_id) ?? '—')}
                    </td>
                    <td>
                      {category.pinned_card_id === null
                        ? '—'
                        : (cardName.get(category.pinned_card_id) ?? '—')}
                    </td>
                    <td>
                      <span className="badge">{category.is_active ? 'Active' : 'Hidden'}</span>
                    </td>
                    <td className="row-actions">
                      <button
                        type="button"
                        className="button"
                        aria-label={`Edit ${category.name}`}
                        disabled={busy}
                        onClick={() => startEdit(category)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="button"
                        aria-label={
                          category.is_active ? `Hide ${category.name}` : `Show ${category.name}`
                        }
                        disabled={busy}
                        onClick={() => toggleActive(category)}
                      >
                        {category.is_active ? 'Hide' : 'Show'}
                      </button>
                      <button
                        type="button"
                        className="button"
                        aria-label={`Delete ${category.name}`}
                        disabled={busy}
                        onClick={() => remove(category)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
```

**3e — the retired drag's CSS.** In `src/components/creditcards/categories.css`, delete these rules
(between `.categories-table td .sub { … }` and the comment that starts `/* Same panel-scoped
row-action/edited-row rules as roster.css`); keep everything else:

```css
.categories-table .drag-cell {
  width: 2rem;
  padding-right: 0;
}
.drag-handle {
  display: inline-flex;
  align-items: center;
  background: none;
  border: 0;
  padding: 2px;
  color: var(--muted);
  cursor: grab;
}
.drag-handle:focus-visible {
  outline: 2px solid var(--accent);
  border-radius: 4px;
}
.categories-table tr.is-dragging {
  opacity: 0.5;
}
/* The drop indicator: an accent seam above the row the drag is hovering. */
.categories-table tr.drag-over td {
  border-top: 2px solid var(--accent);
}
```

(R0's `reorder.css` now draws the grip — `.reorder-grip` with its own `:focus-visible` ring, which
`index.css`'s inset rule for `.categories-scroll` draws inside the box — and the grip column,
`.reorder-table .reorder-grip-cell`, at the same `width: 2rem; padding-right: 0`.)

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/pages/CreditCardsPage.test.tsx src/focusCss.test.ts`
Expected: PASS — 53 page tests; `focusCss.test.ts` unchanged (it compares specificities of literal
selector strings and reads no creditcards CSS).

- [ ] **Step 5: Type-check, lint, commit**

```bash
npx tsc -b && npx eslint src/components/creditcards/CategoriesPanel.tsx src/pages/CreditCardsPage.test.tsx
git add src/components/creditcards/CategoriesPanel.tsx src/components/creditcards/categories.css src/pages/CreditCardsPage.test.tsx
git commit -m "feat(credit-cards): Categories & weights reorder through the shared grip — one PUT per drop, optimistic, then the server's order; the native HTML5 drag and its PATCH chain are gone"
```

`eslint` prints one warning, `CategoriesPanel.tsx … react-refresh/only-export-components` on
`export const SEED_CATEGORIES`. It is already on the base (line 20) and is not this lane's; the exit
code is 0.

---

### Task 4: Categories & weights — Undo, and a save that fails (spec §7, §8.1, §8.3)

**Files:**
- Modify: `src/components/creditcards/CategoriesPanel.tsx` (two imports; a `clause` helper after
  `message`; Task 3's `saveOrder` replaced by three functions)
- Test: `src/pages/CreditCardsPage.test.tsx` (one import; one constant in the helpers; append one
  `describe`)

- [ ] **Step 1: Write the failing tests**

In `src/pages/CreditCardsPage.test.tsx`, replace:

```ts
import { clearSnapshots, setSnapshot } from '../api/snapshotCache'
```

with:

```ts
import { ApiError } from '../api/client'
import { clearSnapshots, setSnapshot } from '../api/snapshotCache'
```

Replace the helpers' header line:

```ts
// ── Drag-to-reorder helpers (2026-09-23 drag-to-reorder spec §7) ─────────────────────────────
```

with:

```ts
// ── Drag-to-reorder helpers (2026-09-23 drag-to-reorder spec §7) ─────────────────────────────

// Lane R1's stale-list sentence for the reward categories (spec §8.3).
const STALE_CATEGORIES =
  'The reward categories changed since this list was loaded — nothing was moved.'
```

Append at the END of the file:

```tsx

describe('CreditCardsPage — Categories & weights: Undo, and a save that fails (spec §7, §8.1, §8.3)', () => {
  beforeEach(() => {
    vi.mocked(reorderRewardCategories).mockReset()
  })

  it('Undo re-sends the order that stood before the drop, shows it and says so', async () => {
    serveCategories()
    renderManage()
    await screen.findByText('Categories & weights')
    keyboardMove('Dining', 'ArrowUp')
    await screen.findByText('Moved Dining')
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByText('Order restored')).toBeTruthy()
    expect(vi.mocked(reorderRewardCategories).mock.calls).toEqual([[[11, 10, 12]], [[10, 11, 12]]])
    // The server's answer shows at once, and the page reloads behind it.
    expect(rowIds('.categories-table')).toEqual(['10', '11', '12'])
    expect(fetchRewardCategories).toHaveBeenCalledTimes(3)
  })

  it.each([
    { status: 500, detail: 'Internal Server Error', reason: 'the server had a problem (HTTP 500)' },
    // A server sentence that brings its own stop: ours closes it, once.
    { status: 422, detail: 'ids lists 12 more than once.', reason: 'ids lists 12 more than once' },
  ])('puts the rows back, keeps the grip focused and says why ($status)', async ({ status, detail, reason }) => {
    serveCategories()
    vi.mocked(reorderRewardCategories).mockRejectedValueOnce(new ApiError(detail, status))
    renderManage()
    await screen.findByText('Categories & weights')
    keyboardMove('Rent', 'ArrowUp')
    expect(
      await screen.findByText(
        `Couldn't save the new order — ${reason}. The list is back to how it was.`,
      ),
    ).toBeTruthy()
    expect(rowIds('.categories-table')).toEqual(['10', '11', '12'])
    expect(document.activeElement).toBe(grip('Rent'))
    expect(fetchRewardCategories).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it("shows a stale list's server sentence, puts the rows back and reloads (409)", async () => {
    serveCategories()
    vi.mocked(reorderRewardCategories).mockRejectedValueOnce(new ApiError(STALE_CATEGORIES, 409))
    renderManage()
    await screen.findByText('Categories & weights')
    keyboardMove('Groceries', 'ArrowDown')
    expect(await screen.findByText(STALE_CATEGORIES)).toBeTruthy()
    expect(rowIds('.categories-table')).toEqual(['10', '11', '12'])
    expect(fetchRewardCategories).toHaveBeenCalledTimes(2)
    expect(screen.queryByText(/Couldn't save the new order/)).toBeNull()
  })

  it.each([
    {
      status: 500,
      detail: 'Internal Server Error',
      text: "Couldn't restore the order — the server had a problem (HTTP 500).",
      fetches: 2,
    },
    { status: 409, detail: STALE_CATEGORIES, text: STALE_CATEGORIES, fetches: 3 },
  ])('says why an Undo was refused ($status), reloading a stale list', async ({ status, detail, text, fetches }) => {
    serveCategories()
    renderManage()
    await screen.findByText('Categories & weights')
    keyboardMove('Groceries', 'ArrowDown')
    await screen.findByText('Moved Groceries')
    vi.mocked(reorderRewardCategories).mockRejectedValueOnce(new ApiError(detail, status))
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByText(text)).toBeTruthy()
    expect(fetchRewardCategories).toHaveBeenCalledTimes(fetches)
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/pages/CreditCardsPage.test.tsx`
Expected: 6 FAIL, 53 PASS (59):
- the Undo test and both `says why an Undo was refused` cases → `Unable to find an accessible
  element with the role "button" and name "Undo"`;
- `puts the rows back… (500)` → `Unable to find an element with the text: Couldn't save the new
  order — the server had a problem (HTTP 500). The list is back to how it was.`, and the same shape
  for `(422)`;
- the 409 test → `Unable to find an element with the text: The reward categories changed since this
  list was loaded — nothing was moved.`

Task 3's `catch` reverts silently and its toast has no Undo.

- [ ] **Step 3: Implement**

In `src/components/creditcards/CategoriesPanel.tsx`:

**3a — imports.** Replace:

```ts
import { useState } from 'react'
import { ApiError } from '../../api/client'
```

with:

```ts
import { useState } from 'react'
import { flushSync } from 'react-dom'
import { ApiError, errorDetail } from '../../api/client'
```

**3b — `clause`.** Replace:

```ts
function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}
```

with:

```ts
function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

/** A server sentence used inside one of ours: its closing stop goes, ours closes it (the
 *  reorder toasts' rule, lane R3's `clause`). */
function clause(text: string): string {
  return text.replace(/[.\s]+$/, '')
}
```

**3c — Undo and failure.** Replace Task 3's `saveOrder` — from the comment line
`  // One drop, one PUT (spec §7): every reward category, hidden ones included, in its new` down to
the function's closing `  }` (just above `  const reorder = useReorder({`) — with:

```ts
  // A failed save puts the rows back (spec §7, as §4.1). Moving them can blur the grip a
  // keyboard drop left focus on — reverting an upward move moves that grip's own row — so
  // focus is handed back once the DOM has moved (flushSync: the move has happened by the next
  // line). Lane R3's dropPendingOrder.
  const dropPendingOrder = () => {
    const focused = document.activeElement
    flushSync(() => setPendingOrder(null))
    if (
      focused instanceof HTMLElement &&
      focused.isConnected &&
      document.activeElement !== focused
    ) {
      focused.focus()
    }
  }

  // Undo re-sends the order that stood before the drop (spec §7): the route is not
  // change-logged, so the client holds the previous order. The server's answer shows at once;
  // a list that changed since answers 409, and the page's reload shows what is there now.
  const restoreOrder = (ids: number[]) => {
    setBusy(true)
    reorderRewardCategories(ids)
      .then((restored) => {
        setSavedOrder(restored)
        onChanged()
        toast.info('Order restored')
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 409) {
          toast.error(errorDetail(err))
          onChanged()
          return
        }
        toast.error(`Couldn't restore the order — ${clause(errorDetail(err))}.`)
      })
      .finally(() => setBusy(false))
  }

  // One drop, one PUT (spec §7): every reward category, hidden ones included, in its new
  // order. The server renumbers them in ONE transaction, so a failure can no longer leave a
  // half-saved order (the per-row PATCH chain this replaces could). The matrix rows follow
  // once the page reloads. `reorder` is read only when the PUT answers, long after the render
  // that declares it below has returned.
  const saveOrder = (next: number[], moved: number) => {
    const category = categoryById.get(moved)
    if (category === undefined) return // the hook commits only ids it was handed
    const previous = ordered.map((row) => row.id)
    // Synchronously: the hook calls onCommit inside flushSync, so the new DOM order and the
    // cleared drag transforms land in one frame (lane R0 consumer rule 3).
    setPendingOrder(
      next.flatMap((id) => {
        const row = categoryById.get(id)
        return row === undefined ? [] : [row]
      }),
    )
    setBusy(true)
    reorderRewardCategories(next)
      .then((saved) => {
        setPendingOrder(null)
        setSavedOrder(saved)
        onChanged()
        reorder.markSaved(moved)
        toast.success(`Moved ${category.name}`, {
          action: { label: 'Undo', onAction: () => restoreOrder(previous) },
        })
      })
      .catch((err: unknown) => {
        dropPendingOrder()
        if (err instanceof ApiError && err.status === 409) {
          // The server's sentence says what happened; the reload shows the rows it means.
          toast.error(errorDetail(err))
          onChanged()
          return
        }
        // The toast layer, never the form's banner: the table is not the form (spec §4.1).
        toast.error(
          `Couldn't save the new order — ${clause(errorDetail(err))}. The list is back to how it was.`,
        )
      })
      .finally(() => setBusy(false))
  }
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/pages/CreditCardsPage.test.tsx`
Expected: PASS — 59 tests.

- [ ] **Step 5: Type-check, lint, commit**

```bash
npx tsc -b && npx eslint src/components/creditcards/CategoriesPanel.tsx src/pages/CreditCardsPage.test.tsx
git add src/components/creditcards/CategoriesPanel.tsx src/pages/CreditCardsPage.test.tsx
git commit -m "feat(credit-cards): a category reorder's Undo re-sends the old order; a failed save puts the rows back and says why; a stale list reloads"
```

---

### Task 5: Categories & weights — row buttons wait during a lift; a new category appends (spec §7, §3.3)

**Files:**
- Modify: `src/components/creditcards/CategoriesPanel.tsx` (`submit`'s create; the rows' actions
  cell)
- Test: `src/pages/CreditCardsPage.test.tsx` (one import; append one `describe`)

- [ ] **Step 1: Write the failing tests**

In `src/pages/CreditCardsPage.test.tsx`, replace:

```ts
  createCreditCard,
  deleteCreditCard,
```

with:

```ts
  createCreditCard,
  createRewardCategory,
  deleteCreditCard,
```

Append at the END of the file:

```tsx

describe('CreditCardsPage — Categories & weights: the rows and the form around a drag', () => {
  beforeEach(() => {
    vi.mocked(reorderRewardCategories).mockReset()
  })

  it("shuts the rows' own buttons while a row is lifted; Escape opens them again and saves nothing", async () => {
    serveCategories()
    renderManage()
    await screen.findByText('Categories & weights')
    const rowButtons = () =>
      CATEGORIES.flatMap(({ name }) =>
        [`Edit ${name}`, `Hide ${name}`, `Delete ${name}`].map(
          (label) => screen.getByRole('button', { name: label }) as HTMLButtonElement,
        ),
      )
    grip('Dining').focus()
    fireEvent.keyDown(grip('Dining'), { key: ' ' })
    expect(rowButtons().every((button) => button.disabled)).toBe(true)
    fireEvent.keyDown(grip('Dining'), { key: 'Escape' })
    expect(rowButtons().every((button) => !button.disabled)).toBe(true)
    expect(reorderRewardCategories).not.toHaveBeenCalled()
  })

  it('a new category names no position — the server appends it after the last row', async () => {
    serveCategories()
    vi.mocked(createRewardCategory).mockResolvedValue({
      ...CATEGORIES[2],
      id: 13,
      name: 'Gas',
      slug: 'gas',
      sort_order: 3,
    })
    renderManage()
    await screen.findByText('Categories & weights')
    fireEvent.change(screen.getByLabelText('Category name'), { target: { value: 'Gas' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add category' }))
    await waitFor(() => expect(createRewardCategory).toHaveBeenCalledTimes(1))
    // Exactly the four columns the form owns — no sort_order (2026-09-23 reorder spec §3.3).
    expect(vi.mocked(createRewardCategory).mock.calls[0][0]).toStrictEqual({
      name: 'Gas',
      annual_spend: null,
      spending_category_id: null,
      pinned_card_id: null,
    })
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/pages/CreditCardsPage.test.tsx`
Expected: 2 FAIL, 59 PASS (61):
- `shuts the rows' own buttons…` → `expected false to be true` (the buttons stay live during a
  lift);
- `a new category names no position…` → `expected { name: 'Gas', …(4) } to strictly equal { name:
  'Gas', …(3) }` (the body still carries the client's `max + 1`).

- [ ] **Step 3: Implement**

In `src/components/creditcards/CategoriesPanel.tsx`:

**3a — the create.** Replace:

```ts
    const request =
      editingId !== null
        ? updateRewardCategory(editingId, body)
        : // Append, don't default to 0: a new row would otherwise tie the first seeded
          // row's sort_order and id-break to the top of the matrix (final review M3).
          createRewardCategory({
            ...body,
            sort_order: categories.reduce((acc, c) => Math.max(acc, c.sort_order + 1), 0),
          })
```

with:

```ts
    const request =
      editingId !== null
        ? updateRewardCategory(editingId, body)
        : // No position: the server appends a new row after the last one (2026-09-23 reorder
          // spec §3.3). A number worked out here from the props could lag a reorder whose
          // reload has not landed yet.
          createRewardCategory(body)
```

**3b — the rows' buttons.** Replace the rows' actions cell — from
`                    <td className="row-actions">` down to its closing `                    </td>`
(the last cell of the row Task 3 wrote) — with:

```tsx
                    {/* Shut while a row is lifted, as during a save (lane R0 consumer rule 5): a
                        click mid-drag would act on a row that is about to move. */}
                    <td className="row-actions">
                      <button
                        type="button"
                        className="button"
                        aria-label={`Edit ${category.name}`}
                        disabled={busy || reorder.active}
                        onClick={() => startEdit(category)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="button"
                        aria-label={
                          category.is_active ? `Hide ${category.name}` : `Show ${category.name}`
                        }
                        disabled={busy || reorder.active}
                        onClick={() => toggleActive(category)}
                      >
                        {category.is_active ? 'Hide' : 'Show'}
                      </button>
                      <button
                        type="button"
                        className="button"
                        aria-label={`Delete ${category.name}`}
                        disabled={busy || reorder.active}
                        onClick={() => remove(category)}
                      >
                        Delete
                      </button>
                    </td>
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/pages/CreditCardsPage.test.tsx`
Expected: PASS — 61 tests.

- [ ] **Step 5: Type-check, lint, commit**

```bash
npx tsc -b && npx eslint src/components/creditcards/CategoriesPanel.tsx src/pages/CreditCardsPage.test.tsx
git add src/components/creditcards/CategoriesPanel.tsx src/pages/CreditCardsPage.test.tsx
git commit -m "feat(credit-cards): category rows' buttons wait during a lift; a new category names no position — the server appends it"
```

---

### Task 6: the card roster — a grip on every card, one PUT per drop (spec §7, §9)

**Files:**
- Modify: `src/components/creditcards/CardsPanel.tsx` — the imports (`:3-12`), the order layers
  (after `:77`), `saveOrder` + the hook (above `:295`), and the roster table (`:436-518`)
- Test: `src/pages/CreditCardsPage.test.tsx` — two imports, one helper, the owner test's cell
  index; append one `describe`

- [ ] **Step 1: Write the failing tests**

In `src/pages/CreditCardsPage.test.tsx`:

**1a — imports.** Replace:

```ts
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
```

with:

```ts
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
```

and replace:

```ts
  putRewardRates,
  reorderRewardCategories,
```

with:

```ts
  putRewardRates,
  reorderCreditCards,
  reorderRewardCategories,
```

**1b — the card server.** Insert directly after the closing `}` of `serveCategories` (and before
the shared `beforeEach(() => {`):

```ts

/** A tiny server for the card list: the GET answers the stored order; the reorder PUT stores
 *  the order it is sent — renumbered 0…n−1, as lane R1's route does — and answers with it. */
function serveCards(initial: CreditCardOut[] = [vx(), SAVOR, RH]): void {
  let stored = initial
  vi.mocked(fetchCreditCards).mockImplementation(async () => stored)
  vi.mocked(reorderCreditCards).mockImplementation(async (ids) => {
    const byId = new Map(stored.map((card) => [card.id, card]))
    stored = ids.flatMap((id, index) => {
      const card = byId.get(id)
      return card === undefined ? [] : [{ ...card, sort_order: index }]
    })
    return stored
  })
}
```

**1c — the owner test.** In `shows the owner per row and defaults a NEW card to the primary person`,
replace:

```ts
    const owners = Array.from(roster.querySelectorAll('tbody tr')).map(
      (tr) => tr.querySelectorAll('td')[1].textContent,
    )
```

with:

```ts
    // The grip column comes first (2026-09-23 drag-to-reorder spec §7): Owner is the third cell.
    const owners = Array.from(roster.querySelectorAll('tbody tr')).map(
      (tr) => tr.querySelectorAll('td')[2].textContent,
    )
```

**1d — the roster's block.** Append at the END of the file:

```tsx

describe('CreditCardsPage — reorder the card roster (2026-09-23 drag-to-reorder spec §7)', () => {
  beforeEach(() => {
    vi.mocked(reorderCreditCards).mockReset()
  })

  it('puts a grip first on every card row — archived ones too — on a reorderable table', async () => {
    serveCards([vx({ is_active: false }), SAVOR, RH])
    renderManage()
    await screen.findByText('Card roster')
    const table = document.querySelector('.roster-table') as HTMLTableElement
    expect(table.className).toBe('data-table roster-table reorder-table')
    const head = table.querySelector('thead tr')?.firstElementChild
    expect(head?.className).toBe('reorder-grip-cell')
    expect(head?.getAttribute('aria-hidden')).toBe('true')
    for (const row of table.querySelectorAll('tbody tr')) {
      expect(row.firstElementChild?.className).toBe('reorder-grip-cell')
    }
    expect(
      [...table.querySelectorAll('tbody .reorder-grip')].map((button) =>
        button.getAttribute('aria-label'),
      ),
    ).toEqual(['Reorder Venture X', 'Reorder SavorOne', 'Reorder RH Gold'])
    // An archived card keeps its place and moves like any other (spec §9).
    expect((grip('Venture X') as HTMLButtonElement).disabled).toBe(false)
    // One description for the list's grips, outside the table (lane R0 consumer rule 6).
    const instructions = document.getElementById(
      grip('Venture X').getAttribute('aria-describedby') ?? '',
    )
    expect(instructions?.textContent).toBe(
      'Press Space or Enter to pick up. Use the arrow keys to move, Home or End to jump, Space or Enter to drop, Escape to cancel.',
    )
    expect(table.contains(instructions)).toBe(false)
  })

  it('gives a lone card a disabled grip, and an empty roster no table at all (spec §9)', async () => {
    serveCards([vx()])
    renderManage()
    await screen.findByText('Card roster')
    expect((grip('Venture X') as HTMLButtonElement).disabled).toBe(true)
    cleanup()
    clearSnapshots()
    serveCards([])
    renderManage()
    await screen.findByText(/No cards yet/)
    expect(document.querySelector('.roster-table')).toBeNull()
  })

  it('saves one drop as one PUT of every card id, shows it at once, and parks the grips until it answers', async () => {
    serveCards()
    vi.mocked(reorderCreditCards).mockReturnValue(new Promise<never>(() => {}))
    renderManage()
    await screen.findByText('Card roster')
    keyboardMove('Venture X', 'ArrowDown')
    expect(reorderCreditCards).toHaveBeenCalledTimes(1)
    expect(reorderCreditCards).toHaveBeenCalledWith([2, 1, 3])
    // Optimistic: the dropped order is on screen before the server answers (spec §7).
    expect(rowIds('.roster-table')).toEqual(['2', '1', '3'])
    // Inert until it answers, so a second drop cannot race the first (spec §9) — but still
    // focusable: the keyboard drop left focus on the moved grip.
    expect(grip('RH Gold').getAttribute('aria-disabled')).toBe('true')
    expect(document.activeElement).toBe(grip('Venture X'))
  })

  it('flashes the moved row, says "Moved Venture X", and the page reloads — the matrix follows', async () => {
    serveCards()
    renderManage()
    await screen.findByText('Card roster')
    keyboardMove('Venture X', 'ArrowDown')
    expect(await screen.findByText('Moved Venture X')).toBeTruthy()
    expect(
      document.querySelector('.roster-table tr[data-reorder-id="1"]')?.hasAttribute('data-reorder-saved'),
    ).toBe(true)
    // The mount's fetch, then the reload the save asked for.
    expect(fetchCreditCards).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(grip('RH Gold').getAttribute('aria-disabled')).toBeNull())
    expect(rowIds('.roster-table')).toEqual(['2', '1', '3'])
    // The matrix reads the page's list, so its columns follow the new order by construction.
    fireEvent.click(screen.getByRole('tab', { name: 'Rewards' }))
    expect([...document.querySelectorAll('[id^="card-col-"]')].map((button) => button.id)).toEqual(
      ['card-col-2', 'card-col-1', 'card-col-3'],
    )
  })

  it('keeps the grips focusable but inert while any request of the roster is in flight', async () => {
    serveCards()
    // An archive that never settles: the roster stays busy for the rest of the test.
    vi.mocked(updateCreditCard).mockReturnValueOnce(new Promise<never>(() => {}))
    renderManage()
    await screen.findByText('Card roster')
    fireEvent.click(screen.getByRole('button', { name: 'Archive RH Gold' }))
    const handle = grip('SavorOne') as HTMLButtonElement
    expect(handle.getAttribute('aria-disabled')).toBe('true')
    expect(handle.disabled).toBe(false)
    handle.focus()
    fireEvent.keyDown(handle, { key: ' ' })
    expect(handle.getAttribute('aria-pressed')).toBeNull()
    expect(reorderCreditCards).not.toHaveBeenCalled()
  })

  it('never lets a reload that lands mid-save show the old order over the dropped one', async () => {
    serveCards()
    let answer: (cards: CreditCardOut[]) => void = () => {}
    vi.mocked(reorderCreditCards).mockReturnValueOnce(
      new Promise<CreditCardOut[]>((resolve) => {
        answer = resolve
      }),
    )
    const hidden = { ...CATEGORIES[2], is_active: false }
    vi.mocked(updateRewardCategory).mockResolvedValue(hidden)
    renderManage()
    await screen.findByText('Card roster')
    keyboardMove('Venture X', 'ArrowDown')
    // Another panel's save reloads the page mid-flight: a fresh card list, still in the old
    // order (the server has not moved it yet), beside the change that panel made.
    vi.mocked(fetchCreditCards).mockResolvedValue([vx(), SAVOR, RH])
    vi.mocked(fetchRewardCategories).mockResolvedValue([CATEGORIES[0], CATEGORIES[1], hidden])
    fireEvent.click(screen.getByRole('button', { name: 'Hide Rent' }))
    await screen.findByRole('button', { name: 'Show Rent' })
    expect(rowIds('.roster-table')).toEqual(['2', '1', '3'])
    // The PUT answers: the server's order stands until the page's next fetch.
    await act(async () => {
      answer([{ ...SAVOR, sort_order: 0 }, { ...vx(), sort_order: 1 }, { ...RH, sort_order: 2 }])
    })
    expect(rowIds('.roster-table')).toEqual(['2', '1', '3'])
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/pages/CreditCardsPage.test.tsx`
Expected: 7 FAIL, 60 PASS (67):
- `shows the owner per row…` → `expected [ 'Ed', 'Ed', 'Ed' ] to deeply equal [ 'Ed', 'Ed', 'Sam' ]`
  (the third cell is still Holder);
- `puts a grip first on every card row…` → `expected 'data-table roster-table' to be 'data-table
  roster-table reorder-table'`;
- the lone-card, one-PUT, flash and mid-save tests → `Unable to find an accessible element with the
  role "button" and name "Reorder Venture X"`;
- the busy test → `… name "Reorder SavorOne"`.

- [ ] **Step 3: Implement**

In `src/components/creditcards/CardsPanel.tsx`:

**3a — imports.** Replace:

```ts
import {
  createCardCredit,
  createCreditCard,
  createLimitEvent,
  deleteCreditCard,
  updateCreditCard,
} from '../../api/creditCards'
import AmountInput from '../AmountInput'
import InfoHint from '../InfoHint'
import { useToast } from '../ToastProvider'
```

with:

```ts
import {
  createCardCredit,
  createCreditCard,
  createLimitEvent,
  deleteCreditCard,
  reorderCreditCards,
  updateCreditCard,
} from '../../api/creditCards'
import AmountInput from '../AmountInput'
import InfoHint from '../InfoHint'
import DragHandle from '../reorder/DragHandle'
import { ReorderInstructions, ReorderLiveRegion } from '../reorder/ReorderStatus'
import { useReorder } from '../reorder/useReorder'
import { useToast } from '../ToastProvider'
```

**3b — the order layers.** Replace:

```ts
  // Single-flight across the panel (SecuritiesPanel's busy flag).
  const [busy, setBusy] = useState(false)
  const toast = useToast()
```

with:

```ts
  // Single-flight across the panel (SecuritiesPanel's busy flag).
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  // Drag to reorder (2026-09-23 drag-to-reorder spec §7). Two layers sit over the page's
  // `cards`, and only a reorder sets either:
  //   pendingOrder — the dropped order, from the moment the grip lets go until the PUT
  //                  answers (optimistic), cleared either way when it does;
  //   savedOrder   — the server's answer, until the page's next fetch replaces `cards`
  //                  (retired during render — CategoriesPanel's adjust-during-render
  //                  pattern, no effect, so react-hooks/set-state-in-effect stays clean).
  // So a reload that lands mid-save never flashes a row back to where it came from, and the
  // rows on screen carry the server's renumbered sort_order the moment it answers.
  const [pendingOrder, setPendingOrder] = useState<CreditCardOut[] | null>(null)
  const [savedOrder, setSavedOrder] = useState<CreditCardOut[] | null>(null)
  const [lastCards, setLastCards] = useState(cards)
  if (lastCards !== cards) {
    setLastCards(cards)
    setSavedOrder(null)
  }
  const ordered = pendingOrder ?? savedOrder ?? cards
  const cardById = new Map(ordered.map((card) => [card.id, card]))
```

**3c — one PUT per drop.** Insert directly above the comment line
`  // A card with no opened date has no anniversary, so the calendar can date neither its`:

```ts
  // One drop, one PUT (spec §7): every card, active and archived, in its new order. The
  // matrix columns, the tiles and the credit-line legend read the page's list, so they follow
  // once the page reloads. `reorder` is read only when the PUT answers, long after the render
  // that declares it below has returned.
  const saveOrder = (next: number[], moved: number) => {
    const card = cardById.get(moved)
    if (card === undefined) return // the hook commits only ids it was handed
    // Synchronously: the hook calls onCommit inside flushSync, so the new DOM order and the
    // cleared drag transforms land in one frame (lane R0 consumer rule 3).
    setPendingOrder(
      next.flatMap((id) => {
        const row = cardById.get(id)
        return row === undefined ? [] : [row]
      }),
    )
    setBusy(true)
    reorderCreditCards(next)
      .then((saved) => {
        setPendingOrder(null)
        setSavedOrder(saved)
        onChanged()
        reorder.markSaved(moved)
        toast.success(`Moved ${card.name}`)
      })
      .catch(() => setPendingOrder(null))
      .finally(() => setBusy(false))
  }

  const reorder = useReorder({
    items: ordered.map((card) => ({ id: card.id })),
    labelOf: (id) => cardById.get(id)?.name ?? 'this card',
    // Any request of the roster in flight — a save, an archive, a delete, a reorder — leaves
    // the grips focusable but inert (lane R0 consumer rule 4), so a drop never races a save.
    disabled: busy,
    onCommit: saveOrder,
  })

```

**3d — the roster.** Replace the whole roster block — from `      {cards.length === 0 ? (` down to
the `      )}` that closes it, just above
`      {/* Sibling of the ternary, not inside it: `undated` derives from `cards`, so it is` — with:

```tsx
      {ordered.length === 0 ? (
        <p className="empty-note">No cards yet — add your first card above.</p>
      ) : (
        <>
          {/* Once per list and outside the table — a <span> is not a valid child of one (lane
              R0 consumer rule 6). Every grip points its aria-describedby at the instructions. */}
          <ReorderInstructions id={reorder.instructionsId} />
          <ReorderLiveRegion text={reorder.announcement} />
          <table className="data-table roster-table reorder-table">
            <thead>
              <tr>
                <th className="reorder-grip-cell" aria-hidden="true" />
                <th>Card</th>
                <th>Owner</th>
                <th>Holder</th>
                <th>Auth. users</th>
                <th>Opened</th>
                <th className="num">Limit</th>
                <th>Linked account</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {ordered.map((card) => (
                <tr
                  key={card.id}
                  {...reorder.itemProps(card.id)}
                  className={card.id === editingId ? 'is-editing' : undefined}
                >
                  {/* Every card, archived ones included, keeps its place and moves (spec §9). */}
                  <td className="reorder-grip-cell">
                    <DragHandle name={card.name} {...reorder.handleProps(card.id)} />
                  </td>
                  <td>
                    {card.name}
                    {/* The card's economics ride the name cell rather than owning two more
                        columns. A 1¢ point value is the cash identity and says nothing. */}
                    <span className="sub">
                      {formatCurrency(card.annual_fee)} · {card.rewards_currency}
                      {Number(card.point_value_cents) !== 1 && ` ${Number(card.point_value_cents)}¢`}
                    </span>
                  </td>
                  {/* NULL is JOINT, never "unknown": the migration backfilled every
                      pre-existing card to the primary person. `Holder` beside it is the
                      embossed name — informational, and no longer editable here. */}
                  <td>
                    {card.person_id === null ? 'Joint' : (ownerName.get(card.person_id) ?? '—')}
                  </td>
                  <td>{card.primary_holder ?? '—'}</td>
                  <td>{card.authorized_users ?? '—'}</td>
                  <td>{card.opened_on ? formatDate(card.opened_on) : '—'}</td>
                  {/* The SERVER's latest limit event, never re-derived here (global rule 9). */}
                  <td className="num">
                    {card.current_limit === null ? '—' : formatCurrency(card.current_limit)}
                  </td>
                  <td>{card.account_id === null ? '—' : (accountName.get(card.account_id) ?? '—')}</td>
                  <td>
                    <span className="badge">{card.is_active ? 'Active' : 'Archived'}</span>
                  </td>
                  <td className="row-actions">
                    <button
                      type="button"
                      className="button"
                      aria-label={`Edit ${card.name}`}
                      // Shut mid-flight like every other button here: this fills the form from
                      // the row, and a save landing a moment later resets it out from under
                      // the click.
                      disabled={busy}
                      onClick={() => startEdit(card)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="button"
                      aria-label={card.is_active ? `Archive ${card.name}` : `Unarchive ${card.name}`}
                      disabled={busy}
                      onClick={() => toggleArchive(card)}
                    >
                      {card.is_active ? 'Archive' : 'Unarchive'}
                    </button>
                    <button
                      type="button"
                      className="button"
                      aria-label={`Delete ${card.name}`}
                      disabled={busy}
                      onClick={() => remove(card)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/pages/CreditCardsPage.test.tsx`
Expected: PASS — 67 tests.

- [ ] **Step 5: Type-check, lint, commit**

```bash
npx tsc -b && npx eslint src/components/creditcards/CardsPanel.tsx src/pages/CreditCardsPage.test.tsx
git add src/components/creditcards/CardsPanel.tsx src/pages/CreditCardsPage.test.tsx
git commit -m "feat(credit-cards): the card roster reorders — a grip on every card, one PUT per drop, optimistic, then the server's order"
```

---

### Task 7: the card roster — Undo, and a save that fails (spec §7, §8.1, §8.3)

**Files:**
- Modify: `src/components/creditcards/CardsPanel.tsx` (two imports; a `clause` helper after
  `message`; Task 6's `saveOrder` replaced by three functions)
- Test: `src/pages/CreditCardsPage.test.tsx` (one constant; append one `describe`)

- [ ] **Step 1: Write the failing tests**

In `src/pages/CreditCardsPage.test.tsx`, replace:

```ts
// Lane R1's stale-list sentence for the reward categories (spec §8.3).
const STALE_CATEGORIES =
  'The reward categories changed since this list was loaded — nothing was moved.'
```

with:

```ts
// Lane R1's stale-list sentences (spec §8.3).
const STALE_CATEGORIES =
  'The reward categories changed since this list was loaded — nothing was moved.'
const STALE_CARDS = 'The cards changed since this list was loaded — nothing was moved.'
```

Append at the END of the file:

```tsx

describe('CreditCardsPage — the card roster: Undo, and a save that fails (spec §7, §8.1, §8.3)', () => {
  beforeEach(() => {
    vi.mocked(reorderCreditCards).mockReset()
  })

  it('Undo re-sends the order that stood before the drop, shows it and says so', async () => {
    serveCards()
    renderManage()
    await screen.findByText('Card roster')
    keyboardMove('Venture X', 'ArrowDown')
    await screen.findByText('Moved Venture X')
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByText('Order restored')).toBeTruthy()
    expect(vi.mocked(reorderCreditCards).mock.calls).toEqual([[[2, 1, 3]], [[1, 2, 3]]])
    // The server's answer shows at once, and the page reloads behind it.
    expect(rowIds('.roster-table')).toEqual(['1', '2', '3'])
    expect(fetchCreditCards).toHaveBeenCalledTimes(3)
  })

  it.each([
    { status: 500, detail: 'Internal Server Error', reason: 'the server had a problem (HTTP 500)' },
    // A server sentence that brings its own stop: ours closes it, once.
    { status: 422, detail: 'ids lists 3 more than once.', reason: 'ids lists 3 more than once' },
  ])('puts the rows back, keeps the grip focused and says why ($status)', async ({ status, detail, reason }) => {
    serveCards()
    vi.mocked(reorderCreditCards).mockRejectedValueOnce(new ApiError(detail, status))
    renderManage()
    await screen.findByText('Card roster')
    keyboardMove('RH Gold', 'ArrowUp')
    expect(
      await screen.findByText(
        `Couldn't save the new order — ${reason}. The list is back to how it was.`,
      ),
    ).toBeTruthy()
    expect(rowIds('.roster-table')).toEqual(['1', '2', '3'])
    expect(document.activeElement).toBe(grip('RH Gold'))
    expect(fetchCreditCards).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it("shows a stale roster's server sentence, puts the rows back and reloads (409)", async () => {
    serveCards()
    vi.mocked(reorderCreditCards).mockRejectedValueOnce(new ApiError(STALE_CARDS, 409))
    renderManage()
    await screen.findByText('Card roster')
    keyboardMove('Venture X', 'ArrowDown')
    expect(await screen.findByText(STALE_CARDS)).toBeTruthy()
    expect(rowIds('.roster-table')).toEqual(['1', '2', '3'])
    expect(fetchCreditCards).toHaveBeenCalledTimes(2)
    expect(screen.queryByText(/Couldn't save the new order/)).toBeNull()
  })

  it.each([
    {
      status: 500,
      detail: 'Internal Server Error',
      text: "Couldn't restore the order — the server had a problem (HTTP 500).",
      fetches: 2,
    },
    { status: 409, detail: STALE_CARDS, text: STALE_CARDS, fetches: 3 },
  ])('says why an Undo was refused ($status), reloading a stale roster', async ({ status, detail, text, fetches }) => {
    serveCards()
    renderManage()
    await screen.findByText('Card roster')
    keyboardMove('Venture X', 'ArrowDown')
    await screen.findByText('Moved Venture X')
    vi.mocked(reorderCreditCards).mockRejectedValueOnce(new ApiError(detail, status))
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByText(text)).toBeTruthy()
    expect(fetchCreditCards).toHaveBeenCalledTimes(fetches)
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/pages/CreditCardsPage.test.tsx`
Expected: 6 FAIL, 67 PASS (73), with the same four shapes as Task 4 Step 2 — the Undo button missing,
`Unable to find an element with the text: Couldn't save the new order — …`, and
`… The cards changed since this list was loaded — nothing was moved.`

- [ ] **Step 3: Implement**

In `src/components/creditcards/CardsPanel.tsx`:

**3a — imports.** Replace:

```ts
import { useState } from 'react'
import { ApiError } from '../../api/client'
```

with:

```ts
import { useState } from 'react'
import { flushSync } from 'react-dom'
import { ApiError, errorDetail } from '../../api/client'
```

**3b — `clause`.** Replace:

```ts
function message(err: unknown, fallback: string): string {
  // 404/409/422 details are the server's own sentences — rendered verbatim (house note).
  return err instanceof ApiError ? err.message : fallback
}
```

with:

```ts
function message(err: unknown, fallback: string): string {
  // 404/409/422 details are the server's own sentences — rendered verbatim (house note).
  return err instanceof ApiError ? err.message : fallback
}

/** A server sentence used inside one of ours: its closing stop goes, ours closes it (the
 *  reorder toasts' rule, lane R3's `clause`). */
function clause(text: string): string {
  return text.replace(/[.\s]+$/, '')
}
```

**3c — Undo and failure.** Replace Task 6's `saveOrder` — from the comment line
`  // One drop, one PUT (spec §7): every card, active and archived, in its new order. The` down to
the function's closing `  }` (just above `  const reorder = useReorder({`) — with:

```ts
  // A failed save puts the rows back (spec §7, as §4.1). Moving them can blur the grip a
  // keyboard drop left focus on — reverting an upward move moves that grip's own row — so
  // focus is handed back once the DOM has moved (flushSync: the move has happened by the next
  // line). Lane R3's dropPendingOrder.
  const dropPendingOrder = () => {
    const focused = document.activeElement
    flushSync(() => setPendingOrder(null))
    if (
      focused instanceof HTMLElement &&
      focused.isConnected &&
      document.activeElement !== focused
    ) {
      focused.focus()
    }
  }

  // Undo re-sends the order that stood before the drop (spec §7): the route is not
  // change-logged, so the client holds the previous order. The server's answer shows at once;
  // a list that changed since answers 409, and the page's reload shows what is there now.
  const restoreOrder = (ids: number[]) => {
    setBusy(true)
    reorderCreditCards(ids)
      .then((restored) => {
        setSavedOrder(restored)
        onChanged()
        toast.info('Order restored')
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 409) {
          toast.error(errorDetail(err))
          onChanged()
          return
        }
        toast.error(`Couldn't restore the order — ${clause(errorDetail(err))}.`)
      })
      .finally(() => setBusy(false))
  }

  // One drop, one PUT (spec §7): every card, active and archived, in its new order. The
  // matrix columns, the tiles and the credit-line legend read the page's list, so they follow
  // once the page reloads. `reorder` is read only when the PUT answers, long after the render
  // that declares it below has returned.
  const saveOrder = (next: number[], moved: number) => {
    const card = cardById.get(moved)
    if (card === undefined) return // the hook commits only ids it was handed
    const previous = ordered.map((row) => row.id)
    // Synchronously: the hook calls onCommit inside flushSync, so the new DOM order and the
    // cleared drag transforms land in one frame (lane R0 consumer rule 3).
    setPendingOrder(
      next.flatMap((id) => {
        const row = cardById.get(id)
        return row === undefined ? [] : [row]
      }),
    )
    setBusy(true)
    reorderCreditCards(next)
      .then((saved) => {
        setPendingOrder(null)
        setSavedOrder(saved)
        onChanged()
        reorder.markSaved(moved)
        toast.success(`Moved ${card.name}`, {
          action: { label: 'Undo', onAction: () => restoreOrder(previous) },
        })
      })
      .catch((err: unknown) => {
        dropPendingOrder()
        if (err instanceof ApiError && err.status === 409) {
          // The server's sentence says what happened; the reload shows the rows it means.
          toast.error(errorDetail(err))
          onChanged()
          return
        }
        // The toast layer, never the form's banner: the table is not the form (spec §4.1).
        toast.error(
          `Couldn't save the new order — ${clause(errorDetail(err))}. The list is back to how it was.`,
        )
      })
      .finally(() => setBusy(false))
  }
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/pages/CreditCardsPage.test.tsx`
Expected: PASS — 73 tests.

- [ ] **Step 5: Type-check, lint, commit**

```bash
npx tsc -b && npx eslint src/components/creditcards/CardsPanel.tsx src/pages/CreditCardsPage.test.tsx
git add src/components/creditcards/CardsPanel.tsx src/pages/CreditCardsPage.test.tsx
git commit -m "feat(credit-cards): a card reorder's Undo re-sends the old order; a failed save puts the rows back and says why; a stale roster reloads"
```

---

### Task 8: the card roster — row buttons wait during a lift; a new card appends; an edit names the renumbered position (spec §7)

**Files:**
- Modify: `src/components/creditcards/CardsPanel.tsx` (`buildBody`, `submit`'s lookup, the rows'
  actions cell)
- Test: `src/pages/CreditCardsPage.test.tsx` (the add-flow test's assertion; append one `describe`)

- [ ] **Step 1: Write the failing tests**

In `src/pages/CreditCardsPage.test.tsx`, in `roster add flow POSTs the full card body with defaults
filled`, replace:

```ts
    expect(vi.mocked(createCreditCard).mock.calls[0][0]).toMatchObject({
      name: 'BILT',
      annual_fee: '0',
      rewards_currency: 'cash',
      point_value_cents: '1',
      is_active: true,
      sort_order: 0,
    })
  })
```

with:

```ts
    expect(vi.mocked(createCreditCard).mock.calls[0][0]).toMatchObject({
      name: 'BILT',
      annual_fee: '0',
      rewards_currency: 'cash',
      point_value_cents: '1',
      is_active: true,
    })
    // No position: the server appends a new card after the last one (2026-09-23 reorder spec
    // §3.3, §7) — a 0 here would put it first.
    expect(vi.mocked(createCreditCard).mock.calls[0][0]).not.toHaveProperty('sort_order')
  })
```

Append at the END of the file:

```tsx

describe('CreditCardsPage — the card roster: the rows and the form around a drag', () => {
  beforeEach(() => {
    vi.mocked(reorderCreditCards).mockReset()
  })

  it("shuts the rows' own buttons while a row is lifted; Escape opens them again and saves nothing", async () => {
    serveCards()
    renderManage()
    await screen.findByText('Card roster')
    const rowButtons = () =>
      ['Venture X', 'SavorOne', 'RH Gold'].flatMap((name) =>
        [`Edit ${name}`, `Archive ${name}`, `Delete ${name}`].map(
          (label) => screen.getByRole('button', { name: label }) as HTMLButtonElement,
        ),
      )
    grip('SavorOne').focus()
    fireEvent.keyDown(grip('SavorOne'), { key: ' ' })
    expect(rowButtons().every((button) => button.disabled)).toBe(true)
    fireEvent.keyDown(grip('SavorOne'), { key: 'Escape' })
    expect(rowButtons().every((button) => !button.disabled)).toBe(true)
    expect(reorderCreditCards).not.toHaveBeenCalled()
  })

  it("an edit after a reorder sends the card's renumbered sort_order, never the one it loaded with", async () => {
    serveCards()
    vi.mocked(updateCreditCard).mockResolvedValue(vx())
    renderManage()
    await screen.findByText('Card roster')
    // The page's reload never lands: only the PUT's own answer knows the new numbers.
    vi.mocked(fetchCreditCards).mockReturnValue(new Promise<never>(() => {}))
    keyboardMove('Venture X', 'ArrowDown')
    await screen.findByText('Moved Venture X')
    await waitFor(() => expect(grip('RH Gold').getAttribute('aria-disabled')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Edit Venture X' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save card' }))
    await waitFor(() => expect(updateCreditCard).toHaveBeenCalledTimes(1))
    // Venture X loaded as 0 and now stands second, renumbered 1 by the server. The full-replace
    // PATCH still names a position (spec §7), and a stale 0 would tie SavorOne's new 0.
    expect(vi.mocked(updateCreditCard).mock.calls[0]).toEqual([
      1,
      expect.objectContaining({ sort_order: 1 }),
    ])
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/pages/CreditCardsPage.test.tsx`
Expected: 3 FAIL, 72 PASS (75):
- `roster add flow…` → `expected { Object (name, annual_fee, ...) } to not have property
  "sort_order"`;
- `shuts the rows' own buttons…` → `expected false to be true`;
- `an edit after a reorder…` → `expected [ 1, { name: 'Venture X', …(11) } ] to deeply equal
  [ 1, …(1) ]` (the PATCH carries the loaded 0).

- [ ] **Step 3: Implement**

In `src/components/creditcards/CardsPanel.tsx`:

**3a — `buildBody`'s head.** Replace:

```ts
  /** The full-replace body, preserving fields the form doesn't show (is_active,
   *  sort_order) from the stored row when editing. */
  const buildBody = (stored: CreditCardOut | undefined): CreditCardIn | null => {
```

with:

```ts
  /** The full-replace body, preserving fields the form doesn't show from the stored row when
   *  editing: is_active always, sort_order on an edit only (a new card names no position). */
  const buildBody = (stored: CreditCardOut | undefined): CreditCardIn | null => {
```

and replace:

```ts
    return {
      name,
      // The wire belt: blur usually canonicalized already, but a submit reached without one
```

with:

```ts
    const body: CreditCardIn = {
      name,
      // The wire belt: blur usually canonicalized already, but a submit reached without one
```

**3b — `buildBody`'s tail and `submit`'s lookup.** Replace:

```ts
      // The two columns this form has no box for. On a full-replace PATCH an omitted or
      // guessed value would silently unarchive a card, or shuffle the roster's order, on
      // every unrelated edit — so they come from the STORED row and only Archive moves
      // is_active.
      is_active: stored?.is_active ?? true,
      account_id: form.account_id === '' ? null : Number(form.account_id),
      notes: form.notes.trim() || null,
      sort_order: stored?.sort_order ?? 0,
    }
  }

  const submit = () => {
    // The row as the SERVER has it, looked up in the current feed.
    const stored = cards.find((c) => c.id === editingId)
```

with:

```ts
      // One of the two columns this form has no box for. On a full-replace PATCH an omitted
      // or guessed is_active would silently unarchive a card on every unrelated edit — so it
      // comes from the STORED row and only Archive moves it.
      is_active: stored?.is_active ?? true,
      account_id: form.account_id === '' ? null : Number(form.account_id),
      notes: form.notes.trim() || null,
    }
    // The other is the position, which the roster's drag owns (2026-09-23 drag-to-reorder spec
    // §7). An edit sends the stored value back, as a full replace names every column; a new
    // card names none, and the server appends it after the last card (spec §3.3).
    return stored === undefined ? body : { ...body, sort_order: stored.sort_order }
  }

  const submit = () => {
    // The row as the SERVER has it, as rendered: after a reorder the PUT's answer — its
    // renumbered sort_order included — stands here before the page's reload lands.
    const stored = ordered.find((card) => card.id === editingId)
```

**3c — the rows' buttons.** Replace the rows' actions cell Task 6 wrote — from
`                  <td className="row-actions">` down to its closing `                  </td>` —
with:

```tsx
                  <td className="row-actions">
                    <button
                      type="button"
                      className="button"
                      aria-label={`Edit ${card.name}`}
                      // Shut mid-flight like every other button here: this fills the form from
                      // the row, and a save landing a moment later resets it out from under
                      // the click. Shut while a row is lifted too (lane R0 consumer rule 5): a
                      // click mid-drag would act on a row that is about to move.
                      disabled={busy || reorder.active}
                      onClick={() => startEdit(card)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="button"
                      aria-label={card.is_active ? `Archive ${card.name}` : `Unarchive ${card.name}`}
                      disabled={busy || reorder.active}
                      onClick={() => toggleArchive(card)}
                    >
                      {card.is_active ? 'Archive' : 'Unarchive'}
                    </button>
                    <button
                      type="button"
                      className="button"
                      aria-label={`Delete ${card.name}`}
                      disabled={busy || reorder.active}
                      onClick={() => remove(card)}
                    >
                      Delete
                    </button>
                  </td>
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/pages/CreditCardsPage.test.tsx`
Expected: PASS — 75 tests. `roster edit preserves is_active and sort_order on the full-replace
PATCH` still passes: an edit sends the stored 7.

- [ ] **Step 5: Type-check, lint, commit**

```bash
npx tsc -b && npx eslint src/components/creditcards/CardsPanel.tsx src/pages/CreditCardsPage.test.tsx
git add src/components/creditcards/CardsPanel.tsx src/pages/CreditCardsPage.test.tsx
git commit -m "feat(credit-cards): roster buttons wait during a lift; a new card names no position; an edit sends the card's renumbered sort_order"
```

---

### Task 9: the Guide's Categories & weights task (APPROVED by the controller, 2026-09-23)

**Approved — run it.** The Guide must not describe the keyboard model this lane removes ("press the
up and down arrows" now moves nothing until the row is lifted). The fence for this lane includes
`src/guide/content/pages-tracking.tsx`, limited to the `cards-hide-category` task's `steps`.

**Files:**
- Modify: `src/guide/content/pages-tracking.tsx:727-730` (the `cards-hide-category` task's `steps`)

The fence tests in `src/guide/guideContent.test.ts` keep this honest:
- every `**Label**` must be text the UI source contains (`Hide`, `Show` and `Undo` all do);
- every step must be at most 160 characters. The two new lines are 123 and 93.

Lane R4 edits the same file near line 31 (`overview-customize`), far from these lines: the two
hunks merge cleanly in either order.

- [ ] **Step 1: Replace the steps**

Replace:

```ts
        steps: [
          '**Hide** takes a row out of the matrix and keeps its cells; **Show** brings it back.',
          'Drag the grip, or focus it and press the up and down arrows, to reorder.',
        ],
```

with:

```ts
        steps: [
          '**Hide** takes a row out of the matrix and keeps its cells; **Show** brings it back.',
          'Drag a row by its grip to reorder it, or focus the grip and press Space, move it with the arrow keys and press Space again.',
          'The new order saves at once and the matrix rows follow it; the toast’s **Undo** puts it back.',
        ],
```

- [ ] **Step 2: Run the Guide's fences and pages**

Run: `npx vitest run src/guide src/pages/GuidePage.test.tsx`
Expected: PASS (`guideContent.test.ts` 13 tests).

- [ ] **Step 3: Lint and commit**

```bash
npx eslint src/guide/content/pages-tracking.tsx
git add src/guide/content/pages-tracking.tsx
git commit -m "fix(guide): Categories & weights reorder by lift-and-drop — grip, Space, arrows, Space — with the toast's Undo"
```

---

### Task 10: the lane's gates

**Files:** none (verification only). Record every result in Results (committed in Task 12).

- [ ] **Step 1: The lane's files**

Run: `npx vitest run src/pages/CreditCardsPage.test.tsx src/components/creditcards src/guide src/focusCss.test.ts src/charts/conformance.test.ts src/components/reorder`
Expected: PASS — `CreditCardsPage.test.tsx` 75, `creditLineChartOptions.test.ts` 12,
`guideContent.test.ts` 13.

- [ ] **Step 2: The full frontend suite, types, lint, build**

Run: `npx vitest run`
Expected: exit 0. Record the file and test counts. On a failure in a file this lane never touched:
- first re-run it alone; the two known load flakes are named in Mechanics;
- then run the same file in `.worktrees/reorder-base`, to show the failure is pre-existing;
- record both runs.

Run: `npx tsc -b && npx eslint . && npm run build`
Expected: all three exit 0. Among the files this lane touched, `eslint .` warns only on
`CategoriesPanel.tsx`'s `export const SEED_CATEGORIES` (react-refresh/only-export-components). That
warning is on the base at line 20; moving the constant would need a new file outside this fence.

- [ ] **Step 3: Scope check**

Run: `git diff --stat feat/reorder-base...HEAD`
Expected: exactly these files:
- `src/components/creditcards/CardsPanel.tsx`;
- `src/components/creditcards/CategoriesPanel.tsx`;
- `src/components/creditcards/categories.css` — deletions only;
- `src/components/creditcards/creditLineChartOptions.ts`;
- `src/components/creditcards/creditLineChartOptions.test.ts`;
- `src/pages/CreditCardsPage.tsx` — 3 insertions, 1 deletion;
- `src/pages/CreditCardsPage.test.tsx`;
- `src/guide/content/pages-tracking.tsx`.

Then run `git diff feat/reorder-base...HEAD -- src/pages/CreditCardsPage.tsx`. The whole diff must be
the `lineCards` map: two comment lines and the `id: card.id` line.

Then run `grep -rn "draggable" src/components/creditcards/`. It must print nothing (spec §7
acceptance; Task 3's source pin also guards it).

---

### Task 11: the browser check — real Edge, real pointer, the private database (spec §10)

**Files:**
- Create: `scratchpad/reorder-r5/drag.mjs` (gitignored — never committed)
- Output: `scratchpad/reorder-r5/out/report.json` and screenshots

The check writes only through the lane's own servers: vite on 5195, proxying to uvicorn on 8095,
which serves `finance_reorder_r5`. The script refuses any other base. The page's only allowed writes
are the two reorder PUTs; any other write is aborted and reported. Both lists are put back to their
starting order at the end of every pass.

- [ ] **Step 1: The database is migrated**

Run:

```bash
docker exec finance-dashboard-db-1 psql -U finance -d finance_reorder_r5 -tAc "SELECT (SELECT count(*) FROM credit_cards), (SELECT count(*) FROM reward_categories), (SELECT version_num FROM alembic_version)"
```

Expected: `7|19|f12026092301`. If the version is still `f12026091203`, run the controller's
migration commands ("Controller prerequisites" step 4) — they touch only `finance_reorder_r5`. If
the database is missing, stop and ask the controller.

- [ ] **Step 2: Start the lane's backend (leave it running in the background)**

```bash
cd /c/Users/edyli/personal-finance-dashboard/.worktrees/reorder-r5/backend && DATABASE_URL=postgresql+asyncpg://finance:finance@localhost:5433/finance_reorder_r5 SCHEDULER_ENABLED=0 /c/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8095
```

Check: `curl -s http://127.0.0.1:8095/api/v1/health` prints `{"status":"ok"}`.

- [ ] **Step 3: Start the lane's vite (leave it running in the background)**

```bash
cd /c/Users/edyli/personal-finance-dashboard/.worktrees/reorder-r5 && VITE_API_PROXY=http://127.0.0.1:8095 npx vite --port 5195 --strictPort
```

Check: `curl -s -o /dev/null -w '%{http_code}' http://localhost:5195/` prints `200`.

- [ ] **Step 4: The dev credentials work on the copy**

```bash
curl -s http://127.0.0.1:8095/api/v1/auth/login -H 'content-type: application/json' -d '{"email":"admin@example.com","password":"changeme123"}'
```

Expected: a JSON body with `access_token`. On a 401, reset the password on the PRIVATE copy only,
then retry:

```bash
cd /c/Users/edyli/personal-finance-dashboard/.worktrees/reorder-r5/backend
HASH=$(/c/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe -c "from app.security import hash_password; print(hash_password('changeme123'))")
docker exec finance-dashboard-db-1 psql -U finance -d finance_reorder_r5 -c "UPDATE users SET password_hash = '$HASH' WHERE email = 'admin@example.com'"
```

- [ ] **Step 5: Write `scratchpad/reorder-r5/drag.mjs`**

The launch boilerplate is `tools/probes/sandbox-v/smoke.mjs`'s: the node-version spoof,
playwright-core from the npx cache (`PLAYWRIGHT_CORE` overrides), Edge at `EDGE_PATH`, the theme
injected into `GET /prefs`. The echarts handle is imported after the page painted
(`tools/probes/espp-v/smoke.mjs`'s `hookEcharts`).

```js
// scratchpad/reorder-r5/drag.mjs — lane R5's browser check (2026-09-23 drag-to-reorder spec §7,
// §9, §10; plan docs/superpowers/plans/2026-09-23-reorder-r5-cards.md, Task 11).
//
// Real Edge and real pointer events against the lane's OWN servers on the PRIVATE database:
//   uvicorn 127.0.0.1:8095  DATABASE_URL=…/finance_reorder_r5  SCHEDULER_ENABLED=0
//   vite    localhost:5195  VITE_API_PROXY=http://127.0.0.1:8095
// It WRITES — the two reorder PUTs, nothing else — and refuses any base but :5195. Every other
// write the page attempts is aborted and reported. Both lists end in the order they started in.
//
// Per theme (dark, light) at 1600×1000 and 1280×800:
//   a  the resting Manage view — both tables reorderable, separate borders, the grip column
//      first, a hairline under every cell, the server's order;
//   b  the credit-line colours before any move, read off echarts' applied option;
//   c  the card roster: a real mouse drag across three rows — the row follows the pointer,
//      exactly the rows it passes make room, the pinned actions cell rides the lifted surface,
//      the toast, the server's order, the order after a reload;
//   d  the rewards matrix's columns follow the new order;
//   e  every card's line keeps its colour while the legend follows the new order; then the
//      order is put back through the API;
//   f  the same drag again, and the toast's Undo restores the order;
//   g  the roster's keyboard path (Space, ↓ ×2, Space) — focus kept on the grip, Undo;
//   h  Categories & weights: a mouse drag across three rows inside the capped scroller, Undo;
//   i  the last category dragged to the scroller's top edge — the box auto-scrolls under the
//      held pointer and the row lands first, Undo;
//   j  the categories keyboard path (Space, ↓ ×2, Space), Undo; then Space + End scrolls the box
//      to keep the landing slot in view, and Escape cancels with no request;
//   k  (1280) forced failures — a 500 and a 409 on the roster, a 409 on the categories.
// Exits 1 listing every problem; prints `R5 CARDS CHECK OK` when there are none.
//
// The first two lines spoof the node version: this box runs node 18 and playwright-core refuses
// anything under 20 (tools/probes/sandbox-v/smoke.mjs's boilerplate).
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
const out = path.join(here, 'out')
mkdirSync(out, { recursive: true })
const BASE = process.env.APP_BASE ?? 'http://localhost:5195'
if (new URL(BASE).port !== '5195') {
  throw new Error(`refusing to write through ${BASE}: lane R5's vite is :5195`)
}
const EDGE =
  process.env.EDGE_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const EXPECT_HEAD = process.env.EXPECT_HEAD ?? 'f12026092301'
const THEMES = ['dark', 'light'].filter(
  (t) => !process.env.ONLY_THEME || t === process.env.ONLY_THEME,
)
const SIZES = [
  { width: 1600, height: 1000 },
  { width: 1280, height: 800 },
].filter((s) => !process.env.ONLY_WIDTH || String(s.width) === process.env.ONLY_WIDTH)
const SETTLE = 1500
const MOTION = 120 // MOTION_MS.fast: a pointer drop eases this long before it commits
// `owner=all` spelled out: with no owner param the page falls back to the account's remembered
// scope (useScope's memory, mirrored through /prefs), which may be a person — and the matrix and
// the chart would then draw fewer cards than the roster lists.
const MANAGE = '/credit-cards?section=manage&owner=all'
const LINES = '/credit-cards?section=lines&owner=all'
const REWARDS = '/credit-cards?owner=all'
const ROSTER = '.roster-table'
const CATS = '.categories-table'
const SCROLLER = '.categories-scroll'
const STALE_CARDS = 'The cards changed since this list was loaded — nothing was moved.'
const STALE_CATEGORIES =
  'The reward categories changed since this list was loaded — nothing was moved.'
const FAILED_500 =
  "Couldn't save the new order — the server had a problem (HTTP 500). The list is back to how it was."
const NOISE =
  /favicon|DevTools|\[vite\]|@vite\/client|Download the React DevTools|React Router Future Flag/i
// The only writes the page may make; anything else is aborted and reported (R2's allowlist).
const WRITE_ALLOW = [
  /^\/api\/v1\/credit-cards\/order$/,
  /^\/api\/v1\/credit-cards\/categories\/order$/,
  /^\/api\/v1\/auth\/renew$/,
]

const report = {
  generatedAt: new Date().toISOString(),
  base: BASE,
  checks: [],
  writes: [],
  blockedWrites: [],
  knownBenign: [],
  problems: [],
}
const problem = (message) => report.problems.push(message)
const check = (where, name, ok, observed) => {
  report.checks.push({ where, name, ok, observed })
  if (!ok) problem(`${where}: ${name} — observed ${JSON.stringify(observed)}`)
  return ok
}
const note = (where, name, observed) => report.checks.push({ where, name, ok: null, observed })
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const moveTo = (ids, from, to) => {
  const next = [...ids]
  const [id] = next.splice(from, 1)
  next.splice(to, 0, id)
  return next
}

// ── the API, as the app's own user, through the lane's vite proxy ─────────────────────────────
const login = await fetch(`${BASE}/api/v1/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@example.com', password: 'changeme123' }),
})
if (!login.ok) throw new Error(`login failed: HTTP ${login.status}`)
const TOKEN = (await login.json()).access_token
async function api(method, route, body) {
  const res = await fetch(`${BASE}/api/v1${route}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${method} ${route} → HTTP ${res.status}: ${await res.text()}`)
  return res.status === 204 ? null : res.json()
}
const cardIds = async () => (await api('GET', '/credit-cards')).map((card) => card.id)
const catIds = async () => (await api('GET', '/credit-cards/categories')).map((c) => c.id)
const putCards = (ids) => api('PUT', '/credit-cards/order', { ids })
const putCats = (ids) => api('PUT', '/credit-cards/categories/order', { ids })

const head = (await api('GET', '/system/status')).database.alembic_head
if (head !== EXPECT_HEAD) {
  throw new Error(
    `finance_reorder_r5 is at ${head}, not ${EXPECT_HEAD}: run the controller's migration first`,
  )
}
const CARDS = await api('GET', '/credit-cards')
const CATEGORIES = await api('GET', '/credit-cards/categories')
const ORIGINAL_CARDS = CARDS.map((card) => card.id)
const ORIGINAL_CATS = CATEGORIES.map((c) => c.id)
const CARD_NAME = new Map(CARDS.map((card) => [card.id, card.name]))
const CAT_NAME = new Map(CATEGORIES.map((c) => [c.id, c.name]))
const ACTIVE = new Set(CARDS.filter((card) => card.is_active).map((card) => card.id))
// The credit-line chart draws the active cards that have a limit history (the page's lineCards).
const DRAWN = new Set(
  CARDS.filter((card) => card.is_active && card.limit_events.length > 0).map((card) => card.id),
)
note('setup', 'cards (finance_realdata census: 7, all active, 6 with limit events)', {
  cards: ORIGINAL_CARDS.length,
  active: ACTIVE.size,
  drawn: DRAWN.size,
})
note('setup', 'reward categories (census: 19)', ORIGINAL_CATS.length)
if (ORIGINAL_CARDS.length < 5) problem('setup: the roster needs at least five cards for step c')
if (DRAWN.size < 4) problem('setup: the credit-line chart needs four drawn cards for step e')
if (ORIGINAL_CATS.length < 12) problem('setup: the categories need a scrolling list for step i')
/** The chart's expected legend: the list order, drawn cards only, then the total. */
const legendFor = (order) => {
  const names = order.filter((id) => DRAWN.has(id)).map((id) => CARD_NAME.get(id))
  return names.length > 1 ? [...names, 'Total line'] : names
}

const browser = await chromium.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--force-device-scale-factor=1'],
})

for (const theme of THEMES) {
  for (const size of SIZES) {
    const tag = `${theme}-${size.width}`
    const shot = (name) => path.join(out, `${tag}-${name}.png`)
    const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1 })
    // Seeded before first paint: the app boots its auth and its theme out of localStorage.
    await ctx.addInitScript(
      ([token, th]) => {
        localStorage.setItem('finance_token', token)
        localStorage.setItem('finance.theme', th)
      },
      [TOKEN, theme],
    )
    // ONE context handler: GET /prefs answers with this pass's theme and PATCH /prefs is stubbed
    // (a check never rewrites the account's settings); a write outside WRITE_ALLOW is aborted.
    const stamp = new Date().toISOString()
    await ctx.route('**/api/v1/**', async (route) => {
      const request = route.request()
      const method = request.method()
      const { pathname } = new URL(request.url())
      if (/^\/api\/v1\/prefs\b/.test(pathname)) {
        const entry = { value: theme, updated_at: stamp }
        if (method === 'GET') {
          let body = { prefs: {} }
          try {
            body = await (await route.fetch()).json()
          } catch {
            // the injected theme below still paints
          }
          body.prefs = { ...body.prefs, theme: entry }
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(body),
          })
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ prefs: { theme: entry } }),
        })
      }
      if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return route.continue()
      if (WRITE_ALLOW.some((re) => re.test(pathname))) {
        report.writes.push({ tag, method, pathname })
        return route.continue()
      }
      report.blockedWrites.push({ tag, method, pathname })
      problem(`${tag}: BLOCKED a write this check must never make — ${method} ${pathname}`)
      return route.abort()
    })
    const page = await ctx.newPage()
    let expectFailures = false
    const errors = []
    const take = (entry) => {
      if (NOISE.test(entry.text) || NOISE.test(entry.url)) return
      if (
        expectFailures &&
        (/\/api\/v1\/credit-cards(\/categories)?\/order/.test(entry.url) ||
          /status of (409|500)/.test(entry.text))
      ) {
        report.knownBenign.push({ tag, why: 'the forced 500/409 of step k', ...entry })
        return
      }
      errors.push(entry)
    }
    page.on('console', (m) => {
      if (m.type() !== 'error') return
      take({ kind: 'console', text: m.text().slice(0, 300), url: (m.location() || {}).url || '' })
    })
    page.on('pageerror', (e) =>
      take({ kind: 'pageerror', text: String(e.message).slice(0, 300), url: page.url() }),
    )
    page.on('response', (r) => {
      if (r.status() >= 400) take({ kind: 'http', text: `HTTP ${r.status()}`, url: r.url() })
    })
    const drain = (step) => {
      for (const e of errors.splice(0)) {
        problem(`${tag} ${step}: ${e.kind} ${e.text}${e.url ? ` <${e.url}>` : ''}`)
      }
    }

    const open = async (route, selector) => {
      try {
        await page.goto(BASE + route, { waitUntil: 'networkidle', timeout: 45000 })
      } catch {
        await page.goto(BASE + route, { waitUntil: 'load', timeout: 45000 })
      }
      await page.waitForSelector(selector, { timeout: 20000 })
      await page.waitForTimeout(SETTLE)
    }
    const openManage = () => open(MANAGE, `${CATS} tbody tr[data-reorder-id]`)
    const domOrder = (table) =>
      page.$$eval(`${table} tbody tr[data-reorder-id]`, (rows) =>
        rows.map((row) => Number(row.getAttribute('data-reorder-id'))),
      )
    const gripOf = (table, id) =>
      page.locator(`${table} tbody tr[data-reorder-id="${id}"] .reorder-grip`)
    const mids = (table) =>
      page.$$eval(`${table} tbody tr[data-reorder-id]`, (rows) =>
        rows.map((row) => {
          const box = row.getBoundingClientRect()
          return box.top + box.height / 2
        }),
      )
    // Stand a roster row mid-window: below the sticky page header, clear of the toasts and of
    // both 40px auto-scroll zones — whichever element scrolls the page.
    const standAt = (id) =>
      page.evaluate((rowId) => {
        document
          .querySelector(`.roster-table tbody tr[data-reorder-id="${rowId}"]`)
          .scrollIntoView({ block: 'center' })
      }, id)
    // The capped categories box, centred in the window and scrolled to its top.
    const scrollerToTop = () =>
      page.locator(SCROLLER).evaluate((el) => {
        el.scrollIntoView({ block: 'center' })
        el.scrollTop = 0
      })
    const clearToasts = async () => {
      for (const close of await page.locator('.toast-close').all()) {
        await close.click().catch(() => {})
      }
      await page.waitForTimeout(250)
    }
    const toastText = async (pattern) => {
      const toast = page.locator('.toast-message').filter({ hasText: pattern }).last()
      await toast.waitFor({ timeout: 8000 })
      return (await toast.textContent()) ?? ''
    }
    /** The list's save is back: no grip of that table is parked any more. */
    const waitIdle = (table) =>
      page.waitForFunction(
        (sel) => document.querySelector(`${sel} .reorder-grip[aria-disabled="true"]`) === null,
        table,
        { timeout: 10000 },
      )
    const undo = async (moved) => {
      await page
        .locator('.toast')
        .filter({ hasText: `Moved ${moved}` })
        .last()
        .getByRole('button', { name: 'Undo' })
        .click()
      await page.getByText('Order restored', { exact: true }).last().waitFor({ timeout: 8000 })
      await page.waitForTimeout(SETTLE) // the page's reload lands
    }
    // A real pointer drag of `id` by k rows (k < 0 is up). The lifted centre is aimed 40% of the
    // way from the k-th peer's midpoint to the next one, so it has passed exactly |k| peers (lane
    // R0's slot rule) whatever the rows' heights. The caller puts the rows on screen first.
    const mouseDrag = async (table, id, k, step) => {
      await clearToasts()
      const before = await domOrder(table)
      const from = before.indexOf(id)
      const to = from + k
      const m = await mids(table)
      const beyond = m[to + Math.sign(k)] ?? m[to] + Math.sign(k) * (m[1] - m[0])
      const dy = m[to] + 0.4 * (beyond - m[to]) - m[from]
      const box = await gripOf(table, id).boundingBox()
      const x = box.x + box.width / 2
      const y0 = box.y + box.height / 2
      await page.mouse.move(x, y0)
      await page.mouse.down()
      await page.mouse.move(x, y0 + Math.sign(k) * 6, { steps: 2 }) // past the 4px threshold
      await page.mouse.move(x, y0 + dy, { steps: 12 })
      await page.waitForTimeout(250)
      const mid = await page.evaluate((sel) => {
        const lifted = document.querySelector(`${sel} tr[data-reorder="lifted"]`)
        if (lifted === null) return null
        const cells = lifted.querySelectorAll('td')
        const actions = lifted.querySelector('td.row-actions')
        return {
          offset: Number(/translateY\((-?[\d.]+)px\)/.exec(lifted.style.transform)?.[1] ?? NaN),
          displaced: [...document.querySelectorAll(`${sel} tr[data-reorder="shifting"]`)].filter(
            (row) => row.style.transform !== '',
          ).length,
          grabbing: document.documentElement.classList.contains('reorder-active'),
          cellBackground: getComputedStyle(cells[1]).backgroundColor,
          actionsBackground: actions === null ? null : getComputedStyle(actions).backgroundColor,
        }
      }, table)
      await page.screenshot({ path: shot(`${step}-mid-drag`) })
      await page.mouse.up()
      await page.waitForTimeout(MOTION + 700)
      if (check(tag, `${step}: a row lifts under the pointer`, mid !== null, mid)) {
        check(tag, `${step}: the lifted row follows the pointer`, Math.abs(mid.offset - dy) <= 2, {
          offset: mid.offset,
          dy,
        })
        check(tag, `${step}: exactly the rows it passed make room`, mid.displaced === Math.abs(k), mid.displaced)
        check(tag, `${step}: the page says grabbing`, mid.grabbing, mid.grabbing)
        check(
          tag,
          `${step}: the pinned actions cell rides on the lifted surface`,
          mid.actionsBackground === mid.cellBackground,
          mid,
        )
      }
      const expected = moveTo(before, from, to)
      check(tag, `${step}: the row lands where the gap was`, same(await domOrder(table), expected), {
        from,
        to,
      })
      return expected
    }
    const keyboardMove = async (table, id, keys) => {
      await clearToasts()
      await gripOf(table, id).focus()
      await page.keyboard.press('Space')
      for (const key of keys) await page.keyboard.press(key)
      await page.keyboard.press('Space')
    }
    const focusedRow = () =>
      page.evaluate(() => document.activeElement?.closest('tr')?.getAttribute('data-reorder-id') ?? null)
    // echarts' handle, fetched only AFTER the cards have painted (tools/probes/espp-v: an import
    // at page-init makes the dev server transform the chart graph while the page is loading).
    const lineSeries = async () => {
      await page
        .locator('section.chart-card', { has: page.locator('h2', { hasText: 'Credit line history' }) })
        .scrollIntoViewIfNeeded()
      await page.evaluate(async () => {
        try {
          const m = await import('/src/charts/echarts.ts')
          window.__echarts = m.echarts
        } catch (e) {
          window.__hookError = String(e)
        }
      })
      const start = Date.now()
      while (Date.now() - start < 10000) {
        const seen = await page.evaluate(() => {
          const card = [...document.querySelectorAll('section.chart-card')].find((c) =>
            /Credit line history/.test(c.querySelector('h2')?.textContent ?? ''),
          )
          const host = card?.querySelector('[_echarts_instance_]')
          const inst = host && window.__echarts ? window.__echarts.getInstanceByDom(host) : null
          const series = inst?.getOption()?.series
          return Array.isArray(series) && series.length > 0
            ? series.map((s) => ({ name: s.name, color: s.color }))
            : null
        })
        if (seen !== null) return seen
        await page.waitForTimeout(250)
      }
      return null
    }

    try {
      // ── a. the resting Manage view ─────────────────────────────────────────────────────────
      await openManage()
      const painted = await page.evaluate(() => document.documentElement.dataset.theme ?? null)
      check(tag, 'a: the page paints this theme', painted === theme, painted)
      for (const table of [ROSTER, CATS]) {
        const resting = await page.evaluate((sel) => {
          const t = document.querySelector(sel)
          const cells = [...t.querySelectorAll('tbody tr:nth-child(-n+3) > td')]
          return {
            className: t.className,
            borderCollapse: getComputedStyle(t).borderCollapse,
            firstHead: t.querySelector('thead th')?.className ?? null,
            gripColumn: Math.round(t.querySelector('thead th').getBoundingClientRect().width),
            hairlines: cells.every((td) => getComputedStyle(td).borderBottomWidth === '1px'),
          }
        }, table)
        check(
          tag,
          `a: ${table} is reorderable with separate borders`,
          resting.className.includes('reorder-table') && resting.borderCollapse === 'separate',
          resting,
        )
        check(tag, `a: ${table} puts the grip column first`, resting.firstHead === 'reorder-grip-cell', resting.firstHead)
        check(tag, `a: every ${table} cell keeps its hairline`, resting.hairlines, resting)
        note(tag, `a: ${table} grip column width (px)`, resting.gripColumn)
      }
      check(tag, 'a: the roster is the server order', same(await domOrder(ROSTER), ORIGINAL_CARDS), await domOrder(ROSTER))
      check(tag, 'a: the categories are the server order', same(await domOrder(CATS), ORIGINAL_CATS), await domOrder(CATS))
      await page.locator('section.card', { has: page.locator(ROSTER) }).screenshot({ path: shot('a-roster-rest') })
      await page.locator('section.card', { has: page.locator(CATS) }).screenshot({ path: shot('a-categories-rest') })
      drain('a')

      // ── b. the credit-line colours before any move ─────────────────────────────────────────
      await open(LINES, 'section.chart-card')
      const before = await lineSeries()
      check(tag, 'b: the credit-line chart painted', before !== null, before)
      check(tag, 'b: its legend is the list order', same(before?.map((s) => s.name), legendFor(ORIGINAL_CARDS)), before)
      const colourOf = new Map((before ?? []).map((s) => [s.name, s.color]))
      drain('b')

      // ── c. the roster: a real mouse drag across three rows, and a reload ──────────────────
      await openManage()
      await standAt(ORIGINAL_CARDS[0])
      await page.waitForTimeout(250)
      const cOrder = await mouseDrag(ROSTER, ORIGINAL_CARDS[0], 3, 'c')
      const cSaid = await toastText(/^Moved /)
      check(tag, 'c: the toast names the card', cSaid === `Moved ${CARD_NAME.get(ORIGINAL_CARDS[0])}`, cSaid)
      await waitIdle(ROSTER)
      check(tag, 'c: the server holds the new order', same(await cardIds(), cOrder), await cardIds())
      await page.locator('section.card', { has: page.locator(ROSTER) }).screenshot({ path: shot('c-roster-dropped') })
      await openManage()
      check(tag, 'c: the order survives a reload', same(await domOrder(ROSTER), cOrder), await domOrder(ROSTER))
      drain('c')

      // ── d. the rewards matrix's columns follow ─────────────────────────────────────────────
      await open(REWARDS, '[id^="card-col-"]')
      const columns = await page.$$eval('[id^="card-col-"]', (buttons) =>
        buttons.map((button) => Number(button.id.slice('card-col-'.length))),
      )
      check(tag, "d: the matrix's columns follow the new order", same(columns, cOrder.filter((id) => ACTIVE.has(id))), columns)
      drain('d')

      // ── e. every line keeps its colour; the legend follows the list ───────────────────────
      await open(LINES, 'section.chart-card')
      const after = await lineSeries()
      check(tag, 'e: the legend follows the new order', same(after?.map((s) => s.name), legendFor(cOrder)), after)
      check(
        tag,
        'e: the move changed the drawn order (so the colour check below means something)',
        !same(legendFor(cOrder), legendFor(ORIGINAL_CARDS)),
        legendFor(cOrder),
      )
      check(
        tag,
        'e: every card keeps its colour through the reorder',
        (after ?? []).length > 0 && (after ?? []).every((s) => colourOf.get(s.name) === s.color),
        { before, after },
      )
      await page
        .locator('section.chart-card', { has: page.locator('h2', { hasText: 'Credit line history' }) })
        .screenshot({ path: shot('e-credit-lines') })
      await putCards(ORIGINAL_CARDS)
      check(tag, 'e: put back through the API', same(await cardIds(), ORIGINAL_CARDS), await cardIds())
      drain('e')

      // ── f. the same drag again; the toast's Undo restores the order ───────────────────────
      await openManage()
      await standAt(ORIGINAL_CARDS[0])
      await page.waitForTimeout(250)
      await mouseDrag(ROSTER, ORIGINAL_CARDS[0], 3, 'f')
      await toastText(/^Moved /)
      await waitIdle(ROSTER)
      await undo(CARD_NAME.get(ORIGINAL_CARDS[0]))
      check(tag, 'f: Undo restores the server order', same(await cardIds(), ORIGINAL_CARDS), await cardIds())
      check(tag, 'f: …and the roster shows it', same(await domOrder(ROSTER), ORIGINAL_CARDS), await domOrder(ROSTER))
      drain('f')

      // ── g. the roster's keyboard path ──────────────────────────────────────────────────────
      await standAt(ORIGINAL_CARDS[1])
      await keyboardMove(ROSTER, ORIGINAL_CARDS[1], ['ArrowDown', 'ArrowDown'])
      const gSaid = await toastText(/^Moved /)
      await waitIdle(ROSTER)
      const gOrder = moveTo(ORIGINAL_CARDS, 1, 3)
      check(tag, 'g: Space, ↓ ×2, Space moves the card two places', same(await domOrder(ROSTER), gOrder), await domOrder(ROSTER))
      check(tag, 'g: the toast', gSaid === `Moved ${CARD_NAME.get(ORIGINAL_CARDS[1])}`, gSaid)
      check(tag, 'g: focus stays on the moved grip', (await focusedRow()) === String(ORIGINAL_CARDS[1]), await focusedRow())
      check(tag, 'g: the server holds it', same(await cardIds(), gOrder), await cardIds())
      await undo(CARD_NAME.get(ORIGINAL_CARDS[1]))
      check(tag, 'g: Undo restores it', same(await cardIds(), ORIGINAL_CARDS), await cardIds())
      drain('g')

      // ── h. Categories & weights: a mouse drag inside the capped scroller ──────────────────
      await scrollerToTop()
      await page.waitForTimeout(250)
      const hOrder = await mouseDrag(CATS, ORIGINAL_CATS[0], 3, 'h')
      const hSaid = await toastText(/^Moved /)
      check(tag, 'h: the toast names the category', hSaid === `Moved ${CAT_NAME.get(ORIGINAL_CATS[0])}`, hSaid)
      await waitIdle(CATS)
      check(tag, 'h: the server holds the new order', same(await catIds(), hOrder), await catIds())
      await undo(CAT_NAME.get(ORIGINAL_CATS[0]))
      check(tag, 'h: Undo restores it', same(await catIds(), ORIGINAL_CATS), await catIds())
      check(tag, 'h: …and the list shows it', same(await domOrder(CATS), ORIGINAL_CATS), await domOrder(CATS))
      drain('h')

      // ── i. the last category to the scroller's top edge: the box auto-scrolls ─────────────
      await clearToasts()
      const lastId = ORIGINAL_CATS[ORIGINAL_CATS.length - 1]
      await page.locator(SCROLLER).evaluate((el) => el.scrollIntoView({ block: 'center' }))
      // The last row 60px above the box's foot, clear of its bottom zone: the drag starts with the
      // list's top as far above the box as it goes.
      await page.evaluate(
        ([sel, id]) => {
          const el = document.querySelector(sel)
          const row = el.querySelector(`tr[data-reorder-id="${id}"]`)
          el.scrollTop += row.getBoundingClientRect().bottom - (el.getBoundingClientRect().bottom - 60)
        },
        [SCROLLER, lastId],
      )
      await page.waitForTimeout(250)
      const s0 = await page.locator(SCROLLER).evaluate((el) => el.scrollTop)
      const sBox = await page.locator(SCROLLER).boundingBox()
      const gBox = await gripOf(CATS, lastId).boundingBox()
      const gx = gBox.x + gBox.width / 2
      const gy = gBox.y + gBox.height / 2
      await page.mouse.move(gx, gy)
      await page.mouse.down()
      await page.mouse.move(gx, gy - 8, { steps: 2 })
      await page.mouse.move(gx, sBox.y + 12, { steps: 14 })
      await page.waitForTimeout(1200)
      const s1 = await page.locator(SCROLLER).evaluate((el) => el.scrollTop)
      await page.screenshot({ path: shot('i-auto-scroll-held') })
      await page.mouse.up()
      await page.waitForTimeout(MOTION + 700)
      check(tag, 'i: holding the pointer at the top edge scrolls the capped box up', s0 > 20 && s1 < s0 - 20, { s0, s1 })
      const iOrder = [lastId, ...ORIGINAL_CATS.slice(0, -1)]
      check(tag, 'i: the last category lands first', same(await domOrder(CATS), iOrder), await domOrder(CATS))
      await toastText(/^Moved /)
      await waitIdle(CATS)
      check(tag, 'i: the server holds it', same(await catIds(), iOrder), await catIds())
      await undo(CAT_NAME.get(lastId))
      check(tag, 'i: Undo restores it', same(await catIds(), ORIGINAL_CATS), await catIds())
      drain('i')

      // ── j. the categories' keyboard path, then End keeps the landing slot in view ─────────
      await scrollerToTop()
      await keyboardMove(CATS, ORIGINAL_CATS[1], ['ArrowDown', 'ArrowDown'])
      const jSaid = await toastText(/^Moved /)
      await waitIdle(CATS)
      const jOrder = moveTo(ORIGINAL_CATS, 1, 3)
      check(tag, 'j: Space, ↓ ×2, Space moves the category two places', same(await domOrder(CATS), jOrder), await domOrder(CATS))
      check(tag, 'j: the toast', jSaid === `Moved ${CAT_NAME.get(ORIGINAL_CATS[1])}`, jSaid)
      check(tag, 'j: focus stays on the moved grip', (await focusedRow()) === String(ORIGINAL_CATS[1]), await focusedRow())
      await undo(CAT_NAME.get(ORIGINAL_CATS[1]))
      check(tag, 'j: Undo restores it', same(await catIds(), ORIGINAL_CATS), await catIds())
      await scrollerToTop()
      await clearToasts()
      const writesBefore = report.writes.length
      await gripOf(CATS, ORIGINAL_CATS[0]).focus()
      await page.keyboard.press('Space')
      await page.keyboard.press('End')
      await page.waitForTimeout(400)
      const kept = await page.locator(SCROLLER).evaluate((el) => ({
        top: el.scrollTop,
        max: el.scrollHeight - el.clientHeight,
      }))
      check(tag, 'j: End keeps the landing slot in view — the capped box scrolls to its foot', kept.max > 0 && kept.top > kept.max - 60, kept)
      await page.screenshot({ path: shot('j-keyboard-end') })
      await page.keyboard.press('Escape')
      await page.waitForTimeout(MOTION + 300)
      check(tag, 'j: Escape cancels — no request, nothing moved', report.writes.length === writesBefore && same(await domOrder(CATS), ORIGINAL_CATS), {
        writes: report.writes.length - writesBefore,
        order: await domOrder(CATS),
      })
      drain('j')

      // ── k. forced failures (1280) ──────────────────────────────────────────────────────────
      if (size.width === 1280) {
        expectFailures = true
        await openManage()
        await page.route(
          '**/api/v1/credit-cards/order',
          (route) =>
            route.fulfill({
              status: 500,
              contentType: 'application/json',
              body: JSON.stringify({ detail: 'Internal Server Error' }),
            }),
          { times: 1 },
        )
        await standAt(ORIGINAL_CARDS[2])
        await keyboardMove(ROSTER, ORIGINAL_CARDS[2], ['ArrowUp'])
        const failed = await toastText(/^Couldn't save the new order/)
        check(tag, 'k: a 500 says why', failed === FAILED_500, failed)
        check(tag, 'k: the rows are back', same(await domOrder(ROSTER), ORIGINAL_CARDS), await domOrder(ROSTER))
        check(tag, "k: focus stays on the moved card's grip through the revert", (await focusedRow()) === String(ORIGINAL_CARDS[2]), await focusedRow())
        check(tag, 'k: nothing was saved', same(await cardIds(), ORIGINAL_CARDS), await cardIds())
        await waitIdle(ROSTER)
        await page.route(
          '**/api/v1/credit-cards/order',
          (route) =>
            route.fulfill({
              status: 409,
              contentType: 'application/json',
              body: JSON.stringify({ detail: STALE_CARDS }),
            }),
          { times: 1 },
        )
        const cardsReload = page.waitForRequest(
          (r) => r.method() === 'GET' && /\/api\/v1\/credit-cards(\?|$)/.test(r.url()),
          { timeout: 10000 },
        )
        await keyboardMove(ROSTER, ORIGINAL_CARDS[0], ['ArrowDown'])
        check(tag, "k: a stale roster shows the server's sentence", (await toastText(STALE_CARDS)) === STALE_CARDS, null)
        check(tag, 'k: …and the page reloads the list', await cardsReload.then(() => true, () => false), null)
        await page.waitForTimeout(SETTLE)
        check(tag, 'k: the roster reads as the server has it', same(await domOrder(ROSTER), await cardIds()), await domOrder(ROSTER))
        await page.route(
          '**/api/v1/credit-cards/categories/order',
          (route) =>
            route.fulfill({
              status: 409,
              contentType: 'application/json',
              body: JSON.stringify({ detail: STALE_CATEGORIES }),
            }),
          { times: 1 },
        )
        const catsReload = page.waitForRequest(
          (r) => r.method() === 'GET' && /\/api\/v1\/credit-cards\/categories(\?|$)/.test(r.url()),
          { timeout: 10000 },
        )
        await scrollerToTop()
        await keyboardMove(CATS, ORIGINAL_CATS[0], ['ArrowDown'])
        check(tag, "k: stale categories show the server's sentence", (await toastText(STALE_CATEGORIES)) === STALE_CATEGORIES, null)
        check(tag, 'k: …and the page reloads them', await catsReload.then(() => true, () => false), null)
        await page.waitForTimeout(SETTLE)
        check(tag, 'k: the categories read as the server has them', same(await domOrder(CATS), await catIds()), await domOrder(CATS))
        expectFailures = false
        drain('k')
      }
    } catch (error) {
      problem(`${tag}: the pass stopped — ${error instanceof Error ? error.message : String(error)}`)
      await page.screenshot({ path: shot('stopped'), fullPage: true }).catch(() => {})
    } finally {
      // A stopped pass must not leave the private lists moved.
      if (!same(await cardIds(), ORIGINAL_CARDS)) {
        problem(`${tag}: the roster was not in its starting order after the pass — put back through the API`)
        await putCards(ORIGINAL_CARDS)
      }
      if (!same(await catIds(), ORIGINAL_CATS)) {
        problem(`${tag}: the categories were not in their starting order after the pass — put back through the API`)
        await putCats(ORIGINAL_CATS)
      }
      await ctx.close()
    }
  }
}
await browser.close()

check('end', 'the roster ends in the order it started in', same(await cardIds(), ORIGINAL_CARDS), await cardIds())
check('end', 'the categories end in the order they started in', same(await catIds(), ORIGINAL_CATS), await catIds())
writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
if (report.problems.length > 0) {
  console.error(`R5 CARDS CHECK: ${report.problems.length} problem(s) — ${path.join(out, 'report.json')}`)
  for (const p of report.problems) console.error(` - ${p}`)
  process.exit(1)
}
console.log(`R5 CARDS CHECK OK — ${report.checks.length} checks; report and screenshots in ${out}`)
```

- [ ] **Step 6: Run it**

Run (worktree root): `node scratchpad/reorder-r5/drag.mjs`
Expected: `R5 CARDS CHECK OK — … checks; report and screenshots in …/scratchpad/reorder-r5/out`, exit
0. `report.json` lists every check with its observed value. `ONLY_THEME=dark ONLY_WIDTH=1280`
narrows a re-run to one pass.

What each step proves (spec §10's list, for these two surfaces):

| Step | Proves |
|---|---|
| a | both tables compute `border-collapse: separate` in the real bundle, grip column first, every cell's hairline intact, the server's order on screen |
| b, e | echarts' applied option: before and after a reorder, every card's line has the same colour while the legend follows the list (e also proves the drawn order really changed) |
| c | a real mouse drag: the row follows the pointer (±2 px), exactly three peers make room, `html.reorder-active`, the sticky actions cell on the lifted surface, the toast, the server's order, the order after a reload |
| d | the rewards matrix's columns follow the new order |
| f | the toast's Undo restores the server's order and the roster shows it |
| g, j | the keyboard path — Space, ↓ ×2, Space — with focus kept on the moved grip, then Undo |
| h | a mouse drag inside the 440 px capped scroller, then Undo |
| i | auto-scroll inside the capped scroller: `scrollTop` falls under a held pointer and the last row lands first |
| j (end) | a keyboard End scrolls the capped box to keep the landing slot in view; Escape cancels with no request |
| k | a forced 500 (rows back, focus kept, nothing saved) and forced 409s (the server's sentence, the page reloads) |
| every step | no console error, page error or failed request outside the forced ones |

- [ ] **Step 7: Eyeball the screenshots (both themes)**

Open `scratchpad/reorder-r5/out/`:
- `*-a-roster-rest.png`, `*-a-categories-rest.png`: the resting tables look as they did before —
  hairlines, header, the sticky actions column; the grip column is narrow and muted; the Categories
  grips sit inside the capped box.
- `*-c-mid-drag.png`, `*-f-mid-drag.png`, `*-h-mid-drag.png`: the lifted row is raised on
  `--surface-2` with its hairlines, the actions cell included; the rows it passed have made room.
- `*-i-auto-scroll-held.png`: the box has scrolled, and the lifted row sits at the top of the list.
  Note whether the lifted row paints over the box's sticky header — R0 gives the lifted row
  `z-index: 2` and the header has 1; see Notes for the controller.
- `*-e-credit-lines.png`: the legend lists the cards in the new order; each line's colour matches
  the `b` values in `report.json`.
- `*-j-keyboard-end.png`: the keyboard-lifted row stands at the foot of the scrolled box.

Record anything off in Results.

- [ ] **Step 8: If a check fails**

- Use superpowers:systematic-debugging.
- A defect in this lane's files gets a failing test first (in `CreditCardsPage.test.tsx` or
  `creditLineChartOptions.test.ts`), then the fix and a re-run.
- A defect in `src/components/reorder/**` or `src/api/**` is not patched here. Record it and report
  it to the controller: lanes R0 and R1 own those files.

- [ ] **Step 9: Stop the two servers**

Only the lane's own, by port (PowerShell):

```powershell
Get-NetTCPConnection -LocalPort 8095,5195 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force }
```

Never touch 8000/5173 or another lane's ports. Leave `finance_reorder_r5` in place — never drop it.
Nothing to commit: `scratchpad/` is gitignored.

---

### Task 12: results

**Files:**
- Modify: `docs/superpowers/plans/2026-09-23-reorder-r5-cards.md` (the Results section only)

- [ ] **Step 1: Fill in Results.** Record:
  - the counts from Tasks 0 and 10;
  - the browser check's outcome from Task 11 — per pass and per step, the auto-scroll distance
    (`s0 → s1`), the colours before and after, and the focus-through-revert result;
  - screenshot notes, including the sticky-header observation;
  - anything the controller should pass to R0, R1 or V.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-09-23-reorder-r5-cards.md
git commit -m "docs(plan): lane R5 — results, gates and the browser check"
```

---

## Results (filled in by the implementer)

- **Task 0 preflight:** `feat/reorder-cards` cut from `feat/reorder-base` @da1a3e44 (R0, R1, R4 and
  main with B2). `reorderCreditCards` (`creditCards.ts:36`) and `reorderRewardCategories` (`:105`)
  are present; `CreditCardIn.sort_order?: number | null` (`api.ts:2208`); the base still had
  `draggable={!busy}` (`CategoriesPanel.tsx:400`). Baseline: 15 files / 240 tests —
  CreditCardsPage 47, creditLineChartOptions 8, guideContent 13, focusCss 8, conformance 57.
  - Mid-lane, at the controller's request, `feat/reorder-base` @d5efe2d9 (R0 round 4:
    leading-edge slot rule, range-end auto-scroll stop, one hairline per lifted unit) was merged in
    cleanly (484ba60e). Every lane test re-ran green (273 across the lane's files and
    `src/components/reorder`).
- **Commits:** d1ab202e, 8f7dd367 (colours, A1) · dbb3040d (categories grip, A3) · 6dc8fd45
  (categories Undo/failure) · ba892c9a (categories: R3 review lessons) · 07ea3458 (categories
  buttons, append) · ff56b2a7, 03b804c7, 71687597 (roster Tasks 6–8) · 0583ba3a (roster: R3 review
  lessons) · 41c35618 (Guide, A2) · dbb8e8ae (the page's load order, from the Edge check).
- **Lane tests (Task 10 Step 1, before the last fix):** 20 files / 387 tests.
  - CreditCardsPage 88: the plan's 75, plus 1 A1 page test and 12 R3-lesson tests. It is 89 with
    the load-order test.
  - creditLineChartOptions 15: the plan's 12 plus 3 for A1.
  - guideContent 13, focusCss 8, conformance 57, `src/components/reorder` 99.
- **Full vitest** (`--maxWorkers=2`, run once, last): 246 files / 3449 tests, exit 0, 300 s. No
  flake needed a re-run (PaycheckPage 84, OverviewPage 82 and CategoriesCard 13 all passed in the
  full run).
- **tsc -b / eslint . / npm run build** (on the final tree): 0 / 0 (26 warnings) / 0 (built in
  9.1 s). The only warning in a touched file is `CategoriesPanel.tsx`'s pre-existing
  `export const SEED_CATEGORIES` (react-refresh).
- **Scope check** (`git diff --stat feat/reorder-base...HEAD`): 9 files — the plan's 8 plus
  `src/focusCss.test.ts` (A3).
  - `categories.css`: deletions only (24 lines).
  - `CreditCardsPage.tsx`: the `lineCards` map (`id` plus two comment lines); A1's `rankIds` line
    and its `cards` dependency; and the load's sequence guard (deviation 3 below).
  - `grep -rn draggable src/components/creditcards/` prints nothing.
- **Browser check** (`scratchpad/reorder-r5/drag.mjs`, `out/report.json`): `R5 CARDS CHECK OK —
  309 checks`, 0 problems. It made 44 writes (reorder PUTs only) and blocked none; the 12
  known-benign entries are step k's forced 500/409s. Every step a–k passed in every pass (dark and
  light × 1600 and 1280).
  - **Pointer:** the lifted row follows the pointer exactly (offset = dy). Roster: 145.1 px at
    1600, 169.1 px at 1280. Categories: 128.9 / 142.1. Exactly 3 peers made room,
    `html.reorder-active` was set, and the pinned actions cell rode the lifted surface.
  - **Auto-scroll** `s0 → s1`: 407 → 0 (1600) and 510 → 0 (1280); the last category landed first.
    Keyboard End scrolled the box to its foot (407/407, 510/510); Escape sent no request.
  - **Colours before and after the reorder** (identical, while the legend moved Venture X to
    fourth):
    - dark: Venture X #3987e5, Savor #d95926, Robinhood Gold #199e70, Active Cash #c98500,
      Autograph #d55181, Apple Card #008300, Total #e6e9ef;
    - light: #2f6fdc / #c94f1e / #15895f / #996500 / #c2436f / #1f7a1f / #141a24.
  - **A1 across scopes** (b2 before, e after): Edward's scope draws the same six colours. Grace's
    and Joint's scopes each draw the Apple Card alone, in the household's green (#008300 dark,
    #1f7a1f light).
  - **Focus through the forced 500:** kept on the moved card's grip (Robinhood Gold), with the
    toast verbatim and the rows back. Both 409s show R1's sentences and reload the list.
  - The first run failed from step f onward. See deviation 3.
- **Screenshot notes** (both themes, 1280 and 1600):
  - Resting tables: unchanged apart from a narrow, muted grip column, and the Categories grips sit
    inside the capped box.
  - Mid-drag (c, f, h): the lifted row is raised on `--surface-2` with its hairlines, the actions
    cell included. The rows it passed made room, and the row buttons are dimmed.
  - i (auto-scroll): in the held frame the box has reached its top, and the lifted row sits clamped
    just under the sticky header, with no overlap. While the box scrolls, the row follows the
    pointer into the top zone and can pass over the header (R0's `z-index: 2` against the header's
    1; Notes item 2) — V to judge once for both scrollers.
  - b/e/b2: the legend follows the list and every line keeps its hue; Grace's lone Apple Card is
    the household green.
  - j: the keyboard-lifted row stands at the foot of the scrolled box, and the grip's focus ring is
    drawn inside the box (A3's inset rule).
  - Pre-existing, not this lane's: `.roster-table .row-actions` and `.categories-table .row-actions`
    are `display: flex`. The cell is therefore not a table cell and ends above a taller row, so its
    hairline sits 4–23 px above the row's. This measured the same with and without
    `.reorder-table` (e.g. 23.4 px on a two-line roster row at 1280;
    `scratchpad/reorder-r5/compare.mjs`).
  - The one resting-look change the border model makes: the pinned header cell now draws its −1 px
    hairline in the header row as well.
- **Deviations from the plan:**
  1. **A1–A3**, as amended by the controller:
     - `creditLineChartOption(…, { rankIds })`, and `colourSlots` ranks among `rankIds ∪` the drawn
       ids (a drawn id missing from the source never gets `slotColor(-1)`).
     - `cards-reorder` goes in `more`, right after `cards-archive-delete`: the card already shows 8
       visible tasks, the fence's maximum.
     - The focusCss literal is swapped.
  2. **Lane R3's lessons** (coordinator messages, mid-lane):
     - (a) The Undo's answer becomes the saved layer. The plan's code already did this; it is now
       pinned per panel by "drop → Undo → drag again" with the page skipping an identical reload.
       Mutation-checked: without `setSavedOrder(restored)` that test shows the dropped order,
       while the plan's own Undo test still passes.
     - (b) No layer outlives a reload. Every reorder PUT drops the page's snapshot (`api()` →
       `invalidateForMutation`), and GETs answer fresh arrays, so the reload always hands new
       props. Pinned per panel by an "another tab put the order back" test. The fake GETs now
       answer fresh rows: a reused array made React bail out of `setState` and hid the retirement.
     - (c) Pinned as in (a).
     - The three code-review lessons:
       - `onChangedRef`, so every async `onChanged` call site uses the latest one, delete-Undo
         included;
       - an in-flight counter (`begin`/`settle`); the delete-Undo's re-create is counted too;
       - two-argument `.then` on the reorder save and Undo chains. The delete-Undo chains keep
         their `catch`: a credit or limit event that fails to come back is a failed restore.
       - Four tests per panel: a direct-render rerender test; A answered, B pending, A's Undo —
         the grips stay parked until both settle; and a synchronous throw in a success branch
         surfaces as an unhandled rejection, never a failure toast (collected with a test-scoped
         `process` listener, which vitest 3.2 yields to).
  3. **`CreditCardsPage.load` gained a sequence guard**, outside the call-site fence.
     - The first Edge run failed from step f: the drop's reload, whose `/net-worth/accounts`
       answered last, landed after the Undo's and overwrote it. The roster showed the dropped
       order over a server holding the restored one, and step g's drag then saved it. That is
       R3's symptom by another road: out-of-order page loads.
     - No panel layer can defend against stale props that land last.
     - Fixed with PortfolioPage's `seqRef` pattern (a superseded load's answer and error are
       dropped). The failing test came first and reproduced Edge's `['2','1','3']`; the re-run
       is clean.
  4. **Browser script:**
     - `mouseDrag` aims the leading edge (R0 round 4's slot rule) rather than the centre;
     - step b2 and the scope half of step e are A1;
     - step k also screenshots the forced 500.
  5. **Extra pins:** R0's dev contract check stays silent (a `console.error` spy in both grip
     tests), and an A1 page test (an archived Venture X holds rank 0; Sam's lone RH Gold keeps
     slot 2).
- **For the controller / R0 / R1 / V:**
  - V: the Guide probes' task and rail-row counts move by one (`cards-reorder`).
  - V/R0: the lifted row passing over a capped box's sticky header mid-scroll (Notes item 2), and
    the pinned header cell's hairline now showing under `.reorder-table`.
  - The flex `.row-actions` cells' offset hairline is pre-existing (panel CSS, all tables with
    that class).
  - `CardDetail`'s one-card sparkline still draws PALETTE[0]: it has no ids and is outside the
    fence. Under A1's "one colour per money entity", handing it `{ id }` and `rankIds` would make
    the drill-in line match the page chart.
  - Lane vites share `node_modules/.vite` with the main checkout through the junction. This one
    re-optimized dependencies at start ("vite config has changed"), which can disturb 5173's dep
    cache.
  - A4: the save/Undo shape now lives in both panels (two layers, `clause`, `dropPendingOrder`,
    `restoreOrder`, `saveOrder`, the counter, `onChangedRef`). The shared hook is the later
    decision.
  - Other pages with an unguarded multi-request `load` and panels that Undo through it would
    race the same way as deviation 3.
  - `finance_reorder_r5`: both orders were put back. The card `sort_order`s are now renumbered
    0–6 (the same order); no rows were created.

---

## Notes for the controller (cross-lane findings made while planning)

1. **`src/focusCss.test.ts:80` names a selector this lane deletes.**
   - The test lists `.drag-handle:focus-visible` among the component rings that `index.css`'s inset
     rule for `.categories-scroll` must outrank.
   - It compares the specificity of literal strings, so it keeps passing — but after Task 3 that
     selector exists nowhere.
   - The grip now inside `.categories-scroll` (and R2's `.settings-scroll`) is
     `.reorder-grip:focus-visible` (0,2,0), which the inset rule (0,3,0) outranks. The ring is
     therefore drawn inset at −2 px inside those boxes, as B2 intended.
   - Suggested one-line follow-up outside this fence (controller or V): swap the literal for
     `.reorder-grip:focus-visible`.
2. **A lifted row paints over a capped box's sticky header.**
   - R0's `[data-reorder='lifted']` has `z-index: 2`. `.categories-scroll thead th` (categories.css)
     and R2's `.settings-scroll thead th` are sticky at `z-index: 1`.
   - During an upward auto-scroll the lifted row, which follows the pointer into the box's top
     40 px, draws over the header row.
   - Arguably right for the row in hand. Task 11 Step 7 screenshots it; V should judge it once for
     both scrollers. It is not changed here: the fix would be R0's (e.g. `z-index: 1` on a lifted
     row inside a sticky-header box).
3. **The Guide has no card-roster ordering step.** Task 9 only rewrites the categories one (the
   approved edit). If a roster task is wanted, this passes the fences (Card roster is a heading in
   the UI; both steps are under 160 characters):
   ```ts
   {
     id: 'cards-reorder',
     title: 'Reorder your cards',
     where: 'Credit cards → Manage → Card roster',
     steps: [
       'Drag a card by its grip, or focus the grip and press Space, move it with the arrow keys and press Space again.',
       'The matrix columns and the credit-line legend follow the new order; each line keeps its colour.',
     ],
     to: '/credit-cards?section=manage',
     keywords: ['reorder cards', 'card order'],
   },
   ```
   It adds a Guide task, so the Guide probes' destination and rail-row counts would move by one.
4. **Colour rank is "among the cards drawn"** (spec §7, followed verbatim).
   - A person scope that draws fewer cards ranks them afresh. In the census the joint Apple Card
     (id 6) is PALETTE[5] in the household view and PALETTE[0] in Grace's, where it is the only
     card drawn. Array position did the same before.
   - If a card's hue should also hold across scopes, rank by id among ALL cards instead. That means
     passing the page's full id list as the rank source: a small extra parameter plus one line at
     the call site. Not done here.
5. **`CardDetail.tsx` and `src/charts/fixtures/creditLine.fixture.ts`** call `creditLineChartOption`
   without ids. The optional `id` keeps them on array position, which for one card is slot 0 as
   before. Neither needs an edit.
6. **`src/guide/content/pages-tracking.tsx` is also edited by lane R4** (the `overview-customize`
   steps, near line 31). R5 edits `cards-hide-category`, near line 729: separate hunks, a clean
   merge in either order.
7. **R1 facts this lane relies on:**
   - Decision 14: `CreditCardIn.sort_order?: number | null`.
   - The append defaults for `POST /credit-cards` and `POST /credit-cards/categories`.
   - A card PATCH without `sort_order` keeps the stored value.
   - The two 409 sentences, used verbatim in tests and in the browser script.
   - Both PUTs answer with complete rows. This is load-bearing: `savedOrder` renders them, and an
     edit reads its `sort_order` from them.
8. **A pre-existing lint warning.** `CategoriesPanel.tsx`'s `export const SEED_CATEGORIES` trips
   `react-refresh/only-export-components` on the base (line 20). It is not introduced here, and it
   is not fixed here: the fix is a new file outside the fence.
9. **The same save/Undo shape now lives in three panels:** `TransactionsPanel` (R3), `CardsPanel` and
   `CategoriesPanel` (R5). Each has the two layers, `clause`, `dropPendingOrder`, `restoreOrder` and
   `saveOrder`. A shared `useServerOrder(rows, save, …)` hook could fold them later; out of scope for
   this batch.
10. **Database.** `finance_reorder_r5` exists, at alembic `f12026091203` at planning time; migrate it
    after R1's merge (prerequisite 4). Spec §10 names `finance_reorder_scratch`; this lane uses its
    private copy. The check restores both orders and creates no rows.
11. **Delete-Undo in both panels** still re-creates the row at its stored `sort_order`, an explicit
    number R1 honours. After a renumber the vacated slot is the deleted row's own, so the row returns
    to its place. It is left unchanged.
12. **Base state at planning:** `feat/reorder-base` @0d805010 carries main @72c789a8 (B2) and R0
    (with 04b417b1, "a held Space or Enter is swallowed"); R1 was not yet merged.

---

## Self-review — every R5 requirement mapped to a task

| Spec | Requirement | Task |
|---|---|---|
| §7 card list | a grip column first; the table carries `.reorder-table` | 6 |
| §7 card list | items are all cards, active and inactive, in API order (one range) | 6 (the archived card moves) |
| §7 card list | drop → optimistic → `PUT /credit-cards/order` → `onChanged()` → `markSaved` → `toast.success("Moved {card}")` | 6 |
| §7 card list | Undo re-sends the previous order (the endpoint is not logged) | 7 |
| §7 card list | a new card is created without `sort_order`, so it appends | 8 (add-flow test) |
| §7 card list | Edit keeps sending the stored `sort_order` (full replace) | 8 (read from the rendered rows; the existing sort_order-7 test still passes) |
| §7 card list | the rewards-matrix columns follow the new order by construction | 6 (Rewards tab after the reload), 11d |
| §7 colours | the colour slot is the card's rank by id among the cards drawn; a reorder never repaints a card | 1, 2 (page), 11b/e |
| §7 colours | series, legend and tooltip order follow the user's order | 1 (series; no legend `data`; the existing tooltip test), 2, 11e |
| §7 colours | the 8-slot cap and `OTHER_SERIES_COLOR` rule applies to the id rank | 1 (nine cards) |
| §7 colours | the call site in `CreditCardsPage.tsx` passes ids (additive) | 2 |
| §7 categories | native handlers, `dragArmed`, `dragIndex`/`overIndex`, the per-row PATCH chain removed; the shared component used | 3 |
| §7 categories | `.drag-handle` / `.drag-over` / `tr.is-dragging` removed from `categories.css` | 3 (plus the dead `.drag-cell`, Decision 12) |
| §7 categories | a drop is ONE `PUT /credit-cards/categories/order`, with a toast and a client Undo | 3, 4 |
| §7 categories | keyboard model: lift-and-drop (§2.4) | 3 (R0 hook; keyboard tests throughout) |
| §7 categories | the existing test rewritten: Space → ↓ → Space → one PUT with the full order; a second move before the refetch diffs against the optimistic order | 3 |
| §7 acceptance | card-list PUT, toast and Undo | 6, 7 |
| §7 acceptance | new card without `sort_order` | 8 |
| §7 acceptance | chart option test: same colour per card after a reorder, series order follows the list | 1 |
| §7 acceptance | the Categories & weights rewrite | 3 |
| §7 acceptance | no `draggable` attribute left in `src/components/creditcards/` | 3 (source pin), 10 (grep) |
| task brief | a new category appends; the client-side `max + 1` dropped (decided) | 5 (Decision 9) |
| task brief | grips follow the panel's busy state; row buttons disabled while `reorder.active` | 3, 6 (busy); 5, 8 (row buttons) |
| task brief | the Guide's Credit Cards ordering steps moved to the grip + lift-and-drop model | 9 |
| §8.1 | Toast "Moved {name} · [Undo]" (cards, reward categories) | 3/4 (categories), 6/7 (cards) |
| §8.1 | Toast "Order restored" | 4, 7 |
| §8.1 | Toast "Couldn't save the new order — {reason}. The list is back to how it was." | 4, 7, 11k |
| §8.3 | cards and reward-categories 409 detail shown in `toast.error`; the list reloads | 4, 7 (drop and Undo), 11k |
| §8.2 | grip "Reorder {name}", described by the instructions; live region; both outside the table | 3, 6 (R0 announces) |
| §9 | a one-row list has a disabled grip; an empty list shows no grips | 6 (lone card; empty roster); the categories table renders only when rows exist |
| §9 | retired/inactive rows keep their positions and are draggable; the PUT sends every row | 3 (hidden row), 6 (archived card) |
| §9 | two tabs: 409 → toast → reload; nothing half-applied (one transaction per save) | 4, 7, 11k |
| §9 | no second drop while the save is in flight; the next drag diffs against the optimistic rows | 3 (rewrite), 6 (parked grips, mid-save) |
| §9 | Undo after a later reorder re-sends the captured order; a changed list takes the 409 path | 4, 7 |
| §9 | cancelled drags make no request (Escape here; data landing, blur and resize are R0's) | 5, 8, 11j |
| §9 | Edge at 1280/1600, both themes | 11 |
| §10 | TDD per behaviour; full vitest, `tsc -b`, eslint, `vite build` | 1–9, 10 |
| §10 | browser check on the lane's own backend (8095, `SCHEDULER_ENABLED=0`) and vite (5195, `VITE_API_PROXY`), both themes at 1280 and 1600: a real mouse drag, the order after a reload, the toast's Undo, the keyboard path, auto-scroll inside a scroller, a clean console | 11 |
| §11 | branch `feat/reorder-cards` from `feat/reorder-base` after R0 + R1 and main (B2) merged; the files this lane owns; no `src/api`/`src/types` edits | Mechanics, 0, 10 (scope check) |
