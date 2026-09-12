# Dashboard experience implementation review

The approved work for items **1, 3–8, and 10** is implemented on `feat/dashboard-experience`, based on `99dd3f0223b2bff042f69a6adf7357a1f460e961`. All six implementation phases are available for local review. Production code and data have not been changed.

The [approved design](../plans/2026-09-12-dashboard-experience-design.md) and [implementation plan](../plans/2026-09-12-dashboard-experience-implementation.md) define the scope. This delivery keeps the desktop focus and the requested exclusions.

## What to review

Open **http://127.0.0.1:5176/** for the production-mode review build, or **http://127.0.0.1:5174/** for the development view, while the local servers are running. They use an isolated local database copied from production, with background refresh/snapshot schedules disabled. Existing account credentials work against that local copy. The API is on port 8012. Written AI explanations deliberately use an unreachable local provider endpoint during this review; computed summaries, source inspection and saved findings remain usable.

| Item | Implemented behavior | Suggested walkthrough |
| --- | --- | --- |
| 1 — Metric definitions | Shared spending/comparison/eligibility calculations; inspectable headline receipts with dates, components and source links; explicit dividend date boundaries. | Open **About this number** on Overview or Spending. Inspect included/excluded months, then open its source. |
| 3 — Monthly update | Explicit review states, three feed confirmations, historical review, one atomic save/undo batch, conflict handling, and preserved drafts during slow saves. | Open Monthly update → Review. Inspect changed rows, save progress, then confirm and close an eligible month. Undo restores the prior review and entries together. |
| 4 — Overview | Independent resource groups, cached refresh/retry, primary wealth chart, upcoming events, actionable review prompts, change summaries and bounded customization. | Reorder/hide a tile or optional card, reload, then reset. A failed optional feed leaves independent figures visible. |
| 5 — Assistant | Computed review/spending/pace summaries, clickable dated figures, captured chart questions, shared reading panel, bounded provider recovery and explicit saved findings. | Explain a chart selection; inspect a cited figure and return with Back. Save a finding, then reopen it from a fresh browser session. |
| 6 — Projection | Assumptions beside chart/outcomes, explicit source and horizon labels, milestone window, separate historical trend, and today's/future-dollar display. | Change a contribution, pin the result, then toggle display dollars. Dates/probabilities stay fixed; monetary paths, bands, target, table and export transform together. |
| 7 — Chart interactions | Pin/inspect, accessible table actions, shared detail panel, resize, expand, reset zoom and coordinated exports. | Select → inspect → expand → export → close. The same chart instance retains its zoom/legend context. |
| 8 — Page organization | URL-addressable local views across the existing pages; unopened secondary content mounts on demand and visited editors retain drafts. | Follow a legacy holding, lot, profile or tax what-if link, change views, then use browser Back. |
| 10 — Allocation | Five dimensions, explicit classification/price coverage, unknown exposure, editable classifications, owner-specific draft/active targets and drift, plus separate held/unvested employer exposure. | Portfolio → Allocation. Inspect an unknown slice, save a draft target, activate a 100% set, then compare dollar and percentage-point drift. |

The exact eight-page view and legacy-link matrix is in the [chart/task-view review](2026-09-12-chart-and-task-view-review.md). Spending additionally has Overview, Trends, Budgets and History; Projection has Planning and Historical trend.

## Financial presentation changes

These changes preserve the underlying financial entries. They intentionally change some labels, comparison windows and planning eligibility.

| Before | Now | Effect |
| --- | --- | --- |
| A generic spending total could include living costs, tax and transfers. | **Living spending**, **Tax paid from take-home**, **Transfers**, **Cash outflow**, and **All category entries** are separate. | A tax payment or transfer is no longer presented as a lifestyle-spending increase. CSV/table output retains the raw sum and the separate components. |
| A partial current month could influence favorable comparisons or planning defaults. | Completed months and explicitly designated eligible history feed retrospective metrics. | Incomplete periods remain visible without silently reducing the benchmark. |
| Baselines could include the focused month or span older entries across calendar gaps. | Comparison uses eligible months in the preceding 12 calendar months, with dates/counts. | Missing periods reduce the count; the selected month cannot lower its own comparison. |
| Saving entries implicitly looked similar to completing a month. | Saving progress and closing a reviewed month are distinct actions. | Corrections invalidate stale closure; explicit zero remains different from missing input. |
| Automatic dividend records could read as payment-date cash received. | Automatic records identify ex-date; recorded/manual entries and scheduled estimates carry their own date basis. | Dates and income boundaries stay inspectable without rebuilding dividend history. |

