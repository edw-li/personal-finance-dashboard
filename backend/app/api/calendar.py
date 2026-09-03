"""The calendar router (2026-09-03 calendar spec §5, §13, §16): LOADERS only — every
rule lives in services/calendar, driven here as plain values. Regions, in order:

  1. loaders  → `_load_sources` (Lane D appends card / tax / dividend facts HERE)
  2. `_compose_for` + GET /calendar
  3. custom events CRUD
  4. overrides PUT/DELETE
  5. ICS export, the token feed and token CRUD (Lane B)

GET-never-rejects: every degradable source degrades inside the loaders or compose();
nothing stored can 500 this."""

import hashlib
import secrets
from datetime import UTC, date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.app_settings import read_update_due_day
from app.api.deps import get_current_user
from app.api.espp import _espp_quote
from app.config import settings
from app.database import get_db
from app.models import (
    CalendarEventOverride,
    CalendarFeedToken,
    CustomEvent,
    EsppLot,
    EsppOffering,
    EsppPeriod,
    NetWorthSnapshot,
    PaycheckProfile,
    Person,
    PositionTransaction,
    RsuGrant,
    Security,
    User,
)
from app.rate_limit import FEED_POLL, limiter
from app.schemas.calendar import (
    CalendarEventOut,
    CalendarItemOut,
    CalendarOut,
    CustomEventIn,
    CustomEventOut,
    FeedTokenCreated,
    FeedTokenIn,
    FeedTokenOut,
    OverrideIn,
    OverrideOut,
    SourceHealthOut,
)
from app.services import rsu_vesting
from app.services.calendar import Sources, compose
from app.services.calendar.generators.custom import CustomRow
from app.services.calendar.generators.dividends import ExDividend
from app.services.calendar.generators.payroll import PaydaySource
from app.services.calendar.ics import render
from app.services.calendar.model import KEY_RE, Event, Window
from app.services.calendar.overrides import Override
from app.services.espp_calc import OfferingInfo, StoredPeriod
from app.services.money import MONEY_MAX_ABS_12_2, quantize_money
from app.services.paycheck_calc import breakdown, half_up2
from app.services.people import load_people, primary_person
from app.services.portfolio_calc import SHARE_Q, fold_transactions
from app.services.scheduler import product_today

router = APIRouter(prefix="/calendar", tags=["calendar"], dependencies=[Depends(get_current_user)])

ZERO = Decimal("0")
# A year plus wrap slack; the frontend asks for ~3-month windows, the fence is only
# against a runaway query composing decades of derived events.
MAX_SPAN_DAYS = 400
# The one cadence this calendar can date (spec §5). Any other cadence omits that person's
# paydays entirely — named in the health footer, never guessed here.
SEMI_MONTHLY_PERIODS = 24
# Used only when the roster has not been seeded at all, where there is exactly ONE payday
# source and the label is therefore never rendered.
UNNAMED_PERSON = "You"
# The overrides key grammar (spec §13), checked by the path parser so a malformed key 422s.
KEY_PATTERN = KEY_RE.pattern


# --- 1. loaders --------------------------------------------------------------------------


def _health(source: str, status: str, note: str | None = None) -> SourceHealthOut:
    return SourceHealthOut(source=source, status=status, note=note)


async def _held_ex_dividends(db: AsyncSession) -> list[ExDividend]:
    """(ticker, next_ex_div_date, held shares) for ACTIVE securities carrying an
    announcement that are actually HELD — folded shares > 0 summed across accounts
    (allocation()'s zero-share rule, SHARE_Q quantize included so dust does not count).
    Lane D adds the per-share estimate."""
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
    held: list[ExDividend] = []
    for security in candidates:
        shares = shares_by_sec.get(security.id, ZERO).quantize(SHARE_Q, rounding=ROUND_HALF_UP)
        if shares > 0:
            held.append(ExDividend(security.ticker, security.next_ex_div_date, shares, None))
    return held


