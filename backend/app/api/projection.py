"""Projection API — the FIRE module (post-roadmap feature; nothing here is stored).

One computed GET in the ESPP-modeler shape: what-if knobs arrive as query params, every
knob NOT provided is seeded from the data the app already holds — the latest investable
balance (net_worth_calc's own rule, the 4%-line's base), the trailing-12 mean of
(net pay − spend) as the contribution, the trailing-12 mean spend ×12 as the annual
spend, and the stored SWR — and the response echoes the values actually used, so the
page's form seeds from the echo.

`date.today()` is read HERE and only here (paycheck.py's posture): it anchors the
starting balance and the month axis; services/projection.py takes no clock.
"""

from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models import MonthlyCashflow, MonthlySpending, NetWorthSnapshot
from app.schemas.projection import ProjectionOut
from app.services.money import quantize_money, quantize_pct
from app.services.net_worth_calc import get_swr_pct, investable_base
from app.services.projection import CENT, first_reaching, project

router = APIRouter(
    prefix="/projection", tags=["projection"], dependencies=[Depends(get_current_user)]
)

ZERO = Decimal("0.00")
DEFAULT_ANNUAL_RETURN = Decimal("0.05")
DEFAULT_YEARS = 30
TRAILING_MONTHS = 12
# A rate outside ±50%/yr is a typo, not a scenario — and the bound is also what keeps the
# fractional power's base strictly positive (services/projection.monthly_rate).
RETURN_MIN = Decimal("-0.5")
RETURN_MAX = Decimal("0.5")
RETURN_MESSAGE = "annual_return must be between -0.5 and 0.5"
SWR_MESSAGE = "swr must be greater than 0 and at most 1"
# Bounds in money.py's vocabulary: contributions are monthly money, spend is annual.
CONTRIBUTION_MAX_ABS = Decimal(10) ** 7
SPEND_MAX_ABS = Decimal(10) ** 9

YearsQuery = Annotated[int, Query(ge=1, le=60)]

NO_SNAPSHOTS = "no net-worth snapshots to project from"
NO_CASHFLOW_WARNING = "no cashflow history — monthly contribution defaulted to 0"
NO_SPEND_WARNING = "no spending history — provide an annual spend to model the FI target"
NO_SWR_WARNING = "withdrawal rate is 0 — no FI target to model"


