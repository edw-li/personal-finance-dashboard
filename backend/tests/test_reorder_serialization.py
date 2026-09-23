"""Reorders serialize per list (2026-09-23 drag-to-reorder spec §3.4, amended; plan decision
16). Every reorder route takes its list's transaction-scoped advisory lock as its FIRST
statement, and every append path of the same list takes it before it reads the max — so two
tabs' reorders cannot merge row by row into an order neither asked for, and a create cannot
land on a number a reorder is about to write.

The races run two real sessions (tests.ordering_helpers.race). The pins record the SQL one
request sends: only the ORDER of statements proves that a lock came before a read."""

from decimal import Decimal
from uuid import UUID

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import async_sessionmaker
from starlette.responses import Response

from app.api.credit_cards import create_credit_card, reorder_credit_cards
from app.api.net_worth import reorder_accounts
from app.api.portfolio import reorder_transactions
from app.importer.service import run_import
from app.models import (
    Account,
    ChangeLog,
    CreditCard,
    PortfolioAccount,
    PositionTransaction,
    RewardCategory,
    Security,
    SpendingCategory,
)
from app.schemas.credit_cards import CreditCardIn
from app.schemas.ordering import OrderIn
from app.services.changelog import ChangeBatch, undo_batch
from app.services.ordering import order_lock
from tests.ordering_helpers import first_position, lock_position, race, recorded_sql
from tests.workbook_builder import build_workbook

API = "/api/v1"


def card(name: str, sort_order: int = 0) -> CreditCard:
    return CreditCard(
        name=name,
        slug=name.lower(),
        annual_fee=Decimal("0"),
        rewards_currency="cash",
        point_value_cents=Decimal("1"),
        sort_order=sort_order,
    )


async def ledger_book(db) -> tuple[Security, PortfolioAccount]:
    security = Security(ticker="VOO", name="Vanguard S&P 500 ETF", holding_type="etf")
    label = PortfolioAccount(label="Mine")
    db.add_all([security, label])
    await db.flush()
    return security, label


def buy(security: Security, label: PortfolioAccount, sort_index: int) -> PositionTransaction:
    return PositionTransaction(
        security_id=security.id,
        portfolio_account=label,
        type="buy",
        shares=Decimal("1"),
        price=Decimal(sort_index),
        sort_index=sort_index,
        source="ui",
    )


async def orders(db, model, column) -> list[tuple[int, int]]:
    rows = await db.execute(select(model.id, column).order_by(column, model.id))
    return [tuple(row) for row in rows]


# ── the races ────────────────────────────────────────────────────────────────────────


async def test_two_account_reorders_serialize_and_the_later_one_wins_whole(db, engine):
    rows = [
        Account(name=name, slug=name.lower(), group="cash", sort_order=index)
        for index, name in enumerate("ABCD")
    ]
    db.add_all(rows)
    await db.commit()
    a, b, c, d = (row.id for row in rows)
    first_answer, second_answer = Response(), Response()

    async def swap_a_and_b(session):  # writes two rows
        batch = ChangeBatch(session, actor="tab 1")
        return await reorder_accounts(OrderIn(ids=[b, a, c, d]), first_answer, session, batch)

    async def d_to_the_top(session):  # writes every row
        batch = ChangeBatch(session, actor="tab 2")
        return await reorder_accounts(OrderIn(ids=[d, a, b, c]), second_answer, session, batch)

    await race(engine, swap_a_and_b, d_to_the_top)
    # Unserialized, the swap's two stale writes landed on top of D-to-the-top: B 0, D 0, A 1,
    # C 3 — a tie, a gap, and an order neither tab sent.
    assert await orders(db, Account, Account.sort_order) == [(d, 0), (a, 1), (b, 2), (c, 3)]
    # The later batch read what the first one LEFT (B 0, A 1, C 2, D 3): fresh before-images.
    batch_id = UUID(second_answer.headers["x-change-batch"])
    logged = (
        (await db.execute(select(ChangeLog).where(ChangeLog.batch_id == batch_id))).scalars().all()
    )
    assert sorted((r.pk["id"], r.before["sort_order"], r.after["sort_order"]) for r in logged) == (
        sorted([(d, 3, 0), (b, 0, 2), (c, 2, 3)])
    )
    # So its Undo lands exactly on the first request's order, never on one nobody saw.
    async with async_sessionmaker(engine, expire_on_commit=False)() as session:
        await undo_batch(session, batch_id, actor="tab 2")
    assert await orders(db, Account, Account.sort_order) == [(b, 0), (a, 1), (c, 2), (d, 3)]


