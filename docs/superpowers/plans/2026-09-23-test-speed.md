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

- [x] **Step 1: failing tests** in `backend/tests/test_conftest_reset.py` (they call the helper
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
- [x] **Step 2:** implement `reset_database` + wire the `db` fixture teardown to it; run the new
  tests, then a broad slice (e.g. `tests/test_read_cache.py tests/test_reorder_serialization.py
  tests/test_month_review_api.py tests/test_auth.py`) green.
- [x] **Step 3: measure** the teardown the way it was measured before (create_all once, then time
  20× `async with engine.begin(): exec_driver_sql(<stmt>)` on a DB with a few rows inserted each
  time): old TRUNCATE vs new DO block. Target ≤ 20 ms median. Record both.
- [x] **Step 4: commit** — `test(conftest): reset the test database by deleting rows and restarting
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
- [x] implement, run `tests/test_security.py tests/test_seed.py tests/test_auth.py` green, measure
  one `auth_client` test's setup before/after, commit — `test(conftest): bcrypt at its minimum cost
  while tests run (hash + login ~410 ms → ~<n> ms per logged-in test); production keeps the default`.

### Task 3 — Opt-in parallel runs (pytest-xdist), one database per worker

**Files:** `backend/requirements-dev.txt`, `backend/tests/conftest.py`.
- [x] `pip index versions pytest-xdist` (or the release notes) → pin the newest release that
  supports pytest 9.1.1 in `requirements-dev.txt`; install it into the shared venv:
  `/c/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe -m pip install
  pytest-xdist==<ver>`. **If pip cannot reach the index from this box, skip Task 3, say so in the
  record, and go on** (don't vendor wheels, don't change pip config).
- [x] conftest: `worker = os.environ.get("PYTEST_XDIST_WORKER")` → database `f"{base}_{worker}"`
  when set (e.g. `finance_test_speed_gw0`), else `base` exactly as today. Keep the guard regex and
  make sure it still accepts both forms. Each worker bootstraps its own database
  (`_ensure_test_database`) and runs drop_all/create_all once (the session `engine` fixture).
- [x] Default stays SERIAL: no `-n` in `addopts` (lanes often run several suites at once on this box,
  and CI's `pytest -v` in `.github/workflows/ci.yml` stays as it is).
- [x] Look for anything not parallel-safe: fixed ports, files written outside `tmp_path`, tests that
  shell out with the configured database (`test_ops_scripts.py`, `test_lifecycle_cli.py`), state
  shared across processes. Fix only real conflicts.
- [x] Run `-n 4` three times: all green, identical pass counts to serial. Record wall times.
- [x] Commit — `test(conftest): opt-in parallel runs — pytest-xdist with one database per worker
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

- [x] README: a short `## Development — running the tests` section just before `## Troubleshooting`:
  backend `cd backend && pytest -q` (serial, measured minutes), `pytest -q -n 4` for a lone full run
  (measured), `FINANCE_TEST_DB=<name>_test_<suffix>` per concurrent runner and the `_gw<N>`
  databases that `-n` creates, frontend `npm test`. Short, measured numbers only.
- [x] conftest comments: update the "torn down aggressively (drop_all + TRUNCATE between tests)"
  note to the new reset.
- [x] Final gates (servers stopped; nothing heavy beside it; note the load):
  - full serial backend suite ×2 on `finance_test_speed` — pass/skip counts = baseline (2,327 / 4)
    + your new tests; wall times;
  - `-n 4` ×3 (if Task 3 landed);
  - `ruff check .` and `ruff format --check .` in `backend/`;
  - full `npx vitest run` ×2, at least one while a backend suite runs beside it; `npx tsc -b`;
    `npx eslint` on the touched frontend test files (0 errors).
- [x] Execution record (below): before/after table, flake root causes, anything you chose not to do
  and why; drop `finance_test_speed*` (and `_gw*`) databases you created; commit
  `docs(plan): test speed-up — execution record`.

### Out of scope
Production code (unless Task 4 proves a defect — report first); the CI workflow; frontend suite
speed; any other database.

---

## Execution record

Executed 2026-09-23 on branch `chore/test-speed` (from main @b33c202b). Docker Desktop was not
running at the start; it was started and the stopped `finance-dashboard-db-1` container brought up
(`docker start`, nothing else touched). Timings were taken on a quiet box (CPU ~15 %, no dev servers,
no other python/node) unless marked "under load". Test infrastructure and test files only:
`git diff b33c202b..HEAD` touches no file in `backend/app/**` and no non-test file in `src/**`.

### Commits

| Commit | What |
|---|---|
| ff5cdbc7 | Task 1 — `reset_database`: one DO block (child-first DELETEs + setval), TRUNCATE kept as the fallback; `test_conftest_reset.py` |
| ecb3457b | Task 2 — bcrypt capped at rounds=4 for the session; `test_security.py` pins cost 12 with the real gensalt and cost 4 under the cap |
| 93a91f59 | Task 1 fix — reset EVERY sequence, not only those pg_sequences reports as read (a snapshot restore parks them at max(id)+1 with is_called false) |
| 0a73fe18 | Task 3 — opt-in pytest-xdist 3.8.0, one database per worker |
| 777de768 | Task 4 items 1 + 3 — the silence windows (0.5 / 0.6 s) |
| 38d392da | Task 4 item 2 — the time-budget test |
| e7c6c6e2 | Task 4 item 6 — EsppPage offerings |
| 057faa45 | Task 4 item 7 — SettingsPage tab-hover warm |
| 13bad831 | Task 4, found under load — RestoreCard focus |
| a6fdb044 | Task 4, found under load — PortfolioPage household ledgers |
| 2dc61c57 | Extra — the test engines dial 127.0.0.1 for a `localhost` DATABASE_URL (~2 s per new connection on Windows) |
| (this) | Task 5 — README section + this record |

### Before / after

| Measure | Before | After |
|---|---|---|
| `db` teardown statement, 20 resets each after a few inserts (scratch harness, statements run in separate blocks) | TRUNCATE median 433–489 ms (min 402, max 1,224–1,997) | DO block median 5.0–6.7 ms (min 4.6, max 8.6) |
| `db` teardown as pytest reports it (`test_auth.py`) | 0.41–0.51 s typical, up to 1.98 s | 0.00–0.03 s |
| bcrypt hash + verify (micro-benchmark) | 190 + 191 ms (cost 12) | 0.8 + 0.8 ms (cost 4) |
| `auth_client` test setup (seeded_user hash + login) | 0.39–0.41 s | 0.01 s |
| First test's setup (bootstrap connection + engine connection + drop_all/create_all) | 5.05–6.42 s | 0.95–1.06 s |
| Full serial suite | 1,334.77 s, 2,327 passed / 4 skipped (the plan's baseline) | **137.39 s and 143.60 s (147 s wall)**, 2,332 passed / 4 skipped |
| Full suite, `-n 4` | — | **58.12 / 59.90 / 59.62 s (60 / 63 / 62 s wall)**, 2,332 passed / 4 skipped each |
| `test_auth.py` alone | 23.84 s | 3.42–4.48 s (incl. the one-time setup) |

Intermediate points: after Tasks 1–2 alone, serial 155.75 s and `-n 4` 71.23 s. The `localhost`
commit took off the rest: a temporary counting plugin over a full serial run found 5 pooled
connections costing 10.3 s, one asyncpg cancel request 2.0 s, plus the uncounted bootstrap
connection (~2 s). The +5 tests over the baseline are the three in `test_conftest_reset.py` and the
two in `test_security.py`. Frontend baseline before any change: 3,899 passed in 153.45 s.

### Task 1 — what was checked and found

- **FK cycle?** `Base.metadata.sorted_tables` emits no warning: 44 tables, 32 FKs. The only
  cycle-like edge is the self-reference `accounts.parent_account_id` (ON DELETE SET NULL), which a
  single `DELETE FROM accounts` satisfies (covered by the new test's parent/component rows).
- **Why ~5 ms and not the ~17 ms first measured:** alternating TRUNCATE and the DO block in one
  harness measured the DO block at ~17 ms, because each TRUNCATE swaps relfilenodes and invalidates
  the relcache, so the next DELETEs rebuild their relation and trigger entries. The suite only ever
  runs one of the two, so the numbers above come from separate blocks. Parts, each timed as its own
  transaction (so each includes the ~1.8 ms that a bare `SELECT 1` transaction costs): the 44
  DELETEs ~4.3 ms, the sequence loop ~3.8 ms, together ~5 ms.
  `SET LOCAL synchronous_commit = off` would save a further ~1.2 ms per test (~3 s a run); not
  adopted, as marginal.
- **A bug in the plan's SQL, caught by the new test on the first full serial run** (fixed in
  93a91f59): `WHERE last_value IS NOT NULL` skips any sequence in the `setval(…, n, false)` state,
  because pg_sequences reports last_value NULL whenever is_called is false. `lifecycle/restore.py`
  step 5 leaves every exported table's sequence exactly there (max(id)+1, false). After
  `test_assistant_evidence`'s snapshot round trip, `assistant_findings_id_seq` and
  `allocation_target_sets_id_seq` sat at (2, false), and the next test's first row would have been
  id 2, depending on test order (and xdist changes the order). The block now setval()s every
  sequence in the schema. That costs the same (median 5.1 vs 4.9 ms; a read-then-reset variant:
  5.4 ms). The test now parks a sequence exactly as a restore does before each reset.
- Mutation checks: each reset test was run against a broken reset (sequences not restarted, a table
  skipped, a no-op fallback, the old `last_value` filter). Every one was caught. **The review found
  two that were not:** a fast path that always fails (the TRUNCATE fallback left the same state
  behind) and a parent-first DELETE order. Both are caught since 6571d914; see "Review fixes".

### Task 3 — parallel-safety audit

pytest-xdist 3.8.0 is the newest release. It resolves against pytest 9.1.1 and adds only execnet
2.1.2. It is pinned in `requirements-dev.txt` and installed in the shared venv, where it stays inert
without `-n`; CI's `pip install -r requirements-dev.txt` will install it too, with no effect on its
serial `pytest -v`. Nothing needed fixing:
- no test binds a port;
- every file a test writes lives under `tmp_path` or the per-test `data_dir`, and xdist gives each
  worker its own basetemp;
- `test_ops_scripts.py` shells out to bash on `tmp_path` copies and never touches a database;
- `test_lifecycle_cli.py` points the CLI's `SessionLocal` at the worker's engine;
- limiter, read caches and assistant module state are per process.

The backend `-n 4` suite also ran green **33 of 33 times under heavy load** during Task 4 (beside
looping full vitest runs), in 80–170 s. One more run hung: it shared its databases with another
suite (see the orchestration incident below).

### Task 4 — flake root causes, evidence, fixes

Two findings shaped the backend items. First, **on this box Python 3.12 reads `time.monotonic`
(the asyncio clock) from GetTickCount64, which has 15.625 ms resolution**. Second, asyncio's
`_run_once` treats any timer due within one clock resolution as ready. Measured: a nominal
`asyncio.wait_for(…, 0.03)` took 31–48 ms of real time on an idle loop but **0.8–11.9 ms (median
6.8)** on a busy one, and a streaming conversation always keeps the loop busy. So the tests' 30–40 ms
windows were one to three clock ticks, and could close within a few real milliseconds.

The reproduction method was fault injection plus real load. A temporary pytest plugin blocked the
event loop 50 or 150 ms inside every mock provider request, which is what a descheduled process looks
like to these tests. The real load was a looping full `npx vitest run` beside a looping backend
`-n 4` suite, sometimes with a third serial job.

1. **`test_silent_gap_after_partial_output_stops_without_concatenated_fallback`**
   - Race: `MODEL_SILENCE_SECONDS` is also each rung's first-output allowance, armed before the
     request. When `partial` arrived after that allowance, the rung read as silent and failed over.
   - Evidence: a 50 ms stall reproduces the reported failure exactly (`attempts ==
     ['moonshotai/kimi-k3', 'deepseek-ai/deepseek-v4-pro-0813']`).
   - Fix: a shared `SILENCE = 0.5` s (~32 ticks).
2. **`test_total_budget_includes_context_loading`**
   - Hypothesis confirmed with a `started` event and connection tracing. The budget expired inside
     `resolve_api_key`'s app_settings read, before `build_context`. On a cold process that read is
     the run's first ORM query (16–31 ms of mapper configuration and compilation), so the test failed
     5/5 alone and 10/10 in replays.
   - The cancelled query also sent asyncpg's cancel request to `localhost`, which is why each failure
     took ~2.05 s; that led to the 2dc61c57 finding.
   - Key: reaching `build_context` does **not** depend on this box's `NVIDIA_API_KEY`. The file's
     `wire` fixture sets `settings.nvidia_api_key = "nvapi-test"`, the test DB has no override row,
     and the worktree has no `.env`. The fixed test now asserts `("nvapi-test", "env")` explicitly.
   - Fix: warm that read first, a 0.5 s budget, `assert started.is_set()` with an honest message,
     and `cancelled` set only on `CancelledError` (the old `finally` also fired on normal completion).
3. **`test_silence_bound_covers_headers_and_reasoning_and_skips_same_rung[False/True]`**
   - Race: the fallback's first frame had to land within 0.04 s. Under a 50 ms stall there is no
     "fallback" token.
   - Fix: `SILENCE`.
   **`test_transient_retry_keeps_the_same_first_output_allowance`**
   - Race: the 503 after 0.09 s had a 0.04 s margin to the 0.13 s allowance. Under a 50 ms stall
     `primary_attempts == 1`.
   - Fix: first 0.1 < allowance 0.6 < first + second 1.0 (gaps 0.5 / 0.4 s), asserted in the test.
     The first version of this guard (`first + 0.3 < allowance < first + second - 0.3` with second
     0.8) held only through float rounding (`0.1 + 0.8 - 0.3 == 0.6000000000000001`). It was replaced
     before commit.
   - **Superseded in review (b7cc7439):** these values dropped `second < allowance`, so the test
     could no longer catch its own regression (a fresh allowance per retry attempt). Now 0.4 / 0.8 /
     0.6; see "Review fixes" below.

   Backend results:
   - Original file under real load: **failed 7 of 20 runs** (silent-gap ×3, budget ×4).
   - Fixed file under the same load: **30/30 green** (20/20 in the paired comparison, then 10/10 on
     the final file).
   - Fixed budget test alone and cold: 13/13.
   - All four timing tests pass under 0, 50 and 150 ms stalls.
   - Cost: those tests now take ~0.5–0.6 s each (about +2.5 s a run).

Frontend. All four listed tests plus the two found under load share one mechanism. A test awaits a
DOM change produced by a render **outside act()** (a promise resolving while `waitFor` or `findBy*`
polls), then asserts on something that render's passive effect does (a fetch, a focus move, a busy
flag cleared). React commits the DOM in one scheduler task and runs passive effects in a later one.
If RTL's post-waitFor drain (a `setTimeout`) runs first, the synchronous assertion sees the old
state.

Proof method: a temporary copy of each test file with React's scheduler delayed 20 ms. The scheduler
captures `setImmediate` when it loads; a `vi.hoisted` block in the copy replaced it. With the delay:
- the original test fails every time with the reported signature;
- the fixed test passes at 0, 20, 50 and 100 ms.

4. **CategoriesCard › retires and restores without touching the other columns**
   - **Already fixed on main** by 15332f45 (09:52 today: wait for `Restore Pets` to be enabled). The
     plan's two failures predate it.
   - Passes under the 20 ms delay and **20/20 under load**. Unchanged.
5. **TransactionsPanel › a successful edit still resets the whole form**
   - **Already fixed on main** by 310e0277 (11:42 today: `await enabledButton('Edit')`).
   - Passes under the delay and **20/20 under load**. Unchanged.
6. **EsppPage › edits an offering through PATCH and deletes one after a confirm**
   - Race: `busy` clears in the PATCH chain's `.finally`, a render after `updateOffering` was called
     (synchronously, in the click). Both Delete clicks could hit `disabled={busy}`, so the
     declined-confirm half passed vacuously and `waitFor(deleteOffering)` timed out.
   - Evidence: with the delay it fails in 1,466 ms; the plan saw 1,316 ms.
   - Fix: wait for Delete to be enabled, and assert the confirm was asked (`confirmSpy` called once).
     The file's other two confirm tests have no write in flight and were left alone.
7. **SettingsPage › warms a task's data on tab hover or focus**
   - Race: `#accounts` commits a task before the Household cards' mount effects call
     `fetchHousehold`.
   - Evidence: with the delay it fails in ~130 ms at `expect(fetchHousehold).toHaveBeenCalledTimes(1)`;
     the plan saw 68 ms.
   - Fix: `await waitFor` that count, and only then assert profiles and limits were not fetched (read
     earlier, they held vacuously).
8. **RestoreCard › leaves focus on the report after a restore is applied** (not listed; failed under
   real load in this batch)
   - Race: focus moves in a `useEffect` keyed on the report, so `findByText('Restored.')` can resolve
     first.
   - Fix: the same assertion inside `waitFor`.
9. **PortfolioPage › fetches them once on a cold person view** (not listed; failed twice under real
   load: census round 5 of 10, and once alone beside the load)
   - Race: by design the household fetch is a `useEffect` of the render that already drew the
     ex-dividend markers from the person's own ledgers.
   - Fix: `await waitFor(() => expect(householdCalls()).toHaveLength(1))`, the sibling test's
     pattern. Call order unchanged.

Frontend verification under load: the six files (281 tests) passed **20/20 rounds**. There were 23
full vitest runs under load in three phases:
- the first, before any frontend fix, failed 5 of 7, but only the last of those logs survived
  (RestoreCard);
- the second, with fixes landing midway, failed 1 of 11 (PortfolioPage, round 5, before its fix);
- the third, with every fix in, was 5 of 5 green.

The final gate's run beside a backend suite was green too.

No production defect was found. Every race is the test reading state one scheduler step early, or a
timing window too narrow for this box's clock.

### Chosen not to do (and why)

- **SettingsPage's two loading-state ghost tests** also fail under the 20 ms delay. This is an
  artifact of the injection: they resolve their deferred inside `await act(async …)`, and React's
  async act yields through a real `setImmediate` (the `timers` module), so in a real run the
  scheduler's earlier task runs first. The injection breaks that FIFO ordering. They never failed
  under real load. Unchanged.
- **Global scheduler-delay sweep** (all 267 files): 47 failures in 9 files, dominated by fake-timer
  suites (InputsForm 31, prefsStore 8), where the injected `setTimeout` is itself faked. That is
  noise, not evidence. Nothing changed from it.
- **Other small windows** in `test_assistant_chat_api.py` (`sleep(0.12)` vs keepalive 0.03 at ~461;
  `WAIT_STATUS_SECONDS` 0.05 vs `sleep(0.2)` at ~1058) and short sleeps in `test_read_cache.py` sit
  on the same 15.6 ms clock. None failed in any run here (33 backend `-n 4` runs under load, plus
  serial runs). Not rewritten speculatively; candidates if they ever flake.
- **The dev server's own database URL.** The main checkout's `backend/.env` sets no `DATABASE_URL`,
  so uvicorn uses the config default `localhost:5433` and pays the same ~2 s per new pooled
  connection. The README's Troubleshooting entry already says to use 127.0.0.1; untouched (not test
  infrastructure).

