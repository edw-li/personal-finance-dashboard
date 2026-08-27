# P0: Importer Sweep Scoping + Deterministic Seed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the two P0 prerequisites from `docs/superpowers/specs/2026-08-26-household-foundation-married-taxes-design.md` §3 (evidence in `docs/superpowers/specs/2026-08-26-marriage-readiness-audit.md` §9) so the later marriage batches have a safe foundation: (1) the workbook importer's two tax sync-delete sweeps stop destroying rows the sheet never carried, making the standing assumption *"uploads update sheet-tracked values and leave everything else alone"* actually true; (2) `seed_admin_user` becomes deterministic so a second `users` row can never brick a container boot.

**Architecture:** Tiny and surgical — four changed lines inside `apply_taxes` (`backend/app/importer/apply.py`: two new set comprehensions, two widened `if` conditions) and a three-line lookup inside `seed_admin_user` (`backend/app/seed.py`). The sweeps stay exactly where they are — each gains a *vocabulary* set derived from the already-parsed `ParsedTaxes` dataclass (`{item.key for item in parsed.inputs}` / `{item.jurisdiction for item in parsed.brackets}`) and an extra `and` clause on the delete condition. The seed swaps one unordered `select(User).first()` for an ADMIN_EMAIL-match lookup with an `ORDER BY id` fallback. **No migrations, no schema change, no new columns.** This plan runs against TODAY's schema — `tax_inputs.person_id` and `tax_brackets.filing_status` DO NOT EXIST YET; a later plan (spec §9 item 4) extends these same two `if` conditions with status/person clauses.

**Tech Stack:** FastAPI + async SQLAlchemy 2 + Alembic + pydantic v2 (backend), PostgreSQL 16, openpyxl (workbook parse), pytest / pytest-asyncio (`asyncio_mode = "auto"`, session-scoped loops), ruff 0.16.2 (line-length 100).

---

## Conventions and preconditions

**Backend commands run from `backend/`, using the repo's venv interpreter verbatim:**

```
cd backend && .venv/Scripts/python.exe -m pytest tests/<file> -q
cd backend && .venv/Scripts/ruff.exe check .
cd backend && .venv/Scripts/ruff.exe format --check .
```

(Confirmed against `backend/pyproject.toml` `[tool.pytest.ini_options] testpaths = ["tests"]` and the invocation used throughout `docs/superpowers/plans/2026-08-25-credit-cards.md`.)

**Test-DB concurrency hazard (hit while writing this plan):** `backend/tests/conftest.py` points every test at a single shared `finance_test` database and the session-scoped `engine` fixture runs `drop_all`/`create_all`. Two pytest processes at once produce
`asyncpg.exceptions.DeadlockDetectedError: deadlock detected ... [SQL: DROP TABLE users]` and a cascade of bogus ERRORs (including tests failing because their tables were dropped mid-run). **Run exactly ONE pytest process at a time.** Before every run in this plan, check:

```
powershell -NoProfile -Command "@(Get-CimInstance Win32_Process -Filter \"Name like '%python%'\" | Where-Object { $_.CommandLine -like '*pytest*' }).Count"
```

Expect `0`. If it is not 0, wait for the other run to finish and retry — do not kill it, and do not interpret its collateral failures as findings about this plan.

**Design decision pinned by this plan (read before Task 2).** "The workbook's parsed key vocabulary" is the **union across the parsed years**, i.e. `{item.key for item in parsed.inputs}`, *not* a per-year set. A per-year set would make the sweep vacuous (`key in vocab[year]` is logically identical to `(year, key) in incoming_input_keys`, so nothing could ever be deleted). The union keeps today's behaviour for the normal case — a cell blanked in *one* year column while the same sheet row still carries a value in *another* year still sync-deletes — and only spares keys the workbook carries **no value for in any year**, which is exactly the "the sheet doesn't know this key" case (partner W-2 withholding keys, hand-added rows). Same reasoning for brackets: `{item.jurisdiction for item in parsed.brackets}`.

