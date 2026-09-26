# Polish lane V — integrated browser verification

**Authority:** approved design `../specs/2026-09-25-polish-alignment-feedback-undo-design.md`, especially §9, and `2026-09-25-polish-00-overview.md`. This lane prepares and runs the final browser acceptance on merged local main. No push or deploy.

**Ownership:** this plan and `tools/probes/polish-v/` only. Product defects go to the coordinator with measurements, reproduction and the responsible surface. Screenshots, dumps, tokens, generated configs, logs and JSON reports stay in ignored scratch storage. No changes to another lane's worktree or shared `node_modules`.

## 1. Source and environment

- [x] Read the approved spec, overview and L1/L2 as-built records; recover the original audit harness and L1/L2/L5 measurement scripts.
- [x] Inspect for an existing verification worktree. None existed. Create `.worktrees/polish-verify`, branch `feat/polish-verify`, from main `204ef73d`; attach a junction to root `node_modules`.
- [x] Before final acceptance, update this branch to the coordinator's merged L5–L8 main. Record the exact product commit in every report. A preparation run cannot produce a final acceptance verdict.
- [x] Take one read-only production `pg_dump` through the established SSH/container procedure; record UTC acquisition time, source schema, archive SHA-256 and size. Never call a production mutation, trigger a production backup job, or alter production credentials.
- [x] Restore that same dump into **new**, private `finance_polish_v_read` and `finance_polish_v_write` databases on Docker Postgres `127.0.0.1:5433`. Refuse an existing destination; do not drop or overwrite a database. Record matching table counts before local auth setup.
- [x] Run the read copy on `127.0.0.1:8089`, writable twin on `127.0.0.1:8091`; scheduler and snapshots disabled, `PRODUCT_TODAY=2026-09-25` for comparison with the audit. Port 8090 belongs to `WsToastNotification.exe` and is not used.
- [x] Run worktree Vites on 5279/5280 with separate private caches, explicit API targets and strict ports. The browser fence forwards real API reads directly to the matching loopback backend (established table-scroll/L6 workaround for intermittent Vite proxy truncation); report this transport choice.
- [x] Keep authentication secrets in ignored token files, never logs or tracked manifests. Local auth setup is allowed only on the two V copies. The default probe fences mutations; writable mode additionally requires an explicit twin URL and local source manifest.
- [x] Verify `/auth/me`, schema and local database identity before opening a browser. Both identities/schema were reconfirmed after the final product update; the read copy reports read-only transactions. Close each context/browser in `finally`; stop only V-owned servers on completion.

The older audit copy (`finance_polish_audit`) and lane copies (`finance_polish_w5`–`w8`) supply historical evidence, never the final fresh-copy verdict. The original read-only dump invocation was recovered by the Settings agent; V executed it once and restored identical bytes into both private databases.

## 2. Reusable driver and report

- [x] Implement `tools/probes/polish-v/smoke.mjs`, a loopback-only Edge driver with classic scrollbars, one browser/context at a time, a mutation fence, native-dialog/console/page/network error collection, screenshots, per-check evidence and nonzero exit on failed or absent coverage.
- [x] Recover tile baseline instrumentation from L2 (temporary zero-size inline marker removed within the same evaluation), chart selectors/measurements from L1, and Settings natural-height/action-gap measurements from L5.
- [x] Put the audit's before-numbers and source references in a tracked baseline manifest. Keep observations separate from passes: missing elements, absent rows, driver errors and unexercised branches cannot silently pass.
- [x] Add filters for groups, routes, dimensions and theme that reject unknown values. Reports name applied filters; only the unfiltered matrix plus required flow evidence can be called complete.
- [x] Require an explicit merged product SHA and fresh-source manifest for final runs. `PREPARE=1` allows a labelled smoke while authoring; it never claims acceptance.
- [x] Write progressive JSON after each case so interrupted work is reviewable. Redact secrets and do not store API payloads containing the private book in tracked files.

## 3. Matrix: both themes at every viewport

Each group runs dark and light at **1280×800, 1366×768, 1440×900, 1536×864, 1920×1080**. Sidebar additionally checks comfortable and compact density. Motion/focus spot checks add reduced motion at 1280×800 light and 1440×900 dark.

