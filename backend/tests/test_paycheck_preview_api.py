"""POST /paycheck/preview — the Paycheck "Try it" sandbox's one request (2026-09-03
planning-sandboxes spec §13). Pure: SELECTs only, proven by test_sandbox_purity.py. The
pins here are PARITY pins: the baseline half of every answer equals GET /breakdown field for
field, and the scenario half equals GET /breakdown of a REAL profile carrying those values —
one compute, two doors, never a second arithmetic."""

from datetime import date
from decimal import Decimal

import pytest

from app.api.paycheck import (
    CONTRIBUTIONS_WARNING,
    HSA_COVERAGE_MESSAGE,
    NEGATIVE_NET_WARNING,
    PAY_PERIODS_MESSAGE,
)
from app.models import ContributionLimit, Person

PROFILES = "/api/v1/paycheck/profiles"
BREAKDOWN = "/api/v1/paycheck/breakdown"
PREVIEW = "/api/v1/paycheck/preview"
D = Decimal

WATERFALL = (
    "gross",
    "trad_401k",
    "dental_vision",
    "hsa",
    "taxable",
    "withholding",
    "post_tax",
    "roth_401k",
    "after_tax_401k",
    "espp",
    "net_pay",
)


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
    assert resp.status_code == 201, resp.text
    return resp.json()


async def preview(auth_client, **body) -> dict:
    resp = await auth_client.post(PREVIEW, json=body)
    assert resp.status_code == 200, resp.text
    return resp.json()


@pytest.fixture
async def me(db):
    person = Person(name="Me", is_primary=True)
    db.add(person)
    await db.commit()
    return person


async def test_preview_requires_auth(client):
    assert (await client.post(PREVIEW, json={})).status_code == 401


async def test_preview_404s_with_no_profiles_in_the_legacy_words(auth_client, me):
    resp = await auth_client.post(PREVIEW, json={})
    assert resp.status_code == 404
    assert resp.json()["detail"] == "no paycheck profiles"


async def test_preview_with_empty_overrides_echoes_the_breakdown(auth_client, me):
    """The legal no-op: baseline == scenario, every delta 0.00, and the baseline IS the
    GET's answer field for field — one quantization discipline, not two."""
    await create_profile(auth_client)
    shown = (await auth_client.get(BREAKDOWN)).json()

    body = await preview(auth_client)
    assert body["profile"] == shown["profile"]
    assert body["per_check"]["scenario"] == body["per_check"]["baseline"]
    for key in WATERFALL:
        assert body["per_check"]["baseline"][key] == shown[key]
    assert body["per_check"]["delta"] == {key: "0.00" for key in (*WATERFALL, "savings")}
    assert body["monthly"]["baseline"]["net_pay"] == shown["monthly_net"]
    assert body["monthly"]["delta"]["net_pay"] == "0.00"
    assert body["annual"]["delta"]["gross"] == "0.00"
    assert body["pace"]["baseline"] == shown["pace"]
    assert body["pace"]["scenario"] == shown["pace"]
    assert body["changed"] == []
    assert body["warnings"] == []


async def test_preview_selects_the_base_exactly_as_the_breakdown_does(auth_client, db, me):
    """Explicit row wins; absent = the primary's profile in force; a pinned id under a
    partner's person_id still means the row (GET /breakdown's three rules, one resolver)."""
    partner = Person(name="Partner", is_primary=False)
    db.add(partner)
    await db.commit()
    mine = await create_profile(auth_client, annual_salary="100000")
    theirs = await create_profile(auth_client, person_id=partner.id, annual_salary="80000")

    assert (await preview(auth_client))["profile"]["id"] == mine["id"]
    assert (await preview(auth_client, person_id=partner.id))["profile"]["id"] == theirs["id"]
    assert (await preview(auth_client, profile_id=theirs["id"], person_id=me.id))["profile"][
        "id"
    ] == theirs["id"]
    resp = await auth_client.post(PREVIEW, json={"profile_id": 999999})
    assert resp.status_code == 404
    assert resp.json()["detail"] == "paycheck profile not found"
    resp = await auth_client.post(PREVIEW, json={"person_id": 999999})
    assert resp.status_code == 404
    assert resp.json()["detail"] == "person not found"


