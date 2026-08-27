# Tax Schema + Engine: Filing Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **RECONCILIATION DECISIONS (orchestrator, 2026-08-26 — authoritative overrides):**
> 1. **Add `statuses_with_rows: list[str]` to the brackets payload.** In Task 7, `_brackets_payload` gains a `SELECT DISTINCT filing_status FROM tax_brackets WHERE year = :year` (sorted list, may be empty) and `TaxBracketsOut` gains the required field `statuses_with_rows`; every brackets GET/PUT/clone response carries it. The taxes-UI plan's status tabs depend on it. Task 7's whole-dict assertions must include the field on both sides.
> 2. The wire shapes in THIS plan are canonical for the batch: `PATCH /taxes/years/{year}` body `{"filing_status": ...}` → `TaxYearOut`; brackets PUT carries `filing_status` in the JSON body; brackets GET `?filing_status=` defaults to `'single'` when absent; clone takes query param `target_status`; inputs PUT keeps `{"values": {...}}` and gains the sibling `{"rows": [{key, person_id, value}]}`. The taxes-UI plan has been aligned to these — do not change them.
> 3. Known deferral (morning list, do NOT implement): importer-created accounts (`apply.py:227-265`) still land with `person_id NULL` (joint); fine for re-import-only flows.

**Goal:** Make the tax engine filing-status correct end-to-end on the BACKEND, per `docs/superpowers/specs/2026-08-26-household-foundation-married-taxes-design.md` §4/§5.3–5.5/§7–§8: `filing_status` on `tax_years` and `tax_brackets`, `person_id` on `tax_inputs`, per-earner Social-Security/SDI walks, status-selected NIIT/SALT/capital-loss/safe-harbor rules, a status-aware bracket loader that refuses to compute against the wrong tables, and importer immunity for partner + married-status rows. **No page UI** — the Taxes page work is the next plan.

**Architecture:** Three additive migrations chained on the household-foundation plan's head. `services/tax_service.py` stays a pure module: `compute_breakdown(..., *, filing_status='single', earners=None)` where `earners=None` synthesizes today's single bundle so the default path is **byte-identical** (the 795-line golden suite runs unmodified after every engine change). `api/taxes.py` grows ONE loader — `_engine_feed` — that resolves the year's status, sums per-person input rows, builds earner bundles, selects status-scoped bracket tables and reports `brackets_missing_for_status`; the summary, the trend feed, the what-if, the withholding card and `api/overview.py`'s money-flow all read it, so they can never disagree about what the engine saw. `services/money_flow.py` gains status/earners passthrough and one new refusal reason; its source-node aggregation is untouched (a later plan owns it).

**Tech stack:** FastAPI + async SQLAlchemy 2.0.52 + Alembic 1.19.1 + pydantic v2, PostgreSQL 16.14 (`NULLS NOT DISTINCT` requires PG15+), pytest (`asyncio_mode = auto`, session-scoped loops).

---

## Orchestration protocol

- **Branch:** all work on `tax-schema-engine`, cut from the branch that carries the household-foundation plan (see Task 0). Merge `--no-ff` at the end. **NEVER push.**
- **Implementers are Opus subagents** (user mandate), one fresh subagent per task, given the FULL task text verbatim. They report DONE / DONE_WITH_CONCERNS / BLOCKED.
- **Sequential lane.** Tasks 1→11 all touch `backend/app/api/taxes.py`, `backend/app/services/tax_service.py` or the shared `finance_test` database. Run them one at a time. **Exactly ONE backend pytest runner at any moment** (the shared `finance_test` on 5433 is not concurrency-safe).
- **Review per task:** one combined two-stage reviewer subagent (spec-compliance, then code quality) over the task's commit range. Important+ findings → fix loop before the next task.
- **Never pipe a gate test run through `grep`/`head`** (exit-code masking lesson).
- **Scratchpad discipline:** per-agent filename prefixes under the session scratchpad.

### The golden gate (binds every task)

`backend/tests/test_tax_service.py` is the 795-line golden suite: 2023–2026 pinned to the cent, including deliberate sheet drift. **It runs UNMODIFIED and green after every engine-touching task.** Each such task carries an explicit `RUN GOLDENS` step.

**One sanctioned exception, in Task 4 only:** `test_suggestion_capital_loss_negative` asserts the UNCAPPED netted loss (`-4000`). Capping the *suggestion* at $3,000/$1,500 is an approved behavior change (spec §5.3; audit §3.2 "adding the cap is a behavior change vs pinned goldens, not a bug fix"), so that ONE test is edited in Task 4, with its old expectation preserved as the pre-clamp assertion. Nothing else in the file may move. `compute_breakdown`'s outputs never move at all.

### Design decisions this plan pins (read before Task 1)

