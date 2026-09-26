# Lane L3b "Backend B" — exact undo for the card, ESPP, paycheck and comp routers (2026-09-25) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-09-25-polish-alignment-feedback-undo-design.md` — this lane implements **§6.1** for
`credit_cards.py`, `espp.py`, `paycheck.py` and `comp.py` (decision **D1**, "exact undo everywhere"), against contract
**C1** of `docs/superpowers/plans/2026-09-25-polish-00-overview.md`. Lane L3a does the same for `portfolio.py`,
`calendar.py` and the `spending.py` / `net_worth.py` completions, in parallel.

**Goal:** every one of the 32 committing functions in the four routers records through a `ChangeBatch` with a human
Activity label and answers `X-Change-Batch`, and every delete — including the two with dependents — is undone by the
Activity card exactly: same rows, same ids, same pins.

**Architecture:** each route takes `batch: ChangeBatch = Depends(change_batch)` and commits through `batch.commit()`
instead of `db.commit()`. Creates flush, then `record_insert`; edits take `row_image` before mutating, then
`record_update`; deletes `record_delete` before `db.delete`. The two deletes with dependents
(`delete_credit_card`, `delete_reward_category`) image and delete/NULL their dependents explicitly through the ORM —
children first, parent LAST — and flush before the parent's own DELETE, so `undo_batch` (which replays in strict reverse
of `change_log.id`) brings the parent back first. The two card-list reorders become logged like the accounts' and join
the Undo's list-lock order (`services/ordering.py`).

**Tech stack:** FastAPI + SQLAlchemy 2 (async) + asyncpg, Postgres 16, pytest (+ xdist), ruff. No schema change, no
migration (the `change_log` table exists).

---

## Mechanics (read once)

- **Worktree:** `C:/Users/edyli/personal-finance-dashboard/.worktrees/polish-undo-b`, branch `feat/polish-undo-b`. Work
  only here. Commit on the branch; never push, never merge (the coordinator merges).
- **Python:** the main checkout's venv, `C:/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe`
  (written `$PY` below — the tool shell keeps no variables, so each command line starts with
  `PY=C:/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe;`). Every backend command runs with cwd
  `<worktree>/backend`. `$PY -c "import app; print(app.__file__)"` must print the WORKTREE's path.
- **Tests:** `FINANCE_TEST_DB=finance_test_l3b $PY -m pytest <files> -q` per task (conftest creates the database on
  127.0.0.1:5433). The full suite once at the end with `-n 4` (workers claim `finance_test_l3b_gw0…3`).
- **Lint:** `$PY -m ruff check app tests` and `$PY -m ruff format --check app tests` before every commit. When the
  format check names a file, run `$PY -m ruff format <file>` and re-check.
- **Commits:** one per task, conventional prefix, a body saying what and why.

## Decisions this plan takes where the spec is silent

1. **Label voice.** "Added / Edited / Deleted {thing}" — the spec's new examples ("Added NVDA buy of Sep 2, 2026",
   "Edited 3 reward multipliers") rather than the older "Created / Updated". Exceptions, each the page's own word:
   - an ESPP period create is **"Saved"** (the modeler materializes a derived row when it is saved) and its delete is
     **"Reset"** (the modeler's only door to it is "Reset … to its derived values");
   - a card or reward-category PATCH whose only moved column is `is_active` is the one-click toggle, named with the
     button's verb: **"Archived / Unarchived card X"** (the roster), **"Hid / Showed reward category X"** (the
     categories table);
   - reorders follow the accounts' / spending categories' §8.4 rule: **"Moved card X"** when one row's move explains the
     change, else **"Reordered {n} cards"** (n = the minimal moved set).
2. **Amounts and days in labels.** Days through the house's one spelling, `services.day_labels.long_day` ("Feb 29,
   2024"). Money as "$300" / "$20,000" / "$1,234.50" (whole dollars drop the cents). "the" before an amount, never "a":
   "a $800 credit" reads wrong aloud, "the $800 credit" never does.
3. **Paycheck labels name the owner** ("Deleted Edward's paycheck profile effective Aug 17, 2026"), not the task
   example's "Deleted the profile effective …": the effective date is unique per PERSON, so two earners can each have a
   profile effective the same day and the bare label would not say which.
4. **Credit labels** read "the {$} {label} credit", matching the card page's own "Delete the {label} credit"; a label
   that already ends in "credit" keeps its own word ("Airline credit", not "Airline credit credit").
5. **Explicit flush before a parent's DELETE.** These models have no `relationship()`, so SQLAlchemy's unit of work
   orders DELETEs by mapped class name (`("DeleteAll", "app.models.credit_cards.<Class>")`, sorted), which puts
   `CreditCard` before `CreditLimitEvent` / `RewardRate` and `RewardCategory` before `RewardRate`. Without a flush the
   parent's DELETE would run first and the FK cascade would remove rows the session still means to delete. Pinned by the
   SQL-order assertions in the two exact-undo tests.
6. **Recording order in `put_reward_rates`:** edits and clears in body order as they happen, then the new cells after
   the one flush that gives them ids. Keys are unique per request, so the reverse replay has no conflicts.
