import time
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import select

from app.models import (
    AppSetting,
    DividendPayment,
    LatestPrice,
    PortfolioValueHistory,
    PositionTransaction,
    PriceHistory,
    Security,
)
from app.services.price_provider import DailyBar
from app.services.price_service import LAST_REFRESH_KEY

REFRESH = "/api/v1/prices/refresh"
STATUS = "/api/v1/prices/refresh-status"
HISTORY = "/api/v1/prices/history"
SPARKLINES = "/api/v1/prices/sparklines"
PRICES = "/api/v1/prices"
TRANSACTIONS = "/api/v1/portfolio/transactions"
VALUE_SERIES = "/api/v1/portfolio/history"

D = Decimal


class FakeProvider:
    """Deliberately duplicated from test_price_service — these tests stay standalone
    readable, and the endpoint swaps it in via the app.api.prices.get_provider hook.
    `delay` makes a fetch take measurable wall time so duration_ms can be pinned."""

    def __init__(self, data=None, errors=None, delay=0.0):
        self.data = data or {}
        self.errors = errors or {}
        self.delay = delay
        self.calls: list[tuple[str, date]] = []

    def fetch_daily(self, ticker, start):
        self.calls.append((ticker, start))
        time.sleep(self.delay)
        if ticker in self.errors:
            raise self.errors[ticker]
        return self.data.get(ticker, [])


def bar(day, close, dividend="0"):
    return DailyBar(bar_date=day, close=D(close), dividend=D(dividend))


async def seed_security(db, ticker, **fields) -> Security:
    security = Security(ticker=ticker, name=f"{ticker} Inc", holding_type="stock", **fields)
    db.add(security)
    await db.commit()
    return security


# The live value series is Monday-gated (the sheet's weekly cadence). The refresh
# endpoint has no date parameter — it runs on the scheduler-zone product_today() — so
# tests that expect an appended row pin that clock to a fixed Monday; a real-clock test
# would pass one day in seven.
MONDAY = date(2026, 8, 17)


def freeze_service_today(monkeypatch, day: date) -> None:
    monkeypatch.setattr("app.services.price_service.product_today", lambda: day)


# --- refresh ---


async def test_refresh_endpoint_runs_and_reports(auth_client, db, monkeypatch):
    security = await seed_security(db, "NVDA")
    today = date.today()
    yesterday = today - timedelta(days=1)
    provider = FakeProvider({"NVDA": [bar(yesterday, "220"), bar(today, "225.5")]}, delay=0.05)
    monkeypatch.setattr("app.api.prices.get_provider", lambda: provider)

    resp = await auth_client.post(REFRESH)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["updated"] == ["NVDA"]
    assert body["failed"] == {}
    assert body["skipped_manual"] == []
    assert body["dividends_ingested"] == 0  # no dividend events in these bars
    # MILLIseconds, not seconds: a 50ms provider fetch must not report "0" or "50000".
    assert isinstance(body["duration_ms"], int)
    assert 20 <= body["duration_ms"] < 60_000
    # The endpoint injects nothing but the provider — the service owns the 370-day window.
    assert provider.calls == [("NVDA", today - timedelta(days=370))]

    latest = await db.get(LatestPrice, security.id)
    assert latest is not None
    assert latest.price == D("225.5000") and latest.source == "yfinance"
    assert latest.quoted_at == datetime.combine(today, datetime.min.time(), tzinfo=UTC)
    rows = (
        (await db.execute(select(PriceHistory).order_by(PriceHistory.price_date))).scalars().all()
    )
    assert [(r.price_date, r.close) for r in rows] == [
        (yesterday, D("220.0000")),
        (today, D("225.5000")),
    ]

    # No held shares: the live value series has nothing honest to record — but the run
    # itself is still on the books, with the skip stated.
    assert (await auth_client.get(VALUE_SERIES)).json()["dates"] == []
    status = (await auth_client.get(STATUS)).json()
    assert status["last"]["trigger"] == "manual"
    assert status["last"]["history_appended"] is False
    assert status["next_run_at"] is None  # tests never start the scheduler


