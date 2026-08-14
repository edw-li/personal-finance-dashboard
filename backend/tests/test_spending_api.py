from datetime import date
from decimal import Decimal

from app.models import MonthlySpending, SpendingCategory


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
