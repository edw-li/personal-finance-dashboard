"""Paycheck API: the profile editor and the per-check waterfall (spec §5).

Writers quantize to the column scale BEFORE the first insert (money.py's bounds
vocabulary), so an over-scale value can never surface as a bare sqlstate 22003: salary
Numeric(12,2) -> 10^10, dental/HSA Numeric(8,2) -> 10^6 (only SIX integer digits), the
five pcts Numeric(10,9) with the 0..1 mis-scale guard. `pay_periods_per_year` carries the
one rule the whole module depends on — 1 <= n <= 366, THE divide-by-zero guard from the
Plan 1 forward note, since `gross = annual_salary / pay_periods_per_year`.

The read side never rejects stored data OVER ITS SCALE: `paycheck_calc` returns
full-precision Decimals and `half_up2` is a plain quantize, never a bounded one. Its one
refusal is the divide-by-zero itself — a hand-written 0 periods 422s rather than 500s,
because there is no number the breakdown could show. The PRODUCT clock (services/clock.py,
never the container's UTC day) is read HERE and only here — the calc module takes no
clock — and it decides two things off that single read: which profile is current when no
`profile_id` is given, and which year's contribution limits the pace rows are measured
against. Both would be wrong for the PT evening hours the container already calls
tomorrow, and on 31 December they would be a YEAR wrong (audit item 31).
"""

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.app_settings import read_espp_discount
from app.api.deps import get_current_user
from app.database import get_db
from app.limit_keys import LIMIT_401K_ELECTIVE, LIMIT_ESPP_423
from app.models import ContributionLimit, EsppPeriod, PaycheckProfile, Person
from app.schemas.paycheck import (
    BreakdownOut,
    ChangedField,
    PaceItemOut,
    PreviewBlock,
    PreviewIn,
    PreviewLines,
    PreviewOut,
    PreviewPace,
    ProfileIn,
    ProfileOut,
    ProfileOverrides,
    ProfileUpdate,
)
from app.services import clock
from app.services.espp_calc import StoredPeriod, plan_year_rows
from app.services.espp_pace import espp_pace_item
from app.services.limit_check import PaceItem, employer_match, paycheck_pace
from app.services.money import (
    MONEY_MAX_ABS_12_2,
    _quantize_bounded,
    quantize_money,
    require_reasonable_date,
)
from app.services.pace_walk import in_force, walk
from app.services.paycheck_calc import (
    MONTHS_PER_YEAR,
    PAYROLL_SAVING_KEYS,
    WATERFALL_KEYS,
    breakdown,
    half_up2,
)
from app.services.people import load_people, primary_person

router = APIRouter(prefix="/paycheck", tags=["paycheck"], dependencies=[Depends(get_current_user)])

ZERO = Decimal("0")
PCT_QUANTUM_9 = Decimal("0.000000001")
# Numeric(10,9) really only holds ONE integer digit; the 0..1 check below is what enforces
# that. This bound is only the NaN / absurd-magnitude fence, kept loose so a
# `withholding_pct=33.4` (meaning 33.4%) reports the mis-scale, not a "10^1" complaint.
PCT_INPUT_MAX_ABS = Decimal(10) ** 10
# dental_vision_per_check / hsa_per_check are Numeric(8,2): six integer digits, not ten.
PER_CHECK_MAX_ABS = Decimal(10) ** 6
# Weekly, bi-weekly, semi-monthly, monthly... and daily on a leap year as the ceiling.
# The floor is what stops a division by zero one line into the waterfall.
MIN_PAY_PERIODS = 1
MAX_PAY_PERIODS = 366
# One string, two callers (the writers and the breakdown's stored-data guard) — they must
# never drift, because they are the same rule read from opposite ends.
PAY_PERIODS_MESSAGE = (
    f"pay_periods_per_year must be between {MIN_PAY_PERIODS} and {MAX_PAY_PERIODS}"
)
# The PK is an int4: an out-of-range id would reach asyncpg as a bare DataError (a 500),
# so it is fenced at the boundary — taxes.py's YearPath precedent, Plan 1 forward note.
INT32_MAX = 2**31 - 1
IdPath = Annotated[int, Path(ge=1, le=INT32_MAX)]
IdQuery = Annotated[int | None, Query(ge=1, le=INT32_MAX)]

