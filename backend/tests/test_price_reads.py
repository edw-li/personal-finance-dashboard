"""P1 equivalence (2026-09-23 spec §P1): holdings and sparklines read only what they use.

Each new read is checked against the OLD algorithm, kept here verbatim as the oracle, over
hand-built edge cases and seeded random books; both endpoints are then checked byte-for-byte
with the old read swapped back in. Money is compared as strings: Decimal('1.10') ==
Decimal('1.1') would hide a scale change the JSON would show."""

import json
import random
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.api.prices import weekly_closes
from app.models import LatestPrice, Person, PositionTransaction, PriceHistory, Security
from app.services import clock
from app.services.portfolio_calc import load_last_two_bars
from tests.portfolio_factories import acct

D = Decimal
HOLDINGS = "/api/v1/portfolio/holdings"
SPARKLINES = "/api/v1/prices/sparklines"
TODAY = date(2027, 1, 6)  # a Wednesday just past ISO 2026-W53 -> 2027-W01


async def old_full_history(db) -> dict[int, list[PriceHistory]]:
    """The pre-P1 holdings read, verbatim: every bar of every security as ORM rows."""
    history: dict[int, list[PriceHistory]] = {}
    rows = (
        await db.execute(
            select(PriceHistory).order_by(PriceHistory.security_id, PriceHistory.price_date)
        )
    ).scalars()
    for row in rows:
        history.setdefault(row.security_id, []).append(row)
    return history


def bars_view(by_security) -> dict[int, list[tuple[date, str]]]:
    return {
        security_id: [(bar.price_date, str(bar.close)) for bar in bars]
        for security_id, bars in by_security.items()
        if bars
    }


async def add_security(db, ticker: str) -> Security:
    security = Security(ticker=ticker, name=f"{ticker} Inc", holding_type="stock")
    db.add(security)
    await db.flush()
    return security


def buy(security: Security, account: str, shares: str, sort_index: int) -> PositionTransaction:
    return PositionTransaction(
        security_id=security.id,
        portfolio_account=acct(account),
        type="buy",
        shares=D(shares),
        price=D("10.0000"),
        sort_index=sort_index,
        source="ui",
    )


def quote(security: Security, price: str, day: date) -> LatestPrice:
    return LatestPrice(
        security_id=security.id,
        price=D(price),
        quoted_at=datetime(day.year, day.month, day.day, 21, tzinfo=UTC),
        source="yfinance",
    )


async def edge_book(db) -> tuple[Person, Person]:
    """0, 1, 2 and many bars; gaps; a held security with no history; bars that stop before
    the latest quote; an unheld security with bars; three owner scopes."""
    me = Person(name="Me", is_primary=True)
    them = Person(name="Them")
    db.add_all([me, them])
    await db.flush()
    acct("Mine", person_id=me.id)
    acct("Theirs", person_id=them.id)
    acct("Ours")  # joint: no owner
    none_ = await add_security(db, "NONE")  # held, no history at all
    one = await add_security(db, "ONE")
    two = await add_security(db, "TWO")
    many = await add_security(db, "MANY")
    stale = await add_security(db, "STALE")  # last bar two weeks before its quote
    unheld = await add_security(db, "UNHELD")
    db.add(PriceHistory(security_id=one.id, price_date=date(2027, 1, 5), close=D("11.5000")))
    for day, close in ((date(2027, 1, 4), "20.0000"), (date(2027, 1, 5), "21.2500")):
        db.add(PriceHistory(security_id=two.id, price_date=day, close=D(close)))
    day = date(2026, 11, 2)
    for i in range(40):  # weekday bars with holes (every 7th skipped), across the year end
        if i % 7 != 3:
            db.add(PriceHistory(security_id=many.id, price_date=day, close=D(f"{100 + i}.1000")))
        day += timedelta(days=1 if day.weekday() < 4 else 3)
    for i in range(5):
        db.add(
            PriceHistory(
                security_id=stale.id,
                price_date=date(2026, 12, 21) + timedelta(days=i),
                close=D(f"{50 + i}.0000"),
            )
        )
    for i in range(3):
        db.add(
            PriceHistory(
                security_id=unheld.id,
                price_date=date(2027, 1, 1) + timedelta(days=i),
                close=D("9.9900"),
            )
        )
    for security in (none_, one, two, many, stale, unheld):
        db.add(quote(security, "123.4500", TODAY))
    db.add_all(
        [
            buy(none_, "Mine", "1", 10),
            buy(one, "Theirs", "2", 20),
            buy(two, "Ours", "3", 30),
            buy(many, "Mine", "4", 40),
            buy(many, "Theirs", "5", 50),
            buy(stale, "Ours", "6", 60),
        ]
    )
    await db.commit()
    return me, them


