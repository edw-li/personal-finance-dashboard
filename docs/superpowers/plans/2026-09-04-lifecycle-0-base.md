# Data lifecycle 0 — Base: migration, models, snapshot service, shared schemas and types — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land everything the six data-lifecycle lanes import (`docs/superpowers/specs/2026-09-03-data-lifecycle-design.md` §6, §12 "Phase 0"): the three models and the ONE migration (`c3a7e19d5b42` on `b8e4d17c2a90`), the export builder extracted into `services/snapshot.py` (with `json_cell`'s inverse beside it, the restore-point writer, and the data-directory conventions), the export pins updated, `settings.data_dir`/`snapshot_enabled`, the compose volume, every Pydantic wire shape and every TypeScript type the lanes share, the thin `api/lifecycle.ts` + `api/prefs.ts` fetchers, `apiWithHeaders`, and the pure `RestoreReportView`. No route, no card, no scheduler job — those are the lanes.

**Architecture:** One serial branch (`lifecycle-base`) forked from main AFTER the shell-1c merge (`b8e4d17c2a90` must be the alembic head). Backend: `models/lifecycle.py` + the migration; `api/export.py` becomes a ten-line shell over `services/snapshot.py`, which owns `EXPORTED_TABLES`, the cell spellings in BOTH directions, `build_snapshot_zip`, `write_restore_point` and the `<data_dir>/snapshots` / `<data_dir>/restore-points` conventions; `schemas/lifecycle.py` holds every lane's response model so no lane defines wire shapes. Frontend: the matching types in `types/api.ts`, thin fetchers, `apiWithHeaders` (the 204 + `X-Change-Batch` reader) and the one presentational component two lanes render.

**Tech Stack:** FastAPI 0.141, SQLAlchemy 2.0 async + asyncpg, Alembic 1.19, Pydantic 2.13, pytest-asyncio (session loop); React 19, TypeScript 5.9, vitest 3 + Testing Library.

**Worktree / commands:** Branch `lifecycle-base` from main. Backend from `<worktree>/backend` with the ROOT venv interpreter and a private test database:
`FINANCE_TEST_DB=finance_test_l0 ../../../backend/.venv/Scripts/python.exe -m pytest tests/<file> -q`
(`<venv-python>` below means that interpreter; adjust the relative path to the root `backend/.venv`). Frontend from the worktree root: `npx vitest run <file>` — the worktree needs a `node_modules` junction: `cmd /c mklink /J node_modules ..\..\node_modules` from the worktree root.

**Prerequisite check (do first):** `ls backend/alembic/versions | tail -1` prints `20260903_0900_b8e4d17c2a90_users_token_version.py` and `src/components/paletteRegistry.ts` exists. If not, the shell-1c merge has not landed — stop and wait; this plan chains its migration on `b8e4d17c2a90` (spec §3: never re-chain a shipped revision).

---

## File structure

| File | Responsibility |
|---|---|
| `backend/app/models/lifecycle.py` (new) | `ChangeLog`, `LifecycleRun`, `UserPreference` + the op/source/kind vocabularies |
| `backend/app/models/__init__.py` (modify) | register the three models |
| `backend/alembic/versions/20260904_0900_c3a7e19d5b42_lifecycle_tables.py` (new) | the one DDL revision |
| `backend/tests/test_models_lifecycle.py` (new) | round-trips |
| `backend/app/services/snapshot.py` (new) | `EXPORTED_TABLES`/`EXCLUDED_TABLES`/`REDACTED_ROWS` (moved), `csv_cell`/`json_cell`/`parse_cell`, `row_dict`/`json_row`/`csv_for_rows`, `alembic_head`, `build_snapshot_zip`, data-dir paths + name grammar, `trim_directory`, `write_restore_point` |
| `backend/app/api/export.py` (modify) | thin over the service |
| `backend/tests/test_export_api.py` (modify) | import path, pins, service≡endpoint |
| `backend/tests/test_snapshot_service.py` (new) | cell inverse, csv_for_rows, restore points |
| `backend/app/config.py` (modify) | `data_dir`, `snapshot_enabled` |
| `backend/tests/conftest.py` (modify) | isolated data dir, snapshots off |
| `backend/tests/test_config.py` (modify) | defaults |
| `.gitignore`, `docker-compose.prod.yml` (modify) | `backend/data/`, the `finance-data` volume |
| `backend/app/schemas/lifecycle.py` (new) | `RestoreReport`, `SnapshotEntryOut`, `ActivityOut` family, `PrefsOut`, `HealthOut` family |
| `backend/app/schemas/system.py`, `net_worth.py`, `spending.py` (modify) | marker fields, `batch_id` |
| `backend/tests/test_schemas_lifecycle.py` (new) | shapes parse; old and new backup markers |
| `src/types/api.ts` (modify) | the lifecycle types |
| `src/api/client.ts` (modify) | `apiWithHeaders`, `/prefs` → `shell` |
| `src/api/client.test.ts` (modify) | both |
| `src/api/lifecycle.ts`, `src/api/prefs.ts` (new) + tests | fetchers |
| `src/components/settings/RestoreReportView.tsx` (new) + test | pure report rendering |

---

### Task 1: The three models

**Files:**
- Create: `backend/app/models/lifecycle.py`
- Modify: `backend/app/models/__init__.py`
- Test: `backend/tests/test_models_lifecycle.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_models_lifecycle.py
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
        UserPreference(
            user_id=seeded_user.id, key="scope", value={"owner": "all", "range": "1y"}
        )
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
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `FINANCE_TEST_DB=finance_test_l0 <venv-python> -m pytest tests/test_models_lifecycle.py -q`
Expected: FAIL — `ImportError: cannot import name 'ChangeLog' from 'app.models'`.

- [ ] **Step 3: Write the models**

```python
# backend/app/models/lifecycle.py
"""Operational trails and per-user preferences (2026-09-03 data-lifecycle spec §6).

change_log is the application-level record of every money-bearing write (§9): one row per
changed database row, grouped by batch_id, with the export's own JSON spellings in `before`
and `after` so an undo can replay them through the same parser the restore uses. Summary
rows (op='batch') record an import, a restore or an undo as ONE line. lifecycle_runs is the
run trail (imports, restores, snapshots, restore points, undos) with the stored report.
user_preferences is one row per (user, key) with its own updated_at — the last-writer-wins
clock for two devices (§10). None of the three is exported: a restore must be RECORDED in
them, not replaced by them (services/snapshot.py's EXCLUDED_TABLES).
"""

import uuid
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import BigInteger, Date, DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

CHANGE_OPS = ("insert", "update", "delete", "batch")
CHANGE_SOURCES = ("ui", "import", "restore", "scheduler", "repair", "undo")
RUN_KINDS = ("import_xlsx", "restore", "snapshot", "restore_point", "undo")


def _now() -> datetime:
    return datetime.now(UTC)


class ChangeLog(Base):
    __tablename__ = "change_log"
    __table_args__ = (Index(None, "table_name", "at"),)  # -> ix_change_log_table_name_at

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    # Python default AND server default: ORM writers read the stamp back without a refresh
    # (expire_on_commit=False), raw SQL writers still get one.
    at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, server_default=func.now(), index=True
    )
    batch_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), index=True)
    source: Mapped[str] = mapped_column(String(12))  # one of CHANGE_SOURCES
    actor: Mapped[str | None] = mapped_column(String(255))
    label: Mapped[str] = mapped_column(Text)
    table_name: Mapped[str] = mapped_column(String(60))
    pk: Mapped[dict[str, Any]] = mapped_column(JSONB)
    op: Mapped[str] = mapped_column(String(6))  # one of CHANGE_OPS
    before: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    after: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    month: Mapped[date | None] = mapped_column(Date, index=True)


class LifecycleRun(Base):
    __tablename__ = "lifecycle_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, server_default=func.now(), index=True
    )
    kind: Mapped[str] = mapped_column(String(16))  # one of RUN_KINDS
    dry_run: Mapped[bool] = mapped_column(default=False)
    ok: Mapped[bool] = mapped_column(default=True)
    actor: Mapped[str | None] = mapped_column(String(255))
    filename: Mapped[str | None] = mapped_column(Text)
    size_bytes: Mapped[int | None] = mapped_column(BigInteger)
    report: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    error: Mapped[str | None] = mapped_column(Text)
    batch_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))


class UserPreference(Base):
    __tablename__ = "user_preferences"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    # Any JSON: 'dark', {"owner": "all", "range": "1y"}, ["nav:/", ...]. NOT NULL — a reset
    # DELETEs the row rather than storing a null (prefs router).
    value: Mapped[Any] = mapped_column(JSONB, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, server_default=func.now()
    )
```

In `backend/app/models/__init__.py` add `from app.models.lifecycle import ChangeLog, LifecycleRun, UserPreference` (alphabetically after the `household` import) and add `"ChangeLog"`, `"LifecycleRun"`, `"UserPreference"` to `__all__` in sorted position.

- [ ] **Step 4: Run the test**

Run: `FINANCE_TEST_DB=finance_test_l0 <venv-python> -m pytest tests/test_models_lifecycle.py -q`
Expected: 5 passed. (The test database is rebuilt from `Base.metadata` each session, so the tables exist without the migration.)

Then run: `FINANCE_TEST_DB=finance_test_l0 <venv-python> -m pytest tests/test_export_api.py -q`
Expected: `test_export_list_pins_every_metadata_table` FAILS — three new tables are neither exported nor excluded. That is the pin doing its job; Task 4 decides.

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/lifecycle.py backend/app/models/__init__.py backend/tests/test_models_lifecycle.py
git commit -m "feat(models): change_log, lifecycle_runs, user_preferences"
```

---

### Task 2: The migration `c3a7e19d5b42`

**Files:**
- Create: `backend/alembic/versions/20260904_0900_c3a7e19d5b42_lifecycle_tables.py`

- [ ] **Step 1: Confirm the head you chain on**

Run (from `backend/`): `<venv-python> -m alembic heads`
Expected: `b8e4d17c2a90 (head)`. Anything else — stop (see the prerequisite check).

- [ ] **Step 2: Write the migration**

