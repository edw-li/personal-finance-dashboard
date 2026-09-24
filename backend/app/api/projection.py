"""Projection API — the FIRE module (post-roadmap feature; nothing here is stored).

One computed GET in the ESPP-modeler shape: what-if knobs arrive as query params, every
knob NOT provided is seeded from the data the app already holds — the investable balance of
the CURRENT snapshot (lane K's rule in services/snapshot_state.py, a provisional next-month
one included, spec §R5; net_worth_calc's groups), the mean cash savings of the
MATCHED window PLUS every earner's payroll-deducted savings as the contribution
(2026-09-03: 401(k), ESPP and HSA money never reaches net pay, so the cash-only derivation
understated the stream by thousands a month and called FI unreachable), that same window's
mean LIVING spend ×12 as the annual spend, and the stored SWR — and the response echoes the
values actually used, so the page's form seeds from the echo. A derived contribution also
echoes its `contribution_breakdown` so the page can say what it added up.

The MATCHED window (2026-09-04 honest-numbers spec §3) is the last TRAILING_MONTHS months
that carry BOTH spending rows and take-home, from services/savings.py. Before it the two
derivations averaged DIFFERENT windows, and the spend mean counted a balances-only save's
zero-filled month as a month of spending nothing. `derived_window` echoes what was used.

The three ASSUMPTION knobs (volatility, inflation, contribution growth) have no data to
derive from, so an absent one takes a planning default instead (the DEFAULT_* constants
below) — the fan and today's-dollars framing are on unless you turn them off with an
explicit 0. They echo like every other knob; the page renders them as placeholders rather
than seeding their boxes, so blank always means "whatever the echo says".

Retirements (2026-08-28 spec §4.3) arrive as repeated `retire=<person_id>:<YYYY-MM>`
params and are the one input this module resolves against ANOTHER router's rule: the
paycheck profile `paycheck._default_profile` says is in force today. Since the 2026-09-23
spec §R2 they split the run into phases (`_plan_phases`): while someone still works, their
payroll saving and employer match continue and their pay is assumed to cover spending; from
the last earner's retirement the annual spend is withdrawn. `monthly_drop` is still echoed
per person. Absent, the response is the working phase alone plus an empty `retirements` echo.

The PRODUCT clock (services/clock.py) is read HERE and only here (paycheck.py's
posture): it anchors the starting balance and the month axis; services/projection.py
takes no clock. The route serves JSON BYTES and `run_projection` validates them into a
model for direct callers (the assistant), so every caller gets its own copy.
"""

import math
import re
from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import ROUND_HALF_UP, Decimal
from functools import partial
from typing import Annotated

import anyio
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.app_settings import read_plan_until_year
from app.api.deps import get_current_user

# The espp router owns the espp_ticker -> securities -> latest_prices soft link; the vests
# borrow it (comp.py and taxes.py do too): the employer ticker is one setting.
from app.api.espp import _espp_quote

# Cross-router borrow, on taxes.py's precedent: the paycheck router owns the "profile in
# force" rule AND the divide-by-zero fence on a stored cadence. The Paycheck page, the
# Taxes page and this drop must never disagree about which profile is current, and a
# second copy of either rule here could only drift.
from app.api.paycheck import MIN_PAY_PERIODS, PAY_PERIODS_MESSAGE, _default_profile, _limits_for
from app.database import get_db
from app.limit_keys import LIMIT_401K_ELECTIVE
from app.models import (
    Account,
    AccountBalance,
    PaycheckProfile,
    Person,
    RsuGrant,
)
from app.schemas.projection import (
    ContributionBreakdownOut,
    DerivedWindowOut,
    DrawdownOut,
    MoneyLastsOut,
    PayrollSavingOut,
    PhaseOut,
    ProjectionOut,
    RetirementOut,
    VestsOut,
    VestYearOut,
)
from app.services import clock, rsu_vesting
from app.services.budgets import living_budget_total

# The calendar's sell-to-cover is the one owner of the vest withholding rate (≈ 32.23 %).
from app.services.calendar.generators.rsu import SUPPLEMENTAL, after_sell_to_cover
from app.services.calendar.model import money
from app.services.limit_check import employer_match
from app.services.metrics import planning_window
from app.services.money import quantize_money, quantize_pct
from app.services.montecarlo import (
    SIMULATIONS,
    MonteCarloResult,
    reach_percentile,
    simulate,
    survival_count,
)
from app.services.net_worth_calc import INVESTABLE_GROUPS, get_swr_pct
from app.services.paycheck_calc import MONTHS_PER_YEAR, breakdown, half_up2
from app.services.people import load_people, primary_person
from app.services.projection import (
    CENT,
    MAX_YEARS,
    december_index,
    first_reaching,
    latest_december_year,
    max_plan_until_year,
    project,
    project_path,
)
from app.services.read_cache import (
    cached_month_savings,
    cached_projection,
    cached_review_book,
)
from app.services.savings import payroll_monthly
from app.services.snapshot_state import SnapshotState, current_and_previous, load_snapshot_states

router = APIRouter(
    prefix="/projection", tags=["projection"], dependencies=[Depends(get_current_user)]
)

