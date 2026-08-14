# Plan 2: Spreadsheet Importer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A repeatable, idempotent xlsx importer that ports every data sheet of `Personal Finance Dashboard.xlsx` into the Plan 1 schema — dry-run diff first, transactional apply, callable as CLI and authenticated upload endpoint — plus the test debts Plan 1 booked for Plan 2 (seed tests, migration downgrade guard, frontend vitest).

**Architecture:** A self-contained `backend/app/importer/` package: pure openpyxl parsers (workbook → normalized dataclasses + warnings/errors, no DB) feeding load-compare-write appliers (natural-key upserts via ORM, single transaction, dry-run = same code path + rollback). One pydantic `ImportReport` serves the CLI printer and the endpoint response. Row volumes are tiny (~2k rows total) so per-entity preload + in-memory diff is the whole strategy — no bulk upsert machinery.

**Tech Stack:** Python 3.12, openpyxl 3.1 (read_only + data_only), SQLAlchemy 2 async, FastAPI multipart upload; vitest 3 + @testing-library/react + jsdom for the frontend debt.

**Spec:** `docs/superpowers/specs/2026-08-12-finance-dashboard-design.md` §5 (importer service, `import` endpoint, error handling), §9 (importer tests), plus `docs/superpowers/plans/2026-08-12-plan-1-foundation.md` "Forward notes for Plans 2+" (all importer requirements recorded there are binding; this plan restates each where it lands).

**Plan roadmap** (each plan ships working software):
1. Foundation — DONE (merged to main @ 20aadd8)
2. **Importer** (this plan) — sheet parsers, dry-run diff, real-data import + reconciliation
3. Net worth + spending modules + monthly wizard
4. Portfolio + prices (yfinance, scheduler, holdings/XIRR)
5. Taxes + comp modules (tax engine w/ golden tests, ESPP, paycheck, focal)
6. Overview page, visual pass, OCI deploy, parallel-run cutover

