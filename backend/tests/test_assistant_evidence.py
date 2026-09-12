"""Verifiable calculations survive provider failures and explicit finding retention."""

import asyncio
import json
import time
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

import httpx
import pytest
from pydantic import ValidationError
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.config import settings
from app.lifecycle.restore import SnapshotError, _rewrite_findings, _validate_allocation_metadata
from app.limit_keys import LIMIT_401K_ELECTIVE
from app.models import AllocationTargetSet, ContributionLimit, MonthlySpending, Person, User
from app.models.assistant_finding import AssistantFinding
from app.schemas.metrics import MetricEvidence
from app.security import create_access_token
from app.services import assistant_chat, assistant_models, clock
from app.services.assistant_evidence import (
    contribution_pace_bundle,
    mint_bundle,
    month_review_bundle,
    narrative_is_supported,
    qualify,
    validate_receipt,
)
from app.services.assistant_tools import execute_tool
from app.services.metrics import load_spending_metrics
from app.services.month_review import adopt_existing_history, load_review_book
from app.services.snapshot import build_snapshot_zip
from tests.test_assistant_chat_api import (
    _all_events,
    _collect,
    _delta,
    _finish,
    _openai_stream,
    _reasoning,
)
from tests.test_month_review_api import PAST, TODAY, seed
from tests.test_projection_api import _seed_profile
from tests.test_restore_api import UPLOAD, upload

CTX = {"route": "/spending", "search": {"month": str(PAST)}, "view": {}}


@pytest.fixture(autouse=True)
def wire(monkeypatch, engine):
    monkeypatch.setattr(clock, "product_today", lambda: TODAY)
    monkeypatch.setattr(
        assistant_chat, "SESSION_FACTORY", async_sessionmaker(engine, expire_on_commit=False)
    )
    monkeypatch.setattr(settings, "nvidia_api_key", "nvapi-test")
    monkeypatch.setattr(assistant_chat, "RETRY_DELAY_SECONDS", 0)
    monkeypatch.setattr(
        assistant_models,
        "_catalog_cache",
        (
            time.time(),
            True,
            frozenset(model.catalog_id for model in assistant_models.REGISTRY),
        ),
    )


async def seed_history(db):
    await seed(db, (date(2026, 7, 1), PAST))
    await adopt_existing_history(db, TODAY)
    await db.commit()


def stream(**kwargs):
    return assistant_chat.stream_chat(
        model_key="kimi-k3",
        messages=[{"role": "user", "content": "Month in review"}],
        context=CTX,
        intent="month_review",
        **kwargs,
    )


async def test_computed_summary_matches_page_metrics_before_missing_provider_key(db, monkeypatch):
    await seed_history(db)
    monkeypatch.setattr(settings, "nvidia_api_key", None)
    events = _all_events(await _collect(stream()))
    kinds = [kind for kind, _ in events]
    assert kinds.index("computed_summary") < kinds.index("error")
    computed = next(payload for kind, payload in events if kind == "computed_summary")
    page = await load_spending_metrics(db, PAST)
    calculated = {row["label"]: row["value"] for row in computed["metrics"]}
    assert calculated[page.comparison.label] == str(page.comparison.value)
    assert calculated["Living spending"] == "100.00"
    assert calculated["Cash saved"] == "900.00"
    assert computed["month"] == str(PAST)


async def test_standard_review_uses_completed_month_while_selection_honors_captured_period(
    db, monkeypatch
):
    await seed(db, (PAST, TODAY.replace(day=1)))
    await adopt_existing_history(db, TODAY)
    await db.commit()
    monkeypatch.setattr(settings, "nvidia_api_key", None)
    context = {"route": "/spending", "search": {"month": "2026-09-01"}, "view": {}}
    for intent, expected in (("month_review", str(PAST)), ("selection", "2026-09-01")):
        events = _all_events(
            await _collect(
                assistant_chat.stream_chat(
                    model_key="kimi-k3",
                    messages=[{"role": "user", "content": "Review this month"}],
                    context=context,
                    intent=intent,
                )
            )
        )
        summary = next(payload for kind, payload in events if kind == "computed_summary")
        assert summary["month"] == expected
        assert events[-1][0] == "error"  # the useful calculation survives the absent key


