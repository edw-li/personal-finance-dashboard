import time as time_module
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.config import settings
from app.database import get_db
from app.models import LatestPrice, PositionTransaction, PriceHistory, Security
from app.schemas.portfolio import (
    LatestPriceOut,
    ManualPriceIn,
    PriceHistoryOut,
    PricePoint,
    RefreshOut,
)
from app.services.money import quantize_price, require_reasonable_date
from app.services.portfolio_calc import fold_transactions
from app.services.price_service import refresh_prices, set_manual_price

router = APIRouter(prefix="/prices", tags=["prices"], dependencies=[Depends(get_current_user)])


def get_provider():
    """Module hook so tests monkeypatch the provider without touching yfinance."""
    from app.services.price_provider import YFinanceProvider

    return YFinanceProvider(settings.yfinance_ca_bundle)


@router.post("/refresh", response_model=RefreshOut)
async def refresh(db: AsyncSession = Depends(get_db)) -> RefreshOut:
    started = time_module.monotonic()
    result = await refresh_prices(db, get_provider())
    return RefreshOut(
        updated=result.updated,
        failed=result.failed,
        skipped_manual=result.skipped_manual,
        duration_ms=int((time_module.monotonic() - started) * 1000),
    )


async def _security_by_ticker(db: AsyncSession, ticker: str) -> Security:
    normalized = ticker.strip().upper()
    security = (
        (await db.execute(select(Security).where(Security.ticker == normalized))).scalars().first()
    )
    if security is None:
        raise HTTPException(status_code=404, detail=f"unknown ticker {normalized!r}")
    return security


@router.get("/history/{ticker}", response_model=PriceHistoryOut)
async def history(
    ticker: str,
    days: int = Query(default=365, ge=1, le=3650),
    db: AsyncSession = Depends(get_db),
) -> PriceHistoryOut:
    security = await _security_by_ticker(db, ticker)
    since = date.today() - timedelta(days=days)
    rows = (
        await db.execute(
            select(PriceHistory)
            .where(PriceHistory.security_id == security.id, PriceHistory.price_date >= since)
            .order_by(PriceHistory.price_date)
        )
    ).scalars()
    return PriceHistoryOut(
        ticker=security.ticker, points=[PricePoint(d=r.price_date, c=r.close) for r in rows]
    )


@router.get("/sparklines", response_model=dict[str, list[PricePoint]])
async def sparklines(
    days: int = Query(default=365, ge=1, le=3650),
    db: AsyncSession = Depends(get_db),
) -> dict[str, list[PricePoint]]:
    """History for HELD securities only, downsampled to the last bar of each ISO week
    (plus the latest bar) — one request feeds every holdings-table sparkline."""
    txns = list(
        (
            await db.execute(
                select(PositionTransaction).order_by(
                    PositionTransaction.sort_index, PositionTransaction.id
                )
            )
        ).scalars()
    )
    held_ids = {
        pos.security_id
        for pos in fold_transactions(txns).values()
        if pos.shares.quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP) != 0
    }
    if not held_ids:
        return {}
    securities = {
        s.id: s
        for s in (await db.execute(select(Security).where(Security.id.in_(held_ids)))).scalars()
    }
    since = date.today() - timedelta(days=days)
    rows = (
        await db.execute(
            select(PriceHistory)
            .where(PriceHistory.security_id.in_(held_ids), PriceHistory.price_date >= since)
            .order_by(PriceHistory.security_id, PriceHistory.price_date)
        )
    ).scalars()
    out: dict[str, list[PricePoint]] = {}
    # Last bar per ISO week — the latest bar is always kept because it is by
    # definition the last bar of its own (possibly partial) week.
    week_last: dict[tuple[int, int, int], PriceHistory] = {}
    for row in rows:
        iso = row.price_date.isocalendar()
        week_last[(row.security_id, iso.year, iso.week)] = row
    for row in sorted(week_last.values(), key=lambda r: (r.security_id, r.price_date)):
        ticker = securities[row.security_id].ticker
        out.setdefault(ticker, []).append(PricePoint(d=row.price_date, c=row.close))
    return out


@router.put("/{ticker}", response_model=LatestPriceOut)
async def put_manual_price(
    ticker: str, body: ManualPriceIn, db: AsyncSession = Depends(get_db)
) -> LatestPriceOut:
    security = await _security_by_ticker(db, ticker)
    if not security.is_manual_priced:
        raise HTTPException(
            status_code=409,
            detail="security is not manual-priced — prices come from the refresh",
        )
    price = quantize_price(body.price, "price")
    if price <= 0:
        raise HTTPException(status_code=422, detail="price must be positive")
    as_of = require_reasonable_date(body.as_of or date.today(), "as_of")
    if as_of > date.today():
        raise HTTPException(status_code=422, detail="as_of cannot be in the future")
    await set_manual_price(db, security, price, as_of)
    await db.commit()
    latest = await db.get(LatestPrice, security.id)
    return LatestPriceOut.model_validate(latest)
