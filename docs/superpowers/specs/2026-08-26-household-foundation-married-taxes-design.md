# Household Foundation + Married Taxes — Design Spec

**Date:** 2026-08-26
**Status:** Approved (design approved in session; spec pending final user review)
**Companion:** `2026-08-26-marriage-readiness-audit.md` (full-dashboard audit; file:line evidence
for every claim here lives there). Audit §10 records the Q&A that fixed this scope.

## 1. Context & Goals

The user marries in a few weeks; **first married tax year is 2026 — the current year**. The
dashboard is single-person by original design. This batch delivers the two time-critical
halves: (a) a household/person foundation with partner account tracking (the headline ask),
and (b) filing-status-correct taxes, including a two-earner withholding tracker for 2026,
where the live year flips single → MFJ mid-stream with single-assumption withholding already
banked.

## 2. Decision Log (from user Q&A, 2026-08-26)

| Decision | Choice |
|---|---|
| Partner comp | W-2, California. No equity/ESPP now (no schema prep either — defer until real). Same semi-monthly cadence (biweekly de-scoped). |
| First married tax year | **2026** (Dec-31 rule; wedding in weeks) |
| Joint representation | Nullable `person_id` = joint/household. ≥1 joint bank account; all other accounts have a primary holder. |
| History | **No backfill — start fresh.** Partner data begins at/near the wedding. |
| Spending | Household totals only; `monthly_cashflow` schema unchanged. |
| MFS | Brackets-only, with an explicit CA community-property caveat in the UI. |
| Login | One shared login (seed made deterministic as insurance). |
| Batch | Foundation + taxes together (P0+P1+P2 of the audit phasing). |
| MFJ bracket values | Bring-your-own + clone-as-MFJ helper. The app ships no bracket values. |

**Out of scope (deferred):** per-person paycheck profiles/calendar, RSU/ESPP/comp person
scoping, employer-ticker registry, portfolio ownership (`portfolio_accounts`), credit-card
owner tags, marriage penalty/bonus calculator, global shell-level scope toggle (page-local
chips only), community-property tracking beyond the marriage date, per-person net pay,
importer redesign.

## 3. P0 prerequisites (land first, independently deployable)

1. **Scope the tax importer's sync-deletes to the sheet's own vocabulary.**
   - Inputs (`backend/app/importer/apply.py:513-516`): delete only rows whose `key` is in the
     workbook's parsed key set **and** whose `person_id` is NULL or the primary person. Never
     touch partner rows or non-sheet keys.
   - Brackets (`apply.py:548-553`): delete only rows with `filing_status='single'` **and** a
     jurisdiction present in the workbook parse. MFJ/MFS tables are invisible to the importer.
   - Pinned by tests: re-import over a DB containing partner inputs + MFJ brackets leaves
     them intact; sheet-covered single-status data still syncs exactly as today.
   - This also makes the standing assumption true: *uploads update sheet-tracked values and
     leave everything else alone.*
2. **Deterministic admin seed** (`backend/app/seed.py:15-23`): look up by `ADMIN_EMAIL`
   first; if absent, take `ORDER BY id` first row and rename; create only when the table is
   empty. Behavior identical today (one row), and a stray second row can never brick a boot.

## 4. Data model

New/changed tables (five additive migrations, chained on current head; README §4.3 respected;
all run at container boot):

- **`people`** — `id` PK, `name` String(80) UNIQUE, `is_primary` bool. Migration seeds one row
  `("Me", true)` and backfills below. Exactly-one-primary enforced by partial unique index.
  No delete endpoint once referenced (409); rename allowed.
