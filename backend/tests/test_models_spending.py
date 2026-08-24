from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models import CategoryBudget, MonthlyCashflow, MonthlySpending, SpendingCategory


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


async def test_category_budget_roundtrip_nullable_amount_and_unique(db):
    cat = SpendingCategory(name="Food", slug="food", sort_order=1)
    db.add(cat)
    await db.flush()
    db.add(
        CategoryBudget(
            category_id=cat.id, effective_month=date(2026, 3, 1), amount=Decimal("400.00")
        )
    )
    # NULL amount is the dated "budget ends here" marker (spec §2) — it must store.
    db.add(CategoryBudget(category_id=cat.id, effective_month=date(2026, 6, 1), amount=None))
    await db.commit()
    rows = (
        (await db.execute(select(CategoryBudget).order_by(CategoryBudget.effective_month)))
        .scalars()
        .all()
    )
    assert [(r.effective_month, r.amount) for r in rows] == [
        (date(2026, 3, 1), Decimal("400.00")),
        (date(2026, 6, 1), None),
    ]
    db.add(
        CategoryBudget(category_id=cat.id, effective_month=date(2026, 3, 1), amount=Decimal("1"))
    )
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()


async def test_category_budget_first_of_month_check(db):
    cat = SpendingCategory(name="Travel", slug="travel", sort_order=2)
    db.add(cat)
    await db.flush()
    db.add(
        CategoryBudget(category_id=cat.id, effective_month=date(2026, 3, 15), amount=Decimal("1"))
    )
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()


async def test_category_budget_cascades_with_its_category(db):
    cat = SpendingCategory(name="Pets", slug="pets", sort_order=3)
    db.add(cat)
    await db.flush()
    db.add(
        CategoryBudget(
            category_id=cat.id, effective_month=date(2026, 1, 1), amount=Decimal("50.00")
        )
    )
    await db.commit()
    await db.delete(cat)
    await db.commit()
    assert (await db.execute(select(CategoryBudget))).scalars().all() == []
