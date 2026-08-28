"""portfolio_accounts: the label registry every position row points at."""

from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.models import DividendPayment, Person, PortfolioAccount, PositionTransaction, Security
from app.services.portfolio_accounts import portfolio_owner_clause, resolve_portfolio_account
from app.services.portfolio_calc import fold_transactions, load_portfolio


async def test_resolve_creates_one_row_per_label_owned_by_the_primary(db):
    db.add_all([Person(name="Me", is_primary=True), Person(name="Sam", is_primary=False)])
    await db.commit()
    me = (await db.execute(select(Person).where(Person.is_primary))).scalar_one()

    first = await resolve_portfolio_account(db, "RH Taxable")
    again = await resolve_portfolio_account(db, "  RH Taxable  ")  # stripped, like the router
    other = await resolve_portfolio_account(db, "Fidelity Taxable")
    await db.commit()

    assert again.id == first.id  # get-or-create: one row per label, never two
    assert first.person_id == me.id  # a NEW label defaults to the primary person
    assert other.person_id == me.id
    labels = (
        (await db.execute(select(PortfolioAccount.label).order_by(PortfolioAccount.label)))
        .scalars()
        .all()
    )
    assert labels == ["Fidelity Taxable", "RH Taxable"]


async def test_resolve_never_rewrites_a_retagged_owner(db):
    """Settings re-tags a label to the partner; every later writer must leave it alone —
    this is what makes a sheet re-import safe (2026-08-28 spec §8)."""
    db.add_all([Person(name="Me", is_primary=True), Person(name="Sam", is_primary=False)])
    await db.commit()
    sam = (await db.execute(select(Person).where(Person.name == "Sam"))).scalar_one()

    account = await resolve_portfolio_account(db, "Sam Brokerage")
    account.person_id = sam.id
    await db.commit()

    again = await resolve_portfolio_account(db, "Sam Brokerage")
    await db.commit()
    assert again.id == account.id
    assert again.person_id == sam.id  # get-or-create GETS; it does not re-own


async def test_resolve_on_a_peopleless_database_leaves_the_owner_null(db):
    """A create_all database (pytest, a scratch dev box) has no roster — NULL is exactly
    the pre-ownership spelling, not an error."""
    account = await resolve_portfolio_account(db, "Solo")
    await db.commit()
    assert account.person_id is None


TRANSACTIONS = "/api/v1/portfolio/transactions"
DIVIDENDS = "/api/v1/portfolio/dividends"
SECURITIES = "/api/v1/portfolio/securities"


