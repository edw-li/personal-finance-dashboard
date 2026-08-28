from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.models import (
    AppSetting,
    DividendPayment,
    LatestPrice,
    PortfolioValueHistory,
    PositionTransaction,
    PriceHistory,
    RsuGrant,
    Security,
)
from app.services.dividend_ingest import DividendIngestResult
from app.services.price_provider import DailyBar
from app.services.price_service import (
    backfill_employer_history,
    read_last_refresh,
    refresh_prices,
    run_refresh,
    set_manual_price,
)
from tests.portfolio_factories import acct

D = Decimal
TODAY = date(2026, 8, 14)
# The value snapshot is Monday-gated (the sheet's weekly cadence) — refresh runs that
# expect an appended row must land on one. TODAY itself is a Friday.
MONDAY = date(2026, 8, 17)


class FakeProvider:
    def __init__(self, data=None, errors=None, next_ex_div=None, next_ex_div_errors=None):
        self.data = data or {}
        self.errors = errors or {}
        self.next_ex_div = next_ex_div or {}
        self.next_ex_div_errors = next_ex_div_errors or {}
        self.calls: list[tuple[str, date]] = []
        self.ex_div_calls: list[str] = []

    def fetch_daily(self, ticker, start):
        self.calls.append((ticker, start))
        if ticker in self.errors:
            raise self.errors[ticker]
        return self.data.get(ticker, [])

    def fetch_next_ex_div(self, ticker):
        self.ex_div_calls.append(ticker)
        if ticker in self.next_ex_div_errors:
            raise self.next_ex_div_errors[ticker]
        return self.next_ex_div.get(ticker)


def bar(day, close, dividend="0"):
    return DailyBar(bar_date=day, close=D(close), dividend=D(dividend))


def buy(sec_id, account="RH Taxable", shares="10.000000", price="100.0000"):
    return PositionTransaction(
        security_id=sec_id,
        portfolio_account=acct(account),
        type="buy",
        shares=D(shares),
        price=D(price),
        sort_index=10,
        source="ui",
    )


async def seed_security(db, ticker, *, manual=False, active=True, annual_dividend=None):
    sec = Security(
        ticker=ticker,
        name=f"{ticker} Inc",
        holding_type="stock",
        is_manual_priced=manual,
        is_active=active,
        annual_dividend=annual_dividend,
    )
    db.add(sec)
    await db.commit()
    return sec


async def test_refresh_upserts_history_latest_and_dividend_metadata(db):
    sec = await seed_security(db, "NVDA", annual_dividend=D("99"))
    provider = FakeProvider(
        {
            "NVDA": [
                bar(TODAY - timedelta(days=200), "100", "0.75"),
                bar(TODAY - timedelta(days=1), "220"),
                bar(TODAY, "225.5", "0.25"),
            ],
        }
    )
    result = await refresh_prices(db, provider, today=TODAY)
    assert result.updated == ["NVDA"]
    assert result.failed == {} and result.skipped_manual == []
    assert provider.calls == [("NVDA", date(2025, 8, 9))]  # TODAY - 370 days, pinned literally
    history = (
        (await db.execute(select(PriceHistory).order_by(PriceHistory.price_date))).scalars().all()
    )
    assert [(h.price_date, h.close) for h in history] == [
        (TODAY - timedelta(days=200), D("100.0000")),
        (TODAY - timedelta(days=1), D("220.0000")),
        (TODAY, D("225.5000")),
    ]
    latest = await db.get(LatestPrice, sec.id)
    assert latest.price == D("225.5000") and latest.source == "yfinance"
    assert latest.quoted_at == datetime(2026, 8, 14, tzinfo=UTC)
    await db.refresh(sec)
    assert sec.annual_dividend == D("1.0000")  # TTM sum replaces the stale 99
    assert sec.ex_div_date == TODAY


async def test_refresh_is_idempotent_and_updates_existing_rows(db):
    sec = await seed_security(db, "VOO")
    provider = FakeProvider({"VOO": [bar(TODAY, "500")]})
    await refresh_prices(db, provider, today=TODAY)
    assert (await db.get(LatestPrice, sec.id)).price == D("500.0000")
    provider.data["VOO"] = [bar(TODAY, "501")]
    result = await refresh_prices(db, provider, today=TODAY)
    assert result.updated == ["VOO"]
    history = (await db.execute(select(PriceHistory))).scalars().all()
    assert len(history) == 1 and history[0].close == D("501.0000")
    assert (await db.get(LatestPrice, sec.id)).price == D("501.0000")


async def test_refresh_failure_keeps_last_good_price(db):
    sec = await seed_security(db, "ZI")
    db.add(
        LatestPrice(
            security_id=sec.id,
            price=D("10"),
            quoted_at=datetime(2026, 1, 1, tzinfo=UTC),
            source="manual",
        )
    )
    await db.commit()
    provider = FakeProvider(errors={"ZI": RuntimeError("boom")})
    result = await refresh_prices(db, provider, today=TODAY)
    assert "ZI" in result.failed and "boom" in result.failed["ZI"]
    latest = await db.get(LatestPrice, sec.id)
    assert latest.price == D("10.0000") and latest.source == "manual"


async def test_refresh_empty_bars_counts_as_failure(db):
    await seed_security(db, "ZI")
    result = await refresh_prices(db, FakeProvider({"ZI": []}), today=TODAY)
    assert result.failed == {"ZI": "no data returned"}


