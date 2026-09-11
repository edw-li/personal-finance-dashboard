# Computed tax totals and per-person payroll tables (2026-09-11) — design record

**Status:** approved design, awaiting `writing-plans`. Source: the 2026-09-11 conversation — the
user asked whether Social Security is modelled per worker on a married-joint year, how a
household with one spouse on an employer Voluntary Plan and the other on California SDI is
represented, and why the derived tax-input totals are editable. Two read-only production censuses
that day (payroll tables and inputs; stored derived totals vs. their formulas) ground the decisions
in §0. The plans that execute this record live under `docs/superpowers/plans/2026-09-11-*.md`
(four lanes + verification, §6).

House rules that hold everywhere: money math lives on the server and the browser never recomputes
an engine figure; every write that touches money goes through a `ChangeBatch`; absent ≠ zero;
percents are percents in the UI and fractions on the wire; the four golden years
(`backend/tests/test_tax_service.py`, 2023–2026) stay byte-identical in outputs **and** fixtures;
copy names the noun and the reason.

Decisions taken in the conversation, verbatim intent:

| # | Question | Answer |
|---|----------|--------|
| 1 | May a derived total ever be overridden with a typed figure? | **Never.** All nine become computed, read-only. Capital Loss Deductions is not a derived key and stays typeable with its chip (a prior-year carryforward is a real number no formula knows). |
| 2 | When does a total change on screen? | **Live, as you type**, via a debounced server preview — the browser owns no formula. |
| 3 | Where do the formulas run? | **In the engine** (Approach 1): the engine ignores any total it is handed and rebuilds it from components. |
| 4 | Which jurisdictions may carry a per-person bracket table? | **Both per-worker ones**, Social Security and Disability. Medicare, federal, state and capital gains stay per return. |

---

## 0. What production showed (2026-09-11, read-only SQL run by the user)

- Prod runs alembic head `c4a7e2b9d13f` (the 2026-09-09 audit-fix batch): the code read for this
  design is exactly the code in production.
- `tax_years` 2026 = `married_joint`; `marriage_date` = 2026-09-09; people = Edward (primary),
  Grace. All six MFJ bracket tables exist; federal and capital-gains rows equal Rev. Proc. 2025-32,
  Medicare's additional tier already sits at 250,000, Social Security at 6.2% to 184,500. The
  **Disability** table under both statuses is `1.0% to 300,000, then 0%` — the shape of Edward's
  employer Voluntary Plan — and the engine walks that one table for every earner. California
  statutory SDI for 2026 is 1.3% with no wage ceiling (EDD; SB 951 removed the ceiling in 2024),
  which is what Grace's payroll withholds. One table cannot hold both. This is Part 2's motive.
- Grace has zero 2026 tax-input rows: the engine is on its single-bundle path and every 2026
  figure is Edward's alone. (Data entry, not code — recorded so the smoke in §5 models it.)
- Every stored derived total in 2023–2026 equals its formula (`stored − formula = 0.00` in every
  cell) except two explainable artifacts: 2023 STCG (the netting rule against a 670 long-term loss,
  i.e. the formula itself) and 2025/2026 Itemized (+6.22 / +8.00 = the §199A line the formula
  dropped on 2026-09-09 while the stored totals kept it). The user has never typed over a derived
  total; the only drift on record is a formula change leaving stored totals stale — the exact
  hazard Part 1 removes.

Statutory facts verified the same day (IRS Topics 608/751/559, Additional Medicare Q&A, EDD
contribution-rates page, Rev. Rul. 81-194): the Social Security wage base is per employee and a
joint return figures excess withholding per spouse; the 0.9% Additional Medicare applies to
combined wages over 250,000 MFJ while employers withhold only above 200,000 per worker (already
modelled: combined Medicare walk + withholding-gap line); SDI and Voluntary Plans are per worker and
per employer, a VP's employee rate may not exceed the SDI rate, and VPDI is not a Schedule A tax
while SDI is. Nothing about filing jointly changes any payroll tax — which is why per-worker tables
carry a person and never a status-dependent threshold.