PCT_FIELDS = (
    "trad_401k_pct",
    "roth_401k_pct",
    "after_tax_401k_pct",
    "espp_pct",
    "withholding_pct",
)
# Withholding is a tax, not a contribution — it is NOT part of the >100% check.
CONTRIBUTION_FIELDS = ("trad_401k_pct", "roth_401k_pct", "after_tax_401k_pct", "espp_pct")
MATCH_RATE_FIELDS = ("match_rate_1", "match_rate_2")
MATCH_BAND_FIELDS = ("match_band_1", "match_band_2")
MATCH_FIELDS = (*MATCH_RATE_FIELDS, *MATCH_BAND_FIELDS)
# 2, not 1: a 200 % match is a real plan shape, so 1.0 is not the ceiling. The mis-scale
# guard is still `_validated_pct`'s — a 50 meant as 50 % must never reach the formula.
MATCH_RATE_MAX = Decimal(2)
CONTRIBUTIONS_WARNING = "contribution percentages exceed 100%"
NEGATIVE_NET_WARNING = "net pay is negative"
# Which HSA cap applies to this person. One tuple, one message — the message names the
# whole vocabulary, so it never needs reading alongside the code (comp.py's GRANT_KINDS).
HSA_COVERAGES = ("none", "self", "family")
HSA_COVERAGE_MESSAGE = "hsa_coverage must be 'none', 'self' or 'family'"
# The employer's HSA deposit: an annual figure for the employee's own coverage plus a
# per-head add-on for each ADDITIONAL covered individual (2026-09-07 spec). The two money
# fields wear the per-check columns' own Numeric(8,2) bound, so `_non_negative_per_check`
# validates them WORD FOR WORD — one rule, one sentence, for every Numeric(8,2) on the row.
EMPLOYER_HSA_MONEY_FIELDS = ("hsa_employer_annual", "hsa_employer_per_dependent")
EMPLOYER_HSA_FIELDS = (*EMPLOYER_HSA_MONEY_FIELDS, "hsa_dependents")
# A typo fence, not an opinion about family size: 20 is far past any real HSA roster, and a
# 25 typed into the count is the mistake worth catching. The message names the whole range
# (PAY_PERIODS_MESSAGE's shape), so it never needs reading alongside the code.
MAX_HSA_DEPENDENTS = 20
HSA_DEPENDENTS_MESSAGE = f"hsa_dependents must be between 0 and {MAX_HSA_DEPENDENTS}"
# A stored profile must have an owner (person_id is NOT NULL), and only a database whose
# roster was never seeded has nobody to default to.
NO_PRIMARY_PERSON_MESSAGE = "household has no primary person"

# Every field a preview may override, in the order `changed` reports them, with the labels
# the sandbox prints (the profile form's own words — percents named as percents).
SCENARIO_FIELDS = (
    "annual_salary",
    "pay_periods_per_year",
    *PCT_FIELDS,
    "dental_vision_per_check",
    "hsa_per_check",
    "hsa_coverage",
    *MATCH_FIELDS,
    *EMPLOYER_HSA_FIELDS,
)
FIELD_LABELS = {
    "annual_salary": "Annual salary",
    "pay_periods_per_year": "Pay periods per year",
    "trad_401k_pct": "Traditional 401(k) %",
    "roth_401k_pct": "Roth 401(k) %",
    "after_tax_401k_pct": "After-tax 401(k) %",
    "espp_pct": "ESPP %",
    "withholding_pct": "Withholding %",
    "dental_vision_per_check": "Dental & vision",
    "hsa_per_check": "HSA",
    "hsa_coverage": "HSA coverage",
    "match_rate_1": "Match rate (first band)",
    "match_band_1": "Match band 1",
    "match_rate_2": "Match rate (second band)",
    "match_band_2": "Match band 2",
    "hsa_employer_annual": "Employer HSA (annual)",
    "hsa_employer_per_dependent": "Employer HSA per dependent",
    "hsa_dependents": "Covered dependents",
}


def _positive_salary(value: Decimal, field: str) -> Decimal:
    quantized = quantize_money(value, field, max_abs=MONEY_MAX_ABS_12_2) + ZERO
    if quantized <= 0:
        raise HTTPException(status_code=422, detail=f"{field} must be positive")
    return quantized


def _non_negative_per_check(value: Decimal, field: str) -> Decimal:
    quantized = quantize_money(value, field, max_abs=PER_CHECK_MAX_ABS) + ZERO
    # Check the RAW value too: "-0.001" quantizes to -0.00, which compares == 0
    # (portfolio.py's _validated_annual_dividend posture).
    if value < 0 or quantized < 0:
        raise HTTPException(status_code=422, detail=f"{field} must be >= 0")
    return quantized


