"""The product clock: ONE answer to "what day is it", for the whole backend.

The prod container runs UTC, where every evening from 16:00/17:00 PT onward is already
tomorrow — and every 31 December evening is already next YEAR. A `date.today()` read
there is not the day the user is looking at, so two call sites reading two clocks make
the app disagree with itself: the paycheck pace judged against next year's contribution
limits while the calendar still shows this year, an ESPP qualifying countdown a day
ahead of the lot table, the assistant told a different "today" than the page it is
describing (audit item 31).

So: every "the user's calendar day" read in the API and the services goes through
`product_today()` here. Call it as `clock.product_today()` (import the MODULE, not the
name) — one patchable symbol, `app.services.clock.product_today`, for the tests.

Deliberately NOT here: instants written to storage (`datetime.now(UTC)` for created_at,
quoted_at, done_at, token stamps) and the stale-quote comparison in health_checks, which
is UTC on purpose so it matches the frontend's own UTC staleness math.

**The dev override (2026-09-23 spec §K1).** `PRODUCT_TODAY=2026-10-01 uvicorn …` makes
`product_today()` answer that day, so the real-data copy can be run "as of Oct 1" — and the
browser follows it, because every /api response names the day (`X-Product-Today`, main.py). It
is read from the PROCESS environment only (`os.environ`; a line in backend/.env reaches neither
this module nor the settings validator — Settings declares no field for it), and only while the
process environment's ENVIRONMENT is unset or `dev`; config.Settings refuses to start a non-dev
process that carries it. `product_now()` stays real: instants are never moved.

This module imports nothing from the app — it sits below everything, so any service or
router can read the clock without an import cycle.
"""

import os
from datetime import date, datetime
from zoneinfo import ZoneInfo

# The one zone the product keeps time by. The scheduler fires in it too (`13:10 PT
# weekdays`): fire time and the run's idea of "today" must agree, or a Monday 18:00 PT
# refresh judged by date.today() would gate the weekly value snapshot into Tuesday and
# silently end the series (branch review F1).
PRODUCT_TIMEZONE = "America/Los_Angeles"
# The dev-only override's variable (spec §K1); config.Settings refuses it outside dev.
PRODUCT_TODAY_ENV = "PRODUCT_TODAY"


def product_today_override() -> date | None:
    """The PRODUCT_TODAY day in force, or None: set in the process environment (blank counts
    as unset) while the process environment's ENVIRONMENT is unset or `dev`. A malformed value
    raises — a developer who asked for Oct 1 must never silently get the real day (the settings
    validator refuses one at startup first)."""
    raw = os.environ.get(PRODUCT_TODAY_ENV, "").strip()
    if not raw or os.environ.get("ENVIRONMENT", "dev") != "dev":
        return None
    return date.fromisoformat(raw)


def product_now() -> datetime:
    """Now, as an aware datetime in the product zone — always the REAL instant."""
    return datetime.now(ZoneInfo(PRODUCT_TIMEZONE))


def product_today() -> date:
    """The calendar day in the product zone — the day the user is actually living in, or the
    dev override's day."""
    override = product_today_override()
    return override if override is not None else product_now().date()
