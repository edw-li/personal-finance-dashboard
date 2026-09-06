# ESPP purchase-year pace, employer match, Settings sections, "What moved" movers — design (2026-09-06)

Four requests from the 2026-09-06 conversation, approved in that conversation after a
browser-companion walk-through (mockups under `.superpowers/brainstorm/235-1788687486/content/`):

1. The Paycheck pace strip's ESPP row grades the **purchase year**, shows the **practical
   contribution cap** at the plan discount as a tick, and the discount becomes a setting.
2. The 415(c) row includes the **employer 401(k) match**, with the match policy stored per
   person on the paycheck profile and also feeding the Projection.
3. The Settings page is regrouped into **five sections with a sticky chip rail**, its
   whitespace closed, with no loss of function.
4. The Net Worth page's "What moved" waterfall becomes **contribution bars** under a
   from → to header, with a Groups · Accounts toggle.

## 0. Decisions confirmed by the user (2026-09-06 Q&A)

| Question | Decision |
|---|---|
| What should the ESPP row measure? | The purchase-year window from the profile timeline (Sep–Feb and Mar–Aug), judged against the practical cap with a tick; a second line projects a full purchase year at the current rate. Not "tick only", not a mirror of the ESPP modeler. |
| Where does the match policy live? | On each paycheck profile, per person, effective-dated; edited in the Paycheck profile form; Settings shows a read-only per-person summary with a link; Try-it gets the fields as overrides. |
| Does the match count in the Projection? | Yes, as a separate employer leg that a retirement also removes. The Spending page's savings rate stays employee-only. |
| Settings shape? | Option A: five sections in one grid with a sticky chip rail. Not tabs, not headings-only. |
| "What moved" form? | Option A: sorted horizontal contribution bars under a from → to header, Groups · Accounts toggle. Not a change-axis bridge, not an axis zoom. |

Standing decisions this design respects: the ESPP modeler's period contributions stay
hand-entered (2026-08-23 spec §1); the app ships no IRS values (2026-08-27 spec §2); displayed
figures are the server's, never re-derived on the client (chart grammar §7, PacePanel); one
axis per chart, bars grow from a baseline, colour follows the entity (dataviz rules).

## 1. ESPP row: purchase-year window, practical cap, discount setting

### 1.1 The §423 facts the row encodes

26 CFR 1.423-2(i): the right to purchase accrues on each purchase date, the 25,000 is measured
at the option's grant-date (offering) price, per calendar year, and never carries between
options. NVIDIA's plan (user-provided, 2026-08-23) buys on the last trading day of February and
August at a discount on the lower of the offering price and the purchase-date close, and caps
shares per calendar year. Consequences the row must state:

- The calendar year that a contribution counts toward is the year of the **purchase** it funds:
  Sep–Dec checks fund next February's purchase and belong to **next** year's cap.
- Contribution dollars can never use the whole 25,000: at most `25,000 × (1 − discount)`
  buys stock (21,250 at 15%), and less than that only when the stock is below the offering
  price at purchase. That ceiling is the **practical cap**.

### 1.2 Windows

For the strip's year `Y` (the limits year, `today.year`), the two halves are the ESPP
modeler's period rows for `Y`, obtained exactly as the calendar generator does:
`plan_year_rows(Y, stored_periods, [], None, None)`. A stored period wins; the derived slots are
`Sep 1 (Y−1) → last_weekday_of(Y, 2)` and `Mar 1 (Y) → last_weekday_of(Y, 8)`. Each half has
`period_start`, `period_end` (the purchase date) and, if stored, a contribution.

### 1.3 Per-half figure and its source

| Half state | Source | Figure |
|---|---|---|
| `period_end < today` and a stored period exists | `entered` | the stored period's contribution, `half_up2((semi_annual_base + additional_payments) × contribution_pct)` — the number the user typed |
| otherwise | `estimated` | the payday sum below |

**Payday sum.** For each payday `d` in `[period_start, period_end]`, the profile in force on
`d` contributes `espp_pct × (annual_salary / pay_periods_per_year)`. Paydays come from
`business_days.semi_monthly_paydays(year, month)` when the in-force profile's cadence is 24
(`basis: "paydays"`). Any other cadence uses a per-month approximation, `espp_pct ×
annual_salary / 12` for each month whose 15th lies in the window, with the profile in force on
that 15th (`basis: "months"`); the row's provenance line says "estimated by month".

