"""PUT /portfolio/transactions/order — the replay order (2026-09-23 drag-to-reorder spec
§3.2, §8.3, §9). Change-logged since 2026-09-25 (polish spec §6.1; the batch itself is pinned
in test_changelog_portfolio.py), so these tests prove the fold report, the scope and the
renumbering."""

from decimal import Decimal

import pytest
from sqlalchemy import select

from app.models import ChangeLog, Person, PortfolioAccount, PositionTransaction, Security
from tests.ordering_helpers import flushed_updates

TRANSACTIONS = "/api/v1/portfolio/transactions"
ORDER = f"{TRANSACTIONS}/order"
STALE = "The transactions changed since this list was loaded — nothing was moved."


async def seed_book(db):
    """Two people, three labels (Mine = me, Theirs = Sam, Ours = joint), two securities.
    Returns (me, sam, securities by ticker, accounts by label)."""
    me, sam = Person(name="Me", is_primary=True), Person(name="Sam", is_primary=False)
    voo = Security(ticker="VOO", name="Vanguard S&P 500 ETF", holding_type="etf")
    nvda = Security(ticker="NVDA", name="NVIDIA", holding_type="stock")
    db.add_all([me, sam, voo, nvda])
    await db.flush()
    accounts = {
        "Mine": PortfolioAccount(label="Mine", person_id=me.id),
        "Theirs": PortfolioAccount(label="Theirs", person_id=sam.id),
        "Ours": PortfolioAccount(label="Ours", person_id=None),
    }
    db.add_all(accounts.values())
    await db.flush()
    return me, sam, {"VOO": voo, "NVDA": nvda}, accounts


def txn(security, account, type_, sort_index, shares="0", price="0", split_factor=None):
    return PositionTransaction(
        security_id=security.id,
        portfolio_account=account,
        type=type_,
        shares=Decimal(shares),
        price=Decimal(price),
        split_factor=None if split_factor is None else Decimal(split_factor),
        sort_index=sort_index,
        source="ui",
    )


async def add_rows(db, *rows) -> list[int]:
    db.add_all(rows)
    await db.commit()
    return [row.id for row in rows]


async def replay_order(db) -> list[tuple[int, int]]:
    rows = await db.execute(
        select(PositionTransaction.id, PositionTransaction.sort_index).order_by(
            PositionTransaction.sort_index, PositionTransaction.id
        )
    )
    return [(row.id, row.sort_index) for row in rows]


async def test_reorder_requires_auth(client):
    assert (await client.put(ORDER, json={"ids": [1]})).status_code == 401


async def test_a_cross_holding_move_changes_no_figures_and_spaces_the_ledger(auth_client, db):
    _, _, sec, acct = await seed_book(db)
    t1, t2, t3 = await add_rows(
        db,
        txn(sec["VOO"], acct["Mine"], "buy", 3, "10", "50"),
        txn(sec["NVDA"], acct["Mine"], "buy", 7, "1", "100"),
        txn(sec["VOO"], acct["Ours"], "buy", 7, "2", "40"),
    )
    resp = await auth_client.put(ORDER, json={"ids": [t2, t3, t1]})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["changed_positions"] == []  # three holdings, one row each: nothing re-folds
    assert [(t["id"], t["sort_index"]) for t in body["transactions"]] == [
        (t2, 10),
        (t3, 20),
        (t1, 30),
    ]
    assert await replay_order(db) == [(t2, 10), (t3, 20), (t1, 30)]  # evenly spaced
    listed = (await auth_client.get(TRANSACTIONS)).json()
    assert [t["id"] for t in listed] == [t2, t3, t1]  # the follow-up GET agrees
    # Logged (polish spec §6.1): one update per renumbered row, in ONE batch the header names.
    logged = (await db.execute(select(ChangeLog).order_by(ChangeLog.id))).scalars().all()
    assert [(r.pk["id"], r.before["sort_index"], r.after["sort_index"]) for r in logged] == [
        (t2, 7, 10),
        (t3, 7, 20),
        (t1, 3, 30),
    ]
    assert {str(r.batch_id) for r in logged} == {resp.headers["x-change-batch"]}


