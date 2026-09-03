from datetime import date
from decimal import Decimal

from app.models import MonthlyCashflow, MonthlySpending, NetWorthSnapshot, SpendingCategory


async def test_coverage_requires_auth(client):
    assert (await client.get("/api/v1/coverage")).status_code == 401


async def test_coverage_is_empty_on_an_empty_book(auth_client):
    resp = await auth_client.get("/api/v1/coverage")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"balances": [], "spending": [], "net_pay": []}


async def test_coverage_lists_each_feed_ascending_and_deduplicated(auth_client, db):
    cat = SpendingCategory(name="Rent", slug="rent", sort_order=1)
    db.add(cat)
    await db.flush()
    db.add_all(
        [
            NetWorthSnapshot(month=date(2026, 3, 1)),
            NetWorthSnapshot(month=date(2026, 1, 1)),
            # Two rows in one month collapse to one coverage entry.
            MonthlySpending(month=date(2026, 2, 1), category_id=cat.id, amount=Decimal("10.00")),
            MonthlyCashflow(month=date(2026, 1, 1), net_pay=Decimal("5000.00")),
        ]
    )
    cat2 = SpendingCategory(name="Food", slug="food", sort_order=2)
    db.add(cat2)
    await db.flush()
    db.add(MonthlySpending(month=date(2026, 2, 1), category_id=cat2.id, amount=Decimal("20.00")))
    await db.commit()

    body = (await auth_client.get("/api/v1/coverage")).json()
    assert body == {
        "balances": ["2026-01-01", "2026-03-01"],
        "spending": ["2026-02-01"],
        "net_pay": ["2026-01-01"],
    }