**Machine notes (edyli's Windows box)** — inherited from Plan 1, all still true:
- Python 3.12 via `py -3.12`; venv at `backend/.venv`; local pip needs `--trusted-host pypi.org --trusted-host files.pythonhosted.org`.
- Shell commands below are Git Bash syntax. Run ruff ONLY from `backend/`.
- **When a plan code block and `ruff format` disagree, format wins.** Run `ruff format` on transcribed files before committing; AST-identical re-wrapping vs the plan text is expected and sanctioned (reviewers verify AST equivalence, not byte equality).
- Foreground `sleep` is blocked; wait for servers with `curl --retry N --retry-connrefused --retry-delay 1`. Background `cmd &` chains: `kill %1` kills the wrapper, not the server — find the PID via `netstat -ano | grep :PORT` and `taskkill //F //PID`.
- Dev Postgres: container `finance-dashboard-db-1`, loopback :5433, DBs `finance` (dev) + `finance_test` (pytest). Start if down: `docker compose -f backend/docker-compose.yml up -d --wait db`.
- Container image builds fail locally (corporate TLS interception); CI is the image gate. Never trust a local image-build layer's exit status; grep its output.
- Node 18.12 local (project engines is `>=20`; 18.12 builds this stack anyway — known exception). **Pin vitest to `^3` (Node 18-compatible, pairs with Vite 6); vitest 4 dropped Node 18.** CI runs Node 20.

**New machine/workbook gotchas (verified 2026-08-13 while probing the real workbook):**
- The workbook is a Google-Sheets export: **every worksheet is "unsized"** — in `read_only` mode `ws.max_row`/`ws.max_column` are `None` and `ws.calculate_dimension()` raises `ValueError`. Parsers MUST iterate with explicit `min_row`/`max_row`/`max_col` bounds and their own stop conditions, never consult `ws.max_row`.
- In `read_only` mode padding cells are `EmptyCell` objects without `.row`/`.column` attributes — always use `values_only=True` and track row numbers with `enumerate`.
- `data_only=True` returns cached formula values; formula **error cells come back as strings** (`'#REF!'`, `'#N/A'`) — both occur in ReferenceData. Literal `'N/A'`/`'n/a'` strings also occur (Net Worth % columns, ESPP modeler).
- Some cached dates come back as `datetime.time(0, 0)` (ReferenceData Ex-Dividend Date for most stock rows) — a date coercion helper must treat non-date values as None-with-warning, not crash.
- The real workbook lives at `C:\Users\edyli\Downloads\Personal Finance Dashboard.xlsx` (875 KB). It contains personal financial data: **never commit it, never copy real values into fixtures or the plan/report docs.** Synthetic in-test fixtures only (spec §9).

---

## Workbook reference (verified against the real file, 2026-08-13)

This section is the parsing contract. Column/row coordinates are 1-based. All layout facts below were read from the live workbook with openpyxl `read_only=True, data_only=True`.

### Sheet inventory
`['Paycheck Modeler', 'ESPP', 'Focal History', 'Positions', 'Spending', 'Taxes', 'Net Worth', 'Portfolio', 'Portfolio Summary', 'Spending Summary', 'Net Worth Summary', 'Taxes Summary', 'Credit Card Matrix', 'ReferenceData']`
Imported: Net Worth, Spending, Positions, Portfolio (warn-only), Taxes, ESPP, Paycheck Modeler, Focal History, ReferenceData. The four `* Summary` sheets and Credit Card Matrix are ignored (spec: replaced by computed views / deferred).

### Net Worth
- r1: group band headers (merged cells → value only in the first column of each band): c1=`Month`, c2=`Date`, c3=`CASH`, c7=`PRE-TAX`, c19=`POST-TAX`, c29=`TAXABLE`, c35=`EQUITY`, c39=`OTHER`, c43=`LIABILITIES`, c53=`NET WORTH`. Walking columns left→right, the last-seen band applies. **`NET WORTH` terminates account columns** (c53+ are computed totals).
- r2: account names, each followed by a `%` column. An account column = r2 value not None and not `'%'`. Quirk: c11 `Traditional 401(k)`'s % column (c12) has a **None** header — the rule above handles it (None columns are skipped).
- 25 account columns: CASH c3 `Wells Fargo Checking`, c5 `Robinhood HYSA`; PRE-TAX c7 `Employer Match 401(k)`, c9 `Reverse Rollover 401(k)`, c11 `Traditional 401(k)`, c13 `Fidelity Traditional 401(k)`, c15 `Fidelity Traditional IRA`, c17 `Fidelity HSA`; POST-TAX c19 `Roth Basic 401(k)`, c21 `After-Tax 401(k)`, c23 `Fidelity Roth 401(k)`, c25 `Fidelity Roth IRA`, c27 `Robinhood Roth IRA`; TAXABLE c29 `Robinhood Brokerage`, c31 `Fundrise`, c33 `Schwab Brokerage`; EQUITY c35 `Schwab EAC`, c37 `Schwab ESPP`; OTHER c39 `Petty Cash`, c41 `Vehicle(s)`; LIABILITIES c43 `Active Cash CC`, c45 `VentureX CC`, c47 `Savor CC`, c49 `BILT CC`, c51 `RH CC`.
- Data rows r3–r39: c1 = month (datetime, already first-of-month), c2 = recorded date (datetime; r3 is 2023-09-24, later rows equal the month). 37 populated snapshots, 2023-09-01 … 2026-09-01.
- r40+ are future template rows: Month+Date filled, **every account cell None** (% cells hold 0). Skip rows whose account cells are all None. Iteration stops at the first row with c1 None (cap guard 2000 rows).
- **Liability balances are POSITIVE in the sheet** (r3: c43=30.15, c45=5100.11, c49=137.47). The schema comment says balances are stored signed with liabilities NEGATIVE so `SUM(balance)` works — **the importer negates liability-group balances** (warning: one aggregate note per run).
- `0.001` sentinels are everywhere (unused accounts); `'N/A'` appears only in % columns (never parsed).
- **NET WORTH column is NOT the sum of account columns** (component accounts overlap: c13 = c7+c9+c11 exactly; c23 = c19+c21 exactly; the sheet's own total excludes some components). Reconciliation checks in Task 14 therefore compare per-account balances, not the grand total. Forward note for Plan 3 recorded there.

### Spending
- r1: c1 None, c2–c20 = 19 category names in order: `Auto & Transport, Bills & Utilities, Business Services, Education, Entertainment, Fees & Charges, Financial, Food & Dining, Gifts & Donations, Health & Fitness, Housing, Investments, Kids, Loans, Personal Care, Pets, Shopping, Taxes, Travel`; c21 `TOTAL`, c22 `Net Pay`, c23 `4% Portfolio`, c24 `Savings Rate` (c21/c23/c24 computed — never imported; c21 used only for a cross-check warning).
- r2: c1=`'Average'` (computed row — skip silently).
- Monthly rows: c1 = datetime month. Yearly rollup rows: c1 = **numeric** year (e.g. `2023.0`) — skip silently. Template rows exist through 2065; a monthly row is "empty" (skipped) when all of c2–c20 and c22 are None.
- Populated months: 2023-08-01 … 2025-12-01 (29 months; **2026 rows exist but are empty** — the sheet simply hasn't been filled for 2026). Category cells are explicit `0.0` when a month had no spend — imported as real zeros.
- Cross-check: if `sum(c2..c20)` differs from c21 TOTAL by ≥ 0.01, emit a warning (do not fail).
- Iteration stops at the first row with c1 None (cap guard 2000 rows).

### Positions
- r1 headers: c1 `Platforms`, c2 `Type`, c3 `Stock`, c4 `Transacted Shares`, c5 `Transacted Price/ Share`, c6 `Fees`, c7 `Stock Split`, c8–c12 computed running columns (`Prev Row`, `Previous Shares`, `Cumulative Shares`, `Transacted Value`, `Previous Cost`) — never imported.
- Data rows r2–r34 (33 rows), then blank. Stop after 5 consecutive fully-blank rows (cap guard 500).
- **No date column** (spec Risk #1): `txn_date=None` for every imported row; XIRR in Plan 4 works only where dates exist.
- `Stock` is the security **name** (matches ReferenceData `Name` exactly, including `®` in Fidelity fund names). `Platforms` is a free-text account label stored verbatim. `Type` observed: only `'Buy'`; map case-insensitively {buy, sell, split}; anything else = error.
- 7 rows have `Transacted Shares == 0` (placeholder rows keeping the sheet's running-total chains aligned) — skip each with a warning. 26 real transactions remain.
- `Fees`/`Stock Split` are None on every current row; import when present (fees → `fees`, split factor → `split_factor`; a `Split` row reads only `split_factor` — dummy 0 shares/price per the Plan 1 convention).
- `sort_index = row_number * 10` (distinct, order-preserving — Plan 1 forward note; folding orders by `(sort_index, id)`).
- Shares arrive with up to 12 dp (`381.259077932274`) → quantize 6 dp HALF_UP. Prices up to 6 dp (`264.113711`) → quantize 4 dp HALF_UP. Reconciliation consequence: recomputed cost basis can drift a few cents from the sheet's `Transacted Value` — documented tolerance in Task 14, forward note for Plan 4.

### Portfolio (warn-only)
- r1 headers: c2 `Ticker`, c16 `Dividends Collected` (c1 `Company Name`; the rest computed). r2 is a totals row (Ticker None).
- **Every `Dividends Collected` cell is currently 0** → the importer creates no `dividend_payments` rows. For any row with dividends > 0 it emits a warning naming the ticker and amount ("not imported — sheet has no payment dates; enter via UI in Plan 4"). This is a sanctioned deviation from spec §5's "seeded as aggregate entries" — aggregates would need a fabricated `pay_date` (NOT NULL) and there is nothing to seed today. Recorded in Forward notes.

### Taxes
- r1: c1 = instruction text, year columns from c3: `2023.0, 2024.0, 2025.0, 2026.0, 2027.0(empty), 2028.0(empty)` (floats). A year column is active if ANY of its input/bracket cells is non-None → 2023–2026 active, 2027/2028 skipped silently.
- Input rows r2–r42: c1 = section header on its first row (`ORDINARY INCOME` r2, `DEDUCTIONS` r24, `CAPITAL GAINS` r38), c2 = label (sub-items have leading spaces + parens, e.g. `'   (Stock/RSUs Sold)'`). The 41 labels appear in EXACTLY the order of `tax_keys.TAX_INPUT_DEFINITIONS` within each section — the parser walks an explicit `(sheet_label, key)` sequence and errors on any mismatch (layout drift detector).
- Bracket sections r43–r95, each headed in c1: `FEDERAL INCOME TAX INFO` (leading row `Standard/Itemized Deductions` = derived, SKIP; then Bracket 1–7 Rate, Bracket 1–7 Threshold), `STATE INCOME TAX INFO` (leading rows `Standard/Itemized Deductions` → NEW input key `state_standard_deduction`, `Exemption Credits` → NEW key `state_exemption_credits`; then Bracket 1–9 Rate/Threshold), `MEDICARE TAX INFO` (2 brackets), `SOCIAL SECURITY TAX INFO` (2), `DISABILITY TAX INFO` (2), `CAPITAL GAINS TAX INFO` (3).
- r96+ are computed output sections (`FEDERAL INCOME TAX`, `STATE INCOME TAX`, …) — parsing STOPS at the first c1 header not in the known set.
- Values include true fractions (`State Exempt Percentage` = 0.9645) → **requires the Task 2 migration widening `tax_inputs.value` to Numeric(14,4)**; quantize inputs 4 dp, rates 4 dp, thresholds 2 dp.

### ESPP
- Lots table cols I–N (9–14), header r2: `ESPP Purchase Date, Qualifying Date, Shares Purchased, Subscription Price, Purchase Date FMV, Puchase Price` (sic — the typo is in the sheet; parse by fixed column, never by header text). Lot rows r3–r6 (4 lots: 2024-02-29, 2024-08-30, 2025-02-28, 2025-08-29). Rows r7+ have only a purchase date (future template) — a row is a lot only if Shares Purchased is non-None. Template dates continue to 2039.
- Modeler block cols B–D: r3 c3=`FEBRUARY PURCHASE`, c4=`AUGUST PURCHASE`; r5 `Semi-Annual Base Salary` (81000 / 94465); r6 `Additional payments (i.e. bonuses)` (0 / 0); r8 `ESPP Contribution Percentage` (0.14 / 0.11). Rows located by exact c2 label match within r2–r33 (not fixed row numbers). Other modeler rows are computed aids — ignored.
- `espp_periods` derivation (label/period_start/period_end are NOT NULL, absent from sheet): next_feb = first template purchase date with month 2 and no lot; next_aug = first with month 8 and no lot (from the file: 2026-02-27 and 2026-08-31). FEB column → label `February {next_feb.year} Purchase`, period_start `{next_feb.year-1}-09-01`, period_end next_feb. AUG column → `August {next_aug.year} Purchase`, period_start `{next_aug.year}-03-01`, period_end next_aug. Warning emitted (dates derived). If either template date is missing → skip periods with warning.
- `ESPP Taxation Calculator` block (c2 r35+, `Date of Sale` 2025-09-01 etc.) is a **hypothetical what-if, NOT a real sale**: Positions still carries 1108 NVDA ESPP shares = 1030 (all four lots) + 78 (modeled Feb-2026 purchase), Portfolio realized G/L is 0 everywhere, and every Taxes `ESPP Sale Component` is 0. The importer IGNORES this block (one warning noting it was ignored). `sold_date`/`sold_price` stay None.

### Paycheck Modeler
- Labels in c2 with values in c3: `Annual Salary` 188930, `Dental & Vision` 12.5, `HSA` 100.0. Labels in c5 with values in c6: `Traditional 401(k) %` 0.13, `Roth 401(k) %` 0.0, `AT 401(k) %` 0.03, `Tax Withholding %` 0.334009166758825 (15 dp → quantize 9 dp HALF_UP, the Plan 1-verified case), `ESPP %` 0.11. Locate by exact label within r2–r19; all other rows computed — ignored (including the Monthly Budget block r21+).
- `pay_periods_per_year` = 24 (not in sheet; default). Sanity check: warn if `|salary/24 − Gross Paycheck cell| ≥ 0.01`.
- `effective_date` (NOT NULL, unique, absent from sheet): Jan 1 of the **latest Focal History year with a non-None New Base** (2026 → 2026-01-01). Warn if that year's New Base ≠ Annual Salary. If Focal History has no such row → skip the profile with a warning. Always emit a "derived effective_date" warning.

### Focal History
- Header r2: c2 `Focal Year`, c3 `Current Base`, c4 `New Base`, c5/c6 computed deltas (skip), c7 `Unvested RSUs`, c8 `Unvested Price`, c9 computed (skip), c10 `Refresh RSUs`, c11 `Grant Price`, c12 computed (skip).
- Data r3+: focal_year numeric. Import rows where `Current Base` is non-None (2024, 2025, 2026 full; **2027 partial — current_base only, all nullable fields None — imported as-is**). Year-only template rows (2028–2046) skipped. Stop at first row with c2 None (cap 200).

### ReferenceData
- Header r1: `Symbol, Name, Sector, Cost Per Share, Last Price, Dividend Yield, Dividend per Share, Payout Ratio, Ex-Dividend Date` (c1–c9). 37 rows r2–r38.
- Imported per row: ticker=c1, name=c2, industry=c3 verbatim, holding_type = `etf` if Sector==`ETF`, `mutual_fund` if `Mutual Fund`, else `stock`; annual_dividend = c7 (arrives as STRINGS like `'45.54'` or 0 — parse via Decimal, quantize 4 dp; values are GOOGLEFINANCE leftovers, Plan 4's refresh overwrites); ex_div_date = c9 only when an actual date (datetime.time / `'N/A'` → None, no warning — known junk). `is_manual_priced=False`, `is_active=True` for all (Plan 4 flags un-quotable tickers).
- Cost Per Share (c4) and Dividend Yield (c6) and Payout Ratio (c8) are never imported (`'#REF!'` junk lives in c4).
- `Last Price` (c5) seeds `latest_prices` with `source='manual'`, INSERT-ONLY (existing rows are never touched — the price service owns updates; skip counts as a skip). `quoted_at = datetime.now(UTC)` at insert; idempotency holds because re-runs skip. `'#N/A'` (ZI) → skip that price with warning.
- The four sheet-minted tickers for private-ish assets (FIGR, VIA, RVI, VCX) are imported verbatim — **no synthetic tickers needed for the current workbook**. The synthetic-ticker fallback (Task 7) exists only for future Positions rows whose Name has no ReferenceData match.

### Cross-sheet dependencies (orchestration order)
1. ReferenceData → securities + name→ticker map (Positions needs it)
2. Positions (auto-creates securities for unknown names, synthetic ticker + warning)
3. Portfolio (warn-only; needs securities for ticker sanity)
4. Net Worth, Spending, Taxes (independent)
5. Focal History → ESPP → Paycheck (paycheck's effective_date derives from focal)

---

## Global rules (bind every task)

**Decimal discipline** (Plan 1 forward notes; PG rounds half-away-from-zero, Python quantize defaults to banker's — always pass `ROUND_HALF_UP`):

| Field family | Quantum | DB type |
|---|---|---|
| balances, spending amounts, net_pay, thresholds, comp bases, semi_annual_base/additional_payments, dividend amounts | `0.01` | (14,2)/(12,2) |
| prices, tax rates, tax input values (post-Task-2), annual_dividend, unvested/grant prices, RSU counts | `0.0001` | (14,4)/(7,4)/(10,4)/(12,4) |
| transaction shares | `0.000001` | (16,6) |
| ESPP lot shares | `0.0001` | (12,4) |
| ESPP lot prices (subscription/fmv/purchase) | `0.00001` | (14,5) |
| percentages (401k/espp/withholding/contribution_pct) | `0.000000001` | (10,9) |

- Raw cell → `Decimal(str(value))` (never `Decimal(float)`; `str()` yields the sheet-visible short repr). Reject bools before ints (`bool` is an `int` subclass).
- Bounds are validated BEFORE insert: quantized `abs(value) < 10**(precision-scale)` else a row/col-context error (numeric overflow otherwise raises bare `DBAPIError` sqlstate 22003 — Plan 1 verified).
- **Sentinels:** a raw balance cell exactly `0.001`/`-0.001` (compare `Decimal(str(v)).copy_abs() == Decimal("0.001")`) normalizes to `Decimal("0.00")` — decided on the RAW value before quantization (Numeric(14,2) would silently destroy it). Counted and reported as ONE aggregate warning per sheet ("N placeholder 0.001 balances normalized to 0"). Sentinel rule applies ONLY to Net Worth balances.
- Formula-error strings `{'#N/A','#REF!','#VALUE!','#DIV/0!','#NAME?','#NUM!','#NULL!','#ERROR!'}` and literal `'N/A'`/`'n/a'`/`''` coerce to None (caller decides warn/skip/error). Any other non-numeric string where a number is expected → **error** with `Sheet!r<row>c<col>` context (spec §5: strict Decimal).
- Dates: months normalized to first-of-month before insert (CheckConstraints enforce it DB-side; normalize for clean errors) with a warning when normalization actually changed a value.

**Upsert semantics:** per entity, preload all existing rows keyed by natural key in one query, diff in memory, then `db.add()` news / mutate changed / count identical as skips. Natural keys: account slug; snapshot month; (snapshot_id, account_id); category slug; (month, category_id); cashflow month; ticker; tax year; (year, key); (year, jurisdiction, bracket_index); espp purchase_date; espp period label; paycheck effective_date; comp focal_year. `position_transactions` have no natural key → keyed on `sort_index` (deterministic from row order) and **synced**: imported-set upsert + delete of importer-owned strays (`sort_index > 0` and not in the incoming set) — the only entity with deletes. Auto-created rows must set `sort_order`/`is_active`/`sort_index` explicitly (Python-side defaults don't apply to raw inserts; ORM `db.add` does apply them, but be explicit anyway where the value is meaningful).
- Unknown accounts are auto-created active with the group from their sheet band; the fallback when a band is unrecognized is `"other"` + warning (Plan 1 forward note). Unknown categories: auto-created active, sort_order = column index. Unknown securities (Positions name miss): auto-created active `holding_type='private'`, synthetic ticker + warning.
- `accounts.sort_order` = sheet column index; `spending_categories.sort_order` = column index.

**Transaction + error semantics:** parse phase touches no DB and collects ALL errors/warnings. If any parser error exists → apply is skipped entirely (`applied=false`), report still returned (CLI exit 1). Apply runs in the request/CLI session; **one commit at the end; dry-run runs the identical apply code then rolls back** (spec: same code path). Sequence gaps from dry-run flushes are cosmetic and accepted.

**Report:** `ImportReport{dry_run, applied, sheets: {sheet_key: SheetReport{entities: {entity: {creates,updates,skips,deletes}}, warnings[], errors[], samples[]}}}` — samples are human strings like `account_balances[2026-03-01/fidelity-hsa]: 123.00 -> 456.00`, capped at 50/sheet with a `... and N more` tail. Sheet keys: `reference_data, positions, portfolio, net_worth, spending, taxes, espp, paycheck, focal_history`.

**Security/privacy:** the endpoint requires auth (`get_current_user`), caps uploads at 15 MB, and never logs financial values; report samples are returned to the caller only. The real workbook path appears only in Task 14 shell commands, never in committed code or fixtures.

---

## File structure

```
backend/app/importer/
├── __init__.py        # re-exports run_import, ImportReport
├── __main__.py        # CLI: python -m app.importer path.xlsx [--dry-run]
├── cells.py           # coercion: to_decimal/to_date/first_of_month, sentinels, slugify, error strings
├── report.py          # pydantic: EntityCounts, SheetReport, ImportReport
├── parsers.py         # 9 pure sheet parsers → Parsed* dataclasses (no DB imports)
├── apply.py           # per-domain load-compare-write appliers (DB, no openpyxl imports)
└── service.py         # run_import(): load workbook, parse all, apply-or-abort, commit/rollback
backend/app/api/import_.py          # POST /api/v1/import/xlsx?dry_run=
backend/app/main.py                 # register router (modify)
backend/app/tax_keys.py             # +2 definitions (modify)
backend/app/models/taxes.py         # TaxInput.value → Numeric(14,4) (modify)
backend/alembic/versions/<new>      # widen migration
backend/requirements.txt            # +openpyxl (modify)
backend/tests/workbook_builder.py   # synthetic in-memory workbook fixture builder
backend/tests/test_importer_cells.py
backend/tests/test_importer_parsers.py
backend/tests/test_importer_apply.py
backend/tests/test_importer_service.py   # orchestrator + idempotency + CLI arg parsing
backend/tests/test_import_api.py
backend/tests/test_seed.py
.github/workflows/ci.yml            # +downgrade round-trip, +npm test (modify)
package.json / vite.config.ts       # vitest wiring (modify)
src/contexts/AuthContext.test.tsx   # loop-guard regression
src/api/client.test.ts              # 422-array / 429 parsing
```

Responsibilities: `parsers.py` never imports SQLAlchemy; `apply.py` never imports openpyxl; `service.py` is the only module that knows both. `cells.py` is pure stdlib+openpyxl-types. Tests mirror that split so parser tests need no DB.

---

## Expected real-data counts (Task 14 reconciliation contract)

Derived from the live workbook on 2026-08-13. If the user edits the sheet before Task 14, investigate diffs rather than forcing these numbers.

| Entity | Expected creates (first apply) |
|---|---|
| accounts | 25 |
| net_worth_snapshots | 37 (2023-09-01 … 2026-09-01) |
| account_balances | 925 (37 × 25) |
| spending_categories | 19 |
| monthly_spending | 551 (29 months × 19) |
| monthly_cashflow | 29 (2023-08 … 2025-12) |
| securities | 37 |
| latest_prices | 36 (ZI `#N/A` skipped) |
| position_transactions | 26 (33 rows − 7 zero-share placeholders) |
| dividend_payments | 0 (all sheet cells are 0 — warning only) |
| tax_years | 4 (2023–2026) |
| tax_inputs | 172 (43 keys × 4 years) |
| tax_brackets | 100 ((7+9+2+2+2+3) × 4 years) |
| espp_lots | 4 |
| espp_periods | 2 |
| paycheck_profiles | 1 |
| comp_events | 4 (2024–2026 + partial 2027) |

Second apply immediately after: **all zeros except skips** (idempotency gate).

---

### Task 1: Housekeeping — lockfile sync, openpyxl dependency

**Files:**
- Modify: `package-lock.json` (already-drifted 3-line engines sync)
- Modify: `backend/requirements.txt`

- [ ] **Step 1: Verify worktree baseline**

Run: `cd backend && .venv/Scripts/python -m pytest -q -W error && cd .. && git status --short`
Expected: `47 passed`; git status shows only `package-lock.json` modified (the engines-block sync npm install already produced; if it is NOT modified, run `npm install --no-audit --no-fund` and re-check).

- [ ] **Step 2: Commit the lockfile sync**

The 3-line diff adds the root `"engines": {"node": ">=20"}` block to `package-lock.json`, syncing it with the `package.json` committed in Plan 1 (commit 9632228 changed package.json without regenerating the lock).

```bash
git add package-lock.json
git commit -m "chore: sync package-lock engines block with package.json"
```

- [ ] **Step 3: Add openpyxl to backend requirements**

In `backend/requirements.txt`, append after `python-multipart==0.0.32`:

```
openpyxl==3.1.5
```

(Runtime dependency — the importer service runs in the API container. Tests build fixtures with the same library.)

- [ ] **Step 4: Install and verify**

Run: `cd backend && .venv/Scripts/python -m pip install --trusted-host pypi.org --trusted-host files.pythonhosted.org -r requirements.txt && .venv/Scripts/python -c "import openpyxl; print(openpyxl.__version__)"`
Expected: `3.1.5`

- [ ] **Step 5: Commit**

```bash
git add backend/requirements.txt
git commit -m "chore: add openpyxl for the xlsx importer"
```

---

### Task 2: Widen tax_inputs.value to 4 dp + two state tax keys + CI downgrade round-trip

The sheet stores true fractions as tax inputs (`State Exempt Percentage` = 0.9645); Numeric(14,2) would round them to 0.96 and Plan 5's cent-exact golden tests would fail. Also: the Taxes sheet carries two per-year state-engine data rows (`Standard/Itemized Deductions` and `Exemption Credits` under STATE INCOME TAX INFO) that belong in `tax_inputs` — add their definitions now so the importer can land them.

**Files:**
- Modify: `backend/app/models/taxes.py:47` (value column)
- Modify: `backend/app/tax_keys.py` (2 new definitions)
- Create: `backend/alembic/versions/<generated>_widen_tax_input_value.py`
- Modify: `backend/tests/test_models_taxes.py` (precision test)
- Modify: `.github/workflows/ci.yml` (downgrade round-trip)

- [ ] **Step 1: Write the failing precision test**

Append to `backend/tests/test_models_taxes.py`:

```python
async def test_tax_input_value_keeps_four_decimal_places(db):
    # The sheet stores fractional inputs (state-exempt pct 0.9645); 2 dp would corrupt them
    # and break Plan 5's cent-exact golden tests.
    db.add(TaxYear(year=2025))
    db.add(
        TaxInputDefinition(
            key="unq_div_state_exempt_pct",
            label="Unq Div: State Exempt Percentage",
            section="ordinary_income",
            sort_order=170,
        )
    )
    await db.flush()
    db.add(TaxInput(year=2025, key="unq_div_state_exempt_pct", value=Decimal("0.9645")))
    await db.commit()
    stored = (await db.execute(select(TaxInput.value))).scalar_one()
    assert stored == Decimal("0.9645")
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && .venv/Scripts/python -m pytest tests/test_models_taxes.py::test_tax_input_value_keeps_four_decimal_places -q -W error`
Expected: FAIL — stored value is `Decimal('0.96')` (current Numeric(14,2) rounds).

- [ ] **Step 3: Widen the model column**

In `backend/app/models/taxes.py`, class `TaxInput`, replace:

```python
    value: Mapped[Decimal] = mapped_column(Numeric(14, 2))
```

with:

```python
    # (14,4), not (14,2): the sheet stores fractional inputs (e.g. state-exempt dividend
    # percentage 0.9645) alongside dollar amounts; 4 dp preserves both.
    value: Mapped[Decimal] = mapped_column(Numeric(14, 4))
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && .venv/Scripts/python -m pytest tests/test_models_taxes.py -q -W error`
Expected: all pass (conftest builds the test schema from the models via create_all).

- [ ] **Step 5: Add the two state tax-input definitions**

In `backend/app/tax_keys.py`, append to `TAX_INPUT_DEFINITIONS` immediately after the `("itemized_other", ...)` entry (keep DEDUCTIONS grouped):

```python
    # CA state-engine data rows from the sheet's STATE INCOME TAX INFO block — per-year
    # values the Plan 5 engine needs; they are inputs, not brackets.
    ("state_standard_deduction", "State Standard Deduction", DEDUCTIONS, 150, False),
    ("state_exemption_credits", "State Exemption Credits", DEDUCTIONS, 160, False),
```

Then update the count assertion in `backend/tests/test_models_taxes.py::test_definitions_constant_is_complete` — read that test first; it asserts the definition count/coverage. Change the expected total from 41 to 43 (and section count for `deductions` from 14 to 16 if asserted).

- [ ] **Step 6: Run the model tests**

Run: `cd backend && .venv/Scripts/python -m pytest tests/test_models_taxes.py -q -W error`
Expected: PASS.

- [ ] **Step 7: Generate the migration**

Run (dev DB must be up):
```bash
cd backend && .venv/Scripts/alembic revision --autogenerate -m "widen tax input value to 4dp"
```
Expected: a new file `alembic/versions/<stamp>_<rev>_widen_tax_input_value_to_4dp.py` whose `upgrade()` contains exactly one `op.alter_column` on `tax_inputs.value` from `Numeric(14,2)` to `Numeric(14,4)` (plus the mirrored `downgrade()`). The mid-generation ruff "Found N errors (M fixed…)" output is benign (Plan 1 note). If autogenerate emits ANYTHING else, the dev DB has drift — stop and investigate; do not commit extra operations.

The generated body should be equivalent to:

```python
def upgrade() -> None:
    """Upgrade schema."""
    op.alter_column(
        "tax_inputs",
        "value",
        existing_type=sa.Numeric(precision=14, scale=2),
        type_=sa.Numeric(precision=14, scale=4),
        existing_nullable=False,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.alter_column(
        "tax_inputs",
        "value",
        existing_type=sa.Numeric(precision=14, scale=4),
        type_=sa.Numeric(precision=14, scale=2),
        existing_nullable=False,
    )
```

- [ ] **Step 8: Apply to the dev DB and round-trip**

```bash
cd backend && .venv/Scripts/alembic upgrade head && .venv/Scripts/alembic downgrade -1 && .venv/Scripts/alembic upgrade head
```
Expected: three clean runs, ending at the new head. (The dev DB's `tax_inputs` is empty pre-import, so the lossy downgrade is safe here.)

- [ ] **Step 9: Add the downgrade round-trip to CI (Plan 1 forward note: downgrade() is exercised by nothing)**

In `.github/workflows/ci.yml`, backend job, replace the final step:

```yaml
      - run: alembic upgrade head && alembic check
        working-directory: backend
        env:
          DATABASE_URL: postgresql+asyncpg://finance:finance@localhost:5433/finance
```

with:

```yaml
      # Migration smoke + drift guard + downgrade round-trip: a broken downgrade()
      # otherwise merges green because the test suite builds schema via create_all.
      - run: alembic upgrade head && alembic check && alembic downgrade base && alembic upgrade head
        working-directory: backend
        env:
          DATABASE_URL: postgresql+asyncpg://finance:finance@localhost:5433/finance
```

(Keep the existing comment lines above the step if present; the inline comment here replaces them.)

- [ ] **Step 10: Full backend gate + commit**

Run: `cd backend && .venv/Scripts/ruff check . && .venv/Scripts/ruff format --check . && .venv/Scripts/python -m pytest -q -W error`
Expected: clean, all tests pass.

```bash
git add backend/app/models/taxes.py backend/app/tax_keys.py backend/alembic/versions backend/tests/test_models_taxes.py .github/workflows/ci.yml
git commit -m "feat: widen tax_inputs.value to 4dp, add state deduction/exemption keys, CI downgrade round-trip"
```

---

### Task 3: Seed tests (Plan 1's untested paths)

`seed_admin_user` (including the rename branch that caused a real incident during Plan 1's Task 13 boot test) and `seed_app_settings` are untested; `seed_tax_definitions` is insert-only by design and that contract deserves a pin too.

**Files:**
- Create: `backend/tests/test_seed.py`

- [ ] **Step 1: Write the tests**

`backend/tests/test_seed.py`:

```python
from sqlalchemy import select

from app import seed as seed_module
from app.models import AppSetting, TaxInputDefinition, User
from app.seed import seed_admin_user, seed_app_settings, seed_tax_definitions
from app.tax_keys import TAX_INPUT_DEFINITIONS


async def test_seed_admin_user_creates_user(db, monkeypatch):
    monkeypatch.setattr(seed_module.settings, "admin_email", " Admin@Example.com ")
    monkeypatch.setattr(seed_module.settings, "admin_password", "changeme123")
    await seed_admin_user(db)
    await db.commit()
    user = (await db.execute(select(User))).scalar_one()
    assert user.email == "admin@example.com"  # normalized: strip + lower
    assert user.password_hash.startswith("$2b$")


async def test_seed_admin_user_renames_existing_instead_of_duplicating(db, monkeypatch):
    # The rename branch caused a real incident in Plan 1 Task 13 (boot test renamed the
    # dev admin). Pin: single-user app renames, never inserts a second row.
    monkeypatch.setattr(seed_module.settings, "admin_password", "changeme123")
    monkeypatch.setattr(seed_module.settings, "admin_email", "first@example.com")
    await seed_admin_user(db)
    await db.commit()
    original_hash = (await db.execute(select(User))).scalar_one().password_hash
    monkeypatch.setattr(seed_module.settings, "admin_email", "second@example.com")
    monkeypatch.setattr(seed_module.settings, "admin_password", "a-different-password")
    await seed_admin_user(db)
    await db.commit()
    users = (await db.execute(select(User))).scalars().all()
    assert len(users) == 1
    assert users[0].email == "second@example.com"
    assert users[0].password_hash == original_hash  # rename must not rotate the password


async def test_seed_admin_user_is_idempotent_and_keeps_password(db, monkeypatch):
    monkeypatch.setattr(seed_module.settings, "admin_email", "same@example.com")
    monkeypatch.setattr(seed_module.settings, "admin_password", "changeme123")
    await seed_admin_user(db)
    await db.commit()
    original_hash = (await db.execute(select(User))).scalar_one().password_hash
    monkeypatch.setattr(seed_module.settings, "admin_password", "a-different-password")
    await seed_admin_user(db)
    await db.commit()
    user = (await db.execute(select(User))).scalar_one()
    assert user.password_hash == original_hash  # re-seeding never rotates the password


async def test_seed_app_settings_inserts_defaults_once(db):
    await seed_app_settings(db)
    await db.commit()
    keys = set((await db.execute(select(AppSetting.key))).scalars().all())
    assert keys == {"swr_pct", "espp_ticker", "price_refresh_cron"}


async def test_seed_app_settings_never_overwrites_user_edits(db):
    await seed_app_settings(db)
    await db.commit()
    setting = await db.get(AppSetting, "swr_pct")
    setting.value = {"value": 0.035}
    await db.commit()
    await seed_app_settings(db)
    await db.commit()
    assert (await db.get(AppSetting, "swr_pct")).value == {"value": 0.035}


async def test_seed_tax_definitions_inserts_all_and_is_insert_only(db):
    await seed_tax_definitions(db)
    await db.commit()
    rows = (await db.execute(select(TaxInputDefinition))).scalars().all()
    assert len(rows) == len(TAX_INPUT_DEFINITIONS) == 43
    # Insert-only contract (Plan 1 forward note): label edits do NOT propagate.
    edited = await db.get(TaxInputDefinition, "annual_salary")
    edited.label = "User Edited Label"
    await db.commit()
    await seed_tax_definitions(db)
    await db.commit()
    assert (await db.get(TaxInputDefinition, "annual_salary")).label == "User Edited Label"
```

- [ ] **Step 2: Run them**

Run: `cd backend && .venv/Scripts/python -m pytest tests/test_seed.py -q -W error`
Expected: 6 passed. (These pin CURRENT behavior; if any fails, the seed has a real bug — stop and investigate rather than adjusting the test.)

- [ ] **Step 3: Full gate + commit**

Run: `cd backend && .venv/Scripts/ruff check . && .venv/Scripts/ruff format --check . && .venv/Scripts/python -m pytest -q -W error`

```bash
git add backend/tests/test_seed.py
git commit -m "test: pin seed_admin_user rename/idempotency, app settings, insert-only tax defs"
```

---

### Task 4: `cells.py` + `report.py` (pure foundations, TDD)

**Files:**
- Create: `backend/app/importer/__init__.py` (placeholder for now)
- Create: `backend/app/importer/cells.py`
- Create: `backend/app/importer/report.py`
- Test: `backend/tests/test_importer_cells.py`

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_importer_cells.py`:

```python
import datetime
from decimal import Decimal

from app.importer.cells import (
    Q2,
    Q4,
    Q6,
    Q9,
    CellIssues,
    cell_ref,
    first_of_month,
    is_placeholder_balance,
    slugify,
    synthetic_ticker,
    to_date_lenient,
    to_date_strict,
    to_decimal,
)
from app.importer.report import ImportReport, SheetReport


def dec(value, quantum=Q2, max_int_digits=12, issues=None):
    issues = issues if issues is not None else CellIssues()
    return to_decimal(value, quantum, max_int_digits, ctx="T!r1c1", issues=issues)


def test_to_decimal_rounds_half_up_not_bankers():
    # PG rounds half-away-from-zero; Python's default quantize is banker's (2.665 -> 2.66).
    assert dec(2.665) == Decimal("2.67")
    assert dec(-2.665) == Decimal("-2.67")


def test_to_decimal_uses_short_float_repr():
    assert dec(0.1) == Decimal("0.10")
    assert dec(8301.342763) == Decimal("8301.34")


def test_to_decimal_shares_and_pct_quanta():
    assert dec(381.259077932274, Q6, 10) == Decimal("381.259078")
    assert dec(0.334009166758825, Q9, 1) == Decimal("0.334009167")


def test_to_decimal_parses_numeric_strings():
    assert dec("45.54", Q4, 6) == Decimal("45.5400")


def test_to_decimal_error_cells_and_blanks_are_none_without_error():
    issues = CellIssues()
    assert dec("#N/A", issues=issues) is None
    assert dec("#REF!", issues=issues) is None
    assert dec("N/A", issues=issues) is None
    assert dec("  ", issues=issues) is None
    assert dec(None, issues=issues) is None
    assert issues.errors == []


def test_to_decimal_non_numeric_is_error_with_context():
    issues = CellIssues()
    assert dec("Average", issues=issues) is None
    assert dec(True, issues=issues) is None
    assert dec(datetime.datetime(2024, 1, 1), issues=issues) is None
    assert len(issues.errors) == 3
    assert all("T!r1c1" in e for e in issues.errors)


def test_to_decimal_enforces_numeric_bounds():
    issues = CellIssues()
    assert dec(Decimal("1e13"), Q2, 12, issues=issues) is None
    assert issues.errors and "NUMERIC" in issues.errors[0]


def test_placeholder_balance_detection_on_raw_values():
    assert is_placeholder_balance(0.001)
    assert is_placeholder_balance(-0.001)
    assert not is_placeholder_balance(0.0)
    assert not is_placeholder_balance(0.01)
    assert not is_placeholder_balance("0.001x")
    assert not is_placeholder_balance(None)


def test_to_date_strict_and_lenient():
    issues = CellIssues()
    assert to_date_strict(
        datetime.datetime(2024, 3, 1), ctx="T!r1c1", issues=issues
    ) == datetime.date(2024, 3, 1)
    assert to_date_strict(None, ctx="T!r1c1", issues=issues) is None
    assert issues.errors == []
    assert to_date_strict("2024-03-01", ctx="T!r1c1", issues=issues) is None
    assert len(issues.errors) == 1
    # ReferenceData junk: datetime.time(0, 0) ex-div cells coerce silently
    assert to_date_lenient(datetime.time(0, 0)) is None
    assert to_date_lenient("N/A") is None
    assert to_date_lenient(datetime.datetime(2023, 9, 30)) == datetime.date(2023, 9, 30)


def test_first_of_month_normalizes_with_warning():
    issues = CellIssues()
    assert first_of_month(
        datetime.date(2024, 3, 15), ctx="T!r1c1", issues=issues
    ) == datetime.date(2024, 3, 1)
    assert len(issues.warnings) == 1
    assert first_of_month(
        datetime.date(2024, 3, 1), ctx="T!r1c1", issues=issues
    ) == datetime.date(2024, 3, 1)
    assert len(issues.warnings) == 1  # no new warning when already first-of-month


def test_slugify():
    assert slugify("Wells Fargo Checking") == "wells-fargo-checking"
    assert slugify("Traditional 401(k)") == "traditional-401-k"
    assert slugify("Auto & Transport") == "auto-transport"
    assert slugify("Vehicle(s)") == "vehicle-s"
    assert slugify("Fidelity® 500 Index Fund") == "fidelity-500-index-fund"


def test_synthetic_ticker_short_unique():
    taken = {"NVDA"}
    first = synthetic_ticker("Fundrise Innovation Fund", taken)
    assert first == "X-FUNDRISE"
    assert len(first) <= 20
    taken.add(first)
    assert synthetic_ticker("Fundrise Innovation Something", taken) == "X-FUNDRISE-2"


def test_cell_ref_format():
    assert cell_ref("Net Worth", 5, 3) == "Net Worth!r5c3"


def test_sheet_report_counts_and_sample_cap():
    report = SheetReport()
    report.counts("accounts").creates += 1
    report.counts("accounts").skips += 2
    for i in range(60):
        report.add_sample(f"sample {i}")
    assert report.entities["accounts"].creates == 1
    assert len(report.samples) == 50
    assert report.samples_truncated == 10


def test_import_report_error_detection():
    report = ImportReport.new(dry_run=True)
    assert not report.has_errors
    report.sheets["taxes"].errors.append("boom")
    assert report.has_errors
    assert set(report.sheets) == {
        "reference_data",
        "positions",
        "portfolio",
        "net_worth",
        "spending",
        "taxes",
        "espp",
        "paycheck",
        "focal_history",
    }
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && .venv/Scripts/python -m pytest tests/test_importer_cells.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.importer'`.

- [ ] **Step 3: Implement `cells.py`**

`backend/app/importer/__init__.py` (placeholder; Task 10 fills it):

```python
"""Repeatable xlsx importer for the source spreadsheet (spec section 5)."""
```

`backend/app/importer/cells.py`:

```python
"""Pure cell-coercion helpers: strict Decimal, sheet quirks, slugs.

No SQLAlchemy or openpyxl imports — parsers hand in raw cell values. Callers pass a
`ctx` like "Net Worth!r5c3" so every issue carries row/col context (spec section 5).
"""

import datetime
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

# data_only=True returns cached formula errors as strings; the sheet also writes
# literal N/A into computed cells. All coerce to None (caller decides what that means).
ERROR_STRINGS = frozenset(
    {"#N/A", "#REF!", "#VALUE!", "#DIV/0!", "#NAME?", "#NUM!", "#NULL!", "#ERROR!", "N/A", "n/a"}
)

Q2 = Decimal("0.01")
Q4 = Decimal("0.0001")
Q5 = Decimal("0.00001")
Q6 = Decimal("0.000001")
Q9 = Decimal("0.000000001")

_PLACEHOLDER = Decimal("0.001")


class CellIssues:
    """Warning/error accumulator shared by the parsers of one sheet."""

    def __init__(self) -> None:
        self.warnings: list[str] = []
        self.errors: list[str] = []

    def warn(self, message: str) -> None:
        self.warnings.append(message)

    def error(self, message: str) -> None:
        self.errors.append(message)


def cell_ref(sheet: str, row: int, col: int) -> str:
    return f"{sheet}!r{row}c{col}"


def to_decimal(
    value: object,
    quantum: Decimal,
    max_int_digits: int,
    *,
    ctx: str,
    issues: CellIssues,
) -> Decimal | None:
    """Strict money/number parsing. None, blank, and error-cells return None silently;
    anything else non-numeric records an error and returns None. The result is quantized
    HALF_UP (PG rounds half-away-from-zero; Python's default is banker's) and bounds-checked
    against the target NUMERIC's integer-digit budget (overflow otherwise surfaces as a bare
    DBAPIError, sqlstate 22003 — Plan 1 forward note)."""
    if value is None:
        return None
    if isinstance(value, bool):  # bool is an int subclass — must be rejected first
        issues.error(f"{ctx}: expected a number, got boolean {value}")
        return None
    if isinstance(value, str):
        text = value.strip()
        if not text or text in ERROR_STRINGS:
            return None
        try:
            raw = Decimal(text)
        except InvalidOperation:
            issues.error(f"{ctx}: expected a number, got {value!r}")
            return None
    elif isinstance(value, int | float | Decimal):
        # str() first: Decimal(float) would exhume binary representation noise
        raw = Decimal(str(value))
    else:
        issues.error(f"{ctx}: expected a number, got {type(value).__name__}")
        return None
    quantized = raw.quantize(quantum, rounding=ROUND_HALF_UP)
    if quantized.copy_abs() >= 10**max_int_digits:
        issues.error(f"{ctx}: {raw} exceeds NUMERIC({max_int_digits} integer digits) bounds")
        return None
    return quantized


def is_placeholder_balance(value: object) -> bool:
    """The sheet marks unused accounts with 0.001/-0.001. Must be detected on the RAW
    value — Numeric(14,2) storage would silently collapse it into a real zero."""
    if isinstance(value, bool) or not isinstance(value, int | float | Decimal):
        return False
    return Decimal(str(value)).copy_abs() == _PLACEHOLDER


def to_date_strict(value: object, *, ctx: str, issues: CellIssues) -> datetime.date | None:
    """For cells that must be dates (months, purchase dates). Non-date non-None = error."""
    if value is None:
        return None
    if isinstance(value, datetime.datetime):
        return value.date()
    if isinstance(value, datetime.date):
        return value
    issues.error(f"{ctx}: expected a date, got {value!r}")
    return None


def to_date_lenient(value: object) -> datetime.date | None:
    """For known-junk date cells (ReferenceData ex-div holds time(0,0) and 'N/A')."""
    if isinstance(value, datetime.datetime):
        return value.date()
    if isinstance(value, datetime.date):
        return value
    return None


def first_of_month(
    value: datetime.date, *, ctx: str, issues: CellIssues
) -> datetime.date:
    """DB CheckConstraints enforce day==1; normalize earlier for clean errors."""
    if value.day == 1:
        return value
    issues.warn(f"{ctx}: {value.isoformat()} normalized to first of month")
    return value.replace(day=1)


def slugify(name: str) -> str:
    out: list[str] = []
    previous_dash = True  # suppress leading dash
    for ch in name.lower():
        if ch.isascii() and ch.isalnum():
            out.append(ch)
            previous_dash = False
        elif not previous_dash:
            out.append("-")
            previous_dash = True
    return "".join(out).strip("-")


def synthetic_ticker(name: str, taken: set[str]) -> str:
    """Short deterministic ticker for a Positions security missing from ReferenceData
    (String(20), Plan 1 forward note: keep them short)."""
    base = "X-" + "".join(ch for ch in name.upper() if ch.isalnum())[:8]
    if base == "X-":
        base = "X-ASSET"
    candidate = base
    suffix = 2
    while candidate in taken:
        candidate = f"{base}-{suffix}"
        suffix += 1
    return candidate
```

- [ ] **Step 4: Implement `report.py`**

`backend/app/importer/report.py`:

```python
"""Import report — the single shape behind the CLI printer and the API response."""

from pydantic import BaseModel, Field

SAMPLE_CAP = 50

SHEET_KEYS = (
    "reference_data",
    "positions",
    "portfolio",
    "net_worth",
    "spending",
    "taxes",
    "espp",
    "paycheck",
    "focal_history",
)


class EntityCounts(BaseModel):
    creates: int = 0
    updates: int = 0
    skips: int = 0
    deletes: int = 0


class SheetReport(BaseModel):
    entities: dict[str, EntityCounts] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)
    samples: list[str] = Field(default_factory=list)
    samples_truncated: int = 0

    def counts(self, entity: str) -> EntityCounts:
        return self.entities.setdefault(entity, EntityCounts())

    def add_sample(self, text: str) -> None:
        if len(self.samples) < SAMPLE_CAP:
            self.samples.append(text)
        else:
            self.samples_truncated += 1


class ImportReport(BaseModel):
    dry_run: bool
    applied: bool = False
    sheets: dict[str, SheetReport]

    @classmethod
    def new(cls, dry_run: bool) -> "ImportReport":
        return cls(dry_run=dry_run, sheets={key: SheetReport() for key in SHEET_KEYS})

    @property
    def has_errors(self) -> bool:
        return any(sheet.errors for sheet in self.sheets.values())

    def render_text(self) -> str:
        lines = [f"dry_run={self.dry_run} applied={self.applied}"]
        for key, sheet in self.sheets.items():
            lines.append(f"\n== {key} ==")
            for entity, counts in sheet.entities.items():
                lines.append(
                    f"  {entity}: +{counts.creates} ~{counts.updates} "
                    f"={counts.skips} -{counts.deletes}"
                )
            for warning in sheet.warnings:
                lines.append(f"  WARN: {warning}")
            for error in sheet.errors:
                lines.append(f"  ERROR: {error}")
            for sample in sheet.samples:
                lines.append(f"  {sample}")
            if sheet.samples_truncated:
                lines.append(f"  ... and {sheet.samples_truncated} more changes")
        return "\n".join(lines)
```

- [ ] **Step 5: Run tests to verify pass**

Run: `cd backend && .venv/Scripts/python -m pytest tests/test_importer_cells.py -q -W error`
Expected: all pass.

- [ ] **Step 6: Format, gate, commit**

Run: `cd backend && .venv/Scripts/ruff format app/importer tests/test_importer_cells.py && .venv/Scripts/ruff check . && .venv/Scripts/python -m pytest -q -W error`

```bash
git add backend/app/importer backend/tests/test_importer_cells.py
git commit -m "feat: importer cell coercion and report primitives"
```

---

### Task 5: Synthetic workbook fixture builder

Spec §9: the real workbook contains personal data and stays out of the repo; tests build a small synthetic workbook in-memory with openpyxl that reproduces every layout quirk. All parser/apply/service tests consume this builder.

**Files:**
- Create: `backend/tests/workbook_builder.py`
- Test: `backend/tests/test_importer_parsers.py` (smoke test only in this task)

- [ ] **Step 1: Write the builder**

`backend/tests/workbook_builder.py`:

```python
"""Synthetic source-workbook builder mirroring the real sheet layouts (spec section 9).

Each default_*_rows() returns fresh row lists tests may mutate before build_workbook().
Layout quirks reproduced: two-row Net Worth header with merged-band Nones and % columns,
0.001 sentinels, 'Average' + numeric-year rollup + future template rows, zero-share
position rows, formula-error strings, time(0,0) ex-div junk, ESPP template dates and
taxation-calculator block, partial focal rows.
"""

import io
from datetime import date, datetime, time

import openpyxl

# Keep in sync with parse_taxes: the builder generates the 41-label input block from the
# parser's own sequence so fixture and contract cannot drift.
from app.importer.parsers import SHEET_TAX_INPUT_SEQUENCE


def default_net_worth_rows() -> list[list]:
    return [
        ["Month", "Date", "CASH", None, "PRE-TAX", None, "LIABILITIES", None, "NET WORTH", None],
        [None, None, "Checking", "%", "IRA", "%", "Credit Card", "%", None, None],
        [datetime(2024, 1, 1), datetime(2024, 1, 5), 100.5, "N/A", 0.001, "N/A", 25.0, "N/A", 75.5, "N/A"],
        [datetime(2024, 2, 1), datetime(2024, 2, 1), 200.0, 0.99, 50.25, 0, 30.0, 0.2, 220.25, 1.9],
        [datetime(2024, 3, 1), datetime(2024, 3, 1), None, 0, None, 0, None, 0, None, 0],
    ]


def default_spending_rows() -> list[list]:
    return [
        [None, "Food", "Rent", "TOTAL", "Net Pay", "4% Portfolio", "Savings Rate"],
        ["Average", 10, 20, 30, None, None, None],
        [datetime(2024, 1, 1), 100.0, 900.0, 1000.0, 3000.0, 50.0, 0.5],
        [datetime(2024, 2, 1), 50.0, 900.0, 951.0, 3000.0, 50.0, 0.5],
        [2024.0, 150.0, 1800.0, 1950.0, 6000.0, None, None],
        [datetime(2024, 3, 1), None, None, None, None, None, None],
    ]


def default_positions_rows() -> list[list]:
    header = [
        "Platforms", "Type", "Stock", "Transacted Shares", "Transacted Price/ Share",
        "Fees", "Stock Split", "Prev Row", "Previous Shares", "Cumulative Shares",
        "Transacted Value", "Previous Cost",
    ]
    return [
        header,
        ["RH Taxable", "Buy", "Acme ETF", 10.123456789, 100.123456, None, None, 0, 0, 0, 0, 0],
        ["RH Taxable", "Buy", "Acme ETF", 0.0, 0.0, None, None, 0, 0, 0, 0, 0],
        ["Fido", "Sell", "Acme ETF", 2.0, 110.0, 1.5, None, 0, 0, 0, 0, 0],
        ["RH Taxable", "Buy", "Mystery Fund", 1.0, 25.0, None, None, 0, 0, 0, 0, 0],
    ]


def default_portfolio_rows() -> list[list]:
    header = [
        "Company Name", "Ticker", "Industry", "Shares", "Market Weight", "Current Price",
        "Daily Gain/Loss", "Daily Change %", "1yr Chart", "Cost Basis", "Market Value",
        "Unrealized Gain/Loss", "Unrealized Gain/Loss %", "XIRR", "Realized Gain/Loss",
        "Dividends Collected", "Total Gain/Loss",
    ]
    totals = [None, None, None, None, 1, None, 0, 0, None, 0, 0, 0, 0, 0, 0, 0, 0]
    return [
        header,
        totals,
        ["Acme ETF", "ACME", "ETF", 10, 0.5, 100.5, 0, 0, None, 0, 0, 0, 0, 0, 0, 0, 0],
        ["Div Corp", "DIVC", "Financials", 5, 0.5, 20.0, 0, 0, None, 0, 0, 0, 0, 0, 0, 12.5, 0],
    ]


def default_taxes_rows() -> list[list]:
    rows: list[list] = [["Fill in White cells", None, 2023.0, 2024.0, 2025.0]]
    # 41-label input block, values 100+i (year1) / 200+i (year2); year3 column stays empty.
    counter = 0
    for section_header, sequence in SHEET_TAX_INPUT_SEQUENCE:
        for offset, (label, key) in enumerate(sequence):
            value1, value2 = 100.0 + counter, 200.0 + counter
            if key == "unq_div_state_exempt_pct":
                value1, value2 = 0.9645, 0.9753
            rows.append([section_header if offset == 0 else None, label, value1, value2, None])
            counter += 1
    rows += [
        ["FEDERAL INCOME TAX INFO", "Standard/Itemized Deductions", 13850.0, 14600.0, None],
        [None, "Bracket 1 Rate", 0.1, 0.1, None],
        [None, "Bracket 2 Rate", 0.12, 0.12, None],
        [None, "Bracket 1 Threshold", 0.0, 0.0, None],
        [None, "Bracket 2 Threshold", 11000.0, 11600.0, None],
        ["STATE INCOME TAX INFO", "Standard/Itemized Deductions", 5363.0, 5540.0, None],
        [None, "Exemption Credits", 144.0, 149.0, None],
        [None, "Bracket 1 Rate", 0.01, 0.01, None],
        [None, "Bracket 1 Threshold", 0.0, 0.0, None],
        ["MEDICARE TAX INFO", "Bracket 1 Rate", 0.0145, 0.0145, None],
        [None, "Bracket 1 Threshold", 0.0, 0.0, None],
        ["SOCIAL SECURITY TAX INFO", "Bracket 1 Rate", 0.062, 0.062, None],
        [None, "Bracket 1 Threshold", 0.0, 0.0, None],
        ["DISABILITY TAX INFO", "Bracket 1 Rate", 0.009, 0.01, None],
        [None, "Bracket 1 Threshold", 0.0, 0.0, None],
        ["CAPITAL GAINS TAX INFO", "Bracket 1 Rate", 0.0, 0.0, None],
        [None, "Bracket 1 Threshold", 0.0, 0.0, None],
        ["FEDERAL INCOME TAX", "Federal AGI", 99999.0, 99999.0, None],
        [None, "Taxes", 12345.0, 12345.0, None],
    ]
    return rows


def default_espp_rows() -> list[list]:
    # Columns B-E = modeler block; columns I-N = lots table. One row list covers both.
    def merged(row_bd: list, row_in: list) -> list:
        return [None] + row_bd + [None] * (8 - 1 - len(row_bd)) + row_in

    rows = [
        [None],
        merged(["ESPP Modeler", "TOTAL CALENDAR YEAR", None, "<$25,000"],
               ["ESPP Purchase Date", "Qualifying Date", "Shares Purchased",
                "Subscription Price", "Purchase Date FMV", "Puchase Price"]),
        merged([None, "FEBRUARY PURCHASE", "AUGUST PURCHASE", None],
               [datetime(2024, 2, 29), datetime(2025, 9, 1), 100.0, 40.0, 50.0, 34.0]),
        merged([None, "September-February Period", "March-August Period", None],
               [datetime(2024, 8, 30), datetime(2026, 2, 28), 90.0, 40.0, 55.0, 34.0]),
        merged(["Semi-Annual Base Salary", 50000.0, 60000.0, "enter your semi-annual base salary"],
               [datetime(2025, 2, 27), None, None, None, None, None]),
        merged(["Additional payments (i.e. bonuses)", 0.0, 100.0, None],
               [datetime(2025, 8, 29), None, None, None, None, None]),
        merged(["Total Eligible Earnings for 6-month Period", 50000.0, 60100.0, None],
               [datetime(2026, 2, 27), None, None, None, None, None]),
        merged(["ESPP Contribution Percentage", 0.1, 0.15, "enter your ESPP %"],
               [None, None, None, None, None, None]),
    ]
    rows += [[None]] * 3
    rows += [
        [None, "ESPP Taxation Calculator"],
        [None, "Date of Sale", datetime(2025, 9, 1)],
    ]
    return rows


def default_paycheck_rows() -> list[list]:
    return [
        [None],
        [None, "Earnings", None, None, "Percentages", None],
        [None, "Annual Salary", 120000.0, None, "Traditional 401(k) %", 0.1],
        [None, "Gross Paycheck", 5000.0, None, "Roth 401(k) %", 0.0],
        [None, "Pretax Deductions", None, None, "AT 401(k) %", 0.02],
        [None, "Trad. 401(k)", 500.0, None, "Tax Withholding %", 0.250000000123456],
        [None, "Dental & Vision", 10.0, None, "ESPP %", 0.05],
        [None, "HSA", 50.0, None, None, None],
    ]


def default_focal_rows() -> list[list]:
    return [
        [None],
        [None, "Focal Year", "Current Base", "New Base", "Base Delta ($)", "Base Delta (%)",
         "Unvested RSUs", "Unvested Price", "Unvested Equity", "Refresh RSUs", "Grant Price",
         "Equity Delta ($)"],
        [None, 2024.0, 110000.0, 120000.0, 10000, 0.09, 500.0, 89.66, 44830, 100.0, 90.0, 9000],
        [None, 2025.0, 120000.0, None, None, None, None, None, None, None, None, None],
        [None, 2026.0, None, None, None, None, None, None, None, None, None, None],
    ]


def default_reference_data_rows() -> list[list]:
    return [
        ["Symbol", "Name", "Sector", "Cost Per Share", "Last Price", "Dividend Yield",
         "Dividend per Share", "Payout Ratio", "Ex-Dividend Date"],
        ["ACME", "Acme ETF", "ETF", 90.0, 100.5, "1.2", "2.5", 0, datetime(2024, 1, 31)],
        ["DIVC", "Div Corp", "Financials", "#REF!", "#N/A", "3.4", "1.25", 0, time(0, 0)],
        ["MUT1", "Mut Fund", "Mutual Fund", 25.0, 25.75, None, 0, 0, "N/A"],
    ]


def build_workbook(**overrides) -> bytes:
    """Build the synthetic workbook; override any sheet via keyword (rows list-of-lists)."""
    sheets = {
        "Paycheck Modeler": overrides.get("paycheck", default_paycheck_rows()),
        "ESPP": overrides.get("espp", default_espp_rows()),
        "Focal History": overrides.get("focal", default_focal_rows()),
        "Positions": overrides.get("positions", default_positions_rows()),
        "Spending": overrides.get("spending", default_spending_rows()),
        "Taxes": overrides.get("taxes", default_taxes_rows()),
        "Net Worth": overrides.get("net_worth", default_net_worth_rows()),
        "Portfolio": overrides.get("portfolio", default_portfolio_rows()),
        "ReferenceData": overrides.get("reference_data", default_reference_data_rows()),
    }
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    for title, rows in sheets.items():
        if rows is None:
            continue  # simulate a missing sheet
        ws = wb.create_sheet(title=title)
        for row in rows:
            ws.append(row)
    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


def load_readonly(data: bytes) -> openpyxl.Workbook:
    """Reload the built bytes exactly the way the service loads uploads."""
    return openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
```

Note for the implementer: `date` is imported for tests that build override rows; if ruff flags it unused in the final file, drop it from the import line (format wins).

- [ ] **Step 2: Parser sequence constant must exist first**

The builder imports `SHEET_TAX_INPUT_SEQUENCE` from `app/importer/parsers.py`, created in this task with ONLY the constant and its imports (parsers arrive in Tasks 6–9):

`backend/app/importer/parsers.py`:

```python
"""Pure sheet parsers: worksheet -> normalized dataclasses + issues. No DB imports here."""

import dataclasses
import datetime
from decimal import Decimal

from app.importer.cells import (
    Q2,
    Q4,
    Q5,
    Q6,
    Q9,
    CellIssues,
    cell_ref,
    first_of_month,
    is_placeholder_balance,
    slugify,
    to_date_lenient,
    to_date_strict,
    to_decimal,
)

ROW_CAP = 2000  # unsized Google-Sheets export: never trust ws.max_row (see plan notes)
BLANK_STREAK_STOP = 5

# The Taxes sheet's input labels in exact row order per section. The parser walks this
# sequence and hard-errors on any mismatch — it is the layout-drift detector. Keys must
# exist in app.tax_keys (asserted by tests).
SHEET_TAX_INPUT_SEQUENCE: list[tuple[str, list[tuple[str, str]]]] = [
    (
        "ORDINARY INCOME",
        [
            ("Annual Salary", "annual_salary"),
            ("Gross Paycheck", "gross_paycheck"),
            ("Pay Periods", "pay_periods"),
            ("Latest W2 Income", "latest_w2_income"),
            ("Other W2 Income", "other_w2_income"),
            ("(Stock/RSUs Sold)", "w2_stock_rsus_sold"),
            ("(Bonuses)", "w2_bonuses"),
            ("(Salary Checkpoint)", "w2_salary_checkpoint"),
            ("(ESPP Sale Component)", "w2_espp_sale_component"),
            ("(Employer HSA Contribution)", "w2_employer_hsa"),
            ("(Other, specify)", "w2_other"),
            ("Short Term Capital Gain/Loss", "stcg_total"),
            ("(Standard Gain/Loss)", "stcg_standard"),
            ("(ESPP Sale Component)", "stcg_espp_component"),
            ("Unqualified Dividends", "unqualified_dividends"),
            ("(US Treasuries ETF)", "unq_div_us_treasuries_etf"),
            ("(State Exempt Percentage)", "unq_div_state_exempt_pct"),
            ("(Other Dividends)", "unq_div_other"),
            ("Interest", "interest_total"),
            ("(Standard Interest)", "interest_standard"),
            ("(US Treasuries)", "interest_us_treasuries"),
            ("Other Income, eg. 1099 MISC", "other_income_1099"),
        ],
    ),
    (
        "DEDUCTIONS",
        [
            ("Traditional 401k Contributions", "trad_401k_contributions"),
            ("HSA Contributions", "hsa_contributions"),
            ("HSA Contributions (Employer)", "hsa_contributions_employer"),
            ("Capital Loss Deductions", "capital_loss_deductions"),
            ("Other Pre-tax Deductions", "other_pretax_deductions"),
            ("(Dental)", "pretax_dental"),
            ("(Vision)", "pretax_vision"),
            ("Standard Deduction", "standard_deduction"),
            ("Itemized Deduction", "itemized_deduction"),
            ("(SALT Amount)", "itemized_salt"),
            ("(Donations/Tithes)", "itemized_donations"),
            ("(Vehicle Registration Fees)", "itemized_vehicle_reg"),
            ("(Sec 199A Div - [20%])", "itemized_sec199a_div"),
            ("(Other Items)", "itemized_other"),
        ],
    ),
    (
        "CAPITAL GAINS",
        [
            ("Long Term Capital Gain/Loss", "ltcg_total"),
            ("(Brokerage Gain/Loss)", "ltcg_brokerage"),
            ("(ESPP Sale Component)", "ltcg_espp_component"),
            ("Qualified Dividends", "qualified_dividends"),
            ("Other Capital Gains", "other_capital_gains"),
        ],
    ),
]
```

(Sub-item labels are stored stripped of their leading spaces — the parser compares against `label.strip()`. The parenthesized text is kept verbatim, e.g. `"(Other, specify)"`.)

- [ ] **Step 3: Write the smoke test**

`backend/tests/test_importer_parsers.py` (started here; parser tests append in Tasks 6–9):

```python
import datetime
from decimal import Decimal

from app.importer.parsers import SHEET_TAX_INPUT_SEQUENCE
from app.tax_keys import TAX_INPUT_DEFINITIONS
from tests.workbook_builder import build_workbook, load_readonly


def test_builder_produces_loadable_workbook_with_all_sheets():
    wb = load_readonly(build_workbook())
    assert set(wb.sheetnames) == {
        "Paycheck Modeler", "ESPP", "Focal History", "Positions", "Spending",
        "Taxes", "Net Worth", "Portfolio", "ReferenceData",
    }
    ws = wb["Net Worth"]
    rows = list(ws.iter_rows(min_row=1, max_row=1, max_col=3, values_only=True))
    assert rows[0][0] == "Month"
    wb.close()


def test_sheet_tax_sequence_matches_tax_keys():
    sequence_keys = [
        key for _, entries in SHEET_TAX_INPUT_SEQUENCE for _, key in entries
    ]
    definition_keys = [key for key, *_ in TAX_INPUT_DEFINITIONS]
    # The sheet block covers exactly the 41 original definitions (the 2 state keys from
    # Task 2 are parsed out of the STATE bracket section instead).
    assert sequence_keys == [k for k in definition_keys if not k.startswith("state_")]
    assert len(sequence_keys) == 41
```

Note: importing `tests.workbook_builder` works because pytest runs from `backend/` with rootdir inference; if the import fails, use a plain `from workbook_builder import ...` — match whichever import style `tests/conftest.py` consumers already use (Plan 1 tests have no cross-test imports yet; prefer `from tests.workbook_builder import ...` and add `backend/tests/__init__.py` if it does not already exist — it does exist from Plan 1).

- [ ] **Step 4: Run**

Run: `cd backend && .venv/Scripts/python -m pytest tests/test_importer_parsers.py -q -W error`
Expected: 2 passed.

- [ ] **Step 5: Format, gate, commit**

Run: `cd backend && .venv/Scripts/ruff format app tests && .venv/Scripts/ruff check . && .venv/Scripts/python -m pytest -q -W error`

```bash
git add backend/app/importer/parsers.py backend/tests/workbook_builder.py backend/tests/test_importer_parsers.py
git commit -m "feat: synthetic workbook fixture builder and taxes label sequence"
```

---

### Task 6: Parsers — ReferenceData + Positions (TDD)

**Files:**
- Modify: `backend/app/importer/parsers.py` (append)
- Modify: `backend/tests/test_importer_parsers.py` (append)

- [ ] **Step 1: Write the failing tests** (append to `backend/tests/test_importer_parsers.py`)

```python
def _sheet(name, **overrides):
    wb = load_readonly(build_workbook(**overrides))
    return wb[name]


def test_parse_reference_data_maps_fields_and_junk():
    from app.importer.parsers import parse_reference_data

    parsed = parse_reference_data(_sheet("ReferenceData"))
    assert parsed.issues.errors == []
    by_ticker = {s.ticker: s for s in parsed.securities}
    assert set(by_ticker) == {"ACME", "DIVC", "MUT1"}
    acme = by_ticker["ACME"]
    assert acme.name == "Acme ETF"
    assert acme.industry == "ETF"
    assert acme.holding_type == "etf"
    assert acme.annual_dividend == Decimal("2.5000")  # string cell '2.5'
    assert acme.ex_div_date == datetime.date(2024, 1, 31)
    assert acme.last_price == Decimal("100.5000")
    divc = by_ticker["DIVC"]
    assert divc.holding_type == "stock"
    assert divc.ex_div_date is None  # time(0,0) junk -> None silently
    assert divc.last_price is None  # '#N/A' -> skipped with warning
    assert any("last price" in w.lower() for w in parsed.issues.warnings)
    assert by_ticker["MUT1"].holding_type == "mutual_fund"


def test_parse_reference_data_duplicate_ticker_or_name_is_error():
    from app.importer.parsers import parse_reference_data

    rows = [
        ["Symbol", "Name", "Sector", None, None, None, None, None, None],
        ["AAA", "Same Name", "ETF", None, 1.0, None, None, None, None],
        ["AAA", "Other Name", "ETF", None, 1.0, None, None, None, None],
        ["BBB", "Same Name", "ETF", None, 1.0, None, None, None, None],
    ]
    parsed = parse_reference_data(_sheet("ReferenceData", reference_data=rows))
    assert len(parsed.issues.errors) == 2  # duplicate ticker AAA, duplicate name


def test_parse_positions_skips_zero_share_rows_and_keeps_order():
    from app.importer.parsers import parse_positions

    parsed = parse_positions(_sheet("Positions"))
    assert parsed.issues.errors == []
    assert [t.name for t in parsed.transactions] == ["Acme ETF", "Acme ETF", "Mystery Fund"]
    first, sell, mystery = parsed.transactions
    assert first.account == "RH Taxable"
    assert first.type == "buy"
    assert first.txn_date is None  # the sheet has no date column (spec risk)
    assert first.shares == Decimal("10.123457")  # 12dp -> 6dp HALF_UP
    assert first.price == Decimal("100.1235")  # 6dp -> 4dp HALF_UP
    assert first.fees is None
    assert first.sort_index == 20  # sheet row 2 * 10
    assert sell.type == "sell"
    assert sell.fees == Decimal("1.50")
    assert sell.sort_index == 40  # row 4 (the zero-share row 3 was skipped, index keeps row order)
    assert mystery.sort_index == 50
    assert any("zero-share" in w.lower() for w in parsed.issues.warnings)


def test_parse_positions_split_and_bad_type():
    from app.importer.parsers import parse_positions

    rows = default_positions_rows()[:2]
    rows.append(["RH Taxable", "Split", "Acme ETF", None, None, None, 4.0, 0, 0, 0, 0, 0])
    rows.append(["RH Taxable", "Split", "Acme ETF", None, None, None, None, 0, 0, 0, 0, 0])
    rows.append(["RH Taxable", "Gift", "Acme ETF", 1.0, 1.0, None, None, 0, 0, 0, 0, 0])
    parsed = parse_positions(_sheet("Positions", positions=rows))
    split = parsed.transactions[-1]
    assert split.type == "split"
    assert split.split_factor == Decimal("4.0000")
    assert split.shares == Decimal("0") and split.price == Decimal("0")  # dummy per Plan 1 convention
    assert len(parsed.issues.errors) == 2  # split without factor; unknown type 'Gift'
```

Add `default_positions_rows` to the existing `from tests.workbook_builder import ...` line.

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && .venv/Scripts/python -m pytest tests/test_importer_parsers.py -q`
Expected: FAIL — `ImportError: cannot import name 'parse_reference_data'`.

- [ ] **Step 3: Implement** (append to `backend/app/importer/parsers.py`)

```python
@dataclasses.dataclass
class ParsedSecurity:
    ticker: str
    name: str
    industry: str | None
    holding_type: str
    annual_dividend: Decimal | None
    ex_div_date: datetime.date | None
    last_price: Decimal | None


@dataclasses.dataclass
class ParsedReferenceData:
    securities: list[ParsedSecurity]
    issues: CellIssues


def _iter_rows(ws, *, min_row: int, max_col: int, max_row: int = ROW_CAP):
    """Bounded values_only iteration with 1-based row numbers (unsized-worksheet safe)."""
    return enumerate(
        ws.iter_rows(min_row=min_row, max_row=max_row, max_col=max_col, values_only=True),
        start=min_row,
    )


def _text(value: object) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


HOLDING_TYPE_BY_SECTOR = {"ETF": "etf", "Mutual Fund": "mutual_fund"}


def parse_reference_data(ws) -> ParsedReferenceData:
    issues = CellIssues()
    securities: list[ParsedSecurity] = []
    seen_tickers: set[str] = set()
    seen_names: set[str] = set()
    blanks = 0
    for rnum, row in _iter_rows(ws, min_row=2, max_col=9, max_row=500):
        if all(v is None for v in row):
            blanks += 1
            if blanks >= BLANK_STREAK_STOP:
                break
            continue
        blanks = 0
        ticker = _text(row[0])
        name = _text(row[1])
        if ticker is None or name is None:
            issues.error(f"{cell_ref('ReferenceData', rnum, 1)}: row needs Symbol and Name")
            continue
        if len(ticker) > 20 or len(name) > 200:
            issues.error(f"{cell_ref('ReferenceData', rnum, 1)}: Symbol/Name too long")
            continue
        if ticker in seen_tickers:
            issues.error(f"{cell_ref('ReferenceData', rnum, 1)}: duplicate ticker {ticker}")
            continue
        if name in seen_names:
            issues.error(f"{cell_ref('ReferenceData', rnum, 2)}: duplicate name {name!r}")
            continue
        seen_tickers.add(ticker)
        seen_names.add(name)
        sector = _text(row[2])
        last_price = to_decimal(
            row[4], Q4, 10, ctx=cell_ref("ReferenceData", rnum, 5), issues=issues
        )
        if last_price is None and row[4] is not None:
            issues.warn(
                f"{cell_ref('ReferenceData', rnum, 5)}: last price unavailable "
                f"({row[4]!r}); latest_prices row skipped for {ticker}"
            )
        securities.append(
            ParsedSecurity(
                ticker=ticker,
                name=name,
                industry=sector,
                holding_type=HOLDING_TYPE_BY_SECTOR.get(sector, "stock"),
                annual_dividend=to_decimal(
                    row[6], Q4, 6, ctx=cell_ref("ReferenceData", rnum, 7), issues=issues
                ),
                ex_div_date=to_date_lenient(row[8]),
                last_price=last_price,
            )
        )
    return ParsedReferenceData(securities=securities, issues=issues)


@dataclasses.dataclass
class ParsedTransaction:
    account: str
    type: str
    name: str  # security NAME (ReferenceData resolves it to a ticker at apply time)
    txn_date: datetime.date | None
    shares: Decimal
    price: Decimal
    fees: Decimal | None
    split_factor: Decimal | None
    sort_index: int


@dataclasses.dataclass
class ParsedPositions:
    transactions: list[ParsedTransaction]
    issues: CellIssues


TRANSACTION_TYPE_MAP = {"buy": "buy", "sell": "sell", "split": "split"}


def parse_positions(ws) -> ParsedPositions:
    issues = CellIssues()
    transactions: list[ParsedTransaction] = []
    zero_share_rows = 0
    blanks = 0
    for rnum, row in _iter_rows(ws, min_row=2, max_col=7, max_row=500):
        if all(v is None for v in row):
            blanks += 1
            if blanks >= BLANK_STREAK_STOP:
                break
            continue
        blanks = 0
        account = _text(row[0])
        type_text = _text(row[1])
        name = _text(row[2])
        if account is None or type_text is None or name is None:
            issues.error(
                f"{cell_ref('Positions', rnum, 1)}: row needs Platforms, Type and Stock"
            )
            continue
        txn_type = TRANSACTION_TYPE_MAP.get(type_text.lower())
        if txn_type is None:
            issues.error(f"{cell_ref('Positions', rnum, 2)}: unknown type {type_text!r}")
            continue
        fees = to_decimal(row[5], Q2, 8, ctx=cell_ref("Positions", rnum, 6), issues=issues)
        split_factor = to_decimal(
            row[6], Q4, 6, ctx=cell_ref("Positions", rnum, 7), issues=issues
        )
        if txn_type == "split":
            if split_factor is None:
                issues.error(f"{cell_ref('Positions', rnum, 7)}: split row needs Stock Split")
                continue
            # shares/price are NOT NULL; split rows carry dummy zeros (Plan 1 convention —
            # Plan 4's folding reads only split_factor on splits).
            shares, price = Decimal("0"), Decimal("0")
        else:
            shares = to_decimal(row[3], Q6, 10, ctx=cell_ref("Positions", rnum, 4), issues=issues)
            price = to_decimal(row[4], Q4, 10, ctx=cell_ref("Positions", rnum, 5), issues=issues)
            if shares is None or price is None:
                issues.error(
                    f"{cell_ref('Positions', rnum, 4)}: buy/sell row needs shares and price"
                )
                continue
            if shares == 0:
                zero_share_rows += 1
                continue
        transactions.append(
            ParsedTransaction(
                account=account,
                type=txn_type,
                name=name,
                txn_date=None,  # the sheet has no date column (spec Risks)
                shares=shares,
                price=price,
                fees=fees,
                split_factor=split_factor,
                sort_index=rnum * 10,
            )
        )
    if zero_share_rows:
        issues.warn(
            f"Positions: skipped {zero_share_rows} zero-share placeholder row(s) "
            "(sheet running-total chain artifacts)"
        )
    return ParsedPositions(transactions=transactions, issues=issues)
```

- [ ] **Step 4: Run tests**

Run: `cd backend && .venv/Scripts/python -m pytest tests/test_importer_parsers.py -q -W error`
Expected: all pass.

- [ ] **Step 5: Format, gate, commit**

Run: `cd backend && .venv/Scripts/ruff format app tests && .venv/Scripts/ruff check . && .venv/Scripts/python -m pytest -q -W error`

```bash
git add backend/app/importer/parsers.py backend/tests/test_importer_parsers.py
git commit -m "feat: ReferenceData and Positions parsers"
```

---

### Task 7: Parsers — Net Worth + Spending (TDD)

**Files:**
- Modify: `backend/app/importer/parsers.py` (append)
- Modify: `backend/tests/test_importer_parsers.py` (append)

- [ ] **Step 1: Write the failing tests** (append)

```python
def test_parse_net_worth_accounts_groups_and_balances():
    from app.importer.parsers import parse_net_worth

    parsed = parse_net_worth(_sheet("Net Worth"))
    assert parsed.issues.errors == []
    assert [(a.name, a.group, a.sort_order) for a in parsed.accounts] == [
        ("Checking", "cash", 3),
        ("IRA", "pre_tax", 5),
        ("Credit Card", "liability", 7),
    ]
    assert len(parsed.snapshots) == 2  # r5 future-template row skipped
    first, second = parsed.snapshots
    assert first.month == datetime.date(2024, 1, 1)
    assert first.recorded_on == datetime.date(2024, 1, 5)
    assert first.balances["Checking"] == Decimal("100.50")
    assert first.balances["IRA"] == Decimal("0.00")  # 0.001 sentinel normalized
    assert first.balances["Credit Card"] == Decimal("-25.00")  # liabilities stored negative
    assert second.balances["Credit Card"] == Decimal("-30.00")
    assert any("0.001" in w for w in parsed.issues.warnings)  # aggregate sentinel warning
    assert any("liabilit" in w.lower() for w in parsed.issues.warnings)


def test_parse_net_worth_unknown_band_falls_back_to_other():
    from app.importer.parsers import parse_net_worth

    rows = default_net_worth_rows()
    rows[0][6] = "MYSTERY GROUP"
    parsed = parse_net_worth(_sheet("Net Worth", net_worth=rows))
    assert parsed.accounts[2].group == "other"
    assert any("MYSTERY GROUP" in w for w in parsed.issues.warnings)


def test_parse_net_worth_duplicate_month_is_error():
    from app.importer.parsers import parse_net_worth

    rows = default_net_worth_rows()
    rows.append(rows[3][:])  # repeat 2024-02 row
    parsed = parse_net_worth(_sheet("Net Worth", net_worth=rows))
    assert any("duplicate month" in e.lower() for e in parsed.issues.errors)


def test_parse_spending_months_rollups_and_total_check():
    from app.importer.parsers import parse_spending

    parsed = parse_spending(_sheet("Spending"))
    assert parsed.issues.errors == []
    assert [(c.name, c.sort_order) for c in parsed.categories] == [("Food", 2), ("Rent", 3)]
    assert len(parsed.months) == 2  # Average, 2024.0 rollup and empty template all skipped
    january, february = parsed.months
    assert january.month == datetime.date(2024, 1, 1)
    assert january.amounts == {"Food": Decimal("100.00"), "Rent": Decimal("900.00")}
    assert january.net_pay == Decimal("3000.00")
    # r4 TOTAL says 951 but Food+Rent = 950 -> cross-check warning names the month
    assert any("2024-02" in w and "TOTAL" in w for w in parsed.issues.warnings)
    assert february.net_pay == Decimal("3000.00")


def test_parse_spending_missing_total_column_is_error():
    from app.importer.parsers import parse_spending

    rows = default_spending_rows()
    rows[0][3] = "NOT-TOTAL"
    parsed = parse_spending(_sheet("Spending", spending=rows))
    assert any("TOTAL" in e for e in parsed.issues.errors)
```

Add `default_net_worth_rows, default_spending_rows` to the workbook_builder import line.

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && .venv/Scripts/python -m pytest tests/test_importer_parsers.py -q`
Expected: FAIL — `ImportError: cannot import name 'parse_net_worth'`.

- [ ] **Step 3: Implement** (append to `parsers.py`)

```python
GROUP_BY_BAND = {
    "CASH": "cash",
    "PRE-TAX": "pre_tax",
    "POST-TAX": "post_tax",
    "TAXABLE": "taxable",
    "EQUITY": "equity",
    "OTHER": "other",
    "LIABILITIES": "liability",
}
NET_WORTH_TERMINAL_BAND = "NET WORTH"
NET_WORTH_HEADER_SCAN_COLS = 120


@dataclasses.dataclass
class ParsedAccountColumn:
    name: str
    group: str
    sort_order: int  # sheet column index — stable, sheet-ordered
    column: int


@dataclasses.dataclass
class ParsedSnapshot:
    month: datetime.date
    recorded_on: datetime.date | None
    balances: dict[str, Decimal]  # account name -> signed balance


@dataclasses.dataclass
class ParsedNetWorth:
    accounts: list[ParsedAccountColumn]
    snapshots: list[ParsedSnapshot]
    issues: CellIssues


def parse_net_worth(ws) -> ParsedNetWorth:
    issues = CellIssues()
    header = list(
        ws.iter_rows(min_row=1, max_row=2, max_col=NET_WORTH_HEADER_SCAN_COLS, values_only=True)
    )
    bands, names = header[0], header[1]
    accounts: list[ParsedAccountColumn] = []
    current_band: str | None = None
    for index, band_cell in enumerate(bands):
        column = index + 1
        band_text = _text(band_cell)
        if band_text is not None and column >= 3:
            current_band = band_text
        if current_band == NET_WORTH_TERMINAL_BAND:
            break  # computed totals begin — no more account columns
        name = _text(names[index]) if index < len(names) else None
        if column < 3 or name is None or name == "%":
            continue
        group = GROUP_BY_BAND.get(current_band or "")
        if group is None:
            issues.warn(
                f"{cell_ref('Net Worth', 1, column)}: unknown group band "
                f"{current_band!r} for account {name!r} — falling back to 'other'"
            )
            group = "other"
        if any(a.name == name for a in accounts):
            issues.error(f"{cell_ref('Net Worth', 2, column)}: duplicate account {name!r}")
            continue
        accounts.append(
            ParsedAccountColumn(name=name, group=group, sort_order=column, column=column)
        )

    snapshots: list[ParsedSnapshot] = []
    seen_months: set[datetime.date] = set()
    sentinel_count = 0
    negated_liabilities = False
    max_col = max((a.column for a in accounts), default=2)
    for rnum, row in _iter_rows(ws, min_row=3, max_col=max_col):
        if row[0] is None:
            break  # months run out — template region ends the sheet
        month = to_date_strict(row[0], ctx=cell_ref("Net Worth", rnum, 1), issues=issues)
        if month is None:
            continue
        month = first_of_month(month, ctx=cell_ref("Net Worth", rnum, 1), issues=issues)
        raw_cells = {account: row[account.column - 1] for account in accounts}
        if all(value is None for value in raw_cells.values()):
            continue  # future template row (Month/Date filled, balances empty)
        if month in seen_months:
            issues.error(f"{cell_ref('Net Worth', rnum, 1)}: duplicate month {month.isoformat()}")
            continue
        seen_months.add(month)
        recorded_on = to_date_strict(row[1], ctx=cell_ref("Net Worth", rnum, 2), issues=issues)
        balances: dict[str, Decimal] = {}
        for account, raw in raw_cells.items():
            if raw is None:
                continue  # sparse cell: no balance recorded for this account/month
            if is_placeholder_balance(raw):
                sentinel_count += 1
                value = Decimal("0.00")
            else:
                value = to_decimal(
                    raw, Q2, 12, ctx=cell_ref("Net Worth", rnum, account.column), issues=issues
                )
                if value is None:
                    continue
            if account.group == "liability" and value != 0:
                value = -value  # sheet stores debt positive; schema stores it signed
                negated_liabilities = True
            balances[account.name] = value
        snapshots.append(ParsedSnapshot(month=month, recorded_on=recorded_on, balances=balances))
    if sentinel_count:
        issues.warn(
            f"Net Worth: normalized {sentinel_count} placeholder 0.001 balance(s) to 0.00"
        )
    if negated_liabilities:
        issues.warn(
            "Net Worth: liability balances negated on import "
            "(sheet stores debt positive; schema stores signed balances)"
        )
    return ParsedNetWorth(accounts=accounts, snapshots=snapshots, issues=issues)


@dataclasses.dataclass
class ParsedCategoryColumn:
    name: str
    sort_order: int  # sheet column index
    column: int


@dataclasses.dataclass
class ParsedSpendingMonth:
    month: datetime.date
    amounts: dict[str, Decimal]  # category name -> amount (explicit sheet zeros kept)
    net_pay: Decimal | None


@dataclasses.dataclass
class ParsedSpending:
    categories: list[ParsedCategoryColumn]
    months: list[ParsedSpendingMonth]
    issues: CellIssues


def parse_spending(ws) -> ParsedSpending:
    issues = CellIssues()
    header = next(iter(ws.iter_rows(min_row=1, max_row=1, max_col=40, values_only=True)))
    categories: list[ParsedCategoryColumn] = []
    total_column: int | None = None
    net_pay_column: int | None = None
    for index, cell in enumerate(header):
        column = index + 1
        text = _text(cell)
        if column < 2 or text is None:
            continue
        if text == "TOTAL":
            total_column = column
            continue
        if text == "Net Pay":
            net_pay_column = column
            continue
        if total_column is None:  # category columns all precede TOTAL
            categories.append(ParsedCategoryColumn(name=text, sort_order=column, column=column))
    if total_column is None or net_pay_column is None:
        issues.error("Spending!r1: TOTAL and Net Pay header columns are required")
        return ParsedSpending(categories=categories, months=[], issues=issues)

    months: list[ParsedSpendingMonth] = []
    seen_months: set[datetime.date] = set()
    for rnum, row in _iter_rows(ws, min_row=2, max_col=net_pay_column):
        first = row[0]
        if first is None:
            break
        if isinstance(first, str):
            continue  # 'Average' summary row
        if not isinstance(first, datetime.date):  # covers datetime too (subclass)
            continue  # numeric-year rollup row
        month = first_of_month(
            to_date_strict(first, ctx=cell_ref("Spending", rnum, 1), issues=issues),
            ctx=cell_ref("Spending", rnum, 1),
            issues=issues,
        )
        raw_amounts = {category: row[category.column - 1] for category in categories}
        raw_net_pay = row[net_pay_column - 1]
        if all(value is None for value in raw_amounts.values()) and raw_net_pay is None:
            continue  # future template month
        if month in seen_months:
            issues.error(f"{cell_ref('Spending', rnum, 1)}: duplicate month {month.isoformat()}")
            continue
        seen_months.add(month)
        amounts: dict[str, Decimal] = {}
        for category, raw in raw_amounts.items():
            if raw is None:
                continue
            value = to_decimal(
                raw, Q2, 10, ctx=cell_ref("Spending", rnum, category.column), issues=issues
            )
            if value is not None:
                amounts[category.name] = value
        net_pay = to_decimal(
            raw_net_pay, Q2, 10, ctx=cell_ref("Spending", rnum, net_pay_column), issues=issues
        )
        total = to_decimal(
            row[total_column - 1], Q2, 10, ctx=cell_ref("Spending", rnum, total_column),
            issues=issues,
        )
        if total is not None and amounts and abs(sum(amounts.values()) - total) >= Decimal("0.01"):
            issues.warn(
                f"Spending {month.isoformat()[:7]}: category sum {sum(amounts.values())} "
                f"!= sheet TOTAL {total} (imported category values anyway)"
            )
        months.append(ParsedSpendingMonth(month=month, amounts=amounts, net_pay=net_pay))
    return ParsedSpending(categories=categories, months=months, issues=issues)
```

Type-check note: `isinstance(first, datetime.date)` is True for `datetime.datetime` (subclass) — the numeric-rollup guard relies on floats NOT being dates, which holds.

- [ ] **Step 4: Run tests**

Run: `cd backend && .venv/Scripts/python -m pytest tests/test_importer_parsers.py -q -W error`
Expected: all pass.

- [ ] **Step 5: Format, gate, commit**

Run: `cd backend && .venv/Scripts/ruff format app tests && .venv/Scripts/ruff check . && .venv/Scripts/python -m pytest -q -W error`

```bash
git add backend/app/importer/parsers.py backend/tests/test_importer_parsers.py
git commit -m "feat: Net Worth and Spending parsers"
```

---

### Task 8: Parser — Taxes (TDD)

The trickiest sheet: years as columns, three input sections walked against the exact 41-label sequence (drift detector), six bracket sections, two state special rows mapped to the Task 2 keys, computed sections terminating the parse.

**Files:**
- Modify: `backend/app/importer/parsers.py` (append)
- Modify: `backend/tests/test_importer_parsers.py` (append)

- [ ] **Step 1: Write the failing tests** (append)

```python
def test_parse_taxes_inputs_brackets_and_active_years():
    from app.importer.parsers import parse_taxes

    parsed = parse_taxes(_sheet("Taxes"))
    assert parsed.issues.errors == []
    years = {i.year for i in parsed.inputs}
    assert years == {2023, 2024}  # the empty 2025 column is skipped silently
    by_key = {(i.year, i.key): i.value for i in parsed.inputs}
    assert by_key[(2023, "annual_salary")] == Decimal("100.0000")
    assert by_key[(2023, "unq_div_state_exempt_pct")] == Decimal("0.9645")  # 4dp survives
    assert by_key[(2024, "unq_div_state_exempt_pct")] == Decimal("0.9753")
    # State special rows land as inputs; the federal Standard/Itemized row is derived -> absent
    assert by_key[(2023, "state_standard_deduction")] == Decimal("5363.0000")
    assert by_key[(2023, "state_exemption_credits")] == Decimal("144.0000")
    assert len({i.key for i in parsed.inputs}) == 43
    brackets = [(b.year, b.jurisdiction, b.bracket_index) for b in parsed.brackets]
    assert (2023, "federal", 1) in brackets and (2023, "federal", 2) in brackets
    assert (2024, "capital_gains", 1) in brackets
    federal_1 = next(
        b for b in parsed.brackets
        if (b.year, b.jurisdiction, b.bracket_index) == (2023, "federal", 1)
    )
    assert federal_1.rate == Decimal("0.1000")
    assert federal_1.threshold == Decimal("0.00")
    per_year = sum(1 for b in parsed.brackets if b.year == 2023)
    assert per_year == 7  # fixture: fed 2 + state 1 + medicare 1 + ss 1 + sdi 1 + cg 1


def test_parse_taxes_label_drift_is_fatal_error():
    from app.importer.parsers import parse_taxes

    rows = default_taxes_rows()
    rows[3][1] = "Pay Cadence"  # was 'Pay Periods'
    parsed = parse_taxes(_sheet("Taxes", taxes=rows))
    assert any("Pay Periods" in e and "Pay Cadence" in e for e in parsed.issues.errors)
    assert parsed.inputs == [] and parsed.brackets == []  # aborted: layout no longer trusted


def test_parse_taxes_warns_on_rate_above_one():
    from app.importer.parsers import parse_taxes

    rows = default_taxes_rows()
    for row in rows:
        if row[0] == "MEDICARE TAX INFO":
            row[2] = 1.45  # a percent entered as 1.45 instead of 0.0145
    parsed = parse_taxes(_sheet("Taxes", taxes=rows))
    assert any("looks like a percentage" in w for w in parsed.issues.warnings)
```

Add `default_taxes_rows` to the workbook_builder import line.

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && .venv/Scripts/python -m pytest tests/test_importer_parsers.py -q`
Expected: FAIL — `ImportError: cannot import name 'parse_taxes'`.

- [ ] **Step 3: Implement** (append to `parsers.py`)

```python
import re  # noqa: E402  — move to the top import block when transcribing

BRACKET_SECTIONS = {
    "FEDERAL INCOME TAX INFO": "federal",
    "STATE INCOME TAX INFO": "state",
    "MEDICARE TAX INFO": "medicare",
    "SOCIAL SECURITY TAX INFO": "social_security",
    "DISABILITY TAX INFO": "disability",
    "CAPITAL GAINS TAX INFO": "capital_gains",
}
STATE_SPECIAL_INPUTS = {
    "Standard/Itemized Deductions": "state_standard_deduction",
    "Exemption Credits": "state_exemption_credits",
}
FEDERAL_DERIVED_ROW = "Standard/Itemized Deductions"  # computed max(std, itemized) — skipped
BRACKET_ROW_RE = re.compile(r"^Bracket (\d+) (Rate|Threshold)$")


@dataclasses.dataclass
class ParsedTaxInput:
    year: int
    key: str
    value: Decimal


@dataclasses.dataclass
class ParsedBracket:
    year: int
    jurisdiction: str
    bracket_index: int
    rate: Decimal
    threshold: Decimal


@dataclasses.dataclass
class ParsedTaxes:
    inputs: list[ParsedTaxInput]
    brackets: list[ParsedBracket]
    issues: CellIssues


def parse_taxes(ws) -> ParsedTaxes:  # noqa: PLR0912, PLR0915 — one sheet, one walker
    issues = CellIssues()
    rows = list(ws.iter_rows(min_row=1, max_row=300, max_col=20, values_only=True))

    year_columns: list[tuple[int, int]] = []  # (0-based index, year)
    for index, cell in enumerate(rows[0]):
        if index >= 2 and isinstance(cell, int | float) and not isinstance(cell, bool):
            year_columns.append((index, int(cell)))

    def collect(row_values, rnum: int, quantum, max_int_digits: int) -> dict[int, Decimal]:
        values: dict[int, Decimal] = {}
        for col_index, year in year_columns:
            cell = row_values[col_index] if col_index < len(row_values) else None
            value = to_decimal(
                cell, quantum, max_int_digits,
                ctx=cell_ref("Taxes", rnum, col_index + 1), issues=issues,
            )
            if value is not None:
                values[year] = value
        return values

    inputs: list[ParsedTaxInput] = []
    cursor = 1  # 0-based index into rows; row 2 of the sheet
    for section_header, sequence in SHEET_TAX_INPUT_SEQUENCE:
        for position, (label, key) in enumerate(sequence):
            if cursor >= len(rows):
                issues.error(f"Taxes: sheet ended before label {label!r}")
                return ParsedTaxes(inputs=[], brackets=[], issues=issues)
            row = rows[cursor]
            found_label = _text(row[1])
            if position == 0 and _text(row[0]) != section_header:
                issues.error(
                    f"{cell_ref('Taxes', cursor + 1, 1)}: expected section "
                    f"{section_header!r}, found {_text(row[0])!r} — sheet layout changed; "
                    "aborting Taxes parse"
                )
                return ParsedTaxes(inputs=[], brackets=[], issues=issues)
            if found_label != label:
                issues.error(
                    f"{cell_ref('Taxes', cursor + 1, 2)}: expected label {label!r}, "
                    f"found {found_label!r} — sheet layout changed; aborting Taxes parse"
                )
                return ParsedTaxes(inputs=[], brackets=[], issues=issues)
            for year, value in collect(row, cursor + 1, Q4, 10).items():
                inputs.append(ParsedTaxInput(year=year, key=key, value=value))
            cursor += 1

    brackets: list[ParsedBracket] = []
    pending: dict[tuple[str, int], dict[str, tuple[dict[int, Decimal], int]]] = {}
    jurisdiction: str | None = None
    while cursor < len(rows):
        row = rows[cursor]
        header = _text(row[0])
        label = _text(row[1])
        if header is not None:
            if header not in BRACKET_SECTIONS:
                break  # computed output sections begin (FEDERAL INCOME TAX, ...)
            jurisdiction = BRACKET_SECTIONS[header]
        if jurisdiction is None or label is None:
            cursor += 1
            continue
        if jurisdiction == "federal" and label == FEDERAL_DERIVED_ROW:
            cursor += 1
            continue
        if jurisdiction == "state" and label in STATE_SPECIAL_INPUTS:
            for year, value in collect(row, cursor + 1, Q4, 10).items():
                inputs.append(
                    ParsedTaxInput(year=year, key=STATE_SPECIAL_INPUTS[label], value=value)
                )
            cursor += 1
            continue
        match = BRACKET_ROW_RE.match(label)
        if match is None:
            issues.error(
                f"{cell_ref('Taxes', cursor + 1, 2)}: unexpected row {label!r} in "
                f"{jurisdiction} bracket section"
            )
            cursor += 1
            continue
        bracket_index = int(match.group(1))
        kind = match.group(2)
        if kind == "Rate":
            values = collect(row, cursor + 1, Q4, 3)
            for year, rate in values.items():
                if rate > 1:
                    issues.warn(
                        f"{cell_ref('Taxes', cursor + 1, 1)}: {jurisdiction} bracket "
                        f"{bracket_index} rate {rate} looks like a percentage, not a fraction"
                    )
        else:
            values = collect(row, cursor + 1, Q2, 10)
        slot = pending.setdefault((jurisdiction, bracket_index), {})
        slot[kind] = (values, cursor + 1)
        cursor += 1

    for (jur, index), parts in pending.items():
        rates, rate_row = parts.get("Rate", ({}, 0))
        thresholds, threshold_row = parts.get("Threshold", ({}, 0))
        for year in sorted(set(rates) | set(thresholds)):
            if year in rates and year in thresholds:
                brackets.append(
                    ParsedBracket(
                        year=year, jurisdiction=jur, bracket_index=index,
                        rate=rates[year], threshold=thresholds[year],
                    )
                )
            else:
                missing = "Threshold" if year in rates else "Rate"
                present_row = rate_row if year in rates else threshold_row
                issues.error(
                    f"Taxes!r{present_row}: {jur} bracket {index} year {year} "
                    f"is missing its {missing} value"
                )
    return ParsedTaxes(inputs=inputs, brackets=brackets, issues=issues)
```

Transcription notes: move `import re` into the module's top import block (the inline form above only marks where it becomes needed); drop the `noqa` comments if ruff does not flag (PLR rules are not in the selected set — they will not fire; remove both noqa comments).

- [ ] **Step 4: Run tests**

Run: `cd backend && .venv/Scripts/python -m pytest tests/test_importer_parsers.py -q -W error`
Expected: all pass.

- [ ] **Step 5: Format, gate, commit**

Run: `cd backend && .venv/Scripts/ruff format app tests && .venv/Scripts/ruff check . && .venv/Scripts/python -m pytest -q -W error`

```bash
git add backend/app/importer/parsers.py backend/tests/test_importer_parsers.py
git commit -m "feat: Taxes parser with label-sequence drift detection"
```

---

### Task 9: Parsers — ESPP + Paycheck + Focal History + Portfolio (TDD)

**Files:**
- Modify: `backend/app/importer/parsers.py` (append)
- Modify: `backend/tests/test_importer_parsers.py` (append)

- [ ] **Step 1: Write the failing tests** (append)

```python
def test_parse_espp_lots_periods_and_ignored_calculator():
    from app.importer.parsers import parse_espp

    parsed = parse_espp(_sheet("ESPP"))
    assert parsed.issues.errors == []
    assert [(lot.purchase_date, lot.shares) for lot in parsed.lots] == [
        (datetime.date(2024, 2, 29), Decimal("100.0000")),
        (datetime.date(2024, 8, 30), Decimal("90.0000")),
    ]
    lot = parsed.lots[0]
    assert lot.qualifying_date == datetime.date(2025, 9, 1)
    assert lot.subscription_price == Decimal("40.00000")
    assert lot.purchase_fmv == Decimal("50.00000")
    assert lot.purchase_price == Decimal("34.00000")
    assert lot.sold_date is None and lot.sold_price is None
    feb, aug = parsed.periods
    assert feb.label == "February 2025 Purchase"
    assert feb.period_start == datetime.date(2024, 9, 1)
    assert feb.period_end == datetime.date(2025, 2, 27)
    assert feb.semi_annual_base == Decimal("50000.00")
    assert feb.additional_payments == Decimal("0.00")
    assert feb.contribution_pct == Decimal("0.100000000")
    assert aug.label == "August 2025 Purchase"
    assert aug.period_start == datetime.date(2025, 3, 1)
    assert aug.period_end == datetime.date(2025, 8, 29)
    assert aug.additional_payments == Decimal("100.00")
    assert any("derived" in w.lower() for w in parsed.issues.warnings)
    assert any("taxation calculator" in w.lower() for w in parsed.issues.warnings)


def test_parse_espp_missing_template_dates_skips_periods():
    from app.importer.parsers import parse_espp

    rows = default_espp_rows()
    for row in rows:
        if len(row) > 8 and isinstance(row[8], datetime.datetime) and row[8].year >= 2025:
            row[8] = None  # remove the future template dates
    parsed = parse_espp(_sheet("ESPP", espp=rows))
    assert parsed.periods == []
    assert any("period" in w.lower() for w in parsed.issues.warnings)
    assert len(parsed.lots) == 2  # lots unaffected


def test_parse_paycheck_fields_and_quantization():
    from app.importer.parsers import parse_paycheck

    parsed = parse_paycheck(_sheet("Paycheck Modeler"))
    assert parsed.issues.errors == []
    profile = parsed.profile
    assert profile is not None
    assert profile.annual_salary == Decimal("120000.00")
    assert profile.trad_401k_pct == Decimal("0.100000000")
    assert profile.roth_401k_pct == Decimal("0.000000000")
    assert profile.after_tax_401k_pct == Decimal("0.020000000")
    assert profile.withholding_pct == Decimal("0.250000000")  # 15dp cell -> 9dp HALF_UP
    assert profile.espp_pct == Decimal("0.050000000")
    assert profile.dental_vision_per_check == Decimal("10.00")
    assert profile.hsa_per_check == Decimal("50.00")
    assert not any("Gross Paycheck" in w for w in parsed.issues.warnings)  # 120000/24 == 5000


def test_parse_paycheck_gross_mismatch_warns_and_missing_salary_skips():
    from app.importer.parsers import parse_paycheck

    rows = default_paycheck_rows()
    rows[3][2] = 4321.0  # Gross Paycheck != salary/24
    parsed = parse_paycheck(_sheet("Paycheck Modeler", paycheck=rows))
    assert any("Gross Paycheck" in w for w in parsed.issues.warnings)

    rows = default_paycheck_rows()
    rows[2][1] = "Yearly Salary"  # label drift: Annual Salary not found
    parsed = parse_paycheck(_sheet("Paycheck Modeler", paycheck=rows))
    assert parsed.profile is None
    assert any("Annual Salary" in w for w in parsed.issues.warnings)


def test_parse_focal_full_partial_and_template_rows():
    from app.importer.parsers import parse_focal_history

    parsed = parse_focal_history(_sheet("Focal History"))
    assert parsed.issues.errors == []
    assert [(e.focal_year, e.current_base, e.new_base) for e in parsed.events] == [
        (2024, Decimal("110000.00"), Decimal("120000.00")),
        (2025, Decimal("120000.00"), None),  # partial row imported as-is
    ]
    full = parsed.events[0]
    assert full.unvested_rsus == Decimal("500.0000")
    assert full.unvested_price == Decimal("89.6600")
    assert full.refresh_rsus == Decimal("100.0000")
    assert full.grant_price == Decimal("90.0000")


def test_parse_portfolio_warns_on_nonzero_dividends_only():
    from app.importer.parsers import parse_portfolio

    parsed = parse_portfolio(_sheet("Portfolio"))
    assert parsed.issues.errors == []
    dividend_warnings = [w for w in parsed.issues.warnings if "dividend" in w.lower()]
    assert len(dividend_warnings) == 1
    assert "DIVC" in dividend_warnings[0] and "12.5" in dividend_warnings[0]
```

Add `default_espp_rows, default_paycheck_rows` to the workbook_builder import line.

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && .venv/Scripts/python -m pytest tests/test_importer_parsers.py -q`
Expected: FAIL — `ImportError: cannot import name 'parse_espp'`.

- [ ] **Step 3: Implement** (append to `parsers.py`)

```python
@dataclasses.dataclass
class ParsedEsppLot:
    purchase_date: datetime.date
    qualifying_date: datetime.date
    shares: Decimal
    subscription_price: Decimal
    purchase_fmv: Decimal
    purchase_price: Decimal
    sold_date: datetime.date | None = None
    sold_price: Decimal | None = None


@dataclasses.dataclass
class ParsedEsppPeriod:
    label: str
    period_start: datetime.date
    period_end: datetime.date
    semi_annual_base: Decimal
    additional_payments: Decimal
    contribution_pct: Decimal


@dataclasses.dataclass
class ParsedEspp:
    lots: list[ParsedEsppLot]
    periods: list[ParsedEsppPeriod]
    issues: CellIssues


ESPP_MODELER_LABELS = {
    "Semi-Annual Base Salary": "base",
    "Additional payments (i.e. bonuses)": "additional",
    "ESPP Contribution Percentage": "pct",
}


def parse_espp(ws) -> ParsedEspp:
    issues = CellIssues()
    rows = list(ws.iter_rows(min_row=1, max_row=80, max_col=14, values_only=True))

    lots: list[ParsedEsppLot] = []
    template_dates: list[datetime.date] = []
    seen_purchases: set[datetime.date] = set()
    for index, row in enumerate(rows[2:], start=3):  # lots table data starts sheet r3
        purchase_raw = row[8] if len(row) > 8 else None
        if purchase_raw is None:
            continue  # modeler-only row (columns B-E) or gap
        purchase = to_date_strict(purchase_raw, ctx=cell_ref("ESPP", index, 9), issues=issues)
        if purchase is None:
            continue
        shares_raw = row[10] if len(row) > 10 else None
        if shares_raw is None:
            template_dates.append(purchase)  # future purchase-date template row
            continue
        if purchase in seen_purchases:
            issues.error(f"{cell_ref('ESPP', index, 9)}: duplicate lot {purchase.isoformat()}")
            continue
        qualifying = to_date_strict(row[9], ctx=cell_ref("ESPP", index, 10), issues=issues)
        shares = to_decimal(shares_raw, Q4, 8, ctx=cell_ref("ESPP", index, 11), issues=issues)
        subscription = to_decimal(row[11], Q5, 9, ctx=cell_ref("ESPP", index, 12), issues=issues)
        fmv = to_decimal(row[12], Q5, 9, ctx=cell_ref("ESPP", index, 13), issues=issues)
        price = to_decimal(row[13], Q5, 9, ctx=cell_ref("ESPP", index, 14), issues=issues)
        if None in (qualifying, shares, subscription, fmv, price):
            issues.error(
                f"{cell_ref('ESPP', index, 9)}: lot {purchase.isoformat()} is missing "
                "qualifying date, shares or one of its prices"
            )
            continue
        seen_purchases.add(purchase)
        lots.append(
            ParsedEsppLot(
                purchase_date=purchase, qualifying_date=qualifying, shares=shares,
                subscription_price=subscription, purchase_fmv=fmv, purchase_price=price,
            )
        )

    modeler: dict[str, tuple[Decimal | None, Decimal | None]] = {}
    calculator_present = False
    for index, row in enumerate(rows, start=1):
        label = _text(row[1] if len(row) > 1 else None)
        if label is None:
            continue
        if label == "ESPP Taxation Calculator":
            calculator_present = True
        field = ESPP_MODELER_LABELS.get(label)
        if field is not None:
            quantum, digits = (Q9, 1) if field == "pct" else (Q2, 10)
            feb = to_decimal(
                row[2], quantum, digits, ctx=cell_ref("ESPP", index, 3), issues=issues
            )
            aug = to_decimal(
                row[3], quantum, digits, ctx=cell_ref("ESPP", index, 4), issues=issues
            )
            modeler[field] = (feb, aug)

    periods: list[ParsedEsppPeriod] = []
    next_feb = min((d for d in template_dates if d.month == 2), default=None)
    next_aug = min((d for d in template_dates if d.month == 8), default=None)
    have_values = all(field in modeler for field in ("base", "pct"))
    if next_feb and next_aug and have_values:
        additional = modeler.get("additional", (None, None))
        for column, (label, start, end) in enumerate(
            [
                (
                    f"February {next_feb.year} Purchase",
                    datetime.date(next_feb.year - 1, 9, 1),
                    next_feb,
                ),
                (f"August {next_aug.year} Purchase", datetime.date(next_aug.year, 3, 1), next_aug),
            ]
        ):
            base = modeler["base"][column]
            pct = modeler["pct"][column]
            if base is None or pct is None:
                issues.warn(f"ESPP: modeler column for {label!r} incomplete — period skipped")
                continue
            periods.append(
                ParsedEsppPeriod(
                    label=label, period_start=start, period_end=end, semi_annual_base=base,
                    additional_payments=additional[column] or Decimal("0.00"),
                    contribution_pct=pct,
                )
            )
        if periods:
            issues.warn(
                "ESPP: period labels and start/end dates derived from the purchase-date "
                "template (the sheet stores none) — edit in the UI once Plan 5 lands"
            )
    else:
        issues.warn(
            "ESPP: modeler values or future purchase-date template rows missing — "
            "espp_periods not imported"
        )
    if calculator_present:
        issues.warn(
            "ESPP: 'ESPP Taxation Calculator' block ignored — it is a hypothetical what-if "
            "(Positions still holds all lot shares; every Taxes ESPP Sale Component is 0), "
            "so no sold_date/sold_price are imported"
        )
    return ParsedEspp(lots=lots, periods=periods, issues=issues)


@dataclasses.dataclass
class ParsedPaycheckProfile:
    annual_salary: Decimal
    trad_401k_pct: Decimal
    roth_401k_pct: Decimal
    after_tax_401k_pct: Decimal
    espp_pct: Decimal
    withholding_pct: Decimal
    dental_vision_per_check: Decimal
    hsa_per_check: Decimal


@dataclasses.dataclass
class ParsedPaycheck:
    profile: ParsedPaycheckProfile | None
    issues: CellIssues


PAYCHECK_AMOUNT_LABELS = {"Annual Salary", "Gross Paycheck", "Dental & Vision", "HSA"}
PAYCHECK_PCT_LABELS = {
    "Traditional 401(k) %": "trad_401k_pct",
    "Roth 401(k) %": "roth_401k_pct",
    "AT 401(k) %": "after_tax_401k_pct",
    "Tax Withholding %": "withholding_pct",
    "ESPP %": "espp_pct",
}
SEMI_MONTHLY_PERIODS = 24


def parse_paycheck(ws) -> ParsedPaycheck:
    issues = CellIssues()
    amounts: dict[str, Decimal] = {}
    percentages: dict[str, Decimal] = {}
    for rnum, row in _iter_rows(ws, min_row=2, max_col=6, max_row=40):
        left_label = _text(row[1])
        if left_label in PAYCHECK_AMOUNT_LABELS:
            digits = 10 if left_label in ("Annual Salary", "Gross Paycheck") else 6
            value = to_decimal(
                row[2], Q2, digits, ctx=cell_ref("Paycheck Modeler", rnum, 3), issues=issues
            )
            if value is not None:
                amounts[left_label] = value
        right_label = _text(row[4])
        if right_label in PAYCHECK_PCT_LABELS:
            value = to_decimal(
                row[5], Q9, 1, ctx=cell_ref("Paycheck Modeler", rnum, 6), issues=issues
            )
            if value is not None:
                percentages[PAYCHECK_PCT_LABELS[right_label]] = value

    salary = amounts.get("Annual Salary")
    if salary is None:
        issues.warn("Paycheck Modeler: 'Annual Salary' not found — profile not imported")
        return ParsedPaycheck(profile=None, issues=issues)
    gross = amounts.get("Gross Paycheck")
    if gross is not None and abs(salary / SEMI_MONTHLY_PERIODS - gross) >= Decimal("0.01"):
        issues.warn(
            f"Paycheck Modeler: Gross Paycheck {gross} != Annual Salary / 24 "
            f"({salary / SEMI_MONTHLY_PERIODS:.2f}) — check pay_periods_per_year after import"
        )
    missing = [k for k in PAYCHECK_PCT_LABELS.values() if k not in percentages]
    for key in missing:
        issues.warn(f"Paycheck Modeler: {key} not found — defaulting to 0")
    zero_pct = Decimal("0.000000000")
    return ParsedPaycheck(
        profile=ParsedPaycheckProfile(
            annual_salary=salary,
            trad_401k_pct=percentages.get("trad_401k_pct", zero_pct),
            roth_401k_pct=percentages.get("roth_401k_pct", zero_pct),
            after_tax_401k_pct=percentages.get("after_tax_401k_pct", zero_pct),
            espp_pct=percentages.get("espp_pct", zero_pct),
            withholding_pct=percentages.get("withholding_pct", zero_pct),
            dental_vision_per_check=amounts.get("Dental & Vision", Decimal("0.00")),
            hsa_per_check=amounts.get("HSA", Decimal("0.00")),
        ),
        issues=issues,
    )


@dataclasses.dataclass
class ParsedCompEvent:
    focal_year: int
    current_base: Decimal
    new_base: Decimal | None
    unvested_rsus: Decimal | None
    unvested_price: Decimal | None
    refresh_rsus: Decimal | None
    grant_price: Decimal | None


@dataclasses.dataclass
class ParsedFocalHistory:
    events: list[ParsedCompEvent]
    issues: CellIssues


def parse_focal_history(ws) -> ParsedFocalHistory:
    issues = CellIssues()
    events: list[ParsedCompEvent] = []
    seen_years: set[int] = set()
    for rnum, row in _iter_rows(ws, min_row=3, max_col=11, max_row=200):
        year_raw = row[1]
        if year_raw is None:
            break
        if isinstance(year_raw, bool) or not isinstance(year_raw, int | float):
            issues.error(f"{cell_ref('Focal History', rnum, 2)}: expected a year")
            continue
        year = int(year_raw)
        current_base = to_decimal(
            row[2], Q2, 10, ctx=cell_ref("Focal History", rnum, 3), issues=issues
        )
        if current_base is None:
            continue  # year-only template row
        if year in seen_years:
            issues.error(f"{cell_ref('Focal History', rnum, 2)}: duplicate focal year {year}")
            continue
        seen_years.add(year)
        ref = cell_ref("Focal History", rnum, 2)
        events.append(
            ParsedCompEvent(
                focal_year=year,
                current_base=current_base,
                new_base=to_decimal(row[3], Q2, 10, ctx=ref, issues=issues),
                unvested_rsus=to_decimal(row[6], Q4, 8, ctx=ref, issues=issues),
                unvested_price=to_decimal(row[7], Q4, 10, ctx=ref, issues=issues),
                refresh_rsus=to_decimal(row[9], Q4, 8, ctx=ref, issues=issues),
                grant_price=to_decimal(row[10], Q4, 10, ctx=ref, issues=issues),
            )
        )
    return ParsedFocalHistory(events=events, issues=issues)


@dataclasses.dataclass
class ParsedPortfolio:
    issues: CellIssues


def parse_portfolio(ws) -> ParsedPortfolio:
    """Warn-only: the sheet's Dividends Collected are all 0 today; nonzero values cannot be
    imported faithfully (no payment dates for dividend_payments.pay_date) — sanctioned
    deviation from spec section 5, recorded in the plan's forward notes."""
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
        dividends = to_decimal(
            row[15], Q2, 10, ctx=cell_ref("Portfolio", rnum, 16), issues=issues
        )
        if dividends and dividends > 0:
            issues.warn(
                f"Portfolio: {ticker} has Dividends Collected {dividends} — NOT imported "
                "(sheet has no payment dates); enter via the UI in Plan 4"
            )
    return ParsedPortfolio(issues=issues)
```

- [ ] **Step 4: Run tests**

Run: `cd backend && .venv/Scripts/python -m pytest tests/test_importer_parsers.py -q -W error`
Expected: all pass.

- [ ] **Step 5: Format, gate, commit**

Run: `cd backend && .venv/Scripts/ruff format app tests && .venv/Scripts/ruff check . && .venv/Scripts/python -m pytest -q -W error`

```bash
git add backend/app/importer/parsers.py backend/tests/test_importer_parsers.py
git commit -m "feat: ESPP, Paycheck, Focal History and Portfolio parsers"
```

---

### Task 10: Apply layer part 1 — securities/prices, positions, net worth, spending (TDD)

Load-compare-write appliers. Shared rules: preload existing rows once per entity; `_diff_update` mutates changed fields and records a sample; user-owned fields are NEVER touched on update (`is_active`, `is_manual_priced`, `notes`, `sold_date`/`sold_price`, `pay_periods_per_year`); Decimal equality works because parsers quantize to the exact column scale the DB returns.

**Files:**
- Create: `backend/app/importer/apply.py`
- Test: `backend/tests/test_importer_apply.py`

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_importer_apply.py`:

```python
from datetime import date
from decimal import Decimal

from sqlalchemy import select

from app.importer.apply import (
    apply_net_worth,
    apply_positions,
    apply_reference_data,
    apply_spending,
)
from app.importer.parsers import (
    parse_net_worth,
    parse_positions,
    parse_reference_data,
    parse_spending,
)
from app.importer.report import SheetReport
from app.models import (
    Account,
    AccountBalance,
    LatestPrice,
    MonthlyCashflow,
    MonthlySpending,
    NetWorthSnapshot,
    PositionTransaction,
    Security,
    SpendingCategory,
)
from tests.workbook_builder import build_workbook, load_readonly


def sheets(**overrides):
    return load_readonly(build_workbook(**overrides))


async def test_apply_reference_data_creates_then_skips(db):
    wb = sheets()
    parsed = parse_reference_data(wb["ReferenceData"])
    report = SheetReport()
    by_name = await apply_reference_data(db, parsed, report)
    await db.commit()
    assert report.entities["securities"].creates == 3
    assert report.entities["latest_prices"].creates == 2  # DIVC '#N/A' price skipped
    assert set(by_name) == {"Acme ETF", "Div Corp", "Mut Fund"}
    acme = (await db.execute(select(Security).where(Security.ticker == "ACME"))).scalar_one()
    assert acme.holding_type == "etf" and acme.is_manual_priced is False
    price = await db.get(LatestPrice, acme.id)
    assert price.price == Decimal("100.5000") and price.source == "manual"
    assert price.quoted_at is not None

    report2 = SheetReport()
    await apply_reference_data(db, parse_reference_data(sheets()["ReferenceData"]), report2)
    await db.commit()
    assert report2.entities["securities"].creates == 0
    assert report2.entities["securities"].skips == 3
    assert report2.entities["latest_prices"].skips == 2  # insert-only: never updated


async def test_apply_reference_data_updates_changed_metadata_only(db):
    report = SheetReport()
    await apply_reference_data(db, parse_reference_data(sheets()["ReferenceData"]), report)
    await db.commit()
    # User flags survive re-import; metadata updates flow through
    acme = (await db.execute(select(Security).where(Security.ticker == "ACME"))).scalar_one()
    acme.is_active = False
    await db.commit()
    from tests.workbook_builder import default_reference_data_rows

    rows = default_reference_data_rows()
    rows[1][2] = "Large Blend"  # sector change
    report2 = SheetReport()
    await apply_reference_data(
        db, parse_reference_data(sheets(reference_data=rows)["ReferenceData"]), report2
    )
    await db.commit()
    assert report2.entities["securities"].updates == 1
    refreshed = (await db.execute(select(Security).where(Security.ticker == "ACME"))).scalar_one()
    assert refreshed.industry == "Large Blend"
    assert refreshed.is_active is False  # untouched


async def test_apply_positions_full_flow(db):
    wb = sheets()
    report = SheetReport()
    by_name = await apply_reference_data(db, parse_reference_data(wb["ReferenceData"]), report)
    parsed = parse_positions(wb["Positions"])
    await apply_positions(db, parsed, by_name, report)
    await db.commit()
    assert report.entities["position_transactions"].creates == 3
    # Unknown name auto-created: private, manual-priced, synthetic ticker, warning
    mystery = (
        await db.execute(select(Security).where(Security.name == "Mystery Fund"))
    ).scalar_one()
    assert mystery.ticker == "X-MYSTERYF"
    assert mystery.holding_type == "private" and mystery.is_manual_priced is True
    assert any("Mystery Fund" in w for w in report.warnings)
    txns = (
        (await db.execute(select(PositionTransaction).order_by(PositionTransaction.sort_index)))
        .scalars()
        .all()
    )
    assert [t.sort_index for t in txns] == [20, 40, 50]
    assert txns[0].shares == Decimal("10.123457")

    # Idempotent second pass
    wb2 = sheets()
    report2 = SheetReport()
    by_name2 = await apply_reference_data(db, parse_reference_data(wb2["ReferenceData"]), report2)
    await apply_positions(db, parse_positions(wb2["Positions"]), by_name2, report2)
    await db.commit()
    counts = report2.entities["position_transactions"]
    assert (counts.creates, counts.updates, counts.deletes) == (0, 0, 0)
    assert counts.skips == 3


async def test_apply_positions_deletes_importer_strays_keeps_ui_rows(db):
    wb = sheets()
    report = SheetReport()
    by_name = await apply_reference_data(db, parse_reference_data(wb["ReferenceData"]), report)
    await apply_positions(db, parse_positions(wb["Positions"]), by_name, report)
    await db.commit()
    acme_id = (
        (await db.execute(select(Security).where(Security.ticker == "ACME"))).scalar_one().id
    )
    db.add(  # stale importer-owned row (as if its sheet row was deleted)
        PositionTransaction(
            security_id=acme_id, account="Old", type="buy",
            shares=Decimal("1"), price=Decimal("1"), sort_index=990,
        )
    )
    db.add(  # UI-owned row: sort_index 0 default — never touched by the sync
        PositionTransaction(
            security_id=acme_id, account="Manual", type="buy",
            shares=Decimal("2"), price=Decimal("2"),
        )
    )
    await db.commit()
    wb2 = sheets()
    report2 = SheetReport()
    by_name2 = await apply_reference_data(db, parse_reference_data(wb2["ReferenceData"]), report2)
    await apply_positions(db, parse_positions(wb2["Positions"]), by_name2, report2)
    await db.commit()
    assert report2.entities["position_transactions"].deletes == 1
    remaining = (await db.execute(select(PositionTransaction.account))).scalars().all()
    assert "Manual" in remaining and "Old" not in remaining


async def test_apply_net_worth_accounts_snapshots_balances(db):
    report = SheetReport()
    await apply_net_worth(db, parse_net_worth(sheets()["Net Worth"]), report)
    await db.commit()
    assert report.entities["accounts"].creates == 3
    assert report.entities["net_worth_snapshots"].creates == 2
    assert report.entities["account_balances"].creates == 6
    checking = (
        await db.execute(select(Account).where(Account.slug == "checking"))
    ).scalar_one()
    assert checking.group == "cash" and checking.sort_order == 3
    january = (
        await db.execute(
            select(NetWorthSnapshot).where(NetWorthSnapshot.month == date(2024, 1, 1))
        )
    ).scalar_one()
    assert january.recorded_on == date(2024, 1, 5)
    cc = (await db.execute(select(Account).where(Account.slug == "credit-card"))).scalar_one()
    cc_balance = (
        await db.execute(
            select(AccountBalance.balance).where(
                AccountBalance.snapshot_id == january.id, AccountBalance.account_id == cc.id
            )
        )
    ).scalar_one()
    assert cc_balance == Decimal("-25.00")

    report2 = SheetReport()
    await apply_net_worth(db, parse_net_worth(sheets()["Net Worth"]), report2)
    await db.commit()
    assert report2.entities["account_balances"].creates == 0
    assert report2.entities["account_balances"].skips == 6


async def test_apply_net_worth_updates_changed_balance(db):
    report = SheetReport()
    await apply_net_worth(db, parse_net_worth(sheets()["Net Worth"]), report)
    await db.commit()
    from tests.workbook_builder import default_net_worth_rows

    rows = default_net_worth_rows()
    rows[2][2] = 111.11  # Checking, January
    report2 = SheetReport()
    await apply_net_worth(db, parse_net_worth(sheets(net_worth=rows)["Net Worth"]), report2)
    await db.commit()
    assert report2.entities["account_balances"].updates == 1
    assert any("checking" in s.lower() for s in report2.samples)


async def test_apply_spending_categories_months_cashflow(db):
    report = SheetReport()
    await apply_spending(db, parse_spending(sheets()["Spending"]), report)
    await db.commit()
    assert report.entities["spending_categories"].creates == 2
    assert report.entities["monthly_spending"].creates == 4
    assert report.entities["monthly_cashflow"].creates == 2
    food = (
        await db.execute(select(SpendingCategory).where(SpendingCategory.slug == "food"))
    ).scalar_one()
    january_food = (
        await db.execute(
            select(MonthlySpending.amount).where(
                MonthlySpending.month == date(2024, 1, 1),
                MonthlySpending.category_id == food.id,
            )
        )
    ).scalar_one()
    assert january_food == Decimal("100.00")
    cashflow = await db.get(MonthlyCashflow, date(2024, 1, 1))
    assert cashflow.net_pay == Decimal("3000.00")

    report2 = SheetReport()
    await apply_spending(db, parse_spending(sheets()["Spending"]), report2)
    await db.commit()
    assert report2.entities["monthly_spending"].creates == 0
    assert report2.entities["monthly_spending"].skips == 4
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && .venv/Scripts/python -m pytest tests/test_importer_apply.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.importer.apply'`.

- [ ] **Step 3: Implement `apply.py` (part 1)**

`backend/app/importer/apply.py`:

```python
"""Load-compare-write appliers: parsed dataclasses -> ORM upserts + report counts.

No openpyxl imports. Every applier preloads existing rows by natural key in one query,
diffs in memory, and mutates/creates through the ORM (row volumes are ~2k total). The
caller (service.py) owns the transaction: nothing here commits.
"""

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.importer.cells import slugify, synthetic_ticker
from app.importer.parsers import (
    ParsedNetWorth,
    ParsedPositions,
    ParsedReferenceData,
    ParsedSpending,
)
from app.importer.report import SheetReport
from app.models import (
    Account,
    AccountBalance,
    LatestPrice,
    MonthlyCashflow,
    MonthlySpending,
    NetWorthSnapshot,
    PositionTransaction,
    Security,
    SpendingCategory,
)


def _diff_update(obj, fields: dict, counts, report: SheetReport, sample_key: str) -> None:
    changed: list[str] = []
    for attr, new in fields.items():
        old = getattr(obj, attr)
        if old != new:
            setattr(obj, attr, new)
            changed.append(f"{attr} {old} -> {new}")
    if changed:
        counts.updates += 1
        report.add_sample(f"{sample_key}: " + "; ".join(changed))
    else:
        counts.skips += 1


async def apply_reference_data(
    db: AsyncSession, parsed: ParsedReferenceData, report: SheetReport
) -> dict[str, Security]:
    """Upsert securities; seed latest_prices insert-only. Returns name -> Security."""
    security_counts = report.counts("securities")
    price_counts = report.counts("latest_prices")
    existing = {
        s.ticker: s for s in (await db.execute(select(Security))).scalars()
    }
    by_name: dict[str, Security] = {}
    for row in parsed.securities:
        fields = {
            "name": row.name,
            "industry": row.industry,
            "holding_type": row.holding_type,
            "annual_dividend": row.annual_dividend,
            "ex_div_date": row.ex_div_date,
        }
        security = existing.get(row.ticker)
        if security is None:
            # is_manual_priced/is_active stay user-owned after creation
            security = Security(ticker=row.ticker, **fields)
            db.add(security)
            security_counts.creates += 1
            report.add_sample(f"securities[{row.ticker}]: created")
        else:
            _diff_update(security, fields, security_counts, report, f"securities[{row.ticker}]")
        by_name[row.name] = security
    await db.flush()  # ids needed for latest_prices and callers

    priced = [row for row in parsed.securities if row.last_price is not None]
    existing_prices = {
        p.security_id for p in (await db.execute(select(LatestPrice))).scalars()
    }
    for row in priced:
        security = by_name[row.name]
        if security.id in existing_prices:
            price_counts.skips += 1  # price service owns updates; import only seeds
            continue
        db.add(
            LatestPrice(
                security_id=security.id,
                price=row.last_price,
                quoted_at=datetime.now(UTC),
                source="manual",
            )
        )
        price_counts.creates += 1
        report.add_sample(f"latest_prices[{row.ticker}]: seeded {row.last_price} (manual)")
    return by_name


async def apply_positions(
    db: AsyncSession,
    parsed: ParsedPositions,
    securities_by_name: dict[str, Security],
    report: SheetReport,
) -> None:
    txn_counts = report.counts("position_transactions")
    security_counts = report.counts("securities")
    # Merge the DB view over the ReferenceData map: on RE-imports, previously auto-created
    # securities (synthetic tickers) exist in the DB but not in the refdata map — without
    # this merge they would be created twice and violate the unique ticker constraint.
    all_securities = (await db.execute(select(Security))).scalars().all()
    taken_tickers = {s.ticker for s in all_securities}
    lookup = {s.name: s for s in all_securities}
    lookup.update(securities_by_name)
    for txn in parsed.transactions:
        if txn.name not in lookup:
            ticker = synthetic_ticker(txn.name, taken_tickers)
            taken_tickers.add(ticker)
            security = Security(
                ticker=ticker,
                name=txn.name,
                industry=None,
                holding_type="private",
                is_manual_priced=True,  # a synthetic ticker can never be quoted
            )
            db.add(security)
            lookup[txn.name] = security
            security_counts.creates += 1
            report.warnings.append(
                f"Positions: security {txn.name!r} not in ReferenceData — auto-created "
                f"active with synthetic ticker {ticker} (private, manual-priced)"
            )
    await db.flush()

    existing = {
        t.sort_index: t
        for t in (
            await db.execute(
                select(PositionTransaction).where(PositionTransaction.sort_index > 0)
            )
        ).scalars()
    }
    incoming_indexes: set[int] = set()
    for txn in parsed.transactions:
        incoming_indexes.add(txn.sort_index)
        fields = {
            "security_id": lookup[txn.name].id,
            "account": txn.account,
            "type": txn.type,
            "txn_date": txn.txn_date,
            "shares": txn.shares,
            "price": txn.price,
            "fees": txn.fees,
            "split_factor": txn.split_factor,
        }
        row = existing.get(txn.sort_index)
        if row is None:
            db.add(PositionTransaction(sort_index=txn.sort_index, **fields))
            txn_counts.creates += 1
            report.add_sample(
                f"position_transactions[{txn.sort_index}]: {txn.type} "
                f"{txn.shares} {txn.name} @ {txn.price}"
            )
        else:
            _diff_update(
                row, fields, txn_counts, report,
                f"position_transactions[{txn.sort_index}]",
            )
    # Sync: importer-owned rows (sort_index > 0) whose sheet row disappeared are deleted;
    # UI-created rows keep the default sort_index 0 and are never touched (Plan 4 contract).
    for sort_index, row in existing.items():
        if sort_index not in incoming_indexes:
            await db.delete(row)
            txn_counts.deletes += 1
            report.add_sample(f"position_transactions[{sort_index}]: deleted (row left sheet)")


async def apply_net_worth(
    db: AsyncSession, parsed: ParsedNetWorth, report: SheetReport
) -> None:
    account_counts = report.counts("accounts")
    snapshot_counts = report.counts("net_worth_snapshots")
    balance_counts = report.counts("account_balances")

    existing_accounts = {
        a.slug: a for a in (await db.execute(select(Account))).scalars()
    }
    accounts_by_name: dict[str, Account] = {}
    seen_slugs: set[str] = set()
    for column in parsed.accounts:
        slug = slugify(column.name)
        if slug in seen_slugs:
            report.errors.append(
                f"Net Worth: accounts {column.name!r} and another column share slug "
                f"{slug!r} — rename one in the sheet"
            )
            continue
        seen_slugs.add(slug)
        account = existing_accounts.get(slug)
        fields = {"name": column.name, "group": column.group, "sort_order": column.sort_order}
        if account is None:
            account = Account(slug=slug, **fields)  # is_active default True, user-owned after
            db.add(account)
            account_counts.creates += 1
            report.add_sample(f"accounts[{slug}]: created ({column.group})")
        else:
            _diff_update(account, fields, account_counts, report, f"accounts[{slug}]")
        accounts_by_name[column.name] = account

    existing_snapshots = {
        s.month: s for s in (await db.execute(select(NetWorthSnapshot))).scalars()
    }
    snapshots_by_month = {}
    for snap in parsed.snapshots:
        row = existing_snapshots.get(snap.month)
        if row is None:
            row = NetWorthSnapshot(month=snap.month, recorded_on=snap.recorded_on)
            db.add(row)
            snapshot_counts.creates += 1
        else:
            _diff_update(
                row, {"recorded_on": snap.recorded_on}, snapshot_counts, report,
                f"net_worth_snapshots[{snap.month.isoformat()}]",
            )
        snapshots_by_month[snap.month] = row
    await db.flush()

    existing_balances = {
        (b.snapshot_id, b.account_id): b
        for b in (await db.execute(select(AccountBalance))).scalars()
    }
    for snap in parsed.snapshots:
        snapshot = snapshots_by_month[snap.month]
        for account_name, balance in snap.balances.items():
            account = accounts_by_name.get(account_name)
            if account is None:
                continue  # slug-collision error above already reported
            key = (snapshot.id, account.id)
            row = existing_balances.get(key)
            if row is None:
                db.add(
                    AccountBalance(
                        snapshot_id=snapshot.id, account_id=account.id, balance=balance
                    )
                )
                balance_counts.creates += 1
            else:
                _diff_update(
                    row, {"balance": balance}, balance_counts, report,
                    f"account_balances[{snap.month.isoformat()}/{account.slug}]",
                )


async def apply_spending(
    db: AsyncSession, parsed: ParsedSpending, report: SheetReport
) -> None:
    category_counts = report.counts("spending_categories")
    spend_counts = report.counts("monthly_spending")
    cashflow_counts = report.counts("monthly_cashflow")

    existing_categories = {
        c.slug: c for c in (await db.execute(select(SpendingCategory))).scalars()
    }
    categories_by_name: dict[str, SpendingCategory] = {}
    for column in parsed.categories:
        slug = slugify(column.name)
        category = existing_categories.get(slug)
        fields = {"name": column.name, "sort_order": column.sort_order}
        if category is None:
            category = SpendingCategory(slug=slug, **fields)
            db.add(category)
            category_counts.creates += 1
            report.add_sample(f"spending_categories[{slug}]: created")
        else:
            _diff_update(category, fields, category_counts, report, f"spending_categories[{slug}]")
        categories_by_name[column.name] = category
    await db.flush()

    existing_spend = {
        (s.month, s.category_id): s
        for s in (await db.execute(select(MonthlySpending))).scalars()
    }
    existing_cashflow = {
        c.month: c for c in (await db.execute(select(MonthlyCashflow))).scalars()
    }
    for month_row in parsed.months:
        for category_name, amount in month_row.amounts.items():
            category = categories_by_name[category_name]
            key = (month_row.month, category.id)
            row = existing_spend.get(key)
            if row is None:
                db.add(
                    MonthlySpending(
                        month=month_row.month, category_id=category.id, amount=amount
                    )
                )
                spend_counts.creates += 1
            else:
                _diff_update(
                    row, {"amount": amount}, spend_counts, report,
                    f"monthly_spending[{month_row.month.isoformat()}/{category.slug}]",
                )
        if month_row.net_pay is None:
            continue  # no cashflow recorded for this month
        cashflow = existing_cashflow.get(month_row.month)
        if cashflow is None:
            db.add(MonthlyCashflow(month=month_row.month, net_pay=month_row.net_pay))
            cashflow_counts.creates += 1
        else:
            _diff_update(
                cashflow, {"net_pay": month_row.net_pay}, cashflow_counts, report,
                f"monthly_cashflow[{month_row.month.isoformat()}]",
            )
```

- [ ] **Step 4: Run tests**

Run: `cd backend && .venv/Scripts/python -m pytest tests/test_importer_apply.py -q -W error`
Expected: all pass. (These hit the test Postgres via the `db` fixture — container must be up.)

- [ ] **Step 5: Format, gate, commit**

Run: `cd backend && .venv/Scripts/ruff format app tests && .venv/Scripts/ruff check . && .venv/Scripts/python -m pytest -q -W error`

```bash
git add backend/app/importer/apply.py backend/tests/test_importer_apply.py
git commit -m "feat: importer apply layer for securities, positions, net worth, spending"
```

---

### Task 11: Apply layer part 2 — taxes, espp, paycheck, focal (TDD)

**Files:**
- Modify: `backend/app/importer/apply.py` (append)
- Modify: `backend/tests/test_importer_apply.py` (append)

- [ ] **Step 1: Write the failing tests** (append)

```python
async def test_apply_taxes_years_inputs_brackets(db):
    from app.importer.apply import apply_taxes
    from app.importer.parsers import parse_taxes
    from app.models import TaxBracket, TaxInput, TaxYear

    report = SheetReport()
    await apply_taxes(db, parse_taxes(sheets()["Taxes"]), report)
    await db.commit()
    assert report.entities["tax_years"].creates == 2
    assert report.entities["tax_inputs"].creates == 86  # 43 keys x 2 years
    assert report.entities["tax_brackets"].creates == 14  # 7 x 2 years
    years = (await db.execute(select(TaxYear.year))).scalars().all()
    assert sorted(years) == [2023, 2024]
    exempt = (
        await db.execute(
            select(TaxInput.value).where(
                TaxInput.year == 2023, TaxInput.key == "unq_div_state_exempt_pct"
            )
        )
    ).scalar_one()
    assert exempt == Decimal("0.9645")

    report2 = SheetReport()
    await apply_taxes(db, parse_taxes(sheets()["Taxes"]), report2)
    await db.commit()
    assert report2.entities["tax_inputs"].creates == 0
    assert report2.entities["tax_inputs"].skips == 86
    assert report2.entities["tax_brackets"].skips == 14


async def test_apply_taxes_syncs_brackets_and_inputs_within_imported_years(db):
    from app.importer.apply import apply_taxes
    from app.importer.parsers import parse_taxes
    from app.models import TaxBracket, TaxInput
    from tests.workbook_builder import default_taxes_rows

    report = SheetReport()
    await apply_taxes(db, parse_taxes(sheets()["Taxes"]), report)
    await db.commit()
    rows = [
        row for row in default_taxes_rows()
        if not (row[1] == "Bracket 2 Rate" and row[0] is None)
        and not (row[1] == "Bracket 2 Threshold" and row[0] is None)
    ]  # federal bracket 2 removed from the sheet
    report2 = SheetReport()
    await apply_taxes(db, parse_taxes(sheets(taxes=rows)["Taxes"]), report2)
    await db.commit()
    assert report2.entities["tax_brackets"].deletes == 2  # 2023 + 2024 federal bracket 2
    remaining = (
        await db.execute(
            select(TaxBracket).where(
                TaxBracket.jurisdiction == "federal", TaxBracket.bracket_index == 2
            )
        )
    ).scalars().all()
    assert remaining == []
    # UI-created data for a year the sheet doesn't know stays untouched
    from app.models import TaxYear

    db.add(TaxYear(year=2030))
    await db.flush()
    db.add(TaxInput(year=2030, key="annual_salary", value=Decimal("1")))
    await db.commit()
    report3 = SheetReport()
    await apply_taxes(db, parse_taxes(sheets()["Taxes"]), report3)
    await db.commit()
    untouched = (
        await db.execute(
            select(TaxInput).where(TaxInput.year == 2030, TaxInput.key == "annual_salary")
        )
    ).scalar_one()
    assert untouched.value == Decimal("1.0000")


async def test_apply_espp_lots_and_periods(db):
    from app.importer.apply import apply_espp
    from app.importer.parsers import parse_espp
    from app.models import EsppLot, EsppPeriod

    report = SheetReport()
    await apply_espp(db, parse_espp(sheets()["ESPP"]), report)
    await db.commit()
    assert report.entities["espp_lots"].creates == 2
    assert report.entities["espp_periods"].creates == 2
    lot = (
        await db.execute(select(EsppLot).where(EsppLot.purchase_date == date(2024, 2, 29)))
    ).scalar_one()
    assert lot.subscription_price == Decimal("40.00000")
    assert lot.sold_date is None
    # sold fields are user-owned: set one, re-apply, verify preserved
    lot.sold_date = date(2025, 10, 1)
    lot.sold_price = Decimal("55.00000")
    await db.commit()
    report2 = SheetReport()
    await apply_espp(db, parse_espp(sheets()["ESPP"]), report2)
    await db.commit()
    assert report2.entities["espp_lots"].skips == 2
    refreshed = (
        await db.execute(select(EsppLot).where(EsppLot.purchase_date == date(2024, 2, 29)))
    ).scalar_one()
    assert refreshed.sold_date == date(2025, 10, 1)
    period = (
        await db.execute(
            select(EsppPeriod).where(EsppPeriod.label == "February 2025 Purchase")
        )
    ).scalar_one()
    assert period.period_start == date(2024, 9, 1)
    assert period.contribution_pct == Decimal("0.100000000")


async def test_apply_paycheck_derives_effective_date_from_focal(db):
    from app.importer.apply import apply_focal_history, apply_paycheck
    from app.importer.parsers import parse_focal_history, parse_paycheck
    from app.models import CompEvent, PaycheckProfile

    wb = sheets()
    report = SheetReport()
    focal = parse_focal_history(wb["Focal History"])
    await apply_focal_history(db, focal, report)
    await apply_paycheck(db, parse_paycheck(wb["Paycheck Modeler"]), focal, report)
    await db.commit()
    assert report.entities["comp_events"].creates == 2
    assert report.entities["paycheck_profiles"].creates == 1
    profile = (await db.execute(select(PaycheckProfile))).scalar_one()
    assert profile.effective_date == date(2024, 1, 1)  # latest focal year with a New Base
    assert profile.annual_salary == Decimal("120000.00")
    assert profile.pay_periods_per_year == 24
    assert any("effective_date" in w for w in report.warnings)
    events = (await db.execute(select(CompEvent))).scalars().all()
    assert {(e.focal_year, e.new_base is None) for e in events} == {(2024, False), (2025, True)}

    report2 = SheetReport()
    wb2 = sheets()
    focal2 = parse_focal_history(wb2["Focal History"])
    await apply_focal_history(db, focal2, report2)
    await apply_paycheck(db, parse_paycheck(wb2["Paycheck Modeler"]), focal2, report2)
    await db.commit()
    assert report2.entities["paycheck_profiles"].skips == 1
    assert report2.entities["comp_events"].skips == 2


async def test_apply_paycheck_without_focal_new_base_skips(db):
    from app.importer.apply import apply_focal_history, apply_paycheck
    from app.importer.parsers import parse_focal_history, parse_paycheck
    from app.models import PaycheckProfile
    from tests.workbook_builder import default_focal_rows

    rows = default_focal_rows()
    rows[2][3] = None  # 2024 loses its New Base -> no derivable effective_date
    wb = sheets(focal=rows)
    report = SheetReport()
    focal = parse_focal_history(wb["Focal History"])
    await apply_focal_history(db, focal, report)
    await apply_paycheck(db, parse_paycheck(wb["Paycheck Modeler"]), focal, report)
    await db.commit()
    assert (await db.execute(select(PaycheckProfile))).scalars().all() == []
    assert any("no focal year" in w.lower() for w in report.warnings)
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && .venv/Scripts/python -m pytest tests/test_importer_apply.py -q`
Expected: new tests FAIL — `ImportError: cannot import name 'apply_taxes'`.

- [ ] **Step 3: Implement** (append to `apply.py`)

Add to the imports at the top of `apply.py`:

```python
from datetime import date

from app.importer.parsers import (
    ParsedEspp,
    ParsedFocalHistory,
    ParsedPaycheck,
    ParsedTaxes,
)
from app.models import (
    CompEvent,
    EsppLot,
    EsppPeriod,
    PaycheckProfile,
    TaxBracket,
    TaxInput,
    TaxInputDefinition,
    TaxYear,
)
from app.seed import seed_tax_definitions
```

(Merge into the existing import blocks — one `from app.importer.parsers import (...)` and one `from app.models import (...)` list; ruff will sort.)

Then append:

```python
async def apply_taxes(db: AsyncSession, parsed: ParsedTaxes, report: SheetReport) -> None:
    year_counts = report.counts("tax_years")
    input_counts = report.counts("tax_inputs")
    bracket_counts = report.counts("tax_brackets")

    # The importer FKs tax_inputs.key -> tax_input_definitions; make sure the (insert-only)
    # seed has run so the Task 2 keys exist on older databases.
    await seed_tax_definitions(db)
    await db.flush()
    known_keys = set(
        (await db.execute(select(TaxInputDefinition.key))).scalars().all()
    )
    for item in parsed.inputs:
        if item.key not in known_keys:
            report.errors.append(
                f"Taxes: input key {item.key!r} missing from tax_input_definitions — "
                "run `python -m app.seed` and retry"
            )
            return

    imported_years = sorted(
        {i.year for i in parsed.inputs} | {b.year for b in parsed.brackets}
    )
    existing_years = {
        y.year for y in (await db.execute(select(TaxYear))).scalars()
    }
    for year in imported_years:
        if year in existing_years:
            year_counts.skips += 1
        else:
            db.add(TaxYear(year=year))
            year_counts.creates += 1
            report.add_sample(f"tax_years[{year}]: created")
    await db.flush()

    # Sheet wins on re-import WITHIN imported years; other years are never touched.
    existing_inputs = {
        (i.year, i.key): i
        for i in (
            await db.execute(select(TaxInput).where(TaxInput.year.in_(imported_years)))
        ).scalars()
    }
    incoming_input_keys: set[tuple[int, str]] = set()
    for item in parsed.inputs:
        key = (item.year, item.key)
        incoming_input_keys.add(key)
        row = existing_inputs.get(key)
        if row is None:
            db.add(TaxInput(year=item.year, key=item.key, value=item.value))
            input_counts.creates += 1
        else:
            _diff_update(
                row, {"value": item.value}, input_counts, report,
                f"tax_inputs[{item.year}/{item.key}]",
            )
    for key, row in existing_inputs.items():
        if key not in incoming_input_keys:
            await db.delete(row)
            input_counts.deletes += 1
            report.add_sample(f"tax_inputs[{key[0]}/{key[1]}]: deleted (cell left sheet)")

    existing_brackets = {
        (b.year, b.jurisdiction, b.bracket_index): b
        for b in (
            await db.execute(select(TaxBracket).where(TaxBracket.year.in_(imported_years)))
        ).scalars()
    }
    incoming_bracket_keys: set[tuple[int, str, int]] = set()
    for item in parsed.brackets:
        key = (item.year, item.jurisdiction, item.bracket_index)
        incoming_bracket_keys.add(key)
        row = existing_brackets.get(key)
        fields = {"rate": item.rate, "threshold": item.threshold}
        if row is None:
            db.add(
                TaxBracket(
                    year=item.year, jurisdiction=item.jurisdiction,
                    bracket_index=item.bracket_index, **fields,
                )
            )
            bracket_counts.creates += 1
        else:
            _diff_update(
                row, fields, bracket_counts, report,
                f"tax_brackets[{item.year}/{item.jurisdiction}/{item.bracket_index}]",
            )
    # Stale brackets are load-bearing wrong data for the Plan 5 engine — sync-delete them.
    for key, row in existing_brackets.items():
        if key not in incoming_bracket_keys:
            await db.delete(row)
            bracket_counts.deletes += 1
            report.add_sample(
                f"tax_brackets[{key[0]}/{key[1]}/{key[2]}]: deleted (row left sheet)"
            )


async def apply_espp(db: AsyncSession, parsed: ParsedEspp, report: SheetReport) -> None:
    lot_counts = report.counts("espp_lots")
    period_counts = report.counts("espp_periods")

    existing_lots = {
        lot.purchase_date: lot for lot in (await db.execute(select(EsppLot))).scalars()
    }
    for lot in parsed.lots:
        fields = {
            "qualifying_date": lot.qualifying_date,
            "shares": lot.shares,
            "subscription_price": lot.subscription_price,
            "purchase_fmv": lot.purchase_fmv,
            "purchase_price": lot.purchase_price,
            # sold_date/sold_price/notes are user-owned: the sheet records no real sales
        }
        row = existing_lots.get(lot.purchase_date)
        if row is None:
            db.add(EsppLot(purchase_date=lot.purchase_date, **fields))
            lot_counts.creates += 1
            report.add_sample(f"espp_lots[{lot.purchase_date.isoformat()}]: created")
        else:
            _diff_update(
                row, fields, lot_counts, report,
                f"espp_lots[{lot.purchase_date.isoformat()}]",
            )

    existing_periods = {
        p.label: p for p in (await db.execute(select(EsppPeriod))).scalars()
    }
    for period in parsed.periods:
        fields = {
            "period_start": period.period_start,
            "period_end": period.period_end,
            "semi_annual_base": period.semi_annual_base,
            "additional_payments": period.additional_payments,
            "contribution_pct": period.contribution_pct,
        }
        row = existing_periods.get(period.label)
        if row is None:
            db.add(EsppPeriod(label=period.label, **fields))
            period_counts.creates += 1
            report.add_sample(f"espp_periods[{period.label}]: created")
        else:
            _diff_update(row, fields, period_counts, report, f"espp_periods[{period.label}]")


async def apply_focal_history(
    db: AsyncSession, parsed: ParsedFocalHistory, report: SheetReport
) -> None:
    counts = report.counts("comp_events")
    existing = {
        e.focal_year: e for e in (await db.execute(select(CompEvent))).scalars()
    }
    for event in parsed.events:
        fields = {
            "current_base": event.current_base,
            "new_base": event.new_base,
            "unvested_rsus": event.unvested_rsus,
            "unvested_price": event.unvested_price,
            "refresh_rsus": event.refresh_rsus,
            "grant_price": event.grant_price,
        }
        row = existing.get(event.focal_year)
        if row is None:
            db.add(CompEvent(focal_year=event.focal_year, **fields))
            counts.creates += 1
            report.add_sample(f"comp_events[{event.focal_year}]: created")
        else:
            _diff_update(row, fields, counts, report, f"comp_events[{event.focal_year}]")


async def apply_paycheck(
    db: AsyncSession,
    parsed: ParsedPaycheck,
    focal: ParsedFocalHistory,
    report: SheetReport,
) -> None:
    counts = report.counts("paycheck_profiles")
    if parsed.profile is None:
        return
    # The sheet has no effective date. Deterministic rule: Jan 1 of the latest focal year
    # with a New Base (comp changes drive paycheck changes). Edit in the UI once Plan 5 lands.
    dated_years = [e.focal_year for e in focal.events if e.new_base is not None]
    if not dated_years:
        report.warnings.append(
            "Paycheck Modeler: no focal year with a New Base — cannot derive "
            "effective_date; profile not imported"
        )
        return
    focal_year = max(dated_years)
    effective_date = date(focal_year, 1, 1)
    report.warnings.append(
        f"Paycheck Modeler: effective_date derived as {effective_date.isoformat()} "
        f"(Jan 1 of latest focal year with a New Base)"
    )
    latest_new_base = next(
        e.new_base for e in focal.events if e.focal_year == focal_year
    )
    if latest_new_base != parsed.profile.annual_salary:
        report.warnings.append(
            f"Paycheck Modeler: Annual Salary {parsed.profile.annual_salary} != focal "
            f"{focal_year} New Base {latest_new_base} — derived effective_date may be stale"
        )
    fields = {
        "annual_salary": parsed.profile.annual_salary,
        "trad_401k_pct": parsed.profile.trad_401k_pct,
        "roth_401k_pct": parsed.profile.roth_401k_pct,
        "after_tax_401k_pct": parsed.profile.after_tax_401k_pct,
        "espp_pct": parsed.profile.espp_pct,
        "withholding_pct": parsed.profile.withholding_pct,
        "dental_vision_per_check": parsed.profile.dental_vision_per_check,
        "hsa_per_check": parsed.profile.hsa_per_check,
        # pay_periods_per_year stays at its default (24) on create, user-owned on update
    }
    existing = {
        p.effective_date: p for p in (await db.execute(select(PaycheckProfile))).scalars()
    }
    row = existing.get(effective_date)
    if row is None:
        db.add(PaycheckProfile(effective_date=effective_date, **fields))
        counts.creates += 1
        report.add_sample(f"paycheck_profiles[{effective_date.isoformat()}]: created")
    else:
        _diff_update(
            row, fields, counts, report, f"paycheck_profiles[{effective_date.isoformat()}]"
        )
```

- [ ] **Step 4: Run tests**

Run: `cd backend && .venv/Scripts/python -m pytest tests/test_importer_apply.py -q -W error`
Expected: all pass.

- [ ] **Step 5: Format, gate, commit**

Run: `cd backend && .venv/Scripts/ruff format app tests && .venv/Scripts/ruff check . && .venv/Scripts/python -m pytest -q -W error`

```bash
git add backend/app/importer/apply.py backend/tests/test_importer_apply.py
git commit -m "feat: importer apply layer for taxes, espp, paycheck, focal history"
```

---

### Task 12: Service orchestrator + CLI (TDD)

**Files:**
- Create: `backend/app/importer/service.py`
- Create: `backend/app/importer/__main__.py`
- Modify: `backend/app/importer/__init__.py`
- Test: `backend/tests/test_importer_service.py`

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_importer_service.py`:

```python
from sqlalchemy import func, select

from app.importer.__main__ import build_parser
from app.importer.report import SHEET_KEYS
from app.importer.service import run_import
from app.models import Account, PositionTransaction, Security, TaxInput
from tests.workbook_builder import build_workbook, default_taxes_rows


async def _count(db, model) -> int:
    return (await db.execute(select(func.count()).select_from(model))).scalar_one()


async def test_dry_run_reports_without_writing(db):
    report = await run_import(build_workbook(), db, dry_run=True)
    assert report.dry_run is True and report.applied is False
    assert not report.has_errors
    assert report.sheets["net_worth"].entities["accounts"].creates == 3
    assert report.sheets["taxes"].entities["tax_inputs"].creates == 86
    assert await _count(db, Account) == 0
    assert await _count(db, Security) == 0
    assert await _count(db, TaxInput) == 0


async def test_apply_then_reapply_is_all_skips(db):
    first = await run_import(build_workbook(), db, dry_run=False)
    assert first.applied is True and not first.has_errors
    assert await _count(db, Account) == 3
    assert await _count(db, Security) == 4  # 3 ReferenceData + Mystery Fund auto-create
    assert await _count(db, PositionTransaction) == 3

    second = await run_import(build_workbook(), db, dry_run=False)
    assert second.applied is True
    for key in SHEET_KEYS:
        for entity, counts in second.sheets[key].entities.items():
            assert counts.creates == 0, (key, entity)
            assert counts.updates == 0, (key, entity)
            assert counts.deletes == 0, (key, entity)
    # And a dry-run after apply shows a clean no-op diff (spec: import twice -> no diff)
    third = await run_import(build_workbook(), db, dry_run=True)
    assert third.sheets["net_worth"].entities["account_balances"].skips == 6


async def test_parse_errors_block_apply_entirely(db):
    rows = default_taxes_rows()
    rows[3][1] = "Pay Cadence"  # label drift -> Taxes parser aborts with error
    report = await run_import(build_workbook(taxes=rows), db, dry_run=False)
    assert report.has_errors and report.applied is False
    # Strict contract: NOTHING is written, not even clean sheets
    assert await _count(db, Account) == 0
    assert await _count(db, Security) == 0


async def test_missing_sheet_is_error(db):
    report = await run_import(build_workbook(portfolio=None), db, dry_run=True)
    assert any("Portfolio" in e for e in report.sheets["portfolio"].errors)
    assert report.has_errors


def test_cli_parser_flags():
    args = build_parser().parse_args(["book.xlsx", "--dry-run"])
    assert args.workbook.name == "book.xlsx" and args.dry_run is True
    args = build_parser().parse_args(["book.xlsx"])
    assert args.dry_run is False
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && .venv/Scripts/python -m pytest tests/test_importer_service.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.importer.service'`.

- [ ] **Step 3: Implement `service.py`**

`backend/app/importer/service.py`:

```python
"""Importer orchestrator: workbook bytes -> parse all sheets -> apply or abort.

Same code path for dry-run and apply (spec section 5): the appliers always run; dry-run
rolls the session back instead of committing. Any parse error anywhere blocks the apply
entirely — the report still carries every count so the diff can be reviewed.
"""

import io
import zipfile

import openpyxl
from openpyxl.utils.exceptions import InvalidFileException
from sqlalchemy.ext.asyncio import AsyncSession

from app.importer import apply as appliers
from app.importer import parsers
from app.importer.report import ImportReport

PARSER_TABLE = (
    ("reference_data", "ReferenceData", parsers.parse_reference_data),
    ("positions", "Positions", parsers.parse_positions),
    ("portfolio", "Portfolio", parsers.parse_portfolio),
    ("net_worth", "Net Worth", parsers.parse_net_worth),
    ("spending", "Spending", parsers.parse_spending),
    ("taxes", "Taxes", parsers.parse_taxes),
    ("espp", "ESPP", parsers.parse_espp),
    ("paycheck", "Paycheck Modeler", parsers.parse_paycheck),
    ("focal_history", "Focal History", parsers.parse_focal_history),
)


class InvalidWorkbookError(ValueError):
    """The upload/file is not a readable .xlsx workbook."""


def _load_workbook(data: bytes):
    try:
        return openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except (zipfile.BadZipFile, InvalidFileException, KeyError, OSError) as exc:
        raise InvalidWorkbookError(str(exc)) from exc


async def run_import(data: bytes, db: AsyncSession, *, dry_run: bool) -> ImportReport:
    report = ImportReport.new(dry_run=dry_run)
    workbook = _load_workbook(data)
    parsed: dict[str, object] = {}
    try:
        for key, sheet_name, parser in PARSER_TABLE:
            sheet_report = report.sheets[key]
            if sheet_name not in workbook.sheetnames:
                sheet_report.errors.append(f"sheet {sheet_name!r} not found in workbook")
                continue
            result = parser(workbook[sheet_name])
            sheet_report.warnings.extend(result.issues.warnings)
            sheet_report.errors.extend(result.issues.errors)
            parsed[key] = result
    finally:
        workbook.close()
    if report.has_errors:
        return report  # strict: errors anywhere block the whole apply (spec section 5)

    try:
        by_name = await appliers.apply_reference_data(
            db, parsed["reference_data"], report.sheets["reference_data"]
        )
        await appliers.apply_positions(
            db, parsed["positions"], by_name, report.sheets["positions"]
        )
        await appliers.apply_net_worth(db, parsed["net_worth"], report.sheets["net_worth"])
        await appliers.apply_spending(db, parsed["spending"], report.sheets["spending"])
        await appliers.apply_taxes(db, parsed["taxes"], report.sheets["taxes"])
        await appliers.apply_espp(db, parsed["espp"], report.sheets["espp"])
        await appliers.apply_focal_history(
            db, parsed["focal_history"], report.sheets["focal_history"]
        )
        await appliers.apply_paycheck(
            db, parsed["paycheck"], parsed["focal_history"], report.sheets["paycheck"]
        )
        if report.has_errors or dry_run:  # apply_taxes can error on missing definitions
            await db.rollback()
        else:
            await db.commit()
            report.applied = True
    except Exception:
        await db.rollback()
        raise
    return report
```

- [ ] **Step 4: Implement the CLI**

`backend/app/importer/__main__.py`:

```python
"""CLI entry point: python -m app.importer path/to/workbook.xlsx [--dry-run]

Exit codes: 0 = success (report printed), 1 = report contains errors (nothing applied),
2 = unreadable file. Runs against DATABASE_URL from the environment/.env like app.seed.
"""

import argparse
import asyncio
import sys
from pathlib import Path

from app.database import SessionLocal, engine
from app.importer.service import InvalidWorkbookError, run_import


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m app.importer",
        description="Import the source spreadsheet (dry-run by default is OFF; pass --dry-run "
        "to preview the diff without writing).",
    )
    parser.add_argument("workbook", type=Path, help="path to the .xlsx workbook")
    parser.add_argument(
        "--dry-run", action="store_true", help="report the diff without writing"
    )
    return parser


async def _amain(workbook: Path, dry_run: bool) -> int:
    data = workbook.read_bytes()
    try:
        async with SessionLocal() as db:
            report = await run_import(data, db, dry_run=dry_run)
    except InvalidWorkbookError as exc:
        print(f"error: not a valid .xlsx workbook ({exc})", file=sys.stderr)
        return 2
    finally:
        await engine.dispose()
    print(report.render_text())
    if report.has_errors:
        print("\nerrors present — nothing was applied", file=sys.stderr)
        return 1
    return 0


def main() -> int:
    args = build_parser().parse_args()
    if not args.workbook.is_file():
        print(f"error: {args.workbook} is not a file", file=sys.stderr)
        return 2
    return asyncio.run(_amain(args.workbook, args.dry_run))


if __name__ == "__main__":
    raise SystemExit(main())
```

Replace `backend/app/importer/__init__.py` contents with:

```python
"""Repeatable xlsx importer for the source spreadsheet (spec section 5)."""

from app.importer.report import ImportReport
from app.importer.service import InvalidWorkbookError, run_import

__all__ = ["ImportReport", "InvalidWorkbookError", "run_import"]
```

- [ ] **Step 5: Run tests**

Run: `cd backend && .venv/Scripts/python -m pytest tests/test_importer_service.py -q -W error`
Expected: all pass.

- [ ] **Step 6: CLI smoke against the DEV database (safe: dry-run)**

Build a throwaway synthetic workbook and dry-run the real CLI end to end:

```bash
cd backend && .venv/Scripts/python -c "
from tests.workbook_builder import build_workbook
open('.tmp-synthetic.xlsx', 'wb').write(build_workbook())
" && .venv/Scripts/python -m app.importer .tmp-synthetic.xlsx --dry-run; echo "exit=$?"; rm .tmp-synthetic.xlsx
```
Expected: report prints with creates for every sheet, `applied=False`, exit=0. (Dry-run rolls back — the dev DB is untouched. Do NOT run without `--dry-run` here; the synthetic fixture must never be applied to the dev DB.)

- [ ] **Step 7: Format, gate, commit**

Run: `cd backend && .venv/Scripts/ruff format app tests && .venv/Scripts/ruff check . && .venv/Scripts/python -m pytest -q -W error`

```bash
git add backend/app/importer/__init__.py backend/app/importer/__main__.py backend/app/importer/service.py backend/tests/test_importer_service.py
git commit -m "feat: importer orchestrator with dry-run rollback and CLI entry point"
```

---

### Task 13: Upload endpoint (TDD)

**Files:**
- Create: `backend/app/api/import_.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_import_api.py`

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_import_api.py`:

```python
from sqlalchemy import func, select

from app.models import Security
from tests.workbook_builder import build_workbook


def _upload(data: bytes):
    return {"file": ("workbook.xlsx", data, "application/octet-stream")}


async def test_import_requires_auth(client):
    resp = await client.post("/api/v1/import/xlsx", files=_upload(b"whatever"))
    assert resp.status_code == 401


async def test_import_dry_run_is_the_default(auth_client, db):
    resp = await auth_client.post("/api/v1/import/xlsx", files=_upload(build_workbook()))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["dry_run"] is True and body["applied"] is False
    assert body["sheets"]["net_worth"]["entities"]["accounts"]["creates"] == 3
    count = (await db.execute(select(func.count()).select_from(Security))).scalar_one()
    assert count == 0  # dry run wrote nothing


async def test_import_apply_writes_and_reports(auth_client, db):
    resp = await auth_client.post(
        "/api/v1/import/xlsx?dry_run=false", files=_upload(build_workbook())
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["applied"] is True
    count = (await db.execute(select(func.count()).select_from(Security))).scalar_one()
    assert count == 4


async def test_import_rejects_non_xlsx(auth_client):
    resp = await auth_client.post("/api/v1/import/xlsx", files=_upload(b"not a zip"))
    assert resp.status_code == 400


async def test_import_rejects_oversize_upload(auth_client):
    blob = b"x" * (15 * 1024 * 1024 + 1)
    resp = await auth_client.post("/api/v1/import/xlsx", files=_upload(blob))
    assert resp.status_code == 413
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && .venv/Scripts/python -m pytest tests/test_import_api.py -q`
Expected: FAIL — 404s (router not registered yet).

- [ ] **Step 3: Implement the router**

`backend/app/api/import_.py`:

```python
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.importer import ImportReport, InvalidWorkbookError, run_import
from app.models import User

router = APIRouter(prefix="/import", tags=["import"])

MAX_UPLOAD_BYTES = 15 * 1024 * 1024  # real workbook is <1 MB; generous ceiling


@router.post("/xlsx", response_model=ImportReport)
async def import_xlsx(
    file: UploadFile,
    dry_run: bool = Query(True),  # safe default: preview, never write
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ImportReport:
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 15 MB)")
    try:
        return await run_import(data, db, dry_run=dry_run)
    except InvalidWorkbookError:
        raise HTTPException(status_code=400, detail="Not a valid .xlsx workbook") from None
```

In `backend/app/main.py`, change the import line and add the router:

```python
from app.api import auth, import_
```

and after the existing `app.include_router(auth.router, prefix="/api/v1")`:

```python
app.include_router(import_.router, prefix="/api/v1")
```

- [ ] **Step 4: Run tests**

Run: `cd backend && .venv/Scripts/python -m pytest tests/test_import_api.py -q -W error`
Expected: all pass.

- [ ] **Step 5: Format, gate, commit**

Run: `cd backend && .venv/Scripts/ruff format app tests && .venv/Scripts/ruff check . && .venv/Scripts/python -m pytest -q -W error`

```bash
git add backend/app/api/import_.py backend/app/main.py backend/tests/test_import_api.py
git commit -m "feat: authenticated xlsx import endpoint with dry-run default"
```

---

### Task 14: Frontend vitest + Plan 1's regression-test debts

Plan 1 shipped zero frontend tests and mutation-proved the gap: deleting AuthContext's load-bearing loop guard passes lint+build+CI green. This task lands vitest with the two debt tests: the loop-guard regression and 422-array error parsing.

**Files:**
- Modify: `package.json`, `package-lock.json` (deps + script)
- Modify: `vite.config.ts` (vitest config)
- Create: `src/contexts/AuthContext.test.tsx`
- Create: `src/api/client.test.ts`
- Modify: `.github/workflows/ci.yml` (frontend job: `npm test`)

- [ ] **Step 1: Install dev dependencies (repo root, not backend/)**

```bash
npm install -D vitest@^3.2.4 jsdom@^26.1.0 @testing-library/react@^16.3.0 @testing-library/dom@^10.4.1 --no-audit --no-fund
```

vitest is pinned to major 3 deliberately: vitest 4 dropped Node 18 and this box runs Node 18.12 (see machine notes). `@testing-library/dom` is an explicit install because `@testing-library/react` v16 moved it to a peer dependency.

- [ ] **Step 2: Add the test script**

In `package.json` `"scripts"`, after `"lint"`:

```json
    "test": "vitest run",
```

- [ ] **Step 3: Wire vitest into the Vite config**

In `vite.config.ts`: add this reference as the FIRST line of the file, keep everything currently there, and add the `test` property to the existing `defineConfig({...})` object:

```ts
/// <reference types="vitest/config" />
```

```ts
  test: {
    environment: 'jsdom',
  },
```

- [ ] **Step 4: Write the failing tests**

`src/contexts/AuthContext.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from './AuthContext'
import * as authApi from '../api/auth'

vi.mock('../api/auth', () => ({
  fetchMe: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
}))

function Probe() {
  const { isAuthenticated, isLoading } = useAuth()
  return <div data-testid="probe">{`${isAuthenticated}|${isLoading}`}</div>
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.clearAllMocks()
})

it('never calls fetchMe on a tokenless mount (load-bearing loop guard)', () => {
  // Without the guard, a tokenless mount calls /auth/me, gets 401, and client.ts
  // clears+redirects to /login, remounting this provider in an infinite reload loop.
  // Mutation-proven in Plan 1: deleting the guard passed lint+build+CI green.
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  )
  expect(vi.mocked(authApi.fetchMe)).not.toHaveBeenCalled()
  expect(screen.getByTestId('probe').textContent).toBe('false|false')
})

it('fetches the session exactly once when a token exists', async () => {
  localStorage.setItem('finance_token', 'a-token')
  vi.mocked(authApi.fetchMe).mockResolvedValue({ email: 'me@example.com' })
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  )
  await waitFor(() => {
    expect(screen.getByTestId('probe').textContent).toBe('true|false')
  })
  expect(vi.mocked(authApi.fetchMe)).toHaveBeenCalledTimes(1)
})
```

`src/api/client.test.ts`:

```ts
import { afterEach, expect, it, vi } from 'vitest'
import { api, ApiError } from './client'

function mockFetchFailure(status: number, body: unknown, jsonThrows = false) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      statusText: 'Boom',
      json: jsonThrows ? () => Promise.reject(new Error('not json')) : async () => body,
    })
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

it('joins FastAPI 422 validation arrays into one message', async () => {
  mockFetchFailure(422, { detail: [{ msg: 'field a is bad' }, { msg: 'field b is bad' }] })
  const error = await api('/anything').catch((e: unknown) => e)
  expect(error).toBeInstanceOf(ApiError)
  expect((error as ApiError).status).toBe(422)
  expect((error as ApiError).message).toBe('field a is bad; field b is bad')
})

it('reads slowapi 429 bodies from the error key', async () => {
  mockFetchFailure(429, { error: 'Rate limit exceeded: 10 per 1 minute' })
  const error = (await api('/anything').catch((e: unknown) => e)) as ApiError
  expect(error.status).toBe(429)
  expect(error.message).toBe('Rate limit exceeded: 10 per 1 minute')
})

it('falls back to statusText on non-JSON error bodies', async () => {
  mockFetchFailure(500, null, true)
  const error = (await api('/anything').catch((e: unknown) => e)) as ApiError
  expect(error.message).toBe('Boom')
})
```

(The 401 clear-and-redirect path is deliberately untested: `window.location.assign` is not implementable in jsdom without brittle stubbing. Noted as accepted.)

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: 5 passed (2 files). If vitest refuses to start on the local Node 18.12, record it as a machine-note escalation and verify via CI instead — do not upgrade Node mid-plan.

- [ ] **Step 6: Lint + typecheck + build still green**

Run: `npm run lint && npm run build`
Expected: clean (the pre-existing react-refresh warning on useAuth is sanctioned). If `tsc -b` complains about vitest types in `vite.config.ts`, confirm the `/// <reference types="vitest/config" />` line is the first line of the file.

- [ ] **Step 7: Add the CI step**

In `.github/workflows/ci.yml` frontend job, insert between `npm run lint` and `npm run build`:

```yaml
      - run: npm test
```

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json vite.config.ts src/contexts/AuthContext.test.tsx src/api/client.test.ts .github/workflows/ci.yml
git commit -m "test: vitest with AuthContext loop-guard and API error-parsing regressions"
```

---

### Task 15: Real-data import + reconciliation (controller-supervised)

This task touches the real workbook and the dev database. No personal values may land in the repo, the plan doc, or fixtures — record counts and PASS/FAIL only.

**Files:**
- Modify: `docs/superpowers/plans/2026-08-13-plan-2-importer.md` (fill the results table below)

- [ ] **Step 1: Prepare the dev database**

```bash
docker compose -f backend/docker-compose.yml up -d --wait db
cd backend && .venv/Scripts/alembic upgrade head && .venv/Scripts/python -m app.seed
```
Expected: migrations at head (incl. Task 2's widen), `Seed complete` (admin unchanged, 43 tax defs present).

- [ ] **Step 2: Dry-run the real workbook**

```bash
cd backend && .venv/Scripts/python -m app.importer "C:\Users\edyli\Downloads\Personal Finance Dashboard.xlsx" --dry-run
```
Expected: exit 0, `applied=False`, per-sheet counts matching the "Expected real-data counts" table above, plus (all expected) warnings: sentinel aggregate, liability negation, zero-share positions skips, ESPP derived periods + ignored taxation calculator, paycheck derived effective_date. **Compare every count against the table; investigate ANY divergence before applying** (the user may have edited the sheet since 2026-08-13 — e.g. added the October net-worth row or 2026 spending; a small, explainable diff is fine, an unexplainable one is a bug).

- [ ] **Step 3: Apply**

```bash
cd backend && .venv/Scripts/python -m app.importer "C:\Users\edyli\Downloads\Personal Finance Dashboard.xlsx"
```
Expected: exit 0, `applied=True`, same counts as the dry-run.

- [ ] **Step 4: Idempotency on real data**

Re-run the Step 2 dry-run command.
Expected: every entity shows 0 creates / 0 updates / 0 deletes; all counts in `skips`.

- [ ] **Step 5: Reconciliation spot-checks (counts + 3 values checked against the open sheet, values not recorded anywhere)**

```bash
docker exec finance-dashboard-db-1 psql -U finance -d finance -c "
SELECT (SELECT count(*) FROM accounts) accounts,
       (SELECT count(*) FROM net_worth_snapshots) snapshots,
       (SELECT count(*) FROM account_balances) balances,
       (SELECT count(*) FROM spending_categories) categories,
       (SELECT count(*) FROM monthly_spending) spending,
       (SELECT count(*) FROM monthly_cashflow) cashflow,
       (SELECT count(*) FROM securities) securities,
       (SELECT count(*) FROM latest_prices) prices,
       (SELECT count(*) FROM position_transactions) txns,
       (SELECT count(*) FROM tax_years) years,
       (SELECT count(*) FROM tax_inputs) tax_inputs,
       (SELECT count(*) FROM tax_brackets) brackets,
       (SELECT count(*) FROM espp_lots) lots,
       (SELECT count(*) FROM espp_periods) periods,
       (SELECT count(*) FROM paycheck_profiles) profiles,
       (SELECT count(*) FROM comp_events) comp;"
```

Then three value spot-checks, comparing psql output by eye against the open spreadsheet (do not paste sheet values into anything committed):

```bash
docker exec finance-dashboard-db-1 psql -U finance -d finance -c "
SELECT a.slug, b.balance FROM account_balances b
JOIN accounts a ON a.id = b.account_id
JOIN net_worth_snapshots s ON s.id = b.snapshot_id
WHERE s.month = '2026-08-01' AND a.slug IN ('wells-fargo-checking','fundrise','venturex-cc');"

docker exec finance-dashboard-db-1 psql -U finance -d finance -c "
SELECT s.month, sum(s.amount) AS total FROM monthly_spending s
WHERE s.month = '2025-12-01' GROUP BY s.month;"

docker exec finance-dashboard-db-1 psql -U finance -d finance -c "
SELECT year, value FROM tax_inputs WHERE key = 'unq_div_state_exempt_pct' ORDER BY year;"
```

Checks: the two asset balances equal the sheet cells; `venturex-cc` is the NEGATED sheet cell; December-2025 spending total equals the sheet's TOTAL cell; the state-exempt percentages read 0.9645/0.9753/0.9514/0.9753 (4 dp intact). **Known/expected mismatch:** summing all balances for a month will NOT equal the sheet's NET WORTH cell — component accounts overlap (see Workbook reference); that is a Plan 3 design input, not an import bug.

- [ ] **Step 6: Record results in this plan and commit**

Fill in below (counts and PASS/FAIL only), check the boxes, commit the plan-doc update:

```
### Task 15 results (fill during execution)
- Dry-run counts vs expectations: <PASS/notes>
- Apply exit code / applied flag: <...>
- Re-run idempotency (all skips): <PASS/FAIL>
- Balance spot-checks (3 accounts): <PASS/FAIL>
- Spending total spot-check: <PASS/FAIL>
- Tax 4dp spot-check: <PASS/FAIL>
- Warnings observed: <bulleted summary, no values>
```

```bash
git add docs/superpowers/plans/2026-08-13-plan-2-importer.md
git commit -m "docs: record real-data import reconciliation results"
```

---

### Task 16: Final gates + forward notes

**Files:**
- Modify: `docs/superpowers/plans/2026-08-13-plan-2-importer.md` (forward notes)

- [ ] **Step 1: Full verification suite**

```bash
cd backend && .venv/Scripts/ruff check . && .venv/Scripts/ruff format --check . && .venv/Scripts/python -m pytest -q -W error
cd .. && npm run lint && npm test && npm run build
```
Expected: everything green (backend suite now ≥ 47 + ~45 new tests).

- [ ] **Step 2: Boot smoke — API serves the new endpoint**

```bash
cd backend && (.venv/Scripts/uvicorn app.main:app --port 8000 &) && curl --retry 15 --retry-connrefused --retry-delay 1 -s http://127.0.0.1:8000/api/v1/health && curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:8000/api/v1/import/xlsx
```
Expected: `{"status":"ok"}` then `401` (auth required). Kill the server after (find PID via `netstat -ano | grep :8000`, then `taskkill //F //PID <pid>`).

- [ ] **Step 3: Append "Forward notes for Plans 3+" to this plan doc**

Start from this seed list and add anything learned during execution:

```markdown
## Forward notes for Plans 3+ (from Plan 2 execution)

- **NET WORTH ≠ SUM(balances)** (Plan 3): the sheet's component accounts overlap —
  Fidelity Traditional 401(k) = Employer Match + Reverse Rollover + Traditional 401(k);
  Fidelity Roth 401(k) = Roth Basic + After-Tax. The sheet's own NET WORTH column excludes
  some component columns. Plan 3's net-worth rollup must decide: exclude component accounts
  (add an is_component flag or deactivate them) or reproduce the sheet's exclusion set.
  Verify against sheet cells before shipping the chart.
- Spending data ends 2025-12 (2026 rows empty in the sheet); the wizard (Plan 3) starts
  fresh from 2026-01.
- dividend_payments: importer is warn-only (sheet stores no payment dates and all current
  cells are 0) — sanctioned deviation from spec §5's "aggregate entries". Plan 4's UI is
  the only dividend entry path.
- latest_prices: importer seeds insert-only with source='manual'; the Plan 4 price service
  owns all updates. Never make the importer update prices.
- position_transactions ownership contract (Plan 4): importer-owned rows have
  sort_index > 0 (sheet row × 10) and are synced (incl. deletes) on re-import; UI-created
  rows MUST keep sort_index 0 (default) or they will be deleted by the next import.
  Folding orders by (sort_index, id) — UI rows therefore fold before... verify: sort_index 0
  sorts FIRST, i.e. UI rows fold BEFORE all imported rows. If UI entry lands before
  cutover, revisit (e.g. assign max+10 and exempt them from sync by a source flag).
- Cost-basis cent drift (Plan 4 reconciliation): shares quantized to 6 dp and prices to
  4 dp make recomputed cost basis differ from sheet Transacted Value by up to ~$0.10 on
  401(k) fund rows — compare with tolerance, not equality.
- espp_periods dates and labels are DERIVED (sheet stores none); paycheck_profiles
  effective_date is DERIVED (Jan 1 of latest focal year with a New Base). Plan 5's UIs
  must let the user edit both.
- The ESPP "Taxation Calculator" block is a hypothetical what-if — never import it as a
  sale. Evidence: Positions NVDA = all four lots + the modeled next purchase; realized
  G/L 0 everywhere; ESPP Sale Component 0 in all tax years.
- Taxes re-import: sheet wins within imported years (values overwritten, stray
  inputs/brackets deleted); years absent from the sheet are never touched. Plan 5's
  bracket editor edits will be clobbered by a re-import of the same year — cutover order
  matters (import first, then edit).
- tax_inputs.value is now Numeric(14,4); the two extra defs (state_standard_deduction,
  state_exemption_credits) carry CA engine data the sheet keeps in its STATE bracket block.
- client.ts still has no timeout/AbortSignal (deferred to Plan 3 with the real pages).
- vitest pinned to major 3 for local Node 18.12; revisit when Node is upgraded to 22 LTS.
```

- [ ] **Step 4: Self-review the diff and commit**

```bash
git add docs/superpowers/plans/2026-08-13-plan-2-importer.md
git commit -m "docs: Plan 2 forward notes for Plans 3+"
git log --oneline main..HEAD
```
Expected: ~16 commits, each scoped as above.

---

## Definition of done (Plan 2)

- `pytest -W error` green: all Plan 1 tests plus cells/parsers/apply/service/endpoint/seed suites (~95 tests total).
- `ruff check` + `ruff format --check` (backend), `npm run lint` + `npm test` + `npm run build` (frontend) all clean; CI green on all three jobs after merge, including the new `alembic downgrade base && upgrade head` round-trip and `npm test` steps.
- Real workbook imported into the dev DB via the CLI: dry-run counts reviewed, apply transactional, second dry-run all-skips (idempotent on real data), spot-checks reconciled (Task 15 results recorded, no personal values committed).
- Upload endpoint live behind auth: dry-run default true, 400 on non-xlsx, 413 oversize, report JSON matches the CLI's.
- The importer never stores derived values, never touches user-owned fields, and reports every quirk normalization as a warning.
- Plan doc carries the filled reconciliation results and Forward notes for Plans 3+.
