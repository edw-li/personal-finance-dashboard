"""The projection's result cache and its worker thread (2026-09-23 spec §R9): an identical request
is answered from the serialized bytes of the first, a write to any of the sixteen tables the
route reads — or a new day, or any knob — builds again, a 422 or a 404 is never kept, and the
Monte Carlo runs off the event loop behind a capacity of one."""

import re
from contextlib import contextmanager
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal

import anyio
import pytest
from sqlalchemy import event, update

from app.api import projection as projection_api
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


async def test_the_simulation_runs_in_a_worker_thread_under_a_capacity_of_one(db, monkeypatch):
    await seed_everything(db)
    limiters = []
    real = anyio.to_thread.run_sync

    async def spy(func, *args, limiter=None, **kwargs):
        limiters.append(limiter)
        return await real(func, *args, limiter=limiter, **kwargs)

    monkeypatch.setattr(anyio.to_thread, "run_sync", spy)
    await projection_json(db, ProjectionKnobs(years=5))
    assert projection_api.MC_LIMITER in limiters
    assert projection_api.MC_LIMITER.total_tokens == 1
