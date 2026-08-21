"""RSU grants CRUD: stored parameters in, computed vest schedule out.

Vest rows are never stored — every echo recomputes `rsu_vesting.schedule`, so a PATCH that
touches shares or the cliff must move vest_count/vested/unvested with it. The vested split is
judged on `scheduler.product_today()` READ AT THE ROUTE (the container clock is UTC and a
PT-evening refresh is already tomorrow there), so the exact-number pins below freeze that day
via monkeypatch and the rest assert only clock-independent invariants: a first vest far in the
past keeps `vested_shares > 0` on any run day, and the split always sums to the grant.
"""

from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.models import RsuGrant

GRANTS = "/api/v1/comp/rsu-grants"

# The frozen day the exact splits below are hand-derived against.
PINNED_TODAY = date(2026, 8, 21)


@pytest.fixture
def frozen_today(monkeypatch):
    """`product_today` as the ROUTE sees it (test_prices_api's patch target convention)."""
    monkeypatch.setattr("app.api.comp.product_today", lambda: PINNED_TODAY)


def grant_payload(**overrides) -> dict:
    # The new-hire shape test_rsu_vesting pins by hand: 700 shares, 25% cliff -> 13 vests of
    # [175, 43, 44, 44, 44, 43, 44, 44, 44, 43, 44, 44, 44] from 2024-09-18.
    body = {
        "kind": "new_hire",
        "label": "Offer letter",
        "shares": 700,
        "grant_price": "45.12",
        "first_vest_date": "2024-09-18",
        "cliff_pct": "0.25",
    }
    body.update(overrides)
    return body


async def create_grant(auth_client, **overrides) -> dict:
    resp = await auth_client.post(GRANTS, json=grant_payload(**overrides))
    assert resp.status_code == 201, resp.text  # fail here, not on a later KeyError
    return resp.json()


async def test_create_grant_echoes_stored_columns_at_scale_and_the_vest_split(auth_client):
    created = await create_grant(auth_client, focal_year=2024, notes="signing grant")
    assert created["kind"] == "new_hire"
    assert created["label"] == "Offer letter"
    assert created["focal_year"] == 2024
    assert created["shares"] == 700
    assert created["grant_price"] == "45.1200"  # Numeric(14,4)
    assert created["cliff_pct"] == "0.2500"  # Numeric(7,4)
    assert created["first_vest_date"] == "2024-09-18"
    assert created["notes"] == "signing grant"
    assert created["vest_count"] == 13  # 25% cliff + 12 x 6.25%
    # Clock-independent: the first vest is years in the past, and the split is conserved.
    assert created["vested_shares"] > 0
    assert created["vested_shares"] + created["unvested_shares"] == 700


async def test_create_grant_splits_vested_on_the_scheduler_day(auth_client, frozen_today):
    created = await create_grant(auth_client)
    # Vests through 2026-06-17 (the 8th) on a 2026-08-21 clock: 175+43+44+44+44+43+44+44.
    assert created["vested_shares"] == 481
    assert created["unvested_shares"] == 219


async def test_create_grant_defaults_focal_year_and_notes_to_null(auth_client):
    created = await create_grant(auth_client)
    assert created["focal_year"] is None
    assert created["notes"] is None


async def test_create_grant_accepts_the_refresh_kind(auth_client):
    created = await create_grant(
        auth_client,
        kind="refresh",
        label="FY26 refresh",
        shares=320,
        cliff_pct="0.0625",
        first_vest_date="2025-06-18",
    )
    assert created["kind"] == "refresh"
    assert created["vest_count"] == 16  # no cliff: 16 x 6.25%


async def test_create_grant_rejects_a_duplicate_label(auth_client):
    await create_grant(auth_client)
    clash = await auth_client.post(GRANTS, json=grant_payload(shares=1))
    assert clash.status_code == 409
    assert "Offer letter" in clash.json()["detail"]


async def test_create_grant_compares_the_trimmed_label_for_uniqueness(auth_client):
    # The 409 must judge the value that would be STORED, or a padded duplicate slips past the
    # pre-select and dies on the unique index as a 500.
    await create_grant(auth_client)
    clash = await auth_client.post(GRANTS, json=grant_payload(label="  Offer letter  "))
    assert clash.status_code == 409
    assert "Offer letter" in clash.json()["detail"]


async def test_create_grant_trims_the_stored_label(auth_client):
    created = await create_grant(auth_client, label="  Offer letter  ")
    assert created["label"] == "Offer letter"


