"""The budget suggestion model (2026-09-07 budget-seed spec §1).

Pure module, so no database: each case is a hand-built (month, amount) series shaped like a
category production actually holds — a rent that stepped up, food that wanders, travel that
fires twice a year. Every figure asserted here was computed with the spec's arithmetic
(cents HALF_UP, sample standard deviation, cv at 4 dp, seeds ceilinged to whole dollars).
"""

from datetime import date
from decimal import Decimal

from app.services.budgets import (
    FIXED_CV,
    MIN_SEED_MONTHS,
    SEED_WINDOW_MONTHS,
    ceil_dollars,
    seed_window,
    suggest,
)

D = Decimal


def m(year: int, month: int) -> date:
    return date(year, month, 1)


def series(start: date, amounts: list[str]) -> list[tuple[date, Decimal]]:
    """(month, amount) pairs from `start`, one per calendar month, ascending."""
    out = []
    for i, amount in enumerate(amounts):
        index = start.year * 12 + start.month - 1 + i
        out.append((date(index // 12, index % 12 + 1, 1), D(amount)))
    return out


# --- the window (spec §1) ---


def test_seed_window_skips_the_current_month_and_take_home_only_months_and_keeps_twelve():
    # Jun 2025 … Sep 2026 entered.
    entered = [m(2025, 6 + i) for i in range(7)] + [m(2026, i) for i in range(1, 10)]
    window = seed_window(entered, [m(2026, 3)], current_month=m(2026, 9))
    assert window == [
        m(2025, 8),
        m(2025, 9),
        m(2025, 10),
        m(2025, 11),
        m(2025, 12),
        m(2026, 1),
        m(2026, 2),
        m(2026, 4),
        m(2026, 5),
        m(2026, 6),
        m(2026, 7),
        m(2026, 8),
    ]
    assert len(window) == SEED_WINDOW_MONTHS == 12


def test_seed_window_takes_what_exists_sorted_and_never_the_present_or_future():
    assert seed_window([m(2026, 8), m(2026, 7)], [], m(2026, 9)) == [m(2026, 7), m(2026, 8)]
    assert seed_window([], [], m(2026, 9)) == []
    assert seed_window([m(2026, 9), m(2026, 10)], [], m(2026, 9)) == []


def test_ceil_dollars_rounds_up_to_the_next_dollar_spelled_in_cents():
    assert ceil_dollars(D("2072.80")) == D("2073.00")
    assert ceil_dollars(D("1007.61")) == D("1008.00")
    assert ceil_dollars(D("194.6525")) == D("195.00")
    assert ceil_dollars(D("600.00")) == D("600.00")


# --- the profiles (spec §1 table) ---


def test_a_steady_cost_that_stepped_up_is_fixed_and_seeds_from_the_latest_month():
    s = suggest(1, "living", series(m(2025, 9), ["2030.00"] * 7 + ["2072.80"] * 5))
    assert (s.profile, s.months) == ("fixed", 12)
    assert (s.mean, s.median, s.latest, s.latest_month) == (
        D("2047.83"),
        D("2030.00"),
        D("2072.80"),
        m(2026, 8),
    )
    assert s.cv == D("0.0108") and s.cv < FIXED_CV
    assert (s.seed, s.skip_reason) == (D("2073.00"), None)


def test_a_variable_category_seeds_the_ceiling_of_its_mean():
    food = [
        "900.00",
        "1100.00",
        "1000.00",
        "1250.50",
        "850.00",
        "1000.25",
        "1120.00",
        "980.00",
        "1010.00",
        "1300.00",
        "940.00",
        "1049.25",
    ]
    s = suggest(2, "living", series(m(2025, 9), food))
    assert s.profile == "variable"
    assert (s.mean, s.median, s.latest, s.cv) == (
        D("1041.67"),
        D("1005.13"),
        D("1049.25"),
        D("0.1279"),
    )
    assert (s.seed, s.skip_reason) == (D("1042.00"), None)
    # Zeros interrupting a steady gift pull the mean UNDER the typical month — still variable.
    gifts = [
        "600.00",
        "600.00",
        "0.00",
        "750.00",
        "600.00",
        "600.00",
        "0.00",
        "600.00",
        "750.00",
        "600.00",
        "600.00",
        "600.00",
    ]
    g = suggest(3, "living", series(m(2025, 9), gifts))
    assert (g.profile, g.mean, g.median, g.cv, g.seed) == (
        "variable",
        D("525.00"),
        D("600.00"),
        D("0.4796"),
        D("525.00"),
    )


def test_a_zero_median_category_is_episodic_and_still_seeds_the_mean():
    travel = ["0.00"] * 3 + ["1525.63"] + ["0.00"] * 4 + ["810.20"] + ["0.00"] * 3
    s = suggest(4, "living", series(m(2025, 9), travel))
    assert (s.profile, s.median, s.mean, s.cv, s.seed) == (
        "episodic",
        D("0.00"),
        D("194.65"),
        D("2.4634"),
        D("195.00"),
    )


def test_high_swing_with_a_positive_median_stays_variable():
    shopping = [
        "0.00",
        "2046.64",
        "307.66",
        "100.00",
        "50.00",
        "900.00",
        "0.00",
        "250.00",
        "600.00",
        "120.00",
        "80.00",
        "1300.00",
    ]
    s = suggest(5, "living", series(m(2025, 9), shopping))
    assert (s.profile, s.mean, s.median, s.cv, s.seed) == (
        "variable",
        D("479.53"),
        D("185.00"),
        D("1.3308"),
        D("480.00"),
    )


def test_dormant_when_nothing_or_nothing_net_was_spent():
    zeros = suggest(6, "living", series(m(2025, 9), ["0.00"] * 12))
    assert (zeros.profile, zeros.months, zeros.mean, zeros.cv, zeros.seed, zeros.skip_reason) == (
        "dormant",
        12,
        D("0.00"),
        None,
        None,
        "dormant",
    )
    refunds = suggest(7, "living", series(m(2026, 5), ["-50.00", "0.00", "0.00", "10.00"]))
    assert (refunds.profile, refunds.mean, refunds.seed, refunds.skip_reason) == (
        "dormant",
        D("-10.00"),
        None,
        "dormant",
    )
    absent = suggest(8, "living", [])
    assert (
        absent.profile,
        absent.months,
        absent.mean,
        absent.median,
        absent.latest,
        absent.latest_month,
    ) == ("dormant", 0, None, None, None, None)
    assert (absent.seed, absent.skip_reason) == (None, "dormant")


def test_sparse_under_three_months_even_when_steady_and_fixed_at_exactly_three():
    assert MIN_SEED_MONTHS == 3
    two = suggest(9, "living", series(m(2026, 7), ["100.00", "120.00"]))
    assert (two.profile, two.months, two.mean, two.cv, two.seed, two.skip_reason) == (
        "sparse",
        2,
        D("110.00"),
        D("0.1286"),
        None,
        "sparse",
    )
    three = suggest(10, "living", series(m(2026, 6), ["100.00", "105.00", "110.00"]))
    assert (three.profile, three.cv, three.seed) == ("fixed", D("0.0476"), D("110.00"))


def test_non_living_kinds_get_figures_but_no_seed():
    taxes = suggest(11, "tax", series(m(2025, 9), ["0.00"] * 11 + ["5044.00"]))
    assert (taxes.profile, taxes.mean, taxes.seed, taxes.skip_reason) == (
        "episodic",
        D("420.33"),
        None,
        "kind",
    )
    transfer = suggest(12, "transfer", [])
    assert (transfer.profile, transfer.seed, transfer.skip_reason) == ("dormant", None, "kind")
