# Polish L3c "Undo engine follow-up" — "undo those first" made true, locked dependent deletes, grouped re-inserts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** close the findings lanes L3a and L3b left to the coordinator's follow-up (spec
`docs/superpowers/specs/2026-09-25-polish-alignment-feedback-undo-design.md` §6.1; contract C1 in
`2026-09-25-polish-00-overview.md`):
1. `changelog.superseded` lets a later change and its standing Undo cancel out, so OVERLAP_REFUSAL's "undo those first"
   is true — and the Activity listing's `undoable` flag agrees;
2. the five deletes that image their dependents lock their row `FOR UPDATE` before reading those dependents;
3. `undo_batch` re-inserts each run of rows into one table with one multi-row INSERT;
4. one exact-undo test-helper module instead of two;
5. the L3b review's test gaps;
6. Activity labels say "Added / Edited" everywhere, and a matrix save names what it changed.

**Architecture:** all engine changes live in `backend/app/services/changelog.py`: a private `_undo_links` read of the
`undo` runs feeds both `undone_by` and a chain-aware `superseded`; a new `lock_parent` helper is the dependent deletes'
first read; `undo_batch` gathers consecutive re-inserts and sends them through `_reinsert`. The five routers only switch
their delete's first read to the locked one and (spending, net worth, calendar, credit cards) adjust labels. No schema
change, no migration, no response-shape change.

**Tech Stack:** FastAPI + SQLAlchemy 2.0.52 (async) + asyncpg 0.31, Postgres 16, pytest (+ xdist), ruff (line length 100).

---

## Conventions for every task

Run everything from the lane worktree's backend, with the main checkout's venv and this lane's test database (Postgres
on `127.0.0.1:5433`; the database is created on first use). The tool shell keeps no variables, so every command line
starts with them:

```bash
cd /c/Users/edyli/personal-finance-dashboard/.worktrees/polish-undo-engine/backend
export FINANCE_TEST_DB=finance_test_l3c
PY=C:/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe
```

- `$PY -c "import app; print(app.__file__)"` must print the WORKTREE's path (checked: it does).
- Tests: `$PY -m pytest <paths> -q -p no:cacheprovider`. Full suite at the end only: `$PY -m pytest -n 4 -q -p no:cacheprovider`.
- Lint before every commit: `$PY -m ruff check app tests` and `$PY -m ruff format --check app tests`; when the format
  check names a file, `$PY -m ruff format <file>` and re-check.
- One commit per task, conventional prefix, a body saying what and why. Never push, never merge.
- The shared test session (`tests/conftest.py`): the `client` drives routes through the test's own `db` session. An
  Undo refusal rolls that session back (the Activity route does it) and expires every instance — read ids into plain
  ints before a refusal. `undo_batch` ends with `db.expunge_all()`.
