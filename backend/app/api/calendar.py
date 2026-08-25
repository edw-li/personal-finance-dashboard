"""GET /calendar — the forward-looking event feed (2026-08-24 spec §5). This router only
LOADS; services/calendar_events.compose owns every rule, so pytest can drive the rules
with literals and this file stays a set of SELECTs. The one heavier load (folding
positions for "actively held") runs only when an announced ex-dividend exists at all."""

from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models import (
    CustomEvent,
    EsppLot,
    EsppOffering,
    EsppPeriod,
    NetWorthSnapshot,
    PaycheckProfile,
    PositionTransaction,
    RsuGrant,
    Security,
)
from app.schemas.calendar import CalendarEventOut, CalendarOut, CustomEventIn, CustomEventOut
from app.services.calendar_events import compose
from app.services.espp_calc import OfferingInfo, StoredPeriod
from app.services.portfolio_calc import SHARE_Q, fold_transactions
from app.services.scheduler import product_today

router = APIRouter(prefix="/calendar", tags=["calendar"], dependencies=[Depends(get_current_user)])

ZERO = Decimal("0")
# A year plus wrap slack; the frontend asks for ~3-month windows, the fence is only
# against a runaway query composing decades of derived events.
MAX_SPAN_DAYS = 400


async def _held_ex_dividends(db: AsyncSession) -> list[tuple[str, date]]:
    """(ticker, next_ex_div_date) for ACTIVE securities carrying an announcement that
    are actually HELD — folded shares > 0 summed across accounts (allocation()'s
    zero-share rule, SHARE_Q quantize included so dust does not count as a holding).
    The full fold is the correct shares source (splits multiply; a bare SUM(shares)
    would not), and at personal scale it is one query + arithmetic."""
    candidates = list(
        (
            await db.execute(
                select(Security)
                .where(Security.is_active.is_(True), Security.next_ex_div_date.is_not(None))
                .order_by(Security.ticker)
            )
        ).scalars()
    )
    if not candidates:
        return []
    txns = list(
        (
            await db.execute(
                select(PositionTransaction).order_by(
                    PositionTransaction.sort_index, PositionTransaction.id
                )
            )
        ).scalars()
    )
    shares_by_sec: dict[int, Decimal] = {}
    for pos in fold_transactions(txns).values():
        shares_by_sec[pos.security_id] = shares_by_sec.get(pos.security_id, ZERO) + pos.shares
    return [
        (security.ticker, security.next_ex_div_date)
        for security in candidates
        if shares_by_sec.get(security.id, ZERO).quantize(SHARE_Q, rounding=ROUND_HALF_UP) > 0
    ]


