# Five-Feature Batch — Design Spec

**Date:** 2026-08-25
**Status:** Approved
**Source:** 2026-08-25 fresh-eyes audit (six parallel domain auditors); five items selected by the user.

The five features are independent workstreams. Suggested build order (smallest blast radius
and highest stakes first): CA tax fix → system status → polish batch → chart affordances →
money-flow Sankey.

## Decision log

| Decision | Choice |
|---|---|
| CA capital-gains fix scope | **All years, unconditionally** — no per-year toggle, no year gate. Golden tests updated; divergence from the sheet documented like the existing four drifts. |
| Money-flow Sankey shape | **4 columns, reconciled** — sources → gross → {taxes, pre-tax savings, retained equity, take-home cash} → categories + Saved. No account-group tail (mixing flows with market movement was rejected). |
| Polish batch scope | All nine items, **including** the toast+undo layer and the Ctrl+K command palette. |
| Chart affordance scope | All six sub-items. Event markers on **/portfolio only** (Overview does not fetch the ledgers and must not start). |
| Backup visibility mechanism | `backup_db.sh` upserts an `app_settings` marker row via psql after a successful upload. Backend never talks to OCI. |
| Chart export UI | House-styled ⤓ menu matching the RangeChips grammar — **not** ECharts' toolbox. CSV data supplied explicitly by callers, never introspected from options. |

---

## 1. CA capital-gains fix

**Problem.** `state_agi` is built from `fed_agi` (`backend/app/services/tax_service.py:276-281`),
and `fed_agi` excludes `ltcg_total`, `qualified_dividends`, and `other_capital_gains` — they
feed only the federal CG stack (`:315-323`) and `gross_income`. California taxes capital
gains and all dividends as ordinary income, so every LTCG/qualified-dividend dollar
understates state tax by ~9.3–10.3% at this income level, and the what-if panel reports
"Δ state ≈ $0" for long-term sales.

**Change.** In `compute_breakdown`:

1. Move the capital-gains netting block (the `cg_amount` computation, currently
   `tax_service.py:313-322`) above the state section. The netting rules themselves are
   unchanged.
2. Add one term to state AGI: `state_agi = fed_agi − treasury_exemption + hsa_addbacks
   + cg_amount`. `cg_amount` is the engine's single definition of taxable gains — the same
   quantity the federal stack taxes. No second definition is introduced.

Nothing else changes. The Taxes summary, multi-year trend, what-if sandbox, and withholding
tracker all call `compute_breakdown` and inherit the fix. `state_ti`, state tax, the state
effective rate (denominator `state_agi` grows), `total_tax`, `take_home`, and the overall
effective rate all shift accordingly.

**Out of scope (unchanged, already documented as unmodeled):** the $3k capital-loss cap and
carryforward; NIIT as a computed jurisdiction; treasury-exempt portions of *qualified*
dividends.

**Tests.**
- `backend/tests/test_tax_service.py`: update golden values for every year whose fixtures
  carry LTCG/qualified dividends/other CG; add a dedicated regression test asserting state
  tax includes `cg_amount` (e.g., two otherwise-identical input sets differing only in
  `ltcg_total` must differ in state tax by `walk(state_table, …)` on the increment).
- `backend/tests/test_taxes_api.py` and any what-if/withholding tests pinning summary
  values: update.

**Docs.**
- Engine docstring: record this as a deliberate, principled divergence (precedent: the
  savings-rate line and Unrealized column, per the existing docstring).
- `README.md` §7.5: the "2024 matches the sheet to the cent" claim becomes a fifth
  documented divergence — CA CG taxation; the app is right, the sheet was wrong. State the
  direction (app's state tax ≥ sheet's for CG years).

---

## 2. Chart affordance batch

Six sub-items. The dataviz skill applies during implementation of all chart work.

### 2a. Export (PNG + CSV)

- `EChart` (`src/components/EChart.tsx`) gains an optional prop
  `exportConfig?: { name: string; csv?: () => { headers: string[]; rows: (string | number)[][] } }`.
  When present, the wrapper renders a small ⤓ menu (house-styled like RangeChips) offering
  **PNG** — `chart.getDataURL({ pixelRatio: 2, backgroundColor: SURFACE })` downloaded as
  `{name}.png` — and **CSV** when `csv` is supplied, serialized client-side and downloaded
  as `{name}.csv`.
- CSV content comes from the caller's explicit `{headers, rows}` — never introspected from
  ECharts options.
