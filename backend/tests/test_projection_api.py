from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.api.projection import ProjectionKnobs, money_lasts_verdict, quote_date, run_projection
from app.models import (
    Account,
    AccountBalance,
    AppSetting,
    CategoryBudget,
    LatestPrice,
    MonthlyCashflow,
    MonthlySpending,
    NetWorthSnapshot,
    PaycheckProfile,
    Person,
    RsuGrant,
    Security,
    SpendingCategory,
)
from app.services import clock, rsu_vesting
from app.services.calendar.generators.rsu import after_sell_to_cover
from app.services.month_review import adopt_existing_history
from app.services.projection import (
    december_index,
    latest_december_year,
    max_plan_until_year,
    monthly_flows,
    project,
    project_path,
    reset_schedule,
)

# The projection anchors on the product clock (the router's one clock read), so the seeds
# are built RELATIVE to the run's own month — nothing here goes stale with the calendar,
# and a UTC CI runner on a PT evening still agrees with the route.


def month_add(start: date, delta: int) -> date:
    base = start.year * 12 + (start.month - 1) + delta
    return date(base // 12, base % 12 + 1, 1)


async def _seed_book(db, *, with_history: bool = True, adopt: bool = True) -> date:
    """One snapshot of the four group flavours + (optionally) two months of spend/pay.

    Investable = the taxable account alone (cash, the component and the liability are all
    excluded by net_worth_calc's rule): 100,000. With history: trailing spend mean 5,000
    (6,000 and 4,000), trailing savings mean 4,000 (9,000 net pay both months).
    """
    this_month = clock.product_today().replace(day=1)
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
    if adopt:
        await adopt_existing_history(db, clock.product_today())
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
        "effective_date": clock.product_today().replace(day=1),
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
    assert body["warnings"] == [
        "Planning inputs include 2 unreviewed historical months.",
        "10 months in the 12-calendar-month planning window are excluded; "
        "older months do not replace them.",
    ]

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


async def test_projection_echoes_the_base_snapshot_it_started_from(auth_client, db):
    # 2026-09-23 spec §R5: the starting balance names its snapshot — the month key, the date the
    # balances describe, the recorded date and whether they are provisional.
    this_month = await _seed_book(db)
    body = (await auth_client.get("/api/v1/projection")).json()
    assert body["base_month"] == this_month.isoformat()
    assert body["base_as_of"] == this_month.isoformat()
    assert body["base_recorded_on"] is None  # _seed_book stores no recorded date
    assert body["base_provisional"] is False


SEP_23 = date(2026, 9, 23)


async def _seed_snapshots(db, *rows: tuple[date, date | None, str]) -> Account:
    """One taxable account, and a snapshot per (month, recorded_on, balance)."""
    taxable = Account(name="Brokerage", slug="brokerage", group="taxable", sort_order=1)
    db.add(taxable)
    await db.flush()
    for month, recorded_on, balance in rows:
        snap = NetWorthSnapshot(month=month, recorded_on=recorded_on)
        db.add(snap)
        await db.flush()
        db.add(AccountBalance(snapshot_id=snap.id, account_id=taxable.id, balance=Decimal(balance)))
    await db.commit()
    return taxable


async def test_the_base_is_the_current_snapshot_a_provisional_next_month_one_included(
    auth_client, db, monkeypatch
):
    # 2026-09-23 spec §R5 on K2's rule: Oct 1 recorded on Sep 22 IS the current snapshot — the
    # starting balance stands on it, dated Sep 22 and provisional, while the axis still starts in
    # today's month (a base as-of is never after today).
    monkeypatch.setattr(clock, "product_today", lambda: SEP_23)
    await _seed_snapshots(
        db,
        (date(2026, 9, 1), date(2026, 9, 1), "100000.00"),
        (date(2026, 10, 1), date(2026, 9, 22), "120000.00"),
    )
    body = (await auth_client.get("/api/v1/projection")).json()
    assert body["starting_balance"] == "120000.00"
    assert body["base_month"] == "2026-10-01"
    assert body["base_as_of"] == "2026-09-22"
    assert body["base_recorded_on"] == "2026-09-22"
    assert body["base_provisional"] is True
    assert body["start_month"] == "2026-09-01"
    assert body["months"][0] == "2026-09-01"
    assert body["projected"][0] == "120000.00"


async def test_a_lengthening_plan_until_keeps_every_month_the_horizon_had(
    auth_client, db, monkeypatch
):
    # 2026-09-24 review I1: the months a later plan-until year adds come from a second seeded
    # stream, so the default horizon's paths — and with them the FI dates and the bands — hold
    # still; only months are appended.
    monkeypatch.setattr(clock, "product_today", lambda: SEP_23)
    await _seed_book(db)
    base = (await auth_client.get("/api/v1/projection?annual_return=0.07")).json()
    longer = (await auth_client.get("/api/v1/projection?annual_return=0.07&plan_until=2080")).json()
    assert base["years"] == 30 and longer["years"] == 55
    assert base["fi_month_p50"] is not None
    for key in ("fi_month_p10", "fi_month_p50"):
        assert longer[key] == base[key], key
    for band, values in base["bands"].items():
        assert longer["bands"][band][: len(values)] == values, band


async def test_a_snapshot_two_months_ahead_is_never_the_base(auth_client, db, monkeypatch):
    # Only an API client or an import can store one (K2); it stays in the charts, never "now".
    monkeypatch.setattr(clock, "product_today", lambda: SEP_23)
    await _seed_snapshots(
        db,
        (date(2026, 9, 1), date(2026, 9, 1), "100000.00"),
        (date(2026, 11, 1), None, "999999.00"),
    )
    body = (await auth_client.get("/api/v1/projection")).json()
    assert body["base_month"] == "2026-09-01"
    assert body["starting_balance"] == "100000.00"
    assert body["base_as_of"] == "2026-09-01"
    assert body["base_provisional"] is False


async def test_the_vest_cut_is_the_bases_as_of_date(auth_client, db, monkeypatch):
    # A Sep 16 vest (spec §R4, §R5) is not in Sep 1's balances, so it counts; balances recorded
    # on Sep 22 already hold its shares, so with that base it is left out.
    monkeypatch.setattr(clock, "product_today", lambda: SEP_23)
    taxable = await _seed_snapshots(db, (date(2026, 9, 1), date(2026, 9, 1), "100000.00"))
    grant = await _seed_vests(db, first=date(2026, 9, 16))
    sep_base = (await auth_client.get(f"/api/v1/projection?{Z}")).json()
    kept = _kept(grant, after=date(2026, 9, 1))
    assert kept[0] == (date(2026, 9, 16), 400)
    year_2026 = next(row for row in sep_base["vests"]["by_year"] if row["year"] == 2026)
    assert Decimal(year_2026["after_withholding"]) == sum(
        (_net(s) for d, s in kept if d.year == 2026), Decimal("0.00")
    )

    oct_snap = NetWorthSnapshot(month=date(2026, 10, 1), recorded_on=date(2026, 9, 22))
    db.add(oct_snap)
    await db.flush()
    db.add(
        AccountBalance(snapshot_id=oct_snap.id, account_id=taxable.id, balance=Decimal("140000.00"))
    )
    await db.commit()
    oct_base = (await auth_client.get(f"/api/v1/projection?{Z}")).json()
    assert oct_base["base_as_of"] == "2026-09-22"
    later = _kept(grant, after=date(2026, 9, 22))
    assert all(day > date(2026, 9, 22) for day, _ in later)
    year_2026 = next(row for row in oct_base["vests"]["by_year"] if row["year"] == 2026)
    assert Decimal(year_2026["after_withholding"]) == sum(
        (_net(s) for d, s in later if d.year == 2026), Decimal("0.00")
    )
    assert Decimal(year_2026["after_withholding"]) < Decimal(
        next(row for row in sep_base["vests"]["by_year"] if row["year"] == 2026)[
            "after_withholding"
        ]
    )


async def test_a_base_with_no_usable_date_cuts_vests_at_today(auth_client, db, monkeypatch):
    # Oct 1 stored with no recorded date is provisional with no as-of ("date unknown", K2): the
    # cut falls back to today — a Sep 28 vest counts (after Sep 23), a Sep 16 one does not.
    monkeypatch.setattr(clock, "product_today", lambda: SEP_23)
    await _seed_snapshots(
        db,
        (date(2026, 9, 1), date(2026, 9, 1), "100000.00"),
        (date(2026, 10, 1), None, "120000.00"),
    )
    grant = await _seed_vests(db, first=date(2026, 9, 28))
    body = (await auth_client.get(f"/api/v1/projection?{Z}")).json()
    assert body["base_month"] == "2026-10-01"
    assert body["base_as_of"] is None
    assert body["base_provisional"] is True
    kept = _kept(grant, after=SEP_23)
    assert kept[0] == (date(2026, 9, 28), 400)
    year_2026 = next(row for row in body["vests"]["by_year"] if row["year"] == 2026)
    assert Decimal(year_2026["after_withholding"]) == sum(
        (_net(s) for d, s in kept if d.year == 2026), Decimal("0.00")
    )


async def test_run_projection_is_the_routes_answer_as_a_model_of_its_own(db):
    # Direct callers (the assistant) get the SAME answer the route serves, validated into a
    # model of their own: mutating one can never reach the next caller (spec §R9).
    await _seed_book(db)
    first = await run_projection(db, ProjectionKnobs(years=2))
    second = await run_projection(db, ProjectionKnobs(years=2))
    assert first == second and first is not second
    first.warnings.append("mutated")
    assert "mutated" not in (await run_projection(db, ProjectionKnobs(years=2))).warnings


def test_the_cache_key_normalizes_what_cannot_change_the_answer():
    a = ProjectionKnobs(annual_return=Decimal("0.06"), retire=(" 2:2035-06", "1:2031-01"))
    b = ProjectionKnobs(annual_return=Decimal("0.060"), retire=("1:2031-01", "2:2035-06"))
    assert a.cache_key() == b.cache_key()
    # An absent knob and its default are DIFFERENT answers (the echo spells them differently).
    assert (
        ProjectionKnobs(annual_return=None).cache_key()
        != ProjectionKnobs(annual_return=Decimal("0.05")).cache_key()
    )
    assert ProjectionKnobs(vests=False).cache_key() != ProjectionKnobs(vests=None).cache_key()
    assert ProjectionKnobs(plan_until=2070).cache_key() != ProjectionKnobs().cache_key()
    # A key that will 422 must still hash (a 422 is never cached, but it is looked up).
    hash(ProjectionKnobs(swr=Decimal("NaN")).cache_key())
    hash(ProjectionKnobs(swr=Decimal("sNaN")).cache_key())


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
    assert body["warnings"] == [
        "Planning inputs include 2 unreviewed historical months.",
        "10 months in the 12-calendar-month planning window are excluded; "
        "older months do not replace them.",
    ]


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
    # 2026-09-23 spec §R2: one working phase with every earner (nobody here), no drawdown.
    assert body["phases"] == [
        {
            "from_month": body["start_month"],
            "kind": "working",
            "working_person_ids": [],
            "monthly_contribution": "4000.00",
            "monthly_withdrawal": None,
            "take_home_monthly": None,
        }
    ]
    assert body["drawdown"] is None


ZEROS = "annual_return=0&inflation=0&contribution_growth=0&volatility=0"


def _steps(body: dict):
    def step(i: int) -> Decimal:
        return Decimal(body["projected"][i]) - Decimal(body["projected"][i - 1])

    return step


async def test_a_single_earner_retiring_goes_straight_to_drawdown(auth_client, db):
    # 2026-09-23 spec §R2: nominal zeros make the chain exact addition — 4,000 a month saved
    # until Alex retires at month 12, then annual spend (60,000) / 12 = 5,000 a month out.
    this_month = await _seed_book(db)
    alex = await _seed_person(db, "Alex", primary=True)
    await _seed_profile(db, alex)
    retires = month_add(this_month, 12)
    body = (
        await auth_client.get(
            f"/api/v1/projection?{ZEROS}&retire={alex.id}:{_month_param(retires)}"
        )
    ).json()

    # The echo still names the paycheck that stops — informational now.
    assert body["retirements"] == [
        {
            "person_id": alex.id,
            "name": "Alex",
            "month": retires.isoformat(),
            "monthly_drop": "2000.00",
        }
    ]
    assert body["projected"][11] == "144000.00"  # 100,000 + 11 x 4,000
    assert body["projected"][12] == "139000.00"  # the first month of withdrawals
    assert body["projected"][13] == "134000.00"
    assert [phase["kind"] for phase in body["phases"]] == ["working", "retired"]
    assert body["drawdown"] == {"start_month": retires.isoformat(), "annual_withdrawal": "60000.00"}
    # The coast line never withdraws: growth only, as before.
    assert body["coast"][12] == "100000.00" and body["coast"][-1] == "100000.00"


async def test_the_withdrawal_is_constant_in_todays_dollars(auth_client, db):
    # 3% return against 3% inflation is a real rate of exactly 0, and 3% contribution growth
    # against it is exactly 0 too, so every step is the raw flow. The withdrawal is annual
    # spend / 12 in TODAY's dollars — it crosses the Fisher conversion untouched.
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
    step = _steps(body)
    assert step(5) == Decimal("4000.00")
    assert step(6) == Decimal("-5000.00")
    assert step(18) == Decimal("-5000.00")


async def test_one_of_two_retiring_keeps_the_other_saving_and_withdraws_nothing(auth_client, db):
    this_month = await _seed_book(db)
    alex = await _seed_person(db, "Alex", primary=True)
    bo = await _seed_person(db, "Bo")
    await _seed_profile(db, alex)  # take-home 2,000 a month, no deductions
    # 48,000 over 24 with 10 % traditional 401(k): 400 a month saved, 3,600 a month take-home.
    await _seed_profile(db, bo, annual_salary=Decimal("48000.00"), trad_401k_pct=Decimal("0.10"))
    retires = month_add(this_month, 6)
    body = (
        await auth_client.get(
            f"/api/v1/projection?{ZEROS}&retire={alex.id}:{_month_param(retires)}"
        )
    ).json()
    assert body["monthly_contribution"] == "4400.00"  # 4,000 cash + Bo's 400
    step = _steps(body)
    assert step(5) == Decimal("4400.00")
    # Bo's saving continues; his pay is assumed to cover the spending — nothing withdrawn.
    assert step(6) == Decimal("400.00")
    assert step(300) == Decimal("400.00")
    assert body["drawdown"] is None
    assert body["phases"] == [
        {
            "from_month": this_month.isoformat(),
            "kind": "working",
            "working_person_ids": [alex.id, bo.id],
            "monthly_contribution": "4400.00",
            "monthly_withdrawal": None,
            "take_home_monthly": None,
        },
        {
            "from_month": retires.isoformat(),
            "kind": "partly_retired",
            "working_person_ids": [bo.id],
            "monthly_contribution": "400.00",
            "monthly_withdrawal": None,
            "take_home_monthly": "3600.00",
        },
    ]
    assert (
        "Bo's take-home (≈ $3.6K/mo) is below your spending (≈ $5.0K/mo); "
        "the difference is not withdrawn."
    ) in body["warnings"]


async def test_both_retiring_withdraws_annual_spend_from_the_later_month(auth_client, db):
    this_month = await _seed_book(db)
    alex = await _seed_person(db, "Alex", primary=True)
    bo = await _seed_person(db, "Bo")
    await _seed_profile(db, alex)
    await _seed_profile(db, bo, annual_salary=Decimal("48000.00"), trad_401k_pct=Decimal("0.10"))
    early, late = month_add(this_month, 6), month_add(this_month, 18)
    body = (
        await auth_client.get(
            f"/api/v1/projection?{ZEROS}"
            f"&retire={alex.id}:{_month_param(early)}&retire={bo.id}:{_month_param(late)}"
        )
    ).json()
    assert body["projected"][5] == "122000.00"  # 100,000 + 5 x 4,400
    assert body["projected"][17] == "126800.00"  # + 12 x 400 while Bo works
    assert body["projected"][18] == "121800.00"  # 5,000 a month out from Bo's month
    assert body["projected"][42] == "1800.00"
    assert body["projected"][43] == "0.00"  # clamped: a balance never goes below $0
    assert body["projected"][-1] == "0.00"
    assert body["drawdown"] == {"start_month": late.isoformat(), "annual_withdrawal": "60000.00"}
    assert [phase["kind"] for phase in body["phases"]] == ["working", "partly_retired", "retired"]
    assert body["phases"][2] == {
        "from_month": late.isoformat(),
        "kind": "retired",
        "working_person_ids": [],
        "monthly_contribution": "0.00",
        "monthly_withdrawal": "5000.00",
        "take_home_monthly": None,
    }


async def test_retiring_in_the_same_month_is_one_boundary_and_the_withdrawal(auth_client, db):
    this_month = await _seed_book(db)
    alex = await _seed_person(db, "Alex", primary=True)
    bo = await _seed_person(db, "Bo")
    await _seed_profile(db, alex)
    await _seed_profile(db, bo)
    both = month_add(this_month, 6)
    body = (
        await auth_client.get(
            f"/api/v1/projection?{ZEROS}"
            f"&retire={alex.id}:{_month_param(both)}&retire={bo.id}:{_month_param(both)}"
        )
    ).json()
    assert [phase["kind"] for phase in body["phases"]] == ["working", "retired"]
    assert body["projected"][6] == "115000.00"  # 100,000 + 5 x 4,000 - 5,000
    assert body["drawdown"]["start_month"] == both.isoformat()


async def test_a_typed_contribution_keeps_phase_zero_typed_and_phase_one_profile_derived(
    auth_client, db
):
    this_month = await _seed_book(db)
    alex = await _seed_person(db, "Alex", primary=True)
    bo = await _seed_person(db, "Bo")
    await _seed_profile(db, alex)
    await _seed_profile(db, bo, annual_salary=Decimal("48000.00"), trad_401k_pct=Decimal("0.10"))
    body = (
        await auth_client.get(
            f"/api/v1/projection?{ZEROS}&monthly_contribution=1000"
            f"&retire={alex.id}:{_month_param(month_add(this_month, 6))}"
        )
    ).json()
    assert body["phases"][0]["monthly_contribution"] == "1000.00"
    assert body["phases"][1]["monthly_contribution"] == "400.00"
    step = _steps(body)
    assert (step(5), step(6)) == (Decimal("1000.00"), Decimal("400.00"))


async def test_the_echo_orders_retirements_by_month_whatever_the_param_order(auth_client, db):
    this_month = await _seed_book(db)
    alex = await _seed_person(db, "Alex", primary=True)
    bo = await _seed_person(db, "Bo")
    await _seed_profile(db, alex)
    await _seed_profile(db, bo, annual_salary=Decimal("48000.00"))  # nets 4,000 a month
    early, late = month_add(this_month, 6), month_add(this_month, 18)
    body = (
        await auth_client.get(
            f"/api/v1/projection?{ZEROS}"
            f"&retire={alex.id}:{_month_param(late)}&retire={bo.id}:{_month_param(early)}"
        )
    ).json()
    assert [row["name"] for row in body["retirements"]] == ["Bo", "Alex"]
    assert [row["monthly_drop"] for row in body["retirements"]] == ["4000.00", "2000.00"]
    # Alex keeps working from Bo's month (no deductions: nothing more saved), and the
    # withdrawal starts at Alex's month.
    step = _steps(body)
    assert step(6) == Decimal("0.00")
    assert step(18) == Decimal("-5000.00")
    assert body["drawdown"]["start_month"] == late.isoformat()


async def test_a_retirement_at_the_start_month_is_already_retired(auth_client, db):
    this_month = await _seed_book(db)
    alex = await _seed_person(db, "Alex", primary=True)
    await _seed_profile(db, alex)
    body = (
        await auth_client.get(
            f"/api/v1/projection?{ZEROS}&retire={alex.id}:{_month_param(this_month)}"
        )
    ).json()
    # No working phase to describe: the first flow month already withdraws.
    assert [phase["kind"] for phase in body["phases"]] == ["retired"]
    assert body["phases"][0]["from_month"] == this_month.isoformat()
    assert body["projected"][1] == "95000.00"


async def test_projection_retirement_reaches_the_monte_carlo_fan(auth_client, db):
    this_month = await _seed_book(db)
    alex = await _seed_person(db, "Alex", primary=True)
    await _seed_profile(db, alex)
    base = "/api/v1/projection?volatility=0.15&years=5"
    full = (await auth_client.get(base)).json()
    retired = (
        await auth_client.get(f"{base}&retire={alex.id}:{_month_param(month_add(this_month, 12))}")
    ).json()
    # The fan has to wrap the line it belongs to: same seed, a withdrawal instead of a
    # contribution from month 12 (2026-09-23 spec §R2) — the line and the median both fall.
    assert Decimal(retired["bands"]["p50"][-1]) < Decimal(full["bands"]["p50"][-1])
    assert Decimal(retired["bands"]["p90"][-1]) < Decimal(full["bands"]["p90"][-1])
    assert Decimal(retired["projected"][-1]) < Decimal(retired["projected"][12])
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
    # Five full months, then the only earner is retired: 5,000 a month out (2026-09-23 §R2).
    assert body["projected"][5] == "133000.00"  # 100,000 + 5 x 6,600
    assert body["projected"][7] == "123000.00"  # two withdrawals later


async def test_projection_retirement_uses_the_profile_in_force_not_the_newest(auth_client, db):
    # The Paycheck page, the Taxes page and this drop must never disagree about which
    # profile is current: a raise dated next year is not today's take-home.
    this_month = await _seed_book(db)
    alex = await _seed_person(db, "Alex", primary=True)
    await _seed_profile(db, alex)  # 24,000 -> 2,000/month, effective 30 days ago
    await _seed_profile(
        db,
        alex,
        effective_date=clock.product_today() + timedelta(days=400),
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
        "employer": "0.00",
        "total": "4400.00",
        "by_person": [
            {
                "person_id": alex.id,
                "name": "Alex",
                "monthly": "400.00",
                "employer_monthly": "0.00",
            }
        ],
    }
    assert body["warnings"] == [
        "Planning inputs include 2 unreviewed historical months.",
        "10 months in the 12-calendar-month planning window are excluded; "
        "older months do not replace them.",
    ]


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
    step = _steps(body)
    assert step(5) == Decimal("4400.00")
    # The only earner retired: the deductions stop with the paycheck and 5,000 a month goes out.
    assert step(6) == Decimal("-5000.00")


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


# --- the flow schedule (2026-09-23 spec §R1): contribution resets, a withdrawal and lumps ---


def test_project_with_the_new_inputs_empty_is_byte_identical():
    # The four strings test_project_growth_zero_matches_previous_behavior pins, on every empty
    # spelling of the three new inputs — resets, a withdrawal and lumps must cost the walk nothing.
    plain = project(Decimal("1000.00"), Decimal("100.00"), Decimal("0.05"), 3)
    assert [str(p) for p in plain] == ["1000.00", "1104.07", "1208.57", "1313.50"]
    for kwargs in ({}, {"resets": []}, {"withdrawal": None}, {"lumps": {}}, {"lumps": None}):
        again = project(
            Decimal("1000.00"), Decimal("100.00"), Decimal("0.05"), 3, Decimal("0"), **kwargs
        )
        assert again == plain, kwargs
    path = project_path(Decimal("1000.00"), Decimal("100.00"), Decimal("0.05"), 3)
    assert path.points == plain and path.depletion_index is None


def test_reset_schedule_folds_index_zero_and_refuses_a_second_reset_at_one_index():
    assert reset_schedule([(7, Decimal("100")), (3, Decimal("40"))]) == {
        7: Decimal("100"),
        3: Decimal("40"),
    }
    assert reset_schedule([(0, Decimal("40"))]) == {1: Decimal("40")}
    assert reset_schedule([]) == {}
    # A reset SETS a level: two at one index would be two answers to one question.
    with pytest.raises(ValueError, match="more than one contribution reset at month index 7"):
        reset_schedule([(7, Decimal("100")), (7, Decimal("40"))])
    # Folding happens BEFORE the check: index 0 and index 1 are the same month of flows.
    with pytest.raises(ValueError, match="month index 1"):
        reset_schedule([(0, Decimal("1")), (1, Decimal("2"))])


def test_a_reset_sets_the_level_in_t0_dollars_and_keeps_escalating():
    # g = 12 %/yr, tracked by repeated multiplication exactly as the walk escalates: the reset at
    # month 3 sets 60 × g^2, and month 4 carries that × g.
    growth = Decimal("1.12") ** (Decimal(1) / Decimal(12))
    flows = monthly_flows(
        Decimal("100"),
        growth,
        4,
        resets={3: Decimal("60")},
        withdrawal=None,
        lumps={},
        convert=Decimal,
    )
    assert flows[0] == Decimal("0")  # t0 is the starting balance and carries no flow
    assert flows[1] == Decimal("100")
    assert flows[2] == Decimal("100") * growth
    assert flows[3] == Decimal("60") * (Decimal(1) * growth * growth)
    assert flows[4] == flows[3] * growth
    # r = 0 isolates the escalator on the line too: every point is the running sum of flows.
    points = project(
        Decimal("1000.00"),
        Decimal("100"),
        Decimal("0"),
        4,
        Decimal("0.12"),
        resets=[(3, Decimal("60"))],
    )
    running = Decimal("1000")
    for index in range(1, 5):
        running += flows[index]
        assert points[index] == running.quantize(Decimal("0.01")), index


def test_a_reset_to_zero_stops_the_stream_and_growth_cannot_revive_it():
    points = project(
        Decimal("1000.00"),
        Decimal("100.00"),
        Decimal("0"),
        4,
        Decimal("0.12"),
        resets=[(2, Decimal("0"))],
    )
    assert [str(p) for p in points] == ["1000.00", "1100.00", "1100.00", "1100.00", "1100.00"]


def test_a_withdrawal_runs_from_its_month_clamps_at_zero_and_records_depletion():
    # 1,000 with nothing saved and 400 a month out from month 2: 1000, 1000, 600, 200, then -200,
    # which is clamped to 0 — and month 4 is the depletion month, never a later one.
    path = project_path(
        Decimal("1000.00"),
        Decimal("0"),
        Decimal("0"),
        6,
        Decimal("0"),
        withdrawal=(2, Decimal("400.00")),
    )
    assert [str(p) for p in path.points] == [
        "1000.00",
        "1000.00",
        "600.00",
        "200.00",
        "0.00",
        "0.00",
        "0.00",
    ]
    assert path.depletion_index == 4


def test_a_withdrawal_at_index_zero_folds_onto_the_first_month():
    at_zero = project(
        Decimal("1000.00"), Decimal("0"), Decimal("0"), 2, withdrawal=(0, Decimal("100"))
    )
    at_one = project(
        Decimal("1000.00"), Decimal("0"), Decimal("0"), 2, withdrawal=(1, Decimal("100"))
    )
    assert at_zero == at_one == [Decimal("1000.00"), Decimal("900.00"), Decimal("800.00")]


def test_a_negative_typed_contribution_clamps_and_records_depletion_before_any_drawdown():
    # The legal typed negative (the page's codec accepts it): -600 a month empties 1,000 in
    # month 2 with no withdrawal anywhere — balances stay at or above $0 in every phase.
    path = project_path(Decimal("1000.00"), Decimal("-600.00"), Decimal("0"), 3)
    assert [str(p) for p in path.points] == ["1000.00", "400.00", "0.00", "0.00"]
    assert path.depletion_index == 2


def test_pre_existing_debt_is_paid_down_unclamped_until_the_balance_first_reaches_zero():
    # 2026-09-24 review minor 1: a negative starting balance is debt, not a path that ran out —
    # the $0 floor and the depletion month wait until the balance has first been at or above 0.
    path = project_path(Decimal("-30000.00"), Decimal("10000.00"), Decimal("0"), 6)
    assert [str(p) for p in path.points] == [
        "-30000.00",
        "-20000.00",
        "-10000.00",
        "0.00",
        "10000.00",
        "20000.00",
        "30000.00",
    ]
    assert path.depletion_index is None
    # Never paid down: the debt simply stands (as before the clamp existed), nothing "ran out".
    stuck = project_path(Decimal("-30000.00"), Decimal("0"), Decimal("0"), 3)
    assert [str(p) for p in stuck.points] == ["-30000.00"] * 4
    assert stuck.depletion_index is None


def test_once_debt_is_paid_down_the_floor_and_depletion_hold_again():
    # Paid down by month 3 (exactly 0 counts), then a withdrawal from month 5 empties it: that is
    # the depletion month, clamped at $0 from there on.
    path = project_path(
        Decimal("-30000.00"),
        Decimal("10000.00"),
        Decimal("0"),
        6,
        resets=[(5, Decimal("0"))],
        withdrawal=(5, Decimal("25000.00")),
    )
    assert [str(p) for p in path.points] == [
        "-30000.00",
        "-20000.00",
        "-10000.00",
        "0.00",
        "10000.00",
        "0.00",
        "0.00",
    ]
    assert path.depletion_index == 5


async def test_a_negative_investable_balance_is_carried_not_wiped_to_zero(auth_client, db):
    # The route end to end: -50,000 invested (the brokerage row) with 4,000 a month saved climbs
    # as it always did; the clamp used to zero it in month 1 and call that "ran out". The
    # growth-only line keeps the debt too.
    await _seed_book(db)
    brokerage = (
        await db.execute(
            select(AccountBalance).where(AccountBalance.balance == Decimal("100000.00"))
        )
    ).scalar_one()
    brokerage.balance = Decimal("-50000.00")
    await db.commit()
    zeros = "annual_return=0&inflation=0&contribution_growth=0&volatility=0&years=2"
    body = (await auth_client.get(f"/api/v1/projection?{zeros}")).json()
    assert body["starting_balance"] == "-50000.00"
    assert body["projected"][:4] == ["-50000.00", "-46000.00", "-42000.00", "-38000.00"]
    assert body["coast"][:3] == ["-50000.00", "-50000.00", "-50000.00"]


def test_lumps_add_exactly_at_their_month_and_index_zero_folds_and_sums():
    points = project(
        Decimal("1000.00"),
        Decimal("100.00"),
        Decimal("0"),
        3,
        lumps={0: Decimal("5"), 1: Decimal("7"), 3: Decimal("250.50")},
    )
    assert [str(p) for p in points] == ["1000.00", "1112.00", "1212.00", "1562.50"]


def test_the_calendar_helpers_name_the_decembers_on_the_axis():
    start = date(2026, 9, 1)
    assert december_index(start, 2026) == 3
    assert december_index(start, 2055) == 351
    assert latest_december_year(start, 360) == 2055  # Sep 2056 ends the default axis
    assert latest_december_year(date(2026, 12, 1), 12) == 2027
    assert latest_december_year(date(2026, 1, 1), 12) == 2026
    assert max_plan_until_year(start) == 2085  # Dec 2085 is month 711 of 720
    assert max_plan_until_year(date(2026, 12, 1)) == 2086  # Dec 2086 is exactly month 720


async def test_projection_annual_spend_is_living_spend_over_the_matched_window(auth_client, db):
    this_month = await _seed_book(db, adopt=False)
    taxes = SpendingCategory(name="Taxes", slug="taxes", sort_order=2, kind="tax")
    db.add(taxes)
    await db.flush()
    db.add(
        MonthlySpending(
            month=month_add(this_month, -1), category_id=taxes.id, amount=Decimal("1200.00")
        )
    )
    await db.commit()
    await adopt_existing_history(db, clock.product_today())
    await db.commit()
    body = (await auth_client.get("/api/v1/projection")).json()
    # An income-tax payment is not living cost, so the FI target does not grow by it...
    assert body["annual_spend"] == "60000.00"  # mean(6000, 4000) x 12, unchanged
    # ...but it WAS paid out of take-home, so cash savings fall: mean(1800, 5000).
    assert body["monthly_contribution"] == "3400.00"
    assert body["derived_window"] == {
        "from": month_add(this_month, -12).isoformat(),
        "to": month_add(this_month, -1).isoformat(),
        "months": 2,
    }


async def test_projection_ignores_a_zero_filled_month_with_no_take_home(auth_client, db):
    this_month = await _seed_book(db)
    rent = (await db.execute(select(SpendingCategory))).scalars().one()
    # The audit's headline: a balances-only save wrote $0.00 for every category this
    # month. It has no take-home, so it is not a matched month and cannot drag the mean.
    db.add(MonthlySpending(month=this_month, category_id=rent.id, amount=Decimal("0.00")))
    await db.commit()
    body = (await auth_client.get("/api/v1/projection")).json()
    assert body["annual_spend"] == "60000.00"  # NOT mean(0, 6000, 4000) x 12 = 40000.00
    assert body["monthly_contribution"] == "4000.00"
    assert body["derived_window"]["months"] == 2
    assert body["derived_window"]["to"] == month_add(this_month, -1).isoformat()


async def test_projection_says_so_when_no_month_has_both_halves(auth_client, db):
    this_month = await _seed_book(db, with_history=False)
    cat = SpendingCategory(name="Rent", slug="rent", sort_order=1)
    db.add(cat)
    await db.flush()
    # Spending in one month, take-home in another: data everywhere, nothing to average.
    db.add_all(
        [
            MonthlySpending(
                month=month_add(this_month, -2), category_id=cat.id, amount=Decimal("5000.00")
            ),
            MonthlyCashflow(month=month_add(this_month, -1), net_pay=Decimal("9000.00")),
        ]
    )
    await db.commit()
    body = (await auth_client.get("/api/v1/projection")).json()
    assert body["derived_window"] is None
    assert body["monthly_contribution"] == "0.00"
    assert body["annual_spend"] is None
    assert (
        "no eligible completed month has both spending and take-home on file — "
        "the contribution and annual spend could not be derived"
    ) in body["warnings"]


async def test_derived_window_is_null_when_both_knobs_were_typed(auth_client, db):
    """The echo describes a DERIVATION (schemas/projection.DerivedWindowOut), so it is
    null for the same reason `contribution_breakdown` is: nothing was averaged. A window
    printed beside two typed numbers would claim the opposite (review R1)."""
    await _seed_book(db)
    body = (
        await auth_client.get("/api/v1/projection?monthly_contribution=1000&annual_spend=50000")
    ).json()
    assert body["derived_window"] is None
    assert body["contribution_breakdown"] is None
    # One typed knob still leaves the OTHER derived, so the window is what explains it.
    half = (await auth_client.get("/api/v1/projection?annual_spend=50000")).json()
    assert half["derived_window"]["months"] == 2
    assert half["contribution_breakdown"] is not None


async def test_a_spending_only_book_gets_one_warning_not_two(auth_client, db):
    """Take-home is the missing half, and `NO_CASHFLOW_WARNING` names it exactly. The
    matched-months sentence is for a book that has BOTH halves and never together, and a
    "no spending history" line would be plainly false here (review R3)."""
    this_month = await _seed_book(db, with_history=False)
    cat = SpendingCategory(name="Rent", slug="rent", sort_order=1)
    db.add(cat)
    await db.flush()
    db.add(
        MonthlySpending(
            month=month_add(this_month, -1), category_id=cat.id, amount=Decimal("5000.00")
        )
    )
    await db.commit()
    body = (await auth_client.get("/api/v1/projection")).json()
    assert body["warnings"] == ["no cashflow history — monthly contribution defaulted to 0"]
    assert body["annual_spend"] is None and body["derived_window"] is None


MATCHED_PROFILE = {
    "trad_401k_pct": Decimal("0.10"),
    "match_rate_1": Decimal("1"),
    "match_band_1": Decimal("1200.00"),
    "match_rate_2": Decimal("0.5"),
    "match_band_2": Decimal("1200.00"),
}


async def test_projection_adds_the_employer_match_as_its_own_leg(auth_client, db):
    await _seed_book(db)
    alex = await _seed_person(db, "Alex", primary=True)
    await _seed_profile(db, alex, **MATCHED_PROFILE)
    body = (await auth_client.get("/api/v1/projection")).json()
    # 24,000 salary, 10 % elective = 2,400 a year: 100 % of the first 1,200 + 50 % of the
    # next 1,200 = 1,800 a year = 150.00 a month, and it is the EMPLOYER's money.
    breakdown = body["contribution_breakdown"]
    assert breakdown["payroll"] == "200.00"
    assert breakdown["employer"] == "150.00"
    assert breakdown["total"] == "4350.00"
    assert breakdown["by_person"][0]["employer_monthly"] == "150.00"
    assert body["monthly_contribution"] == "4350.00"


async def test_projection_retirement_also_drops_the_employer_match(auth_client, db):
    this_month = await _seed_book(db)
    alex = await _seed_person(db, "Alex", primary=True)
    await _seed_profile(db, alex, **MATCHED_PROFILE)
    body = (
        await auth_client.get(
            "/api/v1/projection?annual_return=0&inflation=0&contribution_growth=0&volatility=0"
            f"&retire={alex.id}:{_month_param(month_add(this_month, 6))}"
        )
    ).json()
    # Both sides stay symmetric: the leg the profile added is the leg retiring removes —
    # take-home 1,800 + payroll 200 + employer 150.
    assert body["retirements"][0]["monthly_drop"] == "2150.00"


async def test_projection_echoes_the_budgets_annual_spend(auth_client, db):
    this_month = await _seed_book(db)
    # No budgets: the echo is null and the knobs card shows no preset.
    first = (await auth_client.get("/api/v1/projection")).json()
    assert first["budget_annual_spend"] is None and first["budget_month"] is None
    rent = (
        await db.execute(select(SpendingCategory).where(SpendingCategory.slug == "rent"))
    ).scalar_one()
    fun = SpendingCategory(name="Fun", slug="fun", sort_order=2)
    tax = SpendingCategory(name="Taxes", slug="taxes", sort_order=3, kind="tax")
    old = SpendingCategory(name="Old", slug="old", sort_order=4, is_active=False)
    db.add_all([fun, tax, old])
    await db.flush()
    db.add_all(
        [
            CategoryBudget(
                category_id=rent.id,
                effective_month=month_add(this_month, -3),
                amount=Decimal("2000.00"),
            ),
            CategoryBudget(
                category_id=fun.id, effective_month=this_month, amount=Decimal("300.00")
            ),
            # A row dated NEXT month is not yet in force; a tax kind and an archived category are
            # never modeled spend.
            CategoryBudget(
                category_id=fun.id,
                effective_month=month_add(this_month, 1),
                amount=Decimal("999.00"),
            ),
            CategoryBudget(
                category_id=tax.id, effective_month=this_month, amount=Decimal("5000.00")
            ),
            CategoryBudget(
                category_id=old.id, effective_month=this_month, amount=Decimal("400.00")
            ),
        ]
    )
    await db.commit()
    body = (await auth_client.get("/api/v1/projection")).json()
    assert body["budget_annual_spend"] == "27600.00"  # (2000 + 300) x 12
    assert body["budget_month"] == this_month.isoformat()
    # The DERIVED knob is untouched — the echo is a preset for the card, not a new default.
    assert body["annual_spend"] == "60000.00"


# --- "plan until" (2026-09-23 spec §R3, the Settings default §R11) ---


def _plan_setting(year) -> AppSetting:
    return AppSetting(key="plan_until_year", value={"value": year})


async def test_plan_until_defaults_to_the_last_december_on_the_axis_without_extending_it(
    auth_client, db
):
    this_month = await _seed_book(db)
    zeros = "volatility=0&inflation=0&contribution_growth=0"
    body = (await auth_client.get(f"/api/v1/projection?years=2&{zeros}")).json()
    assert body["plan_until"] == latest_december_year(this_month, 24)
    assert body["plan_until_source"] == "default"
    # No stored year and no knob: the axis and every array are the pre-batch ones.
    assert body["years"] == 2 and body["projected"] == BACKCOMPAT_PROJECTED_2Y
    assert not [w for w in body["warnings"] if "plan-until" in w or "lengthened" in w]


async def test_a_stored_plan_until_year_is_the_default_and_the_knob_wins(auth_client, db):
    this_month = await _seed_book(db)
    db.add(_plan_setting(this_month.year + 20))
    await db.commit()
    stored = (await auth_client.get("/api/v1/projection?volatility=0")).json()
    assert stored["plan_until"] == this_month.year + 20
    assert stored["plan_until_source"] == "setting"
    knob = (
        await auth_client.get(f"/api/v1/projection?volatility=0&plan_until={this_month.year + 5}")
    ).json()
    assert knob["plan_until"] == this_month.year + 5 and knob["plan_until_source"] == "knob"


async def test_a_passed_stored_year_is_ignored_with_its_warning(auth_client, db):
    this_month = await _seed_book(db)
    db.add(_plan_setting(this_month.year - 1))
    await db.commit()
    body = (await auth_client.get("/api/v1/projection?volatility=0")).json()
    default = latest_december_year(this_month, 360)
    assert body["plan_until"] == default and body["plan_until_source"] == "default"
    assert (
        f"The plan-until year in Settings ({this_month.year - 1}) has passed — using {default}."
    ) in body["warnings"]


async def test_a_stored_year_past_the_reach_is_ignored_with_its_warning(auth_client, db):
    # Only a hand-edited row can hold one (the PUT refuses it): never a 422 on a bare GET.
    this_month = await _seed_book(db)
    beyond = max_plan_until_year(this_month) + 1
    db.add(_plan_setting(beyond))
    await db.commit()
    body = (await auth_client.get("/api/v1/projection?volatility=0")).json()
    default = latest_december_year(this_month, 360)
    assert body["plan_until"] == default and body["plan_until_source"] == "default"
    assert (
        f"The plan-until year in Settings ({beyond}) is past the projection's 60-year reach"
        f" — using {default}."
    ) in body["warnings"]


async def test_a_later_plan_until_lengthens_the_horizon_to_reach_its_december(auth_client, db):
    this_month = await _seed_book(db)
    year = this_month.year + 49
    body = (await auth_client.get(f"/api/v1/projection?volatility=0&plan_until={year}")).json()
    to_december = december_index(this_month, year)
    expected = -(-to_december // 12)  # ceil: months not a multiple of 12 round UP
    assert body["years"] == expected
    assert len(body["months"]) == expected * 12 + 1
    assert date.fromisoformat(body["months"][-1]) >= date(year, 12, 1)
    assert (f"The horizon was lengthened to {expected} years to reach the end of {year}.") in body[
        "warnings"
    ]
    # A plan-until year already on the axis never shortens it.
    short = (
        await auth_client.get(f"/api/v1/projection?volatility=0&plan_until={this_month.year}")
    ).json()
    assert short["years"] == 30


async def test_plan_until_422s_before_the_start_year_and_past_sixty_years(auth_client, db):
    this_month = await _seed_book(db)
    early = await auth_client.get(f"/api/v1/projection?plan_until={this_month.year - 1}")
    assert early.status_code == 422
    assert early.json()["detail"] == f"plan_until must be {this_month.year} or later"
    latest = max_plan_until_year(this_month)
    late = await auth_client.get(f"/api/v1/projection?plan_until={latest + 1}")
    assert late.status_code == 422
    assert late.json()["detail"] == (
        f"plan_until must be {latest} or earlier — the projection runs at most 60 years"
    )
    ok = await auth_client.get(f"/api/v1/projection?plan_until={latest}&volatility=0")
    assert ok.status_code == 200, ok.text
    assert ok.json()["years"] <= 60


async def test_retirement_months_are_validated_against_the_lengthened_axis(auth_client, db):
    this_month = await _seed_book(db)
    alex = await _seed_person(db, "Alex", primary=True)
    await _seed_profile(db, alex)
    far = _month_param(month_add(this_month, 45 * 12))  # past 30 years, inside 50
    refused = await auth_client.get(f"/api/v1/projection?retire={alex.id}:{far}")
    assert refused.status_code == 422
    assert "outside the 30-year horizon" in refused.json()["detail"]
    ok = await auth_client.get(
        f"/api/v1/projection?volatility=0&plan_until={this_month.year + 49}&retire={alex.id}:{far}"
    )
    assert ok.status_code == 200, ok.text


# --- "money lasts" (2026-09-23 spec §R3) ---


def test_the_verdict_boundaries_sit_exactly_on_ninety_and_seventy_five():
    assert money_lasts_verdict(Decimal("1")) == "on_track"
    assert money_lasts_verdict(Decimal("0.9")) == "on_track"
    assert money_lasts_verdict(Decimal("0.898")) == "borderline"
    assert money_lasts_verdict(Decimal("0.75")) == "borderline"
    assert money_lasts_verdict(Decimal("0.748")) == "at_risk"
    assert money_lasts_verdict(Decimal("0")) == "at_risk"


async def test_money_lasts_is_null_with_the_reason_until_everyone_has_retired(auth_client, db):
    this_month = await _seed_book(db)
    alex = await _seed_person(db, "Alex", primary=True)
    bo = await _seed_person(db, "Bo")
    await _seed_profile(db, alex)
    await _seed_profile(db, bo)
    none = (await auth_client.get("/api/v1/projection")).json()["money_lasts"]
    assert none["reason"] == "Set retirement months to see whether the money lasts."
    assert none["probability"] is None and none["verdict"] is None
    assert none["lasts_until_p10"] is None and none["deterministic_depleted_month"] is None
    assert none["plan_until"] == latest_december_year(this_month, 360)
    one = (
        await auth_client.get(
            f"/api/v1/projection?retire={alex.id}:{_month_param(month_add(this_month, 12))}"
        )
    ).json()["money_lasts"]
    assert one["reason"] == (
        "Withdrawals start once everyone with a paycheck has a retirement month — Bo has none."
    )


async def test_the_reason_names_every_earner_without_a_month(auth_client, db):
    this_month = await _seed_book(db)
    people = [await _seed_person(db, name, primary=name == "Ann") for name in ("Ann", "Bo", "Cy")]
    for person in people:
        await _seed_profile(db, person)
    body = (
        await auth_client.get(
            f"/api/v1/projection?retire={people[0].id}:{_month_param(month_add(this_month, 12))}"
        )
    ).json()
    assert body["money_lasts"]["reason"] == (
        "Withdrawals start once everyone with a paycheck has a retirement month — "
        "Bo and Cy have none."
    )


async def test_money_lasts_needs_an_annual_spend(auth_client, db):
    this_month = await _seed_book(db, with_history=False)
    alex = await _seed_person(db, "Alex", primary=True)
    await _seed_profile(db, alex)
    body = (
        await auth_client.get(
            f"/api/v1/projection?retire={alex.id}:{_month_param(month_add(this_month, 12))}"
        )
    ).json()
    assert body["money_lasts"]["reason"] == (
        "Withdrawals need an annual spend — type one or enter spending history."
    )
    assert body["drawdown"] is None
    assert [phase["kind"] for phase in body["phases"]] == ["working", "retired"]
    assert body["phases"][1]["monthly_withdrawal"] is None


async def test_a_plan_until_before_the_drawdown_names_both(auth_client, db):
    this_month = await _seed_book(db)
    alex = await _seed_person(db, "Alex", primary=True)
    await _seed_profile(db, alex)
    retires = month_add(this_month, 30)
    body = (
        await auth_client.get(
            f"/api/v1/projection?plan_until={this_month.year}"
            f"&retire={alex.id}:{_month_param(retires)}"
        )
    ).json()
    lasts = body["money_lasts"]
    assert lasts["reason"] == (
        f"{this_month.year} is before withdrawals begin ({retires:%b %Y}) — choose a later year."
    )
    assert lasts["probability"] is None and lasts["verdict"] is None
    assert lasts["deterministic_depleted_month"] is None


async def test_success_is_counted_through_december_of_the_plan_until_year(auth_client, db):
    # A near-deterministic run (sigma 1e-6) that runs out in the JANUARY after the plan-until
    # year: every path survives through December (success), and a year later none does.
    this_month = await _seed_book(db)
    alex = await _seed_person(db, "Alex", primary=True)
    await _seed_profile(db, alex)
    july = date(this_month.year + (1 if this_month.month >= 6 else 0), 7, 1)
    k = december_index(this_month, july.year) - 5  # July's index
    before = Decimal(100000 + (k - 1) * 4000)  # the balance the month before the withdrawals
    annual_spend = (before * 12 / Decimal("6.5")).quantize(Decimal("0.01"))  # 7th month runs out
    url = (
        "/api/v1/projection?annual_return=0&inflation=0&contribution_growth=0"
        f"&volatility=0.000001&annual_spend={annual_spend}&retire={alex.id}:{_month_param(july)}"
    )
    through = (await auth_client.get(f"{url}&plan_until={july.year}")).json()["money_lasts"]
    january = date(july.year + 1, 1, 1)
    assert through["deterministic_depleted_month"] == january.isoformat()
    assert through["probability"] == "1.000000" and through["verdict"] == "on_track"
    assert through["lasts_until_p10"] == january.isoformat()
    later = (await auth_client.get(f"{url}&plan_until={july.year + 1}")).json()["money_lasts"]
    assert later["probability"] == "0.000000" and later["verdict"] == "at_risk"


async def test_lasts_until_p10_is_null_when_fewer_than_one_in_ten_paths_run_out(auth_client, db):
    this_month = await _seed_book(db)
    alex = await _seed_person(db, "Alex", primary=True)
    await _seed_profile(db, alex)
    body = (
        await auth_client.get(
            "/api/v1/projection?annual_spend=100"
            f"&retire={alex.id}:{_month_param(month_add(this_month, 12))}"
        )
    ).json()
    lasts = body["money_lasts"]
    assert lasts["reason"] is None
    assert lasts["probability"] == "1.000000" and lasts["verdict"] == "on_track"
    assert lasts["lasts_until_p10"] is None
    assert lasts["deterministic_depleted_month"] is None
    assert lasts["horizon_end"] == body["months"][-1]


async def test_volatility_zero_reports_only_the_constant_return_month(auth_client, db):
    this_month = await _seed_book(db)
    alex = await _seed_person(db, "Alex", primary=True)
    await _seed_profile(db, alex)
    body = (
        await auth_client.get(
            f"/api/v1/projection?{ZEROS}&retire={alex.id}:{_month_param(month_add(this_month, 12))}"
        )
    ).json()
    lasts = body["money_lasts"]
    assert lasts["probability"] is None and lasts["verdict"] is None
    assert lasts["lasts_until_p10"] is None and lasts["reason"] is None
    # 144,000 the month before; 5,000 a month out from month 12: below zero in month 40.
    assert lasts["deterministic_depleted_month"] == month_add(this_month, 40).isoformat()


async def test_a_negative_contribution_that_empties_the_balance_fails_too(auth_client, db):
    # The clamp holds in every phase, and success counts a depletion in ANY phase (§R1, §R3).
    this_month = await _seed_book(db)
    alex = await _seed_person(db, "Alex", primary=True)
    await _seed_profile(db, alex)
    body = (
        await auth_client.get(
            "/api/v1/projection?monthly_contribution=-50000&annual_spend=100"
            f"&retire={alex.id}:{_month_param(month_add(this_month, 24))}"
        )
    ).json()
    lasts = body["money_lasts"]
    assert lasts["probability"] == "0.000000" and lasts["verdict"] == "at_risk"
    assert date.fromisoformat(lasts["lasts_until_p10"]) < month_add(this_month, 24)
    assert body["projected"][3] == "0.00"  # 100,000 cannot survive -50,000 a month for three


# --- scheduled vests, on by default (2026-09-23 spec §R4) ---

Z = "volatility=0&inflation=0&contribution_growth=0&annual_return=0"


async def _seed_vests(
    db,
    *,
    ticker: str | None = "NVDA",
    quote: Decimal | None = Decimal("100.00"),
    first: date | None = None,
    cliff: Decimal = Decimal("0.2500"),
) -> RsuGrant:
    """1,600 shares: a 25 % cliff (400 sh) on the 16th of NEXT month, then 100 shares a quarter
    on the third Wednesday — priced at `quote` through the ESPP ticker's latest price."""
    if ticker is not None:
        security = Security(ticker=ticker, name=ticker, holding_type="stock")
        db.add_all([security, AppSetting(key="espp_ticker", value={"value": ticker})])
        await db.flush()
        if quote is not None:
            db.add(
                LatestPrice(
                    security_id=security.id,
                    price=quote,
                    quoted_at=datetime.combine(clock.product_today(), time(20), tzinfo=UTC),
                    source="yfinance",
                )
            )
    next_month = month_add(clock.product_today().replace(day=1), 1)
    grant = RsuGrant(
        kind="new_hire",
        label="Offer",
        focal_year=None,
        shares=1600,
        grant_price=Decimal("100"),
        first_vest_date=first or next_month.replace(day=16),
        cliff_pct=cliff,
        vest_quantum=1,
    )
    db.add(grant)
    await db.commit()
    return grant


def _kept(grant, *, after: date, before: date | None = None, last_month: date | None = None):
    """The router's rule restated over the schedule: dated after the base's date, before the
    primary's retirement month, on the axis."""
    return [
        (day, shares)
        for day, shares in rsu_vesting.schedule(grant)
        if day > after
        and (before is None or day < before)
        and (last_month is None or day.replace(day=1) <= last_month)
    ]


def _net(shares: int, price: Decimal = Decimal("100")) -> Decimal:
    return after_sell_to_cover((price * shares).quantize(Decimal("0.01")))


async def test_vests_are_on_by_default_and_off_is_byte_identical(auth_client, db):
    await _seed_book(db)
    before = (await auth_client.get(f"/api/v1/projection?{Z}")).json()
    await _seed_vests(db)
    on = (await auth_client.get(f"/api/v1/projection?{Z}")).json()
    off = (await auth_client.get(f"/api/v1/projection?{Z}&vests=0")).json()
    assert off["projected"] == before["projected"] and off["coast"] == before["coast"]
    assert off["vests"]["included"] is False and on["vests"]["included"] is True
    assert Decimal(on["projected"][-1]) > Decimal(off["projected"][-1])
    # Vests never enter the growth-only line or the FI target.
    assert on["coast"] == off["coast"] and on["fi_target"] == off["fi_target"]
    assert on["vests"]["withholding_rate"] == "0.3223"
    assert on["vests"]["price"] == "100.0000"
    assert on["vests"]["price_as_of"] == clock.product_today().isoformat()
    assert on["vests"]["excluded_reason"] is None
    # The readout survives "off": it is what the toggle would add.
    assert off["vests"]["next_12_months"] == on["vests"]["next_12_months"]
    explicit_on = (await auth_client.get(f"/api/v1/projection?{Z}&vests=1")).json()
    assert explicit_on["projected"] == on["projected"]


async def test_a_vest_lands_in_its_month_after_the_calendars_sell_to_cover(auth_client, db):
    await _seed_book(db)
    await _seed_vests(db)
    body = (await auth_client.get(f"/api/v1/projection?{Z}")).json()
    assert _net(400) == Decimal("27108.00")  # 400 sh x $100 after 32.23 %
    step = Decimal(body["projected"][1]) - Decimal(body["projected"][0])
    assert step == Decimal("4000.00") + _net(400)


async def test_by_year_and_the_next_twelve_months_sum_the_kept_vests(auth_client, db):
    this_month = await _seed_book(db)
    grant = await _seed_vests(db)
    body = (await auth_client.get(f"/api/v1/projection?{Z}")).json()
    last_month = date.fromisoformat(body["months"][-1])
    kept = _kept(grant, after=this_month, last_month=last_month)
    assert len(kept) == 13  # the whole grant vests inside 30 years
    by_year: dict[int, list[Decimal]] = {}
    for day, shares in kept:
        pair = by_year.setdefault(day.year, [Decimal("0.00"), Decimal("0.00")])
        pair[0] += (Decimal("100") * shares).quantize(Decimal("0.01"))
        pair[1] += _net(shares)
    assert body["vests"]["by_year"] == [
        {"year": year, "gross": str(gross), "after_withholding": str(net)}
        for year, (gross, net) in sorted(by_year.items())
    ]
    today = clock.product_today()
    year_on = date(today.year + 1, today.month, min(today.day, 28 if today.month == 2 else 31))
    expected = sum((_net(s) for d, s in kept if today < d <= year_on), Decimal("0.00"))
    assert body["vests"]["next_12_months"] == str(expected)


async def test_the_primarys_retirement_stops_the_vests(auth_client, db):
    this_month = await _seed_book(db)
    alex = await _seed_person(db, "Alex", primary=True)
    bo = await _seed_person(db, "Bo")
    await _seed_profile(db, alex)
    await _seed_profile(db, bo)
    grant = await _seed_vests(db)
    retires = month_add(this_month, 7)
    body = (
        await auth_client.get(f"/api/v1/projection?{Z}&retire={alex.id}:{_month_param(retires)}")
    ).json()
    assert body["vests"]["stops"] == retires.isoformat()
    kept = _kept(grant, after=this_month, before=retires)
    gross = sum(Decimal(row["gross"]) for row in body["vests"]["by_year"])
    assert gross == sum((Decimal(100 * shares) for _, shares in kept), Decimal("0"))
    # Bo does not hold the grants: his retirement stops nothing.
    bo_only = (
        await auth_client.get(f"/api/v1/projection?{Z}&retire={bo.id}:{_month_param(retires)}")
    ).json()
    assert bo_only["vests"]["stops"] is None
    assert len(bo_only["vests"]["by_year"]) >= len(body["vests"]["by_year"])


async def test_no_ticker_leaves_vests_out_with_the_reason(auth_client, db):
    await _seed_book(db)
    before = (await auth_client.get(f"/api/v1/projection?{Z}")).json()
    await _seed_vests(db, ticker=None)
    body = (await auth_client.get(f"/api/v1/projection?{Z}")).json()
    assert body["vests"]["included"] is False
    assert body["vests"]["excluded_reason"] == (
        "Set the employer-stock ticker in Settings to include vests"
    )
    assert body["projected"] == before["projected"]


async def test_no_quote_leaves_vests_out_naming_the_ticker(auth_client, db):
    await _seed_book(db)
    await _seed_vests(db, quote=None)
    body = (await auth_client.get(f"/api/v1/projection?{Z}")).json()
    assert body["vests"]["included"] is False
    assert body["vests"]["excluded_reason"] == "No NVDA quote yet — scheduled vests are left out"


async def test_a_grant_that_will_not_schedule_is_skipped_with_the_comp_warning(auth_client, db):
    await _seed_book(db)
    await _seed_vests(db, cliff=Decimal("0.3000"))  # 0.7 is not a whole number of 6.25 % steps
    body = (await auth_client.get(f"/api/v1/projection?{Z}")).json()
    assert (
        "Offer: stored grant cannot be scheduled — "
        "(1 - cliff_pct) must be a whole number of 6.25% steps"
    ) in body["warnings"]
    assert body["vests"]["by_year"] == [] and body["vests"]["next_12_months"] == "0.00"


async def test_without_grants_there_is_no_vests_echo(auth_client, db):
    await _seed_book(db)
    assert (await auth_client.get("/api/v1/projection")).json()["vests"] is None


def test_a_quote_is_dated_by_its_utc_day_the_apps_quote_convention():
    # A daily close is stored at midnight UTC (the copy's NVDA quote: 2026-09-22 00:00 UTC); read
    # in Pacific time it would be dated the day before. Quote staleness is UTC by design too.
    assert quote_date(datetime(2026, 9, 22, 0, 0, tzinfo=UTC)) == date(2026, 9, 22)
    assert quote_date(datetime(2026, 9, 21, 20, 10, tzinfo=UTC)) == date(2026, 9, 21)
    assert quote_date(None) is None