1. **`brackets_missing_for_status` gates married years only.** `'single'` keeps today's behavior exactly: a partial single-filer year computes, with the existing per-jurisdiction warnings. Three shipped tests depend on it (`test_summary_never_serializes_a_signed_zero` and `test_all_years_summary_skips_input_less_years` both summarize years with NO brackets at all). For a married status the tables are brought by the user, so an absent one is a *setup* state, not a data state — the summary refuses rather than reporting a confident zero.
2. **Nullable sections, not a wrapper response.** `TaxSummaryOut` gains `filing_status` + `brackets_missing_for_status` and makes the six jurisdiction blocks and `totals` `| None`. Single-status responses keep byte-identical JSON plus two additive keys, so every shipped test and the current frontend keep working.
3. **The trend feed SKIPS gated years.** `GET /taxes/summary` keeps `years` fully populated (zero risk to today's frontend) and names the refused years in a new `incomplete` list.
4. **Person aggregation is status-scoped.** MFJ = household rows + every person's rows, one earner bundle per person. Single and MFS = household rows + the PRIMARY person's rows, `earners=None`. An MFS return carries one spouse's income (the community-property caveat the UI will render is exactly about what this model does *not* do), and a partner's rows entered for a later year must never leak into a settled single year.
5. **A NULL `person_id` on a per-person key is the pre-household spelling of "the primary person".** The migration backfills it away, but `create_all` test databases have no `people` rows at all — this rule is what makes every shipped test pass untouched.
6. **`EarnerWages` carries three fields, not one.** The FICA bases differ by family: SS/Medicare run on wages net of HSA **and** other pre-tax; CA SDI subtracts dental/vision alone. One scalar cannot reproduce both, so each bundle carries the two pre-tax legs and the engine derives the bases (`fica_wages`, `sdi_wages`) — one definition, two consumers, exactly as the aggregate path did.
7. **Medicare stays a combined-wage walk.** The 0.9% additional tier is legally assessed on combined wages above the status threshold (Form 8959); correctness comes from the status-selected medicare table (MFJ tier at 250k, MFS at 125k), not from a per-person split.

### File map

| File | Task |
|---|---|
| `backend/app/tax_keys.py` (modify) | 1, 2 |
| `backend/app/models/taxes.py` (modify) | 1, 2 |
| `backend/alembic/versions/20260826_1200_a7e3f1b90c24_tax_year_filing_status.py` | 1 |
| `backend/alembic/versions/20260826_1201_c81d4a6f2e35_tax_bracket_filing_status.py` | 1 |
| `backend/alembic/versions/20260826_1202_e26b9d70a4c1_tax_input_person_scope.py` | 2 |
| `backend/app/seed.py` (modify) | 2 |
| `backend/app/services/people.py` (create or extend) | 2 |
| `backend/tests/test_models_taxes.py` (modify) | 1, 2 |
| `backend/tests/test_seed.py` (modify) | 2 |
| `backend/app/services/tax_service.py` (modify) | 3, 4 |
| `backend/tests/test_tax_service_married.py` (create) | 3, 4 |
| `backend/tests/test_tax_service.py` (ONE edit, Task 4 only) | 4 |
| `backend/app/schemas/taxes.py` (modify) | 5, 6, 7, 8 |
| `backend/app/api/taxes.py` (modify) | 5, 6, 7, 8 |
| `backend/tests/test_taxes_api.py` (modify) | 5, 6, 7, 8 |
| `backend/tests/test_withholding_api.py` (modify) | 8 |
| `backend/app/services/money_flow.py` (modify) | 9 |
| `backend/app/api/overview.py` (modify) | 9 |
| `backend/tests/test_money_flow.py`, `backend/tests/test_overview_api.py` (modify) | 9 |
| `backend/app/importer/apply.py` (modify) | 10 |
| `backend/tests/test_importer_apply.py` (modify) | 10 |

---

### Task 0: Environment + preconditions (orchestrator, no subagent)

- [ ] **Step 0.1:** `cd C:/Users/edyli/personal-finance-dashboard && git status --short` → clean tree.
- [ ] **Step 0.2:** Docker DB up: `docker ps --format "{{.Names}} {{.Ports}}"` must list `finance-dashboard-db-1` on `127.0.0.1:5433`. If not: `cmd //c start "" "Docker Desktop"`, wait, then `docker start finance-dashboard-db-1`.
- [ ] **Step 0.3: CAPTURE THE HEAD.** `cd backend && .venv/Scripts/python.exe -m alembic heads` → exactly ONE head, which is the **household-foundation plan's** revision (NOT `c4d1e8a2b9f3`). Write it down as `$HOUSEHOLD_HEAD`. **This is the only substitution anywhere in this plan:** Task 1's first migration sets `down_revision = "$HOUSEHOLD_HEAD"`. If `alembic heads` prints more than one head, STOP.
- [ ] **Step 0.4: Verify the `people` precondition.**

```bash
cd backend
.venv/Scripts/python.exe -c "from app.models import Person; print(Person.__tablename__, [c.name for c in Person.__table__.columns])"
```

Expected: `people ['id', 'name', 'is_primary']` (extra columns are fine). If the class is exported under a different name, note it and use that name consistently in Tasks 2, 5, 6, 10.
- [ ] **Step 0.5:** Confirm `backend/app/services/people.py` does **not** already exist (`ls backend/app/services/people.py`). If the household plan created it, Task 2 APPENDS to it instead of creating it.
- [ ] **Step 0.6: Baseline gates.** `cd backend && .venv/Scripts/python.exe -m pytest -q` → record the pass count (expect ~910 plus whatever the household plan added; 0 failed). This number is the baseline every later gate compares against.
- [ ] **Step 0.7:** `git checkout -b tax-schema-engine`

---

### Task 1: `filing_status` on `tax_years` and `tax_brackets`

**Files:**
- Modify: `backend/app/tax_keys.py` (append the status block after `JURISDICTIONS`, `:61-68`)
- Modify: `backend/app/models/taxes.py` (`TaxYear` `:9-15`, `TaxBracket` `:18-27`)
- Create: `backend/alembic/versions/20260826_1200_a7e3f1b90c24_tax_year_filing_status.py`
- Create: `backend/alembic/versions/20260826_1201_c81d4a6f2e35_tax_bracket_filing_status.py`
- Modify: `backend/tests/test_models_taxes.py` (append)

- [ ] **Step 1.1: Write the failing tests** — append to `backend/tests/test_models_taxes.py`:

```python
# --- filing status (2026-08-26 spec §4) ---


async def test_tax_year_defaults_to_single(db):
    """History is untouched by the migration: a year written without a status IS single."""
    db.add(TaxYear(year=2024))
    await db.commit()
    assert (await db.get(TaxYear, 2024)).filing_status == "single"


async def test_filing_statuses_constant():
    from app.tax_keys import FILING_STATUSES, MARRIED_JOINT, MARRIED_SEPARATE, SINGLE

    assert FILING_STATUSES == (SINGLE, MARRIED_JOINT, MARRIED_SEPARATE)
    assert FILING_STATUSES == ("single", "married_joint", "married_separate")


async def test_brackets_are_unique_per_year_jurisdiction_status_and_index(db):
    """The status dimension sits INSIDE the natural key: one year carries a single-filer
    table and an MFJ table for the same jurisdiction, and the engine walks exactly one."""
    db.add(TaxYear(year=2026))
    await db.flush()
    db.add(
        TaxBracket(
            year=2026,
            jurisdiction="federal",
            filing_status="single",
            bracket_index=1,
            rate=Decimal("0.10"),
            threshold=Decimal("0"),
        )
    )
    db.add(
        TaxBracket(
            year=2026,
            jurisdiction="federal",
            filing_status="married_joint",
            bracket_index=1,
            rate=Decimal("0.10"),
            threshold=Decimal("0"),
        )
    )
    await db.commit()
    stored = (await db.execute(select(TaxBracket))).scalars().all()
    assert sorted(row.filing_status for row in stored) == ["married_joint", "single"]

    # ...and the SAME (year, jurisdiction, status, index) still collides.
    db.add(
        TaxBracket(
            year=2026,
            jurisdiction="federal",
            filing_status="married_joint",
            bracket_index=1,
            rate=Decimal("0.22"),
            threshold=Decimal("0"),
        )
    )
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()


async def test_bracket_defaults_to_single(db):
    db.add(TaxYear(year=2026))
    await db.flush()
    db.add(
        TaxBracket(
            year=2026,
            jurisdiction="state",
            bracket_index=1,
            rate=Decimal("0.01"),
            threshold=Decimal("0"),
        )
    )
    await db.commit()
    assert (await db.execute(select(TaxBracket))).scalar_one().filing_status == "single"
```

- [ ] **Step 1.2: Run — expect failure** — `cd backend && .venv/Scripts/python.exe -m pytest tests/test_models_taxes.py -q`
Expected: 4 new tests fail (`AttributeError`/`TypeError` on `filing_status`, `ImportError` on `FILING_STATUSES`); the 5 shipped tests in the file still pass.

- [ ] **Step 1.3: Add the status vocabulary** — append to `backend/app/tax_keys.py` after the `JURISDICTIONS` tuple:

```python

# Filing status (2026-08-26 spec §4). Python-validated like `accounts.group`, and stored
# as a plain String(20) so a future status (head_of_household) is a one-line change plus
# data, never a migration. `single` is the default everywhere: every stored year predates
# the marriage, and the engine's single path must stay byte-identical.
SINGLE = "single"
MARRIED_JOINT = "married_joint"
MARRIED_SEPARATE = "married_separate"
FILING_STATUSES = (SINGLE, MARRIED_JOINT, MARRIED_SEPARATE)
```

- [ ] **Step 1.4: Add the model columns** — in `backend/app/models/taxes.py`, add the import and the two columns:

```python
from decimal import Decimal

from sqlalchemy import ForeignKey, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.tax_keys import SINGLE


class TaxYear(Base):
    __tablename__ = "tax_years"

    # autoincrement=False: an integer PK otherwise emits SERIAL, and an omitted year would
    # silently insert year=1 instead of erroring. This is a natural key, not a surrogate.
    year: Mapped[int] = mapped_column(primary_key=True, autoincrement=False)
    notes: Mapped[str | None] = mapped_column(Text)
    # One of tax_keys.FILING_STATUSES. server_default AS WELL AS default (the
    # dividend_payments.source precedent): the migration lands every existing row on
    # 'single' without a data pass, and any raw-SQL insert lands there too.
    filing_status: Mapped[str] = mapped_column(String(20), default=SINGLE, server_default=SINGLE)


class TaxBracket(Base):
    __tablename__ = "tax_brackets"
    # The status dimension sits INSIDE the natural key: one year carries a single-filer
    # table and an MFJ table for the same jurisdiction, and `_engine_tables` selects
    # exactly one of them for the engine.
    __table_args__ = (UniqueConstraint("year", "jurisdiction", "filing_status", "bracket_index"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    year: Mapped[int] = mapped_column(ForeignKey("tax_years.year", ondelete="CASCADE"))
    jurisdiction: Mapped[str] = mapped_column(String(20))  # one of tax_keys.JURISDICTIONS
    filing_status: Mapped[str] = mapped_column(String(20), default=SINGLE, server_default=SINGLE)
    bracket_index: Mapped[int] = mapped_column()
    rate: Mapped[Decimal] = mapped_column(Numeric(7, 4))
    threshold: Mapped[Decimal] = mapped_column(Numeric(12, 2))
```

Leave `TaxInputDefinition` and `TaxInput` exactly as they are — Task 2 owns them.

- [ ] **Step 1.5: Write migration 1** — `backend/alembic/versions/20260826_1200_a7e3f1b90c24_tax_year_filing_status.py`. **Set `down_revision` to `$HOUSEHOLD_HEAD` from Step 0.3.**

```python
"""tax year filing status

`tax_years.filing_status` (2026-08-26 spec §4): 'single' | 'married_joint' |
'married_separate', Python-validated like `accounts.group`. Purely additive — every
existing row lands on 'single' through the server default, so history is untouched and
the engine's single-filer path stays byte-identical. The user flips 2026 in the UI.

Revision ID: a7e3f1b90c24
Revises: (the household-foundation head captured in Step 0.3)
Create Date: 2026-08-26 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a7e3f1b90c24"
# STEP 0.3 SUBSTITUTION: the single head printed by `alembic heads` before this branch.
down_revision: str | Sequence[str] | None = "$HOUSEHOLD_HEAD"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "tax_years",
        sa.Column("filing_status", sa.String(length=20), server_default="single", nullable=False),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("tax_years", "filing_status")
```

- [ ] **Step 1.6: Write migration 2** — `backend/alembic/versions/20260826_1201_c81d4a6f2e35_tax_bracket_filing_status.py`:

```python
"""tax bracket filing status

`tax_brackets.filing_status` + the unique-key swap to
(year, jurisdiction, filing_status, bracket_index) (2026-08-26 spec §4). All existing
rows become 'single'; MFJ/MFS tables are new rows the user brings, never a rewrite.

Revision ID: c81d4a6f2e35
Revises: a7e3f1b90c24
Create Date: 2026-08-26 12:01:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c81d4a6f2e35"
down_revision: str | Sequence[str] | None = "a7e3f1b90c24"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CONSTRAINT = "uq_tax_brackets_year"


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "tax_brackets",
        sa.Column("filing_status", sa.String(length=20), server_default="single", nullable=False),
    )
    # SAME NAME on both sides: the metadata convention is
    # uq_%(table_name)s_%(column_0_name)s and column 0 is still `year`, so this is a
    # drop-then-create of one constraint rather than a rename.
    op.drop_constraint(CONSTRAINT, "tax_brackets", type_="unique")
    op.create_unique_constraint(
        CONSTRAINT, "tax_brackets", ["year", "jurisdiction", "filing_status", "bracket_index"]
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(CONSTRAINT, "tax_brackets", type_="unique")
    # Non-single rows would violate the narrower key, and they only exist because this
    # migration ran — drop them rather than leaving the constraint uncreatable.
    op.execute("DELETE FROM tax_brackets WHERE filing_status <> 'single'")
    op.create_unique_constraint(CONSTRAINT, "tax_brackets", ["year", "jurisdiction", "bracket_index"])
    op.drop_column("tax_brackets", "filing_status")
```

- [ ] **Step 1.7: Run to pass** — `cd backend && .venv/Scripts/python.exe -m pytest tests/test_models_taxes.py -q`
Expected: 9 passed.
- [ ] **Step 1.8: RUN GOLDENS** — `cd backend && .venv/Scripts/python.exe -m pytest tests/test_tax_service.py -q`
Expected: 52 passed, file unmodified (`git diff --stat backend/tests/test_tax_service.py` must be empty).
- [ ] **Step 1.9: Migration round-trip** — from `backend/`:

```bash
.venv/Scripts/python.exe -m alembic upgrade head
.venv/Scripts/python.exe -m alembic heads
.venv/Scripts/python.exe -m alembic downgrade a7e3f1b90c24
.venv/Scripts/python.exe -m alembic downgrade -1
.venv/Scripts/python.exe -m alembic upgrade head
```

Expected: all five exit 0; `heads` prints the single head `c81d4a6f2e35`.
- [ ] **Step 1.10: Lint** — `cd backend && .venv/Scripts/python.exe -m ruff check app tests && .venv/Scripts/python.exe -m ruff format app tests`
- [ ] **Step 1.11: Commit** — `git add backend/app/tax_keys.py backend/app/models/taxes.py backend/alembic/versions/20260826_1200_a7e3f1b90c24_tax_year_filing_status.py backend/alembic/versions/20260826_1201_c81d4a6f2e35_tax_bracket_filing_status.py backend/tests/test_models_taxes.py && git commit -m "feat(taxes): filing_status on tax_years and tax_brackets, status in the bracket unique key"`

---

### Task 2: `person_id` on `tax_inputs`, `is_per_person` definitions, two tracker keys

**Files:**
- Modify: `backend/app/tax_keys.py` (`TAX_INPUT_DEFINITIONS` `:13-59`, then append `PER_PERSON_KEYS`)
- Modify: `backend/app/models/taxes.py` (`TaxInputDefinition` `:30-37`, `TaxInput` `:40-49`)
- Modify: `backend/app/seed.py` (`seed_tax_definitions` `:25-38`)
- Create (or extend, per Step 0.5): `backend/app/services/people.py`
- Create: `backend/alembic/versions/20260826_1202_e26b9d70a4c1_tax_input_person_scope.py`
- Modify: `backend/tests/test_models_taxes.py` (append + three count literals)
- Modify: `backend/tests/test_seed.py` (`:72` count literal)

**The verified per-person key list.** All 17 keys named in the scope exist verbatim in `tax_keys.py` — `annual_salary` (:14), `gross_paycheck` (:15), `pay_periods` (:16), `latest_w2_income` (:17), `other_w2_income` (:18), `w2_stock_rsus_sold` (:19), `w2_bonuses` (:20), `w2_salary_checkpoint` (:21), `w2_espp_sale_component` (:22), `w2_employer_hsa` (:23), `w2_other` (:24), `trad_401k_contributions` (:36), `hsa_contributions` (:37), `hsa_contributions_employer` (:38), `other_pretax_deductions` (:40), `pretax_dental` (:41), `pretax_vision` (:42) — no corrections needed. Plus the two NEW tracker keys = **19**. Exactly six of them reach the engine (`latest_w2_income`, `other_w2_income`, `trad_401k_contributions`, `hsa_contributions`, `hsa_contributions_employer`, `other_pretax_deductions`); the rest feed suggestions and the withholding card.

- [ ] **Step 2.1: Write the failing tests** — append to `backend/tests/test_models_taxes.py`:

```python
# --- person scope (2026-08-26 spec §4) ---


async def test_per_person_keys_are_defined_and_flagged(db):
    from app.seed import seed_tax_definitions
    from app.tax_keys import PER_PERSON_KEYS

    defined = {key for key, *_ in TAX_INPUT_DEFINITIONS}
    assert set(PER_PERSON_KEYS) <= defined
    assert len(PER_PERSON_KEYS) == 19
    assert len(set(PER_PERSON_KEYS)) == 19
    # The two tracker-only keys are per-person and stored, but the engine never reads them.
    from app.services.tax_service import ENGINE_INPUT_KEYS, SUGGESTION_KEYS

    for key in ("w2_fed_withholding", "w2_state_withholding"):
        assert key in PER_PERSON_KEYS
        assert key in defined
        assert key not in ENGINE_INPUT_KEYS
        assert key not in SUGGESTION_KEYS

    await seed_tax_definitions(db)
    await db.commit()
    flagged = {
        row.key
        for row in (await db.execute(select(TaxInputDefinition))).scalars()
        if row.is_per_person
    }
    assert flagged == set(PER_PERSON_KEYS)


async def test_household_rows_cannot_duplicate_nulls_not_distinct(db):
    """PG16 NULLS NOT DISTINCT: two NULL-person rows for one (year, key) must collide.

    Without it a plain unique index treats every NULL as unique, so the engine's
    per-key SUM would silently double-count a household line."""
    db.add(TaxYear(year=2026))
    db.add(
        TaxInputDefinition(
            key="interest_total", label="Interest", section="ordinary_income", sort_order=190
        )
    )
    await db.flush()
    db.add(TaxInput(year=2026, key="interest_total", value=Decimal("100")))
    await db.commit()
    db.add(TaxInput(year=2026, key="interest_total", value=Decimal("200")))
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()


async def test_the_same_key_may_repeat_across_people(db):
    from app.models import Person

    me = Person(name="Me", is_primary=True)
    partner = Person(name="Partner", is_primary=False)
    db.add_all([me, partner])
    db.add(TaxYear(year=2026))
    db.add(
        TaxInputDefinition(
            key="latest_w2_income",
            label="Latest W2 Income",
            section="ordinary_income",
            sort_order=40,
            is_per_person=True,
        )
    )
    await db.flush()
    db.add(TaxInput(year=2026, key="latest_w2_income", person_id=me.id, value=Decimal("150000")))
    db.add(
        TaxInput(year=2026, key="latest_w2_income", person_id=partner.id, value=Decimal("100000"))
    )
    await db.commit()
    stored = (await db.execute(select(TaxInput))).scalars().all()
    assert sorted(row.value for row in stored) == [Decimal("100000"), Decimal("150000")]

    # ...but one person still gets one row per key.
    db.add(TaxInput(year=2026, key="latest_w2_income", person_id=me.id, value=Decimal("1")))
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()
```

Also update the three shipped count literals in this file: `:51` `assert len(TAX_INPUT_DEFINITIONS) == 43` → `== 45`, `:62` `assert count == 43` → `== 45`, `:75` `assert count == 43` → `== 45`.

- [ ] **Step 2.2: Update the seed test** — `backend/tests/test_seed.py:72`: `assert len(rows) == len(TAX_INPUT_DEFINITIONS) == 43` → `== 45`.
- [ ] **Step 2.3: Run — expect failure** — `cd backend && .venv/Scripts/python.exe -m pytest tests/test_models_taxes.py tests/test_seed.py -q`
Expected: the three new tests plus the four count assertions fail.

- [ ] **Step 2.4: Add the two definitions + `PER_PERSON_KEYS`** — in `backend/app/tax_keys.py`, insert the two rows immediately after `("w2_other", ...)` (`:24`):

```python
    ("w2_other", "W2: Other", ORDINARY_INCOME, 110, False),
    # Tracker-only (2026-08-26 spec §5.6): the withholding card's partner side reads these
    # two, the engine never does. Stored inputs outside ENGINE_INPUT_KEYS, exactly like
    # capital_loss_deductions — real values the user enters, zero effect on any liability.
    ("w2_fed_withholding", "W2: Federal Withholding", ORDINARY_INCOME, 112, False),
    ("w2_state_withholding", "W2: State Withholding", ORDINARY_INCOME, 114, False),
```

and append after the `FILING_STATUSES` block from Task 1:

```python

# The input keys that belong to a PERSON rather than the household (audit §3.2's list of
# 17, plus the two tracker keys above). Every OTHER key is household-level and stores
# exactly one row per year with person_id NULL — after the person migration, NULL means
# household, strictly. Only six of these reach the engine's walks; the rest feed the
# suggestion formulas and the withholding card.
PER_PERSON_KEYS: tuple[str, ...] = (
    "annual_salary",
    "gross_paycheck",
    "pay_periods",
    "latest_w2_income",
    "other_w2_income",
    "w2_stock_rsus_sold",
    "w2_bonuses",
    "w2_salary_checkpoint",
    "w2_espp_sale_component",
    "w2_employer_hsa",
    "w2_other",
    "w2_fed_withholding",
    "w2_state_withholding",
    "trad_401k_contributions",
    "hsa_contributions",
    "hsa_contributions_employer",
    "other_pretax_deductions",
    "pretax_dental",
    "pretax_vision",
)
```

- [ ] **Step 2.5: Add the model columns** — replace `TaxInputDefinition` and `TaxInput` in `backend/app/models/taxes.py`:

```python
class TaxInputDefinition(Base):
    __tablename__ = "tax_input_definitions"

    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    label: Mapped[str] = mapped_column(String(120))
    section: Mapped[str] = mapped_column(String(30))
    sort_order: Mapped[int] = mapped_column(default=0)
    is_derived: Mapped[bool] = mapped_column(default=False)
    # True for the 19 tax_keys.PER_PERSON_KEYS: this line belongs to one person, so a
    # married-joint year stores one row per person and the engine sums them.
    is_per_person: Mapped[bool] = mapped_column(default=False)


class TaxInput(Base):
    __tablename__ = "tax_inputs"
    # NULLS NOT DISTINCT (PG15+; this app runs PG16.14). Without it two household rows for
    # the same (year, key) would BOTH satisfy a plain unique key and the engine's per-key
    # SUM would double-count them. SQLAlchemy 2.0.52 renders the clause for create_all and
    # alembic emits the same DDL, so the test database and prod share one contract.
    __table_args__ = (
        UniqueConstraint("year", "key", "person_id", postgresql_nulls_not_distinct=True),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    year: Mapped[int] = mapped_column(ForeignKey("tax_years.year", ondelete="CASCADE"))
    key: Mapped[str] = mapped_column(ForeignKey("tax_input_definitions.key", ondelete="CASCADE"))
    # NULL means HOUSEHOLD, strictly: the migration backfills every per-person key's rows
    # to the primary person. RESTRICT, not CASCADE — a person is never deleted while
    # referenced (spec §5.1 has no delete route), and financial history must not vanish
    # behind a roster edit.
    person_id: Mapped[int | None] = mapped_column(
        ForeignKey("people.id", ondelete="RESTRICT"), default=None
    )
    # (14,4), not (14,2): the sheet stores fractional inputs (e.g. state-exempt dividend
    # percentage 0.9645) alongside dollar amounts; 4 dp preserves both.
    value: Mapped[Decimal] = mapped_column(Numeric(14, 4))
```

- [ ] **Step 2.6: Seed the flag** — in `backend/app/seed.py`, import `PER_PERSON_KEYS` and set it at insert (the insert-only contract is unchanged — a hand-edited label still survives):

```python
from app.tax_keys import PER_PERSON_KEYS, TAX_INPUT_DEFINITIONS
```

```python
async def seed_tax_definitions(db: AsyncSession) -> None:
    existing = set((await db.execute(select(TaxInputDefinition.key))).scalars().all())
    for key, label, section, sort_order, is_derived in TAX_INPUT_DEFINITIONS:
        if key not in existing:
            db.add(
                TaxInputDefinition(
                    key=key,
                    label=label,
                    section=section,
                    sort_order=sort_order,
                    is_derived=is_derived,
                    # The flag is a property of the KEY, so it is seeded rather than
                    # migrated for any database that meets these rows for the first time
                    # (a create_all test DB, or a fresh deploy).
                    is_per_person=key in PER_PERSON_KEYS,
                )
            )
```

- [ ] **Step 2.7: Create the shared roster reads** — `backend/app/services/people.py` (if the household plan already created this file, ADD these two functions to it and keep its own):

```python
"""Person-roster reads shared by the taxes engine feed and the tax importer.

The household router owns people CRUD; this is the two-line READ every other module
needs, in one place, so "who is the primary person" can never be answered two ways.
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Person


async def load_people(db: AsyncSession) -> list[Person]:
    """Every person, PRIMARY FIRST then by id — the column order the taxes payloads use."""
    people = list((await db.execute(select(Person))).scalars())
    return sorted(people, key=lambda person: (not person.is_primary, person.id))


def primary_person(people: list[Person]) -> Person | None:
    """The primary row, or None on a database whose roster has not been seeded — a
    create_all test database, or any deploy older than the household migration. Callers
    treat None as "person_id stays NULL", which is exactly the pre-migration spelling."""
    return people[0] if people and people[0].is_primary else None
```

- [ ] **Step 2.8: Write migration 3** — `backend/alembic/versions/20260826_1202_e26b9d70a4c1_tax_input_person_scope.py`:

```python
"""tax input person scope

`tax_inputs.person_id` (nullable FK -> people, NULL = household) with the unique key
swapped to (year, key, person_id) NULLS NOT DISTINCT, plus
`tax_input_definitions.is_per_person` and the two tracker-only withholding keys
(2026-08-26 spec §4 / §5.6).

Backfill: every row whose key is per-person becomes the PRIMARY person's; household keys
stay NULL. Invariant after this migration: NULL means household-level, strictly.

Revision ID: e26b9d70a4c1
Revises: c81d4a6f2e35
Create Date: 2026-08-26 12:02:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e26b9d70a4c1"
down_revision: str | Sequence[str] | None = "c81d4a6f2e35"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CONSTRAINT = "uq_tax_inputs_year"
FOREIGN_KEY = "fk_tax_inputs_person_id_people"

# app/tax_keys.py PER_PERSON_KEYS, spelled out rather than imported: a migration pins the
# vocabulary as it was ON THIS DAY, and must not drift when the constant later grows.
PER_PERSON_KEYS = (
    "annual_salary",
    "gross_paycheck",
    "pay_periods",
    "latest_w2_income",
    "other_w2_income",
    "w2_stock_rsus_sold",
    "w2_bonuses",
    "w2_salary_checkpoint",
    "w2_espp_sale_component",
    "w2_employer_hsa",
    "w2_other",
    "w2_fed_withholding",
    "w2_state_withholding",
    "trad_401k_contributions",
    "hsa_contributions",
    "hsa_contributions_employer",
    "other_pretax_deductions",
    "pretax_dental",
    "pretax_vision",
)
KEY_LIST = ", ".join(f"'{key}'" for key in PER_PERSON_KEYS)

# The two tracker-only definitions, seeded HERE as well as in app/seed.py: start.sh runs
# `alembic upgrade head` BEFORE `python -m app.seed`, so the flag update below would miss
# them on a boot that migrates and seeds in the same breath.
NEW_DEFINITIONS = (
    ("w2_fed_withholding", "W2: Federal Withholding", "ordinary_income", 112),
    ("w2_state_withholding", "W2: State Withholding", "ordinary_income", 114),
)


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "tax_input_definitions",
        sa.Column("is_per_person", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    for key, label, section, sort_order in NEW_DEFINITIONS:
        op.execute(
            "INSERT INTO tax_input_definitions "
            "(key, label, section, sort_order, is_derived, is_per_person) "
            f"VALUES ('{key}', '{label}', '{section}', {sort_order}, FALSE, TRUE) "
            "ON CONFLICT (key) DO NOTHING"
        )
    op.execute(f"UPDATE tax_input_definitions SET is_per_person = TRUE WHERE key IN ({KEY_LIST})")
    # Match the model (Python-side default only), like accounts.is_component, so
    # `alembic check` stays clean.
    op.alter_column("tax_input_definitions", "is_per_person", server_default=None)

    op.add_column("tax_inputs", sa.Column("person_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        FOREIGN_KEY, "tax_inputs", "people", ["person_id"], ["id"], ondelete="RESTRICT"
    )
    # De-dupe guard BEFORE the NULLS NOT DISTINCT key (spec §8). The old unique was
    # (year, key), so duplicates cannot exist through the app — this is belt and braces
    # for a hand-edited database, and it keeps the OLDEST row of any pair.
    op.execute(
        "DELETE FROM tax_inputs a USING tax_inputs b "
        "WHERE a.year = b.year AND a.key = b.key AND a.id > b.id"
    )
    # Backfill: per-person rows become the primary person's; household keys stay NULL. A
    # database with no seeded roster is left entirely alone (the EXISTS guard), where NULL
    # keeps meaning what it meant before.
    op.execute(
        "UPDATE tax_inputs SET person_id = "
        "(SELECT id FROM people WHERE is_primary ORDER BY id LIMIT 1) "
        f"WHERE key IN ({KEY_LIST}) AND person_id IS NULL "
        "AND EXISTS (SELECT 1 FROM people WHERE is_primary)"
    )
    op.drop_constraint(CONSTRAINT, "tax_inputs", type_="unique")
    op.create_unique_constraint(
        CONSTRAINT,
        "tax_inputs",
        ["year", "key", "person_id"],
        postgresql_nulls_not_distinct=True,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(CONSTRAINT, "tax_inputs", type_="unique")
    # Anybody but the primary person only has rows because this migration ran; the
    # narrower (year, key) key cannot hold them. IS DISTINCT FROM, not <>, so an empty
    # roster (NULL subquery) still deletes every person-owned row instead of none.
    op.execute(
        "DELETE FROM tax_inputs WHERE person_id IS NOT NULL AND person_id IS DISTINCT FROM "
        "(SELECT id FROM people WHERE is_primary ORDER BY id LIMIT 1)"
    )
    op.execute(
        "DELETE FROM tax_inputs a USING tax_inputs b "
        "WHERE a.year = b.year AND a.key = b.key AND a.id > b.id"
    )
    op.create_unique_constraint(CONSTRAINT, "tax_inputs", ["year", "key"])
    op.drop_constraint(FOREIGN_KEY, "tax_inputs", type_="foreignkey")
    op.drop_column("tax_inputs", "person_id")
    # The two tracker definitions are left in place: they are inert rows the seed would
    # recreate anyway, and deleting them would cascade real user values away.
    op.drop_column("tax_input_definitions", "is_per_person")
```

- [ ] **Step 2.9: Run to pass** — `cd backend && .venv/Scripts/python.exe -m pytest tests/test_models_taxes.py tests/test_seed.py -q`
Expected: all pass (12 in `test_models_taxes.py`).
- [ ] **Step 2.10: RUN GOLDENS** — `cd backend && .venv/Scripts/python.exe -m pytest tests/test_tax_service.py -q` → 52 passed, `git diff --stat backend/tests/test_tax_service.py` empty.
- [ ] **Step 2.11: Whole backend suite** — `cd backend && .venv/Scripts/python.exe -m pytest -q`
Expected: the Step 0.6 baseline + 7 new, 0 failed. **If `test_importer_parsers.py::…` still asserts 43 sheet keys, that is CORRECT** — the workbook has 43 keys; only the definition table has 45.
- [ ] **Step 2.12: Migration round-trip** — from `backend/`: `.venv/Scripts/python.exe -m alembic upgrade head && .venv/Scripts/python.exe -m alembic heads && .venv/Scripts/python.exe -m alembic downgrade -1 && .venv/Scripts/python.exe -m alembic upgrade head`
Expected: exit 0; `heads` prints the single head `e26b9d70a4c1`.
- [ ] **Step 2.13: Verify the DDL actually carries the clause** — from `backend/`:

```bash
docker exec finance-dashboard-db-1 psql -U finance -d finance -c "\d tax_inputs"
```

Expected: the unique constraint line reads `UNIQUE NULLS NOT DISTINCT (year, key, person_id)`.
- [ ] **Step 2.14: Lint** — `cd backend && .venv/Scripts/python.exe -m ruff check app tests && .venv/Scripts/python.exe -m ruff format app tests`
- [ ] **Step 2.15: Commit** — `git add backend/app/tax_keys.py backend/app/models/taxes.py backend/app/seed.py backend/app/services/people.py backend/alembic/versions/20260826_1202_e26b9d70a4c1_tax_input_person_scope.py backend/tests/test_models_taxes.py backend/tests/test_seed.py && git commit -m "feat(taxes): tax_inputs.person_id with NULLS NOT DISTINCT, is_per_person definitions, withholding tracker keys"`

---

### Task 3: Engine — `EarnerWages`, per-earner FICA, status-aware NIIT

**Files:**
- Modify: `backend/app/services/tax_service.py` (imports `:29-32`, constants `:47-62`, `niit_advisory` `:198-224`, `compute_breakdown` `:227-406` — the FICA block `:310-334` and the `advisory` call `:356`)
- Create: `backend/tests/test_tax_service_married.py`
- **Do NOT touch** `backend/tests/test_tax_service.py`.

- [ ] **Step 3.1: Write the failing tests** — `backend/tests/test_tax_service_married.py`:

```python
"""Married-filing engine goldens: per-earner payroll walks + status-selected thresholds.

Hand-computed against a SYNTHETIC year with deliberately round MFJ tables — nothing here
comes from the workbook, because the workbook is a single filer. The arithmetic is spelled
out in comments so a moved number points at a specific term rather than at "the engine".

The single-filer path is pinned next door in test_tax_service.py and must not move: the
first test below is the byte-identity proof — every golden year, computed through the new
`earners` parameter, equals the same year computed the old way, field for field.
"""

from decimal import ROUND_HALF_UP, Decimal

import pytest

from app.services.tax_service import (
    EarnerWages,
    compute_breakdown,
    earner_from_inputs,
    niit_advisory,
)
from app.tax_keys import MARRIED_JOINT, MARRIED_SEPARATE, SINGLE
from tests.test_tax_service import YEAR_BRACKETS, YEAR_INPUTS, YEARS, actuals

CENT = Decimal("0.01")
D = Decimal


def cents(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


# --------------------------------------------------------------------------------------
# The default path is the synthesized single bundle, exactly
# --------------------------------------------------------------------------------------


@pytest.mark.parametrize("year", YEARS)
def test_explicit_single_earner_equals_the_default_path(year):
    """`earners=None` must be indistinguishable from handing the engine the one bundle it
    would have synthesized — this is what keeps the golden suite honest."""
    default = compute_breakdown(year, YEAR_INPUTS[year], YEAR_BRACKETS[year])
    explicit = compute_breakdown(
        year,
        YEAR_INPUTS[year],
        YEAR_BRACKETS[year],
        filing_status=SINGLE,
        earners=[earner_from_inputs(YEAR_INPUTS[year])],
    )
    assert actuals(explicit) == actuals(default)
    assert explicit.warnings == default.warnings
    for family in ("medicare", "social_security", "disability"):
        one, two = getattr(default, family), getattr(explicit, family)
        assert (one.w2_income, one.taxable_wages, one.tax, one.effective_rate) == (
            two.w2_income,
            two.taxable_wages,
            two.tax,
            two.effective_rate,
        ), family


def test_empty_earner_list_is_not_a_bundle():
    """An empty list is not "one earner with nothing" — it is no wage data at all, and it
    must read like a year with no W-2 rather than crash a sum."""
    breakdown = compute_breakdown(2024, YEAR_INPUTS[2024], YEAR_BRACKETS[2024], earners=[])
    assert breakdown.medicare.w2_income == Decimal("0")
    assert breakdown.social_security.tax == Decimal("0")
    assert breakdown.disability.tax == Decimal("0")
    # The income chains are untouched: FICA is the only thing earners describe.
    assert breakdown.federal.agi == Decimal("211776.2")


# --------------------------------------------------------------------------------------
# The MFJ reference year
# --------------------------------------------------------------------------------------

MFJ_YEAR = 2026

# Round tables so every walk below is checkable by hand. The three status-sensitive
# thresholds are the point: the medicare additional tier sits at MFJ's 250000 (a single
# filer's table would put it at 200000), and the SS wage base / SDI pseudo-cap are per
# PERSON parameters that the aggregate model applied once.
MFJ_BRACKETS: dict[str, list[tuple[Decimal, Decimal]]] = {
    "federal": [(D("0.10"), D("0")), (D("0.22"), D("100000")), (D("0.32"), D("300000"))],
    "state": [(D("0.02"), D("0")), (D("0.06"), D("50000")), (D("0.10"), D("200000"))],
    "medicare": [(D("0.0145"), D("0")), (D("0.0235"), D("250000"))],
    "social_security": [(D("0.062"), D("0")), (D("0"), D("180000"))],
    "disability": [(D("0.01"), D("0")), (D("0"), D("200000"))],
    "capital_gains": [(D("0"), D("0")), (D("0.188"), D("100000")), (D("0.238"), D("600000"))],
}

# Household-level lines (one row each in the DB, person_id NULL).
MFJ_HOUSEHOLD = {
    "stcg_total": D("0"),
    "stcg_standard": D("0"),
    "unqualified_dividends": D("1000"),
    "unq_div_us_treasuries_etf": D("0"),
    "unq_div_state_exempt_pct": D("0"),
    "interest_total": D("2000"),
    "other_income_1099": D("0"),
    "standard_deduction": D("30000"),
    "itemized_deduction": D("0"),
    "state_standard_deduction": D("11000"),
    "state_exemption_credits": D("300"),
    "ltcg_total": D("40000"),
    "ltcg_brokerage": D("40000"),
    "qualified_dividends": D("5000"),
    "other_capital_gains": D("0"),
}

# Per-person lines. A is over the 180000 SS wage base, B is well under it — the two cases
# the aggregate model could not tell apart.
EARNER_A = {
    "latest_w2_income": D("150000"),
    "other_w2_income": D("50000"),
    "trad_401k_contributions": D("20000"),
    "hsa_contributions": D("5000"),
    "hsa_contributions_employer": D("1000"),
    "other_pretax_deductions": D("300"),
}
EARNER_B = {
    "latest_w2_income": D("100000"),
    "other_w2_income": D("0"),
    "trad_401k_contributions": D("10000"),
    "hsa_contributions": D("0"),
    "hsa_contributions_employer": D("0"),
    "other_pretax_deductions": D("200"),
}


def summed(*bundles: dict[str, Decimal]) -> dict[str, Decimal]:
    """What the API's per-key SUM hands the engine: household rows plus every person's."""
    values = dict(MFJ_HOUSEHOLD)
    for bundle in bundles:
        for key, amount in bundle.items():
            values[key] = values.get(key, D("0")) + amount
    return values


MFJ_INPUTS = summed(EARNER_A, EARNER_B)
MFJ_EARNERS = [earner_from_inputs(EARNER_A), earner_from_inputs(EARNER_B)]


def mfj_breakdown():
    return compute_breakdown(
        MFJ_YEAR,
        MFJ_INPUTS,
        MFJ_BRACKETS,
        filing_status=MARRIED_JOINT,
        earners=MFJ_EARNERS,
    )


def test_mfj_reference_year_to_the_cent():
    breakdown = mfj_breakdown()
    assert breakdown.warnings == []  # every key present, every table present, rates agree

    # Federal: income 250000 + 50000 + 1000 + 2000 = 303000; pre-tax 30000 + 5000 + 1000
    # + 500 = 36500 -> AGI 266500. Deduction max(30000, 0). TI 236500.
    # Tax = 100000x.10 + 136500x.22 = 10000 + 30030.
    assert breakdown.federal.agi == D("266500")
    assert breakdown.federal.taxable_income == D("236500")
    assert cents(breakdown.federal.tax) == D("40030.00")

    # Capital gains: LTCG 40000 is a gain, so everything nets -> 40000 + 5000 + 0.
    assert breakdown.capital_gains.gains_amount == D("45000")
    # Stacked on TI 236500 -> [236500, 281500], entirely inside the 18.8% tier.
    assert cents(breakdown.capital_gains.tax) == D("8460.00")

    # State: AGI = 266500 - 0 (no treasury slice) + 5000 + 1000 (HSA addbacks) + 45000
    # (the CA capital-gains fold) = 317500. TI = 306500.
    # Tax = 50000x.02 + 150000x.06 + 106500x.10 - 300 = 1000 + 9000 + 10650 - 300.
    assert breakdown.state.agi == D("317500")
    assert breakdown.state.taxable_income == D("306500")
    assert cents(breakdown.state.tax) == D("20350.00")

    # Medicare stays a COMBINED walk: 193700 + 99800 = 293500 of FICA wages, and the
    # additional tier is the MFJ table's 250000. 250000x.0145 + 43500x.0235.
    assert breakdown.medicare.w2_income == D("300000")
    assert breakdown.medicare.taxable_wages == D("293500")
    assert cents(breakdown.medicare.tax) == D("4647.25")

    # Social Security: PER EARNER against the 180000 base. A caps at 180000, B brings its
    # whole 99800. 180000x.062 + 99800x.062 = 11160 + 6187.60.
    assert breakdown.social_security.taxable_wages == D("279800")
    assert cents(breakdown.social_security.tax) == D("17347.60")

    # SDI: per earner over wages net of dental/vision only (the CA quirk), both under the
    # 200000 pseudo-cap. 199700x.01 + 99800x.01. Reported wages stay the UNCAPPED sum.
    assert breakdown.disability.taxable_wages == D("299500")
    assert cents(breakdown.disability.tax) == D("2995.00")

    # Totals: gross sums the COMPONENTS (250000 + 50000 + 1000 + 2000 + 40000 + 5000).
    assert breakdown.totals.gross_income == D("348000")
    assert cents(breakdown.totals.total_tax) == D("93829.85")
    assert cents(breakdown.totals.take_home) == D("254170.15")


def test_one_shared_wage_base_would_understate_social_security():
    """The wrong-money bug this parameter exists to kill (audit §3.2).

    Same inputs, same tables, no earner bundles: the aggregate path caps 293500 of
    combined wages ONCE at 180000 and loses B's entire contribution."""
    aggregate = compute_breakdown(MFJ_YEAR, MFJ_INPUTS, MFJ_BRACKETS, filing_status=MARRIED_JOINT)
    assert cents(aggregate.social_security.tax) == D("11160.00")
    assert cents(mfj_breakdown().social_security.tax - aggregate.social_security.tax) == D(
        "6187.60"
    )


def test_single_tables_would_fire_the_medicare_surtax_too_early():
    """Correctness comes from the STATUS-SELECTED table, not from splitting the wages: the
    same combined 293500 meets the surtax at 200000 on a single-filer table."""
    single_tables = dict(MFJ_BRACKETS) | {
        "medicare": [(D("0.0145"), D("0")), (D("0.0235"), D("200000"))]
    }
    single = compute_breakdown(
        MFJ_YEAR, MFJ_INPUTS, single_tables, filing_status=SINGLE, earners=MFJ_EARNERS
    )
    # 200000x.0145 + 93500x.0235 = 2900 + 2197.25
    assert cents(single.medicare.tax) == D("5097.25")
    assert cents(single.medicare.tax - mfj_breakdown().medicare.tax) == D("450.00")


def test_both_earners_under_the_wage_base_pay_two_full_caps():
    """Neither earner reaches 180000, so nothing is capped and the whole combined wage is
    taxed — 230000x.062, not the aggregate model's 180000x.062."""
    inputs = dict(MFJ_HOUSEHOLD) | {
        "latest_w2_income": D("230000"),
        "other_w2_income": D("0"),
        "trad_401k_contributions": D("0"),
        "hsa_contributions": D("0"),
        "hsa_contributions_employer": D("0"),
        "other_pretax_deductions": D("0"),
    }
    earners = [EarnerWages(w2_wages=D("120000")), EarnerWages(w2_wages=D("110000"))]
    breakdown = compute_breakdown(
        MFJ_YEAR, inputs, MFJ_BRACKETS, filing_status=MARRIED_JOINT, earners=earners
    )
    assert breakdown.social_security.taxable_wages == D("230000")
    assert cents(breakdown.social_security.tax) == D("14260.00")
    assert cents(breakdown.disability.tax) == D("2300.00")  # 230000 x .01, both under cap


def test_one_earner_over_the_wage_base_caps_only_that_earner():
    inputs = dict(MFJ_HOUSEHOLD) | {
        "latest_w2_income": D("260000"),
        "other_w2_income": D("0"),
        "trad_401k_contributions": D("0"),
        "hsa_contributions": D("0"),
        "hsa_contributions_employer": D("0"),
        "other_pretax_deductions": D("0"),
    }
    earners = [EarnerWages(w2_wages=D("200000")), EarnerWages(w2_wages=D("60000"))]
    breakdown = compute_breakdown(
        MFJ_YEAR, inputs, MFJ_BRACKETS, filing_status=MARRIED_JOINT, earners=earners
    )
    # 180000 (capped) + 60000 (whole) reported; 11160 + 3720 taxed.
    assert breakdown.social_security.taxable_wages == D("240000")
    assert cents(breakdown.social_security.tax) == D("14880.00")
    # SDI's pseudo-cap is per person too: A stops at 200000, B brings all 60000.
    assert cents(breakdown.disability.tax) == D("2600.00")
    assert breakdown.disability.taxable_wages == D("260000")  # reported UNCAPPED, as today


def test_sdi_subtracts_dental_and_vision_but_not_hsa_per_earner():
    """The CA quirk survives the per-earner split: SS/Medicare net HSA out, SDI does not."""
    breakdown = mfj_breakdown()
    # A: 200000 - 300; B: 100000 - 200.
    assert breakdown.disability.taxable_wages == D("199700") + D("99800")
    # A: 200000 - (6000 + 300); B: 100000 - (0 + 200).
    assert breakdown.medicare.taxable_wages == D("193700") + D("99800")


# --------------------------------------------------------------------------------------
# NIIT advisory thresholds by status
# --------------------------------------------------------------------------------------

BASE_CG = [(D("0"), D("0")), (D("0.15"), D("100000")), (D("0.20"), D("600000"))]


def test_niit_threshold_follows_the_filing_status():
    # 220000 is above single's 200000 but at or below MFJ's 250000.
    assert niit_advisory(D("220000"), BASE_CG, SINGLE) is not None
    assert niit_advisory(D("220000"), BASE_CG, MARRIED_JOINT) is None
    # 150000 is below single's threshold but above MFS's 125000.
    assert niit_advisory(D("150000"), BASE_CG, SINGLE) is None
    assert niit_advisory(D("150000"), BASE_CG, MARRIED_SEPARATE) is not None
    # The message names the threshold that was actually applied.
    assert "250000" in niit_advisory(D("300000"), BASE_CG, MARRIED_JOINT)
    assert "125000" in niit_advisory(D("150000"), BASE_CG, MARRIED_SEPARATE)
    # An unknown status degrades to single's constant rather than raising: the engine is a
    # pure function over stored data and never rejects it.
    assert niit_advisory(D("220000"), BASE_CG, "nonsense") is not None


def test_niit_status_reaches_the_breakdown_warnings():
    tables = dict(MFJ_BRACKETS) | {"capital_gains": BASE_CG}
    joint = compute_breakdown(
        MFJ_YEAR, MFJ_INPUTS, tables, filing_status=MARRIED_JOINT, earners=MFJ_EARNERS
    )
    # AGI 266500 > 250000, so the stored 0.15/0.20 pair contradicts the NIIT rule.
    flagged = [w for w in joint.warnings if w.startswith("capital-gains rates 0.15/0.2 contradict")]
    assert len(flagged) == 1
    assert "250000" in flagged[0]
```

- [ ] **Step 3.2: Run — expect failure** — `cd backend && .venv/Scripts/python.exe -m pytest tests/test_tax_service_married.py -q`
Expected: collection error — `ImportError: cannot import name 'EarnerWages' from 'app.services.tax_service'`.

- [ ] **Step 3.3a: Imports** — `backend/app/services/tax_service.py` `:29-32` becomes:

```python
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal

from app.tax_keys import JURISDICTIONS, MARRIED_JOINT, MARRIED_SEPARATE, SINGLE
```

- [ ] **Step 3.3b: NIIT thresholds** — replace line `:51` (`NIIT_AGI_THRESHOLD = Decimal("200000")`), keeping the constant itself because the shipped advisory tests read its value:

```python
NIIT_AGI_THRESHOLD = Decimal("200000")
# Statutory and non-indexed (audit §5), so constants rather than data: MFJ is 250000 and
# MFS 125000, neither of which is "2x single". An unknown status reads single's figure —
# this is a pure read over stored data and must never raise on it.
NIIT_AGI_THRESHOLDS: dict[str, Decimal] = {
    SINGLE: NIIT_AGI_THRESHOLD,
    MARRIED_JOINT: Decimal("250000"),
    MARRIED_SEPARATE: Decimal("125000"),
}
```

- [ ] **Step 3.3c: AGI helper + the earner bundle** — insert immediately after `stack()` (after `:144`, before `@dataclass class JurisdictionResult`):

```python
def _federal_agi(value: Callable[[str], Decimal]) -> Decimal:
    """Federal AGI, the sheet's clean model (rows 96-99).

    ONE definition with two consumers: `compute_breakdown`'s income chain and the SALT
    phase-down's MAGI in `derive_suggestions`. Term order is the canonical formula's, so
    the goldens pin it to the cent. capital_loss_deductions is deliberately absent — the
    sheet models it as a line but no output formula ever reads it.
    """
    return (
        value("latest_w2_income")
        + value("other_w2_income")
        + value("stcg_total")
        + value("unqualified_dividends")
        + value("interest_total")
        + value("other_income_1099")
    ) - (
        value("trad_401k_contributions")
        + value("hsa_contributions")
        + value("hsa_contributions_employer")
        + value("other_pretax_deductions")
    )


@dataclass(frozen=True)
class EarnerWages:
    """One person's W-2 wage bundle for the per-earner payroll walks (spec §5.3).

    THREE fields, not one, because the sheet's FICA bases differ per family: Social
    Security and Medicare run on wages net of HSA *and* the other pre-tax deductions,
    while CA SDI subtracts dental/vision alone (the CA quirk in the FICA note below). A
    single `w2_wages` scalar could not reproduce both, so each earner carries the two
    pre-tax legs and the engine derives the bases here — one definition, two consumers,
    exactly as the aggregate path did.
    """

    w2_wages: Decimal
    pretax_hsa: Decimal = ZERO
    other_pretax: Decimal = ZERO

    @property
    def fica_wages(self) -> Decimal:
        """The Medicare / Social Security base for this person."""
        return self.w2_wages - (self.pretax_hsa + self.other_pretax)

    @property
    def sdi_wages(self) -> Decimal:
        """The CA SDI base: dental/vision out, HSA deliberately left IN."""
        return self.w2_wages - self.other_pretax


def earner_from_inputs(values: Mapping[str, Decimal]) -> EarnerWages:
    """One person's bundle from THEIR OWN input rows — the exact composition
    `compute_breakdown` synthesizes when `earners` is None, so the API can build a
    two-earner list without a second definition of "what a W-2 is"."""

    def value(key: str) -> Decimal:
        found = values.get(key)
        return ZERO if found is None else found

    return EarnerWages(
        w2_wages=value("latest_w2_income") + value("other_w2_income"),
        pretax_hsa=value("hsa_contributions") + value("hsa_contributions_employer"),
        other_pretax=value("other_pretax_deductions"),
    )
```

- [ ] **Step 3.3d: `niit_advisory`** — replace `:198-224` entirely:

```python
def niit_advisory(
    fed_agi: Decimal, cg_brackets: list[Bracket], filing_status: str = SINGLE
) -> str | None:
    """Flag stored CG rates that contradict the sheet's AGI-driven NIIT rule.

    Returns None when the table is too short to carry both rates (nothing to compare) or
    when the stored pair already matches. Never edits the brackets: the engine walks what
    is stored, verbatim. The threshold is the filing status's (200k / 250k / 125k) — an
    unknown status reads single's, because a GET must never fail on stored data.
    """
    if len(cg_brackets) < 3:
        return None
    threshold = NIIT_AGI_THRESHOLDS.get(filing_status, NIIT_AGI_THRESHOLD)
    ordered = sorted(cg_brackets, key=lambda bracket: bracket[1])
    stored = (ordered[1][0], ordered[2][0])
    above = fed_agi > threshold
    expected = NIIT_RATES if above else BASE_CG_RATES
    if stored == expected:
        return None
    # Stored rates arrive at the column's Numeric(7,4) scale, so normalize before rendering:
    # 0.1500 and a hand-typed 0.15 are the same rate and must produce the same message. The
    # EXPECTED pair is normalized identically — otherwise the constants' own scale leaks
    # into the text and the message reads "0.15/0.2 ... implies 0.15/0.20".
    return NIIT_WARNING.format(
        stored=stored[0].normalize(),
        stored_top=stored[1].normalize(),
        side="above" if above else "at or below",
        threshold=threshold,
        expected=expected[0].normalize(),
        expected_top=expected[1].normalize(),
    )
```

- [ ] **Step 3.3e: `compute_breakdown` signature + docstring** — replace `:227-238`:

```python
def compute_breakdown(
    year: int,
    inputs: dict[str, Decimal],
    brackets: dict[str, list[Bracket]],
    *,
    filing_status: str = SINGLE,
    earners: list[EarnerWages] | None = None,
) -> TaxBreakdown:
    """The canonical model, per the Plan 5 Workbook reference.

    Missing input keys default to 0 (an empty sheet cell IS a zero) and are reported once,
    in form order. A jurisdiction that is missing — or explicitly stored as an empty
    bracket list — yields 0 tax plus a warning. Effective rates are full-precision ratios,
    None when the denominator is 0; the schema layer quantizes.

    `filing_status` selects nothing here but the NIIT advisory's threshold: every OTHER
    status-dependent number lives in the bracket TABLES the caller selected, which is why
    a wrong-status table is refused upstream rather than compensated for down here.

    `earners` is the per-person wage split the payroll walks need (2026-08-26 spec §5.3).
    With None the engine synthesizes the single bundle from `inputs` exactly as it always
    did, so the whole default path — and the golden suite — is byte-identical. An EMPTY
    list is not "one earner with nothing": it means no wage data at all, and reads like a
    year with no W-2.
    """
```

- [ ] **Step 3.3f: shared AGI** — replace `:262-274` (the whole `fed_agi = (...)` expression) with:

```python
    # Federal (sheet rows 96-99). capital_loss_deductions (r27) is modelled as a line but
    # no output formula ever reads it — ported faithfully, so it does NOT reach AGI.
    fed_agi = _federal_agi(values.__getitem__)
```

(`values` carries every `ENGINE_INPUT_KEYS` entry by construction a few lines above, so
`__getitem__` cannot miss — and it keeps the arithmetic term-for-term identical.)

- [ ] **Step 3.3g: the FICA block** — replace `:310-334` (from the `# FICA (rows 104-115)` comment through `sdi_tax = walk(...)`) with:

```python
    # FICA (rows 104-115): the wage bases deliberately keep trad-401k in — it is pre-tax
    # for income tax only. SDI subtracts dental/vision alone, not HSA (the CA quirk).
    # One earner or many, the REPORTED aggregates are identical sums; what changes is
    # where the per-person caps bite (2026-08-26 spec §5.3).
    bundles = [earner_from_inputs(values)] if earners is None else list(earners)
    w2_income = sum((earner.w2_wages for earner in bundles), ZERO)
    # Medicare is a COMBINED-wage walk on purpose, and its shape is unchanged: the 1.45%
    # base is linear, and the 0.9% additional tier is legally assessed on COMBINED wages
    # above the status threshold (Form 8959). Correctness therefore comes from the
    # status-selected medicare table (MFJ's tier at 250k, MFS's at 125k), never from
    # splitting the wages — a per-person split would UNDER-charge a two-earner couple.
    medicare_wages = sum((earner.fica_wages for earner in bundles), ZERO)
    medicare_tax = walk(tables["medicare"], medicare_wages)

    # The SS wage base is modelled as a terminal 0-rate bracket; r109's min() makes the cap
    # explicit so taxable_wages reads as the capped figure the sheet displays. It is
    # tax-neutral by construction (income inside a 0-rate bracket contributes nothing), and
    # it is only a cap when that top rate really is 0 — a table without the terminal row,
    # or with a genuinely progressive top tier, reports (and taxes) uncapped wages. The cap
    # is PER PERSON: two earners get two wage bases, which is the single worst wrong-money
    # consequence of the old shared figure (audit §3.2).
    ss_table = tables["social_security"]
    ss_cap: Decimal | None = None
    if len(ss_table) > 1:
        top_rate, top_threshold = max(ss_table, key=lambda bracket: bracket[1])
        if top_rate == 0:
            ss_cap = top_threshold
    ss_bases = [
        earner.fica_wages if ss_cap is None else min(earner.fica_wages, ss_cap)
        for earner in bundles
    ]
    ss_wages = sum(ss_bases, ZERO)
    ss_tax = sum((walk(ss_table, base) for base in ss_bases), ZERO)

    # SDI likewise walks per earner (the sheet-derived data carries a pseudo-cap row, and a
    # cap is a per-person parameter), while the REPORTED taxable_wages stays the uncapped
    # aggregate the sheet displays — pinned by the 2024 golden's 235424.46.
    sdi_table = tables["disability"]
    sdi_wages = sum((earner.sdi_wages for earner in bundles), ZERO)
    sdi_tax = sum((walk(sdi_table, earner.sdi_wages) for earner in bundles), ZERO)
```

- [ ] **Step 3.3h: the advisory call** — `:356` becomes:

```python
    advisory = niit_advisory(fed_agi, tables["capital_gains"], filing_status)
```

- [ ] **Step 3.4: Run to pass** — `cd backend && .venv/Scripts/python.exe -m pytest tests/test_tax_service_married.py -q`
Expected: 14 passed (4 parametrized identity cases + 10 others).
- [ ] **Step 3.5: RUN GOLDENS** — `cd backend && .venv/Scripts/python.exe -m pytest tests/test_tax_service.py -q`
Expected: **52 passed**, and `git diff --stat backend/tests/test_tax_service.py` prints NOTHING. If a golden moved, the refactor was not mechanical — revert the FICA block and re-derive; never edit the pin.
- [ ] **Step 3.6: Downstream check** — `cd backend && .venv/Scripts/python.exe -m pytest tests/test_money_flow.py tests/test_tax_whatif.py tests/test_taxes_api.py tests/test_withholding_api.py tests/test_overview_api.py -q`
Expected: all pass unchanged (every new parameter is keyword-only with a default).
- [ ] **Step 3.7: Lint** — `cd backend && .venv/Scripts/python.exe -m ruff check app tests && .venv/Scripts/python.exe -m ruff format app tests`
- [ ] **Step 3.8: Commit** — `git add backend/app/services/tax_service.py backend/tests/test_tax_service_married.py && git commit -m "feat(taxes): per-earner social security and SDI walks, status-aware NIIT advisory"`

---

### Task 4: Engine — status-aware `derive_suggestions` (SALT cap + phase-down, capital-loss clamp)

**Files:**
- Modify: `backend/app/services/tax_service.py` (constants `:60-62`, `derive_suggestions` `:409-466`)
- Modify: `backend/tests/test_tax_service_married.py` (append)
- Modify: `backend/tests/test_tax_service.py` — **the ONE sanctioned golden edit in this plan** (Step 4.5)

> **Read the golden gate section again before starting.** `compute_breakdown`'s outputs do not move in this task, at all. One *suggestion* pin moves, by approved design (spec §5.3), and its old value is preserved as an explicit pre-clamp assertion so the netting rule stays pinned.

- [ ] **Step 4.1: Write the failing tests** — append to `backend/tests/test_tax_service_married.py`:

```python
# --------------------------------------------------------------------------------------
# derive_suggestions: SALT cap by status + the OBBBA phase-down, capital-loss clamp
# --------------------------------------------------------------------------------------

from app.services.tax_service import derive_suggestions, salt_cap  # noqa: E402

SALT_ITEMS = {
    "itemized_salt": D("50000"),
    "itemized_donations": D("0"),
    "itemized_vehicle_reg": D("0"),
    "itemized_sec199a_div": D("0"),
    "itemized_other": D("0"),
}


def salt_year(year: int, status: str, magi: Decimal) -> Decimal:
    """The itemized suggestion with 50000 of SALT and one W-2 line carrying the MAGI, so
    the answer IS the applied cap."""
    inputs = dict(SALT_ITEMS) | {"latest_w2_income": magi}
    return derive_suggestions(year, inputs, status)["itemized_deduction"]


def test_salt_cap_halves_for_married_filing_separately():
    # Below every phase-down threshold, so this is the base cap alone.
    assert salt_year(2024, SINGLE, D("0")) == D("10000")
    assert salt_year(2024, MARRIED_SEPARATE, D("0")) == D("5000")
    assert salt_year(2025, SINGLE, D("0")) == D("40000")
    assert salt_year(2025, MARRIED_JOINT, D("0")) == D("40000")  # MFJ is NOT 2x single
    assert salt_year(2025, MARRIED_SEPARATE, D("0")) == D("20000")


def test_salt_phase_down_boundaries():
    # Strictly ">": exactly 500000 of MAGI keeps the whole cap.
    assert salt_year(2025, SINGLE, D("500000")) == D("40000")
    # 40000 - 30% x 50000 = 25000.
    assert salt_year(2025, SINGLE, D("550000")) == D("25000")
    # 40000 - 30% x 100000 = 10000, exactly the floor.
    assert salt_year(2025, SINGLE, D("600000")) == D("10000")
    # Far past it: the floor holds rather than going negative.
    assert salt_year(2025, SINGLE, D("900000")) == D("10000")
    # MFS halves the threshold, the cap AND the floor: 20000 - 30% x 50000 = 5000.
    assert salt_year(2025, MARRIED_SEPARATE, D("250000")) == D("20000")
    assert salt_year(2025, MARRIED_SEPARATE, D("300000")) == D("5000")
    assert salt_year(2025, MARRIED_SEPARATE, D("400000")) == D("5000")
    # Pre-2025 the cap is already the floor, so no phase-down applies at any MAGI.
    assert salt_year(2024, SINGLE, D("900000")) == D("10000")
    assert salt_year(2024, MARRIED_SEPARATE, D("900000")) == D("5000")


def test_salt_cap_reads_the_engine_definition_of_agi():
    """MAGI is the engine's own federal AGI — pre-tax deductions pull it down, so a
    401(k) can rescue the cap. One AGI definition, two consumers."""
    assert salt_cap(2025, SINGLE, D("560000")) == D("22000")
    inputs = dict(SALT_ITEMS) | {
        "latest_w2_income": D("560000"),
        "trad_401k_contributions": D("60000"),
    }
    # AGI 500000 -> no phase-down at all.
    assert derive_suggestions(2025, inputs, SINGLE)["itemized_deduction"] == D("40000")


def test_salt_cap_never_raises_the_suggestion_above_the_entered_amount():
    """The cap is a ceiling, not a floor: 3000 of SALT stays 3000 under a 40000 cap."""
    items = dict(SALT_ITEMS) | {"itemized_salt": D("3000"), "itemized_donations": D("250")}
    assert derive_suggestions(2025, items, SINGLE)["itemized_deduction"] == D("3250")


def test_capital_loss_suggestion_is_clamped_by_status():
    """The deductible loss per return: 3000, or 1500 filing separately (spec §5.3). The
    ENGINE's AGI math is untouched — capital_loss_deductions stays out of
    ENGINE_INPUT_KEYS, which is what keeps the goldens byte-identical."""
    big = {"ltcg_total": D("-5000"), "stcg_standard": D("1000")}  # nets to -4000
    assert derive_suggestions(2025, big, SINGLE)["capital_loss_deductions"] == D("-3000")
    assert derive_suggestions(2025, big, MARRIED_JOINT)["capital_loss_deductions"] == D("-3000")
    assert derive_suggestions(2025, big, MARRIED_SEPARATE)["capital_loss_deductions"] == D("-1500")

    # A loss under the cap is untouched, and MFS clamps it only once it passes 1500.
    small = {"ltcg_total": D("-1000")}
    assert derive_suggestions(2025, small, SINGLE)["capital_loss_deductions"] == D("-1000")
    assert derive_suggestions(2025, small, MARRIED_SEPARATE)["capital_loss_deductions"] == D("-1000")
    mid = {"ltcg_total": D("-2000")}
    assert derive_suggestions(2025, mid, SINGLE)["capital_loss_deductions"] == D("-2000")
    assert derive_suggestions(2025, mid, MARRIED_SEPARATE)["capital_loss_deductions"] == D("-1500")

    # A gain still suggests 0, not a clamp.
    assert derive_suggestions(2025, {"ltcg_total": D("500")}, SINGLE)[
        "capital_loss_deductions"
    ] == D("0")


def test_capital_loss_clamp_never_reaches_the_engine():
    """The clamp is advisory only: feeding the UNCLAMPED loss to the engine changes
    nothing, because the key is not an engine input."""
    inputs = dict(MFJ_INPUTS) | {"capital_loss_deductions": D("-99999")}
    assert compute_breakdown(
        MFJ_YEAR, inputs, MFJ_BRACKETS, filing_status=MARRIED_JOINT, earners=MFJ_EARNERS
    ).federal.agi == mfj_breakdown().federal.agi


def test_derive_suggestions_defaults_to_single():
    """No status argument is single's answer — the shipped call sites (and the golden
    suite) pass two arguments and must keep meaning what they meant."""
    items = dict(SALT_ITEMS) | {"itemized_salt": D("50000")}
    assert derive_suggestions(2025, items) == derive_suggestions(2025, items, SINGLE)
```

> The mid-file `import` is deliberate and ruff-silenced with `# noqa: E402`; if the reviewer prefers, hoist `derive_suggestions` and `salt_cap` into the module's top import block instead and drop the noqa. Either is fine — do not leave both.

- [ ] **Step 4.2: Run — expect failure** — `cd backend && .venv/Scripts/python.exe -m pytest tests/test_tax_service_married.py -q`
Expected: `ImportError: cannot import name 'salt_cap'`.

- [ ] **Step 4.3a: Constants** — replace `backend/app/services/tax_service.py` `:60-62`:

```python
SALT_CAP_FIRST_RAISED_YEAR = 2025
SALT_CAP_BEFORE = Decimal("10000")
SALT_CAP_FROM = Decimal("40000")
# OBBBA's phase-down of the RAISED cap: above 500000 of MAGI the cap sheds 30 cents per
# dollar, never falling below the 10000 base. Statutory constants in code, bracket values
# as data — the same split the SALT cap itself has always used.
SALT_PHASEDOWN_MAGI = Decimal("500000")
SALT_PHASEDOWN_RATE = Decimal("0.30")
SALT_PHASEDOWN_FLOOR = Decimal("10000")
# The deductible capital LOSS per return. This clamps the SUGGESTION only: the engine's
# AGI math never reads capital_loss_deductions (it is deliberately absent from
# ENGINE_INPUT_KEYS), so the goldens' breakdowns cannot move.
CAPITAL_LOSS_LIMIT = Decimal("3000")
# Married-filing-separately halves the per-return statutory figures.
MFS_HALF = Decimal("2")
```

- [ ] **Step 4.3b: `salt_cap`** — add immediately above `derive_suggestions` (`:409`):

```python
def salt_cap(year: int, filing_status: str, magi: Decimal) -> Decimal:
    """The SALT deduction cap the itemized suggestion applies (spec §5.3).

    The sheet hardcodes the cap per column (10000 through 2024, 40000 after) and this
    keeps doing that; what it adds is the two statutory dimensions the sheet never had —
    MFS halving, and the >500k-MAGI phase-down of the raised cap. Pre-2025 there is no
    phase-down to apply: the cap already sits at the floor.
    """
    cap = SALT_CAP_FROM if year >= SALT_CAP_FIRST_RAISED_YEAR else SALT_CAP_BEFORE
    threshold = SALT_PHASEDOWN_MAGI
    floor = SALT_PHASEDOWN_FLOOR
    if filing_status == MARRIED_SEPARATE:
        cap /= MFS_HALF
        threshold /= MFS_HALF
        floor /= MFS_HALF
    if year >= SALT_CAP_FIRST_RAISED_YEAR and magi > threshold:
        phased = cap - SALT_PHASEDOWN_RATE * (magi - threshold)
        cap = phased if phased > floor else floor
    return cap
```

- [ ] **Step 4.3c: `derive_suggestions`** — replace `:409-466` entirely:

```python
def derive_suggestions(
    year: int, inputs: dict[str, Decimal], filing_status: str = SINGLE
) -> dict[str, Decimal]:
    """Advisory values for the sheet's gray (formula) input cells, quantized 4dp HALF_UP.

    Computed from the STORED values of the referenced keys — sheet-faithful, because the
    gray formulas reference cells rather than recursing. Missing references default to 0
    (an empty cell is a zero), so all ten suggestions are always offered; the caller
    decides whether to surface a chip. Never applied automatically.

    Two of the ten are status-aware (spec §5.3): the SALT slice of the itemized total, and
    the capital-loss line, which the statute caps per RETURN at 3000 (1500 filing
    separately) however large the netted loss is. Both are SUGGESTIONS — the engine's own
    arithmetic is status-neutral and unchanged, so a status flip never silently rewrites a
    stored number.

    The derived-W2 chain (gross_paycheck / latest_w2_income / other_w2_income) is one
    PERSON's, so the caller feeds one person's rows at a time (api/taxes.py builds a
    suggestion map per column); the household keys it also reads are shared and give the
    same answer in every column.
    """

    def value(key: str) -> Decimal:
        found = inputs.get(key)
        return ZERO if found is None else found

    # `s` is the short-term line the sheet nets the long-term loss against.
    short_term = value("stcg_standard") + value("stcg_espp_component")
    ltcg = value("ltcg_total")
    netted = short_term + ltcg
    if short_term >= 0 and ltcg < 0 and netted >= 0:
        stcg_total = netted
    elif short_term >= 0 and netted >= 0:
        stcg_total = short_term
    else:
        stcg_total = ZERO

    # r27 carries the un-nettable remainder of the loss, so it is negative or zero — and
    # only the deductible slice of it is worth suggesting.
    loss_limit = CAPITAL_LOSS_LIMIT
    if filing_status == MARRIED_SEPARATE:
        loss_limit /= MFS_HALF
    if netted < 0:
        capital_loss = netted if netted > -loss_limit else -loss_limit
    else:
        capital_loss = ZERO

    # The SALT cap is hardcoded per column in the sheet (10000 through 2024, 40000 after);
    # `salt_cap` adds the MFS halving and the >500k-MAGI phase-down. MAGI is the engine's
    # own federal AGI — the same definition compute_breakdown walks.
    cap = salt_cap(year, filing_status, _federal_agi(value))
    salt = value("itemized_salt")
    itemized = (salt if salt < cap else cap) + (
        value("itemized_donations")
        + value("itemized_vehicle_reg")
        + value("itemized_sec199a_div")
        + value("itemized_other")
    )

    suggestions = {
        "gross_paycheck": value("annual_salary") / PAYCHECKS_PER_YEAR,
        "latest_w2_income": value("pay_periods") * value("gross_paycheck"),
        "other_w2_income": (
            value("w2_stock_rsus_sold")
            + value("w2_bonuses")
            + value("w2_salary_checkpoint")
            + value("w2_espp_sale_component")
            + value("w2_employer_hsa")
            + value("w2_other")
        ),
        "stcg_total": stcg_total,
        "unqualified_dividends": value("unq_div_us_treasuries_etf") + value("unq_div_other"),
        "interest_total": value("interest_standard") + value("interest_us_treasuries"),
        "capital_loss_deductions": capital_loss,
        "other_pretax_deductions": value("pretax_dental") + value("pretax_vision"),
        "itemized_deduction": itemized,
        "ltcg_total": value("ltcg_brokerage") + value("ltcg_espp_component"),
    }
    return {
        key: suggestions[key].quantize(SUGGESTION_QUANTUM, rounding=ROUND_HALF_UP)
        for key in SUGGESTION_KEYS
    }
```

- [ ] **Step 4.4: Run the new tests** — `cd backend && .venv/Scripts/python.exe -m pytest tests/test_tax_service_married.py -q`
Expected: 21 passed.

- [ ] **Step 4.5: THE ONE SANCTIONED GOLDEN EDIT** — `backend/tests/test_tax_service.py`, `test_suggestion_capital_loss_negative` (around `:660`). Replace exactly this body:

```python
def test_suggestion_capital_loss_negative():
    inputs = {"ltcg_total": Decimal("-5000"), "stcg_standard": Decimal("1000")}
    suggested = derive_suggestions(2025, inputs)
    assert suggested["capital_loss_deductions"] == Decimal("-4000")
    assert suggested["stcg_total"] == Decimal("0")  # the loss lands on r27, not the STCG line
```

with:

```python
def test_suggestion_capital_loss_negative():
    """The netting rule is unchanged; the SUGGESTION is now clamped to the statutory
    3000 per return (2026-08-26 spec §5.3 — an approved behavior change, not a bug fix:
    the sheet offered the whole un-nettable remainder). The engine still never reads this
    key, so no breakdown moved."""
    inputs = {"ltcg_total": Decimal("-5000"), "stcg_standard": Decimal("1000")}
    suggested = derive_suggestions(2025, inputs)
    # The un-nettable remainder is still -4000 — the STCG line proves the netting ran.
    assert suggested["stcg_total"] == Decimal("0")  # the loss lands on r27, not the STCG line
    assert suggested["capital_loss_deductions"] == Decimal("-3000")
```

**Nothing else in `test_tax_service.py` may change.** Verify with `git diff --stat backend/tests/test_tax_service.py` → exactly one file, and `git diff backend/tests/test_tax_service.py` → only this function.

- [ ] **Step 4.6: RUN GOLDENS** — `cd backend && .venv/Scripts/python.exe -m pytest tests/test_tax_service.py -q`
Expected: 52 passed. In particular `test_suggestions_match_stored_2025` (fed AGI 259376.05, well under 500000 → cap unchanged at 40000), `test_suggestion_salt_cap_2024_vs_2025` (MAGI 0 → no phase-down) and every `compute_breakdown` golden must pass **untouched**.
- [ ] **Step 4.7: Downstream check** — `cd backend && .venv/Scripts/python.exe -m pytest tests/test_taxes_api.py tests/test_tax_whatif.py -q`
Expected: all pass. `_inputs_payload` still calls `derive_suggestions(year, stored)` — the default keeps it single.
- [ ] **Step 4.8: Lint** — `cd backend && .venv/Scripts/python.exe -m ruff check app tests && .venv/Scripts/python.exe -m ruff format app tests`
- [ ] **Step 4.9: Commit** — `git add backend/app/services/tax_service.py backend/tests/test_tax_service_married.py backend/tests/test_tax_service.py && git commit -m "feat(taxes): status-aware SALT cap with the >500k phase-down, statutory capital-loss clamp"`

---

### Task 5: API — the status-aware engine feed, `PATCH /years/{year}`, summary + trend gating

**Files:**
- Modify: `backend/app/schemas/taxes.py` (`TaxYearOut` `:15-19`, `TaxSummaryOut` `:100-109`, `TaxSummariesOut` `:112-113`; new `FilingStatus`, `TaxYearUpdate`, `IncompleteYearOut`)
- Modify: `backend/app/api/taxes.py` (imports `:38-101`, `_stored_inputs`/`_engine_tables` `:134-157`, `list_years` `:205-222`, `get_summary` `:509-513`, `get_all_summaries` `:516-546`, `_summary_out` `:475-506`)
- Modify: `backend/tests/test_taxes_api.py`

- [ ] **Step 5.1: Write the failing tests** — append to `backend/tests/test_taxes_api.py` (and update the ONE dict-equality assertion noted in Step 5.2):

```python
# --- filing status ---


@pytest.fixture
async def household(db):
    """Me + Partner. `create_all` seeds no people, so every OTHER test in this file runs
    on an empty roster — which is exactly the pre-household spelling the API still has to
    support."""
    from app.models import Person

    me = Person(name="Me", is_primary=True)
    partner = Person(name="Partner", is_primary=False)
    db.add_all([me, partner])
    await db.commit()
    return me, partner


async def set_status(auth_client, year: int, status: str) -> dict:
    resp = await auth_client.patch(f"{YEARS}/{year}", json={"filing_status": status})
    assert resp.status_code == 200, resp.text
    return resp.json()


async def test_years_default_to_single_and_patch_sets_the_status(auth_client, definitions):
    await put_inputs(auth_client, 2026, {"annual_salary": "150000"})
    assert (await auth_client.get(YEARS)).json()[0]["filing_status"] == "single"

    body = await set_status(auth_client, 2026, "married_joint")
    assert body == {
        "year": 2026,
        "notes": None,
        "filing_status": "married_joint",
        "input_count": 1,
        "bracket_count": 0,
    }
    assert (await auth_client.get(YEARS)).json()[0]["filing_status"] == "married_joint"


async def test_patch_year_rejects_unknown_status_and_missing_year(auth_client, definitions):
    await put_inputs(auth_client, 2026, {})
    bad = await auth_client.patch(f"{YEARS}/2026", json={"filing_status": "widow"})
    assert bad.status_code == 422
    assert (await auth_client.get(YEARS)).json()[0]["filing_status"] == "single"
    # No auto-create: a status is a statement ABOUT a year that must already exist.
    missing = await auth_client.patch(f"{YEARS}/2027", json={"filing_status": "married_joint"})
    assert missing.status_code == 404
    assert "2027" in missing.json()["detail"]


async def test_single_summary_shape_is_unchanged(auth_client, definitions):
    """The additive keys, and nothing else: a single year still carries every section."""
    await put_inputs(auth_client, 2024, inputs_payload(2024))
    await put_brackets(auth_client, 2024, brackets_payload(2024)["jurisdictions"])

    body = (await auth_client.get(f"{YEARS}/2024/summary")).json()
    assert body["filing_status"] == "single"
    assert body["brackets_missing_for_status"] == []
    assert body["totals"]["total_tax"] == "72755.83"


async def test_single_year_with_no_brackets_still_computes(auth_client, definitions):
    """The grandfathered path: 'single' NEVER gates. A partial single-filer year has
    always computed with per-jurisdiction warnings, and stored history depends on it."""
    await put_inputs(auth_client, 2033, {"latest_w2_income": "1000"})

    body = (await auth_client.get(f"{YEARS}/2033/summary")).json()
    assert body["brackets_missing_for_status"] == []
    assert body["totals"]["total_tax"] == "0.00"
    assert JURISDICTION_WARN_MISSING.format(j="federal", year=2033) in body["warnings"]


async def test_married_year_without_its_tables_refuses_to_compute(auth_client, definitions):
    """Never garbage, never a 500: the single-filer tables are RIGHT THERE and would
    produce a confident, wrong number."""
    await put_inputs(auth_client, 2026, inputs_payload(2026))
    await put_brackets(auth_client, 2026, brackets_payload(2026)["jurisdictions"])
    await set_status(auth_client, 2026, "married_joint")

    resp = await auth_client.get(f"{YEARS}/2026/summary")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["year"] == 2026
    assert body["filing_status"] == "married_joint"
    assert body["brackets_missing_for_status"] == list(JURISDICTIONS)
    for section in ("federal", "state", "medicare", "social_security", "disability",
                    "capital_gains", "totals"):
        assert body[section] is None, section
    assert body["warnings"] == [
        "2026 is filed as married_joint and has no married_joint bracket table for: "
        "federal, state, medicare, social_security, disability, capital_gains"
    ]


async def test_married_year_reports_only_the_missing_tables(auth_client, definitions):
    await put_inputs(auth_client, 2026, inputs_payload(2026))
    await set_status(auth_client, 2026, "married_joint")
    await auth_client.put(
        f"{YEARS}/2026/brackets",
        json={
            "filing_status": "married_joint",
            "jurisdictions": {"federal": rows(("0.10", "0")), "state": rows(("0.05", "0"))},
        },
    )
    body = (await auth_client.get(f"{YEARS}/2026/summary")).json()
    assert body["brackets_missing_for_status"] == [
        "medicare",
        "social_security",
        "disability",
        "capital_gains",
    ]
    assert body["totals"] is None


async def test_trend_feed_skips_and_names_the_refused_years(auth_client, definitions):
    await put_inputs(auth_client, 2024, inputs_payload(2024))
    await put_brackets(auth_client, 2024, brackets_payload(2024)["jurisdictions"])
    await put_inputs(auth_client, 2026, inputs_payload(2026))
    await put_brackets(auth_client, 2026, brackets_payload(2026)["jurisdictions"])
    await set_status(auth_client, 2026, "married_separate")

    body = (await auth_client.get(ALL_SUMMARY)).json()
    assert [year["year"] for year in body["years"]] == [2024]  # 2026 cannot be drawn
    assert body["incomplete"] == [
        {
            "year": 2026,
            "filing_status": "married_separate",
            "brackets_missing_for_status": list(JURISDICTIONS),
        }
    ]


async def test_married_joint_sums_both_people_and_splits_the_wage_base(
    auth_client, db, household, definitions
):
    """The end-to-end wrong-money fix: two W-2s, two Social-Security wage bases."""
    me, partner = household
    await auth_client.put(
        f"{YEARS}/2026/inputs",
        json={
            "rows": [
                {"key": "latest_w2_income", "person_id": me.id, "value": "200000"},
                {"key": "latest_w2_income", "person_id": partner.id, "value": "100000"},
            ]
        },
    )
    tables = {
        "federal": rows(("0.10", "0")),
        "state": rows(("0.05", "0")),
        "medicare": rows(("0.0145", "0")),
        "social_security": rows(("0.062", "0"), ("0", "180000")),
        "disability": rows(("0.01", "0")),
        "capital_gains": rows(("0.15", "0")),
    }
    for status in ("single", "married_joint"):
        resp = await auth_client.put(
            f"{YEARS}/2026/brackets", json={"filing_status": status, "jurisdictions": tables}
        )
        assert resp.status_code == 200, resp.text

    single = (await auth_client.get(f"{YEARS}/2026/summary")).json()
    # One shared wage base: min(300000, 180000) x .062.
    assert single["social_security"]["tax"] == "11160.00"
    assert single["social_security"]["w2_income"] == "200000.00"  # partner is off this return

    await set_status(auth_client, 2026, "married_joint")
    joint = (await auth_client.get(f"{YEARS}/2026/summary")).json()
    assert joint["social_security"]["w2_income"] == "300000.00"  # both W-2s now
    # 180000 x .062 + 100000 x .062 = 11160 + 6200.
    assert joint["social_security"]["tax"] == "17360.00"
    assert joint["social_security"]["taxable_wages"] == "280000.00"
    assert joint["medicare"]["taxable_wages"] == "300000.00"  # combined walk, as designed


async def test_married_separate_covers_the_primary_person_alone(
    auth_client, db, household, definitions
):
    """An MFS return carries one spouse's income. The partner's rows stay stored — they
    belong to the joint year — but they are not on THIS return."""
    me, partner = household
    await auth_client.put(
        f"{YEARS}/2026/inputs",
        json={
            "rows": [
                {"key": "latest_w2_income", "person_id": me.id, "value": "200000"},
                {"key": "latest_w2_income", "person_id": partner.id, "value": "100000"},
            ]
        },
    )
    await put_brackets(auth_client, 2026, {"medicare": rows(("0.0145", "0"))})
    await auth_client.put(
        f"{YEARS}/2026/brackets",
        json={
            "filing_status": "married_separate",
            "jurisdictions": {
                name: (rows(("0.0145", "0")) if name == "medicare" else rows(("0.10", "0")))
                for name in JURISDICTIONS
            },
        },
    )
    await set_status(auth_client, 2026, "married_separate")

    body = (await auth_client.get(f"{YEARS}/2026/summary")).json()
    assert body["medicare"]["w2_income"] == "200000.00"
    assert body["brackets_missing_for_status"] == []
```

- [ ] **Step 5.2: Update the ONE shipped dict-equality assertion** — `backend/tests/test_taxes_api.py`, `test_years_list_empty_then_reports_counts` (`:103-105`): both `TaxYearOut` dicts gain `"filing_status": "single"`:

```python
    assert body[0] == {
        "year": 2023,
        "notes": None,
        "filing_status": "single",
        "input_count": 0,
        "bracket_count": 0,
    }
    assert body[1] == {
        "year": 2024,
        "notes": "imported",
        "filing_status": "single",
        "input_count": 2,
        "bracket_count": 1,
    }
```

- [ ] **Step 5.3: Run — expect failure** — `cd backend && .venv/Scripts/python.exe -m pytest tests/test_taxes_api.py -q`
Expected: the new tests fail (405 on PATCH, `KeyError: 'filing_status'`), plus the two updated dicts.

- [ ] **Step 5.4: Schemas** — `backend/app/schemas/taxes.py`. Add the status alias at the top (after the imports) and edit the three models:

```python
from typing import Literal

from app.tax_keys import FILING_STATUSES, SINGLE

# The wire spelling of tax_keys.FILING_STATUSES. A Literal, not a str + validator, so
# FastAPI 422s an unknown status at the boundary with its own message; the constant tuple
# stays the source of truth and `test_filing_status_literal_matches_the_constant` pins the
# two together.
FilingStatus = Literal["single", "married_joint", "married_separate"]
```

```python
class TaxYearOut(BaseModel):
    year: int
    notes: str | None
    filing_status: str
    input_count: int
    bracket_count: int


class TaxYearUpdate(BaseModel):
    # One field this batch: notes are still importer-owned, and the bracket tables are
    # NOT moved by a status change (see the router docstring).
    filing_status: FilingStatus
```

```python
class TaxSummaryOut(BaseModel):
    year: int
    filing_status: str = SINGLE
    # Jurisdictions with NO bracket table under this year's filing status. Always empty
    # for 'single': a partial single-filer year has always computed, with per-jurisdiction
    # warnings, and stored history depends on that. Non-empty only for a married year
    # whose tables have not been entered yet — where every section below is null rather
    # than a confidently wrong zero computed against a single filer's brackets.
    brackets_missing_for_status: list[str] = Field(default_factory=list)
    federal: IncomeTaxOut | None = None
    state: IncomeTaxOut | None = None
    medicare: WageTaxOut | None = None
    social_security: WageTaxOut | None = None
    disability: WageTaxOut | None = None
    capital_gains: CapitalGainsTaxOut | None = None
    totals: TaxTotalsOut | None = None
    warnings: list[str]


class IncompleteYearOut(BaseModel):
    """A year the trend feed had to skip — named so the page can offer the fix."""

    year: int
    filing_status: str
    brackets_missing_for_status: list[str]


class TaxSummariesOut(BaseModel):
    years: list[TaxSummaryOut]
    # Kept OUT of `years` on purpose: the trend chart consumes that list positionally and
    # a null-sectioned entry would be a landmine in every consumer.
    incomplete: list[IncompleteYearOut] = Field(default_factory=list)
```

- [ ] **Step 5.5: The engine feed** — `backend/app/api/taxes.py`. Replace `_stored_inputs` and `_engine_tables` (`:134-157`) with the block below, and add the new imports.

```python
from dataclasses import dataclass, field as dataclass_field
```

```python
from app.models import (
    EsppLot,
    PaycheckProfile,
    Person,
    RsuGrant,
    TaxBracket,
    TaxInput,
    TaxInputDefinition,
    TaxYear,
)
from app.services.people import load_people, primary_person
from app.services.tax_service import (
    JURISDICTION_WARN_MISSING,
    Bracket,
    EarnerWages,
    JurisdictionResult,
    TaxBreakdown,
    compute_breakdown,
    derive_suggestions,
    earner_from_inputs,
    shift_earners,
)
from app.tax_keys import (
    FILING_STATUSES,
    JURISDICTIONS,
    MARRIED_JOINT,
    PER_PERSON_KEYS,
    SECTIONS,
    SINGLE,
    TAX_INPUT_DEFINITIONS,
)
```

(`shift_earners` lands in Task 8; add it to the import there, not here.)

```python
BRACKETS_MISSING_WARNING = (
    "{year} is filed as {status} and has no {status} bracket table for: {jurisdictions}"
)
# A sentinel, not None: None is a legal person column (the pre-household spelling), so
# "this row belongs to somebody else" needs its own value.
OFF_RETURN = object()


@dataclass
class EngineFeed:
    """Everything `compute_breakdown` needs for one year, resolved ONCE.

    The summary, the trend feed, the what-if, the withholding card and the Overview
    money-flow all read this, so they can never disagree about which filing status was
    assumed, which bracket tables were selected, or whose W-2 rows were counted.
    """

    year: int
    filing_status: str
    inputs: dict[str, Decimal]
    earners: list[EarnerWages] | None
    tables: dict[str, list[Bracket]]
    brackets_missing_for_status: list[str] = dataclass_field(default_factory=list)

    @property
    def computable(self) -> bool:
        """'single' always computes (the grandfathered path every stored year uses); a
        married status refuses rather than walk a single filer's thresholds."""
        return self.filing_status == SINGLE or not self.brackets_missing_for_status

    def warning(self) -> str:
        return BRACKETS_MISSING_WARNING.format(
            year=self.year,
            status=self.filing_status,
            jurisdictions=", ".join(self.brackets_missing_for_status),
        )


def _return_people(people: list[Person], filing_status: str) -> list[Person]:
    """The people whose per-person rows belong on THIS year's return.

    Married-joint is one return for two people, so both columns count. Single and MFS are
    one return for ONE person: an MFS return carries only that spouse's wages (the
    community-property caveat the page renders is exactly about what this does NOT model),
    and a partner's rows entered for a later year must never leak into a settled single
    year. An empty roster is a database older than the household migration — every row is
    simply the primary person's, spelled NULL.
    """
    if not people:
        return []
    return list(people) if filing_status == MARRIED_JOINT else people[:1]


def _owner_column(person_id: int | None, columns: list[int | None]):
    """Which person column a stored row belongs to, or OFF_RETURN when it belongs to
    somebody this year's return does not cover.

    A NULL person_id on a PER-PERSON key is the pre-household spelling of "the primary
    person", so it folds onto the first column — which is what makes a `create_all` test
    database (no people at all) read exactly as it did before the migration.
    """
    if person_id is None:
        return columns[0]
    if person_id in columns:
        return person_id
    return OFF_RETURN


def _assemble_inputs(rows: list[TaxInput], columns: list[int | None]) -> dict[str, Decimal]:
    """The engine's flat input dict: household keys verbatim, per-person keys SUMMED
    across the people on this return (spec §5.4)."""
    values: dict[str, Decimal] = {}
    for row in rows:
        if row.key in PER_PERSON_KEYS and _owner_column(row.person_id, columns) is OFF_RETURN:
            continue
        existing = values.get(row.key)
        values[row.key] = row.value if existing is None else existing + row.value
    return values


def _assemble_earners(
    rows: list[TaxInput], columns: list[int | None]
) -> list[EarnerWages] | None:
    """One wage bundle per person on the return — or None when there is at most one.

    None is not a fallback: it is the instruction to the engine to synthesize the single
    bundle from `inputs` exactly as it always has, which is what keeps every single-filer
    year byte-identical.
    """
    per_person: dict[int | None, dict[str, Decimal]] = {}
    for row in rows:
        if row.key not in PER_PERSON_KEYS:
            continue
        column = _owner_column(row.person_id, columns)
        if column is OFF_RETURN:
            continue
        bucket = per_person.setdefault(column, {})
        existing = bucket.get(row.key)
        bucket[row.key] = row.value if existing is None else existing + row.value
    if len(per_person) < 2:
        return None
    return [earner_from_inputs(per_person[column]) for column in sorted(per_person, key=str)]


async def _filing_status(db: AsyncSession, year: int) -> str:
    """A year that does not exist reads as single — the engine's default, and the answer
    every GET-never-rejects path needs for an unknown year."""
    row = await db.get(TaxYear, year)
    return SINGLE if row is None else row.filing_status


async def _engine_tables(
    db: AsyncSession, year: int, filing_status: str = SINGLE
) -> dict[str, list[Bracket]]:
    """One year+status's bracket tables in the shape `compute_breakdown` (and `walk`) take.

    ONE loader for every engine caller — the summary, the what-if and the withholding card
    — so they can never disagree about which rows the engine saw. The full key order, not
    just bracket_index: `walk`/`stack` sort defensively, so this pins one table order
    across all of them rather than leaving it to whatever the planner returns.
    """
    rows = (
        await db.execute(
            select(TaxBracket)
            .where(TaxBracket.year == year, TaxBracket.filing_status == filing_status)
            .order_by(TaxBracket.jurisdiction, TaxBracket.bracket_index)
        )
    ).scalars()
    tables: dict[str, list[Bracket]] = {}
    for row in rows:
        tables.setdefault(row.jurisdiction, []).append((row.rate, row.threshold))
    return tables


def _missing_for_status(tables: dict[str, list[Bracket]], filing_status: str) -> list[str]:
    """Jurisdictions with no table under this status, in tax_keys order. Always empty for
    'single' — see EngineFeed.computable."""
    if filing_status == SINGLE:
        return []
    return [name for name in JURISDICTIONS if not tables.get(name)]


async def _engine_feed(db: AsyncSession, year: int) -> EngineFeed:
    filing_status = await _filing_status(db, year)
    columns = [person.id for person in _return_people(await load_people(db), filing_status)] or [
        None
    ]
    rows = list((await db.execute(select(TaxInput).where(TaxInput.year == year))).scalars())
    tables = await _engine_tables(db, year, filing_status)
    return EngineFeed(
        year=year,
        filing_status=filing_status,
        inputs=_assemble_inputs(rows, columns),
        earners=_assemble_earners(rows, columns),
        tables=tables,
        brackets_missing_for_status=_missing_for_status(tables, filing_status),
    )


def _breakdown_for(feed: EngineFeed) -> TaxBreakdown:
    return compute_breakdown(
        feed.year,
        feed.inputs,
        feed.tables,
        filing_status=feed.filing_status,
        earners=feed.earners,
    )
```

`_stored_inputs` is DELETED — `_engine_feed` owns the load, and `api/overview.py`'s import moves to it in Task 9. (`app/api/overview.py` is the only other importer; it is updated there.)

- [ ] **Step 5.6: The summary serializers** — in `backend/app/api/taxes.py`, replace `_summary_out` (`:475-506`) and add its refusal twin:

```python
def _summary_out(breakdown: TaxBreakdown, feed: EngineFeed | None = None) -> TaxSummaryOut:
    warnings = list(breakdown.warnings)  # engine warnings first, serializer's appended after
    federal = _income_out(breakdown.federal, "federal", warnings)
    state = _income_out(breakdown.state, "state", warnings)
    medicare = _wage_out(breakdown.medicare, "medicare", warnings)
    social_security = _wage_out(breakdown.social_security, "social_security", warnings)
    disability = _wage_out(breakdown.disability, "disability", warnings)
    gains = breakdown.capital_gains
    capital_gains = CapitalGainsTaxOut(
        taxable_income=_money(gains.taxable_income),
        gains_amount=_money(gains.gains_amount),
        tax=_money(gains.tax),
        effective_rate=_effective_rate(gains.effective_rate, "capital_gains", warnings),
    )
    totals = TaxTotalsOut(
        gross_income=_money(breakdown.totals.gross_income),
        total_income=_money(breakdown.totals.total_income),
        total_tax=_money(breakdown.totals.total_tax),
        take_home=_money(breakdown.totals.take_home),
        effective_rate=_effective_rate(breakdown.totals.effective_rate, "totals", warnings),
    )
    return TaxSummaryOut(
        year=breakdown.year,
        filing_status=SINGLE if feed is None else feed.filing_status,
        federal=federal,
        state=state,
        medicare=medicare,
        social_security=social_security,
        disability=disability,
        capital_gains=capital_gains,
        totals=totals,
        warnings=warnings,
    )


def _missing_summary_out(feed: EngineFeed) -> TaxSummaryOut:
    """The refusal payload: the year, its status, the tables it is waiting for, and NO
    numbers at all. Computing this year against the tables that DO exist would walk a
    single filer's thresholds over two salaries and report the answer with a straight
    face — the one outcome the spec's risk table calls out by name."""
    return TaxSummaryOut(
        year=feed.year,
        filing_status=feed.filing_status,
        brackets_missing_for_status=feed.brackets_missing_for_status,
        warnings=[feed.warning()],
    )
```

- [ ] **Step 5.7: `list_years`, the year PATCH, and both summary routes** — replace `list_years` (`:205-222`), insert the PATCH beside it, and replace `get_summary` / `get_all_summaries`:

```python
async def _year_out(db: AsyncSession, row: TaxYear) -> TaxYearOut:
    inputs = (
        await db.execute(
            select(func.count()).select_from(TaxInput).where(TaxInput.year == row.year)
        )
    ).scalar_one()
    brackets = (
        await db.execute(
            select(func.count()).select_from(TaxBracket).where(TaxBracket.year == row.year)
        )
    ).scalar_one()
    return TaxYearOut(
        year=row.year,
        notes=row.notes,
        filing_status=row.filing_status,
        input_count=inputs,
        bracket_count=brackets,
    )


@router.get("/years", response_model=list[TaxYearOut])
async def list_years(db: AsyncSession = Depends(get_db)) -> list[TaxYearOut]:
    years = list((await db.execute(select(TaxYear).order_by(TaxYear.year))).scalars())
    input_counts = dict(
        (await db.execute(select(TaxInput.year, func.count()).group_by(TaxInput.year))).all()
    )
    bracket_counts = dict(
        (await db.execute(select(TaxBracket.year, func.count()).group_by(TaxBracket.year))).all()
    )
    return [
        TaxYearOut(
            year=row.year,
            notes=row.notes,
            filing_status=row.filing_status,
            input_count=input_counts.get(row.year, 0),
            bracket_count=bracket_counts.get(row.year, 0),
        )
        for row in years
    ]


@router.patch("/years/{year}", response_model=TaxYearOut)
async def update_year(
    year: YearPath, body: TaxYearUpdate, db: AsyncSession = Depends(get_db)
) -> TaxYearOut:
    """Set a year's filing status — the one field on a year row the editors can change.

    NO auto-create (the PUTs own that affordance): a status is a statement ABOUT a year
    that must already exist. Bracket tables are NOT moved or copied: flipping 2026 to
    married_joint while only single-filer tables exist is a legitimate intermediate state,
    reported by the summary's `brackets_missing_for_status` and fixed by the clone helper,
    never guessed at here. Stored inputs are untouched too — the partner's rows simply
    come onto the return.
    """
    row = await db.get(TaxYear, year)
    if row is None:
        raise HTTPException(status_code=404, detail=f"tax year {year} not found")
    row.filing_status = body.filing_status
    await db.commit()
    return await _year_out(db, row)
```

```python
@router.get("/years/{year}/summary", response_model=TaxSummaryOut)
async def get_summary(year: YearPath, db: AsyncSession = Depends(get_db)) -> TaxSummaryOut:
    await _require_year(db, year)
    feed = await _engine_feed(db, year)
    if not feed.computable:
        return _missing_summary_out(feed)
    return _summary_out(_breakdown_for(feed), feed)


@router.get("/summary", response_model=TaxSummariesOut)
async def get_all_summaries(db: AsyncSession = Depends(get_db)) -> TaxSummariesOut:
    """The trend feed: one summary per year that has at least one stored input.

    A year whose status has no tables is SKIPPED rather than served with null sections —
    `years` is consumed positionally by the chart builders — and named in `incomplete` so
    the page can offer the fix.
    """
    years = list((await db.execute(select(TaxYear.year).order_by(TaxYear.year))).scalars())
    summaries: list[TaxSummaryOut] = []
    incomplete: list[IncompleteYearOut] = []
    for year in years:
        feed = await _engine_feed(db, year)
        # A year with no inputs computes an all-zero column — noise in a trend chart.
        if not feed.inputs:
            continue
        if not feed.computable:
            incomplete.append(
                IncompleteYearOut(
                    year=year,
                    filing_status=feed.filing_status,
                    brackets_missing_for_status=feed.brackets_missing_for_status,
                )
            )
            continue
        summaries.append(_summary_out(_breakdown_for(feed), feed))
    return TaxSummariesOut(years=summaries, incomplete=incomplete)
```

> The batched three-query load `get_all_summaries` used before is replaced by one feed per
> year. That is 4 queries x N years where N is the number of tax years the user has ever
> entered (4 today, and it is bounded by 200 by the century guard) — the cost of ONE
> loader that cannot disagree with the per-year route. Do not re-optimize it back into a
> second assembly path.

Add `IncompleteYearOut`, `TaxYearUpdate` to the `app.schemas.taxes` import block at `:47-73`.

- [ ] **Step 5.8: Pin the Literal against the constant** — append to `backend/tests/test_taxes_api.py`:

```python
def test_filing_status_literal_matches_the_constant():
    from typing import get_args

    from app.schemas.taxes import FilingStatus
    from app.tax_keys import FILING_STATUSES

    assert get_args(FilingStatus) == FILING_STATUSES
```

- [ ] **Step 5.9: Run to pass** — `cd backend && .venv/Scripts/python.exe -m pytest tests/test_taxes_api.py -q`
Expected: all pass, including every shipped test in the file (the two updated dicts aside, nothing else changed shape).
- [ ] **Step 5.10: RUN GOLDENS** — `cd backend && .venv/Scripts/python.exe -m pytest tests/test_tax_service.py tests/test_tax_service_married.py -q`
Expected: 52 + 21 passed; `git diff --stat backend/tests/test_tax_service.py` shows only Task 4's one function.
- [ ] **Step 5.11: Downstream** — `cd backend && .venv/Scripts/python.exe -m pytest tests/test_overview_api.py tests/test_withholding_api.py -q`
Expected: green. **If `api/overview.py` fails to import `_stored_inputs`, do NOT re-add it** — bring Task 9's two-line overview change forward instead, and note it so Task 9 skips that step.
- [ ] **Step 5.12: Lint** — `cd backend && .venv/Scripts/python.exe -m ruff check app tests && .venv/Scripts/python.exe -m ruff format app tests`
- [ ] **Step 5.13: Commit** — `git add backend/app/schemas/taxes.py backend/app/api/taxes.py backend/app/api/overview.py backend/tests/test_taxes_api.py && git commit -m "feat(taxes): status-aware engine feed, PATCH filing status, brackets_missing_for_status on both summary routes"`

---

### Task 6: Inputs API — person columns, per-column suggestions, person-qualified writes

**Files:**
- Modify: `backend/app/schemas/taxes.py` (`TaxInputItemOut` `:22-30`, `TaxInputsOut` `:38-40`, `TaxInputsIn` `:43-46`)
- Modify: `backend/app/api/taxes.py` (`_inputs_payload` `:160-184`, `put_inputs` `:275-302`)
- Modify: `backend/tests/test_taxes_api.py`

- [ ] **Step 6.1: Write the failing tests** — append to `backend/tests/test_taxes_api.py`:

```python
# --- per-person inputs ---


async def test_inputs_payload_shape_is_unchanged_without_a_roster(auth_client, definitions):
    """No people seeded (the `create_all` default): one column, person_id null, exactly
    the payload shipped today plus the additive keys."""
    await put_inputs(auth_client, 2024, {"annual_salary": "150000"})

    body = (await auth_client.get(f"{YEARS}/2024/inputs")).json()
    assert body["filing_status"] == "single"
    assert body["people"] == []
    items = items_by_key(body)
    assert len(items) == len(TAX_INPUT_DEFINITIONS) == 45
    assert items["annual_salary"]["value"] == "150000.0000"
    assert items["annual_salary"]["person_id"] is None
    assert items["annual_salary"]["is_per_person"] is True
    assert items["interest_total"]["is_per_person"] is False
    assert items["w2_fed_withholding"]["is_per_person"] is True
    assert items["w2_fed_withholding"]["suggested"] is None  # tracker-only, never derived


async def test_inputs_render_one_column_per_person_on_a_joint_year(
    auth_client, db, household, definitions
):
    me, partner = household
    await put_inputs(auth_client, 2026, {"annual_salary": "150000"})
    await set_status(auth_client, 2026, "married_joint")

    body = (await auth_client.get(f"{YEARS}/2026/inputs")).json()
    assert body["people"] == [
        {"id": me.id, "name": "Me"},
        {"id": partner.id, "name": "Partner"},
    ]
    salary = [
        item
        for section in body["sections"]
        for item in section["items"]
        if item["key"] == "annual_salary"
    ]
    assert [item["person_id"] for item in salary] == [me.id, partner.id]
    # The legacy `values` write landed on the PRIMARY person.
    assert [item["value"] for item in salary] == ["150000.0000", None]
    # Household keys stay single-column.
    interest = [
        item
        for section in body["sections"]
        for item in section["items"]
        if item["key"] == "interest_total"
    ]
    assert [item["person_id"] for item in interest] == [None]


async def test_person_qualified_write_round_trip(auth_client, db, household, definitions):
    me, partner = household
    resp = await auth_client.put(
        f"{YEARS}/2026/inputs",
        json={
            "values": {"interest_total": "2000"},
            "rows": [
                {"key": "annual_salary", "person_id": me.id, "value": "150000"},
                {"key": "annual_salary", "person_id": partner.id, "value": "90000"},
                {"key": "w2_fed_withholding", "person_id": partner.id, "value": "12000"},
            ],
        },
    )
    assert resp.status_code == 200, resp.text
    await set_status(auth_client, 2026, "married_joint")

    body = (await auth_client.get(f"{YEARS}/2026/inputs")).json()
    by_slot = {
        (item["key"], item["person_id"]): item["value"]
        for section in body["sections"]
        for item in section["items"]
    }
    assert by_slot[("annual_salary", me.id)] == "150000.0000"
    assert by_slot[("annual_salary", partner.id)] == "90000.0000"
    assert by_slot[("w2_fed_withholding", partner.id)] == "12000.0000"
    assert by_slot[("interest_total", None)] == "2000.0000"
    # The PUT body IS the GET shape.
    assert (await auth_client.get(f"{YEARS}/2026/inputs")).json() == body

    # A null clears one PERSON's row and leaves the other alone.
    await auth_client.put(
        f"{YEARS}/2026/inputs",
        json={"rows": [{"key": "annual_salary", "person_id": partner.id, "value": None}]},
    )
    after = (await auth_client.get(f"{YEARS}/2026/inputs")).json()
    remaining = {
        (item["key"], item["person_id"]): item["value"]
        for section in after["sections"]
        for item in section["items"]
    }
    assert remaining[("annual_salary", partner.id)] is None
    assert remaining[("annual_salary", me.id)] == "150000.0000"


async def test_suggestions_are_computed_per_column(auth_client, db, household, definitions):
    """The derived-W2 chain is one PERSON's: the partner's pay_periods x gross_paycheck
    must not be built from the primary's salary."""
    me, partner = household
    await auth_client.put(
        f"{YEARS}/2026/inputs",
        json={
            "rows": [
                {"key": "pay_periods", "person_id": me.id, "value": "24"},
                {"key": "gross_paycheck", "person_id": me.id, "value": "6000"},
                {"key": "pay_periods", "person_id": partner.id, "value": "24"},
                {"key": "gross_paycheck", "person_id": partner.id, "value": "4000"},
                {"key": "itemized_salt", "value": "9000"},
            ]
        },
    )
    await set_status(auth_client, 2026, "married_joint")

    body = (await auth_client.get(f"{YEARS}/2026/inputs")).json()
    suggested = {
        (item["key"], item["person_id"]): item["suggested"]
        for section in body["sections"]
        for item in section["items"]
    }
    assert suggested[("latest_w2_income", me.id)] == "144000.0000"
    assert suggested[("latest_w2_income", partner.id)] == "96000.0000"
    # A household suggestion is column-invariant, so it renders once.
    assert suggested[("itemized_deduction", None)] == "9000.0000"


async def test_put_inputs_rejects_person_on_a_household_key(auth_client, household, definitions):
    me, _partner = household
    resp = await auth_client.put(
        f"{YEARS}/2026/inputs",
        json={"rows": [{"key": "interest_total", "person_id": me.id, "value": "5"}]},
    )
    assert resp.status_code == 422
    assert "interest_total" in resp.json()["detail"]
    assert (await auth_client.get(YEARS)).json() == []  # not even the year row


async def test_put_inputs_rejects_unknown_person_and_duplicate_slots(
    auth_client, household, definitions
):
    me, _partner = household
    unknown = await auth_client.put(
        f"{YEARS}/2026/inputs",
        json={"rows": [{"key": "annual_salary", "person_id": 9999, "value": "1"}]},
    )
    assert unknown.status_code == 422
    assert "9999" in unknown.json()["detail"]

    duplicate = await auth_client.put(
        f"{YEARS}/2026/inputs",
        json={
            "values": {"annual_salary": "1"},
            "rows": [{"key": "annual_salary", "person_id": me.id, "value": "2"}],
        },
    )
    # `values` resolves to the primary person, so this IS the same slot twice.
    assert duplicate.status_code == 422
    assert "annual_salary" in duplicate.json()["detail"]
    assert (await auth_client.get(YEARS)).json() == []


async def test_a_legacy_null_row_is_adopted_not_duplicated(
    auth_client, db, household, definitions
):
    """A row written before the roster existed carries person_id NULL on a per-person key.
    The next write must move it, never insert a second row the unique key would reject."""
    from app.models import TaxInput as TaxInputModel

    me, _partner = household
    db.add(TaxYear(year=2026))
    await db.flush()
    db.add(TaxInputModel(year=2026, key="annual_salary", value=Decimal("100000.0000")))
    await db.commit()

    await auth_client.put(
        f"{YEARS}/2026/inputs",
        json={"rows": [{"key": "annual_salary", "person_id": me.id, "value": "150000"}]},
    )
    stored = (
        (
            await db.execute(
                select(TaxInputModel).where(
                    TaxInputModel.year == 2026, TaxInputModel.key == "annual_salary"
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(stored) == 1
    assert (stored[0].person_id, stored[0].value) == (me.id, Decimal("150000.0000"))
```

- [ ] **Step 6.2: Run — expect failure** — `cd backend && .venv/Scripts/python.exe -m pytest tests/test_taxes_api.py -q -k "person or column or inputs_payload_shape or legacy"`
Expected: the seven new tests fail (`KeyError: 'people'`, unknown body field `rows`, count 45 vs 43 on the shape test only if Task 2 was skipped).

- [ ] **Step 6.3: Schemas** — `backend/app/schemas/taxes.py`:

```python
class TaxPersonOut(BaseModel):
    """The person COLUMNS this year's return has, in render order (primary first)."""

    id: int
    name: str


class TaxInputItemOut(BaseModel):
    key: str
    label: str
    sort_order: int
    is_derived: bool
    # True for tax_keys.PER_PERSON_KEYS: this line renders one item per person column.
    is_per_person: bool = False
    # The column this item belongs to. Null for household keys — and also for per-person
    # keys on a database with no people roster, which is the pre-household spelling.
    person_id: int | None = None
    value: Decimal | None
    # The sheet's gray-cell formula for this key, when it has one, computed from THIS
    # column's own values. Advisory: the UI offers a chip, nothing is applied server-side.
    suggested: Decimal | None


class TaxInputSectionOut(BaseModel):
    section: str
    items: list[TaxInputItemOut]


class TaxInputsOut(BaseModel):
    year: int
    filing_status: str = SINGLE
    people: list[TaxPersonOut] = Field(default_factory=list)
    sections: list[TaxInputSectionOut]


class TaxInputRowIn(BaseModel):
    key: str
    # Null on a per-person key means "the primary person" — which is what every client
    # that predates this batch says by saying nothing at all.
    person_id: int | None = None
    value: Decimal | None


class TaxInputsIn(BaseModel):
    # Free-form keys, validated against the definition table by the router (which is the
    # only place that knows which keys are seeded); null deletes the stored row.
    # `values` is the household/primary shorthand every shipped client sends; `rows` is
    # its person-qualified form. Both are merged, and the same (key, person) twice is a
    # 422 rather than a last-write-wins surprise.
    values: dict[str, Decimal | None] = Field(default_factory=dict)
    rows: list[TaxInputRowIn] = Field(default_factory=list)
```

- [ ] **Step 6.4: `_inputs_payload`** — replace `backend/app/api/taxes.py` `:160-184`:

```python
async def _inputs_payload(db: AsyncSession, year: int) -> TaxInputsOut:
    """Every definition, one item per PERSON COLUMN, each with its own suggestions.

    Columns are the people this year's return covers (`_return_people`): one — the
    primary — for single and MFS, everybody for married-joint, and a single NULL column on
    a database with no roster, which reproduces today's payload byte for byte. Household
    keys always render exactly once, with person_id null.
    """
    definitions = list((await db.execute(select(TaxInputDefinition))).scalars())
    filing_status = await _filing_status(db, year)
    people = _return_people(await load_people(db), filing_status)
    columns: list[int | None] = [person.id for person in people] or [None]

    rows = list((await db.execute(select(TaxInput).where(TaxInput.year == year))).scalars())
    household = {row.key: row.value for row in rows if row.key not in PER_PERSON_KEYS}
    owned: dict[int | None, dict[str, Decimal]] = {column: {} for column in columns}
    for row in rows:
        if row.key not in PER_PERSON_KEYS:
            continue
        column = _owner_column(row.person_id, columns)
        if column is not OFF_RETURN:
            owned[column][row.key] = row.value

    # One suggestion map per column: the derived-W2 chain is one PERSON's, and the
    # household references it also reads are shared, so a household key's suggestion is
    # the same in every column (which is why it can render once, from the first).
    suggestions = {
        column: derive_suggestions(year, household | values, filing_status)
        for column, values in owned.items()
    }
    by_section: dict[str, list[TaxInputItemOut]] = {}
    for definition in sorted(definitions, key=lambda d: (d.sort_order, d.key)):
        item_columns = columns if definition.is_per_person else [None]
        for column in item_columns:
            source = owned[column] if definition.is_per_person else household
            by_section.setdefault(definition.section, []).append(
                TaxInputItemOut(
                    key=definition.key,
                    label=definition.label,
                    sort_order=definition.sort_order,
                    is_derived=definition.is_derived,
                    is_per_person=definition.is_per_person,
                    person_id=column if definition.is_per_person else None,
                    value=source.get(definition.key),
                    # Presence here — not is_derived — is what the UI shows a chip for: the
                    # sheet computes capital_loss_deductions although it seeds as a plain
                    # input.
                    suggested=suggestions[
                        column if definition.is_per_person else columns[0]
                    ].get(definition.key),
                )
            )
    # tax_keys order first; a section seeded later still renders (appended, name order).
    ordered = [name for name in SECTIONS if name in by_section]
    ordered += sorted(set(by_section) - set(SECTIONS))
    return TaxInputsOut(
        year=year,
        filing_status=filing_status,
        people=[TaxPersonOut(id=person.id, name=person.name) for person in people],
        sections=[TaxInputSectionOut(section=name, items=by_section[name]) for name in ordered],
    )
```

- [ ] **Step 6.5: `put_inputs`** — replace `backend/app/api/taxes.py` `:275-302`:

```python
@router.put("/years/{year}/inputs", response_model=TaxInputsOut)
async def put_inputs(
    year: YearPath, body: TaxInputsIn, db: AsyncSession = Depends(get_db)
) -> TaxInputsOut:
    """Bulk upsert of the (key, person) slots in the body; a null value unsets one slot.

    Re-import interplay (Plan 2 forward note): the taxes import is sheet-wins within the
    years it covers, so edits made here to an imported year are clobbered by the next
    re-import — for the PRIMARY person's sheet-tracked keys only, since the importer's
    sweeps are scoped to the sheet's own vocabulary and to that one person.
    """
    submitted = [TaxInputRowIn(key=key, value=value) for key, value in body.values.items()]
    submitted += list(body.rows)
    await _require_known_input_keys(db, [row.key for row in submitted])

    definitions = {
        definition.key: definition
        for definition in (await db.execute(select(TaxInputDefinition))).scalars()
    }
    people = await load_people(db)
    known_people = {person.id for person in people}
    primary = primary_person(people)

    # Resolve and quantize EVERY row before the first write: a 422 raised halfway through
    # a bulk upsert would otherwise leave the year half-edited (portfolio PATCH posture).
    resolved: dict[tuple[str, int | None], Decimal | None] = {}
    for row in submitted:
        definition = definitions[row.key]
        if not definition.is_per_person:
            if row.person_id is not None:
                raise HTTPException(
                    status_code=422,
                    detail=f"{row.key} is a household input — person_id must be null",
                )
            owner: int | None = None
        elif row.person_id is None:
            # Today's clients send no person at all; a per-person line with no owner is
            # the primary's, which is precisely what every stored row was before the
            # migration. On a roster-less database that is still NULL.
            owner = primary.id if primary is not None else None
        elif row.person_id not in known_people:
            raise HTTPException(status_code=422, detail=f"unknown person {row.person_id}")
        else:
            owner = row.person_id
        slot = (row.key, owner)
        if slot in resolved:
            raise HTTPException(
                status_code=422, detail=f"{row.key} appears twice for the same person"
            )
        resolved[slot] = _validated_input_value(row.key, row.value)

    await _ensure_year(db, year)
    existing = {
        (row.key, row.person_id): row
        for row in (await db.execute(select(TaxInput).where(TaxInput.year == year))).scalars()
    }
    for (key, owner), value in resolved.items():
        row = existing.get((key, owner))
        if row is None and owner is not None:
            # The pre-household spelling of the same slot: a NULL row on a per-person key,
            # written before the roster existed. ADOPT it rather than inserting a second
            # row the (year, key, person) unique key would rightly reject.
            row = existing.get((key, None))
        if value is None:
            if row is not None:
                await db.delete(row)  # null means "unset this line", not "store 0"
        elif row is None:
            db.add(TaxInput(year=year, key=key, person_id=owner, value=value))
        else:
            row.person_id = owner
            row.value = value
    await db.commit()
    return await _inputs_payload(db, year)
```

Add `TaxInputRowIn`, `TaxPersonOut` to the `app.schemas.taxes` import block.

- [ ] **Step 6.6: Run to pass** — `cd backend && .venv/Scripts/python.exe -m pytest tests/test_taxes_api.py -q`
Expected: all pass. In particular the shipped `test_get_inputs_lists_every_definition_with_null_values` (now 45), `test_put_inputs_creates_year_upserts_and_deletes`, `test_put_inputs_never_stores_a_signed_zero` and `test_put_inputs_rejects_unknown_key_without_partial_write` must pass **unchanged** — the roster is empty in those tests, so every path is the single-column one.
- [ ] **Step 6.7: RUN GOLDENS** — `cd backend && .venv/Scripts/python.exe -m pytest tests/test_tax_service.py tests/test_tax_service_married.py -q` → 52 + 21 passed.
- [ ] **Step 6.8: Lint** — `cd backend && .venv/Scripts/python.exe -m ruff check app tests && .venv/Scripts/python.exe -m ruff format app tests`
- [ ] **Step 6.9: Commit** — `git add backend/app/schemas/taxes.py backend/app/api/taxes.py backend/tests/test_taxes_api.py && git commit -m "feat(taxes): person-qualified tax inputs with per-column suggestions"`

---

### Task 7: Brackets API — status tabs, full-replace per (jurisdiction, status), clone-as-MFJ

**Files:**
- Modify: `backend/app/schemas/taxes.py` (`BracketsOut` `:60-63`, `BracketsIn` `:66-68`; new `BracketReviewFlags`, `ClonedBracketsOut`)
- Modify: `backend/app/api/taxes.py` (`_brackets_payload` `:187-202`, `get_brackets` `:343-346`, `put_brackets` `:349-381`, `clone_brackets` `:384-423`)
- Modify: `backend/tests/test_taxes_api.py`

- [ ] **Step 7.1: Write the failing tests** — append to `backend/tests/test_taxes_api.py`:

```python
# --- brackets by status ---


async def test_brackets_default_to_single_and_statuses_are_independent(auth_client, definitions):
    await put_brackets(auth_client, 2026, {"federal": rows(("0.10", "0"))})
    joint = await auth_client.put(
        f"{YEARS}/2026/brackets",
        json={"filing_status": "married_joint", "jurisdictions": {"federal": rows(("0.12", "0"))}},
    )
    assert joint.status_code == 200, joint.text
    assert joint.json()["filing_status"] == "married_joint"

    single_body = (await auth_client.get(f"{YEARS}/2026/brackets")).json()
    assert single_body["filing_status"] == "single"
    assert single_body["jurisdictions"]["federal"] == [
        {"bracket_index": 1, "rate": "0.1000", "threshold": "0.00"}
    ]
    joint_body = (
        await auth_client.get(f"{YEARS}/2026/brackets", params={"filing_status": "married_joint"})
    ).json()
    assert joint_body["jurisdictions"]["federal"] == [
        {"bracket_index": 1, "rate": "0.1200", "threshold": "0.00"}
    ]
    # A full replace of one status leaves the other alone.
    await auth_client.put(
        f"{YEARS}/2026/brackets",
        json={"filing_status": "married_joint", "jurisdictions": {"federal": []}},
    )
    assert (await auth_client.get(f"{YEARS}/2026/brackets")).json() == single_body


async def test_get_brackets_rejects_an_unknown_status(auth_client, definitions):
    await put_brackets(auth_client, 2026, {"federal": rows(("0.10", "0"))})
    resp = await auth_client.get(f"{YEARS}/2026/brackets", params={"filing_status": "widow"})
    assert resp.status_code == 422


async def test_clone_as_married_joint_copies_the_single_tables_with_review_flags(
    auth_client, definitions
):
    """The "Clone as MFJ" flow: same year, single tables in, MFJ tables out."""
    await put_brackets(auth_client, 2026, brackets_payload(2026)["jurisdictions"])

    resp = await auth_client.post(
        f"{YEARS}/2026/clone-brackets-from/2026", params={"target_status": "married_joint"}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["filing_status"] == "married_joint"
    source = (await auth_client.get(f"{YEARS}/2026/brackets")).json()
    assert body["jurisdictions"] == source["jurisdictions"]  # verbatim, index for index
    assert body["review_flags"] == {
        "verbatim_ok": ["social_security", "disability"],
        "review": ["federal", "state", "capital_gains", "medicare"],
    }

    # A second clone into the same status is a 409, never a silent merge.
    conflict = await auth_client.post(
        f"{YEARS}/2026/clone-brackets-from/2026", params={"target_status": "married_joint"}
    )
    assert conflict.status_code == 409
    assert "2026" in conflict.json()["detail"]
    assert "married_joint" in conflict.json()["detail"]
    # ...and the single tables it cloned FROM are untouched.
    assert (await auth_client.get(f"{YEARS}/2026/brackets")).json() == source


async def test_clone_only_ever_reads_the_source_years_single_tables(auth_client, definitions):
    """MFJ tables are never a clone SOURCE: the helper's whole job is "start my married
    tables from my single ones"."""
    await auth_client.put(
        f"{YEARS}/2024/brackets",
        json={"filing_status": "married_joint", "jurisdictions": {"federal": rows(("0.12", "0"))}},
    )
    missing = await auth_client.post(f"{YEARS}/2025/clone-brackets-from/2024")
    assert missing.status_code == 404
    assert "2024" in missing.json()["detail"]


async def test_clone_target_status_defaults_to_single(auth_client, definitions):
    await put_brackets(auth_client, 2024, {"federal": rows(("0.10", "0"))})
    body = (await auth_client.post(f"{YEARS}/2025/clone-brackets-from/2024")).json()
    assert body["filing_status"] == "single"
    assert body["jurisdictions"]["federal"] == [
        {"bracket_index": 1, "rate": "0.1000", "threshold": "0.00"}
    ]


async def test_brackets_missing_state_clears_once_the_tables_are_cloned(auth_client, definitions):
    """End to end: flip to MFJ, get the call-to-action, clone, get numbers."""
    await put_inputs(auth_client, 2026, inputs_payload(2026))
    await put_brackets(auth_client, 2026, brackets_payload(2026)["jurisdictions"])
    await set_status(auth_client, 2026, "married_joint")
    assert (await auth_client.get(f"{YEARS}/2026/summary")).json()["totals"] is None

    await auth_client.post(
        f"{YEARS}/2026/clone-brackets-from/2026", params={"target_status": "married_joint"}
    )
    body = (await auth_client.get(f"{YEARS}/2026/summary")).json()
    assert body["brackets_missing_for_status"] == []
    # Cloned verbatim from the single tables, so the figures are the single goldens.
    assert body["totals"]["total_tax"] == "98584.56"
```

- [ ] **Step 7.2: Run — expect failure** — `cd backend && .venv/Scripts/python.exe -m pytest tests/test_taxes_api.py -q -k "status or clone"`
Expected: the six new tests fail.

- [ ] **Step 7.3: Schemas** — `backend/app/schemas/taxes.py`:

```python
class BracketsOut(BaseModel):
    # All six jurisdictions always present, possibly with empty tables.
    year: int
    filing_status: str = SINGLE
    jurisdictions: dict[str, list[BracketOut]]


class BracketsIn(BaseModel):
    # Per-jurisdiction FULL REPLACE within ONE status; jurisdictions absent from the body
    # are untouched, and so is every other status's copy of them.
    filing_status: FilingStatus = "single"
    jurisdictions: dict[str, list[BracketIn]]


class BracketReviewFlags(BaseModel):
    """Which cloned tables are typically right as-is, and which need threshold edits.

    Social Security and SDI are PER-PERSON parameters — the wage base and the rate do not
    change with filing status, so a verbatim copy is correct. The other four carry
    per-RETURN thresholds that are emphatically not "2x single" (audit §5): the MFJ 37%
    band starts below 2x, the 20% capital-gains tier likewise, and the medicare table's
    additional tier moves from 200k to 250k (MFJ) or 125k (MFS).
    """

    verbatim_ok: list[str]
    review: list[str]


class ClonedBracketsOut(BracketsOut):
    review_flags: BracketReviewFlags
```

- [ ] **Step 7.4: Router** — `backend/app/api/taxes.py`. Add the query alias and the flag constants near `MAX_BRACKETS` (`:115`):

```python
FilingStatusQuery = Annotated[FilingStatus, Query()]
# See BracketReviewFlags: per-PERSON parameters clone verbatim, per-RETURN thresholds do not.
VERBATIM_OK_JURISDICTIONS = ("social_security", "disability")
REVIEW_JURISDICTIONS = ("federal", "state", "capital_gains", "medicare")
```

Replace `_brackets_payload` (`:187-202`):

```python
async def _brackets_payload(
    db: AsyncSession, year: int, filing_status: str = SINGLE
) -> BracketsOut:
    rows = (
        await db.execute(
            select(TaxBracket)
            .where(TaxBracket.year == year, TaxBracket.filing_status == filing_status)
            .order_by(TaxBracket.jurisdiction, TaxBracket.bracket_index)
        )
    ).scalars()
    tables: dict[str, list[BracketOut]] = {name: [] for name in JURISDICTIONS}
    for row in rows:
        # setdefault, not [...]: the importer could carry a jurisdiction this API cannot
        # write, and a GET must still show it rather than silently drop it.
        tables.setdefault(row.jurisdiction, []).append(
            BracketOut(bracket_index=row.bracket_index, rate=row.rate, threshold=row.threshold)
        )
    return BracketsOut(year=year, filing_status=filing_status, jurisdictions=tables)
```

Replace `get_brackets` / `put_brackets` / `clone_brackets` (`:343-423`):

```python
@router.get("/years/{year}/brackets", response_model=BracketsOut)
async def get_brackets(
    year: YearPath,
    filing_status: FilingStatusQuery = SINGLE,
    db: AsyncSession = Depends(get_db),
) -> BracketsOut:
    """One status's six tables. The default is 'single' rather than the YEAR's status on
    purpose: the editor renders status TABS and asks for the one it is showing, so the
    answer must depend on the request, not on a setting the user is mid-way through
    changing."""
    await _require_year(db, year)
    return await _brackets_payload(db, year, filing_status)


@router.put("/years/{year}/brackets", response_model=BracketsOut)
async def put_brackets(
    year: YearPath, body: BracketsIn, db: AsyncSession = Depends(get_db)
) -> BracketsOut:
    # Re-import interplay: same sheet-wins posture as PUT inputs — a SINGLE-status bracket
    # table edited here for an imported year is replaced by the next workbook import. The
    # married tables are invisible to the importer entirely.
    unknown = sorted(set(body.jurisdictions) - set(JURISDICTIONS))
    if unknown:
        raise HTTPException(status_code=422, detail=f"unknown jurisdiction(s): {unknown}")
    # Validate every jurisdiction before touching any of them: a mixed body must write all
    # of its tables or none.
    validated = {name: _validated_table(name, table) for name, table in body.jurisdictions.items()}

    await _ensure_year(db, year)
    for name, table in validated.items():
        # Core DELETE rather than ORM deletes: the unit of work flushes INSERTs before
        # DELETEs, so replacing a table in place would trip the
        # (year, jurisdiction, filing_status, bracket_index) unique constraint.
        await db.execute(
            delete(TaxBracket).where(
                TaxBracket.year == year,
                TaxBracket.jurisdiction == name,
                TaxBracket.filing_status == body.filing_status,
            )
        )
        for index, (rate, threshold) in enumerate(table, start=1):
            db.add(
                TaxBracket(
                    year=year,
                    jurisdiction=name,
                    filing_status=body.filing_status,
                    bracket_index=index,  # 1-based array order, renumbered on every replace
                    rate=rate,
                    threshold=threshold,
                )
            )
    await db.commit()
    return await _brackets_payload(db, year, body.filing_status)


@router.post("/years/{year}/clone-brackets-from/{source_year}", response_model=ClonedBracketsOut)
async def clone_brackets(
    year: YearPath,
    source_year: YearPath,
    target_status: FilingStatusQuery = SINGLE,
    db: AsyncSession = Depends(get_db),
) -> ClonedBracketsOut:
    """Seed a year+status from an existing year's SINGLE tables; then edited in place.

    The source is always 'single' — the helper's whole job is "start my married tables
    from my single ones", and the app ships no bracket values of its own (spec §2). The
    source year may be the target year: cloning 2026-single into 2026-married_joint is
    exactly the page's "Clone as MFJ" button, and the emptiness guard below is what keeps
    it from being a no-op or a duplicate.
    """
    source_rows = list(
        (
            await db.execute(
                select(TaxBracket)
                .where(TaxBracket.year == source_year, TaxBracket.filing_status == SINGLE)
                .order_by(TaxBracket.jurisdiction, TaxBracket.bracket_index)
            )
        ).scalars()
    )
    if not source_rows:
        raise HTTPException(
            status_code=404, detail=f"no single-filer brackets to clone from {source_year}"
        )
    existing = (
        await db.execute(
            select(func.count())
            .select_from(TaxBracket)
            .where(TaxBracket.year == year, TaxBracket.filing_status == target_status)
        )
    ).scalar_one()
    if existing:
        # Never a silent merge: clear the target explicitly (PUT brackets with []) first.
        raise HTTPException(
            status_code=409,
            detail=f"tax year {year} already has {existing} {target_status} brackets",
        )

    await _ensure_year(db, year)
    for row in source_rows:
        db.add(
            TaxBracket(
                year=year,
                jurisdiction=row.jurisdiction,
                filing_status=target_status,
                bracket_index=row.bracket_index,
                rate=row.rate,
                threshold=row.threshold,
            )
        )
    await db.commit()
    payload = await _brackets_payload(db, year, target_status)
    return ClonedBracketsOut(
        year=payload.year,
        filing_status=payload.filing_status,
        jurisdictions=payload.jurisdictions,
        # The FIXED six-table classification, not "what happened to be in the source": the
        # flags describe which tables are status-SENSITIVE, which is a property of the tax
        # code rather than of this particular clone.
        review_flags=BracketReviewFlags(
            verbatim_ok=list(VERBATIM_OK_JURISDICTIONS), review=list(REVIEW_JURISDICTIONS)
        ),
    )
```

Add `BracketReviewFlags`, `ClonedBracketsOut`, `FilingStatus` to the `app.schemas.taxes` import block.

- [ ] **Step 7.5: Run to pass** — `cd backend && .venv/Scripts/python.exe -m pytest tests/test_taxes_api.py -q`
Expected: all pass. The four shipped clone tests keep passing: `test_clone_brackets_copies_every_jurisdiction` compares `body["jurisdictions"]` (not the whole body), and every shipped clone call omits `target_status`, so it defaults to single exactly as before.
- [ ] **Step 7.6: RUN GOLDENS** — `cd backend && .venv/Scripts/python.exe -m pytest tests/test_tax_service.py tests/test_tax_service_married.py -q` → 52 + 21 passed.
- [ ] **Step 7.7: Lint** — `cd backend && .venv/Scripts/python.exe -m ruff check app tests && .venv/Scripts/python.exe -m ruff format app tests`
- [ ] **Step 7.8: Commit** — `git add backend/app/schemas/taxes.py backend/app/api/taxes.py backend/tests/test_taxes_api.py && git commit -m "feat(taxes): status-dimensioned bracket editor and clone-as-married with review flags"`

---

### Task 8: Withholding safe-harbor AGI gate + the what-if on a married year

**Files:**
- Modify: `backend/app/services/tax_service.py` (add `shift_earners` beside `earner_from_inputs`)
- Modify: `backend/app/schemas/taxes.py` (`SafeHarborOut` `:210-214`, `WithholdingOut` `:217-227`)
- Modify: `backend/app/api/taxes.py` (safe-harbor constants `:566`, `get_withholding` `:574-742`, `what_if` `:745-914`)
- Modify: `backend/tests/test_withholding_api.py`, `backend/tests/test_taxes_api.py`

- [ ] **Step 8.1: Write the failing tests.** In `backend/tests/test_withholding_api.py`, update the ONE dict-equality assertion in `test_withholding_safe_harbor_is_110_pct_of_the_prior_year` and append three tests:

```python
    assert body["safe_harbor"] == {
        "prior_year": YEAR - 1,
        "prior_total_tax": prior_tax,
        "prior_agi": "400000.00",
        "multiplier": "1.10",
        "threshold": "88718.52",  # 80653.20 x 1.10, at cents
        "met": True,  # projected withholding 96883.00 clears it
    }
```

```python
async def test_withholding_safe_harbor_drops_to_100_pct_under_the_agi_gate(
    auth_client, db, world, frozen_today
):
    """The statutory gate that was never checked (audit §3.2): 110% is for prior-year AGI
    ABOVE 150000. Under it the safe harbor is 100% of last year's tax, full stop."""
    await seed_tax_year(db, YEAR - 1, "100000.0000")
    body = await get_withholding(auth_client)

    # 10000 + 5000 + 1450 + 6200 + 1100 = 23750.
    assert body["safe_harbor"] == {
        "prior_year": YEAR - 1,
        "prior_total_tax": "23750.00",
        "prior_agi": "100000.00",
        "multiplier": "1.00",
        "threshold": "23750.00",
        "met": True,
    }


async def test_withholding_safe_harbor_gate_halves_for_married_filing_separately(
    auth_client, db, world, frozen_today
):
    """MFS's gate is 75000, so the same AGI that stays at 100% for a single filer takes
    the 110% multiplier here. The status read is the PRIOR year's — it is that return's
    AGI being tested."""
    await seed_tax_year(db, YEAR - 1, "100000.0000")
    for status in ("single", "married_separate"):
        resp = await auth_client.put(
            f"{YEARS}/{YEAR - 1}/brackets",
            json={
                "filing_status": status,
                "jurisdictions": {
                    name: [{"rate": rate, "threshold": threshold} for rate, threshold in table]
                    for name, table in BRACKETS.items()
                },
            },
        )
        assert resp.status_code == 200, resp.text
    assert (
        await auth_client.patch(
            f"{YEARS}/{YEAR - 1}", json={"filing_status": "married_separate"}
        )
    ).status_code == 200

    body = await get_withholding(auth_client)
    assert body["safe_harbor"]["multiplier"] == "1.10"
    assert body["safe_harbor"]["threshold"] == "26125.00"  # 23750 x 1.10


async def test_withholding_refuses_a_liability_it_cannot_compute(
    auth_client, db, world, frozen_today
):
    """A married current year with no married tables: the withholding legs are still real
    (they come from profiles and vests), but the liability they are compared against is
    not — so it is null, with the reason named, rather than a single-filer number."""
    assert (
        await auth_client.patch(f"{YEARS}/{YEAR}", json={"filing_status": "married_joint"})
    ).status_code == 200

    body = await get_withholding(auth_client)
    assert body["filing_status"] == "married_joint"
    assert body["brackets_missing_for_status"] == [
        "federal",
        "state",
        "medicare",
        "social_security",
        "disability",
        "capital_gains",
    ]
    assert body["liability_total"] is None
    assert body["balance_projected"] is None
    # The withholding side is unaffected — this is one missing comparison, not an outage.
    assert body["total"]["projected"] == "96883.00"
    assert any("married_joint bracket table" in warning for warning in body["warnings"])
```

Add `from tests.test_taxes_api import YEARS as _TAX_YEARS  # noqa: F401` **only if** `YEARS`
is not already defined in `test_withholding_api.py` — it is (`:33`), so use it as-is.

In `backend/tests/test_taxes_api.py`, append:

```python
async def test_what_if_refuses_a_year_whose_status_has_no_tables(auth_client, definitions):
    await seeded_2024(auth_client)
    await set_status(auth_client, 2024, "married_joint")

    resp = await auth_client.post(WHAT_IF, json={"year": 2024})
    assert resp.status_code == 409
    assert "married_joint" in resp.json()["detail"]


async def test_what_if_moves_the_primary_earners_fica_on_a_joint_year(
    auth_client, db, household, definitions
):
    """A what-if leg is the PRIMARY person's sale, so its wage delta lands on their
    bundle — with the partner's own wage base untouched beside it."""
    me, partner = household
    await auth_client.put(
        f"{YEARS}/2026/inputs",
        json={
            "rows": [
                {"key": "latest_w2_income", "person_id": me.id, "value": "100000"},
                {"key": "latest_w2_income", "person_id": partner.id, "value": "100000"},
            ]
        },
    )
    tables = {
        "federal": rows(("0.10", "0")),
        "state": rows(("0.05", "0")),
        "medicare": rows(("0.0145", "0")),
        "social_security": rows(("0.062", "0"), ("0", "150000")),
        "disability": rows(("0.01", "0")),
        "capital_gains": rows(("0.15", "0")),
    }
    for status in ("single", "married_joint"):
        await auth_client.put(
            f"{YEARS}/2026/brackets", json={"filing_status": status, "jurisdictions": tables}
        )
    await set_status(auth_client, 2026, "married_joint")

    body = (
        await auth_client.post(
            WHAT_IF,
            json={"year": 2026, "overrides": {"other_w2_income": "80000"}},
        )
    ).json()
    # Baseline: 100000 + 100000, both under the 150000 base -> 200000 x .062 = 12400.
    assert body["baseline"]["social_security"]["tax"] == "12400.00"
    # Scenario: the primary's bundle becomes 180000, capped at 150000; the partner stays
    # at 100000. (150000 + 100000) x .062 = 15500.
    assert body["scenario"]["social_security"]["tax"] == "15500.00"
    assert body["delta"]["social_security_tax"] == "3100.00"
```

- [ ] **Step 8.2: Run — expect failure** — `cd backend && .venv/Scripts/python.exe -m pytest tests/test_withholding_api.py tests/test_taxes_api.py -q -k "safe_harbor or what_if or refuses"`
Expected: the four new tests fail; the updated dict fails on the two new keys.

- [ ] **Step 8.3: `shift_earners`** — add to `backend/app/services/tax_service.py` immediately after `earner_from_inputs`:

```python
def shift_earners(
    earners: list[EarnerWages] | None,
    before: dict[str, Decimal],
    after: dict[str, Decimal],
) -> list[EarnerWages] | None:
    """Re-base a wage-bundle list onto a what-if scenario's inputs.

    Every what-if leg is the PRIMARY person's — their brokerage lots, their ESPP lots, the
    app models no partner equity — so the whole wage delta lands on the FIRST bundle and
    the partner's own wage base is untouched beside it. `None` (and an empty list) passes
    straight through, so a single-earner year keeps taking the engine's own synthesis
    path and stays byte-identical.
    """
    if not earners:
        return earners

    def delta(key: str) -> Decimal:
        return after.get(key, ZERO) - before.get(key, ZERO)

    head = earners[0]
    return [
        EarnerWages(
            w2_wages=head.w2_wages + delta("latest_w2_income") + delta("other_w2_income"),
            pretax_hsa=head.pretax_hsa
            + delta("hsa_contributions")
            + delta("hsa_contributions_employer"),
            other_pretax=head.other_pretax + delta("other_pretax_deductions"),
        ),
        *earners[1:],
    ]
```

- [ ] **Step 8.4: Schemas** — `backend/app/schemas/taxes.py`:

```python
class SafeHarborOut(BaseModel):
    prior_year: int
    prior_total_tax: Decimal
    # The AGI the statutory gate is tested against, and the multiplier it selected. Both
    # are rendered: a threshold that is not 1.10x the number beside it would otherwise
    # read as a bug.
    prior_agi: Decimal
    multiplier: Decimal  # 1.10 above the gate, 1.00 at or below it
    threshold: Decimal  # prior_total_tax x multiplier
    met: bool  # projected total withholding >= threshold


class WithholdingOut(BaseModel):
    year: int
    filing_status: str = SINGLE
    # See TaxSummaryOut: non-empty only for a married year whose tables are not entered.
    brackets_missing_for_status: list[str] = Field(default_factory=list)
    # Null exactly when the engine refused: the withholding legs below are still real
    # (they come from profiles, grants and prices), but there is nothing honest to compare
    # them against.
    liability_total: Decimal | None
    salary: WithholdingLegOut
    vest: WithholdingVestOut
    total: WithholdingLegOut
    balance_projected: Decimal | None  # liability - projected withholding; positive = will owe
    checks_elapsed: int
    checks_total: int
    safe_harbor: SafeHarborOut | None
    warnings: list[str]
```

- [ ] **Step 8.5: The withholding route** — `backend/app/api/taxes.py`. Replace the safe-harbor constants at `:566`:

```python
# The IRS prior-year safe harbor for high earners; "all-in" here, where the real rule is
# per-jurisdiction (the card's copy says so). The 110% tier applies ONLY above the
# statutory prior-year AGI gate — 150000, halved filing separately (audit §3.2: the
# multiplier shipped, the gate never did).
SAFE_HARBOR_MULTIPLIER = Decimal("1.10")
SAFE_HARBOR_BASE_MULTIPLIER = Decimal("1.00")
SAFE_HARBOR_AGI_GATE = Decimal("150000")
SAFE_HARBOR_AGI_GATE_MFS = Decimal("75000")
SAFE_HARBOR_UNAVAILABLE = "prior year {year} has no computed tax — safe harbor unavailable"
SAFE_HARBOR_NOT_COMPUTABLE = (
    "prior year {year} cannot be computed under its filing status — safe harbor unavailable"
)
```

Then, inside `get_withholding`, replace the table/liability preamble (`:591-597`):

```python
    feed = await _engine_feed(db, year)
    tables = feed.tables
    liability = _breakdown_for(feed) if feed.computable else None
    warnings: list[str] = []
    if not feed.computable:
        warnings.append(feed.warning())
    warnings += [
        JURISDICTION_WARN_MISSING.format(j=name, year=year)
        for name in FICA_JURISDICTIONS
        if not tables.get(name)
    ]
```

replace the liability line (`:693`):

```python
    liability_total = None if liability is None else _money(liability.totals.total_tax)
```

replace the whole safe-harbor block (`:695-717`):

```python
    safe_harbor = None
    if await db.get(TaxYear, year - 1) is not None:
        prior_feed = await _engine_feed(db, year - 1)
        if not prior_feed.computable:
            warnings.append(SAFE_HARBOR_NOT_COMPUTABLE.format(year=year - 1))
        else:
            prior = _breakdown_for(prior_feed)
            # Quantize FIRST, then multiply: the threshold has to be the multiplier times
            # the number rendered beside it, not times a full-precision figure nobody can
            # see. The AGI gate is judged on the displayed figure for the same reason.
            prior_total = _money(prior.totals.total_tax)
            prior_agi = _money(prior.federal.agi)
            if prior_total <= ZERO:
                # A bare tax_years row (or one whose credits swallowed the tax) makes the
                # whole comparison vacuous: any withholding at all clears a zero-or-negative
                # threshold, so a met=True badge would be a false all-clear. Say why instead.
                warnings.append(SAFE_HARBOR_UNAVAILABLE.format(year=year - 1))
            else:
                gate = (
                    SAFE_HARBOR_AGI_GATE_MFS
                    if prior_feed.filing_status == MARRIED_SEPARATE
                    else SAFE_HARBOR_AGI_GATE
                )
                # The PRIOR year's status, not this year's: it is that return's AGI being
                # tested, and the wedding year is precisely when the two differ.
                multiplier = (
                    SAFE_HARBOR_MULTIPLIER if prior_agi > gate else SAFE_HARBOR_BASE_MULTIPLIER
                )
                threshold = _money(prior_total * multiplier)
                safe_harbor = SafeHarborOut(
                    prior_year=year - 1,
                    prior_total_tax=prior_total,
                    prior_agi=prior_agi,
                    multiplier=multiplier,
                    threshold=threshold,
                    # Judged on the DISPLAYED figures (paycheck.py's negative-net posture),
                    # so the badge can never contradict the two numbers rendered next to it.
                    met=total_projected >= threshold,
                )
```

and the response head (`:719-737`):

```python
    return WithholdingOut(
        year=year,
        filing_status=feed.filing_status,
        brackets_missing_for_status=feed.brackets_missing_for_status,
        liability_total=liability_total,
        salary=WithholdingLegOut(
            ytd=_money(estimated.salary_ytd),
            projected=_money(estimated.salary_projected),
        ),
        vest=WithholdingVestOut(
            income_ytd=_money(estimated.vest_income_ytd),
            income_projected=_money(estimated.vest_income_projected),
            supplemental_ytd=_money(estimated.vest_supplemental_ytd),
            supplemental_projected=_money(estimated.vest_supplemental_projected),
            fica_ytd=_money(estimated.vest_fica_ytd),
            fica_projected=_money(estimated.vest_fica_projected),
        ),
        total=WithholdingLegOut(ytd=total_ytd, projected=total_projected),
        # Both sides are already at cents, so this subtracts exactly; `_money` is here for
        # the signed-zero collapse (withholding that lands ON the liability reads "0.00").
        balance_projected=(
            None if liability_total is None else _money(liability_total - total_projected)
        ),
        checks_elapsed=estimated.checks_elapsed,
        checks_total=estimated.checks_total,
        safe_harbor=safe_harbor,
        warnings=warnings,
    )
```

> The `warnings: list[str] = [...]` initialization at `:593` is REPLACED by the block in the
> preamble above — do not leave two.

- [ ] **Step 8.6: The what-if** — in `what_if`, replace the load (`:755-756`) and the two `compute_breakdown` calls (`:873-874`):

```python
    feed = await _engine_feed(db, year)
    if not feed.computable:
        # A POST, not a GET: refusing here is honest, where the summary's GET has to keep
        # answering. Computing a scenario against a single filer's thresholds would give
        # the user a delta they might act on.
        raise HTTPException(status_code=409, detail=feed.warning())
    stored = feed.inputs
    brackets = feed.tables
```

```python
    baseline = _summary_out(
        compute_breakdown(
            year, stored, brackets, filing_status=feed.filing_status, earners=feed.earners
        ),
        feed,
    )
    scenario = _summary_out(
        compute_breakdown(
            year,
            scenario_inputs,
            brackets,
            filing_status=feed.filing_status,
            earners=shift_earners(feed.earners, stored, scenario_inputs),
        ),
        feed,
    )
```

Add `shift_earners` to the `app.services.tax_service` import block and `MARRIED_SEPARATE` to the
`app.tax_keys` one.

- [ ] **Step 8.7: Run to pass** — `cd backend && .venv/Scripts/python.exe -m pytest tests/test_withholding_api.py tests/test_taxes_api.py -q`
Expected: all pass, including the three shipped safe-harbor tests (400000 and 600000 of prior W-2 both clear the 150000 gate, so their thresholds are unchanged).
- [ ] **Step 8.8: RUN GOLDENS** — `cd backend && .venv/Scripts/python.exe -m pytest tests/test_tax_service.py tests/test_tax_service_married.py -q` → 52 + 21 passed.
- [ ] **Step 8.9: Lint** — `cd backend && .venv/Scripts/python.exe -m ruff check app tests && .venv/Scripts/python.exe -m ruff format app tests`
- [ ] **Step 8.10: Commit** — `git add backend/app/services/tax_service.py backend/app/schemas/taxes.py backend/app/api/taxes.py backend/tests/test_withholding_api.py backend/tests/test_taxes_api.py && git commit -m "feat(taxes): safe-harbor AGI gate, status-aware withholding liability, married what-if"`

---

### Task 9: Money flow + Overview — status passthrough and a graceful refusal

**Files:**
- Modify: `backend/app/services/money_flow.py` (reasons `:59-82`, `compose_money_flow` `:137-233`)
- Modify: `backend/app/api/overview.py` (imports `:20`, `money_flow` `:88-89`, the `compose_money_flow` call `:125-134`)
- Modify: `backend/tests/test_money_flow.py`, `backend/tests/test_overview_api.py`

> **Scope fence:** the sankey's SOURCE-NODE aggregation (`SALARY_KEYS`, `RSU_KEY`, `ESPP_KEY`,
> `INVESTMENT_KEYS`, `PRETAX_KEYS`) is NOT touched here — the labelled second-earner node is a
> later plan. What changes is only which engine the tax decomposition comes from, so the
> Overview card's tax total can never disagree with the Taxes page's.

