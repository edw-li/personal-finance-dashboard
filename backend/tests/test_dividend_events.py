"""The display-only historical ex-dividend backfill (2026-08-28 spec).

Window dates are pinned LITERALLY here, exactly like test_dividend_ingest's WINDOW_START:
the boundary between "the ledger owns this" and "this is a chart annotation" is the whole
feature, and a computed constant in the test would move with the code it is meant to hold
still.
"""

from datetime import UTC, date, datetime
from decimal import Decimal

from sqlalchemy import select

from app.models import (
    DividendPayment,
    LatestPrice,
    PortfolioValueHistory,
    Security,
    SecurityDividendEvent,
)
from app.services.dividend_events import backfill_dividend_events
from app.services.price_provider import DailyBar

TODAY = date(2026, 8, 20)
WINDOW_START = date(2025, 8, 15)  # TODAY - 370 days (HISTORY_WINDOW_DAYS), pinned literally
BEFORE_WINDOW = date(2025, 8, 14)
FLOOR = date(2023, 10, 23)  # the workbook's first weekly snapshot


class FakeProvider:
    """test_price_service's FakeProvider, minus the legs this module must never use."""

    def __init__(self, data=None, errors=None):
        self.data = data or {}
        self.errors = errors or {}
        self.calls: list[tuple[str, date]] = []

    def fetch_daily(self, ticker, start):
        self.calls.append((ticker, start))
        if ticker in self.errors:
            raise self.errors[ticker]
        return self.data.get(ticker, [])

    def fetch_next_ex_div(self, ticker):
        raise AssertionError("the deep dividend backfill must not touch the forward calendar")


def bar(day: date, dividend: str = "0", close: str = "100.0000") -> DailyBar:
    return DailyBar(bar_date=day, close=Decimal(close), dividend=Decimal(dividend))


async def seed_security(
    db, ticker="DIVX", *, manual=False, active=True, synced_on=None
) -> Security:
    sec = Security(
        ticker=ticker,
        name=f"{ticker} Inc",
        holding_type="stock",
        is_manual_priced=manual,
        is_active=active,
        dividend_events_synced_on=synced_on,
    )
    db.add(sec)
    await db.commit()
    return sec


async def seed_history(db, *snapshot_dates: date) -> None:
    """The weekly series the chart is drawn from — its earliest row is the fetch floor."""
    db.add_all(
        [
            PortfolioValueHistory(
                snapshot_date=d,
                market_value=Decimal("1000.00"),
                cost_basis=Decimal("900.00"),
                sp500_value=Decimal("950.00"),
            )
            for d in snapshot_dates
        ]
    )
    await db.commit()


async def stored_events(db) -> list[tuple[int, date, Decimal]]:
    rows = (
        await db.execute(
            select(SecurityDividendEvent)
            .order_by(SecurityDividendEvent.security_id, SecurityDividendEvent.ex_date)
            .execution_options(populate_existing=True)
        )
    ).scalars()
    return [(r.security_id, r.ex_date, r.per_share) for r in rows]


async def synced_on(db, security_id: int) -> date | None:
    return (
        await db.execute(
            select(Security.dividend_events_synced_on).where(Security.id == security_id)
        )
    ).scalar_one()


async def test_stores_only_pre_window_events(db):
    """The rolling refresh window belongs to the LEDGER (dividend_payments): an event
    inside it must not also be stored here, or the chart would draw it twice."""
    sec = await seed_security(db)
    await seed_history(db, FLOOR, date(2026, 8, 17))
    provider = FakeProvider(
        {
            "DIVX": [
                bar(date(2024, 3, 15), "1.7100"),
                bar(BEFORE_WINDOW, "1.7500"),  # the last day OUTSIDE the window: stored
                bar(WINDOW_START, "1.8000"),  # the boundary itself is the ledger's
                bar(date(2026, 6, 19), "1.8200"),  # in-window: the ledger's
                bar(date(2026, 8, 19), "0"),  # a plain price bar carries no event
            ]
        }
    )

    counts = await backfill_dividend_events(db, provider, today=TODAY)
    await db.commit()

    assert counts == {"created": 2, "synced": 1, "failed": 0}
    assert await stored_events(db) == [
        (sec.id, date(2024, 3, 15), Decimal("1.710000")),
        (sec.id, BEFORE_WINDOW, Decimal("1.750000")),
    ]
    assert await synced_on(db, sec.id) == TODAY


async def test_floor_is_the_earliest_value_history_snapshot(db):
    sec = await seed_security(db)
    await seed_history(db, date(2024, 1, 1), FLOOR, date(2026, 8, 17))
    provider = FakeProvider({"DIVX": [bar(date(2024, 3, 15), "1.7100")]})

    await backfill_dividend_events(db, provider, today=TODAY)
    await db.commit()

    assert provider.calls == [("DIVX", FLOOR)]  # the chart's own left edge, not 370 days
    assert await synced_on(db, sec.id) == TODAY