async def test_refresh_skips_manual_and_inactive(db):
    await seed_security(db, "PRIV", manual=True)
    await seed_security(db, "DEAD", active=False)
    provider = FakeProvider()
    result = await refresh_prices(db, provider, today=TODAY)
    assert result.skipped_manual == ["PRIV"]
    assert provider.calls == []  # inactive isn't even attempted


async def test_refresh_one_failure_does_not_block_others(db):
    await seed_security(db, "AAA")
    await seed_security(db, "BBB")
    provider = FakeProvider(data={"BBB": [bar(TODAY, "7")]}, errors={"AAA": RuntimeError("nope")})
    result = await refresh_prices(db, provider, today=TODAY)
    assert result.updated == ["BBB"] and "AAA" in result.failed


async def test_refresh_skips_out_of_bounds_bars(db):
    await seed_security(db, "WILD")
    provider = FakeProvider(
        {
            "WILD": [
                bar(TODAY - timedelta(days=1), "10000000000"),  # 10^10: over Numeric(14,4)
                bar(TODAY, "-5"),  # negative close: junk
            ]
        }
    )
    result = await refresh_prices(db, provider, today=TODAY)
    assert result.failed == {"WILD": "no data returned"}
    assert (await db.execute(select(PriceHistory))).scalars().all() == []


async def test_set_manual_price_upserts_latest_and_history(db):
    sec = await seed_security(db, "PRIV", manual=True)
    await set_manual_price(db, sec, D("31.89"), as_of=date(2026, 8, 10))
    await db.commit()
    latest = await db.get(LatestPrice, sec.id)
    assert latest.price == D("31.8900") and latest.source == "manual"
    assert latest.quoted_at == datetime(2026, 8, 10, tzinfo=UTC)
    await set_manual_price(db, sec, D("32.00"), as_of=date(2026, 8, 10))
    await db.commit()
    history = (await db.execute(select(PriceHistory))).scalars().all()
    assert len(history) == 1 and history[0].close == D("32.0000")
    assert (await db.get(LatestPrice, sec.id)).price == D("32.0000")


async def test_set_manual_price_backdated_updates_history_only(db):
    # A backdated manual entry must never move the latest quote backwards — day-Δ
    # reads bars[-2] against the latest price (Task 4 review guard).
    sec = await seed_security(db, "PRIV", manual=True)
    await set_manual_price(db, sec, D("32.00"), as_of=date(2026, 8, 14))
    await db.commit()
    await set_manual_price(db, sec, D("30.00"), as_of=date(2026, 8, 10))
    await db.commit()
    latest = await db.get(LatestPrice, sec.id)
    assert latest.price == D("32.0000")
    assert latest.quoted_at == datetime(2026, 8, 14, tzinfo=UTC)
    history = (
        (await db.execute(select(PriceHistory).order_by(PriceHistory.price_date))).scalars().all()
    )
    assert [(h.price_date, h.close) for h in history] == [
        (date(2026, 8, 10), D("30.0000")),
        (date(2026, 8, 14), D("32.0000")),
    ]


async def test_ttm_window_excludes_old_and_boundary_dividends(db):
    sec = await seed_security(db, "KO")
    provider = FakeProvider(
        {
            "KO": [
                bar(TODAY - timedelta(days=368), "50", "9"),  # in fetch window, outside TTM
                # exactly at boundary: excluded (strict >)
                bar(TODAY - timedelta(days=365), "51", "7"),
                bar(TODAY - timedelta(days=364), "52", "0.2375"),
                bar(TODAY, "53"),
            ]
        }
    )
    await refresh_prices(db, provider, today=TODAY)
    await db.refresh(sec)
    assert sec.annual_dividend == D("0.2375")
    assert sec.ex_div_date == TODAY - timedelta(days=364)


async def test_absurd_ttm_keeps_previous_metadata(db):
    sec = await seed_security(db, "WOW", annual_dividend=D("2.5"))
    result = await refresh_prices(
        db, FakeProvider({"WOW": [bar(TODAY, "10", "1000000")]}), today=TODAY
    )
    assert result.updated == ["WOW"]
    await db.refresh(sec)
    assert sec.annual_dividend == D("2.5000")


async def test_refresh_collects_dividend_events_for_updated_tickers_only(db):
    good = await seed_security(db, "DIVX")
    failed = await seed_security(db, "AAA")
    nodiv = await seed_security(db, "NODIV")
    provider = FakeProvider(
        data={
            "DIVX": [
                bar(date(2026, 3, 20), "100", "0.8200"),
                bar(date(2026, 6, 19), "110", "0.8200"),
                bar(TODAY, "120"),
            ],
            "NODIV": [bar(TODAY, "50")],
        },
        errors={"AAA": RuntimeError("nope")},
    )
    result = await refresh_prices(db, provider, today=TODAY)
    events = result.dividend_events[good.id]
    assert [(b.bar_date, b.dividend) for b in events] == [
        (date(2026, 3, 20), D("0.8200")),
        (date(2026, 6, 19), D("0.8200")),
    ]
    assert failed.id not in result.dividend_events
    # An updated ticker with no events is PRESENT with an empty list — that presence is
    # what lets the ingest self-heal a book whose in-window events all vanished from the
    # feed (branch review I1); a failed ticker stays absent and untouched.
    assert result.dividend_events[nodiv.id] == []


async def test_duplicate_bar_dates_deduped_last_wins(db):
    sec = await seed_security(db, "DUP")
    result = await refresh_prices(
        db, FakeProvider({"DUP": [bar(TODAY, "5"), bar(TODAY, "6")]}), today=TODAY
    )
    assert result.updated == ["DUP"]
    history = (await db.execute(select(PriceHistory))).scalars().all()
    assert len(history) == 1 and history[0].close == D("6.0000")
    assert (await db.get(LatestPrice, sec.id)).price == D("6.0000")


