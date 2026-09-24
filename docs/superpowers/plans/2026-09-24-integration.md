# Batch 2 integration (2026-09-24): record

Branch `chore/batch2-integration` from local `main` @84e83138, which has K, W, R and M merged. Lane T is still
working in its own worktree and was not touched. There is no plan for this lane: four controller tasks, each done
test-first with its own commit. Production behaviour is unchanged except where a task says otherwise (tasks 3 and 4).

## Task 1: the flaky Stop test (`test_assistant_evidence.py::test_stop_cancels_provider_and_closes_stream`)

**Root cause.** The test's 2 s `wait_for` had to cover the whole start of the stream, not only the part under test.
Inside it ran the first ORM read (the key lookup) and the full context build for `CTX`'s route `/spending`. That
build is `_household` (the net-worth summary, portfolio holdings, spending matrix and tax summaries) plus the
spending builder. On a quiet box it takes 100-250 ms. Under CPU load it takes 0.7-6 s, so the "thinking" frame
sometimes could not arrive in time. The test is about Stop closing the provider's stream, and the context build has
nothing to do with that. This is not a production defect: the build comes before the model call by design, the
"Reading the page's data…" status frame covers it, and production's keepalive interval is 15 s.

**How it was proved.** A scratch pytest plugin (`$SP/batch2/int/probe/`, not in the repo) timed each phase and
logged every `asyncpg.connect` and `socket.getaddrinfo`.