**Profile in force on a date** is the person's latest profile with `effective_date <= d`.
Paydays **before the earliest profile** use the earliest profile (`backfilled_from` carries its
effective date so the copy can say "before 2026-01-01 assumes your earliest profile"). This
is the pace strip's "at this rate" posture applied backwards; it is never called a ledger.

**Preview (Try-it).** Halves already `entered` stay as they are. For estimated halves, paydays
`>= today` use the scenario profile's `espp_pct` and `annual_salary`; earlier paydays use the
stored timeline. The knob therefore answers "if I change now, where do this year's purchases
land?" The GET breakdown is the same computation with the in-force profile as the scenario.

**Row visibility.** The row appears when any half's figure is > 0 or the current profile's
`espp_pct > 0`. A person whose whole window and current rate are zero gets no row (today's
"not enrolled" rule, widened to the window).

### 1.4 Practical cap, tick, verdict

- `limit` = `limit_espp_423` for `Y` (user-entered; missing → the CTA row, no meter, as today).
- `soft_limit = quantize_money(limit × (1 − discount))`.
- `annualized` (kept as the wire name; `measure: "window"` says what it holds) =
  `half_up2(H1 + H2)`. `ratio = annualized / limit` (4 dp, unchanged) and
  `soft_ratio = annualized / soft_limit` (4 dp).
- **Tone is judged on `soft_ratio`** with today's thresholds (`>= 0.95` warn, `> 1` over), so the
  verdict can never disagree with the tick. The displayed percentage is `soft_ratio`.
- `projected_full_year = half_up2(current espp_pct × current annual_salary)`;
  `projected_excess = max(0, projected_full_year − soft_limit)`.

Worked example on production's profiles (Edward, 11% until 2026-08-17 then 12%, salary
188,930, 24 checks; no stored periods): H1 10,391.15, H2 10,469.90, window 20,861.05,
soft cap 21,250.00, `soft_ratio` 0.9817 → warn; projected full year 22,671.60, excess 1,421.60.

### 1.5 The discount setting

- `app_settings['espp_discount_pct']`, envelope `{"value": "0.15"}` (a plain-notation fraction
  string, like `swr_pct`). Reader `read_espp_discount(db)` in `api/app_settings.py` degrades to
  **0.15** on absent/malformed; the writer refuses anything outside `[0, 0.15]` with
  `"espp_discount_pct must be between 0 and 0.15 (the §423 maximum)"`. Restore replaces it
  like every non-operational setting.
- Every hardcoded 0.85 / 15 / 15÷85 reads the setting instead:
  `espp_calc.run_modeler(..., discount)` (the module constant `DISCOUNT` is deleted; the
  golden tests pass `Decimal("0.15")`), the lot `purchase_price` default in `api/espp.py`, the
  pace tick, the tax what-if's qualified-disposition ratio `discount / (1 − discount)`, and the
  ESPP page's prose. `ModelerOut` echoes `discount_pct` so the page prints the figure it was
  priced with.

### 1.6 Wire

`PaceItemOut` gains optional fields, all `null` where they do not apply:

```
measure: "annualized" | "window"
soft_limit: Decimal | null          # ESPP only
soft_ratio: Decimal | null
window_label: str | null            # "Sep 2025 – Aug 2026 purchases"
halves: list[PaceHalfOut] | null    # {label, start, end, amount, source: entered|estimated, basis: paydays|months}
backfilled_from: date | null
projected_full_year: Decimal | null
projected_excess: Decimal | null
employer_match: Decimal | null      # 415(c) only, §2
```

`limit_check.paycheck_pace` stays pure and unchanged in shape; a new pure module
`services/espp_pace.py` computes the halves and the ESPP item from `(halves, profiles,
scenario_from_today, limit, discount, today)`. `api/paycheck.py` loads the person's profiles,
the stored ESPP periods and the discount, and swaps the ESPP row in for both the GET and the
preview. `test_sandbox_purity.py` continues to prove the preview writes nothing.

### 1.7 Rendering (`PacePanel.tsx`, `pace.css`)

- The ESPP row's name cell shows the label and, beneath it, `window_label`.
- The meter keeps its 0..`limit` track. A `.pace-soft-tick` (2 px, `var(--muted)`, full track
  height, `translateX(-1px)`, `aria-hidden`) sits at `left: soft_limit / limit × 100 %`, modelled
  on the sandbox slider tick. The existing `.pace-overflow-tick` still marks fill past the
  track's end.
