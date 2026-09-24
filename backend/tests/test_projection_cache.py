"""The projection's result cache and its worker thread (2026-09-23 spec §R9): an identical request
is answered from the serialized bytes of the first, a write to any of the sixteen tables the
route reads — or a new day, or any knob — builds again, a 422 or a 404 is never kept, and the
Monte Carlo runs off the event loop one at a time — even when a request is cancelled mid-run."""

import asyncio
import re
import threading
from contextlib import contextmanager
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from time import sleep
from types import SimpleNamespace

import pytest
from sqlalchemy import event, update
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.api import projection as projection_api
from app.api.app_settings import _read_espp_ticker
from app.api.espp import _espp_quote
from app.api.projection import ProjectionKnobs, projection_json, run_projection
from app.limit_keys import LIMIT_401K_ELECTIVE
from app.models import (
    Account,
    AccountBalance,
    AppSetting,
    CategoryBudget,
    ContributionLimit,
    LatestPrice,
    MonthlyCashflow,
    MonthlySpending,
    NetWorthSnapshot,
    PaycheckProfile,
    Person,
    RsuGrant,
    Security,
    SpendingCategory,
)
from app.models.month_review import MonthReview, MonthReviewAdoption
from app.services import clock, read_cache
from app.services.month_review import adopt_existing_history

URL = "/api/v1/projection?years=5"


