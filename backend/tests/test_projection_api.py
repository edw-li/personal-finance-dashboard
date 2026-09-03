from datetime import date, timedelta
from decimal import Decimal

from app.models import (
    Account,
    AccountBalance,
    MonthlyCashflow,
    MonthlySpending,
    NetWorthSnapshot,
    PaycheckProfile,
    Person,
    SpendingCategory,
)
from app.services.projection import drop_schedule, project

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


async def _seed_person(db, name: str, *, primary: bool = False) -> Person:
    """`create_all` seeds no roster, so every retirement test names its own people."""
    person = Person(name=name, is_primary=primary)
    db.add(person)
    await db.commit()
    return person


async def _seed_profile(db, person: Person, **overrides) -> PaycheckProfile:
    """A deliberately round profile: 24,000/yr over 24 periods with every pct and rider at
    0 nets 1,000.00 a check, i.e. a monthly_net of exactly 2,000.00 — so the drop the
    endpoint applies is checkable by eye against the 4,000 derived contribution."""
    fields = {
        "effective_date": date.today() - timedelta(days=30),
        "annual_salary": Decimal("24000.00"),
        "pay_periods_per_year": 24,
    }
    fields.update(overrides)
    profile = PaycheckProfile(person_id=person.id, **fields)
    db.add(profile)
    await db.commit()
    return profile


def _month_param(month: date) -> str:
    return f"{month:%Y-%m}"


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
    # NOMINAL arithmetic is what this pins, so the two real-terms assumptions are sent as
    # explicit zeros — absent they would default to 3%/3% and bend every figure below.
    resp = await auth_client.get(
        "/api/v1/projection?annual_return=0&inflation=0&contribution_growth=0"
    )
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
# sits between the knobs and `project(...)`, so byte-identity has to be a test, not a hope
# — these strings are what it is measured against. They are NOT regenerated: if they ever
# stop matching, the engine moved.
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


async def test_projection_explicit_zero_knobs_reproduce_the_pre_monte_carlo_arrays(auth_client, db):
    this_month = await _seed_book(db)
    # The back-compat guarantee RE-ANCHORED: absent knobs now mean the assumption defaults
    # (that is the feature), so the pre-Monte-Carlo engine is what EXPLICIT zeros buy. Only
    # inflation and contribution growth touch the deterministic arrays; volatility=0 rides
    # along to pin that the fan's off switch leaves the lines alone.
    zeros = "volatility=0&inflation=0&contribution_growth=0"
    short = (await auth_client.get(f"/api/v1/projection?years=2&{zeros}")).json()
    assert short["projected"] == BACKCOMPAT_PROJECTED_2Y
    assert short["coast"] == BACKCOMPAT_COAST_2Y

    # The default horizon's landmarks, captured the same way — the long chain has more
    # room to drift than 24 months do.
    full = (await auth_client.get(f"/api/v1/projection?{zeros}")).json()
    assert full["projected"][180] == "1267191.20"
    assert full["coast"][180] == "207892.82"
    assert full["projected"][-1] == "3693697.87"
    assert full["coast"][-1] == "432194.24"
    assert full["fi_month"] == month_add(this_month, 205).isoformat()
    assert full["fi_target"] == "1500000.00"
    assert full["fi_ratio"] == "0.066667"

    # Volatility 0 ⇒ no simulation ran, and the three knobs echo the zeros they were sent:
    # the echo names what actually ran, never a null (the page reads it as a placeholder).
    for body in (short, full):
        assert body["bands"] is None
        assert body["fi_probability"] is None
        assert body["fi_month_p10"] is None
        assert body["fi_month_p50"] is None
        assert body["fi_month_p90"] is None
        assert body["volatility"] == "0.000000"
        assert body["inflation"] == "0.000000"
        assert body["contribution_growth"] == "0.000000"


async def test_projection_defaults_apply_when_knobs_absent(auth_client, db):
    await _seed_book(db)
    body = (await auth_client.get("/api/v1/projection?years=10")).json()

    # Absent means the planning defaults, echoed at the percent quantum so the page can
    # grey them into the empty boxes without ever disagreeing with what ran.
    assert body["volatility"] == "0.150000"
    assert body["inflation"] == "0.030000"
    assert body["contribution_growth"] == "0.030000"
    # The fan and the probability tile are therefore on for a bare GET — the whole point.
    assert sorted(body["bands"]) == ["p10", "p25", "p50", "p75", "p90"]
    assert body["fi_probability"] is not None

    # ...and the defaults are observable on the deterministic line: 3% inflation is a real
    # -terms shift, so the defaulted run cannot land on the explicit-zeros one.
    zeros = (
        await auth_client.get("/api/v1/projection?years=10&inflation=0&contribution_growth=0")
    ).json()
    assert body["projected"][-1] != zeros["projected"][-1]


