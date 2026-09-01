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
        "Prefer asterisk emphasis (*italic*, **bold**) over underscores; the renderer does "
        "not parse underscore emphasis.",
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
        # A proxy / captive portal can answer any shape at all (the probe_catalog
        # precedent) — .get() on a JSON list would AttributeError straight out of the
        # generator, killing the stream with no error frame at all.
        raw = parsed.get("detail") or parsed.get("error") if isinstance(parsed, dict) else None
        # NVIDIA spells errors {"error": {"message": ...}}; unwrap to the sentence.
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
    client: httpx.AsyncClient,
    api_key: str,
    catalog_id: str,
    messages: list[dict],
    tools_enabled: bool,
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
                    slot = calls.setdefault(index, {"id": None, "name": "", "arguments": ""})
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
            yield sse(
                "error", {"kind": "internal", "message": "The answer ran past its time budget."}
            )
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
            if not isinstance(args, dict):
                # A model can stream a bare list/scalar as `arguments`; .items() on that
                # would AttributeError out of the generator and kill the stream. Normalize
                # ONCE, before the summary reads it — the tool then reports the bad call.
                args = {}
            summary = ", ".join(f"{k}={v}" for k, v in list(args.items())[:3]) or "no args"
            yield sse("tool_start", {"name": call["name"], "summary": summary})
            result = await execute_tool(db, call["name"], args)
            if "error" in result:
                # A tool that died mid-statement leaves the session in a failed transaction;
                # every later tool in this conversation would then raise instead of answering.
                # Harmless on a clean session — the tools are read-only.
                try:
                    await db.rollback()
                except Exception:  # pragma: no cover - a session too broken to reset
                    logger.exception("assistant: rollback after tool error failed")
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
    yield sse(
        "error",
        {"kind": "internal", "message": "The model never finished within the round budget."},
    )


async def stream_chat(*, model_key: str, messages: list[dict], context: dict) -> AsyncIterator[str]:
    async with SESSION_FACTORY() as db:
        api_key, _source = await resolve_api_key(db)
        if api_key is None:
            yield sse(
                "error",
                {
                    "kind": "bad_key",
                    "message": "No NVIDIA API key is configured — set one in Settings.",
                },
            )
            return
        requested = registry_entry(model_key)
        if requested is None:  # the router already 422s; belt for direct callers
            yield sse(
                "error", {"kind": "bad_request", "message": f"unknown model key: {model_key}"}
            )
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
                    async for frame in _converse(
                        db, client, api_key, model, base_messages, forwarded
                    ):
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
