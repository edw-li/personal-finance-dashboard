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


class SystemStatusOut(BaseModel):
    prices: PricesStatusOut
    database: DatabaseStatusOut
    backup: BackupStatusOut | None
    # settings.environment verbatim ("dev" | "prod" in practice) — a str, not a Literal:
    # an unexpected value must pass through the status endpoint, not 500 it.
    environment: str
