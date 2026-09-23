"""Living costs for the calendar's cash flow (2026-09-23 spec §B2; planning audit C1, trust
F19). Budgets in force win; otherwise the Spending page's "Previous 12 months" living
average; neither leaves the month out — absent is never zero."""

from datetime import date
from decimal import Decimal

import pytest

from app.models import CategoryBudget, MonthlySpending, SpendingCategory
from app.services.budgets import living_budget_total, living_budget_totals
from app.services.month_review import adopt_existing_history, month_shift

TODAY = date(2026, 9, 23)
AUG, SEP, OCT = date(2026, 8, 1), date(2026, 9, 1), date(2026, 10, 1)
CALENDAR = "/api/v1/calendar"
D = Decimal


@pytest.fixture(autouse=True)
def frozen_today(monkeypatch):
    monkeypatch.setattr("app.services.clock.product_today", lambda: TODAY)


def months_from(first: date, count: int) -> list[date]:
    return [month_shift(first, offset) for offset in range(count)]


async def categories(db) -> tuple[SpendingCategory, SpendingCategory, SpendingCategory]:
    rent = SpendingCategory(name="Rent", slug="rent", sort_order=1)
    food = SpendingCategory(name="Food", slug="food", sort_order=2)
    taxes = SpendingCategory(name="Taxes", slug="taxes", sort_order=3, kind="tax")
    db.add_all([rent, food, taxes])
    await db.flush()
    return rent, food, taxes


async def book(db, spend: dict[date, tuple[str, str]], tax: str | None = None):
    """Rent and food per month (tax too, when given), adopted as history on TODAY so every
    month before September is legacy-eligible: the Spending page's own eligibility, no
    closing ritual needed."""
    rent, food, taxes = await categories(db)
    for month, (rent_amount, food_amount) in spend.items():
        db.add(MonthlySpending(month=month, category_id=rent.id, amount=D(rent_amount)))
        db.add(MonthlySpending(month=month, category_id=food.id, amount=D(food_amount)))
        if tax is not None:
            db.add(MonthlySpending(month=month, category_id=taxes.id, amount=D(tax)))
    await db.commit()
    await adopt_existing_history(db, TODAY)
    await db.commit()
    return rent, food, taxes


def flat_year() -> dict[date, tuple[str, str]]:
    """Sep 2025 – Aug 2026 at 2,000 rent + 500 food."""
    return {month: ("2000.00", "500.00") for month in months_from(date(2025, 9, 1), 12)}


async def test_living_budget_totals_is_the_single_month_read_for_many_months(db):
    rent, food, taxes = await categories(db)
    db.add_all(
        [
            CategoryBudget(category_id=rent.id, effective_month=SEP, amount=D("2000.00")),
            CategoryBudget(category_id=food.id, effective_month=OCT, amount=D("600.00")),
            # A tax target is not modeled spend (living_budget_total's rule).
            CategoryBudget(
                category_id=taxes.id, effective_month=date(2026, 1, 1), amount=D("900.00")
            ),
        ]
    )
    await db.commit()
    totals = await living_budget_totals(db, [OCT, AUG, SEP, SEP])
    assert totals == {AUG: None, SEP: D("2000.00"), OCT: D("2600.00")}
    for month in (AUG, SEP, OCT):
        assert await living_budget_total(db, month) == totals[month]
    # No months asked, nothing answered.
    assert await living_budget_totals(db, []) == {}
