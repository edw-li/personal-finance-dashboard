"""Application-owned receipts, bounded references, and deterministic month reviews."""

import hashlib
import json
import re
from datetime import UTC, date, datetime, timedelta
from urllib.parse import urlsplit

import jwt
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import MonthlySpending, NetWorthSnapshot, SpendingCategory
from app.schemas.assistant_findings import EvidenceBundle
from app.schemas.metrics import MetricComponent, MetricEvidence, MetricWindow
from app.services import clock
from app.services.assistant_context import _selected_id, _view_month
from app.services.metrics import load_spending_metrics
from app.services.month_review import month_shift
from app.services.paycheck_calc import half_up2

RECEIPT_TTL = timedelta(days=7)
SOURCE_PATHS = frozenset(
    {
        "/",
        "/update",
        "/net-worth",
        "/portfolio",
        "/spending",
        "/credit-cards",
        "/paycheck",
        "/comp",
        "/espp",
        "/taxes",
        "/projection",
        "/calendar",
        "/settings",
    }
)
REFERENCE = re.compile(r"\[\[metric:([A-Za-z0-9_.:-]{1,160})\]\]")
NUMBER = re.compile(r"(?<![A-Za-z])[-+]?\d[\d,]*(?:\.\d+)?%?")


def valid_source_link(value: str) -> bool:
    if not value.startswith("/") or value.startswith("//") or "\\" in value:
        return False
    if any(ord(char) < 32 for char in value):
        return False
    parsed = urlsplit(value)
    return (
        not parsed.netloc and not parsed.scheme and parsed.path.rstrip("/") in (SOURCE_PATHS | {""})
    )


