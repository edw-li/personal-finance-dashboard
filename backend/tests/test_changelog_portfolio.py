"""Exact undo for the portfolio router (2026-09-25 polish spec §6.1, D1): every user-intent
write records its rows in one change batch and answers X-Change-Batch, and a delete images
what hangs off the row it removes, so the Activity card's Undo puts back the same rows — ids,
ledger positions and price history included."""

from collections import Counter
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from uuid import UUID

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.models import (
    DividendPayment,
    LatestPrice,
    Person,
    PortfolioAccount,
    PositionTransaction,
    PriceHistory,
    Security,
    SecurityDividendEvent,
)
from app.services.changelog import DEPENDENT_REFUSAL, OVERLAP_REFUSAL, REPLAY_REFUSAL, undo_batch
from app.services.ordering import order_lock
from tests.exact_undo import images, logged, shape, table_images, undo
from tests.ordering_helpers import recorded_sql
from tests.portfolio_factories import acct

PORTFOLIO = "/api/v1/portfolio"
SECURITIES = f"{PORTFOLIO}/securities"
TRANSACTIONS = f"{PORTFOLIO}/transactions"
ORDER = f"{TRANSACTIONS}/order"
DIVIDENDS = f"{PORTFOLIO}/dividends"
VOO = {"ticker": "VOO", "name": "Vanguard S&P 500 ETF", "holding_type": "etf"}


async def priced_security(db) -> Security:
    """VOO with everything a price refresh leaves behind: two historical ex-dividend markers,
    three daily closes and a latest quote."""
    security = Security(
        ticker="VOO",
        name="Vanguard S&P 500 ETF",
        holding_type="etf",
        annual_dividend=Decimal("6.6500"),
        ex_div_date=date(2026, 6, 27),
    )
    db.add(security)
    await db.flush()
    db.add_all(
        [
            SecurityDividendEvent(
                security_id=security.id, ex_date=date(2025, 3, 27), per_share=Decimal("1.812300")
            ),
            SecurityDividendEvent(
                security_id=security.id, ex_date=date(2025, 6, 30), per_share=Decimal("1.744900")
            ),
            *[
                PriceHistory(
                    security_id=security.id,
                    price_date=date(2026, 9, day),
                    close=Decimal(f"{540 + day}.1200"),
                )
                for day in (21, 22, 23)
            ],
            LatestPrice(
                security_id=security.id,
                price=Decimal("563.4100"),
                quoted_at=datetime(2026, 9, 24, 20, 0, tzinfo=UTC),
                source="yfinance",
            ),
        ]
    )
    await db.commit()
    return security


async def stock(db, ticker: str = "NVDA", name: str = "NVIDIA") -> int:
    security = Security(ticker=ticker, name=name, holding_type="stock")
    db.add(security)
    await db.commit()
    return security.id


async def ledger(db) -> list[int]:
    """Three NVDA rows at 10, 20, 30: a dated UI buy, an undated imported buy, a dated sell."""
    security_id = await stock(db)
    rows = [
        PositionTransaction(
            security_id=security_id,
            portfolio_account=acct("RH Taxable"),
            type="buy",
            txn_date=date(2026, 9, 2),
            shares=Decimal("10.000000"),
            price=Decimal("120.5000"),
            fees=Decimal("1.00"),
            sort_index=10,
            source="ui",
        ),
        PositionTransaction(
            security_id=security_id,
            portfolio_account=acct("RH Taxable"),
            type="buy",
            shares=Decimal("5.000000"),
            price=Decimal("90.0000"),
            sort_index=20,
            source="import",
            import_key=20,
        ),
        PositionTransaction(
            security_id=security_id,
            portfolio_account=acct("RH Taxable"),
            type="sell",
            txn_date=date(2026, 9, 10),
            shares=Decimal("2.000000"),
            price=Decimal("130.0000"),
            sort_index=30,
            source="ui",
            notes="trim",
        ),
    ]
    db.add_all(rows)
    await db.commit()
    return [row.id for row in rows]


async def replay(db) -> list[tuple[int, int]]:
    rows = await db.execute(
        select(PositionTransaction.id, PositionTransaction.sort_index).order_by(
            PositionTransaction.sort_index, PositionTransaction.id
        )
    )
    return [(row.id, row.sort_index) for row in rows]


