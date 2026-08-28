"""Contribution-limit registry API (2026-08-27 two-income-streams spec §4.5).

The five DEFINITIONS always ride back — a key the user has never entered still needs a
box to type into — and the PUT is the spending-months tri-state: omitted keys are
untouched, numbers are written, an explicit null DELETES the row back to "not entered".
"""

from sqlalchemy import select

from app.limit_keys import LIMIT_DEFINITIONS
from app.models import ContributionLimit

ALL_KEYS = [
    "limit_401k_elective",
    "limit_415c_total",
    "limit_hsa_self",
    "limit_hsa_family",
    "limit_espp_423",
]


async def test_get_lists_all_five_definitions_with_null_values(auth_client):
    resp = await auth_client.get("/api/v1/limits?year=2026")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["year"] == 2026
    assert [item["key"] for item in body["items"]] == ALL_KEYS
    assert [item["value"] for item in body["items"]] == [None] * 5
    # Labels are the code's, not the database's — nothing is stored for them.
    assert body["items"][0]["label"] == "401(k) elective deferral"


async def test_definitions_are_ordered_by_their_sort_number(auth_client):
    assert [key for key, _label, _sort in sorted(LIMIT_DEFINITIONS, key=lambda r: r[2])] == ALL_KEYS


async def test_limits_require_auth(client):
    assert (await client.get("/api/v1/limits?year=2026")).status_code == 401


async def test_put_writes_and_get_reads_back(auth_client):
    resp = await auth_client.put(
        "/api/v1/limits/2026",
        json={"values": {"limit_401k_elective": "24500", "limit_hsa_family": "8900.5"}},
    )
    assert resp.status_code == 200, resp.text
    values = {item["key"]: item["value"] for item in resp.json()["items"]}
    # Quantized to the column scale on the way in.
    assert values["limit_401k_elective"] == "24500.00"
    assert values["limit_hsa_family"] == "8900.50"
    assert values["limit_espp_423"] is None

    again = await auth_client.get("/api/v1/limits?year=2026")
    assert {item["key"]: item["value"] for item in again.json()["items"]} == values


async def test_an_omitted_key_is_untouched(auth_client):
    await auth_client.put(
        "/api/v1/limits/2026",
        json={"values": {"limit_401k_elective": "24500", "limit_hsa_self": "4400"}},
    )
    resp = await auth_client.put(
        "/api/v1/limits/2026", json={"values": {"limit_401k_elective": "24000"}}
    )
    values = {item["key"]: item["value"] for item in resp.json()["items"]}
    assert values["limit_401k_elective"] == "24000.00"
    assert values["limit_hsa_self"] == "4400.00"


async def test_an_explicit_null_deletes_the_row(auth_client, db):
    await auth_client.put("/api/v1/limits/2026", json={"values": {"limit_hsa_self": "4400"}})
    resp = await auth_client.put("/api/v1/limits/2026", json={"values": {"limit_hsa_self": None}})
    values = {item["key"]: item["value"] for item in resp.json()["items"]}
    assert values["limit_hsa_self"] is None
    # A DELETED row, not a stored zero — the CHECK forbids the zero, and "not entered" is
    # the state the pace strip's call-to-action is about.
    rows = (await db.execute(select(ContributionLimit))).scalars().all()
    assert rows == []


async def test_deleting_a_key_that_was_never_stored_is_a_no_op(auth_client):
    resp = await auth_client.put("/api/v1/limits/2026", json={"values": {"limit_espp_423": None}})
    assert resp.status_code == 200, resp.text
    assert all(item["value"] is None for item in resp.json()["items"])


async def test_an_unknown_key_is_refused(auth_client, db):
    resp = await auth_client.put("/api/v1/limits/2026", json={"values": {"limit_457b": "24500"}})
    assert resp.status_code == 422
    assert "limit_457b" in resp.json()["detail"]
    assert (await db.execute(select(ContributionLimit))).scalars().all() == []


async def test_a_zero_or_negative_limit_is_refused(auth_client):
    for bad in ("0", "-0", "-1"):
        resp = await auth_client.put(
            "/api/v1/limits/2026", json={"values": {"limit_hsa_self": bad}}
        )
        assert resp.status_code == 422, bad
        assert "limit_hsa_self must be positive" in resp.json()["detail"]


async def test_a_rejected_key_writes_nothing_at_all(auth_client, db):
    """Validate-then-mutate: a 422 halfway through a multi-key PUT must not leave the
    legal keys written (the paycheck router's whole-row rule)."""
    resp = await auth_client.put(
        "/api/v1/limits/2026",
        json={"values": {"limit_401k_elective": "24500", "limit_hsa_self": "-5"}},
    )
    assert resp.status_code == 422
    assert (await db.execute(select(ContributionLimit))).scalars().all() == []


async def test_an_out_of_range_year_is_refused(auth_client):
    assert (await auth_client.get("/api/v1/limits?year=99999999999")).status_code == 422
    assert (await auth_client.put("/api/v1/limits/1899", json={"values": {}})).status_code == 422


async def test_years_are_independent(auth_client):
    await auth_client.put("/api/v1/limits/2026", json={"values": {"limit_hsa_self": "4400"}})
    await auth_client.put("/api/v1/limits/2027", json={"values": {"limit_hsa_self": "4500"}})
    for year, expected in ((2026, "4400.00"), (2027, "4500.00")):
        resp = await auth_client.get(f"/api/v1/limits?year={year}")
        values = {item["key"]: item["value"] for item in resp.json()["items"]}
        assert values["limit_hsa_self"] == expected


async def test_an_over_scale_value_is_a_422_not_a_500(auth_client):
    resp = await auth_client.put(
        "/api/v1/limits/2026", json={"values": {"limit_401k_elective": "1e13"}}
    )
    assert resp.status_code == 422


def test_the_coverage_map_covers_both_hdhp_tiers():
    from app.limit_keys import HSA_LIMIT_KEY_BY_COVERAGE

    assert HSA_LIMIT_KEY_BY_COVERAGE == {
        "self": "limit_hsa_self",
        "family": "limit_hsa_family",
    }
    # 'none' is deliberately absent: no HDHP means NEITHER cap applies, and a row would
    # have to pick one of the two to measure against.
    assert "none" not in HSA_LIMIT_KEY_BY_COVERAGE
