"""Review metadata is independent of financial rows and never fabricates completion."""

from datetime import date, datetime
from typing import Any

from sqlalchemy import CheckConstraint, Date, DateTime, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class MonthReviewAdoption(Base):
    __tablename__ = "month_review_adoption"
    __table_args__ = (CheckConstraint("id = 1", name="singleton"),)

    id: Mapped[int] = mapped_column(primary_key=True, default=1)
    adopted_on: Mapped[date] = mapped_column(Date)


class MonthReview(Base):
    __tablename__ = "month_reviews"
    __table_args__ = (
        CheckConstraint("EXTRACT(DAY FROM month) = 1", name="month_is_first_of_month"),
    )

    month: Mapped[date] = mapped_column(Date, primary_key=True)
    legacy_revision: Mapped[str | None] = mapped_column(String(64))
    reviewed_revision: Mapped[str | None] = mapped_column(String(64))
    # The feed flags apply only to confirmation_revision, not to later corrections.
    confirmation_revision: Mapped[str | None] = mapped_column(String(64))
    balances_reviewed: Mapped[bool] = mapped_column(default=False, server_default="false")
    spending_reviewed: Mapped[bool] = mapped_column(default=False, server_default="false")
    take_home_reviewed: Mapped[bool] = mapped_column(default=False, server_default="false")
    zero_spending_confirmed: Mapped[bool] = mapped_column(default=False, server_default="false")
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    closed_by: Mapped[str | None] = mapped_column(String(255))
    # A client-generated ID makes a transport retry return the original receipt.
    last_request_id: Mapped[str | None] = mapped_column(String(36))
    last_request_hash: Mapped[str | None] = mapped_column(String(64))
    last_response: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
