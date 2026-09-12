from datetime import UTC, date, datetime
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.models import AppSetting, LatestPrice, Person, PositionTransaction, RsuGrant, Security
from app.models.portfolio import AllocationTargetSet
from app.services import clock
from tests.portfolio_factories import acct

API = "/api/v1/portfolio"


async def book(db):
    stock = Security(ticker="ACME", name="Acme", industry="Technology", holding_type="stock")
    fund = Security(ticker="FUND", name="Fund", industry="ETF", holding_type="etf")
    missing = Security(ticker="GAP", name="No quote", holding_type="private")
    db.add_all([stock, fund, missing])
    await db.flush()
    for sec, shares in [(stock, "20"), (fund, "30"), (missing, "10")]:
        db.add(
            PositionTransaction(
                security_id=sec.id,
                portfolio_account=acct("Joint account"),
                type="buy",
                shares=Decimal(shares),
                price=Decimal("5"),
            )
        )
    for sec in [stock, fund]:
        db.add(
            LatestPrice(
                security_id=sec.id,
                price=Decimal("10"),
                quoted_at=datetime(2026, 9, 10, tzinfo=UTC),
                source="manual",
            )
        )
    await db.commit()
    return stock, fund, missing


async def test_unknown_classification_and_quote_coverage_stay_distinct(
    auth_client, db, forbid_writes
):
    await book(db)
    with forbid_writes():
        response = await auth_client.get(f"{API}/allocation?by=industry")
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["total_market_value"] == "500.00"
    assert [(s["key"], s["market_value"]) for s in data["slices"]] == [
        ("__unknown__", "300.00"),
        ("Technology", "200.00"),
    ]
    assert sum(Decimal(s["market_value"]) for s in data["slices"]) == Decimal("500")
    assert data["coverage"]["priced_count"] == 2
    assert data["coverage"]["holding_count"] == 3
    assert data["coverage"]["classified_weight_pct"] == "0.400000"
    assert data["coverage"]["unpriced_holdings"][0]["market_value"] is None
    assert data["coverage"]["unpriced_holdings"][0]["ticker"] == "GAP"
    assert data["slices"][0]["members"][0]["ticker"] == "FUND"
    assets = (await auth_client.get(f"{API}/allocation?by=asset_class")).json()
    assert {s["key"] for s in assets["slices"]} == {"equity", "__unknown__"}


