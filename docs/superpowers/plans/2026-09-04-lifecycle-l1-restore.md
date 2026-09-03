# Data lifecycle L1 — Restore from the app's own snapshot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `docs/superpowers/specs/2026-09-03-data-lifecycle-design.md` §7: read the export ZIP back — `load_snapshot` with the 400/422/409 gates, a dry-run `plan_restore` that hashes tables through the export's own CSV writer, a transactional `apply_restore` (restore point → preserved settings → TRUNCATE → FK-ordered inserts with the self-reference fix-up → sequences → preserved rows → one summary change-log row and a `restore` run), the two `POST /import/snapshot…` routes, and the `python -m app.lifecycle restore|verify` CLI the drill (L4) calls.

**Architecture:** Everything lives in `backend/app/lifecycle/restore.py` and reads Phase 0's `services/snapshot.py` for the table list, `parse_cell`, `csv_for_rows`, `row_dict`, `alembic_head` and `write_restore_point`; the routes are a thin `_restore()` in `api/import_.py` that maps `SnapshotError(status, detail)` to `HTTPException` and anything else after the restore point to a 500 "Restore failed and nothing was changed" with a rollback. The CLI mirrors `app.importer.__main__` (exit codes 0/1/2).

**Tech Stack:** FastAPI, SQLAlchemy 2.0 async Core inserts (`insert(table)` executemany), asyncpg, Pydantic 2.

**Worktree / commands:** Branch `lifecycle-l1` from main AFTER `lifecycle-base` merged (check: `backend/app/services/snapshot.py` and `backend/app/schemas/lifecycle.py` exist). Backend from `<worktree>/backend`:
`FINANCE_TEST_DB=finance_test_l1 ../../../backend/.venv/Scripts/python.exe -m pytest tests/<file> -q`
(`<venv-python>` = that interpreter.) Nothing frontend in this lane.

---

## File structure

| File | Responsibility |
|---|---|
| `backend/app/lifecycle/__init__.py` (new) | package docstring |
| `backend/app/lifecycle/restore.py` (new) | `SnapshotError`, `load_snapshot`, `check_schema`, `parse_tables`, `diff_tables`, `plan_restore`, `apply_restore`, `RESTORE_PRESERVED_SETTINGS` |
| `backend/app/lifecycle/__main__.py` (new) | CLI `restore` / `verify` |
| `backend/app/api/import_.py` (modify) | `POST /import/snapshot`, `POST /import/snapshot/stored/{name}` |
| `backend/tests/test_restore.py` (new) | loader gates, parsing, dry-run diff, apply round trip, preserved rows, sequences, rollback |
| `backend/tests/test_restore_api.py` (new) | the routes' status codes and sentences |
| `backend/tests/test_lifecycle_cli.py` (new) | parser, rendering, verdicts |

---

### Task 1: `load_snapshot` and `check_schema` — the gates

**Files:**
- Create: `backend/app/lifecycle/__init__.py`, `backend/app/lifecycle/restore.py`
- Test: `backend/tests/test_restore.py`

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_restore.py
import io
import json
import zipfile
from collections.abc import Callable
from datetime import UTC, date, datetime
from decimal import Decimal

import pytest
from sqlalchemy import func, select, text

from app.lifecycle.restore import (
    RESTORE_PRESERVED_SETTINGS,
    SnapshotError,
    apply_restore,
    check_schema,
    load_snapshot,
    parse_tables,
    plan_restore,
)
from app.models import (
    Account,
    AccountBalance,
    AppSetting,
    CategoryBudget,
    ChangeLog,
    CreditCard,
    CustomEvent,
    LifecycleRun,
    NetWorthSnapshot,
    SpendingCategory,
    UserPreference,
)
from app.services.snapshot import EXPORTED_TABLES, build_snapshot_zip, restore_points_dir

TABLE_NAMES = [name for _, name in EXPORTED_TABLES]


def rezip(
    payload: bytes,
    *,
    manifest_patch: dict | None = None,
    tables_patch: Callable[[dict], None] | None = None,
) -> bytes:
    """A copy of an export ZIP with its manifest and/or JSON tables edited in place."""
    src = zipfile.ZipFile(io.BytesIO(payload))
    manifest = json.loads(src.read("manifest.json"))
    export = json.loads(src.read("finance-export.json"))
    if manifest_patch:
        manifest.update(manifest_patch)
    if tables_patch:
        tables_patch(export["tables"])
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as dst:
        for name in src.namelist():
            if name == "manifest.json":
                dst.writestr(name, json.dumps(manifest))
            elif name == "finance-export.json":
                dst.writestr(name, json.dumps(export))
            else:
                dst.writestr(name, src.read(name))
    return out.getvalue()


def foreign_zip(**members: str) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as dst:
        for name, body in members.items():
            dst.writestr(name, body)
    return out.getvalue()


async def count(db, model) -> int:
    return (await db.execute(select(func.count()).select_from(model))).scalar_one()


# ── load_snapshot / check_schema ─────────────────────────────────────────────────────


def test_load_snapshot_refuses_non_zips_and_foreign_zips():
    for data in (
        b"not a zip",
        foreign_zip(**{"readme.txt": "hi"}),
        foreign_zip(**{"manifest.json": "{}", "finance-export.json": "{}"}),  # not this app
        foreign_zip(**{"manifest.json": "{not json", "finance-export.json": "{}"}),
    ):
        with pytest.raises(SnapshotError) as excinfo:
            load_snapshot(data)
        assert excinfo.value.status == 400
        assert excinfo.value.detail == "Not a snapshot ZIP from this app"


async def test_load_snapshot_reads_the_manifest_and_the_tables(db):
    snap = await build_snapshot_zip(db)
    loaded = load_snapshot(snap.payload)
    assert loaded.alembic_head is None  # create_all test schema
    assert loaded.exported_at == snap.exported_at
    assert loaded.environment == "dev"
    assert set(loaded.tables) == set(TABLE_NAMES)


async def test_load_snapshot_422s_naming_the_extra_or_missing_table(db):
    snap = await build_snapshot_zip(db)

    def drop_people(tables):
        del tables["people"]

    def add_crypto(tables):
        tables["crypto"] = []

    with pytest.raises(SnapshotError) as missing:
        load_snapshot(rezip(snap.payload, tables_patch=drop_people))
    assert missing.value.status == 422
    assert "missing table(s) people" in missing.value.detail
    with pytest.raises(SnapshotError) as extra:
        load_snapshot(rezip(snap.payload, tables_patch=add_crypto))
    assert extra.value.status == 422
    assert "extra table(s) crypto" in extra.value.detail


async def test_check_schema_409s_with_the_spec_sentence_and_treats_two_nones_as_equal(db):
    snap = await build_snapshot_zip(db)
    loaded = load_snapshot(snap.payload)
    ok = check_schema(loaded, None)
    assert (ok.snapshot_head, ok.server_head, ok.compatible) == (None, None, True)
    foreign = load_snapshot(rezip(snap.payload, manifest_patch={"alembic_head": "b8e4d17c2a90"}))
    with pytest.raises(SnapshotError) as excinfo:
        check_schema(foreign, "c3a7e19d5b42")
    assert excinfo.value.status == 409
    assert excinfo.value.detail == (
        "This snapshot was exported at schema `b8e4d17c2a90`; this server runs `c3a7e19d5b42`. "
        "Restore it on a server at `b8e4d17c2a90`, or use the nightly database dump."
    )
    with pytest.raises(SnapshotError) as none_vs_head:
        check_schema(loaded, "c3a7e19d5b42")
    assert "exported at schema `none`" in none_vs_head.value.detail