async def test_preview_scenario_equals_a_real_profile_with_those_values(auth_client, me):
    """Parity with the real compute: the scenario half equals GET /breakdown of a profile
    CREATED with the overridden values, then deleted — one arithmetic, two doors."""
    await create_profile(auth_client)
    overrides = {"trad_401k_pct": "0.15", "hsa_per_check": "250", "hsa_coverage": "family"}
    body = await preview(auth_client, overrides=overrides)

    twin = await create_profile(auth_client, effective_date="2019-01-01", **overrides)
    shown = (await auth_client.get(f"{BREAKDOWN}?profile_id={twin['id']}")).json()
    for key in WATERFALL:
        assert body["per_check"]["scenario"][key] == shown[key]
    assert body["monthly"]["scenario"]["net_pay"] == shown["monthly_net"]
    assert body["pace"]["scenario"] == shown["pace"]
    assert (await auth_client.delete(f"{PROFILES}/{twin['id']}")).status_code == 204
    # The preview modelled nothing into the database: the same request answers the same.
    assert (await preview(auth_client, overrides=overrides)) == body


@pytest.mark.parametrize(
    "overrides",
    [
        {"annual_salary": "0"},
        {"annual_salary": "-5"},
        {"hsa_per_check": "-1"},
        {"dental_vision_per_check": "-0.001"},
        {"trad_401k_pct": "13"},
        {"espp_pct": "-0.01"},
        {"pay_periods_per_year": 0},
        {"pay_periods_per_year": 367},
        {"hsa_coverage": "spouse"},
    ],
)
async def test_preview_422_texts_equal_the_writers(auth_client, me, overrides):
    """Every refusal reads exactly as the POST /profiles refusal for the same value — the
    writers' helpers, called by name, not a second phrasing."""
    await create_profile(auth_client)
    written = await auth_client.post(
        PROFILES, json=profile_payload(effective_date="2019-01-01", **overrides)
    )
    assert written.status_code == 422, written.text
    previewed = await auth_client.post(PREVIEW, json={"overrides": overrides})
    assert previewed.status_code == 422, previewed.text
    assert previewed.json()["detail"] == written.json()["detail"]


async def test_preview_pinned_422_sentences(auth_client, me):
    await create_profile(auth_client)
    cases = {
        ("annual_salary", "0"): "annual_salary must be positive",
        ("hsa_per_check", "-1"): "hsa_per_check must be >= 0",
        ("trad_401k_pct", "13"): "trad_401k_pct must be between 0 and 1",
        ("pay_periods_per_year", 0): PAY_PERIODS_MESSAGE,
        ("hsa_coverage", "spouse"): HSA_COVERAGE_MESSAGE,
    }
    for (key, value), sentence in cases.items():
        resp = await auth_client.post(PREVIEW, json={"overrides": {key: value}})
        assert resp.status_code == 422, resp.text
        assert resp.json()["detail"] == sentence


async def test_preview_refuses_an_unknown_knob(auth_client, me):
    """extra='forbid': a mistyped knob must not silently model the base profile."""
    await create_profile(auth_client)
    resp = await auth_client.post(PREVIEW, json={"overrides": {"bonus_pct": "0.1"}})
    assert resp.status_code == 422
    assert "bonus_pct" in resp.text


async def test_preview_changed_lists_only_the_keys_that_moved(auth_client, me):
    await create_profile(auth_client)
    body = await preview(
        auth_client,
        # trad restated at its stored value moves nothing; the other two do.
        overrides={
            "trad_401k_pct": "0.130000000",
            "hsa_per_check": "250",
            "hsa_coverage": "family",
        },
    )
    assert body["changed"] == [
        {"key": "hsa_per_check", "label": "HSA", "before": "100.00", "after": "250.00"},
        {"key": "hsa_coverage", "label": "HSA coverage", "before": "self", "after": "family"},
    ]