async def test_reviewed_classification_survives_legacy_writes_and_can_be_undone(auth_client, db):
    stock, fund, _ = await book(db)
    response = await auth_client.patch(
        f"{API}/securities/{stock.id}/classification",
        json={
            "asset_class": "equity",
            "industry": "Semiconductors",
            "geography": "us",
            "note": "Annual report",
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["reviewed_at"] is not None
    assert response.json()["source"] == "User reviewed"
    batch = response.headers["X-Change-Batch"]
    undo = await auth_client.post(f"/api/v1/activity/batches/{batch}/undo")
    assert undo.status_code == 200, undo.text
    records = (await auth_client.get(f"{API}/classifications")).json()
    assert next(row for row in records if row["ticker"] == "ACME")["industry"] == "Technology"
    await auth_client.patch(
        f"{API}/securities/{stock.id}/classification",
        json={
            "asset_class": None,
            "industry": None,
            "geography": "international",
            "note": None,
        },
    )
    # Provider/import updates to the legacy security description must not erase a review.
    await auth_client.patch(
        f"{API}/securities/{stock.id}", json={"industry": "Changed by provider"}
    )
    records = (await auth_client.get(f"{API}/classifications")).json()
    actual = next(row for row in records if row["ticker"] == "ACME")
    assert actual["industry"] is None and actual["asset_class"] is None
    assert actual["geography"] == "international"
    invalid = await auth_client.patch(
        f"{API}/securities/{fund.id}/classification", json={"industry": "Technology"}
    )
    assert invalid.status_code == 422


@pytest.mark.parametrize(
    "targets",
    [
        [{"key": "equity", "target_pct": "99.9999"}],
        [{"key": "equity", "target_pct": "50"}, {"key": "equity", "target_pct": "50"}],
        [{"key": "equity", "target_pct": "100", "tolerance_pp": "-1"}],
        [{"key": "equity", "target_pct": "NaN"}],
        [{"key": "invalid", "target_pct": "100"}],
    ],
)
async def test_active_target_validation_has_no_partial_writes(auth_client, db, targets):
    response = await auth_client.put(
        f"{API}/allocation/targets?by=asset_class", json={"state": "active", "targets": targets}
    )
    assert response.status_code == 422, response.text
    assert list((await db.execute(select(AllocationTargetSet))).scalars()) == []


async def test_drafts_owner_scope_and_price_sensitive_drift(auth_client, db):
    stock, _, _ = await book(db)
    person = Person(name="Other owner", is_primary=False)
    db.add(person)
    await db.commit()
    draft = await auth_client.put(
        f"{API}/allocation/targets?by=asset_class",
        json={
            "state": "draft",
            "targets": [{"key": "equity", "target_pct": "55"}],
        },
    )
    assert draft.status_code == 200, draft.text
    before = (await auth_client.get(f"{API}/allocation?by=asset_class")).json()
    assert before["target_set"] is None and before["draft_target_set"] is not None
    active = await auth_client.put(
        f"{API}/allocation/targets?by=asset_class",
        json={
            "state": "active",
            "targets": [
                {"key": "equity", "target_pct": "50", "tolerance_pp": "5"},
                {"key": "__unknown__", "target_pct": "50"},
            ],
        },
    )
    assert active.status_code == 200, active.text
    data = (await auth_client.get(f"{API}/allocation?by=asset_class")).json()
    assert data["draft_target_set"] is None
    drift = {row["key"]: row for row in data["drift"]}
    assert drift["equity"]["drift_pp"] == "-10.0000"
    assert drift["equity"]["drift_amount"] == "-50.00"
    assert drift["equity"]["outside_tolerance"] is True
    assert drift["__unknown__"]["drift_amount"] is None  # GAP has no price in this category
    other = (await auth_client.get(f"{API}/allocation?by=asset_class&owner={person.id}")).json()
    assert other["target_set"] is None and other["scope_key"] == f"person:{person.id}"
    price = await db.get(LatestPrice, stock.id)
    price.price = Decimal("20")
    await db.commit()
    changed = (await auth_client.get(f"{API}/allocation?by=asset_class")).json()
    assert changed["total_market_value"] == "700.00"
    assert next(r for r in changed["drift"] if r["key"] == "equity")["drift_amount"] == "50.00"
    undo = await auth_client.post(
        f"/api/v1/activity/batches/{active.headers['X-Change-Batch']}/undo"
    )
    assert undo.status_code == 200, undo.text
    restored = (await auth_client.get(f"{API}/allocation?by=asset_class")).json()
    assert restored["target_set"] is None and restored["draft_target_set"] is not None


async def test_no_quote_cannot_create_zero_drift(auth_client, db):
    await book(db)
    save = await auth_client.put(
        f"{API}/allocation/targets?by=asset_class&owner=joint",
        json={
            "state": "active",
            "targets": [{"key": "equity", "target_pct": "100"}],
        },
    )
    assert save.status_code == 200, save.text
    # A new owner scope with a saved plan and no priced book is still unavailable.
    for price in (await db.execute(select(LatestPrice))).scalars():
        await db.delete(price)
    await db.commit()
    data = (await auth_client.get(f"{API}/allocation?by=asset_class&owner=joint")).json()
    assert data["total_market_value"] == "0.00"
    assert data["drift"] and all(row["drift_amount"] is None for row in data["drift"])


async def test_employer_awards_do_not_enter_the_portfolio_denominator(auth_client, db, monkeypatch):
    await book(db)
    monkeypatch.setattr(clock, "product_today", lambda: date(2026, 9, 12))
    db.add(AppSetting(key="espp_ticker", value={"value": "ACME"}))
    db.add(
        RsuGrant(
            kind="refresh",
            label="Future award",
            shares=100,
            grant_price=Decimal("8"),
            first_vest_date=date(2027, 3, 17),
            cliff_pct=Decimal("0.0625"),
            vest_quantum=1,
        )
    )
    await db.commit()
    data = (await auth_client.get(f"{API}/employer-exposure")).json()
    assert data["held_value"] == "200.00"
    assert data["unvested_value"] == "1000.00"
    assert data["unvested_shares"] == 100
    assert data["priced_portfolio_value"] == "500.00"
    assert data["held_weight_pct"] == "0.400000"
    assert "not owner-tagged" in data["unvested_scope"]
