"""RSU grants CRUD: stored parameters in, computed vest schedule out.

Vest rows are never stored — every echo recomputes `rsu_vesting.schedule`, so a PATCH that
touches shares or the cliff must move vest_count/vested/unvested with it. The vested split is
judged on `scheduler.product_today()` READ AT THE ROUTE (the container clock is UTC and a
PT-evening refresh is already tomorrow there), so the exact-number pins below freeze that day
via monkeypatch and the rest assert only clock-independent invariants: a first vest far in the
past keeps `vested_shares > 0` on any run day, and the split always sums to the grant.

The second half covers GET /comp/vesting-schedule (spec §4) — the whole Comp card set in one
computed payload. It is a READ over stored rows, so its pins are as much about degradation as
about arithmetic: a missing ticker, a missing bar, and a hand-edited grant the writer would
have refused all have to come back 200 with a warning, never a 422 or a 500.
"""

from datetime import UTC, date, datetime
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.models import AppSetting, CompEvent, LatestPrice, PriceHistory, RsuGrant, Security

GRANTS = "/api/v1/comp/rsu-grants"
SCHEDULE = "/api/v1/comp/vesting-schedule"

# The frozen day the exact CRUD splits below are hand-derived against. Deliberately in the
# PAST: a pinned day still ahead of the grant's next real vest would keep passing even if the
# monkeypatch silently stopped applying, and would only start failing at some later boundary.
# A past day makes a dead patch fail loudly on the very next run.
PINNED_TODAY = date(2025, 1, 2)


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
    # Exactly two vests sit behind 2025-01-02 — 2024-09-18: 175 and 2024-12-18: 43 — and the
    # third (2025-03-19) does not. 175 + 43 = 218, leaving 700 - 218 = 482.
    assert created["vested_shares"] == 218
    assert created["unvested_shares"] == 482


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
    assert created["vested_shares"] == 218

    patched = await auth_client.patch(f"{GRANTS}/{created['id']}", json={"shares": 1000})
    assert patched.status_code == 200, patched.text
    body = patched.json()
    assert body["shares"] == 1000
    assert body["vest_count"] == 13  # unchanged: the cliff drives the count
    # 1000 @ 25% by cumulative floor: int(1000 x 0.25) = 250, then int(1000 x 0.3125) - 250 =
    # 62 -> [250, 62, 63, 62, ...]. The same two vests are behind 2025-01-02: 250 + 62 = 312.
    assert body["vested_shares"] == 312
    assert body["unvested_shares"] == 688


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
    # Written STRAIGHT to the table with shares=0 — genuinely below the API's share floor of
    # 1, so neither POST nor PATCH could ever have produced this row. A GET must still list
    # it: reads never reject stored data. `vest_shares(0, ...)` is 16 zero tranches, so the
    # echo stays computable.
    db.add(
        RsuGrant(
            kind="new_hire",
            label="hand-written",
            shares=0,
            grant_price=Decimal("45.1200"),
            first_vest_date=date(2024, 9, 18),
            cliff_pct=Decimal("0.0625"),
        )
    )
    await db.commit()
    body = (await auth_client.get(GRANTS)).json()
    assert body[0]["vest_count"] == 16
    assert (body[0]["vested_shares"], body[0]["unvested_shares"]) == (0, 0)


async def test_rsu_grant_endpoints_require_auth(client):
    assert (await client.get(GRANTS)).status_code == 401
    assert (await client.post(GRANTS, json=grant_payload())).status_code == 401
    assert (await client.patch(f"{GRANTS}/1", json={"shares": 1})).status_code == 401
    assert (await client.delete(f"{GRANTS}/1")).status_code == 401
    assert (await client.get(SCHEDULE)).status_code == 401


# --- GET /comp/vesting-schedule ---

# A LATER frozen day than the CRUD pins use: the vested-this-year tile needs past vests inside
# the frozen calendar year, and nothing has vested by 2025-01-02. Still in the past, for the
# same dead-monkeypatch reason PINNED_TODAY explains.
PINNED_SCHEDULE_TODAY = date(2025, 6, 30)

NO_TICKER = "no ESPP/employer ticker configured — vest values are unavailable"


@pytest.fixture
def frozen_schedule_today(monkeypatch):
    monkeypatch.setattr("app.api.comp.product_today", lambda: PINNED_SCHEDULE_TODAY)