def _schedulable(grant: RsuGrant) -> bool:
    try:
        rsu_vesting.schedule(grant)
    except (ValueError, OverflowError):
        return False
    return True


async def _payday_sources(
    db: AsyncSession, today: date
) -> tuple[list[PaydaySource], SourceHealthOut]:
    """Paydays follow the profile IN FORCE for EACH person (2026-08-27 spec §4.4), not "the
    newest row": the latest row effective today or earlier, else the earliest future one —
    paycheck.py's `_default_profile` rule, resolved in ONE ordered pass."""
    people = await load_people(db)
    primary = primary_person(people)
    in_force: dict[int | None, PaycheckProfile] = {}
    for profile in (
        await db.execute(select(PaycheckProfile).order_by(PaycheckProfile.effective_date))
    ).scalars():
        # A NULL person_id is the pre-household spelling of "the primary"; with no roster
        # every profile shares the one None bucket — the single unlabelled household.
        owner = (
            profile.person_id
            if profile.person_id is not None
            else (None if primary is None else primary.id)
        )
        if profile.effective_date <= today or owner not in in_force:
            in_force[owner] = profile
    owners: list[int | None] = [person.id for person in people if person.id in in_force]
    if None in in_force:
        owners.append(None)
    names = {person.id: person.name for person in people}
    sources: list[PaydaySource] = []
    omitted: list[str] = []
    for owner in owners:
        profile = in_force[owner]
        name = UNNAMED_PERSON if owner is None else names.get(owner, UNNAMED_PERSON)
        semi_monthly = profile.pay_periods_per_year == SEMI_MONTHLY_PERIODS
        # Net pay per check from the same waterfall the Paycheck page shows; a hand-edited
        # cadence breakdown cannot divide by is left unpriced rather than invented.
        net = half_up2(breakdown(profile)["net_pay"]) if profile.pay_periods_per_year >= 1 else None
        sources.append(PaydaySource(name, semi_monthly, net, owner))
        if not semi_monthly:
            omitted.append(name)
    if not sources:
        return sources, _health("payroll", "off", "no paycheck profile")
    if omitted:
        return sources, _health(
            "payroll",
            "partial",
            f"{', '.join(omitted)}: paid on another cadence — paydays omitted",
        )
    return sources, _health("payroll", "ok")


async def _custom_rows(db: AsyncSession, window: Window, names: dict[int, str]) -> list[CustomRow]:
    """Rows whose occurrences CAN land in the window: a single date inside it, or a series
    that started on or before the window end and has not ended before the window start."""
    rows = (
        await db.execute(
            select(CustomEvent)
            .where(
                CustomEvent.event_date <= window.end,
                (CustomEvent.recurrence != "none") | (CustomEvent.event_date >= window.start),
                (CustomEvent.until.is_(None)) | (CustomEvent.until >= window.start),
            )
            .order_by(CustomEvent.event_date, CustomEvent.id)
        )
    ).scalars()
    return [
        CustomRow(
            event_id=row.id,
            event_date=row.event_date,
            label=row.label,
            detail=row.detail,
            person_id=row.person_id,
            # A tag pointing at a person who is somehow absent degrades to UNSTAMPED rather
            # than 500ing (GET-never-rejects) — the row still renders, without its name.
            person_name=None if row.person_id is None else names.get(row.person_id),
            amount=row.amount,
            direction=row.direction,
            recurrence=row.recurrence,
            until=row.until,
        )
        for row in rows
    ]