7. **Service change 1 — `services/ordering.py`:** `order_locks_for` walks a new `LOGGED_LISTS = (*ORDERED_LISTS,
   CreditCard, RewardCategory)`. Decision 16 of the 2026-09-23 reorder plan made an Activity-card Undo that rewrites a
   logged list take that list's order lock, so it cannot blend with a reorder in another tab; the card lists are logged
   now, so their Undo must serialize too. They come LAST: the importer (which takes `ORDERED_LISTS`) never touches
   them, so no path can hold a card lock while waiting for a workbook one. `ORDERED_LISTS` (the importer's three) is
   unchanged.
8. **Service change 2 — `services/changelog.py`:** comment only — the Undo's lock comment names the lists by
   `LOGGED_LISTS` instead of "accounts or spending categories", which would now be incomplete.
9. **`update_card_credit` validates before it mutates** (the house's "every raise is behind us — mutate only now"),
   which the before-image makes natural. Behaviour is otherwise unchanged.
10. **Tests:** four new per-router files plus one small helper module, `tests/changelog_asserts.py` (a name unlikely to
    collide with anything L3a adds). Existing tests changed: `test_reorder_credit_cards_api.py` (its two "unlogged"
    assertions), `test_reorder_serialization.py` (two direct calls take the new `response, db, batch` arguments). The
    card-list Undo lock test lives in the new credit-card file rather than as new parameters of the shared
    `test_reorder_serialization.py` test, which L3a may extend for the ledger.
11. **Pin test:** my four modules go at the TOP of `LOGGED` in `tests/test_changelog_pin.py`, so L3a's entries (appended
    after `taxes.py`) land in a disjoint hunk; the coordinator merges by union.
12. **No response body changes.** Only the header is added; the `in_force` flag on paycheck profiles stays an unmapped
    attribute and never reaches an image.

## Contract this lane publishes (C1 for the four routers)

Every row below answers `X-Change-Batch: <uuid>` when it recorded at least one row, and no header when it recorded
nothing (an all-unchanged edit, an unchanged order, an all-unchanged matrix save).

| Route | Logged rows, in order `(op, table)` | Label |
|---|---|---|
| `POST /credit-cards/categories` (201) | insert reward_categories | Added reward category {name} |
| `PUT /credit-cards/categories/order` | update reward_categories × each row whose sort_order moved | Moved reward category {name} · Reordered {n} reward categories |
| `PATCH /credit-cards/categories/{id}` | update reward_categories | Edited reward category {name} · Hid / Showed reward category {name} |
| `DELETE /credit-cards/categories/{id}` (204) | delete reward_rates × its cells, then delete reward_categories | Deleted reward category {name} |
| `PUT /credit-cards/rates` | update / delete reward_rates per changed cell (body order), then insert per new cell | Edited {n} reward multiplier(s) |
| `POST /credit-cards` (201) | insert credit_cards | Added card {name} |
| `PUT /credit-cards/order` | update credit_cards × each moved row | Moved card {name} · Reordered {n} cards |
| `PATCH /credit-cards/{id}` | update credit_cards | Edited card {name} · Archived / Unarchived card {name} |
| `DELETE /credit-cards/{id}` (204) | update reward_categories × pins (→ NULL), delete card_credits ×, delete reward_rates × (by card), delete credit_limit_events ×, then delete credit_cards | Deleted card {name} |
| `POST /credit-cards/{id}/credits` (201) | insert card_credits | Added the {$} {label} credit to {card} |
| `PATCH /credit-cards/credits/{id}` | update card_credits | Edited the {label} credit on {card} |
| `DELETE /credit-cards/credits/{id}` (204) | delete card_credits | Deleted the {$} {label} credit from {card} |
| `POST /credit-cards/{id}/limits` (201, the full history) | insert credit_limit_events | Added {card}'s {$} limit from {Mon D, YYYY} |
| `DELETE /credit-cards/{id}/limits/{event_id}` (204) | delete credit_limit_events | Deleted {card}'s {$} limit from {Mon D, YYYY} |
| `POST /espp/lots` (201) | insert espp_lots | Added the lot purchased {Mon D, YYYY} |
| `PATCH /espp/lots/{id}` | update espp_lots | Edited the lot purchased {date} |
| `DELETE /espp/lots/{id}` (204) | delete espp_lots | Deleted the lot purchased {date} |
| `POST /espp/periods` (201) | insert espp_periods | Saved the {label} purchase period |
| `PATCH /espp/periods/{id}` | update espp_periods | Edited the {label} purchase period |
| `DELETE /espp/periods/{id}` (204) | delete espp_periods | Reset the {label} purchase period |
| `POST /espp/offerings` (201) | insert espp_offerings | Added the offering starting {date} |
| `PATCH /espp/offerings/{id}` | update espp_offerings | Edited the offering starting {date} |
| `DELETE /espp/offerings/{id}` (204) | delete espp_offerings | Deleted the offering starting {date} |
| `POST /paycheck/profiles` (201) | insert paycheck_profiles | Added {person}'s paycheck profile effective {date} |
| `PATCH /paycheck/profiles/{id}` | update paycheck_profiles | Edited {person}'s paycheck profile effective {date} |
| `DELETE /paycheck/profiles/{id}` (204) | delete paycheck_profiles | Deleted {person}'s paycheck profile effective {date} |
| `POST /comp/events` (201) | insert comp_events | Added the {year} comp event |
| `PATCH /comp/events/{id}` | update comp_events | Edited the {year} comp event |
| `DELETE /comp/events/{id}` (204) | delete comp_events | Deleted the {year} comp event |
| `POST /comp/rsu-grants` (201) | insert rsu_grants | Added RSU grant {label} |
| `PATCH /comp/rsu-grants/{id}` | update rsu_grants | Edited RSU grant {label} |
| `DELETE /comp/rsu-grants/{id}` (204) | delete rsu_grants | Deleted RSU grant {label} |

Every change-log row of these batches has `month = NULL` (none of them is a month's data) and `source = 'ui'` unless the
client claims `repair`.

**Accepted behaviours** (documented in the routers' docstrings, not fixed):
- Undoing a delete after a new row took the same unique name — card name, reward-category name, lot purchase date,
  period label, offering start, focal year, grant label, a person's profile date — refuses with `REPLAY_REFUSAL`.
- Undoing a create while other rows now point at it (a card's credits, cells, limit history or pins; a reward
  category's cells) refuses with `DEPENDENT_REFUSAL` — the user undoes those first.

## File map

| File | Change |
|---|---|
| `backend/app/api/comp.py` | 6 routes logged; module docstring paragraph |
| `backend/app/api/espp.py` | 9 routes logged; module docstring paragraph |
| `backend/app/api/paycheck.py` | 3 routes logged + `_profile_label`; module docstring paragraph |
| `backend/app/api/credit_cards.py` | 14 routes logged; module docstring; label helpers `_edit_label`, `_dollars`, `_credit_name`, `_reorder_label`; the two deletes image their dependents |
| `backend/app/services/ordering.py` | `LOGGED_LISTS`; `order_locks_for` walks it |
| `backend/app/services/changelog.py` | one comment |
| `backend/tests/changelog_asserts.py` | NEW — `logged`, `ops`, `label_of`, `table_rows`, `undo` |
| `backend/tests/test_changelog_comp.py` | NEW — 6 tests |
| `backend/tests/test_changelog_espp.py` | NEW — 7 tests |
| `backend/tests/test_changelog_paycheck.py` | NEW — 3 tests |
| `backend/tests/test_changelog_credit_cards.py` | NEW — 18 tests |
| `backend/tests/test_changelog_pin.py` | the four modules at the top of `LOGGED` |
| `backend/tests/test_reorder_credit_cards_api.py` | docstring + the two "unlogged" assertions become logged ones |
| `backend/tests/test_reorder_serialization.py` | the card race's two direct calls pass `Response(), session, ChangeBatch(...)` |

---

## Task 0 — preflight

- [ ] **Step 1: confirm the worktree and the import path**

Run (cwd `…/.worktrees/polish-undo-b`): `git status && git branch --show-current`
Expected: `nothing to commit, working tree clean` and `feat/polish-undo-b`.

Run (cwd `…/backend`): `PY=…/python.exe; $PY -c "import app; print(app.__file__)"`
Expected: `C:\Users\edyli\personal-finance-dashboard\.worktrees\polish-undo-b\backend\app\__init__.py`.

- [ ] **Step 2: baseline suite**

Run: `FINANCE_TEST_DB=finance_test_l3b $PY -m pytest -n 4 -q -p no:cacheprovider`
Expected: `2747 passed, 4 skipped, 3 warnings` (the warnings are `test_restore_points.py`'s pre-existing SyntaxWarning),
exit 0.

---

## Task 1 — the shared test helpers, and `comp.py` logged (6 routes)

**Files:**
- Create: `backend/tests/changelog_asserts.py`
- Create: `backend/tests/test_changelog_comp.py`
- Modify: `backend/tests/test_changelog_pin.py` (top of `LOGGED`)
- Modify: `backend/app/api/comp.py` (imports, module docstring, `create_event`, `update_event`, `delete_event`,
  `create_grant`, `update_grant`, `delete_grant`)

- [ ] **Step 1: write the helper module**

`backend/tests/changelog_asserts.py`:

```python
"""Shared by lane L3b's change-log tests (2026-09-25 polish spec §6.1): the change-log rows of
the batch one logged write named in its X-Change-Batch header, and every row of a table as the
DATABASE holds it — so an Undo can be held to "the same rows, ids included"."""

from sqlalchemy import select

from app.models import ChangeLog

ACTIVITY = "/api/v1/activity"


async def logged(db, response) -> list[ChangeLog]:
    """The rows of the batch `response` names, in the order they were recorded. A KeyError
    here IS the finding: the route answered without the header."""
    batch_id = response.headers["x-change-batch"]
    return list(
        (
            await db.execute(
                select(ChangeLog).where(ChangeLog.batch_id == batch_id).order_by(ChangeLog.id)
            )
        )
        .scalars()
        .all()
    )


def ops(rows: list[ChangeLog]) -> list[tuple[str, str]]:
    return [(row.op, row.table_name) for row in rows]


def label_of(rows: list[ChangeLog]) -> str:
    """The batch's one label — every row of a batch carries the same."""
    [label] = {row.label for row in rows}
    return label


async def table_rows(db, *models) -> dict[str, list[dict]]:
    """Every row of each model's table in primary-key order, read with a Core SELECT — never
    through the session's identity map, which can still hold objects a route deleted or an
    undo replaced behind it."""
    out: dict[str, list[dict]] = {}
    for model in models:
        table = model.__table__
        result = await db.execute(select(table).order_by(*table.primary_key.columns))
        out[table.name] = [dict(row._mapping) for row in result]
    return out


async def undo(auth_client, response):
    """The Activity card's Undo of the batch `response` names."""
    return await auth_client.post(f"{ACTIVITY}/batches/{response.headers['x-change-batch']}/undo")
```

- [ ] **Step 2: write the failing comp tests**

`backend/tests/test_changelog_comp.py`:

```python
"""The comp router's writes are change-logged (2026-09-25 polish spec §6.1, lane L3b): every
focal-event and RSU-grant create, edit and delete is one batch with an Activity label and the
X-Change-Batch header, and the Activity card undoes a delete exactly — same id, same row."""

from app.models import CompEvent, RsuGrant
from app.services.changelog import REPLAY_REFUSAL
from tests.changelog_asserts import label_of, logged, ops, table_rows, undo

EVENTS = "/api/v1/comp/events"
GRANTS = "/api/v1/comp/rsu-grants"

EVENT = {
    "focal_year": 2025,
    "current_base": "162000",
    "new_base": "175000",
    "unvested_rsus": "1822",
    "unvested_price": "183.2508",
    "refresh_rsus": "610.0524",
    "grant_price": "129.5651",
    "notes": "mid-cycle focal",
}
GRANT = {
    "kind": "refresh",
    "label": "2025 focal",
    "focal_year": 2025,
    "shares": 480,
    "grant_price": "129.5651",
    "first_vest_date": "2025-06-18",
    "cliff_pct": "0.0625",
    "notes": "refresh grant",
}


async def test_comp_event_create_edit_delete_each_log_one_labelled_batch(auth_client, db):
    created = await auth_client.post(EVENTS, json=EVENT)
    assert created.status_code == 201, created.text
    rows = await logged(db, created)
    assert ops(rows) == [("insert", "comp_events")]
    assert label_of(rows) == "Added the 2025 comp event"
    assert rows[0].after["current_base"] == "162000.00"
    event_id = created.json()["id"]

    edited = await auth_client.patch(f"{EVENTS}/{event_id}", json={"new_base": "180000"})
    assert edited.status_code == 200, edited.text
    rows = await logged(db, edited)
    assert ops(rows) == [("update", "comp_events")]
    assert label_of(rows) == "Edited the 2025 comp event"
    assert (rows[0].before["new_base"], rows[0].after["new_base"]) == ("175000.00", "180000.00")

    deleted = await auth_client.delete(f"{EVENTS}/{event_id}")
    assert deleted.status_code == 204
    rows = await logged(db, deleted)
    assert ops(rows) == [("delete", "comp_events")]
    assert label_of(rows) == "Deleted the 2025 comp event"
    assert rows[0].before["focal_year"] == 2025 and rows[0].after is None


async def test_an_unchanged_comp_event_edit_logs_nothing_and_names_no_batch(auth_client):
    event_id = (await auth_client.post(EVENTS, json=EVENT)).json()["id"]
    same = await auth_client.patch(f"{EVENTS}/{event_id}", json={"new_base": "175000.00"})
    assert same.status_code == 200, same.text
    assert "x-change-batch" not in same.headers  # the client offers no Undo for a no-op


async def test_undo_restores_a_deleted_comp_event_exactly(auth_client, db):
    event_id = (await auth_client.post(EVENTS, json=EVENT)).json()["id"]
    before = await table_rows(db, CompEvent)
    deleted = await auth_client.delete(f"{EVENTS}/{event_id}")
    assert await table_rows(db, CompEvent) == {"comp_events": []}
    resp = await undo(auth_client, deleted)
    assert resp.status_code == 200, resp.text
    assert resp.json()["label"] == "Undid: Deleted the 2025 comp event"
    assert await table_rows(db, CompEvent) == before


async def test_rsu_grant_create_edit_delete_each_log_one_labelled_batch(auth_client, db):
    created = await auth_client.post(GRANTS, json=GRANT)
    assert created.status_code == 201, created.text
    rows = await logged(db, created)
    assert ops(rows) == [("insert", "rsu_grants")]
    assert label_of(rows) == "Added RSU grant 2025 focal"
    grant_id = created.json()["id"]

    edited = await auth_client.patch(f"{GRANTS}/{grant_id}", json={"shares": 500})
    assert edited.status_code == 200, edited.text
    rows = await logged(db, edited)
    assert ops(rows) == [("update", "rsu_grants")]
    assert label_of(rows) == "Edited RSU grant 2025 focal"
    assert (rows[0].before["shares"], rows[0].after["shares"]) == (480, 500)

    deleted = await auth_client.delete(f"{GRANTS}/{grant_id}")
    assert deleted.status_code == 204
    rows = await logged(db, deleted)
    assert ops(rows) == [("delete", "rsu_grants")]
    assert label_of(rows) == "Deleted RSU grant 2025 focal"


async def test_undo_restores_a_deleted_rsu_grant_exactly(auth_client, db):
    grant_id = (await auth_client.post(GRANTS, json=GRANT)).json()["id"]
    before = await table_rows(db, RsuGrant)
    deleted = await auth_client.delete(f"{GRANTS}/{grant_id}")
    resp = await undo(auth_client, deleted)
    assert resp.status_code == 200, resp.text
    assert await table_rows(db, RsuGrant) == before


async def test_undoing_a_grant_delete_after_its_label_was_reused_refuses(auth_client, db):
    """Accepted (spec §6.1): the label is the grant's unique name, so the replayed row cannot
    sit beside the new grant that took it — the replay refusal, never a 500 and never an
    overwrite of the newer grant."""
    grant_id = (await auth_client.post(GRANTS, json=GRANT)).json()["id"]
    deleted = await auth_client.delete(f"{GRANTS}/{grant_id}")
    again = await auth_client.post(GRANTS, json=GRANT)
    assert again.status_code == 201, again.text
    again_id = again.json()["id"]
    refused = await undo(auth_client, deleted)
    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"] == REPLAY_REFUSAL
    assert [row["id"] for row in (await table_rows(db, RsuGrant))["rsu_grants"]] == [again_id]
```

- [ ] **Step 3: pin the module**

In `backend/tests/test_changelog_pin.py`, replace

```python
LOGGED: dict[str, set[str]] = {
    "net_worth.py": {
```

with

```python
LOGGED: dict[str, set[str]] = {
    # Exact undo everywhere (2026-09-25 polish spec §6.1, lane L3b): every user-intent write in
    # these routers records through its ChangeBatch and answers X-Change-Batch. The card
    # router's deletes image their dependents (pins, credits, cells, limit history) so the
    # Activity card's Undo restores them with their ids, and its two list reorders are logged
    # like the accounts' — unlogged, an older edit's Undo could silently move a row back.
    "comp.py": {
        "create_event",
        "update_event",
        "delete_event",
        "create_grant",
        "update_grant",
        "delete_grant",
    },
    "net_worth.py": {
```

- [ ] **Step 4: run them red**

Run: `FINANCE_TEST_DB=finance_test_l3b $PY -m pytest tests/test_changelog_comp.py tests/test_changelog_pin.py -q`
Expected: `6 failed, 2 passed` — five comp tests with `KeyError: 'x-change-batch'`, the pin test with
`comp.py:create_event must commit through its ChangeBatch, not db.commit()`; the no-op test and the exempt-reason test
pass.

- [ ] **Step 5: implement — `backend/app/api/comp.py`**

Imports: after `from app.services import clock, rsu_vesting` add
`from app.services.changelog import ChangeBatch, batch_header, change_batch, row_image`.

Module docstring: append this paragraph after the third one (the `/vesting-schedule` paragraph):

```
Every write is change-logged (2026-09-25 polish spec §6.1): one ChangeBatch per request, an
Activity label, and the X-Change-Batch header, so the Activity card — and the page's own
toast — can undo a create, an edit or a delete exactly, id included. Undoing a delete after a
new row took the same focal year or grant label refuses with the replay sentence: the unique
index is the conflict, and an undo never overwrites the newer row.
```

The six routes (validation bodies unchanged, shown whole):

```python
@router.post("/events", response_model=CompEventOut, status_code=201)
async def create_event(
    body: CompEventIn,
    response: Response,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> CompEventOut:
    fields = _validated_event(
        focal_year=body.focal_year,
        current_base=body.current_base,
        new_base=body.new_base,
        equity={name: getattr(body, name) for name in RSU_FIELDS + PRICE_FIELDS},
    )
    # focal_year is the natural key. Plain check-then-409: two concurrent creates of the
    # same year would race into an IntegrityError, an accepted house class for a
    # single-user app.
    await _require_free_focal_year(db, fields["focal_year"])
    event = CompEvent(notes=body.notes, **fields)
    db.add(event)
    await db.flush()
    batch.record_insert(event)
    batch.label = f"Added the {event.focal_year} comp event"
    response.headers.update(batch_header(await batch.commit()))
    return _event_out(event)


@router.patch("/events/{event_id}", response_model=CompEventOut)
async def update_event(
    event_id: IdPath,
    body: CompEventUpdate,
    response: Response,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> CompEventOut:
    event = await _get_event(db, event_id)
    provided = body.model_dump(exclude_unset=True)
    fields = _validated_event(
        focal_year=_merged(provided, "focal_year", event.focal_year),
        current_base=_merged(provided, "current_base", event.current_base),
        # NOT `_merged`: these columns ARE nullable, so an explicit null clears them.
        new_base=provided.get("new_base", event.new_base),
        equity={
            name: provided.get(name, getattr(event, name)) for name in RSU_FIELDS + PRICE_FIELDS
        },
    )
    if fields["focal_year"] != event.focal_year:
        await _require_free_focal_year(db, fields["focal_year"])
    # Every raise is behind us — mutate only now, or a 422 halfway through a multi-field
    # PATCH would leave part of the row dirty for the next autoflush.
    before = row_image(event)
    for name, value in fields.items():
        setattr(event, name, value)
    if "notes" in provided:
        event.notes = provided["notes"]
    batch.record_update(event, before)
    batch.label = f"Edited the {event.focal_year} comp event"
    response.headers.update(batch_header(await batch.commit()))
    return _event_out(event)


@router.delete("/events/{event_id}", status_code=204)
async def delete_event(
    event_id: IdPath,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> Response:
    event = await _get_event(db, event_id)
    batch.record_delete(event)
    batch.label = f"Deleted the {event.focal_year} comp event"
    await db.delete(event)
    return Response(status_code=204, headers=batch_header(await batch.commit()))
```

```python
@router.post("/rsu-grants", response_model=RsuGrantOut, status_code=201)
async def create_grant(
    body: RsuGrantIn,
    response: Response,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> RsuGrantOut:
    fields = _validated_grant(
        kind=body.kind,
        label=body.label,
        focal_year=body.focal_year,
        shares=body.shares,
        grant_price=body.grant_price,
        first_vest_date=body.first_vest_date,
        cliff_pct=body.cliff_pct,
        vest_quantum=body.vest_quantum,
    )
    # The TRIMMED label, i.e. the value that would be stored: checking the raw one would let a
    # padded duplicate past the pre-select and onto the unique index as a 500. Plain
    # check-then-409, `_require_free_focal_year`'s accepted race for a single-user app.
    await _require_free_label(db, fields["label"])
    grant = RsuGrant(notes=body.notes, **fields)
    db.add(grant)
    await db.flush()
    batch.record_insert(grant)
    batch.label = f"Added RSU grant {grant.label}"
    response.headers.update(batch_header(await batch.commit()))
    return _grant_out(grant, clock.product_today())


@router.patch("/rsu-grants/{grant_id}", response_model=RsuGrantOut)
async def update_grant(
    grant_id: IdPath,
    body: RsuGrantUpdate,
    response: Response,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> RsuGrantOut:
    grant = await _get_grant(db, grant_id)
    provided = body.model_dump(exclude_unset=True)
    fields = _validated_grant(
        kind=_merged(provided, "kind", grant.kind),
        label=_merged(provided, "label", grant.label),
        # NOT `_merged`: focal_year IS nullable, so an explicit null clears it.
        focal_year=provided.get("focal_year", grant.focal_year),
        shares=_merged(provided, "shares", grant.shares),
        grant_price=_merged(provided, "grant_price", grant.grant_price),
        first_vest_date=_merged(provided, "first_vest_date", grant.first_vest_date),
        cliff_pct=_merged(provided, "cliff_pct", grant.cliff_pct),
        vest_quantum=_merged(provided, "vest_quantum", grant.vest_quantum),
    )
    if fields["label"] != grant.label:
        await _require_free_label(db, fields["label"])
    # Every raise is behind us — mutate only now (see update_event).
    before = row_image(grant)
    for name, value in fields.items():
        setattr(grant, name, value)
    if "notes" in provided:
        grant.notes = provided["notes"]
    batch.record_update(grant, before)
    batch.label = f"Edited RSU grant {grant.label}"
    response.headers.update(batch_header(await batch.commit()))
    return _grant_out(grant, clock.product_today())


@router.delete("/rsu-grants/{grant_id}", status_code=204)
async def delete_grant(
    grant_id: IdPath,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> Response:
    grant = await _get_grant(db, grant_id)
    batch.record_delete(grant)
    batch.label = f"Deleted RSU grant {grant.label}"
    await db.delete(grant)
    return Response(status_code=204, headers=batch_header(await batch.commit()))
```

- [ ] **Step 6: run them green, plus the router's own suites**

Run: `FINANCE_TEST_DB=finance_test_l3b $PY -m pytest tests/test_changelog_comp.py tests/test_changelog_pin.py tests/test_paycheck_comp_api.py tests/test_rsu_api.py -q`
Expected: all passed, 0 failed.

- [ ] **Step 7: lint and commit**

Run: `$PY -m ruff check app tests && $PY -m ruff format --check app tests` — clean.

```bash
git add backend/tests/changelog_asserts.py backend/tests/test_changelog_comp.py backend/tests/test_changelog_pin.py backend/app/api/comp.py
git commit -m "feat(comp): focal events and RSU grants are change-logged, and a delete undoes exactly" \
  -m "Every comp write records through its ChangeBatch (polish spec §6.1, lane L3b): an Activity label (\"Added the 2025 comp event\", \"Deleted RSU grant 2025 focal\"), X-Change-Batch on the response, and a delete the Activity card undoes with the same id. comp.py joins the change-log pin; tests/changelog_asserts.py holds the lane's shared test helpers."
```

---

## Task 2 — `espp.py` logged (9 routes)

**Files:**
- Create: `backend/tests/test_changelog_espp.py`
- Modify: `backend/tests/test_changelog_pin.py` (add `espp.py` after `comp.py`)
- Modify: `backend/app/api/espp.py` (imports, module docstring, the nine write routes)

- [ ] **Step 1: write the failing tests**

`backend/tests/test_changelog_espp.py`:

```python
"""The ESPP router's writes are change-logged (2026-09-25 polish spec §6.1, lane L3b): lots,
purchase periods and offerings — every create, edit and delete one batch with an Activity
label and the X-Change-Batch header — and the Activity card undoes a delete exactly: a sold
lot comes back sold, a Reset period comes back stored, an offering comes back with its id."""

from app.models import EsppLot, EsppOffering, EsppPeriod
from app.services.changelog import REPLAY_REFUSAL
from tests.changelog_asserts import label_of, logged, ops, table_rows, undo

LOTS = "/api/v1/espp/lots"
PERIODS = "/api/v1/espp/periods"
OFFERINGS = "/api/v1/espp/offerings"

LOT = {
    "purchase_date": "2024-02-29",
    "qualifying_date": "2025-09-01",
    "shares": "260",
    "subscription_price": "48.509",
    "purchase_fmv": "79.112",
}
PERIOD = {
    "label": "Mar–Aug 2026",
    "period_start": "2026-03-01",
    "period_end": "2026-08-31",
    "semi_annual_base": "81000",
    "additional_payments": "0",
    "contribution_pct": "0.14",
}
OFFERING = {"offering_start": "2025-09-01", "subscription_price": "170.79", "notes": "reset"}


async def test_lot_create_edit_delete_each_log_one_labelled_batch(auth_client, db):
    created = await auth_client.post(LOTS, json=LOT)
    assert created.status_code == 201, created.text
    rows = await logged(db, created)
    assert ops(rows) == [("insert", "espp_lots")]
    assert label_of(rows) == "Added the lot purchased Feb 29, 2024"
    assert rows[0].after["purchase_price"] == "41.23265"  # 0.85 x 48.509, the lot family's 5 dp
    lot_id = created.json()["id"]

    edited = await auth_client.patch(f"{LOTS}/{lot_id}", json={"shares": "250"})
    assert edited.status_code == 200, edited.text
    rows = await logged(db, edited)
    assert ops(rows) == [("update", "espp_lots")]
    assert label_of(rows) == "Edited the lot purchased Feb 29, 2024"
    assert (rows[0].before["shares"], rows[0].after["shares"]) == ("260.0000", "250.0000")

    deleted = await auth_client.delete(f"{LOTS}/{lot_id}")
    assert deleted.status_code == 204
    rows = await logged(db, deleted)
    assert ops(rows) == [("delete", "espp_lots")]
    assert label_of(rows) == "Deleted the lot purchased Feb 29, 2024"


async def test_undo_restores_a_deleted_sold_lot_exactly(auth_client, db):
    sold = {**LOT, "sold_date": "2025-10-01", "sold_price": "180.5", "notes": "sold for the house"}
    lot_id = (await auth_client.post(LOTS, json=sold)).json()["id"]
    before = await table_rows(db, EsppLot)
    deleted = await auth_client.delete(f"{LOTS}/{lot_id}")
    assert await table_rows(db, EsppLot) == {"espp_lots": []}
    resp = await undo(auth_client, deleted)
    assert resp.status_code == 200, resp.text
    assert resp.json()["label"] == "Undid: Deleted the lot purchased Feb 29, 2024"
    after = await table_rows(db, EsppLot)
    assert after == before
    [row] = after["espp_lots"]
    assert (row["id"], row["sold_date"].isoformat(), str(row["sold_price"])) == (
        lot_id,
        "2025-10-01",
        "180.50000",
    )


async def test_undoing_a_lot_delete_after_its_date_was_reused_refuses(auth_client, db):
    """Accepted (spec §6.1): purchase_date is the lot's natural key, so the replayed row cannot
    sit beside a new lot entered for the same purchase — the replay refusal."""
    lot_id = (await auth_client.post(LOTS, json=LOT)).json()["id"]
    deleted = await auth_client.delete(f"{LOTS}/{lot_id}")
    again = await auth_client.post(LOTS, json=LOT)
    assert again.status_code == 201, again.text
    again_id = again.json()["id"]
    refused = await undo(auth_client, deleted)
    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"] == REPLAY_REFUSAL
    assert [row["id"] for row in (await table_rows(db, EsppLot))["espp_lots"]] == [again_id]


async def test_period_save_edit_reset_each_log_one_labelled_batch(auth_client, db):
    created = await auth_client.post(PERIODS, json=PERIOD)
    assert created.status_code == 201, created.text
    rows = await logged(db, created)
    assert ops(rows) == [("insert", "espp_periods")]
    # Saving a derived modeler row is what materializes it — hence "Saved", not "Added".
    assert label_of(rows) == "Saved the Mar–Aug 2026 purchase period"
    period_id = created.json()["id"]

    edited = await auth_client.patch(f"{PERIODS}/{period_id}", json={"contribution_pct": "0.15"})
    assert edited.status_code == 200, edited.text
    rows = await logged(db, edited)
    assert ops(rows) == [("update", "espp_periods")]
    assert label_of(rows) == "Edited the Mar–Aug 2026 purchase period"
    assert (rows[0].before["contribution_pct"], rows[0].after["contribution_pct"]) == (
        "0.140000000",
        "0.150000000",
    )

    deleted = await auth_client.delete(f"{PERIODS}/{period_id}")
    assert deleted.status_code == 204
    rows = await logged(db, deleted)
    assert ops(rows) == [("delete", "espp_periods")]
    # The modeler's only door to this DELETE is "Reset … to its derived values".
    assert label_of(rows) == "Reset the Mar–Aug 2026 purchase period"


async def test_undo_restores_a_reset_period_exactly(auth_client, db):
    period_id = (await auth_client.post(PERIODS, json=PERIOD)).json()["id"]
    before = await table_rows(db, EsppPeriod)
    deleted = await auth_client.delete(f"{PERIODS}/{period_id}")
    resp = await undo(auth_client, deleted)
    assert resp.status_code == 200, resp.text
    assert await table_rows(db, EsppPeriod) == before


async def test_offering_create_edit_delete_each_log_one_labelled_batch(auth_client, db):
    created = await auth_client.post(OFFERINGS, json=OFFERING)
    assert created.status_code == 201, created.text
    rows = await logged(db, created)
    assert ops(rows) == [("insert", "espp_offerings")]
    assert label_of(rows) == "Added the offering starting Sep 1, 2025"
    offering_id = created.json()["id"]

    edited = await auth_client.patch(
        f"{OFFERINGS}/{offering_id}", json={"subscription_price": "171.5"}
    )
    assert edited.status_code == 200, edited.text
    rows = await logged(db, edited)
    assert ops(rows) == [("update", "espp_offerings")]
    assert label_of(rows) == "Edited the offering starting Sep 1, 2025"
    assert (rows[0].before["subscription_price"], rows[0].after["subscription_price"]) == (
        "170.79000",
        "171.50000",
    )

    deleted = await auth_client.delete(f"{OFFERINGS}/{offering_id}")
    assert deleted.status_code == 204
    rows = await logged(db, deleted)
    assert ops(rows) == [("delete", "espp_offerings")]
    assert label_of(rows) == "Deleted the offering starting Sep 1, 2025"


async def test_undo_restores_a_deleted_offering_exactly(auth_client, db):
    offering_id = (await auth_client.post(OFFERINGS, json=OFFERING)).json()["id"]
    before = await table_rows(db, EsppOffering)
    deleted = await auth_client.delete(f"{OFFERINGS}/{offering_id}")
    resp = await undo(auth_client, deleted)
    assert resp.status_code == 200, resp.text
    assert await table_rows(db, EsppOffering) == before
```

- [ ] **Step 2: pin the module** — in `backend/tests/test_changelog_pin.py`, after the `"comp.py": {…},` entry insert:

```python
    "espp.py": {
        "create_lot",
        "update_lot",
        "delete_lot",
        "create_period",
        "update_period",
        "delete_period",
        "create_offering",
        "update_offering",
        "delete_offering",
    },
```

- [ ] **Step 3: run them red**

Run: `FINANCE_TEST_DB=finance_test_l3b $PY -m pytest tests/test_changelog_espp.py tests/test_changelog_pin.py -q`
Expected: `8 failed, 1 passed` — the seven ESPP tests with `KeyError: 'x-change-batch'`, the pin test with
`espp.py:create_lot must commit through its ChangeBatch, not db.commit()`.

- [ ] **Step 4: implement — `backend/app/api/espp.py`**

Imports: after `from app.services import clock` add

```python
from app.services.changelog import ChangeBatch, batch_header, change_batch, row_image
from app.services.day_labels import long_day
```

Module docstring: append

```
Every write is change-logged (2026-09-25 polish spec §6.1): one ChangeBatch per request, an
Activity label, and the X-Change-Batch header, so the Activity card — and the page's own
toast — can undo it exactly, id included. Undoing a delete after a new row took the same
purchase date, period label or offering start refuses with the replay sentence: the unique
index is the conflict, and an undo never overwrites the newer row.
```

The nine routes:

```python
@router.post("/lots", response_model=LotOut, status_code=201)
async def create_lot(
    body: LotIn,
    response: Response,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> LotOut:
    fields = _validated_lot(
        purchase_date=body.purchase_date,
        qualifying_date=body.qualifying_date,
        shares=body.shares,
        subscription_price=body.subscription_price,
        purchase_fmv=body.purchase_fmv,
        purchase_price=body.purchase_price,
        sold_date=body.sold_date,
        sold_price=body.sold_price,
        discount=await read_espp_discount(db),
    )
    # purchase_date is the natural key. Plain check-then-409: two concurrent creates of
    # the same date would race into an IntegrityError, an accepted house class for a
    # single-user app.
    await _require_free_purchase_date(db, fields["purchase_date"])
    lot = EsppLot(notes=body.notes, **fields)
    db.add(lot)
    await db.flush()
    batch.record_insert(lot)
    batch.label = f"Added the lot purchased {long_day(lot.purchase_date)}"
    response.headers.update(batch_header(await batch.commit()))
    _ticker, current_price, _quoted_at = await _espp_quote(db)
    return _lot_out(
        lot,
        lot_metrics(lot, current_price, clock.product_today()),
        await _running_average_for(db, lot.id),
    )
```

```python
@router.patch("/lots/{lot_id}", response_model=LotOut)
async def update_lot(
    lot_id: IdPath,
    body: LotUpdate,
    response: Response,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> LotOut:
    lot = await _get_lot(db, lot_id)
    provided = body.model_dump(exclude_unset=True)
    fields = _validated_lot(
        purchase_date=_merged(provided, "purchase_date", lot.purchase_date),
        qualifying_date=_merged(provided, "qualifying_date", lot.qualifying_date),
        shares=_merged(provided, "shares", lot.shares),
        subscription_price=_merged(provided, "subscription_price", lot.subscription_price),
        purchase_fmv=_merged(provided, "purchase_fmv", lot.purchase_fmv),
        # NOT `_merged`: an explicit null here means "re-derive the 85% default from the
        # merged subscription/fmv pair", which is the only useful reading for a column
        # that cannot store a null.
        purchase_price=provided.get("purchase_price", lot.purchase_price),
        # The sold pair IS nullable, so an explicit null clears it — but only when both
        # halves are cleared together (_validated_lot rejects the half-filled row).
        sold_date=provided.get("sold_date", lot.sold_date),
        sold_price=provided.get("sold_price", lot.sold_price),
        discount=await read_espp_discount(db),
    )
    if fields["purchase_date"] != lot.purchase_date:
        await _require_free_purchase_date(db, fields["purchase_date"])
    # Every raise is behind us — mutate only now, or a 422 halfway through a multi-field
    # PATCH would leave part of the row dirty for the next autoflush.
    before = row_image(lot)
    for name, value in fields.items():
        setattr(lot, name, value)
    if "notes" in provided:
        lot.notes = provided["notes"]
    batch.record_update(lot, before)
    batch.label = f"Edited the lot purchased {long_day(lot.purchase_date)}"
    response.headers.update(batch_header(await batch.commit()))
    _ticker, current_price, _quoted_at = await _espp_quote(db)
    return _lot_out(
        lot,
        lot_metrics(lot, current_price, clock.product_today()),
        await _running_average_for(db, lot.id),
    )


@router.delete("/lots/{lot_id}", status_code=204)
async def delete_lot(
    lot_id: IdPath,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> Response:
    lot = await _get_lot(db, lot_id)
    batch.record_delete(lot)
    batch.label = f"Deleted the lot purchased {long_day(lot.purchase_date)}"
    await db.delete(lot)
    return Response(status_code=204, headers=batch_header(await batch.commit()))
```

```python
@router.post("/periods", response_model=PeriodOut, status_code=201)
async def create_period(
    body: PeriodIn,
    response: Response,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> EsppPeriod:
    """The modeler's Save on a derived row is what lands here — the row materializes — so the
    Activity label says "Saved", not "Added"."""
    fields = _validated_period(
        label=body.label,
        period_start=body.period_start,
        period_end=body.period_end,
        semi_annual_base=body.semi_annual_base,
        additional_payments=body.additional_payments,
        contribution_pct=body.contribution_pct,
    )
    await _require_free_label(db, fields["label"])
    period = EsppPeriod(**fields)
    db.add(period)
    await db.flush()
    batch.record_insert(period)
    batch.label = f"Saved the {period.label} purchase period"
    response.headers.update(batch_header(await batch.commit()))
    return period


@router.patch("/periods/{period_id}", response_model=PeriodOut)
async def update_period(
    period_id: IdPath,
    body: PeriodUpdate,
    response: Response,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> EsppPeriod:
    period = await _get_period(db, period_id)
    provided = body.model_dump(exclude_unset=True)
    fields = _validated_period(
        label=_merged(provided, "label", period.label),
        period_start=_merged(provided, "period_start", period.period_start),
        period_end=_merged(provided, "period_end", period.period_end),
        semi_annual_base=_merged(provided, "semi_annual_base", period.semi_annual_base),
        additional_payments=_merged(provided, "additional_payments", period.additional_payments),
        contribution_pct=_merged(provided, "contribution_pct", period.contribution_pct),
    )
    if fields["label"] != period.label:
        await _require_free_label(db, fields["label"])
    before = row_image(period)
    for name, value in fields.items():
        setattr(period, name, value)
    batch.record_update(period, before)
    batch.label = f"Edited the {period.label} purchase period"
    response.headers.update(batch_header(await batch.commit()))
    return period


@router.delete("/periods/{period_id}", status_code=204)
async def delete_period(
    period_id: IdPath,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> Response:
    """The modeler's "Reset … to its derived values": without its stored row the period is
    planned from the chain again, so the Activity label says Reset."""
    period = await _get_period(db, period_id)
    batch.record_delete(period)
    batch.label = f"Reset the {period.label} purchase period"
    await db.delete(period)
    return Response(status_code=204, headers=batch_header(await batch.commit()))
```

```python
@router.post("/offerings", response_model=OfferingOut, status_code=201)
async def create_offering(
    body: OfferingIn,
    response: Response,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> EsppOffering:
    require_reasonable_date(body.offering_start, "offering_start")
    price = _positive_price(body.subscription_price, "subscription_price")
    await _require_free_offering_start(db, body.offering_start)
    offering = EsppOffering(
        offering_start=body.offering_start, subscription_price=price, notes=body.notes
    )
    db.add(offering)
    await db.flush()
    batch.record_insert(offering)
    batch.label = f"Added the offering starting {long_day(offering.offering_start)}"
    response.headers.update(batch_header(await batch.commit()))
    return offering


@router.patch("/offerings/{offering_id}", response_model=OfferingOut)
async def update_offering(
    offering_id: IdPath,
    body: OfferingUpdate,
    response: Response,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> EsppOffering:
    offering = await _get_offering(db, offering_id)
    provided = body.model_dump(exclude_unset=True)
    start = _merged(provided, "offering_start", offering.offering_start)
    require_reasonable_date(start, "offering_start")
    raw_price = _merged(provided, "subscription_price", offering.subscription_price)
    price = _positive_price(raw_price, "subscription_price")
    if start != offering.offering_start:
        await _require_free_offering_start(db, start)
    # Every raise is behind us — mutate only now (update_lot's posture).
    before = row_image(offering)
    offering.offering_start = start
    offering.subscription_price = price
    if "notes" in provided:
        offering.notes = provided["notes"]  # explicit null clears (nullable column)
    batch.record_update(offering, before)
    batch.label = f"Edited the offering starting {long_day(offering.offering_start)}"
    response.headers.update(batch_header(await batch.commit()))
    return offering


@router.delete("/offerings/{offering_id}", status_code=204)
async def delete_offering(
    offering_id: IdPath,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> Response:
    offering = await _get_offering(db, offering_id)
    batch.record_delete(offering)
    batch.label = f"Deleted the offering starting {long_day(offering.offering_start)}"
    await db.delete(offering)
    return Response(status_code=204, headers=batch_header(await batch.commit()))
```

- [ ] **Step 5: run them green, plus the router's own suites**

Run: `FINANCE_TEST_DB=finance_test_l3b $PY -m pytest tests/test_changelog_espp.py tests/test_changelog_pin.py tests/test_espp_api.py tests/test_espp_pace.py tests/test_employer_ticker.py -q`
Expected: all passed.

- [ ] **Step 6: lint and commit**

Run: `$PY -m ruff check app tests && $PY -m ruff format --check app tests` — clean.

```bash
git add backend/tests/test_changelog_espp.py backend/tests/test_changelog_pin.py backend/app/api/espp.py
git commit -m "feat(espp): lots, purchase periods and offerings are change-logged, and a delete undoes exactly" \
  -m "Every ESPP write records through its ChangeBatch (polish spec §6.1, lane L3b) with an Activity label and X-Change-Batch. A period create is \"Saved\" (the modeler materializes a derived row) and its delete is \"Reset\" (the modeler's only door to it); a sold lot's Undo brings it back sold. espp.py joins the change-log pin."
```

---

## Task 3 — `paycheck.py` logged (3 routes)

**Files:**
- Create: `backend/tests/test_changelog_paycheck.py`
- Modify: `backend/tests/test_changelog_pin.py` (add `paycheck.py` after `espp.py`)
- Modify: `backend/app/api/paycheck.py` (imports, module docstring, `_profile_label`, the three write routes)

- [ ] **Step 1: write the failing tests**

`backend/tests/test_changelog_paycheck.py`:

```python
"""The paycheck router's profile writes are change-logged (2026-09-25 polish spec §6.1, lane
L3b): each create, edit and delete is one batch with an Activity label naming whose profile it
is and the X-Change-Batch header, and the Activity card undoes a delete exactly. The transient
`in_force` flag the responses carry is unmapped, so no image ever holds it."""

import pytest

from app.models import PaycheckProfile, Person
from tests.changelog_asserts import label_of, logged, ops, table_rows, undo

PROFILES = "/api/v1/paycheck/profiles"

PROFILE = {
    "effective_date": "2026-08-17",
    "annual_salary": "188930",
    "trad_401k_pct": "0.13",
    "after_tax_401k_pct": "0.03",
    "espp_pct": "0.11",
    "withholding_pct": "0.334009167",
    "dental_vision_per_check": "12.50",
    "hsa_per_check": "100",
    "fed_withholding_pct": "0.22",
    "state_withholding_pct": "0.08",
    "notes": "Aug raise",
}


@pytest.fixture
async def me(db) -> Person:
    """The primary person: `create_all` seeds no roster, and a profile must have an owner."""
    person = Person(name="Edward", is_primary=True)
    db.add(person)
    await db.commit()
    return person


async def test_profile_create_edit_delete_each_log_one_labelled_batch(auth_client, db, me):
    created = await auth_client.post(PROFILES, json=PROFILE)
    assert created.status_code == 201, created.text
    assert created.json()["in_force"] is True  # the transient flag still answers
    rows = await logged(db, created)
    assert ops(rows) == [("insert", "paycheck_profiles")]
    assert label_of(rows) == "Added Edward's paycheck profile effective Aug 17, 2026"
    assert rows[0].after["withholding_pct"] == "0.334009167"
    assert "in_force" not in rows[0].after  # unmapped: never imaged
    profile_id = created.json()["id"]

    edited = await auth_client.patch(f"{PROFILES}/{profile_id}", json={"annual_salary": "195000"})
    assert edited.status_code == 200, edited.text
    rows = await logged(db, edited)
    assert ops(rows) == [("update", "paycheck_profiles")]
    assert label_of(rows) == "Edited Edward's paycheck profile effective Aug 17, 2026"
    assert (rows[0].before["annual_salary"], rows[0].after["annual_salary"]) == (
        "188930.00",
        "195000.00",
    )
    assert "in_force" not in rows[0].before and "in_force" not in rows[0].after

    deleted = await auth_client.delete(f"{PROFILES}/{profile_id}")
    assert deleted.status_code == 204
    rows = await logged(db, deleted)
    assert ops(rows) == [("delete", "paycheck_profiles")]
    assert label_of(rows) == "Deleted Edward's paycheck profile effective Aug 17, 2026"


async def test_the_label_names_whose_profile_when_two_share_a_date(auth_client, db, me):
    """The effective date is unique per PERSON, so a label without the owner could name two
    rows at once."""
    partner = Person(name="Grace")
    db.add(partner)
    await db.commit()
    partner_id = partner.id
    mine = await auth_client.post(PROFILES, json=PROFILE)
    theirs = await auth_client.post(PROFILES, json={**PROFILE, "person_id": partner_id})
    assert theirs.status_code == 201, theirs.text
    assert (
        label_of(await logged(db, mine)) == "Added Edward's paycheck profile effective Aug 17, 2026"
    )
    assert (
        label_of(await logged(db, theirs)) == "Added Grace's paycheck profile effective Aug 17, 2026"
    )


async def test_undo_restores_a_deleted_profile_exactly(auth_client, db, me):
    profile_id = (await auth_client.post(PROFILES, json=PROFILE)).json()["id"]
    before = await table_rows(db, PaycheckProfile)
    deleted = await auth_client.delete(f"{PROFILES}/{profile_id}")
    assert await table_rows(db, PaycheckProfile) == {"paycheck_profiles": []}
    resp = await undo(auth_client, deleted)
    assert resp.status_code == 200, resp.text
    assert resp.json()["label"] == (
        "Undid: Deleted Edward's paycheck profile effective Aug 17, 2026"
    )
    assert await table_rows(db, PaycheckProfile) == before
    listed = (await auth_client.get(PROFILES)).json()
    assert [(profile["id"], profile["in_force"]) for profile in listed] == [(profile_id, True)]
```

- [ ] **Step 2: pin the module** — after the `"espp.py": {…},` entry insert
`"paycheck.py": {"create_profile", "update_profile", "delete_profile"},`.

- [ ] **Step 3: run them red**

Run: `FINANCE_TEST_DB=finance_test_l3b $PY -m pytest tests/test_changelog_paycheck.py tests/test_changelog_pin.py -q`
Expected: `4 failed, 1 passed` — `KeyError: 'x-change-batch'` ×3; `paycheck.py:create_profile must commit through its
ChangeBatch, not db.commit()`.

- [ ] **Step 4: implement — `backend/app/api/paycheck.py`**

Imports: after `from app.services import clock` add

```python
from app.services.changelog import ChangeBatch, batch_header, change_batch, row_image
from app.services.day_labels import long_day
```

Module docstring: append

```
The three profile writes are change-logged (2026-09-25 polish spec §6.1): one ChangeBatch per
request, an Activity label naming WHOSE profile it is, and the X-Change-Batch header.
`paycheck_profiles` is a month-review input, so the Activity card's Undo of one takes the
review-input locks like any other (services.changelog.undo_batch). The transient `in_force`
flag is unmapped, so no change-log image ever carries it.
```

Helper, right after `_merged`:

```python
async def _profile_label(db: AsyncSession, verb: str, profile: PaycheckProfile) -> str:
    """The Activity label names WHOSE profile it is: the effective date is unique per person,
    so two earners can each have one effective the same day."""
    person = await db.get(Person, profile.person_id)
    owner = "the" if person is None else f"{person.name}'s"
    return f"{verb} {owner} paycheck profile effective {long_day(profile.effective_date)}"
```

The three routes:

```python
@router.post("/profiles", response_model=ProfileOut, status_code=201)
async def create_profile(
    body: ProfileIn,
    response: Response,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> PaycheckProfile:
    person_id = await _require_person(db, body.person_id)
    fields = _validated_profile(
        effective_date=body.effective_date,
        annual_salary=body.annual_salary,
        pay_periods_per_year=body.pay_periods_per_year,
        dental_vision_per_check=body.dental_vision_per_check,
        hsa_per_check=body.hsa_per_check,
        hsa_coverage=body.hsa_coverage,
        hsa_employer_annual=body.hsa_employer_annual,
        hsa_employer_per_dependent=body.hsa_employer_per_dependent,
        hsa_dependents=body.hsa_dependents,
        pcts={name: getattr(body, name) for name in PCT_FIELDS},
        optional_pcts={name: getattr(body, name) for name in OPTIONAL_PCT_FIELDS},
        match={name: getattr(body, name) for name in MATCH_FIELDS},
    )
    # (person_id, effective_date) is the natural key. Plain check-then-409: two concurrent
    # creates of the same pair would race into an IntegrityError, an accepted house class
    # for a single-user app.
    await _require_free_effective_date(db, person_id, fields["effective_date"])
    profile = PaycheckProfile(person_id=person_id, notes=body.notes, **fields)
    db.add(profile)
    await db.flush()
    batch.record_insert(profile)
    batch.label = await _profile_label(db, "Added", profile)
    response.headers.update(batch_header(await batch.commit()))
    await _mark_in_force(db, [profile], clock.product_today())
    return profile


@router.patch("/profiles/{profile_id}", response_model=ProfileOut)
async def update_profile(
    profile_id: IdPath,
    body: ProfileUpdate,
    response: Response,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> PaycheckProfile:
    profile = await _get_profile(db, profile_id)
    provided = body.model_dump(exclude_unset=True)
    fields = _validated_profile(
        effective_date=_merged(provided, "effective_date", profile.effective_date),
        annual_salary=_merged(provided, "annual_salary", profile.annual_salary),
        pay_periods_per_year=_merged(
            provided, "pay_periods_per_year", profile.pay_periods_per_year
        ),
        dental_vision_per_check=_merged(
            provided, "dental_vision_per_check", profile.dental_vision_per_check
        ),
        hsa_per_check=_merged(provided, "hsa_per_check", profile.hsa_per_check),
        hsa_coverage=_merged(provided, "hsa_coverage", profile.hsa_coverage),
        hsa_employer_annual=_merged(provided, "hsa_employer_annual", profile.hsa_employer_annual),
        hsa_employer_per_dependent=_merged(
            provided, "hsa_employer_per_dependent", profile.hsa_employer_per_dependent
        ),
        hsa_dependents=_merged(provided, "hsa_dependents", profile.hsa_dependents),
        pcts={name: _merged(provided, name, getattr(profile, name)) for name in PCT_FIELDS},
        # NOT `_merged`: these two are nullable, so an explicit null CLEARS them (`notes`'
        # rule) instead of meaning "leave it alone". Presence in the dump is the whole
        # test — `exclude_unset` is what tells a sent null from an omitted field.
        optional_pcts={
            name: (provided[name] if name in provided else getattr(profile, name))
            for name in OPTIONAL_PCT_FIELDS
        },
        match={name: _merged(provided, name, getattr(profile, name)) for name in MATCH_FIELDS},
    )
    if fields["effective_date"] != profile.effective_date:
        # The row's OWN owner: a PATCH never moves a profile between people.
        await _require_free_effective_date(db, profile.person_id, fields["effective_date"])
    # Every raise is behind us — mutate only now, or a 422 halfway through a multi-field
    # PATCH would leave part of the row dirty for the next autoflush.
    before = row_image(profile)
    for name, value in fields.items():
        setattr(profile, name, value)
    if "notes" in provided:
        profile.notes = provided["notes"]  # nullable: an explicit null really clears it
    batch.record_update(profile, before)
    batch.label = await _profile_label(db, "Edited", profile)
    response.headers.update(batch_header(await batch.commit()))
    await _mark_in_force(db, [profile], clock.product_today())
    return profile


@router.delete("/profiles/{profile_id}", status_code=204)
async def delete_profile(
    profile_id: IdPath,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> Response:
    profile = await _get_profile(db, profile_id)
    batch.record_delete(profile)
    batch.label = await _profile_label(db, "Deleted", profile)
    await db.delete(profile)
    return Response(status_code=204, headers=batch_header(await batch.commit()))
```

- [ ] **Step 5: run them green, plus the router's own suites**

Run: `FINANCE_TEST_DB=finance_test_l3b $PY -m pytest tests/test_changelog_paycheck.py tests/test_changelog_pin.py tests/test_paycheck_comp_api.py tests/test_paycheck_preview_api.py tests/test_paycheck_espp_participant.py tests/test_sandbox_purity.py -q`
Expected: all passed.

- [ ] **Step 6: lint and commit**

Run: `$PY -m ruff check app tests && $PY -m ruff format --check app tests` — clean.

```bash
git add backend/tests/test_changelog_paycheck.py backend/tests/test_changelog_pin.py backend/app/api/paycheck.py
git commit -m "feat(paycheck): profile writes are change-logged, and a delete undoes exactly" \
  -m "create/update/delete_profile record through their ChangeBatch (polish spec §6.1, lane L3b) with X-Change-Batch. The label names whose profile it is (\"Deleted Edward's paycheck profile effective Aug 17, 2026\"): the effective date is unique per person, so two earners can share one. The Undo takes the review-input locks through the existing machinery; the transient in_force flag is unmapped and never imaged. paycheck.py joins the change-log pin."
```

---

## Task 4 — `credit_cards.py`: reward categories and the matrix save (4 routes)

**Files:**
- Create: `backend/tests/test_changelog_credit_cards.py`
- Modify: `backend/app/api/credit_cards.py` (imports, `_edit_label`, `create_reward_category`,
  `update_reward_category`, `delete_reward_category`, `put_reward_rates`)

- [ ] **Step 1: write the failing tests**

`backend/tests/test_changelog_credit_cards.py` (Tasks 5 and 6 append to it):

```python
"""The credit-card router's writes are change-logged (2026-09-25 polish spec §6.1, lane L3b).

Every create, edit and delete — each list reorder and each bulk matrix save too — is ONE batch
with an Activity label and the X-Change-Batch header. The two deletes with dependents image
them through the ORM, children first and the row LAST, so the Activity card's Undo brings
back exactly what went: a card with its credits, cells, limit history AND the categories
pinned to it; a reward category with its cells — every id the same."""

from decimal import Decimal

from app.models import CreditCard, RewardCategory, RewardRate
from tests.changelog_asserts import label_of, logged, ops, table_rows, undo
from tests.ordering_helpers import first_position, recorded_sql

CARDS = "/api/v1/credit-cards"
CATEGORIES = f"{CARDS}/categories"
RATES = f"{CARDS}/rates"


def card(name: str, sort_order: int = 0, **over) -> CreditCard:
    fields = {
        "name": name,
        "slug": name.lower().replace(" ", "-"),
        "annual_fee": Decimal("0.00"),
        "rewards_currency": "cash",
        "point_value_cents": Decimal("1.0000"),
        "sort_order": sort_order,
    }
    fields.update(over)
    return CreditCard(**fields)


def category(name: str, sort_order: int = 0, **over) -> RewardCategory:
    return RewardCategory(name=name, slug=name.lower(), sort_order=sort_order, **over)


def cell(card_id: int, category_id: int, multiplier: str | None, cap: str | None = None) -> dict:
    return {
        "card_id": card_id,
        "category_id": category_id,
        "multiplier": multiplier,
        "note": None,
        "monthly_cap": cap,
    }


# ── reward categories and the matrix ─────────────────────────────────────────────────


async def test_reward_category_create_edit_hide_show_delete_each_log_one_batch(auth_client, db):
    created = await auth_client.post(CATEGORIES, json={"name": "Groceries"})
    assert created.status_code == 201, created.text
    rows = await logged(db, created)
    assert ops(rows) == [("insert", "reward_categories")]
    assert label_of(rows) == "Added reward category Groceries"
    assert rows[0].after["is_active"] is True  # the column default, imaged after the flush
    url = f"{CATEGORIES}/{created.json()['id']}"

    edited = await auth_client.patch(url, json={"annual_spend": "6000"})
    assert edited.status_code == 200, edited.text
    rows = await logged(db, edited)
    assert ops(rows) == [("update", "reward_categories")]
    assert label_of(rows) == "Edited reward category Groceries"
    # The one-click toggle is named with its button's own verb (the Hide / Show column).
    hidden = await auth_client.patch(url, json={"is_active": False})
    assert label_of(await logged(db, hidden)) == "Hid reward category Groceries"
    shown = await auth_client.patch(url, json={"is_active": True})
    assert label_of(await logged(db, shown)) == "Showed reward category Groceries"
    unchanged = await auth_client.patch(url, json={"annual_spend": "6000.00"})
    assert unchanged.status_code == 200 and "x-change-batch" not in unchanged.headers

    deleted = await auth_client.delete(url)
    assert deleted.status_code == 204
    rows = await logged(db, deleted)
    assert ops(rows) == [("delete", "reward_categories")]  # no cells: nothing else to image
    assert label_of(rows) == "Deleted reward category Groceries"


async def test_undo_restores_a_deleted_reward_category_with_its_cells(auth_client, db):
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
    venture_id, groceries_id, dining_id = venture.id, groceries.id, dining.id
    before = await table_rows(db, RewardCategory, RewardRate)
    with recorded_sql(db) as statements:
        deleted = await auth_client.delete(f"{CATEGORIES}/{groceries_id}")
    assert deleted.status_code == 204
    rows = await logged(db, deleted)
    # Its two cells, then the row LAST: the undo replays in reverse, so the row comes back
    # before the cells that point at it.
    assert ops(rows) == [
        ("delete", "reward_rates"),
        ("delete", "reward_rates"),
        ("delete", "reward_categories"),
    ]
    assert label_of(rows) == "Deleted reward category Groceries"
    # The cells go by their own DELETE, before the row's — never under the FK's cascade.
    assert first_position(statements, "DELETE FROM reward_rates") < first_position(
        statements, "DELETE FROM reward_categories"
    )
    left = (await table_rows(db, RewardRate))["reward_rates"]
    assert [(row["card_id"], row["category_id"]) for row in left] == [(venture_id, dining_id)]
    resp = await undo(auth_client, deleted)
    assert resp.status_code == 200, resp.text
    assert resp.json()["rows"] == 3
    assert await table_rows(db, RewardCategory, RewardRate) == before


async def test_a_matrix_save_that_adds_changes_and_clears_is_one_batch_undone_whole(
    auth_client, db
):
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
    before = await table_rows(db, RewardRate)
    saved = await auth_client.put(
        RATES, json=[cell(v, t, "5"), cell(v, d, None), cell(v, g, "4", cap="500")]
    )
    assert saved.status_code == 200, saved.text
    rows = await logged(db, saved)
    # Every cell that changed is a row of ONE batch: the edit and the clear in the order sent,
    # the new cell once the flush has given it an id.
    assert ops(rows) == [
        ("update", "reward_rates"),
        ("delete", "reward_rates"),
        ("insert", "reward_rates"),
    ]
    assert label_of(rows) == "Edited 3 reward multipliers"
    assert (rows[0].before["multiplier"], rows[0].after["multiplier"]) == ("2.00", "5.00")
    assert rows[2].after["monthly_cap"] == "500.00"
    resp = await undo(auth_client, saved)
    assert resp.status_code == 200, resp.text
    assert await table_rows(db, RewardRate) == before


async def test_a_one_cell_save_is_singular_and_an_unchanged_save_names_no_batch(auth_client, db):
    venture, travel = card("Venture X"), category("Travel")
    db.add_all([venture, travel])
    await db.commit()
    v, t = venture.id, travel.id
    first = await auth_client.put(RATES, json=[cell(v, t, "2")])
    assert first.status_code == 200, first.text
    assert label_of(await logged(db, first)) == "Edited 1 reward multiplier"
    again = await auth_client.put(RATES, json=[cell(v, t, "2.00")])
    assert again.status_code == 200, again.text
    assert "x-change-batch" not in again.headers
```

- [ ] **Step 2: run them red**

Run: `FINANCE_TEST_DB=finance_test_l3b $PY -m pytest tests/test_changelog_credit_cards.py -q`
Expected: `4 failed` — each with `KeyError: 'x-change-batch'`.

- [ ] **Step 3: implement — `backend/app/api/credit_cards.py`**

Imports: after `from app.schemas.ordering import OrderIn` add
`from app.services.changelog import ChangeBatch, batch_header, change_batch, row_image`.

After the `ROUTE ORDER IS LOAD-BEARING` comment block, add the labels section:

```python
# --- Activity labels (2026-09-25 polish spec §6.1) ----------------------------------------


def _edit_label(noun: str, name: str, before: dict, after: dict, *, off: str, on: str) -> str:
    """A PATCH's label. When `is_active` is the only column that moved, the edit was the
    row's one-click toggle, and the label says so in the button's own verb — the roster's
    Archive / Unarchive, the categories' Hide / Show."""
    moved = {key for key, value in after.items() if before.get(key) != value}
    if moved == {"is_active"}:
        return f"{on if after['is_active'] else off} {noun} {name}"
    return f"Edited {noun} {name}"
```

`create_reward_category` and `update_reward_category`, whole:

```python
@router.post("/categories", response_model=RewardCategoryOut, status_code=201)
async def create_reward_category(
    body: RewardCategoryCreate,
    response: Response,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> RewardCategory:
    slug = slugify(body.name)
    if not slug or len(slug) > 80:
        raise HTTPException(
            status_code=422,
            detail="name must contain an ASCII letter or digit and slugify to "
            "at most 80 characters",
        )
    existing = (
        (
            await db.execute(
                select(RewardCategory).where(
                    (RewardCategory.slug == slug) | (RewardCategory.name == body.name)
                )
            )
        )
        .scalars()
        .first()
    )
    if existing is not None:
        raise HTTPException(status_code=409, detail=f"reward category {slug!r} already exists")
    await _validated_category_refs(db, body.spending_category_id, body.pinned_card_id)
    sort_order = body.sort_order
    if sort_order is None:
        # No position given: append after the last row (2026-09-23 reorder spec §3.3), under
        # the list's lock (decision 16).
        await db.execute(order_lock(RewardCategory))
        sort_order = (await db.execute(next_sort_order(RewardCategory.sort_order))).scalar_one()
    category = RewardCategory(
        name=body.name,
        slug=slug,
        sort_order=sort_order,
        annual_spend=_validated_annual_spend(body.annual_spend),
        spending_category_id=body.spending_category_id,
        pinned_card_id=body.pinned_card_id,
    )
    db.add(category)
    await db.flush()
    batch.record_insert(category)
    batch.label = f"Added reward category {category.name}"
    response.headers.update(batch_header(await batch.commit()))
    return category
```

```python
@router.patch("/categories/{category_id}", response_model=RewardCategoryOut)
async def update_reward_category(
    category_id: int,
    body: RewardCategoryUpdate,
    response: Response,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> RewardCategory:
    category = await _get_reward_category(db, category_id)
    updates = body.model_dump(exclude_unset=True)
    # NOT NULL columns ignore explicit nulls (spending-categories precedent); the three
    # nullable columns take null as CLEAR (schema docstring).
    for field in ("name", "sort_order", "is_active"):
        if field in updates and updates[field] is None:
            del updates[field]
    new_name = updates.get("name")
    if new_name is not None:
        new_slug = slugify(new_name)
        if not new_slug or len(new_slug) > 80:
            raise HTTPException(
                status_code=422,
                detail="name must contain at least one ASCII letter or digit",
            )
        if new_name != category.name:
            clash = (
                (
                    await db.execute(
                        select(RewardCategory).where(
                            (RewardCategory.name == new_name) | (RewardCategory.slug == new_slug),
                            RewardCategory.id != category_id,
                        )
                    )
                )
                .scalars()
                .first()
            )
            if clash is not None:
                raise HTTPException(status_code=409, detail="reward category name already in use")
            updates["slug"] = new_slug
    if "annual_spend" in updates:
        updates["annual_spend"] = _validated_annual_spend(updates["annual_spend"])
    await _validated_category_refs(
        db, updates.get("spending_category_id"), updates.get("pinned_card_id")
    )
    before = row_image(category)
    for field, value in updates.items():
        setattr(category, field, value)
    batch.record_update(category, before)
    batch.label = _edit_label(
        "reward category", category.name, before, row_image(category), off="Hid", on="Showed"
    )
    response.headers.update(batch_header(await batch.commit()))
    return category
```

`delete_reward_category`, whole:

```python
@router.delete("/categories/{category_id}", status_code=204)
async def delete_reward_category(
    category_id: int,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> Response:
    """Deletes the row AND its matrix cells — the cells by their own explicit DELETEs, each
    imaged, so the Activity card's Undo restores them with the row. Unlike spending categories
    there is no monthly history to orphan — cells are cheap to re-enter — so no guard."""
    category = await _get_reward_category(db, category_id)
    cells = (
        (
            await db.execute(
                select(RewardRate)
                .where(RewardRate.category_id == category_id)
                .order_by(RewardRate.id)
            )
        )
        .scalars()
        .all()
    )
    for rate in cells:
        batch.record_delete(rate)
        await db.delete(rate)
    # The cells reach the database before the row: with no relationship() between these
    # models the unit of work orders deletes by class name, RewardCategory ahead of RewardRate,
    # and the FK cascade would take cells the session still means to delete.
    await db.flush()
    batch.record_delete(category)
    batch.label = f"Deleted reward category {category.name}"
    await db.delete(category)
    return Response(status_code=204, headers=batch_header(await batch.commit()))
```

`put_reward_rates`, whole:

```python
@router.put("/rates", response_model=list[RewardRateOut])
async def put_reward_rates(
    body: list[RewardRatePut],
    response: Response,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> list[RewardRate]:
    """Bulk matrix save: upsert cells, delete where multiplier is null. ATOMIC — any
    validation failure raises before the single commit, applying nothing. Returns the
    full post-save cell list (the matrix re-renders without a second fetch). Every cell it
    adds, changes or clears is a row of ONE change batch, so one Undo reverts the whole save;
    an all-unchanged save records nothing and names no batch."""
    seen: set[tuple[int, int]] = set()
    for entry in body:
        key = (entry.card_id, entry.category_id)
        if key in seen:
            raise HTTPException(
                status_code=422,
                detail=f"duplicate cell for card {entry.card_id}, category {entry.category_id}",
            )
        seen.add(key)
    card_ids = {entry.card_id for entry in body}
    category_ids = {entry.category_id for entry in body}
    if card_ids:
        found_cards = set(
            (await db.execute(select(CreditCard.id).where(CreditCard.id.in_(card_ids))))
            .scalars()
            .all()
        )
        missing = card_ids - found_cards
        if missing:
            raise HTTPException(status_code=404, detail=f"card {min(missing)} not found")
    if category_ids:
        found = set(
            (await db.execute(select(RewardCategory.id).where(RewardCategory.id.in_(category_ids))))
            .scalars()
            .all()
        )
        missing = category_ids - found
        if missing:
            raise HTTPException(status_code=404, detail=f"reward category {min(missing)} not found")
    existing = {
        (rate.card_id, rate.category_id): rate
        for rate in (await db.execute(select(RewardRate))).scalars()
    }
    added: list[RewardRate] = []
    for entry in body:
        key = (entry.card_id, entry.category_id)
        row = existing.get(key)
        if entry.multiplier is None:
            if row is not None:
                batch.record_delete(row)
                await db.delete(row)
            continue
        multiplier = quantize_money(entry.multiplier, "multiplier", max_abs=MULTIPLIER_MAX_ABS)
        if multiplier <= 0:
            raise HTTPException(status_code=422, detail="multiplier must be positive")
        cap: Decimal | None = None
        if entry.monthly_cap is not None:
            cap = quantize_money(entry.monthly_cap, "monthly_cap", max_abs=MONEY_MAX_ABS_10_2)
            if cap <= 0:
                raise HTTPException(status_code=422, detail="monthly_cap must be positive")
        if row is None:
            rate = RewardRate(
                card_id=entry.card_id,
                category_id=entry.category_id,
                multiplier=multiplier,
                note=entry.note,
                monthly_cap=cap,
            )
            db.add(rate)
            added.append(rate)
        else:
            before = row_image(row)
            row.multiplier = multiplier
            row.note = entry.note
            row.monthly_cap = cap
            batch.record_update(row, before)
    await db.flush()  # the new cells' ids, which their images need
    for rate in added:
        batch.record_insert(rate)
    changed = batch.rows
    batch.label = f"Edited {changed} reward multiplier{'' if changed == 1 else 's'}"
    response.headers.update(batch_header(await batch.commit()))
    return await _all_rates(db)
```

- [ ] **Step 4: run them green, plus the router's own suite**

Run: `FINANCE_TEST_DB=finance_test_l3b $PY -m pytest tests/test_changelog_credit_cards.py tests/test_credit_cards_api.py tests/test_models_credit_cards.py -q`
Expected: all passed.

- [ ] **Step 5: lint and commit**

Run: `$PY -m ruff check app tests && $PY -m ruff format --check app tests` — clean.

```bash
git add backend/tests/test_changelog_credit_cards.py backend/app/api/credit_cards.py
git commit -m "feat(credit-cards): reward categories and the matrix save are change-logged; a category delete brings its cells back" \
  -m "create/update/delete_reward_category and put_reward_rates record through their ChangeBatch (polish spec §6.1, lane L3b) with X-Change-Batch. The delete images and deletes the category's cells explicitly, flushed before the row's own DELETE, so the Undo restores row and cells with their ids; the matrix save is one batch of per-cell inserts, updates and deletes (\"Edited 3 reward multipliers\"). The Hide / Show toggle is labelled with its own verb."
```

---

## Task 5 — `credit_cards.py`: cards, credits and limit history (8 routes)

**Files:**
- Modify: `backend/tests/test_changelog_credit_cards.py` (append)
- Modify: `backend/app/api/credit_cards.py` (import `long_day`; `_dollars`, `_credit_name`; `create_credit_card`,
  `update_credit_card`, `delete_credit_card`, `create_card_credit`, `update_card_credit`, `delete_card_credit`,
  `create_limit_event`, `delete_limit_event`)

- [ ] **Step 1: write the failing tests**

Imports at the top of the test file become:

```python
from datetime import date
from decimal import Decimal

from app.models import CardCredit, CreditCard, CreditLimitEvent, RewardCategory, RewardRate
from app.services.changelog import DEPENDENT_REFUSAL, REPLAY_REFUSAL
from tests.changelog_asserts import label_of, logged, ops, table_rows, undo
from tests.ordering_helpers import first_position, recorded_sql
```

Append:

```python
# ── cards, their credits and their limit history ─────────────────────────────────────


def card_body(name: str = "Capital One Venture X", **over) -> dict:
    """A full CreditCardIn: PATCH is a full replace, so every edit sends all of it."""
    body = {
        "name": name,
        "annual_fee": "395.00",
        "rewards_currency": "miles",
        "point_value_cents": "1.7",
        "primary_holder": "Ed",
        "authorized_users": None,
        "opened_on": "2023-05-12",
        "is_active": True,
        "account_id": None,
        "notes": None,
        "person_id": None,
    }
    body.update(over)
    return body


async def test_card_create_edit_archive_delete_each_log_one_batch(auth_client, db):
    created = await auth_client.post(CARDS, json=card_body())
    assert created.status_code == 201, created.text
    rows = await logged(db, created)
    assert ops(rows) == [("insert", "credit_cards")]
    assert label_of(rows) == "Added card Capital One Venture X"
    assert rows[0].after["point_value_cents"] == "1.7000"
    url = f"{CARDS}/{created.json()['id']}"

    edited = await auth_client.patch(url, json=card_body(annual_fee="0"))
    assert edited.status_code == 200, edited.text
    rows = await logged(db, edited)
    assert ops(rows) == [("update", "credit_cards")]
    assert label_of(rows) == "Edited card Capital One Venture X"
    assert (rows[0].before["annual_fee"], rows[0].after["annual_fee"]) == ("395.00", "0.00")
    # The roster's one-click toggle (a full PATCH with is_active flipped), named as the button.
    archived = await auth_client.patch(url, json=card_body(annual_fee="0", is_active=False))
    assert label_of(await logged(db, archived)) == "Archived card Capital One Venture X"
    unarchived = await auth_client.patch(url, json=card_body(annual_fee="0"))
    assert label_of(await logged(db, unarchived)) == "Unarchived card Capital One Venture X"
    unchanged = await auth_client.patch(url, json=card_body(annual_fee="0.00"))
    assert unchanged.status_code == 200 and "x-change-batch" not in unchanged.headers

    deleted = await auth_client.delete(url)
    assert deleted.status_code == 204
    rows = await logged(db, deleted)
    assert ops(rows) == [("delete", "credit_cards")]  # a bare card: nothing else to image
    assert label_of(rows) == "Deleted card Capital One Venture X"


async def test_undo_restores_a_deleted_card_with_its_credits_cells_limits_and_pins(
    auth_client, db
):
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
                card_id=venture.id, category_id=travel.id, multiplier=Decimal("10.00"), note="portal"
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
    venture_id, savor_id, travel_id = venture.id, savor.id, travel.id
    tables = (CreditCard, CardCredit, RewardRate, CreditLimitEvent, RewardCategory)
    before = await table_rows(db, *tables)
    with recorded_sql(db) as statements:
        deleted = await auth_client.delete(f"{CARDS}/{venture_id}")
    assert deleted.status_code == 204
    rows = await logged(db, deleted)
    # The pin first (an UPDATE to NULL), then every child, then the card LAST — the undo
    # replays in reverse, so the card is back before anything that points at it.
    assert ops(rows) == [
        ("update", "reward_categories"),
        ("delete", "card_credits"),
        ("delete", "card_credits"),
        ("delete", "reward_rates"),
        ("delete", "reward_rates"),
        ("delete", "credit_limit_events"),
        ("delete", "credit_limit_events"),
        ("delete", "credit_cards"),
    ]
    assert label_of(rows) == "Deleted card Capital One Venture X"
    assert rows[0].pk == {"id": travel_id}
    assert (rows[0].before["pinned_card_id"], rows[0].after["pinned_card_id"]) == (venture_id, None)
    # All of it reaches the database before the card's own DELETE — never the FKs' cascade.
    card_delete = first_position(statements, "DELETE FROM credit_cards")
    for fragment in (
        "UPDATE reward_categories",
        "DELETE FROM card_credits",
        "DELETE FROM reward_rates",
        "DELETE FROM credit_limit_events",
    ):
        assert first_position(statements, fragment) < card_delete, fragment
    # SavorOne keeps everything of its own, and its pin.
    gone = await table_rows(db, *tables)
    children = gone["card_credits"] + gone["reward_rates"] + gone["credit_limit_events"]
    assert {row["card_id"] for row in children} == {savor_id}
    assert [row["pinned_card_id"] for row in gone["reward_categories"]] == [None, savor_id, None]
    resp = await undo(auth_client, deleted)
    assert resp.status_code == 200, resp.text
    assert resp.json()["label"] == "Undid: Deleted card Capital One Venture X"
    assert await table_rows(db, *tables) == before


async def test_undoing_a_card_delete_after_its_name_was_taken_again_refuses(auth_client, db):
    """Accepted (spec §6.1): a card's name is unique, so the replayed card cannot sit beside
    the new one that took it — the replay refusal, and nothing half-restored."""
    card_id = (await auth_client.post(CARDS, json=card_body())).json()["id"]
    credit = await auth_client.post(
        f"{CARDS}/{card_id}/credits", json={"label": "Travel", "annual_value": "300"}
    )
    assert credit.status_code == 201, credit.text
    deleted = await auth_client.delete(f"{CARDS}/{card_id}")
    again = await auth_client.post(CARDS, json=card_body())
    assert again.status_code == 201, again.text
    again_id = again.json()["id"]
    refused = await undo(auth_client, deleted)
    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"] == REPLAY_REFUSAL
    rows = await table_rows(db, CreditCard, CardCredit)
    assert [row["id"] for row in rows["credit_cards"]] == [again_id]
    assert rows["card_credits"] == []


async def test_undoing_a_card_create_while_rows_point_at_it_refuses(auth_client, db):
    """Accepted (spec §6.1): the replayed DELETE would cascade a credit the create never
    imaged, so the Undo asks for the change that added it to be undone first."""
    created = await auth_client.post(CARDS, json=card_body())
    card_id = created.json()["id"]
    credit = await auth_client.post(
        f"{CARDS}/{card_id}/credits", json={"label": "Travel", "annual_value": "300"}
    )
    assert credit.status_code == 201, credit.text
    refused = await undo(auth_client, created)
    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"] == DEPENDENT_REFUSAL
    assert len((await table_rows(db, CardCredit))["card_credits"]) == 1


async def test_card_credit_writes_each_log_one_batch_and_a_delete_undoes(auth_client, db):
    card_id = (await auth_client.post(CARDS, json=card_body("Venture X"))).json()["id"]
    created = await auth_client.post(
        f"{CARDS}/{card_id}/credits", json={"label": "Travel", "annual_value": "300"}
    )
    assert created.status_code == 201, created.text
    rows = await logged(db, created)
    assert ops(rows) == [("insert", "card_credits")]
    assert label_of(rows) == "Added the $300 Travel credit to Venture X"
    credit_url = f"{CARDS}/credits/{created.json()['id']}"

    edited = await auth_client.patch(
        credit_url, json={"label": "Travel", "annual_value": "300", "counts": False}
    )
    assert edited.status_code == 200, edited.text
    rows = await logged(db, edited)
    assert ops(rows) == [("update", "card_credits")]
    assert label_of(rows) == "Edited the Travel credit on Venture X"
    assert (rows[0].before["counts"], rows[0].after["counts"]) == (True, False)

    before = await table_rows(db, CardCredit)
    deleted = await auth_client.delete(credit_url)
    assert deleted.status_code == 204
    rows = await logged(db, deleted)
    assert ops(rows) == [("delete", "card_credits")]
    assert label_of(rows) == "Deleted the $300 Travel credit from Venture X"
    resp = await undo(auth_client, deleted)
    assert resp.status_code == 200, resp.text
    assert await table_rows(db, CardCredit) == before


async def test_a_credit_label_that_already_says_credit_is_not_doubled(auth_client, db):
    card_id = (await auth_client.post(CARDS, json=card_body("Venture X"))).json()["id"]
    created = await auth_client.post(
        f"{CARDS}/{card_id}/credits", json={"label": "Airline credit", "annual_value": "1234.5"}
    )
    assert created.status_code == 201, created.text
    assert label_of(await logged(db, created)) == "Added the $1,234.50 Airline credit to Venture X"


async def test_limit_add_and_delete_each_log_one_batch_and_a_delete_undoes(auth_client, db):
    card_id = (await auth_client.post(CARDS, json=card_body("Venture X"))).json()["id"]
    added = await auth_client.post(
        f"{CARDS}/{card_id}/limits",
        json={"effective_date": "2023-05-12", "limit_amount": "20000", "note": "opening line"},
    )
    assert added.status_code == 201, added.text
    assert [event["limit_amount"] for event in added.json()] == ["20000.00"]  # the history
    rows = await logged(db, added)
    assert ops(rows) == [("insert", "credit_limit_events")]
    assert label_of(rows) == "Added Venture X's $20,000 limit from May 12, 2023"
    event_id = added.json()[0]["id"]

    before = await table_rows(db, CreditLimitEvent)
    deleted = await auth_client.delete(f"{CARDS}/{card_id}/limits/{event_id}")
    assert deleted.status_code == 204
    rows = await logged(db, deleted)
    assert ops(rows) == [("delete", "credit_limit_events")]
    assert label_of(rows) == "Deleted Venture X's $20,000 limit from May 12, 2023"
    resp = await undo(auth_client, deleted)
    assert resp.status_code == 200, resp.text
    assert await table_rows(db, CreditLimitEvent) == before
```

- [ ] **Step 2: run them red**

Run: `FINANCE_TEST_DB=finance_test_l3b $PY -m pytest tests/test_changelog_credit_cards.py -q`
Expected: `7 failed, 4 passed` — the seven new tests with `KeyError: 'x-change-batch'`.

- [ ] **Step 3: implement — `backend/app/api/credit_cards.py`**

Imports: after the `changelog` import add `from app.services.day_labels import long_day`.

In the labels section, after `_edit_label`:

```python
def _dollars(value: Decimal) -> str:
    """Money inside a sentence: '$300', '$20,000', '$1,234.50' — whole dollars drop the
    cents."""
    return f"${value:,.0f}" if value == value.to_integral_value() else f"${value:,.2f}"


def _credit_name(label: str) -> str:
    """'Travel' -> 'Travel credit'. The card page names a credit "the {label} credit", so a
    label that already ends in the word keeps its own."""
    return label if label.lower().endswith("credit") else f"{label} credit"
```

The eight routes:

```python
@router.post("", response_model=CreditCardOut, status_code=201)
async def create_credit_card(
    body: CreditCardIn,
    response: Response,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> CreditCardOut:
    values = await _validated_card_values(db, body, card_id=None)
    if values["sort_order"] is None:
        # No position given: append after the last card (2026-09-23 reorder spec §3.3), under
        # the list's lock (decision 16).
        await db.execute(order_lock(CreditCard))
        values["sort_order"] = (
            await db.execute(next_sort_order(CreditCard.sort_order))
        ).scalar_one()
    card = CreditCard(**values)
    db.add(card)
    await db.flush()
    batch.record_insert(card)
    batch.label = f"Added card {card.name}"
    response.headers.update(batch_header(await batch.commit()))
    return await _one_card_out(db, card)
```

```python
@router.patch("/{card_id}", response_model=CreditCardOut)
async def update_credit_card(
    card_id: int,
    body: CreditCardIn,
    response: Response,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> CreditCardOut:
    """Full replace (house style) — the client sends the whole card back, except that an
    absent or null sort_order keeps the stored one (2026-09-23 reorder spec §3.3): the
    list's drag owns that column, and an edit form holding a stale copy must not undo it.
    Archive / Unarchive is this same PATCH with is_active flipped, and its label says so."""
    card = await _get_card(db, card_id)
    values = await _validated_card_values(db, body, card_id=card_id)
    if values["sort_order"] is None:
        del values["sort_order"]
    before = row_image(card)
    for field, value in values.items():
        setattr(card, field, value)
    batch.record_update(card, before)
    batch.label = _edit_label(
        "card", card.name, before, row_image(card), off="Archived", on="Unarchived"
    )
    response.headers.update(batch_header(await batch.commit()))
    return await _one_card_out(db, card)


@router.delete("/{card_id}", status_code=204)
async def delete_credit_card(
    card_id: int,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> Response:
    """Removes the card and everything that points at it, each row IMAGED so the Activity
    card's Undo restores all of it with the same ids: the categories pinned to the card are
    unpinned first (updates to NULL), then its credits, cells and limit history go, and the
    card goes LAST — undo replays in reverse, so the card is back before anything that points
    at it."""
    card = await _get_card(db, card_id)
    pinned = (
        (
            await db.execute(
                select(RewardCategory)
                .where(RewardCategory.pinned_card_id == card_id)
                .order_by(RewardCategory.id)
            )
        )
        .scalars()
        .all()
    )
    for category in pinned:
        before = row_image(category)
        category.pinned_card_id = None
        batch.record_update(category, before)
    for child in (CardCredit, RewardRate, CreditLimitEvent):
        rows = (
            (await db.execute(select(child).where(child.card_id == card_id).order_by(child.id)))
            .scalars()
            .all()
        )
        for row in rows:
            batch.record_delete(row)
            await db.delete(row)
    # All of it reaches the database BEFORE the card's own DELETE. With no relationship()
    # between these models the unit of work orders deletes by class name, CreditCard ahead of
    # CreditLimitEvent and RewardRate, and the FK cascade would take rows the session still
    # means to delete.
    await db.flush()
    batch.record_delete(card)
    batch.label = f"Deleted card {card.name}"
    await db.delete(card)
    return Response(status_code=204, headers=batch_header(await batch.commit()))
```

```python
@router.post("/{card_id}/credits", response_model=CardCreditOut, status_code=201)
async def create_card_credit(
    card_id: int,
    body: CardCreditIn,
    response: Response,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> CardCredit:
    card = await _get_card(db, card_id)
    credit = CardCredit(
        card_id=card_id,
        label=body.label,
        annual_value=_validated_credit_value(body.annual_value),
        counts=body.counts,
        reset_cadence=body.reset_cadence,
    )
    db.add(credit)
    await db.flush()
    batch.record_insert(credit)
    batch.label = (
        f"Added the {_dollars(credit.annual_value)} {_credit_name(credit.label)} to {card.name}"
    )
    response.headers.update(batch_header(await batch.commit()))
    return credit


@router.patch("/credits/{credit_id}", response_model=CardCreditOut)
async def update_card_credit(
    credit_id: int,
    body: CardCreditIn,
    response: Response,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> CardCredit:
    credit = await db.get(CardCredit, credit_id)
    if credit is None:
        raise HTTPException(status_code=404, detail="credit not found")
    card = await _get_card(db, credit.card_id)
    annual_value = _validated_credit_value(body.annual_value)
    # Every raise is behind us — mutate only now, then image what moved.
    before = row_image(credit)
    credit.label = body.label
    credit.annual_value = annual_value
    credit.counts = body.counts
    credit.reset_cadence = body.reset_cadence
    batch.record_update(credit, before)
    batch.label = f"Edited the {_credit_name(credit.label)} on {card.name}"
    response.headers.update(batch_header(await batch.commit()))
    return credit


@router.delete("/credits/{credit_id}", status_code=204)
async def delete_card_credit(
    credit_id: int,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> Response:
    credit = await db.get(CardCredit, credit_id)
    if credit is None:
        raise HTTPException(status_code=404, detail="credit not found")
    card = await _get_card(db, credit.card_id)
    batch.record_delete(credit)
    batch.label = (
        f"Deleted the {_dollars(credit.annual_value)} {_credit_name(credit.label)} "
        f"from {card.name}"
    )
    await db.delete(credit)
    return Response(status_code=204, headers=batch_header(await batch.commit()))
```

```python
@router.post("/{card_id}/limits", response_model=list[CreditLimitEventOut], status_code=201)
async def create_limit_event(
    card_id: int,
    body: CreditLimitEventIn,
    response: Response,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> list[CreditLimitEvent]:
    """Returns the card's FULL limit history ascending (the budgets-PUT precedent) so
    the editor renders without a second fetch. Same (card, date) → 409, not upsert:
    a mis-dated entry is fixed by delete-then-re-add, keeping every change deliberate."""
    card = await _get_card(db, card_id)
    require_reasonable_date(body.effective_date, "effective_date")
    amount = quantize_money(body.limit_amount, "limit_amount", max_abs=MONEY_MAX_ABS_12_2)
    if amount <= 0:
        raise HTTPException(status_code=422, detail="limit_amount must be positive")
    existing = (
        (
            await db.execute(
                select(CreditLimitEvent).where(
                    CreditLimitEvent.card_id == card_id,
                    CreditLimitEvent.effective_date == body.effective_date,
                )
            )
        )
        .scalars()
        .first()
    )
    if existing is not None:
        raise HTTPException(
            status_code=409,
            detail=f"limit event for {body.effective_date} already exists — delete it first",
        )
    event = CreditLimitEvent(
        card_id=card_id,
        effective_date=body.effective_date,
        limit_amount=amount,
        note=body.note,
    )
    db.add(event)
    await db.flush()
    batch.record_insert(event)
    batch.label = (
        f"Added {card.name}'s {_dollars(amount)} limit from {long_day(body.effective_date)}"
    )
    response.headers.update(batch_header(await batch.commit()))
    return list(
        (
            await db.execute(
                select(CreditLimitEvent)
                .where(CreditLimitEvent.card_id == card_id)
                .order_by(CreditLimitEvent.effective_date)
            )
        )
        .scalars()
        .all()
    )


@router.delete("/{card_id}/limits/{event_id}", status_code=204)
async def delete_limit_event(
    card_id: int,
    event_id: int,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> Response:
    card = await _get_card(db, card_id)
    event = await db.get(CreditLimitEvent, event_id)
    if event is None or event.card_id != card_id:
        raise HTTPException(status_code=404, detail="limit event not found")
    batch.record_delete(event)
    batch.label = (
        f"Deleted {card.name}'s {_dollars(event.limit_amount)} limit from "
        f"{long_day(event.effective_date)}"
    )
    await db.delete(event)
    return Response(status_code=204, headers=batch_header(await batch.commit()))
```

- [ ] **Step 4: run them green, plus the router's own suites**

Run: `FINANCE_TEST_DB=finance_test_l3b $PY -m pytest tests/test_changelog_credit_cards.py tests/test_credit_cards_api.py tests/test_models_credit_cards.py tests/test_reorder_credit_cards_api.py -q`
Expected: all passed. (`test_reorder_serialization.py` is NOT run here — its card race calls `create_credit_card`
directly with the old two arguments and is updated in Task 6.)

- [ ] **Step 5: lint and commit**

Run: `$PY -m ruff check app tests && $PY -m ruff format --check app tests` — clean.

```bash
git add backend/tests/test_changelog_credit_cards.py backend/app/api/credit_cards.py
git commit -m "feat(credit-cards): cards, credits and limit history are change-logged; a card delete undoes with its pins and children" \
  -m "create/update/delete_credit_card, the three credit routes and the two limit routes record through their ChangeBatch (polish spec §6.1, lane L3b) with X-Change-Batch. delete_credit_card unpins the categories pinned to the card (imaged updates to NULL), images and deletes its credits, cells and limit history, flushes, and deletes the card last, so the Activity card's Undo restores all of it with the same ids. Archive / Unarchive is labelled with its own verb."
```

---

## Task 6 — the two card-list reorders logged, and their Undo serialized (2 routes + 1 service)

**Files:**
- Modify: `backend/tests/test_changelog_credit_cards.py` (append), `backend/tests/test_changelog_pin.py` (add
  `credit_cards.py`), `backend/tests/test_reorder_credit_cards_api.py`, `backend/tests/test_reorder_serialization.py`
- Modify: `backend/app/api/credit_cards.py` (module docstring, `Sequence`/`moved_ids` imports, `_reorder_label`,
  `reorder_reward_categories`, `reorder_credit_cards`)
- Modify: `backend/app/services/ordering.py`, `backend/app/services/changelog.py` (comment)

- [ ] **Step 1: write the failing tests**

Imports at the top of `test_changelog_credit_cards.py` become:

```python
from datetime import date
from decimal import Decimal
from uuid import UUID

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.models import CardCredit, CreditCard, CreditLimitEvent, RewardCategory, RewardRate
from app.services.changelog import (
    DEPENDENT_REFUSAL,
    OVERLAP_REFUSAL,
    REPLAY_REFUSAL,
    undo_batch,
)
from app.services.ordering import order_lock, order_locks_for
from tests.changelog_asserts import label_of, logged, ops, table_rows, undo
from tests.ordering_helpers import first_position, recorded_sql
```

Append:

```python
# ── the two list reorders ────────────────────────────────────────────────────────────

CARD_ORDER = f"{CARDS}/order"
CATEGORY_ORDER = f"{CATEGORIES}/order"


async def sort_orders(db, model) -> list[tuple[int, int]]:
    rows = await db.execute(
        select(model.id, model.sort_order).order_by(model.sort_order, model.id)
    )
    return [tuple(row) for row in rows]


async def test_a_card_reorder_is_one_batch_named_for_what_moved(auth_client, db):
    seeded = [card("A"), card("B", 1), card("C", 2)]
    db.add_all(seeded)
    await db.commit()
    a, b, c = (row.id for row in seeded)
    moved = await auth_client.put(CARD_ORDER, json={"ids": [c, a, b]})
    assert moved.status_code == 200, moved.text
    rows = await logged(db, moved)
    assert ops(rows) == [("update", "credit_cards")] * 3
    assert label_of(rows) == "Moved card C"
    assert [(r.pk["id"], r.before["sort_order"], r.after["sort_order"]) for r in rows] == [
        (c, 2, 0),
        (a, 0, 1),
        (b, 1, 2),
    ]
    swapped = await auth_client.put(CARD_ORDER, json={"ids": [b, a, c]})
    assert label_of(await logged(db, swapped)) == "Reordered 2 cards"
    same = await auth_client.put(CARD_ORDER, json={"ids": [b, a, c]})
    assert same.status_code == 200 and "x-change-batch" not in same.headers


async def test_undoing_an_older_card_edit_after_a_reorder_moved_it_refuses(auth_client, db):
    """Why the reorder is logged at all (spec §6.1): the edit's Undo writes the card's whole
    old row back, sort_order included, so after an unlogged reorder it would silently move
    the card. Logged, the reorder is a later change to the same row: undo that first."""
    seeded = [card("A"), card("B", 1), card("C", 2)]
    db.add_all(seeded)
    await db.commit()
    a, b, c = (row.id for row in seeded)
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


async def test_a_reward_category_reorder_is_one_batch_named_for_what_moved(auth_client, db):
    seeded = [category("Dining"), category("Groceries", 1), category("Travel", 2)]
    db.add_all(seeded)
    await db.commit()
    d, g, t = (row.id for row in seeded)
    moved = await auth_client.put(CATEGORY_ORDER, json={"ids": [t, d, g]})
    assert moved.status_code == 200, moved.text
    rows = await logged(db, moved)
    assert ops(rows) == [("update", "reward_categories")] * 3
    assert label_of(rows) == "Moved reward category Travel"
    swapped = await auth_client.put(CATEGORY_ORDER, json={"ids": [g, d, t]})
    assert label_of(await logged(db, swapped)) == "Reordered 2 reward categories"
    same = await auth_client.put(CATEGORY_ORDER, json={"ids": [g, d, t]})
    assert same.status_code == 200 and "x-change-batch" not in same.headers


async def test_undoing_an_older_reward_category_edit_after_a_reorder_moved_it_refuses(
    auth_client, db
):
    seeded = [category("Dining"), category("Groceries", 1), category("Travel", 2)]
    db.add_all(seeded)
    await db.commit()
    d, g, t = (row.id for row in seeded)
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


def test_an_undo_takes_the_card_lists_locks_after_the_workbook_lists():
    """One fixed order for every path that takes several order locks (reorder plan decision
    16): an Undo whose batch spans lists takes the workbook's first and the two dashboard-only
    card lists last — the importer never takes those, so they can close no cycle with it."""
    tables = {"reward_categories", "credit_cards", "accounts", "card_credits"}
    keys = [lock.compile().params["key"] for lock in order_locks_for(tables)]
    assert keys == ["reorder:accounts", "reorder:credit_cards", "reorder:reward_categories"]


@pytest.mark.parametrize(
    "model", [CreditCard, RewardCategory], ids=["credit_cards", "reward_categories"]
)
async def test_an_undo_of_a_card_list_reorder_waits_for_its_lists_order_lock(
    auth_client, db, engine, model
):
    """Decision 16, now that these reorders are logged: an Activity-card Undo rewrites the
    list's numbers, so while another session holds the list's order lock (a reorder or an
    append in flight in another tab) the Undo waits — here out to a short lock_timeout,
    having written nothing — and goes through once the lock is free."""
    seeded = [card("A"), card("B", 1)] if model is CreditCard else [category("A"), category("B", 1)]
    db.add_all(seeded)
    await db.commit()
    a, b = (row.id for row in seeded)
    path = CARD_ORDER if model is CreditCard else CATEGORY_ORDER
    reordered = await auth_client.put(path, json={"ids": [b, a]})
    assert reordered.status_code == 200, reordered.text
    batch_id = UUID(reordered.headers["x-change-batch"])
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as holder:
        await holder.execute(order_lock(model))  # a reorder or an append in flight elsewhere
        async with sessions() as undoing:
            await undoing.execute(text("SET LOCAL lock_timeout = '200ms'"))
            with pytest.raises(DBAPIError, match="lock timeout"):
                await undo_batch(undoing, batch_id, actor="tab 2")
        assert await sort_orders(db, model) == [(b, 0), (a, 1)]  # nothing undone meanwhile
    async with sessions() as undoing:  # the holder's transaction is over: the lock is free
        await undo_batch(undoing, batch_id, actor="tab 2")
    assert await sort_orders(db, model) == [(a, 0), (b, 1)]
```

Pin: in `backend/tests/test_changelog_pin.py`, between the `"comp.py"` and `"espp.py"` entries insert:

```python
    "credit_cards.py": {
        "create_reward_category",
        "reorder_reward_categories",
        "update_reward_category",
        "delete_reward_category",
        "put_reward_rates",
        "create_credit_card",
        "reorder_credit_cards",
        "update_credit_card",
        "delete_credit_card",
        "create_card_credit",
        "update_card_credit",
        "delete_card_credit",
        "create_limit_event",
        "delete_limit_event",
    },
```

`backend/tests/test_reorder_credit_cards_api.py`:
- docstring →

```python
"""PUT /credit-cards/order, PUT /credit-cards/categories/order and their append/keep
defaults (2026-09-23 drag-to-reorder spec §3.2, §3.3, §8.3). Both routes are change-logged
since 2026-09-25 (polish spec §6.1): one batch, named in X-Change-Batch — its labels and the
overlap refusal are pinned in test_changelog_credit_cards.py — and the client's own Undo still
re-sends the previous order."""
```

- imports: drop `from sqlalchemy import select` and `ChangeLog` (no other use); add
  `from tests.changelog_asserts import logged`.
- `test_card_reorder_answers_exactly_as_the_list_get_does`: the last line becomes
  `assert {(r.op, r.table_name) for r in await logged(db, resp)} == {("update", "credit_cards")}`
- `test_reward_category_reorder_renumbers_and_matches_the_get`: the last line becomes
  `assert {(r.op, r.table_name) for r in await logged(db, resp)} == {("update", "reward_categories")}`
  (ruff format wraps it).

`backend/tests/test_reorder_serialization.py`, in `test_a_card_created_during_a_reorder_lands_after_it_not_on_its_numbers`:

```python
    async def reverse(session):
        batch = ChangeBatch(session, actor="tab 1")
        return await reorder_credit_cards(OrderIn(ids=[z, y, x, w]), Response(), session, batch)

    async def create(session):
        body = CreditCardIn(name="New", rewards_currency="points")
        batch = ChangeBatch(session, actor="tab 2")
        return await create_credit_card(body, Response(), session, batch)
```

- [ ] **Step 2: run them red**

Run: `FINANCE_TEST_DB=finance_test_l3b $PY -m pytest tests/test_changelog_credit_cards.py tests/test_changelog_pin.py tests/test_reorder_credit_cards_api.py tests/test_reorder_serialization.py -q`
Expected: `11 failed, 44 passed` —
- the two reorder-label tests and the two lock-wait tests: `KeyError: 'x-change-batch'`;
- the two overlap tests: `assert 200 == 409` (the unlogged reorder let the edit's Undo through);
- the lock-order test: `['reorder:accounts'] == [...]`;
- the pin test: `credit_cards.py:reorder_reward_categories must commit through its ChangeBatch, not db.commit()`;
- the two modified reorder tests: `KeyError: 'x-change-batch'`;
- the card race: `TypeError: reorder_credit_cards() takes 2 positional arguments but 4 were given`.

- [ ] **Step 3: implement**

`backend/app/services/ordering.py` — the models import becomes
`from app.models import Account, CreditCard, PositionTransaction, RewardCategory, SpendingCategory`, and the lock-order
block becomes:

```python
# The one order in which any path holding more than one list's order lock takes them — the
# importer (ORDERED_LISTS, the workbook's three lists) and an Activity-card Undo (LOGGED_LISTS,
# every list whose rows a logged write can move) — so no two such paths can each hold one lock
# while waiting for the other's (decision 16). The two card lists joined the change log on
# 2026-09-25 (polish spec §6.1) and come LAST: they are dashboard-only, so the importer never
# takes them, and after every lock it does take they can close no cycle with it.
ORDERED_LISTS: tuple[type, ...] = (PositionTransaction, Account, SpendingCategory)
LOGGED_LISTS: tuple[type, ...] = (*ORDERED_LISTS, CreditCard, RewardCategory)


def order_locks_for(tables: Collection[str]) -> list[TextClause]:
    """order_lock for each of the LOGGED_LISTS among `tables`, in that fixed order."""
    return [order_lock(model) for model in LOGGED_LISTS if model.__tablename__ in tables]
```

`backend/app/services/changelog.py` — the comment above `for statement in order_locks_for(...)` becomes:

```python
    # An Undo that rewrites a list's rows (services.ordering.LOGGED_LISTS) rewrites that list's
    # order too, so it serializes with the list's reorders and appends (2026-09-23 reorder plan
    # decision 16): racing a reorder in another tab, it must not blend the two orders. In the
    # fixed order, and BEFORE the review-input table locks below, so an Undo can never hold
    # those while an import that holds the order locks waits for them.
```

`backend/app/api/credit_cards.py`:
- new module docstring at the top of the file:

```python
"""Credit cards API: the rewards matrix (reward categories x cards -> multipliers), the card
roster, and each card's credits and limit history (2026-08-25 spec).

Every write is change-logged (2026-09-25 polish spec §6.1): one ChangeBatch per request, an
Activity label, and the X-Change-Batch header, so the Activity card — and the page's own toast
— can undo it exactly. The two deletes that have dependents image them through the ORM,
children first and the row LAST, instead of leaving them to the FKs' ON DELETE: undo_batch
replays in reverse, so the row is back before anything that points at it, and every row comes
back with the id it had. Undoing a delete after a new row took the same name refuses with the
replay sentence (the unique index is the conflict); undoing a create while other rows now
point at it — a card's credits, cells, limit history or pins — refuses with the dependent one.
"""
```

- imports: `from collections.abc import Sequence` first; `moved_ids` joins the `app.services.ordering` import list.
- in the labels section, after `_credit_name`:

```python
def _reorder_label(
    rows: Sequence[CreditCard | RewardCategory], new_order: list[int], noun: str, plural: str
) -> str:
    """A reorder's label, the spending categories' rule (2026-09-23 spec §8.4): the one row
    whose move explains the whole change is named, else the minimal moved set is counted."""
    moved = moved_ids([row.id for row in rows], new_order)
    if len(moved) == 1:
        return f"Moved {noun} {next(row.name for row in rows if row.id == moved[0])}"
    return f"Reordered {len(moved)} {plural}"
```

- the two routes:

```python
@router.put("/categories/order", response_model=list[RewardCategoryOut])
async def reorder_reward_categories(
    body: OrderIn,
    response: Response,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> list[RewardCategory]:
    """Drag-to-reorder the Categories & weights rows (2026-09-23 spec §3.2): `ids` is every
    reward category in its new order; sort_order becomes 0…n−1 in ONE transaction, and only
    rows whose value moves are written — as ONE change batch (2026-09-25 polish spec §6.1).
    Logged because every other write to these rows is: an older edit's Undo puts its whole
    old row back, sort_order included, so after an unlogged reorder it would silently move
    the row; logged, that Undo meets the overlap refusal instead. The client's own Undo still
    re-sends the previous order. Serialized per list (decision 16): the order lock comes
    first. Declared before /categories/{category_id}."""
    await db.execute(order_lock(RewardCategory))
    categories = list((await db.execute(in_list_order(RewardCategory))).scalars())
    before = {category.id: row_image(category) for category in categories}
    ordered, changed = apply_order(categories, body.ids, stale_detail=STALE_REWARD_CATEGORIES)
    if not changed:  # the order as stored: nothing written, nothing logged
        return ordered
    for category, _old, _new in changed:
        batch.record_update(category, before[category.id])
    batch.label = _reorder_label(categories, body.ids, "reward category", "reward categories")
    response.headers.update(batch_header(await batch.commit()))
    return ordered
```

```python
@router.put("/order", response_model=list[CreditCardOut])
async def reorder_credit_cards(
    body: OrderIn,
    response: Response,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> list[CreditCardOut]:
    """Drag-to-reorder the card list (2026-09-23 spec §3.2): `ids` is every card, active
    and inactive, in its new order; sort_order becomes 0…n−1 in ONE transaction, and only
    rows whose value moves are written — as ONE change batch, logged for the reason
    reorder_reward_categories gives (2026-09-25 polish spec §6.1). Answers exactly as the
    list GET does. The client's own Undo still re-sends the previous order. Serialized per
    list (decision 16): the order lock comes first. Declared before the /{card_id} routes."""
    await db.execute(order_lock(CreditCard))
    cards = list((await db.execute(in_list_order(CreditCard))).scalars())
    before = {card.id: row_image(card) for card in cards}
    ordered, changed = apply_order(cards, body.ids, stale_detail=STALE_CARDS)
    if changed:  # the order as stored writes and logs nothing
        for card, _old, _new in changed:
            batch.record_update(card, before[card.id])
        batch.label = _reorder_label(cards, body.ids, "card", "cards")
        response.headers.update(batch_header(await batch.commit()))
    return await _cards_out(db, ordered)
```

- [ ] **Step 4: run them green, plus everything that touches the lists or the Undo**

Run: `FINANCE_TEST_DB=finance_test_l3b $PY -m pytest tests/test_changelog_credit_cards.py tests/test_changelog_pin.py tests/test_reorder_credit_cards_api.py tests/test_reorder_serialization.py tests/test_reorder_route_order.py tests/test_ordering_service.py tests/test_activity_api.py tests/test_changelog_routes.py tests/test_changelog_service.py tests/test_credit_cards_api.py -q`
Expected: all passed.

- [ ] **Step 5: lint and commit**

Run: `$PY -m ruff check app tests && $PY -m ruff format --check app tests` — clean.

```bash
git add backend/app/api/credit_cards.py backend/app/services/ordering.py backend/app/services/changelog.py backend/tests/test_changelog_credit_cards.py backend/tests/test_changelog_pin.py backend/tests/test_reorder_credit_cards_api.py backend/tests/test_reorder_serialization.py
git commit -m "feat(credit-cards): the card and reward-category reorders are change-logged, and their Undo waits for the list's lock" \
  -m "Both reorders record update per moved row (\"Moved card C\", \"Reordered 2 reward categories\") and answer X-Change-Batch, so an older edit's Undo meets the overlap refusal instead of silently moving the row back (polish spec §6.1). services/ordering.py adds LOGGED_LISTS (the importer's three, then the two dashboard-only card lists) and order_locks_for walks it, so an Activity-card Undo of a card-list batch serializes with reorders and appends like the accounts' (reorder plan decision 16). credit_cards.py joins the change-log pin with all 14 writes; the two old 'unlogged' assertions and the card race's direct calls are updated."
```

---

## Task 7 — gates and the record

- [ ] **Step 1: the full suite**

Run: `FINANCE_TEST_DB=finance_test_l3b $PY -m pytest -n 4 -q -p no:cacheprovider`
Expected: `2781 passed, 4 skipped` (the baseline's 2,747 plus this lane's 34), exit 0.

- [ ] **Step 2: lint**

Run: `$PY -m ruff check app tests` → `All checks passed!`; `$PY -m ruff format --check app tests` → `… files already
formatted`.

- [ ] **Step 3: append "As built"** to this plan: the commits, the per-route table as built, the test counts, and every
  deviation from the code above with its reason. Commit (`docs(plan): L3b as built …`).

---

## Self-review — the brief and spec §6.1 mapped to tasks

| Requirement | Task |
|---|---|
| comp.py: focal events + RSU grants logged, header, labels ("Deleted the 2025 comp event", "Deleted RSU grant {label}") | 1 |
| espp.py: lots, periods, offerings logged; `delete_period` labelled as the Reset | 2 |
| paycheck.py: profiles logged; the review-input lock via existing machinery; `in_force` never imaged | 3 |
| `delete_reward_category`: its `reward_rates` imaged + deleted first, then the category | 4 |
| `put_reward_rates`: insert / update / delete per cell, one batch, one Undo restores all three | 4 |
| `update_reward_category`, `create_reward_category` logged with header (C2's `updateRewardCategoryLogged`) | 4 |
| `delete_credit_card`: pins → NULL first, then credits, rates (by card), limit events, then the card; Undo restores all with ids | 5 |
| `update_credit_card` (full replace) logged with header (C2's `updateCreditCardLogged`) | 5 |
| credits CRUD, limit create (201 returns the history) / delete logged | 5 |
| REPLAY_REFUSAL after re-creating a deleted card by name (plus lot date and grant label) | 5 (1, 2) |
| DEPENDENT_REFUSAL for undoing a card create while children exist | 5 |
| reorders logged with `record_update` per changed row; docstrings rewritten; client re-send Undo untouched | 6 |
| OVERLAP_REFUSAL when undoing an older edit after a reorder moved the row (cards and reward categories) | 6 |
| static sub-paths stay before `/{card_id}` | unchanged; pinned by `test_reorder_route_order.py` (run in 6) |
| pin test: four modules in LOGGED with every committing function | 1, 2, 3, 6 |
| exempt entries | none in these four routers |
| full suite `-n 4` green, ruff clean, "As built" | 7 |

---

## As built (2026-09-25)

**Branch `feat/polish-undo-b`, cut from main @657e3d62. Seven commits, not pushed, not merged:**

| Commit | Task |
|---|---|
| `b353f7cb` docs(plan): lane L3b — exact undo for the card, ESPP, paycheck and comp routers | plan |
| `578f5afc` feat(comp): focal events and RSU grants are change-logged, and a delete undoes exactly | 1 |
| `d44267ed` feat(espp): lots, purchase periods and offerings are change-logged, and a delete undoes exactly | 2 |
| `401dbb30` feat(paycheck): profile writes are change-logged, and a delete undoes exactly | 3 |
| `bca21353` feat(credit-cards): reward categories and the matrix save are change-logged; a category delete brings its cells back | 4 |
| `c6b660df` feat(credit-cards): cards, credits and limit history are change-logged; a card delete undoes with its pins and children | 5 |
| `ffe3dae3` feat(credit-cards): the card and reward-category reorders are change-logged, and their Undo waits for the list's lock | 6 |

(plus this "As built" commit.)

**The contract table above is what shipped, route for route** — all 32 committing functions (credit_cards 14, espp 9,
comp 6, paycheck 3) record through their ChangeBatch, answer `X-Change-Batch` when they recorded a row and no header
when they did not, and carry the labels in the table. Every label, op sequence and header is asserted by a test; so is
the exact undo of every delete (rows compared through a Core SELECT before and after, ids included).

**Gates (on `ffe3dae3`):**
- Full backend suite, `FINANCE_TEST_DB=finance_test_l3b … pytest -n 4`: **2,781 passed, 4 skipped** in 91 s, exit 0
  (baseline on 657e3d62: 2,747 passed, 4 skipped). No SQLAlchemy warnings in the log.
- `ruff check app tests`: All checks passed. `ruff format --check app tests`: 309 files already formatted.
- New tests: **34** — `test_changelog_comp.py` 6, `test_changelog_espp.py` 7, `test_changelog_paycheck.py` 3,
  `test_changelog_credit_cards.py` 18. Existing tests changed, not added: `test_reorder_credit_cards_api.py` (2
  assertions), `test_reorder_serialization.py` (the card race's 2 direct calls), `test_changelog_pin.py` (4 entries).
- Every red run matched the plan's prediction: Task 1 `6 failed, 2 passed`; Task 2 `8 failed, 1 passed`; Task 3
  `4 failed, 1 passed`; Task 4 `4 failed`; Task 5 `7 failed, 4 passed`; Task 6 `11 failed, 44 passed`.

**Proofs recorded along the way:**
- **The flush before a parent's DELETE is load-bearing (decision 5).** Each exact-undo test was run once with the flush
  left out: the category delete emitted `DELETE FROM reward_categories` (statement 2) before `DELETE FROM reward_rates`
  (statement 3), and the card delete emitted `DELETE FROM credit_cards` (8) before `DELETE FROM credit_limit_events`
  (9) — the FK cascade was doing the work. With the flush both SQL-order assertions pass.
- **Why the reorders had to be logged.** In Task 6's red run the two overlap tests failed with `200 == 409`: with the
  reorder still unlogged, the older edit's Undo went through and put the row's old `sort_order` back — the silent move
  the spec names. Logged, it is the overlap refusal.

**Deviations from the code above (all cosmetic):**
- `ruff format` re-wrapped three spots: the `RewardRate(… note="portal")` seed in the card-delete test (one keyword per
  line), `sort_orders`' `select` (onto one line) and `delete_card_credit`'s label (the two f-strings joined — the line
  fits 100 columns).
- `test_the_label_names_whose_profile_when_two_share_a_date` compares the two labels as one list instead of two
  wrapped asserts (one of those lines was 101 columns).
- Task 6's predicted TypeError text was "takes 2 positional arguments"; Python's actual wording is "takes from 1 to 2
  positional arguments but 4 were given" (the old `db` had a default).

**Files outside the four routers (both in the plan's decisions 7 and 8):**
- `backend/app/services/ordering.py` — `LOGGED_LISTS = (*ORDERED_LISTS, CreditCard, RewardCategory)`;
  `order_locks_for` walks it. `ORDERED_LISTS` (the importer's three) is unchanged.
- `backend/app/services/changelog.py` — one comment (names `LOGGED_LISTS`); no code change.

**For the coordinator and the wave-2 lanes:**
- `tests/test_changelog_pin.py`: my four modules sit at the TOP of `LOGGED` (before `net_worth.py`), so L3a's entries
  should merge as a disjoint hunk; union both.
- `tests/test_reorder_serialization.py`: only `test_a_card_created_during_a_reorder_lands_after_it_not_on_its_numbers`
  changed (lines ~145–152), away from the ledger race L3a may touch.
- `tests/changelog_asserts.py` is new and lane-local in name; L3a's helpers, if any, should not collide.
- L4/L7: every delete client in C2's list for these routers (`deleteCreditCard`, `deleteCardCredit`,
  `deleteLimitEvent`, `deleteRewardCategory`, `deleteLot`, `deleteOffering`, `deletePeriod`, `deleteProfile`,
  `deleteEvent`, `deleteRsuGrant`) now gets a batch id; `updateCreditCardLogged` / `updateRewardCategoryLogged` get
  one from the PATCHes. The card page's re-create Undo can retire. The two reorder clients' own "re-send the previous
  order" Undo still works (it is simply another logged reorder).

**Nothing in scope left undone.** Out of this lane: the Activity card's ⓘ copy listing the new kinds (frontend).