---

## 1. Part 1 — Derived totals are computed, never stored

### 1.1 Vocabulary (`backend/app/tax_keys.py`)

- `DERIVED_KEYS: tuple[str, ...]` — the keys whose definition tuple carries `is_derived=True`,
  derived from `TAX_INPUT_DEFINITIONS` in one comprehension so there is one list:
  `gross_paycheck`, `latest_w2_income`, `other_w2_income`, `stcg_total`, `unqualified_dividends`,
  `interest_total`, `other_pretax_deductions`, `itemized_deduction`, `ltcg_total`.
- `DERIVED_COMPONENTS: dict[str, tuple[str, ...]]` — each derived key's component keys: the
  ENTERED (non-derived) keys its formula reads, expanded transitively so no entry is itself derived
  (`stcg_total` → `stcg_standard, stcg_espp_component, ltcg_brokerage, ltcg_espp_component`;
  `latest_w2_income` → `pay_periods, annual_salary`). The keys MAGI reads to size the SALT cap are
  not components of `itemized_deduction`. Used by the 422 sentences, the paste skip and the
  "all components absent" rule in §1.3.
- `FORMULA_CAPTIONS: dict[str, str]` — the human formula shown beside a computed cell. Captions
  are presentation owned by the code that owns the formula, like `label_for` / `unit_for`:

  | key | caption |
  |-----|---------|
  | gross_paycheck | `Annual Salary ÷ 24` |
  | latest_w2_income | `Pay periods × Gross Paycheck` |
  | other_w2_income | `RSUs sold + Bonuses + Salary checkpoint + ESPP sale component + Employer HSA + Other` |
  | stcg_total | `Standard + ESPP short-term, netted against a long-term loss` |
  | unqualified_dividends | `US Treasuries ETF + Other dividends` |
  | interest_total | `Standard + US Treasuries` |
  | other_pretax_deductions | `Dental + Vision` |
  | itemized_deduction | `SALT (capped) + Donations + Vehicle registration + Other` |
  | ltcg_total | `Brokerage + ESPP long-term` |

- `is_derived_key(key)` — the API stamps `is_derived` on every payload item from this, not from
  the `tax_input_definitions.is_derived` column. The column stays (the insert-only seed writes it;
  older databases read the same set), but no reader depends on it any more — the `label_for` /
  `unit_for` precedent.
- `PER_PERSON_DERIVED_KEYS = ("gross_paycheck", "latest_w2_income", "other_w2_income",
  "other_pretax_deductions")` — the derived keys that are also in `PER_PERSON_KEYS`; the other five
  are household.

### 1.2 Materialization (`backend/app/services/tax_service.py`)

Two pure functions replace the nine formulas inside `derive_suggestions`:

```python
def materialize_person(values: Mapping[str, Decimal]) -> dict[str, Decimal]:
    """One person's bucket with the four per-person totals rebuilt from THEIR components."""

def materialize_household(year: int, values: Mapping[str, Decimal], filing_status: str) -> dict[str, Decimal]:
    """The summed household dict with the five household totals rebuilt, in dependency order."""
```

Both return a copy with derived keys **replaced** (whatever came in under a derived key is
discarded). Missing components read as 0, exactly as `derive_suggestions` does today.

Formulas (unchanged from `derive_suggestions`, including the SALT cap + MAGI phase-down and the
STCG netting rule; §199A stays OUT of itemized per 2026-09-09 spec 4h):

