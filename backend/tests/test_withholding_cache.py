"""The withholding GET, memoised per data version and day (2026-09-23 spec §W12).

With the reconciliation the GET runs about ten engine passes, and the Overview asks for it on
every visit — so it is served from memory while nothing it reads has changed. The fingerprint
covers every table the GET reads (the SQL-capture tests pin the list), and three of them only
for the rows it reads: `app_settings` for the employer ticker and the ESPP discount,
`latest_prices` and `price_history` for the employer ticker's quote and bars (the row-level
capture pins those). The key adds the product day and the year; the cache holds the serialized
bytes, so the route returns them as they are and a direct caller (the assistant) decodes a
model of its own.
"""

import re
from contextlib import contextmanager
from datetime import UTC, date, datetime
from decimal import Decimal

import pytest
from sqlalchemy import event, select, update

from app.api import taxes as taxes_api
from app.models import (
    AppSetting,
    ContributionLimit,
    EsppLot,
    LatestPrice,
    PaycheckProfile,
    Person,
    PriceHistory,
    RsuGrant,
    Security,
    TaxBracket,
    TaxInput,
    TaxYear,
)
from app.seed import seed_tax_definitions
from app.services import assistant_context, read_cache
from tests.test_withholding_api import (
    PINNED_TODAY,
    YEAR,
    seed_employer,
    seed_grants,
    seed_household,
    seed_married_year,
    seed_partner_profile,
    seed_profile,
    seed_tax_year,
    url,
)


@pytest.fixture
def frozen_today(monkeypatch):
    monkeypatch.setattr("app.services.clock.product_today", lambda: PINNED_TODAY)


@pytest.fixture
async def world(db):
    """test_withholding_api's single-earner world: a 600k typed year, a 240k profile, the
    employer's quote and bars, two grants."""
    await seed_tax_definitions(db)
    await db.commit()
    await seed_tax_year(db, YEAR, "600000.0000")
    await seed_profile(db)
    await seed_employer(db)
    await seed_grants(db)


@pytest.fixture
def builds(monkeypatch):
    """Counts the real builds behind the GET: a hit never reaches `withholding_estimate`."""
    calls: list[int] = []
    real = taxes_api.withholding_estimate

    async def counted(*args, **kwargs):
        calls.append(1)
        return await real(*args, **kwargs)

    monkeypatch.setattr(taxes_api, "withholding_estimate", counted)
    return calls


async def get(auth_client) -> bytes:
    resp = await auth_client.get(url())
    assert resp.status_code == 200, resp.text
    return resp.content


async def test_a_repeat_is_served_from_memory(auth_client, world, frozen_today, builds):
    first = await get(auth_client)
    again = await get(auth_client)
    assert again == first
    assert len(builds) == 1
    assert len(read_cache.WITHHOLDINGS) == 1


async def _other_security(db) -> Security:
    other = Security(ticker="VOO", name="Vanguard S&P 500", holding_type="etf")
    db.add(other)
    await db.commit()
    return other


async def _run(db, statement) -> None:
    await db.execute(statement)
    await db.commit()


async def _add(db, row) -> None:
    db.add(row)
    await db.commit()


async def _nvda(db) -> int:
    return (await db.execute(select(Security.id).where(Security.ticker == "NVDA"))).scalar_one()


