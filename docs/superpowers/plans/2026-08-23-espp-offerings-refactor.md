# ESPP Offerings & Modeler Refactor (+ Balance Suggestions Removal) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the ESPP page its real structure — Lots · Subscription offerings · Purchase modeler — where offerings (start date + subscription price) drive the modeler's per-period subscription price, the old "Offering periods" card folds into an editable modeler table, and the Balance Suggestions feature is removed end to end.

**Architecture:** One new dashboard-only table (`espp_offerings`, importer-immune) resolved onto purchase periods **by date, never FK**; a pure planner (`plan_year_rows`) that returns the modeled year's rows — stored rows verbatim, derived rows filling empty Sep–Feb / Mar–Aug slots — and a per-period-subscription chain in `run_modeler`. The frontend merges period editing into the modeler card (diff-save through the kept periods CRUD). The Balance Suggestions removal deletes the Settings card, wizard chips, `/net-worth/suggestions`, and the `suggest_source` column.

**Tech Stack:** FastAPI + SQLAlchemy 2 async + Alembic + Postgres 16 (real-DB pytest), React 19 + TypeScript + Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-23-espp-offerings-refactor-design.md` — cite it for any ambiguity. NVDA plan mechanics are recorded in its "Plan mechanics" addendum.

**Overnight protocol:** work on branch `espp-offerings-refactor` in the MAIN checkout (no worktree — the venv/node_modules live here and the user is asleep; merge to main in Task 16). No file deletions exist in this plan (all removals are edits inside surviving files). Never push.

**House rules that bind every task:** GETs never reject stored data; server sentences render verbatim; Decimal strings on the wire; plain quantize on read paths; focus-before-reset on save-success paths; `+ ZERO` on wire-bound Decimals; comments explain constraints, not narration.

---

## File structure

| File | Responsibility |
|---|---|
| `backend/alembic/versions/20260823_0900_a7c41e88f2d0_espp_offerings_table.py` | Migration A (create) |
| `backend/alembic/versions/20260823_0901_c9e2b7a4d113_drop_account_suggest_source.py` | Migration B (drop column) |
| `backend/app/models/comp.py` (+`models/__init__.py`) | `EsppOffering` model |
| `backend/app/services/espp_calc.py` | `last_weekday_of`, `StoredPeriod`, `OfferingInfo`, `RowPlan`, `plan_year_rows`, per-period `run_modeler` |
| `backend/app/schemas/espp.py` | Offering schemas; `ModelerPeriodOut`/`ModelerOut` deltas |
| `backend/app/api/espp.py` | Offerings CRUD; modeler rewrite |
| `backend/app/api/net_worth.py`, `schemas/net_worth.py`, `models/net_worth.py` | suggestions removal |
| `src/types/api.ts`, `src/api/espp.ts`, `src/api/netWorth.ts` | wire types/clients |
| `src/pages/EsppPage.tsx` (+`.css`) | OfferingsPanel (new), ModelerCard (rewrite), LotsPanel prefills, PeriodsPanel deleted |
| `src/pages/SettingsPage.tsx`, `src/pages/MonthlyUpdatePage.tsx` | suggestions removal |
| Tests | `backend/tests/test_espp_calc.py`, `test_espp_api.py`, `test_importer_apply.py`, `test_models_comp.py`, `test_net_worth_api.py`; `src/pages/EsppPage.test.tsx`, `SettingsPage.test.tsx`, `MonthlyUpdatePage.test.tsx` |
| `docs/superpowers/specs/2026-08-21-data-entry-ergonomics-design.md` | dated §5.2 removal amendment |

---

## Phase 0 — Environment & branch

### Task 0: Bring up the stack, branch

**Files:** none (environment only)

- [ ] **Step 1: Start Docker Desktop and the dev Postgres.**

Run (PowerShell semantics via Bash are fine):
```bash
powershell -Command "Start-Process 'C:\Program Files\Docker\Docker\Docker Desktop.exe'"
# poll until the engine answers (up to ~90s)
until docker info >/dev/null 2>&1; do sleep 5; done
cd backend && docker compose up -d db && cd ..
```
Expected: `Container finance-dashboard-db-1  Started` (or Running/Healthy).

- [ ] **Step 2: Backend smoke test** (proves DATABASE_URL/dev defaults reach the 5433 container).

Run: `cd backend && .venv/Scripts/python -m pytest tests/test_health.py -q`
Expected: PASS. If it errors on connection, read `backend/app/config.py` for the dev DATABASE_URL default before proceeding — do not guess.

- [ ] **Step 3: Frontend smoke.**

Run: `npx vitest run src/api/client.test.ts` → PASS.

- [ ] **Step 4: Branch.**

```bash
git switch -c espp-offerings-refactor
```

---

## Phase 1 — Backend: offerings entity & pure planner

### Task 1: `EsppOffering` model + Migration A

**Files:**
- Modify: `backend/app/models/comp.py` (append after `RsuGrant`)
- Modify: `backend/app/models/__init__.py`
- Create: `backend/alembic/versions/20260823_0900_a7c41e88f2d0_espp_offerings_table.py`
- Test: `backend/tests/test_models_comp.py`

- [ ] **Step 1: Write the failing model test** (append to `backend/tests/test_models_comp.py`, mirroring its existing async row-roundtrip style — read the top of the file for the `db` fixture idiom):

```python
async def test_espp_offering_roundtrip_and_unique_start(db):
    from datetime import date
    from decimal import Decimal

    from sqlalchemy import select
    from sqlalchemy.exc import IntegrityError

    from app.models import EsppOffering

    db.add(
        EsppOffering(
            offering_start=date(2023, 9, 1),
            subscription_price=Decimal("48.50900"),
            notes="first enrollment",
        )
    )
    await db.commit()
    row = (await db.execute(select(EsppOffering))).scalar_one()
    assert row.offering_start == date(2023, 9, 1)
    # Numeric(14,5) — the lot price family, 5dp survives the round trip.
    assert row.subscription_price == Decimal("48.50900")
    assert row.notes == "first enrollment"

    db.add(EsppOffering(offering_start=date(2023, 9, 1), subscription_price=Decimal("1")))
    try:
        await db.commit()
        raise AssertionError("duplicate offering_start must violate the unique constraint")
    except IntegrityError:
        await db.rollback()
```

- [ ] **Step 2: Run it to verify it fails** — `cd backend && .venv/Scripts/python -m pytest tests/test_models_comp.py -q` → FAIL (`ImportError: cannot import name 'EsppOffering'`).

- [ ] **Step 3: Implement the model.** Append to `backend/app/models/comp.py`:

```python
class EsppOffering(Base):
    """A ~24-month ESPP enrollment window: the subscription price fixed at its start.

    Dashboard-only — the workbook has no offerings concept, so the importer never reads
    or writes this table (rsu_grants' posture, pinned by test). Purchase periods link to
    offerings BY DATE, never FK: a period's offering is the row with the greatest
    offering_start <= period_start (espp_calc.plan_year_rows), so adding an offering
    retroactively re-prices later periods with zero re-linking and a mid-cycle reset is
    just another row.
    """

    __tablename__ = "espp_offerings"

    id: Mapped[int] = mapped_column(primary_key=True)
    offering_start: Mapped[date] = mapped_column(Date, unique=True)
    # Numeric(14,5): the espp lot price family (espp_lots.subscription_price), NOT the
    # app-wide 4dp — the two columns hold the same real-world number.
    subscription_price: Mapped[Decimal] = mapped_column(Numeric(14, 5))
    notes: Mapped[str | None] = mapped_column(Text)
