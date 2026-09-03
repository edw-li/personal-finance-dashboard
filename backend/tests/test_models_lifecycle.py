from datetime import UTC, date, datetime
from uuid import uuid4

from sqlalchemy import select

from app.models import ChangeLog, LifecycleRun, User, UserPreference
from app.models.lifecycle import CHANGE_OPS, CHANGE_SOURCES, RUN_KINDS


def test_vocabularies_are_the_spec_lists():
    assert CHANGE_OPS == ("insert", "update", "delete", "batch")
    assert CHANGE_SOURCES == ("ui", "import", "restore", "scheduler", "repair", "undo")
    assert RUN_KINDS == ("import_xlsx", "restore", "snapshot", "restore_point", "undo")


async def test_change_log_round_trip(db):
    batch = uuid4()
    row = ChangeLog(
        batch_id=batch,
        source="ui",
        actor="me@example.com",
        label="Saved Sep 2026 balances — 1 updated",
        table_name="account_balances",
        pk={"id": 7},
        op="update",
        before={"id": 7, "balance": "1.00"},
        after={"id": 7, "balance": "2.00"},
        month=date(2026, 9, 1),
    )
    db.add(row)
    await db.commit()
    stored = (await db.execute(select(ChangeLog))).scalar_one()
    assert stored.batch_id == batch
    assert stored.at is not None and stored.at.tzinfo is not None  # server default stamped it
    assert stored.before == {"id": 7, "balance": "1.00"}
    assert stored.month == date(2026, 9, 1)


async def test_lifecycle_run_defaults(db):
    run = LifecycleRun(kind="snapshot", filename="finance-export-20260904-233000.zip", size_bytes=1)
    db.add(run)
    await db.commit()
    stored = (await db.execute(select(LifecycleRun))).scalar_one()
    assert stored.dry_run is False and stored.ok is True
    assert stored.report is None and stored.error is None and stored.batch_id is None
    assert stored.at.tzinfo is not None


async def test_user_preference_is_keyed_per_user_and_key(db, seeded_user):
    db.add(UserPreference(user_id=seeded_user.id, key="theme", value="dark"))
    db.add(
        UserPreference(user_id=seeded_user.id, key="scope", value={"owner": "all", "range": "1y"})
    )
    await db.commit()
    rows = (await db.execute(select(UserPreference).order_by(UserPreference.key))).scalars().all()
    assert [(r.key, r.value) for r in rows] == [
        ("scope", {"owner": "all", "range": "1y"}),
        ("theme", "dark"),
    ]
    assert all(r.updated_at.tzinfo is not None for r in rows)
    # ON DELETE CASCADE: the user's preferences go with the user.
    await db.delete(await db.get(User, seeded_user.id))
    await db.commit()
    assert (await db.execute(select(UserPreference))).scalars().all() == []


async def test_user_preference_updated_at_is_python_side(db, seeded_user):
    # Written in Python (not only server-side) so a just-added row reads its stamp without a
    # refresh — expire_on_commit is False app-wide and the prefs router echoes it back.
    before = datetime.now(UTC)
    row = UserPreference(user_id=seeded_user.id, key="density", value="compact")
    db.add(row)
    await db.commit()
    assert row.updated_at >= before
    # And it ADVANCES on update — §10 compares this stamp across two devices, so a re-save
    # that kept the old stamp would let a stale device win.
    first = row.updated_at
    row.value = "cozy"
    await db.commit()
    assert row.updated_at > first