async def _load_sources(
    db: AsyncSession, window: Window, today: date
) -> tuple[Sources, list[SourceHealthOut], datetime | None]:
    """Every generator input as plain values, plus the health footer and the quote stamp.
    Health rows come out in SOURCE_FAMILIES order; Lane D inserts `card` between tax and
    ritual and refines the tax and dividend notes."""
    health: list[SourceHealthOut] = []

    grants = list(
        (
            await db.execute(select(RsuGrant).order_by(RsuGrant.first_vest_date, RsuGrant.id))
        ).scalars()
    )
    ticker, quote, quoted_at = await _espp_quote(db)
    unschedulable = [grant.label for grant in grants if not _schedulable(grant)]
    if not grants:
        health.append(_health("rsu", "off", "no RSU grants entered"))
    elif quote is None:
        health.append(
            _health(
                "rsu",
                "partial",
                "no ESPP/employer ticker configured — vest values unknown"
                if ticker is None
                else f"no current {ticker} price — vest values unknown",
            )
        )
    elif unschedulable:
        health.append(
            _health("rsu", "partial", f"{len(unschedulable)} grant(s) cannot be scheduled")
        )
    else:
        health.append(_health("rsu", "ok", f"valued at the {ticker} quote"))

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
    health.append(
        _health("espp", "ok")
        if stored_periods
        else _health("espp", "partial", "no purchase periods stored — purchase dates are derived")
    )

    ex_dividends = await _held_ex_dividends(db)
    health.append(
        _health("dividend", "ok")
        if ex_dividends
        else _health("dividend", "off", "no announced ex-dividend dates on held securities")
    )

    payday_sources, payroll_health = await _payday_sources(db, today)
    health.append(payroll_health)

    health.append(
        _health("tax", "ok", "statutory dates; amounts arrive with the withholding tracker")
    )

    due_day = await read_update_due_day(db)
    entered_months = set((await db.execute(select(NetWorthSnapshot.month))).scalars().all())
    health.append(_health("ritual", "ok", f"reminder on day {due_day} of each month"))

    names = {person.id: person.name for person in await load_people(db)}
    custom_rows = await _custom_rows(db, window, names)
    health.append(_health("custom", "ok"))

    sources = Sources(
        grants=grants,
        quote=quote,
        stored_periods=stored_periods,
        offerings=offerings,
        unsold_lots=unsold_lots,
        ex_dividends=ex_dividends,
        payday_sources=payday_sources,
        custom_rows=custom_rows,
        due_day=due_day,
        entered_months=entered_months,
    )
    return sources, health, quoted_at


async def _overrides(db: AsyncSession) -> dict[str, Override]:
    rows = (await db.execute(select(CalendarEventOverride))).scalars()
    return {
        row.event_key: Override(
            row.event_key, row.done_at is not None, row.hidden, row.note, row.amount
        )
        for row in rows
    }


# --- 2. compose + GET --------------------------------------------------------------------


async def _compose_for(
    db: AsyncSession, start: date, end: date, today: date
) -> tuple[list[Event], list[SourceHealthOut], datetime | None]:
    """Shared by GET /calendar and Lane B's ICS routes: load, compose, overlay."""
    window = Window(start, end)
    sources, health, quoted_at = await _load_sources(db, window, today)
    events = compose(window, today=today, sources=sources, overrides=await _overrides(db))
    return events, health, quoted_at


def _event_out(event: Event) -> CalendarEventOut:
    return CalendarEventOut(
        date=event.event_date,
        type=event.type,
        source=event.source,
        key=event.key,
        entity_ref=event.entity_ref,
        label=event.label,
        short_label=event.short_label,
        detail=event.detail,
        amount=event.amount,
        direction=event.direction,
        basis=event.basis,
        items=[
            CalendarItemOut(
                label=item.label, amount=item.amount, person_id=item.person_id, detail=item.detail
            )
            for item in event.items
        ],
        href=event.href,
        id=event.event_id,
        person_id=event.person_id,
        recurrence=event.recurrence,
        until=event.until,
        series_start=event.series_start,
        done=event.done,
        hidden=event.hidden,
        note=event.note,
        amount_overridden=event.amount_overridden,
    )


