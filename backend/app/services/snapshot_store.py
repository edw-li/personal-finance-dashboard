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
import os
import stat
import zipfile
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import BinaryIO, Literal

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ChangeLog, LifecycleRun
from app.schemas.lifecycle import SnapshotEntryOut
from app.services.snapshot import (
    RESTORE_POINT_NAME_RE,
    SNAPSHOT_NAME_RE,
    build_snapshot_zip,
    restore_point_stamp,
    restore_points_dir,
    snapshot_name,
    snapshot_stamp,
    snapshots_dir,
    write_file,
)

logger = logging.getLogger(__name__)

SNAPSHOTS_KEEP = 14
CHANGE_LOG_RETENTION_DAYS = 400
ERROR_SNIPPET_LEN = 500
# Every ZIP download streams in blocks of this size — FileResponse's own. One ~500 KB write
# followed at once by the connection's close lost its last ~40 KB on the Windows dev box
# whenever the client sent `Connection: close` (uvicorn on the Proactor loop; the live export
# failed 12 of 30 on main), and 64 KiB blocks did not (2026-09-23 lane B1 review, M2).
DOWNLOAD_CHUNK_BYTES = 64 * 1024

# O_NOFOLLOW makes the open itself refuse a symlink (Linux, where prod runs). Windows has no
# such flag: there the opener checks is_symlink first — creating a symlink on Windows takes a
# privilege the app never holds, so that residual window is not one an attacker can reach.
_NOFOLLOW = getattr(os, "O_NOFOLLOW", 0)
_BINARY = getattr(os, "O_BINARY", 0)


@dataclass(frozen=True)
class StoredFile:
    """A stored file opened by the gate: read (or stream) THIS handle, never the path again —
    rotation may unlink the name at any moment, and a handle outlives its name."""

    name: str
    handle: BinaryIO
    size: int


def _open_regular(path: Path) -> tuple[BinaryIO, int] | None:
    """(handle, size) for a regular file at `path` that is not a symlink, or None — missing
    (rotated out since the directory read), a symlink, a directory, anything else. The open
    IS the check: the type and size come from fstat on the opened descriptor, so nothing can
    swap the file between a check and the read. Sync — callers ride asyncio.to_thread."""
    try:
        if not _NOFOLLOW and path.is_symlink():
            return None
        fd = os.open(path, os.O_RDONLY | _NOFOLLOW | _BINARY)
    except OSError:
        return None
    try:
        info = os.fstat(fd)
    except OSError:
        os.close(fd)
        return None
    if not stat.S_ISREG(info.st_mode):
        os.close(fd)
        return None
    return os.fdopen(fd, "rb"), info.st_size


def _head_of(handle: BinaryIO) -> tuple[bool, str | None]:
    """(readable, the manifest's alembic_head). Two different Nones live here and the
    listing needs to tell them apart: a file that cannot be read as our ZIP is LISTED (it
    is on the volume) but NEVER restorable, while a manifest whose alembic_head is null is
    a snapshot of a create_all database — restorable onto a server that also has no
    alembic_version, which is exactly what the test suite is."""
    try:
        with zipfile.ZipFile(handle) as archive:
            head = json.loads(archive.read("manifest.json")).get("alembic_head")
    except (OSError, zipfile.BadZipFile, KeyError, ValueError):
        return False, None
    return True, head if isinstance(head, str) else None


def _list_directory(
    directory: Path,
    stamp_of: Callable[[str], datetime | None],
    kind: Literal["snapshot", "restore_point"],
    server_head: str | None,
) -> list[SnapshotEntryOut]:
    """Sync (filesystem) — callers wrap it in asyncio.to_thread. Newest first; names outside
    the grammar are ignored; restorable = the file's head equals this server's."""
    if not directory.is_dir():
        return []
    entries: list[SnapshotEntryOut] = []
    for path in directory.iterdir():
        stamp = stamp_of(path.name)
        if stamp is None:
            continue
        # Only real files on the volume: a symlink dropped into the directory is never read,
        # sized or offered for restore from wherever it points, and a name rotation deleted
        # after the directory read is simply left out (2026-09-23 lane B1 review, M2).
        opened = _open_regular(path)
        if opened is None:
            continue
        handle, size = opened
        with handle:
            readable, head = _head_of(handle)
        entries.append(
            SnapshotEntryOut(
                name=path.name,
                at=stamp,
                size_bytes=size,
                alembic_head=head,
                restorable=readable and head == server_head,
                kind=kind,
            )
        )
    return sorted(entries, key=lambda entry: entry.name, reverse=True)


def list_snapshots(server_head: str | None) -> list[SnapshotEntryOut]:
    """The stored snapshots (nightly and Snapshot now), newest first."""
    return _list_directory(snapshots_dir(), snapshot_stamp, "snapshot", server_head)


def list_restore_points(server_head: str | None) -> list[SnapshotEntryOut]:
    """The points saved before every restore and import (2026-09-23 spec §B3), newest first
    — the three the writer keeps. Until this, the only way back after a bad restore or import
    was shell access to the volume."""
    return _list_directory(restore_points_dir(), restore_point_stamp, "restore_point", server_head)


def open_stored_file(name: str) -> StoredFile | None:
    """A stored snapshot OR a restore point, opened — or None (2026-09-23 spec §B3). The two
    anchored name grammars ARE the path-safety check and run before any path is built from
    the untrusted name — a match carries neither a separator nor a dot segment; the join is
    then checked to stay inside its directory, and the open refuses a symlink and anything
    but a regular file (see _open_regular). Sync — callers wrap it in asyncio.to_thread; the
    caller owns the handle. The download route and restore-from-stored share it, so the two
    doors can never disagree about what is safe."""
    if SNAPSHOT_NAME_RE.fullmatch(name) is not None:
        directory = snapshots_dir()
    elif RESTORE_POINT_NAME_RE.fullmatch(name) is not None:
        directory = restore_points_dir()
    else:
        return None
    path = directory / name
    if not path.is_relative_to(directory):
        return None
    opened = _open_regular(path)
    if opened is None:
        return None
    handle, size = opened
    return StoredFile(name=name, handle=handle, size=size)


def read_stored_file(name: str) -> bytes | None:
    """open_stored_file, read whole, closed — or None. Sync."""
    stored = open_stored_file(name)
    if stored is None:
        return None
    with stored.handle:
        return stored.handle.read()


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