async def test_refresh_endpoint_ingests_dividends_and_echoes_the_counts(
    auth_client, db, monkeypatch
):
    security = await seed_security(db, "DIVX")
    db.add(
        PositionTransaction(
            security_id=security.id,
            account="RH Taxable",
            type="buy",
            shares=D("10.000000"),
            price=D("100.0000"),
            sort_index=10,
            source="ui",
        )
    )
    await db.commit()
    today = date.today()
    ex_date = today - timedelta(days=30)
    provider = FakeProvider({"DIVX": [bar(ex_date, "100", "0.8200"), bar(today, "120")]})
    monkeypatch.setattr("app.api.prices.get_provider", lambda: provider)

    resp = await auth_client.post(REFRESH)
    assert resp.status_code == 200, resp.text
    assert resp.json()["dividends_ingested"] == 1  # the header note's "N dividends logged"

    rows = (await db.execute(select(DividendPayment))).scalars().all()
    assert [(r.account, r.ex_date, r.pay_date, r.amount, r.source) for r in rows] == [
        ("RH Taxable", ex_date, ex_date, D("8.20"), "auto")  # 10 shares × 0.82
    ]

    status = (await auth_client.get(STATUS)).json()
    assert status["last"]["dividends_ingested"] == 1
    assert status["last"]["dividends_removed"] == 0
    assert status["last"]["dividends_skipped_overlap"] == 0


async def test_refresh_requires_auth(client):
    assert (await client.post(REFRESH)).status_code == 401


# --- refresh status + the live value series ---


async def test_refresh_status_requires_auth(client):
    assert (await client.get(STATUS)).status_code == 401


async def test_refresh_status_empty_before_any_run(auth_client):
    resp = await auth_client.get(STATUS)
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"last": None, "next_run_at": None}


async def test_refresh_status_tolerates_pre_feature_payloads(auth_client, db):
    # A payload written before this feature has no dividend keys at all — the stored blob
    # is convention-shaped JSON, and a deploy must not 500 the header line on its own
    # history. The three counts read as "unknown" (None), not as zero.
    db.add(
        AppSetting(
            key=LAST_REFRESH_KEY,
            value={
                "value": {
                    "at": "2026-08-01T20:10:00+00:00",
                    "trigger": "scheduled",
                    "updated": 3,
                    "failed": {},
                    "skipped_manual": 1,
                    "history_appended": True,
                }
            },
        )
    )
    await db.commit()
    resp = await auth_client.get(STATUS)
    assert resp.status_code == 200, resp.text
    last = resp.json()["last"]
    assert last["updated"] == 3 and last["history_appended"] is True
    assert last["dividends_ingested"] is None
    assert last["dividends_removed"] is None
    assert last["dividends_skipped_overlap"] is None


async def test_refresh_status_drops_failures_that_left_the_refresh_population(
    auth_client, db, monkeypatch
):
    # The reported bug: deactivating a failed ticker cleared the Portfolio chip (a
    # client-side filter) but the Overview strip kept nagging — the persisted record is
    # rewritten only when a refresh RUNS. The status endpoint now scopes `failed` to
    # tickers a future refresh would still attempt, so every consumer clears at once.
    zi = await seed_security(db, "ZI")
    vf = await seed_security(db, "VFFSX")
    provider = FakeProvider(
        errors={"ZI": RuntimeError("delisted"), "VFFSX": RuntimeError("no coverage")}
    )
    monkeypatch.setattr("app.api.prices.get_provider", lambda: provider)
    assert (await auth_client.post(REFRESH)).status_code == 200

    status = (await auth_client.get(STATUS)).json()
    assert set(status["last"]["failed"]) == {"ZI", "VFFSX"}

    # The two remedies for a dead symbol: deactivate one, hand the other to manual
    # pricing. Both leave the refresh population — neither failure is actionable now.
    deactivated = await auth_client.patch(
        f"/api/v1/portfolio/securities/{zi.id}", json={"is_active": False}
    )
    assert deactivated.status_code == 200, deactivated.text
    manual = await auth_client.patch(
        f"/api/v1/portfolio/securities/{vf.id}", json={"is_manual_priced": True}
    )
    assert manual.status_code == 200, manual.text

    cleared = (await auth_client.get(STATUS)).json()
    assert cleared["last"]["failed"] == {}
    # Only the actionability view moved — the run's other facts stand verbatim.
    assert cleared["last"]["trigger"] == "manual"
    assert cleared["last"]["updated"] == 0


