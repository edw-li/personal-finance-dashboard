# Plan 3: Net Worth + Spending Modules + Monthly Update Wizard

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The first two user-facing modules — `/net-worth` (stacked group chart, per-account table with MoM, drill-down, summary tiles) and `/spending` (heatmap matrix, stacked bars vs net pay + 4%-rule line, savings-rate trend, category trends, yearly rollups) — plus the `/update` monthly wizard (balances → spending + net pay → review → submit), all against the real data already in the dev DB.

**Architecture:** Backend adds two JWT-protected routers (`net-worth`, `spending`) over the Plan 1 tables, with all derived values (group totals, net worth, MoM %, savings rate, 4%-rule line) computed at query time in `app/services/` — never stored. One new migration adds `accounts.is_component` (dedup flag for the sheet's overlapping 401(k) source-bucket columns). Frontend adds Apache ECharts via a tree-shaken registration module, one registered dark theme, a ~60-line `<EChart>` wrapper, shared panel components (stat tiles, month-coverage ribbon), and three real pages replacing placeholders.

**Tech Stack:** FastAPI + SQLAlchemy 2 async (existing), pydantic v2 (Decimal→JSON **string**), Alembic; React 19 + TS + Vite 6, `echarts` ^6.1 (`echarts/core` imports only), lucide-react, vitest 3 + RTL (explicit imports, manual `cleanup()`).

**Spec:** `docs/superpowers/specs/2026-08-12-finance-dashboard-design.md` §4 (net worth + spending data model & computed values), §5 (net-worth/spending API surface), §6 (pages, wizard, charting), §9 (API tests; charts verified visually). Binding forward notes: Plan 1 doc "Forward notes for Plans 2+" and Plan 2 doc "Forward notes for Plans 3+ (finalized 2026-08-15)" — each restated below where it lands.

**Plan roadmap** (each plan ships working software):
1. Foundation — DONE (merged @ 20aadd8)
2. Importer — DONE (merged @ ae6a952; real data lives in the dev DB)
3. **Net worth + spending modules + monthly wizard** (this plan)
4. Portfolio + prices (yfinance, scheduler, holdings/XIRR)
5. Taxes + comp modules (tax engine w/ golden tests, ESPP, paycheck, focal)
6. Overview page, visual pass, prod import on the OCI box, parallel-run cutover

**Machine notes (edyli's Windows box)** — inherited from Plans 1–2, all still true:
- Worktree: `.worktrees/plan-3-net-worth-spending` (branch `plan-3-net-worth-spending`, from main @ b3ceab4). Worktree has its own `backend/.venv` (Python 3.12, all deps) and `node_modules` (installed 2026-08-14). Shell commands are Git Bash. Run ruff ONLY from `backend/`.
- **When a plan code block and `ruff format` disagree, format wins** (AST-identical rewraps sanctioned; reviewers verify AST equivalence, not byte equality). Same spirit for `eslint --fix`-style whitespace on TS.
- Dev Postgres: container `finance-dashboard-db-1`, loopback :5433, DBs `finance` (real imported data — 25 accounts / 37 snapshots / 925 balances / 19 categories / 551 spending rows / 29 cashflow) + `finance_test` (pytest). Start if down: `docker compose -f backend/docker-compose.yml up -d --wait db`. Docker Desktop needs relaunching after a reboot.
- pytest runs with `-W error`. pip needs `--trusted-host pypi.org --trusted-host files.pythonhosted.org`. Foreground `sleep` is blocked; wait on servers with `curl --retry N --retry-connrefused --retry-delay 1`. Killing a backgrounded uvicorn requires killing BOTH the python PID (netstat) and the `uvicorn.exe` wrapper.
- Node 18.12 local (engines says >=20 — known exception; CI runs Node 20). vitest pinned `^3`. **No vitest globals mode: import `describe/it/expect/afterEach` explicitly and call RTL `cleanup()` explicitly.**
- Local container image builds fail (corporate TLS interception) — CI is the image gate. Nothing in this plan builds images.
- The real workbook lives at `C:\Users\edyli\Downloads\Personal Finance Dashboard.xlsx`. It is used READ-ONLY in Task 15 verification. **Never commit it, never copy its dollar values into fixtures, code, or this doc.**

---

## Verified rollup semantics (probed against the real workbook + dev DB, 2026-08-14)

These facts were verified by direct probes during planning. They are the contract for the computed endpoints. No dollar values appear here by design — only structure.

### Net worth composition — the component-account dedup

The sheet's 401(k) columns overlap (Plan 2 forward note). Verified at ALL 37 snapshot rows:
- `Fidelity Traditional 401(k)` = `Employer Match 401(k)` + `Reverse Rollover 401(k)` + `Traditional 401(k)` (exact, every row).
- `Fidelity Roth 401(k)` = `Roth Basic 401(k)` + `After-Tax 401(k)` (exact, every row).

The sheet's own NET WORTH column (and its Net Worth Summary sheet, whose header enumerates the included accounts) **excludes exactly `{Employer Match 401(k), Reverse Rollover 401(k), Traditional 401(k), Roth Basic 401(k)}`** — verified 37/37 rows to < $0.005. That set keeps `After-Tax 401(k)` **and** `Fidelity Roth 401(k)`, i.e. **the sheet double-counts the After-Tax bucket** (it is already inside Fidelity Roth at every row).

**Decision (this plan):** correct accounting wins. All FIVE source buckets get `is_component = TRUE`:
`employer-match-401-k`, `reverse-rollover-401-k`, `traditional-401-k`, `roth-basic-401-k`, `after-tax-401-k` (dev-DB slugs verified). Dashboard net worth = `SUM(balance)` over non-component accounts (balances are stored signed; liabilities negative — no sign handling anywhere downstream).

**Consequences (bind Tasks 4 and 15):**
- Dashboard NW = sheet NW − (After-Tax 401(k) balance) for every month. Task 15 verifies this identity for all 37 months (tolerance $0.05/month: the importer normalized `0.001` placeholder cells to 0.00, up to ~a dozen per month).
- `is_component` is user-owned and editable via accounts CRUD: flipping `after-tax-401-k` back to `is_component = FALSE` reproduces the sheet's totals exactly. Surface this in the final report to the user.
- The importer never touches `is_component` (its account diff-fields are `{name, group, sort_order}` only; auto-created accounts default FALSE). Task 1 pins this with a regression test.

### MoM % (sheet-verified)

Sheet NET WORTH MoM = `(curr − prev) / prev`, first month `N/A`. We generalize to signed balances as `(curr − prev) / |prev|`, `null` when prev is 0 or missing — sign of the result then always matches direction of net-worth impact (a liability balance moving toward zero yields a positive %).

### Savings rate — spec formula wins over the sheet column

The sheet's `Savings Rate` column is **not** `(net_pay − total) / net_pay` — probed values are step-constants that change a few times a year (a planned/target rate, source untracked; all 29 months mismatch the actual-rate formula). The approved spec §4 defines savings rate = `(net_pay − TOTAL) / net_pay`; **implement the spec formula** and label it "Savings rate (actual)" in the UI. Task 15 records the divergence; do NOT chase the sheet column.

### "4% Portfolio" line — spec formula, sheet column unreproducible

Spec §4: 4%-rule line = `total investable assets × swr_pct / 12` (`swr_pct` from `app_settings`, seeded `{"value": 0.04}`). Probes show the sheet's column matches NO fixed subset of same-month Net Worth columns (exhaustive subset search, sizes ≤8, and NW-minus-subset search both found nothing ≥50% of months) — it was evidently computed from live portfolio values at entry time. **Definition here:** investable = non-component balances in groups `{pre_tax, post_tax, taxable, equity}` from the **latest snapshot ≤ the spending month**; `null` when no snapshot exists on/before that month. That base tracks the sheet's implied base within ~±1% in most recent months (worse in volatile months) — Task 15 prints the comparison for the record; no exactness gate.

### Data shape facts (dev DB, verified)

- 25 accounts, sort_order = sheet column index (3…51); groups as seeded; slugs as listed in the migration below.
- 37 snapshots 2023-09-01…2026-09-01 (contiguous, first-of-month). 925 balances (every account × every snapshot — entry UIs should preserve "every active account gets a value").
- 19 categories; 551 monthly_spending rows over 29 months 2023-08-01…2025-12-01 (explicit 0.00s stored; **no negative amounts**). monthly_cashflow: 29 rows, same months. **2026 spending is empty — the wizard's first real month is fresh.**
- Snapshot months ⊇ spending months is NOT guaranteed either way (spending starts 2023-08, snapshots 2023-09; snapshots run 9 months past spending) — matrix months and 4%-line nulls must tolerate both.
- `app_settings.swr_pct` = `{"value": 0.04}` envelope; envelope is convention-only (Plan 1 note) — read defensively, fall back to 0.04.

---

## Global rules (bind every task)

**Auth:** every new endpoint sits behind `Depends(get_current_user)` — applied ONCE at router level: `APIRouter(prefix=..., tags=[...], dependencies=[Depends(get_current_user)])`. Tests assert 401 without a token per router (one canary test per router, not per endpoint).

**Decimal discipline** (Plan 1/2 forward notes):
- Balances / amounts / net_pay quantize to `0.01` with `ROUND_HALF_UP` **server-side before write** (never trust client rounding; PG rounds half-away-from-zero while Python's default is banker's).
- Bounds validated BEFORE insert: quantized `abs(value) < 10**12` (Numeric(14,2)) else 422 with the offending field named — numeric overflow otherwise surfaces as bare `DBAPIError` sqlstate 22003.
- Derived percentages (MoM, savings rate) quantize to `0.000001` (6 dp) for the wire; the 4%-rule dollar line to `0.01`.
- **pydantic 2.13 serializes `Decimal` as a JSON *string*** (verified: `{"x":"1234.50"}`). All frontend money/percent types are `string` (or `string | null`); convert with `Number()` only at the chart/format boundary. Form state stays strings end-to-end.

**Month params:** path/query months are ISO dates that MUST be the first of the month — reject others with 422 (`require_first_of_month`). DB CheckConstraints are the backstop, not the error path.

**Bulk upsert semantics (wizard endpoints):** load existing rows for the month in one query, diff in memory, `db.add()` news / mutate changed / count identical as unchanged; **omitted entries are left untouched; no deletes**. Duplicate `account_id`/`category_id` in one body → 422. Unknown ids → 422 naming them. One commit at the end. Responses return `{created, updated, unchanged}` counts so the wizard can report what happened.

**No stored derived values** (spec §4): group totals, net worth, MoM, savings rate, yearly rollups, 4% line are computed per request. Row counts are personal-scale (≤ a few thousand) — full-table loads + in-memory math are the whole strategy; no new indexes (Plan 1 note kept: FK children stay unindexed).

**Frontend conventions:** typed fetchers in `src/api/<module>.ts` calling the shared `api<T>()`; interfaces in `src/types/api.ts`; pages own their CSS file; icons lucide-react; no new deps beyond `echarts`. No `innerHTML` anywhere — tooltip/legend formatters build strings from server data but must HTML-escape names (categories/accounts are user-editable text); a shared `escapeHtml` util is provided in Task 10 and its use in formatters is mandatory.

**Chart system rules (dataviz method — validated during planning, frozen here):**
- Categorical palette (dark, on card surface `#171a21`) — **validator run 2026-08-14: ALL CHECKS PASS** (lightness band, chroma, worst adjacent CVD ΔE 8.4, normal-vision 19.3, contrast ≥3:1):
  `#3987e5` blue, `#d95926` orange, `#199e70` aqua, `#c98500` yellow, `#d55181` magenta, `#008300` green, `#9085e9` violet, `#e66767` red — fixed order, assigned in sequence, NEVER cycled or generated past 8.
- Account groups wear fixed entity colors: cash=blue(1), pre_tax=orange(2), post_tax=aqua(3), taxable=yellow(4), equity=magenta(5), other=green(6), liability=red(8). Slot 7 violet stays free for the spending stack's 7th category.
- **One axis per chart — never dual-axis.** Savings rate (%) gets its own chart; it does not ride the spending bars ($).
- >8 series is never more hues: spending stacked bars fold to **top 7 categories by all-time total + "Other"** (`#4a5060` neutral gray, last/top of stack). The heatmap + tables carry full 19-category detail.
- Multi-select line charts (account drill-down, category trends) cap at **3 concurrent series** (the first three slots are the all-pairs-validated set); colors assign by selection order to the lowest free slot and survivors KEEP their color when others are removed.
- Sequential (heatmap) = one blue ramp, dark→light on our dark surface (near-zero recedes): `#0d366b → #cde2fb`.
- Gridlines/axes: solid hairlines in `#1e222c` (grid) / `#262b36` (axis), text in `--muted #8b93a3`; dashed is reserved for the 4%-rule threshold line only. Legend present for ≥2 series; single-series charts get none. Tooltips on everything (axis-trigger crosshair on line/area, item-trigger on bars/cells). Direct labels only selectively (net-worth end value). Text never wears series color. Stacked bar segments separated by 1px surface-colored borders.
- Every chart has a data-equivalent table on the same page (account table, matrix/yearly tables) — tooltips enhance, never gate.
- `prefers-reduced-motion: reduce` disables chart animation (wrapper handles it globally).

**Visual language (frontend-design pass, frozen here):** keep Plan 1's dark token system untouched (`index.css` — all tokens re-verified ≥4.5:1 for text on both surfaces). Additions live in component CSS: cards (`--surface`, 1px `--border`, 10px radius, 20px padding) headed by 11px uppercase letter-spaced muted eyebrows; data values (tiles, table numerals) in the platform mono stack `ui-monospace, 'Cascadia Mono', 'Segoe UI Mono', Menlo, Consolas, monospace` with `font-variant-numeric: tabular-nums` in columns only (stat-tile values stay proportional-width mono, no tabular-nums); deltas colored `--positive`/`--negative` with ▲/▼ glyphs (never color alone). **Signature element: the month-coverage ribbon** — last-12-months tick-chips (filled = month has data, hollow = missing, ring = selected) heading both module pages and driving the wizard's month picker; it encodes real coverage state, links pages to the ritual, and is the one memorable device. No webfonts (self-hosted privacy tool — zero external requests). Motion: ECharts' default easing only.

---

## File structure

```
backend/alembic/versions/<new>_account_is_component_flag.py   # Task 1
backend/app/models/net_worth.py          # modify: is_component column (Task 1)
backend/app/services/__init__.py         # new, empty (Task 2)
backend/app/services/money.py            # quantize/bounds/first-of-month guards (Task 2)
backend/app/services/net_worth_calc.py   # matrix load, group/NW totals, MoM, investable base, swr (Task 2)
backend/app/schemas/net_worth.py         # Task 3/4/5 schemas
backend/app/schemas/spending.py          # Task 6/7/8 schemas
backend/app/api/net_worth.py             # accounts CRUD (T3), timeseries+summary (T4), months (T5)
backend/app/api/spending.py              # categories CRUD (T6), matrix+yearly (T7), months (T8)
backend/app/main.py                      # register both routers (T3, T6)
backend/tests/test_services_money.py     # T2
backend/tests/test_net_worth_calc.py     # T2
backend/tests/test_net_worth_api.py      # T3–T5
backend/tests/test_spending_api.py       # T6–T8
backend/tests/test_importer_apply.py     # T1: +1 is_component preservation test (append)

package.json                             # +echarts (T10)
src/api/client.ts                        # modify: timeout + network-error mapping (T9)
src/api/client.test.ts                   # extend (T9)
src/types/api.ts                         # extend: all Plan 3 payload types (T9)
src/api/netWorth.ts                      # typed fetchers (T9)
src/api/spending.ts                      # typed fetchers (T9)
src/charts/echarts.ts                    # tree-shaken registration + ComposeOption type (T10)
src/charts/theme.ts                      # palette/tokens/registerTheme — the one theme file (T10)
src/components/EChart.tsx                # wrapper: init/theme/resize/dispose/reduced-motion (T10)
src/utils/format.ts + format.test.ts     # currency/pct/compact/month + escapeHtml (T10)
src/utils/months.ts + months.test.ts     # iso month math (T10)
src/components/panels.css                # cards, eyebrows, KPI row, tables, forms, ribbon (T11)
src/components/StatTile.tsx              # T11
src/components/MonthRibbon.tsx (+test)   # T11
src/pages/NetWorthPage.tsx + .css        # T12
src/pages/SpendingPage.tsx + .css        # T13
src/pages/MonthlyUpdatePage.tsx + .css   # T14
src/App.tsx                              # real routes + /update (T14)
src/components/Layout.tsx                # +Monthly update nav item (T14)
```

Responsibilities: `services/` never imports FastAPI (except `money.py`'s HTTPException — the shared 422 vocabulary); routers hold no math beyond orchestration; `charts/theme.ts` is the only place a chart color may be defined; pages never hardcode hex. Spec §6's "balance entry on /net-worth, month entry on /spending" is satisfied via the wizard: both pages' ribbons and "Enter month" buttons deep-link to `/update?month=…&step=…` — one entry implementation, zero duplicated grids.

---

### Task 1: `accounts.is_component` — model, migration + backfill, importer-preservation test

**Files:**
- Modify: `backend/app/models/net_worth.py` (one column)
- Create: `backend/alembic/versions/<generated>_account_is_component_flag.py`
- Modify: `backend/tests/test_models_net_worth.py` (append 1 test)
- Modify: `backend/tests/test_importer_apply.py` (append 1 test)

All backend commands in this plan run from `backend/` in the worktree with its venv: `cd .worktrees/plan-3-net-worth-spending/backend` (first task only — stay there).

- [x] **Step 1: Write the failing model test**

Append to `backend/tests/test_models_net_worth.py` (match the file's existing style — it inserts models via the `db` fixture):

```python
async def test_account_is_component_defaults_false(db):
    account = Account(name="Comp Test", slug="comp-test", group="pre_tax")
    db.add(account)
    await db.commit()
    assert account.is_component is False
    account.is_component = True
    await db.commit()
    await db.refresh(account)
    assert account.is_component is True
```

(If the file imports `Account` from `app.models` already, reuse; otherwise add the import.)

- [x] **Step 2: Run it — expect FAIL**

```bash
.venv/Scripts/python -m pytest tests/test_models_net_worth.py -q -W error
```
Expected: `AttributeError`/`TypeError` — `is_component` doesn't exist.

- [x] **Step 3: Add the column to the model**

In `backend/app/models/net_worth.py`, class `Account`, after `is_active`:

```python
    # Source-bucket columns the sheet tracks inside an aggregate account (the two Fidelity
    # 401(k)s). Excluded from every computed rollup; user-owned (the importer never diffs it).
    is_component: Mapped[bool] = mapped_column(default=False)
```

- [x] **Step 4: Re-run — expect PASS** (same command; conftest builds the test schema via `create_all`, so no migration is needed for tests to pass).

- [x] **Step 5: Write the migration with backfill**

```bash
.venv/Scripts/alembic revision -m "account is_component flag"
```

Replace the generated file's `upgrade()`/`downgrade()` with (keep the generated `revision` id; `down_revision` must be `a3f86e58ac4d`):

```python
def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "accounts",
        sa.Column("is_component", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    # The five sheet source-bucket columns (verified against the workbook 2026-08-14:
    # Fidelity Traditional 401(k) = employer match + reverse rollover + traditional;
    # Fidelity Roth 401(k) = roth basic + after-tax, exact at all 37 snapshots).
    # No-op on a fresh DB (accounts are importer-created).
    op.execute(
        "UPDATE accounts SET is_component = TRUE WHERE slug IN ("
        "'employer-match-401-k','reverse-rollover-401-k','traditional-401-k',"
        "'roth-basic-401-k','after-tax-401-k')"
    )
    # Drop the server_default so the schema matches the model (Python-side default only,
    # like sort_order/is_active) and `alembic check` stays clean.
    op.alter_column("accounts", "is_component", server_default=None)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("accounts", "is_component")
```

- [x] **Step 6: Apply to the dev DB and verify the backfill**

```bash
.venv/Scripts/alembic upgrade head
.venv/Scripts/alembic check
docker exec finance-dashboard-db-1 psql -U finance -d finance -tAc "SELECT slug FROM accounts WHERE is_component ORDER BY sort_order"
```
Expected: `alembic check` reports no new upgrade operations; psql prints exactly the five slugs above (sheet order: employer-match, reverse-rollover, traditional, roth-basic, after-tax). Also run the CI round-trip guard locally once: `.venv/Scripts/alembic downgrade a3f86e58ac4d && .venv/Scripts/alembic upgrade head` — then re-run the psql check (the backfill must re-apply).

- [x] **Step 7: Write the failing importer-preservation test**

Append to `backend/tests/test_importer_apply.py` (imports at top of file already include most of these; add what's missing):

```python
async def test_reimport_preserves_user_owned_is_component(db):
    from app.importer.cells import CellIssues
    from app.importer.parsers import ParsedAccountColumn, ParsedNetWorth
    from app.importer.report import SheetReport

    db.add(Account(name="Traditional 401(k)", slug="traditional-401-k", group="pre_tax",
                   sort_order=11, is_component=True))
    await db.commit()

    parsed = ParsedNetWorth(
        accounts=[ParsedAccountColumn(name="Traditional 401(k)", group="pre_tax",
                                      sort_order=11, column=11)],
        snapshots=[],
        issues=CellIssues(),
    )
    report = SheetReport()
    await apply_net_worth(db, parsed, report)
    await db.commit()

    account = (
        await db.execute(select(Account).where(Account.slug == "traditional-401-k"))
    ).scalar_one()
    assert account.is_component is True  # importer diff-fields are {name, group, sort_order} only
```

(Adjust the `SheetReport()` construction/`apply_net_worth` import to the file's existing conventions — the test's assertion is the contract; if `SheetReport` needs a sheet key argument, pass what sibling tests pass.)

- [x] **Step 8: Run it — expect PASS immediately** (the importer already only diffs `{name, group, sort_order}`). This is a pin, not a change: if it FAILS, the importer regressed — stop and investigate, do not "fix" the test.

```bash
.venv/Scripts/python -m pytest tests/test_importer_apply.py -q -W error
```

- [x] **Step 9: Full backend gate + commit**

```bash
.venv/Scripts/ruff format . && .venv/Scripts/ruff check . && .venv/Scripts/python -m pytest -q -W error
cd .. && git add backend/app/models/net_worth.py backend/alembic/versions backend/tests/test_models_net_worth.py backend/tests/test_importer_apply.py && git commit -m "feat: account is_component flag with sheet-verified backfill" && cd backend
```
Expected: 130 existing + 2 new tests pass.

---

### Task 2: Services — `money.py` + `net_worth_calc.py` (pure math, TDD)

**Files:**
- Create: `backend/app/services/__init__.py` (empty)
- Create: `backend/app/services/money.py`
- Create: `backend/app/services/net_worth_calc.py`
- Create: `backend/tests/test_services_money.py`
- Create: `backend/tests/test_net_worth_calc.py`

- [ ] **Step 1: Write the failing money tests**

`backend/tests/test_services_money.py`:

```python
from datetime import date
from decimal import Decimal

import pytest
from fastapi import HTTPException

from app.services.money import mom_pct, quantize_money, require_first_of_month


def test_quantize_money_half_up():
    # PG rounds half-away-from-zero; Python's default quantize is banker's — must match PG.
    assert quantize_money(Decimal("2.665"), "x") == Decimal("2.67")
    assert quantize_money(Decimal("-2.665"), "x") == Decimal("-2.67")
    assert quantize_money(Decimal("100"), "x") == Decimal("100.00")


def test_quantize_money_bounds():
    assert quantize_money(Decimal("999999999999.99"), "x") == Decimal("999999999999.99")
    with pytest.raises(HTTPException) as exc:
        quantize_money(Decimal("1000000000000.00"), "balance[account_id=3]")
    assert exc.value.status_code == 422
    assert "balance[account_id=3]" in exc.value.detail
    with pytest.raises(HTTPException):
        quantize_money(Decimal("-1000000000000.00"), "x")


def test_require_first_of_month():
    assert require_first_of_month(date(2026, 8, 1)) == date(2026, 8, 1)
    with pytest.raises(HTTPException) as exc:
        require_first_of_month(date(2026, 8, 14))
    assert exc.value.status_code == 422


def test_mom_pct():
    assert mom_pct(Decimal("110"), Decimal("100")) == Decimal("0.100000")
    # Signed denominator: liability moving toward zero is an improvement -> positive pct.
    assert mom_pct(Decimal("-50"), Decimal("-100")) == Decimal("0.500000")
    assert mom_pct(Decimal("100"), Decimal("0")) is None
    assert mom_pct(Decimal("100"), None) is None
    # 6 dp, HALF_UP
    assert mom_pct(Decimal("1.0000005"), Decimal("1")) == Decimal("0.000001")
```

- [ ] **Step 2: Run — expect FAIL** (`ModuleNotFoundError: app.services`).

```bash
.venv/Scripts/python -m pytest tests/test_services_money.py -q -W error
```

- [ ] **Step 3: Implement `money.py`**

`backend/app/services/__init__.py`: empty file.

`backend/app/services/money.py`:

```python
"""Shared money/percent/month guards for the API layer.

Raises HTTPException(422) directly — these ARE the API's validation vocabulary; keeping
the message format here means every router reports bad values identically.
"""

from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from fastapi import HTTPException

MONEY_QUANTUM = Decimal("0.01")
PCT_QUANTUM = Decimal("0.000001")
# Numeric(14,2) / Numeric(12,2): 12 integer digits is the shared safe bound (over-scale
# values otherwise surface as bare DBAPIError sqlstate 22003 — Plan 1 forward note).
MONEY_MAX_ABS = Decimal(10) ** 12


def quantize_money(value: Decimal, field: str) -> Decimal:
    quantized = value.quantize(MONEY_QUANTUM, rounding=ROUND_HALF_UP)
    if quantized.copy_abs() >= MONEY_MAX_ABS:
        raise HTTPException(
            status_code=422, detail=f"{field}: |value| must be below 10^12"
        )
    return quantized


def quantize_pct(value: Decimal) -> Decimal:
    return value.quantize(PCT_QUANTUM, rounding=ROUND_HALF_UP)


def require_first_of_month(month: date) -> date:
    if month.day != 1:
        raise HTTPException(
            status_code=422, detail="month must be the first of the month (YYYY-MM-01)"
        )
    return month


def mom_pct(curr: Decimal, prev: Decimal | None) -> Decimal | None:
    """(curr - prev) / |prev|; None when prev is missing or zero.

    Signed denominator so the result's sign always matches net-worth impact —
    a liability balance rising toward zero reads as a positive change.
    """
    if prev is None or prev == 0:
        return None
    return quantize_pct((curr - prev) / prev.copy_abs())
```

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Write the failing calc tests**

`backend/tests/test_net_worth_calc.py` — DB-backed, uses the `db` fixture; seeds a tiny two-snapshot world:

```python
from datetime import date
from decimal import Decimal

import pytest

from app.models import Account, AccountBalance, AppSetting, NetWorthSnapshot
from app.services.net_worth_calc import (
    INVESTABLE_GROUPS,
    get_swr_pct,
    group_totals_for,
    investable_base,
    load_balance_matrix,
    net_worth_for,
)


@pytest.fixture
async def nw_world(db):
    accounts = [
        Account(name="Checking", slug="checking", group="cash", sort_order=1),
        Account(name="Agg 401k", slug="agg-401k", group="pre_tax", sort_order=2),
        Account(name="Bucket 401k", slug="bucket-401k", group="pre_tax", sort_order=3,
                is_component=True),
        Account(name="Brokerage", slug="brokerage", group="taxable", sort_order=4),
        Account(name="Card", slug="card", group="liability", sort_order=5),
    ]
    snaps = [
        NetWorthSnapshot(month=date(2026, 1, 1)),
        NetWorthSnapshot(month=date(2026, 2, 1)),
    ]
    db.add_all(accounts + snaps)
    await db.flush()
    values = {
        (0, 0): "100.00", (0, 1): "1000.00", (0, 2): "400.00", (0, 3): "500.00",
        (0, 4): "-50.00",
        (1, 0): "110.00", (1, 1): "1100.00", (1, 2): "440.00", (1, 3): "550.00",
        (1, 4): "-40.00",
    }
    for (s_i, a_i), balance in values.items():
        db.add(AccountBalance(snapshot_id=snaps[s_i].id, account_id=accounts[a_i].id,
                              balance=Decimal(balance)))
    await db.commit()
    return accounts, snaps


async def test_net_worth_excludes_components_and_sums_signed(db, nw_world):
    accounts, snaps = nw_world
    snapshots, accts, balances = await load_balance_matrix(db)
    assert [s.month for s in snapshots] == [date(2026, 1, 1), date(2026, 2, 1)]
    # 100 + 1000 + 500 - 50 (component 400 excluded; liability signed)
    assert net_worth_for(snapshots[0].id, accts, balances) == Decimal("1550.00")
    assert net_worth_for(snapshots[1].id, accts, balances) == Decimal("1720.00")


async def test_group_totals_zero_fill_and_exclude_components(db, nw_world):
    accounts, snaps = nw_world
    snapshots, accts, balances = await load_balance_matrix(db)
    totals = group_totals_for(snapshots[0].id, accts, balances)
    assert totals["pre_tax"] == Decimal("1000.00")  # component bucket excluded
    assert totals["liability"] == Decimal("-50.00")
    assert totals["equity"] == Decimal("0.00")  # every group present, zero-filled


async def test_investable_base_latest_snapshot_on_or_before(db, nw_world):
    # pre_tax(agg only) + taxable = 1000 + 500 @ Jan; 1100 + 550 @ Feb
    assert set(INVESTABLE_GROUPS) == {"pre_tax", "post_tax", "taxable", "equity"}
    assert await investable_base(db, date(2026, 1, 1)) == Decimal("1500.00")
    # A later spending month with no snapshot falls back to the latest prior one.
    assert await investable_base(db, date(2026, 3, 1)) == Decimal("1650.00")
    assert await investable_base(db, date(2025, 12, 1)) is None


async def test_get_swr_pct_reads_envelope_with_fallback(db):
    assert await get_swr_pct(db) == Decimal("0.04")  # unseeded -> default
    db.add(AppSetting(key="swr_pct", value={"value": 0.05}))
    await db.commit()
    assert await get_swr_pct(db) == Decimal("0.05")
    setting = await db.get(AppSetting, "swr_pct")
    setting.value = {"wrong": "shape"}  # envelope is convention-only (Plan 1 note)
    await db.commit()
    assert await get_swr_pct(db) == Decimal("0.04")
```

- [ ] **Step 6: Run — expect FAIL** (module missing).

- [ ] **Step 7: Implement `net_worth_calc.py`**

```python
"""Query-time net-worth math. Nothing here is ever stored (spec section 4).

Personal-scale data (25 accounts x ~40 snapshots): full loads + in-memory sums are the
entire strategy — no aggregate SQL beyond investable_base's single-snapshot sum.
"""

from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ACCOUNT_GROUPS, Account, AccountBalance, AppSetting, NetWorthSnapshot

INVESTABLE_GROUPS = ("pre_tax", "post_tax", "taxable", "equity")
DEFAULT_SWR_PCT = Decimal("0.04")

ZERO = Decimal("0.00")

BalanceKey = tuple[int, int]  # (snapshot_id, account_id)


async def load_balance_matrix(
    db: AsyncSession,
) -> tuple[list[NetWorthSnapshot], list[Account], dict[BalanceKey, Decimal]]:
    snapshots = list(
        (await db.execute(select(NetWorthSnapshot).order_by(NetWorthSnapshot.month)))
        .scalars()
        .all()
    )
    accounts = list(
        (await db.execute(select(Account).order_by(Account.sort_order, Account.id)))
        .scalars()
        .all()
    )
    balances = {
        (b.snapshot_id, b.account_id): b.balance
        for b in (await db.execute(select(AccountBalance))).scalars()
    }
    return snapshots, accounts, balances


def net_worth_for(
    snapshot_id: int, accounts: list[Account], balances: dict[BalanceKey, Decimal]
) -> Decimal:
    total = ZERO
    for account in accounts:
        if account.is_component:
            continue
        total += balances.get((snapshot_id, account.id), ZERO)
    return total


def group_totals_for(
    snapshot_id: int, accounts: list[Account], balances: dict[BalanceKey, Decimal]
) -> dict[str, Decimal]:
    totals = {group: ZERO for group in ACCOUNT_GROUPS}
    for account in accounts:
        if account.is_component:
            continue
        totals[account.group] += balances.get((snapshot_id, account.id), ZERO)
    return totals


async def investable_base(db: AsyncSession, month: date) -> Decimal | None:
    """Non-component pre/post-tax + taxable + equity balances of the latest snapshot
    on or before `month`; None when no snapshot exists yet (4%-line gap, not an error)."""
    snapshot_id = (
        await db.execute(
            select(NetWorthSnapshot.id)
            .where(NetWorthSnapshot.month <= month)
            .order_by(NetWorthSnapshot.month.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if snapshot_id is None:
        return None
    total = (
        await db.execute(
            select(func.coalesce(func.sum(AccountBalance.balance), 0))
            .join(Account, Account.id == AccountBalance.account_id)
            .where(
                AccountBalance.snapshot_id == snapshot_id,
                Account.is_component.is_(False),
                Account.group.in_(INVESTABLE_GROUPS),
            )
        )
    ).scalar_one()
    return Decimal(total)


async def get_swr_pct(db: AsyncSession) -> Decimal:
    """app_settings['swr_pct'] envelope {"value": x}; the envelope is convention-only
    (Plan 1 forward note) — any unexpected shape falls back to the seeded default."""
    setting = await db.get(AppSetting, "swr_pct")
    if setting is None or not isinstance(setting.value, dict):
        return DEFAULT_SWR_PCT
    raw = setting.value.get("value")
    if isinstance(raw, bool) or not isinstance(raw, (int, float, str)):
        return DEFAULT_SWR_PCT
    try:
        return Decimal(str(raw))
    except ArithmeticError:
        return DEFAULT_SWR_PCT
```

- [ ] **Step 8: Run both new files + full gate — expect PASS**

```bash
.venv/Scripts/python -m pytest tests/test_services_money.py tests/test_net_worth_calc.py -q -W error
.venv/Scripts/ruff format . && .venv/Scripts/ruff check . && .venv/Scripts/python -m pytest -q -W error
```

- [ ] **Step 9: Commit**

```bash
cd .. && git add backend/app/services backend/tests/test_services_money.py backend/tests/test_net_worth_calc.py && git commit -m "feat: query-time net worth math + money guards (services layer)" && cd backend
```

---

### Task 3: Net-worth router part 1 — schemas + accounts CRUD (TDD)

**Files:**
- Create: `backend/app/schemas/net_worth.py`
- Create: `backend/app/api/net_worth.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/test_net_worth_api.py`

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_net_worth_api.py` (start of file — Tasks 4/5 append to it):

```python
from datetime import date
from decimal import Decimal

from app.models import Account, AccountBalance, NetWorthSnapshot


async def test_net_worth_requires_auth(client):
    resp = await client.get("/api/v1/net-worth/accounts")
    assert resp.status_code == 401


async def test_create_and_list_accounts(auth_client):
    resp = await auth_client.post(
        "/api/v1/net-worth/accounts",
        json={"name": "Fidelity HSA", "group": "pre_tax", "sort_order": 17},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["slug"] == "fidelity-hsa"
    assert body["is_active"] is True
    assert body["is_component"] is False

    resp = await auth_client.get("/api/v1/net-worth/accounts")
    assert resp.status_code == 200
    assert [a["slug"] for a in resp.json()] == ["fidelity-hsa"]


async def test_create_account_rejects_bad_group_and_unsluggable_name(auth_client):
    resp = await auth_client.post(
        "/api/v1/net-worth/accounts", json={"name": "X", "group": "offshore"}
    )
    assert resp.status_code == 422
    resp = await auth_client.post(
        "/api/v1/net-worth/accounts", json={"name": "!!!", "group": "cash"}
    )
    assert resp.status_code == 422


async def test_create_account_conflicts_on_slug(auth_client):
    first = await auth_client.post(
        "/api/v1/net-worth/accounts", json={"name": "Petty Cash", "group": "other"}
    )
    assert first.status_code == 201
    dup = await auth_client.post(
        "/api/v1/net-worth/accounts", json={"name": "Petty  Cash", "group": "other"}
    )
    assert dup.status_code == 409


async def test_patch_account_updates_fields_not_slug(auth_client, db):
    created = (
        await auth_client.post(
            "/api/v1/net-worth/accounts", json={"name": "Vehicle(s)", "group": "other"}
        )
    ).json()
    resp = await auth_client.patch(
        f"/api/v1/net-worth/accounts/{created['id']}",
        json={"name": "Vehicles", "is_component": True, "is_active": False},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "Vehicles"
    assert body["slug"] == "vehicle-s"  # slug is the importer's natural key — immutable
    assert body["is_component"] is True
    assert body["is_active"] is False


async def test_patch_account_404_and_group_validation(auth_client):
    assert (
        await auth_client.patch("/api/v1/net-worth/accounts/999", json={"name": "X"})
    ).status_code == 404
    created = (
        await auth_client.post(
            "/api/v1/net-worth/accounts", json={"name": "Cash", "group": "cash"}
        )
    ).json()
    resp = await auth_client.patch(
        f"/api/v1/net-worth/accounts/{created['id']}", json={"group": "nope"}
    )
    assert resp.status_code == 422


async def test_delete_account_guarded_by_balances(auth_client, db):
    created = (
        await auth_client.post(
            "/api/v1/net-worth/accounts", json={"name": "Old Card", "group": "liability"}
        )
    ).json()
    snapshot = NetWorthSnapshot(month=date(2026, 1, 1))
    db.add(snapshot)
    await db.flush()
    db.add(
        AccountBalance(
            snapshot_id=snapshot.id, account_id=created["id"], balance=Decimal("-1.00")
        )
    )
    await db.commit()
    resp = await auth_client.delete(f"/api/v1/net-worth/accounts/{created['id']}")
    assert resp.status_code == 409  # has balances — deactivate instead

    empty = (
        await auth_client.post(
            "/api/v1/net-worth/accounts", json={"name": "Never Used", "group": "cash"}
        )
    ).json()
    resp = await auth_client.delete(f"/api/v1/net-worth/accounts/{empty['id']}")
    assert resp.status_code == 204
    assert (await db.get(Account, empty["id"])) is None
```

- [ ] **Step 2: Run — expect FAIL (404s: router not registered).**

```bash
.venv/Scripts/python -m pytest tests/test_net_worth_api.py -q -W error
```

- [ ] **Step 3: Implement schemas**

`backend/app/schemas/net_worth.py`:

```python
from datetime import date
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models import ACCOUNT_GROUPS


def _check_group(value: str) -> str:
    if value not in ACCOUNT_GROUPS:
        raise ValueError(f"group must be one of {sorted(ACCOUNT_GROUPS)}")
    return value


class AccountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    slug: str
    group: str
    sort_order: int
    is_active: bool
    is_component: bool


class AccountCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    group: str
    sort_order: int = 0
    is_component: bool = False

    group_known = field_validator("group")(_check_group)


class AccountUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    group: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None
    is_component: bool | None = None

    @field_validator("group")
    @classmethod
    def group_known(cls, value: str | None) -> str | None:
        return None if value is None else _check_group(value)


class BalanceEntry(BaseModel):
    account_id: int
    balance: Decimal


class MonthUpsert(BaseModel):
    recorded_on: date | None = None
    notes: str | None = None
    balances: list[BalanceEntry] = []


class MonthUpsertResult(BaseModel):
    month: date
    snapshot_created: bool
    created: int
    updated: int
    unchanged: int


class MonthBalancesOut(BaseModel):
    month: date
    exists: bool
    recorded_on: date | None
    notes: str | None
    balances: list[BalanceEntry]


class AccountSeries(BaseModel):
    account_id: int
    values: list[Decimal | None]


class TimeseriesOut(BaseModel):
    months: list[date]
    accounts: list[AccountOut]
    series: list[AccountSeries]
    group_totals: dict[str, list[Decimal]]
    net_worth: list[Decimal]
    mom_pct: list[Decimal | None]


class GroupSummary(BaseModel):
    group: str
    total: Decimal
    mom_delta: Decimal | None


class SummaryOut(BaseModel):
    month: date | None
    net_worth: Decimal | None
    mom_delta: Decimal | None
    mom_pct: Decimal | None
    groups: list[GroupSummary]
```

- [ ] **Step 4: Implement the router (CRUD half)**

`backend/app/api/net_worth.py`:

```python
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.importer.cells import slugify
from app.models import Account, AccountBalance
from app.schemas.net_worth import AccountCreate, AccountOut, AccountUpdate

router = APIRouter(
    prefix="/net-worth", tags=["net-worth"], dependencies=[Depends(get_current_user)]
)


@router.get("/accounts", response_model=list[AccountOut])
async def list_accounts(db: AsyncSession = Depends(get_db)) -> list[Account]:
    result = await db.execute(select(Account).order_by(Account.sort_order, Account.id))
    return list(result.scalars().all())


@router.post("/accounts", response_model=AccountOut, status_code=201)
async def create_account(
    body: AccountCreate, db: AsyncSession = Depends(get_db)
) -> Account:
    slug = slugify(body.name)
    if not slug:
        raise HTTPException(
            status_code=422,
            detail="name needs at least one ASCII letter or digit to derive a slug",
        )
    existing = (
        await db.execute(
            select(Account).where((Account.slug == slug) | (Account.name == body.name))
        )
    ).scalars().first()
    if existing is not None:
        raise HTTPException(status_code=409, detail=f"account {slug!r} already exists")
    account = Account(
        name=body.name,
        slug=slug,
        group=body.group,
        sort_order=body.sort_order,
        is_component=body.is_component,
    )
    db.add(account)
    await db.commit()
    return account


async def _get_account(db: AsyncSession, account_id: int) -> Account:
    account = await db.get(Account, account_id)
    if account is None:
        raise HTTPException(status_code=404, detail="account not found")
    return account


@router.patch("/accounts/{account_id}", response_model=AccountOut)
async def update_account(
    account_id: int, body: AccountUpdate, db: AsyncSession = Depends(get_db)
) -> Account:
    account = await _get_account(db, account_id)
    # Drop explicit nulls: every patchable column is NOT NULL, so "name": null is a
    # no-op request, not a write of NULL.
    updates = {
        field: value
        for field, value in body.model_dump(exclude_unset=True).items()
        if value is not None
    }
    new_name = updates.get("name")
    if new_name is not None and new_name != account.name:
        clash = (
            await db.execute(
                select(Account).where(Account.name == new_name, Account.id != account_id)
            )
        ).scalars().first()
        if clash is not None:
            raise HTTPException(status_code=409, detail="account name already in use")
    # slug is the importer's natural key — never rewritten here. A sheet-side rename is
    # the importer's job (per-run alias semantics, Plan 2 forward note).
    for field, value in updates.items():
        setattr(account, field, value)
    await db.commit()
    return account


@router.delete("/accounts/{account_id}", status_code=204)
async def delete_account(account_id: int, db: AsyncSession = Depends(get_db)) -> Response:
    account = await _get_account(db, account_id)
    balance_count = (
        await db.execute(
            select(func.count())
            .select_from(AccountBalance)
            .where(AccountBalance.account_id == account_id)
        )
    ).scalar_one()
    if balance_count:
        raise HTTPException(
            status_code=409,
            detail=f"account has {balance_count} balance rows — deactivate it instead",
        )
    await db.delete(account)
    await db.commit()
    return Response(status_code=204)
```

- [ ] **Step 5: Register the router**

In `backend/app/main.py`: `from app.api import auth, import_, net_worth` and `app.include_router(net_worth.router, prefix="/api/v1")` (keep alphabetical grouping with the others).

- [ ] **Step 6: Run — expect PASS; full gate; commit**

```bash
.venv/Scripts/python -m pytest tests/test_net_worth_api.py -q -W error
.venv/Scripts/ruff format . && .venv/Scripts/ruff check . && .venv/Scripts/python -m pytest -q -W error
cd .. && git add backend/app/schemas/net_worth.py backend/app/api/net_worth.py backend/app/main.py backend/tests/test_net_worth_api.py && git commit -m "feat: accounts CRUD endpoints" && cd backend
```

---

### Task 4: Net-worth router part 2 — timeseries + summary (TDD)

**Files:**
- Modify: `backend/app/api/net_worth.py` (append endpoints)
- Modify: `backend/tests/test_net_worth_api.py` (append tests)

- [ ] **Step 1: Append failing tests**

```python
async def _seed_timeseries(db):
    """3 months x {aggregate, component, liability} — enough to exercise every rule."""
    agg = Account(name="Agg", slug="agg", group="pre_tax", sort_order=1)
    comp = Account(name="Bucket", slug="bucket", group="pre_tax", sort_order=2,
                   is_component=True)
    card = Account(name="Card", slug="card", group="liability", sort_order=3)
    months = [date(2025, 12, 1), date(2026, 1, 1), date(2026, 3, 1)]  # gap at 2026-02
    snaps = [NetWorthSnapshot(month=m) for m in months]
    db.add_all([agg, comp, card, *snaps])
    await db.flush()
    balances = [
        (snaps[0], agg, "1000.00"), (snaps[0], comp, "300.00"), (snaps[0], card, "-100.00"),
        (snaps[1], agg, "1200.00"), (snaps[1], comp, "330.00"), (snaps[1], card, "-80.00"),
        (snaps[2], agg, "1500.00"), (snaps[2], comp, "360.00"),  # card missing this month
    ]
    for snap, account, value in balances:
        db.add(AccountBalance(snapshot_id=snap.id, account_id=account.id,
                              balance=Decimal(value)))
    await db.commit()
    return agg, comp, card


async def test_timeseries_shapes_and_component_exclusion(auth_client, db):
    agg, comp, card = await _seed_timeseries(db)
    resp = await auth_client.get("/api/v1/net-worth/timeseries")
    assert resp.status_code == 200
    body = resp.json()
    assert body["months"] == ["2025-12-01", "2026-01-01", "2026-03-01"]
    # Decimals arrive as JSON strings (pydantic v2) — assert exact strings.
    assert body["net_worth"] == ["900.00", "1120.00", "1500.00"]
    assert body["group_totals"]["pre_tax"] == ["1000.00", "1200.00", "1500.00"]
    assert body["group_totals"]["liability"] == ["-100.00", "-80.00", "0.00"]
    assert body["group_totals"]["cash"] == ["0.00", "0.00", "0.00"]
    by_id = {s["account_id"]: s["values"] for s in body["series"]}
    assert by_id[comp.id] == ["300.00", "330.00", "360.00"]  # components still listed
    assert by_id[card.id] == ["-100.00", "-80.00", None]  # missing balance is null
    assert body["mom_pct"][0] is None
    assert body["mom_pct"][1] == "0.244444"  # (1120-900)/900, 6 dp HALF_UP


async def test_timeseries_quarterly_filters_to_quarter_end_months(auth_client, db):
    await _seed_timeseries(db)
    resp = await auth_client.get("/api/v1/net-worth/timeseries?granularity=quarterly")
    body = resp.json()
    assert body["months"] == ["2025-12-01", "2026-03-01"]
    assert body["net_worth"] == ["900.00", "1500.00"]
    assert body["mom_pct"] == [None, "0.666667"]  # vs previous kept month


async def test_timeseries_rejects_unknown_granularity(auth_client):
    resp = await auth_client.get("/api/v1/net-worth/timeseries?granularity=weekly")
    assert resp.status_code == 422


async def test_summary_latest_month_with_deltas(auth_client, db):
    await _seed_timeseries(db)
    resp = await auth_client.get("/api/v1/net-worth/summary")
    body = resp.json()
    assert body["month"] == "2026-03-01"
    assert body["net_worth"] == "1500.00"
    assert body["mom_delta"] == "380.00"
    assert body["mom_pct"] == "0.339286"
    groups = {g["group"]: g for g in body["groups"]}
    assert groups["pre_tax"]["total"] == "1500.00"
    assert groups["liability"]["mom_delta"] == "80.00"  # -80 -> 0.00 (paid off)
    assert len(body["groups"]) == 7


async def test_summary_empty_db(auth_client):
    resp = await auth_client.get("/api/v1/net-worth/summary")
    body = resp.json()
    assert body == {
        "month": None, "net_worth": None, "mom_delta": None, "mom_pct": None,
        "groups": [],
    }
```

- [ ] **Step 2: Run — expect FAIL (404).**

- [ ] **Step 3: Append endpoints to `net_worth.py`**

Extend the imports first (ruff sorts them):

```python
from typing import Literal

from app.models import ACCOUNT_GROUPS  # merge into the existing app.models import
from app.schemas.net_worth import (  # merge into the existing schemas import
    AccountSeries,
    GroupSummary,
    SummaryOut,
    TimeseriesOut,
)
from app.services.money import mom_pct
from app.services.net_worth_calc import group_totals_for, load_balance_matrix, net_worth_for
```

Then append:

```python
QUARTER_END_MONTHS = (3, 6, 9, 12)


@router.get("/timeseries", response_model=TimeseriesOut)
async def timeseries(
    granularity: Literal["monthly", "quarterly"] = "monthly",
    db: AsyncSession = Depends(get_db),
) -> TimeseriesOut:
    snapshots, accounts, balances = await load_balance_matrix(db)
    if granularity == "quarterly":
        snapshots = [s for s in snapshots if s.month.month in QUARTER_END_MONTHS]
    net_worth = [net_worth_for(s.id, accounts, balances) for s in snapshots]
    mom = [
        None if i == 0 else mom_pct(net_worth[i], net_worth[i - 1])
        for i in range(len(net_worth))
    ]
    per_snapshot_groups = [group_totals_for(s.id, accounts, balances) for s in snapshots]
    group_totals = {
        group: [totals[group] for totals in per_snapshot_groups]
        for group in ACCOUNT_GROUPS
    }
    return TimeseriesOut(
        months=[s.month for s in snapshots],
        accounts=[AccountOut.model_validate(a) for a in accounts],
        series=[
            AccountSeries(
                account_id=a.id,
                values=[balances.get((s.id, a.id)) for s in snapshots],
            )
            for a in accounts
        ],
        group_totals=group_totals,
        net_worth=net_worth,
        mom_pct=mom,
    )


@router.get("/summary", response_model=SummaryOut)
async def summary(db: AsyncSession = Depends(get_db)) -> SummaryOut:
    snapshots, accounts, balances = await load_balance_matrix(db)
    if not snapshots:
        return SummaryOut(
            month=None, net_worth=None, mom_delta=None, mom_pct=None, groups=[]
        )
    latest = snapshots[-1]
    previous = snapshots[-2] if len(snapshots) > 1 else None
    latest_nw = net_worth_for(latest.id, accounts, balances)
    latest_groups = group_totals_for(latest.id, accounts, balances)
    prev_nw = net_worth_for(previous.id, accounts, balances) if previous else None
    prev_groups = (
        group_totals_for(previous.id, accounts, balances) if previous else None
    )
    return SummaryOut(
        month=latest.month,
        net_worth=latest_nw,
        mom_delta=None if prev_nw is None else latest_nw - prev_nw,
        mom_pct=mom_pct(latest_nw, prev_nw),
        groups=[
            GroupSummary(
                group=group,
                total=latest_groups[group],
                mom_delta=None if prev_groups is None
                else latest_groups[group] - prev_groups[group],
            )
            for group in ACCOUNT_GROUPS
        ],
    )
```

- [ ] **Step 4: Run — expect PASS; full gate; commit**

```bash
.venv/Scripts/python -m pytest tests/test_net_worth_api.py -q -W error
.venv/Scripts/ruff format . && .venv/Scripts/ruff check . && .venv/Scripts/python -m pytest -q -W error
cd .. && git add backend/app/api/net_worth.py backend/tests/test_net_worth_api.py && git commit -m "feat: net worth timeseries + summary endpoints" && cd backend
```

---

### Task 5: Net-worth router part 3 — month GET/PUT (the wizard's step-1 endpoint, TDD)

**Files:**
- Modify: `backend/app/api/net_worth.py` (append endpoints)
- Modify: `backend/tests/test_net_worth_api.py` (append tests)

- [ ] **Step 1: Append failing tests**

```python
async def test_get_month_missing_and_present(auth_client, db):
    account = Account(name="Cash", slug="cash", group="cash", sort_order=1)
    db.add(account)
    await db.commit()

    resp = await auth_client.get("/api/v1/net-worth/months/2026-05-01")
    assert resp.status_code == 200
    assert resp.json() == {
        "month": "2026-05-01", "exists": False, "recorded_on": None, "notes": None,
        "balances": [],
    }
    assert (
        await auth_client.get("/api/v1/net-worth/months/2026-05-02")
    ).status_code == 422


async def test_put_month_creates_snapshot_and_upserts(auth_client, db):
    account = Account(name="Cash", slug="cash", group="cash", sort_order=1)
    card = Account(name="Card", slug="card", group="liability", sort_order=2)
    db.add_all([account, card])
    await db.commit()

    resp = await auth_client.put(
        "/api/v1/net-worth/months/2026-05-01",
        json={
            "recorded_on": "2026-05-14",
            "notes": "first entry",
            "balances": [
                {"account_id": account.id, "balance": "1234.505"},
                {"account_id": card.id, "balance": "-50.00"},
            ],
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {
        "month": "2026-05-01", "snapshot_created": True,
        "created": 2, "updated": 0, "unchanged": 0,
    }

    read = (await auth_client.get("/api/v1/net-worth/months/2026-05-01")).json()
    assert read["exists"] is True
    assert read["recorded_on"] == "2026-05-14"
    by_id = {b["account_id"]: b["balance"] for b in read["balances"]}
    assert by_id[account.id] == "1234.51"  # server-side HALF_UP quantize
    assert by_id[card.id] == "-50.00"

    # Second put: one change, one identical, omission leaves the other row untouched.
    resp = await auth_client.put(
        "/api/v1/net-worth/months/2026-05-01",
        json={"balances": [{"account_id": account.id, "balance": "1300.00"}]},
    )
    assert resp.json() == {
        "month": "2026-05-01", "snapshot_created": False,
        "created": 0, "updated": 1, "unchanged": 0,
    }
    read = (await auth_client.get("/api/v1/net-worth/months/2026-05-01")).json()
    assert read["recorded_on"] == "2026-05-14"  # untouched: field wasn't sent
    assert {b["account_id"]: b["balance"] for b in read["balances"]}[card.id] == "-50.00"


async def test_put_month_validation(auth_client, db):
    account = Account(name="Cash", slug="cash", group="cash", sort_order=1)
    db.add(account)
    await db.commit()
    put = "/api/v1/net-worth/months/2026-05-01"

    dup = await auth_client.put(put, json={"balances": [
        {"account_id": account.id, "balance": "1"},
        {"account_id": account.id, "balance": "2"},
    ]})
    assert dup.status_code == 422
    assert "duplicate" in dup.json()["detail"]

    unknown = await auth_client.put(put, json={"balances": [
        {"account_id": 999, "balance": "1"},
    ]})
    assert unknown.status_code == 422
    assert "999" in unknown.json()["detail"]

    too_big = await auth_client.put(put, json={"balances": [
        {"account_id": account.id, "balance": "1000000000000"},
    ]})
    assert too_big.status_code == 422

    bad_month = await auth_client.put(
        "/api/v1/net-worth/months/2026-05-02", json={"balances": []}
    )
    assert bad_month.status_code == 422
    # Nothing was written by the failed puts:
    read = (await auth_client.get("/api/v1/net-worth/months/2026-05-01")).json()
    assert read["exists"] is False
```

(The last assertion matters: validation must run BEFORE the snapshot insert, so a rejected body leaves no half-created snapshot. Structure the endpoint accordingly.)

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Append endpoints**

Extend the imports first: `from datetime import date`, `from decimal import Decimal`, `NetWorthSnapshot` (merge into the `app.models` import), `BalanceEntry, MonthBalancesOut, MonthUpsert, MonthUpsertResult` (merge into the schemas import), and `quantize_money, require_first_of_month` (merge into the `app.services.money` import). Then append:

```python
@router.get("/months/{month}", response_model=MonthBalancesOut)
async def get_month(month: date, db: AsyncSession = Depends(get_db)) -> MonthBalancesOut:
    require_first_of_month(month)
    snapshot = (
        await db.execute(select(NetWorthSnapshot).where(NetWorthSnapshot.month == month))
    ).scalar_one_or_none()
    if snapshot is None:
        return MonthBalancesOut(
            month=month, exists=False, recorded_on=None, notes=None, balances=[]
        )
    rows = (
        await db.execute(
            select(AccountBalance)
            .where(AccountBalance.snapshot_id == snapshot.id)
            .order_by(AccountBalance.account_id)
        )
    ).scalars().all()
    return MonthBalancesOut(
        month=month,
        exists=True,
        recorded_on=snapshot.recorded_on,
        notes=snapshot.notes,
        balances=[BalanceEntry(account_id=r.account_id, balance=r.balance) for r in rows],
    )


@router.put("/months/{month}", response_model=MonthUpsertResult)
async def put_month(
    month: date, body: MonthUpsert, db: AsyncSession = Depends(get_db)
) -> MonthUpsertResult:
    require_first_of_month(month)
    ids = [entry.account_id for entry in body.balances]
    if len(set(ids)) != len(ids):
        raise HTTPException(status_code=422, detail="duplicate account_id in balances")
    # Validate everything BEFORE any write so a rejected body creates no snapshot.
    quantized: dict[int, Decimal] = {
        entry.account_id: quantize_money(
            entry.balance, f"balance[account_id={entry.account_id}]"
        )
        for entry in body.balances
    }
    if ids:
        known = set(
            (await db.execute(select(Account.id).where(Account.id.in_(ids)))).scalars()
        )
        missing = sorted(set(ids) - known)
        if missing:
            raise HTTPException(
                status_code=422, detail=f"unknown account_id(s): {missing}"
            )

    snapshot = (
        await db.execute(select(NetWorthSnapshot).where(NetWorthSnapshot.month == month))
    ).scalar_one_or_none()
    snapshot_created = snapshot is None
    if snapshot is None:
        snapshot = NetWorthSnapshot(
            month=month,
            recorded_on=body.recorded_on or date.today(),
            notes=body.notes,
        )
        db.add(snapshot)
        await db.flush()
    else:
        provided = body.model_fields_set
        if "recorded_on" in provided:
            snapshot.recorded_on = body.recorded_on
        if "notes" in provided:
            snapshot.notes = body.notes

    existing = {
        row.account_id: row
        for row in (
            await db.execute(
                select(AccountBalance).where(AccountBalance.snapshot_id == snapshot.id)
            )
        ).scalars()
    }
    created = updated = unchanged = 0
    for account_id, value in quantized.items():
        row = existing.get(account_id)
        if row is None:
            db.add(
                AccountBalance(
                    snapshot_id=snapshot.id, account_id=account_id, balance=value
                )
            )
            created += 1
        elif row.balance != value:
            row.balance = value
            updated += 1
        else:
            unchanged += 1
    await db.commit()
    return MonthUpsertResult(
        month=month,
        snapshot_created=snapshot_created,
        created=created,
        updated=updated,
        unchanged=unchanged,
    )
```

- [ ] **Step 4: Run — expect PASS; full gate; commit**

```bash
.venv/Scripts/python -m pytest tests/test_net_worth_api.py -q -W error
.venv/Scripts/ruff format . && .venv/Scripts/ruff check . && .venv/Scripts/python -m pytest -q -W error
cd .. && git add backend/app/api/net_worth.py backend/tests/test_net_worth_api.py && git commit -m "feat: monthly balance bulk upsert endpoint" && cd backend
```

---

### Task 6: Spending router part 1 — schemas + categories CRUD (TDD)

**Files:**
- Create: `backend/app/schemas/spending.py`
- Create: `backend/app/api/spending.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/test_spending_api.py`

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_spending_api.py` (start of file — Tasks 7/8 append):

```python
from datetime import date
from decimal import Decimal

from app.models import MonthlySpending, SpendingCategory


async def test_spending_requires_auth(client):
    resp = await client.get("/api/v1/spending/categories")
    assert resp.status_code == 401


async def test_category_crud_roundtrip(auth_client, db):
    created = await auth_client.post(
        "/api/v1/spending/categories", json={"name": "Food & Dining", "sort_order": 8}
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["slug"] == "food-dining"
    assert body["is_active"] is True

    dup = await auth_client.post(
        "/api/v1/spending/categories", json={"name": "Food & Dining"}
    )
    assert dup.status_code == 409

    listed = await auth_client.get("/api/v1/spending/categories")
    assert [c["slug"] for c in listed.json()] == ["food-dining"]

    patched = await auth_client.patch(
        f"/api/v1/spending/categories/{body['id']}",
        json={"name": "Food", "is_active": False},
    )
    assert patched.status_code == 200
    assert patched.json()["name"] == "Food"
    assert patched.json()["slug"] == "food-dining"  # immutable natural key
    assert patched.json()["is_active"] is False

    assert (
        await auth_client.patch("/api/v1/spending/categories/999", json={"name": "X"})
    ).status_code == 404


async def test_category_delete_guarded_by_rows(auth_client, db):
    cat = SpendingCategory(name="Pets", slug="pets", sort_order=1)
    db.add(cat)
    await db.flush()
    db.add(
        MonthlySpending(month=date(2026, 1, 1), category_id=cat.id, amount=Decimal("5"))
    )
    await db.commit()
    assert (
        await auth_client.delete(f"/api/v1/spending/categories/{cat.id}")
    ).status_code == 409

    empty = (
        await auth_client.post("/api/v1/spending/categories", json={"name": "Unused"})
    ).json()
    assert (
        await auth_client.delete(f"/api/v1/spending/categories/{empty['id']}")
    ).status_code == 204
```

- [ ] **Step 2: Run — expect FAIL (404).**

```bash
.venv/Scripts/python -m pytest tests/test_spending_api.py -q -W error
```

- [ ] **Step 3: Implement schemas**

`backend/app/schemas/spending.py`:

```python
from datetime import date
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    slug: str
    sort_order: int
    is_active: bool


class CategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    sort_order: int = 0


class CategoryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    sort_order: int | None = None
    is_active: bool | None = None


class AmountEntry(BaseModel):
    category_id: int
    amount: Decimal


class SpendingMonthUpsert(BaseModel):
    net_pay: Decimal | None = None
    amounts: list[AmountEntry] = []


class SpendingMonthOut(BaseModel):
    month: date
    exists: bool
    net_pay: Decimal | None
    amounts: list[AmountEntry]


class SpendingUpsertResult(BaseModel):
    month: date
    created: int
    updated: int
    unchanged: int
    net_pay_set: bool


class CategorySeries(BaseModel):
    category_id: int
    values: list[Decimal | None]


class MatrixOut(BaseModel):
    months: list[date]
    categories: list[CategoryOut]
    series: list[CategorySeries]
    totals: list[Decimal]
    net_pay: list[Decimal | None]
    savings_rate: list[Decimal | None]
    four_pct_rule: list[Decimal | None]


class YearCategoryTotal(BaseModel):
    category_id: int
    total: Decimal


class YearRollup(BaseModel):
    year: int
    by_category: list[YearCategoryTotal]
    total: Decimal
    net_pay_total: Decimal | None
    savings_rate: Decimal | None


class YearlyOut(BaseModel):
    years: list[YearRollup]
```

- [ ] **Step 4: Implement the router (CRUD half)**

`backend/app/api/spending.py`:

```python
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.importer.cells import slugify
from app.models import MonthlySpending, SpendingCategory
from app.schemas.spending import CategoryCreate, CategoryOut, CategoryUpdate

router = APIRouter(
    prefix="/spending", tags=["spending"], dependencies=[Depends(get_current_user)]
)


@router.get("/categories", response_model=list[CategoryOut])
async def list_categories(db: AsyncSession = Depends(get_db)) -> list[SpendingCategory]:
    result = await db.execute(
        select(SpendingCategory).order_by(SpendingCategory.sort_order, SpendingCategory.id)
    )
    return list(result.scalars().all())


@router.post("/categories", response_model=CategoryOut, status_code=201)
async def create_category(
    body: CategoryCreate, db: AsyncSession = Depends(get_db)
) -> SpendingCategory:
    slug = slugify(body.name)
    if not slug:
        raise HTTPException(
            status_code=422,
            detail="name needs at least one ASCII letter or digit to derive a slug",
        )
    existing = (
        await db.execute(
            select(SpendingCategory).where(
                (SpendingCategory.slug == slug) | (SpendingCategory.name == body.name)
            )
        )
    ).scalars().first()
    if existing is not None:
        raise HTTPException(status_code=409, detail=f"category {slug!r} already exists")
    category = SpendingCategory(name=body.name, slug=slug, sort_order=body.sort_order)
    db.add(category)
    await db.commit()
    return category


async def _get_category(db: AsyncSession, category_id: int) -> SpendingCategory:
    category = await db.get(SpendingCategory, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail="category not found")
    return category


@router.patch("/categories/{category_id}", response_model=CategoryOut)
async def update_category(
    category_id: int, body: CategoryUpdate, db: AsyncSession = Depends(get_db)
) -> SpendingCategory:
    category = await _get_category(db, category_id)
    # Same explicit-null guard as accounts: all patchable columns are NOT NULL.
    updates = {
        field: value
        for field, value in body.model_dump(exclude_unset=True).items()
        if value is not None
    }
    new_name = updates.get("name")
    if new_name is not None and new_name != category.name:
        clash = (
            await db.execute(
                select(SpendingCategory).where(
                    SpendingCategory.name == new_name,
                    SpendingCategory.id != category_id,
                )
            )
        ).scalars().first()
        if clash is not None:
            raise HTTPException(status_code=409, detail="category name already in use")
    for field, value in updates.items():
        setattr(category, field, value)
    await db.commit()
    return category


@router.delete("/categories/{category_id}", status_code=204)
async def delete_category(
    category_id: int, db: AsyncSession = Depends(get_db)
) -> Response:
    category = await _get_category(db, category_id)
    row_count = (
        await db.execute(
            select(func.count())
            .select_from(MonthlySpending)
            .where(MonthlySpending.category_id == category_id)
        )
    ).scalar_one()
    if row_count:
        raise HTTPException(
            status_code=409,
            detail=f"category has {row_count} monthly rows — deactivate it instead",
        )
    await db.delete(category)
    await db.commit()
    return Response(status_code=204)
```

- [ ] **Step 5: Register in `main.py`** (`from app.api import auth, import_, net_worth, spending`; `app.include_router(spending.router, prefix="/api/v1")`).

- [ ] **Step 6: Run — expect PASS; full gate; commit**

```bash
.venv/Scripts/python -m pytest tests/test_spending_api.py -q -W error
.venv/Scripts/ruff format . && .venv/Scripts/ruff check . && .venv/Scripts/python -m pytest -q -W error
cd .. && git add backend/app/schemas/spending.py backend/app/api/spending.py backend/app/main.py backend/tests/test_spending_api.py && git commit -m "feat: spending categories CRUD" && cd backend
```

---

### Task 7: Spending router part 2 — matrix + yearly rollups (TDD)

**Files:**
- Modify: `backend/app/api/spending.py` (append)
- Modify: `backend/tests/test_spending_api.py` (append)

- [ ] **Step 1: Append failing tests**

Extend the test file's model imports to `Account, AccountBalance, MonthlyCashflow, MonthlySpending, NetWorthSnapshot, SpendingCategory` (the seed below needs them all), then append:

```python
async def _seed_spending(db):
    """2 categories x 3 months + cashflow + one NW snapshot for the 4% line."""
    food = SpendingCategory(name="Food", slug="food", sort_order=1)
    rent = SpendingCategory(name="Rent", slug="rent", sort_order=2)
    db.add_all([food, rent])
    await db.flush()
    rows = [
        (date(2025, 12, 1), food, "500.00"), (date(2025, 12, 1), rent, "2000.00"),
        (date(2026, 1, 1), food, "400.00"),  # rent missing that month
        (date(2026, 2, 1), food, "0.00"), (date(2026, 2, 1), rent, "2100.00"),
    ]
    for month, cat, amount in rows:
        db.add(MonthlySpending(month=month, category_id=cat.id, amount=Decimal(amount)))
    db.add(MonthlyCashflow(month=date(2025, 12, 1), net_pay=Decimal("10000.00")))
    db.add(MonthlyCashflow(month=date(2026, 2, 1), net_pay=Decimal("0.00")))
    # Investable base: one snapshot at 2026-01 -> 4% line null in Dec, set from Jan on.
    account = Account(name="Brokerage", slug="brokerage", group="taxable", sort_order=1)
    snap = NetWorthSnapshot(month=date(2026, 1, 1))
    db.add_all([account, snap])
    await db.flush()
    db.add(AccountBalance(snapshot_id=snap.id, account_id=account.id,
                          balance=Decimal("300000.00")))
    await db.commit()
    return food, rent


async def test_matrix_shapes_totals_savings_and_four_pct(auth_client, db):
    food, rent = await _seed_spending(db)
    resp = await auth_client.get("/api/v1/spending/matrix")
    assert resp.status_code == 200
    body = resp.json()
    assert body["months"] == ["2025-12-01", "2026-01-01", "2026-02-01"]
    by_id = {s["category_id"]: s["values"] for s in body["series"]}
    assert by_id[food.id] == ["500.00", "400.00", "0.00"]
    assert by_id[rent.id] == ["2000.00", None, "2100.00"]
    assert body["totals"] == ["2500.00", "400.00", "2100.00"]
    assert body["net_pay"] == ["10000.00", None, "0.00"]
    # (10000-2500)/10000; None without net_pay; None on zero net_pay (division guard)
    assert body["savings_rate"] == ["0.750000", None, None]
    # No snapshot on/before Dec; 300000*0.04/12 = 1000.00 for Jan + Feb (seeded swr 0.04)
    assert body["four_pct_rule"] == [None, "1000.00", "1000.00"]


async def test_matrix_range_filter_and_validation(auth_client, db):
    await _seed_spending(db)
    resp = await auth_client.get(
        "/api/v1/spending/matrix?start=2026-01-01&end=2026-01-01"
    )
    assert resp.json()["months"] == ["2026-01-01"]
    assert (
        await auth_client.get("/api/v1/spending/matrix?start=2026-01-15")
    ).status_code == 422


async def test_matrix_includes_cashflow_only_months(auth_client, db):
    db.add(MonthlyCashflow(month=date(2026, 3, 1), net_pay=Decimal("5000.00")))
    await db.commit()
    body = (await auth_client.get("/api/v1/spending/matrix")).json()
    assert body["months"] == ["2026-03-01"]
    assert body["totals"] == ["0.00"]
    assert body["savings_rate"] == ["1.000000"]  # no spend recorded yet


async def test_yearly_rollups(auth_client, db):
    food, rent = await _seed_spending(db)
    resp = await auth_client.get("/api/v1/spending/yearly")
    body = resp.json()
    years = {y["year"]: y for y in body["years"]}
    assert set(years) == {2025, 2026}
    y25 = years[2025]
    assert y25["total"] == "2500.00"
    assert y25["net_pay_total"] == "10000.00"
    assert y25["savings_rate"] == "0.750000"
    assert {c["category_id"]: c["total"] for c in y25["by_category"]} == {
        food.id: "500.00", rent.id: "2000.00",
    }
    y26 = years[2026]
    assert y26["total"] == "2500.00"  # 400 + 0 + 2100
    assert y26["net_pay_total"] == "0.00"
    assert y26["savings_rate"] is None  # zero net pay -> undefined, not -inf
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Append endpoints**

Extend the imports first: `from datetime import date`, `from decimal import Decimal`, `MonthlyCashflow` (merge into `app.models`), `CategorySeries, MatrixOut, YearCategoryTotal, YearRollup, YearlyOut` (merge into the schemas import), `from app.services.money import quantize_money, quantize_pct, require_first_of_month`, and `from app.services.net_worth_calc import get_swr_pct, investable_base`. Then append:

```python
def _savings_rate(net_pay: Decimal | None, total: Decimal) -> Decimal | None:
    if net_pay is None or net_pay == 0:
        return None
    return quantize_pct((net_pay - total) / net_pay)


@router.get("/matrix", response_model=MatrixOut)
async def matrix(
    start: date | None = None,
    end: date | None = None,
    db: AsyncSession = Depends(get_db),
) -> MatrixOut:
    if start is not None:
        require_first_of_month(start)
    if end is not None:
        require_first_of_month(end)
    categories = list(
        (
            await db.execute(
                select(SpendingCategory).order_by(
                    SpendingCategory.sort_order, SpendingCategory.id
                )
            )
        ).scalars().all()
    )
    spend_query = select(MonthlySpending)
    cashflow_query = select(MonthlyCashflow)
    if start is not None:
        spend_query = spend_query.where(MonthlySpending.month >= start)
        cashflow_query = cashflow_query.where(MonthlyCashflow.month >= start)
    if end is not None:
        spend_query = spend_query.where(MonthlySpending.month <= end)
        cashflow_query = cashflow_query.where(MonthlyCashflow.month <= end)
    spend_rows = list((await db.execute(spend_query)).scalars().all())
    cashflow = {
        row.month: row.net_pay
        for row in (await db.execute(cashflow_query)).scalars()
    }
    months = sorted({row.month for row in spend_rows} | set(cashflow))
    month_index = {month: i for i, month in enumerate(months)}
    cells: dict[tuple[int, int], Decimal] = {
        (row.category_id, month_index[row.month]): row.amount for row in spend_rows
    }
    totals = [
        sum(
            (cells.get((c.id, i), Decimal("0.00")) for c in categories),
            Decimal("0.00"),
        )
        for i in range(len(months))
    ]
    net_pay = [cashflow.get(month) for month in months]
    savings = [_savings_rate(net_pay[i], totals[i]) for i in range(len(months))]
    swr = await get_swr_pct(db)
    four_pct: list[Decimal | None] = []
    for month in months:
        base = await investable_base(db, month)
        four_pct.append(
            None if base is None else quantize_money(base * swr / 12, "four_pct_rule")
        )
    return MatrixOut(
        months=months,
        categories=[CategoryOut.model_validate(c) for c in categories],
        series=[
            CategorySeries(
                category_id=c.id,
                values=[cells.get((c.id, i)) for i in range(len(months))],
            )
            for c in categories
        ],
        totals=totals,
        net_pay=net_pay,
        savings_rate=savings,
        four_pct_rule=four_pct,
    )
```

```python
@router.get("/yearly", response_model=YearlyOut)
async def yearly(db: AsyncSession = Depends(get_db)) -> YearlyOut:
    categories = list(
        (
            await db.execute(
                select(SpendingCategory).order_by(
                    SpendingCategory.sort_order, SpendingCategory.id
                )
            )
        ).scalars().all()
    )
    spend_rows = list((await db.execute(select(MonthlySpending))).scalars().all())
    cashflow_rows = list((await db.execute(select(MonthlyCashflow))).scalars().all())
    years = sorted(
        {row.month.year for row in spend_rows}
        | {row.month.year for row in cashflow_rows}
    )
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
        rollups.append(
            YearRollup(
                year=year,
                by_category=[
                    YearCategoryTotal(category_id=c.id, total=by_category[c.id])
                    for c in categories
                ],
                total=total,
                net_pay_total=net_pay_total,
                savings_rate=_savings_rate(net_pay_total, total),
            )
        )
    return YearlyOut(years=rollups)
```

- [ ] **Step 4: Run — expect PASS; full gate; commit**

```bash
.venv/Scripts/python -m pytest tests/test_spending_api.py -q -W error
.venv/Scripts/ruff format . && .venv/Scripts/ruff check . && .venv/Scripts/python -m pytest -q -W error
cd .. && git add backend/app/api/spending.py backend/tests/test_spending_api.py && git commit -m "feat: spending matrix + yearly rollup endpoints" && cd backend
```

---

### Task 8: Spending router part 3 — month GET/PUT (wizard step 2, TDD)

**Files:**
- Modify: `backend/app/api/spending.py` (append)
- Modify: `backend/tests/test_spending_api.py` (append)

- [ ] **Step 1: Append failing tests**

```python
async def test_get_spending_month(auth_client, db):
    food, rent = await _seed_spending(db)
    body = (await auth_client.get("/api/v1/spending/months/2025-12-01")).json()
    assert body["exists"] is True
    assert body["net_pay"] == "10000.00"
    assert {a["category_id"]: a["amount"] for a in body["amounts"]} == {
        food.id: "500.00", rent.id: "2000.00",
    }
    empty = (await auth_client.get("/api/v1/spending/months/2030-01-01")).json()
    assert empty == {
        "month": "2030-01-01", "exists": False, "net_pay": None, "amounts": [],
    }
    assert (
        await auth_client.get("/api/v1/spending/months/2030-01-02")
    ).status_code == 422


async def test_put_spending_month_upserts_and_net_pay_optional(auth_client, db):
    food, rent = await _seed_spending(db)
    put = "/api/v1/spending/months/2026-03-01"
    resp = await auth_client.put(put, json={
        "net_pay": "9000.005",
        "amounts": [
            {"category_id": food.id, "amount": "123.456"},
            {"category_id": rent.id, "amount": "2100.00"},
        ],
    })
    assert resp.status_code == 200, resp.text
    assert resp.json() == {
        "month": "2026-03-01", "created": 2, "updated": 0, "unchanged": 0,
        "net_pay_set": True,
    }
    read = (await auth_client.get(put)).json()
    assert read["net_pay"] == "9000.01"  # HALF_UP
    assert {a["category_id"]: a["amount"] for a in read["amounts"]}[food.id] == "123.46"

    # Omitting net_pay leaves it untouched; identical amount counts unchanged.
    resp = await auth_client.put(put, json={
        "amounts": [{"category_id": food.id, "amount": "123.46"}],
    })
    assert resp.json() == {
        "month": "2026-03-01", "created": 0, "updated": 0, "unchanged": 1,
        "net_pay_set": False,
    }
    assert (await auth_client.get(put)).json()["net_pay"] == "9000.01"


async def test_put_spending_month_validation(auth_client, db):
    food, rent = await _seed_spending(db)
    put = "/api/v1/spending/months/2026-03-01"
    assert (
        await auth_client.put(put, json={"amounts": [
            {"category_id": food.id, "amount": "1"},
            {"category_id": food.id, "amount": "2"},
        ]})
    ).status_code == 422
    assert (
        await auth_client.put(put, json={"amounts": [
            {"category_id": 999, "amount": "1"},
        ]})
    ).status_code == 422
    assert (
        await auth_client.put("/api/v1/spending/months/2026-03-15", json={})
    ).status_code == 422
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Append endpoints**

```python
@router.get("/months/{month}", response_model=SpendingMonthOut)
async def get_month(month: date, db: AsyncSession = Depends(get_db)) -> SpendingMonthOut:
    require_first_of_month(month)
    rows = list(
        (
            await db.execute(
                select(MonthlySpending)
                .where(MonthlySpending.month == month)
                .order_by(MonthlySpending.category_id)
            )
        ).scalars().all()
    )
    cashflow = await db.get(MonthlyCashflow, month)
    return SpendingMonthOut(
        month=month,
        exists=bool(rows) or cashflow is not None,
        net_pay=None if cashflow is None else cashflow.net_pay,
        amounts=[
            AmountEntry(category_id=r.category_id, amount=r.amount) for r in rows
        ],
    )


@router.put("/months/{month}", response_model=SpendingUpsertResult)
async def put_month(
    month: date, body: SpendingMonthUpsert, db: AsyncSession = Depends(get_db)
) -> SpendingUpsertResult:
    require_first_of_month(month)
    ids = [entry.category_id for entry in body.amounts]
    if len(set(ids)) != len(ids):
        raise HTTPException(status_code=422, detail="duplicate category_id in amounts")
    quantized: dict[int, Decimal] = {
        entry.category_id: quantize_money(
            entry.amount, f"amount[category_id={entry.category_id}]"
        )
        for entry in body.amounts
    }
    net_pay_provided = "net_pay" in body.model_fields_set and body.net_pay is not None
    net_pay_value = (
        quantize_money(body.net_pay, "net_pay") if net_pay_provided else None
    )
    if ids:
        known = set(
            (
                await db.execute(
                    select(SpendingCategory.id).where(SpendingCategory.id.in_(ids))
                )
            ).scalars()
        )
        missing = sorted(set(ids) - known)
        if missing:
            raise HTTPException(
                status_code=422, detail=f"unknown category_id(s): {missing}"
            )

    existing = {
        row.category_id: row
        for row in (
            await db.execute(
                select(MonthlySpending).where(MonthlySpending.month == month)
            )
        ).scalars()
    }
    created = updated = unchanged = 0
    for category_id, value in quantized.items():
        row = existing.get(category_id)
        if row is None:
            db.add(MonthlySpending(month=month, category_id=category_id, amount=value))
            created += 1
        elif row.amount != value:
            row.amount = value
            updated += 1
        else:
            unchanged += 1
    if net_pay_provided:
        cashflow = await db.get(MonthlyCashflow, month)
        if cashflow is None:
            db.add(MonthlyCashflow(month=month, net_pay=net_pay_value))
        else:
            cashflow.net_pay = net_pay_value
    await db.commit()
    return SpendingUpsertResult(
        month=month,
        created=created,
        updated=updated,
        unchanged=unchanged,
        net_pay_set=net_pay_provided,
    )
```

- [ ] **Step 4: Run — expect PASS; full backend gate; boot smoke; commit**

```bash
.venv/Scripts/python -m pytest tests/test_spending_api.py -q -W error
.venv/Scripts/ruff format . && .venv/Scripts/ruff check . && .venv/Scripts/python -m pytest -q -W error
(.venv/Scripts/uvicorn app.main:app --port 8000 &) && curl --retry 15 --retry-connrefused --retry-delay 1 -s http://127.0.0.1:8000/api/v1/health && curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8000/api/v1/net-worth/summary && curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8000/api/v1/spending/matrix
```
Expected: `{"status":"ok"}` then `401` twice (auth wall up). Kill the server (netstat PID + uvicorn.exe wrapper). Then:

```bash
cd .. && git add backend/app/api/spending.py backend/tests/test_spending_api.py && git commit -m "feat: monthly spending bulk upsert endpoint" && cd backend
```

**Backend is now feature-complete for this plan.**

---

### Task 9: Frontend API layer — client timeout, Plan 3 types, typed fetchers (TDD)

Frontend commands run from the worktree ROOT (`cd .worktrees/plan-3-net-worth-spending`). This task also pays the Plan 1/2 forward-note debt: "client.ts has no timeout/AbortSignal; network failures throw raw TypeError" (a hung backend previously meant a permanently blank page).

**Files:**
- Modify: `src/api/client.ts`
- Modify: `src/api/client.test.ts` (append)
- Modify: `src/types/api.ts` (append)
- Create: `src/api/netWorth.ts`
- Create: `src/api/spending.ts`

- [ ] **Step 1: Append failing client tests**

Append to `src/api/client.test.ts`:

```typescript
it('maps fetch rejections to ApiError instead of raw TypeError', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
  const error = (await api('/anything').catch((e: unknown) => e)) as ApiError
  expect(error).toBeInstanceOf(ApiError)
  expect(error.status).toBe(0)
  expect(error.message).toBe('Network error — is the server reachable?')
})

it('maps timeout aborts to a timed-out ApiError', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'))
  )
  const error = (await api('/anything').catch((e: unknown) => e)) as ApiError
  expect(error).toBeInstanceOf(ApiError)
  expect(error.status).toBe(0)
  expect(error.message).toBe('Request timed out')
})

it('passes a default timeout signal to fetch but honors a caller signal', async () => {
  const spy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
  vi.stubGlobal('fetch', spy)
  await api('/x')
  expect(spy.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  const own = new AbortController().signal
  await api('/y', { signal: own })
  expect(spy.mock.calls[1][1].signal).toBe(own)
})

it('rethrows caller-initiated aborts untouched', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError'))
  )
  const error = (await api('/anything').catch((e: unknown) => e)) as DOMException
  expect(error).toBeInstanceOf(DOMException)
  expect(error.name).toBe('AbortError')
})
```

- [ ] **Step 2: Run — expect the new tests FAIL** (`npm test`): raw TypeError propagates today.

- [ ] **Step 3: Implement in `src/api/client.ts`**

Replace the single `const res = await fetch(...)` line with:

```typescript
const signal = options.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
let res: Response
try {
  res = await fetch(`/api/v1${path}`, { ...options, headers, signal })
} catch (err) {
  if (err instanceof DOMException && err.name === 'TimeoutError') {
    throw new ApiError('Request timed out', 0)
  }
  if (err instanceof DOMException && err.name === 'AbortError') {
    throw err // caller-initiated abort — not an API failure
  }
  throw new ApiError('Network error — is the server reachable?', 0)
}
```

and add near the top of the file:

```typescript
// 15s: generous for a self-hosted API; without it a hung backend left token-bearing
// users on a permanently blank page (Plan 1 forward note).
const DEFAULT_TIMEOUT_MS = 15_000
```

- [ ] **Step 4: Run — expect PASS** (`npm test`; the three pre-existing client tests must still pass).

- [ ] **Step 5: Append Plan 3 payload types**

Append to `src/types/api.ts` — all money/percent fields are **strings** (pydantic v2 Decimal serialization), nullables as emitted:

```typescript
export type AccountGroup =
  | 'cash'
  | 'pre_tax'
  | 'post_tax'
  | 'taxable'
  | 'equity'
  | 'other'
  | 'liability'

export interface AccountOut {
  id: number
  name: string
  slug: string
  group: AccountGroup
  sort_order: number
  is_active: boolean
  is_component: boolean
}

export interface AccountCreate {
  name: string
  group: AccountGroup
  sort_order?: number
  is_component?: boolean
}

export type AccountUpdate = Partial<
  Pick<AccountOut, 'name' | 'group' | 'sort_order' | 'is_active' | 'is_component'>
>

export interface BalanceEntry {
  account_id: number
  balance: string
}

export interface NetWorthTimeseries {
  months: string[]
  accounts: AccountOut[]
  series: { account_id: number; values: (string | null)[] }[]
  group_totals: Record<AccountGroup, string[]>
  net_worth: string[]
  mom_pct: (string | null)[]
}

export interface GroupSummary {
  group: AccountGroup
  total: string
  mom_delta: string | null
}

export interface NetWorthSummary {
  month: string | null
  net_worth: string | null
  mom_delta: string | null
  mom_pct: string | null
  groups: GroupSummary[]
}

export interface MonthBalances {
  month: string
  exists: boolean
  recorded_on: string | null
  notes: string | null
  balances: BalanceEntry[]
}

export interface MonthUpsertResult {
  month: string
  snapshot_created: boolean
  created: number
  updated: number
  unchanged: number
}

export interface CategoryOut {
  id: number
  name: string
  slug: string
  sort_order: number
  is_active: boolean
}

export interface AmountEntry {
  category_id: number
  amount: string
}

export interface SpendingMatrix {
  months: string[]
  categories: CategoryOut[]
  series: { category_id: number; values: (string | null)[] }[]
  totals: string[]
  net_pay: (string | null)[]
  savings_rate: (string | null)[]
  four_pct_rule: (string | null)[]
}

export interface SpendingMonth {
  month: string
  exists: boolean
  net_pay: string | null
  amounts: AmountEntry[]
}

export interface SpendingUpsertResult {
  month: string
  created: number
  updated: number
  unchanged: number
  net_pay_set: boolean
}

export interface YearRollup {
  year: number
  by_category: { category_id: number; total: string }[]
  total: string
  net_pay_total: string | null
  savings_rate: string | null
}

export interface SpendingYearly {
  years: YearRollup[]
}
```

- [ ] **Step 6: Create the typed fetchers**

`src/api/netWorth.ts`:

```typescript
import { api } from './client'
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

export function fetchAccounts(): Promise<AccountOut[]> {
  return api<AccountOut[]>('/net-worth/accounts')
}

export function createAccount(body: AccountCreate): Promise<AccountOut> {
  return api<AccountOut>('/net-worth/accounts', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function updateAccount(id: number, body: AccountUpdate): Promise<AccountOut> {
  return api<AccountOut>(`/net-worth/accounts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function fetchTimeseries(
  granularity: 'monthly' | 'quarterly' = 'monthly',
): Promise<NetWorthTimeseries> {
  return api<NetWorthTimeseries>(`/net-worth/timeseries?granularity=${granularity}`)
}

export function fetchSummary(): Promise<NetWorthSummary> {
  return api<NetWorthSummary>('/net-worth/summary')
}

export function fetchMonthBalances(month: string): Promise<MonthBalances> {
  return api<MonthBalances>(`/net-worth/months/${month}`)
}

export function putMonthBalances(
  month: string,
  body: { recorded_on?: string; notes?: string; balances: BalanceEntry[] },
): Promise<MonthUpsertResult> {
  return api<MonthUpsertResult>(`/net-worth/months/${month}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}
```

`src/api/spending.ts`:

```typescript
import { api } from './client'
import type {
  AmountEntry,
  CategoryOut,
  SpendingMatrix,
  SpendingMonth,
  SpendingUpsertResult,
  SpendingYearly,
} from '../types/api'

export function fetchCategories(): Promise<CategoryOut[]> {
  return api<CategoryOut[]>('/spending/categories')
}

export function fetchMatrix(): Promise<SpendingMatrix> {
  return api<SpendingMatrix>('/spending/matrix')
}

export function fetchYearly(): Promise<SpendingYearly> {
  return api<SpendingYearly>('/spending/yearly')
}

export function fetchSpendingMonth(month: string): Promise<SpendingMonth> {
  return api<SpendingMonth>(`/spending/months/${month}`)
}

export function putSpendingMonth(
  month: string,
  body: { net_pay?: string; amounts: AmountEntry[] },
): Promise<SpendingUpsertResult> {
  return api<SpendingUpsertResult>(`/spending/months/${month}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}
```

- [ ] **Step 7: Gate + commit**

```bash
npm test && npm run lint && npm run build
git add src/api/client.ts src/api/client.test.ts src/types/api.ts src/api/netWorth.ts src/api/spending.ts
git commit -m "feat: api client timeout + typed net-worth/spending fetchers"
```

---

### Task 10: Charting foundation — echarts dep, registration module, theme, `<EChart>`, format utils (TDD for utils)

**Files:**
- Modify: `package.json` (+ echarts)
- Create: `src/charts/echarts.ts`
- Create: `src/charts/theme.ts`
- Create: `src/components/EChart.tsx`
- Create: `src/utils/format.ts`, `src/utils/format.test.ts`
- Create: `src/utils/months.ts`, `src/utils/months.test.ts`

- [ ] **Step 1: Install echarts**

```bash
npm install echarts@^6.1.0
```
Expected: lockfile gains echarts + zrender only. (echarts 6 keeps the v5 `echarts/core` API; if the wrapper's types fail to compile under 6.x, fall back to `npm install echarts@^5.6.0` and record it — the code below is valid for both.)

- [ ] **Step 2: Write failing util tests**

`src/utils/format.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { escapeHtml, formatCurrency, formatCurrencyCompact, formatMonth, formatPct } from './format'

describe('formatCurrency', () => {
  it('formats server decimal strings', () => {
    expect(formatCurrency('1234.50')).toBe('$1,234.50')
    expect(formatCurrency('-50.00')).toBe('-$50.00')
    expect(formatCurrency(null)).toBe('—')
  })
  it('compacts large values', () => {
    expect(formatCurrencyCompact('1234567.89')).toBe('$1.23M')
    expect(formatCurrencyCompact('4500.00')).toBe('$4.5K')
    expect(formatCurrencyCompact('950.00')).toBe('$950')
  })
})

describe('formatPct', () => {
  it('renders signed percentages from decimal-fraction strings', () => {
    expect(formatPct('0.068959')).toBe('+6.9%')
    expect(formatPct('-0.012000')).toBe('-1.2%')
    expect(formatPct('0.000000')).toBe('+0.0%')
    expect(formatPct(null)).toBe('—')
  })
  it('supports unsigned mode', () => {
    expect(formatPct('0.750000', { signed: false })).toBe('75.0%')
  })
})

describe('formatMonth', () => {
  it('renders ISO first-of-month as short label', () => {
    expect(formatMonth('2026-08-01')).toBe('Aug 2026')
  })
})

describe('escapeHtml', () => {
  it('escapes the five HTML specials', () => {
    expect(escapeHtml(`<b>&"'`)).toBe('&lt;b&gt;&amp;&quot;&#39;')
  })
})
```

`src/utils/months.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { addMonths, currentMonthIso, lastNMonths } from './months'

describe('addMonths', () => {
  it('moves across year boundaries', () => {
    expect(addMonths('2026-01-01', -1)).toBe('2025-12-01')
    expect(addMonths('2025-12-01', 1)).toBe('2026-01-01')
    expect(addMonths('2026-08-01', -12)).toBe('2025-08-01')
  })
})

describe('lastNMonths', () => {
  it('returns ascending window ending at the anchor', () => {
    expect(lastNMonths('2026-03-01', 3)).toEqual(['2026-01-01', '2026-02-01', '2026-03-01'])
  })
})

describe('currentMonthIso', () => {
  it('is a first-of-month ISO date', () => {
    expect(currentMonthIso()).toMatch(/^\d{4}-\d{2}-01$/)
  })
})
```

- [ ] **Step 3: Run — expect FAIL** (`npm test` — modules missing).

- [ ] **Step 4: Implement the utils**

`src/utils/format.ts`:

```typescript
// Server money/percent values arrive as decimal STRINGS (pydantic v2). Number() here is
// display-only — never feed the result back to the API.

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
})

export function formatCurrency(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  return currency.format(Number(value))
}

export function formatCurrencyCompact(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const n = Number(value)
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`
  return `${sign}$${Math.round(abs)}`
}

export function formatPct(
  value: string | number | null | undefined,
  { signed = true }: { signed?: boolean } = {},
): string {
  if (value === null || value === undefined || value === '') return '—'
  const pct = Number(value) * 100
  const body = `${Math.abs(pct).toFixed(1)}%`
  if (!signed) return pct < 0 ? `-${body}` : body
  return pct < 0 ? `-${body}` : `+${body}`
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function formatMonth(iso: string): string {
  // Never `new Date(iso)` — UTC parsing shifts first-of-month a day back in negative offsets.
  const [year, month] = iso.split('-')
  return `${MONTH_NAMES[Number(month) - 1]} ${year}`
}

export function escapeHtml(raw: string): string {
  // ECharts tooltip formatters build HTML strings; account/category names are user text.
  return raw
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
```

`src/utils/months.ts`:

```typescript
// ISO first-of-month strings ('2026-08-01') are the app's month currency. All math is
// string/int based — Date objects only for "today", avoiding timezone edge cases.

export function addMonths(iso: string, delta: number): string {
  const [year, month] = iso.split('-').map(Number)
  const index = year * 12 + (month - 1) + delta
  const y = Math.floor(index / 12)
  const m = (index % 12) + 1
  return `${y}-${String(m).padStart(2, '0')}-01`
}

export function lastNMonths(anchorIso: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => addMonths(anchorIso, i - (n - 1)))
}

export function currentMonthIso(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}
```

- [ ] **Step 5: Run — expect PASS.**

- [ ] **Step 6: Chart registration + theme + wrapper**

`src/charts/theme.ts`:

```typescript
// THE chart color source of truth. dataviz-validated 2026-08-14 on surface #171a21
// (all six checks pass: lightness band, chroma, adjacent CVD dE 8.4, normal-vision 19.3,
// contrast >= 3:1). Fixed slot order IS the CVD-safety mechanism — never reorder, never
// cycle past 8, never invent a hue outside this file.
import type { AccountGroup } from '../types/api'

export const PALETTE = [
  '#3987e5', // 1 blue
  '#d95926', // 2 orange
  '#199e70', // 3 aqua
  '#c98500', // 4 yellow
  '#d55181', // 5 magenta
  '#008300', // 6 green
  '#9085e9', // 7 violet
  '#e66767', // 8 red
] as const

// Groups wear fixed entity colors (stack adjacency = validated palette adjacency).
export const GROUP_COLORS: Record<AccountGroup, string> = {
  cash: PALETTE[0],
  pre_tax: PALETTE[1],
  post_tax: PALETTE[2],
  taxable: PALETTE[3],
  equity: PALETTE[4],
  other: PALETTE[5],
  liability: PALETTE[7],
}

export const GROUP_LABELS: Record<AccountGroup, string> = {
  cash: 'Cash',
  pre_tax: 'Pre-tax',
  post_tax: 'Post-tax',
  taxable: 'Taxable',
  equity: 'Equity',
  other: 'Other',
  liability: 'Liabilities',
}

export const GROUP_ORDER: AccountGroup[] = [
  'cash', 'pre_tax', 'post_tax', 'taxable', 'equity', 'other', 'liability',
]

// Sequential blue, dark -> light on the dark surface (near-zero recedes to the card).
export const SEQUENTIAL_BLUE = [
  '#0d366b', '#104281', '#184f95', '#1c5cab', '#256abf', '#2a78d6',
  '#3987e5', '#5598e7', '#6da7ec', '#86b6ef', '#9ec5f4', '#cde2fb',
] as const

export const OTHER_SERIES_COLOR = '#4a5060' // neutral gray for the folded "Other" stack

export const INK = '#e6e9ef'
export const MUTED = '#8b93a3'
export const GRID_LINE = '#1e222c' // one step off the card surface, solid hairline
export const AXIS_LINE = '#262b36'
export const SURFACE = '#171a21'
export const SURFACE_2 = '#1e222c'
export const POSITIVE = '#3fb968'
export const NEGATIVE = '#e05252'

const FONT_FAMILY = "system-ui, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

// Registered once by src/charts/echarts.ts.
export const FINANCE_THEME = {
  color: [...PALETTE],
  backgroundColor: 'transparent',
  textStyle: { color: MUTED, fontFamily: FONT_FAMILY },
  categoryAxis: {
    axisLine: { lineStyle: { color: AXIS_LINE } },
    axisTick: { show: false },
    axisLabel: { color: MUTED },
    splitLine: { show: false },
  },
  valueAxis: {
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: MUTED },
    splitLine: { lineStyle: { color: GRID_LINE, width: 1, type: 'solid' } },
  },
  legend: {
    textStyle: { color: INK, fontSize: 12 },
    icon: 'roundRect',
    itemWidth: 12,
    itemHeight: 8,
  },
  tooltip: {
    backgroundColor: SURFACE_2,
    borderColor: AXIS_LINE,
    borderWidth: 1,
    textStyle: { color: INK, fontSize: 12 },
    extraCssText: 'box-shadow: 0 4px 16px rgba(0,0,0,0.4); border-radius: 8px;',
  },
}
```

`src/charts/echarts.ts`:

```typescript
// Tree-shaken echarts surface: everything chart-related imports from HERE, never from
// 'echarts' directly (the full bundle is ~1MB; this registers only what the app draws).
import { BarChart, HeatmapChart, LineChart } from 'echarts/charts'
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import type {
  BarSeriesOption,
  HeatmapSeriesOption,
  LineSeriesOption,
} from 'echarts/charts'
import type {
  DataZoomComponentOption,
  GridComponentOption,
  LegendComponentOption,
  TooltipComponentOption,
  VisualMapComponentOption,
} from 'echarts/components'
import type { ComposeOption } from 'echarts/core'
import { FINANCE_THEME } from './theme'

echarts.use([
  BarChart,
  LineChart,
  HeatmapChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  VisualMapComponent,
  MarkLineComponent,
  DataZoomComponent,
  CanvasRenderer,
])

echarts.registerTheme('finance', FINANCE_THEME)

export type EChartsOption = ComposeOption<
  | BarSeriesOption
  | LineSeriesOption
  | HeatmapSeriesOption
  | GridComponentOption
  | TooltipComponentOption
  | LegendComponentOption
  | VisualMapComponentOption
  | DataZoomComponentOption
>

export { echarts }
```

`src/components/EChart.tsx`:

```tsx
import { useEffect, useRef } from 'react'
import { echarts } from '../charts/echarts'
import type { EChartsOption } from '../charts/echarts'

type EChartsInstance = ReturnType<typeof echarts.init>

const REDUCED_MOTION =
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

export default function EChart({
  option,
  height = 320,
  onClick,
}: {
  option: EChartsOption
  height?: number
  onClick?: (params: { seriesName?: string; name?: string }) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<EChartsInstance | null>(null)
  const onClickRef = useRef(onClick)
  onClickRef.current = onClick

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const chart = echarts.init(el, 'finance')
    chart.on('click', (params) => onClickRef.current?.(params as { seriesName?: string }))
    chartRef.current = chart
    const observer = new ResizeObserver(() => chart.resize())
    observer.observe(el)
    return () => {
      observer.disconnect()
      chart.dispose()
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    // notMerge: pages always send complete options; merging stale series causes ghosts.
    chartRef.current?.setOption({ animation: !REDUCED_MOTION, ...option }, { notMerge: true })
  }, [option])

  return <div ref={containerRef} style={{ height, width: '100%' }} />
}
```

- [ ] **Step 7: Full frontend gate + commit**

```bash
npm test && npm run lint && npm run build
```
Expected: build succeeds; bundle grows by roughly 350–450 kB raw (echarts core slice) — record the exact `dist/assets` main-chunk size in the commit body for the Plan 6 budget discussion.

```bash
git add package.json package-lock.json src/charts src/components/EChart.tsx src/utils
git commit -m "feat: echarts foundation — validated dark theme, wrapper, format utils"
```

---

### Task 11: Shared page chrome — `panels.css`, `StatTile`, `MonthRibbon` (TDD for MonthRibbon)

**Files:**
- Create: `src/components/panels.css`
- Create: `src/components/StatTile.tsx`
- Create: `src/components/MonthRibbon.tsx`
- Create: `src/components/MonthRibbon.test.tsx`

- [ ] **Step 1: Write the failing MonthRibbon test**

`src/components/MonthRibbon.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import MonthRibbon from './MonthRibbon'

afterEach(cleanup)

it('renders a chip per month, marks coverage and selection, and fires onSelect', () => {
  const onSelect = vi.fn()
  render(
    <MonthRibbon
      anchor="2026-03-01"
      count={3}
      filledMonths={new Set(['2026-01-01', '2026-03-01'])}
      selected="2026-03-01"
      onSelect={onSelect}
    />,
  )
  const chips = screen.getAllByRole('button')
  expect(chips).toHaveLength(3)
  expect(chips[0].className).toContain('filled') // Jan has data
  expect(chips[1].className).not.toContain('filled') // Feb missing
  expect(chips[2].className).toContain('selected')
  // Plain attribute assert — this project doesn't install jest-dom matchers.
  expect(chips[1].getAttribute('aria-label')).toBe('Feb 2026 — no data')
  fireEvent.click(chips[1])
  expect(onSelect).toHaveBeenCalledWith('2026-02-01')
})
```

- [ ] **Step 2: Run — expect FAIL** (`npm test`).

- [ ] **Step 3: Implement MonthRibbon**

`src/components/MonthRibbon.tsx`:

```tsx
import { formatMonth } from '../utils/format'
import { lastNMonths } from '../utils/months'
import './panels.css'

// The app's signature device: a last-N-months coverage strip. Filled chip = the month
// has data, hollow = missing, ring = selected. Heads both module pages (read-only
// navigation into the wizard) and the wizard itself (month picker).
export default function MonthRibbon({
  anchor,
  count = 12,
  filledMonths,
  selected,
  onSelect,
}: {
  anchor: string
  count?: number
  filledMonths: Set<string>
  selected?: string
  onSelect: (monthIso: string) => void
}) {
  return (
    <div className="month-ribbon" role="group" aria-label="Month coverage">
      {lastNMonths(anchor, count).map((month) => {
        const filled = filledMonths.has(month)
        const classes = [
          'month-chip',
          filled ? 'filled' : '',
          month === selected ? 'selected' : '',
        ]
          .filter(Boolean)
          .join(' ')
        const label = `${formatMonth(month)}${filled ? '' : ' — no data'}`
        return (
          <button
            key={month}
            type="button"
            className={classes}
            title={label}
            aria-label={label}
            onClick={() => onSelect(month)}
          >
            <span className="month-chip-dot" aria-hidden="true" />
            <span className="month-chip-label">{formatMonth(month).slice(0, 3)}</span>
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: Implement StatTile**

`src/components/StatTile.tsx`:

```tsx
import './panels.css'

// Stat-tile contract (dataviz): label · value · optional delta ("direction x whether up
// is good" is the caller's job — pass `tone`). Deltas always pair a glyph with the color.
export default function StatTile({
  label,
  value,
  delta,
  tone,
  hero = false,
}: {
  label: string
  value: string
  delta?: string
  tone?: 'positive' | 'negative' | 'neutral'
  hero?: boolean
}) {
  const glyph = tone === 'positive' ? '▲' : tone === 'negative' ? '▼' : ''
  return (
    <div className={hero ? 'stat-tile stat-tile-hero' : 'stat-tile'}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {delta !== undefined && (
        <div className={`stat-delta stat-delta-${tone ?? 'neutral'}`}>
          {glyph && <span aria-hidden="true">{glyph} </span>}
          {delta}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: The shared panel stylesheet**

`src/components/panels.css` — the whole Plan 3 visual layer lives here + per-page css; tokens come from `index.css` (unchanged):

```css
/* ── Page scaffolding ──────────────────────────────────────────────── */

.page {
  padding: 1.75rem 2rem 3rem;
  max-width: 1240px;
}

.page-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1.25rem;
}

.page-header h1 {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 650;
  letter-spacing: -0.01em;
}

.page-header .spacer {
  flex: 1;
}

/* ── Cards ─────────────────────────────────────────────────────────── */

.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 1.1rem 1.25rem 1.25rem;
  min-width: 0;
}

.card-grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(12, 1fr);
}

.card-grid > .span-12 { grid-column: span 12; }
.card-grid > .span-8 { grid-column: span 8; }
.card-grid > .span-6 { grid-column: span 6; }
.card-grid > .span-4 { grid-column: span 4; }

@media (max-width: 1000px) {
  .card-grid > .span-8,
  .card-grid > .span-6,
  .card-grid > .span-4 { grid-column: span 12; }
}

.eyebrow {
  margin: 0 0 0.75rem;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--muted);
}

/* ── Stat tiles ────────────────────────────────────────────────────── */

.kpi-row {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  margin-bottom: 1rem;
}

.stat-tile {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 0.9rem 1.1rem 1rem;
}

.stat-label {
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--muted);
  margin-bottom: 0.45rem;
}

.stat-value {
  font-family: ui-monospace, 'Cascadia Mono', 'Segoe UI Mono', Menlo, Consolas, monospace;
  font-size: 1.45rem;
  font-weight: 600;
  line-height: 1.1;
}

.stat-tile-hero .stat-value {
  font-size: 2.4rem;
}

.stat-delta {
  margin-top: 0.35rem;
  font-size: 0.8rem;
}

.stat-delta-positive { color: var(--positive); }
.stat-delta-negative { color: var(--negative); }
.stat-delta-neutral { color: var(--muted); }

/* ── Month ribbon (signature) ──────────────────────────────────────── */

.month-ribbon {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.month-chip {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 6px 7px 5px;
  background: none;
  border: 1px solid transparent;
  border-radius: 8px;
  color: var(--muted);
  cursor: pointer;
  font-size: 0.65rem;
  line-height: 1;
}

.month-chip:hover { background: var(--surface-2); }

.month-chip:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.month-chip-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 1.5px solid var(--muted);
}

.month-chip.filled .month-chip-dot {
  background: var(--accent);
  border-color: var(--accent);
}

.month-chip.selected {
  border-color: var(--accent);
  color: var(--text);
}

/* ── Data tables ───────────────────────────────────────────────────── */

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}

.data-table th {
  text-align: left;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--muted);
  padding: 0.5rem 0.6rem;
  border-bottom: 1px solid var(--border);
}

.data-table td {
  padding: 0.45rem 0.6rem;
  border-bottom: 1px solid var(--surface-2);
}

.data-table .num {
  text-align: right;
  font-family: ui-monospace, 'Cascadia Mono', 'Segoe UI Mono', Menlo, Consolas, monospace;
  font-variant-numeric: tabular-nums;
}

.data-table tr.component-row td:first-child {
  padding-left: 1.6rem;
  color: var(--muted);
}

.badge {
  display: inline-block;
  margin-left: 0.5rem;
  padding: 0.1rem 0.4rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  font-size: 0.625rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--muted);
}

.delta-positive { color: var(--positive); }
.delta-negative { color: var(--negative); }

/* ── Forms & buttons ───────────────────────────────────────────────── */

.button {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.5rem 0.9rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-2);
  color: var(--text);
  font-size: 0.85rem;
  cursor: pointer;
}

.button:hover { border-color: var(--muted); }

.button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.button-primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #0b0e14;
  font-weight: 600;
}

.button-primary:hover { filter: brightness(1.1); }

.button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.field-input {
  width: 100%;
  padding: 0.4rem 0.55rem;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-family: ui-monospace, 'Cascadia Mono', 'Segoe UI Mono', Menlo, Consolas, monospace;
  font-size: 0.85rem;
  text-align: right;
}

.field-input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 0;
  border-color: var(--accent);
}

.segmented {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}

.segmented button {
  padding: 0.35rem 0.8rem;
  border: none;
  background: none;
  color: var(--muted);
  font-size: 0.8rem;
  cursor: pointer;
}

.segmented button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.segmented button.active {
  background: var(--surface-2);
  color: var(--text);
}

.error-banner {
  margin: 0.75rem 0;
  padding: 0.6rem 0.9rem;
  border: 1px solid var(--negative);
  border-radius: 8px;
  color: var(--negative);
  font-size: 0.85rem;
}

.empty-note {
  color: var(--muted);
  font-size: 0.85rem;
  padding: 1.5rem 0;
  text-align: center;
}
```

- [ ] **Step 6: Gate + commit**

```bash
npm test && npm run lint && npm run build
git add src/components/panels.css src/components/StatTile.tsx src/components/MonthRibbon.tsx src/components/MonthRibbon.test.tsx
git commit -m "feat: shared page chrome — stat tiles, month-coverage ribbon, panel styles"
```

---

### Task 12: Net Worth page

**Files:**
- Create: `src/pages/NetWorthPage.tsx`
- Create: `src/pages/NetWorthPage.css`
- Modify: `src/App.tsx` (swap the `/net-worth` placeholder for the real page)

No RTL test for the page (spec §9: charts verified visually; Task 15 is the visual gate). The gate here is `tsc` + lint + build + the Task 15 walkthrough.

**Design contract (from the frozen chart rules):** one stacked area of the six ASSET groups (validated palette adjacency, entity colors from `GROUP_COLORS`), liabilities as their own negative area (NOT in the stack), NET WORTH as a 2.5px ink line with a selective end label — one $ axis, legend present, axis-trigger tooltip with currency formatting. Table = the chart's data twin. Drill-down = up to 3 accounts (all-pairs-validated slots 1–3), colors assigned by selection order, survivors keep their color.

- [ ] **Step 1: Write the page**

`src/pages/NetWorthPage.css`:

```css
.networth-chart-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.drill-hint {
  color: var(--muted);
  font-size: 0.75rem;
  margin: 0 0 0.5rem;
}

.loading-dim {
  transition: opacity 0.15s ease;
}

.loading-dim.is-loading {
  opacity: 0.55;
}
```

`src/pages/NetWorthPage.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PencilLine } from 'lucide-react'
import { fetchSummary, fetchTimeseries } from '../api/netWorth'
import { ApiError } from '../api/client'
import EChart from '../components/EChart'
import MonthRibbon from '../components/MonthRibbon'
import StatTile from '../components/StatTile'
import type { EChartsOption } from '../charts/echarts'
import {
  GROUP_COLORS,
  GROUP_LABELS,
  GROUP_ORDER,
  INK,
  PALETTE,
} from '../charts/theme'
import type { AccountGroup, NetWorthSummary, NetWorthTimeseries } from '../types/api'
import {
  formatCurrency,
  formatCurrencyCompact,
  formatMonth,
  formatPct,
} from '../utils/format'
import { currentMonthIso } from '../utils/months'
import '../components/panels.css'
import './NetWorthPage.css'

const ASSET_GROUPS = GROUP_ORDER.filter((g): g is AccountGroup => g !== 'liability')
const MAX_DRILL = 3

function pctChange(curr: string | null, prev: string | null): number | null {
  if (curr === null || prev === null || Number(prev) === 0) return null
  return (Number(curr) - Number(prev)) / Math.abs(Number(prev))
}

export default function NetWorthPage() {
  const navigate = useNavigate()
  const [granularity, setGranularity] = useState<'monthly' | 'quarterly'>('monthly')
  const [data, setData] = useState<NetWorthTimeseries | null>(null)
  const [summary, setSummary] = useState<NetWorthSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Drill-down: selection order assigns the lowest free palette slot; removing one
  // never repaints the survivors (dataviz: color follows the entity, not its rank).
  const [drill, setDrill] = useState<{ accountId: number; slot: number }[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [ts, sum] = await Promise.all([fetchTimeseries(granularity), fetchSummary()])
      setData(ts)
      setSummary(sum)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load net worth data')
    } finally {
      setLoading(false)
    }
  }, [granularity])

  useEffect(() => {
    void load()
  }, [load])

  const filledMonths = useMemo(() => new Set(data?.months ?? []), [data])
  const anchor = useMemo(() => {
    const cur = currentMonthIso()
    const latest = data?.months.at(-1)
    return latest && latest > cur ? latest : cur
  }, [data])

  const stackedOption = useMemo<EChartsOption | null>(() => {
    if (!data || data.months.length === 0) return null
    const labels = data.months.map(formatMonth)
    return {
      grid: { left: 70, right: 84, top: 40, bottom: 28 },
      legend: { top: 0 },
      tooltip: {
        trigger: 'axis',
        valueFormatter: (value) => formatCurrency(value as number),
      },
      xAxis: { type: 'category', data: labels, boundaryGap: false },
      yAxis: {
        type: 'value',
        axisLabel: { formatter: (value: number) => formatCurrencyCompact(value) },
      },
      series: [
        ...ASSET_GROUPS.map((group) => ({
          name: GROUP_LABELS[group],
          type: 'line' as const,
          stack: 'assets',
          symbol: 'none' as const,
          lineStyle: { width: 1 },
          areaStyle: { opacity: 0.5 },
          color: GROUP_COLORS[group],
          data: data.group_totals[group].map(Number),
        })),
        {
          name: GROUP_LABELS.liability,
          type: 'line' as const,
          symbol: 'none' as const,
          lineStyle: { width: 1 },
          areaStyle: { opacity: 0.5 },
          color: GROUP_COLORS.liability,
          data: data.group_totals.liability.map(Number),
        },
        {
          name: 'Net worth',
          type: 'line' as const,
          symbol: 'none' as const,
          lineStyle: { width: 2.5 },
          color: INK,
          z: 10,
          endLabel: {
            show: true,
            color: INK,
            fontWeight: 600,
            formatter: (params: { value?: unknown }) =>
              formatCurrencyCompact(params.value as number),
          },
          data: data.net_worth.map(Number),
        },
      ],
    }
  }, [data])

  const drillOption = useMemo<EChartsOption | null>(() => {
    if (!data || drill.length === 0) return null
    const byId = new Map(data.series.map((s) => [s.account_id, s.values]))
    const nameById = new Map(data.accounts.map((a) => [a.id, a.name]))
    return {
      grid: { left: 70, right: 24, top: 40, bottom: 28 },
      legend: { top: 0 },
      tooltip: {
        trigger: 'axis',
        valueFormatter: (value) =>
          value === null || value === undefined ? '—' : formatCurrency(value as number),
      },
      xAxis: { type: 'category', data: data.months.map(formatMonth), boundaryGap: false },
      yAxis: {
        type: 'value',
        axisLabel: { formatter: (value: number) => formatCurrencyCompact(value) },
      },
      series: drill.map(({ accountId, slot }) => ({
        name: nameById.get(accountId) ?? String(accountId),
        type: 'line' as const,
        symbol: 'circle' as const,
        symbolSize: 8,
        showSymbol: false,
        lineStyle: { width: 2 },
        color: PALETTE[slot],
        connectNulls: false,
        data: (byId.get(accountId) ?? []).map((v) => (v === null ? null : Number(v))),
      })),
    }
  }, [data, drill])

  const toggleDrill = (accountId: number) => {
    setDrill((current) => {
      const existing = current.find((d) => d.accountId === accountId)
      if (existing) return current.filter((d) => d.accountId !== accountId)
      if (current.length >= MAX_DRILL) return current
      const used = new Set(current.map((d) => d.slot))
      const slot = [0, 1, 2].find((s) => !used.has(s)) ?? 0
      return [...current, { accountId, slot }]
    })
  }

  const months = data?.months ?? []
  const lastIndex = months.length - 1
  const momHeader = granularity === 'quarterly' ? 'QoQ %' : 'MoM %'

  return (
    <div className="page">
      <div className="page-header">
        <h1>Net worth</h1>
        <div className="spacer" />
        <MonthRibbon
          anchor={anchor}
          filledMonths={filledMonths}
          onSelect={(month) => navigate(`/update?month=${month}`)}
        />
        <button className="button button-primary" onClick={() => navigate('/update')}>
          <PencilLine size={15} /> Enter month
        </button>
      </div>

      {error && (
        <div className="error-banner" role="alert">
          {error}{' '}
          <button className="button" onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}

      {summary && summary.month && (
        <div className="kpi-row">
          <StatTile
            hero
            label={`Net worth — ${formatMonth(summary.month)}`}
            value={formatCurrency(summary.net_worth)}
            delta={
              summary.mom_delta === null
                ? undefined
                : `${formatCurrency(summary.mom_delta)} (${formatPct(summary.mom_pct)}) vs prior month`
            }
            tone={
              summary.mom_delta === null
                ? 'neutral'
                : Number(summary.mom_delta) >= 0
                  ? 'positive'
                  : 'negative'
            }
          />
          {(['taxable', 'pre_tax', 'liability'] as AccountGroup[]).map((group) => {
            const entry = summary.groups.find((g) => g.group === group)
            if (!entry) return null
            const delta = entry.mom_delta
            return (
              <StatTile
                key={group}
                label={GROUP_LABELS[group]}
                value={formatCurrency(entry.total)}
                delta={delta === null ? undefined : `${formatCurrency(delta)} vs prior`}
                tone={delta === null ? 'neutral' : Number(delta) >= 0 ? 'positive' : 'negative'}
              />
            )
          })}
        </div>
      )}

      <div className={`card-grid loading-dim${loading ? ' is-loading' : ''}`}>
        <div className="card span-12">
          <div className="networth-chart-header">
            <h2 className="eyebrow">By group over time</h2>
            <div className="segmented" role="group" aria-label="Granularity">
              {(['monthly', 'quarterly'] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  className={granularity === g ? 'active' : ''}
                  onClick={() => setGranularity(g)}
                >
                  {g === 'monthly' ? 'Monthly' : 'Quarterly'}
                </button>
              ))}
            </div>
          </div>
          {stackedOption ? (
            <EChart option={stackedOption} height={360} />
          ) : (
            !loading && (
              <div className="empty-note">
                No snapshots yet — enter your first month to start the chart.
              </div>
            )
          )}
        </div>

        <div className="card span-12">
          <h2 className="eyebrow">Accounts — latest {granularity === 'quarterly' ? 'quarter' : 'month'}</h2>
          <p className="drill-hint">
            Select up to {MAX_DRILL} accounts to compare their history below.
          </p>
          <table className="data-table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Group</th>
                <th className="num">Balance</th>
                <th className="num">{momHeader}</th>
              </tr>
            </thead>
            <tbody>
              {data?.accounts.map((account) => {
                const values = data.series.find((s) => s.account_id === account.id)?.values ?? []
                const curr = lastIndex >= 0 ? values[lastIndex] : null
                const prev = lastIndex >= 1 ? values[lastIndex - 1] : null
                const pct = pctChange(curr, prev)
                const selected = drill.some((d) => d.accountId === account.id)
                return (
                  <tr
                    key={account.id}
                    className={account.is_component ? 'component-row' : undefined}
                    onClick={() => toggleDrill(account.id)}
                    style={{ cursor: 'pointer', background: selected ? 'var(--surface-2)' : undefined }}
                  >
                    <td>
                      {account.name}
                      {account.is_component && <span className="badge">component</span>}
                      {!account.is_active && <span className="badge">inactive</span>}
                    </td>
                    <td>{GROUP_LABELS[account.group]}</td>
                    <td className="num">{formatCurrency(curr)}</td>
                    <td className="num">
                      {pct === null ? (
                        '—'
                      ) : (
                        <span className={pct >= 0 ? 'delta-positive' : 'delta-negative'}>
                          {formatPct(pct)}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            {data && months.length > 0 && (
              <tfoot>
                <tr>
                  <td style={{ fontWeight: 600 }}>Net worth</td>
                  <td />
                  <td className="num" style={{ fontWeight: 600 }}>
                    {formatCurrency(data.net_worth[lastIndex])}
                  </td>
                  <td className="num">{formatPct(data.mom_pct[lastIndex])}</td>
                </tr>
              </tfoot>
            )}
          </table>
          <p className="drill-hint" style={{ marginTop: '0.5rem' }}>
            Component accounts are tracked inside an aggregate account and are excluded
            from group totals and net worth.
          </p>
        </div>

        {drillOption && (
          <div className="card span-12">
            <h2 className="eyebrow">Account drill-down</h2>
            <EChart option={drillOption} height={280} />
          </div>
        )}
      </div>
    </div>
  )
}
```

Note: this page uses no HTML-string tooltip formatters (only `valueFormatter`, which is text-only), so `escapeHtml` is intentionally not imported here — it becomes load-bearing in Task 13's heatmap formatter.

- [ ] **Step 2: Wire the route**

In `src/App.tsx`: `import NetWorthPage from './pages/NetWorthPage'` and change the net-worth route to `<Route path="/net-worth" element={<NetWorthPage />} />`. Leave the other placeholders alone (Tasks 13/14 replace theirs).

- [ ] **Step 3: Gate + visual smoke + commit**

```bash
npm test && npm run lint && npm run build
```

Then a dev-server smoke against real data (backend from the worktree venv, DB already running). Implementer subagents SKIP this visual part (Task 15 is the systematic visual gate) — the controller may spot-check now if convenient:

```bash
cd backend && (.venv/Scripts/uvicorn app.main:app --port 8000 &) && curl --retry 15 --retry-connrefused --retry-delay 1 -s http://127.0.0.1:8000/api/v1/health && cd ..
npm run dev
```

Log in (admin@example.com / changeme123), open `/net-worth`, confirm: chart renders 37 months with 6 stacked asset bands + negative liability band + ink net-worth line with end label; table shows 25 accounts with the five component rows indented + badged; clicking rows draws the drill-down (max 3). Leave both servers running if proceeding straight to Task 13; otherwise kill (netstat PID + uvicorn.exe).

```bash
git add src/pages/NetWorthPage.tsx src/pages/NetWorthPage.css src/App.tsx
git commit -m "feat: net worth page — stacked groups, account table, drill-down"
```

---

### Task 13: Spending page

**Files:**
- Create: `src/pages/SpendingPage.tsx`
- Create: `src/pages/SpendingPage.css`
- Modify: `src/App.tsx` (swap the `/spending` placeholder)

**Design contract:** four cards — (1) stacked monthly bars folded to **top-7 categories + gray "Other"** with the net-pay ink line and the dashed muted 4%-rule threshold (all $, one axis); (2) the month × category **heatmap** (full 19-category detail, sequential blue dark→light, HTML tooltip built with `escapeHtml`); (3) **savings rate** as its own % chart (never a second axis on the bars), y clamped to ±100% with true values in the tooltip; (4) **category trends** with chip-select ≤3 (slots 1–3, survivors keep colors). Yearly rollup table = the data twin. The savings-rate chart is labeled "actual" (the sheet's column was a planned rate — Verified rollup semantics).

- [ ] **Step 1: Write the page**

`src/pages/SpendingPage.css`:

```css
.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 0.75rem;
}

.chip {
  padding: 0.25rem 0.7rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: none;
  color: var(--muted);
  font-size: 0.75rem;
  cursor: pointer;
}

.chip:hover { background: var(--surface-2); }

.chip:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.chip.active {
  color: var(--text);
  border-color: currentColor;
}

.yearly-scroll {
  overflow-x: auto;
}
```

`src/pages/SpendingPage.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PencilLine } from 'lucide-react'
import { ApiError } from '../api/client'
import { fetchMatrix, fetchYearly } from '../api/spending'
import EChart from '../components/EChart'
import MonthRibbon from '../components/MonthRibbon'
import StatTile from '../components/StatTile'
import type { EChartsOption } from '../charts/echarts'
import {
  INK,
  MUTED,
  OTHER_SERIES_COLOR,
  PALETTE,
  SEQUENTIAL_BLUE,
} from '../charts/theme'
import type { SpendingMatrix, SpendingYearly } from '../types/api'
import {
  escapeHtml,
  formatCurrency,
  formatCurrencyCompact,
  formatMonth,
  formatPct,
} from '../utils/format'
import { currentMonthIso } from '../utils/months'
import '../components/panels.css'
import './SpendingPage.css'

const TOP_N = 7
const MAX_TREND = 3

export default function SpendingPage() {
  const navigate = useNavigate()
  const [matrix, setMatrix] = useState<SpendingMatrix | null>(null)
  const [yearly, setYearly] = useState<SpendingYearly | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [trend, setTrend] = useState<{ categoryId: number; slot: number }[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [m, y] = await Promise.all([fetchMatrix(), fetchYearly()])
      setMatrix(m)
      setYearly(y)
      setTrend((current) => {
        if (current.length > 0 || m.categories.length === 0) return current
        // Default: the single biggest all-time category, slot 1.
        const totals = m.series.map((s) => ({
          id: s.category_id,
          total: s.values.reduce((acc, v) => acc + (v === null ? 0 : Number(v)), 0),
        }))
        totals.sort((a, b) => b.total - a.total)
        return [{ categoryId: totals[0].id, slot: 0 }]
      })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load spending data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const monthLabels = useMemo(() => matrix?.months.map(formatMonth) ?? [], [matrix])

  // All-time totals decide the top-7 fold AND the heatmap row order (biggest at top).
  const categoryTotals = useMemo(() => {
    if (!matrix) return []
    return matrix.series
      .map((s) => ({
        id: s.category_id,
        total: s.values.reduce((acc, v) => acc + (v === null ? 0 : Number(v)), 0),
      }))
      .sort((a, b) => b.total - a.total)
  }, [matrix])

  const nameById = useMemo(
    () => new Map((matrix?.categories ?? []).map((c) => [c.id, c.name])),
    [matrix],
  )

  const barsOption = useMemo<EChartsOption | null>(() => {
    if (!matrix || matrix.months.length === 0) return null
    const top = categoryTotals.slice(0, TOP_N).map((t) => t.id)
    const topSet = new Set(top)
    const valuesById = new Map(matrix.series.map((s) => [s.category_id, s.values]))
    const otherPerMonth = matrix.months.map((_, i) =>
      matrix.series.reduce((acc, s) => {
        if (topSet.has(s.category_id)) return acc
        const v = s.values[i]
        return acc + (v === null ? 0 : Number(v))
      }, 0),
    )
    return {
      grid: { left: 70, right: 24, top: 40, bottom: 28 },
      legend: { top: 0 },
      tooltip: {
        trigger: 'axis',
        valueFormatter: (value) =>
          value === null || value === undefined ? '—' : formatCurrency(value as number),
      },
      xAxis: { type: 'category', data: monthLabels },
      yAxis: {
        type: 'value',
        axisLabel: { formatter: (value: number) => formatCurrencyCompact(value) },
      },
      series: [
        ...top.map((id, slot) => ({
          name: nameById.get(id) ?? String(id),
          type: 'bar' as const,
          stack: 'spend',
          barMaxWidth: 22,
          color: PALETTE[slot],
          itemStyle: { borderColor: '#171a21', borderWidth: 1 },
          data: (valuesById.get(id) ?? []).map((v) => (v === null ? 0 : Number(v))),
        })),
        {
          name: 'Other',
          type: 'bar' as const,
          stack: 'spend',
          barMaxWidth: 22,
          color: OTHER_SERIES_COLOR,
          itemStyle: { borderColor: '#171a21', borderWidth: 1 },
          data: otherPerMonth,
        },
        {
          name: 'Net pay',
          type: 'line' as const,
          symbol: 'none' as const,
          lineStyle: { width: 2 },
          color: INK,
          z: 10,
          connectNulls: false,
          data: matrix.net_pay.map((v) => (v === null ? null : Number(v))),
        },
        {
          name: '4% rule',
          type: 'line' as const,
          symbol: 'none' as const,
          // Dashed is reserved for thresholds — this IS the threshold line.
          lineStyle: { width: 2, type: 'dashed' as const },
          color: MUTED,
          z: 9,
          connectNulls: false,
          data: matrix.four_pct_rule.map((v) => (v === null ? null : Number(v))),
        },
      ],
    }
  }, [matrix, categoryTotals, monthLabels, nameById])

  const heatmapOption = useMemo<EChartsOption | null>(() => {
    if (!matrix || matrix.months.length === 0) return null
    const order = categoryTotals.map((t) => t.id) // biggest at top
    const rowIndex = new Map(order.map((id, i) => [id, i]))
    const cells: [number, number, number][] = []
    let max = 0
    for (const s of matrix.series) {
      const row = rowIndex.get(s.category_id)
      if (row === undefined) continue
      s.values.forEach((v, col) => {
        if (v === null) return
        const n = Number(v)
        max = Math.max(max, n)
        cells.push([col, row, n])
      })
    }
    return {
      grid: { left: 130, right: 24, top: 8, bottom: 64 },
      tooltip: {
        // HTML formatter: category names are user text — escapeHtml is mandatory.
        formatter: (params) => {
          const p = params as { value: [number, number, number] }
          const [col, row, value] = p.value
          const name = nameById.get(order[row]) ?? ''
          return `<strong>${formatCurrency(value)}</strong><br/>${escapeHtml(name)} · ${escapeHtml(monthLabels[col] ?? '')}`
        },
      },
      xAxis: { type: 'category', data: monthLabels, axisLabel: { rotate: 45 } },
      yAxis: {
        type: 'category',
        data: order.map((id) => nameById.get(id) ?? String(id)),
        inverse: true,
        axisLabel: { width: 118, overflow: 'truncate' as const },
      },
      visualMap: {
        min: 0,
        max: Math.max(max, 1),
        calculable: false,
        orient: 'horizontal',
        left: 'center',
        bottom: 0,
        inRange: { color: [...SEQUENTIAL_BLUE] },
        textStyle: { color: MUTED },
        formatter: (value) => formatCurrencyCompact(value as number),
      },
      series: [
        {
          type: 'heatmap' as const,
          data: cells,
          itemStyle: { borderColor: '#171a21', borderWidth: 1 },
          emphasis: { itemStyle: { borderColor: INK, borderWidth: 1 } },
        },
      ],
    }
  }, [matrix, categoryTotals, monthLabels, nameById])

  const savingsOption = useMemo<EChartsOption | null>(() => {
    if (!matrix || matrix.months.length === 0) return null
    return {
      grid: { left: 60, right: 24, top: 16, bottom: 28 },
      tooltip: {
        trigger: 'axis',
        // True value in the tooltip even when the line is clamped out of frame.
        valueFormatter: (value) =>
          value === null || value === undefined ? '—' : formatPct(value as number),
      },
      xAxis: { type: 'category', data: monthLabels, boundaryGap: false },
      yAxis: {
        type: 'value',
        // Clamp the frame to ±100%; early months have wild negatives that would
        // squash the whole series otherwise.
        min: (extent: { min: number }) => Math.max(extent.min, -1),
        max: (extent: { max: number }) => Math.min(Math.max(extent.max, 0.1), 1),
        axisLabel: { formatter: (value: number) => formatPct(value, { signed: false }) },
      },
      series: [
        {
          name: 'Savings rate (actual)',
          type: 'line' as const,
          symbol: 'none' as const,
          lineStyle: { width: 2 },
          color: PALETTE[0],
          connectNulls: false,
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: MUTED, width: 1, type: 'solid' as const },
            label: { show: false },
            data: [{ yAxis: 0 }],
          },
          data: matrix.savings_rate.map((v) => (v === null ? null : Number(v))),
        },
      ],
    }
  }, [matrix, monthLabels])

  const trendOption = useMemo<EChartsOption | null>(() => {
    if (!matrix || trend.length === 0) return null
    const valuesById = new Map(matrix.series.map((s) => [s.category_id, s.values]))
    return {
      grid: { left: 70, right: 24, top: 40, bottom: 28 },
      legend: { top: 0 },
      tooltip: {
        trigger: 'axis',
        valueFormatter: (value) =>
          value === null || value === undefined ? '—' : formatCurrency(value as number),
      },
      xAxis: { type: 'category', data: monthLabels, boundaryGap: false },
      yAxis: {
        type: 'value',
        axisLabel: { formatter: (value: number) => formatCurrencyCompact(value) },
      },
      series: trend.map(({ categoryId, slot }) => ({
        name: nameById.get(categoryId) ?? String(categoryId),
        type: 'line' as const,
        symbol: 'none' as const,
        lineStyle: { width: 2 },
        color: PALETTE[slot],
        connectNulls: false,
        data: (valuesById.get(categoryId) ?? []).map((v) => (v === null ? null : Number(v))),
      })),
    }
  }, [matrix, trend, monthLabels, nameById])

  const toggleTrend = (categoryId: number) => {
    setTrend((current) => {
      const existing = current.find((t) => t.categoryId === categoryId)
      if (existing) return current.filter((t) => t.categoryId !== categoryId)
      if (current.length >= MAX_TREND) return current
      const used = new Set(current.map((t) => t.slot))
      const slot = [0, 1, 2].find((s) => !used.has(s)) ?? 0
      return [...current, { categoryId, slot }]
    })
  }

  // KPI row: latest data month + trailing-12 average + latest savings rate.
  const kpis = useMemo(() => {
    if (!matrix || matrix.months.length === 0) return null
    const last = matrix.months.length - 1
    const window = matrix.totals.slice(-12).map(Number)
    const average = window.reduce((a, b) => a + b, 0) / window.length
    return {
      month: matrix.months[last],
      total: matrix.totals[last],
      average,
      savings: matrix.savings_rate[last],
      netPay: matrix.net_pay[last],
    }
  }, [matrix])

  const filledMonths = useMemo(() => {
    const set = new Set<string>()
    matrix?.series.forEach((s) =>
      s.values.forEach((v, i) => {
        if (v !== null) set.add(matrix.months[i])
      }),
    )
    return set
  }, [matrix])

  return (
    <div className="page">
      <div className="page-header">
        <h1>Spending</h1>
        <div className="spacer" />
        <MonthRibbon
          anchor={currentMonthIso()}
          filledMonths={filledMonths}
          onSelect={(month) => navigate(`/update?month=${month}&step=spending`)}
        />
        <button
          className="button button-primary"
          onClick={() => navigate('/update?step=spending')}
        >
          <PencilLine size={15} /> Enter month
        </button>
      </div>

      {error && (
        <div className="error-banner" role="alert">
          {error}{' '}
          <button className="button" onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}

      {kpis && (
        <div className="kpi-row">
          <StatTile
            label={`Spend — ${formatMonth(kpis.month)}`}
            value={formatCurrency(kpis.total)}
          />
          <StatTile label="12-month average" value={formatCurrency(kpis.average)} />
          <StatTile
            label="Savings rate (actual)"
            value={kpis.savings === null ? '—' : formatPct(kpis.savings, { signed: false })}
            tone={kpis.savings !== null && Number(kpis.savings) >= 0 ? 'positive' : 'negative'}
          />
          <StatTile label="Net pay" value={formatCurrency(kpis.netPay)} />
        </div>
      )}

      <div className={`card-grid loading-dim${loading ? ' is-loading' : ''}`}>
        <div className="card span-12">
          <h2 className="eyebrow">Monthly spend vs net pay — top {TOP_N} categories + other</h2>
          {barsOption ? (
            <EChart option={barsOption} height={340} />
          ) : (
            !loading && (
              <div className="empty-note">No spending recorded yet — enter a month to begin.</div>
            )
          )}
        </div>

        <div className="card span-12">
          <h2 className="eyebrow">Month × category heatmap</h2>
          {heatmapOption && (
            <EChart
              option={heatmapOption}
              height={Math.max(300, (matrix?.categories.length ?? 0) * 24 + 110)}
            />
          )}
        </div>

        <div className="card span-6">
          <h2 className="eyebrow">Savings rate (actual)</h2>
          {savingsOption && <EChart option={savingsOption} height={260} />}
          <p className="drill-hint">
            (net pay − spend) ÷ net pay, per month. The old sheet's column tracked a
            planned rate, so values differ by design.
          </p>
        </div>

        <div className="card span-6">
          <h2 className="eyebrow">Category trends</h2>
          <div className="chip-row">
            {matrix?.categories.map((category) => {
              const active = trend.find((t) => t.categoryId === category.id)
              return (
                <button
                  key={category.id}
                  type="button"
                  className={active ? 'chip active' : 'chip'}
                  style={active ? { color: PALETTE[active.slot] } : undefined}
                  onClick={() => toggleTrend(category.id)}
                >
                  {category.name}
                </button>
              )
            })}
          </div>
          {trendOption ? (
            <EChart option={trendOption} height={220} />
          ) : (
            <div className="empty-note">Pick up to {MAX_TREND} categories.</div>
          )}
        </div>

        <div className="card span-12">
          <h2 className="eyebrow">Yearly rollups</h2>
          <div className="yearly-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Category</th>
                  {yearly?.years.map((y) => (
                    <th key={y.year} className="num">
                      {y.year}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix?.categories.map((category) => (
                  <tr key={category.id}>
                    <td>{category.name}</td>
                    {yearly?.years.map((y) => {
                      const cell = y.by_category.find((c) => c.category_id === category.id)
                      return (
                        <td key={y.year} className="num">
                          {formatCurrency(cell?.total ?? null)}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td style={{ fontWeight: 600 }}>Total</td>
                  {yearly?.years.map((y) => (
                    <td key={y.year} className="num" style={{ fontWeight: 600 }}>
                      {formatCurrency(y.total)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td>Net pay</td>
                  {yearly?.years.map((y) => (
                    <td key={y.year} className="num">
                      {formatCurrency(y.net_pay_total)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td>Savings rate</td>
                  {yearly?.years.map((y) => (
                    <td key={y.year} className="num">
                      {y.savings_rate === null ? '—' : formatPct(y.savings_rate, { signed: false })}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
```

TypeScript note: if `yAxis.min`/`max` as functions or the `visualMap.formatter` signature fight the strict `ComposeOption` types under the installed echarts major, prefer the narrowest legal cast (`as unknown as number` is NOT acceptable; use the option type's documented callback form or widen only that property) — the reviewer checks that no `any` sneaks in.

- [ ] **Step 2: Wire the route** (`/spending` → `<SpendingPage />` in `src/App.tsx`).

- [ ] **Step 3: Gate + visual smoke + commit**

```bash
npm test && npm run lint && npm run build
```
Dev-server check (servers as in Task 12): `/spending` shows KPI tiles for Dec 2025 (last data month), 29 bars with net-pay + dashed 4% lines, the 19-row heatmap, a savings-rate line clamped sanely despite the wild 2023 months, chip-driven trends, and the yearly table (2023/2024/2025 columns + a 2026 column only if cashflow/spending rows exist there — with current data there is none).

```bash
git add src/pages/SpendingPage.tsx src/pages/SpendingPage.css src/App.tsx
git commit -m "feat: spending page — folded stack, heatmap, savings rate, trends, yearly"
```

---

### Task 14: Monthly update wizard + routes/nav (TDD via RTL flow test)

The spreadsheet ritual replacement — the most important UX in the app (spec §6). Three steps on one route: **Balances → Spending & net pay → Review & save**. Balances pre-fill from the month itself when it exists, else from the latest prior snapshot; spending pre-fills the month or `0.00` (the sheet stores explicit zeros). Component accounts are entered like any other (they're real sheet columns) and marked as excluded from totals. Client-side math is PREVIEW only — the server quantizes and is the source of truth.

**Files:**
- Create: `src/pages/MonthlyUpdatePage.tsx`
- Create: `src/pages/MonthlyUpdatePage.css`
- Create: `src/pages/MonthlyUpdatePage.test.tsx`
- Modify: `src/App.tsx` (add `/update`)
- Modify: `src/components/Layout.tsx` (nav item)

- [ ] **Step 1: Write the failing flow test**

`src/pages/MonthlyUpdatePage.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import MonthlyUpdatePage from './MonthlyUpdatePage'

vi.mock('../api/netWorth', () => ({
  fetchAccounts: vi.fn(),
  fetchMonthBalances: vi.fn(),
  fetchTimeseries: vi.fn(),
  putMonthBalances: vi.fn(),
}))
vi.mock('../api/spending', () => ({
  fetchCategories: vi.fn(),
  fetchSpendingMonth: vi.fn(),
  putSpendingMonth: vi.fn(),
}))

import * as netWorthApi from '../api/netWorth'
import * as spendingApi from '../api/spending'

const account = {
  id: 1, name: 'Checking', slug: 'checking', group: 'cash' as const,
  sort_order: 1, is_active: true, is_component: false,
}
const category = { id: 7, name: 'Food', slug: 'food', sort_order: 1, is_active: true }

beforeEach(() => {
  vi.mocked(netWorthApi.fetchAccounts).mockResolvedValue([account])
  vi.mocked(netWorthApi.fetchMonthBalances).mockImplementation(async (month: string) => ({
    month,
    exists: month === '2026-07-01',
    recorded_on: null,
    notes: null,
    balances: month === '2026-07-01' ? [{ account_id: 1, balance: '1500.00' }] : [],
  }))
  vi.mocked(netWorthApi.putMonthBalances).mockResolvedValue({
    month: '2026-08-01', snapshot_created: true, created: 1, updated: 0, unchanged: 0,
  })
  vi.mocked(netWorthApi.fetchTimeseries).mockResolvedValue({
    months: ['2026-07-01'],
    accounts: [account],
    series: [{ account_id: 1, values: ['1500.00'] }],
    group_totals: {
      cash: ['1500.00'], pre_tax: ['0.00'], post_tax: ['0.00'], taxable: ['0.00'],
      equity: ['0.00'], other: ['0.00'], liability: ['0.00'],
    },
    net_worth: ['1500.00'],
    mom_pct: [null],
  })
  vi.mocked(spendingApi.fetchCategories).mockResolvedValue([category])
  vi.mocked(spendingApi.fetchSpendingMonth).mockResolvedValue({
    month: '2026-08-01', exists: false, net_pay: null, amounts: [],
  })
  vi.mocked(spendingApi.putSpendingMonth).mockResolvedValue({
    month: '2026-08-01', created: 1, updated: 0, unchanged: 0, net_pay_set: true,
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderWizard() {
  return render(
    <MemoryRouter initialEntries={['/update?month=2026-08-01']}>
      <MonthlyUpdatePage />
    </MemoryRouter>,
  )
}

it('walks balances -> spending -> review and submits both PUTs', async () => {
  renderWizard()
  // Step 1: balance input pre-filled from the prior month (2026-07 snapshot).
  const balanceInput = await screen.findByLabelText('Checking')
  expect((balanceInput as HTMLInputElement).value).toBe('1500.00')
  fireEvent.change(balanceInput, { target: { value: '1600.00' } })
  fireEvent.click(screen.getByRole('button', { name: /next: spending/i }))

  // Step 2: category input defaults to 0.00; net pay empty.
  const foodInput = await screen.findByLabelText('Food')
  expect((foodInput as HTMLInputElement).value).toBe('0.00')
  fireEvent.change(foodInput, { target: { value: '250.00' } })
  fireEvent.change(screen.getByLabelText(/net pay/i), { target: { value: '9000.00' } })
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))

  // Step 3: preview totals, then save.
  await screen.findByText(/review & save/i)
  expect(screen.getByText('$1,600.00')).toBeDefined() // net worth preview
  fireEvent.click(screen.getByRole('button', { name: /save month/i }))

  await waitFor(() => {
    expect(netWorthApi.putMonthBalances).toHaveBeenCalledWith(
      '2026-08-01',
      expect.objectContaining({
        balances: [{ account_id: 1, balance: '1600.00' }],
      }),
    )
    expect(spendingApi.putSpendingMonth).toHaveBeenCalledWith('2026-08-01', {
      net_pay: '9000.00',
      amounts: [{ category_id: 7, amount: '250.00' }],
    })
  })
  await screen.findByText(/month saved/i)
})

it('blocks Next while a balance is not a number', async () => {
  renderWizard()
  const balanceInput = await screen.findByLabelText('Checking')
  fireEvent.change(balanceInput, { target: { value: 'abc' } })
  expect(
    (screen.getByRole('button', { name: /next: spending/i }) as HTMLButtonElement).disabled,
  ).toBe(true)
})
```

- [ ] **Step 2: Run — expect FAIL** (`npm test` — module missing).

- [ ] **Step 3: Implement the wizard**

`src/pages/MonthlyUpdatePage.css`:

```css
.wizard-steps {
  display: flex;
  gap: 0.4rem;
  margin-bottom: 1.25rem;
}

.wizard-step {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.45rem 0.9rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: none;
  color: var(--muted);
  font-size: 0.8rem;
  cursor: pointer;
}

.wizard-step:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.wizard-step.active {
  color: var(--text);
  border-color: var(--accent);
}

.wizard-step .step-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--surface-2);
  font-size: 0.7rem;
}

.entry-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 0.6rem 1.25rem;
}

.entry-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.entry-field label {
  font-size: 0.82rem;
  color: var(--text);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entry-field .field-input {
  width: 130px;
  flex: none;
}

.field-input.invalid {
  border-color: var(--negative);
}

.group-block {
  margin-bottom: 1.1rem;
}

.wizard-footer {
  display: flex;
  justify-content: space-between;
  margin-top: 1.25rem;
}

.review-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem;
}

.meta-row {
  display: flex;
  gap: 1.25rem;
  margin-bottom: 1rem;
  flex-wrap: wrap;
}

.meta-row label {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  font-size: 0.72rem;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--muted);
}

.meta-row .field-input {
  text-align: left;
  font-family: inherit;
  width: 190px;
}
```

`src/pages/MonthlyUpdatePage.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CalendarCheck } from 'lucide-react'
import { ApiError } from '../api/client'
import {
  fetchAccounts,
  fetchMonthBalances,
  fetchTimeseries,
  putMonthBalances,
} from '../api/netWorth'
import { fetchCategories, fetchSpendingMonth, putSpendingMonth } from '../api/spending'
import MonthRibbon from '../components/MonthRibbon'
import { GROUP_LABELS, GROUP_ORDER } from '../charts/theme'
import type { AccountOut, CategoryOut } from '../types/api'
import { formatCurrency, formatMonth, formatPct } from '../utils/format'
import { addMonths, currentMonthIso } from '../utils/months'
import '../components/panels.css'
import './MonthlyUpdatePage.css'

const STEPS = ['balances', 'spending', 'review'] as const
type Step = (typeof STEPS)[number]

function isNumeric(raw: string): boolean {
  return raw.trim() !== '' && !Number.isNaN(Number(raw))
}

function todayIso(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`
}

export default function MonthlyUpdatePage() {
  const [params, setParams] = useSearchParams()
  const month = params.get('month') ?? currentMonthIso()
  const stepParam = params.get('step')
  const step: Step = STEPS.includes(stepParam as Step) ? (stepParam as Step) : 'balances'

  const [accounts, setAccounts] = useState<AccountOut[]>([])
  const [categories, setCategories] = useState<CategoryOut[]>([])
  const [balances, setBalances] = useState<Record<number, string>>({})
  const [amounts, setAmounts] = useState<Record<number, string>>({})
  const [netPay, setNetPay] = useState('')
  const [recordedOn, setRecordedOn] = useState(todayIso())
  const [notes, setNotes] = useState('')
  const [prevNetWorth, setPrevNetWorth] = useState<number | null>(null)
  const [monthExisted, setMonthExisted] = useState(false)
  const [coveredMonths, setCoveredMonths] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  const setStep = (next: Step) =>
    setParams((current) => {
      const copy = new URLSearchParams(current)
      copy.set('month', month)
      copy.set('step', next)
      return copy
    })

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setSaved(null)
    try {
      const [accountList, categoryList, thisMonth, priorMonth, spendMonth, timeseries] =
        await Promise.all([
          fetchAccounts(),
          fetchCategories(),
          fetchMonthBalances(month),
          fetchMonthBalances(addMonths(month, -1)),
          fetchSpendingMonth(month),
          fetchTimeseries(),
        ])
      const activeAccounts = accountList.filter((a) => a.is_active)
      setAccounts(activeAccounts)
      setCategories(categoryList.filter((c) => c.is_active))
      setMonthExisted(thisMonth.exists)
      setCoveredMonths(new Set(timeseries.months))

      // Pre-fill: the month's own values win; otherwise the prior month's (the sheet
      // ritual starts from last month's numbers); otherwise 0.00.
      const source = thisMonth.exists ? thisMonth.balances : priorMonth.balances
      const byId = new Map(source.map((b) => [b.account_id, b.balance]))
      setBalances(
        Object.fromEntries(activeAccounts.map((a) => [a.id, byId.get(a.id) ?? '0.00'])),
      )
      if (thisMonth.exists && thisMonth.recorded_on) setRecordedOn(thisMonth.recorded_on)
      if (thisMonth.exists && thisMonth.notes) setNotes(thisMonth.notes)

      const prevSum = priorMonth.exists
        ? priorMonth.balances.reduce((acc, b) => {
            const account = accountList.find((a) => a.id === b.account_id)
            return account && !account.is_component ? acc + Number(b.balance) : acc
          }, 0)
        : null
      setPrevNetWorth(prevSum)

      const spendById = new Map(spendMonth.amounts.map((a) => [a.category_id, a.amount]))
      setAmounts(
        Object.fromEntries(
          categoryList
            .filter((c) => c.is_active)
            .map((c) => [c.id, spendById.get(c.id) ?? '0.00']),
        ),
      )
      setNetPay(spendMonth.net_pay ?? '')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load month data')
    } finally {
      setLoading(false)
    }
  }, [month])

  useEffect(() => {
    void load()
  }, [load])

  const balancesValid = accounts.every((a) => isNumeric(balances[a.id] ?? ''))
  const amountsValid =
    categories.every((c) => isNumeric(amounts[c.id] ?? '')) &&
    (netPay.trim() === '' || isNumeric(netPay))

  const preview = useMemo(() => {
    const netWorth = accounts.reduce(
      (acc, a) => (a.is_component ? acc : acc + (Number(balances[a.id]) || 0)),
      0,
    )
    const totalSpend = categories.reduce((acc, c) => acc + (Number(amounts[c.id]) || 0), 0)
    const pay = netPay.trim() === '' ? null : Number(netPay)
    return {
      netWorth,
      delta: prevNetWorth === null ? null : netWorth - prevNetWorth,
      totalSpend,
      savings: pay === null || pay === 0 ? null : (pay - totalSpend) / pay,
    }
  }, [accounts, balances, categories, amounts, netPay, prevNetWorth])

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const balanceResult = await putMonthBalances(month, {
        recorded_on: recordedOn === '' ? undefined : recordedOn,
        notes: notes.trim() === '' ? undefined : notes,
        balances: accounts.map((a) => ({ account_id: a.id, balance: balances[a.id].trim() })),
      })
      const body: { net_pay?: string; amounts: { category_id: number; amount: string }[] } = {
        amounts: categories.map((c) => ({ category_id: c.id, amount: amounts[c.id].trim() })),
      }
      if (netPay.trim() !== '') body.net_pay = netPay.trim()
      const spendResult = await putSpendingMonth(month, body)
      setSaved(
        `Balances: ${balanceResult.created} added, ${balanceResult.updated} changed, ` +
          `${balanceResult.unchanged} unchanged. Spending: ${spendResult.created} added, ` +
          `${spendResult.updated} changed, ${spendResult.unchanged} unchanged.`,
      )
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Saving failed — nothing was lost, retry')
    } finally {
      setSaving(false)
    }
  }

  const stepIndex = STEPS.indexOf(step)

  return (
    <div className="page">
      <div className="page-header">
        <h1>
          <CalendarCheck size={20} style={{ verticalAlign: '-3px', marginRight: '0.5rem' }} />
          Monthly update — {formatMonth(month)}
        </h1>
        <div className="spacer" />
        <MonthRibbon
          anchor={currentMonthIso()}
          filledMonths={coveredMonths}
          selected={month}
          onSelect={(m) =>
            setParams(() => new URLSearchParams({ month: m, step: 'balances' }))
          }
        />
      </div>

      <div className="wizard-steps">
        {STEPS.map((s, i) => (
          <button
            key={s}
            type="button"
            className={`wizard-step${s === step ? ' active' : ''}`}
            onClick={() => setStep(s)}
          >
            <span className="step-index">{i + 1}</span>
            {s === 'balances' ? 'Balances' : s === 'spending' ? 'Spending & net pay' : 'Review & save'}
          </button>
        ))}
      </div>

      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {saved && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <h2 className="eyebrow">Month saved</h2>
          <p>{saved}</p>
          <p>
            <Link to="/net-worth">See net worth</Link> · <Link to="/spending">See spending</Link>
          </p>
        </div>
      )}

      {!loading && step === 'balances' && (
        <div className="card">
          <h2 className="eyebrow">
            {monthExisted ? 'Edit balances' : 'Enter balances (pre-filled from last month)'}
          </h2>
          <div className="meta-row">
            <label>
              Recorded on
              <input
                type="date"
                className="field-input"
                value={recordedOn}
                onChange={(e) => setRecordedOn(e.target.value)}
              />
            </label>
            <label>
              Notes
              <input
                type="text"
                className="field-input"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="optional"
              />
            </label>
          </div>
          {GROUP_ORDER.map((group) => {
            const groupAccounts = accounts.filter((a) => a.group === group)
            if (groupAccounts.length === 0) return null
            return (
              <div key={group} className="group-block">
                <h3 className="eyebrow">{GROUP_LABELS[group]}</h3>
                <div className="entry-grid">
                  {groupAccounts.map((account) => {
                    const value = balances[account.id] ?? ''
                    return (
                      <div key={account.id} className="entry-field">
                        <label htmlFor={`bal-${account.id}`}>
                          {account.name}
                          {account.is_component && <span className="badge">component</span>}
                        </label>
                        <input
                          id={`bal-${account.id}`}
                          className={`field-input${isNumeric(value) ? '' : ' invalid'}`}
                          inputMode="decimal"
                          value={value}
                          onChange={(e) =>
                            setBalances((cur) => ({ ...cur, [account.id]: e.target.value }))
                          }
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
          <p className="drill-hint">
            Liabilities are stored signed — enter card balances as negative numbers.
          </p>
          <div className="wizard-footer">
            <span />
            <button
              className="button button-primary"
              disabled={!balancesValid}
              onClick={() => setStep('spending')}
            >
              Next: spending
            </button>
          </div>
        </div>
      )}

      {!loading && step === 'spending' && (
        <div className="card">
          <h2 className="eyebrow">Spending & net pay</h2>
          <div className="meta-row">
            <label>
              Net pay (take-home)
              <input
                className={`field-input${netPay.trim() === '' || isNumeric(netPay) ? '' : ' invalid'}`}
                inputMode="decimal"
                value={netPay}
                onChange={(e) => setNetPay(e.target.value)}
                placeholder="leave blank to skip"
              />
            </label>
          </div>
          <div className="entry-grid">
            {categories.map((category) => {
              const value = amounts[category.id] ?? ''
              return (
                <div key={category.id} className="entry-field">
                  <label htmlFor={`amt-${category.id}`}>{category.name}</label>
                  <input
                    id={`amt-${category.id}`}
                    className={`field-input${isNumeric(value) ? '' : ' invalid'}`}
                    inputMode="decimal"
                    value={value}
                    onChange={(e) =>
                      setAmounts((cur) => ({ ...cur, [category.id]: e.target.value }))
                    }
                  />
                </div>
              )
            })}
          </div>
          <div className="wizard-footer">
            <button className="button" onClick={() => setStep('balances')}>
              Back
            </button>
            <button
              className="button button-primary"
              disabled={!amountsValid}
              onClick={() => setStep('review')}
            >
              Next: review
            </button>
          </div>
        </div>
      )}

      {!loading && step === 'review' && (
        <div className="card">
          <h2 className="eyebrow">Review & save — {formatMonth(month)}</h2>
          <div className="review-grid">
            <div>
              <div className="stat-label">Net worth (preview)</div>
              <div className="stat-value">{formatCurrency(preview.netWorth)}</div>
              {preview.delta !== null && (
                <div
                  className={`stat-delta ${preview.delta >= 0 ? 'stat-delta-positive' : 'stat-delta-negative'}`}
                >
                  {formatCurrency(preview.delta)} vs prior month
                </div>
              )}
            </div>
            <div>
              <div className="stat-label">Total spend</div>
              <div className="stat-value">{formatCurrency(preview.totalSpend)}</div>
            </div>
            <div>
              <div className="stat-label">Savings rate</div>
              <div className="stat-value">
                {preview.savings === null ? '—' : formatPct(preview.savings, { signed: false })}
              </div>
            </div>
          </div>
          <p className="drill-hint" style={{ marginTop: '0.75rem' }}>
            Server-side rounding (2 decimals, half-up) is authoritative; the preview is
            client math. {stepIndex === 2 && !balancesValid ? 'Fix balance entries first.' : ''}
          </p>
          <div className="wizard-footer">
            <button className="button" onClick={() => setStep('spending')}>
              Back
            </button>
            <button
              className="button button-primary"
              disabled={saving || !balancesValid || !amountsValid}
              onClick={() => void save()}
            >
              {saving ? 'Saving…' : 'Save month'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Wire route + nav**

`src/App.tsx` — add `import MonthlyUpdatePage from './pages/MonthlyUpdatePage'` and, directly under the Overview route: `<Route path="/update" element={<MonthlyUpdatePage />} />`.

`src/components/Layout.tsx` — add `CalendarCheck` to the lucide import and insert into `NAV_ITEMS` right after Overview: `{ to: '/update', label: 'Monthly update', icon: CalendarCheck },`.

- [ ] **Step 5: Run tests — expect PASS; full gate; commit**

```bash
npm test && npm run lint && npm run build
git add src/pages/MonthlyUpdatePage.tsx src/pages/MonthlyUpdatePage.css src/pages/MonthlyUpdatePage.test.tsx src/App.tsx src/components/Layout.tsx
git commit -m "feat: monthly update wizard — balances, spending, review flow"
```

---

### Task 15: Real-data verification + sheet reconciliation (controller-supervised)

Run by the controller directly (like Plan 2's Task 15), not a subagent — it touches the real workbook path and drives a browser. Nothing in this task commits code unless a bug is found (fixes get their own scoped commits + plan amendments).

**Prereqs:** dev DB up; migration applied (Task 1 did it); backend on :8000 from the worktree venv; `npm run dev` on :5173.

- [ ] **Step 1: Net-worth identity reconciliation — all 37 months**

Write `reconcile_plan3.py` in the session scratchpad (NOT the repo). It must:
1. Log in via `httpx` (`POST /api/v1/auth/login`, admin@example.com / changeme123) and fetch `/api/v1/net-worth/timeseries`.
2. Open the workbook read-only (`openpyxl`, `data_only=True`) and read the Net Worth sheet: months (c1), sheet NET WORTH (c53), and the After-Tax 401(k) column (c21), rows 3–39.
3. For every sheet month, assert `api_net_worth + after_tax_balance == sheet_net_worth` within **$0.05** (sentinel-normalization slack), where `after_tax_balance` comes from the API's series for slug `after-tax-401-k`.
4. Assert the API months == the sheet's 37 months exactly.
5. Print a per-month table of (month, api_nw, sheet_nw, diff) — console only, never committed.

Expected: **37/37 within tolerance.** Any miss = stop, debug (superpowers:systematic-debugging), fix, amend the plan.

- [ ] **Step 2: Spending spot-checks**

Same script or a second one:
1. `/api/v1/spending/matrix`: assert 29 months (2023-08…2025-12); assert the 2025-12 total equals the sheet's TOTAL cell for that row (read c21 of the Spending sheet) to the cent; assert `savings_rate` for 2025-12 equals `(net_pay − total)/net_pay` computed from the sheet's own c22/c21 to 6 dp.
2. Print sheet `4% Portfolio` (c23) vs API `four_pct_rule` for the last 6 populated months with % deviation — **record the typical deviation in the Task 15 results block** (expected: within a few %; the sheet column is unreproducible — Verified rollup semantics).
3. `/api/v1/spending/yearly`: assert 2024's total equals the sheet's 2024 yearly rollup row TOTAL (the row where c1 is numeric `2024`).

- [ ] **Step 3: Browser walkthrough (the visual gate)**

With both servers up, in the browser (use the claude-in-chrome skill if driving programmatically; screenshots at each stop):
1. `/net-worth`: stacked chart bands ordered cash→other with liabilities below zero and the ink NW line + end label; quarterly toggle drops to quarter-end months; component rows indented + badged; drill-down caps at 3 and survivors keep colors when one is removed; tooltips show currency at every x.
2. `/spending`: bars + net-pay line + dashed 4% line share one $ axis; heatmap tooltips name category/month; savings chart y stays within ±100% while tooltips report the true wild early values; trend chips cap at 3; yearly table matches the sheet's rollup rows at a glance.
3. `/update`: walk 2026-08 (snapshot exists, spending doesn't): step 1 pre-fills the existing 2026-08 balances; step 2 all 0.00 + empty net pay; review shows preview NW ≈ the page's summary tile; **do NOT save** (keep dev data pristine)... then pick 2030-01 (no data anywhere): step 1 pre-fills from 2026-09 (latest prior), save the month end-to-end, verify it appears on /net-worth, then clean up:
   `docker exec finance-dashboard-db-1 psql -U finance -d finance -c "DELETE FROM net_worth_snapshots WHERE month = '2030-01-01'; DELETE FROM monthly_spending WHERE month = '2030-01-01'; DELETE FROM monthly_cashflow WHERE month = '2030-01-01';"`
   (balances cascade with the snapshot; re-run the Step-1 reconciliation script afterwards to prove the dataset is back to 37/37).
4. Keyboard pass: tab through ribbon chips / segmented control / wizard inputs — focus visible everywhere; wizard is fully operable without a mouse.
5. Anti-pattern sweep (dataviz `anti-patterns.md`): no dual axis, no >8 hues, no dashed gridlines, no value-on-every-point, axis bands not clipped by card heights.

- [ ] **Step 4: Record results in this doc**

Append a `### Task 15 results` block below this task: reconciliation pass counts, the 4%-line deviation summary (percentages only, no dollar values), walkthrough findings, screenshots taken (paths stay in the session, not the repo). Commit:

```bash
git add docs/superpowers/plans/2026-08-14-plan-3-net-worth-spending.md
git commit -m "docs: record Plan 3 real-data reconciliation results"
```

---

### Task 16: Final gates + forward notes

**Files:**
- Modify: `docs/superpowers/plans/2026-08-14-plan-3-net-worth-spending.md`

- [ ] **Step 1: Full verification suite (both stacks, from the worktree)**

```bash
cd backend && .venv/Scripts/ruff check . && .venv/Scripts/ruff format --check . && .venv/Scripts/python -m pytest -q -W error && .venv/Scripts/alembic check
cd .. && npm run lint && npm test && npm run build
```
Expected: backend ≥ 165 tests green (130 inherited + ~35 new); frontend ≥ 13 vitest tests green (5 inherited + ~8 new); lint carries only the one sanctioned warning; build clean.

- [ ] **Step 2: Boot smoke**

```bash
cd backend && (.venv/Scripts/uvicorn app.main:app --port 8000 &) && curl --retry 15 --retry-connrefused --retry-delay 1 -s http://127.0.0.1:8000/api/v1/health && curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8000/api/v1/net-worth/timeseries && curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8000/api/v1/spending/matrix
```
Expected: `{"status":"ok"}`, then `401`, `401`. Kill the server (both PIDs).

- [ ] **Step 3: Append "Forward notes for Plans 4+" to this doc**

Seed list — extend with anything learned during execution:

```markdown
## Forward notes for Plans 4+ (from Plan 3 execution)

- **is_component semantics:** all five 401(k) source buckets are flagged; dashboard NW
  intentionally = sheet NW − After-Tax 401(k) (the sheet double-counts it — verified
  37/37). One PATCH (`is_component: false` on after-tax-401-k) reproduces sheet totals
  exactly if the user prefers. The importer never touches the flag (pinned by test).
- **Chart palette is frozen in `src/charts/theme.ts`** (dataviz-validated on #171a21).
  Plan 4's portfolio charts (treemap/donut/sparklines) must draw from the same slots —
  treemap/donut are ALL-PAIRS forms: ≤3 hues or fold/facet. Sequential blue ramp is
  the shared magnitude scale. Never add hex outside theme.ts.
- The `<EChart>` wrapper + registration module are the only echarts touchpoints; add
  new chart types to `src/charts/echarts.ts` `use([...])`, nowhere else. echarts
  version installed: record here (^6.1 expected; ^5.6 fallback if types fought).
- `app/services/money.py` is the shared 422 vocabulary — Plan 4/5 endpoints reuse
  `quantize_money`/`require_first_of_month` instead of re-implementing.
- `investable_base()` (net_worth_calc) is what the 4% line uses: latest snapshot ≤
  month, groups pre_tax/post_tax/taxable/equity, non-component. The Overview page
  (Plan 6) and any FIRE-style views should reuse it, not re-derive.
- Savings rate = actual (net_pay − total)/net_pay; the sheet's column was a planned
  step-constant (documented divergence). If the user ever wants the planned-rate line,
  it needs a new data home (maybe paycheck profiles, Plan 5) — do not overload this one.
- Wizard PUTs are two sequential requests (balances, then spending); a failure between
  them leaves balances saved and spending not — the error banner says retry (idempotent
  upserts make retry safe). Acceptable for a single user; revisit only if it ever bites.
- client.ts now has a 15s default timeout and maps network failures to ApiError(0);
  caller-supplied AbortSignals are honored (and AbortError passes through untouched).
- Placeholder pages remaining: /portfolio /taxes /espp /paycheck /comp /settings + Overview.
```

- [ ] **Step 4: Self-review the branch diff, then commit**

```bash
git add docs/superpowers/plans/2026-08-14-plan-3-net-worth-spending.md
git commit -m "docs: Plan 3 forward notes for Plans 4+"
git log --oneline main..HEAD
```
Expected: ~16 scoped commits.

---

## Definition of done (Plan 3)

- `pytest -q -W error` green in the worktree: all Plan 1/2 suites + services + both new API suites (~165 tests). `ruff check` + `ruff format --check` + `alembic check` clean.
- `npm test` green (client timeout suite, format/months utils, MonthRibbon, wizard flow); `npm run lint` (one sanctioned warning) + `npm run build` clean.
- Migration applied to the dev DB; the five component slugs flagged; downgrade→upgrade round-trip re-applies the backfill (CI's round-trip step covers the fresh-DB path).
- `/net-worth`, `/spending`, `/update` live against real data; placeholders replaced; nav updated.
- Reconciliation: dashboard NW + After-Tax = sheet NW for **37/37 months** (≤ $0.05); 2025-12 spending total + savings rate match the sheet to the cent/6dp; 2024 yearly total matches the rollup row; 4%-line deviation recorded.
- Every derived number is computed at request time; no schema change beyond `is_component`; the importer's contract untouched (preservation test pinned).
- Chart system honors the frozen dataviz rules (validated palette, one axis, ≤8 hues with Other-fold, ≤3 all-pairs selections, legends, tooltips, reduced-motion).
- Plan doc carries Task 15 results + Forward notes for Plans 4+. CI first runs these steps on the user's push after merge (push triggers: [main, edwli/*]).