### Incident in my own orchestration (no code impact)

While switching load loops I deleted a stop file the previous loop still polled. Its backend `-n 4`
suite then ran concurrently with the next loop's suite on the same `finance_test_speed2_gw*`
databases, exactly the case the conftest header warns about. One worker hung idle for ~37 minutes
until I killed that process tree. The other loop's runs all passed. It was not a suite defect, and
the README's new section now says two runs on one database "can hang".

### Final gates (tree = 2dc61c57 + this record's docs)

- Backend serial ×2 on `finance_test_speed`: **2,332 passed / 4 skipped in 137.39 s** and **2,332
  passed / 4 skipped in 143.60 s (147 s wall)**. Quiet box.
- Backend `-n 4` ×3: **2,332 / 4 each, 58.12 s (60 s wall), 59.90 s (63 s wall), 59.62 s (62 s
  wall)**.
- `ruff check .` → all checks passed; `ruff format --check .` → 339 files already formatted.
- `npx vitest run` ×2:
  - quiet: **267 files, 3,899 passed, 148.25 s (152 s wall)**;
  - beside a full serial backend suite on `finance_test_speed2`: **3,899 passed, 157.61 s (161 s
    wall)**. That backend suite also passed, 2,332 / 4 in 213.52 s.
- `npx tsc -b` → exit 0. `npx eslint` on the four touched frontend test files → 0 problems.
- Databases created by this batch and dropped at the end: `finance_test_speed`,
  `finance_test_speed_gw0`–`gw3`, `finance_test_speed2`, `finance_test_speed2_gw0`–`gw3`. No other
  database was touched. The temporary diagnostics (plugins, injected copies, configs) never entered
  the tree.

