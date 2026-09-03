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

import hashlib
import io
import json
import logging
import zipfile
from dataclasses import dataclass, field
from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import insert, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.system import BACKUP_RUNS_KEY, BACKUP_STATUS_KEY
from app.config import settings
from app.database import Base
from app.models import AppSetting, ChangeLog, LifecycleRun
from app.schemas.lifecycle import RestoreReport, RestoreSchema, RestoreTableDiff
from app.services.assistant_models import KEY_SETTING
from app.services.price_service import LAST_REFRESH_KEY, REFRESH_RUNS_KEY
from app.services.snapshot import (
    EXPORTED_TABLES,
    REDACTED_ROWS,
    csv_for_rows,
    parse_cell,
    row_dict,
    write_restore_point,
)

logger = logging.getLogger(__name__)

NOT_A_SNAPSHOT = "Not a snapshot ZIP from this app"
APP_MARKER = "personal-finance-dashboard"

# Per-member UNCOMPRESSED ceiling. Only manifest.json and finance-export.json are ever read,
# and a real book's JSON is a few MB; this is generous enough never to bite a genuine export
# while bounding the memory a crafted archive can demand.
MAX_MEMBER_BYTES = 64 * 1024 * 1024

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


def _too_big(name: str, size: int) -> SnapshotError:
    return SnapshotError(
        413,
        f"Snapshot member {name} is too large ({size} bytes uncompressed; "
        f"max {MAX_MEMBER_BYTES} bytes)",
    )


def _read_member(archive: zipfile.ZipFile, name: str) -> bytes:
    """One member, bounded. The 15 MB upload ceiling is COMPRESSED bytes, and deflate
    reaches ~1000:1 on padding, so a small upload can still ask for gigabytes of memory:
    read one byte past the cap and refuse if it arrives. The caller checked every declared
    file_size first (a clear refusal before decompressing); this catches a local header
    that lies about its size."""
    with archive.open(name) as handle:
        data = handle.read(MAX_MEMBER_BYTES + 1)
    if len(data) > MAX_MEMBER_BYTES:
        raise _too_big(name, len(data))
    return data


def load_snapshot(data: bytes) -> LoadedSnapshot:
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise SnapshotError(400, NOT_A_SNAPSHOT) from None
    names = set(archive.namelist())
    if "manifest.json" not in names or "finance-export.json" not in names:
        raise SnapshotError(400, NOT_A_SNAPSHOT)
    oversized = next(
        (info for info in archive.infolist() if info.file_size > MAX_MEMBER_BYTES), None
    )
    if oversized is not None:
        raise _too_big(oversized.filename, oversized.file_size)
    try:
        manifest = json.loads(_read_member(archive, "manifest.json"))
        payload = json.loads(_read_member(archive, "finance-export.json"))
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


@dataclass
class ParsedTables:
    # table -> parsed rows; EVERY model column present (absent ones as None) so the identity
    # hash and the live rows write the same columns
    rows: dict[str, list[dict[str, object]]]
    # table -> the model columns the file lacked; dropped at insert time so the column
    # DEFAULT applies (an explicit None would violate NOT NULL)
    absent: dict[str, list[str]] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)


def parse_tables(snapshot: LoadedSnapshot, *, user_id: int | None) -> ParsedTables:
    parsed = ParsedTables(rows={})
    for model, name in EXPORTED_TABLES:
        columns = list(model.__table__.columns)
        model_keys = [column.key for column in columns]
        rows = snapshot.tables[name]
        file_keys: set[str] = set().union(*(row.keys() for row in rows)) if rows else set()
        unknown = sorted(file_keys - set(model_keys))
        if unknown:
            raise SnapshotError(
                422, f"Snapshot column {name}.{unknown[0]} is unknown to this server"
            )
        absent = sorted(set(model_keys) - file_keys) if rows else []
        parsed.absent[name] = absent
        for column_key in absent:
            parsed.warnings.append(
                f"{name}.{column_key} is absent from the snapshot — the column default applies"
            )
        out: list[dict[str, object]] = []
        for row in rows:
            try:
                out.append(
                    {column.key: parse_cell(column, row.get(column.key)) for column in columns}
                )
            except ValueError as exc:
                raise SnapshotError(422, f"Snapshot value in {exc}") from None
        if name == "user_preferences":
            out = _rewrite_preferences(out, user_id, parsed.warnings)
        parsed.rows[name] = out
    if snapshot.environment is not None and snapshot.environment != settings.environment:
        parsed.warnings.append(
            f"Snapshot was exported from a '{snapshot.environment}' environment; "
            f"this server is '{settings.environment}'"
        )
    return parsed