**Verified facts this plan depends on (do not re-derive):**
- `parse_taxes` (`backend/app/importer/parsers.py:546-690`) drops blank cells silently: `collect()` only records a year when `to_decimal(...)` returns non-`None`, and `to_decimal` returns `None` for `None`/blank/error cells **without recording an issue** (`backend/app/importer/cells.py:51-57`).
- The synthetic fixture workbook (`backend/tests/workbook_builder.py:151-183`) produces years 2023/2024 with values and an empty 2025 column, giving `tax_inputs` 86 creates (43 keys x 2 years) and `tax_brackets` 14 creates (7 x 2 years).
- `capital_loss_deductions` is fixture row #26 of the input block, so its default values are `125.0` (2023) and `225.0` (2024).
- `TaxBracket.jurisdiction` is an unconstrained `String(20)` (`backend/app/models/taxes.py:24`) — the "one of tax_keys.JURISDICTIONS" restriction is a comment only, so a hand-parked non-sheet jurisdiction row is insertable today.
- `users.email` is `unique=True` (`backend/app/models/user.py:13`); the collision surfaces as `UniqueViolationError: duplicate key value violates unique constraint "uq_users_email"`.

**Preconditions**

- [ ] **P.1:** Working tree note — sibling plan documents and unrelated frontend edits may be present in `git status` (this batch is planned as six parallel plans under `docs/superpowers/plans/2026-08-26-*.md`). **Never use `git add -A` / `git add .` in this plan.** Every commit step below lists explicit paths; run `git status --short` first and confirm nothing under `backend/` is unexpectedly dirty.
- [ ] **P.2:** Cut a branch from local `main`: `git checkout -b p0-importer-seed`. Do not push.
- [ ] **P.3:** Baseline gate (one pytest process only): `cd backend && .venv/Scripts/python.exe -m pytest -q` — expect ~910 passed, 0 failed. Record the exact number; the plan adds 5 tests, so the final gate should be baseline + 5.

---

## Task 1: Pin the clean-DB no-op tax diff (guard rail)

The whole point of Tasks 2 and 3 is that they must **not** change what happens to sheet-carried data. This test is the guard rail: it locks the "import twice -> no diff" contract for the taxes sheet *before* the sweeps are touched, so an over-scoped fix in Task 2/3 (e.g. accidentally sparing rows the sheet *does* carry) fails loudly here.

**This test is a characterization pin, not a red-green cycle: it is expected to pass on its first run, on unmodified source** (verified while writing this plan — on original `apply.py`/`seed.py` all four Task 2-4 tests fail and this one alone passes: `4 failed, 1 passed`). If it is red, the working tree is not at the baseline — stop and fix that before continuing.

**Files:**
- Test (Modify): `backend/tests/test_importer_service.py` — insert the new test immediately after `test_apply_then_reapply_is_all_skips` (ends line 65), before `test_parse_errors_block_apply_entirely` (line 68).

**Steps:**

- [ ] **Step 1.1: Write the test.** Insert this function into `backend/tests/test_importer_service.py` between line 65 (`    assert third.sheets["net_worth"].entities["account_balances"].skips == 6`) and line 68 (`async def test_parse_errors_block_apply_entirely(db):`), separated by two blank lines on each side:

```python
async def test_dry_run_after_apply_reports_no_tax_drift(db):
    # Guard rail for the P0 sweep scoping: a clean DB that was built by this very workbook
    # must diff as pure skips. Both tax sync-delete sweeps are allowed to become narrower,
    # never wider, and must never start sparing rows the sheet DOES carry.
    from app.importer.report import EntityCounts

    applied = await run_import(build_workbook(), db, dry_run=False)
    assert applied.applied is True and not applied.has_errors

    diff = await run_import(build_workbook(), db, dry_run=True)
    taxes = diff.sheets["taxes"].entities
    assert taxes["tax_inputs"] == EntityCounts(creates=0, updates=0, skips=86, deletes=0)
    assert taxes["tax_brackets"] == EntityCounts(creates=0, updates=0, skips=14, deletes=0)
    assert taxes["tax_years"] == EntityCounts(creates=0, updates=0, skips=2, deletes=0)
    assert diff.sheets["taxes"].samples == []
```

  `run_import` and `build_workbook` are already imported at the top of the file (lines 8 and 10); `EntityCounts` is imported function-locally so the module header stays untouched.