def _validated_span(start: date, end: date) -> None:
    if start > end:
        raise HTTPException(status_code=422, detail="start must be on or before end")
    if (end - start).days > MAX_SPAN_DAYS:
        raise HTTPException(
            status_code=422, detail=f"start to end must span at most {MAX_SPAN_DAYS} days"
        )


@router.get("", response_model=CalendarOut)
async def get_calendar(start: date, end: date, db: AsyncSession = Depends(get_db)) -> CalendarOut:
    """{events, sources, quote_as_of} for [start, end] INCLUSIVE, sorted by (date, type,
    label). 422 on a reversed pair or a span past 400 days."""
    _validated_span(start, end)
    # product_today, never date.today(): the reminder date and the fold's "today" must
    # agree with the scheduler-zone day (comp.py's clock rule).
    events, health, quoted_at = await _compose_for(db, start, end, product_today())
    return CalendarOut(
        events=[_event_out(event) for event in events], sources=health, quote_as_of=quoted_at
    )


# --- 3. custom events: the one stored, user-owned source (spec §9.3 + money §6) ---------


def _custom_out(row: CustomEvent) -> CustomEventOut:
    return CustomEventOut(
        id=row.id,
        date=row.event_date,
        label=row.label,
        detail=row.detail,
        person_id=row.person_id,
        amount=row.amount,
        direction=row.direction,
        recurrence=row.recurrence,
        until=row.until,
    )


async def _get_custom_event(db: AsyncSession, event_id: int) -> CustomEvent:
    row = (
        await db.execute(select(CustomEvent).where(CustomEvent.id == event_id))
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="custom event not found")
    return row


async def _validated_person_id(db: AsyncSession, person_id: int | None) -> int | None:
    """422 with the net-worth router's sentence, checked before the write so a bad id never
    surfaces as asyncpg's ForeignKeyViolationError inside a 500."""
    if person_id is not None and (await db.get(Person, person_id)) is None:
        raise HTTPException(status_code=422, detail=f"unknown person_id: {person_id}")
    return person_id


def _validated_amount(value: Decimal | None) -> Decimal | None:
    # Numeric(12,2): quantize_money's bounded quantize 422s a figure the column cannot hold.
    return None if value is None else quantize_money(value, "amount", max_abs=MONEY_MAX_ABS_12_2)


@router.post("/events", response_model=CustomEventOut, status_code=201)
async def create_custom_event(
    body: CustomEventIn, db: AsyncSession = Depends(get_db)
) -> CustomEventOut:
    row = CustomEvent(
        event_date=body.date,
        label=body.label,
        detail=body.detail,
        person_id=await _validated_person_id(db, body.person_id),
        amount=_validated_amount(body.amount),
        direction=body.direction,
        recurrence=body.recurrence,
        until=body.until,
    )
    db.add(row)
    await db.commit()
    return _custom_out(row)


@router.patch("/events/{event_id}", response_model=CustomEventOut)
async def update_custom_event(
    event_id: int, body: CustomEventIn, db: AsyncSession = Depends(get_db)
) -> CustomEventOut:
    """Full replace — the form always submits every field. Whole-series edits only: a
    recurring row is one row, so this moves every occurrence at once (spec §2)."""
    row = await _get_custom_event(db, event_id)
    row.person_id = await _validated_person_id(db, body.person_id)
    row.event_date = body.date
    row.label = body.label
    row.detail = body.detail
    row.amount = _validated_amount(body.amount)
    row.direction = body.direction
    row.recurrence = body.recurrence
    row.until = body.until
    await db.commit()
    return _custom_out(row)


@router.delete("/events/{event_id}", status_code=204)
async def delete_custom_event(event_id: int, db: AsyncSession = Depends(get_db)) -> Response:
    await db.delete(await _get_custom_event(db, event_id))
    await db.commit()
    return Response(status_code=204)


# --- 4. overrides: the user's edits on generated events (spec §13) ----------------------


