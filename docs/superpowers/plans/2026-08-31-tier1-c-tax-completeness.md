# Tier 1 Plan C: Tax Engine Completeness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four correctness gaps the 2026-08-31 audit found in the tax engine (spec Workstream C, items C1–C5, all decisions ratified — full fix, ALL years): (C1) one shared MAGI definition — extract the capital-gains netting into `_cg_amount` and add `_magi = _federal_agi + _cg_amount`; (C2) a real NIIT line — `3.8% × min(net investment income, max(0, MAGI − status threshold))` computed inside `compute_breakdown`, reported as its own `TaxBreakdown.niit` / `TaxSummaryOut.niit` section and included in `totals.total_tax` / `take_home`, with the sheet's folded CG bracket rates (18.8/23.8) normalized back to base rates (15/20) by a guarded data migration + an importer translation + a rewritten `niit_advisory` that flags leftovers; (C3) wire `capital_loss_deductions` into `_federal_agi` (state chain and MAGI inherit it) with two advisory warnings that never block a GET; (C4) the statutory lesser-of safe harbor — `min(prior-year 100/110% leg, 90% of the current year's liability)`, either leg standing alone; (C5) every moved golden updated with an in-test derivation comment (CA-CG precedent style) plus README §7.5 divergence entries. Historical totals move on purpose: 2024 total tax 72,755.83 → **72,824.61** and 2025 90,050.76 → **90,421.49**; 2023 and 2026 are the unchanged controls.

**Architecture:** Everything flows from `compute_breakdown` (pure Decimal, no DB), so the summary, trend feed, what-if sandbox, withholding tracker and Overview money-flow inherit the NIIT line and the capital-loss term through the one engine call they already share — the what-if endpoint needs **no change** (ratified; one test pins a scenario crossing the NIIT threshold). The NIIT line reuses `JurisdictionResult` (`gains_amount` = NII, `taxable_income` = the surcharged base) and the existing `CapitalGainsTaxOut` wire shape, so the schema/type additions are purely additive and optional-typed on the frontend (the house pattern from `brackets_missing_for_status`). Folded-rate normalization has three coordinated guards sharing one constant pair (`FOLDED_TO_BASE_CG` in `tax_service.py`): the migration rewrites exact stored `0.1880→0.1500` / `0.2380→0.2000` in `tax_brackets` where `jurisdiction='capital_gains'` (all years, all statuses; downgrade restores the pair with the same exact-match guard); the importer translates the same two exact rates on every apply with a per-row report warning; and the rewritten advisory warns whenever a folded rate is still stored. **Code-argued adjustments to the suggested task order:** (a) the engine NIIT line, the advisory rewrite and the test-fixture flip to base rates are ONE atomic task (Task 2) — the golden suite asserts `warnings == []` through `assert_canonical`, so folded fixtures + a new NIIT line would double-charge the interim goldens and the old AGI-comparison advisory would fire on base-rate fixtures; splitting them leaves no green midpoint; (b) golden updates land inside the task that moves them (the suite must be green after every task) — Task 11 is the derivation-comment audit + README, not the edits; (c) the Overview money-flow's `MoneyFlowTaxes` gains a `niit` field (backend Task 7, frontend Task 9) — discovered in reading: its Taxes-node tooltip enumerates the per-jurisdiction lines and would visibly stop summing to `taxes.total` otherwise. **Task 5→NIIT interaction, stated explicitly (prompt requirement):** after Task 5, `_federal_agi` includes `capital_loss_deductions`, so `_magi` — and therefore both the NIIT threshold test and the SALT phase-down — inherits the loss automatically. That is statutorily correct (the §1211 deduction is *inside* AGI) and is pinned by `test_capital_loss_pulls_magi_under_the_niit_threshold`.

**Tech Stack:** FastAPI + SQLAlchemy 2 async + Alembic + Postgres 16 (real-DB pytest via `create_all`, so migrations are smoke-tested against the dev DB, not pytest); pydantic v2 wire schemas (Decimal strings); React 19 + TS + ECharts frontend (vitest + jsdom). New Alembic revision `f7d3b2a91c40` chained onto `e4a7c92b6d18` (verify with `alembic heads` at Task 0 — spec instruction; **never re-chain deployed revisions**, README §4.3). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-31-tier1-trust-lifecycle-tax-planning-design.md` — Workstream C only. Cite it on any ambiguity; decisions are ratified, do not relitigate.

**Branch & protocol:** all work on **`tier1-batch`** (already carries Workstream A; Task 0 records the actual baselines). Backend venv is `backend/.venv` (`.venv/Scripts/python.exe`). Dev Postgres on localhost:5433 (`cd backend && docker compose up -d db` if down) — only the migration smoke needs it; pytest uses its own DB fixture. Never push. One commit per task (Task 2 is the sanctioned large atomic commit, per the CA-CG precedent: the engine change and its golden updates cannot both be green apart).

**House rules that bind every task:** GETs never reject stored data (both capital-loss warnings are advisory; values are used verbatim); server sentences render verbatim in the UI; Decimal strings on the wire; the summary serializer quantizes with the plain `_money`, never money.py's bounded quantizers; `+ ZERO` collapses signed zeros; comments explain constraints, not narration; ruff ≤ 99-char lines.

**Golden-pin discipline:** never blind-update a snapshot. Every literal in this plan was derived by running the *current* engine (`compute_breakdown` over the pinned fixtures with base-rate CG tables, NIIT added per the spec formula) — the derivations appear as in-test comments below and the implementer re-verifies each by running the quoted test. On any mismatch between this plan's literal and the engine's output: STOP, re-derive by hand from the fixture table, and record the discrepancy in the final report — do not paste whichever number makes the test pass.

---

## The derived goldens (the oracle table)

The formula set, encoded once (these definitions bind every task):

- `cg_amount` = the sheet's rows-118-120 netting (unchanged rules, now in `_cg_amount`).
- `MAGI` = `_federal_agi + cg_amount` (`_magi`); after Task 5, `_federal_agi` includes `capital_loss_deductions`.
- `NII` = `interest_total + unqualified_dividends + max(stcg_total, 0) + max(cg_amount, 0)`.
- `NIIT` = `0.038 × max(0, min(NII, MAGI − threshold))`, thresholds from the existing `NIIT_AGI_THRESHOLDS` (200000 single / 250000 MFJ / 125000 MFS; unknown status reads single's). The outer `max(0, ·)` is the belt for a pathological stored-negative NII (negative interest/dividends) — everywhere NII ≥ 0 it is byte-identical to the spec's `min(NII, max(0, excess))`.
- `totals.total_tax = fed + state + medicare + ss + sdi + cg + niit`; `take_home = gross_income − total_tax`.
- Capital-gains `JurisdictionResult` stays exactly as-is (base-rate stack over `fed_ti`).

Machine-verified outputs over the pinned `_INPUT_TABLE` with base-rate CG tables (`0/0.15/0.20`, same thresholds):

| quantity | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|
| fed_agi (unchanged) | 117726.64 | 211776.20 | 259376.05 | 280128.21 |
| cg_amount (unchanged) | 129.00 | 179.13 | 1267.19 | 0.00 |
| MAGI (full prec.) | 117855.64 | 211955.33 | 260643.24 | 280128.2067 |
| NII | 21250.15 | 1989.28 | 11023.28 | 0 |
| MAGI excess | 0 | 11955.33 | 60643.24 | 80128.2067 |
| NIIT base (min) | 0 | 1989.28 | 11023.28 | 0 |
| **niit** (cents) | **0.00** | **75.59** (75.59264) | **418.88** (418.88464) | **0.00** |
| **cg_tax** (cents) | 19.35 (unchanged) | **26.87** (26.8695) | **190.08** (190.07850) | 0.00 |
| **total_tax** (cents) | 34319.05 (unchanged) | **72824.61** | **90421.49** | 98584.56 (unchanged) |
| **take_home** (cents) | 92002.18 (unchanged) | **165148.56** | **196787.57** | 208109.47 (unchanged) |
| totals eff. rate (6dp) | 0.271681 (unchanged) | **0.306020** | **0.314828** | 0.321443 (unchanged) |

2024 NII derivation: 24.76 + 833.46 + 951.93 + 179.13 = 1989.28; 2025: 62.87 + 1653.14 + 8040.08 + 1267.19 = 11023.28; 2023: 20750.5 + 286.65 + 84 + 129 = 21250.15 (MAGI under threshold → 0). MFJ reference year (married suite, base-rate CG table): cg_tax 8460.00 → **6750.00** (45000 × 0.15, entirely inside the 100000–600000 tier), niit **1824.00** (NII 48000 = 2000 + 1000 + 0 + 45000; MAGI 311500 → excess 61500 over 250000; NII binds), total **93943.85**, take-home **254056.15**.

---

## File structure

| File | Responsibility |
|---|---|
| `backend/app/services/tax_service.py` | `_cg_amount`/`_magi` helpers; NIIT constants + line + `TaxBreakdown.niit`; `niit_advisory` rewrite; `capital_loss_deductions` into `ENGINE_INPUT_KEYS`/`_federal_agi` + two warnings; SALT MAGI switch; docstring divergence notes |
| `backend/alembic/versions/20260831_0900_f7d3b2a91c40_unfold_niit_capital_gains_rates.py` | NEW guarded data migration (exact folded→base rewrite; guarded downgrade) |
| `backend/app/importer/apply.py` | Folded→base translation in the brackets loop + per-row report warning; stale `capital_loss_deductions` comment fix rides along |
| `backend/app/schemas/taxes.py` | `TaxSummaryOut.niit`; `SafeHarborOut` restructure (nullable prior leg + `current_year_threshold` + `effective_threshold`) |
| `backend/app/api/taxes.py` | `_summary_out` niit wiring; safe-harbor lesser-of block + `SAFE_HARBOR_CURRENT_MULTIPLIER`; two safe-harbor warning texts; stale comment fix |
| `backend/app/services/money_flow.py` + `backend/app/schemas/overview.py` + `backend/app/api/overview.py` | `MoneyFlowTaxes.niit` / `MoneyFlowTaxesOut.niit` / serializer line |
| `backend/tests/test_tax_service.py` | Fixture flip to base CG rates; golden updates w/ derivations; NIIT unit tests; advisory rewrite tests; capital-loss tests; SALT-MAGI test |
| `backend/tests/test_tax_service_married.py` | `MFJ_BRACKETS` CG flip + `capital_loss_deductions` key; MFJ golden update; NIIT-threshold-by-status parametrized test; MFS capital-loss warning test |
| `backend/tests/test_taxes_api.py` | 2024/2026 wire goldens; folded-advisory wire test; what-if NIIT-crossing test |
| `backend/tests/test_importer_apply.py` | Pinned folded-rate translation test |
| `backend/tests/test_withholding_api.py` | Safe-harbor lesser-of pins (5 rewrites + additive fields on exact dicts) |
| `backend/tests/test_money_flow.py` | `flow.taxes.niit == breakdown.niit.tax` parity line |
| `src/types/api.ts` | `TaxSummaryOut.niit?`, `MoneyFlowTaxes.niit?`, safe_harbor field changes |
| `src/components/taxes/taxChartOptions.ts` + `.test.ts` | 7th label/color/amount; waterfall skip-when-zero; trend conditional stack; CSV column; fixture table update |
| `src/components/taxes/SummaryPanel.tsx` | Total-tax tile hint names NIIT; "21 keys" comment |
| `src/components/overview/moneyFlowOptions.ts` (+ its test) | NIIT tooltip line |
| `src/components/taxes/WithholdingPanel.tsx` + `.test.tsx` | Lesser-of safe-harbor copy with the binding leg marked |
| `src/pages/TaxesPage.test.tsx` | `MISSING_21` mock string fidelity (22 keys) |
| `README.md` | §7.5 divergence entries + Taxes row; §7.6 addendum for the migration |

**Deliberately untouched (verified in the pre-plan reading):** `backend/app/tax_keys.py` `JURISDICTIONS` (NIIT has no bracket table — it must NOT become a seventh jurisdiction, or every bracket editor/cloner/missing-table warning grows a permanently-empty entry) — only its stale `capital_loss_deductions` comment changes; `WhatIfIn`/`WhatIfDelta` and the what-if endpoint (ratified: scenarios inherit NIIT through `compute_breakdown`; `delta.total_tax` is the rendered-totals subtraction so it carries the NIIT move — the six per-jurisdiction delta fields stay as they are); `backend/app/services/withholding_calc.py` + `test_withholding_calc.py` (pure withholding estimator — the safe harbor lives in the router); `derive_suggestions`' netting/clamp rules (only its SALT MAGI reference moves); `src/api/taxes.ts` `JURISDICTION_LABELS` (bracket-table vocabulary); `capital_gains` `JurisdictionResult` wiring.

---

## Phase 0 — Environment & baselines

### Task 0: Verify the checkout, record baselines, confirm the Alembic head

**Files:** none (environment only)

- [ ] **Step 1: Branch + clean tree.**

```bash
git status --porcelain    # expected: EMPTY
git rev-parse --abbrev-ref HEAD    # expected: tier1-batch
```

Wrong branch or dirty tree → STOP and report; the orchestrator owns branch setup.

- [ ] **Step 2: Confirm the Alembic head this plan chains onto.**

```bash
cd backend && .venv/Scripts/python.exe -m alembic heads
```

Expected: `e4a7c92b6d18 (head)`. **Requires the dev Postgres — no: `heads` reads only the files**, so this runs anywhere. If it prints anything else, a migration landed since the spec was written: use the printed head as `down_revision` in Task 3 (it is local-only, so §4.3 is satisfied) and record the substitution in the final report. Do NOT edit any existing revision.

- [ ] **Step 3: Baseline the suites** (the counts Tasks 2–12 are judged against).

```bash
cd backend && .venv/Scripts/python.exe -m pytest -q
```
```bash
npm test
```

Expected: ALL PASS (memory's last-known full-repo counts were 1206 pytest / 1284 vitest at `e57a9bd`; Workstream A has since added tests on this branch, so **record the actual numbers** — call them N_py and N_vt).

---

## Phase 1 — The engine (C1, C2)

### Task 1: Extract `_cg_amount` + `_magi` (pure refactor, zero behavior change)

**Files:** `backend/app/services/tax_service.py`

The netting currently lives inline in `compute_breakdown` (lines 407–414). One definition, four eventual consumers: the federal CG stack, state AGI, the NIIT base (Task 2), and the SALT phase-down (Task 6). The no-behavior-change pin is the entire existing suite: a refactor's test IS the goldens it must not move.

- [ ] **Step 1: Add the two helpers** immediately AFTER `_federal_agi` (after line 188, before `@dataclass class EarnerWages`):

```python
def _cg_amount(value: Callable[[str], Decimal]) -> Decimal:
    """The netted capital-gains amount (sheet rows 118-120) — ONE definition for its four
    consumers: the federal CG stack, state AGI, the NIIT base and `_magi`'s MAGI.

    A long-term LOSS nets against qualified dividends + other gains only while the net
    stays positive; otherwise the sheet drops it here (the deductible remainder is the
    capital_loss_deductions line, which reaches AGI via `_federal_agi`).
    """
    ltcg = value("ltcg_total")
    netted = ltcg + value("qualified_dividends") + value("other_capital_gains")
    if ltcg > 0:
        return netted
    if ltcg < 0 and netted > 0:
        return netted
    return value("qualified_dividends") + value("other_capital_gains")