# One write per table the GET reads — each must miss. The three narrowed tables are written on
# rows the GET reads, the only rows their cells cover: `app_settings` at the ESPP discount,
# `latest_prices` and `price_history` on the EMPLOYER's ticker (the world's only quote and bars).
MUTATIONS = {
    "tax_years": lambda db: _run(db, update(TaxYear).values(notes="edited")),
    "tax_inputs": lambda db: _add(db, TaxInput(year=YEAR, key="w2_other", value=Decimal("1"))),
    "tax_brackets": lambda db: _run(
        db,
        update(TaxBracket).where(TaxBracket.jurisdiction == "state").values(rate=Decimal("0.06")),
    ),
    "people": lambda db: _run(db, update(Person).values(name="Renamed")),
    "paycheck_profiles": lambda db: _run(
        db, update(PaycheckProfile).values(hsa_per_check=Decimal("120.00"))
    ),
    "contribution_limits": lambda db: _add(
        db, ContributionLimit(year=YEAR, key="limit_401k_elective", value=Decimal("24500"))
    ),
    "rsu_grants": lambda db: _run(
        db, update(RsuGrant).where(RsuGrant.label == "FY26 refresh").values(label="Renamed")
    ),
    "securities": lambda db: _run(db, update(Security).values(name="NVIDIA Corp")),
    "latest_prices": lambda db: _run(db, update(LatestPrice).values(price=Decimal("510.0000"))),
    "app_settings": lambda db: _add(
        db, AppSetting(key="espp_discount_pct", value={"value": "0.10"})
    ),
    "espp_lots": lambda db: _add(
        db,
        EsppLot(
            purchase_date=date(2025, 8, 29),
            qualifying_date=date(2027, 9, 1),
            shares=Decimal("10.0000"),
            subscription_price=Decimal("100.00000"),
            purchase_fmv=Decimal("120.00000"),
            purchase_price=Decimal("85.00000"),
        ),
    ),
    "price_history": lambda db: _employer_bar(db),
}


async def _employer_bar(db) -> None:
    db.add(
        PriceHistory(
            security_id=await _nvda(db), price_date=date(2026, 6, 30), close=Decimal("610")
        )
    )
    await db.commit()


def test_the_mutations_cover_every_withholding_table():
    assert set(MUTATIONS) == set(read_cache.WITHHOLDING_TABLES)


@pytest.mark.parametrize("table", sorted(MUTATIONS))
async def test_every_write_to_every_table_it_reads_misses(
    auth_client, db, world, frozen_today, builds, table
):
    warm = await get(auth_client)
    assert await get(auth_client) == warm and len(builds) == 1
    await MUTATIONS[table](db)
    await get(auth_client)
    assert len(builds) == 2, table


async def test_another_securitys_price_history_does_not_evict_it(
    auth_client, db, world, frozen_today, builds
):
    """Only the employer's bars are read, so only they are fingerprinted: the nightly refresh
    of every other holding's history must not cost the Overview its memo."""
    other = await _other_security(db)
    await get(auth_client)
    db.add(PriceHistory(security_id=other.id, price_date=date(2026, 6, 30), close=Decimal("400")))
    await db.commit()
    await get(auth_client)
    assert len(builds) == 1


async def _quote_other(db) -> Security:
    other = await _other_security(db)
    db.add(
        LatestPrice(
            security_id=other.id,
            price=Decimal("400.0000"),
            quoted_at=datetime(2026, 7, 1, 20, 15, tzinfo=UTC),
            source="yfinance",
        )
    )
    await db.commit()
    return other


async def test_a_price_refreshs_bookkeeping_and_other_quotes_do_not_evict_it(
    auth_client, db, world, frozen_today, builds
):
    """Two settings and the employer's one quote are all the GET reads of those tables, so all
    their fingerprint cells cover: the refresh's own bookkeeping keys and every other holding's
    quote must not cost the card its memo (batch 2 integration; the projection's cells, 2026-09-24
    review minor 4)."""
    other = await _quote_other(db)
    await get(auth_client)
    db.add_all(
        [
            AppSetting(key="last_refresh", value={"value": "2026-07-01T20:15:00+00:00"}),
            AppSetting(key="refresh_runs", value={"value": [{"ok": 2}]}),
        ]
    )
    await db.commit()
    await _run(
        db,
        update(LatestPrice).where(LatestPrice.security_id == other.id).values(price=Decimal("401")),
    )
    await get(auth_client)
    assert len(builds) == 1


async def _set_setting(db, key: str, value) -> None:
    setting = await db.get(AppSetting, key)
    if setting is None:
        db.add(AppSetting(key=key, value={"value": value}))
    else:
        setting.value = {"value": value}
    await db.commit()