```python
# backend/alembic/versions/20260904_0900_c3a7e19d5b42_lifecycle_tables.py
"""lifecycle tables — change_log, lifecycle_runs, user_preferences

The three operational tables of the 2026-09-03 data-lifecycle spec §6: the application-level
change log behind Activity and Undo, the run trail that stores import/restore reports, and
server-side preferences keyed per (user, key). Additive; the downgrade drops the three.

Revision ID: c3a7e19d5b42
Revises: b8e4d17c2a90
Create Date: 2026-09-04 09:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c3a7e19d5b42"
down_revision: str | Sequence[str] | None = "b8e4d17c2a90"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "change_log",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column(
            "at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column("batch_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source", sa.String(length=12), nullable=False),
        sa.Column("actor", sa.String(length=255), nullable=True),
        sa.Column("label", sa.Text(), nullable=False),
        sa.Column("table_name", sa.String(length=60), nullable=False),
        sa.Column("pk", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("op", sa.String(length=6), nullable=False),
        sa.Column("before", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("after", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("month", sa.Date(), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_change_log")),
    )
    op.create_index(op.f("ix_change_log_at"), "change_log", ["at"], unique=False)
    op.create_index(op.f("ix_change_log_batch_id"), "change_log", ["batch_id"], unique=False)
    op.create_index(op.f("ix_change_log_month"), "change_log", ["month"], unique=False)
    op.create_index(
        op.f("ix_change_log_table_name_at"), "change_log", ["table_name", "at"], unique=False
    )

    op.create_table(
        "lifecycle_runs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column(
            "at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("dry_run", sa.Boolean(), nullable=False),
        sa.Column("ok", sa.Boolean(), nullable=False),
        sa.Column("actor", sa.String(length=255), nullable=True),
        sa.Column("filename", sa.Text(), nullable=True),
        sa.Column("size_bytes", sa.BigInteger(), nullable=True),
        sa.Column("report", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("batch_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_lifecycle_runs")),
    )
    op.create_index(op.f("ix_lifecycle_runs_at"), "lifecycle_runs", ["at"], unique=False)

    op.create_table(
        "user_preferences",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("key", sa.String(length=60), nullable=False),
        sa.Column("value", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_user_preferences_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", "key", name=op.f("pk_user_preferences")),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("user_preferences")
    op.drop_index(op.f("ix_lifecycle_runs_at"), table_name="lifecycle_runs")
    op.drop_table("lifecycle_runs")
    op.drop_index(op.f("ix_change_log_table_name_at"), table_name="change_log")
    op.drop_index(op.f("ix_change_log_month"), table_name="change_log")
    op.drop_index(op.f("ix_change_log_batch_id"), table_name="change_log")
    op.drop_index(op.f("ix_change_log_at"), table_name="change_log")
    op.drop_table("change_log")
```

- [ ] **Step 3: Verify the chain and the rendered SQL**

Run (from `backend/`): `<venv-python> -m alembic heads` → `c3a7e19d5b42 (head)` — exactly ONE head.
Run: `<venv-python> -m alembic upgrade b8e4d17c2a90:c3a7e19d5b42 --sql | grep -c "CREATE TABLE"` → `3`.

- [ ] **Step 4: Apply to the DEV database and check model/migration agreement**

The dev Postgres is `localhost:5433` (`backend/docker-compose.yml`); start it with `docker compose -f backend/docker-compose.yml up -d db` from the repo root if it is down. Then from `backend/`:

Run: `<venv-python> -m alembic upgrade head` → applies `b8e4d17c2a90` (if the merge lane has not yet) and `c3a7e19d5b42`.
Run: `<venv-python> -m alembic check` → `No new upgrade operations detected.` (the ORM in Task 1 and this DDL agree on names, types and nullability — a mismatch prints the autogenerate diff; fix the MIGRATION to match the model, never the reverse).
Run: `<venv-python> -m alembic downgrade -1 && <venv-python> -m alembic upgrade head` → both clean (the downgrade is exercised once, here).

This is the dev database only. Never point `DATABASE_URL` at prod from a worktree.

- [ ] **Step 5: Commit**

```bash
git add backend/alembic/versions/20260904_0900_c3a7e19d5b42_lifecycle_tables.py
git commit -m "feat(db): migration c3a7e19d5b42 — change_log, lifecycle_runs, user_preferences"
```

---

### Task 3: Settings, gitignore, compose volume, isolated data dir

**Files:**
- Modify: `backend/app/config.py`, `backend/tests/conftest.py`, `.gitignore`, `docker-compose.prod.yml`
- Test: `backend/tests/test_config.py` (append)

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_config.py`:

```python
def test_lifecycle_config_defaults(monkeypatch):
    monkeypatch.delenv("DATA_DIR", raising=False)
    monkeypatch.delenv("SNAPSHOT_ENABLED", raising=False)
    s = Settings(_env_file=None)
    # ./data relative to the process cwd (backend/ in start.sh); prod mounts a volume at
    # /data and sets DATA_DIR=/data in docker-compose.prod.yml.
    assert s.data_dir == "./data"
    assert s.snapshot_enabled is True
```

- [ ] **Step 2: Run to verify it fails**

Run: `FINANCE_TEST_DB=finance_test_l0 <venv-python> -m pytest tests/test_config.py -q`
Expected: FAIL — `AttributeError: 'Settings' object has no attribute 'data_dir'`.

- [ ] **Step 3: Implement**

In `backend/app/config.py`, after `scheduler_enabled: bool = True` add:

```python
    # ── Data lifecycle (2026-09-03 spec §8) ────────────────────────────────────────
    # Where the nightly logical snapshots and pre-restore points live. Relative to the
    # process cwd on a dev box (./data, gitignored); prod mounts the finance-data volume at
    # /data and sets DATA_DIR=/data (docker-compose.prod.yml).
    data_dir: str = "./data"
    # Mirrors scheduler_enabled: the nightly snapshot job is added only when true (off in
    # tests — conftest pins it).
    snapshot_enabled: bool = True
```

In `backend/tests/conftest.py`, extend `_no_scheduler_in_tests` and add the data-dir fixture (Task 4's snapshot service writes files; every test gets its own empty tree so nothing lands in `./data`):

```python
@pytest.fixture(scope="session", autouse=True)
def _no_scheduler_in_tests():
    # ASGITransport never runs the lifespan today; pin the invariant for any future
    # TestClient/LifespanManager use (Task 7 review M7). The snapshot job rides the same
    # scheduler and is pinned off the same way (2026-09-03 data-lifecycle spec §8).
    settings.scheduler_enabled = False
    settings.snapshot_enabled = False


@pytest.fixture(autouse=True)
def _isolated_data_dir(tmp_path, monkeypatch):
    # Snapshots and restore points are FILES (2026-09-03 data-lifecycle spec §8); every test
    # gets its own empty tree so one test's ZIPs never read as another's, and nothing lands
    # in ./data. Restored by monkeypatch; settings is the module singleton the code reads.
    monkeypatch.setattr(settings, "data_dir", str(tmp_path / "data"))
```

In `.gitignore`, under `# Tooling leftovers` add a block:

```
# Data volume on a dev box: nightly snapshots and restore points (data-lifecycle spec §8)
backend/data/
```

In `docker-compose.prod.yml`, in the `backend` service add after `NVIDIA_API_KEY: ${NVIDIA_API_KEY:-}`:

```yaml
      # Nightly logical snapshots + restore points (data-lifecycle spec §8) live on a
      # named volume so they survive a rebuild; the app writes, never the host cron.
      DATA_DIR: /data
    volumes:
      - finance-data:/data
```

and at the end of the file (top level):

```yaml
volumes:
  finance-data:
```

- [ ] **Step 4: Run the tests and validate the compose file**

Run: `FINANCE_TEST_DB=finance_test_l0 <venv-python> -m pytest tests/test_config.py tests/test_export_api.py -q` → the config test passes; the export pin still FAILS (Task 4 resolves it).
Run (repo root): `docker compose -f docker-compose.prod.yml config --quiet` → no output (valid YAML; it will complain about missing `.env` variables with `:?` guards — pass dummies: `POSTGRES_PASSWORD=x SECRET_KEY=x ADMIN_EMAIL=x ADMIN_PASSWORD=x docker compose -f docker-compose.prod.yml config --quiet`).

- [ ] **Step 5: Commit**

```bash
git add backend/app/config.py backend/tests/conftest.py backend/tests/test_config.py .gitignore docker-compose.prod.yml
git commit -m "feat(config): data_dir + snapshot_enabled; finance-data volume; gitignore backend/data"
```

---

### Task 4: `services/snapshot.py` — the export as a service, cells in both directions, export thinned

**Files:**
- Create: `backend/app/services/snapshot.py`
- Modify: `backend/app/api/export.py` (replace the body), `backend/tests/test_export_api.py`
- Test: `backend/tests/test_snapshot_service.py`

- [ ] **Step 1: Update the export test's imports and pins, and add the service≡endpoint test**

In `backend/tests/test_export_api.py` change the import line

```python
from app.api.export import EXCLUDED_TABLES, EXPORTED_TABLES, REDACTED_ROWS
```
to
```python
from app.services.snapshot import (
    EXCLUDED_TABLES,
    EXPORTED_TABLES,
    REDACTED_ROWS,
    build_snapshot_zip,
)
```

and append to the file:

```python
def test_export_pins_the_lifecycle_decisions():
    # The three operational tables are NAMED exclusions with a reason (spec §6): a restore
    # must be recorded in them, not replaced by them. Preferences are user data and export.
    assert EXCLUDED_TABLES == frozenset({"users", "change_log", "lifecycle_runs"})
    assert "user_preferences" in {table for _, table in EXPORTED_TABLES}


async def test_service_and_endpoint_build_the_same_archive(auth_client, db):
    # The extraction (spec §12 Phase 0) must be byte-identical below the timestamp: every
    # CSV member equal, the manifest equal once exported_at is set aside, same member list.
    account = Account(name="Café Fund", slug="cafe-fund", group="cash", sort_order=2)
    db.add(account)
    db.add(AppSetting(key="swr_pct", value={"value": "0.04"}))
    await db.commit()
    built = await build_snapshot_zip(db)
    resp = await auth_client.get(EXPORT)
    assert resp.status_code == 200, resp.text
    ours = zipfile.ZipFile(io.BytesIO(built.payload))
    theirs = zipfile.ZipFile(io.BytesIO(resp.content))
    assert ours.namelist() == theirs.namelist()
    for name in ours.namelist():
        if name.startswith("csv/"):
            assert ours.read(name) == theirs.read(name), name
    manifest_a = json.loads(ours.read("manifest.json"))
    manifest_b = json.loads(theirs.read("manifest.json"))
    manifest_a.pop("exported_at")
    manifest_b.pop("exported_at")
    assert manifest_a == manifest_b
    assert built.counts["accounts"] == 1 and built.counts["app_settings"] == 1
    assert re.fullmatch(r"finance-export-\d{8}-\d{4}\.zip", built.filename)
```