### Review fixes (2026-09-23 evening)

The code review found one critical, one important and eight minor issues, plus a README gap. All
are fixed on this branch, one commit each, every behavioural fix proven with a mutation or a
before/after.

| Commit | Review item |
|---|---|
| b7cc7439 | critical 1: retry test values 0.4 / 0.8 / 0.6; the guard asserts `max(first, second) < allowance < first + second` |
| 040c96b9 | critical 1 follow-up: the silence-bound test also asserts no "Retrying" status |
| 6571d914 | important 2a/2b: the reset tests assert the fast path did it; a RESTRICT-only child (paycheck profile) pins child-first order |
| 6e20a6e3 | important 2c: a teardown reset that falls back to TRUNCATE fails that test |
| ce1cdce0 | minor 4: TRUNCATE before the warning; the warning shows the driver's one-line error |
| bd6b3a77 | minor 3: `lock_timeout` 30 s on both reset paths |
| 1b3f4336 | minor 10: `synchronous_commit` off in the reset transaction |
| 8dc689f5 | minors 6 and 9: docstring on how the reset behaves unlike TRUNCATE; "every" sequence, not "~40" |
| 1324efbe | minor 8: the reset statements are built by the `engine` fixture after create_all |
| 34488260 | minor 5: the localhost → 127.0.0.1 rewrite only on Windows |
| 296f90eb | minor 7: the visibility test checks from a second engine |
| 3806065e | README: `-n` needs requirements-dev.txt |
| (this) | this section |

