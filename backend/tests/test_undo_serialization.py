"""Undos run one at a time (2026-09-25 polish L3c, review fix): undo_batch takes one global
advisory lock (changelog.UNDO_LOCK) as its FIRST statement and holds it to its commit. Each Undo
reads the undo runs and the later changes, then writes a run of its own; two in flight would both
pass on what the other had not committed yet. Proven on a table no other lock serializes — card
credits are neither an ordered list nor a month-review input — with a third session holding the
row, so that without the lock both Undos would pass their checks and queue on the row together."""

import asyncio
from decimal import Decimal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.models import CardCredit, CreditCard, LifecycleRun
from app.services.changelog import ALREADY_UNDONE, OVERLAP_REFUSAL, UndoRefused, undo_batch
from tests.exact_undo import undo
from tests.ordering_helpers import (
    backend_pid,
    first_position,
    lock_position,
    recorded_sql,
    until_blocked,
)

CARDS = "/api/v1/credit-cards"


async def seed_credit(db) -> int:
    """A card with one credit, labelled A."""
    card = CreditCard(
        name="Venture X",
        slug="venture-x",
        annual_fee=Decimal("395.00"),
        rewards_currency="miles",
        point_value_cents=Decimal("1.0000"),
    )
    db.add(card)
    await db.flush()
    credit = CardCredit(card_id=card.id, label="A", annual_value=Decimal("100"))
    db.add(credit)
    await db.commit()
    return credit.id


async def relabel(auth_client, credit_id: int, label: str) -> UUID:
    """One logged edit of the credit; its batch."""
    resp = await auth_client.patch(
        f"{CARDS}/credits/{credit_id}", json={"label": label, "annual_value": "100"}
    )
    assert resp.status_code == 200, resp.text
    return UUID(resp.headers["x-change-batch"])


async def label_now(db, credit_id: int) -> str:
    return (
        await db.execute(select(CardCredit.label).where(CardCredit.id == credit_id))
    ).scalar_one()


async def two_tabs(engine, credit_id: int, first: UUID, second: UUID) -> list:
    """Undo `first` in one tab and `second` in another while a third session holds the credit's
    row: `first` gets as far as its replay and waits at the row, THEN `second` starts and waits
    wherever it must. Releasing the row lets both finish; their results (or refusals) come back
    in that order."""
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as holder, sessions() as tab_1, sessions() as tab_2:
        # Another write in flight on the row.
        await holder.execute(
            select(CardCredit.id).where(CardCredit.id == credit_id).with_for_update()
        )
        pid_1, pid_2 = await backend_pid(tab_1), await backend_pid(tab_2)
        tasks = [asyncio.create_task(undo_batch(tab_1, first, actor="tab 1"))]
        try:
            await until_blocked(engine, pid_1, tasks[0])
            tasks.append(asyncio.create_task(undo_batch(tab_2, second, actor="tab 2")))
            await until_blocked(engine, pid_2, tasks[1])
        finally:
            await holder.rollback()
            results = await asyncio.gather(*tasks, return_exceptions=True)
    return results


async def test_a_second_undo_of_one_batch_waits_and_is_refused_as_already_undone(
    auth_client, db, engine
):
    """Two tabs undo the same edit at once. Without the lock both passed the already-undone and
    overlap checks, both replayed and both committed: two undo runs claimed one batch, and the
    chains read from them went wrong (an older edit's Undo could then write over a redo). With
    it, the second waits for the first to commit, then reads its run and refuses."""
    credit_id = await seed_credit(db)
    await relabel(auth_client, credit_id, "B")
    later = await relabel(auth_client, credit_id, "C")
    done, again = await two_tabs(engine, credit_id, later, later)
    assert isinstance(done, UUID), done
    assert isinstance(again, UndoRefused) and again.detail == ALREADY_UNDONE, again
    runs = (
        (await db.execute(select(LifecycleRun.report).where(LifecycleRun.kind == "undo")))
        .scalars()
        .all()
    )
    assert [run["undid"] for run in runs] == [str(later)]  # one claim: each batch undone once
    assert await label_now(db, credit_id) == "B"


async def test_an_undo_waits_for_a_redo_in_flight_and_then_refuses_over_it(auth_client, db, engine):
    """T (A→B), then X (B→C), then X undone: the row is back at B. Now one tab redoes X while
    another undoes T — each allowed alone, since X and its Undo cancel for T. Without the lock
    both passed their checks, both committed, and the row ended at A while the log said X stood
    again. With it, the Undo of T waits for the redo, then sees X in force and refuses; the row
    keeps X's C."""
    credit_id = await seed_credit(db)
    older = await relabel(auth_client, credit_id, "B")
    later = await relabel(auth_client, credit_id, "C")
    unlater = await undo(auth_client, later)
    assert unlater.status_code == 200, unlater.text
    redone, refused = await two_tabs(engine, credit_id, UUID(unlater.json()["batch_id"]), older)
    assert isinstance(redone, UUID), redone
    assert isinstance(refused, UndoRefused) and refused.detail == OVERLAP_REFUSAL, refused
    assert await label_now(db, credit_id) == "C"


async def test_the_undo_lock_is_the_first_statement_an_undo_sends(auth_client, db):
    """Before the batch is read, before any list's order lock and before the month-review table
    locks — an account's create touches an ordered list and a review input, so its Undo takes
    all three kinds."""
    created = await auth_client.post(
        "/api/v1/net-worth/accounts", json={"name": "Brokerage", "group": "taxable"}
    )
    assert created.status_code == 201, created.text
    with recorded_sql(db) as statements:
        resp = await undo(auth_client, created)
    assert resp.status_code == 200, resp.text
    taken = [
        index
        for index, (sql, parameters) in enumerate(statements)
        if "pg_advisory_xact_lock" in sql and "undo" in (parameters or ())
    ]
    assert taken, "the undo lock was never taken"
    assert taken[0] < first_position(statements, "FROM change_log")
    assert taken[0] < lock_position(statements, "accounts")
    assert taken[0] < first_position(statements, "LOCK TABLE")
