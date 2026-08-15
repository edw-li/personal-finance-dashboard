from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.models import LatestPrice, PriceHistory, Security
from app.services.price_provider import DailyBar
from app.services.price_service import refresh_prices, set_manual_price

D = Decimal
TODAY = date(2026, 8, 14)


class FakeProvider:
    def __init__(self, data=None, errors=None):
        self.data = data or {}
        self.errors = errors or {}
        self.calls: list[tuple[str, date]] = []

    def fetch_daily(self, ticker, start):
        self.calls.append((ticker, start))
        if ticker in self.errors:
            raise self.errors[ticker]
        return self.data.get(ticker, [])


def bar(day, close, dividend="0"):
    return DailyBar(bar_date=day, close=D(close), dividend=D(dividend))


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
