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
  `test_the_narrowed_cells_cover_every_setting_and_quote_the_get_reads`, runs the heaviest path: a joint return
  with a simulated partner, last year on file and a lot sold this year, with a second quoted security and the
  refresh's bookkeeping keys present. It asserts that every read of either table is a keyed point read, and that the
  sets equal `WITHHOLDING_SETTING_KEYS` and `{the employer's id}`. W's table-level captures are unchanged.

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

## Gates (fresh, on this branch)

| Gate | Result |
|---|---|
| Backend `-n 2` | **2,715 passed, 4 skipped**, 195 s. The 2 warnings are one pre-existing `SyntaxWarning` (a non-raw `\d` docstring at `test_restore_points.py:531`), reported once per worker, in a file this lane did not touch. |
| ruff check / format | pass / 356 files already formatted |
| vitest | **285 files / 4,218 tests** |
| `tsc -b` | exit 0 |
| eslint | 0 errors, 26 warnings (the baseline) |
| `vite build` | exit 0 |

The test databases (`finance_test_int`, `_gw0`, `_gw1`, and the verification databases `_va`, `_vb`, `_vc`) were
dropped. The servers on 8049 and 5249 were stopped and both ports are free.

One targeted vitest run while the task-1 burners were loading the box reported "1 failed" test file with every test
passing. It passed 18/18 on the rerun and in the full gate, which points to a worker timing out under that load
rather than a test failure.

## For the controller and lane T

- **Merge with T.** I compared T's worktree read-only (no git commands there) with main @84e83138. T's copies of
  every file this branch touches are identical to main's, except `backend/tests/test_assistant_evidence.py`. There,
  T adds imports and new tests after the Stop test. A trial `git merge-file` of main, this branch and T's copy has 0
  conflicts and keeps both changes.
- **Removed names.** `read_cache._employer_ticker` and `app_settings._read_espp_ticker` no longer exist; use
  `services.employer_ticker.read_employer_ticker`. In T's worktree and the table-scroll worktree, the only files
  that mention either name are this branch's own files, unchanged from main, so neither adds a caller. The
  table-scroll copies of every file this branch touches are identical to main's.
- **The new fence.** Any new direct read of `app_settings['espp_ticker']` in `app/` fails
  `test_one_module_reads_the_employer_ticker_setting`.
