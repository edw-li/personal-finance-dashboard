"""The server's one spelling of months and days in its own sentences.

Spelled out rather than through `strftime("%b")`, whose month names follow the process
locale: these strings land in wire payloads and notes that tests pin, and a server started
under another locale must not write "août" into them. One implementation for every module
that needs it — the withholding card, the ESPP pace row, the taxes router, and month
review's `day_label` (lane K's name, kept as a thin wrapper around `day_label` here) — where
there used to be a copy in each.
"""

from datetime import date

MONTH_NAMES = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
LONG_MONTH_NAMES = (
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
)


def month_day(day: date) -> str:
    """'Sep 1'."""
    return f"{MONTH_NAMES[day.month - 1]} {day.day}"


def month_year(day: date) -> str:
    """'Sep 2025'."""
    return f"{MONTH_NAMES[day.month - 1]} {day.year}"


def long_day(day: date) -> str:
    """'Aug 29, 2025'."""
    return f"{month_day(day)}, {day.year}"


def day_label(day: date, reference_year: int | None = None) -> str:
    """'Oct 1' — with ', 2025' when `reference_year` is given and the day's year differs: a
    sentence about this year's day needs no year, one about another year's must name it."""
    return month_day(day) if reference_year is None or day.year == reference_year else long_day(day)


def month_name(day: date, reference_year: int | None = None) -> str:
    """'September' — with ' 2025' when `reference_year` is given and the day's year differs (the
    monthly reminder's and the month story's words; lane T review minor 7)."""
    name = LONG_MONTH_NAMES[day.month - 1]
    return name if reference_year is None or day.year == reference_year else f"{name} {day.year}"
