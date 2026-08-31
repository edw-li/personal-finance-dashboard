# Tier 1 batch: trust pass, data lifecycle, tax-engine completeness, planning UI

**Date:** 2026-08-31
**Source:** the 2026-08-31 six-agent fresh-eyes audit (delivered in-chat). This spec covers the
four Tier 1 items the user selected, with four decisions ratified via Q&A:

1. Liability sign handling in the wizard: **warn + one-click flip** (not silent auto-negate,
   not hard reject — a card can legitimately go positive after a refund).
2. Tax fixes apply to **all years, full fix** — historical totals may shift, documented like
   the CA-CG precedent (app-is-right divergences).
3. Export format: **both** — one ZIP containing per-table CSVs, a `manifest.json`, and a
   single nested `finance-export.json`.
4. Execution: **full autonomous batch** — spec + 4 plans, Opus implementer subagents,
   reviewer passes, full pytest/vitest + browser smoke, merge to LOCAL main, never push.

Baseline: branch `tier1-batch` off `main` @ `e57a9bd` (clean). Test baseline at branch time:
run `pytest` / `vitest` once before Plan A to record counts.

---

## Workstream A — Trust pass (numbers that can render wrong)

Seven independent fixes. No schema changes. Each gets a pinned regression test.

### A1. Wizard liability sign: warn + one-click flip
`src/pages/MonthlyUpdatePage.tsx` (balances step). When an account row with
`group === 'liability'` has a committed value **> 0**: render an amber inline cue in that row
("liabilities are entered negative") with a **Flip sign** button that negates the cell value
in place (marks the draft dirty as any edit would). The cue is advisory — Next/Save stay
enabled (ratified: legitimate positives exist). The existing hint line below the table stays.
No server change: the API remains permissive.
Test: positive liability value renders the cue; Flip negates and the cue disappears;
positive value still saves when left unflipped.

### A2. Net-worth legend collision
`src/pages/NetWorthPage.tsx:139-145` merges both charts' legend maps into ONE state object
keyed by series name, so an account literally named "Cash"/"Other"/"Taxable"/"Net worth"
collides with the group series: toggling it in the drill chart silently hides the group in
the stacked chart and shrinks the tooltip's Assets subtotal. Fix: **two separate legend
state objects** (stacked chart's and drill chart's), each fed only to its own chart.
Test: an account named "Cash" toggled in the drill chart leaves the stacked chart's Cash
group and the Assets subtotal untouched.

### A3. Portfolio live ping owner scope
`src/pages/PortfolioPage.tsx:394` computes the live ping from owner-filtered holdings but
plots it at the end of the always-household-wide history series (`/portfolio/history` has no
owner param by design) — selecting a person chip renders a fake cliff. Fix: render the ping
(and its dashed connector and "Live" legend entry) **only when `owner === null`** (the All
view). The performance panel's existing caveat sentence gains a clause: person views omit
the live point because history is household-wide.
Test: owner set → option contains no live/effectScatter series; owner null → ping present.