| key | formula |
|-----|---------|
| gross_paycheck | `annual_salary / 24` (`PAYCHECKS_PER_YEAR`, the sheet's constant — not the profile cadence; see §7) |
| latest_w2_income | `pay_periods × gross_paycheck` |
| other_w2_income | `w2_stock_rsus_sold + w2_bonuses + w2_salary_checkpoint + w2_espp_sale_component + w2_employer_hsa + w2_other` |
| other_pretax_deductions | `pretax_dental + pretax_vision` |
| ltcg_total | `ltcg_brokerage + ltcg_espp_component` |
| unqualified_dividends | `unq_div_us_treasuries_etf + unq_div_other` |
| interest_total | `interest_standard + interest_us_treasuries` |
| stcg_total | the netting rule over `stcg_standard + stcg_espp_component` and `ltcg_total` |
| itemized_deduction | `min(itemized_salt, salt_cap(year, status, MAGI)) + itemized_donations + itemized_vehicle_reg + itemized_other` |

**Order.** Household: `ltcg_total`, `unqualified_dividends`, `interest_total` → `stcg_total` (reads
`ltcg_total`) → `itemized_deduction` (reads MAGI, which reads everything above plus the summed
per-person W-2 totals). Person before household: `latest_w2_income` is a per-person product
(`Σ pᵢ·sᵢ/24 ≠ (Σpᵢ)(Σsᵢ)/24`), so per-person buckets are materialized first and only then summed.

**Precision (pinned by the goldens).** Each derived value is computed at full `Decimal` precision
over its components and quantized to 4dp `ROUND_HALF_UP` (the `Numeric(14,4)` cell precision) as the
LAST step; a chained value uses the UNQUANTIZED intermediate — `latest_w2_income` multiplies
`annual_salary / 24` before that quotient is rounded. This reproduces every stored year exactly:
2023 `9 × 145000/24 = 54375.0000`, 2026 `20 × 188930/24 = 157441.6667`. (Today's
`derive_suggestions` multiplies the STORED 4dp paycheck and therefore misses 2023/2026 by 0.0003 —
`test_suggestions_match_stored_2025`'s docstring records that; the new chain removes the caveat.)
Reported figures keep quantizing at the API boundary as today.

`derive_suggestions` shrinks to what remains advisory — `capital_loss_deductions` (the statutory
cap of the netted loss) — and `SUGGESTION_KEYS` shrinks with it. The salary chip (from the
paycheck profile) and the three carry-forward chips are the API's, unchanged.

### 1.3 Engine (`compute_breakdown`, `earner_from_inputs`)

- The two kinds of derived total are defended differently, because a per-person product cannot be
  rebuilt from household sums:
  - **Five household totals** — `compute_breakdown` calls
    `materialize_household(year, values, filing_status)` on its input dict after the missing-key
    sweep and before reading anything. A stale or fabricated household total handed in by any caller
    is overwritten. Idempotent, so a caller that already materialized pays nothing.
  - **Four per-person totals** — never read from the flat dict. `earner_from_inputs(values)` calls
    `materialize_person(values)` first, so every bundle's `w2_wages`
    (`latest_w2_income + other_w2_income`) and `other_pretax` come from that person's components,
    and the engine takes its wage and pre-tax figures from the bundles: `w2_income`, the
    Medicare/SS/SDI bases, and `_federal_agi`'s wage and other-pre-tax terms are bundle sums. On the
    single-earner path the one bundle is synthesized from the flat dict through
    `materialize_person`, so a lone caller cannot bypass it either. The flat dict's four per-person
    entries survive only for readers outside the engine (`money_flow`'s salary node reads
    `latest_w2_income`), and the API fills them from the materialized buckets (§1.4).
- `ENGINE_INPUT_KEYS` keeps its role ("every key `compute_breakdown` reads") and its members.
  Missing-key handling changes only for derived members: a derived key counts as missing — and is
  named by its key in `MISSING_INPUTS_WARNING` like every other — only when **every** key in
  `DERIVED_COMPONENTS[key]` is absent from the input dict. A total with at least one entered
  component is never "missing"; it is computed. The warning therefore reads at today's granularity
  (one name per total) and the goldens' `warnings == []` holds.
- `DEDUCTION_MISSING_WARNING` fires when `standard_deduction` is absent AND no itemized component
  is present (the pair rule, restated over components).
- Golden gate: `test_golden_2023..2026`, `test_golden_2024_equals_sheet_cached_values` and the
  drift pins pass with **unchanged fixtures and unchanged expected values**. `_INPUT_TABLE` keeps
  its derived rows (they are the sheet's cached cells and now serve as the materialization oracle:
  a new test asserts `materialize_*` reproduces every derived fixture cell of every year).

### 1.4 The assembly door (`backend/app/api/taxes.py`)

- `_assemble_inputs(rows, columns)` materializes each person bucket (`materialize_person`) before
  summing per-person keys, then the household dict. `_assemble_earners` builds bundles from the
  materialized buckets (via `earner_from_inputs`, which re-materializes harmlessly).
- `EngineFeed` gains `person_inputs: dict[int | None, dict[str, Decimal]]` — the materialized
  per-person buckets in column order — replacing every downstream re-bucketing of `feed.rows`:
  the withholding card's `_bucket_input_rows` / `_wage_base` read `feed.person_inputs`, so the
  partner's wage base is `latest_w2_income + other_w2_income` **as computed from their
  components**. (`feed.rows` stays for the change-log and tracker-only keys.)
- What-if (`tax_whatif.apply_scenario`): `DELTA_KEYS` become component-only
  (`"brokerage_long": "ltcg_brokerage"`, …); a sale bumps the component and the engine's
  materialization carries the total. `shift_earners` re-bases the primary's bundle by re-running
  `earner_from_inputs` on the primary's shifted component bucket rather than adding deltas of
  derived keys. An override on a derived key is a 422:
  `"{label} is computed from its components ({component labels}) — override those instead"`.
- Money flow (`services/money_flow.py`) reads `feed.inputs` for `latest_w2_income`,
  `unqualified_dividends`, `interest_total` — materialized, no change.
- Health: `check_sec199a_in_itemized`, its `HealthFixOut` action `rewrite_itemized_deduction`
  (`schemas/lifecycle.py` literal), the `HealthCard` branch and `putTaxInputsForRepair` are
  deleted. No stored total exists to be stale.

### 1.5 Storage

- **Migration (data)** `…_computed_tax_totals`, revises `c4a7e2b9d13f`:
  `DELETE FROM tax_inputs WHERE key IN (<the nine, listed literally>)`, printing the row count.
  Downgrade is a documented no-op (the rows are recomputable and the nightly backup holds the
  prior image). `tax_input_definitions` rows for the nine stay (label, section, order, flag).
- **PUT `/taxes/years/{year}/inputs`**: a derived key anywhere in `values` or `rows` → 422
  `"{label} is computed from its components ({component labels}) — edit those instead"`, before any
  write (the existing resolve-everything-first posture).
- **Importer (`importer/apply.py`)**: derived keys are skipped for create, update and the
  sync-delete sweep (`sheet_input_keys` excludes them). The parser still parses the grey cells.
  Report: one sample line `tax_inputs: {n} computed cells skipped (derived totals are computed,
  never stored)`. Brackets untouched by this part.

### 1.6 Inputs API (read + preview)

`TaxInputItemOut` (additive):

```
is_derived: bool            # from is_derived_key(key), not the column
value: Decimal | None       # derived: the computed figure for THIS column (4dp), or null when
                            #          none of the key's components has a stored row in that column
suggested: Decimal | None   # derived: always null (no chip)
formula: str | None         # derived: FORMULA_CAPTIONS[key]; null otherwise
```

Per-person derived items repeat once per person column with that column's figure; household
derived items appear once.

**Preview** — `POST /taxes/years/{year}/inputs/preview`, body `TaxInputsIn` (the form's current
cells, `values` + `rows`, exactly the PUT body), response:

```
DerivedPreviewOut { year: int, filing_status: str,
                    derived: [ { key: str, person_id: int | null, value: Decimal | null } ] }
```

Semantics: overlay the body on the stored rows in memory (null = unset), run the same assembly as
the GET, return the derived items only. 404 for an unknown year; the PUT's own 422s for unknown
keys, unit bounds and derived keys in the body. No write, no `ChangeBatch`, no change-log entry.

### 1.7 The form (`src/components/taxes/InputsForm.tsx`, `TaxesPage.tsx`)

- A derived row renders a read-only figure in the input track: an `<output>` styled like a blurred
  amount (muted, right-aligned, same metrics), formatted per unit; a muted dash when `value` is
  null. The existing `derived` badge stays. The third track shows `formula` in the hint style in
  place of the chip. `title` on the figure: `"{formula} — edit the components"`.
- Computed cells are not `data-entry-cell`s: Enter/ArrowDown skip them, they are never in
  `flatCells` for saving, never in `changed`, never in the PUT body.
- **Live preview**: any edit to a component cell schedules `POST …/preview` 300 ms after the last
  keystroke with the whole current form (the PUT body shape). A sequence counter drops stale
  responses (the page idiom). Computed cells keep their last figure while a call is in flight; a
  preview error changes nothing on screen (the Save path reports real errors). The Save echo
  remains authoritative and cancels any pending preview.
- **Paste**: positional paste keeps derived rows as SLOTS in the walk order — a slot consumes its
  pasted value and discards it, so a copied sheet column stays aligned; the note appends
  `· {n} computed cells skipped`. Keyed paste ignores rows whose label matches a derived key, same
  note. `reachable` counts editable cells only.
- Chips unchanged where still offers: Annual Salary (profile), Capital Loss Deductions, the three
  carry-forward rows.
- `overrideDefinitions` (TaxesPage) excludes `is_derived` items from the what-if select. A
  bookmarked `whatif=<derived_key>:…` link now shows the server's 422 in the panel banner —
  accepted.
- Copy: the Inputs card hint becomes "The year's income and deduction line items. Computed lines
  total their components as you type; grey chips are offers you apply." The intro sentence drops
  "the chips are the sheet's formulas".

### 1.8 Tests (Part 1)

Backend: `materialize_person` / `materialize_household` per formula; dependency order; the
precision rule (2023 and 2026 `latest_w2_income` reproduce exactly); every derived fixture cell of
every golden year reproduced; two-person product test (per-person before sum); engine overwrites a
stale `other_w2_income`; goldens unchanged; missing-key warning names a derived total only when all
components are absent; GET item shape (`value`, `suggested` null, `formula`); PUT 422 sentence;
preview returns per-column figures and leaves `tax_inputs` and the change log untouched; importer
skips + report line; what-if component-only bump, derived override 422, `shift_earners` via
components; withholding partner wage base from components alone; migration up/down + `alembic
check`; the §199A check and repair tests removed.

Frontend (vitest): computed row rendering (figure, caption, dash), no chip; debounce + sequence
guard; save body excludes derived cells; positional and keyed paste skips with note text; override
select excludes derived; HealthCard branch gone; TaxesPage tests updated for the new payload.

---

## 2. Part 2 — Per-person tables for the per-worker payroll jurisdictions

### 2.1 Data model and migration

- `tax_brackets.person_id: int | None`, FK `people.id` `ON DELETE RESTRICT` (the
  `paycheck_profiles` posture; no person-delete endpoint exists). NULL = the year+status default
  table for everyone — every row today.
- Uniqueness: Postgres treats NULLs as distinct, so the single constraint `uq_tax_brackets_year`
  becomes two partial unique indexes, mirrored in the model's `__table_args__` (the `people`
  one-primary precedent, because the test DB is `create_all`):
  - `ux_tax_brackets_default` on `(year, jurisdiction, filing_status, bracket_index)`
    `WHERE person_id IS NULL`;
  - `ux_tax_brackets_person` on `(year, jurisdiction, filing_status, person_id, bracket_index)`
    `WHERE person_id IS NOT NULL`.
- **Migration (schema)** `…_tax_bracket_person`, chained after Part 1's migration: add column, drop
  the constraint, create both indexes. No data rewrite. Downgrade: delete person rows, drop indexes,
  recreate the constraint, drop the column.
- `tax_keys.PER_WORKER_JURISDICTIONS = ("social_security", "disability")` — the one tuple that
  says which jurisdictions may carry a person; `VERBATIM_OK_JURISDICTIONS` (the clone flags) is the
  same fact and reads from it.

### 2.2 Engine

- `EarnerWages.payroll_tables: Mapping[str, list[Bracket]]` (default empty): the per-worker tables
  this earner walks **instead of** the year's default. The SS and SDI walks read
  `earner.payroll_tables.get(name) or tables[name]`. Cap detection (terminal 0-rate row) runs per
  table, so one earner may be capped by a different base than another.
- **All-zero rule**: a table whose every rate is 0 taxes nothing and reports 0 taxable wages for
  that earner (the SS-exempt job). A table that is merely EMPTY still means "no table": it falls
  through to the default.
- `JurisdictionResult` for `social_security` and `disability` gains
  `per_person: list[EarnerPayroll]` in bundle (column) order —
  `EarnerPayroll(w2_income, taxable_wages, tax, effective_rate, own_table: bool)`. Conventions per
  jurisdiction are today's aggregate conventions applied per earner: SS `taxable_wages` is the
  capped base; SDI `taxable_wages` is the earner's uncapped SDI base (the aggregate pin
  `235424.46` in the 2024 golden is the sum of these). Medicare stays combined and carries no
  per-person list.