@pytest.fixture
async def employer_ticker(db):
    """app_settings['espp_ticker'] — a SOFT link (test_espp_api's fixture): nothing guarantees
    a securities row behind it, which is exactly why every price field is nullable."""
    db.add(AppSetting(key="espp_ticker", value={"value": "NVDA"}))
    await db.commit()


@pytest.fixture
async def priced_employer(db, employer_ticker):
    """NVDA with a latest quote and history bars STRADDLING the pinned grant's vest dates:
    2024-09-17/20 around the 09-18 cliff, 2025-03-18/21 around the 03-19 vest, and exact bars
    on 2024-12-18 and 2025-06-18."""
    security = Security(ticker="NVDA", name="NVIDIA", holding_type="stock")
    db.add(security)
    await db.flush()
    db.add(
        LatestPrice(
            security_id=security.id,
            price=Decimal("180.0000"),
            quoted_at=datetime(2025, 6, 30, 20, 15, tzinfo=UTC),
            source="yfinance",
        )
    )
    db.add_all(
        [
            PriceHistory(security_id=security.id, price_date=day, close=Decimal(close))
            for day, close in [
                (date(2024, 9, 17), "120.0000"),
                (date(2024, 9, 20), "125.0000"),
                (date(2024, 12, 18), "130.5000"),
                (date(2025, 3, 18), "140.0000"),
                (date(2025, 3, 21), "145.0000"),
                (date(2025, 6, 18), "150.2500"),
            ]
        ]
    )
    await db.commit()
    return security


async def seed_focal_event(db, focal_year: int, **fields) -> CompEvent:
    """A comp_events row straight to the table. `current_base` is NOT NULL but the schedule
    never reads it, so it stays fixed noise here."""
    event = CompEvent(focal_year=focal_year, current_base=Decimal("300000.00"), **fields)
    db.add(event)
    await db.commit()
    return event


async def test_schedule_resolves_fmv_from_the_newest_bar_on_or_before_each_past_vest(
    auth_client, priced_employer, frozen_schedule_today
):
    await create_grant(auth_client)
    resp = await auth_client.get(SCHEDULE)
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["ticker"] == "NVDA"
    assert body["latest_price"] == "180.0000"
    assert datetime.fromisoformat(body["quoted_at"]) == datetime(2025, 6, 30, 20, 15, tzinfo=UTC)
    assert len(body["vests"]) == 13  # every vest, past and future

    # 2024-09-18 sits BETWEEN the 09-17 and 09-20 bars: the older one wins (a bar dated after
    # the vest is information the vest did not have). 120.0000 x 175 = 21000.00.
    assert body["vests"][0] == {
        "vest_date": "2024-09-18",
        "grant_id": body["grants"][0]["id"],
        "label": "Offer letter",
        "shares": 175,
        "fmv": "120.0000",
        "value": "21000.00",
        "is_past": True,
    }
    # An exact bar on the vest date. 130.5000 x 43 = 5611.50.
    assert (body["vests"][1]["fmv"], body["vests"][1]["value"]) == ("130.5000", "5611.50")
    # 2025-03-19 between the 03-18 and 03-21 bars -> the older again. 140 x 44 = 6160.00.
    assert (body["vests"][2]["fmv"], body["vests"][2]["value"]) == ("140.0000", "6160.00")
    assert (body["vests"][3]["fmv"], body["vests"][3]["value"]) == ("150.2500", "6611.00")
    # Future vests are NOT priced off history — the tiles value them at the latest quote.
    assert body["vests"][4]["vest_date"] == "2025-09-17"
    assert (body["vests"][4]["fmv"], body["vests"][4]["value"]) == (None, None)
    assert body["vests"][4]["is_past"] is False

    assert body["warnings"] == []
    # The grant echo is the CRUD shape, split on the same frozen day: 175+43+44+44 = 306.
    assert (body["grants"][0]["vested_shares"], body["grants"][0]["unvested_shares"]) == (306, 394)


