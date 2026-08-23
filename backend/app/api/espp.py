"""ESPP API: the lots table, the periods editor, and the chained 25k modeler (spec §5).

Three column families meet here, and each one has its own quantum: `espp_lots` prices are
Numeric(14,5) — the one place in the app that is NOT 4dp, because the sheet's purchase
price genuinely carries 5 dp (0.85 x 48.509 = 41.23265) — shares are Numeric(12,4),
period money is Numeric(12,2) and contribution_pct is Numeric(10,9). Writers quantize to
the column scale BEFORE the first insert (money.py's bounds vocabulary), so an over-scale
value can never surface as a bare sqlstate 22003.

Reads never reject stored data: `espp_calc` quantizes computed outputs with a plain
`Decimal.quantize`, never money.py's bounded quantizers, and every hop of the espp_ticker
soft link degrades to null instead of raising (Plan 1 note: a clean seed has the setting
but no matching securities row). The modeler's price params carry the LATEST_PRICES bound
(Numeric(14,4), 10^10) rather than the lot family's 10^9 for the same reason: those params
default to a stored quote, and no quote the price job could have written may 422 a GET.
"""

from datetime import date, datetime
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models import AppSetting, EsppLot, EsppOffering, EsppPeriod, LatestPrice, Security
from app.schemas.espp import (
    LotIn,
    LotOut,
    LotsOut,
    LotUpdate,
    ModelerOut,
    ModelerPeriodOut,
    ModelerTotalsOut,
    OfferingIn,
    OfferingOut,
    OfferingUpdate,
    PeriodIn,
    PeriodOut,
    PeriodUpdate,
)
from app.services.espp_calc import (
    DISCOUNT,
    OfferingInfo,
    StoredPeriod,
    lot_metrics,
    plan_year_rows,
    run_modeler,
)
from app.services.money import (
    DATE_MAX,
    DATE_MIN,
    MONEY_MAX_ABS_12_2,
    MONEY_MAX_ABS_14_4,
    _quantize_bounded,
    quantize_money,
    quantize_price,
    require_reasonable_date,
)

router = APIRouter(prefix="/espp", tags=["espp"], dependencies=[Depends(get_current_user)])

ZERO = Decimal("0")
# espp_lots prices: Numeric(14,5) keeps 9 integer digits.
ESPP_PRICE_QUANTUM = Decimal("0.00001")
ESPP_PRICE_MAX_ABS = Decimal(10) ** 9
# The modeler's price knobs are never stored, so they wear their SOURCE's bound instead:
# latest_prices.price is Numeric(14,4) (10 integer digits), and a stored quote must never
# be able to 422 the no-param GET that reads it.
MODELER_PRICE_MAX_ABS = MONEY_MAX_ABS_14_4
# espp_lots.shares: Numeric(12,4) keeps 8.
SHARES_MAX_ABS = Decimal(10) ** 8
PCT_QUANTUM_9 = Decimal("0.000000001")
# Numeric(10,9) really only holds ONE integer digit, but the 0..1 check below is what
# enforces that — this bound is only the NaN/absurd-magnitude fence, kept loose so a
# `contribution_pct=14` (meaning 14%) reports the mis-scale, not a "10^1" complaint.
PCT_INPUT_MAX_ABS = Decimal(10) ** 10

# Both PKs are int4: an out-of-range id would reach asyncpg as a bare DataError (a 500),
# so it is fenced at the boundary — paycheck.py's IdPath, taxes.py's YearPath precedent.
INT32_MAX = 2**31 - 1
IdPath = Annotated[int, Path(ge=1, le=INT32_MAX)]

# The modeler's year filter runs over period_end.year, and every period date went
# through money.py's century guard — so the query param wears the same bounds.
YearQuery = Annotated[int | None, Query(ge=DATE_MIN.year, le=DATE_MAX.year)]


def _quantize5(value: Decimal, field: str, max_abs: Decimal = ESPP_PRICE_MAX_ABS) -> Decimal:
    """The espp price family. money.py owns the 422 vocabulary and the NaN / over-bound
    pre-checks; it just has no public 5dp quantizer, and its module is out of this task's
    scope — calling the shared helper beats minting a second phrasing for the same error.
    The `+ ZERO` is belt-and-braces, not load-bearing: collapsing the signed zero a tiny
    negative would keep is the house convention for anything that reaches the wire, but no
    current call order can reach one — `_positive_price` rejects <= 0 immediately after,
    and the only other caller derives 0.85 x two already-positive prices."""
    return _quantize_bounded(value, field, ESPP_PRICE_QUANTUM, max_abs) + ZERO


