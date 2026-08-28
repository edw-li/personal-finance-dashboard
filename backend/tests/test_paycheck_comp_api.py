"""Paycheck waterfall + comp events: the two pure calc modules and both routers.

The paycheck golden is the Workbook reference profile (salary 188930, 24 periods, trad
.13 / roth 0 / after-tax .03 / espp .11, withholding 0.334009167 at 9dp, dental 12.50,
HSA 100) pushed through `paycheck_calc.breakdown` AND through the endpoint. Every line is
pinned at the cent, and the full-precision net is pinned too: the chain must stay
full-precision internally, because the DISPLAYED lines disagree with the displayed net by
a cent (4486.26 - 236.16 - 865.93 = 3384.17, but the net is 3384.16 — net is the
authoritative one).

The comp golden is the plan's four-row Focal History table. The stored inputs behind it
are reconstructed from the pinned outputs (the bases chain: 2024's new base is 2025's
current base, and 2026's new base is the paycheck profile's salary), so every row is
column-scale exact: RSU counts Numeric(12,4), prices Numeric(14,4), bases Numeric(12,2).

Both routers write at column scale before the first insert, so the shared-session
contract (conftest) hands the endpoint back the very object it built — a wire string
that is short here means the WRITER skipped a quantize, not a re-read.
"""

from datetime import date, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.models import CompEvent, PaycheckProfile, Person
from app.services.comp_calc import metrics
from app.services.paycheck_calc import breakdown, half_up2

PROFILES = "/api/v1/paycheck/profiles"
BREAKDOWN = "/api/v1/paycheck/breakdown"
EVENTS = "/api/v1/comp/events"

D = Decimal


def profile(**overrides) -> PaycheckProfile:
    """The real profile, at the scale the router quantizes to: salary Numeric(12,2),
    pcts Numeric(10,9), dental/HSA Numeric(8,2)."""
    fields = {
        "effective_date": date(2026, 1, 1),
        "annual_salary": D("188930.00"),
        "pay_periods_per_year": 24,
        "trad_401k_pct": D("0.130000000"),
        "roth_401k_pct": D("0.000000000"),
        "after_tax_401k_pct": D("0.030000000"),
        "espp_pct": D("0.110000000"),
        "withholding_pct": D("0.334009167"),
        "dental_vision_per_check": D("12.50"),
        "hsa_per_check": D("100.00"),
    }
    fields.update(overrides)
    return PaycheckProfile(**fields)


def cents(profile_row: PaycheckProfile) -> dict[str, Decimal]:
    """The waterfall as the router serializes it: every full-precision line at 2dp."""
    return {name: half_up2(value) for name, value in breakdown(profile_row).items()}


def event(**overrides) -> CompEvent:
    fields = {
        "focal_year": 2026,
        "current_base": D("162000.00"),
        "new_base": D("188930.00"),
        "unvested_rsus": D("1822.0000"),
        "unvested_price": D("183.2508"),
        "refresh_rsus": D("610.0524"),
        "grant_price": D("129.5651"),
    }
    fields.update(overrides)
    return CompEvent(**fields)


# --- paycheck_calc (pure) ---


def test_paycheck_waterfall_golden_over_the_real_profile():
    lines = cents(profile())
    assert lines == {
        "gross": D("7872.08"),  # 188930 / 24
        "trad_401k": D("1023.37"),
        "dental_vision": D("12.50"),
        "hsa": D("100.00"),
        "taxable": D("6736.21"),
        "withholding": D("2249.96"),
        "post_tax": D("4486.26"),
        "roth_401k": D("0.00"),
        "after_tax_401k": D("236.16"),
        "espp": D("865.93"),
        "net_pay": D("3384.16"),
        "monthly_net": D("6768.33"),
    }
    # The displayed lines do NOT reconcile to the displayed net — that cent is why the
    # chain must never quantize an intermediate.
    assert lines["post_tax"] - lines["roth_401k"] - lines["after_tax_401k"] - lines["espp"] == D(
        "3384.17"
    )
    full = breakdown(profile())
    assert full["net_pay"] == D("3384.164107473345833333333333")
    assert full["monthly_net"] == full["net_pay"] * 24 / 12


def test_paycheck_waterfall_at_26_periods():
    lines = cents(profile(pay_periods_per_year=26))
    assert lines["gross"] == D("7266.54")  # 188930 / 26
    assert lines["taxable"] == D("6209.39")
    assert lines["net_pay"] == D("3118.08")
    # monthly = net x 26 / 12, not net x 2 — the sheet's hardcoded 24 is a parameter here.
    assert lines["monthly_net"] == D("6755.84")


def test_paycheck_waterfall_with_no_contributions_nets_the_post_tax_line():
    lines = cents(
        profile(
            annual_salary=D("120000.00"),
            trad_401k_pct=D("0.000000000"),
            after_tax_401k_pct=D("0.000000000"),
            espp_pct=D("0.000000000"),
            withholding_pct=D("0.000000000"),
        )
    )
    assert lines["gross"] == D("5000.00")
    assert lines["trad_401k"] == D("0.00")
    assert lines["taxable"] == D("4887.50")  # only dental + HSA come off
    assert lines["withholding"] == D("0.00")
    assert lines["net_pay"] == lines["post_tax"] == D("4887.50")
    assert lines["monthly_net"] == D("9775.00")