- With no person table anywhere every bundle carries an empty mapping and the walks read the
  defaults — the golden path is byte-identical (the goldens never build person tables).

### 2.3 Assembly

- `_engine_tables(db, year, status)` returns default (NULL-person) tables — same signature. New
  `_person_tables(db, year, status) -> dict[int, dict[str, list[Bracket]]]` loads person rows.
  `EngineFeed` gains `person_tables`.
- `_assemble_earners` attaches `person_tables[column]` to each bundle, and returns a **one-bundle
  list** (rather than `None`) whenever any person on the return has a person table — the 2026
  single-status case where Edward alone has a Voluntary-Plan table. `None` (engine synthesis) stays
  the answer when nobody has one, which keeps every stored single year byte-identical.
- `shift_earners` (what-if) preserves `payroll_tables` on the re-based head bundle
  (`dataclasses.replace`).
- Withholding card (`withholding_estimate`): the bonus/vest FICA legs walk the PRIMARY's effective
  tables — `person_tables.get(primary_id, {}).get(name) or tables.get(name, [])` for the three
  payroll jurisdictions. The partner leg is unchanged (all-in `withholding_pct`).
- `_missing_for_status` judges default tables only; person tables are optional overlays and never
  satisfy a missing default.
- Clone helper: copies single-status rows **including person rows** (same `person_id`) into the
  target status — per-worker tables do not depend on status, so the copy is right.