async def test_projection_volatility_zero_turns_the_fan_off(auth_client, db):
    await _seed_book(db)
    resp = await auth_client.get("/api/v1/projection?volatility=0&years=2")
    assert resp.status_code == 200, resp.text  # 0 is legal now, not a 422
    body = resp.json()

    assert body["volatility"] == "0.000000"
    assert body["bands"] is None
    assert body["fi_probability"] is None
    assert body["fi_month_p10"] is None
    assert body["fi_month_p50"] is None
    assert body["fi_month_p90"] is None
    # The other two still defaulted — the off switch is volatility's alone.
    assert body["inflation"] == "0.030000"
    assert body["contribution_growth"] == "0.030000"


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
    # Inflation is the ONLY difference between the two runs: contribution growth is pinned
    # to 0 on both sides, because absent it would default to 3% and move the lines itself.
    base = "/api/v1/projection?years=10&contribution_growth=0"
    plain = (await auth_client.get(f"{base}&inflation=0")).json()
    real = (await auth_client.get(f"{base}&inflation=0.03")).json()

    assert plain["inflation"] == "0.000000"
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
    # "Flat" is now an explicit 0 — absent means the 3% default, which is a raise.
    flat = (await auth_client.get("/api/v1/projection?years=10&contribution_growth=0")).json()
    raises = (await auth_client.get("/api/v1/projection?years=10&contribution_growth=0.05")).json()

    assert flat["contribution_growth"] == "0.000000"
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

    # 0 is no longer out of range — it is the fan's off switch (its own test above).
    for bad in ("-0.01", "1.5"):
        resp = await auth_client.get(f"/api/v1/projection?volatility={bad}")
        assert resp.status_code == 422
        assert resp.json()["detail"] == "volatility must be between 0 and 1"

    for bad in ("-0.2", "0.3"):
        resp = await auth_client.get(f"/api/v1/projection?inflation={bad}")
        assert resp.status_code == 422
        assert resp.json()["detail"] == "inflation must be between -0.1 and 0.25"

    for bad in ("-0.01", "0.3"):
        resp = await auth_client.get(f"/api/v1/projection?contribution_growth={bad}")
        assert resp.status_code == 422
        assert resp.json()["detail"] == "contribution_growth must be between 0 and 0.25"


# --- dual-career retirements (2026-08-28 spec §4.3) ---


async def test_projection_without_retire_params_echoes_an_empty_list(auth_client, db):
    # The wire GAINS exactly one key. Every array is measured against the SAME constants
    # the pre-retirement pin uses, so "byte-identical outputs" is a test, not a hope.
    await _seed_book(db)
    zeros = "volatility=0&inflation=0&contribution_growth=0"
    body = (await auth_client.get(f"/api/v1/projection?years=2&{zeros}")).json()
    assert body["retirements"] == []
    assert body["projected"] == BACKCOMPAT_PROJECTED_2Y
    assert body["coast"] == BACKCOMPAT_COAST_2Y


async def test_projection_retirement_drops_the_stream_and_echoes_what_it_did(auth_client, db):
    this_month = await _seed_book(db)
    alex = await _seed_person(db, "Alex", primary=True)
    await _seed_profile(db, alex)
    retires = month_add(this_month, 12)
    # Nominal zeros make the chain exact addition: 4,000/month until month 12, where
    # Alex's 2,000 take-home leaves the stream.
    body = (
        await auth_client.get(
            "/api/v1/projection?annual_return=0&inflation=0&contribution_growth=0&volatility=0"
            f"&retire={alex.id}:{_month_param(retires)}"
        )
    ).json()

    assert body["retirements"] == [
        {
            "person_id": alex.id,
            "name": "Alex",
            "month": retires.isoformat(),
            "monthly_drop": "2000.00",
        }
    ]
    assert body["projected"][11] == "144000.00"  # 100,000 + 11 x 4,000
    assert body["projected"][12] == "146000.00"  # the first HALVED month
    assert body["projected"][13] == "148000.00"
    # The coast line has no contribution to drop — it must not move an inch.
    assert body["coast"][12] == "100000.00"