- **`accounts.person_id`** — nullable FK → people (NULL = joint/household). Backfill: all
  existing accounts → **primary person**; only genuinely joint accounts get NULL going
  forward, so "Joint" means exactly what it says. (The pre-marriage timeline reads
  identically either way, since partner rows don't exist yet.) The user may re-tag any
  existing account to Joint via the Accounts card. Name/slug stay **globally unique**
  (partner accounts are named distinctly; importer natural keys untouched; re-imports
  already only warn about non-sheet accounts, never delete).
- **`tax_years.filing_status`** — String(20) NOT NULL default `'single'`
  (`single|married_joint|married_separate`, Python-validated like `group`). History
  untouched; the user flips 2026 in the UI.
- **`tax_brackets.filing_status`** — String(20) NOT NULL default `'single'`; unique becomes
  `(year, jurisdiction, filing_status, bracket_index)`. All existing rows become `'single'`.
- **`tax_inputs.person_id`** — nullable FK → people; unique becomes
  `(year, key, person_id)` **`NULLS NOT DISTINCT`** (PG16) so duplicate household rows are
  impossible. **`tax_input_definitions.is_per_person`** bool; the migration flags the 17 existing
  per-person keys (audit §3.2 list: salary, W-2 family, 401k, HSA×2, pre-tax deductions);
  the two new tracker-only keys in §5.6 are also flagged, for 19 total.
  Backfill: rows for per-person keys → primary person; household keys stay NULL. Invariant
  after migration: NULL strictly means household-level.
- **`app_settings['marriage_date']`** — written by the household endpoint (not the legacy
  3-field settings PUT).

## 5. Backend design

### 5.1 Household API (`/api/v1/household`)
`GET` (people + marriage_date) · `POST /people` · `PATCH /people/{id}` (rename; is_primary
immutable) · `PUT /marriage-date`. No person delete (409 if attempted while referenced;
simplest: no route at all this batch).

### 5.2 Net worth
- `owner` query param on `GET /timeseries` and `GET /summary`:
  `owner=<person_id>|joint` (absent = household/all). Semantics: a person's view =
  their accounts **plus joint accounts** (matches "primary holder + spouse secondary"
  reality); `joint` = NULL-owned only. Implemented once at the two math hooks
  (`net_worth_calc.py:42 net_worth_for`, `:53 group_totals_for`) and the balance-matrix
  loader (`:24`); summary response gains `owner_totals` beside `group_totals`.
- Accounts CRUD API extended: `person_id`, `parent_account_id`, `is_component` become
  settable via POST/PATCH (`schemas/net_worth.py` Create/Update/Out). Existing guards keep:
  slug immutable, DELETE 409s once balances exist.
- `investable_base`/`investable_bases` stay household-wide (projection and the 4%-line are
  household concepts; no owner param this batch).

### 5.3 Tax engine (`services/tax_service.py`)
- `compute_breakdown(year, inputs, brackets, *, filing_status="single", earners=None)`.
  With defaults, the output is **byte-identical** to today — the golden suite (795 lines,
  2023–2026 pinned to the cent including deliberate sheet drift) runs unmodified and must
  stay green. `earners` is a list of per-person wage bundles; when None, the engine
  synthesizes the single-earner bundle from `inputs` exactly as today (`:312`).
- **Payroll walks:**
  - Social Security: per earner — `Σ walk(ss_brackets, min(earner.w2_wages, wage_base))`.
  - SDI: per earner — `Σ walk(sdi_brackets, earner.w2_wages)` (data may carry cap rows;
    per-person walk respects them; reported `taxable_wages` stays uncapped-aggregate as
    today).
  - Medicare: **combined-wage walk, unchanged in shape** — the 1.45% base is linear and the
    0.9% additional tier is legally assessed on combined wages above the status threshold
    (Form 8959), so correctness comes from the status-selected medicare table (MFJ tier at
    250k, MFS at 125k), not a per-person split.
- Ordinary/AGI/deduction/CG-stacking/state chains: unchanged math over the summed inputs
  dict against status-selected brackets. The CA CG-as-ordinary fix (2026-08-25) is
  status-neutral and untouched.
- `niit_advisory`: threshold by status — `{single: 200k, married_joint: 250k,
  married_separate: 125k}` (statutory, non-indexed; constants are appropriate).
- `derive_suggestions(year, inputs, filing_status)`:
  - SALT suggestion cap: status-aware — MFS halves; 2025+ cap gets the OBBBA >$500k-MAGI
    phase-down (cap − 30%×(MAGI−500k), floor at the 10k base; MFS thresholds halved).
    Extends the existing hardcoded `10000/40000` table (`:60-62`) — consistent with current
    philosophy (statutory constants in code, bracket values as data).
  - Capital-loss suggestion capped at 3,000 (1,500 MFS). **Engine AGI math unchanged** —
    `capital_loss_deductions` remains a stored-but-not-engine key, preserving goldens and
    the sheet-model philosophy.
  - Derived-W2 suggestion unchanged (primary person only; partner has no paycheck profile).
- Bracket loader (`api/taxes.py:_engine_tables:139-157`) becomes status-aware — the single
  place selection happens; `money_flow.py:161` and `api/overview.py:125` inherit. When a
  year's status has no bracket tables, the summary returns an explicit
  `brackets_missing_for_status` state (per-jurisdiction list) instead of computing garbage
  or 500ing; the UI renders it as a call-to-action.

### 5.4 Tax inputs API
`GET/PUT /years/{y}/inputs` rows gain `person_id`; assembly for the engine: household keys
from NULL rows, per-person keys summed across person rows (and the earner bundles built from
the FICA-relevant subset). Single years keep exactly one person column (primary), so
existing clients/tests see today's shapes.

### 5.5 Brackets API
- `PUT /years/{y}/brackets` gains `filing_status` (full-replace stays per
  (jurisdiction, status)).
- `POST /years/{y}/clone-brackets-from/{src}` gains `target_status`: clones all six
  jurisdictions from the source's single tables to the target status verbatim, and the
  response flags which tables are typically correct as-is (social_security, disability —
  per-person parameters) vs need threshold edits (federal, state, capital_gains, medicare's
  additional tier). 409 only if the target (year, status) already has rows.

### 5.6 Withholding tracker (`/years/{y}/withholding`, current-year only)
- Primary person: full per-paycheck simulation, unchanged.
- Partner (until per-person profiles land in a later batch): annualized figures from
  per-person tax inputs — wages from their W-2 keys; withholding from **two new per-person,
  tracker-only input keys** `w2_fed_withholding` / `w2_state_withholding` (stored like
  `capital_loss_deductions`: real inputs, never in `ENGINE_INPUT_KEYS`). Empty for the
  primary person (simulated instead); the panel states the asymmetry plainly.
- Liability side comes from the MFJ-correct engine; withheld side = simulated (me) +
  entered (partner). A dedicated callout decomposes the gap and names the
  **Additional-Medicare under-withholding trap** explicitly when its component is nonzero
  (each employer withholds 0.9% only above $200k of its own wages; MFJ owes it above $250k
  combined).
- Safe harbor: the 110% multiplier (`api/taxes.py:566`) gets its statutory AGI gate —
  prior-year AGI > $150k ($75k MFS) — reading prior-year AGI from the engine summary.
  Wedding-year note rendered in the panel: the 2025 safe-harbor reference is a single-filer
  return; the number is still the legal safe harbor, no math change, just labeling.

### 5.7 Money flow
Input reads become person-summed (same keys, summed across person rows) so entering partner
W-2 inputs alongside household net pay keeps the residual invariant intact — no
negative-residual blanking (`money_flow.py:79-82,:232-233` behavior unchanged, but now
unreachable via normal married data entry). The labeled second source node is deferred.

## 6. Frontend design

- **Settings → Household card** (new): people list (rename; add partner), marriage date.
- **Settings → Accounts card** (new): full roster manager — create/edit (name, group, owner,
  sort, parent + is_component), retire (is_active), delete when balance-free (existing 409
  surfaces as a toast). Groups render with existing labels; owner as a select (Me / Partner
  / Joint).
- **Settings → Categories card** (new): same pattern for spending categories (name, sort,
  retire; delete guarded as today).
- **Net Worth page**: owner chips (All / Me / Partner / Joint) via the RangeChips pattern,
  wired to the `owner=` param; a "by owner" stacking toggle on the main chart (series =
  per-owner totals; group stacking remains the default); tiles stay household. Marriage-date
  markLine annotation on the trend when set — the step at the boundary is real (start-fresh)
  and should read as intentional.
- **Monthly Update wizard**: balance grid grouped by owner with per-owner subtotals (walk
  order: owner → group → components, reusing `nestComponents`); net-pay field relabeled
  "Household take-home." Partner accounts appear automatically once created (grid already
  renders all active accounts).
- **Taxes page**:
  - Tax-year card gains a filing-status selector (Single / MFJ / MFS); changing it refetches
    via the existing `selection` identity. MFS renders a standing caveat: *California is a
    community-property state; true MFS requires 50/50 community-income splitting (Form 8958)
    which this calculator does not model.*
  - InputsForm: per-person keys render Me/Partner columns on married years (single column
    otherwise); `flatItems` and paste-ids become person-qualified.
  - BracketsEditor: status tabs; "Clone as MFJ" button on an empty status tab (drives §5.5);
    per-table badges from the clone response ("review thresholds").
  - WithholdingPanel: partner mini-section (wages read-only from inputs; the two withholding
    estimate fields); the Additional-Medicare callout; `brackets_missing_for_status`
    call-to-action state.
- **Overview**: no direct work — YTD effective-tax tile and money-flow card inherit engine
  correctness; verify in smoke.

## 7. Testing

- **Golden gate:** existing tax suite runs unmodified and green (single path byte-identical).
- **New MFJ fixture year:** hand-computed reference (synthetic inputs, MFJ tables) asserting
  the full breakdown to the cent, including: both earners under the SS base (two full caps),
  one earner over the base, combined wages over the 250k Medicare tier, NIIT advisory
  threshold selection, MFS variants for SALT/cap-loss suggestions.
- **Importer scoping:** re-import fixture asserting partner inputs + MFJ brackets + tracker
  keys survive Apply; sheet-covered single data still syncs; dry-run diff unchanged for a
  pre-marriage database.
- **Schema:** NULLS-NOT-DISTINCT uniqueness test; people exactly-one-primary; account owner
  round-trip via API.
- **API:** owner-filtered timeseries/summary; inputs person round-trip; clone-with-status;
  brackets_missing state; withholding two-earner math.
- **Frontend (vitest):** owner chips filter wiring; wizard owner grouping + subtotals;
  status selector refetch; per-person input columns + paste; bracket tabs; household card.
- **Smoke (real echarts + real data, per the sankey-incident lesson):** Taxes (flip a
  scratch year to MFJ, enter partner inputs, watch summary/withholding), Net Worth (owner
  views), Update wizard, Overview money-flow (no residual blanking), Settings cards.

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Golden-suite drift during the engine refactor | Refactor mechanically first (introduce `earners` with synthesized default), run goldens between every step; no value changes on the single path |
| Duplicate household input rows pre-migration | NULLS NOT DISTINCT index + de-dupe guard in the migration |
| MFJ selected with no MFJ tables | Explicit `brackets_missing_for_status` state end-to-end; never compute against wrong-status tables |
| InputsForm paste/flat-item regressions | Person-qualified ids covered by existing paste tests extended to a married year |
| Accounts card lets users create junk | Retire (is_active) is the escape hatch; delete stays balance-guarded; slug immutability keeps history stable |
| Prod deploy | All migrations additive with defaults; boot-applied; order-safe downgrades; no data rewrite beyond backfills described in §4 |

## 9. Plan breakdown (for writing-plans)

1. **P0 fixes** — importer sweep scoping + seed determinism (+ tests).
2. **Household foundation** — people table/migrations, household API, Settings Household +
   Accounts + Categories cards.
3. **Net-worth ownership** — owner param + math-hook filters, page chips/stacking/annotation,
   wizard grouping.
4. **Tax schema + engine** — migrations, status-aware loader, earner bundles, per-person
   FICA, NIIT/SALT/cap-loss/safe-harbor touches, goldens + MFJ fixtures.
5. **Taxes UI** — status selector, per-person inputs, bracket tabs + clone, MFS caveat.
6. **Withholding + flow + smoke** — two-earner tracker, money-flow person-summing, overview
   verification, full browser smoke.
