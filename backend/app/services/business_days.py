"""US bank-holiday calendar + business-day stepping (2026-08-24 calendar spec §4).

Pure module — no DB, no HTTP, no clock (rsu_vesting's posture). Owns the app's ONLY
holiday logic: the 11 Federal Reserve holidays with the Fed observation rule — a Sunday
holiday observes the following Monday; a Saturday holiday observes NOTHING (Reserve
Banks are open the preceding Friday, unlike the federal-workforce rule).

Known v1 approximations, accepted by the spec: employer payroll calendars differ from
Fed holidays, and DC Emancipation Day occasionally moves Tax Day. Both are ignored.
"""

import calendar
from datetime import date, timedelta

_MONDAY = 0
_THURSDAY = 3
_SATURDAY = 5
_SUNDAY = 6


def _nth_weekday(year: int, month: int, weekday: int, n: int) -> date:
    first_offset = (weekday - date(year, month, 1).weekday()) % 7
    return date(year, month, 1 + first_offset + 7 * (n - 1))


def _last_weekday(year: int, month: int, weekday: int) -> date:
    last = date(year, month, calendar.monthrange(year, month)[1])
    return last - timedelta(days=(last.weekday() - weekday) % 7)


def us_bank_holidays(year: int) -> set[date]:
    """The 11 Federal Reserve holidays as OBSERVED closure dates: a Sunday fixed-date
    holiday shifts to its Monday; a Saturday one stays put (already a non-business day,
    and the Fed observes nothing for it — keeping it in the set preserves the 11-entry
    invariant and is inert to stepping). Floating holidays land on weekdays by rule."""
    fixed = (
        date(year, 1, 1),  # New Year's Day
        date(year, 6, 19),  # Juneteenth
        date(year, 7, 4),  # Independence Day
        date(year, 11, 11),  # Veterans Day
        date(year, 12, 25),  # Christmas Day
    )
    observed = {day + timedelta(days=1) if day.weekday() == _SUNDAY else day for day in fixed}
    observed.update(
        (
            _nth_weekday(year, 1, _MONDAY, 3),  # Martin Luther King Jr. Day
            _nth_weekday(year, 2, _MONDAY, 3),  # Washington's Birthday
            _last_weekday(year, 5, _MONDAY),  # Memorial Day
            _nth_weekday(year, 9, _MONDAY, 1),  # Labor Day
            _nth_weekday(year, 10, _MONDAY, 2),  # Columbus Day
            _nth_weekday(year, 11, _THURSDAY, 4),  # Thanksgiving Day
        )
    )
    return observed


def _is_business_day(day: date) -> bool:
    return day.weekday() < _SATURDAY and day not in us_bank_holidays(day.year)


def previous_business_day(day: date) -> date:
    """`day` itself when it qualifies; else step backward over weekends + holidays.
    Recomputing the year's set per step is eleven date constructions — trivial, and it
    makes year-boundary crossings (a Jan 1 step-back) automatically correct."""
    while not _is_business_day(day):
        day -= timedelta(days=1)
    return day


def next_business_day(day: date) -> date:
    """`day` itself when it qualifies; else step forward over weekends + holidays."""
    while not _is_business_day(day):
        day += timedelta(days=1)
    return day
