# Lane R3 — Portfolio › Manage › Transactions: drag to change the replay order (2026-09-23) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (one
> implementer for this lane in its own worktree, TDD per task, then a spec-compliance review and a
> code-quality review, then merge into `feat/reorder-base` — never main, never pushed). Steps use
> `- [ ]` checkboxes.

**Spec:** `docs/superpowers/specs/2026-09-23-drag-to-reorder-design.md` — this lane implements **§5
(Portfolio › Manage › Transactions)**, the transactions rows of **§8.1**, the transactions sentence
of **§8.3**, the transactions items of **§9**, and its share of **§10–§11**. Read §0 (items 5, 6,
10, 11), §2.2–§2.5, §5, §8 and §9 before Task 1; the spec is authoritative where this plan is
silent. The user chose **"Change the replay order"**: the ledger's list order IS the cost-basis
fold order (`fold_transactions` folds in `(sort_index, id)` order; the rows carry no dates), so a
drag re-times a trade.

**Goal:** every row of the Transactions ledger wears a grip. A drop saves the visible order in one
PUT under the page's owner scope, shows at once, flashes the moved row, and raises a toast that
names what the move did to the book — nothing, or the first changed figure of the moved row's own
holding plus a count of the others — with an Undo that re-sends the previous order. A failed save
puts the rows back and says why; a stale list reloads.

**Architecture:**
- `TransactionsPanel.tsx` consumes lane R0's `useReorder` (one range; items = the visible rows in
  list order) and lane R1's `reorderTransactions(ids, owner)`.
- Two order layers sit over the page's `transactions` prop: `pendingOrder` (the dropped order,
  while its PUT is in flight) and `savedOrder` (the server's answer, until the page's next fetch —
  retired during render, the adjust-during-render pattern).
- The toast copy is two pure module functions (`movedMessage`, `changeSentence`) that only pick
  and format the server's figures.
- `PortfolioPage.tsx` passes its `owner` in one additive line. `portfolio.css` gains five additive
  rules for the ledger table: border model, grip column, and the pinned actions cell's lifted and
  drop-line states.

**Tech stack:** React 19 + TypeScript 5.9 strict, vitest 3 + @testing-library/react (jsdom; **no**
jest-dom matchers — assert with plain `getAttribute`/`textContent`/`toBe`), eslint 9 with
`eslint-plugin-react-hooks` 7.1.1 (React-Compiler rules), playwright-core + Edge for the browser
check.

---

## Controller amendments (2026-09-23, after lane R0's review — these override the tasks below)

**A1. Task 6 adds no CSS.** Lane R0's `src/components/reorder/reorder.css` (merged before this lane
starts) now owns everything Task 6 restated for `.port-table`:
- `table.reorder-table { border-collapse: separate; border-spacing: 0; }` — (0,1,1), beating
  `.port-table`'s `border-collapse: collapse` on specificity, whatever the chunk order;
- `.reorder-table .reorder-grip-cell` (width 2rem, `padding-right: 0`), which beats `.port-table td`;
- the lifted and drop-line states scoped under `.reorder-table`, including the sticky
  `td.row-actions` / `td.col-identity` variants that keep each pinned cell's own hairline.

So Task 6 appends nothing to `portfolio.css`. Keep its three tests (the counts later in this plan
stay the same), but make them read `path.join(__dirname, '../reorder/reorder.css')` into a
`reorderCss` string and pin that those rules exist there:
- `table.reorder-table` has `border-collapse: separate;` and `border-spacing: 0;`;
- `.reorder-table .reorder-grip-cell` has `padding-right: 0;`;
- `.reorder-table tr[data-reorder='lifted'] > td.row-actions` sets `background: var(--surface-2)` with
  the `-1px 0 0 var(--border)` hairline kept, and both `data-reorder-drop` variants exist for
  `td.row-actions`.

These pins pass at once. That is expected: they are a guard on a dependency, not TDD. Keep the
existing `css` (portfolio.css) reader in the same `describe`, because Task 9 Step 5's contingency
appends to it. The commit becomes `test(portfolio): pin the reorder.css rules the ledger relies on`.

**A2.** Notes for the controller items 1 and 2 are resolved by A1.

---

## Mechanics (read once)

- **Worktree:** `C:/Users/edyli/personal-finance-dashboard/.worktrees/reorder-r3`, branch
  `feat/reorder-transactions`, cut from `feat/reorder-base` AFTER lanes R0 and R1 are merged into
  it (spec §11: R1 → R0 → R2 → R3). Work ONLY inside it.
  - The controller creates it and symlinks `node_modules`
    (`ln -s /c/Users/edyli/personal-finance-dashboard/node_modules node_modules`).
  - This plan file is committed to `feat/reorder-base` by the controller before the lane is cut;
    the lane edits only its Results section.
- **Another Claude job** (the quick-fixes batch) is working in `.worktrees/{perf-first-four,
  backend-quick-fixes,frontend-quick-fixes,charts-spending-overview,charts-tax-portfolio}` and
  merging into main. Never touch main, the main checkout or those worktrees. Its lane CT edits
  `src/pages/PortfolioPage.tsx` (the performance chart), so this lane's edit there is ONE
  additive prop line inside the `<TransactionsPanel …>` element.
- **Tests:**
  - Per task, from the worktree root: `npx vitest run src/components/portfolio/TransactionsPanel.test.tsx`
    (Task 7 adds `src/pages/PortfolioPage.test.tsx`).
  - At the end (Task 8): the full `npx vitest run`. Never pipe a gate through `tail`/`head`; read
    the exit code.
- **Types and lint** before every commit: `npx tsc -b` and `npx eslint <the files the task touched>`.
  - `eslint-plugin-react-hooks` v7 runs the React-Compiler rules (`react-hooks/refs`,
    `react-hooks/immutability`, `react-hooks/set-state-in-effect`, `react-hooks/set-state-in-render`,
    …). The code below is written to pass them: no `ref.current` read during render, no `setState`
    in an effect body, no reassignment of outer variables during render.
  - Checked on 2026-09-23 with a probe against this repo's plugin (7.1.1): a save closure declared
    **before** `useReorder(...)` that reads `reorder.markSaved(...)` inside a promise callback is
    accepted (the compiler hoists the `const`); what the compiler rejects is an EFFECT callback
    naming a later `const`. This plan uses the accepted shape.
  - If a rule still fires, fix the code — never add an `eslint-disable`.
- **Gates at the end (Task 8):** `npx vitest run`, `npx tsc -b`, `npx eslint .`, `npm run build`.
- **Browser check (Task 9):** the lane's own servers against the PRIVATE database
  `finance_reorder_r3` — never `finance_realdata` (shared, read-only) and never `finance`.
  - `$PY` = `C:/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe`.
  - Backend: cwd `<worktree>/backend`, env
    `DATABASE_URL=postgresql+asyncpg://finance:finance@localhost:5433/finance_reorder_r3 SCHEDULER_ENABLED=0`,
    `$PY -m uvicorn app.main:app --host 127.0.0.1 --port 8093`.
  - Vite: cwd `<worktree>`, `VITE_API_PROXY=http://127.0.0.1:8093 npx vite --port 5193 --strictPort`.
  - Login `admin@example.com` / `changeme123`.
- **Commits:** small and conventional (`feat(portfolio): …`, `style(portfolio): …`,
  `docs(plan): …`). Never push; never delete files, branches or databases.
- **Scope fence** — this lane edits exactly:
  - `src/components/portfolio/TransactionsPanel.tsx`;
  - `src/components/portfolio/TransactionsPanel.test.tsx`;
  - `src/components/portfolio/portfolio.css` (rules appended at the end);
  - ONE additive prop line in `src/pages/PortfolioPage.tsx`;
  - `src/pages/PortfolioPage.test.tsx` (one mock-factory line, one imported name, one test);
  - this plan's Results section.

  The browser script lives in the gitignored `scratchpad/reorder-r3/` and is never committed.
  Nothing in `src/components/reorder/**` (R0), `src/api/**` or `src/types/api.ts` (R1), or
  `src/components/panels.css`. `HoldingDetailPanel.tsx` needs no change: it filters the page's
  `transactions` in server order, so it follows the new order when the page reloads.

**House rules this plan encodes:**
1. Money math lives on the server. The toast shows the server's before/after strings, formatted
   with `formatCurrency`/`formatShares`. It only COMPARES them to pick which figure to name — R1
   quantizes, and never sends a negative zero (R1 decision 9).
2. Copy is verbatim from spec §8.1/§8.3, except where "Decisions" below records a reading.
3. Both themes; desktop widths (1280, 1600).
4. Motion is lane R0's: this lane never sets a transform or transition. Row states are R0's
   `data-reorder*` attributes; `.is-dragging` is never used.
5. Every failure of a reorder rides the toast layer, never the form's `FeedBanner` (spec §4.1:
   "It rides the toast layer, not the form banner").

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
1. Render every item once, `{...reorder.itemProps(id)}` on its row, in `items` order.
2. Never set `style.transform`/`style.transition` on those rows; never use `.is-dragging`.
3. `onCommit` sets the optimistic order **synchronously** (it runs inside `flushSync`), then
   saves; `markSaved(moved)` on success; restore the last server order on failure.
4. `disabled: busy`; while disabled the grips are `aria-disabled="true"`, focusable but inert.
5. Disable the row's own action buttons while `reorder.active`.
6. `ReorderInstructions` / `ReorderLiveRegion` render outside the `<table>`.

Behaviour this lane relies on (R0 Task 5/6): a keyboard drop puts focus back on the moved grip; a
drop where it started commits nothing; the lift is cancelled with no commit when `items` change
under it (a refetch, a scope switch), when `disabled` flips, and on Escape, window blur or resize;
a range of one has a `disabled` grip.

### From lane R1 — `docs/superpowers/plans/2026-09-23-reorder-r1-backend.md`, "Contracts this lane publishes" (verbatim, the parts this lane uses)

| Method + path | Query | Rows `ids` must match | Renumber | 200 body | Header | Logged | 409 `detail` |
|---|---|---|---|---|---|---|---|
| `PUT /api/v1/portfolio/transactions/order` | `owner` (optional; the grammar and 422s of `GET /portfolio/transactions`) | exactly the rows `GET /portfolio/transactions?owner=` returns | the visible rows fill the slots the visible rows hold, hidden rows stay; then `sort_index = 10, 20, …` over the whole ledger | `TransactionOrderOut` | none | no | `The transactions changed since this list was loaded — nothing was moved.` |

Checks in order: an id repeated in `ids` → **422** `ids lists {id} more than once`; `set(ids)`
differs from the scope's rows → **409** with the sentence above, nothing written; an unchanged
order → 200, nothing written.

```ts
// src/types/api.ts (right after TransactionUpdate)
export interface PositionChange {
  security_id: number
  ticker: string
  account: string
  shares_before: string
  shares_after: string
  cost_basis_before: string
  cost_basis_after: string
  realized_gl_before: string
  realized_gl_after: string
  warnings_added: string[]
}

export interface TransactionOrderOut {
  transactions: TransactionOut[]
  changed_positions: PositionChange[]
}

// src/api/portfolio.ts — OwnerScope is `number | 'joint' | null`, the type fetchTransactions takes
export function reorderTransactions(ids: number[], owner: OwnerScope): Promise<TransactionOrderOut>
```

- `transactions`: the visible rows, in the new order, `sort_index` already renumbered.
- `account` is the portfolio-account label (the position key). Shares are 6-dp strings; cost
  basis and realized gain are 2-dp strings; a quantized zero is never negative.
- A position is listed when its quantized shares, cost basis or realized gain differ between the
  two folds, or when its warnings gained a line; `warnings_added` holds exactly the new lines
  (e.g. `txn 41: sell with no held shares`). `[]` when nothing re-folded. Ordered by
  `(ticker, account)`.
- `owner` is REQUIRED (R1 decision 15); `null` sends no `owner` param at all.
- Failures surface as `ApiError` (`src/api/client.ts`) with the server's sentence as `message`
  and the HTTP status as `status`; a network failure is status 0. `errorDetail(err)` turns one
  into the house's reason phrase.

---

## Decisions this plan takes where the spec is silent

1. **The row's name** (the grip's `Reorder {name}` and the live region's name) is
   `{TICKER} {type}, {account}`, e.g. **"Reorder NVDA buy, Schwab ESPP"**; a split reads
   "NVDA split, …". Two lots of one holding share a name, and the position the live region speaks
   next to it tells them apart.
2. **Two order layers, not one.** The spec says "`pendingOrder`, retired when fresh props arrive".
   This lane keeps that — as `savedOrder` — and adds a layer for the PUT in flight:
   - `pendingOrder` holds the dropped order from the drop until the PUT answers, and is cleared
     either way when it does.
   - `savedOrder` holds the server's answer until the page's next fetch replaces `transactions`
     (retired during render).

   Why: the page's reload after a save lands 100–400 ms later, and a keyboard user can drop again
   inside that window (§9 allows it: "the next drag diffs against" the optimistic rows). With one
   layer, that landing reload would flash the second drop's row back until the second reload.
   A failed save falls back to `savedOrder`, the newest confirmed order ("The list is back to how
   it was").
3. **Undo is not optimistic.** It raises `busy` (inert grips, shut row buttons), re-sends the
   previous visible order with the drop's scope, calls `onChanged()` and says "Order restored";
   the page's reload shows the restored rows. The toast lives 6 s — long enough to outlive a
   scope switch — and an optimistic restore would paint the old scope's rows over the new one.
4. **Undo failure copy:**
   - 409 → the server's sentence, and a reload (§8.3's rule).
   - Anything else → **"Couldn't restore the order — {reason}."** (the house
     "Couldn't {verb} {noun} — {reason}" grammar).
5. **The tail:** " And 1 more holding changed." / " And N more holdings changed." — a capital A
   after the full stop, and the singular for one. The spec's `{ and N more holdings changed.}`
   braces mark an optional tail; its lowercase "and" after a full stop is read as a typo.
6. **Which figure:** the first of realized gain → cost basis → shares whose before/after STRINGS
   differ; otherwise the first added warning. A listed holding with neither (unreachable by
   contract) reads "{TICKER} at {account} changed.".
7. **"The moved row's own holding"** matches on `security_id` AND the account label — the fold's
   position key — not on ticker alone. Otherwise the first listed position is named.
8. **`clause()`**: a server sentence used inside one of ours (the failure reason, a warning) loses
   its trailing full stop, so the result ends with exactly one.
9. **Focus through a failed save.** The revert re-orders rows, and React can move the focused
   grip's own `<tr>` — reverting an upward move does. Moving an ancestor of the focused element
   blurs it in Chrome. So the revert runs in `flushSync` and hands focus back.
