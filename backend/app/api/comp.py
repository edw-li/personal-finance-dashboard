"""Comp API: the Focal History table — one row per focal year, with its deltas computed
on read (spec §5).

Writers quantize to the column scale BEFORE the first insert (money.py's bounds
vocabulary): bases Numeric(12,2) -> 10^10, RSU counts Numeric(12,4) -> 10^8, prices
Numeric(14,4) -> 10^10. Reads never reject stored data — `comp_calc` uses plain
quantizes and degrades every missing/zero input to null instead of raising.

Only `focal_year` and `current_base` are NOT NULL. On PATCH that splits the null
semantics down the middle: a null on those two is the house no-op, while a null on any
other column really CLEARS it (a raise that never happened, a grant that was withdrawn).
That is the deliberate difference from the espp lots router, where nothing clears.

The second half of the file is /rsu-grants (2026-08-21 spec §3): grant PARAMETERS in,
`rsu_vesting`'s schedule out. No vest row is ever stored, so every echo recomputes — and
the vested/unvested split is judged on `scheduler.product_today()`, read at the route.
"""

from datetime import date
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models import CompEvent, RsuGrant
from app.schemas.comp import (
    CompEventIn,
    CompEventOut,
    CompEventUpdate,
    RsuGrantIn,
    RsuGrantOut,
    RsuGrantUpdate,
)
from app.services import rsu_vesting
from app.services.comp_calc import metrics
from app.services.money import (
    MONEY_MAX_ABS_12_2,
    MONEY_MAX_ABS_14_4,
    quantize_money,
    quantize_price,
    require_reasonable_date,
)
from app.services.scheduler import product_today

router = APIRouter(prefix="/comp", tags=["comp"], dependencies=[Depends(get_current_user)])

ZERO = Decimal("0")
# The sheet's history starts in the 2020s; this is the mistyped-year fence (money.py's
# century guard, narrowed — a comp event has no business in 1900).
MIN_FOCAL_YEAR = 1990
MAX_FOCAL_YEAR = 2100
# comp_events.unvested_rsus / refresh_rsus are Numeric(12,4): eight integer digits.
RSU_MAX_ABS = Decimal(10) ** 8
# The PK is an int4: an out-of-range id would reach asyncpg as a bare DataError (a 500),
# so it is fenced at the boundary — taxes.py's YearPath precedent, Plan 1 forward note.
INT32_MAX = 2**31 - 1
IdPath = Annotated[int, Path(ge=1, le=INT32_MAX)]

# The four nullable equity columns, split by the bound each family wears.
RSU_FIELDS = ("unvested_rsus", "refresh_rsus")
PRICE_FIELDS = ("unvested_price", "grant_price")

# --- rsu_grants
GRANT_KINDS = ("new_hire", "refresh")
# rsu_grants.shares is a whole-share int4; this is the modelling fence, well under 2^31.
GRANT_SHARES_MAX = 10**8
# rsu_grants.cliff_pct is Numeric(7,4): three integer digits. The (0, 1] rule below is the
# real one — this bound exists so the quantize itself cannot trap (money.py's note: pydantic
# hands "1e26" through, and Decimal.quantize() raises InvalidOperation on it, i.e. a 500).
CLIFF_MAX_ABS = Decimal(10) ** 3


def _positive_base(value: Decimal, field: str) -> Decimal:
    quantized = quantize_money(value, field, max_abs=MONEY_MAX_ABS_12_2) + ZERO
    if quantized <= 0:
        raise HTTPException(status_code=422, detail=f"{field} must be positive")
    return quantized


def _non_negative_4dp(value: Decimal, field: str, max_abs: Decimal) -> Decimal:
    # quantize_price, not quantize_shares: money.py's PRICE_QUANTUM (4dp) is exactly the
    # scale of BOTH families here — Numeric(12,4) counts and Numeric(14,4) prices — while
    # quantize_shares is 6dp for portfolio's Numeric(16,6).
    quantized = quantize_price(value, field, max_abs=max_abs) + ZERO
    # Check the RAW value too: "-0.00001" quantizes to -0.0000, which compares == 0
    # (portfolio.py's _validated_annual_dividend posture).
    if value < 0 or quantized < 0:
        raise HTTPException(status_code=422, detail=f"{field} must be >= 0")
    return quantized


