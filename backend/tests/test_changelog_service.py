from datetime import date
from decimal import Decimal

from sqlalchemy import select

from app.models import Account, AccountBalance, ChangeLog, NetWorthSnapshot
from app.services.changelog import (
    CHANGE_BATCH_HEADER,
    HEADER_SOURCES,
    UNDOABLE_SOURCES,
    ChangeBatch,
    batch_header,
    pk_of,
    row_image,
)


def test_vocabularies():
    assert HEADER_SOURCES == frozenset({"ui", "repair"})
    # An undo is itself reversible (spec §9 UI: "an undo is itself reversible"), so `undo`
    # joins ui and repair here; summaries (import, restore) and derived writes (scheduler)
    # refuse with the summary sentence.
    assert UNDOABLE_SOURCES == frozenset({"ui", "repair", "undo"})
    assert CHANGE_BATCH_HEADER == "X-Change-Batch"


async def test_images_use_the_export_spellings(db):
    snapshot = NetWorthSnapshot(month=date(2026, 9, 1), recorded_on=date(2026, 9, 3))
    account = Account(name="Brokerage", slug="brokerage", group="taxable", sort_order=1)
    db.add_all([snapshot, account])
    await db.flush()
    balance = AccountBalance(
        snapshot_id=snapshot.id, account_id=account.id, balance=Decimal("1500.00")
    )
    db.add(balance)
    await db.flush()
    assert pk_of(balance) == {"id": balance.id}
    assert row_image(balance) == {
        "id": balance.id,
        "snapshot_id": snapshot.id,
        "account_id": account.id,
        "balance": "1500.00",
    }
    assert row_image(snapshot)["month"] == "2026-09-01"
    assert row_image(snapshot)["recorded_on"] == "2026-09-03"


async def test_batch_records_insert_update_delete_and_skips_unchanged(db):
    account = Account(name="Brokerage", slug="brokerage", group="taxable", sort_order=1)
    db.add(account)
    await db.flush()
    batch = ChangeBatch(db, source="ui", actor="me@example.com")
    batch.record_insert(account)
    before = row_image(account)
    account.sort_order = 2
    batch.record_update(account, before, month=date(2026, 9, 1))
    batch.record_update(account, row_image(account))  # unchanged pair: nothing recorded
    batch.label = "Created account Brokerage"
    batch.month = date(2026, 8, 1)  # the default month for rows that named none
    assert batch.rows == 2
    batch_id = await batch.commit()
    assert batch_id == batch.id
    rows = (await db.execute(select(ChangeLog).order_by(ChangeLog.id))).scalars().all()
    assert [(r.op, r.table_name, r.month) for r in rows] == [
        ("insert", "accounts", date(2026, 8, 1)),
        ("update", "accounts", date(2026, 9, 1)),
    ]
    assert rows[0].before is None and rows[0].after["slug"] == "brokerage"
    assert rows[1].before["sort_order"] == 1 and rows[1].after["sort_order"] == 2
    assert {r.batch_id for r in rows} == {batch_id}
    assert {r.label for r in rows} == {"Created account Brokerage"}
    assert {r.actor for r in rows} == {"me@example.com"}
    assert rows[0].at == rows[1].at  # one stamp per batch
    # The write itself was committed by the same call.
    assert (await db.execute(select(Account.sort_order))).scalar_one() == 2


async def test_commit_with_nothing_recorded_still_commits_and_returns_none(db):
    account = Account(name="A", slug="a", group="cash", sort_order=1)
    db.add(account)
    batch = ChangeBatch(db)
    batch.label = "Saved Sep 2026 balances — 0 updated"
    assert await batch.commit() is None
    assert (await db.execute(select(Account))).scalar_one().slug == "a"
    assert (await db.execute(select(ChangeLog))).scalars().all() == []


async def test_record_delete_carries_the_before_image(db):
    account = Account(name="A", slug="a", group="cash", sort_order=1)
    db.add(account)
    await db.flush()
    batch = ChangeBatch(db)
    batch.record_delete(account)
    await db.delete(account)
    batch.label = "Deleted account A"
    await batch.commit()
    row = (await db.execute(select(ChangeLog))).scalar_one()
    assert row.op == "delete" and row.after is None and row.before["name"] == "A"


def test_batch_header_is_absent_when_nothing_changed():
    assert batch_header(None) == {}
    from uuid import UUID

    assert batch_header(UUID("0b2f5c1e-1111-4222-8333-444455556666")) == {
        "X-Change-Batch": "0b2f5c1e-1111-4222-8333-444455556666"
    }
