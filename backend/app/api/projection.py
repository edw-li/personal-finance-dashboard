"""Projection API — the FIRE module (post-roadmap feature; nothing here is stored).

One computed GET in the ESPP-modeler shape: what-if knobs arrive as query params, every
knob NOT provided is seeded from the data the app already holds — the latest investable
balance (net_worth_calc's own rule, the 4%-line's base), the trailing-12 mean of
(net pay − spend) PLUS every earner's payroll-deducted savings as the contribution
(2026-09-03: 401(k), ESPP and HSA money never reaches net pay, so the cash-only derivation
understated the stream by thousands a month and called FI unreachable), the trailing-12 mean
spend ×12 as the annual spend, and the stored SWR — and the response echoes the values
actually used, so the page's form seeds from the echo. A derived contribution also echoes
its `contribution_breakdown` so the page can say what it added up.

The three ASSUMPTION knobs (volatility, inflation, contribution growth) have no data to
derive from, so an absent one takes a planning default instead (the DEFAULT_* constants
below) — the fan and today's-dollars framing are on unless you turn them off with an
explicit 0. They echo like every other knob; the page renders them as placeholders rather
than seeding their boxes, so blank always means "whatever the echo says".

Retirements (2026-08-28 spec §4.3) arrive as repeated `retire=<person_id>:<YYYY-MM>`
params and are the one input this module resolves against ANOTHER router's rule: the drop
is the take-home of the paycheck profile `paycheck._default_profile` says is in force
today. Absent, the response is the pre-retirement one plus an empty `retirements` echo.

`date.today()` is read HERE and only here (paycheck.py's posture): it anchors the
starting balance and the month axis; services/projection.py takes no clock.
"""

import re
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user

# Cross-router borrow, on taxes.py's precedent: the paycheck router owns the "profile in
# force" rule AND the divide-by-zero fence on a stored cadence. The Paycheck page, the
# Taxes page and this drop must never disagree about which profile is current, and a
# second copy of either rule here could only drift.
from app.api.paycheck import MIN_PAY_PERIODS, PAY_PERIODS_MESSAGE, _default_profile
from app.database import get_db
from app.models import MonthlyCashflow, MonthlySpending, NetWorthSnapshot
from app.schemas.projection import (
    ContributionBreakdownOut,
    PayrollSavingOut,
    ProjectionOut,
    RetirementOut,
)
from app.services.money import quantize_money, quantize_pct
from app.services.montecarlo import SIMULATIONS, reach_percentile, simulate
from app.services.net_worth_calc import get_swr_pct, investable_base
from app.services.paycheck_calc import breakdown, half_up2
from app.services.people import load_people
from app.services.projection import CENT, first_reaching, project
from app.services.savings import payroll_monthly

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
# The Monte Carlo knobs. A sigma of 0 is the deterministic line itself — now an EXPLICIT
# 0 (the fan's off switch), since a blank one means DEFAULT_VOLATILITY; above 100%/yr the
# lognormal walk is noise, not a scenario.
VOLATILITY_MESSAGE = "volatility must be between 0 and 1"
INFLATION_MIN = Decimal("-0.1")
INFLATION_MAX = Decimal("0.25")
INFLATION_MESSAGE = "inflation must be between -0.1 and 0.25"
GROWTH_MAX = Decimal("0.25")
GROWTH_MESSAGE = "contribution_growth must be between 0 and 0.25"
# Assumption defaults (user decision 2026-08-20): absent knobs mean these, so a fresh
# page shows the fan and reads in today's dollars with no typing. Explicit values —
# including the zeros — always win; volatility 0 is the fan's off switch.
DEFAULT_VOLATILITY = Decimal("0.15")
DEFAULT_INFLATION = Decimal("0.03")
DEFAULT_CONTRIBUTION_GROWTH = Decimal("0.03")
# Bounds in money.py's vocabulary: contributions are monthly money, spend is annual.
CONTRIBUTION_MAX_ABS = Decimal(10) ** 7
SPEND_MAX_ABS = Decimal(10) ** 9

YearsQuery = Annotated[int, Query(ge=1, le=60)]