```

- [ ] **Step 2: Run to verify they fail**

Run: `FINANCE_TEST_DB=finance_test_l1 <venv-python> -m pytest tests/test_restore.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.lifecycle'`.

- [ ] **Step 3: Write the package and the gates**

```python
# backend/app/lifecycle/__init__.py
"""Restore the app's own snapshot ZIP (2026-09-03 data-lifecycle spec §7): the service in
restore.py and the CLI in __main__.py. The export side lives in services/snapshot.py."""
```

```python
# backend/app/lifecycle/restore.py
"""Restore from the app's own export ZIP (2026-09-03 data-lifecycle spec §7).

Only finance-export.json is read (the CSVs are for humans); manifest.json supplies the
schema head and the app marker. Validation is ordered so the first refusal is the most
fundamental one: not a ZIP / not ours (400) → table set differs (422) → schema head differs
(409) → a column this server lacks (422). A model column the file lacks is a WARNING and
takes the column default. Every value parses through services.snapshot.parse_cell, the
inverse of the export's json_cell, so the two spellings cannot drift.

The apply is ONE transaction after the restore point: this server's five operational
app_settings rows are read, every exported table is TRUNCATEd, rows insert in FK order
with the accounts self-reference fixed up afterwards, sequences resume past max(id), the
preserved rows come back, and a summary change-log row plus a `restore` run record it.
Any exception rolls the transaction back; the restore point (its own committed run) stays.
"""

import hashlib
import io
import json
import logging
import zipfile
from dataclasses import dataclass, field
from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import insert, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.system import BACKUP_RUNS_KEY, BACKUP_STATUS_KEY
from app.config import settings
from app.database import Base
from app.models import AppSetting, ChangeLog, LifecycleRun
from app.schemas.lifecycle import RestoreReport, RestoreSchema, RestoreTableDiff
from app.services.assistant_models import KEY_SETTING
from app.services.price_service import LAST_REFRESH_KEY, REFRESH_RUNS_KEY
from app.services.snapshot import (
    EXPORTED_TABLES,
    REDACTED_ROWS,
    csv_for_rows,
    parse_cell,
    row_dict,
    write_restore_point,
)

logger = logging.getLogger(__name__)

NOT_A_SNAPSHOT = "Not a snapshot ZIP from this app"
APP_MARKER = "personal-finance-dashboard"

# The five app_settings rows that describe THIS server, never the snapshot's (spec §7 step
# 2): a snapshot never carries the assistant key (redacted), and the backup/refresh markers
# say what this box's cron and scheduler did.
RESTORE_PRESERVED_SETTINGS = frozenset(
    {KEY_SETTING, BACKUP_STATUS_KEY, BACKUP_RUNS_KEY, REFRESH_RUNS_KEY, LAST_REFRESH_KEY}
)

# Columns that point at the SAME table: inserted null, then one UPDATE per row that had a
# value — the export's row order is by primary key, which is not parent-first.
SELF_REFERENCES: dict[str, str] = {"accounts": "parent_account_id"}


class SnapshotError(Exception):
    """A refusal with the HTTP status the router should answer with."""

    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


@dataclass
class LoadedSnapshot:
    alembic_head: str | None
    exported_at: datetime | None
    environment: str | None
    # table -> rows in file order, values in finance-export.json's spellings
    tables: dict[str, list[dict[str, object]]]


def load_snapshot(data: bytes) -> LoadedSnapshot:
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise SnapshotError(400, NOT_A_SNAPSHOT) from None
    names = set(archive.namelist())
    if "manifest.json" not in names or "finance-export.json" not in names:
        raise SnapshotError(400, NOT_A_SNAPSHOT)
    try:
        manifest = json.loads(archive.read("manifest.json"))
        payload = json.loads(archive.read("finance-export.json"))
    except (ValueError, UnicodeDecodeError):
        raise SnapshotError(400, NOT_A_SNAPSHOT) from None
    if not isinstance(manifest, dict) or not isinstance(payload, dict):
        raise SnapshotError(400, NOT_A_SNAPSHOT)
    if manifest.get("app") != APP_MARKER:
        raise SnapshotError(400, NOT_A_SNAPSHOT)
    tables = payload.get("tables")
    if not isinstance(tables, dict) or not all(isinstance(rows, list) for rows in tables.values()):
        raise SnapshotError(400, NOT_A_SNAPSHOT)
    expected = {name for _, name in EXPORTED_TABLES}
    extra = sorted(set(tables) - expected)
    missing = sorted(expected - set(tables))
    if extra or missing:
        parts = []
        if extra:
            parts.append(f"extra table(s) {', '.join(extra)}")
        if missing:
            parts.append(f"missing table(s) {', '.join(missing)}")
        raise SnapshotError(422, f"Snapshot tables do not match this server: {'; '.join(parts)}")
    exported_at: datetime | None = None
    raw_at = payload.get("exported_at", manifest.get("exported_at"))
    if isinstance(raw_at, str):
        try:
            exported_at = datetime.fromisoformat(raw_at)
        except ValueError:
            exported_at = None
    head = manifest.get("alembic_head")
    environment = manifest.get("environment")
    return LoadedSnapshot(
        alembic_head=head if isinstance(head, str) else None,
        exported_at=exported_at,
        environment=environment if isinstance(environment, str) else None,
        tables=tables,
    )


def check_schema(snapshot: LoadedSnapshot, server_head: str | None) -> RestoreSchema:
    """Both None (a create_all schema on both sides) counts as equal."""
    if snapshot.alembic_head != server_head:
        theirs = snapshot.alembic_head or "none"
        ours = server_head or "none"
        raise SnapshotError(
            409,
            f"This snapshot was exported at schema `{theirs}`; this server runs `{ours}`. "
            f"Restore it on a server at `{theirs}`, or use the nightly database dump.",
        )
    return RestoreSchema(
        snapshot_head=snapshot.alembic_head, server_head=server_head, compatible=True
    )
```

(The rest of the module — `parse_tables`, `diff_tables`, `plan_restore`, `apply_restore` — arrives in Tasks 2–4; leave the file ending here for now. The imports for those tasks are already in place; ruff will flag them unused until Task 2 — that is expected between tasks, not at the commit: trim the unused ones now if you commit before Task 2, or do Tasks 1–2 in one commit.)

- [ ] **Step 4: Run the tests**

Run: `FINANCE_TEST_DB=finance_test_l1 <venv-python> -m pytest tests/test_restore.py -q`
Expected: 4 passed.

- [ ] **Step 5: Commit** (with Task 2, below — or now, after removing the not-yet-used imports)

```bash
git add backend/app/lifecycle/__init__.py backend/app/lifecycle/restore.py backend/tests/test_restore.py
git commit -m "feat(lifecycle): load_snapshot and check_schema — the 400/422/409 gates"
```

---

### Task 2: `parse_tables` and `diff_tables` — columns, values, identity

**Files:**
- Modify: `backend/app/lifecycle/restore.py`
- Test: `backend/tests/test_restore.py` (append)

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_restore.py`:

```python
# ── parse_tables / diff_tables ───────────────────────────────────────────────────────


