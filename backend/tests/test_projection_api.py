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
from app.services.projection import project

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


# --- Monte Carlo: the three knobs, the bands block, and the back-compat pin ---

# CAPTURED FROM THE ENDPOINT BEFORE THE KNOBS EXISTED (every point of a 2-year run at the
# derived defaults: 100,000 investable, 4,000/month, 5%/yr). The real-terms conversion now
# sits between the knobs and `project(...)`, so "no knobs ⇒ byte-identical" has to be a
# test, not a hope — these strings are what it is measured against.
BACKCOMPAT_PROJECTED_2Y = (
    "100000.00 104407.41 108832.78 113276.18 117737.68 122217.36 126715.29 131231.54 "
    "135766.19 140319.32 144891.00 149481.30 154090.31 158718.09 163364.73 168030.30 "
    "172714.87 177418.54 182141.36 186883.43 191644.81 196425.60 201225.86 206045.68 "
    "210885.14"
).split()
BACKCOMPAT_COAST_2Y = (
    "100000.00 100407.41 100816.48 101227.22 101639.64 102053.73 102469.51 102886.98 "
    "103306.16 103727.04 104149.63 104573.95 105000.00 105427.78 105857.31 106288.58 "
    "106721.62 107156.41 107592.98 108031.33 108471.46 108913.39 109357.12 109802.65 "
    "110250.00"
).split()


async def test_projection_backcompat_without_new_knobs(auth_client, db):
    this_month = await _seed_book(db)
    short = (await auth_client.get("/api/v1/projection?years=2")).json()
    assert short["projected"] == BACKCOMPAT_PROJECTED_2Y
    assert short["coast"] == BACKCOMPAT_COAST_2Y

    # The default horizon's landmarks, captured the same way — the long chain has more
    # room to drift than 24 months do.
    full = (await auth_client.get("/api/v1/projection")).json()
    assert full["projected"][180] == "1267191.20"
    assert full["coast"][180] == "207892.82"
    assert full["projected"][-1] == "3693697.87"
    assert full["coast"][-1] == "432194.24"
    assert full["fi_month"] == month_add(this_month, 205).isoformat()
    assert full["fi_target"] == "1500000.00"
    assert full["fi_ratio"] == "0.066667"

    # No volatility ⇒ no simulation ran, and the three knobs echo NULL (not 0) so the
    # page's blank boxes stay blank through the round trip.
    for body in (short, full):
        assert body["bands"] is None
        assert body["fi_probability"] is None
        assert body["fi_month_p10"] is None
        assert body["fi_month_p50"] is None
        assert body["fi_month_p90"] is None
        assert body["volatility"] is None
        assert body["inflation"] is None
        assert body["contribution_growth"] is None


async def test_projection_bands_shape_and_alignment(auth_client, db):
    await _seed_book(db)
    resp = await auth_client.get("/api/v1/projection?volatility=0.15&years=2")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["volatility"] == "0.150000"

    bands = body["bands"]
    assert sorted(bands) == ["p10", "p25", "p50", "p75", "p90"]
    for key, values in bands.items():
        assert len(values) == len(body["months"]), key
    # Percentiles of the same column can never cross, in any month.
    for i in range(len(body["months"])):
        column = [Decimal(bands[key][i]) for key in ("p10", "p25", "p50", "p75", "p90")]
        assert column == sorted(column), i
    # t0 is the starting balance in every path, so every band opens on it.
    for key in bands:
        assert bands[key][0] == body["starting_balance"]


async def test_projection_inflation_moves_deterministic_lines(auth_client, db):
    await _seed_book(db)
    plain = (await auth_client.get("/api/v1/projection?years=10")).json()
    real = (await auth_client.get("/api/v1/projection?years=10&inflation=0.03")).json()

    assert plain["inflation"] is None
    assert real["inflation"] == "0.030000"
    # The ECHOED return stays nominal — it is what seeds the form; inflation echoes
    # separately, so the page can reconstruct the real rate itself.
    assert real["annual_return"] == plain["annual_return"] == "0.05"
    assert Decimal(real["projected"][-1]) < Decimal(plain["projected"][-1])
    assert Decimal(real["coast"][-1]) < Decimal(plain["coast"][-1])
    # ...while the target stays in today's dollars: that is what makes the frame cohere.
    assert real["fi_target"] == plain["fi_target"]