def buy(security_id: int, account: str, **fields) -> dict:
    return {
        "security_id": security_id,
        "account": account,
        "type": "buy",
        "shares": "10",
        "price": "120.5",
        **fields,
    }


# ── securities ───────────────────────────────────────────────────────────────────────


async def test_security_create_edit_and_delete_are_logged_with_their_batch(auth_client, db):
    created = await auth_client.post(SECURITIES, json={**VOO, "ticker": " voo "})
    assert created.status_code == 201, created.text
    security_id = created.json()["id"]
    [row] = await logged(db, created.headers["x-change-batch"])
    assert (row.op, row.table_name, row.label) == ("insert", "securities", "Added security VOO")
    assert row.after["ticker"] == "VOO"

    path = f"{SECURITIES}/{security_id}"
    edited = await auth_client.patch(path, json={"name": "Vanguard 500"})
    assert edited.status_code == 200, edited.text
    [row] = await logged(db, edited.headers["x-change-batch"])
    assert (row.op, row.label) == ("update", "Edited security VOO")
    assert (row.before["name"], row.after["name"]) == ("Vanguard S&P 500 ETF", "Vanguard 500")
    # Nothing changed, nothing logged — and no header, so the client offers no Undo.
    unchanged = await auth_client.patch(path, json={"name": "Vanguard 500"})
    assert unchanged.status_code == 200 and "x-change-batch" not in unchanged.headers

    deleted = await auth_client.delete(path)
    assert deleted.status_code == 204
    [row] = await logged(db, deleted.headers["x-change-batch"])
    assert (row.op, row.table_name, row.label) == ("delete", "securities", "Deleted security VOO")


async def test_deleting_a_security_takes_its_price_rows_and_undo_puts_back_every_one(
    auth_client, db
):
    security = await priced_security(db)
    security_id = security.id
    tables = (Security, SecurityDividendEvent, PriceHistory, LatestPrice)
    before = {model: await images(db, model) for model in tables}
    deleted = await auth_client.delete(f"{SECURITIES}/{security_id}")
    assert deleted.status_code == 204, deleted.text
    batch_id = deleted.headers["x-change-batch"]
    rows = await logged(db, batch_id)
    # Children first, the security LAST: the Undo replays in reverse, so the security is back
    # before the rows that point at it.
    assert shape(rows) == [
        ("delete", "security_dividend_events"),
        ("delete", "security_dividend_events"),
        ("delete", "price_history"),
        ("delete", "price_history"),
        ("delete", "price_history"),
        ("delete", "latest_prices"),
        ("delete", "securities"),
    ]
    assert {row.label for row in rows} == {"Deleted security VOO"}
    for model in tables:
        assert await images(db, model) == []
    restored = await undo(auth_client, batch_id)
    assert restored.status_code == 200, restored.text
    assert (restored.json()["label"], restored.json()["rows"]) == (
        "Undid: Deleted security VOO",
        7,
    )
    for model in tables:
        assert await images(db, model) == before[model]  # the same rows, ids included


async def test_undoing_a_security_delete_re_inserts_each_table_in_one_statement(auth_client, db):
    """Years of daily closes (the employer ticker has ~780): the Undo re-inserts them with one
    multi-row INSERT per table, not one statement per row — and every row still comes back
    exactly, ids included."""
    security = await priced_security(db)
    security_id = security.id
    db.add_all(
        [
            PriceHistory(
                security_id=security_id,
                price_date=date(2023, 1, 2) + timedelta(days=day),
                close=Decimal("100.0000") + day,
            )
            for day in range(800)
        ]
    )
    await db.commit()
    tables = (Security, SecurityDividendEvent, PriceHistory, LatestPrice)
    before = await table_images(db, *tables)
    deleted = await auth_client.delete(f"{SECURITIES}/{security_id}")
    assert deleted.status_code == 204, deleted.text
    with recorded_sql(db) as statements:
        restored = await undo(auth_client, deleted)
    assert restored.status_code == 200, restored.text
    assert restored.json()["rows"] == 807  # 2 markers, 803 closes, the quote, the security
    inserts = Counter(sql.split()[2] for sql, _ in statements if sql.startswith("INSERT INTO"))
    replayed = ("securities", "latest_prices", "price_history", "security_dividend_events")
    assert {table: inserts[table] for table in replayed} == dict.fromkeys(replayed, 1)
    assert sum(inserts.values()) <= 6  # and the Undo's own change-log rows and run
    assert await table_images(db, *tables) == before