def month_add(start: date, delta: int) -> date:
    base = start.year * 12 + (start.month - 1) + delta
    return date(base // 12, base % 12 + 1, 1)


async def seed_everything(db) -> dict[str, int]:
    """One row (at least) in every table the projection reads, so each can be touched."""
    today = clock.product_today()
    this_month = today.replace(day=1)
    person = Person(name="Alex", is_primary=True)
    brokerage = Account(name="Brokerage", slug="brokerage", group="taxable", sort_order=1)
    rent = SpendingCategory(name="Rent", slug="rent", sort_order=1)
    snapshot = NetWorthSnapshot(month=this_month)
    nvda = Security(ticker="NVDA", name="NVIDIA", holding_type="stock")
    db.add_all([person, brokerage, rent, snapshot, nvda])
    await db.flush()
    db.add_all(
        [
            AccountBalance(
                snapshot_id=snapshot.id, account_id=brokerage.id, balance=Decimal("100000.00")
            ),
            PaycheckProfile(
                person_id=person.id,
                effective_date=this_month,
                annual_salary=Decimal("24000.00"),
                pay_periods_per_year=24,
                trad_401k_pct=Decimal("0.10"),
            ),
            ContributionLimit(year=today.year, key=LIMIT_401K_ELECTIVE, value=Decimal("24500.00")),
            CategoryBudget(
                category_id=rent.id, effective_month=this_month, amount=Decimal("2000.00")
            ),
            RsuGrant(
                kind="new_hire",
                label="Offer",
                focal_year=None,
                shares=1600,
                grant_price=Decimal("100"),
                first_vest_date=month_add(this_month, 1).replace(day=16),
                cliff_pct=Decimal("0.25"),
                vest_quantum=1,
            ),
            LatestPrice(
                security_id=nvda.id,
                price=Decimal("100.0000"),
                quoted_at=datetime.combine(today, time(20), tzinfo=UTC),
                source="yfinance",
            ),
            AppSetting(key="espp_ticker", value={"value": "NVDA"}),
            AppSetting(key="plan_until_year", value={"value": today.year + 20}),
        ]
    )
    for delta, amount in ((-1, "6000.00"), (-2, "4000.00")):
        month = month_add(this_month, delta)
        db.add(MonthlySpending(month=month, category_id=rent.id, amount=Decimal(amount)))
        db.add(MonthlyCashflow(month=month, net_pay=Decimal("9000.00")))
    await db.commit()
    await adopt_existing_history(db, today)
    await db.commit()
    return {
        "person": person.id,
        "account": brokerage.id,
        "category": rent.id,
        "snapshot": snapshot.id,
        "security": nvda.id,
    }


async def _run(db, statement) -> None:
    await db.execute(statement)
    await db.commit()


# One committed Core write per table — the kind of change no ORM hook would ever see.
TOUCH = {
    "accounts": lambda db: _run(db, update(Account).values(sort_order=7)),
    "net_worth_snapshots": lambda db: _run(db, update(NetWorthSnapshot).values(notes="n")),
    "account_balances": lambda db: _run(
        db, update(AccountBalance).values(balance=Decimal("100001.00"))
    ),
    "spending_categories": lambda db: _run(db, update(SpendingCategory).values(sort_order=5)),
    "monthly_spending": lambda db: _run(
        db, update(MonthlySpending).values(amount=MonthlySpending.amount + 1)
    ),
    "monthly_cashflow": lambda db: _run(
        db, update(MonthlyCashflow).values(net_pay=MonthlyCashflow.net_pay + 1)
    ),
    "paycheck_profiles": lambda db: _run(db, update(PaycheckProfile).values(notes="raise")),
    "month_reviews": lambda db: _run(db, update(MonthReview).values(closed_by="someone")),
    "month_review_adoption": lambda db: _run(
        db, update(MonthReviewAdoption).values(adopted_on=date(2020, 1, 1))
    ),
    "people": lambda db: _run(db, update(Person).values(name="Alexandra")),
    "contribution_limits": lambda db: _run(
        db, update(ContributionLimit).values(value=Decimal("25000.00"))
    ),
    "app_settings": lambda db: _run(
        db,
        update(AppSetting)
        .where(AppSetting.key == "plan_until_year")
        .values(value={"value": clock.product_today().year + 21}),
    ),
    "category_budgets": lambda db: _run(
        db, update(CategoryBudget).values(amount=Decimal("2100.00"))
    ),
    "rsu_grants": lambda db: _run(db, update(RsuGrant).values(notes="refreshed")),
    "securities": lambda db: _run(db, update(Security).values(name="NVIDIA Corp")),
    "latest_prices": lambda db: _run(db, update(LatestPrice).values(price=Decimal("101.0000"))),
}


@pytest.fixture
def builds(monkeypatch):
    calls = {"n": 0}
    real = projection_api._build

    async def counting(db, knobs, today):
        calls["n"] += 1
        return await real(db, knobs, today)

    monkeypatch.setattr(projection_api, "_build", counting)
    return calls


@contextmanager
def tables_read(engine):
    seen: set[str] = set()

    def record(conn, cursor, statement, parameters, context, executemany):
        seen.update(re.findall(r'\b(?:FROM|JOIN)\s+"?([a-z_]+)"?', statement))

    event.listen(engine.sync_engine, "before_cursor_execute", record)
    try:
        yield seen
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", record)


def test_the_touch_matrix_covers_every_projection_table():
    assert len(read_cache.PROJECTION_TABLES) == 16
    assert set(TOUCH) == set(read_cache.PROJECTION_TABLES)


async def test_an_identical_request_is_a_hit_and_serves_the_same_bytes(auth_client, db, builds):
    await seed_everything(db)
    first = await auth_client.get(URL)
    second = await auth_client.get(URL)
    assert first.status_code == second.status_code == 200, first.text
    assert first.content == second.content
    assert builds["n"] == 1
    assert first.headers["content-type"] == "application/json"


async def test_the_cached_bytes_equal_an_uncached_run(db):
    await seed_everything(db)
    knobs = ProjectionKnobs(years=5)
    served = await projection_json(db, knobs)
    fresh = await projection_api._build(db, knobs, clock.product_today())
    assert served == fresh.model_dump_json(by_alias=True).encode()
    assert [read_cache.PROJECTIONS.get(key) for key in read_cache.PROJECTIONS.keys()] == [served]


async def test_two_direct_callers_get_independent_models(db):
    await seed_everything(db)
    first = await run_projection(db, ProjectionKnobs(years=5))
    second = await run_projection(db, ProjectionKnobs(years=5))
    assert first == second and first is not second and first.phases is not second.phases
    first.phases.clear()
    assert (await run_projection(db, ProjectionKnobs(years=5))).phases == second.phases


async def test_a_changed_knob_or_day_misses(auth_client, db, builds, monkeypatch):
    await seed_everything(db)
    for url in (URL, f"{URL}&annual_return=0.06", f"{URL}&vests=0", f"{URL}&plan_until=2070"):
        assert (await auth_client.get(url)).status_code == 200, url
    assert builds["n"] == 4
    # Spelled differently, the same knobs: a hit.
    assert (await auth_client.get(f"{URL}&annual_return=0.060")).status_code == 200
    assert builds["n"] == 4
    tomorrow = clock.product_today() + timedelta(days=1)
    monkeypatch.setattr(clock, "product_today", lambda: tomorrow)
    await auth_client.get(URL)
    assert builds["n"] == 5


@pytest.mark.parametrize("table", read_cache.PROJECTION_TABLES)
async def test_a_write_to_any_projection_table_misses(auth_client, db, builds, table):
    await seed_everything(db)
    assert (await auth_client.get(URL)).status_code == 200
    await TOUCH[table](db)
    assert (await auth_client.get(URL)).status_code == 200
    assert builds["n"] == 2


async def test_the_fingerprint_covers_exactly_the_tables_the_build_reads(db, engine):
    ids = await seed_everything(db)
    retires = month_add(clock.product_today().replace(day=1), 24)
    knobs = ProjectionKnobs(years=5, retire=(f"{ids['person']}:{retires:%Y-%m}",))
    read_cache.clear_read_caches()  # the nested book and savings loaders must really run
    with tables_read(engine) as seen:
        await projection_api._build(db, knobs, clock.product_today())
    assert seen == set(read_cache.PROJECTION_TABLES)


async def test_one_build_reads_one_day(db, monkeypatch):
    # 2026-09-24 review minor 5: the review book the planning window stands on is the route's day
    # — never a second clock read, which can land past midnight while the axis says the day before.
    monkeypatch.setattr(clock, "product_today", lambda: date(2026, 9, 30))
    await seed_everything(db)
    days = iter([date(2026, 9, 30)] + [date(2026, 10, 1)] * 50)
    monkeypatch.setattr(clock, "product_today", lambda: next(days))
    books = []
    real = projection_api.cached_review_book

    async def recording(*args, **kwargs):
        book = await real(*args, **kwargs)
        books.append(book.today)
        return book

    monkeypatch.setattr(projection_api, "cached_review_book", recording)
    body = await run_projection(db, ProjectionKnobs(years=5))
    assert body.start_month == date(2026, 9, 1)
    assert books == [date(2026, 9, 30)]


async def test_other_settings_and_other_quotes_keep_the_entry(auth_client, db, builds):
    # 2026-09-24 review minor 4: the fingerprint's app_settings and latest_prices cells cover only
    # what the projection reads — its three settings and the employer ticker's quote — so a price
    # refresh's own bookkeeping and every other holding's new quote leave the entry standing.
    await seed_everything(db)
    aapl = Security(ticker="AAPL", name="Apple", holding_type="stock")
    db.add(aapl)
    await db.flush()
    quoted = datetime.combine(clock.product_today(), time(20), tzinfo=UTC)
    db.add(
        LatestPrice(
            security_id=aapl.id, price=Decimal("200.0000"), quoted_at=quoted, source="yfinance"
        )
    )
    await db.commit()
    assert (await auth_client.get(URL)).status_code == 200
    db.add_all(
        [
            AppSetting(key="last_refresh", value={"value": quoted.isoformat()}),
            AppSetting(key="refresh_runs", value={"value": [{"ok": 2}]}),
        ]
    )
    await db.commit()
    await _run(
        db,
        update(LatestPrice).where(LatestPrice.security_id == aapl.id).values(price=Decimal("201")),
    )
    assert (await auth_client.get(URL)).status_code == 200
    assert builds["n"] == 1


@pytest.mark.parametrize(
    ("key", "value"),
    [("swr_pct", "0.035"), ("espp_ticker", "AAPL"), ("plan_until_year", 2199)],
)
async def test_each_setting_the_projection_reads_still_misses(auth_client, db, builds, key, value):
    await seed_everything(db)
    assert (await auth_client.get(URL)).status_code == 200
    setting = await db.get(AppSetting, key)
    if setting is None:
        db.add(AppSetting(key=key, value={"value": value}))
    else:
        setting.value = {"value": value}
    await db.commit()
    assert (await auth_client.get(URL)).status_code == 200
    assert builds["n"] == 2


async def test_the_narrowed_cells_cover_every_setting_and_quote_the_build_reads(db, engine):
    # What makes the narrowing provably complete: every app_settings read is one of the three keys,
    # and the only latest_prices row read is the employer ticker's — with a second security quoted.
    ids = await seed_everything(db)
    other = Security(ticker="AAPL", name="Apple", holding_type="stock")
    db.add(other)
    await db.flush()
    quoted = datetime.combine(clock.product_today(), time(20), tzinfo=UTC)
    db.add(
        LatestPrice(security_id=other.id, price=Decimal("200.0000"), quoted_at=quoted, source="x")
    )
    await db.commit()
    retires = month_add(clock.product_today().replace(day=1), 24)
    knobs = ProjectionKnobs(years=5, retire=(f"{ids['person']}:{retires:%Y-%m}",))
    read_cache.clear_read_caches()
    keyed: dict[str, set] = {"app_settings": set(), "latest_prices": set()}

    def record(conn, cursor, statement, parameters, context, executemany):
        for table in keyed:
            if re.search(rf'\b(?:FROM|JOIN)\s+"?{table}"?\b', statement):
                # A keyed point read (db.get) or nothing: an unkeyed read of either table is
                # exactly what a narrowed cell could miss.
                assert re.search(rf"WHERE {table}\.(key|security_id) = \$1", statement), statement
                keyed[table].add(parameters[0])

    event.listen(engine.sync_engine, "before_cursor_execute", record)
    try:
        await projection_api._build(db, knobs, clock.product_today())
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", record)
    assert keyed["app_settings"] == set(read_cache.PROJECTION_SETTING_KEYS)
    assert keyed["latest_prices"] == {ids["security"]}


@pytest.mark.parametrize(
    "stored",
    [
        None,
        {"value": "NVDA"},
        {"value": "  nvda "},
        {"value": ""},
        {"value": "   "},
        {"value": None},
        {"value": 7},
        ["NVDA"],
        {},
    ],
)
async def test_the_bound_ticker_is_the_one_the_build_prices(db, stored):
    # The latest_prices cell is restricted with the ticker the route resolves BEFORE the build
    # (api/app_settings._read_espp_ticker); the build prices vests with _espp_quote's. Pinned
    # equal on every envelope shape, so the cell can never cover a different security.
    if stored is not None:
        db.add(AppSetting(key="espp_ticker", value=stored))
        await db.commit()
    assert await _read_espp_ticker(db) == (await _espp_quote(db))[0]


async def test_422s_and_404s_are_never_cached(auth_client, db):
    assert (await auth_client.get(URL)).status_code == 404
    assert len(read_cache.PROJECTIONS) == 0
    await seed_everything(db)
    assert (await auth_client.get(f"{URL}&annual_return=0.9")).status_code == 422
    assert (await auth_client.get(f"{URL}&plan_until=1999")).status_code == 422
    assert len(read_cache.PROJECTIONS) == 0


async def test_a_session_with_pending_changes_builds_uncached(db, builds):
    await seed_everything(db)
    db.add(MonthlyCashflow(month=date(2031, 1, 1), net_pay=Decimal("1.00")))  # unflushed
    await projection_json(db, ProjectionKnobs(years=5))
    assert builds["n"] == 1 and len(read_cache.PROJECTIONS) == 0
    await db.rollback()


@pytest.fixture
def simulations(monkeypatch):
    """Watches the Monte Carlo as it runs in its worker thread: how many are running now, the
    most ever at once, how many ran, when one first started and when all are done — each held a
    moment, so an overlap cannot hide."""
    watch = SimpleNamespace(
        now=0, most=0, calls=0, started=threading.Event(), idle=threading.Event()
    )
    watch.idle.set()
    guard = threading.Lock()
    real = projection_api.simulate

    def watched(*args, **kwargs):
        with guard:
            watch.now += 1
            watch.calls += 1
            watch.most = max(watch.most, watch.now)
            watch.idle.clear()
        watch.started.set()
        try:
            sleep(0.2)
            return real(*args, **kwargs)
        finally:
            with guard:
                watch.now -= 1
                if watch.now == 0:
                    watch.idle.set()

    monkeypatch.setattr(projection_api, "simulate", watched)
    return watch


async def _answer(engine, knobs: ProjectionKnobs) -> bytes:
    """One request's answer on a session of its own, as the app gives every request — the
    shared test session admits no concurrent use."""
    async with async_sessionmaker(engine, expire_on_commit=False)() as session:
        return await projection_json(session, knobs)


async def test_one_simulation_at_a_time_and_one_build_for_identical_requests(
    db, engine, simulations
):
    # Three different cold requests and two repeats of the first, all at once: the three builds
    # simulate one after another, and the repeats join the first's build (single-flight).
    await seed_everything(db)
    distinct = [ProjectionKnobs(years=5, annual_return=Decimal(f"0.0{n}")) for n in (4, 5, 6)]
    answers = await asyncio.gather(
        *(_answer(engine, knobs) for knobs in (*distinct, distinct[0], distinct[0]))
    )
    assert simulations.most == 1
    assert simulations.calls == 3
    assert answers[3] == answers[0] and answers[4] == answers[0]
    assert len(set(answers[:3])) == 3


async def test_a_natively_cancelled_request_keeps_the_next_simulation_waiting(
    db, engine, simulations
):
    # asyncio's own Task.cancel() — not an anyio cancel scope — unwinds the request at once and
    # hands MC_LIMITER's token back while its worker thread is still simulating. The lock inside
    # the thread keeps the next simulation from starting beside it (2026-09-24 review minor 2).
    await seed_everything(db)
    first = asyncio.create_task(
        _answer(engine, ProjectionKnobs(years=5, annual_return=Decimal("0.04")))
    )
    assert await asyncio.to_thread(simulations.started.wait, 30)
    first.cancel()
    with pytest.raises(asyncio.CancelledError):
        await first
    await _answer(engine, ProjectionKnobs(years=5, annual_return=Decimal("0.05")))
    # The cancelled request's thread runs to its end regardless; wait for every run to finish.
    assert await asyncio.to_thread(simulations.idle.wait, 30)
    assert simulations.calls == 2
    assert simulations.most == 1