- [ ] **Step 1.2: Run it — expect GREEN.** `cd backend && .venv/Scripts/python.exe -m pytest tests/test_importer_service.py -q`
  Expected: `9 passed` (8 existing + 1 new). If instead you see a failure such as `assert EntityCounts(creates=0, updates=0, skips=0, deletes=0) == EntityCounts(creates=0, updates=0, skips=86, deletes=0)`, the DB or working tree is dirty — do not "fix" the assertion, fix the environment.

- [ ] **Step 1.3: Lint.** `cd backend && .venv/Scripts/ruff.exe check tests/test_importer_service.py && .venv/Scripts/ruff.exe format --check tests/test_importer_service.py`
  Expected: `All checks passed!` and `1 file already formatted`.

- [ ] **Step 1.4: Commit.**
```
git add backend/tests/test_importer_service.py
git commit -m "test(importer): pin the clean-DB no-op tax diff before scoping the sweeps"
```

---

## Task 2: Scope the tax-input sync-delete to the sheet's own key vocabulary

Today `apply_taxes` deletes **every** `tax_inputs` row in an imported year whose `(year, key)` pair is not on the sheet. Any hand-added / UI-added key is destroyed by the next workbook Apply. After this task, the sweep only considers keys the workbook itself carries.

**Files:**
- Modify: `backend/app/importer/apply.py` — two edits inside `apply_taxes` (defined line 460): insert a vocabulary set just above line 496 (`incoming_input_keys: set[tuple[int, str]] = set()`), and widen the delete condition at line 513 (`if key not in incoming_input_keys:`) inside the sweep at lines 512-516.
- Test (Modify): `backend/tests/test_importer_apply.py` — insert the new test immediately after `test_apply_taxes_syncs_brackets_and_inputs_within_imported_years` (ends line 477), before `test_apply_espp_lots_and_periods` (line 480).

**Steps:**

- [ ] **Step 2.1: Write the failing test.** Insert this function into `backend/tests/test_importer_apply.py` between line 477 (`    assert untouched.value == Decimal("1.0000")`) and line 480 (`async def test_apply_espp_lots_and_periods(db):`), separated by two blank lines on each side. It follows the file's existing style exactly: the module-level `sheets(**overrides)` helper (line 51) plus function-local imports.

```python
async def test_apply_taxes_keeps_inputs_for_keys_the_sheet_does_not_carry(db):
    # P0 (marriage spec section 3.1): a key the workbook carries NO value for in ANY year
    # column is outside the sheet's vocabulary — its rows are hand/UI-owned and must survive
    # a re-import. Sheet-carried cells still win exactly as before.
    from app.importer.apply import apply_taxes
    from app.importer.parsers import parse_taxes
    from app.models import TaxInput
    from tests.workbook_builder import default_taxes_rows

    report = SheetReport()
    await apply_taxes(db, parse_taxes(sheets()["Taxes"]), report)
    await db.commit()
    assert report.entities["tax_inputs"].creates == 86

    hand_edited = (
        await db.execute(
            select(TaxInput).where(TaxInput.year == 2023, TaxInput.key == "capital_loss_deductions")
        )
    ).scalar_one()
    hand_edited.value = Decimal("-3000.0000")
    await db.commit()

    rows = default_taxes_rows()
    for row in rows:
        if row[1] == "Capital Loss Deductions":
            row[2] = row[3] = row[4] = None
        if row[1] == "Annual Salary":
            row[2] = 111.0
    report2 = SheetReport()
    await apply_taxes(db, parse_taxes(sheets(taxes=rows)["Taxes"]), report2)
    await db.commit()

    assert report2.entities["tax_inputs"].deletes == 0
    assert report2.entities["tax_inputs"].updates == 1  # annual_salary 2023 only
    assert report2.entities["tax_inputs"].skips == 83  # 42 sheet keys x 2 years, minus that 1
    survivors = {
        row.year: row.value
        for row in (
            await db.execute(select(TaxInput).where(TaxInput.key == "capital_loss_deductions"))
        ).scalars()
    }
    assert survivors == {2023: Decimal("-3000.0000"), 2024: Decimal("225.0000")}
    salary = (
        await db.execute(
            select(TaxInput.value).where(TaxInput.year == 2023, TaxInput.key == "annual_salary")
        )
    ).scalar_one()
    assert salary == Decimal("111.0000")
```

  Everything it needs is already at the top of the file: `Decimal` (line 2), `select` (line 4), `SheetReport` (line 20), `sheets()` (line 51). Do not add module-level imports.

