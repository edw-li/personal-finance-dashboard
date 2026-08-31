# Tier 1 Plan B: Data Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Workstream B of the 2026-08-31 tier-1 spec (`docs/superpowers/specs/2026-08-31-tier1-trust-lifecycle-tax-planning-design.md`, §B1–B3): **B1** a full-data export — one auth-gated `GET /api/v1/export/snapshot` streaming a ZIP (per-table CSVs + `manifest.json` + nested `finance-export.json`) over a hand-maintained 34-table list pinned against `Base.metadata`, plus a "Download snapshot (.zip)" button on the Settings System card; **B2** month deletion — `DELETE /api/v1/net-worth/months/{month}` and `DELETE /api/v1/spending/months/{month}` (204/404, PUT-identical month validation) plus a typed-month arm-and-confirm on the wizard's Review step that calls both, tolerates each leg's own 404, clears the month's sessionStorage draft, toasts, and lands on the current month; **B3** backup hardening — optional gpg encryption in `backup_db.sh` (`BACKUP_PASSPHRASE`), last-10 run trails in `app_settings['backup_runs']` / `app_settings['refresh_runs']`, both surfaced on `GET /system/status` and the System card, plus the README fixes (Part 5 passphrase + `.gpg` restore, §4.2's stale restart claim). **"Run backup now" is deliberately out of scope** (spec §B3: the backend container has no pg_dump; the B1 snapshot download is the on-demand backup).

