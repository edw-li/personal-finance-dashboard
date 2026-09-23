"""The matrix's category comparison indexes each month's spending once per request
(2026-09-23 spec §P4); the old per-lookup `next(...)` scan is kept here as the oracle."""

import random
from datetime import date
from decimal import Decimal

import pytest

from app.schemas.month_review import FeedCoverage, MonthReviewOut, ReviewedFeeds
from app.services.metrics import category_amounts, category_comparison
from app.services.month_review import ReviewBook, month_shift
from app.services.paycheck_calc import half_up2

ZERO = Decimal("0.00")


def old_category_comparison(book, category_id, focus):
    """The pre-index algorithm, verbatim."""
    values = []
    for offset in range(-12, 0):
        month = month_shift(focus, offset)
        state = book.months.get(month)
        if not state or not state.eligible_spending:
            continue
        entry = next(
            (item for item in book.inputs[month]["spending"] if item["category_id"] == category_id),
            None,
        )
        if entry is not None:
            values.append(entry["amount"])
    count = len(values)
    return (half_up2(sum(values, ZERO) / count) if count else None), count


def state(month: date, eligible: bool) -> MonthReviewOut:
    return MonthReviewOut(
        month=month,
        state="closed" if eligible else "in_progress",
        input_revision="x" * 64,
        reviewed=ReviewedFeeds(),
        coverage=FeedCoverage(balances=True, spending=True, take_home=True, spending_nonzero=True),
        can_close=True,
        blockers=[],
        eligible_spending=eligible,
        eligible_savings=eligible,
        legacy_eligible=False,
        source_link="/",
    )


def random_book(seed: int) -> tuple[ReviewBook, list[date]]:
    """39 months, random category subsets (including empty months and zero amounts), about
    one month in five ineligible."""
    rng = random.Random(seed)
    months = [month_shift(date(2023, 8, 1), i) for i in range(39)]
    inputs, states = {}, {}
    for month in months:
        categories = sorted(rng.sample(range(1, 20), rng.randint(0, 19)))
        inputs[month] = {
            "spending": [
                {
                    "category_id": category_id,
                    "amount": Decimal(f"{rng.randint(0, 99999)}.{rng.randint(0, 99):02d}"),
                }
                for category_id in categories
            ]
        }
        states[month] = state(month, rng.random() < 0.8)
    return ReviewBook(date(2026, 9, 12), None, states, inputs, {}), months


def test_the_indexed_comparison_equals_the_scan_on_random_books():
    for seed in range(8):
        book, months = random_book(seed)
        amounts = category_amounts(book)
        # Category 0 and 20 never appear; the focus runs one month past the book.
        for category_id in range(21):
            for focus in [*months, month_shift(months[-1], 1)]:
                expected = old_category_comparison(book, category_id, focus)
                assert category_comparison(book, category_id, focus, amounts) == expected


def test_the_first_entry_wins_like_the_scan_did():
    month = date(2026, 7, 1)
    book = ReviewBook(
        date(2026, 9, 12),
        None,
        {month: state(month, True)},
        {
            month: {
                "spending": [
                    {"category_id": 3, "amount": Decimal("10.00")},
                    {"category_id": 3, "amount": Decimal("99.00")},
                ]
            }
        },
        {},
    )
    amounts = category_amounts(book)
    assert amounts == {month: {3: Decimal("10.00")}}
    assert category_comparison(book, 3, date(2026, 8, 1), amounts) == (Decimal("10.00"), 1)


def test_the_index_is_required():
    """No per-call default: indexing all 39 months for ONE comparison is the trap the index
    removed. Callers build category_amounts(book) once and pass it (review of §P4)."""
    book, months = random_book(1)
    with pytest.raises(TypeError):
        category_comparison(book, 3, months[-1])  # type: ignore[call-arg]