@router.get("", response_model=CalendarOut)
async def get_calendar(start: date, end: date, db: AsyncSession = Depends(get_db)) -> CalendarOut:
    """{events} for [start, end] INCLUSIVE, sorted by (date, type, label). 422 on a
    reversed pair or a span past 400 days (app_settings.py's empty-path route pattern
    under the router prefix). GET-never-rejects: every degradable source degrades inside
    compose(); nothing stored can 500 this."""
    if start > end:
        raise HTTPException(status_code=422, detail="start must be on or before end")
    if (end - start).days > MAX_SPAN_DAYS:
        raise HTTPException(
            status_code=422, detail=f"start to end must span at most {MAX_SPAN_DAYS} days"
        )
    # product_today, never date.today(): the reminder date and the clear/store fence must
    # agree with the scheduler-zone day (comp.py's clock rule).
    today = product_today()

    grants = list(
        (
            await db.execute(select(RsuGrant).order_by(RsuGrant.first_vest_date, RsuGrant.id))
        ).scalars()
    )
    stored_periods = [
        StoredPeriod(
            id=row.id,
            label=row.label,
            period_start=row.period_start,
            period_end=row.period_end,
            semi_annual_base=row.semi_annual_base,
            additional_payments=row.additional_payments,
            contribution_pct=row.contribution_pct,
        )
        for row in (
            await db.execute(select(EsppPeriod).order_by(EsppPeriod.period_end, EsppPeriod.id))
        ).scalars()
    ]
    offerings = [
        OfferingInfo(offering_start=row.offering_start, subscription_price=row.subscription_price)
        for row in (
            await db.execute(select(EsppOffering).order_by(EsppOffering.offering_start))
        ).scalars()
    ]
    unsold_lots = [
        (row.purchase_date, row.qualifying_date)
        for row in (
            await db.execute(
                select(EsppLot).where(EsppLot.sold_date.is_(None)).order_by(EsppLot.purchase_date)
            )
        ).scalars()
    ]
    announced = await _held_ex_dividends(db)
    # "Latest profile" = newest effective_date (spec §5): the cadence the NEXT paychecks
    # follow. Any cadence but 24 omits paydays entirely — worded on the page legend,
    # never guessed here.
    latest_profile = (
        (
            await db.execute(
                select(PaycheckProfile).order_by(PaycheckProfile.effective_date.desc()).limit(1)
            )
        )
        .scalars()
        .first()
    )
    semi_monthly = latest_profile is not None and latest_profile.pay_periods_per_year == 24
    # The update reminder probes the PREVIOUS month's snapshot (the wizard enters a
    # month after it closes).
    prev_month_last_day = date(today.year, today.month, 1) - timedelta(days=1)
    prev_month = date(prev_month_last_day.year, prev_month_last_day.month, 1)
    snapshot = (
        (await db.execute(select(NetWorthSnapshot).where(NetWorthSnapshot.month == prev_month)))
        .scalars()
        .first()
    )
    custom_rows = [
        (row.id, row.event_date, row.label, row.detail)
        for row in (
            await db.execute(
                select(CustomEvent)
                .where(CustomEvent.event_date >= start, CustomEvent.event_date <= end)
                .order_by(CustomEvent.event_date, CustomEvent.id)
            )
        ).scalars()
    ]

    events = compose(
        start,
        end,
        today=today,
        grants=grants,
        stored_periods=stored_periods,
        offerings=offerings,
        unsold_lots=unsold_lots,
        announced_ex_divs=announced,
        custom_rows=custom_rows,
        payday_semi_monthly=semi_monthly,
        missing_update_month=None if snapshot is not None else prev_month,
    )
    return CalendarOut(
        events=[
            CalendarEventOut(
                date=event.event_date,
                type=event.type,
                label=event.label,
                detail=event.detail,
                href=event.href,
                id=event.event_id,
            )
            for event in events
        ]
    )


# --- custom events: the one stored, user-owned source (spec §9.3). Plain single-user
# CRUD — comp.py's rsu-grants grammar (201 create, full-replace PATCH, 204 delete).


def _custom_out(row: CustomEvent) -> CustomEventOut:
    return CustomEventOut(id=row.id, date=row.event_date, label=row.label, detail=row.detail)


async def _get_custom_event(db: AsyncSession, event_id: int) -> CustomEvent:
    row = (
        await db.execute(select(CustomEvent).where(CustomEvent.id == event_id))
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="custom event not found")
    return row


@router.post("/events", response_model=CustomEventOut, status_code=201)
async def create_custom_event(
    body: CustomEventIn, db: AsyncSession = Depends(get_db)
) -> CustomEventOut:
    row = CustomEvent(event_date=body.date, label=body.label, detail=body.detail)
    db.add(row)
    await db.commit()
    return _custom_out(row)


@router.patch("/events/{event_id}", response_model=CustomEventOut)
async def update_custom_event(
    event_id: int, body: CustomEventIn, db: AsyncSession = Depends(get_db)
) -> CustomEventOut:
    """Full replace — the form always submits all three fields (spec §9.3)."""
    row = await _get_custom_event(db, event_id)
    row.event_date = body.date
    row.label = body.label
    row.detail = body.detail
    await db.commit()
    return _custom_out(row)


@router.delete("/events/{event_id}", status_code=204)
async def delete_custom_event(event_id: int, db: AsyncSession = Depends(get_db)) -> Response:
    await db.delete(await _get_custom_event(db, event_id))
    await db.commit()
    return Response(status_code=204)