async def test_schedule_groups_vests_into_one_row_per_date(
    auth_client, priced_employer, frozen_schedule_today
):
    """2026-08-21 revision: the table renders `vest_days` — one row per DATE across grants —
    and expands a date into its `vests` tranches. The grouping is exact: every past tranche
    on a day priced at the same close, so the day's value is close x summed shares."""
    await create_grant(auth_client)  # Offer letter: 700 @ 25%, first vest 2024-09-18
    # A refresh sharing the quarterly grid from 2025-06-18: 320 x 6.25% = an even 20/quarter.
    await create_grant(
        auth_client,
        label="2025 focal",
        kind="refresh",
        shares=320,
        cliff_pct="0.0625",
        first_vest_date="2025-06-18",
    )
    resp = await auth_client.get(SCHEDULE)
    assert resp.status_code == 200, resp.text
    body = resp.json()

    days = body["vest_days"]
    # 13 offer dates + 16 refresh dates - 10 shared (2025-06 .. 2027-09 inclusive grid).
    assert len(days) == 19
    assert [d["vest_date"] for d in days] == sorted(d["vest_date"] for d in days)

    # A single-tranche past day carries its own close verbatim.
    assert days[0] == {
        "vest_date": "2024-09-18",
        "is_past": True,
        "tranche_count": 1,
        "shares": 175,
        "fmv": "120.0000",
        "value": "21000.00",
        "value_is_estimate": False,
    }
    # The shared 2025-06-18 day: 44 (offer) + 20 (refresh) at the one 150.25 close —
    # 150.25 x 64 = 9616.00, exactly the sum of the tranche values (6611.00 + 3005.00).
    shared = next(d for d in days if d["vest_date"] == "2025-06-18")
    assert shared == {
        "vest_date": "2025-06-18",
        "is_past": True,
        "tranche_count": 2,
        "shares": 64,
        "fmv": "150.2500",
        "value": "9616.00",
        "value_is_estimate": False,
    }
    # A future day is an ESTIMATE at the latest quote and says so: 64 x 180 = 11520.00.
    future = next(d for d in days if d["vest_date"] == "2025-09-17")
    assert future == {
        "vest_date": "2025-09-17",
        "is_past": False,
        "tranche_count": 2,
        "shares": 64,
        "fmv": "180.0000",
        "value": "11520.00",
        "value_is_estimate": True,
    }
    # The per-grant breakdown is still the flat list the expansion reads from.
    shared_tranches = [v for v in body["vests"] if v["vest_date"] == "2025-06-18"]
    assert [(v["label"], v["shares"], v["value"]) for v in shared_tranches] == [
        ("Offer letter", 44, "6611.00"),
        ("2025 focal", 20, "3005.00"),
    ]


async def test_schedule_warns_once_per_date_for_past_vests_with_no_stored_bar(
    auth_client, priced_employer, frozen_schedule_today
):
    # Both grants vest on the same 2024-03-20 / 2024-06-19 grid, and both dates are older than
    # every stored bar: four unpriced vest rows, but only TWO warnings (deduped by date).
    await create_grant(
        auth_client,
        label="FY24 refresh",
        shares=160,
        cliff_pct="0.0625",
        first_vest_date="2024-03-20",
    )
    await create_grant(
        auth_client, label="Retention", shares=80, cliff_pct="0.0625", first_vest_date="2024-03-20"
    )
    body = (await auth_client.get(SCHEDULE)).json()

    assert body["warnings"] == [
        "vest on 2024-03-20 has no stored price — value unknown",
        "vest on 2024-06-19 has no stored price — value unknown",
    ]
    # Merged and sorted by (vest_date, grant_id): the same date ties break on insertion order.
    ids = [row["id"] for row in body["grants"]]
    assert [(v["vest_date"], v["grant_id"]) for v in body["vests"][:4]] == [
        ("2024-03-20", ids[0]),
        ("2024-03-20", ids[1]),
        ("2024-06-19", ids[0]),
        ("2024-06-19", ids[1]),
    ]
    assert [(v["fmv"], v["value"]) for v in body["vests"][:4]] == [(None, None)] * 4
    # The 2024-09-18 vests DO have a bar behind them (120.0000 x 10 and x 5).
    assert [v["value"] for v in body["vests"][4:6]] == ["1200.00", "600.00"]
    # The grouped row for an unpriced past day is honest the same way its tranches are:
    # shares are real, value is unknown — never a confident zero, never an estimate.
    unpriced_day = body["vest_days"][0]
    assert unpriced_day == {
        "vest_date": "2024-03-20",
        "is_past": True,
        "tranche_count": 2,
        "shares": 15,  # 10 + 5
        "fmv": None,
        "value": None,
        "value_is_estimate": False,
    }


async def test_schedule_tiles_price_the_future_at_the_latest_quote(
    auth_client, priced_employer, frozen_schedule_today
):
    await create_grant(auth_client)
    tiles = (await auth_client.get(SCHEDULE)).json()["tiles"]

    # The earliest vest still ahead of 2025-06-30, valued at the quote: 180 x 44 = 7920.00.
    assert tiles["next_vest"] == {"vest_date": "2025-09-17", "shares": 44, "est_value": "7920.00"}
    assert tiles["unvested_shares"] == 394  # 700 - 306 vested
    assert tiles["unvested_value"] == "70920.00"  # 180.0000 x 394
    # Only the 2025 vests already behind the frozen day: 2025-03-19 (44) and 2025-06-18 (44).
    assert tiles["vested_this_year_shares"] == 88
    assert tiles["vested_this_year_income"] == "12771.00"  # 6160.00 + 6611.00, at each FMV


