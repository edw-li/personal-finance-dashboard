"""Test-only PortfolioAccount factory.

`account` is no longer a column: a transaction or dividend points at a portfolio_accounts
row. Tests that build ORM rows by hand need a label -> row map that is stable WITHIN one
test (the same label must reuse the same instance, or two rows would collide on the unique
label) and empty BETWEEN tests (conftest's autouse reset — the db fixture TRUNCATEs, so an
instance from a previous test is a stale, half-detached trap).

The row is not added to the session on its own: SQLAlchemy's save-update cascade inserts it
with the transaction/dividend that references it. Add it explicitly (`db.add(acct("Solo"))`)
when a test wants the account row and nothing else.

Do not mix this factory and the API for the SAME label inside one test: the router's
resolve_portfolio_account queries the database, finds no pending instance, and mints a
second row.
"""

from app.models import PortfolioAccount

_ACCOUNTS: dict[str, PortfolioAccount] = {}


def acct(label: str | None, *, person_id: int | None = None) -> PortfolioAccount | None:
    """The row for `label`, created on first use in this test. None passes through, so a
    dividend's optional account stays optional."""
    if label is None:
        return None
    row = _ACCOUNTS.get(label)
    if row is None:
        row = PortfolioAccount(label=label, person_id=person_id)
        _ACCOUNTS[label] = row
    elif person_id is not None and person_id != row.person_id:
        # Production's resolve_portfolio_account NEVER re-owns an existing label; a test
        # that silently did would pin the opposite semantics. Own a label on its FIRST
        # acct() call, or PATCH through the API like a user would.
        raise AssertionError(
            f"acct({label!r}) already exists with person_id={row.person_id!r}; "
            "re-owning through the factory is forbidden — use the PATCH endpoint"
        )
    return row


def reset_accounts() -> None:
    _ACCOUNTS.clear()
