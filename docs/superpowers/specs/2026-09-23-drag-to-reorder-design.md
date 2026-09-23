# Drag to reorder (2026-09-23) — design record

**Status:** approved for implementation 2026-09-23. The user asked for click-and-drag reordering of
list elements — "(1) the Portfolio Manage tab … the transaction list, (2) the Settings Spending
Categories section … (3) the Settings Accounts section … and possibly what other areas" — while
"another claude job is at work". After the investigation below the user chose, through the question
tool: **transactions: "Change the replay order (Recommended)"**; **extras: all three offered** —
Credit Cards › card list, Credit Cards › Categories & weights, Overview › Customize. Then, verbatim:
*"no need to get my approvals - please continue and I'll go with all of your recommendations."*
Every decision below is therefore the recommendation, recorded as taken.

House rules that hold everywhere (unchanged from earlier records): money math lives on the server and
the browser never recomputes an engine figure; absent ≠ zero; copy names the noun and the reason;
both themes; desktop widths only (1280, 1600, 1920 — no phone work); every mutating path keeps its
existing ChangeBatch/Undo grammar; motion reads the tokens (`src/index.css`, `src/theme/motion.ts`)
and is instant under `prefers-reduced-motion: reduce`.

Verification data: `finance_realdata` on the dev Postgres (127.0.0.1:5433) is a byte-verified restore
of prod's 2026-09-23 06:30 UTC nightly snapshot and is shared with the in-flight quick-fixes batch —
**read it only**. Anything that writes (browser drags included) runs on a private copy,
`finance_reorder_scratch`, made with `pg_dump | psql` (never `CREATE DATABASE … TEMPLATE`, which
fails while other sessions hold connections to the source).

---

## 0. What the investigation found (the facts the design stands on)

Census of `finance_realdata` (read-only, 2026-09-23):

| List | Rows | Order column today | Notes |
|---|---|---|---|
| Accounts (`accounts`) | 29 (all active; 5 components) | `sort_order` 3…55 = old workbook column index, **two ties** (3/3, 29/29) | typed by hand in Settings; group-contiguous by accident of the sheet |
| Spending categories | 19 | `sort_order` 2…20 = workbook column index | typed by hand in Settings |
| Position transactions | 39 = 26 `import` (sort_index 30…340) + 13 `ui` (350…470) | `sort_index`, not visible or editable | **all 39 undated**; only one holding has two rows (NVDA · Schwab ESPP, two buys) |
| Credit cards | 7 | `sort_order`, never edited by any UI (new cards get 0) | order = creation order in practice |
| Reward categories | 19 | `sort_order`, edited by the existing drag | — |

1. **Where the orders show.**
   - `Account.sort_order`:
     - `GET /net-worth/accounts` (`api/net_worth.py:95`) and `net_worth_calc.py:66`.
     - The Monthly update walks **owner section → `GROUP_ORDER` → API order**, with components nested
       under their parent by `nestComponents` (`MonthlyUpdatePage.tsx:1124-1152`).
     - Net Worth nests the same way (`NetWorthPage.tsx:535`).
     - The credit-card linked-account dropdown.
   - `SpendingCategory.sort_order`:
     - The category GETs and the matrix (`api/spending.py:61,388,487`), and `services/budgets.py:179`.
     - Spending's trend chips and by-year table (`SpendingPage.tsx:770,876`).
     - Budget rows (`BudgetPanel.tsx:104`).
     - The Monthly update's spending step (`MonthlyUpdatePage.tsx:1708`).
     - The reward-category mapping dropdown.
   - No money figure depends on either order. Chart colours are rank-based, not order-based.
2. **The Monthly update's positional paste follows these orders** — `handlePaste` fills the rendered rows in
   order (`MonthlyUpdatePage.tsx:1164-1215`), including a transposed pasted sheet row. A keyed paste
   (name + value) is order-independent.
3. **A workbook re-import rewrites both orders** — `_diff_update` fields are `{name, group, sort_order}`
   for accounts (`importer/apply.py:267`) and `{name, sort_order}` for categories (`:424`). A custom
   order would be silently reverted.
4. **New rows jump to the top.** Both Settings forms default the Sort order box to 0 while stored values
   start at 2/3.
5. **Transactions: the list order is the cost-basis replay order.** `fold_transactions` folds in
   `(sort_index, id)` order (`portfolio_calc.py:57`; "txn_date is mostly NULL and must never drive
   order"). UI rows are appended at `max + 10` (`api/portfolio.py:356-369`), i.e. always replayed last.
   Moving a sell above its buy in one holding changes average cost and realized gain; moving rows of
   different holdings changes nothing.
6. **`sort_index` doubles as the importer's identity key** for `source='import'` rows (`apply.py:165-220`
   keys `existing` by it and sync-deletes keys missing from the sheet). Moving a sheet row and
   re-importing would create a duplicate and delete the moved row — or, if the new value hit another
   sheet row's key, overwrite the wrong row.
7. **The only existing drag** is Credit Cards › Categories & weights (`creditcards/CategoriesPanel.tsx`,
   native HTML5 drag + grip + arrow keys). Defects:
   - A downward drop lands one row **below** the seam it draws (`moveRow(dragIndex, overIndex)` after a
     splice).
   - One sequential PATCH per shifted row, so a mid-chain failure leaves a half-saved order.
   - Every arrow press saves.
   - No Undo, no auto-scroll, and only the keyboard path is tested (`CreditCardsPage.test.tsx:525-559`).
8. **Overview › Customize** already reorders with ↑/↓ buttons, but lists rows in the fixed default order
   and only changes a position number, so the rows never visibly move (`OverviewCustomize.tsx:31-40`).
9. **The credit-line chart colours cards by array position** (`creditLineChartOptions.ts:85-98`
   "PALETTE slots are fixed by array position"), so any card reorder would repaint every card.
