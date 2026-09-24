"""The server's one spelling of months and days in its own sentences (lane W review nit).

`strftime("%b")` follows the process locale, so the names are spelled out once — and the
withholding card, the ESPP pace row and the taxes router all read them from here.
"""

from datetime import date

from app.services import assistant_evidence, day_labels, espp_pace, month_review, withholding_calc
from app.services.calendar.generators import ritual
from app.services.day_labels import (
    LONG_MONTH_NAMES,
    MONTH_NAMES,
    day_label,
    long_day,
    month_day,
    month_name,
    month_year,
)


def test_the_twelve_names_are_english_abbreviations_in_calendar_order():
    assert MONTH_NAMES == (
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec",
    )


def test_each_spelling():
    assert month_day(date(2026, 9, 1)) == "Sep 1"
    assert month_year(date(2025, 9, 1)) == "Sep 2025"
    assert long_day(date(2025, 8, 29)) == "Aug 29, 2025"
    assert long_day(date(2026, 12, 31)) == "Dec 31, 2026"


def test_day_label_names_a_year_only_outside_the_reference_one():
    assert day_label(date(2026, 10, 1)) == "Oct 1"
    assert day_label(date(2026, 10, 1), 2026) == "Oct 1"
    assert day_label(date(2025, 10, 1), 2026) == "Oct 1, 2025"


def test_month_reviews_day_label_is_a_wrapper_around_the_one_spelling(monkeypatch):
    # Lane K's name and signature keep working for their callers (lane T adds more) ...
    assert month_review.day_label(date(2026, 10, 1)) == "Oct 1"
    assert month_review.day_label(date(2026, 10, 1), date(2026, 1, 5)) == "Oct 1"
    assert month_review.day_label(date(2025, 10, 1), date(2026, 1, 5)) == "Oct 1, 2025"
    # ... and hold no spelling of their own (no strftime %b): they ask day_labels.
    monkeypatch.setattr(day_labels, "day_label", lambda day, reference_year=None: "asked")
    assert month_review.day_label(date(2025, 10, 1), date(2026, 1, 5)) == "asked"


def test_month_name_is_the_long_name_with_a_year_only_outside_the_reference_one():
    """Lane T's reminder and month story spoke `%B` or a private table (review minor 7): one
    English list here instead, whatever the process locale."""
    assert LONG_MONTH_NAMES[0] == "January" and LONG_MONTH_NAMES[8] == "September"
    assert len(LONG_MONTH_NAMES) == 12
    assert month_name(date(2026, 9, 1)) == "September"
    assert month_name(date(2026, 9, 1), 2026) == "September"
    assert month_name(date(2025, 9, 1), 2026) == "September 2025"


def test_no_module_keeps_a_copy_of_its_own():
    # The services that grew their own tables or spellings now read this module.
    assert not hasattr(withholding_calc, "MONTH_NAMES")
    assert not hasattr(espp_pace, "MONTH_NAMES")
    assert not hasattr(withholding_calc, "_day")
    assert not hasattr(ritual, "_MONTH_NAMES")
    assert not hasattr(ritual, "_month")
    # The month story reads its month's name here, not through the locale's %B.
    assert "%B" not in open(assistant_evidence.__file__, encoding="utf-8").read()