async def test_undoing_a_security_delete_after_the_ticker_came_back_refuses(auth_client, db):
    security = await priced_security(db)
    deleted = await auth_client.delete(f"{SECURITIES}/{security.id}")
    assert deleted.status_code == 204
    again = await auth_client.post(SECURITIES, json=VOO)
    assert again.status_code == 201, again.text
    again_id = again.json()["id"]
    refused = await undo(auth_client, deleted.headers["x-change-batch"])
    # No later batch names the old rows, so it is the replay itself that fails: the old
    # security's ticker is taken again (an accepted behaviour, spec §6.1).
    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"] == REPLAY_REFUSAL
    await db.rollback()  # the refusal rolled the shared session back
    listed = (await auth_client.get(SECURITIES)).json()
    assert [(row["id"], row["ticker"]) for row in listed] == [(again_id, "VOO")]
    assert await images(db, PriceHistory) == []


async def test_undoing_a_security_create_after_a_refresh_priced_it_refuses(auth_client, db):
    created = await auth_client.post(SECURITIES, json=VOO)
    assert created.status_code == 201, created.text
    # The price refresh writes unlogged, as the machine it is.
    db.add(
        PriceHistory(
            security_id=created.json()["id"], price_date=date(2026, 9, 24), close=Decimal("563.41")
        )
    )
    await db.commit()
    refused = await undo(auth_client, created.headers["x-change-batch"])
    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"] == DEPENDENT_REFUSAL


# ── transactions ─────────────────────────────────────────────────────────────────────


async def test_a_transaction_on_a_new_label_logs_the_label_before_the_row(auth_client, db):
    security_id = await stock(db)
    first = await auth_client.post(
        TRANSACTIONS, json=buy(security_id, "RH Joint Taxable", txn_date="2026-09-02")
    )
    assert first.status_code == 201, first.text
    first_batch = first.headers["x-change-batch"]
    rows = await logged(db, first_batch)
    assert shape(rows) == [("insert", "portfolio_accounts"), ("insert", "position_transactions")]
    assert {row.label for row in rows} == {"Added NVDA buy of Sep 2, 2026"}
    assert rows[0].after["label"] == "RH Joint Taxable"
    assert rows[1].after["portfolio_account_id"] == rows[0].after["id"]
    # A label that already exists mints nothing: only the row is logged.
    second = await auth_client.post(TRANSACTIONS, json=buy(security_id, "RH Joint Taxable"))
    assert second.status_code == 201, second.text
    second_batch = second.headers["x-change-batch"]
    [row] = await logged(db, second_batch)
    assert (row.table_name, row.label) == ("position_transactions", "Added NVDA buy (undated)")
    # While the second row files under the label, undoing the first cannot take the label away.
    refused = await undo(auth_client, first_batch)
    assert refused.status_code == 409 and refused.json()["detail"] == DEPENDENT_REFUSAL
    await db.rollback()
    assert (await undo(auth_client, second_batch)).status_code == 200
    assert (await undo(auth_client, first_batch)).status_code == 200
    assert await images(db, PositionTransaction) == []
    assert await images(db, PortfolioAccount) == []  # the label the first write minted went too


async def test_moving_a_transaction_to_a_new_label_images_its_new_account_id(auth_client, db):
    security_id = await stock(db)
    created = await auth_client.post(
        TRANSACTIONS, json=buy(security_id, "RH Taxable", txn_date="2026-09-02")
    )
    assert created.status_code == 201, created.text
    txn_id = created.json()["id"]
    [label_row, _] = await logged(db, created.headers["x-change-batch"])
    path = f"{TRANSACTIONS}/{txn_id}"
    edited = await auth_client.patch(path, json={"account": "Fidelity Taxable", "price": "121"})
    assert edited.status_code == 200, edited.text
    edit_batch = edited.headers["x-change-batch"]
    rows = await logged(db, edit_batch)
    assert shape(rows) == [("insert", "portfolio_accounts"), ("update", "position_transactions")]
    assert {row.label for row in rows} == {"Edited NVDA buy of Sep 2, 2026"}
    # The relationship moves the FK only at a flush — the image was taken after one.
    assert rows[1].before["portfolio_account_id"] == label_row.after["id"]
    assert rows[1].after["portfolio_account_id"] == rows[0].after["id"]
    assert (rows[1].before["price"], rows[1].after["price"]) == ("120.5000", "121.0000")
    unchanged = await auth_client.patch(path, json={"price": "121"})
    assert unchanged.status_code == 200 and "x-change-batch" not in unchanged.headers
    assert (await undo(auth_client, edit_batch)).status_code == 200
    listed = (await auth_client.get(TRANSACTIONS)).json()
    assert [(row["id"], row["account"], row["price"]) for row in listed] == [
        (txn_id, "RH Taxable", "120.5000")
    ]
    labels = (await auth_client.get(f"{PORTFOLIO}/accounts")).json()
    assert [row["label"] for row in labels] == ["RH Taxable"]  # the edit's new label went too


