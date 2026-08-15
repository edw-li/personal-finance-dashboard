"""Price refresh + manual price writes. The ONLY writers of latest_prices/price_history
after import seeding (Plan 2 note: the importer is insert-only and never updates prices).

Refresh strategy (locked decision): every run re-fetches a full 370-day daily window per
ticker (one HTTP call either way) and idempotently upserts — first run backfills ~1yr of
history (spec §4), later runs self-heal any gap, and the same bars carry the dividend
events that maintain securities.annual_dividend/ex_div_date (TTM view). Failures are
per-ticker: last good price stays (spec §5).

Commits the session it is given — callers must not hold unrelated pending state."""

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import LatestPrice, PriceHistory, Security
from app.services.price_provider import DailyBar, PriceProvider

logger = logging.getLogger(__name__)

HISTORY_WINDOW_DAYS = 370
TTM_DAYS = 365
PRICE_MAX_ABS = Decimal(10) ** 10  # == money.MONEY_MAX_ABS_14_4 (money.py is
# request-vocabulary/422; this module records failures instead)
DIVIDEND_MAX_ABS = Decimal(10) ** 6  # == money.MONEY_MAX_ABS_10_4
ERROR_SNIPPET_LEN = 200


@dataclass
class RefreshResult:
    updated: list[str] = field(default_factory=list)
    failed: dict[str, str] = field(default_factory=dict)
    skipped_manual: list[str] = field(default_factory=list)


def _expire_price_rows(db: AsyncSession) -> None:
    """Drop cached LatestPrice/PriceHistory instances so same-session readers re-SELECT
    (core upserts bypass the identity map). Targeted, NOT `expire_all()`: expiring a
    caller-held object makes its next plain attribute access emit lazy IO, which raises
    MissingGreenlet under asyncio — and every caller holds the Security it passed in."""
    for obj in list(db.identity_map.values()):
        if isinstance(obj, LatestPrice | PriceHistory):
            db.expire(obj)


def _bar_datetime(day: date) -> datetime:
    # quoted_at reflects DATA age (the bar's date), not fetch time — the UI's staleness
    # display is honest even when Yahoo serves Friday's close on a Sunday.
    return datetime.combine(day, time(0), tzinfo=UTC)


async def refresh_prices(
    db: AsyncSession, provider: PriceProvider, *, today: date | None = None
) -> RefreshResult:
    today = today or date.today()
    start = today - timedelta(days=HISTORY_WINDOW_DAYS)
    result = RefreshResult()
    securities = list(
        (
            await db.execute(
                select(Security).where(Security.is_active.is_(True)).order_by(Security.ticker)
            )
        ).scalars()
    )
    latest_rows: list[dict] = []
    for security in securities:
        if security.is_manual_priced:
            result.skipped_manual.append(security.ticker)
            continue
        try:
            bars = await asyncio.to_thread(provider.fetch_daily, security.ticker, start)
        except Exception as exc:  # provider transport errors must never kill the batch
            result.failed[security.ticker] = f"{type(exc).__name__}: {exc}"[:ERROR_SNIPPET_LEN]
            continue
        # De-dup by date (last wins) and bound values — the PriceProvider contract
        # promises neither unique nor ordered bars, and a duplicate date inside one
        # INSERT is a CardinalityViolation. (Bars are 4dp from our provider; the bound
        # matches Numeric(14,4) only under that invariant.)
        bars = list({b.bar_date: b for b in bars if 0 < b.close < PRICE_MAX_ABS}.values())
        if not bars:
            result.failed[security.ticker] = "no data returned"
            continue
        last = max(bars, key=lambda b: b.bar_date)
        history_stmt = pg_insert(PriceHistory).values(
            [{"security_id": security.id, "price_date": b.bar_date, "close": b.close} for b in bars]
        )
        try:
            # Savepoint: one ticker's DB failure degrades to a failed[] entry instead
            # of aborting the batch and poisoning the session (per-ticker isolation).
            async with db.begin_nested():
                await db.execute(
                    history_stmt.on_conflict_do_update(
                        index_elements=["security_id", "price_date"],
                        set_={"close": history_stmt.excluded.close},
                    )
                )
        except Exception as exc:
            result.failed[security.ticker] = f"{type(exc).__name__}: {exc}"[:ERROR_SNIPPET_LEN]
            continue
        latest_rows.append(
            {
                "security_id": security.id,
                "price": last.close,
                "quoted_at": _bar_datetime(last.bar_date),
                "source": "yfinance",
            }
        )
        _update_dividend_metadata(security, bars, today)
        result.updated.append(security.ticker)
    if latest_rows:
        # Plan 1 forward note: one bulk ON CONFLICT DO UPDATE for the whole ticker batch.
        latest_stmt = pg_insert(LatestPrice).values(latest_rows)
        await db.execute(
            latest_stmt.on_conflict_do_update(
                index_elements=["security_id"],
                set_={
                    "price": latest_stmt.excluded.price,
                    "quoted_at": latest_stmt.excluded.quoted_at,
                    "source": latest_stmt.excluded.source,
                },
            )
        )
    await db.commit()
    # Core upserts bypass the identity map — expire so same-session readers (the POST
    # /prices/refresh request) see the new rows, not pre-write cache (Task 6 review).
    _expire_price_rows(db)
    if result.failed:
        logger.warning("price refresh failures: %s", sorted(result.failed.items()))
    return result