- [ ] **Step 2: Write the failing service tests**

```python
# backend/tests/test_snapshot_service.py
import re
from datetime import UTC, date, datetime
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.config import settings
from app.models import Account, AccountBalance, AppSetting, LatestPrice, LifecycleRun, NetWorthSnapshot
from app.services.snapshot import (
    RESTORE_POINT_NAME_RE,
    RESTORE_POINTS_KEEP,
    SNAPSHOT_NAME_RE,
    csv_for_rows,
    json_cell,
    json_row,
    parse_cell,
    restore_points_dir,
    row_dict,
    snapshot_name,
    snapshot_stamp,
    snapshots_dir,
    trim_directory,
    write_restore_point,
)


@pytest.mark.parametrize(
    ("column", "raw", "expected"),
    [
        (AccountBalance.__table__.c.balance, "1234.50", Decimal("1234.50")),
        (NetWorthSnapshot.__table__.c.month, "2026-05-01", date(2026, 5, 1)),
        (
            LatestPrice.__table__.c.quoted_at,
            "2026-08-17T00:00:00+00:00",
            datetime(2026, 8, 17, tzinfo=UTC),
        ),
        (Account.__table__.c.is_active, True, True),
        (Account.__table__.c.sort_order, 2, 2),
        (Account.__table__.c.name, "Café Fund", "Café Fund"),
        (Account.__table__.c.parent_account_id, None, None),
        (AppSetting.__table__.c.value, {"value": "0.04"}, {"value": "0.04"}),
        (AppSetting.__table__.c.value, ["a", "b"], ["a", "b"]),
    ],
)
def test_parse_cell_inverts_json_cell(column, raw, expected):
    parsed = parse_cell(column, raw)
    assert parsed == expected
    assert type(parsed) is type(expected)
    # And back: the two spellings live side by side so they cannot drift (spec §7).
    assert json_cell(parsed) == raw


def test_parse_cell_refuses_a_non_boolean_for_a_boolean_column():
    with pytest.raises(ValueError, match="is_active"):
        parse_cell(Account.__table__.c.is_active, "true")


async def test_row_helpers_and_csv_for_rows_match_the_export_spellings(db):
    snapshot = NetWorthSnapshot(month=date(2026, 5, 1), recorded_on=date(2026, 5, 3), notes=None)
    account = Account(name="Café Fund", slug="cafe-fund", group="cash", sort_order=2)
    db.add_all([snapshot, account])
    await db.flush()
    db.add(AccountBalance(snapshot_id=snapshot.id, account_id=account.id, balance=Decimal("1234.50")))
    await db.commit()
    columns = list(Account.__table__.columns)
    raw = row_dict(account, columns)
    assert raw["name"] == "Café Fund" and raw["parent_account_id"] is None
    assert json_row(account) == {
        "id": account.id,
        "name": "Café Fund",
        "slug": "cafe-fund",
        "group": "cash",
        "sort_order": 2,
        "is_active": True,
        "is_component": False,
        "parent_account_id": None,
        "person_id": None,
    }
    text = csv_for_rows(columns, [raw])
    assert text.splitlines() == [
        "id,name,slug,group,sort_order,is_active,is_component,parent_account_id,person_id",
        f"{account.id},Café Fund,cafe-fund,cash,2,true,false,,",
    ]
    balance = (await db.execute(select(AccountBalance))).scalar_one()
    balance_text = csv_for_rows(list(AccountBalance.__table__.columns), [row_dict(balance, list(AccountBalance.__table__.columns))])
    assert balance_text.splitlines()[1].endswith(",1234.50")
    # Parsed JSON rows write the SAME csv as live rows — the restore's identity hash relies on it.
    parsed = {c.key: parse_cell(c, v) for c, v in zip(columns, json_row(account).values(), strict=True)}
    assert csv_for_rows(columns, [parsed]) == text


def test_name_grammar():
    stamp = datetime(2026, 9, 4, 23, 30, 5, tzinfo=UTC)
    assert snapshot_name(stamp) == "finance-export-20260904-233005.zip"
    assert snapshot_stamp("finance-export-20260904-233005.zip") == stamp
    assert snapshot_stamp("finance-export-2026.zip") is None
    assert SNAPSHOT_NAME_RE.fullmatch("../finance-export-20260904-233005.zip") is None
    assert RESTORE_POINT_NAME_RE.fullmatch("pre-restore-20260904-233005-123456.zip")
    assert snapshots_dir().parent == restore_points_dir().parent


def test_data_dir_is_isolated_per_test(tmp_path):
    # conftest points settings.data_dir at a per-test tmp tree; nothing lands in ./data.
    assert str(tmp_path) in settings.data_dir


def test_trim_directory_keeps_the_newest_names(tmp_path):
    for stamp in ("20260901-000000-000001", "20260902-000000-000001", "20260903-000000-000001", "20260904-000000-000001"):
        (tmp_path / f"pre-restore-{stamp}.zip").write_bytes(b"x")
    (tmp_path / "unrelated.txt").write_bytes(b"x")
    removed = trim_directory(tmp_path, RESTORE_POINT_NAME_RE, keep=3)
    assert removed == ["pre-restore-20260901-000000-000001.zip"]
    assert sorted(p.name for p in tmp_path.iterdir()) == [
        "pre-restore-20260902-000000-000001.zip",
        "pre-restore-20260903-000000-000001.zip",
        "pre-restore-20260904-000000-000001.zip",
        "unrelated.txt",
    ]


async def test_write_restore_point_writes_trims_and_records(db):
    db.add(Account(name="A", slug="a", group="cash", sort_order=1))
    await db.commit()
    points = []
    for _ in range(RESTORE_POINTS_KEEP + 1):
        points.append(await write_restore_point(db, actor="me@example.com"))
    names = sorted(p.name for p in restore_points_dir().iterdir())
    assert len(names) == RESTORE_POINTS_KEEP  # the oldest was trimmed
    assert names == sorted(p.name for p in points)[1:]
    assert all(RESTORE_POINT_NAME_RE.fullmatch(n) for n in names)
    assert points[-1].size_bytes == points[-1].path.stat().st_size > 0
    runs = (await db.execute(select(LifecycleRun).order_by(LifecycleRun.id))).scalars().all()
    assert [r.kind for r in runs] == ["restore_point"] * (RESTORE_POINTS_KEEP + 1)
    assert runs[-1].filename == points[-1].name
    assert runs[-1].actor == "me@example.com" and runs[-1].ok is True
    assert runs[-1].report == {"tables": {**{t: 0 for _, t in __import__("app.services.snapshot", fromlist=["EXPORTED_TABLES"]).EXPORTED_TABLES}, "accounts": 1}}
    assert re.fullmatch(r"pre-restore-\d{8}-\d{6}-\d{6}\.zip", points[0].name)
```

- [ ] **Step 3: Run both files to verify they fail**

Run: `FINANCE_TEST_DB=finance_test_l0 <venv-python> -m pytest tests/test_snapshot_service.py tests/test_export_api.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.snapshot'`.

- [ ] **Step 4: Write the service**

