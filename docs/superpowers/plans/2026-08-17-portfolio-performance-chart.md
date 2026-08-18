# Portfolio Performance Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import the workbook's weekly portfolio series (value / cost basis / S&P 500 baseline) into a new table, serve it via `GET /portfolio/history`, and render it as a shared 3-line ECharts card — with a pinging live final datapoint — on the Portfolio page (above Holdings) and the Overview page (replacing the allocation donut; all Overview charts become full-width rows).

**Architecture:** Spec: `docs/superpowers/specs/2026-08-17-portfolio-performance-chart-design.md`. Data flows importer → `portfolio_value_history` (upsert by `snapshot_date`, no deletes) → parallel-array endpoint → pure option builder consumed by both pages. The live point is frontend-only, derived from the holdings payload both pages already fetch.

**Tech Stack:** FastAPI + SQLAlchemy async + Alembic + openpyxl (backend, `backend/.venv`), React 19 + ECharts 6 (tree-shaken) + vitest (frontend).

**Environment notes:**
- Backend commands run from `backend/` using `.venv/Scripts/python.exe` / `.venv/Scripts/alembic.exe` (Windows venv). Backend tests need the dev Postgres running (same requirement as the existing suite; see README quickstart). Parser tests are pure and need no DB.
- Frontend commands run from the repo root: `npm test`, `npm run lint`, `npm run build`.
- House laws that apply throughout: chart colors come only from `src/charts/theme.ts` PALETTE slots in fixed order; echarts imports only via `src/charts/echarts.ts`; server decimals are strings on the wire and `Number()` is display-only; importer errors block the whole apply.

---

### Task 1: `portfolio_value_history` model + migration

**Files:**
- Modify: `backend/app/models/portfolio.py` (append at end)
- Modify: `backend/app/models/__init__.py`
- Modify: `backend/tests/test_models_portfolio.py` (append at end)
- Create: `backend/alembic/versions/<generated>_portfolio_value_history_table.py`

- [ ] **Step 1: Write the failing model test**

Append to `backend/tests/test_models_portfolio.py` (the file already imports `date`, `Decimal`, `pytest`, `select`, `IntegrityError`; extend the existing `from app.models import (...)` block with `PortfolioValueHistory`):

```python
async def test_portfolio_value_history_roundtrip_and_unique_date(db):
    row = PortfolioValueHistory(
        snapshot_date=date(2023, 10, 23),
        market_value=Decimal("53619.00"),
        cost_basis=Decimal("53619.00"),
        sp500_value=Decimal("53619.00"),
    )
    db.add(row)
    await db.commit()

    stored = (await db.execute(select(PortfolioValueHistory))).scalar_one()
    assert stored.market_value == Decimal("53619.00")
    assert stored.snapshot_date == date(2023, 10, 23)

    db.add(
        PortfolioValueHistory(
            snapshot_date=date(2023, 10, 23),
            market_value=Decimal("1.00"),
            cost_basis=Decimal("1.00"),
            sp500_value=Decimal("1.00"),
        )
    )
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()  # shared-session contract (conftest): unpoison after IntegrityError
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && .venv/Scripts/python.exe -m pytest tests/test_models_portfolio.py -v`
Expected: FAIL — `ImportError: cannot import name 'PortfolioValueHistory'`

- [ ] **Step 3: Add the model**

Append to `backend/app/models/portfolio.py`:

```python
class PortfolioValueHistory(Base):
    """The workbook's weekly portfolio series (Portfolio sheet, hidden cols AB..AH):
    imported verbatim, import-owned via upsert-by-date, never derived from transactions
    (most position rows are undated by design — see PositionTransaction.sort_index)."""

    __tablename__ = "portfolio_value_history"

    id: Mapped[int] = mapped_column(primary_key=True)
    # snapshot_date, NOT date — the same annotation-shadowing hazard PriceHistory
    # documents above; do not rename.
    snapshot_date: Mapped[date] = mapped_column(Date, unique=True)
    market_value: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    cost_basis: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    # The sheet's S&P 500 baseline: the STARTING balance benchmarked into VOO shares —
    # later contributions are not added to it (spec "S&P baseline semantics").
    sp500_value: Mapped[Decimal] = mapped_column(Numeric(14, 2))
```