def _validated_event(
    focal_year: int,
    current_base: Decimal,
    new_base: Decimal | None,
    equity: dict[str, Decimal | None],
) -> dict:
    """One event's stored columns, validated as a WHOLE row (Plan 4 house law) so a PATCH
    can hand over the merged values and get the same rules as a POST.

    Raises before it returns anything, so a rejected request leaves no partial state.
    """
    if not MIN_FOCAL_YEAR <= focal_year <= MAX_FOCAL_YEAR:
        raise HTTPException(
            status_code=422,
            detail=f"focal_year must be between {MIN_FOCAL_YEAR} and {MAX_FOCAL_YEAR}",
        )
    return {
        "focal_year": focal_year,
        "current_base": _positive_base(current_base, "current_base"),
        # Nullable, but a stored zero would be a raise TO nothing — reject it like the
        # current base, and let null be the way to say "no new base this year".
        "new_base": None if new_base is None else _positive_base(new_base, "new_base"),
        **{
            name: (
                None if equity[name] is None else _non_negative_4dp(equity[name], name, RSU_MAX_ABS)
            )
            for name in RSU_FIELDS
        },
        **{
            name: (
                None
                if equity[name] is None
                else _non_negative_4dp(equity[name], name, MONEY_MAX_ABS_14_4)
            )
            for name in PRICE_FIELDS
        },
    }


def _event_out(event: CompEvent) -> CompEventOut:
    return CompEventOut(
        id=event.id,
        focal_year=event.focal_year,
        current_base=event.current_base,
        new_base=event.new_base,
        unvested_rsus=event.unvested_rsus,
        unvested_price=event.unvested_price,
        refresh_rsus=event.refresh_rsus,
        grant_price=event.grant_price,
        notes=event.notes,
        **metrics(event),
    )


async def _get_event(db: AsyncSession, event_id: int) -> CompEvent:
    event = await db.get(CompEvent, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="comp event not found")
    return event


async def _require_free_focal_year(db: AsyncSession, focal_year: int) -> None:
    taken = (
        (await db.execute(select(CompEvent).where(CompEvent.focal_year == focal_year)))
        .scalars()
        .first()
    )
    if taken is not None:
        raise HTTPException(status_code=409, detail=f"a comp event for {focal_year} already exists")


def _merged(provided: dict, key: str, current):
    """PATCH merge for a NOT NULL column: absent keeps it, and an explicit null reads as
    a no-op request rather than an error (portfolio.py's update_security posture). Only the
    NOT NULL columns go through this — an event's focal_year/current_base, a grant's
    kind/label/shares/grant_price/first_vest_date/cliff_pct. Every other column is nullable,
    so its null is taken literally."""
    value = provided.get(key, current)
    return current if value is None else value


@router.get("/events", response_model=list[CompEventOut])
async def list_events(db: AsyncSession = Depends(get_db)) -> list[CompEventOut]:
    # Ascending: the page reads as a trajectory, and focal_year is unique so this needs
    # no id tiebreak.
    rows = (await db.execute(select(CompEvent).order_by(CompEvent.focal_year))).scalars()
    return [_event_out(event) for event in rows]


@router.post("/events", response_model=CompEventOut, status_code=201)
async def create_event(body: CompEventIn, db: AsyncSession = Depends(get_db)) -> CompEventOut:
    fields = _validated_event(
        focal_year=body.focal_year,
        current_base=body.current_base,
        new_base=body.new_base,
        equity={name: getattr(body, name) for name in RSU_FIELDS + PRICE_FIELDS},
    )
    # focal_year is the natural key. Plain check-then-409: two concurrent creates of the
    # same year would race into an IntegrityError, an accepted house class for a
    # single-user app.
    await _require_free_focal_year(db, fields["focal_year"])
    event = CompEvent(notes=body.notes, **fields)
    db.add(event)
    await db.commit()
    return _event_out(event)