- Importer: the existing-brackets query adds `person_id IS NULL`; person rows are invisible to
  create/update/sweep.

### 2.4 Brackets API

`BracketsOut` (additive):

```
jurisdictions: {name: rows}                 # default tables — unchanged meaning
people: [ { id: int, name: str } ]          # _return_people(load_people(db), <payload status>) —
                                            # the roster a return under THIS tab's status covers
per_person: [ { person_id: int, name: str,
                jurisdictions: { social_security: rows, disability: rows } } ]
                                            # one entry per person in `people`, empty lists when
                                            # that person has no table for a jurisdiction
```

`BracketsIn` (additive): `person_id: int | None = None`.

- `person_id` null → today's behaviour exactly.
- `person_id` set → the body may name only `PER_WORKER_JURISDICTIONS`
  (422 `"{name}: per-person tables exist only for social_security and disability"`); the person
  must be in `people` for the body's status (422 `"person {id} is not on a {status} return"`);
  each named jurisdiction is a full replace of `(year, jurisdiction, status, person)` — an empty
  list deletes that person table and the earner falls back to the default.
- `_validated_table` unchanged (same 12-row ceiling, same ascending rule).
- `ClonedBracketsOut` inherits the new fields.

### 2.5 Summary API

`WageTaxOut.per_person: list[PersonWageTaxOut] = []` (additive, defaulted — stored fixtures and
older clients parse unchanged):