# The Monte Carlo runs in a worker thread, ONE at a time (2026-09-23 spec §R9): the pure-Python
# walk used to hold the single event loop for its whole length. The thread still shares the GIL,
# so other requests slow down during a cold run — but they interleave instead of queueing behind
# it, and a second cold run waits for the first rather than splitting the CPU with it.
MC_LIMITER = anyio.CapacityLimiter(1)

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

# Named, not inline: assistant_context decodes a `years` entry from the page's URL and runs
# the projection DIRECTLY, where FastAPI's Query validation never runs. It fences the
# horizon against these two, and so does `_build` (YEARS_MESSAGE), so the sandbox and the
# assistant cannot drift.
YEARS_MIN = 1
YEARS_MAX = 60
YearsQuery = Annotated[int, Query(ge=YEARS_MIN, le=YEARS_MAX)]
YEARS_MESSAGE = f"years must be between {YEARS_MIN} and {YEARS_MAX}"

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
NO_MATCHED_MONTHS_WARNING = (
    "no eligible completed month has both spending and take-home on file — "
    "the contribution and annual spend could not be derived"
)


def _months_from(start: date, count: int) -> list[date]:
    """count+1 first-of-month dates starting at `start` — the series' shared axis."""
    base = start.year * 12 + (start.month - 1)
    return [date((base + i) // 12, (base + i) % 12 + 1, 1) for i in range(count + 1)]


def employer_monthly(profile, limits: dict[str, Decimal]) -> Decimal:
    """One profile's employer 401(k) match, per month, in cents. The bands are ANNUAL dollars
    of elective deferrals, so the year is the only place the tiers can be applied honestly —
    divide afterwards, never before."""
    elective = (profile.trad_401k_pct + profile.roth_401k_pct) * profile.annual_salary
    return half_up2(
        employer_match(profile, elective, limits.get(LIMIT_401K_ELECTIVE)) / MONTHS_PER_YEAR
    )


@dataclass(frozen=True)
class ProjectionKnobs:
    """One request's knobs as the route received them — the unit the result cache keys on
    (2026-09-23 spec §R9) and the one argument a direct caller (the assistant) passes, so a
    new knob cannot be forgotten at one of the two doors."""

    annual_return: Decimal | None = None
    monthly_contribution: Decimal | None = None
    annual_spend: Decimal | None = None
    swr: Decimal | None = None
    years: int = DEFAULT_YEARS
    volatility: Decimal | None = None
    inflation: Decimal | None = None
    contribution_growth: Decimal | None = None
    retire: tuple[str, ...] = ()
    plan_until: int | None = None
    vests: bool | None = None

    def cache_key(self) -> tuple:
        """Normalized so requests with one answer share one entry: equal Decimals spell one
        key ("0.06" and "0.060" — every Decimal knob is quantized on the way in, so the run
        cannot tell them apart), and retire entries are stripped and sorted (the params are
        order-free). An absent knob stays None, never its default: the echo spells the two
        differently. A non-finite Decimal keeps its own text — it 422s, and a 422 is never
        cached, but its key is still looked up and must hash."""

        def text(value: Decimal | None) -> str | None:
            if value is None:
                return None
            return str(value.normalize()) if value.is_finite() else f"!{value}"

        return (
            text(self.annual_return),
            text(self.monthly_contribution),
            text(self.annual_spend),
            text(self.swr),
            self.years,
            text(self.volatility),
            text(self.inflation),
            text(self.contribution_growth),
            tuple(sorted(item.strip() for item in self.retire)),
            self.plan_until,
            self.vests,
        )


@dataclass(frozen=True)
class _Earner:
    """A person with a USABLE paycheck profile in force (2026-09-23 spec §R2's earners): the
    set the derived contribution counts, and the set a drawdown waits for."""

    person_id: int
    name: str
    profile: PaycheckProfile
    payroll: Decimal  # payroll-deducted savings per month, cents
    employer: Decimal  # the employer's 401(k) match per month, cents


@dataclass(frozen=True)
class _Household:
    """Everything the run reads about people, read ONCE per build: the roster (primary
    first), this year's limits, each person's profile in force (`_default_profile`'s rule),
    the earners, and the people whose stored cadence would break `breakdown`."""

    people: list[Person]
    limits: dict[str, Decimal]
    profiles: dict[int, PaycheckProfile | None]
    earners: list[_Earner]
    unusable: list[Person]


async def _load_household(db: AsyncSession, today: date) -> _Household:
    people = await load_people(db)
    limits = await _limits_for(db, today.year)
    profiles: dict[int, PaycheckProfile | None] = {}
    earners: list[_Earner] = []
    unusable: list[Person] = []
    for person in people:
        profile = await _default_profile(db, person.id, today)
        profiles[person.id] = profile
        if profile is None:
            continue
        if profile.pay_periods_per_year < MIN_PAY_PERIODS:
            unusable.append(person)
            continue
        earners.append(
            _Earner(
                person_id=person.id,
                name=person.name,
                profile=profile,
                payroll=half_up2(payroll_monthly(profile)),
                employer=employer_monthly(profile, limits),
            )
        )
    return _Household(
        people=people, limits=limits, profiles=profiles, earners=earners, unusable=unusable
    )


def _payroll_savings(
    household: _Household,
) -> tuple[Decimal, Decimal, list[PayrollSavingOut], list[str]]:
    """Every earner's monthly payroll savings from the profile in force today, summed.

    Best-effort by design: a person with no profile contributes nothing and says nothing
    (the Paycheck page is where that gets fixed), and an unusable stored cadence is a
    warning rather than the 422 `_resolve_retirements` raises — a derivation must never
    veto the projection. Rows are cents (half_up2) so the echo sums exactly.
    """
    total = ZERO
    employer_total = ZERO
    rows: list[PayrollSavingOut] = []
    warnings = [
        f"{person.name}'s paycheck profile: {PAY_PERIODS_MESSAGE} — "
        "payroll savings left out of the contribution"
        for person in household.unusable
    ]
    for earner in household.earners:
        if earner.payroll <= ZERO and earner.employer <= ZERO:
            continue
        rows.append(
            PayrollSavingOut(
                person_id=earner.person_id,
                name=earner.name,
                monthly=earner.payroll,
                employer_monthly=earner.employer,
            )
        )
        total += earner.payroll
        employer_total += earner.employer
    return total, employer_total, rows, warnings


def _resolve_retirements(
    household: _Household, raw: tuple[str, ...], months: list[date], years: int
) -> list[RetirementOut]:
    """`retire=<person_id>:<YYYY-MM>` params resolved to the echo rows, sorted by month.

    Every refusal is a 422 carrying the sentence the page renders verbatim, and the FIRST
    param with a problem is the one that answers: the params are order-free, so reporting
    them all would only make the message longer, never the fix clearer. Within one param
    the order is fixed — format, person, duplicate, horizon, profile, cadence — so the
    message always names the nearest thing to fix.

    `monthly_drop` is that person's monthly take-home PLUS their payroll-deducted savings
    and employer match, all from the profile `_default_profile` says is in force TODAY —
    the paycheck that stops, a today's-dollars figure like `monthly_contribution`.
    """
    people = {person.id: person for person in household.people}
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
        profile = household.profiles.get(person_id)
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
        # The deductions and the employer's leg stop with the paycheck too — the same figures
        # the derived contribution added for this person.
        drop += half_up2(payroll_monthly(profile))
        drop += employer_monthly(profile, household.limits)
        rows.append(
            RetirementOut(person_id=person_id, name=person.name, month=month, monthly_drop=drop)
        )
    # Sorted by month (person id breaks a tie) so the echo, the chart's markLines and the
    # engine's schedule all read in the order the retirements actually happen.
    rows.sort(key=lambda row: (row.month, row.person_id))
    return rows


def approx_money(amount: Decimal) -> str:
    """A figure for a sentence, in the page's compact spelling (formatCurrencyCompact in
    src/utils/format.ts): "$1.1K", "$5.5K", "$1.25M", "$950"."""
    sign = "-" if amount < 0 else ""
    value = abs(amount)
    if value >= 1_000_000:
        millions = (value / 1_000_000).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        return f"{sign}${millions}M"
    if value >= 1_000:
        thousands = (value / 1_000).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)
        return f"{sign}${thousands}K"
    return f"{sign}${value.quantize(Decimal('1'), rounding=ROUND_HALF_UP)}"


def names_phrase(names: list[str]) -> str:
    """ "Grace", "Grace and Sam", "Ann, Bo and Cy"."""
    if len(names) <= 1:
        return "".join(names)
    return f"{', '.join(names[:-1])} and {names[-1]}"


def _take_home(profile: PaycheckProfile) -> Decimal:
    """A profile's monthly take-home, floored at 0 (an over-committed check has none)."""
    return max(half_up2(breakdown(profile)["monthly_net"]), ZERO)


@dataclass(frozen=True)
class _Plan:
    """What the retirement months do to the run (2026-09-23 spec §R2): the phases echo, the
    engine's contribution resets and withdrawal, the drawdown echo, and the earners who have
    no retirement month yet (§R3's reason for a money-lasts answer that cannot be given)."""

    phases: list[PhaseOut]
    resets: list[tuple[int, Decimal]]
    withdrawal: tuple[int, Decimal] | None
    drawdown: DrawdownOut | None
    missing: list[str]


def _plan_phases(
    household: _Household,
    retirements: list[RetirementOut],
    monthly_contribution: Decimal,
    annual_spend: Decimal | None,
    months: list[date],
    warnings: list[str],
) -> _Plan:
    """Retirement months sorted into phases (spec §R2, the user's rules):

    - working (t0 → the first retirement): the derived or typed contribution, as before;
    - partly retired (a retirement → the last one): the contribution RESETS to the payroll
      saving + employer match of the earners still working, from their profiles in force
      today — their pay is assumed to cover spending, so no cash surplus and no withdrawal,
      and when that take-home is below the spending the warnings say so;
    - retired (from the last earner's retirement month): contribution 0 and a withdrawal of
      annual spend / 12, constant in today's dollars (the engine runs in real terms).

    Boundaries are grouped by the month index the ENGINE uses — index 0 folds onto 1, since
    t0 carries no flow — so people retiring in one month, or at t0 and t0+1, share one reset
    (the engine refuses two at an index). A drawdown needs every earner to have a month on
    the axis; otherwise the last phase simply runs to the horizon.
    """
    folded = {row.person_id: max(months.index(row.month), 1) for row in retirements}
    groups: dict[int, list[date]] = {}
    for row in retirements:
        groups.setdefault(folded[row.person_id], []).append(row.month)
    earners = household.earners
    missing = [earner.name for earner in earners if earner.person_id not in folded]
    retire_month = {row.person_id: row.month for row in retirements}
    withdrawal_amount = (
        None
        if annual_spend is None
        else (annual_spend / MONTHS_PER_YEAR).quantize(CENT, rounding=ROUND_HALF_UP)
    )

    phases: list[PhaseOut] = []
    if not retirements or min(row.month for row in retirements) > months[0]:
        phases.append(
            PhaseOut(
                from_month=months[0],
                kind="working",
                working_person_ids=[earner.person_id for earner in earners],
                monthly_contribution=monthly_contribution,
            )
        )
    resets: list[tuple[int, Decimal]] = []
    withdrawal: tuple[int, Decimal] | None = None
    drawdown: DrawdownOut | None = None
    for index in sorted(groups):
        from_month = min(groups[index])
        working = [e for e in earners if folded.get(e.person_id, len(months)) > index]
        if not working:
            resets.append((index, ZERO))
            if withdrawal_amount is not None:
                withdrawal = (index, withdrawal_amount)
                drawdown = DrawdownOut(
                    start_month=max(retire_month[e.person_id] for e in earners),
                    annual_withdrawal=annual_spend,
                )
            phases.append(
                PhaseOut(
                    from_month=from_month,
                    kind="retired",
                    working_person_ids=[],
                    monthly_contribution=ZERO,
                    monthly_withdrawal=withdrawal_amount,
                )
            )
            # Nobody is left to retire, so there is no later boundary to reach.
            break
        level = sum((earner.payroll + earner.employer for earner in working), ZERO)
        take_home = sum((_take_home(earner.profile) for earner in working), ZERO)
        resets.append((index, level))
        phases.append(
            PhaseOut(
                from_month=from_month,
                kind="partly_retired",
                working_person_ids=[earner.person_id for earner in working],
                monthly_contribution=level,
                take_home_monthly=take_home,
            )
        )
        if withdrawal_amount is not None and take_home < withdrawal_amount:
            note = (
                f"{names_phrase([earner.name for earner in working])}'s take-home "
                f"(≈ {approx_money(take_home)}/mo) is below your spending "
                f"(≈ {approx_money(withdrawal_amount)}/mo); the difference is not withdrawn."
            )
            if note not in warnings:
                warnings.append(note)
    return _Plan(
        phases=phases, resets=resets, withdrawal=withdrawal, drawdown=drawdown, missing=missing
    )


NO_VEST_TICKER = "Set the employer-stock ticker in Settings to include vests"


@dataclass(frozen=True)
class _Vests:
    echo: VestsOut | None
    lumps: dict[int, Decimal]  # month index → after-withholding value, when included


def _one_year_on(day: date) -> date:
    try:
        return day.replace(year=day.year + 1)
    except ValueError:  # 29 February
        return day.replace(year=day.year + 1, day=28)


def quote_date(instant: datetime | None) -> date | None:
    """The day a stored quote belongs to: its UTC date — the app's quote convention (staleness is
    judged in UTC, services/clock.py), and a daily close is stored at midnight UTC, which Pacific
    time would date the day before."""
    if instant is None:
        return None
    return instant.astimezone(UTC).date() if instant.tzinfo is not None else instant.date()


async def _scheduled_vests(
    db: AsyncSession,
    knob: bool | None,
    cut: date,
    today: date,
    months: list[date],
    household: _Household,
    retirements: list[RetirementOut],
    warnings: list[str],
) -> _Vests:
    """Scheduled RSU vests as lumps (2026-09-23 spec §R4) — on unless the knob is False.

    Per grant, `rsu_vesting.schedule` (a grant it refuses is skipped with the Comp page's own
    warning). A tranche is kept when it is dated after `cut` — the starting balance's date,
    so a vest already in that balance is never counted twice — before the primary's
    retirement month (grants carry no owner; the withholding tracker already treats them as
    the primary's, and unvested shares are forfeited on leaving), and on the axis. Its value
    is shares × the latest employer quote, after the calendar's sell-to-cover
    (`after_sell_to_cover`, the one owner of ≈ 32.23 %), flat in today's dollars, at its
    month index (0 — and anything between the base and t0 — folds onto 1). No ticker or no
    quote: nothing is included, and `excluded_reason` says why.
    """
    grants = list(
        (
            await db.execute(select(RsuGrant).order_by(RsuGrant.first_vest_date, RsuGrant.id))
        ).scalars()
    )
    if not grants:
        return _Vests(echo=None, lumps={})
    primary = primary_person(household.people)
    stops = next(
        (row.month for row in retirements if primary is not None and row.person_id == primary.id),
        None,
    )
    ticker, price, quoted_at = await _espp_quote(db)
    if ticker is None or price is None:
        reason = (
            NO_VEST_TICKER
            if ticker is None
            else f"No {ticker} quote yet — scheduled vests are left out"
        )
        return _Vests(
            echo=VestsOut(
                included=False, withholding_rate=SUPPLEMENTAL, stops=stops, excluded_reason=reason
            ),
            lumps={},
        )
    start_month = months[0]
    last_index = len(months) - 1
    year_on = _one_year_on(today)
    lumps: dict[int, Decimal] = {}
    by_year: dict[int, tuple[Decimal, Decimal]] = {}
    next_12_months = ZERO
    for grant in grants:
        try:
            tranches = rsu_vesting.schedule(grant)
        except (ValueError, OverflowError) as exc:
            warnings.append(f"{grant.label}: stored grant cannot be scheduled — {exc}")
            continue
        for vest_date, shares in tranches:
            if vest_date <= cut:
                continue
            if stops is not None and vest_date >= stops:
                continue
            index = (vest_date.year - start_month.year) * 12 + (vest_date.month - start_month.month)
            if index > last_index:
                continue
            gross = money(price * shares)
            net = after_sell_to_cover(gross)
            if net > ZERO:
                key = max(index, 1)
                lumps[key] = lumps.get(key, ZERO) + net
            year_gross, year_net = by_year.get(vest_date.year, (ZERO, ZERO))
            by_year[vest_date.year] = (year_gross + gross, year_net + net)
            if today < vest_date <= year_on:
                next_12_months += net
    included = knob is not False
    echo = VestsOut(
        included=included,
        price=price,
        price_as_of=quote_date(quoted_at),
        withholding_rate=SUPPLEMENTAL,
        next_12_months=next_12_months,
        by_year=[
            VestYearOut(year=year, gross=gross, after_withholding=net)
            for year, (gross, net) in sorted(by_year.items())
        ],
        stops=stops,
    )
    return _Vests(echo=echo, lumps=lumps if included else {})


# The user's cut-offs (2026-09-23 spec §R3): the share of paths that last through the plan-until
# year reads on track from 90 %, borderline from 75 %, at risk below.
ON_TRACK_FROM = Decimal("0.90")
BORDERLINE_FROM = Decimal("0.75")
SET_RETIREMENTS_REASON = "Set retirement months to see whether the money lasts."
NEEDS_SPEND_REASON = "Withdrawals need an annual spend — type one or enter spending history."


def money_lasts_verdict(probability: Decimal) -> str:
    """Judged on the EXACT fraction of paths (k / 500), so 450 paths is exactly on track."""
    if probability >= ON_TRACK_FROM:
        return "on_track"
    if probability >= BORDERLINE_FROM:
        return "borderline"
    return "at_risk"


def _money_lasts(
    plan: _Plan,
    retirements: list[RetirementOut],
    plan_until: int,
    months: list[date],
    line_depletion: int | None,
    mc: MonteCarloResult | None,
) -> MoneyLastsOut:
    """ "Money lasts" from the SAME simulation as the FI dates (spec §R3).

    With no drawdown there is nothing to judge, and `reason` says what is missing — in the
    order the user would fix it: retirement months first (none at all, then the earners
    without one), then the annual spend the withdrawal is. A plan-until year whose December
    comes before the withdrawals begin is refused the same way. Otherwise the success share
    counts every path never depleted through December of the plan-until year — a depletion
    in ANY phase fails, since the clamp holds everywhere (a negative typed contribution can
    empty the balance before retirement) — and the 9-in-10 month is the 10th percentile of
    the depletion months ("never" = +∞, reach_percentile's rule).
    """
    horizon_end = months[-1]
    if plan.drawdown is None:
        if not retirements:
            reason = SET_RETIREMENTS_REASON
        elif plan.missing:
            verb = "has" if len(plan.missing) == 1 else "have"
            reason = (
                "Withdrawals start once everyone with a paycheck has a retirement month — "
                f"{names_phrase(plan.missing)} {verb} none."
            )
        else:
            reason = NEEDS_SPEND_REASON
        return MoneyLastsOut(plan_until=plan_until, horizon_end=horizon_end, reason=reason)
    if date(plan_until, 12, 1) < plan.drawdown.start_month:
        return MoneyLastsOut(
            plan_until=plan_until,
            horizon_end=horizon_end,
            reason=(
                f"{plan_until} is before withdrawals begin "
                f"({plan.drawdown.start_month:%b %Y}) — choose a later year."
            ),
        )
    deterministic = None if line_depletion is None else months[line_depletion]
    if mc is None:
        return MoneyLastsOut(
            plan_until=plan_until,
            horizon_end=horizon_end,
            deterministic_depleted_month=deterministic,
        )
    through = december_index(months[0], plan_until)
    probability = Decimal(survival_count(mc.depletion_indices, through)) / Decimal(SIMULATIONS)
    p10 = reach_percentile(mc.depletion_indices, 10)
    return MoneyLastsOut(
        plan_until=plan_until,
        probability=quantize_pct(probability),
        verdict=money_lasts_verdict(probability),
        lasts_until_p10=None if p10 is None else months[min(p10, len(months) - 1)],
        horizon_end=horizon_end,
        deterministic_depleted_month=deterministic,
    )


async def _resolve_plan_until(
    db: AsyncSession,
    knob: int | None,
    start_month: date,
    years: int,
    warnings: list[str],
) -> tuple[int, str, int]:
    """(year, source, effective years) for the plan-until year (2026-09-23 spec §R3).

    The knob wins and 422s outside [the start year, the latest year the projection can
    reach]. Without it, the year stored in Settings › Plan assumptions (§R11) — unless it has
    passed, or (a hand-edited row) lies past the reach, when it is ignored with a warning —
    and otherwise the latest year whose December is on the axis, which never lengthens it
    and so keeps every array byte-identical. A year whose December is past the axis
    lengthens the horizon to the whole years that reach it (never past MAX_YEARS: the bounds
    above make sure) and says so.
    """
    latest = max_plan_until_year(start_month)
    default = latest_december_year(start_month, years * 12)
    if knob is not None:
        if knob < start_month.year:
            raise HTTPException(
                status_code=422, detail=f"plan_until must be {start_month.year} or later"
            )
        if knob > latest:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"plan_until must be {latest} or earlier — the projection runs at most "
                    f"{MAX_YEARS} years"
                ),
            )
        year, source = knob, "knob"
    else:
        stored = await read_plan_until_year(db)
        year, source = default, "default"
        if stored is not None and stored < start_month.year:
            warnings.append(
                f"The plan-until year in Settings ({stored}) has passed — using {default}."
            )
        elif stored is not None and stored > latest:
            warnings.append(
                f"The plan-until year in Settings ({stored}) is past the projection's "
                f"{MAX_YEARS}-year reach — using {default}."
            )
        elif stored is not None:
            year, source = stored, "setting"
    needed = math.ceil(december_index(start_month, year) / 12)
    if needed > years:
        warnings.append(f"The horizon was lengthened to {needed} years to reach the end of {year}.")
        years = needed
    return year, source, years


