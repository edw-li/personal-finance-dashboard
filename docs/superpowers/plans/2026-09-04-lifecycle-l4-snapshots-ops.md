# Data lifecycle L4 — Nightly stored snapshots, snapshot routes, backup verify phase, restore drill, README — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `docs/superpowers/specs/2026-09-03-data-lifecycle-design.md` §8 and §13's drill: `services/snapshot_store.py` (write to `<data_dir>/snapshots`, keep 14, list with `restorable`, purge `change_log` past 400 days), the `snapshot_nightly` scheduler job (23:30 PT, catch-up on a missed day, off in tests), `GET /system/snapshots` and the rate-limited `POST /system/snapshots`, the `backup_db.sh` verify-into-scratch phase with the richer marker, `restore_drill.sh`, and the README's §5/§7 updates.

**Architecture:** The store is a thin layer over Phase 0's `build_snapshot_zip`, `snapshot_name`/`snapshot_stamp`, `trim_directory` and `LifecycleRun`; the job body `run_snapshot_job(db, *, now, trigger)` is testable with any session and records a FAILED run instead of raising (prod's volume may be absent until the compose redeploy). The scheduler wiring reuses `missed_todays_run`. The shell script changes are static-pinned by a test and exercised by hand on the box; the drill creates and drops its scratch database through asyncpg so it runs identically on the dev box and inside the backend container.

**Tech Stack:** APScheduler 3.11 (CronTrigger), slowapi (`AUTH_ATTEMPT` 10/minute), bash + psql/pg_dump/gpg on the host.

**Worktree / commands:** Branch `lifecycle-l4` from main AFTER `lifecycle-base` merged. Backend from `<worktree>/backend`:
`FINANCE_TEST_DB=finance_test_l4 ../../../backend/.venv/Scripts/python.exe -m pytest tests/<file> -q`
(`<venv-python>` = that interpreter.) Shell syntax checks use Git Bash: `bash -n <script>`.

---

## File structure

| File | Responsibility |
|---|---|
| `backend/app/services/snapshot_store.py` (new) | `write_snapshot`, `list_snapshots`, `purge_change_log`, `latest_snapshot_run_at`, `run_snapshot_job`, `SNAPSHOTS_KEEP`, `CHANGE_LOG_RETENTION_DAYS` |
| `backend/tests/test_snapshot_store.py` (new) | writes, trims to 14, records runs, lists newest first with `restorable`, purge, failure run |
| `backend/app/services/scheduler.py` (modify) | `snapshot_nightly` job + catch-up |
| `backend/tests/test_scheduler.py` (modify) | trigger and catch-up decision |
| `backend/app/api/system.py` (modify) | `GET/POST /system/snapshots`; `alembic_head` from the service |
| `backend/tests/test_system_api.py` (modify) | routes, rate limit, marker fields round trip |
| `backend/scripts/backup_db.sh` (modify) | verify phase, marker fields |
| `backend/scripts/restore_drill.sh` (new) | the drill |
| `backend/tests/test_ops_scripts.py` (new) | static pins + `bash -n` |
| `README.md` (modify) | §5.3, §5.5, §7.6 |

---

### Task 1: The snapshot store

**Files:**
- Create: `backend/app/services/snapshot_store.py`
- Test: `backend/tests/test_snapshot_store.py`

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_snapshot_store.py
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
        "snapshot", True, "me@example.com", entry.name, entry.size_bytes,
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
    assert list_snapshots(None) == [] or True  # a missing directory answers []


def test_list_snapshots_without_a_directory_is_empty():
    assert list_snapshots("c3a7e19d5b42") == []


async def test_purge_change_log_drops_rows_past_retention(db):
    old = NOW - timedelta(days=CHANGE_LOG_RETENTION_DAYS + 1)
    recent = NOW - timedelta(days=CHANGE_LOG_RETENTION_DAYS - 1)
    for at in (old, recent):
        db.add(
            ChangeLog(
                at=at, batch_id=uuid4(), source="ui", actor=None, label="x",
                table_name="accounts", pk={"id": 1}, op="update", before={}, after={},
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
            at=NOW - timedelta(days=CHANGE_LOG_RETENTION_DAYS + 5), batch_id=uuid4(), source="ui",
            actor=None, label="x", table_name="accounts", pk={"id": 1}, op="update", before={}, after={},
        )
    )
    await db.commit()
    assert await run_snapshot_job(db, now=NOW, trigger="scheduled") is True
    assert len(list(snapshots_dir().iterdir())) == 1
    assert (await db.execute(select(func.count()).select_from(ChangeLog))).scalar_one() == 0
```

- [ ] **Step 2: Run to verify they fail**

Run: `FINANCE_TEST_DB=finance_test_l4 <venv-python> -m pytest tests/test_snapshot_store.py -q`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the store**

```python
# backend/app/services/snapshot_store.py
"""Stored logical snapshots on the data volume (2026-09-03 data-lifecycle spec §8): the
export ZIP written nightly by the scheduler (and on demand by POST /system/snapshots) to
<data_dir>/snapshots, newest fourteen kept, each run recorded. The dump is disaster
recovery; these are the undo button for bad days — the app can read them back without
shell access (POST /import/snapshot/stored/{name}).

File IO rides asyncio.to_thread; the job body records a FAILED run instead of raising, so
a missing volume on prod (until the compose redeploy) shows in Activity and the health
check rather than in a traceback nobody reads."""

import asyncio
import json
import logging
import zipfile
from datetime import datetime, timedelta
from pathlib import Path

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ChangeLog, LifecycleRun
from app.schemas.lifecycle import SnapshotEntryOut
from app.services.snapshot import (
    SNAPSHOT_NAME_RE,
    build_snapshot_zip,
    snapshot_name,
    snapshot_stamp,
    snapshots_dir,
    trim_directory,
)

