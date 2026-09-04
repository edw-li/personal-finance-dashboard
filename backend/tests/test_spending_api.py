from datetime import date
from decimal import Decimal
from unittest.mock import ANY

from app.models import (
    Account,
    AccountBalance,
    MonthlyCashflow,
    MonthlySpending,
    NetWorthSnapshot,
    SpendingCategory,
)


async def test_spending_requires_auth(client):
    resp = await client.get("/api/v1/spending/categories")
    assert resp.status_code == 401


async def test_category_crud_roundtrip(auth_client, db):
    created = await auth_client.post(
        "/api/v1/spending/categories", json={"name": "Food & Dining", "sort_order": 8}
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["slug"] == "food-dining"
    assert body["is_active"] is True

    dup = await auth_client.post("/api/v1/spending/categories", json={"name": "Food & Dining"})
    assert dup.status_code == 409

    listed = await auth_client.get("/api/v1/spending/categories")
    assert [c["slug"] for c in listed.json()] == ["food-dining"]

    patched = await auth_client.patch(
        f"/api/v1/spending/categories/{body['id']}",
        json={"name": "Food", "is_active": False},
    )
    assert patched.status_code == 200
    assert patched.json()["name"] == "Food"
    assert patched.json()["slug"] == "food-dining"  # immutable natural key
    assert patched.json()["is_active"] is False

    assert (
        await auth_client.patch("/api/v1/spending/categories/999", json={"name": "X"})
    ).status_code == 404


async def test_category_delete_guarded_by_rows(auth_client, db):
    cat = SpendingCategory(name="Pets", slug="pets", sort_order=1)
    db.add(cat)
    await db.flush()
    db.add(MonthlySpending(month=date(2026, 1, 1), category_id=cat.id, amount=Decimal("5")))
    await db.commit()
    assert (await auth_client.delete(f"/api/v1/spending/categories/{cat.id}")).status_code == 409

    empty = (await auth_client.post("/api/v1/spending/categories", json={"name": "Unused"})).json()
    assert (
        await auth_client.delete(f"/api/v1/spending/categories/{empty['id']}")
    ).status_code == 204


async def test_category_input_guards(auth_client):
    # 'İ' lowercases to 2 code points; 41 of them slugify to 81 chars (> String(80)).
    resp = await auth_client.post("/api/v1/spending/categories", json={"name": "İ" * 41})
    assert resp.status_code == 422
    resp = await auth_client.post(
        "/api/v1/spending/categories", json={"name": "Pets", "sort_order": 2**31}
    )
    assert resp.status_code == 422
    created = (await auth_client.post("/api/v1/spending/categories", json={"name": "Pets"})).json()
    resp = await auth_client.patch(
        f"/api/v1/spending/categories/{created['id']}", json={"name": "   "}
    )
    assert resp.status_code == 422


async def _seed_spending(db):
    """2 categories x 3 months + cashflow + one NW snapshot for the 4% line."""
    food = SpendingCategory(name="Food", slug="food", sort_order=1)
    rent = SpendingCategory(name="Rent", slug="rent", sort_order=2)
    db.add_all([food, rent])
    await db.flush()
    rows = [
        (date(2025, 12, 1), food, "500.00"),
        (date(2025, 12, 1), rent, "2000.00"),
        (date(2026, 1, 1), food, "400.00"),  # rent missing that month
        (date(2026, 2, 1), food, "0.00"),
        (date(2026, 2, 1), rent, "2100.00"),
    ]
    for month, cat, amount in rows:
        db.add(MonthlySpending(month=month, category_id=cat.id, amount=Decimal(amount)))
    db.add(MonthlyCashflow(month=date(2025, 12, 1), net_pay=Decimal("10000.00")))
    db.add(MonthlyCashflow(month=date(2026, 2, 1), net_pay=Decimal("0.00")))
    # Investable base: one snapshot at 2026-01 -> 4% line null in Dec, set from Jan on.
    account = Account(name="Brokerage", slug="brokerage", group="taxable", sort_order=1)
    snap = NetWorthSnapshot(month=date(2026, 1, 1))
    db.add_all([account, snap])
    await db.flush()
    db.add(AccountBalance(snapshot_id=snap.id, account_id=account.id, balance=Decimal("300000.00")))
    await db.commit()
    return food, rent


async def test_matrix_shapes_totals_savings_and_four_pct(auth_client, db):
    food, rent = await _seed_spending(db)
    resp = await auth_client.get("/api/v1/spending/matrix")
    assert resp.status_code == 200
    body = resp.json()
    assert body["months"] == ["2025-12-01", "2026-01-01", "2026-02-01"]
    by_id = {s["category_id"]: s["values"] for s in body["series"]}
    assert by_id[food.id] == ["500.00", "400.00", "0.00"]
    assert by_id[rent.id] == ["2000.00", None, "2100.00"]
    assert body["totals"] == ["2500.00", "400.00", "2100.00"]
    assert body["net_pay"] == ["10000.00", None, "0.00"]
    # (10000-2500)/10000; None without net_pay; None on zero net_pay (division guard)
    assert body["savings_rate"] == ["0.750000", None, None]
    # No snapshot on/before Dec; 300000*0.04/12 = 1000.00 for Jan + Feb (seeded swr 0.04)
    assert body["four_pct_rule"] == [None, "1000.00", "1000.00"]


async def test_matrix_range_filter_and_validation(auth_client, db):
    await _seed_spending(db)
    resp = await auth_client.get("/api/v1/spending/matrix?start=2026-01-01&end=2026-01-01")
    assert resp.json()["months"] == ["2026-01-01"]
    assert (await auth_client.get("/api/v1/spending/matrix?start=2026-01-15")).status_code == 422


async def test_matrix_includes_cashflow_only_months(auth_client, db):
    db.add(MonthlyCashflow(month=date(2026, 3, 1), net_pay=Decimal("5000.00")))
    await db.commit()
    body = (await auth_client.get("/api/v1/spending/matrix")).json()
    assert body["months"] == ["2026-03-01"]
    assert body["totals"] == ["0.00"]
    assert body["savings_rate"] == ["1.000000"]  # no spend recorded yet


async def test_yearly_rollups(auth_client, db):
    food, rent = await _seed_spending(db)
    resp = await auth_client.get("/api/v1/spending/yearly")
    body = resp.json()
    years = {y["year"]: y for y in body["years"]}
    assert set(years) == {2025, 2026}
    y25 = years[2025]
    assert y25["total"] == "2500.00"
    assert y25["net_pay_total"] == "10000.00"
    assert y25["savings_rate"] == "0.750000"
    assert {c["category_id"]: c["total"] for c in y25["by_category"]} == {
        food.id: "500.00",
        rent.id: "2000.00",
    }
    y26 = years[2026]
    assert y26["total"] == "2500.00"  # 400 + 0 + 2100
    assert y26["net_pay_total"] == "0.00"
    assert y26["savings_rate"] is None  # zero net pay -> undefined, not -inf


async def test_get_spending_month(auth_client, db):
    food, rent = await _seed_spending(db)
    body = (await auth_client.get("/api/v1/spending/months/2025-12-01")).json()
    assert body["exists"] is True
    assert body["net_pay"] == "10000.00"
    assert {a["category_id"]: a["amount"] for a in body["amounts"]} == {
        food.id: "500.00",
        rent.id: "2000.00",
    }
    empty = (await auth_client.get("/api/v1/spending/months/2030-01-01")).json()
    assert empty == {
        "month": "2030-01-01",
        "exists": False,
        "net_pay": None,
        "amounts": [],
        "budgets": [],
    }
    assert (await auth_client.get("/api/v1/spending/months/2030-01-02")).status_code == 422


async def test_put_spending_month_upserts_and_net_pay_optional(auth_client, db):
    food, rent = await _seed_spending(db)
    put = "/api/v1/spending/months/2026-03-01"
    resp = await auth_client.put(
        put,
        json={
            "net_pay": "9000.005",
            "amounts": [
                {"category_id": food.id, "amount": "123.456"},
                {"category_id": rent.id, "amount": "2100.00"},
            ],
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {
        "month": "2026-03-01",
        "created": 2,
        "updated": 0,
        "unchanged": 0,
        "net_pay_set": True,
        "net_pay_cleared": False,
        # Rows changed, so the PUT logged a change batch (2026-09-03 data-lifecycle spec 9).
        "batch_id": ANY,
    }
    assert resp.json()["batch_id"] is not None
    read = (await auth_client.get(put)).json()
    assert read["net_pay"] == "9000.01"  # HALF_UP
    assert {a["category_id"]: a["amount"] for a in read["amounts"]}[food.id] == "123.46"

    # Omitting net_pay leaves it untouched; identical amount counts unchanged.
    resp = await auth_client.put(
        put,
        json={
            "amounts": [{"category_id": food.id, "amount": "123.46"}],
        },
    )
    assert resp.json() == {
        "month": "2026-03-01",
        "created": 0,
        "updated": 0,
        "unchanged": 1,
        "net_pay_set": False,
        "net_pay_cleared": False,
        "batch_id": None,
    }
    assert (await auth_client.get(put)).json()["net_pay"] == "9000.01"


async def test_put_spending_month_validation(auth_client, db):
    food, rent = await _seed_spending(db)
    put = "/api/v1/spending/months/2026-03-01"
    assert (
        await auth_client.put(
            put,
            json={
                "amounts": [
                    {"category_id": food.id, "amount": "1"},
                    {"category_id": food.id, "amount": "2"},
                ]
            },
        )
    ).status_code == 422
    assert (
        await auth_client.put(
            put,
            json={
                "amounts": [
                    {"category_id": 999, "amount": "1"},
                ]
            },
        )
    ).status_code == 422
    # Out-of-int32 ids are stopped by pydantic, not asyncpg.
    assert (
        await auth_client.put(
            put,
            json={
                "amounts": [
                    {"category_id": 10**12, "amount": "1"},
                ]
            },
        )
    ).status_code == 422
    assert (await auth_client.put("/api/v1/spending/months/2026-03-15", json={})).status_code == 422
    # Take-home pay can't be negative (savings-rate denominator sanity).
    assert (await auth_client.put(put, json={"net_pay": "-1", "amounts": []})).status_code == 422
    # Numeric(12,2) columns hold only 10 integer digits — bound enforced pre-write
    # (10^10..10^12 would pass the 14,2 bound and then 500 as DBAPIError 22003).
    assert (
        await auth_client.put(
            put,
            json={
                "amounts": [
                    {"category_id": food.id, "amount": "10000000000"},
                ]
            },
        )
    ).status_code == 422
    assert (
        await auth_client.put(put, json={"net_pay": "10000000000", "amounts": []})
    ).status_code == 422


async def test_put_spending_month_net_pay_null_clears(auth_client):
    # Arrange: a month with net_pay set.
    put = "/api/v1/spending/months/2026-08-01"
    resp = await auth_client.put(put, json={"net_pay": "9000.00", "amounts": []})
    assert resp.status_code == 200, resp.text
    assert resp.json()["net_pay_set"] is True

    # Act: an EXPLICIT null clears it (deletes the cashflow row), unlike an omitted field.
    cleared = await auth_client.put(put, json={"net_pay": None, "amounts": []})
    assert cleared.status_code == 200, cleared.text
    body = cleared.json()
    assert body["net_pay_set"] is False
    assert body["net_pay_cleared"] is True

    got = (await auth_client.get(put)).json()
    assert got["net_pay"] is None
    assert got["exists"] is False  # no amounts either -> the month is gone entirely


async def test_put_spending_month_net_pay_omitted_is_still_a_no_op(auth_client):
    put = "/api/v1/spending/months/2026-07-01"
    await auth_client.put(put, json={"net_pay": "5000.00", "amounts": []})
    result = (await auth_client.put(put, json={"amounts": []})).json()
    assert result["net_pay_set"] is False
    assert result["net_pay_cleared"] is False
    assert (await auth_client.get(put)).json()["net_pay"] == "5000.00"


async def test_put_spending_month_net_pay_null_on_a_month_without_one_is_harmless(auth_client):
    put = "/api/v1/spending/months/2026-06-01"
    result = await auth_client.put(put, json={"net_pay": None, "amounts": []})
    assert result.status_code == 200, result.text
    body = result.json()
    assert body["net_pay_cleared"] is False  # nothing existed to clear
    assert body["net_pay_set"] is False


async def test_put_spending_month_net_pay_null_rides_along_with_amounts(auth_client, db):
    # The wizard's production payload: it always ships the full amounts list, and a null
    # net_pay rides along when a saved one was blanked. The delete and the upserts share
    # ONE transaction — an early-return refactor of the clear branch would regress exactly
    # this (the amounts would be dropped, or the clear would never commit).
    food, _rent = await _seed_spending(db)
    put = "/api/v1/spending/months/2026-09-01"
    entry = {"category_id": food.id, "amount": "250.00"}
    first = await auth_client.put(put, json={"net_pay": "9000.00", "amounts": [entry]})
    assert first.status_code == 200, first.text
    assert first.json()["net_pay_set"] is True

    cleared = await auth_client.put(put, json={"net_pay": None, "amounts": [entry]})
    assert cleared.status_code == 200, cleared.text
    body = cleared.json()
    assert body["net_pay_cleared"] is True
    assert body["net_pay_set"] is False
    assert body["unchanged"] == 1  # the amount rode through the clear untouched

    got = (await auth_client.get(put)).json()
    assert got["exists"] is True  # the month survives on its amounts alone
    assert got["net_pay"] is None
    assert {a["category_id"]: a["amount"] for a in got["amounts"]} == {food.id: "250.00"}


async def test_delete_month_removes_spending_and_cashflow(auth_client, db):
    await _seed_spending(db)
    resp = await auth_client.delete("/api/v1/spending/months/2025-12-01")
    assert resp.status_code == 204
    read = (await auth_client.get("/api/v1/spending/months/2025-12-01")).json()
    assert read["exists"] is False
    assert read["amounts"] == []
    assert read["net_pay"] is None
    # The deleted month disappears from the matrix (spec §B2's read-side check).
    body = (await auth_client.get("/api/v1/spending/matrix")).json()
    assert body["months"] == ["2026-01-01", "2026-02-01"]
    assert await db.get(MonthlyCashflow, date(2025, 12, 1)) is None


async def test_delete_month_handles_each_half_alone(auth_client, db):
    await _seed_spending(db)
    # Spending-only month (2026-01 has no cashflow row): still deletes.
    assert (await auth_client.delete("/api/v1/spending/months/2026-01-01")).status_code == 204
    assert (await auth_client.get("/api/v1/spending/months/2026-01-01")).json()["exists"] is False
    # Cashflow-only month: seed one, delete it.
    db.add(MonthlyCashflow(month=date(2026, 4, 1), net_pay=Decimal("5000.00")))
    await db.commit()
    assert (await auth_client.delete("/api/v1/spending/months/2026-04-01")).status_code == 204
    assert await db.get(MonthlyCashflow, date(2026, 4, 1)) is None


async def test_delete_month_404_when_nothing_exists_and_422_on_a_mid_month_date(auth_client, db):
    await _seed_spending(db)
    assert (await auth_client.delete("/api/v1/spending/months/2030-01-01")).status_code == 404
    assert (await auth_client.delete("/api/v1/spending/months/2030-01-02")).status_code == 422
    # Neither rejection deleted anything.
    body = (await auth_client.get("/api/v1/spending/matrix")).json()
    assert body["months"] == ["2025-12-01", "2026-01-01", "2026-02-01"]


async def test_budget_put_upserts_and_returns_full_history(auth_client, db):
    food, _rent = await _seed_spending(db)
    url = f"/api/v1/spending/categories/{food.id}/budget"
    first = await auth_client.put(url, json={"amount": "400.005", "effective_month": "2026-01-01"})
    assert first.status_code == 200, first.text
    assert first.json() == [{"effective_month": "2026-01-01", "amount": "400.01"}]  # HALF_UP

    second = await auth_client.put(url, json={"amount": "450", "effective_month": "2026-03-01"})
    assert second.json() == [
        {"effective_month": "2026-01-01", "amount": "400.01"},
        {"effective_month": "2026-03-01", "amount": "450.00"},
    ]

    # Same (category, month) again = upsert, not a duplicate — last write wins.
    third = await auth_client.put(url, json={"amount": "500", "effective_month": "2026-03-01"})
    assert third.json() == [
        {"effective_month": "2026-01-01", "amount": "400.01"},
        {"effective_month": "2026-03-01", "amount": "500.00"},
    ]

    # NULL amount is the dated end-of-budget marker and stores as a real history row.
    ended = await auth_client.put(url, json={"amount": None, "effective_month": "2026-06-01"})
    assert ended.json()[-1] == {"effective_month": "2026-06-01", "amount": None}


async def test_budget_put_validation(auth_client, db):
    food, _rent = await _seed_spending(db)
    url = f"/api/v1/spending/categories/{food.id}/budget"
    assert (
        await auth_client.put(url, json={"amount": "1", "effective_month": "2026-01-15"})
    ).status_code == 422
    assert (
        await auth_client.put(url, json={"amount": "-1", "effective_month": "2026-01-01"})
    ).status_code == 422
    # Numeric(12,2) holds only 10 integer digits — same pre-write bound as monthly amounts.
    assert (
        await auth_client.put(url, json={"amount": "10000000000", "effective_month": "2026-01-01"})
    ).status_code == 422
    # amount is REQUIRED (nullable, not omittable): {} must 422, not silently mean null.
    assert (await auth_client.put(url, json={"effective_month": "2026-01-01"})).status_code == 422
    assert (
        await auth_client.put(
            "/api/v1/spending/categories/999/budget",
            json={"amount": "1", "effective_month": "2026-01-01"},
        )
    ).status_code == 404


async def test_budget_delete_removes_a_history_row(auth_client, db):
    food, _rent = await _seed_spending(db)
    url = f"/api/v1/spending/categories/{food.id}/budget"
    await auth_client.put(url, json={"amount": "400", "effective_month": "2026-01-01"})
    await auth_client.put(url, json={"amount": "450", "effective_month": "2026-03-01"})

    gone = await auth_client.delete(f"{url}/2026-03-01")
    assert gone.status_code == 204
    # The next PUT's echoed history shows only the surviving row.
    after = await auth_client.put(url, json={"amount": "400", "effective_month": "2026-01-01"})
    assert after.json() == [{"effective_month": "2026-01-01", "amount": "400.00"}]

    assert (await auth_client.delete(f"{url}/2026-03-01")).status_code == 404
    assert (await auth_client.delete(f"{url}/2026-03-15")).status_code == 422
    assert (
        await auth_client.delete("/api/v1/spending/categories/999/budget/2026-01-01")
    ).status_code == 404


async def test_matrix_budgets_resolution_rule_and_total(auth_client, db):
    food, rent = await _seed_spending(db)  # months: 2025-12, 2026-01, 2026-02
    put_food = f"/api/v1/spending/categories/{food.id}/budget"
    put_rent = f"/api/v1/spending/categories/{rent.id}/budget"
    # Food: starts in Jan at 450, steps to 350 in Feb. Rent: never budgeted.
    await auth_client.put(put_food, json={"amount": "450.00", "effective_month": "2026-01-01"})
    await auth_client.put(put_food, json={"amount": "350.00", "effective_month": "2026-02-01"})

    body = (await auth_client.get("/api/v1/spending/matrix")).json()
    by_id = {s["category_id"]: s["budgets"] for s in body["series"]}
    # No row on/before Dec -> None; Jan row -> 450; Feb: the GREATEST effective <= M wins.
    assert by_id[food.id] == [None, "450.00", "350.00"]
    assert by_id[rent.id] == [None, None, None]
    # total_budget: None when NO category has one; else the sum of those that do.
    assert body["total_budget"] == [None, "450.00", "350.00"]

    # Rent joins in Feb: the total adds across categories from that month on.
    await auth_client.put(put_rent, json={"amount": "2000.00", "effective_month": "2026-02-01"})
    body = (await auth_client.get("/api/v1/spending/matrix")).json()
    assert body["total_budget"] == [None, "450.00", "2350.00"]


async def test_matrix_budget_null_marker_and_redated_past_row(auth_client, db):
    food, _rent = await _seed_spending(db)
    url = f"/api/v1/spending/categories/{food.id}/budget"
    await auth_client.put(url, json={"amount": "450.00", "effective_month": "2026-01-01"})
    # NULL from Feb on: Jan keeps its budget (history is frozen), Feb reads unbudgeted.
    await auth_client.put(url, json={"amount": None, "effective_month": "2026-02-01"})
    body = (await auth_client.get("/api/v1/spending/matrix")).json()
    assert {s["category_id"]: s["budgets"] for s in body["series"]}[food.id] == [
        None,
        "450.00",
        None,
    ]
    assert body["total_budget"] == [None, "450.00", None]

    # Re-dating the past: a row placed at Dec 2025 rewrites what THAT era's budget was
    # (spec §4.2's deliberate editor behavior, pinned here at the resolution layer).
    await auth_client.put(url, json={"amount": "500.00", "effective_month": "2025-12-01"})
    body = (await auth_client.get("/api/v1/spending/matrix")).json()
    assert {s["category_id"]: s["budgets"] for s in body["series"]}[food.id] == [
        "500.00",
        "450.00",
        None,
    ]


async def test_get_month_resolves_budgets_for_arbitrary_months(auth_client, db):
    food, _rent = await _seed_spending(db)
    url = f"/api/v1/spending/categories/{food.id}/budget"
    await auth_client.put(url, json={"amount": "450.00", "effective_month": "2026-03-01"})
    # 2026-04 is NOT an entered month (no matrix row) — the wizard's usual case: the
    # budget effective in March must still resolve for it (spec §4.1).
    body = (await auth_client.get("/api/v1/spending/months/2026-04-01")).json()
    assert body["budgets"] == [{"category_id": food.id, "amount": "450.00"}]
    # Before the first effective row: unbudgeted, and unbudgeted categories are OMITTED.
    body = (await auth_client.get("/api/v1/spending/months/2026-02-01")).json()
    assert body["budgets"] == []
    # A NULL end-marker removes it from that month on.
    await auth_client.put(url, json={"amount": None, "effective_month": "2026-05-01"})
    body = (await auth_client.get("/api/v1/spending/months/2026-05-01")).json()
    assert body["budgets"] == []


async def test_category_kind_round_trips_through_create_list_and_patch(auth_client):
    default = (await auth_client.post("/api/v1/spending/categories", json={"name": "Food"})).json()
    assert default["kind"] == "living"  # omitted kind is the honest default

    created = await auth_client.post(
        "/api/v1/spending/categories", json={"name": "Taxes", "kind": "tax"}
    )
    assert created.status_code == 201, created.text
    assert created.json()["kind"] == "tax"

    listed = (await auth_client.get("/api/v1/spending/categories")).json()
    assert {c["name"]: c["kind"] for c in listed} == {"Food": "living", "Taxes": "tax"}

    patched = await auth_client.patch(
        f"/api/v1/spending/categories/{default['id']}", json={"kind": "transfer"}
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["kind"] == "transfer"
    # A kind change must not disturb the row's other columns.
    assert patched.json()["name"] == "Food" and patched.json()["is_active"] is True


async def test_category_kind_vocabulary_is_refused_at_the_api_edge(auth_client):
    bad = await auth_client.post(
        "/api/v1/spending/categories", json={"name": "Savings", "kind": "savings"}
    )
    assert bad.status_code == 422
    made = (await auth_client.post("/api/v1/spending/categories", json={"name": "Pets"})).json()
    assert (
        await auth_client.patch(f"/api/v1/spending/categories/{made['id']}", json={"kind": "misc"})
    ).status_code == 422
