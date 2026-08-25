# CA Capital-Gains State-Tax Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the biggest wrong-money bug in the dashboard: California taxes capital gains and all dividends as **ordinary income**, but `compute_breakdown`'s `state_agi` is built from `fed_agi`, which excludes `ltcg_total` / `qualified_dividends` / `other_capital_gains` — so every long-term-gain dollar understates state tax by ~9.3–10.3% at this income level, and the what-if panel answers "Δ state ≈ $0" for long-term sales. The fix is two moves inside one pure function — hoist the existing capital-gains netting above the state section, and add `+ cg_amount` to `state_agi` — applied to **all years, unconditionally** (the spec's decision log: no per-year toggle, no year gate), plus honest reconciliation of every golden pin the shift touches and documentation of the fifth model-vs-sheet divergence (the app is right; the sheet was wrong in every year).

**Architecture:** One definition of taxable gains, two consumers. `cg_amount` (the sheet's rows-118-120 netting — the rules themselves are UNTOUCHED) moves above the state section and joins `state_agi = fed_agi − treasury_exemption + hsa_addbacks + cg_amount`; the federal CG stack keeps consuming the same variable where it always did. No schema change, no API change, no migration: the Taxes summary, multi-year trend, what-if sandbox and withholding tracker all call `compute_breakdown` and inherit the fix through `state_ti`, state tax, the state effective rate (its denominator `state_agi` grows too), `total_tax`, `take_home` and the overall effective rate. The blast radius is fully enumerated in this plan from a complete read of both tax test suites: three golden years shift (2023/2024/2025 carry CG; **2026 is the zero-gains control and must not move**), the 2025 sheet-drift pin flips meaning (the sheet's CG-in-fed-AGI drift had pushed the gains into its state chain, so its 2025 state figures now agree with the app *by accident*), and 2024 stops being sheet-exact on the state chain only. The CG carriers, by name, in `test_tax_service.py`'s `_INPUT_TABLE`: 2023 `ltcg_total = -670` + `qualified_dividends = 129` (loss dropped → `cg_amount = 129`); 2024 `qualified_dividends = 179.13` (→ `179.13`); 2025 `ltcg_total = 536.38` + `qualified_dividends = 719.81` + `other_capital_gains = 11` (→ `1267.19`); 2026 all three zero (→ `0`). Out of scope, unchanged, already documented as unmodeled: the $3k capital-loss cap and carryforward; NIIT as a computed jurisdiction; treasury-exempt portions of *qualified* dividends.

**Tech Stack:** FastAPI + SQLAlchemy 2 async + Postgres 16 (real-DB pytest). Pure-engine change — no new dependencies, no Alembic revision, no frontend work (`src/` renders wire strings verbatim and its test fixtures are hand mocks, not engine outputs).

**Spec:** `docs/superpowers/specs/2026-08-25-five-feature-batch-design.md` §1 ("CA capital-gains fix") — cite it for any ambiguity. This plan implements §1 ONLY; the other four features in that spec are separate workstreams, and the spec's Status line is left alone (it covers all five).

**Overnight protocol:** work happens in the MAIN checkout on branch `ca-cg-state-tax` (the orchestrator creates the branch; Task 0 verifies a clean `git status` and the branch name). Backend venv is `backend/.venv` (Windows: `.venv/Scripts/python`); dev Postgres on localhost:5433 (`cd backend && docker compose up -d db` if down). **Backend + README only — do not touch `src/`.** No file deletions. Never push. Frequent small commits — with one sanctioned exception: the engine change and its golden-pin updates land as ONE atomic commit (Task 4), because the pins and the engine cannot both be green apart.

**House rules that bind every task:** GETs never reject stored data; server sentences render verbatim; Decimal strings on the wire; plain quantize on read paths; `+ ZERO` on wire-bound Decimals; comments explain constraints, not narration.

**Golden-pin discipline (binds Tasks 3–4):** never blind-update a snapshot. Every shifted pin is re-derived by the Task 3 oracle — fixture literals plus the `walk`/`stack` primitives only, `compute_breakdown` never imported, so the fix cannot vouch for itself — and the state leg must equal `walk(state_table, old_state_ti + cg_amount) − walk(state_table, old_state_ti)` before anything is pasted. The plan carries the author's hand-derived expected values as cross-checks; **the snippet output is authoritative** — on any mismatch, trust the snippet, re-derive by hand, and record the discrepancy in the final report.

---

## File structure

| File | Responsibility |
|---|---|
| `backend/app/services/tax_service.py` | Move the CG netting above the state section; `+ cg_amount` term in `state_agi`; module docstring + section comments record the divergence |
| `backend/tests/test_tax_service.py` | Two new regression tests; `_CANONICAL_TABLE` reconciliation (2023/2024/2025 columns); `test_golden_2024_equals_sheet_cached_values` + `test_sheet_drift_2025_cg_in_agi` reworks; `test_negative_state_tax_warning` literal; module-docstring amendment |
| `backend/tests/test_taxes_api.py` | What-if Δ-state pin (new assertions); `test_summary_2024_*` + `test_all_years_summary_*` pin updates; module-docstring amendment |
| `README.md` | §7.5 "Verify before trusting" Taxes row + the five-divergences paragraph; §7.7 "four tax drifts" sentence |