def _validated_pct(value: Decimal, field: str) -> Decimal:
    # money.py owns the 422 vocabulary and the NaN / over-bound pre-checks; it just has no
    # public 9dp quantizer, and its module is out of this task's scope — calling the
    # shared helper beats minting a second phrasing for the same error (espp.py's note).
    quantized = _quantize_bounded(value, field, PCT_QUANTUM_9, PCT_INPUT_MAX_ABS) + ZERO
    if value < 0 or not 0 <= quantized <= 1:
        # The Plan 1 mis-scale guard: a 13 meant as 13% must never reach the waterfall
        # (and Numeric(10,9) could not store it anyway).
        raise HTTPException(status_code=422, detail=f"{field} must be between 0 and 1")
    return quantized


def _validated_match_rate(value: Decimal, field: str) -> Decimal:
    """A match rate at the pcts' own 9 dp, bounded at 2 rather than 1: a 200 % match is a
    real plan, while a 50 meant as 50 % is still the Plan 1 mis-scale mistake."""
    quantized = _quantize_bounded(value, field, PCT_QUANTUM_9, PCT_INPUT_MAX_ABS) + ZERO
    if value < 0 or not 0 <= quantized <= MATCH_RATE_MAX:
        raise HTTPException(status_code=422, detail=f"{field} must be between 0 and 2")
    return quantized


def _validated_band(value: Decimal, field: str) -> Decimal:
    """Dollars of elective deferrals a rate applies to — the salary column's own bound."""
    quantized = quantize_money(value, field, max_abs=MONEY_MAX_ABS_12_2) + ZERO
    if value < 0 or quantized < 0:
        raise HTTPException(status_code=422, detail=f"{field} must be >= 0")
    return quantized


def _validated_coverage(value: str) -> str:
    if value not in HSA_COVERAGES:
        raise HTTPException(status_code=422, detail=HSA_COVERAGE_MESSAGE)
    return value


def _validated_dependents(value: int) -> int:
    """How many people BEYOND the employee the employer's HSA deposit covers — a small
    count, not money, so it gets the pay-periods treatment rather than a quantizer."""
    if not 0 <= value <= MAX_HSA_DEPENDENTS:
        raise HTTPException(status_code=422, detail=HSA_DEPENDENTS_MESSAGE)
    return value


def _validated_profile(
    effective_date: date,
    annual_salary: Decimal,
    pay_periods_per_year: int,
    dental_vision_per_check: Decimal,
    hsa_per_check: Decimal,
    hsa_coverage: str,
    hsa_employer_annual: Decimal,
    hsa_employer_per_dependent: Decimal,
    hsa_dependents: int,
    pcts: dict[str, Decimal],
    match: dict[str, Decimal],
) -> dict:
    """One profile's stored columns, validated as a WHOLE row (Plan 4 house law) so a
    PATCH can hand over the merged values and get the same rules as a POST.

    Raises before it returns anything, so a rejected request leaves no partial state.
    """
    require_reasonable_date(effective_date, "effective_date")
    if not MIN_PAY_PERIODS <= pay_periods_per_year <= MAX_PAY_PERIODS:
        raise HTTPException(status_code=422, detail=PAY_PERIODS_MESSAGE)
    return {
        "effective_date": effective_date,
        "annual_salary": _positive_salary(annual_salary, "annual_salary"),
        "pay_periods_per_year": pay_periods_per_year,
        "dental_vision_per_check": _non_negative_per_check(
            dental_vision_per_check, "dental_vision_per_check"
        ),
        "hsa_per_check": _non_negative_per_check(hsa_per_check, "hsa_per_check"),
        "hsa_coverage": _validated_coverage(hsa_coverage),
        "hsa_employer_annual": _non_negative_per_check(hsa_employer_annual, "hsa_employer_annual"),
        "hsa_employer_per_dependent": _non_negative_per_check(
            hsa_employer_per_dependent, "hsa_employer_per_dependent"
        ),
        "hsa_dependents": _validated_dependents(hsa_dependents),
        **{name: _validated_pct(pcts[name], name) for name in PCT_FIELDS},
        **{name: _validated_match_rate(match[name], name) for name in MATCH_RATE_FIELDS},
        **{name: _validated_band(match[name], name) for name in MATCH_BAND_FIELDS},
    }


async def _get_profile(db: AsyncSession, profile_id: int) -> PaycheckProfile:
    profile = await db.get(PaycheckProfile, profile_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="paycheck profile not found")
    return profile


