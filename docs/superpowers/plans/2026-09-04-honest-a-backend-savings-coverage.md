# Honest numbers — Lane A (category kinds, one savings definition, coverage honesty) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The server half of `docs/superpowers/specs/2026-09-04-honest-numbers-design.md` §1–§3: `spending_categories.kind` (living/tax/transfer) with its one migration, a single `services/savings.py` that defines living spend / tax paid / transfers / cash savings / payroll savings / both rates, a single `services/coverage.py` that defines entered / empty / missing, and every GET that reads them — matrix, yearly, coverage, projection, money flow, health checks, assistant context — wired to those two definitions instead of to seven local ones.

**Architecture:** Two new pure-plus-one-loader service modules own the vocabulary; every router becomes a caller. `services/savings.py` holds `payroll_monthly` (moved out of `api/projection.py` and re-imported by it), `payroll_by_month`, `month_savings`/`compose_months` (per-month figures) and `rollup`/`matched_months` (period figures). `services/coverage.py` holds `classify` (pure) and `load_coverage` (one query per table) and returns the seven month lists that `GET /coverage` serves and three health checks read. Routers do no savings arithmetic of their own: they load rows, hand them to a service, and quantize rates once on the way out.

**Tech Stack:** FastAPI, SQLAlchemy 2.0 async, Alembic, Pydantic 2, pytest (async), ruff.

**Worktree / commands:** Worktree `.worktrees/honest-a`, branch `honest-a` off `main`. `<venv-python>` = `C:/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe` (the repo venv, shared by every worktree). Run everything from `<worktree>/backend`:

- tests: `FINANCE_TEST_DB=finance_test_ha <venv-python> -m pytest tests/<file> -q`
- lint: `<venv-python> -m ruff check app tests` and `<venv-python> -m ruff format --check app tests`
- migrations: `<venv-python> -m alembic heads` (must print exactly ONE head)

House rules for every task: server-owned `Decimal` math quantized once (never twice); comments say WHY, not what; LF line endings; one commit per task; **never push**.

**Lane boundary (merge note):** lane B edits `backend/app/api/spending.py`'s **PUT** handler (`put_month`, `confirm_zero`) and `api/net_worth.py` / `importer/apply.py`. This lane touches only the GET routes (`matrix`, `yearly`), the module-level helpers above them, `schemas/*` and the two new services. Do not reformat or re-order `put_month`; A merges first and B rebases.

---

## Definitions this lane pins (resolved from the spec)

These sentences are the contract every task below is written against. Read them before Task 1.