# Every row of the two narrowed tables the GET does read — each must still miss.
READ_ROWS = {
    "espp_ticker": lambda db: _set_setting(db, "espp_ticker", "VOO"),
    "espp_discount_pct": lambda db: _set_setting(db, "espp_discount_pct", "0.10"),
    "employer_quote": lambda db: _employer_quote(db),
}


async def _employer_quote(db) -> None:
    nvda = await _nvda(db)
    await _run(
        db, update(LatestPrice).where(LatestPrice.security_id == nvda).values(price=Decimal("515"))
    )


@pytest.mark.parametrize("row", sorted(READ_ROWS))
async def test_each_setting_and_the_quote_it_reads_still_miss(
    auth_client, db, world, frozen_today, builds, row
):
    await _quote_other(db)  # a second quoted security, so a ticker change has one to move to
    await get(auth_client)
    await READ_ROWS[row](db)
    await get(auth_client)
    assert len(builds) == 2, row


async def test_a_new_employer_security_its_first_quote_and_first_bar_each_miss(
    auth_client, db, frozen_today, builds
):
    """The narrowed quote and bar cells find the employer's rows through a subquery on the ticker,
    so a security that appears AFTER the ticker was set must still reach the card, and so must
    its first quote and its first bar. The `securities` cell sees the first; the
    `latest_prices` and `price_history` cells, now bound to a security that exists, see the other
    two. (Integration review, item 2.)"""
    await seed_tax_definitions(db)
    await db.commit()
    await seed_tax_year(db, YEAR, "600000.0000")
    await seed_profile(db)
    await seed_grants(db)
    db.add(AppSetting(key="espp_ticker", value={"value": "NVDA"}))  # no security behind it yet
    await db.commit()
    await get(auth_client)
    security = Security(ticker="NVDA", name="NVIDIA", holding_type="stock")
    await _add(db, security)
    await get(auth_client)
    assert len(builds) == 2
    await _add(
        db,
        LatestPrice(
            security_id=security.id,
            price=Decimal("500.0000"),
            quoted_at=datetime(2026, 7, 1, 20, 15, tzinfo=UTC),
            source="yfinance",
        ),
    )
    await get(auth_client)
    assert len(builds) == 3
    await _add(
        db,
        PriceHistory(security_id=security.id, price_date=date(2026, 6, 30), close=Decimal("600")),
    )
    await get(auth_client)
    assert len(builds) == 4


async def test_a_new_product_day_misses(auth_client, world, frozen_today, builds, monkeypatch):
    await get(auth_client)
    monkeypatch.setattr("app.services.clock.product_today", lambda: date(2026, 7, 2))
    await get(auth_client)
    assert len(builds) == 2


async def test_the_year_is_part_of_the_key(db, world):
    built: list[int] = []

    def build(year: int):
        async def run() -> bytes:
            built.append(year)
            return b'{"year": %d}' % year

        return run

    assert await read_cache.cached_withholding(db, 2026, build(2026), today=PINNED_TODAY) == (
        b'{"year": 2026}'
    )
    assert await read_cache.cached_withholding(db, 2027, build(2027), today=PINNED_TODAY) == (
        b'{"year": 2027}'
    )
    await read_cache.cached_withholding(db, 2026, build(2026), today=PINNED_TODAY)
    assert built == [2026, 2027]


async def test_a_session_with_pending_changes_bypasses_it(db, world):
    built: list[int] = []

    async def build() -> bytes:
        built.append(1)
        return b"{}"

    db.add(TaxInput(year=YEAR, key="w2_other", value=Decimal("2")))  # pending, unflushed
    await read_cache.cached_withholding(db, YEAR, build, today=PINNED_TODAY)
    await read_cache.cached_withholding(db, YEAR, build, today=PINNED_TODAY)
    assert len(built) == 2
    assert len(read_cache.WITHHOLDINGS) == 0
    await db.rollback()


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


