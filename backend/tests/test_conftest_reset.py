"""The db fixture's per-test reset (2026-09-23 test speed-up plan, Task 1).

TRUNCATE … RESTART IDENTITY CASCADE of all 44 tables cost ~0.5 s a test on this box (a file
swap per table). The reset that replaced it keeps TRUNCATE's observable contract for the
next test — every table empty, every sequence back at its start, committed — with one
statement: a DO block that deletes child tables first and setval()s every sequence in the
schema. TRUNCATE stays behind it as the fallback.

These tests call the helper themselves and, like every test, leave the database clean (the
db fixture's own teardown resets once more). The session is committed before each reset,
so no transaction of this test holds a lock the reset — or the TRUNCATE fallback — waits on.
The first two also assert that the FAST path did the reset: the fallback leaves the same
state behind, so "the tables are empty" alone cannot tell the two apart.
"""

from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.database import Base
from app.limit_keys import LIMIT_401K_ELECTIVE
from app.models import (
    Account,
    AccountBalance,
    ContributionLimit,
    MonthlySpending,
    NetWorthSnapshot,
    PaycheckProfile,
    Person,
    PortfolioAccount,
    PositionTransaction,
    Security,
    SpendingCategory,
    User,
    UserPreference,
)
from tests import conftest
from tests.conftest import reset_database

# The tables _seed_fk_web writes; every one must hold rows before a reset, so "empty
# afterwards" is a claim about real rows rather than about tables that were never touched.
SEEDED = {
    "users",
    "user_preferences",
    "people",
    "accounts",
    "net_worth_snapshots",
    "account_balances",
    "paycheck_profiles",
    "spending_categories",
    "monthly_spending",
    "securities",
    "portfolio_accounts",
    "position_transactions",
}


async def _seed_fk_web(db) -> None:
    """Rows across every kind of foreign key a child-first DELETE has to satisfy: RESTRICT
    (position_transactions -> portfolio_accounts, paycheck_profiles -> people), CASCADE
    (account_balances, monthly_spending, user_preferences), SET NULL (accounts/portfolio_accounts
    -> people) and the accounts self-reference (a component under its parent).

    paycheck_profiles is the one that pins the ORDER: its only foreign key is RESTRICT, so
    deleting people first fails. position_transactions cannot pin it on its own: a parent-first
    order deletes securities before portfolio_accounts, and securities' CASCADE removes the row
    before the RESTRICT check ever runs."""
    user = User(email="reset@example.com", password_hash="unused")
    owner = Person(name="Owner", is_primary=True)
    db.add_all([user, owner])
    await db.flush()
    parent = Account(name="Fidelity 401(k)", slug="fidelity-401k", group="pre_tax")
    parent.person_id = owner.id
    db.add(parent)
    await db.flush()
    component = Account(
        name="Fidelity 401(k) Roth",
        slug="fidelity-401k-roth",
        group="pre_tax",
        is_component=True,
        parent_account_id=parent.id,
        person_id=owner.id,
    )
    snapshot = NetWorthSnapshot(month=date(2026, 8, 1))
    category = SpendingCategory(name="Groceries", slug="groceries")
    security = Security(ticker="VOO", name="Vanguard 500", holding_type="etf")
    brokerage = PortfolioAccount(label="RH Taxable", person_id=owner.id)
    db.add_all(
        [
            component,
            snapshot,
            category,
            security,
            brokerage,
            UserPreference(user_id=user.id, key="theme", value="dark"),
            PaycheckProfile(
                person_id=owner.id,
                effective_date=date(2026, 1, 1),
                annual_salary=Decimal("100000"),
            ),
        ]
    )
    await db.flush()
    db.add_all(
        [
            AccountBalance(snapshot_id=snapshot.id, account_id=component.id, balance=Decimal("1")),
            MonthlySpending(month=date(2026, 8, 1), category_id=category.id, amount=Decimal("5")),
            PositionTransaction(
                security_id=security.id,
                portfolio_account=brokerage,
                type="buy",
                shares=Decimal("1"),
                price=Decimal("500"),
            ),
        ]
    )
    await db.commit()


async def _advance_with_a_rolled_back_insert(db) -> None:
    """nextval is not transactional: the insert is gone after the rollback, the sequence
    step is not. The next test may still expect id 1 in that table."""
    state = text("SELECT last_value, is_called FROM contribution_limits_id_seq")
    assert tuple((await db.execute(state)).one()) == (1, False)  # the clean-database contract
    db.add(ContributionLimit(year=2026, key=LIMIT_401K_ELECTIVE, value=Decimal("23500")))
    await db.flush()
    await db.rollback()
    assert await db.scalar(select(func.count()).select_from(ContributionLimit)) == 0
    assert tuple((await db.execute(state)).one()) == (1, True)  # advanced, rows gone
    await db.commit()  # end the read transaction the asserts above opened