async def test_an_owner_scoped_reorder_keeps_hidden_rows_in_their_slots(auth_client, db):
    me, _, sec, acct = await seed_book(db)
    t1, t2, t3, t4, t5 = await add_rows(
        db,
        txn(sec["VOO"], acct["Mine"], "buy", 10, "10", "50"),
        txn(sec["VOO"], acct["Theirs"], "buy", 20, "5", "60"),
        txn(sec["VOO"], acct["Ours"], "buy", 30, "2", "40"),
        txn(sec["VOO"], acct["Theirs"], "sell", 40, "2", "100"),
        txn(sec["NVDA"], acct["Mine"], "buy", 50, "1", "100"),
    )
    # My scope shows Mine + Ours: t1, t3, t5 in slots 0, 2, 4. Sam's t2 and t4 are hidden.
    resp = await auth_client.put(f"{ORDER}?owner={me.id}", json={"ids": [t5, t1, t3]})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert [t["id"] for t in body["transactions"]] == [t5, t1, t3]  # the visible rows only
    assert body["changed_positions"] == []
    # The visible rows filled slots 0, 2, 4 in their new order; t2 and t4 never moved.
    assert await replay_order(db) == [(t5, 10), (t2, 20), (t1, 30), (t4, 40), (t3, 50)]
    scoped = (await auth_client.get(f"{TRANSACTIONS}?owner={me.id}")).json()
    assert [t["id"] for t in scoped] == [t5, t1, t3]


async def test_a_sell_moved_above_its_buy_reports_the_new_figures_and_warning(auth_client, db):
    _, _, sec, acct = await seed_book(db)
    buy, sell = await add_rows(
        db,
        txn(sec["VOO"], acct["Mine"], "buy", 10, "10", "50"),
        txn(sec["VOO"], acct["Mine"], "sell", 20, "4", "80"),
    )
    resp = await auth_client.put(ORDER, json={"ids": [sell, buy]})
    assert resp.status_code == 200, resp.text
    # Before: 6 shares, basis 500 - 4 x 50 = 300, gain 4 x (80 - 50) = 120. After: the sell
    # meets no shares (avg 0, gain 320, basis reset), then the buy lands in full (basis 500).
    assert resp.json()["changed_positions"] == [
        {
            "security_id": sec["VOO"].id,
            "ticker": "VOO",
            "account": "Mine",
            "shares_before": "6.000000",
            "shares_after": "6.000000",
            "cost_basis_before": "300.00",
            "cost_basis_after": "500.00",
            "realized_gl_before": "120.00",
            "realized_gl_after": "320.00",
            "warnings_added": [f"txn {sell}: sell with no held shares"],
        }
    ]


async def test_a_split_moved_before_its_buy_reports_the_share_change(auth_client, db):
    _, _, sec, acct = await seed_book(db)
    buy, split = await add_rows(
        db,
        txn(sec["NVDA"], acct["Mine"], "buy", 10, "10", "100"),
        txn(sec["NVDA"], acct["Mine"], "split", 20, split_factor="2"),
    )
    resp = await auth_client.put(ORDER, json={"ids": [split, buy]})
    assert resp.status_code == 200, resp.text
    [change] = resp.json()["changed_positions"]
    assert (change["ticker"], change["account"]) == ("NVDA", "Mine")
    assert (change["shares_before"], change["shares_after"]) == ("20.000000", "10.000000")
    assert (change["cost_basis_before"], change["cost_basis_after"]) == ("1000.00", "1000.00")
    assert change["warnings_added"] == []


