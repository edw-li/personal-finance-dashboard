"""Living costs for the calendar's cash flow (2026-09-23 spec §B2; planning audit C1, trust
F19). Budgets in force win; otherwise the Spending page's "Previous 12 months" living
average; neither leaves the month out — absent is never zero."""

from datetime import date
from decimal import Decimal

import pytest

from app.models import CategoryBudget, MonthlySpending, SpendingCategory
from app.services.budgets import living_budget_total, living_budget_totals
from app.services.living_estimate import average_anchor, living_estimates, months_overlapping
from app.services.metrics import load_spending_metrics
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


def test_months_overlapping_and_the_average_anchor():
    assert months_overlapping(date(2026, 8, 15), date(2026, 10, 2)) == [AUG, SEP, OCT]
    assert months_overlapping(date(2026, 12, 20), date(2027, 1, 5)) == [
        date(2026, 12, 1),
        date(2027, 1, 1),
    ]
    assert months_overlapping(date(2026, 9, 10), date(2026, 9, 20)) == [SEP]
    assert average_anchor(date(2026, 7, 1), TODAY) == date(2026, 7, 1)
    assert average_anchor(SEP, TODAY) == SEP
    assert average_anchor(date(2027, 2, 1), TODAY) == SEP


async def test_budget_basis_sums_what_is_budgeted_even_when_coverage_is_partial(db):
    rent, _food, _taxes = await book(db, flat_year())
    db.add(CategoryBudget(category_id=rent.id, effective_month=SEP, amount=D("2100.00")))
    await db.commit()
    [estimate] = await living_estimates(db, SEP, date(2026, 9, 30), TODAY)
    # Food has no budget: the estimate is what the household budgeted, and says so.
    assert (estimate.month, estimate.amount, estimate.basis, estimate.months_in_average) == (
        SEP,
        D("2100.00"),
        "budget",
        None,
    )


async def test_a_budget_that_starts_mid_window_takes_over_from_the_average(db):
    rent, food, _taxes = await book(db, flat_year())
    db.add_all(
        [
            CategoryBudget(category_id=rent.id, effective_month=SEP, amount=D("2100.00")),
            CategoryBudget(category_id=food.id, effective_month=SEP, amount=D("550.00")),
        ]
    )
    await db.commit()
    estimates = await living_estimates(db, AUG, date(2026, 10, 31), TODAY)
    assert [(e.month, e.amount, e.basis, e.months_in_average) for e in estimates] == [
        # No budget in force in August: the twelve calendar months before it hold eleven
        # eligible ones (Aug 2025 was never entered), each 2,000 + 500.
        (AUG, D("2500.00"), "average", 11),
        (SEP, D("2650.00"), "budget", None),
        (OCT, D("2650.00"), "budget", None),
    ]


async def test_the_average_counts_living_only_and_the_months_it_read(db):
    spend = {month: ("2000.00", "500.00") for month in months_from(date(2026, 3, 1), 5)}
    await book(db, spend, tax="300.00")
    [estimate] = await living_estimates(db, AUG, date(2026, 8, 31), TODAY)
    # Five eligible months (fewer than twelve); tax paid from take-home is not living.
    assert (estimate.amount, estimate.basis, estimate.months_in_average) == (
        D("2500.00"),
        "average",
        5,
    )


async def test_no_budget_and_no_eligible_month_leaves_the_month_out(db):
    assert await living_estimates(db, AUG, date(2026, 10, 31), TODAY) == []
    # The in-progress month is not eligible, so its rows price nothing either.
    await book(db, {SEP: ("2000.00", "500.00")})
    assert await living_estimates(db, AUG, date(2026, 10, 31), TODAY) == []


async def test_future_months_read_the_latest_complete_year(db):
    spend = {month: ("2000.00", "500.00") for month in months_from(date(2025, 11, 1), 10)}
    spend |= {date(2025, 9, 1): ("3200.00", "500.00"), date(2025, 10, 1): ("3200.00", "500.00")}
    await book(db, spend)
    estimates = await living_estimates(db, OCT, date(2026, 12, 31), TODAY)
    # Every month still ahead reads the twelve before the CURRENT month, all eligible:
    # (2 x 3,700 + 10 x 2,500) / 12 = 2,700. A window anchored at November would have
    # dropped Sep and Oct 2025 for two months that have not happened yet.
    assert [(e.month, e.amount, e.basis, e.months_in_average) for e in estimates] == [
        (OCT, D("2700.00"), "average", 12),
        (date(2026, 11, 1), D("2700.00"), "average", 12),
        (date(2026, 12, 1), D("2700.00"), "average", 12),
    ]


async def test_a_budget_wins_over_an_average_for_the_same_month(db):
    _rent, food, _taxes = await book(db, flat_year())
    db.add(CategoryBudget(category_id=food.id, effective_month=SEP, amount=D("450.00")))
    await db.commit()
    [estimate] = await living_estimates(db, SEP, date(2026, 9, 30), TODAY)
    assert (estimate.amount, estimate.basis) == (D("450.00"), "budget")


async def test_the_average_is_the_spending_pages_previous_12_months_figure(db):
    spend = {
        month: ("2000.00", str(D("400.00") + 7 * index))
        for index, month in enumerate(months_from(date(2025, 9, 1), 12))
    }
    await book(db, spend)
    [estimate] = await living_estimates(db, AUG, date(2026, 8, 31), TODAY)
    metrics = await load_spending_metrics(db, AUG)
    assert estimate.amount == metrics.comparison.value
    assert estimate.months_in_average == len(metrics.comparison.window.included)
