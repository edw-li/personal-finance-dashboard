from datetime import date
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class RetirementOut(BaseModel):
    """One resolved `retire=<person_id>:<YYYY-MM>` param (2026-08-28 spec §4.3).

    `monthly_drop` is that person's take-home PLUS their payroll-deducted savings, both from
    the paycheck profile in force AT REQUEST TIME — today's honest approximation, named in
    the page's hint — so the echo is also what tells the user what a date actually costs the
    contribution stream (2026-09-03: retiring stops the whole check, not just the net).
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


class ContributionBreakdownOut(BaseModel):
    """How a DERIVED `monthly_contribution` was built (2026-09-03).

    `cash` is the trailing mean of (net pay − spend) — the pre-2026-09 derivation on its own,
    which silently excluded every dollar that never reaches net pay. `payroll` is the sum of
    `by_person`. Null on the wire when the knob was supplied: a typed number is the user's,
    whole, and there is no derivation to explain.
    """

    cash: Decimal
    payroll: Decimal
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
