# Data lifecycle L2 — Change log, router hooks, Activity, Undo, import trail — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `docs/superpowers/specs/2026-09-03-data-lifecycle-design.md` §9: a request-scoped `ChangeBatch` that the listed write paths record row images into and commit through; `batch_id` on the two month upserts and an `X-Change-Batch` header on the two month DELETEs; the grep pin that fails until a new write path is listed or named exempt; `GET /activity` (batches and runs interleaved, paged), `GET /activity/runs/{id}` (the stored report) and `POST /activity/batches/{id}/undo` (inverse replay in one transaction with the three 409 refusals); the importer writes a pre-import restore point, a summary change-log row and an `import_xlsx` run.

**Architecture:** `services/changelog.py` owns capture (`ChangeBatch`, `record_insert/update/delete`, `commit()` in place of `db.commit()`), the FastAPI dependency `change_batch` (reads `X-Change-Source: repair`), and `undo_batch` (Core `delete/update/insert` against `Base.metadata.tables`, values parsed through Phase 0's `parse_cell`, recorded as a new `source='undo'` batch plus an `undo` run whose report links `undid`). Routers change only where they write. `api/activity.py` is a thin reader over both tables.

**Tech Stack:** FastAPI dependencies, SQLAlchemy 2.0 async (ORM writes in routers, Core replay in undo), Pydantic 2 discriminated unions (Phase 0's `ActivityOut`).

**Worktree / commands:** Branch `lifecycle-l2` from main AFTER `lifecycle-base` merged. Backend from `<worktree>/backend`:
`FINANCE_TEST_DB=finance_test_l2 ../../../backend/.venv/Scripts/python.exe -m pytest tests/<file> -q`
(`<venv-python>` = that interpreter.) Nothing frontend in this lane.

---

## File structure

| File | Responsibility |
|---|---|
| `backend/app/services/changelog.py` (new) | `ChangeBatch`, `change_batch`, `pk_of`, `row_image`, `batch_header`, `undo_batch`, `undone_by`, `UndoRefused`, the refusal sentences |
| `backend/tests/test_changelog_service.py` (new) | capture semantics, dependency source rule, undo replay |
| `backend/app/api/net_worth.py` (modify) | hooks on accounts POST/PATCH/DELETE, months PUT/DELETE |
| `backend/app/api/spending.py` (modify) | hooks on categories POST/PATCH/DELETE, budgets PUT/DELETE, months PUT/DELETE |
| `backend/tests/test_changelog_routes.py` (new) | each logged path writes the right rows, labels, months, ids, headers |
| `backend/tests/test_changelog_pin.py` (new) | the grep pin |
| `backend/app/api/activity.py` (new) | `/activity`, `/activity/runs/{id}`, `/activity/batches/{id}/undo` |
| `backend/app/main.py` (modify) | include the router |
| `backend/tests/test_activity_api.py` (new) | listing, paging, report, undo happy paths and the 409s, undo-of-undo |
| `backend/app/importer/service.py` (modify) | `actor`, pre-import restore point, summary row, run record |
| `backend/app/api/import_.py` (modify) | pass `actor=user.email` |
| `backend/tests/test_import_trail.py` (new) | the import's trail |

---

### Task 1: `ChangeBatch` — capture, the dependency, the header helper

**Files:**
- Create: `backend/app/services/changelog.py`
- Test: `backend/tests/test_changelog_service.py`

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_changelog_service.py
from datetime import date
from decimal import Decimal

from sqlalchemy import select

from app.models import Account, AccountBalance, ChangeLog, NetWorthSnapshot
from app.services.changelog import (
    CHANGE_BATCH_HEADER,
    HEADER_SOURCES,
    UNDOABLE_SOURCES,
    ChangeBatch,
    batch_header,
    pk_of,
    row_image,
)


def test_vocabularies():
    assert HEADER_SOURCES == frozenset({"ui", "repair"})
    # An undo is itself reversible (spec §9 UI: "an undo is itself reversible"), so `undo`
    # joins ui and repair here; summaries (import, restore) and derived writes (scheduler)
    # refuse with the summary sentence.
    assert UNDOABLE_SOURCES == frozenset({"ui", "repair", "undo"})
    assert CHANGE_BATCH_HEADER == "X-Change-Batch"


async def test_images_use_the_export_spellings(db):
    snapshot = NetWorthSnapshot(month=date(2026, 9, 1), recorded_on=date(2026, 9, 3))
    account = Account(name="Brokerage", slug="brokerage", group="taxable", sort_order=1)
    db.add_all([snapshot, account])
    await db.flush()
    balance = AccountBalance(snapshot_id=snapshot.id, account_id=account.id, balance=Decimal("1500.00"))
    db.add(balance)
    await db.flush()
    assert pk_of(balance) == {"id": balance.id}
    assert row_image(balance) == {
        "id": balance.id,
        "snapshot_id": snapshot.id,
        "account_id": account.id,
        "balance": "1500.00",
    }
    assert row_image(snapshot)["month"] == "2026-09-01"
    assert row_image(snapshot)["recorded_on"] == "2026-09-03"


async def test_batch_records_insert_update_delete_and_skips_unchanged(db):
    account = Account(name="Brokerage", slug="brokerage", group="taxable", sort_order=1)
    db.add(account)
    await db.flush()
    batch = ChangeBatch(db, source="ui", actor="me@example.com")
    batch.record_insert(account)
    before = row_image(account)
    account.sort_order = 2
    batch.record_update(account, before, month=date(2026, 9, 1))
    batch.record_update(account, row_image(account))  # unchanged pair: nothing recorded
    batch.label = "Created account Brokerage"
    batch.month = date(2026, 8, 1)  # the default month for rows that named none
    assert batch.rows == 2
    batch_id = await batch.commit()
    assert batch_id == batch.id
    rows = (await db.execute(select(ChangeLog).order_by(ChangeLog.id))).scalars().all()
    assert [(r.op, r.table_name, r.month) for r in rows] == [
        ("insert", "accounts", date(2026, 8, 1)),
        ("update", "accounts", date(2026, 9, 1)),
    ]
    assert rows[0].before is None and rows[0].after["slug"] == "brokerage"
    assert rows[1].before["sort_order"] == 1 and rows[1].after["sort_order"] == 2
    assert {r.batch_id for r in rows} == {batch_id}
    assert {r.label for r in rows} == {"Created account Brokerage"}
    assert {r.actor for r in rows} == {"me@example.com"}
    assert rows[0].at == rows[1].at  # one stamp per batch
    # The write itself was committed by the same call.
    assert (await db.execute(select(Account.sort_order))).scalar_one() == 2


async def test_commit_with_nothing_recorded_still_commits_and_returns_none(db):
    account = Account(name="A", slug="a", group="cash", sort_order=1)
    db.add(account)
    batch = ChangeBatch(db)
    batch.label = "Saved Sep 2026 balances — 0 updated"
    assert await batch.commit() is None
    assert (await db.execute(select(Account))).scalar_one().slug == "a"
    assert (await db.execute(select(ChangeLog))).scalars().all() == []


async def test_record_delete_carries_the_before_image(db):
    account = Account(name="A", slug="a", group="cash", sort_order=1)
    db.add(account)
    await db.flush()
    batch = ChangeBatch(db)
    batch.record_delete(account)
    await db.delete(account)
    batch.label = "Deleted account A"
    await batch.commit()
    row = (await db.execute(select(ChangeLog))).scalar_one()
    assert row.op == "delete" and row.after is None and row.before["name"] == "A"


def test_batch_header_is_absent_when_nothing_changed():
    assert batch_header(None) == {}
    from uuid import UUID

    assert batch_header(UUID("0b2f5c1e-1111-4222-8333-444455556666")) == {
        "X-Change-Batch": "0b2f5c1e-1111-4222-8333-444455556666"
    }
```

- [ ] **Step 2: Run to verify they fail**

Run: `FINANCE_TEST_DB=finance_test_l2 <venv-python> -m pytest tests/test_changelog_service.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.changelog'`.

- [ ] **Step 3: Write the service (capture half)**

```python
# backend/app/services/changelog.py
"""Application-level change capture and undo (2026-09-03 data-lifecycle spec §9).

A ChangeBatch is request-scoped (Depends(change_batch)): the router records row images
around each write it makes, sets a label, and calls `await batch.commit()` IN PLACE OF
`await db.commit()` — the change-log rows land in the same transaction as the writes they
describe. Images are the export's own JSON spellings (services.snapshot.json_row), so an
undo replays them through parse_cell exactly as a restore would.

Triggers were considered — they catch every writer including psql — and rejected: the test
schema is create_all, not Alembic, so trigger DDL would need a metadata hook to exist in
tests, and a trigger cannot know the label or the month. An explicit service on an
explicit list (pinned by test_changelog_pin) is the testable choice for a single-user app.

Undo (undo_batch) replays a batch's inverses in reverse order in one transaction and is
itself a batch (source='undo') plus an `undo` run whose report links `undid`, which is how
"already undone" and the listing's `undone_by` are answered.
"""

import json
import logging
from datetime import UTC, date, datetime
from uuid import UUID, uuid4

from fastapi import Depends, Request
from sqlalchemy import and_, delete, insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import Base, get_db
from app.models import ChangeLog, LifecycleRun, User
from app.services.snapshot import json_cell, json_row, parse_cell

logger = logging.getLogger(__name__)

CHANGE_BATCH_HEADER = "X-Change-Batch"
CHANGE_SOURCE_HEADER = "X-Change-Source"
# What a client may CLAIM as the source: the health card's repair delete says `repair`;
# anything else — including nothing — is `ui`.
HEADER_SOURCES = frozenset({"ui", "repair"})
# What undo accepts: row-level batches from the UI, a repair, or an earlier undo. Summary
# batches (import, restore) and derived writes (scheduler) refuse with SUMMARY_REFUSAL.
UNDOABLE_SOURCES = frozenset({"ui", "repair", "undo"})

SUMMARY_REFUSAL = "This change is a summary and cannot be undone — restore a snapshot instead"
OVERLAP_REFUSAL = "Later changes touched these rows — undo those first"
ALREADY_UNDONE = "This change was already undone"


def pk_of(obj: object) -> dict[str, object]:
    return {
        column.key: json_cell(getattr(obj, column.key))
        for column in obj.__table__.primary_key.columns
    }


def row_image(obj: object) -> dict[str, object]:
    """The export's JSON spelling of one ORM row (json_row) — before/after images."""
    return json_row(obj)


def batch_header(batch_id: UUID | None) -> dict[str, str]:
    """Headers for a 204 that wrote a batch — the two month DELETEs. Empty when nothing
    changed, so the client reads `null` and offers no Undo."""
    return {} if batch_id is None else {CHANGE_BATCH_HEADER: str(batch_id)}


class ChangeBatch:
    def __init__(self, db: AsyncSession, *, source: str = "ui", actor: str | None = None) -> None:
        self.db = db
        self.id: UUID = uuid4()
        self.source = source
        self.actor = actor
        self.label = ""
        # Default month for rows recorded without one (the month PUT/DELETE set it once).
        self.month: date | None = None
        self._rows: list[ChangeLog] = []

    @property
    def rows(self) -> int:
        return len(self._rows)

    def record(
        self,
        table_name: str,
        pk: dict[str, object],
        before: dict[str, object] | None,
        after: dict[str, object] | None,
        *,
        month: date | None = None,
    ) -> None:
        """One changed row. An unchanged image pair records nothing — an all-unchanged PUT
        is not a change, and a batch with no rows commits no log."""
        if before == after:
            return
        op = "insert" if before is None else "delete" if after is None else "update"
        self._rows.append(
            ChangeLog(
                batch_id=self.id,
                source=self.source,
                actor=self.actor,
                label="",
                table_name=table_name,
                pk=pk,
                op=op,
                before=before,
                after=after,
                month=month,
            )
        )

    def record_insert(self, obj: object, *, month: date | None = None) -> None:
        """Call AFTER a flush — the image needs the generated id."""
        self.record(obj.__tablename__, pk_of(obj), None, row_image(obj), month=month)

    def record_update(self, obj: object, before: dict[str, object], *, month: date | None = None) -> None:
        """`before` is row_image(obj) taken BEFORE the mutation."""
        self.record(obj.__tablename__, pk_of(obj), before, row_image(obj), month=month)

    def record_delete(self, obj: object, *, month: date | None = None) -> None:
        """Call BEFORE db.delete — the image needs the row."""
        self.record(obj.__tablename__, pk_of(obj), row_image(obj), None, month=month)

    async def commit(self) -> UUID | None:
        """Add the recorded rows with the final label and ONE stamp, then commit the
        session — the single commit a logged route makes. Returns the batch id, or None
        when nothing was recorded (the client then offers no Undo)."""
        if self._rows:
            stamp = datetime.now(UTC)
            for row in self._rows:
                row.label = self.label
                row.at = stamp
                if row.month is None:
                    row.month = self.month
            self.db.add_all(self._rows)
        await self.db.commit()
        return self.id if self._rows else None


async def change_batch(
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ChangeBatch:
    """The request's batch. FastAPI caches get_current_user per request, so the router-level
    auth dependency and this one share a single lookup."""
    claimed = request.headers.get(CHANGE_SOURCE_HEADER, "ui").strip().lower()
    return ChangeBatch(db, source=claimed if claimed in HEADER_SOURCES else "ui", actor=user.email)
```

(The undo half — `UndoRefused`, `undone_by`, `undo_batch` — is Task 5; the `json`, `logging`, `and_/delete/insert/update`, `Base`, `LifecycleRun`, `parse_cell` imports serve it. If you commit before Task 5, trim them for ruff and re-add then.)

- [ ] **Step 4: Run the tests**

Run: `FINANCE_TEST_DB=finance_test_l2 <venv-python> -m pytest tests/test_changelog_service.py -q`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/changelog.py backend/tests/test_changelog_service.py
git commit -m "feat(changelog): ChangeBatch capture, request dependency, X-Change-Batch header helper"
```

---

### Task 2: Hooks — net worth months PUT/DELETE, accounts POST/PATCH/DELETE

**Files:**
- Modify: `backend/app/api/net_worth.py`
- Test: `backend/tests/test_changelog_routes.py`

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_changelog_routes.py
from datetime import date
from decimal import Decimal

from sqlalchemy import select

from app.models import (
    Account,
    AccountBalance,
    CategoryBudget,
    ChangeLog,
    MonthlyCashflow,
    MonthlySpending,
    NetWorthSnapshot,
    SpendingCategory,
)

NW = "/api/v1/net-worth"
SP = "/api/v1/spending"


async def rows(db, batch_id: str) -> list[ChangeLog]:
    return list(
        (
            await db.execute(
                select(ChangeLog).where(ChangeLog.batch_id == batch_id).order_by(ChangeLog.id)
            )
        )
        .scalars()
        .all()
    )


async def two_accounts(db) -> tuple[Account, Account]:
    a = Account(name="Checking", slug="checking", group="cash", sort_order=1)
    b = Account(name="Brokerage", slug="brokerage", group="taxable", sort_order=2)
    db.add_all([a, b])
    await db.commit()
    return a, b


# ── net worth months ─────────────────────────────────────────────────────────────────


async def test_month_put_logs_the_created_snapshot_and_its_balances(auth_client, db):
    a, b = await two_accounts(db)
    resp = await auth_client.put(
        f"{NW}/months/2026-09-01",
        json={"balances": [{"account_id": a.id, "balance": "100.00"}, {"account_id": b.id, "balance": "250.50"}]},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["snapshot_created"] is True and body["batch_id"] is not None
    logged = await rows(db, body["batch_id"])
    assert [(r.op, r.table_name) for r in logged] == [
        ("insert", "net_worth_snapshots"),
        ("insert", "account_balances"),
        ("insert", "account_balances"),
    ]
    assert {r.month for r in logged} == {date(2026, 9, 1)}
    assert {r.label for r in logged} == {"Entered Sep 2026 balances — 2 accounts"}
    assert {r.source for r in logged} == {"ui"} and {r.actor for r in logged} == {"me@example.com"}
    assert logged[2].after["balance"] == "250.50"


async def test_month_put_logs_only_changed_balances_and_nothing_when_unchanged(auth_client, db):
    a, b = await two_accounts(db)
    first = await auth_client.put(
        f"{NW}/months/2026-09-01",
        json={"balances": [{"account_id": a.id, "balance": "100.00"}, {"account_id": b.id, "balance": "250.50"}]},
    )
    second = await auth_client.put(
        f"{NW}/months/2026-09-01",
        json={"balances": [{"account_id": a.id, "balance": "100.00"}, {"account_id": b.id, "balance": "300.00"}]},
    )
    body = second.json()
    assert body["updated"] == 1 and body["batch_id"] not in (None, first.json()["batch_id"])
    logged = await rows(db, body["batch_id"])
    assert len(logged) == 1
    assert (logged[0].op, logged[0].before["balance"], logged[0].after["balance"]) == ("update", "250.50", "300.00")
    assert logged[0].label == "Saved Sep 2026 balances — 1 updated"
    # Meta-only edits (recorded_on, notes) are not logged (spec §9: "changed balances and a
    # created snapshot only"), and an all-unchanged PUT records nothing at all.
    third = await auth_client.put(
        f"{NW}/months/2026-09-01",
        json={"notes": "checked twice", "balances": [{"account_id": a.id, "balance": "100.00"}, {"account_id": b.id, "balance": "300.00"}]},
    )
    assert third.json()["batch_id"] is None
    assert (await db.execute(select(NetWorthSnapshot))).scalar_one().notes == "checked twice"


async def test_month_delete_logs_balances_then_snapshot_and_answers_the_header(auth_client, db):
    a, b = await two_accounts(db)
    await auth_client.put(
        f"{NW}/months/2026-09-01",
        json={"balances": [{"account_id": a.id, "balance": "100.00"}, {"account_id": b.id, "balance": "250.50"}]},
    )
    resp = await auth_client.delete(f"{NW}/months/2026-09-01")
    assert resp.status_code == 204
    batch_id = resp.headers["x-change-batch"]
    logged = await rows(db, batch_id)
    # Children first, parent LAST: the undo replays in reverse, so the snapshot comes back
    # before the balances that point at it.
    assert [(r.op, r.table_name) for r in logged] == [
        ("delete", "account_balances"),
        ("delete", "account_balances"),
        ("delete", "net_worth_snapshots"),
    ]
    assert logged[2].before["month"] == "2026-09-01"
    assert {r.label for r in logged} == {"Deleted Sep 2026 balances"}
    assert (await db.execute(select(AccountBalance))).scalars().all() == []


# ── accounts ─────────────────────────────────────────────────────────────────────────


async def test_account_create_update_delete_are_logged(auth_client, db):
    created = await auth_client.post(f"{NW}/accounts", json={"name": "Brokerage", "group": "taxable"})
    assert created.status_code == 201, created.text
    account_id = created.json()["id"]
    patched = await auth_client.patch(f"{NW}/accounts/{account_id}", json={"sort_order": 5, "is_active": False})
    assert patched.status_code == 200
    noop = await auth_client.patch(f"{NW}/accounts/{account_id}", json={"sort_order": 5})
    assert noop.status_code == 200
    deleted = await auth_client.delete(f"{NW}/accounts/{account_id}")
    assert deleted.status_code == 204
    logged = (await db.execute(select(ChangeLog).order_by(ChangeLog.id))).scalars().all()
    assert [(r.op, r.label) for r in logged] == [
        ("insert", "Created account Brokerage"),
        ("update", "Updated account Brokerage"),
        ("delete", "Deleted account Brokerage"),
    ]
    assert len({r.batch_id for r in logged}) == 3  # one batch per request; the no-op PATCH logged none
    assert logged[1].before["sort_order"] == 0 and logged[1].after["sort_order"] == 5
    assert logged[1].after["is_active"] is False
    assert logged[2].before["slug"] == "brokerage" and logged[2].after is None
    assert {r.month for r in logged} == {None}
```

- [ ] **Step 2: Run to verify they fail**

Run: `FINANCE_TEST_DB=finance_test_l2 <venv-python> -m pytest tests/test_changelog_routes.py -q`
Expected: FAIL — `batch_id` is `None` in the bodies, no `x-change-batch` header, no `ChangeLog` rows.

- [ ] **Step 3: Hook the router**

In `backend/app/api/net_worth.py`:

Add the import `from app.services.changelog import ChangeBatch, batch_header, change_batch, row_image`.

`create_account`:

```python
@router.post("/accounts", response_model=AccountOut, status_code=201)
async def create_account(
    body: AccountCreate,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> Account:
    # …unchanged validation and construction…
    db.add(account)
    await db.flush()
    batch.record_insert(account)
    batch.label = f"Created account {account.name}"
    await batch.commit()
    return account
```

`update_account`: add `batch: ChangeBatch = Depends(change_batch)` to the signature; replace the tail

```python
    before = row_image(account)
    for field, value in updates.items():
        setattr(account, field, value)
    batch.record_update(account, before)
    batch.label = f"Updated account {account.name}"
    await batch.commit()
    return account
```

`delete_account`: add the dependency; replace the tail

```python
    batch.record_delete(account)
    batch.label = f"Deleted account {account.name}"
    await db.delete(account)
    await batch.commit()
    return Response(status_code=204, headers=batch_header(batch.id if batch.rows else None))
```

`put_month`: add `batch: ChangeBatch = Depends(change_batch)`; in the create branch, after `await db.flush()` add `batch.record_insert(snapshot, month=month)`; replace the balances loop and the tail:

```python
    created = updated = unchanged = 0
    new_rows: list[AccountBalance] = []
    for account_id, value in quantized.items():
        row = existing.get(account_id)
        if row is None:
            row = AccountBalance(snapshot_id=snapshot.id, account_id=account_id, balance=value)
            db.add(row)
            new_rows.append(row)
            created += 1
        elif row.balance != value:
            before = row_image(row)
            row.balance = value
            batch.record_update(row, before, month=month)
            updated += 1
        else:
            unchanged += 1
    if new_rows:
        await db.flush()  # ids for the insert images
        for row in new_rows:
            batch.record_insert(row, month=month)
    # Meta-only edits (recorded_on, notes) are deliberately not logged (spec §9).
    batch.label = (
        f"Entered {month:%b %Y} balances — {created} accounts"
        if snapshot_created
        else f"Saved {month:%b %Y} balances — {created + updated} updated"
    )
    batch_id = await batch.commit()
    return MonthUpsertResult(
        month=month,
        snapshot_created=snapshot_created,
        created=created,
        updated=updated,
        unchanged=unchanged,
        batch_id=batch_id,
    )
```

`delete_month`: add the dependency; replace from the `if snapshot is None` check downward:

```python
    if snapshot is None:
        raise HTTPException(status_code=404, detail="no snapshot exists for this month")
    balances = (
        (
            await db.execute(
                select(AccountBalance)
                .where(AccountBalance.snapshot_id == snapshot.id)
                .order_by(AccountBalance.id)
            )
        )
        .scalars()
        .all()
    )
    # Explicit ORM deletes rather than the FK cascade alone, so every row is IMAGED and the
    # session holds no stale instances. Children first, parent LAST: undo replays in reverse.
    for row in balances:
        batch.record_delete(row, month=month)
        await db.delete(row)
    batch.record_delete(snapshot, month=month)
    await db.delete(snapshot)
    batch.label = f"Deleted {month:%b %Y} balances"
    batch_id = await batch.commit()
    return Response(status_code=204, headers=batch_header(batch_id))
```

- [ ] **Step 4: Run the tests**

Run: `FINANCE_TEST_DB=finance_test_l2 <venv-python> -m pytest tests/test_changelog_routes.py tests/test_net_worth_api.py -q`
Expected: all passed (the existing net-worth tests still hold — bodies gained a `batch_id` key; if one compares a whole body with `==`, add `"batch_id": ANY`/the value).

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/net_worth.py backend/tests/test_changelog_routes.py
git commit -m "feat(net-worth): change batches on months PUT/DELETE and accounts POST/PATCH/DELETE"
```

---

### Task 3: Hooks — spending months PUT/DELETE, categories, budgets; the repair source

**Files:**
- Modify: `backend/app/api/spending.py`
- Test: `backend/tests/test_changelog_routes.py` (append)

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_changelog_routes.py`:

```python
# ── spending months ──────────────────────────────────────────────────────────────────


async def two_categories(db) -> tuple[SpendingCategory, SpendingCategory]:
    food = SpendingCategory(name="Food", slug="food", sort_order=1)
    rent = SpendingCategory(name="Rent", slug="rent", sort_order=2)
    db.add_all([food, rent])
    await db.commit()
    return food, rent


async def test_spending_put_logs_rows_and_cashflow(auth_client, db):
    food, rent = await two_categories(db)
    resp = await auth_client.put(
        f"{SP}/months/2026-09-01",
        json={"net_pay": "5000.00", "amounts": [{"category_id": food.id, "amount": "400.00"}, {"category_id": rent.id, "amount": "1800.00"}]},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    logged = await rows(db, body["batch_id"])
    assert sorted((r.op, r.table_name) for r in logged) == [
        ("insert", "monthly_cashflow"),
        ("insert", "monthly_spending"),
        ("insert", "monthly_spending"),
    ]
    assert {r.label for r in logged} == {"Saved Sep 2026 spending — 2 updated, take-home set"}
    cashflow = next(r for r in logged if r.table_name == "monthly_cashflow")
    assert cashflow.pk == {"month": "2026-09-01"} and cashflow.after["net_pay"] == "5000.00"

    cleared = await auth_client.put(
        f"{SP}/months/2026-09-01",
        json={"net_pay": None, "amounts": [{"category_id": food.id, "amount": "450.00"}, {"category_id": rent.id, "amount": "1800.00"}]},
    )
    logged = await rows(db, cleared.json()["batch_id"])
    assert sorted((r.op, r.table_name) for r in logged) == [
        ("delete", "monthly_cashflow"),
        ("update", "monthly_spending"),
    ]
    assert {r.label for r in logged} == {"Saved Sep 2026 spending — 1 updated, take-home cleared"}
    unchanged = await auth_client.put(
        f"{SP}/months/2026-09-01",
        json={"amounts": [{"category_id": food.id, "amount": "450.00"}, {"category_id": rent.id, "amount": "1800.00"}]},
    )
    assert unchanged.json()["batch_id"] is None


async def test_spending_delete_logs_everything_and_honours_the_repair_source(auth_client, db):
    food, rent = await two_categories(db)
    await auth_client.put(
        f"{SP}/months/2026-09-01",
        json={"net_pay": "5000.00", "amounts": [{"category_id": food.id, "amount": "0.00"}, {"category_id": rent.id, "amount": "0.00"}]},
    )
    resp = await auth_client.delete(f"{SP}/months/2026-09-01", headers={"X-Change-Source": "repair"})
    assert resp.status_code == 204
    logged = await rows(db, resp.headers["x-change-batch"])
    assert sorted((r.op, r.table_name) for r in logged) == [
        ("delete", "monthly_cashflow"),
        ("delete", "monthly_spending"),
        ("delete", "monthly_spending"),
    ]
    assert {r.source for r in logged} == {"repair"}  # the health card's repair (spec §11)
    assert {r.label for r in logged} == {"Deleted Sep 2026 spending"}
    assert (await db.execute(select(MonthlySpending))).scalars().all() == []
    assert (await db.execute(select(MonthlyCashflow))).scalars().all() == []


async def test_a_bogus_claimed_source_reads_as_ui(auth_client, db):
    created = await auth_client.post(f"{SP}/categories", json={"name": "Fun"}, headers={"X-Change-Source": "scheduler"})
    assert created.status_code == 201
    logged = (await db.execute(select(ChangeLog))).scalars().all()
    assert [(r.source, r.label) for r in logged] == [("ui", "Created category Fun")]


# ── categories and budgets ───────────────────────────────────────────────────────────


async def test_category_and_budget_paths_are_logged(auth_client, db):
    created = await auth_client.post(f"{SP}/categories", json={"name": "Fun"})
    category_id = created.json()["id"]
    await auth_client.patch(f"{SP}/categories/{category_id}", json={"name": "Leisure"})
    set_budget = await auth_client.put(
        f"{SP}/categories/{category_id}/budget", json={"amount": "200.00", "effective_month": "2026-09-01"}
    )
    assert set_budget.status_code == 200
    rewrite = await auth_client.put(
        f"{SP}/categories/{category_id}/budget", json={"amount": "250.00", "effective_month": "2026-09-01"}
    )
    assert rewrite.status_code == 200
    removed = await auth_client.delete(f"{SP}/categories/{category_id}/budget/2026-09-01")
    assert removed.status_code == 204
    deleted = await auth_client.delete(f"{SP}/categories/{category_id}")
    assert deleted.status_code == 204
    logged = (await db.execute(select(ChangeLog).order_by(ChangeLog.id))).scalars().all()
    assert [(r.op, r.table_name, r.label, r.month) for r in logged] == [
        ("insert", "spending_categories", "Created category Fun", None),
        ("update", "spending_categories", "Updated category Leisure", None),
        ("insert", "category_budgets", "Set Leisure budget from Sep 2026", date(2026, 9, 1)),
        ("update", "category_budgets", "Set Leisure budget from Sep 2026", date(2026, 9, 1)),
        ("delete", "category_budgets", "Removed Leisure budget row for Sep 2026", date(2026, 9, 1)),
        ("delete", "spending_categories", "Deleted category Leisure", None),
    ]
    assert logged[3].before["amount"] == "200.00" and logged[3].after["amount"] == "250.00"
    assert (await db.execute(select(CategoryBudget))).scalars().all() == []
```

- [ ] **Step 2: Run to verify they fail**

Run: `FINANCE_TEST_DB=finance_test_l2 <venv-python> -m pytest tests/test_changelog_routes.py -q -k "spending or category or bogus"`
Expected: FAIL — no rows / no `batch_id`.

- [ ] **Step 3: Hook the router**

In `backend/app/api/spending.py` add `from app.services.changelog import ChangeBatch, batch_header, change_batch, row_image` and:

`create_category` — add `batch: ChangeBatch = Depends(change_batch)`; tail:

```python
    db.add(category)
    await db.flush()
    batch.record_insert(category)
    batch.label = f"Created category {category.name}"
    await batch.commit()
    return category
```

`update_category` — add the dependency; tail:

```python
    before = row_image(category)
    for field, value in updates.items():
        setattr(category, field, value)
    batch.record_update(category, before)
    batch.label = f"Updated category {category.name}"
    await batch.commit()
    return category
```

`delete_category` — add the dependency; tail:

```python
    batch.record_delete(category)
    batch.label = f"Deleted category {category.name}"
    await db.delete(category)
    await batch.commit()
    return Response(status_code=204, headers=batch_header(batch.id if batch.rows else None))
```

`put_category_budget` — add the dependency; replace the upsert and commit:

```python
    category = await _get_category(db, category_id)  # was a bare await; the label needs the name
    # …require_first_of_month / amount validation unchanged…
    existing = await _get_budget_row(db, category_id, body.effective_month)
    if existing is None:
        row = CategoryBudget(category_id=category_id, effective_month=body.effective_month, amount=amount)
        db.add(row)
        await db.flush()
        batch.record_insert(row, month=body.effective_month)
    else:
        before = row_image(existing)
        existing.amount = amount
        batch.record_update(existing, before, month=body.effective_month)
    batch.label = f"Set {category.name} budget from {body.effective_month:%b %Y}"
    await batch.commit()
    return await _budget_history(db, category_id)
```

`delete_category_budget` — add the dependency; `category = await _get_category(db, category_id)`; tail:

```python
    batch.record_delete(row, month=effective_month)
    batch.label = f"Removed {category.name} budget row for {effective_month:%b %Y}"
    await db.delete(row)
    await batch.commit()
    return Response(status_code=204, headers=batch_header(batch.id if batch.rows else None))
```

`put_month` — add the dependency; replace the write section and the tail:

```python
    created = updated = unchanged = 0
    new_rows: list[MonthlySpending] = []
    for category_id, value in quantized.items():
        row = existing.get(category_id)
        if row is None:
            row = MonthlySpending(month=month, category_id=category_id, amount=value)
            db.add(row)
            new_rows.append(row)
            created += 1
        elif row.amount != value:
            before = row_image(row)
            row.amount = value
            batch.record_update(row, before, month=month)
            updated += 1
        else:
            unchanged += 1
    if new_rows:
        await db.flush()
        for row in new_rows:
            batch.record_insert(row, month=month)
    net_pay_cleared = False
    net_pay_note = ""
    if net_pay_provided:
        cashflow = await db.get(MonthlyCashflow, month)
        if cashflow is None:
            cashflow = MonthlyCashflow(month=month, net_pay=net_pay_value)
            db.add(cashflow)
            await db.flush()
            batch.record_insert(cashflow, month=month)
        else:
            before = row_image(cashflow)
            cashflow.net_pay = net_pay_value
            batch.record_update(cashflow, before, month=month)
        net_pay_note = ", take-home set"
    elif net_pay_clear:
        cashflow = await db.get(MonthlyCashflow, month)
        if cashflow is not None:
            batch.record_delete(cashflow, month=month)
            await db.delete(cashflow)
            net_pay_cleared = True
            net_pay_note = ", take-home cleared"
    batch.label = f"Saved {month:%b %Y} spending — {created + updated} updated{net_pay_note}"
    batch_id = await batch.commit()
    return SpendingUpsertResult(
        month=month,
        created=created,
        updated=updated,
        unchanged=unchanged,
        net_pay_set=net_pay_provided,
        net_pay_cleared=net_pay_cleared,
        batch_id=batch_id,
    )
```

`delete_month` — add the dependency; tail:

```python
    for row in rows:
        batch.record_delete(row, month=month)
        await db.delete(row)
    if cashflow is not None:
        batch.record_delete(cashflow, month=month)
        await db.delete(cashflow)
    batch.label = f"Deleted {month:%b %Y} spending"
    batch_id = await batch.commit()
    return Response(status_code=204, headers=batch_header(batch_id))
```

- [ ] **Step 4: Run the tests**

Run: `FINANCE_TEST_DB=finance_test_l2 <venv-python> -m pytest tests/test_changelog_routes.py tests/test_spending_api.py -q`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/spending.py backend/tests/test_changelog_routes.py
git commit -m "feat(spending): change batches on months, categories and budgets; X-Change-Source: repair"
```

---

### Task 4: The grep pin

**Files:**
- Test: `backend/tests/test_changelog_pin.py`

- [ ] **Step 1: Write the pin (it passes now and FAILS on the next unlisted write path — that is the point)**

```python
# backend/tests/test_changelog_pin.py
"""The change-log's hand-maintained path list (2026-09-03 data-lifecycle spec §9), pinned
the way EXPORTED_TABLES is: every route in the two money-bearing routers that commits must
either be listed as LOGGED (and commit THROUGH its ChangeBatch) or be named EXEMPT with a
reason. A new write path lands here red until someone decides — that decision is the
feature. Exempt today: nothing."""

import ast
from pathlib import Path

API = Path(__file__).resolve().parents[1] / "app" / "api"

LOGGED: dict[str, set[str]] = {
    "net_worth.py": {"create_account", "update_account", "delete_account", "put_month", "delete_month"},
    "spending.py": {
        "create_category",
        "update_category",
        "delete_category",
        "put_category_budget",
        "delete_category_budget",
        "put_month",
        "delete_month",
    },
}
EXEMPT: dict[str, dict[str, str]] = {}  # module -> {function: reason}


def _committing_functions(source: str):
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.AsyncFunctionDef | ast.FunctionDef):
            body = ast.get_source_segment(source, node) or ""
            if "db.commit(" in body or "batch.commit(" in body:
                yield node.name, body


def test_every_write_path_in_the_two_routers_is_logged_or_exempt():
    for module, expected in LOGGED.items():
        source = (API / module).read_text(encoding="utf-8")
        seen: set[str] = set()
        for name, body in _committing_functions(source):
            seen.add(name)
            if name in EXEMPT.get(module, {}):
                continue
            assert name in expected, f"{module}:{name} commits but is neither logged nor exempt"
            assert "batch.commit(" in body and "db.commit(" not in body, (
                f"{module}:{name} must commit through its ChangeBatch, not db.commit()"
            )
        assert expected <= seen, f"{module}: listed paths missing or no longer writing: {expected - seen}"


def test_exempt_entries_name_a_reason():
    for module, entries in EXEMPT.items():
        for name, reason in entries.items():
            assert reason.strip(), f"{module}:{name} is exempt without a reason"
```

- [ ] **Step 2: Run it — and prove it bites**

Run: `FINANCE_TEST_DB=finance_test_l2 <venv-python> -m pytest tests/test_changelog_pin.py -q` → 2 passed.
Then temporarily change `await batch.commit()` back to `await db.commit()` in `delete_category` and re-run → FAIL naming `spending.py:delete_category`. Revert.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_changelog_pin.py
git commit -m "test(changelog): pin the logged write paths against the two routers' source"
```

---

### Task 5: Undo, and the Activity router

**Files:**
- Modify: `backend/app/services/changelog.py` (append the undo half), `backend/app/main.py`
- Create: `backend/app/api/activity.py`
- Test: `backend/tests/test_activity_api.py`

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_activity_api.py
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy import select

from app.models import Account, AccountBalance, ChangeLog, LifecycleRun, NetWorthSnapshot
from app.services.changelog import ALREADY_UNDONE, OVERLAP_REFUSAL, SUMMARY_REFUSAL

ACTIVITY = "/api/v1/activity"
NW = "/api/v1/net-worth"


async def make_account(db, name="Checking", slug="checking") -> Account:
    account = Account(name=name, slug=slug, group="cash", sort_order=1)
    db.add(account)
    await db.commit()
    return account


async def save_month(auth_client, account_id: int, balance: str) -> str:
    resp = await auth_client.put(
        f"{NW}/months/2026-09-01", json={"balances": [{"account_id": account_id, "balance": balance}]}
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["batch_id"]


async def test_activity_requires_auth(client):
    assert (await client.get(ACTIVITY)).status_code == 401
    assert (await client.post(f"{ACTIVITY}/batches/{uuid4()}/undo")).status_code == 401


async def test_activity_lists_batches_and_runs_newest_first_with_paging(auth_client, db):
    account = await make_account(db)
    first = await save_month(auth_client, account.id, "100.00")
    db.add(LifecycleRun(kind="snapshot", ok=True, filename="finance-export-20260904-233000.zip", size_bytes=2048, at=datetime.now(UTC) + timedelta(seconds=1)))
    await db.commit()
    second = await save_month(auth_client, account.id, "150.00")

    body = (await auth_client.get(ACTIVITY)).json()
    assert [e["type"] for e in body["entries"]] == ["batch", "run", "batch"]
    newest, run, oldest = body["entries"]
    assert newest["batch_id"] == second and oldest["batch_id"] == first
    assert newest["label"] == "Saved Sep 2026 balances — 1 updated"
    assert newest["rows"] == 1 and newest["undoable"] is True and newest["undone_by"] is None
    assert newest["source"] == "ui" and newest["actor"] == "me@example.com" and newest["month"] == "2026-09-01"
    assert run["kind"] == "snapshot" and run["has_report"] is False and run["size_bytes"] == 2048
    assert body["next_before"] is None

    page = (await auth_client.get(f"{ACTIVITY}?limit=2")).json()
    assert [e["type"] for e in page["entries"]] == ["batch", "run"]
    assert page["next_before"] == run["at"]
    rest = (await auth_client.get(f"{ACTIVITY}?limit=2&before={page['next_before']}")).json()
    assert [e.get("batch_id") for e in rest["entries"]] == [first]
    assert rest["next_before"] is None


async def test_activity_run_detail_returns_the_stored_report(auth_client, db):
    run = LifecycleRun(kind="restore", ok=True, filename="sep2.zip", report={"applied": True, "tables": {}})
    db.add(run)
    await db.commit()
    body = (await auth_client.get(f"{ACTIVITY}/runs/{run.id}")).json()
    assert body["run"]["kind"] == "restore" and body["run"]["has_report"] is True
    assert body["report"] == {"applied": True, "tables": {}}
    assert (await auth_client.get(f"{ACTIVITY}/runs/999")).status_code == 404


async def test_undo_a_month_save_removes_the_snapshot_and_is_itself_a_batch(auth_client, db):
    account = await make_account(db)
    batch_id = await save_month(auth_client, account.id, "100.00")
    resp = await auth_client.post(f"{ACTIVITY}/batches/{batch_id}/undo")
    assert resp.status_code == 200, resp.text
    undo = resp.json()
    assert undo["type"] == "batch" and undo["source"] == "undo"
    assert undo["label"] == "Undid: Entered Sep 2026 balances — 1 accounts"
    assert undo["rows"] == 2 and undo["undoable"] is True and undo["month"] == "2026-09-01"
    assert (await db.execute(select(NetWorthSnapshot))).scalars().all() == []
    assert (await db.execute(select(AccountBalance))).scalars().all() == []
    listing = (await auth_client.get(ACTIVITY)).json()["entries"]
    original = next(e for e in listing if e.get("batch_id") == batch_id)
    assert original["undoable"] is False and original["undone_by"] == undo["batch_id"]
    runs = [e for e in listing if e["type"] == "run"]
    assert [r["kind"] for r in runs] == ["undo"]
    detail = (await auth_client.get(f"{ACTIVITY}/runs/{runs[0]['run_id']}")).json()
    assert detail["report"]["undid"] == batch_id


async def test_undo_a_month_delete_brings_the_rows_back_with_their_ids(auth_client, db):
    account = await make_account(db)
    await save_month(auth_client, account.id, "100.00")
    snapshot_id = (await db.execute(select(NetWorthSnapshot.id))).scalar_one()
    deleted = await auth_client.delete(f"{NW}/months/2026-09-01")
    batch_id = deleted.headers["x-change-batch"]
    resp = await auth_client.post(f"{ACTIVITY}/batches/{batch_id}/undo")
    assert resp.status_code == 200, resp.text
    snapshot = (await db.execute(select(NetWorthSnapshot))).scalar_one()
    assert snapshot.id == snapshot_id and snapshot.month.isoformat() == "2026-09-01"
    balance = (await db.execute(select(AccountBalance))).scalar_one()
    assert str(balance.balance) == "100.00" and balance.snapshot_id == snapshot_id


async def test_undo_an_account_edit_reverts_it(auth_client, db):
    account = await make_account(db, "Brokerage", "brokerage")
    patched = await auth_client.patch(f"{NW}/accounts/{account.id}", json={"name": "Brokerage (old)", "sort_order": 9})
    assert patched.status_code == 200
    batch_id = (await db.execute(select(ChangeLog.batch_id))).scalar_one()
    resp = await auth_client.post(f"{ACTIVITY}/batches/{batch_id}/undo")
    assert resp.status_code == 200, resp.text
    row = (await auth_client.get(f"{NW}/accounts")).json()[0]
    assert (row["name"], row["sort_order"]) == ("Brokerage", 1)


async def test_the_three_refusals_and_undo_of_undo(auth_client, db):
    account = await make_account(db)
    first = await save_month(auth_client, account.id, "100.00")
    # A summary batch (a restore) refuses.
    db.add(ChangeLog(batch_id=uuid4(), source="restore", actor="x", label="Restored snapshot", table_name="*", pk={}, op="batch", before=None, after={"tables": {}}))
    await db.commit()
    summary_id = (await db.execute(select(ChangeLog.batch_id).where(ChangeLog.op == "batch"))).scalar_one()
    summary = await auth_client.post(f"{ACTIVITY}/batches/{summary_id}/undo")
    assert summary.status_code == 409 and summary.json()["detail"] == SUMMARY_REFUSAL
    # A later batch on the same rows refuses.
    second = await save_month(auth_client, account.id, "150.00")
    overlap = await auth_client.post(f"{ACTIVITY}/batches/{first}/undo")
    assert overlap.status_code == 409 and overlap.json()["detail"] == OVERLAP_REFUSAL
    # The latest batch undoes; undoing it again refuses as already undone.
    undone = await auth_client.post(f"{ACTIVITY}/batches/{second}/undo")
    assert undone.status_code == 200, undone.text
    again = await auth_client.post(f"{ACTIVITY}/batches/{second}/undo")
    assert again.status_code == 409 and again.json()["detail"] == ALREADY_UNDONE
    assert str((await db.execute(select(AccountBalance.balance))).scalar_one()) == "100.00"
    # Undo of the undo: the balance goes back to 150.
    redo = await auth_client.post(f"{ACTIVITY}/batches/{undone.json()['batch_id']}/undo")
    assert redo.status_code == 200, redo.text
    assert redo.json()["label"] == "Undid: Undid: Saved Sep 2026 balances — 1 updated"
    assert str((await db.execute(select(AccountBalance.balance))).scalar_one()) == "150.00"
    # Unknown batch.
    assert (await auth_client.post(f"{ACTIVITY}/batches/{uuid4()}/undo")).status_code == 404
```

- [ ] **Step 2: Run to verify they fail**

Run: `FINANCE_TEST_DB=finance_test_l2 <venv-python> -m pytest tests/test_activity_api.py -q`
Expected: FAIL — `ImportError` for the refusal sentences / 404s for the routes.

- [ ] **Step 3: Append the undo half to `services/changelog.py`**

```python
class UndoRefused(Exception):
    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


def _pk_key(table_name: str, pk: dict[str, object]) -> tuple[str, str]:
    return table_name, json.dumps(pk, sort_keys=True, separators=(",", ":"))


async def undone_by(db: AsyncSession, batch_ids: list[UUID]) -> dict[UUID, UUID]:
    """batch -> the undo batch that reversed it, read from the `undo` runs' reports."""
    if not batch_ids:
        return {}
    wanted = {str(batch_id): batch_id for batch_id in batch_ids}
    rows = (
        await db.execute(
            select(LifecycleRun.report, LifecycleRun.batch_id).where(
                LifecycleRun.kind == "undo", LifecycleRun.ok.is_(True)
            )
        )
    ).all()
    out: dict[UUID, UUID] = {}
    for report, undo_batch in rows:
        undid = (report or {}).get("undid")
        if isinstance(undid, str) and undid in wanted and undo_batch is not None:
            out[wanted[undid]] = undo_batch
    return out


async def undo_batch(db: AsyncSession, batch_id: UUID, *, actor: str | None) -> UUID:
    """Replay a batch's inverses in reverse order, in one transaction (spec §9): insert →
    delete, update → set `before`, delete → insert `before`. Refuses (409) a summary-only
    or non-undoable-source batch, an already-undone batch, and a batch whose rows a later
    batch touched. Records the replay as a new source='undo' batch plus an `undo` run.
    Expunges the session afterwards: Core statements bypass the identity map."""
    rows = list(
        (
            await db.execute(
                select(ChangeLog).where(ChangeLog.batch_id == batch_id).order_by(ChangeLog.id)
            )
        )
        .scalars()
        .all()
    )
    if not rows:
        raise UndoRefused(404, "No such change")
    row_level = [row for row in rows if row.op != "batch"]
    if rows[0].source not in UNDOABLE_SOURCES or not row_level:
        raise UndoRefused(409, SUMMARY_REFUSAL)
    if batch_id in await undone_by(db, [batch_id]):
        raise UndoRefused(409, ALREADY_UNDONE)
    keys = {_pk_key(row.table_name, row.pk) for row in row_level}
    later = (
        await db.execute(
            select(ChangeLog).where(
                ChangeLog.id > rows[-1].id,
                ChangeLog.table_name.in_({row.table_name for row in row_level}),
                ChangeLog.op != "batch",
            )
        )
    ).scalars()
    if any(_pk_key(row.table_name, row.pk) in keys for row in later):
        raise UndoRefused(409, OVERLAP_REFUSAL)

    undo = ChangeBatch(db, source="undo", actor=actor)
    undo.label = f"Undid: {rows[0].label}"
    undo.month = rows[0].month
    for row in reversed(row_level):
        table = Base.metadata.tables[row.table_name]
        where = and_(*[table.c[key] == parse_cell(table.c[key], value) for key, value in row.pk.items()])
        before = {
            key: parse_cell(table.c[key], value)
            for key, value in (row.before or {}).items()
            if key in table.c
        }
        if row.op == "insert":
            await db.execute(delete(table).where(where))
            undo.record(row.table_name, row.pk, row.after, None, month=row.month)
        elif row.op == "update":
            await db.execute(update(table).where(where).values(before))
            undo.record(row.table_name, row.pk, row.after, row.before, month=row.month)
        else:
            await db.execute(insert(table).values(before))
            undo.record(row.table_name, row.pk, None, row.before, month=row.month)
    db.add(
        LifecycleRun(
            kind="undo",
            ok=True,
            actor=actor,
            batch_id=undo.id,
            report={"undid": str(batch_id), "label": rows[0].label},
        )
    )
    new_id = await undo.commit()
    db.expunge_all()
    logger.info("undid batch %s as %s", batch_id, new_id)
    return new_id  # type: ignore[return-value]  # never None: row_level is non-empty
```

- [ ] **Step 4: Write the router and include it**

```python
# backend/app/api/activity.py
"""Activity — the change log and the run trail as one feed, with Undo (2026-09-03
data-lifecycle spec §9). Reads only, except the undo, which is a write like any other and
therefore its own batch. Paging is by instant: `before` is the previous page's
next_before — the two sources have separate id spaces, so a shared id cursor would not be
well-defined."""

from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models import ChangeLog, LifecycleRun, User
from app.schemas.lifecycle import ActivityBatchOut, ActivityOut, ActivityRunDetailOut, ActivityRunOut
from app.services.changelog import UNDOABLE_SOURCES, UndoRefused, undo_batch, undone_by

router = APIRouter(prefix="/activity", tags=["activity"], dependencies=[Depends(get_current_user)])


def _run_out(run: LifecycleRun) -> ActivityRunOut:
    return ActivityRunOut(
        run_id=run.id,
        at=run.at,
        kind=run.kind,
        ok=run.ok,
        dry_run=run.dry_run,
        filename=run.filename,
        size_bytes=run.size_bytes,
        has_report=run.report is not None,
    )


@router.get("", response_model=ActivityOut)
async def activity(
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    before: Annotated[datetime | None, Query()] = None,
    db: AsyncSession = Depends(get_db),
) -> ActivityOut:
    first_at = func.min(ChangeLog.at)
    batch_q = (
        select(
            ChangeLog.batch_id,
            first_at.label("at"),
            func.min(ChangeLog.source).label("source"),
            func.min(ChangeLog.actor).label("actor"),
            func.min(ChangeLog.label).label("label"),
            func.min(ChangeLog.month).label("month"),
            func.count().filter(ChangeLog.op != "batch").label("rows"),
        )
        .group_by(ChangeLog.batch_id)
        .order_by(first_at.desc())
        .limit(limit)
    )
    run_q = select(LifecycleRun).order_by(LifecycleRun.at.desc(), LifecycleRun.id.desc()).limit(limit)
    if before is not None:
        batch_q = batch_q.having(first_at < before)
        run_q = run_q.where(LifecycleRun.at < before)
    batches = (await db.execute(batch_q)).all()
    runs = (await db.execute(run_q)).scalars().all()
    undone = await undone_by(db, [b.batch_id for b in batches])
    entries: list[ActivityBatchOut | ActivityRunOut] = [
        ActivityBatchOut(
            batch_id=b.batch_id,
            at=b.at,
            source=b.source,
            actor=b.actor,
            label=b.label,
            month=b.month,
            rows=b.rows,
            undoable=b.source in UNDOABLE_SOURCES and b.rows > 0 and b.batch_id not in undone,
            undone_by=undone.get(b.batch_id),
        )
        for b in batches
    ]
    entries.extend(_run_out(run) for run in runs)
    entries.sort(key=lambda entry: entry.at, reverse=True)
    more = len(batches) + len(runs) > limit
    page = entries[:limit]
    return ActivityOut(entries=page, next_before=page[-1].at if more and page else None)


@router.get("/runs/{run_id}", response_model=ActivityRunDetailOut)
async def activity_run(run_id: int, db: AsyncSession = Depends(get_db)) -> ActivityRunDetailOut:
    run = await db.get(LifecycleRun, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="no such run")
    return ActivityRunDetailOut(run=_run_out(run), report=run.report)


@router.post("/batches/{batch_id}/undo", response_model=ActivityBatchOut)
async def undo(
    batch_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ActivityBatchOut:
    actor = user.email  # before undo_batch expunges the session
    try:
        new_id = await undo_batch(db, batch_id, actor=actor)
    except UndoRefused as exc:
        await db.rollback()
        raise HTTPException(status_code=exc.status, detail=exc.detail) from None
    rows = (
        (await db.execute(select(ChangeLog).where(ChangeLog.batch_id == new_id).order_by(ChangeLog.id)))
        .scalars()
        .all()
    )
    return ActivityBatchOut(
        batch_id=new_id,
        at=rows[0].at,
        source="undo",
        actor=actor,
        label=rows[0].label,
        month=rows[0].month,
        rows=len(rows),
        undoable=True,
        undone_by=None,
    )
```

In `backend/app/main.py` add `activity,` to the `from app.api import (...)` list (first, alphabetically before `app_settings`) and `app.include_router(activity.router, prefix="/api/v1")` after the `import_` include.

- [ ] **Step 5: Run the tests**

Run: `FINANCE_TEST_DB=finance_test_l2 <venv-python> -m pytest tests/test_activity_api.py tests/test_changelog_service.py -q`
Expected: all passed. If `func.count().filter(...)` errors, write it as `func.count(case((ChangeLog.op != "batch", 1)))` (import `case`).

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/changelog.py backend/app/api/activity.py backend/app/main.py backend/tests/test_activity_api.py
git commit -m "feat(activity): /activity feed with paging, run detail, and undo as inverse replay"
```

---

### Task 6: The import's trail — restore point, summary row, run record

**Files:**
- Modify: `backend/app/importer/service.py`, `backend/app/api/import_.py`
- Test: `backend/tests/test_import_trail.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_import_trail.py
from sqlalchemy import select

from app.importer.service import run_import
from app.models import ChangeLog, LifecycleRun
from app.services.snapshot import restore_points_dir
from tests.workbook_builder import build_workbook


async def test_apply_writes_a_restore_point_a_summary_row_and_a_run(db):
    report = await run_import(build_workbook(), db, dry_run=False, actor="me@example.com")
    assert report.applied is True
    assert len(list(restore_points_dir().iterdir())) == 1
    runs = (await db.execute(select(LifecycleRun).order_by(LifecycleRun.id))).scalars().all()
    assert [(r.kind, r.dry_run, r.ok, r.actor) for r in runs] == [
        ("restore_point", False, True, "me@example.com"),
        ("import_xlsx", False, True, "me@example.com"),
    ]
    assert runs[1].report["applied"] is True and "sheets" in runs[1].report
    row = (await db.execute(select(ChangeLog))).scalar_one()
    assert (row.op, row.source, row.table_name, row.actor) == ("batch", "import", "*", "me@example.com")
    assert row.batch_id == runs[1].batch_id
    assert row.label.startswith("Imported workbook — ") and row.label.endswith(" across 9 sheets")
    assert row.after["sheets"]["net_worth"]["accounts"]["creates"] == 3


async def test_dry_run_records_a_run_and_no_restore_point(db):
    report = await run_import(build_workbook(), db, dry_run=True)
    assert report.applied is False
    assert not restore_points_dir().exists()
    run = (await db.execute(select(LifecycleRun))).scalar_one()
    assert (run.kind, run.dry_run, run.ok, run.actor, run.batch_id) == ("import_xlsx", True, True, None, None)
    assert run.report["dry_run"] is True
    assert (await db.execute(select(ChangeLog))).scalars().all() == []


async def test_a_workbook_with_errors_records_a_failed_run_and_no_restore_point(db):
    from tests.workbook_builder import default_spending_rows

    rows = default_spending_rows()
    rows[0][1] = "Food"
    rows[0][2] = "Food"  # duplicate slug → a spending sheet error
    report = await run_import(build_workbook(spending_rows=rows), db, dry_run=False)
    assert report.has_errors and report.applied is False
    assert not restore_points_dir().exists()
    run = (await db.execute(select(LifecycleRun))).scalar_one()
    assert (run.kind, run.ok) == ("import_xlsx", False)


async def test_the_route_passes_the_actor(auth_client, db):
    resp = await auth_client.post(
        "/api/v1/import/xlsx?dry_run=false",
        files={"file": ("workbook.xlsx", build_workbook(), "application/octet-stream")},
    )
    assert resp.status_code == 200, resp.text
    runs = (await db.execute(select(LifecycleRun.actor))).scalars().all()
    assert set(runs) == {"me@example.com"}
```

(Check `build_workbook`'s keyword name for the spending sheet in `tests/workbook_builder.py` — the builder takes `**overrides` named after its `default_*_rows` functions; if the keyword is different, use the one that exists. If duplicating a header does not produce a sheet error, use any override the existing importer tests use to force one — `test_apply_spending_duplicate_slug_is_report_error` in `test_importer_apply.py` shows the exact recipe.)

- [ ] **Step 2: Run to verify it fails**

Run: `FINANCE_TEST_DB=finance_test_l2 <venv-python> -m pytest tests/test_import_trail.py -q`
Expected: FAIL — `run_import() got an unexpected keyword argument 'actor'`.

- [ ] **Step 3: Implement**

In `backend/app/importer/service.py`:

Add imports:

```python
from uuid import UUID, uuid4

from app.models import ChangeLog, LifecycleRun
from app.services.snapshot import write_restore_point
```

Add two helpers above `run_import`:

```python
def _import_counts(report: ImportReport) -> dict[str, dict[str, dict[str, int]]]:
    return {
        key: {
            entity: {"creates": c.creates, "updates": c.updates, "deletes": c.deletes}
            for entity, c in sheet.entities.items()
        }
        for key, sheet in report.sheets.items()
    }


def _summary_row(report: ImportReport, batch_id: UUID, actor: str | None) -> ChangeLog:
    """One op='batch' line for the whole apply (2026-09-03 data-lifecycle spec §9) — the
    per-row detail is the report's, stored on the run beside it."""
    counts = _import_counts(report)
    changes = sum(
        c.creates + c.updates + c.deletes
        for sheet in report.sheets.values()
        for c in sheet.entities.values()
    )
    return ChangeLog(
        batch_id=batch_id,
        source="import",
        actor=actor,
        label=f"Imported workbook — {changes} changes across {len(report.sheets)} sheets",
        table_name="*",
        pk={},
        op="batch",
        before=None,
        after={"sheets": counts},
        month=None,
    )


async def _record_run(
    db: AsyncSession, report: ImportReport, *, actor: str | None, batch_id: UUID | None
) -> None:
    """Every import — dry run, refused, applied — leaves a stored report (the card's report
    used to evaporate with React state). Its own commit: the apply's transaction is over."""
    db.add(
        LifecycleRun(
            kind="import_xlsx",
            dry_run=report.dry_run,
            ok=not report.has_errors,
            actor=actor,
            report=report.model_dump(mode="json"),
            batch_id=batch_id,
        )
    )
    await db.commit()
```

Change `run_import`'s signature and body:

```python
async def run_import(
    data: bytes, db: AsyncSession, *, dry_run: bool, actor: str | None = None
) -> ImportReport:
    report = ImportReport.new(dry_run=dry_run)
    workbook = _load_workbook(data)
    parsed: dict[str, object] = {}
    try:
        # …the parse loop, unchanged…
    finally:
        workbook.close()
    if report.has_errors:
        await _record_run(db, report, actor=actor, batch_id=None)
        return report  # strict: errors anywhere block the whole apply (spec section 5)

    if not dry_run:
        # "This cannot be undone" leaves the import card (2026-09-03 data-lifecycle spec §9):
        # the current database is kept first, as its own committed run.
        await write_restore_point(db, actor=actor)
    batch_id: UUID | None = None
    try:
        # …the appliers, unchanged…
        if report.has_errors or dry_run:  # apply_taxes can error on missing definitions
            await db.rollback()
        else:
            batch_id = uuid4()
            db.add(_summary_row(report, batch_id, actor))  # rides the apply's own commit
            await db.commit()
            report.applied = True
    except Exception:
        await db.rollback()
        raise
    await _record_run(db, report, actor=actor, batch_id=batch_id)
    return report
```

In `backend/app/api/import_.py`, `import_xlsx` passes the actor: `return await run_import(data, db, dry_run=dry_run, actor=user.email)`.

- [ ] **Step 4: Run the tests**

Run: `FINANCE_TEST_DB=finance_test_l2 <venv-python> -m pytest tests/test_import_trail.py tests/test_importer_service.py tests/test_import_api.py tests/test_importer_apply.py -q`
Expected: all passed (the existing importer tests are unaffected: the trail rows live in excluded tables and the restore points in the per-test tmp dir).

- [ ] **Step 5: Commit**

```bash
git add backend/app/importer/service.py backend/app/api/import_.py backend/tests/test_import_trail.py
git commit -m "feat(importer): pre-import restore point, summary change-log row, stored import_xlsx runs"
```

---

### Task 7: Lane suite, lint

- [ ] **Step 1: Run the lane's files plus neighbours**

Run (from `backend/`): `FINANCE_TEST_DB=finance_test_l2 <venv-python> -m pytest -q tests/test_changelog_service.py tests/test_changelog_routes.py tests/test_changelog_pin.py tests/test_activity_api.py tests/test_import_trail.py tests/test_net_worth_api.py tests/test_spending_api.py tests/test_importer_service.py && <venv-python> -m ruff check app tests && <venv-python> -m ruff format --check app tests`
Expected: all passed; ruff clean.

- [ ] **Step 2: Whole suite once**

Run: `FINANCE_TEST_DB=finance_test_l2 <venv-python> -m pytest -q` → all green.

---

## As shipped — the undo guards review added

Task 5's three refusals became five, and the Activity listing now agrees with the POST:

- **`refuse_when_depended_on(db, table, image)`** runs before every replayed DELETE. The replay is a bare Core `DELETE`, so Postgres — not the ORM — applies each FK's `ondelete`, and undoing an `insert` of a parent would silently CASCADE away children the batch never imaged (`account_balances.account_id`/`.snapshot_id`, `monthly_spending.category_id`, `category_budgets.category_id`) or SET NULL a pointer at it. It walks `Base.metadata` for constraints referring to the table and `SELECT 1 … LIMIT 1`s each one: any hit is `DEPENDENT_REFUSAL` ("Other rows now depend on this one — undo the changes that added them first"), the general form of the accounts DELETE route's own 409. Rows the same replay already removed do not count — the inverses run in reverse order in one transaction.
- **`superseded(db, batch_ids) -> {batch_id: sentence}`** replaces the inline overlap query and is the single predicate BOTH `undo_batch` and `GET /activity`'s `undoable` use, so a lit button and a refused POST cannot disagree. Two page-wide queries (never one per row): a self-join for `OVERLAP_REFUSAL`, and `max(id) < (SELECT max(id) WHERE op='batch')` for the new `POST_SUMMARY_REFUSAL` ("An import or restore since then replaced these rows — restore a snapshot instead"). The old check filtered `op != 'batch'`, so an import/restore summary — `table_name` `'*'`, empty pk — could never block an older undo even though its `TRUNCATE … RESTART IDENTITY` + `setval` reused every id. Overlap is reported first: it is the more specific diagnosis, and it keeps the existing three-refusal test's sentence.
- **`POST /activity/batches/{id}/undo` catches `IntegrityError`** → `rollback()` → 409 `REPLAY_REFUSAL`. A replay can break a constraint no pre-check sees (re-inserting a budget row whose category was deleted afterwards, a value a unique index now rejects); that was a 500.
- **Paging fetches `limit + 1` from BOTH sources** and trims to `limit`. `len(batches) + len(runs) > limit` was false whenever one source alone filled the page (four batches, no runs, `limit=2` → `next_before: null`), dead-ending the trail on page one.
- **`ActivityBatchOut.undoable` is documented as not a guarantee**: the dependent-rows guard is undo-time only by nature (it asks about the CURRENT data), so the POST may still refuse — and the Activity card shows that 409's sentence verbatim.

Tests: six added to `tests/test_activity_api.py` (both CASCADE repros, the post-summary refusal plus its greyed listing row, the constraint-breaking replay, the one-source page, and the greyed overlap row asserted against the matching 409). All six fail without their fix.

## Merge notes for the coordinator

- `backend/app/main.py`: this lane adds ONE import (`activity`) and ONE include; L3 adds `prefs` and `health` the same way — keep all three.
- `backend/app/api/import_.py`: this lane changes one line inside `import_xlsx` (`actor=user.email`); L1 rewrites the module header and appends two routes — keep both.
- `backend/app/api/net_worth.py` / `spending.py`: only this lane touches them.
- The frontend (F2) reads `batch_id` from the two PUT bodies and `X-Change-Batch` from the two DELETE 204s (Phase 0's `apiWithHeaders`), and sends `X-Change-Source: repair` from the Health card's repair. Same-origin in dev (Vite proxy) and prod (nginx), so no CORS `expose_headers` is needed; if a cross-origin deployment ever appears, add `expose_headers=["X-Change-Batch"]` to the CORS middleware.
- Deviation, documented in the vocabulary test: `undo` batches ARE undoable (spec §9's UI text "an undo is itself reversible" and §13's "undo-of-undo" win over the refusal list's literal `ui|repair`).

## Self-review

**Spec coverage:** §9 capture (request-scoped `Depends(change_batch)`, `record(table, pk, before, after, month=)` with `row_image` in the export's spellings, label set by the router, rows in the same transaction via `batch.commit()`) → Task 1; logged paths — net-worth month PUT (changed balances + created snapshot only) and DELETE, spending PUT/DELETE (rows and cashflow), accounts and categories POST/PATCH/DELETE, budgets PUT/DELETE, the health repair via `X-Change-Source: repair` → Tasks 2–3; the grep pin → Task 4; importer apply writes one `op='batch'` row and a pre-import restore point; every import stores its report → Task 6; restore and undo summary rows → L1 / Task 5; scheduler writes not logged → structural; `GET /activity?limit&before` interleaved with runs, `GET /activity/runs/{id}`, `POST …/undo` with reverse inverse replay, new `source='undo'` batch labelled "Undid: …", the three 409 sentences → Task 5; `batch_id` on the two upsert results and the `X-Change-Batch` header on the 204s → Tasks 2–3. §13: each path's rows/labels/months, the pin, undo of a month save, a month delete and an account edit, the three 409s, undo-of-undo → Tasks 2–5. **Placeholders:** none. **Type consistency:** `ChangeBatch(db, *, source, actor)` with `.id/.label/.month/.rows`, `record_insert(obj, *, month)`, `record_update(obj, before, *, month)`, `record_delete(obj, *, month)`, `await commit() -> UUID | None`, `change_batch` dependency, `batch_header(batch_id)`, `undo_batch(db, batch_id, *, actor) -> UUID`, `undone_by(db, batch_ids)`, `UndoRefused(status, detail)`, the three sentences, `run_import(data, db, *, dry_run, actor=None)` — used identically across the routers, the activity router, the importer and every test; Phase 0's `json_row`, `json_cell`, `parse_cell`, `write_restore_point(db, *, actor)`, `ActivityBatchOut/RunOut/Out/RunDetailOut`, `MonthUpsertResult.batch_id`, `SpendingUpsertResult.batch_id` match `2026-09-04-lifecycle-0-base.md`.
