from datetime import date, datetime
from zoneinfo import ZoneInfo

from apscheduler.triggers.cron import CronTrigger

from app.models import AppSetting
from app.services.scheduler import (
    DEFAULT_PRICE_REFRESH_CRON,
    SCHEDULER_TIMEZONE,
    build_trigger,
    get_next_run_time,
    is_scheduler_running,
    missed_todays_run,
    product_today,
    read_cron_setting,
    reschedule_price_refresh,
)


def test_product_today_is_the_scheduler_zone_day(monkeypatch):
    # The review scenario verbatim: Monday 18:30 PT is already Tuesday 01:30 UTC — the
    # product day must still read Monday, or the weekly value snapshot gates itself off
    # under any post-close-evening cron.
    from datetime import UTC

    class _FixedDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 8, 18, 1, 30, tzinfo=UTC).astimezone(tz)

    monkeypatch.setattr("app.services.scheduler.datetime", _FixedDatetime)
    assert product_today() == date(2026, 8, 17)  # a Monday
    assert product_today().weekday() == 0


def test_build_trigger_parses_valid_cron():
    trigger = build_trigger("10 13 * * mon-fri")
    assert isinstance(trigger, CronTrigger)


def test_default_cron_fires_on_weekdays_not_tue_sat():
    # APScheduler's crontab numbering is 0=Mon: numeric "1-5" means Tue-Sat. The
    # default uses day NAMES so the spec's "weekdays" survives any numbering scheme.
    trigger = build_trigger(DEFAULT_PRICE_REFRESH_CRON)
    tz = ZoneInfo(SCHEDULER_TIMEZONE)
    monday_morning = datetime(2026, 8, 10, 9, 0, tzinfo=tz)
    next_fire = trigger.get_next_fire_time(None, monday_morning)
    assert next_fire is not None
    assert next_fire.weekday() == 0 and next_fire.date() == date(2026, 8, 10)
    saturday = datetime(2026, 8, 15, 9, 0, tzinfo=tz)
    assert trigger.get_next_fire_time(None, saturday).weekday() == 0  # skips the weekend


def test_build_trigger_falls_back_to_the_default_schedule():
    garbage = build_trigger("not a cron at all")
    default = build_trigger(DEFAULT_PRICE_REFRESH_CRON)
    anchor = datetime(2026, 8, 10, 9, 0, tzinfo=ZoneInfo(SCHEDULER_TIMEZONE))
    # Same resolved schedule, not merely "some CronTrigger" (Task 7 review I3).
    assert garbage.get_next_fire_time(None, anchor) == default.get_next_fire_time(None, anchor)


def test_missed_todays_run_judges_from_the_trigger_own_calendar():
    trigger = build_trigger(DEFAULT_PRICE_REFRESH_CRON)  # 13:10 PT, mon-fri
    tz = ZoneInfo(SCHEDULER_TIMEZONE)
    monday_evening = datetime(2026, 8, 10, 18, 0, tzinfo=tz)  # boot AFTER the fire
    monday_morning = datetime(2026, 8, 10, 9, 0, tzinfo=tz)  # boot BEFORE the fire
    saturday = datetime(2026, 8, 15, 18, 0, tzinfo=tz)  # no fire scheduled today

    # The restart-spanning-13:10 hazard (README 7.6): nothing ran today, fire is past.
    assert missed_todays_run(trigger, None, monday_evening) is True
    ran_at_1311 = datetime(2026, 8, 10, 13, 11, tzinfo=tz)
    assert missed_todays_run(trigger, ran_at_1311, monday_evening) is False
    # A run recorded YESTERDAY does not cover today's fire.
    ran_yesterday = datetime(2026, 8, 9, 13, 11, tzinfo=tz)
    assert missed_todays_run(trigger, ran_yesterday, monday_evening) is True
    # Before the fire time there is nothing to have missed yet…
    assert missed_todays_run(trigger, None, monday_morning) is False
    # …and a weekend has no fire at all — the trigger's own calendar answers, not ours.
    assert missed_todays_run(trigger, None, saturday) is False
    # UTC-stamped last runs (record_refresh_run stores UTC) compare correctly across
    # zones: 20:11 UTC IS 13:11 PDT.
    ran_utc = datetime(2026, 8, 10, 20, 11, tzinfo=ZoneInfo("UTC"))
    assert missed_todays_run(trigger, ran_utc, monday_evening) is False


def test_scheduler_accessors_degrade_when_nothing_is_running():
    # pytest never starts the scheduler (module docstring), so the module handle is None:
    # the status endpoint reads None and a settings save reschedules nothing — quietly.
    assert get_next_run_time() is None
    assert reschedule_price_refresh("0 6 * * mon") is False


async def test_read_cron_setting_envelope_and_fallbacks(db):
    assert await read_cron_setting(db) == DEFAULT_PRICE_REFRESH_CRON  # missing row
    db.add(AppSetting(key="price_refresh_cron", value={"value": "0 6 * * *"}))
    await db.commit()
    assert await read_cron_setting(db) == "0 6 * * *"
    setting = await db.get(AppSetting, "price_refresh_cron")
    setting.value = {"value": 123}  # envelope holds a non-string — fall back
    await db.commit()
    assert await read_cron_setting(db) == DEFAULT_PRICE_REFRESH_CRON
    setting.value = "10 13 * * mon-fri"  # bare scalar — envelope is convention-only
    await db.commit()
    assert await read_cron_setting(db) == DEFAULT_PRICE_REFRESH_CRON
    setting.value = {"value": "   "}  # whitespace-only cron
    await db.commit()
    assert await read_cron_setting(db) == DEFAULT_PRICE_REFRESH_CRON


def test_is_scheduler_running_tracks_the_module_handle(monkeypatch):
    # No handle at all — pytest never starts a scheduler (conftest pins the setting off).
    assert is_scheduler_running() is False

    class _Handle:
        def __init__(self, running: bool):
            self.running = running

    # The flag reads APScheduler's own .running, not the handle's mere presence: a
    # shut-down scheduler the module still holds must answer False, or the status card
    # would call a dead process "Running" for the rest of its life.
    monkeypatch.setattr("app.services.scheduler._scheduler", _Handle(True))
    assert is_scheduler_running() is True
    monkeypatch.setattr("app.services.scheduler._scheduler", _Handle(False))
    assert is_scheduler_running() is False
