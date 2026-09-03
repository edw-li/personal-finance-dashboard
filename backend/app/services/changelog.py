"""Application-level change capture and undo (2026-09-03 data-lifecycle spec §9).

A ChangeBatch is request-scoped (Depends(change_batch)): the router records row images
around each write it makes, sets a label, and calls `await batch.commit()` IN PLACE OF
`await db.commit()` — the change-log rows land in the same transaction as the writes they
describe. Images are the export's own JSON spellings (services.snapshot.json_row), so an
undo replays them through parse_cell exactly as a restore would.

Triggers were considered — they catch every writer including psql — and rejected: the test
schema is create_all, not Alembic, so trigger DDL would need a metadata hook to exist in
tests, and a trigger cannot know the label or the month. An explicit service on an
explicit list (pinned by test_changelog_pin) is the testable choice for a single-user app.

Undo (undo_batch) replays a batch's inverses in reverse order in one transaction and is
itself a batch (source='undo') plus an `undo` run whose report links `undid`, which is how
"already undone" and the listing's `undone_by` are answered.
"""

import json
import logging
from datetime import UTC, date, datetime
from uuid import UUID, uuid4

from fastapi import Depends, Request
from sqlalchemy import and_, delete, insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import Base, get_db
from app.models import ChangeLog, LifecycleRun, User
from app.services.snapshot import json_cell, json_row, parse_cell

logger = logging.getLogger(__name__)

CHANGE_BATCH_HEADER = "X-Change-Batch"
CHANGE_SOURCE_HEADER = "X-Change-Source"
# What a client may CLAIM as the source: the health card's repair delete says `repair`;
# anything else — including nothing — is `ui`.
HEADER_SOURCES = frozenset({"ui", "repair"})
# What undo accepts: row-level batches from the UI, a repair, or an earlier undo. Summary
# batches (import, restore) and derived writes (scheduler) refuse with SUMMARY_REFUSAL.
UNDOABLE_SOURCES = frozenset({"ui", "repair", "undo"})

SUMMARY_REFUSAL = "This change is a summary and cannot be undone — restore a snapshot instead"
OVERLAP_REFUSAL = "Later changes touched these rows — undo those first"
ALREADY_UNDONE = "This change was already undone"


def pk_of(obj: object) -> dict[str, object]:
    return {
        column.key: json_cell(getattr(obj, column.key))
        for column in obj.__table__.primary_key.columns
    }


def row_image(obj: object) -> dict[str, object]:
    """The export's JSON spelling of one ORM row (json_row) — before/after images."""
    return json_row(obj)


def batch_header(batch_id: UUID | None) -> dict[str, str]:
    """Headers for a 204 that wrote a batch — the two month DELETEs. Empty when nothing
    changed, so the client reads `null` and offers no Undo."""
    return {} if batch_id is None else {CHANGE_BATCH_HEADER: str(batch_id)}


class ChangeBatch:
    def __init__(self, db: AsyncSession, *, source: str = "ui", actor: str | None = None) -> None:
        self.db = db
        self.id: UUID = uuid4()
        self.source = source
        self.actor = actor
        self.label = ""
        # Default month for rows recorded without one (the month PUT/DELETE set it once).
        self.month: date | None = None
        self._rows: list[ChangeLog] = []

    @property
    def rows(self) -> int:
        return len(self._rows)

    def record(
        self,
        table_name: str,
        pk: dict[str, object],
        before: dict[str, object] | None,
        after: dict[str, object] | None,
        *,
        month: date | None = None,
    ) -> None:
        """One changed row. An unchanged image pair records nothing — an all-unchanged PUT
        is not a change, and a batch with no rows commits no log."""
        if before == after:
            return
        op = "insert" if before is None else "delete" if after is None else "update"
        self._rows.append(
            ChangeLog(
                batch_id=self.id,
                source=self.source,
                actor=self.actor,
                label="",
                table_name=table_name,
                pk=pk,
                op=op,
                before=before,
                after=after,
                month=month,
            )
        )

    def record_insert(self, obj: object, *, month: date | None = None) -> None:
        """Call AFTER a flush — the image needs the generated id."""
        self.record(obj.__tablename__, pk_of(obj), None, row_image(obj), month=month)

    def record_update(
        self, obj: object, before: dict[str, object], *, month: date | None = None
    ) -> None:
        """`before` is row_image(obj) taken BEFORE the mutation."""
        self.record(obj.__tablename__, pk_of(obj), before, row_image(obj), month=month)

    def record_delete(self, obj: object, *, month: date | None = None) -> None:
        """Call BEFORE db.delete — the image needs the row."""
        self.record(obj.__tablename__, pk_of(obj), row_image(obj), None, month=month)

    async def commit(self) -> UUID | None:
        """Add the recorded rows with the final label and ONE stamp, then commit the
        session — the single commit a logged route makes. Returns the batch id, or None
        when nothing was recorded (the client then offers no Undo)."""
        if self._rows:
            stamp = datetime.now(UTC)
            for row in self._rows:
                row.label = self.label
                row.at = stamp
                if row.month is None:
                    row.month = self.month
            self.db.add_all(self._rows)
        await self.db.commit()
        return self.id if self._rows else None


