# Quick fixes, speed and chart cleanup (2026-09-23) — design record

**Status:** approved for implementation 2026-09-23. Source: the 2026-09-22 fresh-eyes audit
(`scratchpad/audit-2026-09-22/`, gitignored; `00-SUMMARY.md` + eleven area reports). The user chose,
verbatim: *"The quick bug fixes (#12), the first four speed fixes (#2) and the chart cleanup (#10).
We'll keep things on the same prod instance for now. Be thorough … correct both in the typical case as
well as in edge cases … always keep in mind the user experience and make things feel seamless."*
Decisions taken with the user: **stop at local main** (no push, no deploy — hand over the deploy
steps); **backup encryption was set on prod by the agent** (done 2026-09-23 07:02 UTC — see §B4).

House rules that hold everywhere (unchanged from earlier records): money math lives on the server and
the browser never recomputes an engine figure; absent ≠ zero; percents are percents in the UI and
fractions on the wire; copy names the noun and the reason; both themes; desktop widths only (1280,
1600, 1920 — no phone work); every mutating path keeps its existing ChangeBatch/Undo grammar.

Verification data: `finance_realdata` on the dev Postgres (127.0.0.1:5433) is a byte-verified restore
of prod's 2026-09-23 06:30 UTC nightly snapshot (41/41 tables identical). Login `admin@example.com /
changeme123` (dev seed). Use it READ-ONLY for smoke checks; any test that writes creates its own
scratch database. Baseline timings on it (local, sequential, warm, median of 5):
holdings 780 ms · sparklines 326 ms · coverage 96 ms · metrics 101 ms · metrics?month 107 ms ·
matrix 156 ms · projection 329 ms (prod's 2 vCPU box is 2–3× slower and serialises them).

---

## 0. Scope

| # | Item (audit ref) | Lane |
|---|---|---|
| P1 | `/portfolio/holdings` + `/prices/sparklines` stop hydrating the price-history table (perf B1) | P |
| P2 | nginx gzip (+ precompressed static assets) and HTTP/2 (perf F3) | P |
| P3 | One `/metrics/spending` request instead of two (perf F1) | P |
| P4 | Month-review book computed once per data version, not 4× per Overview (perf B3) | P |
| B1 | Grace's paycheck stops grading Edward's ESPP (income INC-01) | B1 |
| B2 | Calendar "Net" and Overview "Next 45 days" include living costs (planning C1, trust F19) | B1 |
| B3 | Restore points listed, downloadable and restorable; honest import/restore copy (data-entry F10) | B1 |
| B4 | Backup passphrase out of argv; in-app warning when off-box backups are unencrypted (perf O3) | B1 |
| B5 | Budgets tab opens on the month budgets exist; no duplicate-seed trap (flows F2, data-entry F7) | B2 |
| B6 | Credit cards: "droppable" becomes three honest verdicts (flows F5) | B2 |
| B7 | Taxes What-if "Add override" no longer models salary = $0 (planning W2) | B2 |
| B8 | Remembered Whose/range scope applies on the first page of a session (shell F6) | B2 |
| B9 | Visible keyboard focus on links and inputs in dark (shell F3) | B2 |
| C1 | Money flow on one time window; honest estimate nodes (trust F4, shell F2, flows F10) | CS |
| C2 | One colour per money entity app-wide (charts F4) | CS |
| C3 | Robust axes: one early month no longer sets the scale (flows F4, charts F5) | CS |
| C4 | Month-axis labels never collide; one date grammar (charts F6, shell F11) | CS + CT |
| C5 | In-progress / estimated periods drawn as such (charts F3, trust F15) | CS + CT |
| C6 | What-if "Δ by jurisdiction" bars visible and signed (planning W1, charts F2) | CT |
| C7 | Seven tax lines → four legible hue groups (charts F16, planning T11) | CT |
| C8 | Portfolio performance: events off the line (rug), honest benchmark statement (wealth PF-1/PF-5, charts F11, shell F5) | CT |
| C9 | Holding sparklines honest: printed 1Y %, baseline, neutral colour for tiny moves (wealth PF-11, charts F26) | CT |
| C10 | Scope/section changes and chart drills keep the reader's scroll position (charts F1) | CT |
| C11 | 120 px viewport-edge scrims reduced so they never wash out numbers (shell F10, charts F8) | CT |

**Explicitly out of scope** (later batches): the app-wide time model (future-dated snapshots, as-of
labels — audit #1), tax basis (#3), projection model (#4), everything else in the audit. Where an item
here brushes against #1 (C5's partial months, B5's current month) it uses only the objective rule
"a month whose last day is after today is in progress" and never changes stored data semantics.
The user excluded mobile work, transaction-level spending, realized gains and XIRR.

Lanes (one git worktree + branch each, merged to local main in the order P → B1 → B2 → CS → CT):

| Lane | Branch | Owns (files other lanes must not edit) |
|---|---|---|
| **P** perf | `fix/perf-first-four` | `backend/app/services/portfolio_calc.py`, `backend/app/api/prices.py` (sparklines), `backend/app/services/month_review.py`, `backend/app/services/review_input_v1.py` (read-only use only — the v1 contract is frozen), `backend/app/services/metrics.py`, `backend/app/api/coverage.py`, `backend/app/api/spending.py` (matrix loop only), `nginx.conf`, `Dockerfile`, `src/components/metrics/useSpendingEvidence.ts` |
| **B1** backend-led fixes | `fix/backend-quick-fixes` | `backend/app/api/paycheck.py` (pace inputs), `backend/app/services/espp_pace.py`, `backend/app/api/calendar.py` + a new `backend/app/services/living_estimate.py`, `backend/app/services/snapshot_store.py`, `backend/app/api/system.py`, `backend/app/api/import_.py`, `backend/scripts/backup_db.sh`, `src/components/calendar/CashflowStrip.tsx`, `src/components/calendar/cashflow.ts`, `src/components/overview/upNext.ts` (+ the component rendering its line), `src/components/settings/RestoreCard.tsx`, `src/components/settings/BackupsCard.tsx`, `src/components/settings/SystemCard.tsx`, `src/components/paycheck/**` for the ESPP presets and pace strip (NOT `paycheckSankeyOptions.ts`, which CS owns) |
| **B2** frontend fixes | `fix/frontend-quick-fixes` | `src/components/spending/BudgetPanel.tsx`, `src/components/creditcards/**`, `src/pages/CreditCardsPage.tsx`, `src/components/taxes/WhatIfPanel.tsx`, `src/components/shell/useScope.ts`, `src/prefs/**` (read), `src/index.css` (focus rule only), `src/pages/LoginPage.css` |
| **CS** spending/overview charts | `fix/charts-spending-overview` | `backend/app/services/money_flow.py`, `backend/app/api/overview.py` (money-flow), money-flow schema, `src/charts/entities.ts`, `src/charts/grammar.ts`, `src/components/overview/moneyFlowOptions.ts`, `src/components/overview/MoneyFlowCard.tsx`, `src/components/overview/overviewChartOptions.ts`, `src/components/spending/**ChartOptions.ts`, `src/components/calendar/calendarView.ts` (colours), `src/components/paycheck/paycheckSankeyOptions.ts`, `src/components/comp/compChartOptions.ts`, `src/components/portfolio/dividendChartOptions.ts` (colours only) |
| **CT** tax/portfolio charts + shell | `fix/charts-tax-portfolio` | `src/charts/scales.ts`, `src/components/taxes/taxChartOptions.ts`, `src/components/taxes/CompositionPanel.tsx`, `src/components/portfolio/historyChartOptions.ts`, `src/components/portfolio/Sparkline.tsx`, `src/components/portfolio/HoldingsTable.tsx`, `src/components/shell/LocalSections.tsx`, `src/components/panels.css` (scrims), `src/index.css` (scrim variables only) |

Shared files touched by more than one lane (`src/types/api.ts`, `src/pages/OverviewPage.tsx`,
`src/pages/SpendingPage.tsx`, `src/pages/PortfolioPage.tsx`, `src/pages/SettingsPage.tsx`) take
**additive, local** edits only; the merge step resolves them. `src/index.css` is shared by B2 (one
new focus rule) and CT (the two scrim variables) — different lines, no reformatting. `grammar.ts` belongs to CS: CT must not
edit it (CT's weekly-axis and estimate styling live in its own files, reusing existing tokens and the
existing decal/hatch mechanism, `src/components/useChartDecals.ts`).

---

## P. Speed (lane P)

### P1. Holdings and sparklines read only what they use

**Problem.** `load_portfolio(with_history=True)` (`portfolio_calc.py:280-333`) hydrates every
`PriceHistory` row (~23.6k on prod, +~86/weekday) as ORM objects so `build_holdings` can read
`bars[-2].close` per security (`:166-168`) for the day change. `/prices/sparklines` hydrates ~8k ORM
rows for 365 days and buckets them in Python (`prices.py:133-177`). Only the holdings endpoint calls
with history (`api/portfolio.py:565`).

**Decision.**
- Replace the history load with a "last two bars per security" query (window function
  `row_number() over (partition by security_id order by price_date desc) <= 2`, or an equivalent
  LATERAL/LIMIT 2), returned in the same `dict[int, list[PriceHistory-like]]` ascending by date so
  `bars[-2]` keeps its exact meaning. Rename the parameter/docstring so nobody later assumes "history"
  means full history.
- Sparklines: select Core tuples `(security_id, price_date, close)` and downsample in SQL with
  `DISTINCT ON (security_id, date_trunc('week', price_date)) … ORDER BY security_id,
  date_trunc('week', price_date), price_date DESC` (ISO weeks start Monday = `date_trunc('week')`),
  filtered exactly as today (held ids, `price_date >= since`), then ordered `(security_id,
  price_date)`.

**Must stay byte-identical:** the JSON of `/portfolio/holdings` (all owner scopes) and
`/prices/sparklines?days=N`. Edge cases the tests must cover: a security with 0, 1, 2 and many bars;
gaps in dates; a held security with no history; the latest bar being older than the latest quote;
weeks straddling a year boundary (ISO week 52/53/1); `days` starting mid-week; owner-scoped holdings.

**Acceptance.** Equivalence tests comparing the new functions with the old algorithm on randomised and
edge-case fixtures; the existing portfolio/prices suites pass unchanged; on `finance_realdata` the
responses hash identically to the baseline (`scratchpad/realdata/timing-baseline.json`) and holdings
drops from ~780 ms to ≤ 200 ms, sparklines to ≤ 100 ms locally.

### P2. Compression and HTTP/2 in nginx

**Problem.** Prod serves JS/CSS/JSON uncompressed over HTTP/1.1 (`nginx.conf:22`, no `gzip*`):
1.87 MB of JS on a cold session; the Overview's ~20 API calls share six browser sockets.

**Decision.**
- `nginx.conf` (http context of the conf.d file): `gzip on; gzip_comp_level 5; gzip_min_length 1024;
  gzip_vary on; gzip_proxied any; gzip_types application/json application/javascript text/javascript
  text/css image/svg+xml text/plain text/calendar application/manifest+json;` and `gzip_static on;`.
  `text/event-stream` is deliberately **not** listed (the assistant's SSE must stream unbuffered; the
  backend already sends `X-Accel-Buffering: no`). ZIP downloads are not listed.
- HTTP/2: `listen 443 ssl;` + `http2 on;` (nginx ≥ 1.25.1; the image is `nginx:1.25-alpine`).
- `Dockerfile` final stage precompresses the built assets once at image build
  (`.js .css .svg .html .json .txt .webmanifest` ≥ 1 KB → `.gz` alongside, `gzip -9`, originals kept)
  so the 2 vCPU box never compresses static files per request. Brotli is **not** added (the stock image
  has no brotli module; a custom nginx build is not worth the risk) — record that choice in a comment.
- Cache headers stay as they are (`index.html` no-cache; hashed assets immutable). `gzip_vary` keeps
  Cloudflare's cache correct.

**Acceptance.** A local docker test (build the frontend image; run it with a self-signed cert and a stub
`backend` container on a user network) shows: `nginx -t` OK; `Content-Encoding: gzip` + `Vary:
Accept-Encoding` on a hashed `.js`, the `.css`, `index.html` and an `/api/…` JSON; no gzip on
`text/event-stream` and the stream arrives incrementally; `curl --http2 -k` negotiates `HTTP/2`;
uncompressed clients still get identical bytes. README Part 4 gets one line saying compression and
HTTP/2 arrive with the next frontend image rebuild.

### P3. One spending-evidence request per view

**Problem.** `useSpendingEvidence(month, revision)` (`src/components/metrics/useSpendingEvidence.ts`)
fires immediately with `month = undefined`, then again with `?month=<default_month>` once the matrix
arrives; the two responses are byte-identical on the Overview and on Spending's default view. The
second waits behind the (slow) matrix and runs the review book again.

**Decision.** Keep the immediate default request (it starts in parallel with the matrix). When a
concrete month is requested and the default request for the same `revision` is in flight or done,
wait for it; if its `response.month` equals the requested month, use it (and store it in the snapshot
cache under the month key too) — no second request. Otherwise fetch `?month=`. A failed default
request falls back to the explicit request. Month identity compares normalised `YYYY-MM-01`.

**Acceptance.** Hook tests: Overview-shaped sequence makes one request; Spending drill to a different
month makes exactly one extra request; revision change refetches; default failure falls back; unmount
mid-flight does not set state. Browser check on `finance_realdata`: Overview and Spending each issue a
single `/metrics/spending` request on load.

### P4. The month-review book, once per data version

**Problem.** `load_review_book` (`month_review.py:164-223`) reads nine tables and rebuilds 39 months of
canonical inputs + SHA-256 revisions on every call; one Overview load calls it four times
(coverage, metrics ×2, matrix), plus projection/month-review/update pages. `load_month_savings` runs
3× per Overview. The matrix's category comparison does a linear `next(...)` scan per
category × month × lookback (`metrics.py:84-101`, `spending.py:442-446`).

**Decision.**
- **Read-path memoisation keyed by a transactional data fingerprint.** Before building, run ONE cheap
  SQL statement that fingerprints exactly the tables the book reads (row count + sum of
  `hashtextextended(t::text, 0)` per table, combined): `accounts, net_worth_snapshots,
  account_balances, spending_categories, monthly_spending, monthly_cashflow, paycheck_profiles,
  month_reviews, month_review_adoption`. Cache key = `(fingerprint, today, tuple(sorted(extra_months)))`;
  a small in-process LRU (≤ 8 entries). Any committed write by any writer — ORM, Core undo/restore,
  the importer CLI, another process, psql — changes the fingerprint, so staleness is impossible without
  event hooks, TTLs or migrations. (Rejected: in-process write counters — Core and out-of-process
  writers bypass them; DB triggers — a migration for a problem a 2 ms query solves.)
- **Only read paths use the cache.** Read paths: `api/coverage.py:34`, `services/coverage.py:99`,
  `services/metrics.py:163`, `api/spending.py:440`, `api/projection.py:321`, `api/month_review.py:30`
  and `:41` (GETs). Write paths keep the uncached, lock-protected load: every other call in
  `api/month_review.py` (`:71`, `:95`, `:113`, `:133`, `:175`, `:200` — close/reopen/review flows)
  and `month_review.py:240` (adoption). The cached `ReviewBook` must not carry
  session-bound ORM objects: `reviews` becomes immutable snapshots with the same attribute names the
  read paths use (audit every consumer of `book.reviews`).
- Memoise `load_month_savings` the same way (its own table list — derive it from the code, don't guess).
- Index `book.inputs[month]["spending"]` by `category_id` once per request in the matrix/metrics
  comparison instead of the per-lookup `next(...)` scans.
- Tests clear the cache between tests (autouse fixture).

**Acceptance.** Cached vs uncached books are equal for the same data; each table's insert, update and
delete invalidates; a changed `today` and a different `extra_months` miss; write paths never receive a
cached book (test by poisoning the cache); ORM objects never leave a session. Every existing
month-review/metrics/coverage/spending test passes unchanged. On `finance_realdata`, coverage,
metrics and matrix responses hash identically to the baseline and a warm Overview-shaped sequence
(coverage → metrics → metrics?month → matrix) spends ≥ 50% less server time than baseline.

---

## B1. Backend-led quick fixes (lane B1)

### B1. ESPP pace belongs to the ESPP participant

**Problem.** `_pace_inputs(db, person_id)` (`api/paycheck.py:707-745`) loads every `EsppPeriod`
(no owner column exists, `models/comp.py:10-36`), so Grace's pace strip reads "ESPP §423 annual ·
$21.7K / $21.3K · 102.26 % over" although her ESPP is 0 %, and her Try-changes "Max ESPP" preset would
enrol her at 15 %.

**Decision (no migration).** Stored ESPP periods belong to the household's ESPP participants:
people with `espp_pct > 0` in **any** of their paycheck profiles; if nobody has one, the **primary**
person (single-earner households keep today's behaviour). For a non-participant, `_pace_inputs`
returns no stored periods, so the row only appears if their own scenario sets an ESPP rate (the
existing "window ≤ 0 and rate ≤ 0 → no row" rule then hides it). The breakdown/preview payloads expose
`espp_participant: bool` for the person so the frontend never re-derives the rule; the "Max ESPP" and
"Stop ESPP" presets are disabled for a non-participant with a **visible** reason line (not only a
tooltip): "ESPP presets model the household's ESPP plan (Edward's)." — the participant's name comes
from the payload. A real owner column on ESPP tables stays future work (income INC-21).

**Acceptance.** API tests: participant sees today's exact row (byte-identical breakdown for Edward);
non-participant has no ESPP row and `espp_participant=false`; nobody-with-ESPP → primary gets the
row; both participants → both keep the stored periods (documented limitation); a sandbox ESPP rate
for a non-participant produces an estimated-only row. UI test for the disabled presets + visible
reason. `tests/test_sandbox_purity.py` still passes (SELECTs only).

### B2. Living costs in the calendar's cash flow and in "Next 45 days"

**Problem.** Calendar tiles read "Cash in $8,274.22 · Cash out $0.00 · Net $8,274.22" for September;
Overview's Up next reads "Next 45 days: +$12.4k in · −$50 out" — both omit ≈$5.4k/month of living
spend, so they read as a forecast that the household nets +$8.3k a month.

**Decision.**
- Backend: `GET /calendar` gains `living: [{month, amount, basis, months_in_average}]` for every month
  overlapping `[start, end]`, from a new pure-ish service `living_estimate.py`:
  - `basis = "budget"` when at least one living-kind budget resolves for that month — amount = sum of
    the resolved living budgets (the Spending page's own resolution rules; reuse, don't reimplement);
  - otherwise `basis = "average"` — the mean living spend of the most recent ≤ 12 **eligible** months
    before that month (the same eligibility and "living" definition the Spending page's
    "Previous 12 months" tile uses; reuse the metrics code — it benefits from P4's cache after merge);
    future months use the latest ≤ 12 eligible months;
  - no budgets and no eligible months → the month is omitted (the UI says so).
  Money stays 2-dp strings on the wire.
- Calendar strip (`CashflowStrip.tsx`), five tiles: **Scheduled in**, **Scheduled out**, **Living costs**
  (`≈ $5,478` + sub-line "from your budgets" / "12-month average"), **Net** (= in − out − living,
  always marked as an estimate with the existing `~` grammar, tone by sign), **Vesting** (unchanged).
  Receipts/hints updated: Net's components list all three terms; "Scheduled" wording replaces the
  hidden "scheduled events only" caveat. When there is no living estimate, the Living tile reads "—"
  with "No budgets or complete months yet", and Net shows the scheduled net labelled "Scheduled net".
  Week gutters stay scheduled-only; a gutter side that is $0 is not printed.
- Overview Up next line: "Next 45 days: +$12.4k scheduled in · −$50 scheduled out · ≈ −$8.1k living
  costs" — living pro-rated by days of each month inside the window (a partial current month counts
  only its remaining days). Same "—"/omission rule when no estimate exists.

**Acceptance.** Service tests: budget basis (including partial category coverage and a budget that
starts mid-window), average basis (fewer than 12 eligible months, none), future months, a month with
both budget and average data (budget wins). API contract test. Strip/Up-next unit tests including the
pro-ration arithmetic in integer cents. On `finance_realdata`: September shows Living ≈ the 13
budgets' total ($5,478.00, basis budget), Net ≈ $8,274.22 − $5,478.00.

### B3. Restore points you can actually use

**Problem.** Restores and imports write a pre-restore ZIP to `data/restore-points/`
(`snapshot.py:403-420`, keep 3) but the UI can't list, download or restore it: listing reads only
`snapshots/` (`snapshot_store.py:54-58`) and restore-from-stored accepts only `finance-export-*`
(`api/import_.py:72-80`). Meanwhile two cards promise "the way back is one more restore away" and the
import confirm says "This cannot be undone" (`SettingsPage.tsx:256-260`).

**Decision.**
- Backend: `GET /system/restore-points` → same entry shape as `/system/snapshots` (+ `kind`), newest
  first, restorable = head matches (reuse `_head_of`); a download route for **either** kind
  (`GET /system/snapshots/{name}/download`, FileResponse, `application/zip`); restore-from-stored
  accepts either grammar and resolves the matching directory. The name grammars remain the
  path-safety check (both anchored regexes, symlink and `is_relative_to` guards as today). Restoring
  from the oldest of three restore points still works (bytes are read before the new point rotates it
  out) — document it.
- Frontend: Restore card's stored-snapshot select gets an optgroup **"Restore points (saved before a
  restore or import)"** with local-time labels; Backups & snapshots lists restore points (download +
  Restore…) under their own heading. After an import or restore completes, the success toast names the
  restore point with an action **"Undo"** that pre-selects it in the Restore card (the user still
  confirms the dry-run/restore — no silent writes). Copy fixes: the import confirm says "A restore
  point of your current data is saved first — you can roll back from Settings › Data › Restore"; the
  two cards' promises now point at a real control. Snapshot rows show the local date/time as the label
  and keep the UTC filename as secondary text.

**Acceptance.** API tests: listing (grammar filtering, symlink ignored, foreign names ignored,
restorable flag), download (both kinds, traversal names 404), restore-from-restore-point dry-run and
apply (restores bytes read before rotation). UI tests for the optgroup, the Undo action preselecting,
and the corrected copy. Verified end-to-end on a **scratch copy** of `finance_realdata` (never the
shared real-data DB): import → restore point listed → restore it → data back to the pre-import state.

### B4. Backup passphrase out of argv; say when backups are unencrypted

**Done on prod (2026-09-23 07:02 UTC, user-approved):** `BACKUP_PASSPHRASE` (256-bit, hex) was
generated directly into prod `.env` (never printed); `.env` tightened from 664 to 600 (it holds every
secret); a backup of the previous `.env` kept as `.env.bak-20260923` (600); one run uploaded
`backups/finance_2026-09-23.sql.gz.gpg` and its restore verification passed
(`net_worth_snapshots=38 monthly_spending=722 position_transactions=39`); the app's backup marker
reads `encrypted: true, verified: true`. Plaintext dumps from the previous 30 days remain in the bucket
until retention ages them out (the user may delete them sooner).

**Code decision.** `backup_db.sh` passes the passphrase to gpg via a file descriptor
(`--passphrase-fd 3 3<<<"$BACKUP_PASSPHRASE"`) for both encrypt and decrypt, so it never appears in the
process list; `bash -n` + the existing script tests (if any) pass. The Settings backup/system card shows
a warning row when the latest marker says `encrypted: false`: "Off-box backups are not encrypted — set
BACKUP_PASSPHRASE (README 5.3)." README 5.3 gains: keep `.env` at mode 600.

---

## B2. Frontend quick fixes (lane B2)

### B5. Budgets open where the budgets are

**Problem.** Spending › Budgets reads the page's focused month (`default_month` = Aug 2026) and says
"No budgets yet · Start from my averages" although 13 budgets exist from Sep 2026
(`BudgetPanel.tsx:95-116, 415-436`); the primary button would write 13 more rows dated Aug.

**Decision.**
- When the URL has no explicit `month`, the Budgets section opens on: today's month if any budget
  resolves there; else the latest month that has a resolved budget; else the page default. An explicit
  `?month=` (ribbon click, deep link) always wins.
- Empty state when budgets exist elsewhere: "No budgets in force for Aug 2026 — your 13 budgets start
  Sep 2026 · [View Sep 2026]". "Start from my averages" appears **only** when the book has no budget
  rows at all.
- Each budget row says "since Sep 2026" (its effective month). A budget month that has not ended shows
  "month to date" next to the header so a rent-only September reads as partial, not as under budget.

**Acceptance.** Component tests for the four month-resolution cases, the aware empty state, the seed
button's visibility rule, "since" labels and the month-to-date note. Browser check on
`finance_realdata`: `/spending?section=budgets` opens on Sep 2026 with 13 meters.

### B6. Credit cards: three honest verdicts

**Problem.** "Droppable on these numbers: Capital One Savor, Wells Fargo Active Cash, Wells Fargo
Autograph Visa, Apple Card, Costco Anywhere Visa" — 4 of 5 are $0-fee cards (two only tie Robinhood
Gold's 3×), one is the household's oldest card at 38 % utilization (`CreditCardsPage.tsx:300,471-481`,
`CardDetail.tsx:299-305`, `rewardsMath.ts:230-248`, `cardValueChartOptions.ts:61-66`).

**Decision.** Replace the droppable list with three verdicts from one pure function in
`rewardsMath.ts`: **"Costs you money"** (fee > 0 and net value < 0; negative tone), **"Free to keep —
no extra rewards"** (fee = 0 and marginal value = 0; neutral tone; copy mentions credit history and
available credit), **"Earns its keep"** (net > 0; positive tone). A card whose marginal value is $0
only because it ties another card says so ("ties Robinhood Gold on groceries, dining…"). The drill-in
for a "Costs you money" or "Free to keep" card states what closing would change: total credit line
$A → $B and, when balances are known, household utilization X % → Y %. The value chart colours match
the verdict tones and $0 rows are still drawn (a thin neutral stub with a label).

**Acceptance.** Unit tests for the verdict function (fee/no fee × marginal 0/positive × ties, negative
net), footer/drill-in copy tests, chart option test. Browser check on `finance_realdata`: no $0-fee card
is labelled as costing money; Venture X's verdict follows its numbers.

### B7. "Add override" starts empty

**Problem.** One click on Taxes › What-if › "Add override" sets `?whatif=annual_salary:null`, models
Annual Salary = $0 (Δ tax −$62,403, Δ take-home −$115,038) and offers "Apply 1 override to 2026"
(`WhatIfPanel.tsx:296,306-309,580-601`; backend treats null as 0, `tax_whatif.py:212-213`).

**Decision.** A new override row starts with **no key chosen** ("Choose an input…") and contributes
nothing to the scenario (and nothing to the URL) until an input is chosen **and** a value that differs
from the stored one is entered; choosing a key pre-fills the stored value. Clearing an input is an
explicit "Clear this input" checkbox, never an empty box. Apply is enabled only for complete rows.
Legacy `?whatif=key:null` links keep parsing and render as an explicit "clear" row (so old links
don't silently change meaning).

**Acceptance.** Component tests: add → no request change / no URL change; choose key → prefilled, no
delta until edited; clear checkbox → explicit clear; Apply disabled for incomplete rows; legacy link
parsing.

### B8. The remembered scope applies on the first page

**Problem.** `useScope` reads memory once per URL change and normalises defaults (`owner=all`,
`range=1y`) into the URL before the server's `scope` pref is adopted; it never subscribes to
`prefsStore` adoption (`useScope.ts:113-156`, `prefsStore.ts:253-256`). A new browser/device lands on
the wrong person/range, then the next click silently switches.

**Decision.** Subscribe `useScope` to `scope` adoption. When the adopted value arrives and the current
URL's owner/range came from **arrival normalisation** in this page view (not a deep link, not a user
action), re-normalise to the adopted value with `replace`. A deep link or a user change made before
adoption is never overridden. Pages that do not use a key are untouched.

**Acceptance.** Hook tests covering: prefs arrive before mount; after mount (normalised → replaced);
deep link present (kept); user clicked a chip first (kept); prefs never arrive (defaults stay).
`scratchpad/audit/scopetest.mjs`-style browser repro now lands on the stored scope on the first page.

### B9. Keyboard focus you can see

**Problem.** Links and the login inputs fall back to the browser's `outline: auto` — a #101010 ring on
a #171a21 card (1.09:1) in dark (shell F3).

**Decision.** One low-specificity global rule in `src/index.css`:
`:where(a, input, select, textarea, summary, [tabindex]):focus-visible { outline: 2px solid
var(--accent); outline-offset: 2px; }` (component rules with their own focus styles keep winning), plus
an explicit `:focus-visible` treatment for `.login-card input`. Contrast of the ring ≥ 3:1 against
both card surfaces in both themes (add to the tokens contrast test if the accent is not already
covered). Mouse clicks must not show the ring (`:focus-visible`, not `:focus`).

**Acceptance.** CSS presence test (the repo's CSS tests style), tokens contrast test, a browser tab-walk
on Overview (dark + light) showing a visible ring on links, Up-next rows and login inputs.

---

## CS. Spending/overview charts + money flow + entity colours (lane CS)

### C1. Money flow on one time window

**Problem.** `GET /overview/money-flow` (router `api/overview.py:123-184`, service
`services/money_flow.py`) combines full-year tax-engine income and taxes, **8 months** of entered
take-home, **9 months** of spending (Sep is rent-only) → "Saved $148.74" while the YTD card says cash
saved Jan–Aug $2,220.97 (the gap is exactly September's $2,072.23). The estimated node is called
"Take-home not yet entered (4 months)" even for months not yet earned, and 2023 invents $43k "not yet
entered" for months before tracking began.

**Decision (actuals where they exist, estimates labelled, one window on the right side).**
- **Matched months** = months of the year with both take-home and spending entered (the YTD card's
  window — confirm against its code and use the same rule).
- Middle column unchanged in meaning and still conserving: gross → taxes, pre-tax savings, retained
  equity (residual), take-home cash (all entered months), estimated take-home (missing months).
- Right side flows only over matched months: take-home of matched months → the categories' matched-month
  totals + Saved/Drawdown. Take-home of months that have pay but no spending (rare) goes to a terminal
  node "Take-home, spending not entered (Mmm)". Spending of months without take-home (Sep 2026) is left
  out and named in the card footer: "Sep 2026 spending ($2,072.23) is shown once its take-home is
  entered."
- `category_sums` exclude transfer-kind categories when the YTD card's saved figure does (match its
  definition exactly — Saved on the sankey must equal the YTD card's cash saved for the same months).
- Payload gains (additive, existing fields keep their meaning): `matched_months: list[date]`,
  `take_home_pending_months: list[date]`, `take_home_unmatched: Decimal` (pay-without-spending
  months' take-home), `take_home_unmatched_months: list[date]`, `spending_unmatched_months:
  list[date]`, `spending_unmatched_total: Decimal`. `take_home_cash` keeps meaning "all entered
  months"; `saved` becomes matched-months take-home minus matched-months spending.
- Frontend: estimated node named by its months and nature — "Est. take-home, Sep–Dec" (not yet
  earned/entered) or "Est. take-home, Jan–Jul (before tracking)" — drawn muted with the existing
  estimate styling; the card title or sub-line states the right side's window ("Spending and saved:
  Jan–Aug"); tooltip explains estimates.
- A complete year (2025) is byte-identical to today (Saved $11,528.79).

**Acceptance.** Service/router tests: complete year unchanged; partial current year (matched < entered
spending); pay-without-spending month; pre-tracking first year; transfer categories; conservation of
every column to the cent; refusal reasons still fire. On `finance_realdata`, 2026 Saved = $2,220.97
(= YTD card), 2025 unchanged, 2023 labelled "before tracking".

### C2. One colour per money entity

**Problem.** Category colours follow rank per view (`spendingChartOptions.ts:121` all-time rank;
`moneyFlowOptions.ts:239-245` that year's rank), so Shopping/Gifts/Taxes change colour between pages
and years; inside the Overview sankey Shopping = Pre-tax savings (`PALETTE[5]`) and Travel = Retained
equity (`PALETTE[6]`); ESPP/RSU/salary/dividends take different colours in money flow, calendar,
paycheck sankey, comp and dividends; the Taxes category is green like "Saved".

**Decision.** Extend `src/charts/entities.ts` into the single registry (charts spec §12's principle):
1. A spending category's colour is stable across every chart and year: the Spending page's existing
   all-time ranking decides slots once (one shared function, used by Spending bars, category trends,
   the money flow and the "Where … went" sankey); categories outside the fold take the Other grey.
   The money flow folds by the **same** category set as Spending, so the two legends agree.
2. Within any single chart, two different entities never share a colour (the Other grey excepted).
3. Semantic reservations: the POSITIVE green family only for saved/kept (Saved, pre-tax savings);
   NEGATIVE only for deficits; grey for Other and structural pass-through nodes (gross, take-home,
   retained equity/residual, estimates); tax (liability node, tax-kind category, calendar tax
   deadlines) one tax hue.
4. Income entities — salary (per-person tints as today), RSU, ESPP, investment/dividend income, other
   income — have one colour each across money flow, calendar, comp, paycheck sankey and dividend
   charts.
5. Colours come only from `charts/theme.ts` tokens (no invented hex); both themes keep the existing
   contrast floors (tokens test) and the decal/pattern option keeps working.
Document the mapping as a table in `entities.ts`.

**Acceptance.** Registry unit tests (stability across rank changes, no duplicate colours within the
money-flow node set, reservations respected); updated chart option tests; conformance test
(`src/charts/conformance.test.ts`) passes; browser check: the same category has the same colour on
Overview money flow and Spending in both themes.

### C3. Robust axes

**Problem.** Aug 2023 net pay $25,937.48 sets the Spending monthly chart's y-axis to $30K (typical
months live in the bottom fifth); Sep 2023's −1,073 % savings rate sets the Trends savings axis to
−1100 % (with "81 %"/"0 %" label collisions) (`grammar.ts:72-79`, `spendingChartOptions.ts:89-170,
382-420`).

**Decision.** A shared helper in `grammar.ts`: robust max = nice(p95 × 1.15) applied **only when**
the data max exceeds 1.5 × p95 (normal data is never clipped). Clipped values render at the edge with a
marker and their true value in label/tooltip ("$25.9K ↑", "−1,073 % ↓"). The savings-rate floor
clamps at −100 % with the same off-scale markers; its max is a nice step above the data (no forced
data-max label). Axis labels use `hideOverlap`. The Spending page's cash-rate line (its headline
figure) is drawn in a data colour, not the muted annotation grey.

**Acceptance.** Unit tests for the helper (no clipping on normal data, clipping on the audit's
outliers, marker values), option tests for both charts, browser check on "All" range in both themes.

### C4. Month labels that never collide (CS part: monthly category axes)

**Problem.** `monthAxis` forces every label when there are ≤ 12 (`grammar.ts:85-99`, `interval: 0`):
"Oct 2025Nov 2025Dec 2025…" on Overview's Recent spending at 1600 px, a smear at 1280.

**Decision.** `monthAxis` measures available width per category: ≥ ~56 px → "Mmm YYYY"; otherwise
short labels "Oct", "Nov", … with "Jan '26" (or the first label) carrying the year; `hideOverlap`
as a guard. Tooltips keep the full month. One grammar for every monthly axis (net worth trend,
recent spending, spending bars, dividends, heatmap if it uses `monthAxis`).

**Acceptance.** Unit tests at 1280/1600/1920-equivalent widths; browser check of Overview at 1280 and
1600 in both themes.

### C5. In-progress periods (CS part: spending and overview)

**Decision.** A month whose last day is after today (product today; the matrix's `review_state`
`in_progress` when present) is drawn with the existing partial/estimate treatment (reuse the decal
mechanism — hatched when chart patterns are on, reduced-opacity fill + dashed outline otherwise), its
axis label carries a marker, and its tooltip says "Sep 2026 — month to date (in progress)". Applies to
Overview › Recent spending and Spending › Monthly entries (bars and the net-pay line) and the heatmap's
column. Averages/reference lines already exclude it — keep that.

**Acceptance.** Option tests with a partial last month; browser check that September 2026 is visibly
partial on both charts in both themes.

---

## CT. Tax/portfolio charts + shell scroll (lane CT)

### C6. What-if "Δ by jurisdiction" bars

**Decision.** Colour each bar by its **value sign** (`visualMap.dimension = 0` on the value dimension,
or explicit per-bar colours): more tax = the warm/negative tone, less tax = the positive tone,
zero = neutral; value labels at bar ends ("+$19.1K"); remove the unlabelled gradient legend (or move it
into the header as "less tax ← → more tax") so it no longer covers the x-axis ticks
(`taxChartOptions.ts:447-470`, `scales.ts:8-14,46-62`).

**Acceptance.** Option test asserting sign-keyed colours and no legend overlap; browser check (dark +
light) with "Max 401(k)" + "Sell all NVDA": bars clearly visible (≥ 3:1 against the card).

### C7. Tax lines in four hue groups; the current year marked as an estimate

**Decision.** `TAX_COLORS` becomes four legible hue groups — Federal income, State, Payroll (Medicare,
Social Security, SDI/Disability as tints of one hue), Investment (capital gains, NIIT as tints) —
from theme tokens, contrast-checked in both themes. The current, not-yet-finished tax year in "Tax
composition by year" uses the estimate treatment and the label "2026 (est.)". The tooltip total uses
the server's total (no cent drift).

**Acceptance.** Option tests; tokens contrast test; browser check both themes.

### C8. Portfolio performance: events off the line, honest benchmark

**Decision.**
- Events: dividend/ex-dividend events move from the value line to a thin rug strip along the bottom of
  the plot (one tick per week that has events, coloured by kind, tooltip lists them), **filtered to
  securities held at that time or now**; dated transaction events (buys/sells/vests), if any, stay on
  the line. One legend entry per kind; the rug can be toggled.
- Benchmark: rename "VOO (your contributions)" → "Same deposits in VOO" and "S&P 500 baseline" →
  "S&P 500 — starting balance only", the latter **legend-off by default** on Portfolio and **not drawn**
  on the Overview card. Both cards gain a one-line lede computed from the history points already in
  the payload: "Ahead of the same deposits in VOO by $263.7K" (or "Behind … by …"), following the
  range chip on Portfolio ("Over 1Y: …"). No XIRR, no realized figures.
- Weekly axes label month boundaries only ("Oct 2023"), exact dates stay in the tooltip (CT's part of
  C4, done inside `historyChartOptions.ts`).

**Acceptance.** Option tests (rug series, held-ticker filter, legend defaults, lede arithmetic incl.
negative), browser check on Overview and Portfolio in both themes.

### C9. Holding sparklines tell the truth

**Decision.** Each 1Y cell prints its % change beside the line ("+0.4 %"), draws a faint baseline at the
starting value, uses the neutral colour when |Δ| < 1 %, and gets an accessible label
("NVDA 1-year change +28.4 %") instead of `aria-hidden` (`Sparkline.tsx:18-45`,
`HoldingsTable.tsx:182`). Per-row scaling stays (it is a sparkline).

**Acceptance.** Component tests (label, neutral threshold, a11y label); browser check that SGOV reads
"+0.4 %" in neutral.

### C10. Keep the reader's place

**Problem.** `LocalSections.tsx:77-82` restores the section's remembered scroll (default 0) on every
`location.key` change — so owner/range chips, the month ribbon and chart drills (all search-param
writes) throw the reader to the top (600 → 0 measured).

**Decision.** Restore section scroll only when the **section** changes or on POP navigation; ignore
search-param-only updates. When a chart drill docks a detail panel and reflows the chart, keep the
clicked chart's top edge where it was (measure before, `scrollBy` the difference after layout).

**Acceptance.** Hook/component tests for section change vs search-param change vs POP; browser checks:
Spending YTD chip at scrollY 600 stays at 600; Net worth owner chip keeps position; a Spending bar
drill keeps the chart in view.

### C11. Viewport-edge scrims never wash out numbers

**Decision.** `--scrim-h` 120 px → 32 px, alpha ≤ 0.5 (`src/index.css:73-74`,
`panels.css:1199-1254`); the first card after an anchor/deep-link scroll is never under a scrim.
Reduced motion keeps them off as today.

**Acceptance.** CSS test update; browser check at 1600×1000 that the Overview YTD strip is fully legible
at rest.

---

## Process, verification and rollout

1. **Per lane** (in its worktree): write a lane plan (superpowers:writing-plans) under
   `docs/superpowers/plans/2026-09-23-<lane>.md`; TDD for every behaviour change; run the full backend
   suite with `FINANCE_TEST_DB=finance_test_<lane>` (never the shared test DB), `ruff`, the full
   vitest suite, `tsc -b`, `eslint`, `vite build`. Browser checks against `finance_realdata` with the
   lane's own backend (port 80xx, `SCHEDULER_ENABLED=0`) and vite (`VITE_API_PROXY`), both themes,
   1280 and 1600. Commit in small, well-described commits.
2. **Review**: an independent reviewer per lane checks spec compliance and code quality; every finding
   is fixed or explicitly answered; re-review until clean.
3. **Merge** to local main in the order P → B1 → B2 → CS → CT, re-running the gates after each merge.
4. **Final verification** on merged main: full gates; timing re-run on `finance_realdata` vs
   `timing-baseline.json` (hashes must match for unchanged endpoints; speed targets above); a
   read-only real-browser walk of every changed view in both themes; the nginx docker test (P2).
5. **Rollout (for the user; not executed)**: push `main`, then on prod `git pull` and the README 4.1
   rebuild of both images (frontend picks up P2 and every UI change; backend picks up P1/P4/B1–B3/C1).
   No migration is introduced. After deploy: the Settings backup card should say encrypted; the Overview
   should load in roughly a second.
