"""/assistant/settings + /assistant/models (spec §3–§4). The key value must NEVER
appear in any response body — asserted on the raw text, not the parsed JSON."""

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import assistant as assistant_api
from app.config import settings
from app.models import AppSetting
from app.services import assistant_models

SETTINGS_URL = "/api/v1/assistant/settings"
MODELS_URL = "/api/v1/assistant/models"


@pytest.fixture(autouse=True)
def _no_env_key(monkeypatch):
    # Cache + transport hygiene is conftest's autouse job (it serves every test module);
    # this only pins the env key off so a developer's real NVIDIA_API_KEY can't turn the
    # "unconfigured" cases below into configured ones.
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


async def test_models_without_a_key_never_probes(auth_client, monkeypatch):
    # No key means there is nothing to ask the catalog ABOUT: the card says "unconfigured",
    # not "unreachable", and no outbound request leaves the box — not even a forced one.
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError(f"no key configured, yet the catalog was probed: {request.url}")

    monkeypatch.setattr(assistant_models, "TRANSPORT_OVERRIDE", httpx.MockTransport(handler))
    r = await auth_client.get(MODELS_URL + "?probe=1")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["key_source"] is None
    assert body["key_ok"] is None  # null, NOT false: nothing was checked
    assert body["checked_at"] is None


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


async def test_put_clearing_the_key_also_resets_the_probe_cache(auth_client, db, monkeypatch):
    # The sibling of the case above, and the one easy to get wrong: CLEARING the override
    # changes the effective key just as much as setting one (it falls back to env), so the
    # cached verdict is about a key that is no longer in use.
    monkeypatch.setattr(settings, "nvidia_api_key", "nvapi-env")
    db.add(AppSetting(key="nvidia_api_key", value={"value": "nvapi-override"}))
    await db.commit()
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.headers["Authorization"])
        return httpx.Response(200, json={"data": []})

    monkeypatch.setattr(assistant_models, "TRANSPORT_OVERRIDE", httpx.MockTransport(handler))
    await auth_client.get(MODELS_URL)  # fills the cache under the override key
    r = await auth_client.put(SETTINGS_URL, json={"api_key": None})
    assert r.json()["key"] == {"configured": True, "source": "env"}
    await auth_client.get(MODELS_URL)
    # Two probes, and the second one carried the env key: the reset really did fire.
    assert seen == ["Bearer nvapi-override", "Bearer nvapi-env"]


async def test_the_key_reset_lands_after_the_commit(auth_client, monkeypatch):
    # Ordering is the invariant, not a style point: resetting BEFORE the write is durable
    # re-opens the window the generation guard closed — a probe kicked off in that gap
    # reads the OLD key and is free to cache its verdict against the new generation.
    events: list[str] = []
    real_commit = AsyncSession.commit

    async def spy_commit(self: AsyncSession) -> None:
        events.append("commit")
        await real_commit(self)

    monkeypatch.setattr(AsyncSession, "commit", spy_commit)
    monkeypatch.setattr(assistant_api, "reset_catalog_cache", lambda: events.append("reset"))
    r = await auth_client.put(SETTINGS_URL, json={"api_key": "nvapi-typed"})
    assert r.status_code == 200, r.text
    assert events == ["commit", "reset"]
