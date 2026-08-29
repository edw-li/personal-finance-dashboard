"""The display-only historical ex-dividend backfill (2026-08-28 spec).

The split between "the ledger owns this" and "this is a chart annotation" is the whole
feature, and since the 2026-08-28 review it is decided by EXCLUSION — an ex-date
dividend_payments carries with source='auto' is never annotated — rather than by window
arithmetic. The window dates below are still pinned literally, exactly like
test_dividend_ingest's WINDOW_START, because they are what puts a test event on one side or
the other of the INGEST's reach; a computed constant would move with the code it is meant
to hold still.
"""

from datetime import UTC, date, datetime, timedelta
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
from tests.portfolio_factories import acct

TODAY = date(2026, 8, 20)
# The INGEST's reach, pinned literally: TODAY - 370 days (HISTORY_WINDOW_DAYS). This module
# no longer computes anything from it — it only makes "in-window" vs "out of the ingest's
# reach" concrete in the tests below.
WINDOW_START = date(2025, 8, 15)
BEFORE_WINDOW = date(2025, 8, 14)
FLOOR = date(2023, 10, 23)  # the workbook's first weekly snapshot
SHALLOW_FLOOR = date(2025, 1, 6)  # a series that has not been re-imported backward yet


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


async def seed_security(db, ticker="DIVX", *, manual=False, active=True, floor=None) -> Security:
    sec = Security(
        ticker=ticker,
        name=f"{ticker} Inc",
        holding_type="stock",
        is_manual_priced=manual,
        is_active=active,
        dividend_events_floor=floor,
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


async def floor_of(db, security_id: int) -> date | None:
    """The marker: WHERE the last successful deep fetch ran from, not merely that it ran."""
    return (
        await db.execute(select(Security.dividend_events_floor).where(Security.id == security_id))
    ).scalar_one()


def auto_row(security_id: int, ex_date: date, per_share: str = "1.800000") -> DividendPayment:
    """A ledger row exactly as dividend_ingest writes it: source='auto', ex_date set."""
    return DividendPayment(
        security_id=security_id,
        portfolio_account=acct("RH Taxable"),
        pay_date=ex_date,
        amount=Decimal("18.00"),
        source="auto",
        ex_date=ex_date,
        per_share=Decimal(per_share),
        shares_held=Decimal("10.000000"),
    )


async def test_stores_every_event_the_auto_ledger_does_not_carry(db):
    """THE SPLIT, enforced by exclusion at WRITE time rather than by window arithmetic
    (review 2026-08-28). An in-window ex-date the ingest produced NO row for — nothing held
    that day, dust that rounded to no money, a manual overlap it skipped — is a real event
    the chart should mark, and under a window rule it fell into a permanent crack the moment
    the window slid past it. Only the pairs the ledger actually carries are excluded."""
    sec = await seed_security(db)
    await seed_history(db, FLOOR, date(2026, 8, 17))
    db.add(auto_row(sec.id, date(2026, 6, 19), "1.820000"))
    await db.commit()
    provider = FakeProvider(
        {
            "DIVX": [
                bar(date(2024, 3, 15), "1.7100"),  # pre-window, unledgered
                bar(BEFORE_WINDOW, "1.7500"),  # pre-window, unledgered
                bar(WINDOW_START, "1.8000"),  # IN-window but unledgered: stored
                bar(date(2026, 6, 19), "1.8200"),  # in-window AND ledgered: skipped
                bar(date(2026, 8, 19), "0"),  # a plain price bar carries no event
            ]
        }
    )

    counts = await backfill_dividend_events(db, provider, today=TODAY)
    await db.commit()

    assert counts == {"created": 3, "synced": 1, "failed": 0}
    assert await stored_events(db) == [
        (sec.id, date(2024, 3, 15), Decimal("1.710000")),
        (sec.id, BEFORE_WINDOW, Decimal("1.750000")),
        (sec.id, WINDOW_START, Decimal("1.800000")),
    ]
    assert await floor_of(db, sec.id) == FLOOR


async def test_auto_ledgered_pairs_are_skipped_however_late_the_backfill_arrives(db):
    """The duplicate a window rule could not prevent: a backfill that first runs long after
    the window has slid past a FROZEN pre-window auto row would have stored a marker on top
    of it. Exclusion is timing-independent — the pair is the ledger's, forever."""
    sec = await seed_security(db)
    await seed_history(db, FLOOR)
    # Frozen history: written while in-window, now well outside it (test_dividend_ingest's
    # "pre-window auto row: frozen history, never healed against").
    db.add(auto_row(sec.id, date(2024, 3, 15), "1.710000"))
    await db.commit()
    provider = FakeProvider(
        {"DIVX": [bar(date(2024, 3, 15), "1.7100"), bar(date(2024, 6, 14), "1.7500")]}
    )

    counts = await backfill_dividend_events(db, provider, today=TODAY)
    await db.commit()

    assert counts == {"created": 1, "synced": 1, "failed": 0}
    assert await stored_events(db) == [(sec.id, date(2024, 6, 14), Decimal("1.750000"))]


async def test_manual_dividend_rows_do_not_suppress_markers(db):
    """source='manual' rows are the user's own bookkeeping and carry no ex_date — they are
    not a statement about which events EXIST, so they suppress nothing here. The frontend
    owns whatever manual-row de-duplication the chart wants."""
    sec = await seed_security(db)
    await seed_history(db, FLOOR)
    db.add(
        DividendPayment(
            security_id=sec.id,
            portfolio_account=acct("RH Taxable"),
            pay_date=date(2024, 3, 15),
            amount=Decimal("17.10"),
        )
    )
    await db.commit()
    provider = FakeProvider({"DIVX": [bar(date(2024, 3, 15), "1.7100")]})

    counts = await backfill_dividend_events(db, provider, today=TODAY)
    await db.commit()

    assert counts == {"created": 1, "synced": 1, "failed": 0}
    assert await stored_events(db) == [(sec.id, date(2024, 3, 15), Decimal("1.710000"))]


async def test_events_after_today_are_not_annotated(db):
    """`today` bounds the top of the range exactly as the floor bounds the bottom: a
    future-dated bar is not history, and the announced-ex-div column owns what is coming."""
    sec = await seed_security(db)
    await seed_history(db, FLOOR)
    provider = FakeProvider(
        {"DIVX": [bar(TODAY, "1.7100"), bar(TODAY + timedelta(days=1), "1.7500")]}
    )

    counts = await backfill_dividend_events(db, provider, today=TODAY)
    await db.commit()

    assert counts == {"created": 1, "synced": 1, "failed": 0}
    assert await stored_events(db) == [(sec.id, TODAY, Decimal("1.710000"))]


async def test_floor_is_the_earliest_value_history_snapshot(db):
    sec = await seed_security(db)
    await seed_history(db, date(2024, 1, 1), FLOOR, date(2026, 8, 17))
    provider = FakeProvider({"DIVX": [bar(date(2024, 3, 15), "1.7100")]})

    await backfill_dividend_events(db, provider, today=TODAY)
    await db.commit()

    assert provider.calls == [("DIVX", FLOOR)]  # the chart's own left edge, not 370 days
    assert await floor_of(db, sec.id) == FLOOR


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
    assert await floor_of(db, sec.id) is None


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
    assert await floor_of(db, sec.id) == FLOOR

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

    sec.dividend_events_floor = None  # re-arm by hand: the fetch must still be a no-op
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
    assert await floor_of(db, bad.id) is None
    assert await floor_of(db, good.id) == FLOOR


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
    assert await floor_of(db, sec.id) is None

    # The block lifts: the very next refresh backfills the security it did not mark.
    provider.data["DIVX"] = [bar(date(2024, 3, 15), "1.7100")]
    later = await backfill_dividend_events(db, provider, today=date(2026, 9, 1))
    await db.commit()

    assert later == {"created": 1, "synced": 1, "failed": 0}
    assert await stored_events(db) == [(sec.id, date(2024, 3, 15), Decimal("1.710000"))]
    assert await floor_of(db, sec.id) == FLOOR


async def test_population_is_active_auto_priced_and_not_already_this_deep(db):
    """Exactly the refresh's own population (active + auto-priced), narrowed to the
    securities whose recorded floor does not already reach the chart's left edge."""
    live = await seed_security(db, "DIVX")
    await seed_security(db, "MANU", manual=True)
    await seed_security(db, "GONE", active=False)
    done = await seed_security(db, "DONE", floor=FLOOR)
    await seed_history(db, FLOOR)
    provider = FakeProvider(
        {ticker: [bar(date(2024, 3, 15), "1.7100")] for ticker in ("DIVX", "MANU", "GONE", "DONE")}
    )

    counts = await backfill_dividend_events(db, provider, today=TODAY)
    await db.commit()

    assert counts == {"created": 1, "synced": 1, "failed": 0}
    assert provider.calls == [("DIVX", FLOOR)]
    assert await stored_events(db) == [(live.id, date(2024, 3, 15), Decimal("1.710000"))]
    assert await floor_of(db, done.id) == FLOOR  # untouched, not re-stamped


async def test_tickers_that_already_failed_this_run_are_not_refetched(db):
    """RETRY AMPLIFICATION (review 2026-08-28). When the provider is blocked, refresh_prices
    has already burned one failed call per ticker; issuing a second, FULL-history call for
    each of them doubles the load on the very rate limiter that is most likely causing the
    block — on every refresh, including synchronous manual clicks. A ticker that failed this
    run is skipped outright: not called, not marked, retried next run."""
    blocked = await seed_security(db, "BAD")
    good = await seed_security(db, "DIVX")
    await seed_history(db, FLOOR)
    provider = FakeProvider(
        {ticker: [bar(date(2024, 3, 15), "1.7100")] for ticker in ("BAD", "DIVX")}
    )

    counts = await backfill_dividend_events(
        db, provider, today=TODAY, skip_tickers=frozenset({"BAD"})
    )
    await db.commit()

    assert provider.calls == [("DIVX", FLOOR)]  # BAD was never called a second time
    assert counts == {"created": 1, "synced": 1, "failed": 0}
    assert await stored_events(db) == [(good.id, date(2024, 3, 15), Decimal("1.710000"))]
    assert await floor_of(db, blocked.id) is None  # unarmed: next run tries again
    assert await floor_of(db, good.id) == FLOOR


async def test_a_deeper_floor_re_arms_a_security(db):
    """The marker records WHERE the fetch ran from, not merely THAT it ran. A workbook
    re-import that extends portfolio_value_history backward moves the chart's left edge,
    and every security whose recorded floor is shallower than the new one must re-arm —
    otherwise the newly exposed era stays permanently unannotated."""
    sec = await seed_security(db)
    await seed_history(db, SHALLOW_FLOOR)
    provider = FakeProvider({"DIVX": [bar(date(2025, 3, 14), "1.7500")]})

    first = await backfill_dividend_events(db, provider, today=TODAY)
    await db.commit()
    assert first == {"created": 1, "synced": 1, "failed": 0}
    assert await floor_of(db, sec.id) == SHALLOW_FLOOR

    # The re-import lands: the series now reaches back to 2023 and the fetch re-arms.
    await seed_history(db, FLOOR)
    provider.data["DIVX"] = [bar(date(2024, 3, 15), "1.7100"), bar(date(2025, 3, 14), "1.7500")]
    second = await backfill_dividend_events(db, provider, today=TODAY)
    await db.commit()

    # Only the newly exposed era is new; the already-stored event upserts to nothing.
    assert second == {"created": 1, "synced": 1, "failed": 0}
    assert provider.calls == [("DIVX", SHALLOW_FLOOR), ("DIVX", FLOOR)]
    assert await stored_events(db) == [
        (sec.id, date(2024, 3, 15), Decimal("1.710000")),
        (sec.id, date(2025, 3, 14), Decimal("1.750000")),
    ]
    assert await floor_of(db, sec.id) == FLOOR

    # A third run at the same floor is a no-op: the recorded floor is no longer shallower.
    third = await backfill_dividend_events(db, provider, today=TODAY)
    await db.commit()
    assert third == {"created": 0, "synced": 0, "failed": 0}
    assert len(provider.calls) == 2


async def test_per_share_over_the_column_ceiling_is_skipped_and_the_security_still_syncs(db):
    """THE OVERFLOW LOOP (review 2026-08-28). per_share is Numeric(10, 6), so 9999.999999
    is the largest storable value — but the ingest's DIVIDEND_MAX_ABS is 10^6, and a
    glitched feed value in the [10^4, 10^6) band would sail past that bound straight into
    an INSERT that OVERFLOWS. The overflow rolls back this security's savepoint, the marker
    is never recorded, and because the deep history is STATIC the same fetch would refail on
    every refresh forever. Bounding at the column's own ceiling is what breaks the loop: the
    bad event is dropped like dust, the good ones store, and the security still syncs — a
    data glitch is not a provider failure."""
    sec = await seed_security(db)
    await seed_history(db, FLOOR)
    provider = FakeProvider(
        {
            "DIVX": [
                bar(date(2024, 3, 15), "15000.0000"),  # the overflow band: out, no crash
                bar(date(2024, 6, 14), "10000.0000"),  # exactly at the cap: exclusive, out
                bar(date(2024, 9, 13), "-2.0000"),  # negative: out
                bar(date(2024, 12, 13), "9999.9999"),  # just under the ceiling: storable
                bar(date(2025, 3, 14), "1.7500"),  # sane: in
            ]
        }
    )

    counts = await backfill_dividend_events(db, provider, today=TODAY)
    await db.commit()

    assert counts == {"created": 2, "synced": 1, "failed": 0}
    assert await stored_events(db) == [
        (sec.id, date(2024, 12, 13), Decimal("9999.999900")),
        (sec.id, date(2025, 3, 14), Decimal("1.750000")),
    ]
    assert await floor_of(db, sec.id) == FLOOR  # marked: the loop cannot form


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