def test_paycheck_waterfall_collapses_a_negative_zero_net():
    # 1.00 gross, half withheld, and a roth pct one ulp over the half: the net is
    # -1E-9, which quantizes to Decimal("-0.00") without the house `+ ZERO` collapse.
    lines = cents(
        profile(
            annual_salary=D("24.00"),
            trad_401k_pct=D("0.000000000"),
            roth_401k_pct=D("0.500000001"),
            after_tax_401k_pct=D("0.000000000"),
            espp_pct=D("0.000000000"),
            withholding_pct=D("0.500000000"),
            dental_vision_per_check=D("0.00"),
            hsa_per_check=D("0.00"),
        )
    )
    assert str(lines["net_pay"]) == "0.00"
    assert str(lines["monthly_net"]) == "0.00"


# --- comp_calc (pure) ---


@pytest.mark.parametrize(
    ("row", "expected"),
    [
        (
            event(
                focal_year=2024,
                current_base=D("145000.00"),
                new_base=D("151000.00"),
                unvested_rsus=D("2500.0000"),
                unvested_price=D("89.6600"),
                refresh_rsus=D("400.0000"),
                grant_price=D("89.8200"),
            ),
            {
                "base_delta": D("6000.00"),
                "base_delta_pct": D("0.041379"),
                "unvested_equity": D("224150.00"),
                "equity_delta": D("35928.00"),
                "equity_delta_pct": D("0.160286"),
                "tc_before": D("369150.00"),
                "tc_after": D("411078.00"),
            },
        ),
        (
            event(
                focal_year=2025,
                current_base=D("151000.00"),
                new_base=D("162000.00"),
                unvested_rsus=D("2152.0000"),
                unvested_price=D("129.5651"),
                refresh_rsus=D("502.0965"),
                grant_price=D("129.5651"),
            ),
            {
                "base_delta": D("11000.00"),
                "base_delta_pct": D("0.072848"),
                "unvested_equity": D("278824.10"),
                "equity_delta": D("65054.18"),
                "equity_delta_pct": D("0.233316"),
                "tc_before": D("429824.10"),
                "tc_after": D("505878.28"),
            },
        ),
        (
            event(),  # 2026
            {
                "base_delta": D("26930.00"),
                "base_delta_pct": D("0.166235"),
                "unvested_equity": D("333882.96"),
                "equity_delta": D("79041.50"),
                # D4: the sheet's 2026 row drifted; delta/unvested_equity is canonical.
                "equity_delta_pct": D("0.236734"),
                "tc_before": D("495882.96"),
                "tc_after": D("601854.46"),
            },
        ),
        (
            # The open year: a current base and nothing else. Every delta is null and TC
            # collapses to the base on both sides.
            event(
                focal_year=2027,
                current_base=D("188930.00"),
                new_base=None,
                unvested_rsus=None,
                unvested_price=None,
                refresh_rsus=None,
                grant_price=None,
            ),
            {
                "base_delta": None,
                "base_delta_pct": None,
                "unvested_equity": None,
                "equity_delta": None,
                "equity_delta_pct": None,
                "tc_before": D("188930.00"),
                "tc_after": D("188930.00"),
            },
        ),
    ],
    ids=["2024", "2025", "2026", "2027"],
)
def test_comp_metrics_pinned_rows(row, expected):
    assert metrics(row) == expected


def test_comp_metrics_null_cascade_on_half_filled_pairs():
    # Each product needs BOTH of its operands; a half-filled pair is null, not zero.
    half_equity = metrics(event(unvested_price=None))
    assert half_equity["unvested_equity"] is None
    assert half_equity["equity_delta_pct"] is None  # its denominator went with it
    assert half_equity["tc_before"] == D("162000.00")  # the missing side reads as 0
    assert half_equity["tc_after"] == D("267971.50")  # new base + equity delta

    half_refresh = metrics(event(refresh_rsus=None))
    assert half_refresh["equity_delta"] is None
    assert half_refresh["equity_delta_pct"] is None
    assert half_refresh["tc_after"] == D("522812.96")


def test_comp_metrics_never_divides_by_a_stored_zero():
    # A GET must not 500 on stored data the writer would reject today.
    zero_base = metrics(event(current_base=D("0.00")))
    assert zero_base["base_delta"] == D("188930.00")
    assert zero_base["base_delta_pct"] is None

    zero_equity = metrics(event(unvested_rsus=D("0.0000")))
    assert zero_equity["unvested_equity"] == D("0.00")
    assert zero_equity["equity_delta"] == D("79041.50")
    assert zero_equity["equity_delta_pct"] is None


def test_comp_metrics_degrade_an_unrepresentable_ratio_to_null():
    # Every column below is individually storable (the writer bounds each family on its
    # own), but the ratio is ~1e26 — more digits than `quantize` can hold, i.e. an
    # InvalidOperation 500 on a plain GET without the guard.
    absurd = metrics(
        event(
            unvested_rsus=D("0.0001"),
            unvested_price=D("0.0001"),
            refresh_rsus=D("99999999.0000"),
            grant_price=D("9999999999.0000"),
        )
    )
    assert absurd["equity_delta"] == D("999999989900000001.00")
    assert absurd["equity_delta_pct"] is None
    assert absurd["tc_after"] == D("999999989900188931.00")


