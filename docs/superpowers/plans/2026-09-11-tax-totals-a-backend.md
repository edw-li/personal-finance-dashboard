# Lane A — computed tax totals, backend (2026-09-11) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (one
> implementer for this lane in its own worktree, TDD per task, then a spec-compliance review and a
> code-quality review, then merge to local main — never pushed). Steps use `- [x]` checkboxes.

**Spec:** `docs/superpowers/specs/2026-09-11-computed-tax-totals-and-per-person-payroll-tables-design.md`
— this lane implements **Part 1 §1.1–1.6 and §1.8 (backend)**. Read §0 and §1 of the spec before
Task 1; the spec is authoritative where this plan is silent.

**Goal:** the nine derived tax-input totals are computed by the engine from their components, never
stored, never accepted on a write, and served (plus a live preview) by the inputs API.

**Architecture:** two pure functions in `tax_service.py` (`materialize_person`,
`materialize_household`) own the nine formulas; `compute_breakdown` rebuilds the five household
totals itself and takes the four per-person totals from the earner bundles; the API's assembly door
(`_assemble_inputs` / `_assemble_earners` / `EngineFeed.person_inputs`) materializes each person's
bucket before summing; a data migration deletes the stored rows; the PUT, the what-if overrides and
the importer refuse or skip derived keys.

**Tech stack:** FastAPI + SQLAlchemy async + Alembic + pytest (`backend/`). Python 3.12, ruff.

---

## Mechanics (read once)

- Worktree: `C:/Users/edyli/personal-finance-dashboard/.worktrees/tax-a`, branch
  `tax/a-computed-totals-backend`, cut from `main`. Work ONLY inside it.
- Python: the shared venv `C:/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe`
  (call it `$PY`). Run every backend command with cwd `= <worktree>/backend`. First command of the
  lane: `$PY -c "import app, sys; print(app.__file__)"` — it MUST print the worktree's path.
- Test database: `FINANCE_TEST_DB=finance_test_taxa` on every pytest call (conftest creates it).
  Postgres is the dev container on `127.0.0.1:5433` (`finance`/`finance`).
- Tests: `FINANCE_TEST_DB=finance_test_taxa $PY -m pytest tests/<file>.py -q` per task; the full
  suite once at the end (~16 min). Never pipe a gate through `tail`/`head`; read the exit code.
- Lint: `$PY -m ruff check app tests && $PY -m ruff format --check app tests` before every commit.
- Migration drill (Task 7): a scratch DB of your own, never the dev `finance` DB:
  `DATABASE_URL=postgresql+asyncpg://finance:finance@localhost:5433/finance_test_taxa_mig $PY -m alembic upgrade head`
  (create the DB first with the asyncpg one-liner in Task 7). The dev DB is migrated by lane V.