- **Baseline on `bdb87301`** (this branch's base): `2811 passed, 4 skipped, 4 warnings` in 81.5 s (the warnings are
  `tests/test_restore_points.py:531`'s pre-existing SyntaxWarning).
- **Baseline Undo timing** (a throwaway probe, `tests/test_zz_probe_undo_timing.py`, never committed: a security with
  800 closes + a quote; DELETE, then time the Activity POST): 1.158 s / 1.114 s / 0.972 s — median **1.11 s** — and
  **800** `INSERT INTO price_history` statements.

## Decisions (made while reading the code; the "why" the reviewer will ask for)

1. **When a later change counts (item 1).** Undos form chains: X; the Undo U1 that reversed X; the Undo U2 that
   reversed U1 (a redo); … — each batch is undone at most once (`ALREADY_UNDONE`). A batch **stands** when an even number
   of Undos sit above it in its chain: its effect is in the data. For a batch T, a *later change* is a batch with a
   row-level entry on one of T's `(table, pk)` after T's own last entry (today's join). A later change L **counts**
   against T only when (1) L stands and (2) L is not the Undo of a batch that is itself later than T. Consequences:
   - X later than T, U1 standing: X does not stand; U1 undid a later batch — they cancel: T is undoable ("undo those
     first" is now true).
   - … then U2 (redo): X stands again and counts; U1 undid X (later), U2 undid U1 (later) — they cancel. T refuses.
   - … then U3: X has three Undos above it — odd, does not stand; U1, U2, U3 each undid a later batch. T is undoable.
   - **An Undo whose target is OLDER than T is an ordinary later change.** Example: edit E, reorder R, Undo R (U_R),
     Undo E (U_E — allowed: R and U_R cancel). Now "Undo U_R" (redo R) refuses: U_E stands and undid E, which is not
     later than U_R. Without this rule the redo would write R's after-images — which still carry E's rename — over the
     row U_E restored, silently re-applying E. Redo E first and the redo of R goes through.

   Proof sketch (for the docstring's claim): for T, the chain members later than T are a contiguous suffix
   C_j…C_k of their chain; pair them from the top, (C_{k−1}, C_k), (C_{k−3}, C_{k−2}), …; each pair restores exactly
   the rows its first member found. If the suffix has even length everything cancels; if odd, C_j is left and its
   effect is in the data. "L stands and L did not undo a batch later than T" selects exactly that C_j.
2. **The undo graph is read once per call** (`_undo_links`: every successful `undo` run, ordered by id, the first claim
   of a batch kept, so every reader walks the same chains). `undone_by` becomes a filter over it; `superseded` reads it
   only when some batch has a later change. The listing's `undoable` flag is unchanged code: it already reads
   `superseded`, so it agrees by construction.
3. **The lock (item 2) is `db.get(Model, id, with_for_update=True, populate_existing=True)`** in a shared
   `changelog.lock_parent`, reached through each router's getter as `lock=True` so the 404 sentence stays in one place
   per router. Checked on this box: with `with_for_update` set, `Session.get` bypasses the identity map and emits
   `… FROM credit_cards WHERE credit_cards.id = $1::INTEGER FOR UPDATE` even for an instance the session already holds;
   `populate_existing` makes the image the row as locked. Why it closes the race: a child row's FK check takes
   `FOR KEY SHARE` on the parent, which `FOR UPDATE` blocks, so a child written from another tab waits for the delete
   (then fails its FK) instead of being removed by `ON DELETE CASCADE` / `SET NULL` without an image; a child already in
   flight makes the locked read wait, and the dependents' read then sees it.
   - **Accepted, documented, not fixed:** a writer that already holds the month-review table locks
     (`lock_review_inputs`: the month save, the historical batch close, an Undo of review inputs) and then needs the
     locked row — a month save racing the delete of its own account — can deadlock with the delete; Postgres aborts one of
     the two and nothing is half-written. Before this lane the same race silently cascaded the new balance away. Taking
     the review locks in the two deletes too would serialize them, but it is table-level locking the brief did not ask
     for; recorded in "As built" as a possible follow-up.
   - Not in scope (the brief's race is the cascade): a child re-pointed AWAY from the parent, or edited in place, by
     another tab during the delete is not blocked by the parent's lock.
4. **Grouping re-inserts (item 3).** A delete's inverse is a re-insert. Consecutive re-inserts into the same table with
   the same column set are gathered and sent by `_reinsert` as `insert(table).values([...])`; any other replay step
   (a replayed DELETE, with its dependency check, or an UPDATE) sends the gathered run first, so every statement still
   runs in reverse-log order. Runs split below asyncpg's 32,767 bind parameters (`REINSERT_PARAMETERS = 32_000`;
   800 closes × 4 columns = 3,200). A constraint any grouped row breaks raises `IntegrityError` from `_reinsert`, which
   the Activity route already answers with `REPLAY_REFUSAL` — the refusal path is unchanged. The column-set split keeps
   the feed link's hash-less image (L3a decision 4) and any pre-migration image in their own statement.
5. **One helper module (item 4): `tests/exact_undo.py` stays, `tests/changelog_asserts.py` goes.** `images()` (ORM
   read with `populate_existing`, whole-row change-log images in the export's JSON spellings — "500.00", never
   `Decimal("500")`, so a scale change shows) is the stronger comparison and is kept; `table_rows()` goes. The two
   signatures merge: `logged` and `undo` take a batch id OR the response of the write that recorded it (its
   X-Change-Batch header — a KeyError there is still the finding); L3b's `ops` is L3a's `shape`; `label_of` joins;
   `table_images(db, *models)` is `images` keyed by table name for the multi-table comparisons.
6. **Labels (item 6).** `Created/Updated account|category` → `Added/Edited …`; L3a's `Created calendar feed link {label}`
   → `Added calendar feed link {label}` (the only other "Created"). The older specific verbs stay (`Set … budget`,
   `Removed … budget row`, `Changed the owner of …`, `Saved … month`). The matrix save counts cells whose multiplier was
   added, changed or cleared apart from cells where only the **condition** moved — the page's own word: the matrix
   marks a cell's note + monthly bonus cap with "⁺ marks a condition":
   - `Edited 3 reward multipliers` (multipliers only — unchanged);
   - `Edited the condition on 1 reward multiplier` / `Edited the conditions on 2 reward multipliers`;
   - `Edited 2 reward multipliers and the condition on 1 more` (both).
   The one-click retire/restore of an account or category now reads "Edited …"; naming them "Retired/Restored" like the
   cards' Archive toggle was not asked for — noted for the coordinator.
7. **Tests that pin existing behaviour (item 5)** cannot be red first; each is proven to bite by a temporary mutation
   (named in its step), reverted before the commit.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `backend/app/services/changelog.py` | modify | `_undo_links`, `_stands`; chain-aware `superseded`; `undone_by` over the links; `lock_parent`; `REINSERT_PARAMETERS`, `_reinsert`, grouped re-inserts in `undo_batch` |
| `backend/app/api/credit_cards.py` | modify | `_get_card` / `_get_reward_category` take `lock`; the two deletes lock; `_matrix_label`; `put_reward_rates` counts multipliers vs conditions |
| `backend/app/api/portfolio.py` | modify | `_get_security` takes `lock`; `delete_security` locks |
| `backend/app/api/spending.py` | modify | `_get_category` takes `lock`; `delete_category` locks; Added/Edited labels |
| `backend/app/api/net_worth.py` | modify | `_get_account` takes `lock`; `delete_account` locks; Added/Edited labels |
| `backend/app/api/calendar.py` | modify | `Added calendar feed link {label}` |
| `backend/tests/exact_undo.py` | modify | the one exact-undo vocabulary: `batch_id_of`, `logged`, `shape`, `label_of`, `images`, `table_images`, `undo` |
| `backend/tests/changelog_asserts.py` | delete | merged into `exact_undo.py` |
| `backend/tests/test_undo_chains.py` | create | the cancellation rule through chains, the older-target rule, the listing flag |
| `backend/tests/test_dependent_delete_locks.py` | create | each dependent delete's lock comes first; the lock's mode blocks another tab's child |
| `backend/tests/test_changelog_credit_cards.py` | modify | helpers; the probe and the reward-category overlap test retry and succeed; round trips; 422s; replay refusals; grouped-replay refusal; matrix label |
| `backend/tests/test_changelog_comp.py` | modify | helpers; focal-year replay refusal |
| `backend/tests/test_changelog_espp.py` | modify | helpers |
| `backend/tests/test_changelog_paycheck.py` | modify | helpers; the Undo takes the review-input locks first |
| `backend/tests/test_changelog_portfolio.py` | modify | the security Undo's statement count |
| `backend/tests/test_reorder_credit_cards_api.py` | modify | helper import |
| `backend/tests/test_reorder_categories_api.py` | modify | `…refuses_until_the_later_one_is_undone` retries and succeeds |
| `backend/tests/test_changelog_completions.py`, `test_changelog_routes.py`, `test_reorder_accounts_api.py`, `test_changelog_calendar.py`, `test_changelog_service.py` | modify | the Added/Edited labels |

---

### Task 1: One exact-undo helper module

**Files:**
- Modify: `backend/tests/exact_undo.py`
- Delete: `backend/tests/changelog_asserts.py`
- Modify: `backend/tests/test_changelog_comp.py`, `test_changelog_espp.py`, `test_changelog_paycheck.py`,
  `test_changelog_credit_cards.py`, `test_reorder_credit_cards_api.py`

A pure test refactor: the affected files pass before and after with the same count.

- [ ] **Step 1: Record the affected files' count**

Run: `$PY -m pytest tests/test_changelog_comp.py tests/test_changelog_espp.py tests/test_changelog_paycheck.py tests/test_changelog_credit_cards.py tests/test_reorder_credit_cards_api.py tests/test_changelog_portfolio.py tests/test_changelog_calendar.py tests/test_changelog_completions.py -q -p no:cacheprovider`
Expected: all passed (note the count N).

- [ ] **Step 2: Rewrite `backend/tests/exact_undo.py`**

```python
"""Shared by the exact-undo tests (2026-09-25 polish spec §6.1): what one batch logged, every
row of a table as its change-log image, and the Activity card's Undo. "Exact" means the rows an
Undo puts back are the rows the write took — the same images, ids included — so the tests
compare whole images, never a handful of fields.

A batch is named by its id or by the response of the write that recorded it: `logged` and
`undo` then read its X-Change-Batch header, and a KeyError there IS the finding — the route
answered without it."""

from uuid import UUID

from httpx import Response
from sqlalchemy import select

from app.models import ChangeLog
from app.services.changelog import row_image

ACTIVITY = "/api/v1/activity"


def batch_id_of(batch: str | UUID | Response) -> str:
    """The batch id itself, or the one a logged write's response names in X-Change-Batch."""
    return batch.headers["x-change-batch"] if isinstance(batch, Response) else str(batch)


async def logged(db, batch: str | UUID | Response) -> list[ChangeLog]:
    """The batch's change-log rows in the order the route recorded them."""
    return list(
        (
            await db.execute(
                select(ChangeLog)
                .where(ChangeLog.batch_id == batch_id_of(batch))
                .order_by(ChangeLog.id)
            )
        )
        .scalars()
        .all()
    )


def shape(rows: list[ChangeLog]) -> list[tuple[str, str]]:
    """(op, table) per row — the sequence an Undo replays in reverse."""
    return [(row.op, row.table_name) for row in rows]


def label_of(rows: list[ChangeLog]) -> str:
    """The batch's one label — every row of a batch carries the same."""
    [label] = {row.label for row in rows}
    return label


async def images(db, model) -> list[dict]:
    """Every row of `model` as its change-log image, in primary-key order: the export's JSON
    spellings ("500.00", never Decimal("500")), so even a scale change shows. Read with
    populate_existing, so an instance the shared session still holds answers with what the
    DATABASE holds: an Undo's Core statements bypass the identity map."""
    keys = list(model.__table__.primary_key.columns)
    result = await db.execute(
        select(model).order_by(*keys).execution_options(populate_existing=True)
    )
    return [row_image(row) for row in result.scalars().all()]


async def table_images(db, *models) -> dict[str, list[dict]]:
    """images() for several tables, keyed by table name — one assertion compares them all."""
    return {model.__tablename__: await images(db, model) for model in models}


async def undo(auth_client, batch: str | UUID | Response) -> Response:
    """The Activity card's Undo of the batch."""
    return await auth_client.post(f"{ACTIVITY}/batches/{batch_id_of(batch)}/undo")
```

- [ ] **Step 3: Move L3b's call sites onto it (mechanical)**

```bash
sed -i -E \
  -e 's/\bops\(/shape(/g' \
  -e 's/table_rows\(db, (\w+)\) == \{"\w+": \[\]\}/images(db, \1) == []/g' \
  -e 's/\(await table_rows\(db, (\w+)\)\)\["\w+"\]/await images(db, \1)/g' \
  -e 's/table_rows\(db, (\w+)\)/images(db, \1)/g' \
  -e 's/table_rows\(db, /table_images(db, /g' \
  tests/test_changelog_comp.py tests/test_changelog_espp.py tests/test_changelog_paycheck.py tests/test_changelog_credit_cards.py
sed -i 's/^from tests.changelog_asserts import label_of, logged, ops, table_rows, undo$/from tests.exact_undo import images, label_of, logged, shape, undo/' \
  tests/test_changelog_comp.py tests/test_changelog_espp.py tests/test_changelog_paycheck.py
sed -i 's/^from tests.changelog_asserts import label_of, logged, ops, table_rows, undo$/from tests.exact_undo import images, label_of, logged, shape, table_images, undo/' \
  tests/test_changelog_credit_cards.py
sed -i 's/^from tests.changelog_asserts import logged$/from tests.exact_undo import logged/' \
  tests/test_reorder_credit_cards_api.py
git rm -q tests/changelog_asserts.py
```

What the rules do, in order: `ops(` → `shape(`; `table_rows(db, M) == {"t": []}` → `images(db, M) == []`;
`(await table_rows(db, M))["t"]` → `await images(db, M)`; any other one-model `table_rows(db, M)` → `images(db, M)`;
the rest (several models, `*tables`) → `table_images(db, …)`, which keeps the `{"table": [...]}` shape those tests
index into.

- [ ] **Step 4: The one non-mechanical edit — the sold lot's spellings**

`images` returns JSON spellings, so in `tests/test_changelog_espp.py::test_undo_restores_a_deleted_sold_lot_exactly`
replace

```python
    [row] = after["espp_lots"]
    assert (row["id"], row["sold_date"].isoformat(), str(row["sold_price"])) == (
        lot_id,
        "2025-10-01",
        "180.50000",
    )
```

with

```python
    [row] = after
    assert (row["id"], row["sold_date"], row["sold_price"]) == (lot_id, "2025-10-01", "180.50000")
```

- [ ] **Step 5: Nothing references the old module**

Run: `grep -rn "changelog_asserts\|table_rows\|\bops(" tests/`
Expected: no output.

- [ ] **Step 6: Same tests, same count**

Run: the Step 1 command.
Expected: N passed.

- [ ] **Step 7: Lint and commit**

Run: `$PY -m ruff check app tests && $PY -m ruff format --check app tests` → clean.

```bash
git add -A tests/
git commit -m "test(changelog): one exact-undo helper module — exact_undo absorbs changelog_asserts" \
  -m "L3a's tests/exact_undo.py and L3b's tests/changelog_asserts.py did the same job with different signatures. exact_undo stays: images() (ORM read with populate_existing, whole-row images in the export's JSON spellings) is the stronger comparison, and table_images() keys it by table for the multi-table checks. logged() and undo() take a batch id or the write's response (its X-Change-Batch header); ops() is shape(); label_of() joins. Every L3b call site moved; changelog_asserts.py is deleted. No behaviour change."
```

---

### Task 2: A later change and its standing Undo cancel out — "undo those first" is true

**Files:**
- Create: `backend/tests/test_undo_chains.py`
- Modify: `backend/tests/test_reorder_categories_api.py` (`test_undo_after_a_later_reorder_refuses_until_the_later_one_is_undone`)
- Modify: `backend/tests/test_changelog_credit_cards.py` (the two "older edit after a reorder" tests)
- Modify: `backend/app/services/changelog.py` (module docstring, `superseded`, `undone_by`; new `_undo_links`, `_stands`)

- [ ] **Step 1: Write the chain tests — `backend/tests/test_undo_chains.py`**

```python
"""'Later changes touched these rows — undo those first' is true (2026-09-25 polish L3c): a later
change and the Undo that reversed it cancel out, so undoing the later change makes the older one
undoable again. Undos chain (an Undo of an Undo is a redo) and count by parity; an Undo whose
target is OLDER than the batch being undone is an ordinary later change. The Activity listing's
`undoable` flag and the Undo's own refusal read the same predicate (changelog.superseded)."""

from app.models import SpendingCategory
from app.services.changelog import OVERLAP_REFUSAL
from tests.exact_undo import batch_id_of, images, undo

SP = "/api/v1/spending"
ORDER = f"{SP}/categories/order"
ACTIVITY = "/api/v1/activity"


async def seed(db) -> list[int]:
    """Food, Rent, Travel at 0, 1, 2."""
    rows = [
        SpendingCategory(name=name, slug=name.lower(), sort_order=index)
        for index, name in enumerate(("Food", "Rent", "Travel"))
    ]
    db.add_all(rows)
    await db.commit()
    return [row.id for row in rows]


async def rename(auth_client, category_id: int, name: str):
    resp = await auth_client.patch(f"{SP}/categories/{category_id}", json={"name": name})
    assert resp.status_code == 200, resp.text
    return resp


async def reorder(auth_client, ids: list[int]):
    resp = await auth_client.put(ORDER, json={"ids": ids})
    assert resp.status_code == 200, resp.text
    return resp


async def undone(auth_client, batch) -> str:
    """Undo `batch`, which must go through; the Undo's own batch id."""
    resp = await undo(auth_client, batch)
    assert resp.status_code == 200, resp.text
    return resp.json()["batch_id"]


async def refused(auth_client, batch) -> None:
    resp = await undo(auth_client, batch)
    assert resp.status_code == 409, resp.text
    assert resp.json()["detail"] == OVERLAP_REFUSAL


async def flag(auth_client, batch) -> bool:
    """The Activity listing's `undoable` for `batch`."""
    wanted = batch_id_of(batch)
    entries = (await auth_client.get(ACTIVITY)).json()["entries"]
    return next(entry for entry in entries if entry.get("batch_id") == wanted)["undoable"]


async def test_undoing_the_later_change_frees_the_older_one_and_a_redo_takes_it_back(
    auth_client, db
):
    """edit → reorder: the edit's Undo refuses. Undo the reorder and it is free — until the
    reorder is redone (an Undo of its Undo), and free again once the redo is undone: a batch
    stands while an even number of Undos sit above it. The listing's flag agrees at every step,
    and the last Undo puts back exactly the rows the edit found."""
    food, rent, travel = await seed(db)
    seeded = await images(db, SpendingCategory)
    edit = await rename(auth_client, food, "Groceries")
    assert await flag(auth_client, edit) is True
    move = await reorder(auth_client, [travel, food, rent])
    assert await flag(auth_client, edit) is False
    await refused(auth_client, edit)
    unmove = await undone(auth_client, move)
    assert await flag(auth_client, edit) is True
    redo = await undone(auth_client, unmove)  # the reorder is in force again
    assert await flag(auth_client, edit) is False
    await refused(auth_client, edit)
    await undone(auth_client, redo)  # three Undos above the reorder: undone again
    assert await flag(auth_client, edit) is True
    await undone(auth_client, edit)
    assert await images(db, SpendingCategory) == seeded


async def test_with_two_later_changes_undoing_one_still_refuses(auth_client, db):
    food, rent, travel = await seed(db)
    seeded = await images(db, SpendingCategory)
    edit = await rename(auth_client, food, "Groceries")
    first = await reorder(auth_client, [rent, food, travel])
    second = await reorder(auth_client, [travel, rent, food])
    await undone(auth_client, second)
    await refused(auth_client, edit)  # the first reorder still stands on the row
    assert await flag(auth_client, edit) is False
    await undone(auth_client, first)  # free too: the second reorder and its Undo cancel
    await undone(auth_client, edit)
    assert await images(db, SpendingCategory) == seeded


async def test_a_redo_refuses_once_an_older_changes_undo_rewrote_its_rows(auth_client, db):
    """An Undo cancels only a change LATER than the batch being undone. Here the edit is older
    than the reorder: once the reorder is undone and then the edit, redoing the reorder would
    write its after-images — which still carry the edit's name — over the row the edit's Undo
    restored, silently re-applying the edit. So the edit's Undo counts against the redo, which
    refuses until the edit is redone first."""
    food, rent, travel = await seed(db)
    edit = await rename(auth_client, food, "Groceries")
    move = await reorder(auth_client, [travel, food, rent])
    in_force = await images(db, SpendingCategory)
    unmove = await undone(auth_client, move)
    unedit = await undone(auth_client, edit)  # free: the reorder and its Undo cancel
    await refused(auth_client, unmove)
    assert await flag(auth_client, unmove) is False
    names = [row["name"] for row in await images(db, SpendingCategory)]
    assert names == ["Food", "Rent", "Travel"]  # the refusal re-applied nothing
    await undone(auth_client, unedit)  # redo the edit first…
    await undone(auth_client, unmove)  # …and the reorder's redo goes through
    assert await images(db, SpendingCategory) == in_force
```

- [ ] **Step 2: The three existing overlap tests retry and succeed**

In `backend/tests/test_reorder_categories_api.py`, replace the whole of
`test_undo_after_a_later_reorder_refuses_until_the_later_one_is_undone` with:

```python
async def test_undo_after_a_later_reorder_refuses_until_the_later_one_is_undone(auth_client, db):
    """Spec §9: two reorders touch the same rows, so the first one's before images are stale
    — its undo refuses with the overlap sentence — until the later one is undone: a change and
    its standing Undo cancel out (changelog.superseded), so the retry goes through and puts the
    seed's numbers back."""
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
    retried = await auth_client.post(f"{ACTIVITY}/batches/{first_batch}/undo")
    assert retried.status_code == 200, retried.text
    listed = (await auth_client.get(f"{SP}/categories")).json()
    assert [(c["id"], c["sort_order"]) for c in listed] == [
        (ids["Food"], 2),
        (ids["Rent"], 3),
        (ids["Old"], 7),
        (ids["Travel"], 20),
    ]
```

In `backend/tests/test_changelog_credit_cards.py`, replace
`test_undoing_an_older_card_edit_after_a_reorder_moved_it_refuses` (the probe) with:

```python
async def test_undoing_an_older_card_edit_refuses_until_the_reorder_is_undone(auth_client, db):
    """Why the reorder is logged at all (spec §6.1): the edit's Undo writes the card's whole
    old row back, sort_order included, so after an unlogged reorder it would silently move
    the card. Logged, the reorder is a later change to the same row: undo that first — and
    then the edit's Undo goes through (a change and its standing Undo cancel out,
    changelog.superseded), putting back exactly the rows it found."""
    seeded = [card("A"), card("B", 1), card("C", 2)]
    db.add_all(seeded)
    await db.commit()
    a, b, c = (row.id for row in seeded)
    before = await images(db, CreditCard)
    edited = await auth_client.patch(f"{CARDS}/{b}", json=card_body("B"))
    assert edited.status_code == 200, edited.text
    reordered = await auth_client.put(CARD_ORDER, json={"ids": [b, a, c]})
    assert reordered.status_code == 200, reordered.text
    refused = await undo(auth_client, edited)
    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"] == OVERLAP_REFUSAL
    assert await sort_orders(db, CreditCard) == [(b, 0), (a, 1), (c, 2)]  # nothing moved back
    resp = await undo(auth_client, reordered)
    assert resp.status_code == 200, resp.text
    assert await sort_orders(db, CreditCard) == [(a, 0), (b, 1), (c, 2)]
    retried = await undo(auth_client, edited)
    assert retried.status_code == 200, retried.text
    assert await images(db, CreditCard) == before
```

and replace `test_undoing_an_older_reward_category_edit_after_a_reorder_moved_it_refuses` with:

```python
async def test_undoing_an_older_reward_category_edit_refuses_until_the_reorder_is_undone(
    auth_client, db
):
    seeded = [category("Dining"), category("Groceries", 1), category("Travel", 2)]
    db.add_all(seeded)
    await db.commit()
    d, g, t = (row.id for row in seeded)
    before = await images(db, RewardCategory)
    edited = await auth_client.patch(f"{CATEGORIES}/{g}", json={"annual_spend": "6000"})
    assert edited.status_code == 200, edited.text
    reordered = await auth_client.put(CATEGORY_ORDER, json={"ids": [g, d, t]})
    assert reordered.status_code == 200, reordered.text
    refused = await undo(auth_client, edited)
    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"] == OVERLAP_REFUSAL
    resp = await undo(auth_client, reordered)
    assert resp.status_code == 200, resp.text
    assert await sort_orders(db, RewardCategory) == [(d, 0), (g, 1), (t, 2)]
    retried = await undo(auth_client, edited)
    assert retried.status_code == 200, retried.text
    assert await images(db, RewardCategory) == before
```

- [ ] **Step 3: Run them red**

Run: `$PY -m pytest tests/test_undo_chains.py tests/test_reorder_categories_api.py tests/test_changelog_credit_cards.py -q -p no:cacheprovider`
Expected: `6 failed` — the chain tests at `assert await flag(auth_client, edit) is True` (`assert False is True`), at
`await undone(auth_client, first)` and at `unedit = await undone(auth_client, edit)` (`409 == 200`); the three retries
with `assert 409 == 200`. Everything else passes.

- [ ] **Step 4: Implement — `backend/app/services/changelog.py`**

Module docstring, last paragraph, becomes:

```
Undo (undo_batch) replays a batch's inverses in reverse order in one transaction and is
itself a batch (source='undo') plus an `undo` run whose report links `undid`, which is how
"already undone" and the listing's `undone_by` are answered — and how `superseded` tells a
later change that still stands from one an Undo cancelled.
```

Replace `superseded` and `undone_by` (lines 211–294) with:

```python
async def _undo_links(db: AsyncSession) -> dict[UUID, UUID]:
    """Every Undo that went through, as the batch it reversed -> its own batch, read from the
    `undo` runs' reports. In run order, the first claim of a batch kept, so every reader walks
    the same chains."""
    runs = (
        await db.execute(
            select(LifecycleRun.report, LifecycleRun.batch_id)
            .where(LifecycleRun.kind == "undo", LifecycleRun.ok.is_(True))
            .order_by(LifecycleRun.id)
        )
    ).all()
    links: dict[UUID, UUID] = {}
    for report, undo_id in runs:
        undid = (report or {}).get("undid")
        if not isinstance(undid, str) or undo_id is None:
            continue
        try:
            links.setdefault(UUID(undid), undo_id)
        except ValueError:
            continue  # not a batch id: nothing it could have undone
    return links


def _stands(batch_id: UUID, links: dict[UUID, UUID]) -> bool:
    """Whether the batch's effect is in the data: an even number of Undos above it in its chain
    — none, or an Undo that was itself undone (a redo), and so on."""
    undos = 0
    while batch_id in links:
        batch_id = links[batch_id]
        undos += 1
    return undos % 2 == 0


async def superseded(db: AsyncSession, batch_ids: list[UUID]) -> dict[UUID, str]:
    """batch -> the 409 sentence a LATER log entry earns it, for each batch that has one.

    Page-wide queries, never one per row, so `GET /activity`'s `undoable` flag and
    undo_batch's own refusals are decided by this one predicate and cannot drift apart:

    * OVERLAP_REFUSAL — a later change that still stands touched one of this batch's rows,
      so the batch's `before` images are no longer what those rows hold. A later change is a
      batch with a row-level entry on one of this batch's (table, pk) after this batch's own
      last entry. Undos form chains — X; the Undo U1 that reversed X; the Undo U2 that
      reversed U1, a redo; … — each batch undone at most once, and a batch STANDS when an
      even number of Undos sit above it in its chain. A later change L counts only when
        1. L stands (its effect is in the data), and
        2. L is not the Undo of a batch that is itself later than this one.
      So a later change and its standing Undo cancel out — the change no longer stands, the
      Undo undid a later batch — which is what makes the sentence's "undo those first" true.
      After a redo, the change stands and counts again while the Undo and the redo cancel;
      after an Undo of the redo, the whole chain cancels. An Undo of a batch OLDER than this
      one is an ordinary later change: it rewrote the rows after this batch did, and redoing
      this batch over it would re-apply whatever this batch's images carry from before.
    * POST_SUMMARY_REFUSAL — an import or a restore was logged after it. Both TRUNCATE …
      RESTART IDENTITY and then setval the sequences, so the ids inside this batch's images
      may now address entirely different rows; the images cannot be trusted even where no
      primary key visibly overlaps. Summary rows carry table_name '*' and an empty pk, which
      is why the overlap join alone can never see them — and they are never undone, so no
      Undo cancels one.

    Overlap wins when both apply — it is the more specific diagnosis.
    """
    if not batch_ids:
        return {}
    # Uncorrelated on purpose: the newest summary row in the WHOLE log, compared once per
    # batch by the grouped select below.
    newest_summary = select(func.max(ChangeLog.id)).where(ChangeLog.op == "batch").scalar_subquery()
    ends = (
        select(
            ChangeLog.batch_id.label("batch_id"),
            func.max(ChangeLog.id).label("last_id"),
            (func.max(ChangeLog.id) < newest_summary).label("post_summary"),
        )
        .where(ChangeLog.batch_id.in_(batch_ids))
        .group_by(ChangeLog.batch_id)
        .subquery()
    )
    mine = aliased(ChangeLog)
    later = aliased(ChangeLog)
    pairs = (
        await db.execute(
            select(mine.batch_id, later.batch_id)
            .distinct()
            .select_from(mine)
            .join(ends, ends.c.batch_id == mine.batch_id)
            .join(
                later,
                and_(
                    later.id > ends.c.last_id,
                    later.op != "batch",
                    later.table_name == mine.table_name,
                    # jsonb '=' normalises key order and whitespace, so this is the SQL
                    # twin of comparing sorted-key JSON in Python.
                    later.pk == mine.pk,
                ),
            )
            .where(mine.op != "batch")
        )
    ).all()
    later_changes: dict[UUID, set[UUID]] = {}
    for batch_id, later_id in pairs:
        later_changes.setdefault(batch_id, set()).add(later_id)
    links = await _undo_links(db) if later_changes else {}
    undid = {undo_id: target for target, undo_id in links.items()}
    stands = {
        later_id: _stands(later_id, links)
        for later_ids in later_changes.values()
        for later_id in later_ids
    }
    out: dict[UUID, str] = {
        batch_id: OVERLAP_REFUSAL
        for batch_id, later_ids in later_changes.items()
        if any(stands[later_id] and undid.get(later_id) not in later_ids for later_id in later_ids)
    }
    for batch_id, post_summary in (
        await db.execute(select(ends.c.batch_id, ends.c.post_summary))
    ).all():
        if post_summary and batch_id not in out:
            out[batch_id] = POST_SUMMARY_REFUSAL
    return out


async def undone_by(db: AsyncSession, batch_ids: list[UUID]) -> dict[UUID, UUID]:
    """batch -> the undo batch that reversed it, read from the `undo` runs' reports."""
    if not batch_ids:
        return {}
    links = await _undo_links(db)
    return {batch_id: links[batch_id] for batch_id in batch_ids if batch_id in links}
```

- [ ] **Step 5: Run them green, then the neighbours**

Run: `$PY -m pytest tests/test_undo_chains.py tests/test_reorder_categories_api.py tests/test_changelog_credit_cards.py -q -p no:cacheprovider`
Expected: all passed.

Run: `$PY -m pytest tests/test_activity_api.py tests/test_month_status_evidence.py tests/test_changelog_portfolio.py tests/test_changelog_calendar.py tests/test_reorder_accounts_api.py tests/test_changelog_routes.py -q -p no:cacheprovider`
Expected: all passed (the refusal, already-undone, redo and month-status redo tests still hold).

- [ ] **Step 6: Lint and commit**

```bash
git add app/services/changelog.py tests/test_undo_chains.py tests/test_reorder_categories_api.py tests/test_changelog_credit_cards.py
git commit -m "fix(changelog): a later change and its standing Undo cancel out — \"undo those first\" is true" \
  -m "superseded() blocked an older batch forever once any later entry touched its rows, the later change's own Undo included: edit a card, reorder, undo the reorder, and the edit's Undo still refused (and the listing greyed it). Now undos chain and count by parity: a batch stands while an even number of Undos sit above it, and a later change counts only when it stands and is not the Undo of a batch that is itself later — so a change and its standing Undo cancel, a redo brings the change back into force, and an Undo of an OLDER batch stays an ordinary later change (a redo over it would re-apply what its images carry). One read of the undo runs (_undo_links) feeds undone_by and superseded; the listing's undoable flag reads superseded, so it agrees. The categories overlap test and the two card-page overlap tests now retry and succeed; test_undo_chains covers redo, two later changes and the older-target rule."
```

---

### Task 3: The five dependent deletes lock their row before reading what hangs off it

**Files:**
- Create: `backend/tests/test_dependent_delete_locks.py`
- Modify: `backend/app/services/changelog.py` (new `lock_parent`, after `refuse_when_depended_on`)
- Modify: `backend/app/api/credit_cards.py` (`_get_reward_category`, `delete_reward_category`, `_get_card`,
  `delete_credit_card`, import)
- Modify: `backend/app/api/portfolio.py` (`_get_security`, `delete_security`, import)
- Modify: `backend/app/api/spending.py` (`_get_category`, `delete_category`, import)
- Modify: `backend/app/api/net_worth.py` (`_get_account`, `delete_account`, import)

- [ ] **Step 1: Write the failing tests — `backend/tests/test_dependent_delete_locks.py`**

```python
"""The five deletes that image what hangs off their row lock that row FIRST (2026-09-25 polish
L3c): read FOR UPDATE (changelog.lock_parent) before any dependent is read, so a child another
tab writes in between waits for the delete instead of being removed — or unlinked — by the FK's
ON DELETE without an image. Each route's statement order is proven from the SQL it sends; the
race itself once, on the lock's own mode."""

from decimal import Decimal

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.models import Account, CardCredit, CreditCard, RewardCategory, Security, SpendingCategory
from app.services.changelog import lock_parent
from tests.ordering_helpers import first_position, recorded_sql

CARD = {
    "name": "Venture X",
    "slug": "venture-x",
    "annual_fee": Decimal("395.00"),
    "rewards_currency": "miles",
    "point_value_cents": Decimal("1.0000"),
}

# model, its fields, its DELETE path, and a fragment of every read of what hangs off it
DELETES = [
    pytest.param(
        CreditCard,
        CARD,
        "/api/v1/credit-cards/{id}",
        (
            "FROM reward_categories",
            "FROM card_credits",
            "FROM reward_rates",
            "FROM credit_limit_events",
        ),
        id="credit card",
    ),
    pytest.param(
        RewardCategory,
        {"name": "Groceries", "slug": "groceries"},
        "/api/v1/credit-cards/categories/{id}",
        ("FROM reward_rates",),
        id="reward category",
    ),
    pytest.param(
        Security,
        {"ticker": "VOO", "name": "Vanguard S&P 500 ETF", "holding_type": "etf"},
        "/api/v1/portfolio/securities/{id}",
        (
            "FROM position_transactions",
            "FROM dividend_payments",
            "FROM security_dividend_events",
            "FROM price_history",
            "FROM latest_prices",
        ),
        id="security",
    ),
    pytest.param(
        SpendingCategory,
        {"name": "Dining", "slug": "dining", "sort_order": 0},
        "/api/v1/spending/categories/{id}",
        ("FROM monthly_spending", "FROM reward_categories", "FROM category_budgets"),
        id="spending category",
    ),
    pytest.param(
        Account,
        {"name": "Checking", "slug": "checking", "group": "cash", "sort_order": 0},
        "/api/v1/net-worth/accounts/{id}",
        ("FROM account_balances", "WHERE accounts.parent_account_id", "FROM credit_cards"),
        id="account",
    ),
]


@pytest.mark.parametrize(("model", "fields", "path", "dependents"), DELETES)
async def test_a_delete_locks_its_row_before_it_reads_what_hangs_off_it(
    auth_client, db, model, fields, path, dependents
):
    row = model(**fields)
    db.add(row)
    await db.commit()
    table = model.__tablename__
    with recorded_sql(db) as statements:
        resp = await auth_client.delete(path.format(id=row.id))
    assert resp.status_code == 204, resp.text
    lock = first_position(statements, "FOR UPDATE")
    assert f"FROM {table} \nWHERE {table}.id = " in statements[lock][0]
    for fragment in dependents:
        assert first_position(statements, fragment) > lock, fragment


async def test_a_child_another_tab_writes_waits_for_the_locked_row(db, engine):
    """The lock's mode is the fix: a child's foreign key takes FOR KEY SHARE on its parent, and
    FOR UPDATE blocks that — so while a delete holds its card, another tab's new credit on it
    waits (here out to a short lock_timeout, having written nothing) instead of slipping in
    under the cascade; once the delete's transaction is over, it goes through."""
    card = CreditCard(**CARD)
    db.add(card)
    await db.commit()
    card_id = card.id
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as deleting:
        assert await lock_parent(deleting, CreditCard, card_id) is not None
        async with sessions() as other_tab:
            await other_tab.execute(text("SET LOCAL lock_timeout = '200ms'"))
            other_tab.add(CardCredit(card_id=card_id, label="Travel", annual_value=Decimal("300")))
            with pytest.raises(DBAPIError, match="lock timeout"):
                await other_tab.flush()
    async with sessions() as other_tab:  # the delete's transaction is over: the row is free
        other_tab.add(CardCredit(card_id=card_id, label="Travel", annual_value=Decimal("300")))
        await other_tab.commit()
```

- [ ] **Step 2: Run it red**

Run: `$PY -m pytest tests/test_dependent_delete_locks.py -q -p no:cacheprovider`
Expected: collection error — `ImportError: cannot import name 'lock_parent' from 'app.services.changelog'`. (With the
import stubbed, the five route cases fail on `no statement contained 'FOR UPDATE'`.)

- [ ] **Step 3: Implement the helper — `backend/app/services/changelog.py`, after `refuse_when_depended_on`**

```python
async def lock_parent[M](db: AsyncSession, model: type[M], pk: object) -> M | None:
    """The row a delete with dependents removes, read FOR UPDATE: the delete's FIRST read
    (2026-09-25 polish spec §6.1, lane L3c). A child row's foreign key takes FOR KEY SHARE on
    its parent, which FOR UPDATE blocks: a child another tab writes while the delete runs waits
    for it (and then fails its FK), and one already in flight makes this read wait, after which
    the dependents' read sees it. Either way no child reaches the parent's DELETE unimaged, to
    be removed or unlinked by the FK's ON DELETE. populate_existing: the image is the row as
    locked, even in a session that already holds it.

    Accepted: a writer that already holds the month-review table locks and then needs this row
    (a month save racing the delete of its own account) can deadlock with the delete; Postgres
    aborts one of the two, and neither is half-written."""
    return await db.get(model, pk, with_for_update=True, populate_existing=True)
```

- [ ] **Step 4: The routers' getters take `lock`, and the deletes pass it**

`backend/app/api/credit_cards.py` — import line becomes
`from app.services.changelog import ChangeBatch, batch_header, change_batch, lock_parent, row_image`, and:

```python
async def _get_reward_category(
    db: AsyncSession, category_id: int, *, lock: bool = False
) -> RewardCategory:
    """`lock`: a dependent delete's first read, FOR UPDATE (changelog.lock_parent)."""
    category = (
        await lock_parent(db, RewardCategory, category_id)
        if lock
        else await db.get(RewardCategory, category_id)
    )
    if category is None:
        raise HTTPException(status_code=404, detail="reward category not found")
    return category
```

```python
async def _get_card(db: AsyncSession, card_id: int, *, lock: bool = False) -> CreditCard:
    """`lock`: a dependent delete's first read, FOR UPDATE (changelog.lock_parent)."""
    card = await lock_parent(db, CreditCard, card_id) if lock else await db.get(CreditCard, card_id)
    if card is None:
        raise HTTPException(status_code=404, detail="card not found")
    return card
```

In `delete_reward_category`: `category = await _get_reward_category(db, category_id, lock=True)`, and its docstring
gains the sentence "The row is read FOR UPDATE first, so no cell another tab adds meanwhile can leave with the
cascade unimaged." In `delete_credit_card`: `card = await _get_card(db, card_id, lock=True)`, and its docstring gains
"The card is read FOR UPDATE first, so nothing another tab points at it meanwhile can leave with the cascade
unimaged."

`backend/app/api/portfolio.py` — import block gains `lock_parent` (alphabetical, after `change_batch`), and:

```python
async def _get_security(db: AsyncSession, security_id: int, *, lock: bool = False) -> Security:
    """`lock`: a dependent delete's first read, FOR UPDATE (changelog.lock_parent)."""
    security = (
        await lock_parent(db, Security, security_id)
        if lock
        else await db.get(Security, security_id)
    )
    if security is None:
        raise HTTPException(status_code=404, detail="security not found")
    return security
```

In `delete_security`: `security = await _get_security(db, security_id, lock=True)`; docstring gains "The security is
read FOR UPDATE first, so a transaction, dividend or price another tab or the refresh writes meanwhile waits rather
than leaving with the cascade unimaged."

`backend/app/api/spending.py` — import line becomes
`from app.services.changelog import ChangeBatch, batch_header, change_batch, lock_parent, row_image`, and:

```python
async def _get_category(
    db: AsyncSession, category_id: int, *, lock: bool = False
) -> SpendingCategory:
    """`lock`: a dependent delete's first read, FOR UPDATE (changelog.lock_parent)."""
    category = (
        await lock_parent(db, SpendingCategory, category_id)
        if lock
        else await db.get(SpendingCategory, category_id)
    )
    if category is None:
        raise HTTPException(status_code=404, detail="category not found")
    return category
```

In `delete_category`: `category = await _get_category(db, category_id, lock=True)`; docstring gains "The category is
read FOR UPDATE first, so a month row, budget or reward link another tab writes meanwhile waits rather than leaving
with the cascade unimaged."

`backend/app/api/net_worth.py` — import line becomes
`from app.services.changelog import ChangeBatch, batch_header, change_batch, lock_parent, row_image`, and:

```python
async def _get_account(db: AsyncSession, account_id: int, *, lock: bool = False) -> Account:
    """`lock`: a dependent delete's first read, FOR UPDATE (changelog.lock_parent)."""
    account = (
        await lock_parent(db, Account, account_id) if lock else await db.get(Account, account_id)
    )
    if account is None:
        raise HTTPException(status_code=404, detail="account not found")
    return account
```

In `delete_account`: `account = await _get_account(db, account_id, lock=True)`; docstring gains "The account is read
FOR UPDATE first, so a balance, component or card link another tab writes meanwhile waits rather than leaving with the
cascade unimaged."

(`ruff format` decides the final wrapping of the conditional expressions.)

- [ ] **Step 5: Run it green, then every route's own delete tests**

Run: `$PY -m pytest tests/test_dependent_delete_locks.py -q -p no:cacheprovider`
Expected: `6 passed`.

Run: `$PY -m pytest tests/test_changelog_credit_cards.py tests/test_changelog_portfolio.py tests/test_changelog_completions.py tests/test_changelog_routes.py tests/test_credit_cards_api.py tests/test_portfolio_api.py tests/test_net_worth_api.py tests/test_spending_api.py -q -p no:cacheprovider`
Expected: all passed.

- [ ] **Step 6: Lint and commit**

```bash
git add app/services/changelog.py app/api/credit_cards.py app/api/portfolio.py app/api/spending.py app/api/net_worth.py tests/test_dependent_delete_locks.py
git commit -m "fix(deletes): the five dependent deletes lock their row FOR UPDATE before reading what hangs off it" \
  -m "delete_credit_card, delete_reward_category, delete_security, delete_category and delete_account image their dependents, then delete the row — but a child another tab wrote between that read and the row's DELETE left with the FK's ON DELETE, unimaged. Their first read is now changelog.lock_parent (Session.get with_for_update + populate_existing): a child's FK check needs FOR KEY SHARE on the row, so it waits for the delete and then fails its FK; one already in flight makes the read wait and is then imaged. Reached through each router's getter as lock=True, so the 404 sentences stay put. Tests: each route's lock precedes every dependent read (statement capture), and the lock's mode really blocks another session's child insert. Accepted and documented: a month save that already holds the review-table locks can deadlock with the delete of its own account — Postgres aborts one, nothing half-written."
```

---

### Task 4: An Undo re-inserts each run of rows into one table in one statement

**Files:**
- Modify: `backend/tests/test_changelog_portfolio.py` (imports; new test after
  `test_deleting_a_security_takes_its_price_rows_and_undo_puts_back_every_one`)
- Modify: `backend/tests/test_changelog_credit_cards.py` (new guard test after
  `test_undo_restores_a_deleted_reward_category_with_its_cells`)
- Modify: `backend/app/services/changelog.py` (`REINSERT_PARAMETERS`, `_reinsert`, the replay loop of `undo_batch`)

- [ ] **Step 1: Write the failing statement-count test**

`backend/tests/test_changelog_portfolio.py` imports: `from collections import Counter` (first), `from datetime import UTC,
date, datetime, timedelta`, `from tests.exact_undo import images, logged, shape, table_images, undo`, and
`from tests.ordering_helpers import recorded_sql`. New test:

```python
async def test_undoing_a_security_delete_re_inserts_each_table_in_one_statement(auth_client, db):
    """Years of daily closes (the employer ticker has ~780): the Undo re-inserts them with one
    multi-row INSERT per table, not one statement per row — and every row still comes back
    exactly, ids included."""
    security = await priced_security(db)
    security_id = security.id
    db.add_all(
        [
            PriceHistory(
                security_id=security_id,
                price_date=date(2023, 1, 2) + timedelta(days=day),
                close=Decimal("100.0000") + day,
            )
            for day in range(800)
        ]
    )
    await db.commit()
    tables = (Security, SecurityDividendEvent, PriceHistory, LatestPrice)
    before = await table_images(db, *tables)
    deleted = await auth_client.delete(f"{SECURITIES}/{security_id}")
    assert deleted.status_code == 204, deleted.text
    with recorded_sql(db) as statements:
        restored = await undo(auth_client, deleted)
    assert restored.status_code == 200, restored.text
    assert restored.json()["rows"] == 807  # 2 markers, 803 closes, the quote, the security
    inserts = Counter(sql.split()[2] for sql, _ in statements if sql.startswith("INSERT INTO"))
    replayed = ("securities", "latest_prices", "price_history", "security_dividend_events")
    assert {table: inserts[table] for table in replayed} == dict.fromkeys(replayed, 1)
    assert sum(inserts.values()) <= 6  # and the Undo's own change-log rows and run
    assert await table_images(db, *tables) == before
```

- [ ] **Step 2: Write the refusal guard (green before and after: it pins the mapping through the change)**

`backend/tests/test_changelog_credit_cards.py`:

```python
async def test_a_grouped_re_insert_that_breaks_a_constraint_still_refuses_whole(auth_client, db):
    """The Undo re-inserts a reward category's cells in ONE statement. When one of them can no
    longer go back — its card was deleted since — that statement's IntegrityError is still the
    replay refusal, and the category the same Undo had already put back goes again with it."""
    venture, savor, groceries = card("Venture X"), card("SavorOne", 1), category("Groceries")
    db.add_all([venture, savor, groceries])
    await db.flush()
    db.add_all(
        [
            RewardRate(card_id=venture.id, category_id=groceries.id, multiplier=Decimal("2.00")),
            RewardRate(card_id=savor.id, category_id=groceries.id, multiplier=Decimal("3.00")),
        ]
    )
    await db.commit()
    savor_id, groceries_id = savor.id, groceries.id
    deleted = await auth_client.delete(f"{CATEGORIES}/{groceries_id}")
    assert deleted.status_code == 204
    assert (await auth_client.delete(f"{CARDS}/{savor_id}")).status_code == 204
    refused = await undo(auth_client, deleted)
    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"] == REPLAY_REFUSAL
    assert await images(db, RewardCategory) == []
    assert await images(db, RewardRate) == []
```

- [ ] **Step 3: Run them — one red**

Run: `$PY -m pytest tests/test_changelog_portfolio.py tests/test_changelog_credit_cards.py -q -p no:cacheprovider`
Expected: `1 failed` — the statement count:
`{'securities': 1, 'latest_prices': 1, 'price_history': 803, 'security_dividend_events': 2} == {… 1 …}`.

- [ ] **Step 4: Implement — `backend/app/services/changelog.py`**

After the refusal sentences:

```python
# asyncpg binds at most 32,767 parameters per statement; a grouped re-insert splits below it.
REINSERT_PARAMETERS = 32_000
```

Before `undo_batch`:

```python
async def _reinsert(db: AsyncSession, table: Table, rows: list[dict[str, object]]) -> None:
    """A run of an Undo's consecutive re-inserts into one table, as multi-row INSERTs: a
    security's ~800 closes in one statement, not 800 round trips. Split below asyncpg's
    parameter limit. A constraint any row breaks raises IntegrityError from here, which the
    Activity route answers with REPLAY_REFUSAL exactly as it did row by row."""
    per_statement = max(1, REINSERT_PARAMETERS // max(1, len(rows[0])))
    for start in range(0, len(rows), per_statement):
        await db.execute(insert(table).values(rows[start : start + per_statement]))
```

The replay loop of `undo_batch` (from `for row in reversed(row_level):` to the line before `db.add(LifecycleRun(`)
becomes:

```python
    # A delete's inverse is a re-insert. Consecutive ones into the same table (with the same
    # columns) wait in `run` and go out together (_reinsert); any other step sends the run
    # first, so every statement still executes in reverse-log order.
    run_table: Table | None = None
    run: list[dict[str, object]] = []
    for row in reversed(row_level):
        table = Base.metadata.tables[row.table_name]
        before = {
            key: parse_cell(table.c[key], value)
            for key, value in (row.before or {}).items()
            if key in table.c
        }
        if run and (row.op != "delete" or table is not run_table or before.keys() != run[0].keys()):
            await _reinsert(db, run_table, run)
            run = []
        if row.op == "delete":
            run_table = table
            run.append(before)
            undo.record(row.table_name, row.pk, None, row.before, month=row.month)
            continue
        where = and_(
            *[table.c[key] == parse_cell(table.c[key], value) for key, value in row.pk.items()]
        )
        if row.op == "insert":
            await refuse_when_depended_on(db, table, {**(row.after or {}), **row.pk})
            await db.execute(delete(table).where(where))
            undo.record(row.table_name, row.pk, row.after, None, month=row.month)
        else:
            await db.execute(update(table).where(where).values(before))
            undo.record(row.table_name, row.pk, row.after, row.before, month=row.month)
    if run:
        await _reinsert(db, run_table, run)
```

and `undo_batch`'s docstring's first sentence gains "; consecutive re-inserts into one table go out as one
statement (_reinsert)".

- [ ] **Step 5: Green, and every exact-undo test still green**

Run: `$PY -m pytest tests/test_changelog_portfolio.py tests/test_changelog_credit_cards.py tests/test_changelog_calendar.py tests/test_changelog_completions.py tests/test_changelog_comp.py tests/test_changelog_espp.py tests/test_changelog_paycheck.py tests/test_activity_api.py tests/test_undo_chains.py -q -p no:cacheprovider`
Expected: all passed (the feed link's hash-less image still refuses its re-insert with `REPLAY_REFUSAL`).

- [ ] **Step 6: The after timing (throwaway probe, not committed)**

Run: `$PY -m pytest tests/test_zz_probe_undo_timing.py -q -s -p no:cacheprovider | grep PROBE`
Expected: `price_history: 1` and an Undo well under the 1.11 s baseline; record the three runs in "As built", then
`rm tests/test_zz_probe_undo_timing.py`.

- [ ] **Step 7: Lint and commit**

```bash
git add app/services/changelog.py tests/test_changelog_portfolio.py tests/test_changelog_credit_cards.py
git commit -m "perf(changelog): an Undo re-inserts each run of rows into one table with one multi-row INSERT" \
  -m "undo_batch replayed a delete's inverse one INSERT per row: undoing a security with 800 closes took ~1.1 s. Consecutive re-inserts into the same table with the same columns now gather and go out as insert(table).values([...]) (_reinsert), split below asyncpg's 32,767-parameter limit; any other replay step sends the run first, so statements still run in reverse-log order and the dependent check still sees the data it should. An IntegrityError from a grouped row still reaches the Activity route as REPLAY_REFUSAL (guard test: a category's cells re-inserted together after one's card was deleted). The security test pins one INSERT per replayed table and every row back exactly."
```

---

### Task 5: The L3b review's test gaps

**Files:**
- Modify: `backend/tests/test_changelog_paycheck.py` (imports; one test)
- Modify: `backend/tests/test_changelog_credit_cards.py` (imports; `seed_card_graph`, `seed_matrix`,
  `assert_round_trips`; two existing tests use the seeds; five tests)
- Modify: `backend/tests/test_changelog_comp.py` (one test)

Every test here pins behaviour that already holds (decision 7): each is shown to bite with the named mutation, reverted.

- [ ] **Step 1: The paycheck Undo takes the review-input locks first — `tests/test_changelog_paycheck.py`**

Import `from tests.ordering_helpers import first_position, recorded_sql`, then:

```python
async def test_the_undo_of_a_profile_takes_the_review_input_locks_first(auth_client, db, me):
    """paycheck_profiles is a month-review input (services.month_review.REVIEW_INPUT_TABLES), so
    its Undo takes the review tables' SHARE ROW EXCLUSIVE locks — the month save's own — before
    it reads whether the batch may still be undone, and before it writes."""
    profile_id = (await auth_client.post(PROFILES, json=PROFILE)).json()["id"]
    deleted = await auth_client.delete(f"{PROFILES}/{profile_id}")
    with recorded_sql(db) as statements:
        resp = await undo(auth_client, deleted)
    assert resp.status_code == 200, resp.text
    lock = first_position(statements, "LOCK TABLE")
    assert "paycheck_profiles" in statements[lock][0]
    assert statements[lock][0].endswith("IN SHARE ROW EXCLUSIVE MODE")
    assert lock < first_position(statements, "FROM lifecycle_runs")  # the eligibility reads
    assert lock < first_position(statements, "INSERT INTO paycheck_profiles")
```

Mutation: drop `"paycheck_profiles",` from `REVIEW_INPUT_TABLES` → `no statement contained 'LOCK TABLE'`.

- [ ] **Step 2: Seeds and the round-trip helper — `tests/test_changelog_credit_cards.py`**

Imports: `from sqlalchemy import func, select, text`; `from app.models import CardCredit, ChangeLog, CreditCard,
CreditLimitEvent, RewardCategory, RewardRate`. After `cell()`:

```python
CARD_TABLES = (CreditCard, CardCredit, RewardRate, CreditLimitEvent, RewardCategory)


async def seed_matrix(db) -> tuple[int, int, int]:
    """Groceries with two cells (one with a note, one with a cap) and Dining with one, on two
    cards. Returns the ids of Venture X, Groceries and Dining."""
    venture, savor = card("Venture X"), card("SavorOne", 1)
    groceries, dining = category("Groceries"), category("Dining", 1)
    db.add_all([venture, savor, groceries, dining])
    await db.flush()
    db.add_all(
        [
            RewardRate(
                card_id=venture.id,
                category_id=groceries.id,
                multiplier=Decimal("2.00"),
                note="Amex offer",
            ),
            RewardRate(
                card_id=savor.id,
                category_id=groceries.id,
                multiplier=Decimal("3.00"),
                monthly_cap=Decimal("500.00"),
            ),
            RewardRate(card_id=venture.id, category_id=dining.id, multiplier=Decimal("4.00")),
        ]
    )
    await db.commit()
    return venture.id, groceries.id, dining.id


async def seed_card_graph(db) -> tuple[int, int, int]:
    """Venture X with two credits, two cells, two limit events and the Travel category pinned to
    it, beside SavorOne with a credit, a cell, a limit and the Dining pin of its own. Returns the
    ids of Venture X, SavorOne and Travel."""
    venture = card("Capital One Venture X", annual_fee=Decimal("395.00"), rewards_currency="miles")
    savor = card("SavorOne", 1)
    db.add_all([venture, savor])
    await db.flush()
    travel = category("Travel", pinned_card_id=venture.id)
    dining = category("Dining", 1, pinned_card_id=savor.id)
    groceries = category("Groceries", 2)
    db.add_all([travel, dining, groceries])
    await db.flush()
    db.add_all(
        [
            CardCredit(card_id=venture.id, label="Travel", annual_value=Decimal("300.00")),
            CardCredit(
                card_id=venture.id,
                label="Global Entry",
                annual_value=Decimal("100.00"),
                counts=False,
                reset_cadence="anniversary",
            ),
            CardCredit(card_id=savor.id, label="Streaming", annual_value=Decimal("60.00")),
            RewardRate(
                card_id=venture.id,
                category_id=travel.id,
                multiplier=Decimal("10.00"),
                note="portal",
            ),
            RewardRate(card_id=venture.id, category_id=dining.id, multiplier=Decimal("2.00")),
            RewardRate(
                card_id=savor.id,
                category_id=dining.id,
                multiplier=Decimal("3.00"),
                monthly_cap=Decimal("500.00"),
            ),
            CreditLimitEvent(
                card_id=venture.id, effective_date=date(2023, 5, 12), limit_amount=Decimal("20000")
            ),
            CreditLimitEvent(
                card_id=venture.id,
                effective_date=date(2024, 6, 1),
                limit_amount=Decimal("30000"),
                note="CLI",
            ),
            CreditLimitEvent(
                card_id=savor.id, effective_date=date(2024, 1, 1), limit_amount=Decimal("9000")
            ),
        ]
    )
    await db.commit()
    return venture.id, savor.id, travel.id


async def assert_round_trips(auth_client, db, deleted, tables, whole) -> None:
    """Undo, then an Undo of that Undo (the delete again), then Undo once more: the rows land on
    exactly `whole`, exactly what the delete left, and exactly `whole` again."""
    gone = await table_images(db, *tables)
    batch = deleted
    for expected in (whole, gone, whole):
        resp = await undo(auth_client, batch)
        assert resp.status_code == 200, resp.text
        assert await table_images(db, *tables) == expected
        batch = resp.json()["batch_id"]
```

`test_undo_restores_a_deleted_reward_category_with_its_cells` starts with
`venture_id, groceries_id, dining_id = await seed_matrix(db)` in place of its inline seeding;
`test_undo_restores_a_deleted_card_with_its_credits_cells_limits_and_pins` starts with
`venture_id, savor_id, travel_id = await seed_card_graph(db)` and `tables = CARD_TABLES` in place of its inline seeding
(their assertions unchanged).

- [ ] **Step 3: The five credit-card tests**

```python
async def test_a_card_delete_undone_redone_and_undone_again_gives_the_same_rows(auth_client, db):
    venture_id, _, _ = await seed_card_graph(db)
    whole = await table_images(db, *CARD_TABLES)
    deleted = await auth_client.delete(f"{CARDS}/{venture_id}")
    assert deleted.status_code == 204
    await assert_round_trips(auth_client, db, deleted, CARD_TABLES, whole)


async def test_a_reward_category_delete_undone_redone_and_undone_again_gives_the_same_rows(
    auth_client, db
):
    _, groceries_id, _ = await seed_matrix(db)
    tables = (RewardCategory, RewardRate)
    whole = await table_images(db, *tables)
    deleted = await auth_client.delete(f"{CATEGORIES}/{groceries_id}")
    assert deleted.status_code == 204
    await assert_round_trips(auth_client, db, deleted, tables, whole)


async def test_a_matrix_save_that_fails_partway_records_nothing(auth_client, db):
    """ATOMIC (the route's own word): the 422 on the third cell comes after the first was
    cleared and the second changed in the session — and still no batch is named, nothing is
    logged and no cell is written."""
    venture = card("Venture X")
    travel, dining, groceries = category("Travel"), category("Dining", 1), category("Groceries", 2)
    db.add_all([venture, travel, dining, groceries])
    await db.flush()
    db.add_all(
        [
            RewardRate(card_id=venture.id, category_id=travel.id, multiplier=Decimal("2.00")),
            RewardRate(card_id=venture.id, category_id=dining.id, multiplier=Decimal("3.00")),
        ]
    )
    await db.commit()
    v, t, d, g = venture.id, travel.id, dining.id, groceries.id
    before = await images(db, RewardRate)
    failed = await auth_client.put(
        RATES, json=[cell(v, t, None), cell(v, d, "5"), cell(v, g, "0")]
    )
    assert failed.status_code == 422, failed.text
    assert failed.json()["detail"] == "multiplier must be positive"
    assert "x-change-batch" not in failed.headers
    assert (await db.execute(select(ChangeLog))).scalars().all() == []  # not even in the session
    await db.rollback()  # what the request's own session does on its way out
    assert (await db.execute(select(ChangeLog))).scalars().all() == []
    assert await images(db, RewardRate) == before


async def test_a_credit_edit_that_fails_validation_records_nothing(auth_client, db):
    """update_card_credit validates before it mutates: its 422 leaves the row untouched in the
    session as well as in the log."""
    card_id = (await auth_client.post(CARDS, json=card_body("Venture X"))).json()["id"]
    created = await auth_client.post(
        f"{CARDS}/{card_id}/credits", json={"label": "Travel", "annual_value": "300"}
    )
    assert created.status_code == 201, created.text
    credit_id = created.json()["id"]
    logged_before = (await db.execute(select(func.count()).select_from(ChangeLog))).scalar_one()
    before = await images(db, CardCredit)
    failed = await auth_client.patch(
        f"{CARDS}/credits/{credit_id}", json={"label": "Airline", "annual_value": "-1"}
    )
    assert failed.status_code == 422, failed.text
    assert failed.json()["detail"] == "annual_value must be non-negative"
    assert "x-change-batch" not in failed.headers
    assert not db.dirty  # not even the label moved
    count = (await db.execute(select(func.count()).select_from(ChangeLog))).scalar_one()
    assert count == logged_before
    assert await images(db, CardCredit) == before


async def test_undoing_a_reward_category_delete_after_its_name_was_taken_again_refuses(
    auth_client, db
):
    """Accepted (spec §6.1): name and slug are unique, so the replayed row cannot sit beside the
    new category that took the name — the replay refusal, and none of its cells half-back."""
    venture = card("Venture X")
    db.add(venture)
    await db.commit()
    v = venture.id
    created = await auth_client.post(CATEGORIES, json={"name": "Groceries"})
    assert created.status_code == 201, created.text
    category_id = created.json()["id"]
    assert (await auth_client.put(RATES, json=[cell(v, category_id, "3")])).status_code == 200
    deleted = await auth_client.delete(f"{CATEGORIES}/{category_id}")
    assert deleted.status_code == 204
    again = await auth_client.post(CATEGORIES, json={"name": "Groceries"})
    assert again.status_code == 201, again.text
    again_id = again.json()["id"]
    refused = await undo(auth_client, deleted)
    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"] == REPLAY_REFUSAL
    assert [row["id"] for row in await images(db, RewardCategory)] == [again_id]
    assert await images(db, RewardRate) == []
```

Mutations: round trips — replace `_reinsert`'s body with an early `return` → the first Undo's rows are missing;
matrix 422 — move `batch.label = …; response.headers.update(batch_header(await batch.commit()))` to just after the
first cell's `record_delete` → a logged row survives the rollback; credit 422 — move `credit.label = body.label` above
`_validated_credit_value(...)` → `db.dirty` holds the credit; name reuse — make `_reinsert` swallow
`IntegrityError` → the old category comes back beside the new one.

- [ ] **Step 4: The focal year — `tests/test_changelog_comp.py`**

```python
async def test_undoing_a_comp_event_delete_after_its_focal_year_was_reused_refuses(auth_client, db):
    """Accepted (spec §6.1): focal_year is the event's natural key, so the replayed row cannot
    sit beside the new event entered for the same year — the replay refusal, never a 500 and
    never an overwrite of the newer event."""
    event_id = (await auth_client.post(EVENTS, json=EVENT)).json()["id"]
    deleted = await auth_client.delete(f"{EVENTS}/{event_id}")
    assert deleted.status_code == 204
    again = await auth_client.post(EVENTS, json={**EVENT, "new_base": "180000"})
    assert again.status_code == 201, again.text
    again_id = again.json()["id"]
    refused = await undo(auth_client, deleted)
    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"] == REPLAY_REFUSAL
    assert [(row["id"], row["new_base"]) for row in await images(db, CompEvent)] == [
        (again_id, "180000.00")
    ]
```

- [ ] **Step 5: Run them**

Run: `$PY -m pytest tests/test_changelog_paycheck.py tests/test_changelog_credit_cards.py tests/test_changelog_comp.py -q -p no:cacheprovider`
Expected: all passed; then each named mutation run once and seen failing for its reason, reverted (`git diff --stat
app/` empty afterwards).

- [ ] **Step 6: Lint and commit**

```bash
git add tests/test_changelog_paycheck.py tests/test_changelog_credit_cards.py tests/test_changelog_comp.py
git commit -m "test(changelog): the L3b review's gaps — the paycheck Undo's review locks, undo/redo round trips, 422s that record nothing, two replay refusals" \
  -m "Pins behaviour that already holds, each shown to bite by a temporary mutation: a paycheck profile's Undo takes the review tables' SHARE ROW EXCLUSIVE locks before its eligibility reads and its write; a card delete and a reward-category delete go delete -> Undo -> Undo of the Undo -> Undo with identical rows at every step; a matrix save that 422s on its third cell and update_card_credit's 422 record nothing (no header, no log row, no write — the credit not even dirty); undoing a reward-category delete after its name was reused, and a comp event's after its focal year was, refuse with the replay sentence. The card and matrix seeds are shared helpers now."
```

---

### Task 6: Added / Edited everywhere; a matrix save names what it changed

**Files:**
- Modify: `backend/tests/test_changelog_completions.py`, `test_changelog_routes.py`, `test_reorder_accounts_api.py`,
  `test_changelog_calendar.py`, `test_changelog_service.py` (label strings)
- Modify: `backend/tests/test_changelog_credit_cards.py` (`cell()` takes `note`; new label test)
- Modify: `backend/app/api/net_worth.py`, `spending.py`, `calendar.py` (labels)
- Modify: `backend/app/api/credit_cards.py` (`_matrix_label`; `put_reward_rates`)

- [ ] **Step 1: Update the label tests**

```bash
sed -i -e 's/"Created account /"Added account /g' -e 's/"Updated account /"Edited account /g' \
       -e 's/"Created category /"Added category /g' -e 's/"Updated category /"Edited category /g' \
  tests/test_changelog_completions.py tests/test_changelog_routes.py tests/test_reorder_accounts_api.py tests/test_changelog_service.py
sed -i 's/"Created calendar feed link Phone"/"Added calendar feed link Phone"/' tests/test_changelog_calendar.py
```

(`test_changelog_service.py`'s three are hand-set sample labels; they follow the product's voice too.)

In `tests/test_changelog_credit_cards.py`, `cell()` becomes:

```python
def cell(
    card_id: int,
    category_id: int,
    multiplier: str | None,
    cap: str | None = None,
    note: str | None = None,
) -> dict:
    return {
        "card_id": card_id,
        "category_id": category_id,
        "multiplier": multiplier,
        "note": note,
        "monthly_cap": cap,
    }
```

and after `test_a_one_cell_save_is_singular_and_an_unchanged_save_names_no_batch`:

```python
async def test_a_matrix_save_is_named_for_what_it_changed(auth_client, db):
    """A cell whose multiplier was added, changed or cleared counts as a multiplier; a cell
    whose multiplier stayed while its note or monthly cap moved — its condition, the ⁺ the
    matrix shows — is named as a condition, never as an edited multiplier."""
    venture = card("Venture X")
    travel, dining, groceries = category("Travel"), category("Dining", 1), category("Groceries", 2)
    db.add_all([venture, travel, dining, groceries])
    await db.flush()
    db.add_all(
        [
            RewardRate(card_id=venture.id, category_id=travel.id, multiplier=Decimal("2.00")),
            RewardRate(card_id=venture.id, category_id=dining.id, multiplier=Decimal("3.00")),
        ]
    )
    await db.commit()
    v, t, d, g = venture.id, travel.id, dining.id, groceries.id
    capped = await auth_client.put(RATES, json=[cell(v, t, "2", cap="500")])
    assert label_of(await logged(db, capped)) == "Edited the condition on 1 reward multiplier"
    noted = await auth_client.put(
        RATES, json=[cell(v, t, "2", cap="500", note="portal"), cell(v, d, "3", note="Uber only")]
    )
    assert label_of(await logged(db, noted)) == "Edited the conditions on 2 reward multipliers"
    mixed = await auth_client.put(
        RATES, json=[cell(v, t, "5", cap="500", note="portal"), cell(v, d, "3"), cell(v, g, "4")]
    )
    assert label_of(await logged(db, mixed)) == (
        "Edited 2 reward multipliers and the condition on 1 more"
    )
```

- [ ] **Step 2: Run them red**

Run: `$PY -m pytest tests/test_changelog_completions.py tests/test_changelog_routes.py tests/test_reorder_accounts_api.py tests/test_changelog_calendar.py tests/test_changelog_service.py tests/test_changelog_credit_cards.py -q -p no:cacheprovider`
Expected: the route-label tests fail on the old verbs (`'Created account Brokerage' == 'Added account Brokerage'` and
the like) and the matrix test on `'Edited 1 reward multiplier' == 'Edited the condition on 1 reward multiplier'`;
`test_changelog_service.py` passes (its labels are hand-set).

- [ ] **Step 3: Implement the verbs**

- `backend/app/api/net_worth.py`: `batch.label = f"Added account {account.name}"` (create_account) and
  `batch.label = f"Edited account {account.name}"` (update_account).
- `backend/app/api/spending.py`: `batch.label = f"Added category {category.name}"` (create_category) and
  `batch.label = f"Edited category {category.name}"` (update_category).
- `backend/app/api/calendar.py`: `batch.label = f"Added calendar feed link {row.label}"` (create_feed_token).

- [ ] **Step 4: Implement the matrix label — `backend/app/api/credit_cards.py`**

In the labels section, after `_reorder_label`:

```python
def _matrix_label(multipliers: int, conditions: int) -> str:
    """A matrix save's label, by what it changed: the cells whose multiplier was added,
    changed or cleared, and the cells where only the condition moved — the note and the
    monthly bonus cap the matrix marks with ⁺. A save that only capped a bonus must not claim
    it edited a multiplier."""

    def cells(count: int) -> str:
        return f"{count} reward multiplier{'' if count == 1 else 's'}"

    condition = "condition" if conditions == 1 else "conditions"
    if not conditions:
        return f"Edited {cells(multipliers)}"
    if not multipliers:
        return f"Edited the {condition} on {cells(conditions)}"
    return f"Edited {cells(multipliers)} and the {condition} on {conditions} more"
```

In `put_reward_rates`: after `added: list[RewardRate] = []` add `multipliers = conditions = 0`; the clear branch
counts it:

```python
        if entry.multiplier is None:
            if row is not None:
                batch.record_delete(row)
                await db.delete(row)
                multipliers += 1
            continue
```

the update branch becomes:

```python
        else:
            before = row_image(row)
            row.multiplier = multiplier
            row.note = entry.note
            row.monthly_cap = cap
            batch.record_update(row, before)
            after = row_image(row)
            if after["multiplier"] != before["multiplier"]:
                multipliers += 1
            elif after != before:
                conditions += 1  # the note or the cap alone
```

and the label lines become:

```python
    batch.label = _matrix_label(multipliers + len(added), conditions)
```

(replacing `changed = batch.rows` and the old f-string). The docstring's last sentence becomes: "… so one Undo reverts
the whole save, and its label counts multipliers apart from conditions (_matrix_label); an all-unchanged save records
nothing and names no batch."

- [ ] **Step 5: Green**

Run: the Step 2 command.
Expected: all passed.

- [ ] **Step 6: Lint and commit**

```bash
git add app/api/net_worth.py app/api/spending.py app/api/calendar.py app/api/credit_cards.py tests/test_changelog_completions.py tests/test_changelog_routes.py tests/test_reorder_accounts_api.py tests/test_changelog_calendar.py tests/test_changelog_service.py tests/test_changelog_credit_cards.py
git commit -m "fix(labels): Added/Edited everywhere, and a matrix save names conditions apart from multipliers" \
  -m "The Activity card read 'Created account' / 'Updated category' beside the new 'Added card' / 'Edited security': accounts, spending categories and the calendar feed link now say Added / Edited like every other route (their tests updated). A matrix save that only moved a note or a monthly cap said 'Edited 1 reward multiplier'; it now counts cells whose multiplier was added, changed or cleared apart from cells where only the condition moved — the page's own word for note + cap: 'Edited the condition on 1 reward multiplier', 'Edited 2 reward multipliers and the condition on 1 more'."
```

---

### Task 7: Gates and "As built"

**Files:**
- Modify: `docs/superpowers/plans/2026-09-25-polish-L3c-undo-engine.md` (append "As built")

- [ ] **Step 1: The probe is gone**

Run: `git status --porcelain` → nothing untracked under `tests/` (the timing probe was deleted in Task 4).

- [ ] **Step 2: Full backend suite**

Run: `$PY -m pytest -n 4 -q -p no:cacheprovider`
Expected: all passed — 2,811 + this lane's new tests (3 chain + 6 lock + 2 grouped-replay + 7 gap + 1 matrix label =
19) = **2,830 passed, 4 skipped**. A pre-existing flake is re-run alone once and noted if it passes.

- [ ] **Step 3: Lint and format**

Run: `$PY -m ruff check app tests` → `All checks passed!`
Run: `$PY -m ruff format --check app tests` → `… files already formatted`.

- [ ] **Step 4: Append "As built"** — deviations and why, the gates, the counts, the before/after Undo timing — and
  commit:

```bash
git add ../docs/superpowers/plans/2026-09-25-polish-L3c-undo-engine.md
git commit -m "docs(plan): L3c as built — gates, counts, timing, deviations"
```

---

## Self-review — the brief mapped to tasks

| Brief item | Task |
|---|---|
| 1. `superseded`: a later batch and its standing Undo cancel; redo counts again; parity over chains, defined in the docstring; listing agrees; refusal sentence kept | 2 (decision 1) |
| 1. Tests: probe ends 200 with rows exact; edit → reorder → undo → redo → undo edit 409; two later, one undone → 409; categories test retries and succeeds; listing flips | 2 (the card probe test, `test_undo_chains.py` ×3, the categories test) |
| 2. FOR UPDATE on the parent in the five deletes; SQL asserted via the repo's statement capture | 3 (`lock_parent`, `test_dependent_delete_locks.py`) |
| 3. Grouped multi-row re-inserts, order and refusals preserved; ≤ a handful of INSERTs for a security; timing before/after | 4 |
| 4. One helper module with `populate_existing`, imports updated, the other deleted | 1 |
| 5. Paycheck Undo locks; round trips for card and reward-category deletes; matrix 422 partway; credit 422; REPLAY after name and focal-year reuse | 5 |
| 6. Added / Edited; matrix label by what changed, tested | 6 |
| Gates: full `-n 4`, ruff check + format; "As built" with timing | 7 |

---

## As built (2026-09-25)

All seven tasks landed as written, one commit each, on `feat/polish-undo-engine` (cut from `bdb87301`, which already
holds L3a and L3b). No schema change, no migration, no response-shape change. Not pushed, not merged.

| Commit | Task |
|---|---|
| `03eade73` docs(plan): lane L3c — undo engine follow-up | plan |
| `b05d4127` test(changelog): one exact-undo helper module — exact_undo absorbs changelog_asserts | 1 |
| `70c21658` fix(changelog): a later change and its standing Undo cancel out — "undo those first" is true | 2 |
| `b0c682f4` fix(deletes): the five dependent deletes lock their row FOR UPDATE before reading what hangs off it | 3 |
| `7c684a37` perf(changelog): an Undo re-inserts each run of rows into one table with one multi-row INSERT | 4 |
| `09f8bc15` test(changelog): the L3b review's gaps | 5 |
| `fe6fe5d5` fix(labels): Added/Edited everywhere, and a matrix save names conditions apart from multipliers | 6 |

(plus this "As built" commit.)

### Gates

| Gate | Result |
|---|---|
| `pytest -n 4` (full backend suite, `FINANCE_TEST_DB=finance_test_l3c`) | **2,830 passed, 4 skipped** in 97.5 s (baseline on `bdb87301`: 2,811 passed, 4 skipped in 81.5 s) |
| `ruff check app tests` | All checks passed |
| `ruff format --check app tests` | 314 files already formatted |
| New tests | **19**: `test_undo_chains.py` 3, `test_dependent_delete_locks.py` 6 (5 routes + the lock's mode), grouped re-insert 2 (`test_changelog_portfolio.py` statement count, `test_changelog_credit_cards.py` refusal guard), the review's gaps 7 (`test_changelog_paycheck.py` 1, `test_changelog_credit_cards.py` 5, `test_changelog_comp.py` 1), matrix label 1 |
| Changed tests | the categories overlap test and the two card-page overlap tests now retry and succeed; the card-delete and reward-category-delete tests use shared seeds; `cell()` takes `note`; five files' label strings; every L3b helper call site (Task 1) |

Every red run matched its prediction: Task 1 none (81 passed before and after); Task 2 `6 failed` (`assert False is True`,
five `409 == 200`); Task 3 the `ImportError`, then — with the helper alone, routes untouched — the five route cases on
`no statement contained 'FOR UPDATE'` while the lock-mode race test passed; Task 4 `1 failed` (`price_history: 803`
vs `1`; the refusal guard green before and after, as planned); Task 6 `7 failed` on the old verbs and on
`'Edited 1 reward multiplier'`.

Task 5's tests pin behaviour that already held, so each was shown to bite with a temporary mutation, then reverted
(`git diff --stat app/` empty afterwards):

| Test | Mutation | Failure seen |
|---|---|---|
| paycheck Undo takes the review locks first | drop `paycheck_profiles` from `REVIEW_INPUT_TABLES` | `no statement contained 'LOCK TABLE'` |
| card / reward-category round trips | `_reinsert` returns without writing | rows missing; the card's pin replay refused (`409 == 200`) |
| matrix save 422 partway | `await batch.commit()` right after the first cleared cell | a `ChangeLog` row survives |
| `update_card_credit` 422 | `credit.label = body.label` above the validation | `db.dirty` holds the credit |
| reward-category name reuse, focal-year reuse | the Activity route stops mapping `IntegrityError` | the `UniqueViolationError` escapes as a 500 |

### Undo timing — an 800-close security (throwaway probe, same box, deleted after use)

| | Undo POST | `INSERT INTO price_history` statements |
|---|---|---|
| before (`bdb87301`) | 1.158 / 1.114 / 0.972 s — median **1.11 s** | 800 |
| after (Task 4) | 0.497 / 0.644 / 0.684 / 0.516 / 0.716 / 0.444 / 0.799 / 0.458 s — median **≈0.58 s** | **1** (≈30 ms) |

One further "after" run took 2.42 s — the first request of its process — and did not reproduce in the eight runs
above. Where the remaining ≈0.5 s goes (profiled): ≈0.27 s of SQL, of which ≈0.16 s is `superseded`'s self-join. That
is a test-database artifact which also sat in the baseline: on the freshly written, never-ANALYZEd `change_log` the
planner picks a nested loop (802 inner index scans, 172 ms); after `ANALYZE change_log` the same query is a 0.28 ms hash
join. The rest is Python and ORM — the Undo's own 802 change-log rows built and inserted, and the Activity route reading
them back for its answer. A production Undo (analyzed statistics) should come in below both numbers.

### Deviations and notes

1. **Commit staging.** The plan's Task 1 commit used `git add -A tests/`; every commit staged explicit paths instead,
   because the untracked timing probe sat in `tests/` until Task 4.
2. **Two mutations were swapped for more direct ones** (table above): the matrix-422 check inserted
   `await batch.commit()` after the first cleared cell (same effect as moving the commit); the replay-refusal check
   un-mapped `IntegrityError` in the Activity route instead of making `_reinsert` swallow it (a swallowed error leaves the
   transaction aborted and fails on the next statement — less direct).
3. **`ruff format`** re-flowed the matrix-422 test's PUT onto one line; nothing else changed shape.
4. **`test_changelog_service.py`'s three "Created account Brokerage" were hand-set sample labels,** not route output;
   they follow the product's voice now too.

### For the coordinator

- **How `superseded` decides now:** a later change is a batch with an entry on one of the batch's `(table, pk)` after
  its last entry; it counts only when it *stands* (an even number of Undos above it in its chain) and is not the Undo of
  a batch that is itself later. So a change and its standing Undo cancel, a redo brings the change back, an Undo of the
  redo cancels the whole chain, and an Undo of an *older* batch is an ordinary later change (the redo it would allow
  would re-apply what its images carry — `test_a_redo_refuses_once_an_older_changes_undo_rewrote_its_rows`). The
  listing's `undoable` reads the same function.
- **Accepted, documented in `lock_parent`:** a month save that already holds the review-table locks and then needs the
  row being deleted (saving a balance for the very account another tab is deleting) can deadlock with the delete;
  Postgres aborts one request and nothing is half-written. Before this lane the same race silently cascaded the new
  balance away. Taking `lock_review_inputs` first in `delete_account` / `delete_category` would serialize the two
  instead — table-level locking the brief did not ask for; a candidate follow-up.
- **Not covered by the parent lock** (out of the brief's scope, the cascade): a child re-pointed *away* from the row, or
  edited in place, by another tab during the delete.
- **Labels:** an account's or category's one-click Retire/Restore now reads "Edited account …" / "Edited category …";
  toggle verbs like the cards' "Archived/Unarchived" were not asked for.
- **Left alone:** `services/month_status._undone` still walks `undone_by` one query per link (it could read
  `_undo_links` once); the `superseded` self-join has no `(table_name, pk)` index — fine with statistics, worth a look if
  the log grows large; the Activity card's ⓘ copy is frontend (lane L5). L3b's plan still shows the old matrix label in
  its contract table; this record supersedes it.
