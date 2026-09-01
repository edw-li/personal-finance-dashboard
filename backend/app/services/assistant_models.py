"""Model registry + key resolution + catalog probe (spec §3–§4).

THE registry: `key` is the app's stable vocabulary; `catalog_id` is NVIDIA's spelling —
DATA, not code, so a catalog rename is a one-line edit. All four models postdate the
spec author's knowledge cutoff: catalog_ids below are the convention-based guesses the
morning verification checks against the live /v1/models (an id the catalog doesn't list
simply reads as unavailable, never a crash).
"""

import time
from dataclasses import dataclass
from typing import Literal

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import AppSetting

KEY_SETTING = "nvidia_api_key"
DEFAULT_MODEL_SETTING = "assistant_default_model"

CATALOG_TTL_SECONDS = 3600.0
# A failed probe pins nothing for an hour: a key fixed in Settings (or a catalog that
# came back) must show up on the next page load, not after a coffee break.
CATALOG_FAILURE_TTL_SECONDS = 60.0
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
    AssistantModel(
        key="kimi-k3",
        catalog_id="moonshotai/kimi-k3",
        label="Kimi K3",
        supports_tools=True,
        blurb="default",
    ),
    AssistantModel(
        key="deepseek-v4-pro-0813",
        catalog_id="deepseek-ai/deepseek-v4-pro-0813",
        label="DeepSeek V4 Pro",
        supports_tools=True,
        blurb="",
    ),
    AssistantModel(
        key="nemotron-3-ultra-550b",
        catalog_id="nvidia/nemotron-3-ultra-550b",
        label="Nemotron 3 Ultra 550B",
        supports_tools=True,
        blurb="",
    ),
    AssistantModel(
        key="nemotron-3.5-lightning",
        catalog_id="nvidia/nemotron-3.5-lightning",
        label="Nemotron 3.5 Lightning",
        supports_tools=True,
        blurb="fastest — the failover ladder's last resort",
    ),
)

DEFAULT_MODEL_KEY = "kimi-k3"


def registry_entry(key: str) -> AssistantModel | None:
    return next((m for m in REGISTRY if m.key == key), None)


def http_client(timeout: httpx.Timeout | float) -> httpx.AsyncClient:
    """The one place an outbound NVIDIA client is built (CA-bundle knob, spec §3)."""
    # A whitespace-only env value would pass `or True` truthiness and hand httpx a bogus
    # CA path — FileNotFoundError at CONSTRUCTION, outside any caller's except tuple.
    # Normalize to None first (the price_provider.build_session precedent).
    ca_bundle = settings.nvidia_ca_bundle
    normalized = ca_bundle.strip() if ca_bundle else None
    return httpx.AsyncClient(
        base_url=settings.nvidia_base_url,
        timeout=timeout,
        # Inert whenever TRANSPORT_OVERRIDE is set: httpx uses the given transport as-is
        # and never builds an SSL context, so tests never compose with the CA knob.
        verify=normalized or True,
        transport=TRANSPORT_OVERRIDE,
    )


async def resolve_api_key(db: AsyncSession) -> tuple[str | None, Literal["env", "override"] | None]:
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
# Bumped by every reset. A probe that was already in flight when the key changed carries
# a verdict about the OLD key, so it must not be allowed to write the cache on landing.
_catalog_generation = 0


def reset_catalog_cache() -> None:
    global _catalog_cache, _catalog_generation
    _catalog_cache = None
    _catalog_generation += 1


async def probe_catalog(api_key: str, *, force: bool) -> tuple[bool, frozenset[str], float]:
    """(key_ok, catalog ids, checked_at epoch seconds). A good verdict is cached
    CATALOG_TTL_SECONDS, a bad one only CATALOG_FAILURE_TTL_SECONDS; `force` (the
    Test-key button, ?probe=1) bypasses and refills the cache."""
    global _catalog_cache
    cache = _catalog_cache
    if not force and cache is not None:
        cached_at, cached_ok, cached_ids = cache
        ttl = CATALOG_TTL_SECONDS if cached_ok else CATALOG_FAILURE_TTL_SECONDS
        if time.time() - cached_at < ttl:
            return cached_ok, cached_ids, cached_at
    generation = _catalog_generation
    key_ok = False
    ids: frozenset[str] = frozenset()
    try:
        async with http_client(PROBE_TIMEOUT_SECONDS) as client:
            response = await client.get("/models", headers={"Authorization": f"Bearer {api_key}"})
        if response.status_code == 200:
            # A captive portal / proxy can answer 200 with any JSON at all, so every hop
            # is shape-guarded; the status alone decides key_ok, the shape only decides ids.
            payload = response.json()
            data = payload.get("data", []) if isinstance(payload, dict) else []
            ids = (
                frozenset(str(item.get("id")) for item in data if isinstance(item, dict))
                if isinstance(data, list)
                else frozenset()
            )
            key_ok = True
    except (httpx.HTTPError, ValueError):
        pass  # unreachable catalog / unparseable body: key_ok stays False
    checked_at = time.time()  # stamped on landing, not on dispatch: a 10s probe isn't fresh
    if generation == _catalog_generation:
        _catalog_cache = (checked_at, key_ok, ids)
    return key_ok, ids, checked_at