def _update_dividend_metadata(security: Security, bars: list[DailyBar], today: date) -> None:
    """TTM dividend sum + last event date. Replaces the sheet's broken GOOGLEFINANCE
    leftovers (plan probe 5); a manual edit on an auto-priced security is overwritten
    next refresh by design."""
    window_start = today - timedelta(days=TTM_DAYS)
    events = [b for b in bars if b.dividend > 0 and b.bar_date > window_start]
    ttm = sum((b.dividend for b in events), Decimal("0"))
    if ttm >= DIVIDEND_MAX_ABS:
        logger.warning(
            "%s: absurd TTM dividend %s — keeping previous metadata", security.ticker, ttm
        )
        return  # absurd feed value; keep the previous metadata
    security.annual_dividend = ttm.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
    security.ex_div_date = max((b.bar_date for b in events), default=None)


async def set_manual_price(
    db: AsyncSession, security: Security, price: Decimal, as_of: date
) -> None:
    """Manual quote for is_manual_priced securities. Always writes a price_history row
    for `as_of` (sparkline backfill); updates latest_prices ONLY when `as_of` is not
    older than the newest history bar — a backdated entry must never move the latest
    quote backwards, or day-Δ (which reads bars[-2] against the latest price) would
    compare the quote against itself forever (Task 4 review). Caller commits."""
    history_stmt = pg_insert(PriceHistory).values(
        security_id=security.id, price_date=as_of, close=price
    )
    await db.execute(
        history_stmt.on_conflict_do_update(
            index_elements=["security_id", "price_date"],
            set_={"close": history_stmt.excluded.close},
        )
    )
    newest_bar = (
        await db.execute(
            select(func.max(PriceHistory.price_date)).where(PriceHistory.security_id == security.id)
        )
    ).scalar_one()
    existing = await db.get(LatestPrice, security.id)
    # The as_of row itself is already in history, so newest_bar >= as_of always holds
    # for the same-day path; the guard fires only when something NEWER exists in either
    # history or the (possibly import-seeded) latest quote.
    newest_known = newest_bar
    if existing is not None:
        newest_known = max(newest_known, existing.quoted_at.date())
    if newest_known is not None and as_of < newest_known:
        return
    latest_stmt = pg_insert(LatestPrice).values(
        security_id=security.id, price=price, quoted_at=_bar_datetime(as_of), source="manual"
    )
    await db.execute(
        latest_stmt.on_conflict_do_update(
            index_elements=["security_id"],
            set_={
                "price": latest_stmt.excluded.price,
                "quoted_at": latest_stmt.excluded.quoted_at,
                "source": latest_stmt.excluded.source,
            },
        )
    )
    # Same identity-map hazard as refresh_prices: the PUT endpoint re-reads LatestPrice
    # on this session right after. No pending ORM state exists on this path.
    _expire_price_rows(db)