@router.patch("/events/{event_id}", response_model=CompEventOut)
async def update_event(
    event_id: IdPath, body: CompEventUpdate, db: AsyncSession = Depends(get_db)
) -> CompEventOut:
    event = await _get_event(db, event_id)
    provided = body.model_dump(exclude_unset=True)
    fields = _validated_event(
        focal_year=_merged(provided, "focal_year", event.focal_year),
        current_base=_merged(provided, "current_base", event.current_base),
        # NOT `_merged`: these columns ARE nullable, so an explicit null clears them.
        new_base=provided.get("new_base", event.new_base),
        equity={
            name: provided.get(name, getattr(event, name)) for name in RSU_FIELDS + PRICE_FIELDS
        },
    )
    if fields["focal_year"] != event.focal_year:
        await _require_free_focal_year(db, fields["focal_year"])
    # Every raise is behind us — mutate only now, or a 422 halfway through a multi-field
    # PATCH would leave part of the row dirty for the next autoflush.
    for name, value in fields.items():
        setattr(event, name, value)
    if "notes" in provided:
        event.notes = provided["notes"]
    await db.commit()
    return _event_out(event)


@router.delete("/events/{event_id}", status_code=204)
async def delete_event(event_id: IdPath, db: AsyncSession = Depends(get_db)) -> Response:
    await db.delete(await _get_event(db, event_id))
    await db.commit()
    return Response(status_code=204)


# --- RSU grants: stored parameters in, computed vest schedule out (2026-08-21 spec §3).
# Only `focal_year` and `notes` are nullable here, so the null split lands differently from
# the events table above: those two clear, every other column takes the house no-op.


def _validated_grant(
    kind: str,
    label: str,
    focal_year: int | None,
    shares: int,
    grant_price: Decimal,
    first_vest_date: date,
    cliff_pct: Decimal,
) -> dict:
    """One grant's stored columns, validated as a WHOLE row (`_validated_event`'s posture) so
    a PATCH gets the same rules as a POST, and raising before anything is returned."""
    if kind not in GRANT_KINDS:
        raise HTTPException(status_code=422, detail="kind must be 'new_hire' or 'refresh'")
    clean_label = label.strip()
    if not clean_label:
        raise HTTPException(status_code=422, detail="label must not be blank")
    if focal_year is not None and not MIN_FOCAL_YEAR <= focal_year <= MAX_FOCAL_YEAR:
        raise HTTPException(
            status_code=422,
            detail=f"focal_year must be between {MIN_FOCAL_YEAR} and {MAX_FOCAL_YEAR}",
        )
    if not 1 <= shares <= GRANT_SHARES_MAX:
        raise HTTPException(
            status_code=422, detail=f"shares must be between 1 and {GRANT_SHARES_MAX}"
        )
    price = quantize_price(grant_price, "grant_price", max_abs=MONEY_MAX_ABS_14_4) + ZERO
    # Both sides, `_non_negative_4dp`'s posture: this is a positive-CENT fence, not a sign
    # check — "0.00001" is signed positive and still quantizes away to nothing.
    if grant_price <= 0 or price <= 0:
        raise HTTPException(status_code=422, detail="grant_price must be positive")
    # The century fence is load-bearing, not decorative: `vest_dates` walks 15 quarters past
    # the first vest, and a mistyped 9999 lands in year 10003 — unrepresentable as a date.
    require_reasonable_date(first_vest_date, "first_vest_date")
    quantized_cliff = quantize_price(cliff_pct, "cliff_pct", max_abs=CLIFF_MAX_ABS)
    if not 0 < quantized_cliff <= 1:
        raise HTTPException(status_code=422, detail="cliff_pct must be in (0, 1]")
    try:
        rsu_vesting.vest_count(quantized_cliff)
    except ValueError:
        raise HTTPException(
            status_code=422,
            detail="cliff_pct must leave a whole number of 6.25% quarterly vests",
        ) from None
    return {
        "kind": kind,
        "label": clean_label,
        "focal_year": focal_year,
        "shares": shares,
        "grant_price": price,
        "first_vest_date": first_vest_date,
        "cliff_pct": quantized_cliff,
    }


