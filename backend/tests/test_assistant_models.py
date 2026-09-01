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
