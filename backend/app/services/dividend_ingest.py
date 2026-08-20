"""Automatic dividend ingestion — the refresh's dividend leg.

THE OWNERSHIP CONTRACT (user decision 2026-08-20): the dashboard is the system of record
for dividends. The importer never writes dividend_payments (pinned in
tests/test_importer_apply.py); this module owns rows with source='auto' whose ex_date
falls inside the refresh window, and ONLY for securities that returned bars this run —
it upserts them to match the live book and deletes the ones the book or feed no longer
supports. Manual rows (source='manual') are never touched here.

Amounts: per-share event × shares held ON the ex-date, one row per (security, account).
Shares-on-a-date reuses fold_transactions over the subset of transactions effective by
then — a dateless (sheet-era) row predates the import by construction and counts as
held-from-the-beginning; dated rows apply from their date, splits included (a dated
split after the ex-date must not retroactively scale that dividend). Per-account rows
quantize independently, so a multi-account position's cents can disagree with the
whole-position product by a cent — each row is its own record.
"""

import logging
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import delete, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import DividendPayment, PositionTransaction
from app.services.portfolio_calc import SHARE_Q, fold_transactions
from app.services.price_provider import DailyBar
from app.services.price_service import DIVIDEND_MAX_ABS, HISTORY_WINDOW_DAYS

logger = logging.getLogger(__name__)

MONEY_Q = Decimal("0.01")
# A manual row this close to an event's ex-date is almost certainly the user's own
# record of the same dividend (quarterly spacing is ~91 days, so ±14 cannot straddle two
# events): the whole event is skipped for that security rather than double-counted.
# Deleting the manual row lets auto take over on the next run.
MANUAL_OVERLAP_DAYS = 14


@dataclass
class DividendIngestResult:
    ingested: int = 0  # new auto rows
    updated: int = 0  # existing auto rows rewritten (idempotent re-runs land here)
    removed: int = 0  # in-window auto rows the book/feed no longer supports
    skipped_manual_overlap: int = 0  # whole events skipped because a manual row overlaps


def shares_on(txns: list[PositionTransaction], as_of: date) -> dict[tuple[int, str], Decimal]:
    """Folded shares per (security_id, account) counting only transactions effective by
    `as_of` — dateless rows always, dated rows when txn_date <= as_of. Fold warnings are
    ignored here: only the share counts matter."""
    effective = [t for t in txns if t.txn_date is None or t.txn_date <= as_of]
    return {
        key: pos.shares.quantize(SHARE_Q, rounding=ROUND_HALF_UP)
        for key, pos in fold_transactions(effective).items()
    }


async def ingest_dividends(
    db: AsyncSession, events_by_security: dict[int, list[DailyBar]], *, today: date
) -> DividendIngestResult:
    """Upsert auto dividend rows for this run's events; self-heal in-window auto rows of
    exactly the securities that reported bars. Caller commits, and the caller isolates
    failures behind a savepoint (run_refresh) — this function assumes nothing about
    either."""
    result = DividendIngestResult()
    if not events_by_security:
        return result
    window_start = today - timedelta(days=HISTORY_WINDOW_DAYS)

    txns = list(
        (
            await db.execute(
                select(PositionTransaction).order_by(
                    PositionTransaction.sort_index, PositionTransaction.id
                )
            )
        ).scalars()
    )
    existing = {
        (row.security_id, row.account, row.ex_date): row
        for row in (
            await db.execute(
                select(DividendPayment).where(
                    DividendPayment.source == "auto",
                    DividendPayment.ex_date >= window_start,
                    DividendPayment.security_id.in_(events_by_security.keys()),
                )
            )
        ).scalars()
    }
    manual_dates: dict[int, list[date]] = {}
    for sec_id, pay_date in (
        await db.execute(
            select(DividendPayment.security_id, DividendPayment.pay_date).where(
                DividendPayment.source == "manual",
                DividendPayment.security_id.in_(events_by_security.keys()),
            )
        )
    ).all():
        manual_dates.setdefault(sec_id, []).append(pay_date)

    # One fold per DISTINCT event date across all securities (a handful of dates × tens
    # of transactions — cheap by construction).
    event_dates = sorted(
        {
            b.bar_date
            for bars in events_by_security.values()
            for b in bars
            if b.bar_date >= window_start
        }
    )
    holdings_by_date = {d: shares_on(txns, d) for d in event_dates}

    desired: dict[tuple[int, str, date], dict] = {}
    overlap = timedelta(days=MANUAL_OVERLAP_DAYS)
    for sec_id, bars in events_by_security.items():
        # De-dup by date (last wins) and bound the per-share amount — the provider
        # contract promises neither (refresh_prices' own posture for closes).
        events = {
            b.bar_date: b
            for b in bars
            if b.bar_date >= window_start and 0 < b.dividend < DIVIDEND_MAX_ABS
        }
        for event_date, bar in events.items():
            if any(
                abs(pay_date - event_date) <= overlap
                for pay_date in manual_dates.get(sec_id, [])
            ):
                result.skipped_manual_overlap += 1
                continue
            for (pos_sec_id, account), shares in holdings_by_date[event_date].items():
                if pos_sec_id != sec_id or shares <= 0:
                    continue
                amount = (shares * bar.dividend).quantize(MONEY_Q, rounding=ROUND_HALF_UP)
                if amount == 0:
                    continue  # fractional dust rounds to no money
                desired[(sec_id, account, event_date)] = {
                    "security_id": sec_id,
                    "account": account,
                    # Honest approximation: Yahoo's chart feed carries no payment date.
                    "pay_date": event_date,
                    "amount": amount,
                    "source": "auto",
                    "ex_date": event_date,
                    "per_share": bar.dividend,
                    "shares_held": shares,
                    "notes": None,
                }

    # Self-heal: in-window auto rows of THIS run's securities that the run no longer
    # produces — the event left the feed, the holding became 0 after a transaction fix,
    # or a manual row now overlaps (manual wins; the auto duplicate removes itself).
    stale_ids = [row.id for key, row in existing.items() if key not in desired]
    if stale_ids:
        await db.execute(delete(DividendPayment).where(DividendPayment.id.in_(stale_ids)))
        result.removed = len(stale_ids)

    if desired:
        stmt = pg_insert(DividendPayment).values(list(desired.values()))
        await db.execute(
            stmt.on_conflict_do_update(
                index_elements=["security_id", "account", "ex_date"],
                index_where=text("source = 'auto'"),
                set_={
                    "pay_date": stmt.excluded.pay_date,
                    "amount": stmt.excluded.amount,
                    "per_share": stmt.excluded.per_share,
                    "shares_held": stmt.excluded.shares_held,
                },
            )
        )
        result.ingested = sum(1 for key in desired if key not in existing)
        result.updated = len(desired) - result.ingested
    if result.ingested or result.removed or result.skipped_manual_overlap:
        logger.info(
            "dividend ingest: %d new, %d rewritten, %d removed, %d skipped (manual overlap)",
            result.ingested,
            result.updated,
            result.removed,
            result.skipped_manual_overlap,
        )
    return result
