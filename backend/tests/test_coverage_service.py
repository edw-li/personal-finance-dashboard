"""The one entered/empty/missing definition (2026-09-04 honest-numbers spec §3)."""

from datetime import date
from decimal import Decimal

from app.models import MonthlyCashflow, MonthlySpending, NetWorthSnapshot, SpendingCategory
from app.services.coverage import classify, load_coverage

D = Decimal


def test_classify_sorts_months_into_entered_empty_and_missing():
    balances = [date(2026, 5, 1), date(2026, 1, 1)]  # unsorted on purpose; window Jan..May
    spending = {
        date(2026, 1, 1): True,  # real amounts
        date(2026, 2, 1): False,  # rows, all $0.00, no take-home -> EMPTY
        date(2026, 3, 1): False,  # rows, all $0.00, but take-home entered -> ENTERED
        date(2026, 5, 1): True,
    }
    net_pay = [date(2026, 3, 1), date(2026, 5, 1), date(2026, 6, 1)]
    found = classify(balances, spending, net_pay)
    assert found.balances == [date(2026, 1, 1), date(2026, 5, 1)]
    assert found.entered == [
        date(2026, 1, 1),
        date(2026, 3, 1),
        date(2026, 5, 1),
        date(2026, 6, 1),  # take-home alone is enough to call a month entered
    ]
    assert found.empty == [date(2026, 2, 1)]
    assert found.missing == [date(2026, 4, 1)]  # inside the window, nothing at all on file
    assert found.net_pay_missing == [date(2026, 1, 1), date(2026, 2, 1), date(2026, 4, 1)]
    # June: pay saved alone. Entered, but there is no spend to average — the health card
    # names it so it cannot masquerade as a frugal month (spec §6).
    assert found.net_pay_without_spending == [date(2026, 6, 1)]


def test_classify_without_balances_has_no_window_to_call_anything_missing():
    found = classify([], {date(2026, 2, 1): True}, [date(2026, 3, 1)])
    assert found.missing == [] and found.net_pay_missing == []
    assert found.entered == [date(2026, 2, 1), date(2026, 3, 1)]


async def test_load_coverage_classifies_what_the_tables_hold(db):
    cat = SpendingCategory(name="Rent", slug="rent", sort_order=1)
    db.add(cat)
    await db.flush()
    db.add_all(
        [
            NetWorthSnapshot(month=date(2026, 1, 1)),
            NetWorthSnapshot(month=date(2026, 4, 1)),
            MonthlySpending(month=date(2026, 1, 1), category_id=cat.id, amount=D("1200.00")),
            # A refund-only month is still ENTERED: non-zero is non-zero, sign and all.
            MonthlySpending(month=date(2026, 2, 1), category_id=cat.id, amount=D("-50.00")),
            MonthlySpending(month=date(2026, 4, 1), category_id=cat.id, amount=D("0.00")),
            MonthlyCashflow(month=date(2026, 1, 1), net_pay=D("8000.00")),
        ]
    )
    await db.commit()
    found = await load_coverage(db)
    assert found.entered == [date(2026, 1, 1), date(2026, 2, 1)]
    assert found.empty == [date(2026, 4, 1)]
    assert found.missing == [date(2026, 3, 1)]
    assert found.net_pay == [date(2026, 1, 1)]
    assert found.net_pay_missing == [date(2026, 2, 1), date(2026, 3, 1), date(2026, 4, 1)]
    assert found.net_pay_without_spending == []
