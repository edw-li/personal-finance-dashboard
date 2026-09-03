from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy import func, select

from app.models import Account, ChangeLog, LifecycleRun
from app.services.snapshot import SNAPSHOT_NAME_RE, snapshots_dir
from app.services.snapshot_store import (
    CHANGE_LOG_RETENTION_DAYS,
    SNAPSHOTS_KEEP,
    latest_snapshot_run_at,
    list_snapshots,
    purge_change_log,
    run_snapshot_job,
    write_snapshot,
)

NOW = datetime(2026, 9, 4, 6, 30, tzinfo=UTC)


async def test_write_snapshot_writes_a_file_records_a_run_and_answers_an_entry(db):
    db.add(Account(name="A", slug="a", group="cash", sort_order=1))
    await db.commit()
    entry = await write_snapshot(db, actor="me@example.com", trigger="manual")
    assert SNAPSHOT_NAME_RE.fullmatch(entry.name)
    path = snapshots_dir() / entry.name
    assert path.is_file() and path.stat().st_size == entry.size_bytes > 0
    assert entry.restorable is True and entry.alembic_head is None
    assert entry.at.tzinfo is not None
    run = (await db.execute(select(LifecycleRun))).scalar_one()
    assert (run.kind, run.ok, run.actor, run.filename, run.size_bytes) == (
        "snapshot",
        True,
        "me@example.com",
        entry.name,
        entry.size_bytes,
    )
    assert run.report["trigger"] == "manual" and run.report["tables"]["accounts"] == 1
    assert await latest_snapshot_run_at(db) == run.at


async def test_write_snapshot_keeps_fourteen(db):
    directory = snapshots_dir()
    directory.mkdir(parents=True)
    for day in range(1, SNAPSHOTS_KEEP + 1):
        (directory / f"finance-export-202608{day:02d}-233000.zip").write_bytes(b"x")
    (directory / "keep-me.txt").write_bytes(b"x")
    entry = await write_snapshot(db, actor=None, trigger="scheduled")
    names = sorted(p.name for p in directory.iterdir())
    assert len(names) == SNAPSHOTS_KEEP + 1  # 14 snapshots + the foreign file
    assert "finance-export-20260801-233000.zip" not in names  # the oldest went
    assert entry.name in names and "keep-me.txt" in names


def test_list_snapshots_is_newest_first_with_restorable_by_head():
    directory = snapshots_dir()
    directory.mkdir(parents=True)
    import io
    import json
    import zipfile

    def zipped(head):
        out = io.BytesIO()
        with zipfile.ZipFile(out, "w") as archive:
            archive.writestr("manifest.json", json.dumps({"alembic_head": head}))
            archive.writestr("finance-export.json", "{}")
        return out.getvalue()

    (directory / "finance-export-20260902-233000.zip").write_bytes(zipped("b8e4d17c2a90"))
    (directory / "finance-export-20260903-233000.zip").write_bytes(zipped("c3a7e19d5b42"))
    (directory / "finance-export-20260904-233000.zip").write_bytes(b"not a zip")
    (directory / "notes.txt").write_bytes(b"x")
    entries = list_snapshots("c3a7e19d5b42")
    assert [e.name for e in entries] == [
        "finance-export-20260904-233000.zip",
        "finance-export-20260903-233000.zip",
        "finance-export-20260902-233000.zip",
    ]
    assert [e.restorable for e in entries] == [False, True, False]
    assert entries[0].alembic_head is None  # unreadable: listed, never restorable
    assert entries[1].at == datetime(2026, 9, 3, 23, 30, tzinfo=UTC)
    assert entries[1].size_bytes > 0


def test_list_snapshots_without_a_directory_is_empty():
    assert list_snapshots("c3a7e19d5b42") == []


async def test_purge_change_log_drops_rows_past_retention(db):
    old = NOW - timedelta(days=CHANGE_LOG_RETENTION_DAYS + 1)
    recent = NOW - timedelta(days=CHANGE_LOG_RETENTION_DAYS - 1)
    for at in (old, recent):
        db.add(
            ChangeLog(
                at=at,
                batch_id=uuid4(),
                source="ui",
                actor=None,
                label="x",
                table_name="accounts",
                pk={"id": 1},
                op="update",
                before={},
                after={},
            )
        )
    await db.commit()
    assert await purge_change_log(db, now=NOW) == 1
    await db.commit()
    assert (await db.execute(select(func.count()).select_from(ChangeLog))).scalar_one() == 1


async def test_run_snapshot_job_records_a_failed_run_instead_of_raising(db, monkeypatch):
    async def explode(_db):
        raise OSError("read-only file system")

    monkeypatch.setattr("app.services.snapshot_store.build_snapshot_zip", explode)
    assert await run_snapshot_job(db, now=NOW, trigger="scheduled") is False
    run = (await db.execute(select(LifecycleRun))).scalar_one()
    assert (run.kind, run.ok) == ("snapshot", False)
    assert run.error == "OSError: read-only file system"
    assert run.report == {"trigger": "scheduled"}
    assert await latest_snapshot_run_at(db) is None  # failed runs do not count as coverage


async def test_run_snapshot_job_writes_and_purges(db):
    db.add(
        ChangeLog(
            at=NOW - timedelta(days=CHANGE_LOG_RETENTION_DAYS + 5),
            batch_id=uuid4(),
            source="ui",
            actor=None,
            label="x",
            table_name="accounts",
            pk={"id": 1},
            op="update",
            before={},
            after={},
        )
    )
    await db.commit()
    assert await run_snapshot_job(db, now=NOW, trigger="scheduled") is True
    assert len(list(snapshots_dir().iterdir())) == 1
    assert (await db.execute(select(func.count()).select_from(ChangeLog))).scalar_one() == 0
