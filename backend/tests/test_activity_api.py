from uuid import uuid4

from sqlalchemy import func, select

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
    # A later batch on the same rows refuses.
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