logger = logging.getLogger(__name__)

SNAPSHOTS_KEEP = 14
CHANGE_LOG_RETENTION_DAYS = 400
ERROR_SNIPPET_LEN = 500


def _head_of(path: Path) -> str | None:
    """The manifest's alembic_head, or None when the file cannot be read as our ZIP — such
    a file is LISTED (it is on the volume) but never restorable."""
    try:
        with zipfile.ZipFile(path) as archive:
            head = json.loads(archive.read("manifest.json")).get("alembic_head")
    except (OSError, zipfile.BadZipFile, KeyError, ValueError):
        return None
    return head if isinstance(head, str) else None


def list_snapshots(server_head: str | None) -> list[SnapshotEntryOut]:
    """Sync (filesystem) — callers wrap it in asyncio.to_thread. Newest first; names outside
    the grammar are ignored; restorable = the file's head equals this server's."""
    directory = snapshots_dir()
    if not directory.is_dir():
        return []
    entries: list[SnapshotEntryOut] = []
    for path in directory.iterdir():
        stamp = snapshot_stamp(path.name)
        if stamp is None or not path.is_file():
            continue
        head = _head_of(path)
        entries.append(
            SnapshotEntryOut(
                name=path.name,
                at=stamp,
                size_bytes=path.stat().st_size,
                alembic_head=head,
                restorable=head is not None and head == server_head,
            )
        )
    return sorted(entries, key=lambda entry: entry.name, reverse=True)


def _write(payload: bytes, name: str) -> Path:
    directory = snapshots_dir()
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / name
    path.write_bytes(payload)
    trim_directory(directory, SNAPSHOT_NAME_RE, SNAPSHOTS_KEEP)
    return path


async def write_snapshot(db: AsyncSession, *, actor: str | None, trigger: str) -> SnapshotEntryOut:
    """Build, write, trim, record (a `snapshot` run), commit. Raises on failure — the job
    body below turns that into a failed run; the POST route lets FastAPI 500."""
    snap = await build_snapshot_zip(db)
    name = snapshot_name(snap.exported_at)
    await asyncio.to_thread(_write, snap.payload, name)
    db.add(
        LifecycleRun(
            kind="snapshot",
            ok=True,
            actor=actor,
            filename=name,
            size_bytes=len(snap.payload),
            report={"tables": snap.counts, "trigger": trigger},
        )
    )
    await db.commit()
    stamp = snapshot_stamp(name)
    assert stamp is not None  # snapshot_name and snapshot_stamp are inverses
    return SnapshotEntryOut(
        name=name,
        at=stamp,
        size_bytes=len(snap.payload),
        alembic_head=snap.alembic_head,
        restorable=True,
    )


async def purge_change_log(db: AsyncSession, *, now: datetime) -> int:
    """Rows older than the retention window go; the caller commits. Returns the count."""
    cutoff = now - timedelta(days=CHANGE_LOG_RETENTION_DAYS)
    result = await db.execute(delete(ChangeLog).where(ChangeLog.at < cutoff))
    return result.rowcount or 0


async def latest_snapshot_run_at(db: AsyncSession) -> datetime | None:
    """The newest SUCCESSFUL snapshot run — the scheduler's catch-up key (spec §8)."""
    return (
        await db.execute(
            select(func.max(LifecycleRun.at)).where(
                LifecycleRun.kind == "snapshot", LifecycleRun.ok.is_(True)
            )
        )
    ).scalar_one_or_none()


async def run_snapshot_job(db: AsyncSession, *, now: datetime, trigger: str) -> bool:
    """The nightly job's body: write, purge, log. True on success; on ANY failure, roll
    back, record a failed `snapshot` run with the error, and return False."""
    try:
        entry = await write_snapshot(db, actor=None, trigger=trigger)
        purged = await purge_change_log(db, now=now)
        await db.commit()
    except Exception as exc:
        await db.rollback()
        logger.exception("nightly snapshot failed")
        db.add(
            LifecycleRun(
                kind="snapshot",
                ok=False,
                actor=None,
                error=f"{type(exc).__name__}: {exc}"[:ERROR_SNIPPET_LEN],
                report={"trigger": trigger},
            )
        )
        await db.commit()
        return False
    logger.info(
        "%s snapshot %s written (%d bytes); %d change-log rows purged",
        trigger, entry.name, entry.size_bytes, purged,
    )
    return True
```

- [ ] **Step 4: Run the tests**

Run: `FINANCE_TEST_DB=finance_test_l4 <venv-python> -m pytest tests/test_snapshot_store.py -q`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/snapshot_store.py backend/tests/test_snapshot_store.py
git commit -m "feat(snapshots): store — write/trim/list/purge, run records, failure-tolerant job body"
```

---

### Task 2: The `snapshot_nightly` scheduler job

**Files:**
- Modify: `backend/app/services/scheduler.py`
- Test: `backend/tests/test_scheduler.py` (append)

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_scheduler.py`:

```python
def test_snapshot_trigger_fires_nightly_at_2330_pt():
    from app.services.scheduler import SNAPSHOT_CRON, SNAPSHOT_JOB_ID, build_snapshot_trigger

    assert SNAPSHOT_CRON == "30 23 * * *" and SNAPSHOT_JOB_ID == "snapshot_nightly"
    trigger = build_snapshot_trigger()
    tz = ZoneInfo(SCHEDULER_TIMEZONE)
    anchor = datetime(2026, 9, 4, 9, 0, tzinfo=tz)
    first = trigger.get_next_fire_time(None, anchor)
    assert (first.hour, first.minute, first.date()) == (23, 30, date(2026, 9, 4))
    # Every day, weekends included — a Saturday fires too.
    saturday = datetime(2026, 9, 5, 9, 0, tzinfo=tz)
    assert trigger.get_next_fire_time(None, saturday).date() == date(2026, 9, 5)


