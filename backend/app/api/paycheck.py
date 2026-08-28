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
because there is no number the breakdown could show. `date.today()` is read HERE and
only here — the calc module takes no clock — and it decides one thing: which profile is
current when no `profile_id` is given.
"""

from datetime import date
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models import PaycheckProfile, Person
from app.schemas.paycheck import BreakdownOut, ProfileIn, ProfileOut, ProfileUpdate
from app.services.money import (
    MONEY_MAX_ABS_12_2,
    _quantize_bounded,
    quantize_money,
    require_reasonable_date,
)
from app.services.paycheck_calc import breakdown, half_up2
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
CONTRIBUTIONS_WARNING = "contribution percentages exceed 100%"
NEGATIVE_NET_WARNING = "net pay is negative"
# A stored profile must have an owner (person_id is NOT NULL), and only a database whose
# roster was never seeded has nobody to default to.
NO_PRIMARY_PERSON_MESSAGE = "household has no primary person"


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


def _validated_profile(
    effective_date: date,
    annual_salary: Decimal,
    pay_periods_per_year: int,
    dental_vision_per_check: Decimal,
    hsa_per_check: Decimal,
    pcts: dict[str, Decimal],
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
        **{name: _validated_pct(pcts[name], name) for name in PCT_FIELDS},
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
    return list(
        (
            await db.execute(
                select(PaycheckProfile).order_by(
                    PaycheckProfile.effective_date.desc(), PaycheckProfile.id
                )
            )
        ).scalars()
    )


@router.post("/profiles", response_model=ProfileOut, status_code=201)
async def create_profile(body: ProfileIn, db: AsyncSession = Depends(get_db)) -> PaycheckProfile:
    person_id = await _require_person(db, body.person_id)
    fields = _validated_profile(
        effective_date=body.effective_date,
        annual_salary=body.annual_salary,
        pay_periods_per_year=body.pay_periods_per_year,
        dental_vision_per_check=body.dental_vision_per_check,
        hsa_per_check=body.hsa_per_check,
        pcts={name: getattr(body, name) for name in PCT_FIELDS},
    )
    # (person_id, effective_date) is the natural key. Plain check-then-409: two concurrent
    # creates of the same pair would race into an IntegrityError, an accepted house class
    # for a single-user app.
    await _require_free_effective_date(db, person_id, fields["effective_date"])
    profile = PaycheckProfile(person_id=person_id, notes=body.notes, **fields)
    db.add(profile)
    await db.commit()
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
        pcts={name: _merged(provided, name, getattr(profile, name)) for name in PCT_FIELDS},
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
    return profile


@router.delete("/profiles/{profile_id}", status_code=204)
async def delete_profile(profile_id: IdPath, db: AsyncSession = Depends(get_db)) -> Response:
    await db.delete(await _get_profile(db, profile_id))
    await db.commit()
    return Response(status_code=204)


async def _default_profile(
    db: AsyncSession, person_id: int, today: date
) -> PaycheckProfile | None:
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


@router.get("/breakdown", response_model=BreakdownOut)
async def get_breakdown(
    profile_id: IdQuery = None,
    person_id: IdQuery = None,
    db: AsyncSession = Depends(get_db),
) -> BreakdownOut:
    if profile_id is not None:
        # An explicit row wins outright: `person_id` only names WHOSE profile in force to
        # pick, and there is nothing to pick when the row itself is named.
        profile = await _get_profile(db, profile_id)
    else:
        owner = await _resolve_person_id(db, person_id)  # absent = the primary person
        profile = (
            None
            if owner is None
            else await _default_profile(db, owner, date.today())  # the ONLY clock read here
        )
        if profile is None:
            # Also the roster-less answer: person_id is NOT NULL, so a database with no
            # people has no profiles either — the legacy 404, word for word.
            raise HTTPException(status_code=404, detail="no paycheck profiles")

    # The stored-data guard, and the one thing this read CAN reject: every writer bounds
    # `pay_periods_per_year`, but the API's bounds cannot see a row put there by hand (or
    # by a future importer), and `gross = annual_salary / periods` turns a stored 0 into a
    # DivisionByZero 500. A GET must degrade instead — same rule, same words as the write
    # side. Only the floor is fenced: an over-large period count computes fine.
    if profile.pay_periods_per_year < MIN_PAY_PERIODS:
        raise HTTPException(status_code=422, detail=PAY_PERIODS_MESSAGE)

    lines = {name: half_up2(value) for name, value in breakdown(profile).items()}
    warnings: list[str] = []
    # Advisory only, never a 422: each pct is individually legal, and the sheet itself
    # lets you model an over-committed check (the result is simply a negative net).
    if sum((getattr(profile, name) for name in CONTRIBUTION_FIELDS), ZERO) > 1:
        warnings.append(CONTRIBUTIONS_WARNING)
    # Judged on the DISPLAYED net, so the warning can never contradict the number next to
    # it: a -1e-9 net renders as 0.00 and says nothing.
    if lines["net_pay"] < 0:
        warnings.append(NEGATIVE_NET_WARNING)
    return BreakdownOut(profile=ProfileOut.model_validate(profile), warnings=warnings, **lines)