**Architecture:**
- **Export is an explicit list, not reflection.** `backend/app/api/export.py` iterates `EXPORTED_TABLES: tuple[(model, table_name), ...]` — 34 pairs in the spec's order. A test pins `{exported} | {excluded} == set(Base.metadata.tables)`, so any future table fails the suite until someone consciously lists or excludes it. `users` is the one named exclusion (password hash; single-user app); `alembic_version` is not a metadata table — the manifest carries the head via the system router's exact `to_regclass` probe. The ZIP is built in a `BytesIO` (`zipfile`, deflate; DB is ~12.5 MB) and returned as a `StreamingResponse` with `Content-Disposition: attachment; filename="finance-export-YYYYMMDD-HHMM.zip"`. One serialization rule per medium: CSV — NULL = empty cell, Decimal = plain string (`format(v, "f")`), dates/datetimes ISO, booleans lowercase `true`/`false`, JSONB = compact JSON, columns in model-definition order, rows ordered by primary key; JSON — same spellings but None/bool/int/str/dict stay native.
- **Month deletes mirror the PUT paths.** Same `month: date` path param, same `require_first_of_month` 422, same `Response(status_code=204)` idiom as `delete_account`/`delete_category_budget`. Net-worth deletes the snapshot row and lets the FK's `ON DELETE CASCADE` take the balances (present in `create_all` schemas too — the FK is declared on the model). Spending deletes every `monthly_spending` row AND the `monthly_cashflow` row, 404 only when *neither* exists, so a cashflow-only month still clears. The stale "no delete exists" comment in `net_worth.py` is corrected — the refusal to *create* an empty month stays.
- **Run trails follow each writer's own convention.** `backup_runs` is a **flat jsonb array** (shell writer — the exact posture of `backup_status`), appended-and-trimmed to 10 (newest first) by the script's own `INSERT ... ON CONFLICT` using `jsonb_path_query_array(..., '$[0 to 9]')`. `refresh_runs` is **enveloped** `{"value": [...]}` (Python writer — `record_refresh_run`'s existing convention), trimmed in Python. `GET /system/status` reads both with the router's degrade posture: any malformed stored shape reads as `[]`, never a 500. The frontend types take both as optional (`?: []` stale-deploy armor, the `LastRefresh` precedent), and the System card renders a compact last-5 line per trail.
- **Execution order is A → C → B → D.** Plan A has already edited `src/pages/MonthlyUpdatePage.tsx` (A1 liability cue in the balances step, A8 two-leg save tracking) before this plan runs. Every `MonthlyUpdatePage.tsx` line anchor below is from the pre-A file and is marked **verify-at-implementation**: re-locate by the quoted landmark code, not the line number.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 async + PostgreSQL 16 + pytest (`asyncio_mode=auto`, `Base.metadata.create_all` test schema, `auth_client`/`db` fixtures) + ruff 100-col (`E,F,I,UP,B,ASYNC`); React 19 + TS + Vite + vitest/@testing-library (jsdom) + eslint; bash + psql + gpg + boto3 for the backup script. No Alembic migration anywhere in this plan (spec: only Workstream C migrates).

## Conventions for every task

- Branch: `tier1-batch` (already exists; A and C are merged onto it before this plan starts). Verify with `git branch --show-current` → `tier1-batch`.
- Backend commands run from the repo root in **Git Bash**:
  - single file: `cd backend && .venv/Scripts/python.exe -m pytest tests/test_export_api.py -q`
  - full suite: `cd backend && .venv/Scripts/python.exe -m pytest -q`
  - lint+format: `cd backend && .venv/Scripts/python.exe -m ruff check app tests && .venv/Scripts/python.exe -m ruff format app tests`
    (`ruff format` may rewrap a line this plan wrote — if it reports anything other than `N files left unchanged`, re-run the task's tests once more before committing.)
- Frontend commands run from the repo root:
  - single file: `npx vitest run src/components/settings/SystemCard.test.tsx`
  - full suite: `npm test`
  - lint: `npm run lint`
- Gating commands run **bare — no pipes, no `| tail`** (a pipe hides the exit code). "N passed" counts below are indicative; what gates is **zero failures, zero errors**.
- Tests first in every task (superpowers:test-driven-development): write the failing test, watch it fail for the right reason, then implement.
- Commit after each task with the conventional message given in the task. **Never push.**

---

### Task 0: Baseline

**Files:** none (read-only verification).

- [ ] `git branch --show-current` → `tier1-batch`. `git status` → clean. If A/C left the tree dirty, stop and report.
- [ ] Record the baseline counts (A and C have already moved them past the spec-time numbers):
  `cd backend && .venv/Scripts/python.exe -m pytest -q`
  Expected: `N passed` with zero failures — record N.
- [ ] `npm test`
  Expected: all files pass — record the test count.
- [ ] Confirm the wizard file after Plan A: open `src/pages/MonthlyUpdatePage.tsx` and locate (a) `const DRAFT_PREFIX = 'finance-update-draft:'` + `function draftKey(month: string)` (pre-A ~:70-74), (b) `const [monthExisted, setMonthExisted] = useState(false)` (pre-A ~:133), (c) the Review card `{!loading && step === 'review' && (` (pre-A ~:991) with its `wizard-footer` div. All three landmarks must exist; note their current line numbers for Task 5.
- [ ] No commit.

---

### Task 1: B1 backend — export router + metadata-pinning test

**Files:**
- `backend/app/api/export.py` (new)
- `backend/app/main.py` (import block :10-29 — add `export` after `espp`; include block :79-96 — add after the `system` include at :95)
- `backend/tests/test_export_api.py` (new)

- [ ] Write the failing test file `backend/tests/test_export_api.py` (complete file):

```python
"""Export vertical (2026-08-31 tier-1 spec §B1): the ZIP's exact shape, the per-type
serialization spellings, and the pin that makes a NEW table fail the suite until it is
consciously listed in EXPORTED_TABLES or named in EXCLUDED_TABLES."""

import io
import json
import re
import zipfile
from datetime import date
from decimal import Decimal

from app.api.export import EXCLUDED_TABLES, EXPORTED_TABLES
from app.database import Base
from app.models import Account, AccountBalance, AppSetting, NetWorthSnapshot

EXPORT = "/api/v1/export/snapshot"


def test_export_list_pins_every_metadata_table():
    exported_names = [table for _, table in EXPORTED_TABLES]
    assert len(exported_names) == len(set(exported_names)), "duplicate table in EXPORTED_TABLES"
    for model, table_name in EXPORTED_TABLES:
        assert model.__tablename__ == table_name, f"{model.__name__} is not {table_name!r}"
    assert set(exported_names) & EXCLUDED_TABLES == set()
    # THE PIN: every Base.metadata table is either exported or a NAMED exclusion. A new
    # model lands here red until someone decides which — that decision is the feature.
    # (alembic_version is not a metadata table; the manifest carries the head instead.)
    assert set(exported_names) | EXCLUDED_TABLES == set(Base.metadata.tables)


async def test_export_requires_auth(client):
    assert (await client.get(EXPORT)).status_code == 401


async def test_export_zip_carries_manifest_every_csv_and_the_json(auth_client):
    resp = await auth_client.get(EXPORT)
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"] == "application/zip"
    assert re.fullmatch(
        r'attachment; filename="finance-export-\d{8}-\d{4}\.zip"',
        resp.headers["content-disposition"],
    ), resp.headers["content-disposition"]
    archive = zipfile.ZipFile(io.BytesIO(resp.content))
    names = set(archive.namelist())
    assert "manifest.json" in names
    assert "finance-export.json" in names
    for _, table_name in EXPORTED_TABLES:
        assert f"csv/{table_name}.csv" in names
    assert len(names) == len(EXPORTED_TABLES) + 2  # nothing extra rides along
    manifest = json.loads(archive.read("manifest.json"))
    assert manifest["environment"] == "dev"
    assert manifest["alembic_head"] is None  # create_all-built test schema (system.py's rule)
    # Row counts cover every listed table — all zero on a database holding only the user.
    assert manifest["tables"] == {table: 0 for _, table in EXPORTED_TABLES}
    nested = json.loads(archive.read("finance-export.json"))
    assert nested["tables"] == {table: [] for _, table in EXPORTED_TABLES}
    assert nested["exported_at"] == manifest["exported_at"]
    assert nested["alembic_head"] is None


async def test_export_rows_round_trip_with_pinned_formats(auth_client, db):
    snapshot = NetWorthSnapshot(month=date(2026, 5, 1), recorded_on=date(2026, 5, 3), notes=None)
    account = Account(name="Café Fund", slug="cafe-fund", group="cash", sort_order=2)
    db.add_all([snapshot, account])
    await db.flush()
    db.add(
        AccountBalance(
            snapshot_id=snapshot.id, account_id=account.id, balance=Decimal("1234.50")
        )
    )
    db.add(AppSetting(key="swr_pct", value={"value": "0.04"}))
    await db.commit()

    resp = await auth_client.get(EXPORT)
    assert resp.status_code == 200, resp.text
    archive = zipfile.ZipFile(io.BytesIO(resp.content))

    manifest = json.loads(archive.read("manifest.json"))
    assert manifest["tables"]["accounts"] == 1
    assert manifest["tables"]["account_balances"] == 1
    assert manifest["tables"]["app_settings"] == 1

    # CSV: header is the MODEL-DEFINITION column order; NULL is the EMPTY cell; booleans
    # are lowercase true/false; non-ASCII text survives the utf-8 round trip byte-exact.
    accounts_csv = archive.read("csv/accounts.csv").decode("utf-8").splitlines()
    assert accounts_csv[0] == (
        "id,name,slug,group,sort_order,is_active,is_component,parent_account_id,person_id"
    )
    assert accounts_csv[1] == f"{account.id},Café Fund,cafe-fund,cash,2,true,false,,"

    balances_csv = archive.read("csv/account_balances.csv").decode("utf-8").splitlines()
    assert balances_csv[0] == "id,snapshot_id,account_id,balance"
    assert balances_csv[1].endswith(",1234.50")  # Decimal as a plain string, never exponents

    snapshots_csv = archive.read("csv/net_worth_snapshots.csv").decode("utf-8").splitlines()
    assert snapshots_csv[1].split(",")[1] == "2026-05-01"  # dates ISO

    # JSONB: compact JSON inside the CSV cell (csv doubles the quotes), native in the JSON.
    settings_csv = archive.read("csv/app_settings.csv").decode("utf-8").splitlines()
    assert settings_csv[1] == 'swr_pct,"{""value"":""0.04""}"'

    nested = json.loads(archive.read("finance-export.json"))
    assert nested["tables"]["accounts"] == [
        {
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
    ]
    assert nested["tables"]["account_balances"][0]["balance"] == "1234.50"
    assert nested["tables"]["net_worth_snapshots"][0]["month"] == "2026-05-01"
    assert nested["tables"]["app_settings"] == [{"key": "swr_pct", "value": {"value": "0.04"}}]
```

- [ ] Run it and watch it fail on the missing module:
  `cd backend && .venv/Scripts/python.exe -m pytest tests/test_export_api.py -q`
  Expected: collection error `ModuleNotFoundError: No module named 'app.api.export'`.
- [ ] Write `backend/app/api/export.py` (complete file):

```python
"""Full-data export (2026-08-31 tier-1 spec §B1): one auth-gated GET streaming a ZIP of
every user-data table — a CSV per table plus one nested finance-export.json, described by
manifest.json. The table list is HAND-MAINTAINED, not reflected: a future table must be a
conscious export decision, and test_export_api pins the list against Base.metadata so
forgetting one fails the suite until it is listed here or named in EXCLUDED_TABLES."""

import csv
import io
import json
import zipfile
from datetime import UTC, date, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.config import settings
from app.database import get_db
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
)

router = APIRouter(prefix="/export", tags=["export"], dependencies=[Depends(get_current_user)])

# Every user-data table, in the spec's order (§B1). `users` is excluded — password hash,
# and on a single-user app nothing else in it is worth exporting; `alembic_version` is not
# a Base.metadata table at all (the manifest carries the head instead).
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
)

EXCLUDED_TABLES = frozenset({"users"})


def _csv_cell(value: object) -> str:
    """One CSV spelling per type (spec §B1): NULL is the EMPTY cell, Decimals are plain
    strings (format 'f' — str() can spell exponents), dates ISO, booleans lowercase
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


def _json_cell(value: object) -> object:
    """The JSON twin: identical spellings for Decimal and dates, but None/bool/int/str and
    JSONB structures stay native — this file exists for programmatic re-import."""
    if isinstance(value, bool):
        return value
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, date):
        return value.isoformat()
    return value


async def _alembic_head(db: AsyncSession) -> str | None:
    """The system router's exact probe (app/api/system.py): to_regclass, not try/except —
    a missing alembic_version is an EXPECTED state (create_all-built databases, every test
    run), and a failed SELECT would abort the session's transaction mid-request."""
    has_alembic = (
        await db.execute(text("SELECT to_regclass('alembic_version') IS NOT NULL"))
    ).scalar_one()
    if not has_alembic:
        return None
    head_row = await db.execute(text("SELECT version_num FROM alembic_version"))
    return head_row.scalars().first()


@router.get("/snapshot")
async def export_snapshot(db: AsyncSession = Depends(get_db)) -> StreamingResponse:
    exported_at = datetime.now(UTC)
    alembic_head = await _alembic_head(db)
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
            counts[table_name] = len(rows)
            sink = io.StringIO()
            writer = csv.writer(sink)  # csv's default \r\n line ending IS RFC 4180's
            writer.writerow([column.key for column in columns])
            for row in rows:
                writer.writerow([_csv_cell(getattr(row, column.key)) for column in columns])
            archive.writestr(f"csv/{table_name}.csv", sink.getvalue())
            json_tables[table_name] = [
                {column.key: _json_cell(getattr(row, column.key)) for column in columns}
                for row in rows
            ]
        manifest = {
            "exported_at": exported_at.isoformat(),
            "environment": settings.environment,
            "alembic_head": alembic_head,
            "app": "personal-finance-dashboard",
            "note": "full user-data export; users and alembic_version are excluded by design",
            "tables": counts,
        }
        archive.writestr("manifest.json", json.dumps(manifest, indent=2))
        archive.writestr(
            "finance-export.json",
            json.dumps(
                {
                    "exported_at": exported_at.isoformat(),
                    "alembic_head": alembic_head,
                    "tables": json_tables,
                },
                indent=2,
            ),
        )
    payload = buffer.getvalue()
    filename = f"finance-export-{exported_at.strftime('%Y%m%d-%H%M')}.zip"
    return StreamingResponse(
        iter([payload]),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(payload)),
        },
    )
```

- [ ] Register the router in `backend/app/main.py`. In the `from app.api import (...)` block (:10-29), add `export,` between `espp,` and `household,`:

```python
from app.api import (
    app_settings,
    auth,
    calendar,
    comp,
    credit_cards,
    espp,
    export,
    household,
    import_,
    limits,
    net_worth,
    overview,
    paycheck,
    portfolio,
    prices,
    projection,
    spending,
    system,
    taxes,
)
```

  and after `app.include_router(system.router, prefix="/api/v1")` (:95) add:

```python
app.include_router(export.router, prefix="/api/v1")
```

- [ ] `cd backend && .venv/Scripts/python.exe -m pytest tests/test_export_api.py -q`
  Expected: `4 passed`.
- [ ] `cd backend && .venv/Scripts/python.exe -m pytest -q`
  Expected: baseline + 4, zero failures.
- [ ] `cd backend && .venv/Scripts/python.exe -m ruff check app tests && .venv/Scripts/python.exe -m ruff format app tests`
  Expected: `All checks passed!` then `N files left unchanged` (if format rewrites anything, re-run the two pytest commands).
- [ ] Commit: `git add backend/app/api/export.py backend/app/main.py backend/tests/test_export_api.py && git commit -m "feat(export): full-data ZIP snapshot endpoint with metadata-pinned table list"`

---

### Task 2: B1 frontend — `downloadSnapshot()` + System card button

**Files:**
- `src/api/system.ts` (whole file is 9 lines today — extend)
- `src/components/settings/SystemCard.tsx` (button + busy/error state; backup `<dd>` restructure)
- `src/components/settings/SystemCard.test.tsx` (mock factory :8-11, new tests)

- [ ] Add the failing tests to `src/components/settings/SystemCard.test.tsx`. First, extend the mock factory at :8-11 to stub the new export door:

```tsx
vi.mock('../../api/system', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/system')>()),
  fetchSystemStatus: vi.fn(),
  downloadSnapshot: vi.fn(),
}))
import { downloadSnapshot, fetchSystemStatus } from '../../api/system'
```

  (replaces the existing `import { fetchSystemStatus } from '../../api/system'` line at :12). Extend the imports at :1 to `import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'`. In the existing `beforeEach` (:51-53) add one line: `vi.mocked(downloadSnapshot).mockResolvedValue(undefined)`. Then append the new tests at the end of the file:

```tsx
it('downloads the snapshot with a busy state on the button', async () => {
  let release: () => void = () => {}
  vi.mocked(downloadSnapshot).mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        release = resolve
      }),
  )
  render(<SystemCard />)
  fireEvent.click(await screen.findByRole('button', { name: 'Download snapshot (.zip)' }))
  expect(downloadSnapshot).toHaveBeenCalledTimes(1)
  const busy = screen.getByRole('button', { name: 'Preparing…' }) as HTMLButtonElement
  expect(busy.disabled).toBe(true)
  await act(async () => {
    release()
  })
  const idle = screen.getByRole('button', { name: 'Download snapshot (.zip)' }) as HTMLButtonElement
  expect(idle.disabled).toBe(false)
})

it('surfaces a failed export without hiding the facts', async () => {
  vi.mocked(downloadSnapshot).mockRejectedValue(new ApiError('export blew up', 500))
  render(<SystemCard />)
  fireEvent.click(await screen.findByRole('button', { name: 'Download snapshot (.zip)' }))
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain('export blew up')
  // The facts stay on screen — the download error is its own surface, never the card's
  // load-error state (which unmounts SystemFacts).
  expect(screen.getByText('Running')).toBeDefined()
})
```

- [ ] `npx vitest run src/components/settings/SystemCard.test.tsx`
  Expected: the two new tests fail (`Unable to find role="button" and name "Download snapshot (.zip)"`); the six existing tests still pass.
- [ ] Rewrite `src/api/system.ts` (complete file):

```typescript
import { api, ApiError, getToken } from './client'
import type { SystemStatus } from '../types/api'

// GET /system/status — the refresh-status superset (spec §3). Overview swapped its
// /prices/refresh-status fetch for this; PortfolioPage still uses the old endpoint.
export function fetchSystemStatus(): Promise<SystemStatus> {
  return api<SystemStatus>('/system/status')
}

// GET /export/snapshot — the full-data ZIP (2026-08-31 spec §B1), handed to the browser's
// own save flow. NOT api<T>(): that helper json()s every body; this one needs the raw blob
// plus the Content-Disposition filename (same-origin fetch exposes every header). 60s
// budget: the ZIP compresses the whole database and must survive a slow link where the
// client's 15s default would not.
export async function downloadSnapshot(): Promise<void> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  let res: Response
  try {
    res = await fetch('/api/v1/export/snapshot', {
      headers,
      signal: AbortSignal.timeout(60_000),
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new ApiError('Export timed out', 0)
    }
    throw new ApiError('Network error — is the server reachable?', 0)
  }
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = (await res.json()) as { detail?: unknown }
      if (typeof body.detail === 'string') detail = body.detail
    } catch {
      // non-JSON error body
    }
    throw new ApiError(detail, res.status)
  }
  const blob = await res.blob()
  const disposition = res.headers.get('content-disposition') ?? ''
  const filename = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? 'finance-export.zip'
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
```

- [ ] Wire the button into `src/components/settings/SystemCard.tsx`:
  1. Extend the api import at :3 to `import { downloadSnapshot, fetchSystemStatus } from '../../api/system'`.
  2. Restructure the backup row inside `SystemFacts` (:57-60) so the stamp keeps its own element (the staleness class assertions target it) and the button sits beside it — `SystemFacts` gains two props:

```tsx
function SystemFacts({
  status,
  downloading,
  onDownload,
}: {
  status: SystemStatus
  downloading: boolean
  onDownload: () => void
}) {
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
        <dd>
          <span className={backup.className}>{backup.text}</span>{' '}
          {/* The on-demand door beside the nightly marker (spec §B1): the snapshot ZIP
              is the app's own backup, so it lives on the backup row. */}
          <button type="button" className="button" onClick={onDownload} disabled={downloading}>
            {downloading ? 'Preparing…' : 'Download snapshot (.zip)'}
          </button>
        </dd>
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
```

  3. In the `SystemCard` component add the action state and handler after the existing state hooks (:84-87):

```tsx
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  // Its OWN error state, never the card's `error`: that one unmounts SystemFacts (the
  // render below is `!error && <SystemFacts/>`), and a failed download must not blank
  // rows that loaded fine.
  const download = () => {
    setDownloading(true)
    setDownloadError(null)
    downloadSnapshot()
      .catch((err: unknown) => {
        setDownloadError(err instanceof ApiError ? err.message : 'Export failed.')
      })
      .finally(() => setDownloading(false))
  }
```

  4. In the JSX, render the download error beside the load-error banner (after the `{error && (...)}` block, :117-130) and pass the new props:

```tsx
      {downloadError && (
        <div className="error-banner" role="alert">
          {downloadError}
        </div>
      )}
      {status === null
        ? loading && <p className="empty-note">Loading…</p>
        : !error && (
            <SystemFacts status={status} downloading={downloading} onDownload={download} />
          )}
```

- [ ] `npx vitest run src/components/settings/SystemCard.test.tsx`
  Expected: `8 passed` (6 existing + 2 new — the existing backup-staleness tests still pass because the stamp span carries the class and its textContent).
- [ ] `npm test`
  Expected: all pass (SettingsPage/Overview mocks spread `importOriginal`, so the new export stays inert there).
- [ ] `npm run lint`
  Expected: clean exit.
- [ ] Commit: `git add src/api/system.ts src/components/settings/SystemCard.tsx src/components/settings/SystemCard.test.tsx && git commit -m "feat(export): download-snapshot button on the Settings System card"`

---

### Task 3: B2 backend — `DELETE /net-worth/months/{month}`

**Files:**
- `backend/app/api/net_worth.py` (new route after `put_month`, file ends :415; comment fix :365-373)
- `backend/tests/test_net_worth_api.py` (imports :1-4; new tests after `test_put_month_refuses_empty_create_but_allows_meta_update`, ~:365-382)

- [ ] Add the failing tests to `backend/tests/test_net_worth_api.py`. Extend the imports at the top of the file (currently `from datetime import date` / `from decimal import Decimal` / `from app.models import ...`) with:

```python
from sqlalchemy import func, select
```

  then add after `test_put_month_refuses_empty_create_but_allows_meta_update` (~:382):

```python
async def test_delete_month_removes_snapshot_and_cascades_balances(auth_client, db):
    await _seed_timeseries(db)
    resp = await auth_client.delete("/api/v1/net-worth/months/2026-01-01")
    assert resp.status_code == 204
    # Gone from every read: the timeseries loses the month...
    body = (await auth_client.get("/api/v1/net-worth/timeseries")).json()
    assert body["months"] == ["2025-12-01", "2026-03-01"]
    read = (await auth_client.get("/api/v1/net-worth/months/2026-01-01")).json()
    assert read["exists"] is False
    assert read["balances"] == []
    # ...and the FK's ON DELETE CASCADE took the month's 3 balance rows (8 seeded - 3).
    remaining = (
        await db.execute(select(func.count()).select_from(AccountBalance))
    ).scalar_one()
    assert remaining == 5


async def test_delete_month_404_when_absent_and_422_on_a_mid_month_date(auth_client, db):
    await _seed_timeseries(db)
    assert (await auth_client.delete("/api/v1/net-worth/months/2026-02-01")).status_code == 404
    assert (await auth_client.delete("/api/v1/net-worth/months/2026-02-02")).status_code == 422
    # Neither rejection deleted anything.
    body = (await auth_client.get("/api/v1/net-worth/timeseries")).json()
    assert body["months"] == ["2025-12-01", "2026-01-01", "2026-03-01"]
```

- [ ] `cd backend && .venv/Scripts/python.exe -m pytest tests/test_net_worth_api.py -q`
  Expected: the two new tests fail with `405 Method Not Allowed` assertions (`assert 405 == 204` / `assert 405 == 404`); everything else passes.
- [ ] Implement the route in `backend/app/api/net_worth.py`, appended after `put_month` (after :414):

```python
@router.delete("/months/{month}", status_code=204)
async def delete_month(month: date, db: AsyncSession = Depends(get_db)) -> Response:
    """Remove a month wholesale (2026-08-31 spec §B2): the snapshot row goes and the FK's
    ON DELETE CASCADE takes every account_balances row with it (declared on the model, so
    create_all schemas carry it too). 404 when no snapshot exists — the wizard's paired
    spending delete tolerates that, so a spending-only month still clears fully."""
    require_first_of_month(month)
    snapshot = (
        await db.execute(select(NetWorthSnapshot).where(NetWorthSnapshot.month == month))
    ).scalar_one_or_none()
    if snapshot is None:
        raise HTTPException(status_code=404, detail="no snapshot exists for this month")
    await db.delete(snapshot)
    await db.commit()
    return Response(status_code=204)
```

  (`Response`, `HTTPException`, `select`, `date` and `require_first_of_month` are already imported at :1-36.)
- [ ] Fix the now-false comment inside `put_month` (:365-373). Replace:

```python
        if not body.balances:
            # An empty month would poison the summary KPI and the coverage ribbon,
            # and no DELETE /months exists to undo it. Meta-only PUTs remain legal
            # on months that already exist.
```

  with:

```python
        if not body.balances:
            # An empty month would poison the summary KPI and the coverage ribbon.
            # DELETE /months/{month} exists now (2026-08-31 spec §B2), but the refusal
            # stays: an accidental empty create should not need an undo. Meta-only
            # PUTs remain legal on months that already exist.
```

- [ ] `cd backend && .venv/Scripts/python.exe -m pytest tests/test_net_worth_api.py -q`
  Expected: all pass (34 existing + 2 new).
- [ ] `cd backend && .venv/Scripts/python.exe -m pytest -q`
  Expected: zero failures.
- [ ] `cd backend && .venv/Scripts/python.exe -m ruff check app tests && .venv/Scripts/python.exe -m ruff format app tests`
  Expected: clean / `N files left unchanged`.
- [ ] Commit: `git add backend/app/api/net_worth.py backend/tests/test_net_worth_api.py && git commit -m "feat(net-worth): DELETE /months/{month} removes a snapshot and its balances"`

---

### Task 4: B2 backend — `DELETE /spending/months/{month}`

**Files:**
- `backend/app/api/spending.py` (new route after `put_month`, file ends :481)
- `backend/tests/test_spending_api.py` (new tests after `test_put_spending_month_net_pay_null_rides_along_with_amounts`, ~:313-336; no new imports — the file already imports `date`, `Decimal`, `MonthlyCashflow`, `MonthlySpending`)

- [ ] Add the failing tests to `backend/tests/test_spending_api.py` (the `_seed_spending` helper at :77 seeds 2025-12 with 2 spending rows + a cashflow row, 2026-01 with food only and NO cashflow, 2026-02 with 2 rows + cashflow):

```python
async def test_delete_month_removes_spending_and_cashflow(auth_client, db):
    await _seed_spending(db)
    resp = await auth_client.delete("/api/v1/spending/months/2025-12-01")
    assert resp.status_code == 204
    read = (await auth_client.get("/api/v1/spending/months/2025-12-01")).json()
    assert read["exists"] is False
    assert read["amounts"] == []
    assert read["net_pay"] is None
    # The deleted month disappears from the matrix (spec §B2's read-side check).
    body = (await auth_client.get("/api/v1/spending/matrix")).json()
    assert body["months"] == ["2026-01-01", "2026-02-01"]
    assert await db.get(MonthlyCashflow, date(2025, 12, 1)) is None


async def test_delete_month_handles_each_half_alone(auth_client, db):
    await _seed_spending(db)
    # Spending-only month (2026-01 has no cashflow row): still deletes.
    assert (await auth_client.delete("/api/v1/spending/months/2026-01-01")).status_code == 204
    assert (await auth_client.get("/api/v1/spending/months/2026-01-01")).json()["exists"] is False
    # Cashflow-only month: seed one, delete it.
    db.add(MonthlyCashflow(month=date(2026, 4, 1), net_pay=Decimal("5000.00")))
    await db.commit()
    assert (await auth_client.delete("/api/v1/spending/months/2026-04-01")).status_code == 204
    assert await db.get(MonthlyCashflow, date(2026, 4, 1)) is None


async def test_delete_month_404_when_nothing_exists_and_422_on_a_mid_month_date(auth_client, db):
    await _seed_spending(db)
    assert (await auth_client.delete("/api/v1/spending/months/2030-01-01")).status_code == 404
    assert (await auth_client.delete("/api/v1/spending/months/2030-01-02")).status_code == 422
    # Neither rejection deleted anything.
    body = (await auth_client.get("/api/v1/spending/matrix")).json()
    assert body["months"] == ["2025-12-01", "2026-01-01", "2026-02-01"]
```

- [ ] `cd backend && .venv/Scripts/python.exe -m pytest tests/test_spending_api.py -q`
  Expected: the three new tests fail with `assert 405 == 204` / `assert 405 == 404`; the rest pass.
- [ ] Implement the route in `backend/app/api/spending.py`, appended after `put_month` (after :481):

```python
@router.delete("/months/{month}", status_code=204)
async def delete_month(month: date, db: AsyncSession = Depends(get_db)) -> Response:
    """Remove a month's spending wholesale (2026-08-31 spec §B2): every monthly_spending
    row AND the monthly_cashflow row. 404 only when NEITHER exists — a cashflow-only
    month (net pay entered, no categories) still deletes cleanly, and vice versa."""
    require_first_of_month(month)
    rows = (
        (await db.execute(select(MonthlySpending).where(MonthlySpending.month == month)))
        .scalars()
        .all()
    )
    cashflow = await db.get(MonthlyCashflow, month)
    if not rows and cashflow is None:
        raise HTTPException(
            status_code=404, detail="no spending or net pay recorded for this month"
        )
    for row in rows:
        await db.delete(row)
    if cashflow is not None:
        await db.delete(cashflow)
    await db.commit()
    return Response(status_code=204)
```

  (`Response`, `HTTPException`, `select`, `date` and `require_first_of_month` are already imported at :1-34.)
- [ ] `cd backend && .venv/Scripts/python.exe -m pytest tests/test_spending_api.py -q`
  Expected: all pass (22 existing + 3 new).
- [ ] `cd backend && .venv/Scripts/python.exe -m pytest -q`
  Expected: zero failures.
- [ ] `cd backend && .venv/Scripts/python.exe -m ruff check app tests && .venv/Scripts/python.exe -m ruff format app tests`
  Expected: clean / `N files left unchanged`.
- [ ] Commit: `git add backend/app/api/spending.py backend/tests/test_spending_api.py && git commit -m "feat(spending): DELETE /months/{month} removes spending rows and cashflow"`

---

### Task 5: B2 frontend — wizard delete UI (typed-month arm-and-confirm)

> **Plan A edited `src/pages/MonthlyUpdatePage.tsx` before this task** (A1 liability cue in the balances table, A8 two-leg save). Every anchor below is quoted by landmark code from the pre-A file — **re-locate each landmark in the current file before editing**; if a landmark is missing or moved into new structure, adapt to the post-A shape and say so in the task report.

**Files:**
- `src/api/netWorth.ts` (append `deleteMonthBalances`)
- `src/api/spending.ts` (append `deleteSpendingMonth`)
- `src/pages/MonthlyUpdatePage.tsx` (imports; state; load-effect dep; `selectMonth`; Review card)
- `src/pages/MonthlyUpdatePage.css` (danger-zone styles)
- `src/pages/MonthlyUpdatePage.test.tsx` (mock factories :6-19; new tests)

- [ ] Add the failing tests to `src/pages/MonthlyUpdatePage.test.tsx`.
  1. Extend the two bare mock factories (:6-19) — the page will import the new functions, and a bare factory that omits them hands the component `undefined`:

```tsx
vi.mock('../api/netWorth', () => ({
  fetchAccounts: vi.fn(),
  fetchMonthBalances: vi.fn(),
  fetchTimeseries: vi.fn(),
  putMonthBalances: vi.fn(),
  deleteMonthBalances: vi.fn(),
}))
vi.mock('../api/spending', () => ({
  fetchCategories: vi.fn(),
  fetchMatrix: vi.fn(),
  fetchSpendingMonth: vi.fn(),
  putSpendingMonth: vi.fn(),
  deleteSpendingMonth: vi.fn(),
}))
```

  2. Add imports next to the existing ones: `import { ApiError } from '../api/client'` and `import ToastProvider from '../components/ToastProvider'`.
  3. Append the new tests at the end of the file (the fixture months: `2026-07-01` exists on the server, `2026-08-01` does not — see the `fetchMonthBalances` mock in `beforeEach`):

```tsx
function renderWizardAt(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <ToastProvider>
        <MonthlyUpdatePage />
      </ToastProvider>
    </MemoryRouter>,
  )
}

it('offers no delete on a month the server has never seen', async () => {
  renderWizardAt('/update?month=2026-08-01&step=review')
  await screen.findByRole('button', { name: 'Save month' })
  expect(screen.queryByRole('button', { name: 'Delete this month' })).toBeNull()
})

it('arms on the typed month, fires both deletes tolerating a 404, clears the draft', async () => {
  vi.mocked(netWorthApi.deleteMonthBalances).mockResolvedValue(undefined)
  // The spending leg 404s (balances-only month) — the delete still fully succeeds.
  vi.mocked(spendingApi.deleteSpendingMonth).mockRejectedValue(
    new ApiError('no spending or net pay recorded for this month', 404),
  )
  sessionStorage.setItem('finance-update-draft:2026-07-01', '{"balances":{"1":"9.00"}}')
  renderWizardAt('/update?month=2026-07-01&step=review')
  const button = (await screen.findByRole('button', {
    name: 'Delete this month',
  })) as HTMLButtonElement
  expect(button.disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('Type 2026-07 to confirm'), {
    target: { value: '2026-07' },
  })
  expect(button.disabled).toBe(false)
  fireEvent.click(button)
  await waitFor(() => expect(netWorthApi.deleteMonthBalances).toHaveBeenCalledWith('2026-07-01'))
  expect(spendingApi.deleteSpendingMonth).toHaveBeenCalledWith('2026-07-01')
  await screen.findByText(`Deleted ${formatMonth('2026-07-01')} — balances and spending removed.`)
  expect(sessionStorage.getItem('finance-update-draft:2026-07-01')).toBeNull()
  // Landed on the CURRENT month's wizard.
  await waitFor(() =>
    expect(
      screen.getByText(`Monthly update — ${formatMonth(currentMonthIso())}`),
    ).toBeDefined(),
  )
})

it('surfaces a non-404 delete failure, stops before the second leg, stays on the month', async () => {
  vi.mocked(netWorthApi.deleteMonthBalances).mockRejectedValue(new ApiError('db exploded', 500))
  renderWizardAt('/update?month=2026-07-01&step=review')
  fireEvent.change(await screen.findByLabelText('Type 2026-07 to confirm'), {
    target: { value: '2026-07' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Delete this month' }))
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain('db exploded')
  expect(spendingApi.deleteSpendingMonth).not.toHaveBeenCalled()
  expect(screen.getByText(`Monthly update — ${formatMonth('2026-07-01')}`)).toBeDefined()
})
```

  (`waitFor`, `fireEvent`, `screen`, `render`, `MemoryRouter`, `formatMonth`, `currentMonthIso`, `netWorthApi`, `spendingApi` are already imported in this file.)
- [ ] `npx vitest run src/pages/MonthlyUpdatePage.test.tsx`
  Expected: the three new tests fail (no delete button renders); every pre-existing test still passes.
- [ ] Append to `src/api/netWorth.ts`:

```typescript
// 404 when the month has no snapshot — the wizard delete treats that as "already gone".
export function deleteMonthBalances(month: string): Promise<void> {
  return api<void>(`/net-worth/months/${month}`, { method: 'DELETE' })
}
```

- [ ] Append to `src/api/spending.ts`:

```typescript
// 404 when the month has neither spending rows nor a cashflow row — "already gone".
export function deleteSpendingMonth(month: string): Promise<void> {
  return api<void>(`/spending/months/${month}`, { method: 'DELETE' })
}
```

- [ ] Wire the wizard (`src/pages/MonthlyUpdatePage.tsx`) — five edits, all landmark-anchored:
  1. **Imports** (top of file, verify-at-implementation): add `deleteMonthBalances,` to the `from '../api/netWorth'` block (pre-A :6-11), `deleteSpendingMonth,` to the `from '../api/spending'` block (pre-A :13-18), and a new line `import { useToast } from '../components/ToastProvider'` beside the other component imports (pre-A ~:19-21).
  2. **State + toast handle** — after the `const [restored, setRestored] = useState(false)` line (pre-A :144), add:

```tsx
  // Delete-month arm-and-confirm (2026-08-31 spec §B2): the typed YYYY-MM arms the red
  // button. loadNonce forces the load effect when the deleted month IS the month on
  // screen — the [month] dep alone would never re-run.
  const [deleteArm, setDeleteArm] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [loadNonce, setLoadNonce] = useState(0)
  const toast = useToast()
```

  3. **Load effect** — the big `useEffect(() => { Promise.all([...` (pre-A :175-294). Add `void loadNonce` as the first line of the effect body (a real reference, so react-hooks/exhaustive-deps accepts the dep) and extend the dependency array from `}, [month])` to `}, [month, loadNonce])`:

```tsx
  useEffect(() => {
    // loadNonce has no data role: the wizard delete bumps it to force this chain when
    // the deleted month is the month already on screen.
    void loadNonce
    Promise.all([
```

  4. **Delete handler** — after the `save` function (pre-A ends :438; A8 will have reshaped `save`, place it directly after whatever `save` is now):

```tsx
  // Each leg tolerates ITS OWN 404 — a balances-only month must still fully clear, and
  // the mirror case too — but any other failure surfaces and stops the sequence (a retry
  // re-runs both; the leg that already succeeded then 404s and is tolerated).
  const tolerate404 = async (call: Promise<void>) => {
    try {
      await call
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return
      throw err
    }
  }

  const deleteMonth = async () => {
    setDeleting(true)
    setError(null)
    try {
      await tolerate404(deleteMonthBalances(month))
      await tolerate404(deleteSpendingMonth(month))
      sessionStorage.removeItem(draftKey(month))
      toast.success(`Deleted ${formatMonth(month)} — balances and spending removed.`)
      setDeleteArm('')
      setSaved(null)
      setRestored(false)
      setLoading(true)
      // Land on the CURRENT month's wizard; the nonce covers the deleted-month ===
      // current-month case, where the month param does not change.
      setLoadNonce((n) => n + 1)
      setParams(() => new URLSearchParams({ month: currentMonthIso(), step: 'balances' }))
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `Delete failed: ${err.message} — retry`
          : 'Delete failed — retry',
      )
    } finally {
      setDeleting(false)
    }
  }
```

  5. **Review card** — inside `{!loading && step === 'review' && (` (pre-A :991-1044), after the `drill-hint` paragraph ("Server-side rounding …", pre-A :1022-1025) and before the `wizard-footer` div (pre-A :1026), insert:

```tsx
          {monthExisted && (
            <div className="danger-zone">
              <h3 className="eyebrow">Danger</h3>
              <p className="drill-hint">
                Delete this month everywhere: its balances snapshot, spending rows and
                take-home. This cannot be undone.
              </p>
              <div className="danger-row">
                <label htmlFor="delete-arm">Type {month.slice(0, 7)} to confirm</label>
                <input
                  id="delete-arm"
                  type="text"
                  className="field-input"
                  value={deleteArm}
                  onChange={(e) => setDeleteArm(e.target.value)}
                  placeholder={month.slice(0, 7)}
                />
                <button
                  type="button"
                  className="button danger-button"
                  disabled={deleting || deleteArm.trim() !== month.slice(0, 7)}
                  onClick={() => void deleteMonth()}
                >
                  {deleting ? 'Deleting…' : 'Delete this month'}
                </button>
              </div>
            </div>
          )}
```

  6. **`selectMonth`** (pre-A :446-458): add `setDeleteArm('')` next to the existing `setPasteNote(null)` reset — a half-typed confirmation must not survive into another month.
- [ ] Append to `src/pages/MonthlyUpdatePage.css`:

```css
/* ── Danger zone (delete month) — the Review step's arm-and-confirm ─────────── */
.danger-zone {
  margin-top: 1.25rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border);
}
.danger-zone .danger-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin-top: 0.5rem;
}
.danger-button:not(:disabled) {
  border-color: var(--negative);
  color: var(--negative);
}
```

- [ ] `npx vitest run src/pages/MonthlyUpdatePage.test.tsx`
  Expected: all pass (every pre-existing wizard test + 3 new).
- [ ] `npm test`
  Expected: zero failures.
- [ ] `npm run lint`
  Expected: clean exit (the `void loadNonce` reference keeps exhaustive-deps satisfied).
- [ ] Commit: `git add src/api/netWorth.ts src/api/spending.ts src/pages/MonthlyUpdatePage.tsx src/pages/MonthlyUpdatePage.css src/pages/MonthlyUpdatePage.test.tsx && git commit -m "feat(wizard): typed-month arm-and-confirm delete on the Review step"`

---

### Task 6: B3 — backup script encryption + `backup_runs` trail

Shell has no pytest: verification here is `bash -n` (syntax) plus documentation — the dev box has no OCI credentials, so the live run happens on the server at deploy time (Task 9 writes that into the README).

**Files:**
- `backend/scripts/backup_db.sh` (rewrite — full contents below)
- `.env.example` (repo root — the script sources the project-root `.env`; add the passphrase line after the OCI block, :17-25)

- [ ] Replace `backend/scripts/backup_db.sh` with (complete file):

```bash
#!/bin/bash
# Nightly PostgreSQL backup to OCI Object Storage.
# Uploads via boto3 against OCI's S3-compatible API (the AWS CLI has a
# Content-Length issue with that endpoint). Retention: RETENTION_DAYS.
# Optional encryption (2026-08-31 spec §B3): set BACKUP_PASSPHRASE in .env to pipe the
# gzip through symmetric gpg (AES256) and upload .sql.gz.gpg; unset keeps plaintext
# dumps and prints a one-line warning per run.
# Config comes from the project-root .env (see README "Nightly backups").
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Load .env from project root if it exists
ENV_FILE="${SCRIPT_DIR}/../../.env"
if [ -f "$ENV_FILE" ]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

# Database config
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${POSTGRES_DB:-finance}"
DB_USER="${POSTGRES_USER:-finance}"

# OCI Object Storage config (S3-compatible)
OCI_REGION="${OCI_REGION:?Set OCI_REGION}"
OCI_NAMESPACE="${OCI_NAMESPACE:?Set OCI_NAMESPACE}"
OCI_BUCKET="${OCI_BUCKET_NAME:?Set OCI_BUCKET_NAME}"
OCI_ACCESS_KEY="${OCI_ACCESS_KEY:?Set OCI_ACCESS_KEY}"
OCI_SECRET_KEY="${OCI_SECRET_KEY:?Set OCI_SECRET_KEY}"

S3_ENDPOINT="https://${OCI_NAMESPACE}.compat.objectstorage.${OCI_REGION}.oraclecloud.com"

RETENTION_DAYS=30
TODAY="$(date +%Y-%m-%d)"
EXPIRED="$(date -d "${RETENTION_DAYS} days ago" +%Y-%m-%d 2>/dev/null || date -v-${RETENTION_DAYS}d +%Y-%m-%d)"

# Encryption is opt-in: with BACKUP_PASSPHRASE everything lands as .sql.gz.gpg; without
# it, today's plaintext path stands — loudly.
if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
  SUFFIX="sql.gz.gpg"
else
  SUFFIX="sql.gz"
  echo "[$(date)] WARN: BACKUP_PASSPHRASE is not set — uploading an UNENCRYPTED dump"
fi
DUMP_FILE="/tmp/${DB_NAME}_${TODAY}.${SUFFIX}"
OBJECT_KEY="backups/${DB_NAME}_${TODAY}.${SUFFIX}"
# Retention sweeps BOTH suffixes regardless of today's mode: a passphrase added (or
# dropped) mid-window must not orphan the other flavor past RETENTION_DAYS.
EXPIRED_KEY_PLAIN="backups/${DB_NAME}_${EXPIRED}.sql.gz"
EXPIRED_KEY_GPG="backups/${DB_NAME}_${EXPIRED}.sql.gz.gpg"

# Run trail (2026-08-31 spec §B3): app_settings['backup_runs'] is a FLAT jsonb ARRAY,
# newest first, trimmed to 10 in the upsert itself — the {"value": ...} envelope is a
# Python readers' convention and this writer is a shell script, exactly like
# backup_status below. The `\$` keeps bash's ancient $[...] arithmetic out of the
# jsonpath literal. Every interpolated value is machine-generated (date -u, the
# OBJECT_KEY template), so the single-quoted SQL literal cannot be broken by user text.
append_backup_run() {
  local run_json="$1"
  PGPASSWORD="${POSTGRES_PASSWORD}" psql \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_USER" \
    -d "$DB_NAME" \
    -v ON_ERROR_STOP=1 \
    -q \
    -c "INSERT INTO app_settings AS s (key, value) VALUES ('backup_runs', jsonb_build_array('${run_json}'::jsonb)) ON CONFLICT (key) DO UPDATE SET value = jsonb_path_query_array(EXCLUDED.value || (CASE WHEN jsonb_typeof(s.value) = 'array' THEN s.value ELSE '[]'::jsonb END), '\$[0 to 9]')"
}

# Best-effort failure marker: record {ok: false} in the trail so the System card can say
# WHEN the cron last broke, then let set -e end the run as before. || true keeps an
# unreachable database from failing inside its own failure handler.
record_failure() {
  local line="$1"
  append_backup_run "{\"at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\", \"ok\": false, \"error\": \"backup script failed near line ${line}\"}" \
    || true
}
trap 'record_failure $LINENO' ERR

echo "[$(date)] Starting backup of database '${DB_NAME}'..."

# Dump, compress, and (when configured) encrypt. --pinentry-mode loopback is required to
# take the passphrase non-interactively: without it gpg 2.1+ ignores --passphrase under
# --batch and tries to open a pinentry a cron job does not have.
if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
  PGPASSWORD="${POSTGRES_PASSWORD}" pg_dump \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_USER" \
    -d "$DB_NAME" \
    --no-owner \
    --no-acl \
    | gzip \
    | gpg --symmetric --batch --yes --cipher-algo AES256 \
        --pinentry-mode loopback --passphrase "$BACKUP_PASSPHRASE" \
        -o "$DUMP_FILE"
else
  PGPASSWORD="${POSTGRES_PASSWORD}" pg_dump \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_USER" \
    -d "$DB_NAME" \
    --no-owner \
    --no-acl \
    | gzip > "$DUMP_FILE"
fi

DUMP_SIZE="$(du -h "$DUMP_FILE" | cut -f1)"
echo "[$(date)] Dump complete: ${DUMP_FILE} (${DUMP_SIZE})"

# Upload to OCI Object Storage and delete the backups (both flavors) that aged past
# retention
python3 - "$S3_ENDPOINT" "$OCI_REGION" "$OCI_ACCESS_KEY" "$OCI_SECRET_KEY" \
  "$OCI_BUCKET" "$DUMP_FILE" "$OBJECT_KEY" "$EXPIRED_KEY_PLAIN" "$EXPIRED_KEY_GPG" <<'PYEOF'
import sys, boto3
from botocore.config import Config

endpoint, region, access_key, secret_key, bucket, dump_file, obj_key = sys.argv[1:8]
expired_keys = sys.argv[8:10]

# region_name is REQUIRED: without it boto3 signs with us-east-1 in the SigV4
# credential scope, which OCI only tolerates in the tenancy's home region
# ("SignatureDoesNotMatch: The secret key ... could not be found. The region
# must be specified if this is not the home region for the tenancy.")
s3 = boto3.client(
    "s3",
    endpoint_url=endpoint,
    region_name=region,
    aws_access_key_id=access_key,
    aws_secret_access_key=secret_key,
    config=Config(signature_version="s3v4"),
)

s3.upload_file(dump_file, bucket, obj_key)
print(f"Uploaded to s3://{bucket}/{obj_key}")

for expired_key in expired_keys:
    try:
        s3.delete_object(Bucket=bucket, Key=expired_key)
        print(f"Deleted expired backup (if it existed): {expired_key}")
    except Exception:
        print(f"Could not delete expired backup: {expired_key}")
PYEOF

# Record the successful upload for the dashboard's System card (2026-08-25 spec §3 +
# 2026-08-31 spec §B3): upsert app_settings['backup_status'] as a FLAT JSON object — the
# {"value": ...} envelope is a Python readers' convention, and the reader
# (app/api/system.py) expects exactly this shape — and append this run to
# app_settings['backup_runs'] in the same step. Best-effort BY DESIGN: the backup itself
# already succeeded, so a marker failure only warns — the `|| echo` keeps `set -e` (and
# the ERR trap: && / || chains are exempt from it) from turning bookkeeping into a
# failed backup.
RUN_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
BACKUP_MARKER="{\"last_success_at\": \"${RUN_AT}\", \"object_key\": \"${OBJECT_KEY}\", \"size\": \"${DUMP_SIZE}\"}"
{
  PGPASSWORD="${POSTGRES_PASSWORD}" psql \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_USER" \
    -d "$DB_NAME" \
    -v ON_ERROR_STOP=1 \
    -q \
    -c "INSERT INTO app_settings (key, value) VALUES ('backup_status', '${BACKUP_MARKER}'::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value" \
  && append_backup_run "{\"at\": \"${RUN_AT}\", \"ok\": true, \"object\": \"${OBJECT_KEY}\"}"
} || echo "[$(date)] WARN: could not record backup_status/backup_runs in app_settings — the backup itself succeeded"

# Clean up local dump
rm -f "$DUMP_FILE"
echo "[$(date)] Backup complete."
```

- [ ] Add the passphrase to the root `.env.example`, after the OCI block (after :25). Commented out, not a placeholder value — the script keys off "set at all", and a copied-through `<placeholder>` would silently encrypt with the literal placeholder text:

```
# Optional: symmetric-encrypt every backup with gpg AES256 before upload (objects land
# as .sql.gz.gpg). Generate: openssl rand -base64 32. Keep a copy of the passphrase OFF
# this server — without it an encrypted backup is unrecoverable. Leave unset for
# plaintext dumps (the script prints a warning per run).
# BACKUP_PASSPHRASE=
```

- [ ] Syntax check (Git Bash): `bash -n backend/scripts/backup_db.sh`
  Expected: no output, exit 0. (The live encrypted run is a deploy-time check on the server — no OCI credentials exist on this box; Task 9's README note records that.)
- [ ] Jsonpath sanity check — prove the append-and-trim expression on this Postgres (read-only SELECT over a literal, writes nothing; dev DB per `app/config.py`'s default DSN — if `backend/.env` overrides credentials, use those):
  `PGPASSWORD=finance psql -h localhost -p 5433 -U finance -d finance -c "SELECT jsonb_path_query_array('[1,2,3,4,5,6,7,8,9,10,11,12]'::jsonb, '\$[0 to 9]')"`
  Expected: one row, `[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]`. (If psql is not on PATH on this box, skip — the same expression is exercised by no test but is standard PG12+ jsonpath; note the skip in the task report.)
- [ ] Commit: `git add backend/scripts/backup_db.sh .env.example && git commit -m "feat(backup): optional gpg encryption + backup_runs trail in backup_db.sh"`

---

### Task 7: B3 — `refresh_runs` trail in `record_refresh_run`

**Files:**
- `backend/app/services/price_service.py` (constants :34-38; `record_refresh_run` :328-365)
- `backend/tests/test_refresh_runs.py` (new — its own file, so `test_price_service.py`'s import block stays untouched)

- [ ] Write the failing test file `backend/tests/test_refresh_runs.py` (complete file):

```python
"""refresh_runs (2026-08-31 spec §B3): record_refresh_run keeps a last-10 trail alongside
the last_refresh blob — newest first, trimmed at write, self-healing over garbage."""

from datetime import UTC, datetime

from app.models import AppSetting
from app.services.price_service import (
    REFRESH_RUNS_KEY,
    RefreshResult,
    record_refresh_run,
)


async def test_record_refresh_run_appends_newest_first_and_trims_at_ten(db):
    for i in range(12):
        await record_refresh_run(
            db,
            RefreshResult(updated=["VOO"] * i, failed={"ZI": "delisted"} if i % 2 else {}),
            trigger="scheduled" if i % 2 else "manual",
            history_appended=False,
            at=datetime(2026, 8, 1, 12, 0, i, tzinfo=UTC),
        )
        await db.commit()
    setting = await db.get(AppSetting, REFRESH_RUNS_KEY)
    runs = setting.value["value"]  # the Python writers' envelope, like last_refresh
    assert len(runs) == 10
    # Newest first: the 12th write (i=11) leads; the two oldest fell off the end.
    assert runs[0] == {
        "at": "2026-08-01T12:00:11+00:00",
        "trigger": "scheduled",
        "updated": 11,
        "failed_count": 1,
    }
    assert runs[9]["at"] == "2026-08-01T12:00:02+00:00"


async def test_record_refresh_run_starts_fresh_over_a_garbage_runs_row(db):
    db.add(AppSetting(key=REFRESH_RUNS_KEY, value={"value": "not-a-list"}))
    await db.commit()
    await record_refresh_run(
        db,
        RefreshResult(updated=["VOO"]),
        trigger="manual",
        history_appended=False,
        at=datetime(2026, 8, 2, 9, 0, 0, tzinfo=UTC),
    )
    await db.commit()
    setting = await db.get(AppSetting, REFRESH_RUNS_KEY)
    assert setting.value == {
        "value": [
            {
                "at": "2026-08-02T09:00:00+00:00",
                "trigger": "manual",
                "updated": 1,
                "failed_count": 0,
            }
        ]
    }


async def test_record_refresh_run_skips_non_dict_items_when_appending(db):
    db.add(AppSetting(key=REFRESH_RUNS_KEY, value={"value": ["garbage", 42]}))
    await db.commit()
    await record_refresh_run(
        db,
        RefreshResult(),
        trigger="manual",
        history_appended=False,
        at=datetime(2026, 8, 3, 9, 0, 0, tzinfo=UTC),
    )
    await db.commit()
    setting = await db.get(AppSetting, REFRESH_RUNS_KEY)
    assert setting.value["value"] == [
        {"at": "2026-08-03T09:00:00+00:00", "trigger": "manual", "updated": 0, "failed_count": 0}
    ]
```

- [ ] `cd backend && .venv/Scripts/python.exe -m pytest tests/test_refresh_runs.py -q`
  Expected: `ImportError: cannot import name 'REFRESH_RUNS_KEY'`.
- [ ] Implement in `backend/app/services/price_service.py`.
  1. Replace the `LAST_REFRESH_KEY` comment + constant block (:34-38) with:

```python
# app_settings key for the last refresh run's outcome — the status endpoint's and the
# attention strip's feed. "What happened last" stays a single JSON blob; the last-10
# TRAIL lives beside it under REFRESH_RUNS_KEY (2026-08-31 spec §B3) — still app_settings,
# still no migration, history capped at write time.
LAST_REFRESH_KEY = "last_refresh"
REFRESH_RUNS_KEY = "refresh_runs"
REFRESH_RUNS_KEEP = 10
```

  2. In `record_refresh_run` (:328-365): change the docstring's first line to

```python
    """Persist the run's outcome under app_settings[LAST_REFRESH_KEY], envelope
    {"value": ...} (the readers' convention), and append a compact record to
    app_settings[REFRESH_RUNS_KEY] — newest first, last REFRESH_RUNS_KEEP kept, any
    malformed stored shape silently restarted. Caller commits."""
```

  and append this block at the end of the function body, after the existing `setting.value = {"value": payload}` upsert (:361-365):

```python
    run_entry = {
        "at": at.isoformat(),
        "trigger": trigger,
        "updated": len(result.updated),
        "failed_count": len(result.failed),
    }
    runs_setting = await db.get(AppSetting, REFRESH_RUNS_KEY)
    prior: list[dict] = []
    if runs_setting is not None and isinstance(runs_setting.value, dict):
        raw = runs_setting.value.get("value")
        if isinstance(raw, list):
            # Non-dict stragglers are dropped rather than preserved: this trail is an
            # operational nicety, and self-healing beats faithfully re-storing garbage.
            prior = [item for item in raw if isinstance(item, dict)]
    runs_payload = {"value": [run_entry, *prior][:REFRESH_RUNS_KEEP]}
    if runs_setting is None:
        db.add(AppSetting(key=REFRESH_RUNS_KEY, value=runs_payload))
    else:
        runs_setting.value = runs_payload
```

- [ ] `cd backend && .venv/Scripts/python.exe -m pytest tests/test_refresh_runs.py -q`
  Expected: `3 passed`.
- [ ] `cd backend && .venv/Scripts/python.exe -m pytest -q`
  Expected: zero failures (test_price_service's `run_refresh` tests exercise the new block via the real `record_refresh_run`; nothing in them asserts the absence of other app_settings keys).
- [ ] `cd backend && .venv/Scripts/python.exe -m ruff check app tests && .venv/Scripts/python.exe -m ruff format app tests`
  Expected: clean / `N files left unchanged`.
- [ ] Commit: `git add backend/app/services/price_service.py backend/tests/test_refresh_runs.py && git commit -m "feat(prices): refresh_runs last-10 trail alongside last_refresh"`

---

### Task 8: B3 — run trails on `/system/status` + System card rendering

**Files:**
- `backend/app/schemas/system.py` (two new models; `SystemStatusOut` gains two lists)
- `backend/app/api/system.py` (two readers; the response gains the two fields)
- `backend/tests/test_system_api.py` (two new tests; no import changes — `UTC`, `datetime`, `AppSetting` already imported)
- `src/types/api.ts` (two new interfaces; `SystemStatus` :457-464 gains two optional fields)
- `src/components/settings/SystemCard.tsx` (two line-builders + two `<dl>` rows)
- `src/components/settings/SystemCard.test.tsx` (one new test; the quiet-states dash assertion :123 becomes a count)

- [ ] Backend tests first — add to `backend/tests/test_system_api.py`:

```python
async def test_system_runs_lists_round_trip(auth_client, db):
    # backup_runs is a FLAT array (shell writer — backup_status's no-envelope rule);
    # refresh_runs is enveloped (Python writer — record_refresh_run's convention).
    db.add(
        AppSetting(
            key="backup_runs",
            value=[
                {
                    "at": "2026-08-30T03:00:00Z",
                    "ok": True,
                    "object": "backups/finance_2026-08-30.sql.gz.gpg",
                },
                {"at": "2026-08-29T03:00:00Z", "ok": False, "error": "pg_dump: connection refused"},
            ],
        )
    )
    db.add(
        AppSetting(
            key="refresh_runs",
            value={
                "value": [
                    {
                        "at": "2026-08-30T20:10:00+00:00",
                        "trigger": "scheduled",
                        "updated": 36,
                        "failed_count": 2,
                    }
                ]
            },
        )
    )
    await db.commit()
    body = (await auth_client.get(STATUS)).json()
    assert [run["ok"] for run in body["backup_runs"]] == [True, False]
    assert body["backup_runs"][0]["object"] == "backups/finance_2026-08-30.sql.gz.gpg"
    assert body["backup_runs"][1]["error"] == "pg_dump: connection refused"
    assert body["backup_runs"][1]["object"] is None
    # Instants, not strings: pydantic may re-spell the zone ('Z' vs '+00:00').
    assert datetime.fromisoformat(body["backup_runs"][0]["at"]) == datetime(
        2026, 8, 30, 3, 0, 0, tzinfo=UTC
    )
    run = body["refresh_runs"][0]
    assert (run["trigger"], run["updated"], run["failed_count"]) == ("scheduled", 36, 2)
    assert datetime.fromisoformat(run["at"]) == datetime(2026, 8, 30, 20, 10, tzinfo=UTC)


async def test_system_runs_default_empty_and_degrade_on_garbage(auth_client, db):
    body = (await auth_client.get(STATUS)).json()
    assert body["backup_runs"] == []
    assert body["refresh_runs"] == []
    # Wrong container shape, wrong item shape: each reads as "no history", never a 500.
    db.add(AppSetting(key="backup_runs", value={"not": "a list"}))
    db.add(AppSetting(key="refresh_runs", value={"value": [{"at": "yesterday-ish"}]}))
    await db.commit()
    body = (await auth_client.get(STATUS)).json()
    assert body["backup_runs"] == []
    assert body["refresh_runs"] == []
```

- [ ] `cd backend && .venv/Scripts/python.exe -m pytest tests/test_system_api.py -q`
  Expected: the two new tests fail with `KeyError: 'backup_runs'`; the seven existing pass.
- [ ] Implement the schemas — in `backend/app/schemas/system.py`, insert after `BackupStatusOut` (:27-33):

```python
class BackupRunOut(BaseModel):
    """One backup_db.sh run from app_settings['backup_runs'] — a FLAT jsonb array (the
    shell writer's no-envelope rule, same as BackupStatusOut). `object` is absent on
    failed runs; `error` on successful ones."""

    at: datetime
    ok: bool
    object: str | None = None
    error: str | None = None


class RefreshRunOut(BaseModel):
    """One refresh run from app_settings['refresh_runs'] — record_refresh_run's enveloped
    {"value": [...]} list (the Python writers' convention)."""

    at: datetime
    trigger: str
    updated: int
    failed_count: int
```

  and extend `SystemStatusOut` (:35-41) with two fields after `backup`:

```python
    # Last-10 run trails (2026-08-31 spec §B3), newest first. Always lists, never null:
    # any malformed stored shape degrades to [] (the backup-marker posture, list-shaped).
    backup_runs: list[BackupRunOut]
    refresh_runs: list[RefreshRunOut]
```

- [ ] Implement the readers — in `backend/app/api/system.py`:
  1. Extend the schema import (:16-21) with `BackupRunOut,` and `RefreshRunOut,` (alphabetical: after `BackupStatusOut`, `RefreshRunOut` after `PricesStatusOut`).
  2. Add `from app.services.price_service import REFRESH_RUNS_KEY` beside the scheduler import (:22).
  3. After `BACKUP_STATUS_KEY = "backup_status"` (:26) add:

```python
BACKUP_RUNS_KEY = "backup_runs"
RUNS_LIMIT = 10
```

  4. After `_read_backup_status` (:29-40) add the two readers:

```python
async def _read_backup_runs(db: AsyncSession) -> list[BackupRunOut]:
    """app_settings['backup_runs'] — backup_db.sh appends a FLAT jsonb array (newest
    first, trimmed to 10 by the script's own upsert). Whole-list degrade: any malformed
    shape — wrong container, one bad item — reads as no history, never a 500."""
    setting = await db.get(AppSetting, BACKUP_RUNS_KEY)
    if setting is None or not isinstance(setting.value, list):
        return []
    try:
        return [BackupRunOut.model_validate(item) for item in setting.value[:RUNS_LIMIT]]
    except ValueError:
        return []


async def _read_refresh_runs(db: AsyncSession) -> list[RefreshRunOut]:
    """app_settings['refresh_runs'] — record_refresh_run's enveloped {"value": [...]}
    (newest first, trimmed at write). Same whole-list degrade as the backup trail."""
    setting = await db.get(AppSetting, REFRESH_RUNS_KEY)
    if setting is None or not isinstance(setting.value, dict):
        return []
    raw = setting.value.get("value")
    if not isinstance(raw, list):
        return []
    try:
        return [RefreshRunOut.model_validate(item) for item in raw[:RUNS_LIMIT]]
    except ValueError:
        return []
```

  5. Extend the `system_status` return (:59-66) with the two new fields:

```python
    return SystemStatusOut(
        # model_dump-and-extend, not field-by-field: if RefreshStatusOut ever grows a
        # field, the embedded copy inherits it instead of silently dropping it.
        prices=PricesStatusOut(**prices.model_dump(), scheduler_running=is_scheduler_running()),
        database=DatabaseStatusOut(size_bytes=size_bytes, alembic_head=alembic_head),
        backup=await _read_backup_status(db),
        backup_runs=await _read_backup_runs(db),
        refresh_runs=await _read_refresh_runs(db),
        environment=settings.environment,
    )
```

- [ ] `cd backend && .venv/Scripts/python.exe -m pytest tests/test_system_api.py -q`
  Expected: `9 passed`.
- [ ] Frontend test next — in `src/components/settings/SystemCard.test.tsx`:
  1. In the quiet-states test, replace `expect(screen.getByText('—')).toBeDefined()` (:123) with `expect(screen.getAllByText('—')).toHaveLength(3)` — alembic head plus the two empty run trails all render the dash.
  2. Append the new test:

```tsx
it('renders the last-5 run trails compactly', async () => {
  vi.mocked(fetchSystemStatus).mockResolvedValue(
    systemOut({
      backup_runs: [
        { at: '2026-08-30T03:00:00+00:00', ok: true, object: 'backups/finance.sql.gz.gpg' },
        { at: '2026-08-29T03:00:00+00:00', ok: false, error: 'pg_dump: connection refused' },
      ],
      refresh_runs: [
        { at: '2026-08-30T20:10:00+00:00', trigger: 'scheduled', updated: 36, failed_count: 2 },
        { at: '2026-08-29T20:10:00+00:00', trigger: 'manual', updated: 40, failed_count: 0 },
      ],
    }),
  )
  render(<SystemCard />)
  await screen.findByText(
    `${formatDateTime('2026-08-30T03:00:00+00:00')} ok · ` +
      `${formatDateTime('2026-08-29T03:00:00+00:00')} failed`,
  )
  expect(
    screen.getByText(
      `${formatDateTime('2026-08-30T20:10:00+00:00')} 36 updated, 2 failed · ` +
        `${formatDateTime('2026-08-29T20:10:00+00:00')} 40 updated`,
    ),
  ).toBeDefined()
})
```

- [ ] `npx vitest run src/components/settings/SystemCard.test.tsx`
  Expected: the new test fails (`Unable to find an element with the text ...`); the dash-count edit passes only after implementation — run again after the next steps.
- [ ] Extend `src/types/api.ts` — before `export interface SystemStatus` (:457) add:

```typescript
export interface BackupRun {
  at: string
  ok: boolean
  /** The uploaded object key — absent on failed runs. */
  object?: string | null
  error?: string | null
}

export interface RefreshRun {
  at: string
  trigger: string
  updated: number
  failed_count: number
}
```

  and inside `SystemStatus` (after the `backup` field):

```typescript
  /** Last-10 run trails, newest first. Optional, not required: a stale deploy's payload
   *  lacks them and must still parse (the LastRefresh armor); consumers `?? []`. */
  backup_runs?: BackupRun[]
  refresh_runs?: RefreshRun[]
```

  (Optional keeps every existing `SystemStatus` fixture — OverviewPage.test.tsx builds them too — compiling under `tsc -b`.)
- [ ] Extend `src/components/settings/SystemCard.tsx`:
  1. Import the types: extend the type import at :4 to `import type { BackupRun, RefreshRun, SystemStatus } from '../../types/api'`.
  2. Add the two module-scope line-builders beside `refreshLine`/`backupLine` (:14-37):

```tsx
// Compact last-5 trails (spec §B3): one line each, newest first — the server stores 10,
// the card shows what fits on a line. '—' is the empty state, matching the alembic row.
function backupRunsLine(runs: BackupRun[]): string {
  if (runs.length === 0) return '—'
  return runs
    .slice(0, 5)
    .map((run) => `${formatDateTime(run.at)} ${run.ok ? 'ok' : 'failed'}`)
    .join(' · ')
}

function refreshRunsLine(runs: RefreshRun[]): string {
  if (runs.length === 0) return '—'
  return runs
    .slice(0, 5)
    .map(
      (run) =>
        `${formatDateTime(run.at)} ${run.updated} updated${
          run.failed_count > 0 ? `, ${run.failed_count} failed` : ''
        }`,
    )
    .join(' · ')
}
```

  3. In `SystemFacts`, add a row after the Scheduler fact and a row after the Last-backup fact (which Task 2 restructured):

```tsx
      <div className="system-fact">
        <dt>Recent refreshes</dt>
        <dd>{refreshRunsLine(status.refresh_runs ?? [])}</dd>
      </div>
```

  (after Scheduler), and

```tsx
      <div className="system-fact">
        <dt>Recent backups</dt>
        <dd>{backupRunsLine(status.backup_runs ?? [])}</dd>
      </div>
```

  (after Last backup).
- [ ] `npx vitest run src/components/settings/SystemCard.test.tsx`
  Expected: `9 passed`.
- [ ] `cd backend && .venv/Scripts/python.exe -m pytest -q` then `cd backend && .venv/Scripts/python.exe -m ruff check app tests && .venv/Scripts/python.exe -m ruff format app tests`
  Expected: zero failures; lint clean.
- [ ] `npm test` and `npm run lint`
  Expected: zero failures; lint clean.
- [ ] Commit: `git add backend/app/schemas/system.py backend/app/api/system.py backend/tests/test_system_api.py src/types/api.ts src/components/settings/SystemCard.tsx src/components/settings/SystemCard.test.tsx && git commit -m "feat(system): backup/refresh run trails on /system/status and the System card"`

---

### Task 9: B3 — README (Part 5 passphrase + `.gpg` restore; fix §4.2's stale restart claim)

**Files:**
- `README.md` (§4.2 :310-322; §5.3 :374-390; §5.5 :402-421 — verify anchors; earlier plans may have shifted them slightly, search for the section headers)

- [ ] Replace §4.2 (the whole subsection from `### 4.2 Scheduler & settings` through the paragraph ending `on the next page load.`, :310-322). The claim it makes — cron changes need a backend restart — has been false since the hot-apply landed (`backend/app/api/app_settings.py:141` reschedules the live job in the PUT handler), and no settings-form copy claims a restart anymore either. New text:

```markdown
### 4.2 Scheduler & settings

All three settings in **/settings** take effect without a restart. `price_refresh_cron`
is **hot-applied**: saving a new value stores it and reschedules the live scheduler job in
the same request (`backend/app/api/app_settings.py`); boot re-reads the stored value
anyway, so a later restart loses nothing. The other two, `swr_pct` and `espp_ticker`, are
read per request and take effect on the next page load.
```

- [ ] Extend §5.3. After the paragraph ending `so it must match the bucket's region exactly.` (:376-380) and before the ```bash install/test block, insert:

```markdown
Optionally add `BACKUP_PASSPHRASE` to the same `.env` to encrypt every dump before upload
(`gpg --symmetric --cipher-algo AES256`; objects land as `.sql.gz.gpg`). Generate one with
`openssl rand -base64 32` and keep a copy somewhere **off this server** — without the
passphrase an encrypted backup is unrecoverable. Leaving it unset keeps plaintext dumps
and prints a one-line warning per run. The encrypted path is exercised here, on the
server, the first time you run the script after setting it — the dev box has no OCI
credentials, so this check happens at deploy time by design.
```

  Then update the expected-output paragraph (:388-390). Replace:

```markdown
Expected output ends with `Backup complete.`; the object
`backups/finance_<date>.sql.gz` appears in the bucket. The script keeps 30 days of
backups (each run deletes the dump from 30 days prior).
```

  with:

```markdown
Expected output ends with `Backup complete.`; the object
`backups/finance_<date>.sql.gz` (`.sql.gz.gpg` when `BACKUP_PASSPHRASE` is set) appears
in the bucket. The script keeps 30 days of backups — each run deletes both flavors of the
dump from 30 days prior — and records the run for the Settings System card (the
`Last backup` marker plus a last-10 trail).
```

- [ ] Extend §5.5's restore drill. Replace the first code-block lines (:404-406):

```bash
# Download a backup: bucket → object → Download (or scp it to the server)
gunzip finance_<date>.sql.gz
```

  with:

```bash
# Download a backup: bucket → object → Download (or scp it to the server)
# Plaintext backups:
gunzip finance_<date>.sql.gz
# Encrypted backups (.sql.gz.gpg) — gpg prompts for BACKUP_PASSPHRASE, or pipe straight
# into the restore: gpg --decrypt finance_<date>.sql.gz.gpg | gunzip | psql ...
gpg --decrypt finance_<date>.sql.gz.gpg | gunzip > finance_<date>.sql
```

- [ ] Read the three edited sections top to bottom once — no other §4/§5 sentence still claims a restart is needed or that only `.sql.gz` objects exist.
- [ ] Commit: `git add README.md && git commit -m "docs(readme): backup passphrase + gpg restore; fix stale cron-restart claim"`

---

### Task 10: Final gate

**Files:** none.

- [ ] `cd backend && .venv/Scripts/python.exe -m pytest -q`
  Expected: baseline + 14 backend tests (4 export, 2 net-worth delete, 3 spending delete, 3 refresh-runs, 2 system-runs), zero failures.
- [ ] `cd backend && .venv/Scripts/python.exe -m ruff check app tests && .venv/Scripts/python.exe -m ruff format app tests`
  Expected: clean / `N files left unchanged`.
- [ ] `npm test`
  Expected: baseline + 6 frontend tests (2 SystemCard download, 3 wizard delete, 1 SystemCard trails), zero failures.
- [ ] `npm run lint`
  Expected: clean exit.
- [ ] `bash -n backend/scripts/backup_db.sh`
  Expected: silent, exit 0.
- [ ] Report the final counts. Do not merge — the orchestrator owns the `tier1-batch` → `main` merge after Plan D.

---

## Self-Review (performed)

**Spec coverage, B1–B3 → tasks:**

| Spec requirement | Task |
| --- | --- |
| B1: `backend/app/api/export.py` at `/api/v1/export`, auth-gated, registered in `main.py` | Task 1 |
| B1: `GET /export/snapshot` → StreamingResponse, `finance-export-YYYYMMDD-HHMM.zip`, Content-Disposition attachment | Task 1 |
| B1: manifest.json — UTC ISO timestamp, environment, alembic head (system router's query), app version note, row-count map | Task 1 |
| B1: `csv/<table>.csv` — RFC-4180, model-definition column order, ISO dates, plain-string Decimals, true/false booleans, NULL = empty cell | Task 1 (`_csv_cell`, pinned in `test_export_rows_round_trip_with_pinned_formats`) |
| B1: `finance-export.json` — `{exported_at, alembic_head, tables:{...}}` nested | Task 1 |
| B1: hand-maintained (model, table) list; test pins it against `Base.metadata`; `users` + `alembic_version` excluded | Task 1 (`EXPORTED_TABLES` = 34 pairs, `EXCLUDED_TABLES = {"users"}`, `test_export_list_pins_every_metadata_table`) |
| B1: ZIP via `zipfile` into `BytesIO` | Task 1 |
| B1 tests: 401 unauthenticated; manifest + CSV-per-table + JSON; counts match; pin; seeded round-trip in both formats | Task 1 (all five present) |
| B1 frontend: `downloadSnapshot()` — Bearer fetch, blob → objectURL → anchor click, filename from Content-Disposition | Task 2 |
| B1 frontend: "Download snapshot (.zip)" button beside the backup row, busy state, error via the card's error pattern | Task 2 (dedicated `downloadError` so a failure can't unmount the facts — the card's `error` gate would) |
| B2: `DELETE /net-worth/months/{month}` — snapshot + cascade, 404 when absent, PUT-identical month validation, 204 | Task 3 |
| B2: `DELETE /spending/months/{month}` — spending rows AND cashflow, 404 when neither exists, 204 | Task 4 |
| B2: `net_worth.py:366-373` refusal comment corrected | Task 3 |
| B2: wizard Review-step Danger row gated on `monthExisted`; typed-YYYY-MM arm; BOTH deletes each tolerating its own 404; draft cleared; success toast; navigate to `/update` current month | Task 5 (`/update` is the page's own route — "navigate" = param reset to `currentMonthIso()` + `loadNonce` refetch for the same-month case; ribbon/pages refresh via the client's existing non-GET snapshot invalidation) |
| B2 tests: backend delete/404/format + timeseries & matrix disappearance; frontend arming, both calls, draft cleared | Tasks 3, 4, 5 |
| B3: `BACKUP_PASSPHRASE` → gpg AES256 symmetric, `.sql.gz.gpg`, warning when unset, retention handles both suffixes, documented in `.env.example` | Task 6 |
| B3: `backup_status` shape KEPT; `backup_runs` last-10 `{at, ok, object, error?}` append-and-trim in the same psql step | Task 6 (success append rides the same psql call group as `backup_status`; an ERR trap best-efforts the `{ok:false}` records the `error?` field implies) |
| B3: `record_refresh_run` keeps `last_refresh`; adds `refresh_runs` last-10 `{at, trigger, updated, failed_count}` | Task 7 |
| B3: `GET /system/status` gains `backup_runs`/`refresh_runs`, degrade to `[]` on malformed | Task 8 |
| B3: SystemCard compact "last 5 runs" lines (time + ok/fail + counts) | Task 8 |
| B3: README Part 5 passphrase setup + `.gpg` restore line; §4.2 stale restart claim fixed (`app_settings.py:141` hot-apply) | Task 9 |
| B3: script validated by hand on the box — README note; plan-side `bash -n` | Tasks 6 + 9 |
| "Run backup now" OUT of scope | honored — no task builds it |

**Exported-table list (34, spec order, cross-checked against every model file):** accounts, net_worth_snapshots, account_balances, spending_categories, monthly_spending, monthly_cashflow, category_budgets, securities, portfolio_accounts, position_transactions, dividend_payments, latest_prices, price_history, security_dividend_events, portfolio_value_history, tax_years, tax_brackets, tax_input_definitions, tax_inputs, espp_lots, espp_periods, espp_offerings, paycheck_profiles, comp_events, rsu_grants, credit_cards, card_credits, reward_categories, reward_rates, credit_limit_events, contribution_limits, custom_events, people, app_settings. Excluded: users (named in `EXCLUDED_TABLES`), alembic_version (not a metadata table). `models/__init__.py` exports exactly these 34 models plus `User` — the pin test proves the equality at runtime.

**Placeholder scan:** no `TODO`, no `...`-elided code, no "as in Task N" cross-references — every file's code is written out in full where it is used (the backup script and `system.ts` are complete-file replacements; router/wizard edits quote both the landmark being replaced and the replacement). The two deliberate non-literal spots are verification-shaped, not placeholders: Task 0 records baseline counts instead of pinning integers (A and C moved them), and Task 5/9 anchors are quoted-landmark + "verify at implementation time" because Plan A edits `MonthlyUpdatePage.tsx` first (execution order A → C → B → D) and earlier tasks may shift README lines.

**Type/name consistency (checked across tasks):** backend `BackupRunOut`/`RefreshRunOut` (schemas/system.py, imported by api/system.py Task 8) ↔ frontend `BackupRun`/`RefreshRun` (types/api.ts) — same field names (`at`, `ok`, `object`, `error` / `at`, `trigger`, `updated`, `failed_count`); `REFRESH_RUNS_KEY` defined once in price_service.py (Task 7) and imported by api/system.py (Task 8), value `"refresh_runs"` matching the Task 8 tests' seeded key; `BACKUP_RUNS_KEY = "backup_runs"` matches the script's psql key (Task 6) and the Task 8 tests; the script writes `backup_runs` FLAT while `record_refresh_run` writes `refresh_runs` enveloped, and the two readers in Task 8 expect exactly that asymmetry (documented in both docstrings); `EXPORTED_TABLES`/`EXCLUDED_TABLES` names match between export.py and test_export_api.py; `downloadSnapshot`/`deleteMonthBalances`/`deleteSpendingMonth` names match between the api modules, the page imports, and both test files' mock factories; wizard toast copy `` `Deleted ${formatMonth(month)} — balances and spending removed.` `` is byte-identical between implementation (Task 5 step 4) and test; `danger-button`/`danger-zone`/`danger-row` class names match between TSX and CSS; SystemCard trail copy (`ok`/`failed`, `N updated, M failed`, `·` separator, `—` empty) matches builder and test string for string.

**Code-vs-spec reconciliations made while planning (no relitigated decisions):** (1) the spec's manifest "app version note" has no version source in the repo (no version in `pyproject.toml` or config) — the manifest carries `app` + a fixed `note` string instead of a fabricated number; (2) `backup_runs` failure records: the spec shape `{at, ok, object, error?}` implies failed runs exist in the trail, but the success-path psql only runs after an upload — an ERR trap records the `ok:false` entries best-effort without changing the script's exit behavior; (3) "navigates to `/update`" — the wizard already lives at `/update` with the month as a query param, so navigation is a param reset plus a `loadNonce`-forced refetch (covers deleting the current month, where `[month]` alone would never re-run); (4) frontend `SystemStatus.backup_runs`/`refresh_runs` are optional (`?:`) rather than required so `tsc -b` keeps passing over the pre-existing fixtures in `OverviewPage.test.tsx` — the server always sends them, consumers `?? []` (the house `LastRefresh` armor).