def _rewrite_preferences(
    rows: list[dict[str, object]], user_id: int | None, warnings: list[str]
) -> list[dict[str, object]]:
    """user_preferences.user_id becomes the caller's (spec §7 step 4) — a snapshot from
    another account is this user's data now. One row per key; nothing without a user."""
    if not rows:
        return rows
    if user_id is None:
        warnings.append("user_preferences skipped — no user to attach them to")
        return []
    seen: set[object] = set()
    rewritten: list[dict[str, object]] = []
    for row in rows:
        if row["key"] in seen:
            continue
        seen.add(row["key"])
        rewritten.append({**row, "user_id": user_id})
    return rewritten


def _digest(columns, rows: list[dict[str, object]]) -> str:
    return hashlib.sha256(csv_for_rows(columns, rows).encode("utf-8")).hexdigest()


def _restorable_rows(name: str, rows: list[dict[str, object]]) -> list[dict[str, object]]:
    """The rows a restore actually writes. The preserved app_settings keys are NOT among
    them — step 6 puts this server's own back instead — so they are cut from BOTH sides of
    the digest and from the counts. Otherwise a snapshot carrying `backup_status` would
    report an app_settings difference that no restore can ever settle, and the drill's
    `verify` would fail on every real snapshot."""
    if name != "app_settings":
        return rows
    return [row for row in rows if row["key"] not in RESTORE_PRESERVED_SETTINGS]


async def _current_rows(db: AsyncSession, model: type, name: str) -> list[dict[str, object]]:
    """The live table as the export would write it — redactions included, so a snapshot
    (which never carries the key row) compares fairly."""
    rows = (
        (await db.execute(select(model).order_by(*model.__table__.primary_key.columns)))
        .scalars()
        .all()
    )
    redacted = REDACTED_ROWS.get(name)
    if redacted is not None:
        rows = [row for row in rows if row.key not in redacted]
    columns = list(model.__table__.columns)
    return _restorable_rows(name, [row_dict(row, columns) for row in rows])


async def diff_tables(db: AsyncSession, parsed: ParsedTables) -> dict[str, RestoreTableDiff]:
    diffs: dict[str, RestoreTableDiff] = {}
    for model, name in EXPORTED_TABLES:
        columns = list(model.__table__.columns)
        current = await _current_rows(db, model, name)
        incoming = _restorable_rows(name, parsed.rows[name])
        diffs[name] = RestoreTableDiff(
            current=len(current),
            incoming=len(incoming),
            identical=_digest(columns, current) == _digest(columns, incoming),
        )
    return diffs


async def _preserved_keys_present(db: AsyncSession) -> list[str]:
    return sorted(
        (
            await db.execute(
                select(AppSetting.key).where(AppSetting.key.in_(RESTORE_PRESERVED_SETTINGS))
            )
        ).scalars()
    )


async def plan_restore(
    db: AsyncSession,
    snapshot: LoadedSnapshot,
    *,
    user_id: int | None,
    server_head: str | None,
) -> RestoreReport:
    """The dry run (spec §7): counts and identity per table, warnings, nothing written."""
    schema = check_schema(snapshot, server_head)
    parsed = parse_tables(snapshot, user_id=user_id)
    return RestoreReport(
        dry_run=True,
        applied=False,
        exported_at=snapshot.exported_at,
        schema=schema,
        tables=await diff_tables(db, parsed),
        preserved_settings=await _preserved_keys_present(db),
        warnings=parsed.warnings,
        errors=[],
        restore_point=None,
        batch_id=None,
        run_id=None,
    )


def _exported_in_fk_order() -> list[tuple[type, str]]:
    """The exported tables in Base.metadata.sorted_tables order — people before accounts,
    snapshots before balances. The export's own order is not FK-safe."""
    by_name = {name: model for model, name in EXPORTED_TABLES}
    return [
        (by_name[table.name], table.name)
        for table in Base.metadata.sorted_tables
        if table.name in by_name
    ]


def _label_for(snapshot: LoadedSnapshot) -> str:
    if snapshot.exported_at is None:
        return "Restored snapshot"
    # The Activity card reads this label next to local-time stamps: a 5 p.m. Pacific export
    # is "Sep 2", not the UTC "Sep 3" its instant spells.
    at = snapshot.exported_at.astimezone()
    return f"Restored snapshot from {at:%b} {at.day}, {at.year}"  # no %-d: not portable


