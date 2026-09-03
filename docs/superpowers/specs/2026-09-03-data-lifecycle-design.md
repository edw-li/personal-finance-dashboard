# Data lifecycle — design

**Date:** 2026-09-03
**Status:** draft for the overnight run (recommendations pre-approved by the owner)
**Source:** `docs/superpowers/specs/2026-09-02-fresh-eyes-dashboard-audit.md` §4 (friction 11–12, 17;
ideas 6–8, 10, 17), §13 T11, post-fix ranking item 14; the shell spec's deferral of server-side
preferences (`2026-09-03-shell-grammar-design.md` §2, §17). Fifth of the five polish/feature specs;
runs as a lane parallel to Calendar and Planning sandboxes once the shell has merged.

## 1. Context and goals

Production holds a 12.7 MB database backed up nightly by a host cron (`backend/scripts/backup_db.sh`:
`pg_dump | gzip | gpg` to an OCI bucket, 30-day retention, 108 KB last night) and exportable on demand
as a ZIP (`GET /export/snapshot`: `manifest.json`, one CSV per table, `finance-export.json`). Both are
one-way: nothing in the app reads the ZIP back, the only restore is `psql` on the box (README §5.5),
and no run has ever proved a backup restores — "Last backup" means "the upload returned". Every write
is fire-and-forget: a month delete says "This cannot be undone", an import report evaporates with the
React state that held it, and nothing records what changed when. Preferences live in `localStorage`
by tonight's shell decision, so a second browser starts dark, comfortable and unscoped.

Goals: a backup that is verified, not merely uploaded; a restore path through the app's own export
with a dry-run diff; a record of every money-bearing write with undo where it is cheap; preferences
that follow the account; a health view that names production's data problems (a zero-filled
September) with a one-click repair.

## 2. What exists and what is new

| Area | Shipped (2026-08-31 tier-1 B1–B3, 09-03 shell) | New in this spec |
|---|---|---|
| Export | `GET /export/snapshot` ZIP, table list pinned to `Base.metadata`, assistant key redacted | Builder becomes a service; nightly stored snapshots with retention; `user_preferences` joins the list |
| Restore | none (README `psql` recipe) | `POST /import/snapshot` dry-run/apply from an upload or a stored file; schema gate; automatic restore point; round-trip test; drill |
| Backup | cron script, encryption, `backup_status` + `backup_runs`, System card rows, Overview nag | Verify phase into a scratch database; marker gains `verified`, `size_bytes`, `encrypted`; "Snapshot now" |
| Month delete | both `DELETE /…/months/{month}`, wizard arm-and-confirm | Undo via the change log |
| Writes | none | `change_log` batches, Activity card, toast Undo, stored import/restore reports |
| Prefs | `finance.theme`, `finance.density`, `finance.scope`, palette recents in `localStorage` | `user_preferences`, `GET/PATCH /prefs`, reconciliation rule, `landing_page` |
| Health | `GET /coverage`; backup-age nag | `GET /system/health` checks with repair links; Data health card |

## 3. Decisions

| Decision | Choice |
|---|---|
| Where the physical backup lives | The host cron (§4, approach B); the app **observes and verifies**, never dumps |
| Second backup path | Nightly **logical snapshot** (the export ZIP) written by the in-app scheduler to a data volume, keep 14; restorable from the UI |
| Restore semantics | Replace the exported tables in one transaction; `users`, `alembic_version`, trails and five operational `app_settings` rows preserved; schema head must match |
| Change capture | Application-level service called from an explicit list of write paths, not triggers (§9) |
| Undo | Inverse replay of one batch, allowed only while no later batch touched the same rows; the undo is itself a batch |
| Preferences storage | `user_preferences (user_id, key)` table with per-key `updated_at`; not JSONB on `users` |
| Browser vs server | First paint from `localStorage` as tonight; server seeds from the browser when it has no value, wins when it has one; every change writes both |
| Settings placement | Four new cards (Backups & snapshots, Restore, Activity, Data health) with palette anchors; the Settings sections-and-rail IA stays deferred |
| Migrations | One revision, authored before the lanes fork (§12), chained on `b8e4d17c2a90` |

## 4. Central question: where does backup orchestration live?