async def test_refresh_commits_durably(db, engine):
    sec = await seed_security(db, "DUR")
    await refresh_prices(db, FakeProvider({"DUR": [bar(TODAY, "5")]}), today=TODAY)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as other:
        latest = await other.get(LatestPrice, sec.id)
        assert latest is not None and latest.price == D("5.0000")


async def test_per_ticker_db_failure_does_not_abort_the_batch(db):
    await seed_security(db, "AAA")
    await seed_security(db, "BAD")
    await seed_security(db, "ZZZ")
    provider = FakeProvider(
        {
            "AAA": [bar(TODAY, "11")],
            # passes the 0 < close < 10^10 bound but overflows Numeric(14,4) at the DB
            "BAD": [bar(TODAY, "9999999999.99999")],
            "ZZZ": [bar(TODAY, "99")],
        }
    )
    result = await refresh_prices(db, provider, today=TODAY)
    assert result.updated == ["AAA", "ZZZ"]
    assert "BAD" in result.failed
    assert [c[0] for c in provider.calls] == ["AAA", "BAD", "ZZZ"]  # ZZZ still attempted
    history = (await db.execute(select(PriceHistory))).scalars().all()
    assert len(history) == 2  # BAD's savepoint rolled back; AAA and ZZZ persisted


async def test_run_refresh_records_dividend_counts(db):
    sec = await seed_security(db, "DIVX")
    holding = buy(sec.id)
    db.add(holding)
    db.add(  # 5 days from the August event: the whole event is skipped, not double-counted
        DividendPayment(
            security_id=sec.id,
            pay_date=date(2026, 8, 5),
            amount=D("9.99"),
            portfolio_account=acct("RH Taxable"),
        )
    )
    await db.commit()
    provider = FakeProvider(
        {
            "DIVX": [
                bar(date(2026, 3, 20), "100", "0.8200"),
                bar(date(2026, 6, 19), "110", "0.8200"),
                bar(date(2026, 8, 10), "115", "0.8200"),
                bar(TODAY, "120"),
            ]
        }
    )
    result, appended, dividends = await run_refresh(db, provider, trigger="manual", today=MONDAY)

    assert result.updated == ["DIVX"] and appended is True
    assert (dividends.ingested, dividends.removed, dividends.skipped_manual_overlap) == (2, 0, 1)
    rows = (
        (
            await db.execute(
                select(DividendPayment)
                .where(DividendPayment.source == "auto")
                .order_by(DividendPayment.ex_date)
            )
        )
        .scalars()
        .all()
    )
    assert [(r.ex_date, r.amount) for r in rows] == [
        (date(2026, 3, 20), D("8.20")),  # 10 shares × 0.82
        (date(2026, 6, 19), D("8.20")),
    ]
    payload = await read_last_refresh(db)
    # Three distinct values: the payload keys cannot be silently transposed.
    assert payload["dividends_ingested"] == 2
    assert payload["dividends_removed"] == 0
    assert payload["dividends_skipped_overlap"] == 1

    # The self-heal leg is recorded too: the book loses the position, the run removes
    # the auto rows it can no longer support.
    await db.delete(holding)
    await db.commit()
    _result, _appended, healed = await run_refresh(db, provider, trigger="scheduled", today=MONDAY)
    assert (healed.ingested, healed.removed, healed.skipped_manual_overlap) == (0, 2, 1)
    healed_payload = await read_last_refresh(db)
    assert healed_payload["dividends_ingested"] == 0
    assert healed_payload["dividends_removed"] == 2
    assert healed_payload["trigger"] == "scheduled"


async def test_ingest_failure_degrades_and_preserves_snapshot(db, engine, monkeypatch):
    sec = await seed_security(db, "DIVX")
    db.add(buy(sec.id))
    await db.commit()

    async def boom(*args, **kwargs):
        raise RuntimeError("ingest exploded")

    # run_refresh imports ingest_dividends lazily, INSIDE the function (the circular-import
    # dodge) — so the patch belongs on the source module, not on price_service.
    monkeypatch.setattr("app.services.dividend_ingest.ingest_dividends", boom)
    provider = FakeProvider({"DIVX": [bar(date(2026, 6, 19), "110", "0.8200"), bar(TODAY, "120")]})

    result, appended, dividends = await run_refresh(db, provider, trigger="manual", today=MONDAY)

    assert result.updated == ["DIVX"]
    assert appended is True  # the savepoint rolled back the ingest ALONE
    assert dividends == DividendIngestResult()
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as other:
        # Durably committed from another session: prices, and the snapshot a plain
        # rollback-on-failure would have destroyed.
        assert (await other.get(LatestPrice, sec.id)).price == D("120.0000")
        snapshots = (await other.execute(select(PortfolioValueHistory))).scalars().all()
        assert [(s.snapshot_date, s.market_value) for s in snapshots] == [(MONDAY, D("1200.00"))]
        assert (await other.execute(select(DividendPayment))).scalars().all() == []
    payload = await read_last_refresh(db)
    assert payload["history_appended"] is True
    assert payload["dividends_ingested"] == 0
    assert payload["dividends_removed"] == 0
    assert payload["dividends_skipped_overlap"] == 0


