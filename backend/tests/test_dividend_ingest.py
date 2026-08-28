from datetime import date
from decimal import Decimal

from sqlalchemy import select

from app.models import DividendPayment, PortfolioAccount, PositionTransaction, Security
from app.services.dividend_ingest import DividendIngestResult, ingest_dividends, shares_on
from app.services.price_provider import DailyBar
from tests.portfolio_factories import acct

TODAY = date(2026, 8, 20)
WINDOW_START = date(2025, 8, 15)  # TODAY - 370 days (HISTORY_WINDOW_DAYS), pinned literally
BEFORE_WINDOW = date(2025, 8, 14)


def bar(day: date, dividend: str, close: str = "100.0000") -> DailyBar:
    return DailyBar(bar_date=day, close=Decimal(close), dividend=Decimal(dividend))


async def seed_security(db, ticker="DIVX") -> Security:
    sec = Security(ticker=ticker, name=f"{ticker} Corp", holding_type="stock")
    db.add(sec)
    await db.commit()
    return sec


def txn(
    sec_id,
    account,
    shares,
    *,
    txn_date=None,
    type_="buy",
    price="10.0000",
    sort_index=0,
    split_factor=None,
):
    # sort_index defaults to 0 like the model — pass distinct values whenever fold order
    # matters, because (sort_index, id) is the folding law.
    return PositionTransaction(
        security_id=sec_id,
        portfolio_account=acct(account),
        type=type_,
        txn_date=txn_date,
        shares=Decimal(shares),
        price=Decimal(price),
        sort_index=sort_index,
        split_factor=None if split_factor is None else Decimal(split_factor),
    )


def manual(sec_id, pay_date, amount, account=None) -> DividendPayment:
    return DividendPayment(
        security_id=sec_id,
        portfolio_account=acct(account),
        pay_date=pay_date,
        amount=Decimal(amount),
    )


def auto(sec_id, account, ex_date, amount) -> DividendPayment:
    return DividendPayment(
        security_id=sec_id,
        portfolio_account=acct(account),
        pay_date=ex_date,
        amount=Decimal(amount),
        source="auto",
        ex_date=ex_date,
        per_share=Decimal("0.820000"),
        shares_held=Decimal("10.000000"),
    )


async def dividend_rows(db, *, source: str | None = None) -> list[DividendPayment]:
    """All dividend rows, (security, ex_date, account LABEL) ordered — the label, not the
    FK id, so the order stays alphabetical rather than insertion-ordered. populate_existing
    because the ingest upserts through Core — a row already in the identity map would
    otherwise read back its pre-write values."""
    stmt = select(DividendPayment)
    if source is not None:
        stmt = stmt.where(DividendPayment.source == source)
    stmt = (
        stmt.outerjoin(
            PortfolioAccount, PortfolioAccount.id == DividendPayment.portfolio_account_id
        )
        .execution_options(populate_existing=True)
        .order_by(DividendPayment.security_id, DividendPayment.ex_date, PortfolioAccount.label)
    )
    return list((await db.execute(stmt)).scalars())


def counts(result: DividendIngestResult) -> tuple[int, int, int, int]:
    return (result.ingested, result.updated, result.removed, result.skipped_manual_overlap)


async def test_ingests_per_account_rows_with_exact_amounts(db):
    sec = await seed_security(db)
    db.add_all(
        [
            txn(sec.id, "RH Taxable", "10", sort_index=0),
            txn(sec.id, "Fidelity", "5", txn_date=date(2026, 6, 1), sort_index=1),
        ]
    )
    await db.commit()

    result = await ingest_dividends(db, {sec.id: [bar(date(2026, 6, 19), "0.8200")]}, today=TODAY)
    await db.commit()

    assert counts(result) == (2, 0, 0, 0)
    rows = await dividend_rows(db)
    assert [(r.account, r.shares_held, r.amount) for r in rows] == [
        ("Fidelity", Decimal("5.000000"), Decimal("4.10")),  # 5 × 0.82
        ("RH Taxable", Decimal("10.000000"), Decimal("8.20")),  # 10 × 0.82
    ]
    for row in rows:
        assert row.source == "auto"
        assert row.ex_date == date(2026, 6, 19) and row.pay_date == date(2026, 6, 19)
        assert row.per_share == Decimal("0.8200")


async def test_dated_transactions_after_event_do_not_count(db):
    sec = await seed_security(db)
    db.add_all(
        [
            txn(sec.id, "RH Taxable", "10", sort_index=0),
            txn(sec.id, "RH Taxable", "7", txn_date=date(2026, 7, 1), sort_index=1),
        ]
    )
    await db.commit()

    result = await ingest_dividends(db, {sec.id: [bar(date(2026, 6, 19), "0.8200")]}, today=TODAY)
    await db.commit()

    assert counts(result) == (1, 0, 0, 0)
    (row,) = await dividend_rows(db)
    assert row.shares_held == Decimal("10.000000") and row.amount == Decimal("8.20")


