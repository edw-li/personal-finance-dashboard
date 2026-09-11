# Lane C — per-person payroll tables, backend (2026-09-11) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (one
> implementer for this lane in its own worktree, TDD per task, then a spec-compliance review and a
> code-quality review, then merge to local main — never pushed). Steps use `- [x]` checkboxes.

**Spec:** `docs/superpowers/specs/2026-09-11-computed-tax-totals-and-per-person-payroll-tables-design.md`
— this lane implements **Part 2 §2.1–2.5 and §2.8 (backend)**. Read §0 and §2 before Task 1.
**This lane starts from main AFTER lane A has merged** (both touch `EarnerWages`, `compute_breakdown`'s
FICA section, `_assemble_earners`, `shift_earners` and `EngineFeed`).

**Goal:** Social Security and Disability may carry a per-person bracket table; the engine walks each
earner over their own table or the default; the summary reports each earner's wages, cap and tax.

**Architecture:** nullable `tax_brackets.person_id` with two partial unique indexes; `EarnerWages.payroll_tables`
overrides the year's default tables per earner; the feed loads default and person tables and attaches
them to bundles; the brackets API grows `people`/`per_person` on GET and `person_id` on PUT; the
summary's `WageTaxOut` grows `per_person`.

**Tech stack:** FastAPI + SQLAlchemy async + Alembic + pytest. Python 3.12, ruff.

---

## Mechanics (read once)

- Worktree: `C:/Users/edyli/personal-finance-dashboard/.worktrees/tax-c`, branch
  `tax/c-payroll-tables-backend`, cut from `main` after lane A's merge. Work ONLY inside it.
- Python: `$PY = C:/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe`, cwd
  `<worktree>/backend`. First command: `$PY -c "import app; print(app.__file__)"` → the worktree path.
