"""The calendar router (2026-09-03 calendar spec §5, §13, §16): LOADERS only — every
rule lives in services/calendar, driven here as plain values. Regions, in order:

  1. loaders  → `_load_sources` (+ `_card_facts`, `_tax_facts`, `_held_ex_dividends`)
  2. `_compose_for` + GET /calendar
  3. custom events CRUD
  4. overrides PUT/DELETE
  5. (Lane B appends the ICS export, the token feed and token CRUD AFTER this file's end)

GET-never-rejects: every degradable source degrades inside the loaders or compose();
nothing stored can 500 this."""

from datetime import UTC, date, datetime
from decimal import ROUND_HALF_UP, Decimal

from fastapi import APIRouter, Depends, HTTPException, Path, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.app_settings import read_update_due_day
from app.api.deps import get_current_user
from app.api.espp import _espp_quote
from app.api.taxes import withholding_estimate
from app.database import get_db
from app.models import (
    CalendarEventOverride,
    CardCredit,
    CreditCard,
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
    SecurityDividendEvent,
)
from app.schemas.calendar import (
    CalendarEventOut,
    CalendarItemOut,
    CalendarOut,
    CustomEventIn,
    CustomEventOut,
    OverrideIn,
    OverrideOut,
    SourceHealthOut,
)
from app.services import rsu_vesting
from app.services.business_days import next_business_day
from app.services.calendar import Sources, compose
from app.services.calendar.generators.cards import CardCreditFacts, CardFacts
from app.services.calendar.generators.custom import CustomRow
from app.services.calendar.generators.dividends import ExDividend
from app.services.calendar.generators.payroll import PaydaySource
from app.services.calendar.generators.taxes import TaxFacts
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
    (allocation()'s zero-share rule, SHARE_Q quantize included so dust does not count),
    priced at the LATEST stored per-share for the security (the announcement itself carries
    only a date, so the last declared dividend is the only estimate available)."""
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
    ids = [security.id for security in candidates]
    # Ascending by ex_date, so building the dict keeps the LATEST per-share per security.
    latest_per_share: dict[int, Decimal] = dict(
        (
            await db.execute(
                select(SecurityDividendEvent.security_id, SecurityDividendEvent.per_share)
                .where(SecurityDividendEvent.security_id.in_(ids))
                .order_by(SecurityDividendEvent.security_id, SecurityDividendEvent.ex_date)
            )
        ).all()
    )
    held: list[ExDividend] = []
    for security in candidates:
        shares = shares_by_sec.get(security.id, ZERO).quantize(SHARE_Q, rounding=ROUND_HALF_UP)
        if shares > 0:
            held.append(
                ExDividend(
                    security.ticker,
                    security.next_ex_div_date,
                    shares,
                    latest_per_share.get(security.id),
                )
            )
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


async def _card_facts(db: AsyncSession) -> tuple[list[CardFacts], SourceHealthOut]:
    """Active cards with their COUNTED credits. A card without `opened_on` still resets its
    calendar-cadence credits but has no fee or anniversary — the footer counts those."""
    cards = list(
        (
            await db.execute(
                select(CreditCard)
                .where(CreditCard.is_active.is_(True))
                .order_by(CreditCard.sort_order, CreditCard.id)
            )
        ).scalars()
    )
    if not cards:
        return [], _health("card", "off", "no cards entered")
    credits_by_card: dict[int, list[CardCreditFacts]] = {}
    for credit in (
        await db.execute(
            select(CardCredit)
            .where(
                CardCredit.card_id.in_([card.id for card in cards]),
                CardCredit.counts.is_(True),
            )
            .order_by(CardCredit.id)
        )
    ).scalars():
        credits_by_card.setdefault(credit.card_id, []).append(
            CardCreditFacts(credit.id, credit.label, credit.annual_value, credit.reset_cadence)
        )
    facts = [
        CardFacts(
            card.id,
            card.name,
            card.annual_fee,
            card.opened_on,
            tuple(credits_by_card.get(card.id, [])),
        )
        for card in cards
    ]
    undated = sum(1 for card in cards if card.opened_on is None)
    if undated:
        return facts, _health(
            "card",
            "partial",
            f"{undated} card(s) without an opened date — no fee or anniversary events",
        )
    return facts, _health("card", "ok")


async def _tax_facts(
    db: AsyncSession, window: Window, today: date
) -> tuple[dict[int, TaxFacts], SourceHealthOut]:
    """ONE withholding computation for the current year when the window holds future dates,
    plus the prior year's when Apr 15 (the filing) is ahead and inside the window — the
    spec's "one computation per year touching the window" (§16, §20)."""
    if window.end < today:
        return {}, _health(
            "tax", "ok", "statutory dates; amounts are estimated for the current year only"
        )
    try:
        current = await withholding_estimate(db, today.year, today)
    except HTTPException:
        return {}, _health("tax", "partial", f"no {today.year} tax year entered — dates only")
    prior_balance: Decimal | None = None
    filing = next_business_day(date(today.year, 4, 15))
    if filing >= today and window.contains(filing):
        try:
            prior = await withholding_estimate(db, today.year - 1, today)
        except HTTPException:
            prior = None
        if (
            prior is not None
            and prior.balance_projected is not None
            and prior.balance_projected > 0
        ):
            prior_balance = prior.balance_projected
    harbor = current.safe_harbor
    if harbor is None:
        facts = TaxFacts(today.year, None, current.total.projected, None, prior_balance)
        return {today.year: facts}, _health(
            "tax", "partial", "no safe-harbor leg yet — estimated payments unknown"
        )
    # The prior-year leg WON only if it is the lesser of the two, which is exactly when the
    # effective threshold is it — the sentence the detail then names.
    leg = (
        "prior-year"
        if harbor.threshold is not None and harbor.threshold == harbor.effective_threshold
        else "current-year"
    )
    facts = TaxFacts(
        today.year, harbor.effective_threshold, current.total.projected, leg, prior_balance
    )
    note = (
        "safe harbor met"
        if harbor.met
        else f"safe-harbor shortfall split across the remaining {today.year} payments"
    )
    return {today.year: facts}, _health("tax", "ok", note)


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
    Health rows come out in SOURCE_FAMILIES order — `card` between tax and ritual."""
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
    unpriced = sum(1 for item in ex_dividends if item.per_share is None)
    if not ex_dividends:
        health.append(
            _health("dividend", "off", "no announced ex-dividend dates on held securities")
        )
    elif unpriced:
        health.append(
            _health(
                "dividend",
                "partial",
                f"{unpriced} announced date(s) without a stored per-share amount",
            )
        )
    else:
        health.append(_health("dividend", "ok"))

    payday_sources, payroll_health = await _payday_sources(db, today)
    health.append(payroll_health)

    tax_facts, tax_health = await _tax_facts(db, window, today)
    health.append(tax_health)
    cards, card_health = await _card_facts(db)
    health.append(card_health)

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
        tax_facts=tax_facts,
        cards=cards,
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
