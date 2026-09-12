"""Allocation classifications, priced coverage and target drift.

Unknown exposure remains in the priced denominator. Missing quotes have an unknown
value, never a zero value. Funds have no industry until constituent data exists.
"""

from collections import defaultdict
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.portfolio import AllocationTargetSet, LatestPrice, Security
from app.schemas.portfolio import (
    AllocationCoverage,
    AllocationDrift,
    AllocationMember,
    AllocationOut,
    AllocationSlice,
    AllocationTargetSetOut,
    ClassificationOut,
)
from app.services.money import quantize_pct
from app.services.ownership import parse_owner
from app.services.portfolio_calc import Position, PositionKey

ZERO = Decimal("0")
MONEY = Decimal("0.01")
UNKNOWN = "__unknown__"
ASSET_LABELS = {
    "equity": "Equity",
    "bonds": "Bonds",
    "cash": "Cash / cash equivalents",
    "real_assets": "Real assets",
    "mixed": "Mixed",
    "other": "Other",
}
GEO_LABELS = {"us": "US", "international": "International", "global": "Global / mixed"}
TYPE_LABELS = {"stock": "Stock", "etf": "ETF", "mutual_fund": "Mutual fund", "private": "Private"}
WRAPPERS = {"etf", "mutual fund", "mutual_fund", "fund", "stock", "private"}


def money(value: Decimal) -> Decimal:
    return value.quantize(MONEY, rounding=ROUND_HALF_UP)


def scope_key(owner: str | None) -> str:
    if owner is None:
        return "household"
    person_id = parse_owner(owner)
    return "joint" if person_id is None else f"person:{person_id}"


def classification(security: Security) -> ClassificationOut:
    manual = security.classification_source == "manual"
    # A saved explicit unknown is meaningful; do not bring the old field back on read.
    industry = security.allocation_industry if manual else security.industry
    industry_available = security.holding_type not in {"etf", "mutual_fund"}
    if not industry_available or (industry and industry.strip().lower() in WRAPPERS):
        industry = None
    return ClassificationOut(
        security_id=security.id,
        ticker=security.ticker,
        name=security.name,
        holding_type=security.holding_type,
        asset_class=(
            security.asset_class
            if manual
            else security.asset_class or ("equity" if security.holding_type == "stock" else None)
        ),
        industry=industry.strip() if industry and industry.strip() else None,
        geography=security.geography,
        source="User reviewed" if manual else "Existing security records (unreviewed)",
        note=security.classification_note,
        reviewed_at=security.classification_reviewed_at,
        industry_available=industry_available,
    )


def dimension_key(security: Security, by: str, account: str | None = None) -> str:
    if by == "account":
        return account or UNKNOWN
    if by == "type":
        return security.holding_type
    return getattr(classification(security), by) or UNKNOWN


def dimension_label(key: str, by: str) -> str:
    if key == UNKNOWN:
        return "Unknown industry" if by == "industry" else "Unknown"
    labels = {"asset_class": ASSET_LABELS, "geography": GEO_LABELS, "type": TYPE_LABELS}
    return labels.get(by, {}).get(key, key)


def allocation_members(
    positions: dict[PositionKey, Position],
    securities: dict[int, Security],
    latest: dict[int, LatestPrice],
    by: str,
) -> list[tuple[str, AllocationMember]]:
    grouped: dict[int, list[Position]] = defaultdict(list)
    for pos in positions.values():
        if pos.shares != 0 and pos.security_id in securities:
            grouped[pos.security_id].append(pos)
    result: list[tuple[str, AllocationMember]] = []
    for sec_id, rows in grouped.items():
        security, quote = securities[sec_id], latest.get(sec_id)
        shares = sum((row.shares for row in rows), ZERO)
        if shares == 0 and by != "account":
            continue
        meta = classification(security)
        values = (
            [None] * len(rows) if quote is None else [money(r.shares * quote.price) for r in rows]
        )
        # Match security-level valuation exactly even when separate account rows round.
        if quote is not None:
            values[-1] += money(shares * quote.price) - sum(values, ZERO)
        parts = (
            list(zip(rows, values, strict=True))
            if by == "account"
            else [
                (
                    Position(security_id=sec_id, account="", shares=shares),
                    None if quote is None else money(shares * quote.price),
                )
            ]
        )
        for row, value in parts:
            key = dimension_key(security, by, row.account)
            result.append(
                (
                    key,
                    AllocationMember(
                        security_id=sec_id,
                        ticker=security.ticker,
                        name=security.name,
                        account=row.account if by == "account" else None,
                        shares=row.shares,
                        market_value=value,
                        quoted_at=quote.quoted_at if quote else None,
                        classification_source=(
                            "Portfolio account"
                            if by == "account"
                            else "Security holding type"
                            if by == "type"
                            else meta.source
                        ),
                        classification_reviewed_at=meta.reviewed_at,
                    ),
                )
            )
    return result


