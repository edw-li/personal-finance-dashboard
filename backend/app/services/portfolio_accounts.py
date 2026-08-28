"""Portfolio-account resolution — the one door a free-text label walks through.

`account` stopped being a column on 2026-08-28 (spec §3 item 1): a transaction or dividend
points at a `portfolio_accounts` row, and the label the wire still carries is that row's.
Every writer — the ledger router, the importer, anything later — resolves through here, so
a label can never exist twice and a re-tagged owner can never be silently overwritten.
"""

from sqlalchemy import ColumnElement, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import PortfolioAccount
from app.services.ownership import parse_owner
from app.services.people import load_people, primary_person


async def resolve_portfolio_account(db: AsyncSession, label: str) -> PortfolioAccount:
    """Get-or-create the row for `label` (stripped, exactly as the router always stored it).

    A NEW label defaults to the PRIMARY person — the migration's backfill rule, continued
    for labels that appear later; a database with no roster (create_all tests, a scratch
    dev box) leaves person_id NULL, which is the pre-ownership spelling. An EXISTING row is
    returned untouched: a label the user re-tagged to their partner in Settings stays
    theirs through every re-import (spec §8).

    Flushes, so the row has an id for the caller and is findable by the next call inside
    the same run (the importer resolves many labels before one commit).
    """
    cleaned = label.strip()
    existing = (
        (await db.execute(select(PortfolioAccount).where(PortfolioAccount.label == cleaned)))
        .scalars()
        .first()
    )
    if existing is not None:
        return existing
    primary = primary_person(await load_people(db))
    account = PortfolioAccount(label=cleaned, person_id=None if primary is None else primary.id)
    db.add(account)
    await db.flush()
    return account


def portfolio_owner_clause(owner: str) -> ColumnElement[bool]:
    """THE definition of portfolio ownership — the net-worth grammar applied to portfolio
    accounts (net_worth_calc.owner_clause is its twin; both parse through
    services.ownership.parse_owner).

    `joint` selects the NULL-owned accounts only; a person id selects that person's accounts
    PLUS the joint ones — "mine and ours", the same inclusive person view the net-worth
    pages use. Raises ValueError on anything else so the router answers 422.
    """
    person_id = parse_owner(owner)
    if person_id is None:
        return PortfolioAccount.person_id.is_(None)
    return or_(PortfolioAccount.person_id == person_id, PortfolioAccount.person_id.is_(None))
