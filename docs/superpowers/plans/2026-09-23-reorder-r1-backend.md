# Lane R1 — drag to reorder: the server, the importer and the client contract (2026-09-23) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task — one implementer
> for this lane in its own worktree, TDD per task, then a spec-compliance review and a code-quality
> review, then merge into `feat/reorder-base` (never main, never pushed). Steps use checkbox
> (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-09-23-drag-to-reorder-design.md` — this lane implements **§3
(3.1–3.7)** and the R1 rows of **§8.3, §8.4, §9, §10 and §11**. Read §0, §3, §8 and §9 before Task 1.
The spec is authoritative where this plan is silent; the "Decisions" section below records every
choice the spec left open.

**Goal:** five `PUT …/order` endpoints (two of them change-logged) on one pure ordering service,
create-time append defaults, an importer that no longer owns any order (the transactions' sheet
identity moves to a new `position_transactions.import_key` column), and the browser's half of the
contract — so lanes R2, R3 and R5 build against a finished, tested API.

**Architecture:** `backend/app/services/ordering.py` holds the arithmetic — the permutation check,
the slot-preserving subset, a renumber that writes only what moved, the minimal moved set, the
append query builder and the fold-diff report. Each router gets one `PUT …/order` route declared
before its `/{id}` routes: accounts and categories record every changed row in one `ChangeBatch`
(Undo on the Activity card); transactions, cards and reward categories commit directly (their
clients undo by re-sending the previous order, spec §0.10). Migration `f12026092301` adds
`import_key` with a partial unique index, and the importer matches sheet rows by it. `src/api/*.ts`
gains five functions and `src/types/api.ts` two wire types.

**Tech stack:** FastAPI + SQLAlchemy 2 (async) + Alembic + pytest in `backend/` (Python 3.12, ruff);
React + TypeScript + vitest in `src/`.

**Pre-validated (2026-09-23).** The code in this plan was applied to a scratch copy of
`feat/reorder-base` @b3a55d2 (whose `backend/` and `src/` are byte-identical to @d9ddbe4) and
checked there:
- replaying every step of Tasks 1–10, block by block, onto a fresh copy of the base reproduces the
  checked files byte for byte;
- `ruff check` and `ruff format --check` are clean on every intermediate and final file;
- the whole backend suite passed on the finished code (1 281 + 838 passed, 1 skipped, in two runs;
  the first run's only failure was a scratch-layout artifact — `test_prefs_registry.py` reads
  `../src`, which the scratch copy lacked until it was added);
- the Task 6 migration drill passed twice on a throwaway database (backfill, duplicate refused,
  downgrade, upgrade, `alembic check` clean);
- the four `src/api` test files pass (23 tests); `tsc` and `eslint` are clean;
- every "watch it fail" message quoted below was reproduced against the unchanged base.

Expected outputs quoted below are the ones those runs printed. If a step's output differs, stop and
find out why before changing anything.

---

## Mechanics (read once)

- **Lane worktree:** `C:/Users/edyli/personal-finance-dashboard/.worktrees/reorder-r1`, branch
  `feat/reorder-backend`, cut from `feat/reorder-base` (NOT main). The controller creates it before
  the implementer starts. Frontend commands need `node_modules` — the controller symlinks it
  (`ln -s /c/Users/edyli/personal-finance-dashboard/node_modules node_modules`). Work ONLY inside
  this worktree. Another Claude job is active in
  `.worktrees/{perf-first-four,backend-quick-fixes,frontend-quick-fixes,charts-spending-overview,charts-tax-portfolio}`
  and merges into main: never touch those worktrees, main, or main's working tree.
- **Python:** `$PY` = `C:/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe`.
  `$PY` is notation — the tool shell keeps no variables between calls, so spell the path out or
  start each command line with `PY=C:/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe;`.
  Every backend command runs with cwd `<worktree>/backend`. The first command of the lane,
  `$PY -c "import app; print(app.__file__)"`, must print the worktree's path.
- **Tests:** `FINANCE_TEST_DB=finance_test_reorder_r1 $PY -m pytest tests/<file>.py -q` per task
  (conftest creates the database). The full suite runs once, at the end (~15–20 min, longer while
  other lanes run theirs). Never pipe a gate through `tail`/`head`; read the exit code.
- **Lint:** `$PY -m ruff check app tests && $PY -m ruff format --check app tests` before every commit.
  When the format check names a file, run `$PY -m ruff format <that file>` and re-check.
- **Migration drill (Task 6):** a private scratch database `finance_test_reorder_r1_mig` (created
  with the asyncpg snippet in Task 6); every alembic command in the drill is prefixed with
  `DATABASE_URL=postgresql+asyncpg://finance:finance@localhost:5433/finance_test_reorder_r1_mig`.
  Upgrade to the parent, seed, `upgrade head`, check the backfill, `downgrade -1`, `upgrade head`,
  `alembic check`. NEVER run alembic or any write against `finance`, `finance_realdata` (shared,
  read-only) or any other lane's database. The only query this lane runs against
  `finance_realdata` is the SELECT-only census in Task 6.
- **Frontend (Task 10):** from the worktree root, `npx vitest run src/api/<file>.test.ts`, then
  `npx tsc -b`, `npx eslint .`.
- **Commits:** small and conventional (`feat(ordering): …`, `test(importer): …`); never push; never
  delete files, branches or databases (the morning list owns deletions).
- **Commands are self-contained:** env prefixes are written inline on each command, and `cd` is
  repeated wherever the working directory matters.
- **Shared-session test contract (conftest):** the `client` fixture drives endpoints through the
  test's own `db` session, and a refused request rolls that session back. The tests below read
  ids into plain ints before any request that can be refused, and read results back through the
  API or a fresh `select`.
- **Merge-conflict awareness:** lane P of the in-flight quick-fixes batch owns
  `backend/app/services/portfolio_calc.py` and the matrix loop of `backend/app/api/spending.py`.
  This lane never edits `portfolio_calc.py` (it only imports `fold_transactions`, `Position`,
  `PositionKey`, `MONEY_Q` and `SHARE_Q` from it) and edits `spending.py` only in its import block
  and its categories section (base lines 1–180). `src/types/api.ts` edits are additive and sit
  beside each list's own types.

## Decisions this plan takes where the spec is silent

1. **The tie rule of `moved_ids`.** "Ties keep the earliest rows" is read in the NEW order — the
   sequence §3.1 reads old positions in. Of all longest increasing subsequences, the kept one is the
   lexicographically smallest by new-order index. An adjacent swap `[a, b] → [b, a]` therefore names
   `a` (the kept row is `b`, the earlier row of the new order). O(n log n).
2. **"A parent with exactly its components"** (§8.4). A parent carries the accounts whose
   `parent_account_id` is that account AND whose `group` equals its group — the rows the Settings
   table nests under it and carries in a drag (R2 applies `nestComponents` per group, spec §4.2). A
   same-parent component sitting in another group is not carried. (Amended 2026-09-23 at the R1
   code review.) The label tries the natural explanation BEFORE the minimal moved set:
   `services.ordering.moved_alone(old, new, parent, carried)`. This holds when removing the parent's
   block from both orders leaves the same sequence, and the parent itself now sits elsewhere among
   the rest. So a block moved up one row is "Moved account P", not "Moved account D" (the row it
   passed, which is what the minimal set names), and up two is not "Reordered 2 accounts".
   Components shuffled under an unmoved parent never name the parent. Of two blocks that swapped,
   the later one in the new order is named (moved_ids' tie rule). Then the single-row rule, then the
   count.
3. **`check_permutation` raises `HTTPException` itself** — the `services/money.py` precedent: the
   module's sentences are the API's vocabulary. Duplicates are checked before set equality, so
   `[1, 1, 99]` is a 422, not a 409.
4. **`OrderIn` lives in `backend/app/schemas/ordering.py`** and is shared by all five routes. Its ids
   are plain ints (no int32 bound): no route hands a body id to SQL, and an unknown id is a stale
   list (409), not a malformed body.
5. **The append query is `services.ordering.next_sort_order(column)`**, which returns a `Select`
   that the router awaits. The service stays I/O-free, and the five create paths share one spelling
   of `coalesce(max(sort_order), −1) + 1`.
6. **The batch header on the two logged routes** is set with
   `response.headers.update(batch_header(await batch.commit()))`. `batch_header` returns `{}` when
   nothing was logged, so this is exactly the allocation routes' "only when the batch recorded
   rows" rule — and it leaves both routers' `changelog` import lines untouched.
7. **One ledger query builder.** `_ledger_query(owner_filter)` in `api/portfolio.py` serves
   `GET /transactions` and `PUT /transactions/order`, so "the rows the page shows" and "the rows the
   PUT must name" cannot drift apart. `list_transactions` is refactored onto it with identical
   output.
8. **`position_changes` lives in `services/ordering.py`** (pure: it compares two folds the route
   made). `portfolio_calc.py` belongs to lane P and is not edited.
9. **Negative zero never reaches the wire:** a quantized figure equal to zero is emitted as its
   absolute value (`"0.00"`, never `"-0.00"`).
10. **No-op answers echo the stored values** (no normalization happens on a no-op, §3.2). The
    transactions no-op answers the visible rows with `changed_positions: []`.
11. **Importer transaction appends** start from `coalesce(max(sort_index), 0)` over the WHOLE ledger
    (UI rows included — the UI create's own base) and step 10 per created row, in sheet order
    (`services.ordering.next_sort_index`, `SORT_INDEX_STEP`). **Matching** (amended 2026-09-23 at
    the R1 code review, spec §3.4). Content comes first: an existing import row with an identical
    trade is that sheet row, re-keyed if the sheet moved it. Candidates are compared on security,
    account, type, date, shares, price, fees and split. The content match runs in two passes, both
    over every sheet row (split at the R1 re-review):
    - 1a: the identical trade still holding its own key;
    - 1b: for the rows still unmatched, an identical trade at another key, earliest in replay order.

    A single sheet-order pass let an earlier row, made identical to a later one by a typo fix,
    claim the later row while it sat unchanged at its own key. Next, the same key with the same
    security, account and type is an in-place edit. Every other sheet row is created and every
    other import row is deleted. Moving keys are cleared (and gone rows deleted) in one flush before
    any key is written. A re-key counts as an update, sampled
    `position_transactions[<new>]: kept (was <old>)`. **An import row with a NULL `import_key`**
    (only reachable by hand-built rows) can match by content, sampled `kept (had no sheet key)`.
    Otherwise the sync deletes it, sampled `position_transactions[id <id>]: deleted (no sheet key)`.
    The column is declared last on the model, where the migration's `add_column` puts it too.
12. **Account and category importer appends** start from `max(existing sort_order) + 1` (0 on an
    empty table), in sheet order. The applier no longer reads the parser's column index; the parser
    is untouched (§3.4).
13. **Two "importer never writes" pins** (`test_importer_never_writes_category_budgets`,
    `test_importer_never_writes_credit_card_tables`) relied on the import rewriting a category's
    `sort_order`. They keep their sharpness by seeding the name `"FOOD"`, which the import rewrites
    to `"Food"`.
14. **The TS `CreditCardIn.sort_order` becomes optional** (`sort_order?: number | null`) so R5 can
    create a card without one — the UI lanes add no `src/types/api.ts` edits of their own (§11). The
    other three create types were optional already and gain a one-line doc comment.
15. **`reorderTransactions(ids, owner)` takes `owner` as REQUIRED** (no `= null` default, unlike
    `fetchTransactions`): the server judges the ids against the scope's rows, so a forgotten scope
    should be a type error, not a 409.
16. **Serialized per list; the later request wins whole.** (Amended 2026-09-23 at the R1 code
    review, which reproduced the original "no row locking" rule merging two overlapping account
    reorders row by row into `B0 D0 A1 C3`, with a change batch whose Undo produced an order that
    never existed.) Every reorder route takes its list's transaction-scoped advisory lock —
    `services.ordering.order_lock(model)`, key `reorder:<table>` — as its FIRST statement. Every
    path that appends to the same list takes it before reading the max: the four creates without a
    `sort_order`, an account PATCH that changes `group` (it locks before reading the row, so the
    before-image is fresh too), the UI transaction create, and the importer (all three lists, once,
    at the start of its apply phase). Also the Activity card's Undo (`undo_batch`, added at the R1
    re-review): a batch touching `accounts` or `spending_categories` rows rewrites that list's
    numbers, so it takes those lists' locks. It takes them in `ORDERED_LISTS`' fixed order (ledger,
    accounts, spending categories — the importer's), and before the review-input table locks, so it
    can never deadlock against an import. A reorder that arrives while another is in flight waits,
    then reads what the first committed, so its batch logs fresh before-images. A change committed
    elsewhere before the read is still the 409 path. Renames and other edits and deletes do not take
    the lock: a write of theirs landing inside a reorder's few milliseconds stays the single-user
    posture `put_category_budget` documents.
17. **Test files.** One new test file per router (`test_reorder_accounts_api.py`,
    `…_categories_…`, `…_transactions_…`, `…_credit_cards_…`), plus `tests/ordering_helpers.py` (a
    flush listener that proves "only changed rows are written") and `tests/test_reorder_route_order.py`
    (pins "declared before the `/{id}` routes"). The route-order pin reads each module's own
    `router.routes`: FastAPI 0.141 mounts routers lazily, so `app.routes` is not a flat list.
    Added at the code review: `tests/test_reorder_serialization.py`, which holds decision 16's
    two-session races (`ordering_helpers.race`, `GatedSession`) and its lock-first pins
    (`ordering_helpers.recorded_sql`).
18. **No browser check in this lane.** R1 has no UI; §10's browser checks belong to the UI lanes and
    V. R1's live-data proof is the read-only `finance_realdata` census in Task 6, which shows the
    backfill's unique index will build on prod-shaped data.

## Contracts this lane publishes (R2, R3 and R5 build against them verbatim)

### Routes

All five are `PUT`, behind the routers' existing auth (401 without a bearer token), with body
`OrderIn { ids: list[int] }` where `1 ≤ len(ids) ≤ 10 000` (outside that range: FastAPI's own 422
validation body). `ids` is the list's COMPLETE new order. The checks run in this order:

1. an id repeated in `ids` → **422** `{"detail": "ids lists {id} more than once"}` (the first repeat
   in body order);
2. `set(ids)` differs from the set of rows the list holds → **409** with the route's stale sentence
   (below); nothing is written;
3. `ids` equals the current order → **200**, the list exactly as stored, nothing written, nothing
   logged, no `X-Change-Batch` header;
4. otherwise → **200**, renumbered, only rows whose number moved are written, one transaction.

| Method + path | Query | Rows `ids` must match | Renumber | 200 body | Header | Logged | 409 `detail` |
|---|---|---|---|---|---|---|---|
| `PUT /api/v1/net-worth/accounts/order` | — | every account, active and retired | `sort_order = 0…n−1` | `list[AccountOut]`, new order | `X-Change-Batch: <uuid>` when rows were logged | yes | `The accounts changed since this list was loaded — nothing was moved.` |
| `PUT /api/v1/spending/categories/order` | — | every category, active and retired | `sort_order = 0…n−1` | `list[CategoryOut]`, new order | `X-Change-Batch: <uuid>` when rows were logged | yes | `The spending categories changed since this list was loaded — nothing was moved.` |
| `PUT /api/v1/portfolio/transactions/order` | `owner` (optional; the grammar and 422s of `GET /portfolio/transactions`) | exactly the rows `GET /portfolio/transactions?owner=` returns | the visible rows fill the slots the visible rows hold, hidden rows stay; then `sort_index = 10, 20, …` over the whole ledger | `TransactionOrderOut` | none | no | `The transactions changed since this list was loaded — nothing was moved.` |
| `PUT /api/v1/credit-cards/order` | — | every card, active and inactive | `sort_order = 0…n−1` | `list[CreditCardOut]`, built exactly as `GET /credit-cards` builds it | none | no | `The cards changed since this list was loaded — nothing was moved.` |
| `PUT /api/v1/credit-cards/categories/order` | — | every reward category | `sort_order = 0…n−1` | `list[RewardCategoryOut]`, new order | none | no | `The reward categories changed since this list was loaded — nothing was moved.` |

Every `…/order` route is declared before its router's `/{id}` routes.

### Activity labels (the two logged routes, spec §8.4)

`{n}` is the size of the minimal moved set (`services.ordering.moved_ids`), not the number of rows
written — the first reorder normalizes every stored value, so a batch can hold more rows than moved.

| Case | Label |
|---|---|
| a parent moved with the components it carries (same `parent_account_id` AND same `group`), every other row keeping its order — however far it went (checked first) | `Moved account {parent name}` |
| else exactly one account moved (an adjacent swap names one of the two) | `Moved account {name}` |
| any other account move | `Reordered {n} accounts` |
| exactly one category moved | `Moved category {name}` |
| any other category move | `Reordered {n} categories` |

Undo is the existing `POST /api/v1/activity/batches/{batch_id}/undo` (label `Undid: {label}`). It
restores the exact previous `sort_order` values (ties and gaps included) and refuses with **409**
`Later changes touched these rows — undo those first` once a later logged write — a rename, another
reorder — touched a moved row.

### `TransactionOrderOut` and `PositionChangeOut` (`backend/app/schemas/portfolio.py`)

```python
class PositionChangeOut(BaseModel):
    security_id: int
    ticker: str
    account: str                    # the portfolio-account label (the position key)
    shares_before: Decimal          # quantized to 6 dp before it gets here; a string on the wire
    shares_after: Decimal
    cost_basis_before: Decimal      # quantized to 2 dp; a string on the wire
    cost_basis_after: Decimal
    realized_gl_before: Decimal     # quantized to 2 dp; a string on the wire
    realized_gl_after: Decimal
    warnings_added: list[str]


class TransactionOrderOut(BaseModel):
    transactions: list[TransactionOut]
    changed_positions: list[PositionChangeOut]
```

An example — the sell (id 41) of a "buy 10 @ 50, sell 4 @ 80" holding dragged above its buy (id 40):

```json
{
  "transactions": [
    {
      "id": 41,
      "security_id": 12,
      "account": "Mine",
      "type": "sell",
      "txn_date": null,
      "shares": "4.000000",
      "price": "80.0000",
      "fees": null,
      "split_factor": null,
      "sort_index": 10,
      "source": "ui",
      "notes": null
    },
    {
      "id": 40,
      "security_id": 12,
      "account": "Mine",
      "type": "buy",
      "txn_date": null,
      "shares": "10.000000",
      "price": "50.0000",
      "fees": null,
      "split_factor": null,
      "sort_index": 20,
      "source": "ui",
      "notes": null
    }
  ],
  "changed_positions": [
    {
      "security_id": 12,
      "ticker": "VOO",
      "account": "Mine",
      "shares_before": "6.000000",
      "shares_after": "6.000000",
      "cost_basis_before": "300.00",
      "cost_basis_after": "500.00",
      "realized_gl_before": "120.00",
      "realized_gl_after": "320.00",
      "warnings_added": ["txn 41: sell with no held shares"]
    }
  ]
}
```

- `transactions` holds the rows the caller's scope shows, in the new order, as `TransactionOut`
  (`sort_index` already renumbered).
- `account` is the portfolio-account label (the position key). Shares are 6-dp strings; cost basis
  and realized gain are 2-dp strings; a quantized zero is never negative.
- A position is listed when its quantized shares, cost basis or realized gain differ between the
  fold of the old order and the fold of the new one, or when its warnings gained a line;
  `warnings_added` holds exactly the new lines, in fold order. `[]` when no holding re-folded.
- The list is ordered by `(ticker, account)`. `import_key` is NOT on `TransactionOut`.

### Create / append defaults (spec §3.3)

| Request | `sort_order` omitted or `null` | explicit number |
|---|---|---|
| `POST /net-worth/accounts` (`AccountCreate`) | `coalesce(max(accounts.sort_order), −1) + 1` | honoured (0 ≤ n ≤ 1 000 000) |
| `POST /spending/categories` (`CategoryCreate`) | `coalesce(max(spending_categories.sort_order), −1) + 1` | honoured |
| `POST /credit-cards/categories` (`RewardCategoryCreate`) | `coalesce(max(reward_categories.sort_order), −1) + 1` | honoured |
| `POST /credit-cards` (`CreditCardIn`) | `coalesce(max(credit_cards.sort_order), −1) + 1` | honoured |
| `PATCH /credit-cards/{id}` (`CreditCardIn`, full replace) | the stored value is KEPT | honoured |
| `PATCH /net-worth/accounts/{id}` that changes `group` | appended (`max + 1` over all accounts), in the same change batch as the group change | honoured |

### TypeScript types (`src/types/api.ts`, right after `TransactionUpdate`)

```ts
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
```

`CreditCardIn.sort_order` becomes `sort_order?: number | null` (omit it: a create appends, an edit
keeps the stored value).

### TypeScript functions

```ts
// src/api/netWorth.ts
export async function reorderAccounts(ids: number[]): Promise<{ data: AccountOut[]; batchId: string | null }>
// src/api/spending.ts
export async function reorderCategories(ids: number[]): Promise<{ data: CategoryOut[]; batchId: string | null }>
// src/api/portfolio.ts — OwnerScope is `number | 'joint' | null`, the type fetchTransactions takes
export function reorderTransactions(ids: number[], owner: OwnerScope): Promise<TransactionOrderOut>
// src/api/creditCards.ts
export function reorderCreditCards(ids: number[]): Promise<CreditCardOut[]>
export function reorderRewardCategories(ids: number[]): Promise<RewardCategoryOut[]>
```

- All five send `PUT` with body `JSON.stringify({ ids })`, to the route paths above minus `/api/v1`
  (which `client.ts` prepends).
- `reorderTransactions` builds its query with `portfolio.ts`'s own `ownerQuery(owner, '?')`: `null`
  sends no `owner` param at all.
- `batchId` is `headers.get('x-change-batch')` (`null` when nothing was logged).
- Cache invalidation is inherited from the existing `MUTATION_FAMILIES` prefixes (`/net-worth`,
  `/spending`, `/portfolio`, `/credit-cards`); nothing is added to `client.ts`.
- Failures surface as `ApiError` with the server's sentence as `message` and the HTTP status as
  `status` — a 409 means "reload the list" (spec §8.3).

---

## File map

| File | Change | Tasks |
|---|---|---|
| `backend/app/services/ordering.py` | create | 1, 5, 8 |
| `backend/tests/test_ordering_service.py` | create | 1, 5, 8 |
| `backend/app/schemas/ordering.py` | create | 2 |
| `backend/tests/test_schemas_ordering.py` | create | 2 |
| `backend/tests/ordering_helpers.py` | create | 3 |
| `backend/tests/test_reorder_route_order.py` | create | 3, 4, 8, 9 |
| `backend/tests/test_changelog_pin.py` | modify | 3, 4 |
| `backend/app/api/net_worth.py` | modify | 3, 5 |
| `backend/tests/test_reorder_accounts_api.py` | create | 3, 5 |
| `backend/app/api/spending.py` | modify | 4, 5 |
| `backend/tests/test_reorder_categories_api.py` | create | 4, 5 |
| `backend/app/schemas/net_worth.py`, `backend/app/schemas/spending.py` | modify | 5 |
| `backend/app/models/portfolio.py` | modify | 6 |
| `backend/alembic/versions/20260923_0900_f12026092301_position_transactions_import_key.py` | create | 6 |
| `backend/tests/test_models_portfolio.py` | modify | 6 |
| `backend/app/importer/apply.py` | modify | 7 |
| `backend/tests/test_importer_apply.py` | modify | 7 |
| `backend/app/schemas/portfolio.py` | modify | 8 |
| `backend/app/api/portfolio.py` | modify | 8 |
| `backend/tests/test_reorder_transactions_api.py` | create | 8 |
| `backend/app/schemas/credit_cards.py`, `backend/app/api/credit_cards.py` | modify | 9 |
| `backend/tests/test_reorder_credit_cards_api.py` | create | 9 |
| `src/types/api.ts`, `src/api/netWorth.ts`, `src/api/spending.ts`, `src/api/portfolio.ts`, `src/api/creditCards.ts` | modify | 10 |
| `src/api/netWorth.test.ts`, `src/api/spending.test.ts`, `src/api/portfolio.test.ts` | modify | 10 |
| `src/api/creditCards.test.ts` | create | 10 |
| this plan (the Results section) | modify | 11 |

Line numbers below are the BASE file's (`feat/reorder-base` @b3a55d2); they shift as earlier
tasks land — find the quoted anchor text, not the number.

---

## Task 0 — preflight

- [ ] **Step 1: Confirm the worktree, the branch and the interpreter**

```bash
cd C:/Users/edyli/personal-finance-dashboard/.worktrees/reorder-r1 && git status --short --branch && git log --oneline -1
cd C:/Users/edyli/personal-finance-dashboard/.worktrees/reorder-r1/backend && C:/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe -c "import app; print(app.__file__)"
```

Expected: `## feat/reorder-backend` with nothing listed under it (except, possibly,
`?? node_modules` — the controller's symlink: leave it untracked; every `git add` in this plan names
its files, never `-A`); the tip of `feat/reorder-base`; and
`C:\Users\edyli\personal-finance-dashboard\.worktrees\reorder-r1\backend\app\__init__.py`. Any other
path: stop — the tests would run another checkout's code.

- [ ] **Step 2: Baseline the files this lane changes most**

Run (cwd `backend`):
`FINANCE_TEST_DB=finance_test_reorder_r1 $PY -m pytest tests/test_changelog_pin.py tests/test_importer_apply.py tests/test_models_portfolio.py -q`

Expected: `57 passed` (2 + 48 + 7). Nothing is committed in Task 0.

---

## Task 1 — the ordering service's pure helpers (spec §3.1, §8.3)

**Files:**
- Create: `backend/app/services/ordering.py`
- Create: `backend/tests/test_ordering_service.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_ordering_service.py`:

```python
"""services.ordering — the reorder endpoints' pure arithmetic (2026-09-23 drag-to-reorder
spec §3.1). Route behaviour lives in each router's own test file."""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.services.ordering import (
    STALE_ACCOUNTS,
    STALE_CARDS,
    STALE_CATEGORIES,
    STALE_REWARD_CATEGORIES,
    STALE_TRANSACTIONS,
    check_permutation,
    moved_ids,
    renumber,
    subset_in_slots,
)

# ── the §8.3 sentences ───────────────────────────────────────────────────────────────


def test_the_stale_sentences_are_the_spec_copy():
    assert STALE_ACCOUNTS == "The accounts changed since this list was loaded — nothing was moved."
    assert STALE_CATEGORIES == (
        "The spending categories changed since this list was loaded — nothing was moved."
    )
    assert STALE_TRANSACTIONS == (
        "The transactions changed since this list was loaded — nothing was moved."
    )
    assert STALE_CARDS == "The cards changed since this list was loaded — nothing was moved."
    assert STALE_REWARD_CATEGORIES == (
        "The reward categories changed since this list was loaded — nothing was moved."
    )


# ── check_permutation ────────────────────────────────────────────────────────────────


def test_check_permutation_accepts_any_order_of_exactly_the_rows():
    check_permutation([1, 2, 3], [3, 1, 2], stale_detail="stale")
    check_permutation([1, 2, 3], [1, 2, 3], stale_detail="stale")


def test_check_permutation_422s_a_duplicate_naming_it():
    with pytest.raises(HTTPException) as caught:
        check_permutation([1, 2, 3], [3, 1, 3], stale_detail="stale")
    assert caught.value.status_code == 422
    assert caught.value.detail == "ids lists 3 more than once"


def test_a_duplicate_is_reported_before_a_stale_set():
    # [1, 1, 99] is both repeated and foreign; the malformed body is the first thing to say.
    with pytest.raises(HTTPException) as caught:
        check_permutation([1, 2], [1, 1, 99], stale_detail="stale")
    assert (caught.value.status_code, caught.value.detail) == (422, "ids lists 1 more than once")


@pytest.mark.parametrize(
    "ids", [[1, 2], [1, 2, 3, 4], [1, 2, 4]], ids=["missing", "extra", "swapped"]
)
def test_check_permutation_409s_a_different_set_with_the_lists_sentence(ids):
    with pytest.raises(HTTPException) as caught:
        check_permutation([1, 2, 3], ids, stale_detail=STALE_ACCOUNTS)
    assert caught.value.status_code == 409
    assert caught.value.detail == STALE_ACCOUNTS


# ── subset_in_slots ──────────────────────────────────────────────────────────────────


def test_subset_in_slots_keeps_hidden_rows_where_they_are():
    # Visible 2, 4, 5 hold slots 1, 3, 4; the new visible order [5, 2, 4] fills exactly
    # those slots, and hidden 1 and 3 never move.
    assert subset_in_slots([1, 2, 3, 4, 5], [5, 2, 4]) == [1, 5, 3, 2, 4]


def test_subset_in_slots_with_everything_visible_is_the_new_order():
    assert subset_in_slots([1, 2, 3], [3, 1, 2]) == [3, 1, 2]


@pytest.mark.parametrize("visible", [[2, 2], [2, 9]], ids=["repeated", "foreign"])
def test_subset_in_slots_refuses_rows_that_are_not_a_subset(visible):
    with pytest.raises(ValueError):
        subset_in_slots([1, 2, 3], visible)


# ── renumber ─────────────────────────────────────────────────────────────────────────


class Recorder:
    """A row that remembers every attribute SET — renumber must not set an unchanged one."""

    def __init__(self, id_: int, value: int) -> None:
        object.__setattr__(self, "id", id_)
        object.__setattr__(self, "value", value)
        object.__setattr__(self, "sets", 0)

    def __setattr__(self, name: str, value: object) -> None:
        object.__setattr__(self, "sets", self.sets + 1)
        object.__setattr__(self, name, value)


def test_renumber_writes_only_the_rows_whose_value_moves():
    rows = [Recorder(1, 0), Recorder(2, 5), Recorder(3, 2)]
    changed = renumber(rows, "value", start=0, step=1)
    assert [(row.id, old, new) for row, old, new in changed] == [(2, 5, 1)]
    assert [row.value for row in rows] == [0, 1, 2]
    assert [row.sets for row in rows] == [0, 1, 0]  # rows 1 and 3 were never touched


def test_renumber_steps_from_start():
    rows = [SimpleNamespace(sort_index=7), SimpleNamespace(sort_index=20)]
    changed = renumber(rows, "sort_index", start=10, step=10)
    assert [row.sort_index for row in rows] == [10, 20]
    assert [(old, new) for _, old, new in changed] == [(7, 10)]


# ── moved_ids ────────────────────────────────────────────────────────────────────────


def test_moved_ids_is_empty_for_an_unchanged_order():
    assert moved_ids([1, 2, 3], [1, 2, 3]) == []


def test_moved_ids_names_a_single_row_moved_up():
    assert moved_ids([1, 2, 3, 4, 5], [4, 1, 2, 3, 5]) == [4]


def test_moved_ids_names_a_single_row_moved_down():
    assert moved_ids([1, 2, 3, 4, 5], [2, 3, 4, 5, 1]) == [1]


def test_moved_ids_on_an_adjacent_swap_names_one_row_the_later_one():
    # Ties keep the earliest rows of the new order: 2 is kept, so 1 is "the one that moved"
    # (it did — one place down — exactly as 2 moved one place up).
    assert moved_ids([1, 2, 3], [2, 1, 3]) == [1]


def test_moved_ids_names_a_moved_block():
    # 4 and 5 travel together to the top: the minimal explanation is the block itself.
    assert moved_ids([1, 2, 3, 4, 5], [4, 5, 1, 2, 3]) == [4, 5]


def test_moved_ids_prefers_the_smaller_side_of_a_block_move():
    # A three-row block moving down past ONE row is explained by that one row moving up.
    assert moved_ids([9, 1, 2, 3], [1, 2, 3, 9]) == [9]


def test_moved_ids_on_a_reversal_keeps_the_first_row_of_the_new_order():
    assert moved_ids([1, 2, 3], [3, 2, 1]) == [2, 1]
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `FINANCE_TEST_DB=finance_test_reorder_r1 $PY -m pytest tests/test_ordering_service.py -q`

Expected: `ERROR collecting tests/test_ordering_service.py` with
`ModuleNotFoundError: No module named 'app.services.ordering'`.

- [ ] **Step 3: Write the service**

Create `backend/app/services/ordering.py`:

```python
"""The reorder endpoints' arithmetic (2026-09-23 drag-to-reorder spec §3.1).

Pure: no session and no I/O. `check_permutation` raises the API's own 422/409 the way
services.money raises its 422s — those sentences ARE the endpoints' vocabulary. Anything
that needs the database is BUILT here and awaited by the router.
"""

from bisect import bisect_left
from collections.abc import Sequence

from fastapi import HTTPException

# §8.3 — the 409 a stale list earns. The client shows it in toast.error and reloads, so the
# reader is already looking at the current rows when they read it.
STALE_ACCOUNTS = "The accounts changed since this list was loaded — nothing was moved."
STALE_CATEGORIES = "The spending categories changed since this list was loaded — nothing was moved."
STALE_TRANSACTIONS = "The transactions changed since this list was loaded — nothing was moved."
STALE_CARDS = "The cards changed since this list was loaded — nothing was moved."
STALE_REWARD_CATEGORIES = (
    "The reward categories changed since this list was loaded — nothing was moved."
)


def check_permutation(current_ids: Sequence[int], ids: Sequence[int], *, stale_detail: str) -> None:
    """422 when `ids` names a row twice; 409 with the list's stale sentence when it names a
    different set of rows than `current_ids` (one was added, deleted or re-scoped since the
    page loaded). Order is not judged — any order of exactly the right rows is valid."""
    seen: set[int] = set()
    for row_id in ids:
        if row_id in seen:
            raise HTTPException(status_code=422, detail=f"ids lists {row_id} more than once")
        seen.add(row_id)
    if seen != set(current_ids):
        raise HTTPException(status_code=409, detail=stale_detail)


def subset_in_slots(full_ids: Sequence[int], visible_new_order: Sequence[int]) -> list[int]:
    """The owner-scoped case: the visible rows, in their new order, fill the positions the
    visible rows already occupy in the full list, and every hidden row keeps its own
    position. `visible_new_order` must name distinct rows of `full_ids`."""
    visible = set(visible_new_order)
    slots = [index for index, row_id in enumerate(full_ids) if row_id in visible]
    if len(visible) != len(visible_new_order) or len(slots) != len(visible_new_order):
        raise ValueError("visible_new_order must name distinct rows of full_ids")
    merged = list(full_ids)
    for slot, row_id in zip(slots, visible_new_order, strict=True):
        merged[slot] = row_id
    return merged


def renumber[R](
    rows_in_order: Sequence[R], attr: str, *, start: int, step: int
) -> list[tuple[R, int, int]]:
    """Write start, start + step, … onto `attr` in list order, but only where the stored
    value differs — an unchanged row is never touched, so it is never flushed. Returns the
    rows it changed as (row, old, new), in list order."""
    changed: list[tuple[R, int, int]] = []
    for index, row in enumerate(rows_in_order):
        new = start + index * step
        old = getattr(row, attr)
        if old != new:
            setattr(row, attr, new)
            changed.append((row, old, new))
    return changed


def moved_ids(old_order: Sequence[int], new_order: Sequence[int]) -> list[int]:
    """The fewest rows whose moves explain old_order -> new_order: every row outside a
    longest increasing subsequence of old positions, read in new order.

    Ties keep the EARLIEST rows of the new order: of all longest subsequences, the kept one
    is the lexicographically smallest by new-order index. An adjacent swap [a, b] -> [b, a]
    therefore names `a` — and "moved a" is as true as "moved b". Returned in new order;
    empty when the order is unchanged. O(n log n)."""
    position = {row_id: index for index, row_id in enumerate(old_order)}
    values = [position[row_id] for row_id in new_order]
    # longest[i]: the longest increasing run of values that STARTS at i, found right to
    # left as the patience-sorting LIS of the reversed, negated sequence.
    longest = [0] * len(values)
    tails: list[int] = []
    for index in range(len(values) - 1, -1, -1):
        slot = bisect_left(tails, -values[index])
        if slot == len(tails):
            tails.append(-values[index])
        else:
            tails[slot] = -values[index]
        longest[index] = slot + 1
    # Greedy, front to back: take the first row that can still start a run of the length
    # left to find. A row with a LONGER run after the kept prefix cannot exist (the whole
    # subsequence would beat the maximum), so "== need" is exact.
    need = len(tails)
    floor = -1
    kept: set[int] = set()
    for index, value in enumerate(values):
        if need and longest[index] == need and value > floor:
            kept.add(index)
            floor = value
            need -= 1
    return [row_id for index, row_id in enumerate(new_order) if index not in kept]
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `FINANCE_TEST_DB=finance_test_reorder_r1 $PY -m pytest tests/test_ordering_service.py -q`

Expected: `20 passed`.

- [ ] **Step 5: Lint and commit**

```bash
$PY -m ruff check app tests && $PY -m ruff format --check app tests
git add app/services/ordering.py tests/test_ordering_service.py
git commit -m "feat(ordering): pure reorder helpers — permutation check, slot-preserving subset, renumber, minimal moved set"
```

---

## Task 2 — `OrderIn`, the one body every reorder route takes (spec §3.2)

**Files:**
- Create: `backend/app/schemas/ordering.py`
- Create: `backend/tests/test_schemas_ordering.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_schemas_ordering.py`:

```python
"""OrderIn — the one body every reorder endpoint takes (2026-09-23 drag-to-reorder spec §3.2)."""

import pytest
from pydantic import ValidationError

from app.schemas.ordering import OrderIn


def test_order_in_takes_one_to_ten_thousand_ids():
    assert OrderIn(ids=[3, 1, 2]).ids == [3, 1, 2]
    assert len(OrderIn(ids=list(range(10_000))).ids) == 10_000


@pytest.mark.parametrize("ids", [[], list(range(10_001))], ids=["empty", "over the cap"])
def test_order_in_refuses_an_empty_or_runaway_list(ids):
    with pytest.raises(ValidationError):
        OrderIn(ids=ids)


def test_order_in_leaves_unknown_ids_to_the_permutation_check():
    # No int32 bound on purpose: an id the table does not hold reads as a stale list (409),
    # and no route ever hands a body id to SQL.
    assert OrderIn(ids=[0, -1, 10**12]).ids == [0, -1, 10**12]
```

- [ ] **Step 2: Run and watch it fail**

Run: `FINANCE_TEST_DB=finance_test_reorder_r1 $PY -m pytest tests/test_schemas_ordering.py -q`

Expected: `ERROR collecting tests/test_schemas_ordering.py` with
`ModuleNotFoundError: No module named 'app.schemas.ordering'`.

- [ ] **Step 3: Write the schema**

Create `backend/app/schemas/ordering.py`:

```python
"""The one request body every reorder endpoint takes (2026-09-23 drag-to-reorder spec §3.2)."""

from pydantic import BaseModel, Field


class OrderIn(BaseModel):
    """`ids` is the list's COMPLETE new order: every row the endpoint lists, each once. The
    length bounds keep a runaway body away from the permutation check; the ids themselves
    are judged there (services.ordering.check_permutation: 422 duplicate, 409 stale), so an
    unknown id reads as a stale list rather than a malformed request."""

    ids: list[int] = Field(min_length=1, max_length=10_000)
```

- [ ] **Step 4: Run and watch it pass**

Run: `FINANCE_TEST_DB=finance_test_reorder_r1 $PY -m pytest tests/test_schemas_ordering.py -q`

Expected: `4 passed`.

- [ ] **Step 5: Lint and commit**

```bash
$PY -m ruff check app tests && $PY -m ruff format --check app tests
git add app/schemas/ordering.py tests/test_schemas_ordering.py
git commit -m "feat(ordering): OrderIn, the one body every reorder route takes"
```

---

## Task 3 — `PUT /net-worth/accounts/order`, logged (spec §3.2, §8.3, §8.4)

**Files:**
- Modify: `backend/tests/test_changelog_pin.py:18-24` (the `net_worth.py` set of `LOGGED`)
- Create: `backend/tests/ordering_helpers.py`
- Create: `backend/tests/test_reorder_route_order.py`
- Create: `backend/tests/test_reorder_accounts_api.py`
- Modify: `backend/app/api/net_worth.py:12-37` (imports) and `:93-96` (insert after `list_accounts`)

- [ ] **Step 1: Pin the new write path as logged**

In `backend/tests/test_changelog_pin.py`, replace:

```python
    "net_worth.py": {
        "create_account",
        "update_account",
        "delete_account",
        "put_month",
        "delete_month",
    },
```

with:

```python
    "net_worth.py": {
        "create_account",
        "update_account",
        "delete_account",
        "reorder_accounts",
        "put_month",
        "delete_month",
    },
```

- [ ] **Step 2: Add the flush helper the reorder tests share**

Create `backend/tests/ordering_helpers.py`:

```python
"""Shared by the reorder-route tests (2026-09-23 drag-to-reorder spec §3.7). "Only changed
rows are written" is a claim about the FLUSH, so the proof listens to the flush."""

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession


@contextmanager
def flushed_updates(db: AsyncSession, model: type) -> Iterator[set[int]]:
    """Inside the block, collect the id of every `model` row the shared test session
    flushes as modified. A row lands in `session.dirty` only when one of its attributes was
    SET, and services.ordering.renumber sets only the rows whose value moves — so this set
    is exactly the rows a reorder request wrote. Attached to the sync session underneath
    the AsyncSession (where ORM events fire) and removed in `finally`, like conftest's
    forbid_writes guard."""
    written: set[int] = set()

    def capture(session, flush_context, instances):
        written.update(row.id for row in session.dirty if isinstance(row, model))

    sync_session = db.sync_session
    event.listen(sync_session, "before_flush", capture)
    try:
        yield written
    finally:
        event.remove(sync_session, "before_flush", capture)
```

- [ ] **Step 3: Write the route-placement pin (accounts only for now)**

Create `backend/tests/test_reorder_route_order.py`:

```python
"""Route placement for the reorder PUTs (2026-09-23 drag-to-reorder spec §3.2): each
`…/order` path is declared BEFORE its router's `/{id}` routes, so a PUT on `/{id}` added
later can never shadow it (routes match in declaration order). Read off each module's own
router: the app mounts routers lazily, so `app.routes` is not a flat list."""

import pytest
from fastapi.routing import APIRoute

from app.api import net_worth

ORDER_ROUTES = ((net_worth.router, "/net-worth/accounts/order"),)


@pytest.mark.parametrize(("router", "path"), ORDER_ROUTES, ids=[path for _, path in ORDER_ROUTES])
def test_each_order_route_is_a_put_declared_before_its_id_routes(router, path):
    routes = [route for route in router.routes if isinstance(route, APIRoute)]
    [order_index] = [index for index, route in enumerate(routes) if route.path == path]
    assert routes[order_index].methods == {"PUT"}
    prefix = path.removesuffix("/order") + "/{"
    id_indexes = [index for index, route in enumerate(routes) if route.path.startswith(prefix)]
    assert id_indexes, "no /{id} routes found — the pin would pin nothing"
    assert order_index < min(id_indexes)
```

- [ ] **Step 4: Write the failing route tests**

Create `backend/tests/test_reorder_accounts_api.py` (Task 5 appends the append-default tests to
this file):

```python
"""PUT /net-worth/accounts/order and the accounts' append defaults (2026-09-23
drag-to-reorder spec §3.2, §3.3, §8.3, §8.4). The route is change-logged, so its Undo is
proven end to end through the Activity card's own endpoint."""

from uuid import UUID

import pytest
from sqlalchemy import select

from app.models import Account, ChangeLog
from app.services.changelog import OVERLAP_REFUSAL
from tests.ordering_helpers import flushed_updates

NW = "/api/v1/net-worth"
ORDER = f"{NW}/accounts/order"
ACTIVITY = "/api/v1/activity"
STALE = "The accounts changed since this list was loaded — nothing was moved."


async def seed_accounts(db) -> dict[str, int]:
    """Prod's shape (spec §0): workbook column indexes with a tie (3/3) and gaps, and a
    retired row. GET order is (sort_order, id): Checking, Savings, Old Card, Brokerage."""
    rows = [
        Account(name="Checking", slug="checking", group="cash", sort_order=3),
        Account(name="Savings", slug="savings", group="cash", sort_order=3),
        Account(
            name="Old Card", slug="old-card", group="liability", sort_order=29, is_active=False
        ),
        Account(name="Brokerage", slug="brokerage", group="taxable", sort_order=55),
    ]
    db.add_all(rows)
    await db.commit()
    return {row.name: row.id for row in rows}


async def seed_numbered(db, *names: str, group: str = "cash") -> list[int]:
    """Already-normalized rows 0…n−1, so a move's written set is easy to predict."""
    rows = [
        Account(name=name, slug=name.lower(), group=group, sort_order=index)
        for index, name in enumerate(names)
    ]
    db.add_all(rows)
    await db.commit()
    return [row.id for row in rows]


async def stored_orders(db) -> list[tuple[int, int]]:
    rows = await db.execute(select(Account.id, Account.sort_order).order_by(Account.id))
    return [(row.id, row.sort_order) for row in rows]


async def test_reorder_requires_auth(client):
    assert (await client.put(ORDER, json={"ids": [1]})).status_code == 401


async def test_reorder_renumbers_every_row_and_answers_in_the_new_order(auth_client, db):
    ids = await seed_accounts(db)
    new = [ids["Brokerage"], ids["Checking"], ids["Savings"], ids["Old Card"]]
    resp = await auth_client.put(ORDER, json={"ids": new})
    assert resp.status_code == 200, resp.text
    assert [(a["id"], a["sort_order"]) for a in resp.json()] == [
        (account_id, index) for index, account_id in enumerate(new)
    ]
    assert resp.headers["x-change-batch"]
    listed = (await auth_client.get(f"{NW}/accounts")).json()
    assert [a["id"] for a in listed] == new  # the follow-up GET agrees with the answer


async def test_an_unchanged_order_writes_and_logs_nothing(auth_client, db):
    ids = await seed_accounts(db)
    current = [ids["Checking"], ids["Savings"], ids["Old Card"], ids["Brokerage"]]
    with flushed_updates(db, Account) as written:
        resp = await auth_client.put(ORDER, json={"ids": current})
    assert resp.status_code == 200, resp.text
    # Not even normalized: the tie and the gaps stay until something actually moves.
    assert [(a["id"], a["sort_order"]) for a in resp.json()] == [
        (ids["Checking"], 3),
        (ids["Savings"], 3),
        (ids["Old Card"], 29),
        (ids["Brokerage"], 55),
    ]
    assert "x-change-batch" not in resp.headers
    assert written == set()
    assert (await db.execute(select(ChangeLog))).scalars().all() == []


@pytest.mark.parametrize("shape", ["missing", "extra", "retired left out"])
async def test_a_stale_list_409s_with_the_sentence_and_moves_nothing(auth_client, db, shape):
    ids = await seed_accounts(db)
    before = await stored_orders(db)
    body = {
        "missing": [ids["Brokerage"], ids["Checking"], ids["Old Card"]],
        "extra": [ids["Brokerage"], ids["Checking"], ids["Savings"], ids["Old Card"], 999],
        # Retired rows keep their slots and must be sent too (spec §9).
        "retired left out": [ids["Brokerage"], ids["Checking"], ids["Savings"]],
    }[shape]
    resp = await auth_client.put(ORDER, json={"ids": body})
    assert resp.status_code == 409
    assert resp.json()["detail"] == STALE
    assert await stored_orders(db) == before
    assert (await db.execute(select(ChangeLog))).scalars().all() == []


async def test_a_repeated_id_422s_naming_it(auth_client, db):
    ids = await seed_accounts(db)
    body = [ids["Checking"], ids["Checking"], ids["Savings"], ids["Old Card"], ids["Brokerage"]]
    resp = await auth_client.put(ORDER, json={"ids": body})
    assert resp.status_code == 422
    assert resp.json()["detail"] == f"ids lists {ids['Checking']} more than once"


async def test_an_empty_list_is_a_malformed_body(auth_client, db):
    await seed_accounts(db)
    assert (await auth_client.put(ORDER, json={"ids": []})).status_code == 422


async def test_only_rows_whose_number_moves_are_written_and_logged(auth_client, db):
    a, b, c, d = await seed_numbered(db, "A", "B", "C", "D")
    with flushed_updates(db, Account) as written:
        resp = await auth_client.put(ORDER, json={"ids": [a, b, d, c]})
    assert resp.status_code == 200, resp.text
    assert written == {c, d}
    logged = (await db.execute(select(ChangeLog))).scalars().all()
    assert sorted((r.pk["id"], r.before["sort_order"], r.after["sort_order"]) for r in logged) == [
        (c, 2, 3),
        (d, 3, 2),
    ]
    assert {(r.op, r.table_name, r.source) for r in logged} == {("update", "accounts", "ui")}
    assert {r.batch_id for r in logged} == {UUID(resp.headers["x-change-batch"])}


async def test_the_label_names_a_single_moved_account(auth_client, db):
    a, b, c, d = await seed_numbered(db, "A", "B", "C", "D")
    await auth_client.put(ORDER, json={"ids": [d, a, b, c]})
    labels = set((await db.execute(select(ChangeLog.label))).scalars())
    assert labels == {"Moved account D"}


async def test_the_label_names_a_parent_moved_with_the_components_it_carries(auth_client, db):
    """P carries K (same group). X is also P's component but sits in another group, so the
    Settings table does not nest it under P and it is not part of P's drag."""
    a, b, c = await seed_numbered(db, "A", "B", "C")
    parent = Account(name="P", slug="p", group="cash", sort_order=3)
    db.add(parent)
    await db.flush()
    component = Account(
        name="K",
        slug="k",
        group="cash",
        sort_order=4,
        is_component=True,
        parent_account_id=parent.id,
    )
    elsewhere = Account(
        name="X",
        slug="x",
        group="pre_tax",
        sort_order=5,
        is_component=True,
        parent_account_id=parent.id,
    )
    db.add_all([component, elsewhere])
    await db.commit()
    resp = await auth_client.put(
        ORDER, json={"ids": [parent.id, component.id, a, b, c, elsewhere.id]}
    )
    assert resp.status_code == 200, resp.text
    labels = set((await db.execute(select(ChangeLog.label))).scalars())
    assert labels == {"Moved account P"}


async def test_the_label_counts_the_minimal_moved_set_otherwise(auth_client, db):
    a, b, c, d, e = await seed_numbered(db, "A", "B", "C", "D", "E")
    # Two unrelated swaps: the kept run is B, D, E, so A and C are "the ones that moved".
    await auth_client.put(ORDER, json={"ids": [b, a, d, c, e]})
    labels = set((await db.execute(select(ChangeLog.label))).scalars())
    assert labels == {"Reordered 2 accounts"}


async def test_undo_puts_back_the_exact_previous_numbers(auth_client, db):
    ids = await seed_accounts(db)
    new = [ids["Brokerage"], ids["Old Card"], ids["Savings"], ids["Checking"]]
    moved = await auth_client.put(ORDER, json={"ids": new})
    assert moved.status_code == 200, moved.text
    undo = await auth_client.post(f"{ACTIVITY}/batches/{moved.headers['x-change-batch']}/undo")
    assert undo.status_code == 200, undo.text
    assert undo.json()["label"] == "Undid: Reordered 3 accounts"
    listed = (await auth_client.get(f"{NW}/accounts")).json()
    # The tie and the gaps come back exactly — the undo replays the before images.
    assert [(a["id"], a["sort_order"]) for a in listed] == [
        (ids["Checking"], 3),
        (ids["Savings"], 3),
        (ids["Old Card"], 29),
        (ids["Brokerage"], 55),
    ]


async def test_a_later_edit_of_a_moved_row_makes_the_undo_refuse(auth_client, db):
    ids = await seed_accounts(db)
    new = [ids["Brokerage"], ids["Checking"], ids["Savings"], ids["Old Card"]]
    moved = await auth_client.put(ORDER, json={"ids": new})
    batch_id = moved.headers["x-change-batch"]
    # Brokerage went 55 -> 0, so its row is in the reorder's batch; the rename logs it again.
    renamed = await auth_client.patch(
        f"{NW}/accounts/{ids['Brokerage']}", json={"name": "Taxable Brokerage"}
    )
    assert renamed.status_code == 200, renamed.text
    refused = await auth_client.post(f"{ACTIVITY}/batches/{batch_id}/undo")
    assert refused.status_code == 409
    assert refused.json()["detail"] == OVERLAP_REFUSAL
    listed = (await auth_client.get(f"{NW}/accounts")).json()
    assert [a["id"] for a in listed] == new  # nothing half-undone
```

- [ ] **Step 5: Run and watch them fail**

Run: `FINANCE_TEST_DB=finance_test_reorder_r1 $PY -m pytest tests/test_changelog_pin.py tests/test_reorder_route_order.py tests/test_reorder_accounts_api.py -q`

Expected: `16 failed, 1 passed` —
- `test_every_write_path_in_the_two_routers_is_logged_or_exempt` —
  `AssertionError: net_worth.py: listed paths missing or no longer writing: {'reorder_accounts'}`;
- the route-order pin — `ValueError: not enough values to unpack (expected 1, got 0)`;
- all 14 account tests — the PUT answers `405 Method Not Allowed` (the path only matches the
  PATCH/DELETE `/accounts/{account_id}` routes): `assert 405 == 401`, `assert 405 == 409`,
  `AssertionError: {"detail":"Method Not Allowed"}`, `KeyError: 'x-change-batch'`, and empty label
  sets.

- [ ] **Step 6: Write the route**

In `backend/app/api/net_worth.py`, add the body import right after the `app.schemas.net_worth`
import block (base line 26, after its closing `)`):

```python
from app.schemas.ordering import OrderIn
```

and the service import right after the `app.services.net_worth_calc` import block (base line 37,
after its closing `)`):

```python
from app.services.ordering import (
    STALE_ACCOUNTS,
    check_permutation,
    moved_ids,
    renumber,
)
```

Then insert, directly after `list_accounts` (base line 96) and before `@router.post("/accounts", …)`:

```python
def _reorder_label(accounts: list[Account], moved: list[int]) -> str:
    """The Activity label (2026-09-23 reorder spec §8.4). One account moved — alone, or a
    parent with exactly the components it carries — names it; anything else counts the
    minimal moved set. "Carries" is the Settings table's nesting: the components whose
    parent it is AND that sit in its group (nestComponents runs per group there)."""
    by_id = {account.id: account for account in accounts}
    if len(moved) == 1:
        return f"Moved account {by_id[moved[0]].name}"
    moved_set = set(moved)
    for account_id in moved:
        parent = by_id[account_id]
        carried = {
            other.id
            for other in accounts
            if other.parent_account_id == parent.id and other.group == parent.group
        }
        if moved_set == {parent.id} | carried:
            return f"Moved account {parent.name}"
    return f"Reordered {len(moved)} accounts"


@router.put("/accounts/order", response_model=list[AccountOut])
async def reorder_accounts(
    body: OrderIn,
    response: Response,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> list[Account]:
    """Drag-to-reorder (2026-09-23 spec §3.2): `ids` is EVERY account, retired included, in
    its new order. sort_order becomes 0…n−1 — the first reorder normalizes the workbook's
    column indexes — and only rows whose value moves are written, as ONE change batch the
    Activity card can undo. An unchanged order writes and logs nothing.

    Declared before the /accounts/{account_id} routes so a later PUT on that path can never
    shadow it."""
    accounts = list(
        (await db.execute(select(Account).order_by(Account.sort_order, Account.id))).scalars()
    )
    current = [account.id for account in accounts]
    check_permutation(current, body.ids, stale_detail=STALE_ACCOUNTS)
    if body.ids == current:
        return accounts
    by_id = {account.id: account for account in accounts}
    ordered = [by_id[account_id] for account_id in body.ids]
    before = {account.id: row_image(account) for account in accounts}
    for account, _old, _new in renumber(ordered, "sort_order", start=0, step=1):
        batch.record_update(account, before[account.id])
    batch.label = _reorder_label(accounts, moved_ids(current, body.ids))
    # The header only when rows were logged — the allocation routes' rule; batch_header
    # spells it the way the month DELETEs already do.
    response.headers.update(batch_header(await batch.commit()))
    return ordered
```

(`Response`, `select`, `ChangeBatch`, `change_batch`, `row_image` and `batch_header` are already
imported by this module.)

- [ ] **Step 7: Run and watch them pass**

Run: `FINANCE_TEST_DB=finance_test_reorder_r1 $PY -m pytest tests/test_changelog_pin.py tests/test_reorder_route_order.py tests/test_reorder_accounts_api.py -q`

Expected: `17 passed` (2 + 1 + 14). Then the neighbours this route shares code with:
`FINANCE_TEST_DB=finance_test_reorder_r1 $PY -m pytest tests/test_net_worth_api.py tests/test_changelog_routes.py tests/test_activity_api.py -q` — all pass.

- [ ] **Step 8: Lint and commit**

```bash
$PY -m ruff check app tests && $PY -m ruff format --check app tests
git add app/api/net_worth.py tests/test_changelog_pin.py tests/ordering_helpers.py tests/test_reorder_route_order.py tests/test_reorder_accounts_api.py
git commit -m "feat(ordering): PUT /net-worth/accounts/order — one change batch, §8.4 labels, Undo on the Activity card"
```

---

## Task 4 — `PUT /spending/categories/order`, logged (spec §3.2, §8.3, §8.4, §9)

**Files:**
- Modify: `backend/tests/test_changelog_pin.py:25-34` (the `spending.py` set of `LOGGED`)
- Modify: `backend/tests/test_reorder_route_order.py` (import and `ORDER_ROUTES`)
- Create: `backend/tests/test_reorder_categories_api.py`
- Modify: `backend/app/api/spending.py:12-45` (imports) and `:58-63` (insert after `list_categories`)

- [ ] **Step 1: Pin the new write path as logged**

In `backend/tests/test_changelog_pin.py`, in the `"spending.py"` set, replace:

```python
        "delete_category",
        "put_category_budget",
```

with:

```python
        "delete_category",
        "reorder_categories",
        "put_category_budget",
```

- [ ] **Step 2: Add the categories route to the placement pin**

In `backend/tests/test_reorder_route_order.py`, replace:

```python
from app.api import net_worth

ORDER_ROUTES = ((net_worth.router, "/net-worth/accounts/order"),)
```

with:

```python
from app.api import net_worth, spending

ORDER_ROUTES = (
    (net_worth.router, "/net-worth/accounts/order"),
    (spending.router, "/spending/categories/order"),
)
```

- [ ] **Step 3: Write the failing route tests**

Create `backend/tests/test_reorder_categories_api.py` (Task 5 appends the append-default test to
this file):

```python
"""PUT /spending/categories/order and the categories' append default (2026-09-23
drag-to-reorder spec §3.2, §3.3, §8.3, §8.4). Change-logged, so its Undo is proven through
the Activity card's own endpoint."""

from uuid import UUID

import pytest
from sqlalchemy import select

from app.models import ChangeLog, SpendingCategory
from app.services.changelog import OVERLAP_REFUSAL
from tests.ordering_helpers import flushed_updates

SP = "/api/v1/spending"
ORDER = f"{SP}/categories/order"
ACTIVITY = "/api/v1/activity"
STALE = "The spending categories changed since this list was loaded — nothing was moved."


async def seed_categories(db) -> dict[str, int]:
    """Workbook column indexes (prod's 2…20 shape) and a retired row. GET order is
    (sort_order, id): Food, Rent, Old, Travel."""
    rows = [
        SpendingCategory(name="Food", slug="food", sort_order=2),
        SpendingCategory(name="Rent", slug="rent", sort_order=3),
        SpendingCategory(name="Old", slug="old", sort_order=7, is_active=False),
        SpendingCategory(name="Travel", slug="travel", sort_order=20),
    ]
    db.add_all(rows)
    await db.commit()
    return {row.name: row.id for row in rows}


async def stored_orders(db) -> list[tuple[int, int]]:
    rows = await db.execute(
        select(SpendingCategory.id, SpendingCategory.sort_order).order_by(SpendingCategory.id)
    )
    return [(row.id, row.sort_order) for row in rows]


async def test_reorder_requires_auth(client):
    assert (await client.put(ORDER, json={"ids": [1]})).status_code == 401


async def test_reorder_renumbers_every_row_and_answers_in_the_new_order(auth_client, db):
    ids = await seed_categories(db)
    new = [ids["Travel"], ids["Food"], ids["Old"], ids["Rent"]]
    resp = await auth_client.put(ORDER, json={"ids": new})
    assert resp.status_code == 200, resp.text
    assert [(c["id"], c["sort_order"]) for c in resp.json()] == [
        (category_id, index) for index, category_id in enumerate(new)
    ]
    assert resp.headers["x-change-batch"]
    listed = (await auth_client.get(f"{SP}/categories")).json()
    assert [c["id"] for c in listed] == new


async def test_an_unchanged_order_writes_and_logs_nothing(auth_client, db):
    ids = await seed_categories(db)
    current = [ids["Food"], ids["Rent"], ids["Old"], ids["Travel"]]
    with flushed_updates(db, SpendingCategory) as written:
        resp = await auth_client.put(ORDER, json={"ids": current})
    assert resp.status_code == 200, resp.text
    assert [c["sort_order"] for c in resp.json()] == [2, 3, 7, 20]
    assert "x-change-batch" not in resp.headers
    assert written == set()
    assert (await db.execute(select(ChangeLog))).scalars().all() == []


@pytest.mark.parametrize("shape", ["missing", "extra", "retired left out"])
async def test_a_stale_list_409s_with_the_sentence_and_moves_nothing(auth_client, db, shape):
    ids = await seed_categories(db)
    before = await stored_orders(db)
    body = {
        "missing": [ids["Travel"], ids["Food"], ids["Old"]],
        "extra": [ids["Travel"], ids["Food"], ids["Rent"], ids["Old"], 999],
        "retired left out": [ids["Travel"], ids["Food"], ids["Rent"]],
    }[shape]
    resp = await auth_client.put(ORDER, json={"ids": body})
    assert resp.status_code == 409
    assert resp.json()["detail"] == STALE
    assert await stored_orders(db) == before
    assert (await db.execute(select(ChangeLog))).scalars().all() == []


async def test_a_repeated_id_422s_naming_it(auth_client, db):
    ids = await seed_categories(db)
    body = [ids["Rent"], ids["Food"], ids["Rent"], ids["Old"], ids["Travel"]]
    resp = await auth_client.put(ORDER, json={"ids": body})
    assert resp.status_code == 422
    assert resp.json()["detail"] == f"ids lists {ids['Rent']} more than once"


async def test_only_rows_whose_number_moves_are_written_and_logged(auth_client, db):
    rows = [
        SpendingCategory(name=name, slug=name.lower(), sort_order=index)
        for index, name in enumerate(["A", "B", "C", "D"])
    ]
    db.add_all(rows)
    await db.commit()
    a, b, c, d = (row.id for row in rows)
    with flushed_updates(db, SpendingCategory) as written:
        resp = await auth_client.put(ORDER, json={"ids": [b, a, c, d]})
    assert resp.status_code == 200, resp.text
    assert written == {a, b}
    logged = (await db.execute(select(ChangeLog))).scalars().all()
    assert sorted((r.pk["id"], r.before["sort_order"], r.after["sort_order"]) for r in logged) == [
        (a, 0, 1),
        (b, 1, 0),
    ]
    assert {(r.op, r.table_name) for r in logged} == {("update", "spending_categories")}
    assert {r.batch_id for r in logged} == {UUID(resp.headers["x-change-batch"])}
    # An adjacent swap names ONE row (spec §3.1): B is kept, so A is the one that moved.
    assert {r.label for r in logged} == {"Moved category A"}


async def test_the_label_counts_the_minimal_moved_set_otherwise(auth_client, db):
    ids = await seed_categories(db)
    # Food, Rent, Old, Travel -> Travel, Old, Rent, Food: a reversal keeps only Travel.
    await auth_client.put(
        ORDER, json={"ids": [ids["Travel"], ids["Old"], ids["Rent"], ids["Food"]]}
    )
    labels = set((await db.execute(select(ChangeLog.label))).scalars())
    assert labels == {"Reordered 3 categories"}


async def test_undo_puts_back_the_exact_previous_numbers(auth_client, db):
    ids = await seed_categories(db)
    moved = await auth_client.put(
        ORDER, json={"ids": [ids["Travel"], ids["Food"], ids["Rent"], ids["Old"]]}
    )
    assert moved.status_code == 200, moved.text
    undo = await auth_client.post(f"{ACTIVITY}/batches/{moved.headers['x-change-batch']}/undo")
    assert undo.status_code == 200, undo.text
    assert undo.json()["label"] == "Undid: Moved category Travel"
    listed = (await auth_client.get(f"{SP}/categories")).json()
    assert [(c["id"], c["sort_order"]) for c in listed] == [
        (ids["Food"], 2),
        (ids["Rent"], 3),
        (ids["Old"], 7),
        (ids["Travel"], 20),
    ]


async def test_a_later_edit_of_a_moved_row_makes_the_undo_refuse(auth_client, db):
    ids = await seed_categories(db)
    new = [ids["Travel"], ids["Food"], ids["Rent"], ids["Old"]]
    moved = await auth_client.put(ORDER, json={"ids": new})
    batch_id = moved.headers["x-change-batch"]
    renamed = await auth_client.patch(f"{SP}/categories/{ids['Travel']}", json={"name": "Trips"})
    assert renamed.status_code == 200, renamed.text
    refused = await auth_client.post(f"{ACTIVITY}/batches/{batch_id}/undo")
    assert refused.status_code == 409
    assert refused.json()["detail"] == OVERLAP_REFUSAL
    listed = (await auth_client.get(f"{SP}/categories")).json()
    assert [c["id"] for c in listed] == new


async def test_undo_after_a_later_reorder_refuses_until_the_later_one_is_undone(auth_client, db):
    """Spec §9: two reorders touch the same rows, so the first one's before images are stale
    — its undo refuses with the overlap sentence — while the later one undoes cleanly."""
    ids = await seed_categories(db)
    first = await auth_client.put(
        ORDER, json={"ids": [ids["Travel"], ids["Food"], ids["Rent"], ids["Old"]]}
    )
    second = await auth_client.put(
        ORDER, json={"ids": [ids["Food"], ids["Travel"], ids["Rent"], ids["Old"]]}
    )
    first_batch = first.headers["x-change-batch"]
    refused = await auth_client.post(f"{ACTIVITY}/batches/{first_batch}/undo")
    assert refused.status_code == 409
    assert refused.json()["detail"] == OVERLAP_REFUSAL
    undone = await auth_client.post(f"{ACTIVITY}/batches/{second.headers['x-change-batch']}/undo")
    assert undone.status_code == 200, undone.text
    listed = (await auth_client.get(f"{SP}/categories")).json()
    # Back to the state the first reorder left: Travel, Food, Rent, Old at 0…3.
    assert [(c["id"], c["sort_order"]) for c in listed] == [
        (ids["Travel"], 0),
        (ids["Food"], 1),
        (ids["Rent"], 2),
        (ids["Old"], 3),
    ]
```

- [ ] **Step 4: Run and watch them fail**

Run: `FINANCE_TEST_DB=finance_test_reorder_r1 $PY -m pytest tests/test_changelog_pin.py tests/test_reorder_route_order.py tests/test_reorder_categories_api.py -q`

Expected: `14 failed, 2 passed` — the pin (`AssertionError: spending.py: listed paths missing or
no longer writing: {'reorder_categories'}`), the new route-order case (`ValueError: not enough
values to unpack (expected 1, got 0)`; the accounts case passes), and all 12 categories tests (the
PUT answers `405 Method Not Allowed`).

- [ ] **Step 5: Write the route**

In `backend/app/api/spending.py`, add the body import directly above the `app.schemas.projection`
import (base line 12):

```python
from app.schemas.ordering import OrderIn
```

and the service import directly after
`from app.services.net_worth_calc import get_swr_pct, investable_bases` (base line 45):

```python
from app.services.ordering import (
    STALE_CATEGORIES,
    check_permutation,
    moved_ids,
    renumber,
)
```

Then insert, directly after `list_categories` (base line 63) and before
`@router.post("/categories", …)`:

```python
@router.put("/categories/order", response_model=list[CategoryOut])
async def reorder_categories(
    body: OrderIn,
    response: Response,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> list[SpendingCategory]:
    """Drag-to-reorder (2026-09-23 spec §3.2): `ids` is EVERY category, retired included, in
    its new order. sort_order becomes 0…n−1 and only rows whose value moves are written, as
    ONE change batch (§8.4 labels). An unchanged order writes and logs nothing.

    Declared before the /categories/{category_id} routes so a later PUT on that path can
    never shadow it."""
    categories = list(
        (
            await db.execute(
                select(SpendingCategory).order_by(SpendingCategory.sort_order, SpendingCategory.id)
            )
        ).scalars()
    )
    current = [category.id for category in categories]
    check_permutation(current, body.ids, stale_detail=STALE_CATEGORIES)
    if body.ids == current:
        return categories
    by_id = {category.id: category for category in categories}
    ordered = [by_id[category_id] for category_id in body.ids]
    before = {category.id: row_image(category) for category in categories}
    for category, _old, _new in renumber(ordered, "sort_order", start=0, step=1):
        batch.record_update(category, before[category.id])
    moved = moved_ids(current, body.ids)
    batch.label = (
        f"Moved category {by_id[moved[0]].name}"
        if len(moved) == 1
        else f"Reordered {len(moved)} categories"
    )
    # The header only when rows were logged — the allocation routes' rule; batch_header
    # spells it the way the month DELETEs already do.
    response.headers.update(batch_header(await batch.commit()))
    return ordered
```

(`Response`, `select`, `ChangeBatch`, `change_batch`, `row_image` and `batch_header` are already
imported by this module.)

- [ ] **Step 6: Run and watch them pass**

Run: `FINANCE_TEST_DB=finance_test_reorder_r1 $PY -m pytest tests/test_changelog_pin.py tests/test_reorder_route_order.py tests/test_reorder_categories_api.py -q`

Expected: `16 passed` (2 + 2 + 12). Then
`FINANCE_TEST_DB=finance_test_reorder_r1 $PY -m pytest tests/test_spending_api.py -q` — all pass.

- [ ] **Step 7: Lint and commit**

```bash
$PY -m ruff check app tests && $PY -m ruff format --check app tests
git add app/api/spending.py tests/test_changelog_pin.py tests/test_reorder_route_order.py tests/test_reorder_categories_api.py
git commit -m "feat(ordering): PUT /spending/categories/order — logged like the accounts, §8.4 labels"
```

---

## Task 5 — appending instead of 0: accounts, categories, account group change (spec §3.3)

**Files:**
- Modify: `backend/app/services/ordering.py` (imports; append `next_sort_order`)
- Modify: `backend/tests/test_ordering_service.py` (imports; append one test)
- Modify: `backend/app/schemas/net_worth.py:36-37`, `backend/app/schemas/spending.py:28-29`
- Modify: `backend/app/api/net_worth.py` (service import; `create_account` base lines 125-135;
  `update_account` before base line 197)
- Modify: `backend/app/api/spending.py` (service import; `create_category` base lines 94-96)
- Modify: `backend/tests/test_reorder_accounts_api.py`, `backend/tests/test_reorder_categories_api.py`
  (append tests)

- [ ] **Step 1: Write the failing tests**

In `backend/tests/test_ordering_service.py`, replace the import block (everything from
`from types import SimpleNamespace` through the closing `)` of the `app.services.ordering` import)
with:

```python
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.models import Account
from app.services.ordering import (
    STALE_ACCOUNTS,
    STALE_CARDS,
    STALE_CATEGORIES,
    STALE_REWARD_CATEGORIES,
    STALE_TRANSACTIONS,
    check_permutation,
    moved_ids,
    next_sort_order,
    renumber,
    subset_in_slots,
)
```

and append at the end of the file:

```python


# ── next_sort_order ──────────────────────────────────────────────────────────────────


async def test_next_sort_order_appends_after_the_max_and_starts_at_zero(db):
    assert (await db.execute(next_sort_order(Account.sort_order))).scalar_one() == 0
    db.add_all(
        [
            Account(name="A", slug="a", group="cash", sort_order=3),
            Account(name="B", slug="b", group="cash", sort_order=29),
        ]
    )
    await db.commit()
    assert (await db.execute(next_sort_order(Account.sort_order))).scalar_one() == 30
```

Append at the end of `backend/tests/test_reorder_accounts_api.py`:

```python


# ── the append defaults (spec §3.3) ──────────────────────────────────────────────────


async def test_create_without_a_sort_order_appends_after_the_last_account(auth_client, db):
    first = await auth_client.post(f"{NW}/accounts", json={"name": "Checking", "group": "cash"})
    assert first.status_code == 201, first.text
    assert first.json()["sort_order"] == 0  # an empty table starts at 0
    db.add(Account(name="Brokerage", slug="brokerage", group="taxable", sort_order=55))
    await db.commit()
    second = await auth_client.post(f"{NW}/accounts", json={"name": "Savings", "group": "cash"})
    assert second.json()["sort_order"] == 56
    nulled = await auth_client.post(
        f"{NW}/accounts", json={"name": "HSA", "group": "pre_tax", "sort_order": None}
    )
    assert nulled.json()["sort_order"] == 57
    explicit = await auth_client.post(
        f"{NW}/accounts", json={"name": "IRA", "group": "pre_tax", "sort_order": 4}
    )
    assert explicit.json()["sort_order"] == 4  # an explicit number is still honoured


async def test_a_group_change_appends_the_account_inside_the_same_batch(auth_client, db):
    checking = Account(name="Checking", slug="checking", group="cash", sort_order=1)
    db.add_all([checking, Account(name="Z", slug="z", group="taxable", sort_order=55)])
    await db.commit()
    resp = await auth_client.patch(f"{NW}/accounts/{checking.id}", json={"group": "other"})
    assert resp.status_code == 200, resp.text
    assert (resp.json()["group"], resp.json()["sort_order"]) == ("other", 56)
    [logged] = (await db.execute(select(ChangeLog))).scalars().all()
    assert (logged.before["group"], logged.before["sort_order"]) == ("cash", 1)
    assert (logged.after["group"], logged.after["sort_order"]) == ("other", 56)
    assert logged.label == "Updated account Checking"


async def test_an_explicit_sort_order_wins_and_other_edits_never_move_a_row(auth_client, db):
    checking = Account(name="Checking", slug="checking", group="cash", sort_order=1)
    db.add_all([checking, Account(name="Z", slug="z", group="taxable", sort_order=55)])
    await db.commit()
    url = f"{NW}/accounts/{checking.id}"
    explicit = await auth_client.patch(url, json={"group": "other", "sort_order": 7})
    assert explicit.json()["sort_order"] == 7
    renamed = await auth_client.patch(url, json={"name": "Everyday Checking"})
    assert renamed.json()["sort_order"] == 7
    same_group = await auth_client.patch(url, json={"group": "other"})
    assert same_group.json()["sort_order"] == 7  # not a group CHANGE, so no append
```

Append at the end of `backend/tests/test_reorder_categories_api.py`:

```python


# ── the append default (spec §3.3) ───────────────────────────────────────────────────


async def test_create_without_a_sort_order_appends_after_the_last_category(auth_client, db):
    first = await auth_client.post(f"{SP}/categories", json={"name": "Food"})
    assert first.status_code == 201, first.text
    assert first.json()["sort_order"] == 0  # an empty table starts at 0
    db.add(SpendingCategory(name="Travel", slug="travel", sort_order=20))
    await db.commit()
    second = await auth_client.post(f"{SP}/categories", json={"name": "Pets"})
    assert second.json()["sort_order"] == 21
    nulled = await auth_client.post(f"{SP}/categories", json={"name": "Kids", "sort_order": None})
    assert nulled.json()["sort_order"] == 22
    explicit = await auth_client.post(f"{SP}/categories", json={"name": "Gym", "sort_order": 5})
    assert explicit.json()["sort_order"] == 5
```

- [ ] **Step 2: Run and watch them fail**

Two runs: a collection error aborts the whole pytest session, so the unit file is run on its own.

Run: `FINANCE_TEST_DB=finance_test_reorder_r1 $PY -m pytest tests/test_ordering_service.py -q`

Expected: `ERROR collecting tests/test_ordering_service.py` —
`ImportError: cannot import name 'next_sort_order' from 'app.services.ordering'` — then
`Interrupted: 1 error during collection`.

Run: `FINANCE_TEST_DB=finance_test_reorder_r1 $PY -m pytest tests/test_reorder_accounts_api.py tests/test_reorder_categories_api.py -q`

Expected: `3 failed, 27 passed` —
- `test_create_without_a_sort_order_appends_after_the_last_account` — `assert 0 == 56` (the
  schema still defaults to 0);
- `test_a_group_change_appends_the_account_inside_the_same_batch` —
  `AssertionError: assert ('other', 1) == ('other', 56)`;
- `test_create_without_a_sort_order_appends_after_the_last_category` — `assert 0 == 21`.

`test_an_explicit_sort_order_wins_and_other_edits_never_move_a_row` PASSES already — it pins that
the new rule touches only a group CHANGE with no explicit number.

- [ ] **Step 3: Add `next_sort_order` to the service**

In `backend/app/services/ordering.py`, replace:

```python
from fastapi import HTTPException
```

with:

```python
from fastapi import HTTPException
from sqlalchemy import Select, func, select
from sqlalchemy.orm import InstrumentedAttribute
```

and append at the end of the file:

```python


def next_sort_order(column: InstrumentedAttribute[int]) -> Select[tuple[int]]:
    """`SELECT coalesce(max(column), -1) + 1` — the append position a create without a
    sort_order takes (spec §3.3). The statement, not the value, so this module stays free
    of I/O: the router awaits it inside its own transaction."""
    return select(func.coalesce(func.max(column), -1) + 1)
```

- [ ] **Step 4: Make `sort_order` optional on the two create bodies**

In `backend/app/schemas/net_worth.py` (`AccountCreate`), replace:

```python
    # int32-safe and generous; sheet column indexes top out at 51.
    sort_order: int = Field(default=0, ge=0, le=1_000_000)
```

with:

```python
    # Omitted or null = append after the last account (2026-09-23 reorder spec §3.3); an
    # explicit number is still honoured (scripts, tests). int32-safe and generous.
    sort_order: int | None = Field(default=None, ge=0, le=1_000_000)
```

In `backend/app/schemas/spending.py` (`CategoryCreate`), replace:

```python
    # int32-safe and generous; sheet column indexes top out at 20.
    sort_order: int = Field(default=0, ge=0, le=1_000_000)
```

with:

```python
    # Omitted or null = append after the last category (2026-09-23 reorder spec §3.3); an
    # explicit number is still honoured (scripts, tests). int32-safe and generous.
    sort_order: int | None = Field(default=None, ge=0, le=1_000_000)
```

- [ ] **Step 5: Append on create, and on an account's group change**

In `backend/app/api/net_worth.py`, replace the service import Task 3 added:

```python
from app.services.ordering import (
    STALE_ACCOUNTS,
    check_permutation,
    moved_ids,
    renumber,
)
```

with:

```python
from app.services.ordering import (
    STALE_ACCOUNTS,
    check_permutation,
    moved_ids,
    next_sort_order,
    renumber,
)
```

In `create_account`, replace:

```python
    await _validate_links(db, body.person_id, body.parent_account_id, None)
    _check_component_link(body.is_component, body.parent_account_id)
    account = Account(
        name=body.name,
        slug=slug,
        group=body.group,
        sort_order=body.sort_order,
```

with:

```python
    await _validate_links(db, body.person_id, body.parent_account_id, None)
    _check_component_link(body.is_component, body.parent_account_id)
    sort_order = body.sort_order
    if sort_order is None:
        # No position given: append after the last account (2026-09-23 reorder spec §3.3),
        # never 0 — 0 put every new account at the top of its group.
        sort_order = (await db.execute(next_sort_order(Account.sort_order))).scalar_one()
    account = Account(
        name=body.name,
        slug=slug,
        group=body.group,
        sort_order=sort_order,
```

In `update_account`, replace:

```python
    # slug is the importer's natural key — never rewritten here. A sheet-side rename is
    # the importer's job (per-run alias semantics, Plan 2 forward note).
    before = row_image(account)
```

with:

```python
    if "group" in updates and updates["group"] != account.group and "sort_order" not in updates:
        # A group change lands the account at the END of its new group (2026-09-23 reorder
        # spec §3.3): its old number ranked it among the old group's rows. It rides the
        # same batch as the group change, so one Undo reverts both.
        updates["sort_order"] = (await db.execute(next_sort_order(Account.sort_order))).scalar_one()
    # slug is the importer's natural key — never rewritten here. A sheet-side rename is
    # the importer's job (per-run alias semantics, Plan 2 forward note).
    before = row_image(account)
```

(`updates` already drops an explicit `"sort_order": null`, so a null reads as "not given" and
appends too.)

In `backend/app/api/spending.py`, replace the service import Task 4 added:

```python
from app.services.ordering import (
    STALE_CATEGORIES,
    check_permutation,
    moved_ids,
    renumber,
)
```

with:

```python
from app.services.ordering import (
    STALE_CATEGORIES,
    check_permutation,
    moved_ids,
    next_sort_order,
    renumber,
)
```

and in `create_category` replace:

```python
    category = SpendingCategory(
        name=body.name, slug=slug, sort_order=body.sort_order, kind=body.kind
    )
```

with:

```python
    sort_order = body.sort_order
    if sort_order is None:
        # No position given: append after the last category (2026-09-23 reorder spec §3.3).
        sort_order = (await db.execute(next_sort_order(SpendingCategory.sort_order))).scalar_one()
    category = SpendingCategory(name=body.name, slug=slug, sort_order=sort_order, kind=body.kind)
```

- [ ] **Step 6: Run and watch them pass**

Run: `FINANCE_TEST_DB=finance_test_reorder_r1 $PY -m pytest tests/test_ordering_service.py tests/test_reorder_accounts_api.py tests/test_reorder_categories_api.py -q`

Expected: `51 passed` (21 + 17 + 13). Then the existing create/patch suites:
`FINANCE_TEST_DB=finance_test_reorder_r1 $PY -m pytest tests/test_net_worth_api.py tests/test_spending_api.py tests/test_changelog_routes.py tests/test_activity_api.py -q` — all pass
(`test_account_create_update_delete_are_logged` still reads `sort_order` 0: the first account of an
empty table appends at 0).

- [ ] **Step 7: Lint and commit**

```bash
$PY -m ruff check app tests && $PY -m ruff format --check app tests
git add app/services/ordering.py app/schemas/net_worth.py app/schemas/spending.py app/api/net_worth.py app/api/spending.py tests/test_ordering_service.py tests/test_reorder_accounts_api.py tests/test_reorder_categories_api.py
git commit -m "feat(ordering): new accounts and categories append instead of taking 0; a group change appends"
```

---

## Task 6 — `position_transactions.import_key` + migration `f12026092301` (spec §3.5)

**Files:**
- Modify: `backend/tests/test_models_portfolio.py` (insert before `test_one_close_per_day`, base
  line 87)
- Modify: `backend/app/models/portfolio.py:111-152` (`PositionTransaction`)
- Create: `backend/alembic/versions/20260923_0900_f12026092301_position_transactions_import_key.py`

- [ ] **Step 1: Write the failing model test**

In `backend/tests/test_models_portfolio.py`, insert directly before
`async def test_one_close_per_day(db):`:

```python
async def test_import_key_is_unique_among_import_rows_only(db):
    """The importer's identity (2026-09-23 reorder spec §3.5): two IMPORT rows may not share
    a sheet key, while UI rows and NULL keys sit outside the partial unique index. Declared
    in the model as well as migration f12026092301 because this schema is create_all-built."""
    sec = Security(ticker="IKEY", name="Import Key", holding_type="stock")
    db.add(sec)
    await db.commit()
    # Held as a plain int: the rollback below expires every instance, and a later sec.id
    # would then emit lazy IO (MissingGreenlet under asyncio).
    sec_id = sec.id

    def row(source: str, import_key: int | None) -> PositionTransaction:
        return PositionTransaction(
            security_id=sec_id,
            portfolio_account=acct("RH Taxable"),
            type="buy",
            shares=Decimal("1"),
            price=Decimal("1"),
            source=source,
            import_key=import_key,
        )

    db.add_all(
        [
            row("import", 20),
            row("ui", 20),
            row("import", None),
            row("import", None),
            row("ui", None),
        ]
    )
    await db.commit()  # a UI row may carry any key, and NULL keys never collide
    db.add(row("import", 20))
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()  # shared-session contract (conftest): unpoison after IntegrityError


```

- [ ] **Step 2: Run and watch it fail**

Run: `FINANCE_TEST_DB=finance_test_reorder_r1 $PY -m pytest tests/test_models_portfolio.py -q`

Expected: `1 failed, 7 passed` —
`TypeError: 'import_key' is an invalid keyword argument for PositionTransaction`.

- [ ] **Step 3: Add the column and the partial unique index to the model**

In `backend/app/models/portfolio.py`, replace:

```python
class PositionTransaction(Base):
    __tablename__ = "position_transactions"
```

with:

```python
class PositionTransaction(Base):
    __tablename__ = "position_transactions"
    __table_args__ = (
        # The importer's identity for sheet rows (2026-09-23 drag-to-reorder spec §3.5):
        # unique among source='import' rows only — UI rows carry NULL. Declared HERE as well
        # as in migration f12026092301 because the test database is built by create_all (the
        # ux_dividend_auto_event precedent below).
        Index(
            "ux_position_txn_import_key",
            "import_key",
            unique=True,
            postgresql_where=text("source = 'import'"),
        ),
    )
```

and replace:

```python
    # Preserves spreadsheet row order — cost-basis folding must process transactions in
    # this order because most rows have no date. Order by (sort_index, id) for stability.
    sort_index: Mapped[int] = mapped_column(default=0)
    # Ownership contract (supersedes Plan 2's sort_index-0 rule): the importer keys and
    # sync-deletes ONLY source='import' rows; UI rows are invisible to re-imports.
    source: Mapped[str] = mapped_column(String(10), default="ui", server_default="ui")
    notes: Mapped[str | None] = mapped_column(Text)
```

with:

```python
    # The REPLAY order: cost-basis folding processes transactions in (sort_index, id)
    # order because most rows have no date. The user owns it — PUT
    # /portfolio/transactions/order renumbers the ledger 10, 20, … — and the importer only
    # ever appends new sheet rows after the max (2026-09-23 drag-to-reorder spec §3.4).
    sort_index: Mapped[int] = mapped_column(default=0)
    # Ownership contract (supersedes Plan 2's sort_index-0 rule): the importer keys and
    # sync-deletes ONLY source='import' rows; UI rows are invisible to re-imports.
    source: Mapped[str] = mapped_column(String(10), default="ui", server_default="ui")
    notes: Mapped[str | None] = mapped_column(Text)
    # The importer's identity for a sheet row: the sheet key (sheet row x 10) on
    # source='import' rows, NULL on UI rows. It used to BE sort_index; once the user could
    # drag the replay order it had to live apart (migration f12026092301 backfilled it from
    # sort_index). Importer identity, not a UI field — TransactionOut does not carry it.
    import_key: Mapped[int | None] = mapped_column(default=None)
```

(`Index` and `text` are already imported by this module.)

- [ ] **Step 4: Run and watch it pass**

Run: `FINANCE_TEST_DB=finance_test_reorder_r1 $PY -m pytest tests/test_models_portfolio.py tests/test_portfolio_api.py -q`

Expected: all pass — `test_models_portfolio.py` 8 (one more than the baseline) and
`test_portfolio_api.py` 47.

- [ ] **Step 5: Write the migration**

Create `backend/alembic/versions/20260923_0900_f12026092301_position_transactions_import_key.py`:

```python
"""position_transactions.import_key — the importer's identity for sheet rows

`sort_index` used to be two things at once: the cost-basis replay order AND the key the
Positions importer matched and sync-deleted its rows by (sheet row x 10). Drag-to-reorder
(2026-09-23 spec §3.5) hands the replay order to the user, so identity moves to a column of
its own: `import_key` holds the sheet key on source='import' rows (NULL on UI rows) and is
unique among them.

The backfill copies sort_index into import_key for every import row. Until this revision
nothing but the importer ever wrote an import row's sort_index — the ledger PATCH never
touches it — so it IS each row's sheet key, and the first re-import after the deploy
matches every row it matched before. The unique index is created AFTER the backfill, so a
duplicate key would fail the upgrade loudly instead of passing silently.

Rollout: snapshots taken before this revision are not restorable after it (restore requires
the snapshot's alembic head to equal the server's — the rule for every migration). Take a
snapshot right after deploying.

Revision ID: f12026092301
Revises: f12026091203
Create Date: 2026-09-23 09:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f12026092301"
down_revision: str | Sequence[str] | None = "f12026091203"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Named explicitly, and identically in models.portfolio.PositionTransaction.__table_args__.
INDEX = "ux_position_txn_import_key"


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("position_transactions", sa.Column("import_key", sa.Integer(), nullable=True))
    op.execute("UPDATE position_transactions SET import_key = sort_index WHERE source = 'import'")
    op.create_index(
        INDEX,
        "position_transactions",
        ["import_key"],
        unique=True,
        postgresql_where=sa.text("source = 'import'"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(INDEX, table_name="position_transactions")
    op.drop_column("position_transactions", "import_key")
```

- [ ] **Step 6: Check the migration renders and heads stay single (no database needed)**

```bash
$PY -m ruff check alembic/versions/20260923_0900_f12026092301_position_transactions_import_key.py && $PY -m ruff format --check alembic/versions/20260923_0900_f12026092301_position_transactions_import_key.py
$PY -m alembic heads
$PY -m alembic upgrade f12026091203:f12026092301 --sql
$PY -m alembic downgrade f12026092301:f12026091203 --sql
```

Expected: `f12026092301 (head)` alone; the upgrade SQL contains, in this order,
`ALTER TABLE position_transactions ADD COLUMN import_key INTEGER;`,
`UPDATE position_transactions SET import_key = sort_index WHERE source = 'import';` and
`CREATE UNIQUE INDEX ux_position_txn_import_key ON position_transactions (import_key) WHERE source = 'import';`;
the downgrade SQL contains `DROP INDEX ux_position_txn_import_key;` then
`ALTER TABLE position_transactions DROP COLUMN import_key;`.

- [ ] **Step 7: Read-only census — will the unique index build on prod-shaped data?**

`finance_realdata` is a byte-verified restore of prod's 2026-09-23 snapshot. SELECT only:

```bash
$PY -c "
import asyncio, asyncpg

async def main():
    conn = await asyncpg.connect('postgresql://finance:finance@127.0.0.1:5433/finance_realdata')
    dupes = await conn.fetch(
        \"SELECT sort_index, count(*) FROM position_transactions WHERE source = 'import' GROUP BY sort_index HAVING count(*) > 1\"
    )
    rows = await conn.fetchval(\"SELECT count(*) FROM position_transactions WHERE source = 'import'\")
    print('duplicate import sort_index:', [tuple(r) for r in dupes], '| import rows:', rows)
    await conn.close()

asyncio.run(main())
"
```

Expected: `duplicate import sort_index: [] | import rows: 26`.

- [ ] **Step 8: The drill — create the lane's scratch database and stop at the parent revision**

```bash
$PY -c "
import asyncio, asyncpg

async def main():
    conn = await asyncpg.connect('postgresql://finance:finance@127.0.0.1:5433/postgres')
    await conn.execute('CREATE DATABASE finance_test_reorder_r1_mig')
    await conn.close()

asyncio.run(main())
"
DATABASE_URL=postgresql+asyncpg://finance:finance@localhost:5433/finance_test_reorder_r1_mig $PY -m alembic upgrade f12026091203
```

Expected: the last line reads `Running upgrade f12026091202 -> f12026091203, Explicitly saved,
owner-scoped assistant findings with immutable evidence.`

- [ ] **Step 9: Seed two import rows and a UI row at the parent revision**

```bash
$PY -c "
import asyncio, asyncpg

async def main():
    conn = await asyncpg.connect('postgresql://finance:finance@127.0.0.1:5433/finance_test_reorder_r1_mig')
    await conn.execute('''
        INSERT INTO securities (id, ticker, name, holding_type, is_manual_priced, is_active)
        VALUES (1, 'VOO', 'Vanguard S&P 500 ETF', 'etf', false, true);
        INSERT INTO portfolio_accounts (id, label) VALUES (1, 'RH Taxable');
        INSERT INTO position_transactions
            (security_id, portfolio_account_id, type, shares, price, sort_index, source)
        VALUES (1, 1, 'buy', 1, 1, 30, 'import'),
               (1, 1, 'buy', 1, 1, 40, 'import'),
               (1, 1, 'buy', 1, 1, 50, 'ui');
    ''')
    await conn.close()

asyncio.run(main())
"
```

Expected: no output, exit 0.

- [ ] **Step 10: Upgrade to head; the backfill and the index hold**

```bash
DATABASE_URL=postgresql+asyncpg://finance:finance@localhost:5433/finance_test_reorder_r1_mig $PY -m alembic upgrade head
$PY -c "
import asyncio, asyncpg

async def main():
    conn = await asyncpg.connect('postgresql://finance:finance@127.0.0.1:5433/finance_test_reorder_r1_mig')
    rows = await conn.fetch('SELECT source, sort_index, import_key FROM position_transactions ORDER BY sort_index')
    print([tuple(row) for row in rows])
    try:
        await conn.execute(
            \"INSERT INTO position_transactions (security_id, portfolio_account_id, type, shares, price, sort_index, source, import_key) VALUES (1, 1, 'buy', 1, 1, 60, 'import', 30)\"
        )
        print('DUPLICATE ACCEPTED - the index is missing')
    except asyncpg.UniqueViolationError as exc:
        print('duplicate import_key refused by', exc.constraint_name)
    await conn.close()

asyncio.run(main())
"
```

Expected: `Running upgrade f12026091203 -> f12026092301, position_transactions.import_key — the
importer's identity for sheet rows`, then

```
[('import', 30, 30), ('import', 40, 40), ('ui', 50, None)]
duplicate import_key refused by ux_position_txn_import_key
```

- [ ] **Step 11: Downgrade, upgrade again, `alembic check`**

```bash
DATABASE_URL=postgresql+asyncpg://finance:finance@localhost:5433/finance_test_reorder_r1_mig $PY -m alembic downgrade -1
$PY -c "
import asyncio, asyncpg

async def main():
    conn = await asyncpg.connect('postgresql://finance:finance@127.0.0.1:5433/finance_test_reorder_r1_mig')
    found = await conn.fetch(
        \"SELECT column_name FROM information_schema.columns WHERE table_name = 'position_transactions' AND column_name = 'import_key'\"
    )
    print('import_key after downgrade:', [row[0] for row in found])
    await conn.close()

asyncio.run(main())
"
DATABASE_URL=postgresql+asyncpg://finance:finance@localhost:5433/finance_test_reorder_r1_mig $PY -m alembic upgrade head
DATABASE_URL=postgresql+asyncpg://finance:finance@localhost:5433/finance_test_reorder_r1_mig $PY -m alembic check
```

Expected: `Running downgrade f12026092301 -> f12026091203, …`; `import_key after downgrade: []`;
`Running upgrade f12026091203 -> f12026092301, …`; and `alembic check` ending in
`No new upgrade operations detected.` (INFO lines about sequences before it are normal). Re-running
the Step 10 query snippet now prints the same two lines. Leave `finance_test_reorder_r1_mig` in
place — it goes on the morning list; never drop it.

- [ ] **Step 12: Lint and commit**

```bash
$PY -m ruff check app tests && $PY -m ruff format --check app tests
git add app/models/portfolio.py alembic/versions/20260923_0900_f12026092301_position_transactions_import_key.py tests/test_models_portfolio.py
git commit -m "feat(portfolio): position_transactions.import_key + partial unique index (migration f12026092301)"
```

---

## Task 7 — the importer stops owning order (spec §3.4)

**Files:**
- Modify: `backend/tests/test_importer_apply.py` (base lines 147-153, 173-183, 252-254, 257-288,
  291, 352-353, 419, 1072, 1450-1454, 1539-1541)
- Modify: `backend/app/importer/apply.py:10` (import), `:165-220` (`apply_positions`),
  `:247-280` (`apply_net_worth`), `:403-432` (`apply_spending`)

- [ ] **Step 1: Update the tests that pinned the old rules**

In `backend/tests/test_importer_apply.py`:

(a) `test_apply_positions_full_flow` — replace:

```python
    assert [t.sort_index for t in txns] == [20, 40, 50]
    assert txns[0].shares == Decimal("10.123457")
```

with:

```python
    # The sheet key (row x 10) is the row's identity; the replay order is appended from the
    # ledger's max (0 on an empty ledger) in sheet order (2026-09-23 reorder spec §3.4).
    assert [(t.import_key, t.sort_index) for t in txns] == [(20, 10), (40, 20), (50, 30)]
    assert txns[0].shares == Decimal("10.123457")
```

(b) `test_apply_positions_deletes_importer_strays_keeps_ui_rows` — the stale import row carries a
sheet key the sheet no longer has. Replace:

```python
            sort_index=990,
            source="import",
        )
    )
    db.add(  # UI-owned row: source 'ui' keeps it out of the sync's view entirely
```

with:

```python
            sort_index=990,
            import_key=990,
            source="import",
        )
    )
    db.add(  # UI-owned row: source 'ui' keeps it out of the sync's view entirely
```

(c) `test_apply_positions_marks_created_rows_import` — replace:

```python
    assert row.sort_index > 0  # sheet row order preserved; no longer an ownership signal
```

with:

```python
    assert row.import_key == 20  # sheet row 2 x 10: the identity the next import matches
    assert row.sort_index > 0  # the replay order; never an ownership signal
```

(d) The old collision test is no collision any more. Replace its head:

```python
async def test_apply_positions_sort_index_collision_leaves_ui_row_alone(db):
    """An incoming sheet row whose sort_index equals a UI row's must create a NEW
    import row, not adopt/mutate the UI row."""
    wb = sheets(positions=default_positions_rows()[:2])  # header + one row -> sort_index 20
```

with:

```python
async def test_apply_positions_sheet_key_matching_a_ui_sort_index_leaves_ui_row_alone(db):
    """An incoming sheet row whose sheet key equals a UI row's sort_index must create a
    NEW import row — appended after the ledger, keyed by import_key — never adopt or mutate
    the UI row."""
    wb = sheets(positions=default_positions_rows()[:2])  # header + one row -> sheet key 20
```

then replace, in the same test:

```python
            sort_index=20,  # collides with the incoming sheet row (folding tie-breaks on id)
```

with:

```python
            sort_index=20,  # the same number as the incoming sheet key
```

and replace:

```python
    assert sorted(r.source for r in rows) == ["import", "ui"]
    assert [r.sort_index for r in rows] == [20, 20]
    assert report.entities["position_transactions"].creates == 1
```

with:

```python
    assert [(r.source, r.import_key, r.sort_index) for r in rows] == [
        ("ui", None, 20),
        ("import", 20, 30),  # appended after the ledger's max, keyed by its sheet key
    ]
    assert report.entities["position_transactions"].creates == 1
```

(e) `test_apply_net_worth_accounts_snapshots_balances` — replace:

```python
    assert checking.group == "cash" and checking.sort_order == 3
```

with:

```python
    # The first sheet column on an empty database: order 0, not its column index (spec §3.4).
    assert checking.group == "cash" and checking.sort_order == 0
```

(f) `test_reimport_preserves_user_owned_is_component` — replace:

```python
    assert account.is_component is True  # importer diff-fields are {name, group, sort_order} only
```

with:

```python
    assert account.is_component is True  # importer diff-fields are {name, group} only
```

(g) `test_importer_never_writes_category_budgets` — replace:

```python
    # Slug "food" matches the workbook's Food column, and sort_order 99 does NOT match:
    # the import diff-updates the category row itself, which makes the pin sharp — the
    # parent table moves, the budgets table must not (categories are upserted by slug,
    # never deleted, so the CASCADE can't fire through an import).
    cat = SpendingCategory(name="Food", slug="food", sort_order=99)
```

with:

```python
    # Slug "food" matches the workbook's Food column, and the name "FOOD" does NOT match:
    # the import diff-updates the category row itself (its name — sort_order is no longer
    # the importer's since 2026-09-23), which makes the pin sharp — the parent table moves,
    # the budgets table must not (categories are upserted by slug, never deleted, so the
    # CASCADE can't fire through an import).
    cat = SpendingCategory(name="FOOD", slug="food", sort_order=99)
```

(h) `test_importer_never_writes_credit_card_tables` — replace:

```python
    # Map onto a category the workbook WILL diff-update (the budgets pin's trick):
    # slug "food" matches the workbook's Food column, sort_order 99 does not.
    spending = SpendingCategory(name="Food", slug="food", sort_order=99)
```

with:

```python
    # Map onto a category the workbook WILL diff-update (the budgets pin's trick):
    # slug "food" matches the workbook's Food column, the name "FOOD" does not.
    spending = SpendingCategory(name="FOOD", slug="food", sort_order=99)
```

- [ ] **Step 2: Add the new importer tests**

Insert directly before `async def test_apply_positions_creates_primary_owned_portfolio_accounts(db):`:

```python
async def test_a_dragged_sheet_row_survives_a_reimport_without_a_duplicate(db):
    """The user drags the replay order after an import (spec §3.4): the next import matches
    every sheet row by import_key — no duplicate, no delete, and nothing moves back."""
    wb = sheets()
    report = SheetReport()
    by_name = await apply_reference_data(db, parse_reference_data(wb["ReferenceData"]), report)
    await apply_positions(db, parse_positions(wb["Positions"]), by_name, report)
    await db.commit()
    rows = {t.import_key: t for t in (await db.execute(select(PositionTransaction))).scalars()}
    # What PUT /portfolio/transactions/order writes for "the Mystery Fund buy to the top".
    rows[50].sort_index, rows[20].sort_index, rows[40].sort_index = 10, 20, 30
    await db.commit()

    wb2 = sheets()
    report2 = SheetReport()
    by_name2 = await apply_reference_data(db, parse_reference_data(wb2["ReferenceData"]), report2)
    await apply_positions(db, parse_positions(wb2["Positions"]), by_name2, report2)
    await db.commit()
    counts = report2.entities["position_transactions"]
    assert (counts.creates, counts.updates, counts.deletes, counts.skips) == (0, 0, 0, 3)
    after = await db.execute(
        select(PositionTransaction.import_key, PositionTransaction.sort_index).order_by(
            PositionTransaction.sort_index
        )
    )
    assert [tuple(row) for row in after] == [(50, 10), (20, 20), (40, 30)]


async def test_a_new_sheet_row_appends_after_the_whole_ledger(db):
    """A row added to the sheet lands at the END — after the UI rows too, exactly where a
    UI row lands — in sheet order; the user drags it into place (spec §3.4)."""
    wb = sheets()
    report = SheetReport()
    by_name = await apply_reference_data(db, parse_reference_data(wb["ReferenceData"]), report)
    await apply_positions(db, parse_positions(wb["Positions"]), by_name, report)
    await db.commit()
    acme_id = (await db.execute(select(Security).where(Security.ticker == "ACME"))).scalar_one().id
    db.add(
        PositionTransaction(
            security_id=acme_id,
            portfolio_account=acct("UI Acct"),
            type="buy",
            shares=Decimal("1"),
            price=Decimal("1"),
            sort_index=40,  # the UI's own append: max 30 + 10
            source="ui",
        )
    )
    await db.commit()

    rows = default_positions_rows()
    # Sheet row 3 (the zero-share placeholder) becomes a real row: sheet key 30.
    rows[2] = ["Fido", "Buy", "Div Corp", 3.0, 40.0, None, None, 0, 0, 0, 0, 0]
    wb2 = sheets(positions=rows)
    report2 = SheetReport()
    by_name2 = await apply_reference_data(db, parse_reference_data(wb2["ReferenceData"]), report2)
    await apply_positions(db, parse_positions(wb2["Positions"]), by_name2, report2)
    await db.commit()
    counts = report2.entities["position_transactions"]
    assert (counts.creates, counts.updates, counts.deletes) == (1, 0, 0)
    ordered = await db.execute(
        select(
            PositionTransaction.source,
            PositionTransaction.import_key,
            PositionTransaction.sort_index,
        ).order_by(PositionTransaction.sort_index, PositionTransaction.id)
    )
    assert [tuple(row) for row in ordered] == [
        ("import", 20, 10),
        ("import", 40, 20),
        ("import", 50, 30),
        ("ui", None, 40),
        ("import", 30, 50),
    ]
    # Report samples keep naming the SHEET key.
    assert any(s.startswith("position_transactions[30]: buy") for s in report2.samples)


async def test_an_import_row_without_a_key_is_swept_as_left_the_sheet(db):
    """No sheet row can match a keyless import row, so the sync treats it as gone — the
    same answer a missing sheet key gets."""
    wb = sheets()
    report = SheetReport()
    by_name = await apply_reference_data(db, parse_reference_data(wb["ReferenceData"]), report)
    await db.commit()
    acme_id = (await db.execute(select(Security).where(Security.ticker == "ACME"))).scalar_one().id
    db.add(
        PositionTransaction(
            security_id=acme_id,
            portfolio_account=acct("Keyless"),
            type="buy",
            shares=Decimal("1"),
            price=Decimal("1"),
            sort_index=5,
            source="import",
        )
    )
    await db.commit()
    await apply_positions(db, parse_positions(wb["Positions"]), by_name, report)
    await db.commit()
    assert report.entities["position_transactions"].deletes == 1
    assert "position_transactions[None]: deleted (row left sheet)" in report.samples
    keys = (await db.execute(select(PositionTransaction.import_key))).scalars().all()
    assert sorted(keys) == [20, 40, 50]


```

Insert directly before `async def test_refdata_rename_keeps_positions_attached(db):`:

```python
async def test_an_empty_database_gets_the_sheet_order(db):
    report = SheetReport()
    await apply_net_worth(db, parse_net_worth(sheets()["Net Worth"]), report)
    await apply_spending(db, parse_spending(sheets()["Spending"]), report)
    await db.commit()
    accounts = await db.execute(select(Account.slug, Account.sort_order).order_by(Account.id))
    assert [tuple(row) for row in accounts] == [("checking", 0), ("ira", 1), ("credit-card", 2)]
    categories = await db.execute(
        select(SpendingCategory.slug, SpendingCategory.sort_order).order_by(SpendingCategory.id)
    )
    assert [tuple(row) for row in categories] == [("food", 0), ("rent", 1)]


async def test_custom_orders_survive_a_reimport_and_new_columns_append(db):
    """The importer stops owning order (spec §3.4): a re-import never moves an existing
    account or category, and a new sheet column is appended after the current last row."""
    from tests.workbook_builder import default_net_worth_rows, default_spending_rows

    report = SheetReport()
    await apply_net_worth(db, parse_net_worth(sheets()["Net Worth"]), report)
    await apply_spending(db, parse_spending(sheets()["Spending"]), report)
    await db.commit()
    # The user's drags — what the two reorder routes write.
    accounts = {a.slug: a for a in (await db.execute(select(Account))).scalars()}
    accounts["credit-card"].sort_order = 0
    accounts["checking"].sort_order = 1
    accounts["ira"].sort_order = 2
    categories = {c.slug: c for c in (await db.execute(select(SpendingCategory))).scalars()}
    categories["rent"].sort_order = 0
    categories["food"].sort_order = 1
    await db.commit()

    nw_rows = default_net_worth_rows()
    # A new CASH column "Savings" right after Checking's % column.
    nw_rows[0].insert(4, None)
    nw_rows[1].insert(4, "Savings")
    for row in nw_rows[2:]:
        row.insert(4, None)
    sp_rows = default_spending_rows()
    # A new "Pets" column before TOTAL; blank in every month.
    sp_rows[0].insert(3, "Pets")
    for row in sp_rows[1:]:
        row.insert(3, None)
    report2 = SheetReport()
    await apply_net_worth(db, parse_net_worth(sheets(net_worth=nw_rows)["Net Worth"]), report2)
    await apply_spending(db, parse_spending(sheets(spending=sp_rows)["Spending"]), report2)
    await db.commit()
    assert report2.entities["accounts"].updates == 0
    assert report2.entities["spending_categories"].updates == 0
    accounts = await db.execute(
        select(Account.slug, Account.sort_order).order_by(Account.sort_order)
    )
    assert [tuple(row) for row in accounts] == [
        ("credit-card", 0),
        ("checking", 1),
        ("ira", 2),
        ("savings", 3),
    ]
    categories = await db.execute(
        select(SpendingCategory.slug, SpendingCategory.sort_order).order_by(
            SpendingCategory.sort_order
        )
    )
    assert [tuple(row) for row in categories] == [("rent", 0), ("food", 1), ("pets", 2)]


```

- [ ] **Step 3: Run and watch them fail**

Run: `FINANCE_TEST_DB=finance_test_reorder_r1 $PY -m pytest tests/test_importer_apply.py -q`

Expected: `9 failed, 44 passed` —
- `test_apply_positions_full_flow` — `[(None, 20), (None, 40), (None, 50)]` vs
  `[(20, 10), (40, 20), (50, 30)]`;
- `test_apply_positions_marks_created_rows_import` — `assert None == 20`;
- `test_apply_positions_sheet_key_matching_a_ui_sort_index_leaves_ui_row_alone` — the import row
  is `("import", None, 20)`;
- `test_a_dragged_sheet_row_survives_a_reimport_without_a_duplicate` — `KeyError: 50` (no row
  carries an import_key yet);
- `test_a_new_sheet_row_appends_after_the_whole_ledger` — every `import_key` is `None` and the
  new row lands at `sort_index` 30, not 50;
- `test_an_import_row_without_a_key_is_swept_as_left_the_sheet` — the delete sample names
  `position_transactions[5]` (the old sort_index key), not `position_transactions[None]`;
- `test_apply_net_worth_accounts_snapshots_balances` — `sort_order` is 3, not 0;
- `test_an_empty_database_gets_the_sheet_order` — `[('checking', 3), ('ira', 5), ('credit-card', 7)]`;
- `test_custom_orders_survive_a_reimport_and_new_columns_append` — `assert 3 == 0`: the re-import
  rewrote the three dragged accounts' `sort_order`.

- [ ] **Step 4: Rewrite the three appliers**

In `backend/app/importer/apply.py`, replace:

```python
from sqlalchemy import select
```

with:

```python
from sqlalchemy import func, select
```

In `apply_positions`, replace:

```python
    existing = {
        t.sort_index: t
        for t in (
            await db.execute(
                select(PositionTransaction).where(PositionTransaction.source == "import")
            )
        ).scalars()
    }
```

with:

```python
    # Sheet rows are matched by import_key — the sheet key the parser still calls
    # `sort_index` (row x 10) — never by the stored sort_index, which since 2026-09-23 is the
    # user's replay order (drag-to-reorder spec §3.4). UI rows are invisible here throughout.
    imported = list(
        (
            await db.execute(
                select(PositionTransaction)
                .where(PositionTransaction.source == "import")
                .order_by(PositionTransaction.id)
            )
        ).scalars()
    )
    existing = {t.import_key: t for t in imported if t.import_key is not None}
    # New sheet rows land at the END of the ledger in sheet order, exactly where a UI row
    # lands; the user drags them into place. Existing rows never move.
    last_index = (
        await db.execute(select(func.coalesce(func.max(PositionTransaction.sort_index), 0)))
    ).scalar_one()
```

replace:

```python
    incoming_indexes: set[int] = set()
    for txn in parsed.transactions:
        incoming_indexes.add(txn.sort_index)
```

with:

```python
    incoming_keys: set[int] = set()
    for txn in parsed.transactions:
        incoming_keys.add(txn.sort_index)
```

replace:

```python
        row = existing.get(txn.sort_index)
        if row is None:
            db.add(PositionTransaction(sort_index=txn.sort_index, source="import", **fields))
            txn_counts.creates += 1
```

with:

```python
        row = existing.get(txn.sort_index)
        if row is None:
            last_index += 10
            db.add(
                PositionTransaction(
                    import_key=txn.sort_index, sort_index=last_index, source="import", **fields
                )
            )
            txn_counts.creates += 1
```

and replace the sync block at the end of the function:

```python
    # Sync: importer-owned rows (source='import') whose sheet row disappeared are deleted.
    # UI-created rows (source='ui') are invisible to the sync at ANY sort_index (Plan 4
    # contract, superseding Plan 2's sort_index-0 rule) — so a sheet row may land on a UI
    # row's sort_index; both survive and cost-basis folding tie-breaks the pair on id.
    for sort_index, row in existing.items():
        if sort_index not in incoming_indexes:
            await db.delete(row)
            txn_counts.deletes += 1
            report.add_sample(f"position_transactions[{sort_index}]: deleted (row left sheet)")
```

with:

```python
    # Sync: an importer-owned row (source='import') whose sheet key left the sheet is
    # deleted. A row with no key cannot be matched to any sheet row, so it reads as having
    # left too. UI-created rows (source='ui') are never loaded here (Plan 4 contract).
    for row in imported:
        if row.import_key is None or row.import_key not in incoming_keys:
            await db.delete(row)
            txn_counts.deletes += 1
            report.add_sample(f"position_transactions[{row.import_key}]: deleted (row left sheet)")
```

(The create sample and the `_diff_update` sample key keep printing `txn.sort_index` — the sheet
key, as §3.4 requires. The update `fields` never contained `sort_index`, so updates never touch
it.)

In `apply_net_worth`, replace:

```python
    existing_accounts = {a.slug: a for a in (await db.execute(select(Account))).scalars()}
    accounts_by_name: dict[str, Account] = {}
```

with:

```python
    existing_accounts = {a.slug: a for a in (await db.execute(select(Account))).scalars()}
    # The importer no longer owns order (2026-09-23 drag-to-reorder spec §3.4): sort_order
    # is set at CREATE only, appended after the current last account in sheet order, and a
    # re-import never moves an existing row. An empty database gets the sheet's order.
    next_order = max((a.sort_order for a in existing_accounts.values()), default=-1) + 1
    accounts_by_name: dict[str, Account] = {}
```

and replace:

```python
        fields = {"name": column.name, "group": column.group, "sort_order": column.sort_order}
        if account is None:
            is_component = slug in COMPONENT_SLUGS_AT_CREATE
            # is_active default True; both flags are user-owned after creation
            account = Account(slug=slug, is_component=is_component, **fields)
            db.add(account)
```

with:

```python
        fields = {"name": column.name, "group": column.group}
        if account is None:
            is_component = slug in COMPONENT_SLUGS_AT_CREATE
            # is_active default True; both flags are user-owned after creation
            account = Account(slug=slug, is_component=is_component, sort_order=next_order, **fields)
            next_order += 1
            db.add(account)
```

In `apply_spending`, replace:

```python
    existing_categories = {
        c.slug: c for c in (await db.execute(select(SpendingCategory))).scalars()
    }
    categories_by_name: dict[str, SpendingCategory] = {}
```

with:

```python
    existing_categories = {
        c.slug: c for c in (await db.execute(select(SpendingCategory))).scalars()
    }
    # Same order rule as the accounts (spec §3.4): set at create only, appended in sheet order.
    next_order = max((c.sort_order for c in existing_categories.values()), default=-1) + 1
    categories_by_name: dict[str, SpendingCategory] = {}
```

and replace:

```python
        fields = {"name": column.name, "sort_order": column.sort_order}
        if category is None:
            category = SpendingCategory(slug=slug, **fields)
            db.add(category)
```

with:

```python
        fields = {"name": column.name}
        if category is None:
            category = SpendingCategory(slug=slug, sort_order=next_order, **fields)
            next_order += 1
            db.add(category)
```

- [ ] **Step 5: Run and watch them pass**

Run: `FINANCE_TEST_DB=finance_test_reorder_r1 $PY -m pytest tests/test_importer_apply.py tests/test_importer_service.py tests/test_import_api.py tests/test_import_trail.py tests/test_importer_parsers.py -q`

Expected: all pass — `test_importer_apply.py` collects 53 (the baseline's 48, one of them renamed,
plus the 5 new ones), and `test_importer_service.py::test_apply_then_reapply_is_all_skips` still
sees zero creates, updates and deletes on the second import.

- [ ] **Step 6: Lint and commit**

```bash
$PY -m ruff check app tests && $PY -m ruff format --check app tests
git add app/importer/apply.py tests/test_importer_apply.py
git commit -m "feat(importer): order belongs to the user — create-only sort_order, sheet rows matched by import_key and appended"
```

---

## Task 8 — `PUT /portfolio/transactions/order` and the figure report (spec §3.2, §9)

**Files:**
- Modify: `backend/app/schemas/portfolio.py:168-183` (insert after `TransactionOut`)
- Modify: `backend/app/services/ordering.py` (imports; append `_q`, `position_changes`)
- Modify: `backend/tests/test_ordering_service.py` (imports; append four tests)
- Modify: `backend/app/api/portfolio.py:7` (sqlalchemy import), `:21-48` (schemas import), `:61`
  (service imports), `:327-343` (`list_transactions` → `_ledger_query`, new route),
  `:361-362`, `:426-427`, `:435` (comments)
- Modify: `backend/tests/test_reorder_route_order.py`
- Create: `backend/tests/test_reorder_transactions_api.py`

- [ ] **Step 1: Write the failing unit tests for the fold report**

In `backend/tests/test_ordering_service.py`, replace the import block (from
`from types import SimpleNamespace` through the closing `)` of the `app.services.ordering` import)
with:

```python
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.models import Account
from app.services.ordering import (
    STALE_ACCOUNTS,
    STALE_CARDS,
    STALE_CATEGORIES,
    STALE_REWARD_CATEGORIES,
    STALE_TRANSACTIONS,
    check_permutation,
    moved_ids,
    next_sort_order,
    position_changes,
    renumber,
    subset_in_slots,
)
from app.services.portfolio_calc import Position
```

and append at the end of the file:

```python


# ── position_changes ─────────────────────────────────────────────────────────────────


def pos(security_id: int, account: str, shares: str, cost: str, gain: str, *warnings: str):
    return Position(
        security_id=security_id,
        account=account,
        shares=Decimal(shares),
        cost_basis=Decimal(cost),
        realized_gl=Decimal(gain),
        warnings=list(warnings),
    )


def test_position_changes_is_empty_when_every_figure_rounds_the_same():
    before = {(1, "Fido"): pos(1, "Fido", "6", "300", "120")}
    # Sub-cent and sub-micro-share noise is not a change: the comparison is quantized.
    after = {(1, "Fido"): pos(1, "Fido", "6.0000001", "300.004", "119.996")}
    assert position_changes(before, after, {1: "VOO"}) == []


def test_position_changes_reports_quantized_strings_and_the_new_warning():
    before = {(1, "Fido"): pos(1, "Fido", "6", "300", "120")}
    after = {(1, "Fido"): pos(1, "Fido", "6", "500", "320", "txn 7: sell with no held shares")}
    [change] = position_changes(before, after, {1: "VOO"})
    assert change.model_dump(mode="json") == {
        "security_id": 1,
        "ticker": "VOO",
        "account": "Fido",
        "shares_before": "6.000000",
        "shares_after": "6.000000",
        "cost_basis_before": "300.00",
        "cost_basis_after": "500.00",
        "realized_gl_before": "120.00",
        "realized_gl_after": "320.00",
        "warnings_added": ["txn 7: sell with no held shares"],
    }


def test_a_new_warning_alone_is_a_change_and_an_old_one_is_not_repeated():
    old_line = "txn 3: sell exceeds held shares"
    before = {(1, "Fido"): pos(1, "Fido", "0", "0", "5", old_line)}
    after = {
        (1, "Fido"): pos(1, "Fido", "0", "0", "5", old_line, "txn 4: sell with no held shares")
    }
    [change] = position_changes(before, after, {1: "VOO"})
    assert change.warnings_added == ["txn 4: sell with no held shares"]


def test_position_changes_are_ordered_by_ticker_then_account_and_never_minus_zero():
    before = {
        (2, "RH"): pos(2, "RH", "1", "10", "0"),
        (1, "Z"): pos(1, "Z", "1", "10", "0"),
        (1, "A"): pos(1, "A", "1", "10", "0"),
    }
    after = {
        (2, "RH"): pos(2, "RH", "2", "10", "0"),
        (1, "Z"): pos(1, "Z", "2", "10", "0"),
        (1, "A"): pos(1, "A", "2", "10", "-0.001"),
    }
    changes = position_changes(before, after, {1: "BBB", 2: "AAA"})
    assert [(c.ticker, c.account) for c in changes] == [("AAA", "RH"), ("BBB", "A"), ("BBB", "Z")]
    assert changes[1].model_dump(mode="json")["realized_gl_after"] == "0.00"
```

- [ ] **Step 2: Run and watch them fail**

Run: `FINANCE_TEST_DB=finance_test_reorder_r1 $PY -m pytest tests/test_ordering_service.py -q`

Expected: `ERROR collecting tests/test_ordering_service.py` —
`ImportError: cannot import name 'position_changes' from 'app.services.ordering'`.

- [ ] **Step 3: Add the wire schemas**

In `backend/app/schemas/portfolio.py`, insert directly after `class TransactionOut` (after its last
field, `notes: str | None`, base line 182) and before `class DividendCreate`:

```python


class PositionChangeOut(BaseModel):
    """One position whose figures a replay-order change moved (2026-09-23 reorder spec
    §3.2). Shares are quantized to 6 dp and money to 2 dp BEFORE they reach this model, so
    the wire strings are exact; `warnings_added` holds only the lines the new order
    introduced."""

    security_id: int
    ticker: str
    account: str
    shares_before: Decimal
    shares_after: Decimal
    cost_basis_before: Decimal
    cost_basis_after: Decimal
    realized_gl_before: Decimal
    realized_gl_after: Decimal
    warnings_added: list[str]


class TransactionOrderOut(BaseModel):
    """PUT /portfolio/transactions/order: the rows the caller's scope shows, in their new
    order, and every position whose figures changed, ordered by (ticker, account)."""

    transactions: list[TransactionOut]
    changed_positions: list[PositionChangeOut]
```

- [ ] **Step 4: Add `position_changes` to the service**

In `backend/app/services/ordering.py`, replace the import block:

```python
from bisect import bisect_left
from collections.abc import Sequence

from fastapi import HTTPException
from sqlalchemy import Select, func, select
from sqlalchemy.orm import InstrumentedAttribute
```

with:

```python
from bisect import bisect_left
from collections.abc import Sequence
from decimal import ROUND_HALF_UP, Decimal

from fastapi import HTTPException
from sqlalchemy import Select, func, select
from sqlalchemy.orm import InstrumentedAttribute

from app.schemas.portfolio import PositionChangeOut
from app.services.portfolio_calc import MONEY_Q, SHARE_Q, Position, PositionKey
```

and append at the end of the file:

```python


def _q(value: Decimal, quantum: Decimal) -> Decimal:
    quantized = value.quantize(quantum, rounding=ROUND_HALF_UP)
    return abs(quantized) if quantized == 0 else quantized  # never "-0.00" on the wire


def position_changes(
    before: dict[PositionKey, Position],
    after: dict[PositionKey, Position],
    tickers: dict[int, str],
) -> list[PositionChangeOut]:
    """Every position whose figures differ between two folds of the SAME rows in two
    orders — shares at 6 dp, cost basis and realized gain at 2 dp — or whose warnings
    gained a line. A reorder never adds or removes a position (the same rows fold both
    times), so the two dicts share their keys. Ordered by (ticker, account)."""
    changes: list[PositionChangeOut] = []
    for key, now in after.items():
        was = before[key]
        shares = (_q(was.shares, SHARE_Q), _q(now.shares, SHARE_Q))
        cost = (_q(was.cost_basis, MONEY_Q), _q(now.cost_basis, MONEY_Q))
        gain = (_q(was.realized_gl, MONEY_Q), _q(now.realized_gl, MONEY_Q))
        warnings_added = [line for line in now.warnings if line not in was.warnings]
        unchanged = shares[0] == shares[1] and cost[0] == cost[1] and gain[0] == gain[1]
        if unchanged and not warnings_added:
            continue
        changes.append(
            PositionChangeOut(
                security_id=now.security_id,
                ticker=tickers[now.security_id],
                account=now.account,
                shares_before=shares[0],
                shares_after=shares[1],
                cost_basis_before=cost[0],
                cost_basis_after=cost[1],
                realized_gl_before=gain[0],
                realized_gl_after=gain[1],
                warnings_added=warnings_added,
            )
        )
    changes.sort(key=lambda change: (change.ticker, change.account))
    return changes
```

- [ ] **Step 5: Run and watch the unit tests pass; commit**

Run: `FINANCE_TEST_DB=finance_test_reorder_r1 $PY -m pytest tests/test_ordering_service.py -q`

Expected: `25 passed`.

```bash
$PY -m ruff check app tests && $PY -m ruff format --check app tests
git add app/schemas/portfolio.py app/services/ordering.py tests/test_ordering_service.py
git commit -m "feat(ordering): position_changes — what a replay-order move did to each holding"
```

- [ ] **Step 6: Add the transactions route to the placement pin**

In `backend/tests/test_reorder_route_order.py`, replace:

```python
from app.api import net_worth, spending

ORDER_ROUTES = (
    (net_worth.router, "/net-worth/accounts/order"),
    (spending.router, "/spending/categories/order"),
)
```

with:

```python
from app.api import net_worth, portfolio, spending

ORDER_ROUTES = (
    (net_worth.router, "/net-worth/accounts/order"),
    (spending.router, "/spending/categories/order"),
    (portfolio.router, "/portfolio/transactions/order"),
)
```

- [ ] **Step 7: Write the failing route tests**

Create `backend/tests/test_reorder_transactions_api.py`:

```python
"""PUT /portfolio/transactions/order — the replay order (2026-09-23 drag-to-reorder spec
§3.2, §8.3, §9). Unlogged by design (spec §0.10): the client's Undo re-sends the previous
order, so these tests prove the fold report, the scope and the renumbering instead."""

from decimal import Decimal

import pytest
from sqlalchemy import select

from app.models import ChangeLog, Person, PortfolioAccount, PositionTransaction, Security
from tests.ordering_helpers import flushed_updates

TRANSACTIONS = "/api/v1/portfolio/transactions"
ORDER = f"{TRANSACTIONS}/order"
STALE = "The transactions changed since this list was loaded — nothing was moved."


async def seed_book(db):
    """Two people, three labels (Mine = me, Theirs = Sam, Ours = joint), two securities.
    Returns (me, sam, securities by ticker, accounts by label)."""
    me, sam = Person(name="Me", is_primary=True), Person(name="Sam", is_primary=False)
    voo = Security(ticker="VOO", name="Vanguard S&P 500 ETF", holding_type="etf")
    nvda = Security(ticker="NVDA", name="NVIDIA", holding_type="stock")
    db.add_all([me, sam, voo, nvda])
    await db.flush()
    accounts = {
        "Mine": PortfolioAccount(label="Mine", person_id=me.id),
        "Theirs": PortfolioAccount(label="Theirs", person_id=sam.id),
        "Ours": PortfolioAccount(label="Ours", person_id=None),
    }
    db.add_all(accounts.values())
    await db.flush()
    return me, sam, {"VOO": voo, "NVDA": nvda}, accounts


def txn(security, account, type_, sort_index, shares="0", price="0", split_factor=None):
    return PositionTransaction(
        security_id=security.id,
        portfolio_account=account,
        type=type_,
        shares=Decimal(shares),
        price=Decimal(price),
        split_factor=None if split_factor is None else Decimal(split_factor),
        sort_index=sort_index,
        source="ui",
    )


async def add_rows(db, *rows) -> list[int]:
    db.add_all(rows)
    await db.commit()
    return [row.id for row in rows]


async def replay_order(db) -> list[tuple[int, int]]:
    rows = await db.execute(
        select(PositionTransaction.id, PositionTransaction.sort_index).order_by(
            PositionTransaction.sort_index, PositionTransaction.id
        )
    )
    return [(row.id, row.sort_index) for row in rows]


async def test_reorder_requires_auth(client):
    assert (await client.put(ORDER, json={"ids": [1]})).status_code == 401


async def test_a_cross_holding_move_changes_no_figures_and_spaces_the_ledger(auth_client, db):
    _, _, sec, acct = await seed_book(db)
    t1, t2, t3 = await add_rows(
        db,
        txn(sec["VOO"], acct["Mine"], "buy", 3, "10", "50"),
        txn(sec["NVDA"], acct["Mine"], "buy", 7, "1", "100"),
        txn(sec["VOO"], acct["Ours"], "buy", 7, "2", "40"),
    )
    resp = await auth_client.put(ORDER, json={"ids": [t2, t3, t1]})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["changed_positions"] == []  # three holdings, one row each: nothing re-folds
    assert [(t["id"], t["sort_index"]) for t in body["transactions"]] == [
        (t2, 10),
        (t3, 20),
        (t1, 30),
    ]
    assert await replay_order(db) == [(t2, 10), (t3, 20), (t1, 30)]  # evenly spaced
    listed = (await auth_client.get(TRANSACTIONS)).json()
    assert [t["id"] for t in listed] == [t2, t3, t1]  # the follow-up GET agrees
    assert (await db.execute(select(ChangeLog))).scalars().all() == []  # unlogged (§0.10)


async def test_an_owner_scoped_reorder_keeps_hidden_rows_in_their_slots(auth_client, db):
    me, _, sec, acct = await seed_book(db)
    t1, t2, t3, t4, t5 = await add_rows(
        db,
        txn(sec["VOO"], acct["Mine"], "buy", 10, "10", "50"),
        txn(sec["VOO"], acct["Theirs"], "buy", 20, "5", "60"),
        txn(sec["VOO"], acct["Ours"], "buy", 30, "2", "40"),
        txn(sec["VOO"], acct["Theirs"], "sell", 40, "2", "100"),
        txn(sec["NVDA"], acct["Mine"], "buy", 50, "1", "100"),
    )
    # My scope shows Mine + Ours: t1, t3, t5 in slots 0, 2, 4. Sam's t2 and t4 are hidden.
    resp = await auth_client.put(f"{ORDER}?owner={me.id}", json={"ids": [t5, t1, t3]})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert [t["id"] for t in body["transactions"]] == [t5, t1, t3]  # the visible rows only
    assert body["changed_positions"] == []
    # The visible rows filled slots 0, 2, 4 in their new order; t2 and t4 never moved.
    assert await replay_order(db) == [(t5, 10), (t2, 20), (t1, 30), (t4, 40), (t3, 50)]
    scoped = (await auth_client.get(f"{TRANSACTIONS}?owner={me.id}")).json()
    assert [t["id"] for t in scoped] == [t5, t1, t3]


async def test_a_sell_moved_above_its_buy_reports_the_new_figures_and_warning(auth_client, db):
    _, _, sec, acct = await seed_book(db)
    buy, sell = await add_rows(
        db,
        txn(sec["VOO"], acct["Mine"], "buy", 10, "10", "50"),
        txn(sec["VOO"], acct["Mine"], "sell", 20, "4", "80"),
    )
    resp = await auth_client.put(ORDER, json={"ids": [sell, buy]})
    assert resp.status_code == 200, resp.text
    # Before: 6 shares, basis 500 - 4 x 50 = 300, gain 4 x (80 - 50) = 120. After: the sell
    # meets no shares (avg 0, gain 320, basis reset), then the buy lands in full (basis 500).
    assert resp.json()["changed_positions"] == [
        {
            "security_id": sec["VOO"].id,
            "ticker": "VOO",
            "account": "Mine",
            "shares_before": "6.000000",
            "shares_after": "6.000000",
            "cost_basis_before": "300.00",
            "cost_basis_after": "500.00",
            "realized_gl_before": "120.00",
            "realized_gl_after": "320.00",
            "warnings_added": [f"txn {sell}: sell with no held shares"],
        }
    ]


async def test_a_split_moved_before_its_buy_reports_the_share_change(auth_client, db):
    _, _, sec, acct = await seed_book(db)
    buy, split = await add_rows(
        db,
        txn(sec["NVDA"], acct["Mine"], "buy", 10, "10", "100"),
        txn(sec["NVDA"], acct["Mine"], "split", 20, split_factor="2"),
    )
    resp = await auth_client.put(ORDER, json={"ids": [split, buy]})
    assert resp.status_code == 200, resp.text
    [change] = resp.json()["changed_positions"]
    assert (change["ticker"], change["account"]) == ("NVDA", "Mine")
    assert (change["shares_before"], change["shares_after"]) == ("20.000000", "10.000000")
    assert (change["cost_basis_before"], change["cost_basis_after"]) == ("1000.00", "1000.00")
    assert change["warnings_added"] == []


async def test_changed_positions_are_ordered_by_ticker_then_account(auth_client, db):
    _, _, sec, acct = await seed_book(db)
    ids = await add_rows(
        db,
        txn(sec["VOO"], acct["Ours"], "buy", 10, "1", "10"),
        txn(sec["VOO"], acct["Ours"], "sell", 20, "1", "20"),
        txn(sec["NVDA"], acct["Mine"], "buy", 30, "1", "10"),
        txn(sec["NVDA"], acct["Mine"], "sell", 40, "1", "20"),
        txn(sec["VOO"], acct["Mine"], "buy", 50, "1", "10"),
        txn(sec["VOO"], acct["Mine"], "sell", 60, "1", "20"),
    )
    # Every sell jumps above its own buy: three positions re-fold.
    new = [ids[1], ids[0], ids[3], ids[2], ids[5], ids[4]]
    resp = await auth_client.put(ORDER, json={"ids": new})
    assert resp.status_code == 200, resp.text
    assert [(c["ticker"], c["account"]) for c in resp.json()["changed_positions"]] == [
        ("NVDA", "Mine"),
        ("VOO", "Mine"),
        ("VOO", "Ours"),
    ]


async def test_an_unchanged_order_writes_nothing(auth_client, db):
    _, _, sec, acct = await seed_book(db)
    ids = await add_rows(
        db,
        txn(sec["VOO"], acct["Mine"], "buy", 3, "1", "10"),
        txn(sec["VOO"], acct["Mine"], "buy", 9, "1", "10"),
    )
    with flushed_updates(db, PositionTransaction) as written:
        resp = await auth_client.put(ORDER, json={"ids": ids})
    assert resp.status_code == 200, resp.text
    assert resp.json()["changed_positions"] == []
    assert [t["sort_index"] for t in resp.json()["transactions"]] == [3, 9]  # not respaced
    assert written == set()


async def test_only_rows_whose_number_moves_are_written(auth_client, db):
    _, _, sec, acct = await seed_book(db)
    t1, t2, t3, t4 = await add_rows(
        db,
        txn(sec["VOO"], acct["Mine"], "buy", 10, "1", "10"),
        txn(sec["VOO"], acct["Ours"], "buy", 20, "1", "10"),
        txn(sec["NVDA"], acct["Mine"], "buy", 30, "1", "10"),
        txn(sec["NVDA"], acct["Ours"], "buy", 40, "1", "10"),
    )
    with flushed_updates(db, PositionTransaction) as written:
        resp = await auth_client.put(ORDER, json={"ids": [t1, t2, t4, t3]})
    assert resp.status_code == 200, resp.text
    assert written == {t3, t4}


@pytest.mark.parametrize("shape", ["missing", "extra", "a hidden row"])
async def test_a_stale_list_409s_with_the_sentence_and_moves_nothing(auth_client, db, shape):
    me, _, sec, acct = await seed_book(db)
    t1, t2, t3 = await add_rows(
        db,
        txn(sec["VOO"], acct["Mine"], "buy", 10, "1", "10"),
        txn(sec["VOO"], acct["Theirs"], "buy", 20, "1", "10"),
        txn(sec["VOO"], acct["Ours"], "buy", 30, "1", "10"),
    )
    before = await replay_order(db)
    # In my scope the page shows t1 and t3; t2 (Sam's) is hidden and may not be sent.
    body = {"missing": [t3], "extra": [t3, t1, 999], "a hidden row": [t3, t2, t1]}[shape]
    resp = await auth_client.put(f"{ORDER}?owner={me.id}", json={"ids": body})
    assert resp.status_code == 409
    assert resp.json()["detail"] == STALE
    assert await replay_order(db) == before


async def test_a_repeated_id_422s_naming_it(auth_client, db):
    _, _, sec, acct = await seed_book(db)
    t1, t2 = await add_rows(
        db,
        txn(sec["VOO"], acct["Mine"], "buy", 10, "1", "10"),
        txn(sec["VOO"], acct["Mine"], "buy", 20, "1", "10"),
    )
    resp = await auth_client.put(ORDER, json={"ids": [t2, t1, t2]})
    assert resp.status_code == 422
    assert resp.json()["detail"] == f"ids lists {t2} more than once"


async def test_a_garbage_owner_422s_like_the_list(auth_client, db):
    await seed_book(db)
    await db.commit()
    for bad in ("nobody", "-1", "0"):
        resp = await auth_client.put(f"{ORDER}?owner={bad}", json={"ids": [1]})
        assert resp.status_code == 422, bad
```

- [ ] **Step 8: Run and watch them fail**

Run: `FINANCE_TEST_DB=finance_test_reorder_r1 $PY -m pytest tests/test_reorder_route_order.py tests/test_reorder_transactions_api.py -q`

Expected: `14 failed, 2 passed` — the new route-order case (`ValueError: not enough values to
unpack (expected 1, got 0)`; the two earlier cases pass) and all 13 transactions tests (the PUT
answers `405 Method Not Allowed`: the path only matches the PATCH/DELETE `/transactions/{txn_id}`
routes).

- [ ] **Step 9: Write the route**

In `backend/app/api/portfolio.py`:

Replace:

```python
from sqlalchemy import ColumnElement, func, select, text
```

with:

```python
from sqlalchemy import ColumnElement, Select, func, select, text
```

Replace:

```python
from app.models.portfolio import AllocationTargetSet
from app.schemas.portfolio import (
```

with:

```python
from app.models.portfolio import AllocationTargetSet
from app.schemas.ordering import OrderIn
from app.schemas.portfolio import (
```

In the `app.schemas.portfolio` import list, replace:

```python
    TransactionCreate,
    TransactionOut,
    TransactionUpdate,
)
```

with:

```python
    TransactionCreate,
    TransactionOrderOut,
    TransactionOut,
    TransactionUpdate,
)
```

Replace:

```python
from app.services.portfolio_accounts import portfolio_owner_clause, resolve_portfolio_account
```

with:

```python
from app.services.ordering import (
    STALE_TRANSACTIONS,
    check_permutation,
    position_changes,
    renumber,
    subset_in_slots,
)
from app.services.portfolio_accounts import portfolio_owner_clause, resolve_portfolio_account
```

Replace the whole `list_transactions` route (base lines 327-343):

```python
@router.get("/transactions", response_model=list[TransactionOut])
async def list_transactions(
    security_id: int | None = None,
    owner: OwnerQuery = None,
    db: AsyncSession = Depends(get_db),
) -> list[PositionTransaction]:
    query = select(PositionTransaction).order_by(
        PositionTransaction.sort_index, PositionTransaction.id
    )
    if security_id is not None:
        query = query.where(PositionTransaction.security_id == security_id)
    owner_filter = _owner_filter(owner)
    if owner_filter is not None:
        query = query.join(
            PortfolioAccount, PortfolioAccount.id == PositionTransaction.portfolio_account_id
        ).where(owner_filter)
    return list((await db.execute(query)).scalars())
```

with:

```python
def _ledger_query(owner_filter: ColumnElement[bool] | None) -> Select[tuple[PositionTransaction]]:
    """The ledger in replay order, (sort_index, id), scoped by `owner_filter` — ONE builder
    for the list GET and the reorder PUT, so "the rows the page shows" and "the rows the
    reorder must be sent" can never be two different filters."""
    query = select(PositionTransaction).order_by(
        PositionTransaction.sort_index, PositionTransaction.id
    )
    if owner_filter is not None:
        query = query.join(
            PortfolioAccount, PortfolioAccount.id == PositionTransaction.portfolio_account_id
        ).where(owner_filter)
    return query


@router.get("/transactions", response_model=list[TransactionOut])
async def list_transactions(
    security_id: int | None = None,
    owner: OwnerQuery = None,
    db: AsyncSession = Depends(get_db),
) -> list[PositionTransaction]:
    query = _ledger_query(_owner_filter(owner))
    if security_id is not None:
        query = query.where(PositionTransaction.security_id == security_id)
    return list((await db.execute(query)).scalars())


@router.put("/transactions/order", response_model=TransactionOrderOut)
async def reorder_transactions(
    body: OrderIn,
    owner: OwnerQuery = None,
    db: AsyncSession = Depends(get_db),
) -> TransactionOrderOut:
    """Change the REPLAY order (2026-09-23 drag-to-reorder spec §3.2). `ids` is every row
    `GET /transactions?owner=` returns, in its new order. The visible rows take the slots
    the visible rows already hold, hidden rows keep theirs, and the whole ledger is
    renumbered 10, 20, … (only rows whose number moves are written). Both orders are
    folded, and every position whose figures changed is reported, so the page can say what
    the move did to cost basis and gains.

    A scope never splits a holding: a position is keyed by an account label, and a label
    belongs to one owner (or joint), so each position is wholly visible or wholly hidden.

    NOT change-logged, on purpose (spec §0.10): undo replays whole-row images, and this
    table's other writers (the CRUD routes here, the importer) are unlogged, so undoing a
    logged reorder after an unlogged edit of a moved row would silently revert that edit.
    The client's Undo re-sends the previous order through this same route instead.

    Declared before the /transactions/{txn_id} routes so a later PUT on that path can never
    shadow it."""
    owner_filter = _owner_filter(owner)  # 422 on a garbage owner before anything is read
    ledger = list((await db.execute(_ledger_query(None))).scalars())
    visible = (
        ledger
        if owner_filter is None
        else list((await db.execute(_ledger_query(owner_filter))).scalars())
    )
    visible_ids = [txn.id for txn in visible]
    check_permutation(visible_ids, body.ids, stale_detail=STALE_TRANSACTIONS)
    if body.ids == visible_ids:
        return TransactionOrderOut(
            transactions=[TransactionOut.model_validate(txn) for txn in visible],
            changed_positions=[],
        )
    tickers = {
        security_id: ticker
        for security_id, ticker in await db.execute(select(Security.id, Security.ticker))
    }
    by_id = {txn.id: txn for txn in ledger}
    before = fold_transactions(ledger)  # folded BEFORE renumber touches a row
    new_order = subset_in_slots([txn.id for txn in ledger], body.ids)
    renumber([by_id[txn_id] for txn_id in new_order], "sort_index", start=10, step=10)
    changed = position_changes(before, fold_transactions(ledger), tickers)
    await db.commit()
    return TransactionOrderOut(
        transactions=[TransactionOut.model_validate(by_id[txn_id]) for txn_id in body.ids],
        changed_positions=changed,
    )
```

In `create_transaction`, replace:

```python
    # UI rows fold chronologically LAST (locked decision). A later sheet import may mint
    # the same sort_index for a new row — folding tie-breaks on id; accepted.
```

with:

```python
    # UI rows fold chronologically LAST (locked decision) until the user drags them
    # elsewhere (PUT /transactions/order). A later import appends its new sheet rows after
    # the ledger's max the same way — import_key, not sort_index, is the importer's identity.
```

In `update_transaction`, replace:

```python
    # source/sort_index are ownership metadata — never PATCHable. Edits to
    # source='import' rows are legal but the next re-import reverts them (sheet wins).
```

with:

```python
    # source/sort_index/import_key are ownership metadata — never PATCHable (the replay
    # order moves only through PUT /transactions/order). Edits to source='import' rows are
    # legal but the next re-import reverts them (sheet wins).
```

In `delete_transaction`, replace:

```python
    await db.delete(txn)  # import-owned rows resurrect on the next re-import — documented
```

with:

```python
    # Import-owned rows resurrect on the next re-import — appended at the ledger's end,
    # matched by import_key — documented.
    await db.delete(txn)
```

- [ ] **Step 10: Run and watch them pass**

Run: `FINANCE_TEST_DB=finance_test_reorder_r1 $PY -m pytest tests/test_reorder_route_order.py tests/test_reorder_transactions_api.py tests/test_portfolio_api.py tests/test_portfolio_accounts.py -q`

Expected: all pass — route order 3, transactions 13, and the existing portfolio suites unchanged
(the list refactor keeps `test_list_transactions_filters_and_orders` and the owner-scope tests
green).

- [ ] **Step 11: Lint and commit**

```bash
$PY -m ruff check app tests && $PY -m ruff format --check app tests
git add app/api/portfolio.py tests/test_reorder_route_order.py tests/test_reorder_transactions_api.py
git commit -m "feat(portfolio): PUT /portfolio/transactions/order — scoped slots, whole-ledger renumber, figure report"
```

---

## Task 9 — the two credit-card lists: reorder routes and their defaults (spec §3.2, §3.3)

**Files:**
- Modify: `backend/app/schemas/credit_cards.py:106` (`CreditCardIn.sort_order`), `:136`
  (`RewardCategoryCreate.sort_order`)
- Modify: `backend/app/api/credit_cards.py:20-40` (imports), `:117-125` (reward create),
  `:128` (insert the reward reorder), `:346-348` (insert `_cards_out`), `:408-440` (list, create,
  insert the card reorder, patch)
- Modify: `backend/tests/test_reorder_route_order.py`
- Create: `backend/tests/test_reorder_credit_cards_api.py`

- [ ] **Step 1: Add the two routes to the placement pin**

In `backend/tests/test_reorder_route_order.py`, replace:

```python
from app.api import net_worth, portfolio, spending

ORDER_ROUTES = (
    (net_worth.router, "/net-worth/accounts/order"),
    (spending.router, "/spending/categories/order"),
    (portfolio.router, "/portfolio/transactions/order"),
)
```

with:

```python
from app.api import credit_cards, net_worth, portfolio, spending

ORDER_ROUTES = (
    (net_worth.router, "/net-worth/accounts/order"),
    (spending.router, "/spending/categories/order"),
    (portfolio.router, "/portfolio/transactions/order"),
    (credit_cards.router, "/credit-cards/order"),
    (credit_cards.router, "/credit-cards/categories/order"),
)
```

- [ ] **Step 2: Write the failing tests**

Create `backend/tests/test_reorder_credit_cards_api.py`:

```python
"""PUT /credit-cards/order, PUT /credit-cards/categories/order and their append/keep
defaults (2026-09-23 drag-to-reorder spec §3.2, §3.3, §8.3). Both routes are unlogged like
the rest of the credit-cards router; the client's Undo re-sends the previous order."""

from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.models import ChangeLog, CreditCard, CreditLimitEvent, RewardCategory
from tests.ordering_helpers import flushed_updates

CARDS = "/api/v1/credit-cards"
CARD_ORDER = f"{CARDS}/order"
CATEGORY_ORDER = f"{CARDS}/categories/order"
STALE_CARDS = "The cards changed since this list was loaded — nothing was moved."
STALE_REWARD = "The reward categories changed since this list was loaded — nothing was moved."


def card_body(name: str, **over) -> dict:
    """A full CreditCardIn WITHOUT sort_order — the shape the UI sends from now on."""
    body = {
        "name": name,
        "annual_fee": "95.00",
        "rewards_currency": "points",
        "point_value_cents": "1.25",
        "primary_holder": None,
        "authorized_users": None,
        "opened_on": None,
        "is_active": True,
        "account_id": None,
        "notes": None,
        "person_id": None,
    }
    body.update(over)
    return body


def card(name: str, sort_order: int = 0, is_active: bool = True) -> CreditCard:
    return CreditCard(
        name=name,
        slug=name.lower().replace(" ", "-"),
        annual_fee=Decimal("0"),
        rewards_currency="cash",
        point_value_cents=Decimal("1"),
        is_active=is_active,
        sort_order=sort_order,
    )


async def seed_cards(db) -> dict[str, int]:
    """Prod's shape (spec §0): every card at 0, so the list is in creation order; one is
    inactive; one has a limit history the reorder answer must carry like the GET does."""
    rows = [card("Venture X"), card("SavorOne"), card("Old Card", is_active=False)]
    db.add_all(rows)
    await db.flush()
    db.add(
        CreditLimitEvent(
            card_id=rows[1].id, effective_date=date(2024, 1, 1), limit_amount=Decimal("9000")
        )
    )
    await db.commit()
    return {row.name: row.id for row in rows}


async def seed_reward_categories(db) -> dict[str, int]:
    rows = [
        RewardCategory(name="Dining", slug="dining", sort_order=0),
        RewardCategory(name="Groceries", slug="groceries", sort_order=1),
        RewardCategory(name="Travel", slug="travel", sort_order=2, is_active=False),
    ]
    db.add_all(rows)
    await db.commit()
    return {row.name: row.id for row in rows}


async def test_both_reorders_require_auth(client):
    assert (await client.put(CARD_ORDER, json={"ids": [1]})).status_code == 401
    assert (await client.put(CATEGORY_ORDER, json={"ids": [1]})).status_code == 401


# ── cards ────────────────────────────────────────────────────────────────────────────


async def test_card_reorder_answers_exactly_as_the_list_get_does(auth_client, db):
    ids = await seed_cards(db)
    new = [ids["Old Card"], ids["SavorOne"], ids["Venture X"]]
    resp = await auth_client.put(CARD_ORDER, json={"ids": new})
    assert resp.status_code == 200, resp.text
    assert [(c["id"], c["sort_order"]) for c in resp.json()] == [
        (card_id, index) for index, card_id in enumerate(new)
    ]
    assert resp.json()[1]["current_limit"] == "9000.00"  # children ride along, as in the GET
    assert resp.json() == (await auth_client.get(CARDS)).json()
    assert (await db.execute(select(ChangeLog))).scalars().all() == []  # unlogged


async def test_an_unchanged_card_order_writes_nothing(auth_client, db):
    ids = await seed_cards(db)
    current = [ids["Venture X"], ids["SavorOne"], ids["Old Card"]]
    with flushed_updates(db, CreditCard) as written:
        resp = await auth_client.put(CARD_ORDER, json={"ids": current})
    assert resp.status_code == 200, resp.text
    assert [c["sort_order"] for c in resp.json()] == [0, 0, 0]  # not normalized
    assert written == set()


async def test_only_cards_whose_number_moves_are_written(auth_client, db):
    rows = [card("A", 0), card("B", 1), card("C", 2)]
    db.add_all(rows)
    await db.commit()
    a, b, c = (row.id for row in rows)
    with flushed_updates(db, CreditCard) as written:
        resp = await auth_client.put(CARD_ORDER, json={"ids": [a, c, b]})
    assert resp.status_code == 200, resp.text
    assert written == {b, c}


@pytest.mark.parametrize("shape", ["missing", "extra", "inactive left out"])
async def test_a_stale_card_list_409s_with_the_sentence(auth_client, db, shape):
    ids = await seed_cards(db)
    body = {
        "missing": [ids["SavorOne"], ids["Old Card"]],
        "extra": [ids["SavorOne"], ids["Venture X"], ids["Old Card"], 999],
        "inactive left out": [ids["SavorOne"], ids["Venture X"]],
    }[shape]
    resp = await auth_client.put(CARD_ORDER, json={"ids": body})
    assert resp.status_code == 409
    assert resp.json()["detail"] == STALE_CARDS
    assert [c["id"] for c in (await auth_client.get(CARDS)).json()] == [
        ids["Venture X"],
        ids["SavorOne"],
        ids["Old Card"],
    ]


async def test_a_repeated_card_id_422s_naming_it(auth_client, db):
    ids = await seed_cards(db)
    body = [ids["SavorOne"], ids["SavorOne"], ids["Venture X"], ids["Old Card"]]
    resp = await auth_client.put(CARD_ORDER, json={"ids": body})
    assert resp.status_code == 422
    assert resp.json()["detail"] == f"ids lists {ids['SavorOne']} more than once"


async def test_a_card_created_without_a_sort_order_appends(auth_client, db):
    first = await auth_client.post(CARDS, json=card_body("Venture X"))
    assert first.status_code == 201, first.text
    assert first.json()["sort_order"] == 0  # an empty table starts at 0
    db.add(card("Legacy", sort_order=6))
    await db.commit()
    second = await auth_client.post(CARDS, json=card_body("SavorOne"))
    assert second.json()["sort_order"] == 7
    nulled = await auth_client.post(CARDS, json=card_body("Freedom", sort_order=None))
    assert nulled.json()["sort_order"] == 8
    explicit = await auth_client.post(CARDS, json=card_body("Amex Gold", sort_order=2))
    assert explicit.json()["sort_order"] == 2


async def test_a_card_patch_without_a_sort_order_keeps_the_stored_one(auth_client, db):
    created = (await auth_client.post(CARDS, json=card_body("Venture X", sort_order=4))).json()
    url = f"{CARDS}/{created['id']}"
    omitted = await auth_client.patch(url, json=card_body("Venture X", annual_fee="0.00"))
    assert omitted.status_code == 200, omitted.text
    assert (omitted.json()["annual_fee"], omitted.json()["sort_order"]) == ("0.00", 4)
    nulled = await auth_client.patch(url, json=card_body("Venture X", sort_order=None))
    assert nulled.json()["sort_order"] == 4
    explicit = await auth_client.patch(url, json=card_body("Venture X", sort_order=1))
    assert explicit.json()["sort_order"] == 1  # full replace still honours a number


# ── reward categories ────────────────────────────────────────────────────────────────


async def test_reward_category_reorder_renumbers_and_matches_the_get(auth_client, db):
    ids = await seed_reward_categories(db)
    new = [ids["Travel"], ids["Dining"], ids["Groceries"]]
    resp = await auth_client.put(CATEGORY_ORDER, json={"ids": new})
    assert resp.status_code == 200, resp.text
    assert [(c["id"], c["sort_order"]) for c in resp.json()] == [
        (category_id, index) for index, category_id in enumerate(new)
    ]
    assert resp.json() == (await auth_client.get(f"{CARDS}/categories")).json()
    assert (await db.execute(select(ChangeLog))).scalars().all() == []  # unlogged


async def test_an_unchanged_reward_category_order_writes_nothing(auth_client, db):
    ids = await seed_reward_categories(db)
    current = [ids["Dining"], ids["Groceries"], ids["Travel"]]
    with flushed_updates(db, RewardCategory) as written:
        resp = await auth_client.put(CATEGORY_ORDER, json={"ids": current})
    assert resp.status_code == 200, resp.text
    assert [c["id"] for c in resp.json()] == current
    assert written == set()


async def test_only_reward_categories_whose_number_moves_are_written(auth_client, db):
    ids = await seed_reward_categories(db)
    with flushed_updates(db, RewardCategory) as written:
        resp = await auth_client.put(
            CATEGORY_ORDER, json={"ids": [ids["Groceries"], ids["Dining"], ids["Travel"]]}
        )
    assert resp.status_code == 200, resp.text
    assert written == {ids["Groceries"], ids["Dining"]}


@pytest.mark.parametrize("shape", ["missing", "extra"])
async def test_a_stale_reward_category_list_409s_with_the_sentence(auth_client, db, shape):
    ids = await seed_reward_categories(db)
    body = {
        "missing": [ids["Groceries"], ids["Dining"]],
        "extra": [ids["Groceries"], ids["Dining"], ids["Travel"], 999],
    }[shape]
    resp = await auth_client.put(CATEGORY_ORDER, json={"ids": body})
    assert resp.status_code == 409
    assert resp.json()["detail"] == STALE_REWARD


async def test_a_repeated_reward_category_id_422s_naming_it(auth_client, db):
    ids = await seed_reward_categories(db)
    body = [ids["Dining"], ids["Travel"], ids["Dining"], ids["Groceries"]]
    resp = await auth_client.put(CATEGORY_ORDER, json={"ids": body})
    assert resp.status_code == 422
    assert resp.json()["detail"] == f"ids lists {ids['Dining']} more than once"


async def test_a_reward_category_created_without_a_sort_order_appends(auth_client, db):
    first = await auth_client.post(f"{CARDS}/categories", json={"name": "Dining"})
    assert first.status_code == 201, first.text
    assert first.json()["sort_order"] == 0
    db.add(RewardCategory(name="Travel", slug="travel", sort_order=12))
    await db.commit()
    second = await auth_client.post(f"{CARDS}/categories", json={"name": "Gas"})
    assert second.json()["sort_order"] == 13
    explicit = await auth_client.post(
        f"{CARDS}/categories", json={"name": "Streaming", "sort_order": 3}
    )
    assert explicit.json()["sort_order"] == 3
```

- [ ] **Step 3: Run and watch them fail**

Run: `FINANCE_TEST_DB=finance_test_reorder_r1 $PY -m pytest tests/test_reorder_route_order.py tests/test_reorder_credit_cards_api.py -q`

Expected: `19 failed, 3 passed` — both new route-order cases (`ValueError: not enough values to
unpack (expected 1, got 0)`; the three earlier cases pass); the 14 tests that PUT (`405 Method Not
Allowed` — the card path only matches PATCH/DELETE `/{card_id}`, the category path PATCH/DELETE
`/categories/{category_id}`); the two create tests (`assert 0 == 7`, `assert 0 == 13`); and
`test_a_card_patch_without_a_sort_order_keeps_the_stored_one`
(`AssertionError: assert ('0.00', 0) == ('0.00', 4)` — the full replace writes the schema's
default 0).

- [ ] **Step 4: Make `sort_order` optional on the two bodies**

In `backend/app/schemas/credit_cards.py` (`CreditCardIn`), replace:

```python
    notes: str | None = Field(default=None, max_length=300)
    sort_order: int = Field(default=0, ge=0, le=1_000_000)
```

with:

```python
    notes: str | None = Field(default=None, max_length=300)
    # Omitted or null: a POST appends after the last card, a PATCH keeps the stored value
    # (2026-09-23 reorder spec §3.3). An explicit number is honoured by both.
    sort_order: int | None = Field(default=None, ge=0, le=1_000_000)
```

and (`RewardCategoryCreate`) replace:

```python
class RewardCategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    sort_order: int = Field(default=0, ge=0, le=1_000_000)
```

with:

```python
class RewardCategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    # Omitted or null = append after the last row (2026-09-23 reorder spec §3.3).
    sort_order: int | None = Field(default=None, ge=0, le=1_000_000)
```

- [ ] **Step 5: Write the routes and the defaults**

In `backend/app/api/credit_cards.py`, add directly after the `app.schemas.credit_cards` import
block (base line 32, after its closing `)`):

```python
from app.schemas.ordering import OrderIn
```

and directly after the `app.services.money` import block (base line 40, after its closing `)`):

```python
from app.services.ordering import (
    STALE_CARDS,
    STALE_REWARD_CATEGORIES,
    check_permutation,
    next_sort_order,
    renumber,
)
```

In `create_reward_category`, replace:

```python
    await _validated_category_refs(db, body.spending_category_id, body.pinned_card_id)
    category = RewardCategory(
        name=body.name,
        slug=slug,
        sort_order=body.sort_order,
```

with:

```python
    await _validated_category_refs(db, body.spending_category_id, body.pinned_card_id)
    sort_order = body.sort_order
    if sort_order is None:
        # No position given: append after the last row (2026-09-23 reorder spec §3.3).
        sort_order = (await db.execute(next_sort_order(RewardCategory.sort_order))).scalar_one()
    category = RewardCategory(
        name=body.name,
        slug=slug,
        sort_order=sort_order,
```

Insert directly after `create_reward_category` and before
`@router.patch("/categories/{category_id}", …)`:

```python
@router.put("/categories/order", response_model=list[RewardCategoryOut])
async def reorder_reward_categories(
    body: OrderIn, db: AsyncSession = Depends(get_db)
) -> list[RewardCategory]:
    """Drag-to-reorder the Categories & weights rows (2026-09-23 spec §3.2): `ids` is every
    reward category in its new order; sort_order becomes 0…n−1 in ONE transaction, and only
    rows whose value moves are written. Unlogged like the rest of this router — the client's
    Undo re-sends the previous order. Declared before /categories/{category_id}."""
    categories = list(
        (
            await db.execute(
                select(RewardCategory).order_by(RewardCategory.sort_order, RewardCategory.id)
            )
        ).scalars()
    )
    current = [category.id for category in categories]
    check_permutation(current, body.ids, stale_detail=STALE_REWARD_CATEGORIES)
    if body.ids == current:
        return categories
    by_id = {category.id: category for category in categories}
    ordered = [by_id[category_id] for category_id in body.ids]
    renumber(ordered, "sort_order", start=0, step=1)
    await db.commit()
    return ordered
```

Insert directly after `_one_card_out` (base line 348) and before `_validated_card_values`:

```python
async def _cards_out(db: AsyncSession, cards: list[CreditCard]) -> list[CreditCardOut]:
    """The list GET's wire for these cards, in this order. The reorder PUT answers through
    it too, so its rows are built exactly as `GET /credit-cards` builds them."""
    credits, events = await _card_children(db, [card.id for card in cards])
    return [_card_out(card, credits[card.id], events[card.id]) for card in cards]
```

Replace `list_credit_cards`, `create_credit_card` and the head of `update_credit_card` (base lines
408-438):

```python
@router.get("", response_model=list[CreditCardOut])
async def list_credit_cards(db: AsyncSession = Depends(get_db)) -> list[CreditCardOut]:
    cards = list(
        (await db.execute(select(CreditCard).order_by(CreditCard.sort_order, CreditCard.id)))
        .scalars()
        .all()
    )
    credits, events = await _card_children(db, [card.id for card in cards])
    return [_card_out(card, credits[card.id], events[card.id]) for card in cards]


@router.post("", response_model=CreditCardOut, status_code=201)
async def create_credit_card(
    body: CreditCardIn, db: AsyncSession = Depends(get_db)
) -> CreditCardOut:
    values = await _validated_card_values(db, body, card_id=None)
    card = CreditCard(**values)
    db.add(card)
    await db.commit()
    return await _one_card_out(db, card)


@router.patch("/{card_id}", response_model=CreditCardOut)
async def update_credit_card(
    card_id: int, body: CreditCardIn, db: AsyncSession = Depends(get_db)
) -> CreditCardOut:
    """Full replace (house style) — the client sends the whole card back."""
    card = await _get_card(db, card_id)
    values = await _validated_card_values(db, body, card_id=card_id)
    for field, value in values.items():
```

with:

```python
@router.get("", response_model=list[CreditCardOut])
async def list_credit_cards(db: AsyncSession = Depends(get_db)) -> list[CreditCardOut]:
    cards = list(
        (await db.execute(select(CreditCard).order_by(CreditCard.sort_order, CreditCard.id)))
        .scalars()
        .all()
    )
    return await _cards_out(db, cards)


@router.post("", response_model=CreditCardOut, status_code=201)
async def create_credit_card(
    body: CreditCardIn, db: AsyncSession = Depends(get_db)
) -> CreditCardOut:
    values = await _validated_card_values(db, body, card_id=None)
    if values["sort_order"] is None:
        # No position given: append after the last card (2026-09-23 reorder spec §3.3).
        values["sort_order"] = (
            await db.execute(next_sort_order(CreditCard.sort_order))
        ).scalar_one()
    card = CreditCard(**values)
    db.add(card)
    await db.commit()
    return await _one_card_out(db, card)


@router.put("/order", response_model=list[CreditCardOut])
async def reorder_credit_cards(
    body: OrderIn, db: AsyncSession = Depends(get_db)
) -> list[CreditCardOut]:
    """Drag-to-reorder the card list (2026-09-23 spec §3.2): `ids` is every card, active
    and inactive, in its new order; sort_order becomes 0…n−1 in ONE transaction, and only
    rows whose value moves are written. Answers exactly as the list GET does. Unlogged like
    the rest of this router — the client's Undo re-sends the previous order. Declared
    before the /{card_id} routes."""
    cards = list(
        (await db.execute(select(CreditCard).order_by(CreditCard.sort_order, CreditCard.id)))
        .scalars()
        .all()
    )
    current = [card.id for card in cards]
    check_permutation(current, body.ids, stale_detail=STALE_CARDS)
    if body.ids != current:
        by_id = {card.id: card for card in cards}
        cards = [by_id[card_id] for card_id in body.ids]
        renumber(cards, "sort_order", start=0, step=1)
        await db.commit()
    return await _cards_out(db, cards)


@router.patch("/{card_id}", response_model=CreditCardOut)
async def update_credit_card(
    card_id: int, body: CreditCardIn, db: AsyncSession = Depends(get_db)
) -> CreditCardOut:
    """Full replace (house style) — the client sends the whole card back, except that an
    absent or null sort_order keeps the stored one (2026-09-23 reorder spec §3.3): the
    list's drag owns that column, and an edit form holding a stale copy must not undo it."""
    card = await _get_card(db, card_id)
    values = await _validated_card_values(db, body, card_id=card_id)
    if values["sort_order"] is None:
        del values["sort_order"]
    for field, value in values.items():
```

(`_validated_card_values` keeps returning `"sort_order": body.sort_order` — enumeration site 2 of
2 is unchanged; the create and the patch decide what `None` means.)

- [ ] **Step 6: Run and watch them pass**

Run: `FINANCE_TEST_DB=finance_test_reorder_r1 $PY -m pytest tests/test_reorder_route_order.py tests/test_reorder_credit_cards_api.py tests/test_credit_cards_api.py tests/test_models_credit_cards.py -q`

Expected: all pass — route order 5, credit-card reorder 17, and the existing credit-card suites
unchanged (their `card_body` sends an explicit `sort_order: 0`, which is still honoured).

- [ ] **Step 7: Lint and commit**

```bash
$PY -m ruff check app tests && $PY -m ruff format --check app tests
git add app/schemas/credit_cards.py app/api/credit_cards.py tests/test_reorder_route_order.py tests/test_reorder_credit_cards_api.py
git commit -m "feat(credit-cards): PUT /credit-cards/order and /categories/order; a create appends, a PATCH keeps sort_order"
```

---

## Task 10 — the client side of the contract (spec §3.6)

All commands in this task run from the worktree ROOT
(`C:/Users/edyli/personal-finance-dashboard/.worktrees/reorder-r1`).

**Files:**
- Modify: `src/types/api.ts:32-40` (`AccountCreate`), `:194-199` (`CategoryCreate`), after `:411`
  (`TransactionUpdate`), `:2179` (`CreditCardIn.sort_order`), `:2194-2200` (`RewardCategoryCreate`)
- Modify: `src/api/netWorth.ts` (after `deleteAccount`, base line 38), `src/api/spending.ts` (after
  `deleteCategory`, base line 37), `src/api/portfolio.ts` (type import; after `deleteTransaction`,
  base line 75), `src/api/creditCards.ts` (after `deleteCreditCard`, base line 31; after
  `deleteRewardCategory`, base line 90)
- Modify: `src/api/netWorth.test.ts`, `src/api/spending.test.ts`, `src/api/portfolio.test.ts`
- Create: `src/api/creditCards.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/api/netWorth.test.ts`, replace:

```ts
import { deleteMonthBalances, fetchSummary, fetchTimeseries, putMonthBalances } from './netWorth'
```

with:

```ts
import {
  deleteMonthBalances,
  fetchSummary,
  fetchTimeseries,
  putMonthBalances,
  reorderAccounts,
} from './netWorth'
```

and append at the end of the file:

```ts

// Drag-to-reorder (2026-09-23 spec §3.2, §3.6): one PUT with the whole new order, and the
// change batch read back so the Undo toast can revert it — null when nothing was logged.
it('reorderAccounts PUTs every id in its new order and reads the change batch', async () => {
  const rows = [
    { id: 7, sort_order: 0 },
    { id: 3, sort_order: 1 },
  ]
  vi.mocked(apiWithHeaders).mockResolvedValue({
    data: rows,
    headers: new Headers({ 'X-Change-Batch': 'b-order' }),
  })
  expect(await reorderAccounts([7, 3])).toEqual({ data: rows, batchId: 'b-order' })
  expect(vi.mocked(apiWithHeaders).mock.calls[0]).toEqual([
    '/net-worth/accounts/order',
    { method: 'PUT', body: '{"ids":[7,3]}' },
  ])
  vi.mocked(apiWithHeaders).mockResolvedValue({ data: rows, headers: new Headers() })
  expect((await reorderAccounts([7, 3])).batchId).toBeNull()
})
```

In `src/api/spending.test.ts`, replace:

```ts
import { deleteSpendingMonth, putSpendingMonth } from './spending'
```

with:

```ts
import { deleteSpendingMonth, putSpendingMonth, reorderCategories } from './spending'
```

and append at the end of the file:

```ts

// Drag-to-reorder (2026-09-23 spec §3.2, §3.6): one PUT with the whole new order; the change
// batch rides the X-Change-Batch header, null when the order was unchanged.
it('reorderCategories PUTs every id in its new order and reads the change batch', async () => {
  const rows = [
    { id: 4, sort_order: 0 },
    { id: 2, sort_order: 1 },
  ]
  vi.mocked(apiWithHeaders).mockResolvedValue({
    data: rows,
    headers: new Headers({ 'X-Change-Batch': 'b-cat' }),
  })
  expect(await reorderCategories([4, 2])).toEqual({ data: rows, batchId: 'b-cat' })
  expect(vi.mocked(apiWithHeaders).mock.calls[0]).toEqual([
    '/spending/categories/order',
    { method: 'PUT', body: '{"ids":[4,2]}' },
  ])
  vi.mocked(apiWithHeaders).mockResolvedValue({ data: rows, headers: new Headers() })
  expect((await reorderCategories([4, 2])).batchId).toBeNull()
})
```

In `src/api/portfolio.test.ts`, replace:

```ts
  fetchTransactions,
  patchPortfolioAccount,
} from './portfolio'
```

with:

```ts
  fetchTransactions,
  patchPortfolioAccount,
  reorderTransactions,
} from './portfolio'
```

and append at the end of the file:

```ts

// The replay-order PUT (2026-09-23 spec §3.2, §3.6) is judged against exactly the rows
// fetchTransactions(owner) returned, so it carries the SAME owner query — built by the same
// helper, household sending none at all.
it('reorderTransactions PUTs the visible ids under the scope they were fetched in', async () => {
  await reorderTransactions([3, 1, 2], null)
  expect(path()).toBe('/portfolio/transactions/order')
  expect(init()).toEqual({ method: 'PUT', body: '{"ids":[3,1,2]}' })
  vi.clearAllMocks()
  await reorderTransactions([5, 4], 7)
  expect(path()).toBe('/portfolio/transactions/order?owner=7')
  vi.clearAllMocks()
  await reorderTransactions([9], 'joint')
  expect(path()).toBe('/portfolio/transactions/order?owner=joint')
})

it('reorderTransactions hands back the server answer untouched', async () => {
  const answer = {
    transactions: [],
    changed_positions: [
      {
        security_id: 1,
        ticker: 'VOO',
        account: 'Mine',
        shares_before: '6.000000',
        shares_after: '6.000000',
        cost_basis_before: '300.00',
        cost_basis_after: '500.00',
        realized_gl_before: '120.00',
        realized_gl_after: '320.00',
        warnings_added: ['txn 7: sell with no held shares'],
      },
    ],
  }
  vi.mocked(api).mockResolvedValue(answer)
  expect(await reorderTransactions([7, 6], null)).toEqual(answer)
})
```

Create `src/api/creditCards.test.ts`:

```ts
import { beforeEach, expect, it, vi } from 'vitest'
import { reorderCreditCards, reorderRewardCategories } from './creditCards'

// Only the transport is stubbed — the request this module builds IS the test
// (src/api/netWorth.test.ts's posture).
vi.mock('./client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./client')>()),
  api: vi.fn(),
}))
import { api } from './client'

beforeEach(() => vi.clearAllMocks())

// Drag-to-reorder (2026-09-23 spec §3.2, §3.6): one PUT with the whole new order. Both routes
// are unlogged, so there is no change batch to read — the answer is the list itself.
it('reorderCreditCards PUTs every card id in its new order and returns the list', async () => {
  const cards = [{ id: 9 }, { id: 4 }]
  vi.mocked(api).mockResolvedValue(cards)
  expect(await reorderCreditCards([9, 4])).toEqual(cards)
  expect(vi.mocked(api).mock.calls[0]).toEqual([
    '/credit-cards/order',
    { method: 'PUT', body: '{"ids":[9,4]}' },
  ])
})

it('reorderRewardCategories PUTs every category id in its new order', async () => {
  const categories = [{ id: 2 }, { id: 5 }, { id: 1 }]
  vi.mocked(api).mockResolvedValue(categories)
  expect(await reorderRewardCategories([2, 5, 1])).toEqual(categories)
  expect(vi.mocked(api).mock.calls[0]).toEqual([
    '/credit-cards/categories/order',
    { method: 'PUT', body: '{"ids":[2,5,1]}' },
  ])
})
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run src/api/netWorth.test.ts src/api/spending.test.ts src/api/portfolio.test.ts src/api/creditCards.test.ts`

Expected: `Tests  6 failed | 17 passed (23)` — the six new tests fail with
`TypeError: reorderAccounts is not a function` (and the same for `reorderCategories`,
`reorderTransactions` ×2, `reorderCreditCards`, `reorderRewardCategories`); the 17 existing tests
in those files pass.

- [ ] **Step 3: Add the wire types**

In `src/types/api.ts`:

In `AccountCreate`, replace:

```ts
export interface AccountCreate {
  name: string
  group: AccountGroup
  sort_order?: number
```

with:

```ts
export interface AccountCreate {
  name: string
  group: AccountGroup
  /** Omitted = appended after the last account (2026-09-23 reorder spec §3.3). */
  sort_order?: number
```

In `CategoryCreate`, replace:

```ts
export interface CategoryCreate {
  name: string
  sort_order?: number
```

with:

```ts
export interface CategoryCreate {
  name: string
  /** Omitted = appended after the last category (2026-09-23 reorder spec §3.3). */
  sort_order?: number
```

Directly after `export type TransactionUpdate = Partial<Omit<TransactionCreate, 'security_id'>>`
(and before `export interface DividendOut`), insert:

```ts

/** One position whose figures a replay-order change moved (2026-09-23 reorder spec §3.2).
 *  The server quantizes before it answers — shares are 6-dp strings, money 2-dp strings —
 *  so the browser shows them as sent and never recomputes one. `warnings_added` holds only
 *  the lines the new order introduced. */
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

/** PUT /portfolio/transactions/order's answer: the rows the scope shows, in their new order,
 *  and every position whose figures changed, ordered by (ticker, account) — empty when a
 *  move re-folded nothing. */
export interface TransactionOrderOut {
  transactions: TransactionOut[]
  changed_positions: PositionChange[]
}
```

In `CreditCardIn`, replace its last field:

```ts
  account_id: number | null
  notes: string | null
  sort_order: number
}

export interface RewardCategoryOut {
```

with:

```ts
  account_id: number | null
  notes: string | null
  /** Omitted or null: a create appends after the last card; an edit keeps the stored
   *  value — the list's drag owns it (2026-09-23 reorder spec §3.3). */
  sort_order?: number | null
}

export interface RewardCategoryOut {
```

In `RewardCategoryCreate`, replace:

```ts
export interface RewardCategoryCreate {
  name: string
  sort_order?: number
```

with:

```ts
export interface RewardCategoryCreate {
  name: string
  /** Omitted = appended after the last row (2026-09-23 reorder spec §3.3). */
  sort_order?: number
```

- [ ] **Step 4: Add the five functions**

In `src/api/netWorth.ts`, insert directly after `deleteAccount` (and before the `OwnerScope`
comment):

```ts

/** Drag-to-reorder (2026-09-23 spec §3.2): `ids` is EVERY account, retired included, in its
 *  new order. The answer is the whole list in that order; `batchId` is the change batch the
 *  Undo toast reverts, null when the order was unchanged and nothing was logged. A 409
 *  carries the server's "changed since this list was loaded" sentence. */
export async function reorderAccounts(
  ids: number[],
): Promise<{ data: AccountOut[]; batchId: string | null }> {
  const { data, headers } = await apiWithHeaders<AccountOut[]>('/net-worth/accounts/order', {
    method: 'PUT',
    body: JSON.stringify({ ids }),
  })
  return { data, batchId: headers.get('x-change-batch') }
}
```

In `src/api/spending.ts`, insert directly after `deleteCategory` (and before `fetchMatrix`):

```ts

/** Drag-to-reorder (2026-09-23 spec §3.2): `ids` is EVERY category, retired included, in its
 *  new order. `batchId` is the change batch the Undo toast reverts — null when the order was
 *  unchanged and nothing was logged. */
export async function reorderCategories(
  ids: number[],
): Promise<{ data: CategoryOut[]; batchId: string | null }> {
  const { data, headers } = await apiWithHeaders<CategoryOut[]>('/spending/categories/order', {
    method: 'PUT',
    body: JSON.stringify({ ids }),
  })
  return { data, batchId: headers.get('x-change-batch') }
}
```

In `src/api/portfolio.ts`, in the `import type { … } from '../types/api'` list, replace:

```ts
  TransactionCreate,
  TransactionOut,
  TransactionUpdate,
} from '../types/api'
```

with:

```ts
  TransactionCreate,
  TransactionOrderOut,
  TransactionOut,
  TransactionUpdate,
} from '../types/api'
```

and insert directly after `deleteTransaction` (and before `fetchDividends`):

```ts

/** Change the REPLAY order (2026-09-23 spec §3.2): `ids` is every row fetchTransactions(owner)
 *  returned, in its new order, and `owner` is that same scope — the server judges the ids
 *  against exactly those rows, so the scope is required rather than defaulted (a forgotten
 *  one would earn a 409, not a reorder). Unlogged server-side: the caller's Undo re-sends
 *  the previous order through this same function. */
export function reorderTransactions(
  ids: number[],
  owner: OwnerScope,
): Promise<TransactionOrderOut> {
  return api<TransactionOrderOut>(`/portfolio/transactions/order${ownerQuery(owner, '?')}`, {
    method: 'PUT',
    body: JSON.stringify({ ids }),
  })
}
```

In `src/api/creditCards.ts`, insert directly after `deleteCreditCard` (and before
`createCardCredit`):

```ts

/** Drag-to-reorder the card list (2026-09-23 spec §3.2): `ids` is every card, active and
 *  inactive, in its new order; the answer is the list exactly as fetchCreditCards returns it.
 *  Unlogged server-side — the caller's Undo re-sends the previous order. */
export function reorderCreditCards(ids: number[]): Promise<CreditCardOut[]> {
  return api<CreditCardOut[]>('/credit-cards/order', {
    method: 'PUT',
    body: JSON.stringify({ ids }),
  })
}
```

and directly after `deleteRewardCategory` (and before `fetchRewardRates`):

```ts

/** One PUT for the whole Categories & weights order (2026-09-23 spec §3.2) — it replaces the
 *  per-row PATCH chain. `ids` is every reward category in its new order. Unlogged server-side;
 *  the caller's Undo re-sends the previous order. */
export function reorderRewardCategories(ids: number[]): Promise<RewardCategoryOut[]> {
  return api<RewardCategoryOut[]>('/credit-cards/categories/order', {
    method: 'PUT',
    body: JSON.stringify({ ids }),
  })
}
```

(`api`, `apiWithHeaders`, `AccountOut`, `CategoryOut`, `OwnerScope`, `ownerQuery`, `CreditCardOut`
and `RewardCategoryOut` are already imported or defined in those modules.)

- [ ] **Step 5: Run and watch them pass; type-check and lint**

```bash
npx vitest run src/api/netWorth.test.ts src/api/spending.test.ts src/api/portfolio.test.ts src/api/creditCards.test.ts
npx tsc -b
npx eslint .
```

Expected: `Test Files 4 passed (4)`, `Tests 23 passed (23)`; `tsc -b` and `eslint .` exit 0 with no
output. (`CardsPanel.tsx` still builds a `CreditCardIn` with `sort_order: stored?.sort_order ?? 0`
— legal against the optional field; R5 changes that call site, not this lane.)

- [ ] **Step 6: Commit**

```bash
git add src/types/api.ts src/api/netWorth.ts src/api/spending.ts src/api/portfolio.ts src/api/creditCards.ts src/api/netWorth.test.ts src/api/spending.test.ts src/api/portfolio.test.ts src/api/creditCards.test.ts
git commit -m "feat(api): the reorder client contract — five PUT functions and the TransactionOrderOut wire types"
```

---

## Task 11 — full gates and the results

- [ ] **Step 1: Backend lint and the full suite** (cwd `backend`)

```bash
$PY -m ruff check app tests alembic/versions/20260923_0900_f12026092301_position_transactions_import_key.py
$PY -m ruff format --check app tests alembic/versions/20260923_0900_f12026092301_position_transactions_import_key.py
FINANCE_TEST_DB=finance_test_reorder_r1 $PY -m pytest -q
```

Expected: ruff clean; pytest exit 0 (record `N passed, M skipped` below). A failure outside the
files this plan touches: re-run that file alone once — if it passes alone it is a known flake;
record it and move on; if it fails alone, stop and diagnose (systematic-debugging).

- [ ] **Step 2: Migration state** (cwd `backend`)

```bash
$PY -m alembic heads
DATABASE_URL=postgresql+asyncpg://finance:finance@localhost:5433/finance_test_reorder_r1_mig $PY -m alembic check
```

Expected: `f12026092301 (head)` alone; `No new upgrade operations detected.`

- [ ] **Step 3: Frontend gates** (cwd worktree root)

```bash
npx vitest run
npx tsc -b
npx eslint .
npx vite build
```

Expected: every command exits 0 (record the vitest file/test counts below).

- [ ] **Step 4: Branch hygiene**

```bash
git status --short
git log --oneline feat/reorder-base..HEAD
```

Expected: a clean tree (bar an untracked `node_modules` symlink, as in Task 0); the lane's commits
(Tasks 1–10, plus the results commit below).

- [ ] **Step 5: Fill in the Results section below and commit it**

```bash
git add docs/superpowers/plans/2026-09-23-reorder-r1-backend.md
git commit -m "docs(plan): lane R1 results — gates, drill, counts"
```

- [ ] **Step 6: Report to the controller** — commits, test counts, the drill outcome, anything the
  plan did not anticipate, and confirmation that the shipped wire shapes match "Contracts this lane
  publishes" verbatim (R2, R3 and R5 start from them).

---

## Results (filled in by the implementer in Task 11)

Implemented 2026-09-23 on `feat/reorder-backend`, cut from `feat/reorder-base` @d5b2ba5 (its
`backend/` and `src/` are byte-identical to the @b3a55d2 this plan was replayed on — checked with
`git diff --stat` before Task 1).

- Commits on `feat/reorder-backend` (Tasks 1–10 — Task 8 commits twice — with the plan's messages
  verbatim):
  - `b526f36` feat(ordering): pure reorder helpers — permutation check, slot-preserving subset,
    renumber, minimal moved set
  - `b8c1887` feat(ordering): OrderIn, the one body every reorder route takes
  - `48125ff` feat(ordering): PUT /net-worth/accounts/order — one change batch, §8.4 labels, Undo
    on the Activity card
  - `fa79ea6` feat(ordering): PUT /spending/categories/order — logged like the accounts, §8.4 labels
  - `5135c9a` feat(ordering): new accounts and categories append instead of taking 0; a group change
    appends
  - `44116e8` feat(portfolio): position_transactions.import_key + partial unique index (migration
    f12026092301)
  - `11ec28f` feat(importer): order belongs to the user — create-only sort_order, sheet rows matched
    by import_key and appended
  - `03d39cc` feat(ordering): position_changes — what a replay-order move did to each holding
  - `f6c5e3b` feat(portfolio): PUT /portfolio/transactions/order — scoped slots, whole-ledger
    renumber, figure report
  - `5e8ac95` feat(credit-cards): PUT /credit-cards/order and /categories/order; a create appends,
    a PATCH keeps sort_order
  - `6c8cfe4` feat(api): the reorder client contract — five PUT functions and the
    TransactionOrderOut wire types
  - plus this results commit.
- TDD trail: every "watch it fail" step printed the plan's expected failure (Task 0 baseline
  `57 passed`; T1 `ModuleNotFoundError`; T2 `ModuleNotFoundError`; T3 `16 failed, 1 passed`; T4
  `14 failed, 2 passed`; T5 `ImportError` then `3 failed, 27 passed`; T6 `1 failed, 7 passed`
  (`TypeError`); T7 `9 failed, 44 passed`; T8 `ImportError` then `14 failed, 2 passed`; T9
  `19 failed, 3 passed`; T10 `6 failed | 17 passed (23)`), and every pass step printed the plan's
  count (20; 4; 17 + neighbours 73; 16 + spending 44; 51 + neighbours 117; 55 = 8 + 47; importer
  suites 109 with `test_importer_apply.py` at 53; 25; 77 = 3 + 13 + 47 + 14; 48; 23).
- Extra check (scratch, not committed): `moved_ids` brute-forced against its definition — the
  complement of the lexicographically smallest (by new-order index) longest increasing subsequence
  of old positions — on all 5 914 permutations of n = 0…7: identical.
- Backend: `FINANCE_TEST_DB=finance_test_reorder_r1 $PY -m pytest -q` → `2118 passed, 1 skipped
  in 2995.78s (0:49:55)`, exit 0 — every one of the 2 119 tests `--collect-only` finds, in one run,
  with no flake to re-run (`test_assistant_evidence.py::test_total_budget_includes_context_loading`,
  listed as failing on this box before the lane began, passed too). The run shared the machine with
  another session's full suite and, for four minutes, this lane's full vitest. `ruff check` and
  `ruff format --check` over `app`, `tests` and the migration: clean.
- Contract check: the app's generated OpenAPI shows the five `PUT …/order` paths (PUT only), body
  `OrderIn` (`ids`: 1…10 000 integers), 200 models `list[AccountOut]`, `list[CategoryOut]`,
  `TransactionOrderOut`, `list[CreditCardOut]`, `list[RewardCategoryOut]`, the optional `owner`
  query on the transactions route only, `sort_order` nullable with 0…1 000 000 bounds on the four
  create bodies, and no `import_key` on `TransactionOut` — the "Contracts" section, unchanged.
- Migration drill on `finance_test_reorder_r1_mig`: the `finance_realdata` census printed
  `duplicate import sort_index: [] | import rows: 26`; `alembic heads` → `f12026092301 (head)`; the
  offline SQL matched Step 6 line for line; upgrade to `f12026091203`, seed, `upgrade head` →
  `[('import', 30, 30), ('import', 40, 40), ('ui', 50, None)]` and `duplicate import_key refused
  by ux_position_txn_import_key`; `downgrade -1` → `import_key after downgrade: []` (index gone
  too); `upgrade head` → the same two lines again; `alembic check` → `No new upgrade operations
  detected.` (in Task 6 and again in Task 11).
- Frontend: `npx vitest run` → 232 of 234 files, 3 130 of 3 132 tests, while two backend suites
  loaded the machine; the two failures pass alone — `PaycheckPage … names the employer match under
  the waterfall` (the known load flake; the file 84/84 alone) and `CategoriesCard … retires and
  restores without touching the other columns` (1 247 ms against `waitFor`'s 1 000 ms default; the
  file 13/13 alone; it imports nothing this lane changed beyond a doc comment on `CategoryCreate`).
  The four `src/api` files: 23/23. `tsc -b` exit 0; `eslint .` exit 0; `vite build` exit 0.
- Deviations from this plan, each with its reason — none in code or tests. Two process notes:
  (1) the full backend suite was started right after Task 9's commit (the last backend change) and
  ran while Task 10 (`src/` only) was done, so it tested the final backend tree; (2) `eslint .`
  printed 26 warnings where Task 10 expected no output — all pre-existing
  `react-refresh/only-export-components` notes in files this lane does not touch (exit 0 either
  way; the lane's nine `src/` files lint with no output).
- Left for the morning list: the drill database `finance_test_reorder_r1_mig` and the test database
  `finance_test_reorder_r1` (never dropped by the lane).

### Code-quality review round (2026-09-23): approve after fixes

Six findings. Each was fixed test-first in its own commit. The contracts are unchanged: the same
routes, bodies, answers and label strings; only which label case applies changed (decision 2).

- **Item 6 — no-op tests could pass with rows dirtied but never flushed** (`fe1d71a`).
  - `assert not db.dirty` now follows the PUT in all five no-op tests.
  - A scratch mutation (the accounts no-op setting each `sort_order` to itself) passed the old
    test and fails the new one.
  - The reward-category no-op seeds its own gap and tie, since the shared seed was already 0, 1, 2
    and could not tell an echo from a renumber.
- **Item 4 — a key-less import row's delete sample printed `[None]`** (`2ab0ae9`). It now reads
  `position_transactions[id <id>]: deleted (no sheet key)`, pinned.
- **Item 5 — duplicated reorder logic** (`afe82fd`).
  - `apply_order(rows, ids, *, stale_detail)` does the check, the no-op and the renumber for the
    four sort_order PUTs; the cards route loses its inverted branch.
  - `in_list_order(model)` is shared by each of those lists' GET and PUT.
  - `next_sort_index()` and `SORT_INDEX_STEP` replace both `coalesce(max(sort_index), 0)` copies
    and the reorder's 10/10 spacing.
  - All three are unit-tested; every route suite passes unchanged (311 tests).
- **Item 1 — concurrent reorders merged row by row** (`6ed1a0b`).
  - `services.ordering.order_lock(model)`, i.e. `pg_advisory_xact_lock(hashtext('reorder:<table>'))`,
    is the first statement of all five reorder routes.
  - It is also taken before every append reads its max: the four creates without a `sort_order`,
    the group-change PATCH (which locks before it reads the row, so its before-image is fresh), and
    the UI transaction create.
  - The importer takes all three of its lists' locks once, at the start of its apply phase
    (`apply.lock_ordered_lists`, called from `service.run_import`).
  - Since the re-review, `undo_batch` also takes the order locks of the lists its batch touches
    (see the next section).
  - Two-session races (`tests.ordering_helpers.race`) park the first request at COMMIT and open the
    gate once the second has finished or is seen waiting on an advisory lock in `pg_locks`. They are
    deterministic both ways.
  - Red before the fix:
    - accounts `B0 D0 A1 C3`, the reviewer's case;
    - ledger `t2 10, t4 10`;
    - a new card on 1 beside Y.
  - Green after:
    - the later request wins whole;
    - its batch's before-images are fresh, and its Undo lands exactly on the first request's order;
    - a create racing a reorder appends after it.
  - Recorded-SQL pins prove the lock comes first in every route, every append path and the importer.
  - Decision 16 amended.
- **Item 3 — labels named the minimal set before the natural explanation** (`ecc3563`).
  - `moved_alone(old, new, head, carried)` holds when removing the block leaves the rest identical
    AND the head itself moved among the rest.
  - A parent and its component moved up 1, 2 and 4 rows is "Moved account P". Before the fix, up 1
    read "Moved account D" and up 2 read "Reordered 2 accounts".
  - A component shuffled under its unmoved parent names itself, not the parent.
  - Decision 2 and the label table amended.
- **Item 2 — importer identity when sheet rows shift** (`4add1de`).
  - Matching now runs content first, then same-key edits of the same security, account and type,
    then creates and deletes.
  - Moving keys are cleared (and gone rows deleted) in one flush before any key is written.
  - A re-key counts as an update, sampled `kept (was <old>)`.
  - New tests:
    - mid-sheet insertion: every original row keeps its id, trade and position (red before:
      `(2, 1, 1, 1)`, with the Fido sell poured into the Mystery Fund row);
    - a same-trade edit is made in place;
    - an identity change (security, account or type) is a delete plus an append (red before: edited
      in place);
    - identical trades stay stable, both still and when shifted (red before: row 1's trade
      rewritten);
    - a first import is unchanged;
    - a key-less row whose trade is on the sheet is kept and keyed.
  - Decision 11 amended.

Gates after the round:
- **The full backend suite**, the single run at `4add1de`:
  - Claude Code's memory-pressure reaper stopped it at about 99%; the machine was critically low
    on memory, which the notice says is not a failure of the run. It printed no summary line.
  - Up to that point its progress held one F:
    `test_assistant_evidence.py::test_total_budget_includes_context_loading`, the pre-existing
    failure. It fails alone on this box too (its `is_set()` timing assertion); the first full run
    happened to pass it.
  - Every other test it reached passed.
  - Per the coordinator it was not restarted: lane V runs the full suite on the merged branch.
- `ruff check` and `ruff format --check` clean over `app`, `tests` and the migration.
- The four `src/api` files 23/23 (no `src/` file changed this round); `tsc -b` exit 0; `eslint .`
  exit 0 (the same 26 pre-existing warnings).

### Re-review round (2026-09-23): approve once one importer bug is fixed

- **The content pass could steal an identical trade** (`d15938a`).
  - Content matching now runs in two passes, both over every sheet row: 1a the identical trade
    still holding its own key, then 1b an identical trade at another key, earliest in replay
    order. Steps 2–4 are unchanged.
  - Before the fix, the reviewer's typo scenario gave 1 create, 1 update and 1 delete:
    - the edited row was deleted, losing its replay position;
    - the key-40 row was re-keyed into its place;
    - a copy was appended after the sell, which then read "sell exceeds held shares".
  - Now it is exactly one in-place edit (0, 1, 0, 3), with every id, key and position kept and a
    clean fold.
  - A sheet-row swap test (keys pass between two kept rows) joins the insertion and copy tests.
- **Undo takes the order locks** (`5f60dfd`).
  - `undo_batch` takes the order locks of the lists its batch touches (`accounts`,
    `spending_categories`) first: in `services.ordering.ORDERED_LISTS`' fixed order (now the
    importer's source of truth too), and before `lock_review_inputs`.
  - Proven per list: while another session holds the order lock, the Undo times out on a 200 ms
    `lock_timeout` having changed nothing, and succeeds once the lock is released.
  - An Undo of a batch outside those lists (a budget row) never waits on them.
- Gates after the re-review (no second full suite, per the coordinator; lane V runs it on the
  merged branch): the affected files, 308 passed.
  - Importer — 119: `test_importer_apply` (63), `test_importer_service`, `test_import_api`,
    `test_import_trail` and `test_importer_parsers`.
  - Changelog and Undo — 56: `test_changelog_service`, `test_changelog_routes`,
    `test_changelog_pin`, `test_activity_api`, `test_month_review_api` and
    `test_allocation_experience`.
  - The four reorder route files — 64.
  - Ordering — 69: `test_reorder_serialization` (18), `test_ordering_service` (42),
    `test_schemas_ordering` (4) and `test_reorder_route_order` (5).
  - `ruff check` and `ruff format --check` clean over `app`, `tests` and the migration.
  - The reviewer's scenario script (A–F), replayed through the real `apply_positions` on
    `finance_test_reorder_r1`:
    - the typo fix is (0, 1, 0, 3) with a clean fold;
    - insertion, copies and swap re-key without deletes;
    - the same-trade edit is made in place;
    - the identity change is a delete plus an append.

---

## Self-review — every R1 requirement mapped to a task

| Spec | Requirement | Task |
|---|---|---|
| §3.1 | `check_permutation`: 422 "ids lists {id} more than once"; 409 with the list's stale sentence | 1 |
| §3.1 | `subset_in_slots`: visible rows in their new order into their own positions, hidden rows keep theirs | 1 |
| §3.1 | `renumber`: writes only differing values, returns `(row, old, new)` | 1 |
| §3.1 | `moved_ids`: complement of an LIS; ties keep the earliest rows; adjacent swap names one row | 1 (decision 1) |
| §3.2 | `OrderIn { ids }`, 1 ≤ len ≤ 10 000, complete new order; unchanged order = 200, same list, no batch | 2; no-op tests in 3, 4, 8, 9 |
| §3.2 | accounts route: every account, `0…n−1`, `list[AccountOut]` + `X-Change-Batch`, logged | 3 |
| §3.2 | categories route: every category, `0…n−1`, `list[CategoryOut]` + header, logged | 4 |
| §3.2 | transactions route: GET's filter, slot-preserving subset, whole-ledger `10, 20, …`, `TransactionOrderOut`, unlogged | 8 |
| §3.2 | cards route: every card, `list[CreditCardOut]` built as the GET builds it, unlogged | 9 |
| §3.2 | reward categories route: every row, `list[RewardCategoryOut]`, unlogged | 9 |
| §3.2 | logged routes: `record_update` per changed row, label, `batch.commit()`, header only when rows recorded | 3, 4 (decision 6) |
| §3.2 | pin: `LOGGED` gains `reorder_accounts`, `reorder_categories` | 3, 4 |
| §3.2 | `TransactionOrderOut` / `PositionChangeOut` fields; fold before/after; 6-dp shares, 2-dp money; warnings added; ordered by (ticker, account) | 8 |
| §3.2 | owner scope follows `_owner_filter` exactly; a scope never splits a holding | 8 (decision 7) |
| §3.2 | each `PUT …/order` declared before the `/{id}` routes | 3, 4, 8, 9 (`test_reorder_route_order.py`) |
| §3.3 | four create bodies `int \| None = None` with the same bounds; `None` appends `coalesce(max, −1) + 1` | 5, 9 |
| §3.3 | card PATCH: `None` keeps the stored value | 9 |
| §3.3 | account PATCH: group change without `sort_order` appends, same batch | 5 |
| §3.3 | explicit numbers still accepted everywhere | 5, 9 (tests) |
| §3.4 | accounts/categories: `sort_order` at create only; diffs compare `{name, group}` / `{name}` | 7 |
| §3.4 | new sheet rows append after the current max in sheet order; empty DB gets the sheet order | 7 |
| §3.4 | transactions matched by `import_key`; sheet key stays `rnum × 10`; creates set `import_key` and append `sort_index`; updates never touch `sort_index`; sync-delete compares keys; samples print the sheet key | 7 |
| §3.4 | updated tests + the four new importer tests | 7 |
| §3.5 | `import_key INTEGER NULL`; backfill; partial unique index `ux_position_txn_import_key` in migration AND model; downgrade; parent `f12026091203`; not on `TransactionOut` | 6 |
| §3.5 | rollout note (snapshots before the deploy not restorable) | 6 (migration docstring) |
| §3.6 | `PositionChange`, `TransactionOrderOut` beside their list's types; five functions with the specified returns; PUT `{ ids }`; inherited invalidation; one unit test each | 10 |
| §3.7 | helper unit tests incl. `moved_ids` single, block, adjacent swap | 1 |
| §3.7 | per endpoint: happy path, no-op, 409 missing/extra, 422 duplicate, response order = follow-up GET, only changed rows written | 3, 4, 8, 9 |
| §3.7 | logged: batch rows + label; undo restores exact values; later logged edit → overlap refusal | 3, 4 |
| §3.7 | transactions: hidden rows keep slots; cross-holding no change; sell above buy; split vs buy; evenly spaced | 8 |
| §3.7 | appending: create appends; group change appends; card PATCH keeps | 5, 9 |
| §3.7 | importer and migration (upgrade/downgrade, backfill, index refuses a duplicate) | 6, 7 |
| §8.3 | the five stale sentences, verbatim | 1 (constants + test), 3, 4, 8, 9 (route tests) |
| §8.4 | the four label shapes; `{n}` = minimal moved set | 3, 4 (decision 2) |
| §9 | retired/inactive rows keep positions and must be sent | 3, 4, 9 (tests) |
| §9 | two tabs: 409, nothing half-applied | 3, 4, 8, 9 |
| §9 | undo after a later reorder refuses with the overlap sentence (logged lists) | 4 |
| §9 | transactions: scoped reorder only among visible slots; a hidden holding never moves; every changed position reported | 8 |
| §9 | import after reorder: custom orders survive; moved sheet rows keep identity; new rows append | 7 |
| §9 | accounts: a group change via Edit appends | 5 |
| §10 | backend full suite on `finance_test_reorder_r1` + ruff; frontend vitest, `tsc -b`, `eslint`, `vite build` | 11 |
| §11 | lane R1 owns exactly: `ordering.py`, the five routes + schemas, `models/portfolio.py`, `importer/apply.py`, the migration, their tests, the pin, the five `src/api` functions (+ tests) and the wire types | file map |
