"""Registry, key precedence, and the catalog probe (spec §3–§4)."""

import asyncio
import re
import time

import httpx
import pytest
from pydantic import ValidationError

from app.config import settings
from app.models import AppSetting
from app.schemas.assistant import ChatContextIn, ChatIn, ChatMessageIn
from app.services import assistant_models
from app.services.assistant_models import (
    DEFAULT_MODEL_KEY,
    REGISTRY,
    probe_catalog,
    registry_entry,
    resolve_api_key,
    resolve_catalog_id,
    resolve_default_model,
)


@pytest.fixture(autouse=True)
def _no_env_key(monkeypatch):
    # Cache + transport hygiene is conftest's autouse job (it serves every test module);
    # this only pins the env key off so a developer's real NVIDIA_API_KEY can't decide
    # the precedence asserts below.
    monkeypatch.setattr(settings, "nvidia_api_key", None)


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


def _no_request_expected(request: httpx.Request) -> httpx.Response:
    raise AssertionError(f"the cache should have answered; nothing may be sent: {request.url}")


def _counting_transport(calls: dict[str, int], status: int = 200) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(status, json={"data": []})

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


@pytest.mark.parametrize("payload", [["moonshotai/kimi-k3"], {"data": 5}])
async def test_a_200_of_any_shape_is_a_good_key_with_no_models(payload, monkeypatch):
    # A proxy or captive portal can answer 200 with anything; the status decides key_ok,
    # the shape only decides ids — and neither may raise.
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json=payload))
    monkeypatch.setattr(assistant_models, "TRANSPORT_OVERRIDE", transport)
    key_ok, ids, _at = await probe_catalog("k", force=True)
    assert key_ok is True
    assert ids == frozenset()


async def test_probe_cache_serves_within_ttl_and_force_bypasses(monkeypatch):
    calls = {"n": 0}
    monkeypatch.setattr(assistant_models, "TRANSPORT_OVERRIDE", _counting_transport(calls))
    await probe_catalog("k", force=True)
    await probe_catalog("k", force=False)  # served from cache
    assert calls["n"] == 1
    await probe_catalog("k", force=True)
    assert calls["n"] == 2


async def test_cache_expires_after_the_ttl(monkeypatch):
    calls = {"n": 0}
    monkeypatch.setattr(assistant_models, "TRANSPORT_OVERRIDE", _counting_transport(calls))
    monkeypatch.setattr(assistant_models, "CATALOG_TTL_SECONDS", 0.0)
    await probe_catalog("k", force=True)
    await probe_catalog("k", force=False)
    assert calls["n"] == 2


async def test_cached_read_reports_the_original_checked_at(monkeypatch):
    # Seeded rather than probed twice: Windows' ~15.6ms clock granularity makes two live
    # reads land on the SAME time.time() anyway, so a two-probe version passes even when
    # the stamp is re-taken on every read. A backdated stamp can only survive by being
    # returned from the cache — and the guard transport turns a cache MISS into an
    # instant, legible failure instead of a real outbound request.
    monkeypatch.setattr(
        assistant_models,
        "TRANSPORT_OVERRIDE",
        httpx.MockTransport(_no_request_expected),
    )
    seeded_at = time.time() - 1.0
    # monkeypatch, not a raw assignment: the seed then unwinds with the test even if an
    # assert below fires first (conftest's autouse reset covers the next test either way).
    monkeypatch.setattr(
        assistant_models, "_catalog_cache", (seeded_at, True, frozenset({"sentinel"}))
    )
    key_ok, ids, checked_at = await probe_catalog("k", force=False)
    assert (key_ok, ids) == (True, frozenset({"sentinel"}))
    assert checked_at == seeded_at  # the card must not claim a check it never made


async def test_a_failed_probe_retries_on_the_short_failure_ttl(monkeypatch):
    calls = {"n": 0}
    monkeypatch.setattr(assistant_models, "TRANSPORT_OVERRIDE", _counting_transport(calls, 401))
    # Only the FAILURE ttl is shortened here: a cached success would still be served,
    # so this pins that the expiry keys on key_ok rather than on a smaller number.
    monkeypatch.setattr(assistant_models, "CATALOG_FAILURE_TTL_SECONDS", 0.0)
    await probe_catalog("k", force=True)
    await probe_catalog("k", force=False)
    assert calls["n"] == 2


async def test_a_reset_mid_probe_discards_the_stale_verdict(monkeypatch):
    started, gate = asyncio.Event(), asyncio.Event()

    async def handler(request: httpx.Request) -> httpx.Response:
        started.set()
        await gate.wait()
        return httpx.Response(200, json={"data": [{"id": "stale"}]})

    monkeypatch.setattr(assistant_models, "TRANSPORT_OVERRIDE", httpx.MockTransport(handler))
    in_flight = asyncio.create_task(probe_catalog("k", force=True))
    await started.wait()
    assistant_models.reset_catalog_cache()  # a key change lands while the probe is parked
    gate.set()
    _ok, ids, _at = await in_flight
    assert ids == frozenset({"stale"})  # the caller still gets the answer it asked for

    # ...but that answer was about the OLD key, so nothing was cached: the next unforced
    # read re-probes instead of serving "stale".
    monkeypatch.setattr(assistant_models, "TRANSPORT_OVERRIDE", _catalog_transport(["fresh"]))
    _ok, ids, _at = await probe_catalog("k", force=False)
    assert ids == frozenset({"fresh"})