| Group | Acceptance and actual measurement |
|---|---|
| Sidebar (§2) | `scrollHeight - clientHeight <= 1`; theme and logout buttons fully visible, 28×28; one footer row; Search… not truncated; all navigation links present. Confirm normal rhythm is retained above 900px height. |
| Five chart pairs (§3.1) | Overview Portfolio performance/Recent spending, Spending Trends, Paycheck breakdown/flow, ESPP anatomy/price, card detail credits/limit history: bottom difference <=1px with Tables closed, each available Table open, and closed again. Trends plot tops and bottoms also <=1px. Record before/after. |
| Overview (§3.2) | Wealth/agenda bottoms <=1px; Changes blank band <=24px with trend Table closed/open/closed. Customize hide/show leaves no isolated half-width hole or horizontal overflow. |
| Settings (§3.3) | Walk all five tabs; each real paired row bottoms <=1px; gap above pinned actions <=96px. At 1440/1920 record natural-height spread <=15% for pairs covered by the pairing rule, with Appearance/Password's explicitly retained pairing reported separately. |
| Calendar (§3.4) | First week starts <=12px below weekday label text. Cashflow tile row uses the same tile checks. |
| Tax tables (§3.5) | Independent stacks with consecutive group gaps matching CSS row gap, no ragged cross-row void; two columns where page width permits, one with dock/narrow page. Preserve jurisdiction reading order and report actual column count. |
| Allocation (§3.6) | Card-height spread <=1px across Asset class, Industry, Geography, Account, Holding type; aside scroll box/pinned header and plot remain contained. |
| Meters (§3.7) | Budget meter right edges and Paycheck pace track right edges each spread <=1px; empty budget track differs from card background. |
| Guide (§3.8) | Numbered rail shows Step N of M, Previous/Next select neighbor and focus the selected rail row; unnumbered rail has Next only. |
| Tiles (§4) | Every visible real tile row: shared value baseline <=1px and equal tile bottoms within each visual row; five tiles lay out 5, 3+2, or 2+2+1 only when the last spans the full width (never orphan 4+1 or unfilled 2+2+1). Repeat with the metric detail dock open. At 1440, Overview/Net worth/Spending deltas each fit one line. |
| Month stability (§4.3) | Traverse every month offered by Net worth and Spending, both themes; row-height spread <=1px. The full matrix records this at every target viewport, including audit-sensitive 1280. |
| Loading/CLS (§4.6, §9) | Fresh context/route for all 14 navigation destinations plus distinct tile/editor tabs. Record browser layout-shift entries without recent input and require CLS <0.1 per route/case. Observe cold five-tile skeletons and settled rows; no phantom loading placeholders. |
| Errors (§9) | No native dialog, page error, console error, failed API response, unexpected blocked write or route fallback. Known pre-existing observations stay explicit failures/notes until coordinator disposition, never an automatic green allowlist. |

The layout walker includes all in-scope tab variants: Settings five tabs, Spending overview/trends/budgets/history, Portfolio overview/holdings/income/allocation/manage, Taxes summary/inputs/tables/what-if, Paycheck summary/profiles/changes, Comp summary/vesting/manage, ESPP summary/purchase/lots, Cards rewards/manage/lines/detail, Calendar grid/list, Projection planning/trend, Monthly balances/spending/review, Guide chapters, plus Overview and Net worth. A missing data-dependent section is a stated coverage gap.

## 4. Mutation and focus evidence (§5–§6)

Existing real-browser lane evidence is imported into a manifest with source file, commit, theme/viewport, assertion count, errors and limitations. This avoids pretending old evidence was run on merged main. Re-run representative flows on the fresh writable V twin after merge; the backend exact-cascade suite remains the exhaustive data-image gate.

| Lane | Evidence and fresh integrated checks |
|---|---|
| L5 Settings | Original audit scratch `work-L5/{flows-results,forms-results,activity-results,after,after-natural}.json`; final review fix `ef557961`. Last-row account/category Edit focuses fully visible selected field; Escape/Cancel returns original row; create flashes and reveals; validation/error within200px or sticky bar; delete/Undo restores identical ids; kind/retire Undo; Activity older-page fallback and report reveal; irreversible confirmation Cancel/Escape sends no write. Review fixes have focused tests and will be sampled after merge. |
| L6 money A | `%TEMP%/codex-polish-L6/work-L6/{flows,extras}.mjs` and result JSONs. Eight CRUD families with exact API equality/focus/busy widths; Reset/model, manual quote, allocation draft/activate. Fresh sample security plus dependent rows or transaction, ESPP Reset/Undo, profile save/delete/Undo; confirm per-lane evidence schema before importing. |
| L7 money B | `.worktrees/polish-money-b/work-L7/{browser-report,supplement-report}.json`, product `40a65fe9`. Cards/category/detail exact Undo, calendar identity and generated overrides, budget validation/history Undo, matrix Enter/Escape/save, three-pin capacity and both Unpin paths, assistant irreversible removal. Original main script had locator-only final failure; supplement finished remaining cases. Do not mark the original report wholly green. Fresh sample card/category cascade Undo, event delete/Undo, budget named-field error, matrix draft guard, fixture-only finding confirmation. |
| L8 taxes/monthly | Coordinator provides final browser artifacts/commit. Fresh sample local Tax Inputs SaveStatus, discard guard Cancel/confirm, What-if Apply/Undo including dirty-input guard, bracket/table confirmation, Monthly button-specific busy state and part delete/Undo. All tax/month scopes remain the initiating scope during delayed settlement. |

