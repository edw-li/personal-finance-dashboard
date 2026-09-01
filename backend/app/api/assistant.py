"""The assistant vertical (2026-09-01 spec): key settings, model availability, and —
in this router's second slice — context preview and the SSE chat loop. The key VALUE
never appears in a response; "configured" is a status, not an echo.

The settings PUT reads each app_settings row and then writes it; get-then-set is the
accepted single-user TOCTOU class (accounts/securities/taxes precedent)."""

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models import AppSetting
from app.rate_limit import limiter
from app.schemas.assistant import (
    AssistantKeyStatus,
    AssistantModelOut,
    AssistantModelsOut,
    AssistantSettingsOut,
    AssistantSettingsUpdate,
    ChatIn,
    PreviewIn,
    PreviewOut,
    PreviewSectionOut,
)
from app.services.assistant_chat import _with_keepalive, stream_chat
from app.services.assistant_context import preview_sections
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

CHAT_LIMIT = "20/minute"


async def _settings_out(db: AsyncSession) -> AssistantSettingsOut:
    # `configured` is "a source resolved", not "a value exists to show" — and the discarded
    # `_key` is the signal: this response path never touches the secret at all.
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
    # Asymmetric on purpose: api_key is tri-state (model_fields_set), default_model only
    # tests "is not None". There is no "unset the model" affordance to spell — a missing
    # or junk row already resolves to DEFAULT_MODEL_KEY — so an explicit null would mean
    # exactly what omitting the field means.
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


def _model_rows(default_key: str, ids: frozenset[str], key_ok: bool) -> list[AssistantModelOut]:
    """The registry as wire rows. `available` needs BOTH a working key and a catalog hit,
    so the unprobed (no-key) card passes key_ok=False with an empty id set."""
    return [
        AssistantModelOut(
            key=m.key,
            label=m.label,
            available=key_ok and m.catalog_id in ids,
            supports_tools=m.supports_tools,
            default=m.key == default_key,
        )
        for m in REGISTRY
    ]


# int, not bool, and compared `== 1`: ?probe=1 is the only spelling that forces a live
# catalog read (plan §B3). Any other integer reads as "serve the cache" rather than 422ing
# a GET — the page must still render when a stale link carries ?probe=0 or ?probe=2.
ProbeQuery = Annotated[int, Query()]


@router.get("/models", response_model=AssistantModelsOut)
async def list_models(
    probe: ProbeQuery = 0, db: AsyncSession = Depends(get_db)
) -> AssistantModelsOut:
    api_key, source = await resolve_api_key(db)
    default_key = await resolve_default_model(db)
    if api_key is None:
        return AssistantModelsOut(
            configured=False,
            key_source=None,
            key_ok=None,
            checked_at=None,
            models=_model_rows(default_key, frozenset(), False),
        )
    key_ok, ids, checked_at = await probe_catalog(api_key, force=probe == 1)
    return AssistantModelsOut(
        configured=True,
        key_source=source,  # narrowed: api_key is not None ⇒ source is "env"|"override"
        key_ok=key_ok,
        checked_at=datetime.fromtimestamp(checked_at, tz=UTC),
        models=_model_rows(default_key, ids, key_ok),
    )


@router.post("/context-preview", response_model=PreviewOut)
async def context_preview(body: PreviewIn, db: AsyncSession = Depends(get_db)) -> PreviewOut:
    # POST-for-read (the what-if precedent): computes and never writes.
    sections = await preview_sections(
        db, route=body.context.route, search=body.context.search, view=dict(body.context.view)
    )
    return PreviewOut(sections=[PreviewSectionOut(**s) for s in sections])


@router.post("/chat")
@limiter.limit(CHAT_LIMIT)
async def chat(request: Request, body: ChatIn) -> StreamingResponse:
    """SSE agent loop. Deliberately NO Depends(get_db): FastAPI closes yield-deps before
    a StreamingResponse body runs, so the generator owns its session (assistant_chat)."""
    if registry_entry(body.model) is None:
        raise HTTPException(status_code=422, detail=f"unknown model key: {body.model}")
    stream = stream_chat(
        model_key=body.model,
        messages=[m.model_dump() for m in body.messages],
        context=body.context.model_dump(),
    )
    return StreamingResponse(
        _with_keepalive(stream),
        media_type="text/event-stream",
        # X-Accel-Buffering: nginx honors it per-response — no nginx.conf change needed
        # (spec §2); Cache-Control keeps intermediaries honest.
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
