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
from typing import TYPE_CHECKING

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AppSetting, LatestPrice, PriceHistory, RsuGrant, Security
from app.services.price_provider import DailyBar, PriceProvider
from app.services.scheduler import product_today

if TYPE_CHECKING:
    # Annotation only: dividend_ingest imports THIS module, so a runtime import here
    # would be circular (run_refresh imports it lazily, inside the function).
    from app.services.dividend_ingest import DividendIngestResult

logger = logging.getLogger(__name__)

# app_settings key for the last refresh run's outcome — the status endpoint's and the
# attention strip's feed. "What happened last" stays a single JSON blob; the last-10
# TRAIL lives beside it under REFRESH_RUNS_KEY (2026-08-31 spec §B3) — still app_settings,
# still no migration, history capped at write time.
LAST_REFRESH_KEY = "last_refresh"
REFRESH_RUNS_KEY = "refresh_runs"
REFRESH_RUNS_KEEP = 10

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
    # Per-security dividend events seen in this run's bars (updated tickers only) —
    # run_refresh hands them to dividend_ingest so the Yahoo fetch happens exactly once.
    dividend_events: dict[int, list[DailyBar]] = field(default_factory=dict)
    # Announced-ex-div leg (calendar spec §3.3): fetch attempts that answered vs raised.
    # Deliberately NOT in failed[] — a calendar hiccup must not read as a price failure.
    ex_div_fetched: int = 0
    ex_div_failed: int = 0


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
    # product_today, never date.today(): the container clock is UTC, and the run's
    # calendar day (fetch window, snapshot key, TTM window) must match the fire zone.
    today = today or product_today()
    start = today - timedelta(days=HISTORY_WINDOW_DAYS)
    result = RefreshResult()
    securities = list(
        (
            await db.execute(
                select(Security).where(Security.is_active.is_(True)).order_by(Security.ticker)
            )
        ).scalars()
    )
    for security in securities:
        # §3.3, independent of any fetch and BEFORE it: a stored announced date that has
        # passed is cleared for every loaded (active) security — manual-priced and
        # about-to-fail tickers included — because the event has occurred and the
        # historical bars own it now (ex_div_date's territory). The last-good posture in
        # the loop below therefore only ever preserves a still-FUTURE date. Inactive
        # securities are not loaded here; their stale dates are invisible to the
        # calendar (it reads active holdings) and clear on reactivation's next run.
        if security.next_ex_div_date is not None and security.next_ex_div_date < today:
            security.next_ex_div_date = None
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
        if security.annual_dividend is not None and security.annual_dividend > 0:
            # Active + auto-priced are already this loop's population; dividend-paying
            # (per the TTM metadata just written) gates the extra HTTP call (§3.3).
            try:
                announced = await asyncio.to_thread(provider.fetch_next_ex_div, security.ticker)
            except Exception:
                # Last-good: the (already swept) stored value stands; never the batch's
                # problem and never failed[] — prices and announcements fail separately.
                result.ex_div_failed += 1
            else:
                result.ex_div_fetched += 1
                # Store only a confirmed UPCOMING date; "nothing announced" and an
                # already-past announcement both leave NULL (spec §3.3).
                security.next_ex_div_date = (
                    announced if announced is not None and announced >= today else None
                )
        # ALWAYS recorded for an updated ticker, even when empty: the self-heal scope is
        # "returned bars this run" (spec §2), so a book whose in-window events all
        # vanished from the feed still gets its stale auto rows removed. A transient feed
        # drop therefore churns rows away and back rather than leaving ghost income
        # standing for up to 370 days (branch review I1).
        result.dividend_events[security.id] = [b for b in bars if b.dividend > 0]
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


# The deep window reaches a little past the earliest vest so the on-or-before lookup always
# has a bar to land on even when the vest date itself was a holiday.
EMPLOYER_BACKFILL_BUFFER_DAYS = 14
# The watermark that makes the extinguish AIRTIGHT (branch review I1): when the provider's
# own history starts after `needed` (an employer that listed later, a depth-capped feed),
# the oldest-bar check alone would re-run the deep fetch on every refresh forever. After any
# successful deep fetch the request's floor is recorded here, and a request no deeper than a
# recorded one is skipped; an older grant lowers `needed` past the watermark and re-arms it.
EMPLOYER_BACKFILL_KEY = "employer_backfill_floor"