async def test_mid_ingest_db_failure_rolls_back_to_the_savepoint(db, engine, monkeypatch):
    # Branch review M1: the sibling test raises BEFORE any ingest DB work, which pins the
    # try/except but not the savepoint itself. A FAILED STATEMENT poisons the transaction,
    # so without begin_nested the run-record `db.get` would raise PendingRollbackError and
    # lose both the snapshot and the outcome — this test makes the savepoint load-bearing.
    from sqlalchemy import text

    sec = await seed_security(db, "DIVX")
    db.add(buy(sec.id))
    await db.commit()

    async def failing_statement(session, *args, **kwargs):
        # NOT NULL violation raises at execute time, mid-"ingest", inside the savepoint.
        await session.execute(
            text(
                "INSERT INTO dividend_payments (security_id, pay_date, amount) "
                "VALUES (NULL, '2026-01-01', 1)"
            )
        )

    monkeypatch.setattr("app.services.dividend_ingest.ingest_dividends", failing_statement)
    provider = FakeProvider({"DIVX": [bar(date(2026, 6, 19), "110", "0.8200"), bar(TODAY, "120")]})

    result, appended, dividends = await run_refresh(db, provider, trigger="manual", today=MONDAY)

    assert result.updated == ["DIVX"]
    assert appended is True
    assert dividends == DividendIngestResult()
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as other:
        snapshots = (await other.execute(select(PortfolioValueHistory))).scalars().all()
        assert [(s.snapshot_date, s.market_value) for s in snapshots] == [(MONDAY, D("1200.00"))]
        assert (await other.execute(select(DividendPayment))).scalars().all() == []
    payload = await read_last_refresh(db)
    assert payload["history_appended"] is True and payload["dividends_ingested"] == 0


async def test_value_snapshot_rides_only_the_monday_refresh(db):
    # Sheet parity: the workbook's automation added ONE point per week, Mondays after
    # close. Refreshes on every other day — scheduled or manual, weekend included — must
    # keep quotes fresh WITHOUT thickening the weekly series into a daily one.
    sec = await seed_security(db, "NVDA")
    db.add(buy(sec.id))
    await db.commit()
    provider = FakeProvider({"NVDA": [bar(TODAY, "120")]})

    for offset in range(1, 7):  # Tue..Sun after the anchor Monday
        _result, appended, _dividends = await run_refresh(
            db, provider, trigger="scheduled", today=MONDAY + timedelta(days=offset)
        )
        assert appended is False
    assert (await db.execute(select(PortfolioValueHistory))).scalars().all() == []
    payload = await read_last_refresh(db)
    assert payload["history_appended"] is False

    _result, appended, _dividends = await run_refresh(db, provider, trigger="manual", today=MONDAY)
    assert appended is True
    snapshots = (await db.execute(select(PortfolioValueHistory))).scalars().all()
    assert [(s.snapshot_date, s.market_value) for s in snapshots] == [(MONDAY, D("1200.00"))]


async def test_missed_monday_is_backfilled_from_stored_closes(db):
    # Host down all Monday, refresh runs Tuesday: refresh_prices has just re-fetched the
    # bar window, so the missed Monday fills at its TRUE closes and is dated Monday;
    # Tuesday itself stays gated. The S&P leg extends to Monday's benchmark close.
    sec = await seed_security(db, "NVDA")
    voo = await seed_security(db, "VOO", manual=True)  # bars seeded below, refresh skips it
    db.add(buy(sec.id))
    db.add_all(
        [
            PortfolioValueHistory(
                snapshot_date=MONDAY - timedelta(days=7),
                market_value=D("1000.00"),
                cost_basis=D("900.00"),
                sp500_value=D("800.00"),
            ),
            PriceHistory(
                security_id=voo.id, price_date=MONDAY - timedelta(days=7), close=D("400.0000")
            ),
            PriceHistory(security_id=voo.id, price_date=MONDAY, close=D("410.0000")),
        ]
    )
    await db.commit()
    provider = FakeProvider({"NVDA": [bar(MONDAY, "118"), bar(MONDAY + timedelta(days=1), "120")]})

    _result, appended, _dividends = await run_refresh(
        db, provider, trigger="scheduled", today=MONDAY + timedelta(days=1)
    )

    assert appended is True  # the backfill is history movement — the payload says so
    snapshots = (
        (
            await db.execute(
                select(PortfolioValueHistory).order_by(PortfolioValueHistory.snapshot_date)
            )
        )
        .scalars()
        .all()
    )
    assert [(s.snapshot_date, s.market_value, s.cost_basis, s.sp500_value) for s in snapshots] == [
        (MONDAY - timedelta(days=7), D("1000.00"), D("900.00"), D("800.00")),
        # 10 shares × Monday's 118 close; S&P leg: 800/400 = 2 implied shares × 410.
        (MONDAY, D("1180.00"), D("1000.00"), D("820.00")),
    ]
    payload = await read_last_refresh(db)
    assert payload["history_appended"] is True

    # Idempotent: Wednesday's run finds the week already covered and writes nothing new.
    _result, appended, _dividends = await run_refresh(
        db, provider, trigger="scheduled", today=MONDAY + timedelta(days=2)
    )
    assert appended is False
    assert len((await db.execute(select(PortfolioValueHistory))).scalars().all()) == 2


