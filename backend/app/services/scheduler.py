"""APScheduler wiring (spec §5): price refresh on a cron read from app_settings,
America/Los_Angeles (the spec's '13:10 PT weekdays'). The job owns its DB session.

Started from the FastAPI lifespan when settings.scheduler_enabled — pytest's
ASGITransport never runs the lifespan (plan probe 7), so tests never start it. The
module keeps a handle on the running scheduler so the settings router can hot-apply a
saved cron and the status endpoint can name the next run; both degrade to no-op/None
when nothing is running."""

import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

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
JOB_ID = "price_refresh"
CATCHUP_JOB_ID = "price_refresh_catchup"
CATCHUP_DELAY_SECONDS = 10

# The running scheduler, if any — set by start_scheduler, read by the two accessors.
_scheduler: AsyncIOScheduler | None = None


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


def get_next_run_time() -> datetime | None:
    """When the scheduled refresh next fires — None when no scheduler is running (tests,
    SCHEDULER_ENABLED=0) or the job is somehow gone."""
    if _scheduler is None:
        return None
    job = _scheduler.get_job(JOB_ID)
    return job.next_run_time if job is not None else None


def reschedule_price_refresh(cron: str) -> bool:
    """Hot-apply a saved cron to the LIVE job (the settings router calls this after a
    PUT, closing the 'restart the backend to apply' friction). False means no scheduler
    is running — not the caller's problem, the boot path reads the stored value anyway."""
    if _scheduler is None:
        return False
    job = _scheduler.get_job(JOB_ID)
    if job is None:
        return False
    job.reschedule(trigger=build_trigger(cron))
    logger.info("price refresh rescheduled: %r (%s)", cron, SCHEDULER_TIMEZONE)
    return True


def missed_todays_run(trigger: CronTrigger, last_run_at: datetime | None, now: datetime) -> bool:
    """Whether today's scheduled fire already passed with no run recorded since — the
    in-memory job store forgets across restarts, so a boot that lands after the fire time
    would otherwise skip the whole day (the README 7.6 hazard). Judged from the trigger's
    own next-fire-after-midnight, so weekend/holiday-shaped crons answer False naturally.
    `now` must be timezone-aware (the scheduler's zone)."""
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    todays_fire = trigger.get_next_fire_time(None, midnight)
    if todays_fire is None or todays_fire > now:
        return False
    return last_run_at is None or last_run_at < todays_fire


async def _refresh_job(trigger_label: str = "scheduled") -> None:
    # Imports deferred: the job is the only scheduler code path that needs them, and
    # keeping them here keeps app import time (and pytest collection) lean.
    from app.database import SessionLocal
    from app.services.price_provider import YFinanceProvider
    from app.services.price_service import run_refresh

    provider = YFinanceProvider(settings.yfinance_ca_bundle)
    async with SessionLocal() as db:
        result, appended, dividends = await run_refresh(db, provider, trigger=trigger_label)
    logger.info(
        "%s price refresh: %d updated, %d failed, %d manual-skipped, history %s, %d dividends",
        trigger_label,
        len(result.updated),
        len(result.failed),
        len(result.skipped_manual),
        "appended" if appended else "unchanged",
        dividends.ingested,
    )


async def start_scheduler() -> AsyncIOScheduler:
    global _scheduler
    from app.database import SessionLocal
    from app.services.price_service import read_last_refresh

    async with SessionLocal() as db:
        cron = await read_cron_setting(db)
        last = await read_last_refresh(db)
    trigger = build_trigger(cron)
    scheduler = AsyncIOScheduler(timezone=SCHEDULER_TIMEZONE)
    scheduler.add_job(
        _refresh_job,
        trigger=trigger,
        id=JOB_ID,
        coalesce=True,
        max_instances=1,
        # In-memory job store: next_run_time is recomputed from *now* at every boot, so a
        # restart spanning the fire time forgets the day — the catch-up below is what
        # actually covers that; misfire_grace_time only covers an in-process busy loop.
        misfire_grace_time=3600,
    )
    # Catch up a fire this boot slept through (or a first boot that never ran): one
    # dated job a few seconds out, so boot itself never blocks on Yahoo.
    last_run_at: datetime | None = None
    if last is not None and isinstance(last.get("at"), str):
        try:
            last_run_at = datetime.fromisoformat(last["at"])
        except ValueError:
            last_run_at = None
    now = datetime.now(ZoneInfo(SCHEDULER_TIMEZONE))
    if missed_todays_run(trigger, last_run_at, now):
        scheduler.add_job(
            _refresh_job,
            trigger="date",
            run_date=now + timedelta(seconds=CATCHUP_DELAY_SECONDS),
            id=CATCHUP_JOB_ID,
            kwargs={"trigger_label": "scheduled (catch-up)"},
        )
        logger.info("catching up today's missed price refresh")
    scheduler.start()
    _scheduler = scheduler
    logger.info("price refresh scheduled: %r (%s)", cron, SCHEDULER_TIMEZONE)
    return scheduler