async def _find_override(db: AsyncSession, key: str) -> CalendarEventOverride | None:
    where = CalendarEventOverride.event_key == key
    return (await db.execute(select(CalendarEventOverride).where(where))).scalar_one_or_none()


def _override_out(row: CalendarEventOverride) -> OverrideOut:
    return OverrideOut(
        key=row.event_key,
        done=row.done_at is not None,
        hidden=row.hidden,
        note=row.note,
        amount=row.amount,
    )


@router.put("/overrides/{key}", response_model=OverrideOut)
async def put_override(
    body: OverrideIn,
    key: str = Path(pattern=KEY_PATTERN, max_length=120),
    db: AsyncSession = Depends(get_db),
) -> OverrideOut:
    """Upsert, full replace (the house law): a PUT without an amount clears the figure."""
    amount = _validated_amount(body.amount)
    row = await _find_override(db, key)
    if row is None:
        row = CalendarEventOverride(event_key=key)
        db.add(row)
    # done_at keeps WHEN it was ticked; a re-PUT with done=True on an already-done row
    # leaves the original stamp alone.
    if body.done and row.done_at is None:
        row.done_at = datetime.now(tz=UTC)
    elif not body.done:
        row.done_at = None
    row.hidden = body.hidden
    row.note = body.note
    row.amount = amount
    await db.commit()
    return _override_out(row)


@router.delete("/overrides/{key}", status_code=204)
async def delete_override(
    key: str = Path(pattern=KEY_PATTERN, max_length=120), db: AsyncSession = Depends(get_db)
) -> Response:
    row = await _find_override(db, key)
    if row is None:
        raise HTTPException(status_code=404, detail="override not found")
    await db.delete(row)
    await db.commit()
    return Response(status_code=204)


# --- 5. ICS: the download, the token feed, the tokens (spec §11) — Lane B --------------

ICS_MEDIA_TYPE = "text/calendar"  # Starlette appends "; charset=utf-8" to text/* itself
ICS_FILENAME = "financial-calendar.ics"
FEED_BACK_DAYS = 30
FEED_FORWARD_DAYS = 365
LAST_USED_BUMP = timedelta(hours=1)
# token_urlsafe(32) renders 43 characters; the window is wide either side so a future
# token size still fits. Checked IN THE HANDLER rather than as Query(min_length=...):
# FastAPI's 422 echoes the offending value straight back to the caller (and into any
# error log), and a malformed token must be indistinguishable from an unknown one.
FEED_TOKEN_MIN = 16
FEED_TOKEN_MAX = 128
# The one 200 body neither route declares through a response_model.
ICS_RESPONSES: dict[int | str, dict[str, object]] = {200: {"content": {ICS_MEDIA_TYPE: {}}}}

# The feed router carries NO auth dependency: the token in the URL is the credential, and a
# calendar app holds nothing else. Included separately by main.py.
feed_router = APIRouter(prefix="/calendar", tags=["calendar"])


def _hash_token(plaintext: str) -> str:
    return hashlib.sha256(plaintext.encode()).hexdigest()


def _ics_response(text: str, extra_headers: dict[str, str]) -> Response:
    return Response(content=text.encode("utf-8"), media_type=ICS_MEDIA_TYPE, headers=extra_headers)


@router.get("/export.ics", responses=ICS_RESPONSES)
async def export_ics(start: date, end: date, db: AsyncSession = Depends(get_db)) -> Response:
    """The "Add to calendar (.ics)" download: the same window fence as GET /calendar, the
    same composer, rendered once."""
    _validated_span(start, end)
    events, _health, _quoted_at = await _compose_for(db, start, end, product_today())
    return _ics_response(
        render(events, public_url=settings.public_url),
        {"Content-Disposition": f'attachment; filename="{ICS_FILENAME}"'},
    )


