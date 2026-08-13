from datetime import UTC, date, datetime
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models import (
    DividendPayment,
    LatestPrice,
    PositionTransaction,
    PriceHistory,
    Security,
)


async def test_security_and_transaction_roundtrip(db):
    sec = Security(
        ticker="VOO", name="Vanguard 500 Index Fund ETF", industry="ETF", holding_type="etf"
    )
    db.add(sec)
    await db.flush()
    db.add(
        PositionTransaction(
            security_id=sec.id,
            account="RH Taxable",
            type="buy",
            txn_date=None,
            shares=Decimal("119.261466"),
            price=Decimal("584.62"),
            sort_index=3,
        )
    )
    db.add(
        DividendPayment(
            security_id=sec.id,
            account="RH Taxable",
            pay_date=date(2025, 3, 20),
            amount=Decimal("171.55"),
        )
    )
    db.add(
        LatestPrice(
            security_id=sec.id,
            price=Decimal("710.17"),
            quoted_at=datetime(2026, 8, 12, 20, 0, tzinfo=UTC),
            source="yfinance",
        )
    )
    db.add(PriceHistory(security_id=sec.id, price_date=date(2026, 8, 11), close=Decimal("708.42")))
    await db.commit()
    txn = (await db.execute(select(PositionTransaction))).scalar_one()
    assert txn.shares == Decimal("119.261466")
    assert txn.txn_date is None  # sheet rows lack dates; importer flags these


async def test_ticker_unique(db):
    db.add(Security(ticker="VTI", name="A", holding_type="etf"))
    await db.commit()
    db.add(Security(ticker="VTI", name="B", holding_type="etf"))
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()


async def test_one_close_per_day(db):
    sec = Security(ticker="SCHD", name="Schwab US Dividend", holding_type="etf")
    db.add(sec)
    await db.flush()
    db.add(PriceHistory(security_id=sec.id, price_date=date(2026, 1, 2), close=Decimal("34")))
    await db.commit()
    db.add(PriceHistory(security_id=sec.id, price_date=date(2026, 1, 2), close=Decimal("35")))
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()
