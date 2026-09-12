from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.net_worth import MonthUpsert, MonthUpsertResult
from app.schemas.spending import SpendingMonthUpsert, SpendingUpsertResult

ReviewState = Literal[
    "not_started", "in_progress", "ready_to_review", "closed", "needs_review", "unreviewed_history"
]


class ReviewedFeeds(BaseModel):
    balances: bool = False
    spending: bool = False
    take_home: bool = False


class FeedCoverage(BaseModel):
    balances: bool
    spending: bool
    take_home: bool
    spending_nonzero: bool
    missing_account_ids: list[int] = []
    missing_category_ids: list[int] = []


class MonthReviewOut(BaseModel):
    month: date
    state: ReviewState
    input_revision: str
    reviewed: ReviewedFeeds
    coverage: FeedCoverage
    can_close: bool
    blockers: list[str]
    eligible_spending: bool
    eligible_savings: bool
    legacy_eligible: bool
    closed_at: datetime | None = None
    closed_by: str | None = None
    source_link: str


class MonthReviewListOut(BaseModel):
    adopted_on: date | None
    default_month: date | None
    months: list[MonthReviewOut]


class MonthSaveIn(BaseModel):
    expected_revision: str = Field(pattern=r"^[a-f0-9]{64}$")
    request_id: UUID | None = None
    balances: MonthUpsert | None = None
    spending: SpendingMonthUpsert | None = None
    reviewed: ReviewedFeeds = Field(default_factory=ReviewedFeeds)
    close: bool = False


class MonthSaveOut(BaseModel):
    month: date
    review: MonthReviewOut
    balances: MonthUpsertResult | None = None
    spending: SpendingUpsertResult | None = None
    batch_id: UUID | None = None


class BatchCloseMonth(BaseModel):
    month: date
    expected_revision: str = Field(pattern=r"^[a-f0-9]{64}$")


class BatchCloseIn(BaseModel):
    months: list[BatchCloseMonth] = Field(min_length=1, max_length=240)
    reviewed: ReviewedFeeds


class BatchCloseOut(BaseModel):
    months: list[MonthReviewOut]
    batch_id: UUID | None