async def test_deleting_a_transaction_and_undoing_it_restores_the_same_row(auth_client, db):
    first, middle, last = await ledger(db)
    before = await images(db, PositionTransaction)
    deleted = await auth_client.delete(f"{TRANSACTIONS}/{middle}")
    assert deleted.status_code == 204
    batch_id = deleted.headers["x-change-batch"]
    [row] = await logged(db, batch_id)
    assert (row.op, row.table_name, row.label) == (
        "delete",
        "position_transactions",
        "Deleted NVDA buy (undated)",
    )
    assert await replay(db) == [(first, 10), (last, 30)]
    assert (await undo(auth_client, batch_id)).status_code == 200
    # Same id, same sort_index: back in its place in the replay order, not at the ledger's end.
    assert await images(db, PositionTransaction) == before
    listed = (await auth_client.get(TRANSACTIONS)).json()
    assert [row["id"] for row in listed] == [first, middle, last]


# ── the replay order ─────────────────────────────────────────────────────────────────


async def test_a_reorder_logs_every_row_it_renumbers_and_undoes_to_the_old_order(auth_client, db):
    first, middle, last = await ledger(db)
    unchanged = await auth_client.put(ORDER, json={"ids": [first, middle, last]})
    assert unchanged.status_code == 200 and "x-change-batch" not in unchanged.headers
    moved = await auth_client.put(ORDER, json={"ids": [last, middle, first]})
    assert moved.status_code == 200, moved.text
    batch_id = moved.headers["x-change-batch"]
    rows = await logged(db, batch_id)
    # The middle row keeps 20, so it is neither written nor logged.
    assert [(r.op, r.pk["id"], r.before["sort_index"], r.after["sort_index"]) for r in rows] == [
        ("update", last, 30, 10),
        ("update", first, 10, 30),
    ]
    # Whole-row images, the way every change-log update is kept, differing in sort_index alone.
    columns = {column.key for column in PositionTransaction.__table__.columns}
    for entry in rows:
        assert entry.before.keys() == entry.after.keys() == columns
        assert {**entry.before, "sort_index": 0} == {**entry.after, "sort_index": 0}
    assert {row.label for row in rows} == {"Reordered 2 transactions"}
    assert (await undo(auth_client, batch_id)).status_code == 200
    assert await replay(db) == [(first, 10), (middle, 20), (last, 30)]


async def test_a_single_move_names_the_row_it_moved(auth_client, db):
    first, middle, last = await ledger(db)
    moved = await auth_client.put(ORDER, json={"ids": [middle, first, last]})
    assert moved.status_code == 200, moved.text
    labels = {row.label for row in await logged(db, moved.headers["x-change-batch"])}
    assert labels == {"Moved NVDA buy of Sep 2, 2026"}


async def test_an_older_edit_cannot_be_undone_once_a_reorder_moved_its_row(auth_client, db):
    first, middle, last = await ledger(db)
    edited = await auth_client.patch(f"{TRANSACTIONS}/{first}", json={"notes": "first lot"})
    assert edited.status_code == 200, edited.text
    moved = await auth_client.put(ORDER, json={"ids": [middle, first, last]})
    assert moved.status_code == 200, moved.text
    # Unlogged, the reorder would let this Undo write the edit's image — the row's OLD
    # sort_index with it — and silently move the row back. Logged, the overlap refusal says so.
    refused = await undo(auth_client, edited.headers["x-change-batch"])
    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"] == OVERLAP_REFUSAL