async def test_spending_changes_preset_computes_adjacent_deltas_without_provider(db, monkeypatch):
    await seed_history(db)
    monkeypatch.setattr(settings, "nvidia_api_key", None)
    events = _all_events(
        await _collect(
            assistant_chat.stream_chat(
                model_key="kimi-k3",
                messages=[{"role": "user", "content": "Spending changes"}],
                context=CTX,
                intent="spending_changes",
            )
        )
    )
    bundle = next(payload for kind, payload in events if kind == "computed_summary")
    assert bundle["title"] == "August 2026 spending changes"
    change = next(
        metric for metric in bundle["metrics"] if metric["id"].startswith("category_change_")
    )
    assert change["value"] == "0.00"
    assert f"[[metric:{change['id']}]]" in bundle["summary_text"]
    assert events[-1][1]["kind"] == "bad_key"


async def test_contribution_pace_preset_matches_paycheck_and_metric_tool_for_selected_person(
    auth_client, db, monkeypatch
):
    primary = Person(name="Primary", is_primary=True)
    partner = Person(name="Partner", is_primary=False)
    db.add_all([primary, partner])
    await db.commit()
    await _seed_profile(
        db, primary, effective_date=date(2026, 1, 1), annual_salary=Decimal("90000")
    )
    profile = await _seed_profile(
        db,
        partner,
        effective_date=date(2026, 1, 1),
        annual_salary=Decimal("120000"),
        trad_401k_pct=Decimal("0.10"),
    )
    db.add(ContributionLimit(year=2026, key=LIMIT_401K_ELECTIVE, value=Decimal("25000")))
    await db.commit()
    # A real GET reloads Numeric defaults as Decimals; this shared fixture session still
    # holds the writer's Python integer defaults until refreshed.
    await db.refresh(profile)
    page = (
        await auth_client.get(
            "/api/v1/paycheck/breakdown", params={"person_id": partner.id, "profile_id": profile.id}
        )
    ).json()
    assert page["profile"]["id"] == profile.id
    context = {"route": "/paycheck", "search": {"owner": str(partner.id)}, "view": {}}
    bundle = await contribution_pace_bundle(db, context, None)
    row = next(item for item in page["pace"] if item["key"] == LIMIT_401K_ELECTIVE)
    projected = next(
        metric for metric in bundle.metrics if f"_{row['key']}_projected_" in metric.id
    )
    assert str(projected.value) == row["annualized"]
    assert projected.scope == f"person:{partner.id}"
    assert (
        f"owner={partner.id}" in projected.source_link
        and "section=summary" in projected.source_link
    )
    target = next(metric for metric in bundle.metrics if f"_{row['key']}_to_cap_rate_" in metric.id)
    assert str(target.value) == row["to_cap_rate"]
    assert target.display_precision == 7
    absent_limits = [
        metric for metric in bundle.metrics if "_limit_" in metric.id and metric.value is None
    ]
    assert absent_limits and all(metric.completeness == "unavailable" for metric in absent_limits)
    tool = await execute_tool(
        db, "get_metrics", {"topic": "contribution_pace", "person": partner.id}
    )
    assert tool["metrics"] == [
        metric.model_dump(mode="json", by_alias=True) for metric in bundle.metrics
    ]
    monkeypatch.setattr(settings, "nvidia_api_key", None)
    events = _all_events(
        await _collect(
            assistant_chat.stream_chat(
                model_key="kimi-k3",
                messages=[{"role": "user", "content": "Contribution pace"}],
                context=context,
                intent="contribution_pace",
            )
        )
    )
    assert any(kind == "computed_summary" for kind, _ in events)
    assert events[-1][1]["kind"] == "bad_key"


