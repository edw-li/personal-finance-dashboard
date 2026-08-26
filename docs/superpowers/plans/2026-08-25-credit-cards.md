# Credit Cards — Rewards Optimizer & Credit-Line Tracker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `/credit-cards` page per `docs/superpowers/specs/2026-08-25-credit-cards-design.md`: a rewards-optimization matrix (valuation-aware green best-cells, Multiplier-default toggle), per-card economics (marginal value + credits − AF), card roster with holders/limits, credit-line history, and a `?card=` drill-in.

**Architecture:** Backend is pure CRUD — 5 new tables (one additive migration `c4d1e8a2b9f3` chained on `e7c5a9f4b2d8`), one router `/api/v1/credit-cards`. ALL derived numbers (effective rates, ties, pins, cap spillover, marginal value) live in a pure frontend module `rewardsMath.ts`. Charts are two pure option builders (monthly category axis — NO new echarts registrations). Page follows the SpendingPage anatomy; drill-in follows its `?month=` pattern as `?card=<slug>`.

**Tech stack:** FastAPI + async SQLAlchemy 2 + Alembic + pydantic v2 (backend), React 19 + TS + ECharts 6 via `src/charts/echarts.ts` (frontend), pytest / vitest.

---

## Orchestration protocol (overnight, autonomous)

- **Branch:** all work on `credit-cards`, cut from local `main`. Merge `--no-ff` to local main at the end. **NEVER push. No deletions of branches/worktrees/files beyond what tasks specify. No human approvals — follow the plan's own recommendations.**
- **Implementers are Opus subagents** (user mandate), one fresh subagent per task, given the FULL task text verbatim. They report DONE / DONE_WITH_CONCERNS / BLOCKED.
- **Parallel implementers run NO git commands** (shared-index hazard — 2026-08-23 lesson). The orchestrator stages with explicit paths and commits after each task's review passes.
- **Review per task:** one combined two-stage reviewer subagent (spec-compliance first, then code-quality, superpowers:code-reviewer guidance) over the task's commit range (orchestrator commits first, then reviews `BASE..HEAD`). Important+ findings → fix loop before the next dependent task.
- **Test isolation:** exactly ONE backend pytest runner at any time (shared `finance_test` on 5433 is not concurrency-safe). Frontend agents run targeted `npx vitest run <file>` mid-plan, full suites only at gates. Never pipe test runs through grep/head before a commit gate (exit-code masking lesson).
- **Waves:**
  - Wave 1 (parallel): Task 1 (backend models+migration) ∥ Task 2 (wire types+client) ∥ Task 3 (rewardsMath) ∥ Task 4 (chart builders)
  - Wave 2 (parallel): backend lane Task 5 → Task 6 → Task 7 (sequential, one file/lane) ∥ frontend Task 8 ∥ Task 9 ∥ Task 10 ∥ Task 11 (after 2+3+4 reviewed)
  - Wave 3: Task 12 (page assembly + registration + page tests) — after 5–11
  - Wave 4 (orchestrator): Task 13 (full gates) → Task 14 (browser smoke, real data) → Task 15 (final whole-branch review + fixes) → Task 16 (merge to local main, memory update)
- **Scratchpad discipline:** per-agent filename prefixes under the session scratchpad.

### File map (create unless noted)

| File | Task |
|---|---|
| `backend/app/models/credit_cards.py` | 1 |
| `backend/app/models/__init__.py` (modify) | 1 |
| `backend/alembic/versions/20260825_2100_c4d1e8a2b9f3_credit_card_tables.py` | 1 |
| `backend/app/services/money.py` (modify: +`MONEY_MAX_ABS_8_2`) | 1 |
| `backend/tests/test_models_credit_cards.py` | 1 |
| `src/types/api.ts` (modify: append block) | 2 |
| `src/api/creditCards.ts` | 2 |
| `src/components/creditcards/rewardsMath.ts` + `.test.ts` | 3 |
| `src/components/creditcards/creditLineChartOptions.ts` + `.test.ts` | 4 |
| `src/components/creditcards/cardValueChartOptions.ts` + `.test.ts` | 4 |
| `backend/app/schemas/credit_cards.py` | 5 |
| `backend/app/api/credit_cards.py` (5 creates it, 6 appends) | 5, 6 |
| `backend/app/main.py` (modify) | 5 |
| `backend/tests/test_credit_cards_api.py` (5 creates, 6 appends) | 5, 6 |
| `backend/tests/test_importer_apply.py` (modify: append pin) | 7 |
| `src/components/creditcards/RewardsMatrix.tsx` + `matrix.css` | 8 |
| `src/components/creditcards/CardsPanel.tsx` + `roster.css` | 9 |
| `src/components/creditcards/CategoriesPanel.tsx` + `categories.css` | 10 |
| `src/components/creditcards/CardDetail.tsx` + `carddetail.css` | 11 |
| `src/pages/CreditCardsPage.tsx` + `.css` + `.test.tsx`; `src/App.tsx`, `src/components/navItems.ts` (modify) | 12 |

Conventions that bind every task: money rides the wire as **Decimal strings**; tooltips built as HTML run user text through `escapeHtml`; no `setState` in an effect's synchronous body; ECharts never rendered in jsdom (stub `EChart` in page tests); labels sentence case.

---

### Task 0: Environment checks (orchestrator, no subagent)

- [ ] **Step 0.1:** `cd C:/Users/edyli/personal-finance-dashboard && git status --short` → must be clean, on `main`.
- [ ] **Step 0.2:** Docker DB up: `docker ps --format "{{.Names}} {{.Ports}}"` must list `finance-dashboard-db-1` on `127.0.0.1:5433`. If not: `cmd //c start "" "Docker Desktop"` then wait and `docker start finance-dashboard-db-1`.
- [ ] **Step 0.3:** `cd backend && .venv/Scripts/python.exe -m alembic heads` → expect single head `e7c5a9f4b2d8`. If different, STOP and re-chain the migration id in Task 1 onto the actual head.
- [ ] **Step 0.4:** Baseline gates: `backend/.venv/Scripts/python.exe -m pytest -q` (expect ~886 passed, 0 failed; TransactionsPanel-style flakes are frontend-only) and `npm test` (expect ~938 passed; known flake: TransactionsPanel "save changes" — rerun once if it's the sole failure).
- [ ] **Step 0.5:** `git checkout -b credit-cards`

---

### Task 1: Backend models + migration (Wave 1, backend lane)

**Files:**
- Create: `backend/app/models/credit_cards.py`
- Modify: `backend/app/models/__init__.py`
- Modify: `backend/app/services/money.py` (one constant)
- Create: `backend/alembic/versions/20260825_2100_c4d1e8a2b9f3_credit_card_tables.py`
- Create: `backend/tests/test_models_credit_cards.py`

- [ ] **Step 1.1: Write the model file** — `backend/app/models/credit_cards.py`:

```python
"""Credit-card rewards optimizer tables (2026-08-25 spec §2).

ALL FIVE tables are dashboard-only — the workbook's Credit Card Matrix sheet is
reference material, not a source: the importer never reads or writes these tables
(rsu_grants' posture, pinned in test_importer_apply.py). Derived numbers (effective
rates, best-card sets, marginal value) are computed frontend-side; nothing here
stores a computed value.
"""

from datetime import date
from decimal import Decimal

from sqlalchemy import CheckConstraint, Date, ForeignKey, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

REWARDS_CURRENCIES = ("cash", "points", "miles")


class CreditCard(Base):
    """One real card account (holders are informational text — single-user app)."""

    __tablename__ = "credit_cards"
    __table_args__ = (
        CheckConstraint("annual_fee >= 0", name="annual_fee_non_negative"),
        CheckConstraint("point_value_cents > 0", name="point_value_positive"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    slug: Mapped[str] = mapped_column(String(120), unique=True)
    annual_fee: Mapped[Decimal] = mapped_column(Numeric(8, 2), default=Decimal("0"))
    rewards_currency: Mapped[str] = mapped_column(String(20))  # one of REWARDS_CURRENCIES
    # Valuation of ONE point/mile in cents; cash stays 1.0. The optimizer's whole
    # cross-currency comparison hangs off this column (spec §1).
    point_value_cents: Mapped[Decimal] = mapped_column(Numeric(6, 4), default=Decimal("1"))
    primary_holder: Mapped[str | None] = mapped_column(String(80))
    authorized_users: Mapped[str | None] = mapped_column(String(200))  # free-form, comma chips
    opened_on: Mapped[date | None] = mapped_column(Date)
    is_active: Mapped[bool] = mapped_column(default=True)  # archived cards keep history
    # Optional link to a group='liability' Account: balance ÷ current limit = utilization.
    account_id: Mapped[int | None] = mapped_column(
        ForeignKey("accounts.id", ondelete="SET NULL"), default=None
    )
    notes: Mapped[str | None] = mapped_column(String(300))
    sort_order: Mapped[int] = mapped_column(default=0)


class CardCredit(Base):
    """A recurring credit on a card (e.g. the $300 travel credit). `counts` is the
    user's "I actually use this" toggle — only counted credits enter the
    worth-keeping math (spec §1 economics decision)."""

    __tablename__ = "card_credits"
    __table_args__ = (CheckConstraint("annual_value >= 0", name="annual_value_non_negative"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    card_id: Mapped[int] = mapped_column(ForeignKey("credit_cards.id", ondelete="CASCADE"))
    label: Mapped[str] = mapped_column(String(120))
    annual_value: Mapped[Decimal] = mapped_column(Numeric(8, 2))
    counts: Mapped[bool] = mapped_column(default=True)


class RewardCategory(Base):
    """A matrix ROW. Distinct from spending_categories (more granular: Flights vs
    Hotels); the optional mapping feeds the auto-suggested annual weight, and
    annual_spend is the manual override. pinned_card_id is the allocation override
    (spec §1 tie decision)."""

    __tablename__ = "reward_categories"
    __table_args__ = (
        CheckConstraint("annual_spend IS NULL OR annual_spend >= 0", name="annual_spend_non_negative"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    slug: Mapped[str] = mapped_column(String(80), unique=True)
    sort_order: Mapped[int] = mapped_column(default=0)
    is_active: Mapped[bool] = mapped_column(default=True)
    annual_spend: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    spending_category_id: Mapped[int | None] = mapped_column(
        ForeignKey("spending_categories.id", ondelete="SET NULL"), default=None
    )
    pinned_card_id: Mapped[int | None] = mapped_column(
        ForeignKey("credit_cards.id", ondelete="SET NULL"), default=None
    )


class RewardRate(Base):
    """A matrix CELL: card × category → multiplier. NO row = N/A (card unusable for
    the category). monthly_cap is the bonus-rate spend ceiling (Citi Custom Cash's
    $500/mo); overflow re-allocates frontend-side."""

    __tablename__ = "reward_rates"
    __table_args__ = (
        UniqueConstraint("card_id", "category_id"),
        CheckConstraint("multiplier > 0", name="multiplier_positive"),
        CheckConstraint("monthly_cap IS NULL OR monthly_cap > 0", name="monthly_cap_positive"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    card_id: Mapped[int] = mapped_column(ForeignKey("credit_cards.id", ondelete="CASCADE"))
    category_id: Mapped[int] = mapped_column(
        ForeignKey("reward_categories.id", ondelete="CASCADE")
    )
    multiplier: Mapped[Decimal] = mapped_column(Numeric(6, 2))
    note: Mapped[str | None] = mapped_column(String(120))  # "portal", "Uber only", …
    monthly_cap: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))


class CreditLimitEvent(Base):
    """Credit-line history: dated limit changes; current limit = greatest
    effective_date. Event-shaped (not a column on the card) so v2's non-card credit
    lines (mortgage/HELOC) generalize this table instead of redesigning it."""

    __tablename__ = "credit_limit_events"
    __table_args__ = (
        UniqueConstraint("card_id", "effective_date"),
        CheckConstraint("limit_amount > 0", name="limit_amount_positive"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    card_id: Mapped[int] = mapped_column(ForeignKey("credit_cards.id", ondelete="CASCADE"))
    effective_date: Mapped[date] = mapped_column(Date)
    limit_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    note: Mapped[str | None] = mapped_column(String(120))
```

- [ ] **Step 1.2: Register in `backend/app/models/__init__.py`** — add the import (alphabetical position, after `from app.models.comp import (...)`):

```python
from app.models.credit_cards import (
    REWARDS_CURRENCIES,
    CardCredit,
    CreditCard,
    CreditLimitEvent,
    RewardCategory,
    RewardRate,
)
```

and add to `__all__` (keep the list alphabetical): `"CardCredit"`, `"CreditCard"`, `"CreditLimitEvent"`, `"REWARDS_CURRENCIES"`, `"RewardCategory"`, `"RewardRate"`.

- [ ] **Step 1.3: Add the money bound** — in `backend/app/services/money.py`, directly under the `MONEY_MAX_ABS_12_2` line, add:

```python
MONEY_MAX_ABS_8_2 = Decimal(10) ** 6  # Numeric(8,2): card annual fees / credit values
```

- [ ] **Step 1.4: Write the migration** — `backend/alembic/versions/20260825_2100_c4d1e8a2b9f3_credit_card_tables.py`. Verify the chain base first: `cd backend && .venv/Scripts/python.exe -m alembic heads` must print `e7c5a9f4b2d8`; if it differs, use the actual head as `down_revision`.

```python
"""credit card tables

Rewards-optimizer + credit-line tracking (2026-08-25 spec §2): credit_cards,
card_credits, reward_categories, reward_rates, credit_limit_events. All five are
dashboard-only and importer-immune. Purely additive.

Revision ID: c4d1e8a2b9f3
Revises: e7c5a9f4b2d8
Create Date: 2026-08-25 21:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c4d1e8a2b9f3"
down_revision: str | Sequence[str] | None = "e7c5a9f4b2d8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "credit_cards",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("slug", sa.String(length=120), nullable=False),
        sa.Column("annual_fee", sa.Numeric(precision=8, scale=2), nullable=False),
        sa.Column("rewards_currency", sa.String(length=20), nullable=False),
        sa.Column("point_value_cents", sa.Numeric(precision=6, scale=4), nullable=False),
        sa.Column("primary_holder", sa.String(length=80), nullable=True),
        sa.Column("authorized_users", sa.String(length=200), nullable=True),
        sa.Column("opened_on", sa.Date(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("account_id", sa.Integer(), nullable=True),
        sa.Column("notes", sa.String(length=300), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.CheckConstraint("annual_fee >= 0", name=op.f("ck_credit_cards_annual_fee_non_negative")),
        sa.CheckConstraint(
            "point_value_cents > 0", name=op.f("ck_credit_cards_point_value_positive")
        ),
        sa.ForeignKeyConstraint(
            ["account_id"],
            ["accounts.id"],
            name=op.f("fk_credit_cards_account_id_accounts"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_credit_cards")),
        sa.UniqueConstraint("name", name=op.f("uq_credit_cards_name")),
        sa.UniqueConstraint("slug", name=op.f("uq_credit_cards_slug")),
    )
    op.create_table(
        "card_credits",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("card_id", sa.Integer(), nullable=False),
        sa.Column("label", sa.String(length=120), nullable=False),
        sa.Column("annual_value", sa.Numeric(precision=8, scale=2), nullable=False),
        sa.Column("counts", sa.Boolean(), nullable=False),
        sa.CheckConstraint(
            "annual_value >= 0", name=op.f("ck_card_credits_annual_value_non_negative")
        ),
        sa.ForeignKeyConstraint(
            ["card_id"],
            ["credit_cards.id"],
            name=op.f("fk_card_credits_card_id_credit_cards"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_card_credits")),
    )
    op.create_table(
        "reward_categories",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("slug", sa.String(length=80), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("annual_spend", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("spending_category_id", sa.Integer(), nullable=True),
        sa.Column("pinned_card_id", sa.Integer(), nullable=True),
        sa.CheckConstraint(
            "annual_spend IS NULL OR annual_spend >= 0",
            name=op.f("ck_reward_categories_annual_spend_non_negative"),
        ),
        sa.ForeignKeyConstraint(
            ["spending_category_id"],
            ["spending_categories.id"],
            name=op.f("fk_reward_categories_spending_category_id_spending_categories"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["pinned_card_id"],
            ["credit_cards.id"],
            name=op.f("fk_reward_categories_pinned_card_id_credit_cards"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_reward_categories")),
        sa.UniqueConstraint("name", name=op.f("uq_reward_categories_name")),
        sa.UniqueConstraint("slug", name=op.f("uq_reward_categories_slug")),
    )
    op.create_table(
        "reward_rates",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("card_id", sa.Integer(), nullable=False),
        sa.Column("category_id", sa.Integer(), nullable=False),
        sa.Column("multiplier", sa.Numeric(precision=6, scale=2), nullable=False),
        sa.Column("note", sa.String(length=120), nullable=True),
        sa.Column("monthly_cap", sa.Numeric(precision=10, scale=2), nullable=True),
        sa.CheckConstraint("multiplier > 0", name=op.f("ck_reward_rates_multiplier_positive")),
        sa.CheckConstraint(
            "monthly_cap IS NULL OR monthly_cap > 0",
            name=op.f("ck_reward_rates_monthly_cap_positive"),
        ),
        sa.ForeignKeyConstraint(
            ["card_id"],
            ["credit_cards.id"],
            name=op.f("fk_reward_rates_card_id_credit_cards"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["category_id"],
            ["reward_categories.id"],
            name=op.f("fk_reward_rates_category_id_reward_categories"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_reward_rates")),
        sa.UniqueConstraint("card_id", "category_id", name=op.f("uq_reward_rates_card_id")),
    )
    op.create_table(
        "credit_limit_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("card_id", sa.Integer(), nullable=False),
        sa.Column("effective_date", sa.Date(), nullable=False),
        sa.Column("limit_amount", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("note", sa.String(length=120), nullable=True),
        sa.CheckConstraint(
            "limit_amount > 0", name=op.f("ck_credit_limit_events_limit_amount_positive")
        ),
        sa.ForeignKeyConstraint(
            ["card_id"],
            ["credit_cards.id"],
            name=op.f("fk_credit_limit_events_card_id_credit_cards"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_credit_limit_events")),
        sa.UniqueConstraint(
            "card_id", "effective_date", name=op.f("uq_credit_limit_events_card_id")
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("credit_limit_events")
    op.drop_table("reward_rates")
    op.drop_table("reward_categories")
    op.drop_table("card_credits")
    op.drop_table("credit_cards")
```

- [ ] **Step 1.5: Write model tests** — `backend/tests/test_models_credit_cards.py`. Note the conftest contract: the `db` fixture creates tables from `Base.metadata` (models must be imported via `app.models`), and after an IntegrityError you must `await db.rollback()`.

```python
"""DB-level contracts for the credit-card tables: cascades, SET NULLs, uniqueness.

API behavior lives in test_credit_cards_api.py; these pin what the SCHEMA promises
(spec §2) independent of any router."""

from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models import (
    Account,
    CardCredit,
    CreditCard,
    CreditLimitEvent,
    RewardCategory,
    RewardRate,
    SpendingCategory,
)


def _card(name: str = "Venture X", **over) -> CreditCard:
    fields = dict(
        name=name,
        slug=name.lower().replace(" ", "-"),
        annual_fee=Decimal("395.00"),
        rewards_currency="miles",
        point_value_cents=Decimal("1.7"),
    )
    fields.update(over)
    return CreditCard(**fields)


async def test_card_delete_cascades_children_but_not_categories(db):
    card = _card()
    category = RewardCategory(name="Hotels", slug="hotels")
    db.add_all([card, category])
    await db.flush()
    db.add(CardCredit(card_id=card.id, label="$300 travel credit", annual_value=Decimal("300")))
    db.add(RewardRate(card_id=card.id, category_id=category.id, multiplier=Decimal("10")))
    db.add(
        CreditLimitEvent(
            card_id=card.id, effective_date=date(2023, 5, 12), limit_amount=Decimal("20000")
        )
    )
    await db.commit()

    await db.delete(card)
    await db.commit()

    assert (await db.execute(select(CardCredit))).scalars().first() is None
    assert (await db.execute(select(RewardRate))).scalars().first() is None
    assert (await db.execute(select(CreditLimitEvent))).scalars().first() is None
    # The category survives its cells.
    assert (await db.execute(select(RewardCategory))).scalars().first() is not None


async def test_category_delete_cascades_rates_only(db):
    card = _card()
    category = RewardCategory(name="Gas", slug="gas")
    db.add_all([card, category])
    await db.flush()
    db.add(RewardRate(card_id=card.id, category_id=category.id, multiplier=Decimal("5")))
    await db.commit()

    await db.delete(category)
    await db.commit()

    assert (await db.execute(select(RewardRate))).scalars().first() is None
    assert (await db.execute(select(CreditCard))).scalars().first() is not None


async def test_account_delete_nulls_card_link(db):
    account = Account(name="CapOne VX", slug="capone-vx", group="liability")
    db.add(account)
    await db.flush()
    card = _card(account_id=account.id)
    db.add(card)
    await db.commit()

    await db.delete(account)
    await db.commit()
    db.expire_all()

    stored = (await db.execute(select(CreditCard))).scalars().one()
    assert stored.account_id is None


async def test_pinned_card_delete_nulls_the_pin(db):
    card = _card()
    db.add(card)
    await db.flush()
    category = RewardCategory(name="Dining", slug="dining", pinned_card_id=card.id)
    db.add(category)
    await db.commit()

    await db.delete(card)
    await db.commit()
    db.expire_all()

    stored = (await db.execute(select(RewardCategory))).scalars().one()
    assert stored.pinned_card_id is None


async def test_spending_category_delete_nulls_the_mapping(db):
    spending = SpendingCategory(name="Travel", slug="travel")
    db.add(spending)
    await db.flush()
    category = RewardCategory(name="Flights", slug="flights", spending_category_id=spending.id)
    db.add(category)
    await db.commit()

    await db.delete(spending)
    await db.commit()
    db.expire_all()

    stored = (await db.execute(select(RewardCategory))).scalars().one()
    assert stored.spending_category_id is None


async def test_one_cell_per_card_category_pair(db):
    card = _card()
    category = RewardCategory(name="Groceries", slug="groceries")
    db.add_all([card, category])
    await db.flush()
    db.add(RewardRate(card_id=card.id, category_id=category.id, multiplier=Decimal("2")))
    await db.commit()
    db.add(RewardRate(card_id=card.id, category_id=category.id, multiplier=Decimal("3")))
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()


async def test_one_limit_event_per_card_date(db):
    card = _card()
    db.add(card)
    await db.flush()
    db.add(
        CreditLimitEvent(
            card_id=card.id, effective_date=date(2024, 8, 1), limit_amount=Decimal("25000")
        )
    )
    await db.commit()
    db.add(
        CreditLimitEvent(
            card_id=card.id, effective_date=date(2024, 8, 1), limit_amount=Decimal("30000")
        )
    )
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()
```

- [ ] **Step 1.6: Run the new tests** — `cd backend && .venv/Scripts/python.exe -m pytest tests/test_models_credit_cards.py -q`
Expected: 7 passed.
- [ ] **Step 1.7: Migration round-trip** — from `backend/`:

```bash
.venv/Scripts/python.exe -m alembic upgrade head
.venv/Scripts/python.exe -m alembic heads     # expect: c4d1e8a2b9f3 (single head)
.venv/Scripts/python.exe -m alembic downgrade e7c5a9f4b2d8
.venv/Scripts/python.exe -m alembic upgrade head
```

Expected: all four commands exit 0. (This runs against the DEV database in `alembic.ini` — additive, safe.)
- [ ] **Step 1.8: Lint** — `.venv/Scripts/python.exe -m ruff check app tests && .venv/Scripts/python.exe -m ruff format app tests` (format writes; keep it clean — CI checks `--check`).
- [ ] **Step 1.9: Report DONE** (orchestrator commits: `git add backend/app/models/credit_cards.py backend/app/models/__init__.py backend/app/services/money.py backend/alembic/versions/20260825_2100_c4d1e8a2b9f3_credit_card_tables.py backend/tests/test_models_credit_cards.py && git commit -m "feat(credit-cards): models + migration c4d1e8a2b9f3 — five dashboard-only tables"`).

---

### Task 2: Wire types + API client (Wave 1)

**Files:**
- Modify: `src/types/api.ts` (append at end of file)
- Create: `src/api/creditCards.ts`

No test file — thin wrappers, exercised by page tests (house convention, same as `src/api/spending.ts`).

- [ ] **Step 2.1: Append to `src/types/api.ts`:**

```ts
// --- credit cards (2026-08-25 spec §2/§3) -----------------------------------------------

export type RewardsCurrency = 'cash' | 'points' | 'miles'

export interface CardCreditOut {
  id: number
  label: string
  annual_value: string
  counts: boolean
}

export interface CardCreditIn {
  label: string
  annual_value: string
  counts: boolean
}

export interface CreditLimitEventOut {
  id: number
  effective_date: string
  limit_amount: string
  note: string | null
}

export interface CreditLimitEventIn {
  effective_date: string
  limit_amount: string
  note: string | null
}

export interface CreditCardOut {
  id: number
  name: string
  slug: string
  annual_fee: string
  rewards_currency: RewardsCurrency
  point_value_cents: string
  primary_holder: string | null
  authorized_users: string | null
  opened_on: string | null
  is_active: boolean
  account_id: number | null
  notes: string | null
  sort_order: number
  credits: CardCreditOut[]
  /** Latest limit event's amount; null when no events yet. */
  current_limit: string | null
  limit_events: CreditLimitEventOut[]
}

/** POST and PATCH body — full object, house style. */
export interface CreditCardIn {
  name: string
  annual_fee: string
  rewards_currency: RewardsCurrency
  point_value_cents: string
  primary_holder: string | null
  authorized_users: string | null
  opened_on: string | null
  is_active: boolean
  account_id: number | null
  notes: string | null
  sort_order: number
}

export interface RewardCategoryOut {
  id: number
  name: string
  slug: string
  sort_order: number
  is_active: boolean
  /** Manual annual-spend override; null = derive from the mapping (or unweighted). */
  annual_spend: string | null
  spending_category_id: number | null
  pinned_card_id: number | null
}

export interface RewardCategoryCreate {
  name: string
  sort_order?: number
  annual_spend?: string | null
  spending_category_id?: number | null
  pinned_card_id?: number | null
}

/** PATCH semantics: omitted = untouched; explicit null CLEARS a nullable column
 *  (annual_spend / spending_category_id / pinned_card_id). name/sort_order/is_active
 *  ignore null (NOT NULL columns). */
export interface RewardCategoryUpdate {
  name?: string
  sort_order?: number
  is_active?: boolean
  annual_spend?: string | null
  spending_category_id?: number | null
  pinned_card_id?: number | null
}

export interface RewardRateOut {
  id: number
  card_id: number
  category_id: number
  multiplier: string
  note: string | null
  monthly_cap: string | null
}

/** Bulk matrix save row. multiplier null DELETES the cell (back to N/A). */
export interface RewardRatePut {
  card_id: number
  category_id: number
  multiplier: string | null
  note: string | null
  monthly_cap: string | null
}
```

- [ ] **Step 2.2: Create `src/api/creditCards.ts`:**

```ts
import { api } from './client'
import type {
  CardCreditIn,
  CardCreditOut,
  CreditCardIn,
  CreditCardOut,
  CreditLimitEventIn,
  CreditLimitEventOut,
  RewardCategoryCreate,
  RewardCategoryOut,
  RewardCategoryUpdate,
  RewardRateOut,
  RewardRatePut,
} from '../types/api'

export function fetchCreditCards(): Promise<CreditCardOut[]> {
  return api<CreditCardOut[]>('/credit-cards')
}

export function createCreditCard(body: CreditCardIn): Promise<CreditCardOut> {
  return api<CreditCardOut>('/credit-cards', { method: 'POST', body: JSON.stringify(body) })
}

// Full-object PATCH (the router validates the whole card), house style.
export function updateCreditCard(id: number, body: CreditCardIn): Promise<CreditCardOut> {
  return api<CreditCardOut>(`/credit-cards/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
}