async def test_projection_retirement_drop_is_not_deflated(auth_client, db):
    # 3% return against 3% inflation is a real rate of exactly 0, and 3% contribution
    # growth against it is exactly 0 too, so every month-over-month step is the raw
    # contribution. The drop is a TODAY's-dollars figure like the contribution itself and
    # crosses the Fisher conversion UNTOUCHED: the step must fall by exactly 2,000.00.
    this_month = await _seed_book(db)
    alex = await _seed_person(db, "Alex", primary=True)
    await _seed_profile(db, alex)
    retires = month_add(this_month, 6)
    body = (
        await auth_client.get(
            "/api/v1/projection?annual_return=0.03&inflation=0.03&contribution_growth=0.03"
            f"&volatility=0&retire={alex.id}:{_month_param(retires)}"
        )
    ).json()

    def step(i: int) -> Decimal:
        return Decimal(body["projected"][i]) - Decimal(body["projected"][i - 1])

    assert step(5) == Decimal("4000.00")
    assert step(6) == Decimal("2000.00")
    assert step(7) == Decimal("2000.00")


async def test_projection_two_retirements_echo_sorted_by_month(auth_client, db):
    this_month = await _seed_book(db)
    alex = await _seed_person(db, "Alex", primary=True)
    bo = await _seed_person(db, "Bo")
    await _seed_profile(db, alex)
    await _seed_profile(db, bo, annual_salary=Decimal("48000.00"))  # nets 4,000 a month
    early, late = month_add(this_month, 6), month_add(this_month, 18)
    body = (
        await auth_client.get(
            "/api/v1/projection?annual_return=0&inflation=0&contribution_growth=0&volatility=0"
            f"&retire={alex.id}:{_month_param(late)}&retire={bo.id}:{_month_param(early)}"
        )
    ).json()

    # Order-free params, an echo in the order the drops actually HAPPEN.
    assert [row["name"] for row in body["retirements"]] == ["Bo", "Alex"]
    assert [row["monthly_drop"] for row in body["retirements"]] == ["4000.00", "2000.00"]
    # Bo's 4,000 retires the whole 4,000 stream at month 6; Alex's 2,000 then has nothing
    # left to take (the floor), so the balance simply stops moving.
    assert body["projected"][5] == "120000.00"
    assert body["projected"][6] == "120000.00"
    assert body["projected"][19] == "120000.00"


async def test_projection_retirement_reaches_the_monte_carlo_fan(auth_client, db):
    this_month = await _seed_book(db)
    alex = await _seed_person(db, "Alex", primary=True)
    await _seed_profile(db, alex)
    base = "/api/v1/projection?volatility=0.15&years=5"
    full = (await auth_client.get(base)).json()
    retired = (
        await auth_client.get(f"{base}&retire={alex.id}:{_month_param(month_add(this_month, 12))}")
    ).json()
    # The fan has to wrap the line it belongs to: same seed, smaller stream, lower bands.
    assert Decimal(retired["bands"]["p50"][-1]) < Decimal(full["bands"]["p50"][-1])
    assert Decimal(retired["bands"]["p90"][-1]) < Decimal(full["bands"]["p90"][-1])
    assert retired["bands"]["p50"][:12] == full["bands"]["p50"][:12]


async def test_projection_retirement_validation_table(auth_client, db):
    this_month = await _seed_book(db)
    alex = await _seed_person(db, "Alex", primary=True)
    bo = await _seed_person(db, "Bo")  # no profile at all
    await _seed_profile(db, alex)
    soon = _month_param(month_add(this_month, 6))
    fmt = "retire must be '<person_id>:<YYYY-MM>' (e.g. retire=2:2035-06)"

    for bad in (
        "alex",
        f"{alex.id}",
        f"{alex.id}:2035",
        f"{alex.id}:2035-6",
        f"{alex.id}:2035-13",
        f"{alex.id}:2035-06-01",
        f":{soon}",
    ):
        resp = await auth_client.get(f"/api/v1/projection?retire={bad}")
        assert resp.status_code == 422, bad
        assert resp.json()["detail"] == fmt, bad

    resp = await auth_client.get(f"/api/v1/projection?retire=987654:{soon}")
    assert resp.status_code == 422
    assert resp.json()["detail"] == "retire names person 987654, who is not in the household"

    resp = await auth_client.get(
        f"/api/v1/projection?retire={alex.id}:{soon}&retire={alex.id}:{soon}"
    )
    assert resp.status_code == 422
    assert resp.json()["detail"] == "Alex has more than one retirement month"

    for outside in (month_add(this_month, -1), month_add(this_month, 400)):
        resp = await auth_client.get(f"/api/v1/projection?retire={alex.id}:{_month_param(outside)}")
        assert resp.status_code == 422
        assert "Alex's retirement month is outside the 30-year horizon" in resp.json()["detail"]

    resp = await auth_client.get(f"/api/v1/projection?retire={bo.id}:{soon}")
    assert resp.status_code == 422
    assert resp.json()["detail"] == "Bo has no paycheck profile in force — nothing to drop"


