"""Query-time portfolio math (spec §4: derived values are NEVER stored).

Personal scale (~37 securities, tens of transactions): full loads + in-memory folds are
the entire strategy, mirroring net_worth_calc. Folding law: (sort_index, id) order —
txn_date is mostly NULL (Plan 1 forward note) and must never drive order.
"""

from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    DividendPayment,
    LatestPrice,
    PositionTransaction,
    PriceHistory,
    Security,
)
from app.services.money import quantize_pct
from app.services.xirr import xirr

ZERO = Decimal("0")
MONEY_Q = Decimal("0.01")
SHARE_Q = Decimal("0.000001")
PRICE_Q = Decimal("0.0001")

PositionKey = tuple[int, str]  # (security_id, account)


@dataclass
class Position:
    security_id: int
    account: str
    shares: Decimal = ZERO
    cost_basis: Decimal = ZERO
    realized_gl: Decimal = ZERO
    has_dateless_txn: bool = False
    dated_flows: list[tuple[date, Decimal]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def fold_transactions(txns: list[PositionTransaction]) -> dict[PositionKey, Position]:
    """Average-cost folding (the sheet's method). Permissive: bad data folds with a
    warning attached, never raises — a data-entry mistake must not 500 the page."""
    positions: dict[PositionKey, Position] = {}
    for txn in sorted(txns, key=lambda t: (t.sort_index, t.id)):
        key = (txn.security_id, txn.account)
        pos = positions.setdefault(key, Position(security_id=txn.security_id, account=txn.account))
        if txn.type == "split":
            if txn.split_factor is None or txn.split_factor <= 0:
                pos.warnings.append(f"txn {txn.id}: split without a positive factor — skipped")
                continue
            pos.shares *= txn.split_factor
            continue
        fees = txn.fees or ZERO
        if txn.txn_date is None:
            pos.has_dateless_txn = True
        if txn.type == "buy":
            pos.shares += txn.shares
            pos.cost_basis += txn.shares * txn.price + fees
            if txn.txn_date is not None:
                pos.dated_flows.append((txn.txn_date, -(txn.shares * txn.price + fees)))
        elif txn.type == "sell":
            if pos.shares > 0:
                avg = pos.cost_basis / pos.shares
            else:
                avg = ZERO
                pos.warnings.append(f"txn {txn.id}: sell with no held shares")
            if txn.shares > pos.shares and pos.shares > 0:
                pos.warnings.append(f"txn {txn.id}: sell exceeds held shares")
            pos.realized_gl += txn.shares * (txn.price - avg) - fees
            pos.cost_basis -= txn.shares * avg
            pos.shares -= txn.shares
            if pos.shares <= 0:
                pos.cost_basis = ZERO  # liquidated (or overdrawn) position has no basis
            if txn.txn_date is not None:
                pos.dated_flows.append((txn.txn_date, txn.shares * txn.price - fees))
        else:
            # No DB CHECK on type (app-layer posture) — tolerate unknown values.
            pos.warnings.append(f"txn {txn.id}: unknown type {txn.type!r} — skipped")
    return positions


@dataclass
class Holding:
    security: Security
    shares: Decimal
    avg_cost: Decimal | None
    cost_basis: Decimal
    realized_gl: Decimal
    dividends_collected: Decimal
    accounts: list[str]
    warnings: list[str]
    price: Decimal | None
    quoted_at: datetime | None
    price_source: str | None
    market_value: Decimal | None
    day_change_pct: Decimal | None
    day_change_amount: Decimal | None
    unrealized_gl: Decimal | None
    unrealized_gl_pct: Decimal | None
    annual_income: Decimal | None
    yield_pct: Decimal | None
    yoc_pct: Decimal | None
    xirr_pct: Decimal | None


def build_holdings(
    positions: dict[PositionKey, Position],
    securities_by_id: dict[int, Security],
    latest_by_sec: dict[int, LatestPrice],
    history_by_sec: dict[int, list[PriceHistory]],
    dividends: list[DividendPayment],
    today: date,
) -> list[Holding]:
    """One row per security with non-zero folded shares, market-value-desc order."""
    div_total: dict[int, Decimal] = {}
    div_flows: dict[int, list[tuple[date, Decimal]]] = {}
    for payment in dividends:
        div_total[payment.security_id] = div_total.get(payment.security_id, ZERO) + payment.amount
        div_flows.setdefault(payment.security_id, []).append((payment.pay_date, payment.amount))

    by_security: dict[int, list[Position]] = {}
    for pos in positions.values():
        by_security.setdefault(pos.security_id, []).append(pos)

    holdings: list[Holding] = []
    for sec_id, folded in by_security.items():
        security = securities_by_id.get(sec_id)
        if security is None:
            continue  # orphaned txn row; unreachable through the API (FK), defensive
        shares = sum((p.shares for p in folded), ZERO).quantize(SHARE_Q)
        if shares == 0:
            continue
        cost_basis = sum((p.cost_basis for p in folded), ZERO).quantize(MONEY_Q)
        realized = sum((p.realized_gl for p in folded), ZERO).quantize(MONEY_Q)
        warnings = [w for p in folded for w in p.warnings]
        has_dateless = any(p.has_dateless_txn for p in folded)
        dated_flows = [flow for p in folded for flow in p.dated_flows]
        accounts = sorted({p.account for p in folded})
        collected = div_total.get(sec_id, ZERO).quantize(MONEY_Q)

        latest = latest_by_sec.get(sec_id)
        price = latest.price if latest is not None else None
        bars = history_by_sec.get(sec_id, [])
        prev_close = bars[-2].close if len(bars) >= 2 else None

        market_value = (shares * price).quantize(MONEY_Q) if price is not None else None
        day_pct = day_amt = None
        if price is not None and prev_close is not None and prev_close != 0:
            day_pct = quantize_pct((price - prev_close) / prev_close)
            day_amt = (shares * (price - prev_close)).quantize(MONEY_Q)
        unrealized = unrealized_pct = None
        if market_value is not None:
            unrealized = market_value - cost_basis
            if cost_basis > 0:
                unrealized_pct = quantize_pct(unrealized / cost_basis)
        avg_cost = (cost_basis / shares).quantize(PRICE_Q) if shares > 0 else None
        annual = security.annual_dividend
        annual_income = (annual * shares).quantize(MONEY_Q) if annual is not None else None
        yield_pct = (
            quantize_pct(annual / price)
            if annual is not None and price is not None and price != 0
            else None
        )
        yoc_pct = (
            quantize_pct(annual / avg_cost)
            if annual is not None and avg_cost is not None and avg_cost > 0
            else None
        )
        xirr_pct = None
        if not has_dateless and dated_flows and market_value is not None and shares > 0:
            flows = dated_flows + div_flows.get(sec_id, []) + [(today, market_value)]
            xirr_pct = xirr(flows)

        holdings.append(
            Holding(
                security=security,
                shares=shares,
                avg_cost=avg_cost,
                cost_basis=cost_basis,
                realized_gl=realized,
                dividends_collected=collected,
                accounts=accounts,
                warnings=warnings,
                price=price,
                quoted_at=latest.quoted_at if latest is not None else None,
                price_source=latest.source if latest is not None else None,
                market_value=market_value,
                day_change_pct=day_pct,
                day_change_amount=day_amt,
                unrealized_gl=unrealized,
                unrealized_gl_pct=unrealized_pct,
                annual_income=annual_income,
                yield_pct=yield_pct,
                yoc_pct=yoc_pct,
                xirr_pct=xirr_pct,
            )
        )
    holdings.sort(
        key=lambda h: (h.market_value is None, -(h.market_value or ZERO), h.security.ticker)
    )
    return holdings


def allocation(
    positions: dict[PositionKey, Position],
    securities_by_id: dict[int, Security],
    latest_by_sec: dict[int, LatestPrice],
    by: str,
) -> list[tuple[str, Decimal, int]]:
    """[(bucket key, market value, distinct holdings in bucket)], MV desc then key.
    `by`: 'industry' | 'type' (per-security grain) or 'account' (per-position grain).
    Zero-share and priceless positions are skipped (the endpoint reports the counts)."""
    buckets: dict[str, Decimal] = {}
    members: dict[str, set] = {}
    if by == "account":
        for pos in positions.values():
            latest = latest_by_sec.get(pos.security_id)
            if latest is None or pos.shares.quantize(SHARE_Q) == 0:
                continue
            value = (pos.shares * latest.price).quantize(MONEY_Q)
            buckets[pos.account] = buckets.get(pos.account, ZERO) + value
            members.setdefault(pos.account, set()).add(pos.security_id)
    else:
        shares_by_sec: dict[int, Decimal] = {}
        for pos in positions.values():
            shares_by_sec[pos.security_id] = shares_by_sec.get(pos.security_id, ZERO) + pos.shares
        for sec_id, shares in shares_by_sec.items():
            security = securities_by_id.get(sec_id)
            latest = latest_by_sec.get(sec_id)
            if security is None or latest is None or shares.quantize(SHARE_Q) == 0:
                continue
            key = security.holding_type if by == "type" else (security.industry or "Uncategorized")
            value = (shares * latest.price).quantize(MONEY_Q)
            buckets[key] = buckets.get(key, ZERO) + value
            members.setdefault(key, set()).add(sec_id)
    return sorted(
        ((key, value, len(members[key])) for key, value in buckets.items()),
        key=lambda item: (-item[1], item[0]),
    )


async def load_portfolio(
    db: AsyncSession,
) -> tuple[
    dict[int, Security],
    list[PositionTransaction],
    dict[int, LatestPrice],
    dict[int, list[PriceHistory]],
    list[DividendPayment],
]:
    securities = {s.id: s for s in (await db.execute(select(Security))).scalars()}
    txns = list(
        (
            await db.execute(
                select(PositionTransaction).order_by(
                    PositionTransaction.sort_index, PositionTransaction.id
                )
            )
        ).scalars()
    )
    latest = {p.security_id: p for p in (await db.execute(select(LatestPrice))).scalars()}
    history: dict[int, list[PriceHistory]] = {}
    rows = (
        await db.execute(
            select(PriceHistory).order_by(PriceHistory.security_id, PriceHistory.price_date)
        )
    ).scalars()
    for row in rows:
        history.setdefault(row.security_id, []).append(row)
    dividends = list((await db.execute(select(DividendPayment))).scalars())
    return securities, txns, latest, history, dividends