def _positive_price(value: Decimal, field: str, max_abs: Decimal = ESPP_PRICE_MAX_ABS) -> Decimal:
    quantized = _quantize5(value, field, max_abs)
    if quantized <= 0:
        raise HTTPException(status_code=422, detail=f"{field} must be positive")
    return quantized


def _positive_shares(value: Decimal, field: str) -> Decimal:
    # quantize_price, not quantize_shares: money.py's PRICE_QUANTUM (4dp) is exactly the
    # espp_lots.shares scale, while quantize_shares is 6dp for portfolio's Numeric(16,6).
    quantized = quantize_price(value, field, max_abs=SHARES_MAX_ABS) + ZERO
    if quantized <= 0:
        raise HTTPException(status_code=422, detail=f"{field} must be positive")
    return quantized


def _non_negative_money(value: Decimal, field: str) -> Decimal:
    quantized = quantize_money(value, field, max_abs=MONEY_MAX_ABS_12_2) + ZERO
    # Check the RAW value too: "-0.001" quantizes to -0.00, which compares == 0
    # (portfolio.py's _validated_annual_dividend posture).
    if value < 0 or quantized < 0:
        raise HTTPException(status_code=422, detail=f"{field} must be >= 0")
    return quantized


def _validated_pct(value: Decimal, field: str) -> Decimal:
    quantized = _quantize_bounded(value, field, PCT_QUANTUM_9, PCT_INPUT_MAX_ABS) + ZERO
    if value < 0 or not 0 <= quantized <= 1:
        # The Plan 1 mis-scale guard, ESPP flavour: a 14 meant as 14% must never reach
        # the chain (and Numeric(10,9) could not store it anyway).
        raise HTTPException(status_code=422, detail=f"{field} must be between 0 and 1")
    return quantized


async def _espp_quote(db: AsyncSession) -> tuple[str | None, Decimal | None, datetime | None]:
    """app_settings['espp_ticker'] -> securities -> latest_prices, degrading at every hop.

    The envelope (`{"value": ...}`) is convention only (Plan 1 note), so an unexpected
    shape reads as "no ticker" rather than raising — same posture as
    net_worth_calc.get_swr_pct, minus the default: there is no sane fallback ticker.
    """
    setting = await db.get(AppSetting, "espp_ticker")
    if setting is None or not isinstance(setting.value, dict):
        return None, None, None
    raw = setting.value.get("value")
    # Normalized like portfolio.py's _normalize_ticker, so a hand-typed "nvda" still hits.
    ticker = raw.strip().upper() if isinstance(raw, str) else ""
    if not ticker:
        return None, None, None
    security = (
        (await db.execute(select(Security).where(Security.ticker == ticker))).scalars().first()
    )
    if security is None:
        return ticker, None, None
    latest = await db.get(LatestPrice, security.id)
    if latest is None:
        return ticker, None, None
    return ticker, latest.price, latest.quoted_at


# --- lots ---


def _validated_lot(
    purchase_date: date,
    qualifying_date: date,
    shares: Decimal,
    subscription_price: Decimal,
    purchase_fmv: Decimal,
    purchase_price: Decimal | None,
    sold_date: date | None,
    sold_price: Decimal | None,
) -> dict:
    """One lot's stored columns, validated as a WHOLE row (Plan 4 house law) so a PATCH
    can hand over the merged values and get the same cross-field rules as a POST.

    Raises before it returns anything, so a rejected request leaves no partial state.
    """
    require_reasonable_date(purchase_date, "purchase_date")
    require_reasonable_date(qualifying_date, "qualifying_date")
    if qualifying_date < purchase_date:
        raise HTTPException(
            status_code=422, detail="qualifying_date must be on or after purchase_date"
        )
    quantity = _positive_shares(shares, "shares")
    subscription = _positive_price(subscription_price, "subscription_price")
    fmv = _positive_price(purchase_fmv, "purchase_fmv")
    if purchase_price is None:
        # The lots-table shape: 0.85 x the lower price at 5dp, with NO ceil — the
        # modeler's ROUNDUP applies to the what-if purchase, not to a stored lot.
        # Both operands are already positive at 5dp, so this can never round to 0.
        price = _quantize5(DISCOUNT * min(subscription, fmv), "purchase_price")
    else:
        price = _positive_price(purchase_price, "purchase_price")
    # A half-filled disposition is the one shape the computed columns cannot read.
    if (sold_date is None) != (sold_price is None):
        raise HTTPException(status_code=422, detail="sold_date and sold_price must be set together")
    if sold_date is not None:
        require_reasonable_date(sold_date, "sold_date")
        if sold_date < purchase_date:
            raise HTTPException(
                status_code=422, detail="sold_date must be on or after purchase_date"
            )
        sold_price = _positive_price(sold_price, "sold_price")
    return {
        "purchase_date": purchase_date,
        "qualifying_date": qualifying_date,
        "shares": quantity,
        "subscription_price": subscription,
        "purchase_fmv": fmv,
        "purchase_price": price,
        "sold_date": sold_date,
        "sold_price": sold_price,
    }


