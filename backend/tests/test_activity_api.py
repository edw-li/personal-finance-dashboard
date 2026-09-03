from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy import func, select

from app.models import (
    Account,
    AccountBalance,
    CategoryBudget,
    ChangeLog,
    LifecycleRun,
    NetWorthSnapshot,
)
from app.services.changelog import (
    ALREADY_UNDONE,
    DEPENDENT_REFUSAL,
    OVERLAP_REFUSAL,
    POST_SUMMARY_REFUSAL,
    REPLAY_REFUSAL,
    SUMMARY_REFUSAL,
)

ACTIVITY = "/api/v1/activity"
NW = "/api/v1/net-worth"
SP = "/api/v1/spending"


async def count_of(db, model) -> int:
    return (await db.execute(select(func.count()).select_from(model))).scalar_one()


async def make_account(db, name="Checking", slug="checking") -> Account:
    account = Account(name=name, slug=slug, group="cash", sort_order=1)
    db.add(account)
    await db.commit()
    return account


async def save_month(auth_client, account_id: int, balance: str) -> str:
    resp = await auth_client.put(
        f"{NW}/months/2026-09-01",
        json={"balances": [{"account_id": account_id, "balance": balance}]},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["batch_id"]


async def test_activity_requires_auth(client):
    assert (await client.get(ACTIVITY)).status_code == 401
    assert (await client.post(f"{ACTIVITY}/batches/{uuid4()}/undo")).status_code == 401


async def test_activity_lists_batches_and_runs_newest_first_with_paging(auth_client, db):
    account = await make_account(db)
    first = await save_month(auth_client, account.id, "100.00")
    second = await save_month(auth_client, account.id, "150.00")
    # A snapshot run stamped strictly BETWEEN the two batches, so the interleaving is
    # deterministic instead of a race with the wall clock.
    stamp = func.min(ChangeLog.at)
    first_at, second_at = (
        (await db.execute(select(stamp).group_by(ChangeLog.batch_id).order_by(stamp)))
        .scalars()
        .all()
    )
    assert first_at < second_at
    db.add(
        LifecycleRun(
            kind="snapshot",
            ok=True,
            filename="finance-export-20260904-233000.zip",
            size_bytes=2048,
            at=first_at + (second_at - first_at) / 2,
        )
    )
    await db.commit()

    body = (await auth_client.get(ACTIVITY)).json()
    assert [e["type"] for e in body["entries"]] == ["batch", "run", "batch"]
    newest, run, oldest = body["entries"]
    assert newest["batch_id"] == second and oldest["batch_id"] == first
    assert newest["label"] == "Saved Sep 2026 balances — 1 updated"
    assert newest["rows"] == 1 and newest["undoable"] is True and newest["undone_by"] is None
    assert newest["source"] == "ui" and newest["actor"] == "me@example.com"
    assert newest["month"] == "2026-09-01"
    assert run["kind"] == "snapshot" and run["has_report"] is False and run["size_bytes"] == 2048
    assert body["next_before"] is None

    page = (await auth_client.get(f"{ACTIVITY}?limit=2")).json()
    assert [e["type"] for e in page["entries"]] == ["batch", "run"]
    assert page["next_before"] == run["at"]
    rest = (await auth_client.get(f"{ACTIVITY}?limit=2&before={page['next_before']}")).json()
    assert [e.get("batch_id") for e in rest["entries"]] == [first]
    assert rest["next_before"] is None


async def test_activity_run_detail_returns_the_stored_report(auth_client, db):
    run = LifecycleRun(
        kind="restore", ok=True, filename="sep2.zip", report={"applied": True, "tables": {}}
    )
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
    patched = await auth_client.patch(
        f"{NW}/accounts/{account.id}", json={"name": "Brokerage (old)", "sort_order": 9}
    )
    assert patched.status_code == 200
    batch_id = (await db.execute(select(ChangeLog.batch_id))).scalar_one()
    resp = await auth_client.post(f"{ACTIVITY}/batches/{batch_id}/undo")
    assert resp.status_code == 200, resp.text
    row = (await auth_client.get(f"{NW}/accounts")).json()[0]
    assert (row["name"], row["sort_order"]) == ("Brokerage", 1)


async def test_the_three_refusals_and_undo_of_undo(auth_client, db):
    account = await make_account(db)
    # Read the id up front: a refusal rolls the shared session back, expiring `account`.
    account_id = account.id
    first = await save_month(auth_client, account_id, "100.00")
    # A summary batch (a restore) refuses.
    db.add(
        ChangeLog(
            batch_id=uuid4(),
            source="restore",
            actor="x",
            label="Restored snapshot",
            table_name="*",
            pk={},
            op="batch",
            before=None,
            after={"tables": {}},
        )
    )
    await db.commit()
    summary_id = (
        await db.execute(select(ChangeLog.batch_id).where(ChangeLog.op == "batch"))
    ).scalar_one()
    summary = await auth_client.post(f"{ACTIVITY}/batches/{summary_id}/undo")
    assert summary.status_code == 409 and summary.json()["detail"] == SUMMARY_REFUSAL
    # A later batch on the same rows refuses. The seeded restore summary above ALSO
    # postdates `first`; overlap is the sentence because it is the more specific diagnosis.
    second = await save_month(auth_client, account_id, "150.00")
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


async def test_undo_refuses_rows_that_now_depend_on_the_one_it_would_delete(auth_client, db):
    """The replayed DELETE is bare Core SQL, so `account_balances.account_id`'s
    ondelete=CASCADE would silently take a balance the account-create batch never imaged."""
    created = await auth_client.post(
        f"{NW}/accounts", json={"name": "Savings", "group": "cash", "sort_order": 3}
    )
    assert created.status_code == 201, created.text
    account_id = created.json()["id"]
    await save_month(auth_client, account_id, "100.00")
    batch_id = (
        await db.execute(select(ChangeLog.batch_id).where(ChangeLog.table_name == "accounts"))
    ).scalar_one()
    refused = await auth_client.post(f"{ACTIVITY}/batches/{batch_id}/undo")
    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"] == DEPENDENT_REFUSAL
    await db.rollback()  # the refusal rolled the shared session back
    assert await count_of(db, Account) == 1 and await count_of(db, AccountBalance) == 1


async def test_undo_refuses_a_snapshot_a_later_balance_still_hangs_off(auth_client, db):
    """Same trap one level down: `account_balances.snapshot_id` CASCADEs, and the batch that
    created the snapshot only imaged its OWN balance row."""
    a = await make_account(db, "Checking", "checking")
    b = await make_account(db, "Brokerage", "brokerage")
    first = await save_month(auth_client, a.id, "100.00")  # creates the snapshot
    await save_month(auth_client, b.id, "250.00")  # adds a second balance to it
    refused = await auth_client.post(f"{ACTIVITY}/batches/{first}/undo")
    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"] == DEPENDENT_REFUSAL
    await db.rollback()
    # Nothing half-undone: the balance the replay HAD already deleted came back too.
    assert await count_of(db, NetWorthSnapshot) == 1 and await count_of(db, AccountBalance) == 2


async def test_undo_refuses_once_an_import_or_restore_followed_it(auth_client, db):
    account = await make_account(db)
    batch_id = await save_month(auth_client, account.id, "100.00")
    # An import's summary row: op='batch', table_name '*', empty pk — so the per-row overlap
    # join can never see it, yet its TRUNCATE … RESTART IDENTITY + setval reused every id.
    db.add(
        ChangeLog(
            batch_id=uuid4(),
            source="import",
            actor="x",
            label="Imported finance.xlsx",
            table_name="*",
            pk={},
            op="batch",
            before=None,
            after={"tables": {}},
        )
    )
    await db.commit()
    listing = (await auth_client.get(ACTIVITY)).json()["entries"]
    assert next(e for e in listing if e.get("batch_id") == batch_id)["undoable"] is False
    refused = await auth_client.post(f"{ACTIVITY}/batches/{batch_id}/undo")
    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"] == POST_SUMMARY_REFUSAL


async def test_a_replay_that_breaks_a_constraint_is_a_409_not_a_500(auth_client, db):
    created = await auth_client.post(f"{SP}/categories", json={"name": "Fun"})
    assert created.status_code == 201, created.text
    category_id = created.json()["id"]
    budgeted = await auth_client.put(
        f"{SP}/categories/{category_id}/budget",
        json={"amount": "200.00", "effective_month": "2026-09-01"},
    )
    assert budgeted.status_code == 200, budgeted.text
    removed = await auth_client.delete(f"{SP}/categories/{category_id}/budget/2026-09-01")
    assert removed.status_code == 204
    budget_batch = removed.headers["x-change-batch"]
    assert (await auth_client.delete(f"{SP}/categories/{category_id}")).status_code == 204
    # A different TABLE, so no pk overlaps — but re-inserting the budget row needs a parent
    # category that is gone, and the FK says so only when the replay runs.
    refused = await auth_client.post(f"{ACTIVITY}/batches/{budget_batch}/undo")
    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"] == REPLAY_REFUSAL
    await db.rollback()
    assert await count_of(db, CategoryBudget) == 0


async def test_paging_continues_when_one_source_alone_fills_the_page(auth_client, db):
    # Four batches and no runs at limit=2: `more` must count the rows FETCHED, not the rows a
    # full page holds, or the trail dead-ends on page one with next_before null.
    base = datetime(2026, 9, 1, 12, 0, tzinfo=UTC)
    for n in range(4):
        db.add(
            ChangeLog(
                batch_id=uuid4(),
                source="ui",
                actor="me@example.com",
                label=f"Change {n}",
                table_name="accounts",
                pk={"id": n + 1},  # distinct rows, so none supersedes another
                op="update",
                before={"sort_order": n},
                after={"sort_order": n + 1},
                at=base + timedelta(minutes=n),
            )
        )
    await db.commit()
    first = (await auth_client.get(f"{ACTIVITY}?limit=2")).json()
    assert [e["label"] for e in first["entries"]] == ["Change 3", "Change 2"]
    assert first["next_before"] is not None
    rest = (await auth_client.get(f"{ACTIVITY}?limit=2&before={first['next_before']}")).json()
    assert [e["label"] for e in rest["entries"]] == ["Change 1", "Change 0"]
    assert rest["next_before"] is None


async def test_the_listing_greys_a_batch_a_later_change_touched(auth_client, db):
    account = await make_account(db)
    first = await save_month(auth_client, account.id, "100.00")
    second = await save_month(auth_client, account.id, "150.00")
    listing = {e["batch_id"]: e for e in (await auth_client.get(ACTIVITY)).json()["entries"]}
    # The same overlap predicate undo_batch refuses on — proven by the 409 below.
    assert listing[first]["undoable"] is False and listing[second]["undoable"] is True
    refused = await auth_client.post(f"{ACTIVITY}/batches/{first}/undo")
    assert refused.status_code == 409 and refused.json()["detail"] == OVERLAP_REFUSAL
