"""System-status vertical (2026-08-25 spec §3): one JWT-protected GET feeding the
Settings System card and the Overview attention strip. It composes the prices
refresh-status (prices.compose_refresh_status — one source of truth), the scheduler's
live flag, database facts read with raw SQL, and the backup marker backup_db.sh
upserts. Every stored shape degrades to None rather than a 500."""

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.api.prices import compose_refresh_status
from app.config import settings
from app.database import get_db
from app.models import AppSetting
from app.schemas.system import (
    BackupStatusOut,
    DatabaseStatusOut,
    PricesStatusOut,
    SystemStatusOut,
)
from app.services.scheduler import is_scheduler_running

router = APIRouter(prefix="/system", tags=["system"], dependencies=[Depends(get_current_user)])

BACKUP_STATUS_KEY = "backup_status"


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


@router.get("/status", response_model=SystemStatusOut)
async def system_status(db: AsyncSession = Depends(get_db)) -> SystemStatusOut:
    prices = await compose_refresh_status(db)
    size_bytes = (
        await db.execute(text("SELECT pg_database_size(current_database())"))
    ).scalar_one()
    # to_regclass probe, not try/except: a missing alembic_version is an EXPECTED state
    # (create_all-built databases — every test run), and a failed SELECT would abort the
    # session's transaction mid-request, poisoning the reads after it.
    has_alembic = (
        await db.execute(text("SELECT to_regclass('alembic_version') IS NOT NULL"))
    ).scalar_one()
    alembic_head: str | None = None
    if has_alembic:
        head_row = await db.execute(text("SELECT version_num FROM alembic_version"))
        alembic_head = head_row.scalars().first()
    return SystemStatusOut(
        # model_dump-and-extend, not field-by-field: if RefreshStatusOut ever grows a
        # field, the embedded copy inherits it instead of silently dropping it.
        prices=PricesStatusOut(**prices.model_dump(), scheduler_running=is_scheduler_running()),
        database=DatabaseStatusOut(size_bytes=size_bytes, alembic_head=alembic_head),
        backup=await _read_backup_status(db),
        environment=settings.environment,
    )