For example, entries of $300 living costs, $35.01 tax and $100 transfers retain a raw total of $435.01; the new primary living figure is $300 and cash outflow is $335.01. This is an illustrative fixture, not a rewrite of historical records. Savings and projection defaults use their documented matched-month windows, so their results can change when an incomplete month stops contributing.

## Validation

- Full frontend regression: **2,843 tests passed**, zero failed/skipped. **194 final focused tests passed** for the assistant/profile/formatting integration.
- Full backend regression: **2,015 passed, 1 skipped**, exit 0, in 50m25s. The skip is the existing Windows symlink-permission guard in the snapshot-store test. Late undo/context integration also passed **46 month/Activity tests and 45 context/evidence tests**. Final Ruff lint and formatting are clean across all 318 backend files.
- TypeScript and production asset build pass. Final full ESLint: **0 errors, 24 Fast Refresh advisory warnings**.
- All **13 routes** were exercised at desktop sizes. The 39-route light/comfortable, dark/compact and light/compact matrix had no horizontal page overflow and no browser errors. Dark/comfortable walkthroughs and 1600/1920-pixel checks supplement that matrix.
- All **13 routes** also passed against the final production-mode static build, with no browser/API errors or page overflow.
- Allocation/Projection/Spending browser interactions: **11/11 passed**, with zero JavaScript/API errors. A separate local write-and-undo exercise passed **5/5** and restored original target/classification records.
- Monthly close was one atomic PUT; the review gates, closed state and Activity undo were verified against the local API. Deferred-response regressions cover month switches, newer drafts and stale conflicts.
- All three standard assistant summaries remained useful with the provider unavailable; known references opened evidence, findings reopened after reload, chart selections launched captured questions, and logout removed nested financial details. A separate fresh browser context verified that unsaved conversations did not carry over while saved findings remained available.
- Keyboard/table inspection, focus return, overlay containment, panel Back, chart instance retention, task/deep-link navigation, owner changes, incomplete/zero/history/corrected months, stale responses and failed feeds have targeted regression coverage.
- Saved evidence is checked against changed source data in `test_saved_finding_is_owner_scoped_and_immutable`; restore tests preserve evidence dates and remap authenticated ownership. Historical Paycheck questions capture the displayed profile rather than silently using the current profile.

The browser provider check exercises failure recovery without transmitting financial data to an external AI service. Successful provider narrative, reference validation/repair, silent-provider deadlines, fallback limits and cancellation are covered with deterministic server fixtures. A live external provider response has not been validated in this local run.

### Observed request behavior

The baseline checkout and implemented frontend were both built in production mode and served locally through Vite preview, using the same API and migrated database, Chrome at 1600 × 1000, and a fresh browser context per run. Each timing median uses three observations after a discarded warm-up. Other local verification was running; these measure local behavior, not remote production-server latency.

| Overview measurement | Baseline | Implemented |
| --- | ---: | ---: |
| Initial GET requests, including shell | 18 | 20 |
| Duplicate GETs to the same URL | 1 | 1 |
| Median time to first wealth figure, normal response | 1.34 s | 0.76 s |
| Median time to first wealth figure, tax summary delayed 4 seconds | 4.52 s | 0.66 s |
| Tax summary returns 503 | Main figures unavailable | Wealth, portfolio, spending and agenda remain visible |

Normal observed ranges were 1.09–2.64 seconds before and 0.59–0.80 seconds after. The new build reads two additional distinct resources for review/evidence. A separate development-mode comparison showed 35 → 20 GETs and 3.62 → 0.88 seconds median; its larger request reduction comes from deduplicating development Strict Mode's repeated effects. The production-mode count above is the more relevant release comparison.

The initial JavaScript entry increased from 322.37 KB to 344.20 KB, or 103.17 KB to 109.68 KB compressed. The additional review/panel functionality therefore costs roughly 6.5 KB compressed; the benefit measured here is earlier independent content and resilience to slow/failing feeds, not a smaller payload.

For the deliberately unavailable assistant provider, first computed summaries appeared in 0.35–1.35 seconds in the recorded local run. Provider recovery finished later, in roughly 12.5–17.4 seconds, while those summaries stayed readable.

### Migration and restore evidence

All three new migrations were applied to a restored local production copy, reaching **`f12026091203`**:

1. `f12026091201`: month review and adoption metadata.
2. `f12026091202`: security classifications and allocation targets.
3. `f12026091203`: saved assistant findings.