async def test_backfill_chains_across_weeks_and_the_monday_run_still_prices_live(db):
    # Two-week outage ending on a Monday: the hole fills IN ORDER and today's own row
    # comes from the live quotes — never the close lookup. The S&P legs pin the CHAIN:
    # the original anchor has no benchmark bar (its extension carries FLAT to 800), so
    # the live row's 807.92 = 800/404 implied shares × 408 is only reachable by anchoring
    # off the FILL — extending off the original row would flat-carry 800 again.
    sec = await seed_security(db, "NVDA")
    voo = await seed_security(db, "VOO", manual=True)
    db.add(buy(sec.id))
    db.add_all(
        [
            PortfolioValueHistory(
                snapshot_date=MONDAY - timedelta(days=14),
                market_value=D("1000.00"),
                cost_basis=D("900.00"),
                sp500_value=D("800.00"),
            ),
            PriceHistory(
                security_id=voo.id, price_date=MONDAY - timedelta(days=7), close=D("404.0000")
            ),
            PriceHistory(security_id=voo.id, price_date=MONDAY, close=D("408.0000")),
        ]
    )
    await db.commit()
    provider = FakeProvider({"NVDA": [bar(MONDAY - timedelta(days=7), "110"), bar(MONDAY, "120")]})

    _result, appended, _dividends = await run_refresh(
        db, provider, trigger="scheduled", today=MONDAY
    )

    assert appended is True
    snapshots = (
        (
            await db.execute(
                select(PortfolioValueHistory).order_by(PortfolioValueHistory.snapshot_date)
            )
        )
        .scalars()
        .all()
    )
    assert [(s.snapshot_date, s.market_value, s.sp500_value) for s in snapshots] == [
        (MONDAY - timedelta(days=14), D("1000.00"), D("800.00")),
        (MONDAY - timedelta(days=7), D("1100.00"), D("800.00")),  # flat: no bar ≤ its anchor
        (MONDAY, D("1200.00"), D("807.92")),  # (800 / 404) implied shares × 408, off the FILL
    ]


async def test_backfill_leaves_a_hole_it_cannot_price(db):
    # The first missed Monday predates every stored bar: no honest close exists, so that
    # week stays empty rather than guessed — and the NEXT missed Monday still fills from
    # the newest close on-or-before it (the sheet's own "latest closing prices" carry).
    sec = await seed_security(db, "NVDA")
    db.add(buy(sec.id))
    db.add(
        PortfolioValueHistory(
            snapshot_date=MONDAY - timedelta(days=14),
            market_value=D("1000.00"),
            cost_basis=D("900.00"),
            sp500_value=D("800.00"),
        )
    )
    await db.commit()
    provider = FakeProvider({"NVDA": [bar(MONDAY - timedelta(days=4), "115")]})  # Thu only

    _result, appended, _dividends = await run_refresh(
        db, provider, trigger="scheduled", today=MONDAY + timedelta(days=1)
    )

    assert appended is True
    snapshots = (
        (
            await db.execute(
                select(PortfolioValueHistory).order_by(PortfolioValueHistory.snapshot_date)
            )
        )
        .scalars()
        .all()
    )
    assert [(s.snapshot_date, s.market_value) for s in snapshots] == [
        (MONDAY - timedelta(days=14), D("1000.00")),
        (MONDAY, D("1150.00")),  # Thursday's 115 close is the newest on-or-before Monday
    ]


async def test_backfill_prices_quote_only_holdings_at_their_standing_quote(db):
    # Review I1: import-seeded and manual-priced holdings may carry a LatestPrice and no
    # bars at all. The live Monday rows value them (the sheet did too), so a backfilled
    # Monday must as well — at the standing quote, provided it already existed by that
    # Monday. A quote from AFTER the Monday is future knowledge and stays out of the fill.
    nvda = await seed_security(db, "NVDA")
    priv = await seed_security(db, "PRIV", manual=True)
    late = await seed_security(db, "LATE", manual=True)
    db.add_all([buy(nvda.id), buy(priv.id, account="Other"), buy(late.id, account="Third")])
    db.add_all(
        [
            PortfolioValueHistory(
                snapshot_date=MONDAY - timedelta(days=7),
                market_value=D("1000.00"),
                cost_basis=D("900.00"),
                sp500_value=D("800.00"),
            ),
            LatestPrice(  # quoted the Friday BEFORE the missed Monday — counts
                security_id=priv.id,
                price=D("50"),
                quoted_at=datetime(2026, 8, 14, tzinfo=UTC),
                source="manual",
            ),
            LatestPrice(  # quoted the day AFTER the missed Monday — stays out
                security_id=late.id,
                price=D("999"),
                quoted_at=datetime(2026, 8, 18, tzinfo=UTC),
                source="manual",
            ),
        ]
    )
    await db.commit()
    provider = FakeProvider({"NVDA": [bar(MONDAY, "118")]})

    _result, appended, _dividends = await run_refresh(
        db, provider, trigger="scheduled", today=MONDAY + timedelta(days=1)
    )

    assert appended is True
    row = (
        await db.execute(
            select(PortfolioValueHistory).where(PortfolioValueHistory.snapshot_date == MONDAY)
        )
    ).scalar_one()
    # 10 × 118 (bar) + 10 × 50 (standing quote); LATE contributes cost only.
    assert row.market_value == D("1680.00")
    assert row.cost_basis == D("3000.00")


async def test_backfill_failure_degrades_alone_and_the_monday_append_stands(db, monkeypatch):
    # One savepoint per movement (review S1): an exploding backfill must not suppress the
    # same run's live Monday append. Patched at the source module — run_refresh imports
    # it lazily, inside the function (the circular-import dodge).
    sec = await seed_security(db, "NVDA")
    db.add(buy(sec.id))
    await db.commit()

    async def boom(*args, **kwargs):
        raise RuntimeError("backfill exploded")

    monkeypatch.setattr("app.services.value_history.backfill_missed_snapshots", boom)
    provider = FakeProvider({"NVDA": [bar(MONDAY, "120")]})

    _result, appended, _dividends = await run_refresh(
        db, provider, trigger="scheduled", today=MONDAY
    )

    assert appended is True
    snapshots = (await db.execute(select(PortfolioValueHistory))).scalars().all()
    assert [(s.snapshot_date, s.market_value) for s in snapshots] == [(MONDAY, D("1200.00"))]