**A. In-app scheduler job runs `pg_dump`.** One status surface, "Back up now" for free, works on dev.
Costs: the image (`python:3.12-slim`, Debian bookworm) ships `postgresql-client` 15, which refuses a
16 server, so the Dockerfile grows the PGDG apt repo; the `OCI_*` secrets and boto3 move into the
container; backups now depend on the app being up — a deploy that fails its healthcheck stops them
on the night you most want one.

**B. Host cron as today, plus a verify phase and a richer marker; the app reads.** No new
infrastructure, backups independent of app health, secrets stay in `.env`. Costs: the app cannot
trigger a dump; verify needs the `finance` role to `CREATEDB` (one documented `ALTER ROLE`); shell is
tested by hand on the box.

**C. Manual only, strong restore tooling.** Rejected: an unattended box needs unattended backups, and
a browser download is not off-site.

**Pick: B, plus the logical snapshot.** The cron keeps the physical, schema-agnostic dump that survives
any app state; the app gains what pg_dump cannot give it — a snapshot it can *read back* without shell
access — by scheduling its own export to a volume. The dump is disaster recovery; the snapshot is the
undo button for bad days. "Snapshot now" is the on-demand backup the tier-1 spec declined for want of
`pg_dump`, delivered without it.

## 5. Scope

**In:** the five capabilities of §7–§11; one migration; `settings.data_dir` + a named volume in
`docker-compose.prod.yml`; `backup_db.sh` verify phase; `restore_drill.sh`; README §5/§7 updates; four
Settings cards; Appearance card additions; toast Undo in the wizard; palette sections.

**Out:** mobile; transaction-level spending; XIRR; month lock/close; retention or purge of
`price_history`/`portfolio_value_history` (36 tickers × ~250 bars/yr is ~9k rows — not a problem
this decade); Settings sections/rail IA; the app-wide coverage-honesty rendering (T1 — the honesty
spec consumes `/system/health`); live cross-device push of preferences; undo for the roster delete
flows outside the listed write paths; any new service on the box beyond a Docker volume.

## 6. Architecture and module map

```
backend/app/models/lifecycle.py          ChangeLog · LifecycleRun · UserPreference
backend/app/services/snapshot.py         build_snapshot_zip · json_cell · EXPORTED_TABLES (moved)
backend/app/services/changelog.py        ChangeBatch · undo_batch · row_image
backend/app/services/health_checks.py    run_checks(db, env)
backend/app/services/prefs_registry.py   key → value model + default
backend/app/services/snapshot_store.py   data_dir · write · list · retention · restore points
backend/app/lifecycle/restore.py         load_snapshot · plan · apply → RestoreReport
backend/app/lifecycle/__main__.py        CLI: restore <zip> [--dry-run] · verify <zip>
backend/app/api/import_.py               + /import/snapshot, /import/snapshot/stored/{name}
backend/app/api/activity.py              /activity · /activity/batches/{id}/undo
backend/app/api/prefs.py                 /prefs · /prefs/{key}
backend/app/api/health.py                /system/health
backend/app/api/system.py                + /system/snapshots · BackupStatusOut fields
backend/app/services/scheduler.py        + snapshot_nightly job with catch-up
backend/scripts/backup_db.sh             + verify phase, marker fields
backend/scripts/restore_drill.sh         scratch-database drill (§13)
src/prefs/prefsStore.ts                  local mirror · server sync · per-key dirty tracking
src/api/prefs.ts · src/api/lifecycle.ts  fetchers
src/components/settings/                 BackupsCard · RestoreCard · RestoreReportView · ActivityCard · HealthCard
```

Modified: `api/export.py` (thin over the service), `api/net_worth.py`, `api/spending.py` (batches,
`batch_id`, `X-Change-Batch`), `config.py`, `main.py`, `docker-compose.prod.yml`, `ThemeProvider.tsx`,
`useScope.ts`, `CommandPalette.tsx`, `paletteRegistry.ts`, `AppearanceCard.tsx`, `SystemCard.tsx`,
`SettingsPage.tsx`, `MonthlyUpdatePage.tsx`, `App.tsx`, `api/client.ts` (invalidation: `/prefs` →
`shell`; `/activity`, `/import` → all), `types/api.ts`, `overview/attention.ts`.

### Migration `20260904_0900_c3a7e19d5b42_lifecycle_tables.py` (revises `b8e4d17c2a90`)