- [ ] **Step 2.2: Run it — expect RED.** `cd backend && .venv/Scripts/python.exe -m pytest tests/test_importer_apply.py -q -k keeps_inputs_for_keys`
  Expected failure (the current sweep deletes both `capital_loss_deductions` rows):
```
>       assert report2.entities["tax_inputs"].deletes == 0
E       assert 2 == 0
E        +  where 2 = EntityCounts(creates=0, updates=1, skips=83, deletes=2).deletes
...
FAILED tests/test_importer_apply.py::test_apply_taxes_keeps_inputs_for_keys_the_sheet_does_not_carry
1 failed, 33 deselected
```

  Note what that `EntityCounts` proves: `updates=1` and `skips=83` are already correct on unmodified source — the *only* thing wrong today is the 2 deletes. That is the whole change.

- [ ] **Step 2.3: Implement — add the vocabulary set.** In `backend/app/importer/apply.py`, replace exactly:

```python
    incoming_input_keys: set[tuple[int, str]] = set()
    for item in parsed.inputs:
```

  with:

```python
    # The sweep below may only touch keys the workbook itself carries. A key with no value in
    # any year column never reaches parsed.inputs, so hand-entered / UI-only rows (and the
    # per-person keys the married-taxes batch adds) are invisible to the sweep and survive.
    # Union across parsed years on purpose: a cell blanked in ONE year while the same sheet
    # row still carries another year is still a sheet key, and still sync-deletes as today.
    sheet_input_keys = {item.key for item in parsed.inputs}
    incoming_input_keys: set[tuple[int, str]] = set()
    for item in parsed.inputs:
```

- [ ] **Step 2.4: Implement — narrow the delete condition.** In the same file, replace exactly:

```python
    for key, row in existing_inputs.items():
        if key not in incoming_input_keys:
```

  with:

```python
    for key, row in existing_inputs.items():
        if key not in incoming_input_keys and key[1] in sheet_input_keys:
```

  Leave the three lines inside the `if` (`await db.delete(row)`, `input_counts.deletes += 1`, the `report.add_sample(...)` line) exactly as they are.

- [ ] **Step 2.5: Run to pass.** `cd backend && .venv/Scripts/python.exe -m pytest tests/test_importer_apply.py -q`
  Expected: `34 passed` (33 existing + 1 new). In particular `test_apply_taxes_years_inputs_brackets` and `test_apply_taxes_syncs_brackets_and_inputs_within_imported_years` must still pass unchanged.

- [ ] **Step 2.6: Re-run the Task 1 guard rail.** `cd backend && .venv/Scripts/python.exe -m pytest tests/test_importer_service.py -q`
  Expected: `9 passed`.

- [ ] **Step 2.7: Lint.** `cd backend && .venv/Scripts/ruff.exe check app/importer/apply.py tests/test_importer_apply.py && .venv/Scripts/ruff.exe format --check app/importer/apply.py tests/test_importer_apply.py`
  Expected: `All checks passed!` and `2 files already formatted`.

- [ ] **Step 2.8: Commit.**
```
git add backend/app/importer/apply.py backend/tests/test_importer_apply.py
git commit -m "fix(importer): scope tax-input sync-deletes to the sheet's key vocabulary"
```

---

## Task 3: Scope the tax-bracket sync-delete to the sheet's own jurisdictions

Same hazard, brackets edition: `apply_taxes` deletes every `tax_brackets` row in an imported year whose `(year, jurisdiction, bracket_index)` is not on the sheet — including tables under a jurisdiction the workbook has never heard of. This is defensive today (the parser hard-errors unless all six of `BRACKET_SECTIONS` are present, `parsers.py:661-667`), and it is the seam the later status-dimensioned bracket work extends.

