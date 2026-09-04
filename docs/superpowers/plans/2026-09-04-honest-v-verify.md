# Honest numbers — Lane V (verify) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close `docs/superpowers/specs/2026-09-04-honest-numbers-design.md` §8's lane V after A, B, C, D and E have merged to LOCAL main: every gate green on both sides, one alembic head upgraded and `alembic check`-clean on the DEV database, and — the point of the lane — a **before/after proof**. A pytest seeds a scratch database with a copy of the production census (12 real spending months Aug 2025–Jul 2026, a September 2026 that is 19 rows of `$0.00` with no net pay, an August 2026 that is simply absent, net pay for exactly 12 of those months, one earner with two paycheck profiles, SWR 4%) and asserts the spec §7 table cell by cell — both columns, computed from the SAME seeded book, so "before" is a reproducible number rather than a remembered one. Then a two-theme browser smoke walks the wizard, Overview, Spending, Projection, the money-flow card and Settings against the dev stack and puts the dev database back exactly as it found it. **OVERNIGHT RULES: nothing is deleted tonight, nothing is pushed, production is never touched (not the database, not the API beyond the read-only census already taken).**

**Architecture:** Read-mostly. Two artifacts are written into the repo and nothing else: `backend/tests/verify/test_honest_before_after.py` (with its `__init__.py`), which is a normal pytest module that runs inside the ordinary suite on the ordinary scratch database, and `tools/probes/honest-v/smoke.mjs`, which follows the house driver pattern established by `tools/probes/sandbox-v/smoke.mjs` (playwright-core out of the npx cache, headless Edge, token + theme seeded with `addInitScript` before first paint, `PATCH /prefs` stubbed so a run never rewrites the account's settings, one named `check()` per assertion into `report.json`, exit 1 listing every problem). Unlike the sandbox driver this one is *allowed* to write — the wizard's per-step save IS the thing under test — so it writes only into a scratch month (`2019-01`) that the dev book has never used, and a `finally` sweep deletes that month from both tables and removes any scratch account it created, straight against the API, so a Playwright timeout halfway through still leaves the database as it was found.

**Tech Stack:** pytest 8 + httpx ASGITransport on `FINANCE_TEST_DB=finance_test_hv`; ruff; alembic against the dev database `postgresql+asyncpg://finance:***@localhost:5433/finance`; vitest 3, TypeScript 5.9, eslint, vite build; playwright-core + the installed Edge; the dev stack (uvicorn `127.0.0.1:8000`, prefix `/api/v1`; vite `http://localhost:5173`).

**Worktree / commands:** **This lane runs on the MAIN checkout, on `main`, AFTER all five lane branches have merged.** No worktree: every file it reads is a file some lane just touched, so an isolated copy would only add a merge. Backend commands run from `backend/`; frontend commands from the repo root. Local commits only — `git push` is never run in this lane.

**Prerequisites:** A merged first (it owns the GET side, `services/savings.py`, coverage, the wire fields and the one migration); B rebased on A and merged; C, D, E branched from post-A main and merged in any order. `git status` clean before Task 1.

**Done when:** Tasks 2–4's gates are green and recorded with their counts; `backend/tests/verify/test_honest_before_after.py` passes with every §7 figure asserted (not printed — asserted); `tools/probes/honest-v/smoke.mjs` prints `HONEST SMOKE OK` with both themes' screenshots in the session scratchpad and a `report.json` whose `problems` is empty and whose sweep reports the scratch month gone; the retire list is written (expected: empty); the "Production expectations" section below is filled in with the numbers the morning should see on the real book; every checkbox in this file is ticked or struck with a reason.

---

## File structure

| File | Responsibility |
|---|---|
| `backend/tests/verify/__init__.py` (new) | Makes the verify package importable by pytest |
| `backend/tests/verify/test_honest_before_after.py` (new) | The census seeder + the spec §7 before/after table as assertions |
| `tools/probes/honest-v/smoke.mjs` (new) | Two-theme browser walk: wizard, Overview, Spending, Projection, money flow, Settings; writes only into a scratch month and undoes it |
| `tools/probes/README.md` (modify) | One table row + one "Running the honest-numbers smoke" recipe |
| `docs/superpowers/plans/2026-09-04-honest-v-verify.md` (this file) | The retire list and the "Production expectations" section, filled in at the end |

Nothing under `src/`, `backend/app/` or `alembic/` is edited by this lane. If a gate fails, the fix belongs to the lane that owns the file (spec §8's hotspot column) and is committed as its own `fix(...)` commit on main with the failing command in the body.

---

### Task 1: Preflight — the merges are in, one head, the pieces exist

**Files:** none (read-only)

- [x] **Step 1: The tree**

Run, from the repo root:

```bash
git status --short && git log --oneline -12
```

Expected: `git status --short` prints NOTHING; the log shows the five lane merges (A, B, C, D, E) on top of `4998f68`. If a lane is missing, STOP — this plan's numbers assume all five.

- [x] **Step 2: The pieces each lane promised**

```bash
ls backend/app/services/savings.py
grep -n "spending_empty\|spending_missing\|net_pay_missing\|latest" backend/app/schemas/coverage.py
grep -n "confirm_zero" backend/app/schemas/spending.py backend/app/api/spending.py
grep -n "kind" backend/app/models/spending.py
grep -n "take_home_pending\|take_home_months_entered" backend/app/schemas/overview.py
grep -n "months_matched\|payroll_savings\|total_savings" backend/app/schemas/spending.py
grep -n "derived" backend/app/schemas/net_worth.py
grep -n "derived_window" backend/app/schemas/projection.py
```

Expected: `savings.py` exists; every grep prints at least one line. A silent grep names the lane that did not land its wire field — record it and stop rather than writing assertions against a field that is not there.

- [x] **Step 3: One alembic head**

Run, from `backend/`:

```bash
.venv/Scripts/python.exe -m alembic heads
```

Expected: exactly ONE line ending `(head)`, and it is lane A's `kind` revision, whose `down_revision` is `d4f6b8c0e2a5` (the head before this program — verify with `grep -rn "down_revision" alembic/versions/ | grep d4f6b8c0e2a5`). Two heads = two lanes wrote a migration; the spec says exactly one does (§1).

---

### Task 2: Backend gates

**Files:** none (read-only)

- [x] **Step 1: The suite on its own scratch database**

Run, from `backend/`:

```bash
FINANCE_TEST_DB=finance_test_hv .venv/Scripts/python.exe -m pytest -q
```

Expected: `N passed` with no failures and no errors; `N` is at least the 1625 that was green on `5c0b467` plus each lane's new cases. Record the exact count. The database name matches conftest's `[a-z0-9_]+_test(_[a-z0-9_]+)?` guard, so the destructive teardown can only ever target `finance_test_hv`.

A failure here is a cross-lane interaction, most likely in `backend/tests/test_spending_api.py` (A owns the GET side of `api/spending.py`, B the PUT) or `backend/tests/test_health_checks.py` (A adds `spending_gap`, B seeds the drift case). Fix it in place keeping BOTH lanes' assertions.

- [x] **Step 2: Lint and format**

```bash
.venv/Scripts/python.exe -m ruff check app tests
.venv/Scripts/python.exe -m ruff format --check app tests
```

Expected: `All checks passed!` and `N files already formatted`.

---

### Task 3: Frontend gates

**Files:** none (read-only)

- [x] **Step 1: Run all four, in order, from the repo root**

```bash
npx tsc -b
npx eslint .
npx vitest run
npm run build
```

Expected: `tsc` and `eslint` silent; `vitest` prints `Test Files N passed` / `Tests M passed` with M at least the 2272 green on `5c0b467` plus the lanes' new cases — record both numbers; `build` completes and prints the chunk table.

Note for the build: `npm run build` is `tsc -b && vite build`. If it OOMs the way the Docker image build did on `4998f68`, run `NODE_OPTIONS=--max-old-space-size=1024 npx vite build` and record the deviation — it is a V8 heap cap on this box, not a defect in the lanes.

---

### Task 4: The dev database — upgrade, then `alembic check`

**Files:** none (read-only)

**PRODUCTION IS NEVER TOUCHED BY THIS TASK.** `alembic` reads `backend/.env`'s `DATABASE_URL`, which on this box is `postgresql+asyncpg://finance:finance@localhost:5433/finance` — the local dev database in Docker. No step in this plan ssh-es anywhere or points alembic at `170.9.51.78`.

- [x] **Step 1: Prove which database is about to be migrated**

Run, from `backend/`:

```bash
.venv/Scripts/python.exe -c "from app.config import settings; from sqlalchemy.engine import make_url; u = make_url(settings.database_url); print(u.host, u.port, u.database)"
```

Expected, VERBATIM: `localhost 5433 finance`. Anything else — a remote host, a port that is not 5433, a database that is not `finance` — is a STOP: do not run Step 2, report it, and end the lane's DB work here.

- [x] **Step 2: Upgrade and check** — the dev database was ALREADY at `e5a7c1d3f6b8` when this lane started, so the upgrade became a verification: `alembic current` printed `e5a7c1d3f6b8 (head)` and `alembic check` printed `No new upgrade operations detected.`

```bash
.venv/Scripts/python.exe -m alembic upgrade head
.venv/Scripts/python.exe -m alembic check
```

Expected: the upgrade prints `Running upgrade d4f6b8c0e2a5 -> <kind revision>`; `alembic check` prints `No new upgrade operations detected.` A non-empty check output means a model column has no migration behind it (the usual cause is a `server_default` present on the model and absent from the revision — `hsa_coverage`'s precedent); that is lane A's bug, fixed as its own commit.

- [x] **Step 3: The kind seeding actually ran on real category names**

```bash
docker exec -i $(docker ps --filter name=postgres --format '{{.Names}}' | head -1) \
  psql -U finance -d finance -c "SELECT kind, count(*), string_agg(name, ', ' ORDER BY name) FROM spending_categories GROUP BY kind ORDER BY kind;"
```

Expected: a `tax` row containing `Taxes`, a `living` row with the rest, and a `transfer` row only if the dev book has an `Investments`/`Financial` category. Every category has a kind (no NULLs — the column is NOT NULL). Record the table; it is the "before" state the morning's production upgrade will reproduce.

---

### Task 5: The census fixture (TDD — the seeder is the code this lane writes)

**Files:**
- Create: `backend/tests/verify/__init__.py`, `backend/tests/verify/test_honest_before_after.py`

The seeder is real code, so it gets real TDD: an integrity test that fails against an empty seeder, then the seeder, then green. Only after the fixture is proven to BE the census do the §7 assertions go in (Task 6).

- [x] **Step 1: RED — the integrity test, with the seeder stubbed out**

```bash
mkdir -p backend/tests/verify && printf '' > backend/tests/verify/__init__.py
```

Create `backend/tests/verify/test_honest_before_after.py` with the constants and the integrity test, and a `seed_census` that does nothing yet:

```python
"""The honest-numbers before/after proof (2026-09-04 spec §7), on a LOCAL copy of the
production census taken read-only on 2026-09-04.

These are the real household's figures, seeded into the disposable test database — never
read from production at test time and never written back to it. The dates are ABSOLUTE on
purpose: this file's job is to reproduce one specific production shape (a zero September, a
missing August, twelve real months behind them), and a relative fixture would drift off the
very shape it exists to pin. Only two figures are clock-coupled — the projection's
`start_month` and `base_month` — and they are RECORDED, never asserted.
"""

from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import func, select

from app.models import (
    Account,
    AccountBalance,
    MonthlyCashflow,
    MonthlySpending,
    NetWorthSnapshot,
    PaycheckProfile,
    Person,
    SpendingCategory,
    TaxBracket,
    TaxInput,
    TaxYear,
)
from app.seed import seed_tax_definitions

COVERAGE = "/api/v1/coverage"
MATRIX = "/api/v1/spending/matrix"
YEARLY = "/api/v1/spending/yearly"
PROJECTION = "/api/v1/projection"
MONEY_FLOW = "/api/v1/overview/money-flow"

# --- the census (production, 2026-09-04, read-only) --------------------------------------

# Twelve REAL spending months. Aug 2026 is deliberately absent from this dict (production has
# no rows for it); Sep 2026 is seeded separately as 19 zero rows.
SPENDING_TOTALS = {
    date(2025, 8, 1): Decimal("4274.63"),
    date(2025, 9, 1): Decimal("5993.18"),
    date(2025, 10, 1): Decimal("3924.80"),
    date(2025, 11, 1): Decimal("5373.86"),
    date(2025, 12, 1): Decimal("4878.72"),
    date(2026, 1, 1): Decimal("7206.82"),
    date(2026, 2, 1): Decimal("4592.97"),
    date(2026, 3, 1): Decimal("5190.43"),
    date(2026, 4, 1): Decimal("9802.63"),
    date(2026, 5, 1): Decimal("8850.75"),
    date(2026, 6, 1): Decimal("4873.01"),
    date(2026, 7, 1): Decimal("5091.97"),
}
# The one non-living row in the whole book: April's income-tax payment.
APRIL = date(2026, 4, 1)
APRIL_TAX = Decimal("5044.00")
EMPTY_MONTH = date(2026, 9, 1)     # 19 rows of $0.00, no net pay — a balances-only save
MISSING_MONTH = date(2026, 8, 1)   # no rows at all, inside the balances window

NET_PAY = {
    date(2025, 8, 1): Decimal("5427.86"),
    date(2025, 9, 1): Decimal("7806.70"),
    date(2025, 10, 1): Decimal("6284.60"),
    date(2025, 11, 1): Decimal("6132.98"),
    date(2025, 12, 1): Decimal("7264.46"),
    date(2026, 1, 1): Decimal("5251.59"),
    date(2026, 2, 1): Decimal("5476.20"),
    date(2026, 3, 1): Decimal("6765.03"),
    date(2026, 4, 1): Decimal("6609.08"),
    date(2026, 5, 1): Decimal("6609.08"),
    date(2026, 6, 1): Decimal("7291.53"),
    date(2026, 7, 1): Decimal("6609.09"),
}

# 19 categories, because the empty September is 19 rows of $0.00. Exactly one is "Taxes"
# (the migration seeds it `tax` by name, case-insensitive); none is named Investments or
# Financial, so the book carries NO transfer money and `transfer_total` must be 0.00
# everywhere — which is what makes cash_savings == net_pay − total_spend checkable by eye.
LIVING_NAMES = [
    "Housing", "Groceries", "Dining", "Transport", "Utilities", "Insurance",
    "Health", "Childcare", "Travel", "Shopping", "Subscriptions", "Gifts",
    "Education", "Pets", "Home", "Personal", "Fees", "Misc",
]
TAX_NAME = "Taxes"

# The balances window (spec §3: "first snapshot month … latest snapshot month"). Fourteen
# months, so Aug 2026 is INSIDE the window with no rows = missing, and Sep 2026 is inside
# it with zero rows = empty.
WINDOW = (
    [date(2025, 8, 1)]
    + [date(2025, m, 1) for m in range(9, 13)]
    + [date(2026, m, 1) for m in range(1, 10)]
)

SALARY = Decimal("188930.00")
SWR = Decimal("0.04")
SINGLE_BRACKETS = (
    ("federal", [("0.1000", "0.00")]),
    ("state", [("0.0500", "0.00")]),
    ("medicare", [("0.0145", "0.00"), ("0.0235", "250000.00")]),
    ("social_security", [("0.0620", "0.00"), ("0.0000", "168600.00")]),
    ("disability", [("0.0110", "0.00")]),
    ("capital_gains", [("0.1500", "0.00")]),
)


async def seed_census(db) -> dict:
    """Seed the production shape. Returns {'categories': {...}, 'person': id}."""
    return {}


@pytest.fixture
async def census(db):
    return await seed_census(db)


async def test_the_fixture_is_the_census(census, db):
    """The seeder reproduces the production shape EXACTLY — asserted before anything is
    computed from it, so a later figure can never be wrong because the book was."""
    total = (await db.execute(select(func.sum(MonthlySpending.amount)))).scalar_one()
    assert Decimal(total) == Decimal("70053.77")           # the 12 real months, taxes in
    months = (
        await db.execute(
            select(MonthlySpending.month).distinct().order_by(MonthlySpending.month)
        )
    ).scalars().all()
    assert list(months) == sorted(SPENDING_TOTALS) + [EMPTY_MONTH]
    assert MISSING_MONTH not in months
    empty_rows = (
        await db.execute(
            select(func.count(), func.sum(MonthlySpending.amount)).where(
                MonthlySpending.month == EMPTY_MONTH
            )
        )
    ).one()
    assert empty_rows == (19, Decimal("0.00"))
    pay = (await db.execute(select(func.sum(MonthlyCashflow.net_pay)))).scalar_one()
    assert Decimal(pay) == Decimal("77528.20")        # 32,916.60 in 2025 + 44,611.60 in 2026
    assert (await db.execute(select(func.count(MonthlyCashflow.month)))).scalar_one() == 12
    snaps = (
        await db.execute(select(NetWorthSnapshot.month).order_by(NetWorthSnapshot.month))
    ).scalars().all()
    assert list(snaps) == WINDOW
    profiles = (
        await db.execute(select(PaycheckProfile).order_by(PaycheckProfile.effective_date))
    ).scalars().all()
    assert [p.effective_date for p in profiles] == [date(2026, 1, 1), date(2026, 8, 17)]
    assert [p.espp_pct for p in profiles] == [Decimal("0.11"), Decimal("0.12")]
```

Run, from `backend/`:

```bash
FINANCE_TEST_DB=finance_test_hv .venv/Scripts/python.exe -m pytest tests/verify/test_honest_before_after.py -q
```

Expected: **FAILS** — a `TypeError`/`InvalidOperation` on `Decimal(None)` from the empty sum, because `seed_census` seeds nothing. That failure is the RED step; record its first line.

- [x] **Step 2: GREEN — write the seeder**

Replace `seed_census`'s body:

```python
async def seed_census(db) -> dict:
    # Categories. The living total of a month goes entirely into Housing: the arithmetic
    # under test is per-KIND, never per-category, and one row per month keeps every figure
    # exact to the cent instead of introducing a split-rounding of our own. The other
    # seventeen exist because September's emptiness is 19 rows wide.
    categories = {}
    for order, name in enumerate([TAX_NAME] + LIVING_NAMES, start=1):
        row = SpendingCategory(name=name, slug=name.lower(), sort_order=order)
        db.add(row)
        categories[name] = row
    await db.flush()

    for month, total in SPENDING_TOTALS.items():
        living = total - APRIL_TAX if month == APRIL else total
        db.add(
            MonthlySpending(month=month, category_id=categories["Housing"].id, amount=living)
        )
    db.add(MonthlySpending(month=APRIL, category_id=categories[TAX_NAME].id, amount=APRIL_TAX))
    # September 2026: the balances-only save that started this whole program.
    for row in categories.values():
        db.add(MonthlySpending(month=EMPTY_MONTH, category_id=row.id, amount=Decimal("0.00")))
    for month, net_pay in NET_PAY.items():
        db.add(MonthlyCashflow(month=month, net_pay=net_pay))

    # Balances: one taxable account across the whole window, flat. The window is what makes
    # Aug 2026 "missing" rather than "not yet"; the balance itself only feeds the
    # projection's starting point, which this file records rather than asserts.
    account = Account(name="Brokerage", slug="brokerage", group="taxable", sort_order=1)
    db.add(account)
    await db.flush()
    for month in WINDOW:
        snapshot = NetWorthSnapshot(month=month)
        db.add(snapshot)
        await db.flush()
        db.add(
            AccountBalance(
                snapshot_id=snapshot.id,
                account_id=account.id,
                balance=Decimal("500000.00"),
            )
        )

    person = Person(name="Earner", is_primary=True)
    db.add(person)
    await db.flush()
    common = dict(
        annual_salary=SALARY,
        pay_periods_per_year=24,
        trad_401k_pct=Decimal("0.13"),
        roth_401k_pct=Decimal("0"),
        after_tax_401k_pct=Decimal("0.03"),
        withholding_pct=Decimal("0.22"),
        dental_vision_per_check=Decimal("0"),
        hsa_per_check=Decimal("100.00"),
        hsa_coverage="self",
    )
    db.add(
        PaycheckProfile(
            person_id=person.id,
            effective_date=date(2026, 1, 1),
            espp_pct=Decimal("0.11"),
            **common,
        )
    )
    # Effective MID-month: by the 1st-of-month rule (spec §6) it governs Sep 2026 onward,
    # so it must NOT move any 2026 rollup figure — which is exactly what Task 6 asserts.
    db.add(
        PaycheckProfile(
            person_id=person.id,
            effective_date=date(2026, 8, 17),
            espp_pct=Decimal("0.12"),
            **common,
        )
    )

    # A minimal single-filer 2026 so the money-flow card has a gross to reconcile against.
    await seed_tax_definitions(db)
    db.add(TaxYear(year=2026, filing_status="single"))
    await db.flush()
    db.add_all(
        [
            TaxInput(year=2026, key="latest_w2_income", value=SALARY, person_id=person.id),
            TaxInput(
                year=2026,
                key="trad_401k_contributions",
                value=Decimal("24560.90"),
                person_id=person.id,
            ),
        ]
    )
    for name, table in SINGLE_BRACKETS:
        for index, (rate, threshold) in enumerate(table, start=1):
            db.add(
                TaxBracket(
                    year=2026,
                    jurisdiction=name,
                    bracket_index=index,
                    rate=Decimal(rate),
                    threshold=Decimal(threshold),
                    filing_status="single",
                )
            )
    await db.commit()
    return {"categories": {n: r.id for n, r in categories.items()}, "person": person.id}
```

Run the same command.
Expected: **1 passed**. If `test_the_fixture_is_the_census` still fails, the failure names which census fact is wrong — fix the seeder, never the assertion.

**One conditional, resolved by grep before writing it.** The test database's schema comes from `Base.metadata.create_all`, which applies a model default but runs NO migration — so lane A's by-name kind seeding (`taxes` → `tax`) does not happen here. Run `grep -n "kind" backend/app/models/spending.py`; if `SpendingCategory` carries the column, add immediately after the categories' `await db.flush()`:

```python
    # create_all never runs a migration, so the by-name seeding of spec §1 does not fire on
    # the test database. Set the one non-living kind explicitly; every other row takes the
    # column's 'living' default, exactly as production will after the upgrade.
    categories[TAX_NAME].kind = "tax"
    await db.flush()
```

Record which branch was taken.

- [x] **Step 3: Commit**

```bash
git add backend/tests/verify/__init__.py backend/tests/verify/test_honest_before_after.py
git commit -m "test(verify): seed a local copy of the production census — 12 real months, an empty September, a missing August"
```

---

### Task 6: The before/after proof — spec §7's table, cell by cell

**Files:**
- Modify: `backend/tests/verify/test_honest_before_after.py`

Every figure below is derived from the census in Task 5 and nothing else. The BEFORE column is computed in the test from the seeded rows by the pre-program rules (the old code is gone; the arithmetic is not), so the table is a proof and not a memory.

**The arithmetic, once, so every assertion below is checkable by hand:**

| Quantity | Derivation | Value |
|---|---|---|
| 12 real months, total | Σ `SPENDING_TOTALS` | `70053.77` |
| … of which tax | April's `Taxes` row | `5044.00` |
| … living | 70053.77 − 5044.00 | `65009.77` |
| BEFORE annual spend | mean of the LAST 12 months WITH ROWS (Sep 2025 … Sep 2026 — drops Aug 2025, includes the `$0` September) × 12 | `65779.14` |
| BEFORE FI target | 65779.14 ÷ 0.04 | `1644478.50` |
| AFTER annual spend | living over the MATCHED window (entered AND net pay) = Aug 2025 … Jul 2026, 12 months | `65009.77` |
| AFTER FI target | 65009.77 ÷ 0.04 | `1625244.25` |
| 2026 spend Jan–Jul | Σ | `45608.58` |
| 2026 living | 45608.58 − 5044.00 | `40564.58` |
| 2026 net pay Jan–Jul | Σ | `44611.60` |
| cash savings 2026 | 44611.60 − 40564.58 − 5044.00 | `-996.98` |
| cash rate 2026 | −996.98 ÷ 44611.60 | `-0.022348` (−2.2%) — **corrected 2026-09-04**: this row said `-0.022347`, a truncation; −0.0223479991… at six places HALF_UP is `-0.022348`, which is what the wire emits |
| payroll monthly | (188930 ÷ 24) × (0.13 + 0 + 0.03 + 0.11) + 100 = 2225.4625 per check, × 24 ÷ 12 = 4450.925, emitted at cents HALF_UP | `4450.93` per month |
| payroll savings 2026 | 4450.93 × 7 matched months (Σ of the emitted months) | `31156.51` |
| total savings 2026 | 31156.51 + (−996.98) | `30159.53` |
| total rate 2026 | 30159.53 ÷ (44611.60 + 31156.51 = 75768.11) | `0.398050` (39.8%) |
| take-home pending 2026 | (44611.60 ÷ 7) × (12 − 7), quantized ONCE at the end | `31865.43` |

> **The rounding rule (spec §2/§7, decided 2026-09-04).** **Per-month wire figures are quantized to cents ROUND_HALF_UP when emitted (`half_up2`, the house rule `api/projection.py` already applies); yearly and trailing SCALARS are the SUM of those emitted months.** So `payroll_monthly` here is exactly `4450.925` — a half-cent — and it reaches the wire as `4450.93`, seven of which make the 2026 payroll total `31,156.51`, total savings `30,159.53` and the rate denominator `75,768.11`.
>
> The invariant that makes this checkable, and the one to assert if a figure ever disagrees: **the `YearRollup` scalar equals Σ of the `MatrixOut` months it covers.** The Spending page prints both, and a rollup that disagrees with its own columns is the exact dishonesty this program exists to remove.
>
> **The one exception is a MEAN, which quantizes once at the end.** The spec's §3 prose reads "$6,373.09 × 5 = $31,865.43" — but 6373.09 × 5 is 31,865.45. The correct figure comes from the UNROUNDED mean (44611.60 ÷ 7 = 6373.085714…) times 5, quantized once: `31,865.43`. If the assertion observes `31865.45`, `services/money_flow.py` is rounding the mean before multiplying. That is the defect, not the test.

- [x] **Step 1: The BEFORE column**

Append:

```python
async def test_before_the_program_the_zero_month_and_the_tax_bill_are_counted(census, db):
    """The BEFORE column of spec §7, recomputed from this very book by the pre-program
    rules: trailing TWELVE MONTHS WITH ROWS (which reaches back only to Sep 2025 because
    the empty September occupies a slot), taxes counted as living, one figure for April."""
    per_month = (
        await db.execute(
            select(MonthlySpending.month, func.sum(MonthlySpending.amount))
            .group_by(MonthlySpending.month)
            .order_by(MonthlySpending.month.desc())
            .limit(12)
        )
    ).all()
    trailing = [Decimal(total) for _, total in per_month]
    assert len(trailing) == 12
    assert min(month for month, _ in per_month) == date(2025, 9, 1)   # Aug 2025 fell off
    assert EMPTY_MONTH in {month for month, _ in per_month}           # the $0 month is IN
    annual_before = sum(trailing, Decimal("0")) / 12 * 12
    assert annual_before == Decimal("65779.14")
    assert (annual_before / SWR).quantize(Decimal("0.01")) == Decimal("1644478.50")

    april = (
        await db.execute(
            select(func.sum(MonthlySpending.amount)).where(MonthlySpending.month == APRIL)
        )
    ).scalar_one()
    assert Decimal(april) == Decimal("9802.63")   # one number, the tax invisible inside it
```

- [x] **Step 2: The AFTER column — coverage**

```python
async def test_after_coverage_tells_the_truth_about_august_and_september(census, auth_client):
    body = (await auth_client.get(COVERAGE)).json()
    assert body["spending"] == [m.isoformat() for m in sorted(SPENDING_TOTALS)]
    assert body["spending_empty"] == ["2026-09-01"]
    assert body["spending_missing"] == ["2026-08-01"]
    assert body["net_pay_missing"] == ["2026-08-01", "2026-09-01"]
    assert body["latest"] == {
        "balances": "2026-09-01",
        "spending": "2026-07-01",
        "net_pay": "2026-07-01",
    }
    assert body["balances"][0] == "2025-08-01" and body["balances"][-1] == "2026-09-01"
```

- [x] **Step 3: The AFTER column — the matrix's per-kind arrays and April**

```python
async def test_after_april_splits_into_living_and_tax(census, auth_client):
    body = (await auth_client.get(MATRIX)).json()
    at = body["months"].index("2026-04-01")
    assert body["living_total"][at] == "4758.63"
    assert body["tax_total"][at] == "5044.00"
    assert body["transfer_total"][at] == "0.00"
    assert body["totals"][at] == "9802.63"          # unchanged: the total is still the total
    empty = body["months"].index("2026-09-01")
    assert body["living_total"][empty] == "0.00"
    assert body["net_pay"][empty] is None
    assert body["cash_savings"][empty] is None      # no net pay => no savings figure at all
    assert body["payroll_savings"][empty] is None   # spec §2: nobody entered pay, no deductions
    jan = body["months"].index("2026-01-01")
    assert body["payroll_savings"][jan] == "4450.93"   # 4450.925 emitted at cents HALF_UP
    assert body["cash_savings"][jan] == "-1955.23"  # 5251.59 - 7206.82
    aug25 = body["months"].index("2025-08-01")
    assert body["payroll_savings"][aug25] == "0.00"  # no profile in force before 2026-01-01
```

(`-1955.23` = 5251.59 − 7206.82, by the spec §2 formula `net_pay − living_spend − tax_paid`; a month that outspent its pay is negative. If lane A signed it the other way, that is a defect against §2, not a literal to flip.)

- [x] **Step 4: The AFTER column — the 2026 yearly rollup**

```python
async def test_after_2026_rollup_counts_payroll_and_matches_only_seven_months(census, auth_client):
    body = (await auth_client.get(YEARLY)).json()
    year = next(y for y in body["years"] if y["year"] == 2026)
    assert year["months_matched"] == 7            # Aug missing, Sep empty, Oct-Dec unlived
    assert year["net_pay_total"] == "44611.60"
    assert year["living_total"] == "40564.58"
    assert year["tax_total"] == "5044.00"
    assert year["transfer_total"] == "0.00"
    assert year["cash_savings"] == "-996.98"
    assert year["savings_rate"] == "-0.022348"    # corrected: HALF_UP, not truncated
    assert year["payroll_savings"] == "31156.51"  # Σ of the emitted months: 4450.93 x 7
    assert year["total_savings"] == "30159.53"
    assert year["total_savings_rate"] == "0.398050"  # 30159.53 / 75768.11
    # The 2026-08-17 profile is in force for NO matched month (1st-of-month rule, spec §6),
    # and the scalar is the SUM of the emitted months, never a re-rounded raw total.
    assert Decimal(year["payroll_savings"]) / 7 == Decimal("4450.93")


async def test_after_the_rollup_scalars_equal_the_sum_of_the_months_they_cover(
    census, auth_client
):
    """The deciding invariant of the rounding rule (spec §2/§7): a yearly scalar IS the sum
    of the emitted per-month figures. The Spending page prints both, so a rollup that
    disagrees with its own columns would be the very dishonesty this program removes."""
    matrix = (await auth_client.get(MATRIX)).json()
    year = next(
        y for y in (await auth_client.get(YEARLY)).json()["years"] if y["year"] == 2026
    )
    # MATCHED months only (spec §2: "its totals and both rates are computed over matched
    # months only") — a month is matched when it has spend rows AND net pay, so the empty
    # September (net_pay None) drops out and August, having no column at all, never appears.
    rows = [
        i
        for i, m in enumerate(matrix["months"])
        if m.startswith("2026-") and matrix["net_pay"][i] is not None
    ]
    assert len(rows) == year["months_matched"] == 7
    for field in (
        "living_total",
        "tax_total",
        "transfer_total",
        "cash_savings",
        "payroll_savings",
        "total_savings",
    ):
        months = [Decimal(matrix[field][i]) for i in rows]
        assert sum(months, Decimal("0")) == Decimal(year[field]), field
```

- [x] **Step 5: The AFTER column — the projection's window and FI target**

```python
async def test_after_the_fi_target_is_built_from_living_spend_over_the_matched_window(
    census, auth_client
):
    body = (await auth_client.get(PROJECTION)).json()
    assert Decimal(body["swr_pct"]) == SWR
    assert body["annual_spend"] == "65009.77"
    assert body["fi_target"] == "1625244.25"
    assert body["derived_window"] == {"from": "2025-08-01", "to": "2026-07-01", "months": 12}
    breakdown = body["contribution_breakdown"]
    assert breakdown is not None
    assert Decimal(breakdown["total"]) == Decimal(breakdown["cash"]) + Decimal(
        breakdown["payroll"]
    )
    # Clock-coupled, RECORDED not asserted (see the module docstring).
    print("projection start_month", body["start_month"], "base_month", body["base_month"])
```

- [x] **Step 6: The AFTER column — the money-flow pending node**

```python
async def test_after_money_flow_names_the_five_months_nobody_has_entered(census, auth_client):
    body = (await auth_client.get(f"{MONEY_FLOW}?year=2026")).json()
    assert body["take_home_months_entered"] == 7
    assert body["take_home_pending"] == "31865.43"     # (44611.60/7) x 5, quantized ONCE
    assert body["take_home_cash"] == "44611.60"
    # Conservation, so the new node is PROVED to come out of the residual rather than be
    # added on top of it (spec §3: "retained_equity subtracts it").
    residual = (
        Decimal(body["gross_income"])
        - Decimal(body["taxes"]["total"])
        - Decimal(body["pre_tax_savings"])
        - Decimal(body["take_home_cash"])
        - Decimal(body["take_home_pending"])
    )
    assert Decimal(body["retained_equity"]) == residual
    assert body["renderable"] is True, body["reason"]
```

- [x] **Step 7: Run the whole module and record every number**

```bash
FINANCE_TEST_DB=finance_test_hv .venv/Scripts/python.exe -m pytest tests/verify -q -s
```

Expected: **8 passed** and the two printed clock-coupled dates. Any failure is a real finding: copy the assertion, the observed value and the derivation row it contradicts into the report — a verify lane's failures are its output, not its embarrassment.

- [x] **Step 8: The module runs inside the ordinary suite too**

```bash
FINANCE_TEST_DB=finance_test_hv .venv/Scripts/python.exe -m pytest -q
```

Expected: the Task 2 count **+ 8**. If pytest does not collect `tests/verify/`, its `testpaths`/`norecursedirs` needs the directory — check with `grep -n "testpaths\|norecursedirs\|\[tool.pytest" backend/pyproject.toml` and fix it there rather than renaming the folder.

- [x] **Step 9: Commit**

```bash
git add backend/tests/verify/test_honest_before_after.py
git commit -m "test(verify): the honest-numbers before/after table — FI target, 2026 savings, April's split, coverage, the pending take-home node"
```

---

### Task 7: The browser smoke driver

**Files:**
- Create: `tools/probes/honest-v/smoke.mjs`
- Modify: `tools/probes/README.md`

House pattern: `tools/probes/sandbox-v/smoke.mjs`. Copy its header block, its playwright-core resolution (including the node-version spoof — this box runs node 18 and playwright-core refuses under 20), its `addInitScript` token/theme seeding, its `PATCH /prefs` stub, its `check()`/`note()`/`problem()` reporting and its exit shape verbatim. What differs, and why:

- **This walk WRITES.** The wizard's per-step save is the feature under test, so there is no write fence. Instead every mutating request is RECORDED into `report.writes`, the walk only ever targets the scratch month `2019-01-01`, and a `finally` sweep deletes that month from both tables and removes any account it created. `PATCH /prefs` stays stubbed — a smoke does not get to rewrite the account's theme.
- **Selectors are the SPEC's own copy**, not invented test ids: "Record this month as $0", "This month was saved with no spending.", "derived", "Total (incl. payroll)", "Cash", "Take-home not yet entered". If a string does not match, lane C/D/E shipped different words than the spec approved — that is a finding, recorded with the observed text, not a selector to loosen.

- [x] **Step 1: Confirm the strings the driver will hunt for actually shipped**

```bash
grep -rn "Record this month as" src/
grep -rn "truly spent nothing" src/
grep -rn "saved with no spending" src/
grep -rn "delete the empty month" src/
grep -rn "Total (incl. payroll)" src/
grep -rn "Take-home not yet entered" src/
grep -rn "derived" src/pages/MonthlyUpdatePage.tsx src/components/settings/AccountsCard.tsx
grep -rn "Living\|Transfer" src/components/settings/CategoriesPanel.tsx
grep -n "Save balances\|Save spending\|Save month" src/pages/MonthlyUpdatePage.tsx
```

Expected: each grep hits. Record any miss with the file that should have carried it — the driver still gets written, and that check fails loudly rather than being dropped. The last grep decides which button names the driver clicks (see Step 2's note 1).

**OBSERVED.** Every spec string shipped, in these files: "Record this month as $0" and "…you truly spent nothing." (`MonthlyUpdatePage.tsx:1595`), "This month was saved with no spending. Enter it below, or delete the empty month." (`:1182`), `Total (incl. payroll)` (`spendingChartOptions.ts:335` as `TOTAL_RATE_SERIES`), "Take-home not yet entered (N months)" (`moneyFlowOptions.ts`), `entry-derived` + the `derived` badge (`MonthlyUpdatePage.tsx:1306,1319`). **Two misses, both resolved rather than dropped:**

- `src/components/settings/CategoriesPanel.tsx` **does not exist** — lane E shipped the kind picker in `CategoriesCard.tsx` (`Segmented` with Living/Tax/Transfer at `:205`, the "recomputes ALL history" note at `:286`). The spec §8 table named a file nobody created; the driver targets the real one.
- **No `Save balances` / `Save spending` pair.** `grep -n "Save balances\|Save spending\|Save month"` hits only `Save month` (`:1721`, with `Retry spending` as its other face at `:1720`). Lane C put the decoupling INSIDE `save()` and states it on the review step ("Spending: nothing entered — this save writes balances only.", `:1667`), which is what §4 asked for. Step 2's note 1 applies: the driver walks `Next: spending` → `Next: review` → `Save month` and keeps the network assertion verbatim.

**Step 2's note 2, resolved:** the dev book already holds two parents with components (`Fidelity Traditional 401(k)` #40 over three, `Fidelity Roth 401(k)` #45 over two), so the derived branch walked for free and no scratch account was created — `report.createdAccounts` is empty in both themes.

- [x] **Step 2: Write the driver**

```js
// tools/probes/honest-v/smoke.mjs — the honest-numbers browser smoke (lane V Task 7,
// 2026-09-04 honest-numbers spec §7 "Verify lane"). How to run it: tools/probes/README.md.
//
// What it proves against the REAL app that jsdom cannot:
//   1. The wizard's steps are DECOUPLED. Saving a balances step you touched must fire
//      exactly one PUT /net-worth/months/{m} and ZERO PUT /spending/months/{m}. That is a
//      claim about the network, so only a browser can make it.
//   2. The $0 door is a door. The checkbox is unchecked by default, the save it enables
//      carries confirm_zero:true, and revisiting the month it wrote shows the repair banner.
//   3. A parent with components is READ-ONLY in the wizard and shows the live sum.
//   4. The words on Overview, Spending, Projection, the money-flow card and Settings are the
//      spec's words, in BOTH themes, with no console error.
//
// IT WRITES, unlike the sandbox smoke — the wizard's save IS the subject. Every write goes
// to the scratch month 2019-01, which the dev book has never used, and the finally-sweep
// deletes it from both tables (plus any account this run created) straight against the API.
// PATCH /prefs is still stubbed: a smoke does not rewrite the account's settings.
//
// Needs the dev stack (uvicorn 127.0.0.1:8000 WITHOUT --reload — restart it after the backend
// lanes merged, the 2026-09-04 trap in tools/probes/README.md — and vite on APP_BASE) and a
// JWT in TOKEN_FILE minted with POST /api/v1/auth/login using the DEV seed credentials.
//
// Env: SMOKE_OUT, TOKEN_FILE, APP_BASE, API_BASE, EDGE_PATH, PLAYWRIGHT_CORE, ONLY_THEME,
// ONLY_STEP (wizard|overview|spending|projection|moneyflow|settings), SCRATCH_MONTH.
//
// The first two lines spoof the node version: this box runs node 18, playwright-core wants 20.
Object.defineProperty(process, 'version', { value: 'v20.19.0' })
Object.defineProperty(process.versions, 'node', { value: '20.19.0' })
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const { chromium } = require(
  process.env.PLAYWRIGHT_CORE ??
    'C:/Users/edyli/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core',
)

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../../..')
const out = process.env.SMOKE_OUT ?? path.join(repo, 'scratchpad', 'honest-smoke')
mkdirSync(out, { recursive: true })
const TOKEN = readFileSync(process.env.TOKEN_FILE ?? path.join(out, 'token.txt'), 'utf8').trim()
const BASE = process.env.APP_BASE ?? 'http://localhost:5173'
const API = process.env.API_BASE ?? 'http://127.0.0.1:8000'
const EDGE =
  process.env.EDGE_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const SCRATCH = process.env.SCRATCH_MONTH ?? '2019-01-01'
const VIEWPORT = { width: 1600, height: 1100 }
const SETTLE = 1400 // 450ms entrance + a refetch beat
const THEMES = ['dark', 'light'].filter(
  (t) => !process.env.ONLY_THEME || t === process.env.ONLY_THEME,
)
const STEPS = ['wizard', 'overview', 'spending', 'projection', 'moneyflow', 'settings'].filter(
  (s) => !process.env.ONLY_STEP || s === process.env.ONLY_STEP,
)
const NOISE =
  /favicon|DevTools|\[vite\]|@vite\/client|Download the React DevTools|React Router Future Flag/i

const report = {
  generatedAt: new Date().toISOString(),
  base: BASE,
  scratchMonth: SCRATCH,
  themes: THEMES,
  steps: STEPS,
  checks: [],
  writes: [],
  prefsWrites: [],
  createdAccounts: [],
  sweep: [],
  problems: [],
}
const problem = (m) => report.problems.push(m)
const check = (theme, step, name, ok, observed) => {
  report.checks.push({ theme, step, name, ok, observed })
  if (!ok) problem(`${theme} ${step}: ${name} — observed ${JSON.stringify(observed)}`)
  return ok
}
const note = (theme, step, name, observed) =>
  report.checks.push({ theme, step, name, ok: null, observed })
const files = []
const api = (route, init = {}) =>
  fetch(`${API}/api/v1${route}`, {
    ...init,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  })

const browser = await chromium.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--force-device-scale-factor=1'],
})

try {
  for (const theme of THEMES) {
    const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 })
    await ctx.addInitScript(
      ([token, th]) => {
        localStorage.setItem('finance_token', token)
        localStorage.setItem('finance.theme', th)
        localStorage.setItem('finance.chartDecals', 'off')
      },
      [TOKEN, theme],
    )
    const where = { theme, step: 'boot' }
    const themeEntry = { value: theme, updated_at: new Date().toISOString() }
    await ctx.route('**/api/v1/prefs*', async (route) => {
      const request = route.request()
      if (request.method() === 'GET') {
        let body = { prefs: {} }
        try {
          body = await (await route.fetch()).json()
        } catch (e) {
          problem(`${theme} ${where.step}: GET /prefs unreadable (${e.message})`)
        }
        body.prefs = { ...body.prefs, theme: themeEntry }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(body),
        })
      }
      report.prefsWrites.push({ ...where, method: request.method() })
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ prefs: { theme: themeEntry } }),
      })
    })

    const page = await ctx.newPage()
    const errors = []
    page.on('console', (m) => {
      if (m.type() === 'error' && !NOISE.test(m.text())) errors.push(m.text())
    })
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
    page.on('request', (r) => {
      const m = r.method()
      if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return
      report.writes.push({
        ...where,
        method: m,
        url: r.url(),
        body: (r.postData() || '').slice(0, 300),
      })
    })
    const drain = (step) => {
      if (errors.length) {
        problem(`${theme} ${step}: console — ${errors.join(' | ')}`)
        errors.length = 0
      }
    }
    const shot = async (name) => {
      const file = path.join(out, `${theme}-${name}.png`)
      await page.screenshot({ path: file, fullPage: true })
      files.push(path.basename(file))
    }
    const go = async (url) => {
      await page.goto(BASE + url, { waitUntil: 'networkidle' })
      await page.waitForTimeout(SETTLE)
    }

    // --- wizard ---------------------------------------------------------------------
    if (STEPS.includes('wizard')) {
      where.step = 'wizard'
      const before = report.writes.length
      await go(`/update?month=${SCRATCH}`)

      // (1) The balances step alone: type one balance, save THAT step.
      await page.locator('input[data-entry-cell]').first().fill('1234.56')
      await page.getByRole('button', { name: /^Save balances/i }).click()
      await page.waitForTimeout(SETTLE)
      const fresh = report.writes.slice(before)
      check(
        theme,
        'wizard',
        'the balances step writes balances only — no spending PUT',
        fresh.filter((w) => /net-worth\/months/.test(w.url)).length === 1 &&
          fresh.filter((w) => /spending\/months/.test(w.url)).length === 0,
        fresh.map((w) => `${w.method} ${new URL(w.url).pathname}`),
      )
      await shot('wizard-balances-saved')

      // (2) A derived parent row is read-only and shows the live sum.
      const derived = page.locator('.entry-derived').first()
      if (await derived.count()) {
        check(
          theme,
          'wizard',
          'a derived parent row has no editable input',
          (await derived.locator('input').count()) === 0,
          await derived.innerText(),
        )
        check(
          theme,
          'wizard',
          'the derived row is badged "derived"',
          /derived/i.test(await derived.innerText()),
          await derived.innerText(),
        )
      } else {
        note(theme, 'wizard', 'no parent-with-components in the dev book — see Step 2 note 2', 0)
      }

      // (3) The $0 door: unchecked by default, then taken deliberately.
      await page.getByRole('button', { name: /Next: spending/i }).click()
      await page.waitForTimeout(SETTLE)
      const zero = page.getByRole('checkbox', { name: /Record this month as \$0/i })
      check(theme, 'wizard', 'the $0 checkbox is unchecked by default', !(await zero.isChecked()), false)
      const saveSpending = page.getByRole('button', { name: /^Save spending/i })
      check(
        theme,
        'wizard',
        'an untouched spending step cannot be saved until the box is ticked',
        await saveSpending.isDisabled(),
        await saveSpending.isDisabled(),
      )
      await zero.check()
      const mark = report.writes.length
      await saveSpending.click()
      await page.waitForTimeout(SETTLE)
      const zeroPut = report.writes.slice(mark).find((w) => /spending\/months/.test(w.url))
      check(
        theme,
        'wizard',
        'the $0 save carries confirm_zero:true',
        /"confirm_zero"\s*:\s*true/.test(zeroPut?.body ?? ''),
        zeroPut?.body ?? null,
      )
      await shot('wizard-zero-saved')

      // (4) The repair banner on the month it just emptied.
      await go(`/update?month=${SCRATCH}`)
      await page.getByRole('button', { name: /Next: spending/i }).click()
      await page.waitForTimeout(SETTLE)
      const banner = page
        .locator('.feed-banner, [role="status"]')
        .filter({ hasText: /saved with no spending/i })
      check(
        theme,
        'wizard',
        'an empty month shows the repair banner',
        (await banner.count()) > 0,
        (await banner.count()) ? await banner.first().innerText() : null,
      )
      await shot('wizard-repair-banner')
      drain('wizard')
    }

    // --- overview -------------------------------------------------------------------
    if (STEPS.includes('overview')) {
      where.step = 'overview'
      await go('/')
      const body = await page.locator('main').innerText()
      check(
        theme,
        'overview',
        'the footer names each feed and its gaps',
        /Spending through Jul 2026/.test(body) && /Aug missing/.test(body) && /Sep empty/.test(body),
        (body.match(/Balances through[^\n]*/) ?? [null])[0],
      )
      check(theme, 'overview', 'attention names the never-entered August',
        /August 2026 spending was never entered/i.test(body), null)
      check(theme, 'overview', 'attention names the empty September',
        /September 2026 was saved with no spending/i.test(body), null)
      check(theme, 'overview', 'the YTD card names its windows',
        /Spend Jan.?Jul/i.test(body) && /Saved Jan.?Jul/i.test(body), null)
      await shot('overview')
      drain('overview')
    }

    // --- spending -------------------------------------------------------------------
    if (STEPS.includes('spending')) {
      where.step = 'spending'
      await go('/spending')
      const body = await page.locator('main').innerText()
      check(theme, 'spending', 'the savings chart draws two named lines',
        /Total \(incl\. payroll\)/.test(body) && /\bCash\b/.test(body), null)
      check(theme, 'spending', 'the rollup carries living / tax / transfer columns',
        /Living/i.test(body) && /Tax/i.test(body) && /Transfer/i.test(body), null)
      check(
        theme,
        'spending',
        'the non-living badge is visible on the rollup',
        (await page.locator('.badge, .chip').filter({ hasText: /^(tax|transfer)$/i }).count()) > 0,
        null,
      )
      await shot('spending')
      drain('spending')
    }

    // --- projection -----------------------------------------------------------------
    if (STEPS.includes('projection')) {
      where.step = 'projection'
      await go('/projection')
      const body = await page.locator('main').innerText()
      check(
        theme,
        'projection',
        'the Assumptions card prints the derived window',
        /\b\w{3}\s+\d{4}\s*[–-]\s*\w{3}\s+\d{4}\b/.test(body) && /12 months|over 12/.test(body),
        (body.match(/[^\n]*months[^\n]*/) ?? [null])[0],
      )
      await shot('projection')
      drain('projection')
    }

    // --- money flow -----------------------------------------------------------------
    if (STEPS.includes('moneyflow')) {
      where.step = 'moneyflow'
      await go('/')
      const card = page.locator('.chart-card').filter({ hasText: /Money flow/i }).first()
      await card.scrollIntoViewIfNeeded()
      await page.waitForTimeout(SETTLE)
      const box = await card.locator('canvas').first().boundingBox()
      check(theme, 'moneyflow', 'the money-flow sankey painted', !!box && box.width > 100, box)
      // The node label lives inside the canvas; read the card's own accessible name instead.
      const label = await card.getAttribute('aria-label')
      check(
        theme,
        'moneyflow',
        'the card names the pending take-home node',
        /Take-home not yet entered|not yet entered/i.test(`${label ?? ''} ${await card.innerText()}`),
        label,
      )
      await shot('moneyflow')
      drain('moneyflow')
    }

    // --- settings -------------------------------------------------------------------
    if (STEPS.includes('settings')) {
      where.step = 'settings'
      await go('/settings')
      const picker = page.locator('.segmented').filter({ hasText: /Living/ }).first()
      check(
        theme,
        'settings',
        'each category row carries a three-way kind picker',
        (await picker.count()) > 0 &&
          /Living[\s\S]*Tax[\s\S]*Transfer/.test(await picker.innerText()),
        (await picker.count()) ? await picker.innerText() : null,
      )
      const help = await page.locator('main').innerText()
      check(theme, 'settings', 'the picker warns that a kind applies to ALL history',
        /all history|every figure|retroactive/i.test(help), null)
      await shot('settings-categories')
      drain('settings')
    }

    await page.close()
    await ctx.close()
  }
} finally {
  // The sweep. Runs even on a thrown Playwright timeout: the dev database goes back to what
  // it was. Only rows this run can NAME are touched.
  for (const [label, route] of [
    ['spending month', `/spending/months/${SCRATCH}`],
    ['balances month', `/net-worth/months/${SCRATCH}`],
  ]) {
    const resp = await api(route, { method: 'DELETE' })
    report.sweep.push({ label, route, status: resp.status })
    if (![204, 404].includes(resp.status))
      problem(`sweep: ${label} ${route} answered ${resp.status} — the scratch month may survive`)
  }
  for (const id of report.createdAccounts) {
    const resp = await api(`/net-worth/accounts/${id}`, { method: 'DELETE' })
    report.sweep.push({ label: 'scratch account', id, status: resp.status })
    if (![204, 404].includes(resp.status)) problem(`sweep: account ${id} answered ${resp.status}`)
  }
  const left = await (await api(`/spending/months/${SCRATCH}`)).json().catch(() => null)
  report.sweep.push({ label: 'scratch month after sweep', exists: left?.exists ?? null })
  if (left?.exists) problem('sweep: the scratch spending month still exists after the DELETE')
  await browser.close()
}

report.files = files
writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1))
const passed = report.checks.filter((c) => c.ok === true).length
const failed = report.checks.filter((c) => c.ok === false).length
console.log(
  `\n${passed} checks passed, ${failed} failed; ${files.length} screenshots + report.json in ${out}`,
)
console.log(
  `writes recorded: ${report.writes.length} (all to ${SCRATCH}); PATCH /prefs stubbed: ${report.prefsWrites.length}; sweep: ${JSON.stringify(report.sweep)}`,
)
if (report.problems.length > 0) {
  console.error(`\n${report.problems.length} PROBLEM(S):`)
  for (const p of report.problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log('HONEST SMOKE OK')
```

Two things to resolve against the merged tree before the first run, each with its command:

1. **The step-save button names.** The driver clicks `Save balances` and `Save spending`. Step 1's last grep prints lane C's actual labels — pin the real strings. If lane C kept a single `Save month` button and the decoupling happens underneath it, keep the network assertion (one balances PUT, zero spending PUTs when the spending step was untouched) and drive it through whatever control shipped: the assertion is about the wire, not the label.
2. **A parent with components in the dev book.** Run:

```bash
curl -s -H "authorization: Bearer $(cat $TOKEN_FILE)" http://127.0.0.1:8000/api/v1/net-worth/accounts \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const a=JSON.parse(s);console.log([...new Set(a.filter(x=>x.parent_account_id).map(x=>x.parent_account_id))])})"
```

Non-empty → the derived branch walks for free. Empty → add, at the top of the wizard step, POSTs that create one parent and two components, push their ids into `report.createdAccounts` (the sweep already deletes them), and record that the branch ran.

- [x] **Step 3: README**

Add one row to the tool table in `tools/probes/README.md`:

| `honest-v/smoke.mjs` | The honest-numbers program end to end in both themes: the wizard's per-step saves (a balances save must fire NO spending PUT), the deliberate `$0` door and the repair banner it produces, read-only derived parent rows, Overview's coverage footer and its two new attention items, Spending's two savings lines and kind columns, the Projection window echo, the money-flow pending node and the Settings kind picker. The only smoke that WRITES — always to the scratch month `2019-01`, always swept in a `finally` | needs the dev stack — see below |

and this recipe after the calendar one:

> ## Running the honest-numbers smoke (dev only)
>
> Same stack and the same dev seed credentials (`admin@example.com` / `changeme123` — dev
> database only, never a real one). Restart uvicorn first: it runs WITHOUT `--reload`, so a
> server started before lanes A/B merged answers with the old code and every new wire field
> reads as missing.
>
> ```bash
> OUT=scratchpad/honest-smoke && mkdir -p "$OUT"
> curl -s http://127.0.0.1:8000/api/v1/auth/login -H 'content-type: application/json' \
>   -d '{"email":"admin@example.com","password":"changeme123"}' \
>   | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).access_token))" > "$OUT/token.txt"
> TOKEN_FILE=$OUT/token.txt SMOKE_OUT=$OUT node tools/probes/honest-v/smoke.mjs
> ```
>
> Prints `HONEST SMOKE OK`, or exits 1 listing every problem. Env: `SMOKE_OUT`, `TOKEN_FILE`,
> `APP_BASE`, `API_BASE`, `EDGE_PATH`, `PLAYWRIGHT_CORE`, `ONLY_THEME`, `ONLY_STEP`
> (wizard|overview|spending|projection|moneyflow|settings), `SCRATCH_MONTH`. It writes to the
> dev database on purpose — the wizard's save is the subject — into `SCRATCH_MONTH` only
> (default `2019-01-01`, a month the dev book has never used), and a `finally` sweep DELETEs
> that month from the spending and balances tables plus any account the run created, then
> re-reads the month to prove it is gone. `PATCH /prefs` is stubbed, so a run never rewrites
> the account's settings.

- [x] **Step 4: Commit**

```bash
git add tools/probes/honest-v/smoke.mjs tools/probes/README.md
git commit -m "chore(verify): honest-numbers two-theme smoke — per-step wizard saves, the zero-month door, derived rows, coverage wording; scratch month swept"
```

---

### Task 8: Run the smoke, in both themes, and leave the dev DB as found

**Files:** none (artifacts only)

- [x] **Step 1: Bring the stack up FRESH** — the stack was restarted on final main immediately before this lane began (uvicorn 127.0.0.1:8000 without `--reload`, vite 5173); `GET /coverage` answered with the new `spending_empty`/`spending_missing`/`net_pay_missing`/`latest` fields, which proves it is post-merge code.

From `backend/`: `SCHEDULER_ENABLED=0 .venv/Scripts/python.exe -m uvicorn app.main:app --port 8000` (kill any older uvicorn first — the backend runs without `--reload` and an old process answers with pre-merge code; that trap cost an hour on 2026-09-04). From the root: `npm run dev` (vite on 5173).

- [x] **Step 2: Record the dev database's "before"**

```bash
TOK=$(curl -s http://127.0.0.1:8000/api/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"admin@example.com","password":"changeme123"}' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).access_token))")
curl -s -H "authorization: Bearer $TOK" http://127.0.0.1:8000/api/v1/coverage > /tmp/coverage-before.json
cat /tmp/coverage-before.json
```

Keep this file: Step 4 diffs against it.

- [x] **Step 3: Run**

```bash
OUT="C:/Users/edyli/AppData/Local/Temp/claude/C--Users-edyli-personal-finance-dashboard/<session>/scratchpad/honest-smoke"
mkdir -p "$OUT" && printf '%s' "$TOK" > "$OUT/token.txt"
TOKEN_FILE="$OUT/token.txt" SMOKE_OUT="$OUT" node tools/probes/honest-v/smoke.mjs
```

(`<session>` is this session's scratchpad id, issued at session start; the README recipe's in-repo `scratchpad/honest-smoke` is the gitignored alternative.)

Expected: `HONEST SMOKE OK`; 2 × 8 screenshots plus `report.json`; `report.problems` empty; `report.writes` entirely under `/spending/months/2019-01-01` and `/net-worth/months/2019-01-01`; `report.sweep` showing 204 or 404 for both deletes and `exists: false` afterwards.

A failing check is a defect in the lane that owns the string or the behaviour — fix it there as its own `fix(...)` commit and re-run with `ONLY_STEP=<step>` before re-running the whole walk.

- [x] **Step 4: Prove the dev database is as it was**

```bash
curl -s -H "authorization: Bearer $TOK" http://127.0.0.1:8000/api/v1/coverage > /tmp/coverage-after.json
diff /tmp/coverage-before.json /tmp/coverage-after.json && echo "DEV DB UNCHANGED"
```

Expected: no diff, `DEV DB UNCHANGED`. A diff means the sweep missed something: find it in `report.writes`, undo it by hand through the API, and record both the miss and the undo.

- [x] **Step 5: Eyeball at least these five, one per theme** — done. `dark-wizard-repair-banner`: banner above the grid, both doors ("Delete the empty month" button beside the sentence). `light-wizard-zero-checked`: box ticked, sentence legible. `dark-overview`: the three footer clauses fit one line at 1600px and both new attention items sit above the tiles, distinguishable from the balances nudge. `light-spending`: legend reads "Total (incl. payroll)" over a muted "Cash"; `TAX`/`TRANSFER` badges visible in the rollup beside Living spend / Tax paid / Transfers / Months matched. `dark-moneyflow-pending-table`: the dashed "Take-home not yet entered (7 months)" node sits BESIDE take-home in the same column and the Table twin lists it at 43,240.43. Two notes for the morning, neither wrong: the fullPage capture stacks the sticky live-totals bar over the grid rows (a screenshot artifact, not a layout bug), and the attention counts in these shots include the smoke's own scratch month (`Jan 2019 was saved with no spending`, `+62 earlier months`) because the walk is mid-run — the sweep removed it and the coverage diff is clean.

`dark-wizard-repair-banner` (the banner sits above the grid and offers both doors), `light-wizard-zero-saved` (the checkbox is ticked and its sentence legible), `dark-overview` (the footer's three clauses fit on one line at 1600 px and the two new attention items are distinguishable from the balances nudge), `light-spending` (the muted cash line reads as secondary to the total line; the tax/transfer badges are visible in the rollup), `dark-moneyflow` (the dashed pending node sits beside take-home rather than on top of it, and its label names the month count). Anything ugly is a note for the morning; anything WRONG is a defect tonight.

---

### Task 9: Retire list — expected empty

**Files:** modify this plan (fill the table below)

The honest-numbers program adds fields and rules; it replaces no module. The spec's §8 says "deletions deferred (none expected)". Prove it rather than assume it.

- [x] **Step 1: Run each grep and record the result beside its row**

| Candidate the program could have orphaned | Proof it is still used (expect hits) | Result |
|---|---|---|
| `api/projection.py::_payroll_monthly` (spec §2 moves the arithmetic into `services/savings.py` and imports it back) | `grep -rn "_payroll_monthly\|payroll_monthly" backend/app` — expect the definition in `services/savings.py` and an import in `api/projection.py`, and NO surviving private copy | **IN USE.** Defined once (`services/savings.py:103`), imported by `api/projection.py:64` and called at :153 and :231; `services/paycheck_calc.py:43` documents why the import goes this way. No `_payroll_monthly` survives |
| `api/projection.py::_trailing_annual_spend` / `_trailing_savings` (superseded by the matched-window derivation of §3) | `grep -rn "_trailing_annual_spend\|_trailing_savings" backend/app backend/tests` | **ALREADY GONE — zero hits anywhere.** Lane A replaced them in place with `load_month_savings` + `matched_months`. Nothing to retire: an orphan is code that survives unused, and this is code that no longer exists |
| `services/health_checks.py::check_zero_filled_spending`'s own zero-month query (spec §3: it reads the shared helper now) | `grep -rn "check_zero_filled_spending" backend/app backend/tests` and `grep -n "^def \|^async def " backend/app/services/savings.py` | **IN USE.** Defined at `health_checks.py:71`, wired at :337, pinned by three cases in `test_health_checks.py`; it now takes a `Coverage` argument instead of running its own query, and `savings.py` exports the eight helpers the rest reads |
| `MatrixOut.savings_rate` — KEPT by name, meaning changed; not a retirement | `grep -rn "savings_rate" src backend/app` — expect hits in both, and confirm no `cash_rate` alias was added beside it | **KEPT.** Hits in twelve `src/` files and in `schemas/spending.py` (`savings_rate` beside `total_savings_rate`, both nullable). NO `cash_rate` on the wire — the name lives only as a `MonthSavings`/`PeriodSavings` dataclass field inside `services/savings.py` |
| `src/utils/spending.ts` savings helpers, if lane D moved the rate arithmetic server-side | `grep -rn "savingsRate\|savings_rate" src/utils src/components/spending` | **IN USE.** `savingsRateOption` / `savingsRateCsv` (`spendingChartOptions.ts:345,386`) read both server rates and compute none of their own; no dead helper left in `src/utils` |
| The wizard's combined-save path (`balancesLeg` / "Retry spending") if lane C replaced it | `grep -n "balancesLeg\|Retry spending\|Save month" src/pages/MonthlyUpdatePage.tsx` | **IN USE, renamed.** `balancesLeg` is now the `legs` state (`MonthlyUpdatePage.tsx:306`), read at :696, :848, :1202-1209 and :1719; "Retry spending" and "Save month" are the two faces of the one primary. Lane C decoupled the LEGS inside `save()`, it did not replace the path |

- [x] **Step 2: Write the verdict**

If every row has hits, write **"Retire list: EMPTY — the program added rules, it replaced no module"** into the section at the bottom of this file. If a row is orphaned, list it there with its grep output and the test that pins it (the test dies WITH the code it pins — deleting the source alone turns a green suite red). **Nothing is deleted tonight either way.**

```bash
git add docs/superpowers/plans/2026-09-04-honest-v-verify.md
git commit -m "docs(verify): honest-numbers retire list with its unused-proof greps"
```

---

### Task 10: Production expectations, plan ticks, final gate

**Files:** modify this plan

- [x] **Step 1: Fill in the "Production expectations" section** at the bottom of this file with the figures OBSERVED in Task 6 (not the ones written here), the rounding verdict if Task 6's note fired, and the two clock-coupled values the test printed.

- [x] **Step 2: Tick every checkbox** in this file. A step not run is struck through with its reason on the same line, never left blank.

- [x] **Step 3: Final gate — run everything once more, on the tree as it now stands**

```bash
cd backend && FINANCE_TEST_DB=finance_test_hv .venv/Scripts/python.exe -m pytest -q \
  && .venv/Scripts/python.exe -m ruff check app tests \
  && .venv/Scripts/python.exe -m ruff format --check app tests \
  && .venv/Scripts/python.exe -m alembic heads
cd .. && npx tsc -b && npx eslint . && npx vitest run && npm run build
```

Expected: pytest count = Task 2's + 8; ruff clean; exactly one alembic head; tsc/eslint silent; the vitest counts from Task 3; the build completes.

**OBSERVED, on the tree as it stands (`b6e92d6`):** pytest `1694 passed, 1 skipped` = Task 2's `1686 passed, 1 skipped` **+ 8**, exactly; `ruff check` "All checks passed!" and `ruff format --check` "241 files already formatted"; `alembic heads` = one line, `e5a7c1d3f6b8 (head)`; `tsc -b` silent; `eslint .` exit 0 with **0 errors and 17 pre-existing `react-refresh/only-export-components` warnings** (unchanged by this program — they predate it and eslint's own exit code is 0); `vitest run` `Test Files 175 passed` / `Tests 2364 passed`, exit 0 — the count is Task 3's, and the **exit code** is the thing this lane had to fix (see `fix(tests)`); `npm run build` exit 0 with no heap flag needed — `index-*.js` 316.72 kB (gzip 101.24), `tooltip-*.js` 747.03 kB (gzip 253.44), `index-*.css` 28.11 kB (gzip 6.02), built in 8.79 s.

- [x] **Step 4: Confirm nothing left the box**

```bash
git log --oneline origin/main..main | wc -l
git status --short
git log --oneline -8
```

Expected: a commit count well over 300 ahead of `origin/main` and STILL UNPUSHED; a clean status; the log showing the five lane merges then this lane's four commits (`test(verify)` ×2, `chore(verify)`, `docs(verify)`).

**OBSERVED: 70 ahead, 0 behind, still unpushed.** The "over 300" figure was written before the user pushed `4998f68` on 2026-09-03 20:45 — `origin/main` now sits on exactly this program's base commit, so 70 is the whole honest-numbers batch and nothing else. `git push` was never run in this lane. Status clean. The log shows the five lane merges then SEVEN commits, three more than planned: `test(verify)` ×2 and `docs(verify)` ×2 as written, `chore(verify)` for the smoke, plus two `fix(...)` commits the lane's own gates forced — `fix(savings)` (payroll_savings null, spec §2) and `fix(tests)` (the prefs debounce timer that made `vitest run` exit 1).

- [x] **Step 5: Update the memory file** for this overnight run with: the five merge SHAs, the pytest/vitest counts, the before/after table as observed, the rounding verdict, the smoke's screenshot folder and `report.json` path, the dev-DB "unchanged" proof, the retire verdict, and every deviation taken.

---

## Production expectations — what the morning should see on the real book

*(Filled in by Task 10 Step 1. Written here so the owner can check production against a number that was proved on a copy of production's own census, rather than against a feeling.)*

After the migration runs on production and the app restarts, these are the figures the pages should carry. Anything more than a cent away from these is a finding.

| Where | Before (today, production) | After (proved on the census copy in `backend/tests/verify/`) |
|---|---|---|
| Projection › Assumptions › annual spend | `$65,779.14` — mean of the last 12 months WITH ROWS (Sep 2025–Sep 2026, the `$0` September included) | `$65,009.77` — living spend over the matched window **Aug 2025 – Jul 2026 (12 months)**, printed as the derived window |
| Projection › FI target (4% SWR) | `$1,644,478.50` | `$1,625,244.25` |
| Spending › 2026 rollup › savings | one rate, `−2.2%` | **Total `+$30,159.53` (39.8%)** beside **Cash `−$996.98` (−2.2%)**, both over `months_matched = 7` |
| Spending › 2026 rollup › columns | one `total` | living `$40,564.58` · tax `$5,044.00` · transfer `$0.00` · net pay `$44,611.60` · payroll `$31,156.51` (Σ of the emitted months, 4,450.93 × 7) |
| Spending › April 2026 | `$9,802.63` spend; the month reads −48% | `$4,758.63` living **+** `$5,044.00` tax, badged `tax` |
| Overview › footer | "Spending through Sep 2026" | "Balances through Sep 2026 · Spending through Jul 2026 (Aug missing, Sep empty) · Net pay through Jul 2026", amber |
| Overview › attention | the balances nudge only | **+** "August 2026 spending was never entered" **+** "September 2026 was saved with no spending" |
| Coverage wire | `spending` includes Sep 2026 | `spending` ends `2026-07-01`; `spending_empty = ["2026-09-01"]`; `spending_missing = ["2026-08-01"]`; `net_pay_missing = ["2026-08-01","2026-09-01"]`; `latest = {balances: 2026-09-01, spending: 2026-07-01, net_pay: 2026-07-01}` |
| Overview › money flow 2026 | take-home `$44,611.60`, the rest folded into retained equity | **+** a dashed "Take-home not yet entered (5 months)" node ≈ `$31,865.43`, subtracted from retained equity; `take_home_months_entered = 7` |
| Wizard › Fidelity 401(k) rows | 2 typed totals + 5 components | 5 components + 2 read-only `derived` rows carrying the live sum |
| Health › parent/component drift | (no such check) | 0 months — production was clean at census time; a non-zero count is NEW drift, not a false positive |

**Rounding rule (spec §2/§7, settled 2026-09-04):** per-month wire figures are quantized to cents ROUND_HALF_UP when emitted (`half_up2`); yearly and trailing scalars are the SUM of those emitted months; a MEAN quantizes once at the end. Hence payroll `4,450.93`/month → `31,156.51` for 2026, total savings `30,159.53` over a `75,768.11` denominator (39.8%), and money-flow pending `31,865.43`. The invariant that keeps it honest — and the one `test_after_the_rollup_scalars_equal_the_sum_of_the_months_they_cover` asserts — is that every `YearRollup` scalar equals Σ of the `MatrixOut` months it covers.

**Clock-coupled, recorded not asserted:** the projection's `start_month` / `base_month`, as
printed by Task 6 Step 7 on 2026-09-04: **`start_month 2026-09-01`, `base_month 2026-09-01`**.

**OBSERVED, 2026-09-04 (all eight tests in `backend/tests/verify/test_honest_before_after.py`
green).** Every figure in the table above was asserted and matched, on both columns, with two
exceptions — both findings, both settled:

1. **`payroll_savings` for a month with no net pay was `"0.00"`, not `null`.** Spec §2 conditions
   the field on net pay being present ("a month nobody entered pay for has no deductions on
   record either"), lane A's own comments in `services/savings.py` and `test_spending_api.py`
   said the same, and lane D had already typed the wire `(string | null)[]` — but the service
   emitted `ZERO` beside the `None` cash/total/rates. Fixed on main as `fix(savings): a month
   with no net pay has no payroll figure either — null, not $0.00`; the wire field is now
   `list[Decimal | None]`. **Production impact: an empty or never-entered month shows "—" for
   payroll savings instead of a false $0.00.** The yearly scalars are unaffected — a rollup only
   ever summed matched months.
2. **The 2026 cash rate is `-0.022348`, not the `-0.022347` this plan's derivation table
   printed.** −996.98 ÷ 44,611.60 = −0.0223479991…, which at six places ROUND_HALF_UP is
   `-0.022348`. The plan truncated; the wire is right. The row above is corrected in place.

Everything else landed to the cent: FI target `1,644,478.50` → `1,625,244.25`, annual spend
`65,779.14` → `65,009.77` over `derived_window = {2025-08-01 … 2026-07-01, 12 months}`,
April `4,758.63` living + `5,044.00` tax against an unchanged `9,802.63` total, coverage
`spending_empty=["2026-09-01"]` / `spending_missing=["2026-08-01"]` /
`net_pay_missing=["2026-08-01","2026-09-01"]` / `latest={2026-09-01, 2026-07-01, 2026-07-01}`,
2026 rollup `months_matched=7`, living `40,564.58`, tax `5,044.00`, transfer `0.00`, cash
`−996.98`, payroll `31,156.51` (7 × `4,450.93`), total `30,159.53`, total rate `0.398050`, and
money-flow `take_home_pending = 31,865.43` with `take_home_months_entered = 7`, conserved out of
`retained_equity`. The scalar-equals-sum invariant holds for all six fields.

**The dev database's category kinds after the migration** (`e5a7c1d3f6b8`, already at head; the
shape production will reproduce): `tax` = Taxes (1); `transfer` = Financial, Investments (2);
`living` = the other 16. No NULLs. Note the dev book HAS two transfer categories where the
census fixture has none, so production's `transfer_total` will be non-zero wherever those
categories carry money — by design (spec §1), and the reason every historical savings figure
moves.

**Two things that will look like regressions and are not:** every historical savings figure moves the moment a category's kind changes (spec §1 — kinds apply to ALL history, and the Settings copy says so on screen); and September 2026 loses its filled ribbon dot while its `$0` rows stay in the database until somebody deletes the month from the wizard's repair banner.

---

## Retire at the end of the night

**Retire list: EMPTY — the program added rules, it replaced no module.** Every one of Task 9's
six candidates still has callers and tests; the greps are recorded in that table's Result
column. The one row with no hits at all, `_trailing_annual_spend` / `_trailing_savings`, is not
an orphan either: lane A replaced the arithmetic in place, so there is no surviving code to
delete. Nothing was deleted tonight.

---

## Self-review

**Spec coverage.** §7's "Verify lane: full suites, `alembic check` on the dev DB after upgrade, two-theme smoke, and a before/after table computed on a copy of the production census figures" maps to: full suites → Tasks 2, 3 and the Task 10 final gate; `alembic upgrade head` + `alembic check` on the DEV database, behind an explicit STOP guard that must print `localhost 5433 finance` first → Task 4; the two-theme smoke → Tasks 7–8; the before/after table → Tasks 5–6, with every row of §7's table covered (FI target both columns; the 2026 savings headline both columns; April both columns; the footer wording, the money-flow node and the wizard's derived rows in the smoke, since those are pixels and prose rather than wire values). §7's other bullets stay where they belong — coverage classification incl. the net-pay-only and zero-with-net-pay cases is lane A's unit testing; this lane asserts the composed result on the census. §8's "retire list (none expected)" → Task 9, proved by grep rather than assumed.

**House rules.** TDD for the only real code this lane writes: Task 5 Step 1 is a RED integrity test against a stubbed seeder, Step 2 turns it green, and the §7 assertions are added only afterwards, onto a fixture already proved to BE the census. Nothing is deleted (Task 9 is a list). Nothing is pushed (Task 10 Step 4 asserts the unpushed count). Production is never touched: the census is a hard-coded copy taken read-only on 2026-09-04, alembic runs only after the DSN prints `localhost 5433 finance`, and the smoke's writes are confined to one scratch month with a `finally` sweep and a coverage-diff proof. Worktree: none — this runs on the MAIN checkout after all merges, as stated in the header.

**Placeholders.** Two, both deliberate and both carrying the command that resolves them, because they depend on markup lanes C–E have not written yet: the wizard's step-save button labels (Task 7 Step 2, note 1 — the assertion is on the network, so a different label changes the click, not the proof) and whether the dev book already holds a parent-with-components (note 2, with the create-and-sweep fallback written out). The session scratchpad id in Task 8 Step 3 is `<session>` because it is issued at runtime, and the README gives the in-repo alternative. Everything else — every command, every expected output, every literal in the fixture and every assertion — is complete.

**Arithmetic consistency.** Every figure derives from the Task 5 constants and was checked twice: 70,053.77 over the 12 real months; minus April's 5,044.00 = 65,009.77 living, ÷ 0.04 = 1,625,244.25. The trailing-12 "before" window drops Aug 2025 and admits the `$0` September for 65,779.14, ÷ 0.04 = 1,644,478.50 — **exactly** the spec's own before-column figure, which is the proof that this fixture is the same book the spec was written against. 2026: 45,608.58 spend − 5,044.00 tax = 40,564.58 living against 44,611.60 net pay = −996.98 cash (−2.2%); payroll 4,450.925/month emitted at cents HALF_UP = 4,450.93, × 7 = 31,156.51 → total 30,159.53 over a 75,768.11 denominator → 39.8%. Money flow: 44,611.60 ÷ 7 × 5 = 31,865.43, the mean quantized once. The rounding rule is spec §2/§7's, settled 2026-09-04 (per-month HALF_UP on emission; yearly/trailing scalars are the SUM of the emitted months; means quantize once at the end), and Task 6 Step 4 asserts its deciding invariant directly — every `YearRollup` scalar equals Σ of the `MatrixOut` months it covers.

**Type consistency.** Field names are the spec §2/§3/§4/§5 wire names — `living_total`, `tax_total`, `transfer_total`, `cash_savings`, `payroll_savings`, `total_savings`, `total_savings_rate`, `savings_rate` (kept, now = cash rate), `months_matched`, `spending_empty`, `spending_missing`, `net_pay_missing`, `latest`, `derived_window`, `take_home_pending`, `take_home_months_entered`, `derived`, `confirm_zero`, `kind` — and Task 1 Step 2 greps for every one of them before a single assertion is written, so a renamed field fails preflight rather than a test.
