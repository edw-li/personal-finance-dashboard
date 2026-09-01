"""assistant_chat service + (B8) endpoint. The fake NVIDIA upstream is an
httpx.MockTransport streaming OpenAI-format SSE chunks."""

import asyncio
import json

import httpx
import pytest

from app.config import settings
from app.services import assistant_chat, assistant_models
from app.services.assistant_chat import _with_keepalive, stream_chat, system_prompt


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
