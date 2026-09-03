"""Full-data export (2026-08-31 tier-1 spec §B1): one auth-gated GET streaming the ZIP the
snapshot service builds. Thin by design (2026-09-03 data-lifecycle spec §6) — the table
list, the cell spellings and the archive layout live in services/snapshot.py, shared with
the nightly stored snapshot, the restore points and the restore itself."""

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.services.snapshot import build_snapshot_zip

router = APIRouter(prefix="/export", tags=["export"], dependencies=[Depends(get_current_user)])


@router.get("/snapshot")
async def export_snapshot(db: AsyncSession = Depends(get_db)) -> StreamingResponse:
    snap = await build_snapshot_zip(db)
    return StreamingResponse(
        iter([snap.payload]),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{snap.filename}"',
            "Content-Length": str(len(snap.payload)),
        },
    )
