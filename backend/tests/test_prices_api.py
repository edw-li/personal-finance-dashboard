import time
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import select

from app.models import LatestPrice, PositionTransaction, PriceHistory, Security
from app.services.price_provider import DailyBar

REFRESH = "/api/v1/prices/refresh"
HISTORY = "/api/v1/prices/history"
SPARKLINES = "/api/v1/prices/sparklines"
PRICES = "/api/v1/prices"
TRANSACTIONS = "/api/v1/portfolio/transactions"

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


async def test_refresh_requires_auth(client):
    assert (await client.post(REFRESH)).status_code == 401


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