async def test_empty_value_history_fetches_nothing_and_marks_nothing(db):
    """No chart yet, so nothing to annotate — and crucially nothing is MARKED, which is
    what re-arms the backfill for the refresh after the first workbook import."""
    sec = await seed_security(db)
    provider = FakeProvider({"DIVX": [bar(date(2024, 3, 15), "1.7100")]})

    counts = await backfill_dividend_events(db, provider, today=TODAY)
    await db.commit()

    assert counts == {"created": 0, "synced": 0, "failed": 0}
    assert provider.calls == []
    assert await stored_events(db) == []
    assert await synced_on(db, sec.id) is None


async def test_zero_dividend_ticker_is_marked_and_never_refetched(db):
    """A ticker that has never paid a dividend still ANSWERS (years of price bars): it is
    marked with zero rows, precisely so the deep fetch never runs for it again."""
    sec = await seed_security(db, "GROW")
    await seed_history(db, FLOOR)
    provider = FakeProvider({"GROW": [bar(date(2024, 3, 15)), bar(date(2024, 6, 14))]})

    counts = await backfill_dividend_events(db, provider, today=TODAY)
    await db.commit()

    assert counts == {"created": 0, "synced": 1, "failed": 0}
    assert await stored_events(db) == []
    assert await synced_on(db, sec.id) == TODAY

    second = await backfill_dividend_events(db, provider, today=date(2026, 9, 1))
    await db.commit()
    assert second == {"created": 0, "synced": 0, "failed": 0}
    assert provider.calls == [("GROW", FLOOR)]  # exactly one fetch, ever


async def test_idempotent_rerun_creates_nothing(db):
    """A re-run against an UNMARKED security (the marker was lost, or the security was
    re-armed) re-fetches, but a stored marker is frozen history: skip, never rewrite."""
    sec = await seed_security(db)
    await seed_history(db, FLOOR)
    provider = FakeProvider(
        {"DIVX": [bar(date(2024, 3, 15), "1.7100"), bar(date(2024, 6, 14), "1.7500")]}
    )

    first = await backfill_dividend_events(db, provider, today=TODAY)
    await db.commit()
    assert first == {"created": 2, "synced": 1, "failed": 0}
    before = [
        (r.id, r.ex_date, r.per_share)
        for r in (
            await db.execute(select(SecurityDividendEvent).order_by(SecurityDividendEvent.ex_date))
        ).scalars()
    ]

    sec.dividend_events_synced_on = None  # re-arm by hand: the fetch must still be a no-op
    await db.commit()
    second = await backfill_dividend_events(db, provider, today=TODAY)
    await db.commit()

    assert second == {"created": 0, "synced": 1, "failed": 0}
    after = [
        (r.id, r.ex_date, r.per_share)
        for r in (
            await db.execute(
                select(SecurityDividendEvent)
                .order_by(SecurityDividendEvent.ex_date)
                .execution_options(populate_existing=True)
            )
        ).scalars()
    ]
    assert after == before  # same row ids, same amounts


async def test_provider_failure_leaves_the_security_unmarked_and_others_proceed(db):
    """refresh_prices' isolation posture: one ticker's transport error is that ticker's
    problem, and an unmarked security is simply retried on the next refresh."""
    bad = await seed_security(db, "BAD")
    good = await seed_security(db, "DIVX")
    await seed_history(db, FLOOR)
    provider = FakeProvider(
        {"DIVX": [bar(date(2024, 3, 15), "1.7100")]},
        errors={"BAD": RuntimeError("yahoo said no")},
    )

    counts = await backfill_dividend_events(db, provider, today=TODAY)
    await db.commit()

    assert counts == {"created": 1, "synced": 1, "failed": 1}
    assert [c[0] for c in provider.calls] == ["BAD", "DIVX"]  # DIVX still attempted
    assert await stored_events(db) == [(good.id, date(2024, 3, 15), Decimal("1.710000"))]
    assert await synced_on(db, bad.id) is None
    assert await synced_on(db, good.id) == TODAY


async def test_empty_bars_are_a_failure_not_a_zero_payer(db):
    """A blocked or rate-limited yfinance does NOT raise — it hands back a 0-row frame
    (verified on the dev box 2026-08-28). An empty answer is therefore indistinguishable
    from a failure and must NOT mark the security, or one throttled run would extinguish
    the one-time backfill forever with nothing stored (backfill_employer_history's
    "do not watermark an empty answer")."""
    sec = await seed_security(db)
    await seed_history(db, FLOOR)
    provider = FakeProvider({})  # DIVX answers with []

    counts = await backfill_dividend_events(db, provider, today=TODAY)
    await db.commit()

    assert counts == {"created": 0, "synced": 0, "failed": 1}
    assert await stored_events(db) == []
    assert await synced_on(db, sec.id) is None

    # The block lifts: the very next refresh backfills the security it did not mark.
    provider.data["DIVX"] = [bar(date(2024, 3, 15), "1.7100")]
    later = await backfill_dividend_events(db, provider, today=date(2026, 9, 1))
    await db.commit()

    assert later == {"created": 1, "synced": 1, "failed": 0}
    assert await stored_events(db) == [(sec.id, date(2024, 3, 15), Decimal("1.710000"))]
    assert await synced_on(db, sec.id) == date(2026, 9, 1)


