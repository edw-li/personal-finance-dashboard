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