async def test_parse_tables_422s_on_an_unknown_column_and_warns_on_an_absent_one(db, seeded_user):
    db.add(Account(name="A", slug="a", group="cash", sort_order=1))
    await db.commit()
    snap = await build_snapshot_zip(db)

    def add_colour(tables):
        tables["accounts"][0]["colour"] = "teal"

    def drop_person_id(tables):
        del tables["accounts"][0]["person_id"]

    with pytest.raises(SnapshotError) as excinfo:
        parse_tables(load_snapshot(rezip(snap.payload, tables_patch=add_colour)), user_id=seeded_user.id)
    assert excinfo.value.status == 422
    assert excinfo.value.detail == "Snapshot column accounts.colour is unknown to this server"

    parsed = parse_tables(load_snapshot(rezip(snap.payload, tables_patch=drop_person_id)), user_id=seeded_user.id)
    assert parsed.warnings == [
        "accounts.person_id is absent from the snapshot — the column default applies"
    ]
    assert parsed.absent["accounts"] == ["person_id"]
    assert parsed.rows["accounts"][0]["person_id"] is None  # for the identity hash
    assert parsed.rows["accounts"][0]["sort_order"] == 1


async def test_parse_tables_422s_on_a_value_that_does_not_parse(db, seeded_user):
    db.add(Account(name="A", slug="a", group="cash", sort_order=1))
    await db.commit()
    snap = await build_snapshot_zip(db)

    def bad_sort(tables):
        tables["accounts"][0]["sort_order"] = "many"

    with pytest.raises(SnapshotError) as excinfo:
        parse_tables(load_snapshot(rezip(snap.payload, tables_patch=bad_sort)), user_id=seeded_user.id)
    assert excinfo.value.status == 422
    assert "accounts.sort_order" in excinfo.value.detail


async def test_parse_tables_rewrites_preferences_to_the_caller_and_notes_a_foreign_environment(db, seeded_user):
    db.add(UserPreference(user_id=seeded_user.id, key="theme", value="light"))
    await db.commit()
    snap = await build_snapshot_zip(db)

    def foreign_user(tables):
        tables["user_preferences"][0]["user_id"] = 999
        tables["user_preferences"].append({**tables["user_preferences"][0], "user_id": 42})

    loaded = load_snapshot(rezip(snap.payload, manifest_patch={"environment": "prod"}, tables_patch=foreign_user))
    parsed = parse_tables(loaded, user_id=seeded_user.id)
    # One row per key, owned by the caller — duplicates from another account collapse.
    assert [(r["user_id"], r["key"]) for r in parsed.rows["user_preferences"]] == [(seeded_user.id, "theme")]
    assert parsed.warnings == [
        "Snapshot was exported from a 'prod' environment; this server is 'dev'"
    ]
    no_user = parse_tables(loaded, user_id=None)
    assert no_user.rows["user_preferences"] == []
    assert "user_preferences skipped — no user to attach them to" in no_user.warnings


async def test_diff_tables_hashes_identity_through_the_csv_writer(db, seeded_user):
    account = Account(name="Café Fund", slug="cafe-fund", group="cash", sort_order=2)
    db.add(account)
    await db.commit()
    snap = await build_snapshot_zip(db)
    parsed = parse_tables(load_snapshot(snap.payload), user_id=seeded_user.id)
    report = await plan_restore(db, load_snapshot(snap.payload), user_id=seeded_user.id, server_head=None)
    assert report.dry_run is True and report.applied is False
    assert report.exported_at == snap.exported_at
    assert report.tables["accounts"] == RestoreTableDiff(current=1, incoming=1, identical=True)
    assert all(diff.identical for diff in report.tables.values())
    assert report.restore_point is None and report.batch_id is None and report.run_id is None
    # Change the live row: same counts, no longer identical.
    account.sort_order = 3
    await db.commit()
    changed = await plan_restore(db, load_snapshot(snap.payload), user_id=seeded_user.id, server_head=None)
    assert changed.tables["accounts"] == RestoreTableDiff(current=1, incoming=1, identical=False)
    assert parsed.rows["accounts"][0]["sort_order"] == 2
    # A dry run writes nothing: no restore point, no run, no change-log row.
    assert not restore_points_dir().exists()
    assert await count(db, LifecycleRun) == 0 and await count(db, ChangeLog) == 0
```

Add `RestoreTableDiff` to the test file's imports: `from app.schemas.lifecycle import RestoreTableDiff`.

- [ ] **Step 2: Run to verify they fail**

Run: `FINANCE_TEST_DB=finance_test_l1 <venv-python> -m pytest tests/test_restore.py -q -k "parse_tables or diff_tables"`
Expected: FAIL — `ImportError: cannot import name 'parse_tables'`.

- [ ] **Step 3: Implement**

Append to `backend/app/lifecycle/restore.py`:

```python
@dataclass
class ParsedTables:
    # table -> parsed rows; EVERY model column present (absent ones as None) so the identity
    # hash and the live rows write the same columns
    rows: dict[str, list[dict[str, object]]]
    # table -> the model columns the file lacked; dropped at insert time so the column
    # DEFAULT applies (an explicit None would violate NOT NULL)
    absent: dict[str, list[str]] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)


def parse_tables(snapshot: LoadedSnapshot, *, user_id: int | None) -> ParsedTables:
    parsed = ParsedTables(rows={})
    for model, name in EXPORTED_TABLES:
        columns = list(model.__table__.columns)
        model_keys = [column.key for column in columns]
        rows = snapshot.tables[name]
        file_keys: set[str] = set().union(*(row.keys() for row in rows)) if rows else set()
        unknown = sorted(file_keys - set(model_keys))
        if unknown:
            raise SnapshotError(
                422, f"Snapshot column {name}.{unknown[0]} is unknown to this server"
            )
        absent = sorted(set(model_keys) - file_keys) if rows else []
        parsed.absent[name] = absent
        for column_key in absent:
            parsed.warnings.append(
                f"{name}.{column_key} is absent from the snapshot — the column default applies"
            )
        out: list[dict[str, object]] = []
        for row in rows:
            try:
                out.append({column.key: parse_cell(column, row.get(column.key)) for column in columns})
            except ValueError as exc:
                raise SnapshotError(422, f"Snapshot value in {exc}") from None
        if name == "user_preferences":
            out = _rewrite_preferences(out, user_id, parsed.warnings)
        parsed.rows[name] = out
    if snapshot.environment is not None and snapshot.environment != settings.environment:
        parsed.warnings.append(
            f"Snapshot was exported from a '{snapshot.environment}' environment; "
            f"this server is '{settings.environment}'"
        )
    return parsed


def _rewrite_preferences(
    rows: list[dict[str, object]], user_id: int | None, warnings: list[str]
) -> list[dict[str, object]]:
    """user_preferences.user_id becomes the caller's (spec §7 step 4) — a snapshot from
    another account is this user's data now. One row per key; nothing without a user."""
    if not rows:
        return rows
    if user_id is None:
        warnings.append("user_preferences skipped — no user to attach them to")
        return []
    seen: set[object] = set()
    rewritten: list[dict[str, object]] = []
    for row in rows:
        if row["key"] in seen:
            continue
        seen.add(row["key"])
        rewritten.append({**row, "user_id": user_id})
    return rewritten


def _digest(columns, rows: list[dict[str, object]]) -> str:
    return hashlib.sha256(csv_for_rows(columns, rows).encode("utf-8")).hexdigest()


async def _current_rows(db: AsyncSession, model: type, name: str) -> list[dict[str, object]]:
    """The live table as the export would write it — redactions included, so a snapshot
    (which never carries the key row) compares fairly."""
    rows = (
        (await db.execute(select(model).order_by(*model.__table__.primary_key.columns)))
        .scalars()
        .all()
    )
    redacted = REDACTED_ROWS.get(name)
    if redacted is not None:
        rows = [row for row in rows if row.key not in redacted]
    columns = list(model.__table__.columns)
    return [row_dict(row, columns) for row in rows]


