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
from app.services.snapshot import SNAPSHOT_NAME_RE, alembic_head, snapshots_dir

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
    # The name grammar IS the path-safety check, and it runs BEFORE any path is built from
    # the untrusted name: a match can carry neither a separator nor a dot segment, so
    # nothing but a stored snapshot is ever opened.
    missing = f"No stored snapshot named {name!r}"
    if SNAPSHOT_NAME_RE.fullmatch(name) is None:
        raise HTTPException(status_code=404, detail=missing)
    directory = snapshots_dir()
    path = directory / name
    # Belt-and-braces on the join itself: only reachable if the grammar above ever loosens.
    if not path.is_relative_to(directory) or not await asyncio.to_thread(path.is_file):
        raise HTTPException(status_code=404, detail=missing)
    data = await asyncio.to_thread(path.read_bytes)
    return await _restore(data, dry_run=dry_run, user=user, db=db, source_name=name)


async def _restore(
    data: bytes, *, dry_run: bool, user: User, db: AsyncSession, source_name: str
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
        )
    except SnapshotError as exc:
        await db.rollback()
        raise HTTPException(status_code=exc.status, detail=exc.detail) from None
    except Exception:
        await db.rollback()
        logger.exception("restore of %s failed", source_name)
        raise HTTPException(status_code=500, detail=RESTORE_FAILED) from None