- Test DB: `FINANCE_TEST_DB=finance_test_taxc`. Lint: `$PY -m ruff check app tests && $PY -m ruff format --check app tests`.
- Migration drill: scratch DB `finance_test_taxc_mig` (create with asyncpg as in lane A's Task 7),
  `DATABASE_URL=…/finance_test_taxc_mig $PY -m alembic upgrade head`, `downgrade -1`, `upgrade head`.
  Never migrate the dev `finance` DB; never drop anything.
- Golden rule: `tests/test_tax_service.py` and `tests/test_tax_service_married.py` pass with
  unchanged fixtures and values. With no person table anywhere the engine must be byte-identical.
- Commits small (`feat(taxes): …`); never push.

## Contracts this lane publishes (lane D builds against them verbatim)

```
BracketsOut  += people: [ { id: int, name: str } ]        # _return_people(load_people(db), <payload status>)
             += per_person: [ { person_id: int, name: str,
                                jurisdictions: { social_security: [BracketOut], disability: [BracketOut] } } ]
                                                          # one entry per person in `people`; empty lists allowed
BracketsIn   += person_id: int | None = None
  person_id set: jurisdictions ⊆ {social_security, disability} else 422
      "{name}: per-person tables exist only for social_security and disability"
    person must be in `people` for body.filing_status else 422 "person {id} is not on a {status} return"
    full replace per (year, jurisdiction, status, person); [] deletes that person table
ClonedBracketsOut inherits both fields; the clone copies person rows too.
WageTaxOut   += per_person: [ PersonWageTaxOut ] = []
PersonWageTaxOut { person_id: int | None, name: str | None, w2_income, taxable_wages, tax: Decimal,
                   effective_rate: Decimal | None, table: 'own' | 'default' }
  populated for social_security and disability (column order); medicare's stays []
```

---

## Task 1 — schema: `person_id` on `tax_brackets` (spec §2.1)

**Files:** modify `backend/app/models/taxes.py` (`TaxBracket`), `backend/app/tax_keys.py`
(`PER_WORKER_JURISDICTIONS`); create
`backend/alembic/versions/20260911_1000_<rev>_tax_bracket_person.py` chained after lane A's
migration (`down_revision` = lane A's revision id — read it from `alembic/versions`); tests in
`backend/tests/test_models_taxes.py`.

- [x] `tax_keys.PER_WORKER_JURISDICTIONS = ("social_security", "disability")`; `api/taxes.py`'s
  `VERBATIM_OK_JURISDICTIONS` becomes an alias of it.
- [x] Model: `person_id: Mapped[int | None] = mapped_column(ForeignKey("people.id", ondelete="RESTRICT"))`;
  replace the `UniqueConstraint` with two `Index(..., unique=True, postgresql_where=text(...))`:
  `ux_tax_brackets_default` on `(year, jurisdiction, filing_status, bracket_index)` where
  `person_id IS NULL`, and `ux_tax_brackets_person` on
  `(year, jurisdiction, filing_status, person_id, bracket_index)` where `person_id IS NOT NULL`
  (the `people` model's partial-index idiom).
- [x] Migration: `op.add_column(...)` nullable FK; `op.drop_constraint("uq_tax_brackets_year", "tax_brackets", type_="unique")`;
  `op.create_index(...)` ×2 with `postgresql_where=sa.text(...)`. Downgrade: delete rows with a
  person, drop both indexes, recreate the constraint, drop the column. Run the drill.
- [x] Tests: default duplicate (same index, both null person) raises `IntegrityError`; person
  duplicate raises; a default row and a person row with the same index coexist; the FK refuses an
  unknown person.
- [x] Commit: `feat(taxes): tax_brackets.person_id with partial unique indexes`.

## Task 2 — engine: per-earner tables and per-person results (spec §2.2)

**Files:** modify `backend/app/services/tax_service.py` (`EarnerWages`, `JurisdictionResult`, the
FICA section of `compute_breakdown`, `shift_earners`); tests in `backend/tests/test_tax_service_married.py`.

- [x] Failing tests:
  - `test_own_disability_table_replaces_the_default_for_that_earner` — default `1% to 300k then 0%`,
    earner B `payroll_tables={"disability": [(0.013, 0)]}`: B pays 1.3% uncapped, A pays the default.
  - `test_own_social_security_cap_is_per_table` — A default (cap 184,500), B own SS table with cap
    100,000 and wages 150,000: B's taxable is 100,000.
  - `test_all_zero_table_taxes_nothing_and_reports_nothing_taxable` — B `{"social_security": [(0, 0)]}`
    with wages 90,000: B's tax 0, taxable 0; the aggregate `taxable_wages` excludes B.
  - `test_empty_mapping_is_the_default_path` — bundles with `payroll_tables={}` equal the existing
    two-earner tests' figures (and the goldens still pass).
  - `test_per_person_results_follow_bundle_order` — `social_security.per_person[i]` matches bundle i:
    `w2_income`, `taxable_wages`, `tax`, `effective_rate`, `own_table`.
  - `test_shift_earners_preserves_payroll_tables` (adapt to lane A's signature).
- [x] Implement: `EarnerWages.payroll_tables: Mapping[str, list[Bracket]] = field(default_factory=dict)`
  (frozen dataclass; a `MappingProxyType` or a plain dict is fine — document). New
  `@dataclass(frozen=True) class EarnerPayroll: w2_income, taxable_wages, tax, effective_rate, own_table: bool`.
  `JurisdictionResult.per_person: list[EarnerPayroll] = field(default_factory=list)`. In the FICA
  section: `table_for(earner, name) = earner.payroll_tables.get(name) or tables[name]`; SS cap
  detection per table; the all-zero rule (`all(rate == 0 for rate, _ in table)` → base 0, tax 0); SS
  per-person `taxable_wages` = capped base, SDI per-person `taxable_wages` = the earner's uncapped
  `sdi_wages` (aggregate conventions preserved: 2024 golden `235424.46`). `shift_earners` copies
  `payroll_tables` onto the re-based head (`dataclasses.replace`).
- [x] Commit: `feat(taxes): earners walk their own per-worker tables; per-person payroll results`.

## Task 3 — feed assembly, withholding, clone, importer (spec §2.3)

**Files:** modify `backend/app/api/taxes.py` (`_engine_tables`, new `_person_tables`, `EngineFeed`,
`_engine_feed`, `_assemble_earners`, `withholding_estimate`'s table wiring, `clone_brackets`,
`_missing_for_status` untouched), `backend/app/importer/apply.py` (bracket query filter); tests in
`backend/tests/test_taxes_api.py`, `backend/tests/test_withholding_api.py`, `backend/tests/test_importer_apply.py`.

- [x] Failing tests:
  - `_engine_tables` ignores person rows (a person SS row must not merge into the default table) —
    API test: summary unchanged after inserting a person row for a person NOT on the return.
  - `test_summary_walks_the_primarys_own_table_on_a_single_year` — single year, primary has a person
    Disability table `1.3% from 0` while the default is `1% to 300k`: the summary's disability tax
    uses 1.3% (the one-bundle rule).
  - `test_joint_summary_uses_each_persons_table` — Edward default (VP shape), Grace own SDI table.
  - `test_withholding_fica_legs_walk_the_primarys_own_tables` — withholding API: the bonus/vest FICA
    leg changes when the primary gets a person SS table with a lower cap.
  - `test_clone_copies_person_rows` — clone single → married_joint carries the person rows with their
    `person_id`.
  - `test_importer_sweep_leaves_person_rows_alone` — a person row survives `apply_taxes`'s sweep.
  - Missing-for-status: a person table alone does not satisfy a missing default (married year still
    refuses).
- [x] Implement: `_engine_tables` adds `TaxBracket.person_id.is_(None)`; `_person_tables(db, year, status)`
  returns `{person_id: {jurisdiction: [Bracket]}}`; `EngineFeed.person_tables`; `_assemble_earners(rows, columns, person_tables)`
  attaches `payroll_tables=person_tables.get(column, {})` and returns a one-bundle list when
  `len(per_person) < 2` but some column has a person table (else the existing `None`);
  `withholding_estimate` passes `person_tables.get(primary_id, {}).get(name) or tables.get(name, [])`
  for the three payroll names; `clone_brackets` copies `person_id`; importer's existing-brackets query
  adds `person_id IS NULL`.
- [x] Commit: `feat(taxes): feed attaches person tables to earners; withholding, clone and importer follow`.

## Task 4 — brackets API (spec §2.4)

**Files:** modify `backend/app/schemas/taxes.py` (`BracketsOut.people/per_person`, `PersonBracketsOut`,
`BracketsIn.person_id`), `backend/app/api/taxes.py` (`_brackets_payload`, `put_brackets`); tests in
`backend/tests/test_taxes_api.py`.

- [x] Failing tests: GET carries `people` for the TAB status (single → primary alone; married_joint →
  both) and `per_person` with one entry per person and only the two per-worker names; PUT with
  `person_id` writes/replaces/deletes that person's table and never touches the default or another
  person; 422 sentences for a non-per-worker jurisdiction and a person off the return; GET of one
  status never shows another status' person rows; `_validated_table` rules apply unchanged.
- [x] Implement: `_brackets_payload` loads default rows (person null) into `jurisdictions` and person
  rows into `per_person` keyed by `people` order; `put_brackets` branches on `body.person_id`
  (validate first, then core DELETE + inserts scoped by person).
- [x] Commit: `feat(taxes): brackets API carries per-person tables`.

## Task 5 — summary API (spec §2.5)

**Files:** modify `backend/app/schemas/taxes.py` (`PersonWageTaxOut`, `WageTaxOut.per_person`),
`backend/app/api/taxes.py` (`_wage_out`, `_summary_out` — it needs the feed's columns and names);
tests in `backend/tests/test_taxes_api.py`, `backend/tests/test_money_flow.py` if it asserts the
summary shape.

- [x] Failing tests: joint summary's `social_security.per_person` has two entries in column order
  with names, `table` = `'own'`/`'default'`, cents-quantized money; `medicare.per_person == []`;
  a roster-less database yields `person_id: null, name: null`; the stored-fixture summaries used by
  other tests still parse (field defaulted).
- [x] Implement: `_wage_out(result, name, warnings, columns=None, names=None)`; `_summary_out` passes
  the feed's columns (`[p.id for p in _return_people(...)]`) and a name map when `feed` is given.
- [x] Commit: `feat(taxes): summary reports each earner's payroll line`.

## Task 6 — gates

- [x] ruff clean; `FINANCE_TEST_DB=finance_test_taxc $PY -m pytest -q` full suite green; goldens
  named as passing.
- [x] Final report: commits, counts, shipped wire shapes vs. the contracts block, anything the spec
  did not anticipate.

---

## What actually happened (lane C implementer, 2026-09-11)

**Status: implemented.** Six commits on `tax/c-payroll-tables-backend` — one per task, plus a
self-review round. The four golden years in `tests/test_tax_service.py` and every test in
`tests/test_tax_service_married.py` pass with UNCHANGED fixtures and values.

### Wire shapes shipped

Exactly the contracts block, with these details pinned:

- `BracketsOut.people` / `BracketsOut.per_person` are REQUIRED, not defaulted — the frontend
  treats them as part of the contract, and both are `[]` on a database with no roster.
  `per_person` carries one entry per person in `people`, in the same order, and each entry's
  `jurisdictions` has BOTH per-worker names, empty lists included.
- `BracketsIn.person_id: int | None = None`; the two 422 sentences are
  `"{name}: per-person tables exist only for social_security and disability"` (built as
  `" and ".join(PER_WORKER_JURISDICTIONS)`, so the tuple owns the copy) and
  `"person {id} is not on a {status} return"` — the same sentence for a person off the
  return and for an id nobody has.
- `WageTaxOut.per_person: list[PersonWageTaxOut] = Field(default_factory=list)` (defaulted,
  so the stored golden fixtures parse); `PersonWageTaxOut` is
  `{person_id, name, w2_income, taxable_wages, tax, effective_rate, table}` with
  `table: Literal['own', 'default']`.
- `ClonedBracketsOut` inherits both new fields and the clone copies person rows with their
  `person_id`.

### Deviations from the plan text

1. **`_wage_out(result, name, warnings, owners=())`**, not `(…, columns=None, names=None)`.
   The plan's `columns` is `[p.id for p in _return_people(...)]`, which is not the list the
   bundles are indexed by: `_assemble_earners` skips columns with no stored rows, so a
   positional read of `columns` can put the primary's name on somebody else's wages. The
   feed now carries `earner_people: list[tuple[int | None, str | None]]` — (id, name) per
   bundle, in bundle order, built from the columns that actually have rows — and `_wage_out`
   reads that. See deviation 9. *(Revised: the pairs now come off the assembly itself —
   Review round item 2.)*
2. **`_payroll_line(earner, name, default_table, base, *, capped)`** is the engine's new
   helper (with `_wage_cap`), rather than a `table_for` closure inside `compute_breakdown`.
   `capped` is the REPORTING convention, not a fact about the table: Social Security reports
   the capped base it taxed, SDI reports the earner's whole wage and lets the terminal 0-rate
   row cap inside the walk (the 2024 golden's `235424.46`). Both aggregates are now the sums
   of the per-person lines, which is byte-identical arithmetic.
3. **`earner_from_inputs(values, payroll_tables=None)`** gained the optional second argument
   so the assembly can build a bundle with its person's tables; `shift_earners` uses
   `dataclasses.replace` as the spec says, so anything about the primary that is not a wage
   survives a what-if rebuild. *(Superseded: `shift_earners` now composes its head through
   `earner_from_inputs` — Review round item 5.)*
4. **The all-zero rule ignores an EMPTY table.** `all(rate == 0 for …)` is vacuously true for
   `[]`, and an empty DEFAULT table (a missing jurisdiction) must keep reporting uncapped
   wages with 0 tax, as it does today. The guard is `if table and all(…)`. *(Narrowed
   further: the guard is `if own and all(…)`, so no DEFAULT table is ever read as an
   exemption — Review round item 4.)*
5. **`PUT /brackets` now scopes its DELETE by person in BOTH directions** (`_person_scope`).
   The plan only asked for the person branch; without the `person_id IS NULL` term on the
   default branch, saving a default table would silently delete every earner's own copy of it.
6. **`_validated_person` runs before `_validated_table`**, so a body naming `federal` with a
   `person_id` gets the per-person sentence rather than a bracket-shape complaint.
7. `EngineFeed.primary_payroll_table(name)` carries the withholding card's rule
   (`person_tables.get(primary_id, {}).get(name) or tables.get(name, [])`) as a method on the
   feed rather than inline at the call site — the marginal-FICA walk happens in
   `withholding_calc`, outside the engine, so the rule needed a second home.
8. **REVOKED by the review round (item 1) — the rule is the RETURN's, and every column
   gets a bundle. The paragraph below is kept for the reasoning it records.**
   **The one-bundle rule is narrowed to the PRIMARY's column** (`present == columns[:1]`).
   The plan's "`len(per_person) < 2` but some column has a person table" also fires on a
   joint return whose only W-2 rows are the PARTNER's — and there the one bundle's head is
   not the primary, which is precisely the invariant `shift_earners` re-bases a what-if on.
   The scenario would have rebuilt that head from the primary's empty bucket and reported a
   liability with the partner's whole wage missing. That state keeps taking the synthesis
   path instead (their own table is ignored, exactly as before this lane), pinned by
   `test_only_the_partners_rows_keeps_the_synthesized_bundle`. Every case the spec names —
   single, MFS, and joint with the primary's rows — is unaffected.
9. `earner_people` is labelled from the columns WITH ROWS (`present or columns[:1]`) on both
   paths, not from `columns` positionally: on the synthesis path at most one column can have
   rows, and the engine's single bundle is that column's, whoever they are. *(Revised: on the
   LIST path the labels are the assembly's own pairs — Review round items 1 and 2.)*

### Pre-existing tests whose pinned behaviour the spec changed

- `test_only_the_partners_rows_keeps_the_synthesized_bundle` — written by deviation 8,
  deleted by the review round (item 1) and replaced by
  `test_the_partners_own_table_is_walked_without_the_primarys_rows`.
- `test_summary_2024_matches_the_sheet_except_the_state_chain` — the `medicare` and
  `disability` wire dicts are compared whole, so both grew their new `per_person` key:
  Medicare's is `[]` and Disability's is the one nameless line for the synthesized bundle
  (`person_id: null, name: null, table: "default"`, figures equal to the aggregate). No money
  moved.

Nothing else in the suite needed a change: `per_person` and the two brackets fields are
additive, and with no person table anywhere the engine is byte-identical.

### Left for the morning list

- Scratch database `finance_test_taxc_mig` was created for the migration drill and left in
  place (`upgrade head` → `downgrade -1` → `upgrade head`, `alembic check` clean at head; the
  downgrade deleted the seeded person row and kept the default one). Nothing was run against
  the dev `finance` database.
- Head is now `d5f2b7c8e390` (chained after lane A's `b8e1c5f7a204`).

### Review round (2026-09-11, both reviewers' items applied in one commit)

Two reviews approved the lane subject to ten items; all ten are in
`fix(taxes): lane C review round — every column gets a bundle when any person holds a
table, one table query per feed, own-table-only zero rule`.

1. **The one-bundle rule is the RETURN's, not the primary's column — deviation 8 above is
   REVOKED.** Spec §2.3 says "whenever any person on the return has a person table", and
   the narrowed version silently walked the DEFAULT on a joint year whose only W-2 rows are
   the PARTNER's while they held their own Disability table. `_assemble_earners` now
   returns `(column, bundle)` PAIRS and builds one for EVERY column in `columns` order
   whenever any column holds a table (or two columns have rows, as before); a column with
   no rows gets a zero-wage bundle. Both halves then hold together: the head is always the
   primary's — the invariant `shift_earners` re-bases a what-if on — and every person walks
   their own table. A zero-wage bundle moves no money (every aggregate is a sum over the
   bundles) and adds an honest zero LINE to `per_person` for the person with nothing
   entered. `test_only_the_partners_rows_keeps_the_synthesized_bundle` is replaced by
   `test_the_partners_own_table_is_walked_without_the_primarys_rows`, plus an API-level
   what-if pin, `test_what_if_keeps_the_partners_wage_base_when_only_they_have_rows`
   (baseline/scenario money differs under either failure: a partner head would cap the
   scenario's leg on their base and meet their own SDI rate).
2. **`earners` and `earner_people` come off that ONE list** — deviations 1 and 9 had two
   derivations of "which columns are these bundles", and `_engine_feed` now unpacks the
   pairs. On the synthesis path, where there is no list, the single bundle is still
   labelled with the one column that has rows (the primary's when nothing is stored).
3. **One query per feed for the year's tables.** `_engine_tables` returns
   `(defaults, person_tables)` from a single `select(TaxBracket).where(year, status)`,
   partitioned on `row.person_id is None`; `_person_tables` is gone. It was two round trips
   per YEAR in the all-years summary and two more on the withholding card. Both stale
   docstrings ("every engine caller", "every caller wants the defaults alone") are rewritten.
4. **The all-zero rule reads an earner's OWN table only** (`if own and all(rate == 0 …)`).
   An all-zero DEFAULT table is a jurisdiction the whole household is not charged by, and
   what shipped before this lane is the full UNCAPPED wage base beside a 0 tax — the
   promise in `_payroll_line`'s own docstring. New golden
   `test_an_all_zero_default_table_is_not_an_exemption`; the own-table exemption test is
   unchanged. Deviation 4's empty-table note is subsumed: `own` is falsy for `[]`.
5. `shift_earners` builds its head through
   `earner_from_inputs(primary_after, earners[0].payroll_tables)` — one door for composing
   a bundle — and `dataclasses.replace` is no longer imported. Deviation 3's last sentence
   is superseded.
6. The two needless `list(own)` copies are gone (nothing mutates a bracket list; `walk`
   sorts a copy of its own).
7. `_validated_person` answers `"unknown person {id}"` — PUT inputs' own sentence, now
   shared as `UNKNOWN_PERSON_MESSAGE` — for an id on NO roster, and keeps
   `"person {id} is not on a {status} return"` for a real person off this status' return.
   Two different fixes deserve two sentences; both are pinned. This revises the wire-shapes
   note above, which said one sentence covered both.
8. `EngineFeed.primary_payroll_table` asserts `name in PER_WORKER_JURISDICTIONS`, and the
   withholding call site reads `feed.tables.get("medicare", [])`: Medicare's additional
   tier is assessed on COMBINED wages, so no person can hold one (deviation 7 stands for
   the two per-worker names).
9. `EarnerWages.payroll_tables` is `field(default_factory=dict, hash=False, compare=False)`
   — a frozen dataclass is hashable, and a dict field inside the hash makes every bundle
   raise `TypeError` in a set or a dict key. Nothing hashes a bundle today; this keeps the
   property true before something does.
10. `tests/test_models_taxes.py`'s `_bracket` helper is sync — it never awaited anything.

**Accepted as-is:** `_statuses_with_rows` and the clone's 409 guard count person rows along
with defaults, so a status holding ONLY a person table reads as "this status has rows".
That state is not reachable through the editor — a person's table is entered on a tab whose
default tables are already there — and both readers are asking "has this year+status been
started", which the count still answers honestly.
