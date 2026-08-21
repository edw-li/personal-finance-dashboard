# RSU Vesting Schedule + "Will I Owe?" Withholding Tracker — Design Spec

**Date:** 2026-08-21
**Status:** Approved (user approved the design conversationally; overnight build authorized with
"always go with your recommendation")
**Depends on:** nothing new — reuses the tax engine, paycheck calc, price history, and the
`espp_ticker` setting (which IS the employer stock ticker; hints say so).

## 1. Context & Goals

Two features, one dependency arc:

1. **RSU vesting schedule** (Comp page): dashboard-only tracking of equity grants and their
   computed vest calendar. NOT in the spreadsheet — **the importer must never read or write
   it** (pinned by test, the dividends-table precedent).
2. **"Will I owe?" withholding tracker** (Taxes page): estimated tax withholding for the
   current year (salary + RSU vests) compared against the tax engine's liability, with a
   safe-harbor line. Consumes feature 1's vest events.

Build order is therefore vesting first, tracker second, in one plan.

### User-confirmed decisions (2026-08-21 Q&A)

| Question | Decision |
|---|---|
| Paycheck profile `withholding_pct` covers | **Everything** — federal + Medicare + Social Security + CA state + CA SDI/VDI. The comparison is therefore all-in vs all-in (the engine's `totals.total_tax` is equally all-in). |
| RSU vest withholding | **22% federal + 10.23% CA supplemental, PLUS marginal FICA** (Medicare / SS-to-cap / SDI), computed from the engine's own bracket tables so caps and additional-Medicare fall out exactly. |
| Liability side | **Engine on stored tax-year inputs, unchanged**, plus a consistency hint when the schedule's implied vest income is worth checking against stored W-2 inputs. Never auto-applied. |
| Grant storage | **Own `rsu_grants` table, import-immune.** Refresh grants seeded one-click from Focal History (`comp_events.refresh_rsus`/`grant_price`); a drift hint flags later mismatches. |
| Whole-share rounding | **Cumulative floor**: `vest_k = floor(total × cum%_k) − already_vested`. Conserves the total; 62/63-style alternation. |
| Vest day | **3rd Wednesday** of the vest month (Mar/Jun/Sep/Dec grid). `first_vest_date` is stored explicitly, so off-convention grants remain expressible. |

### Grant mechanics (user-specified)

- **New-hire grant:** cliff of **25%** on the first vest date (entered explicitly — e.g. started
  Aug 2023, first vest Sep 2024), then **6.25% quarterly** ×12 → 13 vests, 100%.
- **Focal refresh grant:** **6.25% quarterly** ×16, first vest the **June of the focal year**
  (seeded as June's 3rd Wednesday) → 16 vests, 100%.
- Both patterns land on the same Mar/Jun/Sep/Dec calendar grid, so overlapping grants aggregate
  into clean quarterly vest events.
- The math depends only on `cliff_pct` (25% vs 6.25%); `kind` exists for labeling/defaults.

## 2. Data model — one additive migration

New table `rsu_grants` (chained on the current Alembic head — verify `alembic heads` at
implementation time; expected `b3d47a1c9e62`):

| Column | Type | Notes |
|---|---|---|
| `id` | int PK | |
| `kind` | String(10) | `'new_hire'` \| `'refresh'` — validated at the API; display + client-side cliff default only |
| `label` | String(60) unique | "Offer letter", "2025 focal" (EsppPeriod.label precedent) |
| `focal_year` | int nullable | set on seeded refresh grants → links drift hints to `comp_events`; any kind may carry or omit it |
| `shares` | Integer | whole shares by definition; API bound 1..10^8 |
| `grant_price` | Numeric(14,4) | positive; display/drift only — vest values use market prices |
| `first_vest_date` | Date | stored exactly; seeding computes the 3rd Wednesday |
| `cliff_pct` | Numeric(7,4) | in (0,1]; `(1 − cliff_pct)` must divide evenly by 0.0625 → else 422 |
| `notes` | Text nullable | |

No vest rows are stored — the schedule is **computed at query time** from grant parameters
(house law, spec §4 of the founding design). A rounding or convention fix recomputes history.

**Importer:** untouched. A pinned test (`test_importer_never_writes_rsu_grants`, the
`test_importer_never_writes_dividends` precedent) asserts a full workbook apply leaves
`rsu_grants` byte-identical.

## 3. Vesting math — pure service `backend/app/services/rsu_vesting.py`

Pure module (tax_whatif posture): no DB, no HTTP, no clock.

- `third_wednesday(year, month) -> date` — `offset = (2 − weekday(date(y,m,1))) % 7`;
  day `1 + offset + 14`.
- `vest_count(cliff_pct) -> int` — `1 + (1 − cliff_pct) / 0.0625`; raises `ValueError` if not
  integral (the API maps it to 422). New-hire → 13, refresh → 16.
- `vest_dates(first_vest_date, count) -> list[date]` — vest 1 is `first_vest_date` verbatim;
  vest k is the 3rd Wednesday of `month(first) + 3(k−1)` (month-serial arithmetic, the
  `utils/months.ts` idiom in Python).
- `vest_shares(total, cliff_pct) -> list[int]` — cumulative floor over exact Decimal
  percentages: `cum%_k = cliff + (k−1)×0.0625`; `shares_k = floor(total×cum%_k) − Σ prior`.
  Last vest lands on `floor(total×1) = total`, so the sum is conserved by construction.
- `schedule(grant) -> list[(date, shares)]` — zip of the above.

## 4. APIs

### `/comp/rsu-grants` CRUD (in `api/comp.py`, comp router conventions)

`GET` (list, ordered by `first_vest_date, id`), `POST` (201), `PATCH /{id}`, `DELETE /{id}`
(204). Whole-row validation on both verbs (house law): kind enum; label required non-blank;
shares integer 1..10^8; grant_price positive `quantize_price` ≤ MONEY_MAX_ABS_14_4; cliff_pct
in (0,1] with the divisibility rule; focal_year in the comp router's 1990–2100 fence when
present. PATCH nullability: `focal_year`/`notes` clear on explicit null; everything else is
NOT NULL, so null = no-op (`_merged` posture). 409 on duplicate label.

### `GET /comp/vesting-schedule` (computed)

One payload for the whole Comp card set:

- `ticker`, `latest_price`, `quoted_at` — via `_espp_quote` (imported from `api/espp.py`;
  `api/taxes.py` already does this cross-router import).
- `grants[]` — echo + computed per grant: `vest_count`, `vested_shares` (vests dated ≤ today,
  `scheduler.product_today()`), `unvested_shares`.
- `vests[]` — every vest across grants, date-ordered: `date`, `grant_id`, `label`, `shares`,
  `fmv` (employer ticker's stored close on-or-before the vest date, null if none — one
  `price_history` query for the security, resolved in Python), `value` (`fmv × shares`, null
  when fmv is), `is_past` (date ≤ product_today()).
- `tiles`: `next_vest {date, shares, est_value}` (est at latest quote, null-safe),
  `unvested {shares, value}` (latest quote), `vested_this_year {shares, income}` (Σ fmv-based
  values of the calendar year's past vests; vests missing FMV are excluded and named in
  `warnings`).
- `seed_candidates[]` — focal years whose `comp_events` row has `refresh_rsus` AND
  `grant_price` set but no grant carries that `focal_year`: `{focal_year, shares
  (refresh_rsus, as stored), grant_price, suggested_first_vest_date (3rd Wednesday of that
  June), suggested_label ("{year} focal")}`.
- `drift_warnings[]` — strings for grants whose `focal_year` matches a comp event but whose
  `shares`/`grant_price` no longer equal `refresh_rsus`/`grant_price` (a sheet re-import moved
  focal history; the grant is the vesting truth, the hint is informational).
- `warnings[]` — missing-FMV vests, no-ticker/no-quote degradations. Everything degrades to
  nulls + warnings, never a 500 (GET-never-rejects house law).

### `GET /taxes/years/{year}/withholding` (computed)

422 with a plain sentence unless `year == product_today().year` (the estimate is only
meaningful mid-year); 404 via `_require_year` when the year row doesn't exist. Response
(quantized 2dp money at the schema layer; rates 6dp):

- `liability_total` — the engine's `totals.total_tax` on stored inputs/brackets, verbatim
  (reuses `_stored_inputs` + the summary path's bracket loading).
- `salary` leg — `{ytd, projected}` from paycheck profiles (below).
- `vest` leg — `{ytd_supplemental, ytd_fica, projected_supplemental, projected_fica,
  income_ytd, income_projected}`.
- `withholding_total` — `{ytd, projected}`.
- `balance_projected` — `liability_total − projected withholding` (positive = will owe).
- `safe_harbor` — null when no prior tax year is stored; else `{prior_year, prior_total_tax,
  threshold (=110%), met (projected withholding ≥ threshold)}`, flagged approximate in copy
  (real safe harbor is per-jurisdiction; this is the all-in version).
- `checks_elapsed`, `checks_total`, `warnings[]` (no usable profiles → salary leg 0 + warning;
  no ticker → one root-cause warning, vests excluded; unpriced past vests excluded + named;
  no FICA brackets → engine-style warning). *(Amended 2026-08-21 to match the shipped plan:
  `profile_count` dropped; the leg fields ship as `salary`/`vest`/`total` objects — the plan's
  Task 6 schema is the wire contract.)*

## 5. Withholding math — pure service `backend/app/services/withholding_calc.py`

Pure module; the router feeds it profiles, vest events (with FMV/quote), bracket tables, and
`today`.

- **Check grid:** using the CURRENT profile's `pay_periods_per_year` P, check i (1..P) is
  implied on day `ceil(i × days_in_year / P)` of the year (ceil, not round: no .5 ambiguity,
  monotone, always ends Dec 31 — amended 2026-08-21 to match the shipped plan). Deterministic,
  testable, stated as
  an estimate in the card's hint. Each check's withholding = `paycheck_calc.breakdown(profile
  in force on that day)["withholding"]` — this respects the pre-tax base (the % applies to
  taxable, not gross) and profile history mid-year. YTD = checks implied ≤ today; projected =
  all P.
- **Vest supplemental:** per in-year vest, `base × (FED_SUPPLEMENTAL 0.22 + CA_SUPPLEMENTAL
  0.1023)` where base = `fmv × shares` for past vests (missing fmv → excluded + warning) and
  `latest_quote × shares` for future vests (projection only).
- **Vest FICA (marginal):** `FICA(salary_gross + vest_income) − FICA(salary_gross)` where
  `FICA(w) = walk(medicare, w) + walk(social_security, w) + walk(disability, w)` using
  `tax_service.walk` and the year's stored bracket tables — the SS wage-base cap is already a
  terminal 0-rate bracket, and additional Medicare is already a bracket, so caps interact with
  salary+vest ordering exactly and for free. Computed twice: YTD (elapsed gross + past-vest
  income) and projected (full-year gross + all-vest income). Salary-side FICA is NOT added —
  it is already inside the user's all-in `withholding_pct`.
- **Safe harbor:** prior-year engine `totals.total_tax × 1.10` when the prior year exists.

Constants `FED_SUPPLEMENTAL`/`CA_SUPPLEMENTAL` live in this module (code-editable; no UI knob
in v1 — YAGNI, revisit if a real vest confirmation disagrees).

## 6. Frontend

### Comp page (below the TC trajectory card)

- **"RSU grants" card** — EventsPanel idiom: one form doubling as add/edit (kind select
  defaulting cliff 25/6.25 client-side but sending `cliff_pct` explicitly; label; focal year;
  shares; grant price; first vest date; notes), table of grants (label, kind badge, shares,
  price, first vest, vests, vested/unvested, edit/delete), and **seed buttons** rendered from
  `seed_candidates` ("Add 2025 focal — 480 sh @ $121.50") that prefill the form (never
  auto-POST — the user confirms).
- **"Vesting schedule" card** — three tiles (Next vest / Unvested / Vested this year), the
  vest table (date, grant, shares, price used, value, past rows muted, next vest badged), and
  a quarterly bar chart (`compVestingChartOptions.ts`, pure builder + tests): x = vest dates,
  y = value (fmv for past, latest quote for future), one series per grant on PALETTE slots in
  grant order (realistically ≤6 grants; if ever >8, fold into "Other" — theme law). BarChart
  is already registered: the ECharts chunk must stay byte-identical (700.93 kB / 720 advisory).
- Drift and payload warnings render as `hint` paragraphs. Both cards degrade independently
  (EsppPage's per-section seq/banner/busy pattern), fed by one `fetchVestingSchedule()` +
  the CRUD calls in `src/api/comp.ts`.

### Taxes page

- **`WithholdingPanel.tsx`** ("Will I owe? — {year}") between `SummaryPanel` and
  `WhatIfPanel`, rendered ONLY when the selected year is the current calendar year. Fetches
  on mount, keyed by year (WhatIfPanel's keying). Three StatTiles: Projected tax, Projected
  withholding, **Projected balance** (owed → negative tone "≈$X to pay in April"; refund →
  positive "≈$X refund"). Below: YTD sentence ("$X withheld so far of $Y projected · {n} of
  {P} checks · vest income so far $Z"), safe-harbor line when present, the consistency hint
  ("this year's vests imply ≈$X of W-2 income at vest prices — check it's inside your W-2
  inputs"), and the estimate hint (check-grid + supplemental-rate assumptions). InfoHints per
  house register; every figure is the server's, verbatim (global rule 9).

## 7. Testing

- **rsu_vesting unit:** 3rd-Wednesday dates (incl. month where the 1st IS a Wednesday);
  13/16 vest counts; cumulative-floor 62/63 alternation on 1000×6.25%; conservation on prime
  share counts; cliff divisibility ValueError; new-hire Sep-2024-anchored grid.
- **withholding_calc unit:** check grid at P=24 (mid-month/EOM drift tolerated by design);
  profile switch mid-year; marginal FICA against hand-walked brackets including an SS-cap
  crossing (salary below cap, vests pushing past it) and additional-Medicare; missing-fmv
  exclusion + warning; no-profiles degradation.
- **API:** grants CRUD fences (dup label 409, bad cliff 422, integral shares 422, PATCH
  null semantics); schedule payload (fmv resolution, seed candidates, drift warnings, tiles);
  withholding endpoint (non-current-year 422, missing year 404, payload math pinned on a
  seeded fixture, safe-harbor null without prior year); the importer pin test.
- **Frontend:** chart builder tests; Comp page tests (grants form/table, seed prefill,
  schedule tiles); Taxes page test (panel renders for current year only, tiles verbatim,
  tone on owed vs refund). Existing suites stay green (629+ pytest / 497 vitest at branch).

## 8. Ops & compatibility

One additive migration at boot (README 7.6 gets a dated addendum). No payload field is
removed anywhere; new endpoints are purely additive, so old frontend + new backend and the
reverse both degrade gracefully. `espp_ticker` doubles as the employer/RSU ticker — the
schedule card's hint says so. Frontend chunk budget: no new ECharts registrations.

## 8.1 Revision — 2026-08-21 (post-deploy user feedback, same day)

Five changes after the user exercised the shipped feature with real grants:

1. **Comp page order** is now Focal History → the TC chart → RSU grants → Vesting schedule
   (entered history first, then the computed surfaces; grants before the schedule they
   produce).
2. **The vest table groups one row per DATE** (`vest_days` on the schedule payload — a new
   additive field, server-computed since every tranche on a past day prices at the same
   close): summary rows carry the day's tranche count, summed shares, close/quote and
   value (future days flagged `value_is_estimate`); clicking a date expands its per-grant
   tranches, one date open at a time. The flat `vests` list stays as the expansion's feed.
3. **The table scrolls** past ~420px (sticky header) instead of swallowing the page.
4. **Employer history backfill** (`price_service.backfill_employer_history`, run inside
   `run_refresh` under its own savepoint): vests older than the 370-day refresh window had
   no stored closes ("no stored price" forever). One deep provider fetch reaches back to a
   buffer before the earliest grant's first vest; self-extinguishing once the oldest bar
   covers it; skips manual-priced employers; bars only (no latest-price/TTM side effects).
5. **The vest chart's hover carries the bar's total** as its last row
   (`vestingTooltipFormatter` — a full HTML formatter, so grant labels are escapeHtml'd).

Known non-change: the dashboard's cumulative-floor split was validated to the share against
three of the user's four real grants; the initial offer grant reads −3 vested vs the broker
and no uniform rounding rule reproduces it from aggregates — awaiting per-vest broker data
before any change (per-vest overrides remain the v2 answer if needed).

## 9. Out of scope (v2 candidates)

Editable per-vest share overrides (broker reconciliation); UI knobs for the supplemental
rates; per-jurisdiction safe harbor; vest income auto-feeding tax input suggestions; TC
trajectory chart consuming the schedule instead of `unvested_rsus`.