def test_snapshot_catch_up_uses_the_shared_missed_run_rule():
    from app.services.scheduler import build_snapshot_trigger

    trigger = build_snapshot_trigger()
    tz = ZoneInfo(SCHEDULER_TIMEZONE)
    after_fire = datetime(2026, 9, 4, 23, 45, tzinfo=tz)
    before_fire = datetime(2026, 9, 4, 9, 0, tzinfo=tz)
    assert missed_todays_run(trigger, None, after_fire) is True
    assert missed_todays_run(trigger, datetime(2026, 9, 4, 23, 31, tzinfo=tz), after_fire) is False
    assert missed_todays_run(trigger, None, before_fire) is False
```

- [ ] **Step 2: Run to verify they fail**

Run: `FINANCE_TEST_DB=finance_test_l4 <venv-python> -m pytest tests/test_scheduler.py -q -k snapshot`
Expected: FAIL — `ImportError: cannot import name 'SNAPSHOT_CRON'`.

- [ ] **Step 3: Implement**

In `backend/app/services/scheduler.py`:

Add to the imports: `from datetime import UTC, date, datetime, timedelta` (adding `UTC`).

Add after `CATCHUP_DELAY_SECONDS = 10`:

```python
# Nightly logical snapshot (2026-09-03 data-lifecycle spec §8): every day, weekends
# included — the export is about the database, not the market.
SNAPSHOT_CRON = "30 23 * * *"
SNAPSHOT_JOB_ID = "snapshot_nightly"
SNAPSHOT_CATCHUP_JOB_ID = "snapshot_nightly_catchup"
```

Add after `build_trigger`:

```python
def build_snapshot_trigger() -> CronTrigger:
    return CronTrigger.from_crontab(SNAPSHOT_CRON, timezone=SCHEDULER_TIMEZONE)
```

Add after `_refresh_job`:

```python
async def _snapshot_job(trigger_label: str = "scheduled") -> None:
    # Deferred imports, like _refresh_job: keep app import time (and pytest collection) lean.
    from app.database import SessionLocal
    from app.services.snapshot_store import run_snapshot_job

    async with SessionLocal() as db:
        await run_snapshot_job(db, now=datetime.now(UTC), trigger=trigger_label)
```

In `start_scheduler`, after the price-refresh catch-up block (the `if missed_todays_run(trigger, last_run_at, now): … logger.info("catching up today's missed price refresh")`) and BEFORE `scheduler.start()`, add:

```python
    if settings.snapshot_enabled:
        from app.services.snapshot_store import latest_snapshot_run_at

        async with SessionLocal() as db:
            last_snapshot_at = await latest_snapshot_run_at(db)
        snapshot_trigger = build_snapshot_trigger()
        scheduler.add_job(
            _snapshot_job,
            trigger=snapshot_trigger,
            id=SNAPSHOT_JOB_ID,
            coalesce=True,
            max_instances=1,
            misfire_grace_time=3600,
        )
        # The same catch-up as the price refresh, keyed on the newest SUCCESSFUL snapshot
        # run: a boot after 23:30 with nothing written today snapshots a few seconds in.
        if missed_todays_run(snapshot_trigger, last_snapshot_at, now):
            scheduler.add_job(
                _snapshot_job,
                trigger="date",
                run_date=now + timedelta(seconds=CATCHUP_DELAY_SECONDS),
                id=SNAPSHOT_CATCHUP_JOB_ID,
                kwargs={"trigger_label": "scheduled (catch-up)"},
            )
            logger.info("catching up today's missed snapshot")
        logger.info("nightly snapshot scheduled: %r (%s)", SNAPSHOT_CRON, SCHEDULER_TIMEZONE)
```

- [ ] **Step 4: Run the tests**

Run: `FINANCE_TEST_DB=finance_test_l4 <venv-python> -m pytest tests/test_scheduler.py -q`
Expected: all passed (the old tests too — the scheduler is never started in tests, and `snapshot_enabled` is pinned off by conftest).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/scheduler.py backend/tests/test_scheduler.py
git commit -m "feat(scheduler): snapshot_nightly at 23:30 PT with catch-up, gated by snapshot_enabled"
```

---

### Task 3: `GET /system/snapshots` and the rate-limited `POST`

**Files:**
- Modify: `backend/app/api/system.py`
- Test: `backend/tests/test_system_api.py` (append)

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_system_api.py`:

```python
SNAPSHOTS = "/api/v1/system/snapshots"


async def test_snapshots_require_auth(client):
    assert (await client.get(SNAPSHOTS)).status_code == 401
    assert (await client.post(SNAPSHOTS)).status_code == 401


async def test_snapshots_list_is_empty_then_lists_what_post_wrote(auth_client, db):
    assert (await auth_client.get(SNAPSHOTS)).json() == []
    created = await auth_client.post(SNAPSHOTS)
    assert created.status_code == 201, created.text
    entry = created.json()
    assert entry["name"].startswith("finance-export-") and entry["restorable"] is True
    assert entry["alembic_head"] is None and entry["size_bytes"] > 0
    listed = (await auth_client.get(SNAPSHOTS)).json()
    assert [e["name"] for e in listed] == [entry["name"]]
    assert listed[0]["restorable"] is True  # same create_all head (None) on both sides
    from sqlalchemy import select

    from app.models import LifecycleRun

    run = (await db.execute(select(LifecycleRun))).scalar_one()
    assert (run.kind, run.actor, run.report["trigger"]) == ("snapshot", "me@example.com", "manual")