async def test_grant_label_is_capped_at_the_column_width(auth_client):
    # rsu_grants.label is String(60): a 61st character would reach asyncpg as a
    # StringDataRightTruncation (a 500) without the schema's max_length.
    assert (await auth_client.post(GRANTS, json=grant_payload(label="x" * 61))).status_code == 422
    created = await create_grant(auth_client, label="x" * 60)
    assert len(created["label"]) == 60
    long_patch = await auth_client.patch(f"{GRANTS}/{created['id']}", json={"label": "y" * 61})
    assert long_patch.status_code == 422


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"kind": "bogus"}, "kind must be 'new_hire' or 'refresh'"),
        ({"kind": ""}, "kind must be 'new_hire' or 'refresh'"),
        ({"label": "   "}, "label must not be blank"),
        ({"focal_year": 1800}, "focal_year must be between 1990 and 2100"),
        ({"focal_year": 2101}, "focal_year must be between 1990 and 2100"),
        ({"shares": 0}, "shares must be between 1 and 100000000"),
        ({"shares": -5}, "shares must be between 1 and 100000000"),
        ({"shares": 100000001}, "shares must be between 1 and 100000000"),
        ({"grant_price": "0"}, "grant_price must be positive"),
        ({"grant_price": "-1"}, "grant_price must be positive"),
        ({"grant_price": "0.00001"}, "grant_price must be positive"),  # 0.0000 at 4dp
        ({"grant_price": "10000000000"}, "grant_price: |value| must be below 10^10"),
        ({"cliff_pct": "0"}, "cliff_pct must be in (0, 1]"),
        ({"cliff_pct": "-0.25"}, "cliff_pct must be in (0, 1]"),
        ({"cliff_pct": "1.5"}, "cliff_pct must be in (0, 1]"),
        ({"cliff_pct": "0.30"}, "cliff_pct must leave a whole number of 6.25% quarterly vests"),
        ({"cliff_pct": "0.1"}, "cliff_pct must leave a whole number of 6.25% quarterly vests"),
        # Numeric(7,4) keeps 3 integer digits. A bounded quantize, not a plain one: pydantic
        # hands "1e26" straight through and Decimal.quantize() traps on it (a 500).
        ({"cliff_pct": "1e26"}, "cliff_pct: |value| must be below 10^3"),
        # The century fence is load-bearing here, not decorative: 9999-12-31 + 15 quarters
        # lands in year 10003, which datetime.date cannot represent at all.
        ({"first_vest_date": "9999-12-31"}, "first_vest_date: date must be between"),
        ({"first_vest_date": "1026-09-18"}, "first_vest_date: date must be between"),
    ],
)
async def test_create_grant_validation_rules(auth_client, overrides, message):
    resp = await auth_client.post(GRANTS, json=grant_payload(**overrides))
    assert resp.status_code == 422, resp.text
    assert message in resp.json()["detail"]


async def test_create_grant_rejects_a_fractional_share_count(auth_client):
    # `shares` is a whole-share int column: pydantic refuses the coercion before the router
    # ever sees it, so this 422 carries the framework's error list, not a house detail string.
    resp = await auth_client.post(GRANTS, json=grant_payload(shares=2.5))
    assert resp.status_code == 422, resp.text
    assert any("shares" in error["loc"] for error in resp.json()["detail"])


async def test_create_grant_writes_nothing_when_a_late_rule_fires(auth_client, db):
    resp = await auth_client.post(GRANTS, json=grant_payload(cliff_pct="0.30", notes="never"))
    assert resp.status_code == 422
    assert (await db.execute(select(RsuGrant))).scalars().all() == []


async def test_list_grants_orders_by_first_vest_then_id(auth_client):
    assert (await auth_client.get(GRANTS)).json() == []

    await create_grant(auth_client, label="Refresh 2025", first_vest_date="2025-06-18")
    await create_grant(auth_client, label="Offer letter")  # 2024-09-18, inserted second
    await create_grant(auth_client, label="Retention", first_vest_date="2024-09-18")

    body = (await auth_client.get(GRANTS)).json()
    # first_vest_date ascending; the 2024 tie breaks on insertion id, not on label.
    assert [row["label"] for row in body] == ["Offer letter", "Retention", "Refresh 2025"]
    assert body[0]["vest_count"] == 13


async def test_patch_grant_recomputes_the_vest_fields(auth_client, frozen_today):
    created = await create_grant(auth_client)
    assert created["vested_shares"] == 481

    patched = await auth_client.patch(f"{GRANTS}/{created['id']}", json={"shares": 1000})
    assert patched.status_code == 200, patched.text
    body = patched.json()
    assert body["shares"] == 1000
    assert body["vest_count"] == 13  # unchanged: the cliff drives the count
    # 1000 @ 25%: [250, 62, 63, 62, 63, 62, 63, 62, ...] -> 687 through the 8th vest.
    assert body["vested_shares"] == 687
    assert body["unvested_shares"] == 313


async def test_patch_grant_cliff_moves_the_vest_count(auth_client):
    created = await create_grant(auth_client)
    patched = await auth_client.patch(f"{GRANTS}/{created['id']}", json={"cliff_pct": "0.0625"})
    assert patched.status_code == 200, patched.text
    assert patched.json()["cliff_pct"] == "0.0625"
    assert patched.json()["vest_count"] == 16
    assert patched.json()["vested_shares"] + patched.json()["unvested_shares"] == 700