async def test_an_undo_of_a_reorder_waits_for_the_ledger_lock(auth_client, db, engine):
    """The ledger is one of services.ordering's ORDERED_LISTS, so an Undo that rewrites its
    replay order serializes with a reorder or an append in another tab, as the accounts' does."""
    first, middle, last = await ledger(db)
    moved = await auth_client.put(ORDER, json={"ids": [last, middle, first]})
    batch_id = UUID(moved.headers["x-change-batch"])
    after_move = await replay(db)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as holder:
        await holder.execute(order_lock(PositionTransaction))  # a reorder in flight elsewhere
        async with sessions() as undoing:
            await undoing.execute(text("SET LOCAL lock_timeout = '200ms'"))
            with pytest.raises(DBAPIError, match="lock timeout"):
                await undo_batch(undoing, batch_id, actor="tab 2")
        assert await replay(db) == after_move  # nothing undone meanwhile
    async with sessions() as undoing:  # the holder's transaction is over: the lock is free
        await undo_batch(undoing, batch_id, actor="tab 2")
    assert await replay(db) == [(first, 10), (middle, 20), (last, 30)]


# ── dividends and label owners ───────────────────────────────────────────────────────


async def test_dividend_writes_are_logged_and_a_delete_undoes_exactly(auth_client, db):
    security_id = await stock(db)
    created = await auth_client.post(
        DIVIDENDS,
        json={
            "security_id": security_id,
            "account": "RH Taxable",
            "pay_date": "2026-08-31",
            "amount": "4.12",
            "notes": "Q3",
        },
    )
    assert created.status_code == 201, created.text
    dividend_id = created.json()["id"]
    rows = await logged(db, created.headers["x-change-batch"])
    assert shape(rows) == [("insert", "portfolio_accounts"), ("insert", "dividend_payments")]
    assert {row.label for row in rows} == {"Added NVDA dividend of Aug 31, 2026"}

    edited = await auth_client.patch(
        f"{DIVIDENDS}/{dividend_id}", json={"amount": "4.20", "account": "Fidelity Taxable"}
    )
    assert edited.status_code == 200, edited.text
    rows = await logged(db, edited.headers["x-change-batch"])
    assert shape(rows) == [("insert", "portfolio_accounts"), ("update", "dividend_payments")]
    assert rows[1].after["portfolio_account_id"] == rows[0].after["id"]  # imaged after the flush
    assert (rows[1].before["amount"], rows[1].after["amount"]) == ("4.12", "4.20")
    assert {row.label for row in rows} == {"Edited NVDA dividend of Aug 31, 2026"}

    before = await images(db, DividendPayment)
    deleted = await auth_client.delete(f"{DIVIDENDS}/{dividend_id}")
    assert deleted.status_code == 204
    batch_id = deleted.headers["x-change-batch"]
    [row] = await logged(db, batch_id)
    assert (row.op, row.label) == ("delete", "Deleted NVDA dividend of Aug 31, 2026")
    assert await images(db, DividendPayment) == []
    assert (await undo(auth_client, batch_id)).status_code == 200
    assert await images(db, DividendPayment) == before


async def test_changing_a_labels_owner_is_logged(auth_client, db):
    me, sam = Person(name="Me", is_primary=True), Person(name="Sam")
    db.add_all([me, sam])
    await db.flush()
    label = PortfolioAccount(label="RH Joint Taxable", person_id=me.id)
    db.add(label)
    await db.commit()
    label_id, me_id = label.id, me.id
    path = f"{PORTFOLIO}/accounts/{label_id}"
    joint = await auth_client.patch(path, json={"person_id": None})
    assert joint.status_code == 200, joint.text
    batch_id = joint.headers["x-change-batch"]
    [row] = await logged(db, batch_id)
    assert (row.op, row.table_name, row.label) == (
        "update",
        "portfolio_accounts",
        "Changed the owner of RH Joint Taxable",
    )
    assert (row.before["person_id"], row.after["person_id"]) == (me_id, None)
    # The same owner again, or no owner key at all, changes nothing and names no batch.
    for body in ({"person_id": None}, {}):
        same = await auth_client.patch(path, json=body)
        assert same.status_code == 200 and "x-change-batch" not in same.headers
    assert (await undo(auth_client, batch_id)).status_code == 200
    [owned] = (await auth_client.get(f"{PORTFOLIO}/accounts")).json()
    assert owned["person_id"] == me_id