```

In `backend/app/models/__init__.py`: extend the comp import line to
`from app.models.comp import CompEvent, EsppLot, EsppOffering, EsppPeriod, PaycheckProfile, RsuGrant`
and add `"EsppOffering",` to `__all__` (alphabetical position after `"EsppLot"`).

- [ ] **Step 4: Write Migration A** — create `backend/alembic/versions/20260823_0900_a7c41e88f2d0_espp_offerings_table.py`:

```python
"""espp offerings table

The subscription-price source for the purchase modeler (2026-08-23 spec §2.1).
Dashboard-only and importer-immune; no FKs in or out — periods resolve by date.

Revision ID: a7c41e88f2d0
Revises: 712243ee3ff3
Create Date: 2026-08-23 09:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a7c41e88f2d0"
down_revision: str | Sequence[str] | None = "712243ee3ff3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "espp_offerings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("offering_start", sa.Date(), nullable=False),
        sa.Column("subscription_price", sa.Numeric(precision=14, scale=5), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_espp_offerings")),
        sa.UniqueConstraint("offering_start", name=op.f("uq_espp_offerings_offering_start")),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("espp_offerings")
```

- [ ] **Step 5: Run the test** → PASS (tests build schema from `Base.metadata.create_all`, so the model is what matters; CI's alembic round-trip covers the migration).

- [ ] **Step 6: Alembic sanity** — `cd backend && .venv/Scripts/python -m alembic heads` → exactly `a7c41e88f2d0 (head)`.

- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat(espp): EsppOffering model + espp_offerings migration"`

### Task 2: Pure calendar + planner (`last_weekday_of`, `plan_year_rows`)

**Files:**
- Modify: `backend/app/services/espp_calc.py`
- Test: `backend/tests/test_espp_calc.py`

- [ ] **Step 1: Write the failing tests** (append to `backend/tests/test_espp_calc.py`; module already imports `date`/`Decimal` — reuse its style):

```python
from app.services.espp_calc import (  # add to the file's existing import
    OfferingInfo,
    StoredPeriod,
    last_weekday_of,
    plan_year_rows,
)


def _stored(id_, label, start, end, base="60000", additional="0", pct="0.140000000"):
    return StoredPeriod(
        id=id_, label=label, period_start=start, period_end=end,
        semi_annual_base=Decimal(base), additional_payments=Decimal(additional),
        contribution_pct=Decimal(pct),
    )


def test_last_weekday_of_weekday_and_weekend_ends():
    assert last_weekday_of(2026, 2) == date(2026, 2, 27)  # Feb 28 2026 is a Saturday
    assert last_weekday_of(2025, 8) == date(2025, 8, 29)  # Aug 31 2025 is a Sunday
    assert last_weekday_of(2024, 2) == date(2024, 2, 29)  # leap Feb ending on a Thursday


def test_plan_year_rows_stored_rows_win_verbatim():
    stored = [
        _stored(1, "1H24", date(2023, 9, 1), date(2024, 2, 29)),
        _stored(2, "2H24", date(2024, 3, 1), date(2024, 8, 30)),
    ]
    offerings = [OfferingInfo(offering_start=date(2023, 9, 1), subscription_price=Decimal("48.50900"))]
    rows, warnings = plan_year_rows(2024, stored, offerings, Decimal("180"), None)
    assert warnings == []
    assert [r.label for r in rows] == ["1H24", "2H24"]
    assert all(r.stored and r.period_id is not None for r in rows)
    # Boundary: period_start == offering_start resolves to that offering (<=, not <).
    assert rows[0].subscription_price == Decimal("48.50900")
    assert rows[0].offering_start == date(2023, 9, 1)


def test_plan_year_rows_derives_empty_slots_with_carried_values():
    stored = [_stored(1, "2H25", date(2025, 3, 1), date(2025, 8, 29), base="70000", pct="0.150000000")]
    offerings = [
        OfferingInfo(offering_start=date(2023, 9, 1), subscription_price=Decimal("48.509")),
        OfferingInfo(offering_start=date(2025, 9, 1), subscription_price=Decimal("175.25")),
    ]
    rows, warnings = plan_year_rows(2026, stored, offerings, None, None)
    assert warnings == []
    assert [r.stored for r in rows] == [False, False]
    assert rows[0].label == "Sep 2025–Feb 2026"
    assert rows[0].period_start == date(2025, 9, 1)
    assert rows[0].period_end == last_weekday_of(2026, 2)
    assert rows[1].label == "Mar–Aug 2026"
    assert rows[1].period_start == date(2026, 3, 1)
    assert rows[1].period_end == last_weekday_of(2026, 8)
    # Values carry forward from the latest stored period overall.
    assert rows[0].semi_annual_base == Decimal("70000")
    assert rows[0].contribution_pct == Decimal("0.150000000")
    # Both slots start on/after 2025-09-01, so both wear the reset offering's price.
    assert all(r.subscription_price == Decimal("175.25") for r in rows)
    assert all(r.offering_start == date(2025, 9, 1) for r in rows)


def test_plan_year_rows_mixed_year_after_a_mid_cycle_reset():
    offerings = [
        OfferingInfo(offering_start=date(2023, 9, 1), subscription_price=Decimal("48.509")),
        OfferingInfo(offering_start=date(2026, 3, 1), subscription_price=Decimal("120")),
    ]
    rows, _ = plan_year_rows(2026, [], offerings, None, None)
    assert rows[0].subscription_price == Decimal("48.509")   # Sep 2025 start: old offering
    assert rows[1].subscription_price == Decimal("120")      # Mar 2026 start: reset offering


def test_plan_year_rows_gap_falls_back_to_quote_with_warning():
    rows, warnings = plan_year_rows(2024, [], [], Decimal("99.9900"), None)
    assert all(r.subscription_price == Decimal("99.9900") and r.offering_start is None for r in rows)
    assert any("no offering covers" in w for w in warnings)
    # And with no quote either, the rows are unpriced (the router's 422 case).
    rows2, _ = plan_year_rows(2024, [], [], None, None)
    assert all(r.subscription_price is None for r in rows2)


def test_plan_year_rows_override_prices_every_row_silently():
    offerings = [OfferingInfo(offering_start=date(2023, 9, 1), subscription_price=Decimal("48.509"))]
    rows, warnings = plan_year_rows(2024, [], offerings, None, Decimal("55"))
    assert all(r.subscription_price == Decimal("55") and r.offering_start is None for r in rows)
    assert warnings == []


def test_plan_year_rows_zero_history_seeds_zero_with_warning():
    rows, warnings = plan_year_rows(2026, [], [], Decimal("1"), None)
    assert all(r.semi_annual_base == Decimal("0") and r.contribution_pct == Decimal("0") for r in rows)
    assert any("no stored purchase periods" in w for w in warnings)


def test_plan_year_rows_anomalous_half_passes_through_verbatim():
    stored = [
        _stored(1, "A", date(2023, 9, 1), date(2024, 1, 15)),
        _stored(2, "B", date(2023, 10, 1), date(2024, 2, 29)),  # two rows in H1
    ]
    rows, _ = plan_year_rows(2024, stored, [], Decimal("1"), None)
    # No derived filling for the year — stored data passes through in chain order.
    assert [r.label for r in rows] == ["A", "B"]
    assert all(r.stored for r in rows)
```

- [ ] **Step 2: Run to verify failure** — `cd backend && .venv/Scripts/python -m pytest tests/test_espp_calc.py -q` → FAIL (ImportError).

- [ ] **Step 3: Implement.** In `backend/app/services/espp_calc.py`: add `import calendar` and extend the datetime import to `from datetime import date, timedelta`. Rename the existing `PeriodInputs` dataclass to `StoredPeriod` (same fields; keep its docstring, adjusted: "One `espp_periods` row, as the router hands it over (already at column scale) — the PLANNER's input; `RowPlan` is the modeler's."). Then add, below `StoredPeriod`:

```python
def last_weekday_of(year: int, month: int) -> date:
    """The last Mon–Fri of a month — the documented approximation of "last trading day"
    (spec 2026-08-23 §3.2). No NYSE holiday falls on the last weekday of Feb or Aug, and
    the date is derivation/display only."""
    day = date(year, month, calendar.monthrange(year, month)[1])
    while day.weekday() >= 5:  # 5 = Saturday, 6 = Sunday
        day -= timedelta(days=1)
    return day


@dataclass(frozen=True)
class OfferingInfo:
    """One espp_offerings row, as the router hands it over. Callers pass these sorted
    ascending by offering_start — resolution takes the LAST one at or before a period's
    start."""

    offering_start: date
    subscription_price: Decimal


@dataclass(frozen=True)
class RowPlan:
    """One modeler row for the target year — a stored period verbatim, or a derived row
    filling an empty half-year slot (stored=False, period_id=None; it materializes only
    when the user saves it). subscription_price is None ONLY when nothing could price the
    row (no covering offering, no quote, no override) — the router turns that into the
    422; run_modeler refuses it as a programming error."""

    period_id: int | None
    stored: bool
    label: str
    period_start: date
    period_end: date
    semi_annual_base: Decimal
    additional_payments: Decimal
    contribution_pct: Decimal
    subscription_price: Decimal | None
    offering_start: date | None  # None = quote fallback or an override priced it


def _resolve_subscription(
    offerings: list[OfferingInfo],
    period_start: date,
    latest_quote: Decimal | None,
    override: Decimal | None,
) -> tuple[Decimal | None, date | None]:
    """Greatest offering_start <= period_start wins (<=: an offering starting the same
    day the period does covers it — spec §3.1). Override beats everything and carries no
    offering provenance; a gap falls back to the quote; no quote leaves it unpriced."""
    if override is not None:
        return override, None
    covering: OfferingInfo | None = None
    for offering in offerings:
        if offering.offering_start <= period_start:
            covering = offering
    if covering is not None:
        return covering.subscription_price, covering.offering_start
    return latest_quote, None


def plan_year_rows(
    year: int,
    stored_rows: list[StoredPeriod],
    offerings: list[OfferingInfo],
    latest_quote: Decimal | None,
    subscription_override: Decimal | None,
) -> tuple[list[RowPlan], list[str]]:
    """The modeled year's rows: stored wins, derive to fill (spec §3.3).

    `stored_rows` is EVERY stored period in chain order (period_end, id) — the whole list,
    not just the year's, because derived rows seed base/additional/pct from the latest
    stored period overall. Slots: H1 = period_end month 1–6 (the Feb purchase), H2 = 7–12
    (Aug). A half with more than one stored row is anomalous data and passes through
    verbatim with no derived filling — a GET never rejects what is stored.
    """
    warnings: list[str] = []

    def resolve(label: str, period_start: date) -> tuple[Decimal | None, date | None]:
        sub, off_start = _resolve_subscription(
            offerings, period_start, latest_quote, subscription_override
        )
        if sub is not None and off_start is None and subscription_override is None:
            warnings.append(
                f"no offering covers {label}; subscription defaulted to the latest quote"
            )
        return sub, off_start

    def planned(row: StoredPeriod) -> RowPlan:
        sub, off_start = resolve(row.label, row.period_start)
        return RowPlan(
            period_id=row.id, stored=True, label=row.label,
            period_start=row.period_start, period_end=row.period_end,
            semi_annual_base=row.semi_annual_base,
            additional_payments=row.additional_payments,
            contribution_pct=row.contribution_pct,
            subscription_price=sub, offering_start=off_start,
        )

    year_rows = [row for row in stored_rows if row.period_end.year == year]
    h1 = [row for row in year_rows if row.period_end.month <= 6]
    h2 = [row for row in year_rows if row.period_end.month > 6]
    if len(h1) > 1 or len(h2) > 1:
        return [planned(row) for row in year_rows], warnings

    seed = stored_rows[-1] if stored_rows else None
    if seed is None and (not h1 or not h2):
        warnings.append(
            "no stored purchase periods yet — derived rows are seeded at 0; "
            "edit and save them below"
        )

    def derived(label: str, start: date, end: date) -> RowPlan:
        sub, off_start = resolve(label, start)
        return RowPlan(
            period_id=None, stored=False, label=label, period_start=start, period_end=end,
            semi_annual_base=seed.semi_annual_base if seed else ZERO,
            additional_payments=seed.additional_payments if seed else ZERO,
            contribution_pct=seed.contribution_pct if seed else ZERO,
            subscription_price=sub, offering_start=off_start,
        )

    first = (
        planned(h1[0])
        if h1
        else derived(f"Sep {year - 1}–Feb {year}", date(year - 1, 9, 1), last_weekday_of(year, 2))
    )
    second = (
        planned(h2[0])
        if h2
        else derived(f"Mar–Aug {year}", date(year, 3, 1), last_weekday_of(year, 8))
    )
    return [first, second], warnings
```

(The labels use an en dash, ≤ 60 chars — the periods column width.)

- [ ] **Step 4: Fix the rename fallout in this file only** — `run_modeler`'s signature still says `PeriodInputs`; leave it failing for now (Task 3 rewrites it), but update the module's OTHER reference: none exist besides `run_modeler`. Run `cd backend && .venv/Scripts/python -m pytest tests/test_espp_calc.py -q` — the NEW tests pass; pre-existing `run_modeler` tests still pass because Task 3 hasn't changed behavior yet **only if** `PeriodInputs` still exists — so add a temporary alias line right after the dataclass: `PeriodInputs = StoredPeriod  # transitional alias, removed in the modeler-rewrite task`. Verify: full file green.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(espp): last_weekday_of + plan_year_rows pure planner"`

### Task 3: Per-period subscription in `run_modeler`

**Files:**
- Modify: `backend/app/services/espp_calc.py`
- Test: `backend/tests/test_espp_calc.py`

- [ ] **Step 1: Write the failing tests** (append):

```python
def _plan(label, start, end, sub, base="60000", additional="0", pct="0.140000000"):
    return RowPlan(
        period_id=None, stored=False, label=label, period_start=start, period_end=end,
        semi_annual_base=Decimal(base), additional_payments=Decimal(additional),
        contribution_pct=Decimal(pct), subscription_price=Decimal(sub), offering_start=None,
    )


def test_run_modeler_prices_each_period_at_its_own_subscription():
    rows = [
        _plan("H1", date(2025, 9, 1), date(2026, 2, 27), "48.509"),
        _plan("H2", date(2026, 3, 1), date(2026, 8, 31), "120"),
    ]
    result = run_modeler(rows, purchase_fmv=Decimal("180"), carry_forward=Decimal("0"))
    # 0.85 x min(sub, fmv), ROUNDUP to a cent — per row now.
    assert result.periods[0].purchase_price == Decimal("41.24")   # ceil2(0.85*48.509)
    assert result.periods[1].purchase_price == Decimal("102.00")  # ceil2(0.85*120)
    # The 25k cap is valued at each period's OWN subscription price.
    assert result.periods[0].max_shares_25k == 515   # floor(25000/48.509)
    remaining = Decimal("25000.00") - result.periods[0].value_25k
    assert result.periods[1].max_shares_25k == int(remaining / Decimal("120"))
    # value_25k = shares x that period's subscription price (half_up2'd).
    assert result.periods[0].value_25k == half_up2(
        Decimal(result.periods[0].shares) * Decimal("48.509")
    )


def test_run_modeler_uniform_subscription_matches_the_old_single_knob_chain():
    """Back-compat pin (spec §8): all-same-subscription rows reproduce the pre-offerings
    chain byte for byte."""
    rows = [
        _plan("1H24", date(2023, 9, 1), date(2024, 2, 29), "170.79000", base="60000", pct="0.140000000"),
        _plan("2H24", date(2024, 3, 1), date(2024, 8, 30), "170.79000", base="60000", pct="0.140000000"),
    ]
    result = run_modeler(rows, purchase_fmv=Decimal("170.79000"), carry_forward=Decimal("100.00"))
    purchase_price = result.periods[0].purchase_price
    assert purchase_price == Decimal("145.18")  # ceil2(0.85 * 170.79)
    first = result.periods[0]
    assert first.contribution == Decimal("8400.00")
    assert first.available == Decimal("8500.00")
    assert first.shares == 58
    assert first.cost == Decimal("8420.44")
    assert first.carry_forward_out == Decimal("79.56")
    assert result.totals.remaining_25k == Decimal("25000.00") - result.totals.total_25k_value


def test_run_modeler_refuses_an_unpriced_row():
    row = RowPlan(
        period_id=None, stored=False, label="H1", period_start=date(2025, 9, 1),
        period_end=date(2026, 2, 27), semi_annual_base=Decimal("1"),
        additional_payments=Decimal("0"), contribution_pct=Decimal("0.1"),
        subscription_price=None, offering_start=None,
    )
    try:
        run_modeler([row], purchase_fmv=Decimal("1"), carry_forward=Decimal("0"))
        raise AssertionError("an unpriced row must raise — the router 422s before here")
    except ValueError:
        pass
```

(Extend the test file's espp_calc import with `RowPlan` and `half_up2` — `_plan` and the `value_25k` assertion need them. Expected numbers, pre-verified: H1 purchase price `ceil2(0.85×48.509)=41.24`, `max_shares_25k = floor(25000/48.509) = 515`, shares `floor(8400/41.24)=203`, `value_25k₁ = half_up2(203×48.509)=9847.33`, so H2's cap is `int((25000−9847.33)/120)=126`. Uniform-pin numbers: contribution 8400.00, available 8500.00, price 145.18, shares 58, cost 8420.44, carry out 79.56.)

- [ ] **Step 2: Run to verify failure** → FAIL (`run_modeler` signature mismatch / RowPlan not accepted).

- [ ] **Step 3: Rewrite `run_modeler`.** Replace the whole function plus `ModelerResult` in `backend/app/services/espp_calc.py`; also change `PeriodResult.period` to type `RowPlan`, delete the `PeriodInputs = StoredPeriod` alias, and delete `ModelerResult.subscription_price`:

```python
@dataclass(frozen=True)
class PeriodResult:
    period: RowPlan
    eligible_earnings: Decimal
    contribution: Decimal
    available: Decimal
    purchase_price: Decimal
    shares_before_limit: int
    unused_25k: Decimal  # the limit remaining at the START of this period
    max_shares_25k: int
    over_limit: bool
    shares: int
    cost: Decimal
    carry_forward_out: Decimal
    refund: Decimal
    value_25k: Decimal


@dataclass(frozen=True)
class ModelerResult:
    purchase_fmv: Decimal
    carry_forward: Decimal
    periods: list[PeriodResult]
    totals: ModelerTotals


def run_modeler(
    rows: list[RowPlan],
    purchase_fmv: Decimal,
    carry_forward: Decimal,
) -> ModelerResult:
    """The sheet's chained per-period model over ONE calendar year.

    The subscription price is PER ROW now — offerings resolve it per period (2026-08-23
    spec §4), so a mid-cycle reset year chains two different prices. This is the day the
    old "computed once, echoed per period" shape was kept for. purchase_fmv stays one
    knob for the year, which keeps r31's every-share-at-the-last-FMV quirk a no-op by
    construction. `rows` must already be the target year's, in chain order; every row
    must be priced (the router 422s unpriced rows before calling).

    The two branches are the whole model. Under the limit, the leftover cash CARRIES into
    the next period; at or over it, the purchase is capped at `max_shares_25k` and the
    leftover is REFUNDED instead (nothing carries). The trigger is `>=`, not `>`, so a
    purchase that exactly exhausts the limit refunds its change.
    """
    unused = ANNUAL_LIMIT
    carry = carry_forward
    results: list[PeriodResult] = []
    for row in rows:
        if row.subscription_price is None:
            raise ValueError(f"unpriced row {row.label!r} reached run_modeler")
        # 0.85 x min(sub, fmv), rounded UP to a cent (r18) — per period, per its offering.
        purchase_price = ceil2(DISCOUNT * min(row.subscription_price, purchase_fmv))
        eligible = row.semi_annual_base + row.additional_payments
        contribution = half_up2(eligible * row.contribution_pct)
        available = contribution + carry
        shares_before_limit = floor_int(available / purchase_price)
        max_shares = floor_int(unused / row.subscription_price)
        over_limit = shares_before_limit >= max_shares
        shares = min(shares_before_limit, max_shares)
        cost = ceil2(Decimal(shares) * purchase_price)
        # The 25k limit is valued at the SUBSCRIPTION price, never at the discounted
        # purchase price — that is what makes max_shares_25k bite before the cash does.
        value_25k = half_up2(Decimal(shares) * row.subscription_price)
        # ONE expression for "what rolls into the next period": the reported
        # carry_forward_out and the chained `carry` must never be able to drift apart.
        carry_next = ZERO if over_limit else available - cost
        results.append(
            PeriodResult(
                period=row,
                eligible_earnings=eligible,
                contribution=contribution,
                available=available,
                purchase_price=purchase_price,
                shares_before_limit=shares_before_limit,
                unused_25k=unused,
                max_shares_25k=max_shares,
                over_limit=over_limit,
                shares=shares,
                cost=cost,
                carry_forward_out=half_up2(carry_next),
                refund=half_up2(available - cost if over_limit else ZERO),
                value_25k=value_25k,
            )
        )
        unused = unused - value_25k
        carry = carry_next

    total_shares = sum(row.shares for row in results)
    total_value = half_up2(sum((row.value_25k for row in results), ZERO))
    return ModelerResult(
        purchase_fmv=purchase_fmv,
        carry_forward=carry_forward,
        periods=results,
        totals=ModelerTotals(
            total_25k_value=total_value,
            out_of_pocket_cost=half_up2(sum((row.cost for row in results), ZERO)),
            # r31 values EVERY share at the LAST period's FMV — a faithful sheet quirk
            # that stays a no-op while one purchase_fmv knob drives the whole year.
            fmv_of_shares=half_up2(Decimal(total_shares) * purchase_fmv),
            remaining_25k=half_up2(ANNUAL_LIMIT - total_value),
        ),
    )
```

- [ ] **Step 4: Update the file's pre-existing `run_modeler` tests** — they construct old `PeriodInputs(...)` and pass `subscription_price=` to `run_modeler`. Convert their helper (the `PeriodInputs(` factory near the top, line ~45) to build `RowPlan`s carrying the test's old single subscription price per row, and change `run_modeler(periods, subscription_price=S, purchase_fmv=F, carry_forward=C)` call sites to `run_modeler(rows, purchase_fmv=F, carry_forward=C)`. Their asserted numbers must NOT change (that is the point of the uniform-subscription pin). Any assertion on `result.subscription_price` moves to the rows.

- [ ] **Step 5: Run the whole file** — `pytest tests/test_espp_calc.py -q` → PASS. Also run `pytest tests/test_espp_api.py -q` — EXPECTED FAIL (router still passes the old signature); that is Task 5's job. Do not fix here.

- [ ] **Step 6: Commit** — `git commit -am "feat(espp): run_modeler prices each period at its own subscription"`

### Task 4: Offerings schemas + CRUD routes

**Files:**
- Modify: `backend/app/schemas/espp.py`, `backend/app/api/espp.py`
- Test: `backend/tests/test_espp_api.py`

- [ ] **Step 1: Failing tests** (append to `test_espp_api.py`, matching its `auth_client` idioms):

```python
OFFERINGS = "/api/v1/espp/offerings"


async def test_offerings_crud_roundtrip(auth_client):
    created = await auth_client.post(
        OFFERINGS,
        json={"offering_start": "2023-09-01", "subscription_price": "48.509", "notes": "first"},
    )
    assert created.status_code == 201
    body = created.json()
    assert body["subscription_price"] == "48.50900"  # 5dp — the lot price family
    assert body["notes"] == "first"

    dup = await auth_client.post(
        OFFERINGS, json={"offering_start": "2023-09-01", "subscription_price": "1"}
    )
    assert dup.status_code == 409

    listed = await auth_client.get(OFFERINGS)
    assert [row["offering_start"] for row in listed.json()] == ["2023-09-01"]

    patched = await auth_client.patch(
        f"{OFFERINGS}/{body['id']}", json={"subscription_price": "50", "notes": None}
    )
    assert patched.status_code == 200
    assert patched.json()["subscription_price"] == "50.00000"
    assert patched.json()["notes"] is None  # explicit null CLEARS the nullable column

    gone = await auth_client.delete(f"{OFFERINGS}/{body['id']}")
    assert gone.status_code == 204
    assert (await auth_client.get(OFFERINGS)).json() == []


async def test_offering_validation(auth_client):
    bad_price = await auth_client.post(
        OFFERINGS, json={"offering_start": "2023-09-01", "subscription_price": "0"}
    )
    assert bad_price.status_code == 422
    assert "subscription_price must be positive" in bad_price.json()["detail"]
    bad_date = await auth_client.post(
        OFFERINGS, json={"offering_start": "1850-01-01", "subscription_price": "1"}
    )
    assert bad_date.status_code == 422
    missing = await auth_client.patch(f"{OFFERINGS}/999", json={"notes": "x"})
    assert missing.status_code == 404
```

- [ ] **Step 2: Run → FAIL** (404 on the route).

- [ ] **Step 3: Schemas.** In `backend/app/schemas/espp.py`, after `LotsOut`:

```python
class OfferingIn(BaseModel):
    offering_start: date
    subscription_price: Decimal
    notes: str | None = None


class OfferingUpdate(BaseModel):
    # offering_start / subscription_price are NOT NULL: send a value or omit (an explicit
    # null is a no-op). notes is the nullable one — its explicit null CLEARS.
    offering_start: date | None = None
    subscription_price: Decimal | None = None
    notes: str | None = None


class OfferingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    offering_start: date
    subscription_price: Decimal
    notes: str | None
```

- [ ] **Step 4: Routes.** In `backend/app/api/espp.py`: import `EsppOffering` in the models import and `OfferingIn, OfferingOut, OfferingUpdate` in the schemas import. Insert a new section between the periods section and `# --- modeler ---`:

```python
# --- offerings ---


async def _get_offering(db: AsyncSession, offering_id: int) -> EsppOffering:
    offering = await db.get(EsppOffering, offering_id)
    if offering is None:
        raise HTTPException(status_code=404, detail="espp offering not found")
    return offering


async def _require_free_offering_start(db: AsyncSession, start: date) -> None:
    taken = (
        (await db.execute(select(EsppOffering).where(EsppOffering.offering_start == start)))
        .scalars()
        .first()
    )
    if taken is not None:
        raise HTTPException(
            status_code=409, detail=f"espp offering starting {start.isoformat()} already exists"
        )


@router.get("/offerings", response_model=list[OfferingOut])
async def list_offerings(db: AsyncSession = Depends(get_db)) -> list[EsppOffering]:
    # Ascending offering_start — the resolution order plan_year_rows expects.
    return list(
        (
            await db.execute(select(EsppOffering).order_by(EsppOffering.offering_start))
        ).scalars()
    )


@router.post("/offerings", response_model=OfferingOut, status_code=201)
async def create_offering(body: OfferingIn, db: AsyncSession = Depends(get_db)) -> EsppOffering:
    require_reasonable_date(body.offering_start, "offering_start")
    price = _positive_price(body.subscription_price, "subscription_price")
    await _require_free_offering_start(db, body.offering_start)
    offering = EsppOffering(
        offering_start=body.offering_start, subscription_price=price, notes=body.notes
    )
    db.add(offering)
    await db.commit()
    return offering


@router.patch("/offerings/{offering_id}", response_model=OfferingOut)
async def update_offering(
    offering_id: IdPath, body: OfferingUpdate, db: AsyncSession = Depends(get_db)
) -> EsppOffering:
    offering = await _get_offering(db, offering_id)
    provided = body.model_dump(exclude_unset=True)
    start = provided.get("offering_start") or offering.offering_start
    require_reasonable_date(start, "offering_start")
    raw_price = provided.get("subscription_price")
    price = (
        _positive_price(raw_price, "subscription_price")
        if raw_price is not None
        else offering.subscription_price
    )
    if start != offering.offering_start:
        await _require_free_offering_start(db, start)
    offering.offering_start = start
    offering.subscription_price = price
    if "notes" in provided:
        offering.notes = provided["notes"]  # explicit null clears (nullable column)
    await db.commit()
    return offering


@router.delete("/offerings/{offering_id}", status_code=204)
async def delete_offering(offering_id: IdPath, db: AsyncSession = Depends(get_db)) -> Response:
    await db.delete(await _get_offering(db, offering_id))
    await db.commit()
    return Response(status_code=204)
```

- [ ] **Step 5: Run the two new tests** → PASS. Also extend `test_espp_endpoints_require_auth` (bottom of the file) with `("get", OFFERINGS)` and `("post", OFFERINGS)` entries matching its existing parametrize/loop shape.

- [ ] **Step 6: Commit** — `git commit -am "feat(espp): offerings CRUD"`

### Task 5: Modeler endpoint rewrite

**Files:**
- Modify: `backend/app/schemas/espp.py`, `backend/app/api/espp.py`
- Test: `backend/tests/test_espp_api.py`

- [ ] **Step 1: Update the wire schemas.** In `backend/app/schemas/espp.py` replace `ModelerPeriodOut` and `ModelerOut`:

```python
class ModelerPeriodOut(BaseModel):
    # id is None on a DERIVED row (stored=False): it fills an empty half-year slot and
    # materializes only when the user saves it (POST /espp/periods).
    id: int | None
    stored: bool
    label: str
    period_start: date
    period_end: date
    semi_annual_base: Decimal
    additional_payments: Decimal
    contribution_pct: Pct9
    # The price THIS row was chained at, plus its provenance: offering_start is None when
    # the row fell back to the latest quote or an override priced it.
    subscription_price: Decimal
    offering_start: date | None
    # --- computed chain (espp_calc.run_modeler)
    eligible_earnings: Decimal
    contribution: Decimal
    available: Decimal
    purchase_price: Decimal
    shares_before_limit: Decimal
    unused_25k: Decimal  # remaining limit at the START of this period
    max_shares_25k: Decimal
    over_limit: bool
    shares: Decimal
    cost: Decimal
    carry_forward_out: Decimal
    refund: Decimal
    value_25k: Decimal


class ModelerOut(BaseModel):
    year: int
    espp_ticker: str | None
    # LEGACY, kept one deploy cycle as stale-tab armor (spec §5.2): "params" iff BOTH
    # prices were overridden, else "latest_price". New UI reads the two sources below.
    price_source: Literal["params", "latest_price"]
    subscription_source: Literal["override", "offering", "latest_price", "mixed"]
    fmv_source: Literal["override", "latest_price"]
    # Non-null whenever any value fell back to the stored quote.
    quoted_at: datetime | None
    # The OVERRIDE echo — null when offerings/quote drive per-period (the knob box's
    # blank-means-smart-default posture).
    subscription_price: Decimal | None
    purchase_fmv: Decimal
    carry_forward: Decimal
    # Server-owned year-chip list: stored period years ∪ offering-covered purchase years
    # ∪ {current, current + 1}, sorted (the frontend has no other source once
    # fetchPeriods is gone).
    available_years: list[int]
    warnings: list[str]
    periods: list[ModelerPeriodOut]
    totals: ModelerTotalsOut
```

- [ ] **Step 2: Rewrite the endpoint.** In `backend/app/api/espp.py`, extend the espp_calc import to `from app.services.espp_calc import DISCOUNT, OfferingInfo, StoredPeriod, lot_metrics, plan_year_rows, run_modeler` and replace the whole `modeler` function:

```python
@router.get("/modeler", response_model=ModelerOut)
async def modeler(
    subscription_price: Decimal | None = None,
    purchase_fmv: Decimal | None = None,
    carry_forward: Decimal | None = None,
    year: YearQuery = None,
    db: AsyncSession = Depends(get_db),
) -> ModelerOut:
    """One calendar year chained against the 25k limit, rows planned by stored-wins /
    derive-to-fill (spec 2026-08-23 §3.3, §5.2). Nothing here is stored; a derived row
    materializes only when the user saves it. Knobs: blank subscription = per-period
    offering resolution (quote fallback + warning); blank FMV = latest quote; blank
    carry = 0. The old 404s are gone — derived rows always exist.
    """
    stored = list(
        (
            await db.execute(select(EsppPeriod).order_by(EsppPeriod.period_end, EsppPeriod.id))
        ).scalars()
    )
    offerings = list(
        (
            await db.execute(select(EsppOffering).order_by(EsppOffering.offering_start))
        ).scalars()
    )
    today = date.today()
    target_year = year if year is not None else today.year
    ticker, latest_price, quoted_at = await _espp_quote(db)
    sub_override = (
        None
        if subscription_price is None
        else _positive_price(subscription_price, "subscription_price", MODELER_PRICE_MAX_ABS)
    )
    fmv_override = (
        None
        if purchase_fmv is None
        else _positive_price(purchase_fmv, "purchase_fmv", MODELER_PRICE_MAX_ABS)
    )
    fmv = fmv_override if fmv_override is not None else latest_price
    if fmv is None:
        raise HTTPException(
            status_code=422,
            detail=(
                f"no live price for {ticker or 'the espp ticker'}; pass purchase_fmv"
            ),
        )
    carry = _non_negative_money(
        carry_forward if carry_forward is not None else ZERO, "carry_forward"
    )

    rows, warnings = plan_year_rows(
        target_year,
        [
            StoredPeriod(
                id=row.id, label=row.label, period_start=row.period_start,
                period_end=row.period_end, semi_annual_base=row.semi_annual_base,
                additional_payments=row.additional_payments,
                contribution_pct=row.contribution_pct,
            )
            for row in stored
        ],
        [
            OfferingInfo(
                offering_start=row.offering_start, subscription_price=row.subscription_price
            )
            for row in offerings
        ],
        latest_price,
        sub_override,
    )
    unpriced = [row.label for row in rows if row.subscription_price is None]
    if unpriced:
        raise HTTPException(
            status_code=422,
            detail=(
                f"no offering covers {', '.join(unpriced)} and no live price for "
                f"{ticker or 'the espp ticker'}; pass subscription_price"
            ),
        )

    result = run_modeler(rows, purchase_fmv=fmv, carry_forward=carry)

    # Year chips (spec §5.2): stored years ∪ offering-covered purchase years ∪ now/next.
    years = {row.period_end.year for row in stored} | {today.year, today.year + 1}
    if offerings:
        first = offerings[0].offering_start
        # An offering's first purchase: Sep–Dec starts buy next Feb; earlier starts buy
        # within their own calendar year.
        first_purchase_year = first.year + 1 if first.month >= 9 else first.year
        years.update(range(first_purchase_year, today.year + 1))

    sub_sources = {
        "offering" if row.offering_start is not None else "latest_price" for row in rows
    }
    subscription_source = (
        "override"
        if sub_override is not None
        else (sub_sources.pop() if len(sub_sources) == 1 else "mixed")
    )
    fmv_source = "override" if fmv_override is not None else "latest_price"
    used_quote = fmv_override is None or (
        sub_override is None and any(row.offering_start is None for row in rows)
    )
    return ModelerOut(
        year=target_year,
        espp_ticker=ticker,
        price_source=(
            "params" if sub_override is not None and fmv_override is not None else "latest_price"
        ),
        subscription_source=subscription_source,
        fmv_source=fmv_source,
        quoted_at=quoted_at if used_quote else None,
        subscription_price=sub_override,
        purchase_fmv=result.purchase_fmv,
        carry_forward=result.carry_forward,
        available_years=sorted(years),
        warnings=warnings,
        periods=[
            ModelerPeriodOut(
                id=row.period.period_id,
                stored=row.period.stored,
                label=row.period.label,
                period_start=row.period.period_start,
                period_end=row.period.period_end,
                semi_annual_base=row.period.semi_annual_base,
                additional_payments=row.period.additional_payments,
                contribution_pct=row.period.contribution_pct,
                subscription_price=row.period.subscription_price,
                offering_start=row.period.offering_start,
                eligible_earnings=row.eligible_earnings,
                contribution=row.contribution,
                available=row.available,
                purchase_price=row.purchase_price,
                shares_before_limit=row.shares_before_limit,
                unused_25k=row.unused_25k,
                max_shares_25k=row.max_shares_25k,
                over_limit=row.over_limit,
                shares=row.shares,
                cost=row.cost,
                carry_forward_out=row.carry_forward_out,
                refund=row.refund,
                value_25k=row.value_25k,
            )
            for row in result.periods
        ],
        totals=ModelerTotalsOut(
            total_25k_value=result.totals.total_25k_value,
            out_of_pocket_cost=result.totals.out_of_pocket_cost,
            fmv_of_shares=result.totals.fmv_of_shares,
            remaining_25k=result.totals.remaining_25k,
        ),
    )
```

Also update the stale clock comment at the `list_lots` `date.today()` call (~line 247): it claims to be "the ONLY clock read in this module" — reword to "one of the module's two `date.today()` reads (the modeler's year default is the other); container-local by design (spec §9)."

- [ ] **Step 3: Rewrite the modeler tests.** In `test_espp_api.py`, the existing modeler tests (lines ~554–760) change as follows — keep their fixtures (`priced_ticker`, `espp_ticker`) and helper style:

  1. `test_modeler_golden_chain_over_the_two_real_periods` — the golden chain now needs its year selected explicitly if the stored fixture periods aren't in the current year: add `year=<fixture year>` to the query. With both price params provided the numbers must be BYTE-IDENTICAL to the current assertions (the §8 pin) — do not touch the expected values; also assert the new fields: `subscription_source == "override"`, `fmv_source == "override"`, `price_source == "params"`, `subscription_price` echoes the param, every period row has `stored is True`, an integer `id`, `subscription_price` = the override, `offering_start is None`.
  2. `test_modeler_defaults_both_prices_to_the_live_quote` — now means: no offerings exist, blank knobs → every row priced at the quote; assert `subscription_source == "latest_price"`, `fmv_source == "latest_price"`, `quoted_at` non-null, and a `"no offering covers"` warning per row. Add `year=` for the fixture periods' year.
  3. `test_modeler_half_defaulted_prices_report_the_live_source` — sub given, fmv blank: `subscription_source == "override"`, `fmv_source == "latest_price"`, legacy `price_source == "latest_price"`, `quoted_at` non-null.
  4. `test_modeler_422_when_no_quote_and_no_params` — with no offerings the message is the SUBSCRIPTION one only if fmv was provided; split into two tests: (a) nothing at all → 422 `"no live price for ... pass purchase_fmv"` (fmv resolves first); (b) `purchase_fmv=1` provided, no offerings/quote → 422 containing `"no offering covers"` and `"pass subscription_price"`.
  5. `test_modeler_runs_on_params_alone_without_any_ticker` — unchanged behavior; add `year=` if needed; assert `quoted_at is None`.
  6. `test_modeler_year_defaults_to_the_latest_year_with_periods` — RENAME to `test_modeler_year_defaults_to_the_current_year` and assert `body["year"] == date.today().year` with derived rows (`stored is False`, `id is None`) when the fixture periods live in another year.
  7. `test_modeler_404s_when_the_year_has_no_periods` — REPLACE with `test_modeler_derives_rows_for_an_empty_year`: request a periodless year (with a priced ticker), expect 200, two rows labeled `"Sep {y-1}–Feb {y}"` / `"Mar–Aug {y}"`, `stored is False`, values carried from the latest stored period.
  8. Keep `test_modeler_carry_forward_seeds_the_first_period`, `test_modeler_param_validation`, `test_modeler_prices_wear_the_quote_bound_not_the_lots_one`, `test_modeler_rejects_an_out_of_century_year` as-is (add `year=` where the fixture's periods need selecting).

  Add three NEW tests:

```python
async def test_modeler_resolves_subscription_from_the_covering_offering(auth_client, priced_ticker):
    # priced_ticker's fixture quote exists; the offering must beat it.
    await auth_client.post(
        "/api/v1/espp/periods",
        json={
            "label": "1H26", "period_start": "2025-09-01", "period_end": "2026-02-27",
            "semi_annual_base": "60000", "contribution_pct": "0.14",
        },
    )
    await auth_client.post(
        OFFERINGS, json={"offering_start": "2025-09-01", "subscription_price": "48.509"}
    )
    resp = await auth_client.get("/api/v1/espp/modeler?year=2026")
    assert resp.status_code == 200
    body = resp.json()
    assert body["subscription_source"] == "offering"
    assert body["subscription_price"] is None  # no override — blank means offerings
    row = body["periods"][0]
    assert row["subscription_price"] == "48.50900"
    assert row["offering_start"] == "2025-09-01"
    assert body["warnings"] == []


async def test_modeler_available_years_composition(auth_client, priced_ticker, db):
    from datetime import date as date_cls

    current = date_cls.today().year
    await auth_client.post(
        OFFERINGS, json={"offering_start": "2023-09-01", "subscription_price": "48.509"}
    )
    resp = await auth_client.get("/api/v1/espp/modeler")
    years = resp.json()["available_years"]
    assert years == sorted(set(range(2024, current + 1)) | {current, current + 1})


async def test_modeler_reset_year_prices_each_period_from_its_own_offering(auth_client, priced_ticker):
    """A mid-cycle reset: 2024's H1 (started Sep 2023) wears the old offering, H2
    (started Mar 2024) wears the reset — two prices in one chained year."""
    await auth_client.post(
        OFFERINGS, json={"offering_start": "2023-09-01", "subscription_price": "48.509"}
    )
    await auth_client.post(
        OFFERINGS, json={"offering_start": "2024-03-01", "subscription_price": "120"}
    )
    resp = await auth_client.get("/api/v1/espp/modeler?year=2024")
    body = resp.json()
    assert body["subscription_source"] == "offering"  # both rows offering-priced
    assert [row["subscription_price"] for row in body["periods"]] == ["48.50900", "120.00000"]
    assert [row["offering_start"] for row in body["periods"]] == ["2023-09-01", "2024-03-01"]


async def test_modeler_reports_mixed_when_only_one_slot_is_covered(auth_client, priced_ticker):
    """Offering covers H2 only: H1 falls back to the quote with a warning — the source
    field says "mixed" so the provenance line can't claim more than it knows."""
    await auth_client.post(
        OFFERINGS, json={"offering_start": "2024-03-01", "subscription_price": "120"}
    )
    resp = await auth_client.get("/api/v1/espp/modeler?year=2024")
    body = resp.json()
    assert body["subscription_source"] == "mixed"
    assert body["periods"][0]["offering_start"] is None
    assert body["periods"][1]["offering_start"] == "2024-03-01"
    assert sum("no offering covers" in w for w in body["warnings"]) == 1
    assert body["quoted_at"] is not None  # a value fell back to the stored quote
