"""The ONE product clock (audit item 31): every "today" the API and the services read is
the Pacific calendar day, never the container's UTC day.

The instants below are the two the bug actually bit on: a PT evening (already tomorrow in
UTC) and 31 December late PT (already NEXT YEAR in UTC, where the paycheck pace would be
judged against next year's contribution limits while the calendar still said this year).
"""

from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

from app.services import clock, scheduler


def _pin(monkeypatch, instant: datetime) -> None:
    """Pin the clock module's `datetime` — the one symbol product_today/product_now read."""

    class _FixedDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return instant.astimezone(tz)

    monkeypatch.setattr("app.services.clock.datetime", _FixedDatetime)


def test_product_today_is_the_pacific_day_on_a_pt_evening(monkeypatch):
    # 18:30 PT Monday is already 01:30 UTC Tuesday: the product day must still read Monday.
    _pin(monkeypatch, datetime(2026, 8, 18, 1, 30, tzinfo=UTC))
    assert clock.product_today() == date(2026, 8, 17)
    assert clock.product_today().weekday() == 0  # a Monday


def test_product_today_keeps_the_year_on_a_late_new_years_eve(monkeypatch):
    # 22:00 PT on 31 Dec 2026 is 06:00 UTC on 1 Jan 2027. The year decides which
    # contribution limits and which tax year the app measures against.
    _pin(monkeypatch, datetime(2027, 1, 1, 6, 0, tzinfo=UTC))
    assert clock.product_today() == date(2026, 12, 31)
    assert clock.product_today().year == 2026


def test_product_now_is_aware_and_in_the_product_zone(monkeypatch):
    _pin(monkeypatch, datetime(2026, 8, 18, 1, 30, tzinfo=UTC))
    now = clock.product_now()
    assert now.utcoffset() is not None
    assert now.date() == clock.product_today()
    assert now == datetime(2026, 8, 17, 18, 30, tzinfo=ZoneInfo(clock.PRODUCT_TIMEZONE))


def test_unpinned_clock_agrees_with_the_zone_by_construction():
    # No pin: the real clock must still be the zone's day, not the process's local day.
    assert clock.product_today() == datetime.now(ZoneInfo(clock.PRODUCT_TIMEZONE)).date()


def test_scheduler_re_exports_the_same_clock():
    # Existing imports (`from app.services.scheduler import product_today`) keep working,
    # and the scheduler's fire zone is the product zone — one clock, not two.
    assert scheduler.product_today is clock.product_today
    assert scheduler.SCHEDULER_TIMEZONE == clock.PRODUCT_TIMEZONE
