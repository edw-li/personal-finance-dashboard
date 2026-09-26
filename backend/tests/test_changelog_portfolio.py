"""Exact undo for the portfolio router (2026-09-25 polish spec §6.1, D1): every user-intent
write records its rows in one change batch and answers X-Change-Batch, and a delete images
what hangs off the row it removes, so the Activity card's Undo puts back the same rows — ids,
ledger positions and price history included."""

from datetime import UTC, date, datetime
from decimal import Decimal

from sqlalchemy import select

from app.models import (
    LatestPrice,
    PortfolioAccount,
    PositionTransaction,
    PriceHistory,
    Security,
    SecurityDividendEvent,
)
from app.services.changelog import DEPENDENT_REFUSAL, REPLAY_REFUSAL
from tests.exact_undo import images, logged, shape, undo
from tests.portfolio_factories import acct

PORTFOLIO = "/api/v1/portfolio"
SECURITIES = f"{PORTFOLIO}/securities"
TRANSACTIONS = f"{PORTFOLIO}/transactions"
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