def _lot_out(lot: EsppLot, current_price: Decimal | None, today: date) -> LotOut:
    return LotOut(
        id=lot.id,
        purchase_date=lot.purchase_date,
        qualifying_date=lot.qualifying_date,
        shares=lot.shares,
        subscription_price=lot.subscription_price,
        purchase_fmv=lot.purchase_fmv,
        purchase_price=lot.purchase_price,
        sold_date=lot.sold_date,
        sold_price=lot.sold_price,
        notes=lot.notes,
        **lot_metrics(lot, current_price, today),
    )


async def _get_lot(db: AsyncSession, lot_id: int) -> EsppLot:
    lot = await db.get(EsppLot, lot_id)
    if lot is None:
        raise HTTPException(status_code=404, detail="espp lot not found")
    return lot


async def _require_free_purchase_date(db: AsyncSession, purchase_date: date) -> None:
    taken = (
        (await db.execute(select(EsppLot).where(EsppLot.purchase_date == purchase_date)))
        .scalars()
        .first()
    )
    if taken is not None:
        raise HTTPException(
            status_code=409, detail=f"an espp lot for {purchase_date} already exists"
        )


@router.get("/lots", response_model=LotsOut)
async def list_lots(db: AsyncSession = Depends(get_db)) -> LotsOut:
    ticker, current_price, quoted_at = await _espp_quote(db)
    # One of the module's two `date.today()` reads (the modeler's year default is the
    # other); container-local by design (spec §9).
    today = date.today()
    rows = (await db.execute(select(EsppLot).order_by(EsppLot.purchase_date, EsppLot.id))).scalars()
    return LotsOut(
        espp_ticker=ticker,
        current_price=current_price,
        quoted_at=quoted_at,
        lots=[_lot_out(lot, current_price, today) for lot in rows],
    )


@router.post("/lots", response_model=LotOut, status_code=201)
async def create_lot(body: LotIn, db: AsyncSession = Depends(get_db)) -> LotOut:
    fields = _validated_lot(
        purchase_date=body.purchase_date,
        qualifying_date=body.qualifying_date,
        shares=body.shares,
        subscription_price=body.subscription_price,
        purchase_fmv=body.purchase_fmv,
        purchase_price=body.purchase_price,
        sold_date=body.sold_date,
        sold_price=body.sold_price,
    )
    # purchase_date is the natural key. Plain check-then-409: two concurrent creates of
    # the same date would race into an IntegrityError, an accepted house class for a
    # single-user app.
    await _require_free_purchase_date(db, fields["purchase_date"])
    lot = EsppLot(notes=body.notes, **fields)
    db.add(lot)
    await db.commit()
    _ticker, current_price, _quoted_at = await _espp_quote(db)
    return _lot_out(lot, current_price, date.today())


def _merged(provided: dict, key: str, current):
    """PATCH merge for a NOT NULL column: absent keeps it, and an explicit null reads as
    a no-op request rather than an error (portfolio.py's update_security posture)."""
    value = provided.get(key, current)
    return current if value is None else value


