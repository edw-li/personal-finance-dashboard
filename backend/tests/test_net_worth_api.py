from datetime import date
from decimal import Decimal
from unittest.mock import ANY

from sqlalchemy import func, select

from app.models import Account, AccountBalance, NetWorthSnapshot, Person


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
    assert body["parent_account_id"] is None

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
    snaps[1].notes = "january bonus"  # one noted month exercises the notes alignment
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
    # Snapshot notes ride the same month alignment — the chart annotation feed.
    assert body["notes"] == [None, "january bonus", None]


async def test_timeseries_quarterly_filters_to_quarter_end_months(auth_client, db):
    await _seed_timeseries(db)
    resp = await auth_client.get("/api/v1/net-worth/timeseries?granularity=quarterly")
    body = resp.json()
    assert body["months"] == ["2025-12-01", "2026-03-01"]
    assert body["net_worth"] == ["900.00", "1500.00"]
    assert body["mom_pct"] == [None, "0.666667"]  # vs previous kept month
    # The noted month (2026-01) is not a quarter end: its note is filtered WITH it.
    assert body["notes"] == [None, None]


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
        "owner_totals": [],
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
        # The creating PUT now logs a change batch (2026-09-03 data-lifecycle spec section 9).
        "batch_id": ANY,
    }
    assert resp.json()["batch_id"] is not None

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
        "batch_id": ANY,
    }
    assert resp.json()["batch_id"] is not None  # one balance changed, so a batch was logged
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


async def test_delete_month_removes_snapshot_and_cascades_balances(auth_client, db):
    await _seed_timeseries(db)
    resp = await auth_client.delete("/api/v1/net-worth/months/2026-01-01")
    assert resp.status_code == 204
    # Gone from every read: the timeseries loses the month...
    body = (await auth_client.get("/api/v1/net-worth/timeseries")).json()
    assert body["months"] == ["2025-12-01", "2026-03-01"]
    read = (await auth_client.get("/api/v1/net-worth/months/2026-01-01")).json()
    assert read["exists"] is False
    assert read["balances"] == []
    # ...and the FK's ON DELETE CASCADE took the month's 3 balance rows (8 seeded - 3).
    remaining = (await db.execute(select(func.count()).select_from(AccountBalance))).scalar_one()
    assert remaining == 5


async def test_delete_month_404_when_absent_and_422_on_a_mid_month_date(auth_client, db):
    await _seed_timeseries(db)
    assert (await auth_client.delete("/api/v1/net-worth/months/2026-02-01")).status_code == 404
    assert (await auth_client.delete("/api/v1/net-worth/months/2026-02-02")).status_code == 422
    # Neither rejection deleted anything.
    body = (await auth_client.get("/api/v1/net-worth/timeseries")).json()
    assert body["months"] == ["2025-12-01", "2026-01-01", "2026-03-01"]


async def test_suggestions_endpoint_is_gone(auth_client):
    """Balance suggestions were removed end to end (2026-08-23 spec §7)."""
    resp = await auth_client.get("/api/v1/net-worth/suggestions")
    assert resp.status_code == 404


