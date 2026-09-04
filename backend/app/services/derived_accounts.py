"""Parent accounts whose balance IS the sum of their components (2026-09-04 honest-numbers
spec §5).

Shared on purpose. The balances PUT derives with this before it writes, and lane A's
`check_parent_component_drift` reads stored snapshots through the same function, so "what
the parent should be" has exactly one definition and the health card can never disagree
with the save that produced the row. Pure — no session, no query — so both callers pass
rows they already hold.

Production's shape (census 2026-09-04): Fidelity Traditional 401(k) has 3 components and
Fidelity Roth 401(k) has 2, and both totals have been typed by hand for 37 months.
"""

from collections.abc import Iterable, Mapping
from decimal import Decimal

from app.models import Account


def derived_parent_balances(
    accounts: Iterable[Account],
    balances_by_account_id: Mapping[int, Decimal],
) -> dict[int, Decimal]:
    """`{parent account id: the sum of its components' balances}` over the components
    PRESENT in `balances_by_account_id`.

    A component is `is_component` AND linked to a parent. `is_component` alone is the key
    every rollup excludes on (services/net_worth_calc), so a linked-but-unflagged child
    still counts on its own — summing it into its parent as well would double-count it.

    A parent with no component value in the mapping is ABSENT from the result, not zero: a
    month nobody recorded a component for has nothing to derive from, and a 0.00 written
    there would erase a hand-typed history value (spec §6 — the drift check reports, never
    rewrites).

    One level only. The sheet nests exactly one (the two Fidelity 401(k)s) and a
    grandparent would need its children resolved first; a deeper chain is left to the drift
    rule rather than guessed at here.
    """
    by_id = {account.id: account for account in accounts}
    totals: dict[int, Decimal] = {}
    for account_id, balance in balances_by_account_id.items():
        account = by_id.get(account_id)
        if account is None or not account.is_component:
            continue
        parent_id = account.parent_account_id
        if parent_id is None or parent_id not in by_id:
            continue  # unlinked component, or a parent this caller cannot name
        totals[parent_id] = totals.get(parent_id, Decimal("0")) + balance
    return totals
