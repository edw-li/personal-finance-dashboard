# System-Status Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One honest answer to "is the machine healthy?" — a new JWT-protected `GET /api/v1/system/status` composing the existing prices refresh-status (extracted into a shared function, the old endpoint untouched), the live scheduler flag, database facts (`pg_database_size`, the alembic head), and a nightly-backup marker `backup_db.sh` now upserts into `app_settings` via psql; surfaced as a **System** card on Settings (age-toned backup row: amber past 48h, red wording past 7 days) and as the Overview snapshot's replacement for its `/prices/refresh-status` fetch, where `attention.ts` gains exactly ONE new item — "Nightly backup hasn't run recently" → `/settings`, suppressed everywhere except prod.

**Architecture:** No new tables, no migration — the backup marker rides the existing `app_settings` row store, written by the shell script as a FLAT JSON object (the `{"value": ...}` envelope is a Python readers' convention; the writer here is psql) and read back with the degrade-to-None posture stored blobs always get. The backend never talks to OCI (Decision log): the script that already proved the upload records it. `prices.py`'s refresh-status composition moves verbatim into `compose_refresh_status()` so `/prices/refresh-status` (PortfolioPage's feed — it does NOT switch) and `/system/status`'s `prices` block are one function behind two doors. `alembic_head` is probed with `to_regclass` before the SELECT — a missing `alembic_version` table (every `create_all`-built database, i.e. every pytest run) is an expected state that must read as `null`, not abort the request's transaction. On the frontend, the 48-hour boundary lives ONCE in `src/utils/staleness.ts` (`backupAge`), consumed by both the Settings card's tone and the attention strip's nag so they can never flip on different hours.

**Tech Stack:** FastAPI + SQLAlchemy 2 async + Postgres 16 (real-DB pytest), React 19 + TypeScript + Vitest, bash + psql for the marker. No new dependencies. No Alembic migration.

**Spec:** `docs/superpowers/specs/2026-08-25-five-feature-batch-design.md` §3 ("System-status card") plus the Decision-log row "Backup visibility mechanism" — cite them for any ambiguity. Do NOT flip that spec's status line when done: it covers five features and four are still open; the orchestrator tracks batch status.

**Overnight protocol:** this plan starts AFTER an earlier wave merged to main — work happens in the MAIN checkout on branch `system-status` (the orchestrator creates it; Task 0 verifies a clean `git status`, the correct branch, and both smoke tests before anything else). **The wave-1 merge may have shifted line numbers in `OverviewPage.tsx` and `attention.ts` — re-read any file immediately before editing it and apply changes semantically, never by a stored line number.** Backend venv is `.venv/Scripts/python`; dev Postgres on localhost:5433 (`cd backend && docker compose up -d db` if it is down). No file deletions. Never push. Frequent small commits.

**House rules that bind every task:** GETs never reject stored data; server sentences render verbatim; Decimal strings on the wire; comments explain constraints, not narration.

---

## File structure

| File | Responsibility |
|---|---|
| `backend/app/services/scheduler.py` | `is_scheduler_running()` accessor off the module handle |
| `backend/app/api/prices.py` | `compose_refresh_status()` extraction; `/prices/refresh-status` behavior UNCHANGED |
| `backend/app/schemas/system.py` | `PricesStatusOut`, `DatabaseStatusOut`, `BackupStatusOut`, `SystemStatusOut` (new file) |
| `backend/app/api/system.py` | `GET /system/status` router (new file) |
| `backend/app/main.py` | mount the system router |
| `backend/scripts/backup_db.sh` | post-upload psql upsert of the `backup_status` marker |
| `backend/tests/test_scheduler.py` | accessor pin |
| `backend/tests/test_system_api.py` | endpoint tests (new file) |
| `src/types/api.ts` | `SystemPricesStatus`, `SystemDatabaseStatus`, `BackupStatus`, `SystemStatus` |
| `src/api/system.ts` | `fetchSystemStatus` (new file) |
| `src/utils/staleness.ts` (+test) | `backupAge` — the shared 48h/7d clock |
| `src/utils/format.ts` (+test) | `formatBytes` |
| `src/components/settings/SystemCard.tsx` (+`SystemCard.test.tsx`) | the System card (new files) |
| `src/components/settings/settings.css` | `.system-facts` rows + tone classes |
| `src/pages/SettingsPage.tsx` (+test) | mount the card; test file arms the new client mock |
| `src/components/overview/attention.ts` (+`attention.test.ts`) | inputs take `system`; the backup item + prod suppression |
| `src/pages/OverviewPage.tsx` (+`OverviewPage.test.tsx`) | swap `/prices/refresh-status` → `/system/status` |

NOT touched, on purpose: `src/api/prices.ts` (`fetchRefreshStatus` stays), `src/pages/PortfolioPage.tsx` (keeps the old endpoint), `backend/app/schemas/portfolio.py` (its shapes are reused, not moved).

---

## Phase 0 — Environment & branch verification

### Task 0: Verify the checkout the orchestrator prepared

**Files:** none (environment only)

- [ ] **Step 1: Confirm the branch and a clean tree.**

```bash
git status --porcelain   # expected: EMPTY output
git rev-parse --abbrev-ref HEAD   # expected: system-status
```

If the branch is wrong or the tree is dirty, STOP and report — do not "fix" it by switching or stashing; the orchestrator owns branch setup.

- [ ] **Step 2: Backend smoke test** (proves the venv + the 5433 dev Postgres answer).

Run: `cd backend && .venv/Scripts/python -m pytest tests/test_health.py -q`
Expected: PASS. If it errors on connection, bring the container up (`cd backend && docker compose up -d db`) and retry once; if it still fails, read `backend/app/config.py` for the dev DATABASE_URL default before proceeding — do not guess.

- [ ] **Step 3: Frontend smoke.**

Run: `npx vitest run src/utils/months.test.ts` → PASS.

---

## Phase 1 — Backend

### Task 1: `is_scheduler_running()` accessor

**Files:**
- Modify: `backend/app/services/scheduler.py`
- Test: `backend/tests/test_scheduler.py`

- [ ] **Step 1: Write the failing test.** In `backend/tests/test_scheduler.py`, extend the `from app.services.scheduler import (...)` block with `is_scheduler_running,` (alphabetical: after `get_next_run_time`). Append:

```python
def test_is_scheduler_running_tracks_the_module_handle(monkeypatch):
    # No handle at all — pytest never starts a scheduler (conftest pins the setting off).
    assert is_scheduler_running() is False

    class _Handle:
        def __init__(self, running: bool):
            self.running = running

    # The flag reads APScheduler's own .running, not the handle's mere presence: a
    # shut-down scheduler the module still holds must answer False, or the status card
    # would call a dead process "Running" for the rest of its life.
    monkeypatch.setattr("app.services.scheduler._scheduler", _Handle(True))
    assert is_scheduler_running() is True
    monkeypatch.setattr("app.services.scheduler._scheduler", _Handle(False))
    assert is_scheduler_running() is False
```

- [ ] **Step 2: Run to verify failure** — `cd backend && .venv/Scripts/python -m pytest tests/test_scheduler.py -q` → FAIL (`ImportError: cannot import name 'is_scheduler_running'`).

- [ ] **Step 3: Implement.** In `backend/app/services/scheduler.py`, insert directly below `get_next_run_time` (re-read the file first — do not place by line number):

```python
def is_scheduler_running() -> bool:
    """Whether the in-process scheduler is up — the system-status endpoint's flag
    (2026-08-25 spec §3). False when no handle exists (tests, SCHEDULER_ENABLED=0)
    AND when a held handle has been shut down: APScheduler's own .running is the
    judge, not the handle's presence."""
    return _scheduler is not None and bool(_scheduler.running)
```

Also update the module docstring's last sentence from "…so the settings router can hot-apply a saved cron and the status endpoint can name the next run; both degrade to no-op/None when nothing is running." to "…so the settings router can hot-apply a saved cron and the status endpoints can name the next run and report whether it is running; all degrade to no-op/None/False when nothing is running."

- [ ] **Step 4: Run** — `cd backend && .venv/Scripts/python -m pytest tests/test_scheduler.py -q` → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(system): is_scheduler_running accessor"`

### Task 2: Extract `compose_refresh_status()` — the old endpoint must not move

Pure extraction, zero behavior change: the existing `test_prices_api.py` suite IS the test. No new tests in this task.

**Files:**
- Modify: `backend/app/api/prices.py`

- [ ] **Step 1: Extract.** In `backend/app/api/prices.py`, replace the whole `refresh_status` endpoint (currently the `@router.get("/refresh-status", ...)` decorator through its final `return RefreshStatusOut(...)`) with the pair below. The composition body moves VERBATIM — including the actionability comment — only the function boundary is new:

```python
async def compose_refresh_status(db: AsyncSession) -> RefreshStatusOut:
    """One composition, two doors (2026-08-25 spec §3): /prices/refresh-status keeps
    serving this, and /system/status embeds it as `prices` — extracted rather than
    duplicated so the actionability filtering below can never drift between the two."""
    raw = await read_last_refresh(db)
    last: LastRefreshOut | None = None
    if raw is not None:
        try:
            last = LastRefreshOut.model_validate(raw)
        except ValueError:
            last = None
    if last is not None and last.failed:
        # Failures are reported only while still ACTIONABLE. The record is rewritten only
        # when a refresh RUNS, so a ticker the user has since deactivated (or moved to
        # manual pricing) — the two remedies for a delisted symbol — would otherwise nag
        # every consumer until the next run happened to overwrite it. Filtering HERE is
        # what keeps the Portfolio chips and the Overview strip telling one story; the
        # stored record itself stays verbatim.
        still_refreshable = set(
            (
                await db.execute(
                    select(Security.ticker).where(
                        Security.ticker.in_(last.failed),
                        Security.is_active.is_(True),
                        Security.is_manual_priced.is_(False),
                    )
                )
            ).scalars()
        )
        last = last.model_copy(
            update={
                "failed": {
                    ticker: reason
                    for ticker, reason in last.failed.items()
                    if ticker in still_refreshable
                }
            }
        )
    return RefreshStatusOut(last=last, next_run_at=get_next_run_time())


@router.get("/refresh-status", response_model=RefreshStatusOut)
async def refresh_status(db: AsyncSession = Depends(get_db)) -> RefreshStatusOut:
    """What happened last and what happens next — the header line's and the attention
    strip's feed. The stored payload is convention-shaped JSON; anything malformed reads
    as 'no run recorded' rather than a 500 (get_swr_pct's fallback posture)."""
    return await compose_refresh_status(db)
```

- [ ] **Step 2: Prove nothing moved** — `cd backend && .venv/Scripts/python -m pytest tests/test_prices_api.py -q` → ALL PASS (the empty-status, pre-feature-payload and deactivated-ticker-filter pins in particular).

- [ ] **Step 3: Commit** — `git add -A && git commit -m "refactor(prices): extract compose_refresh_status — endpoint behavior unchanged"`

### Task 3: System schemas + router + mount

**Files:**
- Create: `backend/app/schemas/system.py`, `backend/app/api/system.py`, `backend/tests/test_system_api.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: Write the failing tests** — create `backend/tests/test_system_api.py`:

```python
from datetime import UTC, datetime

from sqlalchemy import text

from app.config import settings
from app.models import AppSetting
from app.services.price_service import LAST_REFRESH_KEY

STATUS = "/api/v1/system/status"
PRICES_STATUS = "/api/v1/prices/refresh-status"

# A stored refresh outcome in record_refresh_run's exact envelope-and-payload shape.
LAST_RUN = {
    "at": "2026-08-24T20:11:00+00:00",
    "trigger": "scheduled",
    "updated": 36,
    "failed": {},
    "skipped_manual": 1,
    "history_appended": True,
    "dividends_ingested": 0,
    "dividends_removed": 0,
    "dividends_skipped_overlap": 0,
}


async def test_system_status_requires_auth(client):
    assert (await client.get(STATUS)).status_code == 401


async def test_system_status_shape_on_a_bare_database(auth_client):
    resp = await auth_client.get(STATUS)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # prices: the refresh-status shape verbatim plus the scheduler flag — False here
    # because conftest pins scheduler_enabled off and ASGITransport never runs the
    # lifespan, so no handle ever exists in tests.
    assert body["prices"] == {"last": None, "next_run_at": None, "scheduler_running": False}
    assert isinstance(body["database"]["size_bytes"], int)
    assert body["database"]["size_bytes"] > 0
    # The test schema is create_all-built — no alembic_version table — and the GET reads
    # that as None rather than 500ing (the missing-table posture; GETs never reject).
    assert body["database"]["alembic_head"] is None
    assert body["backup"] is None
    # The dev box's settings (config default). The prod passthrough is pinned below with
    # a monkeypatch, so this is the literal value, not a tautological echo.
    assert body["environment"] == "dev"


async def test_system_prices_matches_the_old_endpoint_which_stands(auth_client, db):
    db.add(AppSetting(key=LAST_REFRESH_KEY, value={"value": LAST_RUN}))
    await db.commit()
    old = (await auth_client.get(PRICES_STATUS)).json()
    new = (await auth_client.get(STATUS)).json()["prices"]
    # One composition, two doors: strip the one addition and the payloads are identical —
    # any drift between them is a bug in the Task 2 extraction, not a formatting choice.
    assert new.pop("scheduler_running") is False
    assert new == old
    assert old["last"]["updated"] == 36  # the stored record actually flowed through both


async def test_system_status_reads_the_alembic_head_when_the_table_exists(auth_client, db):
    # Prod databases are alembic-built; the test schema is not, so stage the table by
    # hand — and DROP it before leaving, because conftest's TRUNCATE walks
    # Base.metadata.sorted_tables and would never clean a stray table out of the
    # session-scoped schema (it would leak into every later test).
    await db.execute(text("CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)"))
    await db.execute(text("INSERT INTO alembic_version VALUES ('e7c5a9f4b2d8')"))
    await db.commit()
    try:
        body = (await auth_client.get(STATUS)).json()
        assert body["database"]["alembic_head"] == "e7c5a9f4b2d8"
    finally:
        await db.execute(text("DROP TABLE alembic_version"))
        await db.commit()


async def test_system_backup_marker_roundtrip(auth_client, db):
    # The exact FLAT shape backup_db.sh upserts (spec §3) — no {"value": ...} envelope.
    db.add(
        AppSetting(
            key="backup_status",
            value={
                "last_success_at": "2026-08-25T09:10:11Z",
                "object_key": "backups/finance_2026-08-25.sql.gz",
                "size": "1.2M",
            },
        )
    )
    await db.commit()
    backup = (await auth_client.get(STATUS)).json()["backup"]
    assert backup["object_key"] == "backups/finance_2026-08-25.sql.gz"
    assert backup["size"] == "1.2M"
    # Compared as instants, not strings: pydantic may re-spell the zone ('Z' vs '+00:00').
    assert datetime.fromisoformat(backup["last_success_at"]) == datetime(
        2026, 8, 25, 9, 10, 11, tzinfo=UTC
    )


async def test_system_backup_malformed_rows_read_as_none(auth_client, db):
    # Wrong keys, the accidental {"value": ...} envelope, and a non-dict: each is "no
    # backup recorded", never a 500 — the marker is written by a shell script and the
    # GET must survive whatever it managed to store.
    for value in (
        {"uploaded": "yesterday"},
        {"value": {"last_success_at": "2026-08-25T09:10:11Z", "object_key": "k", "size": "1M"}},
        ["not", "a", "dict"],
    ):
        setting = await db.get(AppSetting, "backup_status")
        if setting is None:
            db.add(AppSetting(key="backup_status", value=value))
        else:
            setting.value = value
        await db.commit()
        resp = await auth_client.get(STATUS)
        assert resp.status_code == 200, resp.text
        assert resp.json()["backup"] is None


async def test_system_environment_passes_through_prod(auth_client, monkeypatch):
    # settings is the module-level singleton and the endpoint reads it per-request, so a
    # patched attribute is what the response reports (conftest mutates the same object).
    monkeypatch.setattr(settings, "environment", "prod")
    assert (await auth_client.get(STATUS)).json()["environment"] == "prod"


async def test_system_scheduler_flag_reads_the_live_handle(auth_client, monkeypatch):
    monkeypatch.setattr("app.api.system.is_scheduler_running", lambda: True)
    assert (await auth_client.get(STATUS)).json()["prices"]["scheduler_running"] is True
```

- [ ] **Step 2: Run to verify failure** — `cd backend && .venv/Scripts/python -m pytest tests/test_system_api.py -q` → FAIL (404s on every authed call; the router does not exist).

- [ ] **Step 3: Schemas.** Create `backend/app/schemas/system.py`:

```python
"""System-status wire shapes (2026-08-25 spec §3). One rule shapes the nullables: the
GET never rejects what the database happens to hold — alembic_head is None on a
create_all-built schema (no alembic_version table), backup is None until backup_db.sh
records its first marker (or while the stored row is malformed)."""

from datetime import datetime

from pydantic import BaseModel

from app.schemas.portfolio import RefreshStatusOut


class PricesStatusOut(RefreshStatusOut):
    """The existing refresh-status shape — inherited, not restated, so the two endpoints
    cannot drift field-by-field — plus the live scheduler flag."""

    scheduler_running: bool


class DatabaseStatusOut(BaseModel):
    size_bytes: int
    # None when alembic_version is absent (every pytest run) or empty — the card renders
    # a dash, never a 500.
    alembic_head: str | None


class BackupStatusOut(BaseModel):
    last_success_at: datetime
    object_key: str
    # du -h's human string ("1.2M") exactly as the script recorded it — a label to echo
    # verbatim, not bytes to do math on (spec §3's example shape).
    size: str


class SystemStatusOut(BaseModel):
    prices: PricesStatusOut
    database: DatabaseStatusOut
    backup: BackupStatusOut | None
    # settings.environment verbatim ("dev" | "prod" in practice) — a str, not a Literal:
    # an unexpected value must pass through the status endpoint, not 500 it.
    environment: str
```

- [ ] **Step 4: Router.** Create `backend/app/api/system.py`:

```python
"""System-status vertical (2026-08-25 spec §3): one JWT-protected GET feeding the
Settings System card and the Overview attention strip. It composes the prices
refresh-status (prices.compose_refresh_status — one source of truth), the scheduler's
live flag, database facts read with raw SQL, and the backup marker backup_db.sh
upserts. Every stored shape degrades to None rather than a 500."""

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.api.prices import compose_refresh_status
from app.config import settings
from app.database import get_db
from app.models import AppSetting
from app.schemas.system import (
    BackupStatusOut,
    DatabaseStatusOut,
    PricesStatusOut,
    SystemStatusOut,
)
from app.services.scheduler import is_scheduler_running

router = APIRouter(prefix="/system", tags=["system"], dependencies=[Depends(get_current_user)])

BACKUP_STATUS_KEY = "backup_status"


async def _read_backup_status(db: AsyncSession) -> BackupStatusOut | None:
    """app_settings['backup_status'] — written by backup_db.sh via psql as a FLAT object
    (no {"value": ...} envelope: that envelope is a Python readers' convention and the
    writer here is a shell script; spec §3 spells the flat shape). Absent or malformed
    reads as "no backup recorded" (read_last_refresh's posture)."""
    setting = await db.get(AppSetting, BACKUP_STATUS_KEY)
    if setting is None or not isinstance(setting.value, dict):
        return None
    try:
        return BackupStatusOut.model_validate(setting.value)
    except ValueError:
        return None


@router.get("/status", response_model=SystemStatusOut)
async def system_status(db: AsyncSession = Depends(get_db)) -> SystemStatusOut:
    prices = await compose_refresh_status(db)
    size_bytes = (
        await db.execute(text("SELECT pg_database_size(current_database())"))
    ).scalar_one()
    # to_regclass probe, not try/except: a missing alembic_version is an EXPECTED state
    # (create_all-built databases — every test run), and a failed SELECT would abort the
    # session's transaction mid-request, poisoning the reads after it.
    has_alembic = (
        await db.execute(text("SELECT to_regclass('alembic_version') IS NOT NULL"))
    ).scalar_one()
    alembic_head: str | None = None
    if has_alembic:
        head_row = await db.execute(text("SELECT version_num FROM alembic_version"))
        alembic_head = head_row.scalars().first()
    return SystemStatusOut(
        # model_dump-and-extend, not field-by-field: if RefreshStatusOut ever grows a
        # field, the embedded copy inherits it instead of silently dropping it.
        prices=PricesStatusOut(**prices.model_dump(), scheduler_running=is_scheduler_running()),
        database=DatabaseStatusOut(size_bytes=size_bytes, alembic_head=alembic_head),
        backup=await _read_backup_status(db),
        environment=settings.environment,
    )
```

- [ ] **Step 5: Mount.** In `backend/app/main.py`: add `system,` to the `from app.api import (...)` tuple (alphabetical: between `spending` and `taxes`), and add the include after the `app_settings.router` line:

```python
app.include_router(system.router, prefix="/api/v1")
```

- [ ] **Step 6: Run** — `cd backend && .venv/Scripts/python -m pytest tests/test_system_api.py tests/test_prices_api.py -q` → ALL PASS (the old endpoint's suite rides along as the no-drift pin).

- [ ] **Step 7: Ruff** — `cd backend && .venv/Scripts/python -m ruff check app tests` → clean; `cd backend && .venv/Scripts/python -m ruff format app tests` → no reformats (or commit them).

- [ ] **Step 8: Commit** — `git add -A && git commit -m "feat(system): GET /system/status — prices+scheduler+database+backup+environment"`

### Task 4: `backup_db.sh` — record the marker (review-only; no shell harness exists)

This repo has NO shell test harness, so this change is verified by eyeball plus a bash syntax check — say so in the commit if anything surprises you. The block goes AFTER the python upload heredoc and BEFORE the `# Clean up local dump` section: `set -euo pipefail` guarantees the script has already died before this point unless pg_dump AND the upload both succeeded, which is exactly the "successful upload" gate the spec demands.

**Files:**
- Modify: `backend/scripts/backup_db.sh`

- [ ] **Step 1: Insert the marker upsert.** In `backend/scripts/backup_db.sh`, directly after the `PYEOF` line and before the `# Clean up local dump` comment, insert:

```bash
# Record the successful upload for the dashboard's System card (2026-08-25 spec §3):
# upsert app_settings['backup_status'] as a FLAT JSON object — the {"value": ...}
# envelope is a Python readers' convention, and the reader (app/api/system.py) expects
# exactly this shape. Every interpolated value is machine-generated (date -u, du -h,
# the OBJECT_KEY template above), so the single-quoted SQL literal cannot be broken by
# user text. Best-effort BY DESIGN: the backup itself already succeeded, so a marker
# failure only warns — the `|| echo` keeps `set -e` from turning bookkeeping into a
# failed backup.
BACKUP_MARKER="{\"last_success_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\", \"object_key\": \"${OBJECT_KEY}\", \"size\": \"${DUMP_SIZE}\"}"
PGPASSWORD="${POSTGRES_PASSWORD}" psql \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  -v ON_ERROR_STOP=1 \
  -q \
  -c "INSERT INTO app_settings (key, value) VALUES ('backup_status', '${BACKUP_MARKER}'::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value" \
  || echo "[$(date)] WARN: could not record backup_status in app_settings — the backup itself succeeded"
```

(`POSTGRES_PASSWORD` is safe under `set -u` here: the `pg_dump` line above already expanded it unguarded, so the script cannot reach this point without it. `ON CONFLICT (key)` targets `app_settings`' primary key.)

- [ ] **Step 2: Review pass.** Re-read the whole script top to bottom and confirm: (a) the block sits between the upload heredoc and the cleanup, (b) nothing else moved, (c) the `|| echo` is attached to the `psql` compound command so `set -e` cannot trip on a marker failure.

- [ ] **Step 3: Syntax check** — `bash -n backend/scripts/backup_db.sh` → exit code 0, no output. That is the whole automated verification available; there is no shell test to write.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat(backup): record backup_status marker in app_settings after upload"`

---

## Phase 2 — Frontend

### Task 5: Wire types + `src/api/system.ts`

Purely additive — nothing consumes these yet, so no fixture repairs in this task.

**Files:**
- Modify: `src/types/api.ts`
- Create: `src/api/system.ts`

- [ ] **Step 1: types/api.ts.** Insert directly AFTER the existing `RefreshStatus` interface (it extends it — keep them adjacent):

```ts
// GET /system/status — the Settings System card's and the Overview snapshot's feed: the
// refresh-status shape (verbatim; one composition server-side) plus scheduler, database,
// backup and environment facts. PortfolioPage keeps reading /prices/refresh-status.
export interface SystemPricesStatus extends RefreshStatus {
  scheduler_running: boolean
}

export interface SystemDatabaseStatus {
  size_bytes: number
  /** null when the alembic_version table is absent or empty (create_all-built schemas). */
  alembic_head: string | null
}

export interface BackupStatus {
  last_success_at: string
  object_key: string
  /** du -h's human string ("1.2M") exactly as backup_db.sh recorded it — not bytes. */
  size: string
}

export interface SystemStatus {
  prices: SystemPricesStatus
  database: SystemDatabaseStatus
  /** null until backup_db.sh records its first marker (or while the row is malformed). */
  backup: BackupStatus | null
  /** settings.environment verbatim — 'dev' | 'prod' in practice; never a reason to reject. */
  environment: string
}
```

- [ ] **Step 2: Client.** Create `src/api/system.ts`:

```ts
import { api } from './client'
import type { SystemStatus } from '../types/api'

// GET /system/status — the refresh-status superset (spec §3). Overview swapped its
// /prices/refresh-status fetch for this; PortfolioPage still uses the old endpoint.
export function fetchSystemStatus(): Promise<SystemStatus> {
  return api<SystemStatus>('/system/status')
}
```

- [ ] **Step 3: Verify** — `npx tsc -b` → clean.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat(system): SystemStatus wire types + fetchSystemStatus client"`

### Task 6: Shared clocks — `backupAge` + `formatBytes`

**Files:**
- Modify: `src/utils/staleness.ts`, `src/utils/format.ts`
- Test: `src/utils/staleness.test.ts`, `src/utils/format.test.ts`

- [ ] **Step 1: Write the failing tests.** Append to `src/utils/staleness.test.ts` (extend its import line to `import { STALE_AFTER_DAYS, backupAge, isStaleQuote } from './staleness'`):

```ts
describe('backupAge', () => {
  // The Overview strip evaluates at the injected today's MIDNIGHT UTC (attention.ts)
  // and the Settings card at the real clock — both call THIS function, so the amber
  // tone and the "hasn't run recently" nag flip at the same hour by construction.
  const now = new Date('2026-08-18T00:00:00Z')

  it('reads fresh through the 48th hour exactly', () => {
    expect(backupAge('2026-08-17T00:00:00Z', now)).toBe('fresh')
    // Exactly 48h: "older than 48h" is strict, so the boundary itself is still fresh.
    expect(backupAge('2026-08-16T00:00:00Z', now)).toBe('fresh')
  })

  it('turns stale past 48 hours and holds through the seventh day', () => {
    expect(backupAge('2026-08-15T23:59:00Z', now)).toBe('stale')
    expect(backupAge('2026-08-11T00:00:00Z', now)).toBe('stale') // exactly 7 days
  })

  it('reads overdue past seven days — the red-wording register', () => {
    expect(backupAge('2026-08-10T23:59:59Z', now)).toBe('overdue')
  })

  it('treats an unparseable stamp as overdue — the nag errs toward nagging', () => {
    expect(backupAge('not a timestamp', now)).toBe('overdue')
  })
})
```

Append to `src/utils/format.test.ts` (extend its import from `./format` with `formatBytes`):

```ts
describe('formatBytes', () => {
  it('walks the units at base 1024 with one decimal past bytes', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(123_456_789)).toBe('117.7 MB')
    expect(formatBytes(5 * 1024 ** 3)).toBe('5.0 GB')
  })

  it('answers a dash for the unrenderable', () => {
    expect(formatBytes(-1)).toBe('—')
    expect(formatBytes(Number.NaN)).toBe('—')
  })
})
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/utils/staleness.test.ts src/utils/format.test.ts` → FAIL (no exported `backupAge` / `formatBytes`).

- [ ] **Step 3: Implement.** Append to `src/utils/staleness.ts`:

```ts
// Nightly-backup staleness — ONE copy for the Settings System card (amber tone, red
// wording) and the Overview attention strip's prod-only nag, so both flip at the same
// hour. Unlike quote bars these are full INSTANTS (backup_db.sh stamps UTC to the
// second), so instant math is the honest comparison — no date-only slicing here.
export const BACKUP_STALE_HOURS = 48
export const BACKUP_OVERDUE_DAYS = 7

export type BackupAge = 'fresh' | 'stale' | 'overdue'

export function backupAge(lastSuccessAt: string, now: Date = new Date()): BackupAge {
  const age = now.getTime() - Date.parse(lastSuccessAt)
  // NaN (an unparseable stamp) fails BOTH > checks and would read fresh by fall-through,
  // so it is called out explicitly: a marker we cannot read must nag, not reassure.
  if (Number.isNaN(age) || age > BACKUP_OVERDUE_DAYS * 86_400_000) return 'overdue'
  if (age > BACKUP_STALE_HOURS * 3_600_000) return 'stale'
  return 'fresh'
}
```

Append to `src/utils/format.ts`:

```ts
export function formatBytes(bytes: number): string {
  // pg_database_size is exact bytes; the card wants a human size. Base 1024 with one
  // decimal past B — the register `du -h` speaks, which the backup row quotes verbatim.
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  let value = bytes
  let unit = 'B'
  for (const next of ['KB', 'MB', 'GB', 'TB']) {
    if (value < 1024) break
    value /= 1024
    unit = next
  }
  return `${value.toFixed(1)} ${unit}`
}
```

- [ ] **Step 4: Run** — `npx vitest run src/utils/staleness.test.ts src/utils/format.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(system): backupAge staleness clock + formatBytes"`

### Task 7: The Settings System card

**Files:**
- Create: `src/components/settings/SystemCard.tsx`, `src/components/settings/SystemCard.test.tsx`
- Modify: `src/components/settings/settings.css`, `src/pages/SettingsPage.tsx`, `src/pages/SettingsPage.test.tsx`

- [ ] **Step 1: Write the failing tests** — create `src/components/settings/SystemCard.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import type { LastRefresh, SystemStatus } from '../../types/api'
import { formatDateTime } from '../../utils/format'
import SystemCard from './SystemCard'

vi.mock('../../api/system', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/system')>()),
  fetchSystemStatus: vi.fn(),
}))
import { fetchSystemStatus } from '../../api/system'

const LAST_RUN: LastRefresh = {
  at: '2026-08-24T20:11:00+00:00',
  trigger: 'scheduled',
  updated: 36,
  failed: {},
  skipped_manual: 1,
  history_appended: true,
  dividends_ingested: 0,
  dividends_removed: 0,
  dividends_skipped_overlap: 0,
}

// Backup ages are wall-clock relative (backupAge defaults to `new Date()`), so the
// fixtures are computed from the run's own now — a hard-coded stamp would go amber two
// days after it was written and take this file down with it (OverviewPage.test's rule).
function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString()
}

function backupOut(hoursBack: number) {
  return {
    last_success_at: hoursAgo(hoursBack),
    object_key: 'backups/finance_2026-08-25.sql.gz',
    size: '1.2M',
  }
}

function systemOut(over: Partial<SystemStatus> = {}): SystemStatus {
  return {
    prices: { last: LAST_RUN, next_run_at: '2026-08-25T20:10:00+00:00', scheduler_running: true },
    database: { size_bytes: 123_456_789, alembic_head: 'e7c5a9f4b2d8' },
    backup: backupOut(10),
    environment: 'prod',
    ...over,
  }
}

beforeEach(() => {
  vi.mocked(fetchSystemStatus).mockResolvedValue(systemOut())
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

it('renders the healthy rows verbatim', async () => {
  const backup = backupOut(10)
  vi.mocked(fetchSystemStatus).mockResolvedValue(systemOut({ backup }))
  render(<SystemCard />)
  // The refresh line wears PortfolioPage's refresh-status-line vocabulary — the two
  // surfaces describe the same stored run and must read the same.
  await screen.findByText(`${formatDateTime(LAST_RUN.at)} (scheduled) · 36 updated`)
  expect(screen.getByText(formatDateTime('2026-08-25T20:10:00+00:00'))).toBeDefined()
  expect(screen.getByText('Running')).toBeDefined()
  const stamp = screen.getByText(`${formatDateTime(backup.last_success_at)} (1.2M)`)
  expect(stamp.className).toBe('')
  expect(screen.getByText('117.7 MB')).toBeDefined()
  expect(screen.getByText('e7c5a9f4b2d8')).toBeDefined()
  expect(screen.getByText('prod')).toBeDefined()
})

it('appends the failed count to the refresh line only when nonzero', async () => {
  vi.mocked(fetchSystemStatus).mockResolvedValue(
    systemOut({
      prices: {
        last: { ...LAST_RUN, failed: { ZI: 'delisted' } },
        next_run_at: null,
        scheduler_running: true,
      },
    }),
  )
  render(<SystemCard />)
  await screen.findByText(`${formatDateTime(LAST_RUN.at)} (scheduled) · 36 updated · 1 failed`)
})

it('tones the backup amber past 48 hours, wording unchanged', async () => {
  const backup = backupOut(72)
  vi.mocked(fetchSystemStatus).mockResolvedValue(systemOut({ backup }))
  render(<SystemCard />)
  const stamp = await screen.findByText(`${formatDateTime(backup.last_success_at)} (1.2M)`)
  expect(stamp.className).toBe('system-stale')
})

it('changes the WORDING past seven days, not colour alone', async () => {
  const backup = backupOut(8 * 24)
  vi.mocked(fetchSystemStatus).mockResolvedValue(systemOut({ backup }))
  render(<SystemCard />)
  const stamp = await screen.findByText(
    `${formatDateTime(backup.last_success_at)} (1.2M) — more than a week old`,
  )
  expect(stamp.className).toBe('system-overdue')
})

it('renders the quiet states: no run, no schedule, no backup, no alembic table', async () => {
  vi.mocked(fetchSystemStatus).mockResolvedValue(
    systemOut({
      prices: { last: null, next_run_at: null, scheduler_running: false },
      database: { size_bytes: 1024, alembic_head: null },
      backup: null,
      environment: 'dev',
    }),
  )
  render(<SystemCard />)
  await screen.findByText('No refresh recorded yet')
  expect(screen.getByText('Not scheduled')).toBeDefined()
  expect(screen.getByText('Not running')).toBeDefined()
  expect(screen.getByText('No backup recorded')).toBeDefined()
  expect(screen.getByText('1.0 KB')).toBeDefined()
  expect(screen.getByText('—')).toBeDefined()
  expect(screen.getByText('dev')).toBeDefined()
})

it('shows the load failure verbatim and retries into the rows', async () => {
  vi.mocked(fetchSystemStatus).mockRejectedValueOnce(new ApiError('status unavailable', 500))
  render(<SystemCard />)
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain('status unavailable')
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await screen.findByText('Running')
  expect(screen.queryByRole('alert')).toBeNull()
})
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/components/settings/SystemCard.test.tsx` → FAIL (module not found).

- [ ] **Step 3: Implement the card** — create `src/components/settings/SystemCard.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../api/client'
import { fetchSystemStatus } from '../../api/system'
import type { SystemStatus } from '../../types/api'
import { formatBytes, formatDateTime } from '../../utils/format'
import { backupAge } from '../../utils/staleness'
import InfoHint from '../InfoHint'
import '../panels.css'
import './settings.css'

// Module scope like SettingsPage's boxesFor: pure derivations off the payload, so the
// component's load chain stays a plain function with no reactive dependencies.

function refreshLine(status: SystemStatus): string {
  const last = status.prices.last
  if (last === null) return 'No refresh recorded yet'
  const failedCount = Object.keys(last.failed).length
  // PortfolioPage's refresh-status-line vocabulary — same stored run, same sentence.
  return `${formatDateTime(last.at)} (${last.trigger}) · ${last.updated} updated${
    failedCount > 0 ? ` · ${failedCount} failed` : ''
  }`
}

function backupLine(status: SystemStatus): { text: string; className: string } {
  if (status.backup === null) {
    // The permanent, unremarkable state on a dev box — said plainly. The prod-only
    // nagging lives on the Overview strip (attention.ts), never here.
    return { text: 'No backup recorded', className: '' }
  }
  const stamp = `${formatDateTime(status.backup.last_success_at)} (${status.backup.size})`
  const age = backupAge(status.backup.last_success_at)
  if (age === 'overdue') {
    // Past seven days the WORDING changes too (spec §3) — colour is never the only channel.
    return { text: `${stamp} — more than a week old`, className: 'system-overdue' }
  }
  return { text: stamp, className: age === 'stale' ? 'system-stale' : '' }
}

function SystemFacts({ status }: { status: SystemStatus }) {
  const backup = backupLine(status)
  return (
    <dl className="system-facts">
      <div className="system-fact">
        <dt>Last price refresh</dt>
        <dd>{refreshLine(status)}</dd>
      </div>
      <div className="system-fact">
        <dt>Next scheduled run</dt>
        <dd>
          {status.prices.next_run_at ? formatDateTime(status.prices.next_run_at) : 'Not scheduled'}
        </dd>
      </div>
      <div className="system-fact">
        <dt>Scheduler</dt>
        <dd>{status.prices.scheduler_running ? 'Running' : 'Not running'}</dd>
      </div>
      <div className="system-fact">
        <dt>Last backup</dt>
        <dd className={backup.className}>{backup.text}</dd>
      </div>
      <div className="system-fact">
        <dt>Database size</dt>
        <dd>{formatBytes(status.database.size_bytes)}</dd>
      </div>
      <div className="system-fact">
        <dt>Alembic head</dt>
        <dd className="system-mono">{status.database.alembic_head ?? '—'}</dd>
      </div>
      <div className="system-fact">
        <dt>Environment</dt>
        <dd className="system-mono">{status.environment}</dd>
      </div>
    </dl>
  )
}

/**
 * The Settings System card (2026-08-25 spec §3): read-only operational facts — the last
 * refresh run and its schedule, the nightly-backup marker, database size and migration
 * head. Its own fetch and error state (the Up-next posture): a status hiccup must not
 * dent the settings forms, nor the reverse.
 */
export default function SystemCard() {
  const [status, setStatus] = useState<SystemStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const seqRef = useRef(0)

  const load = () => {
    const seq = ++seqRef.current
    fetchSystemStatus()
      .then((s) => {
        if (seq !== seqRef.current) return
        setStatus(s)
        setError(null)
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        setError(err instanceof ApiError ? err.message : 'Could not load system status.')
      })
      .finally(() => {
        if (seq === seqRef.current) setLoading(false)
      })
  }

  useEffect(() => {
    load()
    // mount-only: a plain function over stable setters (house idiom)
  }, [])

  return (
    <section className="card span-12">
      <h2 className="eyebrow">
        System
        <InfoHint text="Operational status: the last price refresh and its schedule, the nightly backup marker recorded by the backup script, and the database's size and migration head." />
      </h2>
      {error && (
        <div className="error-banner" role="alert">
          {error}{' '}
          <button
            className="button"
            onClick={() => {
              setLoading(true)
              load()
            }}
          >
            Retry
          </button>
        </div>
      )}
      {status === null
        ? loading && <p className="empty-note">Loading…</p>
        : !error && <SystemFacts status={status} />}
    </section>
  )
}
```

(A failed RELOAD keeps the previous facts hidden behind the banner rather than beside it — `!error &&` — because unlike Overview's charts these rows claim to be "now", and a stale "Running" next to a failure banner is a lie about the present.)

- [ ] **Step 4: CSS.** Append to `src/components/settings/settings.css`:

```css
/* --- system card --- */

/* Label/value rows for the System card's operational facts — sentences to scan down,
   not tiles to compare, so a single-column dl, not the kpi grid. */
.system-facts {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.system-fact {
  display: grid;
  grid-template-columns: minmax(140px, 200px) 1fr;
  gap: 0.75rem;
  align-items: baseline;
}

.system-fact dt {
  font-size: 0.72rem;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--muted);
}

.system-fact dd {
  margin: 0;
  font-size: 0.85rem;
  color: var(--text);
}

/* PALETTE[3] amber, written as a literal exactly as OverviewPage.css and portfolio.css
   do: src/charts is frozen and CSS cannot import a TS token. The backup row past 48h. */
.system-fact dd.system-stale {
  color: #c98500;
}

/* Past seven days the wording changes too ("more than a week old") — the colour is
   never the only channel. */
.system-fact dd.system-overdue {
  color: var(--negative);
}

.system-fact dd.system-mono {
  font-family: ui-monospace, 'Cascadia Mono', 'Segoe UI Mono', Menlo, Consolas, monospace;
  font-size: 0.8rem;
}

@media (max-width: 720px) {
  .system-fact {
    grid-template-columns: 1fr;
    gap: 0.15rem;
  }
}
```

- [ ] **Step 5: Run** — `npx vitest run src/components/settings/SystemCard.test.tsx` → PASS.

- [ ] **Step 6: Mount on SettingsPage.** In `src/pages/SettingsPage.tsx` (re-read it first): add `import SystemCard from '../components/settings/SystemCard'` directly after the `ImportReportView` import, and insert `<SystemCard />` inside the `card-grid` div, after the Password `</section>` and before the grid's closing `</div>`:

```tsx
          {/* Read-only status, its own fetch/error (SystemCard) — it shares the forms'
              loadedOnce gate like the import card: a settings GET that failed means the
              API is unreachable, and this card could only echo that. */}
          <SystemCard />
```

- [ ] **Step 7: Arm the page test.** In `src/pages/SettingsPage.test.tsx` (re-read it first):
  1. Update the mock-block header comment "Three api modules, all stubbed." → "Four api modules, all stubbed." and add below the importer mock:
```tsx
vi.mock('../api/system', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/system')>()),
  fetchSystemStatus: vi.fn(),
}))
```
  2. Add `import { fetchSystemStatus } from '../api/system'` beside the other post-mock imports, and `import type { SystemStatus } from '../types/api'` into the existing type import.
  3. In the file's top-level `beforeEach` (the one arming `fetchAppSettings`), add:
```tsx
  vi.mocked(fetchSystemStatus).mockResolvedValue(SYSTEM)
```
  with this fixture beside `SETTINGS`:
```tsx
// Quiet system payload — the card's rendering details are pinned in SystemCard.test.tsx;
// this file only needs the fetch answered so the card settles.
const SYSTEM: SystemStatus = {
  prices: { last: null, next_run_at: null, scheduler_running: false },
  database: { size_bytes: 1024, alembic_head: null },
  backup: null,
  environment: 'dev',
}
```
  4. Append one presence test at the end of the file:
```tsx
describe('SettingsPage — system card', () => {
  it('mounts the System card alongside the forms', async () => {
    render(<SettingsPage />)
    await screen.findByText('No refresh recorded yet')
    expect(screen.getByText('No backup recorded')).toBeDefined()
  })
})
```

- [ ] **Step 8: Run** — `npx vitest run src/pages/SettingsPage.test.tsx` → ALL PASS (every pre-existing test must survive the new card; if any trips on ambiguous text queries, the new card's copy above deliberately shares no strings with the forms).

- [ ] **Step 9: Commit** — `git add -A && git commit -m "feat(system): Settings System card — refresh/scheduler/backup/database rows"`

### Task 8: Attention backup item + Overview switches to `/system/status`

`AttentionInputs` changes shape, so `attention.ts`, its tests, `OverviewPage.tsx` and `OverviewPage.test.tsx` land in ONE task — the tree stays compiling. Re-read `attention.ts` and `OverviewPage.tsx` immediately before editing (wave-1 shifted lines); apply the edits semantically.

**Files:**
- Modify: `src/components/overview/attention.ts`, `src/components/overview/attention.test.ts`, `src/pages/OverviewPage.tsx`, `src/pages/OverviewPage.test.tsx`

- [ ] **Step 1: Write the failing attention tests.** In `src/components/overview/attention.test.ts`:
  1. Extend the type import with `BackupStatus,` and `SystemStatus,` (alphabetical; keep `LastRefresh` — `lastRefreshOut` still builds it).
  2. Add fixtures after `lastRefreshOut`:
```ts
function pricesOut(last: LastRefresh | null = lastRefreshOut()): SystemStatus['prices'] {
  return { last, next_run_at: null, scheduler_running: false }
}

function backupOut(lastSuccessAt: string): BackupStatus {
  return {
    last_success_at: lastSuccessAt,
    object_key: 'backups/finance_2026-08-16.sql.gz',
    size: '1.2M',
  }
}

// environment 'dev' in the baseline: the backup nag is PROD-only (spec §3), so dev is
// the quiet default — exactly what the real dev box is.
function systemOut(over: Partial<SystemStatus> = {}): SystemStatus {
  return {
    prices: pricesOut(),
    database: { size_bytes: 123_456_789, alembic_head: 'e7c5a9f4b2d8' },
    backup: null,
    environment: 'dev',
    ...over,
  }
}
```
  3. In `inputs()`, replace `lastRefresh: lastRefreshOut(),` with `system: systemOut(),`.
  4. In the "the last refresh run" describe, rewrite the two overrides:
```ts
    expect(keys(inputs({ system: systemOut({ prices: pricesOut(null) }) }))).toEqual([])
    expect(keys(inputs({ system: systemOut() }))).toEqual([])
```
  and in the failed-tickers test wrap both payloads the same way, e.g.
```ts
    const [one] = attentionItems(
      inputs({ system: systemOut({ prices: pricesOut(lastRefreshOut({ ZI: 'delisted' })) }) }),
      TODAY,
    )
```
  (and the five-ticker case identically, with `{ A: 'x', B: 'x', C: 'x', D: 'x', E: 'x' }`).
  5. Append the new describe (before the ordering one):
```ts
describe('attentionItems — the nightly backup (prod only)', () => {
  // TODAY's midnight UTC is the strip's clock (the prices-stale pattern): 2026-08-18
  // 00:00Z, so exactly-48h-ago is 2026-08-16T00:00:00Z.
  const prod = (backup: BackupStatus | null) =>
    inputs({ system: systemOut({ environment: 'prod', backup }) })

  it('nags when prod has no marker at all', () => {
    const [item] = attentionItems(prod(null), TODAY)
    expect(item.key).toBe('backup-stale')
    expect(item.text).toBe("Nightly backup hasn't run recently")
    expect(item.to).toBe('/settings')
  })

  it('nags past 48 hours and stays quiet through the 48th exactly', () => {
    expect(keys(prod(backupOut('2026-08-15T23:00:00Z')))).toEqual(['backup-stale'])
    expect(keys(prod(backupOut('2026-08-16T00:00:00Z')))).toEqual([])
    expect(keys(prod(backupOut('2026-08-17T09:00:00Z')))).toEqual([])
  })

  it('is suppressed off prod — dev boxes never back up and must not nag', () => {
    expect(keys(inputs({ system: systemOut({ backup: null }) }))).toEqual([])
    expect(
      keys(inputs({ system: systemOut({ backup: backupOut('2026-08-01T00:00:00Z') }) })),
    ).toEqual([])
  })
})
```
  6. In the ordering test, replace `lastRefresh: lastRefreshOut({ ZI: 'delisted' }),` with
```ts
      system: systemOut({
        prices: pricesOut(lastRefreshOut({ ZI: 'delisted' })),
        environment: 'prod', // backup stays null -> the nag joins the parade
      }),
```
  and insert `'backup-stale',` into the expected keys array between `'refresh-failed'` and `'espp-qualifying'`.

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/components/overview/attention.test.ts` → FAIL (TS: `system` is not a known property; `lastRefresh` missing).

- [ ] **Step 3: Implement attention.ts.** In `src/components/overview/attention.ts`:
  1. Type imports become:
```ts
import type {
  EsppLotsResponse,
  HoldingsResponse,
  SystemStatus,
  TaxYearOut,
} from '../../types/api'
```
  (drop `LastRefresh` — nothing here names it any more) and extend the staleness import to `import { backupAge, isStaleQuote } from '../../utils/staleness'`.
  2. In `AttentionInputs`, replace the `lastRefresh` field (and its doc comment) with:
```ts
  /** GET /system/status — the last refresh outcome, backup marker and environment. */
  system: SystemStatus
```
  3. Replace the `failedTickers` line with:
```ts
  const failedTickers =
    data.system.prices.last === null ? [] : Object.keys(data.system.prices.last.failed)
```
  4. Insert the new item AFTER the `refresh-failed` push and BEFORE the ESPP block:
```ts
  // Nightly backup — PROD only (spec §3): dev boxes never back up and must not nag.
  // "Missing or older than 48h" shares backupAge with the Settings card's amber tone,
  // evaluated at today's midnight UTC exactly as prices-stale above.
  if (data.system.environment === 'prod') {
    const { backup } = data.system
    if (
      backup === null ||
      backupAge(backup.last_success_at, new Date(`${todayIso}T00:00:00Z`)) !== 'fresh'
    ) {
      items.push({
        key: 'backup-stale',
        text: "Nightly backup hasn't run recently",
        to: '/settings',
      })
    }
  }
```

- [ ] **Step 4: Run** — `npx vitest run src/components/overview/attention.test.ts` → PASS. (`npx tsc -b` still fails on OverviewPage — that is Steps 5–6's job, in this same task.)

- [ ] **Step 5: OverviewPage.tsx swap.** Re-read the file, then apply five semantic edits:
  1. Replace `import { fetchRefreshStatus } from '../api/prices'` with `import { fetchSystemStatus } from '../api/system'` (keep the api-import block's alphabetical order: `../api/spending`, `../api/system`, `../api/taxes`).
  2. In the type import block, replace `RefreshStatus,` with `SystemStatus,` (alphabetical: after `SpendingYearly`).
  3. In `OverviewData`, replace `refresh: RefreshStatus` with `system: SystemStatus`, and amend the block comment's "the last refresh run" clause to "the system status — last refresh run, backup marker, environment".
  4. In `load()`: `fetchRefreshStatus(),` → `fetchSystemStatus(),`; rename `refresh` → `system` in BOTH the destructuring array and the `setData({...})` object.
  5. In the `attention` const, replace `lastRefresh: data.refresh.last,` with `system: data.system,`.

- [ ] **Step 6: OverviewPage.test.tsx repairs.** Re-read the file, then:
  1. Delete the `vi.mock('../api/prices', ...)` block and the `import { fetchRefreshStatus } from '../api/prices'` line; add in their places:
```tsx
vi.mock('../api/system', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/system')>()),
  fetchSystemStatus: vi.fn(),
}))
```
  and `import { fetchSystemStatus } from '../api/system'`.
  2. Type import: `RefreshStatus,` → `SystemStatus,`.
  3. Add the fixture after `lotsOut`:
```tsx
// Strip-quiet system default: environment 'dev' suppresses the backup nag (its logic is
// pinned in attention.test.ts, where today is injectable) and no refresh is recorded —
// the same quiet the old { last: null, next_run_at: null } fixture bought.
function systemOut(over: Partial<SystemStatus> = {}): SystemStatus {
  return {
    prices: { last: null, next_run_at: null, scheduler_running: false },
    database: { size_bytes: 123_456_789, alembic_head: 'e7c5a9f4b2d8' },
    backup: null,
    environment: 'dev',
    ...over,
  }
}
```
  4. In `Payload`: `refresh: RefreshStatus` → `system: SystemStatus`. In `serve()`: `refresh: { last: null, next_run_at: null },` → `system: systemOut(),` and `vi.mocked(fetchRefreshStatus).mockResolvedValue(payload.refresh)` → `vi.mocked(fetchSystemStatus).mockResolvedValue(payload.system)`. In `failAll()`: swap the same client. In BOTH eleven-client `toHaveBeenCalledTimes(2)` loops: `fetchRefreshStatus` → `fetchSystemStatus`.
  5. Extend the strip integration test ("surfaces the overdue ritual, the ESPP countdown and the empty tax year…"): add `system: systemOut({ environment: 'prod' }),` to its `serve({...})` override (backup stays null → the nag fires on a real clock, no date math needed), and after the taxes assertion add:
```tsx
    expect(
      screen
        .getByRole('link', { name: /Nightly backup hasn't run recently/ })
        .getAttribute('href'),
    ).toBe('/settings')
```
  then update the closing count assertion and its comment from three to four:
```tsx
    // Exactly the four conditions above — nothing else invented itself an item.
    expect(strip.querySelectorAll('a')).toHaveLength(4)
```

- [ ] **Step 7: Run** — `npx vitest run src/components/overview/attention.test.ts src/pages/OverviewPage.test.tsx` → ALL PASS; `npx tsc -b` → clean (proves no other file still names `data.refresh` or the old input field).

- [ ] **Step 8: Commit** — `git add -A && git commit -m "feat(system): overview reads /system/status; backup attention item, prod-only"`

---

## Phase 3 — Verification

### Task 9: Full verification (STOP here — the orchestrator merges)

**Files:** none

- [ ] **Step 1: Full backend suite** — `cd backend && .venv/Scripts/python -m pytest -q` → ALL PASS (record the count; ~853 before this plan, +8 here).
- [ ] **Step 2: Ruff** — `cd backend && .venv/Scripts/python -m ruff check app tests` → clean; `cd backend && .venv/Scripts/python -m ruff format app tests` → if anything reformats, re-run the touched test files and commit the reflow.
- [ ] **Step 3: Bash syntax re-check** — `bash -n backend/scripts/backup_db.sh` → exit 0 (belt-and-braces after any late edits; still the only shell verification that exists).
- [ ] **Step 4: Full frontend** — `npx vitest run` → ALL PASS (record the count; ~791 before this plan); `npx tsc -b` → clean; `npx eslint .` → clean.
- [ ] **Step 5: Commit anything outstanding** — `git add -A && git commit -m "chore(system): verification pass"` (skip if `git status --porcelain` is already EMPTY — it should be).
- [ ] **Step 6: STOP.** Do not merge, do not push, do not delete anything, and do NOT edit the five-feature spec's status line (four of its features are still open). Leave a summary listing: both test counts; that `/prices/refresh-status` is byte-identical (Task 3's equality pin) and PortfolioPage still reads it; that the backup marker write is best-effort and review-only-verified (`bash -n`); that the attention nag is prod-suppressed by `environment !== 'prod'`; and that `alembic_head` is legitimately `null` on test/dev databases built by `create_all`.