async def test_schedule_vested_this_year_income_sums_only_the_priced_vests(
    auth_client, db, employer_ticker, frozen_schedule_today
):
    # One bar, covering the June vest but not the March one: the SHARES tile counts both, the
    # INCOME tile can only sum what has an FMV behind it.
    security = Security(ticker="NVDA", name="NVIDIA", holding_type="stock")
    db.add(security)
    await db.flush()
    db.add(
        PriceHistory(
            security_id=security.id, price_date=date(2025, 6, 18), close=Decimal("150.2500")
        )
    )
    await db.commit()
    await create_grant(auth_client)
    body = (await auth_client.get(SCHEDULE)).json()

    assert body["tiles"]["vested_this_year_shares"] == 88  # 2025-03-19: 44 + 2025-06-18: 44
    assert body["tiles"]["vested_this_year_income"] == "6611.00"  # 150.2500 x 44, June only
    assert "vest on 2025-03-19 has no stored price — value unknown" in body["warnings"]
    assert body["tiles"]["unvested_value"] is None  # no LatestPrice row behind the security


async def test_schedule_income_tile_is_null_when_nothing_in_year_is_priced(
    auth_client, db, employer_ticker, frozen_schedule_today
):
    # A ticker with a securities row but NO history at all. The tile reports null rather than a
    # confident 0.00 — the vests happened, their value is simply unknown, and the warnings say
    # which ones.
    db.add(Security(ticker="NVDA", name="NVIDIA", holding_type="stock"))
    await db.commit()
    await create_grant(auth_client)
    body = (await auth_client.get(SCHEDULE)).json()

    assert body["tiles"]["vested_this_year_shares"] == 88
    assert body["tiles"]["vested_this_year_income"] is None
    assert len(body["warnings"]) == 4  # one per unpriced past vest DATE, deduped


async def test_schedule_offers_a_seed_candidate_until_a_grant_claims_the_focal_year(
    auth_client, db, priced_employer, frozen_schedule_today
):
    await seed_focal_event(
        db, 2025, refresh_rsus=Decimal("500.0000"), grant_price=Decimal("118.2000")
    )
    # None of these can be seeded: no grant price, nothing granted, and a stored 0.0000 price
    # whose prefill the grant POST would 422 ("grant_price must be positive") — a dead end.
    await seed_focal_event(db, 2024, refresh_rsus=Decimal("400.0000"))
    await seed_focal_event(db, 2023, refresh_rsus=Decimal("0"), grant_price=Decimal("90.0000"))
    await seed_focal_event(db, 2022, refresh_rsus=Decimal("300.0000"), grant_price=Decimal("0"))

    body = (await auth_client.get(SCHEDULE)).json()
    assert body["seed_candidates"] == [
        {
            "focal_year": 2025,
            "shares": "500.0000",  # refresh_rsus verbatim at Numeric(12,4)
            "grant_price": "118.2000",
            "suggested_first_vest_date": "2025-06-18",  # 3rd Wednesday of that June
            "suggested_label": "2025 focal",
        }
    ]

    await create_grant(auth_client, label="2025 focal", focal_year=2025)
    assert (await auth_client.get(SCHEDULE)).json()["seed_candidates"] == []


async def test_schedule_flags_drift_between_a_grant_and_its_focal_history(
    auth_client, db, priced_employer, frozen_schedule_today
):
    await seed_focal_event(
        db, 2025, refresh_rsus=Decimal("500.0000"), grant_price=Decimal("118.2000")
    )
    created = await create_grant(
        auth_client, label="2025 focal", focal_year=2025, shares=480, grant_price="121.50"
    )
    body = (await auth_client.get(SCHEDULE)).json()
    assert body["drift_warnings"] == [
        "2025 focal grant (480 sh @ 121.5000) no longer matches "
        "focal history (500.0000 sh @ 118.2000)"
    ]
    assert body["warnings"] == []  # drift is a hint, not a degradation

    # Bring the grant back in line with the sheet and the hint retires itself.
    aligned = await auth_client.patch(
        f"{GRANTS}/{created['id']}", json={"shares": 500, "grant_price": "118.20"}
    )
    assert aligned.status_code == 200, aligned.text
    assert (await auth_client.get(SCHEDULE)).json()["drift_warnings"] == []