async def _base_snapshot(db: AsyncSession, today: date) -> SnapshotState | None:
    """THE one read of "which snapshot is now" (2026-09-23 spec §R5): the CURRENT snapshot by
    lane K's rule (services/snapshot_state.py, its one owner) — the latest whose month is at
    most the month after today's. So Oct 1's balances typed on Sep 22 are the starting point,
    as of Sep 22 and provisional, while a snapshot further ahead never is. Its as-of date is
    also where the vests are cut (spec §R4)."""
    current, _previous = current_and_previous(await load_snapshot_states(db, today), today)
    return current


async def _investable_total(db: AsyncSession, snapshot_id: int) -> Decimal:
    """Non-component pre/post-tax + taxable + equity balances of ONE snapshot — the sum
    net_worth_calc.investable_base runs once it has picked its snapshot, taken here by id so
    the snapshot is picked exactly once (spec §R5)."""
    total = (
        await db.execute(
            select(func.coalesce(func.sum(AccountBalance.balance), 0))
            .join(Account, Account.id == AccountBalance.account_id)
            .where(
                AccountBalance.snapshot_id == snapshot_id,
                Account.is_component.is_(False),
                Account.group.in_(INVESTABLE_GROUPS),
            )
        )
    ).scalar_one()
    return Decimal(total)