Hash comparison of every original column and row in **40 existing database tables** found no changes from migration. Subsequent interactive checks deliberately wrote only to the local review copy.

A current-version snapshot was then restored into a newly created, fully migrated local scratch database using the real dry-run/apply/verify CLI. Verification returned **`PASS: 41 tables identical`**, exit 0. This snapshot included review/adoption metadata and a saved finding. The integration suite separately covers nonempty allocation targets, preferences and classification/owner restoration.

Private evidence remains outside Git:

- `%TEMP%\finance-experience-review`: desktop screenshots, browser reports, performance observations, frontend reports/build logs; `index.html` provides a local screenshot gallery.
- `%TEMP%\finance-review-allocation-projection`: additional interaction and reversible-write evidence.
- `%TEMP%\finance-review-baseline.dump` and `finance-review-baseline-hashes.json`: pre-migration local copy and original-column hash manifest.
- `%TEMP%\finance_experience_roundtrip_20260912_112153`: current-version snapshot and complete restore-drill logs. Snapshot SHA256: `14095424140ec41bcee0fe6310ec3ac3310b84257c03b0cdbdda163972b8d2f0`.

## Local build and release preparation

The build requires Node 20+; this delivery used Node 22.14.0 and Python 3.12. From the repository, `npm run build` performs TypeScript checking and builds `dist/`. The current local preview uses Vite with `VITE_API_PROXY=http://127.0.0.1:8012`; its backend explicitly targets local database `finance_review` on port 5433. Background schedules and external AI calls are disabled for that instance.

The existing [deployment runbook](../../README.md) remains the operational reference. Production deployment requires the separate release decision specified in the approved plan. No deployment, push, merge, production migration, or production cleanup was performed here.

Once a reviewed release commit is separately authorized:

1. Confirm the intended commit, a clean server checkout and the running frontend/backend image IDs. Preserve the previous images and code revision. The server checkout is `/home/ubuntu/personal-finance-dashboard`; PostgreSQL runs on the host.
2. Take an identifiable **pre-upgrade host PostgreSQL custom-format dump** of database `finance`, record its path/time/SHA256 and confirm `pg_restore --list` can read it. Use a maintenance window that prevents edits across the release boundary. The retained local audit dump does not replace a fresh release backup.
3. Check out the approved commit and run `BUILD_HASH="$(git rev-parse --short HEAD)" docker compose -f docker-compose.prod.yml up -d --build`. The backend startup script runs `alembic upgrade head` before serving; inspect health and migration output before reopening writes.
4. Verify `/api/v1/health`, database head `f12026091203`, the visible build identity, headline/receipt parity, a month save/close/undo, owner-specific allocation targets, and assistant computed evidence. Run the README shell-cache checks for new route assets.
5. Create the new application baseline with authenticated **`POST /api/v1/system/snapshots`**. Expect HTTP 201, `alembic_head: f12026091203`, and `restorable: true`. Download a current-version archive with authenticated **`GET /api/v1/export/snapshot`**.
6. Restore that archive into an isolated scratch database through the documented restore drill. Expect `PASS: 41 tables identical`. Record the new baseline and retain the pre-upgrade dump and previous application images through release acceptance.

Current-version local restore commands, with `DATABASE_URL` explicitly pointing to a disposable scratch database, are:

```text
python -m app.lifecycle restore <snapshot.zip> --dry-run
python -m app.lifecycle restore <snapshot.zip>
python -m app.lifecycle verify <snapshot.zip>
```

The dry run must report compatible schema and no errors. Apply creates a pre-restore point atomically. The UI/API equivalent previews via `POST /api/v1/import/snapshot?dry_run=true`, multipart field `file`; applying uses explicit `dry_run=false`.

If a release smoke check fails, stop new writes and preserve the failing state/logs. For an application-only problem, restore the recorded previous image/code pair with the additive schema retained, then verify health and reads. Previous-version application snapshots do **not** match the new snapshot schema. If database restoration is necessary, first restore the pre-upgrade PostgreSQL dump into a separate database and verify it before switching services; restoring that backup discards changes made after its capture. Do not drop the new metadata tables or run destructive downgrades as an automatic rollback step.

Remaining product boundaries are deliberate: unclassified fund exposure stays unknown, unpriced assets remain visible as incomplete coverage, historical periods are not claimed as reviewed, and future-dollar display does not modify the financial model. External provider availability and production latency remain release-environment checks.
