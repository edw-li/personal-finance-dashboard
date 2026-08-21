# RSU Vesting Schedule + Withholding Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dashboard-only RSU grant tracking with a computed vest calendar on /comp, and a
current-year "Will I owe?" withholding-vs-liability tracker on /taxes that consumes it.

**Architecture:** One additive `rsu_grants` table (importer never touches it); vest schedules
computed at query time by a pure service; a second pure service estimates all-in withholding
(salary checks via `paycheck_calc`, vest supplemental 22%+10.23%, marginal FICA via the tax
engine's own bracket walks) against the engine's stored-inputs liability. Frontend: two new
cards on CompPage, one panel on TaxesPage, all figures server-computed and rendered verbatim.

**Tech Stack:** FastAPI + async SQLAlchemy + Alembic (backend/), React 19 + TS + ECharts (src/).
Spec: `docs/superpowers/specs/2026-08-21-rsu-vesting-withholding-design.md` — read it first.

**House laws that bind every task:** derived values are computed at read time, never stored;
GETs never 422/500 on stored data (degrade to null + warning); writers validate the WHOLE row
on POST and PATCH alike; the frontend renders server figures verbatim (global rule 9); percent
boxes hold percents and convert via `shiftPoint`; `ruff format` must stay clean (CI checks it);
tests run against the real `finance_test` Postgres via `cd backend && ./.venv/Scripts/python -m
pytest` (Windows venv path) and `npm test` at the repo root.

---

### Task 1: `rsu_grants` model + migration + importer pin test

**Files:**
- Modify: `backend/app/models/comp.py` (append model)
- Modify: `backend/app/models/__init__.py` (export `RsuGrant` — follow the existing import list style)
- Create: `backend/alembic/versions/<generated>_rsu_grants_table.py`
- Modify: `backend/tests/test_models_comp.py` (roundtrip test)
- Modify: `backend/tests/test_importer_apply.py` (pin test)

- [ ] **Step 1: Write the failing model roundtrip test** (append to `test_models_comp.py`, follow its existing fixture style):

```python
async def test_rsu_grant_roundtrip(db):
    from app.models import RsuGrant

    grant = RsuGrant(
        kind="new_hire",
        label="Offer letter",
        focal_year=None,
        shares=700,
        grant_price=Decimal("45.1200"),
        first_vest_date=date(2024, 9, 18),
        cliff_pct=Decimal("0.2500"),
        notes=None,
    )
    db.add(grant)
    await db.commit()
    row = (await db.execute(select(RsuGrant))).scalar_one()
    assert (row.kind, row.label, row.shares) == ("new_hire", "Offer letter", 700)
    assert row.cliff_pct == Decimal("0.2500")
    assert row.first_vest_date == date(2024, 9, 18)
```

- [ ] **Step 2: Run it — expect FAIL** (`ImportError: cannot import name 'RsuGrant'`):
`cd backend && ./.venv/Scripts/python -m pytest tests/test_models_comp.py -q`

- [ ] **Step 3: Add the model** to `backend/app/models/comp.py` (below `CompEvent`):

```python
class RsuGrant(Base):
    """Dashboard-only equity grants (2026-08-21 spec). NOT in the spreadsheet: the importer
    never reads or writes this table (pinned in test_importer_apply.py). Vest rows are never
    stored — rsu_vesting computes the schedule from these parameters at read time."""

    __tablename__ = "rsu_grants"

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(10))  # 'new_hire' | 'refresh' (API-validated)
    label: Mapped[str] = mapped_column(String(60), unique=True)
    focal_year: Mapped[int | None] = mapped_column()
    shares: Mapped[int] = mapped_column()  # whole shares by definition
    grant_price: Mapped[Decimal] = mapped_column(Numeric(14, 4))
    first_vest_date: Mapped[date] = mapped_column(Date)
    cliff_pct: Mapped[Decimal] = mapped_column(Numeric(7, 4))
    notes: Mapped[str | None] = mapped_column(Text)
```

Export it from `backend/app/models/__init__.py` alongside the other comp models.

- [ ] **Step 4: Write the migration.** First verify the head is `b3d47a1c9e62`
(`cd backend && ./.venv/Scripts/python -m alembic heads`). Then create the revision file by
hand following `20260820_1200_b3d47a1c9e62_dividend_source_and_auto_event_columns.py`'s
header style (new revision id via `./.venv/Scripts/python -m alembic revision -m "rsu grants table"`,
then edit):

```python
def upgrade() -> None:
    op.create_table(
        "rsu_grants",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("kind", sa.String(length=10), nullable=False),
        sa.Column("label", sa.String(length=60), nullable=False, unique=True),
        sa.Column("focal_year", sa.Integer(), nullable=True),
        sa.Column("shares", sa.Integer(), nullable=False),
        sa.Column("grant_price", sa.Numeric(14, 4), nullable=False),
        sa.Column("first_vest_date", sa.Date(), nullable=False),
        sa.Column("cliff_pct", sa.Numeric(7, 4), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("rsu_grants")
```

- [ ] **Step 5: Write the failing importer pin test** (append to `test_importer_apply.py`,
mirroring `test_importer_never_writes_dividends` — same fixture workbook, same structure):

```python
async def test_importer_never_writes_rsu_grants(db, workbook_path):
    from app.models import RsuGrant

    db.add(
        RsuGrant(
            kind="refresh", label="2025 focal", focal_year=2025, shares=480,
            grant_price=Decimal("121.5000"), first_vest_date=date(2025, 6, 18),
            cliff_pct=Decimal("0.0625"), notes="pre-import row",
        )
    )
    await db.commit()
    await run_import(db, workbook_path, dry_run=False)  # use the file's existing helper name
    rows = list((await db.execute(select(RsuGrant))).scalars())
    assert len(rows) == 1
    assert (rows[0].label, rows[0].shares, rows[0].notes) == ("2025 focal", 480, "pre-import row")
```

Adapt the apply invocation/fixture names to what `test_importer_apply.py` actually uses — read
it first; the assertion (exactly the pre-seeded row, untouched) is the contract.

- [ ] **Step 6: Run the suite files, expect PASS** (migration applies via conftest rebuild):
`./.venv/Scripts/python -m pytest tests/test_models_comp.py tests/test_importer_apply.py -q`

- [ ] **Step 7: `alembic check` clean** (`./.venv/Scripts/python -m alembic check`, cwd=backend),
then commit: `git add -A && git commit -m "feat: rsu_grants table — dashboard-only, importer-immune (pinned)"`

---

### Task 2: `rsu_vesting` pure service

**Files:**
- Create: `backend/app/services/rsu_vesting.py`
- Create: `backend/tests/test_rsu_vesting.py`

- [ ] **Step 1: Write the failing tests** (hand-verified expectations — do not "fix" them):

```python
from datetime import date
from decimal import Decimal

import pytest

from app.services.rsu_vesting import (
    schedule, third_wednesday, vest_count, vest_dates, vest_shares,
)


def test_third_wednesday_known_dates():
    assert third_wednesday(2024, 9) == date(2024, 9, 18)   # Sep 1 2024 is a Sunday
    assert third_wednesday(2025, 6) == date(2025, 6, 18)
    assert third_wednesday(2025, 1) == date(2025, 1, 15)   # Jan 1 2025 IS a Wednesday
    assert third_wednesday(2025, 12) == date(2025, 12, 17)
    assert third_wednesday(2026, 3) == date(2026, 3, 18)
    assert third_wednesday(2026, 6) == date(2026, 6, 17)
    assert third_wednesday(2026, 9) == date(2026, 9, 16)
    assert third_wednesday(2026, 12) == date(2026, 12, 16)
    assert third_wednesday(2027, 3) == date(2027, 3, 17)


def test_vest_count_by_cliff():
    assert vest_count(Decimal("0.25")) == 13     # new-hire: 25% + 12 x 6.25%
    assert vest_count(Decimal("0.0625")) == 16   # refresh: 16 x 6.25%
    assert vest_count(Decimal("1")) == 1         # degenerate single-vest grant is legal
    with pytest.raises(ValueError):
        vest_count(Decimal("0.30"))              # (1 - 0.30) / 0.0625 = 11.2


def test_vest_dates_quarterly_grid_from_first_vest():
    dates = vest_dates(date(2024, 9, 18), 5)
    # First vest verbatim, then 3rd Wednesdays of month+3k.
    assert dates == [
        date(2024, 9, 18), date(2024, 12, 18), date(2025, 3, 19),
        date(2025, 6, 18), date(2025, 9, 17),
    ]


def test_vest_dates_respects_off_convention_first_vest():
    # A stored first vest that is NOT a 3rd Wednesday stays verbatim; later vests snap to grid.
    dates = vest_dates(date(2025, 6, 2), 2)
    assert dates == [date(2025, 6, 2), date(2025, 9, 17)]


def test_vest_shares_refresh_alternates_62_63():
    shares = vest_shares(1000, Decimal("0.0625"))
    assert shares == [62, 63] * 8
    assert sum(shares) == 1000


def test_vest_shares_new_hire_cliff_then_quarterly():
    shares = vest_shares(700, Decimal("0.25"))
    assert shares == [175, 43, 44, 44, 44, 43, 44, 44, 44, 43, 44, 44, 44]
    assert sum(shares) == 700


def test_vest_shares_conserves_prime_totals():
    shares = vest_shares(997, Decimal("0.0625"))
    assert len(shares) == 16
    assert sum(shares) == 997
    assert all(s >= 0 for s in shares)


def test_schedule_zips_dates_and_shares():
    class Grant:
        shares = 320
        cliff_pct = Decimal("0.0625")
        first_vest_date = date(2025, 6, 18)

    events = schedule(Grant())
    assert len(events) == 16
    assert events[0] == (date(2025, 6, 18), 20)
    assert events[-1][0] == date(2029, 3, 21)  # Mar 2029: Mar 1 is a Thursday -> 3rd Wed = 21st
    assert sum(s for _, s in events) == 320
```

- [ ] **Step 2: Run, expect FAIL** (`ModuleNotFoundError`):
`./.venv/Scripts/python -m pytest tests/test_rsu_vesting.py -q`

- [ ] **Step 3: Implement** `backend/app/services/rsu_vesting.py`:

```python
"""Computed RSU vest schedules (2026-08-21 spec §3). Pure module — no DB, no HTTP, no clock
(tax_whatif's posture). Whole-share tranches by CUMULATIVE FLOOR so every grant's vests sum
exactly to its share count; dates ride the 3rd-Wednesday quarterly grid the user's grants use,
except the stored first_vest_date, which is always taken verbatim (off-convention grants stay
expressible)."""

from datetime import date
from decimal import Decimal

ONE = Decimal("1")
QUARTERLY_STEP = Decimal("0.0625")  # 6.25% — exact at Numeric(7,4)


def third_wednesday(year: int, month: int) -> date:
    """weekday(): Monday=0 ... Wednesday=2."""
    offset = (2 - date(year, month, 1).weekday()) % 7
    return date(year, month, 1 + offset + 14)


def vest_count(cliff_pct: Decimal) -> int:
    """1 cliff vest + the 6.25% quarterlies that finish the grant. Raises ValueError when
    (1 - cliff) does not divide evenly — the API maps that to a 422."""
    remainder = ONE - cliff_pct
    if remainder < 0 or remainder % QUARTERLY_STEP != 0:
        raise ValueError("(1 - cliff_pct) must be a whole number of 6.25% steps")
    return 1 + int(remainder / QUARTERLY_STEP)


def vest_dates(first_vest_date: date, count: int) -> list[date]:
    """First vest verbatim; vest k is the 3rd Wednesday of month(first) + 3(k-1)."""
    serial = first_vest_date.year * 12 + (first_vest_date.month - 1)
    dates = [first_vest_date]
    for k in range(1, count):
        month_serial = serial + 3 * k
        dates.append(third_wednesday(month_serial // 12, month_serial % 12 + 1))
    return dates


def vest_shares(total: int, cliff_pct: Decimal) -> list[int]:
    """Cumulative floor: vest_k = floor(total x cum%_k) - already vested. The last cumulative
    percentage is exactly 1, so the sum is conserved by construction."""
    count = vest_count(cliff_pct)
    shares: list[int] = []
    vested = 0
    for k in range(count):
        cum_pct = cliff_pct + QUARTERLY_STEP * k
        cum_shares = int(total * cum_pct)  # positive Decimals: int() truncation IS floor
        shares.append(cum_shares - vested)
        vested = cum_shares
    return shares


def schedule(grant) -> list[tuple[date, int]]:
    """(date, shares) per vest for a grant-shaped object (shares, cliff_pct, first_vest_date)."""
    counts = vest_shares(grant.shares, grant.cliff_pct)
    return list(zip(vest_dates(grant.first_vest_date, len(counts)), counts, strict=True))
```

- [ ] **Step 4: Run, expect PASS**, then commit:
`git add -A && git commit -m "feat: rsu_vesting — 3rd-Wednesday grid + cumulative-floor tranches"`

---

### Task 3: grants CRUD API + schemas

**Files:**
- Modify: `backend/app/schemas/comp.py` (append grant schemas)
- Modify: `backend/app/api/comp.py` (append routes + validation)
- Create: `backend/tests/test_rsu_api.py`

- [ ] **Step 1: Append schemas** to `backend/app/schemas/comp.py`:

```python
class RsuGrantIn(BaseModel):
    kind: str
    label: str
    focal_year: int | None = None
    shares: int
    grant_price: Decimal
    first_vest_date: date
    cliff_pct: Decimal
    notes: str | None = None


class RsuGrantUpdate(BaseModel):
    # kind/label/shares/grant_price/first_vest_date/cliff_pct are NOT NULL: explicit null is
    # the house no-op on those. focal_year and notes are nullable: their null really CLEARS.
    kind: str | None = None
    label: str | None = None
    focal_year: int | None = None
    shares: int | None = None
    grant_price: Decimal | None = None
    first_vest_date: date | None = None
    cliff_pct: Decimal | None = None
    notes: str | None = None


class RsuGrantOut(BaseModel):
    id: int
    kind: str
    label: str
    focal_year: int | None
    shares: int
    grant_price: Decimal
    first_vest_date: date
    cliff_pct: Decimal
    notes: str | None
    # --- computed (rsu_vesting)
    vest_count: int
    vested_shares: int
    unvested_shares: int
```

(`from datetime import date` — the module needs it; check imports.)

- [ ] **Step 2: Write failing CRUD tests** in `backend/tests/test_rsu_api.py`. Follow
`test_paycheck_comp_api.py`'s client/auth fixture style. Cover exactly:

```text
- POST /comp/rsu-grants -> 201; echo carries vest_count 13 for cliff 0.25, vested/unvested
  split judged against scheduler.product_today() (seed first_vest_date in the past so
  vested_shares > 0 deterministically).
- POST duplicate label -> 409 "a grant labeled ... already exists".
- POST kind "bogus" -> 422; shares 0 -> 422; shares 2.5 (send as JSON number) -> 422 pydantic;
  cliff 0.30 -> 422 naming the 6.25% rule; grant_price -1 -> 422; focal_year 1800 -> 422.
- PATCH: shares-only change re-echoes recomputed vest fields; explicit null focal_year clears
  it; explicit null shares is a no-op (unchanged echo).
- DELETE -> 204 then GET list omits it; DELETE unknown id -> 404.
- GET /comp/rsu-grants ordered by (first_vest_date, id).
```

Write every one as a real test function with literal request bodies and exact expected values
(e.g. `assert body["vest_count"] == 13`, `assert body["vested_shares"] + body["unvested_shares"] == 700`).

- [ ] **Step 3: Run, expect FAIL (404s)**, then implement in `backend/app/api/comp.py`:

Validation helper (whole-row, `_validated_event`'s posture):

```python
GRANT_KINDS = ("new_hire", "refresh")
GRANT_SHARES_MAX = 10**8


def _validated_grant(
    kind: str, label: str, focal_year: int | None, shares: int,
    grant_price: Decimal, first_vest_date: date, cliff_pct: Decimal,
) -> dict:
    if kind not in GRANT_KINDS:
        raise HTTPException(status_code=422, detail="kind must be 'new_hire' or 'refresh'")
    clean_label = label.strip()
    if not clean_label:
        raise HTTPException(status_code=422, detail="label must not be blank")
    if focal_year is not None and not MIN_FOCAL_YEAR <= focal_year <= MAX_FOCAL_YEAR:
        raise HTTPException(
            status_code=422,
            detail=f"focal_year must be between {MIN_FOCAL_YEAR} and {MAX_FOCAL_YEAR}",
        )
    if not 1 <= shares <= GRANT_SHARES_MAX:
        raise HTTPException(status_code=422, detail=f"shares must be between 1 and {GRANT_SHARES_MAX}")
    price = quantize_price(grant_price, "grant_price", max_abs=MONEY_MAX_ABS_14_4) + ZERO
    if grant_price <= 0 or price <= 0:
        raise HTTPException(status_code=422, detail="grant_price must be positive")
    quantized_cliff = cliff_pct.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
    if not 0 < quantized_cliff <= 1:
        raise HTTPException(status_code=422, detail="cliff_pct must be in (0, 1]")
    try:
        vest_count(quantized_cliff)
    except ValueError:
        raise HTTPException(
            status_code=422,
            detail="cliff_pct must leave a whole number of 6.25% quarterly vests",
        ) from None
    return {
        "kind": kind, "label": clean_label, "focal_year": focal_year, "shares": shares,
        "grant_price": price, "first_vest_date": first_vest_date, "cliff_pct": quantized_cliff,
    }
```

Echo helper (computed fields; `today` from `scheduler.product_today()` at the route, passed in
so the helper stays pure):

```python
def _grant_out(grant: RsuGrant, today: date) -> RsuGrantOut:
    events = rsu_vesting.schedule(grant)
    vested = sum(s for d, s in events if d <= today)
    return RsuGrantOut(
        id=grant.id, kind=grant.kind, label=grant.label, focal_year=grant.focal_year,
        shares=grant.shares, grant_price=grant.grant_price,
        first_vest_date=grant.first_vest_date, cliff_pct=grant.cliff_pct, notes=grant.notes,
        vest_count=len(events), vested_shares=vested, unvested_shares=grant.shares - vested,
    )
```

Routes: `GET /rsu-grants` (order `first_vest_date, id`), `POST /rsu-grants` (409 on taken label:
`f"a grant labeled {label!r} already exists"`), `PATCH /rsu-grants/{grant_id}` (merge via the
file's `_merged` for NOT NULL columns; `provided.get(...)` for focal_year/notes; re-validate the
whole merged row; re-check label uniqueness only when it changed), `DELETE /rsu-grants/{grant_id}`
(204). All on the existing comp `router`, `IdPath` for ids.

- [ ] **Step 4: Run test_rsu_api.py + the whole comp/paycheck file, expect PASS**:
`./.venv/Scripts/python -m pytest tests/test_rsu_api.py tests/test_paycheck_comp_api.py -q`

- [ ] **Step 5: Commit**: `git add -A && git commit -m "feat: /comp/rsu-grants CRUD — whole-row validation, computed vest echo"`

---

### Task 4: vesting-schedule endpoint

**Files:**
- Modify: `backend/app/schemas/comp.py` (schedule payload shapes)
- Modify: `backend/app/api/comp.py` (GET /comp/vesting-schedule)
- Modify: `backend/tests/test_rsu_api.py` (schedule tests)

- [ ] **Step 1: Append schemas**:

```python
# Field named vest_date, NOT date: a field literally named `date` shadows the datetime.date
# annotation inside the class body (the reason PricePoint uses `d`/`c`).
class VestOut(BaseModel):
    vest_date: date
    grant_id: int
    label: str
    shares: int
    fmv: Decimal | None       # stored close on-or-before the vest date; null when none
    value: Decimal | None     # fmv x shares, 2dp; null when fmv is
    is_past: bool


class NextVestOut(BaseModel):
    vest_date: date
    shares: int
    est_value: Decimal | None  # at the latest quote


class VestingTilesOut(BaseModel):
    next_vest: NextVestOut | None
    unvested_shares: int
    unvested_value: Decimal | None
    vested_this_year_shares: int
    vested_this_year_income: Decimal | None


class SeedCandidateOut(BaseModel):
    focal_year: int
    shares: Decimal            # comp_events.refresh_rsus verbatim (form prefill; API enforces int)
    grant_price: Decimal
    suggested_first_vest_date: date
    suggested_label: str


class VestingScheduleOut(BaseModel):
    ticker: str | None
    latest_price: Decimal | None
    quoted_at: datetime | None
    grants: list[RsuGrantOut]
    vests: list[VestOut]
    tiles: VestingTilesOut
    seed_candidates: list[SeedCandidateOut]
    drift_warnings: list[str]
    warnings: list[str]
```

- [ ] **Step 2: Write failing schedule tests** in `test_rsu_api.py` — seed via the API +
direct model inserts (Security "NVDA", `app_settings['espp_ticker']={"value":"NVDA"}`,
`LatestPrice`, a few `PriceHistory` bars straddling vest dates, a `CompEvent` with
refresh_rsus/grant_price). Pin exactly:

```text
- fmv resolution: a vest dated between two bars gets the OLDER bar's close; a vest before all
  bars gets fmv null AND a warning naming its date; value == fmv x shares at 2dp.
- tiles: next_vest is the earliest future vest; unvested_value == unvested_shares x latest
  quote (2dp); vested_this_year_income sums only past in-year priced vests.
- seed_candidates: a comp_event with refresh_rsus+grant_price and NO grant for that
  focal_year appears with suggested_first_vest_date == third Wednesday of its June and
  suggested_label "{year} focal"; creating a grant with that focal_year removes it.
- drift_warnings: grant(focal_year=2025, shares=480) vs event(refresh_rsus=500) -> one string
  naming the year and both numbers; equal values -> none.
- no espp_ticker configured -> ticker null, tiles null-ish (unvested_value null), one warning,
  status still 200.
```

- [ ] **Step 3: Implement** `GET /comp/vesting-schedule` in `api/comp.py`. Structure:

```python
@router.get("/vesting-schedule", response_model=VestingScheduleOut)
async def vesting_schedule(db: AsyncSession = Depends(get_db)) -> VestingScheduleOut:
    today = product_today()
    warnings: list[str] = []
    ticker, latest_price, quoted_at = await _espp_quote(db)   # from app.api.espp
    if ticker is None:
        warnings.append("no ESPP/employer ticker configured — vest values are unavailable")
    grants = list(
        (await db.execute(select(RsuGrant).order_by(RsuGrant.first_vest_date, RsuGrant.id)))
        .scalars()
    )
    # One bar query for the employer security; resolve per-vest via bisect on sorted dates.
    bars: list[tuple[date, Decimal]] = []
    if ticker is not None:
        security = (
            (await db.execute(select(Security).where(Security.ticker == ticker))).scalars().first()
        )
        if security is not None:
            rows = await db.execute(
                select(PriceHistory.price_date, PriceHistory.close)
                .where(PriceHistory.security_id == security.id)
                .order_by(PriceHistory.price_date)
            )
            bars = [(r[0], r[1]) for r in rows.all()]
```

Then: build `vests` (each grant's `rsu_vesting.schedule`, merged and sorted by (date, grant_id));
per PAST vest `fmv` = close of the newest bar dated ≤ vest date (`bisect_right` on the dates
list; None when no bar qualifies → warning `f"vest on {d} has no stored price — value unknown"`,
deduped); `value = (fmv * shares).quantize(Decimal("0.01"), ROUND_HALF_UP)`. Future vests carry
`fmv=None, value=None` (the tiles/chart price them at the latest quote instead). Tiles: next
future vest (est_value at `latest_price`, null-safe); unvested totals; vested-this-year over
past vests with `d.year == today.year` (income sums only priced ones). Seed candidates: comp
events where `refresh_rsus` and `grant_price` are both non-null and `refresh_rsus > 0` and no
grant carries that focal_year → `suggested_first_vest_date=third_wednesday(year, 6)`,
`suggested_label=f"{year} focal"`. Drift: for grants with focal_year matching an event that has
both fields, compare `Decimal(grant.shares) != event.refresh_rsus or grant.grant_price !=
event.grant_price` → `f"{year} focal grant ({grant.shares} sh @ {grant.grant_price}) no longer
matches focal history ({event.refresh_rsus} sh @ {event.grant_price})"`. Everything degrades to
null + warning; the route never raises on stored data.

- [ ] **Step 4: Run, expect PASS**; then run the whole backend suite once
(`./.venv/Scripts/python -m pytest -q`, ~4-6 min) — Tasks 1-4 are the backend surface of
feature 1 and must not have disturbed anything.

- [ ] **Step 5: Commit**: `git add -A && git commit -m "feat: GET /comp/vesting-schedule — computed vests, tiles, seeds, drift hints"`

---

### Task 5: `withholding_calc` pure service

**Files:**
- Create: `backend/app/services/withholding_calc.py`
- Create: `backend/tests/test_withholding_calc.py`

- [ ] **Step 1: Write the failing tests** (hand-verified numbers):

```python
from datetime import date
from decimal import Decimal

from app.services.withholding_calc import (
    WithholdingEstimate, check_dates, estimate,
)

D = Decimal

MEDICARE = [(D("0.0145"), D("0"))]
SS = [(D("0.062"), D("0")), (D("0"), D("168600"))]
SDI = [(D("0.011"), D("0"))]


class Profile:
    def __init__(self, effective, salary, periods=24, withholding=D("0.30"),
                 trad=D("0.05"), dv=D("50"), hsa=D("100")):
        self.effective_date = effective
        self.annual_salary = salary
        self.pay_periods_per_year = periods
        self.trad_401k_pct = trad
        self.roth_401k_pct = D("0")
        self.after_tax_401k_pct = D("0")
        self.espp_pct = D("0")
        self.withholding_pct = withholding
        self.dental_vision_per_check = dv
        self.hsa_per_check = hsa


def test_check_dates_grid_p24():
    dates = check_dates(2026, 24)
    assert len(dates) == 24
    assert dates[0] == date(2026, 1, 16)    # ceil(365/24) = 16
    assert dates[1] == date(2026, 1, 31)    # ceil(730/24) = 31
    assert dates[-1] == date(2026, 12, 31)  # ceil(24*365/24) = 365


def test_salary_leg_single_profile():
    # gross 10000; taxable 10000 - (500 + 50 + 100) = 9350; withholding/check 2805.
    # July 1 is day 182; checks land on ceil(15.2083 x i): i=11 -> day 168, i=12 -> day 183.
    result = estimate(
        year=2026, today=date(2026, 7, 1),
        profiles=[Profile(date(2025, 1, 1), D("240000"))],
        past_vests=[], future_vests=[],
        medicare=MEDICARE, social_security=SS, disability=SDI,
    )
    assert result.checks_elapsed == 11
    assert result.checks_total == 24
    assert result.salary_ytd == D("30855.00")       # 11 x 2805
    assert result.salary_projected == D("67320.00")  # 24 x 2805


def test_salary_leg_profile_switch_mid_year():
    # Raise effective Jul 1: checks implied on/after Jul 1 use the new profile.
    result = estimate(
        year=2026, today=date(2026, 12, 31),
        profiles=[Profile(date(2025, 1, 1), D("240000")),
                  Profile(date(2026, 7, 1), D("360000"))],
        past_vests=[], future_vests=[],
        medicare=MEDICARE, social_security=SS, disability=SDI,
    )
    # New gross 15000; taxable 15000 - (750 + 50 + 100) = 14100; withholding 4230.
    # Checks 1-11 (days 16..168) old profile; checks 12-24 (days 183..365) new: 11x2805 + 13x4230.
    assert result.salary_projected == D("85845.00")


def test_vest_legs_supplemental_and_marginal_fica():
    # One past vest: 100 sh @ 500 = 50000 income. Salary gross YTD: 11 checks x 10000 = 110000.
    # Supplemental: 50000 x 0.3223 = 16115. Marginal FICA on top of 110000:
    #   medicare 50000 x 0.0145 = 725
    #   ss: min(160000,168600)x0.062 - 110000x0.062 = 9920 - 6820 = 3100
    #   sdi 50000 x 0.011 = 550                      -> 4375 total
    result = estimate(
        year=2026, today=date(2026, 7, 1),
        profiles=[Profile(date(2025, 1, 1), D("240000"))],
        past_vests=[(date(2026, 6, 17), 100, D("500"))],
        future_vests=[(date(2026, 9, 16), 100, D("520"))],
        medicare=MEDICARE, social_security=SS, disability=SDI,
    )
    assert result.vest_income_ytd == D("50000.00")
    assert result.vest_supplemental_ytd == D("16115.00")
    assert result.vest_fica_ytd == D("4375.00")
    # Projection adds the future vest at its given price (52000) on top of full-year salary
    # gross 240000: ss cap bites — ss marginal = (168600-... ) compute:
    #   full salary gross = 240000 (24 checks x 10000); vest income total = 102000
    #   FICA(240000) ss = 168600x0.062 = 10453.20 (capped); FICA(342000) ss = 10453.20 -> ss marginal 0
    #   medicare marginal = 102000 x 0.0145 = 1479; sdi marginal = 102000 x 0.011 = 1122
    assert result.vest_income_projected == D("102000.00")
    assert result.vest_supplemental_projected == D("32874.60")  # 102000 x 0.3223
    assert result.vest_fica_projected == D("2601.00")           # 1479 + 1122 + 0


def test_no_profiles_degrades_with_warning():
    result = estimate(
        year=2026, today=date(2026, 7, 1), profiles=[],
        past_vests=[], future_vests=[],
        medicare=MEDICARE, social_security=SS, disability=SDI,
    )
    assert result.salary_ytd == D("0.00")
    assert result.checks_total == 0
    assert any("paycheck profile" in w for w in result.warnings)
```

- [ ] **Step 2: Run, expect FAIL**, then implement `backend/app/services/withholding_calc.py`:

```python
"""All-in withholding estimate for the current year (2026-08-21 spec §5). Pure module — the
router feeds profiles, vest tuples, bracket tables and `today`; nothing here reads a clock or
the DB. The salary leg reuses paycheck_calc.breakdown so the % applies to the TAXABLE base
(gross minus pre-tax deductions), exactly like the real check; vest legs add the supplemental
rates plus MARGINAL FICA computed with the tax engine's own bracket walk, so the SS wage-base
cap (a terminal 0-rate bracket) and additional Medicare interact with salary+vest totals for
free. Salary-side FICA is NOT added anywhere: the user's all-in withholding_pct already
carries it (user decision, 2026-08-21)."""

from calendar import isleap
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from app.services.paycheck_calc import breakdown
from app.services.tax_service import Bracket, walk

ZERO = Decimal("0")
CENT = Decimal("0.01")
FED_SUPPLEMENTAL = Decimal("0.22")    # federal supplemental rate (under $1M cumulative)
CA_SUPPLEMENTAL = Decimal("0.1023")   # CA stock/bonus supplemental rate
NO_PROFILES_WARNING = "no paycheck profile stored — salary withholding estimated as 0"
EARLY_CHECKS_WARNING = "checks before the first profile's effective date use that profile"

# (vest date, shares, price) — past vests carry the vest-date FMV, future ones a quote.
VestTuple = tuple[date, int, Decimal]


@dataclass
class WithholdingEstimate:
    checks_elapsed: int
    checks_total: int
    salary_ytd: Decimal
    salary_projected: Decimal
    salary_gross_ytd: Decimal
    salary_gross_projected: Decimal
    vest_income_ytd: Decimal
    vest_income_projected: Decimal
    vest_supplemental_ytd: Decimal
    vest_supplemental_projected: Decimal
    vest_fica_ytd: Decimal
    vest_fica_projected: Decimal
    warnings: list[str] = field(default_factory=list)


def check_dates(year: int, periods: int) -> list[date]:
    """Check i (1..P) implied on day ceil(i x days_in_year / P) — deterministic, ~semi-monthly
    at P=24, always ending Dec 31. Integer ceil: -(-a // b)."""
    days = 366 if isleap(year) else 365
    jan1 = date(year, 1, 1)
    return [jan1 + timedelta(days=-(-i * days // periods) - 1) for i in range(1, periods + 1)]


def _cents(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP) + ZERO


def estimate(
    *, year: int, today: date,
    profiles: list,  # paycheck_profiles rows, any order
    past_vests: list[VestTuple], future_vests: list[VestTuple],
    medicare: list[Bracket], social_security: list[Bracket], disability: list[Bracket],
) -> WithholdingEstimate:
    warnings: list[str] = []
    ordered = sorted(profiles, key=lambda p: p.effective_date)
    if not ordered:
        warnings.append(NO_PROFILES_WARNING)
        salary_ytd = salary_projected = gross_ytd = gross_projected = ZERO
        elapsed = total = 0
    else:
        current = [p for p in ordered if p.effective_date <= today] or [ordered[0]]
        grid = check_dates(year, current[-1].pay_periods_per_year)
        total = len(grid)
        if ordered[0].effective_date > grid[0]:
            warnings.append(EARLY_CHECKS_WARNING)
        salary_ytd = salary_projected = gross_ytd = gross_projected = ZERO
        elapsed = 0
        for check_day in grid:
            in_force = [p for p in ordered if p.effective_date <= check_day] or [ordered[0]]
            lines = breakdown(in_force[-1])
            salary_projected += lines["withholding"]
            gross_projected += lines["gross"]
            if check_day <= today:
                elapsed += 1
                salary_ytd += lines["withholding"]
                gross_ytd += lines["gross"]

    def fica(wages: Decimal) -> Decimal:
        return walk(medicare, wages) + walk(social_security, wages) + walk(disability, wages)

    income_ytd = sum((Decimal(s) * price for _, s, price in past_vests), ZERO)
    income_projected = income_ytd + sum(
        (Decimal(s) * price for _, s, price in future_vests), ZERO
    )
    supplemental = FED_SUPPLEMENTAL + CA_SUPPLEMENTAL
    return WithholdingEstimate(
        checks_elapsed=elapsed,
        checks_total=total,
        salary_ytd=_cents(salary_ytd),
        salary_projected=_cents(salary_projected),
        salary_gross_ytd=_cents(gross_ytd),
        salary_gross_projected=_cents(gross_projected),
        vest_income_ytd=_cents(income_ytd),
        vest_income_projected=_cents(income_projected),
        vest_supplemental_ytd=_cents(income_ytd * supplemental),
        vest_supplemental_projected=_cents(income_projected * supplemental),
        vest_fica_ytd=_cents(fica(gross_ytd + income_ytd) - fica(gross_ytd)),
        vest_fica_projected=_cents(fica(gross_projected + income_projected) - fica(gross_projected)),
        warnings=warnings,
    )
```

- [ ] **Step 3: Run, expect PASS** (`./.venv/Scripts/python -m pytest tests/test_withholding_calc.py -q`).
If a hand-pinned number disagrees, re-derive it BY HAND before touching the implementation —
the expectations above were computed independently and are the contract.

- [ ] **Step 4: Commit**: `git add -A && git commit -m "feat: withholding_calc — check-grid salary leg + supplemental + marginal FICA"`

---

### Task 6: withholding endpoint

**Files:**
- Modify: `backend/app/schemas/taxes.py` (payload shapes)
- Modify: `backend/app/api/taxes.py` (GET /taxes/years/{year}/withholding)
- Create: `backend/tests/test_withholding_api.py`

- [ ] **Step 1: Append schemas** to `backend/app/schemas/taxes.py`:

```python
class WithholdingLegOut(BaseModel):
    ytd: Decimal
    projected: Decimal


class WithholdingVestOut(BaseModel):
    income_ytd: Decimal
    income_projected: Decimal
    supplemental_ytd: Decimal
    supplemental_projected: Decimal
    fica_ytd: Decimal
    fica_projected: Decimal


class SafeHarborOut(BaseModel):
    prior_year: int
    prior_total_tax: Decimal
    threshold: Decimal          # prior_total_tax x 1.10
    met: bool                   # projected total withholding >= threshold


class WithholdingOut(BaseModel):
    year: int
    liability_total: Decimal
    salary: WithholdingLegOut
    vest: WithholdingVestOut
    total: WithholdingLegOut
    balance_projected: Decimal  # liability - projected withholding; positive = will owe
    checks_elapsed: int
    checks_total: int
    safe_harbor: SafeHarborOut | None
    warnings: list[str]
```

- [ ] **Step 2: Write failing endpoint tests** in `test_withholding_api.py` (client fixtures
from `test_taxes_api.py`). Seed: a tax year with the SMALL bracket fixtures from Task 5's tests
+ minimal inputs (`latest_w2_income`); one paycheck profile; `espp_ticker` setting + Security +
LatestPrice + PriceHistory bars; two grants (one with past in-year vests, one future-only). Pin:

```text
- GET for a non-current year -> 422 "withholding tracking is only meaningful for the current
  year" (freeze "current" by monkeypatching app.api.taxes.product_today to a fixed date —
  import it there as `from app.services.scheduler import product_today` so the patch point is
  the taxes module).
- GET for a current year with no TaxYear row -> 404 (the _require_year sentence).
- Happy path: liability_total equals GET /taxes/years/{y}/summary's totals.total_tax verbatim;
  total.ytd == salary.ytd + vest.supplemental_ytd + vest.fica_ytd; balance_projected ==
  liability_total - total.projected (2dp); checks fields echo the service.
- Vest pricing: past vests use bar closes (assert an exact income_ytd from seeded bars);
  future vests use the latest quote; a past vest before all bars is EXCLUDED from income with
  a warning naming its date.
- safe_harbor: null when no prior TaxYear; with a prior year seeded (inputs+brackets),
  threshold == prior summary total_tax x 1.1 at 2dp and met reflects the comparison.
- No paycheck profiles -> salary leg zeros + the service's warning surfaces.
```

- [ ] **Step 3: Implement the route** in `api/taxes.py` (near get_summary; reuse its loaders):

```python
@router.get("/years/{year}/withholding", response_model=WithholdingOut)
async def get_withholding(year: YearPath, db: AsyncSession = Depends(get_db)) -> WithholdingOut:
    today = product_today()
    if year != today.year:
        raise HTTPException(
            status_code=422,
            detail="withholding tracking is only meaningful for the current year",
        )
    await _require_year(db, year)
    breakdown_now = compute_breakdown(year, await _stored_inputs(db, year), await _tables(db, year))
```

where `_tables(db, year)` is the summary path's existing bracket-loading (reuse the helper it
uses — read `get_summary` and call the same code; if it inlines, extract `_tables` so both
share it). Then: load profiles (`select(PaycheckProfile)`), build vest tuples from
`rsu_vesting.schedule` over all grants — past = in-year vests dated ≤ today with a bar close
(no close → warning + excluded), future = in-year vests dated > today priced at `_espp_quote`'s
latest price (no quote → excluded + warning). Call `withholding_calc.estimate`. Safe harbor:
if `TaxYear year-1` exists, run `compute_breakdown(year-1, ...)` on ITS stored inputs/tables;
`threshold = (prior.totals.total_tax * Decimal("1.10"))` at 2dp; `met = projected_total >=
threshold`. Assemble WithholdingOut with plain 2dp quantizes (`paycheck_calc.half_up2` style —
GETs never reject stored data). `total.ytd = salary_ytd + supplemental_ytd + fica_ytd`,
`total.projected` likewise; `balance_projected = liability_total - total.projected`.
`liability_total` uses the same quantize the summary uses for money.

- [ ] **Step 4: Run new file + the taxes suite, expect PASS**:
`./.venv/Scripts/python -m pytest tests/test_withholding_api.py tests/test_taxes_api.py -q`

- [ ] **Step 5: Full backend suite + ruff, expect green**
(`./.venv/Scripts/python -m pytest -q && ./.venv/Scripts/python -m ruff check . && ./.venv/Scripts/python -m ruff format --check .`),
then commit: `git add -A && git commit -m "feat: GET /taxes/years/{year}/withholding — all-in estimate vs engine liability"`

---

### Task 7: frontend types + API clients

**Files:**
- Modify: `src/types/api.ts`
- Modify: `src/api/comp.ts`
- Modify: `src/api/taxes.ts`

- [ ] **Step 1: Types** — mirror the backend schemas exactly (Decimals are STRINGS on the wire;
dates are ISO strings). Add to `src/types/api.ts`:

```ts
export interface RsuGrantOut {
  id: number
  kind: 'new_hire' | 'refresh'
  label: string
  focal_year: number | null
  shares: number
  grant_price: string
  first_vest_date: string
  cliff_pct: string
  notes: string | null
  vest_count: number
  vested_shares: number
  unvested_shares: number
}

export interface RsuGrantCreate {
  kind: 'new_hire' | 'refresh'
  label: string
  focal_year?: number | null
  shares: number
  grant_price: string
  first_vest_date: string
  cliff_pct: string
  notes?: string | null
}

export interface VestOut {
  vest_date: string
  grant_id: number
  label: string
  shares: number
  fmv: string | null
  value: string | null
  is_past: boolean
}

export interface VestingScheduleOut {
  ticker: string | null
  latest_price: string | null
  quoted_at: string | null
  grants: RsuGrantOut[]
  vests: VestOut[]
  tiles: {
    next_vest: { vest_date: string; shares: number; est_value: string | null } | null
    unvested_shares: number
    unvested_value: string | null
    vested_this_year_shares: number
    vested_this_year_income: string | null
  }
  seed_candidates: {
    focal_year: number
    shares: string
    grant_price: string
    suggested_first_vest_date: string
    suggested_label: string
  }[]
  drift_warnings: string[]
  warnings: string[]
}

export interface WithholdingOut {
  year: number
  liability_total: string
  salary: { ytd: string; projected: string }
  vest: {
    income_ytd: string
    income_projected: string
    supplemental_ytd: string
    supplemental_projected: string
    fica_ytd: string
    fica_projected: string
  }
  total: { ytd: string; projected: string }
  balance_projected: string
  checks_elapsed: number
  checks_total: number
  safe_harbor: {
    prior_year: number
    prior_total_tax: string
    threshold: string
    met: boolean
  } | null
  warnings: string[]
}
```

- [ ] **Step 2: Clients.** `src/api/comp.ts` gains:

```ts
export function fetchVestingSchedule(): Promise<VestingScheduleOut> {
  return api<VestingScheduleOut>('/comp/vesting-schedule')
}
export function createRsuGrant(body: RsuGrantCreate): Promise<RsuGrantOut> {
  return api<RsuGrantOut>('/comp/rsu-grants', { method: 'POST', body: JSON.stringify(body) })
}
export function updateRsuGrant(id: number, body: Partial<RsuGrantCreate>): Promise<RsuGrantOut> {
  return api<RsuGrantOut>(`/comp/rsu-grants/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
}
export function deleteRsuGrant(id: number): Promise<void> {
  return api<void>(`/comp/rsu-grants/${id}`, { method: 'DELETE' })
}
```

`src/api/taxes.ts` gains `fetchWithholding(year: number): Promise<WithholdingOut>` →
`api(`/taxes/years/${year}/withholding`)`.

- [ ] **Step 3:** `npm run lint && npx tsc -b --noEmit` clean (unused-export warnings are fine
until Tasks 8-9 consume them — if the linter complains about unused imports, defer the import
to the consuming task). Commit: `git add -A && git commit -m "feat: vesting + withholding API clients and wire types"`

---

### Task 8: Comp page — grants panel, schedule panel, chart

**Files:**
- Create: `src/components/comp/vestingChartOptions.ts` + `src/components/comp/vestingChartOptions.test.ts`
- Create: `src/components/comp/RsuGrantsPanel.tsx`
- Create: `src/components/comp/VestingSchedulePanel.tsx`
- Modify: `src/pages/CompPage.tsx`, `src/pages/CompPage.css`, `src/pages/CompPage.test.tsx`

- [ ] **Step 1: Chart builder + tests first.** `vestingChartOptions.ts` — pure builder
(`compChartOptions.ts` posture): input `(vests: VestOut[], grants: RsuGrantOut[], latestPrice:
string | null)`; output stacked bar option or null under 1 vest. X axis = vest dates
(`formatDate`), one bar series per grant in grant order on `PALETTE[i]` (>8 grants folds the
tail into one `OTHER_SERIES_COLOR` "Other" series — theme law), value per bar = `Number(v.value)`
for past vests, `shares × Number(latestPrice)` for future ones (null price → 0 with the series
omitted... no: omit FUTURE bars entirely when latestPrice is null — a zero would draw a lie).
Tooltip: axis trigger, currency valueFormatter (the house `'—'` null branch). `barMaxWidth: 22`,
`itemStyle: { borderColor: SURFACE, borderWidth: 1 }` (stack gap law). Tests pin: series-per-grant
count and colors; past-vs-future valuation; the null-quote omission; ≤1-vest null.

- [ ] **Step 2: RsuGrantsPanel.** EventsPanel's exact idiom (form doubles as add/edit, busy
single-flight, `startEdit` seeds the server's strings verbatim, delete confirms with the label).
Form fields: kind (`<select>` new_hire/refresh), label, focal year (blank → null), shares
(integer text box, `inputMode="numeric"`), grant price, first vest date (`type="date"`), notes.
`cliff_pct` is NOT a box: the client derives it from kind — `'new_hire' → '0.25'`, `'refresh' →
'0.0625'` — and sends it explicitly (spec §6); editing a grant keeps its stored cliff when the
kind is unchanged, re-derives when the user flips kind. Client-side fences before the POST
(house 422-saving posture): label required; shares a positive integer (`/^\d+$/`); price a
positive plain decimal (`isPlainDecimal`); first vest date required; focal year integer in
1990–2100 when present. Props: `{ grants, seedCandidates, onChanged }`. Seed candidates render
above the form as `.button` chips — "Add {suggested_label} — {shares} sh @ {price}" — clicking
PREFILLS the form (kind refresh, label/shares/price/focal year/suggested date), never POSTs.
Table columns: label, kind badge, focal year, shares, price, first vest, vests, vested,
unvested, notes (ellipsised + title), Edit/Delete.

- [ ] **Step 3: VestingSchedulePanel.** Props: `{ schedule: VestingScheduleOut }` (pure
display). Three StatTiles: "Next vest" (`formatDate(vest_date)` value, delta `${shares} sh ·
{formatCurrency(est_value)}`), "Unvested" (`formatShares` value + currency delta), "Vested this
year" (shares + income delta) — each with an InfoHint naming its pricing source. Then the chart
(Step 1 builder, memoized on `[schedule]`), then the vest table: Date, Grant, Shares, Price
(fmv for past / latest quote note for future), Value, and a `.badge` "next" on the first future
row; past rows get a muted class. Drift warnings + payload warnings render as `.hint`
paragraphs above the table. Empty state: "No grants yet — add one below to see the schedule."

- [ ] **Step 4: Page wiring.** CompPage adds a SECOND independent load (EsppPage's
multi-section pattern): `fetchVestingSchedule()` with own seq ref, busy flag, error banner
with Retry, `loading-dim` wrapper. Layout order: TC trajectory card (unchanged) →
VestingSchedulePanel (own card) → RsuGrantsPanel (own card) → EventsPanel (unchanged).
`RsuGrantsPanel.onChanged` → reload the schedule feed only (grants don't move comp events);
`EventsPanel.onChanged` continues reloading events AND now also the schedule (focal history
feeds seed candidates + drift). CSS: reuse `comp-form`/`comp-scroll` classes; add
`.vest-past td { color: var(--muted); }` in CompPage.css.

- [ ] **Step 5: Tests.** `CompPage.test.tsx` additions (mock the two new fetches like the
existing `fetchEvents` mock; EChart is already mocked there): schedule tiles render the
server's strings verbatim; seed chip prefills the form (assert the label box value); grant
create POSTs cliff `'0.25'` for kind new_hire; drift warning paragraph renders; schedule-feed
failure banners with Retry while the events card still renders. Run `npm test`, expect green.

- [ ] **Step 6: Commit**: `git add -A && git commit -m "feat: comp page — RSU grants CRUD, vesting schedule tiles/chart/table"`

---

### Task 9: Taxes page — WithholdingPanel

**Files:**
- Create: `src/components/taxes/WithholdingPanel.tsx` + `src/components/taxes/WithholdingPanel.test.tsx`
- Modify: `src/pages/TaxesPage.tsx`, `src/components/taxes/taxes.css`

- [ ] **Step 1: Panel.** Props `{ year: number }`. Fetches `fetchWithholding(year)` on mount
(promise-callback house recipe: seq ref, busy, error + Retry, previous payload kept on reload
failure with the stale cue). Renders:

- `kpi-row` of three StatTiles: "Projected tax — {year}" (`liability_total`); "Projected
  withholding" (`total.projected`, delta `${total.ytd} so far`); "Projected balance" — value
  `formatCurrency(abs(balance))` prefixed "owe"/"refund" via the label, tone
  `Number(balance_projected) > 0 ? 'negative' : Number(...) < 0 ? 'positive' : 'neutral'`
  (owing money is the bad direction), delta "at tax time". Hints: liability = "The tax
  engine's total on this year's stored inputs — keep them current."; withholding = "Salary
  checks at your all-in withholding % plus RSU vests at 22% federal + 10.23% CA + FICA.";
  balance = "Positive means projected withholding falls short of projected tax."
- A YTD sentence: `"{total.ytd} withheld so far · {checks_elapsed} of {checks_total} checks ·
  vest income so far {vest.income_ytd}"`.
- Safe-harbor line when present: `"Safe harbor (approx.): 110% of {prior_year}'s total tax is
  {threshold} — {met ? 'covered by projected withholding' : 'NOT covered by projected
  withholding'}"` as a `.hint` (plus an InfoHint: real safe harbor is per-jurisdiction; this
  compares all-in totals).
- Consistency hint: `"This year's vests imply ≈{vest.income_projected} of W-2 income at vest
  prices — make sure your W-2 inputs include it."` — rendered whenever income_projected > 0.
- Server `warnings[]` as hint paragraphs. All figures verbatim (global rule 9); the ONLY
  client math is the sign/abs on `balance_projected` for tone/label (display-only Number()).

- [ ] **Step 2: Wire into TaxesPage** directly under `<SummaryPanel …/>`:

```tsx
{detail.summary.year === new Date().getFullYear() && (
  <WithholdingPanel key={`withholding-${detail.summary.year}`} year={detail.summary.year} />
)}
```

(Client-side year gate mirrors the server's 422; the panel is keyed so a year switch remounts.)

- [ ] **Step 3: Tests.** Panel test with mocked `fetchWithholding`: tiles verbatim; owe tone
negative when balance positive and the label says "owe"; refund case; safe-harbor null hides
the line; warnings render; retry refetches. TaxesPage test: panel present for the current
year, ABSENT for a past year (freeze the current year via the payload year vs
`new Date().getFullYear()` — set the mocked selected year accordingly). Run `npm test`.

- [ ] **Step 4: Commit**: `git add -A && git commit -m "feat: taxes page — will-I-owe withholding tracker panel"`

---

### Task 10: Gates, docs, chunk check

**Files:**
- Modify: `README.md` (7.6 addendum)
- Verify: everything

- [ ] **Step 1: Full gates**, all must pass:

```bash
cd backend && ./.venv/Scripts/python -m pytest -q          # expect: prior count + new tests, 0 fail
./.venv/Scripts/python -m ruff check . && ./.venv/Scripts/python -m ruff format --check .
./.venv/Scripts/python -m alembic check                     # cwd=backend
cd .. && npm run lint                                       # 1 sanctioned AuthContext warning only
npm test                                                    # expect: 497+ passing
npm run build                                               # clean; note the EChart chunk size
```

- [ ] **Step 2: Chunk law.** The EChart chunk must be byte-identical (700.93 kB / 720 advisory)
— no new echarts registrations were made. If it moved, find what imported echarts outside
`src/charts/echarts.ts` and fix it.

- [ ] **Step 3: README 7.6 addendum** (dated blockquote, following the two existing ones):
one additive migration (`rsu_grants`) applies at boot; /comp gains RSU grants + vesting
schedule (dashboard-only — workbook imports never touch grants); /taxes gains the current-year
withholding tracker; spot-checks: /comp renders with zero grants, /taxes shows the tracker only
on the current year.

- [ ] **Step 4: Commit**: `git add -A && git commit -m "docs: README 7.6 addendum — rsu_grants migration + new panels"`
