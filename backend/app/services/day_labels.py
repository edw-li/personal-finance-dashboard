"""The server's one spelling of months and days in its own sentences.

Spelled out rather than through `strftime("%b")`, whose month names follow the process
locale: these strings land in wire payloads and notes that tests pin, and a server started
under another locale must not write "août" into them. One table for every module that
needs it (the withholding card, the ESPP pace row, the taxes router), where there used to
be a copy in each.
"""

from datetime import date

MONTH_NAMES = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def month_day(day: date) -> str:
    """'Sep 1'."""
    return f"{MONTH_NAMES[day.month - 1]} {day.day}"


def month_year(day: date) -> str:
    """'Sep 2025'."""
    return f"{MONTH_NAMES[day.month - 1]} {day.year}"


def long_day(day: date) -> str:
    """'Aug 29, 2025'."""
    return f"{month_day(day)}, {day.year}"