- `change_log(id bigserial pk, at timestamptz not null default now(), batch_id uuid not null,
  source varchar(12) not null, actor varchar(255), label text not null, table_name varchar(60)
  not null, pk jsonb not null, op varchar(6) not null, before jsonb, after jsonb, month date)`;
  indexes on `(batch_id)`, `(at desc)`, `(table_name, at desc)`, `(month)`. `op ∈ insert|update|
  delete|batch`; `source ∈ ui|import|restore|scheduler|repair|undo`.
- `lifecycle_runs(id serial pk, at timestamptz, kind varchar(16), dry_run bool, ok bool, actor,
  filename text, size_bytes bigint, report jsonb, error text, batch_id uuid)`; `kind ∈ import_xlsx|
  restore|snapshot|restore_point|undo`.
- `user_preferences(user_id int fk users on delete cascade, key varchar(60), value jsonb not null,
  updated_at timestamptz not null, primary key (user_id, key))`.
- Export pin: `user_preferences` joins `EXPORTED_TABLES`; `change_log` and `lifecycle_runs` join
  `EXCLUDED_TABLES` with the rationale "operational trails — a restore must be recorded in them, not
  replaced by them". Downgrade drops the three tables. If the shell lanes merge after this lane,
  re-chain before deploy, never after (README §4.3).

## 7. Restore from the app's own snapshot