async def test_append_failure_degrades_alone_and_the_backfilled_rows_stand(db, monkeypatch):
    # The reverse of the test above — the other half of S1's promise: an exploding Monday
    # append must not destroy the same run's backfilled rows. Same source-module patch
    # (run_refresh imports lazily, inside the function). Monday's own bar IS available, so
    # that date's absence below proves the explosion was isolated, not a lack of data.
    sec = await seed_security(db, "NVDA")
    db.add(buy(sec.id))
    db.add(
        PortfolioValueHistory(
            snapshot_date=MONDAY - timedelta(days=14),
            market_value=D("1000.00"),
            cost_basis=D("900.00"),
            sp500_value=D("800.00"),
        )
    )
    await db.commit()

    async def boom(*args, **kwargs):
        raise RuntimeError("append exploded")

    monkeypatch.setattr("app.services.value_history.append_value_snapshot", boom)
    provider = FakeProvider({"NVDA": [bar(MONDAY - timedelta(days=7), "110"), bar(MONDAY, "120")]})

    _result, appended, _dividends = await run_refresh(
        db, provider, trigger="scheduled", today=MONDAY
    )

    # The backfill's write is what history_appended reports; MONDAY itself never lands.
    assert appended is True
    snapshots = (
        (
            await db.execute(
                select(PortfolioValueHistory).order_by(PortfolioValueHistory.snapshot_date)
            )
        )
        .scalars()
        .all()
    )
    assert [(s.snapshot_date, s.market_value) for s in snapshots] == [
        (MONDAY - timedelta(days=14), D("1000.00")),
        (MONDAY - timedelta(days=7), D("1100.00")),  # 10 × that Monday's 110 close
    ]


async def test_backfill_anchors_off_a_stray_mid_week_row(db):
    # Daily-era leftovers: the newest row may be a Wednesday (flushed only on the next
    # re-upload). The first fill is the next Monday AFTER it — never the same week's
    # earlier Monday, which the stray's week already covers.
    sec = await seed_security(db, "NVDA")
    db.add(buy(sec.id))
    db.add(
        PortfolioValueHistory(
            snapshot_date=MONDAY - timedelta(days=5),  # the prior Wednesday
            market_value=D("1000.00"),
            cost_basis=D("900.00"),
            sp500_value=D("800.00"),
        )
    )
    await db.commit()
    provider = FakeProvider({"NVDA": [bar(MONDAY, "118")]})

    _result, appended, _dividends = await run_refresh(
        db, provider, trigger="scheduled", today=MONDAY + timedelta(days=1)
    )

    assert appended is True
    snapshots = (
        (
            await db.execute(
                select(PortfolioValueHistory).order_by(PortfolioValueHistory.snapshot_date)
            )
        )
        .scalars()
        .all()
    )
    assert [(s.snapshot_date, s.market_value) for s in snapshots] == [
        (MONDAY - timedelta(days=5), D("1000.00")),
        (MONDAY, D("1180.00")),
    ]


async def test_backfill_never_reaches_backwards_from_a_future_dated_series(db):
    # A re-uploaded workbook can carry Mondays past the runtime clock (timezone-shifted
    # exports): there is nothing to fill — the series is already ahead of today.
    sec = await seed_security(db, "NVDA")
    db.add(buy(sec.id))
    db.add(
        PortfolioValueHistory(
            snapshot_date=MONDAY + timedelta(days=14),
            market_value=D("1000.00"),
            cost_basis=D("900.00"),
            sp500_value=D("800.00"),
        )
    )
    await db.commit()
    provider = FakeProvider({"NVDA": [bar(MONDAY, "118")]})

    _result, appended, _dividends = await run_refresh(
        db, provider, trigger="scheduled", today=MONDAY + timedelta(days=1)
    )

    assert appended is False
    assert len((await db.execute(select(PortfolioValueHistory))).scalars().all()) == 1


async def test_backdated_manual_price_does_not_move_import_seeded_latest(db):
    # Import seeding leaves latest_prices populated while price_history is EMPTY —
    # the guard must respect the seeded quote too (Task 6 review I1).
    sec = await seed_security(db, "FIGR", manual=True)
    db.add(
        LatestPrice(
            security_id=sec.id,
            price=D("2500"),
            quoted_at=datetime(2026, 8, 13, tzinfo=UTC),
            source="manual",
        )
    )
    await db.commit()
    await set_manual_price(db, sec, D("1"), as_of=date(2024, 1, 1))
    await db.commit()
    latest = await db.get(LatestPrice, sec.id)
    assert latest.price == D("2500.0000")
    assert latest.quoted_at.date() == date(2026, 8, 13)
    assert len((await db.execute(select(PriceHistory))).scalars().all()) == 1


# --- employer history backfill (2026-08-21: deep closes for the vest calendar) ---


class WindowedProvider(FakeProvider):
    """Bars filtered by the requested start — the real provider's behavior, which the plain
    FakeProvider (returns everything regardless of start) cannot exercise here: the deep
    backfill only fires when the standing 370-day window genuinely misses the old bars."""

    def fetch_daily(self, ticker, start):
        bars = super().fetch_daily(ticker, start)
        return [b for b in bars if b.bar_date >= start]


def rsu_grant(first_vest, *, shares=700, label=None):
    return RsuGrant(
        kind="new_hire",
        label=label or f"Grant {first_vest}",
        focal_year=None,
        shares=shares,
        grant_price=D("45.1200"),
        first_vest_date=first_vest,
        cliff_pct=D("0.2500"),
    )