async def test_missing_pace_inputs_still_have_a_summary_and_reject_invented_narrative(
    db, monkeypatch
):
    monkeypatch.setattr(
        assistant_models,
        "TRANSPORT_OVERRIDE",
        httpx.MockTransport(
            lambda _: httpx.Response(
                200, text=_openai_stream([_delta("Contribute $2026 each month."), _finish()])
            )
        ),
    )
    events = _all_events(
        await _collect(
            assistant_chat.stream_chat(
                model_key="kimi-k3",
                messages=[{"role": "user", "content": "Contribution pace"}],
                context={"route": "/paycheck", "search": {}, "view": {}},
                intent="contribution_pace",
            )
        )
    )
    computed = next(payload for kind, payload in events if kind == "computed_summary")
    assert computed["metrics"] == [] and "unavailable" in computed["summary_text"]
    assert not any("$2026" in payload["text"] for kind, payload in events if kind == "token")
    assert any(
        kind == "notice" and payload.get("kind") == "evidence_fallback" for kind, payload in events
    )


async def test_invented_average_is_never_forwarded_as_verified_narrative(db, monkeypatch):
    await seed_history(db)

    def responder(_request):
        return httpx.Response(
            200,
            text=_openai_stream(
                [
                    _delta("Your average was $5,576.42 and savings were 72%."),
                    _finish(),
                ]
            ),
        )

    monkeypatch.setattr(assistant_models, "TRANSPORT_OVERRIDE", httpx.MockTransport(responder))
    events = _all_events(await _collect(stream()))
    text = "".join(payload["text"] for kind, payload in events if kind == "token")
    assert "5,576.42" not in text
    assert "72%" not in text
    assert any(
        payload.get("kind") == "evidence_fallback" for kind, payload in events if kind == "notice"
    )
    assert events[-1][0] == "done"


async def test_valid_reference_uses_exact_server_evidence_and_context_is_captured(db, monkeypatch):
    await seed_history(db)
    context = {"route": "/spending", "search": {"month": str(PAST)}, "view": {}}

    def responder(request):
        body = json.loads(request.content)
        prompt = body["messages"][0]["content"]
        computed = json.loads(prompt.split("CONTEXT:\n", 1)[1])["computed_review"]
        metric = next(item for item in computed["metrics"] if item["label"] == "Living spending")
        return httpx.Response(
            200,
            text=_openai_stream(
                [
                    _delta(f"Living spending was [[metric:{metric['id']}]]."),
                    _finish(),
                ]
            ),
        )

    monkeypatch.setattr(assistant_models, "TRANSPORT_OVERRIDE", httpx.MockTransport(responder))
    generator = assistant_chat.stream_chat(
        model_key="kimi-k3",
        messages=[{"role": "user", "content": "Month in review"}],
        context=context,
        intent="month_review",
        user_id=1,
    )
    first = await anext(generator)
    context["search"]["month"] = "2026-01-01"
    events = _all_events([first, *await _collect(generator)])
    evidence = next(payload for kind, payload in events if kind == "computed_summary")
    assert evidence["context"]["search"]["month"] == str(PAST)
    assert not any(
        payload.get("kind") == "evidence_fallback" for kind, payload in events if kind == "notice"
    )
    text = "".join(payload["text"] for kind, payload in events if kind == "token")
    assert "[[metric:living_spending_" in text


def test_reference_validation_rejects_unknown_ids_and_non_receipt_values():
    metric = qualify(
        MetricEvidence(
            id="living",
            label="Living",
            definition="Living spending",
            value=Decimal("100"),
            completeness="complete",
            source_link="/spending?month=2026-08-01",
            source_label="Spending",
            as_of=PAST,
        )
    )
    assert narrative_is_supported(f"Living: [[metric:{metric.id}]].", [metric])
    assert not narrative_is_supported("Living: [[metric:invented]].", [metric])
    assert not narrative_is_supported("Living was 100 dollars.", [metric])
    assert not narrative_is_supported("Living was $99.", [metric])
    assert not narrative_is_supported("[[metric:broken space]]", [metric])


def test_exact_election_precision_survives_evidence_serialization():
    metric = MetricEvidence(
        id="pace_2_elective_to_cap_rate",
        label="Total elective rate to reach the cap",
        definition="Floored payroll election",
        value=Decimal("0.173925246"),
        unit="ratio",
        display_precision=7,
        completeness="mixed",
        source_link="/paycheck?owner=2&section=summary",
        source_label="Paycheck",
    )
    wire = metric.model_dump(mode="json")
    assert wire["display_precision"] == 7
    assert wire["value"] == "0.173925246"
    assert MetricEvidence.model_validate(wire).display_precision == 7
    for invalid in (-1, 10, True, 1.5):
        with pytest.raises(ValidationError):
            MetricEvidence.model_validate({**wire, "display_precision": invalid})