async def diff_tables(db: AsyncSession, parsed: ParsedTables) -> dict[str, RestoreTableDiff]:
    diffs: dict[str, RestoreTableDiff] = {}
    for model, name in EXPORTED_TABLES:
        columns = list(model.__table__.columns)
        current = await _current_rows(db, model, name)
        incoming = parsed.rows[name]
        diffs[name] = RestoreTableDiff(
            current=len(current),
            incoming=len(incoming),
            identical=_digest(columns, current) == _digest(columns, incoming),
        )
    return diffs


async def _preserved_keys_present(db: AsyncSession) -> list[str]:
    return sorted(
        (
            await db.execute(
                select(AppSetting.key).where(AppSetting.key.in_(RESTORE_PRESERVED_SETTINGS))
            )
        ).scalars()
    )


async def plan_restore(
    db: AsyncSession,
    snapshot: LoadedSnapshot,
    *,
    user_id: int | None,
    server_head: str | None,
) -> RestoreReport:
    """The dry run (spec §7): counts and identity per table, warnings, nothing written."""
    schema = check_schema(snapshot, server_head)
    parsed = parse_tables(snapshot, user_id=user_id)
    return RestoreReport(
        dry_run=True,
        applied=False,
        exported_at=snapshot.exported_at,
        schema=schema,
        tables=await diff_tables(db, parsed),
        preserved_settings=await _preserved_keys_present(db),
        warnings=parsed.warnings,
        errors=[],
        restore_point=None,
        batch_id=None,
        run_id=None,
    )
```

- [ ] **Step 4: Run the tests**

Run: `FINANCE_TEST_DB=finance_test_l1 <venv-python> -m pytest tests/test_restore.py -q`
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/lifecycle/restore.py backend/tests/test_restore.py
git commit -m "feat(lifecycle): parse_tables, diff_tables, plan_restore — the dry run"
```

---

### Task 3: `apply_restore` — the transaction

**Files:**
- Modify: `backend/app/lifecycle/restore.py`
- Test: `backend/tests/test_restore.py` (append)

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_restore.py`:

```python
# ── apply_restore ────────────────────────────────────────────────────────────────────


async def seed_a_book(db, seeded_user) -> None:
    """A workbook import plus the UI-only rows the workbook never carries (spec §13)."""
    from app.importer.service import run_import
    from tests.workbook_builder import build_workbook

    report = await run_import(build_workbook(), db, dry_run=False)
    assert report.applied and not report.has_errors
    category = (await db.execute(select(SpendingCategory).order_by(SpendingCategory.id))).scalars().first()
    db.add(CategoryBudget(category_id=category.id, effective_month=date(2024, 1, 1), amount=Decimal("500.00")))
    db.add(CustomEvent(event_date=date(2026, 12, 25), label="Bonus lands", detail=None))
    db.add(
        CreditCard(
            name="Sapphire", slug="sapphire", rewards_currency="points",
            annual_fee=Decimal("95.00"), point_value_cents=Decimal("1.5000"),
        )
    )
    db.add(UserPreference(user_id=seeded_user.id, key="theme", value="light"))
    await db.commit()


async def wipe_exported_tables(db) -> None:
    names = ", ".join(f'"{name}"' for name in TABLE_NAMES)
    await db.execute(text(f"TRUNCATE {names} RESTART IDENTITY CASCADE"))
    await db.commit()


async def restore_now(db, payload: bytes, user_id: int) -> RestoreReport:
    return await apply_restore(
        db,
        load_snapshot(payload),
        user_id=user_id,
        actor="me@example.com",
        server_head=None,
        source_name="finance-export.zip",
        size_bytes=len(payload),
    )


async def test_apply_restore_round_trips_every_table_byte_for_byte(db, seeded_user):
    await seed_a_book(db, seeded_user)
    before = await build_snapshot_zip(db)
    assert before.counts["accounts"] == 3 and before.counts["credit_cards"] == 1
    await wipe_exported_tables(db)
    assert await count(db, Account) == 0

    report = await restore_now(db, before.payload, seeded_user.id)
    assert report.applied is True and report.dry_run is False
    assert report.tables["accounts"] == RestoreTableDiff(current=0, incoming=3, identical=False)
    assert report.restore_point is not None and (restore_points_dir() / report.restore_point).is_file()
    assert report.batch_id is not None and report.run_id is not None

    after = await build_snapshot_zip(db)
    a = zipfile.ZipFile(io.BytesIO(before.payload))
    b = zipfile.ZipFile(io.BytesIO(after.payload))
    assert json.loads(a.read("finance-export.json"))["tables"] == json.loads(b.read("finance-export.json"))["tables"]
    for name in a.namelist():
        if name.startswith("csv/"):
            assert a.read(name) == b.read(name), name

    # The trail: one summary change-log row, one restore run holding the report, plus the
    # restore point's own run (committed before the transaction).
    rows = (await db.execute(select(ChangeLog))).scalars().all()
    assert [(r.op, r.source, r.table_name) for r in rows] == [("batch", "restore", "*")]
    assert rows[0].after == {"tables": {name: diff.incoming for name, diff in report.tables.items()}}
    assert rows[0].batch_id == report.batch_id
    runs = (await db.execute(select(LifecycleRun).order_by(LifecycleRun.id))).scalars().all()
    assert [r.kind for r in runs] == ["restore_point", "restore"]
    assert runs[1].id == report.run_id and runs[1].batch_id == report.batch_id
    assert runs[1].report["restore_point"] == report.restore_point
    assert runs[1].filename == "finance-export.zip" and runs[1].size_bytes == len(before.payload)


async def test_apply_restore_preserves_this_servers_operational_settings(db, seeded_user):
    db.add(AppSetting(key="backup_status", value={"snapshot": True}))
    db.add(AppSetting(key="swr_pct", value={"value": "0.04"}))
    await db.commit()
    snap = await build_snapshot_zip(db)  # carries backup_status = {"snapshot": True}
    for key, value in (("backup_status", {"server": True}), ("nvidia_api_key", {"value": "nvapi-x"}), ("swr_pct", {"value": "0.99"})):
        setting = await db.get(AppSetting, key)
        if setting is None:
            db.add(AppSetting(key=key, value=value))
        else:
            setting.value = value
    await db.commit()

    report = await restore_now(db, snap.payload, seeded_user.id)
    assert report.preserved_settings == ["backup_status", "nvidia_api_key"]
    stored = {s.key: s.value for s in (await db.execute(select(AppSetting))).scalars()}
    assert stored["backup_status"] == {"server": True}  # this server's marker, not the snapshot's
    assert stored["nvidia_api_key"] == {"value": "nvapi-x"}  # the key survives a restore
    assert stored["swr_pct"] == {"value": "0.04"}  # ordinary settings come from the snapshot
    for key in RESTORE_PRESERVED_SETTINGS:
        assert key in {"nvidia_api_key", "backup_status", "backup_runs", "refresh_runs", "last_refresh"}


async def test_apply_restore_rewrites_preferences_fixes_the_self_reference_and_resumes_sequences(db, seeded_user):
    parent = Account(name="401k", slug="401k", group="pre_tax", sort_order=1)
    db.add(parent)
    await db.flush()
    # The child has the LOWER sort but the HIGHER id: the export writes it after its parent,
    # but a snapshot from a book where the child was created first would not — the apply
    # must not depend on file order for the self-reference.
    child = Account(name="401k Bucket", slug="401k-bucket", group="pre_tax", sort_order=0, is_component=True, parent_account_id=parent.id)
    db.add(child)
    db.add(UserPreference(user_id=seeded_user.id, key="density", value="compact"))
    await db.commit()
    snap = await build_snapshot_zip(db)

    def swap_order_and_user(tables):
        tables["accounts"].reverse()  # child first
        tables["user_preferences"][0]["user_id"] = 999

    await wipe_exported_tables(db)
    report = await restore_now(db, rezip(snap.payload, tables_patch=swap_order_and_user), seeded_user.id)
    assert report.applied is True
    accounts = {a.slug: a for a in (await db.execute(select(Account))).scalars()}
    assert accounts["401k-bucket"].parent_account_id == accounts["401k"].id
    pref = (await db.execute(select(UserPreference))).scalar_one()
    assert (pref.user_id, pref.key, pref.value) == (seeded_user.id, "density", "compact")
    # Sequences resume past the restored ids: the next account is max(id)+1, not a collision.
    fresh = Account(name="New", slug="new", group="cash", sort_order=9)
    db.add(fresh)
    await db.commit()
    assert fresh.id == max(accounts["401k"].id, accounts["401k-bucket"].id) + 1