**Critical 1 — my mistake.** Widening the retry test's windows (777de768), I kept
`first < allowance < first + second` but dropped `second < allowance`. Without that inequality a
fresh allowance per attempt (the regression the test exists for) also ends in "fallback", so the
test could not tell the two apart.

The reviewer's harness (`_bounded_output` ignoring `first_deadline`) kills that mutant with the
original 0.09 / 0.13 / 0.08 and with 0.4 / 0.8 / 0.6, and not with my 0.1 / 0.6 / 0.9. Under the
same mutant:
- the committed test (via a monkeypatching plugin) and the original file's test both kill it;
- the reviewer's stall harness, 0, 50 and 150 ms stalls, 3 reps: the real code passes and the
  mutant dies every time (18/18);
- the committed test passes with every mock request stalled 0, 50 or 150 ms.

**Re-check of every timing test I changed** (the plugin breaks one guarded behaviour of
`assistant_chat` at a time by monkeypatching, never by editing it):

| Mutant | Guarding test | Original file (b33c202b) | Now |
|---|---|---|---|
| first-output allowance re-armed per attempt | transient_retry | killed | killed (survived at d84097d5) |
| reasoning frames re-arm the silence bound | silence_bound[True] | **survived** | killed |
| nothing bounded before the model's first frame (the header wait) | silence_bound[False] | killed | killed |
| a silent rung retried like a transient failure | silence_bound[both] | **survived** (killed 1 run in 4, by chance) | killed (040c96b9) |
| the "partial answer forwarded" flag lost (a concatenated answer) | silent_gap | killed | killed |
| the budget no longer cancels the context build | total_budget | — (the original failed anyway, cold) | killed |