async def _resolve_person_id(db: AsyncSession, person_id: int | None) -> int | None:
    """Who a request is about: the person named, or the PRIMARY when none is.

    Absent means primary everywhere on this router — the wire's back-compat rule, since
    every pre-P3 caller passes nothing and means the one earner the app modeled.

    None comes back ONLY on a database whose roster was never seeded (a create_all test
    database). `paycheck_profiles.person_id` is NOT NULL, so such a database can hold no
    profiles at all: reads turn that into their own empty answer, writes into a 422.
    """
    if person_id is None:
        primary = primary_person(await load_people(db))
        return None if primary is None else primary.id
    # 404 in the household router's own words — an unknown person is a missing thing, not
    # a malformed request. The int4 fence lives on the wire types (IdQuery / ProfileIn),
    # so this `get` can never reach asyncpg with an out-of-range id.
    if await db.get(Person, person_id) is None:
        raise HTTPException(status_code=404, detail="person not found")
    return person_id


async def _require_person(db: AsyncSession, person_id: int | None) -> int:
    """The WRITE side of `_resolve_person_id`: a stored profile must have an owner."""
    resolved = await _resolve_person_id(db, person_id)
    if resolved is None:
        raise HTTPException(status_code=422, detail=NO_PRIMARY_PERSON_MESSAGE)
    return resolved


async def _require_free_effective_date(
    db: AsyncSession, person_id: int, effective_date: date
) -> None:
    """The unique key, checked in words first — and scoped to the OWNER: two people may
    each have a profile effective the same day, so the 409 asks about ONE timeline."""
    taken = (
        (
            await db.execute(
                select(PaycheckProfile).where(
                    PaycheckProfile.person_id == person_id,
                    PaycheckProfile.effective_date == effective_date,
                )
            )
        )
        .scalars()
        .first()
    )
    if taken is not None:
        raise HTTPException(
            status_code=409, detail=f"a paycheck profile for {effective_date} already exists"
        )


def _merged(provided: dict, key: str, current):
    """PATCH merge for a NOT NULL column: absent keeps it, and an explicit null reads as
    a no-op request rather than an error (portfolio.py's update_security posture). Every
    stored column here except `notes` is NOT NULL, so this covers all of them."""
    value = provided.get(key, current)
    return current if value is None else value


@router.get("/profiles", response_model=list[ProfileOut])
async def list_profiles(db: AsyncSession = Depends(get_db)) -> list[PaycheckProfile]:
    # Newest first — the page opens on the profile in force. ONE list for the whole
    # household (the UI groups it by person_id). effective_date is only unique PER PERSON
    # now, so `id` breaks the tie two people sharing a date would otherwise leave to the
    # planner; on a one-person database no tie exists and the order is unchanged.
    rows = list(
        (
            await db.execute(
                select(PaycheckProfile).order_by(
                    PaycheckProfile.effective_date.desc(), PaycheckProfile.id
                )
            )
        ).scalars()
    )
    await _mark_in_force(db, rows, clock.product_today())
    return rows


@router.post("/profiles", response_model=ProfileOut, status_code=201)
async def create_profile(body: ProfileIn, db: AsyncSession = Depends(get_db)) -> PaycheckProfile:
    person_id = await _require_person(db, body.person_id)
    fields = _validated_profile(
        effective_date=body.effective_date,
        annual_salary=body.annual_salary,
        pay_periods_per_year=body.pay_periods_per_year,
        dental_vision_per_check=body.dental_vision_per_check,
        hsa_per_check=body.hsa_per_check,
        hsa_coverage=body.hsa_coverage,
        hsa_employer_annual=body.hsa_employer_annual,
        hsa_employer_per_dependent=body.hsa_employer_per_dependent,
        hsa_dependents=body.hsa_dependents,
        pcts={name: getattr(body, name) for name in PCT_FIELDS},
        match={name: getattr(body, name) for name in MATCH_FIELDS},
    )
    # (person_id, effective_date) is the natural key. Plain check-then-409: two concurrent
    # creates of the same pair would race into an IntegrityError, an accepted house class
    # for a single-user app.
    await _require_free_effective_date(db, person_id, fields["effective_date"])
    profile = PaycheckProfile(person_id=person_id, notes=body.notes, **fields)
    db.add(profile)
    await db.commit()
    await _mark_in_force(db, [profile], clock.product_today())
    return profile


