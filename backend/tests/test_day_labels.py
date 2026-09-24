"""The server's one spelling of months and days in its own sentences (lane W review nit).

`strftime("%b")` follows the process locale, so the names are spelled out once — and the
withholding card, the ESPP pace row and the taxes router all read them from here.
"""

from datetime import date

from app.services import espp_pace, withholding_calc
from app.services.day_labels import MONTH_NAMES, long_day, month_day, month_year


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


def test_no_module_keeps_a_copy_of_its_own():
    # The two services that grew their own tables now read this one.
    assert not hasattr(withholding_calc, "MONTH_NAMES")
    assert not hasattr(espp_pace, "MONTH_NAMES")