```

- [ ] **Step 4: Run** — `pytest tests/test_espp_api.py tests/test_espp_calc.py -q` → PASS. Then the full backend suite: `pytest -q` → PASS (nothing else imports the modeler).

- [ ] **Step 5: Commit** — `git commit -am "feat(espp): modeler derives rows, resolves offerings per period"`

### Task 6: Importer-immunity pin for offerings

**Files:**
- Test: `backend/tests/test_importer_apply.py`

- [ ] **Step 1: Add the pin**, modeled on `test_importer_never_writes_rsu_grants` (~line 915) — full-tuple compare via a local `offering_row` helper:

```python
async def test_importer_never_writes_espp_offerings(db):
    """espp_offerings is dashboard-only (2026-08-23 spec §2.1, the rsu_grants posture):
    the workbook has no offerings concept, so an import must neither create, update nor
    delete a row."""
    from datetime import date as date_cls
    from decimal import Decimal

    from app.importer.service import run_import
    from app.models import EsppOffering

    def offering_row(row: EsppOffering) -> tuple:
        return tuple(getattr(row, column.key) for column in EsppOffering.__table__.columns)

    db.add(
        EsppOffering(offering_start=date_cls(2023, 9, 1), subscription_price=Decimal("48.509"))
    )
    await db.commit()
    before = {
        row.id: offering_row(row)
        for row in (await db.execute(select(EsppOffering))).scalars()
    }

    for _ in range(2):
        report = await run_import(build_workbook(), db, dry_run=False)
        assert report.applied is True

    after = {
        row.id: offering_row(row)
        for row in (
            await db.execute(select(EsppOffering).execution_options(populate_existing=True))
        ).scalars()
    }
    assert after == before
    assert all("espp_offerings" not in sheet.entities for sheet in report.sheets.values())