async def test_apply_restore_keeps_three_restore_points(db, seeded_user):
    snap = await build_snapshot_zip(db)
    for _ in range(4):
        await restore_now(db, snap.payload, seeded_user.id)
    assert len(list(restore_points_dir().iterdir())) == 3
    kinds = [r.kind for r in (await db.execute(select(LifecycleRun).order_by(LifecycleRun.id))).scalars()]
    assert kinds == ["restore_point", "restore"] * 4


async def test_apply_restore_rolls_back_and_keeps_the_restore_point_on_failure(db, seeded_user, monkeypatch):
    db.add(Account(name="Keep", slug="keep", group="cash", sort_order=1))
    await db.commit()
    snap = await build_snapshot_zip(db)

    def explode():
        raise RuntimeError("disk on fire")

    monkeypatch.setattr("app.lifecycle.restore._exported_in_fk_order", explode)
    with pytest.raises(RuntimeError, match="disk on fire"):
        await restore_now(db, snap.payload, seeded_user.id)
    await db.rollback()  # what the router does
    assert await count(db, Account) == 1  # the TRUNCATE rolled back with everything else
    assert await count(db, ChangeLog) == 0
    runs = (await db.execute(select(LifecycleRun))).scalars().all()
    assert [r.kind for r in runs] == ["restore_point"]  # committed on its own, still listed
    assert len(list(restore_points_dir().iterdir())) == 1
```

Add `from app.schemas.lifecycle import RestoreReport, RestoreTableDiff` to the imports (replacing the Task 2 import line).

- [ ] **Step 2: Run to verify they fail**

Run: `FINANCE_TEST_DB=finance_test_l1 <venv-python> -m pytest tests/test_restore.py -q -k apply_restore`
Expected: FAIL — `apply_restore` not defined / not importable.

- [ ] **Step 3: Implement**

Append to `backend/app/lifecycle/restore.py`:

```python
def _exported_in_fk_order() -> list[tuple[type, str]]:
    """The exported tables in Base.metadata.sorted_tables order — people before accounts,
    snapshots before balances. The export's own order is not FK-safe."""
    by_name = {name: model for model, name in EXPORTED_TABLES}
    return [(by_name[table.name], table.name) for table in Base.metadata.sorted_tables if table.name in by_name]


def _label_for(snapshot: LoadedSnapshot) -> str:
    if snapshot.exported_at is None:
        return "Restored snapshot"
    at = snapshot.exported_at
    return f"Restored snapshot from {at:%b} {at.day}, {at.year}"  # no %-d: not portable


async def apply_restore(
    db: AsyncSession,
    snapshot: LoadedSnapshot,
    *,
    user_id: int | None,
    actor: str | None,
    server_head: str | None,
    source_name: str | None,
    size_bytes: int | None,
) -> RestoreReport:
    """The seven steps of spec §7, one transaction after the restore point. The caller
    rolls back on any exception (the router and the CLI both do); the restore point's run
    was committed on its own and stays listed."""
    schema = check_schema(snapshot, server_head)
    parsed = parse_tables(snapshot, user_id=user_id)
    # (1) The current database, kept: commits its own run; raising here means nothing below ran.
    point = await write_restore_point(db, actor=actor)
    # (2) This server's operational rows, read before the truncate.
    preserved_rows = [
        (setting.key, setting.value)
        for setting in (
            await db.execute(
                select(AppSetting).where(AppSetting.key.in_(RESTORE_PRESERVED_SETTINGS))
            )
        ).scalars()
    ]
    preserved_keys = sorted(key for key, _ in preserved_rows)
    tables = await diff_tables(db, parsed)  # what this restore changes, measured first
    # (3) One statement. CASCADE reaches nothing outside the set: the trails and users have
    # no FKs INTO the exported tables (user_preferences points the other way, at users).
    names = ", ".join(f'"{name}"' for _, name in EXPORTED_TABLES)
    await db.execute(text(f"TRUNCATE {names} RESTART IDENTITY CASCADE"))
    # Every instance the session loaded now describes a row that no longer exists.
    db.expunge_all()
    # (4) Insert in FK order; the self-reference goes in null and is fixed up after.
    for model, name in _exported_in_fk_order():
        table = model.__table__
        absent = set(parsed.absent.get(name, ()))
        rows = [{key: value for key, value in row.items() if key not in absent} for row in parsed.rows[name]]
        if name == "app_settings":
            rows = [row for row in rows if row["key"] not in RESTORE_PRESERVED_SETTINGS]
        deferred: list[tuple[object, object]] = []
        self_ref = SELF_REFERENCES.get(name)
        if self_ref is not None:
            fixed: list[dict[str, object]] = []
            for row in rows:
                if row.get(self_ref) is not None:
                    deferred.append((row["id"], row[self_ref]))
                    row = {**row, self_ref: None}
                fixed.append(row)
            rows = fixed
        if rows:
            await db.execute(insert(table), rows)
        for pk_value, ref in deferred:
            await db.execute(update(table).where(table.c.id == pk_value).values({self_ref: ref}))
    # (5) Sequences resume past the restored ids (RESTART IDENTITY reset them to 1).
    for model, name in EXPORTED_TABLES:
        table = model.__table__
        auto = table.autoincrement_column
        if auto is None:
            continue
        await db.execute(
            text(
                f"SELECT setval(pg_get_serial_sequence('{name}', '{auto.key}'), "
                f"COALESCE((SELECT MAX({auto.key}) FROM {name}), 0) + 1, false)"
            )
        )
    # (6) This server's rows come back.
    if preserved_rows:
        await db.execute(
            insert(AppSetting.__table__), [{"key": key, "value": value} for key, value in preserved_rows]
        )
    # (7) Record it — inside the same transaction, so a failed restore records nothing.
    counts = {name: diff.incoming for name, diff in tables.items()}
    batch_id: UUID = uuid4()
    db.add(
        ChangeLog(
            batch_id=batch_id,
            source="restore",
            actor=actor,
            label=_label_for(snapshot),
            table_name="*",
            pk={},
            op="batch",
            before=None,
            after={"tables": counts},
            month=None,
        )
    )
    run = LifecycleRun(
        kind="restore",
        dry_run=False,
        ok=True,
        actor=actor,
        filename=source_name,
        size_bytes=size_bytes,
        batch_id=batch_id,
    )
    db.add(run)
    await db.flush()
    report = RestoreReport(
        dry_run=False,
        applied=True,
        exported_at=snapshot.exported_at,
        schema=schema,
        tables=tables,
        preserved_settings=preserved_keys,
        warnings=parsed.warnings,
        errors=[],
        restore_point=point.name,
        batch_id=batch_id,
        run_id=run.id,
    )
    run.report = report.model_dump(mode="json")
    await db.commit()
    logger.info("restored snapshot %s: %s", source_name, counts)
    return report