### A4. Portfolio header staleness styling
`src/pages/PortfolioPage.tsx:428-441`: "prices as of {date}" renders unstyled, and `as_of`
is the OLDEST quote across holdings (`backend/app/api/portfolio.py:629`), so one
manual-priced security pins the header to an ancient date with no cue. Fix (display-only):
apply the same stale treatment Overview uses (`isStaleQuote` from `src/utils/staleness.ts`)
— amber text when stale — and a `title` tooltip: "oldest quote across holdings — newest
{newest date}". The newest clock is the payload's EXISTING `latest_quote_at` field
(portfolio.py:630 — "the NEWEST quote"); no backend change (amended 2026-08-31: the
original "additive as_of_newest" instruction predated discovering `latest_quote_at`, and
the repo's one-definition-two-consumers law says reuse it). No behavior change to `as_of`.
Test: stale oldest quote → amber class + title carries both dates.

### A5. Budget effective-date trap
`src/components/spending/BudgetPanel.tsx:46-48`: the editor defaults `effectiveFrom` to
NEXT calendar month while the meters render the LAST ENTERED month — a first budget saves
successfully and visibly does nothing. Fix: default `effectiveFrom` to the **focused month**
(`matrix.months[monthIndex]`, the month the meters read). Keep the existing hint about
past-dating rewriting history, promoted out of the collapsed `<details>` into the editor row
(one short line). Backend unchanged.
Test: default effectiveFrom equals the focused month; saving with the default makes the
meter appear for that month.

### A6. Spending bars: absent ≠ zero
`src/pages/SpendingPage.tsx:214-220, 258` coerce `null` month values to 0, drawing a $0
stack for a month with no spending entered (tooltip lists every category at $0.00) — while
the CSV correctly emits blanks. Fix: pass `null` through to the series (ECharts gaps the
bar); the tooltip formatter skips null rows (house pattern from
`historyChartOptions.ts:203-230`); the Total line in the tooltip renders only over non-null
categories, and a fully-absent month shows "no spending entered". The 12-month average at
`SpendingPage.tsx:567-568` divides by the count of **non-null** months (a cashflow-only
month no longer dilutes it).
Test: month with net-pay-only → gap not $0 stack; tooltip says no spending entered; 12-mo
average excludes it. CSV output unchanged.

### A7. Savings-rate axis honesty
`src/pages/SpendingPage.tsx:486-489` clamps the y-axis to [−100%, +100%]; a −180% month
silently leaves the frame. Fix: keep the +100% ceiling (rates above 1 are impossible) but
let the floor expand to the data: `min: Math.min(-1, floor(extent.min))`. No clamp marker
needed once nothing is clipped.
Test: a −180% month renders inside the axis.

### A8. Wizard partial-save truth
`src/pages/MonthlyUpdatePage.tsx:386,405,434`: save is two sequential PUTs (balances then
spending); if the second fails the banner claims "nothing was lost — retry" after balances
already committed. Fix (truth-telling, no new endpoint): track which leg succeeded; on a
spending-leg failure the banner reads "Balances saved. Spending failed — Retry saves only
spending." and the Retry button re-attempts **only** the failed leg (state remembers the
balances PUT succeeded until the month reloads). On a balances-leg failure the existing
message stays accurate.
Test: mock spending PUT failure → message names the split; retry issues only the spending
PUT.

---

## Workstream B — Data lifecycle (export, month delete, backup)

### B1. Full data export
New router `backend/app/api/export.py`, mounted at `/api/v1/export` (auth-gated like every
other router; registered in `main.py`).

`GET /export/snapshot` → `StreamingResponse` of a ZIP named
`finance-export-YYYYMMDD-HHMM.zip` containing:

- `manifest.json` — export timestamp (UTC ISO), environment, alembic head (same query the
  system router uses), app version note, and a `tables` map of row counts.
- `csv/<table>.csv` — one RFC-4180 CSV per exported table, columns in model-definition
  order, dates ISO, Decimals as plain strings, booleans true/false, NULL as empty cell.
- `finance-export.json` — `{"exported_at": ..., "alembic_head": ..., "tables": {<table>:
  [row objects...]}}` — same data, nested, for future programmatic re-import.

**Exported tables (all user data):** accounts, net_worth_snapshots, account_balances,
spending_categories, monthly_spending, monthly_cashflow, category_budgets, securities,
portfolio_accounts, position_transactions, dividend_payments, latest_prices, price_history,
security_dividend_events, portfolio_value_history, tax_years, tax_brackets,
tax_input_definitions, tax_inputs, espp_lots, espp_periods, espp_offerings,
paycheck_profiles, comp_events, rsu_grants, credit_cards, card_credits, reward_categories,
reward_rates, credit_limit_events, contribution_limits, custom_events, people, app_settings.
**Excluded:** `users` (password hash; single-user app — nothing else in it worth exporting),
`alembic_version` (the head is in the manifest).

Implementation: iterate a hand-maintained list of (model, table name) pairs — explicit list,
not reflection, so a future table is a conscious addition (test pins the list against
`Base.metadata` so a new table fails the test until listed or excluded). Rows serialized
from model columns. Build the ZIP with `zipfile` into a `BytesIO` (DB is ~12.5 MB; fine),
return with `Content-Disposition: attachment`.