- Figures cell: `{annualized} / {soft_limit} practical`; verdict cell: `soft_ratio` as a
  percentage plus the tone word. `aria-valuetext` reads "{annualized} of {soft_limit} practical
  cap; §423 cap {limit}".
- A second, full-width `.pace-note` line: "{H1 label} {entered|estimated} · {H2 label}
  {entered|estimated}{ · before {backfilled_from} assumes your earliest profile}{ · estimated
  by month}. At your current {pct}%, a full purchase year is {projected_full_year}{, which is
  {projected_excess} over the practical cap; the plan refunds the excess after the purchase}."
  With a zero current rate the sentence reads "You are not contributing now."
- The card's InfoHint gains: "The ESPP row grades the purchases that fall in this calendar
  year, so autumn checks count toward next year. Its cap is the most contribution dollars the
  §423 limit can buy at your plan discount; the exact chained figures live on the ESPP page."
- `TryItPanel` renders the same component; no new controls.

### 1.8 Tests

`test_espp_pace.py`: window boundaries incl. a leap February and month-end weekends; stored
half wins only once its purchase date has passed; payday attribution across a mid-window rate
change (the 2026-08-17 profile); earliest-profile backfill flag; months basis for a 26-check
profile; soft cap and tone golden (0.9817 warn); missing limit → CTA item; scenario overrides
only paydays from today. `test_paycheck_comp_api.py` / `test_paycheck_preview_api.py`: the
row's new fields on the wire, baseline == scenario for empty overrides. `test_app_settings*`:
discount default, bounds, envelope. `test_espp_calc.py` / `test_espp_api.py`: parametrised
discount, `discount_pct` echo, lot default at a non-15% discount. `test_tax_whatif.py`: ratio
follows the setting. `PacePanel.test.tsx`: tick position, aria text, note line variants.
`EsppPage.test.tsx`: prose prints the echoed discount.

## 2. Employer 401(k) match

### 2.1 Storage

Four columns on `paycheck_profiles`, one migration chaining on head `e5a7c1d3f6b8`, all
`NOT NULL` with `server_default '0'` (the `hsa_coverage` template):

| column | type | meaning |
|---|---|---|
| `match_rate_1` | Numeric(10,9) | match rate on the first band |
| `match_band_1` | Numeric(12,2) | dollars of elective deferrals the first rate applies to |
| `match_rate_2` | Numeric(10,9) | match rate on the next band |
| `match_band_2` | Numeric(12,2) | dollars the second rate applies to, after the first band |

Zero bands mean "no match". The user's policy is `1.0 / 6,000 / 0.5 / 11,000`. Validation
(whole-row, POST == PATCH): rates in `[0, 2]` at 9 dp with the pct mis-scale guard, bands in
`[0, the salary column's Numeric(12,2) bound]`. Export is automatic (snapshot serialises every column); restore
tolerates the columns' absence in older snapshots (defaults apply); the importer never writes
them.

### 2.2 Formula

```
E     = min(annualized elective, limit_401k_elective for the year if entered)
match = match_rate_1 × min(E, match_band_1)
      + match_rate_2 × clamp(E − match_band_1, 0, match_band_2)
```

Elective is traditional + Roth. After-tax contributions are not matched. The cap on `E`
exists because payroll stops deferrals at the 402(g) limit and the match follows actual
contributions. Pure function `employer_match(profile, elective_annual, limit)` in
`services/limit_check.py`.

### 2.3 Where it shows

- **415(c) row.** `annualized = E + after_tax + match`; `employer_match = match` on the wire.
  Label: `415(c) total additions (incl. employer match)` when any band is > 0, otherwise today's
  `(excludes employer match)`. The figures cell gets a muted `incl. {employer_match} match`
  suffix when present; the card InfoHint's "not modeled" sentence becomes "Employer HSA
  contributions are not modeled; set your 401(k) match on your paycheck profile."
- **Paycheck breakdown.** `BreakdownOut` gains `employer_match` (per check, quantized), not a
  waterfall line. The page prints a muted line under the waterfall: "Employer match
  +{amount} per check, not part of your pay."
- **Projection.** `_payroll_savings` adds per person `employer_monthly = half_up2(match / 12)`
  using the in-force profile and the current year's entered 402(g) limit.
  `PayrollSavingOut` gains `employer_monthly`; `ContributionBreakdownOut` gains `employer`;
  `total = cash + payroll + employer`. The retirement drop removes the person's
  `employer_monthly` as well, so both sides stay symmetric. The Assumptions card's arithmetic
  line names the leg: "Cash {c} + payroll {p} + employer match {e} = {total}".
  `services/savings.py` is untouched: the Spending page's savings and rates stay employee-only.