For each fresh mutation case record: initiating control/idle width; pending control `aria-busy` and inert siblings; focused element; errors' control distance; row visibility and `data-flash`; DOM chronology (row disappearance precedes success toast); exact API snapshot equality after Undo, ids included; no native dialog. Every created record is cleaned and every changed existing row is Undone in `finally`; cleanup failure makes the run fail and reports exact local ids. Irreversible checks use temporary fixtures or stop at Cancel. Never remove existing saved findings, revoke existing feed links, apply imports/restores or modify production.

## 5. Gates, review and handoff

- [x] Validate probe syntax and argument/preflight refusal cases before browser use. A probe-only change does not need the whole frontend suite.
- [x] Coordinator runs integrated app/node `tsc -p --noEmit`, lint (0 errors, <=26 baseline warnings), full Vitest with bounded workers, `vite build`, backend `pytest -n4`. Never `tsc -b` in this junction worktree. Import exact command/head/count/log evidence into V report.
- [ ] Run final matrix only after merged main notification. Inspect screenshots for threshold failures and representative success cases; classify instrument mistakes separately and retain rerun provenance.
- [ ] Send concrete product findings to coordinator promptly; re-run only affected cases after fixes, then complete outstanding matrix coverage. Do not broaden scope to unrelated audit items.
- [ ] Commit plan/probe under `feat/polish-verify`; no merge/push/deploy. Hand off product SHA, fresh-copy provenance, before/after metrics, exact coverage, gate results, deviations, artifact paths and remaining failures. Stop owned Vites/backends and close browsers.

## Preparation record

2026-09-26: worktree created at `204ef73d`, then rebased to merged product `350b91a8b4fed2fa107da5bcc370682ecaceef60` (all four lanes plus the final ESPP test wait). Original audit/L1/L2/L5 helpers recovered; no product code changed here.

Fresh source acquired **07:33:31Z**, completed07:33:35Z: **1,017,604 bytes**, SHA-256 `bb765dd3c70f20cc16f9d741936dcc6db1d0b36f83d55b58805bc1b084e210a8`. Both copies contain **45 tables /27,244 rows**, identical per-table counts, schema `f12026092301`. The production host received only its established read-only `pg_dump` command. A fresh local JWT was signed for the existing copied user; no password or copied user row changed. Both private `/auth/me` checks returned200. Read database default transactions are read-only.

Preparation artifacts live in ignored `scratchpad/polish-v/`: `source.json`, dump, token, private runtime/config/log files, `lane-evidence.json`, `prep-sidebar/`, `prep-pairs/`, `prep-layout/`. Initial sidebar smoke exposed an obsolete probe selector (`.sidebar-footer-row`); it now measures the actual footer children's common center. Sidebar plus five chart-pair/Table cycles at1440dark passed **35 checks**. Main layout selectors at1440dark passed **56 checks**. These are instrument preparation records, not final acceptance, and later instrumentation additions require the final run.

The historical importer attributes **11 artifacts /62 observations** to L5–L8 and explicitly retains L5's injected failure and L7's original last-locator timeout as partial records. It rejects zero/unrecognized records, false exact-Undo/flash/focus flags, nested native-dialog/transport/fenced-write errors and cleanup failures claimed as green. Six deliberately bad fixture artifacts were refused as expected. Independent coverage review also added active-month proof, required observed cold skeleton geometry, explicit mixed-tile sites/What-if results, actual Table appearance/reveal/disappearance, Settings section selection and the tax-container/dock breakpoint. Syntax checks and `git diff --check` pass.

Coordinator's integrated code gates at `350b91a8`: **324 frontend files /4,867 tests passed (245.65s)**; backend **2,845 passed /4 skipped (90.14s)** with unchanged backend tree; app/node noEmit clean, lint0errors/26baseline warnings, production build14.11s. The first combined run's one ESPP test race (second Edit clicked before prior reload ended) was fixed with an actionable wait, then the whole frontend reran green. Final browser acceptance remains separate. Fresh writable runs are serialized L6 → L8 → L5 → L7, then the read-only matrix. A fresh L6 sticky-header focus finding is under coordinator investigation before the final matrix.

The shared reveal fix is now included from product **`b2b07a8edb3c1e7055cfe4e1b635eaf76f67b10b`**: focus/select run before the final scroll so a native date field cannot interrupt its reveal. V rebased cleanly and verified that the served source has this order. The coordinator observed the regression red before the fix, then 19 helper tests green. Final gates at this product head: **324 frontend suites /4,868 tests passed (310.08s)**; app/node types clean; ESLint **0 errors /26 existing warnings**; build **17.19s**. Logs are root `scratchpad/codex-takeover-final-{vitest3,types3,eslint3,build3}.log`. Backend remains **2,845 passed /4 skipped (90.14s)** with tree `9dcde78043e5d9dbb13e1ed53de82c1e601919c6`, log `scratchpad/codex-takeover-final-pytest.log`.

The first fresh L6 run on this fix completed all 16 behavioral checks and exactly restored nine API collections, but the probe's layout-shift descriptor assumed every attribution source was an Element. The observer now handles text nodes explicitly and records page-error stacks. That original run remains instrument-failed evidence; a clean replay is required. This probe correction does not change product code or its gate attribution.