async def test_projection_retirement_answers_on_the_first_bad_param(auth_client, db):
    # Order-free params, ONE answer: the first one with a problem is the one that speaks,
    # so a fix is a fix rather than the first of several.
    this_month = await _seed_book(db)
    alex = await _seed_person(db, "Alex", primary=True)
    await _seed_profile(db, alex)
    soon = _month_param(month_add(this_month, 6))
    resp = await auth_client.get(f"/api/v1/projection?retire=nonsense&retire=987654:{soon}")
    assert resp.status_code == 422
    assert resp.json()["detail"].startswith("retire must be")


async def test_projection_retirement_degrades_on_unusable_stored_profiles(auth_client, db):
    this_month = await _seed_book(db)
    alex = await _seed_person(db, "Alex", primary=True)
    # A hand-written 0 cadence: `gross = salary / periods` would be a DivisionByZero 500,
    # so the projection refuses in the PAYCHECK router's own words rather than crashing.
    await _seed_profile(db, alex, pay_periods_per_year=0)
    resp = await auth_client.get(
        f"/api/v1/projection?retire={alex.id}:{_month_param(month_add(this_month, 6))}"
    )
    assert resp.status_code == 422
    assert resp.json()["detail"] == (
        "Alex's paycheck profile: pay_periods_per_year must be between 1 and 366"
    )


async def test_projection_retirement_of_a_negative_net_drops_only_its_deductions(auth_client, db):
    # An over-committed check nets negative: gross 1,000 with 50% roth and 80% espp is
    # -300 a check, -600.00 a month. The take-home half of the drop floors at 0 — a
    # retirement must never ADD to the stream by "removing" a negative — while the
    # deductions half (1,300 a check = 2,600.00 a month) is exactly what the derived
    # contribution counted for this profile, so it leaves with the paycheck (2026-09-03).
    this_month = await _seed_book(db)
    alex = await _seed_person(db, "Alex", primary=True)
    await _seed_profile(
        db, alex, roth_401k_pct=Decimal("0.500000000"), espp_pct=Decimal("0.800000000")
    )
    body = (
        await auth_client.get(
            "/api/v1/projection?annual_return=0&inflation=0&contribution_growth=0&volatility=0"
            f"&retire={alex.id}:{_month_param(month_add(this_month, 6))}"
        )
    ).json()
    assert body["monthly_contribution"] == "6600.00"  # 4,000 cash + 2,600 payroll
    assert body["retirements"][0]["monthly_drop"] == "2600.00"
    # Five full months, then 4,000 a month from the retirement month on: back to cash alone.
    assert body["projected"][7] == "141000.00"  # 100,000 + 5 x 6,600 + 2 x 4,000


async def test_projection_retirement_uses_the_profile_in_force_not_the_newest(auth_client, db):
    # The Paycheck page, the Taxes page and this drop must never disagree about which
    # profile is current: a raise dated next year is not today's take-home.
    this_month = await _seed_book(db)
    alex = await _seed_person(db, "Alex", primary=True)
    await _seed_profile(db, alex)  # 24,000 -> 2,000/month, effective 30 days ago
    await _seed_profile(
        db,
        alex,
        effective_date=date.today() + timedelta(days=400),
        annual_salary=Decimal("120000.00"),
    )
    body = (
        await auth_client.get(
            f"/api/v1/projection?retire={alex.id}:{_month_param(month_add(this_month, 6))}"
        )
    ).json()
    assert body["retirements"][0]["monthly_drop"] == "2000.00"


