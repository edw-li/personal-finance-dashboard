from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class RetirementOut(BaseModel):
    """One resolved `retire=<person_id>:<YYYY-MM>` param (2026-08-28 spec §4.3).

    `monthly_drop` is that person's take-home PLUS their payroll-deducted savings and employer
    match, all from the paycheck profile in force AT REQUEST TIME: the paycheck that stops.
    Informational since 2026-09-23 (spec §R2) — the run no longer subtracts it; retirement
    months split the plan into `phases` instead.
    """

    person_id: int
    name: str
    month: date  # always a first-of-month, on the projection's own axis
    monthly_drop: Decimal


class PayrollSavingOut(BaseModel):
    """One earner's monthly payroll-deducted savings — the deductions that land in an account
    they own (401(k) traditional/Roth/after-tax, ESPP, HSA), per check × periods ÷ 12."""

    person_id: int
    name: str
    monthly: Decimal
    # The EMPLOYER's 401(k) match for the same profile, per month (2026-09-06 spec §2.3) —
    # a separate leg because it is not the person's own deduction and never touches net pay.
    employer_monthly: Decimal


class ContributionBreakdownOut(BaseModel):
    """How a DERIVED `monthly_contribution` was built (2026-09-03).

    `cash` is the trailing mean of (net pay − spend) — the pre-2026-09 derivation on its own,
    which silently excluded every dollar that never reaches net pay. `payroll` and `employer`
    are the sums of `by_person`'s two columns. Null on the wire when the knob was supplied: a
    typed number is the user's, whole, and there is no derivation to explain.
    """

    cash: Decimal
    payroll: Decimal
    # Σ of `by_person`'s `employer_monthly`; kept apart from `payroll` on purpose — the
    # Spending page's savings rate stays employee-only (services/savings.py untouched).
    employer: Decimal
    total: Decimal
    by_person: list[PayrollSavingOut]


class DerivedWindowOut(BaseModel):
    """The months a DERIVED `annual_spend`/`monthly_contribution` was averaged over
    (2026-09-04 honest-numbers spec §3): the last twelve months that have both spending
    rows and take-home. `months` is how many actually matched — the endpoints can straddle
    a gap month, and saying "12 months" when 11 matched is the error this echo exists to
    prevent. Null when the knobs were supplied, or when no month has both halves.

    FastAPI serializes response models BY ALIAS, so the wire spells these `from` and `to`;
    `from` is a Python keyword, hence the `_month` suffix on the fields.
    """

    model_config = ConfigDict(populate_by_name=True)

    from_month: date = Field(alias="from")
    to_month: date = Field(alias="to")
    months: int


class PhaseOut(BaseModel):
    """One stretch of the plan between retirement months (2026-09-23 spec §R2).

    `working` runs from t0 on the derived (or typed) contribution; `partly_retired` from a
    retirement until the last one, on the still-working earners' payroll saving + employer
    match (their pay is assumed to cover spending, so no cash surplus and no withdrawal);
    `retired` from the last earner's retirement month, withdrawing annual spend / 12.
    `monthly_contribution` is in t0 (today's) dollars — the engine escalates it from the
    phase's first month — and `take_home_monthly` is the working earners' combined take-home
    (partly-retired phases only), the figure the shortfall note compares with spending.
    """

    from_month: date
    kind: Literal["working", "partly_retired", "retired"]
    working_person_ids: list[int]
    monthly_contribution: Decimal
    monthly_withdrawal: Decimal | None = None
    take_home_monthly: Decimal | None = None


class DrawdownOut(BaseModel):
    """The withdrawal after the last retirement (spec §R2): annual spend — the FI-target
    figure — each year, constant in today's dollars, from `start_month`."""

    start_month: date
    annual_withdrawal: Decimal


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
    # Monte Carlo. A live server now always echoes the three assumption knobs (absent ones
    # default in the router), and `bands`/probability/percentile months are present unless
    # volatility is an explicit 0. The echoes stay NULLABLE anyway: a stale tab or a stored
    # older payload must keep rendering, and the page reads a null echo as "no placeholder".
    volatility: Decimal | None = None
    inflation: Decimal | None = None
    contribution_growth: Decimal | None = None
    bands: dict[str, list[Decimal]] | None = None
    fi_probability: Decimal | None = None
    fi_month_p10: date | None = None
    fi_month_p50: date | None = None
    fi_month_p90: date | None = None
    # The retirements this run applied, SORTED BY MONTH — the order the drops happen, so
    # the echo, the chart's markLines and the engine's schedule all read the same way.
    # Empty for every request without a `retire` param, which leaves the rest of this
    # payload byte-identical to the pre-retirement one.
    retirements: list[RetirementOut] = []
    # Present whenever `monthly_contribution` was DERIVED (2026-09-03); None when it was
    # supplied. Nullable-with-default so an older stored payload still validates.
    contribution_breakdown: ContributionBreakdownOut | None = None
    # The window the derivation used (2026-09-04). Null when nothing was derived, so an
    # older stored payload still validates.
    derived_window: DerivedWindowOut | None = None
    # 2026-09-07 budget-seed spec §4: twelve times the ACTIVE living categories' budgets
    # resolved for `start_month` — the knobs card's "Use my budgets" preset. None without
    # budgets; nullable-with-default so a stored older payload still validates.
    budget_annual_spend: Decimal | None = None
    budget_month: date | None = None
    # 2026-09-23 spec §R5: the snapshot the starting balance stands on, beside `base_month`
    # (its key) — the date its balances describe (None = unknown), the stored recorded date,
    # and whether it is provisional (recorded before its 1st). Defaulted so an older stored
    # payload still validates.
    base_as_of: date | None = None
    base_recorded_on: date | None = None
    base_provisional: bool = False
    # 2026-09-23 spec §R2: the phases this run walked, in order (a live server always sends at
    # least the working phase, unless a retirement sits on t0), and the withdrawal — null
    # until every earner has a retirement month on the axis and there is an annual spend.
    phases: list[PhaseOut] = []
    drawdown: DrawdownOut | None = None