async def test_the_fingerprint_covers_exactly_the_tables_the_get_reads(
    db, engine, world, frozen_today
):
    """Derived from the build's own SQL, so a new read can never slip past its fingerprint.
    The world is given a limit and a sold ESPP lot so every read the reconciliation makes
    happens, and the session forgets what it loaded so each read reaches the database."""
    db.add(ContributionLimit(year=YEAR, key="limit_401k_elective", value=Decimal("24500")))
    db.add(
        EsppLot(
            purchase_date=date(2025, 8, 29),
            qualifying_date=date(2027, 9, 1),
            shares=Decimal("10.0000"),
            subscription_price=Decimal("100.00000"),
            purchase_fmv=Decimal("120.00000"),
            purchase_price=Decimal("85.00000"),
            sold_date=date(2026, 5, 1),
            sold_price=Decimal("150.00000"),
        )
    )
    await db.commit()
    db.expunge_all()
    with tables_read(engine) as seen:
        await taxes_api.withholding_estimate(db, YEAR, PINNED_TODAY, reconcile=True)
    assert seen == set(read_cache.WITHHOLDING_TABLES)


async def test_the_fingerprint_covers_the_joint_return_and_safe_harbor_reads_too(
    db, engine, frozen_today
):
    """The same capture over the heavier paths (code-quality M5): a joint return with a
    SIMULATED partner (their own profile, their own column) and a prior year on file, so the
    safe-harbor reads of last year's return run too. Asserted to have happened, then held to
    the same table list — a prior year or a partner must never read a table the fingerprint
    misses."""
    await seed_tax_definitions(db)
    await db.commit()
    me_id, partner_id = await seed_household(db)
    await seed_married_year(db, YEAR, me_id, partner_id)
    await seed_tax_year(db, YEAR - 1, "400000.0000")
    await seed_profile(db)
    await seed_partner_profile(db, partner_id)
    await seed_employer(db)
    await seed_grants(db)
    db.add(ContributionLimit(year=YEAR, key="limit_401k_elective", value=Decimal("24500")))
    db.add(
        EsppLot(
            purchase_date=date(2025, 8, 29),
            qualifying_date=date(2027, 9, 1),
            shares=Decimal("10.0000"),
            subscription_price=Decimal("100.00000"),
            purchase_fmv=Decimal("120.00000"),
            purchase_price=Decimal("85.00000"),
            sold_date=date(2026, 5, 1),
            sold_price=Decimal("150.00000"),
        )
    )
    await db.commit()
    db.expunge_all()
    with tables_read(engine) as seen:
        out = await taxes_api.withholding_estimate(db, YEAR, PINNED_TODAY, reconcile=True)
    assert out.partner_source == "simulated"
    assert out.safe_harbor is not None and out.safe_harbor.prior_year == YEAR - 1
    assert {row.person_id for row in out.reconciliation.rows} == {me_id, partner_id}
    assert seen == set(read_cache.WITHHOLDING_TABLES)