**Files:**
- Modify: `backend/app/importer/apply.py` — two edits inside `apply_taxes`: insert a jurisdiction set just above line 524 (`incoming_bracket_keys: set[tuple[int, str, int]] = set()`), and widen the delete condition at line 550 inside the sweep at lines 548-553.
- Test (Modify): `backend/tests/test_importer_apply.py` — insert the new test immediately after `test_apply_taxes_keeps_inputs_for_keys_the_sheet_does_not_carry` (added in Task 2), before `test_apply_espp_lots_and_periods`.

**Steps:**

- [ ] **Step 3.1: Write the failing test.** Insert this function into `backend/tests/test_importer_apply.py` directly after the Task 2 test, separated by two blank lines on each side:

```python
async def test_apply_taxes_keeps_brackets_for_jurisdictions_absent_from_the_sheet(db):
    # P0 (marriage spec section 3.2): bracket tables parked under a jurisdiction the workbook
    # never mentions are invisible to the sweep. The six sheet jurisdictions still sync-delete
    # exactly as today — pinned in the same test so a wider fix cannot slip through.
    from app.importer.apply import apply_taxes
    from app.importer.parsers import parse_taxes
    from app.models import TaxBracket
    from tests.workbook_builder import default_taxes_rows

    report = SheetReport()
    await apply_taxes(db, parse_taxes(sheets()["Taxes"]), report)
    await db.commit()
    assert report.entities["tax_brackets"].creates == 14

    db.add(
        TaxBracket(
            year=2023,
            jurisdiction="federal_mfj",
            bracket_index=1,
            rate=Decimal("0.1000"),
            threshold=Decimal("0.00"),
        )
    )
    await db.commit()

    rows = [
        row
        for row in default_taxes_rows()
        if not (row[1] == "Bracket 2 Rate" and row[0] is None)
        and not (row[1] == "Bracket 2 Threshold" and row[0] is None)
    ]  # federal bracket 2 removed from the sheet
    report2 = SheetReport()
    await apply_taxes(db, parse_taxes(sheets(taxes=rows)["Taxes"]), report2)
    await db.commit()

    assert report2.entities["tax_brackets"].deletes == 2  # 2023 + 2024 federal bracket 2 only
    gone = (
        (
            await db.execute(
                select(TaxBracket).where(
                    TaxBracket.jurisdiction == "federal", TaxBracket.bracket_index == 2
                )
            )
        )
        .scalars()
        .all()
    )
    assert gone == []
    survivor = (
        await db.execute(select(TaxBracket).where(TaxBracket.jurisdiction == "federal_mfj"))
    ).scalar_one()
    assert survivor.year == 2023 and survivor.bracket_index == 1
    assert survivor.rate == Decimal("0.1000")
```

- [ ] **Step 3.2: Run it — expect RED.** `cd backend && .venv/Scripts/python.exe -m pytest tests/test_importer_apply.py -q -k keeps_brackets_for_jurisdictions`
  Expected failure (the current sweep also deletes the `federal_mfj` row, making it 3 deletes):
```
>       assert report2.entities["tax_brackets"].deletes == 2  # 2023 + 2024 federal bracket 2 only
E       assert 3 == 2
E        +  where 3 = EntityCounts(creates=0, updates=0, skips=12, deletes=3).deletes
...
FAILED tests/test_importer_apply.py::test_apply_taxes_keeps_brackets_for_jurisdictions_absent_from_the_sheet
1 failed, 34 deselected
```

  The third delete is the `federal_mfj` row. `skips=12` (14 minus the two removed federal bracket-2 rows) is already correct today.

- [ ] **Step 3.3: Implement — add the jurisdiction set.** In `backend/app/importer/apply.py`, replace exactly:

```python
    incoming_bracket_keys: set[tuple[int, str, int]] = set()
    for item in parsed.brackets:
```

  with:

```python
    # Defensive scoping, mirroring sheet_input_keys above: jurisdictions the workbook never
    # mentions are invisible to the sweep. Today parse_taxes hard-errors unless all six of
    # BRACKET_SECTIONS are present, so this changes nothing for sheet-carried tables.
    sheet_jurisdictions = {item.jurisdiction for item in parsed.brackets}
    incoming_bracket_keys: set[tuple[int, str, int]] = set()
    for item in parsed.brackets:
```

- [ ] **Step 3.4: Implement — narrow the delete condition.** In the same file, replace exactly:

```python
    # Stale brackets are load-bearing wrong data for the Plan 5 engine — sync-delete them.
    for key, row in existing_brackets.items():
        if key not in incoming_bracket_keys:
```

  with:

```python
    # Stale brackets are load-bearing wrong data for the Plan 5 engine — sync-delete them,
    # but only within jurisdictions the workbook actually carries (see sheet_jurisdictions).
    for key, row in existing_brackets.items():
        if key not in incoming_bracket_keys and key[1] in sheet_jurisdictions:
```

  Leave the three lines inside the `if` (`await db.delete(row)`, `bracket_counts.deletes += 1`, the `report.add_sample(...)` line) exactly as they are.

- [ ] **Step 3.5: Run to pass.** `cd backend && .venv/Scripts/python.exe -m pytest tests/test_importer_apply.py -q`
  Expected: `35 passed` (33 existing + 2 new).

- [ ] **Step 3.6: Re-run the Task 1 guard rail.** `cd backend && .venv/Scripts/python.exe -m pytest tests/test_importer_service.py -q`
  Expected: `9 passed`.

- [ ] **Step 3.7: Lint.** `cd backend && .venv/Scripts/ruff.exe check app/importer/apply.py tests/test_importer_apply.py && .venv/Scripts/ruff.exe format --check app/importer/apply.py tests/test_importer_apply.py`
  Expected: `All checks passed!` and `2 files already formatted`.

- [ ] **Step 3.8: Commit.**
```
git add backend/app/importer/apply.py backend/tests/test_importer_apply.py
git commit -m "fix(importer): scope tax-bracket sync-deletes to the sheet's jurisdictions"
```

---

## Task 4: Deterministic admin seed

`backend/start.sh:4` runs `python -m app.seed` on **every** container boot. `seed_admin_user` currently does `select(User)` with no `ORDER BY` and renames whatever row Postgres happens to hand back first. With two rows that is (a) nondeterministic and (b) a boot-breaking `UniqueViolationError` whenever the arbitrarily-chosen row is renamed onto an email another row already owns. Fix: look up by `ADMIN_EMAIL` first, fall back to `ORDER BY id`, create only when the table is empty. The single-row behaviour (rename, never duplicate, never rotate the password) is unchanged.

**Files:**
- Modify: `backend/app/seed.py` — `seed_admin_user` (lines 15-23).
- Test (Modify): `backend/tests/test_seed.py` — add `hash_password` to the imports (after line 5) and insert two tests after `test_seed_admin_user_is_idempotent_and_keeps_password` (ends line 47), before `test_seed_app_settings_inserts_defaults_once` (line 50).

**Steps:**

- [ ] **Step 4.1: Add the test import.** In `backend/tests/test_seed.py`, replace exactly:

```python
from app.seed import seed_admin_user, seed_app_settings, seed_tax_definitions
from app.tax_keys import TAX_INPUT_DEFINITIONS
```

  with:

```python
from app.security import hash_password
from app.seed import seed_admin_user, seed_app_settings, seed_tax_definitions
from app.tax_keys import TAX_INPUT_DEFINITIONS
```

- [ ] **Step 4.2: Write the two failing tests.** Insert both functions into `backend/tests/test_seed.py` between line 47 (`    assert user.password_hash == original_hash  # re-seeding never rotates the password`) and line 50 (`async def test_seed_app_settings_inserts_defaults_once(db):`), separated by two blank lines on each side:

```python
async def test_seed_admin_user_renames_the_lowest_id_row(db, monkeypatch):
    # start.sh runs the seed on EVERY boot; with two rows the old unordered .first() renamed
    # an arbitrary row. Insert the HIGHER id first so heap order (what an unordered scan
    # returns) is the reverse of id order — then only an ORDER BY id can pick row 1.
    monkeypatch.setattr(seed_module.settings, "admin_password", "changeme123")
    db.add(User(id=2, email="second@example.com", password_hash=hash_password("b")))
    await db.flush()
    db.add(User(id=1, email="first@example.com", password_hash=hash_password("a")))
    await db.commit()
    assert [u.id for u in (await db.execute(select(User))).scalars()] == [2, 1]

    monkeypatch.setattr(seed_module.settings, "admin_email", "admin@example.com")
    await seed_admin_user(db)
    await db.commit()
    rows = (await db.execute(select(User).order_by(User.id))).scalars().all()
    assert [(u.id, u.email) for u in rows] == [
        (1, "admin@example.com"),
        (2, "second@example.com"),
    ]


async def test_seed_admin_user_prefers_the_row_that_already_owns_admin_email(db, monkeypatch):
    # The boot-breaking case: renaming any OTHER row onto an email that is already taken
    # violates users.email's unique index and 500s the container. Match by email first.
    monkeypatch.setattr(seed_module.settings, "admin_password", "changeme123")
    db.add_all(
        [
            User(id=1, email="stale@example.com", password_hash=hash_password("a")),
            User(id=2, email="admin@example.com", password_hash=hash_password("b")),
        ]
    )
    await db.commit()
    monkeypatch.setattr(seed_module.settings, "admin_email", " Admin@Example.com ")
    await seed_admin_user(db)
    await db.commit()
    rows = (await db.execute(select(User).order_by(User.id))).scalars().all()
    assert [(u.id, u.email) for u in rows] == [
        (1, "stale@example.com"),
        (2, "admin@example.com"),
    ]
```

  `select` (line 1), `seed_module` (line 3), `User` (line 4) and `seed_admin_user` (line 5) are already imported; Step 4.1 added `hash_password`.

- [ ] **Step 4.3: Run them — expect RED (both).** `cd backend && .venv/Scripts/python.exe -m pytest tests/test_seed.py -q -k "renames_the_lowest_id_row or prefers_the_row"`
  Expected failures:
```
>       assert [(u.id, u.email) for u in rows] == [
E       AssertionError: assert [(1, 'first@e...example.com')] == [(1, 'admin@e...example.com')]
E
E         At index 0 diff: (1, 'first@example.com') != (1, 'admin@example.com')
...
E   asyncpg.exceptions.UniqueViolationError: duplicate key value violates unique constraint "uq_users_email"
E   DETAIL:  Key (email)=(admin@example.com) already exists.
...
FAILED tests/test_seed.py::test_seed_admin_user_renames_the_lowest_id_row
FAILED tests/test_seed.py::test_seed_admin_user_prefers_the_row_that_already_owns_admin_email
2 failed, 6 deselected
```

  The first failure shows the unordered `.first()` picked id=2 and renamed it (leaving id=1 alone); the second is the boot-breaking collision itself, surfacing through SQLAlchemy as `sqlalchemy.exc.IntegrityError` raised from `await db.commit()`.

- [ ] **Step 4.4: Implement.** In `backend/app/seed.py`, replace exactly:

```python
async def seed_admin_user(db: AsyncSession) -> None:
    email = settings.admin_email.strip().lower()
    existing = (await db.execute(select(User))).scalars().first()
    if existing is None:
        db.add(User(email=email, password_hash=hash_password(settings.admin_password)))
        print(f"Created user {email}")
    elif existing.email != email:
        existing.email = email  # single-user app: rename, don't duplicate
        print(f"Updated admin email to {email}")
```

  with:

```python
async def seed_admin_user(db: AsyncSession) -> None:
    email = settings.admin_email.strip().lower()
    # start.sh runs this on EVERY boot, so it must be deterministic on a multi-row table:
    # prefer the row that already owns ADMIN_EMAIL (renaming any other row onto it violates
    # users.email's unique index -> boot 500), else the lowest id. A bare select(User) has no
    # ORDER BY and returns rows in arbitrary heap order.
    existing = (await db.execute(select(User).where(User.email == email))).scalars().first()
    if existing is None:
        existing = (await db.execute(select(User).order_by(User.id))).scalars().first()
    if existing is None:
        db.add(User(email=email, password_hash=hash_password(settings.admin_password)))
        print(f"Created user {email}")
    elif existing.email != email:
        existing.email = email  # single-user app: rename, don't duplicate
        print(f"Updated admin email to {email}")
```

  Nothing else in `seed.py` changes — the password hash is still only written on create, never on rename, and `seed_tax_definitions` / `seed_app_settings` / `seed()` are untouched.

- [ ] **Step 4.5: Run to pass.** `cd backend && .venv/Scripts/python.exe -m pytest tests/test_seed.py -q`
  Expected: `8 passed` (6 existing + 2 new). The three pre-existing `seed_admin_user` tests must still pass: empty table still creates; a lone row whose email differs is still found by the `ORDER BY id` fallback and renamed; a lone row whose email matches is found by the email lookup and left alone (password preserved).

- [ ] **Step 4.6: Lint.** `cd backend && .venv/Scripts/ruff.exe check app/seed.py tests/test_seed.py && .venv/Scripts/ruff.exe format --check app/seed.py tests/test_seed.py`
  Expected: `All checks passed!` and `2 files already formatted`.

- [ ] **Step 4.7: Commit.**
```
git add backend/app/seed.py backend/tests/test_seed.py
git commit -m "fix(seed): deterministic admin lookup by email then lowest id"
```

---

## Task 5: Full verification gate

No new code — this task exists so the plan cannot be declared done on targeted runs alone (superpowers:verification-before-completion: evidence before assertions).

**Files:** none (verification only; no commit).

**Steps:**

- [ ] **Step 5.1: Confirm no other pytest process is running** (see the concurrency hazard above), then run the whole backend suite: `cd backend && .venv/Scripts/python.exe -m pytest -q`
  Expected: `<P.3 baseline + 5> passed`, 0 failed. Do NOT pipe this through `grep`/`head` — that masks the exit code.

- [ ] **Step 5.2: Lint the whole backend.** `cd backend && .venv/Scripts/ruff.exe check . && .venv/Scripts/ruff.exe format --check .`
  Expected: `All checks passed!` and `<N> files already formatted`.

- [ ] **Step 5.3: Confirm the diff touches exactly five files.** `git diff main...HEAD --stat`
  Expected exactly five files and nothing else: `backend/app/importer/apply.py`, `backend/app/seed.py`, `backend/tests/test_importer_apply.py`, `backend/tests/test_importer_service.py`, `backend/tests/test_seed.py`. If anything under `src/`, `docs/`, or `backend/alembic/` appears, an unrelated file was staged — unstage it and amend the offending commit.

- [ ] **Step 5.4: Confirm no migration was added.** `git diff main...HEAD --name-only -- backend/alembic`
  Expected: empty output. This plan is schema-free by design.

- [ ] **Step 5.5: Frontend is untouched** — no vitest run is required. (Sanity check only: `git diff main...HEAD --name-only -- src` must be empty.)

---

## Forward notes for the later marriage plans

- The two `if` conditions changed here are the exact extension points for spec §3: the input sweep gains `and (row.person_id is None or row.person_id == primary_person_id)`, and the bracket sweep gains `and row.filing_status == "single"`. Both columns are added by the batch-2/batch-4 migrations; **neither exists today** and neither is referenced anywhere in this plan.
- `test_apply_taxes_keeps_inputs_for_keys_the_sheet_does_not_carry` is the test the two tracker-only keys from spec §5.6 (`w2_fed_withholding`, `w2_state_withholding`) rely on: once they exist as `tax_input_definitions` rows that never appear on the sheet, they are automatically outside `sheet_input_keys` and survive every re-import.
- The `federal_mfj` jurisdiction string used in the bracket test is a stand-in for "any jurisdiction the sheet does not carry" — it is **not** the design's representation for MFJ tables (that is `tax_brackets.filing_status`). Update the test's fixture jurisdiction if it ever collides with real data.