Frontend: `src/api/system.ts` gains `downloadSnapshot()` — a fetch with the Bearer header,
blob → `URL.createObjectURL` → programmatic anchor click (filename from
Content-Disposition). `src/components/settings/SystemCard.tsx` gains a **"Download snapshot
(.zip)"** button beside the backup row, with busy state and error surface via the card's
existing error pattern.

Tests: endpoint 401s unauthenticated; ZIP contains manifest + a CSV per listed table + the
JSON; row counts in manifest match; the metadata-pinning test; a seeded row round-trips
(appears in both CSV and JSON with correct formatting).

### B2. Delete a month
Two new endpoints (mirroring the PUT paths' validation of the month format):

- `DELETE /api/v1/net-worth/months/{month}` — deletes the `net_worth_snapshots` row
  (cascade removes `account_balances`). 404 if the month has no snapshot.
- `DELETE /api/v1/spending/months/{month}` — deletes that month's `monthly_spending` rows
  AND its `monthly_cashflow` row. 404 if neither exists.

Both return 204. The empty-month refusal comment in `net_worth.py:366-373` is updated — its
stated reason ("no delete exists") is now false.

Wizard UI (`MonthlyUpdatePage.tsx`, Review step): when the month exists on the server
(`monthExisted`), render a "Danger" row: **Delete this month** — an inline arm-and-confirm:
a text input "type {YYYY-MM} to confirm" arms the red button; clicking it calls BOTH deletes
(each tolerating its own 404, so a balances-only month still fully clears), clears the
sessionStorage draft for the month, shows a success toast, and navigates to `/update` for
the current month. Ribbon dots and Net Worth/Spending pages reflect the deletion on next
fetch (existing snapshot-cache invalidation on non-GET covers it).

Tests: backend — delete removes snapshot + balances / spending + cashflow, 404 on absent
month, month format validation; a deleted month disappears from timeseries and matrix.
Frontend — confirm arming, both calls fired, draft cleared.

### B3. Backup hardening + run history
`backend/scripts/backup_db.sh`:
- **Encryption:** if `BACKUP_PASSPHRASE` is set (new `.env` var, documented in
  `.env.example`), pipe the gzip through `gpg --symmetric --batch --cipher-algo AES256
  --passphrase "$BACKUP_PASSPHRASE"`, upload as `.sql.gz.gpg`; if unset, keep today's
  plaintext path and print a one-line warning. Retention loop handles both suffixes.
- **History:** the script already upserts `app_settings['backup_status']` (flat JSON). Keep
  that shape (System card reads it) and ADD `app_settings['backup_runs']`: a JSON list of
  the last 10 run records `{at, ok, object, error?}` — append-and-trim in the same psql
  upsert step.

Refresh history (same idea, backend side): `record_refresh_run` in
`backend/app/services/price_service.py:328-365` currently overwrites
`app_settings['last_refresh']`. Keep it; ADD `app_settings['refresh_runs']` — last 10 of
`{at, trigger, updated, failed_count}`.

`GET /system/status` gains optional `backup_runs` / `refresh_runs` lists (degrade to `[]`
on any malformed stored shape — the router's existing posture). `SystemCard.tsx` renders
each as a compact "last 5 runs" line under the existing rows (time + ok/fail + counts).

README: Part 5 gains the passphrase setup + a restore line for `.gpg` dumps
(`gpg --decrypt | gunzip | psql`); also fix the stale §4.2 claim that cron changes need a
backend restart (they hot-apply — `app_settings.py:141`), since we are editing that file
anyway. **"Run backup now" is deliberately out of scope:** the backend container has no
pg_dump and the cron owns the OCI path; the snapshot download (B1) is the on-demand backup.

Tests: script is shell — validated by hand on the box (README note); backend — runs lists
append, trim at 10, degrade to [] on garbage; SystemCard renders runs.

---

## Workstream C — Tax engine completeness (full fix, all years)

All changes land in `backend/app/services/tax_service.py` + one guarded data migration +
one importer translation + the safe-harbor block in `backend/app/api/taxes.py`. The golden
suite (`backend/tests/test_tax_service.py`) is UPDATED, not loosened: every golden that
moves gets a comment deriving the new value, in the CA-CG precedent's style. The engine's
"sheet-faithful" docstrings are updated to name these as deliberate divergences.

### C1. MAGI helper (one definition, three consumers)
New `_magi(value) = _federal_agi(value) + cg_amount` where the CG netting logic
(currently inline at `compute_breakdown` rows 118-120) is extracted into a shared
`_cg_amount(value)` helper used by: `compute_breakdown` (state AGI + federal CG stack —
unchanged results), the NIIT computation (C2), and `derive_suggestions`' SALT phase-down
(which currently tests plain `_federal_agi`, understating MAGI in CG-heavy years —
`tax_service.py:619`). SALT suggestions in CG years may therefore shrink toward the floor:
correct, documented.

### C2. Real NIIT line
NIIT = 3.8% × min(net investment income, max(0, MAGI − threshold)), thresholds by filing
status (the existing `NIIT_AGI_THRESHOLDS` map: 200k/250k/125k).
Net investment income (from engine inputs) = `interest_total + unqualified_dividends +
max(stcg_total, 0) + max(cg_amount, 0)` (cg_amount is the netted LT+QD+other figure; the
clamp guards the pathological negative-components edge rather than trusting "≥ 0 by
construction").

- `TaxBreakdown` gains `niit: JurisdictionResult` (tax, effective_rate over NII,
  `taxable_income` = the surcharged base = min(NII, MAGI excess)). `totals.total_tax` and
  `take_home` include it.
- Schema/API: `TaxSummaryOut` gains a `niit` section (same shape as capital_gains — additive,
  so stored payloads and the frontend types extend compatibly). The waterfall and donut chart
  builders (`src/components/taxes/taxChartOptions.ts`) gain the NIIT slice/bar (render only
  when nonzero, like SDI).
- **Folded-rate normalization** (prevents double-surcharge): the sheet's model folds NIIT
  into CG bracket rates (15→18.8, 20→23.8). With an explicit NIIT line those must be base
  rates:
  1. Guarded data migration: in `tax_brackets` where `jurisdiction='capital_gains'`, rewrite
     rate `0.1880 → 0.1500` and `0.2380 → 0.2000` (exact matches only, all years, all
     statuses). Downgrade restores the folded pair (same exact-match guard).
  2. Importer (`backend/app/importer/apply.py`, brackets section): translate the same two
     exact rates on apply, with a per-sheet report warning naming the translation — so a
     re-import cannot reintroduce double-counting.
  3. `niit_advisory` is REWRITTEN: it now warns when stored CG rates still LOOK folded
     (18.8/23.8 present) — "NIIT is computed separately; these rates appear to fold it in —
     store 15/20" — and no longer performs the AGI-threshold rate comparison (the explicit
     line supersedes it). `NIIT_WARNING` text updated accordingly.

### C3. Wire `capital_loss_deductions` into AGI
Add `capital_loss_deductions` to `ENGINE_INPUT_KEYS` and to `_federal_agi` as an additive
term (stored values are ≤ 0 by the suggestion's convention; the state chain inherits it
via `fed_agi`, matching CA conformity on the $3k rule). Two new warnings:
- stored value > 0 → "capital_loss_deductions is stored positive — it should be a negative
  deduction" (value still used verbatim; GET never rejects stored data).
- stored value < −3000 (or −1500 MFS) → "exceeds the statutory cap" (used verbatim).
The `_federal_agi` docstring's "deliberately absent" note is inverted and dated. The inputs
form needs no change (the suggestion already produces the correctly-capped negative).

### C4. Safe harbor: lesser-of rule
`backend/app/api/taxes.py:1243-1282`: the block computes only the prior-year threshold. Add
the statutory alternative — 90% of the CURRENT year's liability:
`current_threshold = _money(liability_total × 0.90)` when `liability_total` is not None.
`effective_threshold = min(prior_threshold, current_threshold)` (or whichever exists).
`SafeHarborOut` gains `current_year_threshold: Decimal | None` and
`effective_threshold: Decimal`; `met` is judged on `effective_threshold`.
`WithholdingPanel` copy shows both legs ("lesser of ...") with the binding one marked.

### C5. Goldens + documented divergences
Every stored-year total that moves gets: an updated golden with an in-test derivation
comment, and a line in the README §7.5 divergence table (new entries: NIIT where NII and
MAGI-excess are both positive; capital-loss years; CG-year SALT suggestions). The importer
translation (C2.2) gets its own pinned test. The what-if endpoint needs **no change**: it
calls `compute_breakdown`, so scenarios pick up NIIT/capital-loss automatically — one test
pins a what-if delta that crosses the NIIT threshold.

---

## Workstream D — Render the computed-but-unrendered planning UI

All frontend except D5's tiny additive schema fields. Sequenced AFTER C (D renders C's NIIT
line in the new table).

### D1. What-if overrides editor
`src/components/taxes/WhatIfPanel.tsx`: a third leg section "Input overrides" beside sales
and ESPP legs. Each row: a `<select>` of input keys (label + key, from the year payload's
definitions the TaxesPage already fetches — pass down as prop), an AmountInput for the new
value, a remove button; "blank value" sends `null` (clears the stored input in the
scenario). Rows serialize into the existing `overrides` field of `POST /taxes/what-if`
(`src/api/whatif.ts` already types it). The response's `changed_inputs` table already
renders diffs — no output work. Per-person note: overrides address the HOUSEHOLD key map
(same aggregation the endpoint applies today); the UI labels this in the section hint.

### D2. Per-jurisdiction detail table
`src/components/taxes/SummaryPanel.tsx`: under the totals tiles, a 7-row `data-table`
(federal, state, NIIT, medicare, social security, disability, capital gains) × columns:
Base (AGI / wages / gains as applicable), Taxable, Tax, Effective rate — straight from the
summary payload fields that are currently dead (`src/types/api.ts:628-647` + new niit).
Rows whose jurisdiction reported nothing render the em-dash convention.

### D3. Marginal-rate view
New `src/components/taxes/MarginalPanel.tsx` on the Taxes page (below the summary): for
federal and state, a horizontal bracket ladder (stacked bar of bracket spans, current
taxable income marked) plus the sentence "Your next $1,000 of ordinary income costs $X
federal + $Y state (+$Z additional Medicare when the combined-wage tier binds)". Pure
client-side: walk the already-fetched bracket tables at `taxable_income` from the summary.
No backend change. Chart follows house grammar (theme tokens, no new colors).

### D4. Withholding: per-check remedy + vest→W2 apply
`src/components/taxes/WithholdingPanel.tsx`:
- When `balance_projected > 0` and `checks_total − checks_elapsed > 0`: render "Add
  ${balance ÷ remaining checks} per remaining paycheck (W-4 line 4c) to close the gap." —
  computed client-side from fields already in the payload.
- The prose telling the user to include vest income in their W-2 inputs
  (`WithholdingPanel.tsx:300-306`) gains an **Apply** button: PUTs
  `w2_stock_rsus_sold = vest.income_ytd + vest.income_projected` for the PRIMARY person's
  column via the existing inputs PUT, then triggers the page's reload callback. Disabled
  with a title when the stored value already equals the figure.

### D5. Dead-payload rendering
- `src/pages/NetWorthPage.tsx`: when the household has >1 person, render a compact
  per-owner strip under the KPI row from the already-fetched `summary.owner_totals`
  (person name → total, plus Joint), matching the segmented-control order.
- `src/pages/ProjectionPage.tsx` FI-probability tile sub-label gains p10:
  "p10 {date} · p50 {date} · p90 {date}" — `fi_month_p10` is already in the payload.

---

## Execution plan

Order: **A → C → B → D** (A first because it touches the shared pages B and D also edit;
C before D because D renders C's NIIT section; B is independent but its wizard delete
action edits MonthlyUpdatePage after A's edits settle).

House rules: implementer subagents on **Opus** (standing user mandate), reviewer passes
per plan (default model), full `pytest` + `vitest` green after each plan, ruff/eslint
clean, browser smoke against the dev stack before merge, merge `tier1-batch` → local
`main` at the end, **never push**. Alembic: C's migration chains onto the current head
(`e4a7c92b6d18` per README addendum — verify at implementation time with
`alembic heads`); no other workstream adds migrations.

Out of scope (explicitly deferred, from adjacent audit findings): partner Apply chips
(`InputsForm.tsx:416`), AMT/ISO modeling, atomic single-endpoint wizard save, "Run backup
now" server-side, quarterly estimated-payments planner, ESPP §423 grant-FMV basis.