- **Profile form (Paycheck page).** Fieldset "Employer 401(k) match": "{rate}% of the first
  ${band}, then {rate}% of the next ${band}". Carried forward when a new profile is seeded
  from the newest row. Validation sentences mirror the server's.
- **Try-it.** `ProfileOverrides`, `ScenarioProfile`, `SCENARIO_FIELDS` and `FIELD_LABELS` gain
  the four fields; the panel gets them under an "Employer match" disclosure.
- **Settings summary.** `GET /paycheck/profiles` items gain `in_force: bool` (computed with
  `_default_profile`'s rule, one place). The Plan assumptions card (§3) lists each person's
  in-force policy in words, or "no match entered", with a link to `/paycheck`.

Worked example: E = 24,500 (13% of 188,930 capped), after-tax 5,667.90, match 11,500 →
415(c) 41,667.90 of 72,000, ratio 0.5787, ok.

### 2.4 Tests

`test_limit_check.py`: match golden (11,500), cap on E, zero bands → no match and the old
label, label switch, row order unchanged; `FakeProfile` gains the four fields.
`test_paycheck_comp_api.py`: column defaults, validation, carry-forward, `in_force`,
`employer_match` in the breakdown. `test_paycheck_preview_api.py`: overrides change the
scenario 415(c) row. `test_projection_api.py`: employer leg in the breakdown and the
retirement drop; `test_savings_service.py` unchanged and green. Frontend: profile form
fieldset, PacePanel suffix, breakdown line, Projection copy, TryIt disclosure.

## 3. Settings: five sections and a sticky chip rail

### 3.1 Sections and order

| Section (`id`) | Cards, in order, with spans |
|---|---|
| Household (`sec-household`) | Household 6 · Spending categories 6 · Accounts 12 |
| Planning (`sec-planning`) | Contribution limits 6 · **Plan assumptions** 6 |
| Account (`sec-account`) | Appearance 6 · Password 6 |
| Integrations (`sec-integrations`) | **Price refresh** 6 · Assistant 6 · Calendar feed 12 |
| Data (`sec-data`) | Import workbook 12 · Backups & snapshots 6 · Restore 6 · Data health 6 · System status 6 · Activity 12 |

A section heading is a `span-12` element inside `.card-grid` (`<h2 class="settings-section"
id="sec-…">`), not a `.card`, so it takes no entrance animation and no arrival ring. Every
existing card `id` is kept. New ids: `plan-assumptions`, `price-refresh`. Retired: `app-settings`.

### 3.2 The rail

`SettingsRail` renders in `PageFrame`'s `scopeRow` slot: five chips (`Segmented`, chips
variant, single-select, buttons in tab order). A chip scrolls its section heading into view
(`scrollIntoView({ block: 'start' })`, offset by the sticky inset via `scroll-margin-top` on
the headings) and the active chip follows scrolling through an `IntersectionObserver` on the
headings (the topmost heading at or above the viewport's upper third is active; the observer is
skipped under jsdom and the click sets the active chip directly). Hashes `#sec-*` scroll without
the ring; card hashes keep today's ring behaviour. PageFrame already measures the scope row and
insets the reveal timelines; `SCOPE_ROW` in `skeletonMetrics.ts` already sizes it.

### 3.3 Card changes

- **Plan assumptions** (new, replaces App settings): Withdrawal rate %, ESPP ticker, ESPP
  discount %, and the read-only employer-match summary (§2.3) with a link to the Paycheck page.
  Saves its three fields with a partial PUT. InfoHint: "The knobs the Projection, ESPP and
  Paycheck pages derive from. The employer match is set per person on the Paycheck page."
- **Price refresh** (new): the cron field (hot-applied on save, unchanged validation), the
  scheduler facts moved from System status (Last price refresh, Next scheduled run, Scheduler,
  Recent refreshes) and a **Refresh now** button (`POST /prices/refresh`, disabled while a run
  is in flight, status from `GET /prices/refresh-status`, toast on completion) — the Portfolio
  page's handler lifted into a shared hook. InfoHint carries the cron grammar note.
- **System status**: the six remaining facts (Data through, Last backup, Recent backups,
  Database size, Alembic head, Environment) in a two-column `.system-facts` at ≥ 720 px.