def build_allocation(
    positions: dict[PositionKey, Position],
    securities: dict[int, Security],
    latest: dict[int, LatestPrice],
    by: str,
    owner: str | None,
    target_sets: list[AllocationTargetSet] | None = None,
) -> AllocationOut:
    members = allocation_members(positions, securities, latest, by)
    priced = [(key, member) for key, member in members if member.market_value is not None]
    unpriced = [(key, member) for key, member in members if member.market_value is None]
    grouped: dict[str, list[AllocationMember]] = defaultdict(list)
    for key, member in priced:
        grouped[key].append(member)
    total = sum((member.market_value for _, member in priced), ZERO)
    unknown = sum((m.market_value for key, m in priced if key == UNKNOWN), ZERO)
    has_negative = any(m.market_value < 0 for _, m in priced)
    weights_available = total > 0 and not has_negative
    slices = []
    for key, rows in grouped.items():
        value = sum((row.market_value for row in rows), ZERO)
        slices.append(
            AllocationSlice(
                key=key,
                label=dimension_label(key, by),
                market_value=value,
                weight_pct=quantize_pct(value / total) if total > 0 else quantize_pct(ZERO),
                holdings=len({row.security_id for row in rows}),
                is_unknown=key == UNKNOWN,
                members=sorted(rows, key=lambda row: (-(row.market_value or ZERO), row.ticker)),
            )
        )
    slices.sort(key=lambda row: (-row.market_value, row.key))
    sets = {row.state: AllocationTargetSetOut.model_validate(row) for row in target_sets or []}
    active = sets.get("active")
    targets = {row.key: row for row in active.targets} if active else {}
    unpriced_keys = {key for key, _ in unpriced}
    drift = []
    if active:
        by_key = {row.key: row for row in slices}
        for key in sorted(by_key.keys() | targets.keys() | unpriced_keys):
            value = by_key[key].market_value if key in by_key else ZERO
            target = targets.get(key)
            pct = target.target_pct if target else ZERO
            tolerance = target.tolerance_pp if target else ZERO
            weight = value / total if weights_available else None
            # A partially priced slice cannot advertise a precise dollar difference.
            available = weights_available and key not in unpriced_keys
            pp = (weight * 100 - pct).quantize(Decimal("0.0001")) if available else None
            drift.append(
                AllocationDrift(
                    key=key,
                    label=dimension_label(key, by),
                    market_value=value,
                    weight_pct=quantize_pct(weight) if weight is not None else None,
                    target_pct=pct,
                    tolerance_pp=tolerance,
                    drift_pp=pp,
                    drift_amount=money(value - total * pct / 100) if available else None,
                    outside_tolerance=abs(pp) > tolerance if pp is not None else None,
                    has_unpriced=key in unpriced_keys,
                )
            )
    quotes = [member.quoted_at for _, member in priced if member.quoted_at is not None]
    warnings = []
    if unpriced:
        warnings.append("Weights use priced holdings only; missing-price values are unknown.")
    if has_negative:
        warnings.append(
            "Negative positions require review. The table retains them; "
            "allocation charts and drift are unavailable."
        )
    if by == "industry":
        warnings.append(
            "Funds have no industry exposure here because constituent holdings are not loaded."
        )
    return AllocationOut(
        by=by,
        total_market_value=money(total),
        slices=slices,
        scope_key=scope_key(owner),
        as_of=min(quotes, default=None),
        latest_quote_at=max(quotes, default=None),
        coverage=AllocationCoverage(
            holding_count=len({m.security_id for _, m in members}),
            priced_count=len({m.security_id for _, m in priced}),
            unpriced_count=len({m.security_id for _, m in unpriced}),
            classified_count=len({m.security_id for key, m in priced if key != UNKNOWN}),
            classified_market_value=money(total - unknown),
            unknown_market_value=money(unknown),
            classified_weight_pct=quantize_pct((total - unknown) / total)
            if weights_available
            else None,
            unpriced_holdings=[member for _, member in unpriced],
            warnings=warnings,
        ),
        target_set=active,
        draft_target_set=sets.get("draft"),
        drift=drift,
        source_href="/portfolio?section=holdings"
        + (f"&owner={owner}" if owner is not None else ""),
    )


async def load_targets(db: AsyncSession, by: str, owner: str | None) -> list[AllocationTargetSet]:
    return list(
        (
            await db.execute(
                select(AllocationTargetSet).where(
                    AllocationTargetSet.scope_key == scope_key(owner),
                    AllocationTargetSet.dimension == by,
                )
            )
        ).scalars()
    )