@router.get("", response_model=ProjectionOut)
async def projection(
    annual_return: Annotated[Decimal | None, Query()] = None,
    monthly_contribution: Annotated[Decimal | None, Query()] = None,
    annual_spend: Annotated[Decimal | None, Query()] = None,
    swr: Annotated[Decimal | None, Query()] = None,
    years: YearsQuery = DEFAULT_YEARS,
    volatility: Annotated[Decimal | None, Query()] = None,
    inflation: Annotated[Decimal | None, Query()] = None,
    contribution_growth: Annotated[Decimal | None, Query()] = None,
    retire: RetireQuery = None,
    plan_until: Annotated[int | None, Query()] = None,
    vests: Annotated[bool | None, Query()] = None,
    db: AsyncSession = Depends(get_db),
) -> Response:
    """The answer as JSON bytes (`response_model` documents the shape). Direct callers use
    `run_projection`, never this function: its parameters are FastAPI's, and its body is
    the serialized answer."""
    knobs = ProjectionKnobs(
        annual_return=annual_return,
        monthly_contribution=monthly_contribution,
        annual_spend=annual_spend,
        swr=swr,
        years=years,
        volatility=volatility,
        inflation=inflation,
        contribution_growth=contribution_growth,
        retire=tuple(retire or ()),
        plan_until=plan_until,
        vests=vests,
    )
    return Response(content=await projection_json(db, knobs), media_type="application/json")