async def random_book(db, seed: int) -> None:
    """Seeded random bars (0, 1, 2 or 3-80 per security, random gaps across two year ends,
    4-dp closes) and a random held subset."""
    rng = random.Random(seed)
    first = date(2024, 11, 1)
    span = (TODAY - first).days
    for n in range(15):
        security = await add_security(db, f"R{seed}X{n}")
        count = rng.choice([0, 1, 2, rng.randint(3, 80)])
        for offset in sorted(rng.sample(range(span + 1), count)):
            db.add(
                PriceHistory(
                    security_id=security.id,
                    price_date=first + timedelta(days=offset),
                    close=D(f"{rng.randint(1, 99999)}.{rng.randint(0, 9999):04d}"),
                )
            )
        if rng.random() < 0.7:
            db.add(buy(security, rng.choice(["A", "B"]), str(rng.randint(1, 50)), n))
            db.add(quote(security, f"{rng.randint(1, 999)}.{rng.randint(0, 9999):04d}", TODAY))
    await db.commit()


async def test_last_two_bars_equal_the_tail_of_the_full_history_on_edge_cases(db):
    await edge_book(db)
    new = await load_last_two_bars(db)
    old = await old_full_history(db)
    assert bars_view(new) == {sid: bars[-2:] for sid, bars in bars_view(old).items()}
    # Ascending, so bars[-2] keeps its meaning: the close BEFORE the latest bar.
    for bars in new.values():
        assert [bar.price_date for bar in bars] == sorted(bar.price_date for bar in bars)


@pytest.mark.parametrize("seed", [1, 2, 3, 4, 5])
async def test_last_two_bars_equal_the_tail_of_the_full_history_on_random_books(db, seed):
    await random_book(db, seed)
    new = await load_last_two_bars(db)
    old = await old_full_history(db)
    assert bars_view(new) == {sid: bars[-2:] for sid, bars in bars_view(old).items()}


async def holdings_bodies(auth_client, owners) -> dict:
    bodies = {}
    for owner in owners:
        response = await auth_client.get(HOLDINGS, params={} if owner is None else {"owner": owner})
        assert response.status_code == 200, response.text
        bodies[owner] = response.content
    return bodies


async def test_holdings_bytes_match_the_full_history_read_in_every_owner_scope(
    auth_client, db, monkeypatch
):
    monkeypatch.setattr(clock, "product_today", lambda: TODAY)
    me, them = await edge_book(db)
    owners = [None, str(me.id), str(them.id), "joint"]
    new = await holdings_bodies(auth_client, owners)
    monkeypatch.setattr("app.services.portfolio_calc.load_last_two_bars", old_full_history)
    old = await holdings_bodies(auth_client, owners)
    assert new == old
    # Not vacuous: the household view carries both a day change and a missing one.
    day = {h["ticker"]: h["day_change_pct"] for h in json.loads(new[None])["holdings"]}
    assert day["ONE"] is None and day["NONE"] is None
    assert None not in (day["TWO"], day["MANY"], day["STALE"])


@pytest.mark.parametrize("seed", [11, 12, 13])
async def test_holdings_bytes_match_on_random_books(auth_client, db, monkeypatch, seed):
    monkeypatch.setattr(clock, "product_today", lambda: TODAY)
    await random_book(db, seed)
    new = await holdings_bodies(auth_client, [None])
    monkeypatch.setattr("app.services.portfolio_calc.load_last_two_bars", old_full_history)
    assert await holdings_bodies(auth_client, [None]) == new


# --- sparklines: the last bar of each ISO week, now bucketed in SQL ---


def old_weekly_closes(rows) -> list[tuple[int, date, str]]:
    """The pre-P1 bucketing, verbatim: the last bar of each (security, ISO year, ISO week)."""
    week_last: dict[tuple[int, int, int], PriceHistory] = {}
    for row in rows:
        iso = row.price_date.isocalendar()
        week_last[(row.security_id, iso.year, iso.week)] = row
    return [
        (row.security_id, row.price_date, str(row.close))
        for row in sorted(week_last.values(), key=lambda r: (r.security_id, r.price_date))
    ]


async def old_weekly_closes_from_db(db, held_ids, since):
    """The pre-P1 read + bucketing, shaped like weekly_closes' answer."""
    rows = (
        await db.execute(
            select(PriceHistory)
            .where(PriceHistory.security_id.in_(held_ids), PriceHistory.price_date >= since)
            .order_by(PriceHistory.security_id, PriceHistory.price_date)
        )
    ).scalars()
    return [(sid, day, D(close)) for sid, day, close in old_weekly_closes(rows)]


