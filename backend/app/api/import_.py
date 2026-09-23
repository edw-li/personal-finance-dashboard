"""Imports (workbook) and restores (the app's own snapshot ZIP) — both dry-run by default.

The restore routes (2026-09-03 data-lifecycle spec §7) are thin: load, gate, plan or apply,
and map SnapshotError to its status. Anything else that escapes AFTER the restore point is a
500 with one sentence and a rollback — the transaction guarantees the "nothing was changed"
half, the committed restore-point run guarantees the file stays listed."""

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.importer import ImportReport, InvalidWorkbookError, run_import
from app.lifecycle.restore import SnapshotError, apply_restore, load_snapshot, plan_restore
from app.models import User
from app.schemas.lifecycle import RestoreReport
from app.services.snapshot import RESTORE_POINT_NAME_RE, alembic_head
from app.services.snapshot_store import read_stored_file

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/import", tags=["import"])

MAX_UPLOAD_BYTES = 15 * 1024 * 1024  # real workbook is <1 MB; generous ceiling
RESTORE_FAILED = "Restore failed and nothing was changed"


@router.post("/xlsx", response_model=ImportReport)
async def import_xlsx(
    file: UploadFile,
    dry_run: bool = Query(True),  # safe default: preview, never write
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ImportReport:
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 15 MB)")
    try:
        return await run_import(data, db, dry_run=dry_run, actor=user.email)
    except InvalidWorkbookError:
        raise HTTPException(status_code=400, detail="Not a valid .xlsx workbook") from None


@router.post("/snapshot", response_model=RestoreReport)
async def import_snapshot(
    file: UploadFile,
    dry_run: bool = Query(True),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RestoreReport:
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 15 MB)")
    return await _restore(
        data, dry_run=dry_run, user=user, db=db, source_name=file.filename or "upload.zip"
    )


# `:path` so a traversal-shaped name ("..%2Fx.zip") reaches THIS handler and gets the same
# sentence as any other foreign name — a plain {name} would not match and Starlette would
# answer its own bare "Not Found".
@router.post("/snapshot/stored/{name:path}", response_model=RestoreReport)
async def import_stored_snapshot(
    name: str,
    dry_run: bool = Query(True),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RestoreReport:
    # The name grammars (a stored snapshot's, or a restore point's — 2026-09-23 spec §B3) ARE
    # the path-safety check: they are matched BEFORE any path is built from the untrusted name,
    # the join must stay inside its directory, and the open itself refuses a symlink, a FIFO
    # and anything but a regular file (O_NOFOLLOW, O_NONBLOCK and fstat where the platform has
    # them — prod's Linux; see snapshot_store._open_regular), so nothing but a stored file of
    # ours is read. Read in FULL, from that one handle, before the restore starts.
    data = await asyncio.to_thread(read_stored_file, name)
    if data is None:
        raise HTTPException(status_code=404, detail=f"No stored snapshot named {name!r}")
    # The apply writes its own restore point first, and that rotation must not delete the
    # point being restored FROM until the apply commits — a failed retry needs the file. A
    # stored snapshot is never in that rotation, so it asks for no protection.
    protect = name if RESTORE_POINT_NAME_RE.fullmatch(name) is not None else None
    return await _restore(
        data, dry_run=dry_run, user=user, db=db, source_name=name, protect_point=protect
    )


async def _restore(
    data: bytes,
    *,
    dry_run: bool,
    user: User,
    db: AsyncSession,
    source_name: str,
    protect_point: str | None = None,
) -> RestoreReport:
    # Read BEFORE the apply: it expunges every loaded instance, this User included.
    user_id, actor = user.id, user.email
    try:
        snapshot = load_snapshot(data)
        head = await alembic_head(db)
        if dry_run:
            return await plan_restore(db, snapshot, user_id=user_id, server_head=head)
        return await apply_restore(
            db,
            snapshot,
            user_id=user_id,
            actor=actor,
            server_head=head,
            source_name=source_name,
            size_bytes=len(data),
            protect_point=protect_point,
        )
    except SnapshotError as exc:
        await db.rollback()
        raise HTTPException(status_code=exc.status, detail=exc.detail) from None
    except Exception:
        await db.rollback()
        logger.exception("restore of %s failed", source_name)
        raise HTTPException(status_code=500, detail=RESTORE_FAILED) from None