```

- [ ] **Step 4: Run the tests**

Run: `FINANCE_TEST_DB=finance_test_l1 <venv-python> -m pytest tests/test_restore.py -q`
Expected: 13 passed. If the round trip differs on `latest_prices.quoted_at`, the import seeded `datetime.now(UTC)` with microseconds and `parse_cell` → `datetime.fromisoformat` keeps them — check `json_cell` produced `+00:00` (it does; both sides are the same function). If `accounts` differs only in row ORDER, the export sorts by primary key on both sides — the comparison is of the JSON `tables`, which are PK-ordered lists, so an order difference means an id changed: check the sequence step ran BEFORE any insert that could allocate ids (none do — every row carries its id).

- [ ] **Step 5: Commit**

```bash
git add backend/app/lifecycle/restore.py backend/tests/test_restore.py
git commit -m "feat(lifecycle): apply_restore — restore point, truncate, FK-ordered inserts, sequences, preserved settings, trail"
```

---

### Task 4: The routes — `POST /import/snapshot` and `/import/snapshot/stored/{name}`

**Files:**
- Modify: `backend/app/api/import_.py`
- Test: `backend/tests/test_restore_api.py`

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_restore_api.py
import asyncio
import io
import json
import zipfile

from sqlalchemy import func, select

from app.models import Account, LifecycleRun
from app.services.snapshot import build_snapshot_zip, snapshots_dir
from tests.test_restore import rezip

UPLOAD = "/api/v1/import/snapshot"
STORED = "/api/v1/import/snapshot/stored"


def upload(payload: bytes, name: str = "finance-export.zip"):
    return {"file": (name, payload, "application/zip")}


async def count_accounts(db) -> int:
    return (await db.execute(select(func.count()).select_from(Account))).scalar_one()


async def test_restore_requires_auth(client):
    assert (await client.post(UPLOAD, files=upload(b"x"))).status_code == 401
    assert (await client.post(f"{STORED}/finance-export-20260904-233000.zip")).status_code == 401


async def test_dry_run_is_the_default_and_writes_nothing(auth_client, db):
    db.add(Account(name="A", slug="a", group="cash", sort_order=1))
    await db.commit()
    snap = await build_snapshot_zip(db)
    account = (await db.execute(select(Account))).scalar_one()
    account.sort_order = 5
    await db.commit()

    resp = await auth_client.post(UPLOAD, files=upload(snap.payload))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["dry_run"] is True and body["applied"] is False
    assert body["schema"] == {"snapshot_head": None, "server_head": None, "compatible": True}
    assert body["tables"]["accounts"] == {"current": 1, "incoming": 1, "identical": False}
    assert body["restore_point"] is None and body["batch_id"] is None and body["run_id"] is None
    assert body["exported_at"] == snap.exported_at.isoformat()
    assert (await db.execute(select(Account))).scalar_one().sort_order == 5
    assert (await db.execute(select(func.count()).select_from(LifecycleRun))).scalar_one() == 0


async def test_apply_restores_and_records(auth_client, db):
    db.add(Account(name="A", slug="a", group="cash", sort_order=1))
    await db.commit()
    snap = await build_snapshot_zip(db)
    account = (await db.execute(select(Account))).scalar_one()
    account.sort_order = 5
    await db.commit()

    resp = await auth_client.post(f"{UPLOAD}?dry_run=false", files=upload(snap.payload, "sep2.zip"))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["applied"] is True and body["restore_point"].startswith("pre-restore-")
    assert (await db.execute(select(Account))).scalar_one().sort_order == 1
    runs = (await db.execute(select(LifecycleRun).order_by(LifecycleRun.id))).scalars().all()
    assert [r.kind for r in runs] == ["restore_point", "restore"]
    assert runs[1].filename == "sep2.zip" and runs[1].actor == "me@example.com"
    assert runs[1].report["applied"] is True
    # The session survives: the same token still works after every exported table moved.
    assert (await auth_client.get("/api/v1/auth/me")).status_code == 200


async def test_the_gates_answer_400_422_409(auth_client, db):
    snap = await build_snapshot_zip(db)
    bad = await auth_client.post(UPLOAD, files=upload(b"not a zip"))
    assert bad.status_code == 400 and bad.json()["detail"] == "Not a snapshot ZIP from this app"

    def drop_people(tables):
        del tables["people"]

    missing = await auth_client.post(UPLOAD, files=upload(rezip(snap.payload, tables_patch=drop_people)))
    assert missing.status_code == 422 and "missing table(s) people" in missing.json()["detail"]
    foreign = await auth_client.post(
        UPLOAD, files=upload(rezip(snap.payload, manifest_patch={"alembic_head": "b8e4d17c2a90"}))
    )
    assert foreign.status_code == 409
    assert foreign.json()["detail"].startswith("This snapshot was exported at schema `b8e4d17c2a90`; this server runs `none`.")
    too_big = await auth_client.post(UPLOAD, files=upload(b"x" * (15 * 1024 * 1024 + 1)))
    assert too_big.status_code == 413


async def test_stored_snapshot_restores_by_name_and_refuses_foreign_names(auth_client, db):
    db.add(Account(name="A", slug="a", group="cash", sort_order=1))
    await db.commit()
    snap = await build_snapshot_zip(db)
    directory = snapshots_dir()
    directory.mkdir(parents=True)
    (directory / "finance-export-20260904-233000.zip").write_bytes(snap.payload)
    (directory / "notes.txt").write_bytes(b"x")
    await db.execute(Account.__table__.delete())
    await db.commit()

    resp = await auth_client.post(f"{STORED}/finance-export-20260904-233000.zip?dry_run=false")
    assert resp.status_code == 200, resp.text
    assert resp.json()["applied"] is True
    assert await count_accounts(db) == 1
    for name in ("notes.txt", "..%2Ffinance-export-20260904-233000.zip", "finance-export-20260904-999999.zip"):
        missing = await auth_client.post(f"{STORED}/{name}")
        assert missing.status_code == 404, name
        assert missing.json()["detail"].startswith("No stored snapshot named")


async def test_a_failure_after_the_restore_point_answers_500_and_changes_nothing(auth_client, db, monkeypatch):
    db.add(Account(name="Keep", slug="keep", group="cash", sort_order=1))
    await db.commit()
    snap = await build_snapshot_zip(db)

    def explode():
        raise RuntimeError("disk on fire")

    monkeypatch.setattr("app.lifecycle.restore._exported_in_fk_order", explode)
    resp = await auth_client.post(f"{UPLOAD}?dry_run=false", files=upload(snap.payload))
    assert resp.status_code == 500
    assert resp.json()["detail"] == "Restore failed and nothing was changed"
    await db.rollback()
    assert await count_accounts(db) == 1
    runs = (await db.execute(select(LifecycleRun))).scalars().all()
    assert [r.kind for r in runs] == ["restore_point"]
```

- [ ] **Step 2: Run to verify they fail**

Run: `FINANCE_TEST_DB=finance_test_l1 <venv-python> -m pytest tests/test_restore_api.py -q`
Expected: FAIL — 404s (no such routes) and a 401 test that passes by accident is fine.

- [ ] **Step 3: Implement**

Replace `backend/app/api/import_.py` wholesale (the xlsx route is unchanged; the snapshot routes are appended):