```
PersonWageTaxOut { person_id: int | null, name: str | null,
                   w2_income, taxable_wages, tax: Decimal, effective_rate: Decimal | null,
                   table: 'own' | 'default' }
```

Populated for `social_security` and `disability` from `JurisdictionResult.per_person`, mapping
bundle index → the feed's column (person id and name; null/null on a roster-less database).
Always populated when the result carries entries (one entry on a single-earner year); rendering
rules live in the client (§2.7).

### 2.6 Editor (`src/components/taxes/BracketsEditor.tsx`)

- The Social Security and Disability blocks change heading to
  `"{Jurisdiction} brackets — default for everyone"`; the other four blocks are unchanged.
- Beneath each per-worker default table, a **per-person strip**, one card per entry of
  `payload.people`:
  - with a stored table: the same rows editor (Rate %, Threshold, Remove, Add bracket) with its own
    Save, plus `Remove — use the default` (PUT `[]` for that jurisdiction with `person_id`);
  - without: a single button `Add a table for {name}`, which seeds a DRAFT copy of the current
    default rows into that person's slot (client-side; unsaved until its Save).
- Save keys, `errors`, `saving` and dirty tracking widen from `name` to `${name}:${personId ??
  'default'}`. A tab switch reloads everything (payload now carries `people` + `per_person`).