10. **Server-side Undo writes whole rows back.** `undo_batch` replays the full `before` image
    (`services/changelog.py:292-360`), and `superseded()` only sees *logged* later writes.
    - Batch Undo is therefore safe only for tables whose every write path is logged: `accounts` and
      `spending_categories` are (`tests/test_changelog_pin.py`).
    - `position_transactions`, `credit_cards` and `reward_categories` are not; their CRUD is unlogged.
    - A logged reorder of those tables, undone after an unlogged edit, would silently revert the edit.
11. Both table styles use `border-collapse: collapse` (`panels.css:210`, `portfolio.css:17`). With
    collapsed borders, a `translateY` on a `<tr>` can leave the row's hairline painted in place. The
    Settings tables scroll inside a 420 px box (`.settings-scroll`), and the ledger and card tables scroll
    with the page.

Other lists considered and **not** made reorderable:

| List | Why not |
|---|---|
| Recurring card credits | would need a new column |
| RSU grants | chronological is natural |
| Allocation-target rows | re-sorted everywhere else |
| Holdings | computed; already has column sort |
| Securities | alphabetical |
| Household | primary first by rule |
| Paycheck profiles, ESPP, tax brackets, dividends, calendar sources | date- or rule-ordered |
| Sidebar nav, page tabs | code-owned |

---

## 1. Scope

| # | Surface | Order it edits | Lane |
|---|---|---|---|
| S1 | Settings › Spending categories | `spending_categories.sort_order` | R2 |
| S2 | Settings › Accounts (grouped, components nested) | `accounts.sort_order` | R2 |
| S3 | Portfolio › Manage › Transactions | `position_transactions.sort_index` (the replay order) | R3 |
| S4 | Overview › Customize (tiles, deeper views) | the `overview_layout` pref | R4 |
| S5 | Credit Cards › card list | `credit_cards.sort_order` | R5 |
| S6 | Credit Cards › Categories & weights (migrated) | `reward_categories.sort_order` | R5 |

Plus:
- the shared drag component (R0);
- the server ordering service, five reorder endpoints, the create/append defaults, the importer's order
  ownership and the transactions `import_key` migration (R1);
- verification (V).

---

## 2. The shared drag component (lane R0)

New folder `src/components/reorder/`. No new dependency.

**Why in-house:**
- `@dnd-kit/core` 6.3.1 / `@dnd-kit/sortable` 10.0.0 have had no release since Dec 2024.
- `@dnd-kit/react` is 0.5.0 (pre-1.0, API still moving).
- Atlassian's Pragmatic DnD is built on native HTML5 drag: a browser-rendered ghost and a drop line
  instead of rows making room.
- The need here is narrow: vertical lists of ≤ ~40 rows, one list at a time, rows that are `<tr>`s in
  tables with sticky cells.
- The app builds every control itself, and the detail-panel resizer already uses pointer capture
  (`DetailPanelProvider.tsx:356-360`).

### 2.1 Files

| File | Holds |
|---|---|
| `reorderMath.ts` | pure functions: units, peers, target slot from a pointer, displacement, keyboard steps, the flat reorder, announcement text |
| `useReorder.ts` | the hook: pointer + keyboard state machine, measurement, transforms, auto-scroll, cancel rules |
| `DragHandle.tsx` | the grip button |
| `ReorderStatus.tsx` | `ReorderInstructions` (visually hidden, referenced by `aria-describedby`) + `ReorderLiveRegion` (`aria-live="assertive"`, visually hidden) |
| `reorder.css` | grip, lifted row, shifting rows, drop line, saved flash, the table border model, the active-drag cursor |
| `src/testing/pointer.ts` | a guarded `PointerEvent` + `set/has/releasePointerCapture` polyfill for jsdom, imported only by the tests that need it (not the global setup) |

### 2.2 The model

A list passes its rows **in display order** as items:

```ts
interface ReorderItem<K extends string | number> {
  id: K
  range?: string   // items move only among items with the same range (default: one range)
  carries?: K[]    // rows that travel with this item (its nested rows, rendered right after it)
}
```

- The **unit** of a drag is the item plus the rows it carries.
- The **peers** are the units with the same `range`, in display order.
- A drop computes the new flat display order and calls `onCommit(next: K[], moved: K)` **exactly once**.
  It is not called when the unit lands where it started.
- Accounts are the one list that uses both options:
  - a top-level account has `range = group` and `carries = its nested components`;
  - a component has `range = "parent:<id>"` and no carries.

  So a parent moves within its group with its components, and a component moves only among its
  siblings.

The hook's surface:

```ts
const reorder = useReorder({ items, labelOf, rangeLabelOf?, disabled?, onCommit })
reorder.itemProps(id)    // spread on EVERY rendered row of the item (ref, style, data-reorder*)
reorder.handleProps(id)  // spread on the item's DragHandle
reorder.markSaved(id)    // the caller's success path: 700 ms saved flash on the unit
reorder.instructionsId   // for DragHandle's aria-describedby
reorder.announcement     // text for ReorderLiveRegion
reorder.liftedId         // K | null
```

### 2.3 Pointer behaviour

1. **Pressing.**
   - `pointerdown` on a grip (primary button, not disabled) captures the pointer on the grip. Nothing
     lifts yet.
   - Moving **≥ 4 px** lifts. A plain click does nothing; the grip keeps focus.
