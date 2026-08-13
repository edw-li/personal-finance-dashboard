from datetime import date
from decimal import Decimal

from sqlalchemy import Date, ForeignKey, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class SpendingCategory(Base):
    __tablename__ = "spending_categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    slug: Mapped[str] = mapped_column(String(80), unique=True)
    sort_order: Mapped[int] = mapped_column(default=0)
    is_active: Mapped[bool] = mapped_column(default=True)


class MonthlySpending(Base):
    __tablename__ = "monthly_spending"
    __table_args__ = (UniqueConstraint("month", "category_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    month: Mapped[date] = mapped_column(Date)  # first of month
    category_id: Mapped[int] = mapped_column(
        ForeignKey("spending_categories.id", ondelete="CASCADE")
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))


class MonthlyCashflow(Base):
    __tablename__ = "monthly_cashflow"

    month: Mapped[date] = mapped_column(Date, primary_key=True)  # first of month
    net_pay: Mapped[Decimal] = mapped_column(Numeric(12, 2))