def test_comp_metrics_collapse_a_negative_zero_product():
    # unvested_rsus is a signed Numeric(12,4) and the price a Numeric(14,4), so a
    # hand-written -0.0001 x 0.0001 is perfectly storable — and its -1E-8 product quantizes
    # to Decimal("-0.00") without half_up2's `+ ZERO`. Only `is_signed()` can see that:
    # Decimal("-0.00") == Decimal("0.00") is True.
    tiny = metrics(event(unvested_rsus=D("-0.0001"), unvested_price=D("0.0001")))
    assert tiny["unvested_equity"] == D("0.00")
    assert not tiny["unvested_equity"].is_signed()

    # The TC lines carry that same product, so they need the same collapse — visible only
    # when there is no base to swamp it.
    flat = metrics(
        event(
            current_base=D("0.00"),
            new_base=None,
            refresh_rsus=None,
            grant_price=None,
            unvested_rsus=D("-0.0001"),
            unvested_price=D("0.0001"),
        )
    )
    assert flat["tc_before"] == flat["tc_after"] == D("0.00")
    assert not flat["tc_before"].is_signed()
    assert not flat["tc_after"].is_signed()


def test_comp_metrics_pin_both_sides_of_the_ratio_fence():
    # The fence measures the FULL-PRECISION denominator, not the displayed one: unvested
    # equity renders as "0.00" here while the ratio still divides by the real 1E-8, so the
    # zero-guard never fires and PCT_MAX_ABS is the only thing standing between this GET
    # and an InvalidOperation. The comparison is `>=`, so exactly 1e12 is OUT.
    at_fence = metrics(
        event(
            unvested_rsus=D("0.0001"),
            unvested_price=D("0.0001"),  # denominator 1E-8
            refresh_rsus=D("100.0000"),
            grant_price=D("100.0000"),  # numerator 10000 -> ratio exactly 1e12
        )
    )
    assert at_fence["unvested_equity"] == D("0.00")  # ... and yet not a zero denominator
    assert at_fence["equity_delta_pct"] is None

    # One step under, at the columns' own 4dp scale: 9999.99999999 / 1E-8 = 999999999999,
    # the largest ratio these column scales can put beneath the fence.
    under_fence = metrics(
        event(
            unvested_rsus=D("0.0001"),
            unvested_price=D("0.0001"),
            refresh_rsus=D("99999999.9999"),
            grant_price=D("0.0001"),
        )
    )
    assert str(under_fence["equity_delta_pct"]) == "999999999999.000000"


def test_comp_metrics_land_on_the_wire_scales():
    # Decimal equality ignores scale (6000.00 == 6000.0000), so the pinned table above
    # cannot catch an unquantized output — these string pins can.
    computed = metrics(event())
    assert str(computed["unvested_equity"]) == "333882.96"  # 1822 x 183.2508 = ...9576
    assert str(computed["equity_delta"]) == "79041.50"
    assert str(computed["equity_delta_pct"]) == "0.236734"
    assert str(computed["tc_after"]) == "601854.46"
    # A one-cent pay CUT is a reachable column-scale input whose pct rounds to a signed
    # zero: -0.01 / 162000 = -6.2e-8, i.e. Decimal("-0.000000") without the `+ ZERO`.
    shrunk = metrics(event(new_base=D("161999.99")))
    assert str(shrunk["base_delta"]) == "-0.01"
    assert str(shrunk["base_delta_pct"]) == "0.000000"


# --- paycheck API ---


def profile_payload(**overrides) -> dict:
    body = {
        "effective_date": "2026-01-01",
        "annual_salary": "188930",
        "pay_periods_per_year": 24,
        "trad_401k_pct": "0.13",
        "roth_401k_pct": "0",
        "after_tax_401k_pct": "0.03",
        "espp_pct": "0.11",
        "withholding_pct": "0.334009167",
        "dental_vision_per_check": "12.50",
        "hsa_per_check": "100",
    }
    body.update(overrides)
    return body


async def create_profile(auth_client, **overrides) -> dict:
    resp = await auth_client.post(PROFILES, json=profile_payload(**overrides))
    assert resp.status_code == 201, resp.text  # fail here, not on a later KeyError
    return resp.json()


@pytest.fixture
async def me(db):
    """The primary person a profile belongs to. `create_all` seeds no roster, so every
    test that WRITES a profile asks for this explicitly — and the two that must see an
    empty database (the 404 and the auth wall) deliberately do not."""
    person = Person(name="Me", is_primary=True)
    db.add(person)
    await db.commit()
    return person


