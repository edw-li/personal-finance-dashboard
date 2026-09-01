"""The assistant vertical (2026-09-01 spec): key settings, model availability, and —
in this router's second slice — context preview and the SSE chat loop. The key VALUE
never appears in a response; "configured" is a status, not an echo."""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models import AppSetting
from app.schemas.assistant import (
    AssistantKeyStatus,
    AssistantModelOut,
    AssistantModelsOut,
    AssistantSettingsOut,
    AssistantSettingsUpdate,
)
from app.services.assistant_models import (
    DEFAULT_MODEL_SETTING,
    KEY_SETTING,
    REGISTRY,
    probe_catalog,
    registry_entry,
    reset_catalog_cache,
    resolve_api_key,
    resolve_default_model,
)

router = APIRouter(
    prefix="/assistant", tags=["assistant"], dependencies=[Depends(get_current_user)]
)


async def _settings_out(db: AsyncSession) -> AssistantSettingsOut:
    _key, source = await resolve_api_key(db)
    return AssistantSettingsOut(
        key=AssistantKeyStatus(configured=source is not None, source=source),
        default_model=await resolve_default_model(db),
    )


@router.get("/settings", response_model=AssistantSettingsOut)
async def get_settings(db: AsyncSession = Depends(get_db)) -> AssistantSettingsOut:
    return await _settings_out(db)


@router.put("/settings", response_model=AssistantSettingsOut)
async def put_settings(
    body: AssistantSettingsUpdate, db: AsyncSession = Depends(get_db)
) -> AssistantSettingsOut:
    # Tri-state on api_key: only a field the client actually SENT may change anything
    # (model_fields_set — the wizard net-pay rider, server side).
    key_touched = "api_key" in body.model_fields_set
    if key_touched:
        cleaned = (body.api_key or "").strip()
        setting = await db.get(AppSetting, KEY_SETTING)
        if cleaned == "":
            if setting is not None:
                await db.delete(setting)
        elif setting is None:
            db.add(AppSetting(key=KEY_SETTING, value={"value": cleaned}))
        else:
            setting.value = {"value": cleaned}
    if body.default_model is not None:
        if registry_entry(body.default_model) is None:
            raise HTTPException(status_code=422, detail=f"unknown model key: {body.default_model}")
        setting = await db.get(AppSetting, DEFAULT_MODEL_SETTING)
        if setting is None:
            db.add(AppSetting(key=DEFAULT_MODEL_SETTING, value={"value": body.default_model}))
        else:
            setting.value = {"value": body.default_model}
    await db.commit()
    if key_touched:
        # A different key invalidates the last availability verdict outright — and the
        # reset belongs AFTER the commit: reset first and a probe racing into the gap
        # still resolves the OLD (only committed) key, then caches that verdict against
        # the fresh generation — precisely the stale write the generation guard closes.
        # Clearing counts as a change too: the effective key falls back to env.
        reset_catalog_cache()
    return await _settings_out(db)


@router.get("/models", response_model=AssistantModelsOut)
async def list_models(probe: int = 0, db: AsyncSession = Depends(get_db)) -> AssistantModelsOut:
    api_key, source = await resolve_api_key(db)
    default_key = await resolve_default_model(db)
    if api_key is None:
        return AssistantModelsOut(
            configured=False,
            key_source=None,
            key_ok=None,
            checked_at=None,
            models=[
                AssistantModelOut(
                    key=m.key,
                    label=m.label,
                    available=False,
                    supports_tools=m.supports_tools,
                    default=m.key == default_key,
                )
                for m in REGISTRY
            ],
        )
    key_ok, ids, checked_at = await probe_catalog(api_key, force=probe == 1)
    return AssistantModelsOut(
        configured=True,
        key_source=source,  # narrowed: api_key is not None ⇒ source is "env"|"override"
        key_ok=key_ok,
        checked_at=datetime.fromtimestamp(checked_at, tz=UTC),
        models=[
            AssistantModelOut(
                key=m.key,
                label=m.label,
                available=key_ok and m.catalog_id in ids,
                supports_tools=m.supports_tools,
                default=m.key == default_key,
            )
            for m in REGISTRY
        ],
    )
