"""System-status vertical (2026-08-25 spec §3): one JWT-protected GET feeding the
Settings System card and the Overview attention strip. It composes the prices
refresh-status (prices.compose_refresh_status — one source of truth), the scheduler's
live flag, database facts read with raw SQL, and the backup marker backup_db.sh
upserts. Every stored shape degrades to None rather than a 500."""

import asyncio

from fastapi import APIRouter, Depends, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.api.prices import compose_refresh_status
from app.config import settings
from app.database import get_db
from app.models import AppSetting, User
from app.rate_limit import AUTH_ATTEMPT, limiter
from app.schemas.lifecycle import SnapshotEntryOut
from app.schemas.system import (
    BackupRunOut,
    BackupStatusOut,
    DatabaseStatusOut,
    PricesStatusOut,
    RefreshRunOut,
    SystemStatusOut,
)
from app.services.price_service import REFRESH_RUNS_KEY
from app.services.scheduler import is_scheduler_running
from app.services.snapshot import alembic_head
from app.services.snapshot_store import list_snapshots, write_snapshot

router = APIRouter(prefix="/system", tags=["system"], dependencies=[Depends(get_current_user)])

BACKUP_STATUS_KEY = "backup_status"
BACKUP_RUNS_KEY = "backup_runs"
# Keep-10 agrees in THREE places: this reader, price_service.REFRESH_RUNS_KEEP, and the
# jsonpath literal '$[0 to 9]' inside backup_db.sh's upsert — bump all three together.
RUNS_LIMIT = 10


async def _read_backup_status(db: AsyncSession) -> BackupStatusOut | None:
    """app_settings['backup_status'] — written by backup_db.sh via psql as a FLAT object
    (no {"value": ...} envelope: that envelope is a Python readers' convention and the
    writer here is a shell script; spec §3 spells the flat shape). Absent or malformed
    reads as "no backup recorded" (read_last_refresh's posture)."""
    setting = await db.get(AppSetting, BACKUP_STATUS_KEY)
    if setting is None or not isinstance(setting.value, dict):
        return None
    try:
        return BackupStatusOut.model_validate(setting.value)
    except ValueError:
        return None


async def _read_backup_runs(db: AsyncSession) -> list[BackupRunOut]:
    """app_settings['backup_runs'] — backup_db.sh appends a FLAT jsonb array (newest
    first, trimmed to 10 by the script's own upsert). Whole-list degrade: any malformed
    shape — wrong container, one bad item — reads as no history, never a 500."""
    setting = await db.get(AppSetting, BACKUP_RUNS_KEY)
    if setting is None or not isinstance(setting.value, list):
        return []
    try:
        return [BackupRunOut.model_validate(item) for item in setting.value[:RUNS_LIMIT]]
    except ValueError:
        return []


async def _read_refresh_runs(db: AsyncSession) -> list[RefreshRunOut]:
    """app_settings['refresh_runs'] — record_refresh_run's enveloped {"value": [...]}
    (newest first, trimmed at write). Same whole-list degrade as the backup trail."""
    setting = await db.get(AppSetting, REFRESH_RUNS_KEY)
    if setting is None or not isinstance(setting.value, dict):
        return []
    raw = setting.value.get("value")
    if not isinstance(raw, list):
        return []
    try:
        return [RefreshRunOut.model_validate(item) for item in raw[:RUNS_LIMIT]]
    except ValueError:
        return []


@router.get("/status", response_model=SystemStatusOut)
async def system_status(db: AsyncSession = Depends(get_db)) -> SystemStatusOut:
    prices = await compose_refresh_status(db)
    size_bytes = (
        await db.execute(text("SELECT pg_database_size(current_database())"))
    ).scalar_one()
    # One probe, shared with the export/restore side (services.snapshot.alembic_head).
    head = await alembic_head(db)
    return SystemStatusOut(
        # model_dump-and-extend, not field-by-field: if RefreshStatusOut ever grows a
        # field, the embedded copy inherits it instead of silently dropping it.
        prices=PricesStatusOut(**prices.model_dump(), scheduler_running=is_scheduler_running()),
        database=DatabaseStatusOut(size_bytes=size_bytes, alembic_head=head),
        backup=await _read_backup_status(db),
        backup_runs=await _read_backup_runs(db),
        refresh_runs=await _read_refresh_runs(db),
        environment=settings.environment,
    )


@router.get("/snapshots", response_model=list[SnapshotEntryOut])
async def stored_snapshots(db: AsyncSession = Depends(get_db)) -> list[SnapshotEntryOut]:
    """The nightly files on the data volume, newest first (2026-09-03 data-lifecycle spec
    §8). `restorable` = the file's schema head equals this server's."""
    head = await alembic_head(db)
    return await asyncio.to_thread(list_snapshots, head)


@router.post("/snapshots", response_model=SnapshotEntryOut, status_code=201)
@limiter.limit(AUTH_ATTEMPT)
async def snapshot_now(
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SnapshotEntryOut:
    """ "Snapshot now" — the on-demand backup the tier-1 spec declined for want of pg_dump,
    delivered as the app's own ZIP. Rate-limited like login: a full ZIP is ~200 ms on the
    real database and nobody needs eleven a minute."""
    return await write_snapshot(db, actor=user.email, trigger="manual")
