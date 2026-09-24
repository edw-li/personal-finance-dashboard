from datetime import date
from decimal import Decimal

from app.models import MonthlyCashflow, MonthlySpending, NetWorthSnapshot, SpendingCategory
from app.services import clock


def on(monkeypatch, day: date) -> None:
    """The missing windows end at the newest OVERDUE month (2026-09-23 spec §K3), so every
    window here is read on a pinned day."""
    monkeypatch.setattr(clock, "product_today", lambda: day)


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
        "review_months": [],
        "default_month": None,
        "adopted_on": None,
        "eligible_spending": [],
        "eligible_savings": [],
        # 2026-09-23 spec §K3: nothing recorded, nothing due — `time` is null on an empty book.
        "time": None,
    }


async def test_coverage_lists_each_feed_ascending_and_deduplicated(auth_client, db, monkeypatch):
    on(monkeypatch, date(2026, 4, 20))  # March's flows are overdue: the window is Jan..Mar
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
    expected = {
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
    assert {key: body[key] for key in expected} == expected
    assert body["default_month"] is None  # Enteredness does not certify review.
    assert body["eligible_spending"] == []
    assert [row["month"] for row in body["review_months"]] == [
        "2026-01-01",
        "2026-02-01",
        "2026-03-01",
    ]


async def test_coverage_lists_entered_empty_and_missing_spending_months(
    auth_client, db, monkeypatch
):
    on(monkeypatch, date(2026, 10, 20))  # September's flows are overdue: the window is Jul..Sep
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


async def test_an_early_next_month_snapshot_and_the_month_in_progress_miss_nothing(
    auth_client, db, monkeypatch
):
    """The copy on Sep 23 (2026-09-23 spec §K3 acceptance): an early Oct snapshot and September
    under way — `spending_missing` and `net_pay_missing` are empty (they were [Oct], [Sep, Oct])."""
    on(monkeypatch, date(2026, 9, 23))
    cat = SpendingCategory(name="Rent", slug="rent", sort_order=1)
    db.add(cat)
    await db.flush()
    db.add_all(
        [
            NetWorthSnapshot(month=date(2026, 8, 1), recorded_on=date(2026, 8, 1)),
            NetWorthSnapshot(month=date(2026, 9, 1), recorded_on=date(2026, 9, 1)),
            NetWorthSnapshot(month=date(2026, 10, 1), recorded_on=date(2026, 9, 22)),
            MonthlySpending(month=date(2026, 8, 1), category_id=cat.id, amount=Decimal("2000.00")),
            MonthlySpending(month=date(2026, 9, 1), category_id=cat.id, amount=Decimal("2072.23")),
            MonthlyCashflow(month=date(2026, 8, 1), net_pay=Decimal("6000.00")),
        ]
    )
    await db.commit()
    body = (await auth_client.get("/api/v1/coverage")).json()
    assert (body["spending_missing"], body["net_pay_missing"]) == ([], [])
    time = body["time"]
    assert (time["today"], time["current_month"], time["reminder_day"]) == (
        "2026-09-23",
        "2026-09-01",
        1,
    )
    assert time["balances"] == {
        "month": "2026-09-01",
        "status": "final",
        "due_on": "2026-09-01",
        "overdue_from": "2026-09-07",
        "overdue": False,
        "snapshot": {
            "month": "2026-09-01",
            "as_of": "2026-09-01",
            "recorded_on": "2026-09-01",
            "provisional": False,
        },
    }
    assert time["current_snapshot"] == {
        "month": "2026-10-01",
        "as_of": "2026-09-22",
        "recorded_on": "2026-09-22",
        "provisional": True,
    }
    assert time["previous_snapshot"]["month"] == "2026-09-01"
    assert (time["flows_due"], time["provisional_past"], time["last_complete_month"]) == (
        [],
        [],
        None,
    )


async def test_on_oct_16_september_is_due_and_overdue(auth_client, db, monkeypatch):
    on(monkeypatch, date(2026, 10, 16))
    db.add(NetWorthSnapshot(month=date(2026, 9, 1), recorded_on=date(2026, 9, 1)))
    await db.commit()
    time = (await auth_client.get("/api/v1/coverage")).json()["time"]
    assert [
        (p["month"], p["spending"], p["take_home_entered"], p["overdue"]) for p in time["flows_due"]
    ] == [("2026-09-01", "missing", False, True)]
    assert (time["balances"]["status"], time["balances"]["overdue"]) == ("missing", True)
