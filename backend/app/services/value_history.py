"""Live continuation of the workbook's portfolio value series.

The imported series (PortfolioValueHistory's docstring) grows only when a workbook is
re-imported — which stops the day the sheet is retired. This module appends from the
LIVE book instead, on the SHEET'S OWN CADENCE: one row per week, dated Mondays. The
sheet's automation fired every Monday ~30 minutes after close, so weekly Monday rows are
what the entire imported series is made of. The snapshot rides the Monday leg of the
daily price refresh (13:10 PT is already past the 13:00 close, so it reads the same
finalized closes the sheet did at 13:30; a MANUAL Monday refresh before close records
intraday values, which the scheduled run's same-date upsert overwrites); refreshes on
other days keep quotes fresh and backfill any Monday the host slept through
(backfill_missed_snapshots), and a holiday Monday still records a row from the latest
closes — all exactly the sheet's behavior. A workbook re-import
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
from collections.abc import Callable
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import LatestPrice, PortfolioValueHistory, PriceHistory, Security
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


async def _current_book(
    db: AsyncSession,
) -> tuple[dict[int, Decimal], dict[int, Decimal], dict[int, LatestPrice]]:
    """Per-security shares and cost from the live fold — the holdings table's own
    numbers — plus the latest quotes. Positions are mostly undated by design
    (PositionTransaction.sort_index), so the CURRENT share count is the only one
    there is; every snapshot, live or backfilled, prices this book."""
    _securities, txns, latest, _history, _dividends = await load_portfolio(
        db, with_history=False, with_dividends=False
    )
    positions = fold_transactions(txns)
    shares_by_sec: dict[int, Decimal] = {}
    cost_by_sec: dict[int, Decimal] = {}
    for pos in positions.values():
        shares_by_sec[pos.security_id] = shares_by_sec.get(pos.security_id, ZERO) + pos.shares
        cost_by_sec[pos.security_id] = cost_by_sec.get(pos.security_id, ZERO) + pos.cost_basis
    return shares_by_sec, cost_by_sec, latest


def _value_book(
    shares_by_sec: dict[int, Decimal],
    cost_by_sec: dict[int, Decimal],
    price_for: Callable[[int], Decimal | None],
) -> tuple[Decimal, Decimal, bool, bool]:
    """Value the folded book against `price_for`. Returns (market_value, cost_basis,
    any_held, any_priced). Cost accrues for every held row, priced or not — the holdings
    totals' own semantics (an unpriced private fund still has a basis)."""
    market_value = ZERO
    cost_basis = ZERO
    any_held = False
    any_priced = False
    for sec_id, raw_shares in shares_by_sec.items():
        shares = raw_shares.quantize(SHARE_Q, rounding=ROUND_HALF_UP)
        if shares == 0:
            continue
        any_held = True
        cost_basis += cost_by_sec.get(sec_id, ZERO)
        price = price_for(sec_id)
        if price is None:
            continue
        any_priced = True
        market_value += (shares * price).quantize(MONEY_Q, rounding=ROUND_HALF_UP)
    return (
        market_value.quantize(MONEY_Q, rounding=ROUND_HALF_UP),
        cost_basis.quantize(MONEY_Q, rounding=ROUND_HALF_UP),
        any_held,
        any_priced,
    )


async def _closes_on_or_before(db: AsyncSession, day: date) -> dict[int, Decimal]:
    """Newest stored close per security on-or-before `day` — the backfill's price book
    (one window-ranked query, not one per held security)."""
    ranked = (
        select(
            PriceHistory.security_id,
            PriceHistory.close,
            func.row_number()
            .over(partition_by=PriceHistory.security_id, order_by=PriceHistory.price_date.desc())
            .label("rn"),
        )
        .where(PriceHistory.price_date <= day)
        .subquery()
    )
    rows = await db.execute(select(ranked.c.security_id, ranked.c.close).where(ranked.c.rn == 1))
    return dict(rows.all())


