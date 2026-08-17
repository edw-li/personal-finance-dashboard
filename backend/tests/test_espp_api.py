"""ESPP API: the lots table, the periods editor, and the chained 25k modeler.

Every number here crosses the wire as a JSON STRING (pydantic Decimals) at the column
scale the writer quantized to — shares Numeric(12,4), espp prices Numeric(14,5),
period money Numeric(12,2), contribution_pct Numeric(10,9). The shared test session hands
the endpoint the very ORM objects the router built (conftest contract), so an unquantized
write would show up here as a short string, not as a silently re-read column value.

The modeler golden is the Workbook reference chain (sub 170.79 / fmv 171.0 / carry 0)
pushed through the REAL endpoint with the two real periods seeded.
"""

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.models import AppSetting, EsppLot, EsppPeriod, LatestPrice, Security

LOTS = "/api/v1/espp/lots"
PERIODS = "/api/v1/espp/periods"
MODELER = "/api/v1/espp/modeler"

D = Decimal


@pytest.fixture
async def espp_ticker(db):
    """app_settings['espp_ticker'] — a SOFT link: nothing guarantees a securities row."""
    db.add(AppSetting(key="espp_ticker", value={"value": "NVDA"}))
    await db.commit()


@pytest.fixture
async def priced_ticker(db, espp_ticker):
    security = Security(ticker="NVDA", name="NVIDIA", holding_type="stock")
    db.add(security)
    await db.flush()
    db.add(
        LatestPrice(
            security_id=security.id,
            price=D("174.1800"),  # Numeric(14,4): the quote family, not the lot family
            quoted_at=datetime(2026, 8, 14, 20, 30, tzinfo=UTC),
            source="yfinance",
        )
    )
    await db.commit()
    return security


def lot_payload(**overrides) -> dict:
    body = {
        "purchase_date": "2024-02-29",
        "qualifying_date": "2025-09-01",
        "shares": "260",
        "subscription_price": "48.509",
        "purchase_fmv": "79.112",
    }
    body.update(overrides)
    return body


async def create_lot(auth_client, **overrides) -> dict:
    resp = await auth_client.post(LOTS, json=lot_payload(**overrides))
    assert resp.status_code == 201, resp.text  # fail here, not on a later KeyError
    return resp.json()


def period_payload(**overrides) -> dict:
    body = {
        "label": "2026 H1",
        "period_start": "2025-09-01",
        "period_end": "2026-02-27",
        "semi_annual_base": "81000",
        "additional_payments": "0",
        "contribution_pct": "0.14",
    }
    body.update(overrides)
    return body


async def create_period(auth_client, **overrides) -> dict:
    resp = await auth_client.post(PERIODS, json=period_payload(**overrides))
    assert resp.status_code == 201, resp.text
    return resp.json()


async def seed_real_periods(auth_client) -> None:
    """The two real 2026 periods, in the sheet's column order."""
    await create_period(auth_client)
    await create_period(
        auth_client,
        label="2026 H2",
        period_start="2026-02-28",
        period_end="2026-08-28",
        semi_annual_base="94465",
        contribution_pct="0.11",
    )


# --- lots: read envelope ---


async def test_lots_envelope_carries_the_ticker_quote_and_computed_metrics(
    auth_client, priced_ticker
):
    await create_lot(auth_client, purchase_date="2025-02-28", qualifying_date="2026-02-28")
    await create_lot(auth_client)  # 2024-02-29 — inserted second, must list FIRST

    body = (await auth_client.get(LOTS)).json()
    assert body["espp_ticker"] == "NVDA"
    assert body["current_price"] == "174.1800"  # the stored quote, at ITS column scale
    assert datetime.fromisoformat(body["quoted_at"]) == datetime(2026, 8, 14, 20, 30, tzinfo=UTC)
    assert [row["purchase_date"] for row in body["lots"]] == ["2024-02-29", "2025-02-28"]

    first = body["lots"][0]
    assert first["shares"] == "260.0000"
    assert first["subscription_price"] == "48.50900"
    assert first["purchase_fmv"] == "79.11200"
    assert first["purchase_price"] == "41.23265"
    assert first["sold_date"] is None
    assert first["sold_price"] is None
    assert first["cost_basis"] == "10720.49"  # 260 x 41.23265 = 10720.489
    assert first["market_value"] == "45286.80"
    assert first["gain_amount"] == "34566.31"
    assert first["gain_pct"] == "3.224322"
    assert first["is_sold"] is False
    assert first["qualified"] is True  # qualifying 2025-09-01 is long past
    assert first["days_until_qualified"] == 0