```python
"""Imports (workbook) and restores (the app's own snapshot ZIP) — both dry-run by default.

The restore routes (2026-09-03 data-lifecycle spec §7) are thin: load, gate, plan or apply,
and map SnapshotError to its status. Anything else that escapes AFTER the restore point is a
500 with one sentence and a rollback — the transaction guarantees the "nothing was changed"
half, the committed restore-point run guarantees the file stays listed."""

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.importer import ImportReport, InvalidWorkbookError, run_import
from app.lifecycle.restore import SnapshotError, apply_restore, load_snapshot, plan_restore
from app.models import User
from app.schemas.lifecycle import RestoreReport
from app.services.snapshot import SNAPSHOT_NAME_RE, alembic_head, snapshots_dir

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/import", tags=["import"])

MAX_UPLOAD_BYTES = 15 * 1024 * 1024  # real workbook is <1 MB; generous ceiling
RESTORE_FAILED = "Restore failed and nothing was changed"


@router.post("/xlsx", response_model=ImportReport)
async def import_xlsx(
    file: UploadFile,
    dry_run: bool = Query(True),  # safe default: preview, never write
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ImportReport:
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 15 MB)")
    try:
        return await run_import(data, db, dry_run=dry_run)
    except InvalidWorkbookError:
        raise HTTPException(status_code=400, detail="Not a valid .xlsx workbook") from None


@router.post("/snapshot", response_model=RestoreReport)
async def import_snapshot(
    file: UploadFile,
    dry_run: bool = Query(True),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RestoreReport:
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 15 MB)")
    return await _restore(
        data, dry_run=dry_run, user=user, db=db, source_name=file.filename or "upload.zip"
    )


@router.post("/snapshot/stored/{name}", response_model=RestoreReport)
async def import_stored_snapshot(
    name: str,
    dry_run: bool = Query(True),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RestoreReport:
    # The name grammar IS the path-safety check: a match cannot carry a separator or a dot
    # segment, so nothing but a stored snapshot is ever opened.
    path = snapshots_dir() / name
    if SNAPSHOT_NAME_RE.fullmatch(name) is None or not await asyncio.to_thread(path.is_file):
        raise HTTPException(status_code=404, detail=f"No stored snapshot named {name!r}")
    data = await asyncio.to_thread(path.read_bytes)
    return await _restore(data, dry_run=dry_run, user=user, db=db, source_name=name)


async def _restore(
    data: bytes, *, dry_run: bool, user: User, db: AsyncSession, source_name: str
) -> RestoreReport:
    # Read BEFORE the apply: it expunges every loaded instance, this User included.
    user_id, actor = user.id, user.email
    try:
        snapshot = load_snapshot(data)
        head = await alembic_head(db)
        if dry_run:
            return await plan_restore(db, snapshot, user_id=user_id, server_head=head)
        return await apply_restore(
            db,
            snapshot,
            user_id=user_id,
            actor=actor,
            server_head=head,
            source_name=source_name,
            size_bytes=len(data),
        )
    except SnapshotError as exc:
        await db.rollback()
        raise HTTPException(status_code=exc.status, detail=exc.detail) from None
    except Exception:
        await db.rollback()
        logger.exception("restore of %s failed", source_name)
        raise HTTPException(status_code=500, detail=RESTORE_FAILED) from None
```

- [ ] **Step 4: Run the tests**

Run: `FINANCE_TEST_DB=finance_test_l1 <venv-python> -m pytest tests/test_restore_api.py tests/test_import_api.py -q`
Expected: all passed (the xlsx tests are untouched).

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/import_.py backend/tests/test_restore_api.py
git commit -m "feat(api): POST /import/snapshot and /import/snapshot/stored/{name} — dry run and apply"
```

---

### Task 5: The CLI — `python -m app.lifecycle restore|verify`

**Files:**
- Create: `backend/app/lifecycle/__main__.py`
- Test: `backend/tests/test_lifecycle_cli.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_lifecycle_cli.py
from datetime import UTC, datetime
from pathlib import Path

import pytest

from app.lifecycle.__main__ import build_parser, render_report, verify_verdict
from app.schemas.lifecycle import RestoreReport, RestoreSchema, RestoreTableDiff


def make_report(identical: bool) -> RestoreReport:
    return RestoreReport(
        dry_run=True,
        applied=False,
        exported_at=datetime(2026, 9, 2, 23, 30, tzinfo=UTC),
        schema=RestoreSchema(snapshot_head=None, server_head=None, compatible=True),
        tables={
            "accounts": RestoreTableDiff(current=3, incoming=3, identical=True),
            "account_balances": RestoreTableDiff(current=90, incoming=87, identical=identical),
        },
        preserved_settings=["backup_status"],
        warnings=["accounts.person_id is absent from the snapshot — the column default applies"],
        errors=[],
        restore_point="pre-restore-20260904-091500-123456.zip" if not identical else None,
        batch_id=None,
        run_id=None,
    )


def test_parser_has_the_two_commands_and_the_dry_run_flag():
    args = build_parser().parse_args(["restore", "book.zip", "--dry-run"])
    assert (args.command, args.zip, args.dry_run) == ("restore", Path("book.zip"), True)
    args = build_parser().parse_args(["restore", "book.zip"])
    assert args.dry_run is False
    args = build_parser().parse_args(["verify", "book.zip"])
    assert args.command == "verify"
    with pytest.raises(SystemExit):
        build_parser().parse_args(["book.zip"])  # a command is required


def test_render_report_prints_counts_flags_warnings_and_the_restore_point():
    text = render_report(make_report(identical=False))
    assert text.splitlines() == [
        "dry_run=True applied=False schema=ok",
        "  = accounts: 3 -> 3",
        "  ~ account_balances: 90 -> 87",
        "  WARN: accounts.person_id is absent from the snapshot — the column default applies",
        "restore point: pre-restore-20260904-091500-123456.zip",
    ]


def test_verify_verdict_names_the_tables_that_differ():
    assert verify_verdict(make_report(identical=True)) == ("PASS: 2 tables identical", 0)
    assert verify_verdict(make_report(identical=False)) == (
        "FAIL: 1 table(s) differ: account_balances",
        1,
    )
```

- [ ] **Step 2: Run to verify it fails**

Run: `FINANCE_TEST_DB=finance_test_l1 <venv-python> -m pytest tests/test_lifecycle_cli.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.lifecycle.__main__'`.

- [ ] **Step 3: Write the CLI**