def contribution_benchmark(
    rows: list[tuple[date, Decimal, Decimal]],
    closes: dict[date, Decimal],
) -> list[Decimal | None]:
    """The contribution-matched benchmark: what the book would be worth had every
    inferred contribution bought BASELINE_TICKER instead (2026-08-24 spec §2).

    Pure of the DB: `rows` are (snapshot_date, market_value, cost_basis) ascending;
    `closes` maps snapshot dates to the benchmark close on-or-before them
    (baseline_closes_for). Week-over-week cost-basis deltas proxy the flows — positions
    are mostly undated by design, so no dated-transaction series exists to sum.

        benchmark[0] = market_value[0]                      # parity seed, the sheet's own t0
        flow[t]      = cost_basis[t] - cost_basis[t-1]
        benchmark[t] = benchmark[t-1] * (close[t]/close[t-1]) + flow[t]

    Each row quantizes to MONEY_Q HALF_UP and the NEXT step chains on the quantized
    value — the S&P leg's own anchoring (every stored row anchors the next), which is
    what makes a same-day recompute reproduce itself to the cent. All-None only when
    there are no benchmark bars AT ALL: the read path degrades, never rejects.
    """
    if not rows:
        return []
    if not closes:
        return [None] * len(rows)
    series: list[Decimal | None] = []
    prev_value: Decimal | None = None
    prev_close: Decimal | None = None
    prev_cost = ZERO
    for snapshot_date, market_value, cost_basis in rows:
        close = closes.get(snapshot_date)
        if prev_value is None:
            value = market_value.quantize(MONEY_Q, rounding=ROUND_HALF_UP)
        else:
            flow = cost_basis - prev_cost
            value = (prev_value * (close / prev_close) + flow).quantize(
                MONEY_Q, rounding=ROUND_HALF_UP
            )
        series.append(value)
        prev_value = value
        prev_cost = cost_basis
        prev_close = close
    return series


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
    shares_by_sec, cost_by_sec, latest = await _current_book(db)
    market_value, cost_basis, any_held, any_priced = _value_book(
        shares_by_sec,
        cost_by_sec,
        lambda sec_id: quote.price if (quote := latest.get(sec_id)) is not None else None,
    )
    if not any_held or not any_priced:
        logger.info("value snapshot skipped: nothing held and priced yet")
        return False

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


async def backfill_missed_snapshots(db: AsyncSession, *, today: date | None = None) -> int:
    """Fill Mondays the host slept straight through (branch review F2): every refresh —
    any weekday — extends the series to the current week by pricing TODAY'S book at each
    missed Monday's stored closes. run_refresh calls this right after refresh_prices, so
    a Tuesday boot prices yesterday's TRUE closes off the just-healed bar window; if the
    feed is down too, the newest earlier close carries — the sheet's own "latest closing
    prices". The current share count stands in for each Monday's (positions are mostly
    undated by design, so no other exists); a trade made after a missed Monday skews that
    fill slightly — accepted, a hole is worse. Today itself is never backfilled: the
    Monday leg of append_value_snapshot prices it from live quotes. Each holding prices
    at the newest stored close on-or-before that Monday, falling back to its standing
    latest quote when that quote already existed by then — import-seeded and manual-priced
    securities may have no bars at all, and omitting them dents the fill against its live
    neighbors (review I1); a quote from after the Monday is future knowledge and stays
    out. A Monday NOTHING reaches stays a hole rather than a guess. Returns rows written;
    0 with no series to extend (a book that never imported one starts at its first live
    Monday instead). Caller commits (refresh_prices' session posture)."""
    today = today or product_today()
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
        return 0
    anchor = latest_row.snapshot_date
    first_missing = anchor + timedelta(days=(7 - anchor.weekday()) % 7 or 7)
    last_monday = today - timedelta(days=today.weekday())
    mondays = []
    day = first_missing
    while day <= last_monday:
        if day != today:
            mondays.append(day)
        day += timedelta(days=7)
    if not mondays:
        return 0
    shares_by_sec, cost_by_sec, latest = await _current_book(db)
    if not any(
        raw.quantize(SHARE_Q, rounding=ROUND_HALF_UP) != 0 for raw in shares_by_sec.values()
    ):
        return 0  # empty book: no Monday can be honestly filled
    written = 0
    for monday in mondays:
        closes = await _closes_on_or_before(db, monday)

        def price_at(sec_id: int, closes=closes, monday=monday) -> Decimal | None:
            close = closes.get(sec_id)
            if close is not None:
                return close
            quote = latest.get(sec_id)
            if quote is not None and quote.quoted_at.date() <= monday:
                return quote.price
            return None

        market_value, cost_basis, _any_held, any_priced = _value_book(
            shares_by_sec, cost_by_sec, price_at
        )
        if not any_priced:
            # Deliberate hole, said out loud (the fills at the bottom already log): an ops
            # log where only successes speak makes "no row" read as a bug.
            logger.info("value snapshot: missed Monday %s has no prices — left a hole", monday)
            continue
        # Chronological order on purpose: each fill becomes the next one's S&P anchor.
        sp500_value = await _extended_baseline(db, monday, market_value)
        stmt = pg_insert(PortfolioValueHistory).values(
            snapshot_date=monday,
            market_value=market_value,
            cost_basis=cost_basis,
            sp500_value=sp500_value,
        )
        # do_nothing, not do_update: candidates are beyond the newest row by construction,
        # and a backfill must never win over anything that somehow beat it there.
        result = await db.execute(stmt.on_conflict_do_nothing(index_elements=["snapshot_date"]))
        if result.rowcount:
            written += 1
            logger.info("value snapshot backfilled for missed Monday %s", monday)
    return written