@router.patch("/lots/{lot_id}", response_model=LotOut)
async def update_lot(lot_id: IdPath, body: LotUpdate, db: AsyncSession = Depends(get_db)) -> LotOut:
    lot = await _get_lot(db, lot_id)
    provided = body.model_dump(exclude_unset=True)
    fields = _validated_lot(
        purchase_date=_merged(provided, "purchase_date", lot.purchase_date),
        qualifying_date=_merged(provided, "qualifying_date", lot.qualifying_date),
        shares=_merged(provided, "shares", lot.shares),
        subscription_price=_merged(provided, "subscription_price", lot.subscription_price),
        purchase_fmv=_merged(provided, "purchase_fmv", lot.purchase_fmv),
        # NOT `_merged`: an explicit null here means "re-derive the 85% default from the
        # merged subscription/fmv pair", which is the only useful reading for a column
        # that cannot store a null.
        purchase_price=provided.get("purchase_price", lot.purchase_price),
        # The sold pair IS nullable, so an explicit null clears it — but only when both
        # halves are cleared together (_validated_lot rejects the half-filled row).
        sold_date=provided.get("sold_date", lot.sold_date),
        sold_price=provided.get("sold_price", lot.sold_price),
    )
    if fields["purchase_date"] != lot.purchase_date:
        await _require_free_purchase_date(db, fields["purchase_date"])
    # Every raise is behind us — mutate only now, or a 422 halfway through a multi-field
    # PATCH would leave part of the row dirty for the next autoflush.
    for name, value in fields.items():
        setattr(lot, name, value)
    if "notes" in provided:
        lot.notes = provided["notes"]
    await db.commit()
    _ticker, current_price, _quoted_at = await _espp_quote(db)
    return _lot_out(lot, current_price, date.today())


@router.delete("/lots/{lot_id}", status_code=204)
async def delete_lot(lot_id: IdPath, db: AsyncSession = Depends(get_db)) -> Response:
    await db.delete(await _get_lot(db, lot_id))
    await db.commit()
    return Response(status_code=204)


# --- periods ---


def _validated_period(
    label: str,
    period_start: date,
    period_end: date,
    semi_annual_base: Decimal,
    additional_payments: Decimal,
    contribution_pct: Decimal,
) -> dict:
    trimmed = label.strip()
    if not trimmed:
        # A whitespace-only label passes min_length=1 and would render as a blank column
        # header in the modeler (portfolio.py's _validated_name posture).
        raise HTTPException(status_code=422, detail="label must not be blank")
    require_reasonable_date(period_start, "period_start")
    require_reasonable_date(period_end, "period_end")
    if period_end <= period_start:
        raise HTTPException(status_code=422, detail="period_end must be after period_start")
    return {
        "label": trimmed,
        "period_start": period_start,
        "period_end": period_end,
        "semi_annual_base": _non_negative_money(semi_annual_base, "semi_annual_base"),
        "additional_payments": _non_negative_money(additional_payments, "additional_payments"),
        "contribution_pct": _validated_pct(contribution_pct, "contribution_pct"),
    }


async def _get_period(db: AsyncSession, period_id: int) -> EsppPeriod:
    period = await db.get(EsppPeriod, period_id)
    if period is None:
        raise HTTPException(status_code=404, detail="espp period not found")
    return period


async def _require_free_label(db: AsyncSession, label: str) -> None:
    taken = (
        (await db.execute(select(EsppPeriod).where(EsppPeriod.label == label))).scalars().first()
    )
    if taken is not None:
        raise HTTPException(status_code=409, detail=f"espp period {label!r} already exists")


@router.get("/periods", response_model=list[PeriodOut])
async def list_periods(db: AsyncSession = Depends(get_db)) -> list[EsppPeriod]:
    return list(
        (
            await db.execute(select(EsppPeriod).order_by(EsppPeriod.period_end, EsppPeriod.id))
        ).scalars()
    )


@router.post("/periods", response_model=PeriodOut, status_code=201)
async def create_period(body: PeriodIn, db: AsyncSession = Depends(get_db)) -> EsppPeriod:
    fields = _validated_period(
        label=body.label,
        period_start=body.period_start,
        period_end=body.period_end,
        semi_annual_base=body.semi_annual_base,
        additional_payments=body.additional_payments,
        contribution_pct=body.contribution_pct,
    )
    await _require_free_label(db, fields["label"])
    period = EsppPeriod(**fields)
    db.add(period)
    await db.commit()
    return period


@router.patch("/periods/{period_id}", response_model=PeriodOut)
async def update_period(
    period_id: IdPath, body: PeriodUpdate, db: AsyncSession = Depends(get_db)
) -> EsppPeriod:
    period = await _get_period(db, period_id)
    provided = body.model_dump(exclude_unset=True)
    fields = _validated_period(
        label=_merged(provided, "label", period.label),
        period_start=_merged(provided, "period_start", period.period_start),
        period_end=_merged(provided, "period_end", period.period_end),
        semi_annual_base=_merged(provided, "semi_annual_base", period.semi_annual_base),
        additional_payments=_merged(provided, "additional_payments", period.additional_payments),
        contribution_pct=_merged(provided, "contribution_pct", period.contribution_pct),
    )
    if fields["label"] != period.label:
        await _require_free_label(db, fields["label"])
    for name, value in fields.items():
        setattr(period, name, value)
    await db.commit()
    return period