async def test_preview_scaling_and_savings_pinned_by_hand(auth_client, me):
    """120,000 over 24 periods, trad 10 %, ESPP 5 %, HSA $100, withholding 20 %:
    gross 5000 · trad 500 · hsa 100 · taxable 4400 · withholding 880 · post-tax 3520 ·
    espp 250 · net 3270 · savings 500 + 250 + 100 = 850. Monthly = ×2, annual = ×24."""
    await create_profile(
        auth_client,
        annual_salary="120000",
        trad_401k_pct="0.10",
        after_tax_401k_pct="0",
        espp_pct="0.05",
        withholding_pct="0.20",
        dental_vision_per_check="0",
        hsa_per_check="100",
    )
    body = await preview(auth_client, overrides={"espp_pct": "0"})
    base = body["per_check"]["baseline"]
    assert (base["gross"], base["taxable"], base["withholding"], base["net_pay"]) == (
        "5000.00",
        "4400.00",
        "880.00",
        "3270.00",
    )
    assert base["savings"] == "850.00"
    assert body["monthly"]["baseline"]["savings"] == "1700.00"
    assert body["annual"]["baseline"]["savings"] == "20400.00"
    assert body["annual"]["baseline"]["gross"] == "120000.00"
    # Stop ESPP: net rises by the 250 that no longer leaves the check; savings fall by it.
    assert body["per_check"]["delta"]["net_pay"] == "250.00"
    assert body["per_check"]["delta"]["savings"] == "-250.00"
    assert body["monthly"]["delta"]["savings"] == "-500.00"
    assert body["annual"]["delta"]["espp"] == "-6000.00"


async def test_preview_scales_each_side_by_its_own_cadence(auth_client, me):
    """A scenario that changes pay_periods_per_year: the annual gross is unchanged (the
    salary is annual), the per-check gross moves, and monthly still equals annual ÷ 12."""
    await create_profile(auth_client, annual_salary="120000")
    body = await preview(auth_client, overrides={"pay_periods_per_year": 12})
    assert body["per_check"]["baseline"]["gross"] == "5000.00"
    assert body["per_check"]["scenario"]["gross"] == "10000.00"
    assert body["annual"]["delta"]["gross"] == "0.00"
    assert body["monthly"]["scenario"]["gross"] == "10000.00"
    assert body["changed"] == [
        {
            "key": "pay_periods_per_year",
            "label": "Pay periods per year",
            "before": "24",
            "after": "12",
        }
    ]


async def test_preview_warnings_are_the_scenario_side(auth_client, me):
    await create_profile(auth_client)
    calm = await preview(auth_client)
    assert calm["warnings"] == []
    hot = await preview(auth_client, overrides={"after_tax_401k_pct": "0.9", "espp_pct": "0.15"})
    assert hot["warnings"] == [CONTRIBUTIONS_WARNING, NEGATIVE_NET_WARNING]
    assert Decimal(hot["per_check"]["scenario"]["net_pay"]) < 0


async def test_preview_pace_scenario_reflects_the_overrides(auth_client, db, me):
    db.add(
        ContributionLimit(year=date.today().year, key="limit_401k_elective", value=D("24500.00"))
    )
    await db.commit()
    await create_profile(
        auth_client, annual_salary="100000", trad_401k_pct="0.10", after_tax_401k_pct="0"
    )
    body = await preview(auth_client, overrides={"trad_401k_pct": "0.245"})
    before = {row["key"]: row for row in body["pace"]["baseline"]}
    after = {row["key"]: row for row in body["pace"]["scenario"]}
    assert before["limit_401k_elective"]["ratio"] == "0.4082"
    assert after["limit_401k_elective"]["annualized"] == "24500.00"
    assert after["limit_401k_elective"]["ratio"] == "1.0000"
    assert after["limit_401k_elective"]["tone"] == "warn"
