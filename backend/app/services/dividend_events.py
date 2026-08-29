"""Display-only historical ex-dividend events — the performance chart's older era.

The refresh's dividend ingest only reaches back HISTORY_WINDOW_DAYS (one rolling window,
one HTTP call per ticker), so the chart's pre-window years — back to the workbook's first
weekly snapshot in 2023 — carry no event markers at all. This module fetches each
security's FULL dividend-date history, off the deep-fetch precedent
price_service.backfill_employer_history already set, and stores it as chart annotations.

THE SPLIT: the ledger and the annotations never describe the same event — enforced by
exclusion at write time, not by window arithmetic. Everything from the chart's floor
through today is annotated EXCEPT the (security, ex_date) pairs dividend_payments already
carries with source='auto'. See _ledgered_events for why the window boundary could not do
this job, and for the one residual the frontend's dedupe still covers.

THE WRONG-MONEY GUARD (user decision 2026-08-28). These rows are ANNOTATIONS, never money.
The imported book is dateless by construction (PositionTransaction.sort_index), so the
ledger cannot know how many shares were held on a 2024 ex-date — a dollar total here would
be invented, and invented money on a finance dashboard is worse than no money. Nothing in
this module writes dividend_payments, latest_prices, securities.annual_dividend/ex_div_date
or portfolio_value_history: it reads the weekly series for a floor and writes exactly one
table. A stored event carries a per-share amount and nothing else.

Self-extinguishing per security, via securities.dividend_events_floor — the FLOOR a
successful fetch ran from, not merely the fact that one happened. Recording the floor is
what lets a workbook re-import that extends the weekly series BACKWARD re-arm every security
whose history does not reach the chart's new left edge; a plain "synced on" date would leave
the newly exposed era permanently unannotated.

The floor is recorded only when the provider ANSWERED — a raise and an empty bar list both
leave it untouched, so the next refresh retries. That distinction is the load-bearing one: a
blocked or rate-limited yfinance does not raise, it hands back a zero-row frame (measured on
the dev box 2026-08-28), and recording that would extinguish the fetch with nothing stored.
A genuine zero-dividend ticker still answers with years of price bars, so it IS recorded,
with zero rows — otherwise it would be deep-fetched on every refresh forever. Tickers that
already failed THIS run are skipped outright rather than retried (see skip_tickers).
"""

import asyncio
import logging
from datetime import date
from decimal import Decimal

from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import DividendPayment, PortfolioValueHistory, Security, SecurityDividendEvent
from app.services.price_provider import PriceProvider
from app.services.scheduler import product_today

logger = logging.getLogger(__name__)

# The COLUMN's ceiling, deliberately NOT price_service.DIVIDEND_MAX_ABS (10^6, the bound on
# a TTM SUM). SecurityDividendEvent.per_share is Numeric(10, 6), so 9999.999999 is the
# largest storable value: under the looser bound a glitched feed value anywhere in the
# [10^4, 10^6) band reaches an INSERT that overflows, the overflow rolls the security's
# savepoint back, its marker is never recorded — and because this history is STATIC, the
# same fetch refails on every refresh forever. Bounding here, at the filter, is what makes
# that loop impossible: an out-of-range event is dropped like dust and the security still
# syncs, because a data glitch is not a provider failure.
# SIBLING, known and deliberately unfixed: dividend_ingest writes DividendPayment.per_share
# — also Numeric(10, 6) — under the same DIVIDEND_MAX_ABS, so it carries the same latent
# overflow. It SELF-HEALS there (the ingest simply retries next refresh against a live
# window) instead of extinguishing a one-time fetch, which is why it is not fixed with this.
PER_SHARE_MAX_ABS = Decimal(10) ** 4


