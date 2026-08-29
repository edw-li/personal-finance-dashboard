"""Display-only historical ex-dividend events — the performance chart's older era.

The refresh's dividend ingest only reaches back HISTORY_WINDOW_DAYS (one rolling window,
one HTTP call per ticker), so the chart's pre-window years — back to the workbook's first
weekly snapshot in 2023 — carry no event markers at all. This module fetches each
security's FULL dividend-date history ONCE, off the deep-fetch precedent
price_service.backfill_employer_history already set, and stores it as chart annotations.

THE WRONG-MONEY GUARD (user decision 2026-08-28). These rows are ANNOTATIONS, never money.
The imported book is dateless by construction (PositionTransaction.sort_index), so the
ledger cannot know how many shares were held on a 2024 ex-date — a dollar total here would
be invented, and invented money on a finance dashboard is worse than no money. Nothing in
this module writes dividend_payments, latest_prices, securities.annual_dividend/ex_div_date
or portfolio_value_history: it reads the weekly series for a floor and writes exactly one
table. A stored event carries a per-share amount and nothing else.

Self-extinguishing per security, via securities.dividend_events_synced_on. The marker is
set only when the provider ANSWERED — a raise and an empty bar list both leave it NULL, so
the next refresh retries. That distinction is the load-bearing one: a blocked or
rate-limited yfinance does not raise, it hands back a zero-row frame (measured on the dev
box 2026-08-28), and marking that would extinguish the one-time backfill forever with
nothing stored. A genuine zero-dividend ticker still answers with years of price bars, so
it IS marked, with zero rows — otherwise it would be deep-fetched on every refresh forever.
"""

import asyncio
import logging
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import PortfolioValueHistory, Security, SecurityDividendEvent
from app.services.price_provider import PriceProvider
from app.services.price_service import DIVIDEND_MAX_ABS, HISTORY_WINDOW_DAYS
from app.services.scheduler import product_today

logger = logging.getLogger(__name__)


async def backfill_dividend_events(
    db: AsyncSession, provider: PriceProvider, *, today: date | None = None
) -> dict[str, int]:
    """Deep-fetch and store the pre-window ex-dividend history of every security that has
    never been fetched. Returns {"created", "synced", "failed"}. Caller commits, and the
    caller isolates the whole call behind a savepoint (run_refresh) — this function assumes
    nothing about either."""
    # product_today, never date.today(): the container clock is UTC, and this run's idea of
    # "today" must be the same calendar day refresh_prices used — the window boundary below
    # decides which events belong to the ledger. (run_refresh always passes it explicitly.)
    today = today or product_today()
    counts = {"created": 0, "synced": 0, "failed": 0}
    floor = (
        await db.execute(select(func.min(PortfolioValueHistory.snapshot_date)))
    ).scalar_one_or_none()
    if floor is None:
        # No chart to annotate yet, so nothing is fetched — and, crucially, nothing is
        # MARKED. That is what re-arms the backfill: the first workbook import seeds the
        # weekly series, and the refresh after it runs this against a real floor.
        return counts
    window_start = today - timedelta(days=HISTORY_WINDOW_DAYS)
    securities = list(
        (
            await db.execute(
                select(Security)
                .where(
                    # refresh_prices' population verbatim (active, then auto-priced),
                    # narrowed to what has never been deep-fetched. NO dividend-payer gate:
                    # a zero-payer must get marked, or it refetches forever.
                    Security.is_active.is_(True),
                    Security.is_manual_priced.is_(False),
                    Security.dividend_events_synced_on.is_(None),
                )
                .order_by(Security.ticker)
            )
        ).scalars()
    )
    synced: list[Security] = []
    for security in securities:
        try:
            bars = await asyncio.to_thread(provider.fetch_daily, security.ticker, floor)
        except Exception as exc:  # provider transport errors must never kill the batch
            logger.info("dividend events: %s fetch failed — %s", security.ticker, exc)
            counts["failed"] += 1
            continue
        if not bars:
            # An empty answer is a failure, not a zero-payer — see the module docstring.
            # backfill_employer_history takes the same view of its own empty answer.
            logger.info(
                "dividend events: %s returned no bars — unmarked, retried next run",
                security.ticker,
            )
            counts["failed"] += 1
            continue
        # De-dup by date (last wins) and bound the per-share amount: the PriceProvider
        # contract promises neither unique nor ordered bars, and a duplicate date inside one
        # INSERT is a CardinalityViolation (refresh_prices' documented hazard). Only
        # STRICTLY PRE-window events are kept — the window itself belongs to the ledger
        # (dividend_ingest), and one event must never be both a payment and an annotation.
        events = {
            b.bar_date: b.dividend
            for b in bars
            if b.bar_date < window_start and 0 < b.dividend < DIVIDEND_MAX_ABS
        }
        try:
            # Savepoint per security, refresh_prices' per-ticker isolation: one security's
            # DB failure degrades to a failed[] count instead of poisoning the session and
            # aborting the batch.
            async with db.begin_nested():
                counts["created"] += await _store_events(db, security.id, events)
        except Exception as exc:
            logger.warning("dividend events: storing %s failed — %s", security.ticker, exc)
            counts["failed"] += 1
            continue
        synced.append(security)
    # Marked AFTER the loop, never inside it: a later security's savepoint rollback must
    # have no chance of taking an earlier security's unflushed marker with it.
    for security in synced:
        security.dividend_events_synced_on = today
    counts["synced"] = len(synced)
    if counts["created"] or counts["failed"]:
        logger.info(
            "dividend events backfill: %d markers created, %d securities synced, %d failed",
            counts["created"],
            counts["synced"],
            counts["failed"],
        )
    return counts


async def _store_events(db: AsyncSession, security_id: int, events: dict[date, Decimal]) -> int:
    """Insert this security's markers, skipping the ones already stored. do_nothing, not
    do_update: a stored marker is frozen history, so a re-fetch is a no-op rather than a
    rewrite (the value-snapshot backfill's posture). Returns rows actually written."""
    if not events:
        return 0
    stmt = pg_insert(SecurityDividendEvent).values(
        [
            {"security_id": security_id, "ex_date": ex_date, "per_share": per_share}
            for ex_date, per_share in sorted(events.items())
        ]
    )
    result = await db.execute(
        stmt.on_conflict_do_nothing(index_elements=["security_id", "ex_date"])
    )
    return result.rowcount
