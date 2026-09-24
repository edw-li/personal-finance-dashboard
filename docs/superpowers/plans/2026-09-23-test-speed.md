# Backend test speed-up + flaky tests — implementation plan (2026-09-23)

> **For agentic workers:** execute task by task, TDD where a task adds behaviour, commit after each
> task. Steps use checkbox (`- [ ]`) syntax. Record what you measured and decided in the
> "Execution record" section at the end, and commit it.

**Goal:** the full backend suite drops from ~22 min on a quiet box (2,327 passed / 4 skipped in
1,334.77 s at main @b33c202b — the reorder batch's V run) to **≤ 6 min serial** and **~2 min with
`-n 4`**, with no test proving less than before; the known load-sensitive flaky tests (2 backend,
4 frontend) become deterministic.

**Why (the user's words, 2026-09-23):** "why does the backend suite take so long … it used to go by
fairly quick" → approved: "let's speed up the backend tests" — the proposal was (a) a cheap per-test
reset instead of the 44-table TRUNCATE, (b) a low-cost bcrypt hash in tests, (c) optional parallel
workers with one database each, and fix the flaky tests. **Test infrastructure only.** Production
code does not change — if a flaky test exposes a genuine production defect, STOP and report it to
the controller with evidence before touching `backend/app/**` or `src/**` (non-test files).

**Measured today (per test, this box, Docker Postgres 16 on 127.0.0.1:5433):**
| Cost | Median | Share of the ~22 min |
|---|---|---|
| `db` fixture teardown — `TRUNCATE` of all 44 tables `RESTART IDENTITY CASCADE` | 584 ms (min 473, max 3,320) | ~20 min |
| bcrypt at cost 12: hash in `seeded_user` 201 ms + verify at login in `auth_client` 209 ms (89 of 107 test files use `auth_client`) | ~410 ms per logged-in test | ~7–8 min under load |
| One query round trip (`SELECT 1`) | 0.8 ms | — |
The pytest process used only ~340 CPU-seconds in ~25 min of wall time: it waits on Postgres.

**Where you work:** worktree `C:\Users\edyli\personal-finance-dashboard\.worktrees\test-speed`,
branch `chore/test-speed` (from main @b33c202b). Its `node_modules` is a JUNCTION to the main repo's
— never delete it recursively; never run `rm -rf` on the worktree.
- Backend: `cd /c/Users/edyli/personal-finance-dashboard/.worktrees/test-speed/backend` and run
  `/c/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe -m pytest …` (tests
  import `app` from the CWD; there is no editable install). ALWAYS set a private test database:
  `FINANCE_TEST_DB=finance_test_speed` (a second concurrent run: `finance_test_speed2`). The name
  must match `<name>_test[_suffix]` (the conftest guard).
- Dev Postgres: Docker container `finance-dashboard-db-1`, user/password `finance`/`finance`,
  `docker exec finance-dashboard-db-1 psql -U finance -d postgres …`. Never touch `finance`,
  `finance_realdata` or any other `finance_test_*` database; drop yours at the end.
- Frontend: from the worktree root, `npx vitest run <file>`; `npx tsc -b`; `npx eslint <files>`.
- Git Bash quirk on this box: if `cat`/`sed`/`grep` report "command not found", start the command
  with `export PATH="/usr/bin:/mingw64/bin:$PATH";`. PowerShell is also available.
- Nothing else heavy should run while you take final timings; note the machine load you saw.

---

### Task 1 — Fast per-test reset in the `db` fixture

**Files:** `backend/tests/conftest.py` (the `db` fixture, lines ~58-71), new
`backend/tests/test_conftest_reset.py`.

Today:
```python
@pytest.fixture
async def db(engine):
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    tables = Base.metadata.sorted_tables
    if tables:
        names = ", ".join(f'"{t.name}"' for t in reversed(tables))
        async with engine.begin() as conn:
            await conn.exec_driver_sql(f"TRUNCATE {names} RESTART IDENTITY CASCADE")
```

Keep TRUNCATE's observable contract for the next test — **every table empty, every used
sequence/identity back at its start value, committed** (many tests open their own sessions on the
shared `engine` and commit for real: test_read_cache, test_reorder_serialization, ordering_helpers,
test_month_review_api, test_price_service, test_export_api, test_assistant_*; a rollback-per-test
scheme would break them, so it is out) — in ONE round trip:

```python
def _fast_reset_sql() -> str:
    """One statement (a DO block works through asyncpg's prepared path; a ';'-joined string would
    not): delete children first, then put every used sequence back at its start — what TRUNCATE …
    RESTART IDENTITY did, without TRUNCATE's per-table file swap (~13 ms a table here)."""
    deletes = "\n".join(
        f'    DELETE FROM "{t.name}";' for t in reversed(Base.metadata.sorted_tables)
    )
    return (
        "DO $reset$\nDECLARE s record;\nBEGIN\n"
        f"{deletes}\n"
        "    FOR s IN SELECT schemaname, sequencename, start_value FROM pg_sequences\n"
        "             WHERE schemaname = current_schema() AND last_value IS NOT NULL LOOP\n"
        "        PERFORM setval(format('%I.%I', s.schemaname, s.sequencename), s.start_value, false);\n"
        "    END LOOP;\n"
        "END $reset$"
    )
```
- Build the fast statement and the old TRUNCATE statement ONCE (module level or session fixture).
- `reset_database(engine)` runs the fast statement in `engine.begin()`; on ANY `Exception` it runs
  the old TRUNCATE statement in a fresh `engine.begin()` (so a surprise — an FK cycle child-first
  DELETE cannot satisfy, a lock timeout — costs speed, never a dirty database). Keep the TRUNCATE
  path.
- Reset every USED sequence, not only the tables' own: `nextval` is not transactional, so a test
  whose insert rolled back still advanced a sequence and the next test may expect id 1.
- `setval(seq, start_value, false)` makes the next `nextval` return `start_value`, as `RESTART
  IDENTITY` does — for serial and identity columns alike (both own a sequence in `pg_sequences`).
- Checked by the controller: no `CREATE TRIGGER`/`CREATE FUNCTION` in `backend/alembic` or
  `backend/app`, so DELETE fires only FK checks. You check: does `Base.metadata.sorted_tables` warn
  about an FK cycle? Record the answer.

- [ ] **Step 1: failing tests** in `backend/tests/test_conftest_reset.py` (they call the helper
  explicitly and must leave the database clean, like every test):
  - `test_reset_empties_every_table_and_restarts_ids` — insert rows across an FK chain (e.g. a User,
    then rows in two tables that reference each other's parents — pick real models), advance a
    sequence with an insert you roll back, call `reset_database(engine)`, assert EVERY table in
    `Base.metadata.sorted_tables` is empty (one `SELECT count(*)`/`EXISTS` per table is fine) and a
    fresh insert into the advanced table gets `id == 1`.
  - `test_reset_is_visible_to_other_connections` — after the reset, a separate
    `async_sessionmaker(engine)()` session sees the tables empty.
  - `test_reset_falls_back_to_truncate` — make the fast statement fail (monkeypatch the constant or
    the helper's fast path to raise) → the tables are still emptied and ids restart.
- [ ] **Step 2:** implement `reset_database` + wire the `db` fixture teardown to it; run the new
  tests, then a broad slice (e.g. `tests/test_read_cache.py tests/test_reorder_serialization.py
  tests/test_month_review_api.py tests/test_auth.py`) green.
- [ ] **Step 3: measure** the teardown the way it was measured before (create_all once, then time
  20× `async with engine.begin(): exec_driver_sql(<stmt>)` on a DB with a few rows inserted each
  time): old TRUNCATE vs new DO block. Target ≤ 20 ms median. Record both.
- [ ] **Step 4: commit** — `test(conftest): reset the test database by deleting rows and restarting
  used sequences in one statement, not a 44-table TRUNCATE (<old> → <new> ms per test)`.

### Task 2 — bcrypt at its minimum cost, in tests only

**Files:** `backend/tests/conftest.py`, `backend/tests/test_security.py`.
- Session-scoped autouse fixture capping `bcrypt.gensalt` to `rounds=4` (bcrypt's minimum) for the
  whole run, via `pytest.MonkeyPatch.context()` (a session fixture cannot use the function-scoped
  `monkeypatch`). `app.security.hash_password` calls `bcrypt.gensalt()` through the module
  attribute, so this covers `seeded_user`, the seed tests and every other hash; `bcrypt.checkpw`
  reads the cost from the hash, so logins against these hashes take ~1 ms. Production code is
  untouched.
- Guard test in `test_security.py`: with the REAL `gensalt` restored for that one test (keep a
  reference to it in the conftest, or restore via `monkeypatch.setattr(bcrypt, "gensalt",
  <original>)`), `hash_password("x")` starts with `$2b$12$` — proves the speed-up is test-only
  (~200 ms once).
- Checked by the controller: no test relies on cost 12 (`test_seed.py` asserts only the `$2b$`
  prefix; `test_auth.py:36` is a comment about response timing).
- [ ] implement, run `tests/test_security.py tests/test_seed.py tests/test_auth.py` green, measure
  one `auth_client` test's setup before/after, commit — `test(conftest): bcrypt at its minimum cost
  while tests run (hash + login ~410 ms → ~<n> ms per logged-in test); production keeps the default`.

### Task 3 — Opt-in parallel runs (pytest-xdist), one database per worker

**Files:** `backend/requirements-dev.txt`, `backend/tests/conftest.py`.
- [ ] `pip index versions pytest-xdist` (or the release notes) → pin the newest release that
  supports pytest 9.1.1 in `requirements-dev.txt`; install it into the shared venv:
  `/c/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe -m pip install
  pytest-xdist==<ver>`. **If pip cannot reach the index from this box, skip Task 3, say so in the
  record, and go on** (don't vendor wheels, don't change pip config).
- [ ] conftest: `worker = os.environ.get("PYTEST_XDIST_WORKER")` → database `f"{base}_{worker}"`
  when set (e.g. `finance_test_speed_gw0`), else `base` exactly as today. Keep the guard regex and
  make sure it still accepts both forms. Each worker bootstraps its own database
  (`_ensure_test_database`) and runs drop_all/create_all once (the session `engine` fixture).
- [ ] Default stays SERIAL: no `-n` in `addopts` (lanes often run several suites at once on this box,
  and CI's `pytest -v` in `.github/workflows/ci.yml` stays as it is).
- [ ] Look for anything not parallel-safe: fixed ports, files written outside `tmp_path`, tests that
  shell out with the configured database (`test_ops_scripts.py`, `test_lifecycle_cli.py`), state
  shared across processes. Fix only real conflicts.
- [ ] Run `-n 4` three times: all green, identical pass counts to serial. Record wall times.
- [ ] Commit — `test(conftest): opt-in parallel runs — pytest-xdist with one database per worker
  (<serial> → <parallel> for a lone full run)`.

### Task 4 — Flaky tests: root cause first, then deterministic, never weaker

Rules for every item: reproduce (run the test/file 10–20× alone and under load — e.g. while a full
backend suite or a full `npx vitest run` runs beside it); name the actual race in the commit
message; fix the TEST to wait for the real precondition, or give a timing window a margin that is
large relative to scheduler jitter while keeping every inequality the test relies on; never delete
an assertion or loosen what it proves; a genuine production defect → stop and report. Afterwards:
20/20 green runs of the file under load. One commit per test or per file.

Backend — `backend/tests/test_assistant_evidence.py` (production knobs in
`backend/app/services/assistant_chat.py`: `MODEL_SILENCE_SECONDS = 25.0`, `TOTAL_BUDGET_SECONDS =
90.0`; the tests patch them down to tens of milliseconds):
1. `test_silent_gap_after_partial_output_stops_without_concatenated_fallback` — failed 1/8 alone
   today (`attempts == ['moonshotai/kimi-k3', 'deepseek-ai/deepseek-v4-pro-0813']`). The patched
   `MODEL_SILENCE_SECONDS = 0.03` is ALSO the first-output allowance (`first_deadline`, set before the
   request — assistant_chat.py ~656); under load the `partial` chunk arrives after 30 ms, the code
   sees "no first output" and falls back — the other branch. Direction: a window large relative to
   jitter (≥ 0.5 s; the test then waits one window for the silence).
2. `test_total_budget_includes_context_loading` — asserts `cancelled.is_set()` after a 0.03 s total
   budget; failed even alone on this box earlier today. Hypothesis to confirm (add a `started`
   event): the budget can expire BEFORE `build_context` is entered — during `SESSION_FACTORY()` /
   `resolve_api_key(db)` — so the "time budget" error is right but `slow_context` never ran, so it was
   never cancelled. Make the budget cover context loading deterministically (e.g. a budget ≥ 0.5 s,
   the connection pool warmed first, and assert `started` too, so a slow box fails with an honest
   message rather than a misleading one). ALSO check whether reaching `build_context` depends on
   this box's real `NVIDIA_API_KEY` in `backend/.env` (`resolve_api_key` must return a key for the
   stream to get that far; CI has no .env) — if so, make the test provide what it needs explicitly.
3. The file's other timing tests — `test_silence_bound_covers_headers_and_reasoning_and_skips_same_rung`
   (0.04 s) and `test_transient_retry_keeps_the_same_first_output_allowance` (0.13 s vs sleeps
   0.09 / 0.08 — 40 ms margins): scale the ones whose margins are within jitter, keeping every
   inequality (e.g. sleep1 < allowance < sleep1 + sleep2).

Frontend (all failed at least once today under load, all pass alone):
4. `src/components/settings/CategoriesCard.test.tsx` › `retires and restores without touching the
   other columns` — failed twice; only the first call `(5, { is_active: false })` arrived. Likely the
   second click (`Restore Pets`) lands while the first mutation's `busy` still disables the row
   buttons: wait until the button is enabled (or the first mutation settled) before clicking.
5. `src/components/portfolio/TransactionsPanel.test.tsx` › `TransactionsPanel entry session` › `a
   successful edit still resets the whole form — carry-forward is create-only` — diagnosed in
   `docs/superpowers/plans/2026-09-23-reorder-r6-consolidate.md:368`: it clicks Edit as soon as
   `onChanged` fired, and `busy` (which disables Edit) clears one microtask later → wait for Edit to
   be enabled.
6. `src/pages/EsppPage.test.tsx` › `EsppPage — offerings` › `edits an offering through PATCH and
   deletes one after a confirm` (failed once at 1,316 ms).
7. `src/pages/SettingsPage.test.tsx` › `SettingsPage — loading states (2026-09-13 spec §9)` › `warms
   a task’s data on tab hover or focus, once, so the click finds it already loaded` (failed once at
   68 ms).
Leave the three fixed on main in 3a39ce9e (PaycheckPage waterfall, OverviewPage snapshot charts,
ProjectionPage retirement marks). Don't rewrite passing tests speculatively.

### Task 5 — Docs and the final measurements

- [ ] README: a short `## Development — running the tests` section just before `## Troubleshooting`:
  backend `cd backend && pytest -q` (serial, measured minutes), `pytest -q -n 4` for a lone full run
  (measured), `FINANCE_TEST_DB=<name>_test_<suffix>` per concurrent runner and the `_gw<N>`
  databases that `-n` creates, frontend `npm test`. Short, measured numbers only.
- [ ] conftest comments: update the "torn down aggressively (drop_all + TRUNCATE between tests)"
  note to the new reset.
- [ ] Final gates (servers stopped; nothing heavy beside it; note the load):
  - full serial backend suite ×2 on `finance_test_speed` — pass/skip counts = baseline (2,327 / 4)
    + your new tests; wall times;
  - `-n 4` ×3 (if Task 3 landed);
  - `ruff check .` and `ruff format --check .` in `backend/`;
  - full `npx vitest run` ×2, at least one while a backend suite runs beside it; `npx tsc -b`;
    `npx eslint` on the touched frontend test files (0 errors).
- [ ] Execution record (below): before/after table, flake root causes, anything you chose not to do
  and why; drop `finance_test_speed*` (and `_gw*`) databases you created; commit
  `docs(plan): test speed-up — execution record`.

### Out of scope
Production code (unless Task 4 proves a defect — report first); the CI workflow; frontend suite
speed; any other database.

---

## Execution record

(implementer fills this in)
