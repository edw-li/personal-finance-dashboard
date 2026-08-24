# ESPP Offerings & Modeler Refactor (+ Balance Suggestions Removal) — Design Spec

**Date:** 2026-08-23 · **Status:** implemented 2026-08-23 (branch `espp-offerings-refactor`; backend 782 / frontend 707 green; alembic head `c9e2b7a4d113`)
**Touches:** `/espp` page (all three cards), `espp` router/service/schemas, two migrations, `/settings` + monthly-update wizard (removal), `net-worth` router/schemas (removal).
**Amends:** the master spec's `/espp` row (§6) — the "Offering periods" card it describes is replaced; `2026-08-21-data-entry-ergonomics-design.md` §5.2 — the balance-suggestions feature it introduced is removed (a dated amendment is part of this work).

## 1. Context & goals

The ESPP purchase modeler defaults its subscription-price knob to the employer ticker's **latest quote** (`api/espp.py` modeler: both price knobs fall back to `latest_prices`), so every visit the user must re-type the real subscription price or get a silently wrong model. The real-world structure the app is missing is the **offering**: a ~24-month enrollment window that fixes the subscription price at its start-date close (e.g. an offering starting 2023-09-01, covering four semi-annual purchases, until the next offering resets the price on 2025-09-01). Purchase dates are always the last trading day of February and August.

Separately, the existing card titled **"Offering periods"** is misnamed — it holds *purchase/contribution periods* (`espp_periods`: per-half-year `semi_annual_base`, `additional_payments`, `contribution_pct`), a direct port of the sheet's hand-entered modeler cells. The user's target shape for the page is three sections: **Lots · Subscription offerings · Purchase modeler**, with the period inputs folded into the modeler itself.

Balance Suggestions (Settings mapping card + wizard Apply chips, shipped 2026-08-22, never deployed) is removed entirely as a companion change.

### User-confirmed decisions (2026-08-23 Q&A)

- **Offerings are a table** (`espp_offerings`), not a per-period price column and not settings JSON. Dashboard-only, importer-immune (the `rsu_grants` pattern).
- **Broader refactor chosen**: the standalone periods card is deleted; the modeler's per-period table becomes the editor. Page = Lots → Offerings → Modeler.
- **Contributions stay user-entered, sheet-style** — persisted `semi_annual_base` / `additional_payments` / `contribution_pct` per period, edited inline in the modeler table. An earlier proposal to derive contributions from paycheck profiles via a check grid was **rejected by the user** as the design direction: eligible ESPP comp is not exactly `salary/24 × checks`, and an opaque derivation that disagrees with a paystub is worse than an explicit number. `espp_periods` is therefore **kept unchanged** (no drop migration, imported rows survive, importer untouched).
- **Values persist**: "user-inputted" means stored rows (like the old card), never knobs re-typed per visit — re-typing was the original complaint.
- **Knob echo-seeding retires**: today the three modeler knobs seed once from the first response echo (`EsppPage` `knobsSeeded` ref), which is exactly how the subscription box ends up pre-filled with the latest quote. New behavior: knob boxes start and stay blank unless the user types; blank means the smart default (below); placeholders + a provenance line say what blank resolved to. This is the projection page's blank-means-server-decides posture.
- **Balance Suggestions: remove the entire feature** — Settings card, wizard chips, endpoint, `suggest_source` column (drop migration). Confirmed with the note that the adding migration never deployed.
- **Profile suggestion chips on the base/% cells: out.** (The user removed a chips feature the same day; revisit only on request.)

### Plan mechanics (user-provided, 2026-08-23, pre-implementation)

Authoritative NVDA ESPP behavior, for tie-breaking during implementation: enrollment happens in the hire month or an official Feb/Aug enrollment period; contribution election is 1–25% of salary via payroll deduction; the **offering price is the closing price on the first trading day after the enrollment month** and holds for **up to two years spanning four purchase periods**; each purchase buys at a **15% discount on the lower of the offering price or the closing price on the last trading day of the purchase period**; the $25K annual limit caps shares per calendar year. This confirms the shipped chain math (`0.85 × min(sub, fmv)`, limit valued at the subscription price) and the date-containment resolution (an off-cycle hire-month offering is just a row with a non-Sep/Mar start). Note the "up to": an off-cycle offering ends at its 4th purchase, sooner than start + 24 months — the offerings table's coverage label (§6.1) is therefore approximate for off-cycle rows; display-only, accepted.