async def _park_a_sequence_past_its_start(db) -> None:
    """What a snapshot restore leaves behind (lifecycle/restore.py step 5): every sequence set
    to max(id) + 1 with is_called false. pg_sequences reports last_value NULL for that state —
    the same as for a sequence nobody touched — so "reset only what was read" would miss it,
    and the next test's first finding would be id 2."""
    await db.execute(text("SELECT setval('assistant_findings_id_seq', 2, false)"))
    await db.commit()
    parked = text(
        "SELECT last_value FROM pg_sequences WHERE sequencename = 'assistant_findings_id_seq'"
    )
    assert await db.scalar(parked) is None
    await db.commit()


async def _row_counts(executor) -> dict[str, int]:
    return {
        table.name: await executor.scalar(select(func.count()).select_from(table))
        for table in Base.metadata.sorted_tables
    }


async def _sequences(executor) -> dict[str, tuple[int, int, bool]]:
    """Every sequence in the schema -> (start_value, stored last_value, is_called).
    RESTART IDENTITY's state is last_value == start_value with is_called false: the next
    nextval hands out start_value."""
    names = (
        await executor.execute(
            text(
                "SELECT sequencename, start_value FROM pg_sequences "
                "WHERE schemaname = current_schema()"
            )
        )
    ).all()
    states = {}
    for name, start in names:
        last_value, is_called = (
            await executor.execute(text(f'SELECT last_value, is_called FROM "{name}"'))
        ).one()
        states[name] = (start, last_value, is_called)
    return states


async def _assert_reset_state(executor) -> None:
    counts = await _row_counts(executor)
    assert {name: n for name, n in counts.items() if n} == {}
    sequences = await _sequences(executor)
    assert sequences, "the schema's serial ids own sequences"
    not_restarted = {
        name: state
        for name, state in sequences.items()
        if (state[1], state[2]) != (state[0], False)
    }
    assert not_restarted == {}


async def _assert_fresh_ids_start_at_one(db) -> None:
    user = User(email="fresh@example.com", password_hash="unused")
    person = Person(name="Fresh", is_primary=True)
    limit = ContributionLimit(year=2026, key=LIMIT_401K_ELECTIVE, value=Decimal("23500"))
    db.add_all([user, person, limit])
    await db.commit()
    # users/people held committed rows; contribution_limits only a rolled-back insert.
    assert (user.id, person.id, limit.id) == (1, 1, 1)


async def _seed_everything(db) -> None:
    await _seed_fk_web(db)
    await _advance_with_a_rolled_back_insert(db)
    await _park_a_sequence_past_its_start(db)
    counts = await _row_counts(db)
    assert {name for name, n in counts.items() if n} == SEEDED
    await db.commit()


async def test_reset_empties_every_table_and_restarts_ids(db, engine):
    await _seed_everything(db)

    assert await reset_database(engine), "the fast path failed and TRUNCATE did the reset"
    db.expunge_all()  # a test boundary: the next test's session starts empty

    await _assert_reset_state(db)
    await db.commit()
    await _assert_fresh_ids_start_at_one(db)


async def test_reset_is_visible_to_other_connections(db, engine):
    await _seed_everything(db)

    assert await reset_database(engine), "the fast path failed and TRUNCATE did the reset"

    # Committed, not merely done inside one connection's transaction: tests open their own
    # sessions on the shared engine (the assistant's SESSION_FACTORY, the lifecycle CLI).
    async with async_sessionmaker(engine)() as other:
        await _assert_reset_state(other)
    async with engine.connect() as raw:
        await _assert_reset_state(raw)


async def test_reset_falls_back_to_truncate(db, engine):
    await _seed_everything(db)
    # The fast statement deletes one table and then fails, as an FK cycle or a lock timeout
    # would: its transaction rolls back, so only the TRUNCATE fallback can empty the tables.
    # Patched for this one call — the function-scoped monkeypatch would outlive the db
    # fixture's own teardown reset (an autouse fixture requests it first).
    failing = (
        'DO $boom$ BEGIN DELETE FROM "account_balances"; '
        "RAISE EXCEPTION 'simulated reset failure'; END $boom$"
    )
    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(conftest, "_FAST_RESET_SQL", failing)
        with pytest.warns(UserWarning, match="simulated reset failure"):
            assert await reset_database(engine) is False
    db.expunge_all()

    await _assert_reset_state(db)
    await db.commit()
    await _assert_fresh_ids_start_at_one(db)
