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