async def test_patch_grant_clears_a_nullable_column_with_an_explicit_null(auth_client):
    # focal_year and notes ARE nullable, so their null really clears (comp events' posture).
    created = await create_grant(auth_client, focal_year=2024, notes="signing grant")
    cleared = await auth_client.patch(
        f"{GRANTS}/{created['id']}", json={"focal_year": None, "notes": None}
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["focal_year"] is None
    assert cleared.json()["notes"] is None


async def test_patch_grant_explicit_null_is_a_no_op_on_a_not_null_column(auth_client):
    created = await create_grant(auth_client)
    kept = await auth_client.patch(
        f"{GRANTS}/{created['id']}",
        json={
            "shares": None,
            "kind": None,
            "label": None,
            "grant_price": None,
            "first_vest_date": None,
            "cliff_pct": None,
        },
    )
    assert kept.status_code == 200, kept.text
    body = kept.json()
    assert body["shares"] == 700
    assert body["kind"] == "new_hire"
    assert body["label"] == "Offer letter"
    assert body["grant_price"] == "45.1200"
    assert body["first_vest_date"] == "2024-09-18"
    assert body["cliff_pct"] == "0.2500"
    assert body["vest_count"] == 13


async def test_patch_grant_validates_the_merged_row(auth_client):
    created = await create_grant(auth_client)
    resp = await auth_client.patch(f"{GRANTS}/{created['id']}", json={"shares": 0})
    assert resp.status_code == 422
    assert "shares must be between 1 and 100000000" in resp.json()["detail"]

    bad_cliff = await auth_client.patch(f"{GRANTS}/{created['id']}", json={"cliff_pct": "0.30"})
    assert bad_cliff.status_code == 422
    assert "6.25%" in bad_cliff.json()["detail"]

    # Nothing was mutated on the way to either raise.
    assert (await auth_client.get(GRANTS)).json()[0]["shares"] == 700


async def test_patch_grant_rechecks_the_label_only_when_it_changed(auth_client):
    first = await create_grant(auth_client)
    second = await create_grant(auth_client, label="FY26 refresh", first_vest_date="2025-06-18")

    clash = await auth_client.patch(f"{GRANTS}/{second['id']}", json={"label": "Offer letter"})
    assert clash.status_code == 409
    assert "Offer letter" in clash.json()["detail"]

    kept = await auth_client.patch(f"{GRANTS}/{second['id']}", json={"label": "FY26 refresh"})
    assert kept.status_code == 200, kept.text  # its own label is not a conflict with itself
    assert kept.json()["id"] == second["id"]
    assert first["label"] == "Offer letter"


async def test_delete_grant_then_the_list_omits_it(auth_client, db):
    created = await create_grant(auth_client)
    other = await create_grant(auth_client, label="FY26 refresh", first_vest_date="2025-06-18")

    assert (await auth_client.delete(f"{GRANTS}/{created['id']}")).status_code == 204
    assert await db.get(RsuGrant, created["id"]) is None
    assert [row["id"] for row in (await auth_client.get(GRANTS)).json()] == [other["id"]]


async def test_patch_grant_404_and_delete_404(auth_client):
    assert (await auth_client.patch(f"{GRANTS}/999", json={})).status_code == 404
    missing = await auth_client.delete(f"{GRANTS}/999")
    assert missing.status_code == 404
    assert missing.json()["detail"] == "rsu grant not found"
    # Same int4 fence as the comp events' ids: never a bare asyncpg DataError 500.
    assert (await auth_client.delete(f"{GRANTS}/99999999999")).status_code == 422


async def test_grant_get_never_rejects_a_stored_row_the_writer_would_refuse(auth_client, db):
    # Written STRAIGHT to the table, below the API's own share floor: a GET must still list it.
    db.add(
        RsuGrant(
            kind="new_hire",
            label="hand-written",
            shares=5,
            grant_price=Decimal("45.1200"),
            first_vest_date=date(2024, 9, 18),
            cliff_pct=Decimal("0.0625"),
        )
    )
    await db.commit()
    body = (await auth_client.get(GRANTS)).json()
    assert body[0]["vest_count"] == 16
    # Zero-share tranches are real: 5 shares over 16 vests floors most of them to nothing.
    assert body[0]["vested_shares"] + body[0]["unvested_shares"] == 5


async def test_rsu_grant_endpoints_require_auth(client):
    assert (await client.get(GRANTS)).status_code == 401
    assert (await client.post(GRANTS, json=grant_payload())).status_code == 401
    assert (await client.patch(f"{GRANTS}/1", json={"shares": 1})).status_code == 401
    assert (await client.delete(f"{GRANTS}/1")).status_code == 401
