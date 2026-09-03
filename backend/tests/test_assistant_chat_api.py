"""assistant_chat service + (B8) endpoint. The fake NVIDIA upstream is an
httpx.MockTransport streaming OpenAI-format SSE chunks."""

import asyncio
import json
import time

import httpx
import pytest

from app.config import settings
from app.services import assistant_chat, assistant_models
from app.services.assistant_chat import _with_keepalive, stream_chat, system_prompt

# Captured at import, BEFORE the autouse fixture zeroes it to keep the suite quick.
PRODUCTION_RETRY_DELAY = assistant_chat.RETRY_DELAY_SECONDS


@pytest.fixture(autouse=True)
def _wire(monkeypatch, engine):
    # The stream owns its session (plan fact 1): point its factory at the test engine.
    from sqlalchemy.ext.asyncio import async_sessionmaker

    monkeypatch.setattr(
        assistant_chat, "SESSION_FACTORY", async_sessionmaker(engine, expire_on_commit=False)
    )
    monkeypatch.setattr(settings, "nvidia_api_key", "nvapi-test")
    assistant_models.reset_catalog_cache()
    # In production the drawer's /models call has already filled the probe cache, so the
    # stream resolves catalog ids without an outbound hop. Seed the identity catalog here:
    # these tests are about the loop, and an unseeded cache would send every fake upstream
    # a /models request it was never written to answer. Tests that care about resolution
    # re-seed with _seed_catalog.
    _seed_catalog(monkeypatch, [m.catalog_id for m in assistant_models.REGISTRY])
    # The same-rung retry sleeps 1.5 s in production; tests pin the behavior, not the wait.
    monkeypatch.setattr(assistant_chat, "RETRY_DELAY_SECONDS", 0.0)


def _seed_catalog(monkeypatch, ids: list[str], *, key_ok: bool = True) -> None:
    """Pin the catalog verdict stream_chat reads (the private cache is the same seam
    test_assistant_models seeds through)."""
    monkeypatch.setattr(assistant_models, "_catalog_cache", (time.time(), key_ok, frozenset(ids)))


def _openai_stream(chunks: list[dict]) -> str:
    lines = [f"data: {json.dumps(c)}" for c in chunks]
    lines.append("data: [DONE]")
    return "\n\n".join(lines) + "\n\n"


def _delta(content: str) -> dict:
    return {"choices": [{"delta": {"content": content}, "finish_reason": None}]}


def _reasoning(text: str, field: str = "reasoning_content") -> dict:
    """A reasoning delta. Kimi K3 streams these BEFORE any content (verified against the
    live endpoint), which is exactly the silence the thinking event fills."""
    return {"choices": [{"delta": {field: text}, "finish_reason": None}]}


def _finish(reason: str = "stop") -> dict:
    return {"choices": [{"delta": {}, "finish_reason": reason}]}


def _tool_call_chunk(call_id: str, name: str, arguments: dict) -> dict:
    return {
        "choices": [
            {
                "delta": {
                    "tool_calls": [
                        {
                            "index": 0,
                            "id": call_id,
                            "function": {"name": name, "arguments": json.dumps(arguments)},
                        }
                    ]
                },
                "finish_reason": None,
            }
        ]
    }


def _multi_tool_chunk(count: int) -> dict:
    """One delta asking for `count` get_page_data calls at once."""
    return {
        "choices": [
            {
                "delta": {
                    "tool_calls": [
                        {
                            "index": i,
                            "id": f"call_{i}",
                            "function": {
                                "name": "get_page_data",
                                "arguments": json.dumps({"page": "/calendar"}),
                            },
                        }
                        for i in range(count)
                    ]
                },
                "finish_reason": None,
            }
        ]
    }


def _transport(responder) -> httpx.MockTransport:
    return httpx.MockTransport(responder)


async def _collect(agen) -> list[str]:
    return [item async for item in agen]


def _all_events(frames: list[str]) -> list[tuple[str, dict]]:
    out = []
    for frame in frames:
        if frame.startswith(":"):
            continue
        lines = frame.strip().split("\n")
        event = lines[0].removeprefix("event: ")
        payload = json.loads(lines[1].removeprefix("data: "))
        out.append((event, payload))
    return out


