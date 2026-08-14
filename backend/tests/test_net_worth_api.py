from datetime import date
from decimal import Decimal

from app.models import Account, AccountBalance, NetWorthSnapshot


async def test_net_worth_requires_auth(client):
    resp = await client.get("/api/v1/net-worth/accounts")
    assert resp.status_code == 401


async def test_create_and_list_accounts(auth_client):
    resp = await auth_client.post(
        "/api/v1/net-worth/accounts",
        json={"name": "Fidelity HSA", "group": "pre_tax", "sort_order": 17},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["slug"] == "fidelity-hsa"
    assert body["is_active"] is True
    assert body["is_component"] is False

    resp = await auth_client.get("/api/v1/net-worth/accounts")
    assert resp.status_code == 200
    assert [a["slug"] for a in resp.json()] == ["fidelity-hsa"]


async def test_create_account_rejects_bad_group_and_unsluggable_name(auth_client):
    resp = await auth_client.post(
        "/api/v1/net-worth/accounts", json={"name": "X", "group": "offshore"}
    )
    assert resp.status_code == 422
    resp = await auth_client.post(
        "/api/v1/net-worth/accounts", json={"name": "!!!", "group": "cash"}
    )
    assert resp.status_code == 422


async def test_create_account_conflicts_on_slug(auth_client):
    first = await auth_client.post(
        "/api/v1/net-worth/accounts", json={"name": "Petty Cash", "group": "other"}
    )
    assert first.status_code == 201
    dup = await auth_client.post(
        "/api/v1/net-worth/accounts", json={"name": "Petty  Cash", "group": "other"}
    )
    assert dup.status_code == 409


async def test_patch_account_updates_fields_not_slug(auth_client, db):
    created = (
        await auth_client.post(
            "/api/v1/net-worth/accounts", json={"name": "Vehicle(s)", "group": "other"}
        )
    ).json()
    resp = await auth_client.patch(
        f"/api/v1/net-worth/accounts/{created['id']}",
        json={"name": "Vehicles", "is_component": True, "is_active": False},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "Vehicles"
    assert body["slug"] == "vehicle-s"  # slug is the importer's natural key — immutable
    assert body["is_component"] is True
    assert body["is_active"] is False


async def test_patch_account_404_and_group_validation(auth_client):
    assert (
        await auth_client.patch("/api/v1/net-worth/accounts/999", json={"name": "X"})
    ).status_code == 404
    created = (
        await auth_client.post("/api/v1/net-worth/accounts", json={"name": "Cash", "group": "cash"})
    ).json()
    resp = await auth_client.patch(
        f"/api/v1/net-worth/accounts/{created['id']}", json={"group": "nope"}
    )
    assert resp.status_code == 422


async def test_delete_account_guarded_by_balances(auth_client, db):
    created = (
        await auth_client.post(
            "/api/v1/net-worth/accounts", json={"name": "Old Card", "group": "liability"}
        )
    ).json()
    snapshot = NetWorthSnapshot(month=date(2026, 1, 1))
    db.add(snapshot)
    await db.flush()
    db.add(
        AccountBalance(snapshot_id=snapshot.id, account_id=created["id"], balance=Decimal("-1.00"))
    )
    await db.commit()
    resp = await auth_client.delete(f"/api/v1/net-worth/accounts/{created['id']}")
    assert resp.status_code == 409  # has balances — deactivate instead

    empty = (
        await auth_client.post(
            "/api/v1/net-worth/accounts", json={"name": "Never Used", "group": "cash"}
        )
    ).json()
    resp = await auth_client.delete(f"/api/v1/net-worth/accounts/{empty['id']}")
    assert resp.status_code == 204
    assert (await db.get(Account, empty["id"])) is None


async def test_create_account_guards_slug_length_and_sort_order(auth_client):
    # 'İ'.lower() expands to 2 code points; 61 of them slugify to 121 chars — 422, not 500.
    resp = await auth_client.post(
        "/api/v1/net-worth/accounts", json={"name": "İ" * 61, "group": "cash"}
    )
    assert resp.status_code == 422
    resp = await auth_client.post(
        "/api/v1/net-worth/accounts",
        json={"name": "Cash", "group": "cash", "sort_order": 2**31},
    )
    assert resp.status_code == 422  # int32-bounds guard, not a DBAPIError


async def test_patch_account_name_rules(auth_client):
    alpha = (
        await auth_client.post(
            "/api/v1/net-worth/accounts", json={"name": "Alpha", "group": "cash"}
        )
    ).json()
    beta = (
        await auth_client.post("/api/v1/net-worth/accounts", json={"name": "Beta", "group": "cash"})
    ).json()
    assert beta["id"] != alpha["id"]
    # Whitespace-only names are rejected on PATCH too (create's unsluggable rule).
    resp = await auth_client.patch(
        f"/api/v1/net-worth/accounts/{alpha['id']}", json={"name": "   "}
    )
    assert resp.status_code == 422
    # Renaming onto another account's name conflicts; own name is a no-op.
    resp = await auth_client.patch(
        f"/api/v1/net-worth/accounts/{alpha['id']}", json={"name": "Beta"}
    )
    assert resp.status_code == 409
    resp = await auth_client.patch(
        f"/api/v1/net-worth/accounts/{alpha['id']}", json={"name": "Alpha"}
    )
    assert resp.status_code == 200
    # Explicit null is a no-op, never a NULL write.
    resp = await auth_client.patch(f"/api/v1/net-worth/accounts/{alpha['id']}", json={"name": None})
    assert resp.status_code == 200
    assert resp.json()["name"] == "Alpha"
