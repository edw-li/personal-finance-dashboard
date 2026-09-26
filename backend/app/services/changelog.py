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
"already undone" and the listing's `undone_by` are answered — and how `superseded` tells a
later change that still stands from one an Undo cancelled.
"""

import logging
from datetime import date
from uuid import UUID, uuid4

from fastapi import Depends, Request
from sqlalchemy import Select, Table, and_, delete, func, insert, literal, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.api.deps import get_current_user
from app.database import Base, get_db
from app.models import ChangeLog, LifecycleRun, User
from app.services import clock
from app.services.month_review import REVIEW_INPUT_TABLES, lock_review_inputs
from app.services.ordering import order_locks_for
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
POST_SUMMARY_REFUSAL = (
    "An import or restore since then replaced these rows — restore a snapshot instead"
)
DEPENDENT_REFUSAL = "Other rows now depend on this one — undo the changes that added them first"
REPLAY_REFUSAL = "Undo no longer fits the current data — a row it depends on has changed or is gone"

# asyncpg binds at most 32,767 parameters per statement; a grouped re-insert splits below it.
REINSERT_PARAMETERS = 32_000

# Every Undo holds this from its FIRST statement to its commit, so Undos run one at a time. Each
# reads the undo runs and the later changes (ALREADY_UNDONE, superseded) and then writes a run of
# its own; two in flight both pass on what the other has not committed yet — one batch undone
# twice, or an older batch's Undo writing over a redo in flight (the L3c review's probes). One
# global key, not one per table: the chains an Undo reads cross tables, and an Undo is a rare,
# human-paced action, so nothing queues behind it for long. Only undo_batch takes it, and always
# before any other lock, so it can close no cycle with the order or review-table locks.
UNDO_LOCK = text("SELECT pg_advisory_xact_lock(hashtext(:key))").bindparams(key="undo")


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
            # The product day's instant, not merely now (2026-09-23 spec §K1): month_status reads
            # "saved after the month ended" off this stamp, so under the dev override it must
            # name the same day every other rule reads.
            stamp = clock.change_stamp()
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


async def refuse_when_depended_on(db: AsyncSession, table: Table, image: dict[str, object]) -> None:
    """Guard in front of a replayed DELETE (undoing an `insert`).

    The replay is a bare Core `DELETE`, not an ORM cascade, so Postgres applies the FK's own
    `ondelete`: undoing the create of a parent row would silently CASCADE away children this
    batch never imaged (a month's balances under the account that created them) or SET NULL a
    pointer at it. So walk the metadata for constraints pointing AT `table` and refuse while
    any child row still exists — the general form of the accounts DELETE route's own 409.

    Rows the same replay already removed are invisible here: the inverses run in reverse
    order inside ONE transaction, so a month's balances are gone by the time its snapshot is
    reached. `image` is the full row (`before`/`after`), not just the pk, so a constraint
    that references a non-key column resolves too.

    Undo-time only, unavoidably: "does anything depend on this row" is a question about the
    CURRENT data, which the Activity listing cannot answer when it renders the button.
    """
    for child in Base.metadata.tables.values():
        for constraint in child.foreign_key_constraints:
            if constraint.referred_table is not table:
                continue
            pairs = [(fk.parent, fk.column.key) for fk in constraint.elements]
            if any(referenced not in image for _, referenced in pairs):
                continue  # the image cannot name the referenced value — nothing to ask
            depends = await db.execute(
                select(literal(1))
                .select_from(child)
                .where(
                    and_(
                        *[
                            column == parse_cell(column, image[referenced])
                            for column, referenced in pairs
                        ]
                    )
                )
                .limit(1)
            )
            if depends.first() is not None:
                raise UndoRefused(409, DEPENDENT_REFUSAL)


async def lock_parent[M](db: AsyncSession, model: type[M], pk: object) -> M | None:
    """The row a delete with dependents removes, read FOR UPDATE: the delete's FIRST read
    (2026-09-25 polish spec §6.1, lane L3c). A child row's foreign key takes FOR KEY SHARE on
    its parent, which FOR UPDATE blocks: a child another tab writes while the delete runs waits
    for it (and then fails its FK), and one already in flight makes this read wait, after which
    the dependents' read sees it. Either way no child reaches the parent's DELETE unimaged, to
    be removed or unlinked by the FK's ON DELETE. populate_existing: the image is the row as
    locked, even in a session that already holds it.

    A parent that is a month-review input (an account, a spending category) takes
    lock_review_inputs BEFORE this, in undo_batch's order: a month save holds those table locks
    while it writes under the row, and a row lock taken first deadlocked with it."""
    return await db.get(model, pk, with_for_update=True, populate_existing=True)


async def lock_children[M](db: AsyncSession, statement: Select[tuple[M]]) -> list[M]:
    """The rows a dependent delete images, read FOR UPDATE after lock_parent. A child another
    tab moves away from the parent, or edits in place, while the delete runs makes this read wait
    for that tab; Postgres then re-checks the WHERE on the row as committed, so a moved child
    drops out and an edited one is imaged as it now stands — where a plain read left the delete's
    own UPDATE or DELETE to wait and then write over the other tab's change with a stale image.
    Counts that only refuse the delete need no lock: the parent's already keeps new children
    out. populate_existing, as in lock_parent."""
    locked = statement.with_for_update().execution_options(populate_existing=True)
    return list((await db.execute(locked)).scalars().all())


async def undo_links(db: AsyncSession) -> dict[UUID, UUID]:
    """Every Undo that went through, as the batch it reversed -> its own batch, read from the
    `undo` runs' reports: whether a batch was undone, and every chain `stands` walks. It reads
    every run, so a request reads it ONCE and hands the map to each question it asks (the
    Activity listing, undo_batch, month_status). In run order, the first claim of a batch kept,
    so every reader walks the same chains."""
    runs = (
        await db.execute(
            select(LifecycleRun.report, LifecycleRun.batch_id)
            .where(LifecycleRun.kind == "undo", LifecycleRun.ok.is_(True))
            .order_by(LifecycleRun.id)
        )
    ).all()
    links: dict[UUID, UUID] = {}
    for report, undo_id in runs:
        undid = (report or {}).get("undid")
        if not isinstance(undid, str) or undo_id is None:
            continue
        try:
            links.setdefault(UUID(undid), undo_id)
        except ValueError:
            continue  # not a batch id: nothing it could have undone
    return links


def stands(batch_id: UUID, links: dict[UUID, UUID]) -> bool:
    """Whether the batch's effect is in the data: an even number of Undos above it in its chain
    — none, or an Undo that was itself undone (a redo), and so on. `links` is undo_links."""
    undos = 0
    while batch_id in links:
        batch_id = links[batch_id]
        undos += 1
    return undos % 2 == 0


async def superseded(
    db: AsyncSession, batch_ids: list[UUID], links: dict[UUID, UUID]
) -> dict[UUID, str]:
    """batch -> the 409 sentence a LATER log entry earns it, for each batch that has one.
    `links` is undo_links, read once by the caller.

    Page-wide queries, never one per row, so `GET /activity`'s `undoable` flag and
    undo_batch's own refusals are decided by this one predicate and cannot drift apart:

    * OVERLAP_REFUSAL — a later change that still stands touched one of this batch's rows,
      so the batch's `before` images are no longer what those rows hold. A later change is a
      batch with a row-level entry on one of this batch's (table, pk) after this batch's own
      last entry. Undos form chains — X; the Undo U1 that reversed X; the Undo U2 that
      reversed U1, a redo; … — each batch undone at most once (undo_batch holds UNDO_LOCK from
      its first statement to its commit, so a second Undo of a batch waits for the first, then
      reads its run and refuses ALREADY_UNDONE), and a batch STANDS when an even number of
      Undos sit above it in its chain. A later change L counts only when
        1. L stands (its effect is in the data), and
        2. L is not the Undo of a batch that is itself later than this one.
      So a later change and its standing Undo cancel out — the change no longer stands, the
      Undo undid a later batch — which is what makes the sentence's "undo those first" true.
      After a redo, the change stands and counts again while the Undo and the redo cancel;
      after an Undo of the redo, the whole chain cancels. An Undo of a batch OLDER than this
      one is an ordinary later change: it rewrote the rows after this batch did, and redoing
      this batch over it would re-apply whatever this batch's images carry from before.
    * POST_SUMMARY_REFUSAL — an import or a restore was logged after it. Both TRUNCATE …
      RESTART IDENTITY and then setval the sequences, so the ids inside this batch's images
      may now address entirely different rows; the images cannot be trusted even where no
      primary key visibly overlaps. Summary rows carry table_name '*' and an empty pk, which
      is why the overlap join alone can never see them — and they are never undone, so no
      Undo cancels one.

    Overlap wins when both apply — it is the more specific diagnosis.
    """
    if not batch_ids:
        return {}
    # Uncorrelated on purpose: the newest summary row in the WHOLE log, compared once per
    # batch by the grouped select below.
    newest_summary = select(func.max(ChangeLog.id)).where(ChangeLog.op == "batch").scalar_subquery()
    ends = (
        select(
            ChangeLog.batch_id.label("batch_id"),
            func.max(ChangeLog.id).label("last_id"),
            (func.max(ChangeLog.id) < newest_summary).label("post_summary"),
        )
        .where(ChangeLog.batch_id.in_(batch_ids))
        .group_by(ChangeLog.batch_id)
        .subquery()
    )
    mine = aliased(ChangeLog)
    later = aliased(ChangeLog)
    pairs = (
        await db.execute(
            select(mine.batch_id, later.batch_id)
            .distinct()
            .select_from(mine)
            .join(ends, ends.c.batch_id == mine.batch_id)
            .join(
                later,
                and_(
                    later.id > ends.c.last_id,
                    later.op != "batch",
                    later.table_name == mine.table_name,
                    # jsonb '=' normalises key order and whitespace, so this is the SQL
                    # twin of comparing sorted-key JSON in Python.
                    later.pk == mine.pk,
                ),
            )
            .where(mine.op != "batch")
        )
    ).all()
    later_changes: dict[UUID, set[UUID]] = {}
    for batch_id, later_id in pairs:
        later_changes.setdefault(batch_id, set()).add(later_id)
    undid = {undo_id: target for target, undo_id in links.items()}
    standing = {
        later_id: stands(later_id, links)
        for later_ids in later_changes.values()
        for later_id in later_ids
    }
    out: dict[UUID, str] = {
        batch_id: OVERLAP_REFUSAL
        for batch_id, later_ids in later_changes.items()
        if any(
            standing[later_id] and undid.get(later_id) not in later_ids for later_id in later_ids
        )
    }
    for batch_id, post_summary in (
        await db.execute(select(ends.c.batch_id, ends.c.post_summary))
    ).all():
        if post_summary and batch_id not in out:
            out[batch_id] = POST_SUMMARY_REFUSAL
    return out


async def _reinsert(db: AsyncSession, table: Table, rows: list[dict[str, object]]) -> None:
    """A run of an Undo's consecutive re-inserts into one table, as multi-row INSERTs: a
    security's ~800 closes in one statement, not 800 round trips. Split below asyncpg's
    parameter limit. A constraint any row breaks raises IntegrityError from here, which the
    Activity route answers with REPLAY_REFUSAL exactly as it did row by row."""
    per_statement = max(1, REINSERT_PARAMETERS // max(1, len(rows[0])))
    for start in range(0, len(rows), per_statement):
        await db.execute(insert(table).values(rows[start : start + per_statement]))


async def undo_batch(db: AsyncSession, batch_id: UUID, *, actor: str | None) -> UUID:
    """Replay a batch's inverses in reverse order, in one transaction (spec §9): insert →
    delete, update → set `before`, delete → insert `before`; consecutive re-inserts into one
    table go out as one statement (_reinsert). Refuses (409) a summary-only
    or non-undoable-source batch, an already-undone batch, a batch a later change or a later
    import/restore superseded (`superseded`), and — per replayed DELETE, because only the
    current data can answer it — a row that others still depend on. Records the replay as a
    new source='undo' batch plus an `undo` run. Expunges the session afterwards: Core
    statements bypass the identity map. One at a time: UNDO_LOCK is its first statement."""
    await db.execute(UNDO_LOCK)
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
    # An Undo that rewrites a list's rows (services.ordering.LOGGED_LISTS) rewrites that list's
    # order too, so it serializes with the list's reorders and appends (2026-09-23 reorder plan
    # decision 16): racing a reorder in another tab, it must not blend the two orders. In the
    # fixed order, and BEFORE the review-input table locks below, so an Undo can never hold
    # those while an import that holds the order locks waits for them.
    for statement in order_locks_for({row.table_name for row in row_level}):
        await db.execute(statement)
    if any(row.table_name in REVIEW_INPUT_TABLES for row in row_level):
        # Reverse replay starts with child tables. Coordinate before reading the current
        # undo eligibility, so an atomic month save cannot hold the parents while undo
        # holds their children, and any completed concurrent save is included in the guard.
        await lock_review_inputs(db)
    links = await undo_links(db)
    if batch_id in links:
        raise UndoRefused(409, ALREADY_UNDONE)
    # Same predicate the Activity listing greys the button with, so a visible Undo that the
    # POST then refuses can only mean the data moved between render and click.
    stale = (await superseded(db, [batch_id], links)).get(batch_id)
    if stale is not None:
        raise UndoRefused(409, stale)

    undo = ChangeBatch(db, source="undo", actor=actor)
    undo.label = f"Undid: {rows[0].label}"
    undo.month = rows[0].month
    # A delete's inverse is a re-insert. Consecutive ones into the same table (with the same
    # columns) wait in `run` and go out together (_reinsert); any other step sends the run
    # first, so every statement still executes in reverse-log order. The same columns, because
    # one multi-row INSERT takes its columns from its first row: a column only a later image
    # carries (one logged after a migration) would be dropped without a word.
    run_table: Table | None = None
    run: list[dict[str, object]] = []
    for row in reversed(row_level):
        table = Base.metadata.tables[row.table_name]
        before = {
            key: parse_cell(table.c[key], value)
            for key, value in (row.before or {}).items()
            if key in table.c
        }
        if run and (row.op != "delete" or table is not run_table or before.keys() != run[0].keys()):
            await _reinsert(db, run_table, run)
            run = []
        if row.op == "delete":
            run_table = table
            run.append(before)
            undo.record(row.table_name, row.pk, None, row.before, month=row.month)
            continue
        where = and_(
            *[table.c[key] == parse_cell(table.c[key], value) for key, value in row.pk.items()]
        )
        if row.op == "insert":
            await refuse_when_depended_on(db, table, {**(row.after or {}), **row.pk})
            await db.execute(delete(table).where(where))
            undo.record(row.table_name, row.pk, row.after, None, month=row.month)
        else:
            await db.execute(update(table).where(where).values(before))
            undo.record(row.table_name, row.pk, row.after, row.before, month=row.month)
    if run:
        await _reinsert(db, run_table, run)
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
