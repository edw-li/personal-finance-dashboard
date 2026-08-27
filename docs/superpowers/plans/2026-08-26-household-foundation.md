# Household Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the single-person dashboard a household. Two additive migrations create a `people` registry (exactly one primary, database-enforced) and an `accounts.person_id` owner column where NULL means *joint* (every existing account is backfilled to the primary person, so NULL never means "unknown"); a new `/api/v1/household` router owns the people list and the marriage date under its own `app_settings` key; the accounts CRUD API finally exposes `person_id`, `parent_account_id` and `is_component`; and Settings gains the three management cards the app has never had — **Household**, **Accounts** and **Spending categories** — which is what makes "add and track partner accounts" possible without curl.

**Architecture:** Additive-only. `people` is a new table with a PARTIAL unique index (`... ON people (is_primary) WHERE is_primary`) so any number of members coexist while a second primary is impossible; the index is declared on the model as well as in the migration because the test database is built by `Base.metadata.create_all`, which never runs migrations (the `ux_dividend_auto_event` precedent). `accounts.person_id` is a nullable FK with `ondelete="SET NULL"`; the migration backfills every row to the primary person. The marriage date is written by the *household* router into `app_settings['marriage_date']` with the readers' `{"value": ...}` envelope — deliberately NOT a fourth field on the settings router's rigid three-field PUT, which silently drops any key not added to the schema, the router loop and `SettingsPage.boxesFor` together (audit §2.2). On the accounts router, the existing "an explicit null is always a no-op" rule (correct while every patchable column was NOT NULL) gains an exception list: `person_id` and `parent_account_id` are the two nullable columns, so `"person_id": null` is a *write* (retag to joint), not a no-op. On the frontend the three cards each own their fetch and error state (SystemCard's posture), except that the people list is lifted from HouseholdCard to SettingsPage and passed down to AccountsCard, so a partner added above is selectable as an owner below without a reload.

**Tech Stack:** FastAPI + SQLAlchemy 2 async + Postgres 16 + Alembic (real-DB pytest), React 19 + TypeScript + Vitest. No new dependencies. Two Alembic migrations, chained on the current head `c4d1e8a2b9f3`.

**Spec:** `docs/superpowers/specs/2026-08-26-household-foundation-married-taxes-design.md` §4 (people/accounts rows), §5.1 (household API), §5.2 (accounts CRUD extension), §6 (Settings cards). Evidence: `docs/superpowers/specs/2026-08-26-marriage-readiness-audit.md` §2.2, §3.1. **Do NOT flip either spec's status line when done** — this plan is wave 2 of six; the orchestrator tracks batch status.

**Scope boundary (wave 1 of the household work).** In scope: the two migrations, the household API, the accounts API extension, the three Settings cards, tests. Explicitly NOT in this plan: `owner=` query params on `/timeseries` and `/summary`, net-worth owner chips, wizard owner grouping, the global All/Me/Partner shell toggle, anything filing-status or tax related, `HouseholdProvider`. Those are waves 3–6 and depend on the API contract pinned below.

**Pinned API contract (other plans depend on this EXACTLY):**

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/v1/household` | — | `{"people": [{id, name, is_primary}], "marriage_date": "YYYY-MM-DD"\|null}` |
| POST | `/api/v1/household/people` | `{"name": str}` | 201 `{id, name, is_primary}` (`is_primary` always false); 409 on duplicate name; 422 on blank |
| PATCH | `/api/v1/household/people/{person_id}` | `{"name": str}` | 200 `{id, name, is_primary}`; 404 unknown; 409 name in use; 422 blank. `is_primary` immutable |
| PUT | `/api/v1/household/marriage-date` | `{"marriage_date": "YYYY-MM-DD"\|null}` | 200 `{"marriage_date": ...}` |

No person DELETE route exists at all.

**House rules that bind every task:** GETs never reject stored data (malformed stored blobs read as absent, never 500); server sentences render verbatim in the UI; Decimal/date strings on the wire; comments explain constraints, not narration; migrations chain onto the current head and a shipped revision is immutable (README §4.3); no file deletions; never push.

---

## File structure

| File | Responsibility |
|---|---|
| `backend/app/models/household.py` | `Person` (new file) — table + partial unique index |
| `backend/app/models/__init__.py` | export `Person` |
| `backend/app/models/net_worth.py` | `Account.person_id` |
| `backend/alembic/versions/20260826_0900_f3a91c7e2b45_people_table.py` | migration A (new) |
| `backend/alembic/versions/20260826_0905_a8d24b6e9107_accounts_person_owner.py` | migration B (new) |
| `backend/app/seed.py` | `seed_people` — the create_all/dev-box counterpart of migration A's seed |
| `backend/app/schemas/household.py` | `PersonOut/Create/Update`, `MarriageDateIn/Out`, `HouseholdOut` (new) |
| `backend/app/api/household.py` | `/household` router (new) |
| `backend/app/main.py` | register the household router |
| `backend/app/schemas/net_worth.py` | `person_id` + `parent_account_id` on Out/Create/Update |
| `backend/app/api/net_worth.py` | nullable-field exception list + FK validation |
| `backend/tests/test_models_household.py` | model constraints (new) |
| `backend/tests/test_household_api.py` | household API (new) |
| `backend/tests/test_net_worth_api.py` | owner/parent round-trip + link validation |
| `backend/tests/test_seed.py` | `seed_people` pin |
| `src/types/api.ts` | `PersonOut`, `HouseholdOut`, `MarriageDateOut`, `AccountUpdate`, `CategoryCreate`, `CategoryUpdate`; `AccountOut.person_id` |
| `src/api/household.ts` | `fetchHousehold`, `createPerson`, `updatePerson`, `putMarriageDate` (new) |
| `src/api/netWorth.ts` | `updateAccount`, `deleteAccount` (`createAccount` already exists, unused) |
| `src/api/spending.ts` | `createCategory`, `updateCategory`, `deleteCategory` |
| `src/components/settings/HouseholdCard.tsx` (+test) | Household card (new) |
| `src/components/settings/AccountsCard.tsx` (+test) | Accounts manager (new) |
| `src/components/settings/CategoriesCard.tsx` (+test) | Categories manager (new) |
| `src/components/settings/settings.css` | the three cards' rules |
| `src/pages/SettingsPage.tsx` (+test) | mount the cards; lift the people list |
| `src/utils/accounts.test.ts`, `src/pages/MonthlyUpdatePage.test.tsx` | fixtures gain `person_id` (tsc -b includes `src/**`) |

NOT touched, on purpose: `backend/app/services/net_worth_calc.py` (owner filtering is wave 3), `backend/app/importer/apply.py` (the importer never sets an owner; new accounts it creates land as joint until retagged — recorded as a forward note below), `src/pages/NetWorthPage.tsx`, `src/pages/MonthlyUpdatePage.tsx`.

---

## Phase 0 — Environment verification

### Task 0: Verify the checkout, the venv and the database

**Files:** none (environment only)

- [ ] **Step 1: Confirm a clean tree and the branch.**

```bash
cd /c/Users/edyli/personal-finance-dashboard && git status --porcelain
cd /c/Users/edyli/personal-finance-dashboard && git rev-parse --abbrev-ref HEAD
```

Expected: empty porcelain output. If the tree is dirty or the branch is not the one the orchestrator prepared, STOP and report — do not stash or switch.

- [ ] **Step 2: Backend smoke** (proves the venv and the dev Postgres answer).

Run: `cd backend && .venv/Scripts/python -m pytest tests/test_health.py -q`
Expected: `1 passed`. If it fails on connection, run `cd backend && docker compose up -d db` and retry once; if it still fails, read `backend/app/config.py` for the dev `DATABASE_URL` default — do not guess.

- [ ] **Step 3: Confirm the migration head is what this plan chains onto.**

Run: `cd backend && .venv/Scripts/python -m alembic heads`
Expected: exactly one line — `c4d1e8a2b9f3 (head)`. If there are two heads, STOP and report.

- [ ] **Step 4: Frontend smoke.**

Run: `npx vitest run src/utils/accounts.test.ts`
Expected: PASS.

---

## Phase 1 — Schema

### Task 1: `people` table — the registry, with exactly one primary

**Files:**
- Create: `backend/app/models/household.py`
- Modify: `backend/app/models/__init__.py` (import block :1-35, `__all__` :37-76)
- Create: `backend/alembic/versions/20260826_0900_f3a91c7e2b45_people_table.py`
- Test: `backend/tests/test_models_household.py` (new)

- [ ] **Step 1: Write the failing test.** Create `backend/tests/test_models_household.py`:

```python
"""Person model constraints (2026-08-26 spec §4).

The exactly-one-primary invariant is the DATABASE's job, not the router's: a partial
unique index over is_primary constrains only the TRUE rows, so any number of non-primary
members coexist while a second primary is impossible. The index is declared on the model
because this test database is built by Base.metadata.create_all, which never runs
migrations (the ux_dividend_auto_event precedent)."""

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models import Person


async def test_person_defaults_to_not_primary(db):
    person = Person(name="Partner")
    db.add(person)
    await db.commit()
    assert person.is_primary is False


async def test_a_second_primary_is_impossible(db):
    db.add(Person(name="Me", is_primary=True))
    await db.commit()
    db.add(Person(name="Partner", is_primary=True))
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()


async def test_any_number_of_non_primary_members_coexist(db):
    db.add(Person(name="Me", is_primary=True))
    await db.commit()
    db.add_all([Person(name="Partner"), Person(name="Roommate")])
    await db.commit()
    names = (await db.execute(select(Person.name).order_by(Person.id))).scalars().all()
    assert list(names) == ["Me", "Partner", "Roommate"]


async def test_person_name_is_unique(db):
    db.add(Person(name="Me", is_primary=True))
    await db.commit()
    db.add(Person(name="Me"))
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()
```

- [ ] **Step 2: Run to verify failure** — `cd backend && .venv/Scripts/python -m pytest tests/test_models_household.py -q`
Expected: collection error — `ImportError: cannot import name 'Person' from 'app.models'`.

- [ ] **Step 3: Create the model.** New file `backend/app/models/household.py`:

```python
from sqlalchemy import Index, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Person(Base):
    """A household member. A NULL person_id on an owned row means JOINT/household — never
    a missing owner — so this table holds real people only (2026-08-26 spec §4). No delete
    endpoint exists: rows here are referenced by accounts (and, later, tax inputs)."""

    __tablename__ = "people"
    __table_args__ = (
        # Exactly-one-primary. PARTIAL, so only the TRUE rows are constrained: any number
        # of non-primary members coexist and a second primary is impossible. Mirrored in
        # migration f3a91c7e2b45; it must live HERE too because the test database is built
        # by Base.metadata.create_all, which never runs migrations (DividendPayment's rule).
        Index(
            "ux_people_single_primary",
            "is_primary",
            unique=True,
            postgresql_where=text("is_primary"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    is_primary: Mapped[bool] = mapped_column(default=False)
```

- [ ] **Step 4: Export it.** In `backend/app/models/__init__.py`, insert this import line between the `from app.models.credit_cards import (...)` block and `from app.models.net_worth import ...` (modules are alphabetical: app_setting, calendar, comp, credit_cards, household, net_worth, …):

```python
from app.models.household import Person
```

and add `"Person",` to `__all__` between `"PaycheckProfile",` and `"PortfolioValueHistory",`.

- [ ] **Step 5: Run to pass** — `cd backend && .venv/Scripts/python -m pytest tests/test_models_household.py -q`
Expected: `4 passed`.

- [ ] **Step 6: Generate the migration file.**

Run: `cd backend && .venv/Scripts/python -m alembic revision -m "people table"`

This creates `backend/alembic/versions/<timestamp>_<generated_rev>_people_table.py` already chained onto `c4d1e8a2b9f3`. **Rename that file to `20260826_0900_f3a91c7e2b45_people_table.py` and replace its entire contents with the block below** (which pins the revision id this plan's second migration chains onto):

```python
"""people table

Household foundation (2026-08-26 spec §4): a `people` registry with exactly one primary
member, seeded with the single row every existing table already implies. Purely additive —
nothing references it yet; accounts.person_id chains next.

Revision ID: f3a91c7e2b45
Revises: c4d1e8a2b9f3
Create Date: 2026-08-26 09:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f3a91c7e2b45"
down_revision: str | Sequence[str] | None = "c4d1e8a2b9f3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "people",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("is_primary", sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_people")),
        sa.UniqueConstraint("name", name=op.f("uq_people_name")),
    )
    # Exactly-one-primary, enforced by the database rather than by application code: a
    # PARTIAL unique index constrains only the TRUE rows. Mirrored on the model, which is
    # what builds the pytest database (Base.metadata.create_all runs no migrations).
    op.create_index(
        "ux_people_single_primary",
        "people",
        ["is_primary"],
        unique=True,
        postgresql_where=sa.text("is_primary"),
    )
    # The row every existing table already means. Named "Me" and renameable in Settings;
    # the primary flag never moves.
    op.execute("INSERT INTO people (name, is_primary) VALUES ('Me', true)")


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ux_people_single_primary", table_name="people")
    op.drop_table("people")
```

- [ ] **Step 7: Apply and verify one head.**

```bash
cd backend && .venv/Scripts/python -m alembic upgrade head
cd backend && .venv/Scripts/python -m alembic heads
```

Expected: the upgrade logs `Running upgrade c4d1e8a2b9f3 -> f3a91c7e2b45`, and `heads` prints exactly one line — `f3a91c7e2b45 (head)`.

- [ ] **Step 8: Verify the seeded row landed.**

```bash
cd backend && docker compose exec -T db psql -U finance -d finance -c "SELECT id, name, is_primary FROM people"
```

Expected: exactly one row — `Me | t`. If `docker compose exec` is unavailable in this environment (or the credentials differ — read `backend/docker-compose.yml` rather than guessing), accept Step 7's `Running upgrade c4d1e8a2b9f3 -> f3a91c7e2b45` log plus the green model suite as the evidence, and note it in the task report.

- [ ] **Step 9: Commit.**

```bash
git add backend/app/models/household.py backend/app/models/__init__.py backend/alembic/versions/20260826_0900_f3a91c7e2b45_people_table.py backend/tests/test_models_household.py
git commit -m "feat(household): people table with a database-enforced single primary"
```

---

### Task 2: `seed_people` — the create_all/dev-box counterpart of the migration seed

Migration A seeds the primary row on every deployed database. A database built by
`Base.metadata.create_all` (pytest, a scratch dev box) never runs migrations, and
`start.sh` runs `python -m app.seed` after `alembic upgrade head` on every boot — so the
seed is the second, idempotent door onto the same invariant.

**Files:**
- Modify: `backend/app/seed.py` (imports :10, new function after `seed_admin_user` :15-23, `seed()` :54-60)
- Test: `backend/tests/test_seed.py` (imports :3-6, append at end)

- [ ] **Step 1: Write the failing test.** In `backend/tests/test_seed.py`, change the two import lines

```python
from app.models import AppSetting, TaxInputDefinition, User
from app.seed import seed_admin_user, seed_app_settings, seed_tax_definitions
```

to

```python
from app.models import AppSetting, Person, TaxInputDefinition, User
from app.seed import seed_admin_user, seed_app_settings, seed_people, seed_tax_definitions
```

and append:

```python
async def test_seed_people_creates_the_primary_member_once(db):
    await seed_people(db)
    await db.commit()
    person = (await db.execute(select(Person))).scalar_one()
    assert (person.name, person.is_primary) == ("Me", True)

    # Empty-table-only, not key-by-key: a renamed primary must survive every boot, and a
    # second is_primary row would trip ux_people_single_primary at start-up — which is a
    # bricked deploy, the exact failure class the seed guard exists to prevent.
    person.name = "Ed"
    await db.commit()
    await seed_people(db)
    await db.commit()
    rows = (await db.execute(select(Person))).scalars().all()
    assert [(p.name, p.is_primary) for p in rows] == [("Ed", True)]
```

- [ ] **Step 2: Run to verify failure** — `cd backend && .venv/Scripts/python -m pytest tests/test_seed.py -q`
Expected: collection error — `ImportError: cannot import name 'seed_people' from 'app.seed'`.

- [ ] **Step 3: Implement.** In `backend/app/seed.py`, change the models import line

```python
from app.models import AppSetting, TaxInputDefinition, User
```

to

```python
from app.models import AppSetting, Person, TaxInputDefinition, User
```

Insert this function directly after `seed_admin_user` (before `seed_tax_definitions`):

```python
async def seed_people(db: AsyncSession) -> None:
    # Insert-only, and only into an EMPTY table. Migration f3a91c7e2b45 seeds the primary
    # row on every deployed database; this is the door for one built by
    # Base.metadata.create_all (pytest, a scratch dev box). Never re-adds a row the user
    # renamed, and never a second is_primary row — that would trip
    # ux_people_single_primary at boot, which start.sh has no way to recover from.
    existing = (await db.execute(select(Person))).scalars().first()
    if existing is None:
        db.add(Person(name="Me", is_primary=True))
        print("Created household member Me")
```

and add the call inside `seed()`, between `seed_admin_user` and `seed_tax_definitions`:

```python
async def seed() -> None:
    async with SessionLocal() as db:
        await seed_admin_user(db)
        await seed_people(db)
        await seed_tax_definitions(db)
        await seed_app_settings(db)
        await db.commit()
    print("Seed complete")
```

Also update the module docstring's first line from
`"""Idempotent seed: admin user, tax input definitions, app settings. Run: python -m app.seed"""`
to
`"""Idempotent seed: admin user, household primary, tax input definitions, app settings. Run: python -m app.seed"""`

- [ ] **Step 4: Run to pass** — `cd backend && .venv/Scripts/python -m pytest tests/test_seed.py -q`
Expected: `7 passed`.

- [ ] **Step 5: Commit.**

```bash
git add backend/app/seed.py backend/tests/test_seed.py
git commit -m "feat(household): idempotent seed_people for create_all databases"
```

---

### Task 3: `accounts.person_id` — nullable owner, NULL means joint

**Files:**
- Modify: `backend/app/models/net_worth.py` (`Account`, :12-30)
- Create: `backend/alembic/versions/20260826_0905_a8d24b6e9107_accounts_person_owner.py`
- Test: `backend/tests/test_models_household.py` (append)

- [ ] **Step 1: Write the failing test.** Append to `backend/tests/test_models_household.py`:

```python
async def test_account_owner_is_nullable_and_null_means_joint(db):
    person = Person(name="Me", is_primary=True)
    db.add(person)
    await db.flush()
    joint = Account(name="Joint Checking", slug="joint-checking", group="cash")
    mine = Account(name="Fidelity HSA", slug="fidelity-hsa", group="pre_tax", person_id=person.id)
    db.add_all([joint, mine])
    await db.commit()
    # NULL is JOINT, not "unknown": migration a8d24b6e9107 backfilled every pre-existing
    # account to the primary person, so an unset owner is a deliberate statement.
    assert joint.person_id is None
    assert mine.person_id == person.id
```

and extend the models import at the top of the file from

```python
from app.models import Person
```

to

```python
from app.models import Account, Person
```

- [ ] **Step 2: Run to verify failure** — `cd backend && .venv/Scripts/python -m pytest tests/test_models_household.py -q`
Expected: FAIL — `TypeError: 'person_id' is an invalid keyword argument for Account`.

- [ ] **Step 3: Add the column.** In `backend/app/models/net_worth.py`, append these lines to the end of the `Account` class (directly after the `parent_account_id` mapped_column closing paren):

```python
    # NULL = JOINT/household, never "unknown": migration a8d24b6e9107 backfilled every
    # pre-existing account to the primary person, so an unset owner is a deliberate
    # statement (2026-08-26 spec §4). SET NULL on delete is belt-and-braces — the API
    # offers no person delete at all.
    person_id: Mapped[int | None] = mapped_column(
        ForeignKey("people.id", ondelete="SET NULL"), default=None
    )
```

(`ForeignKey` is already imported on line 4 of that file.)

- [ ] **Step 4: Run to pass** — `cd backend && .venv/Scripts/python -m pytest tests/test_models_household.py -q`
Expected: `5 passed`.

- [ ] **Step 5: Generate the migration file.**

Run: `cd backend && .venv/Scripts/python -m alembic revision -m "accounts person owner"`

**Rename the generated file to `20260826_0905_a8d24b6e9107_accounts_person_owner.py` and replace its entire contents with:**

```python
"""accounts person owner

Household foundation (2026-08-26 spec §4): accounts.person_id — a nullable FK to people
where NULL means JOINT/household. Every existing account is backfilled to the primary
person, so NULL keeps meaning exactly what it says going forward.

Revision ID: a8d24b6e9107
Revises: f3a91c7e2b45
Create Date: 2026-08-26 09:05:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a8d24b6e9107"
down_revision: str | Sequence[str] | None = "f3a91c7e2b45"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("accounts", sa.Column("person_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_accounts_person_id_people",
        "accounts",
        "people",
        ["person_id"],
        ["id"],
        ondelete="SET NULL",
    )
    # Backfill EVERY existing account to the primary person. NULL is reserved for genuine
    # joint accounts from here on, so an un-backfilled roster would silently read as "all
    # joint" the moment owner views land. The scalar subquery is safe: the partial unique
    # index ux_people_single_primary caps the primary at one row, and a database with none
    # simply leaves person_id NULL rather than failing.
    op.execute(
        "UPDATE accounts SET person_id = (SELECT id FROM people WHERE is_primary) "
        "WHERE person_id IS NULL"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint("fk_accounts_person_id_people", "accounts", type_="foreignkey")
    op.drop_column("accounts", "person_id")
```

- [ ] **Step 6: Apply and verify one head.**

```bash
cd backend && .venv/Scripts/python -m alembic upgrade head
cd backend && .venv/Scripts/python -m alembic heads
```

Expected: `Running upgrade f3a91c7e2b45 -> a8d24b6e9107`, then exactly one line — `a8d24b6e9107 (head)`.

- [ ] **Step 7: Prove the backfill on the real dev database.**

```bash
cd backend && docker compose exec -T db psql -U finance -d finance -c "SELECT count(*) FILTER (WHERE person_id IS NULL) AS joint, count(*) FILTER (WHERE person_id IS NOT NULL) AS owned FROM accounts"
```

Expected: `joint = 0` and `owned` = the full account count. If `joint > 0`, the `people` seed row is missing — STOP and report. (If `docker compose exec` is unavailable, note it and rely on Step 6's log plus the API round-trip test in Task 6.)

- [ ] **Step 8: Commit.**

```bash
git add backend/app/models/net_worth.py backend/alembic/versions/20260826_0905_a8d24b6e9107_accounts_person_owner.py backend/tests/test_models_household.py
git commit -m "feat(household): accounts.person_id — nullable owner, NULL means joint"
```

---

## Phase 2 — Backend API

### Task 4: Household router — GET, POST /people, PATCH /people/{id}

**Files:**
- Create: `backend/app/schemas/household.py`
- Create: `backend/app/api/household.py`
- Modify: `backend/app/main.py` (import block :10-27, router registrations :77-92)
- Test: `backend/tests/test_household_api.py` (new)

- [ ] **Step 1: Write the failing test.** Create `backend/tests/test_household_api.py`:

```python
"""Household API (2026-08-26 spec §5.1): the people registry every owner column points at.

Every test seeds its own primary member: migration f3a91c7e2b45 seeds one on deployed
databases, but this test database is built by Base.metadata.create_all, which never runs
migrations."""

from app.models import Person

HOUSEHOLD = "/api/v1/household"


async def _seed_primary(db) -> Person:
    person = Person(name="Me", is_primary=True)
    db.add(person)
    await db.commit()
    return person


async def test_household_requires_auth(client):
    assert (await client.get(HOUSEHOLD)).status_code == 401


async def test_get_returns_the_people_and_a_null_marriage_date(auth_client, db):
    person = await _seed_primary(db)
    resp = await auth_client.get(HOUSEHOLD)
    assert resp.status_code == 200, resp.text
    assert resp.json() == {
        "people": [{"id": person.id, "name": "Me", "is_primary": True}],
        "marriage_date": None,
    }


async def test_get_on_an_empty_registry_still_answers(auth_client):
    # A GET never rejects the state it finds: an unseeded database is an empty household,
    # not a 500.
    assert (await auth_client.get(HOUSEHOLD)).json() == {"people": [], "marriage_date": None}


async def test_post_person_creates_a_non_primary_member(auth_client, db):
    await _seed_primary(db)
    resp = await auth_client.post(f"{HOUSEHOLD}/people", json={"name": "  Partner  "})
    assert resp.status_code == 201, resp.text
    created = resp.json()
    assert created["name"] == "Partner"  # stored stripped
    # NEVER primary: the seeded row owns that flag for the life of the database, and a
    # second TRUE would surface ux_people_single_primary as an opaque IntegrityError 500.
    assert created["is_primary"] is False

    people = (await auth_client.get(HOUSEHOLD)).json()["people"]
    # Primary first, then by id — the owner selects downstream want "Me" at the top.
    assert [p["name"] for p in people] == ["Me", "Partner"]


async def test_post_person_409s_on_a_duplicate_name(auth_client, db):
    await _seed_primary(db)
    first = await auth_client.post(f"{HOUSEHOLD}/people", json={"name": "Partner"})
    assert first.status_code == 201
    dup = await auth_client.post(f"{HOUSEHOLD}/people", json={"name": "Partner"})
    assert dup.status_code == 409


async def test_post_person_422s_on_a_blank_name(auth_client):
    # Pydantic catches "" at min_length; the router catches whitespace-only, which would
    # otherwise store a display name nothing can render.
    assert (await auth_client.post(f"{HOUSEHOLD}/people", json={"name": ""})).status_code == 422
    assert (await auth_client.post(f"{HOUSEHOLD}/people", json={"name": "   "})).status_code == 422


async def test_patch_person_renames_and_leaves_is_primary_alone(auth_client, db):
    person = await _seed_primary(db)
    resp = await auth_client.patch(
        f"{HOUSEHOLD}/people/{person.id}", json={"name": "Ed", "is_primary": False}
    )
    assert resp.status_code == 200, resp.text
    # is_primary is not on the schema at all, so a body carrying it is IGNORED rather than
    # refused — the invariant is the database's job, not a request's.
    assert resp.json() == {"id": person.id, "name": "Ed", "is_primary": True}


async def test_patch_person_404_409_and_blank(auth_client, db):
    person = await _seed_primary(db)
    assert (
        await auth_client.patch(f"{HOUSEHOLD}/people/999", json={"name": "X"})
    ).status_code == 404
    partner = (await auth_client.post(f"{HOUSEHOLD}/people", json={"name": "Partner"})).json()
    clash = await auth_client.patch(f"{HOUSEHOLD}/people/{partner['id']}", json={"name": "Me"})
    assert clash.status_code == 409
    blank = await auth_client.patch(f"{HOUSEHOLD}/people/{person.id}", json={"name": "  "})
    assert blank.status_code == 422


async def test_there_is_no_person_delete_route(auth_client, db):
    person = await _seed_primary(db)
    # Not 204, not 409 — the route does not exist (spec §5.1). Rows here are referenced by
    # accounts, and "remove a household member" is not something this app models.
    assert (await auth_client.delete(f"{HOUSEHOLD}/people/{person.id}")).status_code == 405
```

- [ ] **Step 2: Run to verify failure** — `cd backend && .venv/Scripts/python -m pytest tests/test_household_api.py -q`
Expected: FAIL — every request 404s (`assert 404 == 401`, `assert 404 == 200`, …) because no `/household` router is mounted.

- [ ] **Step 3: Create the schemas.** New file `backend/app/schemas/household.py`:

```python
"""Household wire shapes (2026-08-26 spec §5.1). Pinned contract — later waves
(net-worth owner views, per-person tax inputs) are written against these exact keys."""

from datetime import date

from pydantic import BaseModel, ConfigDict, Field


class PersonOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    is_primary: bool


class PersonCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class PersonUpdate(BaseModel):
    """Rename only. is_primary is deliberately ABSENT: pydantic ignores unknown keys, so a
    body trying to promote a partner is a silent no-op rather than a 422 — the invariant
    belongs to ux_people_single_primary, not to request validation."""

    name: str = Field(min_length=1, max_length=80)


class MarriageDateIn(BaseModel):
    """Full-form single-field PUT: an explicit null (or an omitted key) CLEARS the stored
    date — the notes:/net_pay: null contract."""

    marriage_date: date | None = None


class MarriageDateOut(BaseModel):
    marriage_date: date | None


class HouseholdOut(BaseModel):
    people: list[PersonOut]
    marriage_date: date | None
```

- [ ] **Step 4: Create the router.** New file `backend/app/api/household.py`:

```python
"""Household vertical (2026-08-26 spec §5.1): the people registry every owner column
points at, plus the marriage date.

The date lives in app_settings under its OWN key, written by THIS router — not by the
settings router's rigid three-field PUT. That form drops any key not added to
schemas/app_settings.py, the router's write loop and SettingsPage's boxesFor together
(audit §2.2), and household config has no business in that trap. Get-then-set on one row
is the accepted single-user TOCTOU class (accounts/securities/taxes precedent).

There is no person DELETE route at all: rows here are referenced by accounts (and, in
later waves, tax inputs), and retiring a household member is not a thing this app models."""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models import AppSetting, Person
from app.schemas.household import (
    HouseholdOut,
    MarriageDateIn,
    MarriageDateOut,
    PersonCreate,
    PersonOut,
    PersonUpdate,
)
from app.services.money import require_reasonable_date

router = APIRouter(
    prefix="/household", tags=["household"], dependencies=[Depends(get_current_user)]
)

MARRIAGE_DATE_KEY = "marriage_date"


async def _read_marriage_date(db: AsyncSession) -> date | None:
    """Degrade-to-None on anything unreadable — the app_settings readers' posture
    (_read_espp_ticker): a malformed stored blob means 'unset', never a 500 on a GET."""
    setting = await db.get(AppSetting, MARRIAGE_DATE_KEY)
    if setting is None or not isinstance(setting.value, dict):
        return None
    raw = setting.value.get("value")
    if not isinstance(raw, str) or not raw.strip():
        return None
    try:
        return date.fromisoformat(raw.strip())
    except ValueError:
        return None


async def _list_people(db: AsyncSession) -> list[Person]:
    # Primary first, then by id: every owner select downstream wants "Me" at the top.
    result = await db.execute(select(Person).order_by(Person.is_primary.desc(), Person.id))
    return list(result.scalars().all())


@router.get("", response_model=HouseholdOut)
async def get_household(db: AsyncSession = Depends(get_db)) -> HouseholdOut:
    return HouseholdOut(
        people=[PersonOut.model_validate(p) for p in await _list_people(db)],
        marriage_date=await _read_marriage_date(db),
    )


@router.post("/people", response_model=PersonOut, status_code=201)
async def create_person(body: PersonCreate, db: AsyncSession = Depends(get_db)) -> Person:
    name = body.name.strip()
    if not name:
        # min_length catches ""; whitespace-only would otherwise store a display name
        # nothing can render (the accounts/categories unsluggable-name rule).
        raise HTTPException(status_code=422, detail="name must not be blank")
    clash = (await db.execute(select(Person).where(Person.name == name))).scalars().first()
    if clash is not None:
        raise HTTPException(status_code=409, detail=f"person {name!r} already exists")
    # NEVER primary: the seeded row owns that flag for the life of the database, and a
    # second TRUE would surface ux_people_single_primary as an opaque IntegrityError 500.
    person = Person(name=name, is_primary=False)
    db.add(person)
    await db.commit()
    return person


@router.patch("/people/{person_id}", response_model=PersonOut)
async def update_person(
    person_id: int, body: PersonUpdate, db: AsyncSession = Depends(get_db)
) -> Person:
    person = await db.get(Person, person_id)
    if person is None:
        raise HTTPException(status_code=404, detail="person not found")
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="name must not be blank")
    if name != person.name:
        clash = (
            (
                await db.execute(
                    select(Person).where(Person.name == name, Person.id != person_id)
                )
            )
            .scalars()
            .first()
        )
        if clash is not None:
            raise HTTPException(status_code=409, detail="person name already in use")
    # Rename ONLY — is_primary is not on the schema, so a body carrying it is ignored.
    person.name = name
    await db.commit()
    return person


@router.put("/marriage-date", response_model=MarriageDateOut)
async def put_marriage_date(
    body: MarriageDateIn, db: AsyncSession = Depends(get_db)
) -> MarriageDateOut:
    stored = ""
    if body.marriage_date is not None:
        # Century guard BEFORE any write: a mistyped year must 422 here, not become an
        # absurd annotation on every trend chart later.
        stored = require_reasonable_date(body.marriage_date, "marriage_date").isoformat()
    # Envelope {"value": ...} is the readers' convention; "" is the stored form of unset,
    # which _read_marriage_date reports back as null.
    setting = await db.get(AppSetting, MARRIAGE_DATE_KEY)
    if setting is None:
        db.add(AppSetting(key=MARRIAGE_DATE_KEY, value={"value": stored}))
    else:
        setting.value = {"value": stored}
    await db.commit()
    return MarriageDateOut(marriage_date=body.marriage_date)
```

- [ ] **Step 5: Register the router.** In `backend/app/main.py`, add `household,` to the `from app.api import (...)` block between `espp,` and `import_,` (the list is alphabetical), and insert this line directly after `app.include_router(net_worth.router, prefix="/api/v1")`:

```python
app.include_router(household.router, prefix="/api/v1")
```

- [ ] **Step 6: Run to pass** — `cd backend && .venv/Scripts/python -m pytest tests/test_household_api.py -q`
Expected: `9 passed`.

- [ ] **Step 7: Commit.**

```bash
git add backend/app/schemas/household.py backend/app/api/household.py backend/app/main.py backend/tests/test_household_api.py
git commit -m "feat(household): /api/v1/household router — people registry"
```

---

### Task 5: `PUT /household/marriage-date` — its own app_settings key

The endpoint was written in Task 4 alongside the rest of the router (one file, one
import block); this task is its test coverage, including the two behaviours the settings
router's shape would have made impossible.

**Files:**
- Test: `backend/tests/test_household_api.py` (append)

- [ ] **Step 1: Write the failing test.** Append to `backend/tests/test_household_api.py`, and extend the models import at the top of the file from `from app.models import Person` to `from app.models import AppSetting, Person`:

```python
async def test_marriage_date_round_trips_through_its_own_key(auth_client, db):
    resp = await auth_client.put(
        f"{HOUSEHOLD}/marriage-date", json={"marriage_date": "2026-09-19"}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"marriage_date": "2026-09-19"}
    assert (await auth_client.get(HOUSEHOLD)).json()["marriage_date"] == "2026-09-19"
    # The readers' envelope, under a key of its OWN — not a fourth field on the legacy
    # three-field settings PUT, where a new key silently drops unless the schema, the
    # router loop and SettingsPage's boxesFor all learn about it together (audit §2.2).
    assert (await db.get(AppSetting, "marriage_date")).value == {"value": "2026-09-19"}


async def test_marriage_date_is_untouched_by_the_settings_put(auth_client):
    await auth_client.put(f"{HOUSEHOLD}/marriage-date", json={"marriage_date": "2026-09-19"})
    saved = await auth_client.put(
        "/api/v1/settings",
        json={
            "swr_pct": "0.045",
            "espp_ticker": "nvda",
            "price_refresh_cron": "10 13 * * mon-fri",
        },
    )
    assert saved.status_code == 200, saved.text
    # The whole point of the separate key: a full-form settings save must not be able to
    # clear household config it has never heard of.
    assert (await auth_client.get(HOUSEHOLD)).json()["marriage_date"] == "2026-09-19"


async def test_marriage_date_explicit_null_clears_it(auth_client):
    await auth_client.put(f"{HOUSEHOLD}/marriage-date", json={"marriage_date": "2026-09-19"})
    resp = await auth_client.put(f"{HOUSEHOLD}/marriage-date", json={"marriage_date": None})
    assert resp.status_code == 200
    assert resp.json() == {"marriage_date": None}
    assert (await auth_client.get(HOUSEHOLD)).json()["marriage_date"] is None


async def test_marriage_date_rejects_an_absurd_year(auth_client):
    bad = await auth_client.put(f"{HOUSEHOLD}/marriage-date", json={"marriage_date": "1026-09-19"})
    assert bad.status_code == 422
    # Nothing was written: validation runs before the get-then-set.
    assert (await auth_client.get(HOUSEHOLD)).json()["marriage_date"] is None


async def test_marriage_date_reader_treats_a_malformed_blob_as_absent(auth_client, db):
    db.add(AppSetting(key="marriage_date", value={"value": "not-a-date"}))
    await db.commit()
    # A GET never rejects stored data (house rule): malformed == absent, never a 500.
    assert (await auth_client.get(HOUSEHOLD)).json()["marriage_date"] is None
```

- [ ] **Step 2: Run** — `cd backend && .venv/Scripts/python -m pytest tests/test_household_api.py -q`
Expected: `14 passed`. (These pass immediately: Task 4 wrote the endpoint. If any fail, the endpoint body is wrong — fix `backend/app/api/household.py`, do not weaken the test.)

- [ ] **Step 3: Commit.**

```bash
git add backend/tests/test_household_api.py
git commit -m "test(household): marriage-date round-trip, clearing, and settings-PUT isolation"
```

---

### Task 6: Accounts API — `person_id`, `parent_account_id`, `is_component`

**Files:**
- Modify: `backend/app/schemas/net_worth.py` (`AccountOut` :15-25, `AccountCreate` :28-35, `AccountUpdate` :38-48)
- Modify: `backend/app/api/net_worth.py` (models import :12, `create_account` :40-71, `update_account` :81-117)
- Test: `backend/tests/test_net_worth_api.py` (append; imports :1-4)

- [ ] **Step 1: Write the failing test.** In `backend/tests/test_net_worth_api.py`, change the models import line

```python
from app.models import Account, AccountBalance, NetWorthSnapshot
```

to

```python
from app.models import Account, AccountBalance, NetWorthSnapshot, Person
```

and append at the end of the file:

```python
async def test_account_owner_and_parent_round_trip(auth_client, db):
    me = Person(name="Me", is_primary=True)
    partner = Person(name="Partner")
    db.add_all([me, partner])
    await db.commit()

    parent = (
        await auth_client.post(
            "/api/v1/net-worth/accounts",
            json={"name": "Partner 401(k)", "group": "pre_tax", "person_id": partner.id},
        )
    ).json()
    assert parent["person_id"] == partner.id
    assert parent["parent_account_id"] is None

    child = (
        await auth_client.post(
            "/api/v1/net-worth/accounts",
            json={
                "name": "Partner Employer Match",
                "group": "pre_tax",
                "person_id": partner.id,
                "parent_account_id": parent["id"],
                "is_component": True,
            },
        )
    ).json()
    # parent_account_id was unreachable via the API until now — a partner's 401(k)
    # component nesting was SQL-only (audit §3.1).
    assert child["parent_account_id"] == parent["id"]
    assert child["is_component"] is True

    # An explicit null is a WRITE on these two columns: retag to joint, unlink the parent.
    resp = await auth_client.patch(
        f"/api/v1/net-worth/accounts/{child['id']}",
        json={"person_id": None, "parent_account_id": None},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["person_id"] is None
    assert resp.json()["parent_account_id"] is None

    # ...while an OMITTED key still leaves the column exactly where it was.
    resp = await auth_client.patch(
        f"/api/v1/net-worth/accounts/{parent['id']}", json={"sort_order": 9}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["person_id"] == partner.id
    assert resp.json()["sort_order"] == 9

    # And a person can be reassigned, not only cleared.
    resp = await auth_client.patch(
        f"/api/v1/net-worth/accounts/{parent['id']}", json={"person_id": me.id}
    )
    assert resp.json()["person_id"] == me.id


async def test_account_link_validation(auth_client, db):
    db.add(Person(name="Me", is_primary=True))
    await db.commit()
    # Unknown FK targets 422 with a sentence, instead of surfacing asyncpg's
    # ForeignKeyViolationError as a 500.
    assert (
        await auth_client.post(
            "/api/v1/net-worth/accounts",
            json={"name": "Ghost Owner", "group": "cash", "person_id": 999},
        )
    ).status_code == 422
    assert (
        await auth_client.post(
            "/api/v1/net-worth/accounts",
            json={"name": "Orphan", "group": "cash", "parent_account_id": 999},
        )
    ).status_code == 422
    # int32-bounded like every other id on this router: garbage 422s rather than
    # surfacing asyncpg's DataError.
    assert (
        await auth_client.post(
            "/api/v1/net-worth/accounts",
            json={"name": "Huge", "group": "cash", "person_id": 2**31},
        )
    ).status_code == 422

    created = (
        await auth_client.post(
            "/api/v1/net-worth/accounts", json={"name": "Solo", "group": "cash"}
        )
    ).json()
    # An account cannot be its own parent: the UI nests components under their parent, and
    # a self-link renders as an account inside itself.
    self_parent = await auth_client.patch(
        f"/api/v1/net-worth/accounts/{created['id']}",
        json={"parent_account_id": created["id"]},
    )
    assert self_parent.status_code == 422
    assert (
        await auth_client.patch(
            f"/api/v1/net-worth/accounts/{created['id']}", json={"person_id": 999}
        )
    ).status_code == 422


async def test_account_defaults_to_joint_when_no_owner_is_sent(auth_client):
    # The API does NOT guess the primary person: the migration backfilled history, and a
    # new account with no owner is a deliberate joint account.
    created = (
        await auth_client.post(
            "/api/v1/net-worth/accounts", json={"name": "New Joint", "group": "cash"}
        )
    ).json()
    assert created["person_id"] is None
```

- [ ] **Step 2: Run to verify failure** — `cd backend && .venv/Scripts/python -m pytest tests/test_net_worth_api.py -q`
Expected: FAIL — `KeyError: 'person_id'` / `assert None == 2` on the first new test (the field is not on `AccountOut` and the router ignores it).

- [ ] **Step 3: Extend the schemas.** In `backend/app/schemas/net_worth.py`, replace the three classes `AccountOut`, `AccountCreate` and `AccountUpdate` (lines 15-48) with:

```python
class AccountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    slug: str
    group: str
    sort_order: int
    is_active: bool
    is_component: bool
    parent_account_id: int | None
    # NULL = JOINT/household (2026-08-26 spec §4), never "unknown": migration a8d24b6e9107
    # backfilled every pre-existing account to the primary person.
    person_id: int | None


class AccountCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    group: str
    # int32-safe and generous; sheet column indexes top out at 51.
    sort_order: int = Field(default=0, ge=0, le=1_000_000)
    is_component: bool = False
    # Both int32-bounded so a garbage id 422s instead of surfacing asyncpg's DataError
    # (BalanceEntry's rule). Omitted or null = joint / no parent; the API never guesses
    # the primary person for a new account.
    person_id: int | None = Field(default=None, ge=1, le=2_147_483_647)
    parent_account_id: int | None = Field(default=None, ge=1, le=2_147_483_647)

    group_known = field_validator("group")(_check_group)


class AccountUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    group: str | None = None
    sort_order: int | None = Field(default=None, ge=0, le=1_000_000)
    is_active: bool | None = None
    is_component: bool | None = None
    # The two NULLABLE account columns. An explicit null here is a WRITE — retag to joint,
    # unlink a component — not the no-op the router's drop-nulls rule applies to the rest.
    person_id: int | None = Field(default=None, ge=1, le=2_147_483_647)
    parent_account_id: int | None = Field(default=None, ge=1, le=2_147_483_647)

    @field_validator("group")
    @classmethod
    def group_known(cls, value: str | None) -> str | None:
        return None if value is None else _check_group(value)
```

- [ ] **Step 4: Extend the router.** In `backend/app/api/net_worth.py`:

(a) change the models import line

```python
from app.models import ACCOUNT_GROUPS, Account, AccountBalance, NetWorthSnapshot
```

to

```python
from app.models import ACCOUNT_GROUPS, Account, AccountBalance, NetWorthSnapshot, Person
```

(b) insert the constant and helper directly below the `router = APIRouter(...)` block and above `list_accounts`:

```python
# The two NULLABLE account columns. Every other patchable column is NOT NULL, so the
# router's explicit-null-is-a-no-op rule must not swallow these: "person_id": null is how
# an account becomes JOINT, and "parent_account_id": null is how a component is unlinked
# (2026-08-26 spec §5.2).
NULLABLE_ACCOUNT_FIELDS = ("person_id", "parent_account_id")


async def _validate_links(
    db: AsyncSession,
    person_id: int | None,
    parent_account_id: int | None,
    account_id: int | None,
) -> None:
    """FK targets checked BEFORE any write, so a bad id 422s with a sentence instead of
    surfacing asyncpg's ForeignKeyViolationError as a 500. Deeper parent cycles (A->B->A)
    are deliberately unguarded: parent_account_id is presentation-only and the UI nests
    exactly one level (nestComponents), so a cycle costs a flat render, not bad money."""
    if person_id is not None and (await db.get(Person, person_id)) is None:
        raise HTTPException(status_code=422, detail=f"unknown person_id: {person_id}")
    if parent_account_id is not None:
        if parent_account_id == account_id:
            raise HTTPException(status_code=422, detail="an account cannot be its own parent")
        if (await db.get(Account, parent_account_id)) is None:
            raise HTTPException(
                status_code=422, detail=f"unknown parent_account_id: {parent_account_id}"
            )
```

(c) in `create_account`, replace the `account = Account(...)` construction (currently the five-kwarg call between the 409 check and `db.add(account)`) with:

```python
    await _validate_links(db, body.person_id, body.parent_account_id, None)
    account = Account(
        name=body.name,
        slug=slug,
        group=body.group,
        sort_order=body.sort_order,
        is_component=body.is_component,
        person_id=body.person_id,
        parent_account_id=body.parent_account_id,
    )
```

(d) in `update_account`, replace the `updates = {...}` dict comprehension with:

```python
    # Every patchable account column is NOT NULL *except* the two in
    # NULLABLE_ACCOUNT_FIELDS, so an explicit null is a no-op request for the rest
    # ("name": null must never reach the ORM) and a real write for those two.
    updates = {
        field: value
        for field, value in body.model_dump(exclude_unset=True).items()
        if value is not None or field in NULLABLE_ACCOUNT_FIELDS
    }
```

(e) in `update_account`, insert this call directly above the `# slug is the importer's natural key` comment (i.e. after the name-clash 409 check, before the `for field, value in updates.items()` loop):

```python
    await _validate_links(
        db, updates.get("person_id"), updates.get("parent_account_id"), account_id
    )
```

- [ ] **Step 5: Run to pass** — `cd backend && .venv/Scripts/python -m pytest tests/test_net_worth_api.py -q`
Expected: all tests pass (the 3 new ones plus every pre-existing one — `test_create_and_list_accounts` still asserts `parent_account_id is None`, which the extended `AccountOut` still answers).

- [ ] **Step 6: Run the two adjacent suites that read accounts, to prove nothing moved.**

Run: `cd backend && .venv/Scripts/python -m pytest tests/test_importer_apply.py tests/test_net_worth_calc.py tests/test_credit_cards_api.py -q`
Expected: all pass. (The importer creates accounts through the ORM, never through `AccountCreate`, so imported accounts land with `person_id = NULL` — i.e. joint — until retagged in the new card. Recorded as a forward note, not a bug: wave 3 owns owner semantics.)

- [ ] **Step 7: Commit.**

```bash
git add backend/app/schemas/net_worth.py backend/app/api/net_worth.py backend/tests/test_net_worth_api.py
git commit -m "feat(household): accounts CRUD accepts person_id, parent_account_id, is_component"
```

---

## Phase 3 — Frontend plumbing

### Task 7: Types and client modules

**Files:**
- Modify: `src/types/api.ts` (`AccountOut` :19-28, `AccountCreate` :30-35, `CategoryOut` :83-89)
- Create: `src/api/household.ts`
- Modify: `src/api/netWorth.ts` (imports :2-10, after `createAccount` :16-21)
- Modify: `src/api/spending.ts` (imports :2-10, after `fetchCategories` :12-14)
- Modify: `src/utils/accounts.test.ts` (:6-14) and `src/pages/MonthlyUpdatePage.test.tsx` (:24-33, :344-352) — fixtures

- [ ] **Step 1: Write the failing test.** Create `src/api/household.test.ts`:

```ts
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPerson, fetchHousehold, putMarriageDate, updatePerson } from './household'

// The client module is a thin path/verb/body mapper; fetch is the seam (client.test.ts's
// arrangement). Every assertion here is about the REQUEST, not the response.
const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

function lastCall(): [string, RequestInit] {
  const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]
  return [call[0] as string, call[1] as RequestInit]
}

it('GETs the household with no trailing slash', async () => {
  await fetchHousehold()
  const [url, init] = lastCall()
  // The router mounts GET at prefix "/household" with an EMPTY route path, so a trailing
  // slash costs a 307 redirect (the /settings precedent).
  expect(url).toBe('/api/v1/household')
  expect(init.method).toBeUndefined()
})

it('POSTs a new person', async () => {
  await createPerson('Partner')
  const [url, init] = lastCall()
  expect(url).toBe('/api/v1/household/people')
  expect(init.method).toBe('POST')
  expect(JSON.parse(init.body as string)).toEqual({ name: 'Partner' })
})

it('PATCHes a rename by id', async () => {
  await updatePerson(2, 'Ed')
  const [url, init] = lastCall()
  expect(url).toBe('/api/v1/household/people/2')
  expect(init.method).toBe('PATCH')
  expect(JSON.parse(init.body as string)).toEqual({ name: 'Ed' })
})

it('PUTs the marriage date, and null EXPLICITLY when cleared', async () => {
  await putMarriageDate('2026-09-19')
  let [url, init] = lastCall()
  expect(url).toBe('/api/v1/household/marriage-date')
  expect(init.method).toBe('PUT')
  expect(JSON.parse(init.body as string)).toEqual({ marriage_date: '2026-09-19' })

  await putMarriageDate(null)
  ;[url, init] = lastCall()
  // The key must SURVIVE JSON.stringify: an undefined value is dropped and the field
  // defaults to None server-side, so "clear the date" and "I forgot to send it" would
  // arrive as the same request (the espp_ticker lesson).
  const body = JSON.parse(init.body as string)
  expect(Object.keys(body)).toContain('marriage_date')
  expect(body.marriage_date).toBeNull()
})
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/api/household.test.ts`
Expected: FAIL — `Failed to resolve import "./household"`.

- [ ] **Step 3: Add the types.** In `src/types/api.ts`, replace `AccountOut` and `AccountCreate` (lines 19-35) with:

```ts
export interface AccountOut {
  id: number
  name: string
  slug: string
  group: AccountGroup
  sort_order: number
  is_active: boolean
  is_component: boolean
  parent_account_id: number | null
  /** NULL = joint/household, never "unknown" — the migration backfilled every row. */
  person_id: number | null
}