def _magi(value: Callable[[str], Decimal]) -> Decimal:
    """Modified AGI: federal AGI plus the netted gains — the base the NIIT threshold test
    and the SALT phase-down are statutorily judged on (2026-08-31 spec C1). One
    definition, two consumers. It inherits capital_loss_deductions through `_federal_agi`
    (spec C3): the §1211 deduction is inside AGI, so MAGI carries it — correct for both
    consumers, and pinned by the capital-loss NIIT test.
    """
    return _federal_agi(value) + _cg_amount(value)
```

- [ ] **Step 2: Replace the inline netting in `compute_breakdown`.** Replace lines 402–414 (the whole block from `# Capital gains (rows 118-120):` through the `else:` branch assigning `cg_amount`) with:

```python
    # Capital gains (rows 118-120): netted in `_cg_amount`, computed here — above the
    # state section — because state AGI consumes cg_amount too; the federal CG stack
    # itself is applied after FICA, where the sheet computes it.
    cg_amount = _cg_amount(values.__getitem__)
```

- [ ] **Step 3: Run the FULL backend suite — the no-behavior-change pin.**

Run: `cd backend && .venv/Scripts/python.exe -m pytest -q`
Expected: exactly N_py passed, zero failures, zero new tests. Any moved golden means the extraction changed a branch — STOP and diff against the original netting.

- [ ] **Step 4: Ruff.** `cd backend && .venv/Scripts/python.exe -m ruff check app tests` → clean.

- [ ] **Step 5: Commit.** `git add backend/app/services/tax_service.py && git commit -m "refactor(taxes): extract _cg_amount + _magi helpers (no behavior change)"`

### Task 2: The NIIT line + folded-rate advisory + fixture flip + golden reconciliation (ATOMIC)

**Files:** `backend/app/services/tax_service.py`, `backend/tests/test_tax_service.py`, `backend/tests/test_tax_service_married.py`, `backend/tests/test_taxes_api.py` (four moved wire pins only)

This is the sanctioned atomic commit. Three things must land together or nothing is green: (1) the engine's explicit NIIT line, (2) `niit_advisory` rewritten to folded-rate detection (the old AGI-comparison advisory would fire on base-rate fixtures with AGI > 200k, and `assert_canonical` pins `warnings == []`), (3) the test fixtures' CG tables flipped from folded (`0.188/0.238`) to base rates — the fixtures model the POST-MIGRATION database, which Task 3's migration makes true.

- [ ] **Step 1 (test-first): flip the fixtures and write the new expectations.** In `backend/tests/test_tax_service.py`:

**1a.** Replace `_CG_RATES` (lines 138–144) and its comment:

```python
# Base rates in every year: the sheet folded NIIT into brackets 2/3 from 2024
# (IF(agi > 200000, 18.8%, 15%) cached values), and migration f7d3b2a91c40 rewrote the
# exact folded pair back to 15/20 — the engine computes NIIT as its own line, so these
# fixtures are the post-migration database. The folded pair survives only in the
# advisory/importer tests, which exist to catch it.
_CG_RATES = {
    2023: ("0", "0.15", "0.20"),
    2024: ("0", "0.15", "0.20"),
    2025: ("0", "0.15", "0.20"),
    2026: ("0", "0.15", "0.20"),
}
```

**1b.** Update `_CANONICAL_TABLE` (lines 165–181): change three rows and add one —

```python
    "cg_tax": ("19.35", "26.87", "190.08", "0.00"),
    ...
    # NIIT = 0.038 x min(NII, max(0, MAGI - 200000)); NII = interest + unq divs
    # + max(stcg, 0) + max(cg_amount, 0); MAGI = fed AGI + cg_amount.
    #   2023: MAGI 117855.64 <= 200000 -> 0 (NII 21250.15 never consulted).
    #   2024: NII 24.76+833.46+951.93+179.13 = 1989.28; excess 11955.33; NII binds ->
    #         0.038 x 1989.28 = 75.59264.
    #   2025: NII 62.87+1653.14+8040.08+1267.19 = 11023.28; excess 60643.24; NII binds ->
    #         0.038 x 11023.28 = 418.88464.
    #   2026: NII 0 -> 0.
    "niit": ("0.00", "75.59", "418.88", "0.00"),
    # 2024: 72755.83 - (33.68 - 26.87 cg unfold, exactly 179.13 x 0.038 = 6.80694 at full
    # precision) + 75.59264 NIIT = 72824.61; take_home moves opposite. 2025: 90050.76
    # - 1267.19 x 0.038 (48.15322) + 418.88464 = 90421.49. 2023/2026: unchanged controls.
    "total_tax": ("34319.05", "72824.61", "90421.49", "98584.56"),
    "take_home": ("92002.18", "165148.56", "196787.57", "208109.47"),
```

(Keep every other row byte-identical. `gross_income`, `fed_*`, `state_*` and the FICA rows do not move.)

**1c.** Add `"niit"` to `actuals()` (after the `"cg_tax"` entry):

```python
        "cg_tax": breakdown.capital_gains.tax,
        "niit": breakdown.niit.tax,
```

**1d.** Update the two single-value pins the flip moves:

- `test_golden_2024` line 321: `assert breakdown.capital_gains.effective_rate == Decimal("0.188")` → `Decimal("0.15")`.
- `test_stack_within_single_bracket` (lines 278–283): the pin becomes `Decimal("190.07850")` with the comment updated — `# 1267.19 x 0.15 at the post-migration base rate; the drift-TI base still lands in the same 48351..533400 tier.`

**1e.** Rework `test_golden_2024_equals_sheet_cached_values`: remove `"cg_tax": "33.67644"` from the `exact` dict, and extend the divergence block after the `sheet = {...}` construction so it reads:

```python
    # The state chain vs the sheet: AGI/TI sit exactly cg_amount above the cached cells,
    # and the three money outcomes exactly one 9.3%-bracket walk above/below — the
    # documented direction (the app's state tax >= the sheet's for a CG year).
    cg = Decimal("179.13")
    state_delta = walk(YEAR_BRACKETS[2024]["state"], produced["state_ti"]) - walk(
        YEAR_BRACKETS[2024]["state"], produced["state_ti"] - cg
    )
    assert state_delta == cg * Decimal("0.093")  # no bracket boundary crossed
    # The CG/NIIT split vs the sheet (2026-08-31 spec C2): the sheet folded the 3.8%
    # surcharge into its 18.8% CG rate; the app stores the base 15% and charges NIIT as
    # its own line. cg_tax = sheet's 33.67644 minus the folded 179.13 x 0.038; the NIIT
    # line is 0.038 x min(NII 1989.28, MAGI excess 11955.33) = 75.59264 — MORE than the
    # unfold, because NIIT reaches interest/dividends/STCG the CG bracket never taxed.
    unfold = cg * Decimal("0.038")  # 6.80694
    niit = Decimal("75.59264")
    assert produced["cg_tax"] == Decimal("33.67644") - unfold
    assert produced["niit"] == niit
    sheet = {
        "state_agi": (Decimal("215122.0164"), cg),
        "state_ti": (Decimal("209582.0164"), cg),
        "state_tax": (Decimal("15884.45652"), state_delta),
        "total_tax": (Decimal("72739.16677"), state_delta - unfold + niit),
        "take_home": (Decimal("165234.0032"), -(state_delta - unfold + niit)),
    }
```

(The 1e-4 comparison loop below it stays byte-identical.)

**1f.** Add the NIIT unit tests at the END of the "Canonical goldens" section (after `test_state_tax_walks_the_capital_gains_increment`, before the drift-pins banner):

```python
def test_niit_line_2024_hand_derivation():
    """NII = interest 24.76 + unq div 833.46 + max(stcg 951.93, 0) + max(cg 179.13, 0)
    = 1989.28; MAGI = 211776.20 + 179.13 = 211955.33 -> 11955.33 over the single 200000
    threshold; NII binds: 0.038 x 1989.28 = 75.59264, at an exact 3.8% over NII."""
    breakdown = breakdown_for(2024)
    assert breakdown.niit.gains_amount == Decimal("1989.28")  # NII rides gains_amount
    assert breakdown.niit.taxable_income == Decimal("1989.28")  # the surcharged base
    assert breakdown.niit.tax == Decimal("75.59264")
    assert breakdown.niit.effective_rate == Decimal("0.038")
    # The seventh line really is inside both totals.
    assert breakdown.totals.total_tax == (
        breakdown.federal.tax
        + breakdown.state.tax
        + breakdown.medicare.tax
        + breakdown.social_security.tax
        + breakdown.disability.tax
        + breakdown.capital_gains.tax
        + breakdown.niit.tax
    )
    assert breakdown.totals.take_home == breakdown.totals.gross_income - breakdown.totals.total_tax


def test_niit_excess_binds_when_magi_barely_crosses():
    """195000 wages + 60000 interest: MAGI 255000, NII 60000, excess 55000 — the excess
    leg binds, so the effective rate over NII drops under 0.038."""
    inputs = {"latest_w2_income": Decimal("195000"), "interest_total": Decimal("60000")}
    breakdown = compute_breakdown(2025, inputs, YEAR_BRACKETS[2025])
    assert breakdown.niit.gains_amount == Decimal("60000")
    assert breakdown.niit.taxable_income == Decimal("55000")
    assert breakdown.niit.tax == Decimal("2090")  # 0.038 x 55000
    assert breakdown.niit.effective_rate == breakdown.niit.tax / Decimal("60000")


def test_niit_clamps_negative_components_out_of_nii():
    """Spec C2's clamps: a short-term LOSS and a negative netted CG line reduce AGI,
    never NII — and a pathological net-negative NII never surfaces as a negative tax."""
    inputs = {
        "latest_w2_income": Decimal("300000"),
        "stcg_total": Decimal("-5000"),
        "other_capital_gains": Decimal("-400"),
        "interest_total": Decimal("1000"),
    }
    breakdown = compute_breakdown(2025, inputs, YEAR_BRACKETS[2025])
    # ltcg 0 -> else branch nets qualified 0 + other -400: cg_amount is -400. It joins
    # MAGI (295600 = 296000 fed AGI - 400) but is clamped out of NII, like the STCG loss.
    assert breakdown.capital_gains.gains_amount == Decimal("-400")
    assert breakdown.niit.gains_amount == Decimal("1000")  # interest alone
    assert breakdown.niit.tax == Decimal("38.000")  # excess 95600 dwarfs NII 1000

    negative_nii = compute_breakdown(
        2025,
        {"latest_w2_income": Decimal("300000"), "interest_total": Decimal("-9000")},
        YEAR_BRACKETS[2025],
    )
    assert negative_nii.niit.gains_amount == Decimal("-9000")  # reported as stored
    assert negative_nii.niit.taxable_income == Decimal("0")  # the max(0, .) belt
    assert negative_nii.niit.tax == Decimal("0")
```

**1g.** Replace the three advisory tests (lines 763–800) wholesale:

```python
def test_niit_advisory_flags_folded_rates():
    """The advisory's ONE job since 2026-08-31 (spec C2): a stored 18.8/23.8 rate is the
    sheet's folded NIIT next to an engine that now charges the surcharge separately —
    i.e. a double-charge. Exact matches only (the migration/importer rewrite the same two
    values), any bracket count, normalized rendering at Numeric(7,4) scale."""
    folded = _table(("0", "0.188", "0.238"), _CG_THRESHOLDS[2024])
    stored_scale = _table(("0.0000", "0.1880", "0.2380"), _CG_THRESHOLDS[2024])
    flagged = (
        "stored capital-gains rate(s) 0.188/0.238 appear to fold the NIIT surcharge in — "
        "NIIT is computed as its own line; store the base rates 0.15/0.2"
    )
    assert niit_advisory(folded) == flagged
    assert niit_advisory(stored_scale) == flagged  # scale never changes a word
    assert niit_advisory(YEAR_BRACKETS[2024]["capital_gains"]) is None  # base rates
    assert niit_advisory([]) is None
    # One folded rate alone still flags; a near-miss is the user's own number.
    assert niit_advisory(_table(("0", "0.188"), ("0", "47026"))) == (
        "stored capital-gains rate(s) 0.188 appear to fold the NIIT surcharge in — "
        "NIIT is computed as its own line; store the base rates 0.15/0.2"
    )
    assert niit_advisory(_table(("0", "0.1881", "0.239"), _CG_THRESHOLDS[2024])) is None


def test_niit_advisory_reaches_the_breakdown_warnings():
    folded = dict(YEAR_BRACKETS[2024]) | {
        "capital_gains": _table(("0", "0.188", "0.238"), _CG_THRESHOLDS[2024])
    }
    breakdown = compute_breakdown(2024, YEAR_INPUTS[2024], folded)
    assert breakdown.warnings == [
        "stored capital-gains rate(s) 0.188/0.238 appear to fold the NIIT surcharge in — "
        "NIIT is computed as its own line; store the base rates 0.15/0.2"
    ]
    # The engine still walks the STORED rates verbatim — the advisory never edits them —
    # so a folded table really does double-charge: 179.13 x 0.188 on the CG line PLUS
    # 75.59264 on the NIIT line. That state is what migration f7d3b2a91c40 ends.
    assert breakdown.capital_gains.tax == Decimal("179.13") * Decimal("0.188")
    assert breakdown.niit.tax == Decimal("75.59264")
```