- [ ] **Step 9.1: Write the failing tests** — append to `backend/tests/test_money_flow.py`:

```python
def test_filing_status_and_earners_reach_the_engine():
    """The card's tax decomposition IS compute_breakdown's output, so it has to be handed
    the same status and the same wage split the summary uses — otherwise the Overview
    total and the Taxes total disagree on a married year."""
    from app.services.tax_service import EarnerWages

    earners = [EarnerWages(w2_wages=D("120000")), EarnerWages(w2_wages=D("110000"))]
    brackets = dict(BRACKETS) | {
        "social_security": [(D("0.062"), D("0")), (D("0"), D("150000"))]
    }
    inputs = dict(INPUTS) | {"latest_w2_income": D("230000"), "other_w2_income": D("0")}

    shared = compose_money_flow(
        year=2026,
        inputs=inputs,
        brackets=brackets,
        category_sums={},
        net_pay_sum=D("0"),
        net_pay_months=0,
        spending_months=0,
        available_years=[2026],
    )
    split = compose_money_flow(
        year=2026,
        inputs=inputs,
        brackets=brackets,
        category_sums={},
        net_pay_sum=D("0"),
        net_pay_months=0,
        spending_months=0,
        available_years=[2026],
        filing_status="married_joint",
        earners=earners,
    )
    # One shared base: 150000 x .062. Two bases: 230000 x .062.
    assert shared.taxes.social_security == D("150000") * D("0.062")
    assert split.taxes.social_security == D("230000") * D("0.062")
    assert split.taxes.total > shared.taxes.total


def test_missing_status_brackets_refuse_to_render():
    from app.services.money_flow import BRACKETS_MISSING_REASON, BRACKETS_MISSING_WARNING

    flow = compose_money_flow(
        year=2026,
        inputs=INPUTS,
        brackets={},
        category_sums={"Groceries": D("1000")},
        net_pay_sum=D("50000"),
        net_pay_months=12,
        spending_months=12,
        available_years=[2026],
        filing_status="married_joint",
        brackets_missing_for_status=["federal", "medicare"],
    )
    assert flow.renderable is False
    assert flow.reason == BRACKETS_MISSING_REASON.format(
        year=2026, status="married_joint", jurisdictions="federal, medicare"
    )
    # It wins the ladder: with no tables the residual would ALSO be wrong, and naming the
    # residual would send the user hunting for a data error that is not there.
    assert BRACKETS_MISSING_WARNING.format(
        year=2026, status="married_joint", jurisdictions="federal, medicare"
    ) in flow.warnings
    # Everything it COULD compute still rides along (the module's stated posture).
    assert flow.take_home_cash == D("50000")
    assert flow.total_spend == D("1000")
```

