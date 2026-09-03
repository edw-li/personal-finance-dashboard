from datetime import date

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
        json={
            "balances": [
                {"account_id": a.id, "balance": "100.00"},
                {"account_id": b.id, "balance": "250.50"},
            ]
        },
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
        json={
            "balances": [
                {"account_id": a.id, "balance": "100.00"},
                {"account_id": b.id, "balance": "250.50"},
            ]
        },
    )
    second = await auth_client.put(
        f"{NW}/months/2026-09-01",
        json={
            "balances": [
                {"account_id": a.id, "balance": "100.00"},
                {"account_id": b.id, "balance": "300.00"},
            ]
        },
    )
    body = second.json()
    assert body["updated"] == 1 and body["batch_id"] not in (None, first.json()["batch_id"])
    logged = await rows(db, body["batch_id"])
    assert len(logged) == 1
    assert (logged[0].op, logged[0].before["balance"], logged[0].after["balance"]) == (
        "update",
        "250.50",
        "300.00",
    )
    assert logged[0].label == "Saved Sep 2026 balances — 1 updated"
    # Meta-only edits (recorded_on, notes) are not logged (spec §9: "changed balances and a
    # created snapshot only"), and an all-unchanged PUT records nothing at all.
    third = await auth_client.put(
        f"{NW}/months/2026-09-01",
        json={
            "notes": "checked twice",
            "balances": [
                {"account_id": a.id, "balance": "100.00"},
                {"account_id": b.id, "balance": "300.00"},
            ],
        },
    )
    assert third.json()["batch_id"] is None
    assert (await db.execute(select(NetWorthSnapshot))).scalar_one().notes == "checked twice"


async def test_month_delete_logs_balances_then_snapshot_and_answers_the_header(auth_client, db):
    a, b = await two_accounts(db)
    await auth_client.put(
        f"{NW}/months/2026-09-01",
        json={
            "balances": [
                {"account_id": a.id, "balance": "100.00"},
                {"account_id": b.id, "balance": "250.50"},
            ]
        },
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
    created = await auth_client.post(
        f"{NW}/accounts", json={"name": "Brokerage", "group": "taxable"}
    )
    assert created.status_code == 201, created.text
    account_id = created.json()["id"]
    patched = await auth_client.patch(
        f"{NW}/accounts/{account_id}", json={"sort_order": 5, "is_active": False}
    )
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
    # one batch per request; the no-op PATCH logged none
    assert len({r.batch_id for r in logged}) == 3
    assert logged[1].before["sort_order"] == 0 and logged[1].after["sort_order"] == 5
    assert logged[1].after["is_active"] is False
    assert logged[2].before["slug"] == "brokerage" and logged[2].after is None
    assert {r.month for r in logged} == {None}