10. **A reorder leaves the entry form alone**, including the carry-forward cue ("Security,
    account and date kept …"), which stays true.
11. **`portfolio.css`:**
    - `.port-table.reorder-table` restates the border model at a higher specificity.
      `.port-table`'s `border-collapse: collapse` and reorder.css's `.reorder-table` tie at one
      class, and which one lands last depends on the production CSS chunk order.
    - `.port-table .reorder-grip-cell` zeroes the right padding that R0 intends
      (`.port-table td`'s padding outranks R0's rule).
    - panels.css's pinned `.port-table td.row-actions` outranks reorder.css's lifted and
      drop-line rules, so they are restated for that cell, keeping its left hairline.
12. **Empty ledger:** no instructions, no live region, no grips — they render with the table. One
    row: a disabled grip (R0).
13. **Private database name:** `finance_reorder_r3` (the controller's per-lane copy). Spec §10
    names `finance_reorder_scratch`.

---

## File map

| File | Change |
|---|---|
| `src/components/portfolio/TransactionsPanel.tsx` | `owner` prop; grip column; `.reorder-table`; instructions + live region; hint sentence; `pendingOrder`/`savedOrder`; `saveOrder` / `restoreOrder` / `dropPendingOrder`; toast copy helpers (`rowName`, `clause`, `changeSentence`, `movedMessage`) |
| `src/components/portfolio/TransactionsPanel.test.tsx` | mock factory gains `reorderTransactions`; reorder fixtures + helpers; six new `describe` blocks (grip column, saving, toast copy, Undo, failures, CSS pins) |
| `src/components/portfolio/portfolio.css` | five rules appended (border model, grip cell, pinned actions cell × 3 states) |
| `src/pages/PortfolioPage.tsx` | `owner={owner}` on `<TransactionsPanel>` (one line) |
| `src/pages/PortfolioPage.test.tsx` | `reorderTransactions` in the mock factory and the import; one test in the shell-scope `describe` |
| `scratchpad/reorder-r3/drag.mjs` (gitignored, not committed) | the browser check |

---

### Task 0: preflight (no commit)

**Files:** none.

- [ ] **Step 1: The base carries R0 and R1**

Run (worktree root):

```bash
git log --oneline -12
ls src/components/reorder
grep -n "export function reorderTransactions" src/api/portfolio.ts
grep -n "export interface PositionChange\|export interface TransactionOrderOut" src/types/api.ts
grep -n "active: snap.liftedId !== null\|export function useReorder" src/components/reorder/useReorder.ts
```

Expected:
- The log shows the R1 and R0 merges on `feat/reorder-base`.
- `src/components/reorder` lists `DragHandle.tsx`, `ReorderStatus.tsx`, `reorderDom.ts`,
  `reorderMath.ts`, `reorderTypes.ts`, `useReorder.ts`, `reorder.css` and their tests.
- All three greps hit.

If anything is missing, stop and report — this lane cannot start.

- [ ] **Step 2: Baseline**

Run: `npx vitest run src/components/portfolio/TransactionsPanel.test.tsx src/pages/PortfolioPage.test.tsx`
Expected: PASS — 23 tests in `TransactionsPanel.test.tsx`, every `PortfolioPage.test.tsx` test.
Record the counts in Results.

---

### Task 1: the grip column, the replay-order hint, and a drop that shows at once

**Files:**
- Modify: `src/components/portfolio/TransactionsPanel.tsx` (imports; a helper after
  `newAccountNote`; the component body after `accountNote`; the hint paragraph; the ledger table)
- Test: `src/components/portfolio/TransactionsPanel.test.tsx` (head of the file; append the
  reorder fixtures, helpers and one `describe`)

- [ ] **Step 1: Write the failing tests**

In `src/components/portfolio/TransactionsPanel.test.tsx`, replace the head of the file:

```ts
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SecurityOut, TransactionOut } from '../../types/api'
import TransactionsPanel from './TransactionsPanel'
import ToastProvider from '../ToastProvider'

vi.mock('../../api/portfolio', () => ({
  createTransaction: vi.fn().mockResolvedValue({}),
  updateTransaction: vi.fn().mockResolvedValue({}),
  deleteTransaction: vi.fn().mockResolvedValue(undefined),
}))
import { createTransaction, updateTransaction } from '../../api/portfolio'
```

with:

```ts
import type { ComponentProps } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SecurityOut, TransactionOut } from '../../types/api'
import TransactionsPanel from './TransactionsPanel'
import ToastProvider from '../ToastProvider'

vi.mock('../../api/portfolio', () => ({
  createTransaction: vi.fn().mockResolvedValue({}),
  updateTransaction: vi.fn().mockResolvedValue({}),
  deleteTransaction: vi.fn().mockResolvedValue(undefined),
  // The replay-order PUT (lane R1). Every reorder test answers it or leaves it pending.
  reorderTransactions: vi.fn(),
}))
import { createTransaction, reorderTransactions, updateTransaction } from '../../api/portfolio'
```

Then append at the END of the file:

```tsx

// ── Drag to reorder (2026-09-23 drag-to-reorder spec §5) ──────────────────────────────────────
// The ledger's LIST ORDER is the cost-basis replay order, so a drag re-times a trade. Three rows
// over two holdings: NVDA · Schwab ESPP holds a buy and a sell, VOO · RH Joint Taxable one buy.

const LEDGER_SECURITIES: SecurityOut[] = [
  securities[0],
  {
    ...securities[0],
    id: 2,
    ticker: 'VOO',
    name: 'Vanguard S&P 500 ETF',
    industry: 'Index',
    holding_type: 'etf',
  },
]

const nvdaBuy: TransactionOut = {
  id: 21, security_id: 1, account: 'Schwab ESPP', type: 'buy', txn_date: null,
  shares: '10.000000', price: '100.0000', fees: null, split_factor: null,
  sort_index: 10, source: 'import', notes: null,
}
const vooBuy: TransactionOut = {
  ...nvdaBuy, id: 22, security_id: 2, account: 'RH Joint Taxable',
  shares: '5.000000', price: '400.0000', sort_index: 20,
}
const nvdaSell: TransactionOut = {
  ...nvdaBuy, id: 23, type: 'sell', shares: '4.000000', price: '150.0000', sort_index: 30,
  source: 'ui',
}
const LEDGER = [nvdaBuy, vooBuy, nvdaSell]

// The grips' names (spec §2.4 "Reorder {name}"): ticker, type, account.
const NVDA_BUY = 'NVDA buy, Schwab ESPP'
const VOO_BUY = 'VOO buy, RH Joint Taxable'
const NVDA_SELL = 'NVDA sell, Schwab ESPP'

type PanelProps = ComponentProps<typeof TransactionsPanel>

/** The ledger inside a ToastProvider; `rerender` hands down fresh props the way the page's
 *  reload does. */
function renderLedger(props: Partial<PanelProps> = {}) {
  const onChanged = vi.fn()
  const view = (next: Partial<PanelProps>) => (
    <ToastProvider>
      <TransactionsPanel
        securities={LEDGER_SECURITIES}
        transactions={LEDGER}
        onChanged={onChanged}
        {...props}
        {...next}
      />
    </ToastProvider>
  )
  const utils = render(view({}))
  return { onChanged, rerender: (next: Partial<PanelProps>) => utils.rerender(view(next)) }
}

const grip = (name: string) => screen.getByRole('button', { name: `Reorder ${name}` })
/** The ledger's row ids, top to bottom, as rendered. */
const order = () =>
  [...document.querySelectorAll('tbody tr')].map((row) => row.getAttribute('data-reorder-id'))
/** The reorder live region — ToastProvider's assertive region is not visually hidden. */
const live = () =>
  document.querySelector('.visually-hidden[aria-live="assertive"]')?.textContent ?? ''

/** Every reorder test starts from a PUT that never answers (a test that needs an answer sets
 *  one) and from a jsdom that can "scroll": the keyboard path keeps the lifted row in view with
 *  window.scrollBy, which jsdom only logs as unimplemented. */
function reorderHooks(): void {
  beforeEach(() => {
    vi.mocked(reorderTransactions).mockReset()
    vi.mocked(reorderTransactions).mockReturnValue(new Promise<never>(() => {}))
    vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })
}

describe('TransactionsPanel reorder — the grip column (spec §5)', () => {
  reorderHooks()

  it('puts a grip first in every row, named for the trade, on a reorderable table', () => {
    renderLedger()
    const table = screen.getByRole('table')
    expect(table.className).toBe('port-table reorder-table')
    const headGrip = table.querySelector('thead tr')?.firstElementChild
    expect(headGrip?.className).toBe('reorder-grip-cell')
    expect(headGrip?.getAttribute('aria-hidden')).toBe('true')
    for (const row of table.querySelectorAll('tbody tr')) {
      expect(row.firstElementChild?.className).toBe('reorder-grip-cell')
    }
    expect(
      [...table.querySelectorAll('tbody .reorder-grip')].map((button) =>
        button.getAttribute('aria-label'),
      ),
    ).toEqual([`Reorder ${NVDA_BUY}`, `Reorder ${VOO_BUY}`, `Reorder ${NVDA_SELL}`])
    // One description and one live region for the list, both OUTSIDE the table — a <span> is
    // not a valid child of one (lane R0 consumer rule 6).
    const instructions = document.getElementById(
      grip(NVDA_BUY).getAttribute('aria-describedby') ?? '',
    )
    expect(instructions?.textContent).toBe(
      'Press Space or Enter to pick up. Use the arrow keys to move, Home or End to jump, Space or Enter to drop, Escape to cancel.',
    )
    expect(table.contains(instructions)).toBe(false)
    const regions = document.querySelectorAll('.visually-hidden[aria-live="assertive"]')
    expect(regions).toHaveLength(1)
    expect(table.contains(regions[0])).toBe(false)
  })

  it('says the list is the replay order, and how to change it (spec §8.1)', () => {
    renderLedger()
    expect(screen.getByText(/The list is the order trades are replayed/).textContent).toContain(
      "The list is the order trades are replayed to work out cost basis and gains — with no dates on the rows, it is the ledger's timeline. Drag a row to move a trade earlier or later.",
    )
  })

  it('offers no grip on an empty ledger and a disabled one on a single row (spec §9)', () => {
    const { rerender } = renderLedger({ transactions: [] })
    expect(screen.queryByRole('button', { name: /^Reorder / })).toBeNull()
    expect(document.querySelector('.visually-hidden[aria-live="assertive"]')).toBeNull()
    rerender({ transactions: [nvdaBuy] })
    expect((grip(NVDA_BUY) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows a drop at once and speaks each step', () => {
    renderLedger()
    grip(NVDA_BUY).focus()
    fireEvent.keyDown(grip(NVDA_BUY), { key: ' ' })
    expect(live()).toBe(`Picked up ${NVDA_BUY}. Position 1 of 3.`)
    fireEvent.keyDown(grip(NVDA_BUY), { key: 'ArrowDown' })
    expect(live()).toBe(`${NVDA_BUY}, position 2 of 3.`)
    fireEvent.keyDown(grip(NVDA_BUY), { key: ' ' })
    expect(order()).toEqual(['22', '21', '23'])
    expect(live()).toBe(`Dropped ${NVDA_BUY} at position 2 of 3.`)
    expect(document.activeElement).toBe(grip(NVDA_BUY))
  })

  it('cancels a lift when the rows under it change — a scope switch — and saves nothing', () => {
    const { rerender } = renderLedger()
    grip(NVDA_BUY).focus()
    fireEvent.keyDown(grip(NVDA_BUY), { key: ' ' })
    fireEvent.keyDown(grip(NVDA_BUY), { key: 'ArrowDown' })
    // The page hands down another scope's rows under the live lift.
    rerender({ transactions: [nvdaBuy, nvdaSell] })
    expect(grip(NVDA_BUY).getAttribute('aria-pressed')).toBeNull()
    expect(order()).toEqual(['21', '23'])
    expect(reorderTransactions).not.toHaveBeenCalled()
  })

  it('shuts the row buttons while a row is lifted', () => {
    renderLedger()
    const rowButtons = () =>
      [
        ...screen.getAllByRole('button', { name: 'Edit' }),
        ...screen.getAllByRole('button', { name: /^(Duplicate|Delete) this / }),
      ] as HTMLButtonElement[]
    grip(VOO_BUY).focus()
    fireEvent.keyDown(grip(VOO_BUY), { key: ' ' })
    expect(rowButtons().every((button) => button.disabled)).toBe(true)
    fireEvent.keyDown(grip(VOO_BUY), { key: 'Escape' })
    expect(rowButtons().every((button) => !button.disabled)).toBe(true)
    expect(reorderTransactions).not.toHaveBeenCalled()
  })

  it('keeps the grips focusable but inert while any request of the panel is in flight', () => {
    // A create that never settles: busy stays up for the rest of the test.
    vi.mocked(createTransaction).mockReturnValueOnce(new Promise<never>(() => {}))
    renderLedger()
    change(screen.getByLabelText(/security/i), '2')
    change(screen.getByLabelText('Account'), 'RH Joint Taxable')
    change(screen.getByLabelText(/shares/i), '1')
    change(screen.getByLabelText(/price/i), '400')
    fireEvent.click(screen.getByRole('button', { name: /add transaction/i }))
    const handle = grip(VOO_BUY) as HTMLButtonElement
    expect(handle.getAttribute('aria-disabled')).toBe('true')
    expect(handle.disabled).toBe(false)
    handle.focus()
    fireEvent.keyDown(handle, { key: ' ' })
    expect(live()).toBe('')
    expect(handle.getAttribute('aria-pressed')).toBeNull()
  })
})
```

(`securities` and `change` are the file's existing fixture and helper.)

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/components/portfolio/TransactionsPanel.test.tsx`
Expected: the 23 existing tests PASS; the 7 new ones FAIL — e.g.
`expected 'port-table' to be 'port-table reorder-table'` and
`Unable to find an accessible element with the role "button" and name "Reorder NVDA buy, Schwab ESPP"`.

- [ ] **Step 3: Implement**

In `src/components/portfolio/TransactionsPanel.tsx`:

**3a — imports.** Replace:

```ts
import InfoHint from '../InfoHint'
import { useToast } from '../ToastProvider'
```

with:

```ts
import InfoHint from '../InfoHint'
import DragHandle from '../reorder/DragHandle'
import { ReorderInstructions, ReorderLiveRegion } from '../reorder/ReorderStatus'
import { useReorder } from '../reorder/useReorder'
import { useToast } from '../ToastProvider'
```

**3b — the row's name.** Insert directly after the closing `}` of `newAccountNote` (and before
`export default function TransactionsPanel(`):

```ts

/** A ledger row's name for its grip and the live region (2026-09-23 drag-to-reorder spec §2.4):
 *  ticker, type and account — "NVDA buy, Schwab ESPP". Two lots of one holding share a name; the
 *  position the live region speaks after it tells them apart. */
function rowName(txn: TransactionOut, ticker: string): string {
  return `${ticker} ${txn.type}, ${txn.account}`
}
```

**3c — the order and the hook.** Insert directly after
`  const accountNote = newAccountNote(form.account, accounts, primaryName)`:

```ts
  const tickerOf = (txn: TransactionOut) => tickers.get(txn.security_id) ?? '?'

  // Drag to reorder (2026-09-23 drag-to-reorder spec §5). The LIST ORDER is the cost-basis
  // replay order — the rows carry no dates, so their order is the ledger's timeline and a drag
  // re-times a trade. pendingOrder is the dropped order, shown the moment the grip lets go and
  // retired when fresh rows arrive from the page (CategoriesPanel's adjust-during-render
  // pattern — no effect, so react-hooks/set-state-in-effect stays clean).
  const [pendingOrder, setPendingOrder] = useState<TransactionOut[] | null>(null)
  const [lastTransactions, setLastTransactions] = useState(transactions)
  if (lastTransactions !== transactions) {
    setLastTransactions(transactions)
    setPendingOrder(null)
  }
  const rows = pendingOrder ?? transactions
  const rowById = new Map(rows.map((txn) => [txn.id, txn]))

  // Synchronously: the hook calls onCommit inside flushSync, so the new DOM order and the
  // cleared drag transforms land in one frame (lane R0 consumer rule 3).
  const showOrder = (next: number[]) => {
    setPendingOrder(
      next.flatMap((id) => {
        const txn = rowById.get(id)
        return txn === undefined ? [] : [txn]
      }),
    )
  }

  const reorder = useReorder({
    items: rows.map((txn) => ({ id: txn.id })),
    labelOf: (id) => {
      const txn = rowById.get(id)
      return txn === undefined ? 'this transaction' : rowName(txn, tickerOf(txn))
    },
    // Any request of the panel in flight leaves the grips focusable but inert (lane R0 consumer
    // rule 4), so a drop can never race a save.
    disabled: busy,
    onCommit: showOrder,
  })
```

**3d — the hint.** Replace:

```tsx
      <p className="hint">
        Rows marked <span className="badge">sheet</span> are owned by the spreadsheet
        importer: a re-import reverts edits to them and resurrects deletions. Rows added
        here are never touched by imports.
      </p>
```

with:

```tsx
      <p className="hint">
        Rows marked <span className="badge">sheet</span> are owned by the spreadsheet
        importer: a re-import reverts edits to them and resurrects deletions. Rows added
        here are never touched by imports. The list is the order trades are replayed to work
        out cost basis and gains — with no dates on the rows, it is the ledger's timeline.
        Drag a row to move a trade earlier or later.
      </p>
```

**3e — the ledger.** Replace the whole ledger block — from `      {transactions.length === 0 ? (`
down to the `      )}` that closes it, just above `    </section>` — with:

```tsx
      {rows.length === 0 ? (
        <p className="empty-note">No transactions yet.</p>
      ) : (
        <>
          {/* Once per list and outside the table — a <span> is not a valid child of one (lane R0
              consumer rule 6). Every grip points its aria-describedby at the instructions. */}
          <ReorderInstructions id={reorder.instructionsId} />
          <ReorderLiveRegion text={reorder.announcement} />
          <HoldingsScroll><table className="port-table reorder-table">
            <thead>
              <tr>
                <th className="reorder-grip-cell" aria-hidden="true" />
                <th>Ticker</th><th>Account</th><th>Type</th><th>Date</th>
                <th className="num">Shares</th><th className="num">Price</th>
                <th className="num">Fees</th><th>Source</th><th>Notes</th><th />
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} {...reorder.itemProps(t.id)}>
                  <td className="reorder-grip-cell">
                    <DragHandle name={rowName(t, tickerOf(t))} {...reorder.handleProps(t.id)} />
                  </td>
                  <td>{tickerOf(t)}</td>
                  <td>{t.account}</td>
                  <td>{t.type === 'split' ? `split ×${t.split_factor ?? '?'}` : t.type}</td>
                  <td>{t.txn_date ? formatDate(t.txn_date) : '—'}</td>
                  <td className="num">{t.type === 'split' ? '—' : formatShares(t.shares)}</td>
                  <td className="num">{t.type === 'split' ? '—' : formatCurrency(t.price)}</td>
                  <td className="num">{formatCurrency(t.fees)}</td>
                  <td>
                    <span className="badge">{t.source === 'import' ? 'sheet' : 'manual'}</span>
                  </td>
                  <td className="notes-cell">{t.notes ?? ''}</td>
                  {/* disabled={busy} on all three: submit()'s .then closes over editingId and
                      the form as they were when it fired, so a row action taken mid-flight is
                      undone by the reset that lands after it — a seeded edit silently wiped,
                      or worse, a PATCH aimed at whatever editingId the closure still holds.
                      Shutting the row for the duration of a save is the cheap fix. Shut while a
                      row is lifted too (lane R0 consumer rule 5): a click mid-drag would act on
                      a row that is about to move. */}
                  <td className="row-actions">
                    <button type="button" disabled={busy || reorder.active} onClick={() => startEdit(t)}>Edit</button>
                    {/* aria-label: "Duplicate"/"Delete" alone never say WHAT they act on, and
                        the type is the row's shortest distinguishing word. Delete needs the
                        naming MORE since the delete went instant (2026-08-25 polish §8): the
                        confirm() sentence that used to name the row before anything happened
                        is gone, so the button is the last chance to say it. Edit keeps its
                        bare name — it opens a form showing the row, and changes nothing. */}
                    <button
                      type="button"
                      disabled={busy || reorder.active}
                      aria-label={`Duplicate this ${t.type}`}
                      onClick={() => duplicate(t)}
                    >
                      Duplicate
                    </button>
                    <button
                      type="button"
                      disabled={busy || reorder.active}
                      aria-label={`Delete this ${t.type}`}
                      onClick={() => remove(t)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></HoldingsScroll>
        </>
      )}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/components/portfolio/TransactionsPanel.test.tsx`
Expected: PASS — 30 tests (23 existing + 7 new).

- [ ] **Step 5: Type-check, lint, commit**

```bash
npx tsc -b && npx eslint src/components/portfolio/TransactionsPanel.tsx src/components/portfolio/TransactionsPanel.test.tsx
git add src/components/portfolio/TransactionsPanel.tsx src/components/portfolio/TransactionsPanel.test.tsx
git commit -m "feat(portfolio): a grip on every ledger row — the list order is the replay order, and a drop shows at once"
```

---

### Task 2: one PUT per drop, in the page's scope — then the server's order until the page reloads

**Files:**
- Modify: `src/components/portfolio/TransactionsPanel.tsx` (imports; `movedMessage` after
  `rowName`; the `owner` prop; the reorder block from Task 1)
- Test: `src/components/portfolio/TransactionsPanel.test.tsx` (type import; append helpers and
  one `describe`)

- [ ] **Step 1: Write the failing tests**

In `src/components/portfolio/TransactionsPanel.test.tsx`, replace:

```ts
import type { SecurityOut, TransactionOut } from '../../types/api'
```

with:

```ts
import type {
  PositionChange,
  SecurityOut,
  TransactionOrderOut,
  TransactionOut,
} from '../../types/api'
```

Append at the END of the file:

```tsx

/** The keyboard path (spec §2.4): focus the grip, Space lifts, `key` moves one place, Space
 *  drops. */
function keyboardMove(name: string, key: 'ArrowUp' | 'ArrowDown'): void {
  grip(name).focus()
  fireEvent.keyDown(grip(name), { key: ' ' })
  fireEvent.keyDown(grip(name), { key })
  fireEvent.keyDown(grip(name), { key: ' ' })
}

const tableRow = (id: number) =>
  document.querySelector(`tbody tr[data-reorder-id="${id}"]`) as HTMLElement

/** The server's answer to a reorder: the rows it was sent, in that order, and `changes`. */
function answerWith(changes: PositionChange[] = []): void {
  const byId = new Map(LEDGER.map((txn) => [txn.id, txn]))
  vi.mocked(reorderTransactions).mockImplementation(async (ids) => ({
    transactions: ids.flatMap((id) => {
      const txn = byId.get(id)
      return txn === undefined ? [] : [txn]
    }),
    changed_positions: changes,
  }))
}

// Spec §8.1: "Moved the {TICKER} {type}. No holding's figures changed."
const QUIET_VOO = "Moved the VOO buy. No holding's figures changed."
const QUIET_NVDA = "Moved the NVDA buy. No holding's figures changed."

describe('TransactionsPanel reorder — saving the replay order (spec §5)', () => {
  reorderHooks()

  it('saves one drop as one PUT of the visible ids, in the page scope', () => {
    renderLedger({ owner: 2 })
    keyboardMove(NVDA_BUY, 'ArrowDown')
    expect(reorderTransactions).toHaveBeenCalledTimes(1)
    expect(reorderTransactions).toHaveBeenCalledWith([22, 21, 23], 2)
    // Unanswered: the dropped order is on screen already, and every grip stays inert until the
    // server answers — so a second drop cannot race the first (spec §9).
    expect(order()).toEqual(['22', '21', '23'])
    expect(grip(VOO_BUY).getAttribute('aria-disabled')).toBe('true')
    expect(document.activeElement).toBe(grip(NVDA_BUY))
  })

  it('reports a move that changed no figures, flashes the moved row and has the page reload', async () => {
    answerWith()
    const { onChanged } = renderLedger()
    keyboardMove(VOO_BUY, 'ArrowUp')
    expect(await screen.findByText(QUIET_VOO)).toBeTruthy()
    // The household view sends null: the client turns it into no owner param at all.
    expect(reorderTransactions).toHaveBeenCalledWith([22, 21, 23], null)
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(tableRow(22).hasAttribute('data-reorder-saved')).toBe(true)
    await waitFor(() => expect(grip(VOO_BUY).getAttribute('aria-disabled')).toBeNull())
  })

  it("keeps the server's order up until the page's next fetch, then shows the page's rows", async () => {
    answerWith()
    const { rerender } = renderLedger()
    keyboardMove(NVDA_BUY, 'ArrowDown')
    await screen.findByText(QUIET_NVDA)
    await waitFor(() => expect(grip(VOO_BUY).getAttribute('aria-disabled')).toBeNull())
    expect(order()).toEqual(['22', '21', '23'])
    // The page's reload lands — here carrying an order saved elsewhere meanwhile.
    rerender({ transactions: [nvdaSell, vooBuy, nvdaBuy] })
    expect(order()).toEqual(['23', '22', '21'])
  })

  it('never lets a fetch that lands mid-save show over the dropped order', async () => {
    let answer: (value: TransactionOrderOut) => void = () => {}
    vi.mocked(reorderTransactions).mockReturnValueOnce(
      new Promise<TransactionOrderOut>((resolve) => {
        answer = resolve
      }),
    )
    const { rerender } = renderLedger()
    keyboardMove(NVDA_BUY, 'ArrowDown')
    // A reload that started before the save lands first: the old order, in a fresh array.
    rerender({ transactions: [nvdaBuy, vooBuy, nvdaSell] })
    expect(order()).toEqual(['22', '21', '23'])
    await act(async () => {
      answer({ transactions: [vooBuy, nvdaBuy, nvdaSell], changed_positions: [] })
    })
    expect(order()).toEqual(['22', '21', '23'])
    // The reload the save asked for.
    rerender({ transactions: [vooBuy, nvdaBuy, nvdaSell] })
    expect(order()).toEqual(['22', '21', '23'])
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/components/portfolio/TransactionsPanel.test.tsx`
Expected: the four new tests FAIL — `expected "spy" to be called 1 times, but got 0 times` (the
first) and `Unable to find an element with the text: Moved the VOO buy. No holding's figures
changed.` (the second); the mid-save test fails on `order()` after the first `rerender`
(`['21', '22', '23']`). The 30 earlier tests PASS.

- [ ] **Step 3: Implement**

In `src/components/portfolio/TransactionsPanel.tsx`:

**3a — imports.** Replace:

```ts
import {
  createTransaction,
  deleteTransaction,
  updateTransaction,
} from '../../api/portfolio'
```

with:

```ts
import {
  createTransaction,
  deleteTransaction,
  reorderTransactions,
  updateTransaction,
} from '../../api/portfolio'
import type { OwnerScope } from '../../api/portfolio'
```

and replace:

```ts
import type { SecurityOut, TransactionOut, TransactionType } from '../../types/api'
```

with:

```ts
import type { PositionChange, SecurityOut, TransactionOut, TransactionType } from '../../types/api'
```

**3b — the toast's first sentence.** Insert directly after the closing `}` of `rowName`:

```ts

/** The success toast (2026-09-23 drag-to-reorder spec §8.1). */
function movedMessage(
  txn: TransactionOut,
  ticker: string,
  changes: readonly PositionChange[],
): string {
  const head = `Moved the ${ticker} ${txn.type}.`
  return changes.length === 0 ? `${head} No holding's figures changed.` : head
}
```

**3c — the `owner` prop.** Replace:

```ts
  primaryName = null,
  onChanged,
}: {
```

with:

```ts
  primaryName = null,
  owner = null,
  onChanged,
}: {
```

and replace:

```ts
  primaryName?: string | null
  onChanged: () => void
}) {
```

with:

```ts
  primaryName?: string | null
  /** The page's owner scope — the value `fetchTransactions` was given for `transactions`
   *  (2026-09-23 drag-to-reorder spec §5). A reorder is saved in it: the server checks the ids
   *  against exactly the rows this scope lists and moves them among their own slots. Null is
   *  the whole household. */
  owner?: OwnerScope
  onChanged: () => void
}) {
```

**3d — the reorder block.** Replace everything Task 1 inserted — from
`  const tickerOf = (txn: TransactionOut) => tickers.get(txn.security_id) ?? '?'` down to and
including the `  })` that closes `useReorder({ … })` — with:

```ts
  const tickerOf = (txn: TransactionOut) => tickers.get(txn.security_id) ?? '?'

  // Drag to reorder (2026-09-23 drag-to-reorder spec §5). The LIST ORDER is the cost-basis
  // replay order — the rows carry no dates, so their order is the ledger's timeline and a drag
  // re-times a trade. Two layers sit over the page's rows, and only a reorder sets either:
  //   pendingOrder — the dropped order, from the moment the grip lets go until the PUT answers
  //                  (optimistic), cleared either way when it does;
  //   savedOrder   — the server's answer, until the page's next fetch replaces `transactions`
  //                  (retired during render — CategoriesPanel's adjust-during-render pattern,
  //                  no effect, so react-hooks/set-state-in-effect stays clean).
  // So a fetch that lands mid-save never flashes the row back to where it came from, and a
  // failed save falls back to the newest order the server confirmed.
  const [pendingOrder, setPendingOrder] = useState<TransactionOut[] | null>(null)
  const [savedOrder, setSavedOrder] = useState<TransactionOut[] | null>(null)
  const [lastTransactions, setLastTransactions] = useState(transactions)
  if (lastTransactions !== transactions) {
    setLastTransactions(transactions)
    setSavedOrder(null)
  }
  const rows = pendingOrder ?? savedOrder ?? transactions
  const rowById = new Map(rows.map((txn) => [txn.id, txn]))

  // One drop, one PUT (spec §5): the visible ids in their new order, in the page's scope. The
  // server re-times the whole ledger, folds it before and after, and answers with the rows and
  // every holding whose figures moved. `reorder` is read only when the PUT answers, long after
  // the render that declares it below has returned.
  const saveOrder = (next: number[], moved: number) => {
    const txn = rowById.get(moved)
    if (txn === undefined) return // the hook commits only ids it was handed
    // Synchronously: the hook calls onCommit inside flushSync, so the new DOM order and the
    // cleared drag transforms land in one frame (lane R0 consumer rule 3).
    setPendingOrder(
      next.flatMap((id) => {
        const row = rowById.get(id)
        return row === undefined ? [] : [row]
      }),
    )
    setBusy(true)
    reorderTransactions(next, owner)
      .then((result) => {
        setPendingOrder(null)
        setSavedOrder(result.transactions)
        // Holdings, realized gains and the tiles stand on this order: the page reloads them.
        onChanged()
        reorder.markSaved(moved)
        toast.success(movedMessage(txn, tickerOf(txn), result.changed_positions))
      })
      .catch(() => setPendingOrder(null))
      .finally(() => setBusy(false))
  }

  const reorder = useReorder({
    items: rows.map((txn) => ({ id: txn.id })),
    labelOf: (id) => {
      const txn = rowById.get(id)
      return txn === undefined ? 'this transaction' : rowName(txn, tickerOf(txn))
    },
    // Any request of the panel in flight — a save, a delete, a reorder — leaves the grips
    // focusable but inert (lane R0 consumer rule 4), so a second drop cannot race the first.
    disabled: busy,
    onCommit: saveOrder,
  })
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/components/portfolio/TransactionsPanel.test.tsx`
Expected: PASS — 34 tests.

- [ ] **Step 5: Type-check, lint, commit**

```bash
npx tsc -b && npx eslint src/components/portfolio/TransactionsPanel.tsx src/components/portfolio/TransactionsPanel.test.tsx
git add src/components/portfolio/TransactionsPanel.tsx src/components/portfolio/TransactionsPanel.test.tsx
git commit -m "feat(portfolio): one PUT per drop in the page's scope — optimistic, then the server's order until the page reloads"
```

---

### Task 3: the toast names what the move did to the book (spec §8.1)

**Files:**
- Modify: `src/components/portfolio/TransactionsPanel.tsx` (replace Task 2's `movedMessage`)
- Test: `src/components/portfolio/TransactionsPanel.test.tsx` (append fixtures and one `describe`)

- [ ] **Step 1: Write the failing tests**

Append at the END of `src/components/portfolio/TransactionsPanel.test.tsx`:

```tsx

/** A holding the server reports as changed — every figure equal unless a case says otherwise. */
function position(over: Partial<PositionChange> = {}): PositionChange {
  return {
    security_id: 1,
    ticker: 'NVDA',
    account: 'Schwab ESPP',
    shares_before: '6.000000',
    shares_after: '6.000000',
    cost_basis_before: '600.00',
    cost_basis_after: '600.00',
    realized_gl_before: '200.00',
    realized_gl_after: '200.00',
    warnings_added: [],
    ...over,
  }
}

const AAPL_JOINT = { security_id: 9, ticker: 'AAPL', account: 'RH Joint Taxable' }
const MSFT_JOINT = { security_id: 10, ticker: 'MSFT', account: 'RH Joint Taxable' }

interface ToastCase {
  what: string
  move: string
  key: 'ArrowUp' | 'ArrowDown'
  changes: PositionChange[]
  text: string
}

// Spec §8.1: "Moved the {TICKER} {type}. {TICKER} at {account}: {figure} {before} → {after}."
// plus " And N more holdings changed." — {figure} is the first of realized gain, cost basis and
// shares that changed; a position that only gained a warning says "{TICKER} at {account} now
// warns: {warning}." The figure named is the MOVED ROW'S OWN holding's (security AND account),
// or the first listed one when the moved row's holding did not change.
const TOAST_CASES: ToastCase[] = [
  {
    what: 'the realized gain first, when it moved',
    move: NVDA_SELL,
    key: 'ArrowUp',
    changes: [
      position({
        realized_gl_after: '600.00',
        cost_basis_after: '1000.00',
        warnings_added: ['txn 23: sell with no held shares'],
      }),
    ],
    text: 'Moved the NVDA sell. NVDA at Schwab ESPP: realized gain $200.00 → $600.00.',
  },
  {
    what: 'the cost basis when the realized gain held',
    move: NVDA_BUY,
    key: 'ArrowDown',
    changes: [position({ cost_basis_after: '1000.00' })],
    text: 'Moved the NVDA buy. NVDA at Schwab ESPP: cost basis $600.00 → $1,000.00.',
  },
  {
    what: 'the shares when only they moved',
    move: NVDA_BUY,
    key: 'ArrowDown',
    changes: [position({ shares_after: '60.000000' })],
    text: 'Moved the NVDA buy. NVDA at Schwab ESPP: shares 6 → 60.',
  },
  {
    what: 'a new warning when no figure moved',
    move: NVDA_SELL,
    key: 'ArrowUp',
    changes: [position({ warnings_added: ['txn 23: sell exceeds held shares'] })],
    text: 'Moved the NVDA sell. NVDA at Schwab ESPP now warns: txn 23: sell exceeds held shares.',
  },
  {
    what: 'a warning that brings its own full stop, with one stop only',
    move: NVDA_SELL,
    key: 'ArrowUp',
    changes: [position({ warnings_added: ['txn 23: sell with no held shares.'] })],
    text: 'Moved the NVDA sell. NVDA at Schwab ESPP now warns: txn 23: sell with no held shares.',
  },
  {
    what: 'a loss as the house formats it',
    move: NVDA_SELL,
    key: 'ArrowUp',
    changes: [position({ realized_gl_before: '-50.00', realized_gl_after: '10.00' })],
    text: 'Moved the NVDA sell. NVDA at Schwab ESPP: realized gain -$50.00 → $10.00.',
  },
  {
    what: "the moved row's own holding before an earlier-listed one, plus one more",
    move: NVDA_SELL,
    key: 'ArrowUp',
    changes: [
      position({ ...AAPL_JOINT, realized_gl_after: '75.00' }),
      position({ cost_basis_after: '1000.00' }),
    ],
    text: 'Moved the NVDA sell. NVDA at Schwab ESPP: cost basis $600.00 → $1,000.00. And 1 more holding changed.',
  },
  {
    what: 'the count of the others, in the plural',
    move: NVDA_SELL,
    key: 'ArrowUp',
    changes: [
      position({ ...AAPL_JOINT, realized_gl_after: '75.00' }),
      position({ ...MSFT_JOINT, shares_after: '7.000000' }),
      position({ realized_gl_after: '600.00' }),
    ],
    text: 'Moved the NVDA sell. NVDA at Schwab ESPP: realized gain $200.00 → $600.00. And 2 more holdings changed.',
  },
  {
    what: "the first listed holding when the moved row's own did not change",
    move: VOO_BUY,
    key: 'ArrowDown',
    changes: [position({ realized_gl_after: '600.00' })],
    text: 'Moved the VOO buy. NVDA at Schwab ESPP: realized gain $200.00 → $600.00.',
  },
  {
    what: 'the own holding by security AND account, not by ticker alone',
    move: NVDA_BUY,
    key: 'ArrowDown',
    changes: [
      position({ account: 'Schwab RSU', realized_gl_after: '1.00' }),
      position({ cost_basis_after: '1000.00' }),
    ],
    text: 'Moved the NVDA buy. NVDA at Schwab ESPP: cost basis $600.00 → $1,000.00. And 1 more holding changed.',
  },
  {
    what: 'a listed holding with nothing to name, plainly',
    move: NVDA_BUY,
    key: 'ArrowDown',
    changes: [position()],
    text: 'Moved the NVDA buy. NVDA at Schwab ESPP changed.',
  },
]

describe('TransactionsPanel reorder — what the toast says (spec §8.1)', () => {
  reorderHooks()

  it.each(TOAST_CASES)('names $what', async ({ move, key, changes, text }) => {
    answerWith(changes)
    renderLedger()
    keyboardMove(move, key)
    expect(await screen.findByText(text)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/components/portfolio/TransactionsPanel.test.tsx`
Expected: the 11 new cases FAIL with `Unable to find an element with the text: Moved the NVDA
sell. NVDA at Schwab ESPP: realized gain $200.00 → $600.00.` (and the like) — Task 2's
`movedMessage` stops after its first sentence when a holding changed. The 34 earlier tests PASS.

- [ ] **Step 3: Implement**

In `src/components/portfolio/TransactionsPanel.tsx`, replace Task 2's `movedMessage` — from
`/** The success toast (2026-09-23 drag-to-reorder spec §8.1). */` down to the function's closing
`}` — with:

```ts
/** A server sentence used inside one of ours: its closing stop goes, ours closes it. */
function clause(text: string): string {
  return text.replace(/[.\s]+$/, '')
}

/** One changed holding, in words (2026-09-23 drag-to-reorder spec §8.1): the FIRST of realized
 *  gain, cost basis and shares that moved — the server's figures, formatted the house way — or,
 *  when only a warning was added, that warning. The server quantizes both sides and never sends
 *  a negative zero, so comparing its strings is comparing its figures; nothing is recomputed. */
function changeSentence(change: PositionChange): string {
  const where = `${change.ticker} at ${change.account}`
  const figures = [
    {
      name: 'realized gain',
      before: change.realized_gl_before,
      after: change.realized_gl_after,
      format: formatCurrency,
    },
    {
      name: 'cost basis',
      before: change.cost_basis_before,
      after: change.cost_basis_after,
      format: formatCurrency,
    },
    { name: 'shares', before: change.shares_before, after: change.shares_after, format: formatShares },
  ]
  const figure = figures.find((candidate) => candidate.before !== candidate.after)
  if (figure !== undefined) {
    return `${where}: ${figure.name} ${figure.format(figure.before)} → ${figure.format(figure.after)}.`
  }
  if (change.warnings_added.length > 0) {
    return `${where} now warns: ${clause(change.warnings_added[0])}.`
  }
  // The contract lists a holding only when one of the above moved; said plainly if it ever
  // does not.
  return `${where} changed.`
}

/** The success toast (spec §8.1). The list order IS the replay order, so the toast says what
 *  the move did to the book: nothing, or the moved row's OWN holding (security and account —
 *  the fold's position key; the first listed holding when its own did not change), plus a count
 *  of the rest. */
function movedMessage(
  txn: TransactionOut,
  ticker: string,
  changes: readonly PositionChange[],
): string {
  const head = `Moved the ${ticker} ${txn.type}.`
  if (changes.length === 0) return `${head} No holding's figures changed.`
  const own =
    changes.find(
      (change) => change.security_id === txn.security_id && change.account === txn.account,
    ) ?? changes[0]
  const others = changes.length - 1
  const tail =
    others === 0 ? '' : ` And ${others} more ${others === 1 ? 'holding' : 'holdings'} changed.`
  return `${head} ${changeSentence(own)}${tail}`
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/components/portfolio/TransactionsPanel.test.tsx`
Expected: PASS — 45 tests.

- [ ] **Step 5: Type-check, lint, commit**

```bash
npx tsc -b && npx eslint src/components/portfolio/TransactionsPanel.tsx src/components/portfolio/TransactionsPanel.test.tsx
git add src/components/portfolio/TransactionsPanel.tsx src/components/portfolio/TransactionsPanel.test.tsx
git commit -m "feat(portfolio): the reorder toast names what the move did to the book"
```

---

### Task 4: Undo re-sends the order that stood before the drop (spec §5)

**Files:**
- Modify: `src/components/portfolio/TransactionsPanel.tsx` (client import; a new `restoreOrder`;
  `saveOrder` replaced)
- Test: `src/components/portfolio/TransactionsPanel.test.tsx` (an import; append one `describe`)

- [ ] **Step 1: Write the failing tests**

In `src/components/portfolio/TransactionsPanel.test.tsx`, replace:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
```

with:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
```

Append at the END of the file:

```tsx

// Spec §8.3 — the transactions route's stale sentence (lane R1's contract).
const STALE = 'The transactions changed since this list was loaded — nothing was moved.'

describe('TransactionsPanel reorder — Undo (spec §5)', () => {
  reorderHooks()

  it('re-sends the order that stood before the drop, in its scope, and the reload shows it', async () => {
    answerWith()
    const { onChanged, rerender } = renderLedger({ owner: 'joint' })
    keyboardMove(NVDA_BUY, 'ArrowDown')
    await screen.findByText(QUIET_NVDA)
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByText('Order restored')).toBeTruthy()
    expect(vi.mocked(reorderTransactions).mock.calls).toEqual([
      [[22, 21, 23], 'joint'],
      [[21, 22, 23], 'joint'],
    ])
    expect(onChanged).toHaveBeenCalledTimes(2)
    // The page's reload is what puts the rows back on screen.
    rerender({ transactions: [nvdaBuy, vooBuy, nvdaSell] })
    expect(order()).toEqual(['21', '22', '23'])
  })

  it.each([
    {
      status: 500,
      detail: 'Internal Server Error',
      text: "Couldn't restore the order — the server had a problem (HTTP 500).",
      reloads: 1,
    },
    { status: 409, detail: STALE, text: STALE, reloads: 2 },
  ])('says why an Undo was refused ($status), reloading a stale list', async ({ status, detail, text, reloads }) => {
    answerWith()
    const { onChanged } = renderLedger()
    keyboardMove(NVDA_BUY, 'ArrowDown')
    await screen.findByText(QUIET_NVDA)
    vi.mocked(reorderTransactions).mockRejectedValueOnce(new ApiError(detail, status))
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByText(text)).toBeTruthy()
    expect(onChanged).toHaveBeenCalledTimes(reloads)
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/components/portfolio/TransactionsPanel.test.tsx`
Expected: the three new tests FAIL with
`Unable to find an accessible element with the role "button" and name "Undo"`. The 45 earlier
tests PASS.

- [ ] **Step 3: Implement**

In `src/components/portfolio/TransactionsPanel.tsx`:

**3a — import.** Replace `import { ApiError } from '../../api/client'` with
`import { ApiError, errorDetail } from '../../api/client'`.

**3b — `restoreOrder`.** Insert directly above the comment line that starts
`  // One drop, one PUT (spec §5)`:

```ts
  // Undo re-sends the order that stood before the drop (spec §5): the endpoint is not
  // change-logged, so the client holds the previous order — and the scope it was made in. The
  // page's reload shows the result; a list that changed since answers 409 and the reload shows
  // what is there now.
  const restoreOrder = (ids: number[], scope: OwnerScope) => {
    setBusy(true)
    reorderTransactions(ids, scope)
      .then(() => {
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

```

**3c — `saveOrder`.** Replace the `saveOrder` function — from
`  const saveOrder = (next: number[], moved: number) => {` down to its closing `  }` — with:

```ts
  const saveOrder = (next: number[], moved: number) => {
    const txn = rowById.get(moved)
    if (txn === undefined) return // the hook commits only ids it was handed
    const previous = rows.map((row) => row.id)
    const scope = owner
    // Synchronously: the hook calls onCommit inside flushSync, so the new DOM order and the
    // cleared drag transforms land in one frame (lane R0 consumer rule 3).
    setPendingOrder(
      next.flatMap((id) => {
        const row = rowById.get(id)
        return row === undefined ? [] : [row]
      }),
    )
    setBusy(true)
    reorderTransactions(next, scope)
      .then((result) => {
        setPendingOrder(null)
        setSavedOrder(result.transactions)
        // Holdings, realized gains and the tiles stand on this order: the page reloads them.
        onChanged()
        reorder.markSaved(moved)
        toast.success(movedMessage(txn, tickerOf(txn), result.changed_positions), {
          action: { label: 'Undo', onAction: () => restoreOrder(previous, scope) },
        })
      })
      .catch(() => setPendingOrder(null))
      .finally(() => setBusy(false))
  }
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/components/portfolio/TransactionsPanel.test.tsx`
Expected: PASS — 48 tests.

- [ ] **Step 5: Type-check, lint, commit**

```bash
npx tsc -b && npx eslint src/components/portfolio/TransactionsPanel.tsx src/components/portfolio/TransactionsPanel.test.tsx
git add src/components/portfolio/TransactionsPanel.tsx src/components/portfolio/TransactionsPanel.test.tsx
git commit -m "feat(portfolio): Undo re-sends the order that stood before the drop"
```

---

### Task 5: a save that fails — rows back, focus kept, the reason said; a stale list reloads

**Files:**
- Modify: `src/components/portfolio/TransactionsPanel.tsx` (a `react-dom` import; a new
  `dropPendingOrder`; `saveOrder` replaced)
- Test: `src/components/portfolio/TransactionsPanel.test.tsx` (append one `describe`)

- [ ] **Step 1: Write the failing tests**

Append at the END of `src/components/portfolio/TransactionsPanel.test.tsx`:

```tsx

describe('TransactionsPanel reorder — a save that fails (spec §5, §8.1, §8.3)', () => {
  reorderHooks()

  it.each([
    {
      status: 500,
      detail: 'Internal Server Error',
      reason: 'the server had a problem (HTTP 500)',
    },
    // A sentence of the server's with its own stop: ours closes it, once.
    { status: 422, detail: 'ids lists 23 more than once.', reason: 'ids lists 23 more than once' },
  ])('puts the rows back, keeps the grip focused and says why ($status)', async ({ status, detail, reason }) => {
    vi.mocked(reorderTransactions).mockRejectedValueOnce(new ApiError(detail, status))
    const { onChanged } = renderLedger()
    keyboardMove(NVDA_SELL, 'ArrowUp')
    expect(
      await screen.findByText(
        `Couldn't save the new order — ${reason}. The list is back to how it was.`,
      ),
    ).toBeTruthy()
    expect(order()).toEqual(['21', '22', '23'])
    expect(document.activeElement).toBe(grip(NVDA_SELL))
    expect(onChanged).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it("shows a stale list's server sentence, puts the rows back and has the page reload (409)", async () => {
    vi.mocked(reorderTransactions).mockRejectedValueOnce(new ApiError(STALE, 409))
    const { onChanged } = renderLedger()
    keyboardMove(NVDA_BUY, 'ArrowDown')
    expect(await screen.findByText(STALE)).toBeTruthy()
    expect(order()).toEqual(['21', '22', '23'])
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/Couldn't save the new order/)).toBeNull()
  })

  it('falls back to the newest order the server confirmed, not to older page rows', async () => {
    answerWith()
    renderLedger()
    keyboardMove(NVDA_BUY, 'ArrowDown') // saved: 22, 21, 23 — the page has not reloaded yet
    await screen.findByText(QUIET_NVDA)
    await waitFor(() => expect(grip(VOO_BUY).getAttribute('aria-disabled')).toBeNull())
    vi.mocked(reorderTransactions).mockRejectedValueOnce(new ApiError('Internal Server Error', 500))
    keyboardMove(NVDA_SELL, 'ArrowUp')
    await screen.findByText(/^Couldn't save the new order/)
    expect(order()).toEqual(['22', '21', '23'])
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/components/portfolio/TransactionsPanel.test.tsx`
Expected: the four new tests FAIL with `Unable to find an element with the text: Couldn't save the
new order — …` / `…The transactions changed since this list was loaded — nothing was moved.` — the
Task 4 `catch` reverts silently. The 48 earlier tests PASS.

- [ ] **Step 3: Implement**

In `src/components/portfolio/TransactionsPanel.tsx`:

**3a — import.** Replace:

```ts
import { useState } from 'react'
```

with:

```ts
import { useState } from 'react'
import { flushSync } from 'react-dom'
```

**3b — `dropPendingOrder`.** Insert directly above the comment line that starts
`  // Undo re-sends the order that stood before the drop`:

```ts
  // A failed save puts the rows back (spec §5, as §4.1). Moving them can blur the grip a
  // keyboard drop left focus on — reverting an upward move moves that grip's own row — so focus
  // is handed back once the DOM has moved (flushSync: the move has happened by the next line).
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

```

**3c — `saveOrder`.** Replace the `saveOrder` function — from
`  const saveOrder = (next: number[], moved: number) => {` down to its closing `  }` — with:

```ts
  const saveOrder = (next: number[], moved: number) => {
    const txn = rowById.get(moved)
    if (txn === undefined) return // the hook commits only ids it was handed
    const previous = rows.map((row) => row.id)
    const scope = owner
    // Synchronously: the hook calls onCommit inside flushSync, so the new DOM order and the
    // cleared drag transforms land in one frame (lane R0 consumer rule 3).
    setPendingOrder(
      next.flatMap((id) => {
        const row = rowById.get(id)
        return row === undefined ? [] : [row]
      }),
    )
    setBusy(true)
    reorderTransactions(next, scope)
      .then((result) => {
        setPendingOrder(null)
        setSavedOrder(result.transactions)
        // Holdings, realized gains and the tiles stand on this order: the page reloads them.
        onChanged()
        reorder.markSaved(moved)
        toast.success(movedMessage(txn, tickerOf(txn), result.changed_positions), {
          action: { label: 'Undo', onAction: () => restoreOrder(previous, scope) },
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
        toast.error(
          `Couldn't save the new order — ${clause(errorDetail(err))}. The list is back to how it was.`,
        )
      })
      .finally(() => setBusy(false))
  }
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/components/portfolio/TransactionsPanel.test.tsx`
Expected: PASS — 52 tests.

- [ ] **Step 5: Type-check, lint, commit**

```bash
npx tsc -b && npx eslint src/components/portfolio/TransactionsPanel.tsx src/components/portfolio/TransactionsPanel.test.tsx
git add src/components/portfolio/TransactionsPanel.tsx src/components/portfolio/TransactionsPanel.test.tsx
git commit -m "feat(portfolio): a failed reorder puts the rows back, keeps the grip focused and says why; a stale list reloads"
```

---

### Task 6: the ledger's table under drag — borders, grip column, pinned actions cell

**Files:**
- Modify: `src/components/portfolio/portfolio.css` (append at the end)
- Test: `src/components/portfolio/TransactionsPanel.test.tsx` (two imports; append one `describe`)

- [ ] **Step 1: Write the failing tests**

In `src/components/portfolio/TransactionsPanel.test.tsx`, replace:

```ts
import type { ComponentProps } from 'react'
```

with:

```ts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { ComponentProps } from 'react'
```

Append at the END of the file:

```tsx

// ── portfolio.css — the reorderable ledger (spec §0.11, §2.5, §5) ─────────────────────────────
describe('portfolio.css — the reorderable ledger', () => {
  // Comments out, whitespace flattened (motionCss.test.ts's reader): a pin never breaks on a
  // re-indent or on a comment between rules.
  const css = readFileSync(path.join(__dirname, 'portfolio.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')

  it('gives the ledger separate borders whichever stylesheet lands last', () => {
    expect(css).toContain(
      '.port-table.reorder-table { border-collapse: separate; border-spacing: 0; }',
    )
  })

  it('keeps the grip column as narrow as its icon', () => {
    expect(css).toContain('.port-table .reorder-grip-cell { padding-right: 0; }')
  })

  it('lifts the pinned actions cell with its row and draws the drop line across it', () => {
    expect(css).toContain(
      ".port-table tr[data-reorder='lifted'] > td.row-actions { background: var(--surface-2); box-shadow: -1px 0 0 var(--border), inset 0 1px 0 var(--border), inset 0 -1px 0 var(--border); }",
    )
    expect(css).toContain(
      ".port-table tr[data-reorder-drop='before'] > td.row-actions { box-shadow: -1px 0 0 var(--border), inset 0 2px 0 var(--accent); }",
    )
    expect(css).toContain(
      ".port-table tr[data-reorder-drop='after'] > td.row-actions { box-shadow: -1px 0 0 var(--border), inset 0 -2px 0 var(--accent); }",
    )
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/components/portfolio/TransactionsPanel.test.tsx`
Expected: the three new tests FAIL with `expected '…' to contain '.port-table.reorder-table {
border-collapse: separate; border-spacing: 0; }'` (and the like). The 52 earlier tests PASS.

- [ ] **Step 3: Implement**

Append at the END of `src/components/portfolio/portfolio.css`:

```css

/* ── Drag to reorder: the Transactions ledger (2026-09-23 drag-to-reorder spec §5) ────────────
   reorder.css (lane R0) owns the grip and the row states; three things are this table's own.
   1. `.port-table` above sets border-collapse at the same specificity as reorder.css's
      `.reorder-table`, and which rule lands last depends on the production CSS chunk order — so
      the pair states the model here: every cell owns its hairline, and it travels with a lifted
      row (spec §0.11).
   2. `.port-table td`'s padding outranks reorder.css's narrow grip cell.
   3. panels.css pins the actions cell with its own surface and left hairline, and that rule
      outranks reorder.css's lifted and reduced-motion drop-line rules — restated here for the
      pinned cell, its left hairline kept. */
.port-table.reorder-table { border-collapse: separate; border-spacing: 0; }
.port-table .reorder-grip-cell { padding-right: 0; }
.port-table tr[data-reorder='lifted'] > td.row-actions {
  background: var(--surface-2);
  box-shadow: -1px 0 0 var(--border), inset 0 1px 0 var(--border), inset 0 -1px 0 var(--border);
}
.port-table tr[data-reorder-drop='before'] > td.row-actions {
  box-shadow: -1px 0 0 var(--border), inset 0 2px 0 var(--accent);
}
.port-table tr[data-reorder-drop='after'] > td.row-actions {
  box-shadow: -1px 0 0 var(--border), inset 0 -2px 0 var(--accent);
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/components/portfolio/TransactionsPanel.test.tsx src/components/motionCss.test.ts src/theme/motion.test.ts`
Expected: PASS — 55 tests in `TransactionsPanel.test.tsx`; the two motion suites unchanged
(the new rules carry no duration).

- [ ] **Step 5: Type-check, lint, commit**

```bash
npx tsc -b && npx eslint src/components/portfolio/TransactionsPanel.test.tsx
git add src/components/portfolio/portfolio.css src/components/portfolio/TransactionsPanel.test.tsx
git commit -m "style(portfolio): the reorderable ledger's borders, grip column and pinned actions cell"
```

---

### Task 7: the page hands the ledger its owner scope (one additive line)

**Files:**
- Modify: `src/pages/PortfolioPage.tsx` (one line inside `<TransactionsPanel …>`)
- Test: `src/pages/PortfolioPage.test.tsx` (one mock-factory line; one imported name; one test at
  the end of the `PortfolioPage — shell scope` describe)

- [ ] **Step 1: Write the failing test**

In `src/pages/PortfolioPage.test.tsx`:

(a) In the `vi.mock('../api/portfolio', …)` factory, replace:

```ts
  fetchTransactions: vi.fn(),
  updateSecurity: vi.fn(),
}))
```

with:

```ts
  fetchTransactions: vi.fn(),
  reorderTransactions: vi.fn(),
  updateSecurity: vi.fn(),
}))
```

(b) In the `import { … } from '../api/portfolio'` list below it, replace:

```ts
  fetchTransactions,
} from '../api/portfolio'
```

with:

```ts
  fetchTransactions,
  reorderTransactions,
} from '../api/portfolio'
```

(c) Inside `describe('PortfolioPage — shell scope', …)`, directly after the test
`'hands the ledger form the account roster and the primary’s name'`, replace its tail:

```tsx
    expect(
      screen.getByText(
        "New account 'Fidelity Roth' will be created and assigned to Me — re-tag it in Settings → Accounts",
      ),
    ).toBeTruthy()
  })
})
```

with:

```tsx
    expect(
      screen.getByText(
        "New account 'Fidelity Roth' will be created and assigned to Me — re-tag it in Settings → Accounts",
      ),
    ).toBeTruthy()
  })

  // 2026-09-23 drag-to-reorder spec §5: the ledger saves a reorder in the scope it shows — the
  // server checks the ids against exactly the rows that scope lists.
  it('hands the transactions ledger the page scope, and a reorder is saved in it', async () => {
    const second: TransactionOut = {
      ...TRANSACTIONS[0],
      id: 12,
      account: 'Joint Taxable',
      sort_index: 10,
    }
    vi.mocked(fetchTransactions).mockResolvedValue([TRANSACTIONS[0], second])
    vi.mocked(reorderTransactions).mockResolvedValue({
      transactions: [second, TRANSACTIONS[0]],
      changed_positions: [],
    })
    // jsdom has no window.scrollBy; the keyboard path keeps the lifted row in view with it.
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
    try {
      renderPage('/portfolio?section=manage&owner=2')
      const handle = await screen.findByRole('button', {
        name: 'Reorder VOO buy, Fidelity Brokerage',
      })
      const fetchesBefore = vi.mocked(fetchTransactions).mock.calls.length
      handle.focus()
      fireEvent.keyDown(handle, { key: ' ' })
      fireEvent.keyDown(handle, { key: 'ArrowDown' })
      fireEvent.keyDown(handle, { key: ' ' })
      await waitFor(() => expect(reorderTransactions).toHaveBeenCalledWith([12, 11], SAM.id))
      // …and the page reloads the ledger under the same scope.
      await waitFor(() =>
        expect(vi.mocked(fetchTransactions).mock.calls.length).toBeGreaterThan(fetchesBefore),
      )
      expect(fetchTransactions).toHaveBeenLastCalledWith(SAM.id)
    } finally {
      scrollBy.mockRestore()
    }
  })
})
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run src/pages/PortfolioPage.test.tsx`
Expected: the new test FAILS — `expected "spy" to be called with arguments: [ [ 12, 11 ], 2 ]`,
received `[ [ 12, 11 ], null ]` (the panel's `owner` defaults to null). Every other test PASSES.

- [ ] **Step 3: Implement**

In `src/pages/PortfolioPage.tsx`, replace:

```tsx
                    <TransactionsPanel
                      securities={securities}
                      transactions={transactions}
                      accounts={accountLabels}
                      primaryName={primaryName}
                      onChanged={reload}
                    />
```

with:

```tsx
                    <TransactionsPanel
                      securities={securities}
                      transactions={transactions}
                      accounts={accountLabels}
                      primaryName={primaryName}
                      owner={owner}
                      onChanged={reload}
                    />
```

(`owner` is the page's `useState<OwnerScope>` — the value `load()` hands `fetchTransactions`, so
the ledger saves in exactly the scope its rows came from.)

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/pages/PortfolioPage.test.tsx src/components/portfolio/TransactionsPanel.test.tsx`
Expected: PASS — every page test (one more than the Task 0 baseline) and 55 panel tests.

- [ ] **Step 5: Type-check, lint, commit**

```bash
npx tsc -b && npx eslint src/pages/PortfolioPage.tsx src/pages/PortfolioPage.test.tsx
git add src/pages/PortfolioPage.tsx src/pages/PortfolioPage.test.tsx
git commit -m "feat(portfolio): the Transactions ledger saves reorders in the page's owner scope"
```

---

### Task 8: the lane's gates

**Files:** none (verification). Record results in this plan's Results section (committed in
Task 10).

- [ ] **Step 1: The full frontend suite**

Run: `npx vitest run`
Expected: exit 0. Record the file and test counts. A failure outside the files this lane touches:
run the same command in `.worktrees/reorder-base` (its own `node_modules` symlink) before
reporting it as pre-existing.

- [ ] **Step 2: Types, lint, build**

Run: `npx tsc -b && npx eslint . && npm run build`
Expected: all three exit 0; `eslint .` reports no warning in any file this lane touched.

- [ ] **Step 3: Scope check**

Run: `git diff --stat feat/reorder-base...HEAD`
Expected: exactly `src/components/portfolio/TransactionsPanel.tsx`,
`src/components/portfolio/TransactionsPanel.test.tsx`, `src/components/portfolio/portfolio.css`,
`src/pages/PortfolioPage.tsx` (1 insertion), `src/pages/PortfolioPage.test.tsx`. Run
`git diff feat/reorder-base...HEAD -- src/pages/PortfolioPage.tsx` and confirm the whole diff is
the single `+                      owner={owner}` line.

---

### Task 9: the browser check — real Edge, real pointer, the private database

**Files:**
- Create: `scratchpad/reorder-r3/drag.mjs` (gitignored — never committed)
- Output: `scratchpad/reorder-r3/out/report.json` and screenshots

- [ ] **Step 1: The private database (controller prerequisite — verify, then migrate)**

`finance_reorder_r3` already exists: made 2026-09-23 from `finance_realdata`, with 39
transactions, at alembic `f12026091203`. Only if it is missing, create it with `pg_dump | psql`
(never `CREATE DATABASE … TEMPLATE`):

```bash
docker exec finance-dashboard-db-1 createdb -U finance finance_reorder_r3
docker exec finance-dashboard-db-1 sh -c 'pg_dump -U finance finance_realdata | psql -q -U finance -d finance_reorder_r3'
```

Migrate it with THIS lane's code (R1's migration `f12026092301`):

```bash
cd /c/Users/edyli/personal-finance-dashboard/.worktrees/reorder-r3/backend
PY=/c/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe
$PY -c "import app; print(app.__file__)"
DATABASE_URL=postgresql+asyncpg://finance:finance@localhost:5433/finance_reorder_r3 $PY -m alembic upgrade head
DATABASE_URL=postgresql+asyncpg://finance:finance@localhost:5433/finance_reorder_r3 $PY -m alembic current
```

Expected:
- The first command prints a path under `.worktrees/reorder-r3/backend/app/`. If it does not,
  stop.
- The upgrade logs `Running upgrade f12026091203 -> f12026092301, …`, or nothing if the database
  is already there.
- `alembic current` prints `f12026092301 (head)`. If R1 shipped another revision id, pass it to
  the script as `EXPECT_HEAD=<id>`.

- [ ] **Step 2: Start the lane's servers (two background processes)**

```bash
# backend — cwd /c/Users/edyli/personal-finance-dashboard/.worktrees/reorder-r3/backend
DATABASE_URL=postgresql+asyncpg://finance:finance@localhost:5433/finance_reorder_r3 SCHEDULER_ENABLED=0 $PY -m uvicorn app.main:app --host 127.0.0.1 --port 8093
# vite — cwd /c/Users/edyli/personal-finance-dashboard/.worktrees/reorder-r3
VITE_API_PROXY=http://127.0.0.1:8093 npx vite --port 5193 --strictPort
```

Check: `curl -s http://127.0.0.1:8093/api/v1/health` prints `{"status":"ok"}`, and
`curl -s -o /dev/null -w '%{http_code}' http://localhost:5193/` prints `200`.

- [ ] **Step 3: Write the script**

Create `scratchpad/reorder-r3/drag.mjs` (worktree root; `scratchpad/` is gitignored):

```js
// scratchpad/reorder-r3/drag.mjs — lane R3's browser check (2026-09-23 drag-to-reorder spec §5,
// §9, §10; plan docs/superpowers/plans/2026-09-23-reorder-r3-transactions.md, Task 9).
//
// Real Edge and real pointer events against the lane's OWN servers on the PRIVATE database:
//   uvicorn 127.0.0.1:8093  DATABASE_URL=…/finance_reorder_r3  SCHEDULER_ENABLED=0
//   vite    localhost:5193  VITE_API_PROXY=http://127.0.0.1:8093
// It WRITES — reorders, two scratch transactions and their deletes — and refuses any base but
// :5193. Every write is undone before it exits: the ledger ends in the order it started in.
//
// Per theme (dark, light) at 1600×1000 and 1280×800:
//   a  the resting ledger — grip column first, separate borders, the replay-order hint;
//   b  a real mouse drag (1600: three rows; 1280: a long drag that auto-scrolls the page) — the
//      row follows the pointer, exactly the rows it passes make room, the pinned actions cell
//      rides on the lifted surface, the toast, the server's order, the order after a reload;
//      then the order is put back through the API;
//   c  the same drag again, and Undo restores the previous order;
//   d  the keyboard path (Space, ↓ ×2, Space) — focus kept on the grip, the order saved, Undo;
//   e  (1600) one drag in a person scope that hides rows — the PUT carries the scope and the
//      visible ids, every hidden row keeps its slot in the household order, Undo;
//   f  (1600) a sell dragged above its buy (two scratch rows made through the form) — the toast
//      names the realized-gain change; both rows deleted through the ledger;
//   g  (1280) a forced 500 (rows back, focus kept, nothing saved) and a forced 409 (the server's
//      sentence; the page reloads the ledger).
// Exits 1 listing every problem; prints `R3 DRAG CHECK OK` when there are none.
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
const BASE = process.env.APP_BASE ?? 'http://localhost:5193'
if (new URL(BASE).port !== '5193') {
  throw new Error(`refusing to write through ${BASE}: lane R3's vite is :5193`)
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
]
const SETTLE = 1500
const MOTION = 120 // MOTION_MS.fast: a pointer drop eases this long before it commits
// `owner=all` spelled out: with no owner param the page falls back to the account's remembered
// scope (useScope's memory, mirrored through /prefs), which may be a person.
const HOUSEHOLD = '/portfolio?section=manage&owner=all'
const T = '#portfolio-records-transactions'
const SCRATCH_ACCOUNT = 'R3 scratch'
const SCRATCH_TICKER = 'VOO'
const STALE = 'The transactions changed since this list was loaded — nothing was moved.'
const HINT =
  "The list is the order trades are replayed to work out cost basis and gains — with no dates on the rows, it is the ledger's timeline. Drag a row to move a trade earlier or later."
const NOISE =
  /favicon|DevTools|\[vite\]|@vite\/client|Download the React DevTools|React Router Future Flag/i

const report = {
  generatedAt: new Date().toISOString(),
  base: BASE,
  checks: [],
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
const ledger = async (owner = null) =>
  (await api('GET', `/portfolio/transactions${owner === null ? '' : `?owner=${owner}`}`)).map(
    (t) => t.id,
  )
const putBack = (ids) => api('PUT', '/portfolio/transactions/order', { ids })

const head = (await api('GET', '/system/status')).database.alembic_head
if (head !== EXPECT_HEAD) {
  throw new Error(
    `finance_reorder_r3 is at ${head}, not ${EXPECT_HEAD}: run Task 9 Step 1's migration first`,
  )
}
const ORIGINAL = await ledger()
note('setup', 'ledger rows at the start (the finance_realdata census says 39)', ORIGINAL.length)
const TXNS = await api('GET', '/portfolio/transactions')
if (TXNS.some((t) => t.account === SCRATCH_ACCOUNT)) {
  throw new Error(`rows in '${SCRATCH_ACCOUNT}' are left over from an earlier run — delete them first`)
}
const TICKER = new Map((await api('GET', '/portfolio/securities')).map((s) => [s.id, s.ticker]))
const TXN = new Map(TXNS.map((t) => [t.id, t]))
// Every real-data drag below moves a row past rows of OTHER holdings only (the one holding with
// two rows, NVDA · Schwab ESPP, sits at slots 10 and 37), so no figure moves.
const quietToast = (id) =>
  `Moved the ${TICKER.get(TXN.get(id).security_id)} ${TXN.get(id).type}. No holding's figures changed.`
// A person whose scope hides rows: a person sees their own accounts plus the joint ones.
let PERSON = null
for (const person of (await api('GET', '/household')).people) {
  const ids = await ledger(person.id)
  if (ids.length >= 3 && ids.length < ORIGINAL.length) {
    PERSON = person.id
    break
  }
}
note('setup', 'the person scope that hides rows', PERSON)
if (PERSON === null) problem('setup: no person scope hides a row — step e cannot run')

const browser = await chromium.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--force-device-scale-factor=1'],
})

for (const theme of THEMES) {
  for (const size of SIZES) {
    const tag = `${theme}-${size.width}`
    const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1 })
    // Seeded before first paint: the app boots its auth and its theme out of localStorage.
    await ctx.addInitScript(
      ([token, th]) => {
        localStorage.setItem('finance_token', token)
        localStorage.setItem('finance.theme', th)
      },
      [TOKEN, theme],
    )
    // The account owns the theme (GET /prefs): the pass's theme is injected into the answer and
    // a PATCH is stubbed — a check never rewrites the account's settings.
    await ctx.route('**/api/v1/prefs*', async (route) => {
      const entry = { value: theme, updated_at: new Date().toISOString() }
      if (route.request().method() === 'GET') {
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
    })
    const page = await ctx.newPage()
    let expectFailures = false
    const errors = []
    const take = (entry) => {
      if (NOISE.test(entry.text) || NOISE.test(entry.url)) return
      if (
        expectFailures &&
        (entry.url.includes('/portfolio/transactions/order') ||
          /status of (409|500)/.test(entry.text))
      ) {
        report.knownBenign.push({ tag, why: 'the forced 500/409 of step g', ...entry })
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

    const open = async (route) => {
      try {
        await page.goto(BASE + route, { waitUntil: 'networkidle', timeout: 45000 })
      } catch {
        await page.goto(BASE + route, { waitUntil: 'load', timeout: 45000 })
      }
      await page.waitForSelector(`${T} tbody tr[data-reorder-id]`, { timeout: 20000 })
      await page.waitForTimeout(SETTLE)
    }
    const domOrder = () =>
      page.$$eval(`${T} tbody tr[data-reorder-id]`, (rows) =>
        rows.map((row) => Number(row.getAttribute('data-reorder-id'))),
      )
    const gripOf = (id) => page.locator(`${T} tbody tr[data-reorder-id="${id}"] .reorder-grip`)
    // Stand a row at `fraction` of the viewport height: below the sticky page header, clear of
    // the toasts and of both 40px auto-scroll zones.
    const standAt = (id, fraction = 0.45) =>
      page.evaluate(
        ([rowId, f]) => {
          const row = document.querySelector(
            `#portfolio-records-transactions tbody tr[data-reorder-id="${rowId}"]`,
          )
          window.scrollBy(0, row.getBoundingClientRect().top - window.innerHeight * f)
        },
        [id, fraction],
      )
    const mids = () =>
      page.$$eval(`${T} tbody tr[data-reorder-id]`, (rows) =>
        rows.map((row) => {
          const box = row.getBoundingClientRect()
          return box.top + box.height / 2
        }),
      )
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
    const undo = async () => {
      await page
        .locator('.toast')
        .filter({ hasText: /^Moved the / })
        .last()
        .getByRole('button', { name: 'Undo' })
        .click()
      await page.getByText('Order restored', { exact: true }).last().waitFor({ timeout: 8000 })
      await page.waitForTimeout(SETTLE) // the page's reload lands
    }
    // A real pointer drag of `id` by k rows (k < 0 is up). The lifted centre is aimed 40% of a
    // row past the target row's midpoint, so it has passed exactly |k| rows (lane R0's slot rule).
    const mouseDrag = async (id, k, step) => {
      await clearToasts()
      const before = await domOrder()
      const from = before.indexOf(id)
      const to = from + k
      await standAt(id)
      await page.waitForTimeout(250)
      const m = await mids()
      const rowHeight = m[1] - m[0]
      const box = await gripOf(id).boundingBox()
      const x = box.x + box.width / 2
      const y0 = box.y + box.height / 2
      const dy = m[to] + Math.sign(k) * 0.4 * rowHeight - m[from]
      await page.mouse.move(x, y0)
      await page.mouse.down()
      await page.mouse.move(x, y0 + Math.sign(k) * 6, { steps: 2 }) // past the 4px threshold
      await page.mouse.move(x, y0 + dy, { steps: 12 })
      await page.waitForTimeout(250)
      const mid = await page.evaluate(() => {
        const lifted = document.querySelector('tr[data-reorder="lifted"]')
        if (lifted === null) return null
        const cells = lifted.querySelectorAll('td')
        const actions = lifted.querySelector('td.row-actions')
        return {
          offset: Number(/translateY\((-?[\d.]+)px\)/.exec(lifted.style.transform)?.[1] ?? NaN),
          displaced: [...document.querySelectorAll('tr[data-reorder="shifting"]')].filter(
            (row) => row.style.transform !== '',
          ).length,
          grabbing: document.documentElement.classList.contains('reorder-active'),
          cellBackground: getComputedStyle(cells[1]).backgroundColor,
          actionsBackground: actions === null ? null : getComputedStyle(actions).backgroundColor,
        }
      })
      await page.screenshot({ path: path.join(out, `${tag}-${step}-mid-drag.png`) })
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
      check(tag, `${step}: the row lands where the gap was`, same(await domOrder(), expected), {
        from,
        to,
      })
      return expected
    }
    // 1280×800: the ledger is taller than the viewport. Park the pointer in the bottom 40px zone
    // and the page scrolls under it with the lifted row; then land the row mid-screen.
    const longDrag = async (id, step) => {
      await clearToasts()
      const before = await domOrder()
      const from = before.indexOf(id)
      await standAt(id, 0.35)
      await page.waitForTimeout(250)
      const scrollBefore = await page.evaluate(() => window.scrollY)
      const box = await gripOf(id).boundingBox()
      const x = box.x + box.width / 2
      const y0 = box.y + box.height / 2
      await page.mouse.move(x, y0)
      await page.mouse.down()
      await page.mouse.move(x, y0 + 6, { steps: 2 })
      await page.mouse.move(x, size.height - 12, { steps: 20 })
      await page.waitForTimeout(1200)
      const scrolled = (await page.evaluate(() => window.scrollY)) - scrollBefore
      await page.screenshot({ path: path.join(out, `${tag}-${step}-auto-scroll.png`) })
      await page.mouse.move(x, size.height / 2, { steps: 10 })
      await page.waitForTimeout(250)
      await page.mouse.up()
      await page.waitForTimeout(MOTION + 700)
      const after = await domOrder()
      const to = after.indexOf(id)
      const scroller = await page.evaluate(() => {
        const element = document.querySelector('#portfolio-records-transactions .holdings-scroll')
        return {
          overflowY: getComputedStyle(element).overflowY,
          scrollHeight: element.scrollHeight,
          clientHeight: element.clientHeight,
        }
      })
      note(tag, `${step}: the ledger's own scroller (Task 9 Step 5 reads this)`, scroller)
      check(tag, `${step}: the page auto-scrolls under a held pointer`, scrolled > 200, {
        scrolled,
        scroller,
      })
      check(tag, `${step}: the row travels with the scroll`, to - from >= 8, { from, to })
      check(tag, `${step}: nothing else moved`, same(after, moveTo(before, from, to)), after)
      return after
    }

    try {
      // ── a. the resting ledger ──────────────────────────────────────────────────────────────
      await open(HOUSEHOLD)
      const painted = await page.evaluate(() => document.documentElement.dataset.theme ?? null)
      check(tag, 'a: the page paints this theme', painted === theme, painted)
      const resting = await page.evaluate(() => {
        const table = document.querySelector('#portfolio-records-transactions table')
        const hint = document.querySelector('#portfolio-records-transactions p.hint')
        return {
          className: table.className,
          borderCollapse: getComputedStyle(table).borderCollapse,
          firstHead: table.querySelector('thead th')?.className ?? null,
          hint: (hint?.textContent ?? '').replace(/\s+/g, ' '),
        }
      })
      check(
        tag,
        'a: a reorderable table with separate borders',
        resting.className === 'port-table reorder-table' && resting.borderCollapse === 'separate',
        resting,
      )
      check(tag, 'a: the grip column comes first', resting.firstHead === 'reorder-grip-cell', resting.firstHead)
      check(tag, 'a: the hint says the list is the replay order', resting.hint.includes(HINT), resting.hint)
      check(tag, 'a: the list is the server order', same(await domOrder(), ORIGINAL), await domOrder())
      await page.screenshot({ path: path.join(out, `${tag}-a-resting.png`), fullPage: true })
      drain('a')

      // ── b. a real mouse drag, and the order survives a reload ─────────────────────────────
      const bId = size.width === 1280 ? ORIGINAL[0] : ORIGINAL[1]
      const bOrder = size.width === 1280 ? await longDrag(bId, 'b') : await mouseDrag(bId, 3, 'b')
      const bSaid = await toastText(/^Moved the /)
      check(tag, 'b: the toast names the row and what the move did', bSaid === quietToast(bId), bSaid)
      check(tag, 'b: the server holds the new order', same(await ledger(), bOrder), await ledger())
      await open(HOUSEHOLD)
      check(tag, 'b: the order survives a reload', same(await domOrder(), bOrder), await domOrder())
      await putBack(ORIGINAL)
      await open(HOUSEHOLD)
      check(tag, 'b: put back through the API', same(await domOrder(), ORIGINAL), await domOrder())
      drain('b')

      // ── c. the same drag again; Undo restores the previous order ───────────────────────────
      const cOrder = await mouseDrag(ORIGINAL[1], 3, 'c')
      await toastText(/^Moved the /)
      check(tag, 'c: the server holds the new order', same(await ledger(), cOrder), await ledger())
      await undo()
      check(tag, 'c: Undo restores the server order', same(await ledger(), ORIGINAL), await ledger())
      check(tag, 'c: …and the list shows it', same(await domOrder(), ORIGINAL), await domOrder())
      drain('c')

      // ── d. the keyboard path ───────────────────────────────────────────────────────────────
      await clearToasts()
      await standAt(ORIGINAL[0])
      const dGrip = gripOf(ORIGINAL[0])
      const dName = await dGrip.getAttribute('aria-label')
      await dGrip.focus()
      await page.keyboard.press('Space')
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Space')
      const dSaid = await toastText(/^Moved the /)
      const dOrder = moveTo(ORIGINAL, 0, 2)
      check(tag, 'd: Space, ↓ ×2, Space moves the row two places', same(await domOrder(), dOrder), await domOrder())
      check(tag, 'd: the toast', dSaid === quietToast(ORIGINAL[0]), dSaid)
      const dFocus = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? null)
      check(tag, 'd: focus stays on the moved grip', dFocus === dName, { dFocus, dName })
      check(tag, 'd: the server holds it', same(await ledger(), dOrder), await ledger())
      await undo()
      check(tag, 'd: Undo restores it', same(await ledger(), ORIGINAL), await ledger())
      drain('d')

      // ── e. a person scope: the visible rows move among their own slots ────────────────────
      if (size.width === 1600 && PERSON !== null) {
        const householdBefore = await ledger()
        const scopeBefore = await ledger(PERSON)
        await open(`/portfolio?section=manage&owner=${PERSON}`)
        check(tag, 'e: the scope lists its own rows', same(await domOrder(), scopeBefore), await domOrder())
        const request = page.waitForRequest(
          (r) => r.method() === 'PUT' && r.url().includes('/portfolio/transactions/order'),
          { timeout: 10000 },
        )
        const eOrder = await mouseDrag(scopeBefore[0], 2, 'e')
        const put = await request
        check(
          tag,
          'e: the PUT names the scope',
          new URL(put.url()).searchParams.get('owner') === String(PERSON),
          put.url(),
        )
        check(
          tag,
          'e: the PUT carries the visible ids in their new order',
          same(put.postDataJSON()?.ids, eOrder),
          put.postDataJSON(),
        )
        await toastText(/^Moved the /)
        const householdAfter = await ledger()
        const visible = new Set(scopeBefore)
        check(
          tag,
          'e: every hidden row keeps its slot in the household order',
          householdBefore.every((id, index) => visible.has(id) || householdAfter[index] === id),
          { householdBefore, householdAfter },
        )
        check(
          tag,
          'e: the visible rows moved among their own slots',
          same(householdAfter.filter((id) => visible.has(id)), eOrder),
          householdAfter,
        )
        await undo()
        check(tag, 'e: Undo restores the household order', same(await ledger(), householdBefore), await ledger())
        drain('e')
      }

      // ── f. a sell above its buy re-times the trade: the realized gain moves ────────────────
      if (size.width === 1600) {
        await open(HOUSEHOLD)
        const form = page.locator(`${T} form.entry-form`)
        const rowCount = (count) =>
          page.waitForFunction(
            (n) =>
              document.querySelectorAll('#portfolio-records-transactions tbody tr[data-reorder-id]')
                .length === n,
            count,
            { timeout: 15000 },
          )
        await form.getByLabel('Security', { exact: true }).selectOption({ label: SCRATCH_TICKER })
        await form.getByLabel('Account', { exact: true }).fill(SCRATCH_ACCOUNT)
        await form.getByLabel('Type', { exact: true }).selectOption('buy')
        await form.getByLabel('Shares', { exact: true }).fill('10')
        await form.getByLabel('Price', { exact: true }).fill('100')
        await form.getByRole('button', { name: 'Add transaction' }).click()
        await rowCount(ORIGINAL.length + 1)
        await form.getByLabel('Type', { exact: true }).selectOption('sell')
        await form.getByLabel('Shares', { exact: true }).fill('4')
        await form.getByLabel('Price', { exact: true }).fill('150')
        await form.getByRole('button', { name: 'Add another' }).click()
        await rowCount(ORIGINAL.length + 2)
        await page.waitForTimeout(SETTLE)
        const scratch = (await api('GET', '/portfolio/transactions')).filter(
          (t) => t.account === SCRATCH_ACCOUNT,
        )
        const buy = scratch.find((t) => t.type === 'buy')
        const sell = scratch.find((t) => t.type === 'sell')
        if (check(tag, 'f: the form made a buy, then a sell', buy !== undefined && sell !== undefined, scratch)) {
          await mouseDrag(sell.id, -1, 'f')
          const fSaid = await toastText(/^Moved the /)
          // Buy 10 @ 100 then sell 4 @ 150 realizes $200; the sell replayed first finds no shares
          // (average cost 0) and realizes $600 — the fold's own arithmetic, read from the server.
          check(
            tag,
            'f: the toast names the realized-gain change',
            fSaid ===
              `Moved the ${SCRATCH_TICKER} sell. ${SCRATCH_TICKER} at ${SCRATCH_ACCOUNT}: realized gain $200.00 → $600.00.`,
            fSaid,
          )
          await page.waitForTimeout(SETTLE)
          await page
            .locator(`${T} tbody tr[data-reorder-id="${sell.id}"] button[aria-label="Delete this sell"]`)
            .click()
          await rowCount(ORIGINAL.length + 1)
          await page.waitForTimeout(SETTLE)
          await page
            .locator(`${T} tbody tr[data-reorder-id="${buy.id}"] button[aria-label="Delete this buy"]`)
            .click()
          await rowCount(ORIGINAL.length)
          await page.waitForTimeout(SETTLE)
        }
        check(
          tag,
          'f: the scratch rows are gone and the ledger reads as it did',
          same(await ledger(), ORIGINAL),
          await ledger(),
        )
        drain('f')
      }

      // ── g. a failed save, then a stale list ────────────────────────────────────────────────
      if (size.width === 1280) {
        await open(HOUSEHOLD)
        await clearToasts()
        expectFailures = true
        await page.route(
          '**/api/v1/portfolio/transactions/order**',
          (route) =>
            route.fulfill({
              status: 500,
              contentType: 'application/json',
              body: JSON.stringify({ detail: 'Internal Server Error' }),
            }),
          { times: 1 },
        )
        const target = ORIGINAL[3]
        await standAt(target)
        await gripOf(target).focus()
        await page.keyboard.press('Space')
        await page.keyboard.press('ArrowUp')
        await page.keyboard.press('Space')
        const failed = await toastText(/^Couldn't save the new order/)
        check(
          tag,
          'g: a 500 says why',
          failed ===
            "Couldn't save the new order — the server had a problem (HTTP 500). The list is back to how it was.",
          failed,
        )
        check(tag, 'g: the rows are back', same(await domOrder(), ORIGINAL), await domOrder())
        const focusedRow = await page.evaluate(
          () => document.activeElement?.closest('tr')?.getAttribute('data-reorder-id') ?? null,
        )
        check(tag, "g: focus stays on the moved row's grip through the revert", focusedRow === String(target), focusedRow)
        check(tag, 'g: nothing was saved', same(await ledger(), ORIGINAL), await ledger())
        await clearToasts()
        await page.route(
          '**/api/v1/portfolio/transactions/order**',
          (route) =>
            route.fulfill({
              status: 409,
              contentType: 'application/json',
              body: JSON.stringify({ detail: STALE }),
            }),
          { times: 1 },
        )
        const reloaded = page.waitForRequest(
          (r) => r.method() === 'GET' && /\/api\/v1\/portfolio\/transactions(\?|$)/.test(r.url()),
          { timeout: 10000 },
        )
        await gripOf(ORIGINAL[0]).focus()
        await page.keyboard.press('Space')
        await page.keyboard.press('ArrowDown')
        await page.keyboard.press('Space')
        const stale = await toastText(STALE)
        check(tag, "g: a 409 shows the server's sentence", stale === STALE, stale)
        check(tag, 'g: …and the page reloads the ledger', await reloaded.then(() => true, () => false), null)
        await page.waitForTimeout(SETTLE)
        check(tag, 'g: the list reads as the server has it', same(await domOrder(), ORIGINAL), await domOrder())
        expectFailures = false
        drain('g')
      }
    } catch (error) {
      problem(`${tag}: the pass stopped — ${error instanceof Error ? error.message : String(error)}`)
      await page.screenshot({ path: path.join(out, `${tag}-stopped.png`), fullPage: true }).catch(() => {})
    } finally {
      // A stopped pass must not leave the private ledger changed.
      const leftovers = (await api('GET', '/portfolio/transactions')).filter(
        (row) => row.account === SCRATCH_ACCOUNT,
      )
      for (const row of leftovers) {
        await api('DELETE', `/portfolio/transactions/${row.id}`)
        problem(`${tag}: scratch row ${row.id} was still there after the pass — deleted through the API`)
      }
      if (!same(await ledger(), ORIGINAL)) {
        problem(`${tag}: the ledger was not in its starting order after the pass — put back through the API`)
        await putBack(ORIGINAL)
      }
      await ctx.close()
    }
  }
}
await browser.close()

check('end', 'the ledger ends in the order it started in', same(await ledger(), ORIGINAL), await ledger())
writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
if (report.problems.length > 0) {
  console.error(`R3 DRAG CHECK: ${report.problems.length} problem(s) — ${path.join(out, 'report.json')}`)
  for (const p of report.problems) console.error(` - ${p}`)
  process.exit(1)
}
console.log(`R3 DRAG CHECK OK — ${report.checks.length} checks; report and screenshots in ${out}`)
```

- [ ] **Step 4: Run it**

Run (worktree root): `node scratchpad/reorder-r3/drag.mjs`
Expected: `R3 DRAG CHECK OK — … checks; report and screenshots in …/scratchpad/reorder-r3/out`,
exit 0. `report.json` lists every check with its observed value. A problem that is not covered by
Step 5 is a finding: record it, fix it if it is inside this lane's fence (re-running Tasks 1–8 as
needed), and report anything that is R0's or R1's to the controller.

- [ ] **Step 5 (only if `b: the page auto-scrolls under a held pointer` fails at 1280)**

Read the `b: the ledger's own scroller` note in `report.json`.
- If it shows `overflowY: "auto"` with `scrollHeight > clientHeight`: R0's `scrollParentOf` took
  the ledger's sideways scroller for the list's vertical scroll container (its content overhangs
  by a rounding pixel), so the page never scrolled. Apply the fix below.
- Otherwise stop and report to the controller as an R0 finding.

The fix:
1. Append to `src/components/portfolio/portfolio.css`:

```css

/* The ledger's scroller scrolls sideways only. `overflow-x: auto` makes its computed overflow-y
   `auto` too, and a rounding pixel of overhang then reads as vertical scroll to the drag hook's
   scroll-container search — which must find the page. Hidden y changes nothing visible (the box
   is as tall as its table) and takes it out of that search. */
.holdings-scroll:has(> .reorder-table) { overflow-y: hidden; }
```

2. Add to the `portfolio.css — the reorderable ledger` describe in `TransactionsPanel.test.tsx`:

```tsx
  it("keeps the ledger's sideways scroller out of the drag's vertical scroll search", () => {
    expect(css).toContain('.holdings-scroll:has(> .reorder-table) { overflow-y: hidden; }')
  })
```

3. Run `npx vitest run src/components/portfolio/TransactionsPanel.test.tsx` (PASS, 56 tests),
   then `npx tsc -b && npx eslint src/components/portfolio/TransactionsPanel.test.tsx`.
4. Commit:

```bash
git add src/components/portfolio/portfolio.css src/components/portfolio/TransactionsPanel.test.tsx
git commit -m "fix(portfolio): the ledger's sideways scroller never passes for the drag's vertical scroll container"
```

5. Re-run Step 4, and record the finding in Results and Notes for the controller.

- [ ] **Step 6: Eyeball the screenshots (both themes)**

Open `scratchpad/reorder-r3/out/`:
- `*-a-resting.png`: the ledger at rest — the grip column is narrow, the hairlines look as before.
- `*-b-mid-drag.png` / `*-c-mid-drag.png` / `*-e-mid-drag.png` / `*-f-mid-drag.png`: the lifted
  row is raised, its pinned actions cell is on the same surface, and the rows it passed have made
  room.
- `*-b-auto-scroll.png` (1280): the lifted row near the bottom edge after the page scrolled.

Note anything off in Results.

- [ ] **Step 7: Stop the servers**

Stop the two background processes (uvicorn :8093, vite :5193). Leave `finance_reorder_r3` in
place — never drop it. After the run it keeps one new `portfolio_accounts` row, `R3 scratch`
(accounts are never deleted); its transactions are deleted. Nothing to commit: `scratchpad/` is
gitignored.

---

### Task 10: results

**Files:**
- Modify: `docs/superpowers/plans/2026-09-23-reorder-r3-transactions.md` (the Results section only)

- [ ] **Step 1: Fill in Results** — counts from Tasks 0 and 8, the browser check's outcome from
  Task 9 (per pass and per step, the auto-scroll distance, the focus-through-revert result),
  whether Task 9 Step 5 was needed, and anything the controller should pass to R0, R2 or V.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-09-23-reorder-r3-transactions.md
git commit -m "docs(plan): lane R3 — results, gates and the browser check"
```

---

## Results (filled in by the implementer)

Implemented 2026-09-23 in `.worktrees/reorder-r3` on `feat/reorder-transactions` (from
`feat/reorder-base` @ da1a3e44). Commits: b83d308f (Task 1), 457cfcfd (2), 8d5ab353 (3), 3f6f6185
(4), 3fbac8be (5), 0cf5e102 (6, per A1), 9deef677 (7), 7fc08c48 (the browser check's fix, below),
then this Results commit.

- **Task 0 baseline:** TransactionsPanel.test.tsx 23 tests; PortfolioPage.test.tsx 37 tests. The
  base carries R1 (dd62aa6c), R0 (0d805010 + the 11a4cda0 follow-up) and R4.
- **Lane tests after Task 7:** TransactionsPanel.test.tsx 55; PortfolioPage.test.tsx 38. After the
  browser check's fix (two new tests): TransactionsPanel.test.tsx **57**, PortfolioPage.test.tsx
  **38**. Every task was seen red first, with the failures the plan predicted, except Task 6
  (green at once by A1's design).
- **Full vitest** (one run, `--maxWorkers=2`, after every code change including the fix):
  **246 files / 3427 tests, exit 0**. No flake appeared, so there was nothing to re-run.
- **tsc / eslint / build:** `npx tsc -b` exit 0. `npx eslint .` exit 0 with 0 errors; its 26
  warnings are all pre-existing `react-refresh/only-export-components` in files this lane does
  not touch. The lane's files lint clean after every commit, the fix included. `npm run build`
  (`tsc -b && vite build`) exit 0, 2658 modules, no warnings.
- **Scope check:** `git diff --stat feat/reorder-base...HEAD` lists exactly
  TransactionsPanel.tsx, TransactionsPanel.test.tsx, PortfolioPage.test.tsx and
  PortfolioPage.tsx (its whole diff is `+ owner={owner}`), plus this Results section.
  `portfolio.css` is untouched (A1).
- **Browser check.** Real Edge on the lane's own uvicorn :8093 and vite :5193 against
  `finance_reorder_r3`, verified at `f12026092301 (head)` with no migration run.
  - **Run 1:** 153 checks, **23 problems**, two findings.
    1. **Script:** step f's `getByLabel('Security', { exact: true })` never matches. A wrapping
       `<label>`'s text includes its `<select>`'s option texts. Fixed in the script: locate the
       control inside the label whose text starts with the name; Account keeps `getByLabel`
       through its own `aria-label`.
    2. **App bug**, in dark-1280, light-1600 and light-1280; timing-dependent, since dark-1600
       passed.
       - Undo restored the server's order ("c: Undo restores the server order" ok), but the
         ledger kept showing the dropped order `[27,29,30,31,28,…]`.
       - Step d then dragged from that stale display, and the PUT saved it: R1 accepts any
         permutation of the same rows. So a stale display turns into data.
       - Cause: Undo's page reload supersedes the drop's (`seqRef`) and brings back the rows from
         before the drop. PortfolioPage skips a snapshot equal to the one on screen, and here the
         `sort_index` values were already respaced 10, 20, … by an earlier reorder, so the payload
         is identical. No new `transactions` reach the panel, so `savedOrder` — the drop's answer —
         never retires.
       - The later g failures follow from d.
       - **Fixed in 7fc08c48**, test first. The Undo's own answer becomes the saved layer. Both
         layers also carry the owner scope they were made in and show only while the page shows
         it, which closes the sibling case found by analysis: a save or Undo answering after a
         scope switch would otherwise stand over the other scope's rows, with nothing new from the
         page to push it off.
  - **Run 2 (after the fix):** `R3 DRAG CHECK OK` — **171 checks, 0 problems**. Per pass:
    dark-1600 50/50, dark-1280 33/33 (+1 note), light-1600 50/50, light-1280 33/33 (+1 note),
    and the end check 1/1. `knownBenign` holds only step g's forced 500/409, 8 entries.
    - The lifted row follows the pointer: offset = dy to within 1e-4 px.
    - Exactly |k| rows make room, the page says grabbing, and the pinned actions cell rides on the
      lifted surface in every pass.
    - **Long-drag auto-scroll: 594 px** in both themes (612 / 630 in run 1); the row travelled
      from slot 0 to 17.
    - **Focus through a failed save:** it stays on the moved row's grip (row 30) in both 1280
      passes.
    - **Owner scope (e):** Grace (id 2). The PUT is `…/order?owner=2` with her 27 visible ids in
      their new order, every hidden row keeps its household slot, and Undo restores the household
      order.
    - **Figure change (f):** the toast reads "Moved the VOO sell. VOO at R3 scratch: realized gain
      $200.00 → $600.00.", and both scratch rows were deleted through the ledger.
    - **Failures (g):** the 500 toast reads "Couldn't save the new order — the server had a
      problem (HTTP 500). The list is back to how it was.", and the 409 toast is the server's
      sentence, followed by the page's reload.
  - **Run 3** (`ONLY_WIDTH=1600 OUT_DIR=out-toasts`, which adds toast screenshots): OK, 103
    checks.
  - **Screenshots** (`scratchpad/reorder-r3/out`, `out-toasts`, run 1's failure evidence in
    `out-run1`), eyeballed in both themes:
    - resting: grip column narrow and first, hairlines as before, the hint's replay-order sentence;
    - mid-drag at 1600 and 1280: the lifted row is raised on `--surface-2` with its actions cell
      on the same surface and hairline kept, the passed rows have made room, and the row buttons
      are shut;
    - auto-scroll: the lifted row rides the bottom edge;
    - `*-f-toast`: the figure-change toast;
    - `*-e-toast`: Grace's scope with the quiet toast.
  - **Database afterwards:** 39 transactions in the starting order (ids 27…65; `sort_index` now
    respaced 10…390 by R1's route) and no scratch rows. The `R3 scratch` portfolio account (id 9)
    stays, as planned. Servers stopped; no process of the lane left running.
- **Task 9 Step 5 needed: no.** At 1280 the ledger's `.holdings-scroll` computes `overflow-y:
  auto` with scrollHeight = clientHeight = 1753. R0's `scrollHeight − clientHeight > 1` rule
  passes over it, and the page auto-scrolls.
- **Deviations from the plan, each recorded in its commit:**
  1. **Decision 9 is not implemented as written** (Task 5: no `flushSync`, no explicit focus
     hand-back). React DOM's commit records the focused element before its mutations and
     re-focuses it afterwards (react-dom 19.2.8, commit path → `priorFocusedElem.focus()`).
     jsdom also applies the focus-fixup rule to a moved row (checked directly), so the plan's
     focus assertion is load-bearing and passes on React's own restore. Edge step g confirms it
     for real.
  2. **Decisions 2 and 3 are amended by the browser finding.** The Undo is still not optimistic,
     but its confirmed answer is now shown at once as the saved layer. Both layers are
     scope-tagged. Two tests were added: "shows the restored order once the server confirms it,
     though the page hands down nothing new" and "never shows one scope's order under another —
     a save that answers after a scope switch".
  3. **Task 6 per A1.** Test 1 also pins that `portfolio.css`'s collapse sits on the one-class
     `.port-table`, which `table.reorder-table` outranks. That keeps the kept `css` reader used;
     unused, it fails eslint.
  4. **Task 1's scope-switch test** also asserts R0's final "Cancelled — the list changed."
  5. **The full vitest and the build ran after the browser check,** not before it (the memory
     constraint allows one full run, and it had to cover the fix).
- **Notes for R0 / R2 / V:**
  - **R2 / R5:** any optimistic or saved layer retired only on fresh props can stick. A parent
    that skips identical payloads, or a client Undo that re-sends an old order, hands down nothing
    new. Show the server's answer to the Undo, and scope-tag the layer where a scope exists. R5's
    client Undo is the same shape as this lane's.
  - **R0:** `commit`'s explicit refocus after `flushSync` is redundant with React's own restore.
    It is harmless; no change asked.
  - **V:**
    - R1's 409 fires on a change of membership only. A pure reorder made elsewhere (another tab)
      is not detected, so the last writer wins. That is why a stale display is dangerous.
    - During auto-scroll the lifted row near the bottom edge sits under the app's viewport-edge
      fade, so it looks dimmed; cosmetic, not R3's.
    - `finance_reorder_r3` keeps the `R3 scratch` account.

---

## Notes for the controller (cross-lane findings made while planning)

1. **The pinned actions cell outranks reorder.css's row states on every table that has one.**
   - panels.css:247-255 pins `.data-table td.row-actions` / `.port-table td.row-actions` at
     specificity (0,2,1), with `background: var(--surface)` and a box-shadow hairline.
   - reorder.css's `tr[data-reorder='lifted'] > td` and the drop-line rules are (0,1,2), so a
     lifted row's actions cell stays on the resting surface and the reduced-motion drop line
     stops short of it.
   - This lane restates the rules for `.port-table` only (Task 6). R2's Settings tables
     (`.data-table` with `td.row-actions`) meet the same thing.
   - A single R0-level fix would be prefixing reorder.css's row-state selectors with
     `.reorder-table` (→ (0,2,2)).
2. **`border-collapse` ties.** `.data-table` (panels.css:210) and `.port-table` (portfolio.css:17)
   set `border-collapse: collapse` at the same specificity as `.reorder-table`, and which rule
   lands last depends on the production CSS chunk order.
   - This lane pins `.port-table.reorder-table`; R2 needs the same for `.data-table`.
   - An R0-level `table.reorder-table` ((0,1,1)) would settle it for every lane.
3. **The forward reference is fine.** A save closure declared before `useReorder(...)` that
   calls `reorder.markSaved(...)` in its promise callback passes `eslint-plugin-react-hooks`
   7.1.1 (probed 2026-09-23). Only an effect callback naming a later `const` is rejected. R2 and
   R5 can use the same shape.
4. **`.holdings-scroll` computes `overflow-y: auto`** (from its `overflow-x: auto`). R0's
   `scrollParentOf` depends on `scrollHeight > clientHeight` to pass over it. Task 9 proves page
   auto-scroll at 1280×800 and carries a scoped contingency (Step 5).
5. **Database.** This lane's browser check uses `finance_reorder_r3` (exists; migrate it after
   R1's merge — Task 9 Step 1). Spec §10 names `finance_reorder_scratch`. After the check, the
   database keeps an `R3 scratch` portfolio account (accounts are never deleted); its
   transactions are deleted.
6. **R1 decisions this lane relies on:** 9 (no negative zero on the wire — the toast compares
   strings) and 15 (`owner` is required — the panel always passes one, `null` for the household).

---

## Self-review — every R3 requirement mapped to a task

| Spec | Requirement | Task |
|---|---|---|
| §5 | new `owner` prop, passed from `PortfolioPage.tsx` in one additive line | 2 (prop), 7 (line + page test) |
| §5 | grip column first; the table carries `.reorder-table`; items = the visible rows, one range | 1 |
| §5 | drop → optimistic order (`pendingOrder`, retired when fresh props arrive) | 1, 2 (two layers, Decision 2) |
| §5 | `PUT /portfolio/transactions/order?owner=…` with the visible ids | 2 |
| §5 | success: `onChanged()`, `markSaved`, a toast naming the moved row | 2 |
| §5 | toast: "no holding's figures changed" or the first changed figure of the moved row's OWN holding (first listed otherwise), plus a count of the others | 2, 3 |
| §5 | Undo: re-send the previous visible order with the same PUT → `onChanged()` → "Order restored" | 4 |
| §5 | failure and 409 as §4.1 (revert, `toast.error`); 409 → `onChanged()` | 5 |
| §5 | hint gains the §8.1 sentence | 1 |
| §5 | grips follow the panel's `busy`; the hook cancels a drag when the scope changes the rows | 1 |
| §5 acceptance | one PUT with the visible ids and the owner; optimistic render; both toast shapes incl. the "and N more" tail; Undo re-sends; failure reverts; 409 reloads | 1–5 |
| §5 acceptance | page test: the owner prop reaches the panel | 7 |
| §8.1 | Transactions hint (append) | 1 |
| §8.1 | Toast — no figure changed | 2 |
| §8.1 | Toast — figures changed (figure order, warning variant, tail) | 3 |
| §8.1 | Toast — "Order restored" | 4 |
| §8.1 | Toast — save failed (non-409) | 5 |
| §8.3 | transactions 409 sentence shown in `toast.error`, list reloaded | 5 (drop), 4 (Undo), 9g (browser) |
| §9 | one-row list: disabled grip; empty list: no grips | 1 |
| §9 | two tabs → 409 → toast → reload; nothing half-applied | 5, 9g |
| §9 | no second drop while the save is in flight; the next drag diffs against the optimistic rows | 1, 2, 5 |
| §9 | Undo after a later reorder re-sends the captured order; a changed list takes the 409 path | 4 |
| §9 | cancelled drags (data landing, scope switch, Escape) make no request | 1 (blur and resize: R0) |
| §9 | owner scope reorders only the visible rows among their slots; hidden holdings never move | 2 (visible ids + owner), 9e |
| §9 | figures reported for every changed position, not only visible ones | 3 (the tail counts them all) |
| §9 | Edge at 1280/1600, both themes | 9 |
| §2.4 | grip "Reorder {name}", described by the instructions; focus kept after a keyboard drop; live region | 1, 2, 9d |
| §2.5 / §0.11 | `.reorder-table` border model; the hairline travels with its row; the sticky actions cell | 6, 9a–9c |
| §2.3 | page auto-scroll during a long drag (the ledger at 1280×800) | 9b (Step 5 contingency) |
| §10 | TDD per behaviour; full vitest, `tsc -b`, eslint, `vite build`; browser check on the lane's own servers (8093/5193) | 1–8, 9 |
| §11 | branch `feat/reorder-transactions` from `feat/reorder-base` after R0 + R1; scope fence; one prop line in `PortfolioPage.tsx` | Mechanics, 0, 8 (scope check) |
