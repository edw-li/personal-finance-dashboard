"""The SSE agent loop (spec §2, §5, §8): call NVIDIA, execute tool calls in-process,
re-prompt, stream typed events. OWNS ITS SESSION — FastAPI ≥0.106 closes yield-deps
before a StreamingResponse body runs, so Depends(get_db) must never reach in here;
tests repoint SESSION_FACTORY at the test engine."""

import asyncio
import json
import logging
import time
from collections.abc import AsyncIterator
from contextlib import aclosing, suppress
from datetime import datetime

import httpx

from app.database import SessionLocal
from app.schemas.metrics import MetricEvidence
from app.services import clock
from app.services.assistant_context import build_context
from app.services.assistant_evidence import (
    captured_month,
    computed_review_intent,
    contribution_pace_bundle,
    mint_bundle,
    month_review_bundle,
    narrative_is_supported,
)
from app.services.assistant_models import (
    REGISTRY,
    AssistantModel,
    http_client,
    probe_catalog,
    registry_entry,
    resolve_api_key,
    resolve_catalog_id,
)
from app.services.assistant_tools import TOOL_SCHEMAS, execute_tool
from app.services.sandbox_links import tool_link

logger = logging.getLogger(__name__)

SESSION_FACTORY = SessionLocal

MAX_ROUNDS = 4
MAX_TOOL_CALLS = 6
TOTAL_BUDGET_SECONDS = 90.0
KEEPALIVE_SECONDS = 15.0
# How long a silent model round goes unnarrated. A `: ping` comment keeps the socket
# alive but is invisible to the user, and a free endpoint can think for a minute before
# its first frame — say so instead of showing dead air.
WAIT_STATUS_SECONDS = 15.0
# Includes reasoning, response headers and tool cycles before any narrative reaches
# the user; transient transport errors may retry, a silent model moves to the next rung.
MODEL_SILENCE_SECONDS = 25.0
# Retry a transient transport failure once, within the same first-output allowance.
RETRY_DELAY_SECONDS = 1.5
# Reserve the final portion of the request budget for the fallback rather than retrying
# the original provider. The tighter first-output deadline still applies to that retry.
RETRY_MIN_REMAINING_SECONDS = 20.0
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
            await asyncio.gather(pending, return_exceptions=True)
        if hasattr(iterator, "aclose"):
            with suppress(RuntimeError, asyncio.CancelledError):
                await iterator.aclose()


class _Retriable(Exception):
    """Connect error / timeout / 5xx / model-missing — the failover ladder's food."""


class _Silent(_Retriable):
    """No useful output within the bounded model allowance; do not retry this rung."""


class _BadKey(Exception):
    def __init__(self, message: str):
        self.message = message


class _RateLimited(Exception):
    def __init__(self, message: str, retry_after: int | None):
        self.message = message
        self.retry_after = retry_after


class _Internal(Exception):
    """A 4xx that is neither a key nor a rate problem — a malformed or oversized request,
    e.g. context-length. NOT _BadKey: the frontend deep-links that one to "fix your key in
    Settings" and suppresses retry, which is a lie about a key that works fine."""

    def __init__(self, message: str):
        self.message = message


