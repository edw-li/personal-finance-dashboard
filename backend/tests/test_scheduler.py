from apscheduler.triggers.cron import CronTrigger

from app.models import AppSetting
from app.services.scheduler import (
    DEFAULT_PRICE_REFRESH_CRON,
    build_trigger,
    read_cron_setting,
)


def test_build_trigger_parses_valid_cron():
    trigger = build_trigger("10 13 * * 1-5")
    assert isinstance(trigger, CronTrigger)


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