@feed_router.get("/feed.ics", responses=ICS_RESPONSES)
@limiter.limit(FEED_POLL)
async def feed_ics(
    request: Request,
    token: str = Query(),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """The subscription feed: 30 days back, 365 forward. Unknown or revoked tokens 404 with
    one sentence — no oracle for token existence. The body's sha256 is the ETag; a matching
    If-None-Match is a 304 with no body, which is what makes a 12-hour poll cheap."""
    if not FEED_TOKEN_MIN <= len(token) <= FEED_TOKEN_MAX:
        raise HTTPException(status_code=404, detail="feed not found")
    presented_hash = _hash_token(token)
    row = (
        await db.execute(
            select(CalendarFeedToken).where(CalendarFeedToken.token_hash == presented_hash)
        )
    ).scalar_one_or_none()
    # The indexed equality NARROWS, compare_digest DECIDES: the credential verdict must not
    # rest on the database's collation semantics (a case-insensitive collation would widen
    # `=`) nor on an early-returning byte compare. Both sides are already hashes of a
    # 256-bit random token, so no secret is in the timing either way — this keeps it so.
    if row is None or not secrets.compare_digest(row.token_hash, presented_hash):
        raise HTTPException(status_code=404, detail="feed not found")
    now = datetime.now(tz=UTC)
    # At most one write per hour per token: a calendar app polls on its own schedule and an
    # UPDATE per poll would make a read endpoint a writer for no extra information.
    if row.last_used_at is None or now - row.last_used_at >= LAST_USED_BUMP:
        row.last_used_at = now
        await db.commit()
    today = product_today()
    events, _health, _quoted_at = await _compose_for(
        db, today - timedelta(days=FEED_BACK_DAYS), today + timedelta(days=FEED_FORWARD_DAYS), today
    )
    body = render(events, public_url=settings.public_url).encode("utf-8")
    etag = f'"{hashlib.sha256(body).hexdigest()}"'
    headers = {"ETag": etag, "Cache-Control": "private, max-age=3600"}
    presented_etags = {
        candidate.strip().removeprefix("W/")
        for candidate in request.headers.get("if-none-match", "").split(",")
    }
    if etag in presented_etags:
        return Response(status_code=304, headers=headers)
    return Response(content=body, media_type=ICS_MEDIA_TYPE, headers=headers)


def _token_out(row: CalendarFeedToken) -> FeedTokenOut:
    return FeedTokenOut(
        id=row.id, label=row.label, created_at=row.created_at, last_used_at=row.last_used_at
    )


@router.get("/feed-tokens", response_model=list[FeedTokenOut])
async def list_feed_tokens(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> list[FeedTokenOut]:
    rows = (
        await db.execute(
            select(CalendarFeedToken)
            .where(CalendarFeedToken.user_id == user.id)
            .order_by(CalendarFeedToken.created_at, CalendarFeedToken.id)
        )
    ).scalars()
    return [_token_out(row) for row in rows]


@router.post("/feed-tokens", response_model=FeedTokenCreated, status_code=201)
async def create_feed_token(
    body: FeedTokenIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> FeedTokenCreated:
    """Mint, store the hash, hand back the plaintext ONCE."""
    plaintext = secrets.token_urlsafe(32)
    row = CalendarFeedToken(user_id=user.id, token_hash=_hash_token(plaintext), label=body.label)
    db.add(row)
    await db.commit()
    await db.refresh(row)  # created_at is a server default
    return FeedTokenCreated(
        id=row.id, label=row.label, created_at=row.created_at, last_used_at=None, token=plaintext
    )


@router.delete("/feed-tokens/{token_id}", status_code=204)
async def revoke_feed_token(
    token_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> Response:
    row = await db.get(CalendarFeedToken, token_id)
    if row is None or row.user_id != user.id:
        raise HTTPException(status_code=404, detail="feed token not found")
    await db.delete(row)
    await db.commit()
    return Response(status_code=204)
