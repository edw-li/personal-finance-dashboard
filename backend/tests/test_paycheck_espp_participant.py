"""Whose ESPP the pace strip grades (2026-09-23 spec §B1, income audit INC-01).

The ESPP tables have no owner column (income INC-21), so the stored purchase periods belong
to the household's ESPP participants: everyone with espp_pct > 0 in ANY of their profiles,
or the primary when nobody has one. Grace's paycheck used to read "ESPP §423 · $21.7K /
$21.3K · 102.26 % over" for purchases Edward made; a non-participant now sees an ESPP row
only when their OWN scenario sets a rate. Both payloads say which case a person is in, so
the Try-changes presets never re-derive the rule."""

from datetime import date
from decimal import Decimal

import pytest

from app.models import ContributionLimit, EsppPeriod, Person

PROFILES = "/api/v1/paycheck/profiles"
BREAKDOWN = "/api/v1/paycheck/breakdown"
PREVIEW = "/api/v1/paycheck/preview"
ESPP = "limit_espp_423"
TODAY = date(2026, 9, 23)
D = Decimal


@pytest.fixture(autouse=True)
def frozen_today(monkeypatch):
    # Both stored purchases are behind this day, so both halves are "entered" whatever day
    # the suite runs on, and the limits year is 2026.
    monkeypatch.setattr("app.services.clock.product_today", lambda: TODAY)


@pytest.fixture
async def household(db):
    edward = Person(name="Edward", is_primary=True)
    grace = Person(name="Grace")
    db.add_all([edward, grace])
    db.add(ContributionLimit(year=2026, key=ESPP, value=D("25000.00")))
    db.add_all(
        [
            EsppPeriod(
                label="February 2026 Purchase",
                period_start=date(2025, 9, 1),
                period_end=date(2026, 2, 27),
                semi_annual_base=D("81000.00"),
                additional_payments=D("0"),
                contribution_pct=D("0.140000000"),
            ),
            EsppPeriod(
                label="August 2026 Purchase",
                period_start=date(2026, 3, 1),
                period_end=date(2026, 8, 31),
                semi_annual_base=D("94465.00"),
                additional_payments=D("0"),
                contribution_pct=D("0.110000000"),
            ),
        ]
    )
    await db.commit()
    return edward, grace


async def add_profile(auth_client, person: Person, **fields) -> dict:
    body = {
        "person_id": person.id,
        "effective_date": "2026-01-01",
        "annual_salary": "188930",
        "pay_periods_per_year": 24,
        **fields,
    }
    resp = await auth_client.post(PROFILES, json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def breakdown_for(auth_client, person: Person) -> dict:
    resp = await auth_client.get(BREAKDOWN, params={"person_id": person.id})
    assert resp.status_code == 200, resp.text
    return resp.json()


def espp_row(pace: list[dict]) -> dict | None:
    return next((row for row in pace if row["key"] == ESPP), None)


async def test_the_participant_keeps_every_stored_purchase_byte_for_byte(auth_client, household):
    edward, grace = household
    await add_profile(auth_client, edward, espp_pct="0.11")
    before = await breakdown_for(auth_client, edward)
    # A second earner who never enrolled joins the household: Edward's payload must not move.
    await add_profile(auth_client, grace, annual_salary="24000", espp_pct="0")
    after = await breakdown_for(auth_client, edward)
    assert after == before
    row = espp_row(after["pace"])
    assert [(half["label"], half["amount"], half["source"]) for half in row["halves"]] == [
        ("February 2026 Purchase", "11340.00", "entered"),
        ("August 2026 Purchase", "10391.15", "entered"),
    ]
    assert row["annualized"] == "21731.15"
    assert after["espp_participant"] is True
    assert after["espp_participants"] == ["Edward"]


async def test_a_non_participant_has_no_espp_row_and_says_so(auth_client, household):
    edward, grace = household
    await add_profile(auth_client, edward, espp_pct="0.11")
    await add_profile(auth_client, grace, annual_salary="24000", espp_pct="0")
    body = await breakdown_for(auth_client, grace)
    # The audit's screen was "$21.7K / $21.3K practical · 102.26 % over" for purchases she
    # never made.
    assert espp_row(body["pace"]) is None
    assert body["espp_participant"] is False
    assert body["espp_participants"] == ["Edward"]
    # Every other row is still hers.
    assert {row["key"] for row in body["pace"]} >= {"limit_401k_elective", "limit_415c_total"}


async def test_with_nobody_enrolled_the_primary_keeps_the_stored_purchases(auth_client, household):
    edward, grace = household
    # Purchases typed in, no profile carrying a rate: a single-earner book as it always was.
    await add_profile(auth_client, edward, espp_pct="0")
    await add_profile(auth_client, grace, annual_salary="24000", espp_pct="0")
    mine = await breakdown_for(auth_client, edward)
    theirs = await breakdown_for(auth_client, grace)
    assert espp_row(mine["pace"])["annualized"] == "21731.15"
    assert (mine["espp_participant"], mine["espp_participants"]) == (True, ["Edward"])
    assert espp_row(theirs["pace"]) is None
    assert (theirs["espp_participant"], theirs["espp_participants"]) == (False, ["Edward"])


async def test_two_participants_both_keep_the_stored_purchases(auth_client, household):
    """The documented limitation: with no owner column there is no honest split, so each
    enrolled person's strip grades every stored purchase (income INC-21 is the real fix)."""
    edward, grace = household
    await add_profile(auth_client, edward, espp_pct="0.11")
    await add_profile(auth_client, grace, annual_salary="24000", espp_pct="0.05")
    for person in (edward, grace):
        body = await breakdown_for(auth_client, person)
        assert espp_row(body["pace"])["annualized"] == "21731.15"
        assert body["espp_participant"] is True
        assert body["espp_participants"] == ["Edward", "Grace"]


async def test_a_non_participants_own_rate_draws_an_estimated_only_row(auth_client, household):
    edward, grace = household
    await add_profile(auth_client, edward, espp_pct="0.11")
    await add_profile(auth_client, grace, annual_salary="24000", espp_pct="0")
    resp = await auth_client.post(
        PREVIEW, json={"person_id": grace.id, "overrides": {"espp_pct": "0.1"}}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert espp_row(body["pace"]["baseline"]) is None
    row = espp_row(body["pace"]["scenario"])
    # Her own paydays only: every half is an estimate, and none of Edward's entered dollars.
    assert [half["source"] for half in row["halves"]] == ["estimated", "estimated"]
    assert row["current_rate"] == "0.100000000"
    assert row["projected_full_year"] == "2400.00"  # 10 % of 24,000
    assert D(row["annualized"]) < D("21731.15")
    assert body["espp_participant"] is False
    assert body["espp_participants"] == ["Edward"]


async def test_the_preview_names_a_participant_too(auth_client, household):
    edward, _grace = household
    await add_profile(auth_client, edward, espp_pct="0.11")
    resp = await auth_client.post(PREVIEW, json={"person_id": edward.id, "overrides": {}})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["espp_participant"] is True
    assert body["espp_participants"] == ["Edward"]
    assert espp_row(body["pace"]["baseline"]) == espp_row(body["pace"]["scenario"])