def _months_from(start: date, count: int) -> list[date]:
    """count+1 first-of-month dates starting at `start` — the series' shared axis."""
    base = start.year * 12 + (start.month - 1)
    return [date((base + i) // 12, (base + i) % 12 + 1, 1) for i in range(count + 1)]


async def _trailing_annual_spend(db: AsyncSession) -> Decimal | None:
    """Mean of the last TRAILING_MONTHS monthly totals, ×12; None (no rows) and 0 (all
    zeros) both mean there is nothing to make an FI target of."""
    rows = (
        await db.execute(
            select(MonthlySpending.month, func.sum(MonthlySpending.amount))
            .group_by(MonthlySpending.month)
            .order_by(MonthlySpending.month.desc())
            .limit(TRAILING_MONTHS)
        )
    ).all()
    if not rows:
        return None
    mean = sum((Decimal(total) for _, total in rows), Decimal(0)) / len(rows)
    return mean * 12


async def _trailing_savings(db: AsyncSession) -> Decimal | None:
    """Mean of (net pay − that month's spend) over the last TRAILING_MONTHS months WITH a
    net pay on file; None with no cashflow history at all. Spend totals are queried for
    exactly those months, so a spending history longer than the cashflow one cannot skew
    the pairing."""
    cash = (
        (
            await db.execute(
                select(MonthlyCashflow)
                .order_by(MonthlyCashflow.month.desc())
                .limit(TRAILING_MONTHS)
            )
        )
        .scalars()
        .all()
    )
    if not cash:
        return None
    months = [row.month for row in cash]
    spend_rows = (
        await db.execute(
            select(MonthlySpending.month, func.sum(MonthlySpending.amount))
            .where(MonthlySpending.month.in_(months))
            .group_by(MonthlySpending.month)
        )
    ).all()
    spend_by_month = {month: Decimal(total) for month, total in spend_rows}
    total = sum((row.net_pay - spend_by_month.get(row.month, ZERO) for row in cash), Decimal(0))
    return total / len(cash)


@router.get("", response_model=ProjectionOut)
async def projection(
    annual_return: Decimal | None = Query(default=None),
    monthly_contribution: Decimal | None = Query(default=None),
    annual_spend: Decimal | None = Query(default=None),
    swr: Decimal | None = Query(default=None),
    years: YearsQuery = DEFAULT_YEARS,
    db: AsyncSession = Depends(get_db),
) -> ProjectionOut:
    today = date.today()  # the ONLY clock read (module docstring)
    start_month = today.replace(day=1)

    # The starting balance and the month it stands on. A missing snapshot is the ESPP
    # modeler's 404 class: "nothing to model yet", answered by the page's empty state.
    base_month = (
        await db.execute(
            select(NetWorthSnapshot.month)
            .where(NetWorthSnapshot.month <= today)
            .order_by(NetWorthSnapshot.month.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    starting = await investable_base(db, today)
    if base_month is None or starting is None:
        raise HTTPException(status_code=404, detail=NO_SNAPSHOTS)

    warnings: list[str] = []

    if annual_return is None:
        annual_return = DEFAULT_ANNUAL_RETURN
    else:
        if not annual_return.is_finite() or not RETURN_MIN <= annual_return <= RETURN_MAX:
            raise HTTPException(status_code=422, detail=RETURN_MESSAGE)
        annual_return = quantize_pct(annual_return)

    if monthly_contribution is None:
        derived = await _trailing_savings(db)
        if derived is None:
            monthly_contribution = ZERO
            warnings.append(NO_CASHFLOW_WARNING)
        else:
            monthly_contribution = derived.quantize(CENT, rounding=ROUND_HALF_UP)
    else:
        monthly_contribution = quantize_money(
            monthly_contribution, "monthly_contribution", max_abs=CONTRIBUTION_MAX_ABS
        )

    if annual_spend is None:
        derived_spend = await _trailing_annual_spend(db)
        if derived_spend is None or derived_spend <= 0:
            annual_spend = None
            warnings.append(NO_SPEND_WARNING)
        else:
            annual_spend = derived_spend.quantize(CENT, rounding=ROUND_HALF_UP)
    else:
        annual_spend = quantize_money(annual_spend, "annual_spend", max_abs=SPEND_MAX_ABS)
        if annual_spend <= 0:
            raise HTTPException(status_code=422, detail="annual_spend must be positive")

    if swr is None:
        swr = await get_swr_pct(db)  # already bounded to [0, 1]; 0 is handled below
    else:
        if not swr.is_finite() or not Decimal(0) < swr <= Decimal(1):
            raise HTTPException(status_code=422, detail=SWR_MESSAGE)
        swr = quantize_pct(swr)

    month_count = years * 12
    months = _months_from(start_month, month_count)
    projected = project(starting, monthly_contribution, annual_return, month_count)
    # The coast line: the same growth with the contributions turned off — the distance
    # between the two lines is what the saving is buying.
    coast = project(starting, ZERO, annual_return, month_count)

    fi_target: Decimal | None = None
    fi_ratio: Decimal | None = None
    fi_month: date | None = None
    coast_fi_month: date | None = None
    if annual_spend is not None:
        if swr <= 0:
            # get_swr_pct admits a stored 0 (a legal fraction) — degrade, never divide.
            warnings.append(NO_SWR_WARNING)
        else:
            fi_target = (annual_spend / swr).quantize(CENT, rounding=ROUND_HALF_UP)
            fi_ratio = quantize_pct(starting / fi_target)
            fi_index = first_reaching(projected, fi_target)
            fi_month = None if fi_index is None else months[fi_index]
            coast_index = first_reaching(coast, fi_target)
            coast_fi_month = None if coast_index is None else months[coast_index]
            if fi_month is None:
                warnings.append(
                    f"the FI target is not reached within the {years}-year horizon "
                    "at these assumptions"
                )

    return ProjectionOut(
        starting_balance=starting,
        base_month=base_month,
        start_month=start_month,
        annual_return=annual_return,
        monthly_contribution=monthly_contribution,
        annual_spend=annual_spend,
        swr_pct=swr,
        years=years,
        fi_target=fi_target,
        fi_ratio=fi_ratio,
        fi_month=fi_month,
        coast_fi_month=coast_fi_month,
        months=months,
        projected=projected,
        coast=coast,
        warnings=warnings,
    )
