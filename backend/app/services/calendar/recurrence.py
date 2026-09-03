"""rrule-lite for custom events (2026-09-03 calendar spec §2, §6): weekly / monthly /
yearly with an inclusive `until`, expanded server-side. Whole-series semantics only — no
exceptions, no BYDAY. Pure."""

import calendar as _calendar  # the stdlib module — this package is `app.services.calendar`
from datetime import date, timedelta

from app.models.calendar import RECURRENCES

from .model import Window


def _nth(rule: str, start: date, n: int) -> date:
    if rule == "weekly":
        return start + timedelta(days=7 * n)
    if rule == "monthly":
        serial = start.year * 12 + (start.month - 1) + n
        year, month = serial // 12, serial % 12 + 1
        # Clamp 29–31 to the month's last day; the original day returns when it fits.
        return date(year, month, min(start.day, _calendar.monthrange(year, month)[1]))
    if rule == "yearly":
        year = start.year + n
        return date(year, start.month, min(start.day, _calendar.monthrange(year, start.month)[1]))
    raise ValueError(f"unknown recurrence {rule!r}")


def expand(rule: str, start: date, until: date | None, window: Window) -> list[date]:
    """Every occurrence of the series inside `window`, ascending. `until` is inclusive; the
    window end stops an open series. `start` itself is the first occurrence."""
    if rule not in RECURRENCES:
        raise ValueError(f"unknown recurrence {rule!r}")
    if rule == "none":
        return [start] if window.contains(start) else []
    last = window.end if until is None else min(until, window.end)
    # Skip straight to the first candidate for a long-running weekly series; monthly and
    # yearly series are at most a few hundred steps even from decades back.
    n = max(0, (window.start - start).days // 7) if rule == "weekly" else 0
    out: list[date] = []
    while True:
        try:
            occurrence = _nth(rule, start, n)
        except (OverflowError, ValueError):
            # The step left `date`'s range (a window touching Dec 9999). There is nothing
            # beyond it to emit, and a stored row must never 500 a read — api/calendar.py's
            # GET-never-rejects law. `rule` was validated above, so this is the range only.
            return out
        if occurrence > last:
            return out
        if occurrence >= window.start:
            out.append(occurrence)
        n += 1