@router.delete("/periods/{period_id}", status_code=204)
async def delete_period(period_id: IdPath, db: AsyncSession = Depends(get_db)) -> Response:
    await db.delete(await _get_period(db, period_id))
    await db.commit()
    return Response(status_code=204)


# --- offerings ---


async def _get_offering(db: AsyncSession, offering_id: int) -> EsppOffering:
    offering = await db.get(EsppOffering, offering_id)
    if offering is None:
        raise HTTPException(status_code=404, detail="espp offering not found")
    return offering


async def _require_free_offering_start(db: AsyncSession, start: date) -> None:
    taken = (
        (await db.execute(select(EsppOffering).where(EsppOffering.offering_start == start)))
        .scalars()
        .first()
    )
    if taken is not None:
        raise HTTPException(
            status_code=409, detail=f"espp offering starting {start.isoformat()} already exists"
        )


@router.get("/offerings", response_model=list[OfferingOut])
async def list_offerings(db: AsyncSession = Depends(get_db)) -> list[EsppOffering]:
    # Ascending offering_start — the resolution order plan_year_rows expects.
    return list(
        (await db.execute(select(EsppOffering).order_by(EsppOffering.offering_start))).scalars()
    )


@router.post("/offerings", response_model=OfferingOut, status_code=201)
async def create_offering(body: OfferingIn, db: AsyncSession = Depends(get_db)) -> EsppOffering:
    require_reasonable_date(body.offering_start, "offering_start")
    price = _positive_price(body.subscription_price, "subscription_price")
    await _require_free_offering_start(db, body.offering_start)
    offering = EsppOffering(
        offering_start=body.offering_start, subscription_price=price, notes=body.notes
    )
    db.add(offering)
    await db.commit()
    return offering


@router.patch("/offerings/{offering_id}", response_model=OfferingOut)
async def update_offering(
    offering_id: IdPath, body: OfferingUpdate, db: AsyncSession = Depends(get_db)
) -> EsppOffering:
    offering = await _get_offering(db, offering_id)
    provided = body.model_dump(exclude_unset=True)
    start = _merged(provided, "offering_start", offering.offering_start)
    require_reasonable_date(start, "offering_start")
    raw_price = _merged(provided, "subscription_price", offering.subscription_price)
    price = _positive_price(raw_price, "subscription_price")
    if start != offering.offering_start:
        await _require_free_offering_start(db, start)
    # Every raise is behind us — mutate only now (update_lot's posture).
    offering.offering_start = start
    offering.subscription_price = price
    if "notes" in provided:
        offering.notes = provided["notes"]  # explicit null clears (nullable column)
    await db.commit()
    return offering


@router.delete("/offerings/{offering_id}", status_code=204)
async def delete_offering(offering_id: IdPath, db: AsyncSession = Depends(get_db)) -> Response:
    await db.delete(await _get_offering(db, offering_id))
    await db.commit()
    return Response(status_code=204)


# --- modeler ---