and to `backend/tests/test_overview_api.py`:

```python
async def test_money_flow_refuses_a_married_year_without_its_tables(auth_client, db):
    """The Overview card inherits the engine's refusal instead of drawing a single
    filer's numbers under a married heading."""
    from app.models import TaxInput, TaxInputDefinition, TaxYear
    from app.seed import seed_tax_definitions

    await seed_tax_definitions(db)
    db.add(TaxYear(year=2026, filing_status="married_joint"))
    await db.flush()
    db.add(TaxInput(year=2026, key="latest_w2_income", value=Decimal("200000.0000")))
    await db.commit()
    assert (await db.get(TaxInputDefinition, "latest_w2_income")) is not None

    body = (await auth_client.get("/api/v1/overview/money-flow", params={"year": 2026})).json()
    assert body["renderable"] is False
    assert "married_joint" in body["reason"]
    assert any("married_joint" in warning for warning in body["warnings"])
```

- [ ] **Step 9.2: Run — expect failure** — `cd backend && .venv/Scripts/python.exe -m pytest tests/test_money_flow.py tests/test_overview_api.py -q`
Expected: the three new tests fail (`TypeError: unexpected keyword argument 'filing_status'`).

- [ ] **Step 9.3: `money_flow.py`** — add the two sentences beside the other reasons (`:59-82`):