- **Appearance**: its four fields in a two-by-two `.settings-fields` grid at ≥ 720 px.
- **Calendar feed**: `span-12`; the token form and the reminder-day form side by side
  (`.feed-forms`, two columns at ≥ 720 px), the token table below.
- **Activity**: `span-12`; the list wrapped in a `.settings-scroll` (max-height 420 px) with
  Load more inside the scroll region; the inline report opens below the list.
- **Password**, **Household**, **Categories**, **Accounts**, **Limits**, **Assistant**,
  **Backups**, **Restore**, **Data health**, **Import**: mounts move, internals unchanged.

### 3.4 Whitespace rules

- Cards are paired by height as in §3.1; no section leaves a half row empty.
- `.settings-form` and `.settings-card-form` drop their 420 px caps for
  `grid-template-columns: repeat(auto-fit, minmax(240px, 1fr))`; a single field keeps a
  `max-width: 320px` so inputs never stretch to a card's width.
- `.card-grid` keeps `align-items: stretch`; scroll caps (Accounts, Categories, Calendar,
  Activity) bound the tall cards.
- The permanently present `.restore-arm` row stays: it is the safety affordance, not padding.

### 3.5 Settings PUT becomes partial

`AppSettingsUpdate`: every field `| None = None`; a `None` leaves the stored value; validation
runs only on present fields; `reschedule_price_refresh` runs only when `price_refresh_cron` is
present. `AppSettingsOut` gains `espp_discount_pct`. Three cards (Plan assumptions, Price
refresh, Calendar feed) then save independently; Calendar feed's read-then-merge dance is
removed.

### 3.6 Registry, skeleton, tests

- `paletteRegistry.SETTINGS_SECTIONS`: `app-settings` → `plan-assumptions` (keywords:
  withdrawal rate, swr, espp ticker, espp discount, employer match) and `price-refresh`
  (cron, schedule, refresh prices, scheduler). `paletteRegistry.test.ts`'s "every anchored
  section has a card wearing that id" stays as written and passes.
- Skeleton: `tiles: 0, cards: [{6,220},{6,220},{12,260},{6,240},{6,240}]`; the count pin
  becomes 5.
- `SettingsPage.test.tsx`: the four adjacency pins are rewritten to §3.1's order (Household →
  Categories → Accounts; Limits → Plan assumptions; Appearance → Password; Price refresh →
  Assistant → Calendar feed; Import → Backups → Restore → Data health → System status →
  Activity); the `loadedOnce` gating tests keep Appearance outside both gates; arrival tests
  add `#sec-planning` (scroll, no ring) and keep `#limits`, `#calendar`, `#restore`,
  `#backups` and the `?restore=` hand-off. New: rail chips scroll and mark active; partial
  PUT sends only the card's fields. Backend: partial PUT semantics, discount field.

## 4. Net Worth "What moved": contribution bars

### 4.1 Data

For the viewed index `i ≥ 1`: movers are, in **Groups** mode, each `GROUP_ORDER` group with
`delta = cents(group_totals[g][i] − group_totals[g][i−1]) ≠ 0`; in **Accounts** mode, each
non-component account (`is_component` false — components are already folded into their parents
by the timeseries) with a non-zero delta of its `series` values, coloured by its group. Accounts
mode keeps the ten largest by `|delta|` and folds the rest into one "Other accounts" row
(summed delta, `OTHER_SERIES_COLOR`). Rows sort by `|delta|` descending. Liability deltas keep
their stored sign (more debt → negative → a loss bar). `net_delta = net_worth[i] −
net_worth[i−1]`; `share = delta / net_delta` when `net_delta ≠ 0`.

### 4.2 Form

- Horizontal bars, `grid('horizontal')`, category y-axis inverted so the largest mover is on
  top, `moneyAxis()` value x-axis (includes zero; bars grow from it in both directions), one
  series "Change", per-bar `itemStyle.color` = the mover's group colour, `barMaxWidth` 24, a
  1 px surface border. Direct labels: the signed compact amount at the bar's outer end
  (`position: 'right'` for gains, `'left'` for losses). Tooltip: `itemTooltip` value-first,
  label the mover, sub "{share}% of the change" (plus " · {group}" in Accounts mode).