@router.get("/modeler", response_model=ModelerOut)
async def modeler(
    subscription_price: Decimal | None = None,
    purchase_fmv: Decimal | None = None,
    carry_forward: Decimal | None = None,
    year: YearQuery = None,
    db: AsyncSession = Depends(get_db),
) -> ModelerOut:
    """One calendar year chained against the 25k limit, rows planned by stored-wins /
    derive-to-fill (spec 2026-08-23 §3.3, §5.2). Nothing here is stored; a derived row
    materializes only when the user saves it. Knobs: blank subscription = per-period
    offering resolution (quote fallback + warning); blank FMV = latest quote; blank
    carry = 0. The old 404s are gone — derived rows always exist.
    """
    stored = list(
        (
            await db.execute(select(EsppPeriod).order_by(EsppPeriod.period_end, EsppPeriod.id))
        ).scalars()
    )
    offerings = list(
        (await db.execute(select(EsppOffering).order_by(EsppOffering.offering_start))).scalars()
    )
    today = date.today()
    target_year = year if year is not None else today.year
    ticker, latest_price, quoted_at = await _espp_quote(db)
    # MODELER_PRICE_MAX_ABS, not the lot family's 10^9: these values are never stored, and
    # they DEFAULT to latest_prices.price — a 10^9 fence here would let the price job write
    # a quote that 422s a no-param GET. Lots keep 10^9, which is their real column limit.
    sub_override = (
        None
        if subscription_price is None
        else _positive_price(subscription_price, "subscription_price", MODELER_PRICE_MAX_ABS)
    )
    fmv_override = (
        None
        if purchase_fmv is None
        else _positive_price(purchase_fmv, "purchase_fmv", MODELER_PRICE_MAX_ABS)
    )
    fmv = fmv_override if fmv_override is not None else latest_price
    if fmv is None:
        raise HTTPException(
            status_code=422,
            detail=f"no live price for {ticker or 'the espp ticker'}; pass purchase_fmv",
        )
    carry = _non_negative_money(
        carry_forward if carry_forward is not None else ZERO, "carry_forward"
    )

    rows, warnings = plan_year_rows(
        target_year,
        [
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
        ],
        [
            OfferingInfo(
                offering_start=row.offering_start, subscription_price=row.subscription_price
            )
            for row in offerings
        ],
        latest_price,
        sub_override,
    )
    unpriced = [row.label for row in rows if row.subscription_price is None]
    if unpriced:
        raise HTTPException(
            status_code=422,
            detail=(
                f"no offering covers {', '.join(unpriced)} and no live price for "
                f"{ticker or 'the espp ticker'}; pass subscription_price"
            ),
        )

    result = run_modeler(rows, purchase_fmv=fmv, carry_forward=carry)

    # Year chips (spec §5.2): stored years ∪ offering-covered purchase years ∪ now/next.
    years = {row.period_end.year for row in stored} | {today.year, today.year + 1}
    if offerings:
        first = offerings[0].offering_start
        # An offering's first purchase: Sep–Dec starts buy next Feb; earlier starts buy
        # within their own calendar year.
        first_purchase_year = first.year + 1 if first.month >= 9 else first.year
        years.update(range(first_purchase_year, today.year + 1))

    sub_sources = {"offering" if row.offering_start is not None else "latest_price" for row in rows}
    subscription_source = (
        "override"
        if sub_override is not None
        else (sub_sources.pop() if len(sub_sources) == 1 else "mixed")
    )
    fmv_source = "override" if fmv_override is not None else "latest_price"
    # Provenance, not data: the quote is only behind these numbers when a value actually
    # fell back to it.
    used_quote = fmv_override is None or (
        sub_override is None and any(row.offering_start is None for row in rows)
    )
    return ModelerOut(
        year=target_year,
        espp_ticker=ticker,
        price_source=(
            "params" if sub_override is not None and fmv_override is not None else "latest_price"
        ),
        subscription_source=subscription_source,
        fmv_source=fmv_source,
        quoted_at=quoted_at if used_quote else None,
        subscription_price=sub_override,
        purchase_fmv=result.purchase_fmv,
        carry_forward=result.carry_forward,
        available_years=sorted(years),
        warnings=warnings,
        periods=[
            ModelerPeriodOut(
                id=row.period.period_id,
                stored=row.period.stored,
                label=row.period.label,
                period_start=row.period.period_start,
                period_end=row.period.period_end,
                semi_annual_base=row.period.semi_annual_base,
                additional_payments=row.period.additional_payments,
                contribution_pct=row.period.contribution_pct,
                subscription_price=row.period.subscription_price,
                offering_start=row.period.offering_start,
                eligible_earnings=row.eligible_earnings,
                contribution=row.contribution,
                available=row.available,
                purchase_price=row.purchase_price,
                shares_before_limit=row.shares_before_limit,
                unused_25k=row.unused_25k,
                max_shares_25k=row.max_shares_25k,
                over_limit=row.over_limit,
                shares=row.shares,
                cost=row.cost,
                carry_forward_out=row.carry_forward_out,
                refund=row.refund,
                value_25k=row.value_25k,
            )
            for row in result.periods
        ],
        totals=ModelerTotalsOut(
            total_25k_value=result.totals.total_25k_value,
            out_of_pocket_cost=result.totals.out_of_pocket_cost,
            fmv_of_shares=result.totals.fmv_of_shares,
            remaining_25k=result.totals.remaining_25k,
        ),
    )