def _grant_out(grant: RsuGrant, today: date) -> RsuGrantOut:
    """Vest rows are never stored — every echo recomputes the schedule. `today` is a
    PARAMETER (espp_calc's posture): the route owns the clock, this stays pure."""
    events = rsu_vesting.schedule(grant)
    vested = sum(shares for vest_date, shares in events if vest_date <= today)
    return RsuGrantOut(
        id=grant.id,
        kind=grant.kind,
        label=grant.label,
        focal_year=grant.focal_year,
        shares=grant.shares,
        grant_price=grant.grant_price,
        first_vest_date=grant.first_vest_date,
        cliff_pct=grant.cliff_pct,
        notes=grant.notes,
        vest_count=len(events),
        vested_shares=vested,
        unvested_shares=grant.shares - vested,
    )


async def _get_grant(db: AsyncSession, grant_id: int) -> RsuGrant:
    grant = await db.get(RsuGrant, grant_id)
    if grant is None:
        raise HTTPException(status_code=404, detail="rsu grant not found")
    return grant


async def _require_free_label(db: AsyncSession, label: str) -> None:
    taken = (await db.execute(select(RsuGrant).where(RsuGrant.label == label))).scalars().first()
    if taken is not None:
        raise HTTPException(status_code=409, detail=f"a grant labeled {label!r} already exists")


@router.get("/rsu-grants", response_model=list[RsuGrantOut])
async def list_grants(db: AsyncSession = Depends(get_db)) -> list[RsuGrantOut]:
    # Ascending by first vest — the page reads as a timeline — with an id tiebreak, because
    # two grants can share a vest date (label is the unique column, not the date).
    rows = (
        await db.execute(select(RsuGrant).order_by(RsuGrant.first_vest_date, RsuGrant.id))
    ).scalars()
    # One clock for the whole page: `product_today` is the scheduler-zone day, never
    # date.today() (the prod container runs UTC — price_service's note).
    today = product_today()
    return [_grant_out(grant, today) for grant in rows]


@router.post("/rsu-grants", response_model=RsuGrantOut, status_code=201)
async def create_grant(body: RsuGrantIn, db: AsyncSession = Depends(get_db)) -> RsuGrantOut:
    fields = _validated_grant(
        kind=body.kind,
        label=body.label,
        focal_year=body.focal_year,
        shares=body.shares,
        grant_price=body.grant_price,
        first_vest_date=body.first_vest_date,
        cliff_pct=body.cliff_pct,
    )
    # The TRIMMED label, i.e. the value that would be stored: checking the raw one would let a
    # padded duplicate past the pre-select and onto the unique index as a 500. Plain
    # check-then-409, `_require_free_focal_year`'s accepted race for a single-user app.
    await _require_free_label(db, fields["label"])
    grant = RsuGrant(notes=body.notes, **fields)
    db.add(grant)
    await db.commit()
    return _grant_out(grant, product_today())


@router.patch("/rsu-grants/{grant_id}", response_model=RsuGrantOut)
async def update_grant(
    grant_id: IdPath, body: RsuGrantUpdate, db: AsyncSession = Depends(get_db)
) -> RsuGrantOut:
    grant = await _get_grant(db, grant_id)
    provided = body.model_dump(exclude_unset=True)
    fields = _validated_grant(
        kind=_merged(provided, "kind", grant.kind),
        label=_merged(provided, "label", grant.label),
        # NOT `_merged`: focal_year IS nullable, so an explicit null clears it.
        focal_year=provided.get("focal_year", grant.focal_year),
        shares=_merged(provided, "shares", grant.shares),
        grant_price=_merged(provided, "grant_price", grant.grant_price),
        first_vest_date=_merged(provided, "first_vest_date", grant.first_vest_date),
        cliff_pct=_merged(provided, "cliff_pct", grant.cliff_pct),
    )
    if fields["label"] != grant.label:
        await _require_free_label(db, fields["label"])
    # Every raise is behind us — mutate only now (see update_event).
    for name, value in fields.items():
        setattr(grant, name, value)
    if "notes" in provided:
        grant.notes = provided["notes"]
    await db.commit()
    return _grant_out(grant, product_today())


@router.delete("/rsu-grants/{grant_id}", status_code=204)
async def delete_grant(grant_id: IdPath, db: AsyncSession = Depends(get_db)) -> Response:
    await db.delete(await _get_grant(db, grant_id))
    await db.commit()
    return Response(status_code=204)