async def seed_employer(db, *, manual=False):
    db.add(AppSetting(key="espp_ticker", value={"value": "NVDA"}))
    return await seed_security(db, "NVDA", manual=manual)


async def test_employer_backfill_fetches_bars_back_to_the_earliest_grant(db):
    sec = await seed_employer(db)
    db.add(PriceHistory(security_id=sec.id, price_date=date(2026, 8, 10), close=D("180")))
    db.add(rsu_grant(date(2024, 9, 18)))
    await db.commit()
    provider = FakeProvider({"NVDA": [bar(date(2024, 9, 4), "115"), bar(date(2025, 1, 2), "120")]})

    written = await backfill_employer_history(db, provider)
    await db.commit()

    assert written == 2
    # The deep window starts a buffer BEFORE the earliest vest, so the vest calendar's
    # on-or-before lookup always has a bar to land on even across a holiday.
    assert provider.calls == [("NVDA", date(2024, 9, 18) - timedelta(days=14))]
    days = (
        (await db.execute(select(PriceHistory.price_date).order_by(PriceHistory.price_date)))
        .scalars()
        .all()
    )
    assert days == [date(2024, 9, 4), date(2025, 1, 2), date(2026, 8, 10)]


async def test_employer_backfill_self_extinguishes_once_history_reaches_the_grant(db):
    await seed_employer(db)
    db.add(rsu_grant(date(2024, 9, 18)))
    await db.commit()
    provider = FakeProvider({"NVDA": [bar(date(2024, 9, 4), "115")]})

    assert await backfill_employer_history(db, provider) == 1
    await db.commit()
    # The oldest stored bar now sits on the window's start: the second call decides on the
    # SELECTs alone and never reaches the provider.
    assert await backfill_employer_history(db, provider) == 0
    assert len(provider.calls) == 1


async def test_employer_backfill_skips_quietly_when_there_is_nothing_to_do(db):
    provider = FakeProvider({"NVDA": [bar(date(2024, 9, 4), "115")]})
    # No espp_ticker setting at all.
    assert await backfill_employer_history(db, provider) == 0
    # Ticker + security, but no grants whose vests would need old closes.
    await seed_employer(db)
    assert await backfill_employer_history(db, provider) == 0
    assert provider.calls == []


async def test_employer_backfill_respects_manual_priced_employers(db):
    # A manual-priced employer's bars are hand entries; a provider fetch would be a second
    # opinion about them (set_manual_price's territory).
    await seed_employer(db, manual=True)
    db.add(rsu_grant(date(2024, 9, 18)))
    await db.commit()
    provider = FakeProvider({"NVDA": [bar(date(2024, 9, 4), "115")]})

    assert await backfill_employer_history(db, provider) == 0
    assert provider.calls == []


async def test_employer_backfill_failure_degrades_alone_in_run_refresh(db, monkeypatch):
    # Same source-module patch as the value-history failure tests: run_refresh looks the
    # name up on its own module at call time.
    sec = await seed_security(db, "NVDA")
    db.add(buy(sec.id))
    await db.commit()

    async def boom(*args, **kwargs):
        raise RuntimeError("deep fetch exploded")

    monkeypatch.setattr("app.services.price_service.backfill_employer_history", boom)
    provider = FakeProvider({"NVDA": [bar(MONDAY, "120")]})

    result, appended, _dividends = await run_refresh(
        db, provider, trigger="scheduled", today=MONDAY
    )

    assert result.updated == ["NVDA"]
    assert appended is True  # the Monday value snapshot stands


async def test_run_refresh_backfills_employer_history_past_the_window(db):
    await seed_employer(db)
    db.add(rsu_grant(date(2024, 9, 18)))
    await db.commit()
    provider = WindowedProvider({"NVDA": [bar(date(2024, 9, 4), "115"), bar(MONDAY, "120")]})

    await run_refresh(db, provider, trigger="manual", today=MONDAY)

    # Two fetches: the standing 370-day window (which cannot see 2024), then the deep one
    # anchored a buffer before the earliest vest.
    assert provider.calls == [
        ("NVDA", MONDAY - timedelta(days=370)),
        ("NVDA", date(2024, 9, 4)),
    ]
    old = (
        (await db.execute(select(PriceHistory).where(PriceHistory.price_date == date(2024, 9, 4))))
        .scalars()
        .all()
    )
    assert len(old) == 1 and old[0].close == D("115.0000")


async def test_employer_backfill_watermarks_a_provider_floor_newer_than_needed(db):
    # The airtight half of the extinguish (revision review I1): NVDA's feed here simply does
    # not reach the needed 2024-09-04 — without the watermark, every refresh would re-run
    # the deep fetch forever while the oldest-bar check never turned true.
    await seed_employer(db)
    db.add(rsu_grant(date(2024, 9, 18)))
    await db.commit()
    provider = FakeProvider({"NVDA": [bar(date(2025, 3, 3), "130")]})

    assert await backfill_employer_history(db, provider) == 1
    await db.commit()
    assert await backfill_employer_history(db, provider) == 0
    assert len(provider.calls) == 1  # the watermark decided; the provider was not asked again

    # An OLDER grant lowers the needed date past the watermark and re-arms the fetch.
    db.add(rsu_grant(date(2023, 9, 20), label="Original offer"))
    await db.commit()
    assert await backfill_employer_history(db, provider) == 1
    assert len(provider.calls) == 2
    assert provider.calls[1] == ("NVDA", date(2023, 9, 20) - timedelta(days=14))