export interface AccountCreate {
  name: string
  group: AccountGroup
  sort_order?: number
  is_component?: boolean
  /** Omitted or null = joint; the API never guesses the primary person. */
  person_id?: number | null
  parent_account_id?: number | null
}

export interface AccountUpdate {
  name?: string
  group?: AccountGroup
  sort_order?: number
  is_active?: boolean
  is_component?: boolean
  /** Explicit null RETAGS to joint; an omitted key leaves the owner alone. */
  person_id?: number | null
  /** Explicit null UNLINKS the parent; an omitted key leaves it alone. */
  parent_account_id?: number | null
}
```

Directly below the `CategoryOut` interface (line 89), insert:

```ts
export interface CategoryCreate {
  name: string
  sort_order?: number
}

export interface CategoryUpdate {
  name?: string
  sort_order?: number
  is_active?: boolean
}
```

At the very end of `src/types/api.ts`, append:

```ts
// --- household (2026-08-26 spec §5.1) ---

export interface PersonOut {
  id: number
  name: string
  /** Exactly one row carries it, database-enforced; the API never lets it change. */
  is_primary: boolean
}

export interface HouseholdOut {
  people: PersonOut[]
  marriage_date: string | null
}

export interface MarriageDateOut {
  marriage_date: string | null
}
```

- [ ] **Step 4: Create the household client.** New file `src/api/household.ts`:

```ts
import { api } from './client'
import type { HouseholdOut, MarriageDateOut, PersonOut } from '../types/api'