- **Reasoning re-arm:** under this mutant the original test *passed*. My inference, not measured:
  on the 15.6 ms loop clock the 0.04 s window is quantized and can fire a tick early, leaving it
  about as long as the gap between 5 ms reasoning frames (one event-loop poll each, ~5–16 ms). The
  mutant therefore still went silent at times and failed over like the real code. At 0.5 s the
  frames always keep it alive, and the test sees the difference. (040c96b9's message says the
  frames arrive "~16-31 ms apart"; ~5–16 ms is the better estimate.)
- **Same-rung retry:** once a rung is silent its first-output allowance is spent, so a same-rung
  retry usually went silent again before sending a request, and `attempts.count(kimi) == 1` still
  held. A retry always emits "Retrying <model>…" first, and the test now asserts there is none.

**Important 2.**
- With the reviewer's plugin, a fast path that always fails used to give 3 passed; it now fails
  both fast-path tests. The parent-first order also gave 3 passed; it now fails both, on
  `fk_paycheck_profiles_person_id_people`.
- (c) is a per-teardown error, not a session-end count:
  - it lands on the test whose data the fast path could not delete;
  - it reaches the xdist controller like any report, whereas a worker's session exit status does
    not;
  - tests that call `reset_database` themselves are unaffected.
- (c) proof (`test_auth`, `test_conftest_reset`, `test_projection_api`):
  - always failing: 60 teardown errors plus the 2 test failures, serially and with `-n 4`;
  - parent-first: exactly the 16 tests that leave a paycheck profile behind error;
  - unmutated: 70 passed.