@router.patch("/profiles/{profile_id}", response_model=ProfileOut)
async def update_profile(
    profile_id: IdPath, body: ProfileUpdate, db: AsyncSession = Depends(get_db)
) -> PaycheckProfile:
    profile = await _get_profile(db, profile_id)
    provided = body.model_dump(exclude_unset=True)
    fields = _validated_profile(
        effective_date=_merged(provided, "effective_date", profile.effective_date),
        annual_salary=_merged(provided, "annual_salary", profile.annual_salary),
        pay_periods_per_year=_merged(
            provided, "pay_periods_per_year", profile.pay_periods_per_year
        ),
        dental_vision_per_check=_merged(
            provided, "dental_vision_per_check", profile.dental_vision_per_check
        ),
        hsa_per_check=_merged(provided, "hsa_per_check", profile.hsa_per_check),
        hsa_coverage=_merged(provided, "hsa_coverage", profile.hsa_coverage),
        hsa_employer_annual=_merged(provided, "hsa_employer_annual", profile.hsa_employer_annual),
        hsa_employer_per_dependent=_merged(
            provided, "hsa_employer_per_dependent", profile.hsa_employer_per_dependent
        ),
        hsa_dependents=_merged(provided, "hsa_dependents", profile.hsa_dependents),
        pcts={name: _merged(provided, name, getattr(profile, name)) for name in PCT_FIELDS},
        match={name: _merged(provided, name, getattr(profile, name)) for name in MATCH_FIELDS},
    )
    if fields["effective_date"] != profile.effective_date:
        # The row's OWN owner: a PATCH never moves a profile between people.
        await _require_free_effective_date(db, profile.person_id, fields["effective_date"])
    # Every raise is behind us — mutate only now, or a 422 halfway through a multi-field
    # PATCH would leave part of the row dirty for the next autoflush.
    for name, value in fields.items():
        setattr(profile, name, value)
    if "notes" in provided:
        profile.notes = provided["notes"]  # nullable: an explicit null really clears it
    await db.commit()
    await _mark_in_force(db, [profile], clock.product_today())
    return profile


@router.delete("/profiles/{profile_id}", status_code=204)
async def delete_profile(profile_id: IdPath, db: AsyncSession = Depends(get_db)) -> Response:
    await db.delete(await _get_profile(db, profile_id))
    await db.commit()
    return Response(status_code=204)


async def _default_profile(db: AsyncSession, person_id: int, today: date) -> PaycheckProfile | None:
    """THIS PERSON's profile in force: their latest one effective today or earlier.

    A brand-new user only has a FUTURE profile (the raise lands next month), so rather
    than 404 on a table that is not empty, fall back to the earliest future one — the
    page then models the check that is coming.

    One profile in force PER PERSON, and the timelines never mix: a partner whose first
    profile starts next year does not borrow the primary's current one. `today` is a
    parameter, never a clock read — see the module docstring.
    """
    current = (
        (
            await db.execute(
                select(PaycheckProfile)
                .where(
                    PaycheckProfile.person_id == person_id,
                    PaycheckProfile.effective_date <= today,
                )
                .order_by(PaycheckProfile.effective_date.desc())
                .limit(1)
            )
        )
        .scalars()
        .first()
    )
    if current is not None:
        return current
    return (
        (
            await db.execute(
                select(PaycheckProfile)
                .where(
                    PaycheckProfile.person_id == person_id,
                    PaycheckProfile.effective_date > today,
                )
                .order_by(PaycheckProfile.effective_date)
                .limit(1)
            )
        )
        .scalars()
        .first()
    )


async def _mark_in_force(db: AsyncSession, profiles: list[PaycheckProfile], today: date) -> None:
    """Stamp the transient `in_force` flag `ProfileOut` reads (2026-09-06 spec §2.3).

    ONE rule — `_default_profile`'s — asked once per OWNER, so the Settings summary and the
    Paycheck page can never disagree about whose policy is live. The attribute is UNMAPPED:
    it lives on the instance for this response, never marks the row dirty, and so stays
    invisible to the preview's purity walk (tests/test_sandbox_purity.py).
    """
    winners: dict[int, int | None] = {}
    for profile in profiles:
        if profile.person_id not in winners:
            current = await _default_profile(db, profile.person_id, today)
            winners[profile.person_id] = None if current is None else current.id
    for profile in profiles:
        profile.in_force = winners[profile.person_id] == profile.id


async def _resolve_breakdown_profile(
    db: AsyncSession, profile_id: int | None, person_id: int | None, today: date
) -> PaycheckProfile:
    """WHICH profile a breakdown or a preview is about — the one rule, two doors.

    An explicit row wins outright: `person_id` only names WHOSE profile in force to pick,
    and there is nothing to pick when the row itself is named. Absent both = the primary's
    profile in force. The roster-less answer is the legacy 404, word for word.

    Also the stored-data guard, and the one thing a read CAN reject: every writer bounds
    `pay_periods_per_year`, but the API's bounds cannot see a row put there by hand, and
    `gross = annual_salary / periods` turns a stored 0 into a DivisionByZero 500. Only the
    floor is fenced: an over-large period count computes fine.
    """
    if profile_id is not None:
        profile = await _get_profile(db, profile_id)
    else:
        owner = await _resolve_person_id(db, person_id)  # absent = the primary person
        profile = None if owner is None else await _default_profile(db, owner, today)
        if profile is None:
            raise HTTPException(status_code=404, detail="no paycheck profiles")
    if profile.pay_periods_per_year < MIN_PAY_PERIODS:
        raise HTTPException(status_code=422, detail=PAY_PERIODS_MESSAGE)
    return profile


