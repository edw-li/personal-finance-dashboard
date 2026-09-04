from datetime import date
from decimal import Decimal

from app.models import MonthlyCashflow, MonthlySpending, NetWorthSnapshot, SpendingCategory


async def test_coverage_requires_auth(client):
    assert (await client.get("/api/v1/coverage")).status_code == 401


async def test_coverage_is_empty_on_an_empty_book(auth_client):
    resp = await auth_client.get("/api/v1/coverage")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {
        "balances": [],
        "spending": [],
        "net_pay": [],
        "spending_empty": [],
        "spending_missing": [],
        "net_pay_missing": [],
        "latest": {"balances": None, "spending": None, "net_pay": None},
    }


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
        # ENTERED, not "has rows" (spec §3): February's amounts are non-zero, and January
        # is entered on its take-home row alone even though no category was ever typed.
        "spending": ["2026-01-01", "2026-02-01"],
        "net_pay": ["2026-01-01"],
        "spending_empty": [],
        # March is inside the balances window with nothing at all on file.
        "spending_missing": ["2026-03-01"],
        "net_pay_missing": ["2026-02-01", "2026-03-01"],
        "latest": {
            "balances": "2026-03-01",
            "spending": "2026-02-01",
            "net_pay": "2026-01-01",
        },
    }


async def test_coverage_lists_entered_empty_and_missing_spending_months(auth_client, db):
    cat = SpendingCategory(name="Rent", slug="rent", sort_order=1)
    db.add(cat)
    await db.flush()
    db.add_all(
        [
            NetWorthSnapshot(month=date(2026, 7, 1)),
            NetWorthSnapshot(month=date(2026, 9, 1)),
            MonthlySpending(month=date(2026, 7, 1), category_id=cat.id, amount=Decimal("2172.00")),
            # September: 19 rows of $0.00 and no take-home — production's phantom month.
            MonthlySpending(month=date(2026, 9, 1), category_id=cat.id, amount=Decimal("0.00")),
            MonthlyCashflow(month=date(2026, 7, 1), net_pay=Decimal("6373.09")),
        ]
    )
    await db.commit()
    body = (await auth_client.get("/api/v1/coverage")).json()
    # `spending` now lists ENTERED months only: the footer says "through Jul", not "Sep".
    assert body["spending"] == ["2026-07-01"]
    assert body["spending_empty"] == ["2026-09-01"]
    assert body["spending_missing"] == ["2026-08-01"]
    assert body["net_pay_missing"] == ["2026-08-01", "2026-09-01"]
    assert body["latest"] == {
        "balances": "2026-09-01",
        "spending": "2026-07-01",
        "net_pay": "2026-07-01",
    }
