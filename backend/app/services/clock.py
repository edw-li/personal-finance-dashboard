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

This module imports nothing from the app — it sits below everything, so any service or
router can read the clock without an import cycle.
"""

from datetime import date, datetime
from zoneinfo import ZoneInfo

# The one zone the product keeps time by. The scheduler fires in it too (`13:10 PT
# weekdays`): fire time and the run's idea of "today" must agree, or a Monday 18:00 PT
# refresh judged by date.today() would gate the weekly value snapshot into Tuesday and
# silently end the series (branch review F1).
PRODUCT_TIMEZONE = "America/Los_Angeles"


def product_now() -> datetime:
    """Now, as an aware datetime in the product zone."""
    return datetime.now(ZoneInfo(PRODUCT_TIMEZONE))


def product_today() -> date:
    """The calendar day in the product zone — the day the user is actually living in."""
    return product_now().date()