class QuietStream(httpx.AsyncByteStream):
    def __init__(self, *, text_first=False, reasoning=False):
        self.closed = False
        self.text_first = text_first
        self.reasoning = reasoning

    async def __aiter__(self):
        if self.text_first:
            yield f"data: {json.dumps(_delta('partial'))}\n\n".encode()
        if self.reasoning:
            while True:
                await asyncio.sleep(0.005)
                yield f"data: {json.dumps(_reasoning('thinking'))}\n\n".encode()
        await asyncio.sleep(30)
        yield b"data: [DONE]\n\n"

    async def aclose(self):
        self.closed = True


@pytest.mark.parametrize("reasoning", [False, True])
async def test_silence_bound_covers_headers_and_reasoning_and_skips_same_rung(
    db, monkeypatch, reasoning
):
    attempts = []
    quiet = QuietStream(reasoning=reasoning)

    async def responder(request):
        model = json.loads(request.content)["model"]
        attempts.append(model)
        if model == "moonshotai/kimi-k3":
            if not reasoning:
                await asyncio.sleep(30)  # waiting for response headers is also bounded
            return httpx.Response(200, stream=quiet)
        return httpx.Response(200, text=_openai_stream([_delta("fallback"), _finish()]))

    monkeypatch.setattr(assistant_chat, "MODEL_SILENCE_SECONDS", 0.04)
    monkeypatch.setattr(assistant_models, "TRANSPORT_OVERRIDE", httpx.MockTransport(responder))
    events = _all_events(
        await _collect(
            assistant_chat.stream_chat(
                model_key="kimi-k3",
                messages=[{"role": "user", "content": "hi"}],
                context=CTX,
            )
        )
    )
    assert attempts.count("moonshotai/kimi-k3") == 1
    assert attempts[-1] == "deepseek-ai/deepseek-v4-pro-0813"
    assert any(kind == "token" and payload["text"] == "fallback" for kind, payload in events)
    if reasoning:
        assert quiet.closed


async def test_silent_gap_after_partial_output_stops_without_concatenated_fallback(monkeypatch):
    quiet = QuietStream(text_first=True)
    attempts = []

    def responder(request):
        attempts.append(json.loads(request.content)["model"])
        return httpx.Response(200, stream=quiet)

    monkeypatch.setattr(assistant_chat, "MODEL_SILENCE_SECONDS", 0.03)
    monkeypatch.setattr(assistant_models, "TRANSPORT_OVERRIDE", httpx.MockTransport(responder))
    events = _all_events(
        await _collect(
            assistant_chat.stream_chat(
                model_key="kimi-k3",
                messages=[{"role": "user", "content": "hi"}],
                context=CTX,
            )
        )
    )
    assert len(attempts) == 1
    assert not any(kind == "notice" for kind, _ in events)
    assert any(kind == "token" and payload["text"] == "partial" for kind, payload in events)
    assert events[-1][0] == "error"
    assert quiet.closed


async def test_transient_retry_keeps_the_same_first_output_allowance(monkeypatch):
    primary_attempts = 0

    async def responder(request):
        nonlocal primary_attempts
        if json.loads(request.content)["model"] == "moonshotai/kimi-k3":
            primary_attempts += 1
            if primary_attempts == 1:
                await asyncio.sleep(0.09)
                return httpx.Response(503, text="temporary failure")
            await asyncio.sleep(0.08)
            return httpx.Response(200, text=_openai_stream([_delta("too late"), _finish()]))
        return httpx.Response(200, text=_openai_stream([_delta("fallback"), _finish()]))

    monkeypatch.setattr(assistant_chat, "MODEL_SILENCE_SECONDS", 0.13)
    monkeypatch.setattr(assistant_models, "TRANSPORT_OVERRIDE", httpx.MockTransport(responder))
    events = _all_events(
        await _collect(
            assistant_chat.stream_chat(
                model_key="kimi-k3",
                messages=[{"role": "user", "content": "hi"}],
                context=CTX,
            )
        )
    )
    assert primary_attempts == 2
    assert [payload["text"] for kind, payload in events if kind == "token"] == ["fallback"]


