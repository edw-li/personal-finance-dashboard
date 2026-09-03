"""Server-side preferences (2026-09-03 data-lifecycle spec §10): one row per (user, key)
with its own updated_at — the clock two devices reconcile by. GET answers the registered
keys that exist; PATCH is PARTIAL (only the keys sent are upserted) and validates every key
before writing any; DELETE resets one key by removing its row. No trailing slash on the
prefix routes (the /settings and /household precedent — "/prefs/" would cost a 307)."""

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models import User, UserPreference
from app.schemas.lifecycle import PrefEntryOut, PrefsOut
from app.services.prefs_registry import PREF_REGISTRY, PrefValueError, validate_pref

router = APIRouter(prefix="/prefs", tags=["prefs"])


async def _read(db: AsyncSession, user_id: int) -> PrefsOut:
    rows = (
        await db.execute(select(UserPreference).where(UserPreference.user_id == user_id))
    ).scalars()
    return PrefsOut(
        prefs={
            row.key: PrefEntryOut(value=row.value, updated_at=row.updated_at)
            for row in rows
            if row.key in PREF_REGISTRY  # a retired key's row is not served
        }
    )


@router.get("", response_model=PrefsOut)
async def get_prefs(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> PrefsOut:
    return await _read(db, user.id)


@router.patch("", response_model=PrefsOut)
async def patch_prefs(
    body: dict[str, Any],
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PrefsOut:
    if not body:
        raise HTTPException(status_code=422, detail="Send at least one preference")
    validated: dict[str, Any] = {}
    for key, value in body.items():
        try:
            validated[key] = validate_pref(key, value)
        except KeyError:
            raise HTTPException(status_code=422, detail=f"Unknown preference `{key}`") from None
        except PrefValueError as exc:
            raise HTTPException(status_code=422, detail=f"{key}: {exc}") from None
    now = datetime.now(UTC)
    for key, value in validated.items():
        row = await db.get(UserPreference, (user.id, key))
        if row is None:
            db.add(UserPreference(user_id=user.id, key=key, value=value, updated_at=now))
        else:
            row.value = value
            row.updated_at = now
    await db.commit()
    return await _read(db, user.id)


@router.delete("/{key}", status_code=204)
async def delete_pref(
    key: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> Response:
    if key not in PREF_REGISTRY:
        raise HTTPException(status_code=422, detail=f"Unknown preference `{key}`")
    row = await db.get(UserPreference, (user.id, key))
    if row is not None:
        await db.delete(row)
        await db.commit()
    return Response(status_code=204)