async def test_projection_contribution_growth(auth_client, db):
    await _seed_book(db)
    flat = (await auth_client.get("/api/v1/projection?years=10")).json()
    raises = (await auth_client.get("/api/v1/projection?years=10&contribution_growth=0.05")).json()

    assert flat["contribution_growth"] is None
    assert raises["contribution_growth"] == "0.050000"
    assert Decimal(raises["projected"][-1]) > Decimal(flat["projected"][-1])
    # The coast line has no contribution to escalate — it must not move an inch.
    assert raises["coast"] == flat["coast"]


async def test_projection_fi_probability_and_percentiles(auth_client, db):
    await _seed_book(db)
    body = (
        await auth_client.get("/api/v1/projection?volatility=0.15&years=10&annual_spend=20000")
    ).json()
    assert body["fi_target"] == "500000.00"  # 20,000 / 0.04, reachable in 10 years
    assert Decimal(0) < Decimal(body["fi_probability"]) <= Decimal(1)
    assert body["fi_month_p10"] is not None
    present = [body[f"fi_month_p{p}"] for p in (10, 50, 90) if body[f"fi_month_p{p}"]]
    assert present == sorted(present)  # p10 is the optimistic edge, p90 the pessimistic

    # A target no path can reach: probability 0 and null months, never an invented date.
    hopeless = (
        await auth_client.get("/api/v1/projection?volatility=0.15&years=10&annual_spend=10000000")
    ).json()
    assert hopeless["fi_probability"] == "0.000000"
    assert hopeless["fi_month_p10"] is None
    assert hopeless["fi_month_p50"] is None
    assert hopeless["fi_month_p90"] is None


async def test_projection_seed_stability(auth_client, db):
    await _seed_book(db)
    url = "/api/v1/projection?volatility=0.2&years=2"
    first = (await auth_client.get(url)).json()
    second = (await auth_client.get(url)).json()
    # Identical knobs redraw identical bands — the determinism IS the feature.
    assert first["bands"] == second["bands"]


async def test_projection_bounds_the_monte_carlo_knobs(auth_client, db):
    await _seed_book(db)

    for bad in ("0", "1.5"):
        resp = await auth_client.get(f"/api/v1/projection?volatility={bad}")
        assert resp.status_code == 422
        assert resp.json()["detail"] == "volatility must be greater than 0 and at most 1"

    for bad in ("-0.2", "0.3"):
        resp = await auth_client.get(f"/api/v1/projection?inflation={bad}")
        assert resp.status_code == 422
        assert resp.json()["detail"] == "inflation must be between -0.1 and 0.25"

    for bad in ("-0.01", "0.3"):
        resp = await auth_client.get(f"/api/v1/projection?contribution_growth={bad}")
        assert resp.status_code == 422
        assert resp.json()["detail"] == "contribution_growth must be between 0 and 0.25"


# --- the engine itself (pure Decimal, no DB): the contribution escalator's two pins ---


def test_project_growth_zero_matches_previous_behavior():
    # Back-compat is a test, not a hope: these four strings were CAPTURED from the engine
    # before the contribution_growth parameter existed, and the defaulted call must keep
    # reproducing them byte for byte — same call site, same digits.
    points = project(Decimal("1000.00"), Decimal("100.00"), Decimal("0.05"), 3)
    assert [str(p) for p in points] == ["1000.00", "1104.07", "1208.57", "1313.50"]
    # Passing the new parameter explicitly as 0 is the same chain.
    explicit = project(Decimal("1000.00"), Decimal("100.00"), Decimal("0.05"), 3, Decimal("0"))
    assert explicit == points


def test_project_contribution_growth_two_months_exact():
    # r = 0 collapses the compounding, so the escalator is the only thing moving:
    #   month 1 = 1000 + 100                       = 1100.00
    #   month 2 = 1100 + 100 x 1.12^(1/12)
    #           = 1100 + 100 x 1.009488792934582974126355069   (Decimal ** at 28 digits)
    #           = 1200.948879293458297412635507 -> HALF_UP -> 1200.95
    points = project(Decimal("1000.00"), Decimal("100.00"), Decimal("0"), 2, Decimal("0.12"))
    assert [str(p) for p in points] == ["1000.00", "1100.00", "1200.95"]
