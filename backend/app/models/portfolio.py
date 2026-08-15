from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

HOLDING_TYPES = ("etf", "mutual_fund", "stock", "private")
TRANSACTION_TYPES = ("buy", "sell", "split")
TRANSACTION_SOURCES = ("import", "ui")
PRICE_SOURCES = ("yfinance", "manual")


class Security(Base):
    __tablename__ = "securities"

    id: Mapped[int] = mapped_column(primary_key=True)
    ticker: Mapped[str] = mapped_column(String(20), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    industry: Mapped[str | None] = mapped_column(String(80))
    holding_type: Mapped[str] = mapped_column(String(20))  # one of HOLDING_TYPES
    is_manual_priced: Mapped[bool] = mapped_column(default=False)
    is_active: Mapped[bool] = mapped_column(default=True)
    annual_dividend: Mapped[Decimal | None] = mapped_column(Numeric(10, 4))
    ex_div_date: Mapped[date | None] = mapped_column(Date)


class PositionTransaction(Base):
    __tablename__ = "position_transactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    security_id: Mapped[int] = mapped_column(ForeignKey("securities.id", ondelete="CASCADE"))
    account: Mapped[str] = mapped_column(String(80))
    type: Mapped[str] = mapped_column(String(10))  # one of TRANSACTION_TYPES
    txn_date: Mapped[date | None] = mapped_column(Date)
    shares: Mapped[Decimal] = mapped_column(Numeric(16, 6))
    price: Mapped[Decimal] = mapped_column(Numeric(14, 4))
    fees: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    split_factor: Mapped[Decimal | None] = mapped_column(Numeric(10, 4))
    # Preserves spreadsheet row order — cost-basis folding must process transactions in
    # this order because most rows have no date. Order by (sort_index, id) for stability.
    sort_index: Mapped[int] = mapped_column(default=0)
    # Ownership contract (supersedes Plan 2's sort_index-0 rule): the importer keys and
    # sync-deletes ONLY source='import' rows; UI rows are invisible to re-imports.
    source: Mapped[str] = mapped_column(String(10), default="ui", server_default="ui")
    notes: Mapped[str | None] = mapped_column(Text)


class DividendPayment(Base):
    __tablename__ = "dividend_payments"

    id: Mapped[int] = mapped_column(primary_key=True)
    security_id: Mapped[int] = mapped_column(ForeignKey("securities.id", ondelete="CASCADE"))
    account: Mapped[str | None] = mapped_column(String(80))
    pay_date: Mapped[date] = mapped_column(Date)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    notes: Mapped[str | None] = mapped_column(Text)


class LatestPrice(Base):
    __tablename__ = "latest_prices"

    security_id: Mapped[int] = mapped_column(
        ForeignKey("securities.id", ondelete="CASCADE"), primary_key=True
    )
    price: Mapped[Decimal] = mapped_column(Numeric(14, 4))
    quoted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    source: Mapped[str] = mapped_column(String(20))  # one of PRICE_SOURCES


class PriceHistory(Base):
    __tablename__ = "price_history"
    __table_args__ = (UniqueConstraint("security_id", "price_date"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    security_id: Mapped[int] = mapped_column(ForeignKey("securities.id", ondelete="CASCADE"))
    # price_date, NOT date: an attribute named `date` shadows datetime.date inside its own
    # annotation — Mapped[date | None] would then silently build a SQL OR expression and
    # leave the column non-nullable. Verified hazard; do not rename back.
    price_date: Mapped[date] = mapped_column(Date)
    close: Mapped[Decimal] = mapped_column(Numeric(14, 4))
