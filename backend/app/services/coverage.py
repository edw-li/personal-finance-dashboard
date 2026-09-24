"""The ONE definition of coverage (2026-09-04 honest-numbers spec §3).

A spending month is ENTERED when it has at least one non-zero amount OR a net-pay row.
A month whose rows are all $0.00 with no net pay is EMPTY — saved, but carrying nothing,
and it must never draw as a real $0 month. All-$0.00 rows BESIDE a net-pay row make an
entered month still worth naming (`zero_with_net_pay`): the take-home is real, the zeros
usually are not. A month inside the window with no rows and no net pay is MISSING.

The MISSING windows run from the first snapshot month to the newest month whose flows are
already overdue (`month_status.overdue_through`, 2026-09-23 spec §K3) — not to the latest
snapshot: the month in progress, an early next-month snapshot and a just-ended month still
inside its grace are not missing anything yet. Balances start the window because they are the
ritual's anchor: a month before them was never part of the book. What is DUE, and whether an
ended month's spending is complete (missing / partial / entered), is the month status that
rides along (`time`, `status`); `entered` here still counts a take-home-only month.

`GET /coverage`, three health checks and the budget seed read THIS module, so the footer, the
ribbon, the attention list and the Health card can never disagree about what "entered" means.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import MonthlyCashflow, MonthlySpending, NetWorthSnapshot
from app.schemas.coverage import TimeStatusOut
from app.services import clock
from app.services.month_review import ReviewBook
from app.services.month_status import MonthStatus, load_month_status, overdue_through
from app.services.read_cache import cached_review_book
from app.services.snapshot_state import snapshot_state


@dataclass(frozen=True)
class Coverage:
    """Every list ascending, first-of-month dates, one entry per month."""

    balances: list[date]
    entered: list[date]
    empty: list[date]
    # The same all-$0.00 rows, but WITH a take-home row beside them (2026-09-09 audit
    # item 1). Such a month is `entered` — a take-home figure is content — which is exactly
    # why the wizard's seeded zeros could ride in behind one and no card named them.
    zero_with_net_pay: list[date]
    missing: list[date]
    net_pay: list[date]
    net_pay_missing: list[date]
    # Take-home saved with no spending rows at all: entered, but nothing to average.
    net_pay_without_spending: list[date]
    # The monthly update's two parts, due and overdue (2026-09-23 spec §K3): the wire's `time`
    # (None on an empty book) and the service object behind it — lane T's reminder and health
    # checks ask it per month (`status.spending_state(month)`, the thresholds).
    time: TimeStatusOut | None = None
    status: MonthStatus | None = None


def _window(first: date, last: date | None) -> list[date]:
    """Every first-of-month from `first` to `last`, inclusive; empty when `last` is None or
    earlier than `first`."""
    if last is None or last < first:
        return []
    start = first.year * 12 + first.month - 1
    end = last.year * 12 + last.month - 1
    return [date(index // 12, index % 12 + 1, 1) for index in range(start, end + 1)]


def classify(
    balances: Sequence[date],
    spending: Mapping[date, bool],
    net_pay: Sequence[date],
    confirmed_zero: Sequence[date] = (),
    *,
    overdue_through: date | None,
) -> Coverage:
    """`spending` maps every month WITH rows to "does it carry a non-zero amount".

    `overdue_through` — month_status.overdue_through(today, reminder day) — ends the MISSING
    windows (spec §K3); None means nothing is overdue yet, so nothing can be missing."""
    pay = set(net_pay)
    confirmed = set(confirmed_zero)
    months = sorted(balances)
    window = _window(months[0], overdue_through) if months else []
    return Coverage(
        balances=months,
        entered=sorted({month for month, nonzero in spending.items() if nonzero} | pay | confirmed),
        empty=sorted(
            month
            for month, nonzero in spending.items()
            if not nonzero and month not in pay and month not in confirmed
        ),
        zero_with_net_pay=sorted(
            month
            for month, nonzero in spending.items()
            if not nonzero and month in pay and month not in confirmed
        ),
        missing=[month for month in window if month not in spending and month not in pay],
        net_pay=sorted(pay),
        net_pay_missing=[month for month in window if month not in pay],
        net_pay_without_spending=sorted(month for month in pay if month not in spending),
    )


async def load_coverage(
    db: AsyncSession, reviews: ReviewBook | None = None, *, today: date | None = None
) -> Coverage:
    """Aggregate raw feed presence, apply explicit zero confirmations from reviews, and compute
    the month status (spec §K3), whose `overdue_through` ends the missing windows.

    Callers that already loaded the review book pass it in to avoid repeating those reads — and
    then its day is the day: one request reads the product clock once, so the time status and
    the book it stands on never straddle midnight (review minor 7)."""
    today = today or (reviews.today if reviews else clock.product_today())
    snapshots = (
        await db.execute(
            select(
                NetWorthSnapshot.id, NetWorthSnapshot.month, NetWorthSnapshot.recorded_on
            ).order_by(NetWorthSnapshot.month)
        )
    ).all()
    spend_rows = (
        await db.execute(
            select(MonthlySpending.month, func.max(func.abs(MonthlySpending.amount))).group_by(
                MonthlySpending.month
            )
        )
    ).all()
    net_pay = list((await db.execute(select(MonthlyCashflow.month))).scalars().all())
    reviews = reviews or await cached_review_book(db, today=today)
    confirmed = [
        month
        for month, review in reviews.reviews.items()
        if review.zero_spending_confirmed
        and review.confirmation_revision == reviews.months[month].input_revision
    ]
    nonzero = {month: peak != 0 for month, peak in spend_rows}
    status = await load_month_status(
        db,
        today=today,
        reviews=reviews,
        snapshots=[snapshot_state(row.id, row.month, row.recorded_on, today) for row in snapshots],
        # K3's "spending": a non-zero amount or a confirmed zero — never take-home.
        spending={month for month, has_amount in nonzero.items() if has_amount} | set(confirmed),
        take_home=net_pay,
        empty_book=not (snapshots or spend_rows or net_pay),
    )
    found = classify(
        [row.month for row in snapshots],
        nonzero,
        net_pay,
        confirmed,
        overdue_through=overdue_through(today, status.reminder_day),
    )
    return replace(found, time=status.time(), status=status)