async def _limits_for(db: AsyncSession, year: int) -> dict[str, Decimal]:
    """This year's entered caps. No limits entered yet is the NORMAL first-run state, not an
    error: paycheck_pace answers with null caps and the page offers a link to Settings."""
    return {
        row.key: row.value
        for row in (
            await db.execute(select(ContributionLimit).where(ContributionLimit.year == year))
        ).scalars()
    }


def _advisories(profile, net_pay: Decimal) -> list[str]:
    """Advisory only, never a 422: each pct is individually legal, and the sheet itself
    lets you model an over-committed check. Judged on the DISPLAYED net, so the warning
    can never contradict the number next to it: a -1e-9 net renders as 0.00 and says
    nothing."""
    warnings: list[str] = []
    if sum((getattr(profile, name) for name in CONTRIBUTION_FIELDS), ZERO) > 1:
        warnings.append(CONTRIBUTIONS_WARNING)
    if net_pay < 0:
        warnings.append(NEGATIVE_NET_WARNING)
    return warnings


@dataclass(frozen=True)
class ScenarioProfile:
    """A profile with overrides applied — "anything with its columns" for
    `paycheck_calc.breakdown` and `limit_check.paycheck_pace`. Never an ORM row: a preview
    must not dirty the session (the purity walk in tests/test_sandbox_purity.py)."""

    annual_salary: Decimal
    pay_periods_per_year: int
    trad_401k_pct: Decimal
    roth_401k_pct: Decimal
    after_tax_401k_pct: Decimal
    espp_pct: Decimal
    withholding_pct: Decimal
    dental_vision_per_check: Decimal
    hsa_per_check: Decimal
    hsa_coverage: str
    match_rate_1: Decimal
    match_band_1: Decimal
    match_rate_2: Decimal
    match_band_2: Decimal
    hsa_employer_annual: Decimal
    hsa_employer_per_dependent: Decimal
    hsa_dependents: int


def _scenario_profile(base: PaycheckProfile, overrides: ProfileOverrides) -> ScenarioProfile:
    """The base row's values with every PROVIDED override validated by the writers' own
    helpers — one rule, one sentence per field, on both sides of the wire. Raises before it
    returns anything."""
    periods = (
        base.pay_periods_per_year
        if overrides.pay_periods_per_year is None
        else overrides.pay_periods_per_year
    )
    if not MIN_PAY_PERIODS <= periods <= MAX_PAY_PERIODS:
        raise HTTPException(status_code=422, detail=PAY_PERIODS_MESSAGE)
    pcts = {
        name: (
            getattr(base, name)
            if getattr(overrides, name) is None
            else _validated_pct(getattr(overrides, name), name)
        )
        for name in PCT_FIELDS
    }
    match = {
        name: (
            getattr(base, name)
            if getattr(overrides, name) is None
            else (_validated_match_rate if name in MATCH_RATE_FIELDS else _validated_band)(
                getattr(overrides, name), name
            )
        )
        for name in MATCH_FIELDS
    }
    return ScenarioProfile(
        annual_salary=(
            base.annual_salary
            if overrides.annual_salary is None
            else _positive_salary(overrides.annual_salary, "annual_salary")
        ),
        pay_periods_per_year=periods,
        dental_vision_per_check=(
            base.dental_vision_per_check
            if overrides.dental_vision_per_check is None
            else _non_negative_per_check(
                overrides.dental_vision_per_check, "dental_vision_per_check"
            )
        ),
        hsa_per_check=(
            base.hsa_per_check
            if overrides.hsa_per_check is None
            else _non_negative_per_check(overrides.hsa_per_check, "hsa_per_check")
        ),
        hsa_coverage=(
            base.hsa_coverage
            if overrides.hsa_coverage is None
            else _validated_coverage(overrides.hsa_coverage)
        ),
        **{
            name: (
                getattr(base, name)
                if getattr(overrides, name) is None
                else _non_negative_per_check(getattr(overrides, name), name)
            )
            for name in EMPLOYER_HSA_MONEY_FIELDS
        },
        hsa_dependents=(
            base.hsa_dependents
            if overrides.hsa_dependents is None
            else _validated_dependents(overrides.hsa_dependents)
        ),
        **pcts,
        **match,
    )