```python
BRACKETS_MISSING_WARNING = "no {status} bracket tables for {year}: {jurisdictions}"
```

```python
BRACKETS_MISSING_REASON = (
    "{year} is filed as {status}, and {jurisdictions} have no bracket table for that status — "
    "enter them on the Taxes page to draw its money flow."
)
```

replace the signature and the engine call (`:137-161`):

```python
def compose_money_flow(
    year: int,
    inputs: dict[str, Decimal],
    brackets: dict[str, list[Bracket]],
    category_sums: dict[str, Decimal],
    net_pay_sum: Decimal,
    net_pay_months: int,
    spending_months: int,
    available_years: list[int],
    *,
    filing_status: str = SINGLE,
    earners: list[EarnerWages] | None = None,
    brackets_missing_for_status: list[str] | tuple[str, ...] = (),
) -> MoneyFlow:
    """One reconciled year of money flow (spec §5's node table).

    `inputs`/`brackets` are the taxes router's stored shapes, handed to the engine
    verbatim; `category_sums` is the calendar year's SIGNED per-category spend by name;
    `net_pay_sum`/`net_pay_months` are the year's monthly_cashflow sum and coverage;
    `spending_months` counts distinct entered spending months. This function never
    re-derives an engine figure: gross income and every tax line are compute_breakdown's
    own outputs (the state-AGI capital-gains fold rides along for free).

    `filing_status`/`earners` are passed STRAIGHT THROUGH to the engine, so the card's tax
    decomposition is the same arithmetic the Taxes summary shows — with the defaults, that
    is byte-for-byte today's answer. The source-node aggregation below is deliberately
    untouched: a labelled per-person income node is a later plan's work.
    """

    def value(key: str) -> Decimal:
        found = inputs.get(key)
        return ZERO if found is None else found

    breakdown: TaxBreakdown = compute_breakdown(
        year, inputs, brackets, filing_status=filing_status, earners=earners
    )
```