export function deleteCreditCard(id: number): Promise<void> {
  return api<void>(`/credit-cards/${id}`, { method: 'DELETE' })
}

export function createCardCredit(cardId: number, body: CardCreditIn): Promise<CardCreditOut> {
  return api<CardCreditOut>(`/credit-cards/${cardId}/credits`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function updateCardCredit(creditId: number, body: CardCreditIn): Promise<CardCreditOut> {
  return api<CardCreditOut>(`/credit-cards/credits/${creditId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function deleteCardCredit(creditId: number): Promise<void> {
  return api<void>(`/credit-cards/credits/${creditId}`, { method: 'DELETE' })
}

// Response is the card's FULL limit history, ascending — the editor renders it
// without a second fetch (the budgets-PUT precedent).
export function createLimitEvent(
  cardId: number,
  body: CreditLimitEventIn,
): Promise<CreditLimitEventOut[]> {
  return api<CreditLimitEventOut[]>(`/credit-cards/${cardId}/limits`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function deleteLimitEvent(cardId: number, eventId: number): Promise<void> {
  return api<void>(`/credit-cards/${cardId}/limits/${eventId}`, { method: 'DELETE' })
}

export function fetchRewardCategories(): Promise<RewardCategoryOut[]> {
  return api<RewardCategoryOut[]>('/credit-cards/categories')
}

export function createRewardCategory(body: RewardCategoryCreate): Promise<RewardCategoryOut> {
  return api<RewardCategoryOut>('/credit-cards/categories', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function updateRewardCategory(
  id: number,
  body: RewardCategoryUpdate,
): Promise<RewardCategoryOut> {
  return api<RewardCategoryOut>(`/credit-cards/categories/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function deleteRewardCategory(id: number): Promise<void> {
  return api<void>(`/credit-cards/categories/${id}`, { method: 'DELETE' })
}

export function fetchRewardRates(): Promise<RewardRateOut[]> {
  return api<RewardRateOut[]>('/credit-cards/rates')
}

// Bulk upsert; multiplier null deletes a cell. Returns the full post-save list.
export function putRewardRates(body: RewardRatePut[]): Promise<RewardRateOut[]> {
  return api<RewardRateOut[]>('/credit-cards/rates', {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}
```

- [ ] **Step 2.3: Typecheck** — `npx tsc -b` from the repo root. Expected: exit 0.
- [ ] **Step 2.4: Report DONE** (orchestrator commit: `git add src/types/api.ts src/api/creditCards.ts && git commit -m "feat(credit-cards): wire types + api client"`).

---

### Task 3: `rewardsMath.ts` — the optimizer (Wave 1)

**Files:**
- Create: `src/components/creditcards/rewardsMath.ts`
- Create: `src/components/creditcards/rewardsMath.test.ts`

Pure module, no React. These are labeled ESTIMATES — JS `number` math is sanctioned here (spec §1 architecture decision). Ties compare within `TIE_EPSILON`.

- [ ] **Step 3.1: Write the module:**

```ts
import type {
  CreditCardOut,
  RewardCategoryOut,
  RewardRateOut,
  SpendingMatrix,
} from '../../types/api'

export const TIE_EPSILON = 1e-6

// Internal math shapes — plain numbers, decoupled from the Decimal-string wire.
export interface MathCard {
  id: number
  name: string
  annualFee: number
  pointValueCents: number
  isActive: boolean
  countedCredits: number
}

export interface MathCategory {
  id: number
  name: string
  /** Annual $ weight; null = unweighted (excluded from every $ figure). */
  weight: number | null
  pinnedCardId: number | null
  isActive: boolean
}

export interface MathRate {
  cardId: number
  categoryId: number
  multiplier: number
  monthlyCap: number | null
}

export interface Allocation {
  cardId: number
  amount: number
  earnings: number
}

export interface CategoryVerdict {
  categoryId: number
  /** ALL co-best active cards (the green set) — pure effective-rate winners. */
  bestCardIds: number[]
  tie: boolean
  /** The allocated "use this card" answer: pin > best (AF ↑, wins ↓, name ↑). */
  primaryCardId: number | null
  /** Cap-aware spend split; empty when the category is unweighted. */
  allocations: Allocation[]
  earnings: number
}

export interface CardValue {
  cardId: number
  marginal: number
  countedCredits: number
  annualFee: number
  net: number
  wonCategoryIds: number[]
}

export interface OptimizerResult {
  verdicts: Map<number, CategoryVerdict>
  /** Allocated $/yr per card (the matrix footer row). */
  cardEarnings: Map<number, number>
  cardValues: CardValue[]
  optimalTotal: number
  /** optimalTotal + counted credits − fees, over ACTIVE cards (spec §4 KPI mapping —
   *  NOT Σ net(card): marginals don't sum to the total). */
  lineupNet: number
}

export function effectiveRate(multiplier: number, pointValueCents: number): number {
  // 3x at 1.0¢ = 0.03; 2x at 1.7¢ = 0.034.
  return (multiplier * pointValueCents) / 100
}

interface RankedCell {
  cardId: number
  rate: number
  monthlyCap: number | null
}

function rankCells(
  categoryId: number,
  cards: MathCard[],
  rates: MathRate[],
  cardById: Map<number, MathCard>,
): RankedCell[] {
  return rates
    .filter((r) => r.categoryId === categoryId && cardById.get(r.cardId)?.isActive)
    .map((r) => ({
      cardId: r.cardId,
      rate: effectiveRate(r.multiplier, cardById.get(r.cardId)!.pointValueCents),
      monthlyCap: r.monthlyCap,
    }))
    .sort((a, b) => b.rate - a.rate)
}

/** Outright-win counts (unique best per category, pins ignored) — the second
 *  tie-break: consolidating onto a card you already reach for. */
function outrightWins(
  cards: MathCard[],
  categories: MathCategory[],
  rates: MathRate[],
  cardById: Map<number, MathCard>,
): Map<number, number> {
  const wins = new Map<number, number>()
  for (const category of categories) {
    if (!category.isActive) continue
    const ranked = rankCells(category.id, cards, rates, cardById)
    if (ranked.length === 0) continue
    const best = ranked.filter((c) => ranked[0].rate - c.rate <= TIE_EPSILON)
    if (best.length === 1) wins.set(best[0].cardId, (wins.get(best[0].cardId) ?? 0) + 1)
  }
  return wins
}

function pickPrimary(
  ranked: RankedCell[],
  pinnedCardId: number | null,
  cardById: Map<number, MathCard>,
  wins: Map<number, number>,
): number | null {
  if (ranked.length === 0) return null
  if (pinnedCardId !== null && ranked.some((c) => c.cardId === pinnedCardId)) return pinnedCardId
  const best = ranked.filter((c) => ranked[0].rate - c.rate <= TIE_EPSILON)
  const sorted = [...best].sort((a, b) => {
    const cardA = cardById.get(a.cardId)!
    const cardB = cardById.get(b.cardId)!
    if (cardA.annualFee !== cardB.annualFee) return cardA.annualFee - cardB.annualFee
    const winsA = wins.get(a.cardId) ?? 0
    const winsB = wins.get(b.cardId) ?? 0
    if (winsA !== winsB) return winsB - winsA
    return cardA.name.localeCompare(cardB.name)
  })
  return sorted[0].cardId
}

/** Cap-aware winner-take-most: primary absorbs spend up to its cap×12 (uncapped =
 *  everything, even a pinned non-best — that is what a pin means); overflow walks the
 *  remaining cards by rate. */
function allocate(ranked: RankedCell[], primaryId: number, weight: number): Allocation[] {
  const order = [
    ranked.find((c) => c.cardId === primaryId)!,
    ...ranked.filter((c) => c.cardId !== primaryId),
  ]
  const out: Allocation[] = []
  let remaining = weight
  for (const cell of order) {
    if (remaining <= 0) break
    const take = cell.monthlyCap === null ? remaining : Math.min(remaining, cell.monthlyCap * 12)
    if (take <= 0) continue
    out.push({ cardId: cell.cardId, amount: take, earnings: take * cell.rate })
    remaining -= take
  }
  // Every card capped below the weight: the tail earns nothing but is still spent —
  // record it on the LAST card at rate 0? No: it simply falls off the lineup (cash,
  // debit) — the optimizer only claims what the cards can earn.
  return out
}

function computeVerdicts(
  cards: MathCard[],
  categories: MathCategory[],
  rates: MathRate[],
): Map<number, CategoryVerdict> {
  const cardById = new Map(cards.map((c) => [c.id, c]))
  const wins = outrightWins(cards, categories, rates, cardById)
  const verdicts = new Map<number, CategoryVerdict>()
  for (const category of categories) {
    if (!category.isActive) continue
    const ranked = rankCells(category.id, cards, rates, cardById)
    const bestCardIds =
      ranked.length === 0
        ? []
        : ranked.filter((c) => ranked[0].rate - c.rate <= TIE_EPSILON).map((c) => c.cardId)
    const primaryCardId = pickPrimary(ranked, category.pinnedCardId, cardById, wins)
    const allocations =
      category.weight === null || primaryCardId === null
        ? []
        : allocate(ranked, primaryCardId, category.weight)
    verdicts.set(category.id, {
      categoryId: category.id,
      bestCardIds,
      tie: bestCardIds.length > 1,
      primaryCardId,
      allocations,
      earnings: allocations.reduce((acc, a) => acc + a.earnings, 0),
    })
  }
  return verdicts
}

function totalOf(verdicts: Map<number, CategoryVerdict>): number {
  let total = 0
  for (const v of verdicts.values()) total += v.earnings
  return total
}

export function optimize(
  cards: MathCard[],
  categories: MathCategory[],
  rates: MathRate[],
): OptimizerResult {
  const actives = cards.filter((c) => c.isActive)
  const verdicts = computeVerdicts(actives, categories, rates)
  const optimalTotal = totalOf(verdicts)

  const cardEarnings = new Map<number, number>()
  for (const card of actives) cardEarnings.set(card.id, 0)
  for (const v of verdicts.values())
    for (const a of v.allocations) cardEarnings.set(a.cardId, (cardEarnings.get(a.cardId) ?? 0) + a.earnings)

  const cardValues: CardValue[] = actives.map((card) => {
    const without = computeVerdicts(
      actives.filter((c) => c.id !== card.id),
      categories,
      rates,
    )
    const marginal = optimalTotal - totalOf(without)
    const wonCategoryIds = [...verdicts.values()]
      .filter((v) => v.primaryCardId === card.id)
      .map((v) => v.categoryId)
    return {
      cardId: card.id,
      marginal,
      countedCredits: card.countedCredits,
      annualFee: card.annualFee,
      net: marginal + card.countedCredits - card.annualFee,
      wonCategoryIds,
    }
  })

  const lineupNet =
    optimalTotal +
    actives.reduce((acc, c) => acc + c.countedCredits, 0) -
    actives.reduce((acc, c) => acc + c.annualFee, 0)

  return { verdicts, cardEarnings, cardValues, optimalTotal, lineupNet }
}

// --- wire adapters -----------------------------------------------------------------------

export function toMathCards(cards: CreditCardOut[]): MathCard[] {
  return cards.map((c) => ({
    id: c.id,
    name: c.name,
    annualFee: Number(c.annual_fee),
    pointValueCents: Number(c.point_value_cents),
    isActive: c.is_active,
    countedCredits: c.credits
      .filter((credit) => credit.counts)
      .reduce((acc, credit) => acc + Number(credit.annual_value), 0),
  }))
}

export function toMathCategories(
  categories: RewardCategoryOut[],
  weights: Map<number, number | null>,
): MathCategory[] {
  return categories.map((c) => ({
    id: c.id,
    name: c.name,
    weight: weights.get(c.id) ?? null,
    pinnedCardId: c.pinned_card_id,
    isActive: c.is_active,
  }))
}

export function toMathRates(rates: RewardRateOut[]): MathRate[] {
  return rates.map((r) => ({
    cardId: r.card_id,
    categoryId: r.category_id,
    multiplier: Number(r.multiplier),
    monthlyCap: r.monthly_cap === null ? null : Number(r.monthly_cap),
  }))
}

/** Trailing-12-month ANNUALIZED spend per spending category from the matrix: sum of
 *  the last up-to-12 months, scaled by 12/n when fewer months exist — an honest
 *  suggestion, not a claim. Categories with no non-null value in the window are absent. */
export function suggestedAnnualSpend(matrix: SpendingMatrix): Map<number, number> {
  const out = new Map<number, number>()
  const n = Math.min(12, matrix.months.length)
  if (n === 0) return out
  for (const series of matrix.series) {
    const window = series.values.slice(-n)
    let sum = 0
    let any = false
    for (const value of window) {
      if (value === null) continue
      any = true
      sum += Number(value)
    }
    if (any) out.set(series.category_id, (sum * 12) / n)
  }
  return out
}

/** Weight resolution (spec §4): manual override ?? suggestion via the mapping ?? null. */
export function resolveWeight(
  category: RewardCategoryOut,
  suggested: Map<number, number>,
): number | null {
  if (category.annual_spend !== null) return Number(category.annual_spend)
  if (category.spending_category_id !== null) {
    const auto = suggested.get(category.spending_category_id)
    if (auto !== undefined) return auto
  }
  return null
}
```

- [ ] **Step 3.2: Write the tests** — `src/components/creditcards/rewardsMath.test.ts`. Builders keep fixtures terse:

```ts
import { describe, expect, it } from 'vitest'
import type { RewardCategoryOut, SpendingMatrix } from '../../types/api'
import {
  effectiveRate,
  optimize,
  resolveWeight,
  suggestedAnnualSpend,
  type MathCard,
  type MathCategory,
  type MathRate,
} from './rewardsMath'

function card(id: number, name: string, over: Partial<MathCard> = {}): MathCard {
  return { id, name, annualFee: 0, pointValueCents: 1, isActive: true, countedCredits: 0, ...over }
}
function category(id: number, name: string, over: Partial<MathCategory> = {}): MathCategory {
  return { id, name, weight: 1200, pinnedCardId: null, isActive: true, ...over }
}
function rate(cardId: number, categoryId: number, multiplier: number, monthlyCap: number | null = null): MathRate {
  return { cardId, categoryId, multiplier, monthlyCap }
}

describe('effectiveRate', () => {
  it('crosses currencies: 2x miles at 1.7¢ beats 3x cash', () => {
    expect(effectiveRate(2, 1.7)).toBeCloseTo(0.034)
    expect(effectiveRate(3, 1)).toBeCloseTo(0.03)
    expect(effectiveRate(2, 1.7)).toBeGreaterThan(effectiveRate(3, 1))
  })
})

describe('green set and ties', () => {
  const vx = card(1, 'Venture X', { annualFee: 395, pointValueCents: 1.7 })
  const savor = card(2, 'SavorOne')
  const rh = card(3, 'RH Gold')

  it('valuation flips the raw-multiplier answer', () => {
    // Groceries: VX 2x (3.4%) vs Savor 3x (3.0%) — VX alone is green.
    const result = optimize([vx, savor], [category(10, 'Groceries')], [rate(1, 10, 2), rate(2, 10, 3)])
    const verdict = result.verdicts.get(10)!
    expect(verdict.bestCardIds).toEqual([1])
    expect(verdict.tie).toBe(false)
  })

  it('equal effective rates are ALL green with tie set', () => {
    // Dining: Savor 3x cash vs RH 3x cash — tie; VX absent (no cell).
    const result = optimize([vx, savor, rh], [category(11, 'Dining')], [rate(2, 11, 3), rate(3, 11, 3)])
    const verdict = result.verdicts.get(11)!
    expect(verdict.bestCardIds.sort()).toEqual([2, 3])
    expect(verdict.tie).toBe(true)
  })

  it('tie-break: lower annual fee wins the allocation', () => {
    const feeCard = card(4, 'Fee Card', { annualFee: 95 })
    const result = optimize([feeCard, savor], [category(12, 'Gas')], [rate(4, 12, 3), rate(2, 12, 3)])
    expect(result.verdicts.get(12)!.primaryCardId).toBe(2) // SavorOne, $0 fee
  })

  it('tie-break: most outright wins, then name', () => {
    // Two $0-fee cards tie on Dining; card A uniquely wins Streaming, so A takes Dining.
    const a = card(5, 'Alpha')
    const b = card(6, 'Beta')
    const result = optimize(
      [a, b],
      [category(13, 'Dining'), category(14, 'Streaming')],
      [rate(5, 13, 3), rate(6, 13, 3), rate(5, 14, 3), rate(6, 14, 1)],
    )
    expect(result.verdicts.get(13)!.primaryCardId).toBe(5)
    // And with no wins either: alphabetical.
    const bare = optimize([a, b], [category(15, 'Pets')], [rate(5, 15, 2), rate(6, 15, 2)])
    expect(bare.verdicts.get(15)!.primaryCardId).toBe(5) // 'Alpha' < 'Beta'
  })
})

describe('pins', () => {
  it('pin overrides allocation but never the green set', () => {
    const vx = card(1, 'Venture X', { pointValueCents: 1.7 })
    const savor = card(2, 'SavorOne')
    const pinned = category(20, 'Groceries', { pinnedCardId: 2 })
    const result = optimize([vx, savor], [pinned], [rate(1, 20, 2), rate(2, 20, 3)])
    const verdict = result.verdicts.get(20)!
    expect(verdict.bestCardIds).toEqual([1]) // VX 3.4% still green
    expect(verdict.primaryCardId).toBe(2) // but the pin takes the spend
    expect(verdict.allocations[0]).toEqual({ cardId: 2, amount: 1200, earnings: 1200 * 0.03 })
  })

  it('a pin to a card with no cell falls back to best', () => {
    const vx = card(1, 'Venture X')
    const savor = card(2, 'SavorOne')
    const result = optimize(
      [vx, savor],
      [category(21, 'Rent', { pinnedCardId: 1 })],
      [rate(2, 21, 1)],
    )
    expect(result.verdicts.get(21)!.primaryCardId).toBe(2)
  })
})

describe('caps and spillover', () => {
  it('capped winner spills overflow to the next-best card', () => {
    // Citi 5x capped $500/mo; RH 3x uncapped. Weight $8,000: 6,000 at 5% + 2,000 at 3%.
    const citi = card(7, 'Citi CC')
    const rh = card(8, 'RH Gold')
    const result = optimize(
      [citi, rh],
      [category(30, 'Gas', { weight: 8000 })],
      [rate(7, 30, 5, 500), rate(8, 30, 3)],
    )
    const verdict = result.verdicts.get(30)!
    expect(verdict.allocations).toEqual([
      { cardId: 7, amount: 6000, earnings: 300 },
      { cardId: 8, amount: 2000, earnings: 60 },
    ])
    expect(verdict.earnings).toBeCloseTo(360)
  })

  it('all cards capped: the un-earnable tail is claimed by nobody', () => {
    const citi = card(7, 'Citi CC')
    const result = optimize(
      [citi],
      [category(31, 'Gas', { weight: 8000 })],
      [rate(7, 31, 5, 500)],
    )
    expect(result.verdicts.get(31)!.earnings).toBeCloseTo(300) // 6k × 5%, tail earns 0
  })
})

describe('marginal value and lineup', () => {
  const vx = card(1, 'Venture X', { annualFee: 395, pointValueCents: 1.7, countedCredits: 300 })
  const savor = card(2, 'SavorOne')
  const rh = card(3, 'RH Gold')

  it('a card that only ties has $0 marginal value', () => {
    const result = optimize([savor, rh], [category(40, 'Dining', { weight: 6000 })], [
      rate(2, 40, 3),
      rate(3, 40, 3),
    ])
    for (const value of result.cardValues) expect(value.marginal).toBeCloseTo(0)
  })

  it('marginal reflects the next-best fallback, cap-aware', () => {
    // Hotels $2,400: VX 10x@1.7 = 17% → 408. Without VX: Savor 5x cash → 120. Marginal 288.
    const result = optimize(
      [vx, savor],
      [category(41, 'Hotels', { weight: 2400 })],
      [rate(1, 41, 10), rate(2, 41, 5)],
    )
    const value = result.cardValues.find((v) => v.cardId === 1)!
    expect(value.marginal).toBeCloseTo(408 - 120)
    expect(value.net).toBeCloseTo(288 + 300 - 395)
  })

  it('lineupNet is total + credits − fees, not Σ net', () => {
    const result = optimize(
      [vx, savor],
      [category(42, 'Hotels', { weight: 2400 })],
      [rate(1, 42, 10), rate(2, 42, 5)],
    )
    expect(result.optimalTotal).toBeCloseTo(408)
    expect(result.lineupNet).toBeCloseTo(408 + 300 - 395)
  })

  it('inactive cards are invisible; unweighted categories keep verdicts but no $', () => {
    const dead = card(9, 'Closed', { isActive: false })
    const result = optimize(
      [savor, dead],
      [category(43, 'Dining', { weight: null })],
      [rate(2, 43, 3), rate(9, 43, 10)],
    )
    const verdict = result.verdicts.get(43)!
    expect(verdict.bestCardIds).toEqual([2])
    expect(verdict.allocations).toEqual([])
    expect(result.optimalTotal).toBe(0)
    expect(result.cardValues.map((v) => v.cardId)).toEqual([2])
  })

  it('removing a card ignores pins that pointed at it', () => {
    // Pin Groceries to VX; VX's marginal must not double-count the pin (without VX,
    // Savor catches the spend at its own rate).
    const result = optimize(
      [vx, savor],
      [category(44, 'Groceries', { weight: 1200, pinnedCardId: 1 })],
      [rate(1, 44, 2), rate(2, 44, 3)],
    )
    const value = result.cardValues.find((v) => v.cardId === 1)!
    expect(value.marginal).toBeCloseTo(1200 * 0.034 - 1200 * 0.03)
  })
})

describe('weights', () => {
  const matrix = {
    months: ['2026-01-01', '2026-02-01', '2026-03-01'],
    categories: [],
    series: [
      { category_id: 7, values: ['100.00', null, '200.00'], budgets: [null, null, null] },
      { category_id: 8, values: [null, null, null], budgets: [null, null, null] },
    ],
    totals: [],
    net_pay: [],
    savings_rate: [],
    four_pct_rule: [],
    total_budget: [],
  } as unknown as SpendingMatrix

  it('annualizes a short window and skips all-null series', () => {
    const suggested = suggestedAnnualSpend(matrix)
    expect(suggested.get(7)).toBeCloseTo((300 * 12) / 3)
    expect(suggested.has(8)).toBe(false)
  })

  it('resolveWeight: override beats suggestion beats null', () => {
    const suggested = new Map([[7, 1200]])
    const base = {
      id: 1, name: 'Gas', slug: 'gas', sort_order: 0, is_active: true,
      annual_spend: null, spending_category_id: null, pinned_card_id: null,
    } as RewardCategoryOut
    expect(resolveWeight({ ...base, annual_spend: '2400.00', spending_category_id: 7 }, suggested)).toBe(2400)
    expect(resolveWeight({ ...base, spending_category_id: 7 }, suggested)).toBe(1200)
    expect(resolveWeight(base, suggested)).toBeNull()
  })
})
```

- [ ] **Step 3.3: Run** — `npx vitest run src/components/creditcards/rewardsMath.test.ts`
Expected: all tests pass (≈16).
- [ ] **Step 3.4: Report DONE** (orchestrator commit: `git add src/components/creditcards/rewardsMath.ts src/components/creditcards/rewardsMath.test.ts && git commit -m "feat(credit-cards): rewardsMath — valuation-aware optimizer with pins, caps, marginal value"`).

---

### Task 4: Chart option builders (Wave 1)

**Files:**
- Create: `src/components/creditcards/creditLineChartOptions.ts` + `creditLineChartOptions.test.ts`
- Create: `src/components/creditcards/cardValueChartOptions.ts` + `cardValueChartOptions.test.ts`

Both use monthly **category** axes (house grammar; no time-axis / no new echarts registrations). Line + Bar + Grid + Tooltip + Legend are already registered in `src/charts/echarts.ts` — do NOT edit that file.

- [ ] **Step 4.1: `creditLineChartOptions.ts`:**

```ts
import type { EChartsOption } from '../../charts/echarts'
import { INK, OTHER_SERIES_COLOR, PALETTE } from '../../charts/theme'
import { formatCurrency, formatCurrencyCompact, formatMonth } from '../../utils/format'
import { addMonths } from '../../utils/months'

export interface LimitHistoryCard {
  name: string
  events: { effective_date: string; limit_amount: string }[]
}

/** First-of-month ISO for an event date: '2024-08-15' → '2024-08-01'. */
export function monthOf(dateIso: string): string {
  return `${dateIso.slice(0, 7)}-01`
}

/** Ascending month axis from the earliest event month through `endMonthIso`
 *  (callers pass currentMonthIso()). Empty when no card has events. */
export function limitMonths(cards: LimitHistoryCard[], endMonthIso: string): string[] {
  let first: string | null = null
  for (const card of cards)
    for (const event of card.events) {
      const month = monthOf(event.effective_date)
      if (first === null || month < first) first = month
    }
  if (first === null) return []
  const months: string[] = []
  let cursor = first
  while (cursor <= endMonthIso) {
    months.push(cursor)
    cursor = addMonths(cursor, 1)
  }
  return months
}

/** Step-resolved limit per month: the amount of the latest event in-or-before each
 *  month; months before the first event are null (the card didn't exist yet). */
export function resolvedLimits(card: LimitHistoryCard, months: string[]): (number | null)[] {
  const events = [...card.events].sort((a, b) =>
    a.effective_date < b.effective_date ? -1 : a.effective_date > b.effective_date ? 1 : 0,
  )
  const values: (number | null)[] = []
  let pointer = 0
  let current: number | null = null
  for (const month of months) {
    while (pointer < events.length && monthOf(events[pointer].effective_date) <= month) {
      current = Number(events[pointer].limit_amount)
      pointer += 1
    }
    values.push(current)
  }
  return values
}

/** Per-card step lines + optional INK Total. PALETTE slots are fixed by array
 *  position; a 9th+ card wears OTHER_SERIES_COLOR (never cycle past 8 — theme law). */
export function creditLineChartOption(
  cards: LimitHistoryCard[],
  months: string[],
  { includeTotal }: { includeTotal: boolean },
): EChartsOption {
  const perCard = cards.map((card) => resolvedLimits(card, months))
  const total = months.map((_, i) => {
    let sum = 0
    let any = false
    for (const values of perCard) {
      const v = values[i]
      if (v === null) continue
      any = true
      sum += v
    }
    return any ? sum : null
  })
  return {
    grid: { left: 70, right: 24, top: 40, bottom: 28 },
    legend: { top: 0 },
    tooltip: {
      trigger: 'axis',
      valueFormatter: (value) =>
        value === null || value === undefined ? '—' : formatCurrency(value as number),
    },
    xAxis: { type: 'category', data: months.map(formatMonth) },
    yAxis: {
      type: 'value',
      axisLabel: { formatter: (value: number) => formatCurrencyCompact(value) },
    },
    series: [
      ...cards.map((card, i) => ({
        name: card.name,
        type: 'line' as const,
        step: 'end' as const, // limits change discretely — steps, not slopes
        symbol: 'none' as const,
        lineStyle: { width: 2 },
        color: i < PALETTE.length ? PALETTE[i] : OTHER_SERIES_COLOR,
        connectNulls: false,
        data: perCard[i],
      })),
      ...(includeTotal
        ? [
            {
              name: 'Total line',
              type: 'line' as const,
              step: 'end' as const,
              symbol: 'none' as const,
              lineStyle: { width: 2 },
              color: INK,
              z: 10,
              connectNulls: false,
              data: total,
            },
          ]
        : []),
    ],
  }
}
```

- [ ] **Step 4.2: `creditLineChartOptions.test.ts`:**

```ts
import { describe, expect, it } from 'vitest'
import {
  creditLineChartOption,
  limitMonths,
  monthOf,
  resolvedLimits,
} from './creditLineChartOptions'

const VX = {
  name: 'Venture X',
  events: [
    { effective_date: '2023-05-12', limit_amount: '20000.00' },
    { effective_date: '2024-08-01', limit_amount: '25000.00' },
  ],
}
const BILT = { name: 'BILT', events: [{ effective_date: '2024-02-20', limit_amount: '12500.00' }] }

describe('limitMonths', () => {
  it('spans earliest event month through the end month', () => {
    const months = limitMonths([VX, BILT], '2023-08-01')
    expect(months[0]).toBe('2023-05-01')
    expect(months[months.length - 1]).toBe('2023-08-01')
    expect(months).toHaveLength(4)
  })
  it('is empty with no events', () => {
    expect(limitMonths([{ name: 'X', events: [] }], '2026-08-01')).toEqual([])
  })
})

describe('resolvedLimits', () => {
  it('nulls before the first event, mid-month events land in their month, then carries', () => {
    const months = ['2023-04-01', '2023-05-01', '2024-07-01', '2024-08-01', '2024-09-01']
    expect(monthOf('2023-05-12')).toBe('2023-05-01')
    expect(resolvedLimits(VX, months)).toEqual([null, 20000, 20000, 25000, 25000])
  })
  it('sorts unordered events before resolving', () => {
    const reversed = { name: 'R', events: [...VX.events].reverse() }
    expect(resolvedLimits(reversed, ['2024-09-01'])).toEqual([25000])
  })
})

describe('creditLineChartOption', () => {
  const months = ['2024-01-01', '2024-02-01', '2024-09-01']
  it('draws one step series per card, total sums only existing cards', () => {
    const option = creditLineChartOption([VX, BILT], months, { includeTotal: true })
    const series = option.series as { name: string; step?: string; data: (number | null)[] }[]
    expect(series.map((s) => s.name)).toEqual(['Venture X', 'BILT', 'Total line'])
    expect(series.every((s) => s.step === 'end')).toBe(true)
    // Jan: VX only (20000); Feb: 20000+12500; Sep: 25000+12500.
    expect(series[2].data).toEqual([20000, 32500, 37500])
  })
  it('omits the total when not asked', () => {
    const option = creditLineChartOption([VX], months, { includeTotal: false })
    expect((option.series as unknown[]).length).toBe(1)
  })
})
```

- [ ] **Step 4.3: `cardValueChartOptions.ts`:**

```ts
import type { EChartsOption } from '../../charts/echarts'
import { MUTED, NEGATIVE, POSITIVE } from '../../charts/theme'
import { escapeHtml, formatCurrency } from '../../utils/format'

export interface CardValueDatum {
  name: string
  marginal: number
  credits: number
  fee: number
  net: number
}

/** Horizontal net-value bars, one per card, POSITIVE/NEGATIVE per datum. Callers
 *  pass rows sorted net-descending; height = max(140, rows×34 + 70). */
export function cardValueChartOption(rows: CardValueDatum[]): EChartsOption {
  return {
    grid: { left: 130, right: 40, top: 8, bottom: 28 },
    tooltip: {
      // HTML formatter — card names are user text: escapeHtml is mandatory.
      formatter: (params) => {
        const p = Array.isArray(params) ? params[0] : params
        const row = rows[p.dataIndex ?? 0]
        if (!row) return ''
        return (
          `<strong>${escapeHtml(row.name)}</strong><br/>` +
          `${formatCurrency(row.marginal)} marginal + ${formatCurrency(row.credits)} credits` +
          ` − ${formatCurrency(row.fee)} fee = <strong>${formatCurrency(row.net)}</strong>/yr`
        )
      },
    },
    xAxis: { type: 'value', axisLabel: { formatter: (v: number) => formatCurrency(v) } },
    yAxis: {
      type: 'category',
      data: rows.map((r) => r.name),
      inverse: true, // first row (best) on top
      axisLabel: { width: 118, overflow: 'truncate' as const },
    },
    series: [
      {
        type: 'bar' as const,
        barMaxWidth: 22,
        data: rows.map((r) => ({
          value: r.net,
          itemStyle: { color: r.net > 0 ? POSITIVE : NEGATIVE },
        })),
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { color: MUTED, width: 1, type: 'solid' as const },
          label: { show: false },
          data: [{ xAxis: 0 }],
        },
      },
    ],
  }
}
```

- [ ] **Step 4.4: `cardValueChartOptions.test.ts`:**

```ts
import { describe, expect, it } from 'vitest'
import { NEGATIVE, POSITIVE } from '../../charts/theme'
import { cardValueChartOption } from './cardValueChartOptions'

const ROWS = [
  { name: 'BILT', marginal: 918, credits: 0, fee: 0, net: 918 },
  { name: '<b>VX</b>', marginal: 602, credits: 300, fee: 395, net: 507 },
  { name: 'RH Gold', marginal: 0, credits: 0, fee: 0, net: 0 },
]

describe('cardValueChartOption', () => {
  const option = cardValueChartOption(ROWS)
  const series = (option.series as { data: { value: number; itemStyle: { color: string } }[]; markLine: unknown }[])[0]

  it('colors by sign — zero net reads NEGATIVE (droppable)', () => {
    expect(series.data.map((d) => d.itemStyle.color)).toEqual([POSITIVE, POSITIVE, NEGATIVE])
    expect(series.data.map((d) => d.value)).toEqual([918, 507, 0])
  })

  it('keeps caller order with inverse axis and draws the zero line', () => {
    expect((option.yAxis as { data: string[]; inverse: boolean }).data[0]).toBe('BILT')
    expect((option.yAxis as { inverse: boolean }).inverse).toBe(true)
    expect(series.markLine).toBeTruthy()
  })

  it('tooltip spells the breakdown and escapes the name', () => {
    const formatter = (option.tooltip as { formatter: (p: unknown) => string }).formatter
    const html = formatter({ dataIndex: 1 })
    expect(html).toContain('&lt;b&gt;VX&lt;/b&gt;')
    expect(html).toContain('$602') // marginal
    expect(html).toContain('$507') // net
  })
})
```

(If `formatCurrency` renders `$602.00`, assert that exact string — match the util's real output, don't fight it.)

- [ ] **Step 4.5: Run** — `npx vitest run src/components/creditcards/creditLineChartOptions.test.ts src/components/creditcards/cardValueChartOptions.test.ts`
Expected: all pass (≈8).
- [ ] **Step 4.6: Report DONE** (orchestrator commit: `git add src/components/creditcards/creditLineChartOptions.ts src/components/creditcards/creditLineChartOptions.test.ts src/components/creditcards/cardValueChartOptions.ts src/components/creditcards/cardValueChartOptions.test.ts && git commit -m "feat(credit-cards): credit-line step chart + card-value bar builders"`).

---

### Task 5: Schemas + categories/rates endpoints + router registration (Wave 2, backend lane — after Task 1)

**Files:**
- Create: `backend/app/schemas/credit_cards.py`
- Create: `backend/app/api/credit_cards.py` (categories + rates HALF; Task 6 appends cards/credits/limits BELOW — static paths must be REGISTERED before `/{card_id}` routes, or `/credit-cards/categories` 422s against the int converter)
- Modify: `backend/app/main.py`
- Create: `backend/tests/test_credit_cards_api.py` (categories + rates tests; Task 6 appends)

- [ ] **Step 5.1: Write `backend/app/schemas/credit_cards.py`:**

```python
from datetime import date
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.credit_cards import REWARDS_CURRENCIES


def _stripped_or_none(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


class CardCreditOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    label: str
    annual_value: Decimal
    counts: bool


class CardCreditIn(BaseModel):
    label: str = Field(min_length=1, max_length=120)
    annual_value: Decimal
    counts: bool = True

    @field_validator("label")
    @classmethod
    def _label_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("label must not be blank")
        return value


class CreditLimitEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    effective_date: date
    limit_amount: Decimal
    note: str | None


class CreditLimitEventIn(BaseModel):
    effective_date: date
    limit_amount: Decimal
    note: str | None = Field(default=None, max_length=120)

    @field_validator("note")
    @classmethod
    def _note_blank_to_none(cls, value: str | None) -> str | None:
        return _stripped_or_none(value)


class CreditCardOut(BaseModel):
    id: int
    name: str
    slug: str
    annual_fee: Decimal
    rewards_currency: str
    point_value_cents: Decimal
    primary_holder: str | None
    authorized_users: str | None
    opened_on: date | None
    is_active: bool
    account_id: int | None
    notes: str | None
    sort_order: int
    credits: list[CardCreditOut]
    current_limit: Decimal | None
    limit_events: list[CreditLimitEventOut]


class CreditCardIn(BaseModel):
    """POST and PATCH body — the FULL card, house full-replace style."""

    name: str = Field(min_length=1, max_length=120)
    annual_fee: Decimal = Decimal("0")
    rewards_currency: str
    point_value_cents: Decimal = Decimal("1")
    primary_holder: str | None = Field(default=None, max_length=80)
    authorized_users: str | None = Field(default=None, max_length=200)
    opened_on: date | None = None
    is_active: bool = True
    account_id: int | None = Field(default=None, ge=1, le=2_147_483_647)
    notes: str | None = Field(default=None, max_length=300)
    sort_order: int = Field(default=0, ge=0, le=1_000_000)

    @field_validator("rewards_currency")
    @classmethod
    def _known_currency(cls, value: str) -> str:
        if value not in REWARDS_CURRENCIES:
            raise ValueError(f"rewards_currency must be one of {', '.join(REWARDS_CURRENCIES)}")
        return value

    @field_validator("primary_holder", "authorized_users", "notes")
    @classmethod
    def _blank_to_none(cls, value: str | None) -> str | None:
        return _stripped_or_none(value)


class RewardCategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    slug: str
    sort_order: int
    is_active: bool
    annual_spend: Decimal | None
    spending_category_id: int | None
    pinned_card_id: int | None


class RewardCategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    sort_order: int = Field(default=0, ge=0, le=1_000_000)
    annual_spend: Decimal | None = None
    spending_category_id: int | None = Field(default=None, ge=1, le=2_147_483_647)
    pinned_card_id: int | None = Field(default=None, ge=1, le=2_147_483_647)


class RewardCategoryUpdate(BaseModel):
    """PATCH semantics: OMITTED = untouched; explicit null CLEARS a nullable column
    (annual_spend / spending_category_id / pinned_card_id). The three NOT NULL fields
    ignore explicit nulls (the spending-categories precedent)."""

    name: str | None = Field(default=None, min_length=1, max_length=80)
    sort_order: int | None = Field(default=None, ge=0, le=1_000_000)
    is_active: bool | None = None
    annual_spend: Decimal | None = None
    spending_category_id: int | None = Field(default=None, ge=1, le=2_147_483_647)
    pinned_card_id: int | None = Field(default=None, ge=1, le=2_147_483_647)


class RewardRateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    card_id: int
    category_id: int
    multiplier: Decimal
    note: str | None
    monthly_cap: Decimal | None


class RewardRatePut(BaseModel):
    """One bulk-save cell. multiplier null = DELETE the cell (back to N/A)."""

    card_id: int = Field(ge=1, le=2_147_483_647)
    category_id: int = Field(ge=1, le=2_147_483_647)
    multiplier: Decimal | None
    note: str | None = Field(default=None, max_length=120)
    monthly_cap: Decimal | None = None

    @field_validator("note")
    @classmethod
    def _note_blank_to_none(cls, value: str | None) -> str | None:
        return _stripped_or_none(value)
```

- [ ] **Step 5.2: Create `backend/app/api/credit_cards.py`** with the categories/rates half. NOTE the load-bearing comment about route order:

```python
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.importer.cells import slugify
from app.models import CreditCard, RewardCategory, RewardRate, SpendingCategory
from app.schemas.credit_cards import (
    RewardCategoryCreate,
    RewardCategoryOut,
    RewardCategoryUpdate,
    RewardRateOut,
    RewardRatePut,
)
from app.services.money import MONEY_MAX_ABS_10_2, MONEY_MAX_ABS_12_2, quantize_money

router = APIRouter(
    prefix="/credit-cards", tags=["credit-cards"], dependencies=[Depends(get_current_user)]
)

MULTIPLIER_MAX_ABS = Decimal(10_000)  # Numeric(6,2): 4 integer digits

# ROUTE ORDER IS LOAD-BEARING: /categories and /rates are declared BEFORE any
# /{card_id} route (Task 6 appends those below) — FastAPI matches in declaration
# order and "/credit-cards/categories" would otherwise 422 against the int converter.


# --- reward categories (matrix rows) ------------------------------------------------------


async def _get_reward_category(db: AsyncSession, category_id: int) -> RewardCategory:
    category = await db.get(RewardCategory, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail="reward category not found")
    return category


async def _validated_category_refs(
    db: AsyncSession, spending_category_id: int | None, pinned_card_id: int | None
) -> None:
    if spending_category_id is not None:
        if await db.get(SpendingCategory, spending_category_id) is None:
            raise HTTPException(status_code=404, detail="spending category not found")
    if pinned_card_id is not None:
        if await db.get(CreditCard, pinned_card_id) is None:
            raise HTTPException(status_code=404, detail="card not found")


def _validated_annual_spend(value: Decimal | None) -> Decimal | None:
    if value is None:
        return None
    quantized = quantize_money(value, "annual_spend", max_abs=MONEY_MAX_ABS_12_2)
    if quantized < 0:
        raise HTTPException(status_code=422, detail="annual_spend must be non-negative")
    return quantized


@router.get("/categories", response_model=list[RewardCategoryOut])
async def list_reward_categories(db: AsyncSession = Depends(get_db)) -> list[RewardCategory]:
    result = await db.execute(
        select(RewardCategory).order_by(RewardCategory.sort_order, RewardCategory.id)
    )
    return list(result.scalars().all())


@router.post("/categories", response_model=RewardCategoryOut, status_code=201)
async def create_reward_category(
    body: RewardCategoryCreate, db: AsyncSession = Depends(get_db)
) -> RewardCategory:
    slug = slugify(body.name)
    if not slug or len(slug) > 80:
        raise HTTPException(
            status_code=422,
            detail="name must contain an ASCII letter or digit and slugify to "
            "at most 80 characters",
        )
    existing = (
        (
            await db.execute(
                select(RewardCategory).where(
                    (RewardCategory.slug == slug) | (RewardCategory.name == body.name)
                )
            )
        )
        .scalars()
        .first()
    )
    if existing is not None:
        raise HTTPException(status_code=409, detail=f"reward category {slug!r} already exists")
    await _validated_category_refs(db, body.spending_category_id, body.pinned_card_id)
    category = RewardCategory(
        name=body.name,
        slug=slug,
        sort_order=body.sort_order,
        annual_spend=_validated_annual_spend(body.annual_spend),
        spending_category_id=body.spending_category_id,
        pinned_card_id=body.pinned_card_id,
    )
    db.add(category)
    await db.commit()
    return category


@router.patch("/categories/{category_id}", response_model=RewardCategoryOut)
async def update_reward_category(
    category_id: int, body: RewardCategoryUpdate, db: AsyncSession = Depends(get_db)
) -> RewardCategory:
    category = await _get_reward_category(db, category_id)
    updates = body.model_dump(exclude_unset=True)
    # NOT NULL columns ignore explicit nulls (spending-categories precedent); the three
    # nullable columns take null as CLEAR (schema docstring).
    for field in ("name", "sort_order", "is_active"):
        if field in updates and updates[field] is None:
            del updates[field]
    new_name = updates.get("name")
    if new_name is not None:
        new_slug = slugify(new_name)
        if not new_slug or len(new_slug) > 80:
            raise HTTPException(
                status_code=422,
                detail="name must contain at least one ASCII letter or digit",
            )
        if new_name != category.name:
            clash = (
                (
                    await db.execute(
                        select(RewardCategory).where(
                            (RewardCategory.name == new_name) | (RewardCategory.slug == new_slug),
                            RewardCategory.id != category_id,
                        )
                    )
                )
                .scalars()
                .first()
            )
            if clash is not None:
                raise HTTPException(status_code=409, detail="reward category name already in use")
            updates["slug"] = new_slug
    if "annual_spend" in updates:
        updates["annual_spend"] = _validated_annual_spend(updates["annual_spend"])
    await _validated_category_refs(
        db, updates.get("spending_category_id"), updates.get("pinned_card_id")
    )
    for field, value in updates.items():
        setattr(category, field, value)
    await db.commit()
    return category


@router.delete("/categories/{category_id}", status_code=204)
async def delete_reward_category(
    category_id: int, db: AsyncSession = Depends(get_db)
) -> Response:
    """Deletes the row AND its matrix cells (FK CASCADE). Unlike spending categories
    there is no monthly history to orphan — cells are cheap to re-enter, so no guard."""
    category = await _get_reward_category(db, category_id)
    await db.delete(category)
    await db.commit()
    return Response(status_code=204)


# --- reward rates (matrix cells) ----------------------------------------------------------


async def _all_rates(db: AsyncSession) -> list[RewardRate]:
    return list(
        (
            await db.execute(
                select(RewardRate).order_by(RewardRate.card_id, RewardRate.category_id)
            )
        )
        .scalars()
        .all()
    )


@router.get("/rates", response_model=list[RewardRateOut])
async def list_reward_rates(db: AsyncSession = Depends(get_db)) -> list[RewardRate]:
    return await _all_rates(db)


@router.put("/rates", response_model=list[RewardRateOut])
async def put_reward_rates(
    body: list[RewardRatePut], db: AsyncSession = Depends(get_db)
) -> list[RewardRate]:
    """Bulk matrix save: upsert cells, delete where multiplier is null. ATOMIC — any
    validation failure raises before the single commit, applying nothing. Returns the
    full post-save cell list (the matrix re-renders without a second fetch)."""
    seen: set[tuple[int, int]] = set()
    for entry in body:
        key = (entry.card_id, entry.category_id)
        if key in seen:
            raise HTTPException(
                status_code=422,
                detail=f"duplicate cell for card {entry.card_id}, category {entry.category_id}",
            )
        seen.add(key)
    card_ids = {entry.card_id for entry in body}
    category_ids = {entry.category_id for entry in body}
    if card_ids:
        found_cards = set(
            (await db.execute(select(CreditCard.id).where(CreditCard.id.in_(card_ids))))
            .scalars()
            .all()
        )
        missing = card_ids - found_cards
        if missing:
            raise HTTPException(status_code=404, detail=f"card {min(missing)} not found")
    if category_ids:
        found = set(
            (
                await db.execute(
                    select(RewardCategory.id).where(RewardCategory.id.in_(category_ids))
                )
            )
            .scalars()
            .all()
        )
        missing = category_ids - found
        if missing:
            raise HTTPException(status_code=404, detail=f"reward category {min(missing)} not found")
    existing = {
        (rate.card_id, rate.category_id): rate
        for rate in (await db.execute(select(RewardRate))).scalars()
    }
    for entry in body:
        key = (entry.card_id, entry.category_id)
        row = existing.get(key)
        if entry.multiplier is None:
            if row is not None:
                await db.delete(row)
            continue
        multiplier = quantize_money(entry.multiplier, "multiplier", max_abs=MULTIPLIER_MAX_ABS)
        if multiplier <= 0:
            raise HTTPException(status_code=422, detail="multiplier must be positive")
        cap: Decimal | None = None
        if entry.monthly_cap is not None:
            cap = quantize_money(entry.monthly_cap, "monthly_cap", max_abs=MONEY_MAX_ABS_10_2)
            if cap <= 0:
                raise HTTPException(status_code=422, detail="monthly_cap must be positive")
        if row is None:
            db.add(
                RewardRate(
                    card_id=entry.card_id,
                    category_id=entry.category_id,
                    multiplier=multiplier,
                    note=entry.note,
                    monthly_cap=cap,
                )
            )
        else:
            row.multiplier = multiplier
            row.note = entry.note
            row.monthly_cap = cap
    await db.commit()
    return await _all_rates(db)
```

- [ ] **Step 5.3: Register the router** — in `backend/app/main.py`: add `credit_cards` to the `from app.api import (...)` list (alphabetical: after `comp`) and add `app.include_router(credit_cards.router, prefix="/api/v1")` after the `calendar` include line.
- [ ] **Step 5.4: Write the tests half** — `backend/tests/test_credit_cards_api.py`:

```python
"""Endpoint tests for /credit-cards: validation fences, CRUD behavior, atomic bulk
rate saves. DB-level cascade contracts live in test_models_credit_cards.py."""

from datetime import date
from decimal import Decimal

from sqlalchemy import select

from app.models import Account, CardCredit, CreditCard, CreditLimitEvent, RewardCategory, RewardRate

CARDS = "/api/v1/credit-cards"


def card_body(name: str = "Venture X", **over) -> dict:
    body = {
        "name": name,
        "annual_fee": "395.00",
        "rewards_currency": "miles",
        "point_value_cents": "1.7",
        "primary_holder": "Ed",
        "authorized_users": None,
        "opened_on": "2023-05-12",
        "is_active": True,
        "account_id": None,
        "notes": None,
        "sort_order": 0,
    }
    body.update(over)
    return body


async def test_credit_cards_requires_auth(client):
    assert (await client.get(CARDS)).status_code == 401
    assert (await client.get(f"{CARDS}/categories")).status_code == 401
    assert (await client.get(f"{CARDS}/rates")).status_code == 401


# --- categories ---------------------------------------------------------------------------


async def test_category_create_list_and_slug_conflict(auth_client):
    created = await auth_client.post(f"{CARDS}/categories", json={"name": "Travel: Flights"})
    assert created.status_code == 201, created.text
    assert created.json()["slug"] == "travel-flights"
    dupe = await auth_client.post(f"{CARDS}/categories", json={"name": "Travel: Flights!"})
    assert dupe.status_code == 409
    listed = await auth_client.get(f"{CARDS}/categories")
    assert [c["name"] for c in listed.json()] == ["Travel: Flights"]


async def test_category_validates_weight_and_refs(auth_client):
    negative = await auth_client.post(
        f"{CARDS}/categories", json={"name": "Gas", "annual_spend": "-1"}
    )
    assert negative.status_code == 422
    assert "non-negative" in negative.json()["detail"]
    ghost_mapping = await auth_client.post(
        f"{CARDS}/categories", json={"name": "Gas", "spending_category_id": 999}
    )
    assert ghost_mapping.status_code == 404
    ghost_pin = await auth_client.post(
        f"{CARDS}/categories", json={"name": "Gas", "pinned_card_id": 999}
    )
    assert ghost_pin.status_code == 404


async def test_category_patch_null_clears_but_omitted_keeps(auth_client, db):
    card = CreditCard(
        name="SavorOne", slug="savorone", annual_fee=Decimal("0"),
        rewards_currency="cash", point_value_cents=Decimal("1"),
    )
    db.add(card)
    await db.commit()
    created = await auth_client.post(
        f"{CARDS}/categories",
        json={"name": "Dining", "annual_spend": "6000.00", "pinned_card_id": card.id},
    )
    category_id = created.json()["id"]
    # Omitted fields untouched.
    renamed = await auth_client.patch(
        f"{CARDS}/categories/{category_id}", json={"name": "Dining out"}
    )
    assert renamed.json()["annual_spend"] == "6000.00"
    assert renamed.json()["pinned_card_id"] == card.id
    assert renamed.json()["slug"] == "dining-out"
    # Explicit nulls clear the nullable columns.
    cleared = await auth_client.patch(
        f"{CARDS}/categories/{category_id}",
        json={"annual_spend": None, "pinned_card_id": None},
    )
    assert cleared.json()["annual_spend"] is None
    assert cleared.json()["pinned_card_id"] is None
    # Explicit null on a NOT NULL field is ignored.
    ignored = await auth_client.patch(f"{CARDS}/categories/{category_id}", json={"name": None})
    assert ignored.status_code == 200
    assert ignored.json()["name"] == "Dining out"


async def test_category_delete_cascades_cells(auth_client, db):
    card = CreditCard(
        name="Citi CC", slug="citi-cc", annual_fee=Decimal("0"),
        rewards_currency="cash", point_value_cents=Decimal("1"),
    )
    category = RewardCategory(name="Gas", slug="gas")
    db.add_all([card, category])
    await db.flush()
    db.add(RewardRate(card_id=card.id, category_id=category.id, multiplier=Decimal("5")))
    await db.commit()
    resp = await auth_client.delete(f"{CARDS}/categories/{category.id}")
    assert resp.status_code == 204
    assert (await db.execute(select(RewardRate))).scalars().first() is None
    missing = await auth_client.delete(f"{CARDS}/categories/{category.id}")
    assert missing.status_code == 404


# --- rates --------------------------------------------------------------------------------


async def _seed_matrix(db) -> tuple[int, int]:
    card = CreditCard(
        name="Citi CC", slug="citi-cc", annual_fee=Decimal("0"),
        rewards_currency="cash", point_value_cents=Decimal("1"),
    )
    category = RewardCategory(name="Gas", slug="gas")
    db.add_all([card, category])
    await db.commit()
    return card.id, category.id


async def test_rates_put_upserts_deletes_and_lists(auth_client, db):
    card_id, category_id = await _seed_matrix(db)
    put = await auth_client.put(
        f"{CARDS}/rates",
        json=[{
            "card_id": card_id, "category_id": category_id,
            "multiplier": "5", "note": "  top category  ", "monthly_cap": "500",
        }],
    )
    assert put.status_code == 200, put.text
    [cell] = put.json()
    assert cell["multiplier"] == "5.00"
    assert cell["note"] == "top category"  # schema strips
    assert cell["monthly_cap"] == "500.00"
    # Upsert in place: same pair, new multiplier — still one row.
    again = await auth_client.put(
        f"{CARDS}/rates",
        json=[{"card_id": card_id, "category_id": category_id,
               "multiplier": "4", "note": None, "monthly_cap": None}],
    )
    [cell] = again.json()
    assert cell["multiplier"] == "4.00"
    assert cell["monthly_cap"] is None
    # Null multiplier deletes.
    gone = await auth_client.put(
        f"{CARDS}/rates",
        json=[{"card_id": card_id, "category_id": category_id,
               "multiplier": None, "note": None, "monthly_cap": None}],
    )
    assert gone.json() == []
    listed = await auth_client.get(f"{CARDS}/rates")
    assert listed.json() == []


async def test_rates_put_is_atomic_on_unknown_ids(auth_client, db):
    card_id, category_id = await _seed_matrix(db)
    resp = await auth_client.put(
        f"{CARDS}/rates",
        json=[
            {"card_id": card_id, "category_id": category_id,
             "multiplier": "5", "note": None, "monthly_cap": None},
            {"card_id": 999, "category_id": category_id,
             "multiplier": "3", "note": None, "monthly_cap": None},
        ],
    )
    assert resp.status_code == 404
    assert "card 999 not found" in resp.json()["detail"]
    # Nothing applied — the valid first entry must NOT have landed.
    assert (await db.execute(select(RewardRate))).scalars().first() is None


async def test_rates_put_validation(auth_client, db):
    card_id, category_id = await _seed_matrix(db)
    dupe = await auth_client.put(
        f"{CARDS}/rates",
        json=[
            {"card_id": card_id, "category_id": category_id,
             "multiplier": "5", "note": None, "monthly_cap": None},
            {"card_id": card_id, "category_id": category_id,
             "multiplier": "3", "note": None, "monthly_cap": None},
        ],
    )
    assert dupe.status_code == 422
    assert "duplicate cell" in dupe.json()["detail"]
    zero = await auth_client.put(
        f"{CARDS}/rates",
        json=[{"card_id": card_id, "category_id": category_id,
               "multiplier": "0", "note": None, "monthly_cap": None}],
    )
    assert zero.status_code == 422
    assert "positive" in zero.json()["detail"]
    bad_cap = await auth_client.put(
        f"{CARDS}/rates",
        json=[{"card_id": card_id, "category_id": category_id,
               "multiplier": "5", "note": None, "monthly_cap": "0"}],
    )
    assert bad_cap.status_code == 422
```

- [ ] **Step 5.5: Run** — `cd backend && .venv/Scripts/python.exe -m pytest tests/test_credit_cards_api.py -q`
Expected: 8 passed.
- [ ] **Step 5.6: Ruff** — `.venv/Scripts/python.exe -m ruff check app tests && .venv/Scripts/python.exe -m ruff format app tests`
- [ ] **Step 5.7: Report DONE** (orchestrator commit: `git add backend/app/schemas/credit_cards.py backend/app/api/credit_cards.py backend/app/main.py backend/tests/test_credit_cards_api.py && git commit -m "feat(credit-cards): categories + bulk rates endpoints"`).

---

### Task 6: Cards + credits + limit-event endpoints (Wave 2, backend lane — after Task 5)

**Files:**
- Modify: `backend/app/api/credit_cards.py` (append BELOW the rates section — everything here may use `/{card_id}` because the static paths are already declared above)
- Modify: `backend/tests/test_credit_cards_api.py` (append)

- [ ] **Step 6.0: Extend the file's imports** (Task 5 kept them minimal so ruff stayed green): add `Account`, `CardCredit`, `CreditLimitEvent` to the `app.models` import; add `CardCreditIn`, `CardCreditOut`, `CreditCardIn`, `CreditCardOut`, `CreditLimitEventIn`, `CreditLimitEventOut` to the schemas import; add `MONEY_MAX_ABS_8_2`, `quantize_price`, `require_reasonable_date` to the money import; and add below `MULTIPLIER_MAX_ABS`:

```python
POINT_VALUE_MAX_ABS = Decimal(100)  # Numeric(6,4): 2 integer digits
```

- [ ] **Step 6.1: Append the cards/credits/limits half to `backend/app/api/credit_cards.py`:**

```python
# --- cards ---------------------------------------------------------------------------------


async def _get_card(db: AsyncSession, card_id: int) -> CreditCard:
    card = await db.get(CreditCard, card_id)
    if card is None:
        raise HTTPException(status_code=404, detail="card not found")
    return card


async def _card_children(
    db: AsyncSession, card_ids: list[int]
) -> tuple[dict[int, list[CardCredit]], dict[int, list[CreditLimitEvent]]]:
    credits: dict[int, list[CardCredit]] = {card_id: [] for card_id in card_ids}
    events: dict[int, list[CreditLimitEvent]] = {card_id: [] for card_id in card_ids}
    if card_ids:
        for credit in (
            (
                await db.execute(
                    select(CardCredit)
                    .where(CardCredit.card_id.in_(card_ids))
                    .order_by(CardCredit.id)
                )
            )
            .scalars()
            .all()
        ):
            credits[credit.card_id].append(credit)
        for event in (
            (
                await db.execute(
                    select(CreditLimitEvent)
                    .where(CreditLimitEvent.card_id.in_(card_ids))
                    .order_by(CreditLimitEvent.effective_date)
                )
            )
            .scalars()
            .all()
        ):
            events[event.card_id].append(event)
    return credits, events


def _card_out(
    card: CreditCard, credits: list[CardCredit], events: list[CreditLimitEvent]
) -> CreditCardOut:
    return CreditCardOut(
        id=card.id,
        name=card.name,
        slug=card.slug,
        annual_fee=card.annual_fee,
        rewards_currency=card.rewards_currency,
        point_value_cents=card.point_value_cents,
        primary_holder=card.primary_holder,
        authorized_users=card.authorized_users,
        opened_on=card.opened_on,
        is_active=card.is_active,
        account_id=card.account_id,
        notes=card.notes,
        sort_order=card.sort_order,
        credits=[CardCreditOut.model_validate(credit) for credit in credits],
        # Events arrive ascending by effective_date — the LAST one is current.
        current_limit=events[-1].limit_amount if events else None,
        limit_events=[CreditLimitEventOut.model_validate(event) for event in events],
    )


async def _one_card_out(db: AsyncSession, card: CreditCard) -> CreditCardOut:
    credits, events = await _card_children(db, [card.id])
    return _card_out(card, credits[card.id], events[card.id])


async def _validated_card_values(
    db: AsyncSession, body: CreditCardIn, card_id: int | None
) -> dict:
    """Shared POST/PATCH validation → column dict. Raises the router's own 422/404/409s."""
    slug = slugify(body.name)
    if not slug or len(slug) > 120:
        raise HTTPException(
            status_code=422,
            detail="name must contain an ASCII letter or digit and slugify to "
            "at most 120 characters",
        )
    clash_filter = (CreditCard.slug == slug) | (CreditCard.name == body.name)
    query = select(CreditCard).where(clash_filter)
    if card_id is not None:
        query = query.where(CreditCard.id != card_id)
    if (await db.execute(query)).scalars().first() is not None:
        raise HTTPException(status_code=409, detail=f"card {slug!r} already exists")
    fee = quantize_money(body.annual_fee, "annual_fee", max_abs=MONEY_MAX_ABS_8_2)
    if fee < 0:
        raise HTTPException(status_code=422, detail="annual_fee must be non-negative")
    point_value = quantize_price(
        body.point_value_cents, "point_value_cents", max_abs=POINT_VALUE_MAX_ABS
    )
    if point_value <= 0:
        raise HTTPException(status_code=422, detail="point_value_cents must be positive")
    if body.opened_on is not None:
        require_reasonable_date(body.opened_on, "opened_on")
    if body.account_id is not None:
        account = await db.get(Account, body.account_id)
        if account is None:
            raise HTTPException(status_code=404, detail="account not found")
        if account.group != "liability":
            raise HTTPException(
                status_code=422, detail="linked account must be in the liability group"
            )
    return {
        "name": body.name,
        "slug": slug,
        "annual_fee": fee,
        "rewards_currency": body.rewards_currency,
        "point_value_cents": point_value,
        "primary_holder": body.primary_holder,
        "authorized_users": body.authorized_users,
        "opened_on": body.opened_on,
        "is_active": body.is_active,
        "account_id": body.account_id,
        "notes": body.notes,
        "sort_order": body.sort_order,
    }


@router.get("", response_model=list[CreditCardOut])
async def list_credit_cards(db: AsyncSession = Depends(get_db)) -> list[CreditCardOut]:
    cards = list(
        (await db.execute(select(CreditCard).order_by(CreditCard.sort_order, CreditCard.id)))
        .scalars()
        .all()
    )
    credits, events = await _card_children(db, [card.id for card in cards])
    return [_card_out(card, credits[card.id], events[card.id]) for card in cards]


@router.post("", response_model=CreditCardOut, status_code=201)
async def create_credit_card(
    body: CreditCardIn, db: AsyncSession = Depends(get_db)
) -> CreditCardOut:
    values = await _validated_card_values(db, body, card_id=None)
    card = CreditCard(**values)
    db.add(card)
    await db.commit()
    return await _one_card_out(db, card)


@router.patch("/{card_id}", response_model=CreditCardOut)
async def update_credit_card(
    card_id: int, body: CreditCardIn, db: AsyncSession = Depends(get_db)
) -> CreditCardOut:
    """Full replace (house style) — the client sends the whole card back."""
    card = await _get_card(db, card_id)
    values = await _validated_card_values(db, body, card_id=card_id)
    for field, value in values.items():
        setattr(card, field, value)
    await db.commit()
    return await _one_card_out(db, card)


@router.delete("/{card_id}", status_code=204)
async def delete_credit_card(card_id: int, db: AsyncSession = Depends(get_db)) -> Response:
    """Cascades credits, cells and limit events (FK CASCADE); pins SET NULL. The
    frontend offers Undo by re-POSTing the card plus its children."""
    card = await _get_card(db, card_id)
    await db.delete(card)
    await db.commit()
    return Response(status_code=204)


# --- card credits ---------------------------------------------------------------------------


def _validated_credit_value(value: Decimal) -> Decimal:
    quantized = quantize_money(value, "annual_value", max_abs=MONEY_MAX_ABS_8_2)
    if quantized < 0:
        raise HTTPException(status_code=422, detail="annual_value must be non-negative")
    return quantized


@router.post("/{card_id}/credits", response_model=CardCreditOut, status_code=201)
async def create_card_credit(
    card_id: int, body: CardCreditIn, db: AsyncSession = Depends(get_db)
) -> CardCredit:
    await _get_card(db, card_id)
    credit = CardCredit(
        card_id=card_id,
        label=body.label,
        annual_value=_validated_credit_value(body.annual_value),
        counts=body.counts,
    )
    db.add(credit)
    await db.commit()
    return credit


@router.patch("/credits/{credit_id}", response_model=CardCreditOut)
async def update_card_credit(
    credit_id: int, body: CardCreditIn, db: AsyncSession = Depends(get_db)
) -> CardCredit:
    credit = await db.get(CardCredit, credit_id)
    if credit is None:
        raise HTTPException(status_code=404, detail="credit not found")
    credit.label = body.label
    credit.annual_value = _validated_credit_value(body.annual_value)
    credit.counts = body.counts
    await db.commit()
    return credit


@router.delete("/credits/{credit_id}", status_code=204)
async def delete_card_credit(credit_id: int, db: AsyncSession = Depends(get_db)) -> Response:
    credit = await db.get(CardCredit, credit_id)
    if credit is None:
        raise HTTPException(status_code=404, detail="credit not found")
    await db.delete(credit)
    await db.commit()
    return Response(status_code=204)


# --- credit limit events ---------------------------------------------------------------------


@router.post("/{card_id}/limits", response_model=list[CreditLimitEventOut], status_code=201)
async def create_limit_event(
    card_id: int, body: CreditLimitEventIn, db: AsyncSession = Depends(get_db)
) -> list[CreditLimitEvent]:
    """Returns the card's FULL limit history ascending (the budgets-PUT precedent) so
    the editor renders without a second fetch. Same (card, date) → 409, not upsert:
    a mis-dated entry is fixed by delete-then-re-add, keeping every change deliberate."""
    await _get_card(db, card_id)
    require_reasonable_date(body.effective_date, "effective_date")
    amount = quantize_money(body.limit_amount, "limit_amount", max_abs=MONEY_MAX_ABS_12_2)
    if amount <= 0:
        raise HTTPException(status_code=422, detail="limit_amount must be positive")
    existing = (
        (
            await db.execute(
                select(CreditLimitEvent).where(
                    CreditLimitEvent.card_id == card_id,
                    CreditLimitEvent.effective_date == body.effective_date,
                )
            )
        )
        .scalars()
        .first()
    )
    if existing is not None:
        raise HTTPException(
            status_code=409,
            detail=f"limit event for {body.effective_date} already exists — delete it first",
        )
    db.add(
        CreditLimitEvent(
            card_id=card_id,
            effective_date=body.effective_date,
            limit_amount=amount,
            note=body.note,
        )
    )
    await db.commit()
    return list(
        (
            await db.execute(
                select(CreditLimitEvent)
                .where(CreditLimitEvent.card_id == card_id)
                .order_by(CreditLimitEvent.effective_date)
            )
        )
        .scalars()
        .all()
    )


@router.delete("/{card_id}/limits/{event_id}", status_code=204)
async def delete_limit_event(
    card_id: int, event_id: int, db: AsyncSession = Depends(get_db)
) -> Response:
    await _get_card(db, card_id)
    event = await db.get(CreditLimitEvent, event_id)
    if event is None or event.card_id != card_id:
        raise HTTPException(status_code=404, detail="limit event not found")
    await db.delete(event)
    await db.commit()
    return Response(status_code=204)
```

- [ ] **Step 6.2: Append tests to `backend/tests/test_credit_cards_api.py`:**

```python
# --- cards --------------------------------------------------------------------------------


async def test_card_create_echoes_defaults_and_slug(auth_client):
    resp = await auth_client.post(CARDS, json=card_body())
    assert resp.status_code == 201, resp.text
    card = resp.json()
    assert card["slug"] == "venture-x"
    assert card["annual_fee"] == "395.00"
    assert card["point_value_cents"] == "1.7000"
    assert card["credits"] == []
    assert card["current_limit"] is None
    assert card["limit_events"] == []


async def test_card_name_and_slug_conflicts(auth_client):
    assert (await auth_client.post(CARDS, json=card_body())).status_code == 201
    same_name = await auth_client.post(CARDS, json=card_body())
    assert same_name.status_code == 409
    same_slug = await auth_client.post(CARDS, json=card_body(name="Venture X!"))
    assert same_slug.status_code == 409


async def test_card_validation_fences(auth_client, db):
    bad_currency = await auth_client.post(CARDS, json=card_body(rewards_currency="crypto"))
    assert bad_currency.status_code == 422
    negative_fee = await auth_client.post(CARDS, json=card_body(annual_fee="-1"))
    assert negative_fee.status_code == 422
    assert "non-negative" in negative_fee.json()["detail"]
    zero_point = await auth_client.post(CARDS, json=card_body(point_value_cents="0"))
    assert zero_point.status_code == 422
    silly_date = await auth_client.post(CARDS, json=card_body(opened_on="3026-01-01"))
    assert silly_date.status_code == 422
    ghost_account = await auth_client.post(CARDS, json=card_body(account_id=999))
    assert ghost_account.status_code == 404
    cash_account = Account(name="Checking", slug="checking", group="cash")
    db.add(cash_account)
    await db.commit()
    wrong_group = await auth_client.post(CARDS, json=card_body(account_id=cash_account.id))
    assert wrong_group.status_code == 422
    assert "liability" in wrong_group.json()["detail"]


async def test_card_patch_full_replace_and_rename_clash(auth_client):
    first = (await auth_client.post(CARDS, json=card_body())).json()
    second = (await auth_client.post(CARDS, json=card_body(name="SavorOne"))).json()
    renamed = await auth_client.patch(
        f"{CARDS}/{second['id']}", json=card_body(name="Savor", annual_fee="0.00")
    )
    assert renamed.status_code == 200
    assert renamed.json()["slug"] == "savor"
    clash = await auth_client.patch(f"{CARDS}/{second['id']}", json=card_body())
    assert clash.status_code == 409
    same_self = await auth_client.patch(f"{CARDS}/{first['id']}", json=card_body())
    assert same_self.status_code == 200  # renaming to your own name is not a clash


async def test_card_delete_cascades_children(auth_client, db):
    card = (await auth_client.post(CARDS, json=card_body())).json()
    await auth_client.post(
        f"{CARDS}/{card['id']}/credits",
        json={"label": "$300 travel credit", "annual_value": "300.00", "counts": True},
    )
    await auth_client.post(
        f"{CARDS}/{card['id']}/limits",
        json={"effective_date": "2023-05-12", "limit_amount": "20000.00", "note": None},
    )
    resp = await auth_client.delete(f"{CARDS}/{card['id']}")
    assert resp.status_code == 204
    assert (await db.execute(select(CardCredit))).scalars().first() is None
    assert (await db.execute(select(CreditLimitEvent))).scalars().first() is None


# --- credits ------------------------------------------------------------------------------


async def test_credit_crud_and_validation(auth_client):
    card = (await auth_client.post(CARDS, json=card_body())).json()
    blank = await auth_client.post(
        f"{CARDS}/{card['id']}/credits",
        json={"label": "   ", "annual_value": "300.00", "counts": True},
    )
    assert blank.status_code == 422
    negative = await auth_client.post(
        f"{CARDS}/{card['id']}/credits",
        json={"label": "Travel credit", "annual_value": "-5", "counts": True},
    )
    assert negative.status_code == 422
    created = await auth_client.post(
        f"{CARDS}/{card['id']}/credits",
        json={"label": "Travel credit", "annual_value": "300.00", "counts": True},
    )
    assert created.status_code == 201
    credit = created.json()
    toggled = await auth_client.patch(
        f"{CARDS}/credits/{credit['id']}",
        json={"label": "Travel credit", "annual_value": "300.00", "counts": False},
    )
    assert toggled.json()["counts"] is False
    listed = (await auth_client.get(CARDS)).json()
    assert listed[0]["credits"][0]["counts"] is False
    gone = await auth_client.delete(f"{CARDS}/credits/{credit['id']}")
    assert gone.status_code == 204
    assert (await auth_client.delete(f"{CARDS}/credits/{credit['id']}")).status_code == 404


# --- limit events ---------------------------------------------------------------------------


async def test_limits_history_resolution_and_conflicts(auth_client):
    card = (await auth_client.post(CARDS, json=card_body())).json()
    # Insert out of order: current_limit must follow the latest DATE, not insert order.
    later = await auth_client.post(
        f"{CARDS}/{card['id']}/limits",
        json={"effective_date": "2026-01-15", "limit_amount": "30000.00", "note": "auto"},
    )
    assert later.status_code == 201
    earlier = await auth_client.post(
        f"{CARDS}/{card['id']}/limits",
        json={"effective_date": "2023-05-12", "limit_amount": "20000.00", "note": "opened"},
    )
    assert earlier.status_code == 201
    history = earlier.json()
    assert [event["effective_date"] for event in history] == ["2023-05-12", "2026-01-15"]
    listed = (await auth_client.get(CARDS)).json()
    assert listed[0]["current_limit"] == "30000.00"
    dupe = await auth_client.post(
        f"{CARDS}/{card['id']}/limits",
        json={"effective_date": "2026-01-15", "limit_amount": "31000.00", "note": None},
    )
    assert dupe.status_code == 409
    zero = await auth_client.post(
        f"{CARDS}/{card['id']}/limits",
        json={"effective_date": "2026-02-01", "limit_amount": "0", "note": None},
    )
    assert zero.status_code == 422


async def test_limit_delete_is_scoped_to_the_card(auth_client):
    first = (await auth_client.post(CARDS, json=card_body())).json()
    second = (await auth_client.post(CARDS, json=card_body(name="SavorOne"))).json()
    history = (
        await auth_client.post(
            f"{CARDS}/{first['id']}/limits",
            json={"effective_date": "2024-01-01", "limit_amount": "10000.00", "note": None},
        )
    ).json()
    event_id = history[0]["id"]
    wrong_card = await auth_client.delete(f"{CARDS}/{second['id']}/limits/{event_id}")
    assert wrong_card.status_code == 404
    right_card = await auth_client.delete(f"{CARDS}/{first['id']}/limits/{event_id}")
    assert right_card.status_code == 204
```

- [ ] **Step 6.3: Run the whole file** — `cd backend && .venv/Scripts/python.exe -m pytest tests/test_credit_cards_api.py -q`
Expected: 16 passed.
- [ ] **Step 6.4: Ruff** — `.venv/Scripts/python.exe -m ruff check app tests && .venv/Scripts/python.exe -m ruff format app tests`
- [ ] **Step 6.5: Report DONE** (orchestrator commit: `git add backend/app/api/credit_cards.py backend/tests/test_credit_cards_api.py && git commit -m "feat(credit-cards): card/credit/limit endpoints — full-replace PATCH, dated limit history"`).

---

### Task 7: Importer-immunity pin (Wave 2, backend lane — after Task 6)

**Files:**
- Modify: `backend/tests/test_importer_apply.py` (append at end)

- [ ] **Step 7.1: Append the pin.** Mirror `test_importer_never_writes_category_budgets` (same file, ~line 972): it seeds rows, runs `run_import` against the repo's fixture workbook, and asserts full-tuple byte-identity via a per-table row helper. Extend the same pattern to all five credit-card tables in ONE test:

```python
def credit_card_rows(model) -> "dict[int, tuple]":
    """Column-reflection pins, as grant_row above — a column added to any credit-card
    table later is covered without anyone editing this test."""

    def snapshot(rows):
        return {row.id: tuple(getattr(row, c.key) for c in model.__table__.columns) for row in rows}

    return snapshot


async def test_importer_never_writes_credit_card_tables(db):
    """All five credit-card tables are dashboard-only (2026-08-25 spec §2, the
    rsu_grants posture): the workbook's Credit Card Matrix sheet is reference material,
    never a source — a re-import must not create, update or delete a row in any of
    them, even while it diff-updates the spending category a reward category maps to."""
    from app.importer.service import run_import
    from app.models import (
        CardCredit,
        CreditCard,
        CreditLimitEvent,
        RewardCategory,
        RewardRate,
        SpendingCategory,
    )

    # Map onto a category the workbook WILL diff-update (the budgets pin's trick):
    # slug "food" matches the workbook's Food column, sort_order 99 does not.
    spending = SpendingCategory(name="Food", slug="food", sort_order=99)
    db.add(spending)
    await db.flush()
    card = CreditCard(
        name="Venture X", slug="venture-x", annual_fee=Decimal("395.00"),
        rewards_currency="miles", point_value_cents=Decimal("1.7"),
    )
    db.add(card)
    await db.flush()
    category = RewardCategory(
        name="Dining", slug="dining", spending_category_id=spending.id, pinned_card_id=card.id
    )
    db.add(category)
    await db.flush()
    db.add(CardCredit(card_id=card.id, label="Travel credit", annual_value=Decimal("300")))
    db.add(RewardRate(card_id=card.id, category_id=category.id, multiplier=Decimal("2")))
    db.add(
        CreditLimitEvent(
            card_id=card.id, effective_date=date(2023, 5, 12), limit_amount=Decimal("20000")
        )
    )
    await db.commit()

    models = [CreditCard, CardCredit, RewardCategory, RewardRate, CreditLimitEvent]
    before = {}
    for model in models:
        rows = (await db.execute(select(model))).scalars().all()
        before[model.__tablename__] = credit_card_rows(model)(rows)

    report = await run_import(db, WORKBOOK_PATH, apply=True)  # match the budgets pin's exact call

    after = {}
    for model in models:
        rows = (
            (await db.execute(select(model).execution_options(populate_existing=True)))
            .scalars()
            .all()
        )
        after[model.__tablename__] = credit_card_rows(model)(rows)
    assert after == before
    assert all(
        table not in sheet.entities
        for sheet in report.sheets.values()
        for table in after
    )
```

**IMPORTANT:** the `run_import(...)` call signature and the workbook-path constant MUST be copied from `test_importer_never_writes_category_budgets` in the same file (it is visible right above where you are appending) — do not invent them. Reuse its imports where they already exist at module top.

- [ ] **Step 7.2: Run** — `cd backend && .venv/Scripts/python.exe -m pytest tests/test_importer_apply.py -q -k credit_card`
Expected: 1 passed.
- [ ] **Step 7.3: Report DONE** (orchestrator commit: `git add backend/tests/test_importer_apply.py && git commit -m "test(credit-cards): importer-immunity pin for all five tables"`).

---

### Task 8: `RewardsMatrix` component (Wave 2, frontend — after Tasks 2+3)

**Files:**
- Create: `src/components/creditcards/RewardsMatrix.tsx`
- Create: `src/components/creditcards/matrix.css`

No own test file — matrix behavior is pinned through the page tests (Task 12); the math it renders is pinned in `rewardsMath.test.ts`. Keep every data-bearing cell carrying `data-*` attributes as written — the page tests query them.

- [ ] **Step 8.1: Write `RewardsMatrix.tsx`:**

```tsx
import { useState } from 'react'
import AmountInput from '../AmountInput'
import InfoHint from '../InfoHint'
import type {
  CreditCardOut,
  RewardCategoryOut,
  RewardRateOut,
  RewardRatePut,
} from '../../types/api'
import { formatCurrency, formatCurrencyCompact, formatPct } from '../../utils/format'
import { canonicalAmount, isAmount } from '../../utils/amount'
import { effectiveRate, type OptimizerResult } from './rewardsMath'
import './matrix.css'

type View = 'multiplier' | 'effective'

interface CellDraft {
  multiplier: string
  note: string
  monthly_cap: string
}

const EMPTY_DRAFT: CellDraft = { multiplier: '', note: '', monthly_cap: '' }

function cellKey(cardId: number, categoryId: number): string {
  return `${cardId}:${categoryId}`
}

/** "2x", "2.5x" — trailing zeros trimmed so the sheet's familiar figures survive. */
function multiplierLabel(multiplier: string): string {
  return `${Number(multiplier)}x`
}

/**
 * The matrix: categories × cards, green = best EFFECTIVE return in both views
 * (spec: toggle changes the number you read, never the winner). Column headers are
 * buttons → drill-in. "Edit multipliers" swaps cells for draft buttons + one inspector
 * form (BracketsEditor's grid-edit spirit without 3 inputs per cell).
 */
export default function RewardsMatrix({
  cards,
  categories,
  rates,
  result,
  weights,
  busy,
  onCardClick,
  onSaveRates,
}: {
  cards: CreditCardOut[] // ACTIVE cards, page-sorted
  categories: RewardCategoryOut[] // ACTIVE categories, page-sorted
  rates: RewardRateOut[]
  result: OptimizerResult
  weights: Map<number, number | null>
  busy: boolean
  onCardClick: (card: CreditCardOut) => void
  onSaveRates: (puts: RewardRatePut[]) => Promise<void>
}) {
  const [view, setView] = useState<View>('multiplier') // spreadsheet parity by default
  const [editing, setEditing] = useState(false)
  const [drafts, setDrafts] = useState<Map<string, CellDraft>>(new Map())
  const [selected, setSelected] = useState<{ cardId: number; categoryId: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const rateByKey = new Map(rates.map((r) => [cellKey(r.card_id, r.category_id), r]))

  const startEditing = () => {
    const seeded = new Map<string, CellDraft>()
    for (const rate of rates)
      seeded.set(cellKey(rate.card_id, rate.category_id), {
        multiplier: rate.multiplier,
        note: rate.note ?? '',
        monthly_cap: rate.monthly_cap ?? '',
      })
    setDrafts(seeded)
    setSelected(null)
    setError(null)
    setEditing(true)
  }

  const stopEditing = () => {
    setEditing(false)
    setSelected(null)
    setError(null)
  }

  const draftFor = (cardId: number, categoryId: number): CellDraft =>
    drafts.get(cellKey(cardId, categoryId)) ?? EMPTY_DRAFT

  const setDraft = (cardId: number, categoryId: number, patch: Partial<CellDraft>) =>
    setDrafts((current) => {
      const next = new Map(current)
      next.set(cellKey(cardId, categoryId), { ...draftFor(cardId, categoryId), ...patch })
      return next
    })

  const save = () => {
    const puts: RewardRatePut[] = []
    for (const category of categories)
      for (const card of cards) {
        const key = cellKey(card.id, category.id)
        const draft = drafts.get(key)
        const stored = rateByKey.get(key)
        if (draft === undefined) continue
        const multiplier = draft.multiplier.trim()
        const note = draft.note.trim()
        const cap = draft.monthly_cap.trim()
        if (multiplier === '') {
          if (stored) puts.push({ card_id: card.id, category_id: category.id, multiplier: null, note: null, monthly_cap: null })
          continue
        }
        if (!isAmount(multiplier, { expressions: false }) || Number(canonicalAmount(multiplier, { expressions: false })) <= 0) {
          setError(`${category.name} × ${card.name}: multiplier must be a positive number`)
          return
        }
        if (cap !== '' && (!isAmount(cap, { expressions: false }) || Number(canonicalAmount(cap, { expressions: false })) <= 0)) {
          setError(`${category.name} × ${card.name}: monthly cap must be a positive amount`)
          return
        }
        const body: RewardRatePut = {
          card_id: card.id,
          category_id: category.id,
          multiplier: canonicalAmount(multiplier, { expressions: false }),
          note: note || null,
          monthly_cap: cap === '' ? null : canonicalAmount(cap, { expressions: false }),
        }
        const unchanged =
          stored !== undefined &&
          Number(stored.multiplier) === Number(body.multiplier) &&
          (stored.note ?? null) === body.note &&
          (stored.monthly_cap === null ? null : Number(stored.monthly_cap)) ===
            (body.monthly_cap === null ? null : Number(body.monthly_cap))
        if (!unchanged) puts.push(body)
      }
    setError(null)
    onSaveRates(puts)
      .then(() => stopEditing())
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Save failed'))
  }

  const conditionText = (rate: RewardRateOut): string | null => {
    const parts: string[] = []
    if (rate.note) parts.push(rate.note)
    if (rate.monthly_cap !== null)
      parts.push(`bonus capped at ${formatCurrency(rate.monthly_cap)}/mo`)
    return parts.length ? parts.join(' · ') : null
  }

  const selectedDraft = selected ? draftFor(selected.cardId, selected.categoryId) : null
  const selectedCard = selected ? cards.find((c) => c.id === selected.cardId) : null
  const selectedCategory = selected ? categories.find((c) => c.id === selected.categoryId) : null

  return (
    <div className="card span-12">
      <div className="matrix-header">
        <h2 className="eyebrow">
          Rewards matrix — best card per category
          <InfoHint text="Green = best effective return (multiplier × point value), whichever view is showing. Dollar figures are estimates from your category spend weights — actual card usage isn't tracked." />
        </h2>
        <div className="segmented" role="group" aria-label="Matrix view">
          {(['multiplier', 'effective'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={view === mode ? 'active' : ''}
              aria-pressed={view === mode}
              onClick={() => setView(mode)}
            >
              {mode === 'multiplier' ? 'Multiplier' : 'Effective %'}
            </button>
          ))}
        </div>
        {editing ? (
          <>
            <button type="button" className="button button-primary" disabled={busy} onClick={save}>
              Save multipliers
            </button>
            <button type="button" className="button" disabled={busy} onClick={stopEditing}>
              Cancel
            </button>
          </>
        ) : (
          <button type="button" className="button" disabled={busy} onClick={startEditing}>
            Edit multipliers
          </button>
        )}
      </div>

      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      <div className="matrix-scroll">
        <table className="data-table rewards-matrix">
          <thead>
            <tr>
              <th>Category · $/yr weight</th>
              {cards.map((card) => (
                <th key={card.id} className="num">
                  <button
                    type="button"
                    id={`card-col-${card.id}`}
                    className="matrix-card-btn"
                    aria-label={`Open ${card.name} details`}
                    onClick={() => onCardClick(card)}
                  >
                    {card.name}
                    <span className="sub">
                      {formatCurrency(card.annual_fee)} · {card.rewards_currency}
                      {Number(card.point_value_cents) !== 1 &&
                        ` ${Number(card.point_value_cents)}¢`}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categories.map((category) => {
              const verdict = result.verdicts.get(category.id)
              const weight = weights.get(category.id) ?? null
              return (
                <tr key={category.id}>
                  <td>
                    {category.name}
                    <span className="sub">
                      {' '}
                      {weight === null ? '· no weight' : `· ${formatCurrencyCompact(weight)}/yr`}
                    </span>
                  </td>
                  {cards.map((card) => {
                    const rate = rateByKey.get(cellKey(card.id, category.id))
                    if (editing) {
                      const draft = draftFor(card.id, category.id)
                      const isSelected =
                        selected?.cardId === card.id && selected?.categoryId === category.id
                      return (
                        <td key={card.id} className="num">
                          <button
                            type="button"
                            className={`mx-cell-btn${isSelected ? ' is-editing' : ''}`}
                            aria-label={`Edit ${category.name} on ${card.name}`}
                            onClick={() => setSelected({ cardId: card.id, categoryId: category.id })}
                          >
                            {draft.multiplier.trim() === '' ? '—' : `${draft.multiplier}x`}
                          </button>
                        </td>
                      )
                    }
                    if (!rate)
                      return (
                        <td key={card.id} className="num mx-na">
                          —
                        </td>
                      )
                    const best = verdict?.bestCardIds.includes(card.id) ?? false
                    const tie = best && (verdict?.tie ?? false)
                    const condition = conditionText(rate)
                    const shown =
                      view === 'multiplier'
                        ? multiplierLabel(rate.multiplier)
                        : formatPct(
                            effectiveRate(
                              Number(rate.multiplier),
                              Number(card.point_value_cents),
                            ),
                            { signed: false },
                          )
                    return (
                      <td
                        key={card.id}
                        className={`num mx-cell${best ? ' is-best' : ''}`}
                        data-best={best || undefined}
                        data-tie={tie || undefined}
                      >
                        {shown}
                        {condition && (
                          <sup className="mx-note" title={condition} aria-label={condition}>
                            ⁺
                          </sup>
                        )}
                        {tie && <span className="mx-tie">tie</span>}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <td>Est. $/yr won</td>
              {cards.map((card) => {
                const earnings = result.cardEarnings.get(card.id) ?? 0
                return (
                  <td key={card.id} className="num" data-earnings={card.slug}>
                    {earnings === 0 ? '—' : formatCurrency(earnings)}
                  </td>
                )
              })}
            </tr>
          </tfoot>
        </table>
      </div>

      {editing && (
        <div className="mx-inspector">
          {selected && selectedDraft && selectedCard && selectedCategory ? (
            <>
              <span className="mx-inspector-label">
                {selectedCategory.name} × {selectedCard.name}
              </span>
              <label>
                Multiplier
                <AmountInput
                  kind="plain"
                  id="mx-mult"
                  value={selectedDraft.multiplier}
                  onValueChange={(v) => setDraft(selected.cardId, selected.categoryId, { multiplier: v })}
                  placeholder="blank = N/A"
                />
              </label>
              <label>
                Condition note
                <input
                  className="field-input"
                  value={selectedDraft.note}
                  maxLength={120}
                  placeholder="portal, Uber only…"
                  onChange={(e) => setDraft(selected.cardId, selected.categoryId, { note: e.target.value })}
                />
              </label>
              <label>
                Monthly bonus cap
                <AmountInput
                  kind="money"
                  value={selectedDraft.monthly_cap}
                  onValueChange={(v) => setDraft(selected.cardId, selected.categoryId, { monthly_cap: v })}
                  placeholder="none"
                />
              </label>
              <button
                type="button"
                className="button"
                onClick={() => setDraft(selected.cardId, selected.categoryId, EMPTY_DRAFT)}
              >
                Clear cell
              </button>
            </>
          ) : (
            <span className="mx-inspector-label">Click a cell above to edit it.</span>
          )}
        </div>
      )}

      <p className="drill-hint">
        {editing
          ? 'Blank multiplier = N/A (the card is unusable for that category). Save applies every change at once.'
          : 'Click a card’s column header for its details. ⁺ marks a condition — hover it. Green follows effective return even in multiplier view, so a green 2x can honestly beat a plain 3x.'}
      </p>
    </div>
  )
}
```

- [ ] **Step 8.2: Write `matrix.css`:**

```css
.matrix-header {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}
.matrix-header .eyebrow {
  margin-right: auto;
}

.matrix-scroll {
  overflow-x: auto;
}

.rewards-matrix .sub {
  display: block;
  color: var(--muted);
  font-size: 0.72rem;
  font-weight: 400;
}

.matrix-card-btn {
  background: none;
  border: 0;
  padding: 0;
  color: var(--text);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  text-align: right;
}
.matrix-card-btn:hover,
.matrix-card-btn:focus-visible {
  text-decoration: underline;
}

.rewards-matrix td.mx-cell.is-best {
  background: rgba(63, 185, 104, 0.14);
  color: var(--positive);
  font-weight: 600;
}
.rewards-matrix td.mx-na {
  color: var(--muted);
}
.mx-note {
  color: var(--accent);
  cursor: help;
  margin-left: 2px;
}
.mx-tie {
  display: inline-block;
  margin-left: 6px;
  padding: 0 6px;
  border: 1px solid var(--warn);
  border-radius: 999px;
  color: var(--warn);
  font-size: 0.68rem;
}

.mx-cell-btn {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font: inherit;
  padding: 2px 8px;
  cursor: pointer;
  min-width: 3.2rem;
}
.mx-cell-btn.is-editing {
  border-color: var(--accent);
}

.mx-inspector {
  display: flex;
  align-items: flex-end;
  gap: 0.8rem;
  flex-wrap: wrap;
  margin-top: 0.6rem;
  padding: 0.6rem;
  border: 1px dashed var(--border);
  border-radius: 8px;
}
.mx-inspector label {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.78rem;
  color: var(--muted);
}
.mx-inspector-label {
  color: var(--muted);
  font-size: 0.82rem;
  align-self: center;
}
```

(Verify the CSS custom properties used here — `--muted`, `--text`, `--border`, `--surface-2`, `--positive`, `--warn`, `--accent` — all exist in `src/index.css` `:root`; they do as of 2026-08-25. If `--warn` is absent, fall back to `#c98500`.)

- [ ] **Step 8.3: Typecheck** — `npx tsc -b`. Expected: exit 0.
- [ ] **Step 8.4: Report DONE** (orchestrator commit: `git add src/components/creditcards/RewardsMatrix.tsx src/components/creditcards/matrix.css && git commit -m "feat(credit-cards): rewards matrix — toggle, green best cells, tie badges, cell editor"`).

---

### Task 9: `CardsPanel` roster (Wave 2, frontend — after Task 2)

**Files:**
- Create: `src/components/creditcards/CardsPanel.tsx`
- Create: `src/components/creditcards/roster.css`

House CRUD-panel idiom (`RsuGrantsPanel` is the canonical reference — same file shape: one form doubling as add-row and row-editor, raw-string form state, single-flight `busy`, instant delete + Undo toast, `is-editing` row class, focus back to the first typed field after save).

- [ ] **Step 9.1: Write `CardsPanel.tsx`:**

```tsx
import { useState } from 'react'
import { ApiError } from '../../api/client'
import {
  createCardCredit,
  createCreditCard,
  createLimitEvent,
  deleteCreditCard,
  updateCreditCard,
} from '../../api/creditCards'
import AmountInput from '../AmountInput'
import InfoHint from '../InfoHint'
import { useToast } from '../ToastProvider'
import type { AccountOut, CreditCardIn, CreditCardOut, RewardsCurrency } from '../../types/api'
import { canonicalAmount, isAmount } from '../../utils/amount'
import { formatCurrency, formatDate } from '../../utils/format'
import './roster.css'

const CURRENCIES: RewardsCurrency[] = ['cash', 'points', 'miles']

interface CardFormState {
  name: string
  annual_fee: string
  rewards_currency: RewardsCurrency
  point_value_cents: string
  primary_holder: string
  authorized_users: string
  opened_on: string
  account_id: string // '' = none; select values are strings
  notes: string
}

const EMPTY_CARD: CardFormState = {
  name: '', annual_fee: '', rewards_currency: 'cash', point_value_cents: '',
  primary_holder: '', authorized_users: '', opened_on: '', account_id: '', notes: '',
}

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

/**
 * Card roster: add/edit form + table. Archive = full-object PATCH flipping is_active
 * (history kept, optimizer ignores it). Delete = instant + Undo; Undo re-POSTs the
 * card AND its credits and limit events (they cascade away server-side).
 */
export default function CardsPanel({
  cards,
  accounts,
  onChanged,
}: {
  cards: CreditCardOut[]
  accounts: AccountOut[]
  onChanged: () => void
}) {
  const [form, setForm] = useState<CardFormState>(EMPTY_CARD)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  const liabilityAccounts = accounts.filter((a) => a.group === 'liability')
  const accountName = new Map(accounts.map((a) => [a.id, a.name]))

  const set = (field: keyof CardFormState) => (value: string) =>
    setForm((f) => ({ ...f, [field]: value }))

  const startEdit = (card: CreditCardOut) => {
    setEditingId(card.id)
    setForm({
      name: card.name,
      annual_fee: card.annual_fee,
      rewards_currency: card.rewards_currency,
      point_value_cents: card.point_value_cents,
      primary_holder: card.primary_holder ?? '',
      authorized_users: card.authorized_users ?? '',
      opened_on: card.opened_on ?? '',
      account_id: card.account_id === null ? '' : String(card.account_id),
      notes: card.notes ?? '',
    })
  }

  /** The full-replace body, preserving fields the form doesn't show (is_active,
   *  sort_order) from the stored row when editing. */
  const buildBody = (stored: CreditCardOut | undefined): CreditCardIn | null => {
    const name = form.name.trim()
    if (!name) {
      setError('Card name is required')
      return null
    }
    const fee = form.annual_fee.trim()
    if (fee !== '' && (!isAmount(fee, { expressions: false }) || Number(canonicalAmount(fee, { expressions: false })) < 0)) {
      setError('annual_fee must be non-negative')
      return null
    }
    const pointValue = form.point_value_cents.trim()
    if (
      pointValue !== '' &&
      (!isAmount(pointValue, { expressions: false }) ||
        Number(canonicalAmount(pointValue, { expressions: false })) <= 0)
    ) {
      setError('point_value_cents must be positive')
      return null
    }
    return {
      name,
      annual_fee: fee === '' ? '0' : canonicalAmount(fee, { expressions: false }),
      rewards_currency: form.rewards_currency,
      point_value_cents:
        pointValue === '' ? '1' : canonicalAmount(pointValue, { expressions: false }),
      primary_holder: form.primary_holder.trim() || null,
      authorized_users: form.authorized_users.trim() || null,
      opened_on: form.opened_on || null,
      is_active: stored?.is_active ?? true,
      account_id: form.account_id === '' ? null : Number(form.account_id),
      notes: form.notes.trim() || null,
      sort_order: stored?.sort_order ?? 0,
    }
  }

  const submit = () => {
    const stored = cards.find((c) => c.id === editingId)
    const body = buildBody(stored)
    if (body === null) return
    setBusy(true)
    setError(null)
    const request =
      editingId !== null ? updateCreditCard(editingId, body) : createCreditCard(body)
    request
      .then(() => {
        document.getElementById('card-name')?.focus()
        setForm(EMPTY_CARD)
        setEditingId(null)
        onChanged()
      })
      .catch((err: unknown) => setError(message(err, 'Save failed')))
      .finally(() => setBusy(false))
  }

  const toggleArchive = (card: CreditCardOut) => {
    setBusy(true)
    setError(null)
    updateCreditCard(card.id, {
      name: card.name,
      annual_fee: card.annual_fee,
      rewards_currency: card.rewards_currency,
      point_value_cents: card.point_value_cents,
      primary_holder: card.primary_holder,
      authorized_users: card.authorized_users,
      opened_on: card.opened_on,
      is_active: !card.is_active,
      account_id: card.account_id,
      notes: card.notes,
      sort_order: card.sort_order,
    })
      .then(() => onChanged())
      .catch((err: unknown) => setError(message(err, 'Archive failed')))
      .finally(() => setBusy(false))
  }

  const remove = (card: CreditCardOut) => {
    setBusy(true)
    setError(null)
    deleteCreditCard(card.id)
      .then(() => {
        if (card.id === editingId) {
          setEditingId(null)
          setForm(EMPTY_CARD)
        }
        onChanged()
        toast.success(`Deleted ${card.name}`, {
          action: {
            label: 'Undo',
            onAction: () => {
              // Re-create the card, then its cascaded children. Matrix cells are NOT
              // restored (they reference the old card id) — the toast says so.
              createCreditCard({
                name: card.name,
                annual_fee: card.annual_fee,
                rewards_currency: card.rewards_currency,
                point_value_cents: card.point_value_cents,
                primary_holder: card.primary_holder,
                authorized_users: card.authorized_users,
                opened_on: card.opened_on,
                is_active: card.is_active,
                account_id: card.account_id,
                notes: card.notes,
                sort_order: card.sort_order,
              })
                .then(async (restored) => {
                  for (const credit of card.credits)
                    await createCardCredit(restored.id, {
                      label: credit.label,
                      annual_value: credit.annual_value,
                      counts: credit.counts,
                    })
                  for (const event of card.limit_events)
                    await createLimitEvent(restored.id, {
                      effective_date: event.effective_date,
                      limit_amount: event.limit_amount,
                      note: event.note,
                    })
                  onChanged()
                  toast.info(`Restored ${card.name} — matrix multipliers were not restored`)
                })
                .catch(() => toast.error(`Could not restore ${card.name}`))
            },
          },
        })
      })
      .catch((err: unknown) => setError(message(err, 'Delete failed')))
      .finally(() => setBusy(false))
  }

  return (
    <section className="card span-12">
      <h2 className="eyebrow">
        Card roster
        <InfoHint text="One row per real card account. Archived cards keep their history but leave the matrix and the math. Dashboard-only: workbook imports never touch cards." />
      </h2>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <form
        className="roster-form"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <label>
          Card name
          <input
            id="card-name"
            className="field-input"
            value={form.name}
            onChange={(e) => set('name')(e.target.value)}
          />
        </label>
        <label>
          Annual fee
          <AmountInput
            kind="money"
            value={form.annual_fee}
            onValueChange={set('annual_fee')}
            placeholder="$0"
          />
        </label>
        <label>
          Rewards currency
          <select
            className="field-input"
            value={form.rewards_currency}
            onChange={(e) =>
              setForm((f) => ({ ...f, rewards_currency: e.target.value as RewardsCurrency }))
            }
          >
            {CURRENCIES.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </select>
        </label>
        <label>
          Point value (¢)
          {/* kind="plain": Numeric(6,4) — a 2dp money echo over 1.7000 would lie. */}
          <AmountInput
            kind="plain"
            value={form.point_value_cents}
            onValueChange={set('point_value_cents')}
            placeholder="1 = 1¢ (cash)"
          />
        </label>
        <label>
          Primary holder
          <input
            className="field-input"
            value={form.primary_holder}
            onChange={(e) => set('primary_holder')(e.target.value)}
          />
        </label>
        <label>
          Authorized users
          <input
            className="field-input"
            value={form.authorized_users}
            placeholder="comma-separated"
            onChange={(e) => set('authorized_users')(e.target.value)}
          />
        </label>
        <label>
          Opened
          <input
            className="field-input"
            type="date"
            value={form.opened_on}
            onChange={(e) => set('opened_on')(e.target.value)}
          />
        </label>
        <label>
          Linked liability account
          <select
            className="field-input"
            value={form.account_id}
            onChange={(e) => set('account_id')(e.target.value)}
          >
            <option value="">— none —</option>
            {liabilityAccounts.map((account) => (
              <option key={account.id} value={String(account.id)}>
                {account.name}
              </option>
            ))}
          </select>
        </label>
        <label className="span-2">
          Card notes
          <input
            className="field-input"
            value={form.notes}
            onChange={(e) => set('notes')(e.target.value)}
          />
        </label>
        <div className="roster-form-actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            {editingId !== null ? 'Save card' : 'Add card'}
          </button>
          {editingId !== null && (
            <button
              type="button"
              className="button"
              aria-label="Cancel the card edit"
              onClick={() => {
                setEditingId(null)
                setForm(EMPTY_CARD)
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </form>
      {cards.length === 0 ? (
        <p className="empty-note">No cards yet — add your first card above.</p>
      ) : (
        <table className="data-table roster-table">
          <thead>
            <tr>
              <th>Card</th>
              <th>Holder</th>
              <th>Auth. users</th>
              <th>Opened</th>
              <th className="num">Limit</th>
              <th>Linked account</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {cards.map((card) => (
              <tr key={card.id} className={card.id === editingId ? 'is-editing' : undefined}>
                <td>
                  {card.name}
                  <span className="sub">
                    {formatCurrency(card.annual_fee)} · {card.rewards_currency}
                    {Number(card.point_value_cents) !== 1 && ` ${Number(card.point_value_cents)}¢`}
                  </span>
                </td>
                <td>{card.primary_holder ?? '—'}</td>
                <td>{card.authorized_users ?? '—'}</td>
                <td>{card.opened_on ? formatDate(card.opened_on) : '—'}</td>
                <td className="num">
                  {card.current_limit === null ? '—' : formatCurrency(card.current_limit)}
                </td>
                <td>{card.account_id === null ? '—' : (accountName.get(card.account_id) ?? '—')}</td>
                <td>
                  <span className="badge">{card.is_active ? 'Active' : 'Archived'}</span>
                </td>
                <td className="row-actions">
                  <button
                    type="button"
                    className="button"
                    aria-label={`Edit ${card.name}`}
                    disabled={busy}
                    onClick={() => startEdit(card)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="button"
                    aria-label={card.is_active ? `Archive ${card.name}` : `Unarchive ${card.name}`}
                    disabled={busy}
                    onClick={() => toggleArchive(card)}
                  >
                    {card.is_active ? 'Archive' : 'Unarchive'}
                  </button>
                  <button
                    type="button"
                    className="button"
                    aria-label={`Delete ${card.name}`}
                    disabled={busy}
                    onClick={() => remove(card)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
```

- [ ] **Step 9.2: Write `roster.css`:**

```css
.roster-form {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.6rem 0.8rem;
  margin-bottom: 0.9rem;
}
.roster-form label {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.78rem;
  color: var(--muted);
}
.roster-form .span-2 {
  grid-column: span 2;
}
.roster-form-actions {
  display: flex;
  align-items: flex-end;
  gap: 0.5rem;
}
/* .sub is per-feature CSS in this codebase (portfolio.css precedent), not global. */
.roster-table td .sub {
  display: block;
  color: var(--muted);
  font-size: 0.72rem;
  font-weight: 400;
}
@media (max-width: 900px) {
  .roster-form {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
```

- [ ] **Step 9.3: Typecheck** — `npx tsc -b`. Expected: exit 0. (ToastProvider's `toast.info` exists — `{ success, info, error }`.)
- [ ] **Step 9.4: Report DONE** (orchestrator commit: `git add src/components/creditcards/CardsPanel.tsx src/components/creditcards/roster.css && git commit -m "feat(credit-cards): card roster panel — add/edit/archive, delete with full undo"`).

---

### Task 10: `CategoriesPanel` (Wave 2, frontend — after Tasks 2+3)

**Files:**
- Create: `src/components/creditcards/CategoriesPanel.tsx`
- Create: `src/components/creditcards/categories.css`

- [ ] **Step 10.1: Write `CategoriesPanel.tsx`:**

```tsx
import { useState } from 'react'
import { ApiError } from '../../api/client'
import {
  createRewardCategory,
  deleteRewardCategory,
  updateRewardCategory,
} from '../../api/creditCards'
import AmountInput from '../AmountInput'
import InfoHint from '../InfoHint'
import { useToast } from '../ToastProvider'
import type { CategoryOut, CreditCardOut, RewardCategoryOut } from '../../types/api'
import { canonicalAmount, isAmount } from '../../utils/amount'
import { formatCurrency } from '../../utils/format'
import './categories.css'

// The workbook's Credit Card Matrix rows — the empty-state seed (spec §4).
export const SEED_CATEGORIES = [
  'Rent/Utilities', 'Travel: Flights', 'Travel: Hotels', 'Travel: Rental Cars',
  'Ground Transportation', 'Gas', 'Groceries', 'Dining/Restaurants', 'Entertainment',
  'Streaming', 'Shopping', 'Amazon', 'Pets', 'Gifts',
]

interface CategoryFormState {
  name: string
  annual_spend: string
  spending_category_id: string
  pinned_card_id: string
}

const EMPTY_CATEGORY: CategoryFormState = {
  name: '', annual_spend: '', spending_category_id: '', pinned_card_id: '',
}

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

/**
 * Matrix rows: name, annual-spend weight (manual override; blank = auto from the
 * mapped spending category's trailing-12 suggestion), mapping, pin. Deactivate keeps
 * the row out of the matrix without losing its cells.
 */
export default function CategoriesPanel({
  categories,
  cards,
  spendingCategories,
  suggested,
  onChanged,
}: {
  categories: RewardCategoryOut[]
  cards: CreditCardOut[]
  spendingCategories: CategoryOut[]
  suggested: Map<number, number>
  onChanged: () => void
}) {
  const [form, setForm] = useState<CategoryFormState>(EMPTY_CATEGORY)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  const activeCards = cards.filter((c) => c.is_active)
  const spendingName = new Map(spendingCategories.map((c) => [c.id, c.name]))
  const cardName = new Map(cards.map((c) => [c.id, c.name]))

  const set = (field: keyof CategoryFormState) => (value: string) =>
    setForm((f) => ({ ...f, [field]: value }))

  const startEdit = (category: RewardCategoryOut) => {
    setEditingId(category.id)
    setForm({
      name: category.name,
      annual_spend: category.annual_spend ?? '',
      spending_category_id:
        category.spending_category_id === null ? '' : String(category.spending_category_id),
      pinned_card_id: category.pinned_card_id === null ? '' : String(category.pinned_card_id),
    })
  }

  const submit = () => {
    const name = form.name.trim()
    if (!name) {
      setError('Category name is required')
      return
    }
    const spend = form.annual_spend.trim()
    if (
      spend !== '' &&
      (!isAmount(spend, { expressions: false }) ||
        Number(canonicalAmount(spend, { expressions: false })) < 0)
    ) {
      setError('annual_spend must be non-negative')
      return
    }
    const body = {
      name,
      annual_spend: spend === '' ? null : canonicalAmount(spend, { expressions: false }),
      spending_category_id:
        form.spending_category_id === '' ? null : Number(form.spending_category_id),
      pinned_card_id: form.pinned_card_id === '' ? null : Number(form.pinned_card_id),
    }
    setBusy(true)
    setError(null)
    const request =
      editingId !== null
        ? updateRewardCategory(editingId, body)
        : createRewardCategory(body)
    request
      .then(() => {
        document.getElementById('reward-category-name')?.focus()
        setForm(EMPTY_CATEGORY)
        setEditingId(null)
        onChanged()
      })
      .catch((err: unknown) => setError(message(err, 'Save failed')))
      .finally(() => setBusy(false))
  }

  const toggleActive = (category: RewardCategoryOut) => {
    setBusy(true)
    setError(null)
    updateRewardCategory(category.id, { is_active: !category.is_active })
      .then(() => onChanged())
      .catch((err: unknown) => setError(message(err, 'Update failed')))
      .finally(() => setBusy(false))
  }

  const remove = (category: RewardCategoryOut) => {
    setBusy(true)
    setError(null)
    deleteRewardCategory(category.id)
      .then(() => {
        if (category.id === editingId) {
          setEditingId(null)
          setForm(EMPTY_CATEGORY)
        }
        onChanged()
        toast.success(`Deleted ${category.name} and its multipliers`, {
          action: {
            label: 'Undo',
            onAction: () => {
              // The row only — its cells cascaded away and are not restorable here.
              createRewardCategory({
                name: category.name,
                sort_order: category.sort_order,
                annual_spend: category.annual_spend,
                spending_category_id: category.spending_category_id,
                pinned_card_id: category.pinned_card_id,
              })
                .then(() => {
                  onChanged()
                  toast.info(`Restored ${category.name} — multipliers were not restored`)
                })
                .catch(() => toast.error(`Could not restore ${category.name}`))
            },
          },
        })
      })
      .catch((err: unknown) => setError(message(err, 'Delete failed')))
      .finally(() => setBusy(false))
  }

  const seed = () => {
    setBusy(true)
    setError(null)
    SEED_CATEGORIES.reduce(
      (chain, name, index) =>
        chain.then(() => createRewardCategory({ name, sort_order: index }).then(() => undefined)),
      Promise.resolve<undefined>(undefined),
    )
      .then(() => onChanged())
      .catch((err: unknown) => setError(message(err, 'Seeding failed')))
      .finally(() => setBusy(false))
  }

  const weightCell = (category: RewardCategoryOut) => {
    if (category.annual_spend !== null)
      return <>{formatCurrency(category.annual_spend)}<span className="sub"> override</span></>
    if (category.spending_category_id !== null) {
      const auto = suggested.get(category.spending_category_id)
      if (auto !== undefined)
        return <>{formatCurrency(auto)}<span className="sub"> auto · trailing 12 mo</span></>
    }
    return <span className="sub">— excluded from $ math</span>
  }

  return (
    <section className="card span-12">
      <h2 className="eyebrow">
        Categories &amp; weights
        <InfoHint text="Matrix rows. Weight = estimated annual spend: blank uses the mapped spending category's trailing-12-month figure; a typed amount overrides it. Pin forces the 'use which card' answer for a row." />
      </h2>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {categories.length === 0 && (
        <p className="empty-note">
          No categories yet.{' '}
          <button type="button" className="button" disabled={busy} onClick={seed}>
            Start with the spreadsheet's categories
          </button>
        </p>
      )}
      <form
        className="categories-form"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <label>
          Category name
          <input
            id="reward-category-name"
            className="field-input"
            value={form.name}
            onChange={(e) => set('name')(e.target.value)}
          />
        </label>
        <label>
          Annual spend override
          <AmountInput
            kind="money"
            value={form.annual_spend}
            onValueChange={set('annual_spend')}
            placeholder="blank = auto"
          />
        </label>
        <label>
          Spending category (for auto weight)
          <select
            className="field-input"
            value={form.spending_category_id}
            onChange={(e) => set('spending_category_id')(e.target.value)}
          >
            <option value="">— none —</option>
            {spendingCategories.map((category) => (
              <option key={category.id} value={String(category.id)}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Pin to card
          <select
            className="field-input"
            value={form.pinned_card_id}
            onChange={(e) => set('pinned_card_id')(e.target.value)}
          >
            <option value="">— best card wins —</option>
            {activeCards.map((card) => (
              <option key={card.id} value={String(card.id)}>
                {card.name}
              </option>
            ))}
          </select>
        </label>
        <div className="categories-form-actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            {editingId !== null ? 'Save category' : 'Add category'}
          </button>
          {editingId !== null && (
            <button
              type="button"
              className="button"
              aria-label="Cancel the category edit"
              onClick={() => {
                setEditingId(null)
                setForm(EMPTY_CATEGORY)
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </form>
      {categories.length > 0 && (
        <table className="data-table categories-table">
          <thead>
            <tr>
              <th>Category</th>
              <th className="num">Weight ($/yr est.)</th>
              <th>Mapped spending category</th>
              <th>Pinned card</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {categories.map((category) => (
              <tr key={category.id} className={category.id === editingId ? 'is-editing' : undefined}>
                <td>{category.name}</td>
                <td className="num">{weightCell(category)}</td>
                <td>
                  {category.spending_category_id === null
                    ? '—'
                    : (spendingName.get(category.spending_category_id) ?? '—')}
                </td>
                <td>
                  {category.pinned_card_id === null
                    ? '—'
                    : (cardName.get(category.pinned_card_id) ?? '—')}
                </td>
                <td>
                  <span className="badge">{category.is_active ? 'Active' : 'Hidden'}</span>
                </td>
                <td className="row-actions">
                  <button type="button" className="button" aria-label={`Edit ${category.name}`}
                    disabled={busy} onClick={() => startEdit(category)}>
                    Edit
                  </button>
                  <button type="button" className="button"
                    aria-label={category.is_active ? `Hide ${category.name}` : `Show ${category.name}`}
                    disabled={busy} onClick={() => toggleActive(category)}>
                    {category.is_active ? 'Hide' : 'Show'}
                  </button>
                  <button type="button" className="button" aria-label={`Delete ${category.name}`}
                    disabled={busy} onClick={() => remove(category)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
```

- [ ] **Step 10.2: Write `categories.css`:**

```css
.categories-form {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.6rem 0.8rem;
  margin-bottom: 0.9rem;
}
.categories-form label {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.78rem;
  color: var(--muted);
}
.categories-form-actions {
  display: flex;
  align-items: flex-end;
  gap: 0.5rem;
}
.categories-table td .sub {
  color: var(--muted);
  font-size: 0.72rem;
  font-weight: 400;
}
@media (max-width: 900px) {
  .categories-form {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
```

- [ ] **Step 10.3: Typecheck** — `npx tsc -b`. Expected: exit 0. Note the PATCH nuance this component RELIES on: `updateRewardCategory(id, { is_active })` sends ONLY that key — omitted fields stay untouched server-side (Task 5's exclude_unset contract), while the edit-form PATCH always sends all four keys so blank boxes CLEAR via explicit null.
- [ ] **Step 10.4: Report DONE** (orchestrator commit: `git add src/components/creditcards/CategoriesPanel.tsx src/components/creditcards/categories.css && git commit -m "feat(credit-cards): categories & weights panel with spreadsheet seed"`).

---

### Task 11: `CardDetail` drill-in (Wave 2, frontend — after Tasks 2+3+4)

**Files:**
- Create: `src/components/creditcards/CardDetail.tsx`
- Create: `src/components/creditcards/carddetail.css`

The `?card=` drill-in view: replaces the page body while open (SpendingPage's month-pie precedent). Card FIELD editing stays in the roster (spec §4 drill-in contents are chips + tracking data — deliberate; do not add an edit form here).

- [ ] **Step 11.1: Write `CardDetail.tsx`:**

```tsx
import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../api/client'
import {
  createCardCredit,
  createLimitEvent,
  deleteCardCredit,
  deleteLimitEvent,
  updateCardCredit,
} from '../../api/creditCards'
import { fetchMonthBalances, fetchSummary } from '../../api/netWorth'
import AmountInput from '../AmountInput'
import EChart from '../EChart'
import InfoHint from '../InfoHint'
import StatTile from '../StatTile'
import { useToast } from '../ToastProvider'
import type {
  AccountOut,
  CreditCardOut,
  RewardCategoryOut,
  RewardRateOut,
} from '../../types/api'
import { canonicalAmount, isAmount } from '../../utils/amount'
import { formatCurrency, formatDate, formatMonth, formatPct } from '../../utils/format'
import { currentMonthIso } from '../../utils/months'
import { creditLineChartOption, limitMonths } from './creditLineChartOptions'
import type { OptimizerResult } from './rewardsMath'
import './carddetail.css'

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

/**
 * Everything about ONE card: meta chips, worth-keeping stat, credits editor, its
 * matrix rewards, limit-history editor + step sparkline, utilization from the linked
 * liability account's latest snapshot balance.
 */
export default function CardDetail({
  card,
  result,
  rates,
  categories,
  accounts,
  busy,
  onClose,
  onChanged,
}: {
  card: CreditCardOut
  result: OptimizerResult
  rates: RewardRateOut[]
  categories: RewardCategoryOut[]
  accounts: AccountOut[]
  busy: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [localBusy, setLocalBusy] = useState(false)
  const [creditForm, setCreditForm] = useState({ label: '', annual_value: '' })
  const [limitForm, setLimitForm] = useState({ effective_date: '', limit_amount: '', note: '' })
  // Latest-snapshot balance for the linked account; null = not linked / not loaded.
  const [utilization, setUtilization] = useState<{ month: string; balance: number } | null>(null)
  const toast = useToast()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const anyBusy = busy || localBusy

  // Hand focus to the heading on open — the drill-in replaced the page the trigger
  // button lived on (the house focus-management posture).
  useEffect(() => {
    headingRef.current?.focus()
  }, [card.id])

  useEffect(() => {
    if (card.account_id === null) return
    let cancelled = false
    fetchSummary()
      .then((summary) => {
        if (summary.month === null) return null
        return fetchMonthBalances(summary.month)
      })
      .then((balances) => {
        if (cancelled || !balances) return
        const entry = balances.balances.find((b) => b.account_id === card.account_id)
        if (entry) setUtilization({ month: balances.month, balance: Number(entry.balance) })
      })
      .catch(() => {
        // Utilization is a nicety — degrade silently, never an error banner.
      })
    return () => {
      cancelled = true
    }
  }, [card.account_id])

  const accountName =
    card.account_id === null
      ? null
      : (accounts.find((a) => a.id === card.account_id)?.name ?? null)
  const value = result.cardValues.find((v) => v.cardId === card.id)
  const nameByCategory = new Map(categories.map((c) => [c.id, c.name]))
  const myRates = rates
    .filter((r) => r.card_id === card.id)
    .map((r) => ({ ...r, categoryName: nameByCategory.get(r.category_id) ?? String(r.category_id) }))
  const wonIds = new Set(value?.wonCategoryIds ?? [])

  const addCredit = () => {
    const label = creditForm.label.trim()
    const amount = creditForm.annual_value.trim()
    if (!label || !amount) {
      setError('Credit label and annual value are required')
      return
    }
    if (!isAmount(amount, { expressions: false }) || Number(canonicalAmount(amount, { expressions: false })) < 0) {
      setError('annual_value must be non-negative')
      return
    }
    setLocalBusy(true)
    setError(null)
    createCardCredit(card.id, {
      label,
      annual_value: canonicalAmount(amount, { expressions: false }),
      counts: true,
    })
      .then(() => {
        setCreditForm({ label: '', annual_value: '' })
        onChanged()
      })
      .catch((err: unknown) => setError(message(err, 'Save failed')))
      .finally(() => setLocalBusy(false))
  }

  const toggleCredit = (creditId: number) => {
    const credit = card.credits.find((c) => c.id === creditId)
    if (!credit) return
    setLocalBusy(true)
    setError(null)
    updateCardCredit(creditId, {
      label: credit.label,
      annual_value: credit.annual_value,
      counts: !credit.counts,
    })
      .then(() => onChanged())
      .catch((err: unknown) => setError(message(err, 'Update failed')))
      .finally(() => setLocalBusy(false))
  }

  const removeCredit = (creditId: number) => {
    const credit = card.credits.find((c) => c.id === creditId)
    if (!credit) return
    setLocalBusy(true)
    setError(null)
    deleteCardCredit(creditId)
      .then(() => {
        onChanged()
        toast.success(`Deleted the ${credit.label} credit`, {
          action: {
            label: 'Undo',
            onAction: () => {
              createCardCredit(card.id, {
                label: credit.label,
                annual_value: credit.annual_value,
                counts: credit.counts,
              })
                .then(() => onChanged())
                .catch(() => toast.error(`Could not restore the ${credit.label} credit`))
            },
          },
        })
      })
      .catch((err: unknown) => setError(message(err, 'Delete failed')))
      .finally(() => setLocalBusy(false))
  }

  const addLimit = () => {
    const amount = limitForm.limit_amount.trim()
    if (!limitForm.effective_date || !amount) {
      setError('Limit date and amount are required')
      return
    }
    if (!isAmount(amount, { expressions: false }) || Number(canonicalAmount(amount, { expressions: false })) <= 0) {
      setError('limit_amount must be positive')
      return
    }
    setLocalBusy(true)
    setError(null)
    createLimitEvent(card.id, {
      effective_date: limitForm.effective_date,
      limit_amount: canonicalAmount(amount, { expressions: false }),
      note: limitForm.note.trim() || null,
    })
      .then(() => {
        setLimitForm({ effective_date: '', limit_amount: '', note: '' })
        onChanged()
      })
      .catch((err: unknown) => setError(message(err, 'Save failed')))
      .finally(() => setLocalBusy(false))
  }

  const removeLimit = (eventId: number) => {
    setLocalBusy(true)
    setError(null)
    deleteLimitEvent(card.id, eventId)
      .then(() => onChanged())
      .catch((err: unknown) => setError(message(err, 'Delete failed')))
      .finally(() => setLocalBusy(false))
  }

  const sparkMonths = limitMonths(
    [{ name: card.name, events: card.limit_events }],
    currentMonthIso(),
  )
  const sparkOption =
    card.limit_events.length > 0
      ? creditLineChartOption(
          [{ name: card.name, events: card.limit_events }],
          sparkMonths,
          { includeTotal: false },
        )
      : null

  const utilizationPct =
    utilization !== null && card.current_limit !== null && Number(card.current_limit) > 0
      ? Math.abs(utilization.balance) / Number(card.current_limit)
      : null

  return (
    <div className="card-detail">
      <div className="page-header">
        <button type="button" className="button" onClick={onClose} aria-label="Back to the matrix">
          ✕ Back to matrix
        </button>
        {/* tabIndex -1: focus target on open, not in the tab order. */}
        <h2 ref={headingRef} tabIndex={-1} className="card-detail-title">
          {card.name}
        </h2>
        <div className="spacer" />
      </div>

      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      <div className="chip-row">
        <span className="chip">Holder: {card.primary_holder ?? '—'}</span>
        <span className="chip">AU: {card.authorized_users ?? '—'}</span>
        <span className="chip">
          Opened {card.opened_on ? formatDate(card.opened_on) : '—'}
        </span>
        <span className="chip">AF {formatCurrency(card.annual_fee)}</span>
        <span className="chip">
          {card.rewards_currency} @ {Number(card.point_value_cents)}¢/pt
        </span>
        {accountName && <span className="chip">Linked: {accountName}</span>}
        {!card.is_active && <span className="chip">Archived</span>}
      </div>

      <div className="card-grid">
        <div className="card span-6">
          <h2 className="eyebrow">
            Worth keeping? (est.)
            <InfoHint text="Marginal rewards (optimal lineup with this card minus without it) plus counted credits, minus the annual fee. Estimates from your category weights." />
          </h2>
          {value ? (
            <>
              <StatTile
                label="Net value per year"
                value={formatCurrency(value.net)}
                tone={value.net > 0 ? 'positive' : 'negative'}
                hint="marginal + counted credits − annual fee"
              />
              <p className="drill-hint">
                {formatCurrency(value.marginal)} marginal + {formatCurrency(value.countedCredits)}{' '}
                credits − {formatCurrency(value.annualFee)} fee
                {value.net <= 0 && ' — droppable: the rest of the lineup catches this spend.'}
              </p>
            </>
          ) : (
            <p className="empty-note">Archived cards sit outside the optimizer.</p>
          )}

          <h2 className="eyebrow">Recurring credits</h2>
          {card.credits.length === 0 && <p className="empty-note">No credits tracked.</p>}
          {card.credits.map((credit) => (
            <div key={credit.id} className="credit-row">
              <span>
                {credit.label} · {formatCurrency(credit.annual_value)}/yr
              </span>
              <span className="credit-row-actions">
                <button
                  type="button"
                  className="button"
                  aria-pressed={credit.counts}
                  aria-label={`${credit.label} counts toward the math`}
                  disabled={anyBusy}
                  onClick={() => toggleCredit(credit.id)}
                >
                  {credit.counts ? 'Counts ✓' : 'Ignored'}
                </button>
                <button
                  type="button"
                  className="button"
                  aria-label={`Delete the ${credit.label} credit`}
                  disabled={anyBusy}
                  onClick={() => removeCredit(credit.id)}
                >
                  Delete
                </button>
              </span>
            </div>
          ))}
          <form
            className="credit-add"
            onSubmit={(e) => {
              e.preventDefault()
              addCredit()
            }}
          >
            <input
              className="field-input"
              placeholder="Credit label"
              aria-label="Credit label"
              value={creditForm.label}
              onChange={(e) => setCreditForm((f) => ({ ...f, label: e.target.value }))}
            />
            <AmountInput
              kind="money"
              value={creditForm.annual_value}
              onValueChange={(v) => setCreditForm((f) => ({ ...f, annual_value: v }))}
              placeholder="$/yr"
              aria-label="Credit annual value"
            />
            <button type="submit" className="button button-primary" disabled={anyBusy}>
              Add credit
            </button>
          </form>

          <h2 className="eyebrow">Its rewards</h2>
          {myRates.length === 0 ? (
            <p className="empty-note">No multipliers yet — add them in the matrix.</p>
          ) : (
            <p className="drill-hint">
              {myRates
                .map(
                  (r) =>
                    `${r.categoryName} ${Number(r.multiplier)}x${wonIds.has(r.category_id) ? ' ★' : ''}`,
                )
                .join(' · ')}
              {wonIds.size > 0 && ' — ★ = the card to reach for'}
            </p>
          )}
        </div>

        <div className="card span-6">
          <h2 className="eyebrow">
            Credit line
            <InfoHint text="Dated limit changes; the newest is the current line. Steps, not slopes — the sparkline holds level between events." />
          </h2>
          {sparkOption ? (
            <EChart
              option={sparkOption}
              height={180}
              ariaLabel={`Step chart of ${card.name}'s credit limit over time`}
            />
          ) : (
            <p className="empty-note">No limit history yet — add the opening line below.</p>
          )}
          <table className="data-table">
            <thead>
              <tr>
                <th>Effective</th>
                <th className="num">Limit</th>
                <th>Note</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {card.limit_events.map((event) => (
                <tr key={event.id}>
                  <td>{formatDate(event.effective_date)}</td>
                  <td className="num">{formatCurrency(event.limit_amount)}</td>
                  <td>{event.note ?? '—'}</td>
                  <td className="row-actions">
                    <button
                      type="button"
                      className="button"
                      aria-label={`Delete the ${event.effective_date} limit event`}
                      disabled={anyBusy}
                      onClick={() => removeLimit(event.id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <form
            className="limit-add"
            onSubmit={(e) => {
              e.preventDefault()
              addLimit()
            }}
          >
            <input
              className="field-input"
              type="date"
              aria-label="Limit effective date"
              value={limitForm.effective_date}
              onChange={(e) => setLimitForm((f) => ({ ...f, effective_date: e.target.value }))}
            />
            <AmountInput
              kind="money"
              value={limitForm.limit_amount}
              onValueChange={(v) => setLimitForm((f) => ({ ...f, limit_amount: v }))}
              placeholder="New limit"
              aria-label="Limit amount"
            />
            <input
              className="field-input"
              placeholder="Note (CLI request, auto…)"
              aria-label="Limit note"
              value={limitForm.note}
              onChange={(e) => setLimitForm((f) => ({ ...f, note: e.target.value }))}
            />
            <button type="submit" className="button button-primary" disabled={anyBusy}>
              Add
            </button>
          </form>

          <h2 className="eyebrow">Utilization</h2>
          {card.account_id === null ? (
            <p className="drill-hint">
              Link a liability account (roster → edit) to see utilization here.
            </p>
          ) : utilizationPct === null ? (
            <p className="drill-hint">Utilization needs a snapshot balance and a current limit.</p>
          ) : (
            <p className="drill-hint" data-utilization>
              {formatCurrency(Math.abs(utilization!.balance))} of{' '}
              {formatCurrency(card.current_limit)} ={' '}
              {formatPct(utilizationPct, { signed: false })} (as of{' '}
              {formatMonth(utilization!.month)}) — balances are stored negative; this reads the
              latest net-worth snapshot.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 11.2: Write `carddetail.css`:**

```css
.card-detail .card-detail-title {
  margin: 0;
  font-size: 1.3rem;
}
.card-detail .card-detail-title:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 4px;
}
.card-detail .chip-row {
  margin-bottom: 0.9rem;
}
.credit-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  padding: 0.35rem 0;
  border-bottom: 1px solid var(--border);
  font-size: 0.86rem;
}
.credit-row-actions {
  display: flex;
  gap: 0.4rem;
}
.credit-add,
.limit-add {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.6rem;
  flex-wrap: wrap;
}
.credit-add .field-input,
.limit-add .field-input {
  flex: 1;
  min-width: 8rem;
}
```

- [ ] **Step 11.3: Typecheck** — `npx tsc -b`. Expected: exit 0. (Check `src/api/netWorth.ts` exports `fetchSummary` and `fetchMonthBalances` — it does.)
- [ ] **Step 11.4: Report DONE** (orchestrator commit: `git add src/components/creditcards/CardDetail.tsx src/components/creditcards/carddetail.css && git commit -m "feat(credit-cards): card drill-in — credits editor, limit history, utilization"`).

---

### Task 12: Page assembly, registration, page tests (Wave 3 — after Tasks 5–11)

**Files:**
- Create: `src/pages/CreditCardsPage.tsx`, `src/pages/CreditCardsPage.css`, `src/pages/CreditCardsPage.test.tsx`
- Modify: `src/App.tsx` (lazy import + route before the `*` 404)
- Modify: `src/components/navItems.ts` (Tracking section, after Portfolio: `{ to: '/credit-cards', label: 'Credit cards', icon: CreditCard }` — import `CreditCard` from lucide-react, keep the import list alphabetical)

- [ ] **Step 12.1: Write `CreditCardsPage.tsx`:**

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import {
  fetchCreditCards,
  fetchRewardCategories,
  fetchRewardRates,
  putRewardRates,
} from '../api/creditCards'
import { fetchAccounts } from '../api/netWorth'
import { fetchCategories, fetchMatrix } from '../api/spending'
import EChart from '../components/EChart'
import InfoHint from '../components/InfoHint'
import StatTile from '../components/StatTile'
import CardDetail from '../components/creditcards/CardDetail'
import CardsPanel from '../components/creditcards/CardsPanel'
import CategoriesPanel from '../components/creditcards/CategoriesPanel'
import RewardsMatrix from '../components/creditcards/RewardsMatrix'
import { cardValueChartOption } from '../components/creditcards/cardValueChartOptions'
import { creditLineChartOption, limitMonths } from '../components/creditcards/creditLineChartOptions'
import {
  optimize,
  resolveWeight,
  suggestedAnnualSpend,
  toMathCards,
  toMathCategories,
  toMathRates,
} from '../components/creditcards/rewardsMath'
import type {
  AccountOut,
  CategoryOut,
  CreditCardOut,
  RewardCategoryOut,
  RewardRateOut,
  RewardRatePut,
  SpendingMatrix,
} from '../types/api'
import { formatCurrency } from '../utils/format'
import { currentMonthIso } from '../utils/months'
import '../components/panels.css'
import './CreditCardsPage.css'

export default function CreditCardsPage() {
  const [cards, setCards] = useState<CreditCardOut[] | null>(null)
  const [categories, setCategories] = useState<RewardCategoryOut[] | null>(null)
  const [rates, setRates] = useState<RewardRateOut[] | null>(null)
  const [spendingCategories, setSpendingCategories] = useState<CategoryOut[]>([])
  const [matrix, setMatrix] = useState<SpendingMatrix | null>(null)
  const [accounts, setAccounts] = useState<AccountOut[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Drill-in: ?card=<slug> — the SpendingPage ?month= grammar (replace, not push).
  const [searchParams, setSearchParams] = useSearchParams()
  const cardParam = searchParams.get('card')
  const setCardParam = (slug: string | null) => {
    setSearchParams(
      (current) => {
        const copy = new URLSearchParams(current)
        if (slug === null) copy.delete('card')
        else copy.set('card', slug)
        return copy
      },
      { replace: true },
    )
  }

  const load = useCallback(() => {
    Promise.all([
      fetchCreditCards(),
      fetchRewardCategories(),
      fetchRewardRates(),
      fetchCategories(),
      fetchMatrix(),
      fetchAccounts(),
    ])
      .then(([cardsData, categoriesData, ratesData, spendingData, matrixData, accountsData]) => {
        setCards(cardsData)
        setCategories(categoriesData)
        setRates(ratesData)
        setSpendingCategories(spendingData)
        setMatrix(matrixData)
        setAccounts(accountsData)
        setError(null)
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Failed to load credit cards')
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const beginLoad = () => {
    setLoading(true)
    setError(null)
  }

  const activeCards = useMemo(
    () => (cards ?? []).filter((c) => c.is_active),
    [cards],
  )
  const activeCategories = useMemo(
    () => (categories ?? []).filter((c) => c.is_active),
    [categories],
  )

  const suggested = useMemo(
    () => (matrix ? suggestedAnnualSpend(matrix) : new Map<number, number>()),
    [matrix],
  )
  const weights = useMemo(() => {
    const out = new Map<number, number | null>()
    for (const category of categories ?? []) out.set(category.id, resolveWeight(category, suggested))
    return out
  }, [categories, suggested])

  const result = useMemo(
    () =>
      optimize(
        toMathCards(cards ?? []),
        toMathCategories(categories ?? [], weights),
        toMathRates(rates ?? []),
      ),
    [cards, categories, rates, weights],
  )

  const activeCard = useMemo(
    () => (cardParam === null ? null : (cards ?? []).find((c) => c.slug === cardParam) ?? null),
    [cards, cardParam],
  )

  const closeDetail = (cardId: number) => {
    setCardParam(null)
    // Hand focus back to the column header that opened the drill (house hand-off).
    setTimeout(() => document.getElementById(`card-col-${cardId}`)?.focus(), 0)
  }

  const saveRates = (puts: RewardRatePut[]) => {
    if (puts.length === 0) return Promise.resolve()
    setBusy(true)
    return putRewardRates(puts)
      .then((fresh) => {
        setRates(fresh) // the PUT returns the full post-save list — no refetch
      })
      .finally(() => setBusy(false))
  }

  const kpis = useMemo(() => {
    if (!cards) return null
    const totalLine = activeCards.reduce(
      (acc, card) => acc + (card.current_limit === null ? 0 : Number(card.current_limit)),
      0,
    )
    return {
      totalLine,
      optimal: result.optimalTotal,
      net: result.lineupNet,
      count: activeCards.length,
    }
  }, [cards, activeCards, result])

  const valueRows = useMemo(
    () =>
      [...result.cardValues]
        .sort((a, b) => b.net - a.net)
        .map((v) => {
          const card = (cards ?? []).find((c) => c.id === v.cardId)
          return {
            name: card?.name ?? String(v.cardId),
            marginal: v.marginal,
            credits: v.countedCredits,
            fee: v.annualFee,
            net: v.net,
          }
        }),
    [result, cards],
  )
  const valueOption = useMemo(
    () => (valueRows.length ? cardValueChartOption(valueRows) : null),
    [valueRows],
  )
  const droppable = valueRows.filter((r) => r.net <= 0).map((r) => r.name)

  const lineCards = useMemo(
    () =>
      activeCards
        .filter((card) => card.limit_events.length > 0)
        .map((card) => ({ name: card.name, events: card.limit_events })),
    [activeCards],
  )
  const lineMonths = useMemo(() => limitMonths(lineCards, currentMonthIso()), [lineCards])
  const lineOption = useMemo(
    () =>
      lineCards.length > 0
        ? creditLineChartOption(lineCards, lineMonths, { includeTotal: lineCards.length > 1 })
        : null,
    [lineCards, lineMonths],
  )

  return (
    <div className="page">
      <div className="page-header">
        <h1>Credit cards</h1>
        <div className="spacer" />
        <button
          className="button button-primary"
          onClick={() => document.getElementById('card-name')?.focus()}
        >
          + Add card
        </button>
      </div>

      {error && (
        <div className="error-banner" role="alert">
          {error}{' '}
          <button
            className="button"
            onClick={() => {
              beginLoad()
              load()
            }}
          >
            Retry
          </button>
        </div>
      )}

      {activeCard ? (
        <CardDetail
          card={activeCard}
          result={result}
          rates={rates ?? []}
          categories={categories ?? []}
          accounts={accounts}
          busy={busy}
          onClose={() => closeDetail(activeCard.id)}
          onChanged={load}
        />
      ) : (
        <>
          {kpis && (
            <div className="kpi-row">
              <StatTile
                label="Total credit line"
                value={formatCurrency(kpis.totalLine)}
                hint="Sum of every active card's current limit."
              />
              <StatTile
                label="Optimal rewards (est.)"
                value={`${formatCurrency(kpis.optimal)}/yr`}
                hint="What the whole lineup earns per year if every weighted category goes on its best card. An estimate from your spend weights — actual card usage isn't tracked."
              />
              <StatTile
                label="Net after fees (est.)"
                value={`${formatCurrency(kpis.net)}/yr`}
                hint="Optimal rewards plus counted credits minus annual fees, across active cards."
              />
              <StatTile
                label="Active cards"
                value={String(kpis.count)}
                hint="Archived cards keep their history but sit outside the matrix and the math."
              />
            </div>
          )}

          <div className={`card-grid loading-dim${loading ? ' is-loading' : ''}`}>
            {activeCards.length > 0 && activeCategories.length > 0 ? (
              <RewardsMatrix
                cards={activeCards}
                categories={activeCategories}
                rates={rates ?? []}
                result={result}
                weights={weights}
                busy={busy}
                onCardClick={(card) => setCardParam(card.slug)}
                onSaveRates={saveRates}
              />
            ) : (
              !loading &&
              !error && (
                <div className="card span-12">
                  <h2 className="eyebrow">Rewards matrix</h2>
                  <div className="empty-note">
                    The matrix appears once there is at least one active card and one
                    category — add a card below{cards !== null && (categories ?? []).length === 0
                      ? ' and seed the categories'
                      : ''}.
                  </div>
                </div>
              )
            )}

            {valueOption && (
              <div className="card span-12">
                <h2 className="eyebrow">
                  Is each card worth keeping? (est.)
                  <InfoHint text="Marginal value (optimal lineup with the card minus without it) plus counted credits minus the annual fee. A $0 bar means the rest of the lineup already catches that spend." />
                </h2>
                <EChart
                  option={valueOption}
                  height={Math.max(140, valueRows.length * 34 + 70)}
                  ariaLabel="Horizontal bars of each card's estimated net annual value"
                />
                {droppable.length > 0 && (
                  <p className="drill-hint">
                    Droppable on these numbers: {droppable.join(', ')} — zero or negative net
                    value after fees.
                  </p>
                )}
              </div>
            )}

            {categories !== null && (
              <CategoriesPanel
                categories={categories}
                cards={cards ?? []}
                spendingCategories={spendingCategories}
                suggested={suggested}
                onChanged={load}
              />
            )}

            {cards !== null && (
              <CardsPanel cards={cards} accounts={accounts} onChanged={load} />
            )}

            <div className="card span-12">
              <h2 className="eyebrow">
                Credit line history
                <InfoHint text="Each card's limit as a step line — level between changes, stepping at each dated event — plus the total line across active cards." />
              </h2>
              {lineOption ? (
                <EChart
                  option={lineOption}
                  height={300}
                  ariaLabel="Step chart of credit limits over time per card, with the total"
                />
              ) : (
                !loading && (
                  <div className="empty-note">
                    No limit history yet — open a card's details and add its opening credit
                    line.
                  </div>
                )
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 12.2: `CreditCardsPage.css`** — page-unique rules only (the feature CSS lives with the components):

```css
/* Currently everything the page needs comes from panels.css + the feature CSS files.
   Kept (near-)empty on purpose — page-unique rules land here, shared ones don't. */
```

- [ ] **Step 12.3: Register the route** — `src/App.tsx`: add `const CreditCardsPage = lazy(() => import('./pages/CreditCardsPage'))` beside the other lazies and `<Route path="/credit-cards" element={<CreditCardsPage />} />` after the `/portfolio` route (before the `*` 404). `src/components/navItems.ts`: Tracking section gains `{ to: '/credit-cards', label: 'Credit cards', icon: CreditCard }` after Portfolio; import `CreditCard` alphabetically. Title + palette entries come free from the registry. **If any existing test pins nav/palette item counts, update those counts** (search: `NAV_ITEMS`, `CommandPalette.test`, `usePageTitle.test`).
- [ ] **Step 12.4: Write `CreditCardsPage.test.tsx`.** Follow the house harness exactly (SpendingPage.test.tsx): `vi.mock` each api module, EChart stub projecting option slices onto `data-*`, `MemoryRouter` + a `LocationProbe`. Full file:

```tsx
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CreditCardOut,
  RewardCategoryOut,
  RewardRateOut,
  SpendingMatrix,
} from '../types/api'
import CreditCardsPage from './CreditCardsPage'

vi.mock('../api/creditCards', () => ({
  fetchCreditCards: vi.fn(),
  fetchRewardCategories: vi.fn(),
  fetchRewardRates: vi.fn(),
  putRewardRates: vi.fn(),
  createCreditCard: vi.fn(),
  updateCreditCard: vi.fn(),
  deleteCreditCard: vi.fn(),
  createCardCredit: vi.fn(),
  updateCardCredit: vi.fn(),
  deleteCardCredit: vi.fn(),
  createLimitEvent: vi.fn(),
  deleteLimitEvent: vi.fn(),
  createRewardCategory: vi.fn(),
  updateRewardCategory: vi.fn(),
  deleteRewardCategory: vi.fn(),
}))
vi.mock('../api/spending', () => ({ fetchCategories: vi.fn(), fetchMatrix: vi.fn() }))
vi.mock('../api/netWorth', () => ({
  fetchAccounts: vi.fn(),
  fetchSummary: vi.fn(),
  fetchMonthBalances: vi.fn(),
}))
// ECharts never renders in jsdom (house law): the stub exposes the slices these tests
// pin — series count/names for the two chart cards — via data-* attributes.
vi.mock('../components/EChart', async () => {
  const { createElement } = await import('react')
  return {
    default: ({ option, ariaLabel }: { option: { series?: { name?: string }[] }; ariaLabel?: string }) =>
      createElement('div', {
        'data-testid': 'echart',
        'aria-label': ariaLabel,
        'data-series-names': (option.series ?? []).map((s) => s.name ?? '').join('|'),
      }),
  }
})

import {
  createCreditCard,
  fetchCreditCards,
  fetchRewardCategories,
  fetchRewardRates,
  putRewardRates,
  updateCardCredit,
} from '../api/creditCards'
import { fetchAccounts, fetchMonthBalances, fetchSummary } from '../api/netWorth'
import { fetchCategories, fetchMatrix } from '../api/spending'

// --- fixtures: the valuation-flip scenario straight from the spec -----------------------
// VX: 2x miles @1.7¢ on Groceries (3.4%) — beats Savor's 3x cash (3.0%).
// Dining: Savor 3x vs RH 3x — a true tie; VX's 1x portal cell loses.

function vx(over: Partial<CreditCardOut> = {}): CreditCardOut {
  return {
    id: 1, name: 'Venture X', slug: 'venture-x', annual_fee: '395.00',
    rewards_currency: 'miles', point_value_cents: '1.7000', primary_holder: 'Ed',
    authorized_users: 'P2', opened_on: '2023-05-12', is_active: true, account_id: null,
    notes: null, sort_order: 0,
    credits: [{ id: 11, label: '$300 travel credit', annual_value: '300.00', counts: true }],
    current_limit: '30000.00',
    limit_events: [
      { id: 21, effective_date: '2023-05-12', limit_amount: '20000.00', note: 'opened' },
      { id: 22, effective_date: '2026-01-15', limit_amount: '30000.00', note: null },
    ],
    ...over,
  }
}

const SAVOR: CreditCardOut = {
  id: 2, name: 'SavorOne', slug: 'savorone', annual_fee: '0.00', rewards_currency: 'cash',
  point_value_cents: '1.0000', primary_holder: 'Ed', authorized_users: null, opened_on: null,
  is_active: true, account_id: null, notes: null, sort_order: 1, credits: [],
  current_limit: '10000.00',
  limit_events: [{ id: 23, effective_date: '2024-02-01', limit_amount: '10000.00', note: null }],
}

const RH: CreditCardOut = {
  id: 3, name: 'RH Gold', slug: 'rh-gold', annual_fee: '0.00', rewards_currency: 'cash',
  point_value_cents: '1.0000', primary_holder: 'Ed', authorized_users: null, opened_on: null,
  is_active: true, account_id: null, notes: null, sort_order: 2, credits: [],
  current_limit: null, limit_events: [],
}

const CATEGORIES: RewardCategoryOut[] = [
  { id: 10, name: 'Groceries', slug: 'groceries', sort_order: 0, is_active: true,
    annual_spend: '7800.00', spending_category_id: null, pinned_card_id: null },
  { id: 11, name: 'Dining', slug: 'dining', sort_order: 1, is_active: true,
    annual_spend: '6000.00', spending_category_id: null, pinned_card_id: null },
  { id: 12, name: 'Rent', slug: 'rent', sort_order: 2, is_active: true,
    annual_spend: null, spending_category_id: null, pinned_card_id: null },
]

const RATES: RewardRateOut[] = [
  { id: 31, card_id: 1, category_id: 10, multiplier: '2.00', note: null, monthly_cap: null },
  { id: 32, card_id: 2, category_id: 10, multiplier: '3.00', note: null, monthly_cap: null },
  { id: 33, card_id: 2, category_id: 11, multiplier: '3.00', note: null, monthly_cap: null },
  { id: 34, card_id: 3, category_id: 11, multiplier: '3.00', note: null, monthly_cap: null },
  { id: 35, card_id: 1, category_id: 11, multiplier: '1.00', note: 'portal', monthly_cap: null },
]

const EMPTY_MATRIX = {
  months: [], categories: [], series: [], totals: [], net_pay: [], savings_rate: [],
  four_pct_rule: [], total_budget: [],
} as unknown as SpendingMatrix

function seedHappyPath() {
  vi.mocked(fetchCreditCards).mockResolvedValue([vx(), SAVOR, RH])
  vi.mocked(fetchRewardCategories).mockResolvedValue(CATEGORIES)
  vi.mocked(fetchRewardRates).mockResolvedValue(RATES)
  vi.mocked(fetchCategories).mockResolvedValue([])
  vi.mocked(fetchMatrix).mockResolvedValue(EMPTY_MATRIX)
  vi.mocked(fetchAccounts).mockResolvedValue([])
  vi.mocked(fetchSummary).mockResolvedValue({
    month: null, net_worth: null, mom_delta: null, mom_pct: null, groups: [],
  })
  vi.mocked(fetchMonthBalances).mockResolvedValue({
    month: '2026-08-01', exists: false, recorded_on: null, notes: null, balances: [],
  })
}

function LocationProbe() {
  const location = useLocation()
  return <span data-testid="location">{`${location.pathname}${location.search}`}</span>
}

function renderPage(entry = '/credit-cards') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <CreditCardsPage />
      <LocationProbe />
    </MemoryRouter>,
  )
}

/** The matrix row <tr> whose first cell starts with the category name. */
function matrixRow(name: string): HTMLElement {
  const cell = screen
    .getAllByRole('cell')
    .find((td) => td.textContent?.startsWith(name) && td.closest('.rewards-matrix'))
  if (!cell) throw new Error(`no matrix row for ${name}`)
  return cell.closest('tr') as HTMLElement
}

beforeEach(() => {
  vi.clearAllMocks()
  seedHappyPath()
})
afterEach(cleanup)

describe('CreditCardsPage', () => {
  it('defaults to the multiplier view with green driven by effective return', async () => {
    renderPage()
    await screen.findByText('Rewards matrix — best card per category')
    const groceries = matrixRow('Groceries')
    const cells = Array.from(groceries.querySelectorAll('td[data-best]'))
    // Multiplier view shows "2x"/"3x"; green sits on VX's 2x (3.4%), NOT Savor's 3x.
    expect(cells).toHaveLength(1)
    expect(cells[0].textContent).toContain('2x')
    expect(groceries.textContent).toContain('3x')
    // No jest-dom in this repo — assert attributes directly.
    expect(screen.getByRole('button', { name: 'Multiplier' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
  })

  it('the toggle switches every cell to effective % and back', async () => {
    renderPage()
    await screen.findByText('Rewards matrix — best card per category')
    fireEvent.click(screen.getByRole('button', { name: 'Effective %' }))
    const groceries = matrixRow('Groceries')
    // formatPct defaults to ONE decimal: '3.4%', never '3.40%'.
    expect(groceries.textContent).toContain('3.4%')
    expect(groceries.textContent).toContain('3.0%')
    fireEvent.click(screen.getByRole('button', { name: 'Multiplier' }))
    expect(matrixRow('Groceries').textContent).not.toContain('3.4%')
  })

  it('ties mark every co-best cell and badge them', async () => {
    renderPage()
    await screen.findByText('Rewards matrix — best card per category')
    const dining = matrixRow('Dining')
    expect(dining.querySelectorAll('td[data-best]')).toHaveLength(2)
    expect(dining.querySelectorAll('td[data-tie]')).toHaveLength(2)
    expect(dining.textContent).toContain('tie')
  })

  it('condition notes render the ⁺ marker with the note as its label', async () => {
    renderPage()
    await screen.findByText('Rewards matrix — best card per category')
    expect(screen.getByLabelText('portal')).toBeTruthy()
  })

  it('the footer allocates estimated $/yr and dashes unweighted categories out', async () => {
    renderPage()
    await screen.findByText('Est. $/yr won')
    // Groceries 7800×3.4% = 265.20 to VX; Dining 6000×3% = 180 to a $0-fee tie winner
    // (SavorOne by fee → wins → name). Rent is unweighted — nobody earns from it.
    const footer = screen.getByText('Est. $/yr won').closest('tr') as HTMLElement
    expect(footer.textContent).toContain('$265.20')
    expect(footer.textContent).toContain('$180.00')
    const rent = matrixRow('Rent')
    expect(rent.textContent).toContain('no weight')
  })

  it('KPIs: total line, optimal, net after fees, count', async () => {
    renderPage()
    await screen.findByText('Total credit line')
    expect(screen.getByText('$40,000.00')).toBeTruthy() // 30k + 10k, RH has none
    expect(screen.getByText('$445.20/yr')).toBeTruthy() // 265.20 + 180
    expect(screen.getByText('$350.20/yr')).toBeTruthy() // 445.20 + 300 − 395
    expect(screen.getByText('Active cards')).toBeTruthy()
  })

  it('estimates are labeled as estimates', async () => {
    renderPage()
    await screen.findByText('Optimal rewards (est.)')
    expect(screen.getByText('Net after fees (est.)')).toBeTruthy()
    expect(screen.getByText('Is each card worth keeping? (est.)')).toBeTruthy()
  })

  it('clicking a card column opens the drill-in and writes ?card=', async () => {
    renderPage()
    await screen.findByText('Rewards matrix — best card per category')
    fireEvent.click(screen.getByRole('button', { name: 'Open Venture X details' }))
    expect(screen.getByTestId('location').textContent).toBe('/credit-cards?card=venture-x')
    await screen.findByText('Worth keeping? (est.)')
    expect(screen.getByText('AF $395.00')).toBeTruthy()
    // Matrix is gone while drilled.
    expect(screen.queryByText('Est. $/yr won')).toBeNull()
  })

  it('?card= deep-link arrives drilled; closing returns and clears the URL', async () => {
    renderPage('/credit-cards?card=venture-x')
    await screen.findByText('Worth keeping? (est.)')
    fireEvent.click(screen.getByRole('button', { name: 'Back to the matrix' }))
    await screen.findByText('Rewards matrix — best card per category')
    expect(screen.getByTestId('location').textContent).toBe('/credit-cards')
  })

  it('a garbled ?card= slug falls back to the matrix view', async () => {
    renderPage('/credit-cards?card=nope')
    await screen.findByText('Rewards matrix — best card per category')
  })

  it('the drill-in spells the marginal breakdown', async () => {
    renderPage('/credit-cards?card=venture-x')
    await screen.findByText('Worth keeping? (est.)')
    // VX marginal: Groceries falls back to Savor 3% → 265.20−234 = 31.20; Dining
    // unchanged. Net = 31.20 + 300 − 395 = −63.80 → droppable phrasing shows.
    expect(screen.getByText(/\$31\.20 marginal/)).toBeTruthy()
    expect(screen.getByText(/droppable/)).toBeTruthy()
  })

  it('saving edited multipliers PUTs only changed cells and re-renders from the echo', async () => {
    vi.mocked(putRewardRates).mockResolvedValue([
      ...RATES.filter((r) => r.id !== 31),
      { id: 31, card_id: 1, category_id: 10, multiplier: '5.00', note: null, monthly_cap: null },
    ])
    renderPage()
    await screen.findByText('Rewards matrix — best card per category')
    fireEvent.click(screen.getByRole('button', { name: 'Edit multipliers' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Groceries on Venture X' }))
    const box = screen.getByLabelText('Multiplier') as HTMLInputElement
    fireEvent.focus(box)
    fireEvent.change(box, { target: { value: '5' } })
    fireEvent.blur(box)
    fireEvent.click(screen.getByRole('button', { name: 'Save multipliers' }))
    await waitFor(() => expect(putRewardRates).toHaveBeenCalledTimes(1))
    expect(vi.mocked(putRewardRates).mock.calls[0][0]).toEqual([
      { card_id: 1, category_id: 10, multiplier: '5', note: null, monthly_cap: null },
    ])
    await screen.findByText('5x')
  })

  it('roster add flow POSTs the full card body with defaults filled', async () => {
    vi.mocked(createCreditCard).mockResolvedValue(vx())
    renderPage()
    await screen.findByText('Card roster')
    fireEvent.change(screen.getByLabelText('Card name'), { target: { value: 'BILT' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add card' }))
    await waitFor(() => expect(createCreditCard).toHaveBeenCalledTimes(1))
    expect(vi.mocked(createCreditCard).mock.calls[0][0]).toMatchObject({
      name: 'BILT',
      annual_fee: '0',
      rewards_currency: 'cash',
      point_value_cents: '1',
      is_active: true,
      sort_order: 0,
    })
  })

  it('toggling a credit\'s "counts" PATCHes the full credit body', async () => {
    vi.mocked(updateCardCredit).mockResolvedValue({
      id: 11, label: '$300 travel credit', annual_value: '300.00', counts: false,
    })
    renderPage('/credit-cards?card=venture-x')
    await screen.findByText('Worth keeping? (est.)')
    fireEvent.click(
      screen.getByRole('button', { name: '$300 travel credit counts toward the math' }),
    )
    await waitFor(() =>
      expect(updateCardCredit).toHaveBeenCalledWith(11, {
        label: '$300 travel credit',
        annual_value: '300.00',
        counts: false,
      }),
    )
  })

  it('empty state: no categories → the seed button renders', async () => {
    vi.mocked(fetchCreditCards).mockResolvedValue([])
    vi.mocked(fetchRewardCategories).mockResolvedValue([])
    vi.mocked(fetchRewardRates).mockResolvedValue([])
    renderPage()
    await screen.findByText("Start with the spreadsheet's categories")
    expect(screen.getByText(/No cards yet/)).toBeTruthy()
  })

  it('credit line history draws per-card steps plus the total', async () => {
    renderPage()
    await screen.findByText('Credit line history')
    const charts = screen.getAllByTestId('echart')
    const line = charts.find((el) =>
      (el.getAttribute('data-series-names') ?? '').includes('Total line'),
    )
    expect(line).toBeTruthy()
    expect(line!.getAttribute('data-series-names')).toBe('Venture X|SavorOne|Total line')
  })

  it('inactive cards leave the matrix and the math', async () => {
    vi.mocked(fetchCreditCards).mockResolvedValue([vx({ is_active: false }), SAVOR, RH])
    renderPage()
    await screen.findByText('Rewards matrix — best card per category')
    expect(screen.queryByRole('button', { name: 'Open Venture X details' })).toBeNull()
    // With VX gone, Savor's 3x owns Groceries.
    const groceries = matrixRow('Groceries')
    expect(groceries.querySelectorAll('td[data-best]')).toHaveLength(1)
  })

  it('surfaces a load failure with Retry', async () => {
    vi.mocked(fetchCreditCards).mockRejectedValue(new Error('boom'))
    renderPage()
    await screen.findByRole('alert')
    expect(screen.getByText('Failed to load credit cards')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })
})
```

**Fixture-math cross-check for the implementer** (all figures must agree with `rewardsMath.ts` as written): Groceries $7,800 → VX 2x@1.7¢ = 3.4% → $265.20 (Savor fallback at 3% would earn $234.00). Dining $6,000 → Savor/RH tie at 3% → $180.00; tie-break: equal $0 fees → outright wins 0 = 0 → name order, and `'RH Gold'.localeCompare('SavorOne') < 0`, so **RH Gold takes the Dining allocation** (the footer test only asserts $180.00 appears somewhere in the footer row, deliberately column-agnostic). KPI optimal = 265.20 + 180.00 = $445.20; net = 445.20 + 300 − 395 = $350.20. VX marginal = 265.20 − 234.00 = $31.20 → VX net = 31.20 + 300 − 395 = −$63.80 (the droppable phrasing shows).

- [ ] **Step 12.5: Run the page tests** — `npx vitest run src/pages/CreditCardsPage.test.tsx`
Expected: 18 passed. Every $-literal must match `formatCurrency`'s real output (Intl USD, two decimals) and every %-literal `formatPct`'s (one decimal) — when a literal disagrees with the util, fix the literal.
- [ ] **Step 12.6: Full frontend gates** — `npm test` (all files), `npx eslint .` (0 errors; 1 sanctioned pre-existing warning), `npx tsc -b`.
- [ ] **Step 12.7: Report DONE** (orchestrator commit: `git add src/pages/CreditCardsPage.tsx src/pages/CreditCardsPage.css src/pages/CreditCardsPage.test.tsx src/App.tsx src/components/navItems.ts && git commit -m "feat(credit-cards): /credit-cards page — KPIs, matrix, value bars, roster, line history, ?card= drill-in"`).

---

### Task 13: Full gates on the branch (Wave 4, orchestrator)

- [ ] **Step 13.1: Backend** — `cd backend && .venv/Scripts/python.exe -m pytest -q`
Expected: baseline (~886) + ~24 new = ~910 passed, 0 failed.
- [ ] **Step 13.2: Ruff** — `.venv/Scripts/python.exe -m ruff check app tests && .venv/Scripts/python.exe -m ruff format --check app tests`
Expected: both clean (CI runs `--check`).
- [ ] **Step 13.3: Alembic round-trip** (dev DB, additive) — `alembic upgrade head` → `alembic heads` (single head `c4d1e8a2b9f3`) → `alembic downgrade e7c5a9f4b2d8` → `alembic upgrade head`. All exit 0.
- [ ] **Step 13.4: Frontend** — `npm test` (baseline ~938 + ~40 new ≈ 978; the TransactionsPanel "save changes" flake is pre-existing — rerun once if it is the ONLY failure), `npx eslint .` (0 errors, 1 sanctioned warning), `npm run build` (tsc -b + vite; chunk advisory 730 kB — EChart chunk must be byte-identical to main's, no new echarts registrations; the new page arrives as its own small lazy chunk).
- [ ] **Step 13.5:** Fix anything red (with a fix subagent if substantive), re-run the affected gate, commit fixes.

### Task 14: Browser smoke with real data (Wave 4, orchestrator + one subagent) — the 2026-08-25 lesson

Chart tests mock echarts by house law, so real-echarts rendering with real data is a standing blind spot. New chart types shipped ⇒ browser-smoke BEFORE merge (the money-flow sankey incident).

- [ ] **Step 14.1: Dev servers** — backend: `cd backend && SCHEDULER_ENABLED=false .venv/Scripts/python.exe -m uvicorn app.main:app --port 8000` (run_in_background). Frontend: `npm run dev` (5173, run_in_background). Both against the dev DB (migration already applied by Task 13.3).
- [ ] **Step 14.2: Seed the real matrix** via the API (this is the user's actual spreadsheet data — the page should greet them populated): a Python script `scratchpad/seed_credit_cards.py` run with the backend venv, using httpx against `http://localhost:8000/api/v1` with a minted JWT (the repro-driver pattern: token via `app.security.create_access_token` — read `backend/app/security.py` for the exact signature first). Seed: the 14 categories (SEED_CATEGORIES order), 6 cards — Venture X ($395, miles, 1.7¢), SavorOne ($0, cash), Citi Custom Cash ($0, cash), Amazon Prime Rewards ($0, cash), BILT Mastercard ($0, points, 2.05¢), Robinhood Gold Card ($0, cash) — and every matrix cell from the workbook's Credit Card Matrix sheet (multipliers + notes: VX Flights 5x "portal" / Hotels 10x "portal" / Rental cars 10x "portal", SavorOne Ground transportation 10x "Uber", Citi Gas 5x note "top category" cap 500, BILT Rent 1x "no transaction fee", everything-else rows per the sheet: VX 2x all, RH Gold 3x all, etc.), plus 2–3 limit events on Venture X for the line chart. Idempotence: the script must tolerate 409s (already-seeded reruns skip).
- [ ] **Step 14.3: Drive the browser** — `scratchpad/repro_credit_cards.mjs` with puppeteer-core (`npm i --no-save puppeteer-core` if absent) against headless Edge, `evaluateOnNewDocument` planting `localStorage.finance_token`. Capture `page.on('console')` and `page.on('pageerror')`; FAIL on any error. Screenshot: (1) `/credit-cards` full page (matrix green cells + value bars + line chart all rendered), (2) after clicking the Effective % toggle, (3) after clicking the Venture X column header (drill-in with sparkline), (4) back to matrix. Read the screenshots (they are images) and verify visually: green cells sit where the valuations say, the ⁺ markers show, charts drew actual lines/bars (not blank canvases).
- [ ] **Step 14.4:** Any console error / blank chart / wrong green ⇒ fix loop (subagent), re-run smoke. Leave BOTH dev servers running for the user's morning visual pass (house precedent) and note the seeding in the morning report.

### Task 15: Final whole-branch review (Wave 4)

- [ ] **Step 15.1:** Dispatch a reviewer subagent (superpowers:code-reviewer guidance): BASE = the `main` SHA the branch was cut from, HEAD = branch tip. Scope: spec compliance against `docs/superpowers/specs/2026-08-25-credit-cards-design.md` + code quality + the cross-file seams no per-task review saw (page ↔ math ↔ API contract drift, route order, PATCH semantics).
- [ ] **Step 15.2:** Fix every Critical/Important finding (fix subagents), re-run affected gates, commit. Log Minor/Nit findings for the morning report instead of churning.

### Task 16: Merge + wrap-up (Wave 4, orchestrator)

- [ ] **Step 16.1:** `git checkout main && git merge --no-ff credit-cards -m "merge: credit cards — rewards optimizer matrix, card economics, credit-line history"`
- [ ] **Step 16.2:** Full gates ON MAIN: backend pytest, ruff check + format --check, npm test, eslint, build, alembic single-head check. All green before calling it done.
- [ ] **Step 16.3:** Update the spec's Status line (`docs/superpowers/specs/2026-08-25-credit-cards-design.md`: "approved, not yet implemented" → "implemented YYYY-MM-DD (branch credit-cards)") and commit. Update memory (`finance-dashboard-project-state.md` + index hook): what shipped, gates, migration id, morning list (visual pass URL, seeded data note, deferred minors, branch `credit-cards` kept per no-deletions rule). **Do NOT push. Do NOT delete anything.**
- [ ] **Step 16.4:** Write the morning report in the final assistant message: what shipped, where to look first (`http://localhost:5173/credit-cards`), what was seeded, gates, deferred items.

---

## Self-review appendix (orchestrator, before dispatch)

- Spec §2 tables ↔ Task 1; §3 endpoints ↔ Tasks 5–6; §4 page/matrix/drill-in/math/charts/empty-state ↔ Tasks 8–12 + 3–4; §5 testing ↔ Tasks 1, 5–7, 12; importer pin ↔ Task 7. Utilization (§4 drill-in) ↔ Task 11. Seed (§4) ↔ Task 10.
- Wire-format literals in tests (e.g. `"1.7000"`, `"$40,000.00"`) must match the REAL serializers (`Numeric(6,4)` echoes 4dp; `formatCurrency`'s exact string) — when a literal disagrees with reality, fix the literal, never the serializer.
- Known intentional deviations from the spec mockups (not the spec text): no "Edit card" button inside the drill-in (roster owns card fields); matrix cell editing via inspector panel rather than 3-input cells.