# --- payroll-deducted savings in the derived contribution (2026-09-03) ---
# A profile that deducts 10% traditional 401(k), 5% ESPP and $50 HSA per check on 24,000/24:
# gross 1,000 → 100 + 50 + 50 = 200 a check = 400.00 a month of payroll savings; take-home is
# 1,000 − 100 − 50 (pre-tax) − 50 (ESPP) = 800 a check = 1,600.00 a month.
PAYROLL_PROFILE = {
    "trad_401k_pct": Decimal("0.10"),
    "espp_pct": Decimal("0.05"),
    "hsa_per_check": Decimal("50.00"),
}


async def test_projection_derived_contribution_adds_payroll_savings(auth_client, db):
    await _seed_book(db)  # cash savings: mean of (net pay − spend) = 4,000
    alex = await _seed_person(db, "Alex", primary=True)
    await _seed_profile(db, alex, **PAYROLL_PROFILE)
    body = (await auth_client.get("/api/v1/projection")).json()

    # Money that never reaches net pay is still saved: the derived knob is cash + payroll.
    assert body["monthly_contribution"] == "4400.00"
    assert body["contribution_breakdown"] == {
        "cash": "4000.00",
        "payroll": "400.00",
        "total": "4400.00",
        "by_person": [{"person_id": alex.id, "name": "Alex", "monthly": "400.00"}],
    }
    assert body["warnings"] == []


async def test_projection_derived_contribution_sums_every_earner(auth_client, db):
    await _seed_book(db)
    alex = await _seed_person(db, "Alex", primary=True)
    bo = await _seed_person(db, "Bo")
    await _seed_profile(db, alex, **PAYROLL_PROFILE)
    await _seed_profile(db, bo, trad_401k_pct=Decimal("0.10"))  # 100 a check = 200.00 a month
    body = (await auth_client.get("/api/v1/projection")).json()

    assert body["monthly_contribution"] == "4600.00"
    assert body["contribution_breakdown"]["payroll"] == "600.00"
    assert [row["name"] for row in body["contribution_breakdown"]["by_person"]] == ["Alex", "Bo"]


async def test_projection_explicit_contribution_carries_no_breakdown(auth_client, db):
    await _seed_book(db)
    alex = await _seed_person(db, "Alex", primary=True)
    await _seed_profile(db, alex, **PAYROLL_PROFILE)
    body = (await auth_client.get("/api/v1/projection?monthly_contribution=1000")).json()

    # A typed knob is the user's number, whole: nothing is added to it and there is no
    # derivation to explain.
    assert body["monthly_contribution"] == "1000.00"
    assert body["contribution_breakdown"] is None


async def test_projection_payroll_alone_when_there_is_no_cashflow_history(auth_client, db):
    await _seed_book(db, with_history=False)
    alex = await _seed_person(db, "Alex", primary=True)
    await _seed_profile(db, alex, **PAYROLL_PROFILE)
    body = (await auth_client.get("/api/v1/projection")).json()

    assert body["monthly_contribution"] == "400.00"
    assert body["contribution_breakdown"]["cash"] == "0.00"
    assert body["contribution_breakdown"]["payroll"] == "400.00"
    # The old "defaulted to 0" sentence would be a lie here — the stream is payroll alone.
    assert "no cashflow history — monthly contribution defaulted to 0" not in body["warnings"]
    assert (
        "no cashflow history — the monthly contribution is payroll deductions alone"
        in body["warnings"]
    )


async def test_projection_retirement_drop_includes_payroll_savings(auth_client, db):
    # Retiring stops the whole paycheck: the take-home AND the deductions that were landing
    # in the retiree's own accounts. Nominal zeros keep the chain exact addition.
    this_month = await _seed_book(db)
    alex = await _seed_person(db, "Alex", primary=True)
    await _seed_profile(db, alex, **PAYROLL_PROFILE)
    retires = month_add(this_month, 6)
    body = (
        await auth_client.get(
            "/api/v1/projection?annual_return=0&inflation=0&contribution_growth=0&volatility=0"
            f"&retire={alex.id}:{_month_param(retires)}"
        )
    ).json()

    assert body["retirements"][0]["monthly_drop"] == "2000.00"  # 1,600 take-home + 400 payroll

    def step(i: int) -> Decimal:
        return Decimal(body["projected"][i]) - Decimal(body["projected"][i - 1])

    assert step(5) == Decimal("4400.00")
    assert step(6) == Decimal("2400.00")


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


# --- the retirement schedule (2026-08-28 spec §4.3) ---