- Commits: small, `feat(taxes): …` / `test(taxes): …` / `refactor(taxes): …`; never push; never
  delete files, branches or databases (lane V's morning list owns deletions).
- Golden rule: `tests/test_tax_service.py` canonical goldens (2023–2026) and
  `test_golden_2024_equals_sheet_cached_values` pass with **unchanged fixtures and expected values**.
  If one moves, stop and report — do not edit a fixture to make it pass.

## Contracts this lane publishes (lane B builds against them verbatim)

```
TaxInputItemOut  += formula: str | None          # derived: FORMULA_CAPTIONS[key]; else null
                    value (derived): computed 4dp for THIS column, or null when none of the
                                     key's components has a stored row in that column
                    suggested (derived): always null
POST /taxes/years/{year}/inputs/preview   body: TaxInputsIn (values + rows, the PUT body)
  -> DerivedPreviewOut { year: int, filing_status: str,
                         derived: [ { key: str, person_id: int | None, value: Decimal | None } ] }
  404 unknown year · 422 exactly as the PUT (unknown key, unit bounds, derived key in body)
  no write, no ChangeBatch, no change-log row
PUT /taxes/years/{year}/inputs  — a derived key anywhere in the body -> 422:
  "{label} is computed from its components ({component labels}) — edit those instead"
POST /taxes/what-if — a derived override key -> 422:
  "{label} is computed from its components ({component labels}) — override those instead"
```

---

## Task 1 — vocabulary in `tax_keys.py`

**Files:** modify `backend/app/tax_keys.py`; create `backend/tests/test_tax_keys.py`.

- [x] Add, after `PER_PERSON_KEYS`:
  - `DERIVED_KEYS: tuple[str, ...]` = keys whose definition tuple has `is_derived=True`, in
    definition order (a comprehension over `TAX_INPUT_DEFINITIONS`, not a hand list).
  - `PER_PERSON_DERIVED_KEYS: tuple[str, ...]` = `tuple(k for k in DERIVED_KEYS if k in PER_PERSON_KEYS)`
    — must equal `("gross_paycheck", "latest_w2_income", "other_w2_income", "other_pretax_deductions")`.
  - `HOUSEHOLD_DERIVED_KEYS` = the other five, in dependency order:
    `("ltcg_total", "unqualified_dividends", "interest_total", "stcg_total", "itemized_deduction")`.
  - `DERIVED_COMPONENTS: dict[str, tuple[str, ...]]` — spec §1.1: the ENTERED keys each formula
    reads, transitively expanded so no entry is derived:
    `gross_paycheck → (annual_salary,)`; `latest_w2_income → (pay_periods, annual_salary)`;
    `other_w2_income → (w2_stock_rsus_sold, w2_bonuses, w2_salary_checkpoint, w2_espp_sale_component, w2_employer_hsa, w2_other)`;
    `other_pretax_deductions → (pretax_dental, pretax_vision)`;
    `ltcg_total → (ltcg_brokerage, ltcg_espp_component)`;
    `unqualified_dividends → (unq_div_us_treasuries_etf, unq_div_other)`;
    `interest_total → (interest_standard, interest_us_treasuries)`;
    `stcg_total → (stcg_standard, stcg_espp_component, ltcg_brokerage, ltcg_espp_component)`;
    `itemized_deduction → (itemized_salt, itemized_donations, itemized_vehicle_reg, itemized_other)`.
  - `FORMULA_CAPTIONS: dict[str, str]` — the nine captions in spec §1.1, verbatim.
  - `def is_derived_key(key: str) -> bool` and `def component_labels(key: str) -> str` (the
    components' labels via `_LABELS`, joined by ", " — the text the 422 sentences interpolate).
- [x] Tests (`test_tax_keys.py`): `DERIVED_KEYS` is exactly the nine; `PER_PERSON_DERIVED_KEYS` is
  the four; every component key exists in `TAX_INPUT_DEFINITIONS` and none is derived; every
  derived key has a caption; `component_labels("other_w2_income")` starts with "W2: Stock/RSUs Sold".
- [x] Commit: `feat(taxes): derived-key vocabulary — DERIVED_KEYS, components, formula captions`.

## Task 2 — `materialize_person` / `materialize_household` (spec §1.2)

**Files:** modify `backend/app/services/tax_service.py` (the `derive_suggestions` region, ~l.720–830);
modify `backend/tests/test_tax_service.py` (the `derive_suggestions()` test block, ~l.900–1010).

- [x] Write the failing tests first, in a new block `# materialize_*()` placed where the
  `derive_suggestions()` block is:
  - `test_materialize_reproduces_every_derived_fixture_cell` — parametrized over `YEARS`: build the
    person dict from `YEAR_INPUTS[year]`, run `materialize_person` then `materialize_household`, and
    assert every `DERIVED_KEYS` value equals `YEAR_INPUTS[year][key]` **except** `itemized_deduction`
    for 2025/2026, which must equal the fixture minus its `itemized_sec199a_div` (6.222 → 27207.06;
    the spec 4h rule). Include 2023 and 2026 — this is the precision pin (54375.0000, 157441.6667).
  - `test_materialize_person_multiplies_the_unquantized_paycheck` —
    `{"annual_salary": 145000, "pay_periods": 9}` → `gross_paycheck == 6041.6667`,
    `latest_w2_income == 54375.0000` (not 54375.0003).
  - `test_materialize_replaces_whatever_came_in_under_a_derived_key` — a dict carrying
    `other_w2_income: 999999` and components summing to 50 comes back with 50.
  - `test_materialize_household_order` — `stcg_total` nets against the REBUILT `ltcg_total`, not a
    stale stored one (stale `ltcg_total: 0`, components `ltcg_brokerage: -670`, `stcg_standard: 1000`
    → `stcg_total == 330`).
  - `test_materialize_household_itemized_reads_magi_from_the_rebuilt_totals` — a CG-heavy dict whose
    SALT phase-down only bites once `ltcg_total` is rebuilt.
  - `test_per_person_before_household_sum` — two buckets `(pay_periods 20, salary 188930)` and
    `(pay_periods 4, salary 24000)`: the sum of the two materialized `latest_w2_income` values is
    `161441.6667`, and materializing the SUMMED components instead would give `24 × 212930/24`; assert
    the former.
  - Every returned derived value has exponent −4 (`as_tuple().exponent == -4`).
- [x] Implement. `materialize_person(values)`: copy; compute `gross = annual_salary / PAYCHECKS_PER_YEAR`
  at full precision; write `gross_paycheck = q4(gross)`, `latest_w2_income = q4(pay_periods × gross)`,
  `other_w2_income = q4(sum of six)`, `other_pretax_deductions = q4(dental + vision)`. Missing keys
  read 0. `materialize_household(year, values, filing_status)`: copy; `ltcg_total`,
  `unqualified_dividends`, `interest_total` as sums; `stcg_total` by the existing netting rule over
  the REBUILT `ltcg_total`; then, if `"w2_income"` is not in the dict, set
  `values["w2_income"] = latest_w2_income + other_w2_income` (see Task 3 for why the engine may have
  set it already); `itemized_deduction` via the existing `salt_cap(year, status, _magi(value))` +
  donations + vehicle + other. Quantize each derived value 4dp HALF_UP as its last step
  (`SUGGESTION_QUANTUM`). `q4` is a module helper.
- [x] Shrink `derive_suggestions` to `capital_loss_deductions` only (it still reads
  `stcg_standard + stcg_espp_component` and the REBUILT `ltcg_total`: call `materialize_household`
  internally, or take the materialized dict — pick one and document it). `SUGGESTION_KEYS` becomes
  `("capital_loss_deductions",)`. Update the old `derive_suggestions` tests: the nine-key
  reproduction tests move to the `materialize_*` block above; `test_suggestion_gross_paycheck_always_divides_by_24`
  becomes a `materialize_person` test; `test_capital_loss_*` and `test_derive_suggestions_defaults_to_single`
  stay on `derive_suggestions`.
- [x] Run `tests/test_tax_service.py` and `tests/test_tax_service_married.py`; goldens untouched.
- [x] Commit: `feat(taxes): materialize_person/materialize_household own the nine derived formulas`.

## Task 3 — the engine rebuilds household totals and reads wages from the bundles (spec §1.3)

**Files:** modify `backend/app/services/tax_service.py` (`compute_breakdown`, `earner_from_inputs`,
`_federal_agi`, `shift_earners`, the warnings block); tests in `backend/tests/test_tax_service.py`
and `backend/tests/test_tax_service_married.py`.

- [x] Failing tests:
  - `test_engine_overwrites_a_stale_household_total` — 2024 inputs with `ltcg_total` replaced by
    `999999`: `compute_breakdown` equals the golden breakdown field-for-field.
  - `test_engine_rebuilds_a_stale_per_person_total_on_the_single_path` — 2024 inputs with
    `other_w2_income: 0` and `latest_w2_income: 0` (components intact, `earners=None`): equals the golden.
  - `test_two_earner_wages_come_from_the_bundles` — two `EarnerWages` bundles plus a flat dict whose
    W-2 totals are zero: `medicare.w2_income`, `totals.gross_income` and `federal.agi` all reflect the
    bundle sum.
  - `test_missing_warning_names_a_derived_key_only_when_every_component_is_absent` — a dict with
    `w2_bonuses` alone present: `other_w2_income` is NOT in the missing list; a dict with none of the
    six: it IS (by key, in the existing sentence).
  - `test_deduction_warning_reads_components` — no `standard_deduction`, one `itemized_salt` row: the
    deduction warning does NOT fire; with neither: it fires.
  - Existing goldens unchanged (`assert_canonical` for all four years, `warnings == []`).
- [x] Implement in `compute_breakdown`, in this order:
  1. missing-key sweep as today, but a derived member of `ENGINE_INPUT_KEYS` is "missing" only when
     every key in `DERIVED_COMPONENTS[key]` is absent from `inputs` (then it is named by key as now);
     a derived key with any component present is neither named nor defaulted here (materialization
     writes it). `DEDUCTION_MISSING_WARNING` fires when `standard_deduction` is absent AND no key in
     `DERIVED_COMPONENTS["itemized_deduction"]` is present; `itemized_deduction` itself is never in
     the muted list.
  2. `bundles = [earner_from_inputs(values)] if earners is None else list(earners)` — moved UP from
     the FICA section; `earner_from_inputs` now calls `materialize_person(values)` first.
  3. `values["w2_income"] = Σ bundle.w2_wages`; `values["other_pretax_deductions"] = Σ bundle.other_pretax`.
  4. `values = materialize_household(year, values, filing_status)` (leaves `w2_income` alone because
     it is present).
  5. `_federal_agi(value)` reads `value("w2_income")` in place of `latest_w2_income + other_w2_income`;
     `gross_income` uses `values["w2_income"]` likewise. `w2_income` is a synthetic key — never in
     `ENGINE_INPUT_KEYS`, never in the definitions, never serialized.
  6. The FICA section reuses `bundles` (no second construction).
- [x] `shift_earners(earners, before, after)` → `shift_earners(earners, primary_before, primary_after)`:
  the head bundle is `earner_from_inputs(primary_after)`; `primary_after` is built by the caller
  (Task 6) as the primary's component bucket plus the scenario's per-person deltas. Keep the
  `None`/empty passthrough. Update `test_tax_service_married.py`'s shift tests accordingly.
- [x] Run both engine test files + `tests/test_money_flow.py` (it calls `compute_breakdown`).
- [x] Commit: `feat(taxes): engine materializes household totals and reads wages from the earner bundles`.

## Task 4 — the assembly door (spec §1.4): `_assemble_*`, `EngineFeed.person_inputs`, withholding

**Files:** modify `backend/app/api/taxes.py` (`EngineFeed`, `_assemble_inputs`, `_assemble_earners`,
`_engine_feed`, `_inputs_payload`, the withholding block around `_bucket_input_rows`/`_wage_base`);
tests in `backend/tests/test_taxes_api.py`, `backend/tests/test_withholding_api.py`.

- [x] Failing tests:
  - `test_summary_computes_totals_from_components_alone` (taxes API): PUT only COMPONENT keys of the
    2024 fixture (drop the nine); the summary equals the 2024 golden cents.
  - `test_partner_wage_base_is_computed_from_components` (withholding API): a joint year where the
    partner has `w2_stock_rsus_sold` + `annual_salary`/`pay_periods` rows and NO stored totals; the
    card's partner wage base equals `latest + other` as materialized.
  - `test_get_inputs_serves_computed_values_and_captions` — derived items carry the computed
    `value`, `suggested is None`, `formula == FORMULA_CAPTIONS[key]`; a derived key whose components
    are all absent in that column has `value is None`; per-person derived items differ per column.
  - Update `test_get_inputs_echoes_values_and_suggestions`, `test_suggestions_are_computed_per_column`
    and any test asserting a chip on a derived key: chips remain only for `capital_loss_deductions`,
    `annual_salary` (profile) and the three carry-forward keys.
- [x] Implement: a helper `_materialized_buckets(rows, columns) -> dict[int | None, dict]` that
  buckets rows by `_owner_column`, drops OFF_RETURN, applies `materialize_person` to each per-person
  bucket; `_assemble_inputs` sums per-person keys from those buckets (household keys verbatim) —
  NOTE: only per-person keys are summed; household keys are not bucketed; `_assemble_earners` builds
  bundles from the same buckets (unchanged `None` rule). `EngineFeed.person_inputs` carries the
  buckets. `_inputs_payload`: for a derived item, `value` = the bucket's materialized value when any
  component of it has a row in that column (household derived: any component row at all), else
  `None`; `suggested=None`; `formula=FORMULA_CAPTIONS[key]`; the suggestion map now comes from the
  shrunken `derive_suggestions` (capital loss), the profile salary and the carry-forwards.
  Withholding: `_bucket_input_rows(feed.rows)` → `feed.person_inputs`; `_wage_base` unchanged in
  shape. The Overview's `_salary_by_person` (`backend/app/api/overview.py` ~l.43–70) iterates
  `feed.rows` for `SALARY_KEYS`, which include the derived `latest_w2_income` — switch it to
  `feed.person_inputs` (test in `backend/tests/test_overview_api.py`: a two-earner year whose
  partner has only components still splits the salary node). Any other reader of `feed.rows` for
  money stays only if it reads tracker-only keys.
- [x] Commit: `feat(taxes): assembly door materializes per-person buckets; payload serves computed totals`.

## Task 5 — PUT refusal + preview endpoint (spec §1.5–1.6)

**Files:** modify `backend/app/schemas/taxes.py` (`TaxInputItemOut.formula`, new
`DerivedPreviewItemOut`, `DerivedPreviewOut`), `backend/app/api/taxes.py` (`put_inputs`, new
`preview_inputs`); tests in `backend/tests/test_taxes_api.py`.

- [x] Failing tests:
  - `test_put_inputs_refuses_a_derived_key_without_partial_write` — body `{other_w2_income: 1}` plus a
    valid key: 422 with the exact sentence (label + component labels), and the valid key was NOT
    written; also a derived key inside `rows`.
  - `test_preview_returns_derived_values_without_writing` — stored 2024 components; POST preview with
    `w2_bonuses` changed: `derived` carries the new `other_w2_income` and the unchanged others;
    `tax_inputs` row count and `change_batches` (or the change-log table the repo uses) unchanged;
    a null body value previews the key as unset.
  - `test_preview_per_person_columns` — joint year: each person's `other_w2_income` in `derived`
    carries their own `person_id`.
  - `test_preview_404_and_422_match_the_put` — unknown year 404; unknown key / out-of-unit / derived
    key → the PUT's own sentences.
- [x] Implement `preview_inputs`: `@router.post("/years/{year}/inputs/preview", response_model=DerivedPreviewOut)`;
  `_require_year`; resolve the body exactly as `put_inputs` does (factor the resolve-and-validate
  loop into `_resolve_input_rows(db, body, people) -> dict[slot, Decimal | None]` shared by both);
  overlay onto the stored rows in memory (a `None` removes the slot); run `_materialized_buckets`;
  emit one item per derived key per column (household derived once, `person_id=None`) using the
  same null rule as the GET. No `ChangeBatch` dependency, no commit.
- [x] Commit: `feat(taxes): PUT refuses derived keys; POST inputs/preview serves live computed totals`.

## Task 6 — what-if on components only (spec §1.4)

**Files:** modify `backend/app/services/tax_whatif.py` (`DELTA_KEYS`, `apply_scenario`),
`backend/app/api/taxes.py` (the what-if route: override validation, `shift_earners` call, the
`changed` list); tests in `backend/tests/test_tax_whatif.py`, `backend/tests/test_taxes_api.py`.

- [x] Failing tests: `apply_scenario` bumps `ltcg_brokerage` and leaves `ltcg_total` untouched in the
  returned dict (update the l.252/254/256 assertions: totals are the engine's now); a what-if with an
  ESPP ordinary leg moves the SCENARIO summary's Medicare `w2_income` by the leg (proves the engine
  re-derived); a derived override key → 422 with the sentence; `changed` never lists a derived key;
  a joint year's what-if leaves the partner's wage base untouched (the existing rule).
- [x] Implement: `DELTA_KEYS: dict[str, str]` component-only; `apply_scenario` bumps the component
  alone; the route 422s derived overrides (after `_require_known_input_keys`); the route builds
  `primary_after = feed.person_inputs[columns[0]] + (scenario − stored) for PER_PERSON_KEYS` and calls
  `shift_earners(feed.earners, primary_before, primary_after)`; `changed` iterates non-derived keys.
- [x] Commit: `feat(taxes): what-if legs bump components; derived overrides refused`.

## Task 7 — storage: migration, importer skip, health check removal (spec §1.4–1.5)

**Files:** create `backend/alembic/versions/20260911_0900_<rev>_computed_tax_totals.py`
(`down_revision = "c4a7e2b9d13f"`); modify `backend/app/importer/apply.py` (`apply_taxes`),
`backend/app/services/health_checks.py` (drop `check_sec199a_in_itemized`, its constants and its
`run_checks` entry), `backend/app/schemas/lifecycle.py` (the action literal comment); tests in
`backend/tests/test_importer_apply.py`, `backend/tests/test_health_checks.py`,
`backend/tests/test_system_health_api.py` (if it lists check ids).

- [x] Migration: `op.execute("DELETE FROM tax_inputs WHERE key IN (...)")` with the nine keys as
  literals; print the deleted count (`result.rowcount`). Downgrade: no-op with a docstring saying why.
  Drill: create `finance_test_taxa_mig` —
  `$PY -c "import asyncio,asyncpg; asyncio.run(asyncpg.connect('postgresql://finance:finance@127.0.0.1:5433/postgres')).execute('CREATE DATABASE finance_test_taxa_mig')"`
  (wrap properly as an async function) — then `upgrade head`, `downgrade -1`, `upgrade head` against
  it with `DATABASE_URL` pointing at it. Do not drop it (morning list).
- [x] Importer: `apply_taxes` skips items whose key is in `DERIVED_KEYS` for create/update and
  removes them from `sheet_input_keys` so the sweep ignores stored ones; one `report.add_sample(...)`
  line `tax_inputs: {n} computed cells skipped (derived totals are computed, never stored)`.
  Tests: `test_apply_taxes_years_inputs_brackets` expects no derived rows; a stored derived row is
  NOT deleted by the sweep (it is invisible); the sample line appears.
- [x] Health: delete `check_sec199a_in_itemized`, `LEGACY_ITEMIZED_TOLERANCE`, `SEC199A_KEY`,
  `ITEMIZED_KEY`, its `run_checks` line and its tests (`test_sec199a_*`, the fixture block at
  l.334–380); remove `'rewrite_itemized_deduction'` from the lifecycle comment. Any test listing the
  full check-id sequence is updated.
- [x] Commit: `feat(taxes): computed totals leave storage — data migration, importer skip, §199A check retired`.

## Task 8 — full gates

- [x] `$PY -m ruff check app tests && $PY -m ruff format --check app tests` — clean.
- [x] `FINANCE_TEST_DB=finance_test_taxa $PY -m pytest -q` — full suite green; record counts in the
  final report. `tests/test_tax_service.py::test_golden_2024_equals_sheet_cached_values` explicitly
  named as passing.
- [x] Final report to the orchestrator: commits, test counts, anything the spec did not anticipate,
  and the exact wire shapes shipped (they must match the contracts block above).

---

## What actually happened (lane A implementer, 2026-09-11)

**Status: implemented.** Nine commits on `tax/a-computed-totals-backend`; full backend suite
**1930 passed / 1 skipped**, ruff clean, migration drill green.
`test_golden_2024_equals_sheet_cached_values` passes, as do all four `test_golden_*` years.

### The one golden that moved — and why it had to

`test_golden_2023/2024` and `test_golden_2024_equals_sheet_cached_values` are byte-identical,
fixtures AND expected values. **2025 and 2026 moved, in the expected values only** (the
`_INPUT_TABLE` fixtures did not change), by exactly their §199A line:

| year | quantity | was | now |
|------|----------|-----|-----|
| 2025 | fed_deduction | 27219.50 | 27213.28 |
| 2025 | fed_ti / fed_tax | 232156.55 / 51353.09 | 232162.77 / 51355.09 |
| 2025 | total_tax / take_home | 90419.50 / 196789.56 | 90421.49 / 196787.57 |
| 2026 | fed_deduction | 29832.00 | 29824.00 |
| 2026 | fed_ti / fed_tax | 250296.21 / 57157.79 | 250304.21 / 57160.35 |
| 2026 | total_tax / take_home | 98582.00 / 208112.03 | 98584.56 / 208109.47 |

The plan's "unchanged expected values" gate cannot hold for those two years, because the
spec itself requires both halves of the contradiction: §199A is BELOW the line (spec 4h,
2026-09-09) *and* the itemized total is now COMPUTED without it (spec §1.2, Task 2's own
test asserts `fixture − itemized_sec199a_div`). While the total was still stored — carrying
the §199A line the formula had dropped — those years deducted the same dollars twice. They
now deduct them once, and every figure above returns to its pre-4h value. This is the exact
drift §0's production census found (+6.22 / +8.00) and the retired `sec199a_in_itemized`
health check existed to name. **Production effect: 2025 and 2026 federal tax rise by 2.00
and 2.56 when this deploys.**

### Deviations from the plan text

1. `shift_earners(earners, primary_after)` takes TWO arguments, not three: once the head
   bundle is re-materialized from `primary_after`, `primary_before` has no reader.
2. `_assemble_inputs(year, rows, buckets, filing_status)` materializes the HOUSEHOLD dict
   too (spec §1.4's "then the household dict"), not only the per-person buckets — money
   flow reads `feed.inputs` for `unqualified_dividends` / `interest_total` and no row
   carries them any more. It returns `{}` unchanged for a year with no stored rows (the
   money-flow card asks "has this year been filled in?" of exactly this dict) and drops the
   synthetic `w2_income` key on the way out.
3. `tax_service.W2_INCOME_KEY` names the synthetic wage key the engine carries bundle sums
   under; it is in no definition, no `ENGINE_INPUT_KEYS` and no payload.
4. `TaxInputItemOut.formula` shipped in Task 4 (the plan filed it under Task 5): the GET
   payload needs it, and Task 4's own test asserts it.
5. The §199A health check retired inside the Task 4 commit rather than Task 7's: the
   shrunken `derive_suggestions` and the new `_assemble_inputs` signature had already made
   `check_sec199a_in_itemized` dead code, and a commit that leaves an import raising is
   worse than one that lands the deletion early.
6. `derive_suggestions` calls `materialize_household` internally (the plan offered the
   choice) — a caller cannot hand it a stale `ltcg_total`.
7. `itemized_deduction` IS named in the muted missing-inputs list when every itemized
   component is absent, and leaves it only when `DEDUCTION_MISSING_WARNING` fires (today's
   rule). The plan's "never in the muted list" contradicts spec §1.3's "named by its key
   like every other" and an existing pin; the spec won.

### Pre-existing tests whose pinned behavior the spec changed

- `test_empty_earner_list_is_not_a_bundle` — with no bundles the INCOME chain loses the
  wages too, not just FICA (spec §1.3 makes AGI's wage term a bundle sum): 2024's
  `total_income` 211776.20 → −23648.26.
- `test_bonus_input_adds_a_withholding_leg_to_the_combined_total` — `w2_bonuses` is an
  engine input now (a component of the computed `other_w2_income`), so the liability moves
  with it: 115753.20 → 124528.20.
- `test_apply_taxes_*` — 86 → 68 created rows (34 entered keys x 2 years).
- `test_run_checks_returns_the_ten_in_order` → `…_the_nine_…`.
- `test_negative_other_income_refuses…` (money flow) — a stored total can no longer drift
  from its components, so the guard is driven from an unmaterialized salary node instead.
- Fixtures throughout `test_tax_service_married.py`, `test_money_flow.py`,
  `test_taxes_api.py`, `test_withholding_api.py` and `test_overview_api.py` re-expressed in
  COMPONENTS at identical arithmetic (24 checks x salary/24, `w2_other`, `interest_standard`,
  `ltcg_brokerage`, …).

### Left for the morning list

- Scratch database `finance_test_taxa_mig` was created for the migration drill and left in
  place (upgrade → downgrade → upgrade, 3 of 4 seeded rows deleted, definitions kept,
  `alembic check` clean). Nothing was run against the dev `finance` database.
