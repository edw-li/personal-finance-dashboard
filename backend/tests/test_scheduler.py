from datetime import date, datetime
from zoneinfo import ZoneInfo

from apscheduler.triggers.cron import CronTrigger

from app.models import AppSetting
from app.services.scheduler import (
    DEFAULT_PRICE_REFRESH_CRON,
    SCHEDULER_TIMEZONE,
    build_trigger,
    read_cron_setting,
)


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


def test_build_trigger_falls_back_on_garbage():
    trigger = build_trigger("not a cron at all")
    assert isinstance(trigger, CronTrigger)  # falls back to the default, never raises


async def test_read_cron_setting_envelope_and_fallbacks(db):
    assert await read_cron_setting(db) == DEFAULT_PRICE_REFRESH_CRON  # missing row
    db.add(AppSetting(key="price_refresh_cron", value={"value": "0 6 * * *"}))
    await db.commit()
    assert await read_cron_setting(db) == "0 6 * * *"
    setting = await db.get(AppSetting, "price_refresh_cron")
    setting.value = {"value": 123}  # envelope holds a non-string — fall back
    await db.commit()
    assert await read_cron_setting(db) == DEFAULT_PRICE_REFRESH_CRON
