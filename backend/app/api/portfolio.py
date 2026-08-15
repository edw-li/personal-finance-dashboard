import re
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models import DividendPayment, PositionTransaction, Security
from app.schemas.portfolio import (
    SecurityCreate,
    SecurityOut,
    SecurityUpdate,
)
from app.services.money import MONEY_MAX_ABS_10_4, quantize_price, require_reasonable_date

router = APIRouter(
    prefix="/portfolio", tags=["portfolio"], dependencies=[Depends(get_current_user)]
)

# Must START alphanumeric: the provider maps '.' -> '-' for Yahoo, so ".NVDA"/"-NVDA"
# style degenerates would collide on one symbol while occupying two rows.
TICKER_RE = re.compile(r"^[A-Z0-9][A-Z0-9.\-]{0,19}$")


def _normalize_ticker(raw: str) -> str:
    ticker = raw.strip().upper()
    if not TICKER_RE.fullmatch(ticker):
        raise HTTPException(
            status_code=422,
            detail="ticker must be 1-20 characters of A-Z, 0-9, dot or dash, starting alphanumeric",
        )
    return ticker


def _validated_name(raw: str) -> str:
    name = raw.strip()
    if not name:
        raise HTTPException(status_code=422, detail="name must not be blank")
    return name


def _validated_annual_dividend(value: Decimal) -> Decimal:
    quantized = quantize_price(value, "annual_dividend", max_abs=MONEY_MAX_ABS_10_4)
    # Check the RAW value too: "-0.00001" quantizes to -0.0000 which compares == 0.
    if value < 0 or quantized < 0:
        raise HTTPException(status_code=422, detail="annual_dividend must be >= 0")
    return quantized


@router.get("/securities", response_model=list[SecurityOut])
async def list_securities(db: AsyncSession = Depends(get_db)) -> list[Security]:
    return list((await db.execute(select(Security).order_by(Security.ticker))).scalars())


@router.post("/securities", response_model=SecurityOut, status_code=201)
async def create_security(body: SecurityCreate, db: AsyncSession = Depends(get_db)) -> Security:
    ticker = _normalize_ticker(body.ticker)
    name = _validated_name(body.name)
    annual = body.annual_dividend
    if annual is not None:
        annual = _validated_annual_dividend(annual)
    ex_div_date = body.ex_div_date
    if ex_div_date is not None:
        ex_div_date = require_reasonable_date(ex_div_date, "ex_div_date")
    existing = (
        (await db.execute(select(Security).where(Security.ticker == ticker))).scalars().first()
    )
    if existing is not None:
        raise HTTPException(status_code=409, detail=f"security {ticker!r} already exists")
    security = Security(
        ticker=ticker,
        name=name,
        industry=body.industry,
        holding_type=body.holding_type,
        is_manual_priced=body.is_manual_priced,
        annual_dividend=annual,
        ex_div_date=ex_div_date,
    )
    db.add(security)
    await db.commit()
    return security


async def _get_security(db: AsyncSession, security_id: int) -> Security:
    security = await db.get(Security, security_id)
    if security is None:
        raise HTTPException(status_code=404, detail="security not found")
    return security


# ticker is the importer's natural key — PATCH never rewrites it (account-slug posture).
NON_NULLABLE_SECURITY_FIELDS = {"name", "holding_type", "is_manual_priced", "is_active"}


@router.patch("/securities/{security_id}", response_model=SecurityOut)
async def update_security(
    security_id: int, body: SecurityUpdate, db: AsyncSession = Depends(get_db)
) -> Security:
    security = await _get_security(db, security_id)
    # Validate EVERY field before touching the ORM object: a 422 raised halfway through a
    # multi-field PATCH would otherwise leave half the row mutated for the next autoflush.
    validated: dict[str, object] = {}
    for field_name, value in body.model_dump(exclude_unset=True).items():
        if value is None and field_name in NON_NULLABLE_SECURITY_FIELDS:
            continue  # explicit null on a NOT NULL column = no-op request
        if value is not None:
            if field_name == "name":
                value = _validated_name(value)
            elif field_name == "annual_dividend":
                value = _validated_annual_dividend(value)
            elif field_name == "ex_div_date":
                value = require_reasonable_date(value, "ex_div_date")
        validated[field_name] = value
    for field_name, value in validated.items():
        setattr(security, field_name, value)
    await db.commit()
    return security


@router.delete("/securities/{security_id}", status_code=204)
async def delete_security(security_id: int, db: AsyncSession = Depends(get_db)) -> Response:
    security = await _get_security(db, security_id)
    txn_count = (
        await db.execute(
            select(func.count())
            .select_from(PositionTransaction)
            .where(PositionTransaction.security_id == security_id)
        )
    ).scalar_one()
    dividend_count = (
        await db.execute(
            select(func.count())
            .select_from(DividendPayment)
            .where(DividendPayment.security_id == security_id)
        )
    ).scalar_one()
    if txn_count or dividend_count:
        raise HTTPException(
            status_code=409,
            detail=(
                f"security has {txn_count} transactions and {dividend_count} dividends"
                " — deactivate it instead"
            ),
        )
    await db.delete(security)  # latest/history price rows CASCADE — derived data
    await db.commit()
    return Response(status_code=204)