async def test_account_owner_and_parent_round_trip(auth_client, db):
    me = Person(name="Me", is_primary=True)
    partner = Person(name="Partner")
    db.add_all([me, partner])
    await db.commit()

    parent = (
        await auth_client.post(
            "/api/v1/net-worth/accounts",
            json={"name": "Partner 401(k)", "group": "pre_tax", "person_id": partner.id},
        )
    ).json()
    assert parent["person_id"] == partner.id
    assert parent["parent_account_id"] is None

    child = (
        await auth_client.post(
            "/api/v1/net-worth/accounts",
            json={
                "name": "Partner Employer Match",
                "group": "pre_tax",
                "person_id": partner.id,
                "parent_account_id": parent["id"],
                "is_component": True,
            },
        )
    ).json()
    # parent_account_id was unreachable via the API until now — a partner's 401(k)
    # component nesting was SQL-only (audit §3.1).
    assert child["parent_account_id"] == parent["id"]
    assert child["is_component"] is True

    # An explicit null is a WRITE on these two columns: retag to joint, unlink the parent.
    resp = await auth_client.patch(
        f"/api/v1/net-worth/accounts/{child['id']}",
        json={"person_id": None, "parent_account_id": None},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["person_id"] is None
    assert resp.json()["parent_account_id"] is None

    # ...while an OMITTED key still leaves the column exactly where it was.
    resp = await auth_client.patch(
        f"/api/v1/net-worth/accounts/{parent['id']}", json={"sort_order": 9}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["person_id"] == partner.id
    assert resp.json()["sort_order"] == 9

    # And a person can be reassigned, not only cleared.
    resp = await auth_client.patch(
        f"/api/v1/net-worth/accounts/{parent['id']}", json={"person_id": me.id}
    )
    assert resp.json()["person_id"] == me.id


async def test_account_link_validation(auth_client, db):
    db.add(Person(name="Me", is_primary=True))
    await db.commit()
    # Unknown FK targets 422 with a sentence, instead of surfacing asyncpg's
    # ForeignKeyViolationError as a 500.
    assert (
        await auth_client.post(
            "/api/v1/net-worth/accounts",
            json={"name": "Ghost Owner", "group": "cash", "person_id": 999},
        )
    ).status_code == 422
    assert (
        await auth_client.post(
            "/api/v1/net-worth/accounts",
            json={"name": "Orphan", "group": "cash", "parent_account_id": 999},
        )
    ).status_code == 422
    # int32-bounded like every other id on this router: garbage 422s rather than
    # surfacing asyncpg's DataError.
    assert (
        await auth_client.post(
            "/api/v1/net-worth/accounts",
            json={"name": "Huge", "group": "cash", "person_id": 2**31},
        )
    ).status_code == 422

    created = (
        await auth_client.post("/api/v1/net-worth/accounts", json={"name": "Solo", "group": "cash"})
    ).json()
    # An account cannot be its own parent: the UI nests components under their parent, and
    # a self-link renders as an account inside itself.
    self_parent = await auth_client.patch(
        f"/api/v1/net-worth/accounts/{created['id']}",
        json={"parent_account_id": created["id"]},
    )
    assert self_parent.status_code == 422
    assert (
        await auth_client.patch(
            f"/api/v1/net-worth/accounts/{created['id']}", json={"person_id": 999}
        )
    ).status_code == 422


async def test_account_defaults_to_joint_when_no_owner_is_sent(auth_client):
    # The API does NOT guess the primary person: the migration backfilled history, and a
    # new account with no owner is a deliberate joint account.
    created = (
        await auth_client.post(
            "/api/v1/net-worth/accounts", json={"name": "New Joint", "group": "cash"}
        )
    ).json()
    assert created["person_id"] is None


# --- ownership views (2026-08-26 household spec §5.2) -------------------------------------


async def _seed_owned_timeseries(db):
    """Two months x {mine, theirs, joint}. Every figure below is hand-checkable:
    household 1170 -> 1330, my view 170 -> 230, their view 1070 -> 1180, joint 70 -> 80."""
    me = Person(name="Me", is_primary=True)
    partner = Person(name="Sam", is_primary=False)
    db.add_all([me, partner])
    await db.flush()
    mine = Account(
        name="My Checking", slug="my-checking", group="cash", sort_order=1, person_id=me.id
    )
    theirs = Account(
        name="Sam Brokerage",
        slug="sam-brokerage",
        group="taxable",
        sort_order=2,
        person_id=partner.id,
    )
    joint = Account(
        name="Joint Savings", slug="joint-savings", group="cash", sort_order=3, person_id=None
    )
    snaps = [NetWorthSnapshot(month=date(2026, 7, 1)), NetWorthSnapshot(month=date(2026, 8, 1))]
    db.add_all([mine, theirs, joint, *snaps])
    await db.flush()
    for snap, account, value in (
        (snaps[0], mine, "100.00"),
        (snaps[0], theirs, "1000.00"),
        (snaps[0], joint, "70.00"),
        (snaps[1], mine, "150.00"),
        (snaps[1], theirs, "1100.00"),
        (snaps[1], joint, "80.00"),
    ):
        db.add(AccountBalance(snapshot_id=snap.id, account_id=account.id, balance=Decimal(value)))
    await db.commit()
    return me, partner


async def test_timeseries_without_owner_is_the_whole_household(auth_client, db):
    me, partner = await _seed_owned_timeseries(db)
    body = (await auth_client.get("/api/v1/net-worth/timeseries")).json()
    assert body["net_worth"] == ["1170.00", "1330.00"]
    assert len(body["accounts"]) == 3
    # Exclusive per-owner series: primary first, then the rest by id, Joint last, and the
    # three columns add up to net_worth month by month.
    assert body["owner_series"] == [
        {"person_id": me.id, "name": "Me", "values": ["100.00", "150.00"]},
        {"person_id": partner.id, "name": "Sam", "values": ["1000.00", "1100.00"]},
        {"person_id": None, "name": None, "values": ["70.00", "80.00"]},
    ]


async def test_timeseries_owner_person_is_owned_plus_joint(auth_client, db):
    me, _partner = await _seed_owned_timeseries(db)
    body = (await auth_client.get(f"/api/v1/net-worth/timeseries?owner={me.id}")).json()
    assert body["net_worth"] == ["170.00", "230.00"]
    assert [a["slug"] for a in body["accounts"]] == ["my-checking", "joint-savings"]
    assert body["group_totals"]["cash"] == ["170.00", "230.00"]
    assert body["group_totals"]["taxable"] == ["0.00", "0.00"]
    # The scoped view's own owner split still sums to the scoped net worth.
    assert body["owner_series"] == [
        {"person_id": me.id, "name": "Me", "values": ["100.00", "150.00"]},
        {"person_id": None, "name": None, "values": ["70.00", "80.00"]},
    ]


async def test_timeseries_owner_joint_is_null_owned_only(auth_client, db):
    await _seed_owned_timeseries(db)
    body = (await auth_client.get("/api/v1/net-worth/timeseries?owner=joint")).json()
    assert body["net_worth"] == ["70.00", "80.00"]
    assert [a["slug"] for a in body["accounts"]] == ["joint-savings"]
    assert body["owner_series"] == [{"person_id": None, "name": None, "values": ["70.00", "80.00"]}]


async def test_summary_owner_totals_and_scoped_deltas(auth_client, db):
    me, partner = await _seed_owned_timeseries(db)

    household = (await auth_client.get("/api/v1/net-worth/summary")).json()
    assert household["net_worth"] == "1330.00"
    assert household["mom_delta"] == "160.00"
    assert household["owner_totals"] == [
        {"person_id": me.id, "name": "Me", "total": "150.00"},
        {"person_id": partner.id, "name": "Sam", "total": "1100.00"},
        {"person_id": None, "name": None, "total": "80.00"},
    ]

    scoped = (await auth_client.get(f"/api/v1/net-worth/summary?owner={me.id}")).json()
    assert scoped["net_worth"] == "230.00"
    assert scoped["mom_delta"] == "60.00"
    assert scoped["mom_pct"] == "0.352941"  # 60/170, 6dp HALF_UP
    assert scoped["owner_totals"] == [
        {"person_id": me.id, "name": "Me", "total": "150.00"},
        {"person_id": None, "name": None, "total": "80.00"},
    ]

    joint = (await auth_client.get("/api/v1/net-worth/summary?owner=joint")).json()
    assert joint["net_worth"] == "80.00"
    assert joint["mom_pct"] == "0.142857"  # 10/70
    assert joint["owner_totals"] == [{"person_id": None, "name": None, "total": "80.00"}]


async def test_owner_param_rejects_garbage_on_both_endpoints(auth_client, db):
    await _seed_owned_timeseries(db)
    for bad in ("nobody", "-1", "0", "1.5", "99999999999"):
        assert (
            await auth_client.get(f"/api/v1/net-worth/timeseries?owner={bad}")
        ).status_code == 422, bad
        assert (
            await auth_client.get(f"/api/v1/net-worth/summary?owner={bad}")
        ).status_code == 422, bad


async def test_owner_series_on_a_peopleless_database_is_one_joint_row(auth_client, db):
    """The pre-household shape: no people rows, every account NULL-owned. The payload must
    still be honest and still sum to net_worth rather than 500 on the missing join."""
    await _seed_timeseries(db)
    body = (await auth_client.get("/api/v1/net-worth/timeseries")).json()
    assert body["owner_series"] == [
        {"person_id": None, "name": None, "values": ["900.00", "1120.00", "1500.00"]}
    ]


async def test_summary_month_param_returns_that_month_and_its_own_delta(auth_client, db):
    # Three months: 100 → 130 → 200 in one taxable account. The steps differ on purpose, so
    # the viewed month's delta cannot be mistaken for the latest month's.
    acct = Account(name="Brokerage", slug="brokerage", group="taxable", sort_order=1)
    db.add(acct)
    await db.flush()
    snaps = [NetWorthSnapshot(month=date(2026, m, 1)) for m in (1, 2, 3)]
    db.add_all(snaps)
    await db.flush()
    for snap, amount in zip(snaps, ("100.00", "130.00", "200.00"), strict=True):
        db.add(AccountBalance(snapshot_id=snap.id, account_id=acct.id, balance=Decimal(amount)))
    await db.commit()

    latest = (await auth_client.get("/api/v1/net-worth/summary")).json()
    assert latest["month"] == "2026-03-01"
    assert latest["net_worth"] == "200.00"
    assert latest["mom_delta"] == "70.00"

    viewed = (await auth_client.get("/api/v1/net-worth/summary?month=2026-02-01")).json()
    assert viewed["month"] == "2026-02-01"
    assert viewed["net_worth"] == "130.00"
    assert viewed["mom_delta"] == "30.00"  # against January, not March
    assert viewed["mom_pct"] == "0.300000"  # 30/100, 6dp HALF_UP

    first = (await auth_client.get("/api/v1/net-worth/summary?month=2026-01-01")).json()
    assert first["mom_delta"] is None  # nothing before the first month


async def test_summary_month_param_404s_for_a_month_with_no_snapshot(auth_client, db):
    acct = Account(name="Brokerage", slug="brokerage", group="taxable", sort_order=1)
    snap = NetWorthSnapshot(month=date(2026, 1, 1))
    db.add_all([acct, snap])
    await db.flush()
    db.add(AccountBalance(snapshot_id=snap.id, account_id=acct.id, balance=Decimal("1.00")))
    await db.commit()
    resp = await auth_client.get("/api/v1/net-worth/summary?month=2025-12-01")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "no snapshot for 2025-12"


async def test_summary_month_param_422s_on_a_mid_month_value(auth_client, db):
    """A mid-month value is malformed input, not an uncovered month: 422 like
    /months/{month}, never a 404 that reads as "February has no snapshot"."""
    acct = Account(name="Brokerage", slug="brokerage", group="taxable", sort_order=1)
    snap = NetWorthSnapshot(month=date(2026, 2, 1))
    db.add_all([acct, snap])
    await db.flush()
    db.add(AccountBalance(snapshot_id=snap.id, account_id=acct.id, balance=Decimal("100.00")))
    await db.commit()
    resp = await auth_client.get("/api/v1/net-worth/summary?month=2026-02-15")
    assert resp.status_code == 422
    assert resp.json()["detail"] == "month must be the first of the month (YYYY-MM-01)"


async def test_summary_month_param_deltas_against_the_previous_snapshot_across_a_gap(
    auth_client, db
):
    # Jan / Mar / Jun, 100 → 130 → 200: "previous" is the previous SNAPSHOT, not the
    # previous calendar month, so June compares against March.
    acct = Account(name="Brokerage", slug="brokerage", group="taxable", sort_order=1)
    db.add(acct)
    await db.flush()
    snaps = [NetWorthSnapshot(month=date(2026, m, 1)) for m in (1, 3, 6)]
    db.add_all(snaps)
    await db.flush()
    for snap, amount in zip(snaps, ("100.00", "130.00", "200.00"), strict=True):
        db.add(AccountBalance(snapshot_id=snap.id, account_id=acct.id, balance=Decimal(amount)))
    await db.commit()

    june = (await auth_client.get("/api/v1/net-worth/summary?month=2026-06-01")).json()
    assert june["net_worth"] == "200.00"
    assert june["mom_delta"] == "70.00"
    assert june["mom_pct"] == "0.538462"  # 70/130, 6dp HALF_UP

    march = (await auth_client.get("/api/v1/net-worth/summary?month=2026-03-01")).json()
    assert march["mom_delta"] == "30.00"

    # February falls inside the gap — a real first-of-month with no snapshot behind it.
    gap = await auth_client.get("/api/v1/net-worth/summary?month=2026-02-01")
    assert gap.status_code == 404
    assert gap.json()["detail"] == "no snapshot for 2026-02"


async def test_summary_owner_and_month_scope_both_the_view_and_its_delta(auth_client, db):
    me, _partner = await _seed_owned_timeseries(db)

    july = (
        await auth_client.get(f"/api/v1/net-worth/summary?owner={me.id}&month=2026-07-01")
    ).json()
    assert july["month"] == "2026-07-01"
    assert july["net_worth"] == "170.00"  # mine 100 + joint 70, not the household's 1170
    assert july["mom_delta"] is None  # July is the first month in the book
    assert july["owner_totals"] == [
        {"person_id": me.id, "name": "Me", "total": "100.00"},
        {"person_id": None, "name": None, "total": "70.00"},
    ]
    assert july["groups"]  # a viewed month still carries its group breakdown

    august = (
        await auth_client.get(f"/api/v1/net-worth/summary?owner={me.id}&month=2026-08-01")
    ).json()
    assert august["net_worth"] == "230.00"
    assert august["mom_delta"] == "60.00"  # 230 - 170: BOTH months owner-scoped


async def test_summary_month_param_404s_on_an_empty_book(auth_client):
    # No snapshots at all: the month filter still 404s rather than returning the empty
    # summary, which would silently answer a question about a month that isn't there.
    resp = await auth_client.get("/api/v1/net-worth/summary?month=2026-01-01")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "no snapshot for 2026-01"