```python
# backend/app/services/snapshot.py
"""The export ZIP as a service (2026-09-03 data-lifecycle spec §6): one builder shared by
GET /export/snapshot, the nightly stored snapshot, the pre-restore/pre-import restore point
and the restore's identity hashing. The table list is HAND-MAINTAINED, not reflected: a
future table must be a conscious export decision, and test_export_api pins the list
against Base.metadata so forgetting one fails the suite until it is listed here or named
in EXCLUDED_TABLES.

Cell spellings live here in BOTH directions — json_cell (export) and parse_cell (restore,
undo) side by side — so they cannot drift (spec §7).
"""

import asyncio
import csv
import io
import json
import re
import zipfile
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path

from sqlalchemy import Column, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import sqltypes

from app.config import settings
from app.models import (
    Account,
    AccountBalance,
    AppSetting,
    CardCredit,
    CategoryBudget,
    CompEvent,
    ContributionLimit,
    CreditCard,
    CreditLimitEvent,
    CustomEvent,
    DividendPayment,
    EsppLot,
    EsppOffering,
    EsppPeriod,
    LatestPrice,
    LifecycleRun,
    MonthlyCashflow,
    MonthlySpending,
    NetWorthSnapshot,
    PaycheckProfile,
    Person,
    PortfolioAccount,
    PortfolioValueHistory,
    PositionTransaction,
    PriceHistory,
    RewardCategory,
    RewardRate,
    RsuGrant,
    Security,
    SecurityDividendEvent,
    SpendingCategory,
    TaxBracket,
    TaxInput,
    TaxInputDefinition,
    TaxYear,
    UserPreference,
)
from app.services.assistant_models import KEY_SETTING

# Every user-data table, in the spec's order (2026-08-31 §B1 + user_preferences). `users`
# is excluded — password hash, and on a single-user app nothing else in it is worth
# exporting; `alembic_version` is not a Base.metadata table at all (the manifest carries
# the head instead).
EXPORTED_TABLES: tuple[tuple[type, str], ...] = (
    (Account, "accounts"),
    (NetWorthSnapshot, "net_worth_snapshots"),
    (AccountBalance, "account_balances"),
    (SpendingCategory, "spending_categories"),
    (MonthlySpending, "monthly_spending"),
    (MonthlyCashflow, "monthly_cashflow"),
    (CategoryBudget, "category_budgets"),
    (Security, "securities"),
    (PortfolioAccount, "portfolio_accounts"),
    (PositionTransaction, "position_transactions"),
    (DividendPayment, "dividend_payments"),
    (LatestPrice, "latest_prices"),
    (PriceHistory, "price_history"),
    (SecurityDividendEvent, "security_dividend_events"),
    (PortfolioValueHistory, "portfolio_value_history"),
    (TaxYear, "tax_years"),
    (TaxBracket, "tax_brackets"),
    (TaxInputDefinition, "tax_input_definitions"),
    (TaxInput, "tax_inputs"),
    (EsppLot, "espp_lots"),
    (EsppPeriod, "espp_periods"),
    (EsppOffering, "espp_offerings"),
    (PaycheckProfile, "paycheck_profiles"),
    (CompEvent, "comp_events"),
    (RsuGrant, "rsu_grants"),
    (CreditCard, "credit_cards"),
    (CardCredit, "card_credits"),
    (RewardCategory, "reward_categories"),
    (RewardRate, "reward_rates"),
    (CreditLimitEvent, "credit_limit_events"),
    (ContributionLimit, "contribution_limits"),
    (CustomEvent, "custom_events"),
    (Person, "people"),
    (AppSetting, "app_settings"),
    (UserPreference, "user_preferences"),
)

# Operational trails are NOT exported — a restore must be recorded in them, not replaced
# by them (spec §6); users carries the password hash.
EXCLUDED_TABLES = frozenset({"users", "change_log", "lifecycle_runs"})

# Redacted ROWS (assistant spec 2026-09-01 §3): the assistant API key must not ride into
# every export ZIP. Keyed by table name; the filter reads `row.key`, so a listed table MUST
# have a `key` column (pinned by test_export_list_pins_every_metadata_table).
REDACTED_ROWS: dict[str, frozenset[str]] = {"app_settings": frozenset({KEY_SETTING})}

# File-name grammar for the data volume (spec §8). Stored snapshots carry SECONDS (the
# download filename keeps HHMM) so a manual "Snapshot now" in the nightly's minute cannot
# overwrite it; restore points add microseconds for the same reason. Both anchored, so a
# name from a URL can never carry a path separator.
SNAPSHOT_NAME_RE = re.compile(r"^finance-export-(\d{8})-(\d{6})\.zip$")
RESTORE_POINT_NAME_RE = re.compile(r"^pre-restore-\d{8}-\d{6}-\d{6}\.zip$")
RESTORE_POINTS_KEEP = 3


def data_root() -> Path:
    return Path(settings.data_dir)


def snapshots_dir() -> Path:
    return data_root() / "snapshots"


def restore_points_dir() -> Path:
    return data_root() / "restore-points"


def snapshot_name(at: datetime) -> str:
    return f"finance-export-{at.astimezone(UTC):%Y%m%d-%H%M%S}.zip"


def snapshot_stamp(name: str) -> datetime | None:
    """The UTC instant a stored snapshot's name encodes, or None for a foreign name."""
    match = SNAPSHOT_NAME_RE.fullmatch(name)
    if match is None:
        return None
    try:
        return datetime.strptime(f"{match.group(1)}{match.group(2)}", "%Y%m%d%H%M%S").replace(
            tzinfo=UTC
        )
    except ValueError:
        return None


def csv_cell(value: object) -> str:
    """One CSV spelling per type (2026-08-31 §B1): NULL is the EMPTY cell, Decimals are
    plain strings (format 'f' — str() can spell exponents), dates ISO, booleans lowercase
    true/false, JSONB compact JSON. csv.writer supplies the RFC-4180 quoting."""
    if value is None:
        return ""
    if isinstance(value, bool):  # before anything numeric-adjacent: bool subclasses int
        return "true" if value else "false"
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, date):  # datetime subclasses date; isoformat serves both
        return value.isoformat()
    if isinstance(value, dict | list):
        return json.dumps(value, separators=(",", ":"), sort_keys=True)
    return str(value)


def json_cell(value: object) -> object:
    """The JSON twin: identical spellings for Decimal and dates, but None/bool/int/str and
    JSONB structures stay native — this file exists for programmatic re-import."""
    if isinstance(value, bool):
        return value
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, date):
        return value.isoformat()
    return value


def parse_cell(column: Column, raw: object) -> object:
    """json_cell's inverse, keyed on the COLUMN's type — the restore and the undo replay
    both read finance-export.json spellings back into what the ORM would have held.
    ValueError (never a bare TypeError) names the column so a router can 422 with it."""
    if raw is None:
        return None
    kind = column.type
    try:
        if isinstance(kind, sqltypes.JSON):
            return raw  # dict or list, native either way
        if isinstance(kind, sqltypes.Boolean):
            if not isinstance(raw, bool):
                raise ValueError(f"{column.table.name}.{column.key}: expected a boolean")
            return raw
        if isinstance(kind, sqltypes.Numeric):  # Numeric and its subclasses; NOT Integer
            return Decimal(str(raw))
        if isinstance(kind, sqltypes.Integer):
            if isinstance(raw, bool):
                raise ValueError(f"{column.table.name}.{column.key}: expected an integer")
            return int(raw)
        if isinstance(kind, sqltypes.DateTime):
            return datetime.fromisoformat(str(raw))
        if isinstance(kind, sqltypes.Date):
            return date.fromisoformat(str(raw))
        return str(raw)
    except (ValueError, TypeError, ArithmeticError) as exc:
        raise ValueError(f"{column.table.name}.{column.key}: {raw!r} does not parse") from exc


def row_dict(obj: object, columns: list[Column]) -> dict[str, object]:
    """Raw Python values in model-definition column order."""
    return {column.key: getattr(obj, column.key) for column in columns}


def json_row(obj: object) -> dict[str, object]:
    """The export's JSON spelling of one ORM row — also the change log's row image (§9)."""
    return {
        column.key: json_cell(getattr(obj, column.key)) for column in obj.__table__.columns
    }


def csv_for_rows(columns: list[Column], rows: Iterable[Mapping[str, object]]) -> str:
    """The CSV member for one table. Rows are mappings of RAW values (row_dict, or parse_cell
    output), so live rows and parsed snapshot rows write byte-identical text — which is
    what lets the restore call a table `identical` by hash."""
    sink = io.StringIO()
    writer = csv.writer(sink)  # csv's default \r\n line ending IS RFC 4180's
    writer.writerow([column.key for column in columns])
    for row in rows:
        writer.writerow([csv_cell(row.get(column.key)) for column in columns])
    return sink.getvalue()


async def alembic_head(db: AsyncSession) -> str | None:
    """The system router's exact probe: to_regclass, not try/except — a missing
    alembic_version is an EXPECTED state (create_all-built databases, every test run), and
    a failed SELECT would abort the session's transaction mid-request."""
    has_alembic = (
        await db.execute(text("SELECT to_regclass('alembic_version') IS NOT NULL"))
    ).scalar_one()
    if not has_alembic:
        return None
    head_row = await db.execute(text("SELECT version_num FROM alembic_version"))
    return head_row.scalars().first()


@dataclass(frozen=True)
class SnapshotZip:
    payload: bytes
    filename: str  # the download name, HHMM like every export before it
    exported_at: datetime
    alembic_head: str | None
    counts: dict[str, int]


async def build_snapshot_zip(db: AsyncSession) -> SnapshotZip:
    exported_at = datetime.now(UTC)
    head = await alembic_head(db)
    counts: dict[str, int] = {}
    json_tables: dict[str, list[dict[str, object]]] = {}
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for model, table_name in EXPORTED_TABLES:
            columns = list(model.__table__.columns)  # model-definition order
            rows = (
                (
                    await db.execute(
                        # Ordered by primary key so two exports of the same data are
                        # byte-identical (diffable backups).
                        select(model).order_by(*model.__table__.primary_key.columns)
                    )
                )
                .scalars()
                .all()
            )
            redacted_keys = REDACTED_ROWS.get(table_name)
            if redacted_keys is not None:
                rows = [row for row in rows if row.key not in redacted_keys]
            counts[table_name] = len(rows)
            raw_rows = [row_dict(row, columns) for row in rows]
            archive.writestr(f"csv/{table_name}.csv", csv_for_rows(columns, raw_rows))
            json_tables[table_name] = [
                {key: json_cell(value) for key, value in raw.items()} for raw in raw_rows
            ]
        manifest = {
            "exported_at": exported_at.isoformat(),
            "environment": settings.environment,
            "alembic_head": head,
            "app": "personal-finance-dashboard",
            "note": (
                "full user-data export; users and alembic_version are excluded by design; "
                "see redactions for withheld rows"
            ),
            "tables": counts,
            "redactions": [
                f"{table}.{key}"
                for table, keys in sorted(REDACTED_ROWS.items())
                for key in sorted(keys)
            ],
        }
        archive.writestr("manifest.json", json.dumps(manifest, indent=2))
        archive.writestr(
            "finance-export.json",
            json.dumps(
                {
                    "exported_at": exported_at.isoformat(),
                    "alembic_head": head,
                    "tables": json_tables,
                },
                indent=2,
            ),
        )
    return SnapshotZip(
        payload=buffer.getvalue(),
        filename=f"finance-export-{exported_at:%Y%m%d-%H%M}.zip",
        exported_at=exported_at,
        alembic_head=head,
        counts=counts,
    )


def trim_directory(directory: Path, pattern: re.Pattern[str], keep: int) -> list[str]:
    """Delete every file matching `pattern` beyond the newest `keep` (names sort
    chronologically by construction). Returns the removed names. Sync — callers in async
    code wrap it in asyncio.to_thread."""
    names = sorted((p.name for p in directory.iterdir() if pattern.fullmatch(p.name)), reverse=True)
    removed = names[keep:]
    for name in removed:
        (directory / name).unlink()
    return removed


def _write_file(directory: Path, name: str, payload: bytes, pattern: re.Pattern[str], keep: int) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / name
    path.write_bytes(payload)
    trim_directory(directory, pattern, keep)
    return path


@dataclass(frozen=True)
class RestorePoint:
    name: str
    path: Path
    size_bytes: int
    run_id: int


async def write_restore_point(db: AsyncSession, *, actor: str | None) -> RestorePoint:
    """The current database's ZIP to <data_dir>/restore-points, keep three, recorded as a
    `restore_point` run (spec §7 step 1, §9 imports). COMMITS its own run row before
    returning: a restore or import that then fails and rolls back must still leave the
    point listed. File IO rides to_thread — blocking writes on the event loop are the
    ASYNC rules' whole complaint."""
    snap = await build_snapshot_zip(db)
    name = f"pre-restore-{snap.exported_at:%Y%m%d-%H%M%S-%f}.zip"
    path = await asyncio.to_thread(
        _write_file, restore_points_dir(), name, snap.payload, RESTORE_POINT_NAME_RE, RESTORE_POINTS_KEEP
    )
    run = LifecycleRun(
        kind="restore_point",
        dry_run=False,
        ok=True,
        actor=actor,
        filename=name,
        size_bytes=len(snap.payload),
        report={"tables": snap.counts},
    )
    db.add(run)
    await db.commit()
    return RestorePoint(name=name, path=path, size_bytes=len(snap.payload), run_id=run.id)
```

Replace `backend/app/api/export.py` wholesale:

```python
# backend/app/api/export.py
"""Full-data export (2026-08-31 tier-1 spec §B1): one auth-gated GET streaming the ZIP the
snapshot service builds. Thin by design (2026-09-03 data-lifecycle spec §6) — the table
list, the cell spellings and the archive layout live in services/snapshot.py, shared with
the nightly stored snapshot, the restore points and the restore itself."""

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.services.snapshot import build_snapshot_zip

router = APIRouter(prefix="/export", tags=["export"], dependencies=[Depends(get_current_user)])


@router.get("/snapshot")
async def export_snapshot(db: AsyncSession = Depends(get_db)) -> StreamingResponse:
    snap = await build_snapshot_zip(db)
    return StreamingResponse(
        iter([snap.payload]),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{snap.filename}"',
            "Content-Length": str(len(snap.payload)),
        },
    )
```

- [ ] **Step 5: Run the tests**

Run: `FINANCE_TEST_DB=finance_test_l0 <venv-python> -m pytest tests/test_snapshot_service.py tests/test_export_api.py -q`
Expected: all passed — including the metadata pin (three exclusions named, `user_preferences` exported) and the service≡endpoint comparison.

Run: `<venv-python> -m ruff check app tests && <venv-python> -m ruff format --check app tests`
Expected: clean (long lines in the test file: run `ruff format tests/test_snapshot_service.py`).

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/snapshot.py backend/app/api/export.py backend/tests/test_export_api.py backend/tests/test_snapshot_service.py
git commit -m "refactor(export): snapshot service — builder, cell spellings both ways, data-dir grammar, restore points"
```

---

### Task 5: Shared Pydantic wire shapes

**Files:**
- Create: `backend/app/schemas/lifecycle.py`
- Modify: `backend/app/schemas/system.py` (`BackupStatusOut`, `BackupRunOut`), `backend/app/schemas/net_worth.py` (`MonthUpsertResult`), `backend/app/schemas/spending.py` (`SpendingUpsertResult`)
- Test: `backend/tests/test_schemas_lifecycle.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_schemas_lifecycle.py
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas.lifecycle import (
    ActivityBatchOut,
    ActivityOut,
    ActivityRunDetailOut,
    ActivityRunOut,
    HealthCheckOut,
    HealthFixOut,
    HealthOut,
    PrefEntryOut,
    PrefsOut,
    RestoreReport,
    RestoreSchema,
    RestoreTableDiff,
    SnapshotEntryOut,
)
from app.schemas.net_worth import MonthUpsertResult
from app.schemas.spending import SpendingUpsertResult
from app.schemas.system import BackupRunOut, BackupStatusOut

NOW = datetime(2026, 9, 4, 3, 0, tzinfo=UTC)


def test_restore_report_serializes_schema_under_its_wire_name():
    report = RestoreReport(
        dry_run=True,
        applied=False,
        exported_at=NOW,
        schema=RestoreSchema(snapshot_head="c3a7e19d5b42", server_head="c3a7e19d5b42", compatible=True),
        tables={"accounts": RestoreTableDiff(current=3, incoming=3, identical=True)},
        preserved_settings=["backup_status"],
        warnings=[],
        errors=[],
        restore_point=None,
        batch_id=None,
        run_id=None,
    )
    body = report.model_dump(mode="json")
    # `schema` shadows a BaseModel attribute, so the field is schema_ with an alias — the
    # WIRE says schema (spec §7), by_alias on both dump and FastAPI's response path.
    assert body["schema"] == {
        "snapshot_head": "c3a7e19d5b42",
        "server_head": "c3a7e19d5b42",
        "compatible": True,
    }
    assert "schema_" not in body
    assert RestoreReport.model_validate(body).schema_.compatible is True


def test_activity_entries_are_discriminated_by_type():
    batch = ActivityBatchOut(
        batch_id=uuid4(), at=NOW, source="ui", actor="me@example.com",
        label="Saved Sep 2026 balances — 19 updated", month=None, rows=19, undoable=True, undone_by=None,
    )
    run = ActivityRunOut(
        run_id=1, at=NOW, kind="snapshot", ok=True, dry_run=False,
        filename="finance-export-20260904-233000.zip", size_bytes=1024, has_report=True,
    )
    page = ActivityOut(entries=[batch, run], next_before=None)
    body = page.model_dump(mode="json")
    assert [e["type"] for e in body["entries"]] == ["batch", "run"]
    parsed = ActivityOut.model_validate(body)
    assert isinstance(parsed.entries[0], ActivityBatchOut)
    assert isinstance(parsed.entries[1], ActivityRunOut)
    detail = ActivityRunDetailOut(run=run, report={"dry_run": False})
    assert detail.model_dump(mode="json")["report"] == {"dry_run": False}


def test_snapshot_entry_prefs_and_health_shapes():
    entry = SnapshotEntryOut(
        name="finance-export-20260904-233000.zip", at=NOW, size_bytes=2048,
        alembic_head="c3a7e19d5b42", restorable=True,
    )
    assert entry.model_dump(mode="json")["restorable"] is True
    prefs = PrefsOut(prefs={"theme": PrefEntryOut(value="dark", updated_at=NOW)})
    assert prefs.model_dump(mode="json")["prefs"]["theme"]["value"] == "dark"
    check = HealthCheckOut(
        id="zero_filled_spending", severity="error", title="Zero-filled spending month",
        detail="19 rows of $0.00 with no take-home", count=1, months=["2026-09-01"],
        fix=HealthFixOut(kind="action", action="delete_spending_month", label="Delete the month"),
    )
    health = HealthOut(checked_at=NOW, checks=[check])
    body = health.model_dump(mode="json")
    assert body["checks"][0]["months"] == ["2026-09-01"]
    assert body["checks"][0]["fix"]["to"] is None
    with pytest.raises(ValidationError):
        HealthCheckOut(id="x", severity="loud", title="t", detail="d")


def test_backup_status_parses_old_and_new_markers():
    old = BackupStatusOut.model_validate(
        {"last_success_at": "2026-08-25T09:10:11Z", "object_key": "backups/f.sql.gz", "size": "1.2M"}
    )
    assert old.verified is None and old.size_bytes is None and old.encrypted is None
    new = BackupStatusOut.model_validate(
        {
            "last_success_at": "2026-09-04T03:00:12Z",
            "object_key": "backups/finance_2026-09-04.sql.gz.gpg",
            "size": "108K",
            "size_bytes": 110592,
            "encrypted": True,
            "retention_days": 30,
            "verified": True,
            "verified_at": "2026-09-04T03:00:40Z",
            "row_counts": {"net_worth_snapshots": 33, "monthly_spending": 621, "position_transactions": 210},
        }
    )
    assert new.verified is True and new.row_counts["monthly_spending"] == 621
    failed = BackupStatusOut.model_validate(
        {
            "last_success_at": "2026-09-04T03:00:12Z", "object_key": "k", "size": "108K",
            "verified": False, "verify_error": "row count mismatch: monthly_spending 621 != 600",
        }
    )
    assert failed.verified is False and failed.verify_error.startswith("row count")
    run = BackupRunOut.model_validate({"at": "2026-09-04T03:00:12Z", "ok": True, "object": "k", "verified": True})
    assert run.verified is True
    assert BackupRunOut.model_validate({"at": "2026-09-04T03:00:12Z", "ok": True}).verified is None


def test_upsert_results_carry_an_optional_batch_id():
    month = MonthUpsertResult(month="2026-09-01", snapshot_created=False, created=0, updated=1, unchanged=3)
    assert month.batch_id is None
    spend = SpendingUpsertResult(month="2026-09-01", created=0, updated=0, unchanged=3, net_pay_set=False)
    assert spend.model_dump(mode="json")["batch_id"] is None
    assert MonthUpsertResult(month="2026-09-01", snapshot_created=False, created=0, updated=1, unchanged=3, batch_id=uuid4()).batch_id is not None
```

- [ ] **Step 2: Run to verify it fails**

Run: `FINANCE_TEST_DB=finance_test_l0 <venv-python> -m pytest tests/test_schemas_lifecycle.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.schemas.lifecycle'`.

- [ ] **Step 3: Write the schemas**

```python
# backend/app/schemas/lifecycle.py
"""Data-lifecycle wire shapes (2026-09-03 spec §7–§11), all in one module so the six lanes
import rather than define them. Conventions: every timestamp is timezone-aware, every id
that identifies a change batch is a UUID, and nothing here is nullable that the router can
always fill — the Optionals are the report's own "not applicable" states (a dry run has no
restore point, a stored run may have no report)."""

from datetime import date, datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

# ── Restore (§7) ──────────────────────────────────────────────────────────────────────


class RestoreSchema(BaseModel):
    snapshot_head: str | None
    server_head: str | None
    compatible: bool


class RestoreTableDiff(BaseModel):
    current: int
    incoming: int
    # Same canonical CSV sha256 for the live rows and the parsed incoming rows.
    identical: bool


class RestoreReport(BaseModel):
    # `schema` is a BaseModel attribute name, so the FIELD is schema_ and the WIRE is
    # `schema` — populate_by_name lets Python callers write schema=..., serialize_by_alias
    # makes model_dump agree with FastAPI's by_alias response path.
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    dry_run: bool
    applied: bool
    # The snapshot's own exported_at: the Restore card asks for this DATE to be typed.
    exported_at: datetime | None
    schema_: RestoreSchema = Field(alias="schema")
    tables: dict[str, RestoreTableDiff]
    preserved_settings: list[str]
    warnings: list[str]
    errors: list[str]
    restore_point: str | None
    batch_id: UUID | None
    run_id: int | None


# ── Stored snapshots (§8) ─────────────────────────────────────────────────────────────


class SnapshotEntryOut(BaseModel):
    name: str
    at: datetime
    size_bytes: int
    alembic_head: str | None
    # head equals the server's — the only snapshots the Restore card offers to apply.
    restorable: bool


# ── Activity (§9) ─────────────────────────────────────────────────────────────────────


class ActivityBatchOut(BaseModel):
    type: Literal["batch"] = "batch"
    batch_id: UUID
    at: datetime
    source: str
    actor: str | None
    label: str
    month: date | None
    # Row-level entries (op != 'batch'); 0 for a summary-only batch.
    rows: int
    undoable: bool
    undone_by: UUID | None


class ActivityRunOut(BaseModel):
    type: Literal["run"] = "run"
    run_id: int
    at: datetime
    kind: str
    ok: bool
    dry_run: bool
    filename: str | None
    size_bytes: int | None
    has_report: bool


class ActivityOut(BaseModel):
    entries: list[ActivityBatchOut | ActivityRunOut]
    # The `before` cursor for the next page, or None when this page ended the trail.
    next_before: datetime | None


class ActivityRunDetailOut(BaseModel):
    run: ActivityRunOut
    # The stored ImportReport / RestoreReport verbatim (the client narrows on run.kind).
    report: dict[str, Any] | None


# ── Preferences (§10) ─────────────────────────────────────────────────────────────────


class PrefEntryOut(BaseModel):
    value: Any
    updated_at: datetime


class PrefsOut(BaseModel):
    # Registered keys only, absent when unset.
    prefs: dict[str, PrefEntryOut]


# ── Health (§11) ──────────────────────────────────────────────────────────────────────

HealthSeverity = Literal["ok", "info", "warn", "error"]


class HealthFixOut(BaseModel):
    kind: Literal["link", "action"]
    label: str
    to: str | None = None
    # 'delete_spending_month' (per month in the check's `months`) | 'snapshot_now'.
    action: str | None = None


class HealthCheckOut(BaseModel):
    id: str
    severity: HealthSeverity
    title: str
    detail: str
    count: int = 0
    months: list[date] = Field(default_factory=list)
    fix: HealthFixOut | None = None


class HealthOut(BaseModel):
    checked_at: datetime
    checks: list[HealthCheckOut]
```