add the warning after the engine passthrough (in the `warnings` block at `:202-214`, first):

```python
    warnings: list[str] = [
        warning for warning in breakdown.warnings if not warning.startswith(_ENGINE_MISSING_PREFIX)
    ]
    if brackets_missing_for_status:
        warnings.append(
            BRACKETS_MISSING_WARNING.format(
                year=year,
                status=filing_status,
                jurisdictions=", ".join(brackets_missing_for_status),
            )
        )
```

and put the refusal FIRST in the ladder (`:219-233`):

```python
    reason: str | None = None
    if brackets_missing_for_status:
        # First, ahead of every data reason: with the wrong-status tables absent, the tax
        # ribbons are zeros and the residual is wrong BECAUSE of that. Naming the residual
        # would send the user hunting for a data error that is not there.
        reason = BRACKETS_MISSING_REASON.format(
            year=year,
            status=filing_status,
            jurisdictions=", ".join(brackets_missing_for_status),
        )
    elif gross_income <= 0:
        reason = (
            NO_INPUTS_REASON.format(year=year)
            if not inputs
            else NON_POSITIVE_GROSS_REASON.format(year=year, gross=_display(gross_income))
        )
    elif other_income < 0:
        reason = NEGATIVE_OTHER_INCOME_REASON.format(year=year, gap=_display(-other_income))
    elif taxes.total < 0:
        reason = NEGATIVE_TAXES_REASON.format(year=year, taxes=_display(taxes.total))
    elif pre_tax_savings < 0:
        reason = NEGATIVE_PRETAX_REASON.format(year=year, pretax=_display(pre_tax_savings))
    elif retained_equity < 0:
        reason = NEGATIVE_RESIDUAL_REASON.format(year=year, gap=_display(-retained_equity))
```

