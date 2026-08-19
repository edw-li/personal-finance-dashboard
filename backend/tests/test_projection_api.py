from datetime import date
from decimal import Decimal

from app.models import (
    Account,
    AccountBalance,
    MonthlyCashflow,
    MonthlySpending,
    NetWorthSnapshot,
    SpendingCategory,
)

# The projection anchors on date.today() (the router's one clock read), so the seeds are
# built RELATIVE to the run's own month — nothing here goes stale with the calendar.


def month_add(start: date, delta: int) -> date:
    base = start.year * 12 + (start.month - 1) + delta
    return date(base // 12, base % 12 + 1, 1)


async def _seed_book(db, *, with_history: bool = True) -> date:
    """One snapshot of the four group flavours + (optionally) two months of spend/pay.

    Investable = the taxable account alone (cash, the component and the liability are all
    excluded by net_worth_calc's rule): 100,000. With history: trailing spend mean 5,000
    (6,000 and 4,000), trailing savings mean 4,000 (9,000 net pay both months).
    """
    this_month = date.today().replace(day=1)
    taxable = Account(name="Brokerage", slug="brokerage", group="taxable", sort_order=1)
    cash = Account(name="Checking", slug="checking", group="cash", sort_order=2)
    bucket = Account(name="Bucket", slug="bucket", group="taxable", sort_order=3, is_component=True)
    card = Account(name="Card", slug="card", group="liability", sort_order=4)
    snap = NetWorthSnapshot(month=this_month)
    db.add_all([taxable, cash, bucket, card, snap])
    await db.flush()
    db.add_all(
        [
            AccountBalance(
                snapshot_id=snap.id, account_id=taxable.id, balance=Decimal("100000.00")
            ),
            AccountBalance(snapshot_id=snap.id, account_id=cash.id, balance=Decimal("5000.00")),
            AccountBalance(snapshot_id=snap.id, account_id=bucket.id, balance=Decimal("300.00")),
            AccountBalance(snapshot_id=snap.id, account_id=card.id, balance=Decimal("-2000.00")),
        ]
    )
    if with_history:
        cat = SpendingCategory(name="Rent", slug="rent", sort_order=1)
        db.add(cat)
        await db.flush()
        m1, m2 = month_add(this_month, -1), month_add(this_month, -2)
        db.add_all(
            [
                MonthlySpending(month=m1, category_id=cat.id, amount=Decimal("6000.00")),
                MonthlySpending(month=m2, category_id=cat.id, amount=Decimal("4000.00")),
                MonthlyCashflow(month=m1, net_pay=Decimal("9000.00")),
                MonthlyCashflow(month=m2, net_pay=Decimal("9000.00")),
            ]
        )
    await db.commit()
    return this_month


async def test_projection_requires_auth(client):
    assert (await client.get("/api/v1/projection")).status_code == 401


async def test_projection_404_without_snapshots(auth_client):
    resp = await auth_client.get("/api/v1/projection")
    assert resp.status_code == 404
    assert "no net-worth snapshots" in resp.json()["detail"]


async def test_projection_defaults_derive_from_the_data(auth_client, db):
    this_month = await _seed_book(db)
    resp = await auth_client.get("/api/v1/projection")
    assert resp.status_code == 200, resp.text
    body = resp.json()

    # The starting balance is net_worth_calc's investable rule: the taxable account only.
    assert body["starting_balance"] == "100000.00"
    assert body["base_month"] == this_month.isoformat()
    assert body["start_month"] == this_month.isoformat()
    # Echoed knobs: seeded default return, derived contribution and spend, seeded SWR.
    assert body["annual_return"] == "0.05"
    assert body["monthly_contribution"] == "4000.00"  # mean of (9000-6000, 9000-4000)
    assert body["annual_spend"] == "60000.00"  # mean(6000, 4000) x 12
    assert body["swr_pct"] == "0.04"
    assert body["years"] == 30
    assert body["warnings"] == []

    # FI figures: 60,000 / 0.04 and the ratio at 6dp HALF_UP.
    assert body["fi_target"] == "1500000.00"
    assert body["fi_ratio"] == "0.066667"

    # Parallel arrays: 30y x 12 + t0, t0 = the current month at the starting balance.
    assert len(body["months"]) == 361
    assert len(body["projected"]) == 361
    assert len(body["coast"]) == 361
    assert body["months"][0] == this_month.isoformat()
    assert body["projected"][0] == "100000.00"
    assert body["coast"][0] == "100000.00"
    # Growth + contributions reach the target inside the horizon; growth alone (5%/yr on
    # 100k toward 1.5M needs ~67 years) does not.
    assert body["fi_month"] is not None
    assert body["coast_fi_month"] is None


async def test_projection_zero_return_is_an_exact_chain(auth_client, db):
    this_month = await _seed_book(db)
    resp = await auth_client.get("/api/v1/projection?annual_return=0")
    body = resp.json()

    # r = 0 collapses the compounding to plain addition — the chain is exact and pins the
    # engine: 100,000 + 4,000/month, while the coast line never moves.
    assert body["projected"][1] == "104000.00"
    assert body["projected"][2] == "108000.00"
    assert body["coast"][1] == "100000.00"
    # 100,000 + 4,000 x i >= 1,500,000 first at i = 350.
    assert body["fi_month"] == month_add(this_month, 350).isoformat()
    assert body["coast_fi_month"] is None
    assert body["warnings"] == []


async def test_projection_echoes_and_applies_every_knob(auth_client, db):
    await _seed_book(db)
    resp = await auth_client.get(
        "/api/v1/projection"
        "?annual_return=0.07&monthly_contribution=1234.567&annual_spend=48000&swr=0.035&years=10"
    )
    body = resp.json()
    assert body["annual_return"] == "0.070000"  # quantize_pct's 6dp
    assert body["monthly_contribution"] == "1234.57"  # money quantum
    assert body["annual_spend"] == "48000.00"
    assert body["swr_pct"] == "0.035000"
    assert body["years"] == 10
    assert body["fi_target"] == "1371428.57"  # 48,000 / 0.035, cents HALF_UP
    assert len(body["months"]) == 121


async def test_projection_bounds_every_knob(auth_client, db):
    await _seed_book(db)

    resp = await auth_client.get("/api/v1/projection?annual_return=0.9")
    assert resp.status_code == 422
    assert resp.json()["detail"] == "annual_return must be between -0.5 and 0.5"

    for bad_swr in ("0", "1.5"):
        resp = await auth_client.get(f"/api/v1/projection?swr={bad_swr}")
        assert resp.status_code == 422
        assert resp.json()["detail"] == "swr must be greater than 0 and at most 1"

    resp = await auth_client.get("/api/v1/projection?annual_spend=-1")
    assert resp.status_code == 422
    assert resp.json()["detail"] == "annual_spend must be positive"

    # The money-vocabulary bound (10^7 for a monthly figure), via money.py.
    resp = await auth_client.get("/api/v1/projection?monthly_contribution=100000000")
    assert resp.status_code == 422
    assert "monthly_contribution" in resp.json()["detail"]

    # FastAPI's own Query bounds on the horizon.
    assert (await auth_client.get("/api/v1/projection?years=0")).status_code == 422
    assert (await auth_client.get("/api/v1/projection?years=61")).status_code == 422


async def test_projection_degrades_without_history(auth_client, db):
    await _seed_book(db, with_history=False)
    resp = await auth_client.get("/api/v1/projection")
    assert resp.status_code == 200, resp.text
    body = resp.json()

    # No cashflow: contribution defaults to 0 and says so. No spending: no FI target at
    # all — nulls, never invented numbers.
    assert body["monthly_contribution"] == "0.00"
    assert body["annual_spend"] is None
    assert body["fi_target"] is None
    assert body["fi_ratio"] is None
    assert body["fi_month"] is None
    assert "no cashflow history — monthly contribution defaulted to 0" in body["warnings"]
    assert (
        "no spending history — provide an annual spend to model the FI target" in body["warnings"]
    )


async def test_projection_names_an_unreachable_horizon(auth_client, db):
    await _seed_book(db)
    resp = await auth_client.get(
        "/api/v1/projection?annual_return=0&monthly_contribution=0&annual_spend=60000&years=1"
    )
    body = resp.json()
    assert body["fi_month"] is None
    assert body["fi_ratio"] == "0.066667"  # the ratio still reads — only the date is out
    assert any("not reached within the 1-year horizon" in w for w in body["warnings"])
