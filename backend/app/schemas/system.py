"""System-status wire shapes (2026-08-25 spec §3). One rule shapes the nullables: the
GET never rejects what the database happens to hold — alembic_head is None on a
create_all-built schema (no alembic_version table), backup is None until backup_db.sh
records its first marker (or while the stored row is malformed)."""

from datetime import datetime

from pydantic import BaseModel

from app.schemas.portfolio import RefreshStatusOut


class PricesStatusOut(RefreshStatusOut):
    """The existing refresh-status shape — inherited, not restated, so the two endpoints
    cannot drift field-by-field — plus the live scheduler flag."""

    scheduler_running: bool


class DatabaseStatusOut(BaseModel):
    size_bytes: int
    # None when alembic_version is absent (every pytest run) or empty — the card renders
    # a dash, never a 500.
    alembic_head: str | None


class BackupStatusOut(BaseModel):
    last_success_at: datetime
    object_key: str
    # du -h's human string ("1.2M") exactly as the script recorded it — a label to echo
    # verbatim, not bytes to do math on (spec §3's example shape).
    size: str
    # 2026-09-03 data-lifecycle spec §8: the verify phase's fields. ALL optional so the
    # marker last night's script wrote still parses; None means "an older script wrote this".
    size_bytes: int | None = None
    encrypted: bool | None = None
    retention_days: int | None = None
    verified: bool | None = None
    verified_at: datetime | None = None
    row_counts: dict[str, int] | None = None
    verify_error: str | None = None


class BackupRunOut(BaseModel):
    """One backup_db.sh run from app_settings['backup_runs'] — a FLAT jsonb array (the
    shell writer's no-envelope rule, same as BackupStatusOut). `object` is absent on
    failed runs; `error` on successful ones; `verified` on runs before the verify phase."""

    at: datetime
    ok: bool
    object: str | None = None
    error: str | None = None
    verified: bool | None = None


class RefreshRunOut(BaseModel):
    """One refresh run from app_settings['refresh_runs'] — record_refresh_run's enveloped
    {"value": [...]} list (the Python writers' convention)."""

    at: datetime
    trigger: str
    updated: int
    failed_count: int


class SystemStatusOut(BaseModel):
    prices: PricesStatusOut
    database: DatabaseStatusOut
    backup: BackupStatusOut | None
    # Last-10 run trails (2026-08-31 spec §B3), newest first. Always lists, never null:
    # any malformed stored shape degrades to [] (the backup-marker posture, list-shaped).
    backup_runs: list[BackupRunOut]
    refresh_runs: list[RefreshRunOut]
    # settings.environment verbatim ("dev" | "prod" in practice) — a str, not a Literal:
    # an unexpected value must pass through the status endpoint, not 500 it.
    environment: str