and extend the imports (`:24-29`):

```python
from app.services.tax_service import (
    MISSING_INPUTS_WARNING,
    Bracket,
    EarnerWages,
    TaxBreakdown,
    compute_breakdown,
)
from app.tax_keys import SINGLE
```

- [ ] **Step 9.4: `overview.py`** — replace the import at `:20` and the load at `:88-89`:

```python
from app.api.taxes import YEAR_MAX, YEAR_MIN, _engine_feed, _money
```

```python
    feed = await _engine_feed(db, year)
```

and the `compose_money_flow` call (`:125-134`):

```python
    flow = compose_money_flow(
        year=year,
        inputs=feed.inputs,
        brackets=feed.tables,
        category_sums=category_sums,
        net_pay_sum=net_pay_sum,
        net_pay_months=len(pay_rows),
        spending_months=spending_months,
        available_years=available_years,
        filing_status=feed.filing_status,
        earners=feed.earners,
        brackets_missing_for_status=feed.brackets_missing_for_status,
    )
```

Also update the module docstring's `_stored_inputs`/`_engine_tables` sentence (`:3-5`) to name
`_engine_feed` — one loader, one concept, one owner.

- [ ] **Step 9.5: Run to pass** — `cd backend && .venv/Scripts/python.exe -m pytest tests/test_money_flow.py tests/test_overview_api.py -q`
Expected: all pass; every shipped money-flow test is untouched (all new parameters are keyword-only with defaults).
- [ ] **Step 9.6: RUN GOLDENS** — `cd backend && .venv/Scripts/python.exe -m pytest tests/test_tax_service.py tests/test_tax_service_married.py -q` → 52 + 21 passed.
- [ ] **Step 9.7: Lint** — `cd backend && .venv/Scripts/python.exe -m ruff check app tests && .venv/Scripts/python.exe -m ruff format app tests`
- [ ] **Step 9.8: Commit** — `git add backend/app/services/money_flow.py backend/app/api/overview.py backend/tests/test_money_flow.py backend/tests/test_overview_api.py && git commit -m "feat(taxes): money flow reads the status-aware engine feed and refuses missing married tables"`