2. **Measuring.** At lift, every item row is measured once and converted to **list coordinates**
   (relative to the scroll container's content). The pointer is converted the same way on every move and
   scroll, so auto-scroll never breaks the math.
   - The scroll container is the nearest ancestor with `overflow-y: auto|scroll` and scrollable content;
     otherwise the page.
3. **The lifted unit.**
   - It follows the pointer (`translateY`), clamped between the top of its first peer and the bottom of
     its last peer.
   - It is marked `data-reorder="lifted"`: raised surface and shadow, `position: relative; z-index: 2`.
   - `html.reorder-active` sets `cursor: grabbing` and `user-select: none` for the drag's duration.
   - Row buttons are disabled mid-drag.
4. **The target slot.** The target is the number of *other* peers the lifted unit has passed, judged by
   its **leading edge** against each peer's original midpoint:
   - a peer below counts once the unit's bottom edge reaches its midpoint;
   - a peer above stops counting once the unit's top edge rises strictly above its midpoint.

   So a unit clamped at either end of its range lands at that end, and a tall unit (a parent carrying
   components) can pass a short peer. (Amended 2026-09-23 after lane R2's real-browser check; the
   earlier centre-vs-midpoint rule could never move a 172 px unit past a 43 px last peer.) Peers between the start and the target shift by the lifted unit's
   height (`data-reorder="shifting"`, `transition: transform var(--t-fast) var(--ease-out)`).
5. **Auto-scroll.** Within 40 px of the container's visible top or bottom edge (or the viewport's, for
   the page), the container scrolls at `18 × (1 − d/40)²` px per frame. It stops at the ends, when the
   pointer leaves the zone, and once the unit's range end is already inside the band the reader can
   see (the scroller's box clipped to the window), less the edge margin. So a held row never scrolls
   out of view past its own group. (Amended 2026-09-23 after lanes R2/R0 review.)
6. **Drop.**
   - On `pointerup` the unit eases from under the pointer into its gap over `--t-fast`. Only then
     does `onCommit` fire, inside `flushSync`, so the DOM reorder lands on rows that already stand
     where it puts them, and the transforms clear in the same frame. (Amended 2026-09-23 at lane R0's
     review: the settle comes before the commit, so there is no FLIP measurement after the reorder.)
   - The save therefore starts about 120 ms after release, and the list's `active` stays true for that
     window.
   - Displaced rows need no animation; they already stand where they end up.
   - Keyboard and reduced-motion drops commit immediately.
   - If the list unmounts during the 120 ms settle (e.g. a popover closes right after a mouse
     drop), the pending drop is committed from the unmount cleanup rather than lost. It calls
     `onCommit` directly, without `flushSync`, which a lifecycle cleanup cannot use. A consumer whose
     parent owns the order therefore keeps the drop. (Amended 2026-09-23 at lane R4's review.)
7. **Cancel.** Any of these cancels, returning every unit to its place over `--t-fast`:
   - Escape;
   - `pointercancel` or `lostpointercapture` without an up;
   - `window` blur;
   - a resize;
   - the `items` order or membership changing under a live drag (a refetch landing).

   Escape is caught on `window` in the **capture** phase while a drag is pending or live, and it calls
   `preventDefault()`. So it cancels only the drag: `usePopoverDismiss` and the detail panel both yield
   to a `defaultPrevented` Escape.

   The one exception to easing home is a **data change** (or `disabled` turning true) under a live
   lift. The rows have already re-rendered, so there is nothing to ease: the drag clears at once and
   the live region says "Cancelled — the list changed." (§8.2). "Back at position …" would describe a
   list that no longer exists. (Amended 2026-09-23 at lane R0's review.)

### 2.4 Keyboard and screen readers

- **The grip.**
  - It is a `<button type="button">` named **"Reorder {name}"**, with `aria-describedby` pointing at the
    instructions.
  - It is `disabled` when its unit has no peers (the only account in its group, the only category).
  - It carries `aria-pressed` while its unit is lifted, so assistive tech hears the state.
- **Keys:**

  | Key | While not lifted | While lifted |
  |---|---|---|
  | Space / Enter | lift | drop (one `onCommit`, or nothing if unmoved) |
  | ↑ / ↓ | — | move one place (clamped) |
  | Home / End | — | jump to first / last place in range |
  | Escape | — | cancel |
  | Tab (grip blur) | — | cancel |

- **While lifted from the keyboard:**
  - The unit is drawn at its target slot, with peers shifted exactly as in a pointer drag.
  - After each move, the scroll container scrolls just enough (nearest edge) to keep the unit in view.
- After a keyboard drop the list re-renders in the new order and **focus is put back on the moved
  unit's grip** (DOM moves can blur).
- **Announcements**, spoken by the list's live region, use the copy in §8.2.

### 2.5 Motion and visuals

- **Reduced motion** (`useReducedMotion()`):
  - Peers do not shift and nothing animates.
  - An accent **drop line** marks the target slot, drawn as an inset box-shadow on the target peer's
    edge cells (`data-reorder-drop="before" | "after"`).
  - The lifted unit still follows the pointer: direct manipulation, not animation.
  - A keyboard lift under reduced motion moves only the drop line.
- **Saved flash:** `markSaved(id)` sets `data-reorder-saved` on the unit's rows for `MOTION_MS.flash`
  (700 ms), fading an accent tint on the cells to transparent. The CSS animation and the timer read the
  same token.
- **Class names:**
  - The lifted, shifting, drop and saved states are `data-reorder*` attributes, not classes.
  - `.is-dragging` is taken by the detail-panel resizer (`details.css:102`, `assistant.css:418`) and is
    not used.
  - The grip is `.reorder-grip`.
- **Tables:**
  - A table the component drives carries `.reorder-table`, which sets
    `border-collapse: separate; border-spacing: 0`. Each cell then owns its `border-bottom` and the
    hairline travels with its row.
  - The resting look must be unchanged in both themes (verified in V).
  - The sticky last column's box-shadow hairline stays as it is.
- **Non-table lists** (Overview Customize) use the same attributes on `div` rows. CSS styles
  `tr[data-reorder=…] > td` and `:not(tr)[data-reorder=…]` alike.

### 2.6 Acceptance (R0)

- **Pure-function tests:**
  - slot math with unequal heights;
  - clamping;
  - range peers;
  - carried rows moving as one unit;
  - the flat reorder (first, last, adjacent, block, component among siblings);
  - announcements.
- **Hook tests (jsdom, polyfilled pointer events, mocked rects):**
  - the 4 px threshold (a click never lifts);
  - target slot and transforms while dragging;
  - one `onCommit` per drop, none for an unmoved drop;
  - cancel on Escape, on window blur and when `items` change;
  - the Escape is `defaultPrevented`, so an enclosing popover stays open;
  - disabled grips;
  - keyboard: lift, move, clamp, Home/End, drop, cancel, Tab cancel, focus restored after drop;
  - live-region text;
  - reduced motion: no shift transforms, a drop line instead;
  - `markSaved` timing.
- A tiny harness list in the test file proves carried rows move with their unit.

---

## 3. The server side (lane R1)

### 3.1 The ordering service — `backend/app/services/ordering.py` (pure)

- `check_permutation(current_ids, ids, *, stale_detail)`:
  - **422** "ids lists {id} more than once" on duplicates;
  - **409** with the list's stale sentence (§8.3) when `set(ids) != set(current_ids)`.
- `subset_in_slots(full_ids, visible_new_order)` — the owner-scoped transaction case:
  - the visible rows are placed, in their new order, into the positions they occupy in the full list;
  - hidden rows keep their positions.
- `renumber(rows_in_order, attr, *, start, step)` — writes the new value only where it differs, and
  returns the changed rows as `(row, old, new)`.
- `moved_ids(old_order, new_order)` — the minimal moved set:
  - the complement of a longest increasing subsequence of old positions taken in new order;
  - ties keep the earliest rows;
  - for an adjacent swap this names one of the two rows, and "moved X" is then true of either.

### 3.2 Endpoints

The body is always `OrderIn { ids: list[int] }` (1 ≤ len ≤ 10 000); ids are the list's **complete new
order**. An unchanged order is a no-op: 200, same list, no batch.

| Route | Rows the ids must match | Renumber | Response | Logged |
|---|---|---|---|---|
| `PUT /net-worth/accounts/order` | every account (active + retired) | `sort_order = 0…n−1` | `list[AccountOut]` in order + `X-Change-Batch` | **yes** (`reorder_accounts`) |
| `PUT /spending/categories/order` | every category (active + retired) | `sort_order = 0…n−1` | `list[CategoryOut]` + `X-Change-Batch` | **yes** (`reorder_categories`) |
| `PUT /portfolio/transactions/order?owner=` | the rows `GET /portfolio/transactions?owner=` returns (same filter) | slot-preserving subset, then `sort_index = 10, 20, …` over the **whole** ledger | `TransactionOrderOut` | no (§0.10) |
| `PUT /credit-cards/order` | every card (active + inactive) | `sort_order = 0…n−1` | `list[CreditCardOut]` (built as `GET /credit-cards` builds it) | no |
| `PUT /credit-cards/categories/order` | every reward category | `sort_order = 0…n−1` | `list[RewardCategoryOut]` | no |

**Logged routes.**
- They take `batch: ChangeBatch = Depends(change_batch)` and call `record_update(row, before)` for every
  changed row.
- They set a label (§8.4), `await batch.commit()`, and set `response.headers[CHANGE_BATCH_HEADER]` only
  when the batch recorded rows (the allocation routes' pattern, `api/portfolio.py:706`).
- `tests/test_changelog_pin.py` LOGGED gains `reorder_accounts` and `reorder_categories`.

**Transactions.** `TransactionOrderOut` is:

```
transactions: list[TransactionOut]          # the visible rows, new order
changed_positions: list[PositionChangeOut]
PositionChangeOut: security_id, ticker, account,
    shares_before, shares_after, cost_basis_before, cost_basis_after,
    realized_gl_before, realized_gl_after, warnings_added: list[str]
```

- It folds the whole ledger before and after with `fold_transactions` and lists every position (security,
  account label) whose quantized shares (6 dp), cost basis or realized gain (2 dp) differ, or whose
  warning set gained a line.
- The list is ordered by (ticker, account).
- Money is 2-dp strings; shares are 6-dp strings.
- **Owner scope** follows `_owner_filter` exactly. Every holding is either wholly visible or wholly hidden
  in a scope (a position is keyed by an account label that one owner — or joint — holds), so reordering
  the visible rows among their own slots never splits a holding.

**Route placement.** The new `PUT …/order` paths collide with no existing route (none of these routers
has a `PUT /{id}`). Each is declared before the `/{id}` routes anyway, so a later `PUT /{id}` can't
shadow it.

### 3.3 Appending instead of 0

- `AccountCreate.sort_order`, `CategoryCreate.sort_order`, `RewardCategoryCreate.sort_order` and
  `CreditCardIn.sort_order` become `int | None = None`, with the same bounds when given.
- On create, `None` means **append**: `coalesce(max(sort_order), −1) + 1` over the table.
- On the card PATCH (full replace), `None` means **keep the stored value**.
- **Account PATCH:** when `group` changes and the body has no `sort_order`, the account is appended
  (`max + 1`), so it lands at the end of its new group. This is recorded in the same batch.
- Explicit numbers are still accepted everywhere: scripts, importer and tests keep working. The UIs stop
  sending them.

### 3.4 The importer stops owning order — `backend/app/importer/apply.py`

- **Accounts and categories:** `sort_order` is set **at create only**. Update diffs compare `{name,
  group}` / `{name}`.
- **Creating from the sheet:** new rows append after the current maximum, in sheet order. An empty
  database therefore gets the sheet order exactly, and a re-import never moves an existing row.
- **Transactions** are matched by the new `import_key`, not by `sort_index`.
  - The sheet key stays `rnum × 10` (the parser is untouched; its field is treated as the sheet key).
  - Creates set `import_key = sheet key` and `sort_index = max(sort_index) + 10·(k+1)` in sheet order.
    New sheet rows land at the end of the ledger, where UI rows land; the user drags them into place.
  - Updates never touch `sort_index`.
  - Sync-delete compares `import_key`s.
  - Report samples keep printing `position_transactions[<sheet key>]`.
- **Row identity survives rows shifting in the sheet.** (Amended 2026-09-23 at lane R1's review.) A
  Positions row inserted or deleted mid-sheet shifts every key below it. Matching by key alone would
  pour one trade's fields into another trade's row, and that row keeps its user-owned position. So
  the matching is:
  1. **Content first.** An existing import row with an identical trade (security, account, type,
     date, shares, price, fees, split factor) is the same row. It keeps its id, fields and position;
     only its key is updated.
  2. **Same-key edits.** A remaining row with the same key AND the same security, account and type is
     a sheet edit of that trade: its fields are updated in place and its position is kept.
  3. **Everything else.** Every other parsed row is created (appended). Every other existing import
     row is deleted.

  Keys are cleared before reassignment, so the partial unique index never sees a transient
  collision.
- **Serialized writes.** (Amended 2026-09-23 at lane R1's review.) Every reorder route, every append
  path of the same list (the creates, an account's group-change append, the UI transaction create,
  the importer's creates), and the Activity card's Undo of an accounts/categories batch, takes a
  per-list transaction-scoped advisory lock first (fixed list order; Undo takes it before
  `lock_review_inputs`). Concurrent
  reorders therefore serialize: the later request wins whole, and its change batch records fresh
  before-images. Without the lock, two overlapping reorders merged row by row into an order neither
  asked for.
- **Tests:** existing importer tests that pinned `sort_order == column index` or keying by `sort_index`
  are updated to the new rules. New tests:
  - a moved sheet row survives a re-import with no duplicate and no delete;
  - a new sheet row appends;
  - custom account/category orders survive a re-import;
  - an empty database gets the sheet order.

### 3.5 Migration `f12026092301` — `position_transactions.import_key`

- **Add** `import_key INTEGER NULL`.
- **Backfill:** `UPDATE position_transactions SET import_key = sort_index WHERE source = 'import'`.
- **Index:** a partial unique index `ux_position_txn_import_key` on `(import_key) WHERE source = 'import'`.
  It is declared in the model's `__table_args__` too, because tests build the schema with `create_all`
  (the `ux_dividend_auto_event` precedent).
- **Downgrade** drops the index and the column.
- **Parent** `f12026091203` (the head on main). The in-flight batch adds no migration.
- `import_key` is not added to `TransactionOut`; it is importer identity, not a UI field.
- **Rollout consequence:** snapshots taken before the deploy are no longer restorable. `restorable`
  requires the snapshot's `alembic_head` to equal the server's, which is the existing rule for every
  migration. The rollout notes say to take a snapshot right after deploying.

### 3.6 The client side of the contract (R1)

R1 also writes the browser's half of the contract, so the UI lanes import it rather than each adding
their own.
- **Wire types** in `src/types/api.ts`, added beside each list's existing types (never appended at the
  end of the file, where parallel lanes would collide): `PositionChange` and `TransactionOrderOut`.
- **Functions:**

  | Function | File | Returns |
  |---|---|---|
  | `reorderAccounts(ids)` | `src/api/netWorth.ts` | `{ data: AccountOut[]; batchId: string \| null }` via `apiWithHeaders` |
  | `reorderCategories(ids)` | `src/api/spending.ts` | `{ data: CategoryOut[]; batchId: string \| null }` via `apiWithHeaders` |
  | `reorderTransactions(ids, owner)` | `src/api/portfolio.ts` | `TransactionOrderOut` (the owner query uses the file's existing `ownerQuery` helper) |
  | `reorderCreditCards(ids)` | `src/api/creditCards.ts` | `CreditCardOut[]` |
  | `reorderRewardCategories(ids)` | `src/api/creditCards.ts` | `RewardCategoryOut[]` |

- All five use `PUT` with body `{ ids }`. Their paths fall under existing `MUTATION_FAMILIES` prefixes,
  so the cache invalidation is inherited, not added.
- Each function gets a unit test for method, path, body and (where relevant) the batch header.

### 3.7 Acceptance (R1)

- **Unit tests** for every helper, including `moved_ids` on single, block and adjacent-swap moves.
- **Per endpoint:**
  - happy path;
  - no-op;
  - 409 on a missing or extra id;
  - 422 on a duplicate;
  - the response order equals a follow-up GET's order;
  - only changed rows are written.
- **Logged routes:**
  - the batch rows and label;
  - `undo_batch` restores the exact previous values;
  - a later logged edit of a touched row makes undo refuse with the overlap sentence.
- **Transactions:**
  - an owner-scoped reorder keeps hidden rows in their slots;
  - a cross-holding move reports no changes;
  - a sell moved above its buy reports the changed realized gain/cost basis and the new warning;
  - a split moved relative to a buy reports the share change;
  - the whole ledger ends evenly spaced.
- **Appending:** create without `sort_order` appends; account group change appends; card PATCH without
  `sort_order` keeps it.
- **Importer** (§3.4) and the **migration** (upgrade/downgrade on a scratch database; backfill; the index
  refuses a duplicate import key).
- The pin test passes.

---

## 4. Settings — categories and accounts (lane R2)

### 4.1 Spending categories (`CategoriesCard.tsx`)

- **The form** keeps only **Category name**. The Sort order box is removed and create sends no
  `sort_order`, so it appends.
- **The table:**
  - A new first column holds the grip (header cell empty, `aria-hidden`).
  - The **Sort** column is removed.
  - The table is `.reorder-table`.
  - Retired rows stay where they are and are draggable.
- **Reordering:**
  - Drop → optimistic order (the adjust-during-render `pendingOrder` pattern of
    `CategoriesPanel.tsx:81-97`, no effect) → `PUT /spending/categories/order`.
  - **Success:** the rows are replaced from the response, `markSaved`, and
    `toast.success("Moved {name}", { action: Undo })`.
  - **Undo:** `undoBatch(id)` → reload → `toast.info("Order restored")`. A refused undo shows
    `toast.error(server sentence)`.
  - **Failure:** revert to the last server order and `toast.error` (§8.3). It rides the toast layer, not
    the form banner (AccountsCard's rule for table-row errors). On 409 the card also reloads.
- **Busy:** grips are disabled while any request of the card is in flight (the card's `busy`).
- **Copy:** a new note line under the table (§8.1), and the InfoHint mentions dragging.

### 4.2 Accounts (`AccountsCard.tsx`)

- **The form** loses the Sort order box. Create sends no `sort_order`.
- **The table is grouped.**
  - It shows one `<tbody>` per non-empty group, in `GROUP_ORDER`, each opening with a heading row
    labelled with `GROUP_LABELS`: `<tr class="accounts-group-row"><th scope="rowgroup" colspan=…>`.
    (Corrected 2026-09-23 at lane R2's review: `scope="colgroup"` without a `<colgroup>` is invalid,
    and screen readers read it as a header over every column.)
  - Inside a group, rows are in API order, with components nested under their parent by `nestComponents`
    **applied per group** (a component whose parent sits in another group stays top-level in its own
    group).
  - The **Group** column is removed; the heading carries it.
  - The columns are: grip · Account · Owner · Roll-up · Status · actions.
  - Component rows keep their `component-row` indent, moved to the Account cell. Because the grip is
    now first, the global `td:first-child` indent is overridden in `.accounts-table`.
- **Drag rules:**
  - A top-level account moves within its group, carrying its nested components.
  - A component moves among its siblings.
  - Changing an account's group stays in Edit (the server appends it to the new group, §3.3).
- **Saving:**
  - The new display order is flattened: group by group, each parent followed by its components.
  - It is sent whole (every account, retired included) to `PUT /net-worth/accounts/order`.
  - The toast, Undo and failure behaviour are exactly as in §4.1.
- **Copy:** a note line (§8.1), and the InfoHint mentions dragging and carried components.
- The Portfolio accounts sub-table is unchanged.

### 4.3 Acceptance (R2)

- **Component tests for both cards:**
  - the Sort order box and column are gone;
  - create sends no `sort_order`;
  - the keyboard reorder produces one PUT with the full id list;
  - optimistic order, then server order;
  - the Undo toast calls `undoBatch` and reloads;
  - failure reverts;
  - 409 reloads;
  - grips are disabled while busy.
- **Accounts only:**
  - group headings, with empty groups omitted;
  - components nested and indented in the Account cell;
  - a parent's move carries its components in the PUT;
  - a component moves only among siblings;
  - a single-account group has a disabled grip.
- The cards call R1's `reorderAccounts` / `reorderCategories` (§3.6); they add no `src/api` code of
  their own.

---

## 5. Portfolio › Manage › Transactions (lane R3)

- **The panel** gets a new `owner` prop (the page's current owner scope), passed through from
  `PortfolioPage.tsx` in one additive line.
- **The table:**
  - A grip column comes first.
  - The table carries `.reorder-table`.
  - Items are the visible rows in list order, one range.
- **Drop:**
  - Optimistic order (`pendingOrder`, retired when fresh props arrive), then
    `PUT /portfolio/transactions/order?owner=…` with the visible ids.
  - **Success:** `onChanged()` (the page reloads holdings, realized, etc.), `markSaved`, and a toast
    (§8.1) that names the moved row. It also reports either "no holding's figures changed" or the first
    changed figure of the **moved row's own holding** (the first listed position if the moved row's
    holding is not among them), plus a count of any others.
  - **Undo:** the previous visible order is re-sent with the same PUT → `onChanged()` →
    `toast.info("Order restored")`.
  - **Failure and 409:** as §4.1. On 409 the panel calls `onChanged()` to reload.
- **Hint:** the panel's hint paragraph gains the sentence in §8.1 saying the list order is the replay
  order.
- **Busy:** grips follow the panel's `busy`. A drag is cancelled (by the hook) if the scope changes the
  rows under it.

**Acceptance.**
- Panel tests:
  - one PUT with the visible ids and the owner;
  - optimistic render;
  - the toast for both response shapes (no change / changed figures, including the "and N more" tail);
  - Undo re-sends the previous order;
  - failure reverts;
  - 409 reloads.
- Page test: the owner prop reaches the panel.

---

## 6. Overview › Customize (lane R4)

- Each fieldset (Summary tiles, Deeper views) shows **the visible items in their stored order**. Each row
  has a grip, a checkbox (checked) and the label.
- The **hidden items** follow under a quiet "Hidden" divider, in default order, with unchecked boxes.
  - Checking one appends it to the visible order.
  - Unchecking a visible one moves it to hidden.
- The ↑/↓ buttons and the position number are removed.
- The last-visible-tile rule is kept (its checkbox is disabled).
- Two `useReorder` instances, one per fieldset; `onCommit` calls `onChange({ ...value, [group]: next })`.
- Changes apply at once, as today. There is no toast: it's a layout preference with Reset to defaults.
- Escape during a drag cancels only the drag; the popover stays open (§2.3). Escape when nothing is
  lifted still closes it.
- **Acceptance:**
  - `OverviewPage.test.tsx`'s customize tests are updated: rows render in stored order;
    Space/↓/Space moves a tile and the layout pref changes; hide/show; the tile-minimum rule.
  - A new test: Escape while lifted leaves the popover open.

---

## 7. Credit Cards (lane R5 — starts after the in-flight batch's B2 lane is on main)

`src/components/creditcards/**` and `src/pages/CreditCardsPage.tsx` are owned by the in-flight
quick-fixes batch's lane B2. R5 branches only after B2 has merged to local main.

- **Card list (`CardsPanel.tsx`):**
  - A grip column comes first; the table carries `.reorder-table`.
  - Items are all cards (active and inactive) in API order.
  - Drop → optimistic → `PUT /credit-cards/order` → `onChanged()` → `markSaved` →
    `toast.success("Moved {card}", Undo)`. Undo re-sends the previous order; that endpoint isn't logged.
  - A new card is created without `sort_order`, so it appends.
  - Edit keeps sending the stored `sort_order` (full replace).
  - The rewards-matrix columns follow the new order by construction.
- **Stable colours (`creditLineChartOptions.ts` + the one call site in `CreditCardsPage.tsx`):**
  - The colour slot is the card's rank **by id** among all the cards the page knows (not its array
    position, and not only the cards drawn), so neither a reorder nor a person scope repaints a card.
    (Amended 2026-09-23 while planning lane R5.)
  - Series, legend and tooltip order follow the user's order.
  - The 8-slot cap and `OTHER_SERIES_COLOR` rule is unchanged, applied to the id rank.
- **Categories & weights (`CategoriesPanel.tsx`):**
  - The native HTML5 handlers, `dragArmed`, `dragIndex`/`overIndex`, the per-row PATCH chain and the
    `.drag-handle` / `.drag-over` / `tr.is-dragging` rules in `categories.css` are replaced by the shared
    component.
  - A drop is one `PUT /credit-cards/categories/order`, with a toast and a client Undo (re-send the
    previous order).
  - The keyboard model becomes lift-and-drop (§2.4).
  - The existing test (`CreditCardsPage.test.tsx:525-559`) is rewritten to: Space → ↓ → Space → one PUT
    with the full order; a second move before the refetch diffs against the optimistic order.
- **Acceptance:**
  - card-list PUT, toast and Undo;
  - new card without `sort_order`;
  - chart option test: same colour per card after a reorder, series order follows the list;
  - the Categories & weights rewrite;
  - no `draggable` attribute left in `src/components/creditcards/`.

---

## 8. Copy

### 8.1 Visible strings

| Where | Text |
|---|---|
| Categories note (under the table) | The Monthly update lists categories in this order — a spreadsheet column pasted there fills them in this order too. |
| Accounts note (under the table) | The Monthly update lists accounts in this order within each person and group — a spreadsheet column pasted there fills them in this order too. |
| Categories InfoHint (append) | Drag a row by its grip to change the order the app lists categories in. |
| Accounts InfoHint (append) | Drag a row by its grip to reorder accounts within their group; a parent brings its components with it. |
| Transactions hint (append to the existing paragraph) | The list is the order trades are replayed to work out cost basis and gains — with no dates on the rows, it is the ledger's timeline. Drag a row to move a trade earlier or later. |
| Toast — categories, accounts, cards, reward categories | Moved {name} · [Undo] |
| Toast — transactions, no figure changed | Moved the {TICKER} {type}. No holding's figures changed. · [Undo] |
| Toast — transactions, figures changed | Moved the {TICKER} {type}. {TICKER} at {account}: {figure} {before} → {after}.{ and N more holdings changed.} · [Undo] — `{figure}` is the first of *realized gain*, *cost basis*, *shares* that changed; if the position gained a warning and nothing else changed: "{TICKER} at {account} now warns: {warning}." |
| Toast — Undo done | Order restored |
| Toast — save failed (non-409) | Couldn't save the new order — {reason}. The list is back to how it was. |
| Overview Customize divider | Hidden |

### 8.2 Announcements (live region) and instructions

| Moment | Text |
|---|---|
| Instructions (hidden, `aria-describedby`) | Press Space or Enter to pick up. Use the arrow keys to move, Home or End to jump, Space or Enter to drop, Escape to cancel. |
| Lift | Picked up {name}. Position {i} of {n}{ in {range}}. |
| Move | {name}, position {i} of {n}. |
| Drop, moved | Dropped {name} at position {i} of {n}. |
| Drop, unmoved | Dropped {name} where it was. |
| Cancel | Cancelled. {name} is back at position {i} of {n}. |
| Cancel, the list changed under a live lift | Cancelled — the list changed. |

`{range}` is the group label ("Cash") for accounts, "{parent}'s components" for components, and absent
elsewhere. Positions count within the range.

### 8.3 Server sentences (409 stale)

| Route | Detail |
|---|---|
| accounts | The accounts changed since this list was loaded — nothing was moved. |
| categories | The spending categories changed since this list was loaded — nothing was moved. |
| transactions | The transactions changed since this list was loaded — nothing was moved. |
| cards | The cards changed since this list was loaded — nothing was moved. |
| reward categories | The reward categories changed since this list was loaded — nothing was moved. |

The client shows the detail in `toast.error` and reloads the list, so the reader is already looking at
the current rows.

### 8.4 Activity labels (logged routes)

| Case | Label |
|---|---|
| One account moved (alone, or a parent with exactly its components) | Moved account {name} |
| Otherwise | Reordered {n} accounts |
| One category moved | Moved category {name} |
| Otherwise | Reordered {n} categories |

`{n}` is the size of the minimal moved set (§3.1), not the number of rows renumbered. The first reorder
normalizes every stored value, so the batch can hold more rows than moved.

---

## 9. Edge cases (all must hold)

- **Lists with nothing to move.**
  - A one-row list, or a group with one account, has a disabled grip.
  - An empty list shows no grips.
- **Retired and inactive rows** keep their positions and are draggable. The PUT always sends every row
  the endpoint requires.
- **Two tabs:** a list whose rows were **added or removed** elsewhere gets a 409 → toast → reload.
  A **pure reorder** made in another tab is not detected: the saves are serialized per list, and
  the later one wins whole (single-user app; no version token). Nothing is half-applied, because
  each save is one transaction. (Clarified 2026-09-23 after lane R3's browser check.)
- **An Undo must never leave a stale optimistic layer.** A reload that returns rows identical to
  the screen may not re-render (the snapshot cache skips equal data). So an Undo's own server
  answer becomes the displayed order, and a layer is tagged with what it belongs to (e.g. the
  owner scope). Otherwise the next drag could save an order the reader no longer sees.
- **A second drop before the first save returns** can't happen: grips are disabled while the list's save
  is in flight. The optimistic rows carry the new order, so the next drag diffs against it (the
  `CategoriesPanel` lesson, `:213-216`).
- **Undo after a later reorder:**
  - Logged lists: the server refuses with the overlap sentence ("Later changes touched these rows — undo
    those first"), shown in `toast.error`.
  - Client-Undo lists re-send the order captured at that drop. If the list changed since, the 409 path
    applies.
- **Cancelled drags:** data landing mid-drag, a scope switch, a resize, window blur or Escape each
  cancel with no request.
- **Popover Escape** (Overview) cancels the drag only. **Detail-panel Escape** likewise.
- **Transactions:**
  - owner scope, household or person, reorders only the visible rows among their slots;
  - a fully hidden holding's rows never move relative to each other;
  - figures are reported for every changed position, not only visible ones — none can change outside the
    visible set, by the scope argument in §3.2.
- **Import after reorder:**
  - custom orders survive;
  - moved sheet rows keep their identity;
  - new sheet rows append.
- **Accounts:**
  - a component whose parent is retired stays nested (the parent is still listed in Settings);
  - a component whose parent is in another group is top-level in its own group;
  - a group change via Edit appends to the new group.
- **Browsers:** Edge/Chrome at 1280/1600/1920, both themes. Touch is not a target, though pointer events
  make it work.

---

## 10. Verification

**Per lane**, in its worktree:
- TDD for every behaviour above.
- **Backend:** the full suite with `FINANCE_TEST_DB=finance_test_reorder_<lane>` (never the shared test
  database), plus `ruff`.
- **Frontend:** the full `vitest` suite, `tsc -b`, `eslint`, `vite build`.
- **Browser checks** run the lane's own backend (port 8091–8096, `SCHEDULER_ENABLED=0`) against
  `finance_reorder_scratch` and vite (5191–5196, `VITE_API_PROXY`), in both themes at 1280 and 1600.
- Commit in small, well-described commits.

**Review:** an independent reviewer per lane checks spec compliance and code quality. Every finding is
fixed or explicitly answered, and re-reviewed until clean.

**V (verification lane):** `tools/probes/reorder-v/smoke.mjs` (playwright-core + Edge, the
`sandbox-v` pattern) plus a README row. It writes **only** to `finance_reorder_scratch`, rebuilt from
`finance_realdata` before each theme. For each of the six surfaces, in both themes, it checks:
- **a real mouse drag:**
  - the lifted row follows the pointer;
  - peers shift;
  - the row lands where the gap was;
  - the order survives a reload;
  - the toast appears and Undo restores the previous order;
- **the keyboard path:** Space, ↓ ×2, Space;
- **auto-scroll** inside the 420 px Settings scroller (drag the last account of a long group to its top)
  and on the page (the transactions ledger at 1280 × 800);
- **reduced-motion emulation:** a drop line and no transform on peers;
- **the resting table look** under `.reorder-table` matches `border-collapse: collapse` within a
  pixel-diff tolerance, with hairlines travelling with a lifted row;
- **Overview Customize:** Escape mid-drag keeps the popover open;
- a clean console and CLS < 0.1 on each page.

**Final** (on the integration branch after merging main): full gates, the V probe, alembic
upgrade → downgrade → upgrade on a scratch database.

---

## 11. Lanes, ownership and sequencing (the in-flight batch)

The quick-fixes batch (`docs/superpowers/specs/2026-09-23-quick-fixes-speed-and-chart-cleanup-design.md`)
is running in five worktrees and merging into **local main** in the order P → B1 → B2 → CS → CT. This
batch therefore:
- never commits to main and never touches main's working tree (its dev servers serve from it);
- works on **`feat/reorder-base`** (from main @7c70bc3) as its integration branch;
- keeps lanes in `.worktrees/reorder-<lane>`.

| Lane | Branch | Owns | Starts from |
|---|---|---|---|
| **R0** component | `feat/reorder-component` | `src/components/reorder/**`, `src/testing/pointer.ts` | `feat/reorder-base` |
| **R1** backend + client contract | `feat/reorder-backend` | `backend/app/services/ordering.py`, the five routes + schemas, `models/portfolio.py`, `importer/apply.py`, the migration, their tests, `tests/test_changelog_pin.py`; **and the client side of the contract**: the five reorder functions in `src/api/{netWorth,spending,portfolio,creditCards}.ts` (+ their tests) and the wire types in `src/types/api.ts` (additive, each beside its list's existing types) | `feat/reorder-base` |
| **R2** settings | `feat/reorder-settings` | `AccountsCard.tsx`, `CategoriesCard.tsx` (+ tests), `settings.css` (additive) | base after R0 + R1 merged |
| **R3** transactions | `feat/reorder-transactions` | `TransactionsPanel.tsx` (+ test), `portfolio.css` (additive), one prop line in `PortfolioPage.tsx` | base after R0 + R1 merged |
| **R4** overview | `feat/reorder-overview` | `OverviewCustomize.tsx`, its CSS, the customize tests in `OverviewPage.test.tsx` | base after R0 merged |
| **R5** credit cards | `feat/reorder-cards` | `CardsPanel.tsx`, `CategoriesPanel.tsx`, `categories.css`, `creditLineChartOptions.ts` (+ tests), the call site in `CreditCardsPage.tsx`, the reorder tests in `CreditCardsPage.test.tsx` | base after R0 + R1 merged **and** main (with B2) merged into base |
| **V** verify | `feat/reorder-verify` | `tools/probes/reorder-v/**`, the probes README row, the V plan's results | base with R0–R5 merged |

**Shared files:**
- `src/types/api.ts` and `src/api/*.ts` are R1's (§3.6); the UI lanes only import from them.
- `src/components/panels.css` is not edited: the table border model lives in `reorder.css`.

**Merge order into `feat/reorder-base`:** R1 → R0 → R2 → R3 → R4 → (merge main, once B2 is on it) → R5
→ V. The gates re-run after each merge.

**Landing:**
- Only after the quick-fixes batch has **completely** landed (all five lanes merged, its verification
  done, its worktrees gone):
  1. merge main into `feat/reorder-base`;
  2. rerun the full gates and the V probe;
  3. fast-forward local main.
- It stops at **local main**: no push, no deploy.
- **Hand-over:** push; on prod `git pull` + the README 4.1 rebuild of both images (the backend runs the
  migration at boot); then take a snapshot at once (§3.5).

---

## 12. Not in scope

- Reordering groups themselves (`GROUP_ORDER` is the net-worth chart's stack order).
- Cross-list moves (e.g. dragging an account into another group — use Edit).
- Multi-select drags.
- Touch-specific affordances.
- Recurring card credits, RSU grants, allocation-target rows, the sidebar nav.
- Dates on transactions: the replay order stays the only chronology.
- A change-log for the portfolio and credit-card routers: their CRUD stays unlogged, and their reorders
  use client-side Undo.
