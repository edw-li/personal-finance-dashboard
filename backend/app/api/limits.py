"""Contribution-limit registry (2026-08-27 two-income-streams spec §4.5).

The app ships NO values (the brackets philosophy, spec §2): the five DEFINITIONS live in
app/limit_keys.py with their labels and display order, and every year's numbers are the
user's to enter. A GET therefore always answers with all five items — a missing value is
`null`, which is what the Paycheck page's pace strip renders its "enter this year's
limit" call-to-action for. Never a fabricated cap.

The PUT is a partial bulk upsert with the spending-months tri-state: a key absent from
`values` is untouched, a key with a number is written, a key with an explicit null has
its row DELETED (back to "not entered"). Get-then-set per row is the accepted single-user
TOCTOU class (accounts/securities/taxes precedent).
"""

from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user

# The century guard, borrowed rather than re-minted: `year` is an int4 here too, so a
# mistyped 99999999999 would surface as a bare asyncpg DataError 500 on a plain GET.
# app_settings.py already imports a helper from another router — one rule, one spelling.
from app.api.taxes import YEAR_MAX, YEAR_MIN
from app.database import get_db
from app.limit_keys import LIMIT_KEYS, ORDERED_DEFINITIONS
from app.models import ContributionLimit
from app.schemas.limits import LimitItemOut, LimitsIn, LimitsOut
from app.services.money import quantize_money

router = APIRouter(prefix="/limits", tags=["limits"], dependencies=[Depends(get_current_user)])

ZERO = Decimal("0")
YearPath = Annotated[int, Path(ge=YEAR_MIN, le=YEAR_MAX)]
YearQuery = Annotated[int, Query(ge=YEAR_MIN, le=YEAR_MAX)]


def _validated_value(value: Decimal, key: str) -> Decimal:
    """Quantized to the column scale BEFORE the insert (money.py's bounds vocabulary), so
    an over-scale figure is a 422 and never a bare sqlstate 22003.

    `+ ZERO` collapses signed zeros — a "-0" compares EQUAL to zero, so it would slip the
    `<= 0` check below and land in the table as "-0.00" (app_settings' trick).
    """
    quantized = quantize_money(value, key) + ZERO
    if quantized <= 0:
        # Mirrors the table's CHECK (value > 0) with a sentence a user can act on. A zero
        # cap is not a thing the IRS publishes, and it is what lets limit_check divide.
        raise HTTPException(status_code=422, detail=f"{key} must be positive")
    return quantized


async def _stored(db: AsyncSession, year: int) -> dict[str, Decimal]:
    rows = (
        await db.execute(select(ContributionLimit).where(ContributionLimit.year == year))
    ).scalars()
    # Keys the definitions no longer carry are invisible to this router on purpose: a key
    # retired from limit_keys.py keeps its stored rows (nothing deletes them), so a later
    # batch that re-adds it finds the user's numbers intact.
    return {row.key: row.value for row in rows if row.key in LIMIT_KEYS}


def _payload(year: int, stored: dict[str, Decimal]) -> LimitsOut:
    # ALL FIVE definitions, always, in sort order: the card is a fixed form, not a list of
    # whatever happens to be stored, and a key the user has never entered still needs a
    # box to type into.
    return LimitsOut(
        year=year,
        items=[
            LimitItemOut(key=key, label=label, value=stored.get(key))
            for key, label, _sort in ORDERED_DEFINITIONS
        ],
    )


@router.get("", response_model=LimitsOut)
async def get_limits(year: YearQuery, db: AsyncSession = Depends(get_db)) -> LimitsOut:
    return _payload(year, await _stored(db, year))


@router.put("/{year}", response_model=LimitsOut)
async def put_limits(
    year: YearPath, body: LimitsIn, db: AsyncSession = Depends(get_db)
) -> LimitsOut:
    unknown = sorted(set(body.values) - set(LIMIT_KEYS))
    if unknown:
        # Refused, never ignored: a typo'd key that silently vanished would read as
        # "saved" on a card whose box then came back empty.
        raise HTTPException(status_code=422, detail=f"unknown limit key(s): {', '.join(unknown)}")
    # Validate the WHOLE map first (the paycheck router's whole-row rule): a 422 halfway
    # through a five-key PUT must not leave the legal keys written.
    validated = {
        key: None if value is None else _validated_value(value, key)
        for key, value in body.values.items()
    }
    existing = {
        row.key: row
        for row in (
            await db.execute(select(ContributionLimit).where(ContributionLimit.year == year))
        ).scalars()
    }
    for key, value in validated.items():
        row = existing.get(key)
        if value is None:
            # DELETE, not a stored zero: "not entered" is a state the pace strip renders a
            # call-to-action for, and the CHECK forbids the zero anyway.
            if row is not None:
                await db.delete(row)
            continue
        if row is None:
            db.add(ContributionLimit(year=year, key=key, value=value))
        else:
            row.value = value
    await db.commit()
    return _payload(year, await _stored(db, year))


@router.post("/{year}/clone-from/{source_year}", response_model=LimitsOut)
async def clone_limits(
    year: YearPath, source_year: YearPath, db: AsyncSession = Depends(get_db)
) -> LimitsOut:
    """Seed an EMPTY year from an existing one; then edited in place.

    "Last year's numbers, then bump the two that moved" is how the caps actually change,
    and the app ships none of its own to start from. The source year may equal the target
    only in the degenerate sense that the emptiness guard below would then always fire.
    """
    source = await _stored(db, source_year)
    if not source:
        raise HTTPException(
            status_code=404, detail=f"no contribution limits to clone from {source_year}"
        )
    existing = await _stored(db, year)
    if existing:
        # Never a silent merge (clone_brackets' grammar): clear the target explicitly —
        # a PUT with nulls — first.
        raise HTTPException(
            status_code=409, detail=f"{year} already has {len(existing)} contribution limits"
        )
    for key, value in source.items():
        db.add(ContributionLimit(year=year, key=key, value=value))
    await db.commit()
    return _payload(year, await _stored(db, year))