async def test_changed_positions_are_ordered_by_ticker_then_account(auth_client, db):
    _, _, sec, acct = await seed_book(db)
    ids = await add_rows(
        db,
        txn(sec["VOO"], acct["Ours"], "buy", 10, "1", "10"),
        txn(sec["VOO"], acct["Ours"], "sell", 20, "1", "20"),
        txn(sec["NVDA"], acct["Mine"], "buy", 30, "1", "10"),
        txn(sec["NVDA"], acct["Mine"], "sell", 40, "1", "20"),
        txn(sec["VOO"], acct["Mine"], "buy", 50, "1", "10"),
        txn(sec["VOO"], acct["Mine"], "sell", 60, "1", "20"),
    )
    # Every sell jumps above its own buy: three positions re-fold.
    new = [ids[1], ids[0], ids[3], ids[2], ids[5], ids[4]]
    resp = await auth_client.put(ORDER, json={"ids": new})
    assert resp.status_code == 200, resp.text
    assert [(c["ticker"], c["account"]) for c in resp.json()["changed_positions"]] == [
        ("NVDA", "Mine"),
        ("VOO", "Mine"),
        ("VOO", "Ours"),
    ]


async def test_an_unchanged_order_writes_nothing(auth_client, db):
    _, _, sec, acct = await seed_book(db)
    ids = await add_rows(
        db,
        txn(sec["VOO"], acct["Mine"], "buy", 3, "1", "10"),
        txn(sec["VOO"], acct["Mine"], "buy", 9, "1", "10"),
    )
    with flushed_updates(db, PositionTransaction) as written:
        resp = await auth_client.put(ORDER, json={"ids": ids})
    assert resp.status_code == 200, resp.text
    # Nothing was even SET: a set attribute is dirty until a flush, and no flush may come.
    assert not db.dirty
    assert resp.json()["changed_positions"] == []
    assert [t["sort_index"] for t in resp.json()["transactions"]] == [3, 9]  # not respaced
    assert written == set()


async def test_only_rows_whose_number_moves_are_written(auth_client, db):
    _, _, sec, acct = await seed_book(db)
    t1, t2, t3, t4 = await add_rows(
        db,
        txn(sec["VOO"], acct["Mine"], "buy", 10, "1", "10"),
        txn(sec["VOO"], acct["Ours"], "buy", 20, "1", "10"),
        txn(sec["NVDA"], acct["Mine"], "buy", 30, "1", "10"),
        txn(sec["NVDA"], acct["Ours"], "buy", 40, "1", "10"),
    )
    with flushed_updates(db, PositionTransaction) as written:
        resp = await auth_client.put(ORDER, json={"ids": [t1, t2, t4, t3]})
    assert resp.status_code == 200, resp.text
    assert written == {t3, t4}


@pytest.mark.parametrize("shape", ["missing", "extra", "a hidden row"])
async def test_a_stale_list_409s_with_the_sentence_and_moves_nothing(auth_client, db, shape):
    me, _, sec, acct = await seed_book(db)
    t1, t2, t3 = await add_rows(
        db,
        txn(sec["VOO"], acct["Mine"], "buy", 10, "1", "10"),
        txn(sec["VOO"], acct["Theirs"], "buy", 20, "1", "10"),
        txn(sec["VOO"], acct["Ours"], "buy", 30, "1", "10"),
    )
    before = await replay_order(db)
    # In my scope the page shows t1 and t3; t2 (Sam's) is hidden and may not be sent.
    body = {"missing": [t3], "extra": [t3, t1, 999], "a hidden row": [t3, t2, t1]}[shape]
    resp = await auth_client.put(f"{ORDER}?owner={me.id}", json={"ids": body})
    assert resp.status_code == 409
    assert resp.json()["detail"] == STALE
    assert await replay_order(db) == before


async def test_a_repeated_id_422s_naming_it(auth_client, db):
    _, _, sec, acct = await seed_book(db)
    t1, t2 = await add_rows(
        db,
        txn(sec["VOO"], acct["Mine"], "buy", 10, "1", "10"),
        txn(sec["VOO"], acct["Mine"], "buy", 20, "1", "10"),
    )
    resp = await auth_client.put(ORDER, json={"ids": [t2, t1, t2]})
    assert resp.status_code == 422
    assert resp.json()["detail"] == f"ids lists {t2} more than once"


async def test_a_garbage_owner_422s_like_the_list(auth_client, db):
    await seed_book(db)
    await db.commit()
    for bad in ("nobody", "-1", "0"):
        resp = await auth_client.put(f"{ORDER}?owner={bad}", json={"ids": [1]})
        assert resp.status_code == 422, bad