def _per_check(value: Decimal, profile) -> Decimal:
    """One check, as `breakdown()` already computed it."""
    return value


def _monthly(value: Decimal, profile) -> Decimal:
    """`value * periods / 12`, in THAT ORDER — BreakdownOut.monthly_net's own expression.

    Scaling by a precomputed `periods / 12` instead rounds the SCALE to the context's 28
    digits, and for any repeating quotient (52, 13, 22, 10, 4 or 1 periods) the product can
    land a cent under the GET's: weekly on 156,000 at 0.360615 withholding gives 8312.005 a
    month, which is 8312.01 here and was 8312.00 through a divided-first scale. Two doors,
    one number — so the preview divides LAST.
    """
    return value * Decimal(profile.pay_periods_per_year) / MONTHS_PER_YEAR


def _annual(value: Decimal, profile) -> Decimal:
    """A year of checks. Exact: no division, so no operation-order trap."""
    return value * Decimal(profile.pay_periods_per_year)


def _lines(profile, scale) -> dict[str, Decimal]:
    """The eleven lines plus `savings`, scaled on the FULL-precision chain and quantized
    once — so monthly.net_pay is exactly BreakdownOut.monthly_net for the same profile."""
    raw = breakdown(profile)
    chain = {key: raw[key] for key in WATERFALL_KEYS}
    chain["savings"] = sum((raw[key] for key in PAYROLL_SAVING_KEYS), ZERO)
    return {key: half_up2(scale(value, profile)) for key, value in chain.items()}


def _block(base, scenario, scale) -> PreviewBlock:
    """Baseline · scenario · delta at one cadence. Each side is scaled against ITS OWN
    period count (a scenario may change the cadence), and every delta is the difference of
    two already-quantized figures — the what-if endpoint's rule."""
    before = _lines(base, scale)
    after = _lines(scenario, scale)
    return PreviewBlock(
        baseline=PreviewLines(**before),
        scenario=PreviewLines(**after),
        delta=PreviewLines(**{key: after[key] - before[key] for key in before}),
    )


def _text(value) -> str:
    # `format(d, "f")`, never str(): a zero comes back from the driver as Decimal("0E-9").
    return format(value, "f") if isinstance(value, Decimal) else str(value)


async def _pace_inputs(
    db: AsyncSession, person_id: int
) -> tuple[list[PaycheckProfile], list[StoredPeriod], Decimal]:
    """Everything the pace strip reads from the database, ONCE: the person's profile
    timeline, the stored ESPP periods and the plan discount.

    A preview builds two strips from one request, and they read exactly the same rows — so
    the reads live here and `_pace_rows` below is pure. SELECTs only, on both doors
    (tests/test_sandbox_purity.py).
    """
    profiles = list(
        (
            await db.execute(
                select(PaycheckProfile)
                .where(PaycheckProfile.person_id == person_id)
                .order_by(PaycheckProfile.effective_date)
            )
        ).scalars()
    )
    stored = list(
        (
            await db.execute(select(EsppPeriod).order_by(EsppPeriod.period_end, EsppPeriod.id))
        ).scalars()
    )
    periods = [
        StoredPeriod(
            id=row.id,
            label=row.label,
            period_start=row.period_start,
            period_end=row.period_end,
            semi_annual_base=row.semi_annual_base,
            additional_payments=row.additional_payments,
            contribution_pct=row.contribution_pct,
        )
        for row in stored
    ]
    return profiles, periods, await read_espp_discount(db)


def _pace_rows(
    profile,
    scenario,
    limits: dict[str, Decimal],
    today: date,
    profiles: list[PaycheckProfile],
    periods: list[StoredPeriod],
    discount: Decimal,
) -> list[PaceItem]:
    """The pace strip's rows: every one WALKED payday by payday (§2.6), with the ESPP row
    replaced by the PURCHASE-year one (§1.6).

    One walk of this person's timeline serves the whole strip, so no two rows can disagree
    about which paydays the year has or who priced them. The ESPP windows are planned
    exactly as the calendar generator plans them — `plan_year_rows(Y, stored, [], None,
    None)`, pricing inputs deliberately empty — so the strip and the calendar can never
    disagree about which halves exist. Pure: every read happened in `_pace_inputs`.
    """
    # The window is the CALENDAR YEAR of the limits these rows are measured against — the
    # ESPP row is the one with a window of its own (§1.2). A person with no stored profile
    # cannot be walked at all, and there the pure fallback ("a year at this rate") is the
    # only honest answer.
    walked = (
        walk(profiles, scenario, today, date(today.year, 1, 1), date(today.year, 12, 31))
        if profiles
        else None
    )
    # Whose employer policy PAID the past: the stored row in force the day before today,
    # never a sandbox knob and never a profile that only takes effect today (spec §2.5).
    paid_by = in_force(profiles, today - timedelta(days=1)) if profiles else None
    items = paycheck_pace(profile, limits, profile.hsa_coverage, walked, paid_by)
    rows, _warnings = plan_year_rows(today.year, periods, [], None, None)
    espp = espp_pace_item(
        rows=rows,
        profiles=profiles,
        scenario_from_today=scenario,
        limit=limits.get(LIMIT_ESPP_423),
        discount=discount,
        today=today,
    )
    # limit_check already emits ESPP last, so appending keeps the display order intact.
    kept = [item for item in items if item.key != LIMIT_ESPP_423]
    return kept if espp is None else [*kept, espp]


