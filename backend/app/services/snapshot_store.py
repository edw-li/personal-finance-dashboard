"""Stored logical snapshots on the data volume (2026-09-03 data-lifecycle spec §8): the
export ZIP written nightly by the scheduler (and on demand by POST /system/snapshots) to
<data_dir>/snapshots, newest fourteen kept, each run recorded. The dump is disaster
recovery; these are the undo button for bad days — the app can read them back without
shell access (POST /import/snapshot/stored/{name}).

File IO rides asyncio.to_thread; the job body records a FAILED run instead of raising, so
a missing volume on prod (until the compose redeploy) shows in Activity and the health
check rather than in a traceback nobody reads."""

import asyncio
import contextlib
import json
import logging
import zipfile
from datetime import datetime, timedelta
from pathlib import Path

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ChangeLog, LifecycleRun
from app.schemas.lifecycle import SnapshotEntryOut
from app.services.snapshot import (
    SNAPSHOT_NAME_RE,
    build_snapshot_zip,
    snapshot_name,
    snapshot_stamp,
    snapshots_dir,
    write_file,
)

logger = logging.getLogger(__name__)

SNAPSHOTS_KEEP = 14
CHANGE_LOG_RETENTION_DAYS = 400
ERROR_SNIPPET_LEN = 500


def _head_of(path: Path) -> tuple[bool, str | None]:
    """(readable, the manifest's alembic_head). Two different Nones live here and the
    listing needs to tell them apart: a file that cannot be read as our ZIP is LISTED (it
    is on the volume) but NEVER restorable, while a manifest whose alembic_head is null is
    a snapshot of a create_all database — restorable onto a server that also has no
    alembic_version, which is exactly what the test suite is."""
    try:
        with zipfile.ZipFile(path) as archive:
            head = json.loads(archive.read("manifest.json")).get("alembic_head")
    except (OSError, zipfile.BadZipFile, KeyError, ValueError):
        return False, None
    return True, head if isinstance(head, str) else None


def list_snapshots(server_head: str | None) -> list[SnapshotEntryOut]:
    """Sync (filesystem) — callers wrap it in asyncio.to_thread. Newest first; names outside
    the grammar are ignored; restorable = the file's head equals this server's."""
    directory = snapshots_dir()
    if not directory.is_dir():
        return []
    entries: list[SnapshotEntryOut] = []
    for path in directory.iterdir():
        stamp = snapshot_stamp(path.name)
        # is_symlink first: is_file() FOLLOWS the link, so a symlink dropped into the
        # snapshots directory would be read, sized and offered for restore from wherever it
        # points — off the data volume entirely. Only real files on the volume are snapshots.
        if stamp is None or path.is_symlink() or not path.is_file():
            continue
        readable, head = _head_of(path)
        entries.append(
            SnapshotEntryOut(
                name=path.name,
                at=stamp,
                size_bytes=path.stat().st_size,
                alembic_head=head,
                restorable=readable and head == server_head,
            )
        )
    return sorted(entries, key=lambda entry: entry.name, reverse=True)


async def write_snapshot(db: AsyncSession, *, actor: str | None, trigger: str) -> SnapshotEntryOut:
    """Build, write (atomically, then trim to the newest fourteen), record a `snapshot` run,
    commit. Raises on failure — the job body below turns that into a failed run; the POST
    route lets FastAPI 500."""
    snap = await build_snapshot_zip(db)
    name = snapshot_name(snap.exported_at)
    await asyncio.to_thread(
        write_file, snapshots_dir(), name, snap.payload, SNAPSHOT_NAME_RE, SNAPSHOTS_KEEP
    )
    db.add(
        LifecycleRun(
            kind="snapshot",
            ok=True,
            actor=actor,
            filename=name,
            size_bytes=len(snap.payload),
            report={"tables": snap.counts, "trigger": trigger},
        )
    )
    await db.commit()
    stamp = snapshot_stamp(name)
    assert stamp is not None  # snapshot_name and snapshot_stamp are inverses
    return SnapshotEntryOut(
        name=name,
        at=stamp,
        size_bytes=len(snap.payload),
        alembic_head=snap.alembic_head,
        restorable=True,
    )


async def purge_change_log(db: AsyncSession, *, now: datetime) -> int:
    """Rows older than the retention window go; the caller commits. Returns the count."""
    cutoff = now - timedelta(days=CHANGE_LOG_RETENTION_DAYS)
    result = await db.execute(delete(ChangeLog).where(ChangeLog.at < cutoff))
    return result.rowcount or 0


async def latest_snapshot_run_at(db: AsyncSession) -> datetime | None:
    """The newest SUCCESSFUL snapshot run — the scheduler's catch-up key (spec §8)."""
    return (
        await db.execute(
            select(func.max(LifecycleRun.at)).where(
                LifecycleRun.kind == "snapshot", LifecycleRun.ok.is_(True)
            )
        )
    ).scalar_one_or_none()


async def run_snapshot_job(db: AsyncSession, *, now: datetime, trigger: str) -> bool:
    """The nightly job's body: write, purge, log. True on success; on ANY failure, roll
    back, record a failed `snapshot` run with the error, and return False."""
    try:
        entry = await write_snapshot(db, actor=None, trigger=trigger)
        purged = await purge_change_log(db, now=now)
        await db.commit()
    except Exception as exc:
        await db.rollback()
        logger.exception("nightly snapshot failed")
        try:
            db.add(
                LifecycleRun(
                    kind="snapshot",
                    ok=False,
                    actor=None,
                    error=f"{type(exc).__name__}: {exc}"[:ERROR_SNIPPET_LEN],
                    report={"trigger": trigger},
                )
            )
            await db.commit()
        except Exception:
            # A database the job cannot reach is exactly when this path runs, and the
            # bookkeeping write fails for the same reason the snapshot did. Raising here
            # would escape into APScheduler, which logs a job error and drops the return
            # value — the caller's False (and the log line above) is the better report.
            logger.exception("could not record the failed snapshot run")
            with contextlib.suppress(Exception):
                await db.rollback()
        return False
    logger.info(
        "%s snapshot %s written (%d bytes); %d change-log rows purged",
        trigger,
        entry.name,
        entry.size_bytes,
        purged,
    )
    return True
