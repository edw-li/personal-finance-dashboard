"""Operational trails and per-user preferences (2026-09-03 data-lifecycle spec §6).

change_log is the application-level record of every money-bearing write (§9): one row per
changed database row, grouped by batch_id, with the export's own JSON spellings in `before`
and `after` so an undo can replay them through the same parser the restore uses. Summary
rows (op='batch') record an import, a restore or an undo as ONE line. lifecycle_runs is the
run trail (imports, restores, snapshots, restore points, undos) with the stored report.
user_preferences is one row per (user, key) with its own updated_at — the last-writer-wins
clock for two devices (§10). None of the three is exported: a restore must be RECORDED in
them, not replaced by them (services/snapshot.py's EXCLUDED_TABLES).
"""

import uuid
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import BigInteger, Date, DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

CHANGE_OPS = ("insert", "update", "delete", "batch")
CHANGE_SOURCES = ("ui", "import", "restore", "scheduler", "repair", "undo")
RUN_KINDS = ("import_xlsx", "restore", "snapshot", "restore_point", "undo")


def _now() -> datetime:
    return datetime.now(UTC)


class ChangeLog(Base):
    __tablename__ = "change_log"
    __table_args__ = (Index(None, "table_name", "at"),)  # -> ix_change_log_table_name_at

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    # Python default AND server default: ORM writers read the stamp back without a refresh
    # (expire_on_commit=False), raw SQL writers still get one.
    at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, server_default=func.now(), index=True
    )
    batch_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), index=True)
    source: Mapped[str] = mapped_column(String(12))  # one of CHANGE_SOURCES
    actor: Mapped[str | None] = mapped_column(String(255))
    label: Mapped[str] = mapped_column(Text)
    table_name: Mapped[str] = mapped_column(String(60))
    pk: Mapped[dict[str, Any]] = mapped_column(JSONB)
    op: Mapped[str] = mapped_column(String(6))  # one of CHANGE_OPS
    before: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    after: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    month: Mapped[date | None] = mapped_column(Date, index=True)


class LifecycleRun(Base):
    __tablename__ = "lifecycle_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, server_default=func.now(), index=True
    )
    kind: Mapped[str] = mapped_column(String(16))  # one of RUN_KINDS
    dry_run: Mapped[bool] = mapped_column(default=False)
    ok: Mapped[bool] = mapped_column(default=True)
    actor: Mapped[str | None] = mapped_column(String(255))
    filename: Mapped[str | None] = mapped_column(Text)
    size_bytes: Mapped[int | None] = mapped_column(BigInteger)
    report: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    error: Mapped[str | None] = mapped_column(Text)
    batch_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))


class UserPreference(Base):
    __tablename__ = "user_preferences"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    # Any JSON: 'dark', {"owner": "all", "range": "1y"}, ["nav:/", ...]. NOT NULL — a reset
    # DELETEs the row rather than storing a null (prefs router).
    value: Mapped[Any] = mapped_column(JSONB, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, server_default=func.now()
    )