---

### Task 10: Importer — partner rows and married tables are invisible to Apply

**Files:**
- Modify: `backend/app/importer/apply.py` (`apply_taxes` `:460-553`)
- Modify: `backend/tests/test_importer_apply.py` (append)

> **This EXTENDS the P0 plan's scoping, it does not replace it.** By now `apply_taxes`
> already deletes only rows whose `key` is in the workbook's parsed key set, and only
> brackets whose `jurisdiction` the workbook parsed. Read the file first and KEEP those
> sets under whatever names P0 gave them (`sheet_keys` / `sheet_jurisdictions` below);
> this task adds the two person/status clauses on top.

- [ ] **Step 10.1: Write the failing test** — append to `backend/tests/test_importer_apply.py`:

```python
async def test_apply_taxes_never_touches_partner_rows_or_married_brackets(db):
    """The marriage-data hazard (audit §9.1), closed for good.

    A re-import may rewrite the PRIMARY person's sheet-tracked values and the single-filer
    bracket tables — that is the sheet-wins contract. It must not see anything else."""
    from app.importer.apply import apply_taxes
    from app.importer.parsers import parse_taxes
    from app.models import Person, TaxBracket, TaxInput

    me = Person(name="Me", is_primary=True)
    partner = Person(name="Partner", is_primary=False)
    db.add_all([me, partner])
    await db.commit()

    report = SheetReport()
    await apply_taxes(db, parse_taxes(sheets()["Taxes"]), report)
    await db.commit()
    # Sheet-written per-person rows land on the PRIMARY person; household rows stay NULL.
    salary = (
        await db.execute(
            select(TaxInput).where(TaxInput.year == 2024, TaxInput.key == "annual_salary")
        )
    ).scalar_one()
    assert salary.person_id == me.id
    interest = (
        await db.execute(
            select(TaxInput).where(TaxInput.year == 2024, TaxInput.key == "interest_total")
        )
    ).scalar_one()
    assert interest.person_id is None
    # Sheet-written brackets are single-filer rows.
    assert {
        row.filing_status
        for row in (await db.execute(select(TaxBracket))).scalars()
    } == {"single"}

    # Now the marriage data, inside a year the sheet DOES cover.
    db.add(TaxInput(year=2024, key="latest_w2_income", person_id=partner.id, value=Decimal("90000")))
    db.add(
        TaxInput(
            year=2024, key="w2_fed_withholding", person_id=partner.id, value=Decimal("12000")
        )
    )
    db.add(
        TaxBracket(
            year=2024,
            jurisdiction="federal",
            filing_status="married_joint",
            bracket_index=1,
            rate=Decimal("0.1000"),
            threshold=Decimal("0.00"),
        )
    )
    await db.commit()

    report2 = SheetReport()
    await apply_taxes(db, parse_taxes(sheets()["Taxes"]), report2)
    await db.commit()

    assert report2.entities["tax_inputs"].deletes == 0
    assert report2.entities["tax_brackets"].deletes == 0
    survivors = (
        (
            await db.execute(
                select(TaxInput).where(
                    TaxInput.year == 2024, TaxInput.person_id == partner.id
                )
            )
        )
        .scalars()
        .all()
    )
    assert sorted(row.key for row in survivors) == ["latest_w2_income", "w2_fed_withholding"]
    assert sorted(row.value for row in survivors) == [Decimal("12000.0000"), Decimal("90000.0000")]
    joint = (
        (
            await db.execute(
                select(TaxBracket).where(TaxBracket.filing_status == "married_joint")
            )
        )
        .scalars()
        .all()
    )
    assert len(joint) == 1
    # ...and the sheet-covered single data still synced exactly as before.
    assert report2.entities["tax_inputs"].skips == 86
    assert report2.entities["tax_brackets"].skips == 14


async def test_apply_taxes_still_syncs_the_primary_persons_rows(db):
    """Immunity is for OTHER people, not for the primary: a cell that leaves the sheet
    still takes the primary's row with it."""
    from app.importer.apply import apply_taxes
    from app.importer.parsers import parse_taxes
    from app.models import Person, TaxInput
    from tests.workbook_builder import default_taxes_rows

    db.add(Person(name="Me", is_primary=True))
    await db.commit()
    report = SheetReport()
    await apply_taxes(db, parse_taxes(sheets()["Taxes"]), report)
    await db.commit()

    trimmed = [row for row in default_taxes_rows() if row[1] != "Annual Salary"]
    report2 = SheetReport()
    await apply_taxes(db, parse_taxes(sheets(taxes=trimmed)["Taxes"]), report2)
    await db.commit()
    assert report2.entities["tax_inputs"].deletes == 2  # 2023 + 2024
    assert (
        await db.execute(select(TaxInput).where(TaxInput.key == "annual_salary"))
    ).scalars().all() == []
```

> If `default_taxes_rows()` labels the salary row differently, read
> `backend/tests/workbook_builder.py` and use the label it actually emits; the assertion is
> "one sheet-tracked key leaves the sheet, and both of its rows go".

- [ ] **Step 10.2: Run — expect failure** — `cd backend && .venv/Scripts/python.exe -m pytest tests/test_importer_apply.py -q -k taxes`
Expected: the partner rows are deleted (`deletes == 2`, not 0) and `person_id` is None on
`annual_salary`.

- [ ] **Step 10.3: Implement** — `backend/app/importer/apply.py`. Add the imports:

```python
from app.models import (
    ...,
    Person,
    ...,
)
from app.services.people import load_people, primary_person
from app.tax_keys import PER_PERSON_KEYS, SINGLE
```

(`Person` is imported for the roster read only; if ruff flags it as unused because
`load_people` covers it, drop it.)

Then, inside `apply_taxes`, after the `known_keys` validation loop:

```python
    # The sheet is ONE person's return: every per-person value it carries is the primary's
    # (spec §7). On a roster-less database the owner stays NULL — which is exactly what
    # every imported row was before the person migration.
    primary = primary_person(await load_people(db))
    primary_id = None if primary is None else primary.id

    def owner_of(key: str) -> int | None:
        return primary_id if key in PER_PERSON_KEYS else None
```

Replace the inputs preload + write + sweep (`:490-516`):

```python
    # Sheet wins on re-import WITHIN imported years; other years are never touched.
    existing_inputs = {
        (i.year, i.key, i.person_id): i
        for i in (
            await db.execute(select(TaxInput).where(TaxInput.year.in_(imported_years)))
        ).scalars()
    }
    sheet_keys = {item.key for item in parsed.inputs}
    incoming_input_keys: set[tuple[int, str, int | None]] = set()
    for item in parsed.inputs:
        key = (item.year, item.key, owner_of(item.key))
        incoming_input_keys.add(key)
        row = existing_inputs.get(key)
        if row is None and key[2] is not None:
            # A row written before the person migration (or before the roster existed)
            # carries NULL on a per-person key: adopt it rather than inserting a second row
            # the (year, key, person) unique constraint would reject.
            row = existing_inputs.get((item.year, item.key, None))
        if row is None:
            db.add(
                TaxInput(
                    year=item.year, key=item.key, person_id=owner_of(item.key), value=item.value
                )
            )
            input_counts.creates += 1
        else:
            _diff_update(
                row,
                {"value": item.value, "person_id": owner_of(item.key)},
                input_counts,
                report,
                f"tax_inputs[{item.year}/{item.key}]",
            )
    for key, row in existing_inputs.items():
        if key in incoming_input_keys:
            continue
        # The sheet's own vocabulary only (the P0 scoping): a key the workbook does not
        # carry was never the sheet's to delete.
        if key[1] not in sheet_keys:
            continue
        # ...and somebody else's row is not the sheet's either. The sheet is one person's
        # return, so it may only retire the primary's rows (and the NULL rows that used to
        # spell the same thing).
        if key[2] is not None and key[2] != primary_id:
            continue
        await db.delete(row)
        input_counts.deletes += 1
        report.add_sample(f"tax_inputs[{key[0]}/{key[1]}]: deleted (cell left sheet)")
```

Replace the brackets preload + write + sweep (`:518-553`):

```python
    # SINGLE-status rows only, at every step: the married tables are dashboard-only data
    # the workbook has no opinion about, so the importer cannot diff, write or delete them.
    existing_brackets = {
        (b.year, b.jurisdiction, b.bracket_index): b
        for b in (
            await db.execute(
                select(TaxBracket).where(
                    TaxBracket.year.in_(imported_years), TaxBracket.filing_status == SINGLE
                )
            )
        ).scalars()
    }
    sheet_jurisdictions = {item.jurisdiction for item in parsed.brackets}
    incoming_bracket_keys: set[tuple[int, str, int]] = set()
    for item in parsed.brackets:
        key = (item.year, item.jurisdiction, item.bracket_index)
        incoming_bracket_keys.add(key)
        row = existing_brackets.get(key)
        fields = {"rate": item.rate, "threshold": item.threshold}
        if row is None:
            db.add(
                TaxBracket(
                    year=item.year,
                    jurisdiction=item.jurisdiction,
                    filing_status=SINGLE,
                    bracket_index=item.bracket_index,
                    **fields,
                )
            )
            bracket_counts.creates += 1
        else:
            _diff_update(
                row,
                fields,
                bracket_counts,
                report,
                f"tax_brackets[{item.year}/{item.jurisdiction}/{item.bracket_index}]",
            )
    # Stale brackets are load-bearing wrong data for the Plan 5 engine — sync-delete them,
    # but only within the jurisdictions the workbook actually parsed (the P0 scoping).
    for key, row in existing_brackets.items():
        if key in incoming_bracket_keys or key[1] not in sheet_jurisdictions:
            continue
        await db.delete(row)
        bracket_counts.deletes += 1
        report.add_sample(f"tax_brackets[{key[0]}/{key[1]}/{key[2]}]: deleted (row left sheet)")
```

> `_diff_update` now carries `person_id` in the inputs `fields` dict so an adopted NULL row
> reports its move in the report samples. If that makes the shipped
> `test_apply_taxes_years_inputs_brackets` count updates where it expected skips, the row was
> genuinely moved — the count is right; adjust nothing and confirm with the sample text.

- [ ] **Step 10.4: Run to pass** — `cd backend && .venv/Scripts/python.exe -m pytest tests/test_importer_apply.py tests/test_import_api.py tests/test_importer_service.py -q`
Expected: all pass, including the two shipped tax tests (`creates == 86` / `skips == 86` /
`skips == 14` — those fixtures seed no `people`, so `owner_of` returns None throughout and the
behavior is bit-for-bit today's).
- [ ] **Step 10.5: RUN GOLDENS** — `cd backend && .venv/Scripts/python.exe -m pytest tests/test_tax_service.py tests/test_tax_service_married.py -q` → 52 + 21 passed.
- [ ] **Step 10.6: Lint** — `cd backend && .venv/Scripts/python.exe -m ruff check app tests && .venv/Scripts/python.exe -m ruff format app tests`
- [ ] **Step 10.7: Commit** — `git add backend/app/importer/apply.py backend/tests/test_importer_apply.py && git commit -m "feat(taxes): importer writes to the primary person and single status, partner and married rows immune"`

---

### Task 11: Full gates + branch verification (orchestrator)

- [ ] **Step 11.1: Whole backend suite** — `cd backend && .venv/Scripts/python.exe -m pytest -q`
Expected: the Step 0.6 baseline plus roughly 55 new tests, **0 failed**. Do not pipe through
`grep`/`head`.
- [ ] **Step 11.2: The golden diff, one last time** — `git diff main -- backend/tests/test_tax_service.py`
Expected: exactly one hunk, `test_suggestion_capital_loss_negative` (Task 4's sanctioned edit).
Anything else means an engine change leaked into a pin — stop and investigate with
superpowers:systematic-debugging.
- [ ] **Step 11.3: Lint + format check** — `cd backend && .venv/Scripts/python.exe -m ruff check app tests && .venv/Scripts/python.exe -m ruff format --check app tests`
- [ ] **Step 11.4: Single alembic head** — `cd backend && .venv/Scripts/python.exe -m alembic heads`
Expected: exactly one line, `e26b9d70a4c1`.
- [ ] **Step 11.5: Full migration round-trip on the DEV database** — from `backend/`:

```bash
.venv/Scripts/python.exe -m alembic downgrade a7e3f1b90c24
.venv/Scripts/python.exe -m alembic downgrade -1
.venv/Scripts/python.exe -m alembic upgrade head
.venv/Scripts/python.exe -m app.seed
```

Expected: all four exit 0, and the seed prints `Seed complete`. Then confirm the real data
survived and was backfilled:

```bash
docker exec finance-dashboard-db-1 psql -U finance -d finance -c \
  "SELECT filing_status, count(*) FROM tax_brackets GROUP BY 1"
docker exec finance-dashboard-db-1 psql -U finance -d finance -c \
  "SELECT d.is_per_person, i.person_id IS NULL AS household, count(*) FROM tax_inputs i \
   JOIN tax_input_definitions d ON d.key = i.key GROUP BY 1, 2 ORDER BY 1, 2"
```

Expected: every bracket row is `single`; and the second query shows **exactly two** rows —
`(false, true)` household lines and `(true, false)` person lines. A `(true, true)` row means
the backfill missed a per-person key; a `(false, false)` row means a household key acquired an
owner. Either is a stop-and-fix.
- [ ] **Step 11.6: Frontend is untouched but must still build** — `npm run build && npx eslint .`
Expected: clean. (No `src/` file changed in this plan; the response shapes are additive, and
`src/types/api.ts` is the NEXT plan's to update.)
- [ ] **Step 11.7: One live sanity pass** — with the API running, on a SCRATCH year only:

```bash
curl -s -X PUT  localhost:8000/api/v1/taxes/years/2099/inputs -H 'Content-Type: application/json' -d '{"values":{"latest_w2_income":"200000"}}' -H "Authorization: Bearer $TOKEN" > /dev/null
curl -s -X PATCH localhost:8000/api/v1/taxes/years/2099 -H 'Content-Type: application/json' -d '{"filing_status":"married_joint"}' -H "Authorization: Bearer $TOKEN"
curl -s localhost:8000/api/v1/taxes/years/2099/summary -H "Authorization: Bearer $TOKEN"
curl -s -X DELETE localhost:8000/api/v1/taxes/years/2099 -H "Authorization: Bearer $TOKEN" -o /dev/null -w '%{http_code}\n'
```

Expected: the summary answers 200 with `brackets_missing_for_status` listing all six and null
sections; the delete answers 204. **Never run this against 2023–2026** — those are the user's
real years.
- [ ] **Step 11.8: Branch review** — one reviewer subagent over `main..HEAD`, spec-compliance
(`docs/superpowers/specs/2026-08-26-household-foundation-married-taxes-design.md` §4, §5.3–5.5,
§7–§8) then code quality. Fix Important+ findings.
- [ ] **Step 11.9: Merge** — `git checkout main && git merge --no-ff tax-schema-engine -m "merge: tax schema + engine — filing status end to end (backend)"`. **Do not push.**

---

## What this plan deliberately does NOT do

| Deferred | Owner |
|---|---|
| Filing-status selector, per-person input columns, bracket status tabs, MFS caveat copy, `src/types/api.ts` | Taxes UI plan |
| Two-earner withholding tracker (partner wages + the two tracker keys actually read), the Additional-Medicare under-withholding callout | Withholding plan |
| A labelled second-earner SOURCE node in the sankey (`SALARY_KEYS` and friends) | Money-flow plan |
| Per-person paycheck profiles, biweekly cadence, `PAYCHECKS_PER_YEAR` | P3 |
| CA mental-health surtax, CA renter's credit, MFS both-must-itemize, exemption credit x filer count | data-only / later |
| Marriage penalty-vs-bonus calculator (`POST /what-if` multi-scenario) | P5 |

## Risks

| Risk | Mitigation in this plan |
|---|---|
| Golden drift during the engine refactor | `earners=None` synthesizes today's bundle; every sum starts from `ZERO` so a one-earner list is the identical expression tree; an explicit RUN GOLDENS step after every engine-touching task, plus a parametrized identity test across all four golden years (Task 3, Step 3.1) |
| The capital-loss clamp moves a pinned suggestion | Called out as the ONE sanctioned edit, with the pre-clamp netting preserved as an assertion and a `git diff` check at Step 11.2 |
| `SafeHarborOut` / `TaxYearOut` dict-equality tests | Both updates are named exactly (Steps 8.1 and 5.2); no other shipped assertion changes |
| MFJ selected with no MFJ tables | `brackets_missing_for_status` end to end — summary, trend feed, withholding card, money-flow card — with the what-if 409ing rather than answering |
| A partner row leaking into a settled single year | `_return_people` scopes aggregation by status; pinned by `test_married_separate_covers_the_primary_person_alone` |
| `create_all` test databases have no `people` roster | Every path treats an empty roster as "person_id stays NULL" (`_owner_column`, `primary_person`, `owner_of`), which is the pre-migration spelling — that is why ~40 shipped tests need no edits |
| PG15+ requirement for `NULLS NOT DISTINCT` | docker-compose pins `postgres:16.14-alpine`; Step 2.13 verifies the DDL actually rendered the clause |
| Chaining onto the wrong head | Step 0.3 captures it; it is the single substitution in the plan, and Step 11.4 re-checks for one head |
