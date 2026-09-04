from decimal import Decimal

from app.models import Account
from app.services.derived_accounts import derived_parent_balances


def account(
    account_id: int,
    *,
    component: bool = False,
    parent: int | None = None,
    name: str | None = None,
    active: bool = True,
) -> Account:
    # mapped_column(default=...) only fires at flush, so every flag is passed explicitly:
    # an unset is_component would be None here, not False, and could hide a real bug.
    return Account(
        id=account_id,
        name=name or f"Account {account_id}",
        slug=f"account-{account_id}",
        group="pre_tax",
        sort_order=account_id,
        is_active=active,
        is_component=component,
        parent_account_id=parent,
    )


def test_parent_is_the_sum_of_the_components_present():
    parent = account(1, name="Fidelity Traditional 401(k)")
    first = account(2, component=True, parent=1)
    second = account(3, component=True, parent=1)
    result = derived_parent_balances(
        [parent, first, second],
        {2: Decimal("100.00"), 3: Decimal("50.50")},
    )
    assert result == {1: Decimal("150.50")}
    assert str(result[1]) == "150.50"  # Decimal in, Decimal out, 2dp preserved


def test_a_component_missing_from_the_mapping_contributes_nothing():
    parent = account(1)
    first = account(2, component=True, parent=1)
    second = account(3, component=True, parent=1)
    assert derived_parent_balances([parent, first, second], {2: Decimal("100.00")}) == {
        1: Decimal("100.00")
    }


def test_a_parent_with_no_component_value_is_absent_not_zero():
    # A month nobody recorded a component for has nothing to derive from; returning 0 would
    # let a caller overwrite a hand-typed history value with a fake zero.
    parent = account(1)
    child = account(2, component=True, parent=1)
    other = account(3)
    assert derived_parent_balances([parent, child, other], {3: Decimal("42.00")}) == {}
    assert derived_parent_balances([parent, child, other], {}) == {}


def test_a_linked_child_that_is_not_flagged_is_not_summed():
    # is_component alone is the rollup key (services/net_worth_calc): an unflagged child
    # still counts on its own in every total, so summing it into the parent double-counts.
    parent = account(1)
    unflagged = account(2, component=False, parent=1)
    flagged = account(3, component=True, parent=1)
    assert derived_parent_balances(
        [parent, unflagged, flagged], {2: Decimal("100.00"), 3: Decimal("5.00")}
    ) == {1: Decimal("5.00")}


def test_an_inactive_component_with_a_value_still_counts():
    # is_active is an ENTRY rule (the wizard stops offering the row), never a money rule:
    # a deactivated bucket's stored balance is still in the parent's total that month, so
    # dropping it here would understate the parent by money that is still on the books.
    parent = account(1)
    live = account(2, component=True, parent=1)
    closed = account(3, component=True, parent=1, active=False)
    assert derived_parent_balances(
        [parent, live, closed], {2: Decimal("100.00"), 3: Decimal("50.50")}
    ) == {1: Decimal("150.50")}


def test_a_flagged_component_with_no_parent_link_is_ignored():
    lone = account(2, component=True, parent=None)
    assert derived_parent_balances([lone], {2: Decimal("100.00")}) == {}


def test_a_component_whose_parent_is_not_in_the_account_list_is_ignored():
    # parent_account_id is ON DELETE SET NULL, but a caller may also hand over a filtered
    # list; a parent we cannot name is a parent we must not write.
    orphan = account(2, component=True, parent=99)
    assert derived_parent_balances([orphan], {2: Decimal("100.00")}) == {}


def test_negative_components_and_several_parents():
    trad = account(1, name="Trad")
    roth = account(2, name="Roth")
    result = derived_parent_balances(
        [
            trad,
            roth,
            account(3, component=True, parent=1),
            account(4, component=True, parent=1),
            account(5, component=True, parent=2),
        ],
        {
            3: Decimal("1234.56"),
            4: Decimal("-234.56"),
            5: Decimal("0.00"),
        },
    )
    assert result == {1: Decimal("1000.00"), 2: Decimal("0.00")}
    assert str(result[1]) == "1000.00"


def test_an_unknown_account_id_in_the_mapping_is_ignored():
    parent = account(1)
    child = account(2, component=True, parent=1)
    assert derived_parent_balances([parent, child], {2: Decimal("7.00"), 404: Decimal("9.00")}) == {
        1: Decimal("7.00")
    }