async def test_profiles_crud_roundtrip(auth_client, db, me):
    assert (await auth_client.get(PROFILES)).json() == []

    older = await create_profile(auth_client, effective_date="2025-01-01")
    newer = await create_profile(auth_client)  # 2026-01-01, inserted second

    body = (await auth_client.get(PROFILES)).json()
    assert [row["effective_date"] for row in body] == ["2026-01-01", "2025-01-01"]  # DESC
    assert body[0]["annual_salary"] == "188930.00"  # Numeric(12,2)
    assert body[0]["pay_periods_per_year"] == 24
    assert body[0]["trad_401k_pct"] == "0.130000000"  # Numeric(10,9)
    assert body[0]["withholding_pct"] == "0.334009167"
    assert body[0]["dental_vision_per_check"] == "12.50"  # Numeric(8,2)
    assert body[0]["hsa_per_check"] == "100.00"
    assert body[0]["notes"] is None

    patched = await auth_client.patch(
        f"{PROFILES}/{newer['id']}",
        json={"annual_salary": "200000", "espp_pct": "0.15", "notes": "post-refresh"},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["annual_salary"] == "200000.00"
    assert patched.json()["espp_pct"] == "0.150000000"
    assert patched.json()["notes"] == "post-refresh"
    assert patched.json()["trad_401k_pct"] == "0.130000000"  # untouched

    assert (await auth_client.delete(f"{PROFILES}/{older['id']}")).status_code == 204
    assert await db.get(PaycheckProfile, older["id"]) is None
    assert len((await auth_client.get(PROFILES)).json()) == 1


async def test_create_profile_defaults_every_optional_pct_to_zero(auth_client, me):
    resp = await auth_client.post(
        PROFILES, json={"effective_date": "2026-01-01", "annual_salary": "120000"}
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["pay_periods_per_year"] == 24
    assert body["trad_401k_pct"] == "0.000000000"
    assert body["withholding_pct"] == "0.000000000"
    assert body["hsa_per_check"] == "0.00"


async def test_a_zero_pct_crosses_the_wire_in_plain_notation(auth_client, me):
    # Numeric(10,9) zero is Decimal("0E-9") and pydantic renders Decimals with str():
    # without the schema's plain-format serializer this reaches the frontend as "0E-9".
    created = await create_profile(auth_client)
    assert created["roth_401k_pct"] == "0.000000000"
    assert (await auth_client.get(PROFILES)).json()[0]["roth_401k_pct"] == "0.000000000"

    patched = await auth_client.patch(f"{PROFILES}/{created['id']}", json={"espp_pct": "0.0"})
    assert patched.status_code == 200, patched.text
    assert patched.json()["espp_pct"] == "0.000000000"
    breakdown_body = (await auth_client.get(BREAKDOWN)).json()
    assert breakdown_body["profile"]["espp_pct"] == "0.000000000"


async def test_create_profile_rejects_a_duplicate_effective_date(auth_client, me):
    await create_profile(auth_client)
    clash = await auth_client.post(PROFILES, json=profile_payload(annual_salary="1"))
    assert clash.status_code == 409
    assert "2026-01-01" in clash.json()["detail"]


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"annual_salary": "0"}, "annual_salary must be positive"),
        ({"annual_salary": "-1"}, "annual_salary must be positive"),
        ({"annual_salary": "0.004"}, "annual_salary must be positive"),  # 0.00 at 2dp
        # THE divide-by-zero guard (Plan 1 forward note): gross = salary / periods.
        ({"pay_periods_per_year": 0}, "pay_periods_per_year must be between 1 and 366"),
        ({"pay_periods_per_year": -12}, "pay_periods_per_year must be between 1 and 366"),
        ({"pay_periods_per_year": 367}, "pay_periods_per_year must be between 1 and 366"),
        ({"trad_401k_pct": "1.000000001"}, "trad_401k_pct must be between 0 and 1"),
        ({"roth_401k_pct": "-0.01"}, "roth_401k_pct must be between 0 and 1"),
        # -0.000000000 after the 9dp quantize — the raw value still says negative.
        ({"after_tax_401k_pct": "-0.0000000001"}, "after_tax_401k_pct must be between 0 and 1"),
        ({"espp_pct": "11"}, "espp_pct must be between 0 and 1"),  # 11%, mis-scaled
        ({"withholding_pct": "33.4"}, "withholding_pct must be between 0 and 1"),
        ({"dental_vision_per_check": "-1"}, "dental_vision_per_check must be >= 0"),
        ({"hsa_per_check": "-0.001"}, "hsa_per_check must be >= 0"),  # -0.00 after 2dp
        ({"effective_date": "1026-01-01"}, "effective_date: date must be between"),
        ({"annual_salary": "10000000000"}, "annual_salary: |value| must be below 10^10"),
        # Numeric(8,2) keeps only 6 integer digits.
        ({"hsa_per_check": "1000000"}, "hsa_per_check: |value| must be below 10^6"),
    ],
)
async def test_create_profile_validation_rules(auth_client, me, overrides, message):
    resp = await auth_client.post(PROFILES, json=profile_payload(**overrides))
    assert resp.status_code == 422, resp.text
    assert message in resp.json()["detail"]


async def test_create_profile_writes_nothing_when_a_late_rule_fires(auth_client, db, me):
    resp = await auth_client.post(
        PROFILES, json=profile_payload(hsa_per_check="-1", notes="never stored")
    )
    assert resp.status_code == 422
    assert (await db.execute(select(PaycheckProfile))).scalars().all() == []