async def test_population_is_active_auto_priced_and_unsynced(db):
    """Exactly the refresh's own population (active + auto-priced), narrowed to the
    securities that have never been deep-fetched."""
    live = await seed_security(db, "DIVX")
    await seed_security(db, "MANU", manual=True)
    await seed_security(db, "GONE", active=False)
    done = await seed_security(db, "DONE", synced_on=date(2026, 1, 1))
    await seed_history(db, FLOOR)
    provider = FakeProvider(
        {ticker: [bar(date(2024, 3, 15), "1.7100")] for ticker in ("DIVX", "MANU", "GONE", "DONE")}
    )

    counts = await backfill_dividend_events(db, provider, today=TODAY)
    await db.commit()

    assert counts == {"created": 1, "synced": 1, "failed": 0}
    assert provider.calls == [("DIVX", FLOOR)]
    assert await stored_events(db) == [(live.id, date(2024, 3, 15), Decimal("1.710000"))]
    assert await synced_on(db, done.id) == date(2026, 1, 1)  # untouched, not re-stamped


async def test_absurd_per_share_values_are_bounded_out(db):
    """DIVIDEND_MAX_ABS, the ingest's own bound: a feed glitch must not become a marker."""
    sec = await seed_security(db)
    await seed_history(db, FLOOR)
    provider = FakeProvider(
        {
            "DIVX": [
                bar(date(2024, 3, 15), "1000000"),  # == DIVIDEND_MAX_ABS: out
                bar(date(2024, 6, 14), "-2.0000"),  # negative: out
                bar(date(2024, 9, 13), "1.7500"),  # sane: in
            ]
        }
    )

    counts = await backfill_dividend_events(db, provider, today=TODAY)
    await db.commit()

    assert counts == {"created": 1, "synced": 1, "failed": 0}
    assert await stored_events(db) == [(sec.id, date(2024, 9, 13), Decimal("1.750000"))]


async def test_duplicate_bar_dates_deduped_last_wins(db):
    """The provider promises neither unique nor ordered bars, and a duplicate date inside
    one INSERT is a CardinalityViolation (refresh_prices' documented hazard)."""
    sec = await seed_security(db)
    await seed_history(db, FLOOR)
    provider = FakeProvider(
        {"DIVX": [bar(date(2024, 3, 15), "1.7100"), bar(date(2024, 3, 15), "1.7500")]}
    )

    counts = await backfill_dividend_events(db, provider, today=TODAY)
    await db.commit()

    assert counts == {"created": 1, "synced": 1, "failed": 0}
    assert await stored_events(db) == [(sec.id, date(2024, 3, 15), Decimal("1.750000"))]


async def test_writes_no_money_anywhere(db):
    """THE WRONG-MONEY GUARD (user decision 2026-08-28). The imported book is dateless by
    construction, so the ledger cannot know how many shares were held on a 2024 ex-date —
    a dollar total here would be invented. These rows are chart ANNOTATIONS: this module
    must never write dividend_payments, and never touch latest_prices or the TTM metadata
    the refresh owns. If a future change makes it write money, this is the test that must
    be argued with."""
    sec = await seed_security(db)
    sec.annual_dividend = Decimal("6.8400")
    sec.ex_div_date = date(2026, 6, 19)
    db.add(
        LatestPrice(
            security_id=sec.id,
            price=Decimal("500.0000"),
            quoted_at=datetime(2026, 8, 19, 20, 0, tzinfo=UTC),
            source="yfinance",
        )
    )
    await seed_history(db, FLOOR)
    await db.commit()
    provider = FakeProvider({"DIVX": [bar(date(2024, 3, 15), "1.7100", close="42.0000")]})

    counts = await backfill_dividend_events(db, provider, today=TODAY)
    await db.commit()

    assert counts["created"] == 1
    assert (await db.execute(select(DividendPayment))).scalars().all() == []
    quote = await db.get(LatestPrice, sec.id)
    assert quote.price == Decimal("500.0000") and quote.source == "yfinance"
    refreshed = (
        await db.execute(
            select(Security).where(Security.id == sec.id).execution_options(populate_existing=True)
        )
    ).scalar_one()
    assert refreshed.annual_dividend == Decimal("6.8400")
    assert refreshed.ex_div_date == date(2026, 6, 19)
    # The weekly series the floor was read from is read-only here.
    assert [
        r.snapshot_date for r in (await db.execute(select(PortfolioValueHistory))).scalars()
    ] == [FLOOR]
