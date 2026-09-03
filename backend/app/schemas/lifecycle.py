"""Data-lifecycle wire shapes (2026-09-03 spec §7–§11), all in one module so the six lanes
import rather than define them. Conventions: every timestamp is timezone-aware, every id
that identifies a change batch is a UUID, and nothing here is nullable that the router can
always fill — the Optionals are the report's own "not applicable" states (a dry run has no
restore point, a stored run may have no report)."""

from datetime import date, datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

# ── Restore (§7) ──────────────────────────────────────────────────────────────────────


class RestoreSchema(BaseModel):
    snapshot_head: str | None
    server_head: str | None
    compatible: bool


class RestoreTableDiff(BaseModel):
    current: int
    incoming: int
    # Same canonical CSV sha256 for the live rows and the parsed incoming rows.
    identical: bool


class RestoreReport(BaseModel):
    # `schema` is a BaseModel attribute name, so the FIELD is schema_ and the WIRE is
    # `schema` — populate_by_name lets Python callers write schema=..., serialize_by_alias
    # makes model_dump agree with FastAPI's by_alias response path.
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    dry_run: bool
    applied: bool
    # The snapshot's own exported_at: the Restore card asks for this DATE to be typed.
    exported_at: datetime | None
    schema_: RestoreSchema = Field(alias="schema")
    tables: dict[str, RestoreTableDiff]
    preserved_settings: list[str]
    warnings: list[str]
    errors: list[str]
    restore_point: str | None
    batch_id: UUID | None
    run_id: int | None


# ── Stored snapshots (§8) ─────────────────────────────────────────────────────────────


class SnapshotEntryOut(BaseModel):
    name: str
    at: datetime
    size_bytes: int
    alembic_head: str | None
    # head equals the server's — the only snapshots the Restore card offers to apply.
    restorable: bool


# ── Activity (§9) ─────────────────────────────────────────────────────────────────────


class ActivityBatchOut(BaseModel):
    type: Literal["batch"] = "batch"
    batch_id: UUID
    at: datetime
    source: str
    actor: str | None
    label: str
    month: date | None
    # Row-level entries (op != 'batch'); 0 for a summary-only batch.
    rows: int
    # False for a summary batch, a batch already undone, one whose rows a later change
    # touched, and one an import or restore followed. NOT a guarantee: whether other rows
    # now DEPEND on the ones an undo would delete is a question about the current data that
    # only undo time can answer, so the POST may still refuse — the Activity card shows that
    # 409's sentence verbatim.
    undoable: bool
    undone_by: UUID | None


class ActivityRunOut(BaseModel):
    type: Literal["run"] = "run"
    run_id: int
    at: datetime
    kind: str
    ok: bool
    dry_run: bool
    filename: str | None
    size_bytes: int | None
    has_report: bool


class ActivityOut(BaseModel):
    entries: list[ActivityBatchOut | ActivityRunOut]
    # The `before` cursor for the next page, or None when this page ended the trail.
    next_before: datetime | None


class ActivityRunDetailOut(BaseModel):
    run: ActivityRunOut
    # The stored ImportReport / RestoreReport verbatim (the client narrows on run.kind).
    report: dict[str, Any] | None


# ── Preferences (§10) ─────────────────────────────────────────────────────────────────


class PrefEntryOut(BaseModel):
    value: Any
    updated_at: datetime


class PrefsOut(BaseModel):
    # Registered keys only, absent when unset.
    prefs: dict[str, PrefEntryOut]


# ── Health (§11) ──────────────────────────────────────────────────────────────────────

HealthSeverity = Literal["ok", "info", "warn", "error"]


class HealthFixOut(BaseModel):
    kind: Literal["link", "action"]
    label: str
    to: str | None = None
    # 'delete_spending_month' (per month in the check's `months`) | 'snapshot_now'.
    action: str | None = None


class HealthCheckOut(BaseModel):
    id: str
    severity: HealthSeverity
    title: str
    detail: str
    count: int = 0
    months: list[date] = Field(default_factory=list)
    fix: HealthFixOut | None = None


class HealthOut(BaseModel):
    checked_at: datetime
    checks: list[HealthCheckOut]