In `backend/app/models/__init__.py`, extend the `from app.models.portfolio import (...)` block with `PortfolioValueHistory` (alphabetical: after `PositionTransaction`) and add `"PortfolioValueHistory"` to `__all__` (alphabetical: after `"PositionTransaction"`).

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && .venv/Scripts/python.exe -m pytest tests/test_models_portfolio.py -v`
Expected: PASS (conftest builds the schema via `Base.metadata.create_all`)

- [ ] **Step 5: Write the migration**

Scaffold (targets current head `e5b93d0a416f` automatically):

```bash
cd backend && .venv/Scripts/alembic.exe revision -m "portfolio value history table"
```

Fill the generated file's body (keep the generated `revision`/`down_revision`; ensure the imports match `20260813_0902_ceeb7cd91a22_portfolio_tables.py`, i.e. `import sqlalchemy as sa` and `from alembic import op`):

```python
def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "portfolio_value_history",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("snapshot_date", sa.Date(), nullable=False),
        sa.Column("market_value", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("cost_basis", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("sp500_value", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_portfolio_value_history")),
        sa.UniqueConstraint(
            "snapshot_date", name=op.f("uq_portfolio_value_history_snapshot_date")
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("portfolio_value_history")
```

- [ ] **Step 6: Verify the migration round-trips**

Run: `cd backend && .venv/Scripts/alembic.exe upgrade head && .venv/Scripts/alembic.exe downgrade -1 && .venv/Scripts/alembic.exe upgrade head`
Expected: three clean runs, no traceback; final state at the new head.

- [ ] **Step 7: Commit**

```bash
git add backend/app/models/portfolio.py backend/app/models/__init__.py backend/tests/test_models_portfolio.py backend/alembic/versions/*portfolio_value_history*
git commit -m "feat: portfolio_value_history table (model + additive migration)"
```

---

### Task 2: Parse the value-history region from the Portfolio sheet

**Files:**
- Modify: `backend/tests/workbook_builder.py` (`default_portfolio_rows`, lines 78–104)
- Modify: `backend/app/importer/parsers.py` (`_iter_rows` line 106; `ParsedPortfolio`/`parse_portfolio` lines 983–1011)
- Modify: `backend/tests/test_importer_parsers.py` (append tests)

**Region contract (verified against the real workbook 2026-08-17):** Portfolio sheet, rows 3+, columns AB(28)=date, AC(29)=market value, AD(30)=%Δ ignored, AE(31)=S&P baseline, AF(32)=%Δ ignored, AG(33)=cost basis, AH(34)=%Δ ignored. Rows 1–2 in that region hold header junk the parser never reads. Real data: 147 weekly rows; chart ranges are padded to row 2153, so scan bounded to `max_row=6000` with the blank-streak stop.

- [ ] **Step 1: Teach the workbook builder the history region**

Replace `default_portfolio_rows()` in `backend/tests/workbook_builder.py` with:

```python
def default_portfolio_rows() -> list[list]:
    header = [
        "Company Name",
        "Ticker",
        "Industry",
        "Shares",
        "Market Weight",
        "Current Price",
        "Daily Gain/Loss",
        "Daily Change %",
        "1yr Chart",
        "Cost Basis",
        "Market Value",
        "Unrealized Gain/Loss",
        "Unrealized Gain/Loss %",
        "XIRR",
        "Realized Gain/Loss",
        "Dividends Collected",
        "Total Gain/Loss",
    ]
    totals = [None, None, None, None, 1, None, 0, 0, None, 0, 0, 0, 0, 0, 0, 0, 0]

    def with_history(row: list, tail: list) -> list:
        """Pad a ticker-table row out to col 27, then lay the AB..AH region (cols 28-34)."""
        return row + [None] * (27 - len(row)) + tail

    # The hidden value-history region exactly as the real sheet lays it out: r1/r2 carry
    # region headers the parser never reads (min_row=3); float noise exercises Q2.
    return [
        with_history(header, [None, None, "VOO Price:", 713.61, None, None, None]),
        with_history(
            totals,
            ["Current Row:", 150, "Benchmarked Shares:", 138.797856643628, None, "Cost Basis", None],
        ),
        with_history(
            ["Acme ETF", "ACME", "ETF", 10, 0.5, 100.5, 0, 0, None, 0, 0, 0, 0, 0, 0, 0, 0],
            [datetime(2023, 10, 23), 53619.0, 0.0, 53619, 0.0, 53619, 0.0],
        ),
        with_history(
            ["Div Corp", "DIVC", "Financials", 5, 0.5, 20.0, 0, 0, None, 0, 0, 0, 0, 0, 0, 12.5, 0],
            [
                datetime(2023, 10, 30),
                53413.36244969999,
                -0.003835161982,
                53001.34954,
                -0.0115192462,
                55212.08872757,
                0.02971127264,
            ],
        ),
        with_history(
            [],
            [
                datetime(2023, 11, 6),
                63577.56194565128,
                0.1902931969,
                55548.29021,
                0.04805426072,
                62399.039886977764,
                0.1301698835,
            ],
        ),
    ]
```

(The ticker rows are byte-identical to the current ones — only the padding + tail are new. The fifth row is history-only: 27 `None`s then the tail, matching the real sheet where the series outruns the ticker table.)

- [ ] **Step 2: Write the failing parser tests**

Append to `backend/tests/test_importer_parsers.py` (the file already has `_sheet(name, **overrides)`, `default_portfolio_rows`, and `from datetime import ...`/`Decimal` imports at top — check and extend the import block if `date` or `Decimal` is missing):

```python
def test_parse_portfolio_extracts_value_history():
    from datetime import date
    from decimal import Decimal

    from app.importer.parsers import parse_portfolio

    parsed = parse_portfolio(_sheet("Portfolio"))
    assert parsed.issues.errors == []
    assert [p.snapshot_date for p in parsed.history] == [
        date(2023, 10, 23),
        date(2023, 10, 30),
        date(2023, 11, 6),
    ]
    # Q2 half-up quantization of the sheet's float noise
    assert parsed.history[1].market_value == Decimal("53413.36")
    assert parsed.history[1].sp500_value == Decimal("53001.35")
    assert parsed.history[1].cost_basis == Decimal("55212.09")
    assert parsed.history[2].market_value == Decimal("63577.56")
    # No "no value-history rows" warning when the region is populated
    assert not any("value-history" in w for w in parsed.issues.warnings)


def test_parse_portfolio_history_errors_on_values_without_date():
    from app.importer.parsers import parse_portfolio

    rows = default_portfolio_rows()
    rows[4][27] = None  # r5 col AB: date gone, values remain
    parsed = parse_portfolio(_sheet("Portfolio", portfolio=rows))
    assert any("r5c28" in e and "no date" in e for e in parsed.issues.errors)


def test_parse_portfolio_history_errors_on_missing_or_junk_value():
    from app.importer.parsers import parse_portfolio

    rows = default_portfolio_rows()
    rows[3][32] = None  # r4 col AG (cost basis) blank
    parsed = parse_portfolio(_sheet("Portfolio", portfolio=rows))
    assert any("r4c33" in e for e in parsed.issues.errors)

    rows = default_portfolio_rows()
    rows[3][28] = "#N/A"  # r4 col AC (market value): silent-None error string
    parsed = parse_portfolio(_sheet("Portfolio", portfolio=rows))
    assert any("r4c29" in e for e in parsed.issues.errors)

    rows = default_portfolio_rows()
    rows[3][28] = "abc"  # non-numeric: to_decimal's own error, not doubled
    parsed = parse_portfolio(_sheet("Portfolio", portfolio=rows))
    assert len([e for e in parsed.issues.errors if "r4c29" in e]) == 1


def test_parse_portfolio_history_errors_on_non_increasing_dates():
    from app.importer.parsers import parse_portfolio

    rows = default_portfolio_rows()
    rows[4][27] = datetime(2023, 10, 30)  # r5 duplicates r4's date
    parsed = parse_portfolio(_sheet("Portfolio", portfolio=rows))
    assert any("r5c28" in e and "not after" in e for e in parsed.issues.errors)

    rows = default_portfolio_rows()
    rows[4][27] = datetime(2023, 10, 1)  # r5 goes backwards
    parsed = parse_portfolio(_sheet("Portfolio", portfolio=rows))
    assert any("r5c28" in e and "not after" in e for e in parsed.issues.errors)


def test_parse_portfolio_history_empty_region_warns_not_errors():
    from app.importer.parsers import parse_portfolio

    rows = [row[:27] for row in default_portfolio_rows()]  # strip the AB..AH region
    parsed = parse_portfolio(_sheet("Portfolio", portfolio=rows))
    assert parsed.issues.errors == []
    assert parsed.history == []
    assert any("no value-history rows" in w for w in parsed.issues.warnings)


def test_parse_portfolio_history_continues_across_short_blank_gaps():
    from datetime import date

    from app.importer.parsers import parse_portfolio

    rows = default_portfolio_rows()
    # Two all-blank rows (below BLANK_STREAK_STOP=5) between r5 and a final point on r8:
    # the scan must bridge the gap, not stop at it. [None] is the builder's proven
    # spacer-row idiom (default_espp_rows uses it).
    rows.append([None])
    rows.append([None])
    rows.append([None] * 27 + [datetime(2023, 11, 13), 64758.48, 0.0186, 56136.79, 0.0106, 62999.09, 0.0096])
    parsed = parse_portfolio(_sheet("Portfolio", portfolio=rows))
    assert parsed.issues.errors == []
    assert [p.snapshot_date for p in parsed.history][-1] == date(2023, 11, 13)
    assert len(parsed.history) == 4
```

Note on indices: `rows[i]` is 0-based (row i+1 on the sheet); `rows[i][27]` is col AB (28), `[28]` AC (29), `[32]` AG (33). Add `from datetime import datetime` to the top of `test_importer_parsers.py` if it is not already there (the tests above use it at call sites).

- [ ] **Step 3: Run them to verify they fail**

Run: `cd backend && .venv/Scripts/python.exe -m pytest tests/test_importer_parsers.py -k history -v`
Expected: FAIL — `AttributeError: 'ParsedPortfolio' object has no attribute 'history'`

- [ ] **Step 4: Implement the parser**

In `backend/app/importer/parsers.py`:

(a) Extend `_iter_rows` (line 106) with a `min_col` keyword:

```python
def _iter_rows(ws, *, min_row: int, max_col: int, max_row: int = ROW_CAP, min_col: int = 1):
    """Bounded values_only iteration with 1-based row numbers (unsized-worksheet safe)."""
    return enumerate(
        ws.iter_rows(
            min_row=min_row, max_row=max_row, min_col=min_col, max_col=max_col, values_only=True
        ),
        start=min_row,
    )
```

(b) Replace the `ParsedPortfolio` dataclass and `parse_portfolio` (lines 983–1011) with:

```python
@dataclasses.dataclass
class ParsedValuePoint:
    snapshot_date: datetime.date
    market_value: Decimal
    cost_basis: Decimal
    sp500_value: Decimal


@dataclasses.dataclass
class ParsedPortfolio:
    history: list[ParsedValuePoint]
    issues: CellIssues


def parse_portfolio(ws) -> ParsedPortfolio:
    """Two independent scans of one sheet: the ticker table (warn-only dividends check)
    and the hidden value-history region (cols AB..AH, rows 3+ — the series behind the
    'Portfolio Value over Time' chart). History is strict: errors block the apply."""
    issues = CellIssues()
    blanks = 0
    for rnum, row in _iter_rows(ws, min_row=2, max_col=16, max_row=200):
        if all(v is None for v in row):
            blanks += 1
            if blanks >= BLANK_STREAK_STOP:
                break
            continue
        blanks = 0
        ticker = _text(row[1])
        if ticker is None:
            continue  # totals row
        dividends = to_decimal(row[15], Q2, 10, ctx=cell_ref("Portfolio", rnum, 16), issues=issues)
        if dividends:
            issues.warn(
                f"Portfolio: {ticker} has Dividends Collected {dividends} — NOT imported "
                "(sheet has no payment dates); enter via the UI in Plan 4"
            )

    history: list[ParsedValuePoint] = []
    prev_date: datetime.date | None = None
    blanks = 0
    # The chart's ranges are padded to row 2153, so the region outruns ROW_CAP; 6000 is
    # comfortably above the padding while still bounded (unsized-worksheet law).
    for rnum, row in _iter_rows(ws, min_row=3, min_col=28, max_col=34, max_row=6000):
        if all(v is None for v in row):
            blanks += 1
            if blanks >= BLANK_STREAK_STOP:
                break
            continue
        blanks = 0
        snapshot_date = to_date_strict(row[0], ctx=cell_ref("Portfolio", rnum, 28), issues=issues)
        if snapshot_date is None:
            if row[0] is None:
                issues.error(
                    f"{cell_ref('Portfolio', rnum, 28)}: value-history row has values but no date"
                )
            continue  # non-date cell: to_date_strict already recorded the error
        if prev_date is not None and snapshot_date <= prev_date:
            issues.error(
                f"{cell_ref('Portfolio', rnum, 28)}: value-history date "
                f"{snapshot_date.isoformat()} is not after the previous row "
                f"({prev_date.isoformat()})"
            )
            continue
        prev_date = snapshot_date
        values: dict[int, Decimal] = {}
        for label, col in (("market value", 29), ("S&P 500 baseline", 31), ("cost basis", 33)):
            before = len(issues.errors)
            parsed_value = to_decimal(
                row[col - 28], Q2, 12, ctx=cell_ref("Portfolio", rnum, col), issues=issues
            )
            if parsed_value is None:
                if len(issues.errors) == before:
                    # to_decimal is silent on blank/error-string cells; a hole in a dated
                    # history row is an error here (strict region, unlike the ticker table).
                    issues.error(
                        f"{cell_ref('Portfolio', rnum, col)}: value-history {label} is missing"
                    )
                values.clear()
                break
            values[col] = parsed_value
        if not values:
            continue
        history.append(
            ParsedValuePoint(
                snapshot_date=snapshot_date,
                market_value=values[29],
                sp500_value=values[31],
                cost_basis=values[33],
            )
        )
    if not history:
        issues.warn(
            "Portfolio: no value-history rows found (columns AB+) — the performance chart "
            "stays empty until a workbook carrying the series is imported"
        )
    return ParsedPortfolio(history=history, issues=issues)
```

- [ ] **Step 5: Run the parser tests + full parser/service/import files**

Run: `cd backend && .venv/Scripts/python.exe -m pytest tests/test_importer_parsers.py tests/test_importer_service.py tests/test_import_api.py -v`
Expected: PASS, including the two pre-existing `parse_portfolio` dividend tests (their rows now carry the region; the negative-dividends test overrides rows WITH history so no empty-region warning interferes — its assertion is `any(...)`, unaffected either way).

- [ ] **Step 6: Commit**

```bash
git add backend/app/importer/parsers.py backend/tests/workbook_builder.py backend/tests/test_importer_parsers.py
git commit -m "feat: parse the Portfolio sheet's hidden value-history region (strict)"
```

---

### Task 3: Applier + service wiring

**Files:**
- Modify: `backend/app/importer/apply.py` (imports; new applier after `apply_net_worth`)
- Modify: `backend/app/importer/service.py` (line ~72, after `apply_positions`)
- Modify: `backend/tests/test_importer_apply.py` (append)
- Modify: `backend/tests/test_importer_service.py` (one extra assert)

- [ ] **Step 1: Write the failing applier tests**

Append to `backend/tests/test_importer_apply.py` (extend its `from app.importer.apply import (...)` with `apply_portfolio_history`, its `from app.importer.parsers import (...)` with `parse_portfolio`, and its `from app.models import (...)` with `PortfolioValueHistory`; `date`, `Decimal`, `select`, `SheetReport`, `sheets()` already exist):

```python
async def test_apply_portfolio_history_creates_then_skips(db):
    parsed = parse_portfolio(sheets()["Portfolio"])
    report = SheetReport()
    await apply_portfolio_history(db, parsed, report)
    await db.commit()
    assert report.entities["portfolio_value_history"].creates == 3

    rows = (
        (
            await db.execute(
                select(PortfolioValueHistory).order_by(PortfolioValueHistory.snapshot_date)
            )
        )
        .scalars()
        .all()
    )
    assert [r.snapshot_date for r in rows] == [
        date(2023, 10, 23),
        date(2023, 10, 30),
        date(2023, 11, 6),
    ]
    assert rows[1].market_value == Decimal("53413.36")
    assert rows[1].sp500_value == Decimal("53001.35")
    assert rows[1].cost_basis == Decimal("55212.09")

    # Idempotent second pass: same workbook -> all skips, nothing rewritten
    report2 = SheetReport()
    await apply_portfolio_history(db, parse_portfolio(sheets()["Portfolio"]), report2)
    await db.commit()
    counts = report2.entities["portfolio_value_history"]
    assert (counts.creates, counts.updates, counts.skips) == (0, 0, 3)


async def test_apply_portfolio_history_diff_updates_changed_values(db):
    from tests.workbook_builder import build_workbook, default_portfolio_rows, load_readonly

    parsed = parse_portfolio(sheets()["Portfolio"])
    await apply_portfolio_history(db, parsed, SheetReport())
    await db.commit()

    rows = default_portfolio_rows()
    rows[3][28] = 99999.99  # r4 col AC: revised market value for 2023-10-30
    changed = parse_portfolio(load_readonly(build_workbook(portfolio=rows))["Portfolio"])
    report = SheetReport()
    await apply_portfolio_history(db, changed, report)
    await db.commit()

    counts = report.entities["portfolio_value_history"]
    assert (counts.creates, counts.updates, counts.skips) == (0, 1, 2)
    assert any("portfolio_value_history[2023-10-30]" in s for s in report.samples)
    row = (
        await db.execute(
            select(PortfolioValueHistory).where(
                PortfolioValueHistory.snapshot_date == date(2023, 10, 30)
            )
        )
    ).scalar_one()
    assert row.market_value == Decimal("99999.99")
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && .venv/Scripts/python.exe -m pytest tests/test_importer_apply.py -k portfolio_history -v`
Expected: FAIL — `ImportError: cannot import name 'apply_portfolio_history'`

- [ ] **Step 3: Implement the applier and wire the service**

In `backend/app/importer/apply.py`: add `ParsedPortfolio` to the `from app.importer.parsers import (...)` block and `PortfolioValueHistory` to the `from app.models import (...)` block. Insert after `apply_net_worth` (i.e. before `apply_spending`):

```python
async def apply_portfolio_history(
    db: AsyncSession, parsed: ParsedPortfolio, report: SheetReport
) -> None:
    """Upsert the weekly value-history series by snapshot_date. No deletes: the sheet's
    series is append-only, so a date that vanished from the sheet is left in place
    (net-worth snapshot posture, not the positions sync-delete contract)."""
    counts = report.counts("portfolio_value_history")
    existing = {
        row.snapshot_date: row
        for row in (await db.execute(select(PortfolioValueHistory))).scalars()
    }
    for point in parsed.history:
        fields = {
            "market_value": point.market_value,
            "cost_basis": point.cost_basis,
            "sp500_value": point.sp500_value,
        }
        row = existing.get(point.snapshot_date)
        if row is None:
            db.add(PortfolioValueHistory(snapshot_date=point.snapshot_date, **fields))
            counts.creates += 1
        else:
            _diff_update(
                row,
                fields,
                counts,
                report,
                f"portfolio_value_history[{point.snapshot_date.isoformat()}]",
            )
```

In `backend/app/importer/service.py`, insert directly after the `apply_positions` line:

```python
        await appliers.apply_portfolio_history(
            db, parsed["portfolio"], report.sheets["portfolio"]
        )
```

- [ ] **Step 4: Pin the end-to-end count in the service test**

In `backend/tests/test_importer_service.py::test_dry_run_reports_without_writing`, after the `tax_inputs` assert, add:

```python
    assert report.sheets["portfolio"].entities["portfolio_value_history"].creates == 3
```

(The existing `test_apply_then_reapply_is_all_skips` sweep now covers the new applier's idempotence automatically — it iterates every entity bucket of every sheet.)

- [ ] **Step 5: Run the importer suites**

Run: `cd backend && .venv/Scripts/python.exe -m pytest tests/test_importer_apply.py tests/test_importer_service.py tests/test_import_api.py -v`
Expected: PASS (including the reapply-is-all-skips sweep)

- [ ] **Step 6: Commit**

```bash
git add backend/app/importer/apply.py backend/app/importer/service.py backend/tests/test_importer_apply.py backend/tests/test_importer_service.py
git commit -m "feat: apply portfolio value history on import (upsert by date, no deletes)"
```

---

### Task 4: `GET /portfolio/history` endpoint

**Files:**
- Modify: `backend/app/schemas/portfolio.py` (append)
- Modify: `backend/app/api/portfolio.py` (imports; new route near the holdings/allocation views)
- Modify: `backend/tests/test_portfolio_api.py` (append; extend auth sweep)

- [ ] **Step 1: Write the failing API tests**

In `backend/tests/test_portfolio_api.py`: add `HISTORY = "/api/v1/portfolio/history"` beside the other URL constants, extend the module's `from app.models import (...)` with `PortfolioValueHistory`, and append:

```python
async def test_history_empty_is_empty_arrays_not_404(auth_client):
    resp = await auth_client.get(HISTORY)
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"dates": [], "market_value": [], "cost_basis": [], "sp500": []}


async def test_history_returns_parallel_arrays_ordered_by_date(auth_client, db):
    db.add_all(
        [
            # Inserted out of order on purpose: the endpoint must sort by snapshot_date.
            PortfolioValueHistory(
                snapshot_date=date(2023, 10, 30),
                market_value=Decimal("53413.36"),
                cost_basis=Decimal("55212.09"),
                sp500_value=Decimal("53001.35"),
            ),
            PortfolioValueHistory(
                snapshot_date=date(2023, 10, 23),
                market_value=Decimal("53619.00"),
                cost_basis=Decimal("53619.00"),
                sp500_value=Decimal("53619.00"),
            ),
        ]
    )
    await db.commit()

    body = (await auth_client.get(HISTORY)).json()
    assert body["dates"] == ["2023-10-23", "2023-10-30"]
    # Decimal strings on the wire (pydantic v2), aligned index-for-index
    assert body["market_value"] == ["53619.00", "53413.36"]
    assert body["cost_basis"] == ["53619.00", "55212.09"]
    assert body["sp500"] == ["53619.00", "53001.35"]
```

Then extend the existing auth sweep `test_computed_views_require_auth` tuple to `(HOLDINGS, ALLOCATION, REALIZED, HISTORY)`.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && .venv/Scripts/python.exe -m pytest tests/test_portfolio_api.py -k "history or require_auth" -v`
Expected: the two new tests FAIL with 404; the auth sweep FAILS on HISTORY (404 ≠ 401)

- [ ] **Step 3: Implement schema + route**

Append to `backend/app/schemas/portfolio.py` (the file already imports `date` and `Decimal`):

```python
class PortfolioHistoryOut(BaseModel):
    """Parallel arrays (net-worth TimeseriesOut posture): index i across all four lists
    is one weekly imported point. sp500 is the sheet's baseline — the STARTING balance
    benchmarked into VOO shares, not contribution-matched."""

    dates: list[date]
    market_value: list[Decimal]
    cost_basis: list[Decimal]
    sp500: list[Decimal]
```

In `backend/app/api/portfolio.py`: add `PortfolioHistoryOut` to the schemas import block, `PortfolioValueHistory` to the models import block, and add near the other computed GET views (e.g. right after the allocation route):

```python
@router.get("/history", response_model=PortfolioHistoryOut)
async def value_history(db: AsyncSession = Depends(get_db)) -> PortfolioHistoryOut:
    """The imported weekly series behind the performance chart — empty arrays (not 404)
    until a workbook carrying the Portfolio sheet's value-history columns is imported."""
    rows = (
        (
            await db.execute(
                select(PortfolioValueHistory).order_by(PortfolioValueHistory.snapshot_date)
            )
        )
        .scalars()
        .all()
    )
    return PortfolioHistoryOut(
        dates=[row.snapshot_date for row in rows],
        market_value=[row.market_value for row in rows],
        cost_basis=[row.cost_basis for row in rows],
        sp500=[row.sp500_value for row in rows],
    )
```

- [ ] **Step 4: Run the API suite**

Run: `cd backend && .venv/Scripts/python.exe -m pytest tests/test_portfolio_api.py -v`
Expected: PASS

- [ ] **Step 5: Backend lint + full backend suite**

Run: `cd backend && .venv/Scripts/python.exe -m ruff check . && .venv/Scripts/python.exe -m pytest`
Expected: ruff clean; all tests PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas/portfolio.py backend/app/api/portfolio.py backend/tests/test_portfolio_api.py
git commit -m "feat: GET /portfolio/history — imported weekly series as parallel arrays"
```

---

### Task 5: Frontend plumbing — echarts registration, type, client

**Files:**
- Modify: `src/charts/echarts.ts`
- Modify: `src/types/api.ts` (after `AllocationResponse`, ~line 272)
- Modify: `src/api/portfolio.ts` (imports + one function after `fetchAllocation`)

- [ ] **Step 1: Register EffectScatter**

In `src/charts/echarts.ts`:
- Value import: `EffectScatterChart` joins the `from 'echarts/charts'` list (alphabetical: after `BarChart`).
- Type import: `EffectScatterSeriesOption` joins the `import type { ... } from 'echarts/charts'` list.
- Add `EffectScatterChart` to the `echarts.use([...])` array (beside `LineChart`).
- Add `| EffectScatterSeriesOption` to the `EChartsOption` ComposeOption union.

(MarkLineComponent is already registered — the live connector rides a series `markLine`, no new component.)

- [ ] **Step 2: Add the wire type**

In `src/types/api.ts` after `AllocationResponse`:

```ts
// GET /portfolio/history — parallel arrays (NetWorthTimeseries posture); index i across
// all four lists is one weekly imported point. sp500 is the sheet's baseline: the
// STARTING balance benchmarked into VOO shares, not contribution-matched.
export interface PortfolioHistory {
  dates: string[]
  market_value: string[]
  cost_basis: string[]
  sp500: string[]
}
```

- [ ] **Step 3: Add the client function**

In `src/api/portfolio.ts`: add `PortfolioHistory` to the type-import block, and after `fetchAllocation`:

```ts
export function fetchHistory(): Promise<PortfolioHistory> {
  return api<PortfolioHistory>('/portfolio/history')
}
```

- [ ] **Step 4: Type-check + commit**

Run: `npm run build`
Expected: clean tsc + vite build.

```bash
git add src/charts/echarts.ts src/types/api.ts src/api/portfolio.ts
git commit -m "feat: PortfolioHistory type, fetchHistory client, EffectScatter registration"
```

---

### Task 6: Shared chart builder (TDD)

**Files:**
- Create: `src/components/portfolio/historyChartOptions.ts`
- Create: `src/components/portfolio/historyChartOptions.test.ts`

- [ ] **Step 1: Write the failing builder tests**

Create `src/components/portfolio/historyChartOptions.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { EChartsOption } from '../../charts/echarts'
import { PALETTE } from '../../charts/theme'
import type { PortfolioHistory } from '../../types/api'
import {
  historyTooltipFormatter,
  liveFromHoldings,
  portfolioHistoryOption,
} from './historyChartOptions'

// Wire shape of GET /portfolio/history — Decimal strings, parallel arrays.
function history(over: Partial<PortfolioHistory> = {}): PortfolioHistory {
  return {
    dates: ['2026-07-27', '2026-08-03', '2026-08-10'],
    market_value: ['700000.00', '710000.50', '718422.07'],
    cost_basis: ['395000.00', '399542.36', '400243.74'],
    sp500: ['96000.00', '97000.00', '98636.70'],
    ...over,
  }
}

const EMPTY: PortfolioHistory = { dates: [], market_value: [], cost_basis: [], sp500: [] }

// --- option readers (allocationChartOptions.test.ts posture) ---------------------------
interface SeriesLike {
  type?: string
  name?: string
  color?: string
  data?: unknown[]
  areaStyle?: { opacity?: number }
  rippleEffect?: unknown
  markLine?: { data?: unknown[]; lineStyle?: { type?: string } }
}

function seriesOf(option: EChartsOption): SeriesLike[] {
  return (option as unknown as { series: SeriesLike[] }).series
}

function categoriesOf(option: EChartsOption): string[] {
  return (option as unknown as { xAxis: { data: string[] } }).xAxis.data
}

describe('portfolioHistoryOption', () => {
  it('returns null under two imported points, live or not', () => {
    expect(portfolioHistoryOption(EMPTY, null)).toBeNull()
    expect(
      portfolioHistoryOption(
        history({
          dates: ['2026-08-10'],
          market_value: ['1.00'],
          cost_basis: ['1.00'],
          sp500: ['1.00'],
        }),
        { date: '2026-08-14', value: 2 },
      ),
    ).toBeNull()
  })

  it('draws three lines in fixed palette slots with a wash under value only', () => {
    const option = portfolioHistoryOption(history(), null)
    expect(option).not.toBeNull()
    const series = seriesOf(option!)
    expect(series.map((s) => s.name)).toEqual(['Portfolio value', 'Cost basis', 'S&P 500 baseline'])
    expect(series.map((s) => s.color)).toEqual([PALETTE[0], PALETTE[1], PALETTE[2]])
    expect(series[0].areaStyle?.opacity).toBeGreaterThan(0)
    expect(series[1].areaStyle).toBeUndefined()
    expect(series[2].areaStyle).toBeUndefined()
    // Number() at the boundary, once
    expect(series[0].data).toEqual([700000, 710000.5, 718422.07])
    expect(categoriesOf(option!)).toEqual(['Jul 27, 2026', 'Aug 3, 2026', 'Aug 10, 2026'])
  })

  it('appends a pinging live category with a dashed connector when the quote is newer', () => {
    const option = portfolioHistoryOption(history(), { date: '2026-08-14', value: 723456.78 })
    expect(categoriesOf(option!)).toEqual([
      'Jul 27, 2026',
      'Aug 3, 2026',
      'Aug 10, 2026',
      'Aug 14, 2026',
    ])
    const series = seriesOf(option!)
    expect(series).toHaveLength(4)
    // Lines end at the last IMPORTED point — the live category is never extrapolated.
    expect(series[0].data).toEqual([700000, 710000.5, 718422.07, null])
    expect(series[1].data).toEqual([395000, 399542.36, 400243.74, null])
    const live = series[3]
    expect(live.type).toBe('effectScatter')
    expect(live.name).toBe('Live')
    expect(live.color).toBe(PALETTE[0]) // same entity as the value line; the ripple says "live"
    expect(live.rippleEffect).toBeTruthy()
    expect(live.data).toEqual([['Aug 14, 2026', 723456.78]])
    expect(live.markLine?.lineStyle?.type).toBe('dashed')
    expect(live.markLine?.data).toEqual([
      [{ coord: ['Aug 10, 2026', 718422.07] }, { coord: ['Aug 14, 2026', 723456.78] }],
    ])
  })

  it('parks a same-day quote on the last category without a connector', () => {
    const option = portfolioHistoryOption(history(), { date: '2026-08-10', value: 720000 })
    expect(categoriesOf(option!)).toEqual(['Jul 27, 2026', 'Aug 3, 2026', 'Aug 10, 2026'])
    const series = seriesOf(option!)
    expect(series).toHaveLength(4)
    expect(series[0].data).toEqual([700000, 710000.5, 718422.07]) // no null padding
    expect(series[3].data).toEqual([['Aug 10, 2026', 720000]])
    expect(series[3].markLine).toBeUndefined()
  })

  it('self-retires the live point when the quote predates the series or is unusable', () => {
    expect(seriesOf(portfolioHistoryOption(history(), { date: '2026-08-01', value: 1 })!)).toHaveLength(3)
    expect(
      seriesOf(portfolioHistoryOption(history(), { date: '2026-08-14', value: Number.NaN })!),
    ).toHaveLength(3)
    expect(seriesOf(portfolioHistoryOption(history(), null)!)).toHaveLength(3)
  })
})

describe('liveFromHoldings', () => {
  it('slices the bar date off a datetime and parses the market value once', () => {
    expect(
      liveFromHoldings({ as_of: '2026-08-14T00:00:00Z', totals: { market_value: '723456.78' } }),
    ).toEqual({ date: '2026-08-14', value: 723456.78 })
  })

  it('is null before the first price refresh', () => {
    expect(liveFromHoldings({ as_of: null, totals: { market_value: '0.00' } })).toBeNull()
  })
})

describe('historyTooltipFormatter', () => {
  it('skips null rows (the padded live category) and formats currency', () => {
    const html = historyTooltipFormatter([
      { seriesName: 'Portfolio value', marker: '<i/>', axisValueLabel: 'Aug 14, 2026', value: null },
      { seriesName: 'Live', marker: '<i/>', axisValueLabel: 'Aug 14, 2026', value: ['Aug 14, 2026', 723456.78] },
    ])
    expect(html).toContain('Aug 14, 2026')
    expect(html).toContain('Live')
    expect(html).toContain('$723,456.78')
    expect(html).not.toContain('Portfolio value')
  })

  it('returns an empty string when every row is null', () => {
    expect(historyTooltipFormatter([{ value: null }])).toBe('')
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/components/portfolio/historyChartOptions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the builder**

Create `src/components/portfolio/historyChartOptions.ts`:

```ts
// Pure option builder for the portfolio performance chart, shared by PortfolioPage and
// OverviewPage (overviewChartOptions.ts posture: no React, no fetching, no theme
// decisions of its own). Number() here is display-only — the server's Decimal strings
// are parsed once and never handed back to the API (format.ts's rule).
import type { EChartsOption } from '../../charts/echarts'
import { PALETTE } from '../../charts/theme'
import type { HoldingsTotals, PortfolioHistory } from '../../types/api'
import { formatCurrency, formatCurrencyCompact, formatDate } from '../../utils/format'

export interface LivePoint {
  date: string // quote bar date, ISO YYYY-MM-DD
  value: number // Number(totals.market_value) — display-only
}

// Both pages derive the live point from the SAME holdings payload they already fetch —
// one definition so the two charts can never disagree about what "live" means.
export function liveFromHoldings(holdings: {
  as_of: string | null
  totals: Pick<HoldingsTotals, 'market_value'>
}): LivePoint | null {
  return holdings.as_of
    ? { date: holdings.as_of.slice(0, 10), value: Number(holdings.totals.market_value) }
    : null
}

// Axis-tooltip params subset the formatter reads (the runtime shape for trigger:'axis'
// is an array of these; echarts types the callback param as a much wider union).
interface AxisTooltipParam {
  seriesName?: string
  marker?: string
  axisValueLabel?: string
  value?: unknown
}

function rowValue(value: unknown): number | null {
  // Line rows carry plain numbers (null on the padded live category); the live
  // effectScatter carries a [category, value] pair.
  const raw = Array.isArray(value) ? value[1] : value
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
}

// Exported for tests. Skipping null rows is the point: on the live category the three
// lines are padding-null and would each print a dash row under the default formatter.
// All strings interpolated here are app-generated (fixed series names, our own date
// labels), so no escapeHtml is needed.
export function historyTooltipFormatter(params: unknown): string {
  const list = (Array.isArray(params) ? params : [params]) as AxisTooltipParam[]
  const rows: { param: AxisTooltipParam; value: number }[] = []
  for (const param of list) {
    const value = rowValue(param.value)
    if (value !== null) rows.push({ param, value })
  }
  if (rows.length === 0) return ''
  const header = rows[0].param.axisValueLabel ?? ''
  return [
    header,
    ...rows.map(
      ({ param, value }) =>
        `${param.marker ?? ''} ${param.seriesName ?? ''}&nbsp;&nbsp;${formatCurrency(value)}`,
    ),
  ].join('<br/>')
}

export function portfolioHistoryOption(
  history: PortfolioHistory,
  live: LivePoint | null,
): EChartsOption | null {
  if (history.dates.length < 2) return null
  const lastDate = history.dates[history.dates.length - 1]
  const lastValue = Number(history.market_value[history.market_value.length - 1])
  // The ping renders only when there IS a usable quote no older than the imported
  // series — a live marker BEHIND the line's end would read as a glitch, not as "now".
  const livePt = live !== null && Number.isFinite(live.value) && live.date >= lastDate ? live : null
  // Same-day quote: the ping sits ON the last imported category — no new category and
  // no connector, because there is nothing to bridge.
  const extendAxis = livePt !== null && livePt.date > lastDate

  const categories = history.dates.map(formatDate)
  const lastLabel = categories[categories.length - 1]
  const liveLabel = livePt ? formatDate(livePt.date) : ''
  if (extendAxis) categories.push(liveLabel)

  // Lines end at the last IMPORTED point: the live category (when present) gets null,
  // never an extrapolated value.
  const lineData = (values: string[]): (number | null)[] =>
    extendAxis ? [...values.map(Number), null] : values.map(Number)

  // Fixed validated palette slots (charts/theme.ts law): value=slot 1 blue, cost
  // basis=slot 2 orange, S&P=slot 3 aqua. The wash rides the value line ONLY — the
  // Excel original's three overlapping opaque areas occlude each other (spec: rejected).
  const lineSeries = (name: string, values: string[], color: string, wash: boolean) => ({
    type: 'line' as const,
    name,
    symbol: 'none' as const,
    lineStyle: { width: 2 },
    color,
    ...(wash ? { areaStyle: { opacity: 0.12 } } : {}),
    data: lineData(values),
  })

  return {
    grid: { left: 70, right: 16, top: 32, bottom: 28 },
    legend: { top: 0 },
    xAxis: { type: 'category', data: categories, boundaryGap: false },
    yAxis: {
      // No scale:true — a washed area over a visible axis needs the honest zero baseline.
      type: 'value',
      axisLabel: { formatter: (v: number) => formatCurrencyCompact(v) },
    },
    tooltip: { trigger: 'axis', formatter: historyTooltipFormatter },
    series: [
      lineSeries('Portfolio value', history.market_value, PALETTE[0], true),
      lineSeries('Cost basis', history.cost_basis, PALETTE[1], false),
      lineSeries('S&P 500 baseline', history.sp500, PALETTE[2], false),
      ...(livePt
        ? [
            {
              // The live point wears the SAME blue — same entity, fresher reading; a new
              // hue would read as a fourth data series. The ripple is what says "live".
              type: 'effectScatter' as const,
              name: 'Live',
              color: PALETTE[0],
              symbolSize: 9,
              rippleEffect: { brushType: 'stroke' as const, scale: 3 },
              data: [[extendAxis ? liveLabel : lastLabel, livePt.value]] as [string, number][],
              ...(extendAxis
                ? {
                    // Dashed connector from the line's end to the ping (dashed =
                    // provisional). A markLine, not a fifth series: it toggles with
                    // 'Live' in the legend and stays out of the axis tooltip.
                    markLine: {
                      silent: true,
                      symbol: 'none' as const,
                      lineStyle: { type: 'dashed' as const, width: 2, color: PALETTE[0] },
                      label: { show: false },
                      data: [
                        [
                          { coord: [lastLabel, lastValue] as [string, number] },
                          { coord: [liveLabel, livePt.value] as [string, number] },
                        ],
                      ],
                    },
                  }
                : {}),
            },
          ]
        : []),
    ],
  }
}
```

- [ ] **Step 4: Run the builder tests**

Run: `npx vitest run src/components/portfolio/historyChartOptions.test.ts`
Expected: PASS. If tsc complains about the series union, confirm Task 5's `EffectScatterSeriesOption` landed in `EChartsOption`.

- [ ] **Step 5: Commit**

```bash
git add src/components/portfolio/historyChartOptions.ts src/components/portfolio/historyChartOptions.test.ts
git commit -m "feat: shared portfolio performance option builder with live ping point"
```

---

### Task 7: Portfolio page — Performance panel above Holdings

**Files:**
- Modify: `src/pages/PortfolioPage.tsx`

- [ ] **Step 1: Wire the fetch, memo, and panel**

All edits to `src/pages/PortfolioPage.tsx`:

(a) Imports — extend the react import with `useMemo`; add `fetchHistory` to the `'../api/portfolio'` import list; add below the existing component imports:

```tsx
import EChart from '../components/EChart'
import { liveFromHoldings, portfolioHistoryOption } from '../components/portfolio/historyChartOptions'
```

and add `PortfolioHistory` to the `'../types/api'` type-import list.

(b) State — beside the other `useState` hooks:

```tsx
const [history, setHistory] = useState<PortfolioHistory | null>(null)
```

(c) `load()` — append `fetchHistory(),` as the ninth entry of the `Promise.all([...])` array, add `hist` as the ninth destructured name (`([h, secs, txns, divs, ind, typ, acct, spark, hist])`), and add `setHistory(hist)` beside the other setters. Update the comment "eight cheap local queries" → "nine cheap local queries" and the seqRef comment "the eight requests" → "the nine requests".

(d) Memoized option — after the `const totals = ...` / `const asOf = ...` lines:

```tsx
// The page's only memoized value (OverviewPage's rule): EChart keys its setOption effect
// on [option], so a fresh object per render would redraw the chart on every tab click.
const performanceOption = useMemo(
  () => (history && holdings ? portfolioHistoryOption(history, liveFromHoldings(holdings)) : null),
  [history, holdings],
)
```

(e) JSX — insert between the closing of the tiles row (`{totals && (...)}`) and the Holdings `<section className="panel">`:

```tsx
<section className="panel">
  <h2 className="panel-title">Performance</h2>
  {performanceOption ? (
    <>
      <EChart option={performanceOption} height={300} />
      {/* The sheet's baseline invests only the STARTING balance in VOO; saying so here
          keeps the gap under the blue line from reading as outperformance. */}
      <p className="hint">
        S&amp;P 500 baseline tracks the starting balance invested in VOO — later
        contributions are not added to it.
      </p>
    </>
  ) : (
    <p className="empty-note">
      No performance history yet — import your workbook in Settings to load it.
    </p>
  )}
</section>
```

- [ ] **Step 2: Verify**

Run: `npm run build && npm test`
Expected: clean build; existing suites PASS (PortfolioPage has no page-level test file — a verified pre-existing posture, so coverage for this panel is the Task 6 builder tests plus Task 8's Overview page tests; do NOT create one).

- [ ] **Step 3: Commit**

```bash
git add src/pages/PortfolioPage.tsx
git commit -m "feat: Performance panel above Holdings on the Portfolio page"
```

---

### Task 8: Overview — swap donut for performance chart, full-width rows

**Files:**
- Modify: `src/pages/OverviewPage.tsx`
- Modify: `src/pages/OverviewPage.test.tsx`

- [ ] **Step 1: Update the page**

All edits to `src/pages/OverviewPage.tsx`:

(a) Imports: in the `'../api/portfolio'` import replace `fetchAllocation` with `fetchHistory` (result: `import { fetchHistory, fetchHoldings } from '../api/portfolio'`); replace the `allocationChartOptions` import line with:

```tsx
import { liveFromHoldings, portfolioHistoryOption } from '../components/portfolio/historyChartOptions'
```

and in the types import replace `AllocationResponse` with `PortfolioHistory`.

(b) `OverviewData`: replace `allocation: AllocationResponse` with `history: PortfolioHistory`.

(c) `load()`: replace `fetchAllocation('type'),` with `fetchHistory(),`, rename the destructured `allocation` to `history`, and store `history` in the payload object (`setData({ summary, ts, holdings, history, matrix, taxes })`).

(d) Memos: replace the `donut` memo with:

```tsx
const perf = useMemo(
  () =>
    data ? portfolioHistoryOption(data.history, liveFromHoldings(data.holdings)) : null,
  [data],
)
```

Keep the surrounding "only memoized values" comment; it still describes three charts.

(e) Cards: the grid becomes three full-width rows in order — net worth, portfolio performance, spending:

- Net worth section: `className="card span-8"` → `className="card span-12"`.
- Replace the whole allocation section (including the `PALETTE[0] draws both...` comment block above it) with:

```tsx
<section className="card span-12">
  <h2 className="eyebrow">Portfolio performance</h2>
  <NavLink className="drill-hint" to="/portfolio">
    Open portfolio →
  </NavLink>
  {perf ? (
    <EChart option={perf} height={280} />
  ) : (
    <p className="empty-note">No performance history yet.</p>
  )}
</section>
```

- Spending section: already `span-12`, unchanged.

- [ ] **Step 2: Update the page tests**

All edits to `src/pages/OverviewPage.test.tsx`:

(a) Portfolio mock block: replace `fetchAllocation: vi.fn(),` with `fetchHistory: vi.fn(),`; update the post-mock import to `import { fetchHistory, fetchHoldings } from '../api/portfolio'`; in the types import replace `AllocationResponse` with `PortfolioHistory`.

(b) Replace the `allocationOut` fixture with:

```tsx
function historyOut(over: Partial<PortfolioHistory> = {}): PortfolioHistory {
  return {
    dates: ['2026-07-27', '2026-08-03', '2026-08-10'],
    market_value: ['700000.00', '710000.50', '718422.07'],
    cost_basis: ['395000.00', '399542.36', '400243.74'],
    sp500: ['96000.00', '97000.00', '98636.70'],
    ...over,
  }
}
```

(c) `Payload` interface: `allocation: AllocationResponse` → `history: PortfolioHistory`. In `serve()`: `allocation: allocationOut(),` → `history: historyOut(),` and `vi.mocked(fetchAllocation).mockResolvedValue(payload.allocation)` → `vi.mocked(fetchHistory).mockResolvedValue(payload.history)`. In `failAll()` and both `for (const client of [...])` loops: `fetchAllocation` → `fetchHistory`.

(d) Fan-out test: delete `expect(fetchAllocation).toHaveBeenCalledWith('type')` and update its comment (the pinned argument is now only the timeseries granularity; fetchHistory takes no arguments).

(e) Charts test — the middle chart now has date categories plus the live category (holdings fixture `as_of: daysAgo(1)` is always ≥ the fixture's last import date, since wall clock only moves forward):

```tsx
it('feeds the spark, the performance lines and the bars', async () => {
  serve()
  renderPage()

  await screen.findByText('Net worth — Aug 2026')
  const charts = screen.getAllByTestId('echart')
  expect(charts).toHaveLength(3)
  // Spark first (net-worth months), performance second (weekly dates + the live
  // category derived from the quote bar date), bars last.
  expect(categoriesOf(charts[0])).toBe('Jun 2026,Jul 2026,Aug 2026')
  expect(categoriesOf(charts[1])).toBe(
    ['Jul 27, 2026', 'Aug 3, 2026', 'Aug 10, 2026', formatDate(daysAgo(1))].join(','),
  )
  expect(categoriesOf(charts[2])).toBe(
    'Aug 2025,Sep 2025,Oct 2025,Nov 2025,Dec 2025,Jan 2026,Feb 2026,Mar 2026,Apr 2026,May 2026,Jun 2026,Jul 2026',
  )
  // Each card drills into the page that owns the numbers.
  expect(screen.getByRole('link', { name: /Open net worth/ }).getAttribute('href')).toBe('/net-worth')
  expect(screen.getByRole('link', { name: /Open portfolio/ }).getAttribute('href')).toBe('/portfolio')
  expect(screen.getByRole('link', { name: /Open spending/ }).getAttribute('href')).toBe('/spending')
})
```

(f) Empty-database test: replace the `allocation: allocationOut({...})` override with `history: historyOut({ dates: [], market_value: [], cost_basis: [], sp500: [] }),` and the expectation `'No priced holdings yet.'` with `'No performance history yet.'` (the empty-db holdings fixture already has `as_of: null`, so no live point either).

(g) File-top comment "Six modules, one snapshot" still holds — leave it.

- [ ] **Step 3: Run the frontend suite**

Run: `npm test`
Expected: PASS (OverviewPage suite included).

- [ ] **Step 4: Lint + build**

Run: `npm run lint && npm run build`
Expected: clean. (ESLint will catch any now-unused imports left behind in the page or test file.)

- [ ] **Step 5: Commit**

```bash
git add src/pages/OverviewPage.tsx src/pages/OverviewPage.test.tsx
git commit -m "feat: Overview swaps allocation donut for performance chart; full-width rows"
```

---

### Task 9: Full verification sweep

**Files:** none (verification only)

- [ ] **Step 1: Backend — full suite + lint**

Run: `cd backend && .venv/Scripts/python.exe -m ruff check . && .venv/Scripts/python.exe -m pytest`
Expected: ruff clean, all tests PASS.

- [ ] **Step 2: Frontend — full suite + lint + build**

Run: `npm test && npm run lint && npm run build`
Expected: all PASS/clean.

- [ ] **Step 3: Real-workbook smoke test (CLI dry-run)**

The importer has a CLI (`app.importer.__main__`). Against the real workbook:

Run: `cd backend && .venv/Scripts/python.exe -m app.importer "C:\Users\edyli\Downloads\finances.xlsx" --dry-run`
Expected: no errors; the `== portfolio ==` section reports `portfolio_value_history: +147 ~0 =0 -0` (147 weekly rows verified in the real sheet on 2026-08-17; a re-downloaded workbook may have a few more). Requires the dev Postgres up and migrated (`alembic upgrade head`, Task 1).

- [ ] **Step 4: Confirm clean tree and report**

Run: `git status`
Expected: clean. Report results (including the dry-run counts) back for review.

**Deploy notes (for the final report, not an action):** this feature ships the first migration since the Plan 6 zero-migration deploy — the deploy runbook's `alembic upgrade head` step applies, order-safe both directions. Charts stay in their empty state until the next workbook import seeds the table. ImportReportView renders entity buckets generically (verified `Object.entries(sheet.entities)`), so the new counts bucket surfaces with no UI change.