async def backfill_employer_history(db: AsyncSession, provider: PriceProvider) -> int:
    """One-time deep backfill of the employer ticker's daily closes, back past the earliest
    RSU grant's first vest (2026-08-21: the vesting schedule prices past tranches at their
    own vest-date closes, and the standing HISTORY_WINDOW_DAYS refresh window cannot reach a
    grant that began vesting years ago — those vests rendered "no stored price" forever).

    Self-extinguishing two ways: the oldest stored bar reaching the needed date (the normal
    case), or the recorded watermark saying this depth was already fetched (the provider's
    history simply starts later). Either way a later call is a handful of point SELECTs and
    out, re-arming only if an older grant is added. Skips quietly when there is no employer
    ticker, no matching security, no grants, or the security is manual-priced (its bars are
    hand entries, and a provider fetch would be a second opinion about them). Bars upsert
    exactly like refresh_prices'; latest_prices and the TTM dividend metadata are
    deliberately NOT touched — this is history repair, not a quote refresh. Returns the
    number of bars written (0 on every skip). Caller commits.
    """
    setting = await db.get(AppSetting, "espp_ticker")
    if setting is None or not isinstance(setting.value, dict):
        return 0
    raw = setting.value.get("value")
    ticker = raw.strip().upper() if isinstance(raw, str) else ""
    if not ticker:
        return 0
    security = (
        (await db.execute(select(Security).where(Security.ticker == ticker))).scalars().first()
    )
    if security is None or security.is_manual_priced:
        return 0
    earliest_vest = (
        await db.execute(select(func.min(RsuGrant.first_vest_date)))
    ).scalar_one_or_none()
    if earliest_vest is None:
        return 0
    needed = earliest_vest - timedelta(days=EMPLOYER_BACKFILL_BUFFER_DAYS)
    oldest_bar = (
        await db.execute(
            select(func.min(PriceHistory.price_date)).where(PriceHistory.security_id == security.id)
        )
    ).scalar_one_or_none()
    if oldest_bar is not None and oldest_bar <= needed:
        return 0
    if _watermark_covers(await db.get(AppSetting, EMPLOYER_BACKFILL_KEY), ticker, needed):
        return 0
    bars = await asyncio.to_thread(provider.fetch_daily, security.ticker, needed)
    # Same de-dup and bounds as refresh_prices: the provider promises neither unique nor
    # ordered bars, and a duplicate date inside one INSERT is a CardinalityViolation.
    bars = list({b.bar_date: b for b in bars if 0 < b.close < PRICE_MAX_ABS}.values())
    if not bars:
        # NOT watermarked: an empty answer is as likely a transient provider hiccup as a
        # real floor, and retrying tomorrow costs one call.
        logger.info("employer backfill: %s returned no bars for the deep window", ticker)
        return 0
    stmt = pg_insert(PriceHistory).values(
        [{"security_id": security.id, "price_date": b.bar_date, "close": b.close} for b in bars]
    )
    await db.execute(
        stmt.on_conflict_do_update(
            index_elements=["security_id", "price_date"],
            set_={"close": stmt.excluded.close},
        )
    )
    _expire_price_rows(db)
    await _record_backfill_watermark(db, ticker, needed)
    floor = min(b.bar_date for b in bars)
    if floor > needed:
        logger.info(
            "employer backfill: %s history starts %s, after the needed %s — recorded; "
            "no refetch unless an older grant appears",
            ticker,
            floor,
            needed,
        )
    logger.info(
        "employer backfill: %d %s bars fetched for the window from %s (earliest vest %s)",
        len(bars),
        ticker,
        needed,
        earliest_vest,
    )
    return len(bars)


def _watermark_covers(setting: AppSetting | None, ticker: str, needed: date) -> bool:
    """Whether a recorded deep fetch already reached at least as far back as `needed` for
    THIS ticker. Envelope-degrading like every app_settings read: any unexpected shape reads
    as "no watermark" and the fetch simply runs again."""
    if setting is None or not isinstance(setting.value, dict):
        return False
    value = setting.value.get("value")
    if not isinstance(value, dict) or value.get("ticker") != ticker:
        return False
    through = value.get("through")
    if not isinstance(through, str):
        return False
    try:
        return date.fromisoformat(through) <= needed
    except ValueError:
        return False


