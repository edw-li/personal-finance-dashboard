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


async def _seed_timeseries(db):
    """3 months x {aggregate, component, liability} — enough to exercise every rule."""
    agg = Account(name="Agg", slug="agg", group="pre_tax", sort_order=1)
    comp = Account(name="Bucket", slug="bucket", group="pre_tax", sort_order=2, is_component=True)
    card = Account(name="Card", slug="card", group="liability", sort_order=3)
    months = [date(2025, 12, 1), date(2026, 1, 1), date(2026, 3, 1)]  # gap at 2026-02
    snaps = [NetWorthSnapshot(month=m) for m in months]
    db.add_all([agg, comp, card, *snaps])
    await db.flush()
    balances = [
        (snaps[0], agg, "1000.00"),
        (snaps[0], comp, "300.00"),
        (snaps[0], card, "-100.00"),
        (snaps[1], agg, "1200.00"),
        (snaps[1], comp, "330.00"),
        (snaps[1], card, "-80.00"),
        (snaps[2], agg, "1500.00"),
        (snaps[2], comp, "360.00"),  # card missing this month
    ]
    for snap, account, value in balances:
        db.add(AccountBalance(snapshot_id=snap.id, account_id=account.id, balance=Decimal(value)))
    await db.commit()
    return agg, comp, card


async def test_timeseries_shapes_and_component_exclusion(auth_client, db):
    agg, comp, card = await _seed_timeseries(db)
    resp = await auth_client.get("/api/v1/net-worth/timeseries")
    assert resp.status_code == 200
    body = resp.json()
    assert body["months"] == ["2025-12-01", "2026-01-01", "2026-03-01"]
    # Decimals arrive as JSON strings (pydantic v2) — assert exact strings.
    assert body["net_worth"] == ["900.00", "1120.00", "1500.00"]
    assert body["group_totals"]["pre_tax"] == ["1000.00", "1200.00", "1500.00"]
    assert body["group_totals"]["liability"] == ["-100.00", "-80.00", "0.00"]
    assert body["group_totals"]["cash"] == ["0.00", "0.00", "0.00"]
    by_id = {s["account_id"]: s["values"] for s in body["series"]}
    assert by_id[comp.id] == ["300.00", "330.00", "360.00"]  # components still listed
    assert by_id[card.id] == ["-100.00", "-80.00", None]  # missing balance is null
    assert body["mom_pct"][0] is None
    assert body["mom_pct"][1] == "0.244444"  # (1120-900)/900, 6 dp HALF_UP


async def test_timeseries_quarterly_filters_to_quarter_end_months(auth_client, db):
    await _seed_timeseries(db)
    resp = await auth_client.get("/api/v1/net-worth/timeseries?granularity=quarterly")
    body = resp.json()
    assert body["months"] == ["2025-12-01", "2026-03-01"]
    assert body["net_worth"] == ["900.00", "1500.00"]
    assert body["mom_pct"] == [None, "0.666667"]  # vs previous kept month


async def test_timeseries_rejects_unknown_granularity(auth_client):
    resp = await auth_client.get("/api/v1/net-worth/timeseries?granularity=weekly")
    assert resp.status_code == 422


async def test_summary_latest_month_with_deltas(auth_client, db):
    await _seed_timeseries(db)
    resp = await auth_client.get("/api/v1/net-worth/summary")
    body = resp.json()
    assert body["month"] == "2026-03-01"
    assert body["net_worth"] == "1500.00"
    assert body["mom_delta"] == "380.00"
    assert body["mom_pct"] == "0.339286"
    groups = {g["group"]: g for g in body["groups"]}
    assert groups["pre_tax"]["total"] == "1500.00"
    assert groups["liability"]["mom_delta"] == "80.00"  # -80 -> 0.00 (paid off)
    assert len(body["groups"]) == 7


async def test_summary_empty_db(auth_client):
    resp = await auth_client.get("/api/v1/net-worth/summary")
    body = resp.json()
    assert body == {
        "month": None,
        "net_worth": None,
        "mom_delta": None,
        "mom_pct": None,
        "groups": [],
    }


async def test_get_month_missing_and_present(auth_client, db):
    account = Account(name="Cash", slug="cash", group="cash", sort_order=1)
    db.add(account)
    await db.commit()

    resp = await auth_client.get("/api/v1/net-worth/months/2026-05-01")
    assert resp.status_code == 200
    assert resp.json() == {
        "month": "2026-05-01",
        "exists": False,
        "recorded_on": None,
        "notes": None,
        "balances": [],
    }
    assert (await auth_client.get("/api/v1/net-worth/months/2026-05-02")).status_code == 422


