from datetime import UTC, date, datetime
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models import (
    TRANSACTION_SOURCES,
    DividendPayment,
    LatestPrice,
    PortfolioValueHistory,
    PositionTransaction,
    PriceHistory,
    Security,
    SecurityDividendEvent,
)
from tests.portfolio_factories import acct


async def test_security_and_transaction_roundtrip(db):
    sec = Security(
        ticker="VOO", name="Vanguard 500 Index Fund ETF", industry="ETF", holding_type="etf"
    )
    db.add(sec)
    await db.flush()
    db.add(
        PositionTransaction(
            security_id=sec.id,
            portfolio_account=acct("RH Taxable"),
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
            portfolio_account=acct("RH Taxable"),
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


async def test_position_transaction_source_defaults_to_ui(db):
    security = Security(ticker="TSRC", name="Source Test", holding_type="stock")
    db.add(security)
    await db.flush()
    txn = PositionTransaction(
        security_id=security.id,
        portfolio_account=acct("Test"),
        type="buy",
        shares=Decimal("1"),
        price=Decimal("10"),
    )
    db.add(txn)
    await db.commit()
    assert txn.source == "ui"
    assert TRANSACTION_SOURCES == ("import", "ui")


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


async def test_portfolio_value_history_roundtrip_and_unique_date(db):
    row = PortfolioValueHistory(
        snapshot_date=date(2023, 10, 23),
        market_value=Decimal("53619.00"),
        cost_basis=Decimal("53619.00"),
        sp500_value=Decimal("53619.00"),
    )
    db.add(row)
    await db.commit()

    stored = (await db.execute(select(PortfolioValueHistory))).scalar_one()
    assert stored.market_value == Decimal("53619.00")
    assert stored.snapshot_date == date(2023, 10, 23)

    db.add(
        PortfolioValueHistory(
            snapshot_date=date(2023, 10, 23),
            market_value=Decimal("1.00"),
            cost_basis=Decimal("1.00"),
            sp500_value=Decimal("1.00"),
        )
    )
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()  # shared-session contract (conftest): unpoison after IntegrityError


async def test_dividend_source_defaults_manual_and_auto_key_is_unique(db):
    sec = Security(ticker="DIVX", name="Div X", holding_type="stock")
    db.add(sec)
    await db.commit()
    # Held as a plain int: the rollback below expires every instance, and a later sec.id
    # would then emit lazy IO (MissingGreenlet under asyncio).
    sec_id = sec.id
    row = DividendPayment(security_id=sec_id, pay_date=date(2026, 3, 20), amount=Decimal("10.00"))
    db.add(row)
    await db.commit()
    assert row.source == "manual" and row.ex_date is None

    auto_kwargs = dict(
        security_id=sec_id,
        portfolio_account=acct("RH Taxable"),
        pay_date=date(2026, 3, 20),
        amount=Decimal("12.00"),
        source="auto",
        ex_date=date(2026, 3, 20),
        per_share=Decimal("0.820000"),
        shares_held=Decimal("14.634146"),
    )
    db.add(DividendPayment(**auto_kwargs))
    await db.commit()
    # Same (security, account, ex_date) auto key must be refused by the partial index…
    db.add(DividendPayment(**auto_kwargs))
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()
    # …while a second MANUAL row on the same coordinates is fine (index is partial).
    db.add(
        DividendPayment(
            security_id=sec_id,
            portfolio_account=acct("RH Taxable"),
            pay_date=date(2026, 3, 20),
            amount=Decimal("12.00"),
        )
    )
    await db.commit()


async def test_dividend_event_is_unique_per_security_and_ex_date(db):
    """Display-only historical ex-dividend markers (2026-08-28 spec): one row per
    (security, ex_date), carrying a PER-SHARE amount and never a dollar total. The unique
    constraint lives in the MODEL as well as the migration, because the test database is
    built by Base.metadata.create_all (the ux_dividend_auto_event precedent)."""
    sec = Security(ticker="DIVX", name="Div X", holding_type="stock")
    db.add(sec)
    await db.commit()
    assert sec.dividend_events_floor is None  # never deep-fetched
    # Held as a plain int: the rollback below expires every instance, and a later sec.id
    # would then emit lazy IO (MissingGreenlet under asyncio).
    sec_id = sec.id

    db.add(
        SecurityDividendEvent(
            security_id=sec_id, ex_date=date(2024, 3, 15), per_share=Decimal("1.710000")
        )
    )
    await db.commit()
    stored = (await db.execute(select(SecurityDividendEvent))).scalar_one()
    assert stored.per_share == Decimal("1.710000") and stored.ex_date == date(2024, 3, 15)

    db.add(
        SecurityDividendEvent(
            security_id=sec_id, ex_date=date(2024, 3, 15), per_share=Decimal("9.990000")
        )
    )
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()  # shared-session contract (conftest): unpoison after IntegrityError

    other = Security(ticker="BBBX", name="B B", holding_type="stock")
    db.add(other)
    await db.commit()
    # Another date on the same security, and the same date on another security, both legal.
    db.add_all(
        [
            SecurityDividendEvent(
                security_id=sec_id, ex_date=date(2024, 6, 14), per_share=Decimal("1.750000")
            ),
            SecurityDividendEvent(
                security_id=other.id, ex_date=date(2024, 3, 15), per_share=Decimal("0.250000")
            ),
        ]
    )
    await db.commit()
    assert len((await db.execute(select(SecurityDividendEvent))).scalars().all()) == 3

    # ondelete CASCADE: an annotation about a security is meaningless without one.
    await db.delete(other)
    await db.commit()
    assert [r.security_id for r in (await db.execute(select(SecurityDividendEvent))).scalars()] == [
        sec_id,
        sec_id,
    ]
