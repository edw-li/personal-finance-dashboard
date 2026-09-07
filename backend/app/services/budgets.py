"""Budget arithmetic — the ONE module (2026-09-07 budget-seed spec §1).

Three readers share it so they cannot drift: the spending matrix and the month GET resolve
budgets per month here; the Budget card's suggestions and the one-click seed take their
figures from `suggest`; the projection's "Use my budgets" echo sums the same resolution.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from decimal import ROUND_CEILING, ROUND_HALF_UP, Decimal
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import CategoryBudget, MonthlySpending, SpendingCategory
from app.services.coverage import load_coverage
from app.services.savings import LIVING


def resolve_budgets(
    rows: Sequence[CategoryBudget], months: Sequence[date]
) -> dict[int, list[Decimal | None]]:
    """Per category, the resolved budget for each month: the amount of the row with the
    greatest effective_month <= month (2026-08-24 spec §2). `months` must be ascending (the
    matrix's order); one sorted walk per category, zero extra queries — the table is tiny."""
    by_category: dict[int, list[CategoryBudget]] = {}
    for row in rows:
        by_category.setdefault(row.category_id, []).append(row)
    resolved: dict[int, list[Decimal | None]] = {}
    for category_id, history in by_category.items():
        history.sort(key=lambda r: r.effective_month)
        values: list[Decimal | None] = []
        pointer = 0
        current: Decimal | None = None
        for month in months:
            while pointer < len(history) and history[pointer].effective_month <= month:
                current = history[pointer].amount
                pointer += 1
            values.append(current)
        resolved[category_id] = values
    return resolved


# The seed's vocabulary (spec §1). The window is COMPLETE months only — the 2026-09-07 preview
# found the seven-day-old current month inside an "entered months" window, dragging every mean
# down a twelfth and handing nine categories a fake $0 minimum.
SEED_WINDOW_MONTHS = 12
MIN_SEED_MONTHS = 3
FIXED_CV = Decimal("0.10")
CENTS = Decimal("0.01")
CV_QUANTUM = Decimal("0.0001")

Profile = Literal["dormant", "sparse", "fixed", "episodic", "variable"]
SkipReason = Literal["kind", "dormant", "sparse"]


def seed_window(
    entered: Sequence[date],
    without_spending: Sequence[date],
    current_month: date,
    limit: int = SEED_WINDOW_MONTHS,
) -> list[date]:
    """The months the averages read: the last `limit` months strictly before `current_month`
    that are entered (coverage's ONE definition) and carry spending rows — a take-home-only
    month has nothing to average, and an empty month is not entered at all."""
    skip = set(without_spending)
    complete = [month for month in sorted(entered) if month < current_month and month not in skip]
    # `complete[-0:]` is the WHOLE list, so a zero limit has to be spelled out.
    return complete[-limit:] if limit > 0 else []


def ceil_dollars(value: Decimal) -> Decimal:
    """A target reads as a chosen number: up to the next whole dollar, spelled in cents — a
    fixed cost never shows "over by $0.80"."""
    return value.to_integral_value(rounding=ROUND_CEILING).quantize(CENTS)


def _median(values: Sequence[Decimal]) -> Decimal:
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2


@dataclass(frozen=True)
class Suggestion:
    category_id: int
    profile: Profile
    months: int  # window months that carry a row for this category (absent ≠ zero)
    mean: Decimal | None  # cents, HALF_UP
    median: Decimal | None  # cents, HALF_UP
    latest: Decimal | None  # the last window month with a row
    latest_month: date | None
    # Sample standard deviation ÷ mean, 4 dp; None under two months or at mean <= 0.
    cv: Decimal | None
    seed: Decimal | None  # whole dollars in cents; None when skipped
    skip_reason: SkipReason | None


def suggest(category_id: int, kind: str, series: Sequence[tuple[date, Decimal]]) -> Suggestion:
    """`series` = (month, amount) for every WINDOW month where the category has a row,
    ascending. The profile order is the spec's table: dormant, sparse, fixed, episodic,
    variable. A non-living kind keeps its figures for the chips but never a seed."""
    n = len(series)
    if n == 0:
        reason: SkipReason = "kind" if kind != LIVING else "dormant"
        return Suggestion(
            category_id=category_id,
            profile="dormant",
            months=0,
            mean=None,
            median=None,
            latest=None,
            latest_month=None,
            cv=None,
            seed=None,
            skip_reason=reason,
        )
    amounts = [amount for _, amount in series]
    mean_exact = sum(amounts, Decimal(0)) / n
    latest_month, latest = series[-1]
    cv: Decimal | None = None
    if n >= 2 and mean_exact > 0:
        variance = sum(((a - mean_exact) ** 2 for a in amounts), Decimal(0)) / (n - 1)
        cv = (variance.sqrt() / mean_exact).quantize(CV_QUANTUM, rounding=ROUND_HALF_UP)
    median = _median(amounts)
    profile: Profile
    if mean_exact <= 0:
        profile = "dormant"
    elif n < MIN_SEED_MONTHS:
        profile = "sparse"
    elif cv is not None and cv < FIXED_CV:
        profile = "fixed"
    elif median == 0:
        profile = "episodic"
    else:
        profile = "variable"
    seed: Decimal | None
    skip: SkipReason | None
    if kind != LIVING:
        seed, skip = None, "kind"
    elif profile in ("dormant", "sparse"):
        seed, skip = None, profile
    else:
        # A fixed cost seeds from where it IS (the mean lags a step up: production's rent);
        # everything else seeds the mean, which conserves the annual total for modeling.
        seed, skip = ceil_dollars(latest if profile == "fixed" else mean_exact), None
    return Suggestion(
        category_id=category_id,
        profile=profile,
        months=n,
        mean=mean_exact.quantize(CENTS, rounding=ROUND_HALF_UP),
        median=median.quantize(CENTS, rounding=ROUND_HALF_UP),
        latest=latest,
        latest_month=latest_month,
        cv=cv,
        seed=seed,
        skip_reason=skip,
    )


# --- the database-facing half: everything above is arithmetic a test can hand a list to ---


async def load_suggestions(db: AsyncSession, today: date) -> tuple[list[date], list[Suggestion]]:
    """The window and one Suggestion per ACTIVE category (the card lists only those), in the
    categories' own order. One coverage load (spec §3's ONE definition of entered), one
    categories query, one spending query bounded to the window."""
    coverage = await load_coverage(db)
    window = seed_window(coverage.entered, coverage.net_pay_without_spending, today.replace(day=1))
    categories = list(
        (
            await db.execute(
                select(SpendingCategory)
                .where(SpendingCategory.is_active)
                .order_by(SpendingCategory.sort_order, SpendingCategory.id)
            )
        )
        .scalars()
        .all()
    )
    by_category: dict[int, list[tuple[date, Decimal]]] = {c.id: [] for c in categories}
    if window:
        in_window = set(window)  # the window can straddle a gap month: bound, then filter
        rows = (
            await db.execute(
                select(MonthlySpending)
                .where(MonthlySpending.month >= window[0], MonthlySpending.month <= window[-1])
                .order_by(MonthlySpending.month)
            )
        ).scalars()
        for row in rows:
            if row.month in in_window and row.category_id in by_category:
                by_category[row.category_id].append((row.month, row.amount))
    return window, [suggest(c.id, c.kind, by_category[c.id]) for c in categories]


async def living_budget_total(db: AsyncSession, month: date) -> Decimal | None:
    """The ACTIVE living categories' budgets resolved for `month`, summed (spec §4) — an
    archived category's stale budget and a tax or transfer target are not modeled spend.
    None when no such category has a budget that month."""
    living_ids = set(
        (
            await db.execute(
                select(SpendingCategory.id).where(
                    SpendingCategory.is_active, SpendingCategory.kind == LIVING
                )
            )
        )
        .scalars()
        .all()
    )
    rows = [
        row
        for row in (await db.execute(select(CategoryBudget))).scalars()
        if row.category_id in living_ids
    ]
    amounts = [
        values[0] for values in resolve_budgets(rows, [month]).values() if values[0] is not None
    ]
    return sum(amounts, Decimal("0.00")) if amounts else None