**Deliberately untouched (verified in the pre-plan reading):** `backend/tests/test_tax_whatif.py` (pure scenario math — no engine breakdowns); `backend/tests/test_withholding_api.py` + `test_withholding_calc.py` (their seeds carry NO CG keys, so `cg_amount = 0` and the `"115753.20"` liability pin is inert — Task 4 proves it by running them); `backend/app/api/taxes.py` and `backend/app/schemas/taxes.py` (serialization only); everything under `src/`.

---

## Phase 0 — Environment & branch verification

### Task 0: Verify the checkout the orchestrator prepared

**Files:** none (environment only)

- [x] **Step 1: Confirm the branch and a clean tree.**

```bash
git status --porcelain   # expected: EMPTY output
git rev-parse --abbrev-ref HEAD   # expected: ca-cg-state-tax
```

If the branch is wrong or the tree is dirty, STOP and report — do not "fix" it by switching or stashing; the orchestrator owns branch setup.

- [x] **Step 2: Backend smoke test** (proves the venv + the 5433 dev Postgres answer).

Run: `cd backend && .venv/Scripts/python -m pytest tests/test_health.py -q`
Expected: PASS. If it errors on connection, bring the container up (`cd backend && docker compose up -d db`) and retry once; if it still fails, read `backend/app/config.py` for the dev DATABASE_URL default before proceeding — do not guess.

- [x] **Step 3: Baseline the whole backend suite** (this is the count Task 6 is judged against). **N = 853 passed.**

Run: `cd backend && .venv/Scripts/python -m pytest -q`
Expected: ALL PASS. **Record the passed count** — call it N. (Task 6 must end at exactly N + 2: the two new regression tests; every other change edits existing tests in place.)

---

## Phase 1 — The fix, test-first

### Task 1: Write the failing regression tests (both suites)

The spec's own test mandate: "a dedicated regression test asserting state tax includes `cg_amount` (two otherwise-identical input sets differing only in `ltcg_total` must differ in state tax by `walk(state_table, …)` on the increment)" — plus the user-visible symptom pinned at the API layer (Δ state must move for a long sale).

**Files:**
- Test: `backend/tests/test_tax_service.py`, `backend/tests/test_taxes_api.py`

- [x] **Step 1: Write the two failing engine tests.** In `backend/tests/test_tax_service.py`, insert at the END of the "Canonical goldens" section — immediately BEFORE the `# Sheet drift pins (D1-D3)` banner comment (after `test_capital_gains_stack_clamps_a_negative_taxable_income`). Everything referenced (`YEARS`, `YEAR_INPUTS`, `YEAR_BRACKETS`, `breakdown_for`, `compute_breakdown`, `walk`, `Decimal`) is already imported/defined at module level; no import edits needed.

```python
def test_state_agi_carries_cg_amount_every_year():
    """CA taxes capital gains and ALL dividends as ordinary income (2026-08-25 spec §1):
    state AGI = fed AGI - treasury slice + HSA addbacks + cg_amount, in EVERY year,
    unconditionally — the same netted quantity the federal CG stack taxes, never a second
    definition. 2026 rides along as the zero-gains control: its state chain must not move."""
    for year in YEARS:
        breakdown = breakdown_for(year)
        values = YEAR_INPUTS[year]
        assert breakdown.state.agi == (
            breakdown.federal.agi
            - values["unq_div_us_treasuries_etf"] * values["unq_div_state_exempt_pct"]
            + values["hsa_contributions"]
            + values["hsa_contributions_employer"]
            + breakdown.capital_gains.gains_amount
        ), year


def test_state_tax_walks_the_capital_gains_increment():
    """Two input sets identical except ltcg_total: state tax must differ by EXACTLY the
    state-bracket walk over the cg_amount increment (the fix's contract, spec §1), while
    the federal income chain stays put — CG never enters fed AGI."""
    increment = Decimal("10000")
    base = dict(YEAR_INPUTS[2025])
    bumped = base | {"ltcg_total": base["ltcg_total"] + increment}
    before = compute_breakdown(2025, base, YEAR_BRACKETS[2025])
    after = compute_breakdown(2025, bumped, YEAR_BRACKETS[2025])

    # The netting rules are unchanged: a bigger long-term gain lands 1:1 on cg_amount...
    assert after.capital_gains.gains_amount - before.capital_gains.gains_amount == increment
    # ...and 1:1 on the state chain ALONE.
    assert after.federal.agi == before.federal.agi
    assert after.federal.tax == before.federal.tax
    assert after.state.agi - before.state.agi == increment
    assert after.state.taxable_income - before.state.taxable_income == increment
    expected = walk(
        YEAR_BRACKETS[2025]["state"], before.state.taxable_income + increment
    ) - walk(YEAR_BRACKETS[2025]["state"], before.state.taxable_income)
    assert expected > 0
    assert after.state.tax - before.state.tax == expected
```