async def backfill_dividend_events(
    db: AsyncSession,
    provider: PriceProvider,
    *,
    today: date | None = None,
    skip_tickers: frozenset[str] = frozenset(),
) -> dict[str, int]:
    """Deep-fetch and store the ex-dividend history the auto ledger does not already carry,
    for every security this floor has not been fetched from. Returns {"created", "synced",
    "failed"}. Caller commits, and the caller isolates the whole call behind a savepoint
    (run_refresh) — this function assumes nothing about either.

    `skip_tickers` is THIS run's already-failed tickers (run_refresh passes RefreshResult
    .failed). They are dropped from the population rather than attempted and counted: the
    price leg has just burned one call each, and a second FULL-history call per blocked
    ticker doubles the pressure on the rate limiter that most likely caused the block. A
    skipped security is left unmarked, so the next run tries it normally."""
    # product_today, never date.today(): the container clock is UTC, and this run's idea of
    # "today" must be the same calendar day refresh_prices used — it is the top of the range
    # annotated below. (run_refresh always passes it explicitly.)
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
    candidates = (
        await db.execute(
            select(Security)
            .where(
                # refresh_prices' population verbatim (active, then auto-priced), narrowed
                # to what this floor has not already been fetched from. NO dividend-payer
                # gate: a zero-payer must get marked, or it refetches forever. The floor
                # COMPARISON (not a plain IS NULL) is what re-arms a security after a
                # re-import extends the weekly series backward.
                Security.is_active.is_(True),
                Security.is_manual_priced.is_(False),
                or_(
                    Security.dividend_events_floor.is_(None),
                    Security.dividend_events_floor > floor,
                ),
            )
            .order_by(Security.ticker)
        )
    ).scalars()
    # skip_tickers filtered in Python, not in the predicate: it is empty on every healthy
    # run, and an empty NOT IN is an SQL edge case worth simply not having.
    securities = [s for s in candidates if s.ticker not in skip_tickers]
    if skip_tickers:
        logger.info(
            "dividend events: skipping %d ticker(s) that already failed this run",
            len(skip_tickers),
        )
    ledgered = await _ledgered_events(db, [security.id for security in securities])
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
                "dividend events: %s returned no bars — floor not recorded, retried next run",
                security.ticker,
            )
            counts["failed"] += 1
            continue
        # De-dup by date (last wins) and bound the per-share amount: the PriceProvider
        # contract promises neither unique nor ordered bars, and a duplicate date inside one
        # INSERT is a CardinalityViolation (refresh_prices' documented hazard). Everything
        # from the floor through today is annotated EXCEPT the (security, ex_date) pairs the
        # auto ledger already carries — see _ledgered_events for why that is the split.
        events = {
            b.bar_date: b.dividend
            for b in bars
            if b.bar_date <= today
            and 0 < b.dividend < PER_SHARE_MAX_ABS
            and (security.id, b.bar_date) not in ledgered
        }
        try:
            # Savepoint per security, refresh_prices' per-ticker isolation: one security's
            # DB failure degrades to a counts["failed"] tally instead of poisoning the
            # session and aborting the batch.
            async with db.begin_nested():
                counts["created"] += await _store_events(db, security.id, events)
        except Exception as exc:
            logger.warning("dividend events: storing %s failed — %s", security.ticker, exc)
            counts["failed"] += 1
            continue
        synced.append(security)
    # Marked AFTER the loop, never inside it: a later security's savepoint rollback must
    # have no chance of taking an earlier security's unflushed marker with it. The value is
    # the floor this run FETCHED FROM, so a deeper floor later re-arms the security.
    for security in synced:
        security.dividend_events_floor = floor
    counts["synced"] = len(synced)
    if counts["created"] or counts["failed"]:
        logger.info(
            "dividend events backfill: %d markers created, %d securities synced, %d failed",
            counts["created"],
            counts["synced"],
            counts["failed"],
        )
    return counts


async def _ledgered_events(db: AsyncSession, security_ids: list[int]) -> set[tuple[int, date]]:
    """The (security_id, ex_date) pairs the auto ingest already owns.

    THE SPLIT between the ledger and the annotations, enforced by exclusion at WRITE time
    rather than by window arithmetic. Window arithmetic could not do it: a backfill that
    first runs after the rolling window has slid past a FROZEN auto row would write a marker
    on top of that row (a cross-table duplicate the endpoint promises never exists), and an
    in-window ex-date the ingest produced no row for — nothing held that day, dust that
    rounded to no money, a manual overlap it skipped — would fall into a permanent crack
    once the window moved past it. Excluding exactly the ledgered pairs is timing-
    independent, so the two never describe the same event.

    source='auto' only. Manual rows are the user's own bookkeeping, carry no ex_date, and
    are not a statement about which events exist; the frontend owns that rule.

    ONE RESIDUAL, accepted: a later dateless-transaction edit can make a future ingest
    self-heal an auto row onto a date already annotated here. The frontend's exact
    (security, ex_date) dedupe stays as the second belt for that window of time.
    """
    if not security_ids:
        return set()
    rows = await db.execute(
        select(DividendPayment.security_id, DividendPayment.ex_date).where(
            DividendPayment.source == "auto",
            DividendPayment.ex_date.is_not(None),
            DividendPayment.security_id.in_(security_ids),
        )
    )
    # Per-account rows mean the same pair can appear several times — a set, not a list.
    return {(security_id, ex_date) for security_id, ex_date in rows.all()}


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