async def test_patch_profile_validates_the_merged_row(auth_client, me):
    created = await create_profile(auth_client)
    resp = await auth_client.patch(f"{PROFILES}/{created['id']}", json={"pay_periods_per_year": 0})
    assert resp.status_code == 422
    assert "pay_periods_per_year must be between 1 and 366" in resp.json()["detail"]

    other = await create_profile(auth_client, effective_date="2025-01-01")
    clash = await auth_client.patch(
        f"{PROFILES}/{other['id']}", json={"effective_date": "2026-01-01"}
    )
    assert clash.status_code == 409
    kept = await auth_client.patch(
        f"{PROFILES}/{other['id']}", json={"effective_date": "2025-01-01"}
    )
    assert kept.status_code == 200, kept.text  # its own date is not a conflict with itself


async def test_patch_profile_explicit_null_is_a_no_op_on_a_not_null_column(auth_client, me):
    # House PATCH convention (portfolio.py's update_security): a null on a column that
    # cannot hold one reads as "no change" rather than a 422. `notes` IS nullable, so a
    # null there really clears it.
    created = await create_profile(auth_client, notes="original")
    resp = await auth_client.patch(
        f"{PROFILES}/{created['id']}",
        json={"annual_salary": None, "pay_periods_per_year": None, "trad_401k_pct": None},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["annual_salary"] == "188930.00"
    assert resp.json()["pay_periods_per_year"] == 24
    assert resp.json()["trad_401k_pct"] == "0.130000000"

    cleared = await auth_client.patch(f"{PROFILES}/{created['id']}", json={"notes": None})
    assert cleared.json()["notes"] is None


async def test_patch_profile_404_and_delete_404(auth_client):
    assert (await auth_client.patch(f"{PROFILES}/999", json={})).status_code == 404
    assert (await auth_client.delete(f"{PROFILES}/999")).status_code == 404
    # The PK is an int4: an out-of-range id must be a 422 at the boundary, never the bare
    # asyncpg DataError 500 it would otherwise reach the driver as.
    assert (await auth_client.delete(f"{PROFILES}/99999999999")).status_code == 422
    huge = await auth_client.get(BREAKDOWN, params={"profile_id": 99999999999})
    assert huge.status_code == 422


async def test_breakdown_golden_over_the_real_profile(auth_client, me):
    created = await create_profile(auth_client)
    body = (await auth_client.get(BREAKDOWN)).json()
    assert body["profile"]["id"] == created["id"]
    assert body["gross"] == "7872.08"
    assert body["trad_401k"] == "1023.37"
    assert body["dental_vision"] == "12.50"
    assert body["hsa"] == "100.00"
    assert body["taxable"] == "6736.21"
    assert body["withholding"] == "2249.96"
    assert body["post_tax"] == "4486.26"
    assert body["roth_401k"] == "0.00"
    assert body["after_tax_401k"] == "236.16"
    assert body["espp"] == "865.93"
    assert body["net_pay"] == "3384.16"
    assert body["monthly_net"] == "6768.33"
    assert body["warnings"] == []


async def test_breakdown_defaults_to_the_latest_profile_effective_today_or_earlier(auth_client, me):
    # Dates relative to the run, never frozen: "today" is read at the ENDPOINT.
    today = date.today()
    await create_profile(auth_client, effective_date=str(today - timedelta(days=400)))
    current = await create_profile(auth_client, effective_date=str(today), annual_salary="200000")
    await create_profile(
        auth_client, effective_date=str(today + timedelta(days=30)), annual_salary="250000"
    )

    body = (await auth_client.get(BREAKDOWN)).json()
    assert body["profile"]["id"] == current["id"]  # today counts as effective
    assert body["profile"]["annual_salary"] == "200000.00"


async def test_breakdown_falls_back_to_the_earliest_future_profile(auth_client, me):
    today = date.today()
    soon = await create_profile(
        auth_client, effective_date=str(today + timedelta(days=10)), annual_salary="120000"
    )
    await create_profile(auth_client, effective_date=str(today + timedelta(days=400)))

    body = (await auth_client.get(BREAKDOWN)).json()
    assert body["profile"]["id"] == soon["id"]
    assert body["profile"]["annual_salary"] == "120000.00"


async def test_breakdown_accepts_an_explicit_profile_id(auth_client, me):
    old = await create_profile(auth_client, effective_date="2020-01-01", annual_salary="90000")
    await create_profile(auth_client)

    body = (await auth_client.get(BREAKDOWN, params={"profile_id": old["id"]})).json()
    assert body["profile"]["id"] == old["id"]
    assert body["gross"] == "3750.00"

    missing = await auth_client.get(BREAKDOWN, params={"profile_id": old["id"] + 999})
    assert missing.status_code == 404
    assert missing.json()["detail"] == "paycheck profile not found"


async def test_breakdown_takes_a_person_and_defaults_to_the_primary(auth_client, db, me):
    partner = Person(name="Partner")
    db.add(partner)
    await db.commit()
    today = date.today()
    await create_profile(auth_client, effective_date=str(today - timedelta(days=30)))
    await create_profile(
        auth_client,
        person_id=partner.id,
        effective_date=str(today - timedelta(days=30)),
        annual_salary="96000",
    )

    mine = (await auth_client.get(BREAKDOWN)).json()
    assert mine["profile"]["person_id"] == me.id
    assert mine["profile"]["annual_salary"] == "188930.00"

    theirs = (await auth_client.get(BREAKDOWN, params={"person_id": partner.id})).json()
    assert theirs["profile"]["person_id"] == partner.id
    assert theirs["gross"] == "4000.00"  # 96000 / 24

    # Absent = primary, byte for byte.
    assert (await auth_client.get(BREAKDOWN, params={"person_id": me.id})).json() == mine


async def test_breakdown_404s_an_unknown_person_and_an_empty_timeline(auth_client, db, me):
    partner = Person(name="Partner")
    db.add(partner)
    await db.commit()
    await create_profile(auth_client)

    unknown = await auth_client.get(BREAKDOWN, params={"person_id": 999})
    assert unknown.status_code == 404
    assert unknown.json()["detail"] == "person not found"

    # A real person with an empty timeline never borrows somebody else's profile.
    empty = await auth_client.get(BREAKDOWN, params={"person_id": partner.id})
    assert empty.status_code == 404
    assert empty.json()["detail"] == "no paycheck profiles"

    huge = await auth_client.get(BREAKDOWN, params={"person_id": 99999999999})
    assert huge.status_code == 422


async def test_breakdown_profile_id_wins_over_person_id(auth_client, db, me):
    # An explicit ROW is explicit: person_id only names whose profile in force to pick,
    # and there is nothing to pick once the row itself is named.
    partner = Person(name="Partner")
    db.add(partner)
    await db.commit()
    mine = await create_profile(auth_client)
    body = (
        await auth_client.get(
            BREAKDOWN, params={"profile_id": mine["id"], "person_id": partner.id}
        )
    ).json()
    assert body["profile"]["id"] == mine["id"]
    assert body["profile"]["person_id"] == me.id


async def test_breakdown_404_when_nothing_is_stored(auth_client):
    resp = await auth_client.get(BREAKDOWN)
    assert resp.status_code == 404
    assert resp.json()["detail"] == "no paycheck profiles"


async def test_breakdown_warns_on_over_100pct_contributions_and_a_negative_net(auth_client, me):
    await create_profile(
        auth_client,
        annual_salary="60000",
        trad_401k_pct="0.5",
        roth_401k_pct="0.3",
        after_tax_401k_pct="0.2",
        espp_pct="0.2",
    )
    body = (await auth_client.get(BREAKDOWN)).json()
    assert body["net_pay"] == "-992.44"
    assert body["monthly_net"] == "-1984.87"
    assert body["warnings"] == ["contribution percentages exceed 100%", "net pay is negative"]


async def test_breakdown_warns_on_a_negative_net_alone(auth_client, me):
    # The contributions sum to EXACTLY 1, so only the second warning may fire: 90% into
    # the traditional 401(k) leaves too little post-tax pay for the 10% ESPP line.
    await create_profile(
        auth_client,
        annual_salary="60000",
        trad_401k_pct="0.9",
        roth_401k_pct="0",
        after_tax_401k_pct="0",
        espp_pct="0.1",
        withholding_pct="0.5",
        dental_vision_per_check="0",
        hsa_per_check="0",
    )
    body = (await auth_client.get(BREAKDOWN)).json()
    assert body["net_pay"] == "-125.00"
    assert body["warnings"] == ["net pay is negative"]


async def test_breakdown_is_silent_at_exactly_100pct_and_a_zero_net(auth_client, me):
    created = await create_profile(
        auth_client,
        annual_salary="60000",
        trad_401k_pct="0.5",
        roth_401k_pct="0.3",
        after_tax_401k_pct="0.2",
        espp_pct="0",
        withholding_pct="0",
        dental_vision_per_check="0",
        hsa_per_check="0",
    )
    body = (await auth_client.get(BREAKDOWN, params={"profile_id": created["id"]})).json()
    assert body["net_pay"] == "0.00"
    # Exactly 100% is not "exceeds", and a 0.00 net is not negative.
    assert body["warnings"] == []


async def test_breakdown_judges_the_negative_net_warning_on_the_displayed_net(auth_client, me):
    # The canary for THE warning rule: 1.00 gross, half of it withheld, and a roth pct one
    # ulp over the other half. The full-precision net is -1E-9 — genuinely negative — while
    # the line the warning would sit next to reads "0.00". Judging the rule on the
    # full-precision net instead prints "net pay is negative" beside a zero.
    created = await create_profile(
        auth_client,
        annual_salary="24",
        trad_401k_pct="0",
        roth_401k_pct="0.500000001",
        after_tax_401k_pct="0",
        espp_pct="0",
        withholding_pct="0.5",
        dental_vision_per_check="0",
        hsa_per_check="0",
    )
    body = (await auth_client.get(BREAKDOWN, params={"profile_id": created["id"]})).json()
    assert body["net_pay"] == "0.00"
    assert body["monthly_net"] == "0.00"
    assert body["warnings"] == []


async def test_breakdown_degrades_on_a_stored_zero_pay_period_count(auth_client, db, me):
    # Written STRAIGHT to the table: the API's bounds never saw this row, and
    # `gross = annual_salary / periods` would make a plain GET a DivisionByZero 500.
    stored = profile(pay_periods_per_year=0, person_id=me.id)
    db.add(stored)
    await db.commit()

    resp = await auth_client.get(BREAKDOWN, params={"profile_id": stored.id})
    assert resp.status_code == 422
    assert resp.json()["detail"] == "pay_periods_per_year must be between 1 and 366"
    # The default-profile branch resolves to the same row, and refuses the same way.
    assert (await auth_client.get(BREAKDOWN)).status_code == 422
    # ... but the row is still listable: only the line that cannot be computed refuses.
    listed = await auth_client.get(PROFILES)
    assert listed.status_code == 200
    assert listed.json()[0]["pay_periods_per_year"] == 0


async def test_paycheck_endpoints_require_auth(client):
    assert (await client.get(PROFILES)).status_code == 401
    assert (await client.post(PROFILES, json=profile_payload())).status_code == 401
    assert (await client.patch(f"{PROFILES}/1", json={"annual_salary": "1"})).status_code == 401
    assert (await client.delete(f"{PROFILES}/1")).status_code == 401
    assert (await client.get(BREAKDOWN)).status_code == 401


async def test_create_profile_defaults_to_the_primary_person(auth_client, me):
    # Absent person_id = the primary. Every pre-P3 caller passes nothing and means the
    # one earner the app modeled, so the wire keeps working untouched.
    created = await create_profile(auth_client)
    assert created["person_id"] == me.id
    assert (await auth_client.get(PROFILES)).json()[0]["person_id"] == me.id


async def test_create_profile_accepts_an_explicit_person_and_scopes_the_409(auth_client, db, me):
    partner = Person(name="Partner")
    db.add(partner)
    await db.commit()

    mine = await create_profile(auth_client)
    theirs = await create_profile(auth_client, person_id=partner.id, annual_salary="96000")
    assert theirs["person_id"] == partner.id
    # The SAME date on two timelines is not a conflict — that is the whole point of the key.
    assert theirs["effective_date"] == mine["effective_date"] == "2026-01-01"
    assert theirs["annual_salary"] == "96000.00"

    clash = await auth_client.post(PROFILES, json=profile_payload(person_id=partner.id))
    assert clash.status_code == 409
    assert "2026-01-01" in clash.json()["detail"]


async def test_create_profile_404s_an_unknown_person_and_422s_without_a_roster(auth_client, db):
    missing = await auth_client.post(PROFILES, json=profile_payload(person_id=999))
    assert missing.status_code == 404
    assert missing.json()["detail"] == "person not found"
    # No roster at all: there is no primary to default to, and person_id is NOT NULL.
    empty = await auth_client.post(PROFILES, json=profile_payload())
    assert empty.status_code == 422
    assert empty.json()["detail"] == "household has no primary person"
    assert (await db.execute(select(PaycheckProfile))).scalars().all() == []
    # int4 fence at the boundary: an out-of-range id must never reach asyncpg as a 500.
    huge = await auth_client.post(PROFILES, json=profile_payload(person_id=99999999999))
    assert huge.status_code == 422


async def test_patch_profile_never_changes_the_owner(auth_client, db, me):
    # `person_id` is deliberately absent from ProfileUpdate: a profile does not change
    # hands, and pydantic drops the unknown key rather than 422ing on it.
    partner = Person(name="Partner")
    db.add(partner)
    await db.commit()
    created = await create_profile(auth_client)
    patched = await auth_client.patch(
        f"{PROFILES}/{created['id']}",
        json={"person_id": partner.id, "annual_salary": "200000"},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["person_id"] == me.id
    assert patched.json()["annual_salary"] == "200000.00"


# --- comp API ---


def event_payload(**overrides) -> dict:
    body = {
        "focal_year": 2026,
        "current_base": "162000",
        "new_base": "188930",
        "unvested_rsus": "1822",
        "unvested_price": "183.2508",
        "refresh_rsus": "610.0524",
        "grant_price": "129.5651",
    }
    body.update(overrides)
    return body


async def create_event(auth_client, **overrides) -> dict:
    resp = await auth_client.post(EVENTS, json=event_payload(**overrides))
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_comp_events_carry_stored_and_computed_columns(auth_client):
    await create_event(auth_client)  # 2026, inserted first
    await create_event(
        auth_client,
        focal_year=2025,
        current_base="151000",
        new_base="162000",
        unvested_rsus="2152",
        unvested_price="129.5651",
        refresh_rsus="502.0965",
        grant_price="129.5651",
    )

    body = (await auth_client.get(EVENTS)).json()
    assert [row["focal_year"] for row in body] == [2025, 2026]  # ascending

    row = body[1]
    assert row["current_base"] == "162000.00"  # Numeric(12,2)
    assert row["new_base"] == "188930.00"
    assert row["unvested_rsus"] == "1822.0000"  # Numeric(12,4)
    assert row["unvested_price"] == "183.2508"  # Numeric(14,4)
    assert row["refresh_rsus"] == "610.0524"
    assert row["grant_price"] == "129.5651"
    assert row["notes"] is None
    assert row["base_delta"] == "26930.00"
    assert row["base_delta_pct"] == "0.166235"
    assert row["unvested_equity"] == "333882.96"
    assert row["equity_delta"] == "79041.50"
    assert row["equity_delta_pct"] == "0.236734"
    assert row["tc_before"] == "495882.96"
    assert row["tc_after"] == "601854.46"


async def test_comp_event_with_only_a_current_base_computes_nulls(auth_client):
    body = event_payload(focal_year=2027, current_base="188930")
    for key in ("new_base", "unvested_rsus", "unvested_price", "refresh_rsus", "grant_price"):
        del body[key]
    resp = await auth_client.post(EVENTS, json=body)
    assert resp.status_code == 201, resp.text
    created = resp.json()
    assert created["new_base"] is None
    assert created["base_delta"] is None
    assert created["base_delta_pct"] is None
    assert created["unvested_equity"] is None
    assert created["equity_delta"] is None
    assert created["equity_delta_pct"] is None
    assert created["tc_before"] == "188930.00"
    assert created["tc_after"] == "188930.00"


async def test_comp_events_crud_roundtrip(auth_client, db):
    assert (await auth_client.get(EVENTS)).json() == []
    created = await create_event(auth_client)

    patched = await auth_client.patch(
        f"{EVENTS}/{created['id']}", json={"new_base": "200000", "notes": "promo"}
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["new_base"] == "200000.00"
    assert patched.json()["base_delta"] == "38000.00"  # recomputed, not stored
    assert patched.json()["notes"] == "promo"

    assert (await auth_client.delete(f"{EVENTS}/{created['id']}")).status_code == 204
    assert await db.get(CompEvent, created["id"]) is None
    assert (await auth_client.get(EVENTS)).json() == []


async def test_patch_comp_event_clears_a_nullable_column_with_an_explicit_null(auth_client):
    # The real semantic difference from the espp lots table: these columns ARE nullable,
    # so an explicit null means "clear it", not "no change".
    created = await create_event(auth_client)
    cleared = await auth_client.patch(
        f"{EVENTS}/{created['id']}", json={"new_base": None, "refresh_rsus": None}
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["new_base"] is None
    assert cleared.json()["base_delta"] is None
    assert cleared.json()["refresh_rsus"] is None
    assert cleared.json()["equity_delta"] is None
    assert cleared.json()["equity_delta_pct"] is None
    assert cleared.json()["tc_after"] == "495882.96"  # falls back to the current base

    # ... while the NOT NULL columns keep the house no-op reading.
    kept = await auth_client.patch(
        f"{EVENTS}/{created['id']}", json={"current_base": None, "focal_year": None}
    )
    assert kept.status_code == 200, kept.text
    assert kept.json()["current_base"] == "162000.00"
    assert kept.json()["focal_year"] == 2026


async def test_create_comp_event_rejects_a_duplicate_focal_year(auth_client):
    await create_event(auth_client)
    clash = await auth_client.post(EVENTS, json=event_payload(current_base="1"))
    assert clash.status_code == 409
    assert "2026" in clash.json()["detail"]


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"focal_year": 1989}, "focal_year must be between 1990 and 2100"),
        ({"focal_year": 2101}, "focal_year must be between 1990 and 2100"),
        ({"current_base": "0"}, "current_base must be positive"),
        ({"current_base": "-1"}, "current_base must be positive"),
        ({"new_base": "0"}, "new_base must be positive"),
        ({"new_base": "-5"}, "new_base must be positive"),
        ({"unvested_rsus": "-1"}, "unvested_rsus must be >= 0"),
        ({"refresh_rsus": "-0.00001"}, "refresh_rsus must be >= 0"),  # -0.0000 at 4dp
        ({"unvested_price": "-1"}, "unvested_price must be >= 0"),
        ({"grant_price": "-0.00001"}, "grant_price must be >= 0"),
        ({"current_base": "10000000000"}, "current_base: |value| must be below 10^10"),
        # Numeric(12,4) keeps 8 integer digits; Numeric(14,4) keeps 10.
        ({"unvested_rsus": "100000000"}, "unvested_rsus: |value| must be below 10^8"),
        ({"grant_price": "10000000000"}, "grant_price: |value| must be below 10^10"),
    ],
)
async def test_create_comp_event_validation_rules(auth_client, overrides, message):
    resp = await auth_client.post(EVENTS, json=event_payload(**overrides))
    assert resp.status_code == 422, resp.text
    assert message in resp.json()["detail"]


