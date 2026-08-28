"""portfolio_accounts: the label registry every position row points at."""

from sqlalchemy import select

from app.models import Person, PortfolioAccount
from app.services.portfolio_accounts import resolve_portfolio_account


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