async def test_put_month_creates_snapshot_and_upserts(auth_client, db):
    account = Account(name="Cash", slug="cash", group="cash", sort_order=1)
    card = Account(name="Card", slug="card", group="liability", sort_order=2)
    db.add_all([account, card])
    await db.commit()

    resp = await auth_client.put(
        "/api/v1/net-worth/months/2026-05-01",
        json={
            "recorded_on": "2026-05-14",
            "notes": "first entry",
            "balances": [
                {"account_id": account.id, "balance": "1234.505"},
                {"account_id": card.id, "balance": "-50.00"},
            ],
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {
        "month": "2026-05-01",
        "snapshot_created": True,
        "created": 2,
        "updated": 0,
        "unchanged": 0,
    }

    read = (await auth_client.get("/api/v1/net-worth/months/2026-05-01")).json()
    assert read["exists"] is True
    assert read["recorded_on"] == "2026-05-14"
    by_id = {b["account_id"]: b["balance"] for b in read["balances"]}
    assert by_id[account.id] == "1234.51"  # server-side HALF_UP quantize
    assert by_id[card.id] == "-50.00"

    # Second put: one change, one identical, omission leaves the other row untouched.
    resp = await auth_client.put(
        "/api/v1/net-worth/months/2026-05-01",
        json={"balances": [{"account_id": account.id, "balance": "1300.00"}]},
    )
    assert resp.json() == {
        "month": "2026-05-01",
        "snapshot_created": False,
        "created": 0,
        "updated": 1,
        "unchanged": 0,
    }
    read = (await auth_client.get("/api/v1/net-worth/months/2026-05-01")).json()
    assert read["recorded_on"] == "2026-05-14"  # untouched: field wasn't sent
    assert {b["account_id"]: b["balance"] for b in read["balances"]}[card.id] == "-50.00"


async def test_put_month_validation(auth_client, db):
    account = Account(name="Cash", slug="cash", group="cash", sort_order=1)
    db.add(account)
    await db.commit()
    put = "/api/v1/net-worth/months/2026-05-01"

    dup = await auth_client.put(
        put,
        json={
            "balances": [
                {"account_id": account.id, "balance": "1"},
                {"account_id": account.id, "balance": "2"},
            ]
        },
    )
    assert dup.status_code == 422
    assert "duplicate" in dup.json()["detail"]

    unknown = await auth_client.put(
        put,
        json={
            "balances": [
                {"account_id": 999, "balance": "1"},
            ]
        },
    )
    assert unknown.status_code == 422
    assert "999" in unknown.json()["detail"]

    # Out-of-int32 ids are stopped by pydantic, not asyncpg.
    assert (
        await auth_client.put(
            put,
            json={
                "balances": [
                    {"account_id": 10**12, "balance": "1"},
                ]
            },
        )
    ).status_code == 422

    too_big = await auth_client.put(
        put,
        json={
            "balances": [
                {"account_id": account.id, "balance": "1000000000000"},
            ]
        },
    )
    assert too_big.status_code == 422

    bad_month = await auth_client.put("/api/v1/net-worth/months/2026-05-02", json={"balances": []})
    assert bad_month.status_code == 422
    # Nothing was written by the failed puts:
    read = (await auth_client.get("/api/v1/net-worth/months/2026-05-01")).json()
    assert read["exists"] is False


async def test_put_month_refuses_empty_create_but_allows_meta_update(auth_client, db):
    account = Account(name="Cash", slug="cash", group="cash", sort_order=1)
    db.add(account)
    await db.commit()
    put = "/api/v1/net-worth/months/2026-06-01"
    # An empty body must NOT mint a permanent empty month (KPI/ribbon poison).
    assert (await auth_client.put(put, json={})).status_code == 422
    assert (await auth_client.get(put)).json()["exists"] is False
    resp = await auth_client.put(
        put, json={"balances": [{"account_id": account.id, "balance": "1.00"}]}
    )
    assert resp.status_code == 200
    # Meta-only PUTs on an existing month stay legal.
    assert (await auth_client.put(put, json={"notes": "meta only"})).status_code == 200
    read = (await auth_client.get(put)).json()
    assert read["notes"] == "meta only"
    assert len(read["balances"]) == 1