def test_drop_schedule_sums_a_month_and_folds_index_zero():
    # Two retirements in one month cost the household BOTH paychecks at once.
    assert drop_schedule([(7, Decimal("100")), (7, Decimal("40"))]) == {7: Decimal("140")}
    # t0 carries no contribution (it IS the starting balance), so "already retired when the
    # projection starts" and "retires at month 1" are the same chain — folded, not dropped.
    assert drop_schedule([(0, Decimal("40"))]) == {1: Decimal("40")}
    assert drop_schedule([]) == {}


def test_project_without_drops_is_byte_identical():
    # The back-compat guarantee is a test, not a hope: the four strings below are the ones
    # test_project_growth_zero_matches_previous_behavior already pins, and the new
    # parameter must not move them on either the defaulted or the explicit-empty path.
    plain = project(Decimal("1000.00"), Decimal("100.00"), Decimal("0.05"), 3)
    assert [str(p) for p in plain] == ["1000.00", "1104.07", "1208.57", "1313.50"]
    explicit = project(Decimal("1000.00"), Decimal("100.00"), Decimal("0.05"), 3, Decimal("0"), [])
    assert explicit == plain


def test_project_drop_lands_before_that_month_contribution():
    # r = 0 collapses the compounding to plain addition, so the whole chain is exact:
    # 100/month until month 3, where a 40 drop leaves 60/month for the rest.
    points = project(
        Decimal("1000.00"),
        Decimal("100.00"),
        Decimal("0"),
        5,
        Decimal("0"),
        [(3, Decimal("40.00"))],
    )
    assert [str(p) for p in points] == [
        "1000.00",
        "1100.00",
        "1200.00",
        "1260.00",
        "1320.00",
        "1380.00",
    ]


def test_project_drop_at_index_zero_is_the_same_chain_as_index_one():
    at_zero = project(
        Decimal("1000.00"),
        Decimal("100.00"),
        Decimal("0"),
        3,
        Decimal("0"),
        [(0, Decimal("40.00"))],
    )
    at_one = project(
        Decimal("1000.00"),
        Decimal("100.00"),
        Decimal("0"),
        3,
        Decimal("0"),
        [(1, Decimal("40.00"))],
    )
    assert [str(p) for p in at_zero] == ["1000.00", "1060.00", "1120.00", "1180.00"]
    assert at_zero == at_one


def test_project_two_drops_in_one_month_sum():
    points = project(
        Decimal("1000.00"),
        Decimal("100.00"),
        Decimal("0"),
        3,
        Decimal("0"),
        [(2, Decimal("30.00")), (2, Decimal("20.00"))],
    )
    assert [str(p) for p in points] == ["1000.00", "1100.00", "1150.00", "1200.00"]


def test_project_floors_the_stream_at_zero_and_growth_cannot_revive_it():
    # A drop bigger than what is left retires the WHOLE stream; 0 x (1+g) is still 0, so a
    # 12%/yr escalator must never bring a retired paycheck back.
    points = project(
        Decimal("1000.00"),
        Decimal("100.00"),
        Decimal("0"),
        4,
        Decimal("0.12"),
        [(2, Decimal("500.00"))],
    )
    assert [str(p) for p in points] == ["1000.00", "1100.00", "1100.00", "1100.00", "1100.00"]


def test_project_growth_escalates_only_the_remainder():
    # Dropping 40 at the FIRST contribution is arithmetically a 60/month stream from the
    # start: the escalator has to compound what is LEFT, never the original 100. Equality
    # over a 36-month chain is a much sharper pin than any single hand-computed point.
    dropped = project(
        Decimal("1000.00"),
        Decimal("100.00"),
        Decimal("0"),
        36,
        Decimal("0.12"),
        [(1, Decimal("40.00"))],
    )
    assert dropped == project(
        Decimal("1000.00"), Decimal("60.00"), Decimal("0"), 36, Decimal("0.12")
    )
    # ...and the first two points are checkable by eye: 1000 + 60, then + 60 x 1.12^(1/12)
    # = 60.56932757607497844758130414 -> 1120.5693... -> HALF_UP -> 1120.57.
    assert [str(p) for p in dropped[:3]] == ["1000.00", "1060.00", "1120.57"]


def test_project_ignores_a_drop_past_the_horizon():
    # The API fences the range; the ENGINE stays total rather than raising on one.
    assert project(
        Decimal("1000.00"),
        Decimal("100.00"),
        Decimal("0"),
        3,
        Decimal("0"),
        [(99, Decimal("40.00"))],
    ) == project(Decimal("1000.00"), Decimal("100.00"), Decimal("0"), 3, Decimal("0"))