async def change_batch(
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ChangeBatch:
    """The request's batch. FastAPI caches get_current_user per request, so the router-level
    auth dependency and this one share a single lookup."""
    claimed = request.headers.get(CHANGE_SOURCE_HEADER, "ui").strip().lower()
    return ChangeBatch(db, source=claimed if claimed in HEADER_SOURCES else "ui", actor=user.email)


class UndoRefused(Exception):
    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


def _pk_key(table_name: str, pk: dict[str, object]) -> tuple[str, str]:
    return table_name, json.dumps(pk, sort_keys=True, separators=(",", ":"))


async def undone_by(db: AsyncSession, batch_ids: list[UUID]) -> dict[UUID, UUID]:
    """batch -> the undo batch that reversed it, read from the `undo` runs' reports."""
    if not batch_ids:
        return {}
    wanted = {str(batch_id): batch_id for batch_id in batch_ids}
    rows = (
        await db.execute(
            select(LifecycleRun.report, LifecycleRun.batch_id).where(
                LifecycleRun.kind == "undo", LifecycleRun.ok.is_(True)
            )
        )
    ).all()
    out: dict[UUID, UUID] = {}
    for report, undo_batch in rows:
        undid = (report or {}).get("undid")
        if isinstance(undid, str) and undid in wanted and undo_batch is not None:
            out[wanted[undid]] = undo_batch
    return out


async def undo_batch(db: AsyncSession, batch_id: UUID, *, actor: str | None) -> UUID:
    """Replay a batch's inverses in reverse order, in one transaction (spec §9): insert →
    delete, update → set `before`, delete → insert `before`. Refuses (409) a summary-only
    or non-undoable-source batch, an already-undone batch, and a batch whose rows a later
    batch touched. Records the replay as a new source='undo' batch plus an `undo` run.
    Expunges the session afterwards: Core statements bypass the identity map."""
    rows = list(
        (
            await db.execute(
                select(ChangeLog).where(ChangeLog.batch_id == batch_id).order_by(ChangeLog.id)
            )
        )
        .scalars()
        .all()
    )
    if not rows:
        raise UndoRefused(404, "No such change")
    row_level = [row for row in rows if row.op != "batch"]
    if rows[0].source not in UNDOABLE_SOURCES or not row_level:
        raise UndoRefused(409, SUMMARY_REFUSAL)
    if batch_id in await undone_by(db, [batch_id]):
        raise UndoRefused(409, ALREADY_UNDONE)
    keys = {_pk_key(row.table_name, row.pk) for row in row_level}
    later = (
        await db.execute(
            select(ChangeLog).where(
                ChangeLog.id > rows[-1].id,
                ChangeLog.table_name.in_({row.table_name for row in row_level}),
                ChangeLog.op != "batch",
            )
        )
    ).scalars()
    if any(_pk_key(row.table_name, row.pk) in keys for row in later):
        raise UndoRefused(409, OVERLAP_REFUSAL)

    undo = ChangeBatch(db, source="undo", actor=actor)
    undo.label = f"Undid: {rows[0].label}"
    undo.month = rows[0].month
    for row in reversed(row_level):
        table = Base.metadata.tables[row.table_name]
        where = and_(
            *[table.c[key] == parse_cell(table.c[key], value) for key, value in row.pk.items()]
        )
        before = {
            key: parse_cell(table.c[key], value)
            for key, value in (row.before or {}).items()
            if key in table.c
        }
        if row.op == "insert":
            await db.execute(delete(table).where(where))
            undo.record(row.table_name, row.pk, row.after, None, month=row.month)
        elif row.op == "update":
            await db.execute(update(table).where(where).values(before))
            undo.record(row.table_name, row.pk, row.after, row.before, month=row.month)
        else:
            await db.execute(insert(table).values(before))
            undo.record(row.table_name, row.pk, None, row.before, month=row.month)
    db.add(
        LifecycleRun(
            kind="undo",
            ok=True,
            actor=actor,
            batch_id=undo.id,
            report={"undid": str(batch_id), "label": rows[0].label},
        )
    )
    new_id = await undo.commit()
    db.expunge_all()
    logger.info("undid batch %s as %s", batch_id, new_id)
    return new_id  # type: ignore[return-value]  # never None: row_level is non-empty