async def test_total_budget_includes_context_loading(monkeypatch):
    cancelled = asyncio.Event()

    async def slow_context(*args, **kwargs):
        try:
            await asyncio.sleep(30)
        finally:
            cancelled.set()

    monkeypatch.setattr(assistant_chat, "build_context", slow_context)
    monkeypatch.setattr(assistant_chat, "TOTAL_BUDGET_SECONDS", 0.03)
    events = _all_events(
        await _collect(
            assistant_chat.stream_chat(
                model_key="kimi-k3",
                messages=[{"role": "user", "content": "hi"}],
                context=CTX,
            )
        )
    )
    assert events[-1][0] == "error"
    assert "time budget" in events[-1][1]["message"]
    assert cancelled.is_set()


async def test_stop_cancels_provider_and_closes_stream(monkeypatch):
    quiet = QuietStream(reasoning=True)
    monkeypatch.setattr(
        assistant_models,
        "TRANSPORT_OVERRIDE",
        httpx.MockTransport(lambda _: httpx.Response(200, stream=quiet)),
    )
    source = assistant_chat._with_keepalive(
        assistant_chat.stream_chat(
            model_key="kimi-k3",
            messages=[{"role": "user", "content": "hi"}],
            context=CTX,
        ),
        interval=0.01,
    )

    async def consume():
        async for frame in source:
            if "event: thinking" in frame:
                return

    await asyncio.wait_for(consume(), 2)
    await source.aclose()
    assert quiet.closed


async def test_saved_finding_is_owner_scoped_and_immutable(auth_client, db, seeded_user):
    await seed_history(db)
    bundle = await month_review_bundle(db, CTX, seeded_user.id, month=PAST)
    payload = {
        "title": bundle.title,
        "content": bundle.summary_text,
        "model_used": "kimi-k3",
        "context": bundle.context,
        "evidence": [metric.model_dump(mode="json", by_alias=True) for metric in bundle.metrics],
        "evidence_as_of": bundle.as_of.isoformat(),
        "receipt": bundle.receipt,
    }
    created = await auth_client.post("/api/v1/assistant/findings", json=payload)
    assert created.status_code == 201, created.text
    saved = created.json()
    await db.execute(update(MonthlySpending).values(amount=Decimal("999")))
    await db.commit()
    reopened = (await auth_client.get(f"/api/v1/assistant/findings/{saved['id']}")).json()
    assert reopened["evidence"] == saved["evidence"]
    assert reopened["evidence_as_of"] == saved["evidence_as_of"]
    other = User(email="other@example.com", password_hash="unused")
    db.add(other)
    await db.commit()
    auth_client.headers["Authorization"] = f"Bearer {create_access_token(other.id, 0)}"
    assert (await auth_client.get("/api/v1/assistant/findings")).json() == []
    assert (await auth_client.get(f"/api/v1/assistant/findings/{saved['id']}")).status_code == 404
    assert (
        await auth_client.delete(f"/api/v1/assistant/findings/{saved['id']}")
    ).status_code == 404
    assert (await auth_client.post("/api/v1/assistant/findings", json=payload)).status_code == 422


async def test_receipt_rejects_forged_values_links_scope_and_expiry(db, seeded_user):
    await seed_history(db)
    bundle = await month_review_bundle(db, CTX, seeded_user.id, month=PAST)
    validate_receipt(bundle.receipt, bundle.metrics, bundle.context, bundle.as_of, seeded_user.id)
    for updates in ({"value": Decimal("999")}, {"source_link": "https://evil.example"}):
        forged = [bundle.metrics[0].model_copy(update=updates), *bundle.metrics[1:]]
        with pytest.raises(Exception) as error:
            validate_receipt(bundle.receipt, forged, bundle.context, bundle.as_of, seeded_user.id)
        assert error.value.status_code == 422
    with pytest.raises(Exception) as error:
        validate_receipt(
            bundle.receipt, bundle.metrics, {"route": "/taxes"}, bundle.as_of, seeded_user.id
        )
    assert error.value.status_code == 422
    old = mint_bundle(
        title="Old",
        month=PAST,
        summary_text="",
        metrics=bundle.metrics,
        context=CTX,
        user_id=seeded_user.id,
        as_of=datetime.now(UTC) - timedelta(days=8),
    )
    with pytest.raises(Exception) as error:
        validate_receipt(old.receipt, old.metrics, old.context, old.as_of, seeded_user.id)
    assert "expired" in error.value.detail


