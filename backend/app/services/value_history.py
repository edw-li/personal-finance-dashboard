"""Live continuation of the workbook's portfolio value series.

The imported series (PortfolioValueHistory's docstring) grows only when a workbook is
re-imported — which stops the day the sheet is retired. This module appends from the
LIVE book instead, on the SHEET'S OWN CADENCE: one row per week, dated Mondays. The
sheet's automation fired every Monday ~30 minutes after close, so weekly Monday rows are
what the entire imported series is made of. The snapshot rides the Monday leg of the
daily price refresh (13:10 PT is already past the 13:00 close, so it reads the same
finalized closes the sheet did at 13:30; a MANUAL Monday refresh before close records
intraday values, which the scheduled run's same-date upsert overwrites); refreshes on
other days keep quotes fresh but record nothing, and a holiday Monday still records a
row from the latest closes — both exactly the sheet's behavior. A workbook re-import
stays the series' source of truth: apply_portfolio_history overrides live rows wherever
the sheet reaches. This is the
deferred follow-up the performance-chart spec recorded ("considered and deferred; the
schema supports adding it later"), and the thing that lets the parallel run actually end.

Value and cost come from the same fold the holdings table stands on. The S&P leg extends
by IMPLIED SHARES: the latest stored row's sp500_value divided by the baseline ticker's
close on-or-before that row's date is the share count the sheet was tracking; today's leg
is that count × today's close. Re-deriving from the latest row every time needs no stored
constant (the sheet's own never left the sheet) and is idempotent — today's row re-derives
to itself, so a second same-day refresh rewrites the same numbers.
"""

import logging
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import PortfolioValueHistory, PriceHistory, Security
from app.services.portfolio_calc import MONEY_Q, SHARE_Q, fold_transactions, load_portfolio
from app.services.scheduler import product_today

logger = logging.getLogger(__name__)

# The sheet benchmarked its starting balance into VOO (spec "S&P baseline semantics");
# the live leg extends against the same instrument. A constant, not a setting: changing
# the benchmark mid-series would silently splice two different baselines.
BASELINE_TICKER = "VOO"
ZERO = Decimal("0")

# The sheet's series is WEEKLY — one Monday row per week (importer-verified: every
# imported snapshot_date is a Monday). Appending on other days would thicken it into a
# daily series and break parity, so the gate lives here with the series semantics rather
# than in run_refresh: every caller inherits it, manual refreshes included. Weekday is
# judged on the SCHEDULER-ZONE day (product_today): the prod container clock is UTC,
# where Monday evening PT is already Tuesday — date.today() would silently end the series
# under any post-close-evening cron (branch review F1).
SNAPSHOT_WEEKDAY = 0  # Monday, in date.weekday() numbering


async def _baseline_close_on_or_before(db: AsyncSession, day: date) -> Decimal | None:
    return (
        await db.execute(
            select(PriceHistory.close)
            .join(Security, Security.id == PriceHistory.security_id)
            .where(Security.ticker == BASELINE_TICKER, PriceHistory.price_date <= day)
            .order_by(PriceHistory.price_date.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def _extended_baseline(db: AsyncSession, today: date, market_value: Decimal) -> Decimal:
    latest_row = (
        (
            await db.execute(
                select(PortfolioValueHistory)
                .order_by(PortfolioValueHistory.snapshot_date.desc())
                .limit(1)
            )
        )
        .scalars()
        .first()
    )
    if latest_row is None:
        # No series to extend (a book that never imported one): the baseline is REBORN at
        # parity — today's balance hypothetically in the benchmark from today on, which is
        # the sheet's own method restarted at a new t0.
        return market_value
    anchor_close = await _baseline_close_on_or_before(db, latest_row.snapshot_date)
    today_close = await _baseline_close_on_or_before(db, today)
    if anchor_close is None or today_close is None or anchor_close == 0:
        # No benchmark bars (VOO absent or never refreshed): carry the leg flat rather
        # than invent a move the market may not have made.
        logger.info("value snapshot: no %s bars — carrying the S&P leg flat", BASELINE_TICKER)
        return latest_row.sp500_value
    implied_shares = latest_row.sp500_value / anchor_close
    return (implied_shares * today_close).quantize(MONEY_Q, rounding=ROUND_HALF_UP)


async def append_value_snapshot(db: AsyncSession, *, today: date | None = None) -> bool:
    """Upsert this Monday's (market_value, cost_basis, sp500) row from the live book.

    Returns False — writing nothing — on any day but Monday (SNAPSHOT_WEEKDAY: the
    sheet's weekly cadence), and when there is nothing honest to record: no held
    shares, or nothing priced (a zeros row would draw the chart off a cliff). Same-day
    reruns upsert the same date (the importer's own key), so the series never forks.
    Caller commits (refresh_prices' session posture).
    """
    today = today or product_today()
    if today.weekday() != SNAPSHOT_WEEKDAY:
        return False
    _securities, txns, latest, _history, _dividends = await load_portfolio(
        db, with_history=False, with_dividends=False
    )
    positions = fold_transactions(txns)
    shares_by_sec: dict[int, Decimal] = {}
    cost_by_sec: dict[int, Decimal] = {}
    for pos in positions.values():
        shares_by_sec[pos.security_id] = shares_by_sec.get(pos.security_id, ZERO) + pos.shares
        cost_by_sec[pos.security_id] = cost_by_sec.get(pos.security_id, ZERO) + pos.cost_basis
    market_value = ZERO
    cost_basis = ZERO
    any_held = False
    any_priced = False
    for sec_id, raw_shares in shares_by_sec.items():
        shares = raw_shares.quantize(SHARE_Q, rounding=ROUND_HALF_UP)
        if shares == 0:
            continue
        any_held = True
        # Cost accrues for every held row, priced or not — the holdings totals' own
        # semantics (an unpriced private fund still has a basis).
        cost_basis += cost_by_sec.get(sec_id, ZERO)
        quote = latest.get(sec_id)
        if quote is None:
            continue
        any_priced = True
        market_value += (shares * quote.price).quantize(MONEY_Q, rounding=ROUND_HALF_UP)
    if not any_held or not any_priced:
        logger.info("value snapshot skipped: nothing held and priced yet")
        return False
    market_value = market_value.quantize(MONEY_Q, rounding=ROUND_HALF_UP)
    cost_basis = cost_basis.quantize(MONEY_Q, rounding=ROUND_HALF_UP)

    sp500_value = await _extended_baseline(db, today, market_value)
    stmt = pg_insert(PortfolioValueHistory).values(
        snapshot_date=today,
        market_value=market_value,
        cost_basis=cost_basis,
        sp500_value=sp500_value,
    )
    await db.execute(
        stmt.on_conflict_do_update(
            index_elements=["snapshot_date"],
            set_={
                "market_value": stmt.excluded.market_value,
                "cost_basis": stmt.excluded.cost_basis,
                "sp500_value": stmt.excluded.sp500_value,
            },
        )
    )
    return True