async def test_lots_metrics_count_down_from_today(auth_client, priced_ticker):
    soon = date.today() + timedelta(days=13)
    await create_lot(auth_client, qualifying_date=str(soon))
    (row,) = (await auth_client.get(LOTS)).json()["lots"]
    assert row["qualified"] is False
    assert row["days_until_qualified"] == 13  # today comes from the ENDPOINT


async def test_lots_envelope_degrades_at_every_break_in_the_soft_link(auth_client, db):
    await create_lot(auth_client)

    # 1. no espp_ticker setting at all
    body = (await auth_client.get(LOTS)).json()
    assert (body["espp_ticker"], body["current_price"], body["quoted_at"]) == (None, None, None)
    assert body["lots"][0]["cost_basis"] == "10720.49"  # stored math still lands
    assert body["lots"][0]["market_value"] is None
    assert body["lots"][0]["gain_amount"] is None
    assert body["lots"][0]["gain_pct"] is None
    assert body["lots"][0]["qualified"] is True  # date-only fields never degrade

    # 2. ticker set, but no securities row (a clean seed's dangling link — Plan 1 note)
    db.add(AppSetting(key="espp_ticker", value={"value": "NVDA"}))
    await db.commit()
    body = (await auth_client.get(LOTS)).json()
    assert body["espp_ticker"] == "NVDA"
    assert body["current_price"] is None
    assert body["lots"][0]["market_value"] is None

    # 3. security exists, but was never quoted
    security = Security(ticker="NVDA", name="NVIDIA", holding_type="stock")
    db.add(security)
    await db.commit()
    body = (await auth_client.get(LOTS)).json()
    assert body["current_price"] is None
    assert body["quoted_at"] is None
    assert body["lots"][0]["market_value"] is None

    # 4. and a malformed settings envelope is not a 500 either (envelope is convention)
    setting = await db.get(AppSetting, "espp_ticker")
    setting.value = {"wrong": "shape"}
    await db.commit()
    assert (await auth_client.get(LOTS)).json()["espp_ticker"] is None


async def test_espp_ticker_setting_is_normalized_before_the_lookup(auth_client, db):
    # A hand-typed setting: padded and lowercase. portfolio.py's _normalize_ticker posture
    # (strip + upper) is the only reason it finds the securities row at all.
    db.add(AppSetting(key="espp_ticker", value={"value": "  nvda  "}))
    security = Security(ticker="NVDA", name="NVIDIA", holding_type="stock")
    db.add(security)
    await db.flush()
    db.add(
        LatestPrice(
            security_id=security.id,
            price=D("174.1800"),
            quoted_at=datetime(2026, 8, 14, 20, 30, tzinfo=UTC),
            source="yfinance",
        )
    )
    await db.commit()
    await create_lot(auth_client)

    body = (await auth_client.get(LOTS)).json()
    assert body["espp_ticker"] == "NVDA"  # echoed NORMALIZED, not as it was typed
    assert body["current_price"] == "174.1800"
    assert body["lots"][0]["market_value"] == "45286.80"

    # A whitespace-only value normalizes to nothing at all, which is "no ticker".
    setting = await db.get(AppSetting, "espp_ticker")
    setting.value = {"value": "   "}
    await db.commit()
    assert (await auth_client.get(LOTS)).json()["espp_ticker"] is None


async def test_lots_list_is_empty_before_anything_is_stored(auth_client):
    assert (await auth_client.get(LOTS)).json() == {
        "espp_ticker": None,
        "current_price": None,
        "quoted_at": None,
        "lots": [],
    }


# --- lots: create ---


