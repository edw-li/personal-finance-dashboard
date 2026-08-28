# Contribution-Limit Registry + Batch Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **RECONCILIATION (orchestrator, 2026-08-27):** (1) Your migration's `down_revision` will be
> **`a2c6b8d40f19`** (the person-profiles plan's head; the two intervening plans add no
> migrations) — Task 0's `alembic heads` capture remains the source of truth. (2) Plan 1's
> conftest note is CONFIRMED: profiles require a primary Person; seed one in your breakdown
> tests exactly as your defensive note says. (3) Plan 3 adds NO react-router usage to
> PaycheckPage tests — your MemoryRouter `replace_all` + grep guard stands as written.
> (4) Breakdown wire: `?profile_id=&person_id=`, profile_id wins; you edit only the response
> body (`pace`), never the params — confirmed compatible.

**Goal:** Give the dashboard the contribution caps it has never modeled. A new `contribution_limits` table stores the user's own per-year figures (the app ships **no** IRS numbers — the brackets philosophy); a new `/api/v1/limits` router serves the five code-owned definitions with their values; a new pure `services/limit_check.py` annualizes each contribution line from the paycheck profile in force and grades it against the year's cap; the Paycheck breakdown embeds that as `pace`; Settings gains a **Contribution limits** card and the Paycheck page gains a **pace strip** under the waterfall. This plan also carries the batch's final verification gate — all suites plus a real-data browser smoke of everything Plans 1–4 touched.

