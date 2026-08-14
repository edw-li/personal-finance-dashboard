from datetime import date
from decimal import Decimal

import pytest

from app.models import Account, AccountBalance, AppSetting, NetWorthSnapshot
from app.services.net_worth_calc import (
    INVESTABLE_GROUPS,
    get_swr_pct,
    group_totals_for,
    investable_base,
    load_balance_matrix,
    net_worth_for,
)


@pytest.fixture
async def nw_world(db):
    accounts = [
        Account(name="Checking", slug="checking", group="cash", sort_order=1),
        Account(name="Agg 401k", slug="agg-401k", group="pre_tax", sort_order=2),
        Account(
            name="Bucket 401k", slug="bucket-401k", group="pre_tax", sort_order=3, is_component=True
        ),
        Account(name="Brokerage", slug="brokerage", group="taxable", sort_order=4),
        Account(name="Card", slug="card", group="liability", sort_order=5),
    ]
    snaps = [
        NetWorthSnapshot(month=date(2026, 1, 1)),
        NetWorthSnapshot(month=date(2026, 2, 1)),
    ]
    db.add_all(accounts + snaps)
    await db.flush()
    values = {
        (0, 0): "100.00",
        (0, 1): "1000.00",
        (0, 2): "400.00",
        (0, 3): "500.00",
        (0, 4): "-50.00",
        (1, 0): "110.00",
        (1, 1): "1100.00",
        (1, 2): "440.00",
        (1, 3): "550.00",
        (1, 4): "-40.00",
    }
    for (s_i, a_i), balance in values.items():
        db.add(
            AccountBalance(
                snapshot_id=snaps[s_i].id, account_id=accounts[a_i].id, balance=Decimal(balance)
            )
        )
    await db.commit()
    return accounts, snaps


async def test_net_worth_excludes_components_and_sums_signed(db, nw_world):
    accounts, snaps = nw_world
    snapshots, accts, balances = await load_balance_matrix(db)
    assert [s.month for s in snapshots] == [date(2026, 1, 1), date(2026, 2, 1)]
    # 100 + 1000 + 500 - 50 (component 400 excluded; liability signed)
    assert net_worth_for(snapshots[0].id, accts, balances) == Decimal("1550.00")
    assert net_worth_for(snapshots[1].id, accts, balances) == Decimal("1720.00")


async def test_group_totals_zero_fill_and_exclude_components(db, nw_world):
    accounts, snaps = nw_world
    snapshots, accts, balances = await load_balance_matrix(db)
    totals = group_totals_for(snapshots[0].id, accts, balances)
    assert totals["pre_tax"] == Decimal("1000.00")  # component bucket excluded
    assert totals["liability"] == Decimal("-50.00")
    assert totals["equity"] == Decimal("0.00")  # every group present, zero-filled


async def test_investable_base_latest_snapshot_on_or_before(db, nw_world):
    # pre_tax(agg only) + taxable = 1000 + 500 @ Jan; 1100 + 550 @ Feb
    assert set(INVESTABLE_GROUPS) == {"pre_tax", "post_tax", "taxable", "equity"}
    assert await investable_base(db, date(2026, 1, 1)) == Decimal("1500.00")
    # A later spending month with no snapshot falls back to the latest prior one.
    assert await investable_base(db, date(2026, 3, 1)) == Decimal("1650.00")
    assert await investable_base(db, date(2025, 12, 1)) is None


async def test_get_swr_pct_reads_envelope_with_fallback(db):
    assert await get_swr_pct(db) == Decimal("0.04")  # unseeded -> default
    db.add(AppSetting(key="swr_pct", value={"value": 0.05}))
    await db.commit()
    assert await get_swr_pct(db) == Decimal("0.05")
    setting = await db.get(AppSetting, "swr_pct")
    setting.value = {"wrong": "shape"}  # envelope is convention-only (Plan 1 note)
    await db.commit()
    assert await get_swr_pct(db) == Decimal("0.04")
