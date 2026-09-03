"""APScheduler wiring (spec §5): price refresh on a cron read from app_settings,
America/Los_Angeles (the spec's '13:10 PT weekdays'). The job owns its DB session.

Started from the FastAPI lifespan when settings.scheduler_enabled — pytest's
ASGITransport never runs the lifespan (plan probe 7), so tests never start it. The
module keeps a handle on the running scheduler so the settings router can hot-apply a
saved cron and the status endpoints can name the next run and report whether it is
running; all degrade to no-op/None/False when nothing is running."""

import logging
from datetime import UTC, date, datetime, timedelta
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

# Nightly logical snapshot (2026-09-03 data-lifecycle spec §8): every day, weekends
# included — the export is about the database, not the market.
SNAPSHOT_CRON = "30 23 * * *"
SNAPSHOT_JOB_ID = "snapshot_nightly"
SNAPSHOT_CATCHUP_JOB_ID = "snapshot_nightly_catchup"

# The running scheduler, if any — set by start_scheduler, read by the accessors below.
_scheduler: AsyncIOScheduler | None = None


def product_today() -> date:
    """The calendar day in the scheduler's zone — the ONE clock the refresh ritual keeps
    time by. The prod container runs UTC, where every evening from 16:00/17:00 PT is
    already tomorrow: a Monday 18:00 PT refresh judged by date.today() would gate the
    weekly value snapshot into Tuesday and silently end the series (branch review F1).
    Fire time (APScheduler, this zone) and the run's idea of "today" must agree."""
    return datetime.now(ZoneInfo(SCHEDULER_TIMEZONE)).date()


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


def build_snapshot_trigger() -> CronTrigger:
    return CronTrigger.from_crontab(SNAPSHOT_CRON, timezone=SCHEDULER_TIMEZONE)


def get_next_run_time() -> datetime | None:
    """When the scheduled refresh next fires — None when no scheduler is running (tests,
    SCHEDULER_ENABLED=0) or the job is somehow gone."""
    if _scheduler is None:
        return None
    job = _scheduler.get_job(JOB_ID)
    return job.next_run_time if job is not None else None


def is_scheduler_running() -> bool:
    """Whether the in-process scheduler is up — the system-status endpoint's flag
    (2026-08-25 spec §3). False when no handle exists (tests, SCHEDULER_ENABLED=0)
    AND when a held handle has been shut down: APScheduler's own .running is the
    judge, not the handle's presence."""
    return _scheduler is not None and bool(_scheduler.running)


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


async def _snapshot_job(trigger_label: str = "scheduled") -> None:
    # Deferred imports, like _refresh_job: keep app import time (and pytest collection) lean.
    from app.database import SessionLocal
    from app.services.snapshot_store import run_snapshot_job

    async with SessionLocal() as db:
        await run_snapshot_job(db, now=datetime.now(UTC), trigger=trigger_label)


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
    if settings.snapshot_enabled:
        from app.services.snapshot_store import latest_snapshot_run_at

        async with SessionLocal() as db:
            last_snapshot_at = await latest_snapshot_run_at(db)
        snapshot_trigger = build_snapshot_trigger()
        scheduler.add_job(
            _snapshot_job,
            trigger=snapshot_trigger,
            id=SNAPSHOT_JOB_ID,
            coalesce=True,
            max_instances=1,
            misfire_grace_time=3600,
        )
        # The same catch-up as the price refresh, keyed on the newest SUCCESSFUL snapshot
        # run: a boot after 23:30 with nothing written today snapshots a few seconds in.
        if missed_todays_run(snapshot_trigger, last_snapshot_at, now):
            scheduler.add_job(
                _snapshot_job,
                trigger="date",
                run_date=now + timedelta(seconds=CATCHUP_DELAY_SECONDS),
                id=SNAPSHOT_CATCHUP_JOB_ID,
                kwargs={"trigger_label": "scheduled (catch-up)"},
            )
            logger.info("catching up today's missed snapshot")
        logger.info("nightly snapshot scheduled: %r (%s)", SNAPSHOT_CRON, SCHEDULER_TIMEZONE)
    scheduler.start()
    _scheduler = scheduler
    logger.info("price refresh scheduled: %r (%s)", cron, SCHEDULER_TIMEZONE)
    return scheduler