**Architecture:** Additive-only. The table is deliberately generic — `key` is a plain `String(40)`, not an enum — so a later batch adds IRA/catch-up keys by editing `backend/app/limit_keys.py` with **no migration**. The DEFINITIONS (key, label, sort order) live in code; the table holds only values, and a value's absence is a first-class state meaning "not entered yet". A `CHECK (value > 0)` is what lets `limit_check` divide without a zero guard. The bulk `PUT` is the spending-months tri-state: an omitted key is untouched, a number is written, an explicit `null` **deletes** the row. `POST /limits/{year}/clone-from/{src}` mirrors `taxes.clone_brackets` exactly — 404 when the source is empty, 409 when the target is not, never a silent merge. `limit_check` is pure (no DB, no HTTP, no clock — the `paycheck_calc` posture); the breakdown endpoint is the only clock read and now decides two things with one `date.today()`: which profile is in force and which year's limits to measure against. Rounding contract: `annualized` quantizes to cents FIRST and the ratio is computed from that quantized figure, then quantized to 4 dp, and the tone is judged on the **quantized ratio** — so the percentage on screen is exactly the two numbers beside it divided, and a 94.996 % that prints as 95.00 % can never be labelled `ok` (the paycheck router's "judged on the DISPLAYED net" rule). Missing limits never fabricate a cap: `limit`/`ratio` are null, the tone stays `ok`, and the UI renders a link to Settings.

**Tech Stack:** FastAPI + SQLAlchemy 2 async + Postgres 16 + Alembic (real-DB pytest), React 19 + TypeScript + Vitest. No new dependencies. One Alembic migration, chained on the batch's head as captured in Task 0.

**Spec:** `docs/superpowers/specs/2026-08-27-two-income-streams-design.md` — §3 item 3 (the row), §4.5 (API + `limit_check`), §5 (Settings card, pace strip), §6 (honesty rules), §7 (tests), §9 Plan 4. **Do NOT flip the spec's status line when done** — this is wave 4 of the batch; the orchestrator tracks batch status.

**Scope boundary (wave 4 of 4).** In scope: migration 3, `app/limit_keys.py`, `schemas/limits.py`, `api/limits.py`, `services/limit_check.py`, the `pace` field on the breakdown, `src/api/limits.ts`, the Settings limits card, the Paycheck pace strip, their tests, and the batch verification gate. Explicitly NOT in this plan: per-person profiles and `hsa_coverage` (Plan 1), withholding simulation / money-flow split / per-person paydays (Plan 2), Paycheck person chips and the household take-home tile (Plan 3), IRA or catch-up keys, employer-match estimation, reconciling limits against tax inputs, any seeding of IRS values.

**Preconditions from Plans 1–3 (verified in Task 0, which STOPS if any is missing):**

| # | Interface | Owner | Used here for |
|---|---|---|---|
| P1 | `PaycheckProfile.person_id` (NOT NULL FK → `people.id`) | Plan 1 | nothing directly; proves the batch's migrations landed |
| P2 | `PaycheckProfile.hsa_coverage` — `String(10)` NOT NULL, one of `'none' \| 'self' \| 'family'` | Plan 1 | picks which HSA cap the pace row measures against |
| P3 | `GET /paycheck/breakdown` takes `person_id` (absent = primary) | Plan 1 | `pace` is computed for the profile that endpoint resolved |
| P4 | `PaycheckPage.tsx` carries person chips and a **pace-strip mount point** comment | Plan 3 | where `<PacePanel />` mounts |

**Pinned API contract (nothing else in the batch depends on this, but keep it exact):**

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/v1/limits?year=YYYY` | — | `{"year": int, "items": [{key, label, value\|null}]}` — always all five definitions, in code sort order |
| PUT | `/api/v1/limits/{year}` | `{"values": {key: "1234.00" \| null}}` | 200 same shape. Unknown key → 422; value ≤ 0 or over-scale → 422; `null` deletes the row |
| POST | `/api/v1/limits/{year}/clone-from/{source_year}` | — | 200 same shape; 404 when the source year has none; 409 when the target already has some |

**House rules that bind every task:** GETs never reject stored data (an unreadable stored value degrades, never 500s); server sentences render verbatim in the UI; Decimal/date values cross the wire as strings; comments explain constraints, not narration; migrations chain onto the head captured in Task 0 and a shipped revision is immutable (README §4.3); no file deletions — anything that looks deletable goes on the morning list; **never push**.

---

## File structure

| File | Responsibility |
|---|---|
| `backend/app/limit_keys.py` | the five definitions (key, label, sort) + the coverage→key map (new) |
| `backend/app/models/limits.py` | `ContributionLimit` (new) |
| `backend/app/models/__init__.py` | export `ContributionLimit` |
| `backend/alembic/versions/20260827_1400_b5f2c8d31e7a_contribution_limits.py` | migration 3 (new) |
| `backend/app/schemas/limits.py` | `LimitItemOut`, `LimitsOut`, `LimitsIn` (new) |
| `backend/app/api/limits.py` | `/limits` router (new) |
| `backend/app/main.py` | register the limits router |
| `backend/app/services/limit_check.py` | `PaceItem`, `paycheck_pace` — pure (new) |
| `backend/app/schemas/paycheck.py` | `PaceItemOut`; `BreakdownOut.pace` |
| `backend/app/api/paycheck.py` | breakdown loads the year's limits and embeds `pace` |
| `backend/tests/test_models_limits.py` | table constraints (new) |
| `backend/tests/test_importer_apply.py` | importer-immunity pin for `contribution_limits` |
| `backend/tests/test_limits_api.py` | GET/PUT/clone (new) |
| `backend/tests/test_limit_check.py` | pace boundaries + coverage tiers (new) |
| `backend/tests/test_paycheck_comp_api.py` | breakdown embeds `pace` |
| `src/types/api.ts` | `LimitItemOut`, `LimitsOut`, `LimitsUpdate`, `PaceItem`; `PaycheckBreakdownOut.pace` |
| `src/api/limits.ts` | `fetchLimits`, `putLimits`, `cloneLimits` (new) |
| `src/components/settings/LimitsCard.tsx` (+test) | the Settings card (new) |
| `src/components/settings/settings.css` | the card's grid rules |
| `src/pages/SettingsPage.tsx` | mount `<LimitsCard />` |
| `src/components/paycheck/PacePanel.tsx` (+test) | the pace strip (new) |
| `src/components/paycheck/pace.css` | meter grammar + tone tokens (new) |
| `src/pages/PaycheckPage.tsx` | mount `<PacePanel />` at Plan 3's mount point |
| `src/pages/PaycheckPage.test.tsx` | fixtures gain `pace`; renders wrapped in `MemoryRouter` |

NOT touched, on purpose: `backend/app/seed.py` (the app seeds no limit VALUES — that is the whole point), `backend/app/importer/` (no sheet maps to limits), `src/components/spending/budgets.css` (the pace strip mirrors its grammar in its own sheet rather than importing a spending stylesheet into a paycheck component).

---

## Phase 0 — Environment and precondition verification

### Task 0: Verify the checkout, the venv, the head, and Plans 1–3's interfaces

**Files:** none (verification only)

- [ ] **Step 1: Confirm a clean tree and the branch.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && git status --porcelain
cd /c/Users/edyli/personal-finance-dashboard && git rev-parse --abbrev-ref HEAD
```

Expected: empty porcelain output. If the tree is dirty or the branch is not the one the orchestrator prepared, STOP and report — do not stash or switch.

- [ ] **Step 2: Backend smoke** (proves the venv and the dev Postgres answer).

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && FINANCE_TEST_DB=finance_test_p3limits .venv/Scripts/python.exe -m pytest tests/test_health.py -q
```

Expected: `1 passed`. If it fails on connection, run `cd /c/Users/edyli/personal-finance-dashboard/backend && docker compose up -d db` and retry once; if it still fails, read `backend/app/config.py` for the dev `DATABASE_URL` default — do not guess.

- [ ] **Step 3: Capture the migration head this plan chains onto.**

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && .venv/Scripts/python.exe -m alembic heads
```

Expected: exactly ONE line. Write down the revision id — call it `$HEAD`. If Plan 1 has landed this will be its `hsa_coverage` migration; if the batch is being run out of order it will be `e26b9d70a4c1` (the 2026-08-26 baseline). **If there are two heads, STOP and report** — a branched history is not something this plan may resolve.

- [ ] **Step 4: Verify precondition P2 — `hsa_coverage` exists on the profile model.**

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && grep -n "hsa_coverage\|person_id" app/models/comp.py
```

Expected: `hsa_coverage` declared as a `String(10)` column and `person_id` as a FK on `PaycheckProfile`. If either is absent, Plan 1 has not landed — **STOP and report**: `limit_check` cannot pick an HSA tier without it, and there is no safe default (guessing `'self'` for a family HDHP under-states the cap by ~2×, which is exactly the fake number the spec forbids).

- [ ] **Step 5: Verify precondition P3 — the breakdown endpoint takes `person_id`.**

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && sed -n '/@router.get("\/breakdown"/,/^    lines =/p' app/api/paycheck.py
```

Expected: the signature carries `person_id: IdQuery = None` alongside `profile_id`. Task 5 edits only the BODY of this function — record the exact current signature so the edit does not re-add or reorder a parameter. If `person_id` is absent, note it in the report and proceed anyway (this plan does not need the parameter, only the profile object it resolves).

- [ ] **Step 6: Verify precondition P4 — the pace-strip mount point.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && grep -n "pace" src/pages/PaycheckPage.tsx
```

Expected: a comment marking where the pace strip mounts, inside the `breakdown !== null` branch, after `<BreakdownPanel ... />`. Record its exact line and text.
**Fallback if there is no match:** Plan 3 has not landed. Task 8 then mounts `<PacePanel items={breakdown.pace} />` on the line immediately AFTER `<BreakdownPanel data={breakdown} still={fromCache} />` and immediately before the `{/* Same payload, same busy dim` comment that precedes `<FlowPanel ... />`. Record which of the two paths applies.

- [ ] **Step 7: Frontend smoke.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && npx vitest run src/components/StatTile.test.tsx
```

Expected: green. If node modules are missing, run `npm ci` once and retry.

No commit for this task.

---

## Phase 1 — The table

### Task 1: `contribution_limits` — model, migration, constraint tests, importer immunity

**Files:**
- `backend/app/models/limits.py` (new)
- `backend/app/models/__init__.py` (import block at line 1–36; `__all__` at 38–78)
- `backend/alembic/versions/20260827_1400_b5f2c8d31e7a_contribution_limits.py` (new)
- `backend/tests/test_models_limits.py` (new)
- `backend/tests/test_importer_apply.py` (`from app.models import (...)` at lines 21–41; append the pin at the end of the file)

- [ ] **Step 1: Write the failing model test.** Create `backend/tests/test_models_limits.py` with COMPLETE content:

```python
"""contribution_limits constraints (2026-08-27 two-income-streams spec §3 item 3).

Both invariants are the DATABASE's job. The unique key is what makes the API's bulk PUT
an upsert rather than a duplicate factory, and CHECK (value > 0) is what lets
services/limit_check.py divide by a stored limit with no zero guard. Both are declared on
the model as well as in the migration because this test database is built by
Base.metadata.create_all, which never runs migrations (the ux_dividend_auto_event
precedent)."""

from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models import ContributionLimit


async def test_one_row_per_year_and_key(db):
    db.add(ContributionLimit(year=2026, key="limit_401k_elective", value=Decimal("24500.00")))
    await db.commit()
    db.add(ContributionLimit(year=2026, key="limit_401k_elective", value=Decimal("24000.00")))
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()


async def test_the_same_key_coexists_across_years(db):
    db.add_all(
        [
            ContributionLimit(year=2026, key="limit_401k_elective", value=Decimal("24500.00")),
            ContributionLimit(year=2027, key="limit_401k_elective", value=Decimal("25000.00")),
        ]
    )
    await db.commit()
    years = (
        await db.execute(select(ContributionLimit.year).order_by(ContributionLimit.year))
    ).scalars()
    assert list(years) == [2026, 2027]


async def test_a_zero_limit_is_refused(db):
    db.add(ContributionLimit(year=2026, key="limit_hsa_self", value=Decimal("0.00")))
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()


async def test_a_negative_limit_is_refused(db):
    db.add(ContributionLimit(year=2026, key="limit_hsa_self", value=Decimal("-1.00")))
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()
```

- [ ] **Step 2: Run it and watch it fail.**

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && FINANCE_TEST_DB=finance_test_p3limits .venv/Scripts/python.exe -m pytest tests/test_models_limits.py -q
```

Expected failure: `ImportError: cannot import name 'ContributionLimit' from 'app.models'` (collection error, 0 passed).

- [ ] **Step 3: Write the model.** Create `backend/app/models/limits.py` with COMPLETE content:

```python
"""Per-year contribution limits (2026-08-27 two-income-streams spec §3 item 3 / §4.5).

The app ships NO values — the brackets philosophy (spec §2): the IRS publishes new
numbers every autumn, a hardcoded table is wrong the moment it is written, and a wrong
cap is worse than an absent one. The user enters the figures per year in Settings, and an
ABSENT row is a first-class state meaning "not entered yet" — which is what the Paycheck
pace strip renders a call-to-action for.

Deliberately generic: `key` is a plain string, not an enum, so a later batch adds IRA or
catch-up keys by editing app/limit_keys.py with no migration. The DEFINITIONS (key,
label, sort order) live in code; this table holds only values.

Importer-immune: no sheet maps to contribution limits, so a re-import must neither
create, update nor delete a row (the custom_events / rsu_grants posture, pinned in
test_importer_apply.py).
"""

from decimal import Decimal

from sqlalchemy import CheckConstraint, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ContributionLimit(Base):
    __tablename__ = "contribution_limits"
    __table_args__ = (
        # One value per (year, key). The API's bulk PUT is a get-then-set upsert against
        # this key, and a null in the request DELETES the row rather than storing a zero.
        UniqueConstraint("year", "key"),
        # > 0, not >= 0. A zero cap is not a thing the IRS publishes, and this constraint
        # is precisely what lets services/limit_check.py divide by a stored limit with no
        # zero guard — the router mirrors it with a 422 so the sentence is user-worthy.
        CheckConstraint("value > 0", name="value_positive"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # A plain int with NO FK to tax_years: limits are a calendar-year registry of their
    # own and must be enterable for a year that has no tax return yet (next year's caps
    # are published while this year's return is still open).
    year: Mapped[int] = mapped_column()
    key: Mapped[str] = mapped_column(String(40))
    value: Mapped[Decimal] = mapped_column(Numeric(14, 2))
```

- [ ] **Step 4: Export it.** In `backend/app/models/__init__.py`, add the import after the `from app.models.household import Person` line:

```python
from app.models.limits import ContributionLimit
```

and add `"ContributionLimit",` to `__all__` in alphabetical position — between `"CompEvent",` and `"CreditCard",`.

- [ ] **Step 5: Run the model test to pass.**

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && FINANCE_TEST_DB=finance_test_p3limits .venv/Scripts/python.exe -m pytest tests/test_models_limits.py -q
```

Expected: `4 passed`.

- [ ] **Step 6: Write the migration.** Create `backend/alembic/versions/20260827_1400_b5f2c8d31e7a_contribution_limits.py` with COMPLETE content. **Before saving, set `down_revision` to `$HEAD` from Task 0 Step 3** — the literal below is the 2026-08-26 baseline and is correct only if Plan 1 has not landed. That one string is the only line that may differ:

```python
"""contribution limits

Per-year contribution caps entered by the user (2026-08-27 two-income-streams spec §3
item 3). The app seeds NO values: the definitions live in app/limit_keys.py and every
number is the user's. Additive; downgrade drops the table.

Revision ID: b5f2c8d31e7a
Revises: e26b9d70a4c1
Create Date: 2026-08-27 14:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b5f2c8d31e7a"
down_revision: str | Sequence[str] | None = "e26b9d70a4c1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "contribution_limits",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("key", sa.String(length=40), nullable=False),
        sa.Column("value", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.CheckConstraint("value > 0", name=op.f("ck_contribution_limits_value_positive")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_contribution_limits")),
        sa.UniqueConstraint("year", "key", name=op.f("uq_contribution_limits_year")),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("contribution_limits")
```

- [ ] **Step 7: Apply the migration and prove it matches the model.**

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && .venv/Scripts/python.exe -m alembic upgrade head && .venv/Scripts/python.exe -m alembic check
```

Expected: the upgrade runs and `alembic check` reports **no new upgrade operations detected**. If `check` wants to emit anything for `contribution_limits`, the migration and the model disagree — fix the migration, never the model.

- [ ] **Step 8: Write the failing importer-immunity pin.** Append to the END of `backend/tests/test_importer_apply.py`:

```python
def contribution_limit_row(row: ContributionLimit) -> tuple:
    """EVERY stored column, as grant_row above — a column added later is covered by the
    pin below without anyone editing it."""
    return tuple(getattr(row, column.key) for column in ContributionLimit.__table__.columns)


async def test_importer_never_writes_contribution_limits(db):
    """contribution_limits is dashboard-only (2026-08-27 spec §3 item 3, the custom_events
    posture): no sheet carries IRS caps, so a re-import must neither create, update nor
    delete a row."""
    from app.importer.service import run_import

    db.add(ContributionLimit(year=2026, key="limit_401k_elective", value=Decimal("24500.00")))
    await db.commit()
    before = {
        row.id: contribution_limit_row(row)
        for row in (await db.execute(select(ContributionLimit))).scalars()
    }
    assert len(before) == 1  # a pin over nothing pins nothing

    for _ in range(2):
        report = await run_import(build_workbook(), db, dry_run=False)
        assert report.applied is True  # a blocked import would pin nothing

    # populate_existing, or the identity map would hand back the pre-import objects and
    # this would pass even if the import had rewritten every column (the dividends pin's
    # note).
    after = {
        row.id: contribution_limit_row(row)
        for row in (
            await db.execute(select(ContributionLimit).execution_options(populate_existing=True))
        ).scalars()
    }
    assert after == before
    assert all("contribution_limits" not in sheet.entities for sheet in report.sheets.values())
```

and add `ContributionLimit,` to the `from app.models import (...)` block (lines 21–41), in alphabetical position between `CompEvent`-adjacent entries — specifically after `CategoryBudget,` and before `CreditCard,`.

- [ ] **Step 9: Run it and watch it fail, then pass.**

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && FINANCE_TEST_DB=finance_test_p3limits .venv/Scripts/python.exe -m pytest tests/test_importer_apply.py -q -k contribution
```

Expected on the first run (before Step 8's import line is added): a collection `ImportError`. After the import line: `1 passed` — the importer already has no code path that touches this table, so the pin passes as written. That is the point: it is a REGRESSION fence, not a bug fix.

- [ ] **Step 10: Run the whole importer + model suites.**

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && FINANCE_TEST_DB=finance_test_p3limits .venv/Scripts/python.exe -m pytest tests/test_importer_apply.py tests/test_models_limits.py -q
```

Expected: all green.

- [ ] **Step 11: Commit.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && git add -A && git commit -m "feat(limits): contribution_limits table — per-year user-entered caps, importer-immune"
```

---

## Phase 2 — The API

### Task 2: Definitions module, schemas, and `GET`/`PUT /limits`

**Files:**
- `backend/app/limit_keys.py` (new)
- `backend/app/schemas/limits.py` (new)
- `backend/app/api/limits.py` (new)
- `backend/app/main.py` (import block; `include_router` block at lines 78–94)
- `backend/tests/test_limits_api.py` (new)

- [ ] **Step 1: Write the failing API test.** Create `backend/tests/test_limits_api.py` with COMPLETE content:

```python
"""Contribution-limit registry API (2026-08-27 two-income-streams spec §4.5).

The five DEFINITIONS always ride back — a key the user has never entered still needs a
box to type into — and the PUT is the spending-months tri-state: omitted keys are
untouched, numbers are written, an explicit null DELETES the row back to "not entered".
"""

from decimal import Decimal

from sqlalchemy import select

from app.limit_keys import LIMIT_DEFINITIONS
from app.models import ContributionLimit

ALL_KEYS = [
    "limit_401k_elective",
    "limit_415c_total",
    "limit_hsa_self",
    "limit_hsa_family",
    "limit_espp_423",
]


async def test_get_lists_all_five_definitions_with_null_values(auth_client):
    resp = await auth_client.get("/api/v1/limits?year=2026")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["year"] == 2026
    assert [item["key"] for item in body["items"]] == ALL_KEYS
    assert [item["value"] for item in body["items"]] == [None] * 5
    # Labels are the code's, not the database's — nothing is stored for them.
    assert body["items"][0]["label"] == "401(k) elective deferral"


async def test_definitions_are_ordered_by_their_sort_number(auth_client):
    assert [key for key, _label, _sort in sorted(LIMIT_DEFINITIONS, key=lambda r: r[2])] == ALL_KEYS


async def test_limits_require_auth(client):
    assert (await client.get("/api/v1/limits?year=2026")).status_code == 401


async def test_put_writes_and_get_reads_back(auth_client):
    resp = await auth_client.put(
        "/api/v1/limits/2026",
        json={"values": {"limit_401k_elective": "24500", "limit_hsa_family": "8900.5"}},
    )
    assert resp.status_code == 200, resp.text
    values = {item["key"]: item["value"] for item in resp.json()["items"]}
    # Quantized to the column scale on the way in.
    assert values["limit_401k_elective"] == "24500.00"
    assert values["limit_hsa_family"] == "8900.50"
    assert values["limit_espp_423"] is None

    again = await auth_client.get("/api/v1/limits?year=2026")
    assert {item["key"]: item["value"] for item in again.json()["items"]} == values


async def test_an_omitted_key_is_untouched(auth_client):
    await auth_client.put(
        "/api/v1/limits/2026",
        json={"values": {"limit_401k_elective": "24500", "limit_hsa_self": "4400"}},
    )
    resp = await auth_client.put(
        "/api/v1/limits/2026", json={"values": {"limit_401k_elective": "24000"}}
    )
    values = {item["key"]: item["value"] for item in resp.json()["items"]}
    assert values["limit_401k_elective"] == "24000.00"
    assert values["limit_hsa_self"] == "4400.00"


async def test_an_explicit_null_deletes_the_row(auth_client, db):
    await auth_client.put("/api/v1/limits/2026", json={"values": {"limit_hsa_self": "4400"}})
    resp = await auth_client.put("/api/v1/limits/2026", json={"values": {"limit_hsa_self": None}})
    values = {item["key"]: item["value"] for item in resp.json()["items"]}
    assert values["limit_hsa_self"] is None
    # A DELETED row, not a stored zero — the CHECK forbids the zero, and "not entered" is
    # the state the pace strip's call-to-action is about.
    rows = (await db.execute(select(ContributionLimit))).scalars().all()
    assert rows == []


async def test_deleting_a_key_that_was_never_stored_is_a_no_op(auth_client):
    resp = await auth_client.put("/api/v1/limits/2026", json={"values": {"limit_espp_423": None}})
    assert resp.status_code == 200, resp.text
    assert all(item["value"] is None for item in resp.json()["items"])


async def test_an_unknown_key_is_refused(auth_client, db):
    resp = await auth_client.put("/api/v1/limits/2026", json={"values": {"limit_457b": "24500"}})
    assert resp.status_code == 422
    assert "limit_457b" in resp.json()["detail"]
    assert (await db.execute(select(ContributionLimit))).scalars().all() == []


async def test_a_zero_or_negative_limit_is_refused(auth_client):
    for bad in ("0", "-0", "-1"):
        resp = await auth_client.put(
            "/api/v1/limits/2026", json={"values": {"limit_hsa_self": bad}}
        )
        assert resp.status_code == 422, bad
        assert "limit_hsa_self must be positive" in resp.json()["detail"]


async def test_a_rejected_key_writes_nothing_at_all(auth_client, db):
    """Validate-then-mutate: a 422 halfway through a multi-key PUT must not leave the
    legal keys written (the paycheck router's whole-row rule)."""
    resp = await auth_client.put(
        "/api/v1/limits/2026",
        json={"values": {"limit_401k_elective": "24500", "limit_hsa_self": "-5"}},
    )
    assert resp.status_code == 422
    assert (await db.execute(select(ContributionLimit))).scalars().all() == []


async def test_an_out_of_range_year_is_refused(auth_client):
    assert (await auth_client.get("/api/v1/limits?year=99999999999")).status_code == 422
    assert (
        await auth_client.put("/api/v1/limits/1899", json={"values": {}})
    ).status_code == 422


async def test_years_are_independent(auth_client):
    await auth_client.put("/api/v1/limits/2026", json={"values": {"limit_hsa_self": "4400"}})
    await auth_client.put("/api/v1/limits/2027", json={"values": {"limit_hsa_self": "4500"}})
    for year, expected in ((2026, "4400.00"), (2027, "4500.00")):
        resp = await auth_client.get(f"/api/v1/limits?year={year}")
        values = {item["key"]: item["value"] for item in resp.json()["items"]}
        assert values["limit_hsa_self"] == expected


async def test_an_over_scale_value_is_a_422_not_a_500(auth_client):
    resp = await auth_client.put(
        "/api/v1/limits/2026", json={"values": {"limit_401k_elective": "1e13"}}
    )
    assert resp.status_code == 422


def test_the_coverage_map_covers_both_hdhp_tiers():
    from app.limit_keys import HSA_LIMIT_KEY_BY_COVERAGE

    assert HSA_LIMIT_KEY_BY_COVERAGE == {
        "self": "limit_hsa_self",
        "family": "limit_hsa_family",
    }
    # 'none' is deliberately absent: no HDHP means NEITHER cap applies, and a row would
    # have to pick one of the two to measure against.
    assert "none" not in HSA_LIMIT_KEY_BY_COVERAGE
```

- [ ] **Step 2: Run it and watch it fail.**

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && FINANCE_TEST_DB=finance_test_p3limits .venv/Scripts/python.exe -m pytest tests/test_limits_api.py -q
```

Expected failure: `ModuleNotFoundError: No module named 'app.limit_keys'` (collection error, 0 passed).

- [ ] **Step 3: Write the definitions module.** Create `backend/app/limit_keys.py` with COMPLETE content:

```python
"""The contribution-limit vocabulary (2026-08-27 two-income-streams spec §4.5).

Definitions in CODE, values in the database — the same split tax_input_definitions makes,
minus the table: labels and display order are the app's, and every number is the user's
(spec §2, "the app ships no IRS limit values"). Adding a key here — an IRA cap, a
catch-up tier — needs no migration, because contribution_limits.key is a plain string.

Keep every key <= 40 characters: that is the stored column's width.
"""

LIMIT_401K_ELECTIVE = "limit_401k_elective"
LIMIT_415C_TOTAL = "limit_415c_total"
LIMIT_HSA_SELF = "limit_hsa_self"
LIMIT_HSA_FAMILY = "limit_hsa_family"
LIMIT_ESPP_423 = "limit_espp_423"

# (key, label, sort_order). The SORT NUMBER is authoritative, not the tuple's order —
# readers sort by it — so a later key can be slotted between two existing ones without
# rewriting the block. Gaps of 10 exist for exactly that.
LIMIT_DEFINITIONS: tuple[tuple[str, str, int], ...] = (
    (LIMIT_401K_ELECTIVE, "401(k) elective deferral", 10),
    (LIMIT_415C_TOTAL, "415(c) total additions", 20),
    (LIMIT_HSA_SELF, "HSA — self-only", 30),
    (LIMIT_HSA_FAMILY, "HSA — family", 40),
    (LIMIT_ESPP_423, "ESPP §423 annual", 50),
)

ORDERED_DEFINITIONS: tuple[tuple[str, str, int], ...] = tuple(
    sorted(LIMIT_DEFINITIONS, key=lambda row: row[2])
)
LIMIT_KEYS: tuple[str, ...] = tuple(key for key, _label, _sort in ORDERED_DEFINITIONS)
LIMIT_LABELS: dict[str, str] = {key: label for key, label, _sort in ORDERED_DEFINITIONS}

# paycheck_profiles.hsa_coverage -> the cap that applies. 'none' is deliberately ABSENT:
# no HDHP means neither cap applies, so limit_check emits no HSA row at all rather than
# measuring against a tier nobody is enrolled in.
HSA_LIMIT_KEY_BY_COVERAGE: dict[str, str] = {
    "self": LIMIT_HSA_SELF,
    "family": LIMIT_HSA_FAMILY,
}
```

- [ ] **Step 4: Write the schemas.** Create `backend/app/schemas/limits.py` with COMPLETE content:

```python
"""Wire shapes for the contribution-limit registry (2026-08-27 spec §4.5).

Values cross the wire as pydantic Decimals — JSON strings — at the column scale,
Numeric(14,2). `value: null` on the way OUT means "not entered for this year"; `null`
inside a PUT's `values` map means "delete the row", which is the same tri-state the
spending months use.
"""

from decimal import Decimal

from pydantic import BaseModel


class LimitItemOut(BaseModel):
    """One definition and whatever the user has stored for it this year. `label` is the
    code's, never a stored string — the registry holds values only."""

    key: str
    label: str
    value: Decimal | None


class LimitsOut(BaseModel):
    year: int
    items: list[LimitItemOut]


class LimitsIn(BaseModel):
    # A PARTIAL map by design: a caller that only knows about two keys sends two, and the
    # rest keep whatever they had. Only an EXPLICIT null deletes — an omitted key is not
    # a request to clear anything.
    values: dict[str, Decimal | None]
```

- [ ] **Step 5: Write the router.** Create `backend/app/api/limits.py` with COMPLETE content (the clone endpoint arrives in Task 3):

```python
"""Contribution-limit registry (2026-08-27 two-income-streams spec §4.5).

The app ships NO values (the brackets philosophy, spec §2): the five DEFINITIONS live in
app/limit_keys.py with their labels and display order, and every year's numbers are the
user's to enter. A GET therefore always answers with all five items — a missing value is
`null`, which is what the Paycheck page's pace strip renders its "enter this year's
limit" call-to-action for. Never a fabricated cap.

The PUT is a partial bulk upsert with the spending-months tri-state: a key absent from
`values` is untouched, a key with a number is written, a key with an explicit null has
its row DELETED (back to "not entered"). Get-then-set per row is the accepted single-user
TOCTOU class (accounts/securities/taxes precedent).
"""

from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user

# The century guard, borrowed rather than re-minted: `year` is an int4 here too, so a
# mistyped 99999999999 would surface as a bare asyncpg DataError 500 on a plain GET.
# app_settings.py already imports a helper from another router — one rule, one spelling.
from app.api.taxes import YEAR_MAX, YEAR_MIN
from app.database import get_db
from app.limit_keys import LIMIT_KEYS, ORDERED_DEFINITIONS
from app.models import ContributionLimit
from app.schemas.limits import LimitItemOut, LimitsIn, LimitsOut
from app.services.money import quantize_money

router = APIRouter(prefix="/limits", tags=["limits"], dependencies=[Depends(get_current_user)])

ZERO = Decimal("0")
YearPath = Annotated[int, Path(ge=YEAR_MIN, le=YEAR_MAX)]
YearQuery = Annotated[int, Query(ge=YEAR_MIN, le=YEAR_MAX)]


def _validated_value(value: Decimal, key: str) -> Decimal:
    """Quantized to the column scale BEFORE the insert (money.py's bounds vocabulary), so
    an over-scale figure is a 422 and never a bare sqlstate 22003.

    `+ ZERO` collapses signed zeros — a "-0" compares EQUAL to zero, so it would slip the
    `<= 0` check below and land in the table as "-0.00" (app_settings' trick).
    """
    quantized = quantize_money(value, key) + ZERO
    if quantized <= 0:
        # Mirrors the table's CHECK (value > 0) with a sentence a user can act on. A zero
        # cap is not a thing the IRS publishes, and it is what lets limit_check divide.
        raise HTTPException(status_code=422, detail=f"{key} must be positive")
    return quantized


async def _stored(db: AsyncSession, year: int) -> dict[str, Decimal]:
    rows = (
        await db.execute(select(ContributionLimit).where(ContributionLimit.year == year))
    ).scalars()
    # Keys the definitions no longer carry are invisible to this router on purpose: a key
    # retired from limit_keys.py keeps its stored rows (nothing deletes them), so a later
    # batch that re-adds it finds the user's numbers intact.
    return {row.key: row.value for row in rows if row.key in LIMIT_KEYS}


def _payload(year: int, stored: dict[str, Decimal]) -> LimitsOut:
    # ALL FIVE definitions, always, in sort order: the card is a fixed form, not a list of
    # whatever happens to be stored, and a key the user has never entered still needs a
    # box to type into.
    return LimitsOut(
        year=year,
        items=[
            LimitItemOut(key=key, label=label, value=stored.get(key))
            for key, label, _sort in ORDERED_DEFINITIONS
        ],
    )


@router.get("", response_model=LimitsOut)
async def get_limits(year: YearQuery, db: AsyncSession = Depends(get_db)) -> LimitsOut:
    return _payload(year, await _stored(db, year))


@router.put("/{year}", response_model=LimitsOut)
async def put_limits(
    year: YearPath, body: LimitsIn, db: AsyncSession = Depends(get_db)
) -> LimitsOut:
    unknown = sorted(set(body.values) - set(LIMIT_KEYS))
    if unknown:
        # Refused, never ignored: a typo'd key that silently vanished would read as
        # "saved" on a card whose box then came back empty.
        raise HTTPException(
            status_code=422, detail=f"unknown limit key(s): {', '.join(unknown)}"
        )
    # Validate the WHOLE map first (the paycheck router's whole-row rule): a 422 halfway
    # through a five-key PUT must not leave the legal keys written.
    validated = {
        key: None if value is None else _validated_value(value, key)
        for key, value in body.values.items()
    }
    existing = {
        row.key: row
        for row in (
            await db.execute(select(ContributionLimit).where(ContributionLimit.year == year))
        ).scalars()
    }
    for key, value in validated.items():
        row = existing.get(key)
        if value is None:
            # DELETE, not a stored zero: "not entered" is a state the pace strip renders a
            # call-to-action for, and the CHECK forbids the zero anyway.
            if row is not None:
                await db.delete(row)
            continue
        if row is None:
            db.add(ContributionLimit(year=year, key=key, value=value))
        else:
            row.value = value
    await db.commit()
    return _payload(year, await _stored(db, year))
```

- [ ] **Step 6: Register the router.** In `backend/app/main.py`, add `limits,` to the `from app.api import (...)` block that starts at line 10, in alphabetical position (after `import_,`), and insert the registration immediately after the `app.include_router(paycheck.router, prefix="/api/v1")` line:

```python
app.include_router(limits.router, prefix="/api/v1")
```

- [ ] **Step 7: Run the API test to pass.**

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && FINANCE_TEST_DB=finance_test_p3limits .venv/Scripts/python.exe -m pytest tests/test_limits_api.py -q
```

Expected: `14 passed`.

- [ ] **Step 8: Commit.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && git add -A && git commit -m "feat(limits): /api/v1/limits — code-owned definitions, tri-state bulk PUT"
```

---

### Task 3: `POST /limits/{year}/clone-from/{source_year}`

**Files:**
- `backend/app/api/limits.py` (append after `put_limits`)
- `backend/tests/test_limits_api.py` (append)

- [ ] **Step 1: Write the failing clone tests.** Append to `backend/tests/test_limits_api.py`:

```python
async def test_clone_seeds_an_empty_year_from_a_populated_one(auth_client):
    await auth_client.put(
        "/api/v1/limits/2026",
        json={"values": {"limit_401k_elective": "24500", "limit_hsa_family": "8900"}},
    )
    resp = await auth_client.post("/api/v1/limits/2027/clone-from/2026")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["year"] == 2027
    values = {item["key"]: item["value"] for item in body["items"]}
    assert values["limit_401k_elective"] == "24500.00"
    assert values["limit_hsa_family"] == "8900.00"
    # Only what the source had: an unentered key stays unentered, not zeroed.
    assert values["limit_espp_423"] is None


async def test_clone_leaves_the_source_year_alone(auth_client):
    await auth_client.put("/api/v1/limits/2026", json={"values": {"limit_hsa_self": "4400"}})
    await auth_client.post("/api/v1/limits/2027/clone-from/2026")
    resp = await auth_client.get("/api/v1/limits?year=2026")
    values = {item["key"]: item["value"] for item in resp.json()["items"]}
    assert values["limit_hsa_self"] == "4400.00"


async def test_clone_from_an_empty_source_is_404(auth_client):
    resp = await auth_client.post("/api/v1/limits/2027/clone-from/2026")
    assert resp.status_code == 404
    assert "2026" in resp.json()["detail"]


async def test_clone_into_a_non_empty_target_is_409(auth_client):
    await auth_client.put("/api/v1/limits/2026", json={"values": {"limit_hsa_self": "4400"}})
    await auth_client.put("/api/v1/limits/2027", json={"values": {"limit_espp_423": "25000"}})
    resp = await auth_client.post("/api/v1/limits/2027/clone-from/2026")
    assert resp.status_code == 409
    assert "2027" in resp.json()["detail"]


async def test_a_409_clone_writes_nothing(auth_client, db):
    await auth_client.put("/api/v1/limits/2026", json={"values": {"limit_hsa_self": "4400"}})
    await auth_client.put("/api/v1/limits/2027", json={"values": {"limit_espp_423": "25000"}})
    await auth_client.post("/api/v1/limits/2027/clone-from/2026")
    rows = (
        await db.execute(
            select(ContributionLimit.key).where(ContributionLimit.year == 2027)
        )
    ).scalars()
    assert list(rows) == ["limit_espp_423"]


async def test_clone_into_a_year_whose_rows_were_all_deleted_succeeds(auth_client):
    """A year emptied by null PUTs is empty for the guard's purposes too — that is the
    documented way to re-clone (never a merge)."""
    await auth_client.put("/api/v1/limits/2026", json={"values": {"limit_hsa_self": "4400"}})
    await auth_client.put("/api/v1/limits/2027", json={"values": {"limit_hsa_self": "9999"}})
    await auth_client.put("/api/v1/limits/2027", json={"values": {"limit_hsa_self": None}})
    resp = await auth_client.post("/api/v1/limits/2027/clone-from/2026")
    assert resp.status_code == 200, resp.text
    values = {item["key"]: item["value"] for item in resp.json()["items"]}
    assert values["limit_hsa_self"] == "4400.00"


async def test_clone_requires_auth(client):
    assert (await client.post("/api/v1/limits/2027/clone-from/2026")).status_code == 401
```

- [ ] **Step 2: Run and watch them fail.**

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && FINANCE_TEST_DB=finance_test_p3limits .venv/Scripts/python.exe -m pytest tests/test_limits_api.py -q -k clone
```

Expected failure: `405 Method Not Allowed` / `404` mismatches — the route does not exist (6 failed, 1 passed for the auth check which 401s by router dependency... in fact the auth test will also fail with 405). Report the exact counts.

- [ ] **Step 3: Implement the clone.** Append to `backend/app/api/limits.py`:

```python
@router.post("/{year}/clone-from/{source_year}", response_model=LimitsOut)
async def clone_limits(
    year: YearPath, source_year: YearPath, db: AsyncSession = Depends(get_db)
) -> LimitsOut:
    """Seed an EMPTY year from an existing one; then edited in place.

    "Last year's numbers, then bump the two that moved" is how the caps actually change,
    and the app ships none of its own to start from. The source year may equal the target
    only in the degenerate sense that the emptiness guard below would then always fire.
    """
    source = await _stored(db, source_year)
    if not source:
        raise HTTPException(
            status_code=404, detail=f"no contribution limits to clone from {source_year}"
        )
    existing = await _stored(db, year)
    if existing:
        # Never a silent merge (clone_brackets' grammar): clear the target explicitly —
        # a PUT with nulls — first.
        raise HTTPException(
            status_code=409, detail=f"{year} already has {len(existing)} contribution limits"
        )
    for key, value in source.items():
        db.add(ContributionLimit(year=year, key=key, value=value))
    await db.commit()
    return _payload(year, await _stored(db, year))
```

- [ ] **Step 4: Run the whole limits suite to pass.**

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && FINANCE_TEST_DB=finance_test_p3limits .venv/Scripts/python.exe -m pytest tests/test_limits_api.py -q
```

Expected: `21 passed`.

- [ ] **Step 5: Commit.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && git add -A && git commit -m "feat(limits): clone-from-prior-year — 404 empty source, 409 non-empty target"
```

---

## Phase 3 — The pace service

### Task 4: `services/limit_check.py` — pure annualization with boundary-exact tones

**Files:**
- `backend/app/services/limit_check.py` (new)
- `backend/tests/test_limit_check.py` (new)

- [ ] **Step 1: Write the failing service test.** Create `backend/tests/test_limit_check.py` with COMPLETE content:

```python
"""paycheck_pace boundaries and coverage tiers (2026-08-27 spec §4.5 / §7).

A plain object stands in for the ORM row — the module takes anything with the profile's
columns (paycheck_calc's contract), which is what keeps it pure and this file DB-free.

The tone boundaries are the reason this file exists: warn at ratio >= 0.95, over at
> 1.0, and both judged on the QUANTIZED (4 dp) ratio so the verdict can never contradict
the percentage rendered beside it.
"""

from dataclasses import dataclass
from decimal import Decimal

from app.limit_keys import (
    LIMIT_401K_ELECTIVE,
    LIMIT_415C_TOTAL,
    LIMIT_ESPP_423,
    LIMIT_HSA_FAMILY,
    LIMIT_HSA_SELF,
)
from app.services.limit_check import paycheck_pace


@dataclass
class FakeProfile:
    annual_salary: Decimal = Decimal("100000.00")
    pay_periods_per_year: int = 24
    trad_401k_pct: Decimal = Decimal("0.100000000")
    roth_401k_pct: Decimal = Decimal("0")
    after_tax_401k_pct: Decimal = Decimal("0")
    espp_pct: Decimal = Decimal("0")
    withholding_pct: Decimal = Decimal("0.300000000")
    dental_vision_per_check: Decimal = Decimal("0")
    hsa_per_check: Decimal = Decimal("0")


def by_key(items):
    return {item.key: item for item in items}


def test_elective_deferral_sums_traditional_and_roth():
    profile = FakeProfile(
        trad_401k_pct=Decimal("0.080000000"), roth_401k_pct=Decimal("0.050000000")
    )
    item = by_key(paycheck_pace(profile, {}, "none"))[LIMIT_401K_ELECTIVE]
    assert item.annualized == Decimal("13000.00")
    assert item.label == "401(k) elective deferral"


def test_total_additions_adds_after_tax_and_names_the_match_caveat():
    profile = FakeProfile(
        trad_401k_pct=Decimal("0.080000000"),
        roth_401k_pct=Decimal("0.050000000"),
        after_tax_401k_pct=Decimal("0.030000000"),
    )
    item = by_key(paycheck_pace(profile, {}, "none"))[LIMIT_415C_TOTAL]
    assert item.annualized == Decimal("16000.00")
    # The one thing this app cannot see, said in the row's own label (spec §6).
    assert item.label == "415(c) total additions (excludes employer match)"


def test_a_missing_limit_gives_no_ratio_and_no_verdict():
    item = by_key(paycheck_pace(FakeProfile(), {}, "none"))[LIMIT_401K_ELECTIVE]
    assert item.limit is None
    assert item.ratio is None
    # 'ok' is the ABSENCE of a verdict here, not an all-clear — the UI renders a
    # call-to-action instead of a meter when `limit` is None.
    assert item.tone == "ok"


def test_ratio_is_quantized_to_four_places():
    profile = FakeProfile(trad_401k_pct=Decimal("0.100000000"))  # 10_000
    item = by_key(paycheck_pace(profile, {LIMIT_401K_ELECTIVE: Decimal("30000.00")}, "none"))[
        LIMIT_401K_ELECTIVE
    ]
    assert item.ratio == Decimal("0.3333")
    assert item.tone == "ok"


def ratio_case(annual_dollars: str, limit: str):
    """One elective-deferral row at an exact annualized figure against an exact cap."""
    profile = FakeProfile(annual_salary=Decimal(annual_dollars), trad_401k_pct=Decimal("1"))
    limits = {LIMIT_401K_ELECTIVE: Decimal(limit)}
    return by_key(paycheck_pace(profile, limits, "none"))[LIMIT_401K_ELECTIVE]


def test_boundary_0_949_is_ok():
    item = ratio_case("9490.00", "10000.00")
    assert item.ratio == Decimal("0.9490")
    assert item.tone == "ok"


def test_boundary_just_under_95_percent_is_ok():
    item = ratio_case("9499.00", "10000.00")
    assert item.ratio == Decimal("0.9499")
    assert item.tone == "ok"


def test_boundary_exactly_95_percent_warns():
    item = ratio_case("9500.00", "10000.00")
    assert item.ratio == Decimal("0.9500")
    assert item.tone == "warn"


def test_boundary_exactly_100_percent_warns_and_does_not_over():
    """`over` is strictly ABOVE the cap: contributing exactly the maximum is the goal,
    not a mistake."""
    item = ratio_case("10000.00", "10000.00")
    assert item.ratio == Decimal("1.0000")
    assert item.tone == "warn"


def test_boundary_100_1_percent_is_over():
    item = ratio_case("10010.00", "10000.00")
    assert item.ratio == Decimal("1.0010")
    assert item.tone == "over"


def test_tone_follows_the_rounded_ratio_not_the_raw_one():
    """0.94996 rounds to 0.9500 and PRINTS as 95.00 % — labelling that `ok` would put the
    verdict at odds with the number next to it (the paycheck router's displayed-net rule)."""
    item = ratio_case("9499.60", "10000.00")
    assert item.ratio == Decimal("0.9500")
    assert item.tone == "warn"


def test_hsa_coverage_self_uses_the_self_only_cap():
    profile = FakeProfile(hsa_per_check=Decimal("150.00"))
    items = by_key(
        paycheck_pace(
            profile,
            {LIMIT_HSA_SELF: Decimal("4400.00"), LIMIT_HSA_FAMILY: Decimal("8900.00")},
            "self",
        )
    )
    assert LIMIT_HSA_FAMILY not in items
    row = items[LIMIT_HSA_SELF]
    assert row.annualized == Decimal("3600.00")  # 150 x 24
    assert row.limit == Decimal("4400.00")
    assert row.label == "HSA — self-only"


def test_hsa_coverage_family_uses_the_family_cap():
    profile = FakeProfile(hsa_per_check=Decimal("150.00"))
    items = by_key(
        paycheck_pace(
            profile,
            {LIMIT_HSA_SELF: Decimal("4400.00"), LIMIT_HSA_FAMILY: Decimal("8900.00")},
            "family",
        )
    )
    assert LIMIT_HSA_SELF not in items
    assert items[LIMIT_HSA_FAMILY].limit == Decimal("8900.00")


def test_hsa_coverage_none_emits_no_hsa_row():
    profile = FakeProfile(hsa_per_check=Decimal("150.00"))
    items = by_key(paycheck_pace(profile, {LIMIT_HSA_SELF: Decimal("4400.00")}, "none"))
    assert LIMIT_HSA_SELF not in items
    assert LIMIT_HSA_FAMILY not in items


def test_an_unrecognized_coverage_string_emits_no_hsa_row():
    """A hand-edited row degrades to silence rather than guessing a tier (§6: no silent
    fallbacks, and picking one of two caps at random is the worst possible guess)."""
    profile = FakeProfile(hsa_per_check=Decimal("150.00"))
    items = by_key(paycheck_pace(profile, {LIMIT_HSA_SELF: Decimal("4400.00")}, "hdhp"))
    assert LIMIT_HSA_SELF not in items


def test_hsa_uses_the_profiles_own_cadence():
    profile = FakeProfile(hsa_per_check=Decimal("100.00"), pay_periods_per_year=26)
    items = by_key(paycheck_pace(profile, {LIMIT_HSA_SELF: Decimal("4400.00")}, "self"))
    assert items[LIMIT_HSA_SELF].annualized == Decimal("2600.00")


def test_espp_zero_percent_emits_no_row():
    items = by_key(
        paycheck_pace(FakeProfile(espp_pct=Decimal("0")), {LIMIT_ESPP_423: Decimal("25000")}, "none")
    )
    assert LIMIT_ESPP_423 not in items


def test_espp_enrolled_measures_against_the_423_cap():
    profile = FakeProfile(espp_pct=Decimal("0.110000000"), annual_salary=Decimal("188930.00"))
    items = by_key(paycheck_pace(profile, {LIMIT_ESPP_423: Decimal("25000.00")}, "none"))
    row = items[LIMIT_ESPP_423]
    assert row.annualized == Decimal("20782.30")
    assert row.ratio == Decimal("0.8313")
    assert row.tone == "ok"


def test_row_order_is_deferral_then_total_then_hsa_then_espp():
    profile = FakeProfile(
        after_tax_401k_pct=Decimal("0.030000000"),
        espp_pct=Decimal("0.110000000"),
        hsa_per_check=Decimal("100.00"),
    )
    keys = [item.key for item in paycheck_pace(profile, {}, "family")]
    assert keys == [LIMIT_401K_ELECTIVE, LIMIT_415C_TOTAL, LIMIT_HSA_FAMILY, LIMIT_ESPP_423]


def test_an_all_zero_profile_still_reports_the_two_401k_rows():
    """Zero contributions are information — "you are putting in nothing" is a true and
    useful meter. Only the two OPT-IN rows (HSA coverage, ESPP enrolment) disappear."""
    profile = FakeProfile(trad_401k_pct=Decimal("0"))
    items = paycheck_pace(profile, {LIMIT_401K_ELECTIVE: Decimal("24500.00")}, "none")
    assert [item.key for item in items] == [LIMIT_401K_ELECTIVE, LIMIT_415C_TOTAL]
    assert items[0].annualized == Decimal("0.00")
    assert items[0].ratio == Decimal("0.0000")
    assert items[0].tone == "ok"
```

- [ ] **Step 2: Run and watch it fail.**

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && FINANCE_TEST_DB=finance_test_p3limits .venv/Scripts/python.exe -m pytest tests/test_limit_check.py -q
```

Expected failure: `ModuleNotFoundError: No module named 'app.services.limit_check'`.

- [ ] **Step 3: Write the service.** Create `backend/app/services/limit_check.py` with COMPLETE content:

```python
"""Contribution pace against the year's entered limits (2026-08-27 spec §4.5).

Pure module — no DB, no HTTP, no clock (the paycheck_calc / tax_service posture). The
caller decides WHICH year's limits to hand over and WHOSE profile to measure; `profile`
is a paycheck_profiles row, or anything carrying its columns.

Every figure is ANNUALIZED from the profile in force, which is a projection and not a
year-to-date total: this says "at this rate you would put in X", never "you have put in
X". The app has no per-paycheck ledger, so a mid-year percentage change is invisible
here — the strip is a pace indicator and its copy says so.

Rounding contract: `annualized` is quantized to cents FIRST and the ratio is computed
from THAT, then quantized to 4 dp, and the tone is judged on the quantized ratio. So the
percentage on screen is exactly the two numbers beside it divided, and a 94.996 % that
prints as 95.00 % can never be labelled `ok` — the paycheck router's "judged on the
DISPLAYED net, so the warning can never contradict the number next to it" rule.

The division needs no zero guard: contribution_limits carries CHECK (value > 0), and the
router mirrors it with a 422, so a stored limit of zero is unrepresentable.
"""

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

from app.limit_keys import (
    HSA_LIMIT_KEY_BY_COVERAGE,
    LIMIT_401K_ELECTIVE,
    LIMIT_415C_TOTAL,
    LIMIT_ESPP_423,
    LIMIT_LABELS,
)
from app.services.paycheck_calc import half_up2

ZERO = Decimal("0")
RATIO_QUANTUM = Decimal("0.0001")
WARN_AT = Decimal("0.95")
OVER_ABOVE = Decimal("1")
# The 415(c) row names the one thing this app cannot see: employer match and profit
# sharing count against the same cap and are modeled nowhere (spec §6 caveat). The
# caveat rides the LABEL rather than a footnote so it cannot be separated from the meter.
TOTAL_ADDITIONS_CAVEAT = " (excludes employer match)"


@dataclass(frozen=True)
class PaceItem:
    """One contribution line, annualized, against the cap the user entered for the year.

    `limit` and `ratio` are None together and mean "nothing entered for this key this
    year". `tone` is then 'ok' in the sense of "no verdict" — the UI renders a
    call-to-action instead of a meter, never a fabricated 100 %.
    """

    key: str
    label: str
    annualized: Decimal
    limit: Decimal | None
    ratio: Decimal | None
    tone: str  # 'ok' | 'warn' | 'over'


def _item(key: str, label: str, annualized: Decimal, limits: dict[str, Decimal]) -> PaceItem:
    money = half_up2(annualized)
    limit = limits.get(key)
    if limit is None:
        return PaceItem(key=key, label=label, annualized=money, limit=None, ratio=None, tone="ok")
    ratio = (money / limit).quantize(RATIO_QUANTUM, rounding=ROUND_HALF_UP)
    if ratio > OVER_ABOVE:
        tone = "over"
    elif ratio >= WARN_AT:
        tone = "warn"
    else:
        tone = "ok"
    return PaceItem(key=key, label=label, annualized=money, limit=limit, ratio=ratio, tone=tone)


def paycheck_pace(profile, limits: dict[str, Decimal], hsa_coverage: str) -> list[PaceItem]:
    """The rows the Paycheck page's pace strip renders, in display order.

    Two rows are unconditional — a zero deferral is information ("you are putting in
    nothing"), and both 401(k) caps apply to everyone with a paycheck. The other two are
    OPT-IN and disappear when the opt-in is absent, because a 0-of-25,000 meter is noise.
    """
    salary = profile.annual_salary
    elective_pct = profile.trad_401k_pct + profile.roth_401k_pct
    items = [
        _item(
            LIMIT_401K_ELECTIVE,
            LIMIT_LABELS[LIMIT_401K_ELECTIVE],
            elective_pct * salary,
            limits,
        ),
        _item(
            LIMIT_415C_TOTAL,
            LIMIT_LABELS[LIMIT_415C_TOTAL] + TOTAL_ADDITIONS_CAVEAT,
            (elective_pct + profile.after_tax_401k_pct) * salary,
            limits,
        ),
    ]
    # 'none' is not a zero-dollar HSA — it is "no HDHP", so NEITHER cap applies. An
    # unrecognized string (hand-edited row) lands here too and is treated the same way:
    # picking one of the two tiers at random is the worst possible guess, and the two
    # differ by roughly 2x.
    hsa_key = HSA_LIMIT_KEY_BY_COVERAGE.get(hsa_coverage)
    if hsa_key is not None:
        items.append(
            _item(
                hsa_key,
                LIMIT_LABELS[hsa_key],
                # Per-check DOLLARS times the profile's own cadence — never a hardcoded
                # 24 (paycheck_calc's rule). Employer HSA contributions count against the
                # same cap and are not on the profile; the strip's hint says so.
                profile.hsa_per_check * Decimal(profile.pay_periods_per_year),
                limits,
            )
        )
    # espp_pct 0 is "not enrolled", which is a different statement from "enrolled at 0 %".
    if profile.espp_pct > ZERO:
        items.append(
            _item(LIMIT_ESPP_423, LIMIT_LABELS[LIMIT_ESPP_423], profile.espp_pct * salary, limits)
        )
    return items
```

- [ ] **Step 4: Run to pass.**

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && FINANCE_TEST_DB=finance_test_p3limits .venv/Scripts/python.exe -m pytest tests/test_limit_check.py -q
```

Expected: `20 passed`. If `test_espp_enrolled_measures_against_the_423_cap` disagrees on the cents, recompute `Decimal("0.110000000") * Decimal("188930.00")` at full precision and quantize — do not weaken the assertion to an approximation.

- [ ] **Step 5: Commit.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && git add -A && git commit -m "feat(limits): limit_check.paycheck_pace — annualized rows, boundary-exact tones"
```

---

### Task 5: The breakdown embeds `pace`

**Files:**
- `backend/app/schemas/paycheck.py` (`BreakdownOut` at lines 69–89)
- `backend/app/api/paycheck.py` (imports at lines 18–36; `get_breakdown` at lines 268–297)
- `backend/tests/test_paycheck_comp_api.py` (append)

- [ ] **Step 1: Write the failing endpoint test.** Append to `backend/tests/test_paycheck_comp_api.py`:

```python
async def test_breakdown_embeds_pace_for_the_current_year(auth_client, db):
    """The strip's rows ride the breakdown the page already fetches — one request, and
    the pace can never describe a different profile than the waterfall above it."""
    from datetime import date
    from decimal import Decimal

    from app.models import ContributionLimit

    db.add(
        ContributionLimit(
            year=date.today().year, key="limit_401k_elective", value=Decimal("24500.00")
        )
    )
    await db.commit()
    created = await auth_client.post(
        "/api/v1/paycheck/profiles",
        json={
            "effective_date": "2020-01-01",
            "annual_salary": "100000",
            "pay_periods_per_year": 24,
            "trad_401k_pct": "0.1",
            "espp_pct": "0",
            "hsa_per_check": "0",
        },
    )
    assert created.status_code == 201, created.text

    resp = await auth_client.get("/api/v1/paycheck/breakdown")
    assert resp.status_code == 200, resp.text
    pace = resp.json()["pace"]
    rows = {row["key"]: row for row in pace}
    assert rows["limit_401k_elective"]["annualized"] == "10000.00"
    assert rows["limit_401k_elective"]["limit"] == "24500.00"
    assert rows["limit_401k_elective"]["ratio"] == "0.4082"
    assert rows["limit_401k_elective"]["tone"] == "ok"
    # No cap entered for 415(c): null limit, null ratio, and a label that owns the caveat.
    assert rows["limit_415c_total"]["limit"] is None
    assert rows["limit_415c_total"]["ratio"] is None
    assert "excludes employer match" in rows["limit_415c_total"]["label"]


async def test_breakdown_pace_is_empty_of_optional_rows_without_them(auth_client):
    created = await auth_client.post(
        "/api/v1/paycheck/profiles",
        json={
            "effective_date": "2020-02-01",
            "annual_salary": "100000",
            "pay_periods_per_year": 24,
            "espp_pct": "0",
            "hsa_per_check": "150",
        },
    )
    assert created.status_code == 201, created.text
    resp = await auth_client.get("/api/v1/paycheck/breakdown")
    keys = [row["key"] for row in resp.json()["pace"]]
    # hsa_coverage defaults to 'self' (Plan 1), so the HSA row is present; ESPP is not.
    assert "limit_hsa_self" in keys
    assert "limit_espp_423" not in keys


async def test_breakdown_pace_measures_this_year_not_a_stored_year(auth_client, db):
    """The limits year comes from the SAME date.today() that picks the profile in force —
    entering next year's caps early must not change today's strip."""
    from datetime import date
    from decimal import Decimal

    from app.models import ContributionLimit

    db.add(
        ContributionLimit(
            year=date.today().year + 1, key="limit_401k_elective", value=Decimal("25000.00")
        )
    )
    await db.commit()
    await auth_client.post(
        "/api/v1/paycheck/profiles",
        json={
            "effective_date": "2020-03-01",
            "annual_salary": "100000",
            "pay_periods_per_year": 24,
            "trad_401k_pct": "0.1",
        },
    )
    resp = await auth_client.get("/api/v1/paycheck/breakdown")
    rows = {row["key"]: row for row in resp.json()["pace"]}
    assert rows["limit_401k_elective"]["limit"] is None
```

- [ ] **Step 2: Run and watch it fail.**

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && FINANCE_TEST_DB=finance_test_p3limits .venv/Scripts/python.exe -m pytest tests/test_paycheck_comp_api.py -q -k pace
```

Expected failure: `KeyError: 'pace'` — the response has no such field (3 failed).

- [ ] **Step 3: Add the schema.** In `backend/app/schemas/paycheck.py`, insert BEFORE `class BreakdownOut(BaseModel):`:

```python
class PaceItemOut(BaseModel):
    """One contribution line annualized from the profile in force, against the cap the
    user entered for the current year (2026-08-27 spec §4.5).

    `limit` and `ratio` are null together and mean "nothing entered for this key this
    year" — the page renders a call-to-action, never a fabricated cap. `ratio` is a 4 dp
    fraction and `tone` was judged on exactly that value, so the badge and the percentage
    can never disagree.
    """

    model_config = ConfigDict(from_attributes=True)

    key: str
    label: str
    annualized: Decimal
    limit: Decimal | None
    ratio: Decimal | None
    tone: str
```

and add the field to `BreakdownOut`, immediately after `warnings: list[str]`:

```python
    # The contribution-pace rows for THIS profile against the current year's entered
    # limits. Empty only if the profile somehow yields no rows at all — the two 401(k)
    # rows are unconditional.
    pace: list[PaceItemOut]
```

- [ ] **Step 4: Wire the endpoint.** In `backend/app/api/paycheck.py`:

Add to the model import (`from app.models import PaycheckProfile`):

```python
from app.models import ContributionLimit, PaycheckProfile
```

Add to the schema import:

```python
from app.schemas.paycheck import BreakdownOut, PaceItemOut, ProfileIn, ProfileOut, ProfileUpdate
```

Add the service import after `from app.services.paycheck_calc import breakdown, half_up2`:

```python
from app.services.limit_check import paycheck_pace
```

Then edit `get_breakdown`'s BODY only — **leave the signature exactly as Task 0 Step 5 recorded it**. Replace the profile-resolution block:

```python
    if profile_id is not None:
        profile = await _get_profile(db, profile_id)
    else:
        profile = await _default_profile(db, date.today())  # the ONLY clock read here
        if profile is None:
            raise HTTPException(status_code=404, detail="no paycheck profiles")
```

with:

```python
    # The ONLY clock read in this module, and it now decides TWO things: which profile is
    # in force, and which year's contribution limits the pace rows are measured against.
    # One read, so a request that straddles midnight on 31 December cannot pair January's
    # profile with December's caps.
    today = date.today()
    if profile_id is not None:
        profile = await _get_profile(db, profile_id)
    else:
        profile = await _default_profile(db, today)
        if profile is None:
            raise HTTPException(status_code=404, detail="no paycheck profiles")
```

If Plan 1 replaced `_default_profile(db, today)` with a person-scoped call, keep ITS call shape and only substitute the `today` local for the inline `date.today()`.

Then replace the return statement:

```python
    return BreakdownOut(profile=ProfileOut.model_validate(profile), warnings=warnings, **lines)
```

with:

```python
    limits = {
        row.key: row.value
        for row in (
            await db.execute(
                select(ContributionLimit).where(ContributionLimit.year == today.year)
            )
        ).scalars()
    }
    # No limits entered yet is the NORMAL first-run state, not an error: paycheck_pace
    # answers with null caps and the page offers a link to Settings.
    pace = [
        PaceItemOut.model_validate(item)
        for item in paycheck_pace(profile, limits, profile.hsa_coverage)
    ]
    return BreakdownOut(
        profile=ProfileOut.model_validate(profile), warnings=warnings, pace=pace, **lines
    )
```

- [ ] **Step 5: Run the paycheck suite to pass.**

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && FINANCE_TEST_DB=finance_test_p3limits .venv/Scripts/python.exe -m pytest tests/test_paycheck_comp_api.py -q
```

Expected: all green, including the three new tests. Any pre-existing test that asserts the breakdown's exact key set will need `pace` added — update the assertion, never the response.

**If the profile POST 4xx's on a missing roster:** Plan 1 made `paycheck_profiles.person_id` NOT NULL and resolves an absent `person_id` to the primary person, and `conftest.py` seeds no people. Read how the file's existing profile tests handle it — if they seed a `Person(name="Me", is_primary=True)` in a fixture, use the same one; if they do not, add `db.add(Person(name="Me", is_primary=True)); await db.commit()` before the POST in each of the three new tests. Do NOT weaken the status assertion.

- [ ] **Step 6: Run the whole backend suite (first full gate).**

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && FINANCE_TEST_DB=finance_test_p3limits .venv/Scripts/python.exe -m pytest -q
```

Expected: green. Record the count.

- [ ] **Step 7: Commit.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && git add -A && git commit -m "feat(limits): breakdown embeds pace — one request, one clock read"
```

---

## Phase 4 — The frontend

### Task 6: Types and the API client

**Files:**
- `src/types/api.ts` (paycheck block at lines 988–1043)
- `src/api/limits.ts` (new)

- [ ] **Step 1: Add the types.** In `src/types/api.ts`, append a new block at the END of the file:

```ts
// --- contribution limits ---

// The five DEFINITIONS always ride back, in the server's display order; `value` is null
// until the user enters that year's figure. The app ships no IRS numbers of its own
// (2026-08-27 spec §2), so null here means "not entered", never "zero".
export interface LimitItemOut {
  key: string
  label: string
  value: string | null
}

export interface LimitsOut {
  year: number
  items: LimitItemOut[]
}

// A PARTIAL map: an omitted key is left alone, an explicit null DELETES the year's row
// (back to "not entered") — the category-budgets tri-state.
export interface LimitsUpdate {
  values: Record<string, string | null>
}

// One contribution line annualized from the profile in force, against the year's entered
// cap. `limit`/`ratio` are null together when nothing has been entered for that key —
// the strip then links to Settings rather than drawing a fabricated 100 %.
export interface PaceItem {
  key: string
  label: string
  annualized: string
  limit: string | null
  ratio: string | null // 4dp fraction, e.g. "0.9500" — the tone was judged on THIS value
  tone: 'ok' | 'warn' | 'over'
}
```

and add the field to `PaycheckBreakdownOut`, after `warnings: string[]`:

```ts
  pace: PaceItem[]
```

- [ ] **Step 2: Write the client.** Create `src/api/limits.ts` with COMPLETE content:

```ts
import { api } from './client'
import type { LimitsOut, LimitsUpdate } from '../types/api'

// Always all five definitions; values are null until entered for that year.
export function fetchLimits(year: number): Promise<LimitsOut> {
  return api<LimitsOut>(`/limits?year=${year}`)
}

// Partial bulk upsert: omit a key to leave it alone, send an explicit null to delete the
// year's row. A value <= 0 or over Numeric(14,2) is a 422 with the key in the sentence.
export function putLimits(year: number, body: LimitsUpdate): Promise<LimitsOut> {
  return api<LimitsOut>(`/limits/${year}`, { method: 'PUT', body: JSON.stringify(body) })
}

// Seeds an EMPTY year from another one: 404 when the source has none, 409 when the
// target already has some (clear it with a null PUT first — never a merge).
export function cloneLimits(year: number, sourceYear: number): Promise<LimitsOut> {
  return api<LimitsOut>(`/limits/${year}/clone-from/${sourceYear}`, { method: 'POST' })
}
```

- [ ] **Step 3: Typecheck.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && npx tsc -b
```

Expected: this FAILS — `PaycheckPage.test.tsx`'s breakdown fixtures no longer satisfy `PaycheckBreakdownOut` (missing `pace`). That is the intended failure; it is fixed in Task 8. Record the error list and move on.

- [ ] **Step 4: Commit.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && git add -A && git commit -m "feat(limits): types + src/api/limits.ts client"
```

---

### Task 7: Settings → Contribution limits card

**Files:**
- `src/components/settings/LimitsCard.tsx` (new)
- `src/components/settings/LimitsCard.test.tsx` (new)
- `src/components/settings/settings.css` (append)
- `src/pages/SettingsPage.tsx` (imports at lines 1–18; card mounts at lines 476–487)

- [ ] **Step 1: Write the failing component test.** Create `src/components/settings/LimitsCard.test.tsx` with COMPLETE content:

```tsx
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import type { LimitsOut } from '../../types/api'
import ToastProvider from '../ToastProvider'
import LimitsCard from './LimitsCard'

vi.mock('../../api/limits', () => ({
  fetchLimits: vi.fn(),
  putLimits: vi.fn(),
  cloneLimits: vi.fn(),
}))
import { cloneLimits, fetchLimits, putLimits } from '../../api/limits'

const YEAR = new Date().getFullYear()

function payload(year: number, values: Record<string, string | null> = {}): LimitsOut {
  return {
    year,
    items: [
      { key: 'limit_401k_elective', label: '401(k) elective deferral', value: null },
      { key: 'limit_415c_total', label: '415(c) total additions', value: null },
      { key: 'limit_hsa_self', label: 'HSA — self-only', value: null },
      { key: 'limit_hsa_family', label: 'HSA — family', value: null },
      { key: 'limit_espp_423', label: 'ESPP §423 annual', value: null },
    ].map((item) => ({ ...item, value: values[item.key] ?? item.value })),
  }
}

beforeEach(() => {
  vi.mocked(fetchLimits).mockResolvedValue(payload(YEAR, { limit_401k_elective: '24500.00' }))
  vi.mocked(putLimits).mockResolvedValue(payload(YEAR, { limit_401k_elective: '24000.00' }))
  vi.mocked(cloneLimits).mockResolvedValue(payload(YEAR, { limit_hsa_self: '4400.00' }))
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

it('opens on the current year and seeds the boxes from the response', async () => {
  render(<LimitsCard />)

  await waitFor(() => expect(vi.mocked(fetchLimits)).toHaveBeenCalledWith(YEAR))
  const box = (await screen.findByLabelText('401(k) elective deferral')) as HTMLInputElement
  expect(box.value).toBe('24500.00')
  // An unentered cap is an EMPTY box, never a zero.
  expect((screen.getByLabelText('ESPP §423 annual') as HTMLInputElement).value).toBe('')
})

it('refetches when another year chip is pressed', async () => {
  render(<LimitsCard />)
  await screen.findByLabelText('401(k) elective deferral')

  fireEvent.click(screen.getByRole('button', { name: String(YEAR + 1) }))

  await waitFor(() => expect(vi.mocked(fetchLimits)).toHaveBeenCalledWith(YEAR + 1))
})

it('saves every box in one PUT, with blanks as explicit nulls', async () => {
  render(<LimitsCard />)
  await screen.findByLabelText('401(k) elective deferral')

  fireEvent.change(screen.getByLabelText('401(k) elective deferral'), {
    target: { value: '24000' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save limits' }))

  await waitFor(() => expect(vi.mocked(putLimits)).toHaveBeenCalledTimes(1))
  expect(vi.mocked(putLimits).mock.calls[0]).toEqual([
    YEAR,
    {
      values: {
        limit_401k_elective: '24000',
        limit_415c_total: null,
        limit_hsa_self: null,
        limit_hsa_family: null,
        limit_espp_423: null,
      },
    },
  ])
})

it('re-seeds the boxes from the PUT response, not from what was typed', async () => {
  render(<LimitsCard />)
  await screen.findByLabelText('401(k) elective deferral')

  fireEvent.change(screen.getByLabelText('401(k) elective deferral'), {
    target: { value: '24000' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save limits' }))

  await waitFor(() =>
    expect((screen.getByLabelText('401(k) elective deferral') as HTMLInputElement).value).toBe(
      '24000.00',
    ),
  )
  expect(screen.getByText('Saved.')).toBeTruthy()
})

it('clones from the prior year and shows the cloned values', async () => {
  render(<LimitsCard />)
  await screen.findByLabelText('401(k) elective deferral')

  fireEvent.click(screen.getByRole('button', { name: `Clone from ${YEAR - 1}` }))

  await waitFor(() => expect(vi.mocked(cloneLimits)).toHaveBeenCalledWith(YEAR, YEAR - 1))
  await waitFor(() =>
    expect((screen.getByLabelText('HSA — self-only') as HTMLInputElement).value).toBe('4400.00'),
  )
})

it('surfaces a 409 clone as a toast and leaves the boxes alone', async () => {
  vi.mocked(cloneLimits).mockRejectedValue(
    new ApiError(`${YEAR} already has 2 contribution limits`, 409),
  )
  render(
    <ToastProvider>
      <LimitsCard />
    </ToastProvider>,
  )
  await screen.findByLabelText('401(k) elective deferral')

  fireEvent.click(screen.getByRole('button', { name: `Clone from ${YEAR - 1}` }))

  const toast = await screen.findByText(`${YEAR} already has 2 contribution limits`)
  expect(toast.className).toBe('toast-message')
  expect((screen.getByLabelText('401(k) elective deferral') as HTMLInputElement).value).toBe(
    '24500.00',
  )
})

it('banners a save 422 verbatim', async () => {
  vi.mocked(putLimits).mockRejectedValue(new ApiError('limit_hsa_self must be positive', 422))
  render(<LimitsCard />)
  await screen.findByLabelText('401(k) elective deferral')

  fireEvent.click(screen.getByRole('button', { name: 'Save limits' }))

  expect(await screen.findByText('limit_hsa_self must be positive')).toBeTruthy()
})

it('banners a failed load and refetches on Retry', async () => {
  vi.mocked(fetchLimits)
    .mockRejectedValueOnce(new ApiError('limits unavailable', 503))
    .mockResolvedValue(payload(YEAR))
  render(<LimitsCard />)

  expect(await screen.findByText('limits unavailable')).toBeTruthy()
  expect(screen.queryByLabelText('401(k) elective deferral')).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(await screen.findByLabelText('401(k) elective deferral')).toBeTruthy()
  expect(vi.mocked(fetchLimits)).toHaveBeenCalledTimes(2)
})

it('says the app ships no values of its own', async () => {
  render(<LimitsCard />)
  const card = within(await screen.findByRole('region', { name: 'Contribution limits' }))
  expect(card.getByText(/publishes new figures every year/i)).toBeTruthy()
})
```

- [ ] **Step 2: Run and watch it fail.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && npx vitest run src/components/settings/LimitsCard.test.tsx
```

Expected failure: `Failed to resolve import "./LimitsCard"`.

- [ ] **Step 3: Write the card.** Create `src/components/settings/LimitsCard.tsx` with COMPLETE content:

```tsx
import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../api/client'
import { cloneLimits, fetchLimits, putLimits } from '../../api/limits'
import type { LimitsOut } from '../../types/api'
import AmountInput from '../AmountInput'
import InfoHint from '../InfoHint'
import { useToast } from '../ToastProvider'
import '../panels.css'
import './settings.css'

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

// The boxes a payload seeds, as pure string math at MODULE scope (SettingsPage's rule):
// the load chain, the PUT echo and the clone echo all apply it, and a component-scope
// helper would make `load` reactive and owe the effect a dependency.
function boxesFor(payload: LimitsOut): Record<string, string> {
  return Object.fromEntries(payload.items.map((item) => [item.key, item.value ?? '']))
}

/**
 * The Settings Contribution-limits card (2026-08-27 spec §5): the per-year registry the
 * pace strip on the Paycheck page measures against.
 *
 * The app ships NO values — the brackets philosophy (spec §2). The five DEFINITIONS come
 * from the server (labels and order are the code's), and every number is the user's. A
 * blank box is not a zero: it saves as an explicit null, which DELETES the row and puts
 * the key back to "not entered" — the state the pace strip renders a call-to-action for.
 */
export default function LimitsCard() {
  // Three years is the whole useful window: last year to clone from, this year to edit,
  // next year to enter in the autumn when the IRS publishes.
  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState(currentYear)
  const [items, setItems] = useState<LimitsOut['items'] | null>(null)
  const [boxes, setBoxes] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [savedNote, setSavedNote] = useState(false)
  const seqRef = useRef(0)
  const toast = useToast()

  // A plain function over stable setters, called from the effect and from Retry — a
  // useCallback here would trip preserve-manual-memoization (SettingsPage's wall).
  const load = (forYear: number) => {
    const seq = ++seqRef.current
    fetchLimits(forYear)
      .then((payload) => {
        if (seq !== seqRef.current) return
        setItems(payload.items)
        setBoxes(boxesFor(payload))
        setError(null)
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        // The previous year's boxes are DROPPED with the items: this card's whole
        // content is about one year, and boxes left standing under a new year's heading
        // would offer to save last year's numbers into it.
        setItems(null)
        setError(message(err, 'Could not load contribution limits.'))
      })
  }

  useEffect(() => {
    load(year)
    // `year` only: `load` is a plain function over stable setters (house idiom).
  }, [year])

  const pickYear = (next: number) => {
    if (next === year) return
    setSavedNote(false)
    setError(null)
    setYear(next)
  }

  const edit = (key: string) => (value: string) => {
    setBoxes((current) => ({ ...current, [key]: value }))
    // Every keystroke retires the sentence under the form: it describes the values that
    // WERE in the boxes (SettingsPage's rule).
    setSavedNote(false)
    setError(null)
  }

  const save = () => {
    if (items === null) return
    // ALL FIVE keys, every time — a cleared box must DELETE the row, and an omitted key
    // is "leave it alone" server-side. The text travels AS TYPED: the server quantizes
    // and 422s, and a client that pre-empted it would be a second opinion.
    const values = Object.fromEntries(
      items.map((item) => {
        const typed = (boxes[item.key] ?? '').trim()
        return [item.key, typed === '' ? null : typed]
      }),
    )
    setBusy(true)
    setError(null)
    setSavedNote(false)
    putLimits(year, { values })
      .then((payload) => {
        // Re-seeded from the RESPONSE: the server answers with what it stored (quantized
        // to cents), and boxes holding the typed text would read as unsaved work against
        // values that are already in the database.
        setItems(payload.items)
        setBoxes(boxesFor(payload))
        setSavedNote(true)
      })
      .catch((err: unknown) => setError(message(err, 'Could not save the limits.')))
      .finally(() => setBusy(false))
  }

  const clone = () => {
    setBusy(true)
    setError(null)
    setSavedNote(false)
    cloneLimits(year, year - 1)
      .then((payload) => {
        setItems(payload.items)
        setBoxes(boxesFor(payload))
      })
      // The 404/409 sentences are the server's and they are about the YEAR rather than
      // any one box, so they ride the toast layer (AccountsCard's delete posture).
      .catch((err: unknown) => toast.error(message(err, 'Clone failed')))
      .finally(() => setBusy(false))
  }

  return (
    <section className="card span-6" role="region" aria-label="Contribution limits">
      <h2 className="eyebrow">
        Contribution limits
        <InfoHint text="Your own per-year caps. The dashboard ships none of its own — enter the year's published figures and the Paycheck page grades your contributions against them. A blank box means 'not entered', which the pace strip says out loud." />
      </h2>
      <div className="segmented" role="group" aria-label="Limit year">
        {[currentYear - 1, currentYear, currentYear + 1].map((option) => (
          <button
            key={option}
            type="button"
            className={option === year ? 'active' : ''}
            aria-pressed={option === year}
            onClick={() => pickYear(option)}
          >
            {option}
          </button>
        ))}
      </div>
      {error && (
        <div className="error-banner" role="alert">
          {error}{' '}
          <button className="button" onClick={() => load(year)}>
            Retry
          </button>
        </div>
      )}
      {items === null && error === null && <p className="empty-note">Loading…</p>}
      {items !== null && (
        <form
          className="settings-card-form"
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
        >
          {items.map((item) => (
            <label key={item.key}>
              {item.label}
              <AmountInput
                value={boxes[item.key] ?? ''}
                onValueChange={edit(item.key)}
                placeholder="not entered"
                disabled={busy}
                aria-label={item.label}
              />
            </label>
          ))}
          <p className="settings-note">
            The IRS publishes new figures every year, so the dashboard stores yours rather
            than shipping a table that would be wrong by January. Clearing a box deletes
            that year&apos;s value.
          </p>
          <div className="settings-card-actions">
            <button type="submit" className="button button-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save limits'}
            </button>
            <button type="button" className="button" disabled={busy} onClick={clone}>
              {`Clone from ${year - 1}`}
            </button>
          </div>
          {savedNote && (
            <p className="settings-note" role="status">
              Saved.
            </p>
          )}
        </form>
      )}
    </section>
  )
}
```

- [ ] **Step 4: Add the card's CSS.** Append to `src/components/settings/settings.css`:

```css
/* Contribution limits (2026-08-27 spec §5): the year chips sit above a single-column
   form of five currency boxes — narrow rows, because every value is a plain dollar cap
   and the labels carry the meaning. */
.settings-page .card [role='group'][aria-label='Limit year'] {
  margin-bottom: 0.75rem;
}
```

- [ ] **Step 5: Run the card test to pass.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && npx vitest run src/components/settings/LimitsCard.test.tsx
```

Expected: `9 passed`. If `AmountInput`'s blurred echo interferes with a `.value` assertion, read `src/components/AmountInput.tsx` — the box keeps the parent's raw string in state and only the DISPLAY changes on blur, so assert on the input's value while it is unfocused exactly as the tests above do.

- [ ] **Step 6: Mount it in Settings.** In `src/pages/SettingsPage.tsx` add the import after the `HouseholdCard` import:

```tsx
import LimitsCard from '../components/settings/LimitsCard'
```

and mount it after `<AccountsCard people={people} />`:

```tsx
          {/* Contribution limits (2026-08-27 spec §5): its own fetch and error state, the
              same loadedOnce gate as the cards above it. */}
          <LimitsCard />
```

- [ ] **Step 7: Run the Settings page test.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && npx vitest run src/pages/SettingsPage.test.tsx
```

Expected: green. If a test asserts the exact number of `<section className="card">` elements, update the count — the card is real.

- [ ] **Step 8: Commit.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && git add -A && git commit -m "feat(limits): Settings contribution-limits card — year chips, bulk save, clone"
```

---

### Task 8: Paycheck pace strip

**Files:**
- `src/components/paycheck/PacePanel.tsx` (new)
- `src/components/paycheck/PacePanel.test.tsx` (new)
- `src/components/paycheck/pace.css` (new)
- `src/pages/PaycheckPage.tsx` (mount point from Task 0 Step 6)
- `src/pages/PaycheckPage.test.tsx` (fixtures + `MemoryRouter` wrapper)

- [ ] **Step 1: Write the failing panel test.** Create `src/components/paycheck/PacePanel.test.tsx` with COMPLETE content:

```tsx
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it } from 'vitest'
import type { PaceItem } from '../../types/api'
import PacePanel from './PacePanel'

const OK: PaceItem = {
  key: 'limit_401k_elective',
  label: '401(k) elective deferral',
  annualized: '10000.00',
  limit: '24500.00',
  ratio: '0.4082',
  tone: 'ok',
}
const WARN: PaceItem = {
  key: 'limit_hsa_self',
  label: 'HSA — self-only',
  annualized: '4200.00',
  limit: '4400.00',
  ratio: '0.9545',
  tone: 'warn',
}
const OVER: PaceItem = {
  key: 'limit_espp_423',
  label: 'ESPP §423 annual',
  annualized: '27000.00',
  limit: '25000.00',
  ratio: '1.0800',
  tone: 'over',
}
const MISSING: PaceItem = {
  key: 'limit_415c_total',
  label: '415(c) total additions (excludes employer match)',
  annualized: '16000.00',
  limit: null,
  ratio: null,
  tone: 'ok',
}

const renderPanel = (items: PaceItem[]) =>
  render(<PacePanel items={items} />, { wrapper: MemoryRouter })

afterEach(cleanup)

it('draws one meter per item with the figures in its label', () => {
  renderPanel([OK, WARN, OVER])

  const meters = screen.getAllByRole('meter')
  expect(meters).toHaveLength(3)
  expect(meters[0].getAttribute('aria-valuetext')).toBe('$10,000.00 of $24,500.00')
  expect(meters[0].getAttribute('aria-valuenow')).toBe('41')
})

it('carries the tone on the fill and in words', () => {
  renderPanel([OK, WARN, OVER])

  const rows = screen.getAllByRole('meter')
  expect(rows[0].querySelector('.pace-fill')?.className).toBe('pace-fill is-ok')
  expect(rows[1].querySelector('.pace-fill')?.className).toBe('pace-fill is-warn')
  expect(rows[2].querySelector('.pace-fill')?.className).toBe('pace-fill is-over')
  // Over-ness is redundant with colour — a position tick AND a word (CVD-safe).
  expect(rows[2].querySelector('.pace-overflow-tick')).toBeTruthy()
  expect(screen.getByText('over')).toBeTruthy()
})

it('clamps the fill at the track end and still reports the true percentage', () => {
  renderPanel([OVER])

  const meter = screen.getByRole('meter')
  expect((meter.querySelector('.pace-fill') as HTMLElement).style.width).toBe('100.00%')
  expect(screen.getByText('108.0%')).toBeTruthy()
})

it('renders a call to action instead of a meter when the limit is missing', () => {
  renderPanel([MISSING])

  expect(screen.queryByRole('meter')).toBeNull()
  const link = screen.getByRole('link', { name: "enter this year's limit" })
  expect(link.getAttribute('href')).toBe('/settings')
  // The annualized figure is still real and still shown — only the verdict is withheld.
  expect(screen.getByText('$16,000.00')).toBeTruthy()
})

it('names the employer-match caveat the server put in the label', () => {
  renderPanel([MISSING])
  expect(screen.getByText(/excludes employer match/)).toBeTruthy()
})

it('says the figures are a projection, not a year-to-date total', () => {
  renderPanel([OK])
  const card = within(screen.getByRole('region', { name: 'Contribution pace' }))
  expect(card.getByText(/at this rate/i)).toBeTruthy()
})

it('renders nothing at all when there are no items', () => {
  const { container } = renderPanel([])
  expect(container.firstChild).toBeNull()
})
```

- [ ] **Step 2: Run and watch it fail.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && npx vitest run src/components/paycheck/PacePanel.test.tsx
```

Expected failure: `Failed to resolve import "./PacePanel"`.

- [ ] **Step 3: Write the panel.** Create `src/components/paycheck/PacePanel.tsx` with COMPLETE content:

```tsx
import { Link } from 'react-router-dom'
import type { PaceItem } from '../../types/api'
import { formatCurrency } from '../../utils/format'
import InfoHint from '../InfoHint'
import '../panels.css'
import './pace.css'

// The meter's fill is CLAMPED at the track's end; the percentage beside it is not. A
// 108 % bar that overflowed its container would be a layout bug reading as data.
function fillPct(ratio: string): number {
  return Math.min(Number(ratio) * 100, 100)
}

const TONE_WORD: Record<PaceItem['tone'], string> = {
  ok: 'on pace',
  warn: 'near the cap',
  over: 'over',
}

/**
 * The contribution-pace strip (2026-08-27 spec §5): one meter per contribution line,
 * annualized from the profile in force against the year's entered caps.
 *
 * Plain HTML/CSS in the BudgetPanel meter family — same 4px track, same
 * position-channel tick for over-ness — deliberately in its own sheet rather than
 * importing a spending stylesheet into a paycheck component.
 *
 * A row with no limit renders NO meter: the app ships no IRS values, and drawing a bar
 * against a cap nobody entered would be a fabricated number. It gets the call to action
 * instead (spec §6).
 */
export default function PacePanel({ items }: { items: PaceItem[] }) {
  // Nothing to say rather than an empty card: the two 401(k) rows are unconditional
  // server-side, so an empty list only happens when there is no profile at all — and the
  // page is already saying that above.
  if (items.length === 0) return null
  return (
    <section className="card" role="region" aria-label="Contribution pace">
      <h2 className="eyebrow">
        Contribution pace
        <InfoHint text="Each contribution line annualized from the paycheck profile in force, against the caps you entered in Settings. A projection at today's percentages — not a year-to-date total, which this app has no per-paycheck ledger to compute. Employer 401(k) match and employer HSA contributions count against the same caps and are not modeled." />
      </h2>
      <p className="drill-hint">
        At this rate, over a full year — not what you have contributed so far. Change a
        percentage mid-year and this moves with it.
      </p>
      <div className="pace-rows">
        {items.map((item) => (
          <div className="pace-row" key={item.key}>
            <span className="pace-name">{item.label}</span>
            {item.limit === null || item.ratio === null ? (
              <>
                <span className="pace-figures">{formatCurrency(item.annualized)}</span>
                <span className="pace-cta">
                  <Link to="/settings">enter this year&apos;s limit</Link>
                </span>
              </>
            ) : (
              <>
                <div
                  className="pace-meter"
                  role="meter"
                  aria-label={`${item.label} annualized vs limit`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(Number(item.ratio) * 100)}
                  aria-valuetext={`${formatCurrency(item.annualized)} of ${formatCurrency(item.limit)}`}
                >
                  <div
                    className={`pace-fill is-${item.tone}`}
                    style={{ width: `${fillPct(item.ratio).toFixed(2)}%` }}
                  />
                  {item.tone === 'over' && (
                    <span className="pace-overflow-tick" aria-hidden="true" />
                  )}
                </div>
                <span className={`pace-figures tone-${item.tone}`}>
                  {`${formatCurrency(item.annualized)} / ${formatCurrency(item.limit)}`}
                </span>
                {/* The tone in WORDS as well as colour — the meter's own aria-valuetext
                    carries the dollars, and this carries the verdict. */}
                <span className={`pace-verdict tone-${item.tone}`}>
                  {`${(Number(item.ratio) * 100).toFixed(1)}%`}
                  <span className="pace-verdict-word">{TONE_WORD[item.tone]}</span>
                </span>
              </>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 4: Write the stylesheet.** Create `src/components/paycheck/pace.css` with COMPLETE content:

```css
/* Contribution-pace meters (2026-08-27 spec §5): the BudgetPanel meter grammar — thin
   4px rounded tracks, figures in the app's text tokens — with three tones instead of
   two. Its own sheet rather than an import of the spending one: a paycheck component
   must not depend on a spending stylesheet's class names. */

.pace-rows {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.pace-row {
  display: grid;
  grid-template-columns: minmax(150px, 240px) 1fr minmax(160px, auto) minmax(90px, auto);
  align-items: center;
  gap: 0.75rem;
}

.pace-name {
  font-size: 0.85rem;
  color: var(--text);
}

.pace-meter {
  position: relative;
  height: 4px;
  border-radius: 2px;
  background: var(--surface-2);
}

.pace-fill {
  height: 100%;
  border-radius: 2px;
}

.pace-fill.is-ok {
  background: var(--accent);
}

.pace-fill.is-warn {
  background: var(--warn);
}

.pace-fill.is-over {
  background: var(--negative);
}

/* The beyond-100% marker: a small negative-toned tick just past the track's end — a
   POSITION channel for over-ness, redundant with the colour (CVD-safe), exactly as the
   budget meters do it. */
.pace-overflow-tick {
  position: absolute;
  top: -3px;
  right: -6px;
  width: 3px;
  height: 10px;
  border-radius: 1px;
  background: var(--negative);
}

.pace-figures {
  font-family: ui-monospace, 'Cascadia Mono', 'Segoe UI Mono', Menlo, Consolas, monospace;
  font-variant-numeric: tabular-nums;
  font-size: 0.8rem;
  text-align: right;
  color: var(--muted);
}

.pace-verdict {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
  color: var(--muted);
}

.pace-verdict-word {
  font-size: 0.7rem;
  text-transform: lowercase;
}

.pace-figures.tone-warn,
.pace-verdict.tone-warn {
  color: var(--warn);
}

.pace-figures.tone-over,
.pace-verdict.tone-over {
  color: var(--negative);
}

.pace-cta {
  grid-column: 3 / -1;
  font-size: 0.78rem;
  color: var(--muted);
}

@media (max-width: 720px) {
  .pace-row {
    grid-template-columns: 1fr auto;
  }

  .pace-meter {
    grid-column: 1 / -1;
  }
}
```

- [ ] **Step 5: Run the panel test to pass.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && npx vitest run src/components/paycheck/PacePanel.test.tsx
```

Expected: `7 passed`.

- [ ] **Step 6: Mount it on the page.** In `src/pages/PaycheckPage.tsx`:

Add the import beside the other component imports:

```tsx
import PacePanel from '../components/paycheck/PacePanel'
```

Then, at the mount point recorded in Task 0 Step 6 (or, on the fallback path, immediately after `<BreakdownPanel data={breakdown} still={fromCache} />`), insert:

```tsx
          {/* Pace strip (2026-08-27 spec §5): the SAME payload as the waterfall above, so
              the rows can never describe a different profile than the check they sit
              under. */}
          <PacePanel items={breakdown.pace} />
```

- [ ] **Step 7: Fix the page's fixtures and router context.** In `src/pages/PaycheckPage.test.tsx`:

1. Add `pace: []` to every `PaycheckBreakdownOut` fixture object (the ones built near the top of the file, after `warnings`). An empty array is the honest default for fixtures that are not about the strip — `PacePanel` renders nothing for it.
2. `PacePanel` uses `<Link>`, so every render needs router context. Check first:

```bash
cd /c/Users/edyli/personal-finance-dashboard && grep -n "MemoryRouter" src/pages/PaycheckPage.test.tsx
```

If there is NO match, add `import { MemoryRouter } from 'react-router-dom'` as the second import line and replace **all 36** occurrences of `render(<PaycheckPage />)` with `render(<PaycheckPage />, { wrapper: MemoryRouter })` (the EsppPage.test.tsx idiom — use a single `replace_all` edit). If Plan 3 already added `MemoryRouter`, replace only the occurrences that are still bare.
3. Add one test that proves the strip is on the page, at the end of the file:

```tsx
it('renders the pace strip under the waterfall', async () => {
  vi.mocked(fetchBreakdown).mockResolvedValue({
    ...breakdown2026,
    pace: [
      {
        key: 'limit_401k_elective',
        label: '401(k) elective deferral',
        annualized: '24560.90',
        limit: '24500.00',
        ratio: '1.0025',
        tone: 'over',
      },
    ],
  })
  render(<PaycheckPage />, { wrapper: MemoryRouter })

  expect(await screen.findByRole('region', { name: 'Contribution pace' })).toBeTruthy()
  expect(screen.getByRole('meter')).toBeTruthy()
})
```

(Use whatever the file's existing breakdown fixture is actually called in place of `breakdown2026` — read the fixture block first.)

- [ ] **Step 8: Run the page test.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && npx vitest run src/pages/PaycheckPage.test.tsx
```

Expected: green, including the new test.

- [ ] **Step 9: Typecheck, lint, and the full frontend suite.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && npx tsc -b && npm run lint && npm test
```

Expected: all three clean. `tsc -b` should now be green — Task 6 Step 3's failure was exactly the missing `pace` on these fixtures.

- [ ] **Step 10: Commit.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && git add -A && git commit -m "feat(limits): Paycheck contribution-pace strip — three tones, CTA when a cap is missing"
```

---

## Phase 5 — Batch verification

### Task 9: Full gates + real-data browser smoke (ORCHESTRATOR-EXECUTED)

This task verifies the WHOLE 2026-08-27 batch (Plans 1–4), not just this plan. It is the
last thing that runs and the orchestrator runs it — do not delegate it to a task subagent,
because the browser half needs the user's real database and the running dev servers.

**Files:** none (verification only; any fix found here gets its own commit)

- [ ] **Step 1: Full backend suite.**

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && FINANCE_TEST_DB=finance_test_p3limits .venv/Scripts/python.exe -m pytest -q
```

Expected: green, count >= the 1042 baseline plus the batch's new tests. Record the exact number. A failure here is a STOP.

- [ ] **Step 2: Migration head is single and clean.**

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && .venv/Scripts/python.exe -m alembic heads && .venv/Scripts/python.exe -m alembic check
```

Expected: exactly one head (`b5f2c8d31e7a` unless a later plan added one), and `check` reports no new operations. Record the head.

- [ ] **Step 3: Frontend gates, in this order.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && npm test
cd /c/Users/edyli/personal-finance-dashboard && npx tsc -b
cd /c/Users/edyli/personal-finance-dashboard && npm run lint
cd /c/Users/edyli/personal-finance-dashboard && npm run build
```

Expected: green, green, clean (0 errors, 0 warnings), and a successful production build. Record the vitest count against the 1168 baseline.

- [ ] **Step 4: Start the dev servers against the REAL database** (not the test one) and wait for both to answer.

```bash
cd /c/Users/edyli/personal-finance-dashboard/backend && .venv/Scripts/python.exe -m uvicorn app.main:app --port 8000
cd /c/Users/edyli/personal-finance-dashboard && npm run dev
```

Run each in the background. Confirm `http://localhost:8000/api/v1/health` answers and the Vite URL loads. Sign in as the user.

- [ ] **Step 5: Browser smoke — Settings → Contribution limits.**
  - [ ] Open `/settings`, scroll to **Contribution limits**. The card shows three year chips with the CURRENT year active and five labelled boxes, all empty.
  - [ ] Type this year's published figures into all five boxes; press **Save limits**. The boxes re-render at 2 dp and "Saved." appears.
  - [ ] Press the **next-year** chip. All five boxes are empty (years are independent).
  - [ ] Press **Clone from {current year}**. All five fill with the values just saved.
  - [ ] Press **Clone from {current year}** again. A toast appears carrying the server's 409 sentence, and the boxes do not change.
  - [ ] Clear one box on the next-year tab and Save. It comes back empty (the row was deleted, not zeroed).
  - [ ] Return to the current-year chip — its values are intact.

- [ ] **Step 6: Browser smoke — Paycheck.**
  - [ ] Open `/paycheck`. If the household has two people with profiles, the **person chips** are present (Plan 3); press each and confirm the waterfall heading, the flow and the profile table all follow the selected person.
  - [ ] Confirm the **household take-home tile** renders with 2+ profiles and is ABSENT with one.
  - [ ] Under the waterfall, the **Contribution pace** strip renders one row per line. With this year's limits entered, meters are drawn; the row order is elective deferral, 415(c), HSA, ESPP.
  - [ ] Confirm the 415(c) row's label carries "excludes employer match".
  - [ ] Edit the profile's `hsa_coverage` select to **family**, save, and confirm the HSA row's label and cap switch to the family tier; set it to **none** and confirm the HSA row disappears entirely.
  - [ ] Temporarily clear one limit in Settings and reload `/paycheck`: that row shows the dollar figure and an "enter this year's limit" link that navigates to `/settings` **without a full page reload**. Restore the limit afterwards.
  - [ ] If any row is genuinely over or near its cap on the real data, confirm the tone colour, the position tick and the word all agree with the percentage.

- [ ] **Step 7: Browser smoke — Taxes withholding panel.**
  - [ ] Open `/taxes` for a married year and scroll to the withholding tracker.
  - [ ] With a partner paycheck profile present, the partner heading reads **"Partner — simulated"** and the facts list shows the simulated figures with the "from their paycheck profile" provenance line.
  - [ ] Delete (or date out) the partner profile, reload, and confirm the heading falls back to **"Partner — entered, not simulated"** with the P2 warning intact. Restore the profile.

- [ ] **Step 8: Browser smoke — Overview money flow.** This is the chart class that caused the 2026-08-25 production incident, so it is smoked with REAL data every time.
  - [ ] Open `/` on a MARRIED year that has partner W-2 input rows. The money-flow sankey renders **two** salary source nodes, labelled with each person's name, with no console error.
  - [ ] Switch to a single year (or a year with no partner W-2 rows). Exactly **one** unlabelled `Salary` node renders, byte-identically to before the batch.
  - [ ] Open the browser console and confirm it is clean across both — specifically no ECharts `setOption` TypeError.

- [ ] **Step 9: Browser smoke — Calendar.**
  - [ ] Open `/calendar` on a month with paydays. With two people holding profiles, payday chips carry the person's name (`Payday — <name>`); with one, they are unlabelled as before.
  - [ ] Confirm a same-date collision renders two labelled chips rather than one.

- [ ] **Step 10: Record the outcome.**
  - [ ] Write the pytest count, the vitest count, the alembic head, and the browser results into the run report.
  - [ ] Anything that looks deletable (a superseded helper, a now-unused fallback, a stale fixture) goes on the **morning list** — this batch deletes nothing.
  - [ ] Any defect found in Steps 5–9 gets a `fix(...)` commit of its own and a re-run of the affected gate; do not fold fixes into the feature commits above.
  - [ ] **Do not push.** The batch stays on the local branch for the user's review.

- [ ] **Step 11: Final commit** (only if Step 10 produced changes).

```bash
cd /c/Users/edyli/personal-finance-dashboard && git add -A && git commit -m "fix(limits): batch verification follow-ups"
```

---

## Forward notes

- **The registry is generic on purpose.** Adding `limit_ira_traditional` or a 50+ catch-up tier is a one-line edit to `LIMIT_DEFINITIONS` in `backend/app/limit_keys.py` plus a label — no migration, no schema change, and the Settings card grows a box because it renders whatever the server lists. A key REMOVED from the definitions keeps its stored rows (nothing deletes them) and simply becomes invisible; re-adding it later finds the user's numbers intact.
- **415(c) is knowingly incomplete.** Employer match and profit sharing count against the same cap and the app models neither, so the row's own label carries the caveat. Estimating the match needs a match-formula field on the profile — deliberately out of scope (spec §2 out-of-scope list).
- **HSA is knowingly incomplete in the same way.** Employer HSA contributions count against the same cap and live only in tax inputs (`w2_employer_hsa`), which this pure module never sees. Reconciling limit indicators against tax inputs is explicitly deferred (spec §2).
- **Pace is a projection, not a ledger.** There is no per-paycheck history table, so a percentage changed in July makes the whole year look like July. The strip's copy says so; a true year-to-date figure would need the ledger the app does not have.