// Path carries NO trailing slash: the router mounts GET at prefix "/household" with an
// empty route path, so "/household/" costs a 307 redirect (the /settings precedent).
export function fetchHousehold(): Promise<HouseholdOut> {
  return api<HouseholdOut>('/household')
}

export function createPerson(name: string): Promise<PersonOut> {
  return api<PersonOut>('/household/people', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

// Rename only — is_primary is not on the server's schema, so there is nothing else to send.
export function updatePerson(personId: number, name: string): Promise<PersonOut> {
  return api<PersonOut>(`/household/people/${personId}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  })
}

// Explicitly null, never undefined: JSON.stringify DROPS an undefined value and the field
// defaults to None server-side, so "clear the date" and "I forgot to send it" would arrive
// as the same request (the espp_ticker lesson).
export function putMarriageDate(marriageDate: string | null): Promise<MarriageDateOut> {
  return api<MarriageDateOut>('/household/marriage-date', {
    method: 'PUT',
    body: JSON.stringify({ marriage_date: marriageDate }),
  })
}
```

- [ ] **Step 5: Extend the net-worth client.** In `src/api/netWorth.ts`, change the type import block from

```ts
import type {
  AccountCreate,
  AccountOut,
  BalanceEntry,
  MonthBalances,
  MonthUpsertResult,
  NetWorthSummary,
  NetWorthTimeseries,
} from '../types/api'
```

to

```ts
import type {
  AccountCreate,
  AccountOut,
  AccountUpdate,
  BalanceEntry,
  MonthBalances,
  MonthUpsertResult,
  NetWorthSummary,
  NetWorthTimeseries,
} from '../types/api'
```

and insert directly after `createAccount`:

```ts
// PARTIAL patch by design: person_id/parent_account_id are the two nullable columns, so an
// explicit null RETAGS or UNLINKS while an omitted key leaves the column alone. Sending
// only the fields a control owns (e.g. { is_active }) is what keeps a stale render from
// overwriting a concurrent edit.
export function updateAccount(accountId: number, body: AccountUpdate): Promise<AccountOut> {
  return api<AccountOut>(`/net-worth/accounts/${accountId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

// 409s while the account has balance rows — the server's sentence names the count.
export function deleteAccount(accountId: number): Promise<void> {
  return api<void>(`/net-worth/accounts/${accountId}`, { method: 'DELETE' })
}
```

- [ ] **Step 6: Extend the spending client.** In `src/api/spending.ts`, change the type import block from

```ts
import type {
  AmountEntry,
  CategoryBudgetEntry,
  CategoryOut,
  SpendingMatrix,
  SpendingMonth,
  SpendingUpsertResult,
  SpendingYearly,
} from '../types/api'
```

to

```ts
import type {
  AmountEntry,
  CategoryBudgetEntry,
  CategoryCreate,
  CategoryOut,
  CategoryUpdate,
  SpendingMatrix,
  SpendingMonth,
  SpendingUpsertResult,
  SpendingYearly,
} from '../types/api'
```

and insert directly after `fetchCategories`:

```ts
export function createCategory(body: CategoryCreate): Promise<CategoryOut> {
  return api<CategoryOut>('/spending/categories', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function updateCategory(categoryId: number, body: CategoryUpdate): Promise<CategoryOut> {
  return api<CategoryOut>(`/spending/categories/${categoryId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

// 409s once the category has monthly rows — the server's sentence names the count.
export function deleteCategory(categoryId: number): Promise<void> {
  return api<void>(`/spending/categories/${categoryId}`, { method: 'DELETE' })
}
```

- [ ] **Step 7: Fix the two AccountOut fixtures.** `tsconfig.app.json` has `include: ["src"]`, so `npm run build` type-checks test files: a new required field on `AccountOut` breaks every literal that builds one.

In `src/utils/accounts.test.ts`, change the helper body from

```ts
  return {
    slug: overrides.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    group: 'pre_tax',
    sort_order: overrides.id,
    is_active: true,
    is_component: false,
    parent_account_id: null,
    ...overrides,
  }
```

to

```ts
  return {
    slug: overrides.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    group: 'pre_tax',
    sort_order: overrides.id,
    is_active: true,
    is_component: false,
    parent_account_id: null,
    person_id: null,
    ...overrides,
  }
```

In `src/pages/MonthlyUpdatePage.test.tsx`, append `person_id: null,` to each of the four account literals — `account` (:24-27), `savings` (:30-33), `brokerage` (:345-348) and `brokerageCash` (:349-352). Each currently ends with `parent_account_id: null,` or `parent_account_id: 2,`; add the new key on the same trailing line, e.g.

```ts
const account = {
  id: 1, name: 'Checking', slug: 'checking', group: 'cash' as const,
  sort_order: 1, is_active: true, is_component: false, parent_account_id: null, person_id: null,
}
```

- [ ] **Step 8: Run to pass.**

```bash
npx vitest run src/api/household.test.ts src/utils/accounts.test.ts src/pages/MonthlyUpdatePage.test.tsx
```

Expected: all pass.

- [ ] **Step 9: Typecheck.** Run: `npx tsc -b`
Expected: no output (clean). If it reports a missing `person_id` anywhere else, add it to that fixture the same way.

- [ ] **Step 10: Commit.**

```bash
git add src/types/api.ts src/api/household.ts src/api/household.test.ts src/api/netWorth.ts src/api/spending.ts src/utils/accounts.test.ts src/pages/MonthlyUpdatePage.test.tsx
git commit -m "feat(household): household client, account/category CRUD clients, person_id types"
```

---

## Phase 4 — Settings cards

### Task 8: Settings → Household card

**Files:**
- Create: `src/components/settings/HouseholdCard.tsx`
- Create: `src/components/settings/HouseholdCard.test.tsx`
- Modify: `src/components/settings/settings.css` (append)

- [ ] **Step 1: Write the failing test.** Create `src/components/settings/HouseholdCard.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import type { HouseholdOut, PersonOut } from '../../types/api'
import HouseholdCard from './HouseholdCard'

vi.mock('../../api/household', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/household')>()),
  fetchHousehold: vi.fn(),
  createPerson: vi.fn(),
  updatePerson: vi.fn(),
  putMarriageDate: vi.fn(),
}))
import { createPerson, fetchHousehold, putMarriageDate, updatePerson } from '../../api/household'

const ME: PersonOut = { id: 1, name: 'Me', is_primary: true }
const PARTNER: PersonOut = { id: 2, name: 'Partner', is_primary: false }

function household(over: Partial<HouseholdOut> = {}): HouseholdOut {
  return { people: [ME], marriage_date: null, ...over }
}

beforeEach(() => {
  vi.mocked(fetchHousehold).mockResolvedValue(household())
  vi.mocked(createPerson).mockResolvedValue(PARTNER)
  vi.mocked(updatePerson).mockResolvedValue({ ...ME, name: 'Ed' })
  vi.mocked(putMarriageDate).mockResolvedValue({ marriage_date: '2026-09-19' })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

it('lists the household, marks the primary member and seeds the date box', async () => {
  vi.mocked(fetchHousehold).mockResolvedValue(
    household({ people: [ME, PARTNER], marriage_date: '2026-09-19' }),
  )
  const onPeopleChange = vi.fn()
  render(<HouseholdCard onPeopleChange={onPeopleChange} />)

  expect(await screen.findByText('Me')).toBeTruthy()
  expect(screen.getByText('Partner')).toBeTruthy()
  // Primary is a badge, not a control: the flag never moves for the life of the database.
  expect(screen.getByText('Primary')).toBeTruthy()
  expect((screen.getByLabelText('Marriage date') as HTMLInputElement).value).toBe('2026-09-19')
  // Lifted to the page so the Accounts card's owner select is never a render behind this
  // one: a partner added here must be selectable there without a reload.
  await waitFor(() => expect(onPeopleChange).toHaveBeenCalledWith([ME, PARTNER]))
})

it('adds a member on the trimmed name and refetches', async () => {
  render(<HouseholdCard onPeopleChange={vi.fn()} />)
  await screen.findByText('Me')

  fireEvent.change(screen.getByLabelText('Add a household member'), {
    target: { value: '  Partner  ' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Add member' }))

  await waitFor(() => expect(vi.mocked(createPerson)).toHaveBeenCalledWith('Partner'))
  // The list is re-read rather than patched locally: the server owns the ordering
  // (primary first, then by id).
  await waitFor(() => expect(vi.mocked(fetchHousehold)).toHaveBeenCalledTimes(2))
})

it('renames a member through the inline editor', async () => {
  render(<HouseholdCard onPeopleChange={vi.fn()} />)
  await screen.findByText('Me')

  fireEvent.click(screen.getByRole('button', { name: 'Rename Me' }))
  fireEvent.change(screen.getByLabelText('New name for Me'), { target: { value: 'Ed' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save name' }))

  await waitFor(() => expect(vi.mocked(updatePerson)).toHaveBeenCalledWith(1, 'Ed'))
  await waitFor(() => expect(vi.mocked(fetchHousehold)).toHaveBeenCalledTimes(2))
})

it('saves the marriage date and sends an explicit null when cleared', async () => {
  render(<HouseholdCard onPeopleChange={vi.fn()} />)
  await screen.findByLabelText('Marriage date')

  fireEvent.change(screen.getByLabelText('Marriage date'), { target: { value: '2026-09-19' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save marriage date' }))
  await waitFor(() => expect(vi.mocked(putMarriageDate)).toHaveBeenCalledWith('2026-09-19'))
  expect(await screen.findByText('Marriage date saved.')).toBeTruthy()

  vi.mocked(putMarriageDate).mockResolvedValue({ marriage_date: null })
  fireEvent.change(screen.getByLabelText('Marriage date'), { target: { value: '' } })
  // The sentence describes the date that WAS saved — the next keystroke moves on.
  expect(screen.queryByText('Marriage date saved.')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Save marriage date' }))
  await waitFor(() => expect(vi.mocked(putMarriageDate)).toHaveBeenLastCalledWith(null))
})

it('renders a rejected add verbatim and keeps the typed name', async () => {
  vi.mocked(createPerson).mockRejectedValue(new ApiError("person 'Partner' already exists", 409))
  render(<HouseholdCard onPeopleChange={vi.fn()} />)
  await screen.findByText('Me')

  const box = screen.getByLabelText('Add a household member') as HTMLInputElement
  fireEvent.change(box, { target: { value: 'Partner' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add member' }))

  // The server's own sentence: it names the row that collided, which no client-side
  // paraphrase does.
  expect(await screen.findByText("person 'Partner' already exists")).toBeTruthy()
  expect(box.value).toBe('Partner')
})

it('banners a failed load and refetches on Retry', async () => {
  vi.mocked(fetchHousehold)
    .mockRejectedValueOnce(new ApiError('household unavailable', 503))
    .mockResolvedValue(household())
  render(<HouseholdCard onPeopleChange={vi.fn()} />)

  expect(await screen.findByText('household unavailable')).toBeTruthy()
  // A first load that failed knows nothing about the household — no forms are offered.
  expect(screen.queryByLabelText('Marriage date')).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(await screen.findByLabelText('Marriage date')).toBeTruthy()
  expect(vi.mocked(fetchHousehold)).toHaveBeenCalledTimes(2)
})
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/components/settings/HouseholdCard.test.tsx`
Expected: FAIL — `Failed to resolve import "./HouseholdCard"`.

- [ ] **Step 3: Implement.** Create `src/components/settings/HouseholdCard.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../api/client'
import { createPerson, fetchHousehold, putMarriageDate, updatePerson } from '../../api/household'
import type { PersonOut } from '../../types/api'
import InfoHint from '../InfoHint'
import '../panels.css'
import './settings.css'

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

/**
 * The Settings Household card (2026-08-26 spec §6): the people registry every owner column
 * points at, plus the marriage date. Its own fetch and error state (SystemCard's posture) —
 * a household hiccup must not dent the settings forms, nor the reverse.
 *
 * The people list is LIFTED to the page through onPeopleChange rather than re-fetched by
 * the Accounts card, so a partner added here is selectable as an owner there immediately.
 */
export default function HouseholdCard({
  onPeopleChange,
}: {
  onPeopleChange: (people: PersonOut[]) => void
}) {
  const [people, setPeople] = useState<PersonOut[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [dateBox, setDateBox] = useState('')
  const [savedNote, setSavedNote] = useState(false)
  const seqRef = useRef(0)

  const load = () => {
    const seq = ++seqRef.current
    fetchHousehold()
      .then((h) => {
        if (seq !== seqRef.current) return
        setPeople(h.people)
        onPeopleChange(h.people)
        setDateBox(h.marriage_date ?? '')
        setError(null)
        setLoaded(true)
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        setError(message(err, 'Could not load the household.'))
      })
  }

  useEffect(() => {
    load()
    // mount-only: a plain function over stable setters (house idiom)
  }, [])

  const addPerson = () => {
    const name = newName.trim()
    if (!name) {
      setError('Enter a name for the new household member.')
      return
    }
    setBusy(true)
    setError(null)
    createPerson(name)
      .then(() => {
        // Only a SUCCESS clears the box: retyping a name after a 409 would be a punishment
        // for the server's answer.
        setNewName('')
        load()
      })
      .catch((err: unknown) => setError(message(err, 'Could not add the member.')))
      .finally(() => setBusy(false))
  }

  const saveRename = () => {
    if (editingId === null) return
    const name = editName.trim()
    if (!name) {
      setError('Enter a name.')
      return
    }
    setBusy(true)
    setError(null)
    updatePerson(editingId, name)
      .then(() => {
        setEditingId(null)
        setEditName('')
        load()
      })
      .catch((err: unknown) => setError(message(err, 'Could not rename.')))
      .finally(() => setBusy(false))
  }

  const saveDate = () => {
    setBusy(true)
    setError(null)
    setSavedNote(false)
    // Explicit null, never undefined (the client module says why).
    putMarriageDate(dateBox.trim() === '' ? null : dateBox)
      .then((saved) => {
        // Re-seeded from the RESPONSE: the server echoes what it stored.
        setDateBox(saved.marriage_date ?? '')
        setSavedNote(true)
      })
      .catch((err: unknown) => setError(message(err, 'Could not save the marriage date.')))
      .finally(() => setBusy(false))
  }

  return (
    <section className="card span-6">
      <h2 className="eyebrow">
        Household
        <InfoHint text="Who this dashboard tracks. Accounts point at these people; an account with no owner is joint. The primary member can be renamed but never changed or removed." />
      </h2>
      {error && (
        <div className="error-banner" role="alert">
          {error}{' '}
          <button className="button" onClick={load}>
            Retry
          </button>
        </div>
      )}
      {!loaded && error === null && <p className="empty-note">Loading…</p>}
      {loaded && (
        <>
          <ul className="household-people">
            {people.map((person) => (
              <li key={person.id} className="household-person">
                {editingId === person.id ? (
                  <>
                    <input
                      className="field-input"
                      aria-label={`New name for ${person.name}`}
                      value={editName}
                      disabled={busy}
                      onChange={(e) => setEditName(e.target.value)}
                    />
                    <button
                      type="button"
                      className="button button-primary"
                      disabled={busy}
                      onClick={saveRename}
                    >
                      Save name
                    </button>
                    <button
                      type="button"
                      className="button"
                      onClick={() => {
                        setEditingId(null)
                        setEditName('')
                      }}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <span className="household-name">{person.name}</span>
                    {person.is_primary && <span className="badge">Primary</span>}
                    <button
                      type="button"
                      className="button"
                      aria-label={`Rename ${person.name}`}
                      disabled={busy}
                      onClick={() => {
                        setEditingId(person.id)
                        setEditName(person.name)
                      }}
                    >
                      Rename
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
          <form
            className="settings-card-form"
            onSubmit={(e) => {
              e.preventDefault()
              addPerson()
            }}
          >
            <label>
              Add a household member
              <input
                className="field-input"
                value={newName}
                disabled={busy}
                onChange={(e) => {
                  setNewName(e.target.value)
                  setError(null)
                }}
              />
            </label>
            <div className="settings-card-actions">
              <button type="submit" className="button" disabled={busy}>
                Add member
              </button>
            </div>
          </form>
          <form
            className="settings-card-form"
            onSubmit={(e) => {
              e.preventDefault()
              saveDate()
            }}
          >
            <label>
              Marriage date
              <input
                className="field-input"
                type="date"
                value={dateBox}
                disabled={busy}
                onChange={(e) => {
                  setDateBox(e.target.value)
                  setSavedNote(false)
                }}
              />
            </label>
            <p className="settings-note">
              Blank = not set. Nothing is backfilled — partner accounts and balances start
              when you enter them.
            </p>
            <div className="settings-card-actions">
              <button type="submit" className="button button-primary" disabled={busy}>
                Save marriage date
              </button>
            </div>
            {savedNote && (
              <p className="settings-note" role="status">
                Marriage date saved.
              </p>
            )}
          </form>
        </>
      )}
    </section>
  )
}
```

- [ ] **Step 4: Add the shared card styles.** Append to `src/components/settings/settings.css`:

```css
/* --- household / accounts / categories cards (2026-08-26 spec §6) --- */

/* The field stack the management cards share. A deliberate near-twin of SettingsPage.css's
   .settings-form: that sheet is page-only and no component imports it, so a card leaning on
   it would depend on the page happening to be in the bundle — the same reasoning that keeps
   .settings-note here rather than there. */
.settings-card-form {
  display: grid;
  gap: 0.75rem;
  max-width: 420px;
  margin-bottom: 0.9rem;
}

.accounts-form {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.6rem 0.8rem;
  margin-bottom: 0.9rem;
}

.category-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.6rem 0.8rem;
  margin-bottom: 0.9rem;
}

.settings-card-form label,
.accounts-form label,
.category-form label {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--muted);
}

/* The checkbox is the one control whose label reads left-to-right, in sentence case. */
.accounts-form label.accounts-check {
  flex-direction: row;
  align-items: center;
  gap: 0.4rem;
  text-transform: none;
  letter-spacing: 0;
  font-size: 0.78rem;
}

.settings-card-actions {
  display: flex;
  align-items: flex-end;
  gap: 0.5rem;
}

/* The people list: one row per member, the rename editor swapping in place. */
.household-people {
  list-style: none;
  margin: 0 0 0.9rem;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.household-person {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.household-name {
  font-size: 0.9rem;
  color: var(--text);
}

/* Cap the roster at ~10 rows and scroll the TABLE, never the page (categories.css's law).
   The sticky header needs the card's own solid surface or rows would ghost through it. */
.settings-scroll {
  max-height: 420px;
  overflow-y: auto;
}

.settings-scroll thead th {
  position: sticky;
  top: 0;
  background: var(--surface);
  z-index: 1;
}

/* Panel-scoped, like roster.css and categories.css: without these, portfolio.css's bare
   `.row-actions button` rules (globally bundled) leak into these tables and the is-editing
   class is inert. */
.accounts-table .row-actions,
.category-table .row-actions {
  display: flex;
  gap: 0.4rem;
}

.accounts-table .row-actions .button,
.category-table .row-actions .button {
  padding: 0.3rem 0.6rem;
  font-size: 0.78rem;
}

.accounts-table tr.is-editing td,
.category-table tr.is-editing td {
  background: var(--surface-2);
}

@media (max-width: 900px) {
  .accounts-form {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
```

- [ ] **Step 5: Run to pass** — `npx vitest run src/components/settings/HouseholdCard.test.tsx`
Expected: `6 passed`.

- [ ] **Step 6: Commit.**

```bash
git add src/components/settings/HouseholdCard.tsx src/components/settings/HouseholdCard.test.tsx src/components/settings/settings.css
git commit -m "feat(household): Settings Household card — people list, rename, marriage date"
```

---

### Task 9: Settings → Accounts card

**Files:**
- Create: `src/components/settings/AccountsCard.tsx`
- Create: `src/components/settings/AccountsCard.test.tsx`

- [ ] **Step 1: Write the failing test.** Create `src/components/settings/AccountsCard.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import type { AccountOut, PersonOut } from '../../types/api'
import ToastProvider from '../ToastProvider'
import AccountsCard from './AccountsCard'

vi.mock('../../api/netWorth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/netWorth')>()),
  fetchAccounts: vi.fn(),
  createAccount: vi.fn(),
  updateAccount: vi.fn(),
  deleteAccount: vi.fn(),
}))
import { createAccount, deleteAccount, fetchAccounts, updateAccount } from '../../api/netWorth'

const ME: PersonOut = { id: 1, name: 'Me', is_primary: true }
const PARTNER: PersonOut = { id: 2, name: 'Partner', is_primary: false }

const CHECKING: AccountOut = {
  id: 10,
  name: 'Joint Checking',
  slug: 'joint-checking',
  group: 'cash',
  sort_order: 1,
  is_active: true,
  is_component: false,
  parent_account_id: null,
  person_id: null,
}
const HSA: AccountOut = {
  id: 11,
  name: 'Fidelity HSA',
  slug: 'fidelity-hsa',
  group: 'pre_tax',
  sort_order: 2,
  is_active: true,
  is_component: false,
  parent_account_id: null,
  person_id: 1,
}

beforeEach(() => {
  vi.mocked(fetchAccounts).mockResolvedValue([CHECKING, HSA])
  vi.mocked(createAccount).mockResolvedValue(CHECKING)
  vi.mocked(updateAccount).mockResolvedValue(HSA)
  vi.mocked(deleteAccount).mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// Every roster assertion is scoped to the TABLE: account names are also options in the
// parent select, and owner names are also options in the owner select.
const roster = () => within(screen.getByRole('table'))

it('renders the roster with owner names, joint spelled out', async () => {
  render(<AccountsCard people={[ME, PARTNER]} />)
  const table = within(await screen.findByRole('table'))

  expect(table.getByText('Joint Checking')).toBeTruthy()
  // A NULL owner is JOINT, never a blank cell: the migration backfilled every
  // pre-existing account, so an unset owner is a deliberate statement.
  expect(table.getByText('Joint')).toBeTruthy()
  expect(table.getByText('Me')).toBeTruthy()
  expect(table.getByText('Pre-tax')).toBeTruthy()
})

it('creates an account with owner, parent and the component flag', async () => {
  render(<AccountsCard people={[ME, PARTNER]} />)
  await screen.findByRole('table')

  fireEvent.change(screen.getByLabelText('Account name'), { target: { value: 'Partner 401(k)' } })
  fireEvent.change(screen.getByLabelText('Group'), { target: { value: 'pre_tax' } })
  fireEvent.change(screen.getByLabelText('Owner'), { target: { value: '2' } })
  fireEvent.change(screen.getByLabelText('Sort order'), { target: { value: '12' } })
  fireEvent.change(screen.getByLabelText('Parent account'), { target: { value: '11' } })
  fireEvent.click(screen.getByLabelText('Component of the parent'))
  fireEvent.click(screen.getByRole('button', { name: 'Add account' }))

  await waitFor(() => expect(vi.mocked(createAccount)).toHaveBeenCalledTimes(1))
  expect(vi.mocked(createAccount).mock.calls[0][0]).toEqual({
    name: 'Partner 401(k)',
    group: 'pre_tax',
    sort_order: 12,
    is_component: true,
    person_id: 2,
    parent_account_id: 11,
  })
  await waitFor(() => expect(vi.mocked(fetchAccounts)).toHaveBeenCalledTimes(2))
})

it('retags an account to joint with an EXPLICIT null', async () => {
  render(<AccountsCard people={[ME, PARTNER]} />)
  await screen.findByRole('table')

  fireEvent.click(screen.getByRole('button', { name: 'Edit Fidelity HSA' }))
  expect((screen.getByLabelText('Account name') as HTMLInputElement).value).toBe('Fidelity HSA')
  expect((screen.getByLabelText('Owner') as HTMLSelectElement).value).toBe('1')

  fireEvent.change(screen.getByLabelText('Owner'), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save account' }))

  await waitFor(() => expect(vi.mocked(updateAccount)).toHaveBeenCalledTimes(1))
  const [id, body] = vi.mocked(updateAccount).mock.calls[0]
  expect(id).toBe(11)
  // The key must SURVIVE: an omitted person_id means "leave the owner alone" server-side,
  // so clearing the select has to send null on purpose.
  expect(Object.keys(body)).toContain('person_id')
  expect(body.person_id).toBeNull()
})

it('retires an account without touching its other columns', async () => {
  render(<AccountsCard people={[ME]} />)
  await screen.findByRole('table')

  fireEvent.click(screen.getByRole('button', { name: 'Retire Fidelity HSA' }))

  // ONLY is_active on the wire: sending the whole row back would let a stale render
  // overwrite a concurrent edit.
  await waitFor(() =>
    expect(vi.mocked(updateAccount)).toHaveBeenCalledWith(11, { is_active: false }),
  )
})

it('deletes a balance-free account', async () => {
  render(<AccountsCard people={[ME]} />)
  await screen.findByRole('table')

  fireEvent.click(screen.getByRole('button', { name: 'Delete Joint Checking' }))

  await waitFor(() => expect(vi.mocked(deleteAccount)).toHaveBeenCalledWith(10))
  await waitFor(() => expect(vi.mocked(fetchAccounts)).toHaveBeenCalledTimes(2))
})

it('surfaces the delete 409 as a toast and keeps the row', async () => {
  vi.mocked(deleteAccount).mockRejectedValue(
    new ApiError('account has 14 balance rows — deactivate it instead', 409),
  )
  render(
    <ToastProvider>
      <AccountsCard people={[ME]} />
    </ToastProvider>,
  )
  await screen.findByRole('table')

  fireEvent.click(screen.getByRole('button', { name: 'Delete Fidelity HSA' }))

  // The server's own sentence — it names the count, which no client paraphrase does — and
  // it rides the TOAST layer because it is about a row far down the table, not the form.
  const toast = await screen.findByText('account has 14 balance rows — deactivate it instead')
  expect(toast.className).toBe('toast-message')
  // A refused delete must not optimistically remove the row, and must not re-fetch.
  expect(roster().getByText('Fidelity HSA')).toBeTruthy()
  expect(vi.mocked(fetchAccounts)).toHaveBeenCalledTimes(1)
})

it('renders a rejected save verbatim in the card error slot', async () => {
  vi.mocked(createAccount).mockRejectedValue(
    new ApiError("account 'joint-checking' already exists", 409),
  )
  render(<AccountsCard people={[ME]} />)
  await screen.findByRole('table')

  fireEvent.change(screen.getByLabelText('Account name'), { target: { value: 'Joint Checking' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add account' }))

  expect(await screen.findByText("account 'joint-checking' already exists")).toBeTruthy()
})
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/components/settings/AccountsCard.test.tsx`
Expected: FAIL — `Failed to resolve import "./AccountsCard"`.

- [ ] **Step 3: Implement.** Create `src/components/settings/AccountsCard.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../api/client'
import { createAccount, deleteAccount, fetchAccounts, updateAccount } from '../../api/netWorth'
import { GROUP_LABELS, GROUP_ORDER } from '../../charts/theme'
import type { AccountGroup, AccountOut, PersonOut } from '../../types/api'
import InfoHint from '../InfoHint'
import { useToast } from '../ToastProvider'
import '../panels.css'
import './settings.css'

interface AccountFormState {
  name: string
  group: AccountGroup
  person_id: string
  sort_order: string
  parent_account_id: string
  is_component: boolean
}

const EMPTY_ACCOUNT: AccountFormState = {
  name: '',
  group: 'cash',
  person_id: '',
  sort_order: '0',
  parent_account_id: '',
  is_component: false,
}

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

/**
 * The Settings Accounts card (2026-08-26 spec §6): the roster manager the app has never
 * had. The backend CRUD has existed since Plan 3 with no caller, which is exactly why
 * "net worth accounts are fixed by the workbook" was true (audit §3.1) — and why partner
 * accounts were unreachable without curl.
 *
 * `people` arrives as a prop from the page rather than from a second /household fetch, so
 * a partner added in the Household card is selectable here without a reload.
 */
export default function AccountsCard({ people }: { people: PersonOut[] }) {
  const [accounts, setAccounts] = useState<AccountOut[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<AccountFormState>(EMPTY_ACCOUNT)
  const seqRef = useRef(0)
  const toast = useToast()

  const load = () => {
    const seq = ++seqRef.current
    fetchAccounts()
      .then((rows) => {
        if (seq !== seqRef.current) return
        setAccounts(rows)
        setError(null)
        setLoaded(true)
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        setError(message(err, 'Could not load accounts.'))
      })
  }

  useEffect(() => {
    load()
    // mount-only: a plain function over stable setters (house idiom)
  }, [])

  const setText =
    (field: 'name' | 'person_id' | 'sort_order' | 'parent_account_id') => (value: string) => {
      setForm((f) => ({ ...f, [field]: value }))
      setError(null)
    }

  const startEdit = (account: AccountOut) => {
    setEditingId(account.id)
    setError(null)
    setForm({
      name: account.name,
      group: account.group,
      person_id: account.person_id === null ? '' : String(account.person_id),
      sort_order: String(account.sort_order),
      parent_account_id:
        account.parent_account_id === null ? '' : String(account.parent_account_id),
      is_component: account.is_component,
    })
  }

  const cancelEdit = () => {
    setEditingId(null)
    setForm(EMPTY_ACCOUNT)
  }

  const submit = () => {
    const name = form.name.trim()
    if (!name) {
      setError('Account name is required.')
      return
    }
    // ALL SIX keys, every time: a blank owner or parent must CLEAR the column, and PATCH
    // treats an omitted key as "leave it alone" — only an explicit null retags an account
    // to joint or unlinks a component.
    const body = {
      name,
      group: form.group,
      sort_order: Number(form.sort_order) || 0,
      is_component: form.is_component,
      person_id: form.person_id === '' ? null : Number(form.person_id),
      parent_account_id: form.parent_account_id === '' ? null : Number(form.parent_account_id),
    }
    setBusy(true)
    setError(null)
    const request = editingId !== null ? updateAccount(editingId, body) : createAccount(body)
    request
      .then(() => {
        cancelEdit()
        load()
      })
      .catch((err: unknown) => setError(message(err, 'Save failed')))
      .finally(() => setBusy(false))
  }

  // ONLY is_active on the wire: every other column is untouched here, and sending the
  // whole row back would let a stale render overwrite a concurrent edit (CardsPanel's rule).
  const toggleActive = (account: AccountOut) => {
    setBusy(true)
    setError(null)
    updateAccount(account.id, { is_active: !account.is_active })
      .then(() => load())
      .catch((err: unknown) => setError(message(err, 'Update failed')))
      .finally(() => setBusy(false))
  }

  const remove = (account: AccountOut) => {
    setBusy(true)
    // The guard sentence belongs to the SERVER ("account has N balance rows — deactivate it
    // instead") and it is about a row far down the table, so it rides the toast layer
    // rather than the form-level banner above the form.
    deleteAccount(account.id)
      .then(() => {
        if (account.id === editingId) cancelEdit()
        load()
      })
      .catch((err: unknown) => toast.error(message(err, 'Delete failed')))
      .finally(() => setBusy(false))
  }

  const ownerName = new Map(people.map((p) => [p.id, p.name]))
  const accountName = new Map(accounts.map((a) => [a.id, a.name]))
  // An account may not parent itself (the server 422s it); leaving it out of the select
  // means the UI never offers the mistake.
  const parentOptions = accounts.filter((a) => a.id !== editingId)

  return (
    <section className="card span-12">
      <h2 className="eyebrow">
        Accounts
        <InfoHint text="The net-worth roster. Owner blank = joint. Retire keeps an account out of the wizard and the charts without losing its history; delete only works while an account has no balances. The slug never changes — it is the workbook importer's key." />
      </h2>
      {error && (
        <div className="error-banner" role="alert">
          {error}{' '}
          <button className="button" onClick={load}>
            Retry
          </button>
        </div>
      )}
      {!loaded && error === null && <p className="empty-note">Loading…</p>}
      {loaded && (
        <>
          <form
            className="accounts-form"
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            <label>
              Account name
              <input
                className="field-input"
                value={form.name}
                onChange={(e) => setText('name')(e.target.value)}
              />
            </label>
            <label>
              Group
              <select
                className="field-input"
                value={form.group}
                onChange={(e) =>
                  setForm((f) => ({ ...f, group: e.target.value as AccountGroup }))
                }
              >
                {GROUP_ORDER.map((group) => (
                  <option key={group} value={group}>
                    {GROUP_LABELS[group]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Owner
              <select
                className="field-input"
                value={form.person_id}
                onChange={(e) => setText('person_id')(e.target.value)}
              >
                <option value="">Joint</option>
                {people.map((person) => (
                  <option key={person.id} value={String(person.id)}>
                    {person.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Sort order
              <input
                className="field-input"
                inputMode="numeric"
                value={form.sort_order}
                onChange={(e) => setText('sort_order')(e.target.value)}
              />
            </label>
            <label>
              Parent account
              <select
                className="field-input"
                value={form.parent_account_id}
                onChange={(e) => setText('parent_account_id')(e.target.value)}
              >
                <option value="">— none —</option>
                {parentOptions.map((account) => (
                  <option key={account.id} value={String(account.id)}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="accounts-check">
              <input
                type="checkbox"
                checked={form.is_component}
                onChange={(e) => setForm((f) => ({ ...f, is_component: e.target.checked }))}
              />
              Component of the parent
            </label>
            <div className="settings-card-actions">
              <button type="submit" className="button button-primary" disabled={busy}>
                {editingId !== null ? 'Save account' : 'Add account'}
              </button>
              {editingId !== null && (
                <button type="button" className="button" onClick={cancelEdit}>
                  Cancel
                </button>
              )}
            </div>
          </form>
          {accounts.length === 0 ? (
            <p className="empty-note">No accounts yet — add the first one above.</p>
          ) : (
            <div className="settings-scroll">
              <table className="data-table accounts-table">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Group</th>
                    <th>Owner</th>
                    <th className="num">Sort</th>
                    <th>Parent</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((account) => (
                    <tr
                      key={account.id}
                      className={account.id === editingId ? 'is-editing' : undefined}
                    >
                      <td>
                        {account.name}
                        {account.is_component && <span className="badge">Component</span>}
                      </td>
                      <td>{GROUP_LABELS[account.group]}</td>
                      {/* NULL is JOINT, never "unknown": the migration backfilled every
                          pre-existing account to the primary person. */}
                      <td>
                        {account.person_id === null
                          ? 'Joint'
                          : (ownerName.get(account.person_id) ?? '—')}
                      </td>
                      <td className="num">{account.sort_order}</td>
                      <td>
                        {account.parent_account_id === null
                          ? '—'
                          : (accountName.get(account.parent_account_id) ?? '—')}
                      </td>
                      <td>
                        <span className="badge">{account.is_active ? 'Active' : 'Retired'}</span>
                      </td>
                      <td className="row-actions">
                        <button
                          type="button"
                          className="button"
                          aria-label={`Edit ${account.name}`}
                          disabled={busy}
                          onClick={() => startEdit(account)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="button"
                          aria-label={
                            account.is_active
                              ? `Retire ${account.name}`
                              : `Restore ${account.name}`
                          }
                          disabled={busy}
                          onClick={() => toggleActive(account)}
                        >
                          {account.is_active ? 'Retire' : 'Restore'}
                        </button>
                        <button
                          type="button"
                          className="button"
                          aria-label={`Delete ${account.name}`}
                          disabled={busy}
                          onClick={() => remove(account)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  )
}
```

- [ ] **Step 4: Run to pass** — `npx vitest run src/components/settings/AccountsCard.test.tsx`
Expected: `7 passed`.

- [ ] **Step 5: Commit.**

```bash
git add src/components/settings/AccountsCard.tsx src/components/settings/AccountsCard.test.tsx
git commit -m "feat(household): Settings Accounts card — owner, parent, retire, guarded delete"
```

---

### Task 10: Settings → Spending categories card

**Files:**
- Create: `src/components/settings/CategoriesCard.tsx`
- Create: `src/components/settings/CategoriesCard.test.tsx`

- [ ] **Step 1: Write the failing test.** Create `src/components/settings/CategoriesCard.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import type { CategoryOut } from '../../types/api'
import ToastProvider from '../ToastProvider'
import CategoriesCard from './CategoriesCard'

vi.mock('../../api/spending', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/spending')>()),
  fetchCategories: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  deleteCategory: vi.fn(),
}))
import {
  createCategory,
  deleteCategory,
  fetchCategories,
  updateCategory,
} from '../../api/spending'

const GROCERIES: CategoryOut = {
  id: 5,
  name: 'Groceries',
  slug: 'groceries',
  sort_order: 1,
  is_active: true,
}
const PETS: CategoryOut = { id: 6, name: 'Pets', slug: 'pets', sort_order: 2, is_active: false }

beforeEach(() => {
  vi.mocked(fetchCategories).mockResolvedValue([GROCERIES, PETS])
  vi.mocked(createCategory).mockResolvedValue(GROCERIES)
  vi.mocked(updateCategory).mockResolvedValue(GROCERIES)
  vi.mocked(deleteCategory).mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

it('lists the categories with their retirement state', async () => {
  render(<CategoriesCard />)
  const table = within(await screen.findByRole('table'))

  expect(table.getByText('Groceries')).toBeTruthy()
  expect(table.getByText('Pets')).toBeTruthy()
  expect(table.getByText('Retired')).toBeTruthy()
})

it('creates a category', async () => {
  render(<CategoriesCard />)
  await screen.findByRole('table')

  fireEvent.change(screen.getByLabelText('Category name'), { target: { value: '  Wedding  ' } })
  fireEvent.change(screen.getByLabelText('Sort order'), { target: { value: '9' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add category' }))

  await waitFor(() => expect(vi.mocked(createCategory)).toHaveBeenCalledTimes(1))
  expect(vi.mocked(createCategory).mock.calls[0][0]).toEqual({ name: 'Wedding', sort_order: 9 })
  await waitFor(() => expect(vi.mocked(fetchCategories)).toHaveBeenCalledTimes(2))
})

it('renames through the inline editor', async () => {
  render(<CategoriesCard />)
  await screen.findByRole('table')

  fireEvent.click(screen.getByRole('button', { name: 'Edit Groceries' }))
  expect((screen.getByLabelText('Category name') as HTMLInputElement).value).toBe('Groceries')
  fireEvent.change(screen.getByLabelText('Category name'), { target: { value: 'Food' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save category' }))

  await waitFor(() =>
    expect(vi.mocked(updateCategory)).toHaveBeenCalledWith(5, { name: 'Food', sort_order: 1 }),
  )
})

it('retires and restores without touching the other columns', async () => {
  render(<CategoriesCard />)
  await screen.findByRole('table')

  fireEvent.click(screen.getByRole('button', { name: 'Retire Groceries' }))
  await waitFor(() =>
    expect(vi.mocked(updateCategory)).toHaveBeenCalledWith(5, { is_active: false }),
  )

  fireEvent.click(screen.getByRole('button', { name: 'Restore Pets' }))
  await waitFor(() =>
    expect(vi.mocked(updateCategory)).toHaveBeenCalledWith(6, { is_active: true }),
  )
})

it('surfaces the delete 409 as a toast and keeps the row', async () => {
  vi.mocked(deleteCategory).mockRejectedValue(
    new ApiError('category has 31 monthly rows — deactivate it instead', 409),
  )
  render(
    <ToastProvider>
      <CategoriesCard />
    </ToastProvider>,
  )
  await screen.findByRole('table')

  fireEvent.click(screen.getByRole('button', { name: 'Delete Groceries' }))

  const toast = await screen.findByText('category has 31 monthly rows — deactivate it instead')
  expect(toast.className).toBe('toast-message')
  expect(within(screen.getByRole('table')).getByText('Groceries')).toBeTruthy()
  expect(vi.mocked(fetchCategories)).toHaveBeenCalledTimes(1)
})

it('banners a failed load and refetches on Retry', async () => {
  vi.mocked(fetchCategories)
    .mockRejectedValueOnce(new ApiError('categories unavailable', 503))
    .mockResolvedValue([GROCERIES])
  render(<CategoriesCard />)

  expect(await screen.findByText('categories unavailable')).toBeTruthy()
  expect(screen.queryByRole('table')).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(await screen.findByRole('table')).toBeTruthy()
  expect(vi.mocked(fetchCategories)).toHaveBeenCalledTimes(2)
})
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/components/settings/CategoriesCard.test.tsx`
Expected: FAIL — `Failed to resolve import "./CategoriesCard"`.

- [ ] **Step 3: Implement.** Create `src/components/settings/CategoriesCard.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../api/client'
import {
  createCategory,
  deleteCategory,
  fetchCategories,
  updateCategory,
} from '../../api/spending'
import type { CategoryOut } from '../../types/api'
import InfoHint from '../InfoHint'
import { useToast } from '../ToastProvider'
import '../panels.css'
import './settings.css'

interface CategoryFormState {
  name: string
  sort_order: string
}

const EMPTY_CATEGORY: CategoryFormState = { name: '', sort_order: '0' }

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

/**
 * The Settings Spending-categories card (2026-08-26 spec §6). The CRUD endpoints have
 * existed since Plan 3 with no caller at all (audit §3.1), so the category axis was fixed
 * by the workbook exactly like the account roster was.
 */
export default function CategoriesCard() {
  const [categories, setCategories] = useState<CategoryOut[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<CategoryFormState>(EMPTY_CATEGORY)
  const seqRef = useRef(0)
  const toast = useToast()

  const load = () => {
    const seq = ++seqRef.current
    fetchCategories()
      .then((rows) => {
        if (seq !== seqRef.current) return
        setCategories(rows)
        setError(null)
        setLoaded(true)
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        setError(message(err, 'Could not load categories.'))
      })
  }

  useEffect(() => {
    load()
    // mount-only: a plain function over stable setters (house idiom)
  }, [])

  const setText = (field: keyof CategoryFormState) => (value: string) => {
    setForm((f) => ({ ...f, [field]: value }))
    setError(null)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setForm(EMPTY_CATEGORY)
  }

  const submit = () => {
    const name = form.name.trim()
    if (!name) {
      setError('Category name is required.')
      return
    }
    const body = { name, sort_order: Number(form.sort_order) || 0 }
    setBusy(true)
    setError(null)
    const request = editingId !== null ? updateCategory(editingId, body) : createCategory(body)
    request
      .then(() => {
        cancelEdit()
        load()
      })
      .catch((err: unknown) => setError(message(err, 'Save failed')))
      .finally(() => setBusy(false))
  }

  // ONLY is_active on the wire: the name and position are untouched columns here.
  const toggleActive = (category: CategoryOut) => {
    setBusy(true)
    setError(null)
    updateCategory(category.id, { is_active: !category.is_active })
      .then(() => load())
      .catch((err: unknown) => setError(message(err, 'Update failed')))
      .finally(() => setBusy(false))
  }

  const remove = (category: CategoryOut) => {
    setBusy(true)
    // The server's guard sentence names the monthly-row count; it is about a table row,
    // so it rides the toast layer rather than the form banner (AccountsCard's rule).
    deleteCategory(category.id)
      .then(() => {
        if (category.id === editingId) cancelEdit()
        load()
      })
      .catch((err: unknown) => toast.error(message(err, 'Delete failed')))
      .finally(() => setBusy(false))
  }

  return (
    <section className="card span-6">
      <h2 className="eyebrow">
        Spending categories
        <InfoHint text="The spending matrix's rows. Retire keeps a category out of the wizard without losing its history; delete only works while a category has no monthly rows. The slug never changes — it is the workbook importer's key." />
      </h2>
      {error && (
        <div className="error-banner" role="alert">
          {error}{' '}
          <button className="button" onClick={load}>
            Retry
          </button>
        </div>
      )}
      {!loaded && error === null && <p className="empty-note">Loading…</p>}
      {loaded && (
        <>
          <form
            className="category-form"
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            <label>
              Category name
              <input
                className="field-input"
                value={form.name}
                onChange={(e) => setText('name')(e.target.value)}
              />
            </label>
            <label>
              Sort order
              <input
                className="field-input"
                inputMode="numeric"
                value={form.sort_order}
                onChange={(e) => setText('sort_order')(e.target.value)}
              />
            </label>
            <div className="settings-card-actions">
              <button type="submit" className="button button-primary" disabled={busy}>
                {editingId !== null ? 'Save category' : 'Add category'}
              </button>
              {editingId !== null && (
                <button type="button" className="button" onClick={cancelEdit}>
                  Cancel
                </button>
              )}
            </div>
          </form>
          {categories.length === 0 ? (
            <p className="empty-note">No categories yet — add the first one above.</p>
          ) : (
            <div className="settings-scroll">
              <table className="data-table category-table">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th className="num">Sort</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {categories.map((category) => (
                    <tr
                      key={category.id}
                      className={category.id === editingId ? 'is-editing' : undefined}
                    >
                      <td>{category.name}</td>
                      <td className="num">{category.sort_order}</td>
                      <td>
                        <span className="badge">
                          {category.is_active ? 'Active' : 'Retired'}
                        </span>
                      </td>
                      <td className="row-actions">
                        <button
                          type="button"
                          className="button"
                          aria-label={`Edit ${category.name}`}
                          disabled={busy}
                          onClick={() => {
                            setEditingId(category.id)
                            setError(null)
                            setForm({
                              name: category.name,
                              sort_order: String(category.sort_order),
                            })
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="button"
                          aria-label={
                            category.is_active
                              ? `Retire ${category.name}`
                              : `Restore ${category.name}`
                          }
                          disabled={busy}
                          onClick={() => toggleActive(category)}
                        >
                          {category.is_active ? 'Retire' : 'Restore'}
                        </button>
                        <button
                          type="button"
                          className="button"
                          aria-label={`Delete ${category.name}`}
                          disabled={busy}
                          onClick={() => remove(category)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  )
}
```

- [ ] **Step 4: Run to pass** — `npx vitest run src/components/settings/CategoriesCard.test.tsx`
Expected: `6 passed`.

- [ ] **Step 5: Commit.**

```bash
git add src/components/settings/CategoriesCard.tsx src/components/settings/CategoriesCard.test.tsx
git commit -m "feat(household): Settings Spending-categories card"
```

---

### Task 11: Mount the three cards on Settings

**Files:**
- Modify: `src/pages/SettingsPage.tsx` (imports :1-15, state :36-60, card grid :261-473)
- Modify: `src/pages/SettingsPage.test.tsx` (mocks :9-29, helpers :78-80, `beforeEach` :157-164, append a describe)

- [ ] **Step 1: Write the failing test.** In `src/pages/SettingsPage.test.tsx`:

(a) after the existing `vi.mock('../api/system', ...)` block, add three more mocks:

```tsx
// The three management cards each own a fetch of their own; unmocked, they would make real
// network calls from every test in this file.
vi.mock('../api/household', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/household')>()),
  fetchHousehold: vi.fn(),
  createPerson: vi.fn(),
  updatePerson: vi.fn(),
  putMarriageDate: vi.fn(),
}))
vi.mock('../api/netWorth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/netWorth')>()),
  fetchAccounts: vi.fn(),
  createAccount: vi.fn(),
  updateAccount: vi.fn(),
  deleteAccount: vi.fn(),
}))
vi.mock('../api/spending', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/spending')>()),
  fetchCategories: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  deleteCategory: vi.fn(),
}))
```

(b) extend the import block below the mocks with:

```tsx
import { fetchHousehold } from '../api/household'
import { fetchAccounts } from '../api/netWorth'
import { fetchCategories } from '../api/spending'
```

(c) extend the type import on line 4 from

```tsx
import type { AppSettingsOut, ImportReport, ImportSheetReport, SystemStatus } from '../types/api'
```

to

```tsx
import type {
  AccountOut,
  AppSettingsOut,
  ImportReport,
  ImportSheetReport,
  PersonOut,
  SystemStatus,
} from '../types/api'
```

(d) **anchor the `saveButton` helper.** The Household card now renders "Save marriage date" and the Accounts card "Save account", so the existing prefix matcher would find three buttons. Replace

```tsx
const saveButton = () => screen.getByRole('button', { name: /^sav/i }) as HTMLButtonElement
```

with

```tsx
// Anchored at BOTH ends, like pwButton and dryButton: the management cards below render
// "Save marriage date", "Save name", "Save account" and "Save category", and a bare
// /^sav/i now matches all of them.
const saveButton = () =>
  screen.getByRole('button', { name: /^sav(e settings|ing…)$/i }) as HTMLButtonElement
```

(e) add the fixtures and `beforeEach` arming. Above `beforeEach`, add:

```tsx
const ME: PersonOut = { id: 1, name: 'Me', is_primary: true }
const CHECKING: AccountOut = {
  id: 10,
  name: 'Joint Checking',
  slug: 'joint-checking',
  group: 'cash',
  sort_order: 1,
  is_active: true,
  is_component: false,
  parent_account_id: null,
  person_id: null,
}
```

and inside `beforeEach`, after `vi.mocked(fetchSystemStatus).mockResolvedValue(SYSTEM)`:

```tsx
  vi.mocked(fetchHousehold).mockResolvedValue({ people: [ME], marriage_date: null })
  vi.mocked(fetchAccounts).mockResolvedValue([CHECKING])
  vi.mocked(fetchCategories).mockResolvedValue([])
```

(f) append this describe block at the end of the file:

```tsx
describe('SettingsPage — household, accounts and categories cards', () => {
  it('mounts the three management cards and feeds the roster its people', async () => {
    render(<SettingsPage />)

    expect(await screen.findByText('Household')).toBeTruthy()
    expect(screen.getByText('Accounts')).toBeTruthy()
    expect(screen.getByText('Spending categories')).toBeTruthy()

    // The people list is LIFTED out of the Household card so the Accounts owner select is
    // never a render behind it: a partner added above is selectable below without a reload.
    // (Both management tables carry a "Sort order" box, so page-level queries must never
    // reach for that label — the Owner select is unique.)
    await waitFor(() =>
      expect(
        [...(screen.getByLabelText('Owner') as HTMLSelectElement).options].map(
          (o) => o.textContent,
        ),
      ).toEqual(['Joint', 'Me']),
    )
  })

  it('offers none of the three cards when the settings load failed', async () => {
    vi.mocked(fetchAppSettings).mockRejectedValue(new ApiError('settings unavailable', 503))
    render(<SettingsPage />)

    expect(await screen.findByText('settings unavailable')).toBeTruthy()
    // They share the import card's `loadedOnce` gate: a settings GET that failed means the
    // API is unreachable, and three cards that could only fail are not worth offering.
    expect(screen.queryByText('Household')).toBeNull()
    expect(screen.queryByText('Accounts')).toBeNull()
    expect(screen.queryByText('Spending categories')).toBeNull()
    expect(vi.mocked(fetchHousehold)).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/pages/SettingsPage.test.tsx`
Expected: FAIL — `Unable to find an element with the text: Household`.

- [ ] **Step 3: Implement.** In `src/pages/SettingsPage.tsx`:

(a) extend the imports — add these three lines to the component-import group (after `import ImportReportView from '../components/settings/ImportReportView'`, keeping alphabetical order by identifier: AccountsCard, CategoriesCard, HouseholdCard, ImportReportView, SystemCard):

```tsx
import AccountsCard from '../components/settings/AccountsCard'
import CategoriesCard from '../components/settings/CategoriesCard'
import HouseholdCard from '../components/settings/HouseholdCard'
```

and extend the type import from

```tsx
import type { AppSettingsOut, ImportReport } from '../types/api'
```

to

```tsx
import type { AppSettingsOut, ImportReport, PersonOut } from '../types/api'
```

(b) add one piece of state, directly below the `const [importError, setImportError] = useState<string | null>(null)` line:

```tsx
  // Lifted out of HouseholdCard so the Accounts card's owner select is never a render
  // behind it: a partner added above must be selectable below without a reload. The page
  // does no household fetching of its own — this is a relay, not a second source of truth.
  const [people, setPeople] = useState<PersonOut[]>([])
```

(c) mount the three cards inside the `loadedOnce` grid, directly above `<SystemCard />` (the closing `</section>` of the Password card is immediately before the SystemCard comment):

```tsx
          {/* The three management cards (2026-08-26 spec §6). Each owns its own fetch and
              error state (SystemCard's posture) and shares the forms' `loadedOnce` gate:
              a settings GET that failed means the API is unreachable, and cards that could
              only fail are not worth offering. */}
          <HouseholdCard onPeopleChange={setPeople} />
          <CategoriesCard />
          <AccountsCard people={people} />
```

- [ ] **Step 4: Run to pass** — `npx vitest run src/pages/SettingsPage.test.tsx`
Expected: all pass (the pre-existing tests plus the 2 new ones).

- [ ] **Step 5: Commit.**

```bash
git add src/pages/SettingsPage.tsx src/pages/SettingsPage.test.tsx
git commit -m "feat(household): mount Household, Categories and Accounts cards on Settings"
```

---

## Phase 5 — Whole-suite verification

### Task 12: Full backend + frontend suites, lint, typecheck, one head

**Files:** none (verification only)

- [ ] **Step 1: Full backend suite.**

Run: `cd backend && .venv/Scripts/python -m pytest -q`
Expected: 0 failed. The baseline before this plan is 910 passing; this plan adds 5 (`test_models_household.py`), 14 (`test_household_api.py`), 3 (`test_net_worth_api.py`) and 1 (`test_seed.py`) — expect **933 passed** or more if the baseline moved. Any failure in `test_importer_apply.py`, `test_net_worth_calc.py`, `test_overview_api.py` or `test_money_flow.py` means the `AccountOut`/`Account` change leaked — fix the code, never the assertion.

- [ ] **Step 2: Backend lint.**

Run: `cd backend && .venv/Scripts/python -m ruff check .`
Expected: `All checks passed!`. If import order is flagged (rule `I`), run `cd backend && .venv/Scripts/python -m ruff check --fix .` and re-run.

- [ ] **Step 3: Full frontend suite.**

Run: `npx vitest run`
Expected: 0 failed. The baseline is 982 passing; this plan adds 4 (`household.test.ts`), 6 (`HouseholdCard`), 7 (`AccountsCard`), 6 (`CategoriesCard`) and 2 (`SettingsPage`) — expect **1007 passed** or more.

- [ ] **Step 4: Typecheck and frontend lint.**

```bash
npx tsc -b
npm run lint
```

Expected: `tsc -b` silent; `npm run lint` reports no errors (warnings from `react-refresh/only-export-components` are pre-existing and acceptable).

- [ ] **Step 5: Confirm exactly one migration head, and that a fresh upgrade is clean.**

```bash
cd backend && .venv/Scripts/python -m alembic heads
cd backend && .venv/Scripts/python -m alembic upgrade head
```

Expected: one line — `a8d24b6e9107 (head)` — and the upgrade is a no-op (`Context impl PostgresqlImpl` with no `Running upgrade` lines).

- [ ] **Step 6: Prove the boot path (migrations + seed) is idempotent.**

Run: `cd backend && .venv/Scripts/python -m app.seed`
Expected: `Seed complete`, with NO `Created household member Me` line (the migration already seeded it) and no traceback. Run it a second time and confirm the same output — this is what `start.sh` does on every container boot.

- [ ] **Step 7: Real-data browser smoke** (the 2026-08-25 sankey-incident lesson: real data, real browser, before merging). With both dev servers running (`cd backend && .venv/Scripts/python -m uvicorn app.main:app --port 8000` and `npm run dev`), open `/settings` and confirm, by hand:
  1. **Household** lists one member, "Me", badged Primary. Rename it to something else and back — the list re-reads from the server both times.
  2. Add a member named "Partner"; it appears un-badged, and the **Accounts** card's Owner select immediately offers `Joint / Me / Partner` with no reload.
  3. Set a marriage date; reload the page and confirm it is still there. Then save the **App settings** card (unchanged values) and reload again — the marriage date must survive (this is the audit §2.2 trap, closed).
  4. **Accounts** lists the real roster with every row owned by "Me" (the backfill) and none reading Joint. Retag one to Joint, confirm the cell reads `Joint`, retag it back.
  5. Create a throwaway account, then delete it (204, row disappears). Try to delete a real account that has balances — a toast appears with the server's sentence and the row stays.
  6. **Spending categories** lists the real categories; retire one and restore it; attempt to delete one that has monthly rows and confirm the toast.
  7. Visit `/net-worth` and `/update` and confirm both still render — the extended `AccountOut` reaches them and nothing blanks.

Record the result. If any step fails, STOP and report rather than patching around it.

- [ ] **Step 8: Final commit** (only if Steps 1-7 produced fixes; otherwise skip).

```bash
git add -A
git commit -m "chore(household): whole-suite verification fixes"
```

---

## Forward notes (for the waves that follow)

- **The importer never sets an owner.** `backend/app/importer/apply.py` creates accounts through the ORM, not through `AccountCreate`, so a sheet-created account lands with `person_id = NULL` — i.e. joint — until retagged in the Accounts card. Wave 3 (net-worth ownership) should decide whether that default is right or whether the importer should stamp the primary person.
- **`accounts.name`/`slug` stay globally unique.** Two people cannot both own an account literally named "Checking"; partner accounts need distinct names (spec §4 accepts this deliberately — a composite `(person_id, slug)` unique would touch the importer's natural keys).
- **`_validate_links` does not guard deeper parent cycles** (A→B→A). `parent_account_id` is presentation-only and `nestComponents` nests exactly one level, so a cycle costs a flat render, not wrong money.
- **`ux_people_single_primary` has no promotion path.** There is deliberately no way to move the primary flag: `PersonUpdate` carries only `name`, and a direct SQL flip would need the old row cleared first. If "change the primary member" ever becomes a requirement, it needs its own endpoint with a two-statement transaction.
- **Marriage-date consumers are wave 3+.** This plan only stores and returns it; the net-worth trend `markLine` annotation (spec §6) and the filing-status default (spec §4) read it later.