def system_prompt(context_json: str, tools_enabled: bool) -> str:
    lines = [
        "You are the analyst inside a self-hosted personal-finance dashboard.",
        f"Today is {clock.product_today().isoformat()}.",
        "Answer ONLY from the CONTEXT JSON below and any tool results — never from general",
        "knowledge of markets, prices, or tax law beyond naming concepts.",
        "Quote figures verbatim with their month or year; write money like $1,234.56.",
        "For spending averages, savings or month reviews, use get_metrics/get_month_review. "
        "Never calculate an average from raw page history.",
        "When computed evidence is supplied, refer to each quantity with its exact "
        "[[metric:id]] token; the application renders its value and clickable source. "
        "Do not repeat numeric amounts or percentages as prose. Use prose for explanation.",
        "Captured chart context identifies the user's original selection. Client-captured "
        "values are not verified receipts: use supplied application evidence or tools "
        "before making numerical claims about them.",
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
            "Tools: get_metrics (computed figures and comparisons), get_month_review "
            "(computed review), get_page_data (another page's bundle), "
            "get_month_detail (one spending "
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
    return _Internal(detail or f"model endpoint answered {response.status_code}")


async def _model_round(
    client: httpx.AsyncClient,
    api_key: str,
    catalog_id: str,
    messages: list[dict],
    tools_enabled: bool,
) -> AsyncIterator[tuple[str, object]]:
    """One streamed completion. Yields ("thinking", str) for reasoning deltas and
    ("token", str) as content arrives, then exactly one
    ("end", {"tool_calls": [...], "content": str}). Raises
    _Retriable/_BadKey/_RateLimited/_Internal.

    Reasoning is display-only: it is NOT content. Kimi K3 streams `reasoning_content`
    before its first `content` delta (verified 2026-09-02) — forwarding it is what turns
    the pre-answer silence into something the user can watch, but it must never be
    replayed to the model, counted as an answer, or block the failover ladder. A round
    that ends with reasoning and nothing else is legal — the content is simply empty."""
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
                # Two spellings in the wild for the same thing; whichever arrives first in
                # a chunk is the one forwarded, and neither touches content_parts.
                reasoning = delta.get("reasoning_content") or delta.get("reasoning")
                if isinstance(reasoning, str) and reasoning:
                    yield ("thinking", reasoning)
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


async def _narrate_wait(
    source: AsyncIterator[tuple[str, object]], label: str, interval: float
) -> AsyncIterator[tuple[str, object]]:
    """Pass a round through unchanged, but narrate the wait for its FIRST frame.

    DeepSeek's endpoint has been measured sitting silent for 75 s before answering
    (2026-09-02); the keepalive comment that covers the socket says nothing to the person
    watching. Same parked-task shape as _with_keepalive — wait_for would cancel the
    pending read. Once anything arrives the model is clearly alive and this shuts up."""
    iterator = source.__aiter__()
    pending: asyncio.Task | None = asyncio.ensure_future(anext(iterator))
    waited = 0.0
    try:
        while True:
            done, _ = await asyncio.wait({pending}, timeout=interval)
            if not done:
                waited += interval
                yield ("status", f"Still waiting on {label}… ({waited:.0f}s)")
                continue
            task, pending = pending, None
            try:
                # An upstream failure lands HERE, not at the yield: _Retriable and friends
                # propagate to the ladder exactly as they would without this wrapper.
                first = task.result()
            except StopAsyncIteration:
                return
            yield first
            break
        async for item in iterator:
            yield item
    finally:
        if pending is not None:
            pending.cancel()
            await asyncio.gather(pending, return_exceptions=True)
        if hasattr(iterator, "aclose"):
            with suppress(RuntimeError, asyncio.CancelledError):
                await iterator.aclose()


async def _bounded_output(
    source: AsyncIterator[str], deadline: float, *, first_deadline: float | None = None
) -> AsyncIterator[str]:
    """Bound first output across retries/tool rounds, then bound each silent gap."""
    iterator = source.__aiter__()
    useful_deadline = min(
        deadline,
        first_deadline if first_deadline is not None else time.monotonic() + MODEL_SILENCE_SECONDS,
    )
    try:
        while True:
            remaining = useful_deadline - time.monotonic()
            if remaining <= 0:
                raise _Silent()
            try:
                frame = await asyncio.wait_for(anext(iterator), remaining)
            except StopAsyncIteration:
                return
            except TimeoutError as exc:
                raise _Silent() from exc
            if frame.startswith("event: token\n"):
                useful_deadline = min(deadline, time.monotonic() + MODEL_SILENCE_SECONDS)
            yield frame
    finally:
        if hasattr(iterator, "aclose"):
            with suppress(RuntimeError, asyncio.CancelledError):
                await iterator.aclose()


async def _converse(
    db,
    client: httpx.AsyncClient,
    api_key: str,
    model: AssistantModel,
    catalog_id: str,
    base_messages: list[dict],
    forwarded: list[bool],
    deadline: float,
    spent: list[int],
    evidence: list[MetricEvidence],
    context: dict,
    user_id: int | None,
    evidence_as_of: datetime | None,
) -> AsyncIterator[str]:
    """The whole multi-round conversation on ONE model, requested as `catalog_id` (the
    live catalog's spelling, which can differ from the registry guess). _Retriable escapes
    to the ladder.

    `deadline` and `spent` belong to the REQUEST, not to this model: spec §5 budgets six
    tool calls and ninety seconds for the whole answer; fallback cannot multiply either.
    Rounds stay per-model — a fresh model starts its own conversation."""
    messages = [dict(m) for m in base_messages]
    for _round in range(MAX_ROUNDS):
        if time.monotonic() > deadline:
            yield sse(
                "error", {"kind": "internal", "message": "The answer ran past its time budget."}
            )
            return
        # Narration before the call, not after: the whole point is the silence in between.
        yield sse(
            "status",
            {
                "text": (
                    f"Asking {model.label}…" if _round == 0 else f"{model.label} is continuing…"
                )
            },
        )
        end_payload: dict = {}
        round_stream = _narrate_wait(
            _model_round(client, api_key, catalog_id, messages, model.supports_tools),
            model.label,
            WAIT_STATUS_SECONDS,
        )
        async with aclosing(round_stream):
            async for kind, payload in round_stream:
                if kind == "token":
                    if not evidence and evidence_as_of is None:
                        forwarded[0] = True
                        yield sse("token", {"text": payload})
                elif kind == "thinking":
                    # Deliberately does NOT set forwarded[0]: reasoning is not an answer, so a
                    # rung that thinks and then dies may still hand off to the next model.
                    yield sse("thinking", {"text": payload})
                elif kind == "status":
                    yield sse("status", {"text": payload})
                else:
                    end_payload = payload  # type: ignore[assignment]
        tool_calls = end_payload.get("tool_calls") or []
        if not tool_calls:
            content = end_payload.get("content") or ""
            if evidence or evidence_as_of is not None:
                if narrative_is_supported(content, evidence):
                    forwarded[0] = True
                    yield sse("token", {"text": content})
                else:
                    yield sse(
                        "notice",
                        {
                            "kind": "evidence_fallback",
                            "message": "The calculated figures are available; "
                            "the additional narrative could not be verified.",
                        },
                    )
                    yield sse(
                        "token",
                        {
                            "text": "The calculated figures above are ready. I couldn't verify "
                            "the additional narrative against those figures."
                        },
                    )
                    forwarded[0] = True
            if user_id is not None:
                bundle = mint_bundle(
                    title="Saved answer",
                    month=captured_month(context),
                    summary_text="",
                    metrics=evidence,
                    context=context,
                    user_id=user_id,
                    as_of=evidence_as_of,
                )
                yield sse("evidence", bundle.model_dump(mode="json", by_alias=True))
            yield sse("done", {"model_used": model.key})
            return
        if spent[0] + len(tool_calls) > MAX_TOOL_CALLS:
            yield sse(
                "error",
                {"kind": "internal", "message": "The model kept requesting tools past the budget."},
            )
            return
        spent[0] += len(tool_calls)
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
            if call["name"] in {"get_metrics", "get_month_review"} and "error" not in result:
                try:
                    additions = [
                        MetricEvidence.model_validate(metric)
                        for metric in result.get("metrics", [])
                    ]
                    known = {metric.id for metric in evidence}
                    evidence.extend(metric for metric in additions if metric.id not in known)
                    del evidence[100:]
                    bundle = mint_bundle(
                        title=str(result.get("title", "Calculated figures")),
                        month=None,
                        summary_text=str(result.get("summary_text", "")),
                        metrics=evidence,
                        context=context,
                        user_id=user_id,
                    )
                    evidence_as_of = bundle.as_of
                    yield sse("evidence", bundle.model_dump(mode="json", by_alias=True))
                except (ValueError, TypeError):
                    result = {"error": "Metric evidence could not be validated."}
            if "error" in result:
                # A tool that died mid-statement leaves the session in a failed transaction;
                # every later tool in this conversation would then raise instead of answering.
                # Harmless on a clean session — the tools are read-only.
                try:
                    await db.rollback()
                except Exception:  # pragma: no cover - a session too broken to reset
                    logger.exception("assistant: rollback after tool error failed")
            # Named apart from the round loop's own `payload` (the _narrate_wait binding
            # above) so one long generator does not carry two live meanings for the name.
            tool_payload: dict = {
                "name": call["name"],
                "summary": "error" if "error" in result else "ok",
            }
            # The sandbox seam (2026-09-03 planning-sandboxes spec §12): a tool that computed
            # a scenario names where the drawer can open it live. tool_link matches the path
            # against SANDBOX_PATHS and mints the label; anything that is not one of the three
            # sandbox paths yields no link at all, and the client allow-lists it again.
            sandbox_url = result.get("sandbox_url")
            if isinstance(sandbox_url, str):
                link = tool_link(sandbox_url)
                if link is not None:
                    tool_payload["link"] = link
            yield sse("tool_result", tool_payload)
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


async def stream_chat(
    *,
    model_key: str,
    messages: list[dict],
    context: dict,
    intent: str | None = None,
    user_id: int | None = None,
) -> AsyncIterator[str]:
    deadline = time.monotonic() + TOTAL_BUDGET_SECONDS
    try:
        async with asyncio.timeout(TOTAL_BUDGET_SECONDS):
            source = _stream_chat(
                model_key=model_key,
                messages=messages,
                context=context,
                intent=intent,
                user_id=user_id,
                deadline=deadline,
            )
            async with aclosing(source):
                async for frame in source:
                    yield frame
    except TimeoutError:
        yield sse(
            "error",
            {
                "kind": "internal",
                "message": "The answer ran past its time budget. "
                "Any calculated figures above remain available.",
            },
        )


async def _stream_chat(
    *,
    model_key: str,
    messages: list[dict],
    context: dict,
    intent: str | None,
    user_id: int | None,
    deadline: float,
) -> AsyncIterator[str]:
    # The very first frame, before the session, the context build or any network hop: the
    # user pressed Send and must see the machine move (the reported dead-air symptom).
    # Detached from caller-owned objects before the first database/provider await.
    context = json.loads(json.dumps(context))
    messages = json.loads(json.dumps(messages))
    yield sse("status", {"text": "Reading the page's data…"})
    async with SESSION_FACTORY() as db:
        evidence: list[MetricEvidence] = []
        evidence_as_of = None
        review = None
        recipe = computed_review_intent(messages, intent)
        if recipe == "contribution_pace":
            review = await contribution_pace_bundle(db, context, user_id)
        elif recipe or (intent == "selection" and context.get("route") == "/spending"):
            review = await month_review_bundle(
                db,
                context,
                user_id,
                # The standard review starts at the latest eligible completed month.
                # An explicit chart selection retains the period the user selected.
                month=captured_month(context) if intent == "selection" else None,
                topic=recipe or "month_review",
            )
        if review is not None:
            evidence = list(review.metrics)
            evidence_as_of = review.as_of
            yield sse("computed_summary", review.model_dump(mode="json", by_alias=True))
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
        if review is not None:
            context_payload = {
                "computed_review": review.model_dump(
                    mode="json", by_alias=True, exclude={"receipt"}
                )
            }
        else:
            context_payload = await build_context(
                db,
                route=str(context.get("route", "/")),
                search=dict(context.get("search") or {}),
                view=dict(context.get("view") or {}),
            )
            if context.get("selection"):
                context_payload["captured_selection"] = context["selection"]
        prompt = system_prompt(json.dumps(context_payload), requested.supports_tools)
        base_messages = [{"role": "system", "content": prompt}, *messages]
        # ONE probe for the whole stream (cached — the drawer's /models call usually filled
        # it already). It decides how each rung is SPELLED, and prunes rungs the catalog
        # doesn't list at all: asking for those buys a 404 and a bogus failover notice.
        key_ok, catalog_ids, _checked_at = await probe_catalog(api_key, force=False)
        rungs = [requested, *(m for m in REGISTRY if m.key != requested.key)]
        ladder: list[tuple[AssistantModel, str]] = []
        for rung in rungs:
            # No verdict (rejected key / unreachable catalog) is not the same as "absent":
            # with nothing to go on, the registry spelling is still the best guess.
            resolved = resolve_catalog_id(rung, catalog_ids) if key_ok else rung.catalog_id
            if resolved is not None:
                ladder.append((rung, resolved))
        if not ladder:
            # A catalog that matches nothing at all (wholesale rename) must not silently
            # answer nothing — try the model the user actually asked for.
            ladder = [(requested, requested.catalog_id)]
        elif ladder[0][0].key != requested.key:
            # The pick itself was pruned. Every OTHER skip is invisible bookkeeping, but
            # this one changes who answers, so it gets the same words a mid-flight failover
            # gets — never a silent substitution.
            yield sse("notice", {"kind": "failover", "from": requested.key, "to": ladder[0][0].key})
        # One automatic fallback is enough to recover a provider outage without turning
        # a question into an opaque tour of the catalog. A missing requested model already
        # spent that fallback; the user can explicitly restart with another choice.
        ladder = ladder[:2] if ladder[0][0].key == requested.key else ladder[:1]
        forwarded = [False]
        # ONE budget for the request, not one per rung (spec §5).
        spent = [0]
        async with http_client(REQUEST_TIMEOUT) as client:
            for index, (model, catalog_id) in enumerate(ladder):
                retried = False
                first_deadline = min(deadline, time.monotonic() + MODEL_SILENCE_SECONDS)
                while True:
                    try:
                        bounded = _bounded_output(
                            _converse(
                                db,
                                client,
                                api_key,
                                model,
                                catalog_id,
                                base_messages,
                                forwarded,
                                deadline,
                                spent,
                                evidence,
                                context,
                                user_id,
                                evidence_as_of,
                            ),
                            deadline,
                            first_deadline=first_deadline,
                        )
                        async with aclosing(bounded):
                            async for frame in bounded:
                                yield frame
                        return
                    except _BadKey as exc:
                        yield sse("error", {"kind": "bad_key", "message": exc.message})
                        return
                    except _Internal as exc:
                        yield sse("error", {"kind": "internal", "message": exc.message})
                        return
                    except _RateLimited as exc:
                        payload: dict = {"kind": "rate_limited", "message": exc.message}
                        if exc.retry_after is not None:
                            payload["retry_after"] = exc.retry_after
                        yield sse("error", payload)
                        return
                    except _Retriable as exc:
                        if forwarded[0]:
                            yield sse(
                                "error",
                                {
                                    "kind": "unavailable",
                                    "message": f"{model.label} failed mid-answer.",
                                },
                            )
                            return
                        # One transient blip is not a verdict on the model. Retry this rung
                        # once — but only while enough budget is left to spend on it; a read
                        # timeout has usually eaten it already.
                        if (
                            not retried
                            and not isinstance(exc, _Silent)
                            and deadline - time.monotonic() > RETRY_MIN_REMAINING_SECONDS
                        ):
                            retried = True
                            yield sse("status", {"text": f"Retrying {model.label}…"})
                            await asyncio.sleep(RETRY_DELAY_SECONDS)
                            continue
                        if index + 1 < len(ladder):
                            yield sse(
                                "notice",
                                {
                                    "kind": "failover",
                                    "from": model.key,
                                    "to": ladder[index + 1][0].key,
                                },
                            )
                            break
                        tried = ", ".join(m.label for m, _ in ladder)
                        yield sse(
                            "error",
                            {
                                "kind": "unavailable",
                                "message": f"The selected model and fallback were unavailable — "
                                f"tried {tried}. You can restart with another model.",
                            },
                        )
                        return