async def test_the_narrowed_cells_cover_every_setting_quote_and_bar_the_get_reads(
    db, engine, frozen_today
):
    """What makes the narrowing provably complete, over the heaviest paths — a joint return with
    a simulated partner, last year on file (the safe harbor's reads) and a lot sold this year
    (the discount's read) — with a second security quoted and barred and the refresh's
    bookkeeping stored beside the employer's rows: every app_settings read is a keyed read of one
    of the narrowed keys, and the only latest_prices and price_history rows read are the
    employer's. (The table list is the capture tests' above; this is the rows within the three
    narrowed tables.)"""
    await seed_tax_definitions(db)
    await db.commit()
    me_id, partner_id = await seed_household(db)
    await seed_married_year(db, YEAR, me_id, partner_id)
    await seed_tax_year(db, YEAR - 1, "400000.0000")
    await seed_profile(db)
    await seed_partner_profile(db, partner_id)
    employer = await seed_employer(db)
    await seed_grants(db)
    other = await _quote_other(db)
    db.add_all(
        [
            PriceHistory(security_id=other.id, price_date=date(2026, 6, 30), close=Decimal("400")),
            AppSetting(key="last_refresh", value={"value": "2026-07-01T20:15:00+00:00"}),
            AppSetting(key="swr_pct", value={"value": "0.04"}),
            ContributionLimit(year=YEAR, key="limit_401k_elective", value=Decimal("24500")),
            EsppLot(
                purchase_date=date(2025, 8, 29),
                qualifying_date=date(2027, 9, 1),
                shares=Decimal("10.0000"),
                subscription_price=Decimal("100.00000"),
                purchase_fmv=Decimal("120.00000"),
                purchase_price=Decimal("85.00000"),
                sold_date=date(2026, 5, 1),
                sold_price=Decimal("150.00000"),
            ),
        ]
    )
    await db.commit()
    db.expunge_all()  # every keyed read must reach the database to be seen
    keyed: dict[str, set] = {"app_settings": set(), "latest_prices": set(), "price_history": set()}

    def record(conn, cursor, statement, parameters, context, executemany):
        for table in keyed:
            if re.search(rf'\b(?:FROM|JOIN)\s+"?{table}"?\b', statement):
                # A read keyed on one row (db.get) or one security's rows, or nothing: an
                # unkeyed read of any of them is exactly what a narrowed cell could miss.
                assert re.search(rf"WHERE {table}\.(key|security_id) = \$1", statement), statement
                keyed[table].add(parameters[0])

    event.listen(engine.sync_engine, "before_cursor_execute", record)
    try:
        out = await taxes_api.withholding_estimate(db, YEAR, PINNED_TODAY, reconcile=True)
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", record)
    # The heavy paths really ran: the partner's leg, the prior year's harbor, the sold lot.
    assert out.partner_source == "simulated"
    assert out.safe_harbor is not None and out.safe_harbor.prior_year == YEAR - 1
    assert out.reconciliation is not None
    assert keyed["app_settings"] == set(read_cache.WITHHOLDING_SETTING_KEYS)
    assert keyed["latest_prices"] == {employer.id}
    assert keyed["price_history"] == {employer.id}


async def test_the_cached_bytes_are_an_uncached_runs_bytes(auth_client, db, world, frozen_today):
    served = await get(auth_client)
    uncached = await taxes_api.withholding_estimate(db, YEAR, PINNED_TODAY, reconcile=True)
    assert served == uncached.model_dump_json().encode()


async def test_a_direct_caller_decodes_a_model_of_its_own(db, world, frozen_today):
    first = await taxes_api.read_withholding(db, YEAR)
    second = await taxes_api.read_withholding(db, YEAR)
    assert first == second and first is not second
    first.reconciliation.rows.clear()
    assert second.reconciliation.rows  # nothing shared to corrupt
    assert len(read_cache.WITHHOLDINGS) == 1


async def test_the_assistant_reads_the_same_payload_with_its_reconciliation(
    db, world, frozen_today
):
    section = await assistant_context._taxes(db, {}, {})
    assert section["withholding"].reconciliation is not None
    assert section["withholding"] == await taxes_api.read_withholding(db, YEAR)
    # The two balances' sign, said once (code-quality suggestion): a bare "-22674.73" is a
    # refund, and the model must not have to guess which way it points.
    assert section["withholding_sign"] == (
        "withholding.balance_projected and withholding.reconciliation.balance_if_matched: "
        "positive = owed at filing, negative = refund"
    )


async def test_the_assistant_says_no_sign_legend_without_a_withholding_card(
    db, world, frozen_today
):
    # A settled year the page is showing: its summary is there, its card is not.
    await seed_tax_year(db, YEAR - 1, "400000.0000")
    section = await assistant_context._taxes(db, {}, {"year": YEAR - 1})
    assert section["withholding"] is None
    assert "withholding_sign" not in section