```

- [ ] **Step 2: Run** — `pytest tests/test_importer_apply.py -q` → PASS (the importer has no code path touching the table; this is a pin, not a fix).
- [ ] **Step 3: Commit** — `git commit -am "test(importer): pin espp_offerings importer immunity"`

---

## Phase 2 — Frontend: three-section ESPP page

### Task 7: Wire types + API client

**Files:**
- Modify: `src/types/api.ts`, `src/api/espp.ts`

- [ ] **Step 1: types/api.ts.** In the `--- espp ---` region: add after `EsppLotsResponse`:

```ts
export interface EsppOfferingOut {
  id: number
  offering_start: string
  // Numeric(14,5) — render verbatim (kind="plain" column), never formatCurrency's 2dp.
  subscription_price: string
  notes: string | null
}

export interface EsppOfferingCreate {
  offering_start: string
  subscription_price: string
  notes?: string | null
}

// offering_start / subscription_price are NOT NULL (value or omit); notes: null clears.
export type EsppOfferingUpdate = Partial<EsppOfferingCreate>
```

Replace `EsppModelerPeriod` (it no longer extends `EsppPeriodOut` — `id` is nullable now) and `EsppModelerOut`:

```ts
// One modeled row — a stored espp_periods row verbatim, or a derived slot-filler
// (stored=false, id=null) that materializes only when saved via POST /espp/periods.
export interface EsppModelerPeriod {
  id: number | null
  stored: boolean
  label: string
  period_start: string
  period_end: string
  semi_annual_base: string
  additional_payments: string
  contribution_pct: string // 9dp fraction
  // The price this row was chained at + provenance (offering_start null = quote/override).
  subscription_price: string
  offering_start: string | null
  // --- computed chain (espp_calc.run_modeler)
  eligible_earnings: string
  contribution: string
  available: string
  purchase_price: string
  shares_before_limit: string
  unused_25k: string
  max_shares_25k: string
  over_limit: boolean
  shares: string
  cost: string
  carry_forward_out: string
  refund: string
  value_25k: string
}