- Opted-in charts: net-worth stacked (by-group series per month), spending bars (category ×
  month matrix slice), portfolio performance (date, value, cost basis, benchmarks),
  dividends (month, amount), tax trend (year × jurisdiction), projection (month,
  projected/coast/percentiles). Others may opt in later; nothing is forced.

### 2b. Tooltip totals

Propagate the vesting tooltip's Total-row pattern (`src/components/comp/vestingChartOptions.ts:36-52`) to:
- **Spending stacked bars** (`src/pages/SpendingPage.tsx` bars option): custom formatter
  with per-row `(xx%)` share of the month total and a **Total** row (categories only —
  net-pay/4%-rule/budget lines listed but excluded from the total).
- **Tax composition trend** (`src/components/taxes/taxChartOptions.ts:206-287`): add a
  total-tax row.
- **Net-worth stacked** (`src/pages/NetWorthPage.tsx:148-175`): add an assets-subtotal row
  (liabilities and the net-worth line already render as their own rows).

Cosmetic fixes bundled here: bold the date header in `historyTooltipFormatter`
(`src/components/portfolio/historyChartOptions.ts:57-63`) to match every other formatter;
render the savings-rate tooltip unsigned (`SpendingPage.tsx:407-409` currently prints
"+35.0%" for a level).

### 2c. Event markers on the portfolio performance chart

- **/portfolio only.** The page already fetches transactions and dividends in the same
  `Promise.all` as history (`src/pages/PortfolioPage.tsx:126-136`).
- A scatter series ("Events") in MUTED using the proven notes-diamond pattern
  (`src/pages/NetWorthPage.tsx:217-235`): symbol per kind — ▲ buy, ▼ sell, ● dividend.
- The weekly axis is categorical: snap each event to the nearest weekly bar; the tooltip
  shows the true date(s). Multiple events on one bar cluster into a single marker whose
  tooltip lists each event (kind, ticker, amount/shares, true date) plus a count.
- Legend-toggleable, **on** by default. Plain scatter, not effectScatter (ripple stays
  reserved for the live-quote ping).

### 2d. Deep-linkable drill state + Overview click-through

- `/spending?month=YYYY-MM-01` opens that month's drill-in pie (state ↔ URL, replace-style
  history updates; invalid/absent param = no drill). `/taxes?year=YYYY` opens that year's
  jurisdiction pie the same way. Grammar matches the wizard's existing `?month=` param.
- Overview `onClick` wiring: spending bar → `navigate('/spending?month=<clicked>')`;
  performance chart → `/portfolio`; net-worth spark → `/net-worth`.

### 2e. Legend + manual-zoom persistence