| Run | Result | Key read | Context build | First "thinking" |
|---|---|---|---|---|
| Alone, quiet box, 20 runs | 20/20 pass | 24-50 ms | 99-178 ms | 130-250 ms |
| Alone, 16 CPU burners on 12 logical CPUs, 9 runs | **2/9 fail** (lane M's rate) | 387-413 ms | **1,892-2,120 ms** | never, within 2 s |

- **The localhost hypothesis is refuted.** Every connect in every run (alone or in-file, quiet or loaded) went to
  `127.0.0.1`: 2-3 per process, all in the `engine` fixture, before the wait began. No DNS lookup happened inside
  the wait. The tests that use the app's own session factories patch them (`assistant_chat.SESSION_FACTORY`, the
  lifecycle CLI's `SessionLocal`).
- **The 15.6 ms loop clock and the keepalive interval are not the cause.** `interval=0.01` is shorter than the
  15.625 ms tick, so asyncio treats the timer as already due and the keepalive spins: about 247 pings in about
  150 ms. But an A/B in one warm process under the same load showed no systematic effect. The context build alone
  took a median of 708 / 849 ms; with the spin running, 714 / 940 ms.
- **The same A/B isolates the cause** (2 × 15 interleaved rounds). The current path reached "thinking" in a median
  of 778 / 870 ms, worst 2.9 / 3.8 s. With the context stubbed and the key read warmed, it took 51 / 59 ms median,
  169 / 214 ms worst.
- **Deterministic red.** A scratch plugin that adds 2.5 s to the real context build makes the old test fail with the
  same `TimeoutError` every time. The fixed test passes with the same plugin loaded.

**The fix (test only).** The test stubs `build_context`, which has its own tests. It also warms the app_settings
key read first, the precedent set by `test_total_budget_includes_context_loading` beside it. The 2 s wait is
unchanged. The ping path it used to exercise incidentally is covered by
`test_keepalive_pings_while_the_source_is_slow`.

**Verification.** It ran from an exported copy of commit 6eef8d0e, so later edits could not leak in, under sustained
load: 14 CPU burners plus three concurrent pytest loops, 07:44-08:10.

- **30/30** isolated runs passed.
- **10/10** whole-file runs passed (20 tests each).
- Ten instrumented cold runs under that load reached "thinking" in **50-268 ms**, median about 100 ms. None opened a
  connection or did a DNS lookup inside the wait.

## Task 2: one employer-ticker reader

`app/services/employer_ticker.py::read_employer_ticker` is now the only read of `app_settings['espp_ticker']`. The
brief named three copies of the rule; there was a fourth, in `price_service.backfill_employer_history`, and it is
included here. The callers:

- `api/espp._espp_quote`'s first hop;
- the Settings GET (`_read_espp_ticker` is removed);
- the withholding and projection caches' bound ticker (`read_cache._employer_ticker` and its stale "the two are one
  rule" docstring are removed, and the two docstrings that named it now name the one reader);
- the employer history backfill.

The rule is unchanged: an absent row, an unexpected shape or a blank value means no ticker, and "nvda" becomes
"NVDA".

**Proof of byte-identity.** `tests/test_employer_ticker.py` pins each reader on the nine stored shapes against the
ticker it must resolve:

- the reader itself;
- `_espp_quote`'s whole tuple;
- the Settings GET's JSON;
- both caches' key ticker;
- the backfill's provider calls.

These 18 cases were run first against the old copies (a throwaway test file bound the old `_employer_ticker`) and
passed. A source fence, `test_one_module_reads_the_employer_ticker_setting`, allows one direct read in `app/`; on the
old code it listed all four copies. The existing nine-shape test in `test_projection_cache.py` now compares the
shared reader with `_espp_quote`. No fingerprint statement changed in this commit.

## Task 3: the compare table's Horizon row (lane R follow-up)

`projectionValue(result, 'years')` now returns the knob, `base_years ?? years`, which is what the footer and the
Horizon box mean. When the run was lengthened, it says so beside the knob: `30 (runs through 2075)`. The wording is
"runs through" rather than the brief's "runs to" because a lengthened run reaches the end of the plan-until year,
and its axis can end months after it: Sep 2076 for 2075. That matches the backend's own warning ("lengthened … to
reach the end of 2075") and the table's "Money lasts through plan-until year" row. If a lengthened run arrives
without a plan-until year (no server sends that), the row reads `30 (runs 50)`.

**Tests.**
- Five unit cases: the knob, a lengthened run, an unlengthened plan-until year, an older payload, and the defensive
  case.
- A rendered `ScenarioPanel` case: a Settings plan-until 2075 baseline (knob 30, ran 50) against a `years:50`
  scenario. The red run read `50 | 50`; now it reads `30 (runs through 2075) | 50`.

**Browser check on real data.**
- Setup: `finance_realdata_b2`, read-only; backend on port 8049 with `PRODUCT_TODAY=2026-09-24`; vite on 5249.
- Method: pin `years:50`, then open `plan_until:2075`.
- The Horizon row reads **30 | 30 (runs through 2075) | 50** in dark and light at 1600×1000 and 1280×800.
- There were 0 console errors, 0 page errors, 0 blocked writes and 0 failed requests.
- Screenshots: `$SP/batch2/int/shots/compare-{dark,light}-{1600,1280}.png`.
- The two 50-year runs reach FI in different months (Jun 2031 vs Apr 2031), because they drew different paths.
  Before this fix, both cells read "50".

## Task 4: narrowing the withholding memo's `app_settings` and `latest_prices` cells

**Why it is provably complete.**
- **Static trace.** Every database read of the build is an awaited call in `withholding_estimate` or
  `_reconciliation`: `_require_year`, `_engine_feed` twice (this year and last, for the safe harbor), the profiles,
  `_espp_quote`, `_employer_bars`, the grants, `_limits_for`, and the two ESPP lot reads. The pure services
  (`withholding_calc`, `tax_reconciliation`, `rsu_vesting`, `employer_hsa`) await nothing.
- **What that trace finds.** `app_settings` is read at exactly two keys: `espp_ticker` (through the shared reader)
  and `espp_discount_pct` (through `read_espp_discount`, only when a lot was sold this year). `latest_prices` is read
  once: `db.get(LatestPrice, <the employer's security id>)`. `load_portfolio`, the tax router's one full
  `latest_prices` reader, belongs to `what_if`, not to this path.
- **Dynamic capture.** A new row-level capture,
  `test_the_narrowed_cells_cover_every_setting_quote_and_bar_the_get_reads` (named for settings and quotes until
  review item 1 added bars), runs the heaviest path: a joint return with a simulated partner, last year on file and
  a lot sold this year, with a second security quoted and barred and the refresh's bookkeeping keys present. It
  asserts that every read of the three narrowed tables is keyed, and that the sets equal `WITHHOLDING_SETTING_KEYS`,
  `{the employer's id}` and `{the employer's id}`. W's table-level captures are unchanged.

**The change.**
- `WITHHOLDING_SETTING_KEYS = ("espp_ticker", "espp_discount_pct")`.
- The `latest_prices` and `price_history` cells are both restricted to the employer's rows.
- One `_EMPLOYER_ROWS` clause and one `_setting_rows()` helper now serve both caches.
- I dumped the compiled statements before and after. Only the withholding statement's `app_settings` and
  `latest_prices` cells changed; the review-book, month-savings and projection statements are byte-identical.

**Tests.**
- The red test: the refresh's bookkeeping keys (`last_refresh`, `refresh_runs`) plus another holding's quote update
  caused 2 builds. Now there is 1.
- Each row the GET does read still misses: an `espp_ticker` change, an `espp_discount_pct` change, and the
  employer's quote.
- W's purity test (`test_the_reconciliation_writes_nothing`) now fingerprints every row of the twelve tables, not the
  narrowed cells, so the narrowing cannot weaken it.

**What the narrowing actually buys.** A trading day's refresh also moves the employer's own quote and bars, which
the card does read, so the memo still turns over once a day. It now survives the refresh's bookkeeping, other
holdings' quotes, refreshes on days the employer's quote doesn't move, and households with no employer ticker.
`securities` is still fingerprinted in full, so a refresh that rewrites a holding's `annual_dividend` (its TTM
dividends changed) still clears both memos. The GET reads `securities` only by the employer ticker, so that cell
could be narrowed the same way, but it was outside this task's scope.