async def _record_backfill_watermark(db: AsyncSession, ticker: str, needed: date) -> None:
    payload = {"value": {"ticker": ticker, "through": needed.isoformat()}}
    setting = await db.get(AppSetting, EMPLOYER_BACKFILL_KEY)
    if setting is None:
        db.add(AppSetting(key=EMPLOYER_BACKFILL_KEY, value=payload))
    else:
        setting.value = payload


async def record_refresh_run(
    db: AsyncSession,
    result: RefreshResult,
    *,
    trigger: str,
    history_appended: bool,
    at: datetime,
    dividends: "DividendIngestResult | None" = None,
    dividend_events: dict[str, int] | None = None,
) -> None:
    """Persist the run's outcome under app_settings[LAST_REFRESH_KEY], envelope
    {"value": ...} (the readers' convention), and append a compact record to
    app_settings[REFRESH_RUNS_KEY] — newest first, last REFRESH_RUNS_KEEP kept, any
    malformed stored shape silently restarted. Caller commits."""
    payload = {
        "at": at.isoformat(),
        "trigger": trigger,
        "updated": len(result.updated),
        "failed": dict(sorted(result.failed.items())),
        "skipped_manual": len(result.skipped_manual),
        "history_appended": history_appended,
        "ex_div_fetched": result.ex_div_fetched,
        "ex_div_failed": result.ex_div_failed,
        "dividends_ingested": dividends.ingested if dividends is not None else 0,
        "dividends_removed": dividends.removed if dividends is not None else 0,
        "dividends_skipped_overlap": (
            dividends.skipped_manual_overlap if dividends is not None else 0
        ),
        # A nested dict, not three more flat keys: the historical-events backfill is its own
        # leg with its own vocabulary, and one key keeps the flat dividend_* family reading
        # as the ingest's alone. None means the leg CRASHED and its counts are unknown —
        # never a fabricated zero. LastRefreshOut takes it OPTIONAL either way, because every
        # blob written before 2026-08-28 lacks the key entirely and must still parse.
        "dividend_events": dict(dividend_events) if dividend_events is not None else None,
    }
    setting = await db.get(AppSetting, LAST_REFRESH_KEY)
    if setting is None:
        db.add(AppSetting(key=LAST_REFRESH_KEY, value={"value": payload}))
    else:
        setting.value = {"value": payload}

    run_entry = {
        "at": at.isoformat(),
        "trigger": trigger,
        "updated": len(result.updated),
        "failed_count": len(result.failed),
    }
    runs_setting = await db.get(AppSetting, REFRESH_RUNS_KEY)
    prior: list[dict] = []
    if runs_setting is not None and isinstance(runs_setting.value, dict):
        raw = runs_setting.value.get("value")
        if isinstance(raw, list):
            # Non-dict stragglers are dropped rather than preserved: this trail is an
            # operational nicety, and self-healing beats faithfully re-storing garbage.
            prior = [item for item in raw if isinstance(item, dict)]
    runs_payload = {"value": [run_entry, *prior][:REFRESH_RUNS_KEEP]}
    if runs_setting is None:
        db.add(AppSetting(key=REFRESH_RUNS_KEY, value=runs_payload))
    else:
        runs_setting.value = runs_payload


async def read_last_refresh(db: AsyncSession) -> dict | None:
    """The stored outcome, or None before the first recorded run (or on any unexpected
    shape — the envelope is convention-only, net_worth_calc.get_swr_pct's posture)."""
    setting = await db.get(AppSetting, LAST_REFRESH_KEY)
    if setting is None or not isinstance(setting.value, dict):
        return None
    raw = setting.value.get("value")
    return raw if isinstance(raw, dict) else None


