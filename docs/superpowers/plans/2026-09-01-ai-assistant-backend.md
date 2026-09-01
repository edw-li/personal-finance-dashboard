# AI Assistant — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The `/api/v1/assistant/*` vertical — key/settings endpoints, model registry + catalog probe, per-route context builders, three read-only tools, the SSE agent loop over build.nvidia.com — plus export redaction and deploy wiring, per spec `docs/superpowers/specs/2026-09-01-ai-assistant-design.md` §2–§8, §11–§12.

**Architecture:** One new router (`api/assistant.py`) over four new services (`assistant_models`, `assistant_context`, `assistant_tools`, `assistant_chat`) and one schema module. Context builders call the EXISTING route functions directly with a db session (router-level auth doesn't apply to direct calls; the assistant router carries its own). All NVIDIA traffic flows through one httpx client constructor with a test-injectable transport. **No migration** — two `app_settings` rows in the readers' `{"value": …}` envelope.

**Tech Stack:** FastAPI 0.141 / SQLAlchemy async / pydantic v2 / slowapi / **httpx 0.28.1 promoted from requirements-dev to runtime** (verified: nothing else in `app/` speaks HTTP asynchronously).

**Verify commands:** run from `backend/` with the venv: `./.venv/Scripts/python.exe -m pytest tests/<file> -v` (asyncio auto mode; test DB `finance_test` per conftest). Lane finale: full `pytest`, `ruff check .` and `ruff format --check .` **from `backend/`**.

**Commit convention:** `feat(assistant): …` / `test(assistant): …` per task on the lane branch.

---

## Pinned API contract (identical table in the frontend plan — do not drift)

- `GET /api/v1/assistant/settings` → `{key: {configured, source: "env"|"override"|null}, default_model}`
- `PUT /api/v1/assistant/settings` `{api_key?: string|null, default_model?: string}` → GET shape. Tri-state `api_key` via `model_fields_set`: absent = unchanged, null/blank = clear override, string = set.
- `GET /api/v1/assistant/models[?probe=1]` → `{configured, key_source, key_ok: bool|null, checked_at, models: [{key, label, available, supports_tools, default}]}` — `key_ok`: true = catalog answered 200; false = rejected/unreachable; null = no key.
- `POST /api/v1/assistant/context-preview` `{context}` → `{sections: [{name, rows}]}`
- `POST /api/v1/assistant/chat` `{model, context: {route, search, view}, messages}` → SSE. Events: `notice {kind:"failover", from, to}` · `tool_start {name, summary}` · `tool_result {name, summary}` · `token {text}` · `done {model_used}` · `error {kind: bad_key|rate_limited|unavailable|bad_request|internal, message, retry_after?}`. Keepalive comments `: ping\n\n`. Headers: `Cache-Control: no-cache`, `X-Accel-Buffering: no`.
- Registry: `kimi-k3` (default) / `deepseek-v4-pro-0813` / `nemotron-3-ultra-550b` / `nemotron-3.5-lightning`.

## Load-bearing facts (verified against the codebase 2026-09-01)

1. **Streaming session trap:** FastAPI 0.141 closes `Depends(get_db)`-style yield dependencies when the route function returns — BEFORE a `StreamingResponse` body iterates. The chat generator therefore opens its own session from a module-level `SESSION_FACTORY = SessionLocal` that tests repoint at the test engine. Non-streaming assistant routes keep `Depends(get_db)`.
2. Route functions are directly callable with just `db` (router-level auth doesn't bind), but several return **ORM rows** (`portfolio.list_dividends/list_transactions/list_securities`, `credit_cards.list_reward_rates/list_reward_categories`) — builders must `model_validate` those through their pydantic Out models.
3. Owner params are strings: a decimal person id (`"2"`) or `"joint"`; net-worth/portfolio spell it `owner: OwnerQuery = None`.
4. slowapi: decorator sits BELOW the route decorator and the endpoint's first parameter must be `request: Request` (see `api/auth.py::login`). `limiter.reset()` is already an autouse test fixture.
5. `AppSetting` = `{key: String(60) PK, value: JSONB}`, readers' envelope `{"value": …}` (see `scheduler.read_cron_setting`).
6. Export loop (`api/export.py` lines ~154–177) converts rows inline TWICE (CSV + JSON) — redact by filtering `rows` once, right after the fetch, before both.
7. `httpx==0.28.1` already pinned in `requirements-dev.txt`; promote the same pin to `requirements.txt`.
8. Money serialization for reads: `Decimal` → plain string (the builders use one `jsonable()` helper; the tax read-side precedent is `taxes._money`).
9. Deviation from spec §6 recorded here (spec amended in the docs task): the Overview (`/`) bundle carries **up-next calendar events + the money-flow summary** rather than "attention items" — attention is computed client-side (`attention.ts`) and has no backend service; the household summary already carries the freshness facts attention derives from.

## File structure

```
backend/app/config.py                     MODIFY: +nvidia_api_key/+nvidia_base_url/+nvidia_ca_bundle
backend/requirements.txt                  MODIFY: +httpx==0.28.1
backend/app/schemas/assistant.py          CREATE: request/response models
backend/app/services/assistant_models.py  CREATE: registry, key resolution, catalog probe/cache, http_client
backend/app/services/assistant_context.py CREATE: household summary + per-route builders + preview
backend/app/services/assistant_tools.py   CREATE: 3 tool schemas + dispatcher
backend/app/services/assistant_chat.py    CREATE: SSE agent loop, failover, keepalive, system prompt
backend/app/api/assistant.py              CREATE: the router
backend/app/main.py                       MODIFY: include router
backend/app/api/export.py                 MODIFY: nvidia_api_key row redaction + manifest note
backend/tests/test_assistant_models.py    CREATE
backend/tests/test_assistant_settings_api.py CREATE
backend/tests/test_assistant_context.py   CREATE
backend/tests/test_assistant_tools.py     CREATE
backend/tests/test_assistant_chat_api.py  CREATE
backend/tests/test_export_api.py          MODIFY: redaction pins
.env.example / backend/.env.example       MODIFY: NVIDIA_API_KEY (+ NVIDIA_CA_BUNDLE dev note)
docker-compose.prod.yml                   MODIFY: optional NVIDIA_API_KEY passthrough
README.md                                 MODIFY: env table row + assistant subsection + 7.6 addendum
docs/superpowers/specs/2026-09-01-ai-assistant-design.md  MODIFY: §6 Overview-bundle line (fact 9)
```

---

### Task B1: Dependency + config fields

**Files:**
- Modify: `backend/requirements.txt` (append `httpx==0.28.1` after `slowapi==0.1.10`)
- Modify: `backend/app/config.py`
- Test: `backend/tests/test_config.py` (append)

- [ ] **Step 1: Write the failing test** — append to `backend/tests/test_config.py` (match its existing style — it constructs `Settings(...)` directly):

```python
def test_assistant_config_defaults():
    s = Settings(_env_file=None)
    assert s.nvidia_api_key is None
    assert s.nvidia_base_url == "https://integrate.api.nvidia.com/v1"
    assert s.nvidia_ca_bundle is None
```

- [ ] **Step 2: Run to verify failure** — `./.venv/Scripts/python.exe -m pytest tests/test_config.py -v` — Expected: FAIL (`AttributeError: nvidia_api_key`).

- [ ] **Step 3: Implement.** In `backend/app/config.py`, inside `class Settings`, after `yfinance_ca_bundle`:

```python
    # ── Assistant (2026-09-01 spec §3) ────────────────────────────────────────────
    # The deploy-time baseline key; a Settings-page override (app_settings row) wins.
    nvidia_api_key: str | None = None
    # Tests point this at a mock; never user-facing.
    nvidia_base_url: str = "https://integrate.api.nvidia.com/v1"
    # Dev-box only: PEM bundle when a TLS-intercepting proxy sits in the way (the
    # yfinance_ca_bundle precedent above); prod leaves it unset.
    nvidia_ca_bundle: str | None = None
```

Append to `backend/requirements.txt`: `httpx==0.28.1`. Then install into the venv: `./.venv/Scripts/python.exe -m pip install httpx==0.28.1` (already present via dev requirements — the pip call is a no-op safety).

- [ ] **Step 4: Run to verify pass** — `./.venv/Scripts/python.exe -m pytest tests/test_config.py -v` — Expected: PASS.

- [ ] **Step 5: Commit** — `git add backend/requirements.txt backend/app/config.py backend/tests/test_config.py && git commit -m "feat(assistant): config fields + httpx runtime dependency"`

---

### Task B2: Schemas + model registry service

**Files:**
- Create: `backend/app/schemas/assistant.py`
- Create: `backend/app/services/assistant_models.py`
- Test: `backend/tests/test_assistant_models.py`

- [ ] **Step 1: Create `backend/app/schemas/assistant.py`** (schema modules carry no standalone tests in this house; the API tests exercise them):

```python
"""Assistant vertical schemas (2026-09-01 spec §3–§5)."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class AssistantKeyStatus(BaseModel):
    configured: bool
    source: Literal["env", "override"] | None


class AssistantSettingsOut(BaseModel):
    key: AssistantKeyStatus
    default_model: str


class AssistantSettingsUpdate(BaseModel):
    # Tri-state api_key (read via model_fields_set): absent = unchanged, null or blank =
    # clear the override (fall back to env), non-blank string = set.
    api_key: str | None = None
    default_model: str | None = None


class AssistantModelOut(BaseModel):
    key: str
    label: str
    available: bool
    supports_tools: bool
    default: bool


class AssistantModelsOut(BaseModel):
    configured: bool
    key_source: Literal["env", "override"] | None
    # true = the catalog answered 200; false = key rejected or catalog unreachable;
    # null = no key configured (nothing was probed).
    key_ok: bool | None
    checked_at: datetime | None
    models: list[AssistantModelOut]


class ChatContextIn(BaseModel):
    route: str = Field(max_length=100)
    search: dict[str, str] = Field(default_factory=dict)
    view: dict[str, str | int | None] = Field(default_factory=dict)


class ChatMessageIn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=8000)


class ChatIn(BaseModel):
    model: str
    context: ChatContextIn
    # The client sends its transcript tail; 20 × 8k chars bounds the upstream bill.
    messages: list[ChatMessageIn] = Field(max_length=20)


class PreviewIn(BaseModel):
    context: ChatContextIn


class PreviewSectionOut(BaseModel):
    name: str
    rows: int


class PreviewOut(BaseModel):
    sections: list[PreviewSectionOut]
```

- [ ] **Step 2: Write the failing tests** — `backend/tests/test_assistant_models.py`:

```python
"""Registry, key precedence, and the catalog probe (spec §3–§4)."""

import httpx
import pytest

from app.config import settings
from app.models import AppSetting
from app.services import assistant_models
from app.services.assistant_models import (
    DEFAULT_MODEL_KEY,
    REGISTRY,
    probe_catalog,
    registry_entry,
    resolve_api_key,
    resolve_default_model,
)


@pytest.fixture(autouse=True)
def _clean_module(monkeypatch):
    assistant_models.reset_catalog_cache()
    monkeypatch.setattr(assistant_models, "TRANSPORT_OVERRIDE", None)
    monkeypatch.setattr(settings, "nvidia_api_key", None)
    yield
    assistant_models.reset_catalog_cache()


def test_registry_carries_the_four_models_in_dropdown_order():
    assert [m.key for m in REGISTRY] == [
        "kimi-k3",
        "deepseek-v4-pro-0813",
        "nemotron-3-ultra-550b",
        "nemotron-3.5-lightning",
    ]
    assert DEFAULT_MODEL_KEY == "kimi-k3"
    assert registry_entry("nope") is None


async def test_key_precedence_override_beats_env(db, monkeypatch):
    assert await resolve_api_key(db) == (None, None)
    monkeypatch.setattr(settings, "nvidia_api_key", "nvapi-env")
    assert await resolve_api_key(db) == ("nvapi-env", "env")
    db.add(AppSetting(key="nvidia_api_key", value={"value": "nvapi-override"}))
    await db.commit()
    assert await resolve_api_key(db) == ("nvapi-override", "override")


async def test_blank_or_malformed_override_falls_through_to_env(db, monkeypatch):
    monkeypatch.setattr(settings, "nvidia_api_key", "nvapi-env")
    db.add(AppSetting(key="nvidia_api_key", value={"value": "   "}))
    await db.commit()
    assert await resolve_api_key(db) == ("nvapi-env", "env")


async def test_default_model_reads_envelope_and_rejects_unknown(db):
    assert await resolve_default_model(db) == "kimi-k3"
    db.add(AppSetting(key="assistant_default_model", value={"value": "nemotron-3.5-lightning"}))
    await db.commit()
    assert await resolve_default_model(db) == "nemotron-3.5-lightning"
    (await db.get(AppSetting, "assistant_default_model")).value = {"value": "not-a-model"}
    await db.commit()
    assert await resolve_default_model(db) == "kimi-k3"


def _catalog_transport(ids: list[str], status: int = 200) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/models")
        assert request.headers["Authorization"] == "Bearer k"
        return httpx.Response(status, json={"data": [{"id": i} for i in ids]})

    return httpx.MockTransport(handler)


async def test_probe_reports_availability(monkeypatch):
    monkeypatch.setattr(
        assistant_models, "TRANSPORT_OVERRIDE", _catalog_transport(["moonshotai/kimi-k3"])
    )
    key_ok, ids, _at = await probe_catalog("k", force=True)
    assert key_ok is True
    assert "moonshotai/kimi-k3" in ids


async def test_probe_401_reads_as_key_not_ok(monkeypatch):
    monkeypatch.setattr(assistant_models, "TRANSPORT_OVERRIDE", _catalog_transport([], 401))
    key_ok, ids, _at = await probe_catalog("k", force=True)
    assert key_ok is False and ids == frozenset()


async def test_probe_network_error_reads_as_key_not_ok(monkeypatch):
    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("nope", request=request)

    monkeypatch.setattr(assistant_models, "TRANSPORT_OVERRIDE", httpx.MockTransport(boom))
    key_ok, ids, _at = await probe_catalog("k", force=True)
    assert key_ok is False and ids == frozenset()


async def test_probe_cache_serves_within_ttl_and_force_bypasses(monkeypatch):
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(200, json={"data": []})

    monkeypatch.setattr(assistant_models, "TRANSPORT_OVERRIDE", httpx.MockTransport(handler))
    await probe_catalog("k", force=True)
    await probe_catalog("k", force=False)  # served from cache
    assert calls["n"] == 1
    await probe_catalog("k", force=True)
    assert calls["n"] == 2
```

- [ ] **Step 3: Run to verify failure** — `./.venv/Scripts/python.exe -m pytest tests/test_assistant_models.py -v` — Expected: FAIL (module not found).

- [ ] **Step 4: Create `backend/app/services/assistant_models.py`**

```python
"""Model registry + key resolution + catalog probe (spec §3–§4).

THE registry: `key` is the app's stable vocabulary; `catalog_id` is NVIDIA's spelling —
DATA, not code, so a catalog rename is a one-line edit. All four models postdate the
spec author's knowledge cutoff: catalog_ids below are the convention-based guesses the
morning verification checks against the live /v1/models (an id the catalog doesn't list
simply reads as unavailable, never a crash).
"""

import time
from dataclasses import dataclass

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import AppSetting

KEY_SETTING = "nvidia_api_key"
DEFAULT_MODEL_SETTING = "assistant_default_model"

CATALOG_TTL_SECONDS = 3600.0
PROBE_TIMEOUT_SECONDS = 10.0

# Tests inject httpx.MockTransport here; None = the real network. One override point
# serves this module AND assistant_chat (both build clients via http_client below).
TRANSPORT_OVERRIDE: httpx.AsyncBaseTransport | None = None


@dataclass(frozen=True)
class AssistantModel:
    key: str
    catalog_id: str
    label: str
    supports_tools: bool
    blurb: str


REGISTRY: tuple[AssistantModel, ...] = (
    AssistantModel("kimi-k3", "moonshotai/kimi-k3", "Kimi K3", True, "default"),
    AssistantModel(
        "deepseek-v4-pro-0813", "deepseek-ai/deepseek-v4-pro-0813", "DeepSeek V4 Pro", True, ""
    ),
    AssistantModel(
        "nemotron-3-ultra-550b", "nvidia/nemotron-3-ultra-550b", "Nemotron 3 Ultra 550B", True, ""
    ),
    AssistantModel(
        "nemotron-3.5-lightning",
        "nvidia/nemotron-3.5-lightning",
        "Nemotron 3.5 Lightning",
        True,
        "fastest — the failover ladder's last resort",
    ),
)

DEFAULT_MODEL_KEY = "kimi-k3"


def registry_entry(key: str) -> AssistantModel | None:
    return next((m for m in REGISTRY if m.key == key), None)


def http_client(timeout: httpx.Timeout | float) -> httpx.AsyncClient:
    """The one place an outbound NVIDIA client is built (CA-bundle knob, spec §3)."""
    return httpx.AsyncClient(
        base_url=settings.nvidia_base_url,
        timeout=timeout,
        verify=settings.nvidia_ca_bundle or True,
        transport=TRANSPORT_OVERRIDE,
    )


async def resolve_api_key(db: AsyncSession) -> tuple[str | None, str | None]:
    """Effective key + source: Settings override → env → unset (spec §3). The env value
    is a live fallback, never copied — rotating .env + restart behaves like every other
    env secret."""
    setting = await db.get(AppSetting, KEY_SETTING)
    if setting is not None and isinstance(setting.value, dict):
        raw = setting.value.get("value")
        if isinstance(raw, str) and raw.strip():
            return raw.strip(), "override"
    if settings.nvidia_api_key and settings.nvidia_api_key.strip():
        return settings.nvidia_api_key.strip(), "env"
    return None, None


async def resolve_default_model(db: AsyncSession) -> str:
    setting = await db.get(AppSetting, DEFAULT_MODEL_SETTING)
    if setting is not None and isinstance(setting.value, dict):
        raw = setting.value.get("value")
        if isinstance(raw, str) and registry_entry(raw) is not None:
            return raw
    return DEFAULT_MODEL_KEY


# (checked_at_epoch, key_ok, catalog ids). key_ok False covers a rejected key AND an
# unreachable catalog — either way nothing is available and the card says so.
_catalog_cache: tuple[float, bool, frozenset[str]] | None = None


def reset_catalog_cache() -> None:
    global _catalog_cache
    _catalog_cache = None


async def probe_catalog(api_key: str, *, force: bool) -> tuple[bool, frozenset[str], float]:
    """(key_ok, catalog ids, checked_at epoch seconds). Cached CATALOG_TTL_SECONDS;
    `force` (the Test-key button, ?probe=1) bypasses and refills the cache."""
    global _catalog_cache
    now = time.time()
    if not force and _catalog_cache is not None and now - _catalog_cache[0] < CATALOG_TTL_SECONDS:
        return _catalog_cache[1], _catalog_cache[2], _catalog_cache[0]
    key_ok = False
    ids: frozenset[str] = frozenset()
    try:
        async with http_client(PROBE_TIMEOUT_SECONDS) as client:
            response = await client.get(
                "/models", headers={"Authorization": f"Bearer {api_key}"}
            )
        if response.status_code == 200:
            data = response.json().get("data", [])
            ids = frozenset(str(item.get("id")) for item in data if isinstance(item, dict))
            key_ok = True
    except (httpx.HTTPError, ValueError):
        pass  # unreachable / malformed catalog: key_ok stays False
    _catalog_cache = (now, key_ok, ids)
    return key_ok, ids, now
```

- [ ] **Step 5: Run to verify pass** — `./.venv/Scripts/python.exe -m pytest tests/test_assistant_models.py -v` — Expected: PASS.

- [ ] **Step 6: Commit** — `git add backend/app/schemas/assistant.py backend/app/services/assistant_models.py backend/tests/test_assistant_models.py && git commit -m "feat(assistant): schemas, model registry, key precedence, catalog probe"`

---

### Task B3: Settings + models endpoints, router mounted

**Files:**
- Create: `backend/app/api/assistant.py` (settings/models endpoints now; preview/chat land in B8)
- Modify: `backend/app/main.py` (import `assistant`, add `app.include_router(assistant.router, prefix="/api/v1")` beside the others)
- Test: `backend/tests/test_assistant_settings_api.py`

- [ ] **Step 1: Write the failing tests** — `backend/tests/test_assistant_settings_api.py`:

```python
"""/assistant/settings + /assistant/models (spec §3–§4). The key value must NEVER
appear in any response body — asserted on the raw text, not the parsed JSON."""

import httpx
import pytest

from app.config import settings
from app.models import AppSetting
from app.services import assistant_models

SETTINGS_URL = "/api/v1/assistant/settings"
MODELS_URL = "/api/v1/assistant/models"


@pytest.fixture(autouse=True)
def _clean_module(monkeypatch):
    assistant_models.reset_catalog_cache()
    monkeypatch.setattr(assistant_models, "TRANSPORT_OVERRIDE", None)
    monkeypatch.setattr(settings, "nvidia_api_key", None)


async def test_assistant_routes_require_auth(client):
    assert (await client.get(SETTINGS_URL)).status_code == 401
    assert (await client.get(MODELS_URL)).status_code == 401


async def test_get_unconfigured(auth_client):
    r = await auth_client.get(SETTINGS_URL)
    assert r.status_code == 200, r.text
    assert r.json() == {
        "key": {"configured": False, "source": None},
        "default_model": "kimi-k3",
    }


async def test_env_key_reads_as_env_source(auth_client, monkeypatch):
    monkeypatch.setattr(settings, "nvidia_api_key", "nvapi-env-secret")
    r = await auth_client.get(SETTINGS_URL)
    assert r.json()["key"] == {"configured": True, "source": "env"}
    assert "nvapi-env-secret" not in r.text


async def test_put_sets_override_and_never_echoes(auth_client, db):
    r = await auth_client.put(SETTINGS_URL, json={"api_key": " nvapi-typed "})
    assert r.status_code == 200, r.text
    assert r.json()["key"] == {"configured": True, "source": "override"}
    assert "nvapi-typed" not in r.text
    stored = await db.get(AppSetting, "nvidia_api_key")
    assert stored.value == {"value": "nvapi-typed"}  # stripped, envelope form


async def test_put_null_clears_override_falling_back_to_env(auth_client, db, monkeypatch):
    monkeypatch.setattr(settings, "nvidia_api_key", "nvapi-env")
    db.add(AppSetting(key="nvidia_api_key", value={"value": "nvapi-x"}))
    await db.commit()
    r = await auth_client.put(SETTINGS_URL, json={"api_key": None})
    assert r.json()["key"] == {"configured": True, "source": "env"}
    assert await db.get(AppSetting, "nvidia_api_key") is None


async def test_put_absent_key_field_leaves_key_untouched(auth_client, db):
    db.add(AppSetting(key="nvidia_api_key", value={"value": "nvapi-keep"}))
    await db.commit()
    r = await auth_client.put(SETTINGS_URL, json={"default_model": "nemotron-3.5-lightning"})
    assert r.json() == {
        "key": {"configured": True, "source": "override"},
        "default_model": "nemotron-3.5-lightning",
    }
    assert (await db.get(AppSetting, "nvidia_api_key")).value == {"value": "nvapi-keep"}


async def test_put_unknown_model_422(auth_client):
    r = await auth_client.put(SETTINGS_URL, json={"default_model": "gpt-9"})
    assert r.status_code == 422
    assert "unknown model key" in r.text


async def test_models_unconfigured_lists_registry_all_unavailable(auth_client):
    r = await auth_client.get(MODELS_URL)
    body = r.json()
    assert body["configured"] is False and body["key_ok"] is None
    assert [m["key"] for m in body["models"]] == [
        "kimi-k3",
        "deepseek-v4-pro-0813",
        "nemotron-3-ultra-550b",
        "nemotron-3.5-lightning",
    ]
    assert all(m["available"] is False for m in body["models"])
    assert body["models"][0]["default"] is True


async def test_models_probe_marks_catalog_hits_available(auth_client, monkeypatch):
    monkeypatch.setattr(settings, "nvidia_api_key", "k")

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, json={"data": [{"id": "moonshotai/kimi-k3"}, {"id": "unrelated/model"}]}
        )

    monkeypatch.setattr(assistant_models, "TRANSPORT_OVERRIDE", httpx.MockTransport(handler))
    r = await auth_client.get(MODELS_URL + "?probe=1")
    body = r.json()
    assert body["key_ok"] is True and body["checked_at"] is not None
    by_key = {m["key"]: m for m in body["models"]}
    assert by_key["kimi-k3"]["available"] is True
    assert by_key["nemotron-3.5-lightning"]["available"] is False


async def test_put_key_resets_probe_cache(auth_client, monkeypatch):
    monkeypatch.setattr(settings, "nvidia_api_key", "k")
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(200, json={"data": []})

    monkeypatch.setattr(assistant_models, "TRANSPORT_OVERRIDE", httpx.MockTransport(handler))
    await auth_client.get(MODELS_URL)  # fills the cache
    await auth_client.put(SETTINGS_URL, json={"api_key": "nvapi-new"})
    await auth_client.get(MODELS_URL)  # a NEW key must re-probe, not reuse the old verdict
    assert calls["n"] == 2
```

- [ ] **Step 2: Run to verify failure** — `./.venv/Scripts/python.exe -m pytest tests/test_assistant_settings_api.py -v` — Expected: FAIL (404s / import error).

- [ ] **Step 3: Create `backend/app/api/assistant.py`** (first slice — B8 appends preview/chat):

```python
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
    if "api_key" in body.model_fields_set:
        cleaned = (body.api_key or "").strip()
        setting = await db.get(AppSetting, KEY_SETTING)
        if cleaned == "":
            if setting is not None:
                await db.delete(setting)
        elif setting is None:
            db.add(AppSetting(key=KEY_SETTING, value={"value": cleaned}))
        else:
            setting.value = {"value": cleaned}
        # A different key invalidates the last availability verdict outright.
        reset_catalog_cache()
    if body.default_model is not None:
        if registry_entry(body.default_model) is None:
            raise HTTPException(status_code=422, detail=f"unknown model key: {body.default_model}")
        setting = await db.get(AppSetting, DEFAULT_MODEL_SETTING)
        if setting is None:
            db.add(AppSetting(key=DEFAULT_MODEL_SETTING, value={"value": body.default_model}))
        else:
            setting.value = {"value": body.default_model}
    await db.commit()
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
```

In `backend/app/main.py`: add `assistant,` to the `from app.api import (…)` list (alphabetical — after `app_settings`) and `app.include_router(assistant.router, prefix="/api/v1")` beside the other includes.

- [ ] **Step 4: Run to verify pass** — `./.venv/Scripts/python.exe -m pytest tests/test_assistant_settings_api.py -v` — Expected: PASS.

- [ ] **Step 5: Commit** — `git add backend/app/api/assistant.py backend/app/main.py backend/tests/test_assistant_settings_api.py && git commit -m "feat(assistant): settings + models endpoints with tri-state key and probe"`

---

### Task B4: Export redaction

**Files:**
- Modify: `backend/app/api/export.py`
- Modify: `backend/tests/test_export_api.py` (append)

- [ ] **Step 1: Write the failing test** — append to `backend/tests/test_export_api.py` (reuse that file's existing zip-opening helpers/idioms — read it first; it already downloads and opens the snapshot):

```python
async def test_export_redacts_the_nvidia_api_key_row(auth_client, db):
    db.add(AppSetting(key="nvidia_api_key", value={"value": "nvapi-SECRET"}))
    db.add(AppSetting(key="assistant_default_model", value={"value": "kimi-k3"}))
    await db.commit()
    r = await auth_client.get("/api/v1/export/snapshot")
    assert r.status_code == 200
    raw = r.content
    assert b"nvapi-SECRET" not in raw  # the whole ZIP, CSV and JSON alike
    with zipfile.ZipFile(io.BytesIO(raw)) as zf:
        manifest = json.loads(zf.read("manifest.json"))
        assert manifest["redactions"] == ["app_settings.nvidia_api_key"]
        csv_text = zf.read("csv/app_settings.csv").decode()
        assert "assistant_default_model" in csv_text  # its sibling row still exports
        assert "nvidia_api_key" not in csv_text
```

(Add `from app.models import AppSetting` and `import io, json, zipfile` at the top if that file doesn't already have them.)

- [ ] **Step 2: Run to verify failure** — `./.venv/Scripts/python.exe -m pytest tests/test_export_api.py -v` — Expected: the new test FAILS (`nvapi-SECRET` found).

- [ ] **Step 3: Implement.** In `backend/app/api/export.py`, add near `EXCLUDED_TABLES`:

```python
# Redacted ROWS (spec 2026-09-01 §3): the assistant API key must not ride into every
# backup ZIP. Row-level, not table-level — assistant_default_model and its siblings
# still export. Filtered once, before BOTH serializations (CSV + JSON read the same
# `rows` list).
REDACTED_ROWS: dict[str, frozenset[str]] = {"app_settings": frozenset({KEY_SETTING})}
```

with `from app.services.assistant_models import KEY_SETTING` in the imports. Then, in `export_snapshot`'s per-table loop, immediately after the rows are fetched (`rows = (…).scalars().all()`):

```python
        redacted_keys = REDACTED_ROWS.get(table_name)
        if redacted_keys is not None:
            rows = [row for row in rows if row.key not in redacted_keys]
```

And where the manifest dict is assembled, add the standing note:

```python
        "redactions": [
            f"{table}.{key}" for table, keys in REDACTED_ROWS.items() for key in sorted(keys)
        ],
```

- [ ] **Step 4: Run to verify pass** — `./.venv/Scripts/python.exe -m pytest tests/test_export_api.py -v` — Expected: PASS (all, including the pre-existing pinned-table tests).

- [ ] **Step 5: Commit** — `git add backend/app/api/export.py backend/tests/test_export_api.py && git commit -m "feat(assistant): export snapshot redacts the API key row"`

---

### Task B5: Context builders + preview

**Files:**
- Create: `backend/app/services/assistant_context.py`
- Test: `backend/tests/test_assistant_context.py`

The one big pure-ish service. Design rules: every builder is `async def _build_<name>(db, search, view) -> dict`; each is wrapped so a failing section becomes `{"error": "<class name>"}` (GET-never-rejects law); everything returned has passed `jsonable()` (Decimal→plain string, date/datetime→isoformat); route functions are called directly (fact 2 — `model_validate` the ORM-returning ones).

- [ ] **Step 1: Write the failing tests** — `backend/tests/test_assistant_context.py`:

```python
"""Context assembly (spec §6): shape, view-param faithfulness, error isolation,
truncation, preview outlines. Seeds the minimum rows each builder needs."""

import json
from datetime import date
from decimal import Decimal

from app.models import (
    Account,
    AccountBalance,
    MonthlyCashflow,
    MonthlySpending,
    NetWorthSnapshot,
    SpendingCategory,
)
from app.services.assistant_context import (
    CONTEXT_CHAR_CAP,
    build_context,
    jsonable,
    preview_sections,
)


def test_jsonable_covers_the_wire_types():
    assert jsonable(Decimal("12.50")) == "12.50"
    assert jsonable(date(2026, 9, 1)) == "2026-09-01"
    assert jsonable({"a": [Decimal("1"), None]}) == {"a": ["1", None]}


async def _seed_two_spending_months(db):
    cat = SpendingCategory(name="Housing", slug="housing", sort_order=1)
    db.add(cat)
    await db.flush()
    for month, amount in ((date(2026, 7, 1), "2000.00"), (date(2026, 8, 1), "2100.00")):
        db.add(MonthlySpending(month=month, category_id=cat.id, amount=Decimal(amount)))
        db.add(MonthlyCashflow(month=month, net_pay=Decimal("7000.00")))
    await db.commit()
    return cat


async def test_household_summary_is_always_present_even_on_an_empty_db(db):
    context = await build_context(db, route="/nonexistent", search={}, view={})
    assert "household" in context
    assert context["household"]["net_worth"]["month"] is None


async def test_spending_builder_carries_months_categories_and_movers(db):
    await _seed_two_spending_months(db)
    context = await build_context(db, route="/spending", search={}, view={})
    section = context["spending"]
    assert section["months"][-1] == "2026-08-01"
    assert section["categories"] == ["Housing"]
    movers = section["movers"]
    assert movers[0]["category"] == "Housing"
    assert movers[0]["value"] == "2100.00"
    assert movers[0]["delta_prior"] == "100.00"


async def test_spending_focused_month_follows_the_search_param(db):
    await _seed_two_spending_months(db)
    context = await build_context(
        db, route="/spending", search={"month": "2026-07-01"}, view={}
    )
    assert context["spending"]["movers"][0]["value"] == "2000.00"


async def test_net_worth_builder_honors_the_view_owner_and_granularity(db):
    account = Account(name="Checking", slug="checking", group="cash", sort_order=1)
    db.add(account)
    await db.flush()
    snap = NetWorthSnapshot(month=date(2026, 8, 1))
    db.add(snap)
    await db.flush()
    db.add(AccountBalance(snapshot_id=snap.id, account_id=account.id, balance=Decimal("10.00")))
    await db.commit()
    context = await build_context(
        db, route="/net-worth", search={}, view={"granularity": "monthly", "owner": None}
    )
    section = context["net_worth"]
    assert section["months"] == ["2026-08-01"]
    assert section["accounts"][0]["name"] == "Checking"


async def test_a_failing_section_degrades_without_taking_the_context_down(db, monkeypatch):
    import app.services.assistant_context as ctx

    async def boom(db, search, view):
        raise RuntimeError("builder exploded")

    monkeypatch.setitem(ctx.ROUTE_BUILDERS, "/spending", ("spending", boom))
    context = await build_context(db, route="/spending", search={}, view={})
    assert context["spending"] == {"error": "section unavailable"}
    assert "household" in context  # the rest of the payload survives


async def test_context_stays_under_the_char_cap_with_a_truncation_marker(db):
    # 60 months of 30 categories still fits the window slicing; assert the CONTRACT
    # instead: the serialized payload respects the cap for the seeded case.
    await _seed_two_spending_months(db)
    context = await build_context(db, route="/spending", search={}, view={})
    assert len(json.dumps(context)) < CONTEXT_CHAR_CAP


async def test_preview_summarizes_sections_with_row_counts(db):
    await _seed_two_spending_months(db)
    sections = await preview_sections(db, route="/spending", search={}, view={})
    names = [s["name"] for s in sections]
    assert names[0] == "household"
    spending = next(s for s in sections if s["name"] == "spending")
    assert spending["rows"] >= 1
```

(Adjust ORM field spellings against `app/models/net_worth.py` / `app/models/spending.py` when writing the test — the columns above follow the models list; if `NetWorthSnapshot`/`AccountBalance` differ, mirror how `tests/test_net_worth_api.py` seeds them.)

- [ ] **Step 2: Run to verify failure**, then **Step 3: Create `backend/app/services/assistant_context.py`**

```python
"""Context assembly (spec §6): compact JSON bundles from the EXISTING route functions,
mirroring exactly what the user's screen shows. Imports api modules from a service —
a deliberate, acyclic reverse edge (api.assistant imports THIS module; the imported api
modules do not import it back).

Every section is fenced: a failing builder degrades to {"error": "section unavailable"}
(GET-never-rejects law) — the assistant then says that section is missing instead of
the endpoint 500ing."""

import json
import logging
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any, Awaitable, Callable

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Person

logger = logging.getLogger(__name__)

CONTEXT_CHAR_CAP = 50_000
# First pass serializes this many trailing months of series data; if the payload still
# busts the cap, one retry at the tight window sets {"truncated": true}.
MONTHS_WINDOW = 24
MONTHS_WINDOW_TIGHT = 12
UP_NEXT_DAYS = 60


def jsonable(value: Any) -> Any:
    """Decimal → plain string (the wire's own spelling), dates → ISO, models → dicts."""
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, datetime | date):
        return value.isoformat()
    if isinstance(value, BaseModel):
        return jsonable(value.model_dump())
    if isinstance(value, dict):
        return {str(k): jsonable(v) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [jsonable(v) for v in value]
    return value


def _tail(values: list, window: int) -> list:
    return values[-window:] if window > 0 else values


def _view_owner(view: dict) -> str | None:
    raw = view.get("owner")
    return str(raw) if raw not in (None, "", "null") else None


def _view_year(view: dict) -> int | None:
    raw = view.get("year")
    try:
        year = int(raw)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return year if 1900 <= year <= 2100 else None


async def _household(db: AsyncSession, search: dict, view: dict) -> dict:
    from app.api.net_worth import summary as net_worth_summary
    from app.api.portfolio import holdings as portfolio_holdings
    from app.api.spending import matrix as spending_matrix
    from app.api.taxes import get_all_summaries

    people = (await db.execute(select(Person).order_by(Person.id))).scalars().all()
    nw = await net_worth_summary(owner=None, db=db)
    port = await portfolio_holdings(owner=None, db=db)
    spend = await spending_matrix(db=db)
    latest_index = len(spend.months) - 1
    current_year = date.today().year
    tax_summaries = await get_all_summaries(db=db)
    tax = next((y for y in tax_summaries.years if y.year == current_year), None)
    return {
        "today": date.today().isoformat(),
        "people": [{"id": p.id, "name": p.name, "is_primary": p.is_primary} for p in people],
        "net_worth": {
            "month": nw.month,
            "total": nw.net_worth,
            "mom_delta": nw.mom_delta,
            "mom_pct": nw.mom_pct,
        },
        "portfolio": {
            "market_value": port.totals.market_value,
            "day_change_amount": port.totals.day_change_amount,
            "prices_as_of_oldest_quote": port.as_of,
        },
        "spending": {
            "latest_month": spend.months[latest_index] if latest_index >= 0 else None,
            "latest_total": spend.totals[latest_index] if latest_index >= 0 else None,
            "latest_savings_rate": spend.savings_rate[latest_index] if latest_index >= 0 else None,
        },
        "tax_current_year": None
        if tax is None or tax.totals is None
        else {
            "year": tax.year,
            "filing_status": tax.filing_status,
            "gross_income": tax.totals.gross_income,
            "total_tax": tax.totals.total_tax,
            "effective_rate": tax.totals.effective_rate,
        },
    }


async def _overview(db: AsyncSession, search: dict, view: dict) -> dict:
    # Spec §6 amended (plan fact 9): up-next events + the money-flow summary — attention
    # is client-side math with no backend service, and household covers its freshness feed.
    from app.api.calendar import get_calendar
    from app.api.overview import money_flow

    today = date.today()
    events = await get_calendar(start=today, end=today + timedelta(days=UP_NEXT_DAYS), db=db)
    flow = await money_flow(year=None, db=db)
    return {
        "up_next": [
            {"date": e.date, "type": e.type, "label": e.label} for e in events.events[:10]
        ],
        "money_flow": flow,
    }


def _movers(months: list, series: list, categories_by_id: dict, focus_index: int) -> list[dict]:
    """The spending page's what-changed table, server-side: value, Δ vs prior month,
    Δ vs the trailing-12 average of ENTERED months (absent ≠ zero — the A6 rule)."""
    movers: list[dict] = []
    for s in series:
        value = s.values[focus_index]
        if value is None:
            continue
        prior = s.values[focus_index - 1] if focus_index >= 1 else None
        window = [v for v in s.values[max(0, focus_index - 11) : focus_index + 1] if v is not None]
        average = sum(window, Decimal("0")) / len(window) if window else None
        movers.append(
            {
                "category": categories_by_id.get(s.category_id, str(s.category_id)),
                "value": value,
                "delta_prior": None if prior is None else value - prior,
                "delta_12mo_avg": None if average is None else value - average,
            }
        )
    movers.sort(key=lambda m: abs(m["delta_prior"] or 0), reverse=True)
    return movers[:8]


def _spending_builder(window: int):
    async def _spending(db: AsyncSession, search: dict, view: dict) -> dict:
        from app.api.spending import matrix as spending_matrix
        from app.api.spending import yearly as spending_yearly

        m = await spending_matrix(db=db)
        y = await spending_yearly(db=db)
        names = {c.id: c.name for c in m.categories}
        month_param = search.get("month") or view.get("focusMonth")
        focus_index = len(m.months) - 1
        if isinstance(month_param, str):
            try:
                focus_index = m.months.index(date.fromisoformat(month_param))
            except ValueError:
                pass  # a garbled ?month falls back to the latest (the page's own rule)
        slice_from = len(m.months) - min(window, len(m.months))
        return {
            "months": _tail(m.months, window),
            "categories": [c.name for c in m.categories],
            "series": [
                {
                    "category": names.get(s.category_id, str(s.category_id)),
                    "values": _tail(s.values, window),
                    "budgets": _tail(s.budgets, window),
                }
                for s in m.series
            ],
            "totals": _tail(m.totals, window),
            "net_pay": _tail(m.net_pay, window),
            "savings_rate": _tail(m.savings_rate, window),
            "focused_month": m.months[focus_index] if m.months else None,
            "movers": _movers(m.months, m.series, names, focus_index) if m.months else [],
            "yearly": y,
            "window_note": f"series show the last {min(window, len(m.months))} months"
            if slice_from > 0
            else None,
        }

    return _spending


def _net_worth_builder(window: int):
    async def _net_worth(db: AsyncSession, search: dict, view: dict) -> dict:
        from app.api.net_worth import summary as net_worth_summary
        from app.api.net_worth import timeseries as net_worth_timeseries

        granularity = view.get("granularity")
        granularity = granularity if granularity in ("monthly", "quarterly") else "monthly"
        owner = _view_owner(view)
        ts = await net_worth_timeseries(granularity=granularity, owner=owner, db=db)
        nw = await net_worth_summary(owner=owner, db=db)
        last = len(ts.months) - 1
        value_by_account = {s.account_id: s.values[last] for s in ts.series} if last >= 0 else {}
        return {
            "owner_scope": owner or "household",
            "granularity": granularity,
            "months": _tail(ts.months, window),
            "group_totals": {g: _tail(v, window) for g, v in ts.group_totals.items()},
            "net_worth": _tail(ts.net_worth, window),
            "summary": nw,
            "accounts": [
                {
                    "name": a.name,
                    "group": a.group,
                    "is_component": a.is_component,
                    "latest_balance": value_by_account.get(a.id),
                }
                for a in ts.accounts
            ],
        }

    return _net_worth


async def _portfolio(db: AsyncSession, search: dict, view: dict) -> dict:
    from app.api.portfolio import allocation_view, holdings, list_dividends, realized
    from app.api.prices import compose_refresh_status
    from app.schemas.portfolio import DividendOut

    owner = _view_owner(view)
    h = await holdings(owner=owner, db=db)
    alloc = {
        by: await allocation_view(by=by, owner=owner, db=db) for by in ("industry", "type", "account")
    }
    real = await realized(owner=owner, db=db)
    dividend_rows = await list_dividends(security_id=None, owner=owner, db=db)
    dividends = [DividendOut.model_validate(r, from_attributes=True) for r in dividend_rows[-12:]]
    status = await compose_refresh_status(db)
    return {
        "owner_scope": owner or "household",
        "totals": h.totals,
        "as_of": h.as_of,
        "holdings": [
            {
                "ticker": row.ticker,
                "name": row.name,
                "shares": row.shares,
                "price": row.price,
                "market_value": row.market_value,
                "weight_pct": row.weight_pct,
                "unrealized_gl": row.unrealized_gl,
                "unrealized_gl_pct": row.unrealized_gl_pct,
                "yield_pct": row.yield_pct,
                "annual_income": row.annual_income,
                "xirr_pct": row.xirr_pct,
            }
            for row in h.holdings
        ],
        "allocation": alloc,
        "realized": real,
        "recent_dividends": dividends,
        "last_refresh": None if status.last is None else {
            "at": status.last.at,
            "updated": status.last.updated,
            "failed_count": len(status.last.failed),
        },
        "open_ticker": view.get("ticker"),
    }


async def _taxes(db: AsyncSession, search: dict, view: dict) -> dict:
    from fastapi import HTTPException

    from app.api.taxes import get_brackets, get_inputs, get_summary, get_withholding

    year = _view_year(view) or date.today().year
    summary = await get_summary(year=year, db=db)
    inputs = await get_inputs(year=year, db=db)
    brackets = await get_brackets(year=year, filing_status=summary.filing_status, db=db)
    flat_inputs = [
        {
            "key": item.key,
            "label": item.label,
            "person_id": item.person_id,
            "value": item.value,
        }
        for section in inputs.sections
        for item in section.items
        if item.value is not None
    ]
    withholding = None
    if year == date.today().year:
        try:
            withholding = await get_withholding(year=year, db=db)
        except HTTPException:
            withholding = None  # settled/ineligible year: the endpoint's own 422 refusal
    return {
        "year": year,
        "summary": summary,
        "inputs": flat_inputs,
        "brackets": brackets,
        "withholding": withholding,
    }


async def _espp(db: AsyncSession, search: dict, view: dict) -> dict:
    from app.api.espp import list_lots, modeler

    lots = await list_lots(db=db)
    model = await modeler(
        subscription_price=None, purchase_fmv=None, carry_forward=None, year=None, db=db
    )
    return {"lots": lots, "modeler": model}


async def _comp(db: AsyncSession, search: dict, view: dict) -> dict:
    from app.api.comp import list_events, vesting_schedule

    events = await list_events(db=db)
    schedule = await vesting_schedule(db=db)
    return {
        "focal_events": events,
        "ticker": schedule.ticker,
        "latest_price": schedule.latest_price,
        "grants": schedule.grants,
        "tiles": schedule.tiles,
        "vest_days": schedule.vest_days[-24:],
        "warnings": schedule.warnings,
    }


async def _paycheck(db: AsyncSession, search: dict, view: dict) -> dict:
    from fastapi import HTTPException

    from app.api.paycheck import get_breakdown

    person_raw = view.get("person")
    person_id = int(person_raw) if isinstance(person_raw, int | str) and str(person_raw).isdigit() else None
    try:
        breakdown = await get_breakdown(profile_id=None, person_id=person_id, db=db)
    except HTTPException as exc:
        return {"error": exc.detail}  # "no paycheck profiles" is an answer, not a failure
    return {"breakdown": breakdown}


async def _credit_cards(db: AsyncSession, search: dict, view: dict) -> dict:
    from app.api.credit_cards import _all_rates, list_credit_cards, list_reward_categories
    from app.schemas.credit_cards import RewardCategoryOut, RewardRateOut

    cards = await list_credit_cards(db=db)
    categories = [
        RewardCategoryOut.model_validate(c, from_attributes=True)
        for c in await list_reward_categories(db=db)
    ]
    rates = [RewardRateOut.model_validate(r, from_attributes=True) for r in await _all_rates(db)]
    return {"cards": cards, "reward_categories": categories, "rates": rates}


async def _projection(db: AsyncSession, search: dict, view: dict) -> dict:
    from fastapi import HTTPException

    from app.api.projection import projection

    try:
        p = await projection(
            annual_return=None,
            monthly_contribution=None,
            annual_spend=None,
            swr=None,
            years=30,
            volatility=None,
            inflation=None,
            contribution_growth=None,
            retire=None,
            db=db,
        )
    except HTTPException as exc:
        return {"error": exc.detail}  # NO_SNAPSHOTS on a fresh database
    payload = p.model_dump()
    # Decimate month-grain series to year-grain: the model reads trends, not 360 points.
    for series_key in ("months", "projected", "coast"):
        payload[series_key] = payload[series_key][::12]
    if payload.get("bands"):
        payload["bands"] = {k: v[::12] for k, v in payload["bands"].items()}
    return payload


async def _calendar(db: AsyncSession, search: dict, view: dict) -> dict:
    from app.api.calendar import get_calendar

    today = date.today()
    events = await get_calendar(start=today, end=today + timedelta(days=UP_NEXT_DAYS), db=db)
    return {"events": events.events}


async def _update(db: AsyncSession, search: dict, view: dict) -> dict:
    from app.api.net_worth import timeseries as net_worth_timeseries

    ts = await net_worth_timeseries(granularity="monthly", owner=None, db=db)
    return {
        "covered_months": ts.months,
        "note": "unsaved wizard entries are client-side drafts the assistant cannot see",
    }


Builder = Callable[[AsyncSession, dict, dict], Awaitable[dict]]

# route → (section name, builder). Window-parameterized builders are FACTORIES so the
# cap retry can rebuild tighter (see build_context).
def _builders(window: int) -> dict[str, tuple[str, Builder]]:
    return {
        "/": ("overview", _overview),
        "/net-worth": ("net_worth", _net_worth_builder(window)),
        "/portfolio": ("portfolio", _portfolio),
        "/spending": ("spending", _spending_builder(window)),
        "/credit-cards": ("credit_cards", _credit_cards),
        "/paycheck": ("paycheck", _paycheck),
        "/comp": ("comp", _comp),
        "/espp": ("espp", _espp),
        "/taxes": ("taxes", _taxes),
        "/projection": ("projection", _projection),
        "/calendar": ("calendar", _calendar),
        "/update": ("update", _update),
    }


# Module-level default map — tests monkeypatch entries here (error-isolation test).
ROUTE_BUILDERS: dict[str, tuple[str, Builder]] = _builders(MONTHS_WINDOW)


async def _assemble(
    db: AsyncSession, route: str, search: dict, view: dict, builders: dict
) -> dict:
    context: dict[str, Any] = {}
    try:
        context["household"] = jsonable(await _household(db, search, view))
    except Exception:
        logger.exception("assistant household summary failed")
        context["household"] = {"error": "section unavailable"}
    entry = builders.get(route)
    if entry is not None:
        name, builder = entry
        try:
            context[name] = jsonable(await builder(db, search, view))
        except Exception:
            logger.exception("assistant context builder failed: %s", route)
            context[name] = {"error": "section unavailable"}
    return context


async def build_context(db: AsyncSession, *, route: str, search: dict, view: dict) -> dict:
    context = await _assemble(db, route, search, view, ROUTE_BUILDERS)
    if len(json.dumps(context)) > CONTEXT_CHAR_CAP:
        context = await _assemble(db, route, search, view, _builders(MONTHS_WINDOW_TIGHT))
        context["truncated"] = True
    return context


async def preview_sections(db: AsyncSession, *, route: str, search: dict, view: dict) -> list[dict]:
    """The transparency chip's outline: section names + row counts, NO values beyond
    what a count reveals — runs the same builders so it can never drift from chat."""
    context = await build_context(db, route=route, search=search, view=view)

    def _rows(section: Any) -> int:
        if isinstance(section, list):
            return len(section)
        if isinstance(section, dict):
            list_lengths = [len(v) for v in section.values() if isinstance(v, list)]
            return max(list_lengths) if list_lengths else len(section)
        return 1

    return [{"name": name, "rows": _rows(section)} for name, section in context.items()]
```

- [ ] **Step 4: Iterate to green** — `./.venv/Scripts/python.exe -m pytest tests/test_assistant_context.py -v`. Expect model-field spelling fixes against the real ORM models (seed the test data the way `tests/test_net_worth_api.py` and `tests/test_spending_api.py` do — copy their insert idioms).

- [ ] **Step 5: Commit** — `git add backend/app/services/assistant_context.py backend/tests/test_assistant_context.py && git commit -m "feat(assistant): per-route context builders, household summary, preview"`

---

### Task B6: Tools

**Files:**
- Create: `backend/app/services/assistant_tools.py`
- Test: `backend/tests/test_assistant_tools.py`

- [ ] **Step 1: Write the failing tests** — `backend/tests/test_assistant_tools.py`:

```python
"""The three read-only tools (spec §7)."""

import json
from datetime import date
from decimal import Decimal

from app.models import MonthlyCashflow, MonthlySpending, SpendingCategory, TaxYear
from app.services.assistant_tools import TOOL_SCHEMAS, execute_tool


def test_tool_schemas_are_openai_shaped_and_exactly_three():
    assert [t["function"]["name"] for t in TOOL_SCHEMAS] == [
        "get_page_data",
        "get_month_detail",
        "run_tax_whatif",
    ]
    for tool in TOOL_SCHEMAS:
        assert tool["type"] == "function"
        assert "parameters" in tool["function"]
        assert tool["function"]["description"]


async def test_unknown_tool_returns_an_error_result_never_raises(db):
    result = await execute_tool(db, "rm_rf", {})
    assert result == {"error": "unknown tool: rm_rf"}


async def test_get_month_detail(db):
    cat = SpendingCategory(name="Travel", slug="travel", sort_order=1)
    db.add(cat)
    await db.flush()
    db.add(MonthlySpending(month=date(2026, 8, 1), category_id=cat.id, amount=Decimal("810.20")))
    db.add(MonthlyCashflow(month=date(2026, 8, 1), net_pay=Decimal("7264.46")))
    await db.commit()
    result = await execute_tool(db, "get_month_detail", {"month": "2026-08-01"})
    assert result["month"] == "2026-08-01"
    assert result["amounts"] == [{"category": "Travel", "amount": "810.20"}]
    assert result["net_pay"] == "7264.46"


async def test_get_month_detail_rejects_garbage_month(db):
    result = await execute_tool(db, "get_month_detail", {"month": "not-a-month"})
    assert "error" in result


async def test_get_page_data_reuses_the_context_builders(db):
    result = await execute_tool(db, "get_page_data", {"page": "/calendar"})
    assert "events" in result


async def test_get_page_data_unknown_page(db):
    result = await execute_tool(db, "get_page_data", {"page": "/nope"})
    assert "error" in result


async def test_run_tax_whatif_requires_an_existing_year(db):
    result = await execute_tool(db, "run_tax_whatif", {"year": 2026})
    assert "error" in result  # no tax year seeded → the route's 404, surfaced as a result


async def test_run_tax_whatif_compacts_the_engine_answer(db):
    db.add(TaxYear(year=2026))
    await db.commit()
    result = await execute_tool(db, "run_tax_whatif", {"year": 2026, "overrides": {}})
    # An empty scenario still answers: baseline == scenario, delta zeros.
    assert set(result) >= {"year", "baseline_totals", "scenario_totals", "delta", "warnings"}
    assert json.dumps(result)  # fully jsonable
```

- [ ] **Step 2: Run to verify failure**, then **Step 3: Create `backend/app/services/assistant_tools.py`**

```python
"""Read-only tools (spec §7): OpenAI function schemas + the in-process dispatcher.
Every failure is an error RESULT handed back to the model (it can correct itself) —
never an exception into the stream."""

import json
import logging
from datetime import date

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.assistant_context import ROUTE_BUILDERS, jsonable

logger = logging.getLogger(__name__)

TOOL_RESULT_CHAR_CAP = 20_000

TOOL_SCHEMAS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "get_page_data",
            "description": (
                "Fetch another dashboard page's data bundle for cross-page questions. "
                "Pages: / (overview), /net-worth, /portfolio, /spending, /credit-cards, "
                "/paycheck, /comp, /espp, /taxes, /projection, /calendar."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "page": {"type": "string", "description": "route path, e.g. /spending"},
                    "params": {
                        "type": "object",
                        "description": "optional view params: year, month (YYYY-MM-01), owner (person id or 'joint'), ticker, person",
                    },
                },
                "required": ["page"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_month_detail",
            "description": "One spending month's full per-category breakdown and net pay.",
            "parameters": {
                "type": "object",
                "properties": {
                    "month": {"type": "string", "description": "first-of-month ISO date, e.g. 2025-12-01"}
                },
                "required": ["month"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_tax_whatif",
            "description": (
                "Model a tax scenario for a year through the app's deterministic what-if "
                "engine — nothing is stored. sales: [{security_id, shares, price?, term?}] "
                "(price omitted = latest quote; term 'long'|'short'). espp_sales: "
                "[{lot_id, sale_price?}]. overrides: {input_key: amount|null}."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "year": {"type": "integer"},
                    "sales": {"type": "array", "items": {"type": "object"}},
                    "espp_sales": {"type": "array", "items": {"type": "object"}},
                    "overrides": {"type": "object"},
                },
                "required": ["year"],
            },
        },
    },
]


def _capped(result: dict) -> dict:
    if len(json.dumps(result)) > TOOL_RESULT_CHAR_CAP:
        return {"truncated": True, "note": "result exceeded the size cap; ask narrower"}
    return result


async def _get_page_data(db: AsyncSession, args: dict) -> dict:
    page = args.get("page")
    entry = ROUTE_BUILDERS.get(str(page))
    if entry is None:
        return {"error": f"unknown page: {page}"}
    params = args.get("params") or {}
    if not isinstance(params, dict):
        params = {}
    name, builder = entry
    section = await builder(db, {k: str(v) for k, v in params.items()}, params)
    return _capped({name: jsonable(section)})


async def _get_month_detail(db: AsyncSession, args: dict) -> dict:
    from app.api.spending import get_month

    try:
        month = date.fromisoformat(str(args.get("month")))
    except ValueError:
        return {"error": f"month must be an ISO first-of-month date, got {args.get('month')!r}"}
    try:
        payload = await get_month(month=month, db=db)
        from app.api.spending import list_categories

        names = {c.id: c.name for c in await list_categories(db=db)}
    except HTTPException as exc:
        return {"error": str(exc.detail)}
    return _capped(
        jsonable(
            {
                "month": payload.month,
                "exists": payload.exists,
                "net_pay": payload.net_pay,
                "amounts": [
                    {"category": names.get(a.category_id, str(a.category_id)), "amount": a.amount}
                    for a in payload.amounts
                ],
                "budgets": [
                    {"category": names.get(b.category_id, str(b.category_id)), "amount": b.amount}
                    for b in payload.budgets
                ],
            }
        )
    )


async def _run_tax_whatif(db: AsyncSession, args: dict) -> dict:
    from app.api.taxes import what_if
    from app.schemas.taxes import WhatIfIn

    try:
        body = WhatIfIn(
            year=args.get("year"),
            sales=args.get("sales") or [],
            espp_sales=args.get("espp_sales") or [],
            overrides=args.get("overrides") or {},
        )
    except ValidationError as exc:
        return {"error": f"invalid what-if arguments: {exc.errors()[:3]}"}
    try:
        out = await what_if(body=body, db=db)
    except HTTPException as exc:
        return {"error": str(exc.detail)}
    # Compact (spec §7): both totals, the delta, details, warnings — never the two full
    # jurisdiction-by-jurisdiction summaries (they'd triple the tokens for no answer).
    return _capped(
        jsonable(
            {
                "year": out.year,
                "baseline_totals": out.baseline.totals,
                "scenario_totals": out.scenario.totals,
                "delta": out.delta,
                "changed_inputs": out.changed_inputs,
                "sale_details": out.sale_details,
                "espp_sale_details": out.espp_sale_details,
                "warnings": out.warnings,
            }
        )
    )


async def execute_tool(db: AsyncSession, name: str, args: dict) -> dict:
    try:
        if name == "get_page_data":
            return await _get_page_data(db, args)
        if name == "get_month_detail":
            return await _get_month_detail(db, args)
        if name == "run_tax_whatif":
            return await _run_tax_whatif(db, args)
    except Exception:
        logger.exception("assistant tool failed: %s", name)
        return {"error": f"tool {name} failed internally"}
    return {"error": f"unknown tool: {name}"}
```

- [ ] **Step 4: Iterate to green** — `./.venv/Scripts/python.exe -m pytest tests/test_assistant_tools.py -v` (fix ORM seeding spellings the same way as B5; `list_categories` returns ORM rows — the code above only reads `.id`/`.name`, which is fine).

- [ ] **Step 5: Commit** — `git add backend/app/services/assistant_tools.py backend/tests/test_assistant_tools.py && git commit -m "feat(assistant): read-only tools — page data, month detail, tax what-if"`

---

### Task B7: The chat service (agent loop, failover, keepalive)

**Files:**
- Create: `backend/app/services/assistant_chat.py`
- Test: unit slice of `backend/tests/test_assistant_chat_api.py` (service-level tests now; endpoint tests in B8 extend the same file)

- [ ] **Step 1: Write the failing service tests** — create `backend/tests/test_assistant_chat_api.py` with the service half:

```python
"""assistant_chat service + (B8) endpoint. The fake NVIDIA upstream is an
httpx.MockTransport streaming OpenAI-format SSE chunks."""

import asyncio
import json

import httpx
import pytest

from app.config import settings
from app.services import assistant_chat, assistant_models
from app.services.assistant_chat import _with_keepalive, stream_chat


@pytest.fixture(autouse=True)
def _wire(monkeypatch, engine):
    # The stream owns its session (plan fact 1): point its factory at the test engine.
    from sqlalchemy.ext.asyncio import async_sessionmaker

    monkeypatch.setattr(
        assistant_chat, "SESSION_FACTORY", async_sessionmaker(engine, expire_on_commit=False)
    )
    monkeypatch.setattr(settings, "nvidia_api_key", "nvapi-test")
    assistant_models.reset_catalog_cache()


def _openai_stream(chunks: list[dict]) -> str:
    lines = [f"data: {json.dumps(c)}" for c in chunks]
    lines.append("data: [DONE]")
    return "\n\n".join(lines) + "\n\n"


def _delta(content: str) -> dict:
    return {"choices": [{"delta": {"content": content}, "finish_reason": None}]}


def _finish(reason: str = "stop") -> dict:
    return {"choices": [{"delta": {}, "finish_reason": reason}]}


def _transport(responder) -> httpx.MockTransport:
    return httpx.MockTransport(responder)


async def _collect(agen) -> list[str]:
    return [item async for item in agen]


def _events(frames: list[str]) -> list[tuple[str, dict]]:
    out = []
    for frame in frames:
        if frame.startswith(":"):
            continue
        lines = frame.strip().split("\n")
        event = lines[0].removeprefix("event: ")
        payload = json.loads(lines[1].removeprefix("data: "))
        out.append((event, payload))
    return out


async def test_happy_path_tokens_then_done(monkeypatch):
    def responder(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/chat/completions")
        body = json.loads(request.content)
        assert body["model"] == "moonshotai/kimi-k3"
        assert body["stream"] is True
        assert body["messages"][0]["role"] == "system"
        return httpx.Response(
            200,
            text=_openai_stream([_delta("Hel"), _delta("lo"), _finish()]),
            headers={"content-type": "text/event-stream"},
        )

    monkeypatch.setattr(assistant_models, "TRANSPORT_OVERRIDE", _transport(responder))
    frames = await _collect(
        stream_chat(
            model_key="kimi-k3",
            messages=[{"role": "user", "content": "hi"}],
            context={"route": "/", "search": {}, "view": {}},
        )
    )
    events = _events(frames)
    assert [e for e, _ in events] == ["token", "token", "done"]
    assert events[-1][1] == {"model_used": "kimi-k3"}


async def test_tool_round_executes_and_feeds_back(monkeypatch):
    calls = {"n": 0}

    def responder(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            chunk = {
                "choices": [
                    {
                        "delta": {
                            "tool_calls": [
                                {
                                    "index": 0,
                                    "id": "call_1",
                                    "function": {
                                        "name": "get_page_data",
                                        "arguments": json.dumps({"page": "/calendar"}),
                                    },
                                }
                            ]
                        },
                        "finish_reason": None,
                    }
                ]
            }
            return httpx.Response(
                200,
                text=_openai_stream([chunk, _finish("tool_calls")]),
                headers={"content-type": "text/event-stream"},
            )
        body = json.loads(request.content)
        assert body["messages"][-1]["role"] == "tool"  # the result went back
        return httpx.Response(
            200,
            text=_openai_stream([_delta("answer"), _finish()]),
            headers={"content-type": "text/event-stream"},
        )

    monkeypatch.setattr(assistant_models, "TRANSPORT_OVERRIDE", _transport(responder))
    frames = await _collect(
        stream_chat(
            model_key="kimi-k3",
            messages=[{"role": "user", "content": "what's coming up?"}],
            context={"route": "/", "search": {}, "view": {}},
        )
    )
    kinds = [e for e, _ in _events(frames)]
    assert kinds == ["tool_start", "tool_result", "token", "done"]


async def test_failover_before_tokens_emits_notice_and_second_model_answers(monkeypatch):
    def responder(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        if body["model"] == "moonshotai/kimi-k3":
            return httpx.Response(502, text="bad gateway")
        return httpx.Response(
            200,
            text=_openai_stream([_delta("fallback"), _finish()]),
            headers={"content-type": "text/event-stream"},
        )

    monkeypatch.setattr(assistant_models, "TRANSPORT_OVERRIDE", _transport(responder))
    events = _events(
        await _collect(
            stream_chat(
                model_key="kimi-k3",
                messages=[{"role": "user", "content": "q"}],
                context={"route": "/", "search": {}, "view": {}},
            )
        )
    )
    assert events[0] == ("notice", {"kind": "failover", "from": "kimi-k3", "to": "deepseek-v4-pro-0813"})
    assert events[-1][0] == "done"
    assert events[-1][1]["model_used"] != "kimi-k3"


async def test_401_maps_to_bad_key_without_failover(monkeypatch):
    attempts = {"n": 0}

    def responder(request: httpx.Request) -> httpx.Response:
        attempts["n"] += 1
        return httpx.Response(401, json={"detail": "invalid key"})

    monkeypatch.setattr(assistant_models, "TRANSPORT_OVERRIDE", _transport(responder))
    events = _events(
        await _collect(
            stream_chat(
                model_key="kimi-k3",
                messages=[{"role": "user", "content": "q"}],
                context={"route": "/", "search": {}, "view": {}},
            )
        )
    )
    assert attempts["n"] == 1  # no ladder on a key problem
    assert events == [("error", {"kind": "bad_key", "message": events[0][1]["message"]})]


async def test_429_maps_to_rate_limited_with_retry_after(monkeypatch):
    def responder(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, headers={"Retry-After": "17"}, json={})

    monkeypatch.setattr(assistant_models, "TRANSPORT_OVERRIDE", _transport(responder))
    events = _events(
        await _collect(
            stream_chat(
                model_key="kimi-k3",
                messages=[{"role": "user", "content": "q"}],
                context={"route": "/", "search": {}, "view": {}},
            )
        )
    )
    assert events[0][0] == "error"
    assert events[0][1]["kind"] == "rate_limited"
    assert events[0][1]["retry_after"] == 17


async def test_every_model_down_names_them_all(monkeypatch):
    def responder(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, text="down")

    monkeypatch.setattr(assistant_models, "TRANSPORT_OVERRIDE", _transport(responder))
    events = _events(
        await _collect(
            stream_chat(
                model_key="kimi-k3",
                messages=[{"role": "user", "content": "q"}],
                context={"route": "/", "search": {}, "view": {}},
            )
        )
    )
    kinds = [e for e, _ in events]
    assert kinds.count("notice") == 3  # three failovers across the four-model ladder
    assert events[-1][0] == "error" and events[-1][1]["kind"] == "unavailable"


async def test_keepalive_pings_while_the_source_is_slow():
    async def slow():
        await asyncio.sleep(0.12)
        yield "event: token\ndata: {}\n\n"

    frames = []
    async for item in _with_keepalive(slow(), interval=0.03):
        frames.append(item)
    assert frames[-1].startswith("event: token")
    assert any(f == ": ping\n\n" for f in frames[:-1])
```

- [ ] **Step 2: Run to verify failure**, then **Step 3: Create `backend/app/services/assistant_chat.py`**

```python
"""The SSE agent loop (spec §2, §5, §8): call NVIDIA, execute tool calls in-process,
re-prompt, stream typed events. OWNS ITS SESSION — FastAPI ≥0.106 closes yield-deps
before a StreamingResponse body runs, so Depends(get_db) must never reach in here;
tests repoint SESSION_FACTORY at the test engine."""

import asyncio
import json
import logging
import time
from collections.abc import AsyncIterator
from datetime import date

import httpx

from app.database import SessionLocal
from app.services.assistant_context import build_context
from app.services.assistant_models import (
    REGISTRY,
    AssistantModel,
    http_client,
    registry_entry,
    resolve_api_key,
)
from app.services.assistant_tools import TOOL_SCHEMAS, execute_tool

logger = logging.getLogger(__name__)

SESSION_FACTORY = SessionLocal

MAX_ROUNDS = 4
MAX_TOOL_CALLS = 6
TOTAL_BUDGET_SECONDS = 90.0
KEEPALIVE_SECONDS = 15.0
# connect fast; read generous per-chunk (the keepalive covers client liveness, and the
# total budget bounds the whole answer); a silently dead upstream errors inside budget.
REQUEST_TIMEOUT = httpx.Timeout(connect=10.0, read=75.0, write=10.0, pool=10.0)


def sse(event: str, payload: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(payload)}\n\n"


async def _with_keepalive(source: AsyncIterator[str], interval: float = KEEPALIVE_SECONDS):
    """Interleave SSE comment pings while the source is quiet. wait_for would CANCEL the
    pending read on timeout and corrupt the iterator — a parked task + asyncio.wait
    keeps the read alive across pings."""
    iterator = source.__aiter__()
    pending: asyncio.Task | None = None
    try:
        while True:
            if pending is None:
                pending = asyncio.ensure_future(anext(iterator))
            done, _ = await asyncio.wait({pending}, timeout=interval)
            if not done:
                yield ": ping\n\n"
                continue
            task, pending = pending, None
            try:
                yield task.result()
            except StopAsyncIteration:
                return
    finally:
        if pending is not None:
            pending.cancel()


class _Retriable(Exception):
    """Connect error / timeout / 5xx / model-missing — the failover ladder's food."""


class _BadKey(Exception):
    def __init__(self, message: str):
        self.message = message


class _RateLimited(Exception):
    def __init__(self, message: str, retry_after: int | None):
        self.message = message
        self.retry_after = retry_after


def system_prompt(context_json: str, tools_enabled: bool) -> str:
    lines = [
        "You are the analyst inside a self-hosted personal-finance dashboard.",
        f"Today is {date.today().isoformat()}.",
        "Answer ONLY from the CONTEXT JSON below and any tool results — never from general",
        "knowledge of markets, prices, or tax law beyond naming concepts.",
        "Quote figures verbatim with their month or year; write money like $1,234.56.",
        "If the data does not contain the answer, say so and name the page or tool that would.",
        "Freshness stamps ride inside the context (prices as-of, latest entered month) —",
        "caveat stale data the way the dashboard's own footer does.",
        "Be concise. Use a markdown table for multi-row comparisons.",
        "This is the user's own data: analysis, not licensed financial advice — no",
        "boilerplate disclaimers.",
    ]
    if tools_enabled:
        lines.append(
            "Tools: get_page_data (another page's bundle), get_month_detail (one spending "
            "month), run_tax_whatif (deterministic tax scenario — prefer it over your own "
            "arithmetic for any sale/override question)."
        )
    else:
        lines.append(
            "Tools are unavailable for this model — cross-page questions may need one that "
            "supports them."
        )
    lines += ["", "CONTEXT:", context_json]
    return "\n".join(lines)


def _status_error(response: httpx.Response) -> Exception:
    detail = ""
    try:
        parsed = response.json()
        raw = parsed.get("detail") or parsed.get("error")
        if isinstance(raw, dict):
            raw = raw.get("message")
        if isinstance(raw, str):
            detail = raw
    except ValueError:
        detail = response.text[:200]
    if response.status_code == 401:
        return _BadKey(detail or "NVIDIA rejected the API key")
    if response.status_code == 429:
        header = response.headers.get("Retry-After")
        retry_after = int(header) if header is not None and header.isdigit() else None
        return _RateLimited(detail or "rate limited by the model endpoint", retry_after)
    if response.status_code >= 500 or response.status_code == 404:
        return _Retriable()
    return _BadKey(detail or f"model endpoint answered {response.status_code}")


async def _model_round(
    client: httpx.AsyncClient, api_key: str, catalog_id: str, messages: list[dict], tools_enabled: bool
) -> AsyncIterator[tuple[str, object]]:
    """One streamed completion. Yields ("token", str) as content arrives, then exactly one
    ("end", {"tool_calls": [...], "content": str}). Raises _Retriable/_BadKey/_RateLimited."""
    body: dict = {"model": catalog_id, "messages": messages, "stream": True}
    if tools_enabled:
        body["tools"] = TOOL_SCHEMAS
    content_parts: list[str] = []
    calls: dict[int, dict] = {}
    try:
        async with client.stream(
            "POST",
            "/chat/completions",
            json=body,
            headers={"Authorization": f"Bearer {api_key}", "Accept": "text/event-stream"},
        ) as response:
            if response.status_code != 200:
                await response.aread()
                raise _status_error(response)
            async for line in response.aiter_lines():
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    chunk = json.loads(data)
                except ValueError:
                    continue
                choices = chunk.get("choices") or []
                if not choices:
                    continue
                delta = choices[0].get("delta") or {}
                text = delta.get("content")
                if isinstance(text, str) and text:
                    content_parts.append(text)
                    yield ("token", text)
                for fragment in delta.get("tool_calls") or []:
                    index = fragment.get("index", 0)
                    slot = calls.setdefault(
                        index, {"id": None, "name": "", "arguments": ""}
                    )
                    if fragment.get("id"):
                        slot["id"] = fragment["id"]
                    fn = fragment.get("function") or {}
                    if fn.get("name"):
                        slot["name"] += fn["name"]
                    if fn.get("arguments"):
                        slot["arguments"] += fn["arguments"]
    except httpx.HTTPError as exc:
        raise _Retriable() from exc
    yield (
        "end",
        {
            "content": "".join(content_parts),
            "tool_calls": [calls[i] for i in sorted(calls)],
        },
    )


async def _converse(
    db,
    client: httpx.AsyncClient,
    api_key: str,
    model: AssistantModel,
    base_messages: list[dict],
    forwarded: list[bool],
) -> AsyncIterator[str]:
    """The whole multi-round conversation on ONE model. _Retriable escapes to the ladder."""
    messages = [dict(m) for m in base_messages]
    started = time.monotonic()
    tool_calls_spent = 0
    for _round in range(MAX_ROUNDS):
        if time.monotonic() - started > TOTAL_BUDGET_SECONDS:
            yield sse("error", {"kind": "internal", "message": "The answer ran past its time budget."})
            return
        end_payload: dict = {}
        async for kind, payload in _model_round(
            client, api_key, model.catalog_id, messages, model.supports_tools
        ):
            if kind == "token":
                forwarded[0] = True
                yield sse("token", {"text": payload})
            else:
                end_payload = payload  # type: ignore[assignment]
        tool_calls = end_payload.get("tool_calls") or []
        if not tool_calls:
            yield sse("done", {"model_used": model.key})
            return
        if tool_calls_spent + len(tool_calls) > MAX_TOOL_CALLS:
            yield sse(
                "error",
                {"kind": "internal", "message": "The model kept requesting tools past the budget."},
            )
            return
        tool_calls_spent += len(tool_calls)
        messages.append(
            {
                "role": "assistant",
                "content": end_payload.get("content") or None,
                "tool_calls": [
                    {
                        "id": call["id"] or f"call_{i}",
                        "type": "function",
                        "function": {"name": call["name"], "arguments": call["arguments"] or "{}"},
                    }
                    for i, call in enumerate(tool_calls)
                ],
            }
        )
        for i, call in enumerate(tool_calls):
            try:
                args = json.loads(call["arguments"] or "{}")
            except ValueError:
                args = {}
            summary = ", ".join(f"{k}={v}" for k, v in list(args.items())[:3]) or "no args"
            yield sse("tool_start", {"name": call["name"], "summary": summary})
            result = await execute_tool(db, call["name"], args if isinstance(args, dict) else {})
            yield sse(
                "tool_result",
                {
                    "name": call["name"],
                    "summary": "error" if "error" in result else "ok",
                },
            )
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": call["id"] or f"call_{i}",
                    "content": json.dumps(result),
                }
            )
    yield sse("error", {"kind": "internal", "message": "The model never finished within the round budget."})


async def stream_chat(*, model_key: str, messages: list[dict], context: dict) -> AsyncIterator[str]:
    async with SESSION_FACTORY() as db:
        api_key, _source = await resolve_api_key(db)
        if api_key is None:
            yield sse(
                "error",
                {"kind": "bad_key", "message": "No NVIDIA API key is configured — set one in Settings."},
            )
            return
        requested = registry_entry(model_key)
        if requested is None:  # the router already 422s; belt for direct callers
            yield sse("error", {"kind": "bad_request", "message": f"unknown model key: {model_key}"})
            return
        context_payload = await build_context(
            db,
            route=str(context.get("route", "/")),
            search=dict(context.get("search") or {}),
            view=dict(context.get("view") or {}),
        )
        prompt = system_prompt(json.dumps(context_payload), requested.supports_tools)
        base_messages = [{"role": "system", "content": prompt}, *messages]
        ladder = [requested, *(m for m in REGISTRY if m.key != requested.key)]
        forwarded = [False]
        async with http_client(REQUEST_TIMEOUT) as client:
            for index, model in enumerate(ladder):
                try:
                    async for frame in _converse(db, client, api_key, model, base_messages, forwarded):
                        yield frame
                    return
                except _BadKey as exc:
                    yield sse("error", {"kind": "bad_key", "message": exc.message})
                    return
                except _RateLimited as exc:
                    payload: dict = {"kind": "rate_limited", "message": exc.message}
                    if exc.retry_after is not None:
                        payload["retry_after"] = exc.retry_after
                    yield sse("error", payload)
                    return
                except _Retriable:
                    if forwarded[0]:
                        yield sse(
                            "error",
                            {"kind": "unavailable", "message": f"{model.label} failed mid-answer."},
                        )
                        return
                    if index + 1 < len(ladder):
                        yield sse(
                            "notice",
                            {"kind": "failover", "from": model.key, "to": ladder[index + 1].key},
                        )
                        continue
                    tried = ", ".join(m.label for m in ladder)
                    yield sse(
                        "error",
                        {"kind": "unavailable", "message": f"Every model failed — tried {tried}."},
                    )
                    return
```

- [ ] **Step 4: Iterate to green** — `./.venv/Scripts/python.exe -m pytest tests/test_assistant_chat_api.py -v` — Expected: PASS. (The tool-round test needs the calendar builder to answer on an empty DB — it does: an empty events list.)

- [ ] **Step 5: Commit** — `git add backend/app/services/assistant_chat.py backend/tests/test_assistant_chat_api.py && git commit -m "feat(assistant): SSE agent loop with tools, failover ladder, keepalive"`

---

### Task B8: Chat + preview endpoints

**Files:**
- Modify: `backend/app/api/assistant.py` (append endpoints)
- Modify: `backend/tests/test_assistant_chat_api.py` (append endpoint tests)

- [ ] **Step 1: Write the failing endpoint tests** — append to `backend/tests/test_assistant_chat_api.py`:

```python
CHAT_URL = "/api/v1/assistant/chat"
PREVIEW_URL = "/api/v1/assistant/context-preview"


def _chat_body(**overrides):
    body = {
        "model": "kimi-k3",
        "context": {"route": "/", "search": {}, "view": {}},
        "messages": [{"role": "user", "content": "hi"}],
    }
    body.update(overrides)
    return body


async def test_chat_requires_auth(client):
    assert (await client.post(CHAT_URL, json=_chat_body())).status_code == 401


async def test_chat_unknown_model_422(auth_client):
    r = await auth_client.post(CHAT_URL, json=_chat_body(model="gpt-9"))
    assert r.status_code == 422


async def test_chat_oversized_transcript_422(auth_client):
    messages = [{"role": "user", "content": "x"}] * 21
    r = await auth_client.post(CHAT_URL, json=_chat_body(messages=messages))
    assert r.status_code == 422


async def test_chat_streams_sse_with_proxy_survival_headers(auth_client, monkeypatch):
    def responder(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            text=_openai_stream([_delta("hey"), _finish()]),
            headers={"content-type": "text/event-stream"},
        )

    monkeypatch.setattr(assistant_models, "TRANSPORT_OVERRIDE", _transport(responder))
    r = await auth_client.post(CHAT_URL, json=_chat_body())
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/event-stream")
    assert r.headers["x-accel-buffering"] == "no"
    assert r.headers["cache-control"] == "no-cache"
    assert "event: token" in r.text and "event: done" in r.text


async def test_preview_lists_sections(auth_client):
    r = await auth_client.post(PREVIEW_URL, json={"context": {"route": "/", "search": {}, "view": {}}})
    assert r.status_code == 200
    names = [s["name"] for s in r.json()["sections"]]
    assert "household" in names
```

- [ ] **Step 2: Run to verify failure**, then **Step 3: Append to `backend/app/api/assistant.py`**:

```python
from fastapi import Request
from fastapi.responses import StreamingResponse

from app.rate_limit import limiter
from app.schemas.assistant import ChatIn, PreviewIn, PreviewOut, PreviewSectionOut
from app.services.assistant_chat import _with_keepalive, stream_chat
from app.services.assistant_context import preview_sections

CHAT_LIMIT = "20/minute"


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
```

- [ ] **Step 4: Run the whole assistant suite** — `./.venv/Scripts/python.exe -m pytest tests/test_assistant_chat_api.py tests/test_assistant_settings_api.py -v` — Expected: PASS.

- [ ] **Step 5: Commit** — `git add backend/app/api/assistant.py backend/tests/test_assistant_chat_api.py && git commit -m "feat(assistant): chat SSE + context-preview endpoints"`

---

### Task B9: Deploy wiring + docs + spec amendment

**Files:**
- Modify: `.env.example` (root), `backend/.env.example`, `docker-compose.prod.yml`, `README.md`, `docs/superpowers/specs/2026-09-01-ai-assistant-design.md`

- [ ] **Step 1:** Root `.env.example` — append under the OCI block:

```
# Assistant (optional): build.nvidia.com API key. The dashboard runs fully without it;
# only the ✦ assistant needs it. A key saved in Settings overrides this one.
NVIDIA_API_KEY=
```

`backend/.env.example` — append:

```
# Assistant (optional): build.nvidia.com key for the ✦ assistant (Settings can override).
# NVIDIA_API_KEY=
# Dev-box only: PEM bundle when a TLS-intercepting proxy breaks the NVIDIA call
# (the YFINANCE_CA_BUNDLE situation). Prod leaves it unset.
# NVIDIA_CA_BUNDLE=
```

- [ ] **Step 2:** `docker-compose.prod.yml` — in the backend `environment:` block, after `ADMIN_PASSWORD`:

```yaml
      # Optional — no :? guard: the app boots fully without the assistant.
      NVIDIA_API_KEY: ${NVIDIA_API_KEY:-}
```

- [ ] **Step 3:** `README.md` — (a) add a row to the Part 3.2 `.env` table: `| NVIDIA_API_KEY | optional — powers the ✦ assistant (build.nvidia.com); blank disables it; a key saved in Settings overrides it |`; (b) append a Part 7.6 addendum in the established addendum style:

```markdown
> **Addendum (2026-09-01)**: the AI assistant adds **zero migrations** — its two settings
> ride the existing `app_settings` table — so this deploy is order-safe and the command
> above is the whole deploy. New optional env: `NVIDIA_API_KEY` (Part 3.2). Spot-checks
> gain one: open the ✦ drawer and ask a question; with no key configured it shows the
> setup note instead. The export snapshot now redacts the key row (`manifest.json` lists
> the redaction), and SSE streaming rides `X-Accel-Buffering: no` + keepalive pings, so
> `nginx.conf` is untouched.
```

- [ ] **Step 4:** Spec amendment (plan fact 9) — in `docs/superpowers/specs/2026-09-01-ai-assistant-design.md` §6, replace the `/` row's `attention items, up-next events` with `up-next events, money-flow summary (attention is client-side math; the household summary already carries its freshness feed)`.

- [ ] **Step 5: Commit** — `git add .env.example backend/.env.example docker-compose.prod.yml README.md docs/superpowers/specs/2026-09-01-ai-assistant-design.md && git commit -m "docs(assistant): deploy wiring, README addendum, spec §6 overview-bundle amendment"`

---

### Task B10: Lane finale

- [ ] **Step 1:** Full suite: `./.venv/Scripts/python.exe -m pytest -v` — Expected: everything green (pre-existing + new).
- [ ] **Step 2:** Lint: from `backend/`: `./.venv/Scripts/ruff.exe check .` and `./.venv/Scripts/ruff.exe format --check .` — fix violations (line-length 100; import order I; ASYNC rules apply to the new services).
- [ ] **Step 3:** Commit any fixes — `git commit -am "chore(assistant): lint fixes"` (only if needed).

---

## Self-review checklist

1. **Spec coverage:** §3 → B2/B3/B4/B9; §4 → B2/B3 + B7 ladder; §5 → B7/B8; §6 → B5 (+fact-9 amendment in B9); §7 → B6; §8 → B7 `system_prompt`; §11 → B9; §12 backend rows → every task's tests.
2. **No placeholders:** every step carries its code; the two "iterate to green" steps name the exact reference files for ORM spellings.
3. **Type consistency:** `KEY_SETTING`/`DEFAULT_MODEL_SETTING` defined once (B2) and imported (B3/B4); `_with_keepalive`, `stream_chat`, `TOOL_SCHEMAS`, `execute_tool`, `build_context`, `preview_sections`, `ROUTE_BUILDERS` spelled identically at definition and use.