async def test_refresh_appends_the_live_value_series_and_records_the_run(
    auth_client, db, monkeypatch
):
    security = await seed_security(db, "NVDA")
    db.add(
        PositionTransaction(
            security_id=security.id,
            account="Fidelity",
            type="buy",
            shares=D("10.000000"),
            price=D("100.0000"),
            sort_index=10,
            source="ui",
        )
    )
    await db.commit()
    today = MONDAY
    freeze_service_today(monkeypatch, today)
    provider = FakeProvider({"NVDA": [bar(today - timedelta(days=1), "220"), bar(today, "225.5")]})
    monkeypatch.setattr("app.api.prices.get_provider", lambda: provider)

    resp = await auth_client.post(REFRESH)
    assert resp.status_code == 200, resp.text

    series = (await auth_client.get(VALUE_SERIES)).json()
    assert series["dates"] == [today.isoformat()]
    assert series["market_value"] == ["2255.00"]  # 10 shares × the 225.50 close
    assert series["cost_basis"] == ["1000.00"]  # 10 × the 100 buy
    # No prior series to extend: the baseline is REBORN at parity with the book.
    assert series["sp500"] == ["2255.00"]

    status = (await auth_client.get(STATUS)).json()
    assert status["last"]["trigger"] == "manual"
    assert status["last"]["updated"] == 1
    assert status["last"]["failed"] == {}
    assert status["last"]["skipped_manual"] == 0
    assert status["last"]["history_appended"] is True
    assert datetime.fromisoformat(status["last"]["at"]).tzinfo is not None  # UTC-stamped

    # A second run the same day UPSERTS the same date — the series never forks.
    assert (await auth_client.post(REFRESH)).status_code == 200
    assert (await auth_client.get(VALUE_SERIES)).json()["dates"] == [today.isoformat()]


async def test_refresh_extends_the_baseline_by_implied_shares(auth_client, db, monkeypatch):
    # A held, priced book plus a prior imported row and benchmark bars on both sides of it.
    security = await seed_security(db, "NVDA")
    voo = await seed_security(db, "VOO", is_manual_priced=True)  # the refresh skips it
    today = MONDAY
    freeze_service_today(monkeypatch, today)
    db.add_all(
        [
            PositionTransaction(
                security_id=security.id,
                account="Fidelity",
                type="buy",
                shares=D("10.000000"),
                price=D("100.0000"),
                sort_index=10,
                source="ui",
            ),
            PortfolioValueHistory(
                snapshot_date=today - timedelta(days=7),
                market_value=D("9000.00"),
                cost_basis=D("5000.00"),
                sp500_value=D("8000.00"),
            ),
            PriceHistory(
                security_id=voo.id, price_date=today - timedelta(days=8), close=D("400.0000")
            ),
            PriceHistory(
                security_id=voo.id, price_date=today - timedelta(days=1), close=D("410.0000")
            ),
        ]
    )
    await db.commit()
    provider = FakeProvider({"NVDA": [bar(today, "225.5")]})
    monkeypatch.setattr("app.api.prices.get_provider", lambda: provider)

    assert (await auth_client.post(REFRESH)).status_code == 200

    series = (await auth_client.get(VALUE_SERIES)).json()
    assert series["dates"][-1] == today.isoformat()
    # 8000 / 400 (the close on-or-before the anchor row) = 20 implied shares, × 410 today.
    assert series["sp500"] == ["8000.00", "8200.00"]
    assert series["market_value"][-1] == "2255.00"


