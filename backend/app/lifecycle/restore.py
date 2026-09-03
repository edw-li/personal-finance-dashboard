"""Restore from the app's own export ZIP (2026-09-03 data-lifecycle spec §7).

Only finance-export.json is read (the CSVs are for humans); manifest.json supplies the
schema head and the app marker. Validation is ordered so the first refusal is the most
fundamental one: not a ZIP / not ours (400) → table set differs (422) → schema head differs
(409) → a column this server lacks (422). A model column the file lacks is a WARNING and
takes the column default. Every value parses through services.snapshot.parse_cell, the
inverse of the export's json_cell, so the two spellings cannot drift.

The apply is ONE transaction after the restore point: this server's five operational
app_settings rows are read, every exported table is TRUNCATEd, rows insert in FK order
with the accounts self-reference fixed up afterwards, sequences resume past max(id), the
preserved rows come back, and a summary change-log row plus a `restore` run record it.
Any exception rolls the transaction back; the restore point (its own committed run) stays.
"""

import io
import json
import zipfile
from dataclasses import dataclass
from datetime import datetime

from app.api.system import BACKUP_RUNS_KEY, BACKUP_STATUS_KEY
from app.schemas.lifecycle import RestoreSchema
from app.services.assistant_models import KEY_SETTING
from app.services.price_service import LAST_REFRESH_KEY, REFRESH_RUNS_KEY
from app.services.snapshot import EXPORTED_TABLES

NOT_A_SNAPSHOT = "Not a snapshot ZIP from this app"
APP_MARKER = "personal-finance-dashboard"

# The five app_settings rows that describe THIS server, never the snapshot's (spec §7 step
# 2): a snapshot never carries the assistant key (redacted), and the backup/refresh markers
# say what this box's cron and scheduler did.
RESTORE_PRESERVED_SETTINGS = frozenset(
    {KEY_SETTING, BACKUP_STATUS_KEY, BACKUP_RUNS_KEY, REFRESH_RUNS_KEY, LAST_REFRESH_KEY}
)

# Columns that point at the SAME table: inserted null, then one UPDATE per row that had a
# value — the export's row order is by primary key, which is not parent-first.
SELF_REFERENCES: dict[str, str] = {"accounts": "parent_account_id"}


class SnapshotError(Exception):
    """A refusal with the HTTP status the router should answer with."""

    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


@dataclass
class LoadedSnapshot:
    alembic_head: str | None
    exported_at: datetime | None
    environment: str | None
    # table -> rows in file order, values in finance-export.json's spellings
    tables: dict[str, list[dict[str, object]]]


def load_snapshot(data: bytes) -> LoadedSnapshot:
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise SnapshotError(400, NOT_A_SNAPSHOT) from None
    names = set(archive.namelist())
    if "manifest.json" not in names or "finance-export.json" not in names:
        raise SnapshotError(400, NOT_A_SNAPSHOT)
    try:
        manifest = json.loads(archive.read("manifest.json"))
        payload = json.loads(archive.read("finance-export.json"))
    except (ValueError, UnicodeDecodeError):
        raise SnapshotError(400, NOT_A_SNAPSHOT) from None
    if not isinstance(manifest, dict) or not isinstance(payload, dict):
        raise SnapshotError(400, NOT_A_SNAPSHOT)
    if manifest.get("app") != APP_MARKER:
        raise SnapshotError(400, NOT_A_SNAPSHOT)
    tables = payload.get("tables")
    if not isinstance(tables, dict) or not all(isinstance(rows, list) for rows in tables.values()):
        raise SnapshotError(400, NOT_A_SNAPSHOT)
    expected = {name for _, name in EXPORTED_TABLES}
    extra = sorted(set(tables) - expected)
    missing = sorted(expected - set(tables))
    if extra or missing:
        parts = []
        if extra:
            parts.append(f"extra table(s) {', '.join(extra)}")
        if missing:
            parts.append(f"missing table(s) {', '.join(missing)}")
        raise SnapshotError(422, f"Snapshot tables do not match this server: {'; '.join(parts)}")
    exported_at: datetime | None = None
    raw_at = payload.get("exported_at", manifest.get("exported_at"))
    if isinstance(raw_at, str):
        try:
            exported_at = datetime.fromisoformat(raw_at)
        except ValueError:
            exported_at = None
    head = manifest.get("alembic_head")
    environment = manifest.get("environment")
    return LoadedSnapshot(
        alembic_head=head if isinstance(head, str) else None,
        exported_at=exported_at,
        environment=environment if isinstance(environment, str) else None,
        tables=tables,
    )


def check_schema(snapshot: LoadedSnapshot, server_head: str | None) -> RestoreSchema:
    """Both None (a create_all schema on both sides) counts as equal."""
    if snapshot.alembic_head != server_head:
        theirs = snapshot.alembic_head or "none"
        ours = server_head or "none"
        raise SnapshotError(
            409,
            f"This snapshot was exported at schema `{theirs}`; this server runs `{ours}`. "
            f"Restore it on a server at `{theirs}`, or use the nightly database dump.",
        )
    return RestoreSchema(
        snapshot_head=snapshot.alembic_head, server_head=server_head, compatible=True
    )
