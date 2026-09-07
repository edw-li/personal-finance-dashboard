"""Budget arithmetic — the ONE module (2026-09-07 budget-seed spec §1).

Three readers share it so they cannot drift: the spending matrix and the month GET resolve
budgets per month here; the Budget card's suggestions and the one-click seed take their
figures from `suggest`; the projection's "Use my budgets" echo sums the same resolution.
"""

from collections.abc import Sequence
from datetime import date
from decimal import Decimal

from app.models import CategoryBudget


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