# Repeated, order-free, and STRINGS: "<person_id>:<YYYY-MM>" is one value the user can see
# in the URL, where two parallel int/date lists could arrive at different lengths. No count
# fence is needed — a second mention of the same person 422s, so the loop below can never
# run longer than the roster.
RetireQuery = Annotated[list[str] | None, Query()]
RETIRE_PATTERN = re.compile(r"^(\d{1,10}):(\d{4})-(\d{2})$")
RETIRE_FORMAT_MESSAGE = "retire must be '<person_id>:<YYYY-MM>' (e.g. retire=2:2035-06)"

NO_SNAPSHOTS = "no net-worth snapshots to project from"
NO_CASHFLOW_WARNING = "no cashflow history — monthly contribution defaulted to 0"
NO_CASHFLOW_PAYROLL_WARNING = (
    "no cashflow history — the monthly contribution is payroll deductions alone"
)
# The saving-lines arithmetic itself lives in services/savings.payroll_monthly, which every
# page that says "saved" reads (2026-09-04 honest-numbers spec §2); this router is a caller.
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


async def _payroll_savings(
    db: AsyncSession, today: date
) -> tuple[Decimal, list[PayrollSavingOut], list[str]]:
    """Every earner's monthly payroll savings from the profile in force today, summed.

    Best-effort by design: a person with no profile contributes nothing and says nothing
    (the Paycheck page is where that gets fixed), and an unusable stored cadence is a
    warning rather than the 422 `_resolve_retirements` raises — a derivation must never
    veto the projection. Rows are cents (half_up2) so the echo sums exactly.
    """
    total = ZERO
    rows: list[PayrollSavingOut] = []
    warnings: list[str] = []
    for person in await load_people(db):
        profile = await _default_profile(db, person.id, today)
        if profile is None:
            continue
        if profile.pay_periods_per_year < MIN_PAY_PERIODS:
            warnings.append(
                f"{person.name}'s paycheck profile: {PAY_PERIODS_MESSAGE} — "
                "payroll savings left out of the contribution"
            )
            continue
        monthly = half_up2(payroll_monthly(profile))
        if monthly <= ZERO:
            continue
        rows.append(PayrollSavingOut(person_id=person.id, name=person.name, monthly=monthly))
        total += monthly
    return total, rows, warnings


async def _resolve_retirements(
    db: AsyncSession, raw: list[str], months: list[date], years: int, today: date
) -> list[RetirementOut]:
    """`retire=<person_id>:<YYYY-MM>` params resolved to the echo rows, sorted by month.

    Every refusal is a 422 carrying the sentence the page renders verbatim, and the FIRST
    param with a problem is the one that answers: the params are order-free, so reporting
    them all would only make the message longer, never the fix clearer. Within one param
    the order is fixed — format, person, duplicate, horizon, profile, cadence — so the
    message always names the nearest thing to fix.

    The drop is that person's monthly take-home PLUS their payroll-deducted savings, both
    from the profile `_default_profile` says is in force TODAY — retiring stops the whole
    check, and the derived contribution counts both halves (2026-09-03). It is a today's-
    dollars figure exactly like `monthly_contribution`, and the caller hands it to the
    engine UNCONVERTED — see the Fisher note at the call.
    """
    people = {person.id: person for person in await load_people(db)}
    rows: list[RetirementOut] = []
    seen: set[int] = set()
    for item in raw:
        match = RETIRE_PATTERN.match(item.strip())
        if match is None:
            raise HTTPException(status_code=422, detail=RETIRE_FORMAT_MESSAGE)
        person_id = int(match.group(1))
        try:
            month = date(int(match.group(2)), int(match.group(3)), 1)
        except ValueError:
            # Month 00 or 13: a spelling problem, answered in the spelling's own words.
            raise HTTPException(status_code=422, detail=RETIRE_FORMAT_MESSAGE) from None
        person = people.get(person_id)
        if person is None:
            raise HTTPException(
                status_code=422,
                detail=f"retire names person {person_id}, who is not in the household",
            )
        if person_id in seen:
            raise HTTPException(
                status_code=422, detail=f"{person.name} has more than one retirement month"
            )
        seen.add(person_id)
        if not months[0] <= month <= months[-1]:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"{person.name}'s retirement month is outside the {years}-year horizon "
                    f"({months[0]:%Y-%m} to {months[-1]:%Y-%m})"
                ),
            )
        profile = await _default_profile(db, person_id, today)
        if profile is None:
            raise HTTPException(
                status_code=422,
                detail=f"{person.name} has no paycheck profile in force — nothing to drop",
            )
        if profile.pay_periods_per_year < MIN_PAY_PERIODS:
            # The stored-data fence, in paycheck.py's own words: gross = salary / periods,
            # and a hand-written 0 would be a DivisionByZero 500 inside `breakdown`.
            raise HTTPException(
                status_code=422,
                detail=f"{person.name}'s paycheck profile: {PAY_PERIODS_MESSAGE}",
            )
        drop = half_up2(breakdown(profile)["monthly_net"])
        if drop < ZERO:
            # An over-committed check nets negative; a retirement must never ADD to the
            # stream, so a negative take-home simply has nothing to drop.
            drop = ZERO
        # The deductions stop with the paycheck too — the same figure the derived
        # contribution added for this person, so a retirement removes exactly what the
        # profile put in. Non-negative by construction (pcts and riders are fenced ≥ 0).
        drop += half_up2(payroll_monthly(profile))
        rows.append(
            RetirementOut(person_id=person_id, name=person.name, month=month, monthly_drop=drop)
        )
    # Sorted by month (person id breaks a tie) so the echo, the chart's markLines and the
    # engine's schedule all read in the order the drops actually happen.
    rows.sort(key=lambda row: (row.month, row.person_id))
    return rows