export interface EsppModelerOut {
  year: number
  espp_ticker: string | null
  // LEGACY (stale-tab armor): "params" iff both prices overridden. New UI reads the two
  // source fields below.
  price_source: 'params' | 'latest_price'
  subscription_source: 'override' | 'offering' | 'latest_price' | 'mixed'
  fmv_source: 'override' | 'latest_price'
  quoted_at: string | null
  // The override echo — null when offerings/quote drive per-period (blank knob = smart
  // default; the box is never seeded from this).
  subscription_price: string | null
  purchase_fmv: string
  carry_forward: string
  // Server-owned year-chip list (stored ∪ offering-covered ∪ {now, now+1}), sorted.
  available_years: number[]
  warnings: string[]
  periods: EsppModelerPeriod[]
  totals: EsppModelerTotals
}
```

`EsppPeriodOut/Create/Update` stay (the CRUD save path uses them).

- [ ] **Step 2: api/espp.ts.** Delete `fetchPeriods` (keep create/update/deletePeriod). Add:

```ts
// --- offerings ---

// Offerings arrive ascending by offering_start — the resolution order.
export function fetchOfferings(): Promise<EsppOfferingOut[]> {
  return api<EsppOfferingOut[]>('/espp/offerings')
}

// offering_start is the natural key: a duplicate is a 409.
export function createOffering(body: EsppOfferingCreate): Promise<EsppOfferingOut> {
  return api<EsppOfferingOut>('/espp/offerings', { method: 'POST', body: JSON.stringify(body) })
}

