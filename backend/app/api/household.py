"""Household vertical (2026-08-26 spec §5.1): the people registry every owner column
points at, plus the marriage date.

The date lives in app_settings under its OWN key, written by THIS router — not by the
settings router's rigid three-field PUT. That form drops any key not added to
schemas/app_settings.py, the router's write loop and SettingsPage's boxesFor together
(audit §2.2), and household config has no business in that trap. Get-then-set on one row
is the accepted single-user TOCTOU class (accounts/securities/taxes precedent).

There is no person DELETE route at all: rows here are referenced by accounts (and, in
later waves, tax inputs), and retiring a household member is not a thing this app models."""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models import AppSetting, Person
from app.schemas.household import (
    HouseholdOut,
    MarriageDateIn,
    MarriageDateOut,
    PersonCreate,
    PersonOut,
    PersonUpdate,
)
from app.services.money import require_reasonable_date

router = APIRouter(
    prefix="/household", tags=["household"], dependencies=[Depends(get_current_user)]
)

MARRIAGE_DATE_KEY = "marriage_date"


async def _read_marriage_date(db: AsyncSession) -> date | None:
    """Degrade-to-None on anything unreadable — the app_settings readers' posture
    (_read_espp_ticker): a malformed stored blob means 'unset', never a 500 on a GET."""
    setting = await db.get(AppSetting, MARRIAGE_DATE_KEY)
    if setting is None or not isinstance(setting.value, dict):
        return None
    raw = setting.value.get("value")
    if not isinstance(raw, str) or not raw.strip():
        return None
    try:
        return date.fromisoformat(raw.strip())
    except ValueError:
        return None


async def _list_people(db: AsyncSession) -> list[Person]:
    # Primary first, then by id: every owner select downstream wants "Me" at the top.
    result = await db.execute(select(Person).order_by(Person.is_primary.desc(), Person.id))
    return list(result.scalars().all())


@router.get("", response_model=HouseholdOut)
async def get_household(db: AsyncSession = Depends(get_db)) -> HouseholdOut:
    return HouseholdOut(
        people=[PersonOut.model_validate(p) for p in await _list_people(db)],
        marriage_date=await _read_marriage_date(db),
    )


@router.post("/people", response_model=PersonOut, status_code=201)
async def create_person(body: PersonCreate, db: AsyncSession = Depends(get_db)) -> Person:
    name = body.name.strip()
    if not name:
        # min_length catches ""; whitespace-only would otherwise store a display name
        # nothing can render (the accounts/categories unsluggable-name rule).
        raise HTTPException(status_code=422, detail="name must not be blank")
    clash = (await db.execute(select(Person).where(Person.name == name))).scalars().first()
    if clash is not None:
        raise HTTPException(status_code=409, detail=f"person {name!r} already exists")
    # NEVER primary: the seeded row owns that flag for the life of the database, and a
    # second TRUE would surface ux_people_single_primary as an opaque IntegrityError 500.
    person = Person(name=name, is_primary=False)
    db.add(person)
    await db.commit()
    return person


@router.patch("/people/{person_id}", response_model=PersonOut)
async def update_person(
    person_id: int, body: PersonUpdate, db: AsyncSession = Depends(get_db)
) -> Person:
    person = await db.get(Person, person_id)
    if person is None:
        raise HTTPException(status_code=404, detail="person not found")
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="name must not be blank")
    if name != person.name:
        clash = (
            (
                await db.execute(
                    select(Person).where(Person.name == name, Person.id != person_id)
                )
            )
            .scalars()
            .first()
        )
        if clash is not None:
            raise HTTPException(status_code=409, detail="person name already in use")
    # Rename ONLY — is_primary is not on the schema, so a body carrying it is ignored.
    person.name = name
    await db.commit()
    return person


@router.put("/marriage-date", response_model=MarriageDateOut)
async def put_marriage_date(
    body: MarriageDateIn, db: AsyncSession = Depends(get_db)
) -> MarriageDateOut:
    stored = ""
    if body.marriage_date is not None:
        # Century guard BEFORE any write: a mistyped year must 422 here, not become an
        # absurd annotation on every trend chart later.
        stored = require_reasonable_date(body.marriage_date, "marriage_date").isoformat()
    # Envelope {"value": ...} is the readers' convention; "" is the stored form of unset,
    # which _read_marriage_date reports back as null.
    setting = await db.get(AppSetting, MARRIAGE_DATE_KEY)
    if setting is None:
        db.add(AppSetting(key=MARRIAGE_DATE_KEY, value={"value": stored}))
    else:
        setting.value = {"value": stored}
    await db.commit()
    return MarriageDateOut(marriage_date=body.marriage_date)