def as_strings(points) -> list[tuple[int, date, str]]:
    return [(sid, day, str(close)) for sid, day, close in points]


async def iso_boundary_book(db) -> list[int]:
    """Bars around ISO 2025-W52/2026-W01 (a week that starts in December) and around
    2026-W52/W53/2027-W01, a sparse security, a single bar and a held security with none."""
    boundary = await add_security(db, "ISO")
    sparse = await add_security(db, "SPARSE")
    single = await add_security(db, "SINGLE")
    empty = await add_security(db, "EMPTY")
    days = [
        date(2025, 12, 26),  # Fri, 2025-W52
        date(2025, 12, 28),  # Sun, 2025-W52
        date(2025, 12, 29),  # Mon, 2026-W01 — the ISO year starts in December
        date(2025, 12, 31),
        date(2026, 1, 2),  # Fri, still 2026-W01
        date(2026, 1, 5),  # 2026-W02
        date(2026, 12, 24),  # Thu, 2026-W52
        date(2026, 12, 27),  # Sun, 2026-W52
        date(2026, 12, 28),  # Mon, 2026-W53
        date(2026, 12, 30),
        date(2026, 12, 31),
        date(2027, 1, 1),  # Fri, still 2026-W53
        date(2027, 1, 3),  # Sun, still 2026-W53
        date(2027, 1, 4),  # Mon, 2027-W01
        date(2027, 1, 5),
    ]
    for i, day in enumerate(days):
        db.add(PriceHistory(security_id=boundary.id, price_date=day, close=D(f"{10 + i}.0100")))
    for day in (date(2026, 3, 2), date(2026, 3, 20), date(2026, 9, 9)):
        db.add(PriceHistory(security_id=sparse.id, price_date=day, close=D("7.7700")))
    db.add(PriceHistory(security_id=single.id, price_date=date(2026, 12, 30), close=D("1.0000")))
    await db.commit()
    return [boundary.id, sparse.id, single.id, empty.id]


@pytest.mark.parametrize(
    "since",
    [
        date(2025, 12, 1),
        date(2025, 12, 30),  # a Tuesday: 2026-W01 starts mid-week
        date(2026, 12, 30),  # a Wednesday inside W53
        date(2027, 1, 4),
        date(2027, 1, 6),  # after every bar
    ],
)
async def test_weekly_closes_equal_the_iso_week_bucketing_on_edge_cases(db, since):
    held = set(await iso_boundary_book(db))
    assert as_strings(await weekly_closes(db, held, since)) == as_strings(
        await old_weekly_closes_from_db(db, held, since)
    )


@pytest.mark.parametrize("seed", [21, 22, 23, 24, 25])
async def test_weekly_closes_equal_the_iso_week_bucketing_on_random_books(db, seed):
    await random_book(db, seed)
    rng = random.Random(seed)
    held = {sid for (sid,) in (await db.execute(select(Security.id))).all() if rng.random() < 0.8}
    for _ in range(4):
        since = date(2024, 11, 1) + timedelta(days=rng.randint(0, 800))
        assert as_strings(await weekly_closes(db, held, since)) == as_strings(
            await old_weekly_closes_from_db(db, held, since)
        )


async def test_sparklines_bytes_match_the_python_bucketing(auth_client, db, monkeypatch):
    monkeypatch.setattr(clock, "product_today", lambda: TODAY)
    await edge_book(db)
    held = await iso_boundary_book(db)
    for n, security_id in enumerate(held):
        db.add(
            PositionTransaction(
                security_id=security_id,
                portfolio_account=acct("Mine"),
                type="buy",
                shares=D("1"),
                price=D("1"),
                sort_index=100 + n,
                source="ui",
            )
        )
    await db.commit()
    windows = [365, 400, 30, 7, 8, 1]  # 7 and 8 start mid-week on either side of Wednesday
    new = {}
    for days in windows:
        response = await auth_client.get(SPARKLINES, params={"days": days})
        assert response.status_code == 200, response.text
        new[days] = response.content
    monkeypatch.setattr("app.api.prices.weekly_closes", old_weekly_closes_from_db)
    for days in windows:
        assert (await auth_client.get(SPARKLINES, params={"days": days})).content == new[days]
    # Not vacuous: the year-end book is in the long window; a held security without bars
    # never gets an empty series.
    assert '"ISO"' in new[400].decode() and '"EMPTY"' not in new[400].decode()