@router.get("", response_model=ProjectionOut)
async def projection(
    annual_return: Decimal | None = Query(default=None),
    monthly_contribution: Decimal | None = Query(default=None),
    annual_spend: Decimal | None = Query(default=None),
    swr: Decimal | None = Query(default=None),
    years: YearsQuery = DEFAULT_YEARS,
    volatility: Decimal | None = Query(default=None),
    inflation: Decimal | None = Query(default=None),
    contribution_growth: Decimal | None = Query(default=None),
    retire: RetireQuery = None,
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

    contribution_breakdown: ContributionBreakdownOut | None = None
    if monthly_contribution is None:
        cash = await _trailing_savings(db)
        payroll, by_person, payroll_warnings = await _payroll_savings(db, today)
        warnings.extend(payroll_warnings)
        if cash is None:
            cash_part = ZERO
            warnings.append(NO_CASHFLOW_WARNING if payroll <= ZERO else NO_CASHFLOW_PAYROLL_WARNING)
        else:
            cash_part = cash.quantize(CENT, rounding=ROUND_HALF_UP)
        # Both halves are cents already, so the sum needs no second rounding; quantize
        # anyway so a Decimal('0') cash part still echoes as "0.00".
        monthly_contribution = (cash_part + payroll).quantize(CENT, rounding=ROUND_HALF_UP)
        contribution_breakdown = ContributionBreakdownOut(
            cash=cash_part, payroll=payroll, total=monthly_contribution, by_person=by_person
        )
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

    # The three assumption knobs, each in the annual_return pattern: finite, bounded,
    # quantized on the way in. ABSENT means the DEFAULT here, never None — that is the
    # whole feature: a fresh page gets the fan and today's dollars with no typing. An
    # explicit value always wins, zeros included (volatility 0 turns the fan off, the
    # gate below; inflation 0 reads nominal; growth 0 keeps contributions flat), and the
    # quantize runs on both paths so the echo always names what actually ran at 6dp.
    if volatility is None:
        volatility = DEFAULT_VOLATILITY
    elif not volatility.is_finite() or not Decimal(0) <= volatility <= Decimal(1):
        raise HTTPException(status_code=422, detail=VOLATILITY_MESSAGE)
    volatility = quantize_pct(volatility)

    if inflation is None:
        inflation = DEFAULT_INFLATION
    elif not inflation.is_finite() or not INFLATION_MIN <= inflation <= INFLATION_MAX:
        raise HTTPException(status_code=422, detail=INFLATION_MESSAGE)
    inflation = quantize_pct(inflation)

    if contribution_growth is None:
        contribution_growth = DEFAULT_CONTRIBUTION_GROWTH
    elif not contribution_growth.is_finite() or not Decimal(0) <= contribution_growth <= GROWTH_MAX:
        raise HTTPException(status_code=422, detail=GROWTH_MESSAGE)
    contribution_growth = quantize_pct(contribution_growth)

    # Inflation converts BOTH rates to real terms so every line and band shifts together
    # while the FI target stays in today's dollars — the whole frame reads in one unit.
    # Both knobs are resolved by here (defaulted or validated), so there is no None branch
    # left: an explicit 0 is the only way back to nominal arithmetic.
    real_return = (Decimal(1) + annual_return) / (Decimal(1) + inflation) - Decimal(1)
    real_growth = (Decimal(1) + contribution_growth) / (Decimal(1) + inflation) - Decimal(1)

    month_count = years * 12
    months = _months_from(start_month, month_count)
    retirements = await _resolve_retirements(db, retire or [], months, years, today)
    # (month_index, amount), sorted — the SAME schedule feeds the deterministic line and
    # the fan, which is what keeps the bands wrapped around the line they belong to.
    # `months` is contiguous from t0, so the horizon check above guarantees every month
    # is on the axis.
    #
    # The drop does NOT go through the real-terms conversion below: `monthly_drop` is a
    # TODAY's-dollars take-home, exactly like `monthly_contribution`, and the engine's
    # escalator is what carries both forward. Deflating it would model a nominal FUTURE
    # paycheck, which is not what `_default_profile` read. The honest asterisk — the
    # remaining stream escalates in real terms while the drop does not — is named in the
    # page's hint rather than papered over here.
    drops = [(months.index(row.month), row.monthly_drop) for row in retirements]
    # Every ARRAY below runs on `real_return` (= annual_return under an EXPLICIT
    # inflation=0, which is what reproduces the pre-Monte-Carlo arrays byte for byte);
    # the ECHOED `annual_return` stays the NOMINAL value the user provided or the default
    # — the echo is what seeds the form, and `inflation` echoes separately so the page can
    # reconstruct the real rate.
    projected = project(
        starting, monthly_contribution, real_return, month_count, real_growth, drops
    )
    # The coast line: the same growth with the contributions turned off — the distance
    # between the two lines is what the saving is buying. Nothing to escalate, so the
    # escalator is 0 here too, and nothing to drop either: a retirement cannot move a
    # stream that is already off.
    coast = project(starting, ZERO, real_return, month_count, Decimal("0"))

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

    # The simulation surrounds the deterministic line. Sigma 0 is its off switch — an
    # explicit one now that absent means DEFAULT_VOLATILITY — and turning it off leaves
    # this whole block null, exactly as an absent knob used to.
    bands: dict[str, list[Decimal]] | None = None
    fi_probability: Decimal | None = None
    fi_month_p10: date | None = None
    fi_month_p50: date | None = None
    fi_month_p90: date | None = None
    if volatility > 0:
        mc = simulate(
            starting,
            monthly_contribution,
            real_return,
            volatility,
            real_growth,
            month_count,
            fi_target,
            drops,
        )
        bands = mc.bands
        if fi_target is not None:
            reached = sum(1 for index in mc.reach_indices if index is not None)
            fi_probability = quantize_pct(Decimal(reached) / Decimal(SIMULATIONS))
            p10 = reach_percentile(mc.reach_indices, 10)
            p50 = reach_percentile(mc.reach_indices, 50)
            p90 = reach_percentile(mc.reach_indices, 90)
            # Defense in depth only: an interpolation of order statistics all <= month_count
            # cannot exceed it (branch review N4) — the clamp just makes that not load-bearing.
            # onto the axis rather than invent a month the chart does not have.
            fi_month_p10 = None if p10 is None else months[min(p10, month_count)]
            fi_month_p50 = None if p50 is None else months[min(p50, month_count)]
            fi_month_p90 = None if p90 is None else months[min(p90, month_count)]

    return ProjectionOut(
        starting_balance=starting,
        base_month=base_month,
        start_month=start_month,
        annual_return=annual_return,
        monthly_contribution=monthly_contribution,
        contribution_breakdown=contribution_breakdown,
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
        volatility=volatility,
        inflation=inflation,
        contribution_growth=contribution_growth,
        bands=bands,
        fi_probability=fi_probability,
        fi_month_p10=fi_month_p10,
        fi_month_p50=fi_month_p50,
        fi_month_p90=fi_month_p90,
        retirements=retirements,
    )