async def test_employer_backfill_does_not_watermark_an_empty_answer(db):
    # An empty deep answer is as likely a transient hiccup as a real floor: no watermark,
    # so tomorrow's refresh retries at the cost of one call.
    await seed_employer(db)
    db.add(rsu_grant(date(2024, 9, 18)))
    await db.commit()
    provider = FakeProvider({"NVDA": []})

    assert await backfill_employer_history(db, provider) == 0
    await db.commit()
    assert await backfill_employer_history(db, provider) == 0
    assert len(provider.calls) == 2  # retried — nothing recorded the emptiness as final


async def test_security_next_ex_div_date_roundtrip(db):
    """§3.1: a NEW nullable column — ex_div_date keeps its most-recent-PAST-event
    semantics untouched; this one carries the ANNOUNCED upcoming date."""
    sec = await seed_security(db, "NVDA")
    assert sec.next_ex_div_date is None  # fresh securities carry no announcement
    sec.next_ex_div_date = date(2026, 9, 3)
    await db.commit()
    await db.refresh(sec)
    assert sec.next_ex_div_date == date(2026, 9, 3)
    assert sec.ex_div_date is None  # the two columns are independent


async def test_refresh_stores_a_future_announced_ex_div(db):
    sec = await seed_security(db, "DIVX")
    provider = FakeProvider(
        {"DIVX": [bar(TODAY - timedelta(days=30), "100", "0.75"), bar(TODAY, "110")]},
        next_ex_div={"DIVX": TODAY + timedelta(days=20)},
    )
    result = await refresh_prices(db, provider, today=TODAY)
    assert result.updated == ["DIVX"]
    assert (result.ex_div_fetched, result.ex_div_failed) == (1, 0)
    assert provider.ex_div_calls == ["DIVX"]
    await db.refresh(sec)
    assert sec.next_ex_div_date == TODAY + timedelta(days=20)


async def test_refresh_clears_when_the_feed_stops_announcing(db):
    # §3.3: a SUCCESSFUL fetch that answers "nothing upcoming" clears a stored future
    # date — Yahoo withdrew or never re-announced it, and confirmed-only means gone.
    sec = await seed_security(db, "DIVX")
    sec.next_ex_div_date = TODAY + timedelta(days=5)
    await db.commit()
    provider = FakeProvider(
        {"DIVX": [bar(TODAY - timedelta(days=30), "100", "0.75"), bar(TODAY, "110")]},
    )
    await refresh_prices(db, provider, today=TODAY)
    await db.refresh(sec)
    assert sec.next_ex_div_date is None


async def test_refresh_treats_a_past_announcement_as_nothing(db):
    sec = await seed_security(db, "DIVX")
    provider = FakeProvider(
        {"DIVX": [bar(TODAY - timedelta(days=30), "100", "0.75"), bar(TODAY, "110")]},
        next_ex_div={"DIVX": TODAY - timedelta(days=1)},  # fetched but already past
    )
    await refresh_prices(db, provider, today=TODAY)
    await db.refresh(sec)
    assert sec.next_ex_div_date is None  # store only >= today, else NULL (spec §3.3)


async def test_refresh_sweeps_stale_dates_on_manual_and_non_payers(db):
    # The clear is INDEPENDENT of the fetch: manual-priced (skipped) and non-dividend
    # securities never fetch, but a stored date that has passed is cleared anyway — the
    # event occurred and the historical bars own it now.
    manual = await seed_security(db, "PRIV", manual=True)
    manual.next_ex_div_date = TODAY - timedelta(days=3)
    nodiv = await seed_security(db, "GROW")
    nodiv.next_ex_div_date = TODAY - timedelta(days=1)
    await db.commit()
    provider = FakeProvider({"GROW": [bar(TODAY, "50")]})  # bars carry no dividends
    result = await refresh_prices(db, provider, today=TODAY)
    assert provider.ex_div_calls == []  # neither is a dividend payer — no fetch at all
    assert (result.ex_div_fetched, result.ex_div_failed) == (0, 0)
    await db.refresh(manual)
    await db.refresh(nodiv)
    assert manual.next_ex_div_date is None and nodiv.next_ex_div_date is None


async def test_refresh_ex_div_failure_keeps_a_future_stored_date(db):
    sec = await seed_security(db, "DIVX")
    sec.next_ex_div_date = TODAY + timedelta(days=10)
    await db.commit()
    provider = FakeProvider(
        {"DIVX": [bar(TODAY - timedelta(days=30), "100", "0.75"), bar(TODAY, "110")]},
        next_ex_div_errors={"DIVX": RuntimeError("calendar endpoint down")},
    )
    result = await refresh_prices(db, provider, today=TODAY)
    assert result.updated == ["DIVX"]  # the PRICE refresh stands (never fails the run)
    assert result.failed == {}  # ex-div failures wear their own counter, not failed[]
    assert (result.ex_div_fetched, result.ex_div_failed) == (0, 1)
    await db.refresh(sec)
    assert sec.next_ex_div_date == TODAY + timedelta(days=10)  # last-good


async def test_run_refresh_records_ex_div_counts_in_the_blob(db):
    await seed_security(db, "DIVX")
    provider = FakeProvider(
        {"DIVX": [bar(MONDAY - timedelta(days=30), "100", "0.75"), bar(MONDAY, "110")]},
        next_ex_div={"DIVX": MONDAY + timedelta(days=14)},
    )
    await run_refresh(db, provider, trigger="scheduled", today=MONDAY)
    payload = await read_last_refresh(db)
    assert payload["ex_div_fetched"] == 1
    assert payload["ex_div_failed"] == 0