async def test_restore_remaps_findings_without_recomputing_evidence(db, seeded_user):
    await seed_history(db)
    bundle = await month_review_bundle(db, CTX, seeded_user.id, month=PAST)
    row = {
        "id": 8,
        "user_id": 99,
        "title": bundle.title,
        "content": bundle.summary_text,
        "model_used": None,
        "context": CTX,
        "evidence": [metric.model_dump(mode="json", by_alias=True) for metric in bundle.metrics],
        "evidence_as_of": bundle.as_of,
        "created_at": bundle.as_of,
    }
    rewritten = _rewrite_findings([row], seeded_user.id, [])
    assert rewritten[0]["user_id"] == seeded_user.id
    assert rewritten[0]["evidence"] == row["evidence"]
    assert rewritten[0]["evidence_as_of"] == row["evidence_as_of"]
    assert _rewrite_findings([row], None, []) == []
    assert (await db.execute(select(AssistantFinding))).scalars().all() == []  # validation only


async def test_snapshot_roundtrip_keeps_reviews_targets_and_dated_findings(
    auth_client, db, seeded_user
):
    await seed_history(db)
    bundle = await month_review_bundle(db, CTX, seeded_user.id, month=PAST)
    other = User(email="export-owner@example.com", password_hash="unused")
    db.add(other)
    await db.flush()
    finding = AssistantFinding(
        user_id=other.id,
        title=bundle.title,
        content=bundle.summary_text,
        context=CTX,
        evidence=[metric.model_dump(mode="json", by_alias=True) for metric in bundle.metrics],
        evidence_as_of=bundle.as_of,
    )
    targets = [{"key": "equity", "target_pct": "100", "tolerance_pp": "5"}]
    db.add_all(
        [
            finding,
            AllocationTargetSet(
                scope_key="household",
                dimension="asset_class",
                state="active",
                targets=targets,
                updated_at=bundle.as_of,
            ),
        ]
    )
    await db.commit()
    original_revision = (await load_review_book(db)).months[PAST].input_revision
    snapshot = await build_snapshot_zip(db)
    await db.execute(update(MonthlySpending).values(amount=Decimal("999")))
    await db.commit()
    response = await auth_client.post(f"{UPLOAD}?dry_run=false", files=upload(snapshot.payload))
    assert response.status_code == 200, response.text
    assert response.json()["applied"]
    reviewed = (await load_review_book(db)).months[PAST]
    assert reviewed.input_revision == original_revision
    assert reviewed.state == "unreviewed_history" and reviewed.legacy_eligible
    saved = (await auth_client.get("/api/v1/assistant/findings")).json()
    assert len(saved) == 1
    assert saved[0]["evidence"] == finding.evidence
    assert datetime.fromisoformat(saved[0]["evidence_as_of"]) == bundle.as_of
    assert (await db.execute(select(AllocationTargetSet.targets))).scalar_one() == targets


def test_restore_rejects_invalid_target_totals_owners_and_fund_industries():
    base = {
        "state": "active",
        "dimension": "asset_class",
        "scope_key": "household",
        "targets": [{"key": "equity", "target_pct": "100", "tolerance_pp": "5"}],
    }
    _validate_allocation_metadata({"allocation_target_sets": [base]})
    with pytest.raises(SnapshotError):
        _validate_allocation_metadata(
            {
                "allocation_target_sets": [
                    {**base, "targets": [{"key": "equity", "target_pct": "80"}]}
                ]
            }
        )
    with pytest.raises(SnapshotError):
        _validate_allocation_metadata(
            {"allocation_target_sets": [{**base, "scope_key": "person:9"}], "people": [{"id": 1}]}
        )
    with pytest.raises(SnapshotError):
        _validate_allocation_metadata(
            {"securities": [{"holding_type": "etf", "allocation_industry": "Technology"}]}
        )