## Review follow-ups (the integration review's MERGE verdict, 2026-09-24)

Each item has its own commit.

1. **`price_history` in the row-level capture** (db5f23b6). The capture now covers the third narrowed table, with
   another security's bar present. Every `price_history` read is keyed on one security, and the only one read is
   the employer's.
2. **A new employer security and its first quote** (8c2fae04). `test_a_new_employer_security_its_first_quote_and_first_bar_each_miss`
   sets the ticker with no security behind it, then adds the security, its first quote and its first bar, and each
   step rebuilds (2, 3, 4 builds). The step I added is the bar. The behaviour already held, so I checked the test's
   teeth with a mutation: a quote/bar clause that never matches fails it at the quote step (2 builds, not 3). The
   file was restored byte-identical.
3. **Stale wording** (7cd621d3). `test_withholding_cache.py`'s module docstring and the MUTATIONS comment now say
   that three tables are narrowed to the rows the GET reads.
4. **The tautology** (31f39b2e). I deleted `test_projection_cache.py::test_the_bound_ticker_is_the_one_the_build_prices`,
   which compared `read_employer_ticker` with itself (`_espp_quote`'s first hop is that reader), and the two
   imports only it used. `test_employer_ticker.py` already holds this cache's bound ticker and `_espp_quote` to the
   expected ticker on the same nine shapes.
5. **`ESPP_TICKER_KEY`** (1bc18f76). The constant lives in `employer_ticker.py`. The reader,
   `WITHHOLDING_SETTING_KEYS`, `PROJECTION_SETTING_KEYS` and the Settings PUT's write all spell the key through it.
   The Settings PUT's `"espp_ticker" in provided` check is the request field name, so it stays literal, and
   `seed.py`'s default-settings dict also keeps its literal beside the other three keys. The compiled fingerprint
   statements are byte-identical, checked with a dump comparison. The fence now also matches a direct read spelled
   with the constant, and a self-check pins both spellings.
6. **The ticker re-check** (2e8f8f47). Both ticker-bound caches read the ticker before their first fingerprint. A
   Settings save that commits between the two leaves the settings cell on the new ticker and the quote cells on the
   old one. The fingerprint after the build agrees with that key, so the stability check used to pass and the entry
   was filed. Now `_memoised` takes an optional `still_current` veto, asked after a stable build.
   `_ticker_unchanged` re-reads the committed ticker and files the entry only if it is still the bound one.
   - **Why the re-read is a query.** The re-read uses `read_committed_employer_ticker`, a new query-based reader in
     `employer_ticker.py` that shares the rule's private `_ticker_of`. It does not use `read_employer_ticker`,
     because `db.get` answers from the identity map without a query while anything in the session holds the row's
     object (sessions never expire on commit), so a second `read_employer_ticker` could return the value being
     checked.
   - **Red first, and what it taught me.** My first red test relied on the session holding a stale ticker. It came
     out differently: the identity map holds clean objects weakly, so once nothing referenced the row, `db.get`
     queried again. The committed test injects the realistic race instead: a save committed right after the cache's
     own ticker read. Both caches filed the mis-keyed entry before the fix (1 entry) and file nothing after it (0).
     The next read files under the new ticker.
   - **Harm, stated plainly.** Only another request racing the same save could reach such an entry. The fix makes
     the invariant clean: a filed entry's key, bind and build all agree on the committed ticker. The cost is one small
     query per cache miss.

**Merge.** `git merge main` brought in 6b1f0c59 (the table-scroll batch: `src/`, `tools/`, `docs/`, no
`package.json`). The merge commit is 8f9b3779; it had no conflicts and no file overlap with this branch.

## Gates (fresh, on the merged branch 8f9b3779)

| Gate | Result |
|---|---|
| Backend `-n 2` | **2,711 passed, 4 skipped**, 183 s. Net −4 from the pre-review 2,715: +1 (item 2), −9 (item 4's nine-shape test), +2 (item 5), +2 (item 6). No warnings this run: the `SyntaxWarning` at `test_restore_points.py:531` (a pre-existing non-raw `\d` docstring in a file this lane did not touch) is emitted only when the bytecode is recompiled. It showed in the pre-review run as 2 warnings, one per worker. |
| ruff check / format | pass / 356 files already formatted |
| vitest | **291 files / 4,301 tests**. Main's table-scroll batch added the difference from the pre-review 285 / 4,218. |
| `tsc -b` | exit 0 |
| eslint | 0 errors, 26 warnings (the baseline) |
| `vite build` | exit 0 |

The test databases (`finance_test_int`, `_gw0`, `_gw1`, and task 1's verification databases `_va`, `_vb`, `_vc`)
were dropped. The servers on 8049 and 5249 were stopped and both ports are free.

One targeted vitest run while the task-1 burners were loading the box reported "1 failed" test file with every test
passing. It passed 18/18 on the rerun and in the full gate, which points to a worker timing out under that load
rather than a test failure.

## For the controller and lane T

- **Merge with T.** I compared T's worktree read-only (no git commands there) with main @84e83138, and re-checked it
  after the review follow-ups. T's copies of every file this branch touches are identical to main's, except
  `backend/tests/test_assistant_evidence.py`. There, T adds imports and new tests after the Stop test. A trial
  `git merge-file` of main, this branch and T's copy has 0 conflicts and keeps both changes.
- **`_memoised` has a new optional argument.** `still_current` (a veto asked after a stable build) is used by the
  two ticker-bound caches. The review-book and savings caches don't pass it and behave exactly as before.
- **Removed names.** `read_cache._employer_ticker` and `app_settings._read_espp_ticker` no longer exist; use
  `services.employer_ticker.read_employer_ticker`. In T's worktree and the table-scroll worktree, the only files
  that mention either name are this branch's own files, unchanged from main, so neither adds a caller. The
  table-scroll copies of every file this branch touches are identical to main's.
- **The new fence.** Any new direct read of `app_settings['espp_ticker']` in `app/` fails
  `test_one_module_reads_the_employer_ticker_setting`.
