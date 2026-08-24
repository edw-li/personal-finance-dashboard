from datetime import date
from decimal import Decimal

from sqlalchemy import CheckConstraint, Date, ForeignKey, Numeric, String, UniqueConstraint
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
    __table_args__ = (
        UniqueConstraint("month", "category_id"),
        CheckConstraint("EXTRACT(DAY FROM month) = 1", name="month_is_first_of_month"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    month: Mapped[date] = mapped_column(Date)  # first of month
    category_id: Mapped[int] = mapped_column(
        ForeignKey("spending_categories.id", ondelete="CASCADE")
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))


class MonthlyCashflow(Base):
    __tablename__ = "monthly_cashflow"
    __table_args__ = (
        CheckConstraint("EXTRACT(DAY FROM month) = 1", name="month_is_first_of_month"),
    )

    month: Mapped[date] = mapped_column(Date, primary_key=True)  # first of month
    net_pay: Mapped[Decimal] = mapped_column(Numeric(12, 2))


class CategoryBudget(Base):
    """Effective-dated per-category budget targets (2026-08-24 spec §2).

    Dashboard-only — the workbook has no budgets concept, so the importer never reads or
    writes this table (rsu_grants' posture, pinned in test_importer_apply.py). The budget
    for month M is the amount of the row with the greatest effective_month <= M; no row on
    or before M means unbudgeted, and a NULL amount is the dated "budget ends here" marker,
    so clearing a budget is itself history and last March's verdict stays frozen at what
    the budget WAS in March. ondelete CASCADE: a deleted category takes its budget history
    with it — a budget is advice about a category, meaningless without one.
    """

    __tablename__ = "category_budgets"
    __table_args__ = (
        UniqueConstraint("category_id", "effective_month"),
        CheckConstraint(
            "EXTRACT(DAY FROM effective_month) = 1", name="effective_month_is_first_of_month"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    category_id: Mapped[int] = mapped_column(
        ForeignKey("spending_categories.id", ondelete="CASCADE")
    )
    effective_month: Mapped[date] = mapped_column(Date)  # first of month
    amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