@router.get("/breakdown", response_model=BreakdownOut)
async def get_breakdown(
    profile_id: IdQuery = None,
    person_id: IdQuery = None,
    db: AsyncSession = Depends(get_db),
) -> BreakdownOut:
    # The ONLY clock read for this route, deciding TWO things: which profile is in force,
    # and which year's contribution limits the pace rows are measured against. One read, so
    # a request that straddles midnight on 31 December cannot pair January's profile with
    # December's caps.
    today = clock.product_today()
    profile = await _resolve_breakdown_profile(db, profile_id, person_id, today)
    lines = {name: half_up2(value) for name, value in breakdown(profile).items()}
    warnings = _advisories(profile, lines["net_pay"])
    limits = await _limits_for(db, today.year)
    inputs = await _pace_inputs(db, profile.person_id)
    pace = [
        PaceItemOut.model_validate(item)
        for item in _pace_rows(profile, profile, limits, today, *inputs)
    ]
    # Per check from the ANNUAL policy, not the other way round: the bands are annual
    # dollars, so the year is the only place the tiers can be applied honestly.
    elective_annual = (profile.trad_401k_pct + profile.roth_401k_pct) * profile.annual_salary
    match_per_check = half_up2(
        employer_match(profile, elective_annual, limits.get(LIMIT_401K_ELECTIVE))
        / Decimal(profile.pay_periods_per_year)
    )
    await _mark_in_force(db, [profile], today)
    return BreakdownOut(
        profile=ProfileOut.model_validate(profile),
        warnings=warnings,
        pace=pace,
        employer_match=match_per_check,
        **lines,
    )


@router.post("/preview", response_model=PreviewOut)
async def preview(body: PreviewIn, db: AsyncSession = Depends(get_db)) -> PreviewOut:
    """The Paycheck sandbox's one request (2026-09-03 planning-sandboxes spec §13): the
    base profile — selected exactly as GET /breakdown selects it — against the same profile
    with `overrides` applied. NOTHING is stored: SELECTs only, no add/flush/commit anywhere
    in this call graph (tests/test_sandbox_purity.py proves it). `today` is read once for
    both the profile in force and the limits year, like the GET."""
    today = clock.product_today()
    base = await _resolve_breakdown_profile(db, body.profile_id, body.person_id, today)
    scenario = _scenario_profile(base, body.overrides)

    per_check = _block(base, scenario, _per_check)
    monthly = _block(base, scenario, _monthly)
    annual = _block(base, scenario, _annual)

    limits = await _limits_for(db, today.year)
    # ONE set of reads for both halves: they describe the same person, the same periods and
    # the same plan discount, and reading twice could only introduce a disagreement.
    inputs = await _pace_inputs(db, base.person_id)
    pace = PreviewPace(
        baseline=[
            PaceItemOut.model_validate(item)
            for item in _pace_rows(base, base, limits, today, *inputs)
        ],
        scenario=[
            PaceItemOut.model_validate(item)
            for item in _pace_rows(scenario, scenario, limits, today, *inputs)
        ],
    )
    changed = [
        ChangedField(
            key=name,
            label=FIELD_LABELS[name],
            before=_text(getattr(base, name)),
            after=_text(getattr(scenario, name)),
        )
        for name in SCENARIO_FIELDS
        if getattr(base, name) != getattr(scenario, name)
    ]
    await _mark_in_force(db, [base], today)
    return PreviewOut(
        profile=ProfileOut.model_validate(base),
        per_check=per_check,
        monthly=monthly,
        annual=annual,
        pace=pace,
        changed=changed,
        warnings=_advisories(scenario, per_check.scenario.net_pay),
    )