async def test_patch_comp_event_validates_the_merged_row(auth_client):
    created = await create_event(auth_client)
    resp = await auth_client.patch(f"{EVENTS}/{created['id']}", json={"new_base": "-1"})
    assert resp.status_code == 422
    assert "new_base must be positive" in resp.json()["detail"]

    other = await create_event(auth_client, focal_year=2025, current_base="151000")
    clash = await auth_client.patch(f"{EVENTS}/{other['id']}", json={"focal_year": 2026})
    assert clash.status_code == 409
    kept = await auth_client.patch(f"{EVENTS}/{other['id']}", json={"focal_year": 2025})
    assert kept.status_code == 200, kept.text  # its own year is not a conflict


async def test_patch_comp_event_404_and_delete_404(auth_client):
    assert (await auth_client.patch(f"{EVENTS}/999", json={})).status_code == 404
    assert (await auth_client.delete(f"{EVENTS}/999")).status_code == 404
    # Same int4 fence as the paycheck router's ids.
    assert (await auth_client.delete(f"{EVENTS}/99999999999")).status_code == 422


async def test_comp_endpoints_require_auth(client):
    assert (await client.get(EVENTS)).status_code == 401
    assert (await client.post(EVENTS, json=event_payload())).status_code == 401
    assert (await client.patch(f"{EVENTS}/1", json={"current_base": "1"})).status_code == 401
    assert (await client.delete(f"{EVENTS}/1")).status_code == 401