- The reviewer's plugin, as written, stopped working after minor 8 (the `engine` fixture now
  overwrites a statement set before it runs). An adapted copy that requests `engine` gets the
  failures above.

**Minors.**
- **3 (lock timeout):** a second connection held `SELECT … FOR UPDATE` while the reset ran, with
  the timeout set to 1 s for speed. Before, it was still blocked at a 20 s watchdog; after,
  `LockNotAvailableError` in 2.0 s (1 s per path).
- **4 (TRUNCATE first):** fast path forced to fail, `-W error::UserWarning`, `test_auth.py`. The
  old order gave 13 setup errors (duplicate key from skipped cleanups) and only 4 passes; the new
  order gives 0 setup errors and all 17 bodies pass.
- **5 (Windows only):** the conftest body evaluated per platform gives win32 → `127.0.0.1`, linux
  and darwin → `localhost`.
- **6 (docstring):** the leaked-transaction claim was checked. The fast reset finished in 38 ms
  beside an open transaction holding an uncommitted insert and a reader, and that row was still
  there after its transaction committed.
- **7 (second engine):** server PIDs: seed and reset ran on 52402, the old re-check used 52402
  again, the new engine is 52490.
- **9 (sequence count):** there are 36 sequences today (44 tables); the docstring says "every".
- **10 (synchronous_commit):** every reset timed over a full `-n 4` run, back to back:
  - before: median 7.7–8.1 ms, p99 61–125 ms, max 0.19–1.19 s, three over 0.5 s;
  - after: median 6.0–6.2 ms, p99 13–29 ms, max 36–52 ms, none over 0.5 s (the reviewer measured
    46 ms);
  - wall time 57.4 vs 57.6 s.