async def test_refresh_carries_the_baseline_flat_without_benchmark_bars(
    auth_client, db, monkeypatch
):
    security = await seed_security(db, "NVDA")
    today = MONDAY
    freeze_service_today(monkeypatch, today)
    db.add_all(
        [
            PositionTransaction(
                security_id=security.id,
                account="Fidelity",
                type="buy",
                shares=D("10.000000"),
                price=D("100.0000"),
                sort_index=10,
                source="ui",
            ),
            PortfolioValueHistory(
                snapshot_date=today - timedelta(days=7),
                market_value=D("9000.00"),
                cost_basis=D("5000.00"),
                sp500_value=D("8000.00"),
            ),
        ]
    )
    await db.commit()
    provider = FakeProvider({"NVDA": [bar(today, "225.5")]})
    monkeypatch.setattr("app.api.prices.get_provider", lambda: provider)

    assert (await auth_client.post(REFRESH)).status_code == 200
    # No benchmark bars anywhere: the leg carries flat rather than inventing a move.
    assert (await auth_client.get(VALUE_SERIES)).json()["sp500"] == ["8000.00", "8000.00"]


# --- history ---


async def test_history_endpoint_window_and_404(auth_client, db):
    security = await seed_security(db, "NVDA")
    today = date.today()
    db.add_all(
        [
            # Column-scale Decimals: the shared-session fixture serves these very ORM
            # objects back to the endpoint, so "110" would cross the wire as "110".
            PriceHistory(
                security_id=security.id,
                price_date=today - timedelta(days=400),
                close=D("100.0000"),
            ),
            PriceHistory(
                security_id=security.id, price_date=today - timedelta(days=10), close=D("110.0000")
            ),
            PriceHistory(
                security_id=security.id, price_date=today - timedelta(days=1), close=D("120.5000")
            ),
        ]
    )
    await db.commit()

    resp = await auth_client.get(f"{HISTORY}/NVDA", params={"days": 30})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["ticker"] == "NVDA"
    # date-ascending, and the 400-day-old bar falls outside the 30-day window
    assert [p["d"] for p in body["points"]] == [
        (today - timedelta(days=10)).isoformat(),
        (today - timedelta(days=1)).isoformat(),
    ]
    assert [p["c"] for p in body["points"]] == ["110.0000", "120.5000"]  # money as strings

    lower = await auth_client.get(f"{HISTORY}/nvda", params={"days": 30})
    assert lower.status_code == 200, lower.text
    assert lower.json() == body  # ticker lookup normalizes case, like the securities router

    assert (await auth_client.get(f"{HISTORY}/ZZZZ")).status_code == 404
    assert (await auth_client.get(f"{HISTORY}/NVDA", params={"days": 0})).status_code == 422
    assert (await auth_client.get(f"{HISTORY}/NVDA", params={"days": 4000})).status_code == 422


# --- sparklines ---


async def test_sparklines_held_only_weekly_downsampled(auth_client, db):
    held = await seed_security(db, "NVDA")
    unheld = await seed_security(db, "ZM")
    liquidated = await seed_security(db, "TSLA")
    db.add(
        PositionTransaction(
            security_id=held.id,
            account="Fidelity",
            type="buy",
            shares=D("10.000000"),
            price=D("100.0000"),
            sort_index=10,
            source="ui",
        )
    )
    today = date.today()
    old_bar_date = today - timedelta(days=100)
    days = [today - timedelta(days=offset) for offset in reversed(range(30))]
    db.add(PriceHistory(security_id=held.id, price_date=old_bar_date, close=D("42.0000")))
    for index, day in enumerate(days):
        db.add(PriceHistory(security_id=held.id, price_date=day, close=D(f"{100 + index}.0000")))
        db.add(PriceHistory(security_id=unheld.id, price_date=day, close=D("50.0000")))
        db.add(PriceHistory(security_id=liquidated.id, price_date=day, close=D("300.0000")))
    await db.commit()

    # Bought then FULLY sold through the ledger API: the position folds to zero shares,
    # so a closed holding must not occupy a sparkline slot even though its bars remain.
    for txn_type in ("buy", "sell"):
        created = await auth_client.post(
            TRANSACTIONS,
            json={
                "security_id": liquidated.id,
                "account": "Fidelity",
                "type": txn_type,
                "shares": "5",
                "price": "300",
            },
        )
        assert created.status_code == 201, created.text

    resp = await auth_client.get(SPARKLINES)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # ZM has bars but no transactions; TSLA has bars and transactions that net to zero.
    assert set(body) == {"NVDA"}

    # One point per ISO week: the LAST bar of each week. The newest bar always survives
    # because it is by definition the last bar of its own (possibly partial) week.
    week_last: dict[tuple[int, int], date] = {}
    for day in [old_bar_date, *days]:  # ascending, so the last write per week wins
        iso = day.isocalendar()
        week_last[(iso.year, iso.week)] = day
    assert [p["d"] for p in body["NVDA"]] == [d.isoformat() for d in sorted(week_last.values())]
    assert len(body["NVDA"]) < len(days)  # genuinely downsampled
    assert body["NVDA"][-1] == {"d": today.isoformat(), "c": "129.0000"}

    # `days` narrows the window — the 100-day-old bar the default call returned is gone.
    windowed = (await auth_client.get(SPARKLINES, params={"days": 30})).json()
    windowed_dates = [date.fromisoformat(p["d"]) for p in windowed["NVDA"]]
    assert old_bar_date not in windowed_dates
    assert min(windowed_dates) >= today - timedelta(days=30)
    assert windowed_dates[-1] == today  # the newest bar survives every window


