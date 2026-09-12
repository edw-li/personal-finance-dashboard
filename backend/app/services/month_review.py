"""Explicit review state and input fingerprints, shared by every reporting consumer.

Read-time fingerprints catch ordinary editors, imports, undo and restores alike. They
exclude current quotes and use only the payroll profile effective in the reviewed month.
"""

from dataclasses import dataclass
from datetime import date

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Account,
    AccountBalance,
    MonthlyCashflow,
    MonthlySpending,
    NetWorthSnapshot,
    PaycheckProfile,
    SpendingCategory,
)
from app.models.month_review import MonthReview, MonthReviewAdoption
from app.schemas.month_review import FeedCoverage, MonthReviewOut, ReviewedFeeds
from app.services import clock
from app.services.review_input_v1 import month_input, revision

REVIEW_INPUT_TABLES = (
    "accounts",
    "net_worth_snapshots",
    "account_balances",
    "spending_categories",
    "monthly_spending",
    "monthly_cashflow",
    "paycheck_profiles",
    "month_reviews",
)


def month_shift(month: date, offset: int) -> date:
    index = month.year * 12 + month.month - 1 + offset
    return date(index // 12, index % 12 + 1, 1)


@dataclass
class ReviewBook:
    today: date
    adopted_on: date | None
    months: dict[date, MonthReviewOut]
    inputs: dict[date, dict]
    reviews: dict[date, MonthReview]

    @property
    def default_month(self) -> date | None:
        closed = [month for month, state in self.months.items() if state.state == "closed"]
        if closed:
            return max(closed)
        legacy = [month for month, state in self.months.items() if state.legacy_eligible]
        return max(legacy) if legacy else None


def classify_month(
    month: date,
    data: dict,
    review: MonthReview | None,
    *,
    today: date,
    adopted_on: date | None,
    active_accounts: set[int],
    active_categories: set[int],
) -> MonthReviewOut:
    digest = revision(data)
    current_month = today.replace(day=1)
    matches_confirmation = bool(review and review.confirmation_revision == digest)
    reviewed = ReviewedFeeds(
        balances=bool(matches_confirmation and review.balances_reviewed),
        spending=bool(matches_confirmation and review.spending_reviewed),
        take_home=bool(matches_confirmation and review.take_home_reviewed),
    )
    has_balances = bool(data["balances"])
    has_spending = bool(data["spending"])
    nonzero = any(row["amount"] != 0 for row in data["spending"])
    pay = data["net_pay"] is not None
    zero_confirmed = bool(matches_confirmation and review.zero_spending_confirmed)
    complete_spending = has_spending and (nonzero or zero_confirmed)
    changed = bool(
        review
        and (
            (review.reviewed_revision and review.reviewed_revision != digest)
            or (review.legacy_revision and review.legacy_revision != digest)
        )
    )
    is_legacy = bool(
        review
        and review.legacy_revision == digest
        and adopted_on
        and month < adopted_on.replace(day=1)
        and month < current_month
        and review.closed_at is None
    )
    closed = bool(
        review
        and review.closed_at
        and review.reviewed_revision == digest
        and month <= current_month
        and complete_spending
        and has_balances
        and pay
    )
    blockers = []
    if month > current_month:
        blockers.append("Future months remain in progress until their month begins.")
    if not has_balances:
        blockers.append("Enter balances before closing the month.")
    if not has_spending:
        blockers.append("Enter spending, including an explicit zero when appropriate.")
    elif not complete_spending:
        blockers.append("Confirm that the all-zero spending entries are intentional.")
    if not pay:
        blockers.append("Enter take-home pay; an intentional zero is supported.")
    if closed:
        state = "closed"
    elif changed:
        state = "needs_review"
    elif is_legacy:
        state = "unreviewed_history"
    elif not (has_balances or has_spending or pay or review):
        state = "not_started"
    elif not blockers:
        state = "ready_to_review"
    else:
        state = "in_progress"
    # Legacy continuity requires non-zero spending. A saved zero beside real take-home
    # is ambiguous until explicitly reviewed, and a net-pay-only month is not spending.
    legacy_eligible = is_legacy and nonzero
    eligible_spending = closed or legacy_eligible
    return MonthReviewOut(
        month=month,
        state=state,
        input_revision=digest,
        reviewed=reviewed,
        coverage=FeedCoverage(
            balances=has_balances,
            spending=has_spending,
            take_home=pay,
            spending_nonzero=nonzero,
            missing_account_ids=sorted(
                active_accounts - {r["account_id"] for r in data["balances"]}
            ),
            missing_category_ids=sorted(
                active_categories - {r["category_id"] for r in data["spending"]}
            ),
        ),
        can_close=not blockers,
        blockers=blockers,
        eligible_spending=eligible_spending,
        eligible_savings=eligible_spending and pay,
        legacy_eligible=legacy_eligible,
        closed_at=review.closed_at if review else None,
        closed_by=review.closed_by if review else None,
        source_link=f"/update?month={month:%Y-%m-01}&step=review",
    )


async def load_review_book(
    db: AsyncSession,
    *,
    extra_months: list[date] | None = None,
    today: date | None = None,
) -> ReviewBook:
    today = today or clock.product_today()
    models = (
        NetWorthSnapshot,
        AccountBalance,
        MonthlySpending,
        MonthlyCashflow,
        Account,
        SpendingCategory,
        PaycheckProfile,
    )
    # Core mappings avoid stale ORM identities after a Core-based undo/restore.
    snapshots, balances, spending, cashflow, accounts, categories, profiles = [
        list((await db.execute(select(model.__table__))).mappings().all()) for model in models
    ]
    adoption = (
        await db.execute(select(MonthReviewAdoption).execution_options(populate_existing=True))
    ).scalar_one_or_none()
    review_rows = list(
        (await db.execute(select(MonthReview).execution_options(populate_existing=True))).scalars()
    )
    reviews = {row.month: row for row in review_rows}
    dates = {row["month"] for table in (snapshots, spending, cashflow) for row in table} | set(
        reviews
    )
    dates.update(extra_months or [])
    if dates:
        first, last = min(dates), max(dates)
        dates.update(
            month_shift(first, i)
            for i in range((last.year - first.year) * 12 + last.month - first.month + 1)
        )
    active_accounts = {
        row["id"] for row in accounts if row["is_active"] and not row["is_component"]
    }
    active_categories = {row["id"] for row in categories if row["is_active"]}
    inputs, statuses = {}, {}
    for month in sorted(dates):
        data = month_input(
            month, snapshots, balances, spending, cashflow, accounts, categories, profiles
        )
        inputs[month] = data
        statuses[month] = classify_month(
            month,
            data,
            reviews.get(month),
            today=today,
            adopted_on=adoption.adopted_on if adoption else None,
            active_accounts=active_accounts,
            active_categories=active_categories,
        )
    return ReviewBook(today, adoption.adopted_on if adoption else None, statuses, inputs, reviews)


async def lock_review_inputs(db: AsyncSession) -> None:
    """Keep compare-and-save atomic against ALL writers, including bulk import/undo.

    The brief table locks permit reads. They conflict with ordinary INSERT/UPDATE/DELETE,
    so writers need not cooperate with a separate advisory-lock convention. Parents precede
    child tables, matching the existing writers: taking balances before snapshots would
    deadlock an in-flight snapshot creation that next needs to insert its balances.
    """
    await db.execute(
        text(f"LOCK TABLE {', '.join(REVIEW_INPUT_TABLES)} IN SHARE ROW EXCLUSIVE MODE")
    )


async def adopt_existing_history(db: AsyncSession, adopted_on: date) -> None:
    """Explicit bootstrap for migrated/fixture books; never called by GET or imports."""
    if await db.get(MonthReviewAdoption, 1) is not None:
        return
    book = await load_review_book(db, today=adopted_on)
    db.add(MonthReviewAdoption(id=1, adopted_on=adopted_on))
    boundary = adopted_on.replace(day=1)
    for month, state in book.months.items():
        if month < boundary and any(
            (state.coverage.balances, state.coverage.spending, state.coverage.take_home)
        ):
            db.add(MonthReview(month=month, legacy_revision=state.input_revision))
    await db.flush()
