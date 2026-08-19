from datetime import date
from decimal import Decimal

from pydantic import BaseModel


class ProjectionOut(BaseModel):
    # Echoed knobs — the values the model actually ran with (the ESPP modeler's posture:
    # the echo IS what the page's form seeds from).
    starting_balance: Decimal
    base_month: date  # the snapshot month the starting balance came from
    start_month: date  # the projection's t0 — the current calendar month
    annual_return: Decimal
    monthly_contribution: Decimal
    annual_spend: Decimal | None
    swr_pct: Decimal
    years: int
    # Derived headline figures — null whenever there is no spend/SWR to make a target of.
    fi_target: Decimal | None
    fi_ratio: Decimal | None
    fi_month: date | None
    coast_fi_month: date | None
    # Parallel arrays (GET /portfolio/history's posture): index i across all three lists
    # is one month.
    months: list[date]
    projected: list[Decimal]
    coast: list[Decimal]
    warnings: list[str]