In `backend/app/schemas/system.py`, replace `BackupStatusOut` and `BackupRunOut`:

```python
class BackupStatusOut(BaseModel):
    last_success_at: datetime
    object_key: str
    # du -h's human string ("1.2M") exactly as the script recorded it — a label to echo
    # verbatim, not bytes to do math on (spec §3's example shape).
    size: str
    # 2026-09-03 data-lifecycle spec §8: the verify phase's fields. ALL optional so the
    # marker last night's script wrote still parses; None means "an older script wrote this".
    size_bytes: int | None = None
    encrypted: bool | None = None
    retention_days: int | None = None
    verified: bool | None = None
    verified_at: datetime | None = None
    row_counts: dict[str, int] | None = None
    verify_error: str | None = None


class BackupRunOut(BaseModel):
    """One backup_db.sh run from app_settings['backup_runs'] — a FLAT jsonb array (the
    shell writer's no-envelope rule, same as BackupStatusOut). `object` is absent on
    failed runs; `error` on successful ones; `verified` on runs before the verify phase."""

    at: datetime
    ok: bool
    object: str | None = None
    error: str | None = None
    verified: bool | None = None
```

In `backend/app/schemas/net_worth.py`, `MonthUpsertResult` gains (after `unchanged: int`):

```python
    # The change batch this save wrote (2026-09-03 data-lifecycle spec §9) — None until the
    # router records one, and None when nothing changed (an all-unchanged PUT logs nothing).
    batch_id: UUID | None = None
```
with `from uuid import UUID` added to the imports. Same field and comment on `SpendingUpsertResult` in `backend/app/schemas/spending.py` (after `net_pay_cleared: bool = False`), same import.

- [ ] **Step 4: Run the tests**

Run: `FINANCE_TEST_DB=finance_test_l0 <venv-python> -m pytest tests/test_schemas_lifecycle.py tests/test_system_api.py tests/test_net_worth_api.py tests/test_spending_api.py -q`
Expected: all passed (the existing API tests compare specific keys, not whole bodies; if one compares a whole upsert body with `==`, add `"batch_id": None` to its expected dict).

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas/lifecycle.py backend/app/schemas/system.py backend/app/schemas/net_worth.py backend/app/schemas/spending.py backend/tests/test_schemas_lifecycle.py backend/tests/test_net_worth_api.py backend/tests/test_spending_api.py
git commit -m "feat(schemas): lifecycle wire shapes; verified-backup marker fields; batch_id on the month upserts"
```

---

### Task 6: TypeScript types, `apiWithHeaders`, `/prefs` invalidation

**Files:**
- Modify: `src/types/api.ts` (append), `src/api/client.ts`
- Test: `src/api/client.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `src/api/client.test.ts` (top-level, after the `session plumbing` describe). Also add `apiWithHeaders` to the existing `import { api, ApiError, apiReadOnly, expireSession, setAfterResponseHook, setToken } from './client'` line:

```ts
describe('apiWithHeaders — the 204 + header reader', () => {
  beforeEach(() => clearSnapshots())

  it('returns the parsed body AND the response headers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'X-Change-Batch': 'b-1' }),
        json: async () => ({ month: '2026-09-01' }),
      }),
    )
    const { data, headers } = await apiWithHeaders<{ month: string }>('/net-worth/months/2026-09-01')
    expect(data.month).toBe('2026-09-01')
    expect(headers.get('x-change-batch')).toBe('b-1')
  })

  it('hands back undefined data for a 204 but still the headers, and invalidates like api()', async () => {
    setSnapshot('networth:all', 1)
    setSnapshot('portfolio:all', 1)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        headers: new Headers({ 'X-Change-Batch': 'b-2' }),
        json: async () => {
          throw new Error('no body')
        },
      }),
    )
    const { data, headers } = await apiWithHeaders<void>('/net-worth/months/2026-09-01', { method: 'DELETE' })
    expect(data).toBeUndefined()
    expect(headers.get('x-change-batch')).toBe('b-2')
    expect(getSnapshot('networth:all')).toBeUndefined()
    expect(getSnapshot('portfolio:all')).toBe(1)
  })

  it('tolerates a response object without headers (older fetch mocks)', async () => {
    mockFetchOk({ ok: true })
    const { headers } = await apiWithHeaders('/x')
    expect(headers.get('x-change-batch')).toBeNull()
  })
})

describe('api — preferences invalidation', () => {
  beforeEach(() => clearSnapshots())

  // A theme toggle PATCHes /prefs (debounced) several times a sitting; wiping every page
  // snapshot for it would cost every page its instant paint. Only the shell family moves.
  it('a PATCH to /prefs drops the shell family and nothing else', async () => {
    setSnapshot('shell:prefs', 1)
    setSnapshot('shell:coverage', 1)
    setSnapshot('overview', 1)
    setSnapshot('portfolio:all', 1)
    mockFetchOk({ prefs: {} })
    await api('/prefs', { method: 'PATCH', body: '{}' })
    expect(getSnapshot('shell:prefs')).toBeUndefined()
    expect(getSnapshot('shell:coverage')).toBeUndefined()
    expect(getSnapshot('overview')).toBe(1)
    expect(getSnapshot('portfolio:all')).toBe(1)
  })

  it('an undo and a restore still wipe everything (unmapped paths)', async () => {
    setSnapshot('overview', 1)
    mockFetchOk({})
    await api('/activity/batches/b-1/undo', { method: 'POST' })
    expect(getSnapshot('overview')).toBeUndefined()
    setSnapshot('overview', 1)
    await api('/import/snapshot?dry_run=false', { method: 'POST', body: new FormData() })
    expect(getSnapshot('overview')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/api/client.test.ts`
Expected: FAIL — `apiWithHeaders` is not exported; the `/prefs` PATCH wipes `overview`.

- [ ] **Step 3: Implement**

In `src/api/client.ts`:

Add to `MUTATION_FAMILIES` (after the `/limits` row):

```ts
  // Preferences (2026-09-03 data-lifecycle spec §10): the shell caches its prefs GET under
  // shell:prefs; a PATCH must not cost every page its instant paint.
  ['/prefs', ['shell']],
```

Add after `apiReadOnly`:

```ts
/** api() plus the response headers — for the two month DELETEs, whose 204 carries the
 *  change batch in `X-Change-Batch` (2026-09-03 data-lifecycle spec §9). Same invalidation
 *  rule as api(): any non-GET drops the families its path can have moved. */
export async function apiWithHeaders<T>(
  path: string,
  options: RequestInit = {},
): Promise<{ data: T; headers: Headers }> {
  const method = (options.method ?? 'GET').toUpperCase()
  try {
    return await requestWithHeaders<T>(path, options)
  } finally {
    if (method !== 'GET') invalidateForMutation(path)
  }
}
```

Then change `request` so both callers share one transport: rename the existing `async function request<T>(...)` body to `requestWithHeaders` returning `{ data, headers }`, and make `request` a one-liner over it. Concretely, replace the signature line and the last two lines:

```ts
async function request<T>(path: string, options: RequestInit): Promise<T> {
  return (await requestWithHeaders<T>(path, options)).data
}

async function requestWithHeaders<T>(
  path: string,
  options: RequestInit,
): Promise<{ data: T; headers: Headers }> {
  // …the existing body of request(), unchanged through the afterResponse hook line…
  // Older fetch stubs in this repo's tests build plain objects with no `headers`; a real
  // Response always has one.
  const headers = res.headers ?? new Headers()
  if (res.status === 204) return { data: undefined as T, headers }
  return { data: (await res.json()) as T, headers }
}
```

(Keep every line of the existing body — the FormData content-type rule, the timeout/abort mapping, the 401 `expireSession()`, the `HTTP ${status}` fallback, the `afterResponse?.()` call — and replace only the two `return` lines at the end with the three lines above.)

Append to `src/types/api.ts`:

```ts
// --- data lifecycle (2026-09-03 spec §7–§11) ---

export interface RestoreSchema {
  snapshot_head: string | null
  server_head: string | null
  compatible: boolean
}

export interface RestoreTableDiff {
  current: number
  incoming: number
  /** Same canonical CSV sha256 on both sides. */
  identical: boolean
}

// POST /import/snapshot[?dry_run=] and /import/snapshot/stored/{name}.
export interface RestoreReport {
  dry_run: boolean
  applied: boolean
  /** The snapshot's own export instant — the Restore card asks for its DATE to be typed. */
  exported_at: string | null
  schema: RestoreSchema
  tables: Record<string, RestoreTableDiff>
  preserved_settings: string[]
  warnings: string[]
  errors: string[]
  restore_point: string | null
  batch_id: string | null
  run_id: number | null
}

// GET/POST /system/snapshots — the nightly stored ZIPs, newest first.
export interface SnapshotEntry {
  name: string
  at: string
  size_bytes: number
  alembic_head: string | null
  /** Head equals this server's — the only entries the Restore card offers to apply. */
  restorable: boolean
}

export type ChangeSource = 'ui' | 'import' | 'restore' | 'scheduler' | 'repair' | 'undo'
export type RunKind = 'import_xlsx' | 'restore' | 'snapshot' | 'restore_point' | 'undo'

export interface ActivityBatch {
  type: 'batch'
  batch_id: string
  at: string
  source: ChangeSource
  actor: string | null
  label: string
  month: string | null
  rows: number
  undoable: boolean
  undone_by: string | null
}

export interface ActivityRun {
  type: 'run'
  run_id: number
  at: string
  kind: RunKind
  ok: boolean
  dry_run: boolean
  filename: string | null
  size_bytes: number | null
  has_report: boolean
}

export type ActivityEntry = ActivityBatch | ActivityRun

// GET /activity?limit=&before= — batches and runs interleaved, newest first.
export interface ActivityPage {
  entries: ActivityEntry[]
  next_before: string | null
}

// GET /activity/runs/{id} — the stored report verbatim; narrow on run.kind.
export interface ActivityRunDetail {
  run: ActivityRun
  report: Record<string, unknown> | null
}

export interface PrefEntry {
  value: unknown
  updated_at: string
}

// GET/PATCH /prefs — registered keys only, absent when unset.
export interface PrefsOut {
  prefs: Record<string, PrefEntry>
}

export type HealthSeverity = 'ok' | 'info' | 'warn' | 'error'

export interface HealthFix {
  kind: 'link' | 'action'
  label: string
  to?: string | null
  /** 'delete_spending_month' (one per month in the check's `months`) | 'snapshot_now'. */
  action?: string | null
}

export interface HealthCheck {
  id: string
  severity: HealthSeverity
  title: string
  detail: string
  count: number
  months: string[]
  fix: HealthFix | null
}

// GET /system/health
export interface HealthOut {
  checked_at: string
  checks: HealthCheck[]
}
```

Also in `src/types/api.ts`: add to `BackupStatus` (after `size: string`):

```ts
  /** Verify-phase fields (2026-09-03 data-lifecycle spec §8) — absent on markers an older
   *  script wrote; `verified === false` carries `verify_error`. */
  size_bytes?: number | null
  encrypted?: boolean | null
  retention_days?: number | null
  verified?: boolean | null
  verified_at?: string | null
  row_counts?: Record<string, number> | null
  verify_error?: string | null
```
to `BackupRun`: `verified?: boolean | null`; to `MonthUpsertResult` and `SpendingUpsertResult`: `/** The change batch this save wrote — null when nothing changed. */ batch_id?: string | null`.

- [ ] **Step 4: Run the tests and the type-check**

Run: `npx vitest run src/api/client.test.ts && npx tsc -b`
Expected: PASS (all client tests, the pre-existing ones included); tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/types/api.ts src/api/client.ts src/api/client.test.ts
git commit -m "feat(api-client): lifecycle types, apiWithHeaders, /prefs invalidates the shell family only"
```

---

### Task 7: Fetchers — `api/lifecycle.ts`, `api/prefs.ts`

**Files:**
- Create: `src/api/lifecycle.ts`, `src/api/prefs.ts`
- Test: `src/api/lifecycle.test.ts`, `src/api/prefs.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/api/lifecycle.test.ts
import { beforeEach, expect, it, vi } from 'vitest'
import {
  createSnapshot,
  fetchActivity,
  fetchActivityRun,
  fetchHealth,
  fetchSnapshots,
  restoreStored,
  restoreUpload,
  undoBatch,
} from './lifecycle'

// Only the transport is stubbed — the paths and options this module builds ARE the test
// (src/api/netWorth.test.ts's posture).
vi.mock('./client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./client')>()),
  api: vi.fn(),
}))
import { api } from './client'

beforeEach(() => vi.clearAllMocks())

const call = (n = 0) => vi.mocked(api).mock.calls[n] as [string, RequestInit | undefined]

it('lists and creates stored snapshots', async () => {
  await fetchSnapshots()
  expect(call()).toEqual(['/system/snapshots'])
  await createSnapshot()
  expect(call(1)[0]).toBe('/system/snapshots')
  expect(call(1)[1]?.method).toBe('POST')
})

it('uploads a snapshot as multipart with the dry-run flag and a long timeout', async () => {
  const file = new File(['zip bytes'], 'finance-export.zip')
  await restoreUpload(file, true)
  const [path, init] = call()
  expect(path).toBe('/import/snapshot?dry_run=true')
  expect(init?.method).toBe('POST')
  expect(init?.body).toBeInstanceOf(FormData)
  expect((init?.body as FormData).get('file')).toBe(file)
  expect(init?.signal).toBeInstanceOf(AbortSignal)
  await restoreUpload(file, false)
  expect(call(1)[0]).toBe('/import/snapshot?dry_run=false')
})

it('restores a stored snapshot by its encoded name', async () => {
  await restoreStored('finance-export-20260904-233000.zip', false)
  expect(call()[0]).toBe('/import/snapshot/stored/finance-export-20260904-233000.zip?dry_run=false')
  expect(call()[1]?.method).toBe('POST')
})

it('pages the activity feed with a before cursor', async () => {
  await fetchActivity()
  expect(call()[0]).toBe('/activity?limit=50')
  await fetchActivity('2026-09-04T03:00:00+00:00')
  expect(call(1)[0]).toBe('/activity?limit=50&before=2026-09-04T03%3A00%3A00%2B00%3A00')
  await fetchActivityRun(7)
  expect(call(2)[0]).toBe('/activity/runs/7')
})

it('undoes a batch and reads health', async () => {
  await undoBatch('0b2f5c1e-1111-4222-8333-444455556666')
  expect(call()).toEqual([
    '/activity/batches/0b2f5c1e-1111-4222-8333-444455556666/undo',
    { method: 'POST' },
  ])
  await fetchHealth()
  expect(call(1)).toEqual(['/system/health'])
})
```

```ts
// src/api/prefs.test.ts
import { beforeEach, expect, it, vi } from 'vitest'
import { deletePref, fetchPrefs, patchPrefs } from './prefs'

vi.mock('./client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./client')>()),
  api: vi.fn(),
}))
import { api } from './client'

beforeEach(() => vi.clearAllMocks())

const call = (n = 0) => vi.mocked(api).mock.calls[n] as [string, RequestInit | undefined]

