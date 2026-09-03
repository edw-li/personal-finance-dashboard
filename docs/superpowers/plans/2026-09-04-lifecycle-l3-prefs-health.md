# Data lifecycle L3 — Server-side preferences and data health checks — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `docs/superpowers/specs/2026-09-03-data-lifecycle-design.md` §10 and §11 on the server: the preference registry (five keys, per-key shape, `landing_page` over the nav paths) behind `GET /prefs`, `PATCH /prefs` (partial) and `DELETE /prefs/{key}`; the seven health checks of §11's table computed by `health_checks.run_checks` and served by `GET /system/health`, each with its fix descriptor (a link, or the `delete_spending_month` / `snapshot_now` action the F2 card runs).

**Architecture:** `services/prefs_registry.py` is a dict of `PrefSpec(key, default, validate)`; the router validates every key before writing any, upserts `UserPreference(user_id, key)` rows with a Python-side `updated_at`, and answers the registered keys that exist. `services/health_checks.py` is one small async function per check (one query each, `now` injected) plus `run_checks`; `api/health.py` mounts `GET /system/health` on its own router with the `/system` prefix (L4 edits `api/system.py`; two routers, one prefix, no file conflict). The repair itself is L2's spending DELETE with `X-Change-Source: repair` — this lane only names it.