async def apply_restore(
    db: AsyncSession,
    snapshot: LoadedSnapshot,
    *,
    user_id: int | None,
    actor: str | None,
    server_head: str | None,
    source_name: str | None,
    size_bytes: int | None,
) -> RestoreReport:
    """The seven steps of spec §7, one transaction after the restore point. The caller
    rolls back on any exception (the router and the CLI both do); the restore point's run
    was committed on its own and stays listed."""
    schema = check_schema(snapshot, server_head)
    parsed = parse_tables(snapshot, user_id=user_id)
    # (1) The current database, kept: commits its own run; raising here means nothing below ran.
    point = await write_restore_point(db, actor=actor)
    # (2) This server's operational rows, read before the truncate.
    preserved_rows = [
        (setting.key, setting.value)
        for setting in (
            await db.execute(
                select(AppSetting).where(AppSetting.key.in_(RESTORE_PRESERVED_SETTINGS))
            )
        ).scalars()
    ]
    preserved_keys = sorted(key for key, _ in preserved_rows)
    tables = await diff_tables(db, parsed)  # what this restore changes, measured first
    # (3) One statement. CASCADE reaches nothing outside the set: the trails and users have
    # no FKs INTO the exported tables (user_preferences points the other way, at users).
    names = ", ".join(f'"{name}"' for _, name in EXPORTED_TABLES)
    await db.execute(text(f"TRUNCATE {names} RESTART IDENTITY CASCADE"))
    # Every instance the session loaded now describes a row that no longer exists.
    db.expunge_all()
    # (4) Insert in FK order; the self-reference goes in null and is fixed up after.
    for model, name in _exported_in_fk_order():
        table = model.__table__
        absent = set(parsed.absent.get(name, ()))
        rows = [
            {key: value for key, value in row.items() if key not in absent}
            for row in parsed.rows[name]
        ]
        rows = _restorable_rows(name, rows)
        deferred: list[tuple[object, object]] = []
        self_ref = SELF_REFERENCES.get(name)
        if self_ref is not None:
            fixed: list[dict[str, object]] = []
            for row in rows:
                if row.get(self_ref) is not None:
                    deferred.append((row["id"], row[self_ref]))
                    row = {**row, self_ref: None}
                fixed.append(row)
            rows = fixed
        if rows:
            await db.execute(insert(table), rows)
        for pk_value, ref in deferred:
            await db.execute(update(table).where(table.c.id == pk_value).values({self_ref: ref}))
    # (5) Sequences resume past the restored ids (RESTART IDENTITY reset them to 1).
    for model, name in EXPORTED_TABLES:
        table = model.__table__
        auto = table.autoincrement_column
        if auto is None:
            continue
        await db.execute(
            text(
                f"SELECT setval(pg_get_serial_sequence('{name}', '{auto.key}'), "
                f"COALESCE((SELECT MAX({auto.key}) FROM {name}), 0) + 1, false)"
            )
        )
    # (6) This server's rows come back.
    if preserved_rows:
        await db.execute(
            insert(AppSetting.__table__),
            [{"key": key, "value": value} for key, value in preserved_rows],
        )
    # (7) Record it — inside the same transaction, so a failed restore records nothing.
    counts = {name: diff.incoming for name, diff in tables.items()}
    batch_id: UUID = uuid4()
    db.add(
        ChangeLog(
            batch_id=batch_id,
            source="restore",
            actor=actor,
            label=_label_for(snapshot),
            table_name="*",
            pk={},
            op="batch",
            before=None,
            after={"tables": counts},
            month=None,
        )
    )
    run = LifecycleRun(
        kind="restore",
        dry_run=False,
        ok=True,
        actor=actor,
        filename=source_name,
        size_bytes=size_bytes,
        batch_id=batch_id,
    )
    db.add(run)
    await db.flush()
    report = RestoreReport(
        dry_run=False,
        applied=True,
        exported_at=snapshot.exported_at,
        schema=schema,
        tables=tables,
        preserved_settings=preserved_keys,
        warnings=parsed.warnings,
        errors=[],
        restore_point=point.name,
        batch_id=batch_id,
        run_id=run.id,
    )
    run.report = report.model_dump(mode="json")
    await db.commit()
    logger.info("restored snapshot %s: %s", source_name, counts)
    return report