def _json(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def qualify(metric: MetricEvidence) -> MetricEvidence:
    raw = metric.model_dump(mode="json", by_alias=True)
    digest = hashlib.sha256(_json(raw).encode()).hexdigest()[:10]
    month = metric.window.to_month.strftime("%Y_%m") if metric.window else "undated"
    return metric.model_copy(update={"id": f"{metric.id}_{month}_{digest}"})


def _receipt_digest(metrics: list[dict], context: dict, as_of: datetime) -> str:
    return hashlib.sha256(
        _json(
            {
                "metrics": metrics,
                "context": context,
                "as_of": as_of.astimezone(UTC).isoformat(),
            }
        ).encode()
    ).hexdigest()


def mint_bundle(
    *,
    title: str,
    month: date | None,
    summary_text: str,
    metrics: list[MetricEvidence],
    context: dict,
    user_id: int | None,
    as_of: datetime | None = None,
) -> EvidenceBundle:
    stamp = as_of or datetime.now(UTC)
    raw = [metric.model_dump(mode="json", by_alias=True) for metric in metrics]
    if any(not valid_source_link(metric.source_link) for metric in metrics):
        raise ValueError("Evidence must link to an application-owned source.")
    receipt = jwt.encode(
        {
            "purpose": "assistant-evidence-v1",
            "sub": str(user_id or 0),
            "digest": _receipt_digest(raw, context, stamp),
            "iat": stamp,
            "exp": stamp + RECEIPT_TTL,
        },
        settings.secret_key,
        algorithm="HS256",
    )
    return EvidenceBundle(
        title=title,
        month=month,
        summary_text=summary_text,
        metrics=metrics,
        as_of=stamp,
        context=context,
        receipt=receipt,
    )


def validate_receipt(
    receipt: str, metrics: list[MetricEvidence], context: dict, as_of: datetime, user_id: int
) -> None:
    try:
        data = jwt.decode(
            receipt,
            settings.secret_key,
            algorithms=["HS256"],
            options={"require": ["exp", "sub", "digest", "purpose"]},
        )
        raw = [metric.model_dump(mode="json", by_alias=True) for metric in metrics]
        if (
            data["purpose"] != "assistant-evidence-v1"
            or data["sub"] != str(user_id)
            or data["digest"] != _receipt_digest(raw, context, as_of)
            or any(not valid_source_link(metric.source_link) for metric in metrics)
        ):
            raise ValueError("receipt mismatch")
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(
            status_code=422,
            detail="This evidence receipt expired. Ask for a fresh answer before saving it.",
        ) from exc
    except (jwt.PyJWTError, ValueError, TypeError, KeyError) as exc:
        raise HTTPException(
            status_code=422, detail="The saved evidence no longer matches its source receipt."
        ) from exc


def narrative_is_supported(content: str, metrics: list[MetricEvidence]) -> bool:
    """All quantities use references. Dates/years are the only allowed numeric literals.

    This conservative check avoids pretending arbitrary model arithmetic was verified. The
    model can describe direction and relationships; the application supplies every figure.
    """
    ids = {metric.id for metric in metrics}
    refs = REFERENCE.findall(content)
    if any(ref not in ids for ref in refs):
        return False
    remaining = REFERENCE.sub("", content)
    if "[[metric:" in remaining:
        return False
    if re.search(r"[$€£]\s*[-+]?\d", remaining):
        return False
    # The contribution plan's names contain digits, but are not quantitative claims.
    remaining = re.sub(r"401\(k\)|415\(c\)|§\s*423", "", remaining)
    years = {str(metric.as_of.year) for metric in metrics if metric.as_of}
    for metric in metrics:
        if metric.window:
            years.update(str(month.year) for month in metric.window.included)
    # A date only survives if it is actually present in the evidence windows.
    dates = {
        month.isoformat() for metric in metrics if metric.window for month in metric.window.included
    }
    for stamp in dates:
        remaining = remaining.replace(stamp, "")
    return bool(content.strip()) and all(number in years for number in NUMBER.findall(remaining))


def looks_like_month_review(messages: list[dict], intent: str | None) -> bool:
    if intent == "month_review":
        return True
    latest = next(
        (
            message.get("content", "")
            for message in reversed(messages)
            if message.get("role") == "user"
        ),
        "",
    )
    return "month-in-review" in latest.lower() or "month in review" in latest.lower()


def computed_review_intent(messages: list[dict], intent: str | None) -> str | None:
    if intent in {"spending_changes", "contribution_pace"}:
        return intent
    if looks_like_month_review(messages, intent):
        return "month_review"
    latest = next(
        (
            message.get("content", "").lower()
            for message in reversed(messages)
            if message.get("role") == "user"
        ),
        "",
    )
    if "spending changes" in latest:
        return "spending_changes"
    if "contribution pace" in latest:
        return "contribution_pace"
    return None


def captured_month(context: dict) -> date | None:
    selection = (context.get("selection") or {}).get("selection") or {}
    period = selection.get("period") or selection.get("date")
    return _view_month(
        {"month": period} if isinstance(period, str) else context.get("search") or {},
        context.get("view") or {},
    )


async def month_review_bundle(
    db: AsyncSession,
    context: dict,
    user_id: int | None,
    *,
    month: date | None = None,
    topic: str = "month_review",
) -> EvidenceBundle:
    found = await load_spending_metrics(db, month)
    selected = found.month
    metrics = [*found.metrics, found.comparison, found.rolling]
    if selected is not None:
        from app.api.net_worth import summary

        try:
            balances = await summary(month=selected, db=db)
        except HTTPException:
            balances = None
        if balances and balances.month == selected:
            snapshots = list(
                (
                    await db.execute(
                        select(NetWorthSnapshot)
                        .where(NetWorthSnapshot.month <= selected)
                        .order_by(NetWorthSnapshot.month.desc())
                        .limit(2)
                    )
                ).scalars()
            )
            stamp = snapshots[0].recorded_on or selected
            previous_snapshot = snapshots[1] if len(snapshots) > 1 else None
            previous_stamp = (
                previous_snapshot.recorded_on or previous_snapshot.month
                if previous_snapshot
                else None
            )
            for key, label, value, definition in (
                (
                    "net_worth",
                    "Net worth snapshot",
                    balances.net_worth,
                    f"The {selected:%B %Y} balance snapshot (recorded {stamp}), "
                    "with signed liabilities and component rollups.",
                ),
                (
                    "net_worth_change",
                    "Change from prior balance snapshot",
                    balances.mom_delta,
                    f"Difference between the balance snapshots recorded {stamp} and "
                    f"{previous_stamp or 'no preceding date'}. Snapshot dates remain "
                    "separate from the spending period.",
                ),
            ):
                metrics.append(
                    MetricEvidence(
                        id=key,
                        definition_version="net-worth-v1",
                        label=label,
                        value=value,
                        definition=definition,
                        completeness="complete" if value is not None else "unavailable",
                        window=MetricWindow(
                            from_month=previous_snapshot.month
                            if key == "net_worth_change" and previous_snapshot
                            else selected,
                            to_month=selected,
                            included=[previous_snapshot.month, selected]
                            if key == "net_worth_change" and previous_snapshot
                            else [selected],
                            excluded=[],
                            unreviewed_history_count=0,
                        ),
                        source_link=f"/net-worth?month={selected}",
                        source_label="Recorded balance snapshots",
                        as_of=stamp,
                    )
                )
        previous = month_shift(selected, -1)
        spending = (
            await db.execute(
                select(
                    MonthlySpending.month,
                    MonthlySpending.category_id,
                    MonthlySpending.amount,
                    SpendingCategory.name,
                )
                .join(SpendingCategory)
                .where(
                    MonthlySpending.month.in_([selected, previous]),
                    SpendingCategory.kind == "living",
                )
            )
        ).all()
        by_month: dict[date, dict] = {}
        for period, category_id, amount, name in spending:
            by_month.setdefault(period, {})[category_id] = (amount, name)
        changes = []
        for category_id, (amount, name) in by_month.get(selected, {}).items():
            prior = by_month.get(previous, {}).get(category_id)
            if prior is not None:  # a missing category is not an entered zero
                changes.append((abs(amount - prior[0]), category_id, name, amount, prior[0]))
        for _, category_id, name, amount, prior in sorted(changes, reverse=True)[:3]:
            metrics.append(
                MetricEvidence(
                    id=f"category_change_{category_id}",
                    label=f"{name} change from {previous:%b}",
                    definition="Difference between recorded category amounts in these two "
                    "calendar months. Missing categories are not treated as zero.",
                    value=half_up2(amount - prior),
                    completeness="incomplete" if not found.review.eligible_spending else "mixed",
                    components=[
                        MetricComponent(label=f"{selected:%b %Y}", value=amount),
                        MetricComponent(label=f"{previous:%b %Y}", value=prior),
                    ],
                    source_link=f"/spending?month={selected}&category={category_id}",
                    source_label="Living category entries",
                    as_of=selected,
                )
            )
    qualified = [qualify(metric) for metric in metrics]
    core = {original.id: item for original, item in zip(metrics, qualified, strict=True)}
    if selected is None:
        title = "Monthly review needs a completed month"
        text = (
            "Close a month in Monthly update, or review eligible historical entries, "
            "to start a completed-month review."
        )
    else:
        title = f"{selected:%B %Y} review"
        state = found.review.state.replace("_", " ") if found.review else "unavailable"
        text = f"{selected:%B %Y} · {state}. "
        text += f"Living spending: [[metric:{core['living_spending'].id}]]. "
        text += "Previous 12-month average: "
        text += f"[[metric:{core['living_spending_comparison_average'].id}]]. "
        text += f"Cash saved: [[metric:{core['cash_saved'].id}]]."
        if topic == "spending_changes":
            title = f"{selected:%B %Y} spending changes"
            changes = [metric for key, metric in core.items() if key.startswith("category_change_")]
            text = f"{selected:%B %Y} · {state}. "
            text += f"Living spending: [[metric:{core['living_spending'].id}]]. "
            text += "Previous 12-month average: "
            text += f"[[metric:{core['living_spending_comparison_average'].id}]]. "
            text += " ".join(f"{metric.label}: [[metric:{metric.id}]]." for metric in changes)
            if not changes:
                text += "Category changes need entries in both adjacent calendar months."
    return mint_bundle(
        title=title,
        month=selected,
        summary_text=text,
        metrics=qualified,
        context=context,
        user_id=user_id,
    )


async def contribution_pace_bundle(
    db: AsyncSession, context: dict, user_id: int | None
) -> EvidenceBundle:
    """Keep the Paycheck page's per-person caps, payday walk and estimates verbatim."""
    from app.api.paycheck import get_breakdown

    today = clock.product_today()
    title = f"{today.year} contribution pace"
    try:
        breakdown = await get_breakdown(
            profile_id=_selected_id(context, "profile"),
            person_id=_selected_id(context, "person") or _selected_id(context, "owner"),
            db=db,
        )
    except HTTPException as exc:
        return mint_bundle(
            title=title,
            month=today.replace(day=1),
            summary_text=f"Contribution pace is unavailable: {exc.detail}. "
            "Enter a paycheck profile and the applicable annual limits to review it.",
            metrics=[],
            context=context,
            user_id=user_id,
        )
    profile = breakdown.profile
    source = f"/paycheck?owner={profile.person_id}&profile={profile.id}&section=summary"
    window = MetricWindow(
        from_month=date(today.year, 1, 1),
        to_month=date(today.year, 12, 1),
        included=[date(today.year, month, 1) for month in range(1, 13)],
        excluded=[],
        unreviewed_history_count=0,
    )
    metrics, sentences = [], []
    for item in breakdown.pace:
        warnings = list(breakdown.warnings)
        warnings.append(
            f"Estimate from the payroll profile effective {profile.effective_date}; "
            "future contributions depend on that election and the dated pay schedule."
        )
        if item.limit is None:
            warnings.append("This year's applicable limit has not been entered.")
        if item.backfilled_from:
            warnings.append(f"Earlier payroll inputs are estimated from {item.backfilled_from}.")
        if item.window_label:
            warnings.append(f"ESPP purchase window: {item.window_label}.")
        quantities = [
            (
                "projected",
                "Projected contributions",
                item.annualized,
                "USD",
                "The Paycheck pace calculator's full-year projection or "
                "ESPP purchase-window total.",
                [
                    MetricComponent(label=half.label, value=half.amount)
                    for half in item.halves or []
                ],
            ),
            (
                "limit",
                "Entered annual limit",
                item.limit,
                "USD",
                "The applicable limit entered in Settings for this year; "
                "absent limits stay unavailable.",
                [],
            ),
            (
                "ratio",
                "Share of entered limit",
                item.ratio,
                "ratio",
                "The Paycheck calculator's projected contribution divided by "
                "the same entered limit.",
                [],
            ),
            (
                "so_far",
                "Estimated contributions to date",
                item.so_far,
                "USD",
                "Contributions from the same dated payroll walk through today, where available.",
                [],
            ),
            (
                "remaining_checks",
                "Remaining paychecks",
                item.remaining_checks,
                "count",
                "Remaining paydays counted by the same payroll calendar used for the projection.",
                [],
            ),
            (
                "to_cap_rate",
                "Total elective rate to reach the cap",
                item.to_cap_rate,
                "ratio",
                "The calculator's combined traditional and Roth election for remaining paydays, "
                "floored so the projected total stays at or below the entered cap.",
                [],
            ),
            (
                "to_cap_per_check",
                "Employee amount per paycheck to reach the cap",
                item.to_cap_per_check,
                "USD",
                "The calculator's employee HSA amount per remaining paycheck, "
                "using the entered cap.",
                [],
            ),
        ]
        if item.soft_limit is not None:
            quantities.extend(
                [
                    (
                        "soft_limit",
                        "Practical ESPP cap",
                        item.soft_limit,
                        "USD",
                        "The ESPP calculator's entered limit adjusted for the plan discount.",
                        [],
                    ),
                    (
                        "soft_ratio",
                        "Share of practical ESPP cap",
                        item.soft_ratio,
                        "ratio",
                        "The ESPP calculator's projected window contribution "
                        "relative to its practical cap.",
                        [],
                    ),
                ]
            )
        for key, label, value, unit, definition, components in quantities:
            # Optional recommendations with no calculation do not crowd out useful rows.
            if value is None and key not in {"projected", "limit", "ratio"}:
                continue
            metric = qualify(
                MetricEvidence(
                    id=f"pace_{profile.person_id}_{item.key}_{key}",
                    definition_version="paycheck-pace-v1",
                    label=f"{item.label} · {label}",
                    value=value,
                    unit=unit,
                    definition=definition,
                    scope=f"person:{profile.person_id}",
                    display_precision=7 if key == "to_cap_rate" else None,
                    window=window,
                    completeness="unavailable" if value is None else "mixed",
                    components=components,
                    source_link=source,
                    source_label="Paycheck contribution pace",
                    as_of=today,
                    warnings=warnings,
                )
            )
            metrics.append(metric)
            if key in {"projected", "limit"}:
                sentences.append(f"{metric.label}: [[metric:{metric.id}]].")
    return mint_bundle(
        title=title,
        month=today.replace(day=1),
        summary_text=" ".join(sentences),
        metrics=metrics,
        context=context,
        user_id=user_id,
    )