async def test_two_transaction_reorders_serialize_and_the_later_replay_order_wins(db, engine):
    security, label = await ledger_book(db)
    rows = [buy(security, label, sort_index) for sort_index in (10, 20, 30, 40)]
    db.add_all(rows)
    await db.commit()
    t1, t2, t3, t4 = (row.id for row in rows)

    async def swap_the_first_two(session):  # writes two rows
        return await reorder_transactions(OrderIn(ids=[t2, t1, t3, t4]), None, session)

    async def last_to_the_top(session):  # writes every row
        return await reorder_transactions(OrderIn(ids=[t4, t1, t2, t3]), None, session)

    _, answer = await race(engine, swap_the_first_two, last_to_the_top)
    # The replay order IS the cost basis: it must be exactly one request's, never a blend.
    replay = await orders(db, PositionTransaction, PositionTransaction.sort_index)
    assert replay == [(t4, 10), (t1, 20), (t2, 30), (t3, 40)]
    assert [txn.id for txn in answer.transactions] == [t4, t1, t2, t3]


async def test_a_card_created_during_a_reorder_lands_after_it_not_on_its_numbers(db, engine):
    # Prod's shape (spec §0): every card at 0, so a max read before the reorder commits is 0.
    rows = [card(name) for name in ("W", "X", "Y", "Z")]
    db.add_all(rows)
    await db.commit()
    w, x, y, z = (row.id for row in rows)

    async def reverse(session):
        return await reorder_credit_cards(OrderIn(ids=[z, y, x, w]), session)

    async def create(session):
        body = CreditCardIn(name="New", rewards_currency="points")
        return await create_credit_card(body, session)

    _, created = await race(engine, reverse, create)
    stored = await orders(db, CreditCard, CreditCard.sort_order)
    assert stored == [(z, 0), (y, 1), (x, 2), (w, 3), (created.id, 4)]  # no number twice


# ── the pins: the lock comes first ───────────────────────────────────────────────────


async def seed_two(db, table: str) -> tuple[str, list[int]]:
    """Two rows of the list; returns its reorder path and the two ids swapped."""
    if table == "accounts":
        rows = [
            Account(name="A", slug="a", group="cash", sort_order=0),
            Account(name="B", slug="b", group="cash", sort_order=1),
        ]
        path = f"{API}/net-worth/accounts/order"
    elif table == "spending_categories":
        rows = [
            SpendingCategory(name="A", slug="a", sort_order=0),
            SpendingCategory(name="B", slug="b", sort_order=1),
        ]
        path = f"{API}/spending/categories/order"
    elif table == "position_transactions":
        security, label = await ledger_book(db)
        rows = [buy(security, label, 10), buy(security, label, 20)]
        path = f"{API}/portfolio/transactions/order"
    elif table == "credit_cards":
        rows = [card("A", 0), card("B", 1)]
        path = f"{API}/credit-cards/order"
    else:
        rows = [
            RewardCategory(name="A", slug="a", sort_order=0),
            RewardCategory(name="B", slug="b", sort_order=1),
        ]
        path = f"{API}/credit-cards/categories/order"
    db.add_all(rows)
    await db.commit()
    return path, [rows[1].id, rows[0].id]


LISTS = (
    "accounts",
    "spending_categories",
    "position_transactions",
    "credit_cards",
    "reward_categories",
)


@pytest.mark.parametrize("table", LISTS)
async def test_every_reorder_takes_its_lists_lock_before_it_reads_the_list(auth_client, db, table):
    path, swapped = await seed_two(db, table)
    with recorded_sql(db) as statements:
        resp = await auth_client.put(path, json={"ids": swapped})
    assert resp.status_code == 200, resp.text
    assert lock_position(statements, table) < first_position(statements, f"FROM {table}")