## 2. Data model — two migrations

### 2.1 `espp_offerings` (new)

| column | type | notes |
|---|---|---|
| `id` | int PK | |
| `offering_start` | Date, UNIQUE | natural key; century-fenced on write |
| `subscription_price` | Numeric(14, 5) | the lot price family (5dp); must be > 0 |
| `notes` | Text, nullable | |

No FKs in or out. Periods link to offerings **by date, never FK** (§3.1), so adding an offering retroactively re-prices every period after it with zero re-linking, and a mid-cycle reset (the plan's reset provision) is just another row (e.g. a 03-01 start).

**Ownership:** dashboard-only. The importer never reads or writes `espp_offerings` — pinned by a regression test in `test_importer_apply.py`, exactly like `rsu_grants`.

Migration A: `create_table espp_offerings`, chained on head `712243ee3ff3`. Downgrade: bare `drop_table`. Order-safe both directions (old code never touches it).

### 2.2 `accounts.suggest_source` (dropped)

Migration B: `drop_column accounts.suggest_source`, chained on Migration A. Downgrade re-adds it nullable (mapping values are not restored — acceptable; the feature is removed and the adding migration `712243ee3ff3` never deployed, so prod simply runs add-then-drop in one boot).

### 2.3 `espp_periods` — explicitly unchanged

Table, columns, importer applier (sheet-wins upsert by label), and the periods CRUD routes all stay. Only the standalone **card** dies; the modeler owns editing (§6.3). Stored 2024/2025 rows survive verbatim.

## 3. Resolution & derivation rules (pure helpers in `espp_calc.py`)

### 3.1 Offering resolution

A purchase period's subscription price comes from the offering with the **greatest `offering_start` ≤ `period_start`**. No covering offering → fall back to the latest quote for that period, plus a warning naming it ("no offering covers {label}; subscription defaulted to the latest quote"). Boundary: `period_start == offering_start` resolves to that offering (≤, not <).

### 3.2 Period calendar for a modeled year Y

Two slots, keyed by `period_end`'s half-year:

- **H1 slot:** start = Sep 1 (Y−1), end = **last weekday** of Feb Y.
- **H2 slot:** start = Mar 1 (Y), end = **last weekday** of Aug Y.

"Last weekday" (Mon–Fri) is the documented approximation of "last trading day"; no NYSE holiday falls on the last weekday of Feb or Aug, and the date is derivation/display only. Helper `last_weekday_of(year, month)` lives in `espp_calc` with unit tests (including leap-year February).

### 3.3 Stored wins, derive to fill

For year Y, stored rows are `espp_periods` where `period_end.year == Y`, in `(period_end, id)` order (today's chain order). Slotting: `period_end.month ≤ 6` → H1, else H2.

- A slot with a stored row uses it **verbatim** — label, dates (the sheet's dates are truth), and values.
- An empty slot renders a **derived row**: dates/label from §3.2, `semi_annual_base` / `additional_payments` / `contribution_pct` carried forward from the latest stored period overall (any year); with zero stored periods ever, values seed as 0 / 0 / 0 and a warning says so. Derived rows are **not written by the GET** — they materialize only when the user saves them (§6.3). Derived label format: `"Sep 2025–Feb 2026"` / `"Mar–Aug 2026"` (≤ 60 chars; a 409 label collision surfaces the server's sentence verbatim, house error posture).
- Anomalous data (two stored rows in one half, or extra rows) passes through verbatim in chain order with no derived filling for that year — a GET never rejects stored data.

Pure helper `plan_year_rows(stored_rows, offerings, year, latest_quote) -> list[RowPlan]` returns, per row: stored-or-derived provenance, the input values, the resolved `subscription_price` + `offering_start | None`, and any warnings. The router composes it; the function stays DB-free and unit-tested.

### 3.4 The modeler's 404s retire

Derived rows always exist, so `404 "no espp periods"` and `404 "no espp periods in {year}"` are removed. The remaining failure is a 422 when a required price is unresolvable (§5.2).

## 4. Chain math (`run_modeler`) — per-period subscription

`PeriodInputs` gains `subscription_price: Decimal`. Inside the loop, `purchase_price = ceil2(DISCOUNT × min(sub_p, fmv))` and `max_shares_25k = floor_int(unused / sub_p)` compute **per period**; the 25k limit is still valued at each period's own subscription price. The "both knobs are per-year what-ifs… computed once" comment retires with a written rationale (the file's own "kept as the documented shape for the day that changes" note names this day). `eligible/contribution` math, carry/refund branches, the `>=` limit trigger, ROUNDUP semantics, and totals (including the r31 single-FMV quirk — FMV remains one knob) are unchanged. `ModelerResult.subscription_price` is removed; the router owns top-level echoes.

## 5. APIs

### 5.1 `/espp/offerings` CRUD (espp router conventions)

- `GET /espp/offerings` → list ordered by `offering_start`. `OfferingOut`: `id, offering_start, subscription_price, notes`.
- `POST /espp/offerings` — 201; duplicate `offering_start` → 409; `require_reasonable_date`; `subscription_price` validated with the lot price vocabulary (`_positive_price` at the 5dp/10⁹ family).
- `PATCH /espp/offerings/{id}` — merged-row validation like lots; changing `offering_start` re-checks uniqueness.
- `DELETE /espp/offerings/{id}` — plain 204 (no children).

### 5.2 `GET /espp/modeler` — rewritten contract

Params unchanged in name: `subscription_price`, `purchase_fmv`, `carry_forward`, `year`. New semantics:

| knob | blank means | typed means |
|---|---|---|
| `subscription_price` | per-period offering resolution (§3.1), quote fallback + warning per uncovered period | overrides **all** periods (the what-if) |
| `purchase_fmv` | latest quote (the honest proxy for an unhappened purchase) | override |
| `carry_forward` | 0 (unchanged) | override |
| `year` | **current calendar year** (module's `date.today()` clock, kept module-consistent) | that year |

**422** only when a price is truly unresolvable: FMV with no quote and no param, or ≥ 1 period with no offering, no quote, and no param — one message naming what to pass (today's wording pattern).

**Wire deltas** (`schemas/espp.py`):

- `ModelerPeriodOut`: `id: int | None` (None = derived), new `stored: bool`, new `subscription_price: Decimal` and `offering_start: date | None` (None = quote fallback or override). Existing input-echo and chain fields unchanged.
- `ModelerOut`: `subscription_price` becomes `Decimal | None` (the override echo; null when offerings/quote drive per-period). New `subscription_source: Literal["override","offering","latest_price","mixed"]` ("mixed" = the year's periods resolved from different sources) and `fmv_source: Literal["override","latest_price"]`. New `warnings: list[str]` (advisory register). New `available_years: list[int]` — server-owned year-chip list: every stored `period_end` year, every year an offering covers a purchase in (first offering's first purchase year through the current year), plus always the current year and current + 1, sorted unique. (The frontend has no other source for this once `fetchPeriods` is gone.) `quoted_at` is non-null whenever any value fell back to the quote. Legacy `price_source` **kept with its historical meaning** ("params" iff both prices overridden, else "latest_price") as stale-tab armor for one deploy cycle; new UI reads only the new fields.

### 5.3 Periods CRUD — kept as the save path

`GET/POST/PATCH/DELETE /espp/periods` stay exactly as-is. The modeler UI saves inline edits through them: dirty stored rows → PATCH; dirty derived rows → POST with the derived label/dates + entered values. DELETE is the per-row "reset to derived" escape hatch (also the only way to shed a row's stored dates, since the modeler UI does not edit dates — the API still accepts them for repair work).

## 6. Frontend (`EsppPage.tsx`)

Page order: **Lots → Subscription offerings → Purchase modeler.** `PeriodsPanel` and `fetchPeriods()` are deleted; the page's feeds become lots / offerings / modeler, each with the existing seq-guard + banner + busy-dim pattern.

### 6.1 Offerings card

Form: Offering start (date) · Subscription price (`AmountInput kind="plain"` — 5dp column, kind-scale rule) · Notes. Table: Start · Subscription price (5dp-faithful display, not `formatCurrency`) · Coverage — display-only client derivation: "→ {next offering start}" (reads "runs until the next offering starts") or "through {start + 24 mo}" · Notes · Edit / Delete (confirm). Edit/carry-forward ergonomics follow the lots form patterns (focus-before-reset on save).

**"Use close" chip:** once a start date is entered, if the employer ticker is known (`LotsOut.espp_ticker`) the card lazily fetches `GET /prices/history/{ticker}?days=3650` (once per mount) and offers "close on {last bar ≤ date}: {price} — Use". A chip, never auto-applied; absent when the ticker is unset or no bar exists on/before the date.

### 6.2 Modeler card — knobs

Year chips render the server's `available_years` (§5.2); default selection = current year. Knobs shrink to the sheet's three — Subscription, Purchase FMV, Carry-forward — **echo-seeding removed**: boxes start blank; placeholders read "from offerings" / "latest quote" / "0". A provenance line renders the resolved values, e.g. *"Subscription {price} — Sep 1, 2023 offering · FMV {price} — latest quote (as of {date})"*; per-period subscription prices also appear in the table, so a mixed year is visible row by row. `warnings` render in the advisory register, never the error banner. Knobs continue to live in page state so a failed recalculate keeps them (existing comment's rationale stands).

### 6.3 Modeler card — the editable per-period table

One table per modeled year: identity/derived columns (Period label, dates, Subscription + offering provenance) · **three editable cells per row** — Semi-annual base (`kind="money"`), Additional payments (`kind="money"`), Contribution % (`kind="percent"`, stored as a 9dp fraction via `shiftPoint`, the old card's convention) · chain columns (Eligible, Contribution, Available, Purchase price, Shares, Cost, Carry out / Refund, 25k value) rendered **verbatim from the server** — the page never recomputes the chain (global rule 9).

- The card is one `data-entry-scope`; Enter walks cells; the primary button is **"Save & recalculate"** (`data-entry-primary`, Ctrl+Enter): saves dirty rows (PATCH stored / POST derived — a materialized row posts exactly what its three cells display, edited or carried-forward), then refetches the modeler with the current knobs. With nothing dirty it is a plain recalculate. Save success follows the focus-before-reset invariant.
- While any cell is dirty, a `role="status"` note says the chain below is stale until saved; chain columns are not recomputed client-side.
- Stored rows get a per-row **Reset** action (confirm → DELETE → refetch), reverting the slot to derived. Derived rows show a subtle "derived" marker (mirrors the vest table's "est." register).
- The $25k gauge, tiles, and empty/error states keep their current shapes; the modeler-missing (404) state is deleted along with the 404s.

### 6.4 Lot-form prefills (riders, both editable, prefill-only)

Typing a purchase date prefills — only into untouched boxes — **subscription price** from the covering offering, and **qualifying date** as `max(offering_start + 2 years, purchase_date + 1 year)` (§423 rule, computable now that offerings exist). Client-side date math, entry convenience only. No covering offering → no prefill.

### 6.5 API client / types

`api/espp.ts`: add offerings CRUD; drop `fetchPeriods` (create/update/delete period stay for the save path); `ModelerParams` unchanged. `types/api.ts`: `EsppOffering*` types; `EsppModelerOut`/period-row deltas per §5.2.

## 7. Companion change — Balance Suggestions removal (entire feature)

**Fence:** the *tax input* suggestions (`tax_service.derive_suggestions`, `InputsForm` Apply chips, `api/taxes.ts` types) are a different, unrelated feature and are **untouched**.

Removed:

- **Frontend:** SettingsPage "Balance suggestions" card + its state/loads (incl. its `fetchAllocation('account')` usage); MonthlyUpdatePage suggestion fetch + Apply chips + hide-when-equal logic; `api/netWorth.ts` suggestions client + `suggest_source` in account types; related `types/api.ts` entries; the suggestion assertions in `SettingsPage.test.tsx` / `MonthlyUpdatePage.test.tsx` (replaced by chips-are-gone assertions where a regression is plausible).
- **Backend:** `GET /net-worth/suggestions` (and `comp._unvested_value` itself — the endpoint was its only caller; comp's tiles compute inline via `_vest_value`, so the helper goes too — corrected 2026-08-23, this line originally claimed the tiles used it); `suggest_source` handling in the accounts PATCH + echoes (`api/net_worth.py`, `schemas/net_worth.py`); the model column (`models/net_worth.py`); Migration B (§2.2); the suggestion tests in `test_net_worth_api.py` and the `suggest_source` importer-immunity pin in `test_importer_apply.py` (feature gone, pin moot).
- **Docs:** dated amendment to `2026-08-21-data-entry-ergonomics-design.md` §5.2 recording the removal and its rationale ("user judged the mapping + chips not useful; removed 2026-08-23 before ever deploying").

## 8. Testing

**Backend — pure (`test_espp_calc.py`):** `last_weekday_of` (leap Feb, month ends on weekend/weekday); `plan_year_rows` — stored-wins verbatim, derive-to-fill each slot, carry-forward seeding, zero-history seed + warning, anomalous two-rows-one-half passthrough, offering boundary `period_start == offering_start`, gap-year quote fallback + warning; `run_modeler` per-period pricing — a mixed-offering year prices each period's cap at its own subscription, and an all-same-subscription run reproduces today's chain **byte-identically** (back-compat pin).

**Backend — API (`test_espp_api.py`):** offerings CRUD (409 dup start, validation vocabulary, PATCH merge); modeler resolution matrix (offering / quote-fallback+warning / override; fmv quote/override; 422 wording when unresolvable), `year` default = current year, `available_years` composition (stored years ∪ offering-covered years ∪ {current, current + 1}), provenance fields (`subscription_source` incl. "mixed", `quoted_at` rule, legacy `price_source` pin), derived rows carry `id: null, stored: false` and never write; POST/PATCH-as-save round-trip materializes a derived row and the next GET returns it stored.

**Backend — importer (`test_importer_apply.py`):** offerings immunity pin (import never creates/updates/deletes `espp_offerings`); existing periods import behavior re-asserted unchanged.

**Frontend:** offerings panel CRUD + use-close chip (present only with ticker + bar; never auto-applies); modeler — blank knobs produce no params, provenance line renders each source, no echo-seeding regression (boxes stay blank after first load), dirty-note + Save & recalculate issues PATCH for stored / POST for derived rows then refetches, Reset deletes and re-derives, year chips; lots prefills (subscription + qualifying date, untouched-box guard); removal — wizard renders no suggestion chips and Settings renders no mapping card.

## 9. Ops & compatibility

- Migration chain: `712243ee3ff3` → A (`espp_offerings`) → B (drop `suggest_source`). Both additive-or-narrowing with clean downgrades; a code rollback after deploy leaves old code that simply never queries offerings, and (post-B-downgrade) a re-added empty `suggest_source`. Prod note: the never-deployed `712243ee3ff3` and B run in the same boot — add-then-drop, harmless.
- No importer changes ship in this work (the periods applier is untouched; offerings are importer-immune by test).
- No new ECharts registrations; the chart chunk is untouched (this feature has no charts).
- Wire evolution is additive plus two nullable-izations (`ModelerOut.subscription_price`, and `ModelerPeriodOut.id` — null on derived rows, which an old tab can receive on a default-year GET) and the legacy `price_source` retained — an old tab renders sane text for one deploy cycle; a new tab against an old backend simply sees no new fields (nullable/optional reads).
- Clock: the espp module keeps `date.today()` (its documented single clock); the year default inherits it. The known PT/UTC day-boundary split remains out of scope here.

## 10. Out of scope (recorded)

- Paycheck-profile-derived contributions and profile suggestion chips on base/% cells (rejected this round; revisit on request).
- Automatic reset-provision modeling (a price-drop reset is the user adding an offering row).
- Editing period dates in the modeler UI (API accepts them; Reset re-derives).
- Discount (15%) and $25k limit knobs — constants, as in the sheet.
- Gains modeling inside the modeler (lots and the tax what-if own gains).
- Multi-employer / second ESPP plan; `espp_ticker` remains the single employer link.
- Any xlsx importer changes.