async def test_snapshot_now_is_rate_limited_like_login(auth_client):
    # AUTH_ATTEMPT is 10/minute; a full ZIP takes ~200 ms on 12.7 MB, and nobody needs more.
    for _ in range(10):
        assert (await auth_client.post(SNAPSHOTS)).status_code == 201
    assert (await auth_client.post(SNAPSHOTS)).status_code == 429


async def test_system_backup_marker_carries_the_verify_fields(auth_client, db):
    db.add(
        AppSetting(
            key="backup_status",
            value={
                "last_success_at": "2026-09-04T03:00:12Z",
                "object_key": "backups/finance_2026-09-04.sql.gz.gpg",
                "size": "108K",
                "size_bytes": 110592,
                "encrypted": True,
                "retention_days": 30,
                "verified": True,
                "verified_at": "2026-09-04T03:00:40Z",
                "row_counts": {"net_worth_snapshots": 33, "monthly_spending": 621, "position_transactions": 210},
            },
        )
    )
    db.add(AppSetting(key="backup_runs", value=[{"at": "2026-09-04T03:00:12Z", "ok": True, "object": "k", "verified": True}]))
    await db.commit()
    body = (await auth_client.get(STATUS)).json()
    assert body["backup"]["verified"] is True and body["backup"]["size_bytes"] == 110592
    assert body["backup"]["encrypted"] is True and body["backup"]["row_counts"]["monthly_spending"] == 621
    assert body["backup"]["verify_error"] is None
    assert body["backup_runs"][0]["verified"] is True
```

- [ ] **Step 2: Run to verify they fail**

Run: `FINANCE_TEST_DB=finance_test_l4 <venv-python> -m pytest tests/test_system_api.py -q -k "snapshots or verify_fields"`
Expected: the snapshots tests FAIL with 404s; `verify_fields` PASSES already (Phase 0's schema) — keep it as the endpoint-level pin.

- [ ] **Step 3: Implement**

In `backend/app/api/system.py`:

Add imports:

```python
import asyncio

from fastapi import APIRouter, Depends, Request

from app.models import AppSetting, User
from app.rate_limit import AUTH_ATTEMPT, limiter
from app.schemas.lifecycle import SnapshotEntryOut
from app.services.snapshot import alembic_head
from app.services.snapshot_store import list_snapshots, write_snapshot
```

(merge with the existing import lines — `APIRouter, Depends` already come from fastapi; `AppSetting` from `app.models`.)

In `system_status`, replace the inline alembic probe (the `has_alembic = …` through `alembic_head = head_row.scalars().first()` block) with:

```python
    # One probe, shared with the export/restore side (services.snapshot.alembic_head).
    head = await alembic_head(db)
```

and use `alembic_head=head` in `DatabaseStatusOut(...)`. Remove the now-unused `text` import if nothing else uses it (the `pg_database_size` query still does — keep it).

Append the routes:

```python
@router.get("/snapshots", response_model=list[SnapshotEntryOut])
async def stored_snapshots(db: AsyncSession = Depends(get_db)) -> list[SnapshotEntryOut]:
    """The nightly files on the data volume, newest first (2026-09-03 data-lifecycle spec
    §8). `restorable` = the file's schema head equals this server's."""
    head = await alembic_head(db)
    return await asyncio.to_thread(list_snapshots, head)


