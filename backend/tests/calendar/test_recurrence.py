"""rrule-lite expansion (2026-09-03 calendar spec §2, §6): the window clip, the inclusive
`until`, the month-end clamp and the leap-day clamp."""

from datetime import date

import pytest

from app.services.calendar.model import Window
from app.services.calendar.recurrence import expand

W = Window(date(2026, 1, 1), date(2026, 12, 31))


def test_none_is_the_single_date_clipped_to_the_window():
    assert expand("none", date(2026, 9, 12), None, W) == [date(2026, 9, 12)]
    assert expand("none", date(2027, 1, 1), None, W) == []


def test_weekly_steps_seven_days_and_until_is_inclusive():
    assert expand("weekly", date(2026, 9, 1), date(2026, 9, 15), W) == [
        date(2026, 9, 1),
        date(2026, 9, 8),
        date(2026, 9, 15),
    ]


def test_weekly_from_the_distant_past_only_yields_window_dates():
    dates = expand("weekly", date(1999, 1, 5), None, Window(date(2026, 9, 1), date(2026, 9, 30)))
    assert dates == [
        date(2026, 9, 1),
        date(2026, 9, 8),
        date(2026, 9, 15),
        date(2026, 9, 22),
        date(2026, 9, 29),
    ]


def test_monthly_clamps_the_29th_to_31st_to_month_end():
    assert expand("monthly", date(2026, 1, 31), date(2026, 5, 1), W) == [
        date(2026, 1, 31),
        date(2026, 2, 28),
        date(2026, 3, 31),
        date(2026, 4, 30),
    ]
    # Once clamped, the ORIGINAL day returns when the month allows it (Mar 31 above).


def test_yearly_clamps_leap_day():
    assert expand(
        "yearly", date(2024, 2, 29), None, Window(date(2024, 1, 1), date(2028, 12, 31))
    ) == [
        date(2024, 2, 29),
        date(2025, 2, 28),
        date(2026, 2, 28),
        date(2027, 2, 28),
        date(2028, 2, 29),
    ]


def test_occurrences_before_the_window_are_dropped_and_the_window_end_stops_the_series():
    assert expand(
        "monthly", date(2026, 7, 15), None, Window(date(2026, 9, 1), date(2026, 10, 31))
    ) == [
        date(2026, 9, 15),
        date(2026, 10, 15),
    ]


def test_unknown_rule_raises():
    with pytest.raises(ValueError):
        expand("daily", date(2026, 1, 1), None, W)