async def test_create_lot_defaults_the_purchase_price_to_the_85pct_of_the_lower_price(auth_client):
    created = await create_lot(auth_client)
    # 0.85 x min(48.509, 79.112) = 41.232650 — quantized at 5dp, NOT the modeler's CEIL2.
    assert created["purchase_price"] == "41.23265"

    explicit = await create_lot(auth_client, purchase_date="2024-08-30", purchase_price="41.5")
    assert explicit["purchase_price"] == "41.50000"

    lower_sub = await create_lot(
        auth_client, purchase_date="2025-02-28", subscription_price="100", purchase_fmv="80"
    )
    assert lower_sub["purchase_price"] == "68.00000"  # 0.85 x 80, the lower of the two


async def test_create_lot_stores_the_optional_fields(auth_client, db):
    created = await create_lot(
        auth_client, sold_date="2026-03-01", sold_price="120", notes="sold half the position"
    )
    assert created["sold_date"] == "2026-03-01"
    assert created["sold_price"] == "120.00000"
    assert created["notes"] == "sold half the position"
    assert created["is_sold"] is True
    assert created["days_until_qualified"] is None
    assert (await db.get(EsppLot, created["id"])).shares == D("260.0000")


async def test_create_lot_rejects_a_duplicate_purchase_date(auth_client):
    await create_lot(auth_client)
    clash = await auth_client.post(LOTS, json=lot_payload(shares="1"))
    assert clash.status_code == 409
    assert "2024-02-29" in clash.json()["detail"]


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"qualifying_date": "2024-02-28"}, "qualifying_date must be on or after purchase_date"),
        ({"shares": "0"}, "shares must be positive"),
        ({"shares": "-1"}, "shares must be positive"),
        ({"shares": "0.00001"}, "shares must be positive"),  # rounds away at 4dp
        ({"subscription_price": "0"}, "subscription_price must be positive"),
        ({"purchase_fmv": "-3"}, "purchase_fmv must be positive"),
        ({"purchase_price": "0"}, "purchase_price must be positive"),
        ({"sold_date": "2026-03-01"}, "sold_date and sold_price must be set together"),
        ({"sold_price": "120"}, "sold_date and sold_price must be set together"),
        (
            {"sold_date": "2024-02-28", "sold_price": "120"},
            "sold_date must be on or after purchase_date",
        ),
        ({"sold_date": "2026-03-01", "sold_price": "0"}, "sold_price must be positive"),
        ({"purchase_date": "1026-02-28"}, "purchase_date: date must be between"),
        ({"qualifying_date": "3026-09-01"}, "qualifying_date: date must be between"),
        ({"shares": "100000000"}, "shares: |value| must be below 10^8"),
        ({"subscription_price": "1000000000"}, "subscription_price: |value| must be below 10^9"),
    ],
)
async def test_create_lot_validation_rules(auth_client, overrides, message):
    resp = await auth_client.post(LOTS, json=lot_payload(**overrides))
    assert resp.status_code == 422, resp.text
    assert message in resp.json()["detail"]


async def test_create_lot_writes_nothing_when_a_late_rule_fires(auth_client, db):
    resp = await auth_client.post(
        LOTS, json=lot_payload(sold_date="2026-03-01", sold_price="-1", notes="never stored")
    )
    assert resp.status_code == 422
    assert (await db.execute(select(EsppLot))).scalars().all() == []


# --- lots: patch / delete ---