**Tech Stack:** FastAPI, SQLAlchemy 2.0 async, Pydantic 2 (Phase 0's `PrefsOut`, `HealthOut` family).

**Worktree / commands:** Branch `lifecycle-l3` from main AFTER `lifecycle-base` merged. Backend from `<worktree>/backend`:
`FINANCE_TEST_DB=finance_test_l3 ../../../backend/.venv/Scripts/python.exe -m pytest tests/<file> -q`
(`<venv-python>` = that interpreter.) Nothing frontend in this lane.

---

## File structure

| File | Responsibility |
|---|---|
| `backend/app/services/prefs_registry.py` (new) | `PREF_REGISTRY`, `PrefSpec`, `validate_pref`, `PrefValueError`, `NAV_PATHS` |
| `backend/tests/test_prefs_registry.py` (new) | per-key validation; the nav-path pin against `src/components/navItems.ts` |
| `backend/app/api/prefs.py` (new) | `GET /prefs`, `PATCH /prefs`, `DELETE /prefs/{key}` |
| `backend/tests/test_prefs_api.py` (new) | auth, empty, partial patch, 422s, delete resets, per-user rows, export includes the row |
| `backend/app/services/health_checks.py` (new) | the seven checks + `run_checks` |
| `backend/tests/test_health_checks.py` (new) | each check on seeded fixtures |
| `backend/app/api/health.py` (new) | `GET /system/health` |
| `backend/tests/test_system_health_api.py` (new) | auth, shape, settings pass-through |
| `backend/app/main.py` (modify) | include both routers |

---

### Task 1: The preference registry

**Files:**
- Create: `backend/app/services/prefs_registry.py`
- Test: `backend/tests/test_prefs_registry.py`

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_prefs_registry.py
import re
from pathlib import Path

import pytest

from app.services.prefs_registry import (
    NAV_PATHS,
    PALETTE_RECENTS_MAX,
    PREF_REGISTRY,
    PrefValueError,
    validate_pref,
)

NAV_ITEMS_TS = Path(__file__).resolve().parents[2] / "src" / "components" / "navItems.ts"


def test_registry_lists_exactly_the_five_keys_with_consumers():
    # Only keys with a consumer are registered (spec §10); the audit's other candidates
    # (currency style, liability sign, fiscal-year start) wait for theirs.
    assert set(PREF_REGISTRY) == {"theme", "density", "scope", "palette_recents", "landing_page"}
    assert PREF_REGISTRY["theme"].default == "dark"
    assert PREF_REGISTRY["density"].default == "comfortable"
    assert PREF_REGISTRY["scope"].default == {"owner": "all", "range": "1y"}
    assert PREF_REGISTRY["palette_recents"].default == []
    assert PREF_REGISTRY["landing_page"].default == "/"


def test_nav_paths_pin_the_frontend_registry():
    # The twin of src/components/navItems.ts NAV_ITEMS — the one place the app's routes are
    # listed; a page added there without a matching entry here fails until it is.
    source = NAV_ITEMS_TS.read_text(encoding="utf-8")
    frontend = set(re.findall(r"to: '([^']+)'", source))
    assert frontend == set(NAV_PATHS)
    assert NAV_PATHS[0] == "/"


@pytest.mark.parametrize(
    ("key", "good", "bad", "message"),
    [
        ("theme", "light", "neon", "must be one of system, dark, light"),
        ("density", "compact", "huge", "must be one of comfortable, compact"),
        ("landing_page", "/net-worth", "/nope", "must be one of /, /update"),
        ("scope", {"owner": "joint", "range": "ytd"}, {"owner": "bob", "range": "ytd"}, "owner must be all, joint or a person id"),
        ("scope", {"owner": 2, "range": "all"}, {"owner": 2, "range": "5y"}, "range must be one of all, 1y, ytd"),
        ("scope", {"owner": "all", "range": "1y"}, {"owner": "all"}, "must be an object with owner and range"),
        ("palette_recents", ["nav:/", "action:refresh-prices"], ["x"] * (PALETTE_RECENTS_MAX + 1), "at most 8"),
        ("palette_recents", [], [1, 2], "at most 8"),
    ],
)
def test_validate_pref_normalizes_good_values_and_names_the_bad_ones(key, good, bad, message):
    assert validate_pref(key, good) == good
    with pytest.raises(PrefValueError, match=re.escape(message)):
        validate_pref(key, bad)


def test_validate_pref_refuses_the_wrong_shape_and_unknown_keys():
    with pytest.raises(PrefValueError):
        validate_pref("theme", 3)
    with pytest.raises(PrefValueError):
        validate_pref("scope", {"owner": True, "range": "1y"})  # a bool is not a person id
    with pytest.raises(PrefValueError):
        validate_pref("scope", {"owner": 0, "range": "1y"})
    with pytest.raises(KeyError):
        validate_pref("currency_style", "compact")
```

- [ ] **Step 2: Run to verify they fail**

Run: `FINANCE_TEST_DB=finance_test_l3 <venv-python> -m pytest tests/test_prefs_registry.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.prefs_registry'`.

- [ ] **Step 3: Write the registry**

```python
# backend/app/services/prefs_registry.py
"""Preference registry (2026-09-03 data-lifecycle spec §10): key → shape + default.

Only keys with a CONSUMER are registered — theme/density (ThemeProvider), scope (useScope's
memory), palette_recents (the command palette), landing_page (App's first-arrival redirect).
The audit's other candidates wait for theirs. Values are stored as JSONB exactly as
validated here; the router turns PrefValueError into a 422 that names the key.
"""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any


class PrefValueError(ValueError):
    """The value does not fit the key's shape; the message is the router's 422 detail."""


# Twin of src/components/navItems.ts NAV_ITEMS (every `to:`), pinned by test_prefs_registry.
NAV_PATHS: tuple[str, ...] = (
    "/",
    "/update",
    "/net-worth",
    "/portfolio",
    "/spending",
    "/credit-cards",
    "/paycheck",
    "/comp",
    "/espp",
    "/taxes",
    "/projection",
    "/calendar",
    "/settings",
)
THEMES = ("system", "dark", "light")
DENSITIES = ("comfortable", "compact")
RANGES = ("all", "1y", "ytd")
PALETTE_RECENTS_MAX = 8


def _one_of(allowed: tuple[str, ...]) -> Callable[[Any], Any]:
    def validate(value: Any) -> Any:
        if not isinstance(value, str) or value not in allowed:
            raise PrefValueError(f"must be one of {', '.join(allowed)}")
        return value

    return validate


def _person_id(value: Any) -> bool:
    # bool subclasses int: True would otherwise read as person 1.
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def _scope(value: Any) -> Any:
    if not isinstance(value, dict) or set(value) != {"owner", "range"}:
        raise PrefValueError("must be an object with owner and range")
    owner = value["owner"]
    if owner not in ("all", "joint") and not _person_id(owner):
        raise PrefValueError("owner must be all, joint or a person id")
    if value["range"] not in RANGES:
        raise PrefValueError(f"range must be one of {', '.join(RANGES)}")
    return {"owner": owner, "range": value["range"]}


def _recents(value: Any) -> Any:
    ok = (
        isinstance(value, list)
        and len(value) <= PALETTE_RECENTS_MAX
        and all(isinstance(item, str) and 0 < len(item) <= 120 for item in value)
    )
    if not ok:
        raise PrefValueError(f"must be a list of at most {PALETTE_RECENTS_MAX} entry ids")
    return value


@dataclass(frozen=True)
class PrefSpec:
    key: str
    default: Any
    validate: Callable[[Any], Any]


PREF_REGISTRY: dict[str, PrefSpec] = {
    spec.key: spec
    for spec in (
        PrefSpec("theme", "dark", _one_of(THEMES)),
        PrefSpec("density", "comfortable", _one_of(DENSITIES)),
        PrefSpec("scope", {"owner": "all", "range": "1y"}, _scope),
        PrefSpec("palette_recents", [], _recents),
        PrefSpec("landing_page", "/", _one_of(NAV_PATHS)),
    )
}


def validate_pref(key: str, value: Any) -> Any:
    """The normalized value, or PrefValueError; KeyError for a key that is not registered."""
    return PREF_REGISTRY[key].validate(value)
```

- [ ] **Step 4: Run the tests**

Run: `FINANCE_TEST_DB=finance_test_l3 <venv-python> -m pytest tests/test_prefs_registry.py -q`
Expected: 12 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/prefs_registry.py backend/tests/test_prefs_registry.py
git commit -m "feat(prefs): registry — five keys, shapes, defaults, nav-path pin"
```

---

### Task 2: `GET/PATCH /prefs`, `DELETE /prefs/{key}`

**Files:**
- Create: `backend/app/api/prefs.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_prefs_api.py`

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_prefs_api.py
import io
import json
import zipfile
from datetime import datetime

from sqlalchemy import select

from app.models import User, UserPreference
from app.security import hash_password

PREFS = "/api/v1/prefs"


async def test_prefs_require_auth(client):
    assert (await client.get(PREFS)).status_code == 401
    assert (await client.patch(PREFS, json={"theme": "dark"})).status_code == 401
    assert (await client.delete(f"{PREFS}/theme")).status_code == 401


async def test_prefs_start_empty_and_patch_partially(auth_client):
    assert (await auth_client.get(PREFS)).json() == {"prefs": {}}
    resp = await auth_client.patch(PREFS, json={"theme": "light", "scope": {"owner": "joint", "range": "ytd"}})
    assert resp.status_code == 200, resp.text
    body = resp.json()["prefs"]
    assert set(body) == {"theme", "scope"}
    assert body["theme"]["value"] == "light"
    assert body["scope"]["value"] == {"owner": "joint", "range": "ytd"}
    first_stamp = datetime.fromisoformat(body["theme"]["updated_at"])
    # A later partial PATCH touches only its key — and only that key's updated_at moves.
    again = (await auth_client.patch(PREFS, json={"density": "compact"})).json()["prefs"]
    assert set(again) == {"theme", "scope", "density"}
    assert datetime.fromisoformat(again["theme"]["updated_at"]) == first_stamp
    bumped = (await auth_client.patch(PREFS, json={"theme": "system"})).json()["prefs"]
    assert bumped["theme"]["value"] == "system"
    assert datetime.fromisoformat(bumped["theme"]["updated_at"]) >= first_stamp
    assert (await auth_client.get(PREFS)).json()["prefs"] == bumped


async def test_patch_validates_every_key_before_writing_any(auth_client):
    resp = await auth_client.patch(PREFS, json={"theme": "light", "currency_style": "compact"})
    assert resp.status_code == 422
    assert resp.json()["detail"] == "Unknown preference `currency_style`"
    bad = await auth_client.patch(PREFS, json={"theme": "light", "landing_page": "/nope"})
    assert bad.status_code == 422
    assert bad.json()["detail"].startswith("landing_page: must be one of /, /update")
    assert (await auth_client.get(PREFS)).json() == {"prefs": {}}  # nothing was written
    empty = await auth_client.patch(PREFS, json={})
    assert empty.status_code == 422 and empty.json()["detail"] == "Send at least one preference"


async def test_delete_resets_a_key_and_ignores_an_unset_one(auth_client, db, seeded_user):
    await auth_client.patch(PREFS, json={"landing_page": "/net-worth", "theme": "light"})
    assert (await auth_client.delete(f"{PREFS}/landing_page")).status_code == 204
    assert set((await auth_client.get(PREFS)).json()["prefs"]) == {"theme"}
    assert (await auth_client.delete(f"{PREFS}/landing_page")).status_code == 204  # idempotent
    unknown = await auth_client.delete(f"{PREFS}/currency_style")
    assert unknown.status_code == 422 and unknown.json()["detail"] == "Unknown preference `currency_style`"
    rows = (await db.execute(select(UserPreference))).scalars().all()
    assert [(r.user_id, r.key) for r in rows] == [(seeded_user.id, "theme")]


async def test_rows_are_per_user(auth_client, db, seeded_user):
    other = User(email="other@example.com", password_hash=hash_password("correct-horse"))
    db.add(other)
    await db.flush()
    db.add(UserPreference(user_id=other.id, key="theme", value="system"))
    await db.commit()
    await auth_client.patch(PREFS, json={"theme": "light"})
    assert (await auth_client.get(PREFS)).json()["prefs"]["theme"]["value"] == "light"
    rows = (await db.execute(select(UserPreference).order_by(UserPreference.user_id))).scalars().all()
    assert [(r.user_id, r.value) for r in rows] == [(seeded_user.id, "light"), (other.id, "system")]


async def test_unregistered_rows_are_not_served(auth_client, db, seeded_user):
    db.add(UserPreference(user_id=seeded_user.id, key="retired_key", value=1))
    db.add(UserPreference(user_id=seeded_user.id, key="theme", value="dark"))
    await db.commit()
    assert set((await auth_client.get(PREFS)).json()["prefs"]) == {"theme"}


async def test_preferences_ride_the_export(auth_client, seeded_user):
    await auth_client.patch(PREFS, json={"theme": "light"})
    resp = await auth_client.get("/api/v1/export/snapshot")
    archive = zipfile.ZipFile(io.BytesIO(resp.content))
    nested = json.loads(archive.read("finance-export.json"))
    rows = nested["tables"]["user_preferences"]
    assert len(rows) == 1 and rows[0]["key"] == "theme" and rows[0]["value"] == "light"
    assert rows[0]["user_id"] == seeded_user.id
```

- [ ] **Step 2: Run to verify they fail**

Run: `FINANCE_TEST_DB=finance_test_l3 <venv-python> -m pytest tests/test_prefs_api.py -q`
Expected: FAIL — 404s (no router).

- [ ] **Step 3: Write the router**

```python
# backend/app/api/prefs.py
"""Server-side preferences (2026-09-03 data-lifecycle spec §10): one row per (user, key)
with its own updated_at — the clock two devices reconcile by. GET answers the registered
keys that exist; PATCH is PARTIAL (only the keys sent are upserted) and validates every key
before writing any; DELETE resets one key by removing its row. No trailing slash on the
prefix routes (the /settings and /household precedent — "/prefs/" would cost a 307)."""

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models import User, UserPreference
from app.schemas.lifecycle import PrefEntryOut, PrefsOut
from app.services.prefs_registry import PREF_REGISTRY, PrefValueError, validate_pref

router = APIRouter(prefix="/prefs", tags=["prefs"])


async def _read(db: AsyncSession, user_id: int) -> PrefsOut:
    rows = (
        await db.execute(select(UserPreference).where(UserPreference.user_id == user_id))
    ).scalars()
    return PrefsOut(
        prefs={
            row.key: PrefEntryOut(value=row.value, updated_at=row.updated_at)
            for row in rows
            if row.key in PREF_REGISTRY  # a retired key's row is not served
        }
    )


@router.get("", response_model=PrefsOut)
async def get_prefs(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> PrefsOut:
    return await _read(db, user.id)


@router.patch("", response_model=PrefsOut)
async def patch_prefs(
    body: dict[str, Any],
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PrefsOut:
    if not body:
        raise HTTPException(status_code=422, detail="Send at least one preference")
    validated: dict[str, Any] = {}
    for key, value in body.items():
        try:
            validated[key] = validate_pref(key, value)
        except KeyError:
            raise HTTPException(status_code=422, detail=f"Unknown preference `{key}`") from None
        except PrefValueError as exc:
            raise HTTPException(status_code=422, detail=f"{key}: {exc}") from None
    now = datetime.now(UTC)
    for key, value in validated.items():
        row = await db.get(UserPreference, (user.id, key))
        if row is None:
            db.add(UserPreference(user_id=user.id, key=key, value=value, updated_at=now))
        else:
            row.value = value
            row.updated_at = now
    await db.commit()
    return await _read(db, user.id)


@router.delete("/{key}", status_code=204)
async def delete_pref(
    key: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> Response:
    if key not in PREF_REGISTRY:
        raise HTTPException(status_code=422, detail=f"Unknown preference `{key}`")
    row = await db.get(UserPreference, (user.id, key))
    if row is not None:
        await db.delete(row)
        await db.commit()
    return Response(status_code=204)
```

In `backend/app/main.py` add `prefs,` to the `from app.api import (...)` list (after `portfolio`) and `app.include_router(prefs.router, prefix="/api/v1")` after the `app_settings` include.

- [ ] **Step 4: Run the tests**

Run: `FINANCE_TEST_DB=finance_test_l3 <venv-python> -m pytest tests/test_prefs_api.py -q`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/prefs.py backend/app/main.py backend/tests/test_prefs_api.py
git commit -m "feat(api): GET/PATCH /prefs and DELETE /prefs/{key} over the registry"
```

---

### Task 3: The health checks

**Files:**
- Create: `backend/app/services/health_checks.py`
- Test: `backend/tests/test_health_checks.py`

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_health_checks.py
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

from app.models import (
    Account,
    AccountBalance,
    AppSetting,
    LatestPrice,
    MonthlyCashflow,
    MonthlySpending,
    NetWorthSnapshot,
    Security,
    SpendingCategory,
)
from app.services.health_checks import (
    BACKUP_ERROR_DAYS,
    BACKUP_WARN_HOURS,
    SNAPSHOT_WARN_HOURS,
    STALE_QUOTE_DAYS,
    check_backup,
    check_coverage_gaps,
    check_identical_snapshot,
    check_snapshot,
    check_stale_quotes,
    check_zero_filled_spending,
    run_checks,
)
from app.services.snapshot import snapshots_dir

NOW = datetime(2026, 9, 4, 12, 0, tzinfo=UTC)


async def categories(db) -> tuple[SpendingCategory, SpendingCategory]:
    food = SpendingCategory(name="Food", slug="food", sort_order=1)
    rent = SpendingCategory(name="Rent", slug="rent", sort_order=2)
    db.add_all([food, rent])
    await db.flush()
    return food, rent


def test_thresholds_are_the_frontend_twins():
    # src/utils/staleness.ts: STALE_AFTER_DAYS = 4, BACKUP_STALE_HOURS = 48, BACKUP_OVERDUE_DAYS = 7.
    assert (STALE_QUOTE_DAYS, BACKUP_WARN_HOURS, BACKUP_ERROR_DAYS, SNAPSHOT_WARN_HOURS) == (4, 48, 7, 36)


async def test_zero_filled_spending_names_the_phantom_month_with_a_repair_action(db):
    food, rent = await categories(db)
    # September: every row $0.00, no take-home — the audit's phantom month.
    db.add_all(
        [
            MonthlySpending(month=date(2026, 9, 1), category_id=food.id, amount=Decimal("0.00")),
            MonthlySpending(month=date(2026, 9, 1), category_id=rent.id, amount=Decimal("0.00")),
            # August: zeros but WITH a cashflow row — a real month of no spending, not a phantom.
            MonthlySpending(month=date(2026, 8, 1), category_id=food.id, amount=Decimal("0.00")),
            MonthlyCashflow(month=date(2026, 8, 1), net_pay=Decimal("5000.00")),
            # July: real amounts.
            MonthlySpending(month=date(2026, 7, 1), category_id=food.id, amount=Decimal("400.00")),
        ]
    )
    await db.commit()
    check = await check_zero_filled_spending(db)
    assert check.severity == "error" and check.count == 1 and check.months == [date(2026, 9, 1)]
    assert check.title == "Zero-filled spending month"
    assert "Sep 2026" in check.detail
    assert check.fix is not None and (check.fix.kind, check.fix.action) == ("action", "delete_spending_month")
    await db.execute(MonthlySpending.__table__.delete().where(MonthlySpending.month == date(2026, 9, 1)))
    await db.commit()
    assert (await check_zero_filled_spending(db)).severity == "ok"


async def test_coverage_gaps_look_back_twelve_months_and_skip_the_current(db):
    food, _ = await categories(db)
    account = Account(name="A", slug="a", group="cash", sort_order=1)
    db.add(account)
    await db.flush()
    for month in (date(2026, 8, 1), date(2026, 7, 1), date(2025, 8, 1), date(2026, 9, 1)):
        snapshot = NetWorthSnapshot(month=month)
        db.add(snapshot)
        await db.flush()
        db.add(AccountBalance(snapshot_id=snapshot.id, account_id=account.id, balance=Decimal("1.00")))
    db.add(MonthlySpending(month=date(2026, 7, 1), category_id=food.id, amount=Decimal("1.00")))
    db.add(MonthlySpending(month=date(2026, 6, 1), category_id=food.id, amount=Decimal("1.00")))
    await db.commit()
    without_spending, without_balances = await check_coverage_gaps(db, today=NOW.date())
    # August has balances and no spending; September is the CURRENT month and is skipped;
    # Aug 2025 is outside the twelve-month window.
    assert without_spending.severity == "warn" and without_spending.months == [date(2026, 8, 1)]
    assert without_spending.fix is not None
    assert (without_spending.fix.kind, without_spending.fix.to) == ("link", "/update?month=2026-08-01&step=spending")
    assert without_balances.severity == "warn" and without_balances.months == [date(2026, 6, 1)]
    assert without_balances.fix.to == "/update?month=2026-06-01&step=balances"


async def test_stale_quotes_counts_active_auto_priced_securities_only(db):
    fresh = Security(ticker="AAA", name="A", holding_type="stock")
    stale = Security(ticker="BBB", name="B", holding_type="stock")
    manual = Security(ticker="CCC", name="C", holding_type="private", is_manual_priced=True)
    retired = Security(ticker="DDD", name="D", holding_type="stock", is_active=False)
    db.add_all([fresh, stale, manual, retired])
    await db.flush()
    old = NOW - timedelta(days=STALE_QUOTE_DAYS + 1)
    db.add_all(
        [
            LatestPrice(security_id=fresh.id, price=Decimal("1"), quoted_at=NOW - timedelta(days=1), source="yfinance"),
            LatestPrice(security_id=stale.id, price=Decimal("1"), quoted_at=old, source="yfinance"),
            LatestPrice(security_id=manual.id, price=Decimal("1"), quoted_at=old, source="manual"),
            LatestPrice(security_id=retired.id, price=Decimal("1"), quoted_at=old, source="yfinance"),
        ]
    )
    await db.commit()
    check = await check_stale_quotes(db, now=NOW)
    assert check.severity == "warn" and check.count == 1
    assert "BBB" in check.detail and check.fix.to == "/portfolio"


async def test_identical_snapshot_is_an_info_with_a_link_to_the_latest_month(db):
    account = Account(name="A", slug="a", group="cash", sort_order=1)
    db.add(account)
    await db.flush()
    for month in (date(2026, 7, 1), date(2026, 8, 1)):
        snapshot = NetWorthSnapshot(month=month)
        db.add(snapshot)
        await db.flush()
        db.add(AccountBalance(snapshot_id=snapshot.id, account_id=account.id, balance=Decimal("100.00")))
    await db.commit()
    check = await check_identical_snapshot(db)
    assert check.severity == "info" and check.months == [date(2026, 8, 1)]
    assert check.fix.to == "/update?month=2026-08-01"


async def test_backup_check_is_info_off_prod_and_grades_the_marker_on_prod(db):
    assert (await check_backup(db, now=NOW, environment="dev")).severity == "info"
    absent = await check_backup(db, now=NOW, environment="prod")
    assert absent.severity == "error" and absent.fix.to == "/settings#backups"
    marker = AppSetting(
        key="backup_status",
        value={"last_success_at": (NOW - timedelta(hours=3)).isoformat(), "object_key": "k", "size": "108K", "verified": True},
    )
    db.add(marker)
    await db.commit()
    assert (await check_backup(db, now=NOW, environment="prod")).severity == "ok"
    marker.value = {**marker.value, "verified": False, "verify_error": "row count mismatch"}
    await db.commit()
    unverified = await check_backup(db, now=NOW, environment="prod")
    assert unverified.severity == "warn" and "row count mismatch" in unverified.detail
    marker.value = {"last_success_at": (NOW - timedelta(hours=BACKUP_WARN_HOURS + 1)).isoformat(), "object_key": "k", "size": "1M"}
    await db.commit()
    assert (await check_backup(db, now=NOW, environment="prod")).severity == "warn"
    marker.value = {"last_success_at": (NOW - timedelta(days=BACKUP_ERROR_DAYS + 1)).isoformat(), "object_key": "k", "size": "1M"}
    await db.commit()
    assert (await check_backup(db, now=NOW, environment="prod")).severity == "error"


def test_snapshot_check_reads_the_stored_files():
    assert check_snapshot(now=NOW, snapshot_enabled=False).severity == "ok"
    none_yet = check_snapshot(now=NOW, snapshot_enabled=True)
    assert none_yet.severity == "warn" and (none_yet.fix.kind, none_yet.fix.action) == ("action", "snapshot_now")
    directory = snapshots_dir()
    directory.mkdir(parents=True)
    (directory / "finance-export-20260902-233000.zip").write_bytes(b"x")  # 36h+ before NOW
    assert check_snapshot(now=NOW, snapshot_enabled=True).severity == "warn"
    (directory / "finance-export-20260903-233000.zip").write_bytes(b"x")  # 12.5h before NOW
    assert check_snapshot(now=NOW, snapshot_enabled=True).severity == "ok"


async def test_run_checks_returns_the_seven_in_order(db):
    checks = await run_checks(db, now=NOW, environment="dev", snapshot_enabled=False)
    assert [c.id for c in checks] == [
        "zero_filled_spending",
        "balances_without_spending",
        "spending_without_balances",
        "stale_quotes",
        "identical_snapshot",
        "backup",
        "snapshot",
    ]
    assert [c.severity for c in checks] == ["ok", "ok", "ok", "ok", "ok", "info", "ok"]
```

- [ ] **Step 2: Run to verify they fail**

Run: `FINANCE_TEST_DB=finance_test_l3 <venv-python> -m pytest tests/test_health_checks.py -q`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the checks**

```python
# backend/app/services/health_checks.py
"""Data health (2026-09-03 data-lifecycle spec §11): one cheap query per check, each
answering a HealthCheckOut with its severity and, when there is something to do, a fix —
a link into the app or an action the Data-health card runs (`delete_spending_month` per
month in `months`, `snapshot_now`). `now` is injected so the rules are clock-testable.
Thresholds are twins of src/utils/staleness.ts; test_health_checks pins them."""

from datetime import date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    AccountBalance,
    AppSetting,
    LatestPrice,
    MonthlyCashflow,
    MonthlySpending,
    NetWorthSnapshot,
    Security,
)
from app.schemas.lifecycle import HealthCheckOut, HealthFixOut
from app.schemas.system import BackupStatusOut
from app.services.snapshot import SNAPSHOT_NAME_RE, snapshot_stamp, snapshots_dir

STALE_QUOTE_DAYS = 4  # staleness.ts STALE_AFTER_DAYS
BACKUP_WARN_HOURS = 48  # staleness.ts BACKUP_STALE_HOURS
BACKUP_ERROR_DAYS = 7  # staleness.ts BACKUP_OVERDUE_DAYS
SNAPSHOT_WARN_HOURS = 36
COVERAGE_WINDOW_MONTHS = 12
BACKUP_STATUS_KEY = "backup_status"  # app/api/system.py's key, read here without the router


def _ok(check_id: str, title: str) -> HealthCheckOut:
    return HealthCheckOut(id=check_id, severity="ok", title=title, detail="")


def _label(month: date) -> str:
    return f"{month:%b %Y}"


def _months_back(month: date, n: int) -> date:
    index = month.year * 12 + (month.month - 1) - n
    return date(index // 12, index % 12 + 1, 1)


async def check_zero_filled_spending(db: AsyncSession) -> HealthCheckOut:
    zero_months = (
        await db.execute(
            select(MonthlySpending.month)
            .group_by(MonthlySpending.month)
            .having(func.max(func.abs(MonthlySpending.amount)) == 0)
            .order_by(MonthlySpending.month)
        )
    ).scalars()
    cashflow_months = set((await db.execute(select(MonthlyCashflow.month))).scalars())
    months = [month for month in zero_months if month not in cashflow_months]
    if not months:
        return _ok("zero_filled_spending", "Spending months carry real amounts")
    plural = "s" if len(months) > 1 else ""
    return HealthCheckOut(
        id="zero_filled_spending",
        severity="error",
        title=f"Zero-filled spending month{plural}",
        detail=(
            f"{', '.join(_label(m) for m in months)}: every category is $0.00 and no take-home "
            "was entered — an empty month that reads as spending nothing."
        ),
        count=len(months),
        months=months,
        fix=HealthFixOut(kind="action", action="delete_spending_month", label="Delete the zero-filled month"),
    )


async def check_coverage_gaps(db: AsyncSession, *, today: date) -> tuple[HealthCheckOut, HealthCheckOut]:
    """Balances without spending, and the inverse, over the last twelve COMPLETE months."""
    current = today.replace(day=1)
    floor = _months_back(current, COVERAGE_WINDOW_MONTHS)
    in_window = lambda month: floor <= month < current  # noqa: E731
    balances = {m for m in (await db.execute(select(NetWorthSnapshot.month))).scalars() if in_window(m)}
    spending = {
        m for m in (await db.execute(select(MonthlySpending.month).distinct())).scalars() if in_window(m)
    }
    without_spending = sorted(balances - spending)
    without_balances = sorted(spending - balances)

    def gap(check_id: str, title: str, months: list[date], step: str, verb: str) -> HealthCheckOut:
        if not months:
            return _ok(check_id, title)
        first = months[0]
        return HealthCheckOut(
            id=check_id,
            severity="warn",
            title=title,
            detail=f"{', '.join(_label(m) for m in months)}: {verb}.",
            count=len(months),
            months=months,
            fix=HealthFixOut(
                kind="link",
                to=f"/update?month={first.isoformat()}&step={step}",
                label=f"Enter {_label(first)} {step}",
            ),
        )

    return (
        gap(
            "balances_without_spending",
            "Balances entered, spending missing",
            without_spending,
            "spending",
            "balances were saved but no spending row exists",
        ),
        gap(
            "spending_without_balances",
            "Spending entered, balances missing",
            without_balances,
            "balances",
            "spending was saved but no balances snapshot exists",
        ),
    )


async def check_stale_quotes(db: AsyncSession, *, now: datetime) -> HealthCheckOut:
    cutoff = now - timedelta(days=STALE_QUOTE_DAYS)
    tickers = list(
        (
            await db.execute(
                select(Security.ticker)
                .join(LatestPrice, LatestPrice.security_id == Security.id)
                .where(
                    Security.is_active.is_(True),
                    Security.is_manual_priced.is_(False),
                    LatestPrice.quoted_at < cutoff,
                )
                .order_by(Security.ticker)
            )
        ).scalars()
    )
    if not tickers:
        return _ok("stale_quotes", "Quotes are fresh")
    return HealthCheckOut(
        id="stale_quotes",
        severity="warn",
        title="Stale quotes",
        detail=f"{len(tickers)} active holding(s) quoted more than {STALE_QUOTE_DAYS} days ago: {', '.join(tickers)}.",
        count=len(tickers),
        fix=HealthFixOut(kind="link", to="/portfolio", label="Open Portfolio"),
    )


async def check_identical_snapshot(db: AsyncSession) -> HealthCheckOut:
    snapshots = list(
        (await db.execute(select(NetWorthSnapshot).order_by(NetWorthSnapshot.month.desc()).limit(2))).scalars()
    )
    if len(snapshots) < 2:
        return _ok("identical_snapshot", "Latest balances differ from the month before")
    rows = (
        await db.execute(
            select(AccountBalance.snapshot_id, AccountBalance.account_id, AccountBalance.balance).where(
                AccountBalance.snapshot_id.in_([s.id for s in snapshots])
            )
        )
    ).all()
    latest = {(a, b) for s, a, b in rows if s == snapshots[0].id}
    previous = {(a, b) for s, a, b in rows if s == snapshots[1].id}
    if not latest or latest != previous:
        return _ok("identical_snapshot", "Latest balances differ from the month before")
    return HealthCheckOut(
        id="identical_snapshot",
        severity="info",
        title="Two identical months",
        detail=(
            f"{_label(snapshots[0].month)} carries exactly {_label(snapshots[1].month)}'s balances — "
            "a copied month, or a month nothing moved."
        ),
        count=1,
        months=[snapshots[0].month],
        fix=HealthFixOut(
            kind="link",
            to=f"/update?month={snapshots[0].month.isoformat()}",
            label=f"Review {_label(snapshots[0].month)}",
        ),
    )


async def check_backup(db: AsyncSession, *, now: datetime, environment: str) -> HealthCheckOut:
    if environment != "prod":
        return HealthCheckOut(
            id="backup",
            severity="info",
            title="Backups are not configured here",
            detail="Nightly database dumps run on the production host only.",
        )
    fix = HealthFixOut(kind="link", to="/settings#backups", label="Open Backups")
    setting = await db.get(AppSetting, BACKUP_STATUS_KEY)
    marker: BackupStatusOut | None = None
    if setting is not None and isinstance(setting.value, dict):
        try:
            marker = BackupStatusOut.model_validate(setting.value)
        except ValueError:
            marker = None
    if marker is None:
        return HealthCheckOut(
            id="backup", severity="error", title="No backup recorded",
            detail="No nightly dump has ever been recorded on this server.", count=1, fix=fix,
        )
    age = now - marker.last_success_at
    if age > timedelta(days=BACKUP_ERROR_DAYS):
        return HealthCheckOut(
            id="backup", severity="error", title="Backup overdue",
            detail=f"The last successful dump was {age.days} days ago.", count=1, fix=fix,
        )
    if age > timedelta(hours=BACKUP_WARN_HOURS):
        return HealthCheckOut(
            id="backup", severity="warn", title="Backup stale",
            detail=f"The last successful dump was {int(age.total_seconds() // 3600)} hours ago.", count=1, fix=fix,
        )
    if marker.verified is False:
        return HealthCheckOut(
            id="backup", severity="warn", title="Last backup not verified",
            detail=marker.verify_error or "The verify phase reported no reason.", count=1, fix=fix,
        )
    return _ok("backup", "Nightly backup is recent" + (" and verified" if marker.verified else ""))


def check_snapshot(*, now: datetime, snapshot_enabled: bool) -> HealthCheckOut:
    """Sync (filesystem) — run_checks wraps it in asyncio.to_thread."""
    if not snapshot_enabled:
        return _ok("snapshot", "Stored snapshots are disabled here")
    directory = snapshots_dir()
    names = (
        sorted((p.name for p in directory.iterdir() if SNAPSHOT_NAME_RE.fullmatch(p.name)), reverse=True)
        if directory.is_dir()
        else []
    )
    newest = snapshot_stamp(names[0]) if names else None
    fix = HealthFixOut(kind="action", action="snapshot_now", label="Snapshot now")
    if newest is None:
        return HealthCheckOut(
            id="snapshot", severity="warn", title="No stored snapshot yet",
            detail="The nightly snapshot has not written a file to the data volume.", count=1, fix=fix,
        )
    age = now - newest
    if age > timedelta(hours=SNAPSHOT_WARN_HOURS):
        return HealthCheckOut(
            id="snapshot", severity="warn", title="Stored snapshot is old",
            detail=f"The newest stored snapshot is {int(age.total_seconds() // 3600)} hours old.", count=1, fix=fix,
        )
    return _ok("snapshot", "A stored snapshot is recent")


async def run_checks(
    db: AsyncSession, *, now: datetime, environment: str, snapshot_enabled: bool
) -> list[HealthCheckOut]:
    import asyncio

    without_spending, without_balances = await check_coverage_gaps(db, today=now.date())
    return [
        await check_zero_filled_spending(db),
        without_spending,
        without_balances,
        await check_stale_quotes(db, now=now),
        await check_identical_snapshot(db),
        await check_backup(db, now=now, environment=environment),
        await asyncio.to_thread(check_snapshot, now=now, snapshot_enabled=snapshot_enabled),
    ]
```

(Move `import asyncio` to the top of the module; it sits inline above only to keep the listing readable. Ruff will insist.)

- [ ] **Step 4: Run the tests**

Run: `FINANCE_TEST_DB=finance_test_l3 <venv-python> -m pytest tests/test_health_checks.py -q`
Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/health_checks.py backend/tests/test_health_checks.py
git commit -m "feat(health): the seven data-health checks with link and action fixes"
```

---

### Task 4: `GET /system/health`

**Files:**
- Create: `backend/app/api/health.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_system_health_api.py`

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_system_health_api.py
from datetime import date
from decimal import Decimal

from app.config import settings
from app.models import MonthlySpending, SpendingCategory

HEALTH = "/api/v1/system/health"


async def test_health_requires_auth(client):
    assert (await client.get(HEALTH)).status_code == 401


async def test_health_shape_on_a_bare_database(auth_client):
    resp = await auth_client.get(HEALTH)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["checked_at"].endswith("+00:00") or body["checked_at"].endswith("Z")
    ids = [c["id"] for c in body["checks"]]
    assert ids == [
        "zero_filled_spending",
        "balances_without_spending",
        "spending_without_balances",
        "stale_quotes",
        "identical_snapshot",
        "backup",
        "snapshot",
    ]
    backup = next(c for c in body["checks"] if c["id"] == "backup")
    assert backup["severity"] == "info" and backup["title"] == "Backups are not configured here"
    # conftest pins snapshot_enabled off, exactly as the scheduler.
    assert next(c for c in body["checks"] if c["id"] == "snapshot")["severity"] == "ok"


async def test_health_reads_the_live_settings(auth_client, monkeypatch):
    monkeypatch.setattr(settings, "environment", "prod")
    monkeypatch.setattr(settings, "snapshot_enabled", True)
    body = (await auth_client.get(HEALTH)).json()
    backup = next(c for c in body["checks"] if c["id"] == "backup")
    assert backup["severity"] == "error" and backup["fix"]["to"] == "/settings#backups"
    snapshot = next(c for c in body["checks"] if c["id"] == "snapshot")
    assert snapshot["severity"] == "warn" and snapshot["fix"]["action"] == "snapshot_now"


async def test_health_names_a_zero_filled_month_with_the_repair(auth_client, db):
    category = SpendingCategory(name="Food", slug="food", sort_order=1)
    db.add(category)
    await db.flush()
    db.add(MonthlySpending(month=date(2026, 9, 1), category_id=category.id, amount=Decimal("0.00")))
    await db.commit()
    check = next(c for c in (await auth_client.get(HEALTH)).json()["checks"] if c["id"] == "zero_filled_spending")
    assert check["severity"] == "error" and check["months"] == ["2026-09-01"]
    assert check["fix"] == {"kind": "action", "label": "Delete the zero-filled month", "to": None, "action": "delete_spending_month"}
```

- [ ] **Step 2: Run to verify they fail**

Run: `FINANCE_TEST_DB=finance_test_l3 <venv-python> -m pytest tests/test_system_health_api.py -q`
Expected: FAIL — 404s.

- [ ] **Step 3: Write the router and include it**

```python
# backend/app/api/health.py
"""GET /system/health (2026-09-03 data-lifecycle spec §11): the seven checks, computed
fresh on every call. Its own router on the /system prefix — the status router
(app/api/system.py) grows the snapshot routes in a parallel lane, and two routers on one
prefix cost nothing. Not to be confused with the unauthenticated liveness GET /health."""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.config import settings
from app.database import get_db
from app.schemas.lifecycle import HealthOut
from app.services.health_checks import run_checks

router = APIRouter(prefix="/system", tags=["health"], dependencies=[Depends(get_current_user)])


@router.get("/health", response_model=HealthOut)
async def system_health(db: AsyncSession = Depends(get_db)) -> HealthOut:
    now = datetime.now(UTC)
    return HealthOut(
        checked_at=now,
        checks=await run_checks(
            db,
            now=now,
            environment=settings.environment,
            snapshot_enabled=settings.snapshot_enabled,
        ),
    )
```

In `backend/app/main.py` add `health,` to the import list (after `export`) and `app.include_router(health.router, prefix="/api/v1")` after the `system` include.

- [ ] **Step 4: Run the tests**

Run: `FINANCE_TEST_DB=finance_test_l3 <venv-python> -m pytest tests/test_system_health_api.py tests/test_health.py tests/test_system_api.py -q`
Expected: all passed (the liveness `/health` and the status route are untouched).

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/health.py backend/app/main.py backend/tests/test_system_health_api.py
git commit -m "feat(api): GET /system/health"
```

---

### Task 5: Lane suite, lint

- [ ] **Step 1:** Run (from `backend/`): `FINANCE_TEST_DB=finance_test_l3 <venv-python> -m pytest -q tests/test_prefs_registry.py tests/test_prefs_api.py tests/test_health_checks.py tests/test_system_health_api.py tests/test_export_api.py && <venv-python> -m ruff check app tests && <venv-python> -m ruff format --check app tests` → all passed; ruff clean.
- [ ] **Step 2:** `FINANCE_TEST_DB=finance_test_l3 <venv-python> -m pytest -q` → all green.

---

## Merge notes for the coordinator

- `backend/app/main.py`: this lane adds TWO imports (`health`, `prefs`) and two includes; L2 adds `activity` — keep all three.
- No other shared file is touched. `api/system.py` is L4's; this lane's `/system/health` lives in `api/health.py` on purpose.
- The repair's logging (`source='repair'`) is L2's `X-Change-Source` header rule; F2's Health card sends it on `DELETE /spending/months/{m}` when running the `delete_spending_month` fix (one call per month in `check.months`); `snapshot_now` calls L4's `POST /system/snapshots`.
- Prefs default values are informational (GET serves only set keys); the frontend store (F2) owns the local defaults.

## Self-review

**Spec coverage:** §10 registry (five keys, shapes: theme/density enums, scope `{owner: all|joint|id, range}`, `palette_recents ≤ 8`, `landing_page` over `NAV_ITEMS` paths; unknown key → 422 "Unknown preference `k`"; wrong shape → 422 naming the key) → Task 1; routes `GET /prefs` (registered keys only, absent when unset), `PATCH` partial with the same shape back, `DELETE /prefs/{key}` → 204 → Task 2; per `(user_id, key)` rows with `updated_at` → Task 2; §13 "export includes the row" → Task 2's last test. §11 table: all seven checks with the stated severities and fixes (`zero_filled_spending` error + `delete_spending_month` action; the two coverage warns with `/update?month=&step=`; `stale_quotes` 4 days twin; `identical_snapshot` info; `backup` prod-only with dev info, absent/48h/7d/verified-false grading, link `#backups`; `snapshot` 36h with `snapshot:now` action, spelled `snapshot_now`) → Task 3; `GET /system/health` `{checked_at, checks}` → Task 4. **Placeholders:** none. **Type consistency:** `PrefSpec(key, default, validate)`, `validate_pref(key, value)`, `PrefValueError`, `NAV_PATHS`, `run_checks(db, *, now, environment, snapshot_enabled)`, `check_*` signatures as tested, `HealthFixOut(kind, label, to, action)`, `HealthCheckOut(id, severity, title, detail, count, months, fix)`, `PrefsOut/PrefEntryOut` — all Phase 0 names (`2026-09-04-lifecycle-0-base.md`) and used identically across the tests and routers.
