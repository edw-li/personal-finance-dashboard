"""APScheduler wiring (spec §5): price refresh on a cron read from app_settings,
America/Los_Angeles (the spec's '13:10 PT weekdays'). The job owns its DB session.

Started from the FastAPI lifespan when settings.scheduler_enabled — pytest's
ASGITransport never runs the lifespan (plan probe 7), so tests never start it."""

import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import AppSetting

logger = logging.getLogger(__name__)

# Day NAMES, never numbers: APScheduler's from_crontab numbers days 0=Mon (not UNIX
# 0=Sun), so numeric "1-5" silently means Tue-Sat (Task 7 escalation, measured).
DEFAULT_PRICE_REFRESH_CRON = "10 13 * * mon-fri"
SCHEDULER_TIMEZONE = "America/Los_Angeles"


async def read_cron_setting(db: AsyncSession) -> str:
    """app_settings['price_refresh_cron'] envelope {"value": "..."} — envelope is
    convention-only (Plan 1 note), so any unexpected shape falls back to the default."""
    setting = await db.get(AppSetting, "price_refresh_cron")
    if setting is None or not isinstance(setting.value, dict):
        return DEFAULT_PRICE_REFRESH_CRON
    raw = setting.value.get("value")
    return raw if isinstance(raw, str) and raw.strip() else DEFAULT_PRICE_REFRESH_CRON


def build_trigger(cron: str) -> CronTrigger:
    try:
        return CronTrigger.from_crontab(cron, timezone=SCHEDULER_TIMEZONE)
    except ValueError:
        logger.warning("invalid price_refresh_cron %r — using default", cron)
        return CronTrigger.from_crontab(DEFAULT_PRICE_REFRESH_CRON, timezone=SCHEDULER_TIMEZONE)


async def _refresh_job() -> None:
    # Imports deferred: the job is the only scheduler code path that needs them, and
    # keeping them here keeps app import time (and pytest collection) lean.
    from app.database import SessionLocal
    from app.services.price_provider import YFinanceProvider
    from app.services.price_service import refresh_prices

    provider = YFinanceProvider(settings.yfinance_ca_bundle)
    async with SessionLocal() as db:
        result = await refresh_prices(db, provider)
    logger.info(
        "scheduled price refresh: %d updated, %d failed, %d manual-skipped",
        len(result.updated),
        len(result.failed),
        len(result.skipped_manual),
    )


async def start_scheduler() -> AsyncIOScheduler:
    from app.database import SessionLocal

    async with SessionLocal() as db:
        cron = await read_cron_setting(db)
    scheduler = AsyncIOScheduler(timezone=SCHEDULER_TIMEZONE)
    scheduler.add_job(
        _refresh_job,
        trigger=build_trigger(cron),
        id="price_refresh",
        coalesce=True,
        max_instances=1,
        # NOTE: with the in-memory job store, next_run_time is recomputed from *now*
        # at every boot — a restart spanning 13:10 skips that day's refresh entirely;
        # misfire_grace_time only covers a busy loop within one process (Task 7 review).
        misfire_grace_time=3600,
    )
    scheduler.start()
    logger.info("price refresh scheduled: %r (%s)", cron, SCHEDULER_TIMEZONE)
    return scheduler
