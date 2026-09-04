"""The ONE definition of coverage (2026-09-04 honest-numbers spec §3).

A spending month is ENTERED when it has at least one non-zero amount OR a net-pay row.
A month whose rows are all $0.00 with no net pay is EMPTY — saved, but carrying nothing,
and it must never draw as a real $0 month. A month inside the window with no rows and no
net pay is MISSING. The window is the balances coverage (first snapshot month … latest
snapshot month): balances are the ritual's anchor, so a month outside them was never part
of the book and cannot be "missing" from it.

`GET /coverage` and three health checks read THIS module, so the footer, the ribbon, the
attention list and the Health card can never disagree about what "entered" means.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import MonthlyCashflow, MonthlySpending, NetWorthSnapshot


@dataclass(frozen=True)
class Coverage:
    """Every list ascending, first-of-month dates, one entry per month."""

    balances: list[date]
    entered: list[date]
    empty: list[date]
    missing: list[date]
    net_pay: list[date]
    net_pay_missing: list[date]
    # Take-home saved with no spending rows at all: entered, but nothing to average.
    net_pay_without_spending: list[date]


def _window(balances: Sequence[date]) -> list[date]:
    """Every first-of-month from the first snapshot to the last, inclusive."""
    if not balances:
        return []
    start = balances[0].year * 12 + balances[0].month - 1
    end = balances[-1].year * 12 + balances[-1].month - 1
    return [date(index // 12, index % 12 + 1, 1) for index in range(start, end + 1)]


def classify(
    balances: Sequence[date], spending: Mapping[date, bool], net_pay: Sequence[date]
) -> Coverage:
    """`spending` maps every month WITH rows to "does it carry a non-zero amount"."""
    pay = set(net_pay)
    months = sorted(balances)
    window = _window(months)
    return Coverage(
        balances=months,
        entered=sorted({month for month, nonzero in spending.items() if nonzero} | pay),
        empty=sorted(
            month for month, nonzero in spending.items() if not nonzero and month not in pay
        ),
        missing=[month for month in window if month not in spending and month not in pay],
        net_pay=sorted(pay),
        net_pay_missing=[month for month in window if month not in pay],
        net_pay_without_spending=sorted(month for month in pay if month not in spending),
    )


async def load_coverage(db: AsyncSession) -> Coverage:
    """One query per table (spec §3). The spending query carries the month's peak
    |amount| so "entered" is decided in SQL's own words, not by loading every row."""
    balances = list((await db.execute(select(NetWorthSnapshot.month).distinct())).scalars().all())
    spend_rows = (
        await db.execute(
            select(MonthlySpending.month, func.max(func.abs(MonthlySpending.amount))).group_by(
                MonthlySpending.month
            )
        )
    ).all()
    net_pay = list((await db.execute(select(MonthlyCashflow.month))).scalars().all())
    return classify(balances, {month: peak != 0 for month, peak in spend_rows}, net_pay)
