"""Explicit review state and input fingerprints, shared by every reporting consumer.

Read-time fingerprints catch ordinary editors, imports, undo and restores alike. They
exclude current quotes and use only the payroll profile effective in the reviewed month.
"""

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, fields, replace
from datetime import date, datetime
from types import MappingProxyType

from sqlalchemy import RowMapping, select, text
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


def before_adoption(month: date, adopted_on: date | None) -> bool:
    """A month before the adoption month — history the review feature adopted (2026-09-23 spec
    §K3 clause (a), §K4). One definition for the close blocker here and month_status."""
    return adopted_on is not None and month < adopted_on.replace(day=1)


@dataclass(frozen=True)
class ReviewSnapshot:
    """A month_reviews row as an immutable value (2026-09-23 spec §P4). A CACHED book is shared
    between requests, so it must not carry ORM objects bound to the session that loaded them.
    The attribute names are MonthReview's — every column classify_month and the read paths
    read — so both read the same either way. The write paths' idempotency columns
    (last_request_*, last_response) stay out: nothing that reads a cached book uses them."""

    month: date
    legacy_revision: str | None
    reviewed_revision: str | None
    confirmation_revision: str | None
    balances_reviewed: bool
    spending_reviewed: bool
    take_home_reviewed: bool
    zero_spending_confirmed: bool
    closed_at: datetime | None
    closed_by: str | None


REVIEW_SNAPSHOT_FIELDS = tuple(field.name for field in fields(ReviewSnapshot))


@dataclass(frozen=True)
class ReviewBook:
    today: date
    adopted_on: date | None
    months: Mapping[date, MonthReviewOut]
    inputs: Mapping[date, dict]
    # The write paths' uncached book carries the ORM rows they update in place; a cached book
    # (load_review_book_snapshot) carries frozen snapshots with the same attribute names.
    reviews: Mapping[date, "MonthReview | ReviewSnapshot"]

    @property
    def default_month(self) -> date | None:
        closed = [month for month, state in self.months.items() if state.state == "closed"]
        if closed:
            return max(closed)
        legacy = [month for month, state in self.months.items() if state.legacy_eligible]
        return max(legacy) if legacy else None


def day_label(value: date, today: date | None = None) -> str:
    """'Oct 1' — with ', 2025' when `today` is given and the year differs. The one spelling of a
    snapshot's day in the server's sentences (the close blocker, the restamp label, the importer's
    warnings)."""
    label = f"{value:%b} {value.day}"
    return label if today is None or value.year == today.year else f"{label}, {value.year}"


def early_balances_blocker(month: date, recorded_on: date, today: date) -> str:
    """K4's sentence (2026-09-23 spec): "Oct 1 balances were recorded early, on Sep 22 — save
    them again on or after Oct 1 before closing October."

    A reader outside this module: the Monthly update (src/pages/MonthlyUpdatePage.tsx,
    `serverEarlyBlocker`) finds this blocker in a review's `blockers` by the phrase
    " balances were recorded early, on " — it shows the sentence, and offers "Confirm {Oct 1}
    balances", only when the server lists it. Rewording the sentence means changing that match
    too; tests/test_monthly_update_parts.py pins the phrase."""
    name = f"{month:%B}" if month.year == today.year else f"{month:%B %Y}"
    first = day_label(month, today)
    return (
        f"{first} balances were recorded early, on {day_label(recorded_on, today)} — "
        f"save them again on or after {first} before closing {name}."
    )


def classify_month(
    month: date,
    data: dict,
    review: "MonthReview | ReviewSnapshot | None",
    *,
    today: date,
    adopted_on: date | None,
    active_accounts: set[int],
    active_categories: set[int],
) -> MonthReviewOut:
    digest = revision(data)
    current_month = today.replace(day=1)
    snapshot = data["snapshot"]
    recorded_early = (
        snapshot["recorded_on"]
        if snapshot and snapshot["recorded_on"] and snapshot["recorded_on"] < month
        else None
    )
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
    elif recorded_early is not None and not before_adoption(month, adopted_on):
        # K4 (2026-09-23 spec): opening balances recorded before the month began are provisional
        # and cannot be certified until saved again on or after the 1st (which restamps them).
        # History from before the adoption month is exempt — never blocked, and never restamped
        # while legacy or closed — so it stays in the averages, and a batch-closed legacy month
        # stays closed (review minor 1).
        blockers.append(early_balances_blocker(month, recorded_early, today))
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


INPUT_MODELS = (
    NetWorthSnapshot,
    AccountBalance,
    MonthlySpending,
    MonthlyCashflow,
    Account,
    SpendingCategory,
    PaycheckProfile,
)


async def _read_input_tables(db: AsyncSession) -> list[list[RowMapping]]:
    # Core mappings avoid stale ORM identities after a Core-based undo/restore.
    return [
        list((await db.execute(select(model.__table__))).mappings().all()) for model in INPUT_MODELS
    ]


async def load_review_book(
    db: AsyncSession,
    *,
    extra_months: list[date] | None = None,
    today: date | None = None,
) -> ReviewBook:
    """The book for WRITE paths: `reviews` holds the session's MonthReview rows, which the
    close/review flows update in place. Read paths use read_cache.cached_review_book."""
    today = today or clock.product_today()
    tables = await _read_input_tables(db)
    adoption = (
        await db.execute(select(MonthReviewAdoption).execution_options(populate_existing=True))
    ).scalar_one_or_none()
    review_rows = list(
        (await db.execute(select(MonthReview).execution_options(populate_existing=True))).scalars()
    )
    return assemble_review_book(
        today=today,
        extra_months=extra_months,
        tables=tables,
        adopted_on=adoption.adopted_on if adoption else None,
        reviews={row.month: row for row in review_rows},
    )


async def load_review_book_snapshot(
    db: AsyncSession,
    *,
    extra_months: list[date] | None = None,
    today: date | None = None,
) -> ReviewBook:
    """The same book with nothing bound to `db`'s session (2026-09-23 spec §P4): the review
    rows arrive as Core rows turned into ReviewSnapshot values and the three mappings are
    read-only, so the read cache can share one book between requests."""
    today = today or clock.product_today()
    tables = await _read_input_tables(db)
    adopted_on = (
        await db.execute(select(MonthReviewAdoption.__table__.c.adopted_on))
    ).scalar_one_or_none()
    review_columns = [MonthReview.__table__.c[name] for name in REVIEW_SNAPSHOT_FIELDS]
    rows = (await db.execute(select(*review_columns))).mappings()
    book = assemble_review_book(
        today=today,
        extra_months=extra_months,
        tables=tables,
        adopted_on=adopted_on,
        reviews={row["month"]: ReviewSnapshot(**row) for row in rows},
    )
    return replace(
        book,
        months=MappingProxyType(dict(book.months)),
        inputs=MappingProxyType(dict(book.inputs)),
        reviews=MappingProxyType(dict(book.reviews)),
    )


def assemble_review_book(
    *,
    today: date,
    extra_months: Iterable[date] | None,
    tables: list[list[RowMapping]],
    adopted_on: date | None,
    reviews: Mapping[date, "MonthReview | ReviewSnapshot"],
) -> ReviewBook:
    """The pure half of the book: canonical inputs and a review state per month, from rows
    already read (INPUT_MODELS order). Every first-of-month between the earliest and the
    latest month of the rows, reviews and extra months is included."""
    snapshots, balances, spending, cashflow, accounts, categories, profiles = tables
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
            adopted_on=adopted_on,
            active_accounts=active_accounts,
            active_categories=active_categories,
        )
    return ReviewBook(today, adopted_on, statuses, inputs, reviews)


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
