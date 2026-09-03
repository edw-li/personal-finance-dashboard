"""GET /system/health (2026-09-03 data-lifecycle spec §11): the seven checks, computed
fresh on every call. Its own router on the /system prefix — the status router
(app/api/system.py) grows the snapshot routes in a parallel lane, and two routers on one
prefix cost nothing. Not to be confused with the unauthenticated liveness GET /health."""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.config import settings
from app.database import get_db
from app.schemas.lifecycle import HealthOut
from app.services.health_checks import run_checks

router = APIRouter(prefix="/system", tags=["health"], dependencies=[Depends(get_current_user)])


@router.get("/health", response_model=HealthOut)
async def system_health(db: AsyncSession = Depends(get_db)) -> HealthOut:
    now = datetime.now(UTC)
    return HealthOut(
        checked_at=now,
        checks=await run_checks(
            db,
            now=now,
            environment=settings.environment,
            snapshot_enabled=settings.snapshot_enabled,
        ),
    )
