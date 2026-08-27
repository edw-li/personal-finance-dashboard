from datetime import date
from decimal import Decimal

import pytest

from app.models import Account, AccountBalance, AppSetting, NetWorthSnapshot, Person
from app.services.net_worth_calc import (
    INVESTABLE_GROUPS,
    JOINT,
    get_swr_pct,
    group_totals_for,
    investable_base,
    investable_bases,
    load_balance_matrix,
    net_worth_for,
    owner_clause,
    owner_totals_for,
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
    # Decimal("NaN")/"1e100000" construct without raising — must fall back, not leak.
    setting.value = {"value": "NaN"}
    await db.commit()
    assert await get_swr_pct(db) == Decimal("0.04")
    setting.value = {"value": "1e100000"}
    await db.commit()
    assert await get_swr_pct(db) == Decimal("0.04")
    setting.value = {"value": 2}  # a withdrawal rate above 1 is nonsense
    await db.commit()
    assert await get_swr_pct(db) == Decimal("0.04")


async def test_investable_bases_matches_the_per_month_helper(db, nw_world):
    months = [
        date(2025, 12, 1),  # before the first snapshot -> None
        date(2026, 1, 1),  # exactly ON a snapshot month (<=, not <)
        date(2026, 2, 1),  # the later snapshot
        date(2026, 3, 1),  # after the last -> latest prior carries forward
    ]
    batched = await investable_bases(db, months)
    assert batched == [await investable_base(db, month) for month in months]
    assert batched == [None, Decimal("1500.00"), Decimal("1650.00"), Decimal("1650.00")]
    assert await investable_bases(db, []) == []


async def test_investable_bases_without_snapshots_and_with_an_empty_one(db):
    assert await investable_bases(db, [date(2026, 1, 1)]) == [None]
    # A snapshot with NO investable balances sums to zero, exactly as the per-month
    # helper's coalesce(0) does — the grouped query omits it, the .get default covers it.
    db.add(NetWorthSnapshot(month=date(2026, 1, 1)))
    await db.commit()
    batched = await investable_bases(db, [date(2026, 1, 1)])
    assert batched == [await investable_base(db, date(2026, 1, 1))]
    assert batched == [Decimal("0")]


# --- ownership views (2026-08-26 household spec §5.2) -------------------------------------


@pytest.fixture
async def owned_world(db):
    """One account per ownership kind plus a component, in a single snapshot.

    The component belongs to the partner and is deliberately fat (400) — every rollup here
    excludes it, so any number that moves by 400 is a rollup that forgot the exclusion.
    """
    me = Person(name="Me", is_primary=True)
    partner = Person(name="Sam", is_primary=False)
    db.add_all([me, partner])
    await db.flush()
    mine = Account(
        name="My Checking", slug="my-checking", group="cash", sort_order=1, person_id=me.id
    )
    theirs = Account(
        name="Sam 401k", slug="sam-401k", group="pre_tax", sort_order=2, person_id=partner.id
    )
    bucket = Account(
        name="Sam 401k Bucket",
        slug="sam-401k-bucket",
        group="pre_tax",
        sort_order=3,
        is_component=True,
        person_id=partner.id,
    )
    joint = Account(
        name="Joint Savings", slug="joint-savings", group="cash", sort_order=4, person_id=None
    )
    snap = NetWorthSnapshot(month=date(2026, 8, 1))
    db.add_all([mine, theirs, bucket, joint, snap])
    await db.flush()
    for account, value in (
        (mine, "100.00"),
        (theirs, "1000.00"),
        (bucket, "400.00"),
        (joint, "70.00"),
    ):
        db.add(AccountBalance(snapshot_id=snap.id, account_id=account.id, balance=Decimal(value)))
    await db.commit()
    return me, partner, snap


async def test_person_view_is_owned_plus_joint(db, owned_world):
    me, _partner, snap = owned_world
    _snaps, accounts, balances = await load_balance_matrix(db, owner_clause(str(me.id)))
    assert [a.slug for a in accounts] == ["my-checking", "joint-savings"]
    # "Primary holder + spouse secondary" is what a joint account IS: my view is mine AND ours.
    assert net_worth_for(snap.id, accounts, balances) == Decimal("170.00")
    assert group_totals_for(snap.id, accounts, balances)["cash"] == Decimal("170.00")


async def test_joint_view_is_null_owned_only(db, owned_world):
    _me, _partner, snap = owned_world
    _snaps, accounts, balances = await load_balance_matrix(db, owner_clause(JOINT))
    assert [a.slug for a in accounts] == ["joint-savings"]
    assert net_worth_for(snap.id, accounts, balances) == Decimal("70.00")


async def test_partner_view_excludes_their_own_component(db, owned_world):
    _me, partner, snap = owned_world
    _snaps, accounts, balances = await load_balance_matrix(db, owner_clause(str(partner.id)))
    assert [a.slug for a in accounts] == ["sam-401k", "sam-401k-bucket", "joint-savings"]
    # 1000 + 70; the 400 component is listed but never counted.
    assert net_worth_for(snap.id, accounts, balances) == Decimal("1070.00")


async def test_absent_owner_loads_the_whole_household(db, owned_world):
    _me, _partner, snap = owned_world
    _snaps, accounts, balances = await load_balance_matrix(db)
    assert len(accounts) == 4
    assert net_worth_for(snap.id, accounts, balances) == Decimal("1170.00")


async def test_owner_totals_are_disjoint_and_sum_to_net_worth(db, owned_world):
    me, partner, snap = owned_world
    _snaps, accounts, balances = await load_balance_matrix(db)
    totals = owner_totals_for(snap.id, accounts, balances)
    # Each account counted ONCE, under its stored owner; None is the Joint bucket.
    assert totals == {
        me.id: Decimal("100.00"),
        partner.id: Decimal("1000.00"),
        None: Decimal("70.00"),
    }
    assert sum(totals.values()) == net_worth_for(snap.id, accounts, balances)


def test_owner_clause_rejects_anything_that_is_not_an_id_or_joint():
    for bad in ("", "nobody", "-1", "0", "1.5", "1e3", " 1", "99999999999", "²"):
        with pytest.raises(ValueError):
            owner_clause(bad)