**Environment tonight.**
- An orphaned `find / -maxdepth 6 … -name batch2-research …` from another session (started 20:31,
  1,393 CPU-s) saturated the disk for about an hour. It ended before the final runs, but
  intermittent disk spikes (up to ~900 % busy, not attributable to any one process) continued. The
  final times are therefore slower than this afternoon's.
- A back-to-back A/B (serial, each on its own database) separates the environment from the
  changes: the pre-review tree `d84097d5` took **197.18 s**, the current tree **180.04 s**.
- The A/B's single failure is an artifact: my backend-only `git archive` copy lacks the
  `src/components/navItems.ts` that `test_nav_paths_pin_the_frontend_registry` reads.
- One `always_fail` mutation run (scratch only) ended with a faulthandler-style stack line instead
  of a summary. It did not reproduce in three identical re-runs, which all ended normally. It is
  unexplained, and it was never seen in a real suite run.

**Final runs (tree = 3806065e + this section):**
- The changed test files (`test_conftest_reset`, `test_assistant_evidence`, `test_security`): 36
  passed in 12.07 s.
- Full serial: **2,332 passed / 4 skipped in 185.54 s (189 s wall)**, and **168.13 s (172 s
  wall)**. No fallback warnings.
- Full `-n 4`: **2,332 passed / 4 skipped in 66.80 s (71 s wall)**. No fallback warnings.
- `ruff check .` and `ruff format --check .`: clean, run after the temporary harness files were
  removed.
- Dropped at the end: `finance_test_speed`, `finance_test_speed_gw0`–`gw3` and
  `finance_test_speed2`.
