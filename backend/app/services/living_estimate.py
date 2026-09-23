"""Living costs for the calendar's cash flow (2026-09-23 spec §B2; planning audit C1, trust
F19).

The calendar only knows DATED money (paydays, fees, tax deadlines), so September read
"Net +$8,274.22" with ≈$5.4K of living spending about to leave. This prices that spending per
month from two figures the household already has, and nothing new:

  * `budget`: the living budgets in force that month, summed (budgets.living_budget_totals,
    the Spending page's own resolution and the projection's "Use my budgets" figure);
  * `average`: otherwise the Spending page's "Previous 12 months" living average
    (metrics.average_evidence: the same eligibility, the same fixed calendar window, the same
    cents), anchored at the month itself, or at the CURRENT month for a month not yet
    started, so every future month reads the latest complete year instead of a window whose
    newest months have not happened;
  * neither: the month is absent. Absent is not zero; the strip says there is no estimate.

Reads only. The review book is loaded only when some month has no budget in force.
"""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Literal

from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.metrics import MetricEvidence
from app.services.budgets import living_budget_totals
from app.services.metrics import average_evidence
from app.services.month_review import month_shift
from app.services.paycheck_calc import half_up2
from app.services.read_cache import cached_month_savings, cached_review_book

LivingBasis = Literal["budget", "average"]


@dataclass(frozen=True)
class LivingEstimate:
    month: date
    # Exactly 2 dp, half-up, whatever the source carried: the client's toCents refuses any
    # other shape rather than guess (2026-09-23 lane B1 review, M12).
    amount: Decimal
    basis: LivingBasis
    # How many eligible months the mean read (1–12); None on a budget.
    months_in_average: int | None


def months_overlapping(start: date, end: date) -> list[date]:
    """The first of every calendar month [start, end] touches, ascending."""
    first, last = start.replace(day=1), end.replace(day=1)
    count = (last.year - first.year) * 12 + last.month - first.month + 1
    return [month_shift(first, offset) for offset in range(count)]


def average_anchor(month: date, today: date) -> date:
    """The month whose "Previous 12 months" window prices `month`: itself, or the current
    month for one still ahead. A future window's newest months are not complete, and older
    months never slide in to replace them (metrics.window_rows' rule)."""
    return min(month, today.replace(day=1))


async def living_estimates(
    db: AsyncSession, start: date, end: date, today: date
) -> list[LivingEstimate]:
    """One estimate per month [start, end] touches, ascending; a month with neither a
    budget in force nor an eligible month to average is left out."""
    months = months_overlapping(start, end)
    budgets = await living_budget_totals(db, months)
    unbudgeted = [month for month in months if budgets[month] is None]
    averages: dict[date, MetricEvidence] = {}
    if unbudgeted:
        # The Spending page's own read path, through the read cache (2026-09-23 spec §P4): the
        # same book and savings the metrics GETs read, built once per data version — so the
        # Calendar's unbudgeted months and the assistant's context no longer rebuild them.
        book = await cached_review_book(db, today=today)
        rows = await cached_month_savings(db)
        for anchor in sorted({average_anchor(month, today) for month in unbudgeted}):
            averages[anchor] = average_evidence(rows, book, anchor)
    estimates: list[LivingEstimate] = []
    for month in months:
        budget = budgets[month]
        if budget is not None:
            estimates.append(LivingEstimate(month, half_up2(budget), "budget", None))
            continue
        evidence = averages[average_anchor(month, today)]
        if evidence.value is None or evidence.window is None:
            continue
        estimates.append(
            LivingEstimate(
                month, half_up2(evidence.value), "average", len(evidence.window.included)
            )
        )
    return estimates