(Delete `test_niit_advisory_flags_mismatch` and `test_niit_advisory_tolerates_short_tables` — the short-table tolerance is inside the new first test's `[]` case, and there is no AGI comparison left to tolerate anything else.)

**1h.** Extend `test_effective_rate_never_serializes_negative_zero` with two lines after the `totals` asserts: `assert breakdown.niit.gains_amount == Decimal("0")` and `assert breakdown.niit.effective_rate is None` (NII of 0 is the sheet's #DIV/0!).

**1i.** In `backend/tests/test_tax_service_married.py`:

- Flip `MFJ_BRACKETS["capital_gains"]` (line 91) to `[(D("0"), D("0")), (D("0.15"), D("100000")), (D("0.20"), D("600000"))]` with the comment `# base rates: the folded pair is the advisory's business, not a fixture's`.
- In `test_mfj_reference_year_to_the_cent`, replace the capital-gains block and totals:

```python
    # Capital gains: LTCG 40000 is a gain, so everything nets -> 40000 + 5000 + 0.
    assert breakdown.capital_gains.gains_amount == D("45000")
    # Stacked on TI 236500 -> [236500, 281500], entirely inside the 15% tier.
    assert cents(breakdown.capital_gains.tax) == D("6750.00")

    # NIIT: NII = interest 2000 + unq div 1000 + max(stcg 0, 0) + max(cg 45000, 0)
    # = 48000; MAGI = 266500 + 45000 = 311500 -> excess 61500 over MFJ's 250000; NII
    # binds: 0.038 x 48000 = 1824.
    assert breakdown.niit.gains_amount == D("48000")
    assert breakdown.niit.taxable_income == D("48000")
    assert cents(breakdown.niit.tax) == D("1824.00")
```

and at the bottom: `total_tax` `93829.85` → `D("93943.85")` (`# 93829.85 - 8460 folded CG + 6750 base CG + 1824 NIIT`), `take_home` `254170.15` → `D("254056.15")`.

- Replace the two advisory tests (lines 281–307, incl. the `BASE_CG` constant) with the status-threshold parametrization on the REAL line:

```python
@pytest.mark.parametrize(
    ("w2", "status", "base", "tax"),
    [
        ("140000", SINGLE, "0", "0"),  # MAGI 150000 <= 200000
        ("140000", MARRIED_JOINT, "0", "0"),  # <= 250000
        ("140000", MARRIED_SEPARATE, "10000", "380"),  # excess 25000; NII 10000 binds
        ("210000", SINGLE, "10000", "380"),  # MAGI 220000 -> excess 20000; NII binds
        ("210000", MARRIED_JOINT, "0", "0"),  # 220000 <= 250000
        ("240000", MARRIED_JOINT, "0", "0"),  # MAGI exactly 250000: excess is 0
        ("140000", "head_of_household", "0", "0"),  # unknown status reads single's 200000
    ],
)
def test_niit_threshold_follows_the_filing_status(w2, status, base, tax):
    """The engine's own NIIT line selects the status threshold (the map the old advisory
    read); an unknown status degrades to single's constant — a pure read over stored
    data must never raise on it."""
    inputs = {"latest_w2_income": D(w2), "interest_total": D("10000")}
    breakdown = compute_breakdown(2025, inputs, YEAR_BRACKETS[2025], filing_status=status)
    assert breakdown.niit.taxable_income == D(base)
    assert breakdown.niit.tax == D(tax)
```

and drop the now-unused `niit_advisory` import from this file.

- [ ] **Step 2: Run to verify failure.** `cd backend && .venv/Scripts/python.exe -m pytest tests/test_tax_service.py tests/test_tax_service_married.py -q`
Expected: many failures, all of the shapes: `AttributeError: 'TaxBreakdown' object has no attribute 'niit'`, `TypeError: niit_advisory() takes 1 positional argument` (or the AGI-advisory string mismatch), and golden mismatches on `cg_tax`. Any OTHER failure family → STOP and investigate.

- [ ] **Step 3: Implement in `backend/app/services/tax_service.py`.**

**3a.** Replace the constants block (lines 43–62: `NIIT_WARNING`, the folded-model comment, `NIIT_AGI_THRESHOLD`(S), `NIIT_RATES`, `BASE_CG_RATES`) with:

```python
NIIT_WARNING = (
    "stored capital-gains rate(s) {rates} appear to fold the NIIT surcharge in — "
    "NIIT is computed as its own line; store the base rates 0.15/0.2"
)

# NIIT (2026-08-31 spec C2): 3.8% of the smaller of net investment income and the MAGI
# excess over the status threshold — an explicit line since this batch. The sheet instead
# folded the surcharge into CG bracket rates 2/3 (15 -> 18.8, 20 -> 23.8, cached from an
# IF(agi > 200000, ...)); migration f7d3b2a91c40 rewrote the exact folded pair back to
# base rates, the importer translates them on every apply, and `niit_advisory` flags any
# leftover — three guards over the ONE pair below, so a folded table can never silently
# double-charge.
NIIT_RATE = Decimal("0.038")
NIIT_AGI_THRESHOLD = Decimal("200000")
# Statutory and non-indexed (audit §5), so constants rather than data: MFJ is 250000 and
# MFS 125000, neither of which is "2x single". An unknown status reads single's figure —
# this is a pure read over stored data and must never raise on it.
NIIT_AGI_THRESHOLDS: dict[str, Decimal] = {
    SINGLE: NIIT_AGI_THRESHOLD,
    MARRIED_JOINT: Decimal("250000"),
    MARRIED_SEPARATE: Decimal("125000"),
}
FOLDED_CG_RATES = (Decimal("0.188"), Decimal("0.238"))
BASE_CG_RATES = (Decimal("0.15"), Decimal("0.20"))
# Decimal hashes by VALUE, so a Numeric(7,4)-scaled 0.1880 hits the 0.188 key.
FOLDED_TO_BASE_CG = dict(zip(FOLDED_CG_RATES, BASE_CG_RATES, strict=True))
```

(`NIIT_RATES` is renamed to `FOLDED_CG_RATES` — grep confirmed tax_service + the two test files are its only importers, and both test usages are rewritten in Step 1.)

**3b.** Add `niit: JurisdictionResult` to `TaxBreakdown` between `capital_gains` and `totals`, and extend the `JurisdictionResult` docstring's last paragraph:

```python
    Income taxes carry agi/taxable_income, wage taxes carry w2_income/taxable_wages, and
    capital gains carry taxable_income (the ordinary income the gains stack on top of)
    plus gains_amount. The NIIT line borrows the capital-gains shape: gains_amount is net
    investment income and taxable_income the surcharged base min(NII, MAGI excess).
```

**3c.** Rewrite `niit_advisory` (lines 317–347) in place:

```python
def niit_advisory(cg_brackets: list[Bracket]) -> str | None:
    """Flag stored CG rates that still fold the NIIT surcharge in (18.8 / 23.8).

    The engine computes NIIT as its own line, so a folded table charges the surcharge
    twice. Exact value-matches only — the same two rates migration f7d3b2a91c40 and the
    importer translation rewrite — and never edits the brackets: the engine walks what is
    stored, verbatim. Stored rates arrive at Numeric(7,4) scale, so the rendering
    normalizes (0.1880 and a hand-typed 0.188 must produce the same sentence).
    """
    folded = sorted({rate.normalize() for rate, _threshold in cg_brackets if rate in FOLDED_CG_RATES})
    if not folded:
        return None
    return NIIT_WARNING.format(rates="/".join(str(rate) for rate in folded))
```

**3d.** In `compute_breakdown`, insert the NIIT block AFTER the CG stack (line 477, `cg_tax = stack(...)`) and BEFORE the totals comment:

```python
    # NIIT (2026-08-31 spec C2) — its own line, never a folded bracket rate: 3.8% of the
    # smaller of net investment income and the MAGI excess over the status threshold.
    # MAGI is `_magi`'s definition (fed AGI + cg_amount, capital_loss_deductions inside
    # via _federal_agi). The clamps guard stored-negative edges: a short-term or netted
    # CG loss reduces AGI, never investment income, and a net-negative NII must never
    # surface as a negative surcharge.
    nii = (
        values["interest_total"]
        + values["unqualified_dividends"]
        + max(values["stcg_total"], ZERO)
        + max(cg_amount, ZERO)
    )
    magi = _magi(values.__getitem__)
    niit_threshold = NIIT_AGI_THRESHOLDS.get(filing_status, NIIT_AGI_THRESHOLD)
    niit_base = max(ZERO, min(nii, magi - niit_threshold))
    niit_tax = NIIT_RATE * niit_base
```

**3e.** Extend the totals line (493) to `total_tax = fed_tax + state_tax + medicare_tax + ss_tax + sdi_tax + cg_tax + niit_tax`, change the advisory call (495) to `advisory = niit_advisory(tables["capital_gains"])`, and add the result to the returned `TaxBreakdown` between `capital_gains=...` and `totals=...`:

```python
        niit=JurisdictionResult(
            tax=niit_tax,
            effective_rate=_rate(niit_tax, nii),
            taxable_income=niit_base,
            gains_amount=nii,
        ),
```

**3f.** `compute_breakdown`'s docstring: change the sentence "`filing_status` selects nothing here but the NIIT advisory's threshold" to "`filing_status` selects nothing here but the NIIT line's MAGI threshold" (the rest of that paragraph stands).

- [ ] **Step 4: Run the engine suites.**

Run: `cd backend && .venv/Scripts/python.exe -m pytest tests/test_tax_service.py tests/test_tax_service_married.py -q`
Expected: ALL PASS (the two files' old counts, minus the 1 deleted test, plus the 4 new ones — record exact numbers).

- [ ] **Step 5: Update the four wire pins the fixture flip moves in `backend/tests/test_taxes_api.py`** (its `brackets_payload` imports `YEAR_BRACKETS`, so the API tests now seed base rates):

- `test_summary_2024_matches_the_sheet_except_the_state_chain` (lines 561–573): `capital_gains` becomes `{"taxable_income": "197176.20", "gains_amount": "179.13", "tax": "26.87", "effective_rate": "0.150000"}` and `totals` becomes `{"gross_income": "237973.17", "total_income": "211776.20", "total_tax": "72824.61", "take_home": "165148.56", "effective_rate": "0.306020"}` — each with the one-line comment `# CG unfolded to the 15% base + the explicit NIIT line: derivations in test_tax_service.py's _CANONICAL_TABLE.` (The docstring's "sheet-exact everywhere but the state chain" clause gains "and the CG/NIIT split".)
- `test_all_years_summary_skips_input_less_years` line 620: `"72755.83"` → `"72824.61"`.
- `test_single_summary_shape_is_unchanged` line 1122: `"72755.83"` → `"72824.61"`.
- `test_summary_guards_absurd_but_legal_inputs`: delete the final advisory assertion (line 658–659) and its comment — the seeded 2024 tables are base rates now, so nothing folds; normalization is pinned at the engine level (`test_niit_advisory_flags_folded_rates`), and Task 7 adds a dedicated wire test for the folded warning.

- [ ] **Step 6: Full backend suite.**

Run: `cd backend && .venv/Scripts/python.exe -m pytest -q`
Expected: ALL PASS at N_py + 7 (main file: three new NIIT unit tests, three advisory tests became two → +2; married file: two advisory tests became one 7-case parametrization → +5) — record the actual count as the new N_py. The withholding suite must be untouched: its seeds carry a single W-2 key, so NII = 0 and the `"115753.20"` liability pin is inert; `test_money_flow.py` / `test_overview_api.py` compare flow vs breakdown / wire vs summary, and both sides moved together.

- [ ] **Step 7: Ruff + commit.** `cd backend && .venv/Scripts/python.exe -m ruff check app tests` → clean, then `git add -A backend && git commit -m "feat(taxes): explicit NIIT line; folded-rate advisory; goldens reconciled (C1/C2)"`

### Task 3: Guarded data migration — unfold the stored folded rates

**Files:** `backend/alembic/versions/20260831_0900_f7d3b2a91c40_unfold_niit_capital_gains_rates.py` (new)

- [ ] **Step 1: Write the migration** (house template: `5fbe696d5a10`'s exact-match repair posture + `e4a7c92b6d18`'s header form):

```python
"""unfold NIIT from stored capital-gains bracket rates

The sheet's CG model folded the 3.8% NIIT surcharge into the two upper bracket rates
(15% -> 18.8%, 20% -> 23.8%) and the importer stored the cached values. The engine now
computes NIIT as its own line (2026-08-31 spec C2), so a folded table would charge the
surcharge twice. Rewrite EXACT matches only — 0.1880 -> 0.1500 and 0.2380 -> 0.2000 —
in every year and every filing status; anything else is a user's own number and is never
touched. The importer applies the same translation on every future import (apply.py) and
`niit_advisory` warns whenever a folded pair is still stored, so this repair cannot be
silently reintroduced.

Downgrade restores the folded pair under the same exact-match guard. Documented
asymmetry, accepted (spec C2): a year that stored GENUINE base rates all along (2023
here) re-folds on downgrade too — under the pre-NIIT engine those are the very rates its
AGI-comparison advisory expected above the threshold, and any leftover mismatch is named
by that advisory rather than silently double-charged.

Revision ID: f7d3b2a91c40
Revises: e4a7c92b6d18
Create Date: 2026-08-31 09:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f7d3b2a91c40"
down_revision: str | Sequence[str] | None = "e4a7c92b6d18"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # Numeric(7,4) compares exactly, so a hand-edited 0.1881 — or a genuine 0.1500 —
    # is invisible to both statements. No overlap between the two rewrites.
    op.execute(
        "UPDATE tax_brackets SET rate = 0.1500 "
        "WHERE jurisdiction = 'capital_gains' AND rate = 0.1880"
    )
    op.execute(
        "UPDATE tax_brackets SET rate = 0.2000 "
        "WHERE jurisdiction = 'capital_gains' AND rate = 0.2380"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.execute(
        "UPDATE tax_brackets SET rate = 0.1880 "
        "WHERE jurisdiction = 'capital_gains' AND rate = 0.1500"
    )
    op.execute(
        "UPDATE tax_brackets SET rate = 0.2380 "
        "WHERE jurisdiction = 'capital_gains' AND rate = 0.2000"
    )
```

(If Task 0 Step 2 printed a different head, put that id in `Revises:`/`down_revision` and say so in the report.)

- [ ] **Step 2: Migration smoke** — **requires dev Postgres on localhost:5433; if it is down, mark this step deferred to the batch's final live-migration check and continue** (pytest never runs migrations — its DBs are `create_all`).

```bash
cd backend && .venv/Scripts/python.exe -m alembic upgrade head
```

Expected: `Running upgrade e4a7c92b6d18 -> f7d3b2a91c40`. Then spot-check (dev DB was imported from the sheet, so 2024–2026 carried the folded pair):

```bash
docker compose -f docker-compose.yml exec db psql -U postgres -d finance -c "SELECT year, bracket_index, rate FROM tax_brackets WHERE jurisdiction = 'capital_gains' ORDER BY year, filing_status, bracket_index"
```

Expected: no `0.1880` / `0.2380` anywhere; 2023 rows read `0.1500`/`0.2000` untouched. (Adjust the psql invocation to however this host runs the dev container; a `.venv` one-liner with asyncpg is an acceptable substitute.) Then `.venv/Scripts/python.exe -m alembic downgrade -1` + re-select (folded pair back on every 0.15/0.20 row — the documented asymmetry visible), then `upgrade head` again to leave the dev DB in the corrected state.

- [ ] **Step 3: Full backend suite still green** (`cd backend && .venv/Scripts/python.exe -m pytest -q` — migrations don't touch pytest, this is the standing invariant check).

- [ ] **Step 4: Commit.** `git add backend/alembic && git commit -m "fix(taxes): guarded migration unfolds folded NIIT rates in tax_brackets"`

### Task 4: Importer translation + pinned test

**Files:** `backend/app/importer/apply.py`, `backend/tests/test_importer_apply.py`

- [ ] **Step 1 (test-first):** add to `backend/tests/test_importer_apply.py`, after `test_apply_taxes_years_inputs_brackets`:

```python
async def test_apply_taxes_translates_folded_niit_cg_rates(db):
    """The migration's importer companion (2026-08-31 spec C2): a re-import must not
    reintroduce folded 18.8/23.8 CG rates the engine would double-charge next to its
    explicit NIIT line. Exact matches only — the 2023 column below stores the GENUINE
    base pair and must land verbatim."""
    from app.importer.apply import apply_taxes
    from app.importer.parsers import parse_taxes
    from app.models import TaxBracket
    from tests.workbook_builder import default_taxes_rows

    rows = default_taxes_rows()
    cg = next(i for i, row in enumerate(rows) if row[0] == "CAPITAL GAINS TAX INFO")
    # Columns are (2023, 2024): base rates in 2023, the sheet's folded cache in 2024.
    rows[cg + 2 : cg + 2] = [
        [None, "Bracket 2 Rate", 0.15, 0.188, None],
        [None, "Bracket 2 Threshold", 44625.0, 47026.0, None],
        [None, "Bracket 3 Rate", 0.20, 0.238, None],
        [None, "Bracket 3 Threshold", 492300.0, 518900.0, None],
    ]
    report = SheetReport()
    await apply_taxes(db, parse_taxes(sheets(taxes=rows)["Taxes"]), report)
    await db.commit()

    stored = {
        (b.year, b.bracket_index): b.rate
        for b in (
            await db.execute(
                select(TaxBracket).where(TaxBracket.jurisdiction == "capital_gains")
            )
        )
        .scalars()
        .all()
    }
    assert stored[(2023, 2)] == Decimal("0.15")  # genuine base rate: untouched
    assert stored[(2023, 3)] == Decimal("0.20")
    assert stored[(2024, 2)] == Decimal("0.15")  # folded 0.188: translated
    assert stored[(2024, 3)] == Decimal("0.20")  # folded 0.238: translated
    assert [w for w in report.warnings if "folds NIIT in" in w] == [
        "tax_brackets[2024/capital_gains/2]: sheet rate 0.188 folds NIIT in — imported "
        "as 0.15 (the app computes NIIT separately)",
        "tax_brackets[2024/capital_gains/3]: sheet rate 0.238 folds NIIT in — imported "
        "as 0.2 (the app computes NIIT separately)",
    ]

    # Re-import: the sheet still folds, so the translation (and its warning) repeats,
    # while the stored rows diff as SKIPS — never an update ping-pong.
    report2 = SheetReport()
    await apply_taxes(db, parse_taxes(sheets(taxes=rows)["Taxes"]), report2)
    await db.commit()
    assert report2.entities["tax_brackets"].creates == 0
    assert report2.entities["tax_brackets"].updates == 0
    assert len([w for w in report2.warnings if "folds NIIT in" in w]) == 2
```

(Float cells arrive as exact short Decimals through the parser — the existing `0.9645` pin is the precedent. `report.py`'s `EntityCounts` carries `creates` / `updates` — verified during planning — and `skips` is proven by `test_apply_taxes_years_inputs_brackets`.)

- [ ] **Step 2: Run to verify failure.** `cd backend && .venv/Scripts/python.exe -m pytest tests/test_importer_apply.py -q -k folded` → 1 failed (`stored[(2024, 2)]` is `Decimal("0.188")`, no warnings).

- [ ] **Step 3: Implement in `backend/app/importer/apply.py`.** Add `FOLDED_TO_BASE_CG` to the module's imports (it already imports from app modules; add `from app.services.tax_service import FOLDED_TO_BASE_CG`). Then in the brackets loop (the `for item in parsed.brackets:` at ~line 584), replace `fields = {"rate": item.rate, "threshold": item.threshold}` with:

```python
        rate = item.rate
        # The sheet folds the 3.8% NIIT into its two upper CG rates; the engine computes
        # NIIT as its own line (2026-08-31 spec C2), so the exact folded pair translates
        # to base rates on EVERY apply — the same two values migration f7d3b2a91c40
        # rewrote — or a re-import would quietly reintroduce the double-charge.
        if item.jurisdiction == "capital_gains" and rate in FOLDED_TO_BASE_CG:
            base = FOLDED_TO_BASE_CG[rate]
            report.warnings.append(
                f"tax_brackets[{item.year}/capital_gains/{item.bracket_index}]: sheet "
                f"rate {rate.normalize()} folds NIIT in — imported as {base.normalize()} "
                "(the app computes NIIT separately)"
            )
            rate = base
        fields = {"rate": rate, "threshold": item.threshold}
```

- [ ] **Step 4: Green + no collateral.** `cd backend && .venv/Scripts/python.exe -m pytest tests/test_importer_apply.py -q` → all pass (the default workbook's CG table is a lone 0.0 rate, so every existing count pin is untouched). Then the full suite: `.venv/Scripts/python.exe -m pytest -q`.

- [ ] **Step 5: Ruff + commit.** `git add backend/app/importer/apply.py backend/tests/test_importer_apply.py && git commit -m "feat(importer): translate folded NIIT capital-gains rates on apply"`

---

## Phase 2 — Capital loss + SALT MAGI (C3, C1's third consumer)

### Task 5: `capital_loss_deductions` into AGI, with two advisory warnings

**Files:** `backend/app/services/tax_service.py`, `backend/app/tax_keys.py` (comment), `backend/app/api/taxes.py` (comment), `backend/tests/test_tax_service.py`, `backend/tests/test_tax_service_married.py`

- [ ] **Step 1 (test-first).** In `backend/tests/test_tax_service.py`, REPLACE `test_capital_loss_deductions_never_reach_agi` (lines 441–447) with:

```python
def test_capital_loss_deductions_reach_agi_and_the_state_chain():
    """r27 joined AGI on 2026-08-31 (spec C3): the sheet modelled the line and read it
    nowhere; the app reads it. Stored -3000 lowers federal AGI by exactly 3000 and the
    state chain inherits it through fed_agi (CA conforms to the $3k rule)."""
    inputs = dict(YEAR_INPUTS[2024]) | {"capital_loss_deductions": Decimal("-3000")}
    base = breakdown_for(2024)
    lossy = compute_breakdown(2024, inputs, YEAR_BRACKETS[2024])
    assert lossy.warnings == []  # negative and inside the cap: clean
    assert base.federal.agi - lossy.federal.agi == Decimal("3000")
    assert base.state.agi - lossy.state.agi == Decimal("3000")
    # A deduction, not income: gross income and NII are untouched...
    assert lossy.totals.gross_income == base.totals.gross_income
    assert lossy.niit.gains_amount == base.niit.gains_amount
    # ...and MAGI inherits the loss via fed AGI: 211955.33 - 3000 = 208955.33, whose
    # excess 8955.33 still exceeds NII 1989.28, so the NIIT line happens not to move here
    # (the visible MAGI shift is pinned in the next test).
    assert lossy.niit.tax == base.niit.tax


def test_capital_loss_pulls_magi_under_the_niit_threshold():
    """The C3->C2 interaction, stated: MAGI = _federal_agi + cg_amount and _federal_agi
    now carries the loss — statutorily correct (the §1211 deduction is inside AGI) — so a
    large enough loss zeroes the NIIT line. -13000 is over the cap ON PURPOSE: stored
    data is used verbatim and only warned about (GET never rejects stored data)."""
    inputs = dict(YEAR_INPUTS[2024]) | {"capital_loss_deductions": Decimal("-13000")}
    breakdown = compute_breakdown(2024, inputs, YEAR_BRACKETS[2024])
    # MAGI 211955.33 - 13000 = 198955.33 < 200000 -> excess 0.
    assert breakdown.niit.taxable_income == Decimal("0")
    assert breakdown.niit.tax == Decimal("0")
    assert breakdown.warnings == [
        "capital_loss_deductions (-13000) exceeds the statutory cap (-3000); used verbatim"
    ]


def test_capital_loss_stored_positive_warns_and_is_used_verbatim():
    inputs = dict(YEAR_INPUTS[2024]) | {"capital_loss_deductions": Decimal("500")}
    breakdown = compute_breakdown(2024, inputs, YEAR_BRACKETS[2024])
    assert breakdown.warnings == [
        "capital_loss_deductions is stored positive (500) — the deductible capital loss "
        "is entered negative; used verbatim"
    ]
    # Verbatim means ADDED: a positive value RAISES AGI rather than being rejected.
    assert breakdown.federal.agi == breakdown_for(2024).federal.agi + Decimal("500")
```

In `backend/tests/test_tax_service_married.py`, add `"capital_loss_deductions": D("0"),` to `MFJ_HOUSEHOLD` (after `"stcg_standard"` — the reference year asserts `warnings == []` and the key is an engine input now), and add next to the existing capital-loss suggestion tests:

```python
def test_capital_loss_cap_warning_halves_for_married_filing_separately():
    """The engine's over-cap warning reads the same halved statutory figure the
    suggestion clamp does: -2000 is clean on a single return, over MFS's -1500."""
    inputs = {"capital_loss_deductions": D("-2000")}
    single = compute_breakdown(2025, inputs, YEAR_BRACKETS[2025], filing_status=SINGLE)
    assert not any("statutory cap" in w for w in single.warnings)
    mfs = compute_breakdown(
        2025, inputs, YEAR_BRACKETS[2025], filing_status=MARRIED_SEPARATE
    )
    assert (
        "capital_loss_deductions (-2000) exceeds the statutory cap (-1500); used verbatim"
        in mfs.warnings
    )
```

- [ ] **Step 2: Run to verify failure.** `cd backend && .venv/Scripts/python.exe -m pytest tests/test_tax_service.py tests/test_tax_service_married.py -q` — the four new/replaced tests fail (AGI does not move, no warnings); everything else passes.

- [ ] **Step 3: Implement in `backend/app/services/tax_service.py`.**

**3a.** Warning constants, after `NEGATIVE_STATE_TAX_WARNING` (line 42):

```python
# Both are ADVISORY: a GET never rejects stored data, so the value is used verbatim
# either way. `{value}`/`{cap}` arrive pre-formatted via `f"{d.normalize():f}"` — plain
# .normalize() alone would render -13000 as "-1.3E+4".
CAPITAL_LOSS_POSITIVE_WARNING = (
    "capital_loss_deductions is stored positive ({value}) — the deductible capital loss "
    "is entered negative; used verbatim"
)
CAPITAL_LOSS_LIMIT_WARNING = (
    "capital_loss_deductions ({value}) exceeds the statutory cap ({cap}); used verbatim"
)
```

**3b.** `ENGINE_INPUT_KEYS`: insert `"capital_loss_deductions",` between `"hsa_contributions_employer",` and `"other_pretax_deductions",` (tax_keys definition order — `test_engine_keys_are_defined_tax_keys` pins the position).

**3c.** `_federal_agi` (lines 168–188): replace the docstring's last sentence and append the term:

```python
def _federal_agi(value: Callable[[str], Decimal]) -> Decimal:
    """Federal AGI, the sheet's clean model (rows 96-99) plus one correction.

    ONE definition with three consumers: `compute_breakdown`'s income chain, `_magi`, and
    (through both) the state chain. Term order is the canonical formula's, so the goldens
    pin it to the cent. capital_loss_deductions joined AGI on 2026-08-31 (spec C3): the
    sheet modelled the line but no output formula ever read it — a modelled deduction the
    workbook silently dropped. Stored <= 0 by the suggestion's convention and used
    verbatim either way (compute_breakdown warns on a positive or over-cap value, never
    rejects it); the state chain inherits it here, matching CA's conformity on the $3k
    rule, and MAGI inherits it through `_magi`.
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
    ) + value("capital_loss_deductions")
```

**3d.** In `compute_breakdown`, replace the federal section's opening comment (lines 396–397, "capital_loss_deductions (r27) is modelled as a line but no output formula ever reads it — ported faithfully, so it does NOT reach AGI.") and add the warnings before `fed_agi`:

```python
    # Federal (sheet rows 96-99 + the C3 capital-loss correction — see _federal_agi).
    # The two capital-loss warnings are advisory hygiene over a value that is about to be
    # used verbatim: sign convention first, then the per-return statutory cap (halved
    # filing separately) that derive_suggestions' clamp also reads.
    capital_loss = values["capital_loss_deductions"]
    if capital_loss > 0:
        warnings.append(
            CAPITAL_LOSS_POSITIVE_WARNING.format(value=f"{capital_loss.normalize():f}")
        )
    else:
        loss_limit = CAPITAL_LOSS_LIMIT
        if filing_status == MARRIED_SEPARATE:
            loss_limit /= MFS_HALF
        if capital_loss < -loss_limit:
            warnings.append(
                CAPITAL_LOSS_LIMIT_WARNING.format(
                    value=f"{capital_loss.normalize():f}",
                    cap=f"{(-loss_limit).normalize():f}",
                )
            )
    fed_agi = _federal_agi(values.__getitem__)
```

**3e.** `CAPITAL_LOSS_LIMIT`'s comment (lines 78–81) is now false — replace with:

```python
# The deductible capital LOSS per return (halved filing separately). TWO consumers, one
# constant: derive_suggestions clamps its SUGGESTION to it, and compute_breakdown warns
# (never clamps) when a stored value exceeds it — the engine walks stored data verbatim.
```

**3f.** Stale cross-references: in `backend/app/tax_keys.py` (lines 26–28) the tracker-keys comment ends "...Stored inputs outside ENGINE_INPUT_KEYS, exactly like capital_loss_deductions — real values the user enters, zero effect on any liability." → "...Stored inputs outside ENGINE_INPUT_KEYS — real values the user enters, zero effect on any liability. (capital_loss_deductions used to be the precedent here; it joined the engine's keys on 2026-08-31, spec C3.)". In `backend/app/api/taxes.py` (lines 1022–1025) the WAGE_KEYS comment's parenthetical "(2026-08-26 spec §5.6 — real inputs, deliberately never in the engine's key set, exactly like capital_loss_deductions)" → "(2026-08-26 spec §5.6 — real inputs, deliberately never in the engine's key set)".

- [ ] **Step 4: Green.** `cd backend && .venv/Scripts/python.exe -m pytest -q` → ALL PASS. Note for the reviewer: the goldens do NOT move (every pinned year stores `capital_loss_deductions = 0`), the missing-key warning gains the key only for callers that omit it (the withholding card drops engine warnings, so its exact-warning pins are untouched — verified in reading), and derive_suggestions' SALT MAGI already inherits the loss through `_federal_agi` as of this task (deliberate; no SALT test stores the key).

- [ ] **Step 5: Ruff + commit.** `git add -A backend && git commit -m "feat(taxes): wire capital_loss_deductions into AGI with advisory warnings (C3)"`

### Task 6: SALT phase-down tests true MAGI

**Files:** `backend/app/services/tax_service.py`, `backend/tests/test_tax_service_married.py`

- [ ] **Step 1 (test-first).** In `backend/tests/test_tax_service_married.py`, after `test_salt_phase_down_boundaries`:

```python
def test_salt_phase_down_magi_includes_capital_gains():
    """C1's third consumer: the phase-down MAGI is `_magi` (fed AGI + cg_amount), so a
    CG-heavy year sheds cap even when ordinary AGI alone sits under 500000. Approved
    behavior change (spec C1): CG-year SALT suggestions may shrink toward the floor."""
    # fed AGI 450000; cg_amount 100000 (a pure LTCG gain nets whole); MAGI 550000 ->
    # phased cap = 40000 - 0.30 x 50000 = 25000. SALT_ITEMS stores 50000 of SALT and no
    # other itemized lines, so the suggestion IS the applied cap.
    inputs = dict(SALT_ITEMS) | {"latest_w2_income": D("450000"), "ltcg_total": D("100000")}
    assert derive_suggestions(2025, inputs, SINGLE)["itemized_deduction"] == D("25000")
    # Without the gains the same wages stay under the threshold: the full 40000 cap.
    no_cg = dict(SALT_ITEMS) | {"latest_w2_income": D("450000")}
    assert derive_suggestions(2025, no_cg, SINGLE)["itemized_deduction"] == D("40000")
```

- [ ] **Step 2: Run to verify failure.** `cd backend && .venv/Scripts/python.exe -m pytest tests/test_tax_service_married.py -q -k salt_phase_down_magi` → 1 failed (`50000 > cap 40000` → suggestion `40000`, not `25000`).

- [ ] **Step 3: Implement.** In `derive_suggestions` (line 616–619), the comment + call become:

```python
    # The SALT cap is hardcoded per column in the sheet (10000 through 2024, 40000 after);
    # `salt_cap` adds the MFS halving and the >500k-MAGI phase-down. MAGI is `_magi` —
    # fed AGI plus the engine's own netted cg_amount (2026-08-31 spec C1; the sheet's
    # formula never had the phase-down at all, so there is no sheet reading to preserve).
    cap = salt_cap(year, filing_status, _magi(value))
```

Also update the `derive_suggestions` docstring's status-aware paragraph: append the sentence "The SALT slice's phase-down tests true MAGI (`_magi`), so a CG-heavy year's itemized suggestion may shrink toward the floor — approved and documented (spec C1)."

- [ ] **Step 4: Green + full suite.** `cd backend && .venv/Scripts/python.exe -m pytest tests/test_tax_service.py tests/test_tax_service_married.py -q`, then the full `-q` run. The existing SALT tests are unmoved: none of them stores a CG key, so `_magi == _federal_agi` there.

- [ ] **Step 5: Ruff + commit.** `git add -A backend && git commit -m "fix(taxes): SALT phase-down tests true MAGI via _magi (C1)"`

---

## Phase 3 — The wire (C2 schema, C5 what-if pin, money-flow parity)

### Task 7: `TaxSummaryOut.niit` + serializer + money-flow field + wire tests

**Files:** `backend/app/schemas/taxes.py`, `backend/app/api/taxes.py`, `backend/app/services/money_flow.py`, `backend/app/schemas/overview.py`, `backend/app/api/overview.py`, `backend/tests/test_taxes_api.py`, `backend/tests/test_money_flow.py`

- [ ] **Step 1 (test-first).** In `backend/tests/test_taxes_api.py`:

**1a.** In `test_summary_2024_matches_the_sheet_except_the_state_chain`, after the `capital_gains` assertion:

```python
    assert body["niit"] == {
        # Same wire shape as capital_gains: gains_amount is NII (24.76 + 833.46 + 951.93
        # + 179.13 = 1989.28), taxable_income the surcharged base min(NII, MAGI excess
        # 11955.33) — NII binds, so the effective rate over NII is the full 3.8%.
        "taxable_income": "1989.28",
        "gains_amount": "1989.28",
        "tax": "75.59",
        "effective_rate": "0.038000",
    }
```

**1b.** In `test_summary_2026_has_no_gains_so_no_capital_gains_rate`, after the `capital_gains` assertion:

```python
    assert body["niit"] == {
        "taxable_income": "0.00",
        "gains_amount": "0.00",
        "tax": "0.00",
        "effective_rate": None,  # NII of 0 is the sheet's #DIV/0!
    }
```

**1c.** New wire test for the folded advisory (restores what Task 2 removed from the absurd-inputs test), after `test_summary_2026_...`:

```python
async def test_summary_warns_on_stored_folded_niit_rates(auth_client, definitions):
    """A hand-stored (or pre-migration) folded CG table surfaces the advisory on the
    wire, normalized despite Numeric(7,4) scale — and the summary still computes."""
    await put_inputs(auth_client, 2024, inputs_payload(2024))
    payload = brackets_payload(2024)["jurisdictions"]
    payload["capital_gains"] = [
        {"rate": "0", "threshold": "0"},
        {"rate": "0.188", "threshold": "47026"},
        {"rate": "0.238", "threshold": "518900"},
    ]
    await put_brackets(auth_client, 2024, payload)

    body = (await auth_client.get(f"{YEARS}/2024/summary")).json()
    assert body["warnings"] == [
        "stored capital-gains rate(s) 0.188/0.238 appear to fold the NIIT surcharge in — "
        "NIIT is computed as its own line; store the base rates 0.15/0.2"
    ]
    assert body["capital_gains"]["tax"] == "33.68"  # walked verbatim: the double-charge
    assert body["niit"]["tax"] == "75.59"
```

**1d.** The what-if NIIT-crossing pin (spec C5), after `test_what_if_empty_scenario_echoes_baseline`:

```python
async def test_what_if_override_crosses_the_niit_threshold(auth_client, definitions):
    """C5: the endpoint changed NOT AT ALL — scenarios inherit the NIIT line through
    compute_breakdown. Raising the 401k deduction pulls MAGI back under the threshold,
    so the baseline's NIIT line vanishes from the scenario and the totals delta carries
    the move (delta stays the rendered-totals subtraction, never a third computation)."""
    await seeded_2024(auth_client)

    # Baseline MAGI = 211776.20 + 179.13 = 211955.33 (11955.33 over the single 200000);
    # override 21567.84 -> 36567.84 (-15000 of AGI): scenario MAGI 196955.33, excess 0.
    body = await what_if(auth_client, overrides={"trad_401k_contributions": "36567.84"})

    assert body["baseline"]["niit"]["tax"] == "75.59"
    assert body["scenario"]["niit"]["tax"] == "0.00"
    assert body["scenario"]["niit"]["taxable_income"] == "0.00"
    assert body["scenario"]["niit"]["gains_amount"] == "1989.28"  # NII itself is untouched
    # Scenario totals, derived: fed_ti 182176.20 -> fed 36764.788; state_ti 194761.146385
    # -> state 14506.115613805; FICA unchanged (3634.94981 + 10453.20 + 1950 — trad-401k
    # stays IN the wage bases); cg 26.8695 (same stack, lower floor, same 15% tier); niit
    # 0. Total 67335.922923805 -> 67335.92 vs baseline 72824.61.
    assert body["scenario"]["totals"]["total_tax"] == "67335.92"
    assert body["delta"]["total_tax"] == "-5488.69"
    assert Decimal(body["delta"]["total_tax"]) == Decimal(
        body["scenario"]["totals"]["total_tax"]
    ) - Decimal(body["baseline"]["totals"]["total_tax"])
```

**1e.** In `backend/tests/test_money_flow.py`, in the test asserting per-jurisdiction parity (line ~105–111), add after the `capital_gains` line: `assert flow.taxes.niit == breakdown.niit.tax`.

- [ ] **Step 2: Run to verify failure.** `cd backend && .venv/Scripts/python.exe -m pytest tests/test_taxes_api.py tests/test_money_flow.py -q` — the new tests fail on `KeyError: 'niit'` / `AttributeError: niit`; nothing else fails.

- [ ] **Step 3: Implement.**

**3a.** `backend/app/schemas/taxes.py` — in `TaxSummaryOut`, after `capital_gains`:

```python
    # NIIT (2026-08-31 spec C2), on capital_gains' wire shape so payloads and frontend
    # types extend compatibly: gains_amount carries net investment income,
    # taxable_income the surcharged base min(NII, MAGI excess), effective_rate the tax
    # over NII. Additive + defaulted: stored fixtures and older clients parse unchanged.
    niit: CapitalGainsTaxOut | None = None
```

**3b.** `backend/app/api/taxes.py` `_summary_out` — after the `capital_gains = CapitalGainsTaxOut(...)` block:

```python
    niit_line = breakdown.niit
    niit = CapitalGainsTaxOut(
        taxable_income=_money(niit_line.taxable_income),
        gains_amount=_money(niit_line.gains_amount),
        tax=_money(niit_line.tax),
        effective_rate=_effective_rate(niit_line.effective_rate, "niit", warnings),
    )
```

and add `niit=niit,` to the returned `TaxSummaryOut` between `capital_gains=capital_gains,` and `totals=totals,`. (`_missing_summary_out` needs nothing: the default `None` is exactly the refusal shape.)

**3c.** `backend/app/services/money_flow.py` — `MoneyFlowTaxes` gains `niit: Decimal` after `capital_gains`; in `compose_money_flow`'s `MoneyFlowTaxes(...)` add `niit=breakdown.niit.tax,`. `backend/app/schemas/overview.py` `MoneyFlowTaxesOut` gains `niit: Decimal` after `capital_gains`. `backend/app/api/overview.py` adds `niit=_money(flow.taxes.niit),` in the `MoneyFlowTaxesOut(...)` construction. (Reason, worth its comment in `money_flow.py`: the Overview Taxes node's tooltip enumerates the per-jurisdiction lines against `taxes.total`, which now contains NIIT — a missing line would visibly not sum.)

- [ ] **Step 4: Green + full suite.** `cd backend && .venv/Scripts/python.exe -m pytest tests/test_taxes_api.py tests/test_money_flow.py tests/test_overview_api.py -q`, then full `-q`. (`test_what_if_empty_scenario_echoes_baseline` keeps passing untouched: baseline == summary field-for-field including `niit`, and the delta dict is unchanged by design.)

- [ ] **Step 5: Ruff + commit.** `git add -A backend && git commit -m "feat(taxes): NIIT section on the summary wire + money-flow parity (C2/C5)"`

### Task 8: Safe harbor — the statutory lesser-of (C4)

**Files:** `backend/app/schemas/taxes.py`, `backend/app/api/taxes.py`, `backend/tests/test_withholding_api.py`

- [ ] **Step 1 (test-first).** In `backend/tests/test_withholding_api.py` (`world` fixture: liability 115753.20, projected 96883.00 → current leg `115753.20 × 0.90 = 104177.88`):

**1a.** REWRITE `test_withholding_safe_harbor_is_null_without_a_prior_year` (line 464):

```python
async def test_withholding_safe_harbor_stands_on_the_current_year_leg_alone(
    auth_client, world, frozen_today
):
    """C4: 90% of the CURRENT year's liability is a statutory leg of its own, so a first
    year on the app — no prior return at all — still gets a harbor. No prior-year
    warning either: a missing prior year is the normal first-year case."""
    body = await get_withholding(auth_client)
    assert body["safe_harbor"] == {
        "prior_year": None,
        "prior_total_tax": None,
        "prior_agi": None,
        "multiplier": None,
        "threshold": None,
        "prior_filing_status": None,
        "current_year_threshold": "104177.88",  # 115753.20 x 0.90
        "effective_threshold": "104177.88",
        "met": False,  # projected 96883.00 < 104177.88
    }
    assert body["warnings"] == []
```

**1b.** In `test_withholding_safe_harbor_is_110_pct_of_the_prior_year`, extend the exact dict with `"current_year_threshold": "104177.88",` and `"effective_threshold": "88718.52",` (the prior leg binds: min(88718.52, 104177.88); `met` stays True — 96883.00 clears the effective figure). Update its docstring-comment tail: the multiplier×displayed-figure invariant assertion stays byte-identical.

**1c.** In `test_withholding_safe_harbor_is_unavailable_when_the_prior_year_computes_nothing`: the expectation flips from `safe_harbor is None` to the current-only dict from 1a, and the warning string becomes the new text:

```python
    assert body["safe_harbor"]["current_year_threshold"] == "104177.88"
    assert body["safe_harbor"]["prior_year"] is None
    assert body["safe_harbor"]["met"] is False
    assert body["warnings"] == [
        f"prior year {YEAR - 1} has no computed tax — the prior-year safe-harbor leg "
        "is unavailable"
    ]
```

(and its docstring gains: "The zero-threshold guard now silences only the PRIOR leg — the current-year leg still stands.")

**1d.** In `test_withholding_safe_harbor_not_met_when_the_prior_year_was_bigger`, after the existing asserts:

```python
    # Both legs exist and the CURRENT one is smaller: 104177.88 < 127328.52 — the
    # statutory lesser-of binds on it, and met is judged there.
    assert body["safe_harbor"]["current_year_threshold"] == "104177.88"
    assert body["safe_harbor"]["effective_threshold"] == "104177.88"
```

(`met` stays False: 96883.00 < 104177.88.)

**1e.** In `test_withholding_safe_harbor_drops_to_100_pct_under_the_agi_gate`, extend the exact dict with `"current_year_threshold": "104177.88",` and `"effective_threshold": "23750.00",` (prior leg binds; met True).

**1f.** In `test_withholding_safe_harbor_gate_halves_for_married_filing_separately`, add `assert body["safe_harbor"]["effective_threshold"] == "26125.00"` after the threshold assert.

**1g.** `SAFE_HARBOR_NOT_COMPUTABLE`: verified during planning — no test pins that exact string (the only pinned safe-harbor warning is line 508's, handled in 1c), so the text change in Step 3b needs no further test edit. If a grep for `cannot be computed under its filing status` in `tests/` disagrees at implementation time, update that pin to the new text.

- [ ] **Step 2: Run to verify failure.** `cd backend && .venv/Scripts/python.exe -m pytest tests/test_withholding_api.py -q` — the six touched tests fail (missing keys / None harbor / old warning text); the rest pass.

- [ ] **Step 3: Implement.**

**3a.** `backend/app/schemas/taxes.py` — replace `SafeHarborOut` wholesale:

```python
class SafeHarborOut(BaseModel):
    """The statutory harbor is the LESSER of two legs (2026-08-31 spec C4); either can
    be missing — a first year has no prior return, a refused engine year has no current
    liability — and the surviving leg stands alone. `met` is judged on
    `effective_threshold`, always."""

    # The PRIOR-YEAR leg: 100/110% of last year's total tax. All six fields are None
    # together — a prior year that is missing, not computable under its status, or
    # computed to <= 0 has no leg (each of the last two states warns).
    prior_year: int | None = None
    prior_total_tax: Decimal | None = None
    # The AGI the statutory gate is tested against, and the multiplier it selected. Both
    # are rendered: a threshold that is not 1.10x the number beside it would otherwise
    # read as a bug.
    prior_agi: Decimal | None = None
    multiplier: Decimal | None = None  # 1.10 above the gate, 1.00 at or below it
    threshold: Decimal | None = None  # prior_total_tax x multiplier
    # The status the REFERENCE return was filed under — different from this year's on a
    # wedding year, a labelling matter the card names rather than leaving to wonder.
    prior_filing_status: str | None = None
    # The CURRENT-YEAR leg: 90% of this year's projected liability. None exactly when
    # the engine refused the year (liability_total is null on the card).
    current_year_threshold: Decimal | None = None
    effective_threshold: Decimal  # min of the legs that exist
    met: bool  # projected total withholding >= effective_threshold
```

**3b.** `backend/app/api/taxes.py` — constants (after `SAFE_HARBOR_AGI_GATE_MFS`, line 1013): add

```python
# The OTHER statutory leg (6654(d)(1)(B)(i)): 90% of the CURRENT year's liability. The
# harbor is the LESSER of the two legs; either stands alone when its sibling is missing.
SAFE_HARBOR_CURRENT_MULTIPLIER = Decimal("0.90")
```

and update the two message texts in place:

```python
SAFE_HARBOR_UNAVAILABLE = (
    "prior year {year} has no computed tax — the prior-year safe-harbor leg is unavailable"
)
SAFE_HARBOR_NOT_COMPUTABLE = (
    "prior year {year} cannot be computed under its filing status — the prior-year "
    "safe-harbor leg is unavailable"
)
```

**3c.** Replace the safe-harbor block (lines 1243–1282, from `safe_harbor = None` through the `SafeHarborOut(...)` construction) with:

```python
    # --- safe harbor (2026-08-31 spec C4): the LESSER of the two statutory legs. The
    # prior-year leg needs a computable prior return with a positive displayed total;
    # the current-year leg is 90% of THIS year's liability and stands alone when the
    # prior leg is unavailable (which is why the two warnings above name "the prior-year
    # leg", not the harbor). Neither leg -> no harbor at all.
    current_threshold = (
        None
        if liability_total is None
        else _money(liability_total * SAFE_HARBOR_CURRENT_MULTIPLIER)
    )
    prior_leg: dict | None = None
    if await db.get(TaxYear, year - 1) is not None:
        prior_feed = await _engine_feed(db, year - 1)
        if not prior_feed.computable:
            warnings.append(SAFE_HARBOR_NOT_COMPUTABLE.format(year=year - 1))
        else:
            prior = _breakdown_for(prior_feed)
            # Quantize FIRST, then multiply: the threshold has to be the multiplier times
            # the number rendered beside it, not times a full-precision figure nobody can
            # see. The AGI gate is judged on the displayed figure for the same reason —
            # and so is the current leg above (liability_total is already the card's).
            prior_total = _money(prior.totals.total_tax)
            prior_agi = _money(prior.federal.agi)
            if prior_total <= ZERO:
                # A bare tax_years row (or one whose credits swallowed the tax) makes the
                # prior comparison vacuous: any withholding clears a zero-or-negative
                # threshold, so this leg is dropped and named rather than met-by-default.
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
                prior_leg = {
                    "prior_year": year - 1,
                    "prior_total_tax": prior_total,
                    "prior_agi": prior_agi,
                    "multiplier": multiplier,
                    "threshold": _money(prior_total * multiplier),
                    "prior_filing_status": prior_feed.filing_status,
                }

    legs = [
        leg
        for leg in ((prior_leg or {}).get("threshold"), current_threshold)
        if leg is not None
    ]
    safe_harbor = None
    if legs:
        effective = min(legs)
        safe_harbor = SafeHarborOut(
            **(prior_leg or {}),
            current_year_threshold=current_threshold,
            effective_threshold=effective,
            # Judged on the DISPLAYED figures (paycheck.py's negative-net posture), so
            # the badge can never contradict the numbers rendered next to it.
            met=total_projected >= effective,
        )
```

- [ ] **Step 4: Green + full suite.** `cd backend && .venv/Scripts/python.exe -m pytest tests/test_withholding_api.py -q`, then full `-q`. The married-block tests (`test_safe_harbor_uses_110_pct...` etc.) pass untouched — they assert individual fields that survive additively.

- [ ] **Step 5: Ruff + commit.** `git add -A backend && git commit -m "feat(taxes): safe harbor takes the statutory lesser-of with a current-year leg (C4)"`

---

## Phase 4 — Frontend

### Task 9: NIIT on the charts, types, and the money-flow tooltip

**Files:** `src/types/api.ts`, `src/components/taxes/taxChartOptions.ts`, `src/components/taxes/taxChartOptions.test.ts`, `src/components/taxes/SummaryPanel.tsx`, `src/components/overview/moneyFlowOptions.ts` (+ its test file), `src/pages/TaxesPage.test.tsx`, `src/components/taxes/taxes.css` (comment only)

- [ ] **Step 1: Types (`src/types/api.ts`).** In `TaxSummaryOut`, after `capital_gains`:

```ts
  capital_gains: CapitalGainsTaxOut
  // NIIT (2026-08-31): capital_gains' wire shape — gains_amount is net investment
  // income, taxable_income the surcharged base. OPTIONAL for brackets_missing_for_status's
  // reason above: pinned fixtures predate the section, and an absent section reads as
  // zero everywhere it is charted.
  niit?: CapitalGainsTaxOut
```

In `MoneyFlowTaxes`, after `capital_gains: string`:

```ts
  // Optional for the same fixture reason; the server always sends it.
  niit?: string
```

- [ ] **Step 2: `src/components/taxes/taxChartOptions.ts`.**

**2a.** Labels/colors (the comments at lines 22–47 change from "six" to "seven"; the ramp re-spaces to seven slots, still starting at index 4 for the 3:1-on-surface floor — colors encode POSITION, so re-spacing moves no identity):

```ts
// The seven tax lines in the order the engine reports them — one order shared by the
// waterfall's steps, the trend's stack and both legends. NIIT is LAST on purpose: it is
// the one additive line, so the builders can include it conditionally by slicing.
export const TAX_LABELS = [
  'Federal',
  'State',
  'Medicare',
  'Soc. Sec.',
  'SDI',
  'Cap. gains',
  'NIIT',
] as const

export const TAX_COLORS = [
  SEQUENTIAL_BLUE[4],
  SEQUENTIAL_BLUE[5],
  SEQUENTIAL_BLUE[6],
  SEQUENTIAL_BLUE[8],
  SEQUENTIAL_BLUE[9],
  SEQUENTIAL_BLUE[10],
  SEQUENTIAL_BLUE[11],
] as const
```

(`WATERFALL_CATEGORIES` and `TAX_SERIES_IDS` derive from `TAX_LABELS` and need no edit; add to `WATERFALL_CATEGORIES`'s line the comment `// full vocabulary — the builder skips the NIIT step when the year has none`.)

**2b.** `taxAmounts` gains the seventh entry:

```ts
    Number(summary.capital_gains.tax),
    // Optional on the wire (fixtures and stored payloads predate the line): absent is 0.
    Number(summary.niit?.tax ?? 0),
```

**2c.** Waterfall — replace the span from the existing `let remainder = gross` line through the end of the `taxes.forEach((tax, i) => {...})` loop with a filtered step list (everything else in the function stays; the loop body's floating-segment comment moves inside unchanged):

```ts
  const taxSteps = taxes
    .map((tax, i) => ({ label: TAX_LABELS[i], tax, color: TAX_COLORS[i] }))
    // NIIT is the one ADDITIVE line (2026-08-31): a year it does not touch keeps its
    // eight familiar bars instead of gaining a $0 step. The six sheet jurisdictions
    // always draw, zero or not — their absence would read as missing data.
    .filter((step) => step.label !== 'NIIT' || step.tax !== 0)
  let remainder = gross
  taxSteps.forEach(({ label, tax, color }) => {
    const after = roundTo(remainder - tax, 2)
    steps.push({
      label,
      amount: tax,
      base: Math.min(remainder, after),
      height: Math.abs(roundTo(tax, 2)),
      color,
      remaining: after,
    })
    remainder = after
  })
```

(The x-axis note "Eight steps" becomes "Eight or nine steps".)

**2d.** Trend — before the `return`, compute the conditional stack set and use it for the bar series:

```ts
  const niitIndex = TAX_LABELS.indexOf('NIIT')
  // NIIT stacks only when some year carries it: an all-zero series would add a legend
  // entry and a $0.00 tooltip row to every pre-NIIT year. One nonzero year brings the
  // series for EVERY year — a stack that comes and goes across one chart would lie.
  const stacked = amounts.some((a) => a[niitIndex] !== 0)
    ? [...TAX_LABELS]
    : TAX_LABELS.slice(0, niitIndex)
```

and change the series spread to `...stacked.map((label, i) => ({ id: TAX_SERIES_IDS[i], ... }))` (body unchanged — `data: amounts.map((a) => a[i])`).

**2e.** Donut: no logic change (the `> 0` filter already implements render-only-when-nonzero over the seven slots). CSV: headers already spread `TAX_LABELS`; the row array gains `y.niit?.tax ?? '0.00'` between `y.capital_gains.tax` and `y.totals.total_tax`, with the comment `// absent (pre-NIIT payload) exports as zero — a blank would misalign the fixed header row`.

- [ ] **Step 3: `taxChartOptions.test.ts`.** Update the `CANONICAL` fixture table for 2024/2025 (`cgTax` `'26.87'` / `'190.08'`, `cgRate` `'0.150000'`, `totalTax` `'72824.61'` / `'90421.49'`, `takeHome` `'165148.56'` / `'196787.57'`, `effectiveRate` `'0.306020'` / `'0.314828'`) and add per-year niit fields — 2023: base `'0.00'`, nii `'21250.15'`, tax `'0.00'`, rate `'0.000000'`; 2024: `'1989.28'`/`'1989.28'`/`'75.59'`/`'0.038000'`; 2025: `'11023.28'`/`'11023.28'`/`'418.88'`/`'0.038000'`; 2026: `'0.00'`/`'0.00'`/`'0.00'`/`null` — mirroring the backend `_CANONICAL_TABLE` (one comment: `// mirrors backend tests/test_tax_service.py _CANONICAL_TABLE — derivations live there`). `summaryFixture` gains `niit: { taxable_income: f.niitBase, gains_amount: f.niitNii, tax: f.niitTax, effective_rate: f.niitRate }`; `emptySummary` deliberately OMITS `niit` (it pins the optional-absent path). Then update/add:

- the waterfall categories test (line ~221): `expect(categoriesOf(waterfallOption(summaryFixture(2024)))).toEqual([...WATERFALL_CATEGORIES])` (nine, NIIT present) and a sibling assertion `expect(categoriesOf(waterfallOption(summaryFixture(2026)))).toEqual(WATERFALL_CATEGORIES.filter((c) => c !== 'NIIT'))`;
- the trend series-name test (line ~328): assert stack series names equal `[...TAX_LABELS]` for a `[2024, 2026]` feed and `TAX_LABELS.slice(0, -1)` for a `[2026]`-only feed;
- the donut test (line ~429): 2024's slice names now equal `[...TAX_LABELS]` (all seven positive); add `expect(points(...)(summaryFixture(2026)))` names to NOT contain `'NIIT'`;
- the CSV test (line ~481): the row gains `y24.niit.tax` before the total; headers length 9;
- `expect(TAX_COLORS).toHaveLength(TAX_LABELS.length)` (line 257) passes as-is; the ascending-ramp test passes with the re-spaced `[4,5,6,8,9,10,11]`.

Run: `npx vitest run src/components/taxes/taxChartOptions.test.ts` → ALL PASS.

- [ ] **Step 4: `SummaryPanel.tsx`.** The Total-tax tile hint (line 167) becomes `hint="Every tax line summed: federal, state, Medicare, Social Security, SDI, capital gains — and NIIT when it applies."`; the sparse-year comment at line 185 changes "all 21 keys" → "all 22 keys" (same in `taxes.css` line 47's comment).

- [ ] **Step 5: `moneyFlowOptions.ts`.** `JURISDICTION_LINES` (line 100) gains `{ key: 'niit', label: 'NIIT' },` after `capital_gains`, its comment becoming "The Taxes tooltip's per-jurisdiction lines (seven since the NIIT split), in the engine's own order." The `taxLines` builder (line 257) skips absent values so old fixtures stay silent:

```ts
  const taxLines = JURISDICTION_LINES.filter((line) => flow.taxes[line.key] !== undefined)
    .map((line) => `${line.label} ${formatCurrency(flow.taxes[line.key])}`)
    .join('<br/>')
```

In the money-flow options test file (locate via `npx vitest run src/components/overview` failures or grep `JURISDICTION` there): add `niit: '123.45'` to one fixture's `taxes` and assert the tooltip contains `NIIT $123.45`; assert a fixture WITHOUT `niit` renders no `NIIT` line.

- [ ] **Step 6: `TaxesPage.test.tsx` fidelity.** The `MISSING_21` mock (lines 280–290) is the engine's verbatim sentence; rename to `MISSING_22`, update the comment ("all 22 of them"), and insert `capital_loss_deductions, ` between `hsa_contributions_employer, ` and `other_pretax_deductions, ` (display-only mock — the panel renders any string, but a stale mock would misdocument the engine).

- [ ] **Step 7: Frontend suites + lint.**

```bash
npx vitest run src/components/taxes src/components/overview src/pages/TaxesPage.test.tsx
npm run lint
```

Expected: ALL PASS, lint clean.

- [ ] **Step 8: Commit.** `git add src && git commit -m "feat(taxes-ui): NIIT slice across waterfall/trend/donut/CSV + money-flow tooltip line"`

### Task 10: WithholdingPanel — lesser-of safe-harbor copy

**Files:** `src/types/api.ts`, `src/components/taxes/WithholdingPanel.tsx`, `src/components/taxes/WithholdingPanel.test.tsx`

- [ ] **Step 1: Type.** In `src/types/api.ts` `WithholdingOut.safe_harbor`, replace the object type (lines 857–867):

```ts
  // Null only when NEITHER statutory leg exists (no computable prior year AND the engine
  // refused this year). The prior-leg fields are null together when that leg is missing
  // (first year, refused prior year, or a prior total <= 0 — the last two warn).
  safe_harbor: {
    prior_year: number | null
    prior_total_tax: string | null
    prior_agi: string | null // the AGI the statutory gate was tested against
    multiplier: string | null // 1.10 above the IRC 6654(d)(1)(C) AGI gate, 1.00 at/below
    threshold: string | null // prior_total_tax x multiplier
    prior_filing_status: string | null
    current_year_threshold: string | null // 90% of this year's liability; null on refusal
    effective_threshold: string // min of the legs that exist — `met` is judged on it
    met: boolean // total.projected >= effective_threshold
  } | null
```

- [ ] **Step 2 (test-first): `WithholdingPanel.test.tsx`.** The `fixture()` safe_harbor gains `current_year_threshold: '111111.10',` (123456.78 × 0.90) and `effective_threshold: '111111.10',` (current binds under prior's 121000.00). Then:

- the two pinned sentences at lines 187 and 209 become the lesser-of form:
  - not-covered (default fixture: prior threshold 121000.00, current 111111.10 → current binds): `"Safe harbor (approx.): the lesser of 110% of 2025's total tax ($121,000.00) and 90% of this year's projected liability ($111,111.10) is $111,111.10 — the current-year leg binds; NOT covered by projected withholding"`
  - covered (the 209 case's override keeps `prior_total_tax: '90000.00', threshold: '99000.00', met: true`; give it `current_year_threshold: '111111.10', effective_threshold: '99000.00'` — the prior leg is the lesser): `"Safe harbor (approx.): the lesser of 110% of 2025's total tax ($99,000.00) and 90% of this year's projected liability ($111,111.10) is $99,000.00 — the prior-year leg binds; covered by projected withholding"`
- the 100%-multiplier test (line ~475) keeps its fixture override and becomes: `"Safe harbor (approx.): the lesser of 100% of 2025's total tax ($110,000.00) and 90% of this year's projected liability ($111,111.10) is $110,000.00 — the prior-year leg binds; NOT covered by projected withholding"` (add `current_year_threshold: '111111.10', effective_threshold: '110000.00'` to its safe_harbor override).
- NEW: current-leg-only case —

```tsx
  it('renders the current-year leg alone when there is no prior return', async () => {
    vi.mocked(fetchWithholding).mockResolvedValue(
      fixture({
        safe_harbor: {
          prior_year: null, prior_total_tax: null, prior_agi: null, multiplier: null,
          threshold: null, prior_filing_status: null,
          current_year_threshold: '111111.10', effective_threshold: '111111.10',
          met: false,
        },
      }),
    )
    render(<WithholdingPanel year={2026} />)
    expect(
      await screen.findByText(
        "Safe harbor (approx.): 90% of this year's projected liability is $111,111.10 — NOT covered by projected withholding",
      ),
    ).toBeTruthy()
    // No prior return -> no wedding-year note either.
    expect(screen.queryByText(/still the legal safe harbor/)).toBeNull()
  })
```

- NEW: prior-leg-only case (engine refused the year) —

```tsx
  it('renders the prior-year leg alone when the engine refused this year', async () => {
    vi.mocked(fetchWithholding).mockResolvedValue(
      fixture({
        liability_total: null,
        balance_projected: null,
        safe_harbor: {
          prior_year: 2025, prior_total_tax: '110000.00', prior_agi: '400000.00',
          multiplier: '1.10', threshold: '121000.00', prior_filing_status: 'single',
          current_year_threshold: null, effective_threshold: '121000.00', met: false,
        },
      }),
    )
    render(<WithholdingPanel year={2026} />)
    expect(
      await screen.findByText(
        "Safe harbor (approx.): 110% of 2025's total tax is $121,000.00 — NOT covered by projected withholding",
      ),
    ).toBeTruthy()
  })
```

- `renders NOTHING about safe harbor when the server sent none` stays byte-identical (`safe_harbor: null` is still the neither-leg state).

Run `npx vitest run src/components/taxes/WithholdingPanel.test.tsx` → the touched cases FAIL against the current copy.

- [ ] **Step 3: Implement `WithholdingPanel.tsx`.** Above the component, add:

```tsx
// The statutory harbor is the LESSER of two legs; either can be missing (a first year
// has no prior return, a refused engine year has no liability — the server sends null
// only when BOTH are). The server judged `met` on effective_threshold; this sentence
// only narrates which leg that figure came from, so it can never contradict the badge.
// The 90% literal matches the server's SAFE_HARBOR_CURRENT_MULTIPLIER (the
// supplemental-rates sentence below sets the precedent for statutory literals in copy).
function safeHarborSentence(harbor: NonNullable<WithholdingOut['safe_harbor']>): string {
  const prior =
    harbor.prior_year === null || harbor.multiplier === null || harbor.threshold === null
      ? null
      : `${formatPct(harbor.multiplier, { signed: false, decimals: 0 })} of ` +
        `${harbor.prior_year}'s total tax`
  const current =
    harbor.current_year_threshold === null ? null : "90% of this year's projected liability"
  const met = harbor.met
    ? 'covered by projected withholding'
    : 'NOT covered by projected withholding'
  const effective = formatCurrency(harbor.effective_threshold)
  if (prior !== null && current !== null) {
    // Ties mark the current-year leg — the two figures are equal, so the label is moot.
    // formatCurrency already accepts the nullable wire fields (the partner rows' idiom);
    // both are non-null in this branch by the leg checks above.
    const binding =
      harbor.effective_threshold === harbor.current_year_threshold
        ? 'current-year'
        : 'prior-year'
    return (
      `Safe harbor (approx.): the lesser of ${prior} (${formatCurrency(harbor.threshold)}) ` +
      `and ${current} (${formatCurrency(harbor.current_year_threshold)}) is ${effective} — ` +
      `the ${binding} leg binds; ${met}`
    )
  }
  // One leg missing: the survivor's own figure IS the effective threshold, so it is
  // named once. (Both missing never reaches here — the server sends null instead.)
  return `Safe harbor (approx.): ${prior ?? current} is ${effective} — ${met}`
}
```

Replace the safe-harbor paragraph (lines 268–282) with:

```tsx
          {withholding.safe_harbor !== null && (
            <p className="hint">
              {safeHarborSentence(withholding.safe_harbor)}
              <InfoHint text="Real safe harbor is per-jurisdiction; this compares all-in totals — approximate by construction. The statutory harbor is the LESSER of last year's 100/110% figure and 90% of this year's liability." />
            </p>
          )}
```

and guard the wedding-year note (line 287–288) with the nullable status:

```tsx
          {withholding.safe_harbor !== null &&
            withholding.safe_harbor.prior_filing_status !== null &&
            withholding.safe_harbor.prior_filing_status !== withholding.filing_status && (
```

(the comment above it gains: "Skipped entirely when the prior leg is missing — there is no reference return to label."). Update the big comment above the block (lines 261–267): "Nothing at all when the server sent none" now means "neither statutory leg exists"; the multiplier sentence stays.

- [ ] **Step 4: Green + lint.** `npx vitest run src/components/taxes/WithholdingPanel.test.tsx` → ALL PASS; `npm run lint` → clean; then the full `npm test` → record the new N_vt.

- [ ] **Step 5: Commit.** `git add src && git commit -m "feat(taxes-ui): safe-harbor copy shows both statutory legs with the binding one marked (C4)"`

---

## Phase 5 — Documentation + final audit

### Task 11: README divergences + engine docstring + derivation-comment audit

**Files:** `README.md`, `backend/app/services/tax_service.py` (module docstring), `backend/tests/test_tax_service.py` (module docstring)

- [ ] **Step 1: README §7.5.** Update the Taxes row's Expected cell to: `2024 matches the sheet **to the cent except the state chain and the CG/NIIT split** (both deliberate, below); 2023 / 2025 / 2026 differ by the known sheet drifts (below), plus the CA divergence and the NIIT line where the year carries gains/investment income`. Then, after the existing five-divergences paragraph, append:

```markdown
**Three more deliberate divergences (2026-08-31, tax-engine completeness):**

- **NIIT as an explicit line.** The sheet folded the 3.8% surcharge into its CG bracket
  rates (18.8/23.8) and never tested the income side; the app stores base CG rates —
  migration `f7d3b2a91c40` rewrote the exact folded pair, the importer translates it on
  every re-import, and a warning flags any leftover — and computes
  NIIT = 3.8% × min(net investment income, MAGI − threshold) as its own line. At the
  stored inputs: 2024 +75.59 NIIT / −6.81 CG (net **+68.79** total tax vs the sheet,
  total 72,824.61); 2025 +418.88 / −48.15 (net **+370.73**, total 90,421.49); 2023 sits
  under the threshold and 2026 has no investment income — both unchanged.
- **Capital-loss deduction reaches AGI.** The sheet modelled `capital_loss_deductions`
  (r27) and read it in no output formula; the app subtracts it in federal AGI, the state
  chain and MAGI (CA conforms to the $3k rule). Stored years all carry 0, so no
  historical total moved — future loss years will differ from the sheet by design.
- **SALT phase-down on true MAGI.** The >500k phase-down of the raised cap now tests
  AGI + netted capital gains, so a CG-heavy year's itemized *suggestion* can shrink
  toward the $10k floor where the old code (plain AGI) would not.

**Do not "fix" any of these** — the same rule as the five above.
```

- [ ] **Step 2: README §7.6 addendum** (the migration-chain convention — append after the 2026-08-28 addendum, or the newest one present):

```markdown
> **Addendum (2026-08-31)**: the tier-1 tax-completeness batch adds one **guarded data
> migration** — `f7d3b2a91c40`, chained on `e4a7c92b6d18` — rewriting exact folded
> capital-gains rates (`0.1880 → 0.1500`, `0.2380 → 0.2000`, all years and statuses) now
> that NIIT is computed as its own line. It runs at boot like every other; the downgrade
> restores the folded pair under the same exact-match guard (documented asymmetry: a
> genuinely-base-rate year re-folds on downgrade, which the old engine's advisory then
> names). After deploy, /taxes totals for investment-income years shift by the NIIT
> entries in §7.5 — expected, not a regression.
```

- [ ] **Step 3: Engine + golden-suite docstrings.** `backend/app/services/tax_service.py` module docstring, after the CA-CG sentence ("...in every year unconditionally)."), insert: `The 2026-08-31 completeness batch (spec C1–C3) adds three more deliberate corrections the sheet never made: NIIT computed as an explicit line over base CG rates (the sheet folded 3.8% into brackets 2/3), capital_loss_deductions wired into AGI (the sheet modelled the line and read it nowhere), and the SALT phase-down tested on true MAGI.` `backend/tests/test_tax_service.py` module docstring: extend the "canonical goldens" bullet with `(NIIT and the base-rate CG stack included since 2026-08-31 — the fixtures model the post-f7d3b2a91c40 database)`.

- [ ] **Step 4: Derivation-comment audit (C5's discipline check).** Grep the diff for every golden literal this plan moved and confirm each sits under a derivation comment: `git diff main -- backend/tests/test_tax_service.py backend/tests/test_tax_service_married.py backend/tests/test_taxes_api.py backend/tests/test_withholding_api.py | grep -E "^\+.*(72824|90421|165148|196787|26\.87|190\.08|75\.59|418\.88|1824|6750|93943|254056|104177|88718|111111|5488)"` — every hit must trace to a comment deriving it (this plan wrote one at each site; the audit catches paste drift).

- [ ] **Step 5: Commit.** `git add README.md backend && git commit -m "docs(taxes): NIIT/capital-loss/SALT-MAGI divergence entries + migration addendum"`

### Task 12: Full verification

**Files:** none

- [ ] **Step 1: Backend.**

```bash
cd backend && .venv/Scripts/python.exe -m pytest -q
cd backend && .venv/Scripts/python.exe -m ruff check app tests
```

Expected: ALL PASS; ruff clean. Reconcile the count vs Task 0's N_py explicitly in the report. Expected net movement, per task (pytest counts parametrized cases individually): Task 2 main file +2 (three new NIIT unit tests; three advisory tests became two), married +5 (two advisory tests became one 7-case parametrization); Task 4 +1; Task 5 +3 (one test became three, plus the married MFS case); Task 6 +1; Task 7 +2 (folded-advisory wire + what-if crossing; the niit-section and money-flow asserts ride existing tests); Task 8 +0 (all rewrites in place) — net **+14**. Any other delta means a test was added or lost off-plan: name it.

- [ ] **Step 2: Frontend.**

```bash
npm test
npm run lint
```

Expected: ALL PASS (vs N_vt: + the new chart/withholding/money-flow cases), lint clean.

- [ ] **Step 3: Migration state check** (only if Task 3 Step 2 ran): `cd backend && .venv/Scripts/python.exe -m alembic current` → `f7d3b2a91c40 (head)`. If Task 3's smoke was deferred, say so loudly in the report — the batch's final live-migration check owns it.

- [ ] **Step 4: Report.** Task-by-task summary; final counts vs baselines; the goldens that moved (2024/2025 totals, MFJ reference, safe-harbor pins, wire strings) each with its derivation reference; any literal that disagreed with this plan's oracle table (there should be none — they are machine-derived); deferred steps.

---

## Self-Review (performed)

**Spec C1–C5 coverage → tasks:**
- C1 (`_cg_amount` + `_magi`, three consumers): Task 1 (extraction, no-behavior pin), Task 2 (NIIT consumer via `_magi`), Task 6 (SALT consumer + shrink-toward-floor test). ✓
- C2 (NIIT line, `TaxBreakdown.niit`, totals/take-home inclusion, `TaxSummaryOut.niit` on capital_gains' shape, chart slice/bar nonzero-only, folded-rate migration + importer translation + advisory rewrite + `NIIT_WARNING` text): Tasks 2, 3, 4, 7, 9. ✓
- C3 (`capital_loss_deductions` into `ENGINE_INPUT_KEYS` + `_federal_agi`, state inherits via fed_agi, two never-blocking warnings, docstring inversion, no inputs-form change): Task 5. ✓ The task-5→NIIT/SALT interaction (MAGI inherits the loss via `_federal_agi` — statutorily correct) is stated in the Architecture paragraph, in `_magi`'s docstring, and pinned by `test_capital_loss_pulls_magi_under_the_niit_threshold`.
- C4 (lesser-of; `SafeHarborOut.current_year_threshold` + `effective_threshold`; `met` on effective; 90%-current stands alone without a prior year; panel copy shows both legs, binding marked): Tasks 8, 10. ✓
- C5 (every moved golden carries a derivation comment; README §7.5 entries for NIIT / capital-loss / CG-year SALT; importer translation pinned test; what-if unchanged + one threshold-crossing pin): derivations embedded in Tasks 2/5/7/8, audit in Task 11 Step 4, README in Task 11, importer pin in Task 4, what-if pin in Task 7 Step 1d. ✓

**Prompt's critical correctness notes, encoded:** NII formula (oracle table + Task 2 Step 3d code + `test_niit_line_2024_hand_derivation`); NIIT formula with `NIIT_AGI_THRESHOLDS` (same, plus the status parametrization); MAGI = `_federal_agi + cg_amount` with the post-C3 loss inheritance (stated three places); capital-loss warnings never block (both tests assert verbatim use); migration/importer exact-match only (both code blocks + the 0.1881/0.15-untouched pins); totals/take-home include NIIT (identity assertions in Task 2 Step 1f); `capital_gains` `JurisdictionResult` untouched (deliberately-untouched list).

**Order adjustments vs the prompt's suggestion, justified in Architecture:** (2)+(3) merged into atomic Task 2 (no green midpoint exists between the NIIT line, the advisory rewrite and the fixture flip — `assert_canonical` pins `warnings == []`); golden updates ride their causing task instead of a late task 11 (every task must end green — the API wire pins move at Task 2 because `test_taxes_api` imports the flipped `YEAR_BRACKETS`); task 11 becomes the audit + README. Money-flow `niit` field added (Tasks 7/9) — a code-discovered consumer of `totals.total_tax` whose tooltip would otherwise stop summing; additive and warned-about nowhere else in the spec, flagged here as the one scope addition.

**Placeholder scan:** no TODO/TBD/`...`-as-code outside one labelled elision inside an otherwise-complete replacement block (Task 2 Step 1b's `...` between `_CANONICAL_TABLE` rows — the surrounding instruction names exactly which rows change and that the rest stay byte-identical). Every command is concrete; every expected value is a specific literal from the machine-verified oracle run (`compute_breakdown` executed over the pinned fixtures during planning).

**Type/name consistency (exact identifiers, used identically across layers):** engine `NIIT_RATE`, `FOLDED_CG_RATES`, `BASE_CG_RATES`, `FOLDED_TO_BASE_CG`, `NIIT_WARNING`, `CAPITAL_LOSS_POSITIVE_WARNING`, `CAPITAL_LOSS_LIMIT_WARNING`, `_cg_amount`, `_magi`, `TaxBreakdown.niit` (a `JurisdictionResult`: `gains_amount`=NII, `taxable_income`=base) → schema `TaxSummaryOut.niit: CapitalGainsTaxOut | None` → TS `TaxSummaryOut.niit?: CapitalGainsTaxOut` (same four field names on the wire: `taxable_income`/`gains_amount`/`tax`/`effective_rate`); money-flow `MoneyFlowTaxes.niit` → `MoneyFlowTaxesOut.niit` → TS `MoneyFlowTaxes.niit?` → tooltip key `'niit'`; safe harbor `SAFE_HARBOR_CURRENT_MULTIPLIER`, `SafeHarborOut.current_year_threshold`/`effective_threshold` (nullable prior-leg sextet) → TS mirror in `WithholdingOut['safe_harbor']`; migration `f7d3b2a91c40` referenced by that exact id in the engine comment, advisory docstring, importer comment, README addendum and test comments. Frontend label `'NIIT'` shared by `TAX_LABELS` and `JURISDICTION_LINES`.

**Known residual risks, named:** (1) the withholding married-world seeds were verified NII-free by reading (W-2 and tracker keys only), and Task 2 Step 6's full-suite run is the guarantee; (2) if `alembic heads` disagrees with `e4a7c92b6d18`, Task 0 Step 2 owns the substitution rule; (3) the money-flow options test file's exact name was not pinned here — Task 9 Step 5 locates it by grep before editing.