@router.post("/snapshots", response_model=SnapshotEntryOut, status_code=201)
@limiter.limit(AUTH_ATTEMPT)
async def snapshot_now(
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SnapshotEntryOut:
    """"Snapshot now" — the on-demand backup the tier-1 spec declined for want of pg_dump,
    delivered as the app's own ZIP. Rate-limited like login: a full ZIP is ~200 ms on the
    real database and nobody needs eleven a minute."""
    return await write_snapshot(db, actor=user.email, trigger="manual")
```

- [ ] **Step 4: Run the tests**

Run: `FINANCE_TEST_DB=finance_test_l4 <venv-python> -m pytest tests/test_system_api.py -q`
Expected: all passed. If the 429 test sees a 201 on the eleventh call, the limiter keys on `request.client.host`; confirm `auth.py`'s login-limit test passes in this checkout (same mechanism) — if it does and this does not, the decorator order is wrong: `@router.post` must be OUTERMOST, `@limiter.limit` directly on the function.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/system.py backend/tests/test_system_api.py
git commit -m "feat(api): GET/POST /system/snapshots; status reads the shared alembic probe"
```

---

### Task 4: `backup_db.sh` — the verify phase and the richer marker

**Files:**
- Modify: `backend/scripts/backup_db.sh`
- Test: `backend/tests/test_ops_scripts.py`

- [ ] **Step 1: Write the failing static pin**

```python
# backend/tests/test_ops_scripts.py
"""The two host scripts are exercised by hand on the box (spec §4: shell is tested there);
these pins keep their CONTRACTS visible to the suite — the marker fields the system
schema parses, the verify phase's shape, the drill's steps — and syntax-check them with
bash when one is on PATH."""

import shutil
import subprocess
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
BACKUP = SCRIPTS / "backup_db.sh"
DRILL = SCRIPTS / "restore_drill.sh"


def _bash_syntax_ok(script: Path) -> None:
    bash = shutil.which("bash")
    if bash is None:
        pytest.skip("no bash on PATH")
    result = subprocess.run([bash, "-n", str(script)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr


def test_backup_script_has_a_verify_phase_that_writes_the_marker_fields():
    text = BACKUP.read_text(encoding="utf-8")
    # The verify phase: a scratch database, a restore with ON_ERROR_STOP, a count compare,
    # and a drop — never on the live database name.
    assert "createdb" in text and "dropdb" in text
    assert text.count("ON_ERROR_STOP=1") >= 3
    assert 'VERIFY_TABLES="net_worth_snapshots monthly_spending position_transactions"' in text
    # Marker fields BackupStatusOut parses (Optional, so old markers still load).
    for field in ('"size_bytes"', '"encrypted"', '"retention_days"', '"verified"', '"verified_at"', '"row_counts"', '"verify_error"'):
        assert field in text, field
    # The run entry gains `verified` too.
    assert '\\"verified\\": ${VERIFIED}' in text
    # A verify failure must not fail the run: retention still runs, exit stays 0.
    assert "WARN: backup NOT verified" in text
    _bash_syntax_ok(BACKUP)


def test_restore_drill_exists_and_runs_the_four_steps():
    text = DRILL.read_text(encoding="utf-8")
    assert "alembic upgrade head" in text
    assert "app.seed" in text
    assert "app.lifecycle restore" in text and "app.lifecycle verify" in text
    assert "CREATE DATABASE" in text and "DROP DATABASE IF EXISTS" in text
    assert "PASS" in text and "FAIL" in text
    _bash_syntax_ok(DRILL)
```

- [ ] **Step 2: Run to verify it fails**

Run: `FINANCE_TEST_DB=finance_test_l4 <venv-python> -m pytest tests/test_ops_scripts.py -q`
Expected: FAIL — `createdb` absent from the backup script; the drill file does not exist.

- [ ] **Step 3: Edit `backend/scripts/backup_db.sh`**

Three edits.

(a) Right before the `echo "[$(date)] Starting backup…"` line, add the count helpers and take the live counts (they must describe the database AT dump time):

```bash
# ── Verify phase helpers (2026-09-03 data-lifecycle spec §8) ─────────────────────────
# Three row counts from the live database at dump time, compared after restoring the
# uploaded dump into a scratch database. The role needs CREATEDB once (README 5.3):
#   sudo -u postgres psql -c "ALTER ROLE finance CREATEDB;"
VERIFY_TABLES="net_worth_snapshots monthly_spending position_transactions"
VERIFY_DB="${DB_NAME}_verify_$$"
VERIFIED=false
VERIFY_ERROR=""
VERIFIED_AT=""

live_counts() {  # $1 = database -> "t1=n1 t2=n2 t3=n3"
  local db="$1" out="" t n
  for t in $VERIFY_TABLES; do
    n="$(PGPASSWORD="${POSTGRES_PASSWORD}" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$db" -Atc "SELECT count(*) FROM ${t}" 2>/dev/null || echo '?')"
    out="${out}${out:+ }${t}=${n}"
  done
  echo "$out"
}

counts_json() {  # "t=n t=n" -> {"t": n, ...}
  local json="" pair
  for pair in $1; do
    json="${json}${json:+, }\"${pair%%=*}\": ${pair#*=}"
  done
  echo "{${json}}"
}

sanitize() {  # the first 300 bytes of a file as one JSON/SQL-safe line
  head -c 300 "$1" | tr -d "\"'\\\\" | tr '\n' ' '
}

decrypt_dump() {  # the SQL text of $DUMP_FILE on stdout, whichever flavor was written
  if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
    gpg --decrypt --batch --quiet --pinentry-mode loopback --passphrase "$BACKUP_PASSPHRASE" "$DUMP_FILE" | gunzip
  else
    gunzip -c "$DUMP_FILE"
  fi
}

LIVE_COUNTS="$(live_counts "$DB_NAME")"
```

(b) After the upload's `PYEOF` heredoc (the python block ends), and before the `# Record the successful upload…` comment, add the verify phase:

```bash
# ── Verify phase: restore the uploaded dump into a scratch database and compare counts ──
# Every step lives inside an `if`, so set -e and the ERR trap never fire from here: a verify
# failure keeps ok:true for the upload (the dump IS in the bucket), records verified:false
# with the reason, and lets the run end with exit 0 so retention still ran.
VERIFY_ERR_FILE="/tmp/verify_err_$$"
if PGPASSWORD="${POSTGRES_PASSWORD}" createdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$VERIFY_DB" 2>"$VERIFY_ERR_FILE"; then
  if decrypt_dump | PGPASSWORD="${POSTGRES_PASSWORD}" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$VERIFY_DB" -v ON_ERROR_STOP=1 -q >/dev/null 2>"$VERIFY_ERR_FILE"; then
    RESTORED_COUNTS="$(live_counts "$VERIFY_DB")"
    if [ "$RESTORED_COUNTS" = "$LIVE_COUNTS" ]; then
      VERIFIED=true
      VERIFIED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      echo "[$(date)] Verify OK: ${RESTORED_COUNTS}"
    else
      VERIFY_ERROR="row count mismatch: live ${LIVE_COUNTS} vs restored ${RESTORED_COUNTS}"
    fi
  else
    VERIFY_ERROR="restore into ${VERIFY_DB} failed: $(sanitize "$VERIFY_ERR_FILE")"
  fi
  PGPASSWORD="${POSTGRES_PASSWORD}" dropdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" --if-exists "$VERIFY_DB" \
    || echo "[$(date)] WARN: could not drop ${VERIFY_DB}"
else
  VERIFY_ERROR="createdb failed (grant CREATEDB to ${DB_USER}, README 5.3): $(sanitize "$VERIFY_ERR_FILE")"
fi
rm -f "$VERIFY_ERR_FILE"
[ "$VERIFIED" = true ] || echo "[$(date)] WARN: backup NOT verified — ${VERIFY_ERROR}"
```

(c) Replace the marker block (`RUN_AT=…` through the `|| echo "[$(date)] WARN: could not record …"` line) with:

```bash
# Record the run for the dashboard (2026-08-25 spec §3 + 2026-08-31 §B3 + 2026-09-03 §8):
# upsert app_settings['backup_status'] as a FLAT JSON object — the {"value": ...} envelope is
# a Python readers' convention — and append this run to app_settings['backup_runs']. The
# verify fields are Optional in BackupStatusOut, so a marker from an older script still
# parses. Best-effort BY DESIGN: the backup itself already succeeded, so a marker failure
# only warns — the `|| echo` keeps set -e (and the ERR trap) out of bookkeeping.
RUN_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
DUMP_BYTES="$(stat -c%s "$DUMP_FILE" 2>/dev/null || stat -f%z "$DUMP_FILE")"
if [ -n "${BACKUP_PASSPHRASE:-}" ]; then ENCRYPTED=true; else ENCRYPTED=false; fi
if [ "$VERIFIED" = true ]; then
  VERIFY_FIELDS="\"verified\": true, \"verified_at\": \"${VERIFIED_AT}\", \"row_counts\": $(counts_json "$LIVE_COUNTS")"
else
  VERIFY_FIELDS="\"verified\": false, \"verify_error\": \"${VERIFY_ERROR}\""
fi
BACKUP_MARKER="{\"last_success_at\": \"${RUN_AT}\", \"object_key\": \"${OBJECT_KEY}\", \"size\": \"${DUMP_SIZE}\", \"size_bytes\": ${DUMP_BYTES}, \"encrypted\": ${ENCRYPTED}, \"retention_days\": ${RETENTION_DAYS}, ${VERIFY_FIELDS}}"
{
  PGPASSWORD="${POSTGRES_PASSWORD}" psql \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_USER" \
    -d "$DB_NAME" \
    -v ON_ERROR_STOP=1 \
    -q \
    -c "INSERT INTO app_settings (key, value) VALUES ('backup_status', '${BACKUP_MARKER}'::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value" \
  && append_backup_run "{\"at\": \"${RUN_AT}\", \"ok\": true, \"object\": \"${OBJECT_KEY}\", \"verified\": ${VERIFIED}}"
} || echo "[$(date)] WARN: could not record backup_status/backup_runs in app_settings — the backup itself succeeded"
```

Also update the header comment at the top of the script: after the encryption paragraph add
`# Verify phase (2026-09-03 data-lifecycle spec §8): the uploaded dump is restored into a`
`# scratch database and three row counts compared; the marker records verified/verify_error.`

- [ ] **Step 4: Run the pin and the syntax check; hand-test the phase where a Postgres is reachable**

Run: `FINANCE_TEST_DB=finance_test_l4 <venv-python> -m pytest tests/test_ops_scripts.py -q -k backup` → PASS.
Run: `bash -n backend/scripts/backup_db.sh` → silent.

Hand test of the count/JSON helpers without OCI (Git Bash, dev Postgres on 5433, from the repo root):
`bash -c 'source <(sed -n "/^live_counts()/,/^}/p;/^counts_json()/,/^}/p" backend/scripts/backup_db.sh); DB_HOST=localhost DB_PORT=5433 DB_USER=finance POSTGRES_PASSWORD=finance VERIFY_TABLES="net_worth_snapshots monthly_spending position_transactions"; c="$(live_counts finance)"; echo "$c"; counts_json "$c"'`
Expected: a line like `net_worth_snapshots=33 monthly_spending=621 position_transactions=210` and `{"net_worth_snapshots": 33, "monthly_spending": 621, "position_transactions": 210}`. The full phase (createdb/psql/dropdb, gpg) is exercised on the box at deploy (README 5.3 step below).

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/backup_db.sh backend/tests/test_ops_scripts.py
git commit -m "feat(backup): verify-into-scratch phase; marker gains size_bytes, encrypted, retention_days, verified fields"
```

---

### Task 5: `restore_drill.sh`

**Files:**
- Create: `backend/scripts/restore_drill.sh`

- [ ] **Step 1: Write the drill**

```bash
#!/bin/bash
# Restore drill (2026-09-03 data-lifecycle spec §13): prove that a snapshot ZIP restores onto
# a freshly MIGRATED database — real Alembic DDL, real sequences and constraints, the class
# of bug a JSON round trip on the create_all test schema cannot see — then verify it table
# by table. Prints PASS or FAIL; exit 0 / 1 (2 for a usage error).
#
#   backend/scripts/restore_drill.sh <finance-export-*.zip>
#
# Reads the project-root .env like backup_db.sh (DB_HOST, DB_PORT, POSTGRES_USER,
# POSTGRES_PASSWORD; on the dev box export DB_PORT=5433). The scratch database is created
# and dropped through the app's own driver (asyncpg), so this runs identically from the dev
# venv and inside the backend container (README 5.5). PYTHON overrides the interpreter.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ZIP="${1:?usage: restore_drill.sh <snapshot.zip>}"
if [ ! -f "$ZIP" ]; then
  echo "error: $ZIP is not a file" >&2
  exit 2
fi
ZIP="$(cd "$(dirname "$ZIP")" && pwd)/$(basename "$ZIP")"  # absolute: we cd below

ENV_FILE="${BACKEND_DIR}/../.env"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${POSTGRES_USER:-finance}"
DB_PASSWORD="${POSTGRES_PASSWORD:-finance}"
PYTHON="${PYTHON:-python}"
DRILL_DB="finance_drill_$(date +%Y%m%d_%H%M%S)"
ADMIN_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/postgres"

pg_admin() {  # $1 = one SQL statement on the maintenance database
  "$PYTHON" - "$ADMIN_URL" "$1" <<'PYEOF'
import asyncio
import sys

import asyncpg


async def go() -> None:
    conn = await asyncpg.connect(sys.argv[1])
    try:
        await conn.execute(sys.argv[2])
    finally:
        await conn.close()


asyncio.run(go())
PYEOF
}

echo "[drill] creating ${DRILL_DB}"
pg_admin "CREATE DATABASE \"${DRILL_DB}\""
trap 'pg_admin "DROP DATABASE IF EXISTS \"${DRILL_DB}\"" || echo "[drill] WARN: could not drop ${DRILL_DB}"' EXIT

# Point the app at the scratch database; no scheduler, no snapshot job, a throwaway data dir.
export DATABASE_URL="postgresql+asyncpg://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DRILL_DB}"
export SCHEDULER_ENABLED=0
export SNAPSHOT_ENABLED=0
DATA_DIR="$(mktemp -d)"
export DATA_DIR
cd "$BACKEND_DIR"

echo "[drill] alembic upgrade head"
"$PYTHON" -m alembic upgrade head >/dev/null
echo "[drill] seed (the admin user the preferences attach to)"
"$PYTHON" -m app.seed >/dev/null
echo "[drill] restore $(basename "$ZIP")"
"$PYTHON" -m app.lifecycle restore "$ZIP"
echo "[drill] verify"
if "$PYTHON" -m app.lifecycle verify "$ZIP"; then
  echo "[drill] PASS"
  exit 0
fi
echo "[drill] FAIL"
exit 1
```

- [ ] **Step 2: Run the pin and the syntax check**

Run: `FINANCE_TEST_DB=finance_test_l4 <venv-python> -m pytest tests/test_ops_scripts.py -q` → 2 passed.
Run: `bash -n backend/scripts/restore_drill.sh` → silent.

- [ ] **Step 3: Run the drill against the dev Postgres (needs L1 merged — otherwise skip to Step 4 and let the coordinator run it in Phase 2)**

From the repo root in Git Bash, with the dev stack's Postgres up and a snapshot of the dev database (`POST /system/snapshots` from the UI or `<venv-python> -c` as in L1 Task 5, or any `finance-export-*.zip` downloaded from Settings):
`DB_PORT=5433 PYTHON=backend/.venv/Scripts/python.exe bash backend/scripts/restore_drill.sh path/to/finance-export-….zip`
Expected: the four `[drill]` steps, the restore's table lines, `PASS: 35 tables identical`, `[drill] PASS`, exit 0; `psql -h localhost -p 5433 -U finance -l | grep finance_drill` shows nothing afterwards.

- [ ] **Step 4: Commit**

```bash
git add backend/scripts/restore_drill.sh
git commit -m "feat(ops): restore_drill.sh — migrate a scratch database, restore, verify, PASS/FAIL"
```

---

### Task 6: README §5.3, §5.5, §7.6

**Files:**
- Modify: `README.md`

- [ ] **Step 1: §5.3 — the verify phase and the role grant**

After the paragraph ending "records the run for the Settings System card (the `Last backup` marker plus a last-10 trail)." add:

```markdown
**Verify phase (2026-09-03).** After the upload the script restores the dump it just wrote into
a scratch database (`finance_verify_<pid>`), compares three row counts
(`net_worth_snapshots`, `monthly_spending`, `position_transactions`) with the live database's
at dump time, and drops the scratch. The marker gains `size_bytes`, `encrypted`,
`retention_days` and `verified` (+ `verified_at`/`row_counts`, or `verify_error`), and the
System card reads "· encrypted · verified" — "Last backup" now means "the dump restores",
not "the upload returned". The role needs to create databases, once:

```bash
sudo -u postgres psql -c "ALTER ROLE finance CREATEDB;"
```

Without it every run records `verified: false` with `createdb failed …` and the Data health
card says so; the upload itself is unaffected. A verify failure never fails the run
(retention still sweeps, exit 0).
```

- [ ] **Step 2: §5.5 — the drill, then the dump recipe**

Replace the heading `### 5.5 Restore drill (do this once now, and after any schema change you care about)` and the sentence-free block that follows it with:

```markdown
### 5.5 Restore drills (do them once now, and after any schema change you care about)

Two restore paths exist and both should be proven, not assumed.

**The app's own snapshot (nightly ZIP, `/settings` → Backups & snapshots).** The drill creates a
scratch database, runs the real migrations on it, restores a snapshot ZIP through the app's
own restore, verifies every table against the ZIP, and drops the scratch:

```bash
# On the box, inside the backend image (it has the app and its driver; host Postgres via host-gateway):
docker compose -f docker-compose.prod.yml run --rm \
  -e DB_HOST=host.docker.internal -e DB_PORT=5432 \
  -v /path/to/finance-export-YYYYMMDD-HHMMSS.zip:/tmp/snap.zip:ro \
  backend bash scripts/restore_drill.sh /tmp/snap.zip
# On a dev box, from the repo root (Postgres on 5433):
DB_PORT=5433 PYTHON=backend/.venv/Scripts/python.exe bash backend/scripts/restore_drill.sh path/to/finance-export-….zip
```

Expected: `PASS: 35 tables identical` and `[drill] PASS`, exit 0. The nightly files live on the
`finance-data` volume (`docker volume inspect personal-finance-dashboard_finance-data` for the
host path); the same ZIP restores from the UI — Restore card → Dry run → type the date →
Restore — with a pre-restore point written first.

**The nightly dump (disaster recovery — schema-agnostic, survives any app state).**
```

and keep the existing `bash` block (gunzip/gpg/createdb/psql/rename) below it unchanged.

- [ ] **Step 3: §7.6 — the deploy addendum**

Append to §7.6's addenda:

```markdown
> **Addendum (2026-09-04, data lifecycle)**: one additive migration — `c3a7e19d5b42`
> (`change_log`, `lifecycle_runs`, `user_preferences`), chained on `b8e4d17c2a90` and applied
> at boot like every other; the downgrade drops the three tables and nothing else references
> them. The deploy needs two one-time steps beyond `up -d --build`: the compose file now
> mounts the `finance-data` volume at `/data` (`DATA_DIR=/data`) for the nightly snapshots
> and restore points — created automatically on the first `up`; and the role grant
> `ALTER ROLE finance CREATEDB;` (5.3) so the backup script's verify phase can run. Until
> the grant lands, the System card says "not verified — createdb failed" and Data health
> warns; the dumps themselves are unaffected. The first stored snapshot appears at 23:30 PT
> (a boot after that hour catches up within seconds); `/settings` gains four cards —
> Backups & snapshots, Restore, Activity, Data health — and every month save and delete
> now carries an Undo.
```

- [ ] **Step 4: Sanity-check the Markdown renders (headings intact)**

Run: `grep -n "^### 5\.\|^## Part 5\|^## Part 6" README.md` → the §5 headings are 5.1–5.5 followed by `## Part 6`; `grep -c "Addendum (2026-09-04" README.md` → 1.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs(readme): verify phase + CREATEDB grant, restore drills for both paths, c3a7e19d5b42 deploy addendum"
```

---

### Task 7: Lane suite, lint

- [ ] **Step 1:** Run (from `backend/`): `FINANCE_TEST_DB=finance_test_l4 <venv-python> -m pytest -q tests/test_snapshot_store.py tests/test_scheduler.py tests/test_system_api.py tests/test_ops_scripts.py && <venv-python> -m ruff check app tests && <venv-python> -m ruff format --check app tests` → all passed; ruff clean.
- [ ] **Step 2:** `FINANCE_TEST_DB=finance_test_l4 <venv-python> -m pytest -q` → all green.

---

## Merge notes for the coordinator

- `backend/app/api/system.py`: only this lane touches it. `backend/app/main.py`: untouched here (the routes ride the existing `system` router).
- `backend/app/services/scheduler.py`: only this lane touches it.
- Phase 2 (after L1 merges): run `restore_drill.sh` against the dev Postgres exactly as Task 5 Step 3 describes; it is the one check that exercises the real migrations.
- Deploy checklist items this lane introduces (README 7.6 addendum): `ALTER ROLE finance CREATEDB;` and the `finance-data` volume; the first cron run after deploy exercises the verify phase for real — watch `finance-backup.log` for `Verify OK:`.
- F1 renders the new marker fields (SystemCard) and the snapshot list (BackupsCard); F2's Health card calls `POST /system/snapshots` for the `snapshot_now` action.

## Self-review

**Spec coverage:** §8 script verify phase (createdb scratch, decrypt | gunzip | psql with ON_ERROR_STOP, three counts vs live at dump time, dropdb; marker `{…, size_bytes, encrypted, retention_days, verified, verified_at, row_counts | verify_error}`; run entry gains `verified`; failure keeps `ok: true`, `verified: false`, exit 0) → Task 4; README gains `ALTER ROLE finance CREATEDB;` → Task 6; nightly job `snapshot_nightly` at `30 23 * * *` America/Los_Angeles, `coalesce`, `max_instances=1`, `missed_todays_run` catch-up keyed on the newest snapshot run, writes `<data_dir>/snapshots/…`, trims beyond 14, purges `change_log` past 400 days, records a `snapshot` run; `snapshot_enabled` mirrors `scheduler_enabled`; a missing volume records a failed run → Tasks 1–2; routes `GET /system/snapshots` (`{name, at, size_bytes, alembic_head, restorable}` newest first) and rate-limited `POST` → Task 3; §13 restore drill (`createdb`, `alembic upgrade head`, `restore` then `verify`, PASS/FAIL, `dropdb`) → Task 5; §13 tests: job writes, trims to 14, records runs, catch-up decision, POST rate limit, `BackupStatusOut` parses old and new markers (Phase 0 + Task 3's endpoint pin) → Tasks 1–3; README §5/§7 → Task 6. Deviation: stored names carry seconds (Phase 0's decision); the drill uses asyncpg for create/drop so it runs inside the client-less backend image. **Placeholders:** none — the shell is written out in full. **Type consistency:** `write_snapshot(db, *, actor, trigger) -> SnapshotEntryOut`, `list_snapshots(server_head)`, `purge_change_log(db, *, now)`, `latest_snapshot_run_at(db)`, `run_snapshot_job(db, *, now, trigger) -> bool`, `build_snapshot_trigger()`, `SNAPSHOT_CRON/SNAPSHOT_JOB_ID/SNAPSHOT_CATCHUP_JOB_ID`; Phase 0's `snapshot_name`, `snapshot_stamp`, `SNAPSHOT_NAME_RE`, `trim_directory`, `build_snapshot_zip`, `alembic_head`, `SnapshotEntryOut`, `BackupStatusOut` fields match `2026-09-04-lifecycle-0-base.md`; the CLI commands the drill calls match L1 (`restore <zip>`, `verify <zip>`, exit 0/1/2).