async def _security(auth_client) -> dict:
    resp = await auth_client.post(
        SECURITIES, json={"ticker": "VOO", "name": "Vanguard S&P 500 ETF", "holding_type": "etf"}
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_transaction_label_round_trips_and_becomes_an_owned_row(auth_client, db):
    """The wire is unchanged — `account` in, `account` out — but the label is now a row."""
    db.add(Person(name="Me", is_primary=True))
    await db.commit()
    me = (await db.execute(select(Person).where(Person.is_primary))).scalar_one()
    security = await _security(auth_client)

    created = await auth_client.post(
        TRANSACTIONS,
        json={
            "security_id": security["id"],
            "account": " Fidelity Taxable ",
            "type": "buy",
            "shares": "5",
            "price": "100",
        },
    )
    assert created.status_code == 201, created.text
    assert created.json()["account"] == "Fidelity Taxable"  # trimmed, exactly as before
    assert (await auth_client.get(TRANSACTIONS)).json()[0]["account"] == "Fidelity Taxable"

    rows = (await db.execute(select(PortfolioAccount))).scalars().all()
    assert [(r.label, r.person_id) for r in rows] == [("Fidelity Taxable", me.id)]


async def test_two_transactions_on_one_label_share_a_single_account_row(auth_client, db):
    security = await _security(auth_client)
    for shares in ("1", "2"):
        resp = await auth_client.post(
            TRANSACTIONS,
            json={
                "security_id": security["id"],
                "account": "RH Taxable",
                "type": "buy",
                "shares": shares,
                "price": "10",
            },
        )
        assert resp.status_code == 201, resp.text
    labels = (await db.execute(select(PortfolioAccount.label))).scalars().all()
    assert labels == ["RH Taxable"]  # get-or-create, not one row per transaction


async def test_patching_a_transaction_account_repoints_the_fk(auth_client, db):
    security = await _security(auth_client)
    created = (
        await auth_client.post(
            TRANSACTIONS,
            json={
                "security_id": security["id"],
                "account": "RH Taxable",
                "type": "buy",
                "shares": "1",
                "price": "10",
            },
        )
    ).json()
    moved = await auth_client.patch(f"{TRANSACTIONS}/{created['id']}", json={"account": " Moved "})
    assert moved.status_code == 200, moved.text
    assert moved.json()["account"] == "Moved"
    labels = (
        (await db.execute(select(PortfolioAccount.label).order_by(PortfolioAccount.label)))
        .scalars()
        .all()
    )
    assert labels == ["Moved", "RH Taxable"]  # the old label survives; the row moved


async def test_dividend_account_stays_optional(auth_client, db):
    security = await _security(auth_client)
    without = await auth_client.post(
        DIVIDENDS, json={"security_id": security["id"], "pay_date": "2026-06-30", "amount": "5"}
    )
    assert without.status_code == 201, without.text
    assert without.json()["account"] is None  # unattributed, exactly as before
    blank = await auth_client.post(
        DIVIDENDS,
        json={
            "security_id": security["id"],
            "account": "   ",
            "pay_date": "2026-06-30",
            "amount": "5",
        },
    )
    assert blank.status_code == 201, blank.text
    assert blank.json()["account"] is None  # whitespace collapses to None, never a '' row
    assert (await db.execute(select(PortfolioAccount))).scalars().all() == []


async def _owned_book(db):
    """Mine 10 sh, Theirs 5 sh, Ours 2 sh of one security, plus three dividends: one on
    Mine, one on Ours, one with NO account at all."""
    me, sam = Person(name="Me", is_primary=True), Person(name="Sam", is_primary=False)
    db.add_all([me, sam])
    await db.flush()
    mine = PortfolioAccount(label="Mine", person_id=me.id)
    theirs = PortfolioAccount(label="Theirs", person_id=sam.id)
    ours = PortfolioAccount(label="Ours", person_id=None)
    security = Security(ticker="VOO", name="Vanguard", holding_type="etf")
    db.add_all([mine, theirs, ours, security])
    await db.flush()
    db.add_all(
        [
            PositionTransaction(
                security_id=security.id,
                portfolio_account=mine,
                type="buy",
                shares=Decimal("10"),
                price=Decimal("50"),
                sort_index=10,
            ),
            PositionTransaction(
                security_id=security.id,
                portfolio_account=theirs,
                type="buy",
                shares=Decimal("5"),
                price=Decimal("60"),
                sort_index=20,
            ),
            PositionTransaction(
                security_id=security.id,
                portfolio_account=ours,
                type="buy",
                shares=Decimal("2"),
                price=Decimal("40"),
                sort_index=30,
            ),
            DividendPayment(
                security_id=security.id,
                portfolio_account=mine,
                pay_date=date(2026, 6, 30),
                amount=Decimal("10.00"),
            ),
            DividendPayment(
                security_id=security.id,
                portfolio_account=ours,
                pay_date=date(2026, 6, 30),
                amount=Decimal("2.00"),
            ),
            DividendPayment(
                security_id=security.id,
                portfolio_account=None,
                pay_date=date(2026, 6, 30),
                amount=Decimal("99.00"),
            ),
        ]
    )
    await db.commit()
    return me, sam


async def test_load_portfolio_scopes_transactions_and_dividends(db):
    me, sam = await _owned_book(db)

    _s, txns, _l, _h, dividends = await load_portfolio(db)
    assert sorted(t.account for t in txns) == ["Mine", "Ours", "Theirs"]
    assert sum(d.amount for d in dividends) == Decimal("111.00")  # household sees all three

    _s, txns, _l, _h, dividends = await load_portfolio(
        db, owner_filter=portfolio_owner_clause(str(me.id))
    )
    assert sorted(t.account for t in txns) == ["Mine", "Ours"]  # mine AND ours, never theirs
    assert sum(d.amount for d in dividends) == Decimal("12.00")  # the account-less 99 is out

    _s, txns, _l, _h, dividends = await load_portfolio(
        db, owner_filter=portfolio_owner_clause(str(sam.id))
    )
    assert sorted(t.account for t in txns) == ["Ours", "Theirs"]

    _s, txns, _l, _h, dividends = await load_portfolio(
        db, owner_filter=portfolio_owner_clause("joint")
    )
    assert [t.account for t in txns] == ["Ours"]  # joint = NULL-owned only
    assert sum(d.amount for d in dividends) == Decimal("2.00")


async def test_scoped_fold_keeps_the_label_key(db):
    me, _sam = await _owned_book(db)
    _s, txns, _l, _h, _d = await load_portfolio(db, owner_filter=portfolio_owner_clause(str(me.id)))
    positions = fold_transactions(txns)
    assert sorted(positions) == [(1, "Mine"), (1, "Ours")]
    assert positions[(1, "Mine")].shares == Decimal("10")


def test_portfolio_owner_clause_rejects_anything_that_is_not_an_id_or_joint():
    for bad in ("nobody", "-1", "0", "1.5", "99999999999", "", "²"):
        with pytest.raises(ValueError):
            portfolio_owner_clause(bad)


ACCOUNTS = "/api/v1/portfolio/accounts"


async def test_list_accounts_is_label_ordered_with_owners(auth_client, db):
    me, sam = await _owned_book(db)
    body = (await auth_client.get(ACCOUNTS)).json()
    assert [(a["label"], a["person_id"]) for a in body] == [
        ("Mine", me.id),
        ("Ours", None),  # NULL = joint; the client owns that word, not the server
        ("Theirs", sam.id),
    ]
    assert set(body[0]) == {"id", "label", "person_id"}


async def _mine(db) -> PortfolioAccount:
    return (
        await db.execute(select(PortfolioAccount).where(PortfolioAccount.label == "Mine"))
    ).scalar_one()


async def test_patch_account_retags_and_unowns(auth_client, db):
    _me, sam = await _owned_book(db)
    mine = await _mine(db)

    retagged = await auth_client.patch(f"{ACCOUNTS}/{mine.id}", json={"person_id": sam.id})
    assert retagged.status_code == 200, retagged.text
    assert retagged.json() == {"id": mine.id, "label": "Mine", "person_id": sam.id}

    # Explicit null is a REAL write here: it is how an account becomes joint.
    joint = await auth_client.patch(f"{ACCOUNTS}/{mine.id}", json={"person_id": None})
    assert joint.status_code == 200, joint.text
    assert joint.json()["person_id"] is None

    noop = await auth_client.patch(f"{ACCOUNTS}/{mine.id}", json={})
    assert noop.status_code == 200
    assert noop.json()["person_id"] is None


async def test_patch_account_rejects_unknown_people_labels_and_ids(auth_client, db):
    await _owned_book(db)
    mine = await _mine(db)

    unknown = await auth_client.patch(f"{ACCOUNTS}/{mine.id}", json={"person_id": 9999})
    assert unknown.status_code == 422
    assert "unknown person_id" in unknown.json()["detail"]

    # Labels are the positions' identity this batch — a rename is a loud 422, never a
    # silently dropped key.
    rename = await auth_client.patch(f"{ACCOUNTS}/{mine.id}", json={"label": "Renamed"})
    assert rename.status_code == 422

    assert (await auth_client.patch(f"{ACCOUNTS}/999", json={"person_id": None})).status_code == 404


async def test_portfolio_accounts_require_auth(client):
    assert (await client.get(ACCOUNTS)).status_code == 401
    assert (await client.patch(f"{ACCOUNTS}/1", json={"person_id": None})).status_code == 401