async def test_schedule_without_a_ticker_degrades_to_nulls_and_one_warning(
    auth_client, frozen_schedule_today
):
    # Every vest is ahead of the frozen day, so nothing is missing an FMV yet and the only
    # thing wrong with this payload is the unconfigured ticker.
    await create_grant(auth_client, first_vest_date="2026-06-17")
    resp = await auth_client.get(SCHEDULE)
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert (body["ticker"], body["latest_price"], body["quoted_at"]) == (None, None, None)
    assert body["warnings"] == [NO_TICKER]
    assert all(v["fmv"] is None and v["value"] is None for v in body["vests"])
    assert body["tiles"]["unvested_shares"] == 700
    assert body["tiles"]["unvested_value"] is None
    assert body["tiles"]["next_vest"] == {
        "vest_date": "2026-06-17",
        "shares": 175,
        "est_value": None,
    }


async def test_schedule_without_a_ticker_suppresses_the_per_vest_price_warnings(
    auth_client, frozen_schedule_today
):
    # Four past vests, none of them priceable — but with no ticker configured every one of
    # those lines would just restate the no-ticker warning, so exactly ONE warning survives
    # (Task 4 review). The per-date lines return the moment a ticker IS configured.
    await create_grant(auth_client)
    resp = await auth_client.get(SCHEDULE)
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["warnings"] == [NO_TICKER]
    assert body["tiles"]["vested_this_year_shares"] == 88
    assert body["tiles"]["vested_this_year_income"] is None
    assert all(v["fmv"] is None for v in body["vests"])


async def test_schedule_on_an_empty_database(auth_client, frozen_schedule_today):
    resp = await auth_client.get(SCHEDULE)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert (body["grants"], body["vests"]) == ([], [])
    assert body["tiles"] == {
        "next_vest": None,
        "unvested_shares": 0,
        "unvested_value": None,
        "vested_this_year_shares": 0,
        "vested_this_year_income": None,
    }
    assert (body["seed_candidates"], body["drift_warnings"]) == ([], [])
    assert body["warnings"] == [NO_TICKER]


async def test_schedule_skips_an_unschedulable_stored_grant_instead_of_failing(
    auth_client, db, priced_employer, frozen_schedule_today
):
    # Hand-written STRAIGHT to the table with a 30% cliff — `_validated_grant` rejects that
    # (it leaves 11.2 quarterly steps), so only a hand edit or a future writer bug can produce
    # it. The schedule endpoint must still answer 200 for the rest of the page.
    good = await create_grant(auth_client)
    db.add(
        RsuGrant(
            kind="refresh",
            label="hand-edited cliff",
            shares=100,
            grant_price=Decimal("45.1200"),
            first_vest_date=date(2024, 9, 18),
            cliff_pct=Decimal("0.3000"),
        )
    )
    await db.commit()

    resp = await auth_client.get(SCHEDULE)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["warnings"] == [
        "hand-edited cliff: stored grant cannot be scheduled — "
        "(1 - cliff_pct) must be a whole number of 6.25% steps"
    ]
    # Named and dropped: no echo, no vests — and the healthy grant is untouched.
    assert [row["label"] for row in body["grants"]] == ["Offer letter"]
    assert {v["grant_id"] for v in body["vests"]} == {good["id"]}
    assert body["tiles"]["unvested_shares"] == 394  # the bad grant's 100 are not counted


async def test_schedule_emits_the_zero_share_tranches_of_a_tiny_grant(
    auth_client, priced_employer, frozen_schedule_today
):
    # 5 shares over 16 vests floors most tranches to nothing. Those rows are REAL vest events
    # — the calendar renders them — so they stay in `vests[]` rather than being filtered out.
    await create_grant(auth_client, label="Tiny refresh", shares=5, cliff_pct="0.0625")
    body = (await auth_client.get(SCHEDULE)).json()

    assert len(body["vests"]) == 16
    assert [v["shares"] for v in body["vests"]] == [0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]
    # A priced zero-share vest is worth 0.00, not null: the FMV is known, the tranche is empty.
    assert (body["vests"][0]["fmv"], body["vests"][0]["value"]) == ("120.0000", "0.00")
    assert (body["vests"][3]["fmv"], body["vests"][3]["value"]) == ("150.2500", "150.25")