async def projection_json(db: AsyncSession, knobs: ProjectionKnobs) -> bytes:
    """The serialized answer for `knobs` — by alias, the wire's own spelling — from the result
    cache (2026-09-23 spec §R9), keyed by the data fingerprint, the product day and the
    normalized knobs; a miss builds it."""
    today = clock.product_today()  # the ONLY clock read (module docstring)

    async def build() -> bytes:
        model = await _build(db, knobs, today)
        return model.model_dump_json(by_alias=True).encode()

    return await cached_projection(db, (today, knobs.cache_key()), build)


async def run_projection(db: AsyncSession, knobs: ProjectionKnobs) -> ProjectionOut:
    """The route's answer for a DIRECT caller (assistant_context): the same bytes, validated
    into a model of the caller's own (2026-09-23 spec §R9)."""
    return ProjectionOut.model_validate_json(await projection_json(db, knobs))


async def _build(db: AsyncSession, knobs: ProjectionKnobs, today: date) -> ProjectionOut:
    start_month = today.replace(day=1)

    # The starting balance and the snapshot it stands on, picked ONCE. A missing snapshot is
    # the ESPP modeler's 404 class: "nothing to model yet", answered by the page's empty state.
    base = await _base_snapshot(db, today)
    if base is None:
        raise HTTPException(status_code=404, detail=NO_SNAPSHOTS)
    starting = await _investable_total(db, base.id)

    warnings: list[str] = []

    annual_return = knobs.annual_return
    if annual_return is None:
        annual_return = DEFAULT_ANNUAL_RETURN
    else:
        if not annual_return.is_finite() or not RETURN_MIN <= annual_return <= RETURN_MAX:
            raise HTTPException(status_code=422, detail=RETURN_MESSAGE)
        annual_return = quantize_pct(annual_return)

    years = knobs.years
    if not YEARS_MIN <= years <= YEARS_MAX:
        # FastAPI's YearsQuery fences HTTP; this is a direct caller's fence.
        raise HTTPException(status_code=422, detail=YEARS_MESSAGE)

    # ONE window for both derivations (spec §3): the last twelve months with spending rows
    # AND take-home. Before this, the spend mean and the savings mean averaged DIFFERENT
    # months — and the spend mean counted a zero-filled month as a month of no spending.
    savings_rows = await cached_month_savings(db)
    review_book = await cached_review_book(db)
    window, planning_receipt = planning_window(savings_rows, review_book)
    has_cashflow = any(row.net_pay is not None for row in savings_rows)
    has_spending = any(row.has_spending_rows for row in savings_rows)
    monthly_contribution = knobs.monthly_contribution
    annual_spend = knobs.annual_spend
    # Read BEFORE the two blocks below overwrite the knobs with their resolved values.
    derives = monthly_contribution is None or annual_spend is None
    # The echo describes a DERIVATION, so it is null when the user typed both knobs —
    # `contribution_breakdown`'s rule exactly. A window printed beside two typed numbers
    # would claim something was averaged when nothing was.
    derived_window = (
        DerivedWindowOut(
            from_month=planning_receipt.from_month,
            to_month=planning_receipt.to_month,
            months=len(window),
        )
        if window and derives
        else None
    )
    if planning_receipt is not None and window and derives:
        if planning_receipt.unreviewed_history_count:
            warnings.append(
                f"Planning inputs include {planning_receipt.unreviewed_history_count} "
                "unreviewed historical months."
            )
        if planning_receipt.excluded:
            warnings.append(
                f"{len(planning_receipt.excluded)} months in the 12-calendar-month planning "
                "window are excluded; older months do not replace them."
            )
    if not window and has_cashflow and has_spending and derives:
        # BOTH halves are on file and no month carries both — the one case the more
        # specific sentences below cannot describe. A book missing a half is named by
        # NO_CASHFLOW_WARNING or NO_SPEND_WARNING instead, so nothing says it twice.
        warnings.append(NO_MATCHED_MONTHS_WARNING)

    household = await _load_household(db, today)

    contribution_breakdown: ContributionBreakdownOut | None = None
    if monthly_contribution is None:
        payroll, employer, by_person, payroll_warnings = _payroll_savings(household)
        warnings.extend(payroll_warnings)
        if not window:
            cash_part = ZERO
            if not has_cashflow:
                warnings.append(
                    NO_CASHFLOW_WARNING if payroll <= ZERO else NO_CASHFLOW_PAYROLL_WARNING
                )
        else:
            # Every matched row has a cash figure by construction (net pay is on file).
            # Sum the EMITTED month figures, divide, quantize ONCE at the end — the
            # savings service's rounding contract, so this mean is the same money the
            # matrix printed.
            total_cash = sum(
                (row.cash_savings for row in window if row.cash_savings is not None), Decimal(0)
            )
            cash_part = (total_cash / len(window)).quantize(CENT, rounding=ROUND_HALF_UP)
        # Both halves are cents already, so the sum needs no second rounding; quantize
        # anyway so a Decimal('0') cash part still echoes as "0.00".
        monthly_contribution = (cash_part + payroll + employer).quantize(
            CENT, rounding=ROUND_HALF_UP
        )
        contribution_breakdown = ContributionBreakdownOut(
            cash=cash_part,
            payroll=payroll,
            employer=employer,
            total=monthly_contribution,
            by_person=by_person,
        )
    else:
        monthly_contribution = quantize_money(
            monthly_contribution, "monthly_contribution", max_abs=CONTRIBUTION_MAX_ABS
        )

    if annual_spend is None:
        # LIVING spend only (spec §2): an income-tax payment and a transfer to a brokerage
        # are both money that must not inflate an FI target. Sum the EMITTED months,
        # divide, x12, quantize ONCE — never a rounded mean multiplied out.
        derived_spend = (
            None
            if not window
            else sum((row.living_spend for row in window), Decimal(0)) / len(window) * 12
        )
        if derived_spend is None or derived_spend <= 0:
            annual_spend = None
            # Only when there is genuinely nothing to average. A book that HAS spending
            # but no matched month is already explained — by NO_MATCHED_MONTHS_WARNING
            # when take-home exists, by NO_CASHFLOW_WARNING when it does not — and
            # "no spending history" would there be flatly untrue.
            if not has_spending:
                warnings.append(NO_SPEND_WARNING)
        else:
            annual_spend = derived_spend.quantize(CENT, rounding=ROUND_HALF_UP)
    else:
        annual_spend = quantize_money(annual_spend, "annual_spend", max_abs=SPEND_MAX_ABS)
        if annual_spend <= 0:
            raise HTTPException(status_code=422, detail="annual_spend must be positive")

    swr = knobs.swr
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
    volatility = knobs.volatility
    if volatility is None:
        volatility = DEFAULT_VOLATILITY
    elif not volatility.is_finite() or not Decimal(0) <= volatility <= Decimal(1):
        raise HTTPException(status_code=422, detail=VOLATILITY_MESSAGE)
    volatility = quantize_pct(volatility)

    inflation = knobs.inflation
    if inflation is None:
        inflation = DEFAULT_INFLATION
    elif not inflation.is_finite() or not INFLATION_MIN <= inflation <= INFLATION_MAX:
        raise HTTPException(status_code=422, detail=INFLATION_MESSAGE)
    inflation = quantize_pct(inflation)

    contribution_growth = knobs.contribution_growth
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

    # The plan-until year is resolved BEFORE the axis: a later year lengthens it, and the
    # retirement months are validated against the effective one (spec §R3).
    plan_until, plan_until_source, years = await _resolve_plan_until(
        db, knobs.plan_until, start_month, years, warnings
    )
    month_count = years * 12
    months = _months_from(start_month, month_count)
    retirements = _resolve_retirements(household, knobs.retire, months, years)
    # The SAME resets and withdrawal feed the deterministic line and the fan, which is what
    # keeps the bands wrapped around the line they belong to. `months` is contiguous from
    # t0, so the horizon check above guarantees every retirement is on the axis. Levels and
    # the withdrawal are TODAY's-dollars figures exactly like `monthly_contribution`, and
    # they cross the real-terms conversion below untouched: the engine runs in real terms.
    plan = _plan_phases(
        household, retirements, monthly_contribution, annual_spend, months, warnings
    )
    # Vests are cut at the base's as-of date — after today when the base has none (spec §R4).
    vests = await _scheduled_vests(
        db,
        knobs.vests,
        base.as_of if base.as_of is not None else today,
        today,
        months,
        household,
        retirements,
        warnings,
    )
    # Every ARRAY below runs on `real_return` (= annual_return under an EXPLICIT
    # inflation=0, which is what reproduces the pre-Monte-Carlo arrays byte for byte);
    # the ECHOED `annual_return` stays the NOMINAL value the user provided or the default
    # — the echo is what seeds the form, and `inflation` echoes separately so the page can
    # reconstruct the real rate.
    line = project_path(
        starting,
        monthly_contribution,
        real_return,
        month_count,
        real_growth,
        resets=plan.resets,
        withdrawal=plan.withdrawal,
        lumps=vests.lumps,
    )
    projected = line.points
    # The coast line: the same growth with the contributions turned off — the distance
    # between the two lines is what the saving is buying. No contributions, vests or
    # withdrawals (spec §R2), so Coast FI keeps its meaning.
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
    mc: MonteCarloResult | None = None
    if volatility > 0:
        # Off the event loop (spec §R9). The walk is pure and seeded, so the thread's bands are
        # the inline run's, bit for bit (test_montecarlo pins it). `base_months` is the `years`
        # knob's horizon: the months a later plan-until year adds come from a second stream, so
        # lengthening the run never re-deals a path (2026-09-24 review I1).
        mc = await anyio.to_thread.run_sync(
            partial(
                simulate,
                starting,
                monthly_contribution,
                real_return,
                volatility,
                real_growth,
                month_count,
                fi_target,
                resets=plan.resets,
                withdrawal=plan.withdrawal,
                lumps=vests.lumps,
                base_months=knobs.years * 12,
            ),
            limiter=MC_LIMITER,
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
            fi_month_p10 = None if p10 is None else months[min(p10, month_count)]
            fi_month_p50 = None if p50 is None else months[min(p50, month_count)]
            fi_month_p90 = None if p90 is None else months[min(p90, month_count)]

    money_lasts = _money_lasts(plan, retirements, plan_until, months, line.depletion_index, mc)

    # The budgets' own annual figure rides beside the derived one (spec §4): a preset the
    # card can offer, never a replacement for what the data derived. The echo keeps THIS
    # route's clock — `start_month`, from the module's one clock read — and `budget_month`
    # below says which month was resolved.
    budget_total = await living_budget_total(db, start_month)
    budget_annual_spend = None if budget_total is None else budget_total * 12

    return ProjectionOut(
        starting_balance=starting,
        base_month=base.month,
        base_as_of=base.as_of,
        base_recorded_on=base.recorded_on,
        base_provisional=base.provisional,
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
        derived_window=derived_window,
        budget_annual_spend=budget_annual_spend,
        budget_month=None if budget_annual_spend is None else start_month,
        phases=plan.phases,
        drawdown=plan.drawdown,
        plan_until=plan_until,
        plan_until_source=plan_until_source,
        money_lasts=money_lasts,
        vests=vests.echo,
    )