```python
# backend/app/lifecycle/__main__.py
"""CLI: python -m app.lifecycle restore <zip> [--dry-run]  |  python -m app.lifecycle verify <zip>

Exit codes mirror app.importer: 0 = done (verify: PASS), 1 = the restore failed and was
rolled back, or verify found a differing table, 2 = the file is unreadable or incompatible
(not a snapshot, wrong tables, wrong schema head). Runs against DATABASE_URL from the
environment/.env like app.seed — the restore drill (scripts/restore_drill.sh) points that at
a scratch database. Preferences attach to the lowest user id (seed.py's convention).
"""

import argparse
import asyncio
import sys
from pathlib import Path

from sqlalchemy import select

from app.database import SessionLocal, engine
from app.lifecycle.restore import SnapshotError, apply_restore, load_snapshot, plan_restore
from app.models import User
from app.schemas.lifecycle import RestoreReport
from app.services.snapshot import alembic_head


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m app.lifecycle",
        description="Restore the app's own snapshot ZIP, or verify the live database against one.",
    )
    sub = parser.add_subparsers(dest="command", required=True)
    restore = sub.add_parser("restore", help="replace every exported table from the ZIP")
    restore.add_argument("zip", type=Path, help="a finance-export-*.zip")
    restore.add_argument("--dry-run", action="store_true", help="report the diff without writing")
    verify = sub.add_parser("verify", help="compare the live database to the ZIP, table by table")
    verify.add_argument("zip", type=Path, help="a finance-export-*.zip")
    return parser


def render_report(report: RestoreReport) -> str:
    lines = [
        f"dry_run={report.dry_run} applied={report.applied} "
        f"schema={'ok' if report.schema_.compatible else 'MISMATCH'}"
    ]
    for name, diff in report.tables.items():
        flag = "=" if diff.identical else "~"
        lines.append(f"  {flag} {name}: {diff.current} -> {diff.incoming}")
    for warning in report.warnings:
        lines.append(f"  WARN: {warning}")
    if report.restore_point is not None:
        lines.append(f"restore point: {report.restore_point}")
    return "\n".join(lines)


def verify_verdict(report: RestoreReport) -> tuple[str, int]:
    differing = [name for name, diff in report.tables.items() if not diff.identical]
    if differing:
        return f"FAIL: {len(differing)} table(s) differ: {', '.join(differing)}", 1
    return f"PASS: {len(report.tables)} tables identical", 0


async def _amain(command: str, zip_path: Path, dry_run: bool) -> int:
    # One-shot CLI: blocking read before any awaits is fine (nothing else on the loop yet).
    data = zip_path.read_bytes()  # noqa: ASYNC240
    try:
        async with SessionLocal() as db:
            user = (await db.execute(select(User).order_by(User.id))).scalars().first()
            user_id = None if user is None else user.id
            actor = "cli" if user is None else f"cli:{user.email}"
            head = await alembic_head(db)
            try:
                snapshot = load_snapshot(data)
                if command == "verify" or dry_run:
                    report = await plan_restore(db, snapshot, user_id=user_id, server_head=head)
                else:
                    report = await apply_restore(
                        db,
                        snapshot,
                        user_id=user_id,
                        actor=actor,
                        server_head=head,
                        source_name=zip_path.name,
                        size_bytes=len(data),
                    )
            except SnapshotError as exc:
                print(f"error: {exc.detail}", file=sys.stderr)
                return 2
            except Exception as exc:  # noqa: BLE001 — a CLI reports, it does not traceback
                await db.rollback()
                print(f"error: restore failed and nothing was changed ({exc!r})", file=sys.stderr)
                return 1
    finally:
        await engine.dispose()
    print(render_report(report))
    if command == "verify":
        verdict, code = verify_verdict(report)
        print(verdict)
        return code
    return 0


def main() -> int:
    args = build_parser().parse_args()
    if not args.zip.is_file():
        print(f"error: {args.zip} is not a file", file=sys.stderr)
        return 2
    return asyncio.run(_amain(args.command, args.zip, getattr(args, "dry_run", False)))


if __name__ == "__main__":
    raise SystemExit(main())
```

(If ruff's selected rule set does not include BLE, drop that `noqa` comment — `ruff check` will say "unused noqa".)

- [ ] **Step 4: Run the tests, then a live dry run against the dev database**

Run: `FINANCE_TEST_DB=finance_test_l1 <venv-python> -m pytest tests/test_lifecycle_cli.py -q` → 3 passed.

Live check (dev Postgres up, from `backend/`): export the dev database and verify it against itself —
`<venv-python> -c "import asyncio, pathlib; from app.database import SessionLocal, engine; from app.services.snapshot import build_snapshot_zip; async def go(): 
  async with SessionLocal() as db: snap = await build_snapshot_zip(db); pathlib.Path('dev.zip').write_bytes(snap.payload); await engine.dispose()
asyncio.run(go())"` (one line; or write it as a five-line script in the scratchpad), then
`<venv-python> -m app.lifecycle verify dev.zip` → ends with `PASS: 35 tables identical`, exit 0 (`echo $?`). Delete `dev.zip` afterwards. `restore --dry-run dev.zip` prints the same table lines with `=` flags.

- [ ] **Step 5: Commit**

```bash
git add backend/app/lifecycle/__main__.py backend/tests/test_lifecycle_cli.py
git commit -m "feat(lifecycle): CLI — restore [--dry-run] and verify with importer-style exit codes"
```

---

### Task 6: Lane suite, lint

- [ ] **Step 1: Run everything this lane touches plus the neighbours**

Run (from `backend/`): `FINANCE_TEST_DB=finance_test_l1 <venv-python> -m pytest -q tests/test_restore.py tests/test_restore_api.py tests/test_lifecycle_cli.py tests/test_import_api.py tests/test_export_api.py tests/test_snapshot_service.py && <venv-python> -m ruff check app tests && <venv-python> -m ruff format --check app tests`
Expected: all passed; ruff clean.

- [ ] **Step 2: Whole suite once**

Run: `FINANCE_TEST_DB=finance_test_l1 <venv-python> -m pytest -q` → all green.

---

## Merge notes for the coordinator

- `backend/app/api/import_.py` is also edited by L2 (it passes `actor=user.email` into `run_import` and reads the pre-import restore point) — expect a conflict inside `import_xlsx`; keep L2's call and this lane's two new routes + `_restore`.
- `backend/app/main.py` is NOT touched here (the routes ride the existing `import_` router).
- The drill (L4's `restore_drill.sh`) calls `python -m app.lifecycle restore <zip>` then `verify <zip>` and reads the exit codes above; nothing else consumes the CLI.
- The Activity card (F2) renders this lane's stored `restore` run report through Phase 0's `RestoreReportView` — the report dict is `RestoreReport.model_dump(mode="json")`, wire key `schema`.

## Self-review

**Spec coverage:** §7 routes (upload ≤ 15 MB, stored by name, `dry_run` default true) → Task 4; reading (`finance-export.json` only, manifest for head; validation order 400 → 422 tables → 409 head with the exact sentence, both-None equal → 422 unknown column → warning for an absent column; `json_cell`'s inverse shared) → Tasks 1–2; dry run (counts, identity by hashing incoming rows through the same CSV writer, writes nothing) → Task 2; apply steps 1–7 (restore point keep-three recorded as a run; `RESTORE_PRESERVED_SETTINGS` = the five keys; one TRUNCATE; `sorted_tables` order with the `accounts.parent_account_id` null-then-UPDATE; PKs kept; `user_preferences.user_id` rewritten; `setval` per identity table; preserved rows back; commit + one `op='batch'` row + a `restore` run holding the report; any exception → 500 "Restore failed and nothing was changed" with the point still listed) → Tasks 3–4; never touched: `users`, `alembic_version`, trails → structural (not in `EXPORTED_TABLES`); §7 CLI `restore [--dry-run]` / `verify`, exit codes 0/1/2 → Task 5; §13 tests: round trip with workbook + UI-only rows (budget, custom event, credit card, preference) → Task 3; dry run writes nothing, 409, 400, extra/missing 422, preserved settings survive, restore point written and trimmed to three, `user_id` rewritten, `max(id)+1` after restore, CLI exit codes → Tasks 2–5. The §15 "report names the manifest's environment" lands as a warning line. **Placeholders:** none. **Type consistency:** `SnapshotError(status, detail)`, `LoadedSnapshot(alembic_head, exported_at, environment, tables)`, `ParsedTables(rows, absent, warnings)`, `check_schema(snapshot, server_head) -> RestoreSchema`, `parse_tables(snapshot, *, user_id)`, `diff_tables(db, parsed)`, `plan_restore(db, snapshot, *, user_id, server_head)`, `apply_restore(db, snapshot, *, user_id, actor, server_head, source_name, size_bytes)`, `render_report(report)`, `verify_verdict(report) -> (str, int)` — used identically in the tests, the routes and the CLI; Phase 0 names (`build_snapshot_zip`, `write_restore_point(db, *, actor)`, `parse_cell(column, raw)`, `csv_for_rows`, `row_dict`, `alembic_head`, `snapshots_dir`, `restore_points_dir`, `SNAPSHOT_NAME_RE`, `RestoreReport(schema=…)`) match `2026-09-04-lifecycle-0-base.md`.