async def test_http_client_follows_settings_and_tolerates_a_blank_ca_bundle(monkeypatch):
    monkeypatch.setattr(settings, "nvidia_base_url", "https://catalog.test/v1")
    # No transport override here, so this builds a REAL SSL context: verify="   " would
    # raise FileNotFoundError before any request could be made.
    monkeypatch.setattr(settings, "nvidia_ca_bundle", "   ")
    async with assistant_models.http_client(1.0) as client:
        # httpx normalizes base_url with a trailing slash; "/models" still joins to /v1/models.
        assert str(client.base_url) == "https://catalog.test/v1/"


def test_chat_schema_bounds_reject_an_empty_or_oversized_request():
    context = ChatContextIn(route="/spending")
    message = ChatMessageIn(role="user", content="where did the money go?")
    ChatIn(model="kimi-k3", context=context, messages=[message])  # the shape that must pass
    with pytest.raises(ValidationError):
        ChatIn(model="kimi-k3", context=context, messages=[])  # nothing to answer
    with pytest.raises(ValidationError):
        ChatIn(model="m" * 61, context=context, messages=[message])


def test_context_dicts_are_item_capped():
    with pytest.raises(ValidationError):
        ChatContextIn(route="/spending", search={str(i): "v" for i in range(41)})
    with pytest.raises(ValidationError):
        ChatContextIn(route="/spending", view={str(i): i for i in range(41)})


# --- catalog matching (self-healing ids) ------------------------------------------------


def _model(key: str = "nemotron-3-ultra-550b"):
    entry = registry_entry(key)
    assert entry is not None
    return entry


def test_an_exact_catalog_id_always_wins():
    model = _model()
    # The bare id also matches the pattern AND is shorter; the registry spelling still wins.
    ids = frozenset({model.catalog_id, "nvidia/nemotron-3-ultra"})
    assert resolve_catalog_id(model, ids) == model.catalog_id


def test_a_renamed_id_resolves_by_pattern():
    model = _model()
    assert (
        resolve_catalog_id(model, frozenset({"nvidia/nemotron-3-ultra-550b-v1.2"}))
        == "nvidia/nemotron-3-ultra-550b-v1.2"
    )


def test_the_shortest_pattern_match_wins_as_the_canonical_id():
    """A catalog lists the base model beside its quantized/instruct siblings; the base
    spelling is the short one, and it is the one a plain chat request wants."""
    model = _model()
    ids = frozenset(
        {
            "nvidia/nemotron-3-ultra-550b-v1.2",
            "nvidia/nemotron-3-ultra-550b-instruct-fp8",
            "nvidia/nemotron-3-ultra-550b-base-nim-latest",
        }
    )
    assert resolve_catalog_id(model, ids) == "nvidia/nemotron-3-ultra-550b-v1.2"


def test_equal_length_matches_break_alphabetically():
    # Two equally short candidates must resolve deterministically, or the chosen model
    # would flap between page loads.
    model = _model()
    ids = frozenset({"nvidia/nemotron-3-ultra-550c", "nvidia/nemotron-3-ultra-550b"})
    assert resolve_catalog_id(model, ids) == "nvidia/nemotron-3-ultra-550b"


def test_matching_ignores_case():
    model = _model()
    assert (
        resolve_catalog_id(model, frozenset({"NVIDIA/Nemotron-3-Ultra-550B-V2"}))
        == "NVIDIA/Nemotron-3-Ultra-550B-V2"
    )


def test_nothing_matching_resolves_to_none():
    assert resolve_catalog_id(_model(), frozenset({"meta/llama-4-70b"})) is None
    assert resolve_catalog_id(_model(), frozenset()) is None


def test_every_catalog_id_also_matches_its_own_patterns():
    """Exact id and patterns must describe the SAME model: if a verified id is edited to
    something the patterns no longer recognize, the safety net silently stops covering it."""
    for model in REGISTRY:
        assert any(
            re.search(pattern, model.catalog_id, re.IGNORECASE)
            for pattern in model.catalog_patterns
        ), model.key


def test_every_registry_pattern_matches_its_own_id_and_a_renamed_one():
    # The guard that keeps a typo'd pattern from silently reading as "unavailable".
    for model in REGISTRY:
        assert resolve_catalog_id(model, frozenset({model.catalog_id})) == model.catalog_id
        renamed = f"{model.catalog_id}-v1.2"
        assert resolve_catalog_id(model, frozenset({renamed})) == renamed


def test_no_pattern_poaches_another_registry_models_id():
    # Cross-talk would answer on a model the user did not pick and never say so.
    for model in REGISTRY:
        others = frozenset(o.catalog_id for o in REGISTRY if o.key != model.key)
        assert resolve_catalog_id(model, others) is None