export function updateOffering(id: number, body: EsppOfferingUpdate): Promise<EsppOfferingOut> {
  return api<EsppOfferingOut>(`/espp/offerings/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function deleteOffering(id: number): Promise<void> {
  return api<void>(`/espp/offerings/${id}`, { method: 'DELETE' })
}
```

Update the modeler comment block: blank subscription = per-period offering resolution, blank fmv = latest quote, `year` defaults to the current calendar year; the 404s are gone. Type imports adjust accordingly.

- [ ] **Step 3: `npx tsc -b --noEmit 2>&1 | head` (or `npm run build` later)** — EXPECTED FAILURES in EsppPage/tests (fixed in Tasks 8–11). Commit anyway ONLY if the repo convention allows red intermediate commits — it does not: hold the commit; Task 8 lands together with this. (Keep the changes staged.)

### Task 8: Page orchestration + OfferingsPanel (and PeriodsPanel deletion)

**Files:**
- Modify: `src/pages/EsppPage.tsx`, `src/pages/EsppPage.css`
- Test: `src/pages/EsppPage.test.tsx` (rewrite of mocks + new panel tests)

This task rewrites everything below the Lots section. The complete new code:

- [ ] **Step 1: Imports & helpers.** Top of `EsppPage.tsx`: drop `fetchPeriods`/`EsppPeriodOut` imports; add `createOffering, deleteOffering, fetchOfferings, updateOffering` and type imports `EsppOfferingCreate, EsppOfferingOut, EsppModelerPeriod`; add `import { fetchPriceHistory } from '../api/prices'` and `import type { PricePoint } from '../types/api'`. Add helpers after `disposition()`:

```ts
// ISO date-string year math for prefills (display/entry only — the server re-validates).
// Feb 29 + n years can land on a non-leap year; clamp to the 28th.
function addYearsIso(iso: string, years: number): string {
  const [y, m, d] = iso.split('-')
  const year = Number(y) + years
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  const day = m === '02' && d === '29' && !leap ? '28' : d
  return `${year}-${m}-${day}`
}

// The covering offering: greatest offering_start <= the date (ISO strings compare as
// dates). Mirrors espp_calc._resolve_subscription so the prefill and the model agree.
function coveringOffering(
  offerings: EsppOfferingOut[],
  isoDate: string,
): EsppOfferingOut | null {
  let covering: EsppOfferingOut | null = null
  for (const offering of offerings) {
    if (offering.offering_start <= isoDate) covering = offering
  }
  return covering
}
```

- [ ] **Step 2: OfferingsPanel** — insert between the Lots and Modeler sections (complete component):

```tsx
// ── Offerings ───────────────────────────────────────────────────────────────────────────

interface OfferingFormState {
  offering_start: string
  subscription_price: string
  notes: string
}

const EMPTY_OFFERING: OfferingFormState = { offering_start: '', subscription_price: '', notes: '' }

/**
 * The enrollment windows: one row per subscription-price reset. Coverage is display-only
 * client math — "→ the next offering" or "through start + 24 mo" (approximate for an
 * off-cycle hire-month enrollment, which ends at its 4th purchase; spec "Plan mechanics").
 */
function OfferingsPanel({
  offerings,
  bars,
  onChanged,
}: {
  offerings: EsppOfferingOut[]
  // Employer daily closes for the "use close" chip; empty when the ticker/bars are absent.
  bars: PricePoint[]
  onChanged: () => void
}) {
  const [form, setForm] = useState<OfferingFormState>(EMPTY_OFFERING)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const set = (field: keyof OfferingFormState) => (value: string) =>
    setForm((f) => ({ ...f, [field]: value }))

  // The last bar on/before the typed start date — the chip's suggestion. Never
  // auto-applied (house suggestion posture).
  const closeBar = (() => {
    if (!form.offering_start) return null
    let found: PricePoint | null = null
    for (const bar of bars) {
      if (bar.d <= form.offering_start) found = bar
    }
    return found
  })()

  const startEdit = (offering: EsppOfferingOut) => {
    setEditingId(offering.id)
    setForm({
      offering_start: offering.offering_start,
      subscription_price: offering.subscription_price,
      notes: offering.notes ?? '',
    })
  }

  const submit = () => {
    // Canonical at the READ site (LotsPanel's rule). kind="plain": the column is 5dp, so
    // no "=" and no 2dp echo may touch it.
    const price = canonicalAmount(form.subscription_price.trim(), { expressions: false })
    if (!form.offering_start || !price) {
      setError('Offering start and subscription price are required')
      return
    }
    setBusy(true)
    setError(null)
    const body: EsppOfferingCreate = {
      offering_start: form.offering_start,
      subscription_price: price,
      notes: form.notes.trim() || null,
    }
    const request =
      editingId !== null ? updateOffering(editingId, body) : createOffering(body)
    request
      .then(() => {
        // Focus BEFORE the reset (the blur-commit invariant, LotsPanel's note).
        document.getElementById('offering-start')?.focus()
        setForm(EMPTY_OFFERING)
        setEditingId(null)
        onChanged()
      })
      .catch((err: unknown) => setError(message(err, 'Save failed')))
      .finally(() => setBusy(false))
  }

  const remove = (offering: EsppOfferingOut) => {
    if (!window.confirm(`Delete the offering starting ${formatDate(offering.offering_start)}?`))
      return
    setBusy(true)
    setError(null)
    deleteOffering(offering.id)
      .then(() => {
        if (offering.id === editingId) {
          setEditingId(null)
          setForm(EMPTY_OFFERING)
        }
        onChanged()
      })
      .catch((err: unknown) => setError(message(err, 'Delete failed')))
      .finally(() => setBusy(false))
  }

  const coverage = (offering: EsppOfferingOut, index: number): string => {
    const next = offerings[index + 1]
    if (next) return `→ ${formatDate(next.offering_start)}`
    return `through ${formatDate(addYearsIso(offering.offering_start, 2))}`
  }

  return (
    <section className="card">
      <h2 className="eyebrow">
        Subscription offerings
        <InfoHint text="Each enrollment window fixes your subscription price at its start-date close for up to two years (four purchases). The modeler prices each period from the offering covering it; a reset is just a new row." />
      </h2>
      <p className="drill-hint">
        One row per enrollment: the offering start date and the closing price that became
        your subscription price. Periods resolve to the latest offering starting on or
        before them — adding a reset re-prices everything after it automatically.
      </p>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <form
        className="espp-form espp-knobs"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <label>
          Offering start
          <input
            id="offering-start"
            className="field-input"
            type="date"
            value={form.offering_start}
            onChange={(e) => set('offering_start')(e.target.value)}
          />
        </label>
        <label>
          Subscription price
          <AmountInput
            kind="plain"
            value={form.subscription_price}
            onValueChange={set('subscription_price')}
          />
        </label>
        <label className="span-2">
          Notes
          <input
            className="field-input"
            value={form.notes}
            onChange={(e) => set('notes')(e.target.value)}
          />
        </label>
        <div className="espp-form-actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            {editingId !== null ? 'Save offering' : 'Add offering'}
          </button>
          {editingId !== null && (
            <button
              type="button"
              className="button"
              aria-label="Cancel the offering edit"
              onClick={() => {
                setEditingId(null)
                setForm(EMPTY_OFFERING)
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </form>
      {closeBar !== null && (
        <p className="drill-hint" role="status">
          {`close on ${formatDate(closeBar.d)}: ${closeBar.c} `}
          <button
            type="button"
            className="button"
            aria-label={`Use the ${formatDate(closeBar.d)} close as the subscription price`}
            onClick={() => set('subscription_price')(closeBar.c)}
          >
            Use
          </button>
        </p>
      )}
      {offerings.length === 0 ? (
        <p className="empty-note">
          No offerings yet — add your enrollment date and its closing price to drive the
          modeler below.
        </p>
      ) : (
        <div className="espp-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Start</th>
                <th className="num">Subscription price</th>
                <th>Coverage</th>
                <th>Notes</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {offerings.map((offering, index) => (
                <tr
                  key={offering.id}
                  className={offering.id === editingId ? 'is-editing' : undefined}
                >
                  <td>{formatDate(offering.offering_start)}</td>
                  {/* 5dp column — verbatim, never a 2dp currency echo. */}
                  <td className="num">{offering.subscription_price}</td>
                  <td>{coverage(offering, index)}</td>
                  <td className="espp-notes-cell" title={offering.notes ?? undefined}>
                    {offering.notes ?? ''}
                  </td>
                  <td className="row-actions">
                    <button
                      type="button"
                      className="button"
                      aria-label={`Edit offering from ${formatDate(offering.offering_start)}`}
                      onClick={() => startEdit(offering)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="button"
                      aria-label={`Delete offering from ${formatDate(offering.offering_start)}`}
                      disabled={busy}
                      onClick={() => remove(offering)}
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
    </section>
  )
}
```

- [ ] **Step 3: Delete `PeriodsPanel`** (the whole `// ── Periods ──` section, `PeriodFormState`, `EMPTY_PERIOD`) — Task 9 replaces its editing inside the modeler; the periods CRUD client functions stay imported there.

- [ ] **Step 4: Page orchestration.** Replace `EsppPage()` with (complete):

```tsx
export default function EsppPage() {
  const [lots, setLots] = useState<EsppLotsResponse | null>(null)
  const [lotsError, setLotsError] = useState<string | null>(null)
  const [lotsBusy, setLotsBusy] = useState(true)

  const [offerings, setOfferings] = useState<EsppOfferingOut[] | null>(null)
  const [offeringsError, setOfferingsError] = useState<string | null>(null)
  const [offeringsBusy, setOfferingsBusy] = useState(true)
  // Employer closes for the "use close" chip — best-effort: a miss just hides the chip.
  const [bars, setBars] = useState<PricePoint[]>([])

  const [modeler, setModeler] = useState<EsppModelerOut | null>(null)
  const [modelerError, setModelerError] = useState<string | null>(null)
  const [modelerBusy, setModelerBusy] = useState(true)
  // Knobs are NEVER seeded from the echo (spec §6.2): blank means the smart default —
  // subscription from offerings, FMV from the latest quote — and the provenance line
  // says what blank resolved to. They live here so a failed recalculate keeps them.
  const [knobs, setKnobs] = useState<Knobs>({ subscription: '', fmv: '', carry: '' })
  // null = the server's default (the current calendar year).
  const [year, setYear] = useState<number | null>(null)

  const lotsSeq = useRef(0)
  const offeringsSeq = useRef(0)
  const modelerSeq = useRef(0)
  const barsFetched = useRef(false)

  const loadLots = () => {
    const seq = ++lotsSeq.current
    fetchLots()
      .then((data) => {
        if (seq !== lotsSeq.current) return
        setLots(data)
        setLotsError(null)
        // Lazy, once: the chip's bars need the employer ticker, which this payload names.
        if (!barsFetched.current && data.espp_ticker !== null) {
          barsFetched.current = true
          fetchPriceHistory(data.espp_ticker, 3650)
            .then((history) => setBars(history.points))
            .catch(() => setBars([]))
        }
      })
      .catch((err: unknown) => {
        if (seq !== lotsSeq.current) return
        setLotsError(message(err, 'Failed to load ESPP lots'))
      })
      .finally(() => {
        if (seq === lotsSeq.current) setLotsBusy(false)
      })
  }

  const loadOfferings = () => {
    const seq = ++offeringsSeq.current
    fetchOfferings()
      .then((data) => {
        if (seq !== offeringsSeq.current) return
        setOfferings(data)
        setOfferingsError(null)
      })
      .catch((err: unknown) => {
        if (seq !== offeringsSeq.current) return
        setOfferingsError(message(err, 'Failed to load offerings'))
      })
      .finally(() => {
        if (seq === offeringsSeq.current) setOfferingsBusy(false)
      })
  }

  const loadModeler = (params: ModelerParams = {}) => {
    const seq = ++modelerSeq.current
    fetchModeler(params)
      .then((data) => {
        if (seq !== modelerSeq.current) return
        setModeler(data)
        setModelerError(null)
      })
      .catch((err: unknown) => {
        if (seq !== modelerSeq.current) return
        // Dropped, unlike the lots: a chain shown under knobs that did not produce it is
        // a lie. The knobs and the year survive in page state.
        setModeler(null)
        setModelerError(message(err, 'Failed to run the model'))
      })
      .finally(() => {
        if (seq === modelerSeq.current) setModelerBusy(false)
      })
  }

  useEffect(() => {
    loadLots()
    loadOfferings()
    loadModeler()
  }, [])

  const reloadLots = () => {
    setLotsBusy(true)
    setLotsError(null)
    loadLots()
  }

  // Blank knobs are OMITTED from the query (src/api/espp.ts) — blank means the server's
  // smart default, which is the whole point of the offerings feature.
  const runModeler = (yearOverride?: number | null) => {
    const target = yearOverride !== undefined ? yearOverride : year
    setModelerBusy(true)
    setModelerError(null)
    loadModeler({
      subscriptionPrice: canonicalAmount(knobs.subscription.trim(), { expressions: false }),
      purchaseFmv: canonicalAmount(knobs.fmv.trim(), { expressions: false }),
      carryForward: canonicalAmount(knobs.carry.trim()),
      year: target ?? undefined,
    })
  }

  const selectYear = (value: number) => {
    setYear(value)
    runModeler(value)
  }

  // An offering write re-prices the chain; a modeler-row save moves it. Both re-run with
  // the CURRENT knobs and year.
  const onOfferingsChanged = () => {
    setOfferingsBusy(true)
    setOfferingsError(null)
    loadOfferings()
    runModeler()
  }

  return (
    <div className="page espp-page">
      <div className="page-header">
        <h1>ESPP</h1>
        <div className="spacer" />
      </div>

      {lotsError && (
        <div className="error-banner" role="alert">
          {lots === null ? lotsError : `${lotsError} — the table may be showing earlier data.`}{' '}
          <button className="button" aria-label="Retry loading lots" onClick={reloadLots}>
            Retry
          </button>
        </div>
      )}
      {lots === null ? (
        lotsBusy && <p className="empty-note">Loading lots…</p>
      ) : (
        <div className={`loading-dim${lotsBusy ? ' is-loading' : ''}`}>
          <LotsPanel data={lots} offerings={offerings ?? []} onChanged={reloadLots} />
        </div>
      )}

      {offeringsError && (
        <div className="error-banner" role="alert">
          {offerings === null
            ? offeringsError
            : `${offeringsError} — the table may be showing earlier data.`}{' '}
          <button
            className="button"
            aria-label="Retry loading offerings"
            onClick={onOfferingsChanged}
          >
            Retry
          </button>
        </div>
      )}
      {offerings === null ? (
        offeringsBusy && <p className="empty-note">Loading offerings…</p>
      ) : (
        <div className={`loading-dim${offeringsBusy ? ' is-loading' : ''}`}>
          <OfferingsPanel offerings={offerings} bars={bars} onChanged={onOfferingsChanged} />
        </div>
      )}

      {modelerError !== null && (
        <div className="error-banner" role="alert">
          {modelerError}{' '}
          <button className="button" aria-label="Retry the model" onClick={() => runModeler()}>
            Retry
          </button>
        </div>
      )}
      <div className={`loading-dim${modelerBusy ? ' is-loading' : ''}`}>
        <ModelerCard
          data={modeler}
          knobs={knobs}
          onKnobChange={setKnobs}
          onRun={runModeler}
          onYearSelect={selectYear}
          onRowsSaved={() => runModeler()}
          busy={modelerBusy}
        />
      </div>
    </div>
  )
}
```

(`LotsPanel`'s new `offerings` prop and `ModelerCard`'s new signature land in Tasks 9–10 — within this same PR-sized phase the file only compiles at the end of Task 9; run nothing between.)

- [ ] **Step 5** (with Task 9 complete): commit happens at the end of Task 9.

### Task 9: ModelerCard rewrite (year chips · provenance · editable rows · save & recalculate)

**Files:**
- Modify: `src/pages/EsppPage.tsx` (replace `ModelerCard`), `src/pages/EsppPage.css`

- [ ] **Step 1: Replace `ModelerCard` entirely** with:

```tsx
// ── Modeler ─────────────────────────────────────────────────────────────────────────────

interface Knobs {
  subscription: string
  fmv: string
  carry: string
}

// Sparse per-row edits keyed by row identity; only touched cells live here, so a refetch
// updates every untouched cell while typed text survives.
type RowEdits = Record<string, { base?: string; additional?: string; pct?: string }>

function rowKey(row: EsppModelerPeriod): string {
  return row.id !== null ? `p${row.id}` : `d${row.label}`
}

function sourceLine(data: EsppModelerOut): string {
  const sub =
    data.subscription_source === 'override'
      ? 'custom subscription price'
      : data.subscription_source === 'offering'
        ? 'subscription from your offerings'
        : data.subscription_source === 'mixed'
          ? 'subscription mixed — offerings where they cover, latest quote elsewhere'
          : `subscription from the latest ${data.espp_ticker ?? 'ESPP ticker'} quote`
  const fmv =
    data.fmv_source === 'override'
      ? 'custom FMV'
      : `FMV from the latest quote${data.quoted_at ? ` (as of ${formatDate(data.quoted_at)})` : ''}`
  return `${sub} · ${fmv}`
}

function ModelerCard({
  data,
  knobs,
  onKnobChange,
  onRun,
  onYearSelect,
  onRowsSaved,
  busy,
}: {
  data: EsppModelerOut | null
  knobs: Knobs
  onKnobChange: (update: (current: Knobs) => Knobs) => void
  onRun: () => void
  onYearSelect: (year: number) => void
  onRowsSaved: () => void
  busy: boolean
}) {
  const [edits, setEdits] = useState<RowEdits>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const setKnob = (field: keyof Knobs) => (value: string) =>
    onKnobChange((current) => ({ ...current, [field]: value }))

  const editCell =
    (key: string, field: 'base' | 'additional' | 'pct') => (value: string) =>
      setEdits((cur) => ({ ...cur, [key]: { ...cur[key], [field]: value } }))

  // The DISPLAYED text per cell: the edit if one exists, else the payload value (pct at
  // human scale — "14", never "0.140000000").
  const cellValue = (row: EsppModelerPeriod, field: 'base' | 'additional' | 'pct'): string => {
    const edit = edits[rowKey(row)]?.[field]
    if (edit !== undefined) return edit
    if (field === 'base') return row.semi_annual_base
    if (field === 'additional') return row.additional_payments
    return shiftPoint(row.contribution_pct, 2)
  }

  const rowIsDirty = (row: EsppModelerPeriod): boolean => {
    const edit = edits[rowKey(row)]
    if (!edit) return false
    return (
      (edit.base !== undefined && canonicalAmount(edit.base.trim()) !== row.semi_annual_base) ||
      (edit.additional !== undefined &&
        canonicalAmount(edit.additional.trim()) !== row.additional_payments) ||
      (edit.pct !== undefined &&
        canonicalAmount(edit.pct.trim(), { expressions: false }) !==
          shiftPoint(row.contribution_pct, 2))
    )
  }

  const dirtyRows = (data?.periods ?? []).filter(rowIsDirty)

  const saveAndRecalculate = () => {
    if (data === null) {
      onRun()
      return
    }
    if (dirtyRows.length === 0) {
      onRun()
      return
    }
    // Validate every dirty row before ANY write (the wizard's validate-then-save order).
    for (const row of dirtyRows) {
      const base = canonicalAmount(cellValue(row, 'base').trim())
      const additional = canonicalAmount(cellValue(row, 'additional').trim() || '0')
      const pct = canonicalAmount(cellValue(row, 'pct').trim(), { expressions: false })
      if (!base || !isAmount(base) || !isAmount(additional) || !pct || !isAmount(pct, { expressions: false })) {
        setError(`${row.label}: base, additional and contribution % must be numbers`)
        return
      }
      const pctNumber = Number(pct)
      if (pctNumber < 0 || pctNumber > 100) {
        // The box's vocabulary (14 = 14%), not the stored fraction's (PeriodsPanel's rule).
        setError(`${row.label}: contribution % must be between 0 and 100`)
        return
      }
    }
    setSaving(true)
    setError(null)
    const requests = dirtyRows.map((row) => {
      // The FULL row on both verbs: the router validates the MERGED period. A
      // materialized derived row posts exactly what its cells display (spec §6.3).
      const body: EsppPeriodCreate = {
        label: row.label,
        period_start: row.period_start,
        period_end: row.period_end,
        semi_annual_base: canonicalAmount(cellValue(row, 'base').trim()),
        additional_payments: canonicalAmount(cellValue(row, 'additional').trim() || '0'),
        contribution_pct: shiftPoint(
          canonicalAmount(cellValue(row, 'pct').trim(), { expressions: false }),
          -2,
        ),
      }
      return row.id !== null ? updatePeriod(row.id, body) : createPeriod(body)
    })
    Promise.all(requests)
      .then(() => {
        setEdits({})
        onRowsSaved()
      })
      .catch((err: unknown) => setError(message(err, 'Save failed')))
      .finally(() => setSaving(false))
  }

  const resetRow = (row: EsppModelerPeriod) => {
    if (row.id === null) return
    if (!window.confirm(`Reset ${row.label} to its derived values?`)) return
    setSaving(true)
    setError(null)
    deletePeriod(row.id)
      .then(() => {
        setEdits((cur) => {
          const next = { ...cur }
          delete next[rowKey(row)]
          return next
        })
        onRowsSaved()
      })
      .catch((err: unknown) => setError(message(err, 'Reset failed')))
      .finally(() => setSaving(false))
  }

  const working = busy || saving

  return (
    <section className="card" data-entry-scope="">
      <h2 className="eyebrow">
        Purchase modeler{data === null ? '' : ` — ${data.year}`}
        <InfoHint text="What each period buys: your entered base and contribution % chained against the $25k IRS limit, priced at each period's offering subscription price and a 15% discount on the lower of it and the FMV." />
      </h2>
      {data !== null && data.available_years.length > 1 && (
        <div className="segmented" role="group" aria-label="Modeled year">
          {data.available_years.map((value) => (
            <button
              key={value}
              type="button"
              className="segment"
              aria-pressed={value === data.year}
              onClick={() => onYearSelect(value)}
            >
              {value}
            </button>
          ))}
        </div>
      )}
      <p className="drill-hint">
        Leave the knobs blank and the model uses your offerings for each period&apos;s
        subscription price and the latest quote for the FMV — type a value to override the
        whole year. Base, additional and contribution % are saved per period.
      </p>
      <form
        className="espp-form espp-knobs"
        onSubmit={(e) => {
          e.preventDefault()
          saveAndRecalculate()
        }}
      >
        <label>
          Subscription price
          <AmountInput
            kind="plain"
            value={knobs.subscription}
            onValueChange={setKnob('subscription')}
            placeholder="from offerings"
          />
        </label>
        <label>
          Purchase FMV
          <AmountInput
            kind="plain"
            value={knobs.fmv}
            onValueChange={setKnob('fmv')}
            placeholder="latest quote"
          />
        </label>
        <label>
          Carry-forward
          <AmountInput value={knobs.carry} onValueChange={setKnob('carry')} placeholder="0" />
        </label>
        <div className="espp-form-actions">
          <button
            type="submit"
            className="button button-primary"
            data-entry-primary=""
            disabled={working}
          >
            {working ? 'Working…' : 'Save & recalculate'}
          </button>
        </div>
      </form>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {dirtyRows.length > 0 && (
        <p className="drill-hint" role="status">
          {`${dirtyRows.length} ${dirtyRows.length === 1 ? 'period has' : 'periods have'} unsaved
          edits — the chain below is stale until you save & recalculate.`}
        </p>
      )}
      {data !== null && (
        <>
          <p className="drill-hint">{sourceLine(data)}</p>
          {data.warnings.map((warning) => (
            <p key={warning} className="drill-hint espp-warning">
              {warning}
            </p>
          ))}
          <div className="gauge">
            <div
              className="gauge-track"
              role="meter"
              aria-label={`${formatCurrency(LIMIT_25K)} limit used in ${data.year}`}
              aria-valuenow={Number(data.totals.total_25k_value)}
              aria-valuemin={0}
              aria-valuemax={LIMIT_25K}
              aria-valuetext={`${formatCurrency(data.totals.total_25k_value)} of ${formatCurrency(
                LIMIT_25K,
              )}`}
            >
              <div
                className="gauge-fill"
                style={{
                  width: `${Math.max(
                    0,
                    Math.min(100, (Number(data.totals.total_25k_value) / LIMIT_25K) * 100),
                  ).toFixed(2)}%`,
                }}
              />
            </div>
            <div className="gauge-labels">
              <span>{`${formatCurrency(data.totals.total_25k_value)} used`}</span>
              <span>{`${formatCurrency(data.totals.remaining_25k)} left`}</span>
            </div>
          </div>
          <div className="kpi-row">
            <div className="stat-tile">
              <div className="stat-label">
                Out of pocket
                <InfoHint text="Your contributions after the carry-forward — what the purchase actually costs you." />
              </div>
              <div className="stat-value">{formatCurrency(data.totals.out_of_pocket_cost)}</div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">
                FMV of shares
                <InfoHint text="The purchased shares valued at the period&apos;s fair market value." />
              </div>
              <div className="stat-value">{formatCurrency(data.totals.fmv_of_shares)}</div>
            </div>
          </div>
          <div className="espp-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Period</th>
                  <th className="num">Subscription</th>
                  <th className="num">Base</th>
                  <th className="num">Additional</th>
                  <th className="num">Contrib %</th>
                  <th className="num">Contribution</th>
                  <th className="num">Available</th>
                  <th className="num">Price</th>
                  <th className="num">Shares</th>
                  <th className="num">Cost</th>
                  <th className="num">Refund</th>
                  <th className="num">Carry out</th>
                  <th className="num">25k value</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.periods.map((row) => (
                  <tr key={rowKey(row)}>
                    <td>
                      {row.label}
                      {!row.stored && <span className="badge">derived</span>}
                      {row.over_limit && <span className="badge">Over limit</span>}
                      <span className="drill-hint espp-period-dates">
                        {`${formatDate(row.period_start)} – ${formatDate(row.period_end)}`}
                      </span>
                    </td>
                    <td className="num">
                      {/* 5dp column — verbatim. Provenance under it. */}
                      {row.subscription_price}
                      <span className="drill-hint espp-period-dates">
                        {row.offering_start !== null
                          ? `${formatDate(row.offering_start)} offering`
                          : data.subscription_source === 'override'
                            ? 'override'
                            : 'latest quote'}
                      </span>
                    </td>
                    <td className="num espp-cell">
                      <AmountInput
                        value={cellValue(row, 'base')}
                        onValueChange={editCell(rowKey(row), 'base')}
                        ariaLabel={`${row.label} semi-annual base`}
                      />
                    </td>
                    <td className="num espp-cell">
                      <AmountInput
                        value={cellValue(row, 'additional')}
                        onValueChange={editCell(rowKey(row), 'additional')}
                        ariaLabel={`${row.label} additional payments`}
                      />
                    </td>
                    <td className="num espp-cell">
                      <AmountInput
                        kind="percent"
                        value={cellValue(row, 'pct')}
                        onValueChange={editCell(rowKey(row), 'pct')}
                        ariaLabel={`${row.label} contribution percent`}
                      />
                    </td>
                    <td className="num">{formatCurrency(row.contribution)}</td>
                    <td className="num">{formatCurrency(row.available)}</td>
                    <td className="num">{formatCurrency(row.purchase_price)}</td>
                    <td className="num">{formatShares(row.shares)}</td>
                    <td className="num">{formatCurrency(row.cost)}</td>
                    <td className="num">{formatCurrency(row.refund)}</td>
                    <td className="num">{formatCurrency(row.carry_forward_out)}</td>
                    <td className="num">{formatCurrency(row.value_25k)}</td>
                    <td className="row-actions">
                      {row.stored && (
                        <button
                          type="button"
                          className="button"
                          aria-label={`Reset ${row.label} to derived values`}
                          disabled={working}
                          onClick={() => resetRow(row)}
                        >
                          Reset
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
```

**Prop-name check against AmountInput:** its aria prop is `aria-label` pass-through — read `src/components/AmountInput.tsx:140-144` and use the EXACT prop name it exposes (it may be `ariaLabel` or a spread — mirror InputsForm's usage at `src/components/taxes/InputsForm.tsx:244-255`). Same for `placeholder`: if AmountInput doesn't accept one, add a pass-through `placeholder?: string` prop to it (blurred-echo display must still win when a value exists — placeholder only shows on empty, which is native input behavior; commit that AmountInput change inside this task).

- [ ] **Step 2: CSS.** Append to `EsppPage.css`:

```css
/* Editable cells inside the modeler table — narrow boxes, table stays scannable. */
.espp-cell .field-input {
  width: 110px;
}

.espp-period-dates {
  display: block;
  margin: 0;
  font-size: 0.7rem;
}

/* Advisory register (net-worth-projection precedent): amber, not the error banner. */
.espp-warning {
  color: #c98500;
}

/* Year chips reuse the app's segmented control look; panels.css owns .segmented. */
```

If `panels.css` has no `.segmented`/`.segment` classes (verify with grep — TaxesPage/NetWorthPage use a segmented control), reuse the exact class names those pages use for their Monthly/Quarterly toggle instead; do not invent a new pattern.

- [ ] **Step 3: Compile.** `npx tsc -b --noEmit` → only remaining errors must be in the two test files and LotsPanel's missing `offerings` prop (Task 10). Fix any others now.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat(espp): three-section page — offerings panel + modeler-as-editor"` (Tasks 7–9 land together; the tree compiles except tests + LotsPanel prop, completed next).

### Task 10: LotsPanel prefills

**Files:**
- Modify: `src/pages/EsppPage.tsx` (LotsPanel)

- [ ] **Step 1:** Change the signature to `function LotsPanel({ data, offerings, onChanged }: { data: EsppLotsResponse; offerings: EsppOfferingOut[]; onChanged: () => void })` and replace the purchase-date input's `onChange` wiring: add above `submit`:

```tsx
  // Prefill-only, untouched-box guard (spec §6.4): typing a purchase date fills the
  // subscription price from the covering offering and the qualifying date from the §423
  // rule — max(offering start + 2y, purchase + 1y). Both editable; edits never clobbered.
  const onPurchaseDateChange = (value: string) => {
    setForm((f) => {
      const next = { ...f, purchase_date: value }
      if (editingId === null && value !== '') {
        const covering = coveringOffering(offerings, value)
        if (covering !== null && f.subscription_price === '') {
          next.subscription_price = covering.subscription_price
        }
        if (f.qualifying_date === '') {
          const byPurchase = addYearsIso(value, 1)
          const byOffering = covering !== null ? addYearsIso(covering.offering_start, 2) : ''
          next.qualifying_date = byOffering > byPurchase ? byOffering : byPurchase
        }
      }
      return next
    })
  }
```

and change the purchase-date `<input>` to `onChange={(e) => onPurchaseDateChange(e.target.value)}`.

- [ ] **Step 2:** `npx tsc -b --noEmit` → page compiles clean (tests still red until Task 11).
- [ ] **Step 3: Commit** — `git commit -am "feat(espp): lot form prefills subscription + qualifying date from offerings"`

### Task 11: EsppPage tests rewrite + full frontend green

**Files:**
- Modify: `src/pages/EsppPage.test.tsx`

- [ ] **Step 1:** Update the module mock: drop `fetchPeriods`, add `fetchOfferings`, `createOffering`, `updateOffering`, `deleteOffering`; mock `'../api/prices'` with `fetchPriceHistory: vi.fn()` resolving `{ ticker: 'NVDA', points: [{ d: '2023-09-01', c: '48.509' }] }`. Update the `modelerResponse()` fixture to the new shape (add `stored: true`, `subscription_price`, `offering_start`, `subscription_source: 'offering'`, `fmv_source: 'latest_price'`, `available_years: [2024, 2025, 2026]`, `warnings: []`, `subscription_price: null` top-level). Default `fetchOfferings` to `[{ id: 1, offering_start: '2023-09-01', subscription_price: '48.50900', notes: null }]`.

- [ ] **Step 2:** Delete the PeriodsPanel tests; port their save/validation intent onto the modeler table. **Pin the fixture first** so the expectations below are exact — `modelerResponse()` returns two rows:
  - stored: `{ id: 1, stored: true, label: '1H24', period_start: '2023-09-01', period_end: '2024-02-29', semi_annual_base: '60000.00', additional_payments: '0.00', contribution_pct: '0.140000000', subscription_price: '48.50900', offering_start: '2023-09-01', ...chain fields }`
  - derived: `{ id: null, stored: false, label: 'Mar–Aug 2024', period_start: '2024-03-01', period_end: '2024-08-30', semi_annual_base: '60000.00', additional_payments: '0.00', contribution_pct: '0.140000000', subscription_price: '48.50900', offering_start: '2023-09-01', ...chain fields }`
  - top level: `year: 2024`, `available_years: [2024, 2025]`, `subscription_source: 'offering'`, `fmv_source: 'latest_price'`, `subscription_price: null`, `warnings: []`.

The three load-bearing tests, complete (use the file's existing render pattern and fixture builders; `within` comes from `@testing-library/react`):

```tsx
it('saves a dirty stored row through updatePeriod and re-runs the model', async () => {
  renderPage()
  const base = await screen.findByLabelText('1H24 semi-annual base')
  fireEvent.change(base, { target: { value: '65000' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save & recalculate' }))
  await waitFor(() =>
    expect(updatePeriod).toHaveBeenCalledWith(1, {
      label: '1H24',
      period_start: '2023-09-01',
      period_end: '2024-02-29',
      semi_annual_base: '65000',
      additional_payments: '0.00',
      contribution_pct: '0.14', // "14" at human scale, shifted back to the stored fraction
    }),
  )
  // Save success re-runs the model; blank knobs stay omitted from the params.
  await waitFor(() => expect(vi.mocked(fetchModeler).mock.calls.length).toBeGreaterThan(1))
})

it('materializes a derived row through createPeriod with its derived label and dates', async () => {
  renderPage()
  const pct = await screen.findByLabelText('Mar–Aug 2024 contribution percent')
  fireEvent.change(pct, { target: { value: '15' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save & recalculate' }))
  await waitFor(() =>
    expect(createPeriod).toHaveBeenCalledWith({
      label: 'Mar–Aug 2024',
      period_start: '2024-03-01',
      period_end: '2024-08-30',
      semi_annual_base: '60000.00',
      additional_payments: '0.00',
      contribution_pct: '0.15',
    }),
  )
})

it('offers the close-on-date chip and applies it only on click', async () => {
  renderPage()
  const heading = await screen.findByRole('heading', { name: /Subscription offerings/ })
  const card = heading.closest('section') as HTMLElement
  fireEvent.change(within(card).getByLabelText('Offering start'), {
    target: { value: '2023-09-01' },
  })
  const chip = await within(card).findByText(/close on/)
  expect(chip).toHaveTextContent('48.509')
  const priceBox = within(card).getByLabelText('Subscription price') as HTMLInputElement
  expect(priceBox.value).toBe('') // never auto-applied
  fireEvent.click(within(card).getByRole('button', { name: /Use the/ }))
  expect(priceBox.value).toBe('48.509')
})
```

(`renderPage` = the file's existing render helper; if it has none, `render(<EsppPage />)` with the file's existing wrapper — mirror how the current lots tests mount the page. If `getByLabelText('Subscription price')` is ambiguous against the knob, the `within(card)` scoping above resolves it — keep that scoping.)

And these six, in the same style — each a short variation of the patterns above:

```tsx
it('renders the three sections in order: lots, offerings, modeler', async () => { /* find the three eyebrow headings; assert order via node.compareDocumentPosition(Node.DOCUMENT_POSITION_FOLLOWING) */ })

it('does not seed the knob boxes from the modeler echo', async () => { /* after first load, the three knob inputs (scoped within the modeler card) all have value '' */ })

it('shows per-row subscription provenance', async () => { /* the 1H24 row shows '48.50900' and a sub-line matching /offering/ */ })

it('reset deletes a stored row after confirm and re-runs', async () => { /* vi.spyOn(window, 'confirm').mockReturnValue(true); click 'Reset 1H24 to derived values'; expect deletePeriod(1), then a fetchModeler re-call */ })

it('year chips call the modeler with the picked year', async () => { /* click the '2025' segment; expect the LAST fetchModeler call's params to include year: 2025 */ })

it('prefills subscription and qualifying date on purchase-date entry', async () => { /* change the lot form's Purchase date to '2024-02-29'; expect the lot Subscription box '48.50900' and Qualifying date '2025-09-01' (offering start + 2y beats purchase + 1y) */ })
```

Also keep/adapt every existing lots test unchanged (they must still pass byte-identically — the lots table itself didn't change).

- [ ] **Step 3: Run** — `npx vitest run src/pages/EsppPage.test.tsx` → PASS. Then the whole suite: `npm test` → the ONLY remaining failures allowed are MonthlyUpdate/Settings suggestion tests (Phase 3 removes the feature). If anything else is red, fix it now.

- [ ] **Step 4: Commit** — `git commit -am "test(espp): three-section page coverage"`

---

## Phase 3 — Balance Suggestions removal (entire feature)

**Fence:** the TAX input suggestions (`tax_service.derive_suggestions`, `src/components/taxes/InputsForm.tsx` chips, `suggested` fields in `src/api/taxes.ts`/types) are a DIFFERENT feature. Do not touch them.

### Task 12: Backend removal + Migration B

**Files:**
- Modify: `backend/app/api/net_worth.py`, `backend/app/schemas/net_worth.py`, `backend/app/models/net_worth.py`
- Create: `backend/alembic/versions/20260823_0901_c9e2b7a4d113_drop_account_suggest_source.py`
- Test: `backend/tests/test_net_worth_api.py`, `backend/tests/test_importer_apply.py`

- [ ] **Step 1: Failing regression test first** (append to `test_net_worth_api.py`):

```python
async def test_suggestions_endpoint_is_gone(auth_client):
    """Balance suggestions were removed end to end (2026-08-23 spec §7)."""
    resp = await auth_client.get("/api/v1/net-worth/suggestions")
    assert resp.status_code == 404
```

Run → FAIL (currently 200).

- [ ] **Step 2: Remove backend code.**
  - `backend/app/api/net_worth.py`: delete the whole suggestions section (`PORTFOLIO_KIND` through the end of `suggestions()`, lines ~325–401); delete the `from app.api.comp import _unvested_value` import (+ its comment block) and `from app.services.portfolio_calc import allocation, fold_transactions, load_portfolio`; delete `SuggestionOut, SuggestionsOut` from the schemas import; delete `NULLABLE_ACCOUNT_FIELDS` and simplify `update_account`'s dict comprehension to `if value is not None` (adjust its comment: every patchable account column is NOT NULL now, so an explicit null is always a no-op request); remove `ROUND_HALF_UP` from the decimal import if now unused (check: `quantize_money` covers put_month — `Decimal` stays).
  - `backend/app/schemas/net_worth.py`: delete `SUGGEST_SOURCE_SHAPE` + the `re` import, `suggest_source` from `AccountOut` and `AccountUpdate` (+ its validator), and the `SuggestionOut`/`SuggestionsOut` classes.
  - `backend/app/models/net_worth.py`: delete the `suggest_source` column + comment.

- [ ] **Step 3: Migration B** — create `backend/alembic/versions/20260823_0901_c9e2b7a4d113_drop_account_suggest_source.py`:

```python
"""drop account suggest_source

Balance suggestions removed end to end (2026-08-23 spec §7) before the adding migration
(712243ee3ff3) ever deployed — prod runs add-then-drop in one boot, harmless. Downgrade
re-adds the column nullable; stored mappings are not restored (the feature is gone).

Revision ID: c9e2b7a4d113
Revises: a7c41e88f2d0
Create Date: 2026-08-23 09:01:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c9e2b7a4d113"
down_revision: str | Sequence[str] | None = "a7c41e88f2d0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_column("accounts", "suggest_source")


def downgrade() -> None:
    """Downgrade schema."""
    op.add_column("accounts", sa.Column("suggest_source", sa.String(200), nullable=True))
```

- [ ] **Step 4: Remove the dead tests.** In `test_net_worth_api.py`: delete `SUGGESTIONS` (line 15), `test_account_suggest_source_round_trip`, `test_account_suggest_source_shape_is_validated`, `test_account_suggest_source_survives_an_unrelated_patch`, and every `test_suggestions_*` from line ~458 onward. In `test_importer_apply.py`: delete `test_importer_never_writes_account_suggest_source` (the feature is gone; the `account_row` helper stays if `test_importer_never_rewrites_user_owned_account_columns`-style pins use it — keep the helper if any other test calls it, else delete it too). Also sweep `backend/tests` for other `suggest_source` references: `grep -rn suggest_source backend/tests` must return nothing when done.

- [ ] **Step 5: Run** — `cd backend && .venv/Scripts/python -m pytest -q` → full suite PASS. `alembic heads` → `c9e2b7a4d113 (head)`.

- [ ] **Step 6: Commit** — `git commit -am "feat!: remove balance suggestions (backend + suggest_source column)"`

### Task 13: Wizard removal

**Files:**
- Modify: `src/pages/MonthlyUpdatePage.tsx`, `src/pages/MonthlyUpdatePage.test.tsx`, `src/api/netWorth.ts`, `src/types/api.ts`

- [ ] **Step 1:** `src/api/netWorth.ts`: delete `fetchSuggestions` + the `SuggestionsOut` type import. `src/types/api.ts`: delete `SuggestionOut`/`SuggestionsOut` interfaces, the `suggest_source` field + doc comment on `AccountOut`, and `'suggest_source'` from the `AccountUpdate` pick (restore the pre-feature shape: `Partial<Pick<AccountOut, 'name' | 'group' | 'sort_order' | 'is_active' | 'is_component'>>` — drop its suggestion comment).

- [ ] **Step 2:** `src/pages/MonthlyUpdatePage.tsx`: remove the `fetchSuggestions` import (line ~9) and `SuggestionsOut` type import (line ~23); the `suggestions` state (lines ~123–127); the `fetchSuggestions().catch(...)` member of the load `Promise.all` and the `suggestionData` destructure + `setSuggestions` (lines ~191–213 — renumber the destructure carefully; run the tests to catch an off-by-one); `showSuggestions`/`suggestedBalances` (lines ~466–474); the warnings render block (~679–690) and the whole chip block inside the balance row (~716–775, keeping the AmountInput cell itself). If `quantize` (from `../utils/amount`) is now unused, remove the import (eslint will flag).

- [ ] **Step 3:** `MonthlyUpdatePage.test.tsx`: delete the suggestion tests and the `fetchSuggestions` mock entries; add one regression assertion inside an existing balances-step test:

```tsx
expect(screen.queryByText(/suggested/)).toBeNull()
```

- [ ] **Step 4: Run** — `npx vitest run src/pages/MonthlyUpdatePage.test.tsx` → PASS; `npm run lint` → clean for this file.
- [ ] **Step 5: Commit** — `git commit -am "feat!: remove wizard balance-suggestion chips"`

### Task 14: Settings removal

**Files:**
- Modify: `src/pages/SettingsPage.tsx`, `src/pages/SettingsPage.test.tsx`

- [ ] **Step 1:** Delete from `SettingsPage.tsx`: the suggestion-kind constants/comment (~line 34), all `suggest*` state (lines ~79–91 subset), `loadSuggestSources` + its call in the mount effect (~121–145), `changeSuggestSource` (~298–340), and the "Balance suggestions" card JSX (~578–652). Then remove now-unused imports (`fetchAllocation` from `../api/portfolio`, `updateAccount`/`fetchAccounts` from `../api/netWorth`, `AccountOut` type — verify each with tsc/eslint rather than assuming; `fetchAccounts` may have no other caller here).

- [ ] **Step 2:** `SettingsPage.test.tsx`: delete the suggestions describe-block/tests (32 references) and their mocks; add to the main render test:

```tsx
expect(screen.queryByText(/Balance suggestions/)).toBeNull()
```

- [ ] **Step 3: Run** — `npx vitest run src/pages/SettingsPage.test.tsx` → PASS. Full `npm test` → PASS. `npm run lint` → clean. `npm run build` → clean, and note the chunk sizes printed — the entry and echarts chunk budgets must not regress (no chart code changed; expect byte-identical echarts chunk).
- [ ] **Step 4: Commit** — `git commit -am "feat!: remove balance-suggestions settings card"`

### Task 15: Docs amendment

**Files:**
- Modify: `docs/superpowers/specs/2026-08-21-data-entry-ergonomics-design.md`

- [ ] **Step 1:** Append to its §5.2 (or as a dated block at the section's end):

```markdown
> **Amendment (2026-08-23): feature removed.** The balance-suggestions mapping card,
> wizard Apply chips, `GET /net-worth/suggestions`, and `accounts.suggest_source` were
> removed end to end before ever deploying — the user judged the mapping + chips not
> useful. See `2026-08-23-espp-offerings-refactor-design.md` §7. The tax-input suggestion
> chips (§ InputsForm) are a different feature and remain.
```

- [ ] **Step 2: Commit** — `git commit -am "docs: data-entry spec §5.2 amendment — balance suggestions removed"`

---

## Phase 4 — Verification & merge

### Task 16: Full verification, spec status, merge

- [ ] **Step 1: Full backend suite** — `cd backend && .venv/Scripts/python -m pytest -q` → ALL PASS (record the count; expect prior 766 ± this plan's additions/removals).
- [ ] **Step 2: Alembic round-trip** (CI's drift guard, run locally):
```bash
cd backend && .venv/Scripts/python -m alembic upgrade head && .venv/Scripts/python -m alembic check && .venv/Scripts/python -m alembic downgrade 712243ee3ff3 && .venv/Scripts/python -m alembic upgrade head
```
Expected: no errors; `alembic check` reports no drift. (If `alembic check` is unavailable in this version, mirror `.github/workflows/ci.yml`'s exact commands.)
- [ ] **Step 3: Full frontend** — `npm test` (ALL PASS, record count), `npm run lint`, `npm run build` (clean; chunk advisory untouched).
- [ ] **Step 4: Grep sweeps** — all must be empty:
```bash
grep -rn "suggest_source" src backend/app backend/tests
grep -rn "fetchSuggestions\|SuggestionsOut\|SuggestionOut" src
grep -rn "fetchPeriods" src
grep -rn "PeriodInputs" backend
```
(The tax `suggested`/`derive_suggestions` vocabulary must still be present — `grep -rn "derive_suggestions" backend/app` returns the tax_service hits; do NOT remove those.)
- [ ] **Step 5: Update the spec status line** in `2026-08-23-espp-offerings-refactor-design.md` from "approved design, pre-implementation" to "implemented 2026-08-23 (branch espp-offerings-refactor)". Commit.
- [ ] **Step 6: Review pass** — dispatch the code-reviewer per subagent-driven-development over the whole branch diff (`git diff main...HEAD`), fix findings, re-run affected suites, commit fixes.
- [ ] **Step 7: Merge** — `git switch main && git merge --no-ff espp-offerings-refactor -m "merge: ESPP offerings refactor + balance-suggestions removal"`. Do NOT push; do NOT delete the branch (leave any cleanup for the user in the morning).
- [ ] **Step 8: Leave a summary** — final message lists: migrations added (a7c41e88f2d0, c9e2b7a4d113), test counts, chunk-size note, and the deploy note (prod runs add-then-drop of suggest_source in one boot; offerings table appears empty until the user enters 2023-09-01 / 2025-09-01 rows).