def _events(frames: list[str]) -> list[tuple[str, dict]]:
    """Substantive events only. `status` narrates EVERY stream, so leaving it in would
    smear progress chrome across every sequence assert in this module; the tests that pin
    where the narration lands read _all_events instead."""
    return [item for item in _all_events(frames) if item[0] != "status"]


def _statuses(frames: list[str]) -> list[str]:
    return [payload["text"] for event, payload in _all_events(frames) if event == "status"]


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


async def test_malformed_tool_arguments_report_back_instead_of_crashing(monkeypatch):
    """`arguments` that parse to a bare list (or not at all) must reach the tool as {} —
    summarizing them with .items() would AttributeError out of the generator."""
    rounds = {"n": 0}

    def responder(request: httpx.Request) -> httpx.Response:
        rounds["n"] += 1
        if rounds["n"] == 1:
            chunk = {
                "choices": [
                    {
                        "delta": {
                            "tool_calls": [
                                {
                                    "index": 0,
                                    "id": "call_1",
                                    "function": {"name": "get_page_data", "arguments": "[1, 2]"},
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
        return httpx.Response(
            200,
            text=_openai_stream([_delta("sorry"), _finish()]),
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
    assert [e for e, _ in events] == ["tool_start", "tool_result", "token", "done"]
    assert events[0][1]["summary"] == "no args"
    assert events[1][1]["summary"] == "error"  # the tool, not the stream, rejects the call


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
    assert events[0] == (
        "notice",
        {"kind": "failover", "from": "kimi-k3", "to": "deepseek-v4-pro-0813"},
    )
    assert events[-1][0] == "done"
    assert events[-1][1]["model_used"] != "kimi-k3"


async def test_failover_never_fires_once_a_token_was_forwarded(monkeypatch):
    """THE invariant: the ladder may only walk before the user has seen text. Round 1
    forwards a token AND asks for a tool; round 2 dies — that is a mid-answer failure,
    reported as-is. Restarting on another model would replay a half-written answer."""
    seen_models: list[str] = []
    rounds = {"n": 0}

    def responder(request: httpx.Request) -> httpx.Response:
        seen_models.append(json.loads(request.content)["model"])
        rounds["n"] += 1
        if rounds["n"] == 1:
            return httpx.Response(
                200,
                text=_openai_stream(
                    [
                        _delta("partial"),
                        _tool_call_chunk("call_1", "get_page_data", {"page": "/calendar"}),
                        _finish("tool_calls"),
                    ]
                ),
                headers={"content-type": "text/event-stream"},
            )
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
    assert kinds == ["token", "tool_start", "tool_result", "error"]
    assert "notice" not in kinds  # no failover notice anywhere
    assert events[-1][1]["kind"] == "unavailable"
    assert "failed mid-answer" in events[-1][1]["message"]
    assert seen_models == ["moonshotai/kimi-k3", "moonshotai/kimi-k3"]  # rung 2 never called


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


async def test_nvidia_error_envelope_becomes_the_message(monkeypatch):
    def responder(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": {"message": "invalid api key provided"}})

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
    assert events == [("error", {"kind": "bad_key", "message": "invalid api key provided"})]


async def test_a_non_dict_error_body_still_yields_an_error_frame(monkeypatch):
    # A proxy/captive portal answering with a JSON list must not crash the generator.
    def responder(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json=["nope"])

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
    assert [e for e, _ in events] == ["error"]
    assert events[0][1]["kind"] == "internal"  # a 400 is not a key problem


async def test_400_is_internal_not_bad_key(monkeypatch):
    """A context-length rejection must not send the user to Settings to 'fix' a key that
    works — bad_key deep-links there and suppresses retry."""

    def responder(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            400, json={"error": {"message": "maximum context length is 131072 tokens"}}
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
    assert events == [
        ("error", {"kind": "internal", "message": "maximum context length is 131072 tokens"})
    ]


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


async def test_round_budget_ends_an_endless_tool_loop(monkeypatch):
    rounds = {"n": 0}

    def responder(request: httpx.Request) -> httpx.Response:
        rounds["n"] += 1
        return httpx.Response(
            200,
            text=_openai_stream(
                [
                    _tool_call_chunk(f"call_{rounds['n']}", "get_page_data", {"page": "/calendar"}),
                    _finish("tool_calls"),
                ]
            ),
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
    assert rounds["n"] == assistant_chat.MAX_ROUNDS  # the loop is bounded, not endless
    assert events[-1][0] == "error"
    assert events[-1][1]["kind"] == "internal"


async def test_tool_call_budget_stops_a_greedy_round(monkeypatch):
    def responder(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            text=_openai_stream(
                [_multi_tool_chunk(assistant_chat.MAX_TOOL_CALLS + 1), _finish("tool_calls")]
            ),
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
    # Not one tool ran: the budget is checked before the round's calls are executed.
    assert [e for e, _ in events] == ["error"]
    assert events[0][1]["kind"] == "internal"


async def test_the_tool_budget_spans_the_ladder_not_each_model(monkeypatch):
    """Spec §5 budgets six tool calls for the ANSWER. A failover must inherit what the
    previous rung already spent, or a four-model ladder quietly buys 24."""
    calls = {"a": 0, "b": 0}

    def tools(count: int) -> httpx.Response:
        return httpx.Response(
            200,
            text=_openai_stream([_multi_tool_chunk(count), _finish("tool_calls")]),
            headers={"content-type": "text/event-stream"},
        )

    def responder(request: httpx.Request) -> httpx.Response:
        if json.loads(request.content)["model"] == "moonshotai/kimi-k3":
            calls["a"] += 1
            if calls["a"] == 1:
                return tools(4)  # spends 4 of 6
            return httpx.Response(503, text="down")  # pre-token, so the ladder may walk
        calls["b"] += 1
        return tools(3)  # 4 + 3 > 6 — must not run

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
    assert kinds.count("tool_start") == 4  # only the first rung's four ever executed
    assert kinds.count("notice") == 1
    assert events[-1][0] == "error"
    assert events[-1][1]["kind"] == "internal"
    assert "past the budget" in events[-1][1]["message"]
    assert calls["b"] == 1  # the second rung asked once and was cut off


async def test_time_budget_ends_the_conversation(monkeypatch):
    def responder(request: httpx.Request) -> httpx.Response:  # pragma: no cover - never called
        raise AssertionError("the time budget should have fired before any upstream call")

    monkeypatch.setattr(assistant_models, "TRANSPORT_OVERRIDE", _transport(responder))
    monkeypatch.setattr(assistant_chat, "TOTAL_BUDGET_SECONDS", -1.0)
    events = _events(
        await _collect(
            stream_chat(
                model_key="kimi-k3",
                messages=[{"role": "user", "content": "q"}],
                context={"route": "/", "search": {}, "view": {}},
            )
        )
    )
    assert events == [("error", {"kind": "internal", "message": events[0][1]["message"]})]
    assert "time budget" in events[0][1]["message"]


def test_system_prompt_steers_markdown_emphasis_to_asterisks():
    # F2 carry: the chat renderer does not parse underscore emphasis, so the model must
    # never reach for _italic_ / __bold__.
    prompt = system_prompt("{}", True)
    assert "asterisk emphasis" in prompt
    assert "underscore" in prompt


async def test_tool_error_rolls_back_so_a_later_tool_still_works(monkeypatch):
    """B6 carry: a tool that dies mid-statement leaves the session in a failed
    transaction; without a rollback every later tool in the same conversation would
    raise PendingRollbackError instead of answering."""
    from sqlalchemy import text

    from app.services import assistant_tools

    async def poisoning_page_data(db, args):
        await db.execute(text("SELECT * FROM table_that_does_not_exist"))
        return {}  # never reached

    monkeypatch.setattr(assistant_tools, "_get_page_data", poisoning_page_data)

    rounds = {"n": 0}
    tool_messages: list[dict] = []

    def responder(request: httpx.Request) -> httpx.Response:
        rounds["n"] += 1
        body = json.loads(request.content)
        tool_messages[:] = [m for m in body["messages"] if m.get("role") == "tool"]
        if rounds["n"] == 1:
            chunk = _tool_call_chunk("call_1", "get_page_data", {"page": "/calendar"})
        elif rounds["n"] == 2:
            chunk = _tool_call_chunk("call_2", "get_month_detail", {"month": "2026-08-01"})
        else:
            return httpx.Response(
                200,
                text=_openai_stream([_delta("recovered"), _finish()]),
                headers={"content-type": "text/event-stream"},
            )
        return httpx.Response(
            200,
            text=_openai_stream([chunk, _finish("tool_calls")]),
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
    assert [e for e, _ in events] == [
        "tool_start",
        "tool_result",
        "tool_start",
        "tool_result",
        "token",
        "done",
    ]
    assert events[1][1]["summary"] == "error"  # the failure went back to the model as a result
    assert events[3][1]["summary"] == "ok"  # ... and the session was usable again
    assert len(tool_messages) == 2
    assert "error" in json.loads(tool_messages[0]["content"])
    assert json.loads(tool_messages[1]["content"])["month"] == "2026-08-01"


# --- resolved catalog ids (self-healing against a renamed model) -------------------------


async def test_the_request_carries_the_resolved_catalog_id(monkeypatch):
    """The morning's real-key finding: the live catalog spells Nemotron with a suffix the
    registry guessed without. The chat request must use the id the catalog really lists."""
    seen: list[str] = []

    def responder(request: httpx.Request) -> httpx.Response:
        seen.append(json.loads(request.content)["model"])
        return httpx.Response(
            200,
            text=_openai_stream([_delta("hi"), _finish()]),
            headers={"content-type": "text/event-stream"},
        )

    _seed_catalog(monkeypatch, ["nvidia/nemotron-3-ultra-550b-v1.2"])
    monkeypatch.setattr(assistant_models, "TRANSPORT_OVERRIDE", _transport(responder))
    events = _events(
        await _collect(
            stream_chat(
                model_key="nemotron-3-ultra-550b",
                messages=[{"role": "user", "content": "q"}],
                context={"route": "/", "search": {}, "view": {}},
            )
        )
    )
    assert seen == ["nvidia/nemotron-3-ultra-550b-v1.2"]
    assert events[-1] == ("done", {"model_used": "nemotron-3-ultra-550b"})


async def test_an_unresolvable_rung_is_skipped_by_the_ladder(monkeypatch):
    """A rung the catalog does not list would only 404 — spending a failover notice (and a
    round trip) on it is dead air the user pays for."""
    seen: list[str] = []

    def responder(request: httpx.Request) -> httpx.Response:
        model = json.loads(request.content)["model"]
        seen.append(model)
        if model.startswith("moonshotai/"):
            return httpx.Response(503, text="down")
        return httpx.Response(
            200,
            text=_openai_stream([_delta("fallback"), _finish()]),
            headers={"content-type": "text/event-stream"},
        )

    # DeepSeek and Lightning are simply not in this catalog.
    _seed_catalog(monkeypatch, ["moonshotai/kimi-k3", "nvidia/nemotron-3-ultra-550b-v1.2"])
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
    assert not any("deepseek" in m for m in seen)  # never asked, not even once
    assert seen == [
        "moonshotai/kimi-k3",  # first try
        "moonshotai/kimi-k3",  # the same-rung retry
        "nvidia/nemotron-3-ultra-550b-v1.2",  # then straight past the unlisted rungs
    ]
    assert events[0] == (
        "notice",
        {"kind": "failover", "from": "kimi-k3", "to": "nemotron-3-ultra-550b"},
    )
    assert events[-1] == ("done", {"model_used": "nemotron-3-ultra-550b"})


async def test_a_skipped_requested_model_is_announced_with_a_notice(monkeypatch):
    """Skipping the user's own pick is the one skip that needs words: answering on a
    model they did not choose, silently, is indistinguishable from a wrong answer. Same
    grammar as a mid-flight failover, so the drawer's existing line already reads it:
    "Answered by Nemotron 3 Ultra 550B — Kimi K3 was unavailable"."""
    seen: list[str] = []

    def responder(request: httpx.Request) -> httpx.Response:
        seen.append(json.loads(request.content)["model"])
        return httpx.Response(
            200,
            text=_openai_stream([_delta("hi"), _finish()]),
            headers={"content-type": "text/event-stream"},
        )

    # The catalog has no Kimi and no DeepSeek at all.
    _seed_catalog(monkeypatch, ["nvidia/nemotron-3-ultra-550b-v1.2"])
    monkeypatch.setattr(assistant_models, "TRANSPORT_OVERRIDE", _transport(responder))
    frames = await _collect(
        stream_chat(
            model_key="kimi-k3",
            messages=[{"role": "user", "content": "q"}],
            context={"route": "/", "search": {}, "view": {}},
        )
    )
    events = _all_events(frames)
    assert events[0][0] == "status"  # the opening narration still leads
    assert events[1] == (
        "notice",
        {"kind": "failover", "from": "kimi-k3", "to": "nemotron-3-ultra-550b"},
    )
    # ...and it lands BEFORE the rung announces itself, so the two read as one sentence.
    assert events[2] == ("status", {"text": "Asking Nemotron 3 Ultra 550B…"})
    assert not any("kimi" in model for model in seen)  # never asked, just accounted for
    assert events[-1] == ("done", {"model_used": "nemotron-3-ultra-550b"})


async def test_a_failed_probe_falls_back_to_the_registry_spelling(monkeypatch):
    """No verdict is not the same as "not listed": an unreachable catalog must leave the
    loop exactly as it behaved before resolution existed."""
    assistant_models.reset_catalog_cache()  # undo the fixture's seed: a cold, failing probe
    probes = {"n": 0}
    seen: list[str] = []

    def responder(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/models"):
            probes["n"] += 1
            return httpx.Response(500, text="catalog down")
        seen.append(json.loads(request.content)["model"])
        return httpx.Response(
            200,
            text=_openai_stream([_delta("hi"), _finish()]),
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
    assert probes["n"] == 1  # one probe for the whole stream, not one per rung
    assert seen == ["moonshotai/kimi-k3"]
    assert events[-1] == ("done", {"model_used": "kimi-k3"})


async def test_the_ladder_never_empties_when_nothing_resolves(monkeypatch):
    """A catalog that matches no registry pattern (a wholesale rename) must still produce
    an attempt — the requested model, spelled the way the registry knows it."""
    seen: list[str] = []

    def responder(request: httpx.Request) -> httpx.Response:
        seen.append(json.loads(request.content)["model"])
        return httpx.Response(
            200,
            text=_openai_stream([_delta("hi"), _finish()]),
            headers={"content-type": "text/event-stream"},
        )

    _seed_catalog(monkeypatch, ["meta/llama-4-70b"])
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
    assert seen == ["moonshotai/kimi-k3"]
    assert "notice" not in [e for e, _ in events]  # nothing was skipped, so nothing to say
    assert events[-1] == ("done", {"model_used": "kimi-k3"})


# --- progress narration ------------------------------------------------------------------


async def test_the_first_frame_is_a_status_before_any_upstream_work(monkeypatch):
    """The reported symptom: dead air between Send and the first token. Something must
    land immediately, before the context build and the upstream call."""

    def responder(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            text=_openai_stream([_delta("hi"), _finish()]),
            headers={"content-type": "text/event-stream"},
        )

    monkeypatch.setattr(assistant_models, "TRANSPORT_OVERRIDE", _transport(responder))
    frames = await _collect(
        stream_chat(
            model_key="kimi-k3",
            messages=[{"role": "user", "content": "q"}],
            context={"route": "/", "search": {}, "view": {}},
        )
    )
    events = _all_events(frames)
    assert events[0] == ("status", {"text": "Reading the page's data…"})
    kinds = [e for e, _ in events]
    assert kinds.index("status") < kinds.index("token")  # narration leads the answer


async def test_status_narrates_every_round_and_the_tool_pause(monkeypatch):
    rounds = {"n": 0}

    def responder(request: httpx.Request) -> httpx.Response:
        rounds["n"] += 1
        if rounds["n"] == 1:
            return httpx.Response(
                200,
                text=_openai_stream(
                    [
                        _tool_call_chunk("call_1", "get_page_data", {"page": "/calendar"}),
                        _finish("tool_calls"),
                    ]
                ),
                headers={"content-type": "text/event-stream"},
            )
        return httpx.Response(
            200,
            text=_openai_stream([_delta("answer"), _finish()]),
            headers={"content-type": "text/event-stream"},
        )

    monkeypatch.setattr(assistant_models, "TRANSPORT_OVERRIDE", _transport(responder))
    frames = await _collect(
        stream_chat(
            model_key="kimi-k3",
            messages=[{"role": "user", "content": "q"}],
            context={"route": "/", "search": {}, "view": {}},
        )
    )
    assert [e for e, _ in _all_events(frames)] == [
        "status",
        "status",
        "tool_start",
        "tool_result",
        "status",
        "token",
        "done",
    ]
    assert _statuses(frames) == [
        "Reading the page's data…",
        "Asking Kimi K3…",
        "Kimi K3 is continuing…",
    ]


# --- reasoning (thinking) deltas ----------------------------------------------------------


@pytest.mark.parametrize("field", ["reasoning_content", "reasoning"])
async def test_reasoning_deltas_stream_as_thinking_before_the_answer(field, monkeypatch):
    def responder(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            text=_openai_stream(
                [
                    _reasoning("weighing ", field),
                    _reasoning("the numbers", field),
                    _delta("Spending fell."),
                    _finish(),
                ]
            ),
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
    assert [e for e, _ in events] == ["thinking", "thinking", "token", "done"]
    assert [p["text"] for e, p in events if e == "thinking"] == ["weighing ", "the numbers"]
    assert events[2][1] == {"text": "Spending fell."}


async def test_thinking_never_enters_the_upstream_history(monkeypatch):
    """Reasoning is display-only: replaying it as assistant content would double the bill
    and invite the model to answer its own scratchpad."""
    bodies: list[dict] = []

    def responder(request: httpx.Request) -> httpx.Response:
        bodies.append(json.loads(request.content))
        if len(bodies) == 1:
            return httpx.Response(
                200,
                text=_openai_stream(
                    [
                        _reasoning("SCRATCH"),
                        _delta("partial"),
                        _tool_call_chunk("call_1", "get_page_data", {"page": "/calendar"}),
                        _finish("tool_calls"),
                    ]
                ),
                headers={"content-type": "text/event-stream"},
            )
        return httpx.Response(
            200,
            text=_openai_stream([_delta("done"), _finish()]),
            headers={"content-type": "text/event-stream"},
        )

    monkeypatch.setattr(assistant_models, "TRANSPORT_OVERRIDE", _transport(responder))
    await _collect(
        stream_chat(
            model_key="kimi-k3",
            messages=[{"role": "user", "content": "q"}],
            context={"route": "/", "search": {}, "view": {}},
        )
    )
    assistant_messages = [m for m in bodies[1]["messages"] if m["role"] == "assistant"]
    assert assistant_messages[0]["content"] == "partial"
    assert "SCRATCH" not in json.dumps(bodies[1])


async def test_thinking_does_not_count_as_content_for_the_failover_gate(monkeypatch):
    """A rung that reasons out loud and then dies has shown the user no answer, so the
    ladder is still allowed to walk."""
    kimi_rounds = {"n": 0}

    def responder(request: httpx.Request) -> httpx.Response:
        if json.loads(request.content)["model"] == "moonshotai/kimi-k3":
            kimi_rounds["n"] += 1
            if kimi_rounds["n"] == 1:
                return httpx.Response(
                    200,
                    text=_openai_stream(
                        [
                            _reasoning("hmm", "reasoning"),
                            _tool_call_chunk("call_1", "get_page_data", {"page": "/calendar"}),
                            _finish("tool_calls"),
                        ]
                    ),
                    headers={"content-type": "text/event-stream"},
                )
            return httpx.Response(503, text="down")
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
    assert [e for e, _ in events] == [
        "thinking",
        "tool_start",
        "tool_result",
        "notice",
        "token",
        "done",
    ]
    assert events[-1][1] == {"model_used": "deepseek-v4-pro-0813"}


async def test_a_reasoning_only_round_still_ends_cleanly(monkeypatch):
    """Verified against the live endpoint: Kimi K3 can finish a short round with reasoning
    and content=null. That is an empty answer with visible thinking — not a crash, not a
    failover, and not a silent hang."""

    def responder(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            text=_openai_stream(
                [
                    _reasoning("still pondering"),
                    _finish(),
                ]
            ),
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
    assert [e for e, _ in events] == ["thinking", "done"]
    assert events[-1][1] == {"model_used": "kimi-k3"}


async def test_a_silent_round_narrates_the_wait_then_stops(monkeypatch):
    """DeepSeek's endpoint has been measured silent for 75 s before its first frame. A
    `: ping` comment keeps the socket open but shows the user nothing."""

    async def handler(request: httpx.Request) -> httpx.Response:
        await asyncio.sleep(0.2)
        return httpx.Response(
            200,
            text=_openai_stream([_delta("finally"), _finish()]),
            headers={"content-type": "text/event-stream"},
        )

    monkeypatch.setattr(assistant_chat, "WAIT_STATUS_SECONDS", 0.05)
    monkeypatch.setattr(assistant_models, "TRANSPORT_OVERRIDE", httpx.MockTransport(handler))
    frames = await _collect(
        stream_chat(
            model_key="kimi-k3",
            messages=[{"role": "user", "content": "q"}],
            context={"route": "/", "search": {}, "view": {}},
        )
    )
    events = _all_events(frames)
    waits = [i for i, (e, p) in enumerate(events) if e == "status" and "Still waiting" in p["text"]]
    assert waits, _statuses(frames)
    assert events[waits[0]][1]["text"].startswith("Still waiting on Kimi K3")
    kinds = [e for e, _ in events]
    assert kinds[-2:] == ["token", "done"]
    assert max(waits) < kinds.index("token")  # the narration stops the moment it speaks


# --- same-rung transient retry ------------------------------------------------------------


async def test_a_transient_failure_retries_the_same_model_before_laddering(monkeypatch):
    """A flaky free endpoint 5xxs once and works on the next breath. Switching models for
    that costs a worse answer AND puts a lie in the notice line."""
    attempts = {"n": 0}

    def responder(request: httpx.Request) -> httpx.Response:
        assert json.loads(request.content)["model"] == "moonshotai/kimi-k3"
        attempts["n"] += 1
        if attempts["n"] == 1:
            return httpx.Response(503, text="overloaded")
        return httpx.Response(
            200,
            text=_openai_stream([_delta("second time lucky"), _finish()]),
            headers={"content-type": "text/event-stream"},
        )

    monkeypatch.setattr(assistant_models, "TRANSPORT_OVERRIDE", _transport(responder))
    frames = await _collect(
        stream_chat(
            model_key="kimi-k3",
            messages=[{"role": "user", "content": "q"}],
            context={"route": "/", "search": {}, "view": {}},
        )
    )
    events = _events(frames)
    assert attempts["n"] == 2
    assert [e for e, _ in events] == ["token", "done"]
    assert events[-1][1] == {"model_used": "kimi-k3"}
    assert _statuses(frames).count("Retrying Kimi K3…") == 1
    assert "notice" not in [e for e, _ in _all_events(frames)]  # nothing to apologize for


async def test_the_retry_is_spent_once_and_then_the_ladder_walks(monkeypatch):
    attempts = {"kimi": 0}

    def responder(request: httpx.Request) -> httpx.Response:
        if json.loads(request.content)["model"] == "moonshotai/kimi-k3":
            attempts["kimi"] += 1
            return httpx.Response(503, text="overloaded")
        return httpx.Response(
            200,
            text=_openai_stream([_delta("fallback"), _finish()]),
            headers={"content-type": "text/event-stream"},
        )

    monkeypatch.setattr(assistant_models, "TRANSPORT_OVERRIDE", _transport(responder))
    frames = await _collect(
        stream_chat(
            model_key="kimi-k3",
            messages=[{"role": "user", "content": "q"}],
            context={"route": "/", "search": {}, "view": {}},
        )
    )
    events = _events(frames)
    assert attempts["kimi"] == 2  # tried twice, never a third time
    assert _statuses(frames).count("Retrying Kimi K3…") == 1
    assert [e for e, _ in events] == ["notice", "token", "done"]
    assert events[-1][1] == {"model_used": "deepseek-v4-pro-0813"}


async def test_no_retry_when_the_time_budget_is_nearly_spent(monkeypatch):
    """Sleeping and re-asking costs seconds the answer no longer has; fail over instead."""
    attempts = {"kimi": 0}

    def responder(request: httpx.Request) -> httpx.Response:
        if json.loads(request.content)["model"] == "moonshotai/kimi-k3":
            attempts["kimi"] += 1
            return httpx.Response(503, text="overloaded")
        return httpx.Response(
            200,
            text=_openai_stream([_delta("fallback"), _finish()]),
            headers={"content-type": "text/event-stream"},
        )

    monkeypatch.setattr(assistant_chat, "TOTAL_BUDGET_SECONDS", 3.0)
    monkeypatch.setattr(assistant_models, "TRANSPORT_OVERRIDE", _transport(responder))
    frames = await _collect(
        stream_chat(
            model_key="kimi-k3",
            messages=[{"role": "user", "content": "q"}],
            context={"route": "/", "search": {}, "view": {}},
        )
    )
    assert attempts["kimi"] == 1
    assert not [s for s in _statuses(frames) if s.startswith("Retrying")]
    assert [e for e, _ in _events(frames)] == ["notice", "token", "done"]


def test_the_retry_floor_outlasts_what_a_read_timeout_leaves_behind():
    """The two constants are a pair, not neighbours. A model that hangs until the read
    timeout has spent most of the budget; whatever is left belongs to the NEXT rung, or a
    retry buys a second full-length hang and the answer never lands at all."""
    leftover = assistant_chat.TOTAL_BUDGET_SECONDS - assistant_chat.REQUEST_TIMEOUT.read
    assert leftover < assistant_chat.RETRY_MIN_REMAINING_SECONDS


def test_the_retry_backoff_is_a_real_pause_in_production():
    # The tests zero it; a zero shipped to production would hammer an endpoint that has
    # just said it is overloaded.
    assert PRODUCTION_RETRY_DELAY >= 1.0


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
    r = await auth_client.post(
        PREVIEW_URL, json={"context": {"route": "/", "search": {}, "view": {}}}
    )
    assert r.status_code == 200
    names = [s["name"] for s in r.json()["sections"]]
    assert "household" in names


async def test_tool_result_carries_a_sandbox_link_for_a_what_if(monkeypatch, db):
    """spec §12: the tool_result frame gains `link` when the tool answered with a sandbox_url,
    so the drawer can render "Open in What-if →" under the chip. Tools without one emit no key."""
    from app.models import TaxYear
    from app.seed import seed_tax_definitions

    db.add(TaxYear(year=2026))
    await seed_tax_definitions(db)
    await db.commit()

    calls = {"n": 0}

    def responder(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            chunk = _tool_call_chunk(
                "call_1",
                "run_tax_whatif",
                {"year": 2026, "overrides": {"qualified_dividends": "2500"}},
            )
            return httpx.Response(
                200,
                text=_openai_stream([chunk, _finish("tool_calls")]),
                headers={"content-type": "text/event-stream"},
            )
        return httpx.Response(
            200,
            text=_openai_stream([_delta("done"), _finish()]),
            headers={"content-type": "text/event-stream"},
        )

    monkeypatch.setattr(assistant_models, "TRANSPORT_OVERRIDE", _transport(responder))
    events = _events(
        await _collect(
            stream_chat(
                model_key="kimi-k3",
                messages=[{"role": "user", "content": "what if I had 2500 of dividends?"}],
                context={"route": "/taxes", "search": {}, "view": {"year": 2026}},
            )
        )
    )
    assert [e for e, _ in events] == ["tool_start", "tool_result", "token", "done"]
    assert events[1][1] == {
        "name": "run_tax_whatif",
        "summary": "ok",
        "link": {
            "to": "/taxes?whatif=qualified_dividends%3A2500",
            "label": "Open in What-if →",
        },
    }


async def test_tool_result_without_a_sandbox_url_has_no_link_key(monkeypatch):
    calls = {"n": 0}

    def responder(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(
                200,
                text=_openai_stream(
                    [
                        _tool_call_chunk("call_1", "get_page_data", {"page": "/calendar"}),
                        _finish("tool_calls"),
                    ]
                ),
                headers={"content-type": "text/event-stream"},
            )
        return httpx.Response(
            200,
            text=_openai_stream([_delta("ok"), _finish()]),
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
    assert events[1][1] == {"name": "get_page_data", "summary": "ok"}