- [x] **Step 2: Run to verify failure** — `cd backend && .venv/Scripts/python -m pytest tests/test_tax_service.py -q`
Expected: **2 failed, 50 passed**. `test_state_agi_carries_cg_amount_every_year` fails on year 2023 (state AGI is 129 short of the identity); `test_state_tax_walks_the_capital_gains_increment` fails at `after.state.agi - before.state.agi == increment` (`0 != 10000` — the gains never reach the state today). Any OTHER failure means the checkout is not the expected baseline: STOP and report.

- [x] **Step 3: Write the failing what-if assertion.** In `backend/tests/test_taxes_api.py`, inside `test_what_if_long_sale_moves_ltcg_and_delta`, insert directly AFTER the `delta["take_home"]` assertion block and BEFORE the `# Nothing about the sale reached the stored year.` comment:

```python
    # The 2026-08-25 CA-CG fix's user-visible symptom: a long-term sale must move STATE
    # tax too — the panel can never again answer "Δ state ≈ $0" for a long sale.
    assert Decimal(body["delta"]["state_tax"]) == Decimal(
        body["scenario"]["state"]["tax"]
    ) - Decimal(body["baseline"]["state"]["tax"])
    assert Decimal(body["delta"]["state_tax"]) > 0
```

(The equality clause follows the test's own "the delta is the two RENDERED figures subtracted" pattern — `api/taxes.py` builds deltas from the `_summary_out` results, so quantized-minus-quantized is the exact contract.)

- [x] **Step 4: Run to verify failure** — `cd backend && .venv/Scripts/python -m pytest tests/test_taxes_api.py::test_what_if_long_sale_moves_ltcg_and_delta -q`
Expected: FAIL on the new `> 0` line — the delta is `"0.00"` today (the equality clause passes: 0 == 0). Everything else in the test unchanged and reaching the new lines.

- [x] **Step 5: Do NOT commit.** The tree is deliberately red; Tasks 2–4 turn it green and Task 4 carries the one atomic commit.

### Task 2: The engine change + engine documentation

**Files:**
- Modify: `backend/app/services/tax_service.py`

- [x] **Step 1: Hoist the netting, feed the state.** Two edits in `compute_breakdown`.

**Edit A** — CUT the capital-gains netting block from its current home (between the SDI lines and `cg_tax = stack(...)`; currently ~lines 313–322):

```python
    # Capital gains (rows 118-120): a long-term LOSS nets against gains only while the net
    # stays positive; otherwise the sheet drops it (its deduction line never reaches AGI).
    ltcg = values["ltcg_total"]
    netted = ltcg + values["qualified_dividends"] + values["other_capital_gains"]
    if ltcg > 0:
        cg_amount = netted
    elif ltcg < 0 and netted > 0:
        cg_amount = netted
    else:
        cg_amount = values["qualified_dividends"] + values["other_capital_gains"]
```

and leave the `cg_tax` line behind with a replacement comment (the block comment moved away with the netting):

```python
    # The federal CG stack (row 120): cg_amount was netted above the state section, which
    # shares it; the gains stack on top of federal taxable income.
    cg_tax = stack(tables["capital_gains"], fed_ti, cg_amount)
```

**Edit B** — PASTE the netting between `fed_tax` and the state section, and rewrite the state block. The full resulting region, from `fed_deduction` down to `state_tax` (netting comment gains one sentence; the netting LOGIC is byte-identical; the state comment explains the new term; `state_ti`/`state_tax` lines unchanged):

```python
    fed_deduction = max(values["standard_deduction"], values["itemized_deduction"])
    fed_ti = fed_agi - fed_deduction
    fed_tax = walk(tables["federal"], fed_ti)

    # Capital gains (rows 118-120): a long-term LOSS nets against gains only while the net
    # stays positive; otherwise the sheet drops it (its deduction line never reaches AGI).
    # Netted here, above the state section, because state AGI consumes cg_amount too; the
    # federal CG stack itself is applied after FICA, where the sheet computes it.
    ltcg = values["ltcg_total"]
    netted = ltcg + values["qualified_dividends"] + values["other_capital_gains"]
    if ltcg > 0:
        cg_amount = netted
    elif ltcg < 0 and netted > 0:
        cg_amount = netted
    else:
        cg_amount = values["qualified_dividends"] + values["other_capital_gains"]

    # State (rows 100-103): CA exempts the treasury slice of unqualified dividends and
    # does NOT recognise the HSA deduction, so both are added back — and, deliberately
    # unlike the sheet (whose state chain dropped them in EVERY year), state AGI carries
    # cg_amount: California taxes capital gains and all dividends as ordinary income
    # (2026-08-25 spec §1). One definition of taxable gains, two consumers — this term and
    # the federal stack below.
    state_agi = (
        fed_agi
        - values["unq_div_us_treasuries_etf"] * values["unq_div_state_exempt_pct"]
        + values["hsa_contributions"]
        + values["hsa_contributions_employer"]
        + cg_amount
    )
    state_ti = state_agi - values["state_standard_deduction"]
    state_tax = walk(tables["state"], state_ti) - values["state_exemption_credits"]
```

- [x] **Step 2: Record the divergence in the module docstring**, with the same precedent framing the docstring already uses. Replace the paragraph

```
The canonical model is the clean shape the workbook's own "Total Income" row uses in every
year, which is also 2024's whole column. The other three year-columns carry hand-edit
drift (a stray literal, capital gains folded into AGI, a stale hardcoded deduction);
`backend/tests/test_tax_service.py` pins the canonical outputs AND reproduces each drifted
sheet value to the cent, so no divergence is accidental. Precedent: Plan 3's savings-rate
line and Plan 4's Unrealized column shipped the principled formula the same way.
```

with

```
The canonical model is the clean shape the workbook's own "Total Income" row uses in every
year (2024's whole column follows it), plus one deliberate correction the sheet made in NO
year: state AGI carries `cg_amount`, because California taxes capital gains and all
dividends as ordinary income and the sheet's state chain silently dropped them (2026-08-25
spec §1 — for a CG year the app's state tax is >= the sheet's, on purpose, in every year
unconditionally). The other three year-columns also carry hand-edit drift (a stray
literal, capital gains folded into AGI, a stale hardcoded deduction);
`backend/tests/test_tax_service.py` pins the canonical outputs AND reproduces each
drifted/divergent sheet value to the cent, so no difference is accidental. Precedent:
Plan 3's savings-rate line and Plan 4's Unrealized column shipped the principled formula
over the sheet's the same way.
```

- [x] **Step 3: Run the regression tests** — `cd backend && .venv/Scripts/python -m pytest tests/test_tax_service.py::test_state_agi_carries_cg_amount_every_year tests/test_tax_service.py::test_state_tax_walks_the_capital_gains_increment tests/test_taxes_api.py::test_what_if_long_sale_moves_ltcg_and_delta -q`
Expected: **3 passed**.

- [x] **Step 4: Enumerate the golden fallout — it must be EXACTLY this list.** Run `cd backend && .venv/Scripts/python -m pytest tests/test_tax_service.py tests/test_taxes_api.py -q`.

Expected failures in `test_tax_service.py` (**6 failed, 46 passed**):
1. `test_golden_2023` — `assert_canonical` trips on `state_agi` (2023 carries `cg_amount = 129`);
2. `test_golden_2024` — same, `cg_amount = 179.13`;
3. `test_golden_2024_equals_sheet_cached_values` — the five `rendered` (state-chain) quantities no longer sit within 1e-4 of the sheet's cached cells;
4. `test_golden_2025` — same as 1–2, `cg_amount = 1267.19`;
5. `test_sheet_drift_2025_cg_in_agi` — `drifted_state_ti = breakdown.state.taxable_income + doubled` now double-counts the 1267.19 (canonical state TI already carries it), so the 20257.18732 comparison and the 117.85 delta both fail;
6. `test_negative_state_tax_warning` — the pre-credit walk grew by 16.65909, so the `15884.46 + 149 - 1000000` literal is stale.

Expected failures in `test_taxes_api.py` (**exactly 2**):
1. `test_summary_2024_matches_the_sheet` — the state block and the totals block;
2. `test_all_years_summary_skips_input_less_years` — the `"72739.17"` total-tax string.

Everything else in both files must PASS — in particular `test_golden_2026` (the zero-gains control), `test_effective_rates_are_full_precision_ratios` (identities move with both sides), `test_capital_gains_amount_branches` (netting untouched), `test_summary_2026_has_no_gains_so_no_capital_gains_rate`, `test_summary_never_serializes_a_signed_zero`, `test_summary_guards_absurd_but_legal_inputs` (no CG keys stored → `cg_amount = 0`), and `test_what_if_empty_scenario_echoes_baseline` (relative). **A failure outside this list means the edit changed more than the state term — STOP and use superpowers:systematic-debugging before touching any pin.**

- [x] **Step 5: Do NOT commit** (still red by design).

### Task 3: Independently verify every shifted pin, then reconcile `test_tax_service.py`

**Files:**
- Modify: `backend/tests/test_tax_service.py`

- [x] **Step 1: Run the oracle.** It rebuilds every shifted quantity from fixture literals plus `walk`/`stack` alone (each primitive has its own untouched unit pins; `compute_breakdown` is never imported), prints the required delta check `walk(state, old_ti + cg) − walk(state, old_ti)`, and recomputes the new totals from scratch so no new pin leans on an old rounded one:

```bash
cd backend && .venv/Scripts/python - <<'EOF'
# Independent oracle for the CA-CG pin reconciliation (2026-08-25 spec §1).
from decimal import ROUND_HALF_UP, Decimal

from app.services.money import quantize_pct
from app.services.tax_service import stack, walk
from tests.test_tax_service import YEAR_BRACKETS, YEAR_INPUTS

CENT = Decimal("0.01")


def cents(value):
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


for year in (2023, 2024, 2025, 2026):
    v = YEAR_INPUTS[year]
    t = YEAR_BRACKETS[year]
    fed_agi = (
        v["latest_w2_income"] + v["other_w2_income"] + v["stcg_total"]
        + v["unqualified_dividends"] + v["interest_total"] + v["other_income_1099"]
    ) - (
        v["trad_401k_contributions"] + v["hsa_contributions"]
        + v["hsa_contributions_employer"] + v["other_pretax_deductions"]
    )
    fed_ti = fed_agi - max(v["standard_deduction"], v["itemized_deduction"])
    fed_tax = walk(t["federal"], fed_ti)
    # The (unchanged) netting rules, transcribed from the sheet's rows 118-120:
    ltcg = v["ltcg_total"]
    netted = ltcg + v["qualified_dividends"] + v["other_capital_gains"]
    if ltcg > 0 or (ltcg < 0 and netted > 0):
        cg = netted
    else:
        cg = v["qualified_dividends"] + v["other_capital_gains"]
    old_agi = (
        fed_agi
        - v["unq_div_us_treasuries_etf"] * v["unq_div_state_exempt_pct"]
        + v["hsa_contributions"] + v["hsa_contributions_employer"]
    )
    old_ti = old_agi - v["state_standard_deduction"]
    # THE required check: the state shift is exactly one bracket walk over the increment.
    delta = walk(t["state"], old_ti + cg) - walk(t["state"], old_ti)
    new_state_tax = walk(t["state"], old_ti + cg) - v["state_exemption_credits"]
    # The untouched legs, recomputed so the new totals never lean on an old rounded pin:
    w2 = v["latest_w2_income"] + v["other_w2_income"]
    medicare_wages = w2 - (
        v["hsa_contributions"] + v["hsa_contributions_employer"] + v["other_pretax_deductions"]
    )
    medicare_tax = walk(t["medicare"], medicare_wages)
    top_rate, top_threshold = max(t["social_security"], key=lambda bracket: bracket[1])
    ss_wages = (
        min(medicare_wages, top_threshold)
        if len(t["social_security"]) > 1 and top_rate == 0
        else medicare_wages
    )
    ss_tax = walk(t["social_security"], ss_wages)
    sdi_tax = walk(t["disability"], w2 - v["other_pretax_deductions"])
    cg_tax = stack(t["capital_gains"], fed_ti, cg)
    gross = (
        v["latest_w2_income"] + v["other_w2_income"] + v["stcg_standard"]
        + v["unqualified_dividends"] + v["interest_total"] + v["other_income_1099"]
        + v["ltcg_brokerage"] + v["qualified_dividends"] + v["other_capital_gains"]
    )
    total_tax = fed_tax + new_state_tax + medicare_tax + ss_tax + sdi_tax + cg_tax
    print(f"{year}: cg_amount={cg}  state_delta={delta.normalize()}  (cents {cents(delta)})")
    print(f"  state_agi {cents(old_agi + cg)}  state_ti {cents(old_ti + cg)}"
          f"  state_tax {cents(new_state_tax)}")
    print(f"  total_tax {cents(total_tax)}  take_home {cents(gross - total_tax)}")
    if year == 2024:
        print(f"  state_rate {quantize_pct(new_state_tax / (old_agi + cg))}"
              f"  total_rate {quantize_pct(total_tax / gross)}")
EOF
```

Expected output — the author's hand derivation; **the run is authoritative** (full-precision deltas are `normalize()`d, so they print without trailing zeros):

```
2023: cg_amount=129  state_delta=11.997  (cents 12.00)
  state_agi 119875.28  state_ti 114512.28  state_tax 7158.49
  total_tax 34319.05  take_home 92002.18
2024: cg_amount=179.13  state_delta=16.65909  (cents 16.66)
  state_agi 215301.15  state_ti 209761.15  state_tax 15901.12
  total_tax 72755.83  take_home 165217.34
  state_rate 0.073855  total_rate 0.305731
2025: cg_amount=1267.19  state_delta=117.84867  (cents 117.85)
  state_agi 263400.08  state_ti 257694.08  state_tax 20257.19
  total_tax 90050.76  take_home 197158.30
2026: cg_amount=0  state_delta=0  (cents 0.00)
  state_agi 284428.21  state_ti 278722.21  state_tax 22206.80
  total_tax 98584.56  take_home 208109.47
```

Sanity anchors before proceeding: each `state_delta` must equal `cg_amount × 0.093` (all six old/new taxable incomes sit inside the 9.3% bracket — 2023: 68,350–349,137; 2024: 70,607–360,659; 2025: 72,724–371,479 — so no boundary is crossed); the 2026 row must be byte-identical to the CURRENT canonical column; and 2025's new `state_tax 20257.19` should ring a bell — it is the very figure the old drift pin compared against `20257.18732` (the sheet's cached cell), which is exactly WHY Task 3 Step 4 rewrites that pin. If any printed value disagrees with the block above, the snippet wins: use its values in every edit below and record the discrepancy in the final report.

