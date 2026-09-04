from datetime import date
from decimal import Decimal

from app.config import settings
from app.models import MonthlySpending, SpendingCategory

HEALTH = "/api/v1/system/health"


async def test_health_requires_auth(client):
    assert (await client.get(HEALTH)).status_code == 401


async def test_health_shape_on_a_bare_database(auth_client):
    resp = await auth_client.get(HEALTH)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["checked_at"].endswith("+00:00") or body["checked_at"].endswith("Z")
    ids = [c["id"] for c in body["checks"]]
    assert ids == [
        "zero_filled_spending",
        "spending_gap",
        "net_pay_without_spending",
        "balances_without_spending",
        "spending_without_balances",
        "stale_quotes",
        "identical_snapshot",
        "backup",
        "snapshot",
    ]
    backup = next(c for c in body["checks"] if c["id"] == "backup")
    assert backup["severity"] == "info" and backup["title"] == "Backups are not configured here"
    # conftest pins snapshot_enabled off, exactly as the scheduler.
    assert next(c for c in body["checks"] if c["id"] == "snapshot")["severity"] == "ok"


async def test_health_reads_the_live_settings(auth_client, monkeypatch):
    monkeypatch.setattr(settings, "environment", "prod")
    monkeypatch.setattr(settings, "snapshot_enabled", True)
    body = (await auth_client.get(HEALTH)).json()
    backup = next(c for c in body["checks"] if c["id"] == "backup")
    assert backup["severity"] == "error" and backup["fix"]["to"] == "/settings#backups"
    snapshot = next(c for c in body["checks"] if c["id"] == "snapshot")
    assert snapshot["severity"] == "warn" and snapshot["fix"]["action"] == "snapshot_now"


async def test_health_names_a_zero_filled_month_with_the_repair(auth_client, db):
    category = SpendingCategory(name="Food", slug="food", sort_order=1)
    db.add(category)
    await db.flush()
    db.add(MonthlySpending(month=date(2026, 9, 1), category_id=category.id, amount=Decimal("0.00")))
    await db.commit()
    checks = (await auth_client.get(HEALTH)).json()["checks"]
    check = next(c for c in checks if c["id"] == "zero_filled_spending")
    assert check["severity"] == "error" and check["months"] == ["2026-09-01"]
    assert check["fix"] == {
        "kind": "action",
        "label": "Delete the zero-filled month",
        "to": None,
        "action": "delete_spending_month",
    }