| Term | Definition used here | Where |
|---|---|---|
| `living` / `tax` / `transfer` | category `kind`, NOT NULL, default `living` | Task 1 |
| `living_spend(m)` | Σ amounts of `living` categories in month m | Task 3 |
| `cash_savings(m)` | `net_pay − living_spend − tax_paid`; None when net pay is absent | Task 3 |
| `payroll_savings(m)` | Σ over people of `payroll_monthly(profile in force on the 1st of m)`, each person's figure rounded to cents first; **0.00 when net pay is absent** | Task 3 |
| `cash_rate` / `total_rate` | `cash_savings / net_pay` and `total_savings / (net_pay + payroll_savings)`; **both None when net pay is absent or 0** ("same guard", spec §2) | Task 3 |
| **matched** month | has at least one spending ROW **and** a net-pay row. A confirmed all-zero month with net pay counts (it is a real "spent nothing" month); a net-pay-only month with no rows does not (there is no spend to average — Task 7's health note is what surfaces it) | Task 3 |
| **entered** month | at least one NON-ZERO amount **or** a net-pay row | Task 6 |
| **empty** month | has rows, all `$0.00`, and no net pay | Task 6 |
| **missing** month | inside the balances window (first…last snapshot month, inclusive) with no spending rows and no net pay | Task 6 |

Two ambiguities resolved, both flagged again in the self-review:

1. **`YearRollup.total` / `by_category` / `net_pay_total` keep today's meaning** (every month of the year, every kind). Only the NEW fields — `living_total`, `tax_total`, `transfer_total`, `cash_savings`, `payroll_savings`, `total_savings`, `savings_rate`, `total_savings_rate` — are computed over MATCHED months, and `months_matched` names how many that was. The rates' denominator is the matched-month net-pay sum, not `net_pay_total`: a numerator and denominator drawn from different months is exactly the dishonesty §0 documents.
2. **The shared entered/empty/missing helper lives in a new `services/coverage.py`**, not in `api/coverage.py`. `services/health_checks.py` must not import an `api` module (that reverse edge exists only in `assistant_context.py`, and only deliberately).

---

## File structure

| File | Responsibility |
|---|---|
| `backend/app/models/spending.py` (modify) | `SpendingCategory.kind` + its CHECK |
| `backend/alembic/versions/20260904_0914_e5a7c1d3f6b8_spending_category_kind.py` (new) | the ONE migration this program writes: add the column, seed by slug/name |
| `backend/app/schemas/spending.py` (modify) | `kind` on `CategoryOut`/`CategoryCreate`/`CategoryUpdate`; new `MatrixOut` / `YearRollup` fields |
| `backend/app/api/spending.py` (modify, GET side only) | `matrix` and `yearly` read `services/savings.py` |
| `backend/app/services/savings.py` (new) | the ONLY definition of living/tax/transfer, cash + payroll savings, both rates, matched months |
| `backend/tests/test_savings_service.py` (new) | table-driven unit tests for the above |
| `backend/app/services/coverage.py` (new) | the ONLY definition of entered/empty/missing + `load_coverage` |
| `backend/tests/test_coverage_service.py` (new) | classification incl. net-pay-only and zero-with-net-pay months |
| `backend/app/schemas/coverage.py` (modify) | `spending_empty`, `spending_missing`, `net_pay_missing`, `latest` |
| `backend/app/api/coverage.py` (modify) | serve the extended payload from `load_coverage` |
| `backend/app/services/health_checks.py` (modify) | zero-filled via the shared helper; new `spending_gap` and `net_pay_without_spending` |
| `backend/app/api/projection.py` (modify) | matched-window `annual_spend` + cash savings, `derived_window` echo, `payroll_monthly` re-imported |
| `backend/app/schemas/projection.py` (modify) | `DerivedWindowOut`, `ProjectionOut.derived_window` |
| `backend/app/services/money_flow.py` (modify) | `take_home_pending`, `take_home_months_entered`, residual subtracts the pending take-home |
| `backend/app/schemas/overview.py` (modify) | the same two fields on `MoneyFlowOut` |
| `backend/app/api/overview.py` (modify) | pass the two new figures through `_money_flow_out` |
| `backend/app/services/assistant_context.py` (modify) | the same savings fields in the household + spending sections |
| Tests modified | `test_models_spending.py`, `test_spending_api.py`, `test_coverage_api.py`, `test_health_checks.py`, `test_projection_api.py`, `test_money_flow.py`, `test_overview_api.py`, `test_assistant_context.py` |

---

### Task 1: `spending_categories.kind` — model and migration

**Files:**
- Modify: `backend/app/models/spending.py:10-17` (`SpendingCategory`)
- Create: `backend/alembic/versions/20260904_0914_e5a7c1d3f6b8_spending_category_kind.py`
- Test: `backend/tests/test_models_spending.py`

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_models_spending.py` (the file already imports `date`, `Decimal`, `pytest`, `select`, `IntegrityError` and the models):

```python
async def test_category_kind_defaults_to_living_and_is_constrained(db):
    cat = SpendingCategory(name="Groceries", slug="groceries", sort_order=1)
    db.add(cat)
    await db.commit()
    # The default is the honest one: a category nobody classified is money that LEFT
    # the household, so an un-migrated book keeps reading exactly as it does today.
    assert cat.kind == "living"

    taxes = SpendingCategory(name="Taxes", slug="taxes", sort_order=2, kind="tax")
    moves = SpendingCategory(name="Investments", slug="investments", sort_order=3, kind="transfer")
    db.add_all([taxes, moves])
    await db.commit()
    rows = (
        (await db.execute(select(SpendingCategory).order_by(SpendingCategory.sort_order)))
        .scalars()
        .all()
    )
    assert [r.kind for r in rows] == ["living", "tax", "transfer"]


async def test_category_kind_vocabulary_is_enforced_by_the_database(db):
    db.add(SpendingCategory(name="Mystery", slug="mystery", sort_order=9, kind="savings"))
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()
```

- [ ] **Step 2: Run to verify they fail**

Run: `FINANCE_TEST_DB=finance_test_ha <venv-python> -m pytest tests/test_models_spending.py -q`
Expected: FAIL — `TypeError: 'kind' is an invalid keyword argument for SpendingCategory`.

- [ ] **Step 3: Add the column to the model**

In `backend/app/models/spending.py`, replace the `SpendingCategory` class body with:

```python
class SpendingCategory(Base):
    __tablename__ = "spending_categories"
    # create_all builds the pytest schema, so the vocabulary CHECK must live HERE as well
    # as in the migration (card_credits.reset_cadence's precedent). The naming convention
    # in database.py expands this to ck_spending_categories_kind_vocabulary.
    __table_args__ = (
        CheckConstraint("kind IN ('living', 'tax', 'transfer')", name="kind_vocabulary"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    slug: Mapped[str] = mapped_column(String(80), unique=True)
    sort_order: Mapped[int] = mapped_column(default=0)
    is_active: Mapped[bool] = mapped_column(default=True)
    # What this category MEANS for savings (2026-09-04 honest-numbers spec §1):
    # 'living' money left the household, 'tax' is an income-tax payment made from
    # take-home, 'transfer' stayed yours (brokerage, savings, extra principal). Kinds
    # apply to ALL history — changing one moves every figure that reads it, by design.
    # server_default repeated from migration e5a7c1d3f6b8 so `alembic check` stays clean.
    kind: Mapped[str] = mapped_column(String(16), default="living", server_default="living")
```

- [ ] **Step 4: Run to verify they pass**

Run: `FINANCE_TEST_DB=finance_test_ha <venv-python> -m pytest tests/test_models_spending.py -q`
Expected: PASS (7 passed) — the session-scoped `engine` fixture drops and recreates the schema, so the new column and CHECK exist.

- [ ] **Step 5: Write the migration**

Create `backend/alembic/versions/20260904_0914_e5a7c1d3f6b8_spending_category_kind.py`:

```python
"""spending_categories.kind

What a category MEANS for savings (2026-09-04 honest-numbers spec §1): 'living' (money
left the household), 'tax' (an income-tax payment made from take-home — the April bill,
estimated payments; payroll withholding is NOT here, it never reaches net pay) or
'transfer' (money that stayed yours). NOT NULL, server_default 'living', so every
existing category keeps reading exactly as it does today.

The upgrade SEEDS by slug and name, case-insensitively: 'taxes' -> tax; 'investments'
and 'financial' -> transfer. Both columns are checked because the slug is derived from
the sheet's column header and a hand-renamed category can carry either spelling. The
downgrade drops the column: the classification is the only thing lost, and it is
re-derivable from the same two rules.

This is the ONLY migration the honest-numbers program writes.

Revision ID: e5a7c1d3f6b8
Revises: d4f6b8c0e2a5
Create Date: 2026-09-04 09:14:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e5a7c1d3f6b8"
down_revision: str | Sequence[str] | None = "d4f6b8c0e2a5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "spending_categories",
        sa.Column("kind", sa.String(length=16), nullable=False, server_default="living"),
    )
    op.create_check_constraint(
        op.f("ck_spending_categories_kind_vocabulary"),
        "spending_categories",
        "kind IN ('living', 'tax', 'transfer')",
    )
    op.execute(
        "UPDATE spending_categories SET kind = 'tax' "
        "WHERE lower(slug) = 'taxes' OR lower(name) = 'taxes'"
    )
    op.execute(
        "UPDATE spending_categories SET kind = 'transfer' "
        "WHERE lower(slug) IN ('investments', 'financial') "
        "OR lower(name) IN ('investments', 'financial')"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(
        op.f("ck_spending_categories_kind_vocabulary"), "spending_categories", type_="check"
    )
    op.drop_column("spending_categories", "kind")
```

- [ ] **Step 6: Verify the chain still has one head**

Run: `<venv-python> -m alembic heads`
Expected: exactly one line, `e5a7c1d3f6b8 (head)`.

- [ ] **Step 7: Mutation check**

Temporarily change the model's `server_default="living"` to `server_default="tax"`, run `FINANCE_TEST_DB=finance_test_ha <venv-python> -m pytest tests/test_models_spending.py -q` and confirm `test_category_kind_defaults_to_living_and_is_constrained` FAILS on `assert cat.kind == "living"`. Revert the edit and re-run to green.

- [ ] **Step 8: Commit**

```bash
git add backend/app/models/spending.py backend/alembic/versions/20260904_0914_e5a7c1d3f6b8_spending_category_kind.py backend/tests/test_models_spending.py
git commit -m "feat(spending): spending_categories.kind (living/tax/transfer) + migration"
```

---

### Task 2: `kind` on the categories API

**Files:**
- Modify: `backend/app/schemas/spending.py:8-27` (`CategoryOut`, `CategoryCreate`, `CategoryUpdate`)
- Modify: `backend/app/api/spending.py:48-82` (`create_category`)
- Test: `backend/tests/test_spending_api.py`

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_spending_api.py`:

```python
async def test_category_kind_round_trips_through_create_list_and_patch(auth_client):
    default = (await auth_client.post("/api/v1/spending/categories", json={"name": "Food"})).json()
    assert default["kind"] == "living"  # omitted kind is the honest default

    created = await auth_client.post(
        "/api/v1/spending/categories", json={"name": "Taxes", "kind": "tax"}
    )
    assert created.status_code == 201, created.text
    assert created.json()["kind"] == "tax"

    listed = (await auth_client.get("/api/v1/spending/categories")).json()
    assert {c["name"]: c["kind"] for c in listed} == {"Food": "living", "Taxes": "tax"}

    patched = await auth_client.patch(
        f"/api/v1/spending/categories/{default['id']}", json={"kind": "transfer"}
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["kind"] == "transfer"
    # A kind change must not disturb the row's other columns.
    assert patched.json()["name"] == "Food" and patched.json()["is_active"] is True


async def test_category_kind_vocabulary_is_refused_at_the_api_edge(auth_client):
    bad = await auth_client.post(
        "/api/v1/spending/categories", json={"name": "Savings", "kind": "savings"}
    )
    assert bad.status_code == 422
    made = (await auth_client.post("/api/v1/spending/categories", json={"name": "Pets"})).json()
    assert (
        await auth_client.patch(f"/api/v1/spending/categories/{made['id']}", json={"kind": "misc"})
    ).status_code == 422
```

- [ ] **Step 2: Run to verify they fail**

Run: `FINANCE_TEST_DB=finance_test_ha <venv-python> -m pytest tests/test_spending_api.py -q -k kind`
Expected: FAIL — `KeyError: 'kind'` on the first assert (the response carries no `kind`).

- [ ] **Step 3: Add the field to the three schemas**

In `backend/app/schemas/spending.py`, add the import and the alias under the existing imports, then the fields:

```python
from datetime import date
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

# The write side's vocabulary (2026-09-04 honest-numbers spec §1). CategoryOut deliberately
# types `kind` as a plain str: a GET must never 422 on a value the database already holds.
CategoryKind = Literal["living", "tax", "transfer"]


class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    slug: str
    sort_order: int
    is_active: bool
    kind: str


class CategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    # int32-safe and generous; sheet column indexes top out at 20.
    sort_order: int = Field(default=0, ge=0, le=1_000_000)
    kind: CategoryKind = "living"


class CategoryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    sort_order: int | None = Field(default=None, ge=0, le=1_000_000)
    is_active: bool | None = None
    kind: CategoryKind | None = None
```

- [ ] **Step 4: Persist it on create**

In `backend/app/api/spending.py`, inside `create_category`, replace the construction line:

```python
    category = SpendingCategory(
        name=body.name, slug=slug, sort_order=body.sort_order, kind=body.kind
    )
```

`update_category` needs NO change: it already applies every set, non-null field of `CategoryUpdate`, and `kind` is NOT NULL like every other patchable column.

- [ ] **Step 5: Run to verify they pass**

Run: `FINANCE_TEST_DB=finance_test_ha <venv-python> -m pytest tests/test_spending_api.py -q`
Expected: PASS — every existing spending test too (the added response field breaks no equality assert in that file).

- [ ] **Step 6: Mutation check**

Temporarily change `CategoryCreate.kind`'s default to `"tax"`, run `FINANCE_TEST_DB=finance_test_ha <venv-python> -m pytest tests/test_spending_api.py -q -k kind` and confirm `test_category_kind_round_trips_through_create_list_and_patch` FAILS on `assert default["kind"] == "living"`. Revert and re-run to green.

- [ ] **Step 7: Commit**

```bash
git add backend/app/schemas/spending.py backend/app/api/spending.py backend/tests/test_spending_api.py
git commit -m "feat(spending): category kind on create, list and patch"
```

---

### Task 3: `services/savings.py` — the one savings definition

**Files:**
- Create: `backend/app/services/savings.py`
- Modify: `backend/app/api/projection.py:166-171` (delete `_payroll_monthly`, import `payroll_monthly`)
- Test: `backend/tests/test_savings_service.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_savings_service.py`:

```python
"""The one savings definition (2026-09-04 honest-numbers spec §2), unit-tested.

Mostly pure: dicts in, dataclasses out. The two async tests exist because the loader is
where kinds meet profiles, and that join is the thing every page depends on.
"""

from datetime import date
from decimal import Decimal

import pytest

from app.models import MonthlyCashflow, MonthlySpending, PaycheckProfile, SpendingCategory
from app.services.savings import (
    LIVING,
    TAX,
    TRANSFER,
    compose_months,
    load_month_savings,
    matched_months,
    month_savings,
    payroll_by_month,
    payroll_monthly,
    rollup,
)

D = Decimal


def _profile(**overrides) -> PaycheckProfile:
    """5,000 gross a check (120,000 / 24), 10% traditional + $100 HSA = 600 a check =
    1,200.00 a month of payroll savings. EVERY column is explicit: an un-flushed model
    row has no column defaults, so an omitted pct would be None, not 0."""
    fields = {
        "person_id": 1,
        "effective_date": date(2026, 1, 1),
        "annual_salary": D("120000.00"),
        "pay_periods_per_year": 24,
        "trad_401k_pct": D("0.10"),
        "roth_401k_pct": D("0"),
        "after_tax_401k_pct": D("0"),
        "espp_pct": D("0"),
        "withholding_pct": D("0.20"),
        "dental_vision_per_check": D("0"),
        "hsa_per_check": D("100.00"),
    }
    fields.update(overrides)
    return PaycheckProfile(**fields)


def test_payroll_monthly_is_the_five_saving_lines_at_the_profile_cadence():
    assert payroll_monthly(_profile()) == D("1200")
    # ESPP and Roth ride on GROSS too, so 11% + 3% adds 5,000 * 0.14 = 700 a check.
    richer = _profile(espp_pct=D("0.11"), roth_401k_pct=D("0.03"))
    assert payroll_monthly(richer) == D("2600")


def test_payroll_by_month_uses_the_profile_in_force_on_the_first_of_the_month():
    months = [
        date(2025, 12, 1),
        date(2026, 1, 1),
        date(2026, 2, 1),
        date(2026, 3, 1),
        date(2026, 4, 1),
    ]
    raise_mid_march = _profile(effective_date=date(2026, 3, 15), annual_salary=D("240000.00"))
    by_month = payroll_by_month([_profile(), raise_mid_march], months)
    # Dec: nobody had a profile yet -> 0.00, never a guess. A profile effective MID-month
    # counts from the following month (the 1st-of-month rule, spec §6).
    assert by_month == {
        date(2025, 12, 1): D("0.00"),
        date(2026, 1, 1): D("1200.00"),
        date(2026, 2, 1): D("1200.00"),
        date(2026, 3, 1): D("1200.00"),
        date(2026, 4, 1): D("2400.00"),
    }


def test_payroll_by_month_sums_people_and_skips_an_unusable_cadence():
    # 2,000 gross a check * 10% = 200 -> 400.00 a month.
    partner = _profile(person_id=2, annual_salary=D("48000.00"), hsa_per_check=D("0"))
    broken = _profile(person_id=3, pay_periods_per_year=0)
    # A stored 0 cadence is a DivisionByZero waiting to happen; a GET degrades, never 500s.
    assert payroll_by_month([_profile(), partner, broken], [date(2026, 1, 1)]) == {
        date(2026, 1, 1): D("1600.00")
    }


def _census_profile() -> PaycheckProfile:
    """The production profile the rounding rule is pinned on: 204,044.40 over 24 periods
    is 8,501.85 gross a check; 13% traditional + 3% after-tax + 9% ESPP + $100 HSA is
    2,225.4625 a check — payroll_monthly of EXACTLY 4,450.925 a month, an exact half."""
    return _profile(
        annual_salary=D("204044.40"),
        trad_401k_pct=D("0.13"),
        after_tax_401k_pct=D("0.03"),
        espp_pct=D("0.09"),
        hsa_per_check=D("100.00"),
    )


def test_the_emitted_month_rounds_half_up_and_a_period_sums_those_months():
    assert payroll_monthly(_census_profile()) == D("4450.925")
    months = [date(2026, m, 1) for m in range(1, 8)]  # Jan-Jul, the census window
    by_month = payroll_by_month([_census_profile()], months)
    # HALF_UP on an exact half: the emitted month is 4,450.93, never 4,450.92.
    assert set(by_month.values()) == {D("4450.93")}

    # Jan-Jul: 44,611.60 of take-home against 45,608.58 of living spend (production's own
    # figures), spread so both sums are exact.
    net_pay = dict.fromkeys(months[:6], D("6373.09")) | {months[6]: D("6373.06")}
    living = dict.fromkeys(months[:6], D("6515.51")) | {months[6]: D("6515.52")}
    rows = compose_months(months, {m: {LIVING: living[m]} for m in months}, net_pay, by_month)
    period = rollup(rows)
    assert period.months_matched == 7
    assert (period.net_pay, period.living_spend) == (D("44611.60"), D("45608.58"))
    assert period.cash_savings == D("-996.98")
    # 7 x 4,450.93 — the SUM of the emitted months, never 7 x 4,450.925 re-rounded.
    assert period.payroll_savings == D("31156.51")
    assert sum((row.payroll_savings for row in rows), D("0.00")) == period.payroll_savings
    assert period.total_savings == D("30159.53")
    assert period.total_rate.quantize(D("0.001")) == D("0.398")  # the 39.8% headline
```

```python
@pytest.mark.parametrize(
    ("by_kind", "net_pay", "expected"),
    [
        (
            {LIVING: D("3000.00"), TAX: D("500.00"), TRANSFER: D("1000.00")},
            D("8000.00"),
            # cash = 8000 - 3000 - 500; total = cash + 1200; 4500/8000; 5700/9200
            (
                "3000.00",
                "500.00",
                "1000.00",
                "1200.00",
                "4500.00",
                "5700.00",
                "0.562500",
                "0.619565",
            ),
        ),
        (
            # No net pay: no rate, no savings, and NO payroll either — a month nobody
            # entered pay for has no deductions on record (spec §2).
            {LIVING: D("3000.00"), TAX: D("500.00"), TRANSFER: D("1000.00")},
            None,
            ("3000.00", "500.00", "1000.00", "0.00", None, None, None, None),
        ),
        (
            # net_pay = 0: savings computed, both rates None (the division guard).
            {LIVING: D("3000.00"), TAX: D("500.00"), TRANSFER: D("1000.00")},
            D("0.00"),
            ("3000.00", "500.00", "1000.00", "1200.00", "-3500.00", "-2300.00", None, None),
        ),
        (
            # A transfer is NOT spending: it never touches cash savings.
            {TRANSFER: D("4000.00")},
            D("8000.00"),
            ("0.00", "0.00", "4000.00", "1200.00", "8000.00", "9200.00", "1.000000", "1.000000"),
        ),
    ],
)
def test_month_savings_reads_the_kinds(by_kind, net_pay, expected):
    row = month_savings(date(2026, 4, 1), by_kind, net_pay, D("1200.00"))
    actual = (
        row.living_spend,
        row.tax_paid,
        row.transfers,
        row.payroll_savings,
        row.cash_savings,
        row.total_savings,
        row.cash_rate,
        row.total_rate,
    )
    assert actual == tuple(None if e is None else D(e) for e in expected)
    assert row.has_spending_rows is True
    assert row.matched is (net_pay is not None)


def test_month_savings_without_rows_is_not_a_matched_month():
    row = month_savings(date(2026, 4, 1), None, D("8000.00"), D("1200.00"))
    assert (row.living_spend, row.tax_paid, row.transfers) == (D("0.00"), D("0.00"), D("0.00"))
    assert row.cash_savings == D("8000.00")
    # Rows are what make a month averageable: net pay alone has no spend to average.
    assert row.has_spending_rows is False and row.matched is False


def test_compose_and_rollup_count_matched_months_only():
    months = [date(2026, 1, 1), date(2026, 2, 1), date(2026, 3, 1)]
    rows = compose_months(
        months,
        {
            date(2026, 1, 1): {LIVING: D("3000.00"), TAX: D("500.00")},
            date(2026, 2, 1): {LIVING: D("9999.00")},  # rows but no net pay
        },
        {date(2026, 1, 1): D("8000.00"), date(2026, 3, 1): D("7000.00")},  # Mar: pay, no rows
        {m: D("1200.00") for m in months},
    )
    assert [r.matched for r in rows] == [True, False, False]
    period = rollup(rows)
    assert period.months_matched == 1
    assert (period.living_spend, period.tax_paid, period.transfers) == (
        D("3000.00"),
        D("500.00"),
        D("0.00"),
    )
    assert period.net_pay == D("8000.00")  # the matched denominator, not every pay month
    assert (period.cash_savings, period.payroll_savings, period.total_savings) == (
        D("4500.00"),
        D("1200.00"),
        D("5700.00"),
    )
    assert (period.cash_rate, period.total_rate) == (D("0.562500"), D("0.619565"))


def test_rollup_of_nothing_matched_is_zeros_and_nulls():
    period = rollup(compose_months([date(2026, 2, 1)], {}, {}, {}))
    assert period.months_matched == 0
    assert period.living_spend == D("0.00") and period.payroll_savings == D("0.00")
    assert (period.cash_savings, period.total_savings) == (None, None)
    assert (period.cash_rate, period.total_rate) == (None, None)


def test_matched_months_takes_the_last_n_ascending():
    months = [date(2026, m, 1) for m in range(1, 6)]
    rows = compose_months(
        months,
        {m: {LIVING: D("100.00")} for m in months},
        {m: D("1000.00") for m in months if m != date(2026, 3, 1)},  # March: no pay
        {},
    )
    window = matched_months(rows, 3)
    assert [r.month for r in window] == [date(2026, 2, 1), date(2026, 4, 1), date(2026, 5, 1)]
    assert matched_months(rows, 99) == [r for r in rows if r.matched]


async def _seed_kinds(db):
    """Three categories, one per kind, over one month with net pay."""
    rent = SpendingCategory(name="Rent", slug="rent", sort_order=1, kind="living")
    taxes = SpendingCategory(name="Taxes", slug="taxes", sort_order=2, kind="tax")
    invest = SpendingCategory(name="Investments", slug="investments", sort_order=3, kind="transfer")
    db.add_all([rent, taxes, invest])
    await db.flush()
    month = date(2026, 4, 1)
    db.add_all(
        [
            MonthlySpending(month=month, category_id=rent.id, amount=D("3000.00")),
            MonthlySpending(month=month, category_id=taxes.id, amount=D("500.00")),
            MonthlySpending(month=month, category_id=invest.id, amount=D("1000.00")),
            MonthlyCashflow(month=month, net_pay=D("8000.00")),
        ]
    )
    await db.commit()
    return rent


async def test_load_month_savings_joins_kinds_cashflow_and_profiles(db):
    await _seed_kinds(db)
    rows = await load_month_savings(db)
    assert len(rows) == 1
    row = rows[0]
    assert (row.living_spend, row.tax_paid, row.transfers) == (
        D("3000.00"),
        D("500.00"),
        D("1000.00"),
    )
    assert row.payroll_savings == D("0.00")  # no profiles on file: zero, not a guess
    assert (row.cash_savings, row.cash_rate) == (D("4500.00"), D("0.562500"))


async def test_flipping_a_kind_moves_exactly_the_expected_figures(db):
    rent = await _seed_kinds(db)
    before = (await load_month_savings(db))[0]

    rent.kind = "tax"
    await db.commit()
    as_tax = (await load_month_savings(db))[0]
    # living -> tax moves the spend line but NOT cash savings: both are subtracted from
    # net pay. That is what makes the projection's annual_spend move while the savings
    # headline stays put.
    assert as_tax.living_spend == D("0.00")
    assert as_tax.tax_paid == D("3500.00")
    assert as_tax.cash_savings == before.cash_savings == D("4500.00")

    rent.kind = "transfer"
    await db.commit()
    as_transfer = (await load_month_savings(db))[0]
    # living -> transfer takes it out of spending altogether: cash savings rise by 3,000.
    assert as_transfer.transfers == D("4000.00")
    assert as_transfer.cash_savings == D("7500.00")
    assert as_transfer.cash_rate == D("0.937500")
```

- [ ] **Step 2: Run to verify they fail**

Run: `FINANCE_TEST_DB=finance_test_ha <venv-python> -m pytest tests/test_savings_service.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.savings'`.

- [ ] **Step 3: Write the service**

Create `backend/app/services/savings.py`:

```python
"""The ONE definition of savings (2026-09-04 honest-numbers spec §2).

Every page that says "saved" reads this module. Before it, four files each had their own
sentence: the matrix subtracted every category from net pay, the yearly rollup did the
same over a different window, the projection averaged a third window, and none of them
counted the 401(k)/ESPP/HSA money that never reaches net pay at all.

Per calendar month with a spending or cashflow row:

    living_spend    = sum of amounts over categories with kind 'living'
    tax_paid        = same over 'tax'      (income tax paid FROM take-home)
    transfers       = same over 'transfer' (money that stayed yours)
    cash_savings    = net_pay - living_spend - tax_paid       (None without net pay)
    payroll_savings = per person, the saving lines of the profile in force on the 1st
    total_savings   = cash_savings + payroll_savings          (None without net pay)
    cash_rate       = cash_savings / net_pay                  (None without net pay, or 0)
    total_rate      = total_savings / (net_pay + payroll_savings)          (same guard)

ROUNDING CONTRACT (spec §2, amended 2026-09-04). Every per-MONTH figure this module emits
is cents, ROUND_HALF_UP, via `half_up2`: each person's monthly payroll figure first (so
per-person rows a caller echoes sum exactly), then the month's own totals. Every PERIOD
scalar — `rollup`'s fields, and the projection's derived contribution and annual spend —
is built from those EMITTED month figures, never from a re-rounded raw sum: sum the
months, then (for a mean) divide and quantize exactly once at the end. The two rates are
quantized to the wire's 6dp. Callers add no rounding of their own.

The invariant this buys: `YearRollup.payroll_savings` equals the sum of
`MatrixOut.payroll_savings` over that year's matched months, to the cent, always.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import MonthlyCashflow, MonthlySpending, PaycheckProfile, SpendingCategory
from app.services.money import quantize_pct
from app.services.paycheck_calc import MONTHS_PER_YEAR, PAYROLL_SAVING_KEYS, breakdown, half_up2

ZERO = Decimal("0.00")
LIVING = "living"
TAX = "tax"
TRANSFER = "transfer"
KINDS = (LIVING, TAX, TRANSFER)
# api.paycheck.MIN_PAY_PERIODS's fence, repeated as a plain int rather than imported: a
# service must not import a router. gross = salary / periods, so a stored 0 would be a
# DivisionByZero 500 inside `breakdown` — here it simply contributes nothing.
MIN_PAY_PERIODS = 1


@dataclass(frozen=True)
class MonthSavings:
    """One calendar month, every figure already in cents (rates at 6dp)."""

    month: date
    living_spend: Decimal
    tax_paid: Decimal
    transfers: Decimal
    net_pay: Decimal | None
    payroll_savings: Decimal
    cash_savings: Decimal | None
    total_savings: Decimal | None
    cash_rate: Decimal | None
    total_rate: Decimal | None
    has_spending_rows: bool

    @property
    def matched(self) -> bool:
        """Both halves of the month are on file, so it can be AVERAGED.

        Spending rows AND a net-pay row. A confirmed all-zero month with net pay counts —
        it is a real month of spending nothing. A net-pay-only month does not: there is
        no spend to average, and treating it as a $0 month is precisely the lie this
        program removes (health_checks names such a month instead).
        """
        return self.has_spending_rows and self.net_pay is not None


@dataclass(frozen=True)
class PeriodSavings:
    """A rollup over MATCHED months only — `net_pay` is those months' pay, i.e. the
    rates' honest denominator, never the period's full net-pay total."""

    months_matched: int
    living_spend: Decimal
    tax_paid: Decimal
    transfers: Decimal
    net_pay: Decimal
    payroll_savings: Decimal
    cash_savings: Decimal | None
    total_savings: Decimal | None
    cash_rate: Decimal | None
    total_rate: Decimal | None


def payroll_monthly(profile) -> Decimal:
    """One profile's payroll-deducted savings per MONTH, at full precision: the five
    saving lines of `breakdown` per check × the profile's cadence ÷ 12 (the `monthly_net`
    rule). Moved here from api/projection.py, which imports it back."""
    lines = breakdown(profile)
    per_check = sum((lines[key] for key in PAYROLL_SAVING_KEYS), Decimal(0))
    return per_check * Decimal(profile.pay_periods_per_year) / MONTHS_PER_YEAR


def payroll_by_month(
    profiles: Sequence[PaycheckProfile], months: Sequence[date]
) -> dict[date, Decimal]:
    """Σ over people of the profile in force on the 1st of each month, in cents.

    `months` must be ascending; one sorted walk per person, no queries (the table is
    tiny). NO future-profile fallback — that is `_default_profile`'s rule for TODAY's
    paycheck, and applying it to history would credit a January that predates the job.
    A person with no profile in force contributes 0 (spec §6). Each person's figure is
    rounded to cents BEFORE summing, so a caller echoing per-person rows sums exactly,
    and the month's total is emitted in cents too (the rounding contract above).
    """
    by_person: dict[int, list[PaycheckProfile]] = {}
    for profile in profiles:
        if profile.pay_periods_per_year < MIN_PAY_PERIODS:
            continue
        by_person.setdefault(profile.person_id, []).append(profile)
    totals = {month: ZERO for month in months}
    for history in by_person.values():
        history.sort(key=lambda p: p.effective_date)
        pointer = 0
        current: PaycheckProfile | None = None
        for month in months:
            while pointer < len(history) and history[pointer].effective_date <= month:
                current = history[pointer]
                pointer += 1
            if current is not None:
                totals[month] += half_up2(payroll_monthly(current))
    return {month: half_up2(total) for month, total in totals.items()}


def month_savings(
    month: date,
    by_kind: Mapping[str, Decimal] | None,
    net_pay: Decimal | None,
    payroll: Decimal,
) -> MonthSavings:
    """`by_kind` is None when the month has NO spending rows at all — distinct from a
    month whose rows are all $0.00, which is a mapping of zeros."""
    kinds = by_kind or {}
    # The rounding contract: every figure this function EMITS is cents, so a period
    # scalar can be the plain SUM of its months and still agree with the wire.
    living = half_up2(kinds.get(LIVING, ZERO))
    tax = half_up2(kinds.get(TAX, ZERO))
    transfer = half_up2(kinds.get(TRANSFER, ZERO))
    payroll = half_up2(payroll)
    if net_pay is None:
        # No pay on file means no deductions on file either (spec §2): payroll savings
        # are 0, not last month's guess.
        return MonthSavings(
            month=month,
            living_spend=living,
            tax_paid=tax,
            transfers=transfer,
            net_pay=None,
            payroll_savings=ZERO,
            cash_savings=None,
            total_savings=None,
            cash_rate=None,
            total_rate=None,
            has_spending_rows=by_kind is not None,
        )
    cash = half_up2(net_pay - living - tax)
    total = half_up2(cash + payroll)
    # ONE guard for both rates (spec §2): a month with no take-home has no denominator,
    # and a payroll-only rate would print a flattering number for a month with no pay.
    # The rates read the EMITTED cash/total, so the wire's percentage matches the wire's
    # dollars rather than a shadow figure at full precision.
    rates_defined = net_pay != 0
    return MonthSavings(
        month=month,
        living_spend=living,
        tax_paid=tax,
        transfers=transfer,
        net_pay=net_pay,
        payroll_savings=payroll,
        cash_savings=cash,
        total_savings=total,
        cash_rate=quantize_pct(cash / net_pay) if rates_defined else None,
        total_rate=quantize_pct(total / (net_pay + payroll)) if rates_defined else None,
        has_spending_rows=by_kind is not None,
    )


def compose_months(
    months: Sequence[date],
    by_kind: Mapping[date, Mapping[str, Decimal]],
    net_pay: Mapping[date, Decimal],
    payroll: Mapping[date, Decimal],
) -> list[MonthSavings]:
    """One `MonthSavings` per month, in `months` order. Presence in `by_kind` IS "this
    month has spending rows"."""
    return [
        month_savings(month, by_kind.get(month), net_pay.get(month), payroll.get(month, ZERO))
        for month in months
    ]


def rollup(rows: Sequence[MonthSavings]) -> PeriodSavings:
    """Sum the MATCHED months — the EMITTED cent figures, never a re-rounded raw sum, so
    a year's payroll savings is exactly the months the matrix showed. Nothing matched =
    zeros and nulls, never a division."""
    matched = [row for row in rows if row.matched]
    living = sum((row.living_spend for row in matched), ZERO)
    tax = sum((row.tax_paid for row in matched), ZERO)
    transfer = sum((row.transfers for row in matched), ZERO)
    net_pay = sum((row.net_pay for row in matched if row.net_pay is not None), ZERO)
    payroll = sum((row.payroll_savings for row in matched), ZERO)
    if not matched:
        return PeriodSavings(0, living, tax, transfer, net_pay, payroll, None, None, None, None)
    cash = net_pay - living - tax
    total = cash + payroll
    rates_defined = net_pay != 0
    return PeriodSavings(
        months_matched=len(matched),
        living_spend=living,
        tax_paid=tax,
        transfers=transfer,
        net_pay=net_pay,
        payroll_savings=payroll,
        cash_savings=cash,
        total_savings=total,
        cash_rate=quantize_pct(cash / net_pay) if rates_defined else None,
        total_rate=quantize_pct(total / (net_pay + payroll)) if rates_defined else None,
    )


def matched_months(rows: Sequence[MonthSavings], limit: int) -> list[MonthSavings]:
    """The LAST `limit` matched months, still ascending — the derivation window."""
    matched = [row for row in rows if row.matched]
    return matched[-limit:] if limit > 0 else matched


async def load_payroll_by_month(db: AsyncSession, months: Sequence[date]) -> dict[date, Decimal]:
    profiles = list((await db.execute(select(PaycheckProfile))).scalars().all())
    return payroll_by_month(profiles, months)


async def load_month_savings(db: AsyncSession) -> list[MonthSavings]:
    """Every month with a spending or cashflow row, ascending. Three queries."""
    kind_rows = (
        await db.execute(
            select(MonthlySpending.month, SpendingCategory.kind, func.sum(MonthlySpending.amount))
            .join(SpendingCategory, SpendingCategory.id == MonthlySpending.category_id)
            .group_by(MonthlySpending.month, SpendingCategory.kind)
        )
    ).all()
    by_kind: dict[date, dict[str, Decimal]] = {}
    for month, kind, total in kind_rows:
        by_kind.setdefault(month, {})[kind] = Decimal(total)
    net_pay = {
        row.month: row.net_pay for row in (await db.execute(select(MonthlyCashflow))).scalars()
    }
    months = sorted(set(by_kind) | set(net_pay))
    return compose_months(months, by_kind, net_pay, await load_payroll_by_month(db, months))
```

- [ ] **Step 4: Move `_payroll_monthly` out of the projection**

In `backend/app/api/projection.py`: DELETE the `_payroll_monthly` function (lines 166-171); add `from app.services.savings import payroll_monthly` to the imports (after the `app.services.projection` line); rename both call sites — `half_up2(_payroll_monthly(profile))` in `_payroll_savings` and `drop += half_up2(_payroll_monthly(profile))` in `_resolve_retirements` — to use `payroll_monthly(profile)`.

- [ ] **Step 5: Run to verify they pass**

Run: `FINANCE_TEST_DB=finance_test_ha <venv-python> -m pytest tests/test_savings_service.py tests/test_projection_api.py -q`
Expected: PASS — the service's own tests plus every projection test (the arithmetic moved, it did not change).

- [ ] **Step 6: Mutation check**

Temporarily change `month_savings`'s `cash = net_pay - living - tax` to `cash = net_pay - living`, run `FINANCE_TEST_DB=finance_test_ha <venv-python> -m pytest tests/test_savings_service.py -q` and confirm `test_month_savings_reads_the_kinds` FAILS (cash 5000.00, not 4500.00). Revert and re-run to green.

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/savings.py backend/app/api/projection.py backend/tests/test_savings_service.py
git commit -m "feat(savings): one savings service; payroll_monthly moves out of the projection"
```

---

### Task 4: `GET /spending/matrix` serves the new per-month arrays

**Files:**
- Modify: `backend/app/schemas/spending.py:77-86` (`MatrixOut`)
- Modify: `backend/app/api/spending.py:255-258` (delete `_savings_rate`) and `:285-360` (`matrix`)
- Test: `backend/tests/test_spending_api.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_spending_api.py`, and add `MonthlyCashflow`, `MonthlySpending`, `PaycheckProfile`, `Person`, `SpendingCategory` to the `from app.models import (...)` block at the top (the first three are already there):

```python
async def _seed_kinds_and_profile(db):
    """Mar 2026: living only, no take-home. Apr 2026: 3,000 living + 500 tax + 1,000
    transfer against 8,000 take-home, with a profile saving 1,200.00 a month
    (120,000 / 24 = 5,000 gross a check; 10% traditional + $100 HSA = 600 a check)."""
    rent = SpendingCategory(name="Rent", slug="rent", sort_order=1, kind="living")
    taxes = SpendingCategory(name="Taxes", slug="taxes", sort_order=2, kind="tax")
    invest = SpendingCategory(name="Investments", slug="investments", sort_order=3, kind="transfer")
    person = Person(name="Me", is_primary=True)
    db.add_all([rent, taxes, invest, person])
    await db.flush()
    db.add_all(
        [
            PaycheckProfile(
                person_id=person.id,
                effective_date=date(2026, 1, 1),
                annual_salary=Decimal("120000.00"),
                pay_periods_per_year=24,
                trad_401k_pct=Decimal("0.10"),
                hsa_per_check=Decimal("100.00"),
            ),
            MonthlySpending(month=date(2026, 3, 1), category_id=rent.id, amount=Decimal("1000.00")),
            MonthlySpending(month=date(2026, 4, 1), category_id=rent.id, amount=Decimal("3000.00")),
            MonthlySpending(month=date(2026, 4, 1), category_id=taxes.id, amount=Decimal("500.00")),
            MonthlySpending(
                month=date(2026, 4, 1), category_id=invest.id, amount=Decimal("1000.00")
            ),
            MonthlyCashflow(month=date(2026, 4, 1), net_pay=Decimal("8000.00")),
        ]
    )
    await db.commit()


async def test_matrix_splits_the_month_by_kind_and_counts_payroll_savings(auth_client, db):
    await _seed_kinds_and_profile(db)
    body = (await auth_client.get("/api/v1/spending/matrix")).json()
    assert body["months"] == ["2026-03-01", "2026-04-01"]
    # `totals` keeps its meaning: every category, every kind.
    assert body["totals"] == ["1000.00", "4500.00"]
    assert body["living_total"] == ["1000.00", "3000.00"]
    assert body["tax_total"] == ["0.00", "500.00"]
    assert body["transfer_total"] == ["0.00", "1000.00"]
    # March has no take-home: no savings, no rates, and NO payroll either — a month
    # nobody entered pay for has no deductions on record.
    assert body["cash_savings"] == [None, "4500.00"]
    assert body["payroll_savings"] == ["0.00", "1200.00"]
    assert body["total_savings"] == [None, "5700.00"]
    # savings_rate KEEPS its name and now means the CASH rate: 4500/8000.
    assert body["savings_rate"] == [None, "0.562500"]
    assert body["total_savings_rate"] == [None, "0.619565"]  # 5700 / (8000 + 1200)
```

- [ ] **Step 2: Run to verify it fails**

Run: `FINANCE_TEST_DB=finance_test_ha <venv-python> -m pytest tests/test_spending_api.py -q -k matrix_splits`
Expected: FAIL — `KeyError: 'living_total'`.

- [ ] **Step 3: Add the fields to `MatrixOut`**

In `backend/app/schemas/spending.py`, replace `MatrixOut` with:

```python
class MatrixOut(BaseModel):
    months: list[date]
    categories: list[CategoryOut]
    series: list[CategorySeries]
    # EVERY category, every kind — the spending page's total line, unchanged.
    totals: list[Decimal]
    net_pay: list[Decimal | None]
    # The CASH savings rate (2026-09-04 honest-numbers spec §2): this field keeps its name
    # and is identical to the old one wherever every category is 'living'.
    savings_rate: list[Decimal | None]
    four_pct_rule: list[Decimal | None]
    # Sum of the resolved category budgets per month; None when NO category has one.
    total_budget: list[Decimal | None]
    # The kind split and both savings definitions, aligned with `months`. Every money
    # array is CENTS (services/savings.py's rounding contract), so a period scalar
    # elsewhere in the API is the plain sum of these months.
    living_total: list[Decimal]
    tax_total: list[Decimal]
    transfer_total: list[Decimal]
    cash_savings: list[Decimal | None]
    # Never null: 0.00 for a month with no take-home entered (no pay on file means no
    # deductions on file), so the array always sums.
    payroll_savings: list[Decimal]
    total_savings: list[Decimal | None]
    total_savings_rate: list[Decimal | None]
```

- [ ] **Step 4: Wire the route to the service**

In `backend/app/api/spending.py`: DELETE the `_savings_rate` helper (lines 255-258 — the matrix and the yearly rollup were its only callers, and both now read the service), and add to the imports:

```python
from app.services.savings import LIVING, compose_months, load_payroll_by_month
```

Then in `matrix`, replace the block from `totals = [` through `savings = [...]` with:

```python
    totals = [
        sum(
            (cells.get((c.id, i), Decimal("0.00")) for c in categories),
            Decimal("0.00"),
        )
        for i in range(len(months))
    ]
    net_pay = [cashflow.get(month) for month in months]
    # The kind split, from the rows already loaded — no second query. A row whose category
    # vanished mid-request reads as 'living', the honest default (spec §1).
    kind_by_category = {c.id: c.kind for c in categories}
    by_kind: dict[date, dict[str, Decimal]] = {row.month: {} for row in spend_rows}
    for row in spend_rows:
        bucket = by_kind[row.month]
        kind = kind_by_category.get(row.category_id, LIVING)
        bucket[kind] = bucket.get(kind, Decimal("0.00")) + row.amount
    # One savings definition for every page (spec §2): the router does no arithmetic.
    savings_rows = compose_months(
        months, by_kind, cashflow, await load_payroll_by_month(db, months)
    )
```

and replace the `return MatrixOut(...)` call's tail (`savings_rate=savings,` onward) with:

```python
        savings_rate=[row.cash_rate for row in savings_rows],
        four_pct_rule=four_pct,
        total_budget=total_budget,
        living_total=[row.living_spend for row in savings_rows],
        tax_total=[row.tax_paid for row in savings_rows],
        transfer_total=[row.transfers for row in savings_rows],
        cash_savings=[row.cash_savings for row in savings_rows],
        payroll_savings=[row.payroll_savings for row in savings_rows],
        total_savings=[row.total_savings for row in savings_rows],
        total_savings_rate=[row.total_rate for row in savings_rows],
    )
```

- [ ] **Step 5: Run to verify it passes**

Run: `FINANCE_TEST_DB=finance_test_ha <venv-python> -m pytest tests/test_spending_api.py -q`
Expected: PASS — including `test_matrix_shapes_totals_savings_and_four_pct` and `test_matrix_includes_cashflow_only_months`, whose all-living books make `savings_rate` byte-identical to before.

- [ ] **Step 6: Mutation check**

Temporarily change the route's `kind_by_category.get(row.category_id, LIVING)` to a hard-coded `LIVING`, run `FINANCE_TEST_DB=finance_test_ha <venv-python> -m pytest tests/test_spending_api.py -q -k matrix_splits` and confirm the test FAILS (`tax_total` reads `["0.00", "0.00"]`). Revert and re-run to green.

- [ ] **Step 7: Commit**

```bash
git add backend/app/schemas/spending.py backend/app/api/spending.py backend/tests/test_spending_api.py
git commit -m "feat(spending): matrix serves the kind split, cash and payroll savings"
```

---

### Task 5: `GET /spending/yearly` rolls up over matched months

**Files:**
- Modify: `backend/app/schemas/spending.py:94-99` (`YearRollup`)
- Modify: `backend/app/api/spending.py:363-400` (`yearly`)
- Test: `backend/tests/test_spending_api.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_spending_api.py` (it reuses `_seed_kinds_and_profile` from Task 4):

```python
async def test_yearly_rollup_splits_kinds_and_counts_only_matched_months(auth_client, db):
    await _seed_kinds_and_profile(db)
    body = (await auth_client.get("/api/v1/spending/yearly")).json()
    year = next(y for y in body["years"] if y["year"] == 2026)
    # `total` and `net_pay_total` keep their meaning: every month, every kind.
    assert year["total"] == "5500.00"
    assert year["net_pay_total"] == "8000.00"
    # The savings figures are the MATCHED months only — March has no take-home, so it
    # has no honest place in a savings rate.
    assert year["months_matched"] == 1
    assert year["living_total"] == "3000.00"
    assert year["tax_total"] == "500.00"
    assert year["transfer_total"] == "1000.00"
    assert year["cash_savings"] == "4500.00"
    assert year["payroll_savings"] == "1200.00"
    assert year["total_savings"] == "5700.00"
    assert year["savings_rate"] == "0.562500"
    assert year["total_savings_rate"] == "0.619565"


async def test_yearly_rollup_of_a_year_with_nothing_matched(auth_client, db):
    cat = SpendingCategory(name="Rent", slug="rent", sort_order=1)
    db.add(cat)
    await db.flush()
    db.add(MonthlySpending(month=date(2026, 5, 1), category_id=cat.id, amount=Decimal("900.00")))
    await db.commit()
    year = (await auth_client.get("/api/v1/spending/yearly")).json()["years"][0]
    assert year["total"] == "900.00" and year["net_pay_total"] is None
    assert year["months_matched"] == 0
    assert year["living_total"] == "0.00" and year["payroll_savings"] == "0.00"
    assert year["cash_savings"] is None and year["total_savings"] is None
    assert year["savings_rate"] is None and year["total_savings_rate"] is None


async def test_yearly_payroll_savings_is_the_sum_of_the_matrix_months(auth_client, db):
    """The rounding contract's invariant (spec §2, amended): a period scalar is the SUM
    of the months the matrix showed, to the cent — 4,450.93 x 3, never 3 x 4,450.925
    re-rounded. 204,044.40 over 24 periods is 8,501.85 gross a check; 13% + 3% + 9% of it
    plus $100 HSA is 2,225.4625 a check, i.e. exactly 4,450.925 a month."""
    rent = SpendingCategory(name="Rent", slug="rent", sort_order=1, kind="living")
    person = Person(name="Me", is_primary=True)
    db.add_all([rent, person])
    await db.flush()
    db.add(
        PaycheckProfile(
            person_id=person.id,
            effective_date=date(2025, 12, 1),
            annual_salary=Decimal("204044.40"),
            pay_periods_per_year=24,
            trad_401k_pct=Decimal("0.13"),
            after_tax_401k_pct=Decimal("0.03"),
            espp_pct=Decimal("0.09"),
            hsa_per_check=Decimal("100.00"),
        )
    )
    for month in (date(2026, 1, 1), date(2026, 2, 1), date(2026, 3, 1)):
        db.add(MonthlySpending(month=month, category_id=rent.id, amount=Decimal("3000.00")))
        db.add(MonthlyCashflow(month=month, net_pay=Decimal("8000.00")))
    await db.commit()

    matrix = (await auth_client.get("/api/v1/spending/matrix")).json()
    assert matrix["payroll_savings"] == ["4450.93", "4450.93", "4450.93"]
    years = (await auth_client.get("/api/v1/spending/yearly")).json()["years"]
    year = next(y for y in years if y["year"] == 2026)
    assert year["months_matched"] == 3
    months_sum = sum(Decimal(v) for v in matrix["payroll_savings"])
    assert Decimal(year["payroll_savings"]) == months_sum == Decimal("13352.79")
    assert Decimal(year["total_savings"]) == Decimal("28352.79")  # 15,000 cash + 13,352.79
```

- [ ] **Step 2: Run to verify it fails**

Run: `FINANCE_TEST_DB=finance_test_ha <venv-python> -m pytest tests/test_spending_api.py -q -k yearly`
Expected: FAIL — `KeyError: 'months_matched'`.

- [ ] **Step 3: Add the fields to `YearRollup`**

In `backend/app/schemas/spending.py`, replace `YearRollup` with:

```python
class YearRollup(BaseModel):
    year: int
    # by_category / total / net_pay_total keep today's meaning: EVERY month of the year,
    # every kind. The savings fields below are the year's MATCHED months only (2026-09-04
    # honest-numbers spec §2) — a rate whose numerator and denominator come from different
    # months is the dishonesty this program removes.
    by_category: list[YearCategoryTotal]
    total: Decimal
    net_pay_total: Decimal | None
    # The CASH rate (this field keeps its name), over matched months. Every money field
    # below is the SUM of the emitted months the matrix showed, so the two endpoints
    # agree to the cent (services/savings.py's rounding contract).
    savings_rate: Decimal | None
    months_matched: int
    living_total: Decimal
    tax_total: Decimal
    transfer_total: Decimal
    cash_savings: Decimal | None
    payroll_savings: Decimal
    total_savings: Decimal | None
    total_savings_rate: Decimal | None
```

- [ ] **Step 4: Wire the route to the service**

In `backend/app/api/spending.py`, extend the savings import to:

```python
from app.services.savings import LIVING, MonthSavings, compose_months, load_payroll_by_month, rollup
```

and replace the body of `yearly` (everything after the `categories = ...` block) with:

```python
    spend_rows = list((await db.execute(select(MonthlySpending))).scalars().all())
    cashflow_rows = list((await db.execute(select(MonthlyCashflow))).scalars().all())
    years = sorted(
        {row.month.year for row in spend_rows} | {row.month.year for row in cashflow_rows}
    )
    # Same kind split as the matrix, from the rows already loaded (spec §2).
    kind_by_category = {c.id: c.kind for c in categories}
    by_kind: dict[date, dict[str, Decimal]] = {row.month: {} for row in spend_rows}
    for row in spend_rows:
        bucket = by_kind[row.month]
        kind = kind_by_category.get(row.category_id, LIVING)
        bucket[kind] = bucket.get(kind, Decimal("0.00")) + row.amount
    net_pay_by_month = {row.month: row.net_pay for row in cashflow_rows}
    months = sorted(set(by_kind) | set(net_pay_by_month))
    savings_rows = compose_months(
        months, by_kind, net_pay_by_month, await load_payroll_by_month(db, months)
    )
    rows_by_year: dict[int, list[MonthSavings]] = {}
    for row in savings_rows:
        rows_by_year.setdefault(row.month.year, []).append(row)

    rollups = []
    for year in years:
        by_category = {c.id: Decimal("0.00") for c in categories}
        total = Decimal("0.00")
        for row in spend_rows:
            if row.month.year == year:
                by_category[row.category_id] += row.amount
                total += row.amount
        pay_rows = [r.net_pay for r in cashflow_rows if r.month.year == year]
        net_pay_total = sum(pay_rows, Decimal("0.00")) if pay_rows else None
        period = rollup(rows_by_year.get(year, []))
        rollups.append(
            YearRollup(
                year=year,
                by_category=[
                    YearCategoryTotal(category_id=c.id, total=by_category[c.id]) for c in categories
                ],
                total=total,
                net_pay_total=net_pay_total,
                savings_rate=period.cash_rate,
                months_matched=period.months_matched,
                living_total=period.living_spend,
                tax_total=period.tax_paid,
                transfer_total=period.transfers,
                cash_savings=period.cash_savings,
                payroll_savings=period.payroll_savings,
                total_savings=period.total_savings,
                total_savings_rate=period.total_rate,
            )
        )
    return YearlyOut(years=rollups)
```

- [ ] **Step 5: Run to verify it passes**

Run: `FINANCE_TEST_DB=finance_test_ha <venv-python> -m pytest tests/test_spending_api.py -q`
Expected: PASS — including the old `test_yearly_rollups`: its 2025 matched month is December (0.750000 as before) and its 2026 rate stays `None` (February's zero net pay).

- [ ] **Step 6: Mutation check**

Temporarily change `period = rollup(rows_by_year.get(year, []))` to `period = rollup(savings_rows)` (every year's rows in every year), run `FINANCE_TEST_DB=finance_test_ha <venv-python> -m pytest tests/test_spending_api.py -q -k yearly` and confirm `test_yearly_rollup_of_a_year_with_nothing_matched` and the old `test_yearly_rollups` FAIL. Revert and re-run to green.

- [ ] **Step 7: Commit**

```bash
git add backend/app/schemas/spending.py backend/app/api/spending.py backend/tests/test_spending_api.py
git commit -m "feat(spending): yearly rollup carries kinds, both rates and months_matched"
```

---

### Task 6: `services/coverage.py` and the extended `GET /coverage`

**Files:**
- Create: `backend/app/services/coverage.py`
- Modify: `backend/app/schemas/coverage.py`
- Modify: `backend/app/api/coverage.py`
- Test: `backend/tests/test_coverage_service.py` (new), `backend/tests/test_coverage_api.py`

- [ ] **Step 1: Write the failing service tests**

Create `backend/tests/test_coverage_service.py`:

```python
"""The one entered/empty/missing definition (2026-09-04 honest-numbers spec §3)."""

from datetime import date
from decimal import Decimal

from app.models import MonthlyCashflow, MonthlySpending, NetWorthSnapshot, SpendingCategory
from app.services.coverage import classify, load_coverage

D = Decimal


def test_classify_sorts_months_into_entered_empty_and_missing():
    balances = [date(2026, 5, 1), date(2026, 1, 1)]  # unsorted on purpose; window Jan..May
    spending = {
        date(2026, 1, 1): True,  # real amounts
        date(2026, 2, 1): False,  # rows, all $0.00, no take-home -> EMPTY
        date(2026, 3, 1): False,  # rows, all $0.00, but take-home entered -> ENTERED
        date(2026, 5, 1): True,
    }
    net_pay = [date(2026, 3, 1), date(2026, 5, 1), date(2026, 6, 1)]
    found = classify(balances, spending, net_pay)
    assert found.balances == [date(2026, 1, 1), date(2026, 5, 1)]
    assert found.entered == [
        date(2026, 1, 1),
        date(2026, 3, 1),
        date(2026, 5, 1),
        date(2026, 6, 1),  # take-home alone is enough to call a month entered
    ]
    assert found.empty == [date(2026, 2, 1)]
    assert found.missing == [date(2026, 4, 1)]  # inside the window, nothing at all on file
    assert found.net_pay_missing == [date(2026, 1, 1), date(2026, 2, 1), date(2026, 4, 1)]
    # June: pay saved alone. Entered, but there is no spend to average — the health card
    # names it so it cannot masquerade as a frugal month (spec §6).
    assert found.net_pay_without_spending == [date(2026, 6, 1)]


def test_classify_without_balances_has_no_window_to_call_anything_missing():
    found = classify([], {date(2026, 2, 1): True}, [date(2026, 3, 1)])
    assert found.missing == [] and found.net_pay_missing == []
    assert found.entered == [date(2026, 2, 1), date(2026, 3, 1)]


async def test_load_coverage_classifies_what_the_tables_hold(db):
    cat = SpendingCategory(name="Rent", slug="rent", sort_order=1)
    db.add(cat)
    await db.flush()
    db.add_all(
        [
            NetWorthSnapshot(month=date(2026, 1, 1)),
            NetWorthSnapshot(month=date(2026, 4, 1)),
            MonthlySpending(month=date(2026, 1, 1), category_id=cat.id, amount=D("1200.00")),
            # A refund-only month is still ENTERED: non-zero is non-zero, sign and all.
            MonthlySpending(month=date(2026, 2, 1), category_id=cat.id, amount=D("-50.00")),
            MonthlySpending(month=date(2026, 4, 1), category_id=cat.id, amount=D("0.00")),
            MonthlyCashflow(month=date(2026, 1, 1), net_pay=D("8000.00")),
        ]
    )
    await db.commit()
    found = await load_coverage(db)
    assert found.entered == [date(2026, 1, 1), date(2026, 2, 1)]
    assert found.empty == [date(2026, 4, 1)]
    assert found.missing == [date(2026, 3, 1)]
    assert found.net_pay == [date(2026, 1, 1)]
    assert found.net_pay_missing == [date(2026, 2, 1), date(2026, 3, 1), date(2026, 4, 1)]
    assert found.net_pay_without_spending == []
```

- [ ] **Step 2: Run to verify they fail**

Run: `FINANCE_TEST_DB=finance_test_ha <venv-python> -m pytest tests/test_coverage_service.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.coverage'`.

- [ ] **Step 3: Write the service**

Create `backend/app/services/coverage.py`:

```python
"""The ONE definition of coverage (2026-09-04 honest-numbers spec §3).

A spending month is ENTERED when it has at least one non-zero amount OR a net-pay row.
A month whose rows are all $0.00 with no net pay is EMPTY — saved, but carrying nothing,
and it must never draw as a real $0 month. A month inside the window with no rows and no
net pay is MISSING. The window is the balances coverage (first snapshot month … latest
snapshot month): balances are the ritual's anchor, so a month outside them was never part
of the book and cannot be "missing" from it.

`GET /coverage` and three health checks read THIS module, so the footer, the ribbon, the
attention list and the Health card can never disagree about what "entered" means.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import MonthlyCashflow, MonthlySpending, NetWorthSnapshot


@dataclass(frozen=True)
class Coverage:
    """Every list ascending, first-of-month dates, one entry per month."""

    balances: list[date]
    entered: list[date]
    empty: list[date]
    missing: list[date]
    net_pay: list[date]
    net_pay_missing: list[date]
    # Take-home saved with no spending rows at all: entered, but nothing to average.
    net_pay_without_spending: list[date]


def _window(balances: Sequence[date]) -> list[date]:
    """Every first-of-month from the first snapshot to the last, inclusive."""
    if not balances:
        return []
    start = balances[0].year * 12 + balances[0].month - 1
    end = balances[-1].year * 12 + balances[-1].month - 1
    return [date(index // 12, index % 12 + 1, 1) for index in range(start, end + 1)]


def classify(
    balances: Sequence[date], spending: Mapping[date, bool], net_pay: Sequence[date]
) -> Coverage:
    """`spending` maps every month WITH rows to "does it carry a non-zero amount"."""
    pay = set(net_pay)
    months = sorted(balances)
    window = _window(months)
    return Coverage(
        balances=months,
        entered=sorted({month for month, nonzero in spending.items() if nonzero} | pay),
        empty=sorted(
            month for month, nonzero in spending.items() if not nonzero and month not in pay
        ),
        missing=[month for month in window if month not in spending and month not in pay],
        net_pay=sorted(pay),
        net_pay_missing=[month for month in window if month not in pay],
        net_pay_without_spending=sorted(month for month in pay if month not in spending),
    )


async def load_coverage(db: AsyncSession) -> Coverage:
    """One query per table (spec §3). The spending query carries the month's peak
    |amount| so "entered" is decided in SQL's own words, not by loading every row."""
    balances = list(
        (await db.execute(select(NetWorthSnapshot.month).distinct())).scalars().all()
    )
    spend_rows = (
        await db.execute(
            select(MonthlySpending.month, func.max(func.abs(MonthlySpending.amount))).group_by(
                MonthlySpending.month
            )
        )
    ).all()
    net_pay = list((await db.execute(select(MonthlyCashflow.month))).scalars().all())
    return classify(balances, {month: peak != 0 for month, peak in spend_rows}, net_pay)
```

- [ ] **Step 4: Run the service tests, then write the failing API test**

Run: `FINANCE_TEST_DB=finance_test_ha <venv-python> -m pytest tests/test_coverage_service.py -q`
Expected: PASS (3 passed).

Now REPLACE `test_coverage_is_empty_on_an_empty_book` in `backend/tests/test_coverage_api.py` and append the second test:

```python
async def test_coverage_is_empty_on_an_empty_book(auth_client):
    resp = await auth_client.get("/api/v1/coverage")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {
        "balances": [],
        "spending": [],
        "net_pay": [],
        "spending_empty": [],
        "spending_missing": [],
        "net_pay_missing": [],
        "latest": {"balances": None, "spending": None, "net_pay": None},
    }


async def test_coverage_lists_entered_empty_and_missing_spending_months(auth_client, db):
    cat = SpendingCategory(name="Rent", slug="rent", sort_order=1)
    db.add(cat)
    await db.flush()
    db.add_all(
        [
            NetWorthSnapshot(month=date(2026, 7, 1)),
            NetWorthSnapshot(month=date(2026, 9, 1)),
            MonthlySpending(month=date(2026, 7, 1), category_id=cat.id, amount=Decimal("2172.00")),
            # September: 19 rows of $0.00 and no take-home — production's phantom month.
            MonthlySpending(month=date(2026, 9, 1), category_id=cat.id, amount=Decimal("0.00")),
            MonthlyCashflow(month=date(2026, 7, 1), net_pay=Decimal("6373.09")),
        ]
    )
    await db.commit()
    body = (await auth_client.get("/api/v1/coverage")).json()
    # `spending` now lists ENTERED months only: the footer says "through Jul", not "Sep".
    assert body["spending"] == ["2026-07-01"]
    assert body["spending_empty"] == ["2026-09-01"]
    assert body["spending_missing"] == ["2026-08-01"]
    assert body["net_pay_missing"] == ["2026-08-01", "2026-09-01"]
    assert body["latest"] == {
        "balances": "2026-09-01",
        "spending": "2026-07-01",
        "net_pay": "2026-07-01",
    }
```

Run: `FINANCE_TEST_DB=finance_test_ha <venv-python> -m pytest tests/test_coverage_api.py -q`
Expected: FAIL — the empty-book assert reports the three new keys missing.

- [ ] **Step 5: Extend the schema and the route**

Replace `backend/app/schemas/coverage.py` with:

```python
from datetime import date

from pydantic import BaseModel


class CoverageLatestOut(BaseModel):
    """The newest month each feed covers — None when the feed has nothing. `spending` is
    the newest ENTERED month, which is what the footer and the freshness cue name."""

    balances: date | None
    spending: date | None
    net_pay: date | None


class CoverageOut(BaseModel):
    """Which months each hand-entered feed covers (2026-09-03 shell spec §7, extended by
    the 2026-09-04 honest-numbers spec §3). Ascending first-of-month dates, one entry per
    month regardless of row count.

    `spending` lists ENTERED months only — a month whose rows are all $0.00 with no
    take-home is in `spending_empty`, and a month inside the balances window with nothing
    at all is in `spending_missing`. `balances` and `net_pay` are unchanged.
    """

    balances: list[date]
    spending: list[date]
    net_pay: list[date]
    spending_empty: list[date]
    spending_missing: list[date]
    net_pay_missing: list[date]
    latest: CoverageLatestOut
```

Replace the body of `backend/app/api/coverage.py` below its docstring with:

```python
from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.schemas.coverage import CoverageLatestOut, CoverageOut
from app.services.coverage import load_coverage

router = APIRouter(prefix="/coverage", tags=["coverage"], dependencies=[Depends(get_current_user)])


def _latest(months: list[date]) -> date | None:
    return months[-1] if months else None


@router.get("", response_model=CoverageOut)
async def coverage(db: AsyncSession = Depends(get_db)) -> CoverageOut:
    found = await load_coverage(db)
    return CoverageOut(
        balances=found.balances,
        spending=found.entered,
        net_pay=found.net_pay,
        spending_empty=found.empty,
        spending_missing=found.missing,
        net_pay_missing=found.net_pay_missing,
        latest=CoverageLatestOut(
            balances=_latest(found.balances),
            spending=_latest(found.entered),
            net_pay=_latest(found.net_pay),
        ),
    )
```

Update the module docstring's second paragraph to say the classification lives in `services/coverage.py` and that the endpoint still runs one query per table.

- [ ] **Step 6: Run to verify it passes**

Run: `FINANCE_TEST_DB=finance_test_ha <venv-python> -m pytest tests/test_coverage_api.py tests/test_coverage_service.py -q`
Expected: PASS. `test_coverage_lists_each_feed_ascending_and_deduplicated` still passes: its spending months carry non-zero amounts, so entered == the old list.

- [ ] **Step 7: Mutation check**

Temporarily change `classify`'s `entered=` expression to drop the `| pay` union, run `FINANCE_TEST_DB=finance_test_ha <venv-python> -m pytest tests/test_coverage_service.py -q` and confirm `test_classify_sorts_months_into_entered_empty_and_missing` FAILS (June and March drop out of `entered`). Revert and re-run to green.

- [ ] **Step 8: Commit**

```bash
git add backend/app/services/coverage.py backend/app/schemas/coverage.py backend/app/api/coverage.py backend/tests/test_coverage_service.py backend/tests/test_coverage_api.py
git commit -m "feat(coverage): entered/empty/missing months behind one definition"
```

---

### Task 7: Health checks read the one coverage definition

**Files:**
- Modify: `backend/app/services/health_checks.py:47-131` and `:302-314` (`run_checks`)
- Test: `backend/tests/test_health_checks.py`, `backend/tests/test_system_health_api.py`

- [ ] **Step 1: Write the failing tests**

In `backend/tests/test_health_checks.py`: add `NetWorthSnapshot` to the `app.models` import if absent (it is already there), extend the `app.services.health_checks` import with `check_net_pay_without_spending` and `check_spending_gap`, add `from app.services.coverage import load_coverage`, and replace the two existing call sites — line 68 `check = await check_zero_filled_spending(db)` and line 78 `assert (await check_zero_filled_spending(db)).severity == "ok"` — with `check = check_zero_filled_spending(await load_coverage(db))` and `assert check_zero_filled_spending(await load_coverage(db)).severity == "ok"`. Then append:

```python
async def test_spending_gap_names_months_missing_inside_the_balances_window(db):
    food, _rent = await categories(db)
    db.add_all(
        [
            NetWorthSnapshot(month=date(2026, 7, 1)),
            NetWorthSnapshot(month=date(2026, 9, 1)),
            MonthlySpending(month=date(2026, 7, 1), category_id=food.id, amount=Decimal("400.00")),
            # September was saved with balances only: 19 rows of $0.00, no take-home.
            MonthlySpending(month=date(2026, 9, 1), category_id=food.id, amount=Decimal("0.00")),
        ]
    )
    await db.commit()
    coverage = await load_coverage(db)

    gap = check_spending_gap(coverage)
    assert gap.severity == "warn" and gap.count == 1
    assert gap.months == [date(2026, 8, 1)]  # nothing at all on file, and inside the window
    assert gap.fix.to == "/update?month=2026-08-01&step=spending"
    # The empty September belongs to the zero-filled check; neither claims the other's month.
    assert check_zero_filled_spending(coverage).months == [date(2026, 9, 1)]


async def test_spending_gap_is_ok_when_the_window_is_covered(db):
    food, _rent = await categories(db)
    db.add_all(
        [
            NetWorthSnapshot(month=date(2026, 7, 1)),
            MonthlySpending(month=date(2026, 7, 1), category_id=food.id, amount=Decimal("400.00")),
        ]
    )
    await db.commit()
    assert check_spending_gap(await load_coverage(db)).severity == "ok"


async def test_net_pay_without_spending_refuses_to_read_as_a_frugal_month(db):
    db.add(MonthlyCashflow(month=date(2026, 8, 1), net_pay=Decimal("6373.09")))
    await db.commit()
    check = check_net_pay_without_spending(await load_coverage(db))
    assert check.severity == "warn" and check.months == [date(2026, 8, 1)]
    assert check.fix.to == "/update?month=2026-08-01&step=spending"
    assert "take-home was entered but no spending row exists" in check.detail
```

Then update `test_run_checks_returns_the_seven_in_order` — rename it to `test_run_checks_returns_the_nine_in_order` and replace its body's two asserts with:

```python
    assert [c.id for c in checks] == [
        "zero_filled_spending",
        "spending_gap",
        "net_pay_without_spending",
        "balances_without_spending",
        "spending_without_balances",
        "stale_quotes",
        "identical_snapshot",
        "backup",
        "snapshot",
    ]
    assert [c.severity for c in checks] == [
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "info",
        "ok",
    ]
```

And in `backend/tests/test_system_health_api.py`, replace the `ids ==` list inside `test_health_shape_on_a_bare_database` with the same nine ids in the same order.

- [ ] **Step 2: Run to verify they fail**

Run: `FINANCE_TEST_DB=finance_test_ha <venv-python> -m pytest tests/test_health_checks.py -q`
Expected: FAIL — `ImportError: cannot import name 'check_spending_gap' from 'app.services.health_checks'`.

- [ ] **Step 3: Rewrite the three coverage-fed checks**

In `backend/app/services/health_checks.py`, add to the imports:

```python
from app.services.coverage import Coverage, load_coverage
```

Replace `check_zero_filled_spending` (lines 47-74) with the hoisted gap builder plus the three checks:

```python
def _month_gap(
    check_id: str, title: str, months: list[date], step: str, verb: str
) -> HealthCheckOut:
    """A warn-level "these months are not on file" card with a link into the wizard's
    step for the FIRST of them. Shared by every gap rule so one sentence shape, one
    severity and one link format cover them all."""
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


def check_zero_filled_spending(coverage: Coverage) -> HealthCheckOut:
    """Months saved with rows that are ALL $0.00 and no take-home — the audit's phantom
    month. `coverage.empty` is the shared definition (2026-09-04 honest-numbers spec §3),
    so this card, the footer and the ribbon can never disagree."""
    months = coverage.empty
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
        fix=HealthFixOut(
            kind="action", action="delete_spending_month", label="Delete the zero-filled month"
        ),
    )


def check_spending_gap(coverage: Coverage) -> HealthCheckOut:
    """Months inside the BALANCES window with no spending rows and no take-home.

    Distinct from `balances_without_spending`, which reads the trailing twelve COMPLETE
    months and needs a snapshot in the month itself: this one covers the whole window the
    balances span, which is what the footer and the attention list quote.
    """
    return _month_gap(
        "spending_gap",
        "Spending months never entered",
        coverage.missing,
        "spending",
        "balances cover this month but no spending or take-home was ever entered",
    )


def check_net_pay_without_spending(coverage: Coverage) -> HealthCheckOut:
    """Take-home saved alone. The month is ENTERED, and its living spend is 0 — so
    without this card it would read as the most frugal month on record (spec §6)."""
    return _month_gap(
        "net_pay_without_spending",
        "Take-home entered, spending missing",
        coverage.net_pay_without_spending,
        "spending",
        "take-home was entered but no spending row exists",
    )
```

Then simplify `check_coverage_gaps` to use the shared builder: delete its nested `def gap(...)` and change its `return (...)` to call `_month_gap(...)` with exactly the same five arguments it passed before (`"balances_without_spending"`, `"Balances entered, spending missing"`, `without_spending`, `"spending"`, `"balances were saved but no spending row exists"`, and the `spending_without_balances` quartet).

- [ ] **Step 4: Load coverage once in `run_checks`**

Replace `run_checks`'s body with:

```python
async def run_checks(
    db: AsyncSession, *, now: datetime, environment: str, snapshot_enabled: bool
) -> list[HealthCheckOut]:
    # ONE coverage read for the three rules that share its definition.
    coverage = await load_coverage(db)
    without_spending, without_balances = await check_coverage_gaps(db, today=now.date())
    return [
        check_zero_filled_spending(coverage),
        check_spending_gap(coverage),
        check_net_pay_without_spending(coverage),
        without_spending,
        without_balances,
        await check_stale_quotes(db, now=now),
        await check_identical_snapshot(db),
        await check_backup(db, now=now, environment=environment),
        await asyncio.to_thread(check_snapshot, now=now, snapshot_enabled=snapshot_enabled),
    ]
```

The old zero-filled query was this module's only user of `func` and of `MonthlyCashflow`, so both imports are now dead — run ruff (Step 5) and delete exactly what it names as unused, nothing more (`MonthlySpending` and `NetWorthSnapshot` are still read by `check_coverage_gaps`).

- [ ] **Step 5: Run to verify they pass**

Run: `FINANCE_TEST_DB=finance_test_ha <venv-python> -m pytest tests/test_health_checks.py tests/test_system_health_api.py -q && <venv-python> -m ruff check app`
Expected: all tests pass; ruff clean (fix any `F401 imported but unused` it reports in `health_checks.py`).

- [ ] **Step 6: Mutation check**

Temporarily change `check_spending_gap` to pass `coverage.empty` instead of `coverage.missing`, run `FINANCE_TEST_DB=finance_test_ha <venv-python> -m pytest tests/test_health_checks.py -q` and confirm `test_spending_gap_names_months_missing_inside_the_balances_window` FAILS (it names September, not August). Revert and re-run to green.

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/health_checks.py backend/tests/test_health_checks.py backend/tests/test_system_health_api.py
git commit -m "feat(health): spending_gap and net-pay-without-spending on the shared coverage rule"
```

---

### Task 8: The projection derives over the matched window and echoes it

**Files:**
- Modify: `backend/app/schemas/projection.py` (add `DerivedWindowOut`, `ProjectionOut.derived_window`)
- Modify: `backend/app/api/projection.py:118-163` (delete both trailing helpers), `:285-360` (the endpoint)
- Test: `backend/tests/test_projection_api.py`

- [ ] **Step 1: Write the failing tests**

In `backend/tests/test_projection_api.py`, add `from sqlalchemy import select` under the stdlib imports, then append:

```python
async def test_projection_annual_spend_is_living_spend_over_the_matched_window(auth_client, db):
    this_month = await _seed_book(db)
    taxes = SpendingCategory(name="Taxes", slug="taxes", sort_order=2, kind="tax")
    db.add(taxes)
    await db.flush()
    db.add(
        MonthlySpending(
            month=month_add(this_month, -1), category_id=taxes.id, amount=Decimal("1200.00")
        )
    )
    await db.commit()
    body = (await auth_client.get("/api/v1/projection")).json()
    # An income-tax payment is not living cost, so the FI target does not grow by it...
    assert body["annual_spend"] == "60000.00"  # mean(6000, 4000) x 12, unchanged
    # ...but it WAS paid out of take-home, so cash savings fall: mean(1800, 5000).
    assert body["monthly_contribution"] == "3400.00"
    assert body["derived_window"] == {
        "from": month_add(this_month, -2).isoformat(),
        "to": month_add(this_month, -1).isoformat(),
        "months": 2,
    }


async def test_projection_ignores_a_zero_filled_month_with_no_take_home(auth_client, db):
    this_month = await _seed_book(db)
    rent = (await db.execute(select(SpendingCategory))).scalars().one()
    # The audit's headline: a balances-only save wrote $0.00 for every category this
    # month. It has no take-home, so it is not a matched month and cannot drag the mean.
    db.add(MonthlySpending(month=this_month, category_id=rent.id, amount=Decimal("0.00")))
    await db.commit()
    body = (await auth_client.get("/api/v1/projection")).json()
    assert body["annual_spend"] == "60000.00"  # NOT mean(0, 6000, 4000) x 12 = 40000.00
    assert body["monthly_contribution"] == "4000.00"
    assert body["derived_window"]["months"] == 2
    assert body["derived_window"]["to"] == month_add(this_month, -1).isoformat()


async def test_projection_says_so_when_no_month_has_both_halves(auth_client, db):
    this_month = await _seed_book(db, with_history=False)
    cat = SpendingCategory(name="Rent", slug="rent", sort_order=1)
    db.add(cat)
    await db.flush()
    # Spending in one month, take-home in another: data everywhere, nothing to average.
    db.add_all(
        [
            MonthlySpending(
                month=month_add(this_month, -2), category_id=cat.id, amount=Decimal("5000.00")
            ),
            MonthlyCashflow(month=month_add(this_month, -1), net_pay=Decimal("9000.00")),
        ]
    )
    await db.commit()
    body = (await auth_client.get("/api/v1/projection")).json()
    assert body["derived_window"] is None
    assert body["monthly_contribution"] == "0.00"
    assert body["annual_spend"] is None
    assert (
        "no month has both spending and take-home on file — the contribution and annual "
        "spend could not be derived"
    ) in body["warnings"]
```

- [ ] **Step 2: Run to verify they fail**

Run: `FINANCE_TEST_DB=finance_test_ha <venv-python> -m pytest tests/test_projection_api.py -q -k "matched_window or zero_filled or both_halves"`
Expected: FAIL — `KeyError: 'derived_window'`.

- [ ] **Step 3: Add the echo to the schema**

In `backend/app/schemas/projection.py`, change the pydantic import to `from pydantic import BaseModel, ConfigDict, Field` and add above `ProjectionOut`:

```python
class DerivedWindowOut(BaseModel):
    """The months a DERIVED `annual_spend`/`monthly_contribution` was averaged over
    (2026-09-04 honest-numbers spec §3): the last twelve months that have both spending
    rows and take-home. `months` is how many actually matched — the endpoints can straddle
    a gap month, and saying "12 months" when 11 matched is the error this echo exists to
    prevent. Null when the knobs were supplied, or when no month has both halves.

    FastAPI serializes response models BY ALIAS, so the wire spells these `from` and `to`;
    `from` is a Python keyword, hence the `_month` suffix on the fields.
    """

    model_config = ConfigDict(populate_by_name=True)

    from_month: date = Field(alias="from")
    to_month: date = Field(alias="to")
    months: int
```

and add as the last field of `ProjectionOut`:

```python
    # The window the derivation used (2026-09-04). Null when nothing was derived, so an
    # older stored payload still validates.
    derived_window: DerivedWindowOut | None = None
```

- [ ] **Step 4: Derive from the service**

In `backend/app/api/projection.py`:

1. DELETE `_trailing_annual_spend` (lines 118-132) and `_trailing_savings` (lines 135-163).
2. Add the import `from app.services.savings import load_month_savings, matched_months, payroll_monthly` (this replaces the `payroll_monthly` import added in Task 3) and extend the schema import with `DerivedWindowOut`.
3. Add next to the other message constants:

```python
NO_MATCHED_MONTHS_WARNING = (
    "no month has both spending and take-home on file — the contribution and annual "
    "spend could not be derived"
)
```

4. In `projection`, immediately AFTER the `annual_return` block and BEFORE `contribution_breakdown: ContributionBreakdownOut | None = None`, insert:

```python
    # ONE window for both derivations (spec §3): the last twelve months with spending rows
    # AND take-home. Before this, the spend mean and the savings mean averaged DIFFERENT
    # months — and the spend mean counted a zero-filled month as a month of no spending.
    savings_rows = await load_month_savings(db)
    window = matched_months(savings_rows, TRAILING_MONTHS)
    has_cashflow = any(row.net_pay is not None for row in savings_rows)
    has_spending = any(row.has_spending_rows for row in savings_rows)
    derived_window = (
        None
        if not window
        else DerivedWindowOut(
            from_month=window[0].month, to_month=window[-1].month, months=len(window)
        )
    )
    if (
        not window
        and (has_cashflow or has_spending)
        and (monthly_contribution is None or annual_spend is None)
    ):
        # Data on both sides, no month carrying both: say so rather than let a knob
        # quietly read 0 as if the book were empty.
        warnings.append(NO_MATCHED_MONTHS_WARNING)
```

5. Replace the contribution derivation's `cash = await _trailing_savings(db)` block with:

```python
    contribution_breakdown: ContributionBreakdownOut | None = None
    if monthly_contribution is None:
        payroll, by_person, payroll_warnings = await _payroll_savings(db, today)
        warnings.extend(payroll_warnings)
        if not window:
            cash_part = ZERO
            if not has_cashflow:
                warnings.append(
                    NO_CASHFLOW_WARNING if payroll <= ZERO else NO_CASHFLOW_PAYROLL_WARNING
                )
        else:
            # Every matched row has a cash figure by construction (net pay is on file).
            # Sum the EMITTED month figures, divide, quantize ONCE at the end — the
            # savings service's rounding contract, so this mean is the same money the
            # matrix printed.
            total_cash = sum(
                (row.cash_savings for row in window if row.cash_savings is not None), Decimal(0)
            )
            cash_part = (total_cash / len(window)).quantize(CENT, rounding=ROUND_HALF_UP)
        # Both halves are cents already, so the sum needs no second rounding; quantize
        # anyway so a Decimal('0') cash part still echoes as "0.00".
        monthly_contribution = (cash_part + payroll).quantize(CENT, rounding=ROUND_HALF_UP)
        contribution_breakdown = ContributionBreakdownOut(
            cash=cash_part, payroll=payroll, total=monthly_contribution, by_person=by_person
        )
    else:
        monthly_contribution = quantize_money(
            monthly_contribution, "monthly_contribution", max_abs=CONTRIBUTION_MAX_ABS
        )
```

6. Replace the `annual_spend` derivation with:

```python
    if annual_spend is None:
        # LIVING spend only (spec §2): an income-tax payment and a transfer to a brokerage
        # are both money that must not inflate an FI target. Sum the EMITTED months,
        # divide, x12, quantize ONCE — never a rounded mean multiplied out.
        derived_spend = (
            None
            if not window
            else sum((row.living_spend for row in window), Decimal(0)) / len(window) * 12
        )
        if derived_spend is None or derived_spend <= 0:
            annual_spend = None
            # An EMPTY book still gets the old sentence; a book with data but no matched
            # month already carries NO_MATCHED_MONTHS_WARNING, which says more.
            if NO_MATCHED_MONTHS_WARNING not in warnings:
                warnings.append(NO_SPEND_WARNING)
        else:
            annual_spend = derived_spend.quantize(CENT, rounding=ROUND_HALF_UP)
    else:
        annual_spend = quantize_money(annual_spend, "annual_spend", max_abs=SPEND_MAX_ABS)
        if annual_spend <= 0:
            raise HTTPException(status_code=422, detail="annual_spend must be positive")
```

7. Add `derived_window=derived_window,` to the `ProjectionOut(...)` return.

8. Run ruff and delete whatever it names as unused in the imports (`func`, `MonthlyCashflow`, `MonthlySpending` were only used by the two deleted helpers).

- [ ] **Step 5: Run to verify they pass**

Run: `FINANCE_TEST_DB=finance_test_ha <venv-python> -m pytest tests/test_projection_api.py -q && <venv-python> -m ruff check app`
Expected: all pass — including `test_projection_defaults_derive_from_the_data` (window = the two seeded months: contribution 4000.00, spend 60000.00) and `test_projection_payroll_alone_when_there_is_no_cashflow_history` (empty book: `NO_CASHFLOW_PAYROLL_WARNING`, cash 0.00). Ruff clean.

- [ ] **Step 6: Mutation check**

Temporarily change the spend derivation's `row.living_spend` to `row.living_spend + row.tax_paid`, run `FINANCE_TEST_DB=finance_test_ha <venv-python> -m pytest tests/test_projection_api.py -q -k matched_window` and confirm the test FAILS (`annual_spend` reads `67200.00`). Revert and re-run to green.

- [ ] **Step 7: Commit**

```bash
git add backend/app/api/projection.py backend/app/schemas/projection.py backend/tests/test_projection_api.py
git commit -m "feat(projection): derive spend and savings over one matched window, echo it"
```

---

### Task 9: Money flow names the take-home not yet entered

**Files:**
- Modify: `backend/app/services/money_flow.py:142-158` (`MoneyFlow`) and `:222-225` (the residual)
- Modify: `backend/app/schemas/overview.py:41-67` (`MoneyFlowOut`)
- Modify: `backend/app/api/overview.py:72-116` (`_money_flow_out`)
- Test: `backend/tests/test_money_flow.py`, `backend/tests/test_overview_api.py`

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_money_flow.py`:

```python
def test_take_home_pending_estimates_the_months_not_yet_entered():
    # Production's 2026: 44,611.60 of take-home over Jan-Jul.
    flow = compose(net_pay_sum=D("44611.60"), net_pay_months=7)
    assert flow.take_home_months_entered == 7
    # mean(entered) x (12 - entered) = 6,373.0857... x 5, quantized ONCE at the wire.
    assert flow.take_home_pending.quantize(D("0.01"), rounding=ROUND_HALF_UP) == D("31865.43")
    # The residual now sheds it: money already earned is not "retained equity".
    assert flow.retained_equity == (
        flow.gross_income
        - flow.taxes.total
        - flow.pre_tax_savings
        - flow.take_home_cash
        - flow.take_home_pending
    )


def test_take_home_pending_is_zero_on_a_full_year_and_on_an_empty_one():
    full = compose()  # 12/12 entered
    assert full.take_home_pending == D("0") and full.take_home_months_entered == 12
    # Nothing entered: there is no mean to extrapolate from, so the node stays shut.
    empty = compose(net_pay_sum=D("0"), net_pay_months=0)
    assert empty.take_home_pending == D("0") and empty.take_home_months_entered == 0
```

In `backend/tests/test_overview_api.py`, inside `test_money_flow_composes_the_year_and_cross_checks_the_engine` (the test asserting `body["take_home_cash"] == "70000.00"`), add after that line:

```python
    # 7 months entered at 10,000 -> 5 months of take-home still to enter.
    assert body["take_home_months_entered"] == 7
    assert body["take_home_pending"] == "50000.00"
```

and extend the conservation block's `mid` sum with the new term:

```python
    mid = (
        Decimal(body["taxes"]["total"])
        + Decimal(body["pre_tax_savings"])
        + Decimal(body["take_home_cash"])
        + Decimal(body["take_home_pending"])
        + Decimal(body["retained_equity"])
    )
    assert mid == Decimal(body["gross_income"])
```

- [ ] **Step 2: Run to verify they fail**

Run: `FINANCE_TEST_DB=finance_test_ha <venv-python> -m pytest tests/test_money_flow.py tests/test_overview_api.py -q -k "pending or cross_checks_the_engine"`
Expected: FAIL — `AttributeError: 'MoneyFlow' object has no attribute 'take_home_pending'`.

- [ ] **Step 3: Compute it in the service**

In `backend/app/services/money_flow.py`, add the two fields to the `MoneyFlow` dataclass immediately after `take_home_cash` (they must precede `warnings`, which carries a default):

```python
    take_home_cash: Decimal
    # The year's take-home that HAS been earned but not yet entered: mean of the entered
    # months x the months still missing (2026-09-04 honest-numbers spec §3). Zero on a
    # complete year and on a year with nothing entered — there is no mean to extrapolate.
    take_home_pending: Decimal
    take_home_months_entered: int
    retained_equity: Decimal
```

Replace the residual block (lines 222-225) with:

```python
    pre_tax_savings = sum((value(key) for key in PRETAX_KEYS), ZERO)
    take_home_cash = net_pay_sum
    # A half-entered year used to dump every un-entered month of pay into the residual,
    # so "retained equity" silently meant "equity plus the take-home I have not typed in
    # yet". Naming the estimate is the honest version — the card draws it as its own
    # muted node. ONE division, and the quantize happens at the schema edge.
    take_home_pending = ZERO
    if 0 < net_pay_months < MONTHS_IN_YEAR:
        take_home_pending = (net_pay_sum / net_pay_months) * (MONTHS_IN_YEAR - net_pay_months)
    # RESIDUAL node: the middle column still sums back to gross, now with one more term.
    retained_equity = (
        gross_income - taxes.total - pre_tax_savings - take_home_cash - take_home_pending
    )
```

and add both to the `MoneyFlow(...)` return, right after `take_home_cash=take_home_cash,`:

```python
        take_home_pending=take_home_pending,
        take_home_months_entered=net_pay_months,
```

Extend the module docstring's conservation bullet to read: `retained_equity` is the RESIDUAL of the middle column: gross − taxes − pre-tax savings − take-home cash − take-home not yet entered.

- [ ] **Step 4: Put them on the wire**

In `backend/app/schemas/overview.py`, add to `MoneyFlowOut` immediately after `take_home_cash`:

```python
    # The take-home of the year's months that have NOT been entered, estimated from the
    # mean of the ones that have (2026-09-04 honest-numbers spec §3). 0.00 on a complete
    # year. The sankey draws it as a muted dashed node beside take-home.
    take_home_pending: Decimal
    take_home_months_entered: int
```

and update the `retained_equity` comment there to name the extra subtraction. In `backend/app/api/overview.py`, add to `_money_flow_out`'s `MoneyFlowOut(...)` call after `take_home_cash=_money(flow.take_home_cash),`:

```python
        take_home_pending=_money(flow.take_home_pending),
        take_home_months_entered=flow.take_home_months_entered,
```

- [ ] **Step 5: Run to verify they pass**

Run: `FINANCE_TEST_DB=finance_test_ha <venv-python> -m pytest tests/test_money_flow.py tests/test_overview_api.py -q`
Expected: PASS — the other conservation tests use 12/12 net-pay months, where the new term is exactly zero, so they are untouched.

- [ ] **Step 6: Mutation check**

Temporarily change the guard to `if 0 <= net_pay_months < MONTHS_IN_YEAR:`, run `FINANCE_TEST_DB=finance_test_ha <venv-python> -m pytest tests/test_money_flow.py -q -k pending` and confirm `test_take_home_pending_is_zero_on_a_full_year_and_on_an_empty_one` FAILS with `DivisionByZero`. Revert and re-run to green.

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/money_flow.py backend/app/schemas/overview.py backend/app/api/overview.py backend/tests/test_money_flow.py backend/tests/test_overview_api.py
git commit -m "feat(money-flow): name the take-home not yet entered instead of hiding it in the residual"
```

---

### Task 10: The assistant sees the same savings fields

**Files:**
- Modify: `backend/app/services/assistant_context.py:80-124` (`_household`) and `:187-225` (`_spending`)
- Test: `backend/tests/test_assistant_context.py`

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_assistant_context.py`:

```python
async def test_spending_context_carries_both_savings_definitions(db):
    await _seed_two_spending_months(db)
    section = (await build_context(db, route="/spending", search={}, view={}))["spending"]
    assert section["living_total"] == ["2000.00", "2100.00"]
    assert section["tax_total"] == ["0.00", "0.00"]
    assert section["transfer_total"] == ["0.00", "0.00"]
    assert section["cash_savings"] == ["5000.00", "4900.00"]
    assert section["payroll_savings"] == ["0.00", "0.00"]  # no paycheck profile on file
    assert section["total_savings"] == ["5000.00", "4900.00"]
    assert section["savings_rate"] == ["0.714286", "0.700000"]
    assert section["total_savings_rate"] == ["0.714286", "0.700000"]
    # The yearly rollup rides along with its new fields, so the model can quote a year.
    assert section["yearly"]["years"][0]["months_matched"] == 2


async def test_household_context_carries_the_latest_savings_figures(db):
    await _seed_two_spending_months(db)
    spending = (await build_context(db, route="/nonexistent", search={}, view={}))["household"][
        "spending"
    ]
    assert spending["latest_month"] == "2026-08-01"
    assert spending["latest_total"] == "2100.00"
    assert spending["latest_living_spend"] == "2100.00"
    assert spending["latest_tax_paid"] == "0.00"
    assert spending["latest_transfers"] == "0.00"
    assert spending["latest_savings_rate"] == "0.700000"
    assert spending["latest_payroll_savings"] == "0.00"
    assert spending["latest_total_savings"] == "4900.00"
    assert spending["latest_total_savings_rate"] == "0.700000"
```

- [ ] **Step 2: Run to verify they fail**

Run: `FINANCE_TEST_DB=finance_test_ha <venv-python> -m pytest tests/test_assistant_context.py -q -k "savings_definitions or latest_savings"`
Expected: FAIL — `KeyError: 'living_total'`.

- [ ] **Step 3: Extend the household section**

In `backend/app/services/assistant_context.py`, inside `_household`, replace the `"spending": {...}` block of the returned dict with a local reader and the fuller block. Insert this helper immediately before the `return {` (after `tax = next(...)`):

```python
    def latest(values: list):
        """The focus month's value, or None on an empty book — one guard, nine fields."""
        return values[latest_index] if latest_index >= 0 else None
```

and the block itself:

```python
        "spending": {
            "latest_month": latest(spend.months),
            "latest_total": latest(spend.totals),
            # The savings vocabulary the pages use (2026-09-04 honest-numbers spec §2):
            # the assistant must not invent a second definition of "saved".
            "latest_living_spend": latest(spend.living_total),
            "latest_tax_paid": latest(spend.tax_total),
            "latest_transfers": latest(spend.transfer_total),
            "latest_savings_rate": latest(spend.savings_rate),
            "latest_payroll_savings": latest(spend.payroll_savings),
            "latest_total_savings": latest(spend.total_savings),
            "latest_total_savings_rate": latest(spend.total_savings_rate),
        },
```

- [ ] **Step 4: Extend the spending section**

In `_spending`, add after the `"savings_rate": _tail(m.savings_rate, window),` line:

```python
            "living_total": _tail(m.living_total, window),
            "tax_total": _tail(m.tax_total, window),
            "transfer_total": _tail(m.transfer_total, window),
            "cash_savings": _tail(m.cash_savings, window),
            "payroll_savings": _tail(m.payroll_savings, window),
            "total_savings": _tail(m.total_savings, window),
            "total_savings_rate": _tail(m.total_savings_rate, window),
```

`"yearly": y` needs no change — `YearRollup`'s new fields serialize with it.

- [ ] **Step 5: Run to verify they pass**

Run: `FINANCE_TEST_DB=finance_test_ha <venv-python> -m pytest tests/test_assistant_context.py -q`
Expected: PASS — including the char-cap tests: the added arrays are short, and the tight-window retry is unchanged.

- [ ] **Step 6: Mutation check**

Temporarily change `"latest_total_savings_rate": latest(spend.total_savings_rate),` to `"latest_total_savings_rate": latest(spend.totals),`, run `FINANCE_TEST_DB=finance_test_ha <venv-python> -m pytest tests/test_assistant_context.py -q -k latest_savings` and confirm `test_household_context_carries_the_latest_savings_figures` FAILS (`"2100.00"` where a rate belongs). Revert and re-run to green.

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/assistant_context.py backend/tests/test_assistant_context.py
git commit -m "feat(assistant): context carries the one savings vocabulary"
```

---

### Task 11: Lane verification

**Files:** none (verification only).

- [ ] **Step 1: Full backend suite**

Run (from `<worktree>/backend`): `FINANCE_TEST_DB=finance_test_ha <venv-python> -m pytest -q`
Expected: all passed, 0 failed. Nothing skipped that was not skipped on `main`.

- [ ] **Step 2: Lint and format**

Run: `<venv-python> -m ruff check app tests && <venv-python> -m ruff format --check app tests`
Expected: `All checks passed!` and `N files already formatted`.

- [ ] **Step 3: One migration head, chained on the right parent**

Run: `<venv-python> -m alembic heads && <venv-python> -m alembic history | head -3`
Expected: `e5a7c1d3f6b8 (head)` on one line; the history's first entry reads `d4f6b8c0e2a5 -> e5a7c1d3f6b8 (head), spending_categories.kind`. (Applying it to the dev database and running `alembic check` is lane V's job, spec §7.)

- [ ] **Step 4: The replaced helpers are actually gone**

Run: `grep -rn "_savings_rate\|_trailing_annual_spend\|_trailing_savings\|_payroll_monthly" app`
Expected: no output. Each of those was one of the four private savings definitions this lane replaced; a survivor means a caller was missed.

- [ ] **Step 5: LF endings**

Run: `grep -rlIU $'\r' app tests alembic`
Expected: no output (no CRLF crept in).

- [ ] **Step 6: Record the run**

No commit of its own unless a step needed a fix; if one did, commit it as `fix(honest-a): <what>` and re-run Steps 1-2.

---

## Merge notes for the coordinator

- **`backend/app/api/spending.py` is shared with lane B.** This lane edits: the imports, `create_category` (one line), the deleted `_savings_rate`, `matrix` and `yearly`. Lane B edits `put_month` and `SpendingMonthUpsert`. Merge A first; B rebases and keeps A's import block.
- **`backend/app/schemas/spending.py`** — A owns `CategoryOut/Create/Update`, `MatrixOut`, `YearRollup`; B adds `SpendingMonthUpsert.confirm_zero`. Different classes, same file.
- **The migration is the program's only one.** If lane B or a later lane needs a schema change, it chains on `e5a7c1d3f6b8`, and `alembic heads` must still print one line.
- **Frontend types are NOT in this lane.** Lanes C/D/E branch from main after A merges and consume `kind`, the new `MatrixOut`/`YearRollup` fields, `CoverageOut.latest`, `derived_window` (wire spelling `from`/`to`) and `take_home_pending`.
- **Known overlap, deliberately kept:** `spending_gap` and the older `balances_without_spending` can both name a month (the first reads the whole balances window and treats a net-pay-only month as entered; the second reads the trailing twelve complete months and needs a snapshot in the month itself). The spec's retire list is empty, so neither is removed here — flag it for lane V's product pass.
- **Not in this lane by design:** the `confirm_zero` guard, parent derivation, the importer flag (all lane B); every UI consumer listed in spec §2/§3 (lanes C/D/E).

## Self-review

**Spec coverage, §1–§3 backend items.**

- §1 model: `spending_categories.kind`, `String(16)`, NOT NULL, server default `'living'`, CHECK in (living, tax, transfer) → Task 1 (model + migration, both carrying the CHECK because `create_all` builds the test schema). One Alembic revision chained on `d4f6b8c0e2a5` → Task 1 (`e5a7c1d3f6b8`), verified single-head in Task 11 Step 3. Seed by slug/name, case-insensitive: `taxes` → tax, `investments`/`financial` → transfer, everything else living → Task 1's two `op.execute` statements. Downgrade drops the column → Task 1.
- §1 API: `CategoryOut.kind`, `CategoryCreate.kind` (default `living`), `CategoryUpdate.kind` → Task 2, with the vocabulary enforced by a `Literal` on the write side and left as `str` on the read side (a GET must never 422 on stored data). §1's UI copy and the Settings picker are lane E.
- §2 service: `backend/app/services/savings.py` with `living_spend`, `tax_paid`, `transfers`, `net_pay`, `cash_savings`, `payroll_savings`, `total_savings`, `cash_rate`, `total_rate` exactly as the spec spells them → Task 3. `payroll_monthly` moved out of `api/projection.py` and imported back → Task 3 Step 4. Profile in force by `effective_date ≤ 1st of m`, latest wins; no profile = 0 (§6) → `payroll_by_month`. Payroll only when net pay is present (§2) → `month_savings`'s None branch. `net_pay = 0` → rates None, savings computed (§6) → the `rates_defined` guard and its parametrized case.
- §2 rounding (coordinator's amendment): every emitted MONTH figure is `half_up2` cents; every period scalar is the SUM of emitted months, and a mean quantizes once at the end → Task 3's docstring + `month_savings`/`payroll_by_month`, pinned by `test_the_emitted_month_rounds_half_up_and_a_period_sums_those_months` (4,450.925 → 4,450.93 → 31,156.51 → total 30,159.53 → 39.8%) and by Task 5's cross-endpoint invariant `YearRollup.payroll_savings == Σ MatrixOut.payroll_savings`. Task 8's mean and Task 9's `take_home_pending` both quantize once at the end.
- §2 wire: `MatrixOut` gains `living_total`, `tax_total`, `transfer_total`, `cash_savings`, `payroll_savings`, `total_savings`, `total_savings_rate`, with `savings_rate` KEEPING its name as the cash rate → Task 4. `YearRollup` gains the same as scalars plus `months_matched`, over matched months, `net_pay_total` unchanged → Task 5. `contribution_breakdown` reads the service with no arithmetic change → Task 3 Step 4 + Task 8 (the by-person rows and their rounding are untouched). `annual_spend` from living spend over the matched window → Task 8.
- §3 definition and wire: entered / empty / missing / window → Task 6's `services/coverage.py`; `CoverageOut` keeps `balances`/`net_pay`, narrows `spending` to entered, and gains `spending_empty`, `spending_missing`, `net_pay_missing`, `latest` → Task 6, one query per table.
- §3 consumers owned by this lane: `check_zero_filled_spending` on the shared helper, plus `spending_gap` → Task 7; §6's "net pay without spending" note → Task 7's `check_net_pay_without_spending`. Projection matched window + `derived_window: {from, to, months}` echo → Task 8. `MoneyFlowOut.take_home_pending` + `take_home_months_entered`, with `retained_equity` subtracting the pending figure → Task 9 (census pin 44,611.60 / 7 → 31,865.43). Assistant context fields → Task 10. The footer, ribbon, attention items, YTD card and sankey node are lanes C/D by §8, and the coverage payload they need ships here.
- Deliberately NOT covered (out of lane A per §8): `confirm_zero` and the wizard's server guard, parent derivation and `check_parent_component_drift`, importer changes, every frontend file. Deliberately not added: coverage fields in the assistant context — §2 asks only for the savings fields there, and §3 names no assistant consumer.

**Placeholder scan:** no "TBD", no "similar to Task N", no "add error handling"; every code step carries the code, every run step carries the command and the expected output, and each of Tasks 1-10 has an explicit mutation check with the failure it must produce.

**Type-name consistency across tasks:** `SpendingCategory.kind` (Task 1) is read as `c.kind` in Tasks 4/5 and as `SpendingCategory.kind` in Task 3's loader. `CategoryKind` (Task 2) is the write-side Literal only. `MonthSavings` fields — `month`, `living_spend`, `tax_paid`, `transfers`, `net_pay`, `payroll_savings`, `cash_savings`, `total_savings`, `cash_rate`, `total_rate`, `has_spending_rows`, `.matched` — are used with those exact names in Tasks 3, 4, 5 and 8; `PeriodSavings` adds `months_matched` and is consumed only in Task 5. Function names `payroll_monthly`, `payroll_by_month`, `load_payroll_by_month`, `month_savings`, `compose_months`, `rollup`, `matched_months`, `load_month_savings` appear identically in Tasks 3, 4, 5 and 8. `Coverage` fields — `balances`, `entered`, `empty`, `missing`, `net_pay`, `net_pay_missing`, `net_pay_without_spending` — plus `classify` and `load_coverage` are used with those names in Tasks 6 and 7; the WIRE spellings differ on purpose (`entered` → `spending`, `empty` → `spending_empty`, `missing` → `spending_missing`) and Task 6's router is the only place that maps them. `DerivedWindowOut(from_month, to_month, months)` (Task 8) serializes as `from`/`to`/`months`, which is what Task 8's test asserts and what the merge notes hand to lane D. `take_home_pending` / `take_home_months_entered` carry the same names on the `MoneyFlow` dataclass, `MoneyFlowOut` and the wire (Task 9). Health check ids `zero_filled_spending`, `spending_gap`, `net_pay_without_spending` match between `run_checks`, both test files and the merge notes.
