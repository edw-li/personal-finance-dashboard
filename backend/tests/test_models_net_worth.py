from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models import Account, AccountBalance, NetWorthSnapshot


async def test_balance_roundtrip(db):
    acct = Account(
        name="Wells Fargo Checking", slug="wells-fargo-checking", group="cash", sort_order=1
    )
    snap = NetWorthSnapshot(month=date(2023, 9, 1), recorded_on=date(2023, 9, 24))
    db.add_all([acct, snap])
    await db.flush()
    db.add(AccountBalance(snapshot_id=snap.id, account_id=acct.id, balance=Decimal("14512.34")))
    await db.commit()
    bal = (await db.execute(select(AccountBalance))).scalar_one()
    assert bal.balance == Decimal("14512.34")


async def test_one_balance_per_account_per_snapshot(db):
    acct = Account(name="A", slug="a", group="cash", sort_order=1)
    snap = NetWorthSnapshot(month=date(2024, 1, 1))
    db.add_all([acct, snap])
    await db.flush()
    db.add(AccountBalance(snapshot_id=snap.id, account_id=acct.id, balance=Decimal("1")))
    await db.commit()
    db.add(AccountBalance(snapshot_id=snap.id, account_id=acct.id, balance=Decimal("2")))
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()


async def test_snapshot_month_unique(db):
    db.add(NetWorthSnapshot(month=date(2024, 1, 1)))
    await db.commit()
    db.add(NetWorthSnapshot(month=date(2024, 1, 1)))
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()