async def test_dated_split_after_event_does_not_scale_it(db):
    sec = await seed_security(db)
    db.add_all(
        [
            txn(sec.id, "RH Taxable", "10", sort_index=0),
            txn(
                sec.id,
                "RH Taxable",
                "0",
                type_="split",
                txn_date=date(2026, 7, 1),
                price="0",
                split_factor="2",
                sort_index=1,
            ),
        ]
    )
    await db.commit()

    events = {sec.id: [bar(date(2026, 6, 19), "0.8200"), bar(date(2026, 7, 10), "0.8200")]}
    result = await ingest_dividends(db, events, today=TODAY)
    await db.commit()

    assert counts(result) == (2, 0, 0, 0)
    rows = await dividend_rows(db)
    # Dividends pay on the shares held that day: pre-split for June, post-split for July.
    assert [(r.ex_date, r.shares_held, r.amount) for r in rows] == [
        (date(2026, 6, 19), Decimal("10.000000"), Decimal("8.20")),
        (date(2026, 7, 10), Decimal("20.000000"), Decimal("16.40")),
    ]


async def test_idempotent_rerun_rewrites_not_duplicates(db):
    sec = await seed_security(db)
    db.add_all(
        [
            txn(sec.id, "RH Taxable", "10", sort_index=0),
            txn(sec.id, "Fidelity", "5", sort_index=1),
        ]
    )
    await db.commit()

    events = {sec.id: [bar(date(2026, 6, 19), "0.8200")]}
    first = await ingest_dividends(db, events, today=TODAY)
    await db.commit()
    assert counts(first) == (2, 0, 0, 0)
    before = [(r.id, r.account, r.amount) for r in await dividend_rows(db)]

    second = await ingest_dividends(db, events, today=TODAY)
    await db.commit()

    assert counts(second) == (0, 2, 0, 0)
    # Same row ids, same amounts: rewritten in place, never duplicated.
    assert [(r.id, r.account, r.amount) for r in await dividend_rows(db)] == before


async def test_manual_overlap_skips_whole_event(db):
    sec = await seed_security(db)
    db.add_all(
        [
            txn(sec.id, "RH Taxable", "10"),
            manual(sec.id, date(2026, 6, 25), "9.99"),  # 6 days from the June event: ±14
        ]
    )
    await db.commit()

    events = {sec.id: [bar(date(2026, 3, 20), "0.8200"), bar(date(2026, 6, 19), "0.8200")]}
    result = await ingest_dividends(db, events, today=TODAY)
    await db.commit()

    assert counts(result) == (1, 0, 0, 1)
    assert [(r.ex_date, r.amount) for r in await dividend_rows(db, source="auto")] == [
        (date(2026, 3, 20), Decimal("8.20"))  # 97 days away: nowhere near the manual row
    ]
    (kept,) = await dividend_rows(db, source="manual")
    assert kept.pay_date == date(2026, 6, 25) and kept.amount == Decimal("9.99")


async def test_self_heal_removes_rows_the_book_no_longer_supports(db):
    sec = await seed_security(db)
    buy = txn(sec.id, "RH Taxable", "10")
    db.add_all([buy, manual(sec.id, date(2026, 1, 5), "5.00")])
    await db.commit()

    events = {sec.id: [bar(date(2026, 6, 19), "0.8200")]}
    first = await ingest_dividends(db, events, today=TODAY)
    await db.commit()
    assert counts(first) == (1, 0, 0, 0)

    await db.delete(buy)  # the book is corrected: the position never existed
    await db.commit()
    second = await ingest_dividends(db, events, today=TODAY)
    await db.commit()

    assert counts(second) == (0, 0, 1, 0)
    assert await dividend_rows(db, source="auto") == []
    (kept,) = await dividend_rows(db, source="manual")
    assert kept.pay_date == date(2026, 1, 5) and kept.amount == Decimal("5.00")


async def test_untouched_when_security_absent_from_events(db):
    held = await seed_security(db, "DIVX")
    other = await seed_security(db, "BBBX")
    db.add_all(
        [
            txn(held.id, "RH Taxable", "10"),
            # A ticker that failed (or was skipped) this run keeps its in-window auto rows.
            auto(other.id, "RH Taxable", date(2026, 6, 19), "3.00"),
        ]
    )
    await db.commit()

    result = await ingest_dividends(db, {held.id: [bar(date(2026, 6, 19), "0.8200")]}, today=TODAY)
    await db.commit()

    assert counts(result) == (1, 0, 0, 0)
    assert [(r.security_id, r.amount) for r in await dividend_rows(db)] == [
        (held.id, Decimal("8.20")),
        (other.id, Decimal("3.00")),
    ]