async def test_patch_lot_updates_fields_and_recomputes_metrics(auth_client, priced_ticker):
    created = await create_lot(auth_client)
    resp = await auth_client.patch(f"{LOTS}/{created['id']}", json={"shares": "130"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["shares"] == "130.0000"
    assert body["cost_basis"] == "5360.24"  # 130 x 41.23265 = 5360.2445
    assert body["market_value"] == "22643.40"

    untouched = await auth_client.patch(f"{LOTS}/{created['id']}", json={})
    assert untouched.status_code == 200
    assert untouched.json()["shares"] == "130.0000"


async def test_patch_lot_validates_the_merged_row(auth_client):
    created = await create_lot(auth_client)  # purchase 2024-02-29, qualifying 2025-09-01
    # Neither field is invalid on its own — the MERGED pair is (Plan 4 house law).
    late = await auth_client.patch(f"{LOTS}/{created['id']}", json={"purchase_date": "2026-01-01"})
    assert late.status_code == 422
    assert "qualifying_date must be on or after purchase_date" in late.json()["detail"]
    early = await auth_client.patch(
        f"{LOTS}/{created['id']}", json={"qualifying_date": "2024-01-01"}
    )
    assert early.status_code == 422

    moved = await auth_client.patch(
        f"{LOTS}/{created['id']}",
        json={"purchase_date": "2026-01-01", "qualifying_date": "2027-01-01"},
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["purchase_date"] == "2026-01-01"


async def test_patch_lot_moves_onto_an_occupied_purchase_date(auth_client):
    first = await create_lot(auth_client)
    await create_lot(auth_client, purchase_date="2024-08-30")
    clash = await auth_client.patch(f"{LOTS}/{first['id']}", json={"purchase_date": "2024-08-30"})
    assert clash.status_code == 409
    # ... but re-stating its OWN date is not a conflict with itself.
    same = await auth_client.patch(f"{LOTS}/{first['id']}", json={"purchase_date": "2024-02-29"})
    assert same.status_code == 200, same.text


async def test_patch_lot_sold_pair_changes_together(auth_client):
    created = await create_lot(auth_client, sold_date="2026-03-01", sold_price="120")
    half = await auth_client.patch(f"{LOTS}/{created['id']}", json={"sold_price": None})
    assert half.status_code == 422
    assert "sold_date and sold_price must be set together" in half.json()["detail"]

    cleared = await auth_client.patch(
        f"{LOTS}/{created['id']}", json={"sold_date": None, "sold_price": None}
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["sold_date"] is None
    assert cleared.json()["is_sold"] is False

    reopened = await auth_client.patch(f"{LOTS}/{created['id']}", json={"sold_date": "2026-03-01"})
    assert reopened.status_code == 422  # one half of the pair, again


async def test_patch_lot_nulling_purchase_price_re_derives_the_default(auth_client):
    created = await create_lot(auth_client, purchase_price="41.5")
    assert created["purchase_price"] == "41.50000"
    # An explicit null on a NOT NULL column cannot be stored — here it means
    # "recompute the 85% default from the merged subscription/fmv pair".
    resp = await auth_client.patch(f"{LOTS}/{created['id']}", json={"purchase_price": None})
    assert resp.status_code == 200, resp.text
    assert resp.json()["purchase_price"] == "41.23265"


async def test_explicit_null_is_a_no_op_on_a_not_null_column(auth_client):
    # The house PATCH convention (portfolio.py's update_security): absent keeps the stored
    # value, and an explicit null on a column that cannot hold one reads as "no change"
    # rather than a 422. `purchase_price` is the one deliberate exception (it re-derives).
    lot = await create_lot(auth_client)
    resp = await auth_client.patch(f"{LOTS}/{lot['id']}", json={"shares": None})
    assert resp.status_code == 200, resp.text
    assert resp.json()["shares"] == "260.0000"

    created = await create_period(auth_client)
    patched = await auth_client.patch(f"{PERIODS}/{created['id']}", json={"label": None})
    assert patched.status_code == 200, patched.text
    assert patched.json()["label"] == "2026 H1"


async def test_patch_lot_404_and_delete_roundtrip(auth_client, db):
    assert (await auth_client.patch(f"{LOTS}/999", json={"shares": "1"})).status_code == 404
    assert (await auth_client.delete(f"{LOTS}/999")).status_code == 404
    # The PK is an int4: an out-of-range id must be a 422 at the boundary, never the bare
    # asyncpg DataError 500 it would otherwise reach the driver as (paycheck.py's fence).
    huge = await auth_client.patch(f"{LOTS}/99999999999", json={"shares": "1"})
    assert huge.status_code == 422
    created = await create_lot(auth_client)
    assert (await auth_client.delete(f"{LOTS}/{created['id']}")).status_code == 204
    assert await db.get(EsppLot, created["id"]) is None


# --- periods ---


async def test_periods_crud_roundtrip(auth_client, db):
    assert (await auth_client.get(PERIODS)).json() == []

    second = await create_period(
        auth_client,
        label="2026 H2",
        period_start="2026-02-28",
        period_end="2026-08-28",
        semi_annual_base="94465",
        contribution_pct="0.11",
    )
    first = await create_period(auth_client)  # earlier period_end, inserted second

    body = (await auth_client.get(PERIODS)).json()
    assert [row["label"] for row in body] == ["2026 H1", "2026 H2"]  # by period_end
    assert body[0]["semi_annual_base"] == "81000.00"
    assert body[0]["additional_payments"] == "0.00"
    assert body[0]["contribution_pct"] == "0.140000000"  # Numeric(10,9)

    patched = await auth_client.patch(
        f"{PERIODS}/{first['id']}", json={"contribution_pct": "0.15", "additional_payments": "500"}
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["contribution_pct"] == "0.150000000"
    assert patched.json()["additional_payments"] == "500.00"

    assert (await auth_client.delete(f"{PERIODS}/{second['id']}")).status_code == 204
    assert await db.get(EsppPeriod, second["id"]) is None
    assert len((await auth_client.get(PERIODS)).json()) == 1


async def test_periods_sharing_a_period_end_fall_back_to_the_id_tiebreak(auth_client):
    # ORDER BY period_end, id — without the id the two rows would come back in whatever
    # order the planner picked, and the modeler's chain is ORDER-dependent.
    zed = await create_period(auth_client, label="zed")
    ace = await create_period(auth_client, label="ace")
    assert zed["period_end"] == ace["period_end"] == "2026-02-27"

    listed = (await auth_client.get(PERIODS)).json()
    assert [row["id"] for row in listed] == [zed["id"], ace["id"]]  # insertion, not label

    modeled = (
        await auth_client.get(
            MODELER, params={"subscription_price": "170.79", "purchase_fmv": "171"}
        )
    ).json()
    assert [row["id"] for row in modeled["periods"]] == [zed["id"], ace["id"]]


async def test_a_zero_contribution_pct_crosses_the_wire_in_plain_notation(auth_client):
    # A Numeric(10,9) zero is Decimal("0E-9"), and pydantic renders a Decimal with str():
    # without the schema's plain-format serializer this reaches the frontend as "0E-9",
    # which no JS decimal parser reads as a number.
    created = await create_period(auth_client, contribution_pct="0")
    assert created["contribution_pct"] == "0.000000000"
    assert (await auth_client.get(PERIODS)).json()[0]["contribution_pct"] == "0.000000000"

    patched = await auth_client.patch(
        f"{PERIODS}/{created['id']}", json={"contribution_pct": "0.0"}
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["contribution_pct"] == "0.000000000"

    body = (
        await auth_client.get(
            MODELER, params={"subscription_price": "170.79", "purchase_fmv": "171"}
        )
    ).json()
    (row,) = body["periods"]
    assert row["contribution_pct"] == "0.000000000"
    # ... and the chain still models the period; it just buys nothing.
    assert row["eligible_earnings"] == "81000.00"
    assert row["contribution"] == "0.00"
    assert row["available"] == "0.00"
    assert row["purchase_price"] == "145.18"
    assert row["shares_before_limit"] == "0"
    assert row["unused_25k"] == "25000.00"
    assert row["max_shares_25k"] == "146"  # the limit is untouched, the cash is the cap
    assert row["over_limit"] is False
    assert row["shares"] == "0"
    assert row["cost"] == "0.00"
    assert row["carry_forward_out"] == "0.00"
    assert row["refund"] == "0.00"
    assert row["value_25k"] == "0.00"
    assert body["totals"] == {
        "total_25k_value": "0.00",
        "out_of_pocket_cost": "0.00",
        "fmv_of_shares": "0.00",
        "remaining_25k": "25000.00",
    }


async def test_create_period_omitting_additional_payments_stores_zero(auth_client):
    body = period_payload()
    del body["additional_payments"]
    resp = await auth_client.post(PERIODS, json=body)
    assert resp.status_code == 201, resp.text
    assert resp.json()["additional_payments"] == "0.00"


async def test_create_period_rejects_a_duplicate_label(auth_client):
    await create_period(auth_client)
    clash = await auth_client.post(PERIODS, json=period_payload(period_end="2026-03-31"))
    assert clash.status_code == 409
    assert "2026 H1" in clash.json()["detail"]


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"label": "   "}, "label must not be blank"),
        ({"period_end": "2025-09-01"}, "period_end must be after period_start"),
        ({"period_end": "2025-08-31"}, "period_end must be after period_start"),
        ({"semi_annual_base": "-1"}, "semi_annual_base must be >= 0"),
        ({"semi_annual_base": "-0.001"}, "semi_annual_base must be >= 0"),  # -0.00 after 2dp
        ({"additional_payments": "-5"}, "additional_payments must be >= 0"),
        ({"contribution_pct": "1.000000001"}, "contribution_pct must be between 0 and 1"),
        ({"contribution_pct": "-0.01"}, "contribution_pct must be between 0 and 1"),
        # -0.000000000 after the 9dp quantize — the raw value is what still says "negative".
        ({"contribution_pct": "-0.0000000001"}, "contribution_pct must be between 0 and 1"),
        ({"contribution_pct": "14"}, "contribution_pct must be between 0 and 1"),  # 14%, mis-scaled
        ({"period_start": "1026-09-01"}, "period_start: date must be between"),
        ({"semi_annual_base": "10000000000"}, "semi_annual_base: |value| must be below 10^10"),
    ],
)
async def test_create_period_validation_rules(auth_client, overrides, message):
    resp = await auth_client.post(PERIODS, json=period_payload(**overrides))
    assert resp.status_code == 422, resp.text
    assert message in resp.json()["detail"]


async def test_period_label_max_length_and_trimming(auth_client):
    assert (await auth_client.post(PERIODS, json=period_payload(label="x" * 61))).status_code == 422
    created = await create_period(auth_client, label="  2026 H1  ")
    assert created["label"] == "2026 H1"


async def test_patch_period_validates_the_merged_row(auth_client):
    created = await create_period(auth_client)  # 2025-09-01 .. 2026-02-27
    resp = await auth_client.patch(
        f"{PERIODS}/{created['id']}", json={"period_start": "2026-06-01"}
    )
    assert resp.status_code == 422
    assert "period_end must be after period_start" in resp.json()["detail"]

    other = await create_period(auth_client, label="2026 H2", period_end="2026-08-28")
    clash = await auth_client.patch(f"{PERIODS}/{other['id']}", json={"label": "2026 H1"})
    assert clash.status_code == 409
    kept = await auth_client.patch(f"{PERIODS}/{other['id']}", json={"label": "2026 H2"})
    assert kept.status_code == 200, kept.text  # its own label is not a conflict


async def test_patch_period_404_and_delete_404(auth_client):
    assert (await auth_client.patch(f"{PERIODS}/999", json={"label": "x"})).status_code == 404
    assert (await auth_client.delete(f"{PERIODS}/999")).status_code == 404
    # Same int4 fence as the lots table's ids.
    assert (await auth_client.delete(f"{PERIODS}/99999999999")).status_code == 422


# --- modeler ---


async def test_modeler_golden_chain_over_the_two_real_periods(auth_client, priced_ticker):
    await seed_real_periods(auth_client)
    resp = await auth_client.get(
        MODELER,
        params={"subscription_price": "170.79", "purchase_fmv": "171", "carry_forward": "0"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["year"] == 2026
    assert body["espp_ticker"] == "NVDA"
    assert body["price_source"] == "params"  # explicit params beat the live quote
    assert body["quoted_at"] is None  # ... so the stored quote is behind none of this
    assert body["subscription_price"] == "170.79000"
    assert body["purchase_fmv"] == "171.00000"
    assert body["carry_forward"] == "0.00"

    feb, aug = body["periods"]
    assert feb["label"] == "2026 H1"
    assert feb["period_start"] == "2025-09-01"
    assert feb["period_end"] == "2026-02-27"
    assert feb["semi_annual_base"] == "81000.00"
    assert feb["additional_payments"] == "0.00"
    assert feb["contribution_pct"] == "0.140000000"
    assert feb["eligible_earnings"] == "81000.00"
    assert feb["contribution"] == "11340.00"
    assert feb["available"] == "11340.00"
    assert feb["purchase_price"] == "145.18"  # CEIL2(0.85 x 170.79)
    assert feb["shares_before_limit"] == "78"
    assert feb["unused_25k"] == "25000.00"
    assert feb["max_shares_25k"] == "146"
    assert feb["over_limit"] is False
    assert feb["shares"] == "78"
    assert feb["cost"] == "11324.04"
    assert feb["carry_forward_out"] == "15.96"
    assert feb["refund"] == "0.00"
    assert feb["value_25k"] == "13321.62"

    assert aug["label"] == "2026 H2"
    assert aug["contribution"] == "10391.15"
    assert aug["available"] == "10407.11"  # 10391.15 + Feb's carry
    assert aug["shares_before_limit"] == "71"
    assert aug["unused_25k"] == "11678.38"
    assert aug["max_shares_25k"] == "68"
    assert aug["over_limit"] is True
    assert aug["shares"] == "68"
    assert aug["cost"] == "9872.24"
    assert aug["carry_forward_out"] == "0.00"
    assert aug["refund"] == "534.87"
    assert aug["value_25k"] == "11613.72"

    assert body["totals"] == {
        "total_25k_value": "24935.34",
        "out_of_pocket_cost": "21196.28",
        "fmv_of_shares": "24966.00",  # 146 shares x the last column's FMV
        "remaining_25k": "64.66",
    }


async def test_modeler_defaults_both_prices_to_the_live_quote(auth_client, priced_ticker):
    await seed_real_periods(auth_client)
    body = (await auth_client.get(MODELER)).json()
    assert body["price_source"] == "latest_price"
    # The provenance line: which quote these prices actually came from.
    assert datetime.fromisoformat(body["quoted_at"]) == datetime(2026, 8, 14, 20, 30, tzinfo=UTC)
    assert body["subscription_price"] == "174.18000"  # re-scaled into the espp price family
    assert body["purchase_fmv"] == "174.18000"
    assert body["carry_forward"] == "0.00"
    assert body["periods"][0]["purchase_price"] == "148.06"  # CEIL2(0.85 x 174.18)
    assert body["periods"][0]["shares"] == "76"
    assert body["totals"]["total_25k_value"] == "24907.74"


async def test_modeler_half_defaulted_prices_report_the_live_source(auth_client, priced_ticker):
    await seed_real_periods(auth_client)
    body = (await auth_client.get(MODELER, params={"subscription_price": "170.79"})).json()
    assert body["subscription_price"] == "170.79000"
    assert body["purchase_fmv"] == "174.18000"
    assert body["price_source"] == "latest_price"  # not everything came from params


async def test_modeler_422_when_no_quote_and_no_params(auth_client, espp_ticker):
    await seed_real_periods(auth_client)
    resp = await auth_client.get(MODELER)
    assert resp.status_code == 422
    assert (
        resp.json()["detail"] == "no live price for NVDA; pass subscription_price and purchase_fmv"
    )
    # One missing half is still missing.
    half = await auth_client.get(MODELER, params={"subscription_price": "170.79"})
    assert half.status_code == 422


async def test_modeler_runs_on_params_alone_without_any_ticker(auth_client):
    await seed_real_periods(auth_client)
    resp = await auth_client.get(
        MODELER, params={"subscription_price": "170.79", "purchase_fmv": "171"}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["espp_ticker"] is None
    assert resp.json()["price_source"] == "params"
    assert resp.json()["totals"]["total_25k_value"] == "24935.34"


async def test_modeler_carry_forward_seeds_the_first_period(auth_client):
    await seed_real_periods(auth_client)
    body = (
        await auth_client.get(
            MODELER,
            params={
                "subscription_price": "170.79",
                "purchase_fmv": "171",
                "carry_forward": "100",
            },
        )
    ).json()
    assert body["carry_forward"] == "100.00"
    assert body["periods"][0]["available"] == "11440.00"
    assert body["periods"][0]["carry_forward_out"] == "115.96"


@pytest.mark.parametrize(
    ("params", "message"),
    [
        ({"subscription_price": "0", "purchase_fmv": "171"}, "subscription_price must be positive"),
        ({"subscription_price": "170.79", "purchase_fmv": "-1"}, "purchase_fmv must be positive"),
        (
            {"subscription_price": "170.79", "purchase_fmv": "171", "carry_forward": "-1"},
            "carry_forward must be >= 0",
        ),
        (
            {"subscription_price": "170.79", "purchase_fmv": "171", "carry_forward": "-0.001"},
            "carry_forward must be >= 0",
        ),
        (
            {"subscription_price": "10000000000", "purchase_fmv": "171"},
            "subscription_price: |value| must be below 10^10",
        ),
    ],
)
async def test_modeler_param_validation(auth_client, params, message):
    await seed_real_periods(auth_client)
    resp = await auth_client.get(MODELER, params=params)
    assert resp.status_code == 422, resp.text
    assert message in resp.json()["detail"]


async def test_modeler_prices_wear_the_quote_bound_not_the_lots_one(auth_client):
    # These params are never stored, and a no-param GET feeds latest_prices.price —
    # Numeric(14,4) — straight into them. Fencing them at the LOTS column's 10^9 would
    # let the price job write a perfectly storable quote that then 422s a plain read.
    await seed_real_periods(auth_client)
    resp = await auth_client.get(
        MODELER, params={"subscription_price": "9999999999.9999", "purchase_fmv": "171"}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["subscription_price"] == "9999999999.99990"
    # Lot prices keep 10^9, because that IS their Numeric(14,5) limit.
    stored = await auth_client.post(LOTS, json=lot_payload(subscription_price="1000000000"))
    assert stored.status_code == 422
    assert "subscription_price: |value| must be below 10^9" in stored.json()["detail"]


async def test_modeler_year_defaults_to_the_latest_year_with_periods(auth_client, db):
    await seed_real_periods(auth_client)
    await create_period(
        auth_client,
        label="2025 H2",
        period_start="2025-03-01",
        period_end="2025-08-29",
        semi_annual_base="60000",
        contribution_pct="0.1",
    )
    params = {"subscription_price": "170.79", "purchase_fmv": "171"}

    latest = (await auth_client.get(MODELER, params=params)).json()
    assert latest["year"] == 2026
    assert [row["label"] for row in latest["periods"]] == ["2026 H1", "2026 H2"]

    older = (await auth_client.get(MODELER, params={**params, "year": 2025})).json()
    assert older["year"] == 2025
    assert [row["label"] for row in older["periods"]] == ["2025 H2"]
    assert older["periods"][0]["shares"] == "41"
    assert older["totals"]["total_25k_value"] == "7002.39"
    assert older["totals"]["remaining_25k"] == "17997.61"  # the limit is per YEAR


async def test_modeler_404s_when_the_year_has_no_periods(auth_client):
    params = {"subscription_price": "170.79", "purchase_fmv": "171"}
    empty = await auth_client.get(MODELER, params=params)
    assert empty.status_code == 404
    assert empty.json()["detail"] == "no espp periods"

    await seed_real_periods(auth_client)
    missing_year = await auth_client.get(MODELER, params={**params, "year": 2024})
    assert missing_year.status_code == 404
    assert "2024" in missing_year.json()["detail"]


async def test_modeler_rejects_an_out_of_century_year(auth_client):
    await seed_real_periods(auth_client)
    resp = await auth_client.get(
        MODELER,
        params={"subscription_price": "170.79", "purchase_fmv": "171", "year": 99999999999},
    )
    assert resp.status_code == 422


# --- auth ---


async def test_espp_endpoints_require_auth(client):
    assert (await client.get(LOTS)).status_code == 401
    assert (await client.post(LOTS, json=lot_payload())).status_code == 401
    assert (await client.patch(f"{LOTS}/1", json={"shares": "1"})).status_code == 401
    assert (await client.delete(f"{LOTS}/1")).status_code == 401
    assert (await client.get(PERIODS)).status_code == 401
    assert (await client.post(PERIODS, json=period_payload())).status_code == 401
    assert (await client.patch(f"{PERIODS}/1", json={"label": "x"})).status_code == 401
    assert (await client.delete(f"{PERIODS}/1")).status_code == 401
    assert (await client.get(MODELER)).status_code == 401