On the multi-chart pages (Spending, Net Worth, Portfolio):
- Legend selections become page state: an `onLegendSelectChanged`-style handler (the
  wrapper's existing latest-handler event plumbing) mirrors into a `legendSelected` object
  fed back through each option's `legend.selected`. Refetches/`notMerge` rebuilds no longer
  reset toggles — this kills the budget-line reset bug (`SpendingPage.tsx:164` +
  `:708-711`).
- Manual zoom: a `dataZoom` event listener mirrors `{startValue, endValue}` into the
  page's existing shared `range` state, so ctrl-wheel wandering stays synced across
  same-axis siblings and survives rebuilds. RangeChips presets keep their current
  fresh-identity snap-back contract (chips overwrite the shared state).

### 2f. Zoom discoverability

A shared muted caption component ("ctrl+scroll to zoom · drag to pan") rendered on every
card that registers inside-zoom. One component, applied at each host site.

**Tests.** Vitest: export menu render + CSV serialization; tooltip formatters (totals,
shares, unsigned rate); marker snapping/clustering; URL↔drill-state sync both directions;
legend/zoom state survival across an option rebuild; caption presence.

---

## 3. System-status card

### Backend

New `GET /api/v1/system/status` (JWT-protected, same router conventions) returning:

```
{
  "prices":   { …existing refresh-status shape…, "scheduler_running": bool },
  "database": { "size_bytes": int, "alembic_head": str },
  "backup":   { "last_success_at": timestamptz, "object_key": str, "size": str } | null,
  "environment": "dev" | "prod"
}
```

- `prices` reuses the internals of the existing refresh-status endpoint (one source of
  truth); `scheduler_running` comes from the module's scheduler handle.
- `database.size_bytes` via `SELECT pg_database_size(current_database())`;
  `alembic_head` read from the `alembic_version` table.
- `backup` reads the `app_settings` key `backup_status`; `null` when absent.

### Backup marker

`backend/scripts/backup_db.sh` gains a final step after a successful upload: upsert
`app_settings` key `backup_status` with `{"last_success_at": <ISO-8601 UTC now>,
"object_key": "...", "size": "..."}` via `psql` (the script already sources `.env` and has
`POSTGRES_PASSWORD`). The write is best-effort: failure prints a warning and does **not**
fail the backup (`|| echo …`, no `set -e` trip).

### Frontend

- Settings gains a **System** card: rows for last price refresh + next run, scheduler
  state, last backup (age-toned: amber > 48h, with red wording past 7 days), database size,
  alembic head, environment. House staleness tones and copy.
- Overview swaps its `/prices/refresh-status` fetch for `/system/status` (a superset — no
  net-new request); `attention.ts` adapts to the embedded prices shape and gains one item:
  backup missing or older than 48h → "Nightly backup hasn't run …" linking to `/settings`.
  **Suppressed when `environment !== 'prod'`** (dev boxes never back up and must not nag).

**Tests.** Pytest: status endpoint composition (with/without backup row, dev vs prod);
scheduler flag. Vitest: System card rendering/tones; attention item logic incl. the
prod-only suppression.

---

## 4. Polish batch (nine items)

1. **`color-scheme: dark`** on `:root` in `src/index.css`, and promote the duplicated amber
   literal `#c98500` (`src/pages/OverviewPage.css:37,100`) to a `--warn` custom property
   used everywhere the literal appears.
2. **Favicon + route titles.** `public/favicon.svg` (simple house-styled mark) linked from
   `index.html`; a small hook in `Layout` sets `document.title = "{label} · Finance"` from
   the nav item matching the pathname (fallback "Finance Dashboard").
3. **Real 404.** Replace the catch-all `PlaceholderPage title="Not Found"` (body: "Coming
   soon.") with a NotFound page on the standard `.page` scaffolding: "No page at {path}" +
   a link home.
4. **Login fixes.** Submit button reuses `.button-primary` (dark-on-accent — fixes the
   ~3.2:1 AA failure of white-on-accent, `src/pages/LoginPage.css:45-46`); the error div
   gains `role="alert"`; the email field gains `autoFocus`.
5. **Skip link + focus/scroll reset.** A visually-hidden-until-focused
   `<a class="skip-link" href="#main">Skip to content</a>` first in `Layout`; `<main
   id="main" tabIndex={-1}>`; on pathname change, focus `main` and `window.scrollTo(0, 0)`.
6. **Chart aria.** `EChart` gains an optional `ariaLabel` prop → container renders
   `role="img"` + `aria-label`. Pages supply concise one-line summaries (deliberate house
   wording; ECharts' generated descriptions are not used). Apply at minimum to Overview's
   three charts, both projection charts, the sankeys, the heatmap, and the allocation pair.
7. **Sidebar v2.** Grouped sections with small uppercase headers: Overview + Monthly update
   ungrouped on top; **Tracking** — Net Worth, Spending, Portfolio; **Income** — Paycheck,
   Comp, ESPP; **Planning** — Taxes, Projection, Calendar; Settings last, separator before
   Log out. Active state becomes distinct from hover: 3px accent-left indicator + accent
   icon tint. `aria-label="Primary"` on the nav. Label casing unified (sentence case:
   "Net worth", "Monthly update").
8. **Toast + undo layer.** A `ToastProvider` context + `useToast()` hook; a single
   `aria-live="polite"` region; variants success/info/error; auto-dismiss with pause on
   hover/focus. Low-risk deletes (portfolio transactions, dividends, custom calendar
   events, RSU grants) become instant with a "Deleted {x} — Undo" toast; Undo re-creates
   the captured row via the existing POST (new id — acceptable). `window.confirm` survives
   only for cascade/irreversible ops (tax-year delete, ESPP offering delete; the import
   apply keeps its own confirm). Existing inline "Saved." status notes are kept — toasts do
   not replace them.
9. **Command palette.** Ctrl+K (and Cmd+K) opens a hand-rolled overlay: fuzzy match over
   the 12 nav destinations plus a small action registry — "Refresh prices" (executes the
   POST, then navigates to /portfolio), "Enter {current month} update" (→ /update), "Add
   dividend" (→ /portfolio, dividends tab), "Add custom event" (→ /calendar). Recently-used
   ranking in localStorage. Full keyboard semantics: arrows/Enter/Escape, focus trap,
   combobox ARIA pattern. No library.

**Tests.** Vitest: title hook, 404 render, login alert/autofocus, skip-link focus behavior,
toast lifecycle + undo re-create, palette open/filter/execute/trap, nav grouping + active
state markup.

---

## 5. Annual money-flow Sankey (Overview)

### Backend — `GET /api/v1/overview/money-flow?year=YYYY`

One server-composed payload; all figures Decimal-derived, 2dp-quantized at the schema
layer. Sources:

- **Tax engine** for the year: `compute_breakdown` on stored inputs/brackets → gross
  income, `total_tax` (+ six-jurisdiction breakdown for the tooltip).
- **Tax input components** for the income split.
- **Spending actuals** for the calendar year: per-category sums, `monthly_cashflow.net_pay`
  sum, and net-pay coverage count.

Node math (conservation is exact by construction):

| Node | Value |
|---|---|
| Salary & bonus | `latest_w2_income + w2_bonuses + w2_salary_checkpoint` |
| RSU vests | `w2_stock_rsus_sold` |
| ESPP | `w2_espp_sale_component` |
| Investment income | `stcg_standard + unqualified_dividends + interest_total + ltcg_brokerage + qualified_dividends + other_capital_gains` (the gross-income component definition) |
| Other income | **balancing node** = engine `gross_income` − the four named sources (naturally contains 1099, employer HSA, `w2_other`, and any stored-total-vs-component drift) |
| Gross income | engine `gross_income` |
| Taxes | engine `total_tax`; tooltip lists the six jurisdictions |
| Pre-tax savings | `trad_401k_contributions + hsa_contributions + hsa_contributions_employer` |
| Take-home cash | Σ `monthly_cashflow.net_pay` for the calendar year |
| Retained equity & other | **residual** = gross − taxes − pre-tax savings − take-home cash |
| Categories (top-7 + Other) | spending actuals, existing top-N fold |
| Saved / Drawdown | `take_home_cash − total_spend`, exactly the spending sankey's Saved/Drawdown conventions |

Honesty rules:
- **Any negative node** (Other income, Retained equity, or a malformed input set) → the
  payload sets `renderable: false` with a `reason`; the card renders an explanatory note
  instead of a chart (the paycheck sankey's refusal pattern).
- Payload `warnings`: net-pay coverage ("net pay entered 7/12 months"), empty/missing tax
  inputs for the year, missing brackets (surfaced from engine warnings where relevant).
- Available years list included (years having any tax inputs), for the selector.

### Frontend

- `src/components/overview/moneyFlowOptions.ts`: a pure builder on the pinned sankey
  grammar (`src/charts/sankey.ts` — nodeWidth/gap, `layoutIterations: 0`, source-colored
  links, INK name labels, adjacency emphasis), reusing the spending sankey's Saved green /
  Drawdown red and category slot colors, and the paycheck sankey's MUTED-intermediate
  vocabulary for Gross/Take-home. Server-figure-verbatim tooltips.
- Overview card: span-12, ~380px, placed between the spending chart and Up next. Year
  selector chips (from the payload's available years; default = current year). InfoHint
  explains the residual node ("≈ vest shares kept + ESPP contributions + timing") and the
  data sources. Warnings render as a muted line under the chart.
- Fetched **separately** from the Overview snapshot (the Up-next pattern) so a failure
  cannot blank the page; failure renders a small inline error with retry.

**Tests.** Pytest: node math incl. balancing/residual, conservation, negative→refusal,
coverage warnings, year listing. Vitest: builder options (node/link structure, colors,
refusal path, tooltip figures), card year-switching, isolated-failure rendering.

---

## Cross-cutting

- **Testing:** TDD per house discipline; every behavior above lands with its test. Full
  `pytest` + `vitest` green is the merge gate.
- **No schema migrations** in this batch. The backup marker uses the existing
  `app_settings` table; everything else is compute/UI.
- **Explicitly out of scope:** capital-loss cap/carryforward; NIIT computation; account-group
  Sankey tail; event markers on Overview; show-password/caps-lock login extras; replacing
  inline status notes with toasts; ECharts' generated aria descriptions; any data-layer
  (TanStack Query) or session-refresh work.