- [x] **Step 2: Update `_CANONICAL_TABLE`** — five rows, columns are (2023, 2024, 2025, 2026); ONLY the first three columns move, and only on the state-chain rows. Replace:

```python
    "state_agi": ("119746.28", "215122.02", "262132.89", "284428.21"),
    "state_ti": ("114383.28", "209582.02", "256426.89", "278722.21"),
    "state_tax": ("7146.50", "15884.46", "20139.34", "22206.80"),
```

with (values from Step 1's output):

```python
    "state_agi": ("119875.28", "215301.15", "263400.08", "284428.21"),
    "state_ti": ("114512.28", "209761.15", "257694.08", "278722.21"),
    "state_tax": ("7158.49", "15901.12", "20257.19", "22206.80"),
```

and replace:

```python
    "total_tax": ("34307.05", "72739.17", "89932.91", "98584.56"),
    "take_home": ("92014.18", "165234.00", "197276.15", "208109.47"),
```

with:

```python
    "total_tax": ("34319.05", "72755.83", "90050.76", "98584.56"),
    "take_home": ("92002.18", "165217.34", "197158.30", "208109.47"),
```

(All other `_CANONICAL_TABLE` rows — fed chain, FICA, `cg_amount`, `cg_tax`, `gross_income` — are untouched by construction; if Step 7's run says otherwise, STOP.)

- [x] **Step 3: Rework `test_golden_2024_equals_sheet_cached_values`** — 2024's state chain is no longer sheet-equal; pin it as *sheet value + the fix's delta* so the divergence stays exact rather than becoming a blind new number. Replace the whole function with:

```python
def test_golden_2024_equals_sheet_cached_values():
    """2024 is the drift-free column, so canonical == sheet — EXCEPT the state chain.

    The five state-chain quantities diverge by exactly the CA capital-gains fix
    (2026-08-25 spec §1: state AGI carries cg_amount; the sheet's never did), so they are
    pinned as the sheet's cached value PLUS the fix's delta — the divergence itself stays
    exact. Everything else is the cached cell: bit-exact where no product is involved,
    within 1e-4 where one is (cached cells are 10-significant-figure float renderings).
    """
    breakdown = breakdown_for(2024)
    produced = actuals(breakdown)
    exact = {
        "fed_agi": "211776.2",
        "fed_ti": "197176.2",
        "fed_tax": "40782.884",
        "medicare_tax": "3634.94981",
        "ss_tax": "10453.2",
        "sdi_tax": "1950",
        "cg_amount": "179.13",
        "cg_tax": "33.67644",
        "gross_income": "237973.17",
    }
    for quantity, cached in exact.items():
        assert produced[quantity] == Decimal(cached), quantity
    assert breakdown.totals.total_income == Decimal("211776.2")
    assert breakdown.medicare.taxable_wages == Decimal("231274.46")
    assert breakdown.social_security.taxable_wages == Decimal("168600")
    assert breakdown.disability.taxable_wages == Decimal("235424.46")

    # The state chain vs the sheet: AGI/TI sit exactly cg_amount above the cached cells,
    # and the three money outcomes exactly one 9.3%-bracket walk above/below — the
    # documented direction (the app's state tax >= the sheet's for a CG year).
    cg = Decimal("179.13")
    state_delta = walk(YEAR_BRACKETS[2024]["state"], produced["state_ti"]) - walk(
        YEAR_BRACKETS[2024]["state"], produced["state_ti"] - cg
    )
    assert state_delta == cg * Decimal("0.093")  # no bracket boundary crossed
    sheet = {
        "state_agi": (Decimal("215122.0164"), cg),
        "state_ti": (Decimal("209582.0164"), cg),
        "state_tax": (Decimal("15884.45652"), state_delta),
        "total_tax": (Decimal("72739.16677"), state_delta),
        "take_home": (Decimal("165234.0032"), -state_delta),
    }
    for quantity, (cached, delta) in sheet.items():
        assert abs(produced[quantity] - (cached + delta)) < Decimal("0.0001"), quantity
```

- [x] **Step 4: Rework `test_sheet_drift_2025_cg_in_agi`** — the federal half is still the drift; the state half flipped from "drift" to "accidental agreement" (the sheet reached state AGI *through* its inflated fed AGI, which is numerically the same +1267.19 the fix adds on purpose). Replace the whole function with:

```python
def test_sheet_drift_2025_cg_in_agi():
    """2025 r96 adds LTCG + qualified dividends + other CG into fed AGI, contradicting its
    own r122 and double-taxing gains that the CG stack already charges. The FEDERAL chain
    is still the drift; the state chain it feeds stopped being one — the canonical model
    now adds cg_amount to state AGI on purpose (2026-08-25 spec §1), so the sheet's 2025
    state figures agree with the app by accident: right answer, wrong door."""
    breakdown = breakdown_for(2025)
    doubled = Decimal("1267.19")

    drifted_agi = breakdown.federal.agi + doubled
    assert drifted_agi == Decimal("260643.24")  # sheet r96c5
    drifted_ti = drifted_agi - (breakdown.federal.agi - breakdown.federal.taxable_income)
    assert drifted_ti == Decimal("233429.958")  # sheet r97c5
    drifted_tax = walk(YEAR_BRACKETS[2025]["federal"], drifted_ti)
    assert drifted_tax == Decimal("51760.58656")  # sheet r98c5
    assert cents(drifted_tax - breakdown.federal.tax) == Decimal("405.50")  # 1267.19 × .32

    # The sheet's state chain, rebuilt from ITS drifted fed AGI, lands exactly on the
    # canonical one — both add the same 1267.19 (the sheet through fed AGI, the app
    # through the deliberate cg_amount term), so the old +117.85 state drift is retired.
    values = YEAR_INPUTS[2025]
    sheet_state_ti = (
        drifted_agi
        - values["unq_div_us_treasuries_etf"] * values["unq_div_state_exempt_pct"]
        + values["hsa_contributions"]
        + values["hsa_contributions_employer"]
        - values["state_standard_deduction"]
    )
    assert sheet_state_ti == breakdown.state.taxable_income
    sheet_state_tax = (
        walk(YEAR_BRACKETS[2025]["state"], sheet_state_ti) - values["state_exemption_credits"]
    )
    assert sheet_state_tax == breakdown.state.tax
    assert abs(sheet_state_tax - Decimal("20257.18732")) < Decimal("0.001")  # sheet's cache
```

- [x] **Step 5: Update `test_negative_state_tax_warning`** — the literal is the 2024 canonical state tax, which moved. Change the one assertion line from

```python
    assert cents(breakdown.state.tax) == Decimal("15884.46") + Decimal("149") - Decimal("1000000")
```

to

```python
    assert cents(breakdown.state.tax) == Decimal("15901.12") + Decimal("149") - Decimal("1000000")
```

(15901.12 from Step 1's 2024 line; the `+ 149` still restores the pre-credit walk, and the huge credit still drives the result negative, so the warning assertions stand.)

- [x] **Step 6: Amend the module docstring** — the "sheet equality" bullet overpromises now. Replace:

```
* **sheet equality for 2024** — 2024 is the drift-free column, so its canonical values ARE
  the sheet's cached values (the cached cells are 10-significant-figure float renderings,
  so the five derived-from-a-product quantities match within 1e-4 rather than bit-exactly);
```

with:

```
* **sheet equality for 2024** — 2024 is the drift-free column, so its canonical values ARE
  the sheet's cached values everywhere but the state chain, which sits exactly one CA
  capital-gains divergence above them (2026-08-25 spec §1; pinned as sheet value + delta,
  the cached cells being 10-significant-figure float renderings compared within 1e-4);
```

- [x] **Step 7: Run** — `cd backend && .venv/Scripts/python -m pytest tests/test_tax_service.py -q` → **ALL PASS (52 tests)**. Do NOT commit yet (`test_taxes_api.py` is still red).

### Task 4: Reconcile `test_taxes_api.py`, prove the neighbors, commit

**Files:**
- Modify: `backend/tests/test_taxes_api.py`

- [x] **Step 1: Update `test_summary_2024_matches_the_sheet`.** Three edits, using Task 3 Step 1's 2024 line (`state_tax 15901.12`, `state_rate 0.073855`, `total_tax 72755.83`, `take_home 165217.34`, `total_rate 0.305731`):

1. Rename the function and give the divergence a voice — change the def line from `async def test_summary_2024_matches_the_sheet(auth_client, definitions):` to:

```python
async def test_summary_2024_matches_the_sheet_except_the_state_chain(auth_client, definitions):
    """The 2024 wire golden. Sheet-exact everywhere but the state chain, which carries the
    deliberate CA capital-gains divergence (2026-08-25 spec §1) — the engine-level
    sheet-vs-canonical deltas are pinned in test_tax_service.py; this test pins the
    quantized strings the client actually renders."""
```

2. Replace the state block:

```python
    assert body["state"] == {
        "agi": "215301.15",
        "taxable_income": "209761.15",
        "tax": "15901.12",
        "effective_rate": "0.073855",
    }
```

3. Replace the totals block:

```python
    assert body["totals"] == {
        "gross_income": "237973.17",
        "total_income": "211776.20",
        "total_tax": "72755.83",
        "take_home": "165217.34",
        "effective_rate": "0.305731",
    }
```

(Both new 6dp rates — `"0.073855"` and `"0.305731"` — come from the oracle's 2024 `state_rate` / `total_rate` line; confirm against your Task 3 Step 1 output before pasting. `gross_income`, `total_income`, and every federal/medicare/SS/SDI/capital-gains string in this test are untouched — if the Step 4 run flags one, the engine edit leaked.)

- [x] **Step 2: Update `test_all_years_summary_skips_input_less_years`** — change

```python
    assert body["years"][0]["totals"]["total_tax"] == "72739.17"
```

to

```python
    assert body["years"][0]["totals"]["total_tax"] == "72755.83"
```

- [x] **Step 3: Amend the module docstring** — its last sentence promises sheet cents. Replace:

```
the summary golden also proves the DB round-trip: Numeric(14,4) inputs and Numeric(7,4)/
Numeric(12,2) brackets come back at column scale and still land on the sheet's cents.
```

with:

```
the summary golden also proves the DB round-trip: Numeric(14,4) inputs and Numeric(7,4)/
Numeric(12,2) brackets come back at column scale and still land on the canonical cents
(the sheet's, except the documented CA capital-gains divergence on the state chain — see
test_tax_service.py).
```

- [x] **Step 4: Run the two edited suites** — `cd backend && .venv/Scripts/python -m pytest tests/test_tax_service.py tests/test_taxes_api.py -q` → **ALL PASS**.

- [x] **Step 5: Prove the neighbors inherit without edits** (the spec's "everything downstream" claim, demonstrated rather than asserted):

```bash
cd backend && .venv/Scripts/python -m pytest tests/test_tax_whatif.py tests/test_withholding_api.py tests/test_withholding_calc.py tests/test_models_taxes.py -q
```

Expected: ALL PASS with **zero edits to any of these files** — `test_tax_whatif.py` is pure scenario math (no breakdowns), and the withholding seeds carry no CG keys, so their `"115753.20"` liability pin sits on `cg_amount = 0`. If any of these fail, the engine edit leaked beyond the state term: STOP and debug, do not edit these files.

- [x] **Step 6: Ruff** — `cd backend && .venv/Scripts/python -m ruff check app tests` → clean; `cd backend && .venv/Scripts/python -m ruff format app tests` → if anything reformats, re-run Step 4's command and keep the reflow in this commit.

- [x] **Step 7: THE atomic commit** — `git add -A && git commit -m "fix(taxes): CA taxes capital gains as ordinary income - state AGI carries cg_amount (all years)"`
(One commit for engine + both test files: at no intermediate file boundary is the suite green, so splitting would commit red trees.)

---

## Phase 2 — Documentation

### Task 5: README §7.5 — the fifth documented divergence

**Files:**
- Modify: `README.md`

⚠ The README uses the true minus sign (U+2212) in "D1 −31.20" and friends, not an ASCII hyphen — copy each old string out of the file (or grep it) rather than retyping, or the Edit will not match.

- [x] **Step 1: The "Verify before trusting" Taxes row.** In §7.5's table, replace:

```
| Taxes | /taxes, year by year | 2024 matches the sheet **to the cent**; 2023 / 2025 / 2026 differ by four known drifts (below) |
```

with:

```
| Taxes | /taxes, year by year | 2024 matches the sheet **to the cent except the state chain** (the deliberate CA capital-gains divergence, below); 2023 / 2025 / 2026 additionally differ by the known sheet drifts (below) |
```

- [x] **Step 2: The divergence paragraph.** Replace:

```
**The four known tax drifts** — D1 −31.20; D2 +405.50 and +117.85; D3 +4,918.92/93 at cents.
Each is a place the sheet's own columns disagree with one another; the app is the
self-consistent model. **Do not "fix" these** — a reconciliation that makes them vanish has
introduced a bug, not removed one.
```

with:

```
**The five documented tax divergences** — the four sheet drifts, plus one deliberate model
fix. D1 −31.20; D2 +405.50 and +117.85; D3 +4,918.92/93 at cents — each a place the
sheet's own columns disagree with one another; the app is the self-consistent model. The
fifth is different in kind — **CA capital-gains taxation (2026-08-25)**: California taxes
capital gains and all dividends as ordinary income, and the sheet's state chain never
added them in ANY year, so here the app is right and the sheet was wrong. For a year
carrying LTCG / qualified dividends / other CG the app's state tax is **≥ the sheet's**:
+12.00 for 2023 and +16.66 for 2024 at the stored inputs; 2025's state figures now MATCH
the sheet, because D2's CG-in-AGI drift had pushed the gains into its state chain by
accident (its +117.85 state half now reads sheet-vs-its-own-formula, not sheet-vs-app);
2026 carries no gains and is unchanged. **Do not "fix" any of these** — a reconciliation
that makes them vanish has introduced a bug, not removed one.
```

- [x] **Step 3: Keep §7.7 coherent.** Replace (spans two lines in the file):

```
Judge every difference against 7.5: the After-Tax offset and the four tax drifts are
expected, anything else is not.
```

with:

```
Judge every difference against 7.5: the After-Tax offset and the five documented tax
divergences are expected, anything else is not.
```

- [x] **Step 4: Commit** — `git add -A && git commit -m "docs(readme): fifth documented tax divergence - CA capital-gains taxation"`

---

## Phase 3 — Verification

### Task 6: Full-suite verification (STOP here — the orchestrator merges)

**Files:** none

- [x] **Step 1: The ENTIRE backend suite** — **855 passed = N(853) + 2.** — `cd backend && .venv/Scripts/python -m pytest -q`
Expected: **ALL PASS**, and the passed count is exactly **Task 0's N + 2** (the two new regression tests; every other change edited assertions in place). Any other count means a test was accidentally added, deleted, or skipped — investigate before proceeding.

- [x] **Step 2: Ruff, final** — `cd backend && .venv/Scripts/python -m ruff check app tests` → clean; `cd backend && .venv/Scripts/python -m ruff format app tests` → no reformats (or commit the reflow with `git commit -m "style: ruff reflow"` and re-run Step 1).

- [x] **Step 3: Blast-radius audit** — `git diff --name-only main` must print EXACTLY these four paths and nothing else:

```
README.md
backend/app/services/tax_service.py
backend/tests/test_tax_service.py
backend/tests/test_taxes_api.py
```

(Plus this plan file only if the orchestrator committed it on this branch.) No migration, no `src/`, no deletions. Then `git status --porcelain` → EMPTY.

- [x] **Step 4: STOP.** Do not merge, do not push, do not delete anything — the orchestrator reviews and merges this branch. Leave a summary listing: the new state-chain pins per year (2023 +12.00, 2024 +16.66, 2025 +117.85 at cents, 2026 unchanged — or the oracle's values if they disagreed with the plan's hand derivation, flagged as such), the retirement of D2's +117.85 state half (sheet's 2025 state now agrees with the app), both suite counts (Task 0's N and the final N + 2), the zero-migration fact, and the reminder that the capital-loss cap / NIIT-as-jurisdiction / qualified-dividend treasury slices remain deliberately unmodeled.