it('reads, patches partially and deletes one key — no trailing slashes', async () => {
  await fetchPrefs()
  expect(call()).toEqual(['/prefs'])
  await patchPrefs({ theme: 'light', scope: { owner: 'all', range: 'ytd' } })
  expect(call(1)[0]).toBe('/prefs')
  expect(call(1)[1]?.method).toBe('PATCH')
  expect(JSON.parse(call(1)[1]?.body as string)).toEqual({
    theme: 'light',
    scope: { owner: 'all', range: 'ytd' },
  })
  await deletePref('landing_page')
  expect(call(2)).toEqual(['/prefs/landing_page', { method: 'DELETE' }])
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/api/lifecycle.test.ts src/api/prefs.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the fetchers**

```ts
// src/api/lifecycle.ts
import { api } from './client'
import type {
  ActivityBatch,
  ActivityPage,
  ActivityRunDetail,
  HealthOut,
  RestoreReport,
  SnapshotEntry,
} from '../types/api'

// A restore rewrites every exported table in one transaction after writing a restore
// point; 120s is the importer's budget and the right one here too.
const RESTORE_TIMEOUT_MS = 120_000
const ACTIVITY_PAGE = 50

// GET /system/snapshots — newest first (2026-09-03 data-lifecycle spec §8).
export function fetchSnapshots(): Promise<SnapshotEntry[]> {
  return api<SnapshotEntry[]>('/system/snapshots')
}

// POST /system/snapshots — "Snapshot now"; rate-limited server-side (10/minute).
export function createSnapshot(): Promise<SnapshotEntry> {
  return api<SnapshotEntry>('/system/snapshots', { method: 'POST' })
}

// The File goes up on BOTH calls — dry run and apply are stateless twins (the importer's
// contract; report.dry_run says which ran).
export function restoreUpload(file: File, dryRun: boolean): Promise<RestoreReport> {
  const body = new FormData()
  body.append('file', file)
  return api<RestoreReport>(`/import/snapshot?dry_run=${dryRun}`, {
    method: 'POST',
    body,
    signal: AbortSignal.timeout(RESTORE_TIMEOUT_MS),
  })
}

// A stored nightly file by name (the server validates the name's grammar; nothing else
// reaches the filesystem).
export function restoreStored(name: string, dryRun: boolean): Promise<RestoreReport> {
  return api<RestoreReport>(
    `/import/snapshot/stored/${encodeURIComponent(name)}?dry_run=${dryRun}`,
    { method: 'POST', signal: AbortSignal.timeout(RESTORE_TIMEOUT_MS) },
  )
}

// GET /activity — `before` is the previous page's next_before cursor (an ISO instant).
export function fetchActivity(before?: string): Promise<ActivityPage> {
  const params = new URLSearchParams({ limit: String(ACTIVITY_PAGE) })
  if (before !== undefined) params.set('before', before)
  return api<ActivityPage>(`/activity?${params.toString()}`)
}

export function fetchActivityRun(runId: number): Promise<ActivityRunDetail> {
  return api<ActivityRunDetail>(`/activity/runs/${runId}`)
}

// POST …/undo — 409s carry the router's sentence verbatim; the caller shows it.
export function undoBatch(batchId: string): Promise<ActivityBatch> {
  return api<ActivityBatch>(`/activity/batches/${batchId}/undo`, { method: 'POST' })
}

// GET /system/health (2026-09-03 data-lifecycle spec §11).
export function fetchHealth(): Promise<HealthOut> {
  return api<HealthOut>('/system/health')
}
```

```ts
// src/api/prefs.ts
import { api } from './client'
import type { PrefsOut } from '../types/api'

// Server-side preferences (2026-09-03 data-lifecycle spec §10). No trailing slash: the
// router mounts GET/PATCH on the bare prefix (the /settings precedent — "/prefs/" costs a
// 307). The store in src/prefs/prefsStore.ts is the only caller; components read the store.
export function fetchPrefs(): Promise<PrefsOut> {
  return api<PrefsOut>('/prefs')
}

// PARTIAL by design: only the keys sent are upserted; the response is the full set.
export function patchPrefs(partial: Record<string, unknown>): Promise<PrefsOut> {
  return api<PrefsOut>('/prefs', { method: 'PATCH', body: JSON.stringify(partial) })
}

// Resets one key to its default (deletes the row).
export function deletePref(key: string): Promise<void> {
  return api<void>(`/prefs/${key}`, { method: 'DELETE' })
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/api/lifecycle.test.ts src/api/prefs.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/api/lifecycle.ts src/api/lifecycle.test.ts src/api/prefs.ts src/api/prefs.test.ts
git commit -m "feat(api-client): lifecycle and prefs fetchers"
```

---

### Task 8: `RestoreReportView` (pure)

**Files:**
- Create: `src/components/settings/RestoreReportView.tsx`
- Test: `src/components/settings/RestoreReportView.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/settings/RestoreReportView.test.tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { RestoreReport } from '../../types/api'
import RestoreReportView from './RestoreReportView'

afterEach(cleanup)

function report(over: Partial<RestoreReport> = {}): RestoreReport {
  return {
    dry_run: true,
    applied: false,
    exported_at: '2026-09-02T23:30:00+00:00',
    schema: { snapshot_head: 'c3a7e19d5b42', server_head: 'c3a7e19d5b42', compatible: true },
    tables: {
      accounts: { current: 25, incoming: 25, identical: true },
      account_balances: { current: 800, incoming: 781, identical: false },
      monthly_spending: { current: 640, incoming: 621, identical: false },
      people: { current: 2, incoming: 2, identical: true },
    },
    preserved_settings: ['backup_status', 'backup_runs'],
    warnings: [],
    errors: [],
    restore_point: null,
    batch_id: null,
    run_id: 12,
    ...over,
  }
}

describe('RestoreReportView', () => {
  it('lists the differing tables first and folds the identical ones under one summary', () => {
    render(<RestoreReportView report={report()} />)
    expect(screen.getByRole('status').textContent).toBe('Dry run — nothing was written.')
    const rows = screen.getAllByRole('row').slice(1) // minus the header
    expect(rows.map((r) => r.cells[0].textContent)).toEqual(['account_balances', 'monthly_spending'])
    expect(rows[0].cells[1].textContent).toBe('800')
    expect(rows[0].cells[2].textContent).toBe('781')
    const fold = screen.getByText('2 tables unchanged')
    expect(screen.queryByText('accounts')).toBeNull()
    fireEvent.click(fold)
    expect(screen.getByText('accounts')).toBeTruthy()
    expect(screen.getByText('people')).toBeTruthy()
  })

  it('prints the schema line, the preserved settings and the snapshot date', () => {
    render(<RestoreReportView report={report()} />)
    expect(screen.getByText('Snapshot from Sep 2, 2026 · schema c3a7e19d5b42 · this server c3a7e19d5b42 · compatible')).toBeTruthy()
    expect(screen.getByText('Kept from this server: backup_status, backup_runs')).toBeTruthy()
  })

  it('says incompatible in words and renders warnings and errors', () => {
    render(
      <RestoreReportView
        report={report({
          schema: { snapshot_head: 'b8e4d17c2a90', server_head: 'c3a7e19d5b42', compatible: false },
          warnings: ['accounts.person_id is absent from the snapshot — the column default applies'],
          errors: ['Snapshot column accounts.colour is unknown to this server'],
        })}
      />,
    )
    expect(screen.getByText(/· incompatible$/)).toBeTruthy()
    expect(screen.getByText('WARN: accounts.person_id is absent from the snapshot — the column default applies')).toBeTruthy()
    expect(screen.getByText('ERROR: Snapshot column accounts.colour is unknown to this server')).toBeTruthy()
  })

  it('names the restore point once applied, and says every table is unchanged when it is', () => {
    render(
      <RestoreReportView
        report={report({
          dry_run: false,
          applied: true,
          restore_point: 'pre-restore-20260904-091500-123456.zip',
          tables: { accounts: { current: 1, incoming: 1, identical: true } },
        })}
      />,
    )
    expect(screen.getByRole('status').textContent).toBe('Restored.')
    expect(screen.getByText('Restore point written: pre-restore-20260904-091500-123456.zip')).toBeTruthy()
    expect(screen.getByText('1 table unchanged')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/settings/RestoreReportView.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

```tsx
// src/components/settings/RestoreReportView.tsx
import type { RestoreReport } from '../../types/api'
import { formatDate } from '../../utils/format'
import '../panels.css'
import './settings.css'

// Pure presentation (ImportReportView's posture): the Restore card and the Activity card's
// "View report" both hand a RestoreReport here and own every piece of state themselves.
// Differing tables first — those are the news; identical ones fold under one line, because
// a restore of last night's snapshot is 34 unchanged tables and two that moved.

function schemaLine(report: RestoreReport): string {
  const from = report.exported_at === null ? 'Snapshot' : `Snapshot from ${formatDate(report.exported_at)}`
  const head = (h: string | null) => h ?? 'none'
  return (
    `${from} · schema ${head(report.schema.snapshot_head)} · this server ` +
    `${head(report.schema.server_head)} · ${report.schema.compatible ? 'compatible' : 'incompatible'}`
  )
}

export default function RestoreReportView({ report }: { report: RestoreReport }) {
  const entries = Object.entries(report.tables)
  const changed = entries.filter(([, diff]) => !diff.identical)
  const unchanged = entries.filter(([, diff]) => diff.identical)
  return (
    <div className="import-report">
      <p className="settings-note" role="status">
        {report.applied ? 'Restored.' : 'Dry run — nothing was written.'}
      </p>
      <p className="settings-note">{schemaLine(report)}</p>
      {report.errors.map((e, i) => (
        <p key={`e${i}`} className="import-error">
          ERROR: {e}
        </p>
      ))}
      {report.warnings.map((w, i) => (
        <p key={`w${i}`} className="settings-note">
          WARN: {w}
        </p>
      ))}
      {changed.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th>Table</th>
              <th className="num">Current rows</th>
              <th className="num">Incoming rows</th>
            </tr>
          </thead>
          <tbody>
            {changed.map(([name, diff]) => (
              <tr key={name}>
                <td>{name}</td>
                <td className="num">{diff.current}</td>
                <td className="num">{diff.incoming}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {unchanged.length > 0 && (
        <details>
          <summary>
            {unchanged.length} {unchanged.length === 1 ? 'table' : 'tables'} unchanged
          </summary>
          <ul>
            {unchanged.map(([name, diff]) => (
              <li key={name}>
                {name} ({diff.current})
              </li>
            ))}
          </ul>
        </details>
      )}
      {report.preserved_settings.length > 0 && (
        <p className="settings-note">Kept from this server: {report.preserved_settings.join(', ')}</p>
      )}
      {report.restore_point !== null && (
        <p className="settings-note">Restore point written: {report.restore_point}</p>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/components/settings/RestoreReportView.test.tsx`
Expected: PASS (4 tests). If the fold test finds `accounts` before the click, `<details>` content is being rendered open — jsdom renders children of a closed `<details>` in the DOM but Testing Library's `getByText` still finds them; in that case assert on `details.open` toggling instead: `expect((fold.closest('details') as HTMLDetailsElement).open).toBe(false)` before the click and `true` after.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/RestoreReportView.tsx src/components/settings/RestoreReportView.test.tsx
git commit -m "feat(settings): RestoreReportView — differing tables first, identical ones folded"
```

---

### Task 9: Whole suites, lint, type-check

- [ ] **Step 1: Backend**

Run (from `backend/`): `FINANCE_TEST_DB=finance_test_l0 <venv-python> -m pytest -q && <venv-python> -m ruff check app tests alembic && <venv-python> -m ruff format --check app tests alembic`
Expected: all passed; ruff clean.

- [ ] **Step 2: Frontend**

Run: `npx tsc -b && npx eslint src/api src/types src/components/settings/RestoreReportView.tsx && npx vitest run`
Expected: clean, all green.

- [ ] **Step 3: Alembic is a single head**

Run (from `backend/`): `<venv-python> -m alembic heads` → `c3a7e19d5b42 (head)` only.

---

## Merge notes for the coordinator

- This branch is the FORK POINT for L1–L4 and F1–F2: merge it to main (local commits only) before any lane starts. Every lane imports `app.services.snapshot`, `app.schemas.lifecycle`, `app.models.lifecycle`, `src/types/api.ts`'s lifecycle types, `src/api/lifecycle.ts`/`prefs.ts` and `RestoreReportView` — none of them may redefine those.
- No lane adds a migration (spec §15). If the drill or a lane discovers a DDL gap, it comes back HERE as a follow-up revision chained on `c3a7e19d5b42`.
- Hotspots this plan touched that lanes touch again: `backend/tests/conftest.py` (lanes add fixtures — append-only), `src/api/client.ts` (no lane should need to), `src/types/api.ts` (no lane should need to).

## Self-review

**Spec coverage:** §6 module map — `models/lifecycle.py`, the migration with its four `change_log` indexes and the exact column list, `services/snapshot.py` with `build_snapshot_zip · json_cell · EXPORTED_TABLES (moved)` plus `parse_cell` beside it (§7 "side by side") and the restore-point writer (§7 step 1, §9 imports) → Tasks 1–3; export pins (`user_preferences` joins EXPORTED, the two trails join EXCLUDED with the stated rationale) → Task 3; `settings.data_dir`/`snapshot_enabled`, compose volume, `.gitignore` → Task 4; every wire shape of §7 (`RestoreReport` — plus `exported_at`, which the Restore card's typed-date arm needs), §8 (`SnapshotEntryOut`, marker fields), §9 (`ActivityOut` family, `batch_id` on the two upsert results), §10 (`PrefsOut`), §11 (`HealthOut`) → Task 5; the TS twins, `apiWithHeaders` for the 204 header, `/prefs → shell` invalidation → Task 6; fetchers → Task 7; the shared report view → Task 8. Deviation, deliberate and documented in code: stored-snapshot names carry seconds (`finance-export-YYYYMMDD-HHMMSS.zip`) so a manual snapshot cannot overwrite the nightly's; the download filename keeps HHMM. **Placeholders:** none — every step has its code; the one "unchanged body" instruction in Task 6 names the exact lines kept and the exact lines replaced. **Type consistency:** `SnapshotZip(payload, filename, exported_at, alembic_head, counts)`, `RestorePoint(name, path, size_bytes, run_id)`, `write_restore_point(db, *, actor)`, `csv_for_rows(columns, rows)`, `row_dict(obj, columns)`, `json_row(obj)`, `parse_cell(column, raw)`, `snapshot_name(at)`/`snapshot_stamp(name)`, `trim_directory(directory, pattern, keep)`, `RestoreReport.schema_` (wire `schema`), `ActivityOut.entries`/`next_before`, `HealthFixOut(kind, label, to, action)`, `apiWithHeaders → { data, headers }`, `fetchActivity(before?)`, `restoreUpload(file, dryRun)`, `restoreStored(name, dryRun)` — the lane plans use these names verbatim.