async def test_sparklines_empty_without_holdings(auth_client, db):
    security = await seed_security(db, "ZM")
    db.add(PriceHistory(security_id=security.id, price_date=date.today(), close=D("50.0000")))
    await db.commit()
    resp = await auth_client.get(SPARKLINES)
    assert resp.status_code == 200, resp.text
    assert resp.json() == {}


# --- manual price ---


async def test_manual_price_put_guard_and_write(auth_client, db):
    security = await seed_security(db, "NVDA")
    today = date.today()

    guarded = await auth_client.put(f"{PRICES}/NVDA", json={"price": "31.89"})
    assert guarded.status_code == 409  # auto-priced securities are refresh-owned
    assert "manual" in guarded.json()["detail"]

    security.is_manual_priced = True
    await db.commit()

    resp = await auth_client.put(f"{PRICES}/nvda", json={"price": "31.89"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["security_id"] == security.id
    assert body["price"] == "31.8900"
    assert body["source"] == "manual"
    assert datetime.fromisoformat(body["quoted_at"]) == datetime.combine(
        today, datetime.min.time(), tzinfo=UTC
    )
    rows = (
        (await db.execute(select(PriceHistory).order_by(PriceHistory.price_date))).scalars().all()
    )
    assert [(r.price_date, r.close) for r in rows] == [(today, D("31.8900"))]

    tomorrow = await auth_client.put(
        f"{PRICES}/NVDA", json={"price": "40", "as_of": (today + timedelta(days=1)).isoformat()}
    )
    assert tomorrow.status_code == 422
    assert (await auth_client.put(f"{PRICES}/NVDA", json={"price": "0"})).status_code == 422
    assert (await auth_client.put(f"{PRICES}/ZZZZ", json={"price": "5"})).status_code == 404

    # Century guard: a mistyped year must 422 here, not land in latest_prices.quoted_at
    # and resurface as the holdings header's as_of.
    ancient = await auth_client.put(f"{PRICES}/NVDA", json={"price": "42", "as_of": "1026-01-01"})
    assert ancient.status_code == 422
    assert "as_of" in ancient.json()["detail"]
    # Numeric(14,4) bound, enforced by quantize_price — never a bare DBAPIError 500.
    absurd = await auth_client.put(f"{PRICES}/NVDA", json={"price": "100000000000"})
    assert absurd.status_code == 422
    assert "10^10" in absurd.json()["detail"]

    # Backdated entry: history accrues a sparkline point, the newest quote never moves
    # backwards (set_manual_price's guard — day-Δ would otherwise compare a quote to itself).
    backdated = await auth_client.put(
        f"{PRICES}/NVDA", json={"price": "1.00", "as_of": (today - timedelta(days=5)).isoformat()}
    )
    assert backdated.status_code == 200, backdated.text
    assert backdated.json() == body
    rows = (
        (await db.execute(select(PriceHistory).order_by(PriceHistory.price_date))).scalars().all()
    )
    assert [(r.price_date, r.close) for r in rows] == [
        (today - timedelta(days=5), D("1.0000")),
        (today, D("31.8900")),
    ]