- Strip hint: "Per-worker tax: the default applies to anyone without their own table. Add one for
  an earner on an employer's voluntary plan, or in a job exempt from Social Security."
- Card hint gains: "Social Security and Disability may also carry a table per person." The empty-
  tab clone note gains ", including any per-person tables" after "come across correct".

### 2.7 Summary (`src/components/taxes/SummaryPanel.tsx`)

- Under the Social Security and Disability rows, indented sub-rows — one per `per_person` entry:
  name · wages · taxable · tax · rate, a `capped at {threshold}` note when `taxable_wages <
  w2_income` **and `taxable_wages > 0`** on Social Security (an exempt earner on an all-zero table
  has nothing capped — amended 2026-09-11 at lane D's review), and a small tag `own table` /
  `default`.
- As built (lane D): a seeded-but-unsaved person table also offers `Discard draft` (client-side, no
  request); saving an empty unstored draft discards it rather than confirming a delete; the status
  tabs are disabled while any table's save is in flight.
- Render rule: sub-rows appear when the list has two or more entries OR any entry is `own`. A
  single-earner default-table year renders exactly as today.
- "By jurisdiction" hint gains: "Social Security and Disability are per worker: each earner's row
  shows their own wage base, cap and table."

### 2.8 Tests (Part 2)

Backend: partial-index uniqueness (duplicate default row and duplicate person row both rejected,
default and person rows coexist); migration up/down + `alembic check`; all-zero rule; own-vs-default
selection per earner with distinct caps; `per_person` in column order with `own_table`; goldens
unchanged; one-bundle rule when only the primary has a table; `shift_earners` preserves tables;
withholding card walks the primary's own tables; `_missing_for_status` ignores person tables;
brackets GET `people`/`per_person` per tab status; PUT with person: restriction 422, roster 422,
full replace, delete via `[]`; clone copies person rows; importer sweep leaves person rows alone;
summary `per_person` payload with names.

Frontend: per-person strip add/seed/save/remove, widened keys and dirty tracking, tab switch;
summary sub-row rule (two earners; single earner with own table; single earner default = no
sub-rows), capped note, tags; hint copy.

---

## 3. Contracts pinned for parallel lanes

Frontend lanes build against these exact shapes so they never wait on their backend lane:

- `TaxInputItemOut` + `formula: string | null` (§1.6); derived items carry `suggested: null`.
- `POST /taxes/years/{year}/inputs/preview` → `DerivedPreviewOut` (§1.6); body = `TaxInputsUpdate`.
- `TaxBracketsOut` + `people: {id, name}[]` + `per_person: {person_id, name, jurisdictions}[]`;
  `TaxBracketsUpdate` + `person_id?: number | null` (§2.4).
- `WageTaxOut` + `per_person: PersonWageTaxOut[]` (§2.5).
- 422 sentences quoted in §1.4, §1.5, §2.4 are the wire text; the client shows them verbatim.
- `src/types/api.ts` and `src/api/taxes.ts` gain the fields/functions in the frontend lanes; the
  backend lanes' `schemas/taxes.py` are the source of truth if the two ever disagree.

## 4. Migration chain and rollout

Chain: `c4a7e2b9d13f` → Part 1 data migration → Part 2 schema migration (ids chosen by the plans).
Both run at container boot as every migration here does. Deploy is the usual push, pull, rebuild.

User steps after deploy, in order:

1. Taxes → 2026 → Bracket tables → Married filing jointly → Disability: set the default to
   `1.3% from 0` (statutory SDI, one row); `Add a table for Edward`: `1.0% from 0`, `0% from
   300,000` (the Voluntary Plan). Nothing is needed for 2025: Edward is that return's only earner
   and its default table already is the Voluntary-Plan shape.
2. Taxes → 2026 → Inputs → Grace's column: enter her components (salary, pay periods, W-2
   components, 401k, HSA, dental/vision). The totals compute as she is typed in; the engine then
   builds two bundles and caps Social Security per person.