async def create_request(db, table: str) -> tuple[str, dict]:
    """A create without a sort_order — the append the lock guards."""
    if table == "accounts":
        return f"{API}/net-worth/accounts", {"name": "New", "group": "cash"}
    if table == "spending_categories":
        return f"{API}/spending/categories", {"name": "New"}
    if table == "credit_cards":
        return f"{API}/credit-cards", {"name": "New", "rewards_currency": "points"}
    if table == "reward_categories":
        return f"{API}/credit-cards/categories", {"name": "New"}
    security, _ = await ledger_book(db)
    await db.commit()
    body = {"security_id": security.id, "account": "Mine", "type": "buy", "shares": "1"}
    return f"{API}/portfolio/transactions", {**body, "price": "1"}


@pytest.mark.parametrize("table", LISTS)
async def test_every_append_takes_its_lists_lock_before_it_reads_the_max(auth_client, db, table):
    path, body = await create_request(db, table)
    column = "sort_index" if table == "position_transactions" else "sort_order"
    with recorded_sql(db) as statements:
        resp = await auth_client.post(path, json=body)
    assert resp.status_code == 201, resp.text
    assert lock_position(statements, table) < first_position(statements, f"max({table}.{column})")


async def test_a_group_change_takes_the_lock_before_it_reads_the_account(auth_client, db):
    """The append rides the group change, and so does the before-image the change batch
    keeps: both must be read after a reorder in flight commits."""
    account = Account(name="Checking", slug="checking", group="cash", sort_order=0)
    db.add(account)
    await db.commit()
    account_id = account.id
    db.expunge_all()  # a production request reads the row fresh; so must this one
    with recorded_sql(db) as statements:
        resp = await auth_client.patch(
            f"{API}/net-worth/accounts/{account_id}", json={"group": "other"}
        )
    assert resp.status_code == 200, resp.text
    assert lock_position(statements, "accounts") < first_position(statements, "FROM accounts")


async def test_an_import_takes_the_three_list_locks_before_it_reads_them(db):
    with recorded_sql(db) as statements:
        report = await run_import(build_workbook(), db, dry_run=True)
    assert not report.has_errors
    for table in ("position_transactions", "accounts", "spending_categories"):
        assert lock_position(statements, table) < first_position(statements, f"FROM {table}")


# ── an Activity-card Undo serializes with the reorders it could blend with ─────────────


@pytest.mark.parametrize("table", ["accounts", "spending_categories"])
async def test_an_undo_of_a_reorder_waits_for_its_lists_order_lock(auth_client, db, engine, table):
    """An Undo rewrites a list's numbers too, so a reorder in another tab must not
    interleave with it. While another session holds the list's order lock the Undo waits —
    here, out to a short lock_timeout, having written nothing — and once the lock is
    released it goes through."""
    model = {"accounts": Account, "spending_categories": SpendingCategory}[table]
    path, swapped = await seed_two(db, table)
    resp = await auth_client.put(path, json={"ids": swapped})
    assert resp.status_code == 200, resp.text
    batch_id = UUID(resp.headers["x-change-batch"])
    moved = await orders(db, model, model.sort_order)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as holder:
        await holder.execute(order_lock(model))  # a reorder or an append in flight elsewhere
        async with sessions() as undoing:
            await undoing.execute(text("SET LOCAL lock_timeout = '200ms'"))
            with pytest.raises(DBAPIError, match="lock timeout"):
                await undo_batch(undoing, batch_id, actor="tab 2")
        assert await orders(db, model, model.sort_order) == moved  # nothing undone meanwhile
    async with sessions() as undoing:  # the holder's transaction is over: the lock is free
        await undo_batch(undoing, batch_id, actor="tab 2")
    assert await orders(db, model, model.sort_order) == [(swapped[1], 0), (swapped[0], 1)]


async def test_an_undo_outside_the_ordered_lists_takes_no_order_lock(auth_client, db, engine):
    category = SpendingCategory(name="Food", slug="food", sort_order=0)
    db.add(category)
    await db.commit()
    resp = await auth_client.put(
        f"{API}/spending/categories/{category.id}/budget",
        json={"amount": "400.00", "effective_month": "2026-09-01"},
    )
    assert resp.status_code == 200, resp.text
    [batch_id] = set((await db.execute(select(ChangeLog.batch_id))).scalars())
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as holder:
        for model in (Account, SpendingCategory):
            await holder.execute(order_lock(model))
        async with sessions() as undoing:
            await undoing.execute(text("SET LOCAL lock_timeout = '200ms'"))
            await undo_batch(undoing, batch_id, actor="tab 2")  # a budget row moves no order