async def test_zero_share_and_dust_amounts_skipped(db):
    sec = await seed_security(db)
    db.add_all(
        [
            txn(sec.id, "RH Taxable", "10", sort_index=0),
            txn(sec.id, "RH Taxable", "10", type_="sell", sort_index=1),  # sold out: 0 shares
            txn(sec.id, "Dust", "0.001", sort_index=2),  # 0.001 × $0.01 = $0.00001
            # Overdrawn folds NEGATIVE (the fold warns and carries on) — the guard is
            # shares <= 0, so a negative dividend row can never be written.
            txn(sec.id, "Overdrawn", "1", sort_index=3),
            txn(sec.id, "Overdrawn", "3", type_="sell", sort_index=4),
        ]
    )
    await db.commit()

    result = await ingest_dividends(db, {sec.id: [bar(date(2026, 6, 19), "0.0100")]}, today=TODAY)
    await db.commit()

    assert result == DividendIngestResult()  # every counter zero
    assert await dividend_rows(db) == []


async def test_window_boundary(db):
    sec = await seed_security(db)
    db.add_all(
        [
            txn(sec.id, "RH Taxable", "10"),
            # Pre-window auto row: frozen history, never healed against.
            auto(sec.id, "RH Taxable", BEFORE_WINDOW, "99.00"),
        ]
    )
    await db.commit()

    events = {
        sec.id: [
            bar(BEFORE_WINDOW, "0.8200"),  # older than today - 370d: ignored
            bar(WINDOW_START, "0.8200"),  # the boundary itself is inside
        ]
    }
    result = await ingest_dividends(db, events, today=TODAY)
    await db.commit()

    assert counts(result) == (1, 0, 0, 0)
    assert [(r.ex_date, r.amount) for r in await dividend_rows(db)] == [
        (BEFORE_WINDOW, Decimal("99.00")),
        (WINDOW_START, Decimal("8.20")),
    ]


def test_shares_on_dateless_counts_always():
    txns = [
        txn(1, "RH Taxable", "10", sort_index=0),  # dateless: held from the beginning
        txn(1, "RH Taxable", "5", txn_date=date(2026, 6, 1), sort_index=1),
        txn(1, "RH Taxable", "3", txn_date=date(2026, 7, 1), sort_index=2),
        txn(2, "Fidelity", "4", sort_index=3),
    ]
    # shares_on keys on (security_id, portfolio_account_id) since 2026-08-28, and these rows
    # were never flushed, so their FK id is None (Position's documented case). The DATE
    # cutoff is what this test pins; the per-account grain is pinned by the DB-backed
    # test_ingests_per_account_rows_with_exact_amounts / test_self_heal_scope_is_keyed_by_
    # the_account_row below.
    assert shares_on(txns, date(2026, 5, 1)) == {
        (1, None): Decimal("10.000000"),
        (2, None): Decimal("4.000000"),
    }
    assert shares_on(txns, date(2026, 6, 1))[(1, None)] == Decimal("15")  # inclusive
    assert shares_on(txns, date(2026, 6, 19))[(1, None)] == Decimal("15")
    assert shares_on(txns, date(2026, 7, 10))[(1, None)] == Decimal("18")


async def test_self_heal_covers_securities_with_bars_but_no_events(db):
    # Branch review I1: a security whose in-window events ALL vanished from the feed
    # still arrives in events_by_security (with an empty list — refresh_prices records
    # every updated ticker), and its stale in-window auto rows must heal away. Absent
    # keys (failed tickers) stay protected — the sibling untouched test pins that side.
    sec = await seed_security(db)
    db.add(auto(sec.id, "RH Taxable", date(2026, 6, 19), "8.20"))
    await db.commit()

    result = await ingest_dividends(db, {sec.id: []}, today=TODAY)
    await db.commit()

    assert counts(result) == (0, 0, 1, 0)
    assert await dividend_rows(db) == []


async def test_manual_overlap_boundary_exactly_14_days(db):
    # The overlap window is INCLUSIVE at exactly ±14 days — the conservative edge:
    # skipped, never double-counted. 15 days out is past the window and ingests.
    sec = await seed_security(db)
    db.add(txn(sec.id, "RH Taxable", "10"))
    db.add(manual(sec.id, date(2026, 7, 3), "8.00"))  # event + 14 days exactly
    await db.commit()

    event = [bar(date(2026, 6, 19), "0.8200")]
    result = await ingest_dividends(db, {sec.id: event}, today=TODAY)
    await db.commit()
    assert counts(result) == (0, 0, 0, 1)
    assert await dividend_rows(db, source="auto") == []

    # Move the manual row one day further out: the same event now ingests.
    row = (await db.execute(select(DividendPayment))).scalar_one()
    row.pay_date = date(2026, 7, 4)
    await db.commit()
    result = await ingest_dividends(db, {sec.id: event}, today=TODAY)
    await db.commit()
    assert counts(result) == (1, 0, 0, 0)
    assert [r.amount for r in await dividend_rows(db, source="auto")] == [Decimal("8.20")]