- Height: `clamp(200, 60 + 28 × rows, 420)`.
- **Header strip**: `ChartCard` gains an optional `lede?: ReactNode` rendered between the header
  row and the plot. Content: "{prev month} {prev NW} → {month} {NW} · {signed delta} ·
  {signed pct}", totals in text ink, delta and pct in the positive/negative text tones the
  StatTile deltas use. All figures are the server's (`net_worth`, `mom_pct`).
- **Controls**: `Segmented` "Groups · Accounts", local state like the stack's `stackBy`,
  default Groups.
- Copy: title unchanged; hint "How each account group — or account — moved net worth from the
  prior snapshot to this one, largest first. Groups that did not move are left out."; aria
  "Horizontal bar chart of how each account group moved net worth from the prior month to this
  one"; empty state unchanged; `exportName` `net-worth-movers`.
- Table twin / CSV: columns Mover, Group, Change, Share of change.

### 4.3 Removals

`netWorthBridgeOption` / `netWorthBridgeCsv` and the bridge fixture are replaced by
`netWorthMoversOption` / `netWorthMoversCsv` and a movers fixture. `charts/waterfall.ts` stays
for the tax waterfall.

### 4.4 Tests

Builder: sort order, zero omission, liability sign, Accounts fold at ten, share math, header
strings, `null` on index 0. Page: toggle switches mode, lede renders the two totals, CSV rows.
Conformance fixture passes the grammar checks (token colours, named grid, itemTooltip).

## 5. Out of scope (deliberately)

Per-offering discount overrides (the setting is plan-wide; add a column later if a plan
changes mid-history); more than two match tiers, percent-of-pay bands, true-up and after-tax
matching; the match in the savings rate; Settings tabs or `?section=` deep links; per-person
ESPP plans; a per-paycheck contribution ledger (the ESPP row remains a stated estimate).

## 6. File map

```
backend/app/
  alembic/versions/(timestamp at implementation)_paycheck_profile_match_tiers.py   four columns, server_default 0
  models/comp.py                    PaycheckProfile match columns
  api/paycheck.py                   validation, ScenarioProfile, overrides, in_force, pace assembly, employer_match
  api/app_settings.py               read_espp_discount, partial PUT, espp_discount_pct
  api/espp.py                       discount from the setting (lot default, modeler, echo)
  api/projection.py                 employer leg + retirement drop
  schemas/paycheck.py               PaceItemOut fields, PaceHalfOut, BreakdownOut.employer_match, ProfileOut.in_force
  schemas/app_settings.py           Optional fields, espp_discount_pct
  schemas/projection.py             employer fields
  schemas/espp.py                   discount_pct echo
  services/espp_pace.py             NEW pure: halves, payday attribution, soft cap item
  services/limit_check.py           employer_match(), 415(c) composition, label switch
  services/espp_calc.py             run_modeler(discount)
  services/tax_whatif.py            ratio from the discount
src/
  components/paycheck/PacePanel.tsx, pace.css         tick, note line, suffix
  components/paycheck/TryItPanel.tsx                   match disclosure
  pages/PaycheckPage.tsx                               match fieldset, breakdown line
  pages/ProjectionPage.tsx (+ assumptions copy)        employer leg
  pages/SettingsPage.tsx, SettingsPage.css             sections, rail, skeleton
  components/settings/SettingsRail.tsx                 NEW
  components/settings/PlanAssumptionsCard.tsx          NEW
  components/settings/PriceRefreshCard.tsx             NEW
  components/settings/SystemCard.tsx, AppearanceCard.tsx, CalendarFeedCard.tsx, ActivityCard.tsx, settings.css
  components/paletteRegistry.ts                        two entries
  components/ChartCard.tsx                             lede slot
  components/networth/netWorthChartOptions.ts          movers builder + csv
  pages/NetWorthPage.tsx                               movers card, toggle, lede
  charts/fixtures/                                     movers fixture
  types/api.ts                                         all wire additions
```

## 7. Suggested lanes for the plan

A **backend** (the only migration writer: match columns, formula, ESPP pace service, settings
PUT + discount, projection leg) · B **paycheck & projection frontend** (PacePanel, TryIt,
profile form, breakdown line, projection copy; forks after A's wire lands) · C **Settings**
(sections, rail, new cards, CSS, registry, tests; needs A's partial PUT and discount field) ·
D **Net Worth movers** (frontend-only, independent) · V **verify** on main (full suites, the
Settings smoke driver, a real-data eyeball of the ESPP row and the movers chart against the
dev stack). Merge order A → B, C, D → V.
