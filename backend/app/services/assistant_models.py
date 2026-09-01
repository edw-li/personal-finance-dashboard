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
            response = await client.get("/models", headers={"Authorization": f"Bearer {api_key}"})
        if response.status_code == 200:
            data = response.json().get("data", [])
            ids = frozenset(str(item.get("id")) for item in data if isinstance(item, dict))
            key_ok = True
    except (httpx.HTTPError, ValueError):
        pass  # unreachable / malformed catalog: key_ok stays False
    _catalog_cache = (now, key_ok, ids)
    return key_ok, ids, now