3. Set the household deduction inputs to married-joint values (already recommended on
   2026-09-11: Standard Deduction 32,200; State Standard Deduction and State Exemption Credits to
   the FTB married-joint figures).

## 5. Verification gates (lane V)

Merged main: full backend suite, full vitest, `tsc`, lint, build, `alembic check` against a
migrated dev DB. Browser smoke on the real stack with a scratch married-joint year and two people
(the 2026-08-27 marriage smoke's 2099-year pattern): type a component and watch its total move
without saving; save and confirm the echo; add a person Disability table and see the summary
sub-rows appear with `own table` / `default`; positional paste of a sheet column stays aligned; tear
the scratch year down. Screenshots to the repo `scratchpad/` (gitignored). No production writes.

## 6. Plan breakdown

Same execution mechanics as prior batches: one worktree and one `FINANCE_TEST_DB` per lane,
opus implementers, two-stage review (spec conformance, then quality), bare unpiped test gates with
explicit exit codes, no pushes.

| Lane | Scope | Wave |
|------|-------|------|
| A — computed totals, backend | §1.1–1.6, §1.8 backend, Part 1 migration | 1 |
| B — computed totals, form | §1.7, §1.8 frontend, HealthCard removal, types | 1 (contracts §3) |
| C — per-person payroll, backend | §2.1–2.5, §2.8 backend, Part 2 migration; rebases onto A (both touch the feed, `EarnerWages`, `shift_earners`) | 2 |
| D — per-person payroll, editor + summary | §2.6–2.7, §2.8 frontend, types | 2 (contracts §3) |
| V — verification | §5, activation notes | after C and D |

## 7. Out of scope (recorded, not built)

- `gross_paycheck` keeps the sheet's ÷24; reading the person's paycheck-profile cadence is a later
  change with its own golden implications.
- `pay_periods` (checks received so far) stays typed; deriving it from the pay calendar is a
  separate idea.
- Medicare stays household-only by statute; no per-person Medicare table.
- California's 2026 bracket tables are still the 2025 figures in production — data entry from the
  FTB 2026 Form 540-ES schedules, not code.
- The Overview money flow, the assistant context and exports are unchanged (they read the engine
  feed or the summary).