**Routes.** `POST /import/snapshot?dry_run=true` (multipart `file`, ≤ 15 MB like the workbook;
nginx's 20 MB cap suffices for a ~2 MB ZIP) and `POST /import/snapshot/stored/{name}?dry_run=true`
(a file from §8's store). Both return `RestoreReport`:

```
{ dry_run, applied, schema: { snapshot_head, server_head, compatible },
  tables: { <name>: { current, incoming, identical } },   // identical = same canonical CSV sha256
  preserved_settings: [..], warnings: [..], errors: [..],
  restore_point: "<filename>|null", batch_id: "<uuid>|null", run_id }
```

**Reading.** Only `finance-export.json` is read (the CSVs are for humans); `manifest.json` supplies
`alembic_head` and the table list. Validation, in order: not a ZIP or missing either file → 400
"Not a snapshot ZIP from this app"; table set ≠ `EXPORTED_TABLES` → 422 naming the extra or missing
table; `alembic_head` ≠ server head → 409 "This snapshot was exported at schema `<x>`; this server
runs `<y>`. Restore it on a server at `<x>`, or use the nightly database dump." (both `None` on a
create_all schema counts as equal); a file column the model lacks → 422 naming it; a model column the
file lacks → the column default, listed under `warnings`. Values parse with the export's spellings —
`json_cell` and its inverse live side by side in `services/snapshot.py` so they cannot drift.

**Dry run** computes `tables` (counts, and identity by hashing incoming rows through the same CSV
writer as the current ones) and writes nothing.

**Apply**, one transaction: (1) `write_restore_point` — the current database's ZIP to
`<data_dir>/restore-points/pre-restore-<UTC stamp>.zip`, keep three, recorded as a `restore_point`
run; a failure aborts before any write. (2) Read `RESTORE_PRESERVED_SETTINGS = {assistant key,
backup_status, backup_runs, refresh_runs, last_refresh}` — a snapshot never carries the key
(redacted) and the markers describe *this* server's backups. (3) `TRUNCATE <exported tables> RESTART
IDENTITY CASCADE`, one statement. (4) Insert in `Base.metadata.sorted_tables` order restricted to the
exported set (people before accounts — the export's own order is not FK-safe); a self-referencing
table (`accounts.parent_account_id`) inserts with that column nulled and gets one UPDATE after.
Primary keys are kept; `user_preferences.user_id` is rewritten to the caller's id. (5) `setval(
pg_get_serial_sequence(t,'id'), max(id))` per identity table. (6) Re-insert the preserved rows. (7)
Commit; one `change_log` row (`op='batch'`, `source='restore'`, `after={counts}`) and a `restore` run
holding the report. Any exception rolls back → 500 "Restore failed and nothing was changed"; the
restore point remains listed.

**Never touched:** `users` (the session survives), `alembic_version`, `change_log`, `lifecycle_runs`.
`seed.py` at the next boot is insert-only on an empty `people` table and never fights a restore.

**UI — Restore card** (`id="restore"`): file picker or "Choose a stored snapshot" select fed by
`GET /system/snapshots`; **Dry run** → `RestoreReportView` (differing tables first, identical ones
folded under "N tables unchanged", warnings, the schema line); **Restore** arms only from a clean dry
run of the current selection plus the snapshot's date typed (`YYYY-MM-DD`, the month-delete arm
pattern); the confirm sentence names the restore point. Success toasts "Restored snapshot from Sep 2
— other pages reload on their next visit"; the `/import` mutation path already invalidates every
snapshot cache. Errors render through `FeedBanner` with the router's sentences verbatim.

**CLI.** `python -m app.lifecycle restore <zip> [--dry-run]` and `verify <zip>` (counts and hashes
against the live database) mirror `app.importer`'s CLI, exit codes 0/1/2, and feed the drill (§13).

## 8. Backups: verified dump, nightly snapshot, System card

**Script verify phase** (`backup_db.sh`, after the upload): `createdb finance_verify_$$` (README
gains `ALTER ROLE finance CREATEDB;`), `gpg -d | gunzip | psql -v ON_ERROR_STOP=1 -q` into it, compare
three counts (`net_worth_snapshots`, `monthly_spending`, `position_transactions`) with the live
database's at dump time, `dropdb`. The marker becomes `{last_success_at, object_key, size, size_bytes,
encrypted, retention_days, verified, verified_at, row_counts | verify_error}`; the run entry gains
`verified`. New fields are `Optional` in `BackupStatusOut` so last night's marker still parses. A
verify failure keeps `ok: true` for the upload, `verified: false` with the error, exit code 0 so
retention still runs.

**Nightly logical snapshot.** `scheduler.py` adds job `snapshot_nightly` (`30 23 * * *`
America/Los_Angeles, `coalesce`, `max_instances=1`, the existing `missed_todays_run` catch-up keyed on
the newest `snapshot` run). It calls `build_snapshot_zip`, writes `<data_dir>/snapshots/
finance-export-YYYYMMDD-HHMM.zip`, trims beyond the newest 14, purges `change_log` rows older than 400
days, and records a `snapshot` run. `settings.data_dir` defaults to `./data` (gitignored); prod mounts
`finance-data:/data` with `DATA_DIR=/data` — a two-line compose change; `settings.snapshot_enabled`
mirrors `scheduler_enabled` (off in tests).

**Routes.** `GET /system/snapshots` → `[{name, at, size_bytes, alembic_head, restorable}]` newest
first (`restorable` = head equals the server's). `POST /system/snapshots` writes one now and returns
its entry (rate-limited to `AUTH_ATTEMPT`'s 10/minute; a full ZIP takes ~200 ms on 12.7 MB).

**UI.** `SystemCard`'s backup row reads "Sep 3, 03:00 UTC · 108 KB · encrypted · verified" (or
"· **not verified** — {verify_error}" in the overdue tone; colour is never the only channel). The
**Backups & snapshots** card (`id="backups"`) lists the nightly files with size and age, a
**Restore…** link that pre-selects the file in the Restore card, **Snapshot now**, and **Download
snapshot (.zip)** (moved here from the System card). `attention.ts` appends "and last night's was not
verified" to the existing prod-only nag when `verified === false`; a dev box never nags, as today.

## 9. Change log, Activity, Undo, run history

**Capture.** `ChangeBatch` is request-scoped (`Depends(change_batch)`): routers call
`batch.record(table, pk, before, after, month=)` with images from `row_image(obj)` (the export's
`json_cell` spellings), set `batch.label` ("Saved Sep 2026 balances — 19 updated"), and the
dependency flushes the rows in the same transaction before the router's commit. Triggers were
considered — they catch every writer including `psql` — but the test schema is `create_all`, not
Alembic, so trigger DDL would need a metadata `after_create` hook to exist in tests, and a trigger
cannot know the label or the month. An explicit service on an explicit list is the testable choice
for a single-user app.

**Logged paths (hand-maintained, pinned by a test that greps the routers):** net-worth month PUT
(changed balances and a created snapshot only) and DELETE; spending month PUT/DELETE (rows and
cashflow); accounts and categories POST/PATCH/DELETE; budgets PUT/DELETE; the health repair (§11).
Importer apply, restore and undo write one `op='batch'` summary row each; `run_import` now writes a
pre-import restore point before applying, so "This cannot be undone" leaves the import card too.
Scheduler writes (prices, dividends, value history) are derived data with their own run trail and
are not logged.

**Routes.** `GET /activity?limit=50&before=<id>` → batches newest first, `{batch_id, at, source,
actor, label, month, rows, undoable, undone_by}`, interleaved with runs `{run_id, at, kind, ok,
dry_run, filename, size_bytes, has_report}`; `GET /activity/runs/{id}` → the stored `ImportReport` or
`RestoreReport`; `POST /activity/batches/{batch_id}/undo` replays inverses in reverse order in one
transaction (insert → delete, update → set `before`, delete → insert `before`), records a new batch
(`source='undo'`, label "Undid: <label>") and returns it. Refusals, all 409: `source` outside
`ui|repair` or no row-level entries → "This change is a summary and cannot be undone — restore a
snapshot instead"; a later batch touched any of the same `(table_name, pk)` → "Later changes touched
these rows — undo those first"; already undone. `MonthUpsertResult` and `SpendingUpsertResult` gain
`batch_id`; the month DELETEs stay 204 and add an `X-Change-Batch` header the client reads.

**UI.** The wizard's save and delete toasts gain `action: { label: 'Undo' }` (the existing 6 s toast
with hover-pause): "Saved Sep 2026 — 19 balances updated · Undo"; "Deleted Sep 2026 — balances and
spending removed · Undo" (undo fires the spending batch, then the balances batch, then navigates back
to that month). The **Activity** card (`id="activity"`) lists the last 50 entries with relative time,
label, source pill, **Undo** on undoable batches (arm-on-click, not typed — an undo is itself
reversible), **View report** for runs, and **Load more**. Undo errors surface in the card's
`FeedBanner` verbatim.

## 10. Server-side preferences

**Registry** (`prefs_registry.py`; unknown key → 422 "Unknown preference `<k>`", wrong shape → 422
naming the key): `theme ∈ system|dark|light`, `density ∈ comfortable|compact`, `scope = {owner:
all|joint|<person id>, range: all|1y|ytd}`, `palette_recents: string[≤8]`, `landing_page` ∈ the
`NAV_ITEMS` paths (default `/`). Only keys with a consumer are registered; the audit's other
candidates (currency style, liability sign, fiscal-year start) wait for their consumers.

**Routes.** `GET /prefs` → `{ prefs: { <key>: { value, updated_at } } }` (registered keys only,
absent when unset); `PATCH /prefs` with a partial `{ <key>: value }` → the same shape after the
upsert; `DELETE /prefs/{key}` → 204, resets to default. Rows are per `(user_id, key)`.

**Reconciliation** (`prefsStore.ts`; the `localStorage` keys keep their names, so nothing is lost on
deploy): (1) first paint from `localStorage` exactly as tonight — `ThemeProvider`, `useScope` and the
palette read through `prefs.get(key)`, which reads the same keys; (2) after `/auth/me` succeeds,
`GET /prefs` once per session (snapshot key `shell:prefs`); (3) per key: server absent and local
present → PATCH the local value up (the browser seeds the account); server present → adopt it into
local and live state, unless the user changed that key this session before the response (per-key
`dirtySince`), in which case the local value is PATCHed up; (4) every later change writes local
synchronously and PATCHes debounced 400 ms per key; a failed PATCH retries on the next change or
session and is never surfaced; (5) two devices: last writer wins by server `updated_at`, picked up at
the other device's next session start; (6) logout keeps local prefs, matching today. `App.tsx`
redirects `/` to `landing_page` when set and not `/`.

**UI.** The Appearance card gains **Landing page** (a `Segmented`/select over the nav) and one line
"Synced to your account" once `/prefs` has answered. No new card.

## 11. Data health checks

`GET /system/health` → `{ checked_at, checks: [{ id, severity: ok|info|warn|error, title, detail,
count, months?: [..], fix?: { kind: 'link'|'action', to?, action?, label } }] }`, computed in
`health_checks.py` from one query per check:

| id | Condition | Severity | Fix |
|---|---|---|---|
| `zero_filled_spending` | months whose `monthly_spending` rows are all 0 with no `monthly_cashflow` row | error | action → `DELETE /spending/months/{m}` (logged `source='repair'`, undoable) |
| `balances_without_spending` | balance months without spending rows in the last 12, excluding the current | warn | link `/update?month=&step=spending` |
| `spending_without_balances` | the inverse | warn | link `/update?month=&step=balances` |
| `stale_quotes` | active non-manual securities with `quoted_at` older than 4 days (`STALE_QUOTE_DAYS`, twin of `staleness.ts`) | warn | link `/portfolio` |
| `identical_snapshot` | the latest two months' balances are byte-identical | info | link `/update?month=` |
| `backup` | marker absent / older than 48 h / 7 d / `verified === false`, prod only; dev reads info "Backups are not configured here" | warn→error | link `#backups` |
| `snapshot` | newest stored snapshot older than 36 h (when `snapshot_enabled`) | warn | action `snapshot:now` |

The **Data health** card (`id="health"`) lists non-`ok` checks with their fix; the repair action arms
on click, runs, toasts with Undo, and refetches. Production today would show one error (nineteen
`$0.00` September rows) and one warning (August without spending) — the audit's phantom month, named
and fixable in two clicks. App-wide coverage rendering stays with the honesty spec.

## 12. Rollout

**Phase 0 — base (serial, one agent, ~1 h) on branch `lifecycle-base`:** the three models, the
migration, `services/snapshot.py` extraction with `export.py` thinned over it, export-pin updates,
`settings.data_dir`/`snapshot_enabled`, compose volume, `.gitignore` for `backend/data/`. Tests: model
round-trips, export pin, export output byte-identical to before the extraction. Lanes fork here.

**Phase 1 — six parallel lanes, each a worktree:**

| Lane | Work | Test DB / notes |
|---|---|---|
| L1 backend | `lifecycle/restore.py`, snapshot routes on `import_.py`, CLI, restore points, preserved settings, round-trip test | `FINANCE_TEST_DB=finance_test_l1` |
| L2 backend | `changelog.py`, router hooks + `batch_id`/header, `activity.py` undo, `lifecycle_runs` + pre-import restore point on import apply | `finance_test_l2`; touches `net_worth.py`, `spending.py`, `importer/service.py` |
| L3 backend | `prefs.py` + registry; `health.py` + `health_checks.py` | `finance_test_l3` |
| L4 backend + ops | `snapshot_store.py` + scheduler job, `GET/POST /system/snapshots`, marker fields, `backup_db.sh` verify, `restore_drill.sh`, README | `finance_test_l4`; touches `scheduler.py`, `system.py` |
| F1 frontend | `BackupsCard`, `RestoreCard`, `RestoreReportView`, `SystemCard` fields, `api/lifecycle.ts`, types | mocks the §7–§8 shapes |
| F2 frontend | `ActivityCard`, wizard Undo toasts, `X-Change-Batch` in the two fetchers; `prefsStore.ts` + `ThemeProvider`/`useScope`/palette adoption, Appearance additions, landing redirect; `HealthCard` | mocks the §9–§11 shapes |

Shared files (`main.py` router includes, `SettingsPage.tsx` card mounts, `paletteRegistry.ts`
sections `backups`, `restore`, `activity`, `health`, `client.ts` invalidation rows) are edited by
the coordinator at merge, Plan 3's pattern. Backend lanes run pytest with their own database name;
frontend lanes run from their worktree root with a `node_modules` junction.

**Phase 2 — merge and prove (serial):** whole suites (`pytest`, `tsc -b`, `eslint`, `vitest`); the
drill (§13) against the dev Postgres; browser smoke on the dev stack — dry-run and restore the dev
database's own snapshot (every table identical), save a month and Undo it, run the September repair
on a seeded zero month, switch theme in one browser profile and see it in a second after login;
screenshots to the scratchpad. Local commits only.

## 13. Testing

**Pytest.** Restore: round trip — seed via `build_workbook()` apply plus UI-only rows (budget,
custom event, credit card, a preference), export → A, truncate, restore A, export → B, assert the
`tables` of both `finance-export.json`s and every CSV are equal; dry run writes nothing; head
mismatch 409; foreign ZIP 400; extra/missing table 422; preserved settings survive; restore point
written and trimmed to three; `user_id` rewritten; a new account after restore gets `max(id)+1`; CLI
exit codes. Change log: each listed path writes rows with correct images, labels and months; the grep
pin; undo of a month save, a month delete, an account edit; the three 409s; undo-of-undo. Prefs:
registry validation per key; partial PATCH; DELETE resets; export includes the row. Health: each
check on seeded fixtures; the repair logs `source='repair'`. Snapshots: job writes, trims to 14,
records runs, catches up a missed day; `POST` rate limit; `BackupStatusOut` parses old and new
markers. The scheduler stays off in tests as today.

**Vitest** (`afterEach(cleanup)` house rule): RestoreCard arm/disarm and report folding; BackupsCard
list and "Snapshot now"; ActivityCard undo and report view; wizard toasts carry Undo and call both
undos in order; `prefsStore` — local-first paint, seed-up on an empty server, server-wins otherwise,
dirty-key exception, debounce, silent failure; landing redirect; HealthCard repair; SystemCard
verified/unverified wording.

**Restore drill** (`backend/scripts/restore_drill.sh`, run in Phase 2 and documented for the box):
`createdb finance_drill_<date>`; `alembic upgrade head` against it via `DATABASE_URL`; `python -m
app.lifecycle restore <zip>` then `verify <zip>`; PASS/FAIL with per-table counts; `dropdb`. Unlike
pytest's `create_all` schema this exercises the real migrations, sequences and constraints — the
class of bug a JSON round trip on a fresh schema cannot see. On the box, pointed at last night's
decrypted dump, it is README §5.5 made repeatable.

## 14. Out of scope / later, ranked

1. Settings information architecture (sections + rail, `?section=`) — the next polish item once
   thirteen cards exist.
2. Month lock/close — needs enforcement in every write path; the change log makes accidental edits
   recoverable, which removes most of the motivation.
3. Undo for the remaining roster delete flows (securities, cards, people) — extend the logged list.
4. Snapshot restore across schema versions — a compatibility map when a real need appears; the
   dump path covers it today.
5. Derived-cache retention; live pref push; email digests of health checks.

## 15. Risks

- **Restore against the wrong server**: head gate, typed date, automatic restore point; the report
  names the manifest's environment.
- **Data volume absent on prod** until compose is redeployed: the job logs one ERROR and records a
  failed `snapshot` run; the health check shows it; nothing else breaks.
- **Two lanes, one migration chain**: only Phase 0 authors DDL; lanes add no revisions.
- **Change-log hooks missed on a new write path**: the grep pin fails until the path is listed or
  named exempt — the export pin's pattern.
- **Prefs flicker**: first paint stays local; a differing server value lands after `/auth/me`, when
  the shell already re-renders for the signed-in state.

## Summary for the coordinator

1. Backups stay on the host cron; the script gains a verify-into-scratch phase and a richer marker (`verified`, `size_bytes`, `encrypted`).
2. The app adds a nightly logical snapshot (export ZIP) to a Docker volume, keep 14, plus "Snapshot now" — the restorable backup pg_dump cannot give it.
3. `POST /import/snapshot` (upload or stored) restores in one transaction: dry-run diff, head gate, automatic restore point, five preserved `app_settings` rows.
4. An application-level `change_log` on an explicit list of money-bearing writes powers an Activity card and toast Undo; imports and restores write summary rows and pre-apply restore points.
5. `user_preferences` + `GET/PATCH /prefs`: browser paints first, seeds the server when empty, server wins otherwise, both written on change; `landing_page` is the one new key.
6. `GET /system/health` names zero-filled months, coverage gaps, stale quotes and backup state with repair links; the September repair is a logged, undoable delete.
7. One migration (`c3a7e19d5b42` on `b8e4d17c2a90`), authored in Phase 0 before the lanes fork; no lane adds DDL.
8. Six Phase-1 lanes: L1 restore, L2 change log/undo, L3 prefs + health, L4 snapshots/script/drill, F1 backup+restore cards, F2 activity/prefs/health UI; backend lanes on `FINANCE_TEST_DB=finance_test_l<n>`.
9. Coordinator owns the shared files at merge (`main.py`, `SettingsPage.tsx`, `paletteRegistry.ts`, `client.ts`), then runs the suites, the scratch-database drill and the browser smoke.
10. Local commits only; README §5/§7 updated by L4; deploy needs `ALTER ROLE finance CREATEDB` and the compose volume.