async def run_refresh(
    db: AsyncSession, provider: PriceProvider, *, trigger: str, today: date | None = None
) -> tuple[RefreshResult, bool, "DividendIngestResult"]:
    """The whole refresh ritual, shared by the manual endpoint and the scheduled job so
    the two can never drift: refresh prices (commits itself), backfill and extend the
    weekly value series, ingest dividend events, backfill the chart's pre-window historical
    ex-dividend markers, record the outcome, commit the bookkeeping. Snapshot, ingest and
    marker failures each degrade alone — the price refresh always stands."""
    from app.services.dividend_events import backfill_dividend_events
    from app.services.dividend_ingest import DividendIngestResult, ingest_dividends
    from app.services.value_history import append_value_snapshot, backfill_missed_snapshots

    today = today or product_today()
    result = await refresh_prices(db, provider, today=today)
    # Deep employer history first (its own savepoint, its own quiet failure): the vest
    # calendar prices past tranches at their own closes, and this is the one step that can
    # reach bars older than the refresh window. Self-extinguishing after the first success.
    try:
        async with db.begin_nested():
            await backfill_employer_history(db, provider)
    except Exception:
        logger.exception("employer history backfill failed — the price refresh stands")
    # Backfill first — missed Mondays extend the series chronologically off the bar
    # window refresh_prices just healed — then the Monday leg for today itself. Either
    # movement flips the payload's history_appended flag. One savepoint EACH ("each
    # degrade alone"): a backfill failure must not suppress today's live append, and an
    # append failure must not destroy the backfilled rows (branch review S1).
    appended = False
    try:
        async with db.begin_nested():
            appended = await backfill_missed_snapshots(db, today=today) > 0
    except Exception:
        logger.exception("value backfill failed — the price refresh stands")
    try:
        async with db.begin_nested():
            appended = await append_value_snapshot(db, today=today) or appended
    except Exception:
        logger.exception("value snapshot failed — the price refresh stands")
    dividends = DividendIngestResult()
    try:
        # Savepoint, not rollback-on-failure: a rollback here would also destroy the
        # uncommitted value snapshot above; the savepoint isolates the ingest alone.
        async with db.begin_nested():
            dividends = await ingest_dividends(db, result.dividend_events, today=today)
    except Exception:
        logger.exception("dividend ingest failed — the price refresh stands")
        dividends = DividendIngestResult()
    # AFTER the ingest, and that ORDER is load-bearing: the backfill excludes exactly the
    # (security, ex_date) pairs the ingest just wrote, so the ledger's rows must already be
    # in the session when the annotations are chosen. Its own savepoint, for the ingest's
    # reason: a plain rollback here would destroy the still-uncommitted value snapshot
    # above, while the savepoint isolates the backfill alone. Self-extinguishing per
    # security, so on a settled database this is one indexed SELECT and out.
    #
    # None on failure, never zeros: a crash OUTSIDE the per-security savepoints (the floor
    # SELECT, the marker flush) has no idea what it did or did not write, and recording
    # {0, 0, 0} would fabricate a clean run indistinguishable from a settled book on every
    # status surface. None is the pre-feature "unknown" every reader already handles.
    dividend_events: dict[str, int] | None = None
    try:
        async with db.begin_nested():
            dividend_events = await backfill_dividend_events(
                db,
                provider,
                today=today,
                # This run's failures, so a blocked provider gets N doomed calls per refresh
                # and not 2N — the deep fetch must not amplify pressure on the rate limiter
                # that is most likely causing the block.
                skip_tickers=frozenset(result.failed),
            )
    except Exception:
        logger.exception(
            "dividend events backfill failed — the price refresh stands; this run's marker "
            "counts are UNKNOWN, recorded as null rather than as a clean zero"
        )
        dividend_events = None
    await record_refresh_run(
        db,
        result,
        trigger=trigger,
        history_appended=appended,
        at=datetime.now(UTC),
        dividends=dividends,
        dividend_events=dividend_events,
    )
    await db.commit()
    return result, appended, dividends


async def set_manual_price(
    db: AsyncSession, security: Security, price: Decimal, as_of: date
) -> None:
    """Manual quote for is_manual_priced securities. Always writes a price_history row
    for `as_of` (sparkline backfill); updates latest_prices ONLY when `as_of` is not
    older than the newest known quote (history bars OR the import-seeded latest) — a
    backdated entry must never move the latest quote backwards, or day-Δ (which reads
    bars[-2] against the latest price) would compare the quote against itself forever
    (Task 4 review). Caller commits. Expired rows: callers must re-read LatestPrice/
    PriceHistory with `await db.get(...)` after this call — a previously-held instance's
    plain attribute access raises MissingGreenlet (Task 6 re-review)."""
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
    # The as_of row itself was just inserted above, so newest_bar is never None and
    # newest_bar >= as_of always holds for the same-day path; the guard fires only when
    # something NEWER exists in either history or the (import-seeded) latest quote.
    newest_known = newest_bar
    if existing is not None:
        newest_known = max(newest_known, existing.quoted_at.date())
    if as_of < newest_known:
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
