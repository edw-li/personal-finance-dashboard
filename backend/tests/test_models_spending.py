from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models import MonthlyCashflow, MonthlySpending, SpendingCategory


async def test_spending_roundtrip(db):
    cat = SpendingCategory(name="Food & Dining", slug="food-dining", sort_order=8)
    db.add(cat)
    await db.flush()
    db.add(MonthlySpending(month=date(2023, 8, 1), category_id=cat.id, amount=Decimal("252.37")))
    db.add(MonthlyCashflow(month=date(2023, 8, 1), net_pay=Decimal("5000.00")))
    await db.commit()
    row = (await db.execute(select(MonthlySpending))).scalar_one()
    assert row.amount == Decimal("252.37")


async def test_one_amount_per_category_per_month(db):
    cat = SpendingCategory(name="Travel", slug="travel", sort_order=19)
    db.add(cat)
    await db.flush()
    db.add(MonthlySpending(month=date(2024, 2, 1), category_id=cat.id, amount=Decimal("1")))
    await db.commit()
    db.add(MonthlySpending(month=date(2024, 2, 1), category_id=cat.id, amount=Decimal("2")))
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()
